// Text-specific coverage for Component.dispose() (Expected Behaviour rows
// 10-11 of plans/implemented/component-teardown-seam.md) — split into its own
// file rather than folded into ComponentDispose.test.ts because these tests
// call `ThemeManager.setTheme`, which synchronously fires every listener
// still registered in the process. That makes them uniquely sensitive to
// cross-test pollution: any earlier test anywhere in the suite that leaves a
// live theme-subscribing component undisposed can throw here against a
// since-`DOM.reset()` handle, for a reason having nothing to do with `Text`.
// Mirrors the project's existing convention for this class of hazard — see
// `feedback_viewport_listener_test_isolation` — put a real-registrar test
// needing a clean global in its own file rather than share one.
//
// "New rule-cache keys" mirrors AbstractWindow.styleRuleDisposal.test.ts: the
// StyleTarget rule cache is module state that outlives DOM.reset(), so the
// assertion diffs against a snapshot taken immediately before the component
// under test was constructed rather than asserting an absolute count.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Text } from '~/component/input/Text';
import { DOM } from '~/core/DOM';
import { ThemeManager, DarkTheme, ModernTheme } from '~/core/Theme';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheKeys } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('Text — theme subscription released on dispose', () => {
    afterEach(() => {
        // Theme state is global/module-level; restore it even if an
        // assertion above fails mid-test.
        ThemeManager.setTheme(ModernTheme);
    });

    it('releases the subscription and leaves zero new rule-cache keys', () => {
        const listenersBefore = ThemeManager._themeListenerCount();
        const before = new Set(_ruleCacheKeys());

        const text = new Text('hi');
        text.getElement(true);

        expect(ThemeManager._themeListenerCount()).toBe(listenersBefore + 1);

        text.dispose();

        expect(ThemeManager._themeListenerCount()).toBe(listenersBefore);

        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));
        expect(leaked).toEqual([]);
    });

    it('does not run the theme-change callback once disposed', () => {
        const text = new Text('hi');
        text.getElement(true);

        const calculateSize = vi.spyOn(text as unknown as { calculateSize(): void }, 'calculateSize');

        text.dispose();
        calculateSize.mockClear();

        ThemeManager.setTheme(DarkTheme);

        expect(calculateSize).not.toHaveBeenCalled();
    });
});
