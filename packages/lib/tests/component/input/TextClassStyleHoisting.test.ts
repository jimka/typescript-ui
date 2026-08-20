// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for plans/implemented/text-applystyle-class-hoisting.md:
// `Text.applyStyle`'s twelve font/text declarations now route through the
// same class-rule compare-and-skip mechanism as `Component`'s own chrome
// declarations (`cursor`, `outline`, `color`, …), so a `Text` with no
// per-instance font override contributes none of them to its own `#id` rule.
//
// Mirrors `tests/core/ClassStyleRules.test.ts`'s `declarationsDuring` /
// `idSelector` helpers locally rather than importing them — that file's own
// header explains why: the `.ClassName` registry in `core/ClassStyleRules.ts`
// is module state that survives `DOM.reset()` (though not a fresh test
// *file*, since Vitest isolates modules per file). `Text`'s class rule is
// shared across every `it` in this file, so the one test that inspects the
// `.Text` class rule's contents runs first, before any other `Text` render
// could have already materialised it.
//
// `textOverflow` is deliberately excluded from the "skipped" assertions below
// — see the plan's `## Implementation Notes` for why it's a documented
// exception rather than an oversight: `setTruncate` is unconditionally
// dispatched from `Text`'s constructor (needed so `whiteSpace`/`overflow`,
// which have no render-time fallback, are always set), and that dispatch
// calls the public `setTextOverflow`/`clearTextOverflow`, which queue their
// write directly — bypassing the class-rule comparison before it ever runs,
// the same pre-existing gap already shipped (untested) for `whiteSpace`/
// `overflowX`/`overflowY` under the depended-upon plan.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { Text } from '~/component/input/Text';
import { Legend } from '~/component/container/Legend';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

/** The twelve declarations `Text.applyStyle` hoists through `writeRuleDeclaration`. */
const FONT_KEYS = [
    'fontFamily', 'textAlign', 'textShadow', 'fontKerning', 'fontSize',
    'fontSizeAdjust', 'fontStretch', 'fontStyle', 'fontVariant', 'fontWeight',
    'lineHeight', 'textOverflow',
] as const;

/**
 * `FONT_KEYS` minus `textOverflow` — the subset that actually reaches a
 * skipped (absent) `#id` write for a default instance. `textOverflow` is
 * excluded here, not because its comparison is wrong, but because
 * `setTruncate`'s unconditional constructor dispatch (see the file header)
 * always pre-queues it before the comparison can run.
 */
const SKIPPABLE_FONT_KEYS = FONT_KEYS.filter((key) => key !== 'textOverflow');

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

/** Recorded `ensureStyleRule` ops for the given selector. */
function ensureStyleRuleOpsFor(sink: RecordingDOMSink, selector: string): Array<{ op: string; args: unknown[] }> {
    return sink.writes.filter((w) => w.op === 'ensureStyleRule' && w.args[0] === selector);
}

describe('Text applyStyle class-rule hoisting', () => {
    // Runs first (see file header): the only test allowed to observe the
    // `.Text` class rule's one-time creation and exact contents.
    it('a fresh Text class-rule carries all twelve declarations at the class defaults', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const a = new Text('x');
        const classDeclarations = declarationsDuring(sink, '.Text', () => a.getElement(true));

        expect(ensureStyleRuleOpsFor(sink, '.Text').length).toBe(1);
        expect(classDeclarations.fontFamily).toBe('var(--ts-ui-font-family, system-ui, sans-serif)');
        expect(classDeclarations.fontKerning).toBe('auto');
        expect(classDeclarations.fontSize).toBe('var(--ts-ui-font-size, 14px)');
        expect(classDeclarations.fontSizeAdjust).toBe('none');
        expect(classDeclarations.fontStretch).toBe('normal');
        expect(classDeclarations.fontStyle).toBe('normal');
        expect(classDeclarations.fontVariant).toBe('normal');
        expect(classDeclarations.fontWeight).toBe('normal');
        expect(classDeclarations.textAlign).toBe('left');
        expect(classDeclarations.lineHeight).toBe('calc(1em + var(--ts-ui-line-padding, 2px))');
        expect(classDeclarations.textOverflow).toBe('ellipsis');
        // No class anywhere defaults `textShadow`, so the key never enters
        // `resolveDeclarations`'s output at all — absent, not null.
        expect(classDeclarations.textShadow).toBeUndefined();
    });

    it('a fresh Text with no font/text setter called writes none of the ten skippable declarations to its own #id rule (lineHeight queues an explicit removal)', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b = new Text('x');

        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        for (const key of SKIPPABLE_FONT_KEYS) {
            if (key === 'lineHeight') continue;
            expect(declarations[key]).toBeUndefined();
        }
        expect(declarations.lineHeight).toBeNull();
    });

    it('a fresh Text still writes textOverflow to #id — the documented setTruncate exception', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b = new Text('x');

        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        // Correct value, just not skipped — see the file header and the
        // plan's `## Implementation Notes`.
        expect(declarations.textOverflow).toBe('ellipsis');
    });

    // Regression coverage for a second audit finding: `.Text`'s class rule
    // always carries `textOverflow: "ellipsis"` (every current class
    // defaults `truncate: true`), so a `truncate: false` instance must
    // actively *override* it on `#id`, not merely stop declaring it — a
    // `null`/removed `#id` declaration doesn't beat a lower-tier rule that
    // still declares the property; it just stops competing with it, so the
    // cascade would still resolve to the class rule's "ellipsis". Writing
    // the CSS initial value `"clip"` is what actually wins.
    it('a truncate:false instance overrides textOverflow on #id with the CSS initial value, not the class default ellipsis', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b = new Text('x', { truncate: false });

        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(b.getTextOverflow()).toBeNull();
        expect(declarations.textOverflow).toBe('clip');
    });

    // Regression coverage for a third audit finding: the same cascade hole
    // exists on the runtime path — `setTruncate(false)` after render calls
    // `clearTextOverflow()` directly (bypassing `applyStyle` entirely, like
    // every imperative setter), so it needs the same "clip" substitution
    // `clearTextOverflow` now makes, not just `applyStyle`'s render-time one.
    it('a post-render setTruncate(false) overrides textOverflow on #id with the CSS initial value too', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b = new Text('x');
        b.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(b), () => b.setTruncate(false));

        expect(b.getTextOverflow()).toBeNull();
        expect(declarations.textOverflow).toBe('clip');
    });

    // Regression coverage for a fourth audit finding: `clearLineClamp()` has
    // the same cascade hole — it writes `textOverflow: null` directly via
    // `setElementCSSRules`, which removes rather than overrides the `#id`
    // declaration, so a truncate:false instance clearing a line clamp would
    // silently resurface the class rule's "ellipsis" instead of the "clip"
    // getTextOverflow() === null represents.
    it('clearLineClamp overrides textOverflow on #id with the CSS initial value too', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b = new Text('x', { truncate: false });
        b.getElement(true);
        b.setLineClamp(3);

        const declarations = declarationsDuring(sink, idSelector(b), () => b.clearLineClamp());

        expect(b.getTextOverflow()).toBeNull();
        expect(declarations.textOverflow).toBe('clip');
    });

    it('a constructor-time font override lands on #id, not the class rule', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b = new Text('x', { fontWeight: 'bold' });

        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.fontWeight).toBe('bold');
    });

    // Regression coverage for the field-initializer-vs-cascade ordering bug
    // the audit found: `super()`'s `applyOptions` cascade dispatches
    // `setFontSize`/`setLineHeight` for an explicit constructor option, but
    // that runs *before* Text's own field initializers, which unconditionally
    // reset `_fontSizeCSSVar`/`_fontSizeCSSRule`/`_lineHeightCSSVar`/
    // `_lineHeightCSSRule` back to their var-binding defaults straight
    // afterwards — undoing the dispatch. Real call sites: PickerColumn.ts's
    // `PickerColumnHeader` and AbstractCalendarDropdown.ts both construct a
    // `Text` with `{ fontSize: 12 }`.
    it('a constructor-time numeric fontSize is honoured by both the getter and the render, not just one', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b = new Text('x', { fontSize: 20 });

        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(b.getFontSize()).toBe(20);
        expect(declarations.fontSize).toBe('20px');
    });

    it('a constructor-time fontSize CSS-var binding is honoured by the render, not silently reverted to the base var', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b = new Text('x', { fontSize: '--ts-ui-header-font-size' });

        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.fontSize).toBe('var(--ts-ui-header-font-size, 14px)');
    });

    it('a constructor-time numeric lineHeight is honoured by the getter and a shared value-class rule, not #id', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b = new Text('x', { lineHeight: 30 });

        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(b.getLineHeight()).toBe(30);
        // The constructor-time numeric call enters numeric mode from the
        // default additive rule, reconciling it away on #id as an explicit
        // removal (queued pre-render, flushed at this first render) — not a
        // real value, and not merely absent.
        expect(declarations.lineHeight).toBeNull();
        expect(_ruleCacheHas('.Text.lh30px')).toBe(true);
    });

    it('a pre-render setTextAlign call is honoured by the render-time rule write', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b = new Text('x');
        b.setTextAlign('center');

        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.textAlign).toBe('center');
    });

    it("Legend's #id rule is not empty even though the ten skippable font declarations are all skipped (lineHeight queues an explicit removal)", () => {
        const sink = DOM.sink as RecordingDOMSink;
        const legend = new Legend();

        const declarations = declarationsDuring(sink, idSelector(legend), () => legend.getElement(true));

        // Legend's own applyStyle override always re-asserts marginLeft, so
        // the #id rule is non-empty — proof the ten skippable keys are
        // absent because they diverge on nothing, not because no rule
        // materialised.
        expect(declarations.marginLeft).toBe('10px');
        for (const key of SKIPPABLE_FONT_KEYS) {
            if (key === 'lineHeight') continue;
            expect(declarations[key]).toBeUndefined();
        }
        expect(declarations.lineHeight).toBeNull();
    });

    it('a pre-render setLineHeight call is honoured via a shared value-class rule, tracking the exact px value', () => {
        const sink = DOM.sink as RecordingDOMSink;

        const cellText1 = new Text('42');
        cellText1.setAutoMeasure(false);
        cellText1.setLineHeight(18);
        const decl1 = declarationsDuring(sink, idSelector(cellText1), () => cellText1.getElement(true));

        // Entering numeric mode from the default additive rule reconciles it
        // away on #id as an explicit removal, not merely absent — see the
        // constructor-time numeric lineHeight test above.
        expect(decl1.lineHeight).toBeNull();
        expect(_ruleCacheHas('.Text.lh18px')).toBe(true);
        for (const key of SKIPPABLE_FONT_KEYS) {
            if (key === 'lineHeight') continue;
            expect(decl1[key]).toBeUndefined();
        }

        const cellText2 = new Text('7');
        cellText2.setAutoMeasure(false);
        cellText2.setLineHeight(24);
        const decl2 = declarationsDuring(sink, idSelector(cellText2), () => cellText2.getElement(true));

        expect(decl2.lineHeight).toBeNull();
        expect(_ruleCacheHas('.Text.lh24px')).toBe(true);
        for (const key of SKIPPABLE_FONT_KEYS) {
            if (key === 'lineHeight') continue;
            expect(decl2[key]).toBeUndefined();
        }
    });

    // Per the plan's Expected Behaviour ("Two renders of the same
    // `StringRenderer`-style `_text`, each preceded by a `setLineHeight(h)`
    // call with a different `h`"): a *second* `applyStyle` pass on the same
    // instance is the one place a stale queued declaration could linger,
    // since `writeRuleDeclaration`'s skip only prevents adding a *new*
    // redundant queue entry — it can't retract one already sitting there.
    // `CellRenderer.doLayout` itself never re-triggers `applyStyle` — it
    // calls `setLineHeight` directly, a pure setter write that always reaches
    // `#id` regardless of the class-rule tier (see `writeRuleDeclaration`'s
    // own doc comment) — so this drives `applyStyle` a second time directly,
    // stress-testing the mechanism the plan asked for rather than that one
    // call site literally.
    it('setLineHeight changing value mid-lifetime swaps the value-class token; a later applyStyle pass does not reintroduce a stale #id declaration', () => {
        const sink = DOM.sink as RecordingDOMSink;

        const cellText = new Text('42');
        cellText.setAutoMeasure(false);

        cellText.setLineHeight(40);
        const decl1 = declarationsDuring(sink, idSelector(cellText), () => cellText.getElement(true));
        // Entering numeric mode from the default additive rule reconciles it
        // away on #id as an explicit removal, not merely absent.
        expect(decl1.lineHeight).toBeNull();
        expect(_ruleCacheHas('.Text.lh40px')).toBe(true);
        for (const key of SKIPPABLE_FONT_KEYS) {
            if (key === 'lineHeight') continue;
            expect(decl1[key]).toBeUndefined();
        }

        const start = sink.writes.length;
        cellText.setLineHeight(46);
        const toggleWrite = sink.writes.slice(start).find((w: any) => w.op === 'apply' && (w.args[1] as { addClass?: unknown }).addClass);
        expect(toggleWrite).toBeDefined();
        expect((toggleWrite!.args[1] as { addClass: string[] }).addClass).toEqual(['lh46px']);
        expect((toggleWrite!.args[1] as { removeClass: string[] }).removeClass).toEqual(['lh40px']);

        const element = cellText.getElement()!;
        const decl2 = declarationsDuring(sink, idSelector(cellText), () => cellText.applyStyle(element));

        expect(decl2.lineHeight).toBeUndefined();
        for (const key of SKIPPABLE_FONT_KEYS) {
            if (key === 'lineHeight') continue;
            expect(decl2[key]).toBeUndefined();
        }
    });

    it('a custom fontSize CSS var diverges from the class default and keeps writing to #id', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b = new Text('x');
        b.setFontSize('--ts-ui-header-font-size');

        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.fontSize).toBe('var(--ts-ui-header-font-size, 14px)');
        for (const key of SKIPPABLE_FONT_KEYS) {
            if (key === 'fontSize' || key === 'lineHeight') continue;
            expect(declarations[key]).toBeUndefined();
        }
        expect(declarations.lineHeight).toBeNull();
    });
});
