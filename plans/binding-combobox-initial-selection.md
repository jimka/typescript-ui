---
touches-shared: [src/typescript/lib/component/input/ComboBox.ts]
---

# Binding ComboBox Initial Selection — Implementation Plan

## Overview

In the Binding demo panel the record-selector `ComboBox` shows **no selected record** when the tab is first opened, even though the panel ends construction by loading `personStore` and pushing `records[0]` into the binding. The selector should display `"Alice"` (the first person) on first paint. It shows an empty label instead.

The selector is built at [BindingPanel.ts:125](../src/typescript/BindingPanel.ts#L125) with `store: personStore` while the store is still empty, then the store is loaded asynchronously at [BindingPanel.ts:194](../src/typescript/BindingPanel.ts#L194). The store-load is what populates the combo's options. The defect lives in how the `ComboBox` reacts to that asynchronous store load: the inner list rebuilds its rows and **clears its selection**, but the `ComboBox` never re-runs its "auto-select the first row" logic or refreshes its rendered label afterward, so the surface stays blank.

This plan fixes the combo's store-load path in [ComboBox.ts](../src/typescript/lib/component/input/ComboBox.ts). No data-layer or `Binding` changes are needed; the bug is purely in the combo's reaction to a deferred store refresh.

---

## Root Cause

Traced through the actual call chain (no assumptions):

1. **Construction (store empty).** `new ComboBox({ store: personStore, displayField: 'name', valueField: 'id' })` runs the constructor's late-dispatch block at [ComboBox.ts:524](../src/typescript/lib/component/input/ComboBox.ts#L524), which calls `setStore(...)`. `setStore` ([ComboBox.ts:923](../src/typescript/lib/component/input/ComboBox.ts#L923)) forwards to the inner `List.setStore`, then runs `reapplyPendingValue()` (no-op — nothing pending), `autoSelectFirstIfEmpty()`, and `refreshLabel()`. At this moment `personStore` has **zero records**, so `autoSelectFirstIfEmpty` ([ComboBox.ts:986](../src/typescript/lib/component/input/ComboBox.ts#L986)) sees an empty list and does nothing. Label is `""`. Correct so far.

2. **Inner list subscribes to the store.** `AbstractCustomList.setStore` → `bindStore` ([AbstractCustomList.ts:707](../src/typescript/lib/component/list/AbstractCustomList.ts)) registers a `refresh` handler on the store's `load` / `add` / `remove` / `datachanged` events, then calls `refreshFromStore()` once (still empty).

3. **Async store load fires.** `personStore.load()` at [BindingPanel.ts:195](../src/typescript/BindingPanel.ts#L195) resolves and emits `load`. The inner list's `refresh` handler (registered by `bindStore`) runs `refreshFromStore()` ([AbstractCustomList.ts:851](../src/typescript/lib/component/list/AbstractCustomList.ts#L851)), which rebuilds `_items` from the now-present records.

4. **The load leaves the row focused but NOT selected, and the combo never re-syncs.** `refreshFromStore` ([AbstractCustomList.ts:851](../src/typescript/lib/component/list/AbstractCustomList.ts#L851)) clears `_items` / `_selectedSet` / `_anchorIndex`, then tries to relocate the *previous* anchor key. On a fresh load there was no previous selection (`previousAnchorKey === null`), so the `restoredAnchor >= 0` branch is skipped and the `else` branch runs `this._focusedIndex = this._items.length > 0 ? 0 : -1` — it sets **focus** to row 0 but adds **nothing** to `_selectedSet` ([AbstractCustomList.ts:891-893](../src/typescript/lib/component/list/AbstractCustomList.ts#L891)). So after the load the inner list has items and a *focused* row 0 but `getSelectedIndex()` returns `-1` and `getValue()` returns `""`. Crucially, this whole refresh path lives **inside the inner `List`**, driven by the store event the list subscribed to — **not** through `ComboBox.setStore` / `setItems`. So the `ComboBox`-level post-processing (`autoSelectFirstIfEmpty` + `refreshLabel`) that would have *selected* index 0 and repainted the surface **never runs** for the deferred load. `ComboBox.computeLabel()` ([ComboBox.ts:754](../src/typescript/lib/component/input/ComboBox.ts#L754)) reads `getSelectedIndex()` (= -1) and returns `""`, and nothing calls `refreshLabel()` after the load anyway.

5. **Result on first open.** The combo has options but no selection and a blank label. (The separately-loaded `roleCombo` inside the `Binding` exhibits the same underlying gap, but `binding.setRecord(records[0])` later calls `roleCombo.setValue('admin')`, which routes through `ComboBox.setValue` → `refreshLabel`, so the role combo happens to recover. The record selector is **never** driven by `setRecord`, so nothing papers over the blank for it.)

The bug is therefore: **the `ComboBox` does not re-assert its selection/label when the inner list rebuilds from a store event that arrives after construction.** The construction-time `autoSelectFirstIfEmpty` + `refreshLabel` only fire on the synchronous `setStore`/`setItems`/`addItem` calls, not on the asynchronous store-driven refresh.

The likely-shape hypotheses in the brief, checked:
- "value set before options populated" — partially: there is no `value`/`setValue` on the record selector at all; it relies on auto-select, which is what fails.
- "display-sync runs once at bind time, never re-fires" — **confirmed: this is the cause.**
- "selection matching compares identity incorrectly" — rejected; keys are stringified consistently and matching is fine once a refresh re-runs.

---

## Architecture Decisions

### Subscribe the ComboBox to its own store refreshes, re-running selection + label

The fix is to give the `ComboBox` a single private handler that re-asserts its surface state after the inner list rebuilds from a store event. When `setStore` binds a store, the `ComboBox` registers a listener on that store's `load` / `add` / `remove` / `datachanged` events. The handler runs the same trailing trio the synchronous setters already use: `reapplyPendingValue()`, `autoSelectFirstIfEmpty()`, `refreshLabel()`. This is the smallest change that makes the deferred-load path behave identically to the synchronous-load path, and it reuses the existing private helpers rather than introducing new selection logic.

Ordering note: the inner list also subscribes to the same store events (step 2 above). The list's `refreshFromStore` must run **before** the combo's handler so that `autoSelectFirstIfEmpty` sees the freshly-populated items. The list is subscribed during `setStore`'s call into `List.setStore`, which happens *before* the combo registers its own handler later in the same `setStore` body — and listener bags fire in registration order — so the list's refresh is guaranteed to run first. The plan places the combo's `store.on(...)` registration at the end of `ComboBox.setStore`, after the `this._dropdown.getList().setStore(...)` call, to lock this ordering in.

### Re-bind cleanly on a second setStore

`setStore` can be called more than once (the demo doesn't, but the API allows it, and `applyOptions`/constructor re-entry can). The combo must remove its previously-registered store handler before subscribing to the new store, or a stale store would keep driving the combo. Store the bound store and the handler reference in private fields and detach on re-bind, mirroring how `Body.setStore` ([Table Body](../src/typescript/lib/component/table/Body.ts#L451)) de-registers its `_storeRefresh` across `['load','add','remove','datachanged',...]` before rebinding.

### Keep the change confined to the selection/display path

Per the `touches-shared` constraint (the modern-theme L&F plan edits the caret glyph in this same file), all edits here stay inside `setStore` and the new private field/handler — the label/selection path. No edits to `ComboBoxCaret`, the caret glyph, `doLayout`'s caret math, or the `StyleRule` block. The two plans' edits are disjoint.

### Why not fix it in `AbstractCustomList`

`setItemsArray` clearing the selection is intentional shared behaviour (a store reload genuinely invalidates row indices, and `List`/`MultiSelectList`/table bodies all depend on it). The "default to first option, then repaint the surface label" policy is a `ComboBox`-specific affordance — it already lives in `ComboBox.autoSelectFirstIfEmpty`/`refreshLabel`, not in the list. Pushing auto-select into the shared list would change `List`'s documented "leaves nothing selected" contract. So the fix belongs in `ComboBox`.

---

## Implementation

New private state on `ComboBox` (alongside `_pendingValue` near [ComboBox.ts:459](../src/typescript/lib/component/input/ComboBox.ts#L459)):

```typescript
/** The store currently subscribed for option refreshes, or null. */
private _boundStore: AbstractStore | null = null;
/** Handler re-asserting selection + label after the inner list rebuilds from a store event. */
private readonly _onStoreRefresh: () => void;
```

`_onStoreRefresh` is assigned in the constructor (arrow, per conventions — no `.bind`), before any `setStore` dispatch in the late-built block runs:

```typescript
this._onStoreRefresh = () => this.onStoreRefresh();
```

New private method (mirrors the trailing trio of `setItems`/`setStore`):

```typescript
/**
 * Re-asserts the surface selection and label after the inner list
 * rebuilds its rows from a deferred store event (an async `load`, or a
 * later `add` / `remove` / `datachanged`). The inner list clears its
 * selection whenever it rebuilds from the store, so without this the
 * combo would show populated options but a blank label on first paint
 * when the store loads after construction.
 */
private onStoreRefresh(): void {
    this.reapplyPendingValue();
    this.autoSelectFirstIfEmpty();
    this.refreshLabel();
}
```

`setStore` gains store (de)registration at its tail, after the inner list is bound (so the list's own store handler is registered — and therefore fires — first):

```typescript
setStore(store: AbstractStore, displayField: string, valueField?: string): this {
    this._options.store        = store;
    this._options.displayField = displayField;
    this._options.valueField   = valueField;

    if (this._boundStore) {
        (['load', 'add', 'remove', 'datachanged'] as const).forEach(e =>
            this._boundStore!.off(e, this._onStoreRefresh)
        );
    }

    this._dropdown.getList().setStore(store, displayField, valueField);

    this._boundStore = store;

    (['load', 'add', 'remove', 'datachanged'] as const).forEach(e =>
        store.on(e, this._onStoreRefresh)
    );

    this.reapplyPendingValue();
    this.autoSelectFirstIfEmpty();
    this.refreshLabel();

    return this;
}
```

The synchronous trailing trio stays (it handles the case where the store is already loaded at `setStore` time); the new subscription handles the deferred case. Both call the same helpers, so a store that is already populated is auto-selected synchronously and the later `load` event re-asserts the same selection harmlessly.

---

## Ordered Implementation Steps

1. **`ComboBox.ts` — add private state.** Add `_boundStore` and `_onStoreRefresh` fields beside `_pendingValue`. `_boundStore` gets an initializer (`= null`); `_onStoreRefresh` is `readonly` and assigned in the constructor.
2. **`ComboBox.ts` — assign `_onStoreRefresh` in the constructor.** Place the `this._onStoreRefresh = () => this.onStoreRefresh();` assignment **before** the late-built dispatch block (before [line 524](../src/typescript/lib/component/input/ComboBox.ts#L524)), so it exists when the constructor's own `setStore` call subscribes.
3. **`ComboBox.ts` — add the `onStoreRefresh` private method.** Place it next to `autoSelectFirstIfEmpty`/`reapplyPendingValue`. Full JSDoc per conventions.
4. **`ComboBox.ts` — wire (de)registration into `setStore`.** Detach the old store's handler (guard on `_boundStore`), bind the inner list, set `_boundStore = store`, then subscribe the new store. Keep the existing trailing `reapplyPendingValue` / `autoSelectFirstIfEmpty` / `refreshLabel`.
5. **Regression check — confirm the disjointness with the L&F plan.** `grep -n "ComboBoxCaret\|chevron\|caret" src/typescript/lib/component/input/ComboBox.ts` — verify this plan touches none of those lines.
6. **Typecheck.** `npm run build` (or the project's `tsc` task) — expect 0 errors. The `AbstractStore` type is already imported in `ComboBox.ts` ([line 9](../src/typescript/lib/component/input/ComboBox.ts#L9)), so no new import.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/input/ComboBox.ts` |

---

## Verification

- **Typecheck:** project `tsc`/build is clean.
- **Manual smoke (primary):** open the app (`npm run dev`, http://localhost:8015), navigate to the **Binding** demo tab. On first open, the **Record:** combo must display **`Alice`** with no interaction. Before the fix it is blank.
- **Lazy-tab check:** if the Binding tab is lazily constructed, the bug is timing-sensitive — confirm the label is correct whether the tab is the first one shown or opened later (the store load is async either way).
- **No regression on already-loaded stores:** the **Role:** combo (whose store is loaded then driven by `setRecord`) must still show the bound record's role (`Admin` for Alice) and update when switching records.
- **Switching records:** picking `Bob` in the Record combo still drives the binding (existing `on("action")` handler at [BindingPanel.ts:215](../src/typescript/BindingPanel.ts#L215)); the veto path (dirty record) still snaps the combo back.
- **Re-bind safety:** no duplicate or stale updates after a store reload (only one `_onStoreRefresh` is ever subscribed per store).

---

## Potential Challenges

- **Handler fire order vs. the inner list.** If the combo's handler somehow ran before the inner list's `refreshFromStore`, `autoSelectFirstIfEmpty` would see stale (empty) items. Mitigation: register the combo's handler **after** `this._dropdown.getList().setStore(...)` in `setStore`, and rely on the listener bag's registration-order firing so the list refreshes first.
- **Double auto-select.** A store already populated at `setStore` time runs the trio synchronously, then again on the `load` event. Mitigation: `autoSelectFirstIfEmpty` is idempotent (it no-ops once a selection exists), and `refreshLabel` is a pure recompute, so the second pass is harmless.
- **`add` / `remove` after a user selection.** The handler re-runs `autoSelectFirstIfEmpty`, which only fires when nothing is selected; a user's explicit selection survives a later `add`. If a `remove` drops the selected row, the inner list clears it and the combo auto-selects index 0 — acceptable and consistent with the synchronous-setItems behaviour.

---

## Critical Files

- [ComboBox.ts](../src/typescript/lib/component/input/ComboBox.ts) — the file under edit; `setStore` (923), `autoSelectFirstIfEmpty` (986), `reapplyPendingValue` (965), `refreshLabel` (769), `computeLabel` (754), constructor late-dispatch (524).
- [AbstractCustomList.ts](../src/typescript/lib/component/list/AbstractCustomList.ts) — `setStore` (664), `bindStore` (subscribes the inner list to `load`/`add`/`remove`/`datachanged`), `refreshFromStore` (851), `syncRows` (906), `setSelectedIndex` (758). `refreshFromStore`'s `else` branch (891-893) sets `_focusedIndex = 0` but leaves `_selectedSet` empty on a fresh load — the exact gap the combo must paper over.
- [List.ts](../src/typescript/lib/component/list/List.ts) — `setValue` (103) / `getValue` (117): key-based selection used by the combo.
- [Body.ts](../src/typescript/lib/component/table/Body.ts) — `setStore` (451): the established pattern for de-registering a store-event handler set across `['load','add','remove','datachanged',...]` before re-binding.
- [BindingPanel.ts](../src/typescript/BindingPanel.ts) — the demo reproducing the bug (record selector at 125; async store load at 194).

---

## Non-Goals

- **No change to `AbstractCustomList` / `List` selection semantics.** The "clear selection on rebuild" behaviour is shared and correct; auto-select-first is a ComboBox affordance and stays there.
- **No change to `Binding`, `Bindable`, `ModelRecord`, or `MemoryStore`.** The defect is in the combo's reaction to store events, not the data layer or the binding mechanism.
- **No caret/glyph/theme edits.** Reserved for the parallel modern-theme L&F plan that shares this file; keeping the surfaces disjoint avoids a merge conflict.
- **No new public API.** All additions are private; the `setStore` signature is unchanged.
