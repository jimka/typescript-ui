# DockRegion

[`DockRegion`](/api/layout/classes/DockRegion) makes a container an **edge-drop dock target**: while a tab is dragged, the region shows five drop zones — four edge bands plus a centre — and the drop restructures the layout. Dropping on an **edge** splits the region; dropping on the **centre** adds the dragged panel as a tab. It is the single-region primitive a larger dock/tab manager composes.

```
+----------------------------+
|            top             |
|  +----------------------+  |
| l|                      |r |
| e|        center        |i |   drop on an edge → split
| f|                      |g |   drop on the centre → tab
| t|                      |h |
|  +----------------------+  |
|           bottom           |
+----------------------------+
```

`DockRegion` is a plain coordinator, not a [`LayoutManager`](/api/layout/classes/LayoutManager) and not a [`Component`](/api/core/classes/Component): you construct one around an existing container and it wires the gesture, owning a drop-target registration and the overlay it drives. One instance per dockable region.

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { Fit, DockRegion } from '@jimka/typescript-ui/layout';

const region = Component({ layoutManager: Fit() });
region.addComponent(content);

const dock = new DockRegion(region);
// …later, when the region goes away:
dock.destroy();
```

The dragged source must be a tab carrying the framework's tab-drag payload — any tab from a `reorderable` [`Tab`](/layouts/Tab) strip qualifies, so a tab dragged from one strip can be docked onto any `DockRegion` with no extra wiring. `destroy()` unregisters the drop target and disposes the overlay, releasing its stylesheet rules along with its element.

## Where a drop lands

The cursor's position within the region's box resolves to one of five [`DropZone`](/api/overlay/type-aliases/DropZone) values. The outer quarter of each axis (the `EDGE_BAND_FRACTION`, the canonical VS Code / GoldenLayout ratio) is an edge band; corners resolve to the nearer edge, so there is no dead diagonal; the inner remainder is the centre.

| Drop zone | Result |
| --- | --- |
| `left` / `right` | Split the region **horizontally**; the dragged panel becomes the leading (`left`) or trailing (`right`) pane. |
| `top` / `bottom` | Split the region **vertically**; the dragged panel becomes the leading (`top`) or trailing (`bottom`) pane. |
| `center` | Add the dragged panel to the region as a tab. |

The dropped panel never lands as a bare pane — it is always placed inside a **reorderable [`Tab`](/layouts/Tab) stack** (a single-tab stack for an edge drop). That stack's tab header is the panel's drag handle, so a docked panel can be torn off or re-docked again exactly like any other tab; a bare pane would have no handle and be a dead end.

The resulting tab's label comes from the dropped component's intrinsic [`name`](/api/core/classes/Component#getname) — the title rides with the component through the move, so give a dockable panel a `name` and it labels itself wherever it lands (falling back to its `id` when unnamed).

## Wrap vs. extend

An edge drop splits the **unit** the region belongs to — the region's whole [`Tab`](/layouts/Tab) stack when the region is a tabbed leaf, otherwise the region itself. Splitting the stack (rather than the leaf) keeps a `Split` from ever landing in a tab slot, which is what would otherwise create an anonymous, ever-nesting wrapper tab. Given that unit:

- **Its container is already a same-axis [`Split`](/layouts/Split)** (or the region is itself such a `Split`): *extend*. The new stack is inserted adjacent to the unit — no extra nesting, so repeated same-axis drops stay flat.
- **Otherwise:** *wrap*. A fresh `Split` takes the unit's slot, and the unit and the dragged panel's stack become its two panes. When the unit is a bare leaf — the region's own content, not yet a stack — it is wrapped in its own reorderable `Tab` stack too, so *both* panes of the new split are draggable stacks rather than a stack paired with a handle-less pane that could never be torn off again. A perpendicular-axis drop nests by one level (intended).

So edge-dropping onto a panel that lives in a tab stack splits that **stack** in two — a single-tab stack becomes a `Split` of two stacks ("the single tab converted into a split with two tabs"), and a multi-tab stack moves as a whole to one side of the new split.

A `center` drop never splits: if the region is already a [`Tab`](/layouts/Tab) — or already a tabbed leaf inside one — the panel joins that stack as a sibling tab; otherwise the region is wrapped in a fresh `Tab` the same structural way an edge wraps it in a `Split`. (Checking the region's *parent*, not just the region itself, is what keeps repeated drops on the same target flat instead of nesting a new stack each time.)

Every re-parent goes through [`Component.moveComponent`](/api/core/classes/Component#movecomponent), so the moved panel and the region keep their content and layout constraints intact.

## Pruning emptied containers

The inverse of a drop is handled too. `DockRegion` listens to the [`empty`](/layouts/Tab#events) event of every stack it creates: when a stack loses its last tab — torn off, re-docked elsewhere, or closed — the empty stack is removed, and if that leaves a `Split` with a single child, the `Split` collapses (its lone child is hoisted into the grandparent at the `Split`'s slot). So tearing the last panel out of a split pane cleans up both the empty stack and the now-redundant split rather than leaving them behind.

## The overlay

While the cursor is over the region, a [`DropZoneOverlay`](/api/overlay/classes/DropZoneOverlay) tints the region and highlights the band the drop would occupy. It **composes with**, rather than replaces, the drag manager's validity tint ([`DragFeedback`](/api/overlay/classes/DragFeedback)): the tint reports whether the drop is *valid*, the overlay reports *where* it will land. Self-drops are rejected: dropping a panel onto the edge of the region it is already the sole content of (it would split a region against itself), and — since an edge drop can wrap the region in a tab stack, making the region itself draggable by its own tab — docking the region, or any container that holds it, back onto its own overlay (it would re-parent a node beneath its own subtree and detach it).

The hovered-band colours are themed via the `drag.dropzone` tokens — see [Theming](/concepts/theming#theme-keys).

## See also

- [API: DockRegion](/api/layout/classes/DockRegion)
- [`DropZoneOverlay`](/api/overlay/classes/DropZoneOverlay) — the five-zone overlay
- [`Split`](/layouts/Split) — the manager an edge drop creates or extends
- [`Tab`](/layouts/Tab) — the manager a centre drop adds to
