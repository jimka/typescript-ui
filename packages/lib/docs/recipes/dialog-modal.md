# Modal dialog with async result

Use [`Dialog.show()`](/api/overlay/classes/Dialog) for one-shot prompts. The static method returns a `Promise<DialogResult>` that resolves to `'confirm'`, `'cancel'`, or `'close'`.

## Standard button presets

When the buttons are the universal Ok / Confirm / Cancel / Close affordances, reach for [`DialogButtons`](/api/overlay/variables/DialogButtons) instead of respelling the `{text, result, glyph, tint}` quad at the call site. The presets bind the glyph (`circle-check` for the affirmative pair, `xmark` for the negative pair) and the matching tint to the button's identity so they cannot drift, and the dialog header is auto-tinted based on which presets you supply: a single confirm-result button gets a blue informational header with a leading info glyph, a confirm + cancel pair gets a green affirmative-action header.

`Ok` and `Confirm` both emit `result: 'confirm'` — they share the glyph and tint and differ only in label. Pick `Ok` for informational acknowledgement (paired with nothing) and `Confirm` for affirmative action (paired with `Cancel`). `Close` and `Cancel` both carry the red `xmark`; the result value (`'close'` vs `'cancel'`) is what disambiguates them at the call site.

```typescript
import { Dialog, DialogButtons } from '@jimka/typescript-ui/overlay';

// Single Ok (blue/info header, leading circle-info glyph) — the default
// when DialogConfig.buttons is omitted
await Dialog.show({
    title:   'Settings saved',
    message: 'Your preferences have been updated.',
    buttons: [{ ...DialogButtons.Ok, primary: true }],
});

// Confirm + Cancel (green/affirm header)
await Dialog.show({
    title:   'Apply changes?',
    message: 'The new layout will replace the current one.',
    buttons: [
        { ...DialogButtons.Cancel, primary: true },
        DialogButtons.Confirm,
    ],
});
```

The `primary` flag stays at the call site because which button is default-focused is contextual (Cancel is primary when paired with Confirm so Enter doesn't fire a destructive action; Confirm / Ok is primary when it stands alone).

If you build a custom button outside the preset set and want a tinted glyph, the [`tint`](/api/overlay/interfaces/DialogButtonConfig#tint) field on [`DialogButtonConfig`](/api/overlay/interfaces/DialogButtonConfig) accepts any CSS colour string — typically a theme variable reference like `'var(--ts-ui-dialog-confirm-color)'`.

## Confirm a destructive action

```typescript
import { Dialog } from '@jimka/typescript-ui/overlay';

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
import { Dialog } from '@jimka/typescript-ui/overlay';

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
- [API: DialogConfig](/api/overlay/interfaces/DialogConfig), [DialogButtonConfig](/api/overlay/interfaces/DialogButtonConfig), [DialogResult](/api/overlay/type-aliases/DialogResult)
- [Floating window](/recipes/floating-window) — for non-modal panels
