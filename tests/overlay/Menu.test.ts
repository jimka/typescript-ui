import { describe, it, expect, afterEach, vi } from 'vitest';
import { Menu } from '~/overlay/Menu';
import { MenuItem, MenuItemConfig } from '~/component/container/MenuItem';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
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

describe('Menu rebuild-mode submenus', () => {
    afterEach(() => DOM.reset());

    /** The submenu MenuItem built by a rebuild-mode show(). */
    function submenuItem(menu: Menu): any {
        return (menu as any)._menuItems.find(
            (i: any) => typeof i.hasSubmenu === 'function' && i.hasSubmenu()
        );
    }

    it('opens a child submenu from a submenu item and tears it down on hide', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        const items: MenuItemConfig[] = [
            { text: 'Open', action: () => {} },
            { text: 'Export', submenu: { label: 'Export', items: [{ text: 'CSV', action: () => {} }] } },
        ];

        menu.show(0, 0, items);

        const exportItem = submenuItem(menu);
        expect(exportItem).toBeDefined();

        // The submenu item's hover signal opens a child Menu. Rebuild-mode show()
        // used to stub this callback as a no-op, so no child ever opened.
        exportItem._onOpenSubmenu(exportItem);
        expect((menu as any)._openSubmenuPanel).toBeInstanceOf(Menu);

        // Selecting a child leaf dismisses the whole chain (dismissAll -> hide in
        // rebuild mode), which also tears the child submenu down.
        (menu as any)._openSubmenuPanel._onClose();
        expect((menu as any)._openSubmenuPanel).toBeNull();
    });

    it('closes the open child submenu when a plain item is hovered', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();

        menu.show(0, 0, [
            { text: 'Open', action: () => {} },
            { text: 'Export', submenu: { label: 'Export', items: [{ text: 'CSV' }] } },
        ]);

        const openItem = (menu as any)._menuItems[0];
        const exportItem = submenuItem(menu);

        exportItem._onOpenSubmenu(exportItem);
        expect((menu as any)._openSubmenuPanel).toBeInstanceOf(Menu);

        // Moving to a submenu-less item signals open-submenu with no submenu, which
        // closes the currently-open child.
        openItem._onOpenSubmenu(openItem);
        expect((menu as any)._openSubmenuPanel).toBeNull();
    });

    it('does not open a disabled item\'s submenu on hover', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();

        menu.show(0, 0, [
            { text: 'Export', enabled: false, submenu: { label: 'Export', items: [{ text: 'CSV' }] } },
        ]);

        const exportItem = submenuItem(menu);
        expect(exportItem).toBeDefined();

        // Hovering the disabled item signals open-submenu, but no child opens.
        exportItem._onOpenSubmenu(exportItem);
        expect((menu as any)._openSubmenuPanel).toBeNull();
    });

    it('resolves a submenu items provider each time the submenu opens', () => {
        installTestDOM(CONFIG);

        // A provider (not a fixed array) supplies the submenu's items; a submenu is
        // rebuilt per open, so the provider must run afresh each open — letting its
        // labels track current state.
        const provider = vi.fn(() => [{ text: 'Dynamic', action: () => {} }]);
        const menu = new Menu();

        menu.show(0, 0, [
            { text: 'Open', action: () => {} },
            { text: 'Export', submenu: { label: 'Export', items: provider } },
        ]);

        const openItem = (menu as any)._menuItems[0];
        const exportItem = submenuItem(menu);

        // First open: the provider runs and the child panel is built from its result.
        exportItem._onOpenSubmenu(exportItem);
        expect(provider).toHaveBeenCalledTimes(1);
        expect((menu as any)._openSubmenuPanel).toBeInstanceOf(Menu);
        expect((menu as any)._openSubmenuPanel._menuItems).toHaveLength(1);

        // Close (hover a plain item), then reopen: the provider runs again.
        openItem._onOpenSubmenu(openItem);
        exportItem._onOpenSubmenu(exportItem);
        expect(provider).toHaveBeenCalledTimes(2);
    });
});

describe('Menu content-based width', () => {
    afterEach(() => DOM.reset());

    it('a MenuItem measures a wider title for a longer label', () => {
        installTestDOM(CONFIG);

        const short = new MenuItem({ text: 'A' }, () => {}, () => {});
        const long  = new MenuItem({ text: 'A considerably longer menu item label' }, () => {}, () => {});

        expect(long.titleTextWidth()).toBeGreaterThan(short.titleTextWidth());
    });

    it('lines up a menu whose items mix titles, shortcuts and a submenu', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        menu.show(0, 0, [
            { text: 'Short', shortcut: 'Ctrl+S' },
            { text: 'A much longer item', shortcut: 'F2' },
            { text: 'Submenu', submenu: { label: 'Submenu', items: [{ text: 'One' }] } },
        ]);

        const items = (menu as any)._menuItems.filter((i: any) => i.hasIcon || i.titleTextWidth);
        // Every item shares one title-column width, so shortcuts start at a common x.
        const columns = items.map((i: any) => i._titleColumn);
        expect(new Set(columns).size).toBe(1);
        expect(columns[0]).toBeGreaterThan(0);
    });

    it('sizes a rebuild menu to its content, clamped to the min/max bounds', () => {
        installTestDOM(CONFIG);

        const tiny = new Menu();
        tiny.show(0, 0, [{ text: 'A' }, { text: 'B' }]);

        const wide = new Menu();
        wide.show(0, 0, [{ text: 'X'.repeat(200) }]);

        // Tiny content clamps up to the floor; a very long label clamps to the ceiling.
        expect(tiny.getMenuWidth()).toBe(120);
        expect(wide.getMenuWidth()).toBeGreaterThan(120);
        expect(wide.getMenuWidth()).toBeLessThanOrEqual(360);
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

    it('activateFocused fires the item action and then closes for an enabled leaf', () => {
        installTestDOM(CONFIG);

        const action = vi.fn();
        const { menu, onClose } = buildMenu(action);

        menu.focusItem(0);
        menu.activateFocused();

        // A persistent-mode (MenuBar dropdown) leaf activation runs the
        // config.action (the menu command) and then closes the menu via onClose,
        // mirroring the rebuild-mode show() path. MenuItemConfig.action is
        // documented as "called when the item is activated".
        expect(action).toHaveBeenCalledOnce();
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

    it('close clears a hover highlight left on an item (persistent reuse)', () => {
        installTestDOM(CONFIG);

        const { menu } = buildMenu(() => {});
        const first = (menu as any)._menuItems[0];

        // A click dismissal detaches the panel under the pointer, so no mouseout
        // clears the hovered item — simulate that leftover focused state.
        first.setFocused(true);
        expect(first.getBackgroundColor()).not.toBe('transparent');

        menu.close();

        // Persistent menus reuse this element; close() must reset its highlight
        // so it does not reappear on the next open.
        expect(first.getBackgroundColor()).toBe('transparent');
    });
});

describe('Menu rebuild-mode light dismiss (pointerdown)', () => {
    afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

    /**
     * The outside-press dismissal listener show() registers. Captured by type off
     * a spy rather than dispatched through the window, because Event's viewport
     * map is module-level and binds its base window listener only on the first
     * registration per type — an earlier show() in this file already bound
     * "pointerdown" to a stale window handle, so a real window dispatch here would
     * miss. Spying on the registration sidesteps that and pins the exact type.
     */
    function captureDismiss(menu: Menu, onClose: () => void): (e: unknown) => void {
        const spy = vi.spyOn(Event, 'addViewportListener');

        menu.show(100, 100, [{ text: 'A', action: () => {} }], onClose);

        // The fix: the light dismiss registers on "pointerdown", never "mousedown".
        const types = spy.mock.calls.map((c) => c[1]);
        expect(types).toContain('pointerdown');
        expect(types).not.toContain('mousedown');

        const call = spy.mock.calls.find((c) => c[1] === 'pointerdown');
        return call![2] as (e: unknown) => void;
    }

    it('registers the dismiss on pointerdown and closes on an outside press', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        let closed = 0;
        const dismiss = captureDismiss(menu, () => { closed++; });

        // pointerdown, not the compatibility mousedown: a preventDefaulted
        // pointerdown (every CustomListRow does that on a row press) suppresses
        // the follow-up mousedown, so a mousedown-only dismissal missed those
        // targets. An outside press closes the menu.
        const outside = DOM.sink.createElement('div');
        dismiss(makeEvent(outside, 'pointerdown'));

        expect(closed).toBe(1);
    });

    it('ignores a pointerdown inside the menu surface', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        let closed = 0;
        const dismiss = captureDismiss(menu, () => { closed++; });

        // A press on the menu's own subtree is not an outside click — the item
        // action closes it, not the light-dismiss listener.
        dismiss(makeEvent(menu.getElement()!, 'pointerdown'));

        expect(closed).toBe(0);
        expect(menu.isVisible()).toBe(true);
    });
});
