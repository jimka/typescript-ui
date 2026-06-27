// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Animation } from "~/core/Animation.js";
import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Glyph } from "~/component/display/Glyph.js";
import { HBox } from "~/layout/HBox.js";
import { Text } from "~/component/input/Text.js";
import { Util } from "~/core/Util.js";
import { callable } from "~/core/Callable.js";
import { circle } from "~/glyphs/solid/circle.js";

// Idempotent registration: makes the `"circle"` glyph available for the dot
// regardless of which control imports first.
Glyph.register(circle);

/**
 * Construction-time options for {@link RadioButton}.
 *
 * @category Components
 */
export interface RadioButtonOptions extends AbstractInputOptions {
    selected?:  boolean;
    value?:     boolean;
    label?:     string | null;
    text?:      string;
    radioName?: string;
    /**
     * Construction-time listener bag — the declarative form of `on()`. Adds the
     * radio button's `action` shorthand to the inherited `change` / `binding`.
     */
    listeners?: {
        action?:  () => void;
        change?:  (value: boolean) => void;
        binding?: () => void;
    };
}

/**
 * A custom-drawn radio button rendered as a focusable `<div>` with
 * `role="radio"`. The ring + dot is drawn with framework primitives; the
 * native `<input type="radio">` is intentionally not used. Group selection
 * is coordinated by [`ButtonGroup`](/api/overlay/classes/ButtonGroup); keyboard
 * navigation within a group is provided by
 * [`RovingTabIndex`](/api/core/classes/RovingTabIndex).
 *
 * @category Components
 */
class RadioButton<TOptions extends RadioButtonOptions = RadioButtonOptions>
    extends AbstractInput<boolean, TOptions>
{
    private _ring:  Component;
    private _dot:   Glyph;
    private _label: Text | null = null;

    /**
     * Constructs a RadioButton.
     *
     * @param text - Optional label text. Equivalent to `options.label`; kept
     *               positional for back-compat with consumers that wrote
     *               `new RadioButton("Hello")`.
     * @param options - Optional construction-time options bag.
     */
    constructor(text?: string, options?: TOptions) {
        super({ ...(options ?? {}) } as TOptions);

        this.setLayoutManager(new HBox());

        this._ring = new Component();
        this._ring.setPreferredSize(16, 16);
        // Min = preferred = max so the outer HBox shrink-on-overallocation
        // can't collapse the ring graphic when the radio is packed into a
        // tight container with siblings that have flexible widths.
        this._ring.setMinSize(16, 16);
        this._ring.setMaxSize(16, 16);
        this._ring.setSize({ width: 16, height: 16 });
        this._ring.setBackgroundColor("var(--ts-ui-radio-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))");
        this._ring.setBorder("1px solid var(--ts-ui-form-border, rgb(160, 160, 160))");
        this._ring.setBorderRadius("50%");
        // The ring owns the click + cursor surface so the pointer/click area
        // matches the visible graphic exactly. The root stays inert (default
        // cursor, no click listener), so clicks on a label or in any
        // stretched empty space don't select and don't show the pointer cursor.
        this._ring.setCursor("pointer");

        this._dot = new Glyph("circle");
        this._dot.setForegroundColor("var(--ts-ui-radio-dot-color, rgb(255, 255, 255))");
        this._dot.setPreferredSize(8, 8);
        this._dot.setMaxSize(8, 8);
        this._dot.setX(3);
        this._dot.setY(3);
        this._dot.setOpacity(0);
        // Pass-through so clicks on the dot still hit the ring underneath.
        this._dot.setPointerEvents("none");

        if (!Animation.isReducedMotion()) {
            this._dot.setTransition("opacity 120ms ease-out");
            this._ring.setTransition("background-color 120ms ease-out, border-color 120ms ease-out");
        }

        this._ring.addComponent(this._dot);
        super.addComponent(this._ring);

        this.getAria().setRole("radio");
        this.getAria().setTabIndex(0);
        this.getAria().setChecked(false);

        this.setOutline("none");

        this.installInteraction();

        // The positional `text` arg wins only when `options.label` (or
        // `options.text`) was not provided.
        if (this._options.label === undefined && this._options.text === undefined && text !== undefined) {
            this._options.label = text;
        } else if (this._options.label === undefined && this._options.text !== undefined) {
            this._options.label = this._options.text;
        }

        if (this._options.value !== undefined && this._options.selected === undefined) {
            this._options.selected = this._options.value;
        }

        if (this._options.selected !== undefined) {
            this.applySelected(this._options.selected);
        }

        if (this._options.label !== undefined) {
            this.applyLabel(this._options.label);
        }

        if (this._options.enabled !== undefined) {
            this.applyEnabled(this._options.enabled);
        }

        if (this._options.readOnly !== undefined) {
            this.applyReadOnly(this._options.readOnly);
        }
    }

    /**
     * Applies a {@link RadioButtonOptions} bag. Inherited Component fields
     * cascade through `super.applyOptions`; radio-button-specific fields are
     * stored pure on `_options` so the constructor body can dispatch them
     * after children are built.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        if (options.selected  !== undefined) this._options.selected  = options.selected;
        if (options.value     !== undefined) this._options.value     = options.value;
        if (options.label     !== undefined) this._options.label     = options.label;
        if (options.text      !== undefined) this._options.text      = options.text;
        if (options.radioName !== undefined) this._options.radioName = options.radioName;
        if (options.enabled   !== undefined) this._options.enabled   = options.enabled;
        if (options.readOnly  !== undefined) this._options.readOnly  = options.readOnly;

        return this;
    }

    /**
     * Wires the click + Space-key handlers that select the radio button.
     */
    private installInteraction(): void {
        const userSelect = (): void => {
            if (!this.isEnabled() || this.isReadOnly()) {
                return;
            }

            // Radio buttons can only be selected, never directly deselected by
            // the user — the ButtonGroup deselects siblings on change.
            if (!this.isSelected()) {
                this.setSelected(true);
                Event.fireEvent(this, "change");
            }
        };

        // The ring owns the user-select handler so the click and cursor surface
        // is exactly the visible 16 × 16 graphic — clicks on a label or in
        // any stretched empty area pass through to the root, which has no
        // listener of its own. Keydown still targets the focused root.
        Event.addListener(this._ring, "click", userSelect);
        Event.addListener(this, "keydown", (e: KeyboardEvent) => {
            if (e.key === " ") {
                e.preventDefault();
                userSelect();
            }
        });
    }

    /**
     * Returns whether the radio button is currently selected.
     *
     * @returns `true` when selected.
     */
    isSelected(): boolean {
        return this._options.selected ?? false;
    }

    /**
     * Sets the selected state and updates the visual + ARIA cache. Used both
     * by user-driven selection and by `ButtonGroup` when it deselects
     * siblings.
     *
     * @param value - `true` to select, `false` to deselect.
     *
     * @returns This component, for method chaining.
     */
    setSelected(value: boolean): this {
        const next = !!value;
        if (next === this.isSelected()) {
            return this;
        }

        this._options.selected = next;
        this.applySelected(next);
        this.notifyChange(next);

        return this;
    }

    /**
     * Returns the current value (alias for {@link isSelected}, satisfies
     * [`Bindable`](/api/core/interfaces/Bindable)).
     *
     * @returns `true` when selected.
     */
    getValue(): boolean {
        return this.isSelected();
    }

    /**
     * Sets the value (alias for {@link setSelected}, satisfies [`Bindable`](/api/core/interfaces/Bindable)).
     *
     * @param value - The new selected state.
     *
     * @returns This component, for method chaining.
     */
    setValue(value: boolean): this {
        return this.setSelected(value);
    }

    /**
     * Returns the label text, or `null` when none was set.
     *
     * @returns The label string, or `null`.
     */
    getLabel(): string | null {
        return this._options.label ?? null;
    }

    /**
     * Sets the inline label text. Pass `null` to remove the label entirely.
     *
     * @param text - The label text, or `null` to clear.
     *
     * @returns This component, for method chaining.
     */
    setLabel(text: string | null): this {
        this._options.label = text;
        this.applyLabel(text);

        return this;
    }

    /**
     * Back-compat shim that stores the supplied group name on `_options` but
     * does not emit a `name` attribute (the host element is no longer
     * `<input>`). Consumers that read the group name through
     * {@link getRadioName} keep working.
     *
     * @param name - Group name string.
     *
     * @returns This component, for method chaining.
     */
    setRadioName(name: string): this {
        this._options.radioName = name;

        return this;
    }

    /**
     * Clears the back-compat radio-name field.
     *
     * @returns This component, for method chaining.
     */
    clearRadioName(): this {
        this._options.radioName = undefined;

        return this;
    }

    /**
     * Returns the group name set via {@link setRadioName}, or `null`.
     *
     * @returns The group name string, or `null`.
     */
    getRadioName(): string | null {
        return this._options.radioName ?? null;
    }

    /**
     * Registers a listener for one of this radio button's events.
     * `"action"` is a typed semantic shorthand over {@link Event.addListener}
     * for the DOM change event — fired on user-driven selection and used by
     * [`ButtonGroup`](/api/overlay/classes/ButtonGroup) to enforce mutual
     * exclusivity. `"change"` and `"binding"` are the inherited
     * {@link AbstractInput} listener-bag events.
     *
     * @param event - The event name.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This component, for method chaining.
     */
    on(event: "action",  listener: Function): this;
    on(event: "change",  listener: (value: boolean) => void): this;
    on(event: "binding", listener: () => void): this;
    on(event: "action" | "change" | "binding", listener: Function): this {
        if (event === "action") {
            Event.addListener(this, "change", listener);

            return this;
        }

        return super.on(event as "change", listener as (value: boolean) => void);
    }

    /**
     * Removes a previously registered listener. The exact callback
     * reference must match the one passed to {@link on}.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This component, for method chaining.
     */
    off(event: "action" | "change" | "binding", listener: Function): this {
        if (event === "action") {
            Event.removeListener(this, "change", listener);

            return this;
        }

        return super.off(event, listener);
    }

    /**
     * Returns the offset from the top of the radio button to its inline label's
     * text baseline, or — when there is no label — to the text baseline the dot
     * would share with a label, so a label-less dot still sits on a row's
     * baseline.
     *
     * @returns The baseline offset in pixels.
     *
     * @remarks A `null` baseline auto-centres the child within the row's
     * text-line height, which floats a small dot to the row centre once a tall
     * sibling (e.g. a `TextArea`) inflates the row's descent. Returning the
     * text-line baseline keeps the dot aligned exactly as a labelled radio's
     * dot would be.
     */
    getBaseline(): number | null {
        if (this._label === null) {
            return this.wrapInnerBaseline(Util.measureTextBaseline());
        }

        return this.wrapInnerBaseline(this._label.getBaseline());
    }

    /**
     * Updates the visual + ARIA state for the given selected flag.
     */
    private applySelected(selected: boolean): void {
        this.getAria().setChecked(selected);

        this._ring.setBackgroundColor(selected
            ? "var(--ts-ui-radio-bg-selected, rgb(30, 100, 200))"
            : "var(--ts-ui-radio-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))");
        this._ring.setBorder(selected
            ? "1px solid var(--ts-ui-radio-bg-selected, rgb(30, 100, 200))"
            : "1px solid var(--ts-ui-form-border, rgb(160, 160, 160))");

        this._dot.setOpacity(selected ? 1 : 0);
    }

    /**
     * Mounts, replaces, or removes the inline label.
     */
    private applyLabel(text: string | null): void {
        if (text === null) {
            if (this._label !== null) {
                super.removeComponent(this._label);
                this._label = null;
            }

            return;
        }

        if (this._label === null) {
            this._label = new Text(text);
            this._label.setPointerEvents("none");
            super.addComponent(this._label);
        } else {
            this._label.setText(text);
        }
    }

    /**
     * Reflects the enabled flag in the ARIA tree and the tabindex.
     */
    protected applyEnabled(value: boolean): void {
        this.getAria().setDisabled(!value);
        this.getAria().setTabIndex(value ? 0 : -1);
        this._ring.setCursor(value ? "pointer" : "default");
    }

    /**
     * Reflects the read-only flag in the ARIA tree.
     */
    protected applyReadOnly(value: boolean): void {
        this.getAria().setReadOnly(value);
    }

}

const RadioButtonCallable = callable(RadioButton);
type RadioButtonCallable<TOptions extends RadioButtonOptions = RadioButtonOptions> = RadioButton<TOptions>;
export {
    RadioButton         as _RadioButton,
    RadioButtonCallable as RadioButton
};
