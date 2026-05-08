# NumberSpinner

[`NumberSpinner`](/api/classes/NumberSpinner) is a numeric input field with up / down spin buttons. Combines a borderless [`TextField`](/components/TextField) and a vertical strip of two [`SpinButton`](/components/SpinButton)s into a single bordered control.

Supports min / max clamping, step-snapping, configurable display precision, click and click-and-hold increment / decrement, keyboard arrow keys, blur-on-invalid revert, and the framework `Bindable<number>` interface.

## Usage

```typescript
import { NumberSpinner, Event } from '@jika/typescript-ui';

const quantity = new NumberSpinner();
quantity.setMin(0);
quantity.setMax(100);
quantity.setStep(1);
quantity.setValue(10);

Event.addListener(quantity, 'change', () => {
    console.log('quantity:', quantity.getValue());
});

panel.addComponent(quantity);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` / `setValue(n)` | Read / write the numeric value. |
| `setMin(n)` / `setMax(n)` | Range clamping. |
| `setStep(n)` | Increment per spin click and keyboard arrow press. |
| `setPrecision(n)` | Number of decimal digits in the displayed text. |
| `addBindingListener(fn)` | Subscribe to user-driven changes (used by `Binding`). |

## Behavior

- Click-and-hold on a spin button accelerates after 400 ms — see [`SpinButton`](/components/SpinButton).
- Pressing **↑** / **↓** increments / decrements by `step`.
- Typing an out-of-range value and blurring reverts to the last valid value.
- Display precision controls only how many digits are shown; the underlying value retains full precision.

## See also

- [API: NumberSpinner](/api/classes/NumberSpinner)
- [`SpinButton`](/components/SpinButton) — the up / down arrow primitives
- [`Slider`](/components/Slider) — visual range alternative
- [Data binding](/data/binding)
