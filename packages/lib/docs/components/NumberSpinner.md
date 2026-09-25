# NumberSpinner

[`NumberSpinner`](/api/component/input/classes/NumberSpinner) is a numeric input field with up / down spin buttons. Combines a borderless [`TextField`](/components/TextField) and a vertical strip of two [`SpinButton`](/components/SpinButton)s into a single bordered control.

Supports min / max clamping, step-snapping, configurable display precision, click and click-and-hold increment / decrement, keyboard arrow keys, blur-on-invalid revert, and the framework `Bindable<number>` interface.

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { NumberSpinner } from '@jimka/typescript-ui/component/input';
const quantity = NumberSpinner();
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
| `on("binding", fn)` | Subscribe to user-driven changes (used by `Binding`). |

## Behavior

- Click-and-hold on a spin button accelerates after 400 ms — see [`SpinButton`](/components/SpinButton).
- Pressing **↑** / **↓** increments / decrements by `step`.
- Typing an out-of-range value and blurring reverts to the last valid value.
- Display precision controls only how many digits are shown; the underlying value retains full precision.
- Right-clicking the inner field opens a Cut/Copy/Paste menu. Cut/Paste act on the raw displayed text — uncommitted until blur or Enter, same as typing.

## Notes

- A spinner whose parent re-commits it at the rectangle it already holds is not re-laid-out (see [the write is diffed](/concepts/layout-system#the-write-is-diffed)). Its inner field and spin buttons are placed from its content box, and none of `setValue`, `setMin`, `setMax`, `setStep` and `setPrecision` is a layout input — they rewrite the inner field's value or only its options, and a [`TextField`](/components/TextField)'s box does not track its text. Changing insets, padding or a border, or reconfiguring its layout manager, marks it owed for the next pass that reaches it.

## See also

- [API: NumberSpinner](/api/component/input/classes/NumberSpinner)
- [`SpinButton`](/components/SpinButton) — the up / down arrow primitives
- [`Slider`](/components/Slider) — visual range alternative
- [Data binding](/data/binding)
