// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Event } from "~/core/Event.js";
import { Input, InputOptions } from "~/component/input/Input.js";
import { Bindable } from "~/core/Bindable.js";
import { ThemeManager } from "~/core/Theme.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Checkbox}.
 *
 * @category Components
 */
export interface CheckboxOptions extends InputOptions {
    selected?: boolean;
    value?:    boolean;
    enabled?:  boolean;
}

/**
 * A checkbox input component.
 *
 * Wraps an `<input type="checkbox">` element and tracks checked state internally,
 * keeping it synchronised with the DOM after each click.
 *
 * @category Components
 */
class Checkbox extends Input implements Bindable<boolean> {

    private selected: boolean = false;

    constructor(options?: CheckboxOptions) {
        super();

        this.setPreferredSize(16, 16);
        this.setMaxSize(16, 16);
        this.setCursor("pointer");
        this.setColorScheme(ThemeManager.getTheme().colorScheme);

        ThemeManager.onThemeChange(() => this.setColorScheme(ThemeManager.getTheme().colorScheme));

        this.addActionListener(this.onAction);

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link CheckboxOptions} bag, dispatching the checked state and
     * the native disabled attribute after inherited Input/Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: CheckboxOptions): this {
        super.applyOptions(options);

        if (options.selected !== undefined) {
            this.setSelected(options.selected);
        }

        if (options.value !== undefined) {
            this.setValue(options.value);
        }

        if (options.enabled !== undefined) {
            this.setDisabledAttribute(!options.enabled);
        }

        return this;
    }

    /**
     * Syncs the selected state from the DOM element's checked property after a click.
     */
    onAction() {
        let element = this.getElement();
        this.selected = element.checked;
    }

    /**
     * Registers a click event listener on this checkbox.
     *
     * @param listener - The callback to invoke on each click.
     *
     * @returns This component, for method chaining.
     */
    addActionListener(listener: Function): this {
        Event.addListener(this, "click", listener);

        return this;
    }

    setValue(value: boolean): this {
        this.setSelected(value);

        return this;
    }

    getValue(): boolean {
        return this.isSelected();
    }

    addBindingListener(fn: () => void): this {
        this.addActionListener(fn);

        return this;
    }

    /**
     * Sets the selected state and updates the checkbox element's checked property.
     *
     * @param value - True to check the box, false to uncheck it.
     *
     * @returns This component, for method chaining.
     */
    setSelected(value: boolean): this {
        this.selected = !!value;

        let element = this.getElement();
        if (!element) {
            return this;
        }

        element.checked = this.isSelected();

        return this;
    }

    /**
     * Returns whether the checkbox is currently checked.
     *
     * @returns True if the checkbox is checked.
     */
    isSelected() {
        return this.selected;
    }

    /**
     * Renders the input element with type="checkbox" and initial checked state.
     *
     * @returns The created HTMLInputElement with type and checked initialised.
     */
    render() {
        let element = super.render();

        element.setAttribute("type", "checkbox");
        element.checked = this.isSelected();

        return element;
    }
}

const CheckboxCallable = callable(Checkbox);
type CheckboxCallable = Checkbox;
export {
    Checkbox         as _Checkbox,
    CheckboxCallable as Checkbox
};
