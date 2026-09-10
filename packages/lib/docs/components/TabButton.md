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

## Busy state

[`setBusy(true)`](/api/component/button/classes/TabButton#setbusy) shows a translucent pulsing wash over the whole button, marking its tab's content as still loading; [`isBusy()`](/api/component/button/classes/TabButton#isbusy) reports the current state. The overlay displaces nothing — the label, the identity glyph, and the close (×) affordance are all unchanged, and the button never resizes. `prefers-reduced-motion` swaps the pulse for a static tint.

```typescript
tab.setBusy(true);   // start the loading wash
tab.setBusy(false);  // clear it
```

The wash colour reads `--ts-ui-tab-busy-color`, falling back to the strip's `--ts-ui-tab-indicator-color` accent when unset — override the former for a distinct busy colour without a full theme change.

## Modified indicator

[`setModified(true)`](/api/component/button/classes/TabButton#setmodified) shows a small filled dot trailing the label, marking unsaved changes; [`isModified()`](/api/component/button/classes/TabButton#ismodified) reports the current state.

```typescript
tab.setModified(true);   // show the dot
tab.setModified(false);  // hide it
```

Unlike the busy wash, the dot is a real content-row child, not an overlay — it rides beside the label the way the leading identity glyph does, so only the label truncates when the tab narrows and the dot is never clipped away. Its colour reads `--ts-ui-tab-indicator-color`, the same accent the strip's active-tab underline and the busy wash's fallback already use.

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
