// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for plans/in-progress/text-truncate-write-path-cleanup.md:
// `Text.setTruncate()` — dispatched unconditionally from `applyOptions` on
// every construction — used to drive two raw, uncompared writes
// (`setWhiteSpace`, `setTextOverflow`) that queued
// `white-space: nowrap; text-overflow: ellipsis` onto nearly every `Text`
// instance's own `#id` rule, even though both values are already supplied by
// lower tiers (the framework-wide rule and `.Text`'s own class rule). This
// plan routes both properties through the reconciled write path
// (`setReconciledCSSRules` / `reconcileRuleDeclaration`) already used for
// `backgroundColor`/`backgroundImage`/`boxShadow`/`border`/`borderRadius`/
// `overflow`.
//
// Mirrors `TextClassStyleHoisting.test.ts`'s `declarationsDuring` /
// `idSelector` helpers locally rather than importing them — that file's own
// header explains why: the `.ClassName` registry in `core/ClassStyleRules.ts`
// is module state that survives `DOM.reset()` (though not a fresh test
// *file*, since Vitest isolates modules per file).
//
// Observation rule (see the plan's `## Expected Behaviour`): the `#id` rule
// only materialises once something real is queued for it in the same batch,
// so a case asserting a recorded removal gives the instance a real deviating
// declaration first (`{ fontWeight: 'bold' }` is the cheapest).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { Text } from '~/component/input/Text';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map (last write per key wins, matching
 * cascade-within-a-rule semantics). Only `setRuleStyles` ops whose selector
 * (`args[0]`) matches are counted.
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

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: Component): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

describe('Text truncate write-path cleanup', () => {
    // plans/implemented/applystyle-flush-order-empty-rule-fix.md closes the
    // ordering gap this comment used to describe: `Text`'s font/text
    // declarations (including `textOverflow`'s correction) now queue via
    // `Component.applyStyle`'s `applySubclassStyles` hook, before that
    // method's one and only flush — not after a second flush of `Text`'s
    // own. A construction-time real value later corrected to a
    // class-tier-matching removal is corrected in time, so the #id rule for
    // a plain `Text` is never materialised at all.
    it('a fresh Text with no font override never materialises its own #id rule', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const t = new Text('x');

        const declarations = declarationsDuring(sink, idSelector(t), () => t.getElement(true));

        expect(declarations).toEqual({});
    });

    it('a fresh Text with a real font override materialises #id with whiteSpace/textOverflow as removals', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const t = new Text('x', { fontWeight: 'bold' });

        const declarations = declarationsDuring(sink, idSelector(t), () => t.getElement(true));

        expect(declarations.fontWeight).toBe('bold');
        expect(declarations.whiteSpace).toBeNull();
        expect(declarations.textOverflow).toBeNull();
    });

    it('a truncate:false Text writes a real textOverflow: clip to #id', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const t = new Text('x', { truncate: false });

        // `writeGuardedCSSRule` (which `textOverflow`'s reconciliation routes
        // through) now isolates onto `#id:not(.undisplayed):not(.invisible)`
        // rather than the bare `#id` rule: `Component`'s own
        // `.undisplayed`/`.invisible` states (the state-tier dedup plans)
        // make `isRestingChromeIsolated()` true for every class, `Text`
        // included, even though neither state shares a property with
        // `textOverflow`. `:not(.undisplayed):not(.invisible)` still beats
        // the class-tier rule and still matches a non-hidden instance, so
        // the override still wins the cascade; only the selector moved.
        const declarations = declarationsDuring(sink, idSelector(t) + ':not(.undisplayed):not(.invisible)', () => t.getElement(true));

        expect(t.getTextOverflow()).toBeNull();
        expect(declarations.textOverflow).toBe('clip');
    });

    it('setTruncate(false) on an already-rendered instance writes a real textOverflow: clip', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const t = new Text('x', { fontWeight: 'bold' });
        t.getElement(true);

        // See the construction-time case above for why this is now
        // `:not(.undisplayed):not(.invisible)`, not the bare `#id` selector.
        const declarations = declarationsDuring(sink, idSelector(t) + ':not(.undisplayed):not(.invisible)', () => t.setTruncate(false));

        expect(declarations.textOverflow).toBe('clip');
    });

    it('setWhiteSpace on an already-rendered instance reconciles a matching value to a removal, and a deviating one for real', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const t = new Text('x', { fontWeight: 'bold' });
        t.getElement(true);

        const matching = declarationsDuring(sink, idSelector(t), () => t.setWhiteSpace('nowrap'));
        expect(matching.whiteSpace).toBeNull();

        const deviating = declarationsDuring(sink, idSelector(t), () => t.setWhiteSpace('normal'));
        expect(deviating.whiteSpace).toBe('normal');
    });

    it('setTextOverflow reconciles a matching value to a removal, and a deviating one for real', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const t = new Text('x', { fontWeight: 'bold' });
        t.getElement(true);

        const matching = declarationsDuring(sink, idSelector(t), () => t.setTextOverflow('ellipsis'));
        expect(matching.textOverflow).toBeNull();

        const deviating = declarationsDuring(sink, idSelector(t), () => t.setTextOverflow('clip'));
        expect(deviating.textOverflow).toBe('clip');
    });

    it('clearTextOverflow() after an explicit clip override writes a removal, resolving back to the class ellipsis', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const t = new Text('x', { fontWeight: 'bold' });
        t.getElement(true);
        t.setTextOverflow('clip');

        const declarations = declarationsDuring(sink, idSelector(t), () => t.clearTextOverflow());

        expect(t.getTextOverflow()).toBe('ellipsis');
        expect(declarations.textOverflow).toBeNull();
    });

    it('a bare Component writes no whiteSpace entry to #id — control confirming the base-class change costs it nothing', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const c = new Component();

        const declarations = declarationsDuring(sink, idSelector(c), () => c.getElement(true));

        expect(declarations.whiteSpace).toBeUndefined();
    });

    // The plan's step 6 proposed routing this branch through
    // `clearWhiteSpace()` so `getWhiteSpace()` would read `null` here
    // instead of the stale `"nowrap"`. That step was not implemented at the
    // time — see the plan's Implementation Notes: `clearWhiteSpace()` also
    // reset the `_whiteSpace` field, which would have silently dropped an
    // explicit `whiteSpace` option the caller passed alongside
    // `truncate: false` (`applyOptions` dispatches `setWhiteSpace` before
    // `setTruncate`), permanently losing a caller-requested value like
    // `'normal'` instead of just leaving a getter briefly stale.
    //
    // plans/implemented/layered-style-bag.md resolves this for free: the
    // hardcoded `this._whiteSpace = "nowrap"` constructor seed that caused
    // the staleness is gone (the framework tier supplies that baseline via
    // CSS instead — see its Stage 2), and `getWhiteSpace()` now reads the
    // instance style layer, which `setTruncate(false)`'s raw
    // `setElementCSSRule("whiteSpace", null)` bypass never touches. So a
    // never-set `whiteSpace` now correctly reads `null` (no stale leftover)
    // while a caller's explicit override survives untouched — the exact
    // guarantee step 6's rejected `clearWhiteSpace()` approach couldn't make.
    it('getWhiteSpace() reads null (no stale leftover) after setTruncate(false), with no caller override', () => {
        const t = new Text('x', { truncate: false });

        expect(t.getWhiteSpace()).toBeNull();
    });

    it('getWhiteSpace() preserves a caller-supplied whiteSpace option across setTruncate(false)', () => {
        const t = new Text('x', { whiteSpace: 'normal', truncate: false });

        expect(t.getWhiteSpace()).toBe('normal');
    });
});
