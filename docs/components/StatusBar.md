# StatusBar

[`StatusBar`](/api/component/container/classes/StatusBar) is a thin horizontal strip mounted at the bottom of a window or panel that surfaces transient status messages and small persistent indicators (connection state, cursor row/col, document counts, zoom %, an inline [`ProgressBar`](/components/ProgressBar) or [`ProgressSpinner`](/components/ProgressSpinner)). The component is chrome-only: the message string is convenience sugar over an internal [`Text`](/api/component/input/classes/Text); every other widget the caller wants in the bar is built from existing components and inserted via `addLeft` / `addRight`.

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

A `StatusBar` is split into three siblings of an outer [`HBox`](/api/layout/classes/HBox):

| Zone | Holds | Notes |
| --- | --- | --- |
| Left zone | Message [`Text`](/api/component/input/classes/Text) + widgets added via `addLeft` | Hugs its preferred width. |
| Spacer | Empty [`Component`](/api/core/classes/Component) with `weight: 1` | Absorbs the remaining width so the left and right zones sit at opposite ends. |
| Right zone | Widgets added via `addRight` | Hugs its preferred width. |

The strip height is fixed at `22px` (the `STATUS_BAR_HEIGHT` constant, mirrored by the `--ts-ui-statusbar-height` theme token). Caller-added widgets should be small enough to fit in that row — the outer `HBox` runs in stretching mode and will clamp tall children to the bar's height.

## Common methods

| Method | Purpose |
| --- | --- |
| `setMessage(text, timeoutMs?)` | Replace the visible message. When `timeoutMs` is supplied, the default message is restored after the delay. A subsequent call cancels any pending revert. |
| `getMessage()` | Returns the currently-visible message string. |
| `clearMessage()` | Cancel any pending revert and revert to the default message immediately. |
| `setDefaultMessage(text)` | Set the fallback message used when a timed `setMessage` expires. Pushes the new default into the visible Text when no transient message is in flight. |
| `getDefaultMessage()` | Returns the configured default message. |
| `addLeft(component)` | Append a component to the left zone. |
| `addRight(component)` | Append a component to the right zone. |
| `removeLeft(component)` | Remove a component from the left zone. |
| `removeRight(component)` | Remove a component from the right zone. |

## Accessibility

The whole strip is a single screen-reader live region: the root element carries `role="status"` and `aria-live="polite"`. Mutating a widget in either zone (for example flipping a "Disconnected" Text) announces politely without each widget opting in.

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
