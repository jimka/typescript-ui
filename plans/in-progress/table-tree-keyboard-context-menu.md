---
depends-on: [context-menu-keyboard-operation]
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/concepts/accessibility.md
  - packages/lib/src/typescript/lib/overlay/Menu.ts
  - packages/lib/src/typescript/lib/component/tree/Tree.ts
  - packages/lib/src/typescript/lib/component/table/Body.ts
  - packages/lib/src/typescript/lib/core/DOM.ts
  - packages/lib/tests/dom/TestDOM.ts
---

# Table, Tree and List Keyboard Context Menu — Implementation Plan

## Overview

Shift+F10 or the ContextMenu key opens nothing on a [`Tree`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L228) row, a [`List`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L795) row or a [`Table`](../packages/lib/src/typescript/lib/component/table/Body.ts#L289) cell. Their context-menu actions can only be reached with a mouse. The plan [`context-menu-keyboard-operation`](implemented/context-menu-keyboard-operation.md) (called *the dependency* below) left this gap on purpose; this plan closes it.

All three widgets work the same way. The widget's own element holds DOM focus, and the *current item* (the row or cell the arrow keys move) is only marked with `aria-activedescendant`. A browser sends a key-raised `contextmenu` event to the focused element, so the event's target is the widget itself. Each widget finds "the item the menu is for" by starting from the event's target, and the widget's own element is inside no item. (A *pool row* below is one of the few row components a widget recycles as it scrolls.)

| Widget | How the item is found today | Result for a target equal to the widget's element |
|---|---|---|
| `Tree` | [`_handleContextMenu`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L2048) looks for a pool row that contains the target | no row contains the tree; nothing is emitted |
| `Table` / `TreeTable` | [`locateCellFromTarget`](../packages/lib/src/typescript/lib/component/table/Body.ts#L1703) walks up from the target looking for a pool row | no row above the body; `"cellcontextmenu"` is not emitted |
| `List` / `MultiSelectList` | each row has its own listener, which runs only for an event whose target is that row ([AbstractSelectableList.ts:407](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L407)) | no row listener runs |

This was measured in the library's offline test DOM and with real key presses in Chromium; see [Addendum: What was measured](#addendum-what-was-measured).

The fix is one shared function, `resolveContextMenuTarget`, in `component/shared/`. For a mouse it returns the event's own target and coordinates, as today. For a key press on the widget's own element it scrolls the current item into view and returns that item's element and a point under it. Each widget then runs the lookup it already has on the returned element. `Table`, `TreeTable`, `Tree`, `List` and `MultiSelectList` are covered; no consumer code changes, including SQLAdmin's.

Line numbers in this plan are for the dependency's branch tip, `0bfc35701`.

---

## Architecture Decisions

### One shared resolution — pointer target for the mouse, current item for the keyboard

A new module, `component/shared/resolveContextMenuTarget.ts`, holds the rule. Every widget calls it from the `contextmenu` listener it already has and keeps its own "element → item" lookup.[^resolver]

| Event target | Last input | Current item | Menu is for | Menu opens at | Event handed to listeners |
|---|---|---|---|---|---|
| inside an item | any | any | the item under the target | the event's `clientX` / `clientY` | the browser's event |
| the widget's own element | key press | exists | the current item | under the current item | a synthetic event at that point |
| the widget's own element | key press | none | nothing | — | — |
| the widget's own element | pointer press | any | nothing | — | — |

Rows 1 and 4 are today's behaviour. Row 2 is the fix. This follows two precedents:

- [`plans/markdown-editor-context-menu-caret.md`](markdown-editor-context-menu-caret.md) (`$contextMenuNodeFor`) and [`CodeEditor.handleContextMenu`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2761): keep the single native `contextmenu` entry, and when the target is the container, read the item from the widget's current state. No `keydown` handling is added.
- [`selectionsEqual.ts`](../packages/lib/src/typescript/lib/component/shared/selectionsEqual.ts): a free function in `component/shared/`, used by `Tree`, `Body` and `AbstractSelectableList`, not exported from a barrel.

### "From the keyboard" is the same test `Menu.show()` uses

The resolver treats the event as key-raised when its target is the widget's own element **and** `Menu`'s input watch says the user's last press was a key. The input watch is the pair of viewport listeners `Menu` already keeps to decide whether `show()` takes focus. Using the one test for both means a menu positioned at the current item is always the menu that takes the keyboard.[^same-test]

`Menu` exposes the answer through one new `@internal` static, `Menu.lastInputWasKeyPress()`. `Menu._startInputWatch()` loses its `private` modifier, so the three widgets can start the watch when they are constructed. A widget must start it: the watch only knows about presses made after it started, and a consumer may build its `Menu` later than its `Tree`.

### The current item is the focused one, not the selected ones

The keyboard menu is built for the item that carries the focus ring and `aria-activedescendant`. Selection does not choose the item. A multi-selection matters exactly as it does for a right-click.[^current-item]

| Widget | Current item | Backing state |
|---|---|---|
| `Tree` | the focus node | `_focusNode` ([Tree.ts:282](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L282)) |
| `List`, `MultiSelectList` | the focused index | `_focusedIndex` ([AbstractSelectableList.ts:809](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L809)) |
| `Table`, `TreeTable` | the focused cell | `_anchorRecord` × `_focusedColIndex` ([Body.ts:325](../packages/lib/src/typescript/lib/component/table/Body.ts#L325)) |

Worked cases, where focus and selection differ:

| State | Keyboard menu is for | What the actions act on |
|---|---|---|
| `Tree`: rows A, B, C selected with Shift+ArrowDown; focus on C | node C | the listener's choice; `getSelectedNodes()` returns A, B, C, as after a right-click on C |
| `Tree`: Ctrl+click took B out of the selection; focus on B | node B, which is not selected | the listener's choice, as after a right-click on an unselected row |
| `MultiSelectList`: rows 0–1 selected; Ctrl+ArrowDown moved focus to row 2 | index 2 | the listener's choice |
| `Table`: cells B2:C4 selected with the mouse; focused cell C3 | cell C3 | the whole range B2:C4 (the focused cell is inside it) |
| `Table`: same range; arrow keys moved the focused cell to D7 | cell D7 | cell D7 only |

The two `Table` rows are the existing rule in [`resolveContextMenuBounds`](../packages/lib/src/typescript/lib/component/table/Body.ts#L1941); it is not changed. The keyboard menu never changes the selection or the cell range, as a right-click does not.

### With no current item, nothing opens

When the widget has focus but no current item, the resolver changes nothing and the widget does not handle the event. This is exactly what a right-click on the widget's empty area does today.[^no-item]

| Situation | Outcome |
|---|---|
| empty `Table`, `Tree` or `List` | nothing opens |
| focus arrived with `Tab` and no arrow key was pressed yet | nothing opens |
| the current row was removed or filtered away | nothing opens |
| a disabled `List` | nothing opens |

### The menu opens under the current item, scrolled into view first

The resolver asks the widget to reveal its current item, then anchors the menu at the item's bottom-left corner, clamped to the widget's own box. `Tree` anchors at the row's label, so the menu lines up with the text and not with the tree's left edge.[^anchor]

| Item rectangle (viewport) | Widget rectangle | Menu point `(x, y)` |
|---|---|---|
| `left 30, bottom 64` | `0, 0, 200 × 100` | `(30, 64)` |
| `left −80, bottom 224` (scrolled partly out) | `0, 0, 200 × 100` | `(0, 100)` |

The precedent is [`TableHeader.onMenuButtonAction`](../packages/lib/src/typescript/lib/component/table/Header.ts#L721), which opens the column menu at its button's `rect.left, rect.bottom` for a keyboard activation.

### `Tree` and `List` listeners receive a synthetic event positioned at the item

`Tree` and `List` hand their `"contextmenu"` listeners a `MouseEvent`, and every consumer positions its menu from `event.clientX` / `event.clientY`. For a keyboard menu the widgets pass a synthetic `contextmenu` event whose coordinates are the menu point. The listener signatures do not change. `Table` needs no event: `"cellcontextmenu"` already carries plain coordinates.[^synthetic]

The event is built through a new member of the DOM seam, `DOM.sink.createMouseEvent(type, init)`. The DOM seam (`DOM.sink` / `DOM.source` in `core/DOM.ts`) is the one module allowed to touch the real DOM. The new member follows [`DOM.sink.dispatchCustomEvent`](../packages/lib/src/typescript/lib/core/DOM.ts#L1056), which exists so that library code never names a global event constructor. The synthetic event is never dispatched, so its `target` is `null`.

### The `Table` header and open cell editors keep today's behaviour

The keyboard offers what a right-click on the same element offers, so these cases need no code:[^header-editors]

| Focus is on | Shift+F10 does | Keyboard route to the menu |
|---|---|---|
| the header's menu button | nothing, as a right-click on that button does | `Enter` or `Space` on the button opens the column menu |
| a column header cell | cannot happen: header cells are not focus stops | the header's menu button; the menu is the same for every column |
| an open cell editor with a text input | opens the editor's own Cut / Copy / Paste menu; the edit stays open | — |
| an open cell editor without one, such as a combo | whatever a right-click on that editor does (for a combo: nothing); the table's cell menu does not open | close the editor (`Escape`), then Shift+F10 |

### SQLAdmin needs no change

Every SQLAdmin handler reads only `event.clientX` / `event.clientY` and the node or index it is given, so the synthetic event serves them unchanged.[^sqladmin]

| SQLAdmin code | Uses | After this plan |
|---|---|---|
| `frontend/src/navigator/NavigatorTree.ts:199` → `objectMenu.ts:283` | `tree.on("contextmenu", (node, event))`, `menu.show(event.clientX, event.clientY, …)` | menu for the current tree row, under it |
| `frontend/src/roles/RolesTree.ts:97` | same shape | same |
| `frontend/src/shell/QueriesView.ts:313` | `list.on("contextmenu", (index, e))`, `menu.show(e.clientX, e.clientY, …)` | menu for the focused list row, under it |
| result grid, properties tables | no handler; the library's own cell menu | Cut / Copy / Paste for the focused cell |

---

## Public API

No exported signature changes. Two public event contracts widen in behaviour:

```typescript
// component/tree/Tree.ts — unchanged signature
on(event: "contextmenu", listener: (node: TreeNode, event: MouseEvent) => void): this;

// component/list/AbstractSelectableList.ts — unchanged signature
on(event: "contextmenu", listener: (index: number, event: MouseEvent) => void): this;
```

Both now also fire for Shift+F10 / the ContextMenu key, with the current node or index and a synthetic `MouseEvent` (`type: "contextmenu"`, `clientX` / `clientY` under the row, `button: 2`, `target: null`).

One public interface gains a member. A consumer that implements its own `DOMSink` must add it:

```typescript
// core/DOM.ts — interface DOMSink, implemented by ProductionDOMSink
/** New. Builds a mouse event without dispatching it. */
createMouseEvent(type: string, init: MouseEventInit): MouseEvent;
```

Internal (`@internal`, not in the API docs):

```typescript
// overlay/Menu.ts — class Menu
/** New. Whether the user's last input was a key press. */
static lastInputWasKeyPress(): boolean;

/** Existing; `private` removed. Starts the input watch unless it is running. */
static _startInputWatch(): void;
```

```typescript
// component/shared/resolveContextMenuTarget.ts — new module, not barrel-exported
export interface ContextMenuTarget {
    target: Handle | null;   // the element the menu is for
    x:      number;          // viewport point to open the menu at
    y:      number;
    event:  MouseEvent;      // the browser's event, or the synthetic one
}

export function watchContextMenuInput(): void;

export function resolveContextMenuTarget(
    owner: Component,
    event: MouseEvent,
    revealCurrentItem: () => Component | null,
): ContextMenuTarget;
```

No new option, setter or backing field is added to any class.

---

## Internal Structure

Every new function and method gets a JSDoc block (see [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md)). The snippets below omit them for space.

### `component/shared/resolveContextMenuTarget.ts`

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Util } from "~/core/Util.js";
import { Menu } from "~/overlay/Menu.js";

// `MouseEvent.button` of the secondary (right) button, per the UI Events
// specification. The synthetic event reads as the right-click it stands in
// for; the value is a spec constant, so it cannot be derived.
const SECONDARY_BUTTON = 2;

export function watchContextMenuInput(): void {
    Menu._startInputWatch();
}

export function resolveContextMenuTarget(
    owner: Component,
    event: MouseEvent,
    revealCurrentItem: () => Component | null,
): ContextMenuTarget {
    const target  = event.target === null ? null : DOM.source.intern(event.target);
    const own     = { target, x: event.clientX, y: event.clientY, event };
    const ownerEl = owner.getElement();

    // A key-raised contextmenu goes to the focused element, which for these
    // widgets is their own element. `&&` keeps the Menu read off every
    // event that targets an item.
    const fromKeyboard = ownerEl !== null && target === ownerEl && Menu.lastInputWasKeyPress();

    if (!fromKeyboard) {
        return own;
    }

    const item   = revealCurrentItem();
    const itemEl = item?.getElement() ?? null;

    if (item === null || itemEl === null) {
        return own;
    }

    const point = pointUnder(item, owner);

    return {
        target: itemEl,
        x:      point.x,
        y:      point.y,
        event:  DOM.sink.createMouseEvent("contextmenu", { clientX: point.x, clientY: point.y, button: SECONDARY_BUTTON }),
    };
}

function pointUnder(item: Component, owner: Component): { x: number, y: number } {
    const itemRect  = DOM.source.getViewportRect(item);
    const ownerRect = DOM.source.getViewportRect(owner);

    return {
        x: Util.clamp(itemRect.left,   ownerRect.left, ownerRect.right),
        y: Util.clamp(itemRect.bottom, ownerRect.top,  ownerRect.bottom),
    };
}
```

`revealCurrentItem` is called only in the keyboard case. A right-click must never scroll the widget.

### `Tree`

```typescript
private _handleContextMenu(e: MouseEvent): Event.ListenerResult {
    const at = resolveContextMenuTarget(this, e, () => this._revealFocusRow());

    for (const row of this._rowPool) {
        // …the existing loop body, with `target` replaced by `at.target`
        // and the emit changed to:
        this.emit("contextmenu", node, at.event);

        return { prevent: true };
    }
}

private _revealFocusRow(): TreeNodeRenderer | null {
    const focusNode = this._focusNode;
    const index     = focusNode === null ? -1 : this._flatRows.findIndex(r => r.node === focusNode);

    if (index < 0) {
        return null;
    }

    // The same four calls `_selectAtIndex` makes after it moves the focus node.
    this.settleRowMotionIfEntering(index);
    this._scrollIntoView(index);
    this.renderWindow();
    this._updateActiveDescendant();

    for (let i = 0; i < this._rowPool.length; i++) {
        const row   = this._rowPool[i];
        const shown = this._boundIndices[i] >= 0 && row.getNode() === focusNode && !this.isRowMotionLeavingSlot(i);

        if (shown) {
            return row.getRenderer();
        }
    }

    return null;
}
```

The returned component is the row's renderer (its label). The renderer's element is inside the row's element, so the existing loop matches the row.

### `Body` (serves `Table` and `TreeTable`)

```typescript
protected onCellContextMenu(e: MouseEvent): Event.ListenerResult {
    const at      = resolveContextMenuTarget(this, e, () => this.revealFocusedCell());
    const located = this.locateCellFromTarget(at.target);

    if (!located || located.cell.isEditing()) {
        return;
    }

    this._contextMenuCell = { record: located.record, col: located.col };

    this.emit("cellcontextmenu", at.x, at.y);

    return { prevent: true };
}

private revealFocusedCell(): Cell<any> | null {
    const anchor  = this._anchorRecord;
    const visible = anchor !== null && this.getVisibleRecords().includes(anchor);

    if (anchor === null || !visible) {
        return null;
    }

    this.scrollRecordIntoView(anchor);
    this.scrollColumnIntoView(this._focusedColIndex);
    this.renderWindow();
    this._updateActiveDescendant();

    return this.resolveFocusedCell() ?? null;
}
```

The `visible` check is required. [`resolveFocusedCell`](../packages/lib/src/typescript/lib/component/table/Body.ts#L3051) looks the anchor's row index up in `_boundIndices`; for a record that is no longer shown that index is `-1`, which is also the value of an unbound pool slot.

### `AbstractSelectableList` (serves `List` and `MultiSelectList`)

```typescript
// constructor, on the line after the existing `keydown` registration
Event.addListener(this, "contextmenu", this.handleRootContextMenu);

private handleRootContextMenu(e: MouseEvent): Event.ListenerResult {
    const at  = resolveContextMenuTarget(this, e, () => this.revealFocusedRow());
    const idx = this._rowPool.findIndex(row => row.getElement() === at.target);

    if (idx < 0) {
        return;
    }

    this.handleRowContextMenu(idx, at.event);

    return { prevent: true };
}

private revealFocusedRow(): SelectableListRow | null {
    const idx = this._focusedIndex;

    if (idx < 0 || idx >= this._rowPool.length) {
        return null;
    }

    this.scrollIndexIntoView(idx);

    return this._rowPool[idx];
}
```

`Event.addListener` is an exact-target registration, so `handleRootContextMenu` runs only when the event targets the list's own element. The per-row listeners are not touched. The returned `{ prevent: true }` suppresses the browser's menu for the real event; `handleRowContextMenu` calls `preventDefault()` on the synthetic one, which does nothing.

### `DOM.sink.createMouseEvent`

```typescript
// core/DOM.ts — ProductionDOMSink
createMouseEvent(type: string, init: MouseEventInit): MouseEvent {
    return new MouseEvent(type, init);
}
```

```typescript
// tests/dom/TestDOM.ts — RecordingDOMSink, next to dispatchCustomEvent
createMouseEvent(type: string, init: MouseEventInit): MouseEvent {
    this.record('createMouseEvent', type, init);

    return {
        type,
        target:   null,
        clientX:  init.clientX ?? 0,
        clientY:  init.clientY ?? 0,
        button:   init.button ?? 0,
        ctrlKey:  init.ctrlKey ?? false,
        altKey:   init.altKey ?? false,
        shiftKey: init.shiftKey ?? false,
        metaKey:  init.metaKey ?? false,
        preventDefault():  void {},
        stopPropagation(): void {},
    } as unknown as MouseEvent;
}
```

The test environment is Node, which has no `MouseEvent`; the modelled sink returns a plain object, as [`makeEvent`](../packages/lib/tests/dom/TestDOM.ts#L1898) does.

---

## Ordered Implementation Steps

Work test-first: write the step's cases from `## Expected Behaviour`, see them fail, then make the change. Test file setup is in `## Verification`.

1. **Seam.** In [`core/DOM.ts`](../packages/lib/src/typescript/lib/core/DOM.ts#L1041), add `createMouseEvent` to `interface DOMSink` directly after `dispatchEvent`, with a JSDoc block that says: it builds a mouse event and does not dispatch it; it is the library's only construction site for a synthetic mouse event, so library code never names the global constructor; the event's `target` is `null` until something dispatches it. Add the production body to `ProductionDOMSink` directly before `dispatchCustomEvent` ([DOM.ts:2345](../packages/lib/src/typescript/lib/core/DOM.ts#L2345)). Add the modelled body to `RecordingDOMSink` in [`tests/dom/TestDOM.ts`](../packages/lib/tests/dom/TestDOM.ts#L846) directly after `dispatchCustomEvent`. Create `tests/dom/createMouseEvent.test.ts`. Check: cases S1–S2 pass; `npm -w packages/lib run typecheck:test` passes.

2. **`Menu` statics.** In [`overlay/Menu.ts`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1287): remove `private` from `_startInputWatch` and add an `@internal` tag and one sentence to its JSDoc ("Also called by the widgets that open a menu for their current row or cell, so the watch is running before a consumer builds its menu."). Add `static lastInputWasKeyPress(): boolean { return Menu.lastInputWasKey; }` directly after `_stopInputWatch`, with an `@internal` JSDoc block. Change nothing else in `Menu.ts`; `show()` keeps reading the field. Add cases M1–M2 to `tests/overlay/Menu.keyboardSession.test.ts`. Check: M1–M2 pass; `grep -n "private static _startInputWatch" packages/lib/src/typescript/lib/overlay/Menu.ts` prints nothing.

3. **Shared resolver.** Create `packages/lib/src/typescript/lib/component/shared/resolveContextMenuTarget.ts` from `## Internal Structure`. Declare the `ContextMenuTarget` interface from `## Public API` above the functions. Give `ContextMenuTarget`, `watchContextMenuInput`, `resolveContextMenuTarget` and `pointUnder` JSDoc blocks; mark the three exports `@internal Shared by Tree, Body and AbstractSelectableList; not barrel-exported.`, as `selectionsEqual.ts` does. Do not add the module to any `index.ts`. Create `tests/component/shared/resolveContextMenuTarget.test.ts`. Check: R1–R7 pass.

4. **`Tree`.** In [`component/tree/Tree.ts`](../packages/lib/src/typescript/lib/component/tree/Tree.ts):
   - Add `import { resolveContextMenuTarget, watchContextMenuInput } from "~/component/shared/resolveContextMenuTarget.js";` after the `selectionsEqual` import (line 11).
   - In the constructor, call `watchContextMenuInput();` after `this.getAria().setTabIndex(0);` ([Tree.ts:290](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L290)).
   - Change `_handleContextMenu` ([Tree.ts:2048](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L2048)) and add `_revealFocusRow` after it, as in `## Internal Structure`. Delete the now-unused `const target = …` line; read `at.target` in the loop.
   - Update two comments: `_handleContextMenu`'s JSDoc, and the `on("contextmenu", …)` overload's JSDoc ([Tree.ts:974–986](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L974)), using the wording in `## Documentation Impact` → *JSDoc*.
   - Create `tests/component/shared/KeyboardContextMenu.test.ts` with the `Tree` cases.

   Check: T1–T8 pass; `tests/component/tree/Tree.test.ts` passes without edits.

5. **`List`.** In [`component/list/AbstractSelectableList.ts`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts):
   - Add the same import after the `selectionsEqual` import (line 20).
   - In the constructor, directly after `Event.addListener(this, "keydown", this.handleKeyDown);` ([line 906](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L906)), add `Event.addListener(this, "contextmenu", this.handleRootContextMenu);` and `watchContextMenuInput();`.
   - Add `handleRootContextMenu` and `revealFocusedRow` directly before `handleRowContextMenu` ([line 1834](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1834)).
   - Update the `on()` JSDoc paragraph about `"contextmenu"` ([lines 1540–1543](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1540)) and `handleRowContextMenu`'s JSDoc.
   - Add the `List` cases to `tests/component/shared/KeyboardContextMenu.test.ts`.

   Check: L1–L6 pass; `tests/component/list/List.test.ts`, `MultiSelectList.test.ts` and `tests/component/dispose-listener-teardown.test.ts` pass without edits.

6. **`Body`.** In [`component/table/Body.ts`](../packages/lib/src/typescript/lib/component/table/Body.ts):
   - Add the same import after the `selectionsEqual` import (line 21).
   - In the constructor, call `watchContextMenuInput();` after `this._rowHeight = tableRowHeight();` ([line 367](../packages/lib/src/typescript/lib/component/table/Body.ts#L367)).
   - Change `onCellContextMenu` ([line 2327](../packages/lib/src/typescript/lib/component/table/Body.ts#L2327)) and add `revealFocusedCell` directly after it.
   - Update `onCellContextMenu`'s JSDoc, the `"cellcontextmenu"` sentence in `on()`'s JSDoc ([lines 2421–2422](../packages/lib/src/typescript/lib/component/table/Body.ts#L2421)), and the first sentence of `Table.showCellMenu`'s JSDoc ([Table.ts:1912](../packages/lib/src/typescript/lib/component/table/Table.ts#L1912)): the menu is also opened from the keyboard for the focused cell.
   - Add the `Table` cases to `tests/component/shared/KeyboardContextMenu.test.ts`.

   Do not touch `resolveContextMenuBounds`, `TreeBody.ts`, `Header.ts`, any cell or any cell editor. Check: B1–B7 and TB1–TB2 pass; `tests/component/table/Body.test.ts`, `Table.test.ts` and `TreeBody.test.ts` pass without edits.

7. **Demo.** The demo app has no `Tree` or `List` with a context menu, so the manual cases need two.
   - [`src/typescript/ContentBoxPanel.ts`](../packages/lib/src/typescript/ContentBoxPanel.ts#L562), `buildScrollChromeRow`: add `Menu` to the existing `@jimka/typescript-ui/overlay` import. After `tree.expandAll();` build one `const treeMenu = Menu();` and register `tree.on("contextmenu", (node, event) => treeMenu.show(event.clientX, event.clientY, [...]))` with two rows, `Open` and `Rename`, each calling `Notification.show(<row text> + " " + node.label, "info")`.
   - [`src/typescript/SplitPanel.ts`](../packages/lib/src/typescript/SplitPanel.ts#L35): import `Menu` and `Notification` from `@jimka/typescript-ui/overlay`. Before the first `list.addItem(...)` register `list.on("contextmenu", (index, e) => listMenu.show(e.clientX, e.clientY, [...]))` with the same two rows naming `index`.

   Check: `npm run typecheck`.

8. **Documentation.** Make the edits in `## Documentation Impact`.

9. **Verify.** Run `## Verification` in full.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/shared/resolveContextMenuTarget.ts` |
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` (one JSDoc sentence) |
| Modify | `packages/lib/src/typescript/ContentBoxPanel.ts` (demo) |
| Modify | `packages/lib/src/typescript/SplitPanel.ts` (demo) |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Create | `packages/lib/tests/dom/createMouseEvent.test.ts` |
| Create | `packages/lib/tests/component/shared/resolveContextMenuTarget.test.ts` |
| Create | `packages/lib/tests/component/shared/KeyboardContextMenu.test.ts` |
| Modify | `packages/lib/tests/overlay/Menu.keyboardSession.test.ts` |
| Modify | `packages/lib/docs/components/Tree.md` |
| Modify | `packages/lib/docs/components/List.md` |
| Modify | `packages/lib/docs/components/MultiSelectList.md` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/components/TreeTable.md` |
| Modify | `packages/lib/docs/components/Menu.md` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |
| Modify | `packages/lib/docs/recipes/right-click-menu.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

"Key input" means a `keydown` of a non-modifier key was the last of the two watched events (`keydown`, `pointerdown`); tests dispatch `{ key: 'F10', shiftKey: true }` or `{ key: 'ContextMenu' }` at the widget's element. "Pointer input" means a `pointerdown` was. "Synthetic event" means an event that is not the dispatched one and came from `DOM.sink.createMouseEvent`. "Menu point of X" means `DOM.source.getViewportRect(X)`'s `left` and `bottom`, each clamped to the widget's own `getViewportRect`.[^oracle]

### Seam (offline; S1 under jsdom)

| # | Given | Then |
|---|---|---|
| S1 | `new ProductionDOMSink().createMouseEvent("contextmenu", { clientX: 5, clientY: 7, button: 2 })` | a `MouseEvent`; `type` is `"contextmenu"`; `clientX` 5, `clientY` 7, `button` 2; `target` is `null` |
| S2 | the same call on the modelled `DOM.sink` | an object with the same four values, `target` `null`, a callable `preventDefault`; the sink recorded one `createMouseEvent` write |

### `Menu` statics (offline)

| # | Given | Then |
|---|---|---|
| M1 | no `Menu` constructed; `Menu._startInputWatch()`; a `keydown` `F10`; then a `pointerdown`; then `Menu._stopInputWatch()` | `Menu.lastInputWasKeyPress()` is `false`, then `true`, then `false`, then `false` |
| M2 | `Menu._startInputWatch()` twice, `Menu._stopInputWatch()` once, then a `keydown` | `lastInputWasKeyPress()` is `false`: the second start registered nothing, so one stop removed the watch |

### Resolver (offline)

`owner` is a root `Component` sized 200 × 100; `item` is a child at `x 30, y 40`, sized 50 × 24; `inner` is a second child. `reveal` is a spy returning `item`.

| # | Last input | Event target | `reveal` returns | Result |
|---|---|---|---|---|
| R1 | pointer | `inner` | — | the event's own target, `clientX`, `clientY` and event; `reveal` not called |
| R2 | key | `inner` | — | as R1; `reveal` not called |
| R3 | key | `owner` | `item` | `target` is `item`'s element; `x` 30, `y` 64; a synthetic event with `clientX` 30, `clientY` 64, `button` 2 |
| R4 | key | `owner` | `item` moved to `x −80, y 200` | `x` 0, `y` 100 |
| R5 | key | `owner` | `null` | the event's own target, coordinates and event |
| R6 | pointer | `owner` | — | as R5; `reveal` not called |
| R7 | no `Menu` built; `watchContextMenuInput()`, then a key | `owner` | `item` | as R3 |

### `Tree` (offline)

A mounted tree, 200 × 120, 60 single-level nodes, focused.

| # | Given | Then |
|---|---|---|
| T1 | `ArrowDown` ×3, key input, `contextmenu` dispatched at the tree's element with `clientX 100, clientY 60` | the `"contextmenu"` listener runs once with node index 2 and a synthetic event at the menu point of that row's renderer; the dispatched event's `preventDefault` ran once |
| T2 | as T1 with `{ key: 'ContextMenu' }` | as T1 |
| T3 | `End`, `setScrollY(0)`, key input, `contextmenu` at the tree's element | the listener runs with node index 59; the scroller's `getScrollY()` is `1320` (`60 × 24 − 120`) |
| T4 | no arrow key pressed, key input, `contextmenu` at the tree's element | the listener does not run; `preventDefault` did not run |
| T5 | `ArrowDown`, pointer input, `contextmenu` at the tree's element | as T4 |
| T6 | `ArrowDown`, key input, `contextmenu` dispatched at the element of the row showing node 4 | the listener runs with node 4 and the dispatched event itself |
| T7 | T1 with a `"selection"` listener | `getSelectedNodes()` is unchanged; the `"selection"` listener did not run for the menu |
| T8 | `ArrowDown`, `ArrowDown` with `shiftKey` ×2, key input, `contextmenu` at the tree's element | the listener runs with node index 2; `getSelectedNodes()` has 3 nodes |

### `List` and `MultiSelectList` (offline)

A mounted `List` of `Apple`, `Banana`, `Cherry`, `Date`, 200 × 200, focused.

| # | Given | Then |
|---|---|---|
| L1 | `ArrowDown` ×2, key input, `contextmenu` at the list's element | the `"contextmenu"` listener runs once with index 1 and a synthetic event at the menu point of row 1; `preventDefault` ran once on the dispatched event |
| L2 | a fresh list (`getFocusedIndex()` is `-1`), key input, `contextmenu` at the list's element | the listener does not run; `preventDefault` did not run |
| L3 | `ArrowDown`, pointer input, `contextmenu` at the list's element | as L2 |
| L4 | a `MultiSelectList`: `ArrowDown`, `ArrowDown` with `shiftKey`, `ArrowDown` with `ctrlKey`, key input, `contextmenu` at its element | the listener runs with index 2; the selection is still rows 0 and 1 |
| L5 | key input, `contextmenu` dispatched at row 3's element | the listener runs with index 3 and the dispatched event itself |
| L6 | `setEnabled(false)`, key input, `contextmenu` at the list's element | the listener does not run |

### `Table` and `TreeTable` (offline)

A mounted `Body` over 40 records with string fields `a`, `b`, `c`, 300 × 100, focused.

| # | Given | Then |
|---|---|---|
| B1 | `ArrowDown` ×2, `ArrowRight`, key input, `contextmenu` at the body's element with `clientX 150, clientY 50` | `"cellcontextmenu"` fires once with the menu point of the focused cell; `_contextMenuCell` is the second record, column 1; `_rangeAnchor` and `_rangeFocus` are still `null`; `preventDefault` ran once |
| B2 | no arrow key pressed, key input, `contextmenu` at the body's element | `"cellcontextmenu"` does not fire; `preventDefault` did not run |
| B3 | `ArrowDown`, pointer input, `contextmenu` at the body's element | as B2 |
| B4 | `End`, `setScrollY(0)`, key input, `contextmenu` at the body's element | `"cellcontextmenu"` fires; `_contextMenuCell.record` is the last record; the scroller's `getScrollY()` is greater than 0 |
| B5 | B1 with a spy on `scrollColumnIntoView`, cleared after the arrow keys | during the `contextmenu` dispatch the spy ran with `1` |
| B6 | `ArrowDown`, then `setRowVisible` hides the anchor record, key input, `contextmenu` at the body's element | `"cellcontextmenu"` does not fire |
| B7 | `_rangeAnchor` / `_rangeFocus` set to rows 0–2 × columns 0–1; B1's keys and `contextmenu`; then `copyContextMenuSelection()` | the clipboard write holds 3 rows × 2 columns. After `ArrowRight` once more (column 2, outside the range), key input and a second `contextmenu`, `copyContextMenuSelection()` writes that one cell |
| TB1 | a mounted `Table` (3 records, fields `a`, `b`): `ArrowDown` ×2, `ArrowRight`, key input, `contextmenu` at its body's element | `Menu.prototype.show` ran once with rows `Cut`, `Copy`, `Paste`; the menu is the top layer and the active element; after `focusItem(1)` and `activateFocused()` the clipboard write is `"b1"` and the body's element is the active element |
| TB2 | a mounted `TreeBody` (the setup of `tests/component/table/TreeBody.test.ts`): `ArrowDown`, key input, `contextmenu` at its element | `"cellcontextmenu"` fires once |

### Unchanged (offline)

`tests/component/tree/Tree.test.ts`, `tests/component/list/List.test.ts`, `tests/component/list/MultiSelectList.test.ts`, `tests/component/table/Body.test.ts`, `tests/component/table/Table.test.ts`, `tests/component/table/TreeBody.test.ts`, `tests/component/table/HeaderMenuButton.test.ts` and `tests/overlay/Menu.keyboardSession.test.ts`'s existing cases pass without edits.

### Needs manual verification

Real key presses on the demo app (`npm run dev`). Run every case in Chromium. Repeat MV1, MV3, MV6 and MV7 in Firefox and in WebKit; the planner ran neither.[^engines] On Windows, also run MV2: the ContextMenu key raises `contextmenu` on key release there, which was not checked.

| # | Where | Do | Expect |
|---|---|---|---|
| MV1 | `#/content-box`, "Tree (VirtualScroller)" | click a row, `ArrowDown` ×2, Shift+F10, `ArrowDown`, `Enter`, `ArrowDown` | the menu opens directly under the current row's label with `Open` highlighted; the notification names the current row and `Rename`; the last `ArrowDown` moves the tree's row, so focus is back on the tree |
| MV2 | same | the ContextMenu key, `Escape` | as MV1's menu; `Escape` closes it and the tree has focus |
| MV3 | same | `End`, scroll the tree to the top with the wheel, Shift+F10 | the tree scrolls back to its last row and the menu opens under it |
| MV4 | same, after a reload | `Tab` to the tree, Shift+F10 | nothing opens; no browser menu |
| MV5 | same; then `#/split`, the list | right-click a tree row; then right-click the empty area below the list's last row | the menu opens at the pointer, takes no focus and highlights no row; on the list's empty area nothing opens |
| MV6 | `#/split`, the list | click `One`, `ArrowDown` ×2, Shift+F10, `Enter` | the menu opens under `Three`; the notification names index 2; the list has focus |
| MV7 | `#/property-grid` | click a cell, `ArrowDown`, `ArrowRight`, Shift+F10, `ArrowDown`, `Enter`, then paste into a text field | `Cut` / `Copy` / `Paste` opens under the focused cell with `Cut` highlighted; the pasted text is that cell's text; the table has focus |
| MV8 | same | click a cell, Shift+click a cell further down and to the right, Shift+F10, `ArrowDown`, `Enter`, paste into a text editor | the whole block between the two cells is pasted, tab- and newline-separated |
| MV9 | `#/misc`, "Show window with table (column spec)!" | start editing a string cell, type, Shift+F10, `Escape`, type | the editor's own `Cut` / `Copy` / `Paste` menu opens; the edit stays open; typing continues (unchanged from the dependency) |
| MV10 | `#/property-grid`, a combo cell | `Enter` to open its editor, Shift+F10 | nothing opens; the editor stays open |
| MV11 | `#/property-grid` | focus the header's menu button, Shift+F10; then `Enter` | Shift+F10 opens nothing; `Enter` opens the column menu, worked from the keyboard |
| MV12 | `#/misc`, the wide table window | `ArrowRight` to a column near the right edge, scroll the table back to the left with the scrollbar, Shift+F10 | the table scrolls the focused cell into view and the menu opens under it |
| MV13 | `#/misc`, the tree-table window | `ArrowDown`, Shift+F10 | the cell menu opens under the focused cell |
| MV14 | any case above, in a window shorter than the menu's room below the item | Shift+F10 | the menu flips above its point and stays on screen |
| MV15 | optional, SQLAdmin against `npm run build:lib` | Shift+F10 on a navigator tree row, a roles tree row, a saved-queries row and a result cell | each opens the menu a right-click on that item opens, under it, with no SQLAdmin change |

---

## Verification

Setup for the three new test files:

- Node environment and `installTestDOM` per test, as in [`tests/overlay/Menu.keyboardSession.test.ts`](../packages/lib/tests/overlay/Menu.keyboardSession.test.ts). `tests/dom/createMouseEvent.test.ts` starts with `// @vitest-environment jsdom` for S1 and installs the modelled DOM explicitly for S2, as [`tests/dom/countElements.test.ts`](../packages/lib/tests/dom/countElements.test.ts) does.
- `afterEach`: dispose every component the test built, call `Menu._stopInputWatch()` and `Tooltip._stopPointerWatch()`, `vi.restoreAllMocks()`, then `DOM.reset()`. A component left undisposed keeps its `keydown` registration across the DOM swap, and the next test's key presses then reach nothing.[^pin]
- Mounting: `getElement(true)`, `setConnected(el, true)`, `setWidth` / `setHeight`, a render (`(tree as any).renderWindow()`, `(body as any).renderWindow()`, `list.doLayout()`), then `DOM.sink.focus(el)`.
- Input: `DOM.sink.dispatchEvent(el, makeEvent(el, 'keydown', { key: 'F10', shiftKey: true }))` and `makeEvent(el, 'pointerdown')`. For "`preventDefault` ran", replace the event's `preventDefault` with a counter before dispatching, as [`tests/core/BodyContextMenu.test.ts`](../packages/lib/tests/core/BodyContextMenu.test.ts#L31) does.
- TB1: the recipe of [`Table.test.ts:95`](../packages/lib/tests/component/table/Table.test.ts#L95) (`vi.spyOn(Menu.prototype, 'show')`); read the clipboard write from `(DOM.sink as RecordingDOMSink).writes` with `op === 'writeClipboardText'`.

Commands, from the repo root:

1. `npm run typecheck`
2. `npm -w packages/lib run typecheck:test`
3. `cd packages/lib && npx vitest run tests/dom/createMouseEvent.test.ts tests/component/shared tests/overlay/Menu.keyboardSession.test.ts tests/component/tree tests/component/list tests/component/table/Body.test.ts tests/component/table/Table.test.ts tests/component/table/TreeBody.test.ts tests/component/dispose-listener-teardown.test.ts tests/unit/import-without-dom.test.ts`
4. `npm test` — the whole suite. `Tree` and `List` now start `Menu`'s input watch when constructed. If a file that passed before now has a test whose dispatched `keydown` or `pointerdown` no longer reaches a viewport listener, add `Menu._stopInputWatch()` to that file's teardown; change no expectation.[^pin]
5. `npm run lint`
6. `npm run docs:api`, `npm run docs:llms:check`
7. The MV cases, on `npm run dev`.

Grep checks:

- `grep -rn "resolveContextMenuTarget(" packages/lib/src/typescript/lib` — exactly four hits outside comments: the definition, `Tree.ts`, `Body.ts`, `AbstractSelectableList.ts`.
- `grep -rn "new MouseEvent" packages/lib/src/typescript/lib` — exactly one hit, in `core/DOM.ts`.
- `git diff --stat` lists no file under `component/table/cell/`, `component/container/`, `component/editor/` or `component/diagram/`, and neither `Header.ts` nor `TreeBody.ts`.
- `git -C /home/jika/typescript/sqladmin status --short` is unchanged by this work.

---

## Documentation Impact

No barrel changes. `DOMSink` is already exported from `core`; the new shared module and the two `Menu` statics are `@internal`.

**JSDoc** (source comments; describe behaviour in prose, do not `{@link}` a private or `@internal` member from a public comment):

- `Tree.on("contextmenu", …)`: "fires when a node row is right-clicked, with the node under the cursor and the browser's `MouseEvent`. It also fires when Shift+F10 or the ContextMenu key is pressed while the tree has focus and a current row: the listener then receives the current node and a synthetic `contextmenu` event whose `clientX` / `clientY` sit under that row, which is scrolled into view first; the synthetic event's `target` is `null`. Either way `clientX` / `clientY` position a context menu, the browser's own menu is suppressed, and the selection is left unchanged."
- `AbstractSelectableList.on(…)`: the same two sentences for "the focused row" and "the row index".
- `Body.on(…)`: "`"cellcontextmenu"` fires when a data cell is right-clicked, carrying the event's viewport coordinates, and when the keyboard asks for the focused cell's menu, carrying the point under that cell."

**Pages:**

- **[`docs/components/Tree.md`](../packages/lib/docs/components/Tree.md)**
  - New `## Keyboard` section before `## Common methods`. Opening line: the tree is one focus stop; the current row is marked with `aria-activedescendant`. Table: `ArrowDown` / `ArrowUp` (next / previous visible row; with `Shift`, extend the selection), `ArrowRight` (expand a collapsed node, or move to an expanded node's first child), `ArrowLeft` (collapse an expanded node, or move to the parent), `Home` / `End` (first / last visible row; with `Shift`, extend the selection), `Shift+F10` / ContextMenu key (fire `"contextmenu"` for the current row).
  - New `## Context menu` section after it: `on("contextmenu", (node, event) => menu.show(event.clientX, event.clientY, items))` serves the mouse and the keyboard; from the keyboard the node is the current row, the row is scrolled into view, and the event is a synthetic one positioned under the row; the selection is not changed and a multi-selection is read with `getSelectedNodes()`; with no current row nothing fires. Link to `/components/Menu#keyboard`.
  - `## Common methods`: add the row `on("contextmenu", fn)`.
- **[`docs/components/List.md`](../packages/lib/docs/components/List.md)** — `## Keyboard` table: add the row `Shift+F10` / ContextMenu key — "Fire `"contextmenu"` for the focused row." Add a `## Context menu` section after `## Selection events` with the same content as `Tree`'s, for `(index, event)`.
- **[`docs/components/MultiSelectList.md`](../packages/lib/docs/components/MultiSelectList.md)** — `## Selection model`: one sentence after the table: the context menu, from the mouse or from Shift+F10, is for the row pointed at or focused and does not change the selection; link to `/components/List#context-menu`.
- **[`docs/components/Table.md`](../packages/lib/docs/components/Table.md)**
  - New `## Keyboard` section directly before `## Dirty state`. Table for the focused body: `ArrowUp` / `ArrowDown` (move the current row), `Home` / `End`, `PageUp` / `PageDown`, `ArrowLeft` / `ArrowRight` (move the current cell along the row), `Enter` (edit the current cell; on a checkbox cell, move to the next row), `Space` (edit or toggle the current cell), `Tab` / `Shift+Tab` (next / previous cell), `Ctrl/Cmd+C` / `X` / `V` (copy, cut, paste the cell range), `Shift+F10` / ContextMenu key (open the Cut / Copy / Paste menu for the current cell). Below the table: the menu acts on the selected cell range when the current cell is inside it, otherwise on the current cell; with a text cell editor open, Shift+F10 opens that editor's own menu; the column menu is reached with `Enter` or `Space` on the header's menu button, since header cells are not focus stops.
  - `## Sorting and selection`: in the bullet that names the cell context menu, add "or press Shift+F10" next to "right-click a cell".
- **[`docs/components/TreeTable.md`](../packages/lib/docs/components/TreeTable.md)** — `## Keyboard`: add Shift+F10 / ContextMenu key to the list of inherited keys.
- **[`docs/components/Menu.md`](../packages/lib/docs/components/Menu.md)** — `### Context menus (show())`: one sentence after "nothing extra is wired": a `Tree`, `List`, `MultiSelectList`, `Table` or `TreeTable` holds focus on its own element, so it opens the menu for its current row or cell and under it; link to each page's section.
- **[`docs/concepts/accessibility.md`](../packages/lib/docs/concepts/accessibility.md)**
  - New `## Context menus from the keyboard` section directly before `## Building an accessible custom widget`: Shift+F10 and the ContextMenu key open the same menu a right-click opens. A control that holds focus itself (a button, a tab, a text field) gets the menu for itself. A `Tree`, `List` or `Table` gets it for its current row or cell, under that item, scrolled into view first; with no current item nothing opens. The menu takes focus and returns it on close (link `/components/Menu#keyboard`).
  - `## Testing` → *Keyboard-only*: extend the context-menu clause with "including on a tree row, a list row and a table cell".
- **[`docs/concepts/dom-seams.md`](../packages/lib/docs/concepts/dom-seams.md)** — in the sentence listing "native event listeners (`addListener` / `removeListener` / `dispatchEvent`)", add `createMouseEvent`.
- **[`docs/recipes/right-click-menu.md`](../packages/lib/docs/recipes/right-click-menu.md)** — `## Notes`: one bullet: for a `Tree` or a `List`, subscribe to the widget's own `"contextmenu"` event instead of a DOM listener; it names the row for a right-click and the current row for Shift+F10.
- **[`docs/reference/changelog/next.md`](../packages/lib/docs/reference/changelog/next.md)**
  - `## Fixed` → `### Components`: **Shift+F10 opens the context menu of the current tree row, list row or table cell.** Say what was wrong (the keys opened nothing: the event goes to the widget, not to a row), that `Tree`, `List`, `MultiSelectList`, `Table` and `TreeTable` now open the menu for the current item and under it, scrolled into view first, that the menu is the one a right-click on that item opens, that the selection is not changed, and that nothing opens with no current item. State the one contract change: a `Tree` or `List` `"contextmenu"` listener receives a synthetic event for a keyboard menu, with `clientX` / `clientY` under the row and a `null` `target`. End with "No consumer action is needed unless a listener reads `event.target`."
  - `## Added` → `### Core`: **`DOMSink.createMouseEvent(type, init)`** builds a mouse event without dispatching it. A custom `DOMSink` implementation must add the member.

---

## Potential Challenges

- **Tests that leave a component undisposed.** A `Tree`, `List` or `Body` registers `keydown` on itself; left alive across `DOM.reset()` it stops later tests' key presses from being delivered. Dispose everything in `afterEach`, as `## Verification` says.
- **The modelled geometry does not see virtual-row offsets.** Offline, a `Tree` row's or a `Table` cell's rectangle does not include the scroller's row offset. Assert the menu point against `DOM.source.getViewportRect(item)` as `## Expected Behaviour` defines it, never against a hand-computed pixel value, except in R3 and R4.
- **Statics through `callable()`.** `Menu` is exported through `callable()`. `Menu._startInputWatch()` and `Menu.lastInputWasKeyPress()` are reached through the callable the same way `Menu._stopInputWatch()` already is.
- **A menu that flips upward covers the item.** `Menu.show()` anchors at a point, so near the bottom of the window the menu grows upward from the item's bottom edge and covers the item. This is accepted; see `## Non-Goals`.
- **A listener that reads `event.target`.** The synthetic event has none. No library or SQLAdmin listener reads it; the changelog and the two component pages say so.
- **Overlap with `feature/spatial-navigation-redesign`** (unmerged). That branch adds one import and one module-level `registerNavigationLandingRing(...)` call to `Tree.ts` (after line 16) and to `Body.ts` (after line 29), rewrites `accessibility.md`'s "Spatial focus navigation" section (old lines 76–85 and 163–205), and adds changelog entries. This plan adds an import at `Tree.ts` line 12 and `Body.ts` line 22, a new `accessibility.md` section before "Building an accessible custom widget", and changelog entries. The `Tree.ts` import hunks sit five lines apart and may need a hand merge (keep both lines); the rest does not overlap. The two behaviours agree: that branch's landing ring marks a `Tree` or table body that has focus but no current item, which is the state where this plan opens nothing.
- **Overlap with the pending plan `modal-dialog-focus-trap`.** That plan was not on disk when this one was written. From its subject (the `Tab` key leaving a modal `Dialog` through an open menu) it will most likely edit `overlay/Dialog.ts`, `overlay/Menu.ts`'s key handling, `accessibility.md` and `changelog/next.md`. This plan's `Menu.ts` change is two members beside `_stopInputWatch` and touches no key handling; expect at most adjacent-line merges in `Menu.ts`, `accessibility.md` and `next.md`. Whichever plan is implemented second should re-read those three files first.

---

## Critical Files

- [`component/shared/selectionsEqual.ts`](../packages/lib/src/typescript/lib/component/shared/selectionsEqual.ts) — precedent for the new module's place, shape and `@internal` note.
- [`plans/markdown-editor-context-menu-caret.md`](markdown-editor-context-menu-caret.md) and [`component/editor/CodeEditor.ts`](../packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2761) — precedent: one native `contextmenu` entry; a container target is resolved from current state.
- [`component/table/Header.ts`](../packages/lib/src/typescript/lib/component/table/Header.ts#L721) — precedent: a keyboard-opened menu anchored at an element's `rect.left, rect.bottom`.
- [`overlay/Menu.ts`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L139) — the input watch: `lastInputWasKey` (:139), `_recordKeyInput` (:155), `show` (:374, reads the field at :388), `_startInputWatch` (:1287), `_stopInputWatch` (:1308).
- [`plans/implemented/context-menu-keyboard-operation.md`](implemented/context-menu-keyboard-operation.md) — the dependency; its Implementation Notes 12 and 13 explain the test teardown rule.
- [`core/DOM.ts`](../packages/lib/src/typescript/lib/core/DOM.ts#L1041) — `DOMSink.dispatchEvent` (:1041), `dispatchCustomEvent` (:1056, production :2345), `getViewportRect` (:1344).
- [`tests/dom/TestDOM.ts`](../packages/lib/tests/dom/TestDOM.ts#L846) — `RecordingDOMSink.dispatchCustomEvent` (:846), `makeEvent` (:1898), `getViewportRect` (:1201).
- [`component/tree/Tree.ts`](../packages/lib/src/typescript/lib/component/tree/Tree.ts#L2048) — `_handleContextMenu` (:2048), `_selectAtIndex` (:1804), `_updateActiveDescendant` (:2157), the `on("contextmenu")` overload (:986).
- [`component/table/Body.ts`](../packages/lib/src/typescript/lib/component/table/Body.ts#L2327) — `onCellContextMenu` (:2327), `locateCellFromTarget` (:1703), `resolveContextMenuBounds` (:1941), `resolveFocusedCell` (:3051), `scrollRecordIntoView` (:3181), `scrollColumnIntoView` (:3199).
- [`component/list/AbstractSelectableList.ts`](../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1834) — the row listener (:407), the constructor (:872), `handleRowContextMenu` (:1834), `scrollIndexIntoView` (:2252).
- [`component/table/Table.ts`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1921) — `showCellMenu` (:1921) and its wiring (:423); not changed beyond one comment.
- [`tests/overlay/Menu.keyboardSession.test.ts`](../packages/lib/tests/overlay/Menu.keyboardSession.test.ts), [`tests/component/table/Body.test.ts`](../packages/lib/tests/component/table/Body.test.ts#L1281), [`tests/component/tree/Tree.test.ts`](../packages/lib/tests/component/tree/Tree.test.ts#L3733), [`tests/dom/countElements.test.ts`](../packages/lib/tests/dom/countElements.test.ts) — the test recipes.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — *Event handling* and *Minimize direct DOM access*.

---

## Non-Goals

- **Shift+F10 on the `Table` header's menu button, and focusable header cells.** `Enter` on the button already reaches the one column menu.
- **An "empty area" menu** for any of the three widgets. None exists for the mouse.
- **`DiagramView` nodes and the `Split` collapse button.** Neither can take keyboard focus, so there is no current item to open a menu for.
- **`TabBar`.** A tab is itself the focused element; its keyboard menu already works on the dependency branch.
- **Changing the `"contextmenu"` listener signatures** of `Tree` or `List`, or adding a `Table`-level cell context-menu event.
- **Selecting cell ranges from the keyboard.** The cell range is set only by the mouse, so Ctrl/Cmd+C after keyboard-only navigation copies nothing; this plan does not change that. The keyboard menu's `Copy` copies the focused cell.
- **Anchoring the menu to the item's rectangle**, so that a menu that flips upward sits above the item. `Menu.show()` takes a point; a rectangle-anchored `show()` is a `Menu` change of its own.
- **Moving the input watch out of `Menu`** into a core module.
- **Any change in SQLAdmin**, and any change to cell editors, `TreeBody`, `TableHeader` or `Menu`'s key handling.
- **Screen-reader "open context menu" commands** (such as VoiceOver's). They may target the row element directly, which the existing target-based path already handles; this was not tested.

---

## Addendum: What was measured

**Offline, on the dependency branch tip `0bfc35701`, unmodified source.** A `keydown` of Shift+F10 followed by a `contextmenu` dispatched at the widget's own element, with a current item set by arrow keys:

| Widget | Listener ran | Default prevented |
|---|---|---|
| `Tree` (`"contextmenu"`) | no | no |
| `Body` (`"cellcontextmenu"`) | no | no |
| `List` (`"contextmenu"`) | no | no |

**Chromium, real key presses (chrome-devtools) on the demo app.** The widget's element had focus and a current item. "Today" is unmodified source with a throwaway `contextmenu` listener on the tree and the list; "Prototype" is this plan's change applied as a throwaway patch.

| Focused element (rectangle) | Current item | Key-raised `contextmenu` | Today | Prototype |
|---|---|---|---|---|
| tree, `0, 0, 200 × 900` | row "Border", `y 48–72`, label at `x 36` | target: the tree element; `clientX 100, clientY 450` (the tree's centre); `button −1` | listener does not run; nothing opens | listener gets node "Border" and a synthetic event at `(36, 72)`; the menu opens there, takes focus, highlights its first row; `ArrowDown`, `Enter` runs the second row's action; focus returns to the tree |
| list, `212, 450, 200 × 446` | row "Two", `213, 473, 198 × 22` | target: the list element; `(312, 673)`; `button −1` | listener does not run | listener gets index 1 at `(213, 495)`; `Enter` runs the first row's action; focus returns to the list |
| table body, `213, 26, 1062 × 77` | cell "Alice", `738, 46, 525 × 20` | target: the `<tbody>`; `(744, 64)`; `button −1` | nothing opens (measured by the dependency plan) | `Cut` / `Copy` / `Paste` opens at `(738, 66)` and takes focus |
| an open combo cell editor | — | target: the editor's combobox element | — | nothing opens; the editor stays open |
| the header's menu button | — | target: the `<button>`, whose parent is the `<thead>` | — | nothing opens |

The ContextMenu key gave the same event and the same result as Shift+F10 on the tree. The event is a trusted `PointerEvent` with `shiftKey: false` even for Shift+F10.

In Chromium the event's coordinates are the centre of the focused element, so a widget that used them would open the menu in the middle of the tree, not at the row.

The prototype also ran against 52 existing test files (every file that imports `Tree`, `List`, `MultiSelectList`, `ComboBox` or `AutoCompleteField`, plus the table, menu-session, dispose-registry, spatial-navigation, focus-traversal and import-without-DOM suites): all passed without edits, and `eslint` and `tsc` were clean. The whole suite was not run. The patch is kept at `~/.claude/projects/-home-jika-typescript-sqladmin/scratch-keep/plans2/table-tree-context-menu/prototype.diff`. This plan differs from it in two details: `List` routes the keyboard case through `handleRowContextMenu` rather than firing its listeners directly, and the `Menu` static is named `lastInputWasKeyPress`.

---

## Notes

[^resolver]: Three other shapes were considered and rejected. (1) Per-widget code: each widget would repeat the "is this key-raised" test, the reveal-then-anchor order and the synthetic event, and the three copies would drift. (2) Re-dispatching a synthetic `contextmenu` at the current item's element, so the existing target-based path runs unchanged: it is the smallest diff, but the widget would dispatch a DOM event at another component's element, which is the kind of reach `ARCHITECTURE.md`'s event rules forbid for listening, and every ancestor and viewport listener would see two `contextmenu` events for one key press. (3) Handling Shift+F10 and the ContextMenu key in each widget's `keydown` listener: it would need a key table that differs by platform (Windows raises the menu on key release), would have to suppress the native event in every browser, and breaks the single-entry rule the Markdown editor plan set. The resolver keeps one native entry and lets each widget reuse the lookup it already has, which is why a subclass such as `TreeBody` needs no change.

[^same-test]: A `contextmenu` event does not say reliably how it was raised: Chromium reports `button: -1` for a key (measured, see the addendum), other engines report other values, and a right-click on a widget's empty background also targets the widget's own element. The target alone therefore cannot separate "Shift+F10" from "right-click on the empty area", and those two must differ: a pointer on the empty area must not open a menu for a row elsewhere. `Menu.show()` already answers "was the last press a key" with its input watch (dependency plan, *"Opened from the keyboard" means the last input was a key press*). If the widgets used any other rule, the two could disagree and produce a menu placed at the row that does not take focus, or a focused menu placed at stale coordinates. The watch stays in `Menu`: extracting it into a core module would move about sixty lines the dependency has just added and the three test files that call `Menu._stopInputWatch()`, for no change in behaviour. The widgets start the watch themselves because a consumer may build its `Menu` lazily inside the listener (the library's own `SelectableText` and `Markdown` do); without an earlier start the key press would never be recorded, the event would be treated as a pointer event, and the listener would never run. `CellEditor` already imports `Menu` for a session query, so a table-side import of `Menu` is established; `Tree` and `List` reach it only through the shared module.

[^current-item]: The current item is what every other key acts on (`Enter` edits the focused cell, `ArrowRight` expands the focus node), it is what assistive technology announces, and it is the only item that is always a single one. Selection can be empty, can be several items, and in `Tree` and `MultiSelectList` can exclude the focused row. A right-click has the same shape: it names the one row under the pointer, leaves the selection alone, and lets the consumer decide whether the action covers the selection (SQLAdmin's query list selects the row itself; its navigator tree acts on the node it is given).

[^no-item]: The three widgets' menus all need an item: `Tree` and `List` emit an event whose first argument is the node or index, and the `Table` cell menu cuts, copies and pastes a cell. There is no menu to offer for "no item", and inventing one (the column menu on an empty table, say) would give the keyboard something the mouse does not have. Leaving the event unhandled also keeps one behaviour for both inputs: the event continues to ancestor listeners, and `Body` (the page body component) suppresses the browser's menu unless the application turned `nativeContextMenu` on.

[^anchor]: Bottom-left keeps the item visible while the menu is open and matches where `TableHeader` already puts a keyboard-opened menu. The clamp matters when the item is wider than the widget or scrolled sideways: a tree label can start left of the tree's visible box, and a table cell can be wider than the body. `Menu.show()` then clamps the point to the viewport as it does for any caller. Horizontal scroll is revealed only for the `Table`, which already scrolls the focused column into view for `Enter`; a `Tree` row is as wide as the tree, so there is nothing to scroll to. Anchoring at the row's renderer rather than the row was verified in Chromium: the menu opened at `x 36` for a depth-1 row, under its label.

[^synthetic]: Three alternatives were rejected. (1) Passing the browser's own event: its coordinates are the centre of the widget in Chromium, so every existing consumer would open the menu in the wrong place until it was rewritten. (2) Adding a third listener argument with the position: existing consumers ignore it, so SQLAdmin would need changes, which this plan must avoid. (3) Having `Menu.show()` pick up a pending anchor that the widget sets before it emits: it hides a dependency between an event and a later call, and fails for a consumer that shows its menu after an `await`. A real `MouseEvent` keeps the documented contract — "`clientX` / `clientY` position a context menu" — true for both inputs. It carries `button: 2` so it reads as the right-click it stands in for, and no modifier keys: Shift is held for Shift+F10, and a listener that treats Shift+right-click specially must not see it. `MouseEvent` cannot be constructed in the Node test environment and library code must not name the global constructor (`local/no-raw-dom`), hence the seam member.

[^header-editors]: Measured in Chromium (see the addendum): a key-raised `contextmenu` on the header's menu button targets the `<button>`, whose parent is the `<thead>`, and no header cell is on its path, so nothing opens, the same as a right-click on that button. `showColumnMenu` ignores the field name it is given ([Table.ts:413](../packages/lib/src/typescript/lib/component/table/Table.ts#L413)), so the menu `Enter` opens from the button is the menu every header cell opens. With an editor open, focus is inside the cell, the event targets the editor, and `onCellContextMenu` already returns early for a cell that is editing ([Body.ts:2331](../packages/lib/src/typescript/lib/component/table/Body.ts#L2331)); a text editor then shows its own clipboard menu ([`TextInputCellEditor.handleContextMenu`](../packages/lib/src/typescript/lib/component/table/cell/editor/TextInputCellEditor.ts#L110)) and the dependency keeps the edit open while that menu has focus. Making the header button answer Shift+F10 would change what a right-click on it does too, which is a separate decision.

[^sqladmin]: Checked in `/home/jika/typescript/sqladmin/frontend/src` by searching for `contextmenu`: the handlers listed in the table are the only `Tree` and `List` ones; `showObjectMenu` (`navigator/objectMenu.ts:270–284`) passes the event only to `menu.show(event.clientX, event.clientY, items)`. The three diagram panels listen to `DiagramView`, which this plan does not touch. SQLAdmin's result grid (`dock/TableWorkPanel.ts`) and properties tables register no context-menu handler and use the library's built-in cell menu. SQLAdmin consumes the built `dist/lib`, so MV15 needs `npm run build:lib` first.

[^engines]: What differs between engines is the event's coordinates and `button`, and this plan reads neither in the keyboard case. Chromium was measured: target is the focused element, coordinates are its centre, `button` is `-1`. For Firefox and WebKit the following is the planner's reading of their sources and was not run, so treat it as an expectation: both also target the focused element (neither follows `aria-activedescendant`), both place the point at the focused element's bottom-left rather than its centre (or at the caret in editable text), Firefox reports `button: 0` and WebKit `button: 2`. macOS browsers have no context-menu key; Ctrl+click is a pointer press and takes the pointer path. The two things the fix does depend on — the target is the focused element, and a `keydown` precedes the `contextmenu` — are what MV1, MV3, MV6 and MV7 confirm in each engine.

[^oracle]: The modelled DOM computes `getViewportRect(component)` from component positions and does not include the virtual scroller's row offset. Measured with the prototype: a `Tree` row at index 2 reported `bottom 24`, not `72`, and a `Table` cell reported `left 0`. A `List` row and a plain child component are exact (`bottom 44` for row 1 at 22 px per row; `(30, 64)` in R3). Defining the expected value through the same call keeps the widget cases about wiring (which item, which event) and leaves the arithmetic to R3 and R4.

[^pin]: `Event` attaches its window-level listener for a type only when the type is first registered, and `DOM.reset()` swaps the DOM without clearing that state (see the header of `tests/dom/viewport-consume.test.ts`). A registration that survives a test — an undisposed component's `keydown`, or `Menu`'s static watch — therefore leaves the next test's fresh DOM with no listener for that type. The dependency met this in two suites and fixed both by calling `Menu._stopInputWatch()` in teardown (its Implementation Notes 12 and 13). `Table` already builds a `Menu`, so only files that build a `Tree` or a `List` without any `Menu` are newly exposed; the 52 files run against the prototype showed no case.

