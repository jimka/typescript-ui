// @vitest-environment jsdom
//
// This file constructs library components and switches themes, and both go
// through the library's production DOM seam. So this file needs a real DOM.
import { afterEach, describe, expect, it } from 'vitest';
import { DarkTheme, Panel, ThemeManager } from '@jimka/typescript-ui/core';
import { pageTargets, themeTarget } from '../src/pageTargets.js';

const ORIGINAL = ThemeManager.getTheme();

afterEach(() => {
    ThemeManager.setTheme(ORIGINAL);
});

describe('P11 pageTargets', () => {
    it('gives every panel an idle, a theme and a viewport target', () => {
        const root = Panel();
        const targets = pageTargets(root);

        expect(Object.keys(targets)).toEqual(['idle', 'theme', 'viewport']);
        expect(targets.idle).toBe(root);
        expect(targets.viewport).toBe(root);
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
