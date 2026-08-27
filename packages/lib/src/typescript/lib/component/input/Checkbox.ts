// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Animation } from "~/core/Animation.js";
import { AbstractBooleanInput, AbstractBooleanInputOptions } from "~/component/input/AbstractBooleanInput.js";
import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM, type Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { Glyph, GlyphOptions } from "~/component/display/Glyph.js";
import { HBox } from "~/layout/HBox.js";
import { type StyleBag, type StyleStateSpec } from "~/core/ClassStyleRules.js";
import { ThemeManager } from "~/core/Theme.js";
import { callable } from "~/core/Callable.js";
import { check } from "~/glyphs/solid/check.js";

// Idempotent registration: the registry tolerates re-registration of the same
// glyph definition, and this side-effect import lets Checkbox stand on its own
// without an outside-the-class `Glyph.register` call.
Glyph.register(check);

// Physical width of `_box`'s own border on every side — fixed regardless of
// theme, matching the "1px" embedded in `_defaultCheckboxBoxOptions.border`
// below. Named so the ink-centring formula in the constructor states its
// intent instead of repeating a bare "1".
const CHECKBOX_BOX_BORDER_PX = 1;

/**
 * Square edge length of `_box` — the theme's `glyphLg` icon step (16px at
 * the shipped base). Resolved per construction, not frozen in a module
 * constant, so a `setTheme` that runs before the box is built is honoured —
 * mirrors `Glyph`'s own `glyphDefaultSize()` (component/display/Glyph.ts).
 */
function checkboxBoxSizePx(): number {
    return ThemeManager.getResolvedScale().glyphLg;
}

/**
 * Square edge length of the check glyph's ink — the theme's `glyphSm` icon
 * step (12px at the shipped base), fitted inside `_box`'s `glyphLg` padding
 * box.
 */
function checkboxCheckSizePx(): number {
    return ThemeManager.getResolvedScale().glyphSm;
}

const _defaultCheckboxBoxOptions: Partial<ComponentOptions> = {
    cursor:          "pointer",
    backgroundColor: "var(--ts-ui-checkbox-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))",
    border:          "1px solid var(--ts-ui-form-border, rgb(160, 160, 160))",
    borderRadius:    "var(--ts-ui-checkbox-radius, 3px)",
};

/** `_box`'s checked-state declarations, read by `ownStyleStates`' `.selected` entry — one source of truth, mirroring `ToggleButton`'s `TOGGLE_SELECTED_DECLARATIONS`. */
const CHECKBOX_SELECTED_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    backgroundColor: "var(--ts-ui-checkbox-bg-selected, rgb(30, 100, 200))",
    border:          "1px solid var(--ts-ui-checkbox-bg-selected, rgb(30, 100, 200))",
});

/** `_box`'s indeterminate-state declarations. Same shape as `CHECKBOX_SELECTED_DECLARATIONS`. */
const CHECKBOX_INDETERMINATE_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    backgroundColor: "var(--ts-ui-checkbox-bg-indeterminate, rgb(160, 160, 160))",
    border:          "1px solid var(--ts-ui-checkbox-bg-indeterminate, rgb(160, 160, 160))",
});

/**
 * The box graphic behind a {@link Checkbox} — the click + cursor surface.
 * Module-private: constructed only from `Checkbox`'s own constructor. Static
 * geometry, cursor, and border-radius are class defaults so every instance
 * shares one `.CheckboxBox` CSS rule instead of repeating them; the resting
 * backgroundColor/border are class defaults too, and the checked/indeterminate
 * background and border come from this class's own declared `ownStyleStates`
 * entries below, resolved onto the shared `.CheckboxBox.selected` /
 * `.CheckboxBox.indeterminate` class-tier rules — see
 * `plans/implemented/checkbox-radio-delegate-state-style-defaults.md`.
 */
class CheckboxBox extends Component {
    // Indeterminate wins when a box is (transiently) both — see `applyState`'s
    // own comment for why that can happen — so it's declared first.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".indeterminate",
            extract: (): StyleBag => ({
                backgroundColor: CHECKBOX_INDETERMINATE_DECLARATIONS.backgroundColor,
                border:          CHECKBOX_INDETERMINATE_DECLARATIONS.border,
            }),
        },
        {
            selector: ".selected",
            extract: (): StyleBag => ({
                backgroundColor: CHECKBOX_SELECTED_DECLARATIONS.backgroundColor,
                border:          CHECKBOX_SELECTED_DECLARATIONS.border,
            }),
        },
    ];

    private _selected:      boolean = false;
    private _indeterminate: boolean = false;

    constructor() {
        const size = checkboxBoxSizePx();

        super(undefined, {
            ..._defaultCheckboxBoxOptions,
            preferredSize: { width: size, height: size },
            minSize:       { width: size, height: size },
            maxSize:       { width: size, height: size },
        });
    }

    /**
     * Applies the checked/indeterminate visual state: toggles the CSS state
     * classes. The declared states' own background + border come from this
     * class's `ownStyleStates` entries above, resolved onto the shared
     * class-tier rule — nothing to write here, and nothing to restore when a
     * non-resting class is removed, since `_box`'s base rule is never
     * touched after construction (its `backgroundColor`/`border` come from
     * `_defaultCheckboxBoxOptions` alone).
     *
     * `selected` and `indeterminate` are not mutually exclusive as *passed
     * in* — `Checkbox.setIndeterminate` deliberately leaves `selected`
     * untouched, so a checkbox that is selected when it becomes indeterminate
     * reaches this method with both `true`. The `.selected` class is only
     * ever toggled on when `!indeterminate`, so the resting-isolation
     * selector's `:not(.selected):not(.indeterminate)` premise (the two CSS
     * classes themselves are mutually exclusive) holds regardless, and the
     * DOM matches the same indeterminate-wins priority `ownStyleStates`'
     * declared order already gives the style resolution.
     */
    applyState(selected: boolean, indeterminate: boolean): void {
        this._selected      = selected;
        this._indeterminate = indeterminate;

        // Unconditional, not gated on `this.getElement()`: `setStyleState`
        // updates `_activeStates` regardless of whether an element exists
        // yet (only its own DOM write is internally element-gated) — a
        // construction-time call must still record the state, or `render()`
        // below would have nothing correct to re-assert once the element
        // exists.
        this.setStyleState(".selected", selected && !indeterminate);
        this.setStyleState(".indeterminate", indeterminate);
    }

    /** Re-applies the cached state classes at render, for a state set before mount. */
    protected render(): Handle {
        const element = super.render();
        DOM.sink.apply(element, { toggleClass: { selected: this._selected && !this._indeterminate, indeterminate: this._indeterminate } });
        return element;
    }
}

const _defaultCheckboxCheckGlyphOptions: Partial<GlyphOptions> = {
    foregroundColor: "var(--ts-ui-checkbox-check-color, rgb(255, 255, 255))",
};

/**
 * The check-mark glyph inside a {@link Checkbox}'s box. `foregroundColor`
 * and `minSize`/`maxSize` are class defaults, so every instance shares one
 * `.CheckboxCheckGlyph` CSS rule instead of repeating them. `Checkbox`'s own
 * constructor still calls `setPreferredSize`/`setMaxSize` imperatively (a
 * `Glyph`'s construction-time size pin cannot itself be deferred to a
 * defaults bag — see `Glyph.applyOptions`), but that call now resolves to
 * the same value this class already defaults, so `Component.applyStyle`'s
 * render-time reconciliation (`reconcileRuleDeclaration`, since
 * `plans/implemented/reconciled-write-path-widening.md`) turns it into a
 * removal instead of a redundant per-instance declaration. Opacity (which of
 * unchecked/checked/indeterminate is showing) stays a per-instance runtime
 * write in `Checkbox.applySelected` — it is not a class constant.
 */
class CheckboxCheckGlyph extends Glyph {
    constructor() {
        const size = checkboxCheckSizePx();

        super("check", undefined, {
            ..._defaultCheckboxCheckGlyphOptions,
            minSize: { width: size, height: size },
            maxSize: { width: size, height: size },
        });
    }
}

const _defaultCheckboxDashOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-checkbox-check-color, rgb(255, 255, 255))",
    preferredSize:   { width: 8, height: 2 },
    maxSize:         { width: 8, height: 2 },
};

/** The indeterminate-state bar inside a {@link Checkbox}'s box. */
class CheckboxDash extends Component {
    constructor() {
        super(undefined, _defaultCheckboxDashOptions);
    }
}

/**
 * Construction-time options for {@link Checkbox}.
 *
 * @category Components
 */
export interface CheckboxOptions extends AbstractBooleanInputOptions {
    selected?:      boolean;
    value?:         boolean;
    indeterminate?: boolean;
    /**
     * Construction-time listener bag — the declarative form of `on()`. Adds the
     * checkbox's `action` shorthand to the inherited `change` / `binding`.
     */
    listeners?: {
        action?:  () => void;
        change?:  (value: boolean) => void;
        binding?: () => void;
    };
}

const _defaultCheckboxOptions: Partial<CheckboxOptions> = {
    outline: "none",
};

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
    extends AbstractBooleanInput<TOptions>
{
    private _box:   CheckboxBox;
    private _check: Glyph;
    private _dash:  Component;

    /**
     * Constructs a Checkbox.
     *
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: CheckboxOptions, subclassDefaults?: Partial<CheckboxOptions>);
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(
            { ...(options ?? {}) } as TOptions,
            { ..._defaultCheckboxOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
        );

        this.setLayoutManager(new HBox());

        const boxSize   = checkboxBoxSizePx();
        const checkSize = checkboxCheckSizePx();

        this._box = new CheckboxBox();
        // Min = preferred = max so the outer HBox shrink-on-overallocation
        // can't collapse the box graphic when the checkbox sits next to
        // flexible siblings. The explicit setMinSize/setMaxSize calls (not
        // just setSize) matter here: `CheckboxBox`'s own constructor-time
        // minSize/maxSize only ever materialises into `.CheckboxBox`'s
        // shared class-level CSS rule, which is cached from whichever
        // instance is constructed first in the page's lifetime — a later
        // instance built after a `setTheme` raises `scale.base` would still
        // render clamped to that first-cached value without an explicit
        // per-instance override here, the same reason `_check`'s size is
        // re-asserted imperatively below.
        this._box.setSize({ width: boxSize, height: boxSize });
        this._box.setMinSize({ width: boxSize, height: boxSize });
        this._box.setMaxSize({ width: boxSize, height: boxSize });

        this._check = new CheckboxCheckGlyph();
        this._check.setPreferredSize({ width: checkSize, height: checkSize });
        this._check.setMaxSize({ width: checkSize, height: checkSize });
        // With box-sizing: border-box and the CHECKBOX_BOX_BORDER_PX box border,
        // absolute children are positioned relative to the box's padding edge —
        // centring an inkSize graphic inside a boxSize box means
        // (boxSize − 2 × CHECKBOX_BOX_BORDER_PX − inkSize) / 2. `boxSize` and
        // `checkSize` both come from the same live theme snapshot, so this stays
        // correct at any `scale.base`.
        const checkOffset = (boxSize - 2 * CHECKBOX_BOX_BORDER_PX - checkSize) / 2;
        this._check.setX(checkOffset);
        this._check.setY(checkOffset);
        this._check.setOpacity(0);
        // Pass-through so clicks on the glyph still hit the box underneath.
        this._check.setPointerEvents("none");

        this._dash = new CheckboxDash();
        this._dash.setSize({ width: 8, height: 2 });
        // Same centring formula as `_check`, against the dash's own fixed 8×2 size
        // — the dash is a decorative bar, not a glyph icon, so its size stays a
        // fixed pixel constant even though its position must still track the
        // now-theme-relative box.
        this._dash.setX((boxSize - 2 * CHECKBOX_BOX_BORDER_PX - 8) / 2);
        this._dash.setY((boxSize - 2 * CHECKBOX_BOX_BORDER_PX - 2) / 2);
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

        // The box owns the user-toggle click so the pointer/click + cursor
        // surface is exactly the visible box graphic — clicks on a label or
        // in any stretched empty area pass through to the root, which has no
        // listener of its own. This pointer line stays per-subclass (a closure
        // over the widget `this`) because a listener registered on the child
        // box would otherwise bind `this` to the box; only the keyboard path,
        // registered on the root, moves into the base.
        Event.addListener(this._box, "click", () => this.activateFromPointer());
        this.installKeyboard();

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

        if (options.selected      !== undefined) this._options.selected      = options.selected;
        if (options.value         !== undefined) this._options.value         = options.value;
        if (options.indeterminate !== undefined) this._options.indeterminate = options.indeterminate;
        if (options.label         !== undefined) this._options.label         = options.label;
        if (options.enabled       !== undefined) this._options.enabled       = options.enabled;
        if (options.readOnly      !== undefined) this._options.readOnly      = options.readOnly;

        return this;
    }

    /**
     * Activates the checkbox from a click or key: a user activation from the
     * "mixed" state first clears the indeterminate flag and selects (WAI-ARIA);
     * otherwise it flips the selected state. `setSelected` handles the visual +
     * listener sync — calling it from a mixed state always lands at
     * `selected=true` because its guard treats indeterminate as a force-out.
     * The enabled/read-only guard is applied by the base before this runs.
     */
    protected activate(): void {
        if (this.isIndeterminate()) {
            this.setSelected(true);

            return;
        }

        this.setSelected(!this.isSelected());
    }

    /**
     * Returns the inner box graphic — the click + cursor surface.
     *
     * @returns The box component.
     */
    protected getInteractiveSurface(): Component {
        return this._box;
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

        // Existing consumers wire "click"-based behaviour through `on("action", fn)`,
        // so synthesize a "click" on the root so a programmatic state flip
        // continues to fire it. The user-toggle handler lives on `_box`, not
        // the root, so this synthetic event no longer races back into the
        // toggle path. Skip the synthetic click pre-mount — listeners haven't
        // attached yet and `fireEvent` would throw on the missing element.
        if (this.getElement()) {
            Event.fireEvent(this, "click");
        } else {
            console.warn("Checkbox '" + this.getId() + "' setSelected before mount; synthetic 'click' skipped.");
        }

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
     * Enables or disables the 120 ms check/fill CSS transition. Disabled
     * checkboxes still update their visual state instantly. Used by
     * `BooleanCell` to suppress the per-rebind transition flash when a
     * virtualized table re-binds many cells per scroll frame.
     *
     * @param value - `true` to keep the transition (default), `false` to remove it.
     */
    setAnimated(value: boolean): this {
        const t = value && !Animation.isReducedMotion();

        this._check.setTransition(t ? "opacity 120ms ease-out" : "none");
        this._dash .setTransition(t ? "opacity 120ms ease-out" : "none");
        this._box  .setTransition(t ? "background-color 120ms ease-out, border-color 120ms ease-out" : "none");

        return this;
    }

    /**
     * Registers a listener for one of this checkbox's events. `"action"` is a
     * typed semantic shorthand over {@link Event.addListener} for the native
     * click (used e.g. by the [`BooleanEditor`](/api/component/table/cell/editor/classes/BooleanEditor)
     * cell editor); `"change"` and `"binding"` are the inherited
     * {@link AbstractInput} listener-bag events.
     *
     * @param event - The event name.
     * @param listener - Callback invoked when the event fires.
     *
     * @returns This component, for method chaining.
     */
    on(event: "action",  listener: Event.Listener): this;
    on(event: "change",  listener: (value: boolean) => void): this;
    on(event: "binding", listener: () => void): this;
    on(event: "action" | "change" | "binding", listener: Function): this {
        if (event === "action") {
            Event.addListener(this, "click", listener as Event.Listener);

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
            Event.removeListener(this, "click", listener as Event.Listener);

            return this;
        }

        return super.off(event, listener);
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

        this._box.applyState(selected, indeterminate);

        this._check.setOpacity(selected && !indeterminate ? 1 : 0);
        this._dash.setOpacity(indeterminate ? 1 : 0);
    }

}

const CheckboxCallable = callable(Checkbox);
type CheckboxCallable<TOptions extends CheckboxOptions = CheckboxOptions> = Checkbox<TOptions>;
export {
    Checkbox         as _Checkbox,
    CheckboxCallable as Checkbox
};
