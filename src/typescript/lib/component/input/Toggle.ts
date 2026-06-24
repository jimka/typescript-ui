// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Animation } from "~/core/Animation.js";
import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { Component } from "~/core/Component.js";
import { Event } from "~/core/Event.js";
import { HBox } from "~/layout/HBox.js";
import { Text } from "~/component/input/Text.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Toggle}.
 *
 * @category Components
 */
export interface ToggleOptions extends AbstractInputOptions {
    value?: boolean;
    label?: string | null;
}

/**
 * A custom-drawn on/off switch widget rendered as a focusable `<div>` with
 * `role="switch"`.
 *
 * `Toggle` is not the same widget as
 * [`ToggleButton`](/api/component/button/classes/ToggleButton). `ToggleButton`
 * is a push-button that stays pressed; `Toggle` is the sliding-pill switch
 * pattern (System Settings, iOS-style). When toggled, the thumb slides via a
 * CSS transition; the slide is suppressed when the OS preference
 * `prefers-reduced-motion` is set.
 *
 * @category Components
 */
class Toggle<TOptions extends ToggleOptions = ToggleOptions>
    extends AbstractInput<boolean, TOptions>
{
    private _track: Component;
    private _thumb: Component;
    private _label: Text | null = null;

    /**
     * Constructs a Toggle.
     *
     * @param options - Optional construction-time options.
     */
    constructor(options?: TOptions) {
        super({ ...(options ?? {}) } as TOptions);

        this.setLayoutManager(new HBox());

        this._track = new Component();
        this._track.setBackgroundColor("var(--ts-ui-toggle-track-bg-off, rgb(200, 200, 200))");
        this._track.setBorderRadius("999px");
        this._track.setPreferredSize(36, 20);
        // Min = preferred = max so the outer HBox shrink-on-overallocation
        // can't collapse the pill when the Toggle is packed alongside
        // flexible siblings.
        this._track.setMinSize(36, 20);
        this._track.setMaxSize(36, 20);
        // The track owns the click + cursor surface so the pointer/click area
        // matches the visible pill exactly. The root stays inert (default
        // cursor, no click listener), so clicks on the label or in any
        // stretched empty space don't toggle and don't show the pointer cursor.
        this._track.setCursor("pointer");

        this._thumb = new Component();
        this._thumb.setBackgroundColor("var(--ts-ui-toggle-thumb-bg, rgb(255, 255, 255))");
        this._thumb.setBorderRadius("999px");
        this._thumb.setPreferredSize(16, 16);
        this._thumb.setMaxSize(16, 16);
        // The track's default Absolute layout never sizes its children, so the
        // thumb collapses to 0 × 0 unless we set the rendered size explicitly.
        this._thumb.setSize({ width: 16, height: 16 });
        this._thumb.setShadow("0 1px 2px rgba(0, 0, 0, 0.25)");
        this._thumb.setX(2);
        this._thumb.setY(2);
        // Pass-through so clicks on the thumb still hit the track underneath.
        this._thumb.setPointerEvents("none");

        if (!Animation.isReducedMotion()) {
            this._thumb.setTransition("transform 120ms ease-out");
            this._track.setTransition("background-color 120ms ease-out");
        }

        this._track.addComponent(this._thumb);
        super.addComponent(this._track);

        this.getAria().setRole("switch");
        this.getAria().setTabIndex(0);
        this.getAria().setChecked(false);

        this.setOutline("none");

        this.installInteraction();

        // Late-built dispatch: applyOptions buffered these onto _options because
        // children didn't exist yet. Run their setters now.
        if (this._options.value !== undefined) {
            this.applyValue(this._options.value);
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
     * Applies a {@link ToggleOptions} bag. Inherited Component fields cascade
     * through `super.applyOptions`; toggle-specific fields are stored pure on
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

        if (opts.value    !== undefined) this._options.value    = opts.value;
        if (opts.label    !== undefined) this._options.label    = opts.label;
        if (opts.enabled  !== undefined) this._options.enabled  = opts.enabled;
        if (opts.readOnly !== undefined) this._options.readOnly = opts.readOnly;

        return this;
    }

    /**
     * Wires the keyboard (Space / Enter) and click handlers that flip the
     * toggle. Read-only and disabled controls suppress user-driven flips.
     */
    private installInteraction(): void {
        // The track owns the user-toggle handler so the click and cursor
        // surface is exactly the visible pill — clicks on a label or in any
        // stretched empty area pass through to the root, which has no
        // listener of its own. Keydown still targets the focused root.
        Event.addListener(this._track, "click", () => {
            if (this.isEnabled() && !this.isReadOnly()) {
                this.setValue(!this.getValue());
            }
        });

        Event.addListener(this, "keydown", (e: KeyboardEvent) => {
            if (e.key !== " " && e.key !== "Enter") {
                return;
            }

            e.preventDefault();

            if (this.isEnabled() && !this.isReadOnly()) {
                this.setValue(!this.getValue());
            }
        });
    }

    /**
     * Returns the current on/off state.
     *
     * @returns `true` when on, `false` when off.
     */
    getValue(): boolean {
        return this._options.value ?? false;
    }

    /**
     * Sets the on/off state. Notifies change and binding listeners on a real
     * transition; no-op when the value is unchanged.
     *
     * @param value - The new on/off state.
     *
     * @returns This component, for method chaining.
     */
    setValue(value: boolean): this {
        const next = !!value;
        if (next === this.getValue()) {
            return this;
        }

        this._options.value = next;
        this.applyValue(next);
        this.notifyChange(next);

        return this;
    }

    /**
     * Resets the value to `false`.
     *
     * @returns This component, for method chaining.
     */
    clearValue(): this {
        return this.setValue(false);
    }

    /**
     * Returns the label text, or `null` when the toggle has no label.
     *
     * @returns The label string, or `null`.
     */
    getLabel(): string | null {
        return this._options.label ?? null;
    }

    /**
     * Sets the label text; pass `null` to remove the label.
     *
     * @param text - The new label text, or `null` to clear.
     *
     * @returns This component, for method chaining.
     */
    setLabel(text: string | null): this {
        this._options.label = text;
        this.applyLabel(text);

        return this;
    }

    /**
     * Returns the offset from the top of the toggle to the inline label's text
     * baseline, or `null` when there is no label (HBox falls back to bottom-edge
     * alignment).
     *
     * @returns The baseline offset in pixels, or `null`.
     *
     * @remarks The reported baseline includes the offset that centres the label
     * on the pill because `doLayout` nudges the label down to sit concentric with the taller pill;
     * the outer row must align the label at that lowered position so its text
     * baseline still meets the row's.
     */
    getBaseline(): number | null {
        const label = this._label;
        if (label === null) {
            return null;
        }

        const baseline = label.getBaseline();
        if (baseline === null) {
            return null;
        }

        return this.wrapInnerBaseline(baseline + this.labelCenterOffset());
    }

    /**
     * Pixels to push the inline label down so it sits centred on the pill.
     *
     * The 36×20 pill is taller than the text line, but the inner `HBox`
     * top-aligns the shorter label against the row's text baseline — leaving the
     * pill bottom-heavy, its extra height hanging entirely below the text. A
     * same-height control (the 16×16 checkbox box) needs no correction because
     * top-aligning it already centres it on the line; the taller pill does.
     * Centring the label on the pill (and folding this into {@link getBaseline})
     * makes the pill sit concentric with the text line instead.
     *
     * @returns Pixels to push the label down, or 0 when there is no label or it
     * is at least as tall as the pill.
     */
    private labelCenterOffset(): number {
        if (this._label === null) {
            return 0;
        }

        const trackHeight = this._track.getPreferredSize()?.height ?? 0;
        const labelHeight = this._label.getPreferredSize()?.height ?? trackHeight;

        return Math.max(0, Math.round((trackHeight - labelHeight) / 2));
    }

    /**
     * Lays out the pill and label, then nudges the label down so it sits
     * concentric with the taller pill. The
     * inner `HBox` top-aligns the label to the row's text baseline on every
     * pass, so re-reading its placed `y` here keeps the nudge idempotent.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const label  = this._label;
        const offset = this.labelCenterOffset();
        if (label !== null && offset > 0) {
            label.setY(label.getY() + offset);
        }

        return this;
    }

    /**
     * Pushes a new value to the visual + ARIA state.
     */
    private applyValue(value: boolean): void {
        this.getAria().setChecked(value);

        // Thumb travel: track width 36, thumb size 16, 2px inset on each side =>
        // off at x=2, on at x=36-16-2=18 => translate 16px to the right.
        this._thumb.setTransform(value ? "translateX(16px)" : "translateX(0px)");

        this._track.setBackgroundColor(value
            ? "var(--ts-ui-toggle-track-bg-on, rgb(30, 100, 200))"
            : "var(--ts-ui-toggle-track-bg-off, rgb(200, 200, 200))");
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
        this._track.setCursor(value ? "pointer" : "default");
    }

    /**
     * Reflects the read-only flag in the ARIA tree.
     */
    protected applyReadOnly(value: boolean): void {
        this.getAria().setReadOnly(value);
    }

}

const ToggleCallable = callable(Toggle);
type ToggleCallable<TOptions extends ToggleOptions = ToggleOptions> = Toggle<TOptions>;
export {
    Toggle         as _Toggle,
    ToggleCallable as Toggle
};
