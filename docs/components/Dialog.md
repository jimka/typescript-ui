# Dialog

[`Dialog`](/api/classes/Dialog) is a modal panel with a title bar, scrollable content area, and a button row. The static `Dialog.show(config)` returns a `Promise<DialogResult>` resolving to `'confirm'`, `'cancel'`, or `'close'`.

## One-shot prompt

```typescript
import { Dialog } from '@jika/typescript-ui';

const result = await Dialog.show({
    title:   'Confirm deletion',
    message: 'Are you sure you want to delete this record?',
    buttons: [
        { text: 'Delete', result: 'confirm', primary: true },
        { text: 'Cancel', result: 'cancel'  },
    ],
});

if (result === 'confirm') {
    // delete the record
}
```

## Custom content

Replace `message` with `contentComponent` to render any component as the dialog body:

```typescript
import { Dialog, TextField, VBox } from '@jika/typescript-ui';

const form = new VBox();
const nameField = new TextField();
form.addComponent(nameField);

const result = await Dialog.show({
    title:            'Rename file',
    contentComponent: form,
    buttons: [
        { text: 'Save',   result: 'confirm', primary: true },
        { text: 'Cancel', result: 'cancel'  },
    ],
});
```

## DialogConfig

See [`DialogConfig`](/api/interfaces/DialogConfig) for the full option list. Highlights:

| Option | Default | Purpose |
| --- | --- | --- |
| `title` | (required) | Title-bar text. |
| `message` | — | Plain-text body (ignored when `contentComponent` is set). |
| `contentComponent` | — | Custom component for the body. |
| `buttons` | One `OK` button | Footer button definitions. |
| `width` / `height` | `480` / auto | Dialog panel size in pixels. |
| `closeOnBackdrop` | `false` | Click outside dismisses with result `'close'`. |

## See also

- [API: Dialog](/api/classes/Dialog)
- [API: DialogConfig](/api/interfaces/DialogConfig), [DialogButtonConfig](/api/interfaces/DialogButtonConfig), [DialogResult](/api/type-aliases/DialogResult)
