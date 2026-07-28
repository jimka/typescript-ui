# Checkbox

[`Checkbox`](/api/component/input/classes/Checkbox) is a boolean toggle rendered as a focusable `<div>` with `role="checkbox"` plus a custom-drawn box and check glyph — no native `<input>`. Carries an `indeterminate` (mixed) state for tri-state forms, and implements [`Bindable<boolean>`](/api/core/interfaces/Bindable).

## Usage

```typescript
import { Checkbox } from '@jimka/typescript-ui/component/input';
const subscribe = Checkbox({ label: 'Subscribe', value: true });

subscribe.on("change", on => {
    console.log('subscribed:', on);
});

panel.addComponent(subscribe);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `isSelected()` / `setSelected(boolean)` | Read / write checked state. |
| `getValue()` / `setValue(boolean)` | Bindable interface — same as `isSelected` / `setSelected`. |
| `isIndeterminate()` / `setIndeterminate(boolean)` | Mixed-state for tri-state forms. |
| `getLabel()` / `setLabel(text \| null)` | Optional inline label. |
| `isEnabled()` / `setEnabled(boolean)` | Toggle interactivity. |
| `isReadOnly()` / `setReadOnly(boolean)` | Stays focusable but ignores user-driven changes. |
| `on("change", fn)` / `off("change", fn)` | Subscribe to value changes. |
| `on("binding", fn)` | Used by [`Binding`](/data/binding). |
| `on("action", fn)` | Subscribe to the click action. |

## Indeterminate / mixed state

Setting `setIndeterminate(true)` shows a horizontal bar in place of the check and emits `aria-checked="mixed"`. A user click from the mixed state first clears the indeterminate flag and selects the checkbox (matching the WAI-ARIA Authoring Practices recommendation).

<!-- demo: checkbox-states -->
> **Live demo** — an unchecked, a checked, and a cycling `Checkbox`, plus a
> button that steps the third through all three states.
> [Open the Checkbox page](https://jimka.github.io/typescript-ui/components/Checkbox)
<!-- /demo -->

## Notes

- Themed through the shared `--ts-ui-form-*` family plus checkbox-specific tokens (`--ts-ui-checkbox-bg`, `--ts-ui-checkbox-bg-selected`, `--ts-ui-checkbox-check-color`, `--ts-ui-checkbox-size`, `--ts-ui-checkbox-radius`).
- Keyboard: Space toggles the checked state.
- Honours [`Animation.isReducedMotion`](/api/core/namespaces/Animation/functions/isReducedMotion) — the check / dash crossfade is suppressed when set.

## See also

- [API: Checkbox](/api/component/input/classes/Checkbox)
- [`Toggle`](/components/Toggle) — sliding-pill switch alternative
- [`RadioButton`](/components/RadioButton) — single-selection alternative
- [Data binding](/data/binding)
