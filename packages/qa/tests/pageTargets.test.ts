// @vitest-environment jsdom
//
// pageTargets.ts imports the library's `core` entry point, whose top-level
// `Body` singleton reads `document` at import time, and switching themes
// writes to the page. So this file needs a real DOM.
import { afterEach, describe, expect, it } from 'vitest';
import { DarkTheme, Panel, ThemeManager } from '@jimka/typescript-ui/core';
import { pageTargets, themeTarget } from '../src/pageTargets.js';

const ORIGINAL = ThemeManager.getTheme();

afterEach(() => {
    ThemeManager.setTheme(ORIGINAL);
});

describe('P11 pageTargets', () => {
    it('gives every panel an idle and a theme target', () => {
        const root = Panel();
        const targets = pageTargets(root);

        expect(Object.keys(targets)).toEqual(['idle', 'theme']);
        expect(targets.idle).toBe(root);
    });

    it('themeTarget cycles through its themes and restores the one it started from', () => {
        const target = themeTarget([DarkTheme]);

        expect(ThemeManager.getTheme()).not.toBe(DarkTheme);

        target.cycle(0);

        expect(ThemeManager.getTheme()).toBe(DarkTheme);

        target.cycle(1);

        expect(ThemeManager.getTheme()).toBe(DarkTheme);

        target.restore();

        expect(ThemeManager.getTheme()).toBe(ORIGINAL);
    });

    it('themeTarget needs at least one theme', () => {
        expect(() => themeTarget([])).toThrow('themeTarget: expected at least one theme');
    });
});
