import { Panel } from '@jimka/typescript-ui/core';
import type { MenuItemConfig } from '@jimka/typescript-ui/component/container';
import { Header } from '@jimka/typescript-ui/component/display';
import { Border } from '@jimka/typescript-ui/layout';
import { Menu } from '@jimka/typescript-ui/overlay';
import { Placement } from '@jimka/typescript-ui/primitive';
import { appMenuBar, appToolBar, noCommand } from '../builders/chrome.js';
import { elementFor, requireElement } from '../builders/dom.js';
import type { HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

/** The panel's id, for errors. */
const PANEL = 'menus';

// Where the context menu opens, in viewport pixels: on the canvas, clear of
// the menu bar above and the toolbar below, as a right-click there opens it.
const CONTEXT_X = 240;
const CONTEXT_Y = 160;

export const description = 'A menu bar and a toolbar around a header, and a rebuild-mode context Menu of n rows (default 12) opened and closed by toggle. Reproduces slice 12 F12.3 (one menu open rebuilds its rows and crosses the read and rule-write boundary several times): per toggle unit, sink/u 412, ensureStyleRule 6, setRuleStyles 7, deleteStyleRule 6, measureTexts 0.5 and no measureText; and C24 (MenuBar ignores its 1 px border): geometry.menubarButton reaches the bar\'s bottom border.';

/** Twelve rows: slice 12's context menu. */
export const defaultScale = 12;

/** Opening and closing the context menu, on alternate units. */
export const defaultDrive = 'toggle';

/**
 * Builds a menu bar over a header over a toolbar, and a context menu of `n`
 * rows, opened once and closed again after mounting so every measured open
 * is a re-open.
 *
 * @param n - Rows in the context menu.
 * @returns The border panel as root; `toggle`, which opens the context menu on even units and closes it on odd ones; and `afterMount` giving `hover` the menu bar and `click` its first button.
 */
export function build(n: number): PanelBuild {
    const menuBar = appMenuBar();
    const menu = Menu();
    const rows: MenuItemConfig[] = Array.from({ length: n }, (_, i) => ({ text: `Command ${i + 1}`, action: noCommand }));

    const root = Panel({
        layoutManager: Border(),
        components: [
            { component: menuBar, constraints: { placement: Placement.NORTH } },
            { component: Header('Canvas'), constraints: { placement: Placement.CENTER } },
            { component: appToolBar(), constraints: { placement: Placement.SOUTH } },
        ],
    });

    return {
        root,
        targets: {
            toggle: function toggleMenu(index: number): void {
                if (index % 2 === 0) {
                    menu.show(CONTEXT_X, CONTEXT_Y, rows);
                } else {
                    menu.hide();
                }
            },
        },
        afterMount: (tools: HarnessTools): Record<string, unknown> => {
            menu.show(CONTEXT_X, CONTEXT_Y, rows);
            menu.hide();

            const menuBarElement = elementFor(tools, menuBar, PANEL);

            return {
                hover: { element: menuBarElement, axis: 'x' },
                click: { elements: [requireElement(menuBarElement, '.MenuBarButton', PANEL)] },
            };
        },
        geometry: { menubar: '.MenuBar', menubarButton: '.MenuBarButton' },
        describe: () => ({ rows: n }),
    };
}
