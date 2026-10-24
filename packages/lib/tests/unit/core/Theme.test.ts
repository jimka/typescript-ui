// Pure, node-safe portions of Theme: the defineTheme deep-merge contract and a
// structural smoke test of the shipped theme objects. themeToVars (which
// applies CSS variables) is a DOM-integration tier and is out of scope here.
// Two blocks are exceptions that install a test DOM of their own rather than
// joining the DOM-free blocks: 'glyph icon-size scale' exercises
// ThemeManager.getResolvedScale()/setTheme against the recording sink (per
// plans/in-progress/glyph-icon-size-scale.md), and 'text.mutedColor reaches
// :root' reads the CSS variables setTheme writes to the document element.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    defineTheme,
    BaseTheme,
    ModernTheme,
    DarkTheme,
    ClassicTheme,
    ThemeManager,
    type Theme,
    type DeepPartial,
} from '~/core/Theme';
import { DOM } from '~/core/DOM';
import { installTestDOM, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// WCAG 2.x AA minimum contrast for normal-size text.
const AA_NORMAL_TEXT = 4.5;

/**
 * Parses `rgb(r, g, b)`, `#rgb` or `#rrggbb` into 0–255 channels.
 *
 * @param value - The CSS colour, in one of the forms the surface tokens use.
 * @returns The red, green and blue channels.
 * @throws Error - When the colour is in any other form.
 */
function parseColor(value: string): [number, number, number] {
    const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(value);

    if (rgb) {
        return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    }

    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);

    if (!hex) {
        throw new Error(`unsupported colour form: ${value}`);
    }

    const digits = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];

    return [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Every colour a background value paints: the value itself for a plain
 * colour, each colour stop for a gradient.
 *
 * @param value - A background token's value.
 * @returns The colours it contains, in order.
 */
function colorStops(value: string): string[] {
    return value.match(/rgb\([^)]*\)|#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) ?? [];
}

/**
 * WCAG 2.x relative luminance of an sRGB colour.
 *
 * @param channels - The 0–255 red, green and blue channels.
 * @returns The relative luminance, from 0 (black) to 1 (white).
 */
function luminance([r, g, b]: [number, number, number]): number {
    // sRGB linearisation and channel weights are the constants WCAG 2.x defines.
    const lin = (c: number): number => {
        const s = c / 255;

        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };

    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * WCAG contrast ratio between two colours, always >= 1.
 *
 * @param a - One colour.
 * @param b - The other colour.
 * @returns The contrast ratio.
 */
function contrast(a: string, b: string): number {
    const la = luminance(parseColor(a));
    const lb = luminance(parseColor(b));

    // 0.05 is WCAG's flare term, added to both luminances.
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The surface backgrounds muted text is documented to sit on (the list
 * `Theme.text.mutedColor`'s JSDoc names); a gradient is checked at each of
 * its colour stops. Fills such as buttons, badges and notifications are out
 * of scope.
 */
const SURFACES: ReadonlyArray<[string, (t: Theme) => string]> = [
    ['body.background',          t => t.body.background],
    ['input.background',         t => t.input.background],
    ['list.background',          t => t.list.background],
    ['popover.background',       t => t.popover.background],
    ['contextMenu.background',   t => t.contextMenu.background],
    ['autoComplete.background',  t => t.autoComplete.background],
    ['toolBar.background',       t => t.toolBar.background],
    ['statusBar.background',     t => t.statusBar.background],
    ['menuBar.background',       t => t.menuBar.background],
    ['menuBar.panel.background', t => t.menuBar.panel.background],
    ['tab.toolbar.background',   t => t.tab.toolbar.background],
    ['window.header.background', t => t.window.header.background],
    ['tooltip.background',       t => t.tooltip.background],
    ['tab.button.background',    t => t.tab.button.background],
    ['tab.button.hover.background', t => t.tab.button.hover.background],
    ['accordion.header.background', t => t.accordion.header.background],
    ['table.header.background',  t => t.table.header.background],
];

/** The three built-in palettes, named for test titles. */
const BUILT_IN_THEMES: Array<[string, Theme]> = [
    ['ModernTheme', ModernTheme],
    ['ClassicTheme', ClassicTheme],
    ['DarkTheme', DarkTheme],
];

describe('defineTheme deep-merge contract', () => {
    it('replaces only the overridden leaf, leaving sibling keys from base intact', () => {
        const base = {
            font: { family: 'Base', size: '14px', linePadding: '2px' },
            text: { color: '#000' },
        } as DeepPartial<Theme>;

        const merged = defineTheme(base, { font: { family: 'Override' } });

        // The overridden leaf changes...
        expect(merged.font.family).toBe('Override');
        // ...but sibling leaves in the same nested object survive.
        expect(merged.font.size).toBe('14px');
        expect(merged.font.linePadding).toBe('2px');
        // ...and sibling top-level blocks survive untouched.
        expect(merged.text.color).toBe('#000');
    });

    it('merges nested partials rather than clobbering the whole nested object', () => {
        const base = {
            border: { color: '#ccc', radius: '4px' },
        } as DeepPartial<Theme>;

        const merged = defineTheme(base, { border: { radius: '8px' } });

        expect(merged.border.radius).toBe('8px');
        expect(merged.border.color).toBe('#ccc'); // not blanked by the partial override
    });

    it('skips an undefined override value so it never blanks a base value', () => {
        const base = { text: { color: '#000' } } as DeepPartial<Theme>;

        const merged = defineTheme(base, { text: { color: undefined } });

        expect(merged.text.color).toBe('#000');
    });

    it('returns a new object — does not mutate base', () => {
        const base = { text: { color: '#000' } } as DeepPartial<Theme>;

        const merged = defineTheme(base, { text: { color: '#fff' } });

        expect(base.text!.color).toBe('#000');
        expect(merged.text.color).toBe('#fff');
        expect(merged).not.toBe(base);
    });
});

describe('shipped theme objects are well-formed', () => {
    const themes: Array<[string, Theme]> = [
        ['BaseTheme', BaseTheme as Theme],
        ['ModernTheme', ModernTheme],
        ['DarkTheme', DarkTheme],
        ['ClassicTheme', ClassicTheme],
    ];

    for (const [name, theme] of themes) {
        it(`${name} carries the required scale and font blocks`, () => {
            expect(theme).toBeTruthy();
            expect(theme.font).toBeTruthy();
            expect(typeof theme.font.family).toBe('string');
            expect(theme.scale).toBeTruthy();
            // scale.base is the global px knob the Theme interface requires.
            expect(theme.scale.base).toBeTruthy();
        });
    }
});

describe('text.mutedColor', () => {
    it('carries the measured value in each built-in theme', () => {
        expect(ModernTheme.text.mutedColor).toBe('rgb(100, 100, 100)');
        expect(ClassicTheme.text.mutedColor).toBe('rgb(74, 74, 74)');
        expect(DarkTheme.text.mutedColor).toBe('rgb(180, 180, 180)');
    });

    const pairs = BUILT_IN_THEMES.flatMap(([name, theme]) =>
        SURFACES.map(([surface, read]) => [name, surface, theme, read] as const));

    it.each(pairs)('%s muted text meets WCAG AA on %s', (_name, _surface, theme, read) => {
        const stops = colorStops(read(theme));

        expect(stops.length).toBeGreaterThan(0);

        for (const stop of stops) {
            expect(contrast(theme.text.mutedColor!, stop)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        }
    });

    it('survives an override of the sibling text.color leaf', () => {
        const theme = defineTheme(DarkTheme, { text: { color: 'rgb(255, 255, 255)' } });

        expect(theme.text.mutedColor).toBe('rgb(180, 180, 180)');
    });

    it('is absent from BaseTheme, which carries no palette', () => {
        expect(BaseTheme.text).toBeUndefined();
    });
});

describe('text.mutedColor reaches :root', () => {
    beforeEach(() => installTestDOM(DOM_CONFIG));
    afterEach(() => {
        vi.restoreAllMocks();
        ThemeManager.setTheme(ModernTheme);
        DOM.reset();
    });

    // Literal expectations, not `theme.text.mutedColor`: a theme missing the
    // key and a write missing the key would otherwise agree on `undefined`.
    const cases: Array<[string, Theme, string]> = [
        ['ModernTheme', ModernTheme, 'rgb(100, 100, 100)'],
        ['ClassicTheme', ClassicTheme, 'rgb(74, 74, 74)'],
        ['DarkTheme', DarkTheme, 'rgb(180, 180, 180)'],
        // A hand-written theme may leave the optional token out; the
        // variable then carries its text colour.
        ['a theme without mutedColor', { ...ModernTheme, text: { color: 'rgb(1, 2, 3)' } }, 'rgb(1, 2, 3)'],
    ];

    it.each(cases)('setTheme(%s) writes --ts-ui-text-muted-color', (_name, theme, expected) => {
        // The modelled DOM mints a new handle on every `getDocumentElement()`
        // call, so pin one, as a real document has one root.
        const root = DOM.source.getDocumentElement();

        vi.spyOn(DOM.source, 'getDocumentElement').mockReturnValue(root);

        ThemeManager.setTheme(theme);

        const writes = (DOM.sink as RecordingDOMSink).writes
            .filter(w => w.op === 'apply' && w.args[0] === root)
            .map(w => (w.args[1] as { style?: Record<string, string | null> }).style ?? {})
            .filter(style => '--ts-ui-text-muted-color' in style);

        expect(writes.at(-1)?.['--ts-ui-text-muted-color']).toBe(expected);
    });
});

describe('glyph icon-size scale', () => {
    beforeEach(() => installTestDOM(DOM_CONFIG));
    afterEach(() => {
        ThemeManager.setTheme(ModernTheme);
        DOM.reset();
    });

    it('resolves the five glyph steps under the shipped default theme (base 14)', () => {
        const scale = ThemeManager.getResolvedScale();

        expect(scale.glyphXs).toBe(8);
        expect(scale.glyphSm).toBe(12);
        expect(scale.glyphMd).toBe(14);
        expect(scale.glyphLg).toBe(16);
        expect(scale.glyphXl).toBe(20);
    });

    it('scales all five steps proportionally when scale.base is raised to 28', () => {
        // ModernTheme, not BaseTheme, is the merge base: BaseTheme is a
        // structural DeepPartial<Theme> scaffold missing the palette fields
        // (e.g. text.color) that setTheme's themeToVars reads, so passing it
        // to setTheme directly throws. ModernTheme carries BaseTheme's scale
        // block unmodified, so the ratios under test are unaffected — see
        // HeaderThemeReflow.test.ts's paddedTheme() for the same precedent.
        ThemeManager.setTheme(defineTheme(ModernTheme, { scale: { base: 28 } }));

        const scale = ThemeManager.getResolvedScale();

        expect(scale.glyphXs).toBe(16);
        expect(scale.glyphSm).toBe(24);
        expect(scale.glyphMd).toBe(28);
        expect(scale.glyphLg).toBe(32);
        expect(scale.glyphXl).toBe(40);
    });

    it('leaves a step pinned via `fixed` unaffected by a raised base, while the rest still scale', () => {
        ThemeManager.setTheme(defineTheme(ModernTheme, { scale: { base: 28, glyphXl: { fixed: 20 } } }));

        const scale = ThemeManager.getResolvedScale();

        expect(scale.glyphXl).toBe(20);
        expect(scale.glyphXs).toBe(16);
        expect(scale.glyphSm).toBe(24);
        expect(scale.glyphMd).toBe(28);
        expect(scale.glyphLg).toBe(32);
    });
});
