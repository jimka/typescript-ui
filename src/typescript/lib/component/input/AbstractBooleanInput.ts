// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Text } from "~/component/input/Text.js";
import { Util } from "~/core/Util.js";

/**
 * Construction-time options shared by the boolean-valued controls
 * ({@link Checkbox}, {@link RadioButton}, {@link Toggle}). Concrete subclasses
 * extend this with their own value / selected / indeterminate fields.
 *
 * @category Components
 */
export interface AbstractBooleanInputOptions extends AbstractInputOptions {
    label?: string | null;
}

/**
 * Abstract base for the three boolean-valued form controls — {@link Checkbox},
 * {@link RadioButton}, {@link Toggle}. Owns the mechanics they share verbatim:
 * the optional inline `_label` {@link Text} (mount / replace / remove), the
 * enabled / read-only ARIA + tabindex + interactive-surface cursor reflection,
 * the label-or-text baseline, and the keyboard-activation wiring routed through
 * the same enabled/read-only guard as pointer activation.
 *
 * Each subclass supplies only what differs: its inner graphic (the interactive
 * surface), the value mutation performed on activation, and — for {@link Toggle}
 * — the activation keys and a pill-centred baseline override. The value
 * semantics (`isSelected` /
 * `setSelected` / `getValue` / `setValue`, indeterminate handling, `ButtonGroup`
 * change firing, synthetic-click behaviour) stay in the subclasses.
 *
 * Not wrapped with `callable()` — abstract classes are never instantiated.
 *
 * @category Components
 */
abstract class AbstractBooleanInput<
    TOptions extends AbstractBooleanInputOptions = AbstractBooleanInputOptions
>
    extends AbstractInput<boolean, TOptions>
{
    // Written by `applyLabel` from the subclass constructor body (after
    // super()), never by a cascade-dispatched setter, so a plain `= null`
    // initializer is safe.
    protected _label: Text | null = null;

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
     * Returns the offset from the top of the control to its inline label's text
     * baseline, or — when there is no label — to the text baseline the graphic
     * would share with a label, so a label-less graphic still sits on a row's
     * baseline.
     *
     * @returns The baseline offset in pixels.
     *
     * @remarks A `null` baseline auto-centres the graphic within the row's
     * text-line height, which floats a small graphic to the row centre once a
     * tall sibling (e.g. a `TextArea`) inflates the row's descent. Returning the
     * text-line baseline keeps the graphic aligned exactly as a labelled
     * control's graphic would be. {@link Toggle} overrides this for its taller
     * pill.
     */
    getBaseline(): number | null {
        if (this._label === null) {
            return this.wrapInnerBaseline(Util.measureTextBaseline());
        }

        return this.wrapInnerBaseline(this._label.getBaseline());
    }

    /**
     * Mounts, replaces, or removes the inline label.
     *
     * @param text - The label text, or `null` to remove the label.
     */
    protected applyLabel(text: string | null): void {
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
     * Reflects the enabled flag in the ARIA tree, the tabindex, and the
     * interactive surface's cursor.
     *
     * @param value - The new enabled state.
     */
    protected applyEnabled(value: boolean): void {
        this.getAria().setDisabled(!value);
        this.getAria().setTabIndex(value ? 0 : -1);
        this.getInteractiveSurface().setCursor(value ? "pointer" : "default");
    }

    /**
     * Reflects the read-only flag in the ARIA tree.
     *
     * @param value - The new read-only state.
     */
    protected applyReadOnly(value: boolean): void {
        this.getAria().setReadOnly(value);
    }

    /**
     * Keydown handler: activates the control when the pressed key is one of
     * {@link activationKeys} and the control is enabled and not read-only.
     *
     * @param e - The keyboard event.
     */
    private handleActivationKey(e: KeyboardEvent): void {
        if (!this.activationKeys().includes(e.key)) {
            return;
        }

        e.preventDefault();

        if (this.isEnabled() && !this.isReadOnly()) {
            this.activate();
        }
    }

    /**
     * Wires the keyboard-activation listener on the focused root. Called from
     * each subclass constructor after its graphic is built.
     */
    protected installKeyboard(): void {
        Event.addListener(this, "keydown", this.handleActivationKey);
    }

    /**
     * Activates the control from a pointer click, subject to the same
     * enabled/read-only guard as the keyboard path. Wired by each subclass
     * onto its interactive surface (so the hit area is exactly the visible
     * graphic).
     */
    protected activateFromPointer(): void {
        if (this.isEnabled() && !this.isReadOnly()) {
            this.activate();
        }
    }

    /**
     * Keys that activate the control. Defaults to Space; {@link Toggle} widens
     * it to Space and Enter.
     *
     * @returns The activation key strings.
     */
    protected activationKeys(): string[] {
        return [" "];
    }

    /**
     * Subclass hook: perform the value mutation for an activation (click or
     * key). Called only after the enabled/read-only guard has passed.
     */
    protected abstract activate(): void;

    /**
     * Subclass hook: the inner graphic that owns the click + cursor surface
     * ({@link Checkbox}'s box, {@link RadioButton}'s ring, {@link Toggle}'s
     * track).
     *
     * @returns The interactive surface component.
     */
    protected abstract getInteractiveSurface(): Component;
}

export { AbstractBooleanInput };
