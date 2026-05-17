// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { Text } from '@jimka/typescript-ui/component/input';
import { MenuBar } from '@jimka/typescript-ui/component/menubar';
import { Glyph } from '@jimka/typescript-ui/component/display';
import {
    file,
    pen_to_square,
    circle_check,
    angles_right,
    angle_left,
    angle_right,
    ban,
    plus,
    minus,
    eye,
    arrows_rotate,
    maximize,
    circle_info,
} from '@jimka/typescript-ui/glyphs/solid';

Glyph.register(
    file, pen_to_square, circle_check, angles_right, angle_left, angle_right,
    ban, plus, minus, eye, arrows_rotate, maximize, circle_info,
);
/**
 * Demo panel showcasing the `MenuBar` component.
 *
 * Demonstrates: top-level menus, separators, disabled items, keyboard shortcut hints,
 * submenu nesting, quick-switch hover, and keyboard navigation.
 */
class MenuBarPanel extends Panel {

    /**
     * Constructs the demo panel and wires up a sample menu bar.
     */
    constructor() {
        super();

        this.setLayoutManager(new VBox());

        const bar = new MenuBar();
        const statusText = new Text("Click a menu item to see it here.");

        const status = (msg: string): void => {
            statusText.setText("Last action: " + msg);
        };

        bar.setMenus([
            {
                label: "File",
                glyph: "file",
                items: [
                    { text: "New",      glyph: "file",          shortcut: "Ctrl+N",       action: () => status("File → New")     },
                    { text: "Open…",    glyph: "pen-to-square", shortcut: "Ctrl+O",       action: () => status("File → Open")    },
                    { separator: true },
                    { text: "Save",     glyph: "circle-check",  shortcut: "Ctrl+S",       action: () => status("File → Save")    },
                    { text: "Save As…", glyph: "circle-check",  shortcut: "Ctrl+Shift+S", action: () => status("File → Save As") },
                    { separator: true },
                    {
                        text:  "Export",
                        glyph: "angles-right",
                        submenu: {
                            label: "Export",
                            items: [
                                { text: "As PDF",  glyph: "file", action: () => status("File → Export → PDF")  },
                                { text: "As HTML", glyph: "file", action: () => status("File → Export → HTML") },
                                { text: "As CSV",  glyph: "file", action: () => status("File → Export → CSV")  },
                            ],
                        },
                    },
                    { separator: true },
                    { text: "Quit", glyph: "ban", shortcut: "Alt+F4", enabled: false },
                ],
            },
            {
                label: "Edit",
                glyph: "pen-to-square",
                items: [
                    { text: "Undo",  glyph: "angle-left",  shortcut: "Ctrl+Z", action: () => status("Edit → Undo")  },
                    { text: "Redo",  glyph: "angle-right", shortcut: "Ctrl+Y", action: () => status("Edit → Redo")  },
                    { separator: true },
                    { text: "Cut",   glyph: "minus",       shortcut: "Ctrl+X", action: () => status("Edit → Cut")   },
                    { text: "Copy",  glyph: "plus",        shortcut: "Ctrl+C", action: () => status("Edit → Copy")  },
                    { text: "Paste", glyph: "plus",        shortcut: "Ctrl+V", action: () => status("Edit → Paste") },
                    { separator: true },
                    { text: "Select All", glyph: "circle-check", shortcut: "Ctrl+A", action: () => status("Edit → Select All") },
                ],
            },
            {
                label: "View",
                glyph: "eye",
                items: [
                    { text: "Zoom In",    glyph: "plus",   shortcut: "Ctrl++", action: () => status("View → Zoom In")    },
                    { text: "Zoom Out",   glyph: "minus",  shortcut: "Ctrl+-", action: () => status("View → Zoom Out")   },
                    { text: "Reset Zoom", glyph: "arrows-rotate",   shortcut: "Ctrl+0", action: () => status("View → Reset Zoom") },
                    { separator: true },
                    { text: "Full Screen", glyph: "maximize", shortcut: "F11",   action: () => status("View → Full Screen") },
                ],
            },
            {
                label: "Help",
                glyph: "circle-info",
                items: [
                    { text: "Documentation",      glyph: "file",          action: () => status("Help → Documentation") },
                    { text: "Keyboard Shortcuts", glyph: "pen-to-square", action: () => status("Help → Keyboard Shortcuts") },
                    { separator: true },
                    { text: "About",              glyph: "circle-info",   action: () => status("Help → About") },
                ],
            },
        ]);

        this.addComponent(bar);
        this.addComponent(statusText);
    }
}

const MenuBarPanelCallable = callable(MenuBarPanel);
type MenuBarPanelCallable = MenuBarPanel;
export {
    MenuBarPanel         as _MenuBarPanel,
    MenuBarPanelCallable as MenuBarPanel
};
