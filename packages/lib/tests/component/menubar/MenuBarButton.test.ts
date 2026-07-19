import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MenuBarButton } from '~/component/menubar/MenuBarButton';
import { Tooltip } from '~/overlay/Tooltip';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

// Reads Tooltip's private attachment registry — the same `(Tooltip as any)`
// escape hatch its own suite uses — to assert whether a component carries a hint.
function hasTooltip(id: string): boolean {
    return (Tooltip as any).attachments.has(id);
}

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const NOOP = (): void => {};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('MenuBarButton chromeless contract', () => {
    it('stays non-flat (chromeless wins over setFlat)', () => {
        const btn = new MenuBarButton('File', NOOP, NOOP);

        expect(btn.isFlat()).toBe(false);

        btn.setFlat(true);

        // The button constructs chromeless; setFlat(true) is suppressed because
        // chromeless and flat are mutually exclusive.
        expect(btn.isFlat()).toBe(false);
    });
});

describe('MenuBarButton active state', () => {
    it('toggles aria-expanded via setActive', () => {
        const btn = new MenuBarButton('File', NOOP, NOOP);
        const aria = btn.getAria();

        // Constructed inactive: aria-expanded is false.
        expect(aria.getExpanded()).toBe(false);

        btn.setActive(true);
        expect(aria.getExpanded()).toBe(true);

        btn.setActive(false);
        expect(aria.getExpanded()).toBe(false);
    });
    it('keeps active and inactive backgrounds distinct (relational)', () => {
        const btn = new MenuBarButton('File', NOOP, NOOP);

        btn.setActive(true);
        const activeBg = btn.getBackgroundColor();

        btn.setActive(false);
        const inactiveBg = btn.getBackgroundColor();

        expect(activeBg).not.toBe(inactiveBg);
    });

    it('suppresses the hover tooltip while its menu is open, restoring it on close', () => {
        const btn = new MenuBarButton('File', NOOP, NOOP);

        // The title drives a tooltip by default.
        expect(hasTooltip(btn.getId())).toBe(true);

        // Opening the menu (active) detaches it so it can't float over the menu.
        btn.setActive(true);
        expect(hasTooltip(btn.getId())).toBe(false);

        // Closing restores it.
        btn.setActive(false);
        expect(hasTooltip(btn.getId())).toBe(true);
    });
});

describe('MenuBarButton fixed height', () => {
    it('pins the preferred height to MENU_BAR_BUTTON_HEIGHT (28)', () => {
        const btn = new MenuBarButton('File', NOOP, NOOP);

        expect(btn.getPreferredSize()!.height).toBe(28);
    });
});

describe('MenuBarButton dispose', () => {
    it('does not throw when removing its listeners', () => {
        const btn = new MenuBarButton('File', NOOP, NOOP);

        expect(() => btn.dispose()).not.toThrow();
    });
});
