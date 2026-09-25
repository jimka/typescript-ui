# Checkbox

[`Checkbox`](/api/component/input/classes/Checkbox) is a boolean toggle rendered as a focusable `<div>` with `role="checkbox"` plus a custom-drawn box and check glyph — no native `<input>`. Carries an `indeterminate` (mixed) state for tri-state forms, and implements [`Bindable<boolean>`](/api/core/interfaces/Bindable).

<!-- demo: checkbox-states -->
> **Live demo** — an unchecked, a checked, and a cycling `Checkbox`, plus a
> button that steps the third through all three states.
> [Open the Checkbox page](https://jimka.github.io/typescript-ui/components/Checkbox)
<!-- /demo -->

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
| `isSelected()` / `setSelected(boolean)` | Read / write checked state; a programmatic write fires `"change"` and `"binding"`, never `"action"`. |
| `getValue()` / `setValue(boolean)` | Bindable interface — same as `isSelected` / `setSelected`. |
| `isIndeterminate()` / `setIndeterminate(boolean)` | Mixed-state for tri-state forms. |
| `getLabel()` / `setLabel(text \| null)` | Optional inline label. |
| `isEnabled()` / `setEnabled(boolean)` | Toggle interactivity. |
| `isReadOnly()` / `setReadOnly(boolean)` | Stays focusable but ignores user-driven changes. |
| `on("change", fn)` / `off("change", fn)` | Subscribe to value changes. |
| `on("binding", fn)` | Used by [`Binding`](/data/binding). |
| `on("action", fn)` | Subscribe to the user's own toggles — a click on the box, or Space; never fires for `setSelected` / `setValue`, a click on the label, or a disabled checkbox. |

## Indeterminate / mixed state

Setting `setIndeterminate(true)` shows a horizontal bar in place of the check and emits `aria-checked="mixed"`. A user click from the mixed state first clears the indeterminate flag and selects the checkbox (matching the WAI-ARIA Authoring Practices recommendation).

## Programmatic writes and `action`

A checkbox announces `"action"` for the user's own toggle only — a click on its box, or Space. A click on the label or on the space beside the box changes nothing and announces nothing, and neither does a disabled or read-only checkbox. A programmatic write fires `"change"` and `"binding"` but never `"action"`, so subscribe to `"change"` to hear every change, your own writes included:

```typescript
cb.on("action", () => console.log("user toggled:", cb.isSelected()));
cb.on("change", on => console.log("now:", on));

cb.setSelected(true); // "change" and "binding" only
```

[`RadioButton`](/components/RadioButton), [`ToggleButton`](/components/ToggleButton) and [`Slider`](/components/Slider) follow the same contract.

## Notes

- Themed through the shared `--ts-ui-form-*` family plus checkbox-specific tokens (`--ts-ui-checkbox-bg`, `--ts-ui-checkbox-bg-selected`, `--ts-ui-checkbox-check-color`, `--ts-ui-checkbox-size`, `--ts-ui-checkbox-radius`).
- Keyboard: Space toggles the checked state.
- Honours [`Animation.isReducedMotion`](/api/core/namespaces/Animation/functions/isReducedMotion) — the check / dash crossfade is suppressed when set.
- A checkbox whose parent re-commits it at the rectangle it already holds is not re-laid-out (see [the write is diffed](/concepts/layout-system#the-write-is-diffed)) — including when a stretched grid cell asks it for the cell's whole width, since what it actually commits is only the width its own box and label need. `setSelected`, `setValue` and the indeterminate state swap classes and opacities on already-placed children rather than moving anything; `setLabel` adds or removes a child, which schedules the checkbox, and the label's own `setText` schedules its parent, which is the checkbox; and the box and check sizes are pinned from the theme at construction, so no later pass resolves them differently. A theme switch still lays every opted-in component out once.

## See also

- [API: Checkbox](/api/component/input/classes/Checkbox)
- [`Toggle`](/components/Toggle) — sliding-pill switch alternative
- [`RadioButton`](/components/RadioButton) — single-selection alternative
- [Data binding](/data/binding)
