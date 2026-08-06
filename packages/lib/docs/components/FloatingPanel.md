# FloatingPanel

[`FloatingPanel`](/api/component/container/classes/FloatingPanel) is a [`Panel`](/api/core/classes/Panel) that pins itself to one corner of its host's inner box, via an [`AnchorConstraints`](/api/layout/classes/AnchorConstraints) instance it owns and exposes through `getAnchorConstraints()`. It formalizes the corner-pinning technique [`DiagramView`](/components/DiagramView) used by hand for its zoom/fit/reset control cluster.

Use it for any control cluster, badge, or card that should float over another component's content instead of sitting beside it in the layout — a corner-pinned toolbar, a minimap, a "scroll to top" button.

<!-- demo: markdownviewer-basic -->
> **Live demo** — `MarkdownViewer`'s floating heading-outline minimap
> (top-right) and width/zoom control cluster (bottom-right) are both built
> on `FloatingPanel`.
> [Open the MarkdownViewer page](https://jimka.github.io/typescript-ui/components/MarkdownViewer)
<!-- /demo -->

## Usage

```typescript
import { FloatingPanel } from '@jimka/typescript-ui/component/container';
import { Anchor } from '@jimka/typescript-ui/layout';

const host = Panel({ layoutManager: new Anchor() });

const controls = FloatingPanel({ corner: 'bottom-right', margin: 12 });
controls.addComponent(someButton);

host.addComponent(controls, controls.getAnchorConstraints());
```

The host's own layout manager must be [`Anchor`](/api/layout/classes/Anchor) — `FloatingPanel` does not install one, and does not touch the host's other children. Everything else about the host's composition (its main content, other siblings) is unaffected.

## Construction

`FloatingPanel(options?)`:

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `corner` | `"top-left" \| "top-right" \| "bottom-left" \| "bottom-right"` | `"top-right"` | Which corner of the host's inner box to pin to. |
| `margin` | `number` | `12` | Pixel distance from the two corner edges. |

Inherits [`PanelOptions`](/api/core/interfaces/PanelOptions). Unlike a plain `Panel`, `FloatingPanel` defaults to **zero insets** and carries no default background, border, or shadow — it is invisible until a consumer styles it, so wrapping an existing bare control cluster in one changes nothing visible.

## Common methods

| Method | Purpose |
| --- | --- |
| `getCorner()` / `setCorner(corner)` | Read or change which corner this panel pins to. |
| `getMargin()` / `setMargin(margin)` | Read or change the pixel margin from the pinned corner's two edges. |
| `getAnchorConstraints()` | The owned `AnchorConstraints` instance — pass it as the second argument to the host's `addComponent` call. |

`setCorner` / `setMargin` mutate the same `AnchorConstraints` instance in place (rather than replacing it) and schedule the host's layout, so a later corner or margin change re-pins the panel without any `addComponent` call needing to run again.

## See also

- [API: FloatingPanel](/api/component/container/classes/FloatingPanel)
- [`DiagramView`](/components/DiagramView) — the hand-rolled precedent this component formalizes, now built on top of it.
- [`MarkdownMinimap`](/components/MarkdownMinimap) and [`MarkdownViewer`](/components/MarkdownViewer) — floating cards built on `FloatingPanel`.
- [`Anchor`](/api/layout/classes/Anchor) — the layout manager a `FloatingPanel`'s host must use.
