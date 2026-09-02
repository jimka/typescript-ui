---
depends-on:
  - component-dirty-state
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
---

# AbstractInput Dirty-State Adoption — Implementation Plan

## Overview

`Component` already carries a generic dirty-state mechanism — `isDirty()`, a protected `setDirty(dirty)`, `onDirtyChange(listener)` / `offDirtyChange(listener)`, and an automatic parent-to-child relay wired in `wireChild` / `unwireChild` ([`core/Component.ts:2340-2395`](packages/lib/src/typescript/lib/core/Component.ts#L2340-L2395)) so any container's `isDirty()` folds in every descendant's. `CodeEditor` is its one real adopter today ([`plans/implemented/code-editor-dirty-state-adoption.md`](plans/implemented/code-editor-dirty-state-adoption.md), refined by [`plans/implemented/code-editor-undo-clears-dirty.md`](plans/implemented/code-editor-undo-clears-dirty.md)).

This plan gives [`AbstractInput`](packages/lib/src/typescript/lib/component/input/AbstractInput.ts) — the shared base of `TextField`, `Checkbox`, `ComboBox`, `NumberSpinner`, `DateField`, `DateTimeField`, `TimeField`, `Slider`, `FileField`, `FileDropZone`, `AutoCompleteField`, `AbstractPickerField`, and (through `AbstractSelectableList`) `List` and `MultiSelectList` — the same "differs from the value at the last clean point" rule `CodeEditor` uses, added once on the shared base so every one of those subclasses inherits it. `AbstractInput` already has exactly one choke point every subclass calls on a committed value change — `protected notifyChange(value: TValue): void` ([`AbstractInput.ts:201`](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L201)), which fires `"change"` then `"binding"`. The comparison logic goes there, so it fires for free at every one of the seventeen existing `notifyChange` call sites across the fourteen concrete subclasses, with no per-subclass change-handling code touched.

What is **not** free is the *baseline* — the value the comparison runs against. Investigation (below) found no single point in `AbstractInput`'s own constructor where a subclass's value is reliably known, so each concrete subclass calls a new public `markClean()` once, at the exact point in its own constructor where its initial value is settled — mirroring the constructor-tail dispatch pattern `AbstractInput` already uses for `applyEnabled` / `applyReadOnly` ([`AbstractInput.ts:285-296`](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L285-L296)). `markClean()` also resolves a second issue this investigation found: four subclasses (`AutoCompleteField`, `FileDropZone`, `NumberSpinner`, and the `AbstractPickerField` family) compose another `AbstractInput` internally, so `markClean()` recurses into composed children.

This plan also resolves the `Binding` interaction the task raised: `Binding.commit()` and `Binding.reject()` both now call `markClean()` on every bound `AbstractInput`, so a field driven through a `Binding` correctly reports `isDirty() === false` right after either operation. This makes [`core/Binding.ts`](packages/lib/src/typescript/lib/core/Binding.ts) and [`core/Bindable.ts`](packages/lib/src/typescript/lib/core/Bindable.ts) in-scope files, flagged here per the task's instruction rather than expanded silently.

---

## Architecture Decisions

### The comparison lives once, in `notifyChange`

`notifyChange(value: TValue)` computes `!this.valuesEqual(value, this._cleanValue)` and calls the inherited `setDirty(...)` before emitting `"change"` / `"binding"`, mirroring `CodeEditor.onDocChange`'s "dirty before emit" ordering[^dirty-before-change]. Every subclass's existing `notifyChange(...)` call site — TextInput's `onInput`, `Checkbox.setSelected`, `ComboBox`, `Slider`, `NumberSpinner`, `RadioButton`, `Toggle`, `FileField` (×3), `FileDropZone`, `AutoCompleteField`, `AbstractPickerField` (×2), `AbstractSelectableList.fireChange` — gets the comparison with no change-handling code touched anywhere.

### Equality is generic-by-default, overridden where reference equality is wrong

`AbstractInput` adds a protected, overridable hook:

```typescript
protected valuesEqual(a: TValue, b: TValue | undefined): boolean {
    return Object.is(a, b);
}
```

`Object.is` is correct for every scalar `TValue` in the codebase today — `string` (`TextInput`, `ComboBox`, `AutoCompleteField`, `List`), `boolean` (`Checkbox`, `RadioButton`, `Toggle`), `number` (`Slider`, `NumberSpinner`). Two subclasses override it because their `TValue` has no stable reference across "the same" value[^equality-investigation]:

- **`AbstractPickerField<TValue, TDropdown, TOptions>`** (`Date` in every concrete subclass — `DateField`, `TimeField`, `DateTimeField`) overrides with a runtime `instanceof Date` check comparing `.getTime()`, falling back to `Object.is` otherwise (kept generic rather than constraining `TValue extends Date`, since the override needs no type-level change to be correct).
- **`MultiSelectList`** (`TValue = string[]`) overrides with a length-and-per-index comparison. `MultiSelectList.getValue()` always returns keys sorted by row order ([`MultiSelectList.ts:127-131`](packages/lib/src/typescript/lib/component/list/MultiSelectList.ts#L127-L131)), so two calls returning the same selected set always produce the same array content in the same order — index-wise comparison is sound, no set semantics needed.

`FileField` / `FileDropZone` (`TValue = File[]`) get **no** override — see Non-Goals.

### The baseline has no free constructor-time capture point — every concrete subclass calls `markClean()`

`AbstractInput`'s own constructor cannot call `this.getValue()` to seed a baseline: `getValue()` is abstract, and for several subclasses the underlying storage doesn't exist yet at that point in the `super()` chain. Confirmed by reading, not assumed:

- `AbstractPickerField._value` is a field initialized to `null`; the real value is written by `DateField` / `TimeField` / `DateTimeField`'s own constructor, calling `this.setValue(this._options.value)` **after** `AbstractPickerField`'s (and so `AbstractInput`'s) constructor has already returned ([`AbstractPickerField.ts:85`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L85), [`DateField.ts:54-56`](packages/lib/src/typescript/lib/component/input/DateField.ts#L54-L56)).
- `AbstractSelectableList._selectedSet` is a field initialized by `AbstractSelectableList`'s own field initializer, which runs **after** `AbstractInput`'s constructor body — calling `this.getValue()` from `AbstractInput`'s constructor would read `_selectedSet` before it exists and throw (spreading `undefined`). `List` / `MultiSelectList` each populate the real selection from their own constructor tail ([`List.ts:44-54`](packages/lib/src/typescript/lib/component/list/List.ts#L44-L54), [`MultiSelectList.ts:53-55`](packages/lib/src/typescript/lib/component/list/MultiSelectList.ts#L53-L55)).
- `Checkbox` / `RadioButton` / `Slider` similarly finish applying their initial value from their own constructor tail, after visual children exist.

This rules out any "seed once in `AbstractInput`'s constructor" design — it would crash for `List` / `MultiSelectList` and silently capture the wrong value for the rest. The codebase already has a named precedent for "a value isn't ready until this subclass's own constructor tail": `AbstractInput.applyOptions`'s own JSDoc explains why `applyEnabled` / `applyReadOnly` are dispatched from each subclass's constructor tail rather than from `applyOptions` itself ([`AbstractInput.ts:285-291`](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L285-L291)). `markClean()` follows the same shape: every concretely-instantiable subclass calls `this.markClean()` once, as the last statement of its own constructor, after any composed children's initial display is set.

One family gets this for free: `TextField`, `TextArea`, `PasswordField`, `UsernameField`, and `PickerInput` all share `TextInput`, whose constructor has no deferred tail — `_options.text` is already correct by the time `TextInput`'s own constructor body runs (the `applyOptions` cascade that sets it completes during `Component`'s base constructor, before any subclass body runs). `TextInput`'s constructor calls `this.markClean()` once, covering all five leaves with a single edit.

### `markClean()` recurses into composed `AbstractInput` children

Four subclasses build another `AbstractInput` internally and add it as a real child via `addComponent`: `AutoCompleteField` → `_textField: TextField`, `FileDropZone` → `_field: FileField`, `NumberSpinner` → `_input: NumberSpinnerField extends TextField`, and `AbstractPickerField` → `_input: PickerInput extends TextInput`. Each inner field is itself an `AbstractInput`, so once `TextInput`'s constructor starts calling `markClean()`, every one of these inner fields gets its own baseline the moment it's constructed (typically the empty string). The outer wrapper then overwrites the inner field's *displayed* text (`NumberSpinner`'s `this._input.setText(this.formatValue(0))`, `AbstractPickerField.setValue`'s `this._input?.setText(...)`) without going through `notifyChange` — leaving the inner field's own `_cleanValue` stale and its displayed value mismatched, so `_input.isDirty()` would read `true` immediately after construction for no user-driven reason[^composite-bug].

The fix: `markClean()` re-baselines the whole composed subtree, not just `this`:

```typescript
markClean(): this {
    this._cleanValue = this.getValue();
    this.setDirty(false);
    this.markComposedInputsClean(this);

    return this;
}

private markComposedInputsClean(root: Component): void {
    for (const child of root.getComponents()) {
        if (child instanceof AbstractInput) {
            child.markClean();
        } else {
            this.markComposedInputsClean(child);
        }
    }
}
```

This also fixes the symmetric problem for a **host** calling `markClean()` later: without recursion, `dateField.markClean()` would clear `DateField`'s own flag while `_input` (still dirty from raw typing) keeps `Component.isDirty()`'s relay reporting `true` forever. The walk descends through non-`AbstractInput` containers too (not just direct children) so a future composite nesting an `AbstractInput` two levels deep is still covered, matching `Component.isDirty()`'s own arbitrary-depth relay philosophy — cheap here, since an `AbstractInput`'s own composed subtree is always small (a handful of chrome components).

Every subclass this walk actually visits today either finds an `AbstractInput` one level down (the four composites above) or finds none (`Checkbox`'s `CheckboxBox`, `Slider`'s track/thumb, `RadioButton`'s ring, `List`/`MultiSelectList`'s row pool — all plain `Component`s) and returns immediately.

### `Binding.commit()` and `Binding.reject()` both call `markClean()` on every bound field

Investigated `Binding.reject()` first, per the task's instruction. `reject()` calls `entry.accessors.set(this._record.get(fieldName))` for every bound field ([`Binding.ts:221-223`](packages/lib/src/typescript/lib/core/Binding.ts#L221-L223)). For the short-form `Bindable<T>` path this is a plain `component.setValue(...)` call. Reading every `setValue` in the affected subclasses shows this call does **not** go through `notifyChange` for the large majority (`TextInput.setValue` → `setText`, `List.setValue` → `setSelectedIndex(idx, false)`, `MultiSelectList.setValue` → `setValues`, `AbstractPickerField.setValue` — none of these call `notifyChange`) — the one exception is `Checkbox.setValue` → `setSelected`, which always calls `notifyChange` regardless of caller, a pre-existing quirk this plan does not touch. So `reject()`'s revert does **not** reliably clear presentation dirty state on its own; it only happens to work for `Checkbox` by accident.

Applying the same reasoning symmetrically to `commit()`: it calls `this._record?.commit()` (clearing the record's own dirty/new flags) and touches no component at all, so a bound field's presentation-dirty flag survives a commit unless something clears it. Per `component-dirty-state.md`'s rule that the two axes never derive from each other, the data axis clearing (`ModelRecord.commit()`/`reject()`) does not and should not automatically clear the presentation axis — but `Binding` already sits at exactly the seam CodeEditor's own plan calls out as the documented workflow ("call `markClean()` after the host has persisted the document"): `commit()` is that persist point, `reject()` is a revert-to-clean point, and `Binding` already owns every bound field's accessors. So both call the new hook explicitly.

`BoundEntry` never retained the original `component` reference — only `accessors` ([`Binding.ts:19-22`](packages/lib/src/typescript/lib/core/Binding.ts#L19-L22)) — so `markClean` is threaded through as a fourth, optional `BindingAccessors` field rather than reaching for a component reference `commit()`/`reject()` no longer have:

```typescript
// core/Bindable.ts
export interface BindingAccessors<T = unknown> {
    get:        () => T;
    set:        (value: T) => void;
    listen:     (fn: () => void) => void;
    markClean?: () => void;
}
```

`Binding.bind()` auto-supplies it whenever `component instanceof AbstractInput`, **regardless of which `bind()` overload the caller used** — a caller supplying explicit long-form accessors (as `MultiSelectListPanel`'s Binding demo section already does; see below) still passes the real `component` as `bind()`'s second argument, so the auto-wiring runs off that parameter, not off which accessors shape was chosen. An explicit `markClean` the caller supplies wins over the auto-wired one.

### `Binding.setRecord()` is not touched

Loading a fresh record has the identical "presentation flags should reset" argument `commit()`/`reject()` do, but the task scoped the investigation to commit/reject symmetry specifically. Flagged as a known related gap rather than silently fixed — see Non-Goals.

---

## Public API

New members on the already-exported `AbstractInput` (no new exported symbol):

```typescript
// component/input/AbstractInput.ts

/**
 * Accepts the current value as the clean baseline, clearing this input's
 * dirty flag — and, through the framework's relay, every ancestor's, unless
 * another descendant is still dirty. Also cleans every `AbstractInput`
 * composed internally (e.g. a picker field's inner text input), so a
 * composite control's own baseline and its inner children's stay in sync.
 *
 * Call this after a host has persisted the value, or after loading one
 * programmatically. Persisting is the host's job — this method only
 * reports state; it does not change the value itself.
 *
 * @returns This component, for method chaining.
 */
markClean(): this;
```

```typescript
// component/input/AbstractInput.ts — new PROTECTED hook

/**
 * Compares a candidate value against the clean baseline (or `undefined`
 * when no baseline has been established yet, which always compares
 * unequal). Defaults to `Object.is`, correct for every scalar `TValue`.
 * Override when `TValue` is an array or object whose `getValue()` may
 * return a fresh reference for an unchanged value.
 *
 * @param a - The candidate value.
 * @param b - The clean baseline, or `undefined` if none has been set.
 *
 * @returns `true` when the two are equal for dirty-tracking purposes.
 */
protected valuesEqual(a: TValue, b: TValue | undefined): boolean;
```

```typescript
// core/Bindable.ts — widened interface

export interface BindingAccessors<T = unknown> {
    get:        () => T;
    set:        (value: T) => void;
    listen:     (fn: () => void) => void;
    /**
     * Accepts the field's current value as clean. Auto-supplied by
     * `Binding.bind()` when the bound component is an `AbstractInput`;
     * supply your own for a component with an equivalent concept. Called by
     * `Binding.commit()` and `Binding.reject()`.
     */
    markClean?: () => void;
}
```

No other signature changes. `isDirty()` / `onDirtyChange()` / `offDirtyChange()` stay inherited from `Component`, unmodified.

---

## Internal Structure

`AbstractInput`'s new private field and the modified `notifyChange`:

```typescript
// AbstractInput.ts — new private field, next to `_listeners`
private _cleanValue: TValue | undefined = undefined;

// AbstractInput.ts — notifyChange gains one line
protected notifyChange(value: TValue): void {
    this.setDirty(!this.valuesEqual(value, this._cleanValue));
    this.emit("change", value);
    this.emit("binding");
}
```

`markClean()` and its recursive helper — full bodies in **Architecture Decisions** above.

`AbstractPickerField`'s override:

```typescript
// AbstractPickerField.ts
protected valuesEqual(a: TValue | null, b: (TValue | null) | undefined): boolean {
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }

    return Object.is(a, b);
}
```

`MultiSelectList`'s override:

```typescript
// MultiSelectList.ts
protected valuesEqual(a: string[], b: string[] | undefined): boolean {
    if (b === undefined || a.length !== b.length) {
        return false;
    }

    return a.every((v, i) => v === b[i]);
}
```

`Binding`'s widened `bind()` (unchanged parts elided) and the `commit()` / `reject()` additions:

```typescript
// core/Binding.ts
import { AbstractInput } from "~/component/input/AbstractInput.js";
// — precedent for a core/ file reaching into component/: core/Panel.ts:12
//   already imports Scrollbar from "~/component/container/Scrollbar.js".

bind<T>(fieldName: string, component: Bindable<T> | object, accessors?: BindingAccessors<T>): this {
    this.unbind(fieldName);

    const acc: BindingAccessors<any> = accessors ?? {
        get:    () => (component as Bindable<T>).getValue(),
        set:    (v: T) => (component as Bindable<T>).setValue(v),
        listen: (fn) => (component as Bindable<T>).on("binding", fn),
    };

    if (acc.markClean === undefined && component instanceof AbstractInput) {
        acc.markClean = () => component.markClean();
    }

    // ...unchanged from here (entry construction, listen wiring, record.set)
}

commit(): this {
    this._record?.commit();

    for (const [, entry] of this._entries) {
        entry.accessors.markClean?.();
    }

    this.emit("commit");

    return this;
}

reject(): void {
    this._record?.reject();

    if (this._record) {
        for (const [fieldName, entry] of this._entries) {
            entry.accessors.set(this._record.get(fieldName));
        }
    }

    for (const [, entry] of this._entries) {
        entry.accessors.markClean?.();
    }

    this.clearValidation();

    this.emit("reject");
}
```

`bind()` mutates the `acc` object it just built (either the caller's own `accessors` object, when supplied, or the freshly-created fallback literal) — both are safe to write an extra key onto: the fallback literal has no other reference, and the caller's `accessors` object is only ever read by this `Binding` instance afterward.

---

## Ordered Implementation Steps

1. **[`AbstractInput.ts`](packages/lib/src/typescript/lib/component/input/AbstractInput.ts)** — add the private `_cleanValue` field (next to `_listeners`, line 59), the `protected valuesEqual` hook, the modified `notifyChange` (line 201), the public `markClean()`, and the private `markComposedInputsClean` helper. Bodies and JSDoc from **Public API** / **Internal Structure**.

2. Check: `cd packages/lib && npm run typecheck` — clean. `markClean()` / `valuesEqual` are purely additive (no abstract member, no changed signature), so nothing downstream breaks yet — this step only confirms `AbstractInput.ts` itself compiles before the mechanical per-subclass edits begin.

3. **Add one `this.markClean();` call, as the last statement of the constructor**, to each file/line below. Every one of these classes already ends its constructor with a conditional `applyEnabled` / `applyReadOnly` (or, for `TextInput`, the native-listener wiring) dispatch — `markClean()` goes immediately after that, still inside the constructor body, before the closing `}`.

   | File | Insert after line | Covers |
   |---|---|---|
   | [`TextInput.ts`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L132) | 132 (`Event.addListener(this, "input", this.onInput);`) | `TextField`, `TextArea`, `PasswordField`, `UsernameField`, `PickerInput` |
   | [`Checkbox.ts`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L343) | 343 (closing `}` of the `readOnly` dispatch) | `Checkbox` |
   | [`RadioButton.ts`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L276) | 276 (closing `}` of the `readOnly` dispatch) | `RadioButton` |
   | [`Toggle.ts`](packages/lib/src/typescript/lib/component/input/Toggle.ts#L192) | 192 (closing `}` of the `readOnly` dispatch) | `Toggle` |
   | [`ComboBox.ts`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L809) | 809 (closing `}` of the `readOnly` dispatch) | `ComboBox` |
   | [`Slider.ts`](packages/lib/src/typescript/lib/component/input/Slider.ts#L191) | 191 (closing `}` of the `readOnly` dispatch) | `Slider` |
   | [`NumberSpinner.ts`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L228) | 228 (`if (this._options.readOnly !== undefined) this.setReadOnly(...)`) | `NumberSpinner` (recursively cleans `_input`) |
   | [`FileField.ts`](packages/lib/src/typescript/lib/component/input/FileField.ts#L285) | 285 (closing `}` of the `readOnly` dispatch) | `FileField` |
   | [`FileDropZone.ts`](packages/lib/src/typescript/lib/component/input/FileDropZone.ts#L102) | 102 (closing `}` of the `readOnly` dispatch) | `FileDropZone` (recursively cleans `_field`) |
   | [`AutoCompleteField.ts`](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L182) | 182 (closing `}` of the `readOnly` dispatch) | `AutoCompleteField` (recursively cleans `_textField`) |
   | [`DateField.ts`](packages/lib/src/typescript/lib/component/input/DateField.ts#L56) | 56 (closing `}` of the `value` dispatch) | `DateField` (recursively cleans `_input`) |
   | [`TimeField.ts`](packages/lib/src/typescript/lib/component/input/TimeField.ts#L61) | 61 (closing `}` of the `value` dispatch) | `TimeField` (recursively cleans `_input`) |
   | [`DateTimeField.ts`](packages/lib/src/typescript/lib/component/input/DateTimeField.ts#L63) | 63 (closing `}` of the `value` dispatch) | `DateTimeField` (recursively cleans `_input`) |
   | [`List.ts`](packages/lib/src/typescript/lib/component/list/List.ts#L54) | 54 (closing `}` of the `selectedItem` dispatch) | `List` |
   | [`MultiSelectList.ts`](packages/lib/src/typescript/lib/component/list/MultiSelectList.ts#L55) | 55 (closing `}` of the `applyInitialSelection` call) | `MultiSelectList` |

   Add a one-line comment above each call: `// Establishes the clean baseline for dirty-state tracking — see AbstractInput.markClean().`

4. Check: `grep -c "this.markClean();" packages/lib/src/typescript/lib/component/input/TextInput.ts packages/lib/src/typescript/lib/component/input/Checkbox.ts packages/lib/src/typescript/lib/component/input/RadioButton.ts packages/lib/src/typescript/lib/component/input/Toggle.ts packages/lib/src/typescript/lib/component/input/ComboBox.ts packages/lib/src/typescript/lib/component/input/Slider.ts packages/lib/src/typescript/lib/component/input/NumberSpinner.ts packages/lib/src/typescript/lib/component/input/FileField.ts packages/lib/src/typescript/lib/component/input/FileDropZone.ts packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts packages/lib/src/typescript/lib/component/input/DateField.ts packages/lib/src/typescript/lib/component/input/TimeField.ts packages/lib/src/typescript/lib/component/input/DateTimeField.ts packages/lib/src/typescript/lib/component/list/List.ts packages/lib/src/typescript/lib/component/list/MultiSelectList.ts` — every file reports `1`.

5. **[`AbstractPickerField.ts`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts)** — add the `protected valuesEqual` override from **Internal Structure**, placed directly after `getValue()` (currently ending line 311).

6. **[`MultiSelectList.ts`](packages/lib/src/typescript/lib/component/list/MultiSelectList.ts)** — add the `protected valuesEqual` override from **Internal Structure**, placed directly after `getValue()` (currently ending line 131).

7. Run `cd packages/lib && npm run typecheck && npm test` — clean.

8. **[`Bindable.ts`](packages/lib/src/typescript/lib/core/Bindable.ts)** — add the optional `markClean?: () => void;` field to `BindingAccessors<T>`, with the JSDoc from **Public API**.

9. **[`Binding.ts`](packages/lib/src/typescript/lib/core/Binding.ts)** — add `import { AbstractInput } from "~/component/input/AbstractInput.js";`; widen `bind()` with the `markClean` auto-wiring; add the `markClean?.()` loop to `commit()` and to `reject()`. Full bodies in **Internal Structure**.

10. Check: `grep -n "markClean" packages/lib/src/typescript/lib/core/Binding.ts` — three matches (the auto-wire in `bind()`, the loop in `commit()`, the loop in `reject()`).

11. Run `cd packages/lib && npm run typecheck && npm test` — clean.

12. Run `cd packages/lib && npm run lint` — no new findings (naming-convention check on `_cleanValue`; no raw-DOM, no direct `Event` cross-component calls introduced).

13. **Create [`packages/lib/tests/component/input/AbstractInput.dirtyState.test.ts`](packages/lib/tests/component/input/AbstractInput.dirtyState.test.ts)** covering every case in **Expected Behaviour**'s "Generic mechanism" group, using a minimal concrete test subclass mirroring `DirtyProbe` from [`dirty-state-propagation.test.ts`](packages/lib/tests/component/dirty-state-propagation.test.ts).

14. **Extend [`TextInput.test.ts`](packages/lib/tests/component/input/TextInput.test.ts)** with a `describe('TextField dirty state', ...)` block covering **Expected Behaviour**'s "TextField smoke test" group.

15. **Extend [`MultiSelectList.test.ts`](packages/lib/tests/component/list/MultiSelectList.test.ts)** with a `describe('MultiSelectList dirty state', ...)` block covering **Expected Behaviour**'s "MultiSelectList smoke test" group. The existing `TestMultiSelectList.reduce(idx, ev)` only calls `reduceSelection` (not `notifyUserChange`), so add one more public wrapper — e.g. `public click(idx: number, ev: { ctrl: boolean; shift: boolean }): void { this.reduceSelection(idx, ev); this.notifyUserChange(); }` — that performs both calls the real click handler makes, and use it to drive cases 13-14.

16. **Extend [`DateField.test.ts`](packages/lib/tests/component/input/DateField.test.ts)** with a `describe('DateField dirty state', ...)` block covering **Expected Behaviour**'s "DateField smoke test" group (pins the `Date`-equality override — the least obvious of the two overrides).

17. **Extend [`Binding.test.ts`](packages/lib/tests/component/binding/Binding.test.ts)** with cases covering **Expected Behaviour**'s "Binding" group, using a real `TextField` bound through the short form so the `instanceof AbstractInput` auto-wiring is exercised (the file's existing `FakeWidget` cases stay as they are — they exercise the long form with no `markClean`, which must keep passing unchanged).

18. Run `cd packages/lib && npm run typecheck && npm test` — clean, including all new cases.

19. Run `cd packages/lib && npm run lint` — no new findings.

20. Update docs per **Documentation Impact**: [`packages/lib/docs/data/binding.md`](packages/lib/docs/data/binding.md), [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md).

21. **[`packages/lib/src/typescript/MultiSelectListPanel.ts`](packages/lib/src/typescript/MultiSelectListPanel.ts)** — add a presentation-dirty status line to Section 3 (Binding integration), per **Documentation Impact**.

22. Run `cd packages/lib && npm run docs:llms` (regenerates `packages/lib/llms.txt` — never hand-edit) then `npm run docs:api` — zero warnings. Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s *Don't `{@link}` internal symbols*, `markClean()`'s JSDoc must not `{@link}` `valuesEqual` or `_cleanValue` (both non-public); it already doesn't.

23. Run the manual browser check in **Verification**.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractInput.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TextInput.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/RadioButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Toggle.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Slider.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/FileField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/FileDropZone.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/DateField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TimeField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/DateTimeField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/List.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/MultiSelectList.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Bindable.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Binding.ts` |
| Modify | `packages/lib/src/typescript/MultiSelectListPanel.ts` |
| Create | `packages/lib/tests/component/input/AbstractInput.dirtyState.test.ts` |
| Modify | `packages/lib/tests/component/input/TextInput.test.ts` |
| Modify | `packages/lib/tests/component/list/MultiSelectList.test.ts` |
| Modify | `packages/lib/tests/component/input/DateField.test.ts` |
| Modify | `packages/lib/tests/component/binding/Binding.test.ts` |
| Modify | `packages/lib/docs/data/binding.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify (regenerate) | `packages/lib/llms.txt` |

---

## Expected Behaviour

### Generic mechanism (offline, `AbstractInput.dirtyState.test.ts`)

Using a minimal test subclass with `TValue = string` (default `Object.is` comparator) plus a second test subclass with `TValue = string[]` (a custom `valuesEqual` override, mirroring `MultiSelectList`'s):

1. A freshly constructed probe that never calls `markClean()` reports `isDirty()` `false` (inherited `Component` default — no baseline established, but nothing has called `notifyChange` yet either).
2. After `probe.markClean()`, `isDirty()` stays `false`.
3. Calling the probe's `notifyChange`-driving method with a value different from the clean baseline makes `isDirty()` `true`.
4. Calling it again with the **original** clean value makes `isDirty()` `false` again — round-trip works.
5. `markClean()` re-baselines: after `markClean()` at a new value, calling the same value again leaves `isDirty()` `false`; a different value makes it `true`.
6. The array-valued probe: `markClean()` at `["a"]`, then commit `["a", "b"]` → dirty; commit a **freshly allocated** `["a"]` (a new array instance with the same contents) → clean. Proves the override runs, not reference equality.
7. Composite recursion: build a probe `A`, a second `AbstractInput` probe `B`, and `A.addComponent(B)`; call `markClean()` on both (establishing each one's own baseline); drive `B`'s value away from `B`'s baseline (`B.isDirty()` is `true`, and — via the inherited `Component` relay — `A.isDirty()` is also `true`); call `A.markClean()` (not `B.markClean()`); both `A.isDirty()` and `B.isDirty()` are `false` afterward, confirming the recursive walk reached `B`.
8. `notifyChange` still fires `"change"` and `"binding"` exactly as before — a `"change"` listener querying `isDirty()` mid-callback sees the settled (post-comparison) value.

### TextField smoke test (offline, `TextInput.test.ts`)

Reuse this file's existing keystroke-simulation idiom (`field.getElement(true)`, `DOM.sink.setValue(el, '…')`, `field.onInput()`, with `field` typed `any` as the `make` helpers at [:59-63](packages/lib/tests/component/input/TextInput.test.ts#L59-L63) already do to reach the protected method).

9. `new TextField({ text: 'hello' }).isDirty()` is `false` — the baseline was captured by `TextInput`'s constructor with no caller action.
10. `DOM.sink.setValue(el, 'hello world'); field.onInput();` makes `isDirty()` `true`.
11. Following it with `DOM.sink.setValue(el, 'hello'); field.onInput();` — typing back to the original text — makes `isDirty()` `false` again.

### MultiSelectList smoke test (offline, `MultiSelectList.test.ts`)

12. `new _MultiSelectList({ items: FRUITS, selectedIndices: [1, 3] }).isDirty()` is `false` — baseline is `['Banana', 'Date']`, not empty, captured with no caller action.
13. Driving a plain click on row 1 — `reduceSelection(1, { ctrl: false, shift: false })` then `notifyUserChange()`, the two calls the real click handler makes ([`AbstractSelectableList.ts:1689`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1689) / [:1703](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1703)) — replaces the selection with `['Banana']` and makes `isDirty()` `true`.
14. Ctrl-clicking row 3 next — `reduceSelection(3, { ctrl: true, shift: false })` then `notifyUserChange()` — toggles row 3 back on, restoring the selection set to `{1, 3}`. `getValue()` returns `['Banana', 'Date']` (sorted by row order, independent of click order) and `isDirty()` is `false` again, confirming content-based rather than reference comparison.

### DateField smoke test (offline, `DateField.test.ts`)

Reuse this file's existing `formatValue` round-trip (`'YYYY-MM-DD'`, confirmed at [:24-30](packages/lib/tests/component/input/DateField.test.ts#L24-L30)) and its `(field as any)` cast convention.

15. `new DateField({ value: new Date(2025, 5, 15) }).isDirty()` is `false`.
16. Driving a value change through `AbstractPickerField`'s own commit seam — `protected onInput(): void` ([`AbstractPickerField.ts:394-413`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L394-L413)), which reads `this._input.getText()` and parses it — reached as `(field as any)._input.setText('2025-06-20'); (field as any).onInput();` makes `isDirty()` `true`. Following it with `(field as any)._input.setText('2025-06-15'); (field as any).onInput();` — parsing to a **freshly constructed** `Date` with the same year/month/day as the original, not the same object — makes `isDirty()` `false` again, not stuck `true`. `setValue` itself is a silent, non-notifying write ([`AbstractPickerField.ts:293-302`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L293-L302)) and cannot be used to drive this case.

### Binding (offline, `Binding.test.ts`)

17. Bind a real `TextField` via the short form (`binding.bind('name', textField)`); `setRecord(new ModelRecord(MODEL, { name: 'Alice' }))`; simulate a user edit via `textField.setText('Bob'); (textField as any).notifyChange(textField.getValue());` (the protected-method cast the existing suite already uses for `CodeEditor.onDocChange`, needed here because `setText` alone does not fire `"binding"`) — `textField.isDirty()` is `true` and `record.get('name')` is `'Bob'`; `binding.commit()` — `textField.isDirty()` is `false` afterward.
18. Same setup through the edit; instead of `commit()`, call `binding.reject()` — `textField.isDirty()` is `false` afterward, and `textField.getValue()` is back to `'Alice'`.
19. The existing `FakeWidget`-based cases (long form, no `markClean` supplied) are unchanged and still pass — `entry.accessors.markClean?.()` is a no-op when the field is absent.
20. A long-form `bind()` call whose `component` **is** an `AbstractInput` (mirroring `MultiSelectListPanel`'s Section 3, which binds `tagList` via explicit accessors) still gets the auto-wired `markClean` — `commit()` / `reject()` clear `tagList.isDirty()` even though the caller never touched a `markClean` accessor.

### Manual verification (browser)

21. `npm run dev` → `http://localhost:8015` → **MultiSelectList** section → the "Binding integration (tags field)" panel: select a tag, watch the new dirty-status line (added in this plan) flip to a dirty state; click **Commit** → it flips back to clean; select a different tag, click **Reject** → it flips back to clean and the selection reverts.

---

## Verification

- `cd packages/lib && npm run typecheck` — clean.
- `cd packages/lib && npm test` — clean, including every case above.
- `cd packages/lib && npm run lint` — no new findings.
- `cd packages/lib && npm run docs:llms && npm run docs:api` — zero warnings.
- `grep -rn "this.markClean();" packages/lib/src/typescript/lib/component/input/ packages/lib/src/typescript/lib/component/list/` — fifteen matches (one per concrete subclass constructor, `TextInput.ts` covering five leaves).
- `grep -n "protected valuesEqual" packages/lib/src/typescript/lib/component/input/AbstractInput.ts packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts packages/lib/src/typescript/lib/component/list/MultiSelectList.ts` — one match per file.
- `grep -n "markClean" packages/lib/src/typescript/lib/core/Bindable.ts packages/lib/src/typescript/lib/core/Binding.ts` — present in both.
- `git diff --name-only` lists none of `core/Component.ts`, `component/editor/CodeEditor.ts`, `component/editor/MarkdownEditor.ts`, `component/table/Table.ts`, `component/table/TreeTable.ts`, `data/ModelRecord.ts`, `data/AbstractStore.ts`.
- Manual: `npm run dev` → case 21 above.

---

## Documentation Impact

- **[`packages/lib/docs/data/binding.md`](packages/lib/docs/data/binding.md)** — the canonical `Binding` doc page (confirmed as the right home; `AbstractInput` itself has no hand-authored concept/component page, only generated API docs under `docs/api/component/input/classes/AbstractInput.md`).
  - `## Explicit accessors` (line 26) — add one sentence after the existing paragraph (line 39): `BindingAccessors` now has an optional fourth field, `markClean`, called by `commit()` / `reject()`; auto-supplied when the bound component is an `AbstractInput`.
  - New `## Presentation dirty state` section, placed after `## Listeners` (line 41) and before `## Switching records` (line 53): explain that every `AbstractInput`-derived bound field now also reports its own `Component.isDirty()` (a separate axis from the record's `isDirty()` already shown in the `## Listeners` example), and that `commit()` / `reject()` both clear it via the field's `markClean()`. Cross-reference `component-dirty-state.md`'s "two axes never derive from each other" rule in prose (not a `{@link}` — `component-dirty-state.md` isn't a doc page).
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — add a `### Components` bullet under `## Added` (mirroring the existing `### Components` subsections in this file): every `AbstractInput` subclass now reports `Component.isDirty()` on every committed value change, comparing against the value at the last clean point; gains the inherited `markClean()` to accept the current value as clean. Add a `### Data` bullet under the same heading: `Binding.commit()` / `Binding.reject()` now also clear each bound `AbstractInput`'s presentation-dirty flag via the new `BindingAccessors.markClean` hook.
- **`packages/lib/llms.txt`** — regenerate via `npm run docs:llms`; `markClean()` is a new consumer-facing capability, mirroring how `CodeEditor.markClean()` was added when it shipped (may regenerate byte-identical, per that plan's own Implementation Notes — still run the command to confirm rather than assume).
- **[`packages/lib/src/typescript/MultiSelectListPanel.ts`](packages/lib/src/typescript/MultiSelectListPanel.ts)** — Section 3 ("Binding integration") gains a `Text` status row reading `tagList`'s own `isDirty()`, wired via `tagList.onDirtyChange(...)`, added as its own row below `bindingStatusText` — the same pattern `CodeEditorPanel.ts` used for its dirty-status line (`plans/implemented/code-editor-dirty-state-adoption.md`'s `## Internal Structure`). This is the file the task named as the existing Binding/commit/reject demo; giving it a visible presentation-dirty readout demonstrates the new mechanism end to end (select a tag → dirty; Commit or Reject → clean), distinct from the existing `bindingStatusText` line (which reflects the **record's** dirty state, not the component's).

---

## Potential Challenges

- **Fifteen near-identical one-line constructor edits are easy to place wrong.** Mitigated by the exact "insert after line N" table in step 3 and the `grep -c` count check in step 4.
- **The `File[]` equality gap is a deliberate non-fix, not an oversight** — flag it in review as intentional (see Non-Goals) rather than "forgotten."
- **The recursive `markComposedInputsClean` walk visits harmless plain-`Component` subtrees** (`CheckboxBox`, `SliderTrack`, `RadioButtonRing`, `MultiSelectList`'s row pool) on every `markClean()` call. Cheap given an `AbstractInput`'s composed subtree is always small, but worth a one-line comment at the call site so a future reader doesn't mistake the full walk for something that should be gated to the four known composite subclasses.
- **`DateField.test.ts`'s existing test conventions must be read before writing case 15-16**, so the new cases match the file's existing construction and assertion style; the commit seam itself (`onInput()`) is already named precisely in **Expected Behaviour**.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/input/AbstractInput.ts`](packages/lib/src/typescript/lib/component/input/AbstractInput.ts) — `notifyChange` ([:201](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L201)), the `applyEnabled`/`applyReadOnly` deferred-dispatch precedent explained in its own `applyOptions` JSDoc ([:285-296](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L285-L296)) — **the precedent `markClean()`'s per-subclass dispatch mirrors**.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `isDirty()` / `setDirty()` / `onDirtyChange()` / `offDirtyChange()` ([:2340-2395](packages/lib/src/typescript/lib/core/Component.ts#L2340-L2395)), `getComponents()` ([:6724](packages/lib/src/typescript/lib/core/Component.ts#L6724)). Unmodified by this plan; read for the exact contract.
- [`plans/implemented/component-dirty-state.md`](plans/implemented/component-dirty-state.md) — the mechanism's design and the "two axes never derive from each other" rule this plan's `Binding` decision applies.
- [`plans/implemented/code-editor-dirty-state-adoption.md`](plans/implemented/code-editor-dirty-state-adoption.md) and [`plans/implemented/code-editor-undo-clears-dirty.md`](plans/implemented/code-editor-undo-clears-dirty.md) — **the precedent this plan's whole approach mirrors**: a single private choke point compared against a stored clean value, a public `markClean()`, and (in the second plan) the investigation trail showing why a cheaper-looking shortcut (`undoDepth()`) was rejected as unsound. This plan's own equivalent investigation — no free constructor-time baseline point — plays the same role.
- [`packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts) — `_value` field and `setValue`/`getValue` ([:85](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L85), [:293-311](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L293-L311)); `_input: PickerInput` composed via `addComponent` ([:104-116](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L104-L116)).
- [`packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts) — `_selectedSet` field ([:739](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L739)), `fireChange` ([:1659-1667](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1659-L1667)).
- [`packages/lib/src/typescript/lib/core/Binding.ts`](packages/lib/src/typescript/lib/core/Binding.ts) and [`packages/lib/src/typescript/lib/core/Bindable.ts`](packages/lib/src/typescript/lib/core/Bindable.ts) — full files read for this plan; `bind()`, `commit()`, `reject()`, `BoundEntry`.
- [`packages/lib/src/typescript/MultiSelectListPanel.ts`](packages/lib/src/typescript/MultiSelectListPanel.ts) — the existing Binding/commit/reject demo the task named; Section 3 (lines 100-165) is what gains the status row.
- [`packages/lib/src/typescript/CodeEditorPanel.ts`](packages/lib/src/typescript/CodeEditorPanel.ts) — the precedent for a demo status `Text` driven by `onDirtyChange`, cited in `code-editor-dirty-state-adoption.md`.
- [`packages/lib/tests/component/dirty-state-propagation.test.ts`](packages/lib/tests/component/dirty-state-propagation.test.ts) — the `DirtyProbe` test-subclass shape the new `AbstractInput.dirtyState.test.ts` mirrors.
- [`packages/lib/tests/component/list/MultiSelectList.test.ts`](packages/lib/tests/component/list/MultiSelectList.test.ts) — the existing `TestMultiSelectList` white-box subclass and `FRUITS` fixture, extended rather than duplicated.
- [`packages/lib/docs/data/binding.md`](packages/lib/docs/data/binding.md) — full page read for this plan; the section structure the new content slots into.
- [ARCHITECTURE.md](ARCHITECTURE.md) — *Keep presentation state out of data Models*, *Compose before specializing*. [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) — *Fields written during the `super()` cascade*, *Don't `{@link}` internal symbols*.

---

## Non-Goals

- **No structural equality for `File[]`.** `FileField` / `FileDropZone` keep the default `Object.is` comparator. Browser `File` objects have no stable identity across two selections of "the same" file (the OS picker mints a new object each time), so a content comparison would need to compare `(name, size, lastModified)` tuples for a guarantee the platform itself doesn't provide elsewhere — not worth the extra code for a type where "differs from clean" is already fuzzy at the platform level.
- **`Binding.setRecord()` does not call `markClean()`.** A freshly loaded record leaves any pre-existing presentation-dirty flags on its bound fields until the user edits them or a host explicitly clears them. This is a real, related gap — flagged here rather than fixed, because the task scoped the `Binding` investigation to `commit()` / `reject()` symmetry specifically.
- **No change to `Component.ts`, `CodeEditor.ts`, `MarkdownEditor.ts`, `Table.ts`, `TreeTable.ts`, `ModelRecord.ts`, or `AbstractStore.ts`.** Confirmed out of scope per the task; nothing in this plan's investigation found a reason to touch any of them.
- **No `dirty` construction option, and `setDirty` stays protected on `Component`.** `markClean()` is the only new public surface, matching `CodeEditor`'s own precedent.
- **`AbstractSelectableList` itself gains no `valuesEqual` override.** Only its `MultiSelectList` subclass needs one (`TValue = string[]`); `List`'s `TValue = string` uses the default.
- **No visual decoration beyond the one `MultiSelectListPanel.ts` demo row.** How any other host chooses to render "this field is dirty" (an asterisk, a border colour, …) is each consumer's own decision, exactly as `component-dirty-state.md` established for `Component.isDirty()` generally.

---

## Notes

[^dirty-before-change]: Same reasoning `code-editor-dirty-state-adoption.md` used for `CodeEditor.onDocChange` (its `[^dirty-before-change]` footnote): a `"change"` listener that queries `isDirty()` should see the settled value for the change it's being notified of, not a stale one. `"binding"` has no consumers that read `isDirty()` mid-callback today (`Binding`'s own `listen` callback reads the field's *value*, not its dirty flag), so reordering costs nothing existing.

[^equality-investigation]: Checked every concrete `TValue` in the codebase before choosing a design, per the task's explicit instruction not to pick an equality strategy abstractly. `Date` fails reference equality because `AbstractPickerField.setValue`/its callers construct a fresh `Date` on every commit (typed input parse, dropdown pick) — two calls carrying "the same" calendar date are two different object references. `string[]` fails for the same reason (`MultiSelectList.getValue()` builds a new array every call, confirmed at `MultiSelectList.ts:127-131`) — this is the exact case the task's own framing flagged ("reference equality is wrong for a fresh array... returned by `getValue()`"), and it is also the concrete motivation the whole plan traces back to (`List`/`MultiSelectList` reporting dirty was the original ask). A generic deep-equality fallback (e.g. `JSON.stringify`-based) was considered and rejected: it would silently mis-compare `File[]` (a `File` serializes to `{}` via `JSON.stringify`, so any two same-length file selections would compare equal regardless of which files they are — worse than the honest "always differs" `Object.is` gives today), and it adds a per-comparison allocation cost to every input's every `notifyChange` call for a benefit only two of fourteen subclasses need.

[^composite-bug]: Traced concretely for `NumberSpinner`: its constructor calls `this._input.setText(this.formatValue(0))` unconditionally before any late-built `value` dispatch (`NumberSpinner.ts:186`). Once `TextInput`'s constructor calls `markClean()` for every `TextInput`-derived instance (including `_input`, a `NumberSpinnerField`), `_input`'s baseline is captured as `""` at its own construction, before `setText("0")` overwrites the display — `_input.getValue()` would read `"0"` against a `""` baseline, `_input.isDirty()` would read `true`, and the relay would make `NumberSpinner.isDirty()` `true` immediately after construction with no user action. The same trace applies to `AbstractPickerField.setValue`'s `this._input?.setText(...)` (`AbstractPickerField.ts:299`) for every `DateField`/`TimeField`/`DateTimeField` constructed with an initial `value`, and to `FileDropZone`/`AutoCompleteField`'s inner-field construction paths.
