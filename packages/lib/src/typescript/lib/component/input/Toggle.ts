// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Animation } from "~/core/Animation.js";
import { AbstractBooleanInput, AbstractBooleanInputOptions } from "~/component/input/AbstractBooleanInput.js";
import { Component, ComponentOptions } from "~/core/Component.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";
import { DOM, type Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { HBox } from "~/layout/HBox.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Toggle}.
 *
 * @category Components
 */
export interface ToggleOptions extends AbstractBooleanInputOptions {
    value?: boolean;
}

const _defaultToggleOptions: Partial<ToggleOptions> = {
    outline: "none",
};

// The track owns the click + cursor surface so the pointer/click area
// matches the visible pill exactly. The root stays inert (default
// cursor, no click listener), so clicks on the label or in any
// stretched empty space don't toggle and don't show the pointer cursor.
const _defaultToggleTrackOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-toggle-track-bg-off, rgb(200, 200, 200))",
    borderRadius:    "999px",
    minSize:         { width: 36, height: 20 },
    maxSize:         { width: 36, height: 20 },
    cursor:          "pointer",
};

/** `.selected`'s backgroundColor declaration (the "on" fill), read by `ownStyleStates`' `.selected` entry — mirrors `CheckboxBox`'s `CHECKBOX_SELECTED_DECLARATIONS`. */
const TOGGLE_TRACK_SELECTED_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    backgroundColor: "var(--ts-ui-toggle-track-bg-on, rgb(30, 100, 200))",
});

/**
 * The pill graphic behind a {@link Toggle}'s thumb — the click + cursor
 * surface (see the comment above `_defaultToggleTrackOptions`). File-local —
 * not exported from the input barrel because it is a Toggle implementation
 * detail. Static geometry/cursor and the resting backgroundColor are class
 * defaults so every instance shares one `.ToggleTrack` CSS rule instead of
 * repeating them; the checked "on" fill comes from this class's own declared
 * `ownStyleStates` entry below, resolved onto the shared
 * `.ToggleTrack.selected` class-tier rule — mirrors `CheckboxBox`
 * (Checkbox.ts).
 */
class ToggleTrack extends Component {
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".selected",
            extract: (): StyleBag => ({ backgroundColor: TOGGLE_TRACK_SELECTED_DECLARATIONS.backgroundColor }),
        },
    ];

    private _checked: boolean = false;

    constructor() {
        super(undefined, _defaultToggleTrackOptions);
    }

    /** Applies the checked visual state. The `.selected` background comes from
     *  `ownStyleStates` above, resolved onto the shared class-tier rule. */
    applySelected(checked: boolean): void {
        this._checked = checked;
        this.setStyleState(".selected", checked);
    }

    /** Re-applies the cached checked state at render, for a state set before mount. */
    protected render(): Handle {
        const element = super.render();
        DOM.sink.apply(element, { toggleClass: { selected: this._checked } });
        return element;
    }
}

const _defaultToggleThumbOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-toggle-thumb-bg, rgb(255, 255, 255))",
    borderRadius:    "999px",
    maxSize:         { width: 16, height: 16 },
    shadow:          "0 1px 2px rgba(0, 0, 0, 0.25)",
};

/**
 * The sliding handle inside a {@link Toggle}'s track. File-local — not
 * exported from the input barrel because it is a Toggle implementation
 * detail. Its backgroundColor/borderRadius/maxSize/shadow are class defaults
 * so every instance shares one `.ToggleThumb` CSS rule instead of repeating
 * them.
 */
class ToggleThumb extends Component {
    constructor() {
        super(undefined, _defaultToggleThumbOptions);
    }
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
    extends AbstractBooleanInput<TOptions>
{
    private _track: ToggleTrack;
    private _thumb: ToggleThumb;

    /**
     * Constructs a Toggle.
     *
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: ToggleOptions, subclassDefaults?: Partial<ToggleOptions>);
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(
            { ...(options ?? {}) } as TOptions,
            { ..._defaultToggleOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
        );

        this.setLayoutManager(new HBox());

        this._track = new ToggleTrack();
        // Min = preferred = max so the outer HBox shrink-on-overallocation
        // can't collapse the pill when the Toggle is packed alongside
        // flexible siblings.
        this._track.setPreferredSize({ width: 36, height: 20 });

        this._thumb = new ToggleThumb();
        this._thumb.setPreferredSize({ width: 16, height: 16 });
        // The track's default Absolute layout never sizes its children, so the
        // thumb collapses to 0 × 0 unless we set the rendered size explicitly.
        this._thumb.setSize({ width: 16, height: 16 });
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

        // The track owns the user-toggle click so the pointer/click + cursor
        // surface is exactly the visible pill — clicks on a label or in any
        // stretched empty area pass through to the root, which has no listener
        // of its own. This pointer line stays per-subclass (a closure over the
        // widget `this`) because a listener registered on the child track would
        // otherwise bind `this` to the track; only the keyboard path, registered
        // on the root, moves into the base.
        Event.addListener(this._track, "click", () => this.activateFromPointer());
        this.installKeyboard();

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

        // Establishes the clean baseline for dirty-state tracking — see AbstractInput.markClean().
        this.markClean();
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

        if (options.value    !== undefined) this._options.value    = options.value;
        if (options.label    !== undefined) this._options.label    = options.label;
        if (options.enabled  !== undefined) this._options.enabled  = options.enabled;
        if (options.readOnly !== undefined) this._options.readOnly = options.readOnly;

        return this;
    }

    /**
     * Activates the toggle from a click or key by flipping the on/off state.
     * The enabled/read-only guard is applied by the base before this runs.
     */
    protected activate(): void {
        this.setValue(!this.getValue());
    }

    /**
     * Returns the inner track graphic — the click + cursor surface.
     *
     * @returns The track component.
     */
    protected getInteractiveSurface(): Component {
        return this._track;
    }

    /**
     * The toggle activates on Space and Enter (the switch idiom), widening the
     * base default of Space only.
     *
     * @returns The activation key strings.
     */
    protected activationKeys(): string[] {
        return [" ", "Enter"];
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
     * `super.doLayout()` can have placed `label` through
     * `LayoutManager.commitBounds`'s size-stable position fast path (the
     * label's own size is unchanged pass to pass), which leaves `getY()` at
     * its pre-move value and carries the move via translate — folding that in
     * before nudging, then re-zeroing it, is what keeps this idempotent
     * instead of compounding a growing offset every pass.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        const label  = this._label;
        const offset = this.labelCenterOffset();
        if (label !== null && offset > 0) {
            label.setY(label.getY() + label.getTranslateY() + offset);
            label.setTranslate(label.getTranslateX(), 0);
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
        this._track.applySelected(value);
    }

}

const ToggleCallable = callable(Toggle);
type ToggleCallable<TOptions extends ToggleOptions = ToggleOptions> = Toggle<TOptions>;
export {
    Toggle         as _Toggle,
    ToggleCallable as Toggle
};
