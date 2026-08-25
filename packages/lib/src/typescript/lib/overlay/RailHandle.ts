// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";
import { Button, ButtonOptions } from "~/component/button/Button.js";
import { callable } from "~/core/Callable.js";

/**
 * `.selected`'s wash. `backgroundImage` / `shadow` are neutralised alongside
 * it in the extract below so the selected rule also outranks
 * `.Button:hover:not(.pressed)` on a handle that is selected *and* hovered —
 * see plans/implemented/railhandle-chromeless-dedup.md's Architecture
 * Decisions.
 */
const RAIL_HANDLE_SELECTED_BACKGROUND_COLOR = "var(--ts-ui-rail-handle-selected-bg)";

/**
 * Resting + pressed + hover defaults for {@link RailHandle}. The resting bag
 * (transparent background, no border, no shadow) restates what
 * `chromeless: true` used to compute imperatively in
 * `Button.applyChromeOptions`'s chromeless branch; the `pressedX` fields
 * restate what `pinPressedToResting` used to pin per instance, so a press
 * still shows no visual change. `pressedForegroundColor` restates the same
 * literal token `Button`'s own resting default uses
 * (`_defaultButtonOptions.foregroundColor` in Button.ts — module-private, so
 * not importable). Unlike `PickerButton`, the `hoverX` fields are a *real*
 * wash, not a pin to the resting values: a rail handle does highlight on
 * hover. `borderRadius: undefined` is an explicit key, not an omission, so it
 * wins over Button's own non-empty default in the `subclassDefaults` spread
 * merge below.
 */
const _defaultRailHandleOptions: Partial<ButtonOptions> = {
    backgroundColor:        "transparent",
    backgroundImage:        "none",
    border:                 "none",
    borderRadius:           undefined,
    shadow:                 "none",
    pressedForegroundColor: "var(--ts-ui-text-color, black)",
    pressedBackgroundColor: "transparent",
    pressedBackgroundImage: "none",
    pressedShadow:          "none",
    hoverBackgroundColor:   "var(--ts-ui-rail-handle-hover-bg)",
    hoverBackgroundImage:   "none",
    hoverShadow:            "none",
};

/**
 * Construction-time options for {@link RailHandle}.
 *
 * @category Core
 */
export interface RailHandleOptions extends ButtonOptions {
    /**
     * Whether the handle renders in its selected (target-open) wash.
     *
     * @defaultValue false
     */
    selected?: boolean;
}

/**
 * A single launcher button on a [`Rail`](/api/overlay/classes/Rail). A flat-chromed
 * [`Button`](/api/component/button/classes/Button) subclass that carries a
 * `selected` state — driven by the rail to mirror whether the handle's drawer
 * is open or its window is restored — rendered as a hover wash
 * (`--ts-ui-rail-handle-hover-bg`) and a selected wash
 * (`--ts-ui-rail-handle-selected-bg`).
 *
 * Declares its own resting chrome (transparent, no border/shadow) instead of
 * `chromeless: true`, and its `.pressed` / `.selected` / `:hover` looks as
 * declared style states — see plans/implemented/railhandle-chromeless-dedup.md.
 *
 * `RailHandle` is internal to the rail subsystem; the rail creates and owns its
 * handles, so consumers rarely construct one directly. It is exported for typing
 * and subclassing.
 *
 * @category Core
 */
class RailHandle extends Button<RailHandleOptions> {

    protected static readonly ownClassStyleDefaults: StyleBag = _defaultRailHandleOptions;

    // Declares Button's two states with RailHandle's own content, plus
    // `.selected`, ordered `[.pressed, .selected, :hover]`. Array order is
    // priority: putting `.selected` ahead of `:hover` generates the guard
    // `:hover:not(.pressed):not(.selected)`, reproducing the hand-written
    // `:hover:not(.selected)` rule this class used before — the selected
    // wash keeps winning while the pointer is over an already-open handle.
    // That is the reverse of `ToggleButton`'s order, deliberately; see
    // plans/implemented/railhandle-chromeless-dedup.md's Architecture
    // Decisions. Each extract names every key its Button-level counterpart
    // carries — four for `.pressed`, three for `:hover` — because state
    // content merges over the parent level, so an unnamed key would inherit
    // Button's raised gradient or drop shadow. `.selected` has no parent
    // entry, but names the same three so its rule also outranks
    // `.Button:hover:not(.pressed)` on a selected *and* hovered handle.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => ({
                foregroundColor: _defaultRailHandleOptions.pressedForegroundColor,
                backgroundColor: _defaultRailHandleOptions.pressedBackgroundColor,
                backgroundImage: _defaultRailHandleOptions.pressedBackgroundImage,
                shadow:          _defaultRailHandleOptions.pressedShadow,
            }),
        },
        {
            selector: ".selected",
            extract: (): StyleBag => ({
                backgroundColor: RAIL_HANDLE_SELECTED_BACKGROUND_COLOR,
                backgroundImage: "none",
                shadow:          "none",
            }),
        },
        {
            selector: ":hover",
            extract: (): StyleBag => ({
                backgroundColor: _defaultRailHandleOptions.hoverBackgroundColor,
                backgroundImage: _defaultRailHandleOptions.hoverBackgroundImage,
                shadow:          _defaultRailHandleOptions.hoverShadow,
            }),
        },
    ];

    /**
     * Builds a launcher handle.
     *
     * @param options - Construction-time options (label `text`, leading `glyph`,
     *   initial `selected` state).
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; forwarded so a subclass can seed a default without
     *   editing this class's own constant.
     */
    constructor(options: RailHandleOptions = {}, subclassDefaults?: Partial<ButtonOptions>) {
        super(options.text, options, { ..._defaultRailHandleOptions, ...(subclassDefaults ?? {}) });
    }

    /**
     * Applies a {@link RailHandleOptions} bag, dispatching the `selected` state
     * after inherited Button/Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This handle, for method chaining.
     */
    protected applyOptions(options: RailHandleOptions): this {
        super.applyOptions(options);

        if (options.selected !== undefined) {
            this.setSelected(options.selected);
        }

        return this;
    }

    /**
     * Returns whether the handle is currently selected.
     *
     * @returns True when selected.
     */
    isSelected(): boolean {
        return this._options.selected ?? false;
    }

    /**
     * Sets the selected state: toggles the `.selected` class (carrying the
     * selected wash) and mirrors the state onto `aria-pressed`.
     *
     * @param value - True to select the handle, false to deselect it.
     *
     * @returns This handle, for method chaining.
     */
    setSelected(value: boolean): this {
        this._options.selected = value;

        this.getAria().setPressed(value);

        // Unconditional, not gated on `this.getElement()`: `setStyleState`
        // updates `_activeStates` regardless of whether an element exists
        // yet (only its own DOM write is internally element-gated) — see
        // `ToggleButton.setSelected`'s own comment for the full reasoning.
        this.setStyleState(".selected", value);

        return this;
    }

    /**
     * Renders the handle element, applying the `.selected` class when selected.
     *
     * @returns The created element.
     */
    render() {
        const element = super.render();
        DOM.sink.apply(element, { toggleClass: { selected: this.isSelected() } });

        return element;
    }
}

const RailHandleCallable = callable(RailHandle);
type RailHandleCallable = RailHandle;
export {
    RailHandle         as _RailHandle,
    RailHandleCallable as RailHandle,
};
