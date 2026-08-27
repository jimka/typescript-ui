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
// After plans/implemented/text-truncate-write-path-cleanup.md, `whiteSpace`,
// `textOverflow`, and `lineHeight` are the three keys the render phase
// reconciles to an explicit removal instead of skipping. On an instance
// whose `#id` rule materialises — something real is queued for it in the
// same batch — each reads `null`. On an instance whose rule never
// materialises, no write is recorded at all and each reads `undefined`.
// Every other font key is skipped outright and reads `undefined` either way.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { Text } from '~/component/input/Text';
import { Legend } from '~/component/container/Legend';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import type { StyleBag } from '~/core/ClassStyleRules';

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
 * `FONT_KEYS` minus `lineHeight` and `textOverflow` — the ten keys that are
 * skipped outright (never reconciled to an explicit removal). `lineHeight`
 * and `textOverflow` are excluded here because both are reconciled to `null`
 * rather than skipped — see the file header.
 */
const SKIPPABLE_FONT_KEYS = FONT_KEYS.filter((key) => key !== 'lineHeight' && key !== 'textOverflow');

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

/**
 * The `addClass`/`removeClass` patches from `apply` writes targeting
 * `element` — the class-toggle side of `setValueStyleState`/
 * `clearValueStyleState`. Mirrors `TextLineHeightValueClassSharing.test.ts`'s
 * own `classToggleWrites`, scoped to one element's own writes.
 */
function classToggleWritesFor(
    writes: RecordingDOMSink['writes'],
    element: unknown,
): Array<{ removeClass?: string[]; addClass?: string[] }> {
    return writes
        .filter((w) => w.op === 'apply' && w.args[0] === element)
        .map((w) => w.args[1] as { removeClass?: string[]; addClass?: string[] })
        .filter((patch) => patch.addClass !== undefined || patch.removeClass !== undefined);
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

    // `textOverflow` now reconciles before `applyStyle`'s one render-time
    // flush (see plans/implemented/applystyle-flush-order-empty-rule-fix.md),
    // so with no other real deviation queued, the `#id` rule never
    // materialises at all.
    it('a fresh Text with no font/text setter called writes nothing to its own #id rule — no rule materialises at all', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b = new Text('x');

        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations).toEqual({});
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

        // `writeGuardedCSSRule` (which `textOverflow`'s reconciliation routes
        // through) now isolates onto `#id:not(.undisplayed):not(.invisible)`
        // rather than the bare `#id` rule: `Component`'s own
        // `.undisplayed`/`.invisible` states (the state-tier dedup plans)
        // make `isRestingChromeIsolated()` true for every class, `Text`
        // included, even though neither state shares a property with
        // `textOverflow` — see those plans' Potential Challenges /
        // Implementation Notes. `:not(.undisplayed):not(.invisible)` still
        // beats the class-tier rule and still matches a non-hidden instance,
        // so the override still wins the cascade; only the selector moved.
        const declarations = declarationsDuring(sink, idSelector(b) + ':not(.undisplayed):not(.invisible)', () => b.getElement(true));

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

        // See the construction-time case above for why this is now
        // `:not(.undisplayed):not(.invisible)`, not the bare `#id` selector.
        const declarations = declarationsDuring(sink, idSelector(b) + ':not(.undisplayed):not(.invisible)', () => b.setTruncate(false));

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
        // default additive rule, and textOverflow reconciles too — with no
        // other real deviation queued, the #id rule never materialises at
        // all (see plans/implemented/applystyle-flush-order-empty-rule-fix.md).
        expect(declarations).toEqual({});
        expect(_ruleCacheHas('.Text.lh30px')).toBe(true);
    });

    it('a pre-render setTextAlign call is honoured by the render-time rule write', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const b = new Text('x');
        b.setTextAlign('center');

        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.textAlign).toBe('center');
    });

    it("Legend's #id rule never materialises: the ten skippable font declarations are skipped and marginLeft now lives on .Legend", () => {
        const sink = DOM.sink as RecordingDOMSink;
        const legend = new Legend();

        const declarations = declarationsDuring(sink, idSelector(legend), () => legend.getElement(true));

        // `marginLeft` moved onto the shared `.Legend` class rule (see
        // plans/implemented/legend-margin-left-dedup.md), so no real
        // deviation is left queued for the #id rule; with the ten skippable
        // font keys skipped and lineHeight/textOverflow reconciling to
        // null-only removals, the whole batch never materialises (see
        // plans/implemented/applystyle-flush-order-empty-rule-fix.md) — the
        // #id rule is empty, matching the plain-`Text` case above.
        expect(declarations).toEqual({});
    });

    it('a pre-render setLineHeight call is honoured via a shared value-class rule, tracking the exact px value', () => {
        const sink = DOM.sink as RecordingDOMSink;

        const cellText1 = new Text('42');
        cellText1.setAutoMeasure(false);
        cellText1.setLineHeight(18);
        const decl1 = declarationsDuring(sink, idSelector(cellText1), () => cellText1.getElement(true));

        // Entering numeric mode from the default additive rule, and
        // textOverflow reconciling too, leaves no other real deviation
        // queued — the #id rule never materialises at all.
        expect(Object.keys(decl1)).toEqual([]);
        expect(_ruleCacheHas('.Text.lh18px')).toBe(true);

        const cellText2 = new Text('7');
        cellText2.setAutoMeasure(false);
        cellText2.setLineHeight(24);
        const decl2 = declarationsDuring(sink, idSelector(cellText2), () => cellText2.getElement(true));

        expect(Object.keys(decl2)).toEqual([]);
        expect(_ruleCacheHas('.Text.lh24px')).toBe(true);
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
        // Entering numeric mode from the default additive rule, and
        // textOverflow reconciling too, leaves no other real deviation
        // queued — the #id rule never materialises at all.
        expect(Object.keys(decl1)).toEqual([]);
        expect(_ruleCacheHas('.Text.lh40px')).toBe(true);

        const start = sink.writes.length;
        cellText.setLineHeight(46);
        const toggleWrite = sink.writes.slice(start).find((w: any) => w.op === 'apply' && (w.args[1] as { addClass?: unknown }).addClass);
        expect(toggleWrite).toBeDefined();
        expect((toggleWrite!.args[1] as { addClass: string[] }).addClass).toEqual(['lh46px']);
        expect((toggleWrite!.args[1] as { removeClass: string[] }).removeClass).toEqual(['lh40px']);

        const element = cellText.getElement()!;
        const decl2 = declarationsDuring(sink, idSelector(cellText), () => cellText.applyStyle(element));

        // lineHeight specifically (not textOverflow, which reconciles
        // unconditionally on every render): its own reconcile is guarded by
        // `_lineHeightCSSRule`, which numeric mode already left null, so no
        // write is attempted for this key on this second pass.
        expect(decl2.lineHeight).toBeUndefined();
        for (const key of SKIPPABLE_FONT_KEYS) {
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
            if (key === 'fontSize') continue;
            expect(declarations[key]).toBeUndefined();
        }
        expect(declarations.lineHeight).toBeNull();
        expect(declarations.textOverflow).toBeNull();
    });

    // Stage 4 (plans/layered-style-bag.md) Expected Behaviour rows 14-15.
    it('row 14: a subclass whose class default supplies fontSize, with a constructor-time setFontSize call to the same value, emits no fontSize declaration and declares no applySubclassStyles override of its own', () => {
        const ROW14_FONT_SIZE_VAR  = '--row14-font-size';
        const ROW14_FONT_SIZE_RULE = `var(${ROW14_FONT_SIZE_VAR}, 14px)`;

        class Row14Text extends Text {
            protected static readonly ownClassStyleDefaults: StyleBag = {
                font: { ...Text.ownClassStyleDefaults.font, fontSize: ROW14_FONT_SIZE_RULE },
            };

            constructor() {
                super();
                this.setFontSize(ROW14_FONT_SIZE_VAR);
            }
        }

        // Mirrors the plan's Architecture Decisions: `ButtonLabelText`/
        // `HeaderCellText` used to need an `applySubclassStyles` override
        // purely to re-queue this exact same-value fontSize through the
        // reconciled path once their class rule existed (see
        // plans/implemented/*); `flushStyleBag`'s generic per-key
        // comparison — which runs once the class layer is guaranteed
        // resolved, not at construction time — makes that workaround
        // unnecessary, so this subclass needs none of its own either.
        expect(Object.prototype.hasOwnProperty.call(Row14Text.prototype, 'applySubclassStyles')).toBe(false);

        const sink = DOM.sink as RecordingDOMSink;
        const a = new Row14Text();
        const declarations = declarationsDuring(sink, idSelector(a), () => a.getElement(true));

        expect(declarations.fontSize).toBeUndefined();
        expect(a.getFontSize()).toBe(14);
    });

    it("row 15: two Text instances of one concrete class set to the same numeric line-height share one .ClassName.lh<value> rule and both carry the token; switching one to a CSS-var line-height removes only that instance's token", () => {
        class Row15Text extends Text {}

        const sink = DOM.sink as RecordingDOMSink;

        const a = new Row15Text('a');
        a.getElement(true);
        const startA = sink.writes.length;
        a.setLineHeight(21);
        expect(classToggleWritesFor(sink.writes.slice(startA), a.getElement())).toEqual([{ removeClass: [], addClass: ['lh21px'] }]);

        const b = new Row15Text('b');
        b.getElement(true);
        const startB = sink.writes.length;
        b.setLineHeight(21);
        expect(classToggleWritesFor(sink.writes.slice(startB), b.getElement())).toEqual([{ removeClass: [], addClass: ['lh21px'] }]);

        expect(_ruleCacheHas('.Row15Text.lh21px')).toBe(true);

        const startSwitch = sink.writes.length;
        a.setLineHeight('--row15-var');
        const switchWrites = sink.writes.slice(startSwitch);

        // Only `a`'s own element loses the token — `b`'s write is untouched.
        expect(classToggleWritesFor(switchWrites, a.getElement())).toEqual([{ removeClass: ['lh21px'] }]);
        expect(classToggleWritesFor(switchWrites, b.getElement())).toEqual([]);
    });
});
