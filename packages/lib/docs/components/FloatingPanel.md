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
| `placeNextTo(textColumn)` | Repositions the panel to sit just past `textColumn`'s rendered right edge instead of pinning to its own corner — see [Positioning next to a text column](#positioning-next-to-a-text-column) below. |

`setCorner` / `setMargin` mutate the same `AnchorConstraints` instance in place (rather than replacing it) and schedule the host's layout, so a later corner or margin change re-pins the panel without any `addComponent` call needing to run again.

## Positioning next to a text column

By default a `FloatingPanel` just pins to its `corner` — on a wide viewport that can leave it far from the prose it relates to, if the prose itself is narrower than the space it's laid out in (a `Markdown` instance caps its own rendered width via CSS `max-width`, not a JS layout constraint, so its rendered box is often narrower than its allocated one).

`placeNextTo(textColumn)` closes that gap: it reads `textColumn`'s real rendered width via a live DOM measurement (deliberately not `textColumn.getWidth()`, which would report the wider *allocated* box) and moves the panel to sit just past its right edge, clamped so it never ends up further right than the plain corner position would. Passing `null` — or a `textColumn` not yet mounted — falls back to that same corner position outright.

This is a method the panel's **owner** calls, not something `FloatingPanel` drives itself via its own `doLayout` — mirroring how other self-positioning components in this library expose a placement verb for their owner to call rather than repositioning themselves against a parent's layout mid-pass. Call it from the owner's own `doLayout` override (after `super.doLayout()`, so every sibling has already committed its geometry for that pass) *and* after anything that can change `textColumn`'s rendered width without triggering a layout pass at all — `Markdown.setMaxMeasure` / `setFontScale` are two built-in examples, since both write a CSS rule directly:

```typescript
class MyViewer extends Panel {
    private readonly _markdown: Markdown;
    private readonly _controls: FloatingPanel;

    doLayout(): this {
        super.doLayout();
        this._controls.placeNextTo(this._markdown);
        return this;
    }

    widen(): void {
        this._markdown.setMaxMeasure('90ch');
        this._controls.placeNextTo(this._markdown); // setMaxMeasure alone won't re-trigger layout
    }
}
```

[`MarkdownMinimap`](/components/MarkdownMinimap) uses this for its own corner-hugging behaviour, and [`MarkdownViewer`](/components/MarkdownViewer) wires it up automatically — see their own `doLayout` overrides.

## See also

- [API: FloatingPanel](/api/component/container/classes/FloatingPanel)
- [`DiagramView`](/components/DiagramView) — the hand-rolled precedent this component formalizes, now built on top of it.
- [`MarkdownMinimap`](/components/MarkdownMinimap) and [`MarkdownViewer`](/components/MarkdownViewer) — floating cards built on `FloatingPanel`.
- [`Anchor`](/api/layout/classes/Anchor) — the layout manager a `FloatingPanel`'s host must use.
