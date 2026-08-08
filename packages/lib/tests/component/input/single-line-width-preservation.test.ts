// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Regression coverage for the updateHeight() width-clobbering fix
// (plans/implemented/setter-clobbering-followup-updateheight.md): TextField,
// PasswordField, UsernameField, ComboBox, NumberSpinner, and every AbstractPickerField
// subclass (DateField stands in here — the fix lives entirely in the shared
// base, so TimeField/DateTimeField exercise the identical code path) used to
// overwrite a caller-supplied preferredSize/minSize/maxSize width with a
// hardcoded literal, both at construction and on every theme change. Kept in
// its own file, like `TextThemeReflow.test.ts` / `TreeFontReflow.test.ts`,
// because `ThemeManager.setTheme` synchronously fires every listener still
// registered in the process.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TextField } from '~/component/input/TextField';
import { PasswordField } from '~/component/input/PasswordField';
import { UsernameField } from '~/component/input/UsernameField';
import { ComboBox } from '~/component/input/ComboBox';
import { NumberSpinner } from '~/component/input/NumberSpinner';
import { DateField } from '~/component/input/DateField';
import { DOM } from '~/core/DOM';
import { ThemeManager, ModernTheme } from '~/core/Theme';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

type SizedField = {
    getPreferredSize(): { width: number; height: number } | null;
};

const FIELDS: [string, number, () => SizedField, (size: { width: number; height: number }) => SizedField][] = [
    ['TextField',     200, () => new TextField(),     size => new TextField({ preferredSize: size })],
    ['PasswordField', 200, () => new PasswordField(), size => new PasswordField({ preferredSize: size })],
    ['UsernameField', 200, () => new UsernameField(), size => new UsernameField({ preferredSize: size })],
    ['ComboBox',      200, () => new ComboBox(),      size => new ComboBox({ preferredSize: size })],
    ['NumberSpinner', 120, () => new NumberSpinner(), size => new NumberSpinner({ preferredSize: size })],
    ['DateField',     160, () => new DateField(),     size => new DateField({ preferredSize: size })],
];

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => {
    ThemeManager.setTheme(ModernTheme);
    vi.restoreAllMocks();
    DOM.reset();
});

describe('Single-line inputs — caller-supplied width survives updateHeight', () => {
    for (const [name, defaultWidth, makeDefault, makeOverride] of FIELDS) {
        it(`${name}: keeps the class default width (${defaultWidth}) when the caller passes nothing`, () => {
            expect(makeDefault().getPreferredSize()!.width).toBe(defaultWidth);
        });

        it(`${name}: a caller-supplied preferredSize width survives construction`, () => {
            const field = makeOverride({ width: 321, height: 999 });

            expect(field.getPreferredSize()!.width).toBe(321);
            // Height is still recomputed, never adopted from the caller.
            expect(field.getPreferredSize()!.height).not.toBe(999);
        });

        it(`${name}: a caller-supplied preferredSize width survives a theme change`, () => {
            const field = makeOverride({ width: 321, height: 999 });

            ThemeManager.setTheme(ThemeManager.getTheme());

            expect(field.getPreferredSize()!.width).toBe(321);
        });

        it(`${name}: height still recomputes on a theme change when no explicit size was given`, () => {
            const field  = makeDefault();
            const before = field.getPreferredSize()!.height;

            const originalGetThemeVar = DOM.source.getThemeVar.bind(DOM.source);
            vi.spyOn(DOM.source, 'getThemeVar').mockImplementation(
                (varName: string) => varName === '--ts-ui-font-size' ? '40px' : originalGetThemeVar(varName)
            );
            ThemeManager.setTheme(ThemeManager.getTheme());

            const after = field.getPreferredSize()!.height;

            expect(after).toBeGreaterThan(before);
            expect(field.getPreferredSize()!.width).toBe(defaultWidth);
        });
    }
});

describe('TextField — minSize/maxSize width also survives (preferredSize above covers the shared code path)', () => {
    it('a caller-supplied minSize width survives construction and a theme change', () => {
        const field = new TextField({ minSize: { width: 50, height: 10 } });

        expect(field.getMinSize()!.width).toBe(50);

        ThemeManager.setTheme(ThemeManager.getTheme());

        expect(field.getMinSize()!.width).toBe(50);
    });

    it('a caller-supplied maxSize width survives construction and a theme change', () => {
        const field = new TextField({ maxSize: { width: 500, height: 10 } });

        expect(field.getMaxSize()!.width).toBe(500);

        ThemeManager.setTheme(ThemeManager.getTheme());

        expect(field.getMaxSize()!.width).toBe(500);
    });
});

describe('NumberSpinner — the HBox-derived min-width floor is unaffected', () => {
    it('getMinSize().width still reflects the up/down button column after a theme change', () => {
        const spinner = new NumberSpinner();
        const before  = spinner.getMinSize()!.width;

        expect(before).toBeGreaterThan(0);

        ThemeManager.setTheme(ThemeManager.getTheme());

        expect(spinner.getMinSize()!.width).toBe(before);
    });

    it('never bakes the HBox-derived merged min-width into its own explicit constraint', () => {
        // Pins this plan's "read the constraint, not the merged getter"
        // decision directly on the constraint accessor: `getMinSize()` merges
        // via `Math.max(constraint, managerMin)`, so once the two are equal
        // the merge is a fixed point and re-reading `getMinSize()` after a
        // theme change can't tell a correct constraint-based read-back apart
        // from a buggy one that fed the merged value back into `setMinSize`
        // (both stabilise at the same merged number). Reading the raw
        // constraint is the only observable that discriminates: it stays at
        // the un-set fallback (0) only if `updateHeight()` never wrote the
        // HBox's derived width into it.
        const spinner = new NumberSpinner();

        expect(spinner.getMinSizeConstraint()!.width).toBe(0);

        ThemeManager.setTheme(ThemeManager.getTheme());

        expect(spinner.getMinSizeConstraint()!.width).toBe(0);
    });
});
