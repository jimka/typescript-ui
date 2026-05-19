# Popover

[`Popover`](/api/core/classes/Popover) is an anchored, non-modal floating bubble with a directional arrow tail, optional title and body, and optional action buttons. Use it for click-triggered, interactive content — for ephemeral hover hints reach for [`Tooltip`](/components/Tooltip), and for modal containment reach for [`Dialog`](/components/Dialog).

`Popover` extends [`Panel`](/api/core/classes/Panel) so authors can compose freely via `addComponent`; the `setTitle` / `setBody` / `addAction` conveniences are sugar over the same container surface.

Positioning is anchor-relative. While the popover is open, `window` `resize` and each scrollable ancestor's `scroll` event trigger a reposition so the bubble follows the anchor. Fade-in / fade-out reuse the shared [`fadeShow`](/api/core/functions/fadeShow) / [`fadeHideAndDetach`](/api/core/functions/fadeHideAndDetach) helpers so the entrance animation matches the rest of the floating-overlay family.

## Usage

```typescript
import { Event, Popover } from '@jimka/typescript-ui/core';
import { Button } from '@jimka/typescript-ui/component/button';

const popover = new Popover({
    placement: 'auto',
    dismissOn: 'click-outside',
    title:     'Confirm delete',
});

popover.setBody('This action cannot be undone.');
popover.addAction('Delete', () => doDelete());
popover.addAction('Cancel', () => popover.hide());

const trigger = new Button('Delete record');
Event.addListener(trigger, 'click', () => {
    popover.attachToComponent(trigger);
    popover.show();
});
```

## Placement

`setPlacement(side)` accepts `"top"`, `"bottom"`, `"left"`, `"right"`, or `"auto"`.

- `"auto"` (default) picks the side with the most viewport space at `show()` time.
- An explicit side is honoured unless it would overflow the viewport, in which case the opposite side is used and a console warning is logged.

The arrow tail always points at the anchor centre even when the popover body is shifted laterally to stay on-screen.

## Dismiss modes

`setDismissOn(mode)` accepts:

| Mode | Behaviour |
| --- | --- |
| `"click-outside"` | Default. Closes on a viewport `mousedown` outside both the popover and its anchor. |
| `"blur"` | Closes when keyboard focus leaves the popover subtree. The popover root is made focusable and is focused on `show()` so focusout fires reliably. |
| `"manual"` | Caller drives `hide()` explicitly. No listeners are wired. |

In every mode the anchor element is excluded from the outside-dismiss check, so a second click on the trigger button does not immediately re-close the popover.

## Convenience setters

| Method | Purpose |
| --- | --- |
| `setTitle(text)` / `clearTitle()` | Title row (bold [`Text`](/api/component/input/classes/Text)) above the body. |
| `setBody(text)` / `setBody(component)` | String content is wrapped in a [`Text`](/api/component/input/classes/Text); a component is used directly. Replaces the previous body. |
| `addAction(label, onClick)` / `clearActions()` | Appends a [`Button`](/api/component/button/classes/Button) to a horizontal actions row at the bottom. |
| `setShowArrow(boolean)` | Hide the arrow tail (bubble keeps its standard radius). |

Power users who need a complex composition skip the conveniences and call `addComponent` directly.

## Theme tokens

| CSS Custom Property | Light Default | Dark Default | Purpose |
| --- | --- | --- | --- |
| `--ts-ui-popover-bg` | `rgb(255, 255, 255)` | `rgb(50, 50, 55)` | Bubble background |
| `--ts-ui-popover-color` | `rgb(0, 0, 0)` | `rgb(230, 230, 235)` | Body text colour |
| `--ts-ui-popover-border` | `rgb(200, 200, 200)` | `rgb(90, 90, 100)` | Bubble + arrow border |
| `--ts-ui-popover-shadow` | `2px 4px 12px rgba(0, 0, 0, 0.18)` | `2px 4px 12px rgba(0, 0, 0, 0.55)` | Bubble drop shadow |
| `--ts-ui-popover-radius` | `6px` | `6px` | Bubble corner radius |
| `--ts-ui-popover-padding` | `12px` | `12px` | Bubble inner padding |
| `--ts-ui-popover-arrow-size` | `8px` | `8px` | Arrow diamond side length |

## Reduced motion

`prefers-reduced-motion: reduce` short-circuits the fade transition through `Animation.play` — the popover appears instantly with no fade or translate.

## See also

- [API: Popover](/api/core/classes/Popover)
- [`Tooltip`](/components/Tooltip) — ephemeral, hover-triggered, no interactive content
- [`Dialog`](/components/Dialog) — modal with focus trap and backdrop
- [`AnimatedDropdown`](/components/AnimatedDropdown) — shared fade lifecycle
