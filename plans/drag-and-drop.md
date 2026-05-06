# Drag-and-Drop System — Implementation Plan

## Overview

A `DragManager` namespace and three companion `Component` subclasses provide a complete drag-and-drop facility. The design mirrors existing patterns: `DragManager` is a pure namespace like `Event`, `CSS`, and `Util`; the visual components follow the `Tooltip`/`Notification`/`ContextMenu` pattern of document-root-appended overlays; and the two factory functions (`makeDragSource`, `makeDropTarget`) mirror `Tooltip.attach`/`Tooltip.detach` in their usage model.

---

## Architecture Decisions

### `document.addEventListener` instead of `Event.addViewportListener`

`Event.addViewportListener` calls `stopPropagation()` inside `baseViewportListener` for every registered type, which would swallow mousemove/mouseup from all components during a drag. `Window.ts` sets this precedent: it uses `document.addEventListener('mousemove', ...)` directly for drag tracking. `DragManager` follows the same approach.

### Ghost: FIXED position, `pointer-events: none`

`FIXED` position makes the ghost follow `clientX`/`clientY` directly without scroll offset math. `pointer-events: none` lets `document.elementsFromPoint` return elements underneath the ghost for hit-testing.

### Hit-testing under the ghost

`document.elementsFromPoint(clientX, clientY)` returns the elements that would normally receive events (the ghost is excluded due to `pointer-events: none`). The manager walks this list looking for registered drop-target element IDs.

### State machine — single `DragSession`

The manager holds one private `DragSession` object during an active drag (mouse is a single pointer). The session is created on `mousedown` and committed only after a 4 px movement threshold (preventing accidental drags on clicks), then destroyed on `mouseup`.

### Factory functions return teardown functions

Both factories return `() => void` cleanup functions, matching the `ThemeManager.onThemeChange` pattern.

### Events fired via `Event.fireEvent`

Five custom events (`dragstart`, `dragover`, `dragleave`, `drop`, `dragend`) are dispatched on the drag-source component via `CustomEvent` with a `detail` payload.

### z-index layering

| Component | z-index |
|---|---|
| ContextMenu | 10000 |
| Tooltip | 10001 |
| Notification | 10002 |
| DragFeedback / ReorderIndicator | 10199 |
| DragGhost | 10200 |

---

## Public API (TypeScript Signatures)

```typescript
export type DragData = Record<string, unknown>;

export interface DragEventDetail {
    dragData : DragData;
    sourceId : string;
    clientX  : number;
    clientY  : number;
}

export interface DragSourceOptions {
    dragData     : DragData | (() => DragData);
    onDragStart? : (detail: DragEventDetail) => boolean | void;
    ghostFactory?: (source: Component, data: DragData) => Component;
    cursor?      : string;
}

export interface DropTargetOptions {
    accepts      : (detail: DragEventDetail) => boolean;
    onDragOver?  : (detail: DragEventDetail) => number | null | void;
    onDragLeave? : (detail: DragEventDetail) => void;
    onDrop?      : (detail: DragEventDetail) => boolean | void;
}

export namespace DragManager {
    /** Makes a component a drag source. Returns teardown function. */
    export function makeDragSource(component: Component, options: DragSourceOptions): () => void;

    /** Makes a component a drop target. Returns teardown function. */
    export function makeDropTarget(component: Component, options: DropTargetOptions): () => void;

    export function isDragging(): boolean;
    export function cancel(): void;
}
```

### `DragGhost`

```typescript
export class DragGhost extends Component {
    constructor(label?: string, width?: number, height?: number);
    moveTo(clientX: number, clientY: number): void;
    show(): void;
    hide(): void;
}
```

### `DragFeedback`

```typescript
export class DragFeedback extends Component {
    constructor();
    setValid(valid: boolean): void;
    attachTo(target: Component): void;
    detach(): void;
}
```

### `ReorderIndicator`

```typescript
export class ReorderIndicator extends Component {
    constructor();
    setInsertionY(y: number): void;
    attachTo(target: Component): void;
    detach(): void;
}
```

---

## Theme Tokens

### New entries in `Theme` interface

```typescript
drag: {
    ghost: {
        background: string;
        border    : string;
        shadow    : string;
        opacity   : string;
    };
    feedback: {
        valid  : { background: string; border: string; };
        invalid: { background: string; border: string; };
    };
    reorderIndicator: {
        color: string;
    };
};
```

| CSS Variable | DefaultTheme | DarkTheme |
|---|---|---|
| `--ts-ui-drag-ghost-bg` | `rgba(200, 200, 200, 0.9)` | `rgba(60, 60, 60, 0.9)` |
| `--ts-ui-drag-ghost-border` | `rgb(150, 150, 150)` | `rgb(100, 100, 100)` |
| `--ts-ui-drag-ghost-shadow` | `2px 4px 12px rgba(0,0,0,0.25)` | `2px 4px 12px rgba(0,0,0,0.6)` |
| `--ts-ui-drag-ghost-opacity` | `0.85` | `0.85` |
| `--ts-ui-drag-feedback-valid-bg` | `rgba(30, 180, 80, 0.12)` | `rgba(30, 180, 80, 0.2)` |
| `--ts-ui-drag-feedback-valid-border` | `rgb(30, 180, 80)` | `rgb(30, 180, 80)` |
| `--ts-ui-drag-feedback-invalid-bg` | `rgba(200, 50, 50, 0.10)` | `rgba(200, 50, 50, 0.18)` |
| `--ts-ui-drag-feedback-invalid-border` | `rgb(200, 50, 50)` | `rgb(200, 50, 50)` |
| `--ts-ui-drag-reorder-color` | `rgb(30, 100, 200)` | `rgb(80, 140, 240)` |

---

## Ordered Implementation Steps

### Step 1 — Add theme tokens to `Theme.ts`

Add the `drag` block to the `Theme` interface, `DefaultTheme`, `DarkTheme`, and `themeToVars`. Zero runtime risk.

### Step 2 — Implement `DragGhost`

File: `Base/component/DragGhost.ts`

- `setPosition(Position.FIXED)`, `setZIndex(10200)`, `setPointerEvents("none")`
- Background, border, shadow from CSS variables
- Optional inner `Label` child for text
- `moveTo(clientX, clientY)`: `setX(clientX + 12)`, `setY(clientY + 12)` — 12 px offset keeps cursor visible
- `show()`: `document.documentElement.appendChild(el)`, `setVisible(true)`
- `hide()`: `setVisible(false)`, `removeElement()`

### Step 3 — Implement `DragFeedback`

File: `Base/component/DragFeedback.ts`

- `setPosition(Position.ABSOLUTE)`, `setZIndex(10199)`, `setPointerEvents("none")`
- `setValid(valid)`: toggle background/border between valid/invalid CSS variables
- `attachTo(target)`: set size to target's size; append `getElement(true)` directly to `target.getElement()` (NOT via `addComponent` — avoids triggering target's `doLayout`)
- `detach()`: `removeElement()`

### Step 4 — Implement `ReorderIndicator`

File: `Base/component/ReorderIndicator.ts`

- `setPosition(Position.ABSOLUTE)`, `setZIndex(10199)`, `setPointerEvents("none")`, `setHeight(2)`
- Background: `var(--ts-ui-drag-reorder-color)`
- `setInsertionY(y)`: `setY(y - 1)` to centre the 2 px bar on the insertion line
- `attachTo(target)`: `setX(0)`, match target width, append element to `target.getElement()`

### Step 5 — Implement `DragManager`

File: `Base/DragManager.ts`

#### Private data structures

```typescript
interface DragSourceRecord {
    component   : Component;
    options     : DragSourceOptions;
    mousedownFn : (e: MouseEvent) => void;
}

interface DropTargetRecord {
    component : Component;
    options   : DropTargetOptions;
}

interface DragSession {
    source        : DragSourceRecord;
    dragData      : DragData;
    ghost         : DragGhost;
    feedback      : DragFeedback;
    reorder       : ReorderIndicator;
    startX        : number;
    startY        : number;
    currentTarget : DropTargetRecord | null;
    committed     : boolean;
}
```

#### Module-level state

```typescript
const dragSources = new Map<string, DragSourceRecord>();
const dropTargets = new Map<string, DropTargetRecord>();
let activeSession: DragSession | null = null;
const DRAG_THRESHOLD = 4;
const GHOST_OFFSET_X = 12;
const GHOST_OFFSET_Y = 12;
```

#### `onMouseMove` (document-level, during drag)

1. If not committed: check 4 px threshold; cross it by resolving `dragData`, calling `onDragStart` (cancel if returns false), firing `"dragstart"`, showing ghost, setting cursor.
2. Move ghost: `ghost.moveTo(e.clientX, e.clientY)`.
3. Hit-test: `document.elementsFromPoint(e.clientX, e.clientY)` → find first element ID in `dropTargets`.
4. Handle target change: fire `"dragleave"` / detach feedback from old target; attach feedback to new target.
5. Call `onDragOver`, fire `"dragover"`, position `ReorderIndicator` from hint.

#### `onMouseUp` (document-level)

Detach listeners; if committed and target accepts: call `onDrop`, fire `"drop"`; fire `"dragend"`; hide ghost/feedback/reorder; restore cursor; clear session.

#### `cancel()`

Hide ghost/feedback/reorder; detach document listeners; fire `"dragend"`; restore cursor; clear session.

### Step 6 — Export from `index.ts`

```typescript
export { DragManager }      from './DragManager.js';
export type { DragData, DragEventDetail, DragSourceOptions, DropTargetOptions } from './DragManager.js';
export { DragGhost }        from './component/DragGhost.js';
export { DragFeedback }     from './component/DragFeedback.js';
export { ReorderIndicator } from './component/ReorderIndicator.js';
```

---

## Key Design Constraints

- **Never use `Event.addViewportListener` for move/up**: it calls `stopPropagation()` unconditionally, breaking window resize handles and split gutters.
- **`DragFeedback` and `ReorderIndicator` must NOT use `addComponent`**: the target's layout manager would resize them as normal children. Append directly to `target.getElement()`.
- **Ghost offset prevents immediate hover**: without offset, `elementsFromPoint` would still see through the ghost but having it cover the cursor is confusing UX. 12 px offset is idiomatic.

---

## Files to Create / Modify

| Action | File |
|---|---|
| Create | `Base/DragManager.ts` |
| Create | `Base/component/DragGhost.ts` |
| Create | `Base/component/DragFeedback.ts` |
| Create | `Base/component/ReorderIndicator.ts` |
| Modify | `Base/Theme.ts` |
| Modify | `Base/index.ts` |

---

## Critical Files

- `src/typescript/Base/DragManager.ts`
- `src/typescript/Base/component/DragGhost.ts`
- `src/typescript/Base/Theme.ts`
- `src/typescript/Base/index.ts`
