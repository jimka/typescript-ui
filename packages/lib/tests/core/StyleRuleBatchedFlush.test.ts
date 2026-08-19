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

/** A component whose deferred rule is queued with only a no-op null removal. */
class NullOnlyDeferredRuleProbe extends _Component {
    constructor() {
        super();
        this.createStyleRule('.probe').set('display', null);
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
        // `backgroundColor` is a conditional declaration — never hoisted onto
        // the class tier (see ClassStyleRules.test.ts case 16) — so it is what
        // gives this component an `#id` rule to batch at all. A bare
        // `new Component({})` now diverges from its class bag in nothing and
        // materialises no rule whatsoever; case 15 pins that half.
        const c = new Component({ backgroundColor: '#fff' });
        c.getElement(true);

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = '#' + c.getId();
        const ops      = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === selector);

        expect(ops.length).toBe(1);
        const bag = ops[0].args[1] as Record<string, string | null>;
        // `position` / `margin` / `cursor` / `border` are all served by the
        // framework-wide rule (plans/implemented/class-scoped-style-rules.md,
        // plans/implemented/selectable-text-cursor.md, and this plan's
        // `border` hoist), so a bare `Component` writes none of them to its
        // own `#id` rule — only the conditional declaration it actually set.
        expect(bag.cursor).toBeUndefined();
        expect(bag.border).toBeUndefined();
        expect(bag.backgroundColor).toBe('#fff');
    });

    it('case 7: sync() produces exactly one further setRuleStyles op, not one per declaration', () => {
        const c = new Component({ backgroundColor: '#fff' });
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

        // A stock component diverges from its class bag in nothing — every
        // declaration it resolves is already served by the framework rule — so
        // the lazy gate correctly inserts no per-instance rule at all. Case 12
        // pins the positive half (one queued declaration ⇒ exactly one rule).
        expect(sink.writes.filter((w) => w.op === 'ensureStyleRule' && w.args[0] === selector).length).toBe(0);
        expect(_ruleCacheHas(selector)).toBe(false);
    });

    it('case 16: an empty autoCommitStyle window inserts no rule', () => {
        const c = new Component({});
        c.getElement(true);

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = '#' + c.getId();

        c.setAutoCommitStyle(false);
        c.setAutoCommitStyle(true);

        expect(sink.writes.some((w) => w.op === 'ensureStyleRule' && w.args[0] === selector)).toBe(false);
        expect(_ruleCacheHas(selector)).toBe(false);
    });

    it('case 17: a real declaration queued inside the window still materialises exactly once', () => {
        const probe = new RuleProbe();
        probe.getElement(true);

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = '#' + probe.getId();

        probe.setAutoCommitStyle(false);
        probe.rule('color', 'red');
        probe.setAutoCommitStyle(true);

        expect(sink.writes.filter((w) => w.op === 'ensureStyleRule' && w.args[0] === selector).length).toBe(1);

        const ops = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === selector);
        expect(ops.length).toBe(1);
        expect(ops[0].args[1]).toEqual({ color: 'red' });
    });

    it('case 18: a null removal on an already-materialised rule still flushes', () => {
        const probe = new RuleProbe();
        probe.rule('color', 'red');
        probe.getElement(true);

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = '#' + probe.getId();
        const before   = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === selector).length;

        probe.setAutoCommitStyle(false);
        probe.rule('color', null);
        probe.setAutoCommitStyle(true);

        const ops = sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === selector);
        expect(ops.length).toBe(before + 1);
        expect(ops[ops.length - 1].args[1]).toEqual({ color: null });
    });

    it('case 19: teardown after a skipped window is a clean no-op', () => {
        const c = new Component({});
        c.getElement(true);

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = '#' + c.getId();

        c.setAutoCommitStyle(false);
        c.setAutoCommitStyle(true);

        expect(() => c.dispose()).not.toThrow();

        expect(sink.writes.some((w) => w.op === 'deleteStyleRule' && w.args[0] === selector)).toBe(false);
        expect(_ruleCacheHas(selector)).toBe(false);
    });

    it('case 20: a deferred rule queued with only a null removal materialises nothing', () => {
        const p = new NullOnlyDeferredRuleProbe();
        p.getElement(true);

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = '#' + p.getId() + '.probe';

        expect(sink.writes.some((w) => w.op === 'ensureStyleRule' && w.args[0] === selector)).toBe(false);
        expect(sink.writes.some((w) => w.op === 'setRuleStyles' && w.args[0] === selector)).toBe(false);
        expect(_ruleCacheHas(selector)).toBe(false);
    });

    it('case 21: teardown of a skipped deferred rule is a clean no-op', () => {
        const p = new NullOnlyDeferredRuleProbe();
        p.getElement(true);

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = '#' + p.getId() + '.probe';

        expect(() => p.dispose()).not.toThrow();

        expect(sink.writes.some((w) => w.op === 'deleteStyleRule' && w.args[0] === selector)).toBe(false);
        expect(_ruleCacheHas(selector)).toBe(false);
    });
});

describe('StyleRule — hasQueuedDeclarations', () => {
    it('case 22: an empty dirty bag has no queued declarations', () => {
        const rule = new StyleRule({ scope: 'selector', name: '.hqd-case22', materialize: false });

        expect(rule.hasQueuedDeclarations()).toBe(false);
    });

    it('case 23: a bag of only null removals has no queued declarations', () => {
        const rule = new StyleRule({ scope: 'selector', name: '.hqd-case23', materialize: false });

        rule.set('border', null);
        rule.set('color', null);

        expect(rule.hasQueuedDeclarations()).toBe(false);
    });

    it('case 24: one real value among null removals counts', () => {
        const rule = new StyleRule({ scope: 'selector', name: '.hqd-case24', materialize: false });

        rule.set('border', null);
        rule.set('color', 'red');

        expect(rule.hasQueuedDeclarations()).toBe(true);
    });
});
