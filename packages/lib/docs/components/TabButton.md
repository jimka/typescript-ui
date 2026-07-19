# TabButton

[`TabButton`](/api/component/button/classes/TabButton) is a tab-styled [`ToggleButton`](/components/ToggleButton): it paints its own unselected, hover, and selected fill from the `--ts-ui-tab-button-*` theme tokens and optionally overlays a close (×) affordance built from [`TabCloseButton`](/components/TabCloseButton). The [`TabBar`](/api/component/container/classes/TabBar) strip uses it internally for every tab — it is a TabBar collaborator, not a general-purpose button, so you would reach for it directly only when assembling your own tab-strip variant.

## Usage

```typescript
import { TabButton } from '@jimka/typescript-ui/component/button';

const tab = TabButton('Overview', { closeable: true });

if (tab.isCloseable()) {
    tab.getCloseButton()!.on('action', () => closeTab());
}
```

## Notes

- Extends `ToggleButton`, so it slots into a `ButtonGroup` and a roving tab index unchanged and exposes the inherited `setSelected` / `isSelected` selection state.
- `closeable` is construction-time only: the close button is built (or not) when the tab is created. There is no runtime `setCloseable`.
- The close button is overlaid on the tab button's own element rather than laid out as a sibling; `TabBar` positions and re-pins it on each layout pass via [`getCloseButton`](/api/component/button/classes/TabButton#getclosebutton).
- Relocates only the `--ts-ui-tab-button-*` and `--ts-ui-tab-close-hover-bg` token *references* — it defines no new theme tokens.

## See also

- [API: TabButton](/api/component/button/classes/TabButton)
- [`ToggleButton`](/components/ToggleButton) — the base class
- [`TabCloseButton`](/components/TabCloseButton) — the composed close affordance
- [`TabBar`](/api/component/container/classes/TabBar) — the primary consumer
