// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for plans/text-input-class-tier-migration.md — dedups
// TextInput's font baseline (and the two right-aligned inner fields' textAlign,
// and TextArea's resize) onto the hierarchy-aware class tier. Covers Expected
// Behaviour rows 1-8 (rows 9-12 are manual-verify, browser-only).
//
// Conventions mirrored from `ClassHierarchyCascade.test.ts` (the mechanism's
// own coverage): `declarationsDuring`/`idSelector` copied verbatim below. But
// unlike that file's locally-scoped Probe classes, these tests exercise the
// real, already-named production classes (TextField, TextArea, NumberSpinner,
// ...) — so `resolveClassLevel`'s per-ctor memoization (core/ClassStyleRules.ts)
// means a class's shared `.ClassName` rule content is written only on the
// FIRST construction+render of that class (or any of its subclasses) anywhere
// in this file, module state that (like `_ruleCache`) survives `DOM.reset()`
// between tests. The row-3 test below therefore MUST run before any other
// test constructs a TextInput-family component — it is the one that captures
// `.TextInput`'s one-time content write — and rows 5/6 each capture their
// `.NumberSpinnerField` / `.NumberEditorField` content on that class's own
// first construction, for the same reason. Every other row only inspects a
// component's own `#id` rule, which is written on every render regardless of
// priming, so those need no such ordering (though each still measures a
// *second* instance, after a first throwaway, matching this repo's estab-
// lished convention — see `CellTextSelection.test.ts`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { TextField } from '~/component/input/TextField';
import { TextArea } from '~/component/input/TextArea';
import { DateField } from '~/component/input/DateField';
import { NumberSpinner } from '~/component/input/NumberSpinner';
import { NumberEditor } from '~/component/table/cell/editor/Number';
import { PasswordField } from '~/component/input/PasswordField';
import { UsernameField } from '~/component/input/UsernameField';
import { ComboBox } from '~/component/input/ComboBox';
import { AutoCompleteField } from '~/component/input/AutoCompleteField';
import { COMPONENT_CLASS, TRAIT_CLASS_PREFIX } from '~/core/ClassStyleRules';

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

/**
 * Same as {@link declarationsDuring}, but for several selectors captured
 * from one `fn()` run — needed when two selectors' one-time content writes
 * (e.g. `.TextInput` and the shared trait rule) both land during the same,
 * file-wide-first render.
 */
function declarationsDuringMulti(
    sink: RecordingDOMSink,
    selectors: readonly string[],
    fn: () => void,
): Record<string, Record<string, string | null>> {
    const start = sink.writes.length;
    fn();

    const out: Record<string, Record<string, string | null>> = {};
    for (const selector of selectors) {
        out[selector] = {};
    }

    for (const w of sink.writes.slice(start)) {
        if (w.op !== 'setRuleStyles' || !selectors.includes(w.args[0] as string)) {
            continue;
        }

        const styles = w.args[1] as Record<string, string | null>;
        for (const key of Object.keys(styles)) {
            out[w.args[0] as string][key] = styles[key];
        }
    }

    return out;
}

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/** The non-null (real) entries of a declarations map. */
function realDeclarations(declarations: Record<string, string | null>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(declarations)) {
        if (value !== null) {
            out[key] = value;
        }
    }

    return out;
}

describe('TextInput class-tier style migration', () => {
    it('row 3: the shared .TextInput class rule carries the font baseline alongside its chrome, but no longer the border/borderRadius pair (moved onto the input-chrome trait)', () => {
        // Must be the first TextInput-family construction+render in this file
        // — see the file banner comment. Both `.TextInput`'s and the shared
        // trait rule's one-time content writes land during this same render,
        // so both are captured from the one `declarationsDuringMulti` call.
        const sink           = DOM.sink as RecordingDOMSink;
        const traitSelector  = `.${COMPONENT_CLASS}.${TRAIT_CLASS_PREFIX}input-chrome`;
        const byS = declarationsDuringMulti(sink, ['.TextInput', traitSelector], () => new TextField().getElement(true));

        expect(byS['.TextInput'].fontFamily).toBe('var(--ts-ui-font-family, sans-serif)');
        expect(byS['.TextInput'].fontSize).toBe('var(--ts-ui-font-size, 14px)');
        expect(byS['.TextInput'].lineHeight).toBe('calc(1em + var(--ts-ui-line-padding, 2px))');
        expect(byS['.TextInput'].backgroundColor).toBe('var(--ts-ui-input-bg, rgb(255, 255, 255))');
        expect(byS['.TextInput'].borderTop).toBeUndefined();
        expect(byS['.TextInput'].borderRadius).toBeUndefined();

        expect(realDeclarations(byS[traitSelector]).borderTop).toBe('var(--ts-ui-input-border)');
        expect(realDeclarations(byS[traitSelector]).borderRadius).toBe('var(--ts-ui-border-radius, 4px)');
    });

    it('row 1: a TextField renders with no font declaration on its own #id rule', () => {
        new TextField().getElement(true); // throwaway, primes .TextField

        const sink = DOM.sink as RecordingDOMSink;
        const field = new TextField();
        const declarations = declarationsDuring(sink, idSelector(field), () => field.getElement(true));
        const real = realDeclarations(declarations);

        // Since plans/abstractinput-height-value-class-mechanism.md, the
        // min-height/max-height pair this test used to find here is deduped
        // onto a shared `.TextField.h<h>px` value-class rule instead, so
        // `#id` carries no real declaration at all.
        expect(Object.keys(real)).toEqual([]);
        expect(declarations.fontFamily).toBeUndefined();
        expect(declarations.fontSize).toBeUndefined();
        expect(declarations.lineHeight).toBeUndefined();
    });

    it('row 2: a TextArea renders with no real declaration at all on its own #id rule', () => {
        new TextArea().getElement(true); // throwaway, primes .TextArea

        const sink = DOM.sink as RecordingDOMSink;
        const area = new TextArea();
        const declarations = declarationsDuring(sink, idSelector(area), () => area.getElement(true));

        expect(realDeclarations(declarations)).toEqual({});
    });

    it('row 4: a DateField\'s inner PickerInput renders padding plus a genuine border override on its own #id rule', () => {
        new DateField().getElement(true); // throwaway, primes .DateField / .PickerInput

        const sink = DOM.sink as RecordingDOMSink;
        const field = new DateField();
        const input = (field as any)._input;
        const declarations = declarationsDuring(sink, idSelector(input), () => field.getElement(true));

        // PickerInput's own class-tier `border: "none"` is dispatched to
        // `setBorder` as an authored instance value (see PickerInput.ts and
        // plans/cross-class-style-groups.md's worked example). Before this
        // plan, that "none" matched PickerInput's own `.PickerInput` class
        // rule and was skipped; now the trait layer it inherits from
        // TextInput (`border: var(--ts-ui-input-border)`) outranks the class
        // tier and is checked first, so "none" genuinely deviates and writes
        // for real — the trait outranking the class tier by specificity
        // means a class-tier override alone can no longer suppress it.
        expect(realDeclarations(declarations)).toEqual({
            padding:      '0px 3px 0px 3px',
            borderTop:    'none',
            borderRight:  'none',
            borderBottom: 'none',
            borderLeft:   'none',
        });
    });

    it('row 5: NumberSpinner\'s inner field has no per-instance textAlign/border/borderRadius/outline, and .NumberSpinnerField carries exactly seven declarations', () => {
        const sink = DOM.sink as RecordingDOMSink;

        // First-ever NumberSpinner construction+render in this file: captures
        // .NumberSpinnerField's one-time content write — see the file banner.
        const primer = new NumberSpinner();
        const classDeclarations = declarationsDuring(sink, '.NumberSpinnerField', () => primer.getElement(true));
        expect(realDeclarations(classDeclarations)).toEqual({
            textAlign:    'right',
            borderTop:    'none',
            borderRight:  'none',
            borderBottom: 'none',
            borderLeft:   'none',
            borderRadius: '0',
            outline:      'none',
        });

        const spinner = new NumberSpinner();
        const input = (spinner as any)._input;
        const idDeclarations = declarationsDuring(sink, idSelector(input), () => spinner.getElement(true));
        expect(idDeclarations.textAlign).toBeUndefined();
        // border/borderRadius are dispatched instance values (from
        // NumberSpinnerField's own class-tier defaults) that now genuinely
        // deviate from the input-chrome trait NumberSpinnerField inherits
        // through TextField/TextInput — see row 4's comment above for why.
        // `outline` was never dispatched to an instance setter (it isn't one
        // of `applyChromeOptions`'s four fields) and isn't a trait property,
        // so it stays undeclared on #id exactly as before.
        expect(realDeclarations(idDeclarations).borderTop).toBe('none');
        expect(realDeclarations(idDeclarations).borderRadius).toBe('0');
        expect(realDeclarations(idDeclarations).outline).toBeUndefined();
    });

    it('row 6: NumberEditor\'s inner field has no per-instance textAlign, and .NumberEditorField carries exactly one declaration', () => {
        const sink = DOM.sink as RecordingDOMSink;

        // First-ever NumberEditor construction+render in this file: captures
        // .NumberEditorField's one-time content write — see the file banner.
        const primer = new NumberEditor();
        const classDeclarations = declarationsDuring(sink, '.NumberEditorField', () => primer.getElement(true));
        expect(realDeclarations(classDeclarations)).toEqual({ textAlign: 'right' });

        const editor = new NumberEditor();
        const textField = (editor as any)._textField;
        const idDeclarations = declarationsDuring(sink, idSelector(textField), () => editor.getElement(true));
        expect(idDeclarations.textAlign).toBeUndefined();
    });

    it('row 7: an unrendered inner field resolves textAlign from the class tier with no CSS involved', () => {
        expect((new NumberSpinner() as any)._input.getTextAlign()).toBe('right');
        expect((new NumberEditor() as any)._textField.getTextAlign()).toBe('right');
        expect(new TextField().getTextAlign()).toBe(null);
    });

    it('row 8: a genuine per-instance textAlign override still wins on the instance\'s own #id rule', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const field = new TextField().setTextAlign('center');
        const declarations = declarationsDuring(sink, idSelector(field), () => field.getElement(true));

        expect(declarations.textAlign).toBe('center');
    });

    it('a new .AutoCompleteTextField class rule carries the borderless chrome, and AutoCompleteField\'s inner field has none of it on its own #id rule', () => {
        const sink = DOM.sink as RecordingDOMSink;

        // First-ever AutoCompleteField construction+render in this file: captures
        // .AutoCompleteTextField's one-time content write — see the file banner.
        // MUST run before the leaf-ordering test below, which also renders an
        // AutoCompleteField inner field and would otherwise consume this
        // class rule's one-time content write first.
        const primer = new AutoCompleteField();
        const classDeclarations = declarationsDuring(sink, '.AutoCompleteTextField', () => primer.getElement(true));
        expect(realDeclarations(classDeclarations)).toEqual({
            borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none',
            borderRadius: '0',
            outline: 'none',
        });

        const field = new AutoCompleteField();
        const textField = (field as any)._textField;
        const idDeclarations = declarationsDuring(sink, idSelector(textField), () => field.getElement(true));
        // border/borderRadius are dispatched instance values that now
        // genuinely deviate from the input-chrome trait AutoCompleteTextField
        // inherits through TextField/TextInput — see row 4's comment above.
        // `outline` stays undeclared on #id exactly as before (see row 5's
        // comment on why).
        expect(realDeclarations(idDeclarations).borderTop).toBe('none');
        expect(realDeclarations(idDeclarations).borderRadius).toBe('0');
        expect(realDeclarations(idDeclarations).outline).toBeUndefined();
    });

    it('every single-line AbstractInput leaf writes its min-height/max-height pair per its opt-in status', () => {
        // Since plans/abstractinput-height-value-class-mechanism.md,
        // TextField/ComboBox/NumberSpinner (and every TextField subclass,
        // e.g. the NumberSpinner/AutoCompleteField inner fields) dedup their
        // height pair onto a shared `.ClassName.h<h>px` value-class rule
        // instead of `#id`. PasswordField and UsernameField now extend
        // TextField (plans/implemented/credential-field-and-input-updateheight-dedup.md)
        // and inherit its `updateHeight`, so they dedupe the same way.
        // AbstractPickerField (DateField's own `updateHeight`) is the one
        // leaf still held back — so it keeps writing the real pair straight
        // to `#id`, in the order plans/implemented/abstractinput-height-dedup.md
        // fixed.
        const sink = DOM.sink as RecordingDOMSink;

        const leaves: Array<[string, () => { getElement(createIfMissing?: boolean): unknown; getId(): string }, string[]]> = [
            ['TextField',                     () => new TextField(),                                     []],
            ['PasswordField',                 () => new PasswordField(),                                 []],
            ['UsernameField',                 () => new UsernameField(),                                 []],
            ['ComboBox',                      () => new ComboBox(),                                      []],
            ['DateField',                     () => new DateField(),                                     ['maxHeight', 'minHeight']],
            ['NumberSpinner inner field',     () => (new NumberSpinner() as any)._input,                 []],
            ['AutoCompleteField inner field', () => (new AutoCompleteField() as any)._textField,          []],
        ];

        for (const [label, make, expected] of leaves) {
            (make() as any).getElement(true); // throwaway, primes this class's shared rule

            const instance = make() as any;
            const declarations = declarationsDuring(sink, idSelector(instance), () => instance.getElement(true));
            const heightKeys   = Object.keys(realDeclarations(declarations))
                .filter((k) => k === 'minHeight' || k === 'maxHeight');

            expect(heightKeys, label).toEqual(expected);
        }
    });

    it('an unrendered NumberSpinner inner field resolves border/borderRadius/outline from the class tier with no CSS involved (regression guard — already true before this plan, via the imperative setter)', () => {
        const input = (new NumberSpinner() as any)._input;
        expect(input.getBorder()).toEqual({ border: 'none' });
        expect(input.getBorderRadius()).toBe('0');
        expect(input.getOutline()).toBe('none');
    });

    it('an unrendered AutoCompleteField inner field resolves border/borderRadius/outline from the class tier with no CSS involved', () => {
        const field = (new AutoCompleteField() as any)._textField;
        expect(field.getBorder()).toEqual({ border: 'none' });
        expect(field.getBorderRadius()).toBe('0');
        expect(field.getOutline()).toBe('none');
    });
});
