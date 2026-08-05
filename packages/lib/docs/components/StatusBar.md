# StatusBar

[`StatusBar`](/api/component/container/classes/StatusBar) is a thin horizontal strip mounted at the bottom of a window or panel that surfaces transient status messages and small persistent indicators (connection state, cursor row/col, document counts, zoom %, an inline [`ProgressBar`](/components/ProgressBar) or [`ProgressSpinner`](/components/ProgressSpinner)). The component is chrome-only: the message string is convenience sugar over an internal [`Text`](/api/component/input/classes/Text); every other widget the caller wants in the bar is built from existing components and inserted via `addLeft` / `addRight`.

<!-- demo: statusbar-basic -->
> **Live demo** — a `StatusBar` showing a status message and a small
> persistent indicator.
> [Open the StatusBar page](https://jimka.github.io/typescript-ui/components/StatusBar)
<!-- /demo -->

## Usage

```typescript
import { StatusBar } from '@jimka/typescript-ui/component/container';
import { IconText } from '@jimka/typescript-ui/component/display';

const sb = StatusBar({ defaultMessage: 'Ready' });

sb.addRight(new IconText('plug', 'Connected'));

container.addComponent(sb);

// Show a transient message that reverts to the default after 2 seconds.
sb.setMessage('Saved', 2000);
```

## Layout

A `StatusBar` wraps a single [`HBox`](/api/layout/classes/HBox) row: the message [`Text`](/api/component/input/classes/Text), a flex spacer, then the widgets added via `addRight`. `addLeft` inserts before the spacer, so left-added widgets sit between the message and the spacer while right-added widgets sit after it — the spacer absorbs the remaining width so the two groups sit at opposite ends of the strip.

Every widget in the row is baseline-aligned to the message text: a widget exposing a real baseline (`Text`, `Glyph`, `IconText`, a labelled `Button`, `ProgressBar`, `ProgressSpinner`, or a container laid out by an ordinary — not full-height-filling — `HBox`/`VBox`) lines its baseline up with the message's; a baseline-less widget is centred in the message's text line instead.

The strip height is fixed at `22px` (the `STATUS_BAR_HEIGHT` constant, mirrored by the `--ts-ui-statusbar-height` theme token), with a 1px top border, leaving a **21px** content band. Caller-added widgets must be no taller than 21px to fit without clipping. A stock `flat`+`compact` glyph-only `Button` is 22px and does not fit — call `pinGlyphSize(14)` to bring it to 20px before adding it.

## Common methods

| Method | Purpose |
| --- | --- |
| `setMessage(text, timeoutMs?)` | Replace the visible message. When `timeoutMs` is supplied, the default message is restored after the delay. A subsequent call cancels any pending revert. |
| `getMessage()` | Returns the currently-visible message string. |
| `clearMessage()` | Cancel any pending revert and revert to the default message immediately. |
| `setDefaultMessage(text)` | Set the fallback message used when a timed `setMessage` expires. Pushes the new default into the visible Text when no transient message is in flight. |
| `getDefaultMessage()` | Returns the configured default message. |
| `addLeft(component)` | Insert a component before the flex spacer, after the message and any previously-added left widgets. |
| `addRight(component)` | Append a component after the flex spacer. |
| `removeLeft(component)` | Remove a component previously added via `addLeft`. |
| `removeRight(component)` | Remove a component previously added via `addRight`. |

## Accessibility

The whole strip is a single screen-reader live region: the root element carries `role="status"` and `aria-live="polite"`. Mutating any widget in the bar (for example flipping a "Disconnected" Text) announces politely without each widget opting in.

## Theme tokens

| Variable | Purpose |
| --- | --- |
| `--ts-ui-statusbar-bg` | Background colour of the chrome strip. |
| `--ts-ui-statusbar-color` | Foreground colour for the message Text and inline indicators. |
| `--ts-ui-statusbar-border` | Colour of the 1px top border. |
| `--ts-ui-statusbar-height` | Documentation token for the fixed strip height. Code reads `STATUS_BAR_HEIGHT`. |
| `--ts-ui-statusbar-padding` | Documentation token for the left/right padding. |

## See also

- [API: StatusBar](/api/component/container/classes/StatusBar)
- [`Panel`](/api/core/classes/Panel) — the parent class supplying the insets cascade.
- [`HBox`](/api/layout/classes/HBox) — the horizontal layout used internally.
- [`IconText`](/components/IconText) — common companion for inline connection / status indicators.
