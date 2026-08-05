# Spacer

[`Spacer`](/api/component/container/classes/Spacer) is a deliberately invisible leaf [`Component`](/api/core/classes/Component) whose only job is to take up space inside a layout.

Two modes:

- **Fixed** — `new Spacer(16)` advertises a `16 x 16` preferred size; `new Spacer(16, 0)` for a 16-pixel horizontal-only gap.
- **Flex** — `Spacer.flex()` or `new Spacer({ flex: true })` absorbs the row/column's leftover space by writing a `weight` entry into the parent's [`LayoutConstraints`](/api/layout/classes/LayoutConstraints).

The element is `aria-hidden`, has a transparent background, and sets `pointer-events: none`, so it never appears in the accessibility tree and never intercepts hover or click events.

<!-- demo: spacer-basic -->
> **Live demo** — two `Button`s in an `HBox`, pushed to opposite ends by a
> `Spacer` between them.
> [Open the Spacer page](https://jimka.github.io/typescript-ui/components/Spacer)
<!-- /demo -->

## Usage

```typescript
const row = new Container().setLayoutManager(new HBox());
row.add(Button("A"), Spacer(16), Button("B"), Spacer.flex(), Button("C"));
```

- The gap between A and B is a fixed 16 px.
- Button C is pinned to the right edge — the flex spacer absorbs every other pixel.

Two flex spacers split leftover space by weight:

```typescript
row.add(Button("A"), Spacer.flex(), Button("B"), Spacer.flex(2), Button("C"));
```

The second gap is twice the first.

## Notes

- Flex mode is meaningful only inside an [`HBox`](/api/layout/classes/HBox) or [`VBox`](/api/layout/classes/VBox). Other layout managers (`Card`, `Fit`, `Absolute`, `Border`, `Grid`, …) ignore the `weight` constraint and the spacer falls back to its `(0, 0)` preferred size.
- An HBox / VBox applies its `componentSpacing` between every adjacent child, so `Spacer.flex()` between two buttons in a 5-px-spacing row produces `5 + flex + 5`, not just `flex`. Set `setComponentSpacing(0)` if the extra gap is unwanted.
- Spacer is invisible by definition — no border, no border-radius, no theme tokens. For a visible divider, use [`MenuSeparator`](/components/MenuSeparator) or a plain [`Component`](/api/core/classes/Component) with an explicit border.

## See also

- [API: Spacer](/api/component/container/classes/Spacer)
- [`HBox`](/api/layout/classes/HBox)
- [`VBox`](/api/layout/classes/VBox)
- [`LayoutConstraints`](/api/layout/classes/LayoutConstraints)
