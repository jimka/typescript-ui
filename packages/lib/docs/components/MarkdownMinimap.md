# MarkdownMinimap

[`MarkdownMinimap`](/api/component/display/classes/MarkdownMinimap) is a floating card — built on [`FloatingPanel`](/components/FloatingPanel) — that shows a document's heading outline, under an "On this page" header, as a [`Tree`](/components/Tree) pinned over the prose it summarizes rather than beside it. The tree's row labels render smaller than the ambient font, so the outline reads as a secondary navigation aid rather than a second copy of the prose at the same visual weight. Clicking a row emits the clicked heading's id; connect it to a [`HeadingScrollSource`](/api/component/display/interfaces/HeadingScrollSource) (any scroll-owning host that emits `activeheadingchange`) to have it highlight whichever heading is currently on screen as the document scrolls.

A long outline is capped at a fixed height (roughly 20 rows) and scrolls internally past that point, rather than growing without bound — the card otherwise sizes itself to its actual row count, so a short outline shows no scrollbar at all. A heading label wider than the panel truncates with an ellipsis rather than widening the tree for a horizontal scrollbar ([`Tree`](/components/Tree)'s `rowOverflow: "clip"`) — reading the outline matters more than a long title's exact text.

[`MarkdownViewer`](/components/MarkdownViewer) wires one of these up automatically. Use `MarkdownMinimap` directly when you have your own scrolling document — the docs app's own multi-block content pane is one such case, since it stacks several `Markdown` blocks and live demos rather than owning a single `Markdown` instance.

## Usage

```typescript
import { MarkdownMinimap } from '@jimka/typescript-ui/component/display';
import { Anchor } from '@jimka/typescript-ui/layout';

const host = Panel({ layoutManager: new Anchor(), autoScroll: 'y' });
host.addComponent(someMarkdown, { left: 0, right: 0 });

const minimap = MarkdownMinimap({ scrollSource: someScrollOwningHost, corner: 'top-right' });
minimap.setHeadings(extractMarkdownHeadings(source));
minimap.on('select', (id) => scrollToHeading(id));

host.addComponent(minimap, minimap.getAnchorConstraints());
```

`MarkdownMinimap` takes no `Router` and does not navigate on its own — it emits a semantic `"select"` event carrying just the clicked heading's id, the same way `Tree` itself emits `"selection"` without knowing what a caller does with it. The caller decides what "select" means: scroll a `Markdown` instance to the heading, or drive an app router.

## Construction

`MarkdownMinimap(options?)`:

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `maxHeadingDepth` | `number` | `3` | Deepest heading depth shown; a heading at or past `maxHeadingDepth + 1` is dropped entirely. |
| `scrollSource` | [`HeadingScrollSource`](/api/component/display/interfaces/HeadingScrollSource) | none | The scroll-owning source whose active-heading changes drive the highlighted row. |
| `listeners.select` | `(headingId: string) => void` | none | Construction-time shortcut for `on('select', ...)`. |

Inherits [`FloatingPanelOptions`](/api/component/container/interfaces/FloatingPanelOptions) (`corner`, `margin`) and [`PanelOptions`](/api/core/interfaces/PanelOptions). Unlike a bare `FloatingPanel`, `MarkdownMinimap` supplies its own floating-card chrome — an opaque background, a shadow, and rounded corners — so it reads clearly over scrolled prose. The inner `Tree` stays transparent; the opaque surface lives on the outer card, so there is exactly one opaque box, not two stacked ones.

## Building the tree from a flat heading list

`setHeadings` walks the flat, document-ordered [`MarkdownHeading[]`](/api/component/display/interfaces/MarkdownHeading) list once, building a real `TreeNode[]` hierarchy: a heading whose depth skips a level relative to its predecessor (an `h1` then an `h3`, no `h2`) nests under the nearest shallower ancestor still on the stack — the same rule the docs app's own sidebar tree and typical outline UIs use for a skipped level. A heading past `maxHeadingDepth` is dropped from the tree entirely, not merely hidden — but its own descendants that are within depth still resolve to its nearest *shown* ancestor when they later become the active heading.

## Common methods

| Method | Purpose |
| --- | --- |
| `setHeadings(headings)` | Replaces the shown outline, rebuilding the tree from a flat, document-ordered heading list. |
| `getMaxHeadingDepth()` | Returns the deepest heading depth shown. |
| `placeNextTo(textColumn)` | Inherited from [`FloatingPanel`](/components/FloatingPanel#positioning-next-to-a-text-column) — repositions the panel to sit just past `textColumn`'s rendered right edge instead of pinning to its own corner. |
| `on('select', listener)` / `off('select', listener)` | Registers or removes a listener for the clicked heading's id. |

Disposing a `MarkdownMinimap` unwires its `scrollSource` listener, so a `scrollSource` that outlives the minimap does not keep firing into torn-down state.

## See also

- [API: MarkdownMinimap](/api/component/display/classes/MarkdownMinimap)
- [`MarkdownViewer`](/components/MarkdownViewer) — wires one of these up automatically over its own `Markdown` child, with a live demo.
- [`FloatingPanel`](/components/FloatingPanel) — the corner-pinning primitive this component is built on.
- [`Tree`](/components/Tree) — the component the heading outline renders through.
