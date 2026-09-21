# Slider

[`Slider`](/api/component/input/classes/Slider) is a continuous-value range input rendered as a focusable `<div>` with `role="slider"`. Track and thumb are drawn with framework Components, so the visual is fully themable. Implements [`Bindable<number>`](/api/core/interfaces/Bindable).

<!-- demo: slider-range -->
> **Live demo** — a `Slider` over 0-100 with a `Text` beside it that updates
> live from the slider's `action` event.
> [Open the Slider page](https://jimka.github.io/typescript-ui/components/Slider)
<!-- /demo -->

## Usage

```typescript
import { Slider } from '@jimka/typescript-ui/component/input';
const volume = Slider({ min: 0, max: 100, step: 1, value: 50 });
volume.setPreferredSize({ width: 200, height: 24 });

volume.on("change", v => {
    console.log('volume:', v);
});

panel.addComponent(volume);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` / `setValue(n)` | Read / write the slider position. |
| `setMin(n)` / `setMax(n)` | Range bounds. |
| `setStep(n)` | Discrete step size; arrow keys move by this amount. |
| `setLargeStep(n)` | PageUp / PageDown step (defaults to `10 * step`). |
| `setOrientation('horizontal' \| 'vertical')` | Track axis. |
| `isEnabled()` / `setEnabled(boolean)` | Toggle interactivity. |
| `isReadOnly()` / `setReadOnly(boolean)` | Stays focusable but ignores user-driven changes. |
| `on("change", fn)` / `off("change", fn)` | Subscribe to value changes. |
| `on("binding", fn)` | Used by [`Binding`](/data/binding). |
| `on("action", fn)` | Subscribe to the user's value steps (each drag sample or value key that moves the thumb); never fires for a programmatic `setValue`. |

## Keyboard model

| Key | Action |
| --- | --- |
| ArrowRight / ArrowUp | `+step` |
| ArrowLeft / ArrowDown | `−step` |
| PageUp | `+largeStep` |
| PageDown | `−largeStep` |
| Home | `min` |
| End | `max` |

## Notes

- Drag is handled via `pointerdown` + `setPointerCapture`, so the cursor can leave the track mid-drag without losing the input stream.
- Themed through the shared `--ts-ui-form-*` family plus per-control slider tokens (`--ts-ui-slider-track-bg`, `--ts-ui-slider-track-active-bg`, `--ts-ui-slider-thumb-bg`, `--ts-ui-slider-thumb-size`, `--ts-ui-slider-track-thickness`).
- `on("change", fn)` covers the user's steps and your own `setValue` calls alike, while `on("action", fn)` carries the user's per-step drag and key stream alone.

## See also

- [API: Slider](/api/component/input/classes/Slider)
- [`NumberSpinner`](/components/NumberSpinner) — discrete numeric alternative
