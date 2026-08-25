// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonOptions } from "~/component/button/Button.js";
import { Event } from "~/core/Event.js";
import { HBox } from "~/layout/HBox.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";

/**
 * Construction-time options for {@link MenuBarButton}.
 *
 * @category Components
 */
export interface MenuBarButtonOptions extends ButtonOptions {
}

/** Horizontal padding inside the button, folded into the defaults bag below. */
const HORIZONTAL_PAD = 10;

/** Hover highlight token, shared by the defaults bag, `ownStyleStates`' `:hover` entry, and `setActive`. */
const MENU_BAR_BUTTON_HOVER_BG = "var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))";

/**
 * User-overridable visual defaults forwarded to `super` via the third
 * constructor arg. The cascade in `Component`'s constructor merges these
 * over Button's own defaults and dispatches each setter once with the
 * final value, so any field the caller supplied wins.
 *
 * The resting chrome fields (`backgroundImage` / `border` / `borderRadius` /
 * `shadow`) declare the flat label-shaped surface the old imperative flag
 * used to compute — see plans/menubarbutton-chromeless-migration.md's
 * Architecture Decisions for why declared chrome dedupes and that flag
 * cannot. `borderRadius: undefined` is an explicit key, not an omission: it
 * suppresses Button's own radius default through the spread merge.
 *
 * The four `pressedX` fields restate this class's own resting values, so
 * pressing a menu-bar button shows no visual change — exactly what
 * `pinPressedToResting()` produced under the old flag. The three `hoverX`
 * fields keep the menubar highlight while neutralising Button's raised hover
 * gradient and shadow, which `ownStyleStates`' merge would otherwise inherit.
 */
const _defaultMenuBarButtonOptions: Partial<MenuBarButtonOptions> = {
    backgroundColor:        "var(--ts-ui-menu-bar-btn-bg, transparent)",
    foregroundColor:        "var(--ts-ui-menu-bar-btn-fg, inherit)",
    cursor:                 "pointer",
    backgroundImage:        "none",
    border:                 "none",
    borderRadius:           undefined,
    shadow:                 "none",
    pressedForegroundColor: "var(--ts-ui-menu-bar-btn-fg, inherit)",
    pressedBackgroundColor: "var(--ts-ui-menu-bar-btn-bg, transparent)",
    pressedBackgroundImage: "none",
    pressedShadow:          "none",
    hoverBackgroundColor:   MENU_BAR_BUTTON_HOVER_BG,
    hoverBackgroundImage:   "none",
    hoverShadow:            "none",
    // Horizontal padding inside the button — replaces Button's 4-px insets
    // default.
    insets:                 new Insets(0, HORIZONTAL_PAD, 0, HORIZONTAL_PAD),
};

/** Pixel gap between the leading glyph and the label in the content row. */
const GLYPH_TEXT_GAP = 4;

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
 * Extends [`Button`](/api/component/button/classes/Button) and declares its own
 * flat resting chrome (no border, shadow, or gradient) through
 * `ownClassStyleDefaults`, pinning `.pressed` to those same resting values so
 * a press shows no visual change. Reuses Button's content-row machinery
 * for the optional leading glyph + label pair, re-anchored to the west edge.
 * Adds menubar-specific ARIA (`role="menuitem"`, `aria-haspopup="menu"`,
 * `aria-expanded`) and the sticky `setActive` highlight for the
 * dropdown-open state. The `:hover` rule comes from this class's own
 * `ownStyleStates`, matching `TabButton`'s pattern.
 *
 * Communicates open/close intent back to [`MenuBar`](/api/component/menubar/classes/MenuBar) via callbacks passed at
 * construction time.
 *
 * @category Components
 */
class MenuBarButton extends Button<MenuBarButtonOptions> {

    // Opts the resting tier into the hierarchy-aware class cascade — see
    // plans/implemented/class-hierarchy-cascade.md. The same constant this
    // class's constructor forwards as `subclassDefaults`, exposed at the
    // class level so `.MenuBarButton`'s rule carries only its own deviation
    // from `.Button`'s.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultMenuBarButtonOptions;

    // Both entries carry real content pinned to this class's own tokens.
    // `.pressed` restates the resting values so a press shows no visual
    // change (what `pinPressedToResting()` produced under the old imperative
    // flag); `:hover` keeps the menubar highlight and neutralises the
    // gradient/shadow Button's own `:hover` entry would otherwise merge in.
    // See plans/menubarbutton-chromeless-migration.md.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => ({
                foregroundColor: _defaultMenuBarButtonOptions.pressedForegroundColor,
                backgroundColor: _defaultMenuBarButtonOptions.pressedBackgroundColor,
                backgroundImage: _defaultMenuBarButtonOptions.pressedBackgroundImage,
                shadow:          _defaultMenuBarButtonOptions.pressedShadow,
            }),
        },
        {
            selector: ":hover",
            extract: (): StyleBag => ({
                backgroundColor: _defaultMenuBarButtonOptions.hoverBackgroundColor,
                backgroundImage: _defaultMenuBarButtonOptions.hoverBackgroundImage,
                shadow:          _defaultMenuBarButtonOptions.hoverShadow,
            }),
        },
    ];

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
            { ...options },
            { ..._defaultMenuBarButtonOptions, ...(subclassDefaults ?? {}) },
        );

        // Bump the HBox content-row spacing from Button's default (2) to the
        // menubar's GLYPH_TEXT_GAP (4).
        (this._content.getLayoutManager() as HBox).setComponentSpacing(GLYPH_TEXT_GAP);

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
                ? MENU_BAR_BUTTON_HOVER_BG
                : _defaultMenuBarButtonOptions.backgroundColor!
        );
        this.getAria().setExpanded(active);

        // While this button's dropdown is open, silence its hover tooltip — the
        // title tooltip would otherwise pop over the open menu (and re-arm on a
        // quick-switch re-hover). Restored when the menu closes.
        this.setTooltipSuppressed(active);

        return this;
    }

}

const MenuBarButtonCallable = callable(MenuBarButton);
type MenuBarButtonCallable = MenuBarButton;
export {
    MenuBarButton         as _MenuBarButton,
    MenuBarButtonCallable as MenuBarButton
};
