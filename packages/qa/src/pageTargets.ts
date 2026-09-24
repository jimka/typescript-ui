// Targets every panel gets: `idle`, `settle`, `theme` and `viewport` act on the
// whole page rather than on one component, so `mountPanel` merges them under
// each panel's own targets, and a panel can still replace any of them. The
// `theme` driver lives in the library-free harness, so the library half of a
// theme switch is built here, on the page side, and handed to it as its target.

import { DarkTheme, ModernTheme, ThemeManager } from '@jimka/typescript-ui/core';
import type { Component, Theme } from '@jimka/typescript-ui/core';
import type { ThemeTarget } from './harness/types.js';

/** The themes a page cycles through by default: dark, then `ModernTheme`, the one `ThemeManager` starts with. */
export const THEME_CYCLE: readonly Theme[] = [DarkTheme, ModernTheme];

/**
 * A `theme` target over `themes`.
 *
 * @param themes - The themes to cycle through.
 * @returns A target whose `cycle(i)` sets `themes[i % themes.length]` through `ThemeManager.setTheme`, and whose `restore()` sets the theme that was current when the target was built.
 * @throws Error - `themeTarget: expected at least one theme` for an empty list.
 */
export function themeTarget(themes: readonly Theme[]): ThemeTarget {
    if (themes.length === 0) {
        throw new Error('themeTarget: expected at least one theme');
    }

    const original = ThemeManager.getTheme();

    return {
        cycle: (index: number): void => ThemeManager.setTheme(themes[index % themes.length]),
        restore: (): void => ThemeManager.setTheme(original),
    };
}

/**
 * The page-wide targets, merged under every panel's own. Every page has
 * viewport listeners, `Body`'s at least, so any panel can be driven with
 * `viewport`.
 *
 * @param root - The panel's root: the target of `idle`, `settle` and `viewport`, which all three drivers ignore but the run's target check needs defined.
 * @returns `{ idle: root, settle: root, theme: themeTarget(THEME_CYCLE), viewport: root }`.
 */
export function pageTargets(root: Component): Record<string, unknown> {
    return { idle: root, settle: root, theme: themeTarget(THEME_CYCLE), viewport: root };
}
