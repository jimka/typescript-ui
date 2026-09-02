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
import { circle } from "~/glyphs/solid/circle.js";

// Idempotent registration: makes the `"circle"` glyph available for the dot
// regardless of which control imports first.
Glyph.register(circle);

// Physical width of `_ring`'s own border on every side — fixed regardless
// of theme; mirrors `Checkbox.ts`'s `CHECKBOX_BOX_BORDER_PX`.
const RADIO_RING_BORDER_PX = 1;

/**
 * Square edge length of `_ring` — the theme's `glyphLg` icon step (16px at
 * the shipped base). Resolved per construction; mirrors `Checkbox.ts`'s
 * `checkboxBoxSizePx()`.
 */
function radioRingSizePx(): number {
    return ThemeManager.getResolvedScale().glyphLg;
}

/**
 * Square edge length of the dot's ink — the theme's `glyphXs` icon step
 * (8px at the shipped base), fitted inside `_ring`'s `glyphLg` padding box.
 */
function radioDotSizePx(): number {
    return ThemeManager.getResolvedScale().glyphXs;
}

const _defaultRadioButtonRingOptions: Partial<ComponentOptions> = {
    cursor:          "pointer",
    backgroundColor: "var(--ts-ui-radio-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))",
    border:          "1px solid var(--ts-ui-form-border, rgb(160, 160, 160))",
    borderRadius:    "50%",
};

/** `_ring`'s selected-state declarations, read by `ownStyleStates`' `.selected` entry. */
const RADIO_SELECTED_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    backgroundColor: "var(--ts-ui-radio-bg-selected, rgb(30, 100, 200))",
    border:          "1px solid var(--ts-ui-radio-bg-selected, rgb(30, 100, 200))",
});

/**
 * The ring graphic behind a {@link RadioButton}. See `CheckboxBox`'s doc
 * comment (Checkbox.ts) for the shape this mirrors — static geometry/cursor
 * and the resting backgroundColor/border are class defaults; the selected
 * background and border come from this class's own declared `ownStyleStates`
 * entry below, resolved onto the shared `.RadioButtonRing.selected` class-tier
 * rule — see `plans/implemented/checkbox-radio-delegate-state-style-defaults.md`.
 */
class RadioButtonRing extends Component {
    // Single-entry list: with only one declared state, its guarded suffix
    // is just its own selector (no `:not(...)` to add against a
    // higher-priority entry that doesn't exist).
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".selected",
            extract: (): StyleBag => ({
                backgroundColor: RADIO_SELECTED_DECLARATIONS.backgroundColor,
                border:          RADIO_SELECTED_DECLARATIONS.border,
            }),
        },
    ];

    private _selected: boolean = false;

    constructor() {
        const size = radioRingSizePx();

        super(undefined, {
            ..._defaultRadioButtonRingOptions,
            preferredSize: { width: size, height: size },
            minSize:       { width: size, height: size },
            maxSize:       { width: size, height: size },
        });
    }

    /** See `CheckboxBox.applyState`'s doc comment (Checkbox.ts) — identical reasoning, one state instead of two. */
    applyState(selected: boolean): void {
        this._selected = selected;

        // Unconditional, not gated on `this.getElement()`: `setStyleState`
        // updates `_activeStates` regardless of whether an element exists
        // yet — see `Checkbox.ts`'s `CheckboxBox.applyState` for the same
        // reasoning.
        this.setStyleState(".selected", selected);
    }

    protected render(): Handle {
        const element = super.render();
        DOM.sink.apply(element, { toggleClass: { selected: this._selected } });
        return element;
    }
}

const _defaultRadioButtonDotOptions: Partial<GlyphOptions> = {
    foregroundColor: "var(--ts-ui-radio-dot-color, rgb(255, 255, 255))",
};

/**
 * The filled dot inside a {@link RadioButton}'s ring. `foregroundColor` and
 * `minSize`/`maxSize` are class defaults, so every instance shares one
 * `.RadioButtonDot` CSS rule instead of repeating them. `RadioButton`'s own
 * constructor still calls `setPreferredSize`/`setMaxSize` imperatively (a
 * `Glyph`'s construction-time size pin cannot itself be deferred to a
 * defaults bag — see `Glyph.applyOptions`), but that call now resolves to
 * the same value this class already defaults, so `Component.applyStyle`'s
 * render-time reconciliation (`reconcileRuleDeclaration`, since
 * `plans/implemented/reconciled-write-path-widening.md`) turns it into a
 * removal instead of a redundant per-instance declaration.
 */
class RadioButtonDot extends Glyph {
    constructor() {
        const size = radioDotSizePx();

        super("circle", undefined, {
            ..._defaultRadioButtonDotOptions,
            minSize: { width: size, height: size },
            maxSize: { width: size, height: size },
        });
    }
}

/**
 * Construction-time options for {@link RadioButton}.
 *
 * @category Components
 */
export interface RadioButtonOptions extends AbstractBooleanInputOptions {
    selected?:  boolean;
    value?:     boolean;
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

const _defaultRadioButtonOptions: Partial<RadioButtonOptions> = {
    outline: "none",
};

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
    extends AbstractBooleanInput<TOptions>
{
    private _ring:  RadioButtonRing;
    private _dot:   Glyph;

    /**
     * Constructs a RadioButton.
     *
     * @param text - Optional label text. Equivalent to `options.label`; kept
     *               positional for back-compat with consumers that wrote
     *               `new RadioButton("Hello")`.
     * @param options - Optional construction-time options bag.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(text?: string, options?: RadioButtonOptions, subclassDefaults?: Partial<RadioButtonOptions>);
    constructor(text?: string, options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(
            { ...(options ?? {}) } as TOptions,
            { ..._defaultRadioButtonOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
        );

        this.setLayoutManager(new HBox());

        const ringSize = radioRingSizePx();
        const dotSize  = radioDotSizePx();

        this._ring = new RadioButtonRing();
        // Min = preferred = max so the outer HBox shrink-on-overallocation
        // can't collapse the ring graphic when the radio is packed into a
        // tight container with siblings that have flexible widths. The
        // explicit setMinSize/setMaxSize calls (not just setSize) matter
        // here: `RadioButtonRing`'s own constructor-time minSize/maxSize
        // only ever materialises into `.RadioButtonRing`'s shared
        // class-level CSS rule, which is cached from whichever instance is
        // constructed first in the page's lifetime — a later instance built
        // after a `setTheme` raises `scale.base` would still render clamped
        // to that first-cached value without an explicit per-instance
        // override here, the same reason `_dot`'s size is re-asserted
        // imperatively below.
        this._ring.setSize({ width: ringSize, height: ringSize });
        this._ring.setMinSize({ width: ringSize, height: ringSize });
        this._ring.setMaxSize({ width: ringSize, height: ringSize });

        this._dot = new RadioButtonDot();
        this._dot.setPreferredSize({ width: dotSize, height: dotSize });
        this._dot.setMaxSize({ width: dotSize, height: dotSize });
        // Centres the dot inside `_ring`'s padding box — same formula as
        // `Checkbox.ts`'s `_check` offset. `ringSize` and `dotSize` come from the
        // same live theme snapshot, so this stays correct at any `scale.base`.
        const dotOffset = (ringSize - 2 * RADIO_RING_BORDER_PX - dotSize) / 2;
        this._dot.setX(dotOffset);
        this._dot.setY(dotOffset);
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

        // The ring owns the user-select click so the pointer/click + cursor
        // surface is exactly the visible ring graphic — clicks on a label or
        // in any stretched empty area pass through to the root, which has no
        // listener of its own. This pointer line stays per-subclass (a closure
        // over the widget `this`) because a listener registered on the child
        // ring would otherwise bind `this` to the ring; only the keyboard path,
        // registered on the root, moves into the base.
        Event.addListener(this._ring, "click", () => this.activateFromPointer());
        this.installKeyboard();

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

        // Establishes the clean baseline for dirty-state tracking — see AbstractInput.markClean().
        this.markClean();
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
     * Activates the radio button from a click or key: radio buttons can only be
     * selected, never directly deselected by the user (the `ButtonGroup`
     * deselects siblings on change), so this selects and fires the DOM `change`
     * only on a real off→on transition. The enabled/read-only guard is applied
     * by the base before this runs.
     */
    protected activate(): void {
        if (!this.isSelected()) {
            this.setSelected(true);
            Event.fireEvent(this, "change");
        }
    }

    /**
     * Returns the inner ring graphic — the click + cursor surface.
     *
     * @returns The ring component.
     */
    protected getInteractiveSurface(): Component {
        return this._ring;
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
    on(event: "action",  listener: Event.Listener): this;
    on(event: "change",  listener: (value: boolean) => void): this;
    on(event: "binding", listener: () => void): this;
    on(event: "action" | "change" | "binding", listener: Function): this {
        if (event === "action") {
            Event.addListener(this, "change", listener as Event.Listener);

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
            Event.removeListener(this, "change", listener as Event.Listener);

            return this;
        }

        return super.off(event, listener);
    }

    /**
     * Updates the visual + ARIA state for the given selected flag.
     */
    private applySelected(selected: boolean): void {
        this.getAria().setChecked(selected);

        this._ring.applyState(selected);

        this._dot.setOpacity(selected ? 1 : 0);
    }

}

const RadioButtonCallable = callable(RadioButton);
type RadioButtonCallable<TOptions extends RadioButtonOptions = RadioButtonOptions> = RadioButton<TOptions>;
export {
    RadioButton         as _RadioButton,
    RadioButtonCallable as RadioButton
};
