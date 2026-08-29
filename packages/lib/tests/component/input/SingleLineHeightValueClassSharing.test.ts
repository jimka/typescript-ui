// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for
// plans/abstractinput-height-value-class-mechanism.md: TextField, ComboBox
// and NumberSpinner's `updateHeight` now points each instance at a shared
// `.ClassName.h<value>px` rule (via `AbstractInput.pinSingleLineBoxHeight` ->
// `Component.setValueStyleState`) instead of writing its own `min-height`/
// `max-height` pair straight to its `#id` rule. Nothing about the resolved
// size getters changes — only which CSS rule supplies the declaration. See
// the plan's Expected Behaviour table for the row numbering this file
// follows.
//
// idSelector/declarationsIn/declarationsDuring copied locally, matching
// TextLineHeightValueClassSharing.test.ts's convention (see that file's
// header for why this is copied rather than imported — the `.ClassName`/
// state-rule registries in `core/ClassStyleRules.ts` are module state that
// survives `DOM.reset()` within one test file).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TextField } from '~/component/input/TextField';
import { ComboBox } from '~/component/input/ComboBox';
import { NumberSpinner } from '~/component/input/NumberSpinner';
import { PasswordField } from '~/component/input/PasswordField';
import { UsernameField } from '~/component/input/UsernameField';
import { DateField } from '~/component/input/DateField';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { ThemeManager, DarkTheme, ModernTheme } from '~/core/Theme';
import { UNBOUNDED } from '~/primitive/Size';

const themeVars: Record<string, string> = {};

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars,
};

// Every component a test constructs is tracked here and disposed in
// `afterEach`, regardless of whether the test's own assertions throw first —
// an undisposed TextField/ComboBox/NumberSpinner keeps its `subscribeTheme`
// listener registered in `ThemeManager`'s module-level list past the end of
// its own test, where a later test's `ThemeManager.setTheme` call (row 5)
// fires it against a DOM already torn down by that later test's own
// `installTestDOM`, throwing "handle is not registered". Matches
// TextThemeReflow.test.ts's header note on why theme-subscribing components
// need this care across tests in one file.
let created: Array<{ dispose(): void }> = [];
function make<T extends { dispose(): void }>(component: T): T {
    created.push(component);

    return component;
}

beforeEach(() => {
    // Reset between tests since `themeVars` is a shared module-level object
    // mutated by row 5.
    delete themeVars['--ts-ui-font-size'];
    installTestDOM(DOM_CONFIG);
});

/**
 * Forces every subsequent `Util.singleLineBoxHeight` read in this test to
 * resolve a height nothing else in this file has ever used, by giving it its
 * own root font size and invalidating `Util`'s metrics cache. Needed by any
 * test that inspects `sink.writes` for a `.ClassName.h<h>px` rule's own
 * creation: that rule's `(constructor, suffix)` cache entry in
 * `ClassStyleRules.ts` is module state that outlives `DOM.reset()` (see the
 * file header), so a test re-using the default 22px height never observes
 * that rule's creation writes — an earlier test already consumed them.
 * `_ruleCacheHas`-style existence checks are unaffected by this, since they
 * read the persistent cache directly rather than one test's `sink.writes`.
 */
function useFreshFontSize(px: number): void {
    themeVars['--ts-ui-font-size'] = `${px}px`;
    ThemeManager.setTheme(ModernTheme);
}
afterEach(() => {
    created.forEach((c) => c.dispose());
    created = [];
    ThemeManager.setTheme(ModernTheme);
    DOM.reset();
});

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Declarations written to `selector`'s stylesheet rule within `writes`,
 * flattened into one key/value map (last write per key wins, matching
 * cascade-within-a-rule semantics). Only `setRuleStyles` ops whose selector
 * (`args[0]`) matches are counted.
 */
function declarationsIn(
    writes: RecordingDOMSink['writes'],
    selector: string,
): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const w of writes) {
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

/** `declarationsIn`, capturing the writes `fn()` produces itself. */
function declarationsDuring(
    sink: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    const start = sink.writes.length;
    fn();

    return declarationsIn(sink.writes.slice(start), selector);
}

/**
 * The `addClass`/`removeClass` patches from `apply` writes within `writes` —
 * the class-toggle side of `pinSingleLineBoxHeight`/`setValueStyleState`.
 * Mirrors `TextLineHeightValueClassSharing.test.ts`'s `classToggleWrites`.
 */
function classToggleWrites(
    writes: RecordingDOMSink['writes'],
): Array<{ removeClass?: string[]; addClass?: string[] }> {
    return writes
        .filter((w) => w.op === 'apply')
        .map((w) => w.args[1] as { removeClass?: string[]; addClass?: string[] })
        .filter((patch) => patch.addClass !== undefined || patch.removeClass !== undefined);
}

describe('Single-line input height value-class sharing', () => {
    it('row 1: a rendered TextField writes no real min-height/max-height to its own #id rule, and carries the shared class', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const field = make(new TextField());

        const writes = declarationsDuring(sink, idSelector(field), () => field.getElement(true));
        expect(writes.minHeight).toBeUndefined();
        expect(writes.maxHeight).toBeUndefined();

        const h = field.getPreferredSize()!.height;
        expect(_ruleCacheHas(`.TextField.h${h}px`)).toBe(true);

        const toggles = classToggleWrites(sink.writes);
        expect(toggles.some((t) => t.addClass?.includes(`h${h}px`))).toBe(true);
    });

    it('row 2: two rendered TextFields resolving the same height share one ensureStyleRule call, and neither writes a real height declaration to its own rule', () => {
        useFreshFontSize(17);
        const sink = DOM.sink as RecordingDOMSink;

        const a = make(new TextField());
        a.getElement(true);
        const h = a.getPreferredSize()!.height;

        const start = sink.writes.length;
        const b = make(new TextField());
        b.getElement(true);
        const writesB = sink.writes.slice(start);

        expect(b.getPreferredSize()!.height).toBe(h);
        expect(declarationsIn(writesB, idSelector(b)).minHeight).toBeUndefined();
        expect(declarationsIn(writesB, idSelector(b)).maxHeight).toBeUndefined();

        const ensureCalls = sink.writes.filter(
            (w) => w.op === 'ensureStyleRule' && w.args[0] === `.TextField.h${h}px`,
        );
        expect(ensureCalls.length).toBe(1);
    });

    it('row 3: a TextField, ComboBox, NumberSpinner, PasswordField, UsernameField and DateField each get their own distinct class-keyed selector, and none writes a real height declaration to its own rule', () => {
        // NumberSpinner's own chrome (a real border) differs from
        // TextField/ComboBox's under this test DOM's font-metrics fixture
        // (the shared `--ts-ui-input-border` CSS var used by TextInput's
        // border resolves to nothing offline, unlike NumberSpinner's own
        // hard-coded border declaration), so the resolved heights are not
        // assumed equal here — each component's own resolved height is read
        // back independently, per the file header's convention.
        const sink = DOM.sink as RecordingDOMSink;

        const tf = make(new TextField());
        tf.getElement(true);
        const cb = make(new ComboBox());
        cb.getElement(true);
        const ns = make(new NumberSpinner());
        ns.getElement(true);
        const pf = make(new PasswordField());
        pf.getElement(true);
        const uf = make(new UsernameField());
        uf.getElement(true);
        const df = make(new DateField());
        df.getElement(true);

        const components: Array<[string, { getPreferredSize(): { height: number } | null }]> = [
            ['TextField', tf], ['ComboBox', cb], ['NumberSpinner', ns],
            ['PasswordField', pf], ['UsernameField', uf], ['DateField', df],
        ];

        for (const [name, c] of components) {
            const h = c.getPreferredSize()!.height;
            expect(_ruleCacheHas(`.${name}.h${h}px`)).toBe(true);
        }

        for (const [, c] of components) {
            const decl = declarationsIn(sink.writes, idSelector(c as unknown as { getId(): string }));
            expect(decl.minHeight).toBeUndefined();
            expect(decl.maxHeight).toBeUndefined();
        }
    });

    it("row 4: the shared .TextField.h<h>px rule's declarations are exactly the inert baseline widths plus the real height pair", () => {
        useFreshFontSize(19);
        const sink = DOM.sink as RecordingDOMSink;
        const field = make(new TextField());
        field.getElement(true);
        const h = field.getPreferredSize()!.height;

        const decl = declarationsIn(sink.writes, `.TextField.h${h}px`);
        expect(decl).toEqual({
            minWidth:  '0px',
            minHeight: `${h}px`,
            maxWidth:  'none',
            maxHeight: `${h}px`,
        });
    });

    it('row 5: a font-size theme change swaps the value-class token in one apply write, and the instance rule still carries no real height declaration', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const field = make(new TextField());
        field.getElement(true);
        const oldH = field.getPreferredSize()!.height;

        themeVars['--ts-ui-font-size'] = '20px';

        const start = sink.writes.length;
        ThemeManager.setTheme(DarkTheme);
        const writes = sink.writes.slice(start);

        const newH = field.getPreferredSize()!.height;
        expect(newH).not.toBe(oldH);

        const toggles = classToggleWrites(writes);
        expect(toggles).toContainEqual({ removeClass: [`h${oldH}px`], addClass: [`h${newH}px`] });

        expect(_ruleCacheHas(`.TextField.h${newH}px`)).toBe(true);

        const decl = declarationsIn(writes, idSelector(field));
        expect(decl.minHeight).toBeUndefined();
        expect(decl.maxHeight).toBeUndefined();
    });

    it('row 6: a TextField constructed but never rendered defers the class write until first render', () => {
        const sink = DOM.sink as RecordingDOMSink;
        // Captured before construction: `updateHeight()` (and so
        // `pinSingleLineBoxHeight`) runs from the constructor, so the "no
        // apply write happens before the element exists" clause has to
        // cover construction itself, not just the read below it.
        const start1 = sink.writes.length;
        const field = make(new TextField());

        expect(field.getElement()).toBeFalsy();

        const h = field.getPreferredSize()!.height;
        expect(classToggleWrites(sink.writes.slice(start1))).toEqual([]);

        const start2 = sink.writes.length;
        field.getElement(true);
        // `Component.init`'s catch-up folds the recorded value-class token
        // into the SAME `addClass` call as the base-class chain (see
        // `## Internal Structure`), unlike `Text.render()`'s original
        // precedent, which issued it as a separate write — so this asserts
        // membership in that merged array rather than an exact-match patch.
        const patches = classToggleWrites(sink.writes.slice(start2));
        expect(patches.some((p) => p.addClass?.includes(`h${h}px`))).toBe(true);
    });

    it('row 7: a real min-width deviation reaches the instance rule; the deduped min-height does not', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const field = make(new TextField());
        field.getElement(true);
        const h = field.getPreferredSize()!.height;

        const writes = declarationsDuring(sink, idSelector(field), () => {
            field.setMinSize({ width: 50, height: h });
        });

        expect(writes.minWidth).toBe('50px');
        // Not simply absent: `minWidth`'s real deviation in the same
        // `setMinSize` call forces `#id` to materialise regardless, so the
        // matching `minHeight` is flushed as an explicit removal rather than
        // left unqueued — mirrors Component.test.ts's "size-setter-interface"
        // case 2 (`minWidth` real, `minHeight` reconciled to `null` in the
        // same batch).
        expect(writes.minHeight).toBeNull();
    });

    it('row 8: the resolved size getters are unaffected — only the CSS rule that paints the constraint changes', () => {
        const field    = make(new TextField());
        const combo    = make(new ComboBox());
        const spinner  = make(new NumberSpinner());

        for (const input of [field, combo, spinner]) {
            const min  = input.getMinSize()!;
            const pref = input.getPreferredSize()!;
            const max  = input.getMaxSize()!;

            expect(min.height).toBe(pref.height);
            expect(max.height).toBe(pref.height);
        }
    });

    it('row 9: the data-minSize/data-maxSize attributes are still written, with the same values as before', () => {
        const field = make(new TextField());
        field.getElement(true);

        const min = field.getMinSizeConstraint()!;
        const max = field.getMaxSizeConstraint()!;
        // Mirrors Component.ts's private `formatSizeTerm`: an unbounded axis
        // serialises as `"inf"`, a bounded one as `"<px>px"` — the attribute
        // encodes both axes independently regardless of which one this
        // pin's shared rule dedupes away.
        const term = (value: number) => (value >= UNBOUNDED ? 'inf' : `${Math.round(value)}px`);

        expect(field.getDataAttribute('minSize')).toBe(`${term(min.width)} ${term(min.height)}`);
        expect(field.getDataAttribute('maxSize')).toBe(`${term(max.width)} ${term(max.height)}`);
    });
});
