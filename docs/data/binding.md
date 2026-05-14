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
        listen: (fn) => myWidget.addChangeListener(fn),
    });
```

The accessor object matches [`BindingAccessors`](/api/core/interfaces/BindingAccessors). The `listen` callback is what tells the binding "the user just edited this field" — typically you wire it to whatever change event your component fires.

## Listeners

`Binding` fires three event types:

```typescript
binding.addChangeListener(() => console.log('field edited, dirty =', binding.getRecord()?.isDirty()));
binding.addCommitListener(() => console.log('committed'));
binding.addRejectListener(() => console.log('rejected'));
```

These let callers react to record mutations without polling. Use them to enable / disable a save button, show a "you have unsaved changes" indicator, etc.

## Switching records

Call `setRecord()` again to switch the binding to a different record:

```typescript
binding.setRecord(store.getAt(0));
// user edits name field…
binding.setRecord(store.getAt(1));   // discards uncommitted edits on record 0
```

`setRecord` is **synchronous** — there is no built-in confirmation step if the current record is dirty. If you need a "save first?" prompt, run it at the call site before `setRecord`.

## Unbinding

`binding.unbind(fieldName)` removes a component from the binding. `binding.bind` on an already-bound field rebinds it.

## See also

- [Record](/data/record) — what `setRecord` accepts.
- [`Bindable`](/api/core/interfaces/Bindable) — the interface form components implement.
- [`BindingAccessors`](/api/core/interfaces/BindingAccessors) — the explicit-accessor shape.
