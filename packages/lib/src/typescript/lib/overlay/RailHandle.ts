// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import { StyleRule } from "~/core/StyleTarget.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";
import { Button, ButtonOptions } from "~/component/button/Button.js";
import { callable } from "~/core/Callable.js";

/** `.selected`'s background-color declaration. One source of truth for both `ownStyleStates`' extract and the constructor's write. */
const RAIL_HANDLE_SELECTED_BACKGROUND_COLOR = "var(--ts-ui-rail-handle-selected-bg)";

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
 * A single launcher button on a [`Rail`](/api/overlay/classes/Rail). A chromeless
 * [`Button`](/api/component/button/classes/Button) subclass that carries a
 * `selected` state — driven by the rail to mirror whether the handle's drawer
 * is open or its window is restored — rendered as a hover wash
 * (`--ts-ui-rail-handle-hover-bg`) and a selected wash
 * (`--ts-ui-rail-handle-selected-bg`).
 *
 * `RailHandle` is internal to the rail subsystem; the rail creates and owns its
 * handles, so consumers rarely construct one directly. It is exported for typing
 * and subclassing.
 *
 * @category Core
 */
class RailHandle extends Button<RailHandleOptions> {

    // Restates Button's own `[.pressed, :hover]` list and appends `.selected`
    // — see `ToggleButton.ownStyleStates` for why a subclass adding a state
    // restates its ancestor's whole list rather than merging. `.selected` is
    // last, so its guarded selector is `.selected:not(.pressed):not(:hover)`
    // — moot for isolation purposes (this class is always chromeless, so
    // `suppressIsolation` is in effect — see `Button.applyChromeOptions`),
    // but it lets `getBackgroundColor()` resolve `.selected`'s wash like any
    // other active-state layer.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        ...Button.ownStyleStates,
        {
            selector: ".selected",
            extract:  (): StyleBag => ({ backgroundColor: RAIL_HANDLE_SELECTED_BACKGROUND_COLOR }),
        },
    ];

    // Lazy hover rule. `:not(.selected)` keeps the brighter selected wash
    // winning while the pointer is over an already-open handle.
    private declare _railHoverRule?: StyleRule;
    private get railHoverRule(): StyleRule {
        return this._railHoverRule ??= this.createStyleRule(":hover:not(.selected)");
    }

    /**
     * Builds a chromeless launcher handle and queues its hover / selected washes.
     *
     * @param options - Construction-time options (label `text`, leading `glyph`,
     *   initial `selected` state).
     */
    constructor(options: RailHandleOptions = {}) {
        super(options.text, options, { chromeless: true });

        this.railHoverRule.set("backgroundColor", "var(--ts-ui-rail-handle-hover-bg)");
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
