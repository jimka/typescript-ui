// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/Component.js";
import { Event } from "~/Event.js";
import { HBox } from "~/layout/HBox.js";
import { Input } from "~/component/Input.js";
import { Label } from "~/component/Label.js";
import { callable } from "~/Callable.js";

/**
 * Construction-time options for {@link RadioButton}.
 *
 * @category Components
 */
export interface RadioButtonOptions extends ComponentOptions {
    text?:      string;
    radioName?: string;
    selected?:  boolean;
    enabled?:   boolean;
}

/**
 * A radio button component composed of an `<input type="radio">` and an associated Label.
 *
 * The label's `for` attribute is wired to the radio input's ID so clicking the label
 * toggles the radio. The selected state is kept in sync via a 'change' listener.
 *
 * @category Components
 */
class RadioButton extends Component {

    private selected: boolean = false;
    private label: Label;
    private radio: Input;
    private _radioName: string | null = null;

    constructor(text? : string, options?: RadioButtonOptions) {
        super();

        this.setLayoutManager(new HBox());

        this.radio = new Input();

        this.label = new Label(text ?? "", this.radio.getId());

        this.addComponent(this.radio);
        this.addComponent(this.label);

        this.radio.setPreferredSize(16, 16);
        this.radio.setMaxSize(16, 16);
        this.radio.setCursor("pointer");

        this.addActionListener(() => {
            this.selected = this.radio.getElement().checked;
        });

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link RadioButtonOptions} bag, dispatching label text, radio
     * group name, selection, and enabled state after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: RadioButtonOptions): this {
        super.applyOptions(options);

        if (options.text !== undefined) {
            this.label.setText(options.text);
        }

        if (options.radioName !== undefined) {
            this.setRadioName(options.radioName);
        }

        if (options.selected !== undefined) {
            this.setSelected(options.selected);
        }

        if (options.enabled !== undefined) {
            this.radio.setElementAttribute("disabled", options.enabled ? null : "");
        }

        return this;
    }

    /**
     * Returns the DOM element cast to HTMLInputElement.
     *
     * @param createIfMissing - Optional. When true, renders the element if it does not yet exist.
     *
     * @returns The component's container element cast to HTMLInputElement.
     */
    getElement(createIfMissing: boolean = false) {
        return <HTMLInputElement>super.getElement(createIfMissing);
    }

    /**
     * Returns the offset from the top of the radio button to the label's text baseline.
     *
     * @returns The baseline offset in pixels, or `null` when the label has no baseline.
     */
    getBaseline(): number | null {
        return this.wrapInnerBaseline(this.label.getBaseline());
    }

    /**
     * Registers a listener for the radio input's 'change' event.
     *
     * @param listener - The callback to invoke when the radio selection changes.
     */
    addActionListener(listener: Function) : this {
        Event.addListener(this.radio, "change", listener);

        return this;
    }

    /**
     * Assigns a shared `name` attribute to the underlying radio input, grouping it with other radio buttons.
     *
     * @param name - The name to set on the radio input element.
     */
    setRadioName(name: string): this {
        this._radioName = name;
        this.radio.setElementAttribute("name", name);

        return this;
    }

    /**
     * Returns the radio group name, or null if none has been set.
     *
     * @returns The name string, or null.
     */
    getRadioName(): string | null {
        return this._radioName;
    }

    /**
     * Sets the selected state and updates the radio input's checked property.
     *
     * @param value - True to select the radio button, false to deselect it.
     */
    setSelected(value: boolean) : this {
        this.selected = !!value;

        let element = this.radio.getElement();
        if (!element) {
            return this;
        }

        element.checked = this.isSelected();

        return this;
    }

    /**
     * Returns whether the radio button is currently selected.
     *
     * @returns True if the radio button is checked.
     */
    isSelected() {
        return this.selected;
    }

    /**
     * Renders the container element and sets the radio input type and checked state.
     *
     * @returns The created container HTMLInputElement with the internal radio input initialised.
     */
    render() {
        let element = <HTMLInputElement>super.render();

        this.radio.setElementAttribute("type", "radio");
        this.radio.getElement().checked = this.isSelected();

        if (this._radioName !== null) {
            this.radio.setElementAttribute("name", this._radioName);
        }

        return element;
    }
}

const RadioButtonCallable = callable(RadioButton);
type RadioButtonCallable = RadioButton;
export {
    RadioButton         as _RadioButton,
    RadioButtonCallable as RadioButton
};
