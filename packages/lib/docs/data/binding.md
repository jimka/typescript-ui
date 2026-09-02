# Binding

[`Binding`](/api/core/classes/Binding) synchronises a [`ModelRecord`](/api/data/classes/ModelRecord) with a set of form components. Components that implement [`Bindable`](/api/core/interfaces/Bindable) — [`TextField`](/api/component/input/classes/TextField), [`Checkbox`](/api/component/input/classes/Checkbox), [`ComboBox`](/api/component/input/classes/ComboBox), [`DateField`](/api/component/input/classes/DateField), [`TimeField`](/api/component/input/classes/TimeField) — can be bound by field name. Any other component can be wired via explicit accessor callbacks.

`Binding` is **standalone** — it is not a layout component. You wire your own form layout and pass the input components to `binding.bind()`.

## Quick start

```typescript
import { Binding } from '@jimka/typescript-ui/core';
const binding = new Binding()
    .bind('name',   nameField)
    .bind('active', activeCheckbox)
    .bind('role',   roleCombo);

// Populate all components from a record:
binding.setRecord(store.getAt(0));

// Commit or reject the user's edits:
binding.commit();
// binding.reject();
```

`bind` is chainable and returns the same binding.

## Explicit accessors

Use the long form of `bind` for components that do not implement [`Bindable`](/api/core/interfaces/Bindable):

```typescript
const binding = new Binding()
    .bind('name', myWidget, {
        get:    () => myWidget.getValue(),
        set:    (v) => myWidget.setValue(v),
        listen: (fn) => myWidget.on("change", fn),
    });
```

The accessor object matches [`BindingAccessors`](/api/core/interfaces/BindingAccessors). The `listen` callback is what tells the binding "the user just edited this field" — typically you wire it to whatever change event your component fires. `BindingAccessors` also has an optional fourth field, `markClean`, called by `commit()` / `reject()`; it is auto-supplied when the bound component is an `AbstractInput`.

## Listeners

`Binding` fires three event types:

```typescript
binding.on("change", () => console.log('field edited, dirty =', binding.getRecord()?.isDirty()));
binding.on("commit", () => console.log('committed'));
binding.on("reject", () => console.log('rejected'));
```

These let callers react to record mutations without polling. Use them to enable / disable a save button, show a "you have unsaved changes" indicator, etc.

## Presentation dirty state

Every bound component that is an `AbstractInput` — `TextField`, `Checkbox`, `ComboBox`, `DateField`, and the rest — also reports its own `Component.isDirty()`, separate from the record's own `isDirty()` shown in the `## Listeners` example above. The record's dirty flag tracks whether a field *value* differs from what was loaded; a component's own dirty flag tracks whether its *presentation* differs from its last clean point, and the two are never derived from each other — a record can be dirty while a field's presentation is clean, or vice versa, depending on what else touched either one.

`binding.commit()` and `binding.reject()` both clear the presentation-dirty flag on every bound `AbstractInput`, via the field's own `markClean()`, so a save button wired to `nameField.onDirtyChange(...)` re-disables itself the moment either operation runs — with no extra code at the call site.

## Switching records

Call `setRecord()` again to switch the binding to a different record:

```typescript
binding.setRecord(store.getAt(0));
// user edits name field…
binding.setRecord(store.getAt(1));   // discards uncommitted edits on record 0
```

`setRecord` is **synchronous** — there is no built-in confirmation step if the current record is dirty. If you need a "save first?" prompt, run it at the call site before `setRecord`.

## Vetoing a record change

`on("beforerecord", fn)` registers a guard that runs before `setRecord` mutates any state. The listener receives the *next* record (which may be `null`) and returns `false` to cancel the change:

```typescript
binding.on("beforerecord", (next) => {
    const current = binding.getRecord();

    if (current && current !== next && current.isDirty()) {
        Notification.show('Commit or reject your changes first.', 'error');
        return false;
    }

    return true;
});
```

A vetoed call is a **complete no-op** — the previous record stays bound, field values are not repopulated, and validation decorations are preserved. Multiple listeners can be registered; the first one to return `false` short-circuits the rest, so adding a listener can never widen permission. Returning `true` or omitting `return` allows the change.

The veto API is intentionally synchronous and boolean. For async confirmation flows (a "Discard unsaved changes?" dialog), orchestrate the dialog at the call site and only invoke `setRecord` once the user has decided.

If a veto fires, any picker UI that drove the call (e.g. a record-selector combo) will still show the rejected selection while the binding remains on the previous record. The call site is responsible for reconciling — compare [`getRecord`](/api/core/classes/Binding#getrecord) after the call and reset the picker if they diverge:

```typescript
recordCombo.on("action", () => {
    const next = store.find('id', Number(recordCombo.getElement().value));
    if (!next) return;

    binding.setRecord(next);

    const active = binding.getRecord();
    if (active && active !== next) {
        recordCombo.getElement().value = String(active.get('id'));
    }
});
```

Listeners that only want to guard *switches* (and let `setRecord(null)` clears through) must short-circuit `next === null` themselves.

## Unbinding

`binding.unbind(fieldName)` removes a component from the binding. `binding.bind` on an already-bound field rebinds it.

## See also

- [Record](/data/record) — what `setRecord` accepts.
- [`Bindable`](/api/core/interfaces/Bindable) — the interface form components implement.
- [`BindingAccessors`](/api/core/interfaces/BindingAccessors) — the explicit-accessor shape.
- [`BeforeRecordListener`](/api/core/type-aliases/BeforeRecordListener) — the veto-listener signature.
