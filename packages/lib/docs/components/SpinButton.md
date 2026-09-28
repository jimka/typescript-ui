# SpinButton

[`SpinButton`](/api/component/input/classes/SpinButton) is a small up- or down-arrow [`Button`](/components/Button) used inside a [`NumberSpinner`](/components/NumberSpinner). It inherits the standard pressed-state appearance and click handling, then adds a hold-repeat gesture: pressing and holding fires `tick` events at an accelerating cadence.

You usually use this indirectly via `NumberSpinner`. Reach for `SpinButton` directly only when you're building your own spinner-style control.

<!-- demo: spinbutton-counter -->
> **Live demo** — a `SpinButton` incrementing/decrementing a
> `Text`-displayed count; hold it down to see the repeat cadence.
> [Open the SpinButton page](https://jimka.github.io/typescript-ui/components/SpinButton)
<!-- /demo -->

## Usage

```typescript
import { SpinButton } from '@jimka/typescript-ui/component/input';
const upButton = SpinButton('▲');
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
| `off("tick", fn)` | Unsubscribe. |

## Notes

- The two spin buttons a [`NumberSpinner`](/components/NumberSpinner) builds are not re-laid-out when the spinner's pass hands them the rectangles they already hold (see [the write is diffed](/concepts/layout-system#the-write-is-diffed)). A button's own pass places one content row inside its inner rect, and every change to that row still reaches it: `clearGlyph`, a first `setGlyph`, `setDescription` and a writing-mode change rebuild the row and relay the button's preferred size, `setText` writes the label's text (which schedules the row) and relays the same size, and the flat/compact insets mark the button's own layout owed. A later `setGlyph` renames the glyph in place and relays nothing, which is sound because a glyph's box never depends on its name. `SpinButton` also re-reads its own size from the theme on every theme change. A bare `SpinButton` built by a consumer keeps the default and is laid out on every commit — the opt-in is on the spinner's own two concrete subclasses.

## See also

- [API: SpinButton](/api/component/input/classes/SpinButton)
- [`NumberSpinner`](/components/NumberSpinner) — the typical consumer
- [`Button`](/components/Button) — base class
