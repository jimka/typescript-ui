// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Event } from "~/core/Event.js";
import { Button, ButtonOptions } from "~/component/button/Button.js";
import { DOM } from "~/core/DOM.js";
import { Glyph } from "~/component/display/Glyph.js";
import { Menu } from "~/overlay/Menu.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { callable } from "~/core/Callable.js";
import { caret_down } from "~/glyphs/solid/caret_down.js";
import { ThemeManager } from "~/core/Theme.js";
import { SpatialNavigation } from "~/core/SpatialNavigation.js";

// Register the trailing chevron eagerly at module load — same pattern as
// `TabCloseButton` registering its `xmark` — so `new SplitButton()` always
// resolves the chevron without the consumer pre-registering a glyph.
Glyph.register(caret_down);

/** Registry name of the trailing dropdown chevron glyph. */
const CHEVRON_GLYPH = "caret-down";

/**
 * Square pixel size of the trailing chevron glyph — the theme's `glyphLg`
 * default icon step (16px at the shipped base). Pinned (not
 * line-height-tracked like the leading glyph) so the dropdown affordance sits
 * on the same default icon size as a flat toolbar's icon buttons, and grows
 * with the theme instead of staying a fixed pixel literal. Read per call, not
 * frozen in a module constant, so a theme that raises `scale.base` moves the
 * icon with it.
 */
function chevronSizePx(): number {
    return ThemeManager.getResolvedScale().glyphLg;
}

/**
 * Duration in milliseconds of the chevron's open/close spin. Matches the
 * framework's shared 200ms indicator transition (see `AccordionIndicator`) so
 * the caret animates at the same cadence as other dropdown / expand affordances.
 */
const CHEVRON_SPIN_MS = 200;

/**
 * Construction-time options for {@link SplitButton}.
 *
 * @category Components
 */
export interface SplitButtonOptions extends ButtonOptions {
    /** Items shown in the dropdown opened by the trailing chevron. */
    menuItems?: MenuItemConfig[];
}

/**
 * A push button with a trailing dropdown chevron. The main button face fires
 * the primary `"action"` event exactly like [`Button`](/api/component/button/classes/Button);
 * clicking the chevron zone instead opens a rebuild-mode
 * [`Menu`](/api/overlay/classes/Menu) of [`MenuItemConfig`](/api/component/container/interfaces/MenuItemConfig)
 * rows anchored under the button.
 *
 * The chevron is a child [`Glyph`](/api/component/display/classes/Glyph) inside
 * Button's single `<button>` element (one DOM element per class is preserved):
 * it rides the content row beside the leading glyph and title. A subtree
 * listener on the chevron catches its click (which the SVG `<use>` retargets to
 * an id-less inner element), while the button face's exact-target `"action"`
 * only fires for a click on the `<button>` itself — distinguishing the dropdown
 * gesture from the primary action with no hit-testing coordinates.
 *
 * Dropping a `SplitButton` into a flat [`ToolBar`](/api/component/menubar/classes/ToolBar)
 * flattens it like any other `Button`; the chevron is part of the content row,
 * so it inherits the flat appearance with no extra wiring.
 *
 * While the button has focus, `ArrowDown` or `Alt+ArrowDown` opens the
 * dropdown with its first row highlighted (inside a vertical toolbar, plain
 * `ArrowDown` is left to the toolbar). `ArrowUp` / `ArrowDown`, `Enter` /
 * `Space` and `Escape` then drive the menu while focus stays on the button,
 * which declares `aria-haspopup="menu"` and keeps `aria-expanded` in step.
 *
 * @example
 * ```typescript
 * import { SplitButton } from '@jimka/typescript-ui/component/button';
 *
 * const save = new SplitButton('Save', {
 *     menuItems: [
 *         { text: 'Save As…',  action: () => saveAs()  },
 *         { text: 'Save All',  action: () => saveAll() },
 *     ],
 * });
 * save.on('action', () => save());
 * toolbar.addComponent(save);
 * ```
 *
 * @category Components
 */
class SplitButton extends Button<SplitButtonOptions> {

    /**
     * The trailing dropdown chevron — a child of Button's `_content` row.
     * Clicks on it land on the id-less inner element the SVG `<use>` retargets
     * to, so they are caught with a *subtree* listener rather than an
     * exact-target one; that same retargeting is why a chevron click never
     * matches the button face's exact-target `"action"`, which is what
     * distinguishes the dropdown gesture from the primary action without
     * hit-testing.
     */
    private _chevron!: Glyph;

    /**
     * Lazily-created rebuild-mode dropdown, reused across opens. `null` until
     * the chevron is first clicked so a button whose dropdown is never opened
     * allocates no menu panel.
     */
    private _menu: Menu | null = null;

    /**
     * Cached dropdown items. `declare` rather than initialized: `setMenuItems`
     * can fire from the super-cascade via `applyOptions`, and an `= []`
     * initializer would run after `super()` returns and clobber the cascaded
     * value (the class-field super-cascade trap).
     */
    private declare _menuItems: MenuItemConfig[];

    /**
     * Bound chevron-click handler. Held on the instance so it is a stable
     * reference for the named-listener contract. Delegates to `_toggleMenu`,
     * which opens the dropdown or closes it if this chevron already opened it.
     */
    private readonly _onChevronClick: () => void = () => { this._toggleMenu(); };

    /** Whether the dropdown is open; written only by `_setMenuOpen`. */
    private _menuOpen: boolean = false;

    /** Set when a Space keydown activated a menu row, so its keyup is swallowed. */
    private _swallowSpaceUp: boolean = false;

    /**
     * Bound keydown handler, held on the instance as a stable named listener.
     * Delegates to `_handleKeyDown`.
     */
    private readonly _onKeyDown: (e: KeyboardEvent) => Event.ListenerResult = (e) => this._handleKeyDown(e);

    /**
     * Bound keyup handler. Prevents the default of the one Space keyup that
     * follows a Space which activated a menu row: a native `<button>` fires
     * its click on the Space keyup, which would otherwise run the primary
     * `"action"` after the menu row already ran.
     */
    private readonly _onKeyUp: (e: KeyboardEvent) => Event.ListenerResult = (e) => {
        if (e.key !== " " || !this._swallowSpaceUp) {
            return;
        }

        this._swallowSpaceUp = false;

        return { prevent: true };
    };

    /**
     * Bound blur handler. Drops a pending Space-keyup swallow when focus
     * leaves the button first — a row's action that opens a dialog moves
     * focus, so the matching keyup lands elsewhere and would otherwise leave
     * the flag set to swallow the next, unrelated Space on this button.
     * Mirrors `Button`'s blur reset of its Space-held state.
     */
    private readonly _onBlurClearSpaceSwallow: () => void = () => {
        this._swallowSpaceUp = false;
    };

    /**
     * Constructs a SplitButton.
     *
     * @param text - Optional button title.
     * @param options - Optional options bag, including `menuItems` for the dropdown.
     */
    constructor(text?: string, options?: SplitButtonOptions) {
        super(text, options);

        // Default the cache when neither the super-cascade nor a caller set it.
        this._menuItems ??= [];

        // Build the chevron after super() so the content row exists. It rides
        // the row like the leading glyph; appending it last places it after the
        // title in the single `<button>`. A *subtree* listener catches the click
        // the SVG `<use>` retargets to its id-less inner element — an
        // exact-target listener on the glyph would never match it — while that
        // same retargeting keeps the click off the button face's `"action"`.
        const chevronSize = chevronSizePx();

        this._chevron = new Glyph(CHEVRON_GLYPH);
        this._chevron.setPreferredSize({ width: chevronSize, height: chevronSize });
        this._chevron.setCursor("pointer");
        // Button sets its whole `_content` row to `pointer-events: none` so face
        // clicks fall through to the `<button>`; the chevron inherits that and
        // would never receive its own click. Re-enable it here — an outer
        // `<svg>` with `auto` is hittable across its full box (not just the
        // painted caret pixels) — so the chevron reliably catches the click.
        this._chevron.setPointerEvents("auto");
        // Fixed transform transition; `_setMenuOpen` toggles the rotation so
        // the caret spins between its closed (down) and open (up) states.
        this._chevron.setTransition("transform " + CHEVRON_SPIN_MS + "ms ease");

        this._content.addComponent(this._chevron);

        Event.addSubtreeListener(this._chevron, "click", this._onChevronClick);

        this.getAria().setHasPopup("menu");
        this.getAria().setExpanded(false);

        Event.addListener(this, "keydown", this._onKeyDown);
        Event.addListener(this, "keyup",   this._onKeyUp);
        Event.addListener(this, "blur",    this._onBlurClearSpaceSwallow);
    }

    /**
     * Disposes the lazily-created dropdown, then runs the inherited teardown.
     * `_menu` is a LayerManager-mounted panel, never a registered child (see
     * Menu.ts's class comment), so `super.destructor()`'s child recursion
     * cannot reach it.
     */
    protected destructor(): void {
        this._menu?.dispose();

        super.destructor();
    }

    /**
     * Replaces the dropdown items shown when the chevron is clicked.
     *
     * @param items - The new item configurations.
     *
     * @returns This button, for method chaining.
     */
    setMenuItems(items: MenuItemConfig[]): this {
        this._menuItems = items;
        this._options.menuItems = items;

        return this;
    }

    /**
     * Returns the current dropdown items.
     *
     * @returns The item configurations shown by the chevron dropdown.
     */
    getMenuItems(): MenuItemConfig[] {
        return this._menuItems;
    }

    /**
     * Applies a {@link SplitButtonOptions} bag, dispatching `menuItems` after
     * the inherited Button fields cascade.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This button, for method chaining.
     */
    protected applyOptions(options: SplitButtonOptions): this {
        super.applyOptions(options);

        if (options.menuItems !== undefined) {
            this.setMenuItems(options.menuItems);
        }

        return this;
    }

    /**
     * Re-appends the trailing chevron after the inherited content-row rebuild.
     * Button's `_rebuildContentRow` empties `_content` wholesale (on a
     * `setGlyph` / `setDescription` / writing-mode change), which would detach
     * the chevron; re-appending it last keeps the dropdown affordance trailing
     * the title across those mutations.
     *
     * @remarks Guarded on `_chevron` because the rebuilds dispatched during the
     * super-cascade run before the constructor builds the chevron; those skip,
     * and the constructor appends it once afterwards.
     */
    protected override _afterRebuildContentRow(): void {
        if (this._chevron) {
            this._content.addComponent(this._chevron);
        }
    }

    /**
     * Toggles the rebuild-mode dropdown anchored under the button's bottom-left
     * corner: opens it, or closes it if this chevron already opened it. No-op
     * when there is no DOM element yet (the button is unattached) so an anchor
     * rect can always be read.
     */
    private _toggleMenu(): void {
        const el = this.getElement();
        if (!el) {
            return;
        }

        const rect = DOM.source.getViewportRect(this);

        if (this._menu === null) {
            this._menu = new Menu();
            this.getAria().setControls(this._menu.getId());
        }

        // Optimistically mark the menu open. `toggleFor` excludes the chevron
        // from the menu's outside-click dismissal and remembers it as the
        // opener, so a second chevron press closes the dropdown; on that close
        // the menu's onClose marks it closed again, correcting this optimistic
        // write when the press toggled shut rather than open.
        this._setMenuOpen(true);

        this._menu.toggleFor(
            this._chevron.getElement(true)!,
            rect,
            this._menuItems,
            () => { this._setMenuOpen(false); }
        );
    }

    /**
     * Records whether the dropdown is open and writes everything that follows
     * that state: the open flag the keyboard handler reads, the chevron's
     * rotation (caret up when open, animated by the transform transition set
     * at construction), and `aria-expanded`.
     *
     * @param open - `true` when the dropdown is open, `false` when closed.
     */
    private _setMenuOpen(open: boolean): void {
        this._menuOpen = open;
        this._chevron.setTransform(open ? "rotate(180deg)" : "rotate(0deg)");
        this.getAria().setExpanded(open);
    }

    /**
     * Routes a keydown on the button: to the open menu while it is open,
     * otherwise to the opening check. Leaves alone any key
     * `SpatialNavigation` claims for panel navigation.
     *
     * @param e - The keydown on the button.
     *
     * @returns A stop-and-prevent disposition for a key it handled, or nothing.
     */
    private _handleKeyDown(e: KeyboardEvent): Event.ListenerResult {
        const claimed = SpatialNavigation.claimsKey(e);

        if (claimed) {
            return;
        }

        if (this._menuOpen) {
            return this._handleOpenMenuKey(e);
        }

        const opens = this._isOpenMenuKey(e);

        if (!opens) {
            return;
        }

        this._openMenuFromKeyboard();

        return { stop: true, prevent: true };
    }

    /**
     * Handles a keydown while the dropdown is open. `Tab`, `ArrowLeft` and
     * `ArrowRight` close the menu and continue, so focus moves on as usual;
     * the menu's own keys are forwarded to it and consumed. `Escape` is left
     * to the layer manager, which closes the topmost layer.
     *
     * @param e - The keydown on the button.
     *
     * @returns A stop-and-prevent disposition when the menu consumed the key,
     *   or nothing.
     */
    private _handleOpenMenuKey(e: KeyboardEvent): Event.ListenerResult {
        const menu = this._menu!;

        if (e.key === "Tab" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
            menu.hide();

            return;
        }

        const consumed = menu.handleKey(e);

        if (!consumed) {
            return;
        }

        if (e.key === " ") {
            this._swallowSpaceUp = true;
        }

        return { stop: true, prevent: true };
    }

    /**
     * Whether a keydown opens the dropdown: `ArrowDown` with no modifier, or
     * with `Alt` alone. Plain `ArrowDown` is left to a vertical parent (one
     * declaring `aria-orientation="vertical"`, such as a vertical toolbar),
     * which moves between its children with it; `Alt+ArrowDown` opens there too.
     *
     * @param e - The keydown on the button.
     *
     * @returns `true` when the key opens the dropdown.
     */
    private _isOpenMenuKey(e: KeyboardEvent): boolean {
        if (e.key !== "ArrowDown" || e.ctrlKey || e.shiftKey || e.metaKey) {
            return false;
        }

        if (e.altKey) {
            return true;
        }

        const parentOrientation = this.getParentComponent()?.getAria().getOrientation() ?? null;

        return parentOrientation !== "vertical";
    }

    /**
     * Opens the dropdown from the keyboard and highlights its first row.
     */
    private _openMenuFromKeyboard(): void {
        this._toggleMenu();

        // `_toggleMenu` leaves `_menuOpen` false when it opened nothing
        // (unattached button, or no items). A fresh show resets the highlight
        // to -1, so `focusNext` lands on the first navigable row.
        if (this._menuOpen) {
            this._menu!.focusNext();
        }
    }
}

const SplitButtonCallable = callable(SplitButton);
type SplitButtonCallable = SplitButton;
export {
    SplitButton         as _SplitButton,
    SplitButtonCallable as SplitButton
};
