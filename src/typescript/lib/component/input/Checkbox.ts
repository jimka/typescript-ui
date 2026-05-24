// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Animation } from "~/core/Animation.js";
import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { Glyph } from "~/component/display/Glyph.js";
import { HBox } from "~/layout/HBox.js";
import { Text } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";
import { check } from "~/glyphs/solid/check.js";

// Idempotent registration: the registry tolerates re-registration of the same
// glyph definition, and this side-effect import lets Checkbox stand on its own
// without an outside-the-class `Glyph.register` call.
Glyph.register(check);

/**
 * Construction-time options for {@link Checkbox}.
 *
 * @category Components
 */
export interface CheckboxOptions extends AbstractInputOptions {
    selected?:      boolean;
    value?:         boolean;
    indeterminate?: boolean;
    label?:         string | null;
}

/**
 * A custom-drawn checkbox rendered as a focusable `<div>` with `role="checkbox"`.
 *
 * The control owns a small `<div>` box that hosts a check {@link Glyph}; when
 * `indeterminate` is set, a horizontal bar replaces the check. The native
 * `<input type="checkbox">` is intentionally not used so the visual is fully
 * themable through the shared `--ts-ui-form-*` and per-control checkbox tokens.
 *
 * @category Components
 */
class Checkbox<TOptions extends CheckboxOptions = CheckboxOptions>
    extends AbstractInput<boolean, TOptions>
{
    private _box:   Component;
    private _check: Glyph;
    private _dash:  Component;
    private _label: Text | null = null;

    /**
     * Constructs a Checkbox.
     *
     * @param options - Optional construction-time options.
     */
    constructor(options?: TOptions) {
        super({ ...(options ?? {}) } as TOptions);

        this.setLayoutManager(new HBox());

        this._box = new Component();
        this._box.setPreferredSize(16, 16);
        // Min = preferred = max so the outer HBox shrink-on-overallocation
        // can't collapse the box graphic when the checkbox sits next to
        // flexible siblings.
        this._box.setMinSize(16, 16);
        this._box.setMaxSize(16, 16);
        this._box.setSize({ width: 16, height: 16 });
        this._box.setBackgroundColor("var(--ts-ui-checkbox-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))");
        this._box.setBorder("1px solid var(--ts-ui-form-border, rgb(160, 160, 160))");
        this._box.setBorderRadius("var(--ts-ui-checkbox-radius, 3px)");
        // The box owns the click + cursor surface so the pointer/click area
        // matches the visible graphic exactly. The root stays inert (default
        // cursor, no click listener), so clicks on the label or on stretched
        // empty space don't toggle and don't show the pointer cursor.
        this._box.setCursor("pointer");

        this._check = new Glyph("check");
        this._check.setForegroundColor("var(--ts-ui-checkbox-check-color, rgb(255, 255, 255))");
        this._check.setPreferredSize(12, 12);
        this._check.setMaxSize(12, 12);
        this._check.setX(2);
        this._check.setY(2);
        this._check.setOpacity(0);
        // Pass-through so clicks on the glyph still hit the box underneath.
        this._check.setPointerEvents("none");

        this._dash = new Component();
        this._dash.setBackgroundColor("var(--ts-ui-checkbox-check-color, rgb(255, 255, 255))");
        this._dash.setPreferredSize(8, 2);
        this._dash.setMaxSize(8, 2);
        this._dash.setSize({ width: 8, height: 2 });
        this._dash.setX(4);
        this._dash.setY(7);
        this._dash.setOpacity(0);
        this._dash.setPointerEvents("none");

        if (!Animation.isReducedMotion()) {
            this._check.setTransition("opacity 120ms ease-out");
            this._dash.setTransition("opacity 120ms ease-out");
            this._box.setTransition("background-color 120ms ease-out, border-color 120ms ease-out");
        }

        this._box.addComponent(this._check);
        this._box.addComponent(this._dash);
        super.addComponent(this._box);

        this.getAria().setRole("checkbox");
        this.getAria().setTabIndex(0);
        this.getAria().setChecked(false);

        this.setOutline("none");

        this.installInteraction();

        if (this._options.value !== undefined && this._options.selected === undefined) {
            this._options.selected = this._options.value;
        }

        if (this._options.selected !== undefined) {
            this.applySelected(this._options.selected, this._options.indeterminate ?? false);
        }

        if (this._options.indeterminate !== undefined) {
            this.applySelected(this._options.selected ?? false, this._options.indeterminate);
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
     * Applies a {@link CheckboxOptions} bag. Inherited Component fields cascade
     * through `super.applyOptions`; checkbox-specific fields are stored pure on
     * `_options` so the constructor body can dispatch them after children are
     * built.
     *
     * @param options - The options bag carrying the values to apply.
     *
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as TOptions;

        if (opts.selected      !== undefined) this._options.selected      = opts.selected;
        if (opts.value         !== undefined) this._options.value         = opts.value;
        if (opts.indeterminate !== undefined) this._options.indeterminate = opts.indeterminate;
        if (opts.label         !== undefined) this._options.label         = opts.label;
        if (opts.enabled       !== undefined) this._options.enabled       = opts.enabled;
        if (opts.readOnly      !== undefined) this._options.readOnly      = opts.readOnly;

        return this;
    }

    /**
     * Wires the click and keyboard handlers that toggle the checkbox state.
     */
    private installInteraction(): void {
        const userToggle = (): void => {
            if (!this.isEnabled() || this.isReadOnly()) {
                return;
            }

            // WAI-ARIA: user click from "mixed" first clears the indeterminate
            // flag and selects. `setSelected` handles the visual + listener
            // sync; calling it from a mixed state always lands at selected=true
            // because `setSelected`'s guard treats indeterminate as a force-out.
            if (this.isIndeterminate()) {
                this.setSelected(true);

                return;
            }

            this.setSelected(!this.isSelected());
        };

        // The box owns the user-toggle handler so the click and cursor surface
        // is exactly the visible 16 × 16 graphic — clicks on a label or in
        // any stretched empty area pass through to the root, which has no
        // listener of its own. Keydown still targets the focused root.
        Event.addListener(this._box, "click", userToggle);
        Event.addListener(this, "keydown", (e: KeyboardEvent) => {
            if (e.key === " ") {
                e.preventDefault();
                userToggle();
            }
        });
    }

    /**
     * Returns whether the checkbox is currently selected.
     *
     * @returns `true` when checked.
     */
    isSelected(): boolean {
        return this._options.selected ?? false;
    }

    /**
     * Sets the checked state. Notifies change and binding listeners on a real
     * transition; no-op when unchanged.
     *
     * @param value - `true` to check, `false` to uncheck.
     *
     * @returns This component, for method chaining.
     */
    setSelected(value: boolean): this {
        const next = !!value;
        if (next === this.isSelected() && !this.isIndeterminate()) {
            return this;
        }

        this._options.selected = next;
        this._options.indeterminate = false;
        this.applySelected(next, false);
        this.notifyChange(next);

        // Existing consumers wire "click"-based behaviour through `addActionListener`,
        // so synthesize a "click" on the root so a programmatic state flip
        // continues to fire it. The user-toggle handler lives on `_box`, not
        // the root, so this synthetic event no longer races back into the
        // toggle path.
        Event.fireEvent(this, "click");

        return this;
    }

    /**
     * Returns the current value (alias for {@link isSelected}, satisfies
     * [`Bindable`](/api/core/interfaces/Bindable)).
     *
     * @returns `true` when checked.
     */
    getValue(): boolean {
        return this.isSelected();
    }

    /**
     * Sets the value (alias for {@link setSelected}, satisfies [`Bindable`](/api/core/interfaces/Bindable)).
     *
     * @param value - The new boolean state.
     *
     * @returns This component, for method chaining.
     */
    setValue(value: boolean): this {
        return this.setSelected(value);
    }

    /**
     * Returns whether the checkbox is in the mixed (`indeterminate`) state.
     *
     * @returns `true` when indeterminate.
     */
    isIndeterminate(): boolean {
        return this._options.indeterminate ?? false;
    }

    /**
     * Toggles the mixed (`indeterminate`) state. Setting `true` overrides the
     * visible check with a horizontal bar and announces `aria-checked="mixed"`.
     *
     * @param value - `true` to enter the mixed state, `false` to leave it.
     *
     * @returns This component, for method chaining.
     */
    setIndeterminate(value: boolean): this {
        const next = !!value;
        if (next === this.isIndeterminate()) {
            return this;
        }

        this._options.indeterminate = next;
        this.applySelected(this.isSelected(), next);

        return this;
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
     * Back-compat alias kept for existing consumers (e.g. the [`BooleanEditor`](/api/component/table/cell/editor/classes/BooleanEditor)
     * cell editor) that listen for "click" on the underlying control. Wires
     * the listener through `Event.addListener` on this component.
     *
     * @param listener - Callback invoked on each click.
     *
     * @returns This component, for method chaining.
     */
    addActionListener(listener: Function): this {
        Event.addListener(this, "click", listener);

        return this;
    }

    /**
     * Returns the offset from the top of the checkbox to the inline label's
     * text baseline, or `null` when the checkbox has no label (HBox falls back
     * to bottom-edge alignment).
     *
     * @returns The baseline offset in pixels, or `null`.
     */
    getBaseline(): number | null {
        if (this._label === null) {
            return null;
        }

        return this.wrapInnerBaseline(this._label.getBaseline());
    }

    /**
     * Updates the visual + ARIA state for a (selected, indeterminate) pair.
     */
    private applySelected(selected: boolean, indeterminate: boolean): void {
        if (indeterminate) {
            this.getAria().setChecked("mixed");
        } else {
            this.getAria().setChecked(selected);
        }

        const filled = selected || indeterminate;
        this._box.setBackgroundColor(filled
            ? "var(--ts-ui-checkbox-bg-selected, rgb(30, 100, 200))"
            : "var(--ts-ui-checkbox-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))");
        this._box.setBorder(filled
            ? "1px solid var(--ts-ui-checkbox-bg-selected, rgb(30, 100, 200))"
            : "1px solid var(--ts-ui-form-border, rgb(160, 160, 160))");

        this._check.setOpacity(selected && !indeterminate ? 1 : 0);
        this._dash.setOpacity(indeterminate ? 1 : 0);
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
        this._box.setCursor(value ? "pointer" : "default");
    }

    /**
     * Reflects the read-only flag in the ARIA tree.
     */
    protected applyReadOnly(value: boolean): void {
        this.getAria().setReadOnly(value);
    }

}

const CheckboxCallable = callable(Checkbox);
type CheckboxCallable<TOptions extends CheckboxOptions = CheckboxOptions> = Checkbox<TOptions>;
export {
    Checkbox         as _Checkbox,
    CheckboxCallable as Checkbox
};
