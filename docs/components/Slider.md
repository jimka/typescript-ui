# Slider

[`Slider`](/api/component/input/classes/Slider) is a continuous-value range input backed by an `<input type="range">` element. Tracks min, max, step, and current value internally, keeping the DOM in sync on every input event.

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { Slider } from '@jimka/typescript-ui/component/input';
const volume = Slider();
volume.setMin(0);
volume.setMax(100);
volume.setStep(1);
volume.setValue(50);
volume.setPreferredSize(200, 24);

Event.addListener(volume, 'input', () => {
    console.log('volume:', volume.getValue());
});

panel.addComponent(volume);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` / `setValue(n)` | Read / write the slider position. |
| `setMin(n)` / `setMax(n)` | Range bounds. |
| `setStep(n)` | Discrete step size; use `0.01` etc. for fine-grained ranges. |

## Notes

- Browser styling for the slider track varies. Use `setForegroundColor` / `setBackgroundColor` to nudge the look, or apply `getElement()`-level CSS for full control.
- `change` fires only on release; `input` fires on every value change during a drag.

## See also

- [API: Slider](/api/component/input/classes/Slider)
- [`NumberSpinner`](/components/NumberSpinner) — discrete numeric alternative
