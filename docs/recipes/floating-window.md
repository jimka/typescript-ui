# Floating window with custom content

Build a draggable, resizable [`Window`](/components/Window) with a form inside.

## Goal

A floating "Settings" window with two text fields and Save / Cancel buttons. Closing the window via the × button hides it without destroying state, so reopening preserves the user's edits.

## Construct the window

```typescript
import {
    Body, Window, BorderLayout, Placement,
    VBox, HBox, Label, TextField, Button,
    Event,
} from '@jimka/typescript-ui';

const settingsWin = new Window();
settingsWin.setHeaderText('Settings');
settingsWin.setSize(400, 280);
settingsWin.setPosition(200, 100);
settingsWin.setLayoutManager(new BorderLayout());
```

## Add form content

```typescript
const form = new VBox();

const urlField = new TextField();
urlField.setValue('https://api.example.com');

const keyField = new TextField();

form.addComponent(new Label('Server URL:', urlField.getId()));
form.addComponent(urlField);
form.addComponent(new Label('API key:', keyField.getId()));
form.addComponent(keyField);

settingsWin.addComponent(form, { region: Placement.CENTER });
```

## Add a footer with buttons

```typescript
const footer = new HBox();
const saveBtn   = new Button('Save');
const cancelBtn = new Button('Cancel');
footer.addComponent(saveBtn);
footer.addComponent(cancelBtn);

settingsWin.addComponent(footer, { region: Placement.SOUTH });
```

## Show / hide instead of destroy

```typescript
Body.getInstance().addComponent(settingsWin);
settingsWin.setVisible(false);  // hidden until requested

const openBtn = new Button('Settings…');
Event.addListener(openBtn, 'click', () => {
    settingsWin.setVisible(true);
    settingsWin.show();           // brings to front
});

settingsWin.addExitActionListener(() => {
    settingsWin.setVisible(false); // hide instead of destroy
});

Event.addListener(saveBtn,   'click', () => {
    saveSettings(urlField.getValue(), keyField.getValue());
    settingsWin.setVisible(false);
});
Event.addListener(cancelBtn, 'click', () => settingsWin.setVisible(false));
```

The `show()` call activates the window (raises its z-index, marks it active). `setVisible(false)` only hides; reopening preserves state.

## Notes

- `Window` appends to `document.documentElement` so it can layer above any backdrop. This is also why theme tokens cascade from `<html>` rather than `<body>` — see [Theming](/concepts/theming#how-it-works).
- For a one-shot prompt that returns a value, use [`Dialog`](/recipes/dialog-modal) instead.
- For multiple windows, each one tracks its own activation. Clicking outside the active window deactivates it.

## See also

- [Window](/components/Window)
- [Dialog modal with async result](/recipes/dialog-modal)
