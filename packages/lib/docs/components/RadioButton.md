# RadioButton

[`RadioButton`](/api/component/input/classes/RadioButton) is a single-selection input rendered as a focusable `<div>` with `role="radio"` plus a custom-drawn ring and dot — no native `<input>`. It implements [`Bindable<boolean>`](/api/core/interfaces/Bindable) and is normally used inside a [`ButtonGroup`](/components/ButtonGroup) to enforce mutual exclusivity.

<!-- demo: radiobutton-group -->
> **Live demo** — three `RadioButton`s stacked in a `ButtonGroup`; arrow keys
> move the selection.
> [Open the RadioButton page](https://jimka.github.io/typescript-ui/components/RadioButton)
<!-- /demo -->

## Usage

```typescript
import { ButtonGroup } from '@jimka/typescript-ui/overlay';

import { RadioButton } from '@jimka/typescript-ui/component/input';
const small  = RadioButton('Small');
const medium = RadioButton('Medium');
const large  = RadioButton('Large');

const group = ButtonGroup();
group.addButton(small);
group.addButton(medium);
group.addButton(large);

medium.setSelected(true);

[small, medium, large].forEach(rb => {
    rb.on("change", selected => {
        if (selected) console.log('chose', rb.getLabel());
    });
});

panel.addComponent(small);
panel.addComponent(medium);
panel.addComponent(large);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `isSelected()` / `setSelected(boolean)` | Read / write selection state. |
| `getValue()` / `setValue(boolean)` | Bindable interface alias. |
| `getLabel()` / `setLabel(text \| null)` | Inline label text. |
| `isEnabled()` / `setEnabled(boolean)` | Toggle interactivity. |
| `isReadOnly()` / `setReadOnly(boolean)` | Stays focusable but ignores user input. |
| `on("change", fn)` / `off("change", fn)` | Subscribe to selection changes. |
| `on("binding", fn)` | Used by [`Binding`](/data/binding). |

## Group navigation

Now that radios are no longer native `<input type="radio">`, the browser does not handle arrow-key navigation for free. Wire a container on the group with [`ButtonGroup.setContainer`](/api/overlay/classes/ButtonGroup#setcontainer) to enable Arrow / Home / End traversal via [`RovingTabIndex`](/api/core/classes/RovingTabIndex):

```typescript
const groupRow = Component();
group.setContainer(groupRow); // arrow keys now move focus within the group
```

## Notes

- Themed through the shared `--ts-ui-form-*` family plus radio-specific tokens (`--ts-ui-radio-bg`, `--ts-ui-radio-bg-selected`, `--ts-ui-radio-dot-color`, `--ts-ui-radio-size`).
- Keyboard: Space selects the focused radio.
- `setRadioName` / `getRadioName` are retained as back-compat shims — they store the supplied name on the options bag but no longer drive grouping (the new control has no shared `name` attribute).

## See also

- [API: RadioButton](/api/component/input/classes/RadioButton)
- [`ButtonGroup`](/components/ButtonGroup)
- [`ToggleButton`](/components/ToggleButton) — push-button alternative for non-radio toggles
