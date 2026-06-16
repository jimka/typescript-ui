// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Button, ButtonOptions } from "~/component/button/Button.js";
import { Glyph } from "~/component/display/Glyph.js";
import { Menu } from "~/core/Menu.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { Insets } from "~/primitive/Insets.js";
import { Size } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";
import { caret_down } from "~/glyphs/solid/caret_down.js";

// Register the trailing chevron eagerly at module load — same pattern as
// `TabCloseButton` registering its `xmark` — so `new SplitButton()` always
// resolves the chevron without the consumer pre-registering a glyph.
Glyph.register(caret_down);

/** Registry name of the trailing dropdown chevron glyph. */
const CHEVRON_GLYPH = "caret-down";

/**
 * Square pixel size of the trailing chevron's hit zone. Pinned (not
 * line-height-tracked like the leading glyph) so the dropdown affordance stays
 * a constant, comfortably-clickable target across themes; 16px matches the
 * compact icon-button glyph size a flat toolbar uses.
 */
const CHEVRON_ZONE = 16;

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
 * [`Menu`](/api/core/classes/Menu) of [`MenuItemConfig`](/api/component/container/interfaces/MenuItemConfig)
 * rows anchored under the button.
 *
 * The chevron is a child [`Glyph`](/api/component/display/classes/Glyph) inside
 * Button's single `<button>` element (one DOM element per class is preserved):
 * it rides the content row beside the leading glyph and title, wrapped in a
 * pointer-events surface so a click in the chevron zone targets the chevron —
 * not the button face — which is how the dropdown click is distinguished from
 * the primary action without hit-testing coordinates.
 *
 * Dropping a `SplitButton` into a flat [`ToolBar`](/api/component/menubar/classes/ToolBar)
 * flattens it like any other `Button`; the chevron is part of the content row,
 * so it inherits the flat appearance with no extra wiring.
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
     * Pointer-events surface wrapping the chevron glyph. A plain `<div>` whose
     * own element id is the click target for the chevron zone — the glyph
     * inside it carries `pointer-events: none`, so a click anywhere in the zone
     * lands on this wrapper (which reliably has an id) rather than on an SVG
     * `<path>` that the framework's exact-target dispatch could not match.
     */
    private _chevronZone!: Component;

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
     * reference for the named-listener contract.
     */
    private readonly _onChevronClick: () => void = () => { this._openMenu(); };

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

        // Build the chevron zone after super() so the content row exists. The
        // wrapper is a content-row child like the leading glyph; appending it
        // last places the chevron after the title in the single `<button>`.
        const chevron = new Glyph(CHEVRON_GLYPH);
        chevron.setPointerEvents("none");
        chevron.setPreferredSize(CHEVRON_ZONE, CHEVRON_ZONE);

        this._chevronZone = new Component();
        this._chevronZone.setInsets(new Insets(0, 0, 0, 0));
        this._chevronZone.setPointerEvents("auto");
        this._chevronZone.setCursor("pointer");
        this._chevronZone.addComponent(chevron);

        this._content.addComponent(this._chevronZone);

        Event.addListener(this._chevronZone, "click", this._onChevronClick);
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

        const opts = { ...this._defaultOptions, ...options } as SplitButtonOptions;

        if (opts.menuItems !== undefined) {
            this.setMenuItems(opts.menuItems);
        }

        return this;
    }

    /**
     * Returns the button's auto-derived preferred size, which already includes
     * the trailing chevron zone because the chevron rides the content row that
     * the size is measured from. Restated here (rather than inherited) so the
     * generated docs carry this subclass's own description.
     *
     * @returns The preferred `{width, height}`.
     */
    getPreferredSize(): Size | null {
        return super.getPreferredSize();
    }

    /**
     * Opens (or reuses) the rebuild-mode dropdown anchored under the button's
     * bottom-left corner. No-op when there is no DOM element yet (the button
     * is unattached) so an anchor rect can always be read.
     */
    private _openMenu(): void {
        const rect = this.getElement()?.getBoundingClientRect();
        if (!rect) {
            return;
        }

        this._menu ??= new Menu();

        this._menu.show(rect.left, rect.bottom, this._menuItems);
    }
}

const SplitButtonCallable = callable(SplitButton);
type SplitButtonCallable = SplitButton;
export {
    SplitButton         as _SplitButton,
    SplitButtonCallable as SplitButton
};
