// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the instance style layer introduced by
// plans/layered-style-bag.md, Stage 2 — Expected Behaviour rows 4-8. Stage 1's
// layer-stack primitive (rows 1-3) is covered by `StyleLayers.test.ts`;
// meta-class layers (rows 9-13) arrive in Stage 3, with their own file.
//
// Conventions mirrored from `ClassStyleRules.test.ts`: a uniquely named local
// `Component` subclass per test (the module-level registries in
// `core/ClassStyleRules.ts` survive `DOM.reset()` within one test file), and
// a local `declarationsDuring` helper rather than an import — that file's own
// header explains why (module isolation makes sharing pointless).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component, ComponentOptions } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: Component): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map (last write per key wins, matching
 * cascade-within-a-rule semantics). Only `setRuleStyles` ops whose selector
 * (`args[0]`) matches are counted, so a framework-rule or class-rule write
 * that happens in the same window doesn't leak into a `#id`-rule assertion.
 */
function declarationsDuring(
    sink: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    const start = sink.writes.length;
    fn();

    const out: Record<string, string | null> = {};
    for (const w of sink.writes.slice(start)) {
        if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
            continue;
        }

        const styles = w.args[1] as Record<string, string | null>;
        for (const key of Object.keys(styles)) {
            out[key] = styles[key];
        }
    }

    return out;
}

/** Class-level `backgroundColor: "red"` — the same value row 4-6's
 *  construction-time / runtime writes exercise. */
class RedBgProbe extends Component {
    constructor(options?: ComponentOptions) {
        super(options, { backgroundColor: 'red' } as Partial<ComponentOptions>);
    }
}

describe('Instance style layer (Stage 2)', () => {
    it('row 4: a construction-time value equal to the class default renders no declaration at all', () => {
        const sink = DOM.sink as RecordingDOMSink;

        // Warm up the class rule with a first instance so the second one's
        // render is the one under test — mirrors ClassStyleRules.test.ts's
        // own "second instance" convention (case 14/15), which is what
        // exposes a null-bag comparison bug: the first instance to touch a
        // class always renders during the same pass that creates its rule.
        new RedBgProbe({}).getElement(true);

        const b = new RedBgProbe({ backgroundColor: 'red' });
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        // Neither a real 'red' value nor a null removal appears — the
        // construction-time setter's write matches the class default, and
        // the instance layer now exists by the time the flush compares it,
        // unlike the pre-plan null-bag comparison (see plans/implemented/
        // glyph-preferredsize-reconciled-write-path.md).
        expect(declarations.backgroundColor).toBeUndefined();
        expect(b.getBackgroundColor()).toBe('red');
    });

    it('row 5: setBackgroundColor after first render, diverging from the class default, writes a real value', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b    = new RedBgProbe({});
        b.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(b), () => b.setBackgroundColor('blue'));

        expect(declarations.backgroundColor).toBe('blue');
        expect(b.getBackgroundColor()).toBe('blue');
    });

    it('row 6: setBackgroundColor after first render, matching the class default, writes a null removal', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b    = new RedBgProbe({ backgroundColor: 'blue' });
        b.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(b), () => b.setBackgroundColor('red'));

        expect(declarations.backgroundColor).toBeNull();
        expect(b.getBackgroundColor()).toBe('red');
    });

    it('setDisplayed(true) after setDisplayed(false) removes the undisplayed token and writes no per-instance display declaration', () => {
        // `display` is a `SKIP_ON_MATCH_KEYS` member (unlike `backgroundColor`
        // in row 6 above). Originally written against `setDisplayed`'s old
        // `writeStyle`-based implementation, where hiding wrote a real
        // per-instance `display: none` onto `#id` and showing again had to
        // explicitly clear it with a matching `null` removal — the case this
        // test pinned, guarding against a pooled Table/Tree row hidden
        // mid-scroll and later re-shown getting stuck `display: none` forever.
        // component-setdisplayed-state-tier-dedup.md routes the hide leg
        // through the shared `.ts-ui-component.undisplayed` class-tier rule
        // instead, so there is no longer any per-instance `display`
        // declaration to leave stale: `setDisplayed(false)` never writes
        // `_instanceStyle` at all, so the later `setDisplayed(true)`'s
        // `writeStyle({ displayed: true })` queues only a `null` (it matches
        // the class default) onto a rule that was never materialised in the
        // first place — `StyleTarget`'s all-null-batch-never-materialises
        // rule means no CSS write happens for `display` at all. The token
        // removal below is what now carries the whole fix.
        const sink = DOM.sink as RecordingDOMSink;
        const c    = new RedBgProbe({});
        const element = c.getElement(true)!;

        c.setDisplayed(false);

        const start = sink.writes.length;
        c.setDisplayed(true);
        const writesAfter = sink.writes.slice(start);

        const removedUndisplayed = writesAfter.some(w =>
            w.op === 'apply' && w.args[0] === element
            && (w.args[1] as { removeClass?: readonly string[] }).removeClass?.includes('undisplayed')
        );
        expect(removedUndisplayed).toBe(true);
        expect(c.isDisplayed()).toBe(true);

        const displayWrites = writesAfter.filter(w =>
            w.op === 'setRuleStyles' && 'display' in (w.args[1] as Record<string, unknown>)
        );
        expect(displayWrites).toEqual([]);
    });

    it('row 7: clearOverflowX/clearOverflowY/clearOutline suppress the class default rather than re-resolving it', () => {
        class OverflowOutlineProbe extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { overflow: 'auto', outline: '1px solid red' } as Partial<ComponentOptions>);
            }
        }

        const c = new OverflowOutlineProbe({});
        c.getElement(true);

        expect(c.getOverflowX()).toBe('auto');
        expect(c.getOverflowY()).toBe('auto');
        expect(c.getOutline()).toBe('1px solid red');

        c.setOverflowX('hidden');
        expect(c.getOverflowX()).toBe('hidden');
        c.clearOverflowX();
        expect(c.getOverflowX()).toBeNull();   // not 'auto' — the class default stays suppressed

        c.setOverflowY('hidden');
        expect(c.getOverflowY()).toBe('hidden');
        c.clearOverflowY();
        expect(c.getOverflowY()).toBeNull();   // not 'auto'

        c.setOutline('2px solid blue');
        expect(c.getOutline()).toBe('2px solid blue');
        c.clearOutline();
        expect(c.getOutline()).toBeNull();   // not '1px solid red'
    });

    it('row 8: a class-default-only scrollable overflow attaches the wheel scroller on first render', () => {
        class AutoOverflowProbe extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { overflow: 'auto' } as Partial<ComponentOptions>);
            }

            exposeWheelScroller(): unknown {
                return (this as unknown as { _wheelScroller: unknown })._wheelScroller;
            }
        }

        const c = new AutoOverflowProbe({});

        expect(c.exposeWheelScroller()).toBeFalsy();   // no setter fired, no element yet

        c.getElement(true);   // render -> applyStyle -> flushStyleBag -> onStyleResolved

        // onStyleResolved fires for overflowX/overflowY even though only the
        // class tier (not this instance) supplied "auto" — the gap a
        // construction-time-only side effect would otherwise fall into.
        expect(c.exposeWheelScroller()).toBeTruthy();
    });
});
