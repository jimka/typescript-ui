---
depends-on: [shared-clamp-timer-size-sentinel-utils]
---

# Input Field Fixes & Scaffolding Consolidation — Implementation Plan

## Overview

Two bug fixes and a scaffolding-consolidation pass over `src/typescript/lib/component/input/`. The bugs are (1) `on("change")` / binding consumers on `TextField` / `TextArea` receive the value **one keystroke behind** because the base change fan-out is wired *before* the subclass DOM-sync listener and reads the cached `_options.text` instead of the live DOM ([TextInput.ts:117](src/typescript/lib/component/input/TextInput.ts#L117), [TextInput.ts:445](src/typescript/lib/component/input/TextInput.ts#L445), [TextField.ts:46](src/typescript/lib/component/input/TextField.ts#L46), [TextArea.ts:63](src/typescript/lib/component/input/TextArea.ts#L63)); and (2) `Label.forId` is a public mutable field that bypasses its own typed setter — assigning it never updates the `for` attribute ([Label.ts:36](src/typescript/lib/component/input/Label.ts#L36), [Label.ts:64](src/typescript/lib/component/input/Label.ts#L64)).

The consolidation removes duplicated scaffolding: the copy-pasted DOM-value-sync hook (which also *is* the root cause of bug 1) collapses into the `TextInput` base; `Checkbox` / `RadioButton` / `Toggle` grow a shared `AbstractBooleanInput` base for label management, enabled/read-only ARIA, and keyboard activation; the three picker fields shed identical `showDropdown` / `getDefaultBorder` / default-options / enabled-readonly constructor tails into `AbstractPickerField`; the triplicated `:focus-within::after` focus-ring `StyleRule` becomes one helper; the six single-line-box `updateHeight` idioms route through the shared single-line-height helper introduced by `shared-clamp-timer-size-sentinel-utils`; and a batch of genuinely-dead code is removed.

Scope is confined to `src/typescript/lib/component/input/` plus the `Label` change. No public renames, no `isSelected` / `setSelected` / `getValue` naming changes, and no `NumberSpinner` / `SpinButton` auto-repeat or sentinel work (all owned by sibling plans).

---

## Architecture Decisions

### Bug 1 — sync the cache from the DOM *inside* the base `input` listener

`AbstractInput.notifyChange` fires `change` / `binding` with whatever `getValue()` returns ([AbstractInput.ts:200](src/typescript/lib/component/input/AbstractInput.ts#L200)); for `TextInput`, `getValue()` → `getText()` → `_options.text` ([TextInput.ts:445](src/typescript/lib/component/input/TextInput.ts#L445)). The base wires `Event.addListener(this, "input", () => this.notifyChange(this.getValue()))` in its own constructor ([TextInput.ts:117](src/typescript/lib/component/input/TextInput.ts#L117)); each subclass then wires a *second* `input` listener that syncs `_options.text` from the DOM ([TextField.ts:46](src/typescript/lib/component/input/TextField.ts#L46) → [TextField.ts:86](src/typescript/lib/component/input/TextField.ts#L86), [TextArea.ts:63](src/typescript/lib/component/input/TextArea.ts#L63) → [TextArea.ts:255](src/typescript/lib/component/input/TextArea.ts#L255)). Listeners fire in registration order, so the base (stale-read) listener runs *before* the subclass (sync) listener. Fix: fold both responsibilities into a single base listener — **sync from the DOM, then notify** — and delete the subclass sync hooks. This resolves bug 1 and consolidation item 6 at once.

As a bonus this also fixes a latent variant: `PasswordField` never wired a sync hook at all ([PasswordField.ts](src/typescript/lib/component/input/PasswordField.ts) has no `onInput`), so its `getText()` cache is currently never updated from typed input; the unified base listener now syncs it.

### Bug 2 — `Label.forId` becomes `private _forId`, `setForId` the sole mutator

Per the typed-setter rule (ARCHITECTURE.md, *All attributes and styles go through typed setters*), the `for` attribute must only ever be written by `setForId`. Rename the public field to `private _forId`, route `getForId` / `setForId` / `render` / the constructor through it. `forId` is a required positional constructor argument, not a consumer-configurable option, so it stays **off** `LabelOptions` (adding it there is out of scope). Verified no external reader touches `Label.forId` as a field — `IconLabel`'s `_options.forId` ([IconLabel.ts:86](src/typescript/lib/component/display/IconLabel.ts#L86)) is an unrelated own-options field.

### `AbstractBooleanInput` — shared base for Checkbox / RadioButton / Toggle

All three extend `AbstractInput<boolean>`, host an inner graphic (`_box` / `_ring` / `_track`) plus an optional `_label: Text`, and duplicate: `applyLabel` (mount/replace/remove a pointer-events-none `Text`) — byte-identical at [Checkbox.ts:440](src/typescript/lib/component/input/Checkbox.ts#L440), [RadioButton.ts:393](src/typescript/lib/component/input/RadioButton.ts#L393), [Toggle.ts:315](src/typescript/lib/component/input/Toggle.ts#L315); `getLabel` / `setLabel`; `applyReadOnly` (`aria.setReadOnly`) — identical at [Checkbox.ts:471](src/typescript/lib/component/input/Checkbox.ts#L471), [RadioButton.ts:424](src/typescript/lib/component/input/RadioButton.ts#L424), [Toggle.ts:346](src/typescript/lib/component/input/Toggle.ts#L346); `applyEnabled` (aria disabled + tabindex + inner-graphic cursor) — differs only in *which* graphic gets the cursor ([Checkbox.ts:462](src/typescript/lib/component/input/Checkbox.ts#L462), [RadioButton.ts:415](src/typescript/lib/component/input/RadioButton.ts#L415), [Toggle.ts:337](src/typescript/lib/component/input/Toggle.ts#L337)); the Space-key + guard interaction shape; and the label-baseline `getBaseline` (Checkbox / RadioButton identical at [Checkbox.ts:401](src/typescript/lib/component/input/Checkbox.ts#L401) / [RadioButton.ts:366](src/typescript/lib/component/input/RadioButton.ts#L366)).

Extract an abstract `AbstractBooleanInput<TOptions>` that owns: `_label` + `getLabel` / `setLabel` / `applyLabel`; `applyReadOnly`; `applyEnabled` (calling an abstract `getInteractiveSurface()` for the cursor); a default `getBaseline()` (label-baseline-or-text-baseline); the `keydown` activation wiring (on `this`, a named method); and the enabled/read-only guard. Subclasses provide only `getInteractiveSurface()`, an abstract `activate()` (Checkbox: indeterminate→select-or-toggle; RadioButton: select-only + fire `change`; Toggle: flip), an overridable `activationKeys()` (default `[" "]`, Toggle → `[" ", "Enter"]`), and — for `Toggle` — a `getBaseline()` override for its pill offset ([Toggle.ts:238](src/typescript/lib/component/input/Toggle.ts#L238)).

**`isSelected` / `setSelected` / `getValue` / `setValue` naming is untouched** (owned by `api-naming-harmonization`); only the mechanics move. The value semantics, indeterminate handling, `ButtonGroup` `change` firing, and synthetic-`click` behaviour stay in the subclasses.

**Pointer-click wiring stays a one-line-per-subclass closure.** `Event` invokes a listener with the *target* component as `this` ([Event.ts:116](src/typescript/lib/core/Event.ts#L116), [Event.ts:164](src/typescript/lib/core/Event.ts#L164)). The click listener is registered on the inner graphic (so only the visible 16×16 / pill surface is the hit + cursor area — a deliberate design documented in the existing comments, e.g. [Checkbox.ts:196](src/typescript/lib/component/input/Checkbox.ts#L196)), which means a base method reference would bind `this` to the *child graphic*, not the widget. The three widgets already wire this with a closure over the parent `this`; that single line stays in each subclass (calling a base guarded `activateFromPointer()`), because moving it into the base is impossible without either the wrong `this` or re-scoping the hit area (a behaviour change). Only the keyboard path — registered on `this` — moves into the base as a named method.

### `AbstractPickerField` absorbs the picker-field boilerplate

`showDropdown` is byte-identical (`dropdown.showAt(anchorEl, value)`) across [DateField.ts:156](src/typescript/lib/component/input/DateField.ts#L156), [TimeField.ts:175](src/typescript/lib/component/input/TimeField.ts#L175), [DateTimeField.ts:185](src/typescript/lib/component/input/DateTimeField.ts#L185). All three dropdowns expose `showAt(anchorEl: Handle, selected: Date | null): this` ([AbstractCalendarDropdown.ts:627](src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L627), [TimePickerDropdown.ts:102](src/typescript/lib/component/input/TimePickerDropdown.ts#L102)), and every concrete `TValue` here is `Date`. Constrain the generic bound to `TDropdown extends AnimatedDropdown & { showAt(anchorEl: Handle, value: TValue | null): this }`, delete the abstract `showDropdown` + its three overrides, and call `dropdown.showAt(...)` directly in `openDropdown` ([AbstractPickerField.ts:490](src/typescript/lib/component/input/AbstractPickerField.ts#L490)).

The three `_defaultXxxFieldOptions` bags are byte-identical ([DateField.ts:30](src/typescript/lib/component/input/DateField.ts#L30), [TimeField.ts:28](src/typescript/lib/component/input/TimeField.ts#L28), [DateTimeField.ts:32](src/typescript/lib/component/input/DateTimeField.ts#L32)); hoist one `_defaultPickerFieldOptions` into `AbstractPickerField`, merge it inside the base constructor, and make `getDefaultBorder()` concrete (returning the shared `border` token) — dropping the abstract hook and its three overrides ([DateField.ts:186](src/typescript/lib/component/input/DateField.ts#L186), [TimeField.ts:213](src/typescript/lib/component/input/TimeField.ts#L213), [DateTimeField.ts:213](src/typescript/lib/component/input/DateTimeField.ts#L213)). The `subclassDefaults` constructor parameter is then unused by all three subclasses and is removed from the base signature.

Because `AbstractPickerField` builds `_input` in its *own* constructor ([AbstractPickerField.ts:98](src/typescript/lib/component/input/AbstractPickerField.ts#L98)), the enabled/read-only re-dispatch tail copy-pasted into each subclass ([DateField.ts:73](src/typescript/lib/component/input/DateField.ts#L73), [TimeField.ts:79](src/typescript/lib/component/input/TimeField.ts#L79), [DateTimeField.ts:81](src/typescript/lib/component/input/DateTimeField.ts#L81)) moves into the base constructor (dispatched right after `_input` exists). The `value` re-dispatch stays per-subclass (it reads the subclass-typed `_options.value`), and `_showSeconds` handling stays in Time / DateTime — see the next decision.

### `_showSeconds` is *not* hoisted onto `AbstractPickerField`

`_showSeconds` is duplicated between `TimeField` ([TimeField.ts:57](src/typescript/lib/component/input/TimeField.ts#L57)) and `DateTimeField` ([DateTimeField.ts:59](src/typescript/lib/component/input/DateTimeField.ts#L59)) but absent from `DateField`. Hoisting the *option* onto `AbstractPickerFieldOptions` would leak a no-op `showSeconds` onto `DateField`'s public options; introducing an intermediate `AbstractTimePickerField` base for two subclasses relocates more than it removes (ARCHITECTURE.md, *Compose before specializing* — run the count). The lowest-cost move is to hoist only the `protected _showSeconds: boolean = false` **field declaration** onto `AbstractPickerField` (harmless-and-unused on `DateField`), leaving the `showSeconds` option, its `applyOptions` cache, and the constructor read local to Time / DateTime. This removes the duplicated field without widening any public surface. *(If even that pollution is unwanted, leave `_showSeconds` in both subclasses — flagged as the reviewer's call.)*

### Single-line-box height routes through the shared Util helper (dependency)

The `chrome = insets + padding + border; h = Util.lineHeightPx() + chrome` idiom is copy-pasted at [TextField.ts:61](src/typescript/lib/component/input/TextField.ts#L61), [PasswordField.ts:55](src/typescript/lib/component/input/PasswordField.ts#L55), [ComboBox.ts:741](src/typescript/lib/component/input/ComboBox.ts#L741), [AbstractPickerField.ts:251](src/typescript/lib/component/input/AbstractPickerField.ts#L251), and [NumberSpinner.ts:208](src/typescript/lib/component/input/NumberSpinner.ts#L208) (`TextArea` uses a fixed `preferredSize` and has no such method). This plan **consumes** the single-line-height helper that `shared-clamp-timer-size-sentinel-utils` lands alongside its clamp/sentinel size utilities — hence the `depends-on`. Each `updateHeight` replaces its four-line `chrome`/`h` computation with one call, e.g. `const h = Util.singleLineBoxHeight(this.getInsets(), <padding>, this.getBorderSize());`, then keeps its own per-class `setPreferredSize(width, h)` / `setMaxSize` and `ThemeManager.onThemeChange` subscription (the width differs per class, and `NumberSpinner` uniquely reads the *inner input's* padding, not its own — [NumberSpinner.ts:211](src/typescript/lib/component/input/NumberSpinner.ts#L211)). The exact helper name/signature must match what the dependency ships; adjust the call sites if it differs. **No `Util` code is authored by this plan** — it only calls the helper — so there is no `Util.ts` edit conflict with the dependency.

### One focus-ring helper for the three `:focus-within::after` rules

The `:focus-within::after` overlay `StyleRule` (content `''`, `inset:0`, 2px focus-indicator border, `borderRadius:inherit`, `boxSizing:border-box`, `pointerEvents:none`, `zIndex:1`) is triplicated at [AbstractPickerField.ts:23](src/typescript/lib/component/input/AbstractPickerField.ts#L23), [AutoCompleteField.ts:22](src/typescript/lib/component/input/AutoCompleteField.ts#L22), [NumberSpinner.ts:27](src/typescript/lib/component/input/NumberSpinner.ts#L27). Extract a module-level `registerFocusWithinRing(selector: string): void` into a new internal file `input/focusRing.ts` (not barrel-exported). Each site calls it with its selector (the pickers keep the combined `.DateField:…, .TimeField:…, .DateTimeField:…` selector as one argument). `NumberSpinner`'s *second* rule — the `.NumberSpinner .TextField:focus { box-shadow: none }` inner-shadow suppressor ([NumberSpinner.ts:43](src/typescript/lib/component/input/NumberSpinner.ts#L43)) — is unique and stays inline. `TextInput`'s `:focus` inset-box-shadow rule ([TextInput.ts:25](src/typescript/lib/component/input/TextInput.ts#L25)) is a *different* recipe (box-shadow, not a pseudo-element) and is out of scope.

### `AutoCompleteField` — route selection through the framework listener surface, don't unify the base

`AutoCompleteField` keeps a bespoke `_selectListeners` array + `addSelectListener` ([AutoCompleteField.ts:108](src/typescript/lib/component/input/AutoCompleteField.ts#L108), [AutoCompleteField.ts:380](src/typescript/lib/component/input/AutoCompleteField.ts#L380)) instead of the framework `on` / `off` / `emit` + `ListenerBag` surface (ARCHITECTURE.md, *Event handling*). Add a `"select"` custom event backed by a private `ListenerBag<"select">`, exposed through `on("select", fn)` / `off("select", fn)` and dispatched via `emit("select", value)` in `onSuggestionSelected` ([AutoCompleteField.ts:607](src/typescript/lib/component/input/AutoCompleteField.ts#L607)). Keep the public `addSelectListener(fn)` method as a thin forwarder to `on("select", fn)` — it is used by `MiscPanel.ts:1030` and documented, so *removing* it is an api-naming concern out of this plan's scope; re-backing it is not a rename.

A **shared composite-input base** merging `AutoCompleteField` and `AbstractPickerField` (root chrome + border-stripped inner input + `:focus-within` overlay + `doLayout` fill + blur-delayed dismissal + keydown→dropdown) is **rejected** here: the two differ materially (button column + invalid border + 24px layout vs. debounce + store querying + no button; `PickerInput` vs. `TextField` inner; different dropdown contracts), so a common base would relocate complexity across a seam rather than delete it (ARCHITECTURE.md, *Compose before specializing*). Listed under Non-Goals.

### Dead code — with two audit corrections

- `TextField.destructor()` ([TextField.ts:79](src/typescript/lib/component/input/TextField.ts#L79)) and `TextArea.destructor()` ([TextArea.ts:248](src/typescript/lib/component/input/TextArea.ts#L248)): **`destructor` IS a real framework lifecycle method** — defined `protected destructor()` on `Component` ([Component.ts:579](src/typescript/lib/core/Component.ts#L579)) and overridden by `Panel` ([Panel.ts:446](src/typescript/lib/core/Panel.ts#L446)), called from `Dialog`, `AbstractWindow`, `StatusBar`, `DialogBackdrop`. These two overrides are therefore not merely dead: they are no-op overrides whose body is a commented-out `Util.removeListener` (a non-existent function) and which **never call `super.destructor()`**, silently shadowing the base teardown for any `TextField` / `TextArea` that is disposed. **Remove both overrides** so the inherited `Component.destructor` runs — this both deletes the dead body and restores correct teardown.
- `AutoCompleteField.onFocus` ([AutoCompleteField.ts:466](src/typescript/lib/component/input/AutoCompleteField.ts#L466)) is an empty placeholder; remove it *and* its wiring `Event.addListener(this._textField, "focus", () => this.onFocus())` ([AutoCompleteField.ts:149](src/typescript/lib/component/input/AutoCompleteField.ts#L149)) (the change orphans the registration).
- `AutoCompleteFieldConfig` ([AutoCompleteField.ts:82](src/typescript/lib/component/input/AutoCompleteField.ts#L82)) — **do not remove.** It is a *deliberately-kept* deprecated alias: `docs/recipes/component-options.md:229` explicitly documents that the `*Config` aliases (`FieldConfig`, `AjaxProxyConfig`, `MemoryProxyConfig`, `AutoCompleteFieldConfig`) "are kept as deprecated aliases," it is re-exported from the barrel ([index.ts:45](src/typescript/lib/component/input/index.ts#L45)), and it has a docs page section. Removing this one inconsistently contradicts that policy; a coordinated alias-cleanup is out of scope. Flagged under Non-Goals.
- Add explicit `: void` return types to the surviving `onInput` (now the base `TextInput.onInput`) and remove the now-deleted per-subclass `onInput` / `destructor` methods.

---

## Public API

New abstract base (not `callable()`-wrapped, mirroring `AbstractInput` / `AbstractPickerField`):

```typescript
// input/AbstractBooleanInput.ts
export interface AbstractBooleanInputOptions extends AbstractInputOptions {
    label?: string | null;
}

abstract class AbstractBooleanInput<
    TOptions extends AbstractBooleanInputOptions = AbstractBooleanInputOptions
> extends AbstractInput<boolean, TOptions> {

    protected _label: Text | null;

    getLabel(): string | null;
    setLabel(text: string | null): this;

    getBaseline(): number | null;            // label-or-text baseline; Toggle overrides

    protected applyLabel(text: string | null): void;
    protected applyEnabled(value: boolean): void;   // aria + tabindex + getInteractiveSurface() cursor
    protected applyReadOnly(value: boolean): void;   // aria.setReadOnly

    protected installKeyboard(): void;       // keydown on `this` → guarded activate()
    protected activateFromPointer(): void;   // enabled/readOnly guard → activate()
    protected activationKeys(): string[];    // default [" "]; Toggle → [" ", "Enter"]

    protected abstract activate(): void;
    protected abstract getInteractiveSurface(): Component;
}
export { AbstractBooleanInput };
```

`Checkbox` / `RadioButton` / `Toggle` change their `extends AbstractInput<boolean, TOptions>` to `extends AbstractBooleanInput<TOptions>`; their `XOptions.label` moves onto (or continues to satisfy) `AbstractBooleanInputOptions.label`. Their public method surface (`isSelected` / `setSelected` / `getValue` / `setValue` / `isIndeterminate` / `setIndeterminate` / `setRadioName` / `on` / `off` / …) is unchanged.

`Label`:

```typescript
class Label extends Text<LabelOptions> {
    private _forId: string;               // was: public forId: string
    getForId(): string;                   // reads _forId
    setForId(id: string): this;           // sole mutator of _forId + `for` attr
}
```

`TextInput` (base) gains the unified input hook:

```typescript
protected onInput(): void;   // sync _options.text from live DOM, then notifyChange(getValue())
```
`TextField.onInput`, `TextArea.onInput`, `PickerInput.syncTextFromDom` are deleted; the subclass second `input` listeners are deleted.

`AbstractPickerField`:

```typescript
abstract class AbstractPickerField<
    TValue,
    TDropdown extends AnimatedDropdown & { showAt(anchorEl: Handle, value: TValue | null): this },
    TOptions extends AbstractPickerFieldOptions = AbstractPickerFieldOptions
> extends AbstractInput<TValue | null, TOptions> {
    protected _showSeconds: boolean;                 // hoisted field only
    constructor(options?: TOptions);                 // subclassDefaults param removed
    protected getDefaultBorder(): string;            // now concrete
    // abstract showDropdown REMOVED
}
```

`AutoCompleteField`:

```typescript
type AutoCompleteFieldEvent = "select";
on(event: "select",  listener: (value: string) => void): this;
on(event: "change",  listener: (value: string) => void): this;
on(event: "binding", listener: () => void): this;
off(event: "select" | "change" | "binding", listener: Function): this;
addSelectListener(fn: (value: string) => void): void;   // kept; forwards to on("select", fn)
```

---

## Internal Structure

Base `TextInput.onInput` (replaces the inline arrow at [TextInput.ts:117](src/typescript/lib/component/input/TextInput.ts#L117) and the subclass hooks):

```typescript
protected onInput(): void {
    const element = this.getElement();
    this.setText(element ? DOM.source.getValue(element) : "");
    this.notifyChange(this.getValue());
}
// constructor:
Event.addListener(this, "input", this.onInput);   // named method; Event applies with `this` = component
```

`AbstractBooleanInput` keyboard wiring (named method — registered on `this`, so `this` binds correctly):

```typescript
private handleActivationKey(e: KeyboardEvent): void {
    if (!this.activationKeys().includes(e.key)) {
        return;
    }

    e.preventDefault();

    if (this.isEnabled() && !this.isReadOnly()) {
        this.activate();
    }
}
protected installKeyboard(): void {
    Event.addListener(this, "keydown", this.handleActivationKey);
}
protected activateFromPointer(): void {
    if (this.isEnabled() && !this.isReadOnly()) {
        this.activate();
    }
}
```

Each subclass constructor, after building its graphic, wires the one binding-forced pointer line and the keyboard:

```typescript
Event.addListener(this.getInteractiveSurface(), "click", () => this.activateFromPointer());
this.installKeyboard();
```

`AbstractPickerField` constructor tail (after `_input` exists) picks up the hoisted enabled/read-only dispatch:

```typescript
if (this._options.enabled  !== undefined) this.applyEnabled(this._options.enabled);
if (this._options.readOnly !== undefined) this.applyReadOnly(this._options.readOnly);
```
Subclasses keep only their `_button.setGlyph(...)`, the `value` re-dispatch, and (Time/DateTime) the `_showSeconds` read + `value` re-dispatch.

---

## Ordered Implementation Steps

1. **Bug 1 + item 6 — `TextInput` base sync.** Add `protected onInput(): void` (sync-then-notify). Replace the constructor arrow listener with `Event.addListener(this, "input", this.onInput)`. Delete `TextField.onInput` + its `input` listener ([TextField.ts:46](src/typescript/lib/component/input/TextField.ts#L46)/[86](src/typescript/lib/component/input/TextField.ts#L86)), `TextArea.onInput` + its listener ([TextArea.ts:63](src/typescript/lib/component/input/TextArea.ts#L63)/[255](src/typescript/lib/component/input/TextArea.ts#L255)), and `PickerInput.syncTextFromDom` + its listener ([PickerInput.ts:39](src/typescript/lib/component/input/PickerInput.ts#L39)/[47](src/typescript/lib/component/input/PickerInput.ts#L47)). → verify: `grep -rn "syncTextFromDom\|onInput" src/typescript/lib/component/input/TextField.ts src/typescript/lib/component/input/TextArea.ts src/typescript/lib/component/input/PickerInput.ts` prints nothing.
2. **Item 9 — remove `destructor` overrides.** Delete `TextField.destructor` and `TextArea.destructor`. → verify: `grep -rn "destructor" src/typescript/lib/component/input/` prints nothing.
3. **Bug 2 — `Label._forId`.** Rename field to `private _forId`, update `getForId` / `setForId` / `render` / constructor. → verify: `grep -rn "this.forId\|forId:" src/typescript/lib/component/input/Label.ts` shows only `_forId`.
4. **Item 7 — focus-ring helper.** Create `input/focusRing.ts` exporting `registerFocusWithinRing(selector)`. Replace the three IIFE `StyleRule` blocks with helper calls in `AbstractPickerField`, `AutoCompleteField`, `NumberSpinner`; keep `NumberSpinner`'s inner-shadow suppressor inline. → verify: `grep -rn "focus-within::after" src/typescript/lib/component/input/` shows only `focusRing.ts`.
5. **Item 3 — `AbstractBooleanInput`.** Create the base with label mgmt, `applyEnabled` / `applyReadOnly`, default `getBaseline`, `installKeyboard` / `activateFromPointer` / `activationKeys`, and the two abstracts. Re-base `Checkbox`, `RadioButton`, `Toggle`: remove their `_label` field, `getLabel` / `setLabel` / `applyLabel`, `applyReadOnly`, the keyboard half of `installInteraction`, and (Checkbox/RadioButton) `getBaseline`; add `getInteractiveSurface()`, `activate()`, and (Toggle) `activationKeys()` + its `getBaseline` override; replace the constructor interaction block with the one pointer line + `installKeyboard()`. → verify: typecheck; `grep -rn "applyReadOnly" Checkbox.ts RadioButton.ts Toggle.ts` prints nothing.
6. **Item 5 — `AbstractPickerField` hoists.** Add the `showAt` intersection to the `TDropdown` bound; delete abstract `showDropdown` and call `dropdown.showAt(...)` in `openDropdown`. Add `_defaultPickerFieldOptions`, merge it in the base constructor, drop the `subclassDefaults` param, make `getDefaultBorder()` concrete. Add `protected _showSeconds` field to the base. Dispatch enabled/read-only in the base constructor tail. Delete from `DateField` / `TimeField` / `DateTimeField`: their `_defaultXxxFieldOptions`, `showDropdown`, `getDefaultBorder`, and the enabled/read-only constructor lines; keep `setGlyph`, `value` re-dispatch, and (Time/DateTime) `_showSeconds` read. → verify: `grep -rn "getDefaultBorder\|showDropdown\|_defaultDateFieldOptions" DateField.ts TimeField.ts DateTimeField.ts` prints nothing.
7. **Item 4 — single-line-box height.** Route the `updateHeight` bodies in `TextField`, `PasswordField`, `ComboBox`, `AbstractPickerField`, `NumberSpinner` through the dependency's `Util` single-line-height helper (passing `this._input.getPadding()` for `NumberSpinner`, `this.getPadding()` elsewhere); keep each `setPreferredSize` / `setMaxSize` / theme subscription. → verify: typecheck; `default-options-fallback` test still reports `TextField padding` `[3,3,3,3]`.
8. **Item 8 — `AutoCompleteField` listener routing + dead code.** Add the `"select"` `ListenerBag`, `on` / `off("select")` overloads, `emit("select", value)` in `onSuggestionSelected`; re-back `addSelectListener` onto `on("select")`; delete `_selectListeners`. Remove `onFocus` + its focus listener. → verify: `grep -rn "_selectListeners\|onFocus" AutoCompleteField.ts` prints nothing.
9. **Types.** Ensure every touched method carries an explicit return type (`: void` on the base `onInput`, etc.).
10. **Full sweep.** `npm run build:lib`, `npm test`, `npm run docs:build` (zero warnings).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/input/AbstractBooleanInput.ts` |
| Create | `src/typescript/lib/component/input/focusRing.ts` |
| Modify | `src/typescript/lib/component/input/TextInput.ts` (base `onInput`, listener) |
| Modify | `src/typescript/lib/component/input/TextField.ts` (delete `onInput`, `destructor`, listener; route `updateHeight`) |
| Modify | `src/typescript/lib/component/input/TextArea.ts` (delete `onInput`, `destructor`, listener) |
| Modify | `src/typescript/lib/component/input/PasswordField.ts` (route `updateHeight`) |
| Modify | `src/typescript/lib/component/input/PickerInput.ts` (delete `syncTextFromDom`, listener) |
| Modify | `src/typescript/lib/component/input/Label.ts` (`_forId` privatisation) |
| Modify | `src/typescript/lib/component/input/Checkbox.ts` (re-base) |
| Modify | `src/typescript/lib/component/input/RadioButton.ts` (re-base) |
| Modify | `src/typescript/lib/component/input/Toggle.ts` (re-base) |
| Modify | `src/typescript/lib/component/input/AbstractPickerField.ts` (bound, defaults, `getDefaultBorder`, `_showSeconds`, enabled/readonly tail, focus-ring helper, `updateHeight`) |
| Modify | `src/typescript/lib/component/input/DateField.ts` (shed boilerplate) |
| Modify | `src/typescript/lib/component/input/TimeField.ts` (shed boilerplate) |
| Modify | `src/typescript/lib/component/input/DateTimeField.ts` (shed boilerplate) |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` (route `updateHeight`) |
| Modify | `src/typescript/lib/component/input/NumberSpinner.ts` (focus-ring helper, `updateHeight`) |
| Modify | `src/typescript/lib/component/input/AutoCompleteField.ts` (listener routing, remove `onFocus`) |
| Modify | `src/typescript/lib/component/input/index.ts` (export `AbstractBooleanInput` + options type) |

---

## Expected Behaviour

### Offline-testable (Vitest + recording sink)

- **Item 6 wiring (bug 1 consolidation):** after `new TextField()` / `new TextArea()` / `new PasswordField()`, exactly **one** `addListener('input', …)` write is recorded (down from two) — assert via the `countWrites('addListener','input')` helper already in [TextInput.test.ts:24](tests/component/input/TextInput.test.ts#L24).
- **Bug 1 value freshness (direct hook call):** with the element mounted and the recording source returning a written value, set the DOM value via the sink, register `on("change", v => captured = v)`, call `(field as any).onInput()`, and assert `captured` equals the **new** DOM value and `field.getText()` matches — the same direct-`onInput()` pattern already used in [editor.test.ts:39](tests/component/table/cell/editor.test.ts#L39). (This exercises sync-before-notify; real event *delivery* is manual — see below.)
- **Bug 2 — `Label`:** `setForId("x")` on a mounted label writes `setAttr {for:"x"}`; `getForId()` returns the set value; direct field assignment is no longer possible (compile-time — the field is private).
- **`AbstractBooleanInput` label mgmt:** `setLabel("A")` mounts a `Text` child; `setLabel(null)` removes it; `getLabel()` round-trips; identical results across Checkbox / RadioButton / Toggle.
- **enabled/read-only ARIA:** `setEnabled(false)` writes `aria-disabled` + `tabindex="-1"` + the graphic cursor `default`; `setReadOnly(true)` writes `aria-readonly` — for all three widgets.
- **Picker consolidation parity:** `new DateField()` / `TimeField()` / `DateTimeField()` still report the same preferred size, default border (`getDefaultBorder()` value unchanged), and `getPadding()` `[3,3,3,3]`; `setValue(date)` still fills the inner text; invalid-parse still swaps the border. `default-options-fallback` unchanged.
- **`AutoCompleteField` selection:** `on("select", fn)` and `addSelectListener(fn)` both fire on `onSuggestionSelected`; `off("select", fn)` stops the first; `setValue` still fires `on("change")` via the inner-TextField bridge.
- **Focus-ring helper:** `registerFocusWithinRing(sel)` registers a `StyleRule` for `sel` with the expected style bag (assert the recorded rule).

### Manual-verify (live browser — DOM event delivery, focus/blur, geometry)

The recording sink does **not** deliver DOM events to listeners ([TextInput.test.ts:29](tests/component/input/TextInput.test.ts#L29)), and focus/blur/commit-on-blur is offline-untestable (per project memory on picker commit-on-blur). Verify live in the app (`npm run dev`, MiscPanel + input demos):

- **Bug 1:** type a character into a `TextField` / `TextArea` / `PasswordField` wired with `on("change", v => log(v))`; the logged value includes the just-typed character (not one keystroke behind).
- **Boolean widgets:** click the box/ring/pill and press Space (Toggle also Enter) — state flips, ARIA `checked` updates, `change` fires; clicks on the label or empty stretched space do **not** toggle; disabled/read-only suppress both paths.
- **Picker fields:** typing, ArrowDown/Escape, button click, invalid-then-blur clearing, and dropdown selection all behave as before; the `:focus-within` ring paints on input focus.
- **`AutoCompleteField`:** typeahead debounce, dropdown keyboard nav, blur-delayed dismissal, suggestion pick firing select + change; focus ring paints.
- **`destructor` removal:** dispose a mounted `TextField` / `TextArea` (e.g. remove it) and confirm the base teardown runs (handle released) — the `handle-registry` teardown path.

---

## Verification

- `npm run build:lib` (sqladmin and other consumers read the built `dist/lib`).
- `npm test` — existing `Checkbox` / `RadioButton` / `Toggle` / `TextArea` / `DateField` / `TimeField` / `DateTimeField` / `AutoCompleteField` / `TextInput` / `default-options-fallback` suites must stay green; add the offline cases above.
- `npm run docs:build` — zero warnings (touches `Label`, `AutoCompleteField` public JSDoc).
- Grep invariants: `grep -rn "destructor\|syncTextFromDom" src/typescript/lib/component/input/` → empty; `grep -rn "focus-within::after" src/typescript/lib/component/input/` → only `focusRing.ts`; `grep -rn "this.forId" src/typescript/lib/component/input/` → empty.
- Live smoke via `npm run dev` (app on `http://localhost:8015`) for every Manual-verify bullet; optionally drive with the Chrome DevTools MCP (scope queries by component class, and verify clickability with a real coordinate click, not a synthetic `dispatchEvent`).

---

## Documentation Impact

- `Label`: `forId` was public; it is now `private _forId` with `getForId` / `setForId`. TypeDoc dropped the field automatically (private); confirm `docs/` prose doesn't instruct assigning `label.forId = …` (`grep -rln "\.forId" docs/`).
- `AutoCompleteField`: new `on("select", fn)` / `off("select", fn)` surface. Update `docs/components/AutoCompleteField.md` to mention the framework `on("select")` form alongside the retained `addSelectListener`. Do **not** rewrite the `addSelectListener` examples (method retained).
- `AbstractBooleanInput` is exported from the input barrel; add it to the barrel and confirm it renders as an abstract class page (mirrors `AbstractPickerField`). Its JSDoc must not `{@link}` `private`/`protected` members (project CODE_CONVENTIONS.md rule).
- No renames/removals of documented symbols (`AutoCompleteFieldConfig` retained), so no old-name doc sweep.

---

## Potential Challenges

- **`Event` this-binding.** A listener registered on a *child* graphic is invoked with the child as `this` ([Event.ts:116](src/typescript/lib/core/Event.ts#L116)) — hence the pointer-click stays a per-subclass closure over the widget `this` while only the keyboard path (on `this`) becomes a base named method. Do not "clean up" the closure into a base method reference.
- **`super()`-cascade field trap.** `AbstractBooleanInput._label` is written by `applyLabel` called from the *subclass constructor body* (after `super()`), not by a cascade-dispatched setter, so a plain `= null` initializer is safe. The hoisted `AbstractPickerField._showSeconds` is likewise body-written. Keep both off any setter that `applyOptions` dispatches.
- **Dependency helper name.** Item 4 assumes `shared-clamp-timer-size-sentinel-utils` has landed a single-line-height `Util` helper; if its final name/signature differs, the five call sites must be adjusted. Land this plan *after* that one (the `depends-on` enforces the order).
- **`getDefaultBorder` value identity.** The concrete base version must return the exact same `var(--ts-ui-input-border)` token the three subclasses returned, or the invalid-border restore changes visually. It is identical across all three today.
- **Picker `TValue` bound.** The `showAt` intersection bound compiles only because every concrete dropdown declares `showAt(anchorEl, value: Date | null)` and every `TValue` is `Date`; a future non-`Date` picker must keep that `showAt` shape.

---

## Critical Files

- [AbstractInput.ts](src/typescript/lib/component/input/AbstractInput.ts) — the `notifyChange` / `emit` / `ListenerBag` surface every input builds on; the boolean base and AutoComplete select event sit on top of it.
- [TextInput.ts](src/typescript/lib/component/input/TextInput.ts) — base for the value-sync fix; note `setText`, `getText`, `getValue`, the `init()` replay path.
- [Component.ts:579](src/typescript/lib/core/Component.ts#L579) / [Panel.ts:446](src/typescript/lib/core/Panel.ts#L446) — the real `destructor` teardown chain the removed overrides were shadowing.
- [Event.ts:116](src/typescript/lib/core/Event.ts#L116) — listener invocation / `this` binding, which shapes the boolean interaction extraction.
- [ARCHITECTURE.md](ARCHITECTURE.md) — typed-setter, event-surface, compose-before-specialize, and DOM-seam rules governing every change here.
- [AbstractPickerField.ts](src/typescript/lib/component/input/AbstractPickerField.ts) and the three picker subclasses — the consolidation target.
- [tests/component/input/TextInput.test.ts](tests/component/input/TextInput.test.ts) and [tests/component/table/cell/editor.test.ts](tests/component/table/cell/editor.test.ts) — the offline patterns (listener-count, direct `onInput()` call) the new tests reuse.

---

## Non-Goals

- **No public renames** — `isSelected` / `setSelected` / `getValue` / `setValue`, `addSelectListener`, and every other documented method keep their names (api-naming-harmonization owns any rename).
- **No `AutoCompleteFieldConfig` removal** — it is a documented, intentionally-retained deprecated alias; removing it belongs to a coordinated alias cleanup.
- **No shared composite-input base** unifying `AutoCompleteField` and `AbstractPickerField` — the two are too dissimilar; unifying would relocate rather than remove complexity.
- **No `Util.clamp` / `AutoRepeat` / sentinel / single-line-height *authoring*** — those live in `shared-clamp-timer-size-sentinel-utils`; this plan only *consumes* the height helper.
- **No `NumberSpinner` / `SpinButton` auto-repeat or sentinel internals** touched — only its focus-ring rule and the `updateHeight` height computation change.
- **No cell-editor changes** — `DateEditor` / `TimeEditor` / `StringEditor` etc. reimplement a similar DOM-sync idiom but extend `CellEditor` (→ `Component`), a separate hierarchy outside this plan's scope.
- **No `showSeconds` option hoist** onto `AbstractPickerField` — only the `_showSeconds` field declaration moves; the option stays on Time / DateTime to avoid leaking a no-op onto `DateField`.
