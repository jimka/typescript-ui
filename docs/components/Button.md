# Button

[`Button`](/api/classes/Button) is a push button with a text label and a configurable pressed-state appearance. Maintains separate CSS rules for the normal and `:active` states so border, shadow, background, and foreground colour are independently controllable when pressed.

## Usage

```typescript
import { Button, Event } from '@jika/typescript-ui';

const saveButton = new Button('Save');
Event.addListener(saveButton, 'click', () => save());

panel.addComponent(saveButton);
```

## Theming

Buttons are themed via the `button.*` token group — see [Theming › Theme keys](/concepts/theming#theme-keys). Pressed state is controlled by `button.pressed.*` tokens.

For one-off styling, every pressed-state property has a per-instance setter:

```typescript
button.setPressedBackgroundColor('rgb(60, 120, 200)');
button.setPressedForegroundColor('white');
button.setPressedBorderRadius('8px');
```

The full setter / getter list is in the [API reference](/api/classes/Button).

## Notes

- The label is a child [`Label`](/api/classes/Label); it inherits the button's foreground colour and theme font size.
- `setText(text)` updates the label.
- For toggle behavior (selected / unselected) use [`ToggleButton`](/components/ToggleButton).
- For radio-group behavior use [`RadioButton`](/components/RadioButton) plus [`ButtonGroup`](/components/ButtonGroup).

## See also

- [API: Button](/api/classes/Button)
- [`ToggleButton`](/components/ToggleButton)
- [`SpinButton`](/components/SpinButton)
- [`TabCloseButton`](/components/TabCloseButton)
