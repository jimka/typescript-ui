# Dialog

[`Dialog`](/api/overlay/classes/Dialog) is a modal panel with a title bar, scrollable content area, and a button row. The static `Dialog.show(config)` returns a `Promise<DialogResult>` resolving to `'confirm'`, `'cancel'`, or `'close'`.

<!-- demo: dialog-basic -->
> **Live demo** — a button that opens a modal `Dialog` with a message and
> two buttons; the result is echoed below.
> [Open the Dialog page](https://jimka.github.io/typescript-ui/components/Dialog)
<!-- /demo -->

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

The message body is selectable, and a right-click offers a Copy row for the selected text. Custom content (see below) is not, unless the consumer's own components provide it.

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

`Dialog.warning`, `Dialog.error` and `Dialog.confirm` are announced by a screen reader as alert dialogs; `Dialog.info` and `Dialog.success` as plain dialogs. Setting `severity` yourself does not change how a dialog is announced — see [Screen readers](#screen-readers).

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
| `role` | `'dialog'` | How a screen reader announces the dialog. `'alertdialog'` is for a message that interrupts and needs an answer. |
| `ariaLabel` | the title | Accessible name, replacing the title as the name a screen reader announces. |
| `closeButtonLabel` | `"Close"`, or the application's `strings.dialogClose` | Accessible name and tooltip of the title-bar close button, for this dialog. |

### Initial focus

A dialog focuses itself when it opens, so a form is ready to type into and Enter
confirms it. The default order is the first focusable element in the body, then
the primary button, then the first focusable element anywhere in the dialog —
which means a dialog whose body is a form needs no wiring at all. A dialog with
nothing focusable takes focus on its own element, rather than leaving it on the
control that opened it:

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

An `initialFocus` component that is hidden or disabled when the dialog opens is
skipped, and the default order applies. A dialog is announced when focus enters
it, so focus always lands somewhere inside.

In an alert dialog, mark the least destructive button `primary`. A message body
holds nothing focusable, so the primary button is where focus lands, and it is
the first thing a screen reader names after the message. `Dialog.confirm` does
this for Cancel.

### Keyboard

While a dialog is open, the rest of the application is inert: it cannot be
focused, clicked or read by a screen reader. That covers every component added
to [`Body`](/components/Body), every window and other layer the dialog was not
opened from, the [`Rail`](/components/Rail), and the dismiss button of each
toast. `Tab` and `Shift+Tab` wrap inside the dialog: tabbing past the last
control goes to the first, and shift-tabbing off the first goes to the last. A
dropdown, menu or popover opened from the dialog is part of it, so `Tab` reaches
it and wraps back into the dialog.

The library marks its own containers, never the `<body>` element. Anything else
in the document stays usable while the dialog is open: the inline menu a
password manager shows beside a login field, for example. The same holds for an
element your own code appends to `<body>` by hand, which is therefore still
reachable. Build an overlay of your own as a [`Popover`](/components/Popover)
or [`PopupPanel`](/components/PopupPanel) and it takes part like any other
layer; see [Modal scope](/concepts/layering#modal-scope).

When the dialog closes, focus returns to the element that had it when the
dialog opened. If that element was disposed or removed from the page while
the dialog was open, focus stays on the page instead.

With [focus history](/recipes/focus-history) enabled, a dialog's controls are
not recorded, `Alt+[` / `Alt+]` do nothing while the dialog is open, and the
trail is as it was once the dialog has closed.

An editing surface or a [`Table`](/components/Table) hosted in the dialog
keeps `Tab` while focus is inside it — the editor indents, the table steps from
cell to cell — and the wrap stands down rather than moving focus out from under
it. To leave an editing surface such as a
[`CodeEditor`](/components/CodeEditor) or
[`MarkdownEditor`](/components/MarkdownEditor), press `Escape`. Inside the
surface, `Escape` does not close the dialog; it releases the surface, so the
next `Tab` or `Shift+Tab` moves to the dialog's next or previous control,
wrapping inside the dialog. A second `Escape` closes the dialog and restores
focus to wherever it was before it opened. Any other key cancels the release.
A mandatory modal (`dismissable: false`) releases the surface the same way,
but still ignores the second `Escape`.

A `Table` gets the same first `Escape`, which does not close the dialog, but
leaving it with `Tab` is not reliable yet: the table's own `Tab` handling can
move focus back into the table after the dialog moves it out, and an open cell
editor cancels the release. Give a dialog that hosts a `Table` a plain control
at each end if a keyboard user needs to reach it with `Tab`.

### Screen readers

A dialog tells assistive technology what it is, what it is called and what it
says. A screen reader announces all three when the dialog opens.

**Role.** `role` in the config is `'dialog'` by default. `'alertdialog'` is for
a message that interrupts the user and needs an answer: a confirmation, a
warning, an error. Three shortcuts ask for it; nothing else is inferred, and
`severity` alone does not change the role.

| Call | Role |
| --- | --- |
| `Dialog.show({ title, message })`, `new Dialog(config)` | `dialog` |
| `Dialog.info(…)`, `Dialog.success(…)` | `dialog` |
| `Dialog.confirm(…)`, `Dialog.warning(…)`, `Dialog.error(…)` | `alertdialog` |
| `Dialog.show({ …, role: 'alertdialog' })` | `alertdialog` |

**Name.** The dialog is named by its title. The name is a reference to the
title text, so it follows a later
`dialog.getTitleBar().getTitleText().setText(…)`. `ariaLabel` replaces the
title as the name; use it when the title is too short to say what the dialog is
about. A dialog with an empty `title` has no name unless it sets `ariaLabel`.

```typescript
await Dialog.show({
    title:     'Delete?',
    message:   'Record 42 will be removed. This cannot be undone.',
    role:      'alertdialog',
    ariaLabel: 'Delete record 42',
    buttons:   [{ ...DialogButtons.Cancel, primary: true }, DialogButtons.Confirm],
});
```

**Description.** A `message` is the dialog's description, read after the name
and role, so a prompt is understood without exploring it. A dialog built from a
`contentComponent` has no description, because a description is read as one
flat string and a form or a table is not one. To describe such a dialog with a
line of text it shows, construct it and point at that text:

```typescript
const dialog = new Dialog({ title: 'Import rows', contentComponent: body });

dialog.getAria().setDescribedBy(summaryText.getId());
await dialog.show();
```

**Close button.** The title-bar close button is named "Close" and shows that
name as a tooltip. `closeButtonLabel` renames it for one dialog and works with
`Dialog.show(config)`. `Body.init({ strings: { dialogClose: … } })` renames it
for every dialog, including the ones `Dialog.confirm`, `info`, `success`,
`warning` and `error` build. The first non-empty value wins:

| `closeButtonLabel` | `strings.dialogClose` | Name |
| --- | --- | --- |
| not set | not set | `Close` |
| not set | `'Stäng'` | `Stäng` |
| `'Discard'` | `'Stäng'` | `Discard` |
| `''` | `'Stäng'` | `Stäng` |
| not set | `''` | `Close` |
| `'Discard'`, with `dismissable: false` | any | no close button exists |

An empty string counts as not set at both levels, so the button is never left
without a name. To rename the button of a constructed dialog afterwards, call
`dialog.getTitleBar().getCloseButton()?.setText(…)`.

`role`, `ariaLabel` and `closeButtonLabel` are read once, when the dialog is
constructed. After that the values live in `dialog.getAria()` and on the
button.

A dialog does not carry `aria-modal`. It is modal because everything outside it
is inert, which already takes the page away from a screen reader. See
[Why no `aria-modal`](/concepts/accessibility#why-no-aria-modal) for why the
attribute is left out.

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
