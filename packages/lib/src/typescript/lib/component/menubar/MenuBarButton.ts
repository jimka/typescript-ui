// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonOptions } from "~/component/button/Button.js";
import { Event } from "~/core/Event.js";
import { HBox } from "~/layout/HBox.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link MenuBarButton}.
 *
 * @category Components
 */
export interface MenuBarButtonOptions extends ButtonOptions {
}

/**
 * User-overridable visual defaults forwarded to `super` via the third
 * constructor arg. The cascade in `Component`'s constructor merges these
 * over Button's own defaults and dispatches each setter once with the
 * final value, so any field the caller supplied wins.
 */
const _defaultMenuBarButtonOptions: Partial<MenuBarButtonOptions> = {
    backgroundColor: "var(--ts-ui-menu-bar-btn-bg, transparent)",
    foregroundColor: "var(--ts-ui-menu-bar-btn-fg, inherit)",
    cursor:          "pointer",
};

/** Pixel gap between the leading glyph and the label in the content row. */
const GLYPH_TEXT_GAP = 4;

/** Horizontal padding inside the button, applied via `setInsets`. */
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
 * Extends [`Button`](/api/component/button/classes/Button) with `chromeless: true`
 * so the menubar's flat label-style appearance dodges Button's ridge border,
 * drop shadow, and gradient defaults. Reuses Button's content-row machinery
 * for the optional leading glyph + label pair, re-anchored to the west edge.
 * Adds menubar-specific ARIA (`role="menuitem"`, `aria-haspopup="menu"`,
 * `aria-expanded`) and the sticky `setActive` highlight for the
 * dropdown-open state. The `:hover` rule rides Button's `styleRules` bag.
 *
 * Communicates open/close intent back to [`MenuBar`](/api/component/menubar/classes/MenuBar) via callbacks passed at
 * construction time.
 *
 * @category Components
 */
class MenuBarButton extends Button<MenuBarButtonOptions> {

    private readonly _onClickHandler:     () => void;
    private readonly _onMouseOverHandler: () => void;

    /**
     * Constructs a `MenuBarButton`.
     *
     * @param text - The label shown in the bar (e.g. `"File"`).
     * @param onClick - Called when the user clicks this button.
     * @param onHover - Called when the mouse enters this button while a menu is open (quick-switch).
     * @param options - Optional configuration bag. `glyph` is inherited from
     *   [`ButtonOptions`](/api/component/button/interfaces/ButtonOptions).
     */
    constructor(
        text:     string,
        onClick:  () => void,
        onHover:  () => void,
        options?:          MenuBarButtonOptions,
        subclassDefaults?: Partial<MenuBarButtonOptions>,
    ) {
        super(
            text,
            {
                ...options,
                // chromeless suppresses Button's ridge border, drop shadow,
                // gradient background, and the pressed/hover treatments —
                // the menubar wants a flat label-shaped surface.
                chromeless: true,
                // Menubar-specific :hover highlight rides Button's styleRules
                // bag so the cascade routes through createStyleRule's
                // dedupe-and-defer machinery. Merge with any caller-supplied
                // styleRules entries via the canonical array-spread idiom.
                styleRules: [
                    ...(options?.styleRules ?? []),
                    {
                        suffix: ":hover",
                        styles: {
                            backgroundColor: "var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))",
                        },
                    },
                ],
            },
            { ..._defaultMenuBarButtonOptions, ...(subclassDefaults ?? {}) },
        );

        // Bump the HBox content-row spacing from Button's default (2) to the
        // menubar's GLYPH_TEXT_GAP (4).
        (this._content.getLayoutManager() as HBox).setComponentSpacing(GLYPH_TEXT_GAP);

        // Horizontal padding inside the button — replaces Button's 4-px
        // insets default. `setInsets` (overridden in Button) auto-fires
        // `recomputePreferredSize`, so the menubar's fixed-height
        // `computePreferredSize` override lands the right dimensions
        // without explicit prodding here.
        this.setInsets(new Insets(0, HORIZONTAL_PAD, 0, HORIZONTAL_PAD));

        this.getAria().setRole("menuitem");
        this.getAria().setHasPopup("menu");
        this.getAria().setExpanded(false);

        this._onClickHandler     = (): void => { onClick(); };
        this._onMouseOverHandler = (): void => { onHover(); };

        // Internal `Event.addListener(this, …)` calls — the class registers
        // listeners on itself, which is the allowed shape. The named-method
        // bypass rule only forbids *external* consumers from doing the same.
        Event.addListener(this, "click",     this._onClickHandler);
        Event.addListener(this, "mouseover", this._onMouseOverHandler);
    }

    /**
     * Pins the button's height to {@link MENU_BAR_BUTTON_HEIGHT} while
     * inheriting Button's content-derived width.
     */
    protected override computePreferredSize(): { width: number; height: number } {
        const { width } = super.computePreferredSize();

        return { width, height: MENU_BAR_BUTTON_HEIGHT };
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

        // While this button's dropdown is open, silence its hover tooltip — the
        // title tooltip would otherwise pop over the open menu (and re-arm on a
        // quick-switch re-hover). Restored when the menu closes.
        this.setTooltipSuppressed(active);

        return this;
    }

    /**
     * Removes Event listeners registered by this button, then defers to the
     * base class for the rest of teardown.
     */
    protected destructor(): void {
        Event.removeListener(this, "click",     this._onClickHandler);
        Event.removeListener(this, "mouseover", this._onMouseOverHandler);

        super.destructor();
    }
}

const MenuBarButtonCallable = callable(MenuBarButton);
type MenuBarButtonCallable = MenuBarButton;
export {
    MenuBarButton         as _MenuBarButton,
    MenuBarButtonCallable as MenuBarButton
};
