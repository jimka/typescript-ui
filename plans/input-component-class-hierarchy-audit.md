# Input Component Class Hierarchy Audit — Implementation Plan

## Overview

The `component/input/` package currently ships eleven value-bearing controls — [`TextField`](../src/typescript/lib/component/input/TextField.ts), [`TextArea`](../src/typescript/lib/component/input/TextArea.ts), [`NumberSpinner`](../src/typescript/lib/component/input/NumberSpinner.ts), [`Checkbox`](../src/typescript/lib/component/input/Checkbox.ts), [`RadioButton`](../src/typescript/lib/component/input/RadioButton.ts), [`Toggle`](../src/typescript/lib/component/input/Toggle.ts), [`Slider`](../src/typescript/lib/component/input/Slider.ts), [`AutoCompleteField`](../src/typescript/lib/component/input/AutoCompleteField.ts), [`DateField`](../src/typescript/lib/component/input/DateField.ts), [`TimeField`](../src/typescript/lib/component/input/TimeField.ts), [`DateTimeField`](../src/typescript/lib/component/input/DateTimeField.ts), [`ComboBox`](../src/typescript/lib/component/input/ComboBox.ts) — plus [`ToggleButton`](../src/typescript/lib/component/button/ToggleButton.ts) in the button package. Only the `<input>`-backed `Input` → `TextInput` → {`TextField`, `TextArea`} chain shares a base today; every other control extends `Component` directly and reimplements the same recurring concepts.

The graph (communities 26 / 39 / 16 / 9 / 33 / 34 / 35 / 36 / 37) confirms what the source reading shows: `Checkbox`, `RadioButton`, `Toggle`, and `Slider` each carry a near-identical block of `_changeListeners` / `_bindingListeners` / `notifyChange` / `applyEnabled` / `applyReadOnly` / `isEnabled` / `setEnabled` / `isReadOnly` / `setReadOnly` plumbing — see [Checkbox.ts:313-355](../src/typescript/lib/component/input/Checkbox.ts#L313-L355), [RadioButton.ts:303-345](../src/typescript/lib/component/input/RadioButton.ts#L303-L345), [Toggle.ts:232-273](../src/typescript/lib/component/input/Toggle.ts#L232-L273), [Slider.ts:402-444](../src/typescript/lib/component/input/Slider.ts#L402-L444). The three picker fields (`DateField`, `TimeField`, `DateTimeField`) — communities 35 / 36 / 37 with mirrored 24-node fingerprints — are even more redundant: every one of them ships its own `PickerInput`, `PickerButton`, `ensurePickerButtonClassRule` IIFE, `_invalid` border flag with `setInvalid`, viewport-pointerdown dismissal, `onButtonClick` / `onButtonPointerDown` / `onKeyDown(ArrowDown/Escape)` / `onBlur` / `setDropdownAnimated` / `isDropdownAnimated`, plus a 24-px `doLayout` that pins the input left and the button right.

This plan does two things: it introduces an abstract `AbstractInput` base under [component/input/](../src/typescript/lib/component/input/) consolidating the value/listener/enabled/readOnly surface shared by the custom-drawn value controls, and it extracts an `AbstractPickerField` base for the date/time/datetime triplet. It also surveys the rest of the framework for similar duplication (dropdowns, button-likes, picker dropdowns) and explicitly rejects most of the extra bases — the recommendation is *narrow* extraction along the two real seams, not a sweep.

---

## Architecture Decisions

### Extract `AbstractInput<T>` — value + enabled + readOnly + change/binding listeners

A single abstract class collects the surface that genuinely repeats verbatim across `Checkbox`, `RadioButton`, `Toggle`, `Slider`, and (with minor renaming) `NumberSpinner` / `TextField`. The shape:

- `_changeListeners: Array<(value: T) => void>` and `_bindingListeners: Array<() => void>`, with `addChangeListener` / `removeChangeListener` / `addBindingListener` / `notifyChange(value)` written once.
- `isEnabled()` / `setEnabled(value)` reading from `_options.enabled` (`?? true`) and dispatching `applyEnabled(value)` — an abstract protected hook the subclass overrides for its own visual + ARIA wiring.
- `isReadOnly()` / `setReadOnly(value)` reading from `_options.readOnly` (`?? false`) and dispatching `applyReadOnly(value)` — same abstract pattern.
- Abstract `getValue(): T` and `setValue(value: T): this` (implements `Bindable<T>` automatically). Subclasses still own value normalisation, the silent vs. firing distinction, and any `Event.fireEvent(this, "input"|"click")` back-compat synthesis.

Picked because every one of the rejected alternatives loses information. A single mixin instead of an abstract base buys nothing — every consumer of the mixin would still need the same `protected applyEnabled` hook, and TypeScript abstract methods document the contract more clearly. Pulling value caching into the base was considered and rejected: `Checkbox` caches as `_options.selected`, `Slider` and `NumberSpinner` cache as `_options.value`, the picker fields keep a private `_value: Date | null` outside the options bag. Forcing a single field name would require touching the options-bag shape of every subclass; leaving each subclass to own its storage costs one abstract `getValue` per class and zero churn elsewhere.

### Extract `AbstractPickerField` — date/time/datetime field shell

[`DateField`](../src/typescript/lib/component/input/DateField.ts), [`TimeField`](../src/typescript/lib/component/input/TimeField.ts), and [`DateTimeField`](../src/typescript/lib/component/input/DateTimeField.ts) are 96% identical. The redundancy is structural — same `PickerInput` subclass declared in each file at [DateField.ts:27-44](../src/typescript/lib/component/input/DateField.ts#L27-L44), [TimeField.ts:38-55](../src/typescript/lib/component/input/TimeField.ts#L38-L55), [DateTimeField.ts:38-55](../src/typescript/lib/component/input/DateTimeField.ts#L38-L55); same `PickerButton` subclass and module-level `PickerButton` class-rule IIFE in all three; same `_invalid` flag + `setInvalid` border swap; same viewport-pointerdown dismissal pattern; same `ArrowDown` / `Escape` keyboard contract; same `doLayout` with the magic 24-px button width.

The base owns the chrome and the lifecycle; subclasses own value parsing/formatting and the dropdown type. Concretely:

- `AbstractPickerField<TDropdown extends AnimatedDropdown, TValue>` extends `Component`.
- Owns the (now single) `PickerInput` and `PickerButton` declarations — moved into a new sibling file `PickerInput.ts` so each subclass imports the shared class rather than redeclaring it.
- Owns `_input`, `_button`, `_invalid`, `_value: TValue | null`, `_onViewportPointerDown`, and the `_dropdown` slot. The dropdown's concrete type is the `TDropdown` generic parameter; subclasses construct it through an abstract `protected createDropdown(): TDropdown` hook.
- Owns `setInvalid` / `onButtonClick` / `onButtonPointerDown` / `onViewportPointerDown` / `onKeyDown` / `onBlur` / `openDropdown` / `closeDropdown` / `setDropdownAnimated` / `isDropdownAnimated` verbatim.
- Owns the 24-px `doLayout`.
- Owns `updateHeight` and the `ThemeManager.onThemeChange` re-fire. The preferred width differs (160 / 140 / 200) — exposed as an abstract `protected getPreferredWidth(): number` so the height path stays shared.
- Subclasses provide `formatValue(v: TValue): string`, `parseRaw(raw: string): TValue | null`, the dropdown construction, and the dropdown's selection callback. Everything else moves up.

This is the highest-leverage extraction in the framework right now: three files of 491 / 518 / 502 lines collapse to a base of roughly 350 lines plus three thin subclasses of about 80 each.

### `AbstractPickerField` extends `AbstractInput<TValue | null>`

The earlier draft kept them parallel under `Component` with the argument that pickers used `addActionListener` rather than `addChangeListener` and forcing the inherited listener array would dead-code it. That argument is the same one that kept TextField/TextArea out of AbstractInput — and we already overturned it for the text chain on the same grounds. The pickers' `addActionListener(callback)` fires on the inner input's `input` event; semantically it's exactly the AbstractInput `addChangeListener` contract ("notify when the picker's value commits"). Renaming `addActionListener` → `addChangeListener` and wiring it via `notifyChange(this.getValue())` is the natural shape — and unifies all form inputs under one base.

The user's traversal goal (walk the component tree, find every form input, extract values, post to backend) requires a single base class. `instanceof AbstractInput` becomes the universal check. Parallel `AbstractInput` and `AbstractPickerField` bases under `Component` would force traversal code to do `instanceof AbstractInput || instanceof AbstractPickerField` — fragmenting the abstraction.

**Signature shift:** today's picker `addActionListener(listener: Function)` calls `Event.addListener(this._input, "input", listener)` — the callback receives the raw DOM event. After the rename, `addChangeListener(listener: (value: TValue | null) => void)` calls `notifyChange(this.getValue())` via the same DOM event, and the callback receives the parsed value. This is a breaking change for picker callers (callback signature), accepted per the no-shim policy. The migration steps below include grepping demo files for `addActionListener` calls on picker fields and updating them.

**`addBindingListener` symmetry:** today the picker's `addBindingListener(fn)` is the one-liner `this.addActionListener(fn)`. After the migration, both `addBindingListener` and `addChangeListener` come from AbstractInput, fire from the same `notifyChange` dispatch, and the picker's local one-liner forwarder is deleted.

### Merge `Input` into `TextInput`; `TextInput` extends `AbstractInput<string>`

`Input` has exactly one subclass today (`TextInput`), and `TextArea` already inherits from `TextInput` despite using `<textarea>` (not `<input>`) — so the "Input wraps the native `<input>` element" semantics is already fuzzy. The CODE_CONVENTIONS *no abstractions for single-use code* rule applies. The two-class split is folded into one: `Input.ts` is **deleted**; `TextInput.ts` absorbs Input's type/name/`<input>`-render surface and gains AbstractInput's value/enabled/readOnly/listener surface in the same edit.

The resulting chain: `Component ← AbstractInput<string> ← TextInput ← {TextField, TextArea}`. TextArea continues to override `render()` to create `<textarea>`; TextInput keeps the `<input>`-by-default `render()`. The unified TextInput owns:
- Type/name attributes (was Input)
- Placeholder, maxLength, inputMode, textAlign, autoComplete, select, getBaseline (was TextInput)
- `applyEnabled(value)` — writes the native `disabled` attribute
- `applyReadOnly(value)` — writes the native `readonly` attribute via `setElementAttribute("readonly", value ? "" : null)`
- `getValue()` / `setValue(value)` — aliased to `getText()` / `setText(value)`
- `notifyChange(this.getValue())` call inside the existing `input` event handler — wires `addChangeListener` on every text-derived control

The two objections that previously kept TextField/TextArea out of `AbstractInput` both shrink under scrutiny — the `setReadOnly` "split" isn't real (the native write IS the `applyReadOnly` body), and the "dead-code listener array" is ~32 bytes per instance, and even that isn't dead once `notifyChange` is wired. External consumers can now write `function configureInput(input: AbstractInput<unknown>) { input.setEnabled(false); ... }` and have it apply uniformly to every value-bearing control.

The merge has one risk to flag: if a future native-input subclass appears (e.g. a hypothetical native-`<input type="number">` `NumberInput` separate from the current custom-drawn `NumberSpinner`), it would have to either extend `TextInput` (inheriting text-specific concerns it doesn't need) or extend `AbstractInput<string>` directly (reimplementing the type/name/`<input>` element rendering). This is a deliberate trade — the simplicity win today is judged worth the cost of restoring a split if/when that future arrives.

### `AutoCompleteField` extends `AbstractInput<string>`, delegating to its inner `TextField`

`AutoCompleteField` composes a `TextField` child rather than being a self-contained `<input>`-backed control. Today it `extends Component`, exposes its own `setValue`/`getValue`/`addBindingListener` (forwarding to the TextField), and adds `addSelectListener` for suggestion-pick events. The earlier draft kept it under `Component` for that reason.

But it IS a form-input field for the consumer: it has a value, it can be enabled/readonly, it appears in form layouts alongside TextField/Checkbox/etc. The traversal goal requires it to be findable via `instanceof AbstractInput`. Reparenting it to `extends AbstractInput<string>` is mostly a name-change at the type level — the existing forwarders (`setValue` → `_textField.setValue`, `getValue` → `_textField.getValue`, `addBindingListener` → forwarder) become AbstractInput overrides; the new `applyEnabled` / `applyReadOnly` hooks forward to `_textField.setEnabled` / `_textField.setReadOnly`. The TextField change-listener wiring from the previous decision flows through: `_textField.addChangeListener(value => this.notifyChange(value))` in AutoCompleteField's constructor makes AutoCompleteField's own `addChangeListener` work as expected.

`addSelectListener` survives unchanged — it's the suggestion-pick-specific hook, semantically distinct from "value changed via typing or selection." Both can fire (a suggestion-select fires `addSelectListener` AND, through the underlying value change, `addChangeListener`).

### Hook `TextInput`'s `input` event to `notifyChange` so `addChangeListener` works on text controls

The wiring is a single line in TextInput's existing `input` event handler:

```typescript
// TextInput input handler — additive line:
this.notifyChange(this.getValue());
```

This makes `addChangeListener(fn)` fire on every keystroke for `TextField` and `TextArea` — consistent with `Slider`'s drag-fire and `Checkbox`'s click-fire semantics ("fires when the user changes the value"). Bindings already fire on the same event today; `notifyChange` just opens the second dispatch path.

### `NumberSpinner` joins `AbstractInput`; the inner `TextField` stays a child

`NumberSpinner` already owns a `_changeListeners` + `_bindingListeners` pair ([NumberSpinner.ts:66-67](../src/typescript/lib/component/input/NumberSpinner.ts#L66-L67)) but skips the `applyEnabled`/`applyReadOnly` decomposition (its `setEnabled` writes through to `_input.setDisabledAttribute` and `_upBtn.setPointerEvents` inline at [NumberSpinner.ts:299-315](../src/typescript/lib/component/input/NumberSpinner.ts#L299-L315)). Promoting to `AbstractInput` collapses the listener bookkeeping and asks `NumberSpinner` to implement `applyEnabled(value)` as the existing body — net code reduction, no behaviour change.

### `ComboBox` joins `AbstractInput` partially

`ComboBox` already implements `Bindable<string>` and exposes its own change-listener wiring through the dropdown-select round-trip. Folding the listener machinery in is straightforward; the dropdown's open/close shape is closer to `AbstractPickerField`'s but not a perfect match (the input surface is a `<div>` with a label/caret rather than an `<input>` + chrome button). The plan promotes `ComboBox` under `AbstractInput` for the listener/enabled/readOnly surface only — the dropdown lifecycle stays as it is today.

### Rejected: shared base for `AnimatedDropdown` subclasses

The four picker dropdowns ([`DatePickerDropdown`](../src/typescript/lib/component/input/DatePickerDropdown.ts), [`TimePickerDropdown`](../src/typescript/lib/component/input/TimePickerDropdown.ts), [`DateTimePickerDropdown`](../src/typescript/lib/component/input/DateTimePickerDropdown.ts), [`ComboBoxDropdown`](../src/typescript/lib/component/input/ComboBox.ts#L77-L192)) already share a base — [`AnimatedDropdown`](../src/typescript/lib/core/AnimatedDropdown.ts) handles the fade lifecycle, the dismissing-flag guard, the `position: fixed` chrome. Each subclass implements its own `showAt(anchorEl, value)` because the anchor-rect computations and the panel contents diverge: the date picker is a 7-column day grid, the time picker is two `TimePickerCell` columns, the date-time picker glues both, the combo-box is a vertical row list. The contents — not the lifecycle — drive the divergence, and `AnimatedDropdown` already owns the lifecycle. Inserting an intermediate `AbstractPickerDropdown` between `AnimatedDropdown` and these four would add a layer with nothing to put in it.

### Rejected: shared base for the button family

The graph splits `Button` (community 13, 47 nodes), `ToggleButton` (community 9), `MenuBarButton` (community 56, 10 nodes), `MenuItem` (community 50, 12 nodes), and `TabCloseButton` (community 0) into five different clusters precisely because their similarity is shallow. `Button` already exposes the hover/pressed state rules and the glyph/text composition; `ToggleButton` extends it and adds one `.selected` state rule plus a `change` event; `MenuBarButton` and `TabCloseButton` extend `Button` directly today; `MenuItem` is a flex-row composite that doesn't extend `Button` because it owns its own arrow-key navigation and accelerator slot. The two genuinely shared concerns — `setEnabled` and `aria-pressed` — already live in `Button` and `Aria` respectively. There is no reusable middle layer here.

### Rejected: lift `_value` and value-listener wiring into `Component`

Considered briefly because `getValue`/`setValue` reappear so often. Rejected: not every `Component` has a value (a `Panel`, `Header`, `Label`, `Tab`, `Spacer` doesn't), and forcing the abstraction up loses the property's documentation value. The split at `AbstractInput` keeps the value contract where it makes sense and out of where it doesn't.

### `PickerInput` and `PickerButton` move to dedicated files

Today each of the three picker fields declares its own `PickerInput` class and its own `PickerButton` class, with three identical bodies. The `.PickerButton` class rule registration is even guarded with a comment about idempotent re-registration *because* it runs three times at module load. The plan: extract both classes into `src/typescript/lib/component/input/PickerInput.ts` and `src/typescript/lib/component/input/PickerButton.ts` (or a single combined helper file), exported privately to the `input/` subpath. The IIFE for the `.PickerButton` class rule moves with them, runs once.

Both new files own one DOM element apiece — ARCHITECTURE.md §_One DOM element per class_ is satisfied by construction.

### One-element-per-class for `AbstractInput` and `AbstractPickerField`

`AbstractInput` is abstract and never instantiated — it doesn't *own* a DOM element directly; the concrete subclass's DOM element is the one. ARCHITECTURE.md §_One DOM element per class_ asks every concrete class to own one element; an abstract base contributes nothing to instantiation, so the rule is satisfied trivially. Same reasoning for `AbstractPickerField`. (See `Text` / `Component` for the parallel pattern — `Component` is the abstract-ish root, instances exist only via concrete subclasses or `new Component()` for a generic block.)

### No backwards-compat shims; subclasses change in lockstep

Per the task brief. Every consumer of `setEnabled` / `setReadOnly` / `addChangeListener` / `getValue` etc. on the affected components stays unchanged because the migrated API surface is identical — the methods move into the base but keep the same signatures. The subclasses' public surface is unchanged across the refactor; only their internal implementation routes through the base.

---

## Public API (TypeScript Signatures)

### `AbstractInput<TValue, TOptions>` (new)

```typescript
// src/typescript/lib/component/input/AbstractInput.ts

import { Component, ComponentOptions } from "~/core/Component.js";
import { Bindable } from "~/core/Bindable.js";

export interface AbstractInputOptions extends ComponentOptions {
    enabled?:  boolean;
    readOnly?: boolean;
}

abstract class AbstractInput<TValue, TOptions extends AbstractInputOptions = AbstractInputOptions>
    extends Component<TOptions>
    implements Bindable<TValue>
{
    protected _changeListeners:  Array<(value: TValue) => void> = [];
    protected _bindingListeners: Array<() => void>              = [];

    abstract getValue(): TValue;
    abstract setValue(value: TValue): this;

    isEnabled(): boolean;
    setEnabled(value: boolean): this;

    isReadOnly(): boolean;
    setReadOnly(value: boolean): this;

    addChangeListener(fn: (value: TValue) => void): this;
    removeChangeListener(fn: (value: TValue) => void): this;
    addBindingListener(fn: () => void): this;

    protected notifyChange(value: TValue): void;

    /** Subclass hook: reflect enabled state in ARIA / visuals. */
    protected abstract applyEnabled(value: boolean): void;

    /** Subclass hook: reflect read-only state in ARIA / visuals. */
    protected abstract applyReadOnly(value: boolean): void;

    protected applyOptions(options: TOptions): this;
}

// Not callable-wrapped — abstract bases are never instantiated; callable()
// is required only for concrete `Component` subclasses (ARCHITECTURE.md §
// _Components are exported through callable()_).
export { AbstractInput };
```

`applyOptions` writes `_options.enabled` / `_options.readOnly` when supplied; subclasses are expected to dispatch `applyEnabled` / `applyReadOnly` at the end of their constructor once their children exist (the same pattern they already use). The base does not auto-dispatch from `applyOptions` because the late-built children pattern means the abstract `applyX` hooks would no-op in the cascade.

### `AbstractPickerField<TValue, TDropdown>` (new)

```typescript
// src/typescript/lib/component/input/AbstractPickerField.ts

import { AbstractInput, AbstractInputOptions } from "~/component/input/AbstractInput.js";
import { AnimatedDropdown } from "~/core/AnimatedDropdown.js";
import { PickerInput } from "~/component/input/PickerInput.js";
import { PickerButton } from "~/component/input/PickerButton.js";

export interface AbstractPickerFieldOptions extends AbstractInputOptions {
    /** When false, the dropdown opens/closes instantly. Default: true. */
    dropdownAnimated?: boolean;
}

abstract class AbstractPickerField<
    TValue,
    TDropdown extends AnimatedDropdown,
    TOptions extends AbstractPickerFieldOptions = AbstractPickerFieldOptions
>
    extends AbstractInput<TValue | null, TOptions>
{
    protected _input:    PickerInput;
    protected _button:   PickerButton;
    protected _dropdown: TDropdown | null = null;
    protected _value:    TValue | null = null;
    protected _invalid:  boolean = false;

    protected readonly _onViewportPointerDown: (e: PointerEvent) => void;

    constructor(options?: TOptions);

    // Inherited from AbstractInput<TValue | null>:
    //   getValue / setValue / addChangeListener / removeChangeListener /
    //   addBindingListener / isEnabled / setEnabled / isReadOnly / setReadOnly

    setDropdownAnimated(value: boolean): this;
    isDropdownAnimated(): boolean;

    /** Subclass: format a value for display. */
    protected abstract formatValue(value: TValue): string;

    /** Subclass: parse the typed text. Return null on parse failure. */
    protected abstract parseRaw(raw: string): TValue | null;

    /** Subclass: lazily construct the picker dropdown. Runs once. */
    protected abstract createDropdown(): TDropdown;

    /** Subclass: callback for when the dropdown picks a value. */
    protected abstract onDropdownSelected(value: TValue): void;

    /** Subclass: preferred width (DateField 160, TimeField 140, DateTimeField 200). */
    protected abstract getPreferredWidth(): number;

    /** Subclass: the default border to restore when invalid clears. */
    protected abstract getDefaultBorder(): BorderOptions;

    /** Owned: 24-px button-on-the-right layout. */
    doLayout(): this;

    /** Owned: dropdown lifecycle. */
    private openDropdown(): void;
    private closeDropdown(): void;
    private ensureDropdown(): TDropdown;

    /** Owned: input/button/viewport listeners. */
    private onInput(): void;
    private onBlur(): void;
    private onKeyDown(e: KeyboardEvent): void;
    private onButtonClick(): void;
    private onButtonPointerDown(e: PointerEvent): void;
    private onViewportPointerDown(e: PointerEvent): void;

    /** Owned: invalid-state border swap. */
    private setInvalid(invalid: boolean): void;
}

export { AbstractPickerField };
```

`onInput` calls `this.parseRaw(raw)`; null → `setInvalid(true)`; non-null → cache + clear invalid. `ensureDropdown` calls `createDropdown()` once, then forwards the cached `dropdownAnimated` option via `setAnimated`.

### `PickerInput` / `PickerButton` (new, extracted)

```typescript
// src/typescript/lib/component/input/PickerInput.ts

import { TextInput, TextInputOptions } from "~/component/input/TextInput.js";
import { Event } from "~/core/Event.js";

class PickerInput extends TextInput<TextInputOptions> {
    constructor();
    private syncTextFromDom(): void;
}

const PickerInputCallable = callable(PickerInput);
type PickerInputCallable = PickerInput;
export {
    PickerInput         as _PickerInput,
    PickerInputCallable as PickerInput,
};
```

```typescript
// src/typescript/lib/component/input/PickerButton.ts

import { Component } from "~/core/Component.js";

class PickerButton extends Component {
    constructor();
}

const PickerButtonCallable = callable(PickerButton);
type PickerButtonCallable = PickerButton;
export {
    PickerButton         as _PickerButton,
    PickerButtonCallable as PickerButton,
};

// Single module-level `.PickerButton` class rule registration (was triple-registered before).
```

### Subclass changes — signatures preserved

```typescript
// Slider
class Slider<TOptions extends SliderOptions = SliderOptions>
    extends AbstractInput<number, TOptions>            // was Component<TOptions>
{
    // delete: _changeListeners, _bindingListeners
    // delete: addChangeListener, removeChangeListener, addBindingListener, notifyChange
    // delete: isEnabled, setEnabled, isReadOnly, setReadOnly
    // keep:   getValue, setValue
    // refactor: applyEnabled / applyReadOnly → protected (no body change)
}

// Checkbox
class Checkbox<TOptions extends CheckboxOptions = CheckboxOptions>
    extends AbstractInput<boolean, TOptions>           // was Component<TOptions>
{
    // same deletions as Slider
}

// RadioButton — same shape as Checkbox; getValue returns boolean (alias of isSelected)
class RadioButton<TOptions extends RadioButtonOptions = RadioButtonOptions>
    extends AbstractInput<boolean, TOptions>           // was Component<TOptions>
{ /* … */ }

// Toggle — same
class Toggle<TOptions extends ToggleOptions = ToggleOptions>
    extends AbstractInput<boolean, TOptions>           // was Component<TOptions>
{ /* … */ }

// NumberSpinner — same; applyEnabled body becomes the existing setEnabled body
class NumberSpinner extends AbstractInput<number, NumberSpinnerOptions> { /* … */ }

// ComboBox — same listener wiring; dropdown lifecycle untouched
class ComboBox<TOptions extends ComboBoxOptions = ComboBoxOptions>
    extends AbstractInput<string, TOptions>            // was Component<TOptions>
{ /* … */ }

// DateField
class DateField
    extends AbstractPickerField<Date, DatePickerDropdown, DateFieldOptions>
{
    protected formatValue(d: Date): string;            // moved from `formatDate`
    protected parseRaw(raw: string): Date | null;      // YYYY-MM-DD
    protected createDropdown(): DatePickerDropdown;
    protected onDropdownSelected(d: Date): void;
    protected getPreferredWidth(): number { return 160; }
    protected getDefaultBorder(): BorderOptions { return _defaultDateFieldOptions.border!; }
}

// TimeField — same shape; parseRaw handles "HH:MM[:SS]"; _showSeconds stays
class TimeField
    extends AbstractPickerField<Date, TimePickerDropdown, TimeFieldOptions>
{ /* … */ }

// DateTimeField — same shape
class DateTimeField
    extends AbstractPickerField<Date, DateTimePickerDropdown, DateTimeFieldOptions>
{ /* … */ }
```

---

## Proposed Class Hierarchy

```
Component
├── AbstractInput<T>             [NEW]  (abstract; implements Bindable<T>)
│   ├── TextInput                       (absorbs Input; was Component)
│   │   ├── TextField                   (existing — now via TextInput)
│   │   ├── TextArea                    (existing — now via TextInput)
│   │   └── PickerInput          [NEW LOCATION — extracted, single declaration]
│   ├── Checkbox                        (was Component)
│   ├── RadioButton                     (was Component)
│   ├── Toggle                          (was Component)
│   ├── Slider                          (was Component)
│   ├── NumberSpinner                   (was Component)
│   ├── ComboBox                        (was Component)
│   ├── AutoCompleteField               (was Component — wraps a TextField child)
│   └── AbstractPickerField<TValue, TDropdown>
│                                  [NEW]  (abstract; under AbstractInput<TValue|null>)
│       ├── DateField                   (was Component)
│       ├── TimeField                   (was Component)
│       └── DateTimeField               (was Component)
├── PickerButton                  [NEW LOCATION — extracted, single declaration]
├── AnimatedDropdown                    (existing — picker dropdown base)
│   ├── DatePickerDropdown              (existing — unchanged)
│   ├── TimePickerDropdown              (existing — unchanged)
│   ├── DateTimePickerDropdown          (existing — unchanged)
│   ├── AutoCompleteDropdown            (existing — unchanged)
│   └── ComboBoxDropdown                (existing — unchanged)
└── Button                              (existing — Button family unchanged)
    ├── ToggleButton                    (existing — see Non-Goals)
    ├── TabCloseButton                  (existing)
    └── MenuBarButton                   (existing)
```

After the migration, **every form-input control reachable through the component tree satisfies `instanceof AbstractInput`** — that's the invariant the traversal-and-extract-to-backend use case relies on.

`Input.ts` is **deleted** as part of this plan; its content moves into `TextInput.ts`. `AbstractPickerField` extends `AbstractInput<TValue | null>` (was: parallel to it). Everything below `AbstractInput` is a value-bearing form field.

---

## Ordered Implementation Steps

1. **Add `AbstractInput<T, TOptions>`.** New file `src/typescript/lib/component/input/AbstractInput.ts` with signatures above. Constructor body is a thin pass-through to `super(options)`; `applyOptions` writes `_options.enabled` / `_options.readOnly`. Verify: `npm run typecheck` — expect zero errors (the base has no consumers yet).
2. **Add `PickerInput.ts` + `PickerButton.ts`.** Extract verbatim from `DateField.ts:27-86`. Run the `.PickerButton` class-rule IIFE inside `PickerButton.ts` only. Wrap both with `callable()` per ARCHITECTURE.md §_Components are exported through `callable()`_. Verify: typecheck.
3. **Add `AbstractPickerField<TValue, TDropdown>`** extending `AbstractInput<TValue | null>`. New file `src/typescript/lib/component/input/AbstractPickerField.ts`. Body is the merged superset of `DateField` / `TimeField` / `DateTimeField`, with subclass-specific bits replaced by abstract calls. Constructor wires the same listener block (`Event.addListener(this._input, "input"|"blur"|"keydown", …)`, `Event.addListener(this._button, "click"|"pointerdown", …)`) — listeners reference named methods per ARCHITECTURE.md §_Listeners must reference a named function_. Implement `protected applyEnabled(value)` / `applyReadOnly(value)` by forwarding to `this._input.setEnabled(value)` / `this._input.setReadOnly(value)`. The internal `onInput` handler (typed text) and `onDropdownSelected` (dropdown pick) both call `this.notifyChange(this.getValue())` so the inherited `addChangeListener` fires on both paths. **No `addActionListener` method** — that name moves to `addChangeListener` per the architecture decision.
4. **Merge `Input` into `TextInput`; `TextInput` extends `AbstractInput<string>`.** Move Input's content (`type`, `name`, `applyOptions` for those, `<input>` render) into TextInput.ts. Change TextInput's class header from `extends Input<TOptions>` to `extends AbstractInput<string, TOptions>`. Implement `protected applyEnabled(value: boolean)` by writing the native `disabled` attribute (the body of the old `Input.setDisabledAttribute`). Implement `protected applyReadOnly(value: boolean)` via `setElementAttribute("readonly", value ? "" : null)` (per the `setElementAttribute` migration in [plans/layout-system-overhaul.md](layout-system-overhaul.md)) — replaces the existing TextInput `setReadOnly` body. Provide `getValue()` / `setValue(value)` as `this.getText()` / `this.setText(value)` aliases. Add a single line at the end of TextInput's existing `input` DOM event handler: `this.notifyChange(this.getValue())` — wires `addChangeListener` on text controls. Delete the explicit local `setReadOnly` ([TextInput.ts:307-317](../src/typescript/lib/component/input/TextInput.ts#L307-L317)); the inherited `AbstractInput.setReadOnly` dispatches to `applyReadOnly`. **Delete `src/typescript/lib/component/input/Input.ts`** and update every importer (`grep -rln "from \"~/component/input/Input\"\|from '~/component/input/Input'"`); they import `TextInput` instead. Verify: `npm run typecheck` clean; TextField/TextArea demos render and accept input unchanged; `addChangeListener` on a TextField fires on keystroke; `ls src/typescript/lib/component/input/Input.ts` → No such file.
5. **Verify `TextField` and `TextArea` compile and behave unchanged.** No edits expected — both already use `setValue`/`getValue`/`addBindingListener`, and they inherit the new methods via the chain. Verify: typecheck clean; existing TextField/TextArea binding demos still fire on keystroke.
6. **Migrate `Checkbox`.** Change `extends Component<TOptions>` → `extends AbstractInput<boolean, TOptions>`. Delete `_changeListeners` / `_bindingListeners` / `addChangeListener` / `removeChangeListener` / `addBindingListener` / `notifyChange` / `isEnabled` / `setEnabled` / `isReadOnly` / `setReadOnly`. Mark `applyEnabled` / `applyReadOnly` `protected` (currently private). `getValue` / `setValue` keep their existing bodies (`isSelected` / `setSelected` aliases). Verify: `grep -rn 'new Checkbox\|Checkbox(' src/typescript/lib/demo` — every demo still compiles.
7. **Migrate `RadioButton`.** Same shape as `Checkbox`. Verify.
8. **Migrate `Toggle`.** Same shape. Verify.
9. **Migrate `Slider`.** Same shape. Verify.
10. **Migrate `NumberSpinner`.** Same shape, plus split the existing `setEnabled` body into a `setEnabled` that writes `_options.enabled` and dispatches `applyEnabled`, with `applyEnabled` holding the existing enable/disable + opacity wiring. Verify.
11. **Migrate `ComboBox`.** Same listener consolidation. Dropdown lifecycle unchanged. Verify.
12. **Migrate `AutoCompleteField` to `extends AbstractInput<string>`.** Change `extends Component<TOptions>` → `extends AbstractInput<string, TOptions>`. Delete local `_bindingListeners` / `addBindingListener` / `setValue` / `getValue` declarations — inherit from base. The existing forwarders to the inner TextField become overrides:
    ```typescript
    getValue(): string { return this._textField.getValue(); }
    setValue(value: string): this { this._textField.setValue(value); return this; }
    protected applyEnabled(value: boolean): void { this._textField.setEnabled(value); }
    protected applyReadOnly(value: boolean): void { this._textField.setReadOnly(value); }
    ```
    Wire change-listener forwarding in the constructor (after `_textField` exists): `this._textField.addChangeListener(value => this.notifyChange(value));`. Keep `addSelectListener` unchanged. Verify: typecheck clean; AutoCompleteField demo still selects suggestions and binds; an `addChangeListener` attached to an AutoCompleteField fires when typing OR selecting.
13. **Migrate `DateField`.** Change `extends Component<DateFieldOptions>` → `extends AbstractPickerField<Date, DatePickerDropdown, DateFieldOptions>`. Delete the inlined `PickerInput` / `PickerButton` / `.PickerButton` IIFE / `_input` / `_button` / `_dropdown` / `_value` / `_invalid` / `_onViewportPointerDown` / `updateHeight` / `doLayout` / `onButtonClick` / `onButtonPointerDown` / `onViewportPointerDown` / `onInput` / `onBlur` / `onKeyDown` / `setInvalid` / `openDropdown` / `closeDropdown` / `ensureDropdown` / `setDropdownAnimated` / `isDropdownAnimated` / `addActionListener` / `addBindingListener` — all of these move to the base. Keep `formatDate` (rename to `formatValue`), the `YYYY-MM-DD` parse logic (move into `parseRaw`), `createDropdown` (build a `DatePickerDropdown`), `onDropdownSelected` (the existing `onDateSelected` body), `getPreferredWidth` returning 160, `getDefaultBorder` returning `_defaultDateFieldOptions.border`. Verify: open the date demo screen; type a date; pick from the dropdown; ensure both still commit.
14. **Migrate `TimeField`.** Same shape. `parseRaw` parses `"HH:MM[:SS]"`. `formatValue` returns the H:M or H:M:S string. `_showSeconds` stays on the subclass (passed to the dropdown via `createDropdown`).
15. **Migrate `DateTimeField`.** Same shape.
16. **Delete the duplicated `PickerInput` / `PickerButton` / IIFE blocks** from the three field files. Run `grep -rn '\bclass PickerInput\b' src/typescript` — expect one hit, in `PickerInput.ts`.
17. **Rename picker `addActionListener` call sites at consumers to `addChangeListener`.** Run `grep -rn '\.addActionListener(' src/typescript --include='*.ts' | grep -v lib/component/button` to enumerate non-button callers; the matches that operate on a `DateField` / `TimeField` / `DateTimeField` instance rename to `addChangeListener` AND the callback signature updates from `(event) => ...` to `(value) => ...`. (Button-family `addActionListener` is untouched — that's the click hook, semantically distinct.) Verify: typecheck clean; no `addActionListener` calls on picker instances remain.
18. **Run the full type-check, demo smoke, and `npm run docs:build`.** All three must pass before commit.

Each step lands as its own commit per the `commit` skill's one-functionality rule. Step 4 is the text-chain consolidation (Input.ts deletion); step 5 verifies TextField/TextArea inherit correctly. Steps 6–12 (one per `AbstractInput` migration of a custom-drawn or composed control) are independent and can be reordered freely. Steps 13–16 are sequential because they share the per-file delete pattern. Step 17 is a consumer-side rename forced by the picker's listener API change.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/input/AbstractInput.ts` |
| Create | `src/typescript/lib/component/input/AbstractPickerField.ts` |
| Create | `src/typescript/lib/component/input/PickerInput.ts` |
| Create | `src/typescript/lib/component/input/PickerButton.ts` |
| Modify | `src/typescript/lib/component/input/TextInput.ts` (absorbs Input.ts content: type/name/`<input>` render; extends `AbstractInput<string>`; implements `applyEnabled` / `applyReadOnly` via native attributes; adds `getValue` / `setValue` text aliases; deletes local `setReadOnly`; adds `notifyChange(this.getValue())` in `input` event handler) |
| Delete | `src/typescript/lib/component/input/Input.ts` (content absorbed into TextInput) |
| Modify | `src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `src/typescript/lib/component/input/RadioButton.ts` |
| Modify | `src/typescript/lib/component/input/Toggle.ts` |
| Modify | `src/typescript/lib/component/input/Slider.ts` |
| Modify | `src/typescript/lib/component/input/NumberSpinner.ts` |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `src/typescript/lib/component/input/AutoCompleteField.ts` (reparent to `AbstractInput<string>`; delete local bindings forwarder; add `applyEnabled` / `applyReadOnly` delegating to inner TextField; wire `_textField.addChangeListener → notifyChange`) |
| Modify | `src/typescript/lib/component/input/DateField.ts` |
| Modify | `src/typescript/lib/component/input/TimeField.ts` |
| Modify | `src/typescript/lib/component/input/DateTimeField.ts` |
| Modify | Consumer call sites: every `*.addActionListener(...)` invoked on a `DateField` / `TimeField` / `DateTimeField` instance — renamed to `addChangeListener` with `(value) =>` callback signature (audit via `grep -rn '\.addActionListener('`; button-family callers stay untouched). |
| Modify | `src/typescript/lib/component/input/index.ts` (export `AbstractInput` + `AbstractInputOptions` + `AbstractPickerField` + `AbstractPickerFieldOptions` + `PickerInput` + `PickerButton`; drop the `Input` re-export). |

---

## Verification

- `npm run typecheck` — zero errors after every step.
- `grep -rn '\bclass PickerInput\b' src/typescript` — exactly one hit.
- `grep -rn '\bclass PickerButton\b' src/typescript` — exactly one hit.
- `grep -rn "createClassRule(\"PickerButton\")" src/typescript` — exactly one hit (`PickerButton.ts`).
- `grep -rn "_changeListeners" src/typescript/lib/component/input` — only `AbstractInput.ts`; subclass copies removed.
- `grep -rn "applyEnabled\|applyReadOnly" src/typescript/lib/component/input` — every subclass overrides both; no other definitions.
- Demo smoke (`npm run dev`, http://localhost:8015) — Checkbox / RadioButton / Toggle / Slider / NumberSpinner / ComboBox / DateField / TimeField / DateTimeField demos work identically; enabled and read-only toggles still propagate; binding round-trips still fire.
- `npm run docs:build` — zero errors, zero link warnings (typedoc "unsupported TypeScript version" notice is the only acceptable warning).
- `graphify update .` — refresh communities. Expect `AbstractInput` to surface as a new bridge node spanning communities 20 (TextInput) / 26 (Checkbox) / 39 (Toggle) / 16 (Slider) / 9 (RadioButton) / 34 (NumberSpinner) / 14 (ComboBox) / 33 (AutoCompleteField) / 35 / 36 / 37 (the three picker fields via AbstractPickerField). Community 20's `Input` node disappears (file deleted).
- Manual smoke: attach an `addChangeListener` to a `TextField`, a `TextArea`, an `AutoCompleteField`, and a `DateField`; type/select in each; listener fires with the current value on every commit path. Confirms the unified `notifyChange` wiring across all four classes.
- **Form-traversal invariant check.** Write a tiny throwaway demo or one-liner: walk the demo screen's component tree, collect every component where `instanceof AbstractInput`, and list them. Must include — across the MiscPanel demos — every TextField, TextArea, Checkbox, RadioButton, Toggle, Slider, NumberSpinner, ComboBox, AutoCompleteField, DateField, TimeField, DateTimeField. ToggleButton must NOT appear (it stays under Button per the Non-Goal).
- `grep -rn '\.addActionListener(' src/typescript --include='*.ts'` — every remaining hit operates on a `Button` family instance, never on a picker field. Confirms step 17 ran to completion.
- `ls src/typescript/lib/component/input/Input.ts` → **No such file**.

---

## Documentation Impact

- Re-export `AbstractInput` and `AbstractPickerField` from `src/typescript/lib/component/input/index.ts` with `@category Components`. The `typedoc-callable-plugin` does not need to touch them — they're abstract bases, not callable-wrapped, so they land naturally in `docs/api/component/input/classes/AbstractInput` and `…/AbstractPickerField`.
- `PickerInput` and `PickerButton` are wrapped with `callable()` and exported; they land in the same barrel and pages.
- Curated pages under `docs/component/input/` (one per concrete control) keep their existing per-class examples — those still work because the public surface is unchanged. Add a short paragraph to the parent `docs/component/input/index.md` catalog page explaining the new abstract bases and which controls inherit from them.
- Cross-bucket JSDoc references inside the new bases (e.g. `{@link Bindable}`) live in the same `core` bucket as their target, but link to siblings — keep `{@link X}` for same-bucket targets, use markdown links per [`docs-conventions.md`](.claude/skills/_shared/docs-conventions.md) for cross-bucket pointers.
- **`TextField`, `TextArea`, and `AutoCompleteField` gain `addChangeListener` / `removeChangeListener` as new public methods** via the AbstractInput parent. All three are documented on AbstractInput; typedoc picks them up on the subclass pages via inheritance — no per-page edits required. The TextField/TextArea/AutoCompleteField catalog entries gain a one-liner note that change listeners now fire on every value commit (keystroke for text controls; keystroke or suggestion-pick for AutoCompleteField).
- **`DateField`, `TimeField`, `DateTimeField` swap `addActionListener` for `addChangeListener`.** The picker doc pages (curated, if any) and the inherited typedoc page note the rename and the callback signature change (`(event) => …` → `(value) => …`).
- **`Input` is removed as a public symbol.** The `src/typescript/lib/component/input/index.ts` barrel drops the `Input` export. Grep `docs/` for stale `Input` references; expect typedoc to regenerate without it.
- No renames or removals — existing subclass surfaces are preserved.

---

## Potential Challenges

- **Cascade-time `setEnabled` / `setReadOnly` calls.** `AbstractInput`'s `setEnabled` / `setReadOnly` dispatch the abstract `applyEnabled` / `applyReadOnly`. Several subclasses (Checkbox, Toggle, RadioButton) currently construct their children after `super()` returns and dispatch `applyEnabled` themselves from the constructor body to dodge the children-don't-exist-yet race ([Checkbox.ts:130-136](../src/typescript/lib/component/input/Checkbox.ts#L130-L136)). The refactor must preserve that — `AbstractInput.applyOptions` writes `_options.enabled` / `_options.readOnly` but does **not** dispatch the setter; the subclass's existing constructor-tail `applyEnabled` calls keep working. Mitigation: documented in the `applyOptions` JSDoc on the base.
- **`Bindable<T>` for void-returning `setValue` vs. `this`-returning.** The Bindable interface declares `setValue(value: T): void`; `AbstractInput.setValue` returns `this` for chaining. TypeScript accepts a more specific return type than the interface requires, so the subclass `setValue(...): this` still satisfies the interface (`this` is assignable to `void` at the return position). Already confirmed by `TextField` ([TextField.ts:90](../src/typescript/lib/component/input/TextField.ts#L90)) which returns `this`. Mitigation: none needed.
- **`AbstractPickerField` value type erasure.** The base holds `_value: TValue | null`, but the subclasses store specifically `Date | null`. Generic instantiation locks the type — `AbstractPickerField<Date, DatePickerDropdown>` → `_value: Date | null` at the subclass site. Mitigation: confirmed by reading existing subclass-of-generic patterns ([Slider.ts:48-51](../src/typescript/lib/component/input/Slider.ts#L48-L51), `Component<TOptions>` cascading).
- **`AbstractPickerField` dropdown re-anchoring at theme change.** Today only the field height re-fires on theme change ([DateField.ts:152](../src/typescript/lib/component/input/DateField.ts#L152)); the dropdown closes if open. The base must preserve that exact behaviour. Mitigation: copy the `ThemeManager.onThemeChange(() => this.updateHeight())` call verbatim into the base constructor.
- **Demos passing `addActionListener` to picker fields.** All three picker fields wire `addActionListener` to `this._input` ([DateField.ts:397-401](../src/typescript/lib/component/input/DateField.ts#L397-L401)). The base implements `addActionListener` once with that wiring. Verify by grepping demo files for `DateField` / `TimeField` / `DateTimeField` usages and checking that the `input` event arrives on the inner `PickerInput`, not the outer field. Mitigation: covered by step 17 demo smoke.
- **`TextField` and `TextArea` gain a new public `addChangeListener` API.** Before the migration, neither exposed `addChangeListener`. After, both inherit it from `AbstractInput<string>`, and (via step 5) fire it on every keystroke. This is additive — no existing caller breaks — but external consumers will see the new method in autocomplete and docs. Mitigation: documentation impact section flags this as a new public surface; the typedoc page for `TextField` automatically picks it up via inheritance.
- **`TextInput.applyEnabled` / `applyReadOnly` and the cascade-time race.** TextInput creates the `<input>` element in `render()`, which runs after the AbstractInput chain. Subclasses (TextField, TextArea) defer their child wiring similarly. The `apply*` hooks must be safe to call when the inner element exists OR not — same defensive pattern the existing `setReadOnly`/`setDisabledAttribute` already uses (cache state, write to element if present). Mitigation: re-read the existing `setDisabledAttribute`/`setReadOnly` bodies — the cache-then-write pattern is already there; `applyEnabled`/`applyReadOnly` just adopt them.
- **Picker `addActionListener` → `addChangeListener` is a breaking signature change.** Callers pass a callback receiving the raw DOM event today; after the rename, the callback receives the parsed value. Step 17 enumerates and updates every demo/consumer site; the typecheck catches any miss because the callback parameter types differ. Mitigation: the audit grep in step 17 plus the typecheck. Document this change in the typedoc for the picker classes (typedoc picks up the inherited `addChangeListener` signature from AbstractInput automatically).
- **`Input.ts` deletion fan-out.** Every importer of `~/component/input/Input` needs to switch to `~/component/input/TextInput`. Most already import TextInput too (its parent), so the change is dropping one import name. Audit via `grep -rln "from \"~/component/input/Input\"\|from '~/component/input/Input'" src/typescript`. Mitigation: typecheck catches every miss because `Input` no longer exists as an exported symbol.

---

## Critical Files

- [src/typescript/lib/component/input/Checkbox.ts](../src/typescript/lib/component/input/Checkbox.ts), [Toggle.ts](../src/typescript/lib/component/input/Toggle.ts), [RadioButton.ts](../src/typescript/lib/component/input/RadioButton.ts), [Slider.ts](../src/typescript/lib/component/input/Slider.ts) — the canonical-shape sources for `AbstractInput`.
- [src/typescript/lib/component/input/Input.ts](../src/typescript/lib/component/input/Input.ts), [TextInput.ts](../src/typescript/lib/component/input/TextInput.ts) — the text chain. Input.ts is **deleted**; TextInput absorbs its content (type/name/`<input>` render) and gains the `AbstractInput<string>` parent + `applyEnabled` / `applyReadOnly` + `notifyChange` wiring.
- [src/typescript/lib/component/input/AutoCompleteField.ts](../src/typescript/lib/component/input/AutoCompleteField.ts) — composite control; reparents to `AbstractInput<string>` with delegation to the inner TextField.
- [src/typescript/lib/component/input/DateField.ts](../src/typescript/lib/component/input/DateField.ts), [TimeField.ts](../src/typescript/lib/component/input/TimeField.ts), [DateTimeField.ts](../src/typescript/lib/component/input/DateTimeField.ts) — the three sources to deduplicate into `AbstractPickerField`.
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — the abstract-base pattern, options-bag conventions, `applyOptions` cascade order.
- [src/typescript/lib/core/Bindable.ts](../src/typescript/lib/core/Bindable.ts) — `Bindable<T>` interface; `AbstractInput` must satisfy it.
- [src/typescript/lib/core/AnimatedDropdown.ts](../src/typescript/lib/core/AnimatedDropdown.ts) — the dropdown base; `AbstractPickerField`'s `TDropdown` extends from here.
- [ARCHITECTURE.md](../ARCHITECTURE.md) — one-element-per-class, typed-setter, listener-by-name rules; all preserved by the design.
- [plans/implemented/options-bag-state-refactor.md](implemented/options-bag-state-refactor.md) — establishes the `_options`-as-state pattern that the new bases inherit.
- [plans/implemented/extract-accordion-header-indicator.md](implemented/extract-accordion-header-indicator.md) — the canonical "extract a subclass" plan to mimic for tone.

---

## Non-Goals

- **No change to `AnimatedDropdown` subclasses.** Their divergence is in panel contents, not lifecycle. Inserting a `AbstractPickerDropdown` between would have no shared body.
- **No change to the button family.** `Button` is already the right base; `ToggleButton` / `MenuBarButton` / `TabCloseButton` already extend it.
- **No further restructuring of the text chain.** `TextField` and `TextArea` keep their existing `TextInput` parent. `Input` is the only level being collapsed — its sole subclass (TextInput) absorbs it, the chain below TextInput stays as it is today.
- **No promotion of `ToggleButton` to `AbstractInput`.** ToggleButton's primary semantics are click-driven (Button family); its toggled state is secondary. Forcing it under AbstractInput would either split the Button family or duplicate inheritance through a mixin. Keep it under Button; downstream code that wants to include ToggleButton in form-data extraction does so by an explicit additional check rather than relying on `instanceof AbstractInput`.
- **No value-storage uniformity across `AbstractInput` subclasses.** Each subclass keeps its own `_options.value` / `_options.selected` / `_value` choice; only the listener and enabled/readOnly surface lifts up.
- **No `Bindable` lift onto every `Component`.** Most Components have no value.
