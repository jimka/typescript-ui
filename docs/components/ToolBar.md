# ToolBar

[`ToolBar`](/api/component/menubar/classes/ToolBar) is a horizontal (or vertical) strip of related controls — Buttons, ToggleButtons, ComboBoxes, [`ToolBarSeparator`](/components/ToolBarSeparator) rules — that sits at the top (or side) of a panel, window, or document.

`ToolBar` extends [`Panel`](/api/core/classes/Panel) so it inherits the 4-px default insets. Layout defaults to a horizontal [`HBox`](/api/layout/classes/HBox); pass `orientation: "vertical"` (or call `setOrientation("vertical")`) to swap to a [`VBox`](/api/layout/classes/VBox). Children can be any [`Component`](/api/core/classes/Component); focusable children are auto-registered with an internal [`RovingTabIndex`](/api/core/classes/RovingTabIndex) so Arrow keys cycle focus through them.

By default the bar gives its [`Button`](/api/component/button/classes/Button) and [`ToggleButton`](/api/component/button/classes/ToggleButton) children the classical flat appearance: no resting frame, a light frame and subtle fill on hover, and a sunken inset frame on press. A toggled-on `ToggleButton` reads as depressed, and a glyph-only button tightens to a compact square. Pass `flat: false` (or call `setFlat(false)`) to keep raised buttons.

## Usage

```typescript
import { ToolBar, ToolBarSeparator } from '@jimka/typescript-ui/component/menubar';
import { Button, ToggleButton }      from '@jimka/typescript-ui/component/button';

const bar = new ToolBar();

const bold      = new ToggleButton('B');
const italic    = new ToggleButton('I');
const underline = new ToggleButton('U');

bar.addComponent(bold);
bar.addComponent(italic);
bar.addComponent(underline);
bar.addComponent(new ToolBarSeparator());
bar.addComponent(new Button('Cut'));
bar.addComponent(new Button('Copy'));
bar.addComponent(new Button('Paste'));

parent.addComponent(bar);
```

## Options

| Field | Default | Purpose |
| --- | --- | --- |
| `orientation` | `"horizontal"` | `"horizontal"` packs children with [`HBox`](/api/layout/classes/HBox); `"vertical"` swaps to [`VBox`](/api/layout/classes/VBox). |
| `compact` | `true` | When `true`, the bar's own panel insets shrink to `(2, 2, 2, 2)` and every [`Button`](/api/component/button/classes/Button) / [`ToggleButton`](/api/component/button/classes/ToggleButton) child is switched to compact rendering (tighter button insets). Child spacing is left untouched — buttons pack flush and the density comes from the buttons themselves. |
| `overflow` | `"clip"` | `"clip"` lets children spill into the parent's clipping region. `"menu"` hides the [`Button`](/api/component/button/classes/Button) / [`ToggleButton`](/api/component/button/classes/ToggleButton) children that don't fit and surfaces them in a dropdown opened by a trailing chevron. See [Overflow menu](#overflow-menu). |
| `overflowSide` | `"right"` | Edge the `"menu"` overflow chevron sits on. `"right"` pins it to the bar's far-right edge (a flex spacer fills the gap after the last visible button); `"left"` leads the buttons. The overflowing buttons are the trailing run either way. No effect unless `overflow` is `"menu"`. |
| `flat` | `true` | When `true`, [`Button`](/api/component/button/classes/Button) / [`ToggleButton`](/api/component/button/classes/ToggleButton) children are switched to the flat appearance. Set `false` to keep raised buttons. |

## Setters

- `setOrientation(value)` — flips the layout manager between [`HBox`](/api/layout/classes/HBox) and [`VBox`](/api/layout/classes/VBox), preserving child spacing. The trailing-edge border flips from bottom to right (or vice versa). Existing [`ToolBarSeparator`](/components/ToolBarSeparator) children are **not** auto-flipped — recreate them with the matching orientation if needed.
- `setCompact(value)` — toggles compact mode: the bar's panel insets between `(4, 4, 4, 4)` and `(2, 2, 2, 2)`, and compact rendering on its `Button` / `ToggleButton` children (driven onto children added later through `addComponent`, like `setFlat`). `isCompact()` reports the current state.
- `setOverflow(value)` — switches between `"clip"` and `"menu"`. Entering `"menu"` for the first time lazily builds the chevron trigger and its dropdown. `getOverflow()` reports the current strategy.
- `setOverflowSide(value)` — moves the `"menu"` chevron to the `"left"` or `"right"` (default) edge; `getOverflowSide()` reports it. On `"right"` a flex spacer pins the chevron to the bar's far-right edge. Only the trigger's position changes — the overflowing buttons remain the trailing run.
- `setFlat(value)` — flattens (or restores) the bar's `Button` / `ToggleButton` children. The flag also governs children added later through `addComponent`, so any button you add to a flat bar is flattened automatically. Non-button children are left untouched. `isFlat()` reports the current state.

## Keyboard nav

- Tab enters the toolbar at the first focusable child.
- Arrow Right / Left (horizontal) or Arrow Down / Up (vertical) cycle focus through focusable children.
- Non-focusable children (separators, plain spacers) are skipped.

`RovingTabIndex.add` snapshots focusability at insertion time. A child whose tabindex changes after `addComponent` (e.g. a disabled button later re-enabled) will not be retroactively added to the roving group.

## Overflow menu

With `overflow: "menu"`, a bar that runs out of room hides its trailing [`Button`](/api/component/button/classes/Button) / [`ToggleButton`](/api/component/button/classes/ToggleButton) children and surfaces them in a dropdown opened by a trailing chevron affordance.

```typescript
const bar = new ToolBar({ overflow: "menu" });

for (const label of ['New', 'Open', 'Save', 'Print', 'Undo', 'Redo']) {
    const button = new Button(label);

    button.on('action', () => run(label));
    bar.addComponent(button);
}
```

On every layout pass the bar re-measures its children against its inner width. Buttons that no longer fit are switched to `display: none` and a chevron button — a flat, glyph-only trigger — appears at the trailing edge. Clicking it opens a [`Menu`](/api/core/classes/Menu) with one row per overflowed button, labelled from the button's text and glyph; selecting a row re-fires that button's `action`, and pressing the chevron again while the menu is open closes it. Widening the bar reveals the buttons again and hides the chevron once everything fits.

Two limitations are deliberate:

- **Horizontal only.** Menu overflow applies to horizontal bars. A vertical bar always clips; `setOrientation("vertical")` leaves overflow as clip even when the mode is `"menu"`.
- **Buttons only.** Only [`Button`](/api/component/button/classes/Button) / [`ToggleButton`](/api/component/button/classes/ToggleButton) children reflow into the dropdown — a menu row is text plus action, which other children (combo boxes, spacers, separators) have no well-defined mapping to. Non-button children that don't fit are clipped, exactly as in `"clip"` mode.

## Theming

`ToolBar` reads five CSS custom properties:

| Property | Purpose |
| --- | --- |
| `--ts-ui-toolbar-bg` | Toolbar background. |
| `--ts-ui-toolbar-border` | Trailing-edge border colour. |
| `--ts-ui-toolbar-padding` | Outer inset. |
| `--ts-ui-toolbar-gap` | Spacing between child controls. |
| `--ts-ui-toolbar-separator-color` | Used by [`ToolBarSeparator`](/components/ToolBarSeparator). |

All five are populated by the [`Theme`](/api/core/interfaces/Theme) `toolBar` block.

## Notes

- A `ToolBar` is layout-passive — the parent decides where it sits. Sticky, dockable, and floating modes are explicit non-goals.
- For a flexible-width gap between groups of children, add a [`Spacer.flex()`](/api/component/container/classes/Spacer). The underlying [`HBox`](/api/layout/classes/HBox) / [`VBox`](/api/layout/classes/VBox) weight system divides the leftover row/column between any flex spacers.

## See also

- [API: ToolBar](/api/component/menubar/classes/ToolBar)
- [`ToolBarSeparator`](/components/ToolBarSeparator) — divider rule
- [`MenuBar`](/components/MenuBar) — sister component for top-of-window menus
