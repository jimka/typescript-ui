# ButtonGroup

[`ButtonGroup`](/api/core/classes/ButtonGroup) enforces single-selection across a set of [`RadioButton`](/components/RadioButton) or [`ToggleButton`](/components/ToggleButton) instances.

When any button in the group becomes selected, the others are automatically deselected. For radio groups, a shared `name` attribute is applied so the browser handles keyboard navigation natively. For toggle groups, call `setContainer` to enable roving-tabindex keyboard nav.

## Usage — radio group

```typescript
import { ButtonGroup } from '@jimka/typescript-ui/core';
import { RadioButton } from '@jimka/typescript-ui/component/input';
const small  = RadioButton('Small');
const medium = RadioButton('Medium');
const large  = RadioButton('Large');

const group = ButtonGroup();
group.addButton(small);
group.addButton(medium);
group.addButton(large);
```

## Usage — toggle group with keyboard nav

```typescript
import { ButtonGroup, Component } from '@jimka/typescript-ui/core';
import { HBox } from '@jimka/typescript-ui/layout';
import { ToggleButton } from '@jimka/typescript-ui/component/button';
const left   = ToggleButton('Left');
const center = ToggleButton('Center');
const right  = ToggleButton('Right');

const toolbar = Component({
    layoutManager: HBox(),
    components:    [left, center, right],
});

const group = ButtonGroup();
group.addButton(left);
group.addButton(center);
group.addButton(right);
group.setContainer(toolbar); // enables roving tabindex
```

## Listening for changes

```typescript
group.on("selection", button => {
    console.log('selected:', button.getText());
});
```

## Common methods

| Method | Purpose |
| --- | --- |
| `addButton(button)` | Add a `RadioButton` or `ToggleButton` to the group. |
| `setContainer(component)` | Wire roving tabindex (toggle groups only). |
| `on("selection", fn)` | Subscribe to selection changes. |
| `getSelected()` | Return the currently selected button or `null`. |

## See also

- [API: ButtonGroup](/api/core/classes/ButtonGroup)
- [`RadioButton`](/components/RadioButton)
- [`ToggleButton`](/components/ToggleButton)
- [`RovingTabIndex`](/api/core/classes/RovingTabIndex) — the keyboard-nav primitive used internally.
