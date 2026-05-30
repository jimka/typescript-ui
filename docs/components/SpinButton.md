# SpinButton

[`SpinButton`](/api/component/input/classes/SpinButton) is a small up- or down-arrow [`Button`](/components/Button) used inside a [`NumberSpinner`](/components/NumberSpinner). It inherits the standard pressed-state appearance and click handling, then adds a hold-repeat gesture: pressing and holding fires `tick` events at an accelerating cadence.

You usually use this indirectly via `NumberSpinner`. Reach for `SpinButton` directly only when you're building your own spinner-style control.

## Usage

```typescript
import { SpinButton } from '@jimka/typescript-ui/component/input';
const upButton = SpinButton('up');
upButton.on("tick", () => increment());

panel.addComponent(upButton);
```

## Hold-repeat cadence

When held, ticks fire at:

- **Initial delay**: 400 ms
- **Multiplier**: each subsequent interval = previous × 0.75
- **Floor**: 40 ms (the cadence cannot accelerate beyond this)

This produces a quick ramp-up that feels responsive without runaway speed.

## Common methods

| Method | Purpose |
| --- | --- |
| `on("tick", fn)` | Subscribe to repeat ticks (also fires once on initial click). |
| `removeTickListener(fn)` | Unsubscribe. |

## See also

- [API: SpinButton](/api/component/input/classes/SpinButton)
- [`NumberSpinner`](/components/NumberSpinner) — the typical consumer
- [`Button`](/components/Button) — base class
