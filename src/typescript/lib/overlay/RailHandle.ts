// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Button, ButtonOptions } from "~/component/button/Button.js";
import { callable } from "~/core/Callable.js";

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

    // Lazy `.selected` rule — the selected (target-open) wash. The slot is a
    // fast-path cache for the wrapper `createStyleRule` dedupes by suffix; see
    // Button's `_pressedStyleRule` for the full explanation.
    private declare _selectedRule?: StyleRule;
    private get selectedRule(): StyleRule {
        return this._selectedRule ??= this.createStyleRule(".selected");
    }

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
        this.selectedRule.set("backgroundColor", "var(--ts-ui-rail-handle-selected-bg)");
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

        const element = this.getElement();
        if (element) {
            DOM.sink.apply(element, { toggleClass: { selected: value } });
        }

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
