# Toggle

[`Toggle`](/api/component/input/classes/Toggle) is a custom-drawn on/off switch widget — the sliding-pill control familiar from system settings UIs. It implements [`Bindable<boolean>`](/api/core/interfaces/Bindable), so it can participate in a [`Binding`](/data/binding) directly.

`Toggle` is not the same widget as [`ToggleButton`](/components/ToggleButton). `ToggleButton` is a push-button that stays pressed; `Toggle` is the iOS-style sliding switch with `role="switch"`.

## Usage

```typescript
import { Toggle } from '@jimka/typescript-ui/component/input';
const wifi = Toggle({ label: 'Wi-Fi', value: true });

wifi.addChangeListener(on => {
    console.log('wifi is now', on ? 'on' : 'off');
});

panel.addComponent(wifi);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` / `setValue(boolean)` | Read / write the on/off state. |
| `clearValue()` | Reset to off. |
| `getLabel()` / `setLabel(text \| null)` | Optional inline label. |
| `isEnabled()` / `setEnabled(boolean)` | Toggle interactivity; `false` removes keyboard focus. |
| `isReadOnly()` / `setReadOnly(boolean)` | Stays focusable but ignores user-driven changes. |
| `addChangeListener(fn)` / `removeChangeListener(fn)` | Subscribe to value changes. |
| `addBindingListener(fn)` | Used by [`Binding`](/data/binding). |

## Notes

- Themed through the shared `--ts-ui-form-*` family plus toggle-specific tokens (`--ts-ui-toggle-track-bg-off`, `--ts-ui-toggle-track-bg-on`, `--ts-ui-toggle-thumb-bg`, `--ts-ui-toggle-width`, `--ts-ui-toggle-height`).
- Keyboard: Space and Enter both toggle the value.
- Honours [`Animation.isReducedMotion`](/api/core/namespaces/Animation/functions/isReducedMotion) — when set, the thumb-slide and track-color transitions are suppressed.

## See also

- [API: Toggle](/api/component/input/classes/Toggle)
- [`Checkbox`](/components/Checkbox) — boolean field for forms
- [`ToggleButton`](/components/ToggleButton) — naming sibling, but a press-button rather than a switch
