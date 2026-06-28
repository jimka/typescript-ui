// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { HBox } from "~/layout/HBox.js";
import { MenuBarButton, MENU_BAR_BUTTON_HEIGHT } from "~/component/menubar/MenuBarButton.js";
import { Menu } from "~/overlay/Menu.js";
import { MenuConfig } from "~/component/container/MenuItem.js";
import { callable } from "~/core/Callable.js";

/**
 * A persistent horizontal menu bar that hosts top-level dropdown menus.
 *
 * `setMenus()` populates the bar with [`MenuBarButton`](/api/component/menubar/classes/MenuBarButton) children. Clicking a button
 * opens the corresponding [`Menu`](/api/overlay/classes/Menu) dropdown. While any dropdown is open,
 * hovering another button switches menus immediately (quick-switch mode), and
 * keyboard navigation (Arrow keys, Enter, Escape) is handled via a viewport-level
 * keydown listener.
 *
 * @example
 * ```typescript
 * const bar = new MenuBar();
 * bar.setMenus([
 *     { label: 'File', items: [
 *         { text: 'New', shortcut: 'Ctrl+N', action: () => newDoc() },
 *         { separator: true },
 *         { text: 'Quit', enabled: false },
 *     ]},
 *     { label: 'Edit', items: [
 *         { text: 'Undo', shortcut: 'Ctrl+Z', action: () => undo() },
 *     ]},
 * ]);
 * container.addComponent(bar);
 * ```
 *
 * @category Components
 */
class MenuBar extends Component {

    private readonly _buttons: MenuBarButton[] = [];
    private readonly _panels: Menu[] = [];
    private _openIndex: number = -1;
    private _quickSwitchActive: boolean = false;
    private _keydownListening: boolean = false;

    private readonly _onKeyDown: (e: KeyboardEvent) => void;

    /**
     * Constructs an empty `MenuBar`. Call `setMenus()` to populate it.
     */
    constructor() {
        super();

        const hbox = new HBox();
        hbox.setComponentSpacing(0);
        hbox.setStretching(true);
        this.setLayoutManager(hbox);

        this.setBackgroundColor("var(--ts-ui-menu-bar-bg, transparent)");
        this.setElementCSSRule(
            "borderBottom",
            "1px solid var(--ts-ui-menu-bar-border, rgb(220, 220, 220))"
        );
        this.setMinSize(0, MENU_BAR_BUTTON_HEIGHT);

        this.getAria().setRole("menubar");
        this.getAria().setLabel("Main menu");
        this.getAria().setTabIndex(0);

        this._onKeyDown = (e: KeyboardEvent) => {
            if (this._openIndex < 0) {
                return;
            }

            const panel = this._panels[this._openIndex];

            switch (e.key) {
                case "Escape":
                    e.preventDefault();
                    this.closeMenu();
                    break;

                case "ArrowLeft":
                    e.preventDefault();
                    this.openMenu((this._openIndex - 1 + this._panels.length) % this._panels.length);
                    break;

                case "ArrowRight":
                    e.preventDefault();
                    this.openMenu((this._openIndex + 1) % this._panels.length);
                    break;

                case "ArrowDown":
                    e.preventDefault();

                    if (panel.getFocusedIndex() < 0) {
                        panel.focusItem(0);
                    } else {
                        panel.focusNext();
                    }

                    break;

                case "ArrowUp":
                    e.preventDefault();
                    panel.focusPrev();
                    break;

                case "Enter":
                    e.preventDefault();
                    panel.activateFocused();
                    break;
            }
        };
    }

    /**
     * Replaces the current set of top-level menus.
     *
     * Disposes all existing [`MenuBarButton`](/api/component/menubar/classes/MenuBarButton) and [`Menu`](/api/overlay/classes/Menu) instances, then rebuilds
     * them from the given descriptors.
     *
     * @param menus - Ordered list of top-level menu descriptors.
     */
    setMenus(menus: MenuConfig[]): this {
        if (this._openIndex >= 0) {
            this.closeMenu();
        }

        for (const panel of this._panels) {
            panel.dispose();
        }

        for (const button of this._buttons) {
            button.dispose();
        }

        this._buttons.length = 0;
        this._panels.length = 0;

        this.removeAllComponents();

        for (let i = 0; i < menus.length; i++) {
            const menu = menus[i];
            const index = i;

            const button = new MenuBarButton(
                menu.label,
                () => {
                    if (this._openIndex === index) {
                        this.closeMenu();
                    } else {
                        this.openMenu(index);
                    }
                },
                () => {
                    if (this._quickSwitchActive && this._openIndex !== index) {
                        this.openMenu(index);
                    }
                },
                menu.glyph !== undefined ? { glyph: menu.glyph } : undefined
            );

            const panel = new Menu(menu.items, () => { this.closeMenu(); });

            this._buttons.push(button);
            this._panels.push(panel);
            this.addComponent(button);
        }

        return this;
    }

    /**
     * Programmatically opens the menu at the given index, closing any currently open menu first.
     *
     * @param index - Zero-based index into the menus array.
     */
    openMenu(index: number): this {
        if (index < 0 || index >= this._panels.length) {
            return this;
        }

        if (index === this._openIndex) {
            return this;
        }

        if (this._openIndex >= 0) {
            this._panels[this._openIndex].close();
            this._buttons[this._openIndex].setActive(false);
        }

        this._openIndex = index;
        this._quickSwitchActive = true;

        this._buttons[index].setActive(true);
        // Exclude only the opener button from the panel's outside-click dismissal
        // (so its own mousedown does not self-close before the click toggles it),
        // not the whole bar — otherwise a click on empty bar space would be
        // treated as inside and never close the menu.
        this._panels[index].setExcludedElement(this._buttons[index].getElement(true)!);
        this._panels[index].open(this._buttons[index].getElement(true)!);

        if (!this._keydownListening) {
            this._keydownListening = true;
            Event.addViewportListener(this, "keydown", this._onKeyDown);
        }

        return this;
    }

    /**
     * Closes the currently open menu, if any.
     */
    closeMenu(): this {
        if (this._openIndex < 0) {
            return this;
        }

        this._panels[this._openIndex].close();
        this._buttons[this._openIndex].setActive(false);

        this._openIndex = -1;
        this._quickSwitchActive = false;

        if (this._keydownListening) {
            this._keydownListening = false;
            Event.removeViewportListener(this, "keydown", this._onKeyDown);
        }

        return this;
    }

    /**
     * Returns the index of the currently open menu, or `-1` if none is open.
     *
     * @returns The open menu index, or -1.
     */
    getOpenIndex(): number {
        return this._openIndex;
    }
}

const MenuBarCallable = callable(MenuBar);
type MenuBarCallable = MenuBar;
export {
    MenuBar         as _MenuBar,
    MenuBarCallable as MenuBar
};
