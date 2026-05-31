// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { StyleRule } from "~/core/StyleTarget.js";
import { Event } from "~/core/Event.js";
import { BorderOptions, borderToStyle } from "~/primitive/Border.js";
import { Button, ButtonOptions, ClickListener } from "~/component/button/Button.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link ToggleButton}.
 *
 * @category Components
 */
export interface ToggleButtonOptions extends ButtonOptions {
    selected?: boolean;
}

/**
 * A toggle button component that switches between selected and unselected states on each click.
 *
 * Maintains a separate CSS rule for the `.selected` class to allow independent styling of
 * the active state, and fires a 'change' event whenever the selection state changes.
 *
 * @category Components
 */
class ToggleButton extends Button<ToggleButtonOptions> {

    // Lazy `.selected` rule. The slot is a fast-path cache for the wrapper
    // returned by Component's `createStyleRule` builder, which dedupes by
    // selector suffix — see Button's `_pressedStyleRule` for the full
    // explanation.
    private declare _selectedStyleRule?: StyleRule;
    private get selectedStyleRule(): StyleRule {
        return this._selectedStyleRule ??= this.createStyleRule(".selected:not(:hover)");
    }

    constructor(text: string, options?: ToggleButtonOptions) {
        // Button is a children-build class: it builds its inner text/HBox row
        // in its constructor body. We forward the positional `text` to super
        // (no options), queue the selected-state styles into the lazy rule,
        // then dispatch the consumer options through `applyOptions` at the
        // tail so Button's own option-backed setters run after children exist.
        super(text);

        this.selectedStyleRule.set("boxShadow",       "var(--ts-ui-toggle-selected-shadow, 2px 2px 1px inset grey)");
        this.selectedStyleRule.set("backgroundColor", "var(--ts-ui-toggle-selected-bg, rgb(200, 200, 200))");
        this.selectedStyleRule.set("backgroundImage", "var(--ts-ui-toggle-selected-bg, none)");

        Event.addListener(this, "click", () => this.onAction());

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link ToggleButtonOptions} bag, dispatching the toggle's
     * `selected` state after inherited Button/Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: ToggleButtonOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as ToggleButtonOptions;

        if (opts.selected !== undefined) {
            this.setSelected(opts.selected);
        }

        return this;
    }

    /**
     * Registers a listener for this toggle button's `"action"` event — fired
     * when the toggle state changes. Overrides the inherited
     * [`Button`](/api/component/button/classes/Button) `on` so `"action"`
     * routes to the DOM `"change"` event (the toggle) rather than the base
     * `"click"`. A typed semantic shorthand over {@link Event.addListener}.
     *
     * @param event - The event name. Only `"action"` is accepted.
     * @param listener - The callback to invoke when the toggle state changes.
     *
     * @returns This button, for method chaining.
     */
    on(event: "action", listener: ClickListener): this;
    on(_event: "action", listener: ClickListener): this {
        Event.addListener(this, "change", listener);

        return this;
    }

    /**
     * Removes a previously registered `"action"` listener. The exact
     * callback reference must match the one passed to {@link on}.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This button, for method chaining.
     */
    off(event: "action", listener: ClickListener): this;
    off(_event: "action", listener: ClickListener): this {
        Event.removeListener(this, "change", listener);

        return this;
    }

    /**
     * Returns whether the toggle button is currently in the selected state.
     *
     * @returns True if the button is currently selected.
     */
    isSelected(): boolean {
        return this._options.selected ?? false;
    }

    /**
     * Sets the selected state, toggles the 'selected' CSS class, and updates `aria-pressed`.
     *
     * @param value - True to select the button, false to deselect it.
     */
    setSelected(value: boolean) : this {
        this._options.selected = value;

        this.getAria().setPressed(value);

        let element = this.getElement();
        if (element) {
            element.classList.toggle("selected", value);
        }

        return this;
    }

    /**
     * Sets the background color for the `.selected` CSS rule, overriding the
     * default `--ts-ui-toggle-selected-bg` token for this instance.
     *
     * @param backgroundColor - A CSS color string.
     *
     * @returns This button, for method chaining.
     */
    setSelectedBackgroundColor(backgroundColor: string): this {
        this.selectedStyleRule.set("backgroundColor", backgroundColor);

        return this;
    }

    /**
     * Sets the background image for the `.selected` CSS rule. Pairs with
     * {@link setSelectedBackgroundColor} so a plain colour drops out (invalid
     * as an image) and a gradient wins, matching the framework's background
     * colour/image auto-routing.
     *
     * @param backgroundImage - A CSS background-image string.
     *
     * @returns This button, for method chaining.
     */
    setSelectedBackgroundImage(backgroundImage: string): this {
        this.selectedStyleRule.set("backgroundImage", backgroundImage);

        return this;
    }

    /**
     * Sets the box-shadow for the `.selected` CSS rule, overriding the default
     * `--ts-ui-toggle-selected-shadow` token for this instance.
     *
     * @param shadow - A CSS box-shadow string (e.g. `"none"`).
     *
     * @returns This button, for method chaining.
     */
    setSelectedShadow(shadow: string): this {
        this.selectedStyleRule.set("boxShadow", shadow);

        return this;
    }

    /**
     * Sets the border for the `.selected` CSS rule, overriding the default
     * selected-state border for this instance. Accepts either a {@link BorderOptions}
     * bag or a CSS `border` shorthand string (sugar for `{ border: <string> }`,
     * e.g. `"1px solid rgb(...)"` or `"none"`).
     *
     * @param options - Border configuration, or a CSS `border` shorthand value.
     *
     * @returns This button, for method chaining.
     */
    setSelectedBorder(options: BorderOptions | string): this {
        const border = typeof options === "string" ? { border: options } : options;
        this.selectedStyleRule.setMany(borderToStyle(border));

        return this;
    }

    /**
     * Toggles the selected state and fires a 'change' event when the button is clicked.
     */
    private onAction() {
        this.setSelected(!this.isSelected());

        Event.fireEvent(this, "change");
    }

    /**
     * Renders the button element and applies the 'selected' class if currently selected.
     *
     * @returns The created button element with the 'selected' class applied if appropriate.
     */
    render() {
        let element = super.render();
        element.classList.toggle("selected", this.isSelected());
        return element;
    }
}

const ToggleButtonCallable = callable(ToggleButton);
type ToggleButtonCallable = ToggleButton;
export {
    ToggleButton         as _ToggleButton,
    ToggleButtonCallable as ToggleButton
};
