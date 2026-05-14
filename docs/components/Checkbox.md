# Checkbox

[`Checkbox`](/api/classes/Checkbox) is a boolean toggle backed by an `<input type="checkbox">` element. It implements [`Bindable<boolean>`](/api/interfaces/Bindable), so it can participate in a [`Binding`](/data/binding) directly.

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { Checkbox } from '@jimka/typescript-ui/component/input';
const subscribe = new Checkbox();
subscribe.setSelected(true);

Event.addListener(subscribe, 'change', () => {
    console.log('checked:', subscribe.isSelected());
});

panel.addComponent(subscribe);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `isSelected()` / `setSelected(boolean)` | Read / write checked state. |
| `getValue()` / `setValue(boolean)` | Bindable interface — same as `isSelected` / `setSelected`. |
| `addBindingListener(fn)` | Subscribe to user-driven changes (used by `Binding`). |

## Notes

- The checkbox is a leaf component — it has no built-in label. Pair it with a [`Label`](/components/Label) or place it in an [`HBox`](/api/classes/HBox) with surrounding text.
- For an indeterminate "tri-state" appearance, set the DOM property directly via `getElement()` after render.

## See also

- [API: Checkbox](/api/classes/Checkbox)
- [`RadioButton`](/components/RadioButton) — single-selection alternative
- [Data binding](/data/binding)
