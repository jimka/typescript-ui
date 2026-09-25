# Layout system

A [`LayoutManager`](/api/layout/classes/LayoutManager) is attached to a container [`Component`](/api/core/classes/Component). On every `doLayout()` call it reads the size hints of each child, resolves each child's [`LayoutConstraints`](/layouts/Constraints), and writes pixel-level position and size values to the children.

The framework ships 12 layout managers covering the desktop UI repertoire — [`Border`](/layouts/Border), [`HBox`](/layouts/HBox), [`Grid`](/layouts/Grid), [`Split`](/layouts/Split), and so on. This page is about the underlying mechanics they share.

## What runs in a layout pass

```
parent.doLayout()
   │
   ├── layoutManager.doLayout() reads:
   │       container.getInnerSize()          ─→ available rectangle
   │       child.getPreferredSize()          ─→ size hint per child
   │       container.getLayoutConstraints(child) ─→ constraint object
   │
   ├── for each child:
   │       compute (x, y, width, height)
   │       child.setPosition(x, y)
   │       child.setSize(width, height)
   │
   └── recurse: each child layout-manager runs against its subtree
```

The layout pass walks the tree top-down. Each child's `setSize` triggers its own layout pass for *its* children, recursively.

### The write is diffed

Committing a child's rectangle and recursing into its own layout pass are two separate steps, joined by [`Component.applyBounds`](/api/core/classes/Component#applybounds): it writes `x`/`y`/`width`/`height` and then recurses only when the rectangle actually changed, or the component has never completed a layout pass, or it has no element yet. A child handed the exact rectangle it already has is not re-laid-out — but only when that child opts in via its protected `canSkipUnchangedLayout` gate, which defaults to `false`. [`Component.setBounds`](/api/core/classes/Component#setbounds) is the non-recursing half: it writes the rectangle and reports whether it changed, for call sites that never cascaded into a child layout pass to begin with. A component that dirties its own layout inputs outside the normal `setSize`/`setPosition` path — mid-construction, or from a setter that cannot lay out immediately — calls [`Component.invalidateLayout`](/api/core/classes/Component#invalidatelayout) to guarantee the next unchanged commit cannot skip it.

The same gate guards the recursion inside `LayoutManager.commitBounds` — the commit the box, flow, grid, border, fit, card, anchor and absolute managers place a child through, as do `Split` and `Tab` on a settled pass — which withholds the child's pass under the same conditions, so the skip reaches those managers and not only the call sites that use `applyBounds` directly. A child placed with raw setters instead — an `Accordion` section, a `Split` pane mid-drag, a `TabBar`'s strip — is laid out every time, as before. Whether the rectangle changed is the child's committed rectangle before the write against its committed rectangle after it, never the request against the box the child already held, so a child whose own size ceiling clamps the rectangle it is handed — a `Checkbox` or `Toggle` asked for a stretched grid cell's whole width and committing only the width its own children need — is not re-laid-out for that clamp alone, while a box resized out of band since its last commit still lays out, because the write moves it back. A pass owed anywhere beneath an opted-in component is never withheld by its skip: `invalidateLayout` marks every ancestor that opted in as well as the component itself, and so do a size-stable move (its fold-back is owed on the moved child's parent) and a pass that ran detached while an [`onFirstLayout`](/api/core/classes/Component#onfirstlayout) callback waits for a connected one. The placement inputs that announce nothing mark the pass owed that way themselves: [`Component.setInsets`](/api/core/classes/Component#setinsets) and `clearInsets`, [`setLayoutManager`](/api/core/classes/Component#setlayoutmanager), [`sortComponents`](/api/core/classes/Component#sortcomponents), a child's constraints rewritten through [`LayoutManager.setLayoutConstraints`](/api/layout/classes/LayoutManager#setlayoutconstraints), a child's [`setDisplayed`](/api/core/classes/Component#setdisplayed), [`setPadding`](/api/core/classes/Component#setpadding) / `clearPadding` and [`setBorder`](/api/core/classes/Component#setborder) / `clearBorder`, [`removeAllComponents`](/api/core/classes/Component#removeallcomponents), the configuration setters of the box, flow, grid, fit and border managers, and [`Split.setOrientation`](/api/layout/classes/Split#setorientation) / [`setPaneSize`](/api/layout/classes/Split#setpanesize). [`Panel`](/api/core/classes/Panel) itself — not its subclasses — [`LabeledGrid`](/api/component/container/classes/LabeledGrid), [`Header`](/api/component/display/classes/Header) and so [`WindowHeader`](/api/component/container/classes/WindowHeader), [`StatusBar`](/api/component/container/classes/StatusBar), [`MenuBar`](/api/component/menubar/classes/MenuBar), [`ToolBar`](/api/component/menubar/classes/ToolBar) and the table's cells opt in, as do the form controls a field grid is built from: [`Text`](/api/component/input/classes/Text) itself — not its subclasses — [`TextField`](/api/component/input/classes/TextField) itself — likewise — [`ComboBox`](/api/component/input/classes/ComboBox), [`DateField`](/api/component/input/classes/DateField), [`TimeField`](/api/component/input/classes/TimeField), [`NumberSpinner`](/api/component/input/classes/NumberSpinner), [`Checkbox`](/api/component/input/classes/Checkbox), [`Toggle`](/api/component/input/classes/Toggle), [`Slider`](/api/component/input/classes/Slider) and [`FieldDecorator`](/api/validation/classes/FieldDecorator). Every other class keeps the default and is laid out on every commit. The test is applied one child at a time, so a container that must lay out — a field grid on a pass that reaches it — still withholds every opted-in child it hands an unchanged rectangle; that is where a settled form's saving is, since the grid itself owes a pass whenever anything asks it for one. A theme switch or a web-font load also defeats the skip, for one pass. It moves measured text sizes without moving any rectangle, so a component last laid out against other text metrics is laid out again even when its rectangle holds still.

One input still announces nothing: a custom component that changes its own intrinsic size must say so, through [`setPreferredSize`](/api/core/classes/Component#setpreferredsize) or [`notifyIntrinsicSizeChanged`](/api/core/classes/Component#notifyintrinsicsizechanged), or its opted-in ancestors will not re-flow it until one of them moves or something schedules a pass.

## Constraints

Constraints are the second argument to `addComponent`. The shape depends on the layout manager:

```typescript
panel.addComponent(child, { placement: Placement.NORTH });   // Border
panel.addComponent(child, { fill: FillType.HORIZONTAL });  // HBox / VBox
panel.addComponent(child, new AccordionConstraints('Section 1')); // Accordion
panel.addComponent(child);                                  // Absolute, Fit, Card, Grid
```

`addComponents` accepts the same per-child constraints by wrapping each child in a `ConstrainedComponent` pair:

```typescript
panel.addComponents(
    { component: header,  constraints: { placement: Placement.NORTH } },
    { component: content, constraints: { placement: Placement.CENTER } },
    footer  // bare component, no constraints
);
```

The same pair shape can appear in a constructor's `components` option for a fully declarative tree.

The shared base [`LayoutConstraints`](/api/layout/classes/LayoutConstraints) carries `fill` ([`FillType`](/api/layout/enumerations/FillType)) and `anchor` ([`AnchorType`](/api/layout/enumerations/AnchorType)) for managers that honour them. See the [Constraints reference](/layouts/Constraints).

## Fill and anchor resolution

When a layout assigns a child a cell larger than the child's preferred size, `fill` and `anchor` decide the result:

- `fill: NONE` + `anchor: NORTHEAST` → child stays at its preferred size, pinned to the top-right of the cell.
- `fill: HORIZONTAL` → child stretches to the cell's width but keeps preferred height; `anchor` decides vertical placement.
- `fill: BOTH` → child fills the cell entirely; `anchor` becomes irrelevant.

This is the behaviour that drives [`HBox`](/layouts/HBox), [`VBox`](/layouts/VBox), and [`Grid`](/layouts/Grid).

## Triggering layout

Three kinds of trigger exist:

1. **Initial render** — the first time a component is laid out by its parent.
2. **Viewport resize** — [`Body`](/components/Body) listens on `window.resize` and re-runs layout from the root.
3. **Explicit** — call `parent.doLayout()` after mutating children.

::: tip rAF-coalesced scheduling
Setters call an internal `scheduleLayout()` instead of `doLayout()` directly. The framework queues all dirty components and flushes them once per animation frame. Components whose ancestor is also dirty get pruned because the ancestor's pass will recurse into them anyway. This means you can `setPreferredSize` ten components in a single tick and get one layout pass, not ten.
:::

## When to call `doLayout` manually

Almost never. The cases:

- After mutating a `LayoutManager`'s configuration (e.g. `hbox.setComponentSpacing(8)`) — usually the manager handles it.
- After changing a child's preferred size from outside the framework's setter pipeline (e.g. you wrote directly to the DOM and need to resync).
- Inside `pauseLayout` / `resumeLayout` blocks — `resumeLayout` already triggers a `doLayout`.

For most code, `setPreferredSize` and friends do the right thing automatically.

## Building a custom layout manager

If none of the built-in managers fit, subclass [`LayoutManager`](/api/layout/classes/LayoutManager):

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { LayoutManager } from '@jimka/typescript-ui/layout';
class FlowLayout extends LayoutManager {
    private hgap = 8;
    private vgap = 8;

    doLayout(): void {
        const container = this.getContainer();
        if (!container) return;

        const inner = container.getInnerSize();
        if (!inner) return;

        let x = 0;
        let y = 0;
        let rowHeight = 0;

        for (const child of container.getLaidOutComponents()) {
            const pref = child.getPreferredSize() ?? { width: 100, height: 24 };

            if (x + pref.width > inner.width) {
                x = 0;
                y += rowHeight + this.vgap;
                rowHeight = 0;
            }

            child.setPosition(x, y);
            child.setSize(pref.width, pref.height);

            x += pref.width + this.hgap;
            rowHeight = Math.max(rowHeight, pref.height);
        }
    }
}
```

A custom `doLayout` iterates [`getLaidOutComponents()`](/api/core/classes/Component#getlaidoutcomponents) — the children filtered to those whose `isDisplayed()` is `true` — rather than `getComponents()`, so a child hidden with `setDisplayed(false)` takes no space and its siblings reflow to fill (mirroring CSS `display: none`). Use `getComponents()` only when you need *every* child regardless of display state (serialization, teardown). A child hidden with `setVisible(false)` is the opposite: it keeps its layout slot and is merely painted out, so it stays in `getLaidOutComponents()`. The array may be shared: it is re-served, unchanged, for as long as the same children are displayed in the same order, so copy it before sorting or splicing.

A manager that *aggregates* several children's extents — the box and grid family — reports the container's own perimeter (its insets, border and padding) and nothing more on both axes when it finds no laid-out children, whether every child is undisplayed or none was ever added: never a negative extent, and never the unbounded sentinel. Both are values a parent sums or maximises, so either one starves the row or column the container sits in. The built-in managers that show *one* child at a time — [`Fit`](/layouts/Fit), [`Card`](/layouts/Card), [`Tab`](/layouts/Tab) — answer `null` instead when they have nothing to show, which a parent reads as "no hint offered". Either answer is fine for a manager you write; a negative extent or a leftover sentinel is not.

`LayoutManager` itself handles:

- Storing per-child constraints in a `Map<string, LayoutConstraints>` (one entry per child id).
- Resolving the active `fill` and `anchor` against `getInnerSize()`.
- Notifying the framework when the layout's preferred size changes.
- Offering an unbuilt child to the manager: a factory passed to `addComponent` is presented to the layout manager first, which may claim it and decide when it runs. The base implementation declines, so the container builds the child immediately.
- Telling the manager a child has left: `componentRemoved(child)` fires once the container has already taken the child out of its child list, so a manager holding per-child state can drop it. Treat it as an invalidation rather than a departure — removing a child is also the primitive `moveComponent` and `replaceComponent` are built on, so it can fire midway through a mutation that puts a child straight back; forget the parked state and let the next layout pass re-derive what follows from it. The base implementation does nothing.

You typically only need to override `doLayout`; helper methods like `placeComponent(child, x, y, w, h)` apply fill / anchor consistently if you delegate to them.

## Common pitfalls

- **Forgot the layout manager.** A bare `Component` with children but no manager defaults to [`Absolute`](/layouts/Absolute), which means none of them get positioned. Set a manager explicitly.
- **Querying size before render.** `getSize()` does not return `null` for a component that hasn't been laid out yet — it returns a `Size` whose extents are `NaN`, the sentinel meaning "never assigned", and `getWidth()` / `getHeight()` / `getX()` / `getY()` report that same `NaN`. A null check will not catch it: test with `Number.isNaN` before doing arithmetic on the value, or wait until the parent has had a chance to lay out the subtree.
- **Mutating during `doLayout`.** Adding or removing components from inside a layout callback re-enters the layout pass. The rAF queue handles this safely (changes coalesce into the next frame), but the immediate layout call you triggered won't see them.

## See also

- [Layouts overview](/layouts/) — the catalog
- [Constraints reference](/layouts/Constraints)
- [Sizing](/concepts/sizing)
- [Component lifecycle](/concepts/component-lifecycle)
