# PopupButton

[`PopupButton`](/api/component/button/classes/PopupButton) is a [`Button`](/components/Button) whose click toggles a [`PopupPanel`](/components/PopupPanel) anchored under it — mirroring [`MenuButton`](/components/MenuButton) with a `PopupPanel` in place of a `Menu`. Reach for it whenever a toolbar or form needs a button-triggered custom popup rather than a `Menu`'s list-of-items shape.

## Usage

```typescript
import { PopupButton } from '@jimka/typescript-ui/component/button';
import { PopupPanel } from '@jimka/typescript-ui/overlay';
import { VBox } from '@jimka/typescript-ui/layout';
import { Checkbox } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';

const filters = PopupButton('Filters', {
    panel: () => PopupPanel({
        layoutManager: VBox({ spacing: 4, stretching: true }),
        components: [
            Checkbox({ label: 'Show archived' }),
            Checkbox({ label: 'Only mine' }),
            Button('Apply', { listeners: { action: applyFilters } }),
        ],
    }),
});

toolbar.addComponent(filters);
```

Clicking the button toggles the panel open and closed, anchored under the button's bottom-left corner — the same placement [`PopupPanel`](/components/PopupPanel)'s `showAt` always uses, including the flip above the button when the room below is short.

## The `panel` option

`panel` accepts either a built `PopupPanel` instance or a **factory function**, called exactly once on first open and reused across every later open — unlike [`MenuButton`](/components/MenuButton)'s `menuItems` provider, which re-runs on every open, because a panel is a live component with its own state rather than data to rebuild rows from. The factory form defers construction (and its children) until the popup is actually opened.

Replace the configured panel or factory at runtime with `setPanel(panel)`; read it back with `getPanel()`. Omitting `panel` entirely leaves the button inert beyond its `"action"` event still firing.

## Ownership

The button owns whichever panel it resolves: it disposes the panel in its own destructor, and `setPanel` disposes whatever panel was previously resolved before adopting the new configuration. **A panel must not be shared between two buttons** — it would be disposed by whichever button tears down first.

## ARIA

The button reports `aria-haspopup="dialog"` from construction and toggles `aria-expanded` on open and close. Once the panel is first resolved, `aria-controls` points at its id. The button installs itself as the panel's close handler, so an outside dismissal (an outside click, or Escape) returns `aria-expanded` to `false` too, not just the panel's own visual state.

## See also

- [API: PopupButton](/api/component/button/classes/PopupButton)
- [`Button`](/components/Button) — base class
- [`PopupPanel`](/components/PopupPanel) — the popup panel it toggles
- [`MenuButton`](/components/MenuButton) — the closest sibling, for a list-of-items dropdown instead of arbitrary content
