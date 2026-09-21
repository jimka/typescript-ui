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
| `isSelected()` / `setSelected(boolean, fireAction?)` | Read / write checked state. Pass `fireAction: false` to keep a programmatic write out of `on("action", fn)`. |
| `getValue()` / `setValue(boolean)` | Bindable interface — same as `isSelected` / `setSelected`. |
| `isIndeterminate()` / `setIndeterminate(boolean)` | Mixed-state for tri-state forms. |
| `getLabel()` / `setLabel(text \| null)` | Optional inline label. |
| `isEnabled()` / `setEnabled(boolean)` | Toggle interactivity. |
| `isReadOnly()` / `setReadOnly(boolean)` | Stays focusable but ignores user-driven changes. |
| `on("change", fn)` / `off("change", fn)` | Subscribe to value changes. |
| `on("binding", fn)` | Used by [`Binding`](/data/binding). |
| `on("action", fn)` | Subscribe to the click action — fires on a user toggle *and* on a programmatic `setSelected`, unless the caller passes `fireAction: false`. |

## Indeterminate / mixed state

Setting `setIndeterminate(true)` shows a horizontal bar in place of the check and emits `aria-checked="mixed"`. A user click from the mixed state first clears the indeterminate flag and selects the checkbox (matching the WAI-ARIA Authoring Practices recommendation).

## Programmatic writes and `action`

A checkbox announces `"action"` for a programmatic write as well as a user toggle. Pass `false` as `setSelected`'s second argument when the write is your own and only the value listeners should hear it:

```typescript
cb.setSelected(true);        // "change", "binding" and "action"
cb.setSelected(true, false); // "change" and "binding" only
```

`"change"` and `"binding"` fire either way — the flag gates the `"action"` dispatch and nothing else, and an unchanged write still returns early without firing anything. This is where `Checkbox` differs from [`RadioButton`](/components/RadioButton), whose `"action"` means "the user selected this one" and never fires for a programmatic `setSelected`.

## Notes

- Themed through the shared `--ts-ui-form-*` family plus checkbox-specific tokens (`--ts-ui-checkbox-bg`, `--ts-ui-checkbox-bg-selected`, `--ts-ui-checkbox-check-color`, `--ts-ui-checkbox-size`, `--ts-ui-checkbox-radius`).
- Keyboard: Space toggles the checked state.
- Honours [`Animation.isReducedMotion`](/api/core/namespaces/Animation/functions/isReducedMotion) — the check / dash crossfade is suppressed when set.

## See also

- [API: Checkbox](/api/component/input/classes/Checkbox)
- [`Toggle`](/components/Toggle) — sliding-pill switch alternative
- [`RadioButton`](/components/RadioButton) — single-selection alternative
- [Data binding](/data/binding)
