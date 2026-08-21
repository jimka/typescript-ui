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
    // The plan's row 1 predicted the #id rule would never materialise at all
    // for a bare Text. That does not hold: `setTruncate`'s unconditional
    // constructor-time dispatch (`applyOptions`, inside `super()`) calls the
    // public `setTextOverflow("ellipsis")` before `_inheritedStyleBag`
    // exists, so it queues "ellipsis" as a real value. `whiteSpace`'s
    // matching construction-time queue is corrected in time because its
    // render-phase fix (`applyMiscInlineStyles`) is one of `Component`'s own
    // `applyStyle` phases, sharing the same flush boundary as the
    // construction-time write. `textOverflow`'s render-phase fix lives in
    // `Text.applyStyle`, which — per the depended-upon
    // text-applystyle-class-hoisting plan's "Text.applyStyle flushes twice"
    // — runs (and flushes) *after* `super.applyStyle()`'s own
    // `materialiseStyleRule()` call already saw the stale "ellipsis" as real
    // and inserted the rule. The correction still lands (both declarations
    // end up null, not a stale real value — verified below), but the #id
    // rule itself, now empty, still gets inserted. See the plan's
    // Implementation Notes for the full analysis; closing this needs a
    // genuine design decision (exposing `_inheritedStyleBag` to a subclass,
    // or reordering `Text.applyStyle`), out of scope for this plan's
    // mechanical write-path routing.
    it('a fresh Text with no font override queues only removals — the #id rule still materialises empty', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const t = new Text('x');

        const declarations = declarationsDuring(sink, idSelector(t), () => t.getElement(true));

        expect(Object.values(declarations).every((v) => v === null)).toBe(true);
        expect(declarations.whiteSpace).toBeNull();
        expect(declarations.textOverflow).toBeNull();
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

        const declarations = declarationsDuring(sink, idSelector(t), () => t.getElement(true));

        expect(t.getTextOverflow()).toBeNull();
        expect(declarations.textOverflow).toBe('clip');
    });

    it('setTruncate(false) on an already-rendered instance writes a real textOverflow: clip', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const t = new Text('x', { fontWeight: 'bold' });
        t.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(t), () => t.setTruncate(false));

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
    // instead of the stale `"nowrap"`. That step was not implemented — see
    // the plan's Implementation Notes: `clearWhiteSpace()` also resets the
    // `_whiteSpace` field, which silently drops an explicit `whiteSpace`
    // option the caller passed alongside `truncate: false` (`applyOptions`
    // dispatches `setWhiteSpace` before `setTruncate`), permanently losing a
    // caller-requested value like `'normal'` instead of just leaving a
    // getter briefly stale. `getWhiteSpace()` keeps reporting the
    // pre-existing stale `"nowrap"` after `setTruncate(false)`, unchanged
    // from before this plan.
    it('getWhiteSpace() keeps the pre-existing stale nowrap after setTruncate(false) — step 6 was not implemented', () => {
        const t = new Text('x', { truncate: false });

        expect(t.getWhiteSpace()).toBe('nowrap');
    });
});
