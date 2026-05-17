# Button

[`Button`](/api/component/button/classes/Button) is a push button with a text label and configurable pressed- and hover-state appearance. Maintains separate CSS rules for the normal, `:hover:not(:active)`, and `:active` states so border, shadow, background, and foreground colour are independently controllable when the pointer is over the button and when it is pressed.

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { Button } from '@jimka/typescript-ui/component/button';
const saveButton = Button('Save');
Event.addListener(saveButton, 'click', () => save());

panel.addComponent(saveButton);
```

## Theming

Buttons are themed via the `button.*` token group — see [Theming › Theme keys](/concepts/theming#theme-keys). Pressed state is controlled by `button.pressed.*` tokens; hover state by `button.hover.*` tokens.

For one-off styling, every pressed-state property has a per-instance setter:

```typescript
button.setPressedBackgroundColor('rgb(60, 120, 200)');
button.setPressedForegroundColor('white');
button.setPressedBorderRadius('8px');
```

## Hover state

The hover treatment uses a `:hover:not(:active)` rule so the pressed treatment always wins on click, regardless of stylesheet insertion order. Disabled buttons (`button.setEnabled(false)`) receive no hover treatment because the browser suppresses `:hover` on `<button disabled>`.

Every hover-state property has a matching per-instance setter:

```typescript
button.setHoverBackgroundColor('rgb(245, 245, 255)');
button.setHoverShadow('0 4px 10px rgba(0, 0, 0, 0.3)');
```

Construction-time hover overrides go through the options bag:

```typescript
Button('Save', {
    hoverBackgroundColor: 'rgb(245, 245, 255)',
    hoverShadow         : '0 4px 10px rgba(0, 0, 0, 0.3)',
});
```

The full setter / getter list is in the [API reference](/api/component/button/classes/Button).

## Notes

- The label is a child [`Label`](/api/component/input/classes/Label); it inherits the button's foreground colour and theme font size.
- `setText(text)` updates the label.
- For toggle behavior (selected / unselected) use [`ToggleButton`](/components/ToggleButton).
- For radio-group behavior use [`RadioButton`](/components/RadioButton) plus [`ButtonGroup`](/components/ButtonGroup).

## See also

- [API: Button](/api/component/button/classes/Button)
- [`ToggleButton`](/components/ToggleButton)
- [`SpinButton`](/components/SpinButton)
- [`TabCloseButton`](/components/TabCloseButton)
