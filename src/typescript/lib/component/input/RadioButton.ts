// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { HBox } from "~/layout/HBox.js";
import { Input } from "~/component/input/Input.js";
import { Label } from "~/component/input/Label.js";
import { callable } from "~/core/Callable.js";

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
class RadioButton<TOptions extends RadioButtonOptions = RadioButtonOptions> extends Component<TOptions> {

    private _label!: Label;
    private _radio!: Input;

    constructor(text? : string, options?: RadioButtonOptions) {
        // Forward options through the super cascade. `text`/`radioName`/
        // `selected`/`enabled` are late-built state (their setters reach into
        // `this.label` / `this.radio` which don't exist yet), so `applyOptions`
        // writes them pure to `_options` and they're dispatched from the body
        // below once the children are built.
        super({ ...(options ?? {}) } as TOptions);

        this.setLayoutManager(new HBox());

        this._radio = new Input();

        // Build the label with empty text — the late-built dispatch below
        // calls `setText` with the effective value (either the consumer's
        // `options.text` written into `_options` by the cascade, or the
        // positional `text` argument). Constructing with the value up-front
        // and then setting it again would be a double-write.
        this._label = new Label("", this._radio.getId());

        this.addComponent(this._radio);
        this.addComponent(this._label);

        this._radio.setPreferredSize(16, 16);
        this._radio.setMaxSize(16, 16);
        this._radio.setCursor("pointer");

        this.addActionListener(() => {
            this._options.selected = this._radio.getElement().checked;
        });

        // Late-built state: `applyOptions` wrote these pure into `_options`
        // because `this.label`/`this.radio` didn't exist yet. Dispatch now.
        const effectiveText = this._options.text ?? text;
        if (effectiveText !== undefined) {
            this._label.setText(effectiveText);
        }
        if (this._options.radioName !== undefined) {
            this.setRadioName(this._options.radioName);
        }
        if (this._options.selected !== undefined) {
            this.setSelected(this._options.selected);
        }
        if (this._options.enabled !== undefined) {
            this._radio.setDisabledAttribute(!this._options.enabled);
        }
    }

    /**
     * Applies a {@link RadioButtonOptions} bag. Inherited Component fields
     * cascade through `super.applyOptions`; the late-built fields
     * (`text`/`radioName`/`selected`/`enabled`, all of which touch
     * `this.label`/`this.radio`) are written pure to `_options` here and
     * dispatched from the constructor body once children exist.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        if (options.text      !== undefined) this._options.text      = options.text;
        if (options.radioName !== undefined) this._options.radioName = options.radioName;
        if (options.selected  !== undefined) this._options.selected  = options.selected;
        if (options.enabled   !== undefined) this._options.enabled   = options.enabled;

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
        return this.wrapInnerBaseline(this._label.getBaseline());
    }

    /**
     * Registers a listener for the radio input's 'change' event.
     *
     * @param listener - The callback to invoke when the radio selection changes.
     */
    addActionListener(listener: Function) : this {
        Event.addListener(this._radio, "change", listener);

        return this;
    }

    /**
     * Assigns a shared `name` attribute to the underlying radio input, grouping it with other radio buttons.
     *
     * @param name - The name to set on the radio input element.
     */
    setRadioName(name: string): this {
        this._options.radioName = name;
        this._radio.setName(name);

        return this;
    }

    /**
     * Removes the shared `name` attribute from the underlying radio input,
     * detaching it from any radio group it was part of.
     *
     * @returns This component, for method chaining.
     */
    clearRadioName(): this {
        if (this._options.radioName === undefined) {
            return this;
        }

        this._options.radioName = undefined;
        this._radio.clearName();

        return this;
    }

    /**
     * Returns the radio group name, or null if none has been set.
     *
     * @returns The name string, or null.
     */
    getRadioName(): string | null {
        return this._options.radioName ?? null;
    }

    /**
     * Sets the selected state and updates the radio input's checked property.
     *
     * @param value - True to select the radio button, false to deselect it.
     */
    setSelected(value: boolean) : this {
        this._options.selected = !!value;

        let element = this._radio.getElement();
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
    isSelected(): boolean {
        return this._options.selected ?? false;
    }

    /**
     * Renders the container element and sets the radio input type and checked state.
     *
     * @returns The created container HTMLInputElement with the internal radio input initialised.
     */
    render() {
        let element = <HTMLInputElement>super.render();

        this._radio.setType("radio");
        this._radio.getElement().checked = this.isSelected();

        if (this._options.radioName !== undefined) {
            this._radio.setName(this._options.radioName);
        }

        return element;
    }
}

const RadioButtonCallable = callable(RadioButton);
type RadioButtonCallable<TOptions extends RadioButtonOptions = RadioButtonOptions> = RadioButton<TOptions>;
export {
    RadioButton         as _RadioButton,
    RadioButtonCallable as RadioButton
};
