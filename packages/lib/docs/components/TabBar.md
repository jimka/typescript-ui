# TabBar

[`TabBar`](/api/component/container/classes/TabBar) is a standalone, window-agnostic tab **strip** — the toolbar element, tab buttons, selection indicator, reorder bar, tool group, overflow scrolling, and all tab drag-and-drop — with **no** content machinery. It is the bar half extracted from the [`Tab`](/api/layout/classes/Tab) layout manager, which now composes one and reacts to its events.

```
+------+------+------+--------+
| Cell | Cell | Cell |  tools |   ← the TabBar strip
+------+======+------+--------+
       ↑ active cell (indicator)
```

`TabBar` owns one DOM element (the strip toolbar) and renders the cells you register through `createBarEntry`. It interprets each DOM gesture (click, drag, drop, right-click, arrow key) into a window-agnostic [event](#events) the owner reacts to. The bar never touches content, a [`Window`](/api/overlay/classes/Window), or a [`Tab`](/api/layout/classes/Tab), so it is a pure dependency sink — that is what lets [`Tab`](/api/layout/classes/Tab) compose it without re-introducing a `Window` ↔ `Tab` cycle.

It extends [`Panel`](/api/core/classes/Panel) (not a bare `Component`) so the strip fills its allocated edge rather than shrinking to the tab buttons' content width.

## Cells, not content

A `TabBar` holds **cells**, not panels. Each cell is identified by a stable string `id` the owner mints; the owner keeps its own content record under the same `id`. The two halves never reference each other directly — the shared `id` is the only seam — so the bar holds no content reference and the owner holds no DOM reference.

```typescript
import { TabBar } from '@jimka/typescript-ui/component/container';

const bar = TabBar({ reorderable: true });
// place the bar's element wherever you host chrome, then add cells:
bar.createBarEntry('a', 'Alpha');
bar.createBarEntry('b', 'Beta', { closeable: true });

bar.on('tabpressed', (id) => {
    // the cell `id` was activated — show the matching content
});
```

## Events

The bar emits framework-custom semantic events (`on` / `off`); it never reaches into content or windows itself.

| Event | Payload | Meaning |
| --- | --- | --- |
| `"tabpressed"` | `(id)` | A cell was activated — swap content / run lazy-load. |
| `"reorder"` | `(fromId, toIndex)` | An in-strip reorder committed — re-derive content order from `getEntryIds()`. |
| `"tabclose"` | `(id)` | A cell's ✕ was clicked — remove the content. |
| `"dockrequested"` | `(componentId, slot)` | A foreign tab was dropped here — dock the live content keyed by `componentId`. |
| `"tabdragstart"` | `(id)` | A cell's drag committed — register the live content so a foreign strip's drop can resolve it. |
| `"tearoffrequested"` | `(id, clientX, clientY, forceBare)` | A cell was released over empty space — tear it off (e.g. into a window). |
| `"detach"` | `(id)` | A cell's drag was released onto a target — drop the cell **iff** the content left this container. |
| `"dockhover"` | `()` | A foreign tab has dwelt over the strip long enough to spring-load a raise — surface the strip's window so a backgrounded float can be aimed at. |

The `"tearoffrequested"` / `"detach"` pair is driven purely by whether the drag landed on a registered drop target; the *owner* applies the content guards (is the content ready? did it actually move out?) because only the owner knows the content state.

## Cell lifecycle

| Method | Purpose |
| --- | --- |
| `createBarEntry(id, name, constraints?)` | Add a cell; `constraints.closeable` adds a ✕, `constraints.glyph` a leading icon. The first cell becomes active. |
| `removeBarEntry(id)` | Bar-side teardown (button group, roving focus, wrapper, context-menu listener). |
| `moveBarEntry(id, toIndex)` | Move a cell to a slot (used by the owner's dock path). |
| `setActiveEntry(id)` | Programmatic select that funnels through the same path a click does — emits `"tabpressed"`. |
| `setActiveVisual(id)` | Visual-only re-select (button state + indicator), no emit — for re-selection after a close. |
| `getEntryIds()` / `getActiveEntryId()` | The ordered cell ids / the active id. |
| `setEntryContentId(id, contentId)` | Push the content's component id (feeds the drag payload and the button's `aria-controls`). |
| `setEntryBusy(id, busy)` / `isEntryBusy(id)` | Push the cell's loading state (the owner pushes it by cell id, same as `setEntryContentId`) — shows the tab button's loading overlay. |
| `setEntryGlyph(id, glyph)` / `clearEntryGlyph(id)` / `getEntryGlyph(id)` | Swap, remove or read a cell's leading icon after creation. |
| `setEntryItalic(id, italic)` / `isEntryItalic(id)` | Italicise a cell's label (VS Code-style preview tab), or read the flag back. View-only, like `setEntryGlyph`. |
| `isEntryCloseable(id)` / `getEntryName(id)` / `getEntryButtonId(id)` | Per-cell reads the owner needs (window title, ARIA `aria-labelledby`, …). |

## Layout

The owner positions the strip each layout pass:

```typescript
bar.prepareStrip();                  // orientation + button styles + ARIA — call before measuring
const thickness = bar.stripThickness();   // the cross-axis extent to reserve
// …compute the strip band from `thickness`…
bar.placeStrip(x, y, width, height); // position + lay out the strip's internal chrome
```

## Strip configuration

The bar carries the same strip knobs as the [`Tab`](/layouts/Tab) layout, each with a typed setter and an option-bag field: `widthMode`, `maxWidth`, `fixedWidth`, `side`, `align`, `orientation`, `scrollable`, `compact`, `reorderable`, `textAlign`, `underBorderFullWidth`, and `tools`. See [Strip placement, alignment & orientation](/layouts/Tab#strip-placement-alignment-orientation) on the `Tab` page for what each does — they behave identically here.

## Theming

`TabBar` reuses every existing `--ts-ui-tab-*` token verbatim — see the [`Tab` theming notes](/layouts/Tab#theming). No new tokens are introduced.

[`setBarSurfaceColor(color)`](/api/component/container/classes/TabBar#setbarsurfacecolor) repaints every opaque toolbar surface at once — the strip itself, the tool group, and (when built) the scroll arrows — for owners that swap the bar fill on a state change, such as a [`TabWindow`](/components/TabWindow) flattening its bar on blur. It is a recolor only and never relays out.

## See also

- [API: TabBar](/api/component/container/classes/TabBar)
- [`Tab`](/layouts/Tab) — the content manager that composes a `TabBar`
- [`TabPanel`](/components/TabPanel) — the `Panel` wrapper most consumers use
- [`TabDragData`](/api/overlay/interfaces/TabDragData) — the tear-off / re-dock drag contract
