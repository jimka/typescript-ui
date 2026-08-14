# PopupPanel

[`PopupPanel`](/api/overlay/classes/PopupPanel) is a floating panel that sizes itself to its content, places itself against a trigger rect, and caps its height to the room available there — the building block for a custom popup with no overlay plumbing of its own. It extends [`AnimatedDropdown`](/components/AnimatedDropdown), which already owns the open/close lifecycle, the fade transition, the portal mount, and the dismissal contract; `PopupPanel` adds only content measurement, anchored placement, and the height cap.

Content, layout, insets, and a pinned size all come from the inherited `ComponentOptions` fields (`layoutManager`, `components`, `insets`, `preferredSize`) — `PopupPanelOptions` adds no fields of its own.

## Usage

```typescript
import { DOM } from '@jimka/typescript-ui/core';
import { PopupPanel } from '@jimka/typescript-ui/overlay';
import { VBox } from '@jimka/typescript-ui/layout';
import { Checkbox } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';

const panel = new PopupPanel({
    layoutManager: new VBox({ spacing: 4, stretching: true }),
    components: [
        new Checkbox({ label: 'Show archived' }),
        new Button('Apply'),
    ],
});

panel.toggleFor(triggerEl, DOM.source.getViewportRect(trigger));
```

Most consumers reach `PopupPanel` through [`PopupButton`](/components/PopupButton) rather than driving it directly; a non-button trigger (a table header cell, a toolbar overflow chevron) calls `toggleFor` itself.

## Placement and the height cap

`showAt(anchorRect)` measures the panel's preferred size, places it against `anchorRect` — left-aligned below the anchor by default, flipping above when the room below is short and above is roomier, and flipping its horizontal alignment when the left edge would overflow the viewport — and caps `maxSize.height` to the room available on the side it landed on. Content taller than that cap scrolls (`overflow-y: auto`) instead of running off-screen.

**`maxSize` is owned by the panel.** Every open recomputes it from the room at the current anchor, so a previous open's cap never leaks into the next one. A consumer who wants a fixed size sets `preferredSize` in the options bag instead of `maxSize` — `PopupPanel` still caps it further when the room is short.

`toggleFor(openerEl, anchorRect)` layers a toggle identity on top of `showAt`: opening for an already-open opener closes it, opening for a different opener re-anchors, and the opener element is excluded from the outside-click dismissal so the gesture that opened the panel doesn't immediately re-close it.

## Scrollbar overlap

`PopupPanel` reserves no gutter for its native scrollbar — unlike [`Menu`](/components/Menu), which insets its own content because it owns its insets outright. A `PopupPanel`'s insets belong to the consumer, so content stretched to the full inner width runs under the scrollbar at the trailing edge once the panel scrolls. If your popup content routinely overflows, wrap it in a `Panel({ autoScroll: 'y' })` under a `Fit` layout instead, whose own gutter machinery insets correctly.

## Dismissal and ARIA

The panel reports `role="dialog"`. `toggleFor` sets `aria-labelledby` from the opener's id when it has one, and leaves it untouched otherwise. `requestClose()` — the advisory the layer manager calls on an outside `pointerdown` or Escape — closes the panel through the normal `hideAnimated` fade unless a host installs its own close handler via `setCloseHandler`, as [`PopupButton`](/components/PopupButton) does to keep its own `aria-expanded` in sync.

## See also

- [API: PopupPanel](/api/overlay/classes/PopupPanel)
- [`AnimatedDropdown`](/components/AnimatedDropdown) — base class: lifecycle, fade, dismissal
- [`PopupButton`](/components/PopupButton) — a `Button` that toggles a `PopupPanel`
- [`Popover`](/components/Popover) — the library's other composable anchored overlay, for bubble-style content with an arrow tail
- [`Menu`](/components/Menu) — the closest sibling for placement geometry
