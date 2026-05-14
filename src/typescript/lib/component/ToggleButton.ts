// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { CSS } from "~/CSS.js";
import { Event } from "~/Event.js";
import { Button, ButtonOptions } from "~/component/Button.js";
import { callable } from "~/Callable.js";

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
class ToggleButton extends Button {

    private selected: boolean = false;
    private selectedCSSRule: CSSStyleRule;

    constructor(text: string, options?: ToggleButtonOptions) {
        super(text);

        this.selectedCSSRule = CSS.createComponentRule(this.getId() + ".selected") as CSSStyleRule;
        this.selectedCSSRule.style.setProperty('box-shadow', 'var(--ts-ui-toggle-selected-shadow, 2px 2px 1px inset grey)');
        this.selectedCSSRule.style.setProperty('background-color', 'var(--ts-ui-toggle-selected-bg, rgb(200, 200, 200))');
        this.selectedCSSRule.style.setProperty('background-image', 'var(--ts-ui-toggle-selected-bg, none)');

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

        if (options.selected !== undefined) {
            this.setSelected(options.selected);
        }

        return this;
    }

    /**
     * Registers a listener for the 'change' event, fired when the toggle state changes.
     *
     * @param listener - The callback to invoke when the selection state changes.
     */
    addActionListener(listener: Function) : this {
        Event.addListener(this, "change", listener);

        return this;
    }

    /**
     * Returns whether the toggle button is currently in the selected state.
     *
     * @returns True if the button is currently selected.
     */
    isSelected() {
        return this.selected;
    }

    /**
     * Sets the selected state, toggles the 'selected' CSS class, and updates `aria-pressed`.
     *
     * @param value - True to select the button, false to deselect it.
     */
    setSelected(value: boolean) : this {
        this.selected = value;

        this.getAria().setPressed(value);

        let element = this.getElement();
        if (element) {
            element.classList.toggle("selected", value);
        }

        return this;
    }

    /**
     * Toggles the selected state and fires a 'change' event when the button is clicked.
     */
    private onAction() {
        this.setSelected(!this.selected);

        Event.fireEvent(this, "change");
    }

    /**
     * Renders the button element and applies the 'selected' class if currently selected.
     *
     * @returns The created button element with the 'selected' class applied if appropriate.
     */
    render() {
        let element = super.render();
        element.classList.toggle("selected", this.selected);
        return element;
    }
}

const ToggleButtonCallable = callable(ToggleButton);
type ToggleButtonCallable = ToggleButton;
export {
    ToggleButton         as _ToggleButton,
    ToggleButtonCallable as ToggleButton
};
