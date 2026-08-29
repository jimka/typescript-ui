# MarkdownViewer

[`MarkdownViewer`](/api/component/display/classes/MarkdownViewer) wraps a single [`Markdown`](/components/Markdown) instance with a floating heading-outline minimap (top-right) and a floating width/zoom control cluster (bottom-right), both pinned over the prose instead of sitting beside it. Any consumer embedding one `Markdown` instance gets both for free by using `MarkdownViewer` instead of `Markdown` directly.

<!-- demo: markdownviewer-basic -->
> **Live demo** — a `MarkdownViewer` with its floating minimap and
> width/zoom controls. Scroll the prose to see the minimap highlight follow,
> click a minimap row to jump to it, and try the width/zoom buttons.
> [Open the MarkdownViewer page](https://jimka.github.io/typescript-ui/components/MarkdownViewer)
<!-- /demo -->

## Usage

```typescript
import { MarkdownViewer } from '@jimka/typescript-ui/component/display';

const viewer = MarkdownViewer({
    markdown: '# Guide\n\n## Getting started\n\nSome long document...\n',
});

viewer.on('activeheadingchange', (id) => console.log('now viewing', id));

panel.addComponent(viewer);
```

## Construction

`MarkdownViewer(options?)`:

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `markdown` | `string` | `""` | The Markdown source string to render. |
| `linkResolver` | `MarkdownLinkResolver` | resolves every href as external, unchanged | Forwarded to the internal `Markdown`. |
| `maxHeadingDepth` | `number` | `3` | Forwarded to the internal `MarkdownMinimap`. |
| `showMinimap` | `boolean` | `true` | Whether the floating heading-outline minimap shows. |
| `showControls` | `boolean` | `true` | Whether the floating width/zoom controls show. |

Inherits [`PanelOptions`](/api/core/interfaces/PanelOptions).

The source is passed as the `markdown` option rather than a positional first argument, unlike [`Markdown`](/components/Markdown#construction), [`CodeEditor`](/components/CodeEditor#construction), and [`MarkdownEditor`](/components/MarkdownEditor#construction) — `MarkdownViewer` is a container whose options bag is its whole documented surface.

## Width and zoom controls

The control cluster steps through two fixed preset arrays rather than exposing continuous sliders, the same discrete step-button pattern [`DiagramView`](/components/DiagramView)'s own zoom-in/zoom-out buttons use:

- **Width**: narrower / wider step between `60ch`, `70ch` (the theme's own default measure), and `90ch`, calling [`Markdown.setMaxMeasure`](/components/Markdown#construction).
- **Zoom**: zoom-out / zoom-in step between `0.85`, `1.0`, `1.15`, and `1.3`, calling [`Markdown.setFontScale`](/components/Markdown#construction).

Both clamp at their array bounds rather than erroring or wrapping around. **Reset** returns both to their default preset *and* clears the underlying overrides entirely (`setMaxMeasure(null)`, `setFontScale(1)`) rather than re-applying the default preset value — so a page that never touched the controls, and a page that stepped away and reset, both end up reading the live theme default rather than a value snapshotted at some earlier point.

## Scroll tracking

`MarkdownViewer` computes its own active heading from its native scroll position — the last heading, in document order, whose top edge is at or above the viewer's own top — and emits `"activeheadingchange"` only when the result actually changes between scroll ticks. `MarkdownMinimap` consumes this to highlight the corresponding row; a consumer can also listen directly for its own purposes (a "reading progress" indicator, syncing an outside table of contents). The tracking itself is delegated to [`HeadingScrollTracker`](/api/component/display/classes/HeadingScrollTracker), the same shared implementation the docs site's own `DocsContent` pane uses for its scroll-driven outline.

## Common methods

| Method | Purpose |
| --- | --- |
| `getMarkdown()` | Returns the internal `Markdown` instance — read-only; change content via `setMarkdown`, not by calling `getMarkdown().setMarkdown(...)` directly, which would desync the minimap. |
| `setMarkdown(markdown)` | Replaces the rendered source, recomputes headings, and refreshes the minimap. |
| `isMinimapVisible()` / `setMinimapVisible(value)` | Reads or toggles the floating minimap, independently of the controls. |
| `isControlsVisible()` / `setControlsVisible(value)` | Reads or toggles the floating width/zoom controls, independently of the minimap. |
| `on('activeheadingchange', listener)` / `off('activeheadingchange', listener)` | Registers or removes a listener for the currently active heading's id (or `null`). |

## See also

- [API: MarkdownViewer](/api/component/display/classes/MarkdownViewer)
- [`Markdown`](/components/Markdown) — the single instance this component wraps.
- [`MarkdownMinimap`](/components/MarkdownMinimap) — the floating outline this component wires up automatically; use it directly for a multi-block document with no single `Markdown` instance.
- [`FloatingPanel`](/components/FloatingPanel) — the corner-pinning primitive both the minimap and the controls are built on.
