// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { CSS } from "~/core/CSS.js";
import { Event } from "~/core/Event.js";
import { Text } from "~/component/input/Text.js";
import { Glyph } from "~/component/display/Glyph.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link MenuBarButton}.
 *
 * @category Components
 */
export interface MenuBarButtonOptions extends ComponentOptions {
    glyph?: string | null;
}

const GLYPH_TEXT_GAP = 4;
const HORIZONTAL_PAD = 10;

/**
 * Fixed row height shared by every `MenuBarButton` and by the parent
 * [`MenuBar`](/api/component/menubar/classes/MenuBar) container's `setMinSize`. Exported so the two stay in
 * lockstep — changing one without the other would let the bar grow taller
 * than its buttons.
 */
export const MENU_BAR_BUTTON_HEIGHT: number = 28;

/**
 * A single top-level button in a [`MenuBar`](/api/component/menubar/classes/MenuBar) (e.g. "File", "Edit").
 *
 * Renders as a flat label-style element with a hover CSS rule. Has no [`Button`](/api/component/button/classes/Button)
 * inheritance to avoid the ridge border and shadow of the standard button style.
 * Active state (open dropdown) is indicated by a persistent background fill.
 *
 * Communicates open/close intent back to [`MenuBar`](/api/component/menubar/classes/MenuBar) via callbacks passed at
 * construction time. Supports an optional leading [`Glyph`](/api/component/display/classes/Glyph) shown to the
 * left of the label.
 *
 * @category Components
 */
class MenuBarButton extends Component {

    private readonly _text: Text;
    private readonly _hoverRule: CSSStyleRule;
    private readonly _onClickHandler: () => void;
    private readonly _onMouseOverHandler: () => void;
    private readonly _label: string;
    private _glyph: Glyph | null = null;

    /**
     * Constructs a `MenuBarButton`.
     *
     * @param text - The label shown in the bar (e.g. `"File"`).
     * @param onClick - Called when the user clicks this button.
     * @param onHover - Called when the mouse enters this button while a menu is open (quick-switch).
     * @param options - Optional configuration bag (e.g. leading glyph).
     */
    constructor(text: string, onClick: () => void, onHover: () => void, options?: MenuBarButtonOptions) {
        super();

        this._label = text;

        this.setBackgroundColor("var(--ts-ui-menu-bar-btn-bg, transparent)");
        this.setForegroundColor("var(--ts-ui-menu-bar-btn-fg, inherit)");
        this.setElementCSSRule("fontSize", "var(--ts-ui-button-font-size, 12px)");
        this.setCursor("pointer");

        this._hoverRule = CSS.createComponentRule(this.getId() + ":hover") as CSSStyleRule;
        this._hoverRule.style.setProperty(
            "background-color",
            "var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))"
        );

        this._text = new Text(text);
        this._text.setPointerEvents("none");
        this._text.setUserSelect("none");
        this._text.setWhiteSpace("nowrap");
        this._text.centerInHeight(MENU_BAR_BUTTON_HEIGHT);
        this.addComponent(this._text);

        this.recomputePreferredSize();

        this.getAria().setRole("menuitem");
        this.getAria().setHasPopup("menu");
        this.getAria().setExpanded(false);

        this._onClickHandler = () => { onClick(); };
        this._onMouseOverHandler = () => { onHover(); };

        Event.addListener(this, "click", this._onClickHandler);
        Event.addListener(this, "mouseover", this._onMouseOverHandler);

        if (this.constructor === MenuBarButton && options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link MenuBarButtonOptions} bag, dispatching the optional
     * leading-glyph name after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: MenuBarButtonOptions): this {
        super.applyOptions(options);

        if (options.glyph !== undefined) {
            this.setGlyph(options.glyph);
        }

        return this;
    }

    /**
     * Sets or clears an optional leading [`Glyph`](/api/component/display/classes/Glyph) shown to the left of the label.
     *
     * @param name - Registry glyph name to display, or `null` to clear an existing glyph.
     *
     * @returns This component, for method chaining.
     */
    setGlyph(name: string | null): this {
        if (this._glyph) {
            this.removeComponent(this._glyph);
            this._glyph = null;
        }

        if (name) {
            const glyph = new Glyph(name);
            glyph.setPointerEvents("none");
            this.addComponent(glyph);
            this._glyph = glyph;
        }

        this.recomputePreferredSize();
        this.doLayout();

        return this;
    }

    /**
     * Removes the leading glyph from the menu-bar button, if one is present.
     *
     * @returns This component, for method chaining.
     */
    clearGlyph(): this {
        if (this._glyph) {
            this.removeComponent(this._glyph);
            this._glyph = null;
            this.recomputePreferredSize();
            this.doLayout();
        }

        return this;
    }

    /**
     * Returns the current leading glyph component, or null if none is set.
     *
     * @returns The [`Glyph`](/api/component/display/classes/Glyph) instance, or null.
     */
    getGlyph(): Glyph | null {
        return this._glyph;
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
     * Positions the label with horizontal padding inside the button bounds, plus the optional leading glyph.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const height = this.getHeight();
        const width  = this.getWidth();

        if (this._glyph) {
            const glyphSize = this._glyph.getPreferredSize() ?? { width: 16, height: 16 };
            const glyphY    = Math.max(0, (height - glyphSize.height) / 2);

            this._glyph.setX(HORIZONTAL_PAD);
            this._glyph.setY(glyphY);
            this._glyph.setWidth(glyphSize.width);
            this._glyph.setHeight(glyphSize.height);

            const textX = HORIZONTAL_PAD + glyphSize.width + GLYPH_TEXT_GAP;
            this._text.setX(textX);
            this._text.setY(0);
            this._text.setWidth(Math.max(0, width - textX - HORIZONTAL_PAD));
            this._text.setHeight(height);
        } else {
            this._text.setX(HORIZONTAL_PAD);
            this._text.setY(0);
            this._text.setWidth(Math.max(0, width - HORIZONTAL_PAD * 2));
            this._text.setHeight(height);
        }

        return this;
    }

    /**
     * Recomputes the button's preferred size from the measured label width plus,
     * when present, the leading glyph's width.
     *
     * @remarks Reads `_text.getPreferredSize()` rather than estimating from the
     * label string length, so glyph-heavy labels like "View" no longer underflow
     * their text box.
     */
    private recomputePreferredSize(): void {
        const textWidth = this._text.getPreferredSize()?.width ?? this._label.length * 7;
        let   width     = textWidth + HORIZONTAL_PAD * 2;

        if (this._glyph) {
            const glyphSize = this._glyph.getPreferredSize() ?? { width: 16, height: 16 };
            width += glyphSize.width + GLYPH_TEXT_GAP;
        }

        this.setPreferredSize(width, MENU_BAR_BUTTON_HEIGHT);
    }
}

const MenuBarButtonCallable = callable(MenuBarButton);
type MenuBarButtonCallable = MenuBarButton;
export {
    MenuBarButton         as _MenuBarButton,
    MenuBarButtonCallable as MenuBarButton
};
