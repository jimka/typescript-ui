// Pure, node-safe portions of Theme: the defineTheme deep-merge contract and a
// structural smoke test of the shipped theme objects. ThemeManager / themeToVars
// (which touch the DOM and apply CSS variables) are a DOM-integration tier and
// are out of scope here (a Non-Goal per the plan).
import { describe, it, expect } from 'vitest';
import {
    defineTheme,
    BaseTheme,
    ModernTheme,
    DarkTheme,
    ClassicTheme,
    type Theme,
    type DeepPartial,
} from '~/core/Theme';

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
