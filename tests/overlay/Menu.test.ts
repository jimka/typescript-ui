// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Menu } from '~/overlay/Menu';
import { MenuItemConfig } from '~/component/container/MenuItem';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// VIEWPORT_MARGIN mirrored from Menu (private const) — a documented cosmetic
// breathing-room constant, not a positioning magic number.
const VIEWPORT_MARGIN = 4;

/** Bracket-accesses the private placeVertically with explicit numeric args. */
function placeVertically(m: Menu, growTop: number, anchorTop: number, total: number, vpHeight: number): number {
    return (m as any).placeVertically(growTop, anchorTop, total, vpHeight);
}

describe('Menu mode guards', () => {
    afterEach(() => DOM.reset());

    it('rebuild-mode menu throws on persistent-only methods', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();

        expect(() => menu.open(DOM.sink.createElement('div'))).toThrow(/persistent mode/);
        expect(() => menu.close()).toThrow(/persistent mode/);
        expect(() => menu.focusNext()).toThrow(/persistent mode/);
        expect(() => menu.getFocusedIndex()).toThrow(/persistent mode/);
    });

    it('persistent-mode menu throws on rebuild-only methods', () => {
        installTestDOM(CONFIG);

        const menu = new Menu([{ text: 'A', action: () => {} }], () => {});

        expect(() => menu.show(0, 0, [])).toThrow(/rebuild mode/);
        expect(() => menu.hide()).toThrow(/rebuild mode/);
        expect(() => menu.setMenuWidth(100)).toThrow(/rebuild mode/);
        expect(() => menu.toggleFor(DOM.sink.createElement('div'), 0, 0, [])).toThrow(/rebuild mode/);
    });
});

describe('Menu.placeVertically', () => {
    afterEach(() => DOM.reset());

    it('grows down from growTop when content fits below', () => {
        installTestDOM(CONFIG);

        const menu = new Menu([{ text: 'A' }], () => {});

        // roomBelow = 800 - 100 - 4 = 696; total (200) fits => returns growTop.
        const top = placeVertically(menu, 100, 90, 200, 800);

        expect(top).toBe(100);
        // The clamp uses roomBelow as the available height.
        expect(menu.getMaxSize()!.height).toBe(800 - 100 - VIEWPORT_MARGIN);
    });

    it('flips up against anchorTop when content overflows below and more room is above', () => {
        installTestDOM(CONFIG);

        const menu = new Menu([{ text: 'A' }], () => {});

        // growTop near the bottom: roomBelow = 800 - 760 - 4 = 36; roomAbove =
        // 700 - 4 = 696. total (300) > roomBelow AND roomBelow < roomAbove =>
        // flips up: returns anchorTop - min(total, roomAbove) = 700 - 300 = 400.
        const top = placeVertically(menu, 760, 700, 300, 800);

        expect(top).toBe(700 - Math.min(300, 696));
        expect(menu.getMaxSize()!.height).toBe(696);
    });

    it('grows down on a room-below >= room-above tie even when content overflows', () => {
        installTestDOM(CONFIG);

        const menu = new Menu([{ text: 'A' }], () => {});

        // growTop = anchorTop = 400. roomBelow = 800 - 400 - 4 = 396;
        // roomAbove = 400 - 4 = 396. roomBelow >= roomAbove holds => grows down,
        // returns growTop even though total (1000) overflows.
        const top = placeVertically(menu, 400, 400, 1000, 800);

        expect(top).toBe(400);
        expect(menu.getMaxSize()!.height).toBe(396);
    });
});

describe('Menu focus navigation (persistent)', () => {
    afterEach(() => DOM.reset());

    // [0]=A  [1]=separator  [2]=B  [3]=disabled. Separators are skipped by
    // focus traversal; a disabled item is still focusable (only activation
    // no-ops on it).
    function buildMenu(action: () => void): { menu: Menu; onClose: ReturnType<typeof vi.fn> } {
        const onClose = vi.fn();
        const configs: MenuItemConfig[] = [
            { text: 'A', action },
            { separator: true },
            { text: 'B', action },
            { text: 'D', enabled: false, action },
        ];

        return { menu: new Menu(configs, onClose), onClose };
    }

    it('focusNext from -1 lands on the first item', () => {
        installTestDOM(CONFIG);

        const { menu } = buildMenu(() => {});

        menu.focusNext();

        expect(menu.getFocusedIndex()).toBe(0);
    });

    it('focusNext skips the separator', () => {
        installTestDOM(CONFIG);

        const { menu } = buildMenu(() => {});

        menu.focusNext();           // -1 -> 0
        menu.focusNext();           // 0 -> skip separator at 1 -> 2

        expect(menu.getFocusedIndex()).toBe(2);
    });

    it('focusNext wraps from the last item back to 0', () => {
        installTestDOM(CONFIG);

        const { menu } = buildMenu(() => {});

        menu.focusItem(3);
        menu.focusNext();           // 3 -> wrap -> 0

        expect(menu.getFocusedIndex()).toBe(0);
    });

    it('focusPrev wraps from 0 to the last item', () => {
        installTestDOM(CONFIG);

        const { menu } = buildMenu(() => {});

        menu.focusItem(0);
        menu.focusPrev();           // 0 -> wrap -> 3

        expect(menu.getFocusedIndex()).toBe(3);
    });

    it('focusPrev skips the separator', () => {
        installTestDOM(CONFIG);

        const { menu } = buildMenu(() => {});

        menu.focusItem(2);
        menu.focusPrev();           // 2 -> skip separator at 1 -> 0

        expect(menu.getFocusedIndex()).toBe(0);
    });

    it('activateFocused fires the activation callback for an enabled leaf', () => {
        installTestDOM(CONFIG);

        const { menu, onClose } = buildMenu(() => {});

        menu.focusItem(0);
        menu.activateFocused();

        // In persistent mode a leaf's activation routes to the panel's onClose
        // (the wired onActivate), not the config.action.
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('activateFocused no-ops on a disabled item', () => {
        installTestDOM(CONFIG);

        const { menu, onClose } = buildMenu(() => {});

        menu.focusItem(3);          // disabled
        menu.activateFocused();

        expect(onClose).not.toHaveBeenCalled();
    });

    it('activateFocused no-ops when nothing is focused', () => {
        installTestDOM(CONFIG);

        const { menu, onClose } = buildMenu(() => {});

        // focusedIndex defaults to -1.
        menu.activateFocused();

        expect(onClose).not.toHaveBeenCalled();
    });
});
