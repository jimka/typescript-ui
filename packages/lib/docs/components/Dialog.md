# Dialog

[`Dialog`](/api/overlay/classes/Dialog) is a modal panel with a title bar, scrollable content area, and a button row. The static `Dialog.show(config)` returns a `Promise<DialogResult>` resolving to `'confirm'`, `'cancel'`, or `'close'`.

## One-shot prompt

```typescript
import { Dialog } from '@jimka/typescript-ui/overlay';

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
import { Component } from '@jimka/typescript-ui/core';
import { Dialog } from '@jimka/typescript-ui/overlay';

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

## Severity tone

Set `severity` to `'info'`, `'success'`, `'warning'`, or `'error'` to tint the title bar and show a matching leading glyph. An explicit severity overrides the tone otherwise derived from the buttons, so an error dialog reads as one regardless of its footer:

```typescript
await Dialog.show({
    title:    'Connection failed',
    message:  'Host not allowed.',
    severity: 'error',
    buttons:  [{ text: 'OK', result: 'confirm', primary: true }],
});
```

`Dialog.info`, `Dialog.success`, `Dialog.warning`, and `Dialog.error` are one-shot conveniences for exactly that — a severity-toned dialog with a single OK button, resolving when the user acknowledges it:

```typescript
await Dialog.error('Connection failed', 'Host not allowed.');
await Dialog.success('Saved', 'Your changes have been stored.');
await Dialog.warning('Unsaved changes', 'They will be lost if you continue.');
await Dialog.info('Import complete', 'Loaded 1,204 rows.');
```

## Decorating the title bar

For tones beyond the four severities, `Dialog.getTitleBar()` returns the title-bar component so callers can tint or decorate the header directly:

```typescript
const dialog = Dialog({ title: 'Information', /* … */ });
const titleBar = dialog.getTitleBar();

titleBar.setBackgroundColor('var(--ts-ui-notification-info-bg)');
titleBar.getTitleText().setForegroundColor('var(--ts-ui-notification-info-border)');
titleBar.setGlyph('info-circle');
```

See [`DialogTitleBar`](/api/overlay/classes/DialogTitleBar) for the supported surface.

## DialogConfig

See [`DialogConfig`](/api/overlay/interfaces/DialogConfig) for the full option list. Highlights:

| Option | Default | Purpose |
| --- | --- | --- |
| `title` | (required) | Title-bar text. |
| `message` | — | Plain-text body (ignored when `contentComponent` is set). |
| `contentComponent` | — | Custom component for the body. |
| `buttons` | One `OK` button (with a `circle-check` glyph) | Footer button definitions. |
| `width` / `height` | `480` / auto (clamped to `320 × 160` minimums) | Dialog panel size in pixels. |
| `closeOnBackdrop` | `false` | Click outside dismisses with result `'close'`. |
| `dismissable` | `true` | When `false`, mandatory modal: no title-bar close button, Escape/backdrop inert. |
| `severity` | — | Title-bar tone (`'info'` / `'success'` / `'warning'` / `'error'`); tints the header and shows a matching glyph, overriding the button-derived tone. |
| `initialFocus` | — | Component to focus on open, overriding the default (the first focusable element in the body). |

### Initial focus

A dialog focuses itself when it opens, so a form is ready to type into and Enter
confirms it. The default order is the first focusable element in the body, then
the primary button — which means a dialog whose body is a form needs no wiring at
all:

```typescript
const name = new TextField({ placeholder: 'Query name' });
const body = Panel({ layoutManager: new Fit() });
body.addComponent(name);

// `name` takes focus on open — it is the first focusable element in the body.
await Dialog.show({
    title:            'Save query as',
    contentComponent: body,
    buttons:          [DialogButtons.Cancel, { ...DialogButtons.Confirm, primary: true }],
});
```

Set `initialFocus` when the field that should take focus is not the first one:

```typescript
await Dialog.show({
    title:            'Connect',
    contentComponent: form,
    initialFocus:     passwordField,   // host is prefilled; start on the password
});
```

### Per-button glyph

Each [`DialogButtonConfig`](/api/overlay/interfaces/DialogButtonConfig) carries an optional `glyph` field — a registry [`Glyph`](/components/Glyph) name rendered to the left of the button label. The bundled defaults pair `check-circle` with `OK` / `Confirm` and `times` with `Cancel`:

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

- [API: Dialog](/api/overlay/classes/Dialog)
- [API: DialogTitleBar](/api/overlay/classes/DialogTitleBar)
- [API: DialogConfig](/api/overlay/interfaces/DialogConfig), [DialogButtonConfig](/api/overlay/interfaces/DialogButtonConfig), [DialogResult](/api/overlay/type-aliases/DialogResult)
