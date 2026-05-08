# ToggleButton

[`ToggleButton`](/api/classes/ToggleButton) is a [`Button`](/components/Button) that switches between selected and unselected states on each click. Maintains a separate CSS rule for the `.selected` class so the active state can be styled independently.

## Usage

```typescript
import { ToggleButton, Event } from '@jika/typescript-ui';

const boldButton = new ToggleButton('Bold');

Event.addListener(boldButton, 'change', () => {
    if (boldButton.isSelected()) {
        applyBold();
    } else {
        removeBold();
    }
});

toolbar.addComponent(boldButton);
```

The `change` event fires whenever the selection state flips.

## Common methods

| Method | Purpose |
| --- | --- |
| `isSelected()` | Returns the current selection state. |
| `setSelected(boolean)` | Programmatically set / clear the selection (does **not** fire `change`). |
| `addBindingListener(fn)` | Subscribe to user-driven changes (used by `Binding`). |

## Mutual exclusivity

Wrap multiple `ToggleButton`s in a [`ButtonGroup`](/components/ButtonGroup) to enforce single-selection semantics across the group. The group will deselect siblings whenever one button becomes selected.

## Theming

Selected-state appearance comes from the `toggle.selected.*` token group — see [Theming › Theme keys](/concepts/theming#theme-keys).

## See also

- [API: ToggleButton](/api/classes/ToggleButton)
- [`Button`](/components/Button) — base class
- [`ButtonGroup`](/components/ButtonGroup) — single-selection enforcement
- [`RadioButton`](/components/RadioButton) — for native radio semantics
