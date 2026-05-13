# Bind a record to a form

Wire a [`ModelRecord`](/data/record) to a set of form components, with explicit commit / reject and dirty-state visualisation.

## Goal

Edit a person record across `TextField`, `Checkbox`, and `ComboBox` inputs. The save button stays disabled until the user makes a change; the cancel button reverts unsaved edits.

## Set up the record

```typescript
import {
    Model, MemoryStore,
    Binding, Event,
} from '@jimka/typescript-ui';

const PersonModel = new Model([
    { name: 'name',   type: 'string'  },
    { name: 'email',  type: 'string'  },
    { name: 'role',   type: 'string'  },
    { name: 'active', type: 'boolean' },
]);

const store = new MemoryStore(PersonModel, [
    { name: 'Alice', email: 'alice@example.com', role: 'admin', active: true },
]);
await store.load();
```

## Build the form

```typescript
import {
    Component, VBox, HBox,
    Label, TextField, Checkbox, ComboBox, Option, Button,
} from '@jimka/typescript-ui';

const nameField   = TextField();
const emailField  = TextField();
const activeCheck = Checkbox();
const roleCombo   = ComboBox()
    .addItem(Option('admin', 'Admin'))
    .addItem(Option('user',  'User'))
    .addItem(Option('guest', 'Guest'));

const form = Component({
    layoutManager: VBox(),
    components: [
        Label('Name',   nameField.getId()),   nameField,
        Label('Email',  emailField.getId()),  emailField,
        Label('Role',   roleCombo.getId()),   roleCombo,
        Label('Active', activeCheck.getId()), activeCheck
    ]
});
```

The fields are bound to named references because the `Binding` below needs handles on them; everything else (labels, layout managers) is declared inline.

## Bind and react to dirty state

```typescript
const binding = new Binding()
    .bind('name',   nameField)
    .bind('email',  emailField)
    .bind('role',   roleCombo)
    .bind('active', activeCheck);

binding.setRecord(store.getAt(0));

const saveBtn   = Button('Save');
const cancelBtn = Button('Cancel');
saveBtn.setEnabled(false);
cancelBtn.setEnabled(false);

binding.addChangeListener(() => {
    const dirty = binding.getRecord()?.isDirty() ?? false;
    saveBtn.setEnabled(dirty);
    cancelBtn.setEnabled(dirty);
});

Event.addListener(saveBtn,   'click', () => binding.commit());
Event.addListener(cancelBtn, 'click', () => binding.reject());

form.addComponent(Component({
    layoutManager: HBox(),
    components: [saveBtn, cancelBtn]
}));
```

## Switching records

Calling `setRecord` with a different record discards uncommitted edits — there is no built-in "save first?" prompt. Wrap the call site if you need confirmation:

```typescript
async function selectRecord(rec: ModelRecord) {
    if (binding.getRecord()?.isDirty()) {
        const result = await Dialog.show({
            title:   'Unsaved changes',
            message: 'Discard your edits?',
            buttons: [
                { text: 'Discard', result: 'confirm', primary: true },
                { text: 'Cancel',  result: 'cancel'  },
            ],
        });
        if (result !== 'confirm') return;
    }
    binding.setRecord(rec);
}
```

## See also

- [Binding](/data/binding) — full API surface and explicit-accessor patterns
- [Record](/data/record) — dirty / commit / reject lifecycle
- [CRUD with a Table](/recipes/crud-table) — pairs naturally with this for master / detail UIs
