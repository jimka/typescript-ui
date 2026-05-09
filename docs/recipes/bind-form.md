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

const form = new Component();
form.setLayoutManager(new VBox());

const nameField   = new TextField();
const emailField  = new TextField();
const roleCombo   = new ComboBox();
const activeCheck = new Checkbox();

roleCombo.addItem(new Option('admin', 'Admin'));
roleCombo.addItem(new Option('user',  'User'));
roleCombo.addItem(new Option('guest', 'Guest'));

form.addComponent(new Label('Name',   nameField.getId()));
form.addComponent(nameField);
form.addComponent(new Label('Email',  emailField.getId()));
form.addComponent(emailField);
form.addComponent(new Label('Role',   roleCombo.getId()));
form.addComponent(roleCombo);
form.addComponent(new Label('Active', activeCheck.getId()));
form.addComponent(activeCheck);
```

## Bind and react to dirty state

```typescript
const binding = new Binding()
    .bind('name',   nameField)
    .bind('email',  emailField)
    .bind('role',   roleCombo)
    .bind('active', activeCheck);

binding.setRecord(store.getAt(0));

const saveBtn   = new Button('Save');
const cancelBtn = new Button('Cancel');
saveBtn.setEnabled(false);
cancelBtn.setEnabled(false);

binding.addChangeListener(() => {
    const dirty = binding.getRecord()?.isDirty() ?? false;
    saveBtn.setEnabled(dirty);
    cancelBtn.setEnabled(dirty);
});

Event.addListener(saveBtn,   'click', () => binding.commit());
Event.addListener(cancelBtn, 'click', () => binding.reject());

const buttons = new Component();
buttons.setLayoutManager(new HBox());
buttons.addComponent(saveBtn);
buttons.addComponent(cancelBtn);

form.addComponent(buttons);
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
