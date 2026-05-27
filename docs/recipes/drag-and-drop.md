# Drag-and-drop with `DragManager`

[`DragManager`](/api/core/variables/DragManager) is a process-wide coordinator that turns any [`Component`](/api/core/classes/Component) into a drag source, a drop target, or both. It owns the global session, draws the three overlay components ([`DragGhost`](/api/core/classes/DragGhost), [`DragFeedback`](/api/core/classes/DragFeedback), [`ReorderIndicator`](/api/core/classes/ReorderIndicator)) above the page, and routes every callback through the option bag you pass to the factory.

The framework already wires this up for [`TreeTable`](/components/TreeTable) rows — see [Drag-and-drop reparenting](/components/TreeTable#drag-and-drop-reparenting) on that page. This recipe covers the lower-level API for custom drag sources and drop targets.

## Mental model

| Concept | Owner | Lifecycle |
|---|---|---|
| Drag source | The component the user mouses down on | Register with [`makeDragSource`](/api/core/variables/DragManager#makedragsource); teardown via the returned closure. |
| Drop target | The component a drag may land on | Register with [`makeDropTarget`](/api/core/variables/DragManager#makedroptarget); teardown via the returned closure. |
| Drag data | An opaque `Record<string, unknown>` carrying the source's payload | Resolved once per session — pass a literal, or pass a factory if the payload changes per drag. |
| Drag session | The in-flight drag | Single-instance: the mouse is one pointer. Commits past a 4 px movement threshold so plain clicks never fire a drag. |

## Minimal example

```typescript
import { Component, DragManager } from '@jimka/typescript-ui/core';

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

`makeDragSource` accepts a [`DragSourceOptions`](/api/core/interfaces/DragSourceOptions) bag:

| Field | Purpose |
|---|---|
| `dragData` | Static payload, or a `() => DragData` factory if it changes per drag. |
| `onDragStart?` | Veto callback. Return `false` the moment the threshold is crossed to abort. |
| `ghostFactory?` | Build a custom drag preview. Returns any `Component`; falls back to the default [`DragGhost`](/api/core/classes/DragGhost) when omitted. |
| `cursor?` | CSS cursor applied to `<body>` while the drag is active. |

`makeDropTarget` accepts a [`DropTargetOptions`](/api/core/interfaces/DropTargetOptions) bag:

| Field | Purpose |
|---|---|
| `accepts` | Validity predicate. Drives the green / red feedback tint on every move; `onDrop` only fires when the final value is `true`. |
| `onDragOver?` | Optional hover callback. Return a number to position a [`ReorderIndicator`](/api/core/classes/ReorderIndicator) at the given y inside the target. |
| `onDragLeave?` | Fired when the cursor exits the target box. |
| `onDrop?` | Fired on `mouseup` over an accepting target. Return `false` to suppress the `drop` event. |

## Cycle and self-drop checks

`detail.sourceId` carries the source component's id, so a drop target can reject same-component drops with a one-liner:

```typescript
DragManager.makeDropTarget(component, {
    accepts: (detail) => detail.sourceId !== component.getId(),
});
```

For tree-like data where you also need to forbid drops onto descendants, walk the parent chain and reject when the source is an ancestor of the target — exactly the pattern [`TreeTable`](/components/TreeTable) uses internally.

## Programmatic cancel

[`DragManager.cancel`](/api/core/variables/DragManager#cancel) tears down the active session without firing `drop`. Wire it to your application's Escape key handler if the user expects Esc to abort an in-flight drag.

```typescript
if (DragManager.isDragging()) {
    DragManager.cancel();
}
```

## Architectural notes

- The manager hooks `mousedown` on each source through [`Component.addMouseDownListener`](/api/core/classes/Component#addmousedownlistener), so the framework's "components own their event surface" rule is preserved.
- `mousemove` / `mouseup` are registered through [`Event.addViewportListener`](/api/core/variables/Event#addviewportlistener) (not raw `document` listeners) so the manager interoperates with other viewport-level listeners — e.g. [`Window.onMouseDown`](/api/core/classes/Window#onmousedown), which already pre-empts `mouseup` at window capture.
- Overlays are appended directly to `<html>` and sit on `position: fixed` — one of the two documented overlay carve-outs in `ARCHITECTURE.md` §Positioning.
- The hit-test uses `document.elementsFromPoint`; overlays carry `pointer-events: none` so the row underneath always wins.

## See also

- [`TreeTable` drag-and-drop reparenting](/components/TreeTable#drag-and-drop-reparenting) — the highest-level integration shipped with the framework.
- [`DragManager` API](/api/core/variables/DragManager).
- [`DragGhost`](/api/core/classes/DragGhost) / [`DragFeedback`](/api/core/classes/DragFeedback) / [`ReorderIndicator`](/api/core/classes/ReorderIndicator) — the three overlay primitives.
