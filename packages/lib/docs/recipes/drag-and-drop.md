# Drag-and-drop with `DragManager`

[`DragManager`](/api/overlay/namespaces/DragManager) is a process-wide coordinator that turns any [`Component`](/api/core/classes/Component) into a drag source, a drop target, or both. It owns the global session, draws the three overlay components ([`DragGhost`](/api/overlay/classes/DragGhost), [`DragFeedback`](/api/overlay/classes/DragFeedback), [`ReorderIndicator`](/api/overlay/classes/ReorderIndicator)) above the page, and routes every callback through the option bag you pass to the factory.

The framework already wires this up for [`TreeTable`](/components/TreeTable) rows — see [Drag-and-drop reparenting](/components/TreeTable#drag-and-drop-reparenting) on that page. This recipe covers the lower-level API for custom drag sources and drop targets.

## Mental model

| Concept | Owner | Lifecycle |
|---|---|---|
| Drag source | The component the user mouses down on | Register with [`makeDragSource`](/api/overlay/namespaces/DragManager/functions/makeDragSource); teardown via the returned closure. |
| Drop target | The component a drag may land on | Register with [`makeDropTarget`](/api/overlay/namespaces/DragManager/functions/makeDropTarget); teardown via the returned closure. |
| Drag data | An opaque `Record<string, unknown>` carrying the source's payload | Resolved once per session — pass a literal, or pass a factory if the payload changes per drag. |
| Drag session | The in-flight drag | Single-instance: the mouse is one pointer. Commits past a 4 px movement threshold so plain clicks never fire a drag. |

## Minimal example

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { DragManager } from '@jimka/typescript-ui/overlay';


const source = new Component();
const target = new Component();

const tearDownSource = DragManager.makeDragSource(source, {
    dragData: { kind: 'tile', id: 42 },
});

const tearDownTarget = DragManager.makeDropTarget(target, {
    accepts: (detail) => detail.dragData.kind === 'tile',
    onDrop:  (detail) => console.log('dropped tile', detail.dragData.id),
});

// Later, when either component goes away:
tearDownSource();
tearDownTarget();
```

`accepts` runs continuously while the cursor moves so the feedback tint always reflects the result; `onDrop` runs once on `mouseup` over an accepting target.

## Option bags

`makeDragSource` accepts a [`DragSourceOptions`](/api/overlay/interfaces/DragSourceOptions) bag:

| Field | Purpose |
|---|---|
| `dragData` | Static payload, or a `() => DragData` factory if it changes per drag. |
| `onDragStart?` | Veto callback. Return `false` the moment the threshold is crossed to abort. |
| `ghostFactory?` | Build a custom drag preview. Returns any `Component`; falls back to the default [`DragGhost`](/api/overlay/classes/DragGhost) when omitted. |
| `cursor?` | CSS cursor applied to `<body>` while the drag is active. |

`makeDropTarget` accepts a [`DropTargetOptions`](/api/overlay/interfaces/DropTargetOptions) bag:

| Field | Purpose |
|---|---|
| `accepts` | Validity predicate. Drives the green / red feedback tint on every move; `onDrop` only fires when the final value is `true`. |
| `onDragOver?` | Optional hover callback. Return a number to position a [`ReorderIndicator`](/api/overlay/classes/ReorderIndicator) at the given y inside the target. |
| `onDragLeave?` | Fired when the cursor exits the target box. |
| `onDrop?` | Fired on `mouseup` over an accepting target. Return `false` to suppress the `drop` event. |
| `feedbackHost?` | Non-scrolling layer to host the validity tint, sized to the target's box within it. Pass it for a target that scrolls its own content so the tint overlays the viewport. |
| `suppressValidityTint?` | Turns off the manager's whole-target green / red wash for this target. Pass it when the target paints its own positional feedback (see [Drop-feedback colours](#drop-feedback-colours)). |

## Drop-feedback colours

Drag feedback speaks in two colour channels, and they mean different things. Keep them distinct:

- **Green / red wash** over the *whole target* = **validity**. The [`DragFeedback`](/api/overlay/classes/DragFeedback) tint, driven by `accepts`: green when the target accepts the drop, red when it refuses. Use it when the target has a single outcome and no sub-region to point at — e.g. a [`TreeTable`](/components/TreeTable) directory row ("the dragged record reparents here").
- **Blue** = **position**, in two tiers. A *faint* full-target wash is the "you can drop a tab here" affordance (a [`DockRegion`](/layouts/DockRegion) tints its whole body; a [`TabBar`](/components/TabBar) tints its whole strip); a *brighter* mark on a zone or slot then shows exactly *where* the drop lands — a [`ReorderIndicator`](/api/overlay/classes/ReorderIndicator) insertion line, a `DockRegion` edge/centre zone, or the strip's insertion bar. The **red** variant of the bright mark flags a specific spot that is *illegal* (a no-op or a self-drop), as opposed to the whole target being invalid.

The rule of thumb:

> **Faint blue = "droppable here." Bright blue = "it lands here." Green = "this is a valid drop area." Red = "not here."**

When a target paints its own blue position feedback, set `suppressValidityTint` so the manager's whole-target green/red wash doesn't stack a second, coarser signal over it. The [`DockRegion`](/layouts/DockRegion) bodies and the [`TabBar`](/components/TabBar) strip both do this: each pairs the faint droppable wash with a bright precise mark and folds validity into the mark's colour (blue when legal, red when not), so the green wash would be redundant — and would clash with the dock centre zone's blue for the identical "add a tab here" outcome. Reserve the green / red wash for targets like `TreeTable` rows, where a whole-target reparent has no finer slot to highlight.

The colours come from theme tokens (`--ts-ui-drag-feedback-{valid,invalid}-bg` for the validity wash, `--ts-ui-drag-dropzone-bg` for the faint droppable wash, `--ts-ui-drag-dropzone-{active,invalid}-bg` and `--ts-ui-drag-reorder-color` for the precise marks); see [Theming](/concepts/theming).

## Cycle and self-drop checks

`detail.sourceId` carries the source component's id, so a drop target can reject same-component drops with a one-liner:

```typescript
DragManager.makeDropTarget(component, {
    accepts: (detail) => detail.sourceId !== component.getId(),
});
```

For tree-like data where you also need to forbid drops onto descendants, walk the parent chain and reject when the source is an ancestor of the target — exactly the pattern [`TreeTable`](/components/TreeTable) uses internally.

## Programmatic cancel

[`DragManager.cancel`](/api/overlay/namespaces/DragManager/functions/cancel) tears down the active session without firing `drop`. Wire it to your application's Escape key handler if the user expects Esc to abort an in-flight drag.

```typescript
if (DragManager.isDragging()) {
    DragManager.cancel();
}
```

## Architectural notes

- The manager hooks `mousedown` on each source through [`Component.addMouseDownListener`](/api/core/classes/Component#addmousedownlistener), so the framework's "components own their event surface" rule is preserved.
- `mousemove` / `mouseup` are registered through [`Event.addViewportListener`](/api/core/namespaces/Event/functions/addViewportListener) (not raw `document` listeners) so the manager interoperates with other viewport-level listeners — e.g. [`Window.onMouseDown`](/api/overlay/classes/Window#onmousedown), which already pre-empts `mouseup` at window capture.
- Overlays are appended directly to `<html>` and sit on `position: fixed` — one of the two documented overlay carve-outs in `ARCHITECTURE.md` §Positioning.
- The hit-test uses `document.elementsFromPoint`; overlays carry `pointer-events: none` so the row underneath always wins.

## See also

- [`TreeTable` drag-and-drop reparenting](/components/TreeTable#drag-and-drop-reparenting) — the highest-level integration shipped with the framework.
- [`DragManager` API](/api/overlay/namespaces/DragManager).
- [`DragGhost`](/api/overlay/classes/DragGhost) / [`DragFeedback`](/api/overlay/classes/DragFeedback) / [`ReorderIndicator`](/api/overlay/classes/ReorderIndicator) — the three overlay primitives.
