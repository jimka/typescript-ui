// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { StateStyleRule } from "~/core/ClassStyleRules.js";
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
 * `ToggleButton`'s own default `.selected:not(:hover)` declarations. Unlike
 * Button's pressed/hover fields, these are never threaded through the
 * options bag — the constructor writes them as literal theme tokens — so
 * this is a plain module constant rather than an `_defaultOptions` read.
 */
const TOGGLE_SELECTED_DECLARATIONS: Readonly<Record<string, string | null>> = Object.freeze({
    boxShadow:       "var(--ts-ui-toggle-selected-shadow, 2px 2px 1px inset grey)",
    backgroundColor: "var(--ts-ui-toggle-selected-bg, rgb(200, 200, 200))",
    backgroundImage: "var(--ts-ui-toggle-selected-bg, none)",
});

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
    // returned by Component's `createStateStyleRule` builder — see Button's
    // `_pressedStyleRule` for the full explanation.
    private declare _selectedStyleRule?: StateStyleRule;
    private get selectedStyleRule(): StateStyleRule {
        return this._selectedStyleRule ??= this.createStateStyleRule(".selected:not(:hover)", () => this.getSelectedClassDeclarations(), "extractSelectedClassDeclarations");
    }

    /**
     * This class's resolved `.selected:not(:hover)` declarations. Safe to
     * dedupe now that `getRestingExclusionSuffixes()` (below) isolates the same
     * three properties from `.selected` the same way `Button` isolates them
     * from `.pressed` — see `plans/implemented/state-chrome-isolation-generalization.md`.
     */
    protected static extractSelectedClassDeclarations(defaults: Partial<ButtonOptions>): Record<string, string | null> {
        if (defaults.chromeless) {
            return {};
        }

        return {
            boxShadow:       TOGGLE_SELECTED_DECLARATIONS.boxShadow!,
            backgroundColor: TOGGLE_SELECTED_DECLARATIONS.backgroundColor!,
            backgroundImage: TOGGLE_SELECTED_DECLARATIONS.backgroundImage!,
        };
    }

    protected getSelectedClassDeclarations(): Record<string, string | null> {
        return (this.constructor as typeof ToggleButton).extractSelectedClassDeclarations(this._defaultOptions);
    }

    /**
     * `.selected`'s resting chrome must stay isolated too, the same way
     * `Button`'s own `.pressed` does — a `ToggleButton`'s resting
     * `backgroundColor` / `backgroundImage` / `boxShadow` must not undercut the
     * shared `.ClassName.selected:not(:hover)` rule above.
     */
    protected override getRestingExclusionSuffixes(): readonly string[] {
        return [...super.getRestingExclusionSuffixes(), ".selected"];
    }

    constructor(text: string, options?: ToggleButtonOptions, subclassDefaults?: Partial<ToggleButtonOptions>) {
        // Button is a children-build class: it builds its inner text/HBox row
        // in its constructor body. We forward the positional `text` to super
        // (no options), queue the selected-state styles into the lazy rule,
        // then dispatch the consumer options through `applyOptions` at the
        // tail so Button's own option-backed setters run after children exist.
        // `subclassDefaults` is forwarded regardless, since it only seeds the
        // `_defaultOptions` fallback bag — a separate, independent parameter
        // from `options` — so a subclass's own defaults (e.g. `TabButton`'s
        // tab fill) still layer in even though `options` waits.
        super(text, undefined, subclassDefaults);

        // Warms the `.selected:not(:hover)` state rule so its class-tier rule
        // (see `getSelectedClassDeclarations`) exists from construction, without
        // queuing a per-instance write: `resolveDefaults` (called eagerly by
        // `createStateStyleRule`, via virtual dispatch) already seeds the
        // class-tier rule with this instance's own resolved tokens. Writing
        // `TOGGLE_SELECTED_DECLARATIONS`' literal values here (as this line
        // once did) would queue a real, base-class-tokened deviation into the
        // per-instance dirty bag before a subclass constructor (e.g.
        // `TabButton`'s `applyTabStyling`) gets to run its own, correctly
        // deduping writes — which, once they match their own class's resolved
        // bag, are skipped rather than clearing that stale value. See this
        // plan's Implementation Notes.
        void this.selectedStyleRule;

        Event.addListener(this, "click", () => this.onAction());

        if (options) {
            this.applyOptions(options);
        }

        // Button's constructor skipped the listener bag (it wires only a plain
        // Button); wire it here, after super() and applyOptions, as the leaf.
        this.applyListeners(options?.listeners);
    }

    /**
     * Applies a {@link ToggleButtonOptions} bag, dispatching the toggle's
     * `selected` state after inherited Button/Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: ToggleButtonOptions): this {
        super.applyOptions(options);

        if (options.selected !== undefined) {
            this.setSelected(options.selected);
        }

        // Button's flat branch runs in `applyChromeOptions` and re-points only
        // Button's own hover/pressed rules — it never touches this toggle's
        // `.selected` rule. Re-point it here so a `new ToggleButton(text,
        // { flat: true })` reads depressed when selected, mirroring `setFlat`.
        if (this.isFlat()) {
            this.setSelectedShadow("var(--ts-ui-button-flat-pressed-shadow, inset 1px 1px 3px rgba(0, 0, 0, 0.25))");
            this.setSelectedBackgroundColor("var(--ts-ui-button-flat-pressed-bg, rgba(0, 0, 0, 0.10))");
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
            DOM.sink.apply(element, { toggleClass: { selected: value } });
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
     * Toggles the flat appearance, then re-points the `.selected:not(:hover)`
     * rule so a toggled-on flat button reads as depressed with the same sunken
     * treatment Button's `.pressed` class applies when flat. Flattening points the
     * selected shadow/background at the `--ts-ui-button-flat-pressed-*` tokens;
     * un-flattening restores the default `--ts-ui-toggle-selected-*` tokens.
     *
     * @param value - The new flat state.
     *
     * @returns This button, for method chaining.
     */
    setFlat(value: boolean): this {
        super.setFlat(value);

        // Read the resolved state, not the requested `value`: `super.setFlat`
        // can refuse the flip (chromeless wins) or no-op on an unchanged value,
        // and the selected rule must track whatever flat state actually holds.
        if (this.isFlat()) {
            this.setSelectedShadow("var(--ts-ui-button-flat-pressed-shadow, inset 1px 1px 3px rgba(0, 0, 0, 0.25))");
            this.setSelectedBackgroundColor("var(--ts-ui-button-flat-pressed-bg, rgba(0, 0, 0, 0.10))");
        } else {
            this.setSelectedShadow("var(--ts-ui-toggle-selected-shadow, 2px 2px 1px inset grey)");
            this.setSelectedBackgroundColor("var(--ts-ui-toggle-selected-bg, rgb(200, 200, 200))");
        }

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
        DOM.sink.apply(element, { toggleClass: { selected: this.isSelected() } });
        return element;
    }
}

const ToggleButtonCallable = callable(ToggleButton);
type ToggleButtonCallable = ToggleButton;
export {
    ToggleButton         as _ToggleButton,
    ToggleButtonCallable as ToggleButton
};
