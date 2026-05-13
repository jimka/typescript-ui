// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Text } from "./Base/component/Text.js";
import { VBox } from "./Base/layout/VBox.js";
import { MenuBar } from "./Base/component/menubar/MenuBar.js";
import { Panel } from "./Base/Panel.js";
import { callable } from "./Base/Callable.js";

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
                items: [
                    { text: "New",      shortcut: "Ctrl+N",       action: () => status("File → New")     },
                    { text: "Open…",    shortcut: "Ctrl+O",       action: () => status("File → Open")    },
                    { separator: true },
                    { text: "Save",     shortcut: "Ctrl+S",       action: () => status("File → Save")    },
                    { text: "Save As…", shortcut: "Ctrl+Shift+S", action: () => status("File → Save As") },
                    { separator: true },
                    {
                        text: "Export",
                        submenu: {
                            label: "Export",
                            items: [
                                { text: "As PDF",  action: () => status("File → Export → PDF")  },
                                { text: "As HTML", action: () => status("File → Export → HTML") },
                                { text: "As CSV",  action: () => status("File → Export → CSV")  },
                            ],
                        },
                    },
                    { separator: true },
                    { text: "Quit", shortcut: "Alt+F4", enabled: false },
                ],
            },
            {
                label: "Edit",
                items: [
                    { text: "Undo",  shortcut: "Ctrl+Z", action: () => status("Edit → Undo")  },
                    { text: "Redo",  shortcut: "Ctrl+Y", action: () => status("Edit → Redo")  },
                    { separator: true },
                    { text: "Cut",   shortcut: "Ctrl+X", action: () => status("Edit → Cut")   },
                    { text: "Copy",  shortcut: "Ctrl+C", action: () => status("Edit → Copy")  },
                    { text: "Paste", shortcut: "Ctrl+V", action: () => status("Edit → Paste") },
                    { separator: true },
                    { text: "Select All", shortcut: "Ctrl+A", action: () => status("Edit → Select All") },
                ],
            },
            {
                label: "View",
                items: [
                    { text: "Zoom In",    shortcut: "Ctrl++", action: () => status("View → Zoom In")    },
                    { text: "Zoom Out",   shortcut: "Ctrl+-", action: () => status("View → Zoom Out")   },
                    { text: "Reset Zoom", shortcut: "Ctrl+0", action: () => status("View → Reset Zoom") },
                    { separator: true },
                    { text: "Full Screen", shortcut: "F11", action: () => status("View → Full Screen") },
                ],
            },
            {
                label: "Help",
                items: [
                    { text: "Documentation", action: () => status("Help → Documentation") },
                    { text: "Keyboard Shortcuts", action: () => status("Help → Keyboard Shortcuts") },
                    { separator: true },
                    { text: "About", action: () => status("Help → About") },
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
