// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component, _Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { StyleRule, _ruleCacheHas } from '~/core/StyleTarget';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

/** Renders with an empty rule bag: `applyStyle` runs only the materialisation gate. */
class RuleProbe extends _Component {
    override applyStyle(element: Handle): this {
        DOM.sink.apply(element, { removeAttr: ['style'] });
        this.materialiseStyleRule();

        return this;
    }

    rule(key: string, value: string | null): this { return this.setElementCSSRule(key, value); }
}

/** A component that allocates a deferred (state) rule from its constructor. */
class DeferredRuleProbe extends _Component {
    constructor() {
        super();
        this.createStyleRule('.probe').setMany({ color: 'red', display: 'block' });
    }
}

describe('StyleRule — batched flush (bare buffer)', () => {
    it('case 1: queue then materialise batches into one setRuleStyles op', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const rule = new StyleRule({ scope: 'selector', name: '.batched-flush-case1', materialize: false });

        rule.set('color', 'red');
        rule.set('display', 'block');
        rule.set('margin', '0px');
        rule.ensure();

        const ops = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === '.batched-flush-case1');
        expect(ops.length).toBe(1);
        expect(ops[0].args[1]).toEqual({ color: 'red', display: 'block', margin: '0px' });
    });

    it('case 2: a write-through after materialise still reaches the sink immediately', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const rule = new StyleRule({ scope: 'selector', name: '.batched-flush-case2', materialize: false });

        rule.set('color', 'red');
        rule.ensure();

        rule.set('color', 'blue');

        const ops = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === '.batched-flush-case2');
        expect(ops.length).toBe(2);
        expect(ops[1].args[1]).toEqual({ color: 'blue' });
    });

    it('case 3: a later queued write for the same key overrides the earlier one, not appends', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const rule = new StyleRule({ scope: 'selector', name: '.batched-flush-case3', materialize: false });

        rule.set('color', 'red');
        rule.set('color', 'blue');
        rule.ensure();

        const ops = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === '.batched-flush-case3');
        expect(ops.length).toBe(1);
        expect(ops[0].args[1]).toEqual({ color: 'blue' });
    });

    it('case 4: a queued null removal is carried in the bag, not dropped', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const rule = new StyleRule({ scope: 'selector', name: '.batched-flush-case4', materialize: false });

        rule.set('border', '1px solid red');
        rule.set('border', null);
        rule.ensure();

        const ops = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === '.batched-flush-case4');
        expect(ops.length).toBe(1);
        expect(ops[0].args[1]).toEqual({ border: null });
    });

    it('case 9: ordering across a flush boundary — the queued value never re-applies after a later write', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const rule = new StyleRule({ scope: 'selector', name: '.batched-flush-case9', materialize: false });

        rule.set('color', 'red');
        rule.ensure();
        rule.set('color', 'blue');

        const ops = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === '.batched-flush-case9');
        expect(ops.map((o) => o.args[1])).toEqual([{ color: 'red' }, { color: 'blue' }]);
    });

    it('case 10: flushing an empty bag records no setRuleStyles op', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const rule = new StyleRule({ scope: 'selector', name: '.batched-flush-case10', materialize: false });

        rule.ensure();
        rule.flush();

        const ops = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === '.batched-flush-case10');
        expect(ops.length).toBe(0);
    });
});

describe('StyleRule — batched flush (Component.applyStyle)', () => {
    it('case 5: an autoCommitStyle(false) window batches into one setRuleStyles op', () => {
        const probe = new RuleProbe();
        probe.getElement(true);

        const sink    = DOM.sink as RecordingDOMSink;
        const before  = sink.writes.length;
        const selector = '#' + probe.getId();

        probe.setAutoCommitStyle(false);
        probe.rule('color', 'red');
        probe.rule('display', 'block');
        probe.rule('margin', '0px');
        probe.setAutoCommitStyle(true);

        const ops = sink.writes.slice(before).filter((w) => w.op === 'setRuleStyles' && w.args[0] === selector);
        expect(ops.length).toBe(1);
        expect(ops[0].args[1]).toEqual({ color: 'red', display: 'block', margin: '0px' });
    });

    it('case 6: first render produces exactly one setRuleStyles op for the component rule', () => {
        const c = new Component({});
        c.getElement(true);

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = '#' + c.getId();
        const ops      = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === selector);

        expect(ops.length).toBe(1);
        const bag = ops[0].args[1] as Record<string, string | null>;
        expect(bag.position).toBeDefined();
        expect(bag.margin).toBeDefined();
    });

    it('case 7: sync() produces exactly one further setRuleStyles op, not one per declaration', () => {
        const c = new Component({});
        c.getElement(true);

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = '#' + c.getId();
        const before   = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === selector).length;

        c.sync();

        const after = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === selector).length;
        expect(after).toBe(before + 1);
    });

    it('case 8: a deferred state rule materialises as one batched setRuleStyles op', () => {
        const p = new DeferredRuleProbe();
        p.getElement(true);

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = '#' + p.getId() + '.probe';
        const ops      = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === selector);

        expect(ops.length).toBe(1);
        expect(ops[0].args[1]).toEqual({ color: 'red', display: 'block' });
    });
});

describe('StyleRule — lazy materialisation gate', () => {
    it('case 11: an empty bag inserts no rule', () => {
        const probe = new RuleProbe();
        probe.getElement(true);

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = '#' + probe.getId();

        expect(sink.writes.some((w) => w.op === 'ensureStyleRule' && w.args[0] === selector)).toBe(false);
        expect(sink.writes.some((w) => w.op === 'setRuleStyles' && w.args[0] === selector)).toBe(false);
        expect(_ruleCacheHas(selector)).toBe(false);
    });

    it('case 12: one queued declaration inserts exactly one rule carrying it', () => {
        const probe = new RuleProbe();
        probe.rule('color', 'red');
        probe.getElement(true);

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = '#' + probe.getId();

        expect(sink.writes.filter((w) => w.op === 'ensureStyleRule' && w.args[0] === selector).length).toBe(1);

        const ops = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === selector);
        expect(ops.length).toBe(1);
        expect(ops[0].args[1]).toEqual({ color: 'red' });
    });

    it('case 13: a setter after an empty render materialises the rule then', () => {
        const probe = new RuleProbe();
        probe.getElement(true);

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = '#' + probe.getId();

        expect(sink.writes.some((w) => w.op === 'ensureStyleRule' && w.args[0] === selector)).toBe(false);

        probe.rule('color', 'blue');

        expect(sink.writes.filter((w) => w.op === 'ensureStyleRule' && w.args[0] === selector).length).toBe(1);

        const ops = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === selector);
        expect(ops.length).toBe(1);
        expect(ops[0].args[1]).toEqual({ color: 'blue' });
    });

    it('case 14: disposing an unmaterialised rule is a clean no-op', () => {
        const probe = new RuleProbe();
        probe.getElement(true);

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = '#' + probe.getId();

        expect(() => probe.dispose()).not.toThrow();

        expect(sink.writes.some((w) => w.op === 'deleteStyleRule' && w.args[0] === selector)).toBe(false);
        expect(_ruleCacheHas(selector)).toBe(false);
    });

    it('case 15: the gate does not mis-fire on a stock component', () => {
        const c = new Component({});
        c.getElement(true);

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = '#' + c.getId();

        expect(sink.writes.filter((w) => w.op === 'ensureStyleRule' && w.args[0] === selector).length).toBe(1);
    });
});
