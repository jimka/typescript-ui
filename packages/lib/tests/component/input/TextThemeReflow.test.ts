// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for Expected Behaviour rows 9-13 of
// plans/implemented/per-class-component-defaults.md: Text no longer
// subscribes to ThemeManager per instance, and its theme-derived numbers
// (bound font size, additive line height) come from Util's shared,
// generation-gated metrics cache instead. Kept in its own file — like
// `TextDispose.test.ts` — because these tests call `ThemeManager.setTheme`,
// which synchronously fires every listener still registered in the process,
// making them uniquely sensitive to cross-test pollution from an undisposed
// theme-subscribing component built elsewhere in the suite. The modelled DOM
// is installed globally per test by `tests/setup/node-setup.ts`.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Text } from '~/component/input/Text';
import { DOM } from '~/core/DOM';
import { Util } from '~/core/Util';
import { ThemeManager, DarkTheme, ModernTheme } from '~/core/Theme';

describe('Text — theme reflow via the shared metrics cache', () => {
    afterEach(() => {
        // Theme state is global/module-level; restore it even if an
        // assertion above fails mid-test.
        ThemeManager.setTheme(ModernTheme);
    });

    it('registers zero theme listeners on construction', () => {
        const listenersBefore = ThemeManager._themeListenerCount();

        const text = new Text('hi');
        text.getElement(true);

        expect(ThemeManager._themeListenerCount()).toBe(listenersBefore);
    });

    it('re-resolves the bound font size exactly once across 5 live instances after a theme change', () => {
        const texts = Array.from({ length: 5 }, () => new Text('x'));
        texts.forEach(t => t.getElement(true));

        const spy = vi.spyOn(DOM.source, 'getThemeVar');

        ThemeManager.setTheme(DarkTheme);
        texts.forEach(t => t.getFontSize());

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('re-measures lazily on the next getPreferredSize() call after a theme change', () => {
        const text = new Text('hi');
        text.getElement(true);
        text.getPreferredSize(); // establishes the cached measurement

        const calculateSize = vi.spyOn(text as unknown as { calculateSize(): void }, 'calculateSize');

        ThemeManager.setTheme(DarkTheme);
        expect(calculateSize).not.toHaveBeenCalled();

        text.getPreferredSize();
        expect(calculateSize).toHaveBeenCalledTimes(1);
    });

    it('never re-measures a disposed Text after a theme change', () => {
        const text = new Text('hi');
        text.getElement(true);
        text.getPreferredSize();
        text.dispose();

        const calculateSize = vi.spyOn(text as unknown as { calculateSize(): void }, 'calculateSize');

        ThemeManager.setTheme(DarkTheme);

        expect(calculateSize).not.toHaveBeenCalled();
    });

    it('getLineHeight() on a freshly constructed Text returns the resolved additive line box', () => {
        const text = new Text('hi');

        expect(text.getLineHeight()).toBe(Util.lineHeightPx({ fontSizePx: text.getFontSize() ?? 14 }));
        expect(text.getLineHeight()).not.toBeNull();
    });
});
