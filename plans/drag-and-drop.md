# Drag-and-Drop System — Implementation Plan

## Overview

The framework still has **no** drag-and-drop subsystem on disk — no `DragManager`, no `DragGhost`, no `DragFeedback`, no `ReorderIndicator` (`find src -name 'DragManager*'` is empty; `plans/implemented/drag-and-drop.md` does not exist). Every step of the previous version of this plan is therefore still pending and stays in scope.

Two new concerns join the existing one:

1. **TreeTable row drag-and-drop** so a row in [`TreeTable`](../src/typescript/lib/component/table/TreeTable.ts#L70) can be reparented onto another directory by drag. The hierarchy is encoded on the store's records via `spec.idField` / `spec.parentField` ([`TreeBody.rebuildIndex`](../src/typescript/lib/component/table/TreeBody.ts#L574)), so reparenting is a single `record.set(parentField, newParentId)` followed by the existing `notifyRecordChanged` path.
2. **Add-button parent bug** in [`TreeTablePanel`](../src/typescript/lib/component/table/TreeTablePanel.ts#L60-L63): the `addBtn` handler calls `this._treeTable.addRow()` with no parent, so every new row lands as a root and is appended at the bottom of the flat list. The user wants the new row to slot into the currently-selected directory (or the selected leaf's parent).

All three scopes share the same files (`TreeTable`, `TreeTablePanel`, `MiscPanel` demo) and the same verification surface (the "Show window with tree table!" button on the left column of [`MiscPanel.ts:347`](../src/typescript/MiscPanel.ts#L347)), so they ship as one coordinated plan.

---

## Architecture Decisions

### Use `Event.addViewportListener` for move/up — not raw `document.addEventListener`

The previous plan called for raw `document.addEventListener('mousemove', ...)` "following Window.ts's precedent." That precedent is **stale**: [`Window.onMouseDown`](../src/typescript/lib/core/Window.ts#L856) currently uses `Event.addViewportListener` and the in-file comment at [`Window.ts:872-875`](../src/typescript/lib/core/Window.ts#L872) explains why — `Event.baseViewportListener` stops `mouseup` propagation at window capture phase whenever any viewport listener for that type exists (e.g. `SpinButton` registers one at construction), which would prevent a raw document-level handler from firing at all. `DragManager` must register through `Event.addViewportListener(this, 'mousemove', namedHandler)` / `Event.addViewportListener(this, 'mouseup', namedHandler)` for the same reason. ARCHITECTURE.md's "all event registration goes through the `Event` class" rule reinforces this. Named handlers (per CODE_CONVENTIONS) — never inline arrows.

### TreeTable drop semantics: drop **on a directory** only

For `TreeTable` rows, the drop target is the **row whose record has children (a directory)** or any leaf-row whose parent is treated as the implied target. Two alternatives were rejected:

- *Drop between siblings (sibling-reorder)*: the underlying store is an unordered set keyed by parent id ([`TreeBody.rebuildIndex`](../src/typescript/lib/component/table/TreeBody.ts#L574-L602) — children are pushed in store iteration order). Sibling ordering isn't part of the schema; introducing one would require a new "order" field on the model and a sort hook in `flatten()`. Out of scope.
- *Drop on a leaf reparents it*: confusing — leaves visually are files; promoting them to directories on drop hides the intent.

Final rule:

| Hover target | Effect |
|---|---|
| Directory row (`hasChildren === true`, or the same row the user grabbed is a directory) | Drop reparents the dragged record under that directory |
| Leaf row | Drop reparents the dragged record under that leaf's **parent** (so dropping `report.pdf` onto `notes.pdf` moves it next to it under the same directory) |
| The tree body's empty area below the last row | Drop reparents to **root** (parentId = `null`) |
| The dragged row itself, or any descendant of it | Rejected — would create a cycle |

This matches macOS Finder / VS Code Explorer behaviour. Validation runs in the `DropTargetOptions.accepts` callback before the visual feedback turns valid.

### Add-button fallback: when nothing is selected, insert at root

When `treeTable.getSelectedRecord()` returns `null`, `addBtn` keeps its current behaviour of inserting at root (parent omitted). Inserting "wherever the last interaction was" would require new tracking state in `TreeTablePanel`; inserting into "the first root directory" would be surprising. Root insertion matches the documented `addRow()` JSDoc ("The 'add' button adds a root-level record" at [`TreeTablePanel.ts:31`](../src/typescript/lib/component/table/TreeTablePanel.ts#L31)) and is the only choice that doesn't add state.

### Selection-to-parent resolution for the Add-button fix

`treeTable.addRow(defaults, parent)` already exists ([`TreeTable.ts:204`](../src/typescript/lib/component/table/TreeTable.ts#L204)) and forwards `parent.get(spec.idField)` into the new record's `spec.parentField`. The fix in `TreeTablePanel` resolves the parent like this:

```typescript
const sel = this._treeTable.getSelectedRecord();
const parent = sel ? this.resolveParentForInsertion(sel) : undefined;
this._treeTable.addRow({}, parent);
```

`resolveParentForInsertion(sel)` returns `sel` when it's a directory, otherwise the record whose id matches `sel.get(spec.parentField)`. When the lookup is required, `TreeBody` already maintains the parent-id index in `_byId` — but it's private. The cleanest fix exposes `TreeTable.getRecordById(id): ModelRecord | undefined` (delegating to `TreeBody.getRecordById`, which in turn reads `_byId`) rather than reaching across the store. The condition "directory" is `treeTable.getBody().getFlatRecords()` lookup → `hasChildren`. Both helpers are already feasible because `TreeBody` is a public class and `TreeTable.getBody()` returns it (narrower-typed at [`TreeTable.ts:118`](../src/typescript/lib/component/table/TreeTable.ts#L118)).

### DragManager state machine — single `DragSession`

Unchanged from the previous version of this plan: one private `DragSession` object during an active drag (mouse is a single pointer). Created on `mousedown`; committed only after a 4 px movement threshold (prevents accidental drags on plain clicks); destroyed on `mouseup`.

### Factory functions return teardown functions

Unchanged: `makeDragSource` / `makeDropTarget` return `() => void` teardown functions, mirroring `ThemeManager.onThemeChange`. The TreeTable wiring installs sources on the pool rows when each row is bound and tears them down on rebind.

### Ghost: `Position.FIXED`, `pointer-events: none`

Unchanged. `FIXED` is one of the two carve-outs ARCHITECTURE.md §Positioning allows; floating overlays already use it (`Tooltip`, `Notification`, `Popover`, dropdowns). `pointer-events: none` lets `document.elementsFromPoint` find the row underneath.

### Hit-testing under the ghost — `document.elementsFromPoint`

Unchanged. The manager walks the returned element list looking for IDs registered in `dropTargets`.

### Events fired via `Event.fireEvent` with named accessors

Five custom event types (`dragstart`, `dragover`, `dragleave`, `drop`, `dragend`) dispatched on the drag-source component via `CustomEvent` with a `DragEventDetail` payload. Per ARCHITECTURE.md "components own their event surface": consumers subscribe through named methods (`addDragStartListener`, `addDropListener`) on the component, not by reaching across to `Event.addListener(otherComponent, …)`. For the row-DnD use case, the named accessors live on `TreeTable` (`addRowReparentListener(callback)`) — application code never touches the raw `DragManager` events on individual pool rows.

### z-index layering

Unchanged.

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

### New `TreeBody` / `TreeTable` surface (for both the Add-fix and row DnD)

```typescript
// TreeBody — read-only access to the parent/child index, already populated by rebuildIndex().
export class TreeBody extends _Body {
    getRecordById(id: any): ModelRecord | undefined;
    getChildrenOf(id: any): ModelRecord[];
    isDirectoryRecord(record: ModelRecord): boolean;   // hasChildren shortcut
    isAncestorOf(ancestor: ModelRecord, descendant: ModelRecord): boolean;
}

// TreeTable — pass-throughs + the new row-DnD listener surface.
export class TreeTable extends Table {
    getRecordById(id: any): ModelRecord | undefined;
    isDirectoryRecord(record: ModelRecord): boolean;
    reparentRow(record: ModelRecord, newParent: ModelRecord | null): boolean;
    addRowReparentListener(listener: (detail: RowReparentDetail) => void): void;
    removeRowReparentListener(listener: (detail: RowReparentDetail) => void): void;
}

export interface RowReparentDetail {
    record:    ModelRecord;
    newParent: ModelRecord | null;
    oldParent: ModelRecord | null;
}
```

`reparentRow` rejects cycles (`isAncestorOf(record, newParent)`) and no-ops when the record is already a child of `newParent`. On success it writes `record.set(parentField, newParent?.get(idField) ?? null)`, calls the store's `notifyRecordChanged` (which fires `datachanged` → `Body.onStoreChange` → `TreeBody.rebuildIndex` → re-flatten), and fires `rowreparent`. Selection is preserved.

---

## Theme Tokens

### New entries in the `Theme` interface

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

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-drag-ghost-bg` | `rgba(200, 200, 200, 0.9)` | `rgba(60, 60, 60, 0.9)` | DragGhost background |
| `--ts-ui-drag-ghost-border` | `rgb(150, 150, 150)` | `rgb(100, 100, 100)` | DragGhost border |
| `--ts-ui-drag-ghost-shadow` | `2px 4px 12px rgba(0,0,0,0.25)` | `2px 4px 12px rgba(0,0,0,0.6)` | DragGhost drop shadow |
| `--ts-ui-drag-ghost-opacity` | `0.85` | `0.85` | DragGhost opacity |
| `--ts-ui-drag-feedback-valid-bg` | `rgba(30, 180, 80, 0.12)` | `rgba(30, 180, 80, 0.2)` | Valid drop tint |
| `--ts-ui-drag-feedback-valid-border` | `rgb(30, 180, 80)` | `rgb(30, 180, 80)` | Valid drop outline |
| `--ts-ui-drag-feedback-invalid-bg` | `rgba(200, 50, 50, 0.10)` | `rgba(200, 50, 50, 0.18)` | Invalid drop tint |
| `--ts-ui-drag-feedback-invalid-border` | `rgb(200, 50, 50)` | `rgb(200, 50, 50)` | Invalid drop outline |
| `--ts-ui-drag-reorder-color` | `rgb(30, 100, 200)` | `rgb(80, 140, 240)` | ReorderIndicator bar colour |

The `drag` block goes into `Theme` (around the existing `indicator` block at [`Theme.ts:92`](../src/typescript/lib/core/Theme.ts#L92)), `DefaultTheme`, `DarkTheme`, and `themeToVars`.

---

## Internal Structure

### `DragManager` module state

```typescript
const dragSources = new Map<string, DragSourceRecord>();
const dropTargets = new Map<string, DropTargetRecord>();
let activeSession: DragSession | null = null;

/** Documented constants — see CODE_CONVENTIONS §Magic numbers. */

// Distance the mouse must travel before a press-and-drag commits to a drag,
// suppressing accidental drags fired from plain clicks. 4 px matches the
// HIG slop on Windows / macOS for the same reason.
const DRAG_THRESHOLD = 4;

// Ghost is offset diagonally from the cursor so the user can still see what
// they're aiming at; mirrors VS Code / Finder ghost placement.
const GHOST_OFFSET_X = 12;
const GHOST_OFFSET_Y = 12;
```

`DragSession` holds `source`, resolved `dragData`, the three overlay components, `startX/Y`, `currentTarget`, and `committed` flag — identical to the previous version of this plan.

### `TreeTablePanel` Add-button fix (the bug)

```typescript
const addBtn = new Button({ glyph: "plus" });
addBtn.setPreferredSize(28, 28);
addBtn.addActionListener(() => this.addRowUnderSelection());
```

```typescript
private addRowUnderSelection(): ModelRecord {
    const sel = this._treeTable.getSelectedRecord();

    if (!sel) {
        return this._treeTable.addRow();
    }

    const parent = this._treeTable.isDirectoryRecord(sel)
        ? sel
        : this._treeTable.getRecordById(sel.get(this._treeTable.getTreeSpec().parentField)) ?? undefined;

    return this._treeTable.addRow({}, parent);
}
```

`getTreeSpec().parentField` is the existing getter at [`TreeTable.ts:127`](../src/typescript/lib/component/table/TreeTable.ts#L127). The `?? undefined` collapses the orphan-fallback case (selected leaf has an unknown parent) back to root insertion, which matches the no-selection branch.

### `TreeTable` row-DnD wiring

The hook point is `TreeBody.afterRowBound` ([`TreeBody.ts:362-371`](../src/typescript/lib/component/table/TreeBody.ts#L362) creates each pool row; the base `Body.afterRowBound` at [`Body.ts:216`](../src/typescript/lib/component/table/Body.ts#L216) runs after every rebind). Each pool row needs a *fresh* drag source/target pair every time its bound record changes — the closure captures the current record and would lie after a rebind. The implementation:

1. `TreeTable` keeps a `Map<Row, () => void>` of teardown callbacks.
2. `afterRowBound(row, dataIndex, wasRebound)`: when `wasRebound`, teardown the previous source/target for that row and install fresh ones over the new record. `makeDragSource` reads the bound record's data; `makeDropTarget.accepts` rejects same-record and cycle drops.
3. `onDrop` calls `this.reparentRow(draggedRecord, dropParent)` — `dropParent` is the directory record when `hasChildren`, else the leaf's parent, else `null` (drop on body's empty area).
4. Disposal: when a pool row is removed from the pool or the `TreeTable` is detached, walk the teardown map.

The `reparentRow` write triggers `store.notifyRecordChanged(record)`, which fires `datachanged`, which `Body.bindStore` listens to → `TreeBody.onStoreChange` → `rebuildIndex` + re-flatten → next `renderWindow` shows the row in its new position. No manual selection or scroll required because the existing flow preserves both.

### Empty-area drop on the body

`TreeBody` itself becomes a passive drop target for "root reparent": `accepts` returns true only for records currently nested under a parent (root records dropping on the body's empty area are a no-op). This is one `makeDropTarget` call in `TreeBody.init()` time wiring; no per-row teardown.

---

## Ordered Implementation Steps

The order is **DragManager primitives → tree wiring → Add-button fix → demo verification**. The Add-fix is independent (doesn't depend on DragManager) but ships in the same plan because it touches the same `TreeTablePanel.constructor` body the row-DnD wiring inspects.

### Step 1 — Add `drag` block to `Theme.ts`

File: [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts)

Add the interface block next to `indicator` (line 92), the literal blocks to `DefaultTheme` and `DarkTheme`, and the eight `--ts-ui-drag-*` entries to `themeToVars`. Zero runtime risk. Grep checkpoint: `grep -n 'drag' src/typescript/lib/core/Theme.ts` — expect 13 hits after the edit (one interface, two literal blocks, eight `themeToVars` keys, two block titles in the file's TOC if any).

### Step 2 — Create `DragGhost`

File: `src/typescript/lib/core/component/DragGhost.ts` (lives under `core/component/` next to `DragFeedback` and `ReorderIndicator`; these three are drag-internal overlays, not bucket-level Components — `core/` already houses the `Tooltip`/`Notification` style overlays).

- Subclass `Component`. Constructor calls `super({ tag: 'div' })` then `setPosition(Position.FIXED)`, `setZIndex(10200)`, `setPointerEvents('none')`.
- Background / border / shadow / opacity from the new theme tokens via `setBackgroundColor`, `setBorder`, `setShadow`, `setOpacity` (all existing typed setters).
- Optional inner `Label` child for ghost text.
- `moveTo(x, y)`: `setX(x + GHOST_OFFSET_X)`, `setY(y + GHOST_OFFSET_Y)`.
- `show()`: append to `document.documentElement` via `getElement(true)` (an explicit append — `addComponent` would require a parent `Component`). This mirrors how `Notification` attaches.
- `hide()`: `removeElement()`.

### Step 3 — Create `DragFeedback`

File: `src/typescript/lib/core/component/DragFeedback.ts`

- `setPosition(Position.ABSOLUTE)`, `setZIndex(10199)`, `setPointerEvents('none')`.
- `setValid(valid)`: swap background and border between the four `feedback.valid` / `feedback.invalid` CSS variables via typed setters. Cache the boolean in `this._valid`.
- `attachTo(target)`: read target's bounds via `getX/getY/getWidth/getHeight`, mirror them via `setX/Y/Width/Height`, append directly to `target.getElement(true)`. **Never** use `target.addComponent` — the target's layout manager would resize the feedback overlay as if it were a normal child.
- `detach()`: `removeElement()`.

### Step 4 — Create `ReorderIndicator`

File: `src/typescript/lib/core/component/ReorderIndicator.ts`

- `setPosition(Position.ABSOLUTE)`, `setZIndex(10199)`, `setPointerEvents('none')`, `setHeight(2)`.
- Background colour via the `--ts-ui-drag-reorder-color` token.
- `setInsertionY(y)`: `setY(y - 1)` to centre the 2 px bar. The `-1` is documented as "centre the 2 px bar on the insertion line".
- `attachTo`: same pattern as `DragFeedback`.

### Step 5 — Implement `DragManager`

File: `src/typescript/lib/core/DragManager.ts`

- Module-level `dragSources` / `dropTargets` / `activeSession` state as above.
- `makeDragSource(component, options)`: register a named `onSourceMouseDown` listener via `Event.addListener(this, 'mousedown', onSourceMouseDown)` **from inside a helper that runs on the source** — but the helper is called by `DragManager` against a *foreign* component (the source), which violates "a component must not listen to another component's events through `Event`" (ARCHITECTURE.md). Resolution: `Component` already routes mousedown through its own dispatch; expose `Component.addMouseDownListener(handler)` if it doesn't already exist, and have `DragManager.makeDragSource` call that named accessor. Audit first: grep for an existing `addMouseDownListener` — if absent, add it in the same plan, with a private cache + named-method route. (Listed in `## Potential Challenges`.)
- `onMouseMove(e)`: not committed → check 4 px threshold; cross it by resolving `dragData`, calling `onDragStart` (cancel if returns `false`), firing `'dragstart'`, showing ghost, setting cursor. Then move ghost; hit-test via `document.elementsFromPoint(e.clientX, e.clientY)`; handle target change (fire `'dragleave'` on old, attach feedback to new); call `onDragOver`; fire `'dragover'`; position `ReorderIndicator` if hint supplied.
- `onMouseUp(e)`: detach viewport listeners; if committed and current target accepts → call `onDrop`, fire `'drop'`; fire `'dragend'`; hide overlays; restore cursor; clear session.
- `cancel()`: same as `onMouseUp` minus the drop branch — used by Escape-key handlers and programmatic cancel.

Both `onMouseMove` and `onMouseUp` register via `Event.addViewportListener(this, 'mousemove'|'mouseup', ...)` per the Architecture Decision above. The `this` is the active drag-source component (single session means a single registrant).

### Step 6 — Export from the `core` barrel

File: [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts)

```typescript
export { DragManager } from './DragManager.js';
export type { DragData, DragEventDetail, DragSourceOptions, DropTargetOptions } from './DragManager.js';
export { DragGhost } from './component/DragGhost.js';
export { DragFeedback } from './component/DragFeedback.js';
export { ReorderIndicator } from './component/ReorderIndicator.js';
```

### Step 7 — Extend `TreeBody` with parent-index accessors

File: [`src/typescript/lib/component/table/TreeBody.ts`](../src/typescript/lib/component/table/TreeBody.ts)

Add four public methods that read the existing `_byId` / `_childIds` maps. No new state, no new index passes — just expose what's already maintained.

- `getRecordById(id: any): ModelRecord | undefined` → `this._byId.get(id)`
- `getChildrenOf(id: any): ModelRecord[]` → `this._childIds.get(id) ?? []`
- `isDirectoryRecord(record: ModelRecord): boolean` → `this.getChildrenOf(record.get(this._idField)).length > 0`
- `isAncestorOf(ancestor: ModelRecord, descendant: ModelRecord): boolean` — walk `descendant.get(parentField)` upward through `getRecordById`, return true on match.

### Step 8 — Extend `TreeTable` with row-DnD surface

File: [`src/typescript/lib/component/table/TreeTable.ts`](../src/typescript/lib/component/table/TreeTable.ts)

- Pass-through `getRecordById`, `isDirectoryRecord` → `this._treeBody.*`.
- `reparentRow(record, newParent)`: validate (no cycles via `isAncestorOf`, no no-ops, record exists). On success, `record.set(parentField, newParent?.get(idField) ?? null)`, `this.getStore().notifyRecordChanged(record)`, fire the new `rowreparent` event. Return `true` / `false`.
- `addRowReparentListener` / `removeRowReparentListener` — named-method route per ARCHITECTURE; internally `Event.addListener(this, 'rowreparent', listener)`.
- Wire pool-row drag sources + drop targets through `TreeBody.afterRowBound` override. `TreeBody` stores the teardown map and forwards `rowreparent` requests to `TreeTable` via a callback set at construction.
- Wire empty-area drop target on the `TreeBody` element itself (one `makeDropTarget` call in `TreeBody` constructor; teardown on `dispose`).

### Step 9 — Fix `TreeTablePanel` Add-button

File: [`src/typescript/lib/component/table/TreeTablePanel.ts`](../src/typescript/lib/component/table/TreeTablePanel.ts) (lines 60-63)

Replace the `addBtn.addActionListener(() => this._treeTable.addRow())` with a named method `addRowUnderSelection` (per CODE_CONVENTIONS: no inline arrow handlers). The method body is the snippet in `## Internal Structure` above. Update the JSDoc at lines 28-33 to reflect the new behaviour: *"The 'add' button adds a row under the currently-selected directory — or under a selected leaf's parent, or at root when nothing is selected."*

### Step 10 — Regression checkpoint: drag-and-drop primitives are unreachable from outside `core/`

Grep: `grep -rn 'DragManager\b' src/typescript/lib/` — expect hits only in `core/DragManager.ts`, `core/index.ts`, `component/table/TreeTable.ts`, and `component/table/TreeBody.ts`. Any other location is a leak.

### Step 11 — `MiscPanel` TreeTable demo: smoke-verify Add fix and row DnD

File: [`src/typescript/MiscPanel.ts`](../src/typescript/MiscPanel.ts) (lines 347-406 — "Show window with tree table!")

No source edit required — the demo already builds a [`TreeTablePanel`](../src/typescript/MiscPanel.ts#L396) wrapping the `src` / `docs` / `package.json` hierarchy at lines 369-379. Both the Add fix (in `TreeTablePanel`) and row DnD (in `TreeTable`) light up automatically.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/core/DragManager.ts` |
| Create | `src/typescript/lib/core/component/DragGhost.ts` |
| Create | `src/typescript/lib/core/component/DragFeedback.ts` |
| Create | `src/typescript/lib/core/component/ReorderIndicator.ts` |
| Modify | `src/typescript/lib/core/Theme.ts` (`drag` block in interface + `DefaultTheme` + `DarkTheme` + `themeToVars`) |
| Modify | `src/typescript/lib/core/index.ts` (export the five new symbols + four type exports) |
| Modify | `src/typescript/lib/core/Component.ts` (add `addMouseDownListener` if missing — audit first) |
| Modify | `src/typescript/lib/component/table/TreeBody.ts` (add `getRecordById`, `getChildrenOf`, `isDirectoryRecord`, `isAncestorOf`; install empty-area drop target; override `afterRowBound` to wire per-row DnD teardown map) |
| Modify | `src/typescript/lib/component/table/TreeTable.ts` (add `getRecordById`, `isDirectoryRecord`, `reparentRow`, `RowReparentDetail`, `addRowReparentListener`, `removeRowReparentListener`) |
| Modify | `src/typescript/lib/component/table/TreeTablePanel.ts` (replace inline `addBtn` handler with `addRowUnderSelection`; update JSDoc at lines 28-33) |
| Modify | `src/typescript/lib/component/table/index.ts` (export `RowReparentDetail` type) |

No files to delete.

---

## Verification

1. **Typecheck:** `npx tsc --noEmit`.
2. **Grep invariants:**
   - `grep -rn 'document\.addEventListener' src/typescript/lib/core/DragManager.ts` → expect zero matches (must route through `Event.addViewportListener`).
   - `grep -rn 'DragManager\b' src/typescript/lib/` → expect hits only in `core/DragManager.ts`, `core/index.ts`, `component/table/TreeTable.ts`, `component/table/TreeBody.ts`.
   - `grep -n 'addBtn.addActionListener' src/typescript/lib/component/table/TreeTablePanel.ts` → expect `addRowUnderSelection`, not inline `() => this._treeTable.addRow()`.
3. **Theme toggle:** open the MiscPanel TreeTable demo, click "Switch to dark theme" (line 409 of MiscPanel), drag a row, confirm ghost / feedback / indicator colours flip to dark values.
4. **MiscPanel manual smoke — Add fix:**
   - Open MiscPanel (`npm run dev`, http://localhost:8015), click "Show window with tree table!".
   - Expand "src" (caret), select "lib" (a directory), click +. New record appears under "lib".
   - Select "Component.ts" (a leaf), click +. New record appears under its parent "lib".
   - Clear the selection (click empty area below the rows), click +. New record appears at root level.
5. **MiscPanel manual smoke — row DnD:**
   - Drag "main.ts" (under `src`) onto "docs". Confirm `main.ts` reparents to `docs`; expand `docs` to verify.
   - Drag "main.ts" onto "package.json" (a leaf at root). Confirm it lands at root (under `package.json`'s parent = null).
   - Drag "src" onto itself or onto "lib" (a descendant). Confirm the drop is rejected (invalid-feedback colour, no reparent).
   - Drag a row outside any directory row, into the empty space below "package.json". Confirm reparent to root.
6. **Docs build:** `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the only acceptable warning).

---

## Documentation Impact

- **New public symbols:** `DragManager`, `DragData`, `DragEventDetail`, `DragSourceOptions`, `DropTargetOptions`, `DragGhost`, `DragFeedback`, `ReorderIndicator` — all `@category Core`, re-exported from `src/typescript/lib/core/index.ts`. Verify they appear under `docs/api/core/` after `npm run docs:build`.
- **New recipe page:** `docs/recipes/drag-and-drop.md` covering the public `DragManager` API and a worked example using `makeDragSource` / `makeDropTarget`. Link it from `docs/recipes/index.md` and from the sidebar in `docs/.vitepress/config.mts`.
- **Update existing pages:**
  - `docs/components/TreeTable.md` — new section *"Drag-and-drop reparenting"* describing the row-DnD behaviour and the `addRowReparentListener` API; mention the drop semantics (directory / leaf-parent / empty-area-root).
  - `docs/components/TreeTablePanel.md` — fix the docstring that currently says the Add button "adds a root-level record"; replace with the new selection-aware behaviour.
- **Cross-bucket links:** `TreeTable.reparentRow` JSDoc references `DragManager` (different bucket); use the markdown form `` [`DragManager`](/api/core/variables/DragManager) ``, not `{@link}`.

---

## Potential Challenges

- **Component event-API friction:** `DragManager.makeDragSource` needs to attach a `mousedown` listener *on the source component* without violating "a component must not listen to another component's events through `Event`". Mitigation: route through a named `Component.addMouseDownListener` accessor — audit first whether one already exists on `Component`; if not, add it as part of Step 5.
- **Per-row teardown ordering:** the pool row's bound record changes on every scroll-driven rebind. Forgetting to tear down the previous source/target leaves stale closures captured around the previous record, which silently reparents the wrong row on drop. Mitigation: a single `Map<Row, teardownFns>` cleared inside `afterRowBound(row, _, wasRebound)` whenever `wasRebound`.
- **Cycle detection cost:** `isAncestorOf` walks up the parent chain; for a deeply nested tree this is O(depth). Acceptable — drops are user-paced, depth is small in practice.
- **`Body.scrollToRecord` + selection preservation after reparent:** the existing `Table.addRow` calls `scrollToRecord` + `selectRecord` ([`Table.ts:354-360`](../src/typescript/lib/component/table/Table.ts#L354)). After a `reparentRow` the existing selection is on the moved record, which is still valid — no extra wiring needed, but verify the `_anchorRecord` reference in `Body` isn't dropped when `onStoreChange` rebuilds (it shouldn't be, because the `ModelRecord` instance is the same — `set` mutates rather than replacing).
- **Drop on empty body when the body has zero rows:** `TreeBody` registers itself as a drop target at construction, but `getElement()` may not exist until render. Mitigation: register via the deferred-DOM-work pattern (`init()` or first render), not from the constructor.

---

## Critical Files

- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — reference implementation of viewport-listener-based drag; especially the comment at lines 872-875 explaining why raw `document.addEventListener` is unsafe.
- [`src/typescript/lib/core/Event.ts`](../src/typescript/lib/core/Event.ts) — `addViewportListener`, `addListener`, `fireEvent`.
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — interface, `DefaultTheme`, `DarkTheme`, `themeToVars`.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — typed setters (`setPosition`, `setZIndex`, `setPointerEvents`, `setBackgroundColor`, etc.); confirm whether `addMouseDownListener` already exists.
- [`src/typescript/lib/core/Tooltip.ts`](../src/typescript/lib/core/Tooltip.ts), [`Notification.ts`](../src/typescript/lib/core/Notification.ts), [`Popover.ts`](../src/typescript/lib/core/Popover.ts) — patterns for document-root-appended overlays.
- [`src/typescript/lib/component/table/TreeBody.ts`](../src/typescript/lib/component/table/TreeBody.ts) — `_byId`, `_childIds`, `rebuildIndex`, `flatten`, `afterRowBound`, `getStore`.
- [`src/typescript/lib/component/table/TreeTable.ts`](../src/typescript/lib/component/table/TreeTable.ts) — `getBody()` narrowed return type, `getTreeSpec()`, existing `addRow(defaults, parent)`.
- [`src/typescript/lib/component/table/Table.ts`](../src/typescript/lib/component/table/Table.ts) — `addRow`, `getSelectedRecord`, `removeSelectedRow` (mirror their patterns).
- [`src/typescript/lib/component/table/TreeTablePanel.ts`](../src/typescript/lib/component/table/TreeTablePanel.ts) — the toolbar wiring being patched.
- [`src/typescript/MiscPanel.ts`](../src/typescript/MiscPanel.ts) lines 347-406 — the demo screen for verification.

---

## Non-Goals

- **Sibling reorder inside a directory.** The store has no record-order field; introducing one is a separate plan.
- **Multi-row drag.** `getSelectedRecords()` returns an array, but the first cut only drags the row the user grabbed (`getSelectedRecord()`).
- **External drag (between two `TreeTable` instances or from outside the framework).** `DragManager` is generic enough that this falls out later, but no `TreeTable` wiring routes cross-component drops yet.
- **Touch / pointer-event support.** Mouse only for the first cut.
- **Auto-expand on hover during drag.** A common dnd affordance (hover over a collapsed directory for ~700 ms → expand it so its contents become drop targets); explicitly out of scope for this plan, listed as a follow-up.
- **Sort-aware insertion position.** The new row appears at the end of the parent's children list because `AbstractStore.add` appends to `_allRecords` ([`AbstractStore.ts:458-476`](../src/typescript/lib/data/AbstractStore.ts#L458)). Re-sorting before insertion is out of scope.
