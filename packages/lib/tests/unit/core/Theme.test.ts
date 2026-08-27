// Pure, node-safe portions of Theme: the defineTheme deep-merge contract and a
// structural smoke test of the shipped theme objects. themeToVars (which
// applies CSS variables) is a DOM-integration tier and is out of scope here.
// The 'glyph icon-size scale' block below is the one exception: it exercises
// ThemeManager.getResolvedScale()/setTheme against the recording sink (per
// plans/in-progress/glyph-icon-size-scale.md), so it installs a test DOM of
// its own rather than joining the DOM-free blocks above.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

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
