# RadioButton

[`RadioButton`](/api/classes/RadioButton) is a single-selection input composed of an `<input type="radio">` and an associated [`Label`](/components/Label). Clicking the label toggles the radio because the label's `for` attribute is wired to the input's ID.

`RadioButton` is meant to be used inside a [`ButtonGroup`](/components/ButtonGroup), which enforces the mutual-exclusivity contract.

## Usage

```typescript
import { ButtonGroup, Event } from '@jimka/typescript-ui/core';
import { RadioButton } from '@jimka/typescript-ui/component/input';
const small  = new RadioButton('Small');
const medium = new RadioButton('Medium');
const large  = new RadioButton('Large');

const group = new ButtonGroup();
group.addButton(small);
group.addButton(medium);
group.addButton(large);

medium.setSelected(true); // initial selection

[small, medium, large].forEach(rb =>
    Event.addListener(rb, 'change', () => {
        if (rb.isSelected()) console.log('chose', rb.getText());
    })
);

panel.addComponent(small);
panel.addComponent(medium);
panel.addComponent(large);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `isSelected()` / `setSelected(boolean)` | Read / write selection state. |
| `getText()` / `setText(text)` | Label text. |

## Notes

- Without a [`ButtonGroup`](/components/ButtonGroup), each radio acts independently — you'll see multiple selected radios at once. Always wire them through a group.
- The browser handles keyboard navigation natively because all radios in the group share a `name` attribute (set by `ButtonGroup`).

## See also

- [API: RadioButton](/api/classes/RadioButton)
- [`ButtonGroup`](/components/ButtonGroup)
- [`ToggleButton`](/components/ToggleButton) — alternative for non-radio button toggles
