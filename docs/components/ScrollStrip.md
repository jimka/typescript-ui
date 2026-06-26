# ScrollStrip

[`ScrollStrip`](/api/component/container/classes/ScrollStrip) is a reusable overflow-scrolling button rail: a clip frame (`overflow:hidden`, native scroll) that lays a row or column of items and, when they overflow along the main axis, shows lead/trail paging arrows in reserved gutters at each end. Each arrow click pages by one resolved step and disables at the scroll limit. It is the extracted scroll mechanic behind [`TabBar`](/components/TabBar)'s overflowing tab strip, exposed as a standalone primitive for any button/chip/breadcrumb rail.

The strip **is** its own clip frame — its element is the `overflow:hidden` box — so any overlay raw-appended into its clip element (via `getClipElement`) scrolls and clips together with the items. The native main-axis offset is the single source of truth (`mainScroll` / `setMainScroll`), and the owner keeps responsibility for the outer band geometry, arrow theming, and per-item step.

Available in horizontal (default, an `HBox`) and vertical (a `VBox`) orientations.

## Usage

Instantiate, add items, and let the strip scroll on overflow. The owner reserves the arrow gutters from `arrowReserve`, positions the frame, and then asks the strip to place its arrows into the band:

```typescript
import { ScrollStrip } from '@jimka/typescript-ui/component/container';

const strip = ScrollStrip({ orientation: 'horizontal' });

strip.addItem(Button({ text: 'One' }));
strip.addItem(Button({ text: 'Two' }));
strip.addItem(Button({ text: 'Three' }));

// In the owner's layout pass: reserve a gutter when the items overflow the
// region, place the frame, then place the arrows into its (clip-local) band.
const reserve = strip.arrowReserve(predictedItemsExtent, regionExtent);
strip.setX(x).setY(y).setWidth(width).setHeight(height);
strip.doLayout();
strip.layoutArrows(0, width, 0, height, reserve);
```

## Orientation

```typescript
const row = ScrollStrip({ orientation: 'horizontal' }); // HBox, main axis X
const col = ScrollStrip({ orientation: 'vertical' });   // VBox, main axis Y

col.setOrientation('horizontal'); // swaps the box; a no-op when unchanged
```

## Revealing an item

`revealItem(itemElement)` nudges the native scroll the minimum amount needed to bring a partially-clipped item fully into view; a fully-visible item produces no scroll. The owner decides *when* to reveal (e.g. on selection):

```typescript
const el = selectedItem.getElement();

if (el) {
    strip.revealItem(el);
}
```

## Common methods

| Method | Purpose |
| --- | --- |
| `addItem(c)` / `removeItem(c)` / `moveItem(c, i)` | Manage the scrolling row/column (box children). |
| `arrowReserve(content, region)` | Per-end gutter (px): the arrow size when scrollable and the content overflows the region past a 1px slop, else 0. |
| `layoutArrows(mainOrigin, mainExtent, crossOrigin, thickness, reserve)` | Place, size, and enable the arrows into the gutters of the given clip-local band (or hide them when `reserve` is 0). |
| `revealItem(el)` | Scroll the minimum amount to bring the item element fully into view. |
| `mainScroll()` / `setMainScroll(px)` | Read / write the native main-axis scroll offset (single source of truth). |
| `refreshArrows()` | Re-derive the arrows' enabled state from the live offset. |
| `getClipElement(forceCreate?)` | The clip element, for raw-appended overlays that must scroll/clip with the items. |
| `setOrientation(o)` / `getOrientation()` | Swap the scroll axis (`"horizontal"` / `"vertical"`). |
| `setScrollable(b)` / `isScrollable()` | Toggle paging arrows on overflow; `false` clips without arrows. |
| `setArrowBackground(color)` | Theme the arrow buttons (the component defines no token of its own). |
| `setArrowStep(px)` / `setStepProvider(fn)` | Per-click step; the provider, when set, wins so the step can track a live extent. |

## Behavior

- **Overflow gutters** — `arrowReserve` returns the per-end gutter only when the strip is scrollable *and* the content overflows the region by more than a 1px slop, so a strip that exactly fits never flickers the arrows.
- **Paging** — a lead/trail click pages by the resolved step (the step provider's value when wired, else the configured `arrowStep`) and re-evaluates the arrow enable state.
- **Edge disabling** — the lead arrow disables at offset 0, the trail arrow at the last page (with a 1px slop for sub-pixel rounding); disabling rather than hiding keeps the chrome from shifting as the items scroll.
- **Overlay coherence** — overlays appended into the clip element share the items' coordinate space and scroll/clip with them for free.

## Theming

`ScrollStrip` defines no theme token of its own — it is token-agnostic. The arrow background is set imperatively via `setArrowBackground(color)`, so a consumer themes the arrows to match its surface (e.g. `TabBar` passes its `--ts-ui-tab-toolbar-bg` value).

## See also

- [API: ScrollStrip](/api/component/container/classes/ScrollStrip)
- [`TabBar`](/components/TabBar) — the in-tree consumer; its overflowing tab strip is ScrollStrip-backed
- [`Scrollbar`](/components/Scrollbar) — a custom scrollbar overlay for components that own their scroll state (a different mechanic: a draggable thumb, not a scrolling rail of buttons)
