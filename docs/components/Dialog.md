# Dialog

[`Dialog`](/api/core/classes/Dialog) is a modal panel with a title bar, scrollable content area, and a button row. The static `Dialog.show(config)` returns a `Promise<DialogResult>` resolving to `'confirm'`, `'cancel'`, or `'close'`.

## One-shot prompt

```typescript
import { Dialog } from '@jimka/typescript-ui/core';
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
import { Component, Dialog } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { TextField } from '@jimka/typescript-ui/component/input';
const nameField = TextField();
const form = Component({
    layoutManager: VBox(),
    components:    [nameField],
});

const result = await Dialog.show({
    title:            'Rename file',
    contentComponent: form,
    buttons: [
        { text: 'Save',   result: 'confirm', primary: true },
        { text: 'Cancel', result: 'cancel'  },
    ],
});
```

## Entrance + dismiss animation

Opening a dialog fades the panel in from `opacity: 0` + `scale(0.97)` to `opacity: 1` + `scale(1)` over 150ms; the backdrop fades in lockstep. Closing reverses the same transition — fade out + slight scale-down. `prefers-reduced-motion: reduce` skips both transitions: the dialog snaps in on open and is removed synchronously on close.

## Decorating the title bar

`Dialog.getTitleBar()` returns the title-bar component for callers that need to tint or decorate the header — for example, the notification detail dialog paints the title bar with the severity's colour tokens and mounts a matching glyph:

```typescript
const dialog = Dialog({ title: 'Information', /* … */ });
const titleBar = dialog.getTitleBar();

titleBar.setBackgroundColor('var(--ts-ui-notification-info-bg)');
titleBar.getTitleText().setForegroundColor('var(--ts-ui-notification-info-border)');
titleBar.setGlyph('info-circle');
```

See [`DialogTitleBar`](/api/core/classes/DialogTitleBar) for the supported surface.

## DialogConfig

See [`DialogConfig`](/api/core/interfaces/DialogConfig) for the full option list. Highlights:

| Option | Default | Purpose |
| --- | --- | --- |
| `title` | (required) | Title-bar text. |
| `message` | — | Plain-text body (ignored when `contentComponent` is set). |
| `contentComponent` | — | Custom component for the body. |
| `buttons` | One `OK` button (with a `circle-check` glyph) | Footer button definitions. |
| `width` / `height` | `480` / auto (clamped to `320 × 160` minimums) | Dialog panel size in pixels. |
| `closeOnBackdrop` | `false` | Click outside dismisses with result `'close'`. |

### Per-button glyph

Each [`DialogButtonConfig`](/api/core/interfaces/DialogButtonConfig) carries an optional `glyph` field — a registry [`Glyph`](/components/Glyph) name rendered to the left of the button label. The bundled defaults pair `check-circle` with `OK` / `Confirm` and `times` with `Cancel`:

```typescript
await Dialog.show({
    title:   'Delete record',
    message: 'This cannot be undone.',
    buttons: [
        { text: 'Cancel',  result: 'cancel',  glyph: 'times'         },
        { text: 'Delete',  result: 'confirm', glyph: 'ban', primary: true },
    ],
});
```

## See also

- [API: Dialog](/api/core/classes/Dialog)
- [API: DialogTitleBar](/api/core/classes/DialogTitleBar)
- [API: DialogConfig](/api/core/interfaces/DialogConfig), [DialogButtonConfig](/api/core/interfaces/DialogButtonConfig), [DialogResult](/api/core/type-aliases/DialogResult)
