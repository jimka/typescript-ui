import { describe, it, expect, afterEach, vi } from 'vitest';
import { Menu } from '~/overlay/Menu';
import { MenuItem, MenuItemConfig } from '~/component/container/MenuItem';
import { DOM } from '~/core/DOM';
import type { Rect } from '~/core/DOM';
import { LayerManager } from '~/core/LayerManager';
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

describe('Menu vertical-scroll scrollbar gutter', () => {
    afterEach(() => DOM.reset());

    // Ten identical items with a right-aligned shortcut, so the natural content
    // width is the same whether the menu fits or scrolls.
    const items: MenuItemConfig[] = Array.from({ length: 10 }, (_, i) => ({
        text:     `Item number ${i}`,
        shortcut: '⌘K',
    }));

    it('reserves no gutter when the menu fits without scrolling', () => {
        installTestDOM(CONFIG); // 800px tall — 10 * 24px items fit easily

        const menu = new Menu();
        menu.show(10, 10, items);

        expect(menu.getInsets().getRight()).toBe(0);

        menu.hide();
    });

    it('reserves a scrollbar-width right gutter when the menu overflows vertically', () => {
        // Measure the natural (non-scrolling) width of the same items first.
        installTestDOM(CONFIG);
        const fit = new Menu();
        fit.show(10, 10, items);
        const naturalWidth = fit.getWidth();
        expect(fit.getInsets().getRight()).toBe(0);
        fit.hide();
        DOM.reset();

        // A short viewport forces the same items to overflow and scroll.
        installTestDOM({ ...CONFIG, viewport: { width: 1280, height: 120 } });
        const sbw = DOM.source.getScrollBarWidth();
        expect(sbw).toBeGreaterThan(0);

        const scroll = new Menu();
        scroll.show(10, 10, items);

        // The gutter is reserved as a right inset so items never lay out under
        // the native scrollbar, and the panel is widened to keep the item
        // content area at its natural width.
        expect(scroll.getInsets().getRight()).toBe(sbw);
        expect(scroll.getWidth()).toBe(naturalWidth + sbw);
        expect(scroll.getWidth() - scroll.getInsets().getRight()).toBe(naturalWidth);

        scroll.hide();
    });

    it('shows cleanly with scroll-to-bottom enabled (bottom offset verified live)', () => {
        // TestDOM reports scrollHeight === clientHeight, so the browser's
        // clamp-to-bottom is not observable offline; this guards that enabling
        // the option exercises the flush + setScrollTop path without throwing.
        installTestDOM({ ...CONFIG, viewport: { width: 1280, height: 120 } });

        const menu = new Menu().setScrollToBottomOnShow(true);
        expect(() => menu.show(10, 10, items)).not.toThrow();
        expect(typeof menu.getScrollTop()).toBe('number');

        menu.hide();
    });

    it('reserves the gutter when a reused menu grows from fitting to scrolling', () => {
        installTestDOM({ ...CONFIG, viewport: { width: 1280, height: 120 } });
        const sbw = DOM.source.getScrollBarWidth();

        const menu = new Menu();

        // First open: three 24px items in a 120px viewport — fits, no gutter.
        menu.show(10, 10, items.slice(0, 3));
        expect(menu.getInsets().getRight()).toBe(0);
        const fitHeight = menu.getHeight();
        menu.hide();

        // Reopen the SAME instance with all ten items — now overflows. The gutter
        // must be reserved on this transition too (not just on a fresh instance),
        // and the panel must grow to fill the available height rather than staying
        // stuck at the first, shorter size.
        menu.show(10, 10, items);
        expect(menu.getInsets().getRight()).toBe(sbw);
        expect(menu.getHeight()).toBeGreaterThan(fitHeight);

        menu.hide();
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

    it('reserves the scrollbar gutter on the flipped side when the content overflows above', () => {
        installTestDOM(CONFIG);

        const menu    = new Menu();
        const opener  = DOM.sink.createElement('div');
        const trigger = rect(100, 772, 200, 796);
        const items   = Array.from({ length: 60 }, (_, i) => ({ text: `Item ${i}` }));

        menu.toggleFor(opener, trigger, items);

        // `available` came from the room above, so the overflow (and therefore
        // the gutter) is detected against the correct side.
        expect(menu.getInsets().getRight()).toBe(DOM.source.getScrollBarWidth());
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
