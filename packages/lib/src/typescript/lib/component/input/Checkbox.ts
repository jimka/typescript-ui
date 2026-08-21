// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Animation } from "~/core/Animation.js";
import { AbstractBooleanInput, AbstractBooleanInputOptions } from "~/component/input/AbstractBooleanInput.js";
import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM, type Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { Glyph, GlyphOptions } from "~/component/display/Glyph.js";
import { HBox } from "~/layout/HBox.js";
import { type StateStyleRule } from "~/core/ClassStyleRules.js";
import { borderToStyle } from "~/primitive/Border.js";
import { callable } from "~/core/Callable.js";
import { check } from "~/glyphs/solid/check.js";

// Idempotent registration: the registry tolerates re-registration of the same
// glyph definition, and this side-effect import lets Checkbox stand on its own
// without an outside-the-class `Glyph.register` call.
Glyph.register(check);

const _defaultCheckboxBoxOptions: Partial<ComponentOptions> = {
    preferredSize:   { width: 16, height: 16 },
    minSize:         { width: 16, height: 16 },
    maxSize:         { width: 16, height: 16 },
    cursor:          "pointer",
    backgroundColor: "var(--ts-ui-checkbox-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))",
    border:          "1px solid var(--ts-ui-form-border, rgb(160, 160, 160))",
    borderRadius:    "var(--ts-ui-checkbox-radius, 3px)",
};

/** `_box`'s checked-state declarations. Read by both `getSelectedClassDeclarations` and `applyState` — one source of truth, mirroring `ToggleButton`'s `TOGGLE_SELECTED_DECLARATIONS`. */
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
 * background and border write through `createStateStyleRule`-backed state
 * rules — see `plans/implemented/checkbox-radio-delegate-state-style-defaults.md`.
 */
class CheckboxBox extends Component {
    private _selected:      boolean = false;
    private _indeterminate: boolean = false;

    private declare _selectedStyleRule?: StateStyleRule;
    private get selectedStyleRule(): StateStyleRule {
        return this._selectedStyleRule ??= this.createStateStyleRule(".selected", () => this.getSelectedClassDeclarations());
    }

    private declare _indeterminateStyleRule?: StateStyleRule;
    private get indeterminateStyleRule(): StateStyleRule {
        return this._indeterminateStyleRule ??= this.createStateStyleRule(".indeterminate", () => this.getIndeterminateClassDeclarations());
    }

    constructor() {
        super(undefined, _defaultCheckboxBoxOptions);
    }

    protected getSelectedClassDeclarations(): Record<string, string | null> {
        return {
            backgroundColor: CHECKBOX_SELECTED_DECLARATIONS.backgroundColor,
            ...borderToStyle({ border: CHECKBOX_SELECTED_DECLARATIONS.border }),
        };
    }

    protected getIndeterminateClassDeclarations(): Record<string, string | null> {
        return {
            backgroundColor: CHECKBOX_INDETERMINATE_DECLARATIONS.backgroundColor,
            ...borderToStyle({ border: CHECKBOX_INDETERMINATE_DECLARATIONS.border }),
        };
    }

    /**
     * `_box`'s own resting chrome must stay isolated from both non-resting
     * states — see `plans/implemented/checkbox-radio-delegate-state-style-defaults.md`.
     */
    protected override getRestingExclusionSuffixes(): readonly string[] {
        return [".selected", ".indeterminate"];
    }

    /**
     * Applies the checked/indeterminate visual state: toggles the CSS state
     * classes and, for a non-resting state, writes background + border
     * through the matching state-tier rule. The resting branch writes
     * nothing — `_box`'s base rule is never touched after construction (its
     * `backgroundColor`/`border` come from `_defaultCheckboxBoxOptions`
     * alone), so there is nothing to restore when a non-resting class is
     * removed; see this plan's Architecture Decisions.
     *
     * `selected` and `indeterminate` are not mutually exclusive as *passed
     * in* — `Checkbox.setIndeterminate` deliberately leaves `selected`
     * untouched, so a checkbox that is selected when it becomes indeterminate
     * reaches this method with both `true`. The `.selected` class is only
     * ever toggled on when `!indeterminate`, so the resting-isolation
     * selector's `:not(.selected):not(.indeterminate)` premise (the two CSS
     * classes themselves are mutually exclusive) holds regardless, and the
     * DOM matches the same indeterminate-wins priority the branch below
     * already applies to the style write.
     */
    applyState(selected: boolean, indeterminate: boolean): void {
        this._selected      = selected;
        this._indeterminate = indeterminate;

        const element = this.getElement();
        if (element) {
            DOM.sink.apply(element, { toggleClass: { selected: selected && !indeterminate, indeterminate } });
        }

        if (indeterminate) {
            this.indeterminateStyleRule.setMany({
                backgroundColor: CHECKBOX_INDETERMINATE_DECLARATIONS.backgroundColor,
                ...borderToStyle({ border: CHECKBOX_INDETERMINATE_DECLARATIONS.border }),
            });
        } else if (selected) {
            this.selectedStyleRule.setMany({
                backgroundColor: CHECKBOX_SELECTED_DECLARATIONS.backgroundColor,
                ...borderToStyle({ border: CHECKBOX_SELECTED_DECLARATIONS.border }),
            });
        }
    }

    /** Re-applies the cached state classes at render, for a state set before mount. */
    protected render(): Handle {
        const element = super.render();
        DOM.sink.apply(element, { toggleClass: { selected: this._selected && !this._indeterminate, indeterminate: this._indeterminate } });
        return element;
    }
}

// The check glyph's fitted size inside the box (14×14 padding box, 1px
// border): shared with Checkbox's own constructor below so the class
// default and the imperative override can never drift apart.
const CHECKBOX_CHECK_SIZE = { width: 12, height: 12 };

const _defaultCheckboxCheckGlyphOptions: Partial<GlyphOptions> = {
    foregroundColor: "var(--ts-ui-checkbox-check-color, rgb(255, 255, 255))",
    minSize:         CHECKBOX_CHECK_SIZE,
    maxSize:         CHECKBOX_CHECK_SIZE,
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
        super("check", undefined, _defaultCheckboxCheckGlyphOptions);
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

        this._box = new CheckboxBox();
        // Min = preferred = max so the outer HBox shrink-on-overallocation
        // can't collapse the box graphic when the checkbox sits next to
        // flexible siblings.
        this._box.setSize({ width: 16, height: 16 });

        this._check = new CheckboxCheckGlyph();
        this._check.setPreferredSize(CHECKBOX_CHECK_SIZE);
        this._check.setMaxSize(CHECKBOX_CHECK_SIZE);
        // With box-sizing: border-box and the 1px box border, absolute children
        // are positioned relative to the 14×14 padding edge — so centering a
        // 12×12 glyph inside the 16×16 visible box means (14−12)/2 = 1, not 2.
        this._check.setX(1);
        this._check.setY(1);
        this._check.setOpacity(0);
        // Pass-through so clicks on the glyph still hit the box underneath.
        this._check.setPointerEvents("none");

        this._dash = new CheckboxDash();
        this._dash.setSize({ width: 8, height: 2 });
        this._dash.setX(3);
        this._dash.setY(6);
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
        // surface is exactly the visible 16 × 16 graphic — clicks on a label or
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
