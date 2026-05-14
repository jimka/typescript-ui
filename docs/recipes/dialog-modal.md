# Modal dialog with async result

Use [`Dialog.show()`](/api/classes/Dialog) for one-shot prompts. The static method returns a `Promise<DialogResult>` that resolves to `'confirm'`, `'cancel'`, or `'close'`.

## Confirm a destructive action

```typescript
import { Dialog } from '@jimka/typescript-ui/core';
async function deleteRecord(record: ModelRecord) {
    const result = await Dialog.show({
        title:   'Delete record?',
        message: `Are you sure you want to delete "${record.get('name')}"? This cannot be undone.`,
        buttons: [
            { text: 'Delete', result: 'confirm', primary: true },
            { text: 'Cancel', result: 'cancel'  },
        ],
    });

    if (result === 'confirm') {
        store.remove(record);
        await store.sync();
        Notification.show('Record deleted.', 'success');
    }
}
```

## Custom content

Replace `message` with `contentComponent` to embed a form or any other component:

```typescript
import { Dialog } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { Label, TextField } from '@jimka/typescript-ui/component/input';
async function renameFile(currentName: string): Promise<string | null> {
    const nameField = TextField();
    nameField.setValue(currentName);

    const form = Component({
        layoutManager: VBox(),
        components: [Label('New name:', nameField.getId()), nameField]
    });

    const result = await Dialog.show({
        title:            'Rename file',
        contentComponent: form,
        width:            420,
        buttons: [
            { text: 'Save',   result: 'confirm', primary: true },
            { text: 'Cancel', result: 'cancel'  },
        ],
    });

    return result === 'confirm' ? nameField.getValue() : null;
}
```

The dialog cleans up the embedded component when it closes — the same form instance can be reused on the next call without leaking listeners, but you should still keep references on hand only as long as you need them.

## Click-outside to dismiss

Set `closeOnBackdrop: true` to allow clicking outside the dialog to dismiss it (resolves to `'close'`):

```typescript
const result = await Dialog.show({
    title:            'Profile',
    contentComponent: profileForm,
    closeOnBackdrop:  true,
    buttons: [
        { text: 'OK', result: 'confirm' },
    ],
});
```

## Handle three outcomes

`Dialog.show()` resolves to one of:

- `'confirm'` — the user clicked a button whose `result` was `'confirm'`.
- `'cancel'` — the user clicked Cancel or pressed Escape.
- `'close'` — the user clicked the dialog's × button or the backdrop (when `closeOnBackdrop` is set).

Distinguish them when the difference matters:

```typescript
switch (result) {
    case 'confirm': await save();      break;
    case 'cancel':  /* discard edits */ break;
    case 'close':   /* user backed out — preserve draft */ break;
}
```

## See also

- [Dialog](/components/Dialog) — full surface
- [API: DialogConfig](/api/interfaces/DialogConfig), [DialogButtonConfig](/api/interfaces/DialogButtonConfig), [DialogResult](/api/type-aliases/DialogResult)
- [Floating window](/recipes/floating-window) — for non-modal panels
