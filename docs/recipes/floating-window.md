# Floating window with custom content

Build a draggable, resizable [`Window`](/components/Window) with a form inside.

## Goal

A floating "Settings" window with two text fields and Save / Cancel buttons. Closing the window via the × button hides it without destroying state, so reopening preserves the user's edits.

## Construct the window

```typescript
import { Body, Window, Component, Event } from '@jimka/typescript-ui/core';
import { Placement } from '@jimka/typescript-ui/primitive';
import { VBox, HBox } from '@jimka/typescript-ui/layout';
import { Label, TextField } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';
const urlField = TextField();
urlField.setValue('https://api.example.com');

const keyField = TextField();

const saveBtn   = Button('Save');
const cancelBtn = Button('Cancel');

const settingsWin = Window('Settings');
settingsWin.setSize(400, 280);
settingsWin.setPosition(200, 100);

settingsWin.addComponents(
    {
        component: Component({
            layoutManager: VBox(),
            components: [
                Label('Server URL:', urlField.getId()), urlField,
                Label('API key:',    keyField.getId()), keyField
            ]
        }),
        constraints: { region: Placement.CENTER }
    },
    {
        component: Component({
            layoutManager: HBox(),
            components: [saveBtn, cancelBtn]
        }),
        constraints: { region: Placement.SOUTH }
    }
);
```

`Window` ships its own Border layout already, so the form and footer just slot into `CENTER` / `SOUTH` regions. The fields and buttons are pulled out into named consts because the handlers below reference them; everything else (labels, containers, layout managers) is declared inline.

## Show / hide instead of destroy

```typescript
Body.getInstance().addComponent(settingsWin);
settingsWin.setVisible(false);  // hidden until requested

const openBtn = Button('Settings…');
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
