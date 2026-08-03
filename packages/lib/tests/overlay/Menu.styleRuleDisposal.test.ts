// Regression: `Menu._openSubmenuPanel` (Menu.ts:132) is a raw field, never a
// registered child of its parent `Menu` — no `Menu` anywhere in the library
// is ever registered via `addComponent` (see the class comment at Menu.ts:120),
// and a submenu is itself a `Menu`, built in `handleItemOpenSubmenu`
// (Menu.ts:1087). `closeOpenSubmenu()` (Menu.ts:985) only runs from `hide()`
// / `close()`, never from `destructor()`, so a `Menu` disposed directly while
// a submenu is open left the submenu, and every `MenuItem` it built, on the
// shared sheet forever. This is the case a scan of the parent's own
// `_menuItems` cannot see, since the submenu was never one of them.
//
// Mirrors the harness in tests/overlay/Menu.test.ts's "Menu rebuild-mode
// submenus" block and the `_ruleCacheKeys()` pattern in
// tests/overlay/Dock.styleRuleDisposal.test.ts.
// See plans/implemented/table-tab-close-residual-leak.md.
import { describe, it, expect, afterEach } from 'vitest';
import { Menu } from '~/overlay/Menu';
import type { MenuItemConfig } from '~/component/container/MenuItem';
import { DOM } from '~/core/DOM';
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

afterEach(() => DOM.reset());

/** The submenu MenuItem built by a rebuild-mode show(), mirroring Menu.test.ts. */
function submenuItem(menu: Menu): any {
    return (menu as any)._menuItems.find(
        (i: any) => typeof i.hasSubmenu === 'function' && i.hasSubmenu()
    );
}

/**
 * Builds a rebuild-mode menu with one plain item and one submenu item, opens
 * the submenu, and returns the parent menu plus every id the submenu and its
 * own items registered — captured before `dispose()` so the ids are known
 * even after the components they name are torn down.
 */
function menuWithOpenSubmenu(): { menu: Menu; submenuIds: string[] } {
    const menu = new Menu();
    const items: MenuItemConfig[] = [
        { text: 'Open', action: () => {} },
        { text: 'Export', submenu: { label: 'Export', items: [{ text: 'CSV', action: () => {} }] } },
    ];

    menu.show(0, 0, items);

    const exportItem = submenuItem(menu);

    exportItem._onOpenSubmenu(exportItem);

    const submenuPanel = (menu as any)._openSubmenuPanel as Menu;

    expect(submenuPanel).toBeInstanceOf(Menu);

    const submenuIds = [
        submenuPanel.getId(),
        ...(submenuPanel as any)._menuItems.map((i: any) => i.getId()),
    ];

    return { menu, submenuIds };
}

describe('Menu — open-submenu style-rule disposal', () => {
    it('dispose() while a submenu is open leaves neither the parent nor the submenu behind', () => {
        installTestDOM(CONFIG);

        // Warm-up pass, mirroring the registry harness: keeps any process-global
        // rule these classes materialise on first use out of the diff below.
        {
            const { menu } = menuWithOpenSubmenu();

            menu.dispose();
        }

        const before = new Set(_ruleCacheKeys());

        const { menu, submenuIds } = menuWithOpenSubmenu();
        const parentId = menu.getId();

        // The submenu really was built — otherwise the assertions below would
        // pass against a menu that never opened one.
        expect(submenuIds.length).toBeGreaterThan(0);

        // dispose() alone, not hide() first — hide()'s own closeOpenSubmenu()
        // call is not the mechanism under test here.
        menu.dispose();

        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));

        expect(leaked.some((key) => key.includes(parentId))).toBe(false);

        for (const id of submenuIds) {
            expect(leaked.some((key) => key.includes(id))).toBe(false);
        }
    });
});
