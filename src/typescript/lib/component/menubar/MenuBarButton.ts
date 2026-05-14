// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/Component.js";
import { CSS } from "~/CSS.js";
import { Event } from "~/Event.js";
import { Text } from "~/component/Text.js";
import { callable } from "~/Callable.js";

/**
 * A single top-level button in a `MenuBar` (e.g. "File", "Edit").
 *
 * Renders as a flat label-style element with a hover CSS rule. Has no `Button`
 * inheritance to avoid the ridge border and shadow of the standard button style.
 * Active state (open dropdown) is indicated by a persistent background fill.
 *
 * Communicates open/close intent back to `MenuBar` via callbacks passed at
 * construction time.
 *
 * @category Components
 */
class MenuBarButton extends Component {

    private readonly _text: Text;
    private readonly _hoverRule: CSSStyleRule;
    private readonly _onClickHandler: () => void;
    private readonly _onMouseOverHandler: () => void;

    /**
     * Constructs a `MenuBarButton`.
     *
     * @param text - The label shown in the bar (e.g. `"File"`).
     * @param onClick - Called when the user clicks this button.
     * @param onHover - Called when the mouse enters this button while a menu is open (quick-switch).
     */
    constructor(text: string, onClick: () => void, onHover: () => void) {
        super();

        this.setBackgroundColor("var(--ts-ui-menu-bar-btn-bg, transparent)");
        this.setForegroundColor("var(--ts-ui-menu-bar-btn-fg, inherit)");
        this.setElementCSSRule("fontSize", "var(--ts-ui-button-font-size, 12px)");
        this.setCursor("pointer");
        this.setPreferredSize(text.length * 7 + 24, 28);

        this._hoverRule = CSS.createComponentRule(this.getId() + ":hover") as CSSStyleRule;
        this._hoverRule.style.setProperty(
            "background-color",
            "var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))"
        );

        this._text = new Text(text);
        this._text.setPointerEvents("none");
        this._text.setElementCSSRule("userSelect", "none");
        this._text.setElementCSSRule("whiteSpace", "nowrap");
        this.addComponent(this._text);

        this.getAria().setRole("menuitem");
        this.getAria().setHasPopup("menu");
        this.getAria().setExpanded(false);

        this._onClickHandler = () => { onClick(); };
        this._onMouseOverHandler = () => { onHover(); };

        Event.addListener(this, "click", this._onClickHandler);
        Event.addListener(this, "mouseover", this._onMouseOverHandler);
    }

    /**
     * Sets the active (dropdown-open) visual state.
     *
     * Active buttons show a persistent highlight background and report `aria-expanded="true"`.
     *
     * @param active - `true` to show the open state, `false` to revert to the default.
     */
    setActive(active: boolean): this {
        this.setBackgroundColor(
            active
                ? "var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))"
                : "var(--ts-ui-menu-bar-btn-bg, transparent)"
        );
        this.getAria().setExpanded(active);

        return this;
    }

    /**
     * Removes Event listeners registered by this button.
     */
    dispose(): void {
        Event.removeListener(this, "click", this._onClickHandler);
        Event.removeListener(this, "mouseover", this._onMouseOverHandler);
    }

    /**
     * Positions the label with horizontal padding inside the button bounds.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const pad = 10;

        this._text.setX(pad);
        this._text.setY(0);
        this._text.setWidth(Math.max(0, this.getWidth() - pad * 2));
        this._text.setHeight(this.getHeight());

        return this;
    }
}

const MenuBarButtonCallable = callable(MenuBarButton);
type MenuBarButtonCallable = MenuBarButton;
export {
    MenuBarButton         as _MenuBarButton,
    MenuBarButtonCallable as MenuBarButton
};
