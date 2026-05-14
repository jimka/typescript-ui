# Layout system

A [`LayoutManager`](/api/classes/LayoutManager) is attached to a container [`Component`](/api/classes/Component). On every `doLayout()` call it reads the size hints of each child, resolves each child's [`LayoutConstraints`](/layouts/Constraints), and writes pixel-level position and size values to the children.

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

## Constraints

Constraints are the second argument to `addComponent`. The shape depends on the layout manager:

```typescript
panel.addComponent(child, { region: Placement.NORTH });   // Border
panel.addComponent(child, { fill: FillType.HORIZONTAL });  // HBox / VBox
panel.addComponent(child, new AccordionConstraints('Section 1')); // Accordion
panel.addComponent(child);                                  // Absolute, Fit, Card, Grid
```

`addComponents` accepts the same per-child constraints by wrapping each child in a `ConstrainedComponent` pair:

```typescript
panel.addComponents(
    { component: header,  constraints: { region: Placement.NORTH } },
    { component: content, constraints: { region: Placement.CENTER } },
    footer  // bare component, no constraints
);
```

The same pair shape can appear in a constructor's `components` option for a fully declarative tree.

The shared base [`LayoutConstraints`](/api/classes/LayoutConstraints) carries `fill` ([`FillType`](/api/enumerations/FillType)) and `anchor` ([`AnchorType`](/api/enumerations/AnchorType)) for managers that honour them. See the [Constraints reference](/layouts/Constraints).

## Fill and anchor resolution

When a layout assigns a child a cell larger than the child's preferred size, `fill` and `anchor` decide the result:

- `fill: NONE` + `anchor: NORTHEAST` → child stays at its preferred size, pinned to the top-right of the cell.
- `fill: HORIZONTAL` → child stretches to the cell's width but keeps preferred height; `anchor` decides vertical placement.
- `fill: BOTH` → child fills the cell entirely; `anchor` becomes irrelevant.

This is the behaviour that drives [`HBox`](/layouts/HBox), [`VBox`](/layouts/VBox), [`Row`](/layouts/Row), [`Column`](/layouts/Column), and [`Grid`](/layouts/Grid).

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

- After mutating a `LayoutManager`'s configuration (e.g. `hbox.setSpacing(8)`) — usually the manager handles it.
- After changing a child's preferred size from outside the framework's setter pipeline (e.g. you wrote directly to the DOM and need to resync).
- Inside `pauseLayout` / `resumeLayout` blocks — `resumeLayout` already triggers a `doLayout`.

For most code, `setPreferredSize` and friends do the right thing automatically.

## Building a custom layout manager

If none of the built-in managers fit, subclass [`LayoutManager`](/api/classes/LayoutManager):

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

        for (const child of container.getComponents()) {
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

`LayoutManager` itself handles:

- Storing per-child constraints in a `Map<string, LayoutConstraints>` (one entry per child id).
- Resolving the active `fill` and `anchor` against `getInnerSize()`.
- Notifying the framework when the layout's preferred size changes.

You typically only need to override `doLayout`; helper methods like `placeComponent(child, x, y, w, h)` apply fill / anchor consistently if you delegate to them.

## Common pitfalls

- **Forgot the layout manager.** A bare `Component` with children but no manager defaults to [`Absolute`](/layouts/Absolute), which means none of them get positioned. Set a manager explicitly.
- **Querying size before render.** `getSize()` returns `null` for components that haven't been laid out yet. Wait until the parent has had a chance to lay out the subtree.
- **Mutating during `doLayout`.** Adding or removing components from inside a layout callback re-enters the layout pass. The rAF queue handles this safely (changes coalesce into the next frame), but the immediate layout call you triggered won't see them.

## See also

- [Layouts overview](/layouts/) — the catalog
- [Constraints reference](/layouts/Constraints)
- [Sizing](/concepts/sizing)
- [Component lifecycle](/concepts/component-lifecycle)
