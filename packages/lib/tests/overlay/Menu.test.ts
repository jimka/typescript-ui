import { describe, it, expect, afterEach, vi } from 'vitest';
import { Menu } from '~/overlay/Menu';
import { MenuItem, MenuItemConfig } from '~/component/container/MenuItem';
import { MenuSeparator } from '~/component/container/MenuSeparator';
import { MenuRow } from '~/component/container/MenuRow';
import { CheckboxMenuRow } from '~/component/container/CheckboxMenuRow';
import { Component } from '~/core/Component';
import { Panel } from '~/core/Panel';
import { DOM } from '~/core/DOM';
import type { Handle, Rect } from '~/core/DOM';
import { LayerManager } from '~/core/LayerManager';
import { TRACK_WIDTH } from '~/component/container/Scrollbar';
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

// VIEWPORT_MARGIN mirrored from Menu (private const) — a documented cosmetic
// breathing-room constant, not a positioning magic number.
const VIEWPORT_MARGIN = 4;

// The panel's own left+right border ("1px solid ..." on each side, set by
// both applyRebuildChrome and applyPersistentChrome), which layOutColumns
// adds to the content-based width it clamps/measures rows against before
// returning the panel's actual (border-box) width — see getMenuWidth().
const MENU_BORDER_PX = 2;

// TRACK_WIDTH mirrored from Scrollbar (12px), used to widen Menu when
// its item list overflows vertically, so row content stays at the width
// layOutColumns measured them against.
const TEST_TRACK_WIDTH = TRACK_WIDTH;

// MENU_ANIM_DURATION_MS (120) mirrored from Menu (private const), plus
// Animation.play's default 40ms fallback buffer, plus headroom — comfortably
// past the point a submenu's close() fade completes via the fallback timer
// (TestDOM fires no real `transitionend`).
const PAST_SUBMENU_FADE_MS = 200;

/** Builds a full Rect from its four edges (width/height derived). Mirrors the
 *  idiom in tests/overlay/OverlayPosition.test.ts. */
function rect(left: number, top: number, right: number, bottom: number): Rect {
    return {
        x:      left,
        y:      top,
        left,
        top,
        right,
        bottom,
        width:  right - left,
        height: bottom - top,
    };
}

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
        expect(() => menu.setScrollToBottomOnShow(true)).toThrow(/rebuild mode/);
        expect(() => menu.toggleFor(DOM.sink.createElement('div'), rect(0, 0, 0, 0), [])).toThrow(/rebuild mode/);
        expect(() => menu.setItemEnabled(0, false)).toThrow(/rebuild mode/);
    });
});

describe('Menu.setItemEnabled — live row update on an already-open panel', () => {
    afterEach(() => DOM.reset());

    it('disables the row at index in place, without rebuilding the panel', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        menu.show(0, 0, [{ text: 'A' }, { text: 'B' }]);

        const row = (menu as any)._menuItems[1] as MenuItem;

        menu.setItemEnabled(1, false);

        expect(row.isEnabled()).toBe(false);
        // Same instance — no rebuild happened.
        expect((menu as any)._menuItems[1]).toBe(row);
    });

    it('re-enables a previously-disabled row', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        menu.show(0, 0, [{ text: 'A', enabled: false }]);

        const row = (menu as any)._menuItems[0] as MenuItem;
        expect(row.isEnabled()).toBe(false);

        menu.setItemEnabled(0, true);

        expect(row.isEnabled()).toBe(true);
    });

    it('a disabled row no longer activates on click; a re-enabled one does', () => {
        installTestDOM(CONFIG);

        const action = vi.fn();
        const menu = new Menu();
        menu.show(0, 0, [{ text: 'A', action }]);

        const row = (menu as any)._menuItems[0] as MenuItem;

        menu.setItemEnabled(0, false);
        row.activate();
        expect(action).not.toHaveBeenCalled();

        menu.setItemEnabled(0, true);
        row.activate();
        expect(action).toHaveBeenCalledOnce();
    });

    it("the row's own click listener reads live enabled state, not a construction-time snapshot", () => {
        // Unlike activate() (which already read isEnabled() live pre-fix), this
        // proves the actual bug: MenuItem's `_onClick` closure used to capture
        // `enabled` once at construction, so a later setEnabled() call never
        // reached it. Invoking the private closure directly — the same
        // white-box idiom this file already uses for `_menuItems` — exercises
        // that exact code, independent of whether a real DOM click event can
        // round-trip through the harness's window-level listener for a menu
        // built this late in the file (many earlier tests in this file leave
        // their own rows' click listeners registered, so the harness's shared
        // base listener may already be bound to a different, stale window).
        installTestDOM(CONFIG);

        const action = vi.fn();
        const menu = new Menu();
        menu.show(0, 0, [{ text: 'A', enabled: false, action }]);

        const row = (menu as any)._menuItems[0] as MenuItem;

        (row as any)._onClick();
        expect(action).not.toHaveBeenCalled();

        menu.setItemEnabled(0, true);
        (row as any)._onClick();
        expect(action).toHaveBeenCalledOnce();

        menu.setItemEnabled(0, false);
        (row as any)._onClick();
        expect(action).toHaveBeenCalledOnce();
    });

    it('no-ops on a separator index', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        menu.show(0, 0, [{ text: 'A' }, { separator: true }]);

        expect(() => menu.setItemEnabled(1, false)).not.toThrow();
    });

    it('no-ops on a custom row() factory index — it owns its own enabled state', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        menu.show(0, 0, [{ row: () => new CheckboxMenuRow({ text: 'Bold' }) }]);

        const row = (menu as any)._menuItems[0] as InstanceType<typeof CheckboxMenuRow>;

        expect(() => menu.setItemEnabled(0, false)).not.toThrow();
        expect(row.isEnabled()).toBe(true);
    });

    it('no-ops on an out-of-range index', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        menu.show(0, 0, [{ text: 'A' }]);

        expect(() => menu.setItemEnabled(5, false)).not.toThrow();
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

    it('disposes a closed submenu panel once its close fade completes, not before', () => {
        installTestDOM(CONFIG);
        vi.useFakeTimers();

        try {
            const menu = new Menu();

            menu.show(0, 0, [
                { text: 'Open', action: () => {} },
                { text: 'Export', submenu: { label: 'Export', items: [{ text: 'CSV', action: () => {} }] } },
            ]);

            const exportItem = submenuItem(menu);

            exportItem._onOpenSubmenu(exportItem);

            const submenuPanel = (menu as any)._openSubmenuPanel;
            expect(submenuPanel).toBeInstanceOf(Menu);

            const disposeSpy = vi.spyOn(submenuPanel, 'dispose');

            // Selecting a child leaf tears the submenu down (close(), a fade)
            // — the parent forgets it synchronously, but the instance itself
            // must not be disposed until its fade actually finishes: a
            // one-shot submenu (fresh per open, never reused) that skipped
            // its exit fade would visibly cut it short.
            submenuPanel._onClose();
            expect((menu as any)._openSubmenuPanel).toBeNull();
            expect(disposeSpy).not.toHaveBeenCalled();

            vi.advanceTimersByTime(PAST_SUBMENU_FADE_MS);
            expect(disposeSpy).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
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

describe('Menu closeOnActivate', () => {
    afterEach(() => DOM.reset());

    /** The submenu MenuItem built by a rebuild-mode show(). Mirrors the
     *  helper in 'Menu rebuild-mode submenus'. */
    function submenuItem(menu: Menu): any {
        return (menu as any)._menuItems.find(
            (i: any) => typeof i.hasSubmenu === 'function' && i.hasSubmenu()
        );
    }

    it('default (omitted) still closes the menu and runs action once (rebuild mode)', () => {
        installTestDOM(CONFIG);

        const action = vi.fn();
        const menu = new Menu();

        menu.show(0, 0, [{ text: 'A', action }]);
        expect(LayerManager.getTopLayer()).toBe(menu);

        (menu as any)._menuItems[0].activate();

        expect(action).toHaveBeenCalledOnce();
        expect(LayerManager.getTopLayer()).not.toBe(menu);
    });

    it('closeOnActivate: false runs action and leaves the menu open (rebuild mode)', () => {
        installTestDOM(CONFIG);

        const action = vi.fn();
        const menu = new Menu();

        menu.show(0, 0, [{ text: 'A', closeOnActivate: false, action }]);

        (menu as any)._menuItems[0].activate();

        expect(action).toHaveBeenCalledOnce();
        expect(LayerManager.getTopLayer()).toBe(menu);
    });

    it('toggleFor still toggle-shuts on a second press after a closeOnActivate: false activation', () => {
        installTestDOM(CONFIG);

        const menu    = new Menu();
        const openerA = DOM.sink.createElement('div');
        const trigger = rect(100, 100, 200, 124);
        const action  = vi.fn();
        const configs: MenuItemConfig[] = [{ text: 'A', checked: false, closeOnActivate: false, action }];

        menu.toggleFor(openerA, trigger, configs);
        expect(LayerManager.getTopLayer()).toBe(menu);

        (menu as any)._menuItems[0].activate();
        expect(LayerManager.getTopLayer()).toBe(menu); // still open, per the previous test

        menu.toggleFor(openerA, trigger, configs);
        expect(LayerManager.getTopLayer()).not.toBe(menu);
    });

    it('activating a closeOnActivate: false sibling still tears down an open submenu (rebuild mode)', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();

        menu.show(0, 0, [
            { text: 'Export', submenu: { label: 'Export', items: [{ text: 'CSV', action: () => {} }] } },
            { text: 'Bold', checked: false, closeOnActivate: false, action: () => {} },
        ]);

        const exportItem = submenuItem(menu);
        const boldItem = (menu as any)._menuItems[1];

        exportItem._onOpenSubmenu(exportItem);
        expect((menu as any)._openSubmenuPanel).toBeInstanceOf(Menu);

        boldItem.activate();

        expect((menu as any)._openSubmenuPanel).toBeNull();
        expect(LayerManager.getTopLayer()).toBe(menu);
    });

    it('closeOnActivate: false runs action and does not call onClose (persistent mode)', () => {
        installTestDOM(CONFIG);

        const onClose = vi.fn();
        const action = vi.fn();
        const menu = new Menu([{ text: 'A', checked: false, closeOnActivate: false, action }], onClose);

        menu.focusItem(0);
        menu.activateFocused();

        expect(action).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a closeOnActivate: false leaf inside an open submenu leaves the submenu open (persistent mode)', () => {
        installTestDOM(CONFIG);

        const onClose = vi.fn();
        const action = vi.fn();
        const menu = new Menu([
            { text: 'Export', submenu: { label: 'Export', items: [{ text: 'CSV', checked: false, closeOnActivate: false, action }] } },
        ], onClose);

        const exportItem = submenuItem(menu);

        exportItem._onOpenSubmenu(exportItem);

        const childPanel = (menu as any)._openSubmenuPanel;
        expect(childPanel).toBeInstanceOf(Menu);

        // The child submenu is itself a persistent-mode Menu whose onClose is
        // `() => parentMenu.dismissAll()` (handleItemOpenSubmenu); activate its
        // own closeOnActivate: false leaf directly, mirroring buildMenu's
        // focusItem/activateFocused pattern above but via the child's own item.
        childPanel._menuItems[0].activate();

        // dismissAll() was not reached, so neither the parent's onClose nor the
        // teardown that would null out _openSubmenuPanel ran; the child is still
        // the registered, open top layer.
        expect(action).toHaveBeenCalledOnce();
        expect(onClose).not.toHaveBeenCalled();
        expect((menu as any)._openSubmenuPanel).toBe(childPanel);
        expect(LayerManager.getTopLayer()).toBe(childPanel);
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

    it('reserves a leading check column when any item declares `checked`, aligning every row\'s title', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        menu.show(0, 0, [
            { text: 'One', checked: true },
            { text: 'Two', checked: false },
            { text: 'Three' }, // omits `checked` — still reserves the column; the menu opts in as a whole
        ]);

        const items      = (menu as any)._menuItems.filter((i: any) => i instanceof MenuItem && !i.isSeparator());
        const iconStarts = items.map((i: any) => i._iconStart);
        const checkZones = items.map((i: any) => i._checkZone);

        expect(checkZones.every((z: number) => z === MenuItem.CHECK_ZONE)).toBe(true);
        expect(new Set(iconStarts).size).toBe(1);
        expect(iconStarts[0]).toBe(MenuItem.CHECK_ZONE + MenuItem.TEXT_INSET);
    });

    it('reserves no check column when no item declares `checked`', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        menu.show(0, 0, [{ text: 'One' }, { text: 'Two' }]);

        const items = (menu as any)._menuItems.filter((i: any) => i instanceof MenuItem && !i.isSeparator());

        expect(items.every((i: any) => i._checkZone === 0)).toBe(true);
        expect(items[0]._iconStart).toBe(MenuItem.TEXT_INSET);
    });

    it('sizes a rebuild menu to its content, clamped to the min/max bounds', () => {
        installTestDOM(CONFIG);

        const tiny = new Menu();
        tiny.show(0, 0, [{ text: 'A' }, { text: 'B' }]);

        const wide = new Menu();
        wide.show(0, 0, [{ text: 'X'.repeat(200) }]);

        // Tiny content clamps up to the floor; a very long label clamps to the
        // ceiling. Both bounds are content-based, so the panel's own border
        // is added on top of each.
        expect(tiny.getMenuWidth()).toBe(120 + MENU_BORDER_PX);
        expect(wide.getMenuWidth()).toBeGreaterThan(120 + MENU_BORDER_PX);
        expect(wide.getMenuWidth()).toBeLessThanOrEqual(360 + MENU_BORDER_PX);
    });

    it('grows a viewport-overflowing menu down from the cursor and caps its height to scroll', () => {
        installTestDOM(CONFIG);

        // 60 items far exceed the 800px viewport, so the menu cannot fit.
        const menu  = new Menu();
        const items = Array.from({ length: 60 }, (_, i) => ({ text: `Item ${i}` }));

        menu.show(100, 100, items);

        // The top no longer pins at the margin — it stays at the cursor, and the
        // room BELOW the cursor (696px) is the height cap the overflow scrolls
        // within, rather than pinning to the top margin and covering the cursor.
        expect(menu.getY()).toBe(100);

        const maxHeight = menu.getMaxSize()!.height;

        expect(maxHeight).toBe(696);
        expect(menu.getHeight()).toBeLessThanOrEqual(maxHeight);
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

    it('activateFocused leaves a disabled CheckboxMenuRow\'s isChecked() unchanged', () => {
        installTestDOM(CONFIG);

        let row!: InstanceType<typeof CheckboxMenuRow>;
        const configs: MenuItemConfig[] = [
            { row: () => { row = new CheckboxMenuRow({ text: 'Bold', enabled: false }); return row; } },
        ];
        const menu = new Menu(configs, () => {});

        menu.focusItem(0);
        menu.activateFocused();

        expect(row.isChecked()).toBe(false);

        menu.dispose();
    });

    it('A9. activateFocused notifies a factory-built CheckboxMenuRow\'s action listener and reads the new state', () => {
        installTestDOM(CONFIG);

        const action = vi.fn();
        const menu = new Menu(
            [{ row: () => new CheckboxMenuRow({ text: 'Bold', listeners: { action } }) }],
            () => {}
        );

        menu.focusItem(0);
        menu.activateFocused();

        const row = (menu as any)._menuItems[0] as InstanceType<typeof CheckboxMenuRow>;

        expect(action).toHaveBeenCalledOnce();
        expect(row.isChecked()).toBe(true);

        menu.dispose();
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

describe('Menu as DismissableLayer', () => {
    afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

    it('rebuild show() registers with LayerManager; hide() unregisters', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();

        menu.show(100, 100, [{ text: 'A', action: () => {} }]);

        // The manager owns the dismissal now: a shown menu is the topmost layer.
        expect(LayerManager.getTopLayer()).toBe(menu);

        menu.hide();

        // After hide() the menu is popped from the layer tree.
        expect(LayerManager.getTopLayer()).not.toBe(menu);
    });

    it('persistent open() registers with LayerManager; close() unregisters', () => {
        installTestDOM(CONFIG);

        const menu = new Menu([{ text: 'A', action: () => {} }], () => {});

        menu.open(DOM.sink.createElement('div'));

        expect(LayerManager.getTopLayer()).toBe(menu);

        menu.close();

        expect(LayerManager.getTopLayer()).not.toBe(menu);
    });

    it('dispose() while open unregisters from LayerManager', () => {
        installTestDOM(CONFIG);

        // LayerManager is a module-level singleton with no reset hook, and a
        // few tests elsewhere in this file (`Menu rebuild-mode submenus`)
        // hover a submenu without ever closing the parent, leaving it
        // registered. Drain any such stray layers first so the absolute
        // `toBeNull()` below reflects only this test's own menu.
        let stray = LayerManager.getTopLayer();

        while (stray) {
            LayerManager.unregister(stray);
            stray = LayerManager.getTopLayer();
        }

        const menu = new Menu();

        menu.show(100, 100, [{ text: 'A', action: () => {} }]);
        expect(LayerManager.getTopLayer()).toBe(menu);

        // dispose() bypasses hide()'s fade-then-unregister path entirely —
        // cancelling the fades in destructor() must not leave the menu
        // registered.
        menu.dispose();

        expect(LayerManager.getTopLayer()).toBeNull();
    });

    it('reports the click-outside dismiss mode and the dropdown band', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();

        // No focusin dismissal (matching the old pointerdown + window-blur
        // behaviour); the manager stamps it in the dropdown band.
        expect(menu.getDismissMode()).toBe('click-outside');
        expect(menu.getBand()).toBe(LayerManager.Band.Dropdown);
    });

    it('rebuild getAnchorElement() returns the excluded trigger element', () => {
        installTestDOM(CONFIG);

        const menu    = new Menu();
        const trigger = DOM.sink.createElement('button');

        menu.show(0, 0, [{ text: 'A' }], undefined, trigger);

        // The trigger stays excluded from the manager's outside-pointerdown test
        // so its own press does not immediately re-close the menu.
        expect(menu.getAnchorElement()).toBe(trigger);
    });

    it('persistent getAnchorElement() returns the MenuBar-excluded element', () => {
        installTestDOM(CONFIG);

        const menu      = new Menu([{ text: 'A' }], () => {});
        const barButton = DOM.sink.createElement('button');

        menu.setExcludedElement(barButton);

        expect(menu.getAnchorElement()).toBe(barButton);
    });

    it('requestClose() closes a rebuild menu and fires its per-show onClose', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        let closed = 0;

        menu.show(0, 0, [{ text: 'A' }], () => { closed++; });

        // The manager's advisory close routes through the mode-aware dismissAll:
        // rebuild mode calls hide(), which fires the per-show onClose exactly once.
        menu.requestClose();

        expect(closed).toBe(1);
        expect(LayerManager.getTopLayer()).not.toBe(menu);
    });

    it('requestClose() fires the persistent onClose callback', () => {
        installTestDOM(CONFIG);

        const onClose = vi.fn();
        const menu    = new Menu([{ text: 'A' }], onClose);

        menu.open(DOM.sink.createElement('div'));
        menu.requestClose();

        // Persistent mode routes requestClose to the MenuBar's onClose (which owns
        // the close()/unregister), mirroring the old window-blur / outside path.
        expect(onClose).toHaveBeenCalledOnce();
    });
});

describe('Menu overlay scrollbar — item panel structure and width', () => {
    afterEach(() => DOM.reset());

    // Ten identical items with a right-aligned shortcut, so the natural content
    // width is the same whether the menu fits or scrolls.
    const items: MenuItemConfig[] = Array.from({ length: 10 }, (_, i) => ({
        text:     `Item number ${i}`,
        shortcut: '⌘K',
    }));

    it('has exactly one child: a Panel with autoScroll "y"', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        menu.show(10, 10, items);

        expect(menu.getComponents().length).toBe(1);
        const itemPanel = menu.getComponents()[0] as Panel;
        expect(itemPanel.getAutoScroll()).toBe('y');
        expect(itemPanel.getScrollShadows()).toBe(false);
        const insets = itemPanel.getInsets();
        expect(insets.getTop()).toBe(4);
        expect(insets.getLeft()).toBe(0);
        expect(insets.getBottom()).toBe(4);
        expect(insets.getRight()).toBe(0);

        menu.hide();
    });

    it("Menu's own insets are zero", () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        menu.show(10, 10, items);

        expect(menu.getInsets().getTop()).toBe(0);
        expect(menu.getInsets().getRight()).toBe(0);
        expect(menu.getInsets().getBottom()).toBe(0);
        expect(menu.getInsets().getLeft()).toBe(0);

        menu.hide();
    });

    it('stores rows on the item panel, not the menu', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        menu.show(10, 10, items.slice(0, 5));

        expect(menu.getComponents().length).toBe(1);
        const itemPanel = menu.getComponents()[0] as Panel;
        expect(itemPanel.getComponents().length).toBe(5);

        menu.hide();
    });

    it('no widening when the menu fits without scrolling', () => {
        installTestDOM(CONFIG); // 800px tall — 10 items fit easily

        const menu = new Menu();
        menu.show(10, 10, items);
        menu.flushLayout(); // showAnchored only schedules; getInnerSize needs a flush.

        // No overflow, so the panel reserves no gutter — its inner width is
        // the menu's own width minus only its border, not TRACK_WIDTH too.
        const itemPanel = menu.getComponents()[0] as Panel;
        expect(itemPanel.getInnerSize()!.width).toBe(menu.getWidth() - MENU_BORDER_PX);

        menu.hide();
    });

    it('widens by TRACK_WIDTH when the menu overflows vertically', () => {
        // Measure the natural (non-scrolling) width first.
        installTestDOM(CONFIG);
        const fit = new Menu();
        fit.show(10, 10, items);
        const naturalWidth = fit.getWidth();
        fit.hide();
        DOM.reset();

        // A short viewport forces the same items to overflow and scroll.
        installTestDOM({ ...CONFIG, viewport: { width: 1280, height: 120 } });

        const scroll = new Menu();
        scroll.show(10, 10, items);

        // The menu is widened by TRACK_WIDTH to compensate for the panel's
        // internal gutter reservation, so row content stays at naturalWidth.
        expect(scroll.getWidth()).toBe(naturalWidth + TEST_TRACK_WIDTH);

        scroll.hide();
    });

    it('row content width: item panel reserves the track, so rows stay at natural width', () => {
        installTestDOM({ ...CONFIG, viewport: { width: 1280, height: 120 } });

        // The recording sink has no real layout, so overflow is an injected
        // input — force the panel's own scroll element to report vertical
        // overflow, mirroring tests/core/PanelOverlayScrollbar.test.ts.
        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 200, scrollHeight: 400,
            clientWidth: 200, clientHeight: 100,
        });

        const menu = new Menu();
        menu.show(10, 10, items);
        menu.flushLayout(); // showAnchored only schedules; size the panel to Menu's final width first.

        const itemPanel = menu.getComponents()[0] as Panel;
        itemPanel.doLayout(); // re-derive the gutter from the now-stubbed overflow.

        // The panel's inner width excludes both Menu's border and the track
        // it reserves internally, leaving rows at the width layOutColumns
        // measured them against — never rendering under the bar.
        expect(itemPanel.getInnerSize()!.width).toBe(menu.getWidth() - MENU_BORDER_PX - TEST_TRACK_WIDTH);

        menu.hide();
        vi.restoreAllMocks();
    });

    it('reused menu, fit → scroll: widens on transition', () => {
        installTestDOM({ ...CONFIG, viewport: { width: 1280, height: 120 } });

        const menu = new Menu();

        // First open: three items fit in 120px viewport.
        menu.show(10, 10, items.slice(0, 3));
        const fitWidth = menu.getWidth();
        const fitHeight = menu.getHeight();
        menu.hide();

        // Reopen with all ten items — now overflows.
        menu.show(10, 10, items);
        const scrollWidth = menu.getWidth();

        // The width must widen on this transition, not stay at the first size.
        expect(scrollWidth).toBe(fitWidth + TEST_TRACK_WIDTH);
        expect(menu.getHeight()).toBeGreaterThan(fitHeight);

        menu.hide();
    });

    it('reused menu, scroll → fit: narrows back to natural width', () => {
        installTestDOM({ ...CONFIG, viewport: { width: 1280, height: 120 } });

        const menu = new Menu();

        // First open: many items scroll.
        menu.show(10, 10, items);
        const scrollWidth = menu.getWidth();
        menu.hide();

        // Reopen with just three — fits, no scroll.
        menu.show(10, 10, items.slice(0, 3));
        const fitWidth = menu.getWidth();

        // The widening is never sticky; it must drop back.
        expect(fitWidth).toBe(scrollWidth - TEST_TRACK_WIDTH);

        menu.hide();
    });

    it('setMenuWidth override still wins', () => {
        installTestDOM({ ...CONFIG, viewport: { width: 1280, height: 120 } });

        const menu = new Menu().setMenuWidth(300);
        menu.show(10, 10, items);

        // With explicit width set, the menu is still widened when it overflows.
        expect(menu.getWidth()).toBe(300 + TEST_TRACK_WIDTH);

        menu.hide();
    });

    it('panel preserves structure on overflow', () => {
        // When the menu overflows, the panel manages the scrollbar internally.
        // This test verifies the panel structure is preserved.
        installTestDOM({ ...CONFIG, viewport: { width: 1280, height: 120 } });

        const menu = new Menu();
        menu.show(10, 10, items);

        const itemPanel = menu.getComponents()[0] as Panel;

        // Panel should exist and have the expected configuration
        expect(itemPanel).toBeDefined();
        expect(itemPanel.getAutoScroll()).toBe('y');

        menu.hide();
    });

    it('scrollbar is inside the dismiss subtree', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        menu.show(10, 10, items);

        const itemPanel = menu.getComponents()[0] as Panel;
        const panelEl = itemPanel.getElement();
        const layerEl = menu.getLayerElement();

        // A pointerdown on the panel (and thus the scrollbar) counts as inside
        // the layer, so LayerManager does not dismiss the menu.
        expect(DOM.source.contains(layerEl!, panelEl!)).toBe(true);

        menu.hide();
    });

    it('scroll-to-bottom routes to the item panel', () => {
        installTestDOM({ ...CONFIG, viewport: { width: 1280, height: 120 } });

        const menu = new Menu().setScrollToBottomOnShow(true);
        expect(() => menu.show(10, 10, items)).not.toThrow();

        const itemPanel = menu.getComponents()[0] as Panel;
        expect(typeof itemPanel.getScrollTop()).toBe('number');

        menu.hide();
    });

    it('teardown: second show disposes every row and keeps the panel', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        menu.show(10, 10, items.slice(0, 5));
        menu.hide();

        menu.show(10, 10, items);

        expect(menu.getComponents().length).toBe(1);
        const itemPanel = menu.getComponents()[0] as Panel;
        expect(itemPanel.getComponents().length).toBe(10);

        menu.hide();
    });

    it('flipped side: widens when content overflows above', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        const opener = DOM.sink.createElement('div');
        const trigger = rect(100, 772, 200, 796); // Near bottom of viewport
        const manyItems = Array.from({ length: 60 }, (_, i) => ({ text: `Item ${i}` }));

        // Measure natural width first
        const tempMenu = new Menu();
        tempMenu.show(10, 10, items);
        const naturalWidth = tempMenu.getWidth();
        tempMenu.hide();

        menu.toggleFor(opener, trigger, manyItems);

        // Menu flips and overflows above, so available space and overflow check
        // come from the room above — gutter is still reserved.
        expect(menu.getWidth()).toBe(naturalWidth + TEST_TRACK_WIDTH);
    });

    it('height clamp unchanged: placeVertically returns correct coordinates', () => {
        installTestDOM(CONFIG);

        const anchorTop = 100;
        const totalHeight = 600;
        const vpHeight = 800;
        const growTop = vpHeight - anchorTop - 10; // 690px available below
        const result = placeVertically(new Menu(), growTop, anchorTop, totalHeight, vpHeight);

        // Height clamping logic is unchanged; result should still be valid top coordinate.
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThanOrEqual(0);
    });

    it('persistent mode: open() widens for overflow on top-level dropdown, and the widening is never sticky', () => {
        // One 500px-tall viewport for both opens — reusing an already-rendered
        // component across a DOM.reset() orphans its element handle, so the
        // fits/overflows transition is driven by anchor geometry instead.
        installTestDOM({ ...CONFIG, viewport: { width: 1280, height: 500 } });

        // buildPersistentItems commits the content-fit width at construction,
        // before any open() — this is the un-widened baseline for this exact
        // instance, not a separately-constructed menu with different items.
        const menu = new Menu(items, () => {});
        const naturalWidth = menu.getWidth();

        // A tall anchor spans almost the whole viewport, leaving too little
        // room on either side for the ten items — this open must widen.
        const tallAnchor = new Component();
        tallAnchor.setX(10);
        tallAnchor.setY(10);
        tallAnchor.setWidth(10);
        tallAnchor.setHeight(480);
        menu.open(tallAnchor.getElement(true)!);
        expect(menu.getWidth()).toBe(naturalWidth + TEST_TRACK_WIDTH);
        menu.close();

        // Reopen the SAME instance against a short anchor near the top, where
        // there is plenty of room below — the widening must not stick.
        const shortAnchor = new Component();
        shortAnchor.setX(10);
        shortAnchor.setY(10);
        shortAnchor.setWidth(10);
        shortAnchor.setHeight(24);
        menu.open(shortAnchor.getElement(true)!);
        expect(menu.getWidth()).toBe(naturalWidth);

        menu.close();
    });

    it('persistent mode: placeVertically (submenu) widens for overflow, and leaves the width untouched when content fits', () => {
        installTestDOM({ ...CONFIG, viewport: { width: 1280, height: 120 } });

        const overflowing = new Menu(items, () => {});
        const naturalWidth = overflowing.getWidth();

        // roomBelow (120 - 400, clamped) is far short of totalHeight (600),
        // so this call must widen by TRACK_WIDTH via applyScrollbarGutterWidth.
        placeVertically(overflowing, 50, 400, 600, 120);
        expect(overflowing.getWidth()).toBe(naturalWidth + TEST_TRACK_WIDTH);

        const fitting = new Menu(items, () => {});
        const fittingNaturalWidth = fitting.getWidth();

        // Plenty of room below; content fits without overflowing.
        placeVertically(fitting, 100, 90, 200, 800);
        expect(fitting.getWidth()).toBe(fittingNaturalWidth);
    });
});

describe('Menu rect-anchored toggleFor', () => {
    afterEach(() => DOM.reset());

    it('flips a short menu above a trigger flush at the bottom of the viewport', () => {
        installTestDOM(CONFIG);

        const menu    = new Menu();
        const opener  = DOM.sink.createElement('div');
        const trigger = rect(100, 772, 200, 796);

        menu.toggleFor(opener, trigger, [{ text: 'A' }, { text: 'B' }]);

        // Today it lands over the trigger — this is the bug's regression test.
        expect(menu.getY() + menu.getHeight()).toBe(772);
        expect(menu.getY()).toBeLessThan(772);
    });

    it('a long menu (60 items) flips, clamps to the room above, and scrolls', () => {
        installTestDOM(CONFIG);

        const menu    = new Menu();
        const opener  = DOM.sink.createElement('div');
        const trigger = rect(100, 772, 200, 796);
        const items   = Array.from({ length: 60 }, (_, i) => ({ text: `Item ${i}` }));

        menu.toggleFor(opener, trigger, items);

        expect(menu.getY()).toBe(VIEWPORT_MARGIN);
        expect(menu.getMaxSize()!.height).toBe(772 - VIEWPORT_MARGIN);
        expect(menu.getHeight()).toBeLessThanOrEqual(772 - VIEWPORT_MARGIN);
        // Its bottom never crosses the trigger's top.
        expect(menu.getY() + menu.getHeight()).toBeLessThanOrEqual(772);
    });

    it('opens below a trigger that has room below it', () => {
        installTestDOM(CONFIG);

        const menu    = new Menu();
        const opener  = DOM.sink.createElement('div');
        const trigger = rect(100, 100, 200, 124);

        menu.toggleFor(opener, trigger, [{ text: 'A' }]);

        expect(menu.getY()).toBe(124);
    });

    it('widens by TRACK_WIDTH on the flipped side when the content overflows above', () => {
        installTestDOM(CONFIG);

        const menu    = new Menu();
        const opener  = DOM.sink.createElement('div');
        const trigger = rect(100, 772, 200, 796);
        const items   = Array.from({ length: 60 }, (_, i) => ({ text: `Item ${i}` }));

        // Measure natural width first
        const tempMenu = new Menu();
        tempMenu.show(10, 10, [{ text: 'A' }]);
        const naturalWidth = tempMenu.getWidth();
        tempMenu.hide();

        menu.toggleFor(opener, trigger, items);

        // `available` came from the room above, so the overflow (and therefore
        // the widening) is detected against the correct side.
        expect(menu.getWidth()).toBe(naturalWidth + TEST_TRACK_WIDTH);
    });

    it('clamps the horizontal position without affecting the flipped vertical position', () => {
        installTestDOM(CONFIG);

        const menu    = new Menu();
        const opener  = DOM.sink.createElement('div');
        const trigger = rect(1270, 772, 1290, 796);

        menu.toggleFor(opener, trigger, [{ text: 'A' }]);

        expect(menu.getX()).toBe(1280 - menu.getWidth() - VIEWPORT_MARGIN);
    });

    it('right-aligns to a trigger near the right edge (report 1, horizontal)', () => {
        installTestDOM(CONFIG);

        const menu    = new Menu();
        const opener  = DOM.sink.createElement('div');
        const trigger = rect(1200, 100, 1270, 124);

        menu.toggleFor(opener, trigger, [{ text: 'A' }]);

        // Today it is pushed to 1280 - width - 4 instead of flush with trigger.right.
        expect(menu.getX() + menu.getWidth()).toBe(1270);
        expect(menu.getX()).toBe(1270 - menu.getWidth());
    });

    it('left-aligns to a trigger that has room to its right', () => {
        installTestDOM(CONFIG);

        const menu    = new Menu();
        const opener  = DOM.sink.createElement('div');
        const trigger = rect(100, 100, 200, 124);

        menu.toggleFor(opener, trigger, [{ text: 'A' }]);

        expect(menu.getX()).toBe(100);
    });

    it('toggle identity: same opener closes, a different opener re-shows for it', () => {
        installTestDOM(CONFIG);

        const menu     = new Menu();
        const openerA  = DOM.sink.createElement('div');
        const openerB  = DOM.sink.createElement('div');
        const trigger  = rect(100, 100, 200, 124);

        menu.toggleFor(openerA, trigger, [{ text: 'A' }]);
        expect(LayerManager.getTopLayer()).toBe(menu);

        // hide()'s fade-out defers setVisible(false), but unregister() (the
        // toggle-shut signal) runs synchronously.
        menu.toggleFor(openerA, trigger, [{ text: 'A' }]);
        expect(LayerManager.getTopLayer()).not.toBe(menu);

        menu.toggleFor(openerB, trigger, [{ text: 'A' }]);
        expect(LayerManager.getTopLayer()).toBe(menu);
    });
});

describe('Menu rect-anchored toggleFor — empty-list suppression', () => {
    afterEach(() => DOM.reset());

    it('opens nothing: not the top layer and not mounted', () => {
        installTestDOM(CONFIG);

        const menu    = new Menu();
        const opener  = DOM.sink.createElement('div');
        const trigger = rect(100, 100, 200, 124);

        menu.toggleFor(opener, trigger, []);

        expect(LayerManager.getTopLayer()).not.toBe(menu);
        expect(menu.isVisible()).toBe(false);
    });

    it('contrasts with show(0, 0, []), which still mounts (the deliberate asymmetry)', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();

        menu.show(0, 0, []);

        expect(menu.isVisible()).toBe(true);

        menu.hide();
    });

    it('fires onClose exactly once', () => {
        installTestDOM(CONFIG);

        const menu    = new Menu();
        const opener  = DOM.sink.createElement('div');
        const trigger = rect(100, 100, 200, 124);
        const spy     = vi.fn();

        menu.toggleFor(opener, trigger, [], spy);

        expect(spy).toHaveBeenCalledOnce();
    });

    it('records no opener: the next toggleFor for the same opener opens rather than toggling shut', () => {
        installTestDOM(CONFIG);

        const menu    = new Menu();
        const opener  = DOM.sink.createElement('div');
        const trigger = rect(100, 100, 200, 124);

        menu.toggleFor(opener, trigger, []);
        expect(menu.isVisible()).toBe(false);

        menu.toggleFor(opener, trigger, [{ text: 'A' }]);
        expect(menu.isVisible()).toBe(true);
    });

    it('the toggle-shut branch still wins over the empty check', () => {
        installTestDOM(CONFIG);

        const menu    = new Menu();
        const opener  = DOM.sink.createElement('div');
        const trigger = rect(100, 100, 200, 124);

        menu.toggleFor(opener, trigger, [{ text: 'A' }]);
        expect(LayerManager.getTopLayer()).toBe(menu);

        // A provider that has since gone empty must still close the panel it
        // opened, rather than stranding it open. This fails if the empty check
        // is hoisted above the toggle-shut branch.
        menu.toggleFor(opener, trigger, []);
        expect(LayerManager.getTopLayer()).not.toBe(menu);
    });
});

describe('Menu open() — horizontal placement', () => {
    afterEach(() => DOM.reset());

    // A plain, unattached anchor Component resolves via getElementRect, which
    // reads back its own committed left/top/width/height inline-style writes
    // (TestDOM.getElementRect) — no parent tree needed. getElement(true) forces
    // the render that flushes those buffered writes.
    function anchor(x: number, y: number, width: number, height: number): Handle {
        const el = new Component();

        el.setX(x);
        el.setY(y);
        el.setWidth(width);
        el.setHeight(height);

        return el.getElement(true)!;
    }

    it('top-level, room to the right: left-aligns, unchanged from today', () => {
        installTestDOM(CONFIG);

        const menu = new Menu([{ text: 'A' }], () => {});

        menu.open(anchor(100, 500, 100, 24));

        expect(menu.getX()).toBe(100);
    });

    it("top-level, flips (report-1 shape): right edge flush with the anchor's right", () => {
        installTestDOM(CONFIG);

        // buildPersistentItems commits the content-fit width at construction.
        const menu = new Menu([{ text: 'A' }], () => {});
        const naturalWidth = menu.getWidth();

        // Anchor right edge at 1270 in a 1280px viewport — today this clamps to
        // 1280 - naturalWidth instead of flushing at 1270 - naturalWidth.
        menu.open(anchor(1200, 500, 70, 24));

        expect(menu.getX()).toBe(1270 - naturalWidth);
    });

    it("submenu, room to the right of parent: flush with parent's right edge, unchanged from today", () => {
        installTestDOM(CONFIG);

        const parent = new Menu([{ text: 'A' }], () => {});
        parent.setX(100);
        parent.setWidth(100);
        parent.getElement(true);

        const menu = new Menu([{ text: 'B' }], () => {});

        menu.open(anchor(500, 500, 10, 24), parent);

        expect(menu.getX()).toBe(200);
    });

    it("submenu, flips: flush with parent's left edge", () => {
        installTestDOM(CONFIG);

        const parent = new Menu([{ text: 'A' }], () => {});
        parent.setX(1150);
        parent.setWidth(100);
        parent.getElement(true);

        // buildPersistentItems commits the content-fit width at construction.
        const menu = new Menu([{ text: 'B' }], () => {});
        const naturalWidth = menu.getWidth();

        menu.open(anchor(500, 500, 10, 24), parent);

        expect(menu.getX()).toBe(1150 - naturalWidth);
    });
});

describe('Menu pointer-anchored show — edge flip', () => {
    afterEach(() => DOM.reset());

    it('fits far on both axes: grows down-right from the cursor unchanged', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();

        menu.show(100, 100, [{ text: 'A' }, { text: 'B' }]);

        expect(menu.getX()).toBe(100);
        expect(menu.getY()).toBe(100);
    });

    it('vertical fits-neither-far: flips so the bottom ends at the cursor (report 3, vertical)', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();

        menu.show(100, 790, [{ text: 'A' }, { text: 'B' }]);

        expect(menu.getY() + menu.getHeight()).toBe(790);
        expect(menu.getY()).toBeLessThan(790);
    });

    it('horizontal flips so the right edge ends at the cursor (report 3, horizontal)', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();

        menu.show(1270, 100, [{ text: 'A' }]);

        expect(menu.getX() + menu.getWidth()).toBe(1270);
    });

    it('vertical fits-neither-side: available comes from the landed side, not re-derived from y (the trap)', () => {
        installTestDOM(CONFIG);

        const menu  = new Menu();
        const items = Array.from({ length: 60 }, (_, i) => ({ text: `Item ${i}` }));

        menu.show(100, 790, items);

        // Re-deriving `available` from `y` would give 800 - 4 - 4 = 792, spanning
        // [4, 796] — back over the cursor. The correct room above is 786.
        expect(menu.getY()).toBe(VIEWPORT_MARGIN);
        expect(menu.getMaxSize()!.height).toBe(786);
        expect(menu.getY() + menu.getHeight()).toBeLessThanOrEqual(790);
    });

    it('an out-of-viewport cursor clamps into the viewport before growing down-right', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();

        menu.show(-100, -100, [{ text: 'A' }, { text: 'B' }]);

        // Cursor clamps to (0, 0). Vertically that fits far (positionFlexibleAnchored
        // returns farEdge=0 directly), so y lands exactly at 0. Horizontally
        // positionAligned's `nearEdge >= margin` guard rejects a near-align at 0
        // (< VIEWPORT_MARGIN), and the far-align is off-viewport too, so it falls to
        // the clampAxis fallback and pins at the margin — matching the pre-flip
        // clamp-based pointer path's behaviour for this same call, which also
        // pinned x to the margin (4).
        expect(menu.getX()).toBe(VIEWPORT_MARGIN);
        expect(menu.getY()).toBe(0);
    });

    it('the canonical repro: both axes end at the cursor, which is never covered', () => {
        installTestDOM(CONFIG);

        const menu  = new Menu();
        const items = Array.from({ length: 60 }, (_, i) => ({ text: `Item ${i}` }));

        menu.show(1270, 790, items);

        expect(menu.getX() + menu.getWidth()).toBe(1270);
        expect(menu.getY()).toBe(VIEWPORT_MARGIN);
        expect(menu.getMaxSize()!.height).toBe(786);
        expect(menu.getY() + menu.getHeight()).toBe(790);
    });
});

describe('Menu show(x, y, …) — pointer-anchored regression', () => {
    afterEach(() => DOM.reset());

    it('a long menu stays below the cursor (roomier side) and caps its height to scroll', () => {
        installTestDOM(CONFIG);

        const menu  = new Menu();
        const items = Array.from({ length: 60 }, (_, i) => ({ text: `Item ${i}` }));

        menu.show(100, 100, items);

        // roomFar (800 - 100 - 4 = 696) >= roomNear (100 - 4 = 96): stays below
        // the cursor rather than pinning to the top margin and covering it.
        expect(menu.getY()).toBe(100);
        expect(menu.getMaxSize()!.height).toBe(696);

        const maxHeight = menu.getMaxSize()!.height;

        expect(maxHeight).toBeLessThan(800);
        expect(menu.getHeight()).toBeLessThanOrEqual(maxHeight);
    });

    it('a short menu places its top at the cursor y — never flipped above it', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();

        menu.show(100, 100, [{ text: 'A' }, { text: 'B' }]);

        expect(menu.getY()).toBe(100);
    });
});

// Regression: both showAnchored (rebuild mode) and rebuildPersistentItems
// (persistent mode) only disposed items that passed an `instanceof MenuItem`
// filter, so a MenuSeparator built by showAnchored was never disposed on a
// reshow — leaking one per separator, forever.
describe('Menu item teardown — disposes every replaced item, separators included', () => {
    afterEach(() => DOM.reset());

    it('Menu has exactly one child: the item panel', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        menu.show(0, 0, [{ text: 'A', action: () => {} }, { separator: true }]);

        expect(menu.getComponents().length).toBe(1);

        menu.hide();
    });

    it('M1: a reshow with a separator evicts the prior separator\'s style rule', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();
        menu.show(0, 0, [{ text: 'A', action: () => {} }, { separator: true }]);

        const itemPanel = menu.getComponents()[0] as Panel;
        const oldSeparator = itemPanel.getComponents()[1];
        oldSeparator.getElement(true);
        const id = oldSeparator.getId();
        expect(_ruleCacheKeys().some((k: string) => k.startsWith('#' + id))).toBe(true);

        menu.show(0, 0, [{ text: 'B', action: () => {} }]);

        expect(_ruleCacheKeys().some((k: string) => k.startsWith('#' + id))).toBe(false);
    });

    it('M2: rebuilding a persistent menu evicts every prior MenuItem\'s style rule', () => {
        installTestDOM(CONFIG);

        const menu = new Menu([{ text: 'A', action: () => {} }], () => {});
        const itemPanel = menu.getComponents()[0] as Panel;
        const oldItems = itemPanel.getComponents().slice();
        oldItems.forEach((item) => item.getElement(true));
        const ids = oldItems.map((item) => item.getId());

        expect(ids.some((id: string) => _ruleCacheKeys().some((k: string) => k.startsWith('#' + id)))).toBe(true);

        (menu as any).rebuildPersistentItems([
            { text: 'B', action: () => {} },
            { text: 'C', action: () => {}, separator: true },
        ]);

        expect(ids.some((id: string) => _ruleCacheKeys().some((k: string) => k.startsWith('#' + id)))).toBe(false);
    });
});

/**
 * A bare MenuRow subclass with test-configurable navigability, check-column
 * participation, and content width; also records every `setColumns` call so
 * the column-geometry tests can compare the triple a custom row received
 * against its sibling MenuItems'.
 */
class TestRow extends MenuRow {
    activateCalls: number = 0;
    setColumnsCalls: Array<[number, number, number]> = [];

    private readonly _navigable: boolean;
    private readonly _check: boolean;
    private readonly _contentWidth: number;

    constructor(opts?: { navigable?: boolean; hasCheck?: boolean; contentWidth?: number }) {
        super();

        this._navigable    = opts?.navigable ?? false;
        this._check        = opts?.hasCheck ?? false;
        this._contentWidth = opts?.contentWidth ?? 0;
    }

    isNavigable(): boolean {
        return this._navigable;
    }

    hasCheck(): boolean {
        return this._check;
    }

    getContentWidth(): number {
        return this._contentWidth;
    }

    setColumns(checkZone: number, iconStart: number, titleColumn: number): void {
        this.setColumnsCalls.push([checkZone, iconStart, titleColumn]);
    }

    activate(): void {
        this.activateCalls++;
    }
}

/** Exposes the protected `closeMenu()`, for the injected-close-handler assertion. */
class ClosingTestRow extends MenuRow {
    triggerClose(): void {
        this.closeMenu();
    }
}

describe('Menu custom rows', () => {
    afterEach(() => DOM.reset());

    it('builds the row from the factory exactly once and registers it as a child on the item panel', () => {
        installTestDOM(CONFIG);

        const factory = vi.fn(() => new TestRow());
        const menu = new Menu();

        menu.show(0, 0, [{ row: factory }]);

        expect(factory).toHaveBeenCalledOnce();

        const row = factory.mock.results[0].value;
        const itemPanel = menu.getComponents()[0] as Panel;
        expect(itemPanel.getComponents()).toContain(row);
        expect((menu as any)._menuItems).toContain(row);
    });

    it('disposes the previous factory row and calls the new factory on reshow', () => {
        installTestDOM(CONFIG);

        const menu = new Menu();

        menu.show(0, 0, [{ row: () => new TestRow() }]);

        const oldRow = (menu as any)._menuItems[0];
        // `backgroundColor` is a conditional declaration, never hoisted onto the
        // class rule, so it is what gives the row a per-instance `#id` rule for
        // the reshow to dispose — a stock row now materialises none at all.
        oldRow.setBackgroundColor('#fff');
        oldRow.getElement(true);
        const id = oldRow.getId();
        expect(_ruleCacheKeys().some((k: string) => k.startsWith('#' + id))).toBe(true);

        const secondFactory = vi.fn(() => new TestRow());
        menu.show(0, 0, [{ row: secondFactory }]);

        expect(_ruleCacheKeys().some((k: string) => k.startsWith('#' + id))).toBe(false);
        expect(secondFactory).toHaveBeenCalledOnce();
    });

    it('separator wins over row: builds a MenuSeparator and never calls the factory', () => {
        installTestDOM(CONFIG);

        const factory = vi.fn(() => new TestRow());
        const menu = new Menu();

        menu.show(0, 0, [{ separator: true, row: factory }]);

        expect(factory).not.toHaveBeenCalled();
        expect((menu as any)._menuItems[0]).toBeInstanceOf(MenuSeparator);
    });

    it('A11. separator wins over row in persistent mode too: builds a MenuSeparator and never calls the factory', () => {
        installTestDOM(CONFIG);

        // Both build loops now build a MenuSeparator for `separator: true` —
        // see the config-entry table in the plan's Architecture Decisions.
        // The precedence under test here is only that `row` does not preempt
        // that path when both fields are set.
        const factory = vi.fn(() => new TestRow());
        const menu = new Menu([{ separator: true, row: factory }], () => {});

        const row = (menu as any)._menuItems[0];

        expect(factory).not.toHaveBeenCalled();
        expect(row).toBeInstanceOf(MenuSeparator);
        expect(row.isSeparator()).toBe(true);
    });

    it('A10. persistent mode builds a MenuSeparator for a plain separator entry', () => {
        installTestDOM(CONFIG);

        const menu = new Menu([{ text: 'A' }, { separator: true }], () => {});

        const row = (menu as any)._menuItems[1];

        expect(row).toBeInstanceOf(MenuSeparator);
        expect(row.isSeparator()).toBe(true);
        expect(row.getPreferredSize()!.height).toBe(MenuSeparator.HEIGHT);
    });

    it('row wins over the plain-item fields: builds the factory row and never calls action', () => {
        installTestDOM(CONFIG);

        const action  = vi.fn();
        const factory = vi.fn(() => new TestRow());
        const menu    = new Menu();

        menu.show(0, 0, [{ row: factory, text: 'Bold', action }]);

        expect((menu as any)._menuItems[0]).toBe(factory.mock.results[0].value);
        expect(action).not.toHaveBeenCalled();
    });

    describe('column geometry', () => {
        it('floors the panel width with iconStart plus the widest custom row content, clamped to the ceiling', () => {
            installTestDOM(CONFIG);

            // { text: 'Bold' } + a row reporting 300: the MenuItem-only natural
            // width is well under it, so the custom row's report wins. Neither
            // row declares `checked`/an icon, so iconStart is bare TEXT_INSET —
            // getContentWidth() excludes that inset, and Menu adds it back.
            const menu300 = new Menu();
            menu300.show(0, 0, [{ text: 'Bold' }, { row: () => new TestRow({ contentWidth: 300 }) }]);
            expect(menu300.getMenuWidth()).toBe(MenuItem.TEXT_INSET + 300 + MENU_BORDER_PX);

            // A row reporting 900 clamps to the MAX_MENU_WIDTH ceiling (360),
            // plus the panel's own border, regardless of iconStart.
            const menu900 = new Menu();
            menu900.show(0, 0, [{ text: 'Bold' }, { row: () => new TestRow({ contentWidth: 900 }) }]);
            expect(menu900.getMenuWidth()).toBe(360 + MENU_BORDER_PX);

            // A row reporting 0 contributes nothing past iconStart: the width
            // is whatever the MenuItem alone produced.
            const itemOnly = new Menu();
            itemOnly.show(0, 0, [{ text: 'Bold' }]);

            const itemPlusZero = new Menu();
            itemPlusZero.show(0, 0, [{ text: 'Bold' }, { row: () => new TestRow({ contentWidth: 0 }) }]);
            expect(itemPlusZero.getMenuWidth()).toBe(itemOnly.getMenuWidth());
        });

        it('a custom row\'s content is measured past the ACTUAL iconStart, widened by a sibling\'s `checked`', () => {
            installTestDOM(CONFIG);

            // A checkable sibling MenuItem widens the shared iconStart by
            // CHECK_ZONE beyond the row's own bare-TEXT_INSET assumption —
            // getContentWidth() must not bake in TEXT_INSET itself, or the
            // panel undershoots by CHECK_ZONE and the row's real content clips.
            const menu = new Menu();
            menu.show(0, 0, [
                { text: 'Bold', checked: true },
                { row: () => new TestRow({ contentWidth: 300 }) },
            ]);

            expect(menu.getMenuWidth()).toBe(MenuItem.CHECK_ZONE + MenuItem.TEXT_INSET + 300 + MENU_BORDER_PX);
        });

        it('every non-separator row receives the same setColumns triple, custom rows included', () => {
            installTestDOM(CONFIG);

            const menu = new Menu();
            menu.show(0, 0, [
                { text: 'Short' },
                { text: 'A much longer title' },
                { row: () => new TestRow() },
            ]);

            const rows    = (menu as any)._menuItems;
            const testRow = rows.find((r: any) => r instanceof TestRow) as TestRow;
            const items   = rows.filter((r: any) => r instanceof MenuItem);

            const [checkZone, iconStart, titleColumn] = testRow.setColumnsCalls.at(-1)!;

            expect(items.every((i: any) =>
                i._checkZone === checkZone && i._iconStart === iconStart && i._titleColumn === titleColumn
            )).toBe(true);
        });

        it('a custom row reporting hasCheck() widens the sibling MenuItems’ iconStart by CHECK_ZONE', () => {
            installTestDOM(CONFIG);

            const withoutCheck = new Menu();
            withoutCheck.show(0, 0, [{ text: 'Bold' }]);
            const baseIconStart = (withoutCheck as any)._menuItems[0]._iconStart;

            const withCheck = new Menu();
            withCheck.show(0, 0, [{ text: 'Bold' }, { row: () => new TestRow({ hasCheck: true }) }]);
            const widenedItem = (withCheck as any)._menuItems.find((r: any) => r instanceof MenuItem);

            expect(widenedItem._iconStart).toBe(baseIconStart + MenuItem.CHECK_ZONE);
        });

        it('a CheckboxMenuRow driving the panel width gets its full checkbox width, not clipped by the panel border', () => {
            installTestDOM(CONFIG);

            // A label long enough that this row's own getContentWidth() (not a
            // MenuItem title) drives the panel's natural width — the regime in
            // which the panel's border previously starved the row's content box
            // by MENU_BORDER_PX, silently clipping the checkbox's unellipsized
            // label (see layOutColumns's comment).
            let row!: InstanceType<typeof CheckboxMenuRow>;
            const menu = new Menu();
            menu.show(0, 0, [
                { text: 'Bold' },
                {
                    row: () => {
                        row = new CheckboxMenuRow({ text: 'A label long enough to drive the panel width' });
                        return row;
                    },
                },
            ]);

            menu.flushLayout();

            const checkbox = row.getComponents()[0] as any;

            expect(checkbox.getWidth()).toBeGreaterThanOrEqual(checkbox.getPreferredSize()!.width);
        });
    });

    describe('keyboard traversal (persistent mode)', () => {
        function buildMenuWithRow(navigable: boolean): { menu: Menu; row: TestRow } {
            const row = new TestRow({ navigable });
            const configs: MenuItemConfig[] = [
                { text: 'A' },
                { row: () => row },
                { text: 'B' },
            ];

            return { menu: new Menu(configs, () => {}), row };
        }

        it('focusNext/focusPrev skip a non-navigable custom row', () => {
            installTestDOM(CONFIG);

            const { menu } = buildMenuWithRow(false);

            menu.focusItem(0);
            menu.focusNext();
            expect(menu.getFocusedIndex()).toBe(2);

            menu.focusItem(2);
            menu.focusPrev();
            expect(menu.getFocusedIndex()).toBe(0);
        });

        it('focusNext lands on a navigable custom row, and activateFocused calls its activate()', () => {
            installTestDOM(CONFIG);

            const { menu, row } = buildMenuWithRow(true);

            menu.focusItem(0);
            menu.focusNext();
            expect(menu.getFocusedIndex()).toBe(1);

            menu.activateFocused();
            expect(row.activateCalls).toBe(1);
        });

        it('activateFocused calls nothing for a non-navigable custom row even when directly focused', () => {
            installTestDOM(CONFIG);

            const { menu, row } = buildMenuWithRow(false);

            menu.focusItem(1);
            menu.activateFocused();

            expect(row.activateCalls).toBe(0);
        });
    });

    it('activating a CheckboxMenuRow leaves an open rebuild-mode menu open; the injected close handler does close it', () => {
        installTestDOM(CONFIG);

        let closingRow!: ClosingTestRow;
        const menu = new Menu();

        menu.show(0, 0, [
            { row: () => new CheckboxMenuRow({ text: 'Bold' }) },
            { row: () => { closingRow = new ClosingTestRow(); return closingRow; } },
        ]);

        expect(LayerManager.getTopLayer()).toBe(menu);

        const checkboxRow = (menu as any)._menuItems[0];
        checkboxRow.activate();

        expect(LayerManager.getTopLayer()).toBe(menu);

        closingRow.triggerClose();

        expect(LayerManager.getTopLayer()).not.toBe(menu);
    });
});
