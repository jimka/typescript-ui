# Suppress Redundant `selection` Events on Unchanged Selection — Implementation Plan

## Overview

`Tree`, `Body` (the selection engine behind `Table` and `TreeTable`), and `DiagramView` each fire their `"selection"` event unconditionally on every click or programmatic selection call — even when the resulting selection is identical to the one already in effect. Re-clicking the sole selected row, node, or diagram node fires `"selection"` again with no actual change, and every listener re-runs its selection-driven work (e.g. an expensive metadata fetch) for nothing.

This plan makes all three fire `"selection"` only when the selected set actually changes membership. It adds one small shared helper, a new sibling to [`reduceModifierSelection.ts`](../../packages/lib/src/typescript/lib/component/shared/reduceModifierSelection.ts) named `selectionsEqual.ts`, and guards five `"selection"` emit statements across the three files below. The public `"selection"` event signature is unchanged — this only changes *when* it fires.

Emit sites in scope:

- [`packages/lib/src/typescript/lib/component/tree/Tree.ts`](../../packages/lib/src/typescript/lib/component/tree/Tree.ts) — `_selectAtIndex` (line 656), `_extendSelectionTo` (line 680), and the ctrl/cmd-click toggle branch inside `_handleClick` (line 840).
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](../../packages/lib/src/typescript/lib/component/table/Body.ts) — the single choke point `notifySelectionChange` (line 1049), called from `onRowClick` (line 863), `selectRecord` (line 925), and `setSelectedRecords` (line 967). `Table` forwards `Body`'s `"selection"` verbatim at [`Table.ts:180`](../../packages/lib/src/typescript/lib/component/table/Table.ts#L180), and `TreeTable`'s `TreeBody` never overrides `selectRecord`, `onRowClick`, or `notifySelectionChange` — its own `moveFocusTo` ([`TreeBody.ts:894`](../../packages/lib/src/typescript/lib/component/table/TreeBody.ts#L894)) calls the inherited `selectRecord`. Guarding `Body` alone covers `Table` and `TreeTable`.
- [`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`](../../packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) — `_handleClick` (line 681), specifically the `id !== null` branch (line 684-686).

---

## Architecture Decisions

### In scope: Tree, Body (Table + TreeTable), DiagramView

All three maintain a live selection and fire `"selection"` from a user gesture or a programmatic setter, and all three have at least one site that emits without checking whether the selection actually moved.

### Out of scope: MultiSelectList

`MultiSelectList` has no `"selection"` event at all. Its click/keyboard reducer (`reduceSelection` at [`MultiSelectList.ts:198`](../../packages/lib/src/typescript/lib/component/list/MultiSelectList.ts#L198)) feeds `notifyUserChange` → `fireChange` → the framework's `"change"` / binding pair, the same event contract every `Bindable` value input uses.[^multiselect-change] There is no redundant-emit bug to fix under this plan's scope, which is specifically the `"selection"` event.

### Out of scope: AbstractChart and ButtonGroup

Both emit `"selection"`, but the event means something different for each and re-firing on an unchanged click is part of the contract, not a bug:

- `AbstractChart.selectPoint` ([`AbstractChart.ts:997`](../../packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L997)) reports "this datum was clicked," not "the selected set changed." Clicking the same point twice is two distinct click reports.
- `ButtonGroup.updateButtonStates` ([`ButtonGroup.ts:95`](../../packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L95)) has radio-button semantics: every click on a group member — including a re-click of the already-selected button — fires `"selection"` with that button as the initiator so a listener can read `isSelected()` (relevant under `allowDeselect`). Suppressing the re-click would silently break that read.

### Guard mechanism: snapshot-before, compare-after, with one shared equality helper

Each guarded site captures the selection as it stood **before** the mutating gesture runs, then compares it to the live selection right before emitting. If the two sets have the same members, the emit is skipped. `Tree` and `Body` share a new helper, `selectionsEqual<T>(a, b)`, that compares two `Set`s by membership. `DiagramView` compares scalars directly instead of going through the helper, because its selection is inherently single-valued — see the footnote on that deviation.[^diagram-scalar]

The snapshot approach — rather than caching "the last emitted selection" on the instance — means every guarded call is self-contained: it needs no cross-call bookkeeping and stays correct even when a silent setter (`Tree.selectNode`, `DiagramView.selectNode`) changed the live selection without emitting in between two guarded calls.[^snapshot-vs-cache]

`selectionsEqual` lives at `packages/lib/src/typescript/lib/component/shared/selectionsEqual.ts`, mirroring [`reduceModifierSelection.ts`](../../packages/lib/src/typescript/lib/component/shared/reduceModifierSelection.ts) — the existing shared, `@internal`, non-barrel-exported, one-function-per-file helper in `component/shared/` that `Body` and `MultiSelectList` already both import. `reduceModifierSelection` is the direct precedent for "a selection primitive shared by more than one component lives in `component/shared/` as its own file, generic over the identity type `T`, imported as `~/component/shared/<Name>.js`."[^shared-precedent]

The "guard a mutation/emit behind an equality check" pattern itself is already established at two other points in this codebase, at different granularities:

- `Toggle.setValue` ([`Toggle.ts:185`](../../packages/lib/src/typescript/lib/component/input/Toggle.ts#L185)): "Notifies change and binding listeners on a real transition; no-op when the value is unchanged" — a scalar guard before firing `"change"`.
- `Body`'s own private `columnWidthsEqual` ([`Body.ts:81`](../../packages/lib/src/typescript/lib/component/table/Body.ts#L81)), used by `updateColumnWidthCache` ([`Body.ts:730`](../../packages/lib/src/typescript/lib/component/table/Body.ts#L730)) to skip a geometry invalidation when the incoming column widths equal the cached ones.

This plan's `selectionsEqual` is the same idea generalised from a scalar / array to a `Set`.

`DiagramView` already has one asymmetric instance of this exact guard: its `_handleClick`'s empty-space branch checks `this._selection.length > 0` before clearing and emitting ([`DiagramView.ts:687`](../../packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L687)), so re-clicking empty canvas twice does not re-fire `"selection"`. Only the node-click branch (`id !== null`) is missing the equivalent check — this plan brings that branch in line with its sibling.

### Guard placement: Body's `notifySelectionChange` takes the pre-mutation snapshot as a parameter; Tree gets an equivalent new private method

`Body.notifySelectionChange` is already the single choke point all three of `Body`'s mutating call sites go through, but it runs *after* the mutation, so it cannot compare "before" to "after" on its own — it needs the caller to hand it what the selection looked like beforehand. Its signature becomes `notifySelectionChange(before: ReadonlySet<ModelRecord>): void`, and each of its three callers takes the snapshot immediately before mutating.

`Tree` has no equivalent choke point today — its three sites each call `this.emit("selection", …)` directly. This plan adds one, `_notifySelectionChange(before: ReadonlySet<TreeNode>): void`, named and shaped like `Body`'s, and routes all three sites through it. This also makes `Tree` match `Body`'s existing "one place fires the event" shape, which is worth doing on its own even setting the emit bug aside — but this plan does not otherwise refactor `Tree`.

`DiagramView` keeps its guard inline in `_handleClick` — a single call site does not need a shared method.

---

## Internal Structure

### New file: `component/shared/selectionsEqual.ts`

```typescript
export function selectionsEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
    if (a.size !== b.size) {
        return false;
    }

    for (const item of a) {
        if (!b.has(item)) {
            return false;
        }
    }

    return true;
}
```

### `Tree` — new private method

```typescript
private _notifySelectionChange(before: ReadonlySet<TreeNode>): void {
    if (selectionsEqual(before, this._selectedNodes)) {
        return;
    }

    this.emit("selection", this.getSelectedNodes());
}
```

### `Body` — `notifySelectionChange` gains a parameter

```typescript
private notifySelectionChange(before: ReadonlySet<ModelRecord>): void {
    if (selectionsEqual(before, this._selectedRecords)) {
        return;
    }

    this.emit("selection", this.getSelectedRecords());
}
```

---

## What "identical set" means

Same membership, regardless of order, anchor, or focus. Two selections are identical exactly when they have the same size and every member of one is in the other — anchor node/record, focus node/record, and insertion order are never compared.

| Before | Gesture | After | Fires? | Why |
|---|---|---|---|---|
| `{A}` (sole selection) | Plain click on A | `{A}` | No | Same membership — the motivating bug this plan fixes |
| `{}` (empty) | Plain click on A | `{A}` | Yes | Membership changed |
| `{A, B}` | Plain click on A | `{A}` | Yes | B dropped out |
| `{A, B}` | Ctrl/Cmd-click on B (removes it) | `{A}` | Yes | B dropped out |
| `{A}` | Ctrl/Cmd-click on B again (re-adds it) | `{A, B}` | Yes | B is back — this transition is a real change even though the *final* two-click round trip nets back to `{A, B}`'s starting membership; each click is compared only to its own immediate "before" |
| `{A, B, C}` | Shift-click that re-selects the same anchor→C range | `{A, B, C}` | No | Same membership as before, even though the range was recomputed from scratch |
| `{A}` (A is last row) | ArrowDown at the last row (keyboard nav) | `{A}` | No | Nothing moved — the index clamps to the same row |
| `{A}` | ArrowDown to the next row | `{B}` | Yes | Membership changed — keyboard nav must still emit on a real change |
| `{}` (empty) | Clear an already-empty selection (e.g. `selectRecord(null)` called twice) | `{}` | No | Nothing to clear |

For `DiagramView` — single-select only — "identical set" reduces to "the clicked node's id equals the currently selected node's id" (or both are absent).

---

## Ordered Implementation Steps

1. **Create `packages/lib/src/typescript/lib/component/shared/selectionsEqual.ts`** with the `selectionsEqual<T>` function shown above (plus full JSDoc — mirror the style and `@internal` tag on [`reduceModifierSelection.ts`](../../packages/lib/src/typescript/lib/component/shared/reduceModifierSelection.ts), including the SPDX header every file in this tree carries).

2. **Create `packages/lib/tests/component/shared/selectionsEqual.test.ts`** covering the five cases in `## Expected Behaviour` → *`selectionsEqual` — unit-testable offline (pure function)*. Mirror [`reduceModifierSelection.test.ts`](../../packages/lib/tests/component/shared/reduceModifierSelection.test.ts)'s plain `describe`/`it` style. Run it — expect all green against the step-1 implementation.

3. **`Tree.ts`**: import `selectionsEqual` from `~/component/shared/selectionsEqual.js`. Add the private `_notifySelectionChange(before: ReadonlySet<TreeNode>): void` method shown above, placed near the other private selection helpers (next to `_rangeSelect` / `_selectAtIndex` is a reasonable spot).

4. **`Tree.ts` — `_selectAtIndex`** (line 656): capture `const before = new Set(this._selectedNodes);` right after resolving `node`, before `this._selectedNodes.clear()`. Replace the trailing `this.emit("selection", this.getSelectedNodes());` with `this._notifySelectionChange(before);`.

5. **`Tree.ts` — `_extendSelectionTo`** (line 680): same pattern — snapshot `before` at the top of the method (before `_rangeSelect` mutates `_selectedNodes`), replace the trailing emit with `this._notifySelectionChange(before);`.

6. **`Tree.ts` — `_handleClick` ctrl/cmd branch** (line 840): snapshot `const before = new Set(this._selectedNodes);` immediately before the `if (this._selectedNodes.has(node))` toggle, replace the trailing `this.emit("selection", this.getSelectedNodes());` with `this._notifySelectionChange(before);`.

7. **Verify no other `Tree` emit sites were missed**: `grep -n 'emit("selection"' packages/lib/src/typescript/lib/component/tree/Tree.ts` — expect exactly one match, inside `_notifySelectionChange` itself.

8. **Add the `Tree` regression cases** from `## Expected Behaviour` → *Tree — unit-testable offline* to `packages/lib/tests/component/tree/Tree.test.ts`, reaching the private methods via the file's existing typed-cast pattern. Run the file — expect all green.

9. **`Body.ts`**: import `selectionsEqual` from `~/component/shared/selectionsEqual.js`. Change `notifySelectionChange`'s signature to `private notifySelectionChange(before: ReadonlySet<ModelRecord>): void` and add the equality guard shown above.

10. **`Body.ts` — `onRowClick`** (line 863): capture `const before = new Set(this._selectedRecords);` right after resolving `records` (before the `reduceModifierSelection` call). Update the existing `this.notifySelectionChange();` call to `this.notifySelectionChange(before);`.

11. **`Body.ts` — `selectRecord`** (line 925): capture `before` as the first line of the method, before `this._selectedRecords.clear()`. Update the call to `this.notifySelectionChange(before);`.

12. **`Body.ts` — `setSelectedRecords`** (line 967): same pattern — snapshot `before` as the first line, before `this._selectedRecords.clear()`. Update the call to `this.notifySelectionChange(before);`.

13. **Verify no other `Body` caller of `notifySelectionChange` was missed**: `grep -n 'notifySelectionChange' packages/lib/src/typescript/lib/component/table/Body.ts` — expect exactly 4 matches (the definition plus the 3 updated call sites), each call site passing an argument.

14. **Add the `Body` regression cases** from `## Expected Behaviour` → *Body (covers Table + TreeTable) — unit-testable offline* to `packages/lib/tests/component/table/Body.test.ts`, following the file's existing `(b as any).onRowClick(row, makeEvent(...))` pattern. Run the file — expect all green.

15. **`DiagramView.ts` — `_handleClick`** (line 681): in the `id !== null` branch, before calling `setSelection`/`emit`, compare `id` to the currently selected node's id and return early when they match:

    ```typescript
    private _handleClick(event: MouseEvent): void {
        const id = this.nodeIdAt(event.target);

        if (id !== null) {
            if (id === (this._selection[0]?.id ?? null)) {
                return;
            }

            this.setSelection(id);
            this.emit("selection", this.getSelection());
        } else if (this._selection.length > 0) {
            this.setSelection(null);
            this.emit("selection", this.getSelection());
        }
    }
    ```

    Leave the `else if` (empty-space) branch untouched — it already guards correctly.

16. **Add the `DiagramView` regression cases** from `## Expected Behaviour` → *DiagramView — unit-testable offline* to `packages/lib/tests/component/diagram/DiagramView.test.ts`, following the file's existing `view._handleClick(makeEvent(handle, 'click'))` pattern. Run the file — expect all green.

17. **Update `Tree`'s and `Body`'s "when this event fires" JSDoc** where they document the `"selection"` event (`Tree`'s `on`/`emit` overload docs, `Body`'s `on` doc at line ~986, `Table`'s forwarding doc at line ~192) to say it fires "when the selected set changes" rather than leaving the (previously inaccurate for these two) implication that it fires on every click. `DiagramView`'s own doc comment at line 675 already says "emitting `"selection"` when it changes" — leave it as-is; this step is what makes that claim true for `_handleClick`, so no doc edit needed there.

18. **Typecheck the whole package**: run the project's TypeScript build/typecheck command (see `package.json` in `packages/lib`) — expect zero new errors.

19. **Run the full package test suite** — expect all green, with no existing assertion changed (only cases added).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/shared/selectionsEqual.ts` |
| Create | `packages/lib/tests/component/shared/selectionsEqual.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/tests/component/tree/Tree.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/tests/component/table/Body.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` |
| Modify | `packages/lib/tests/component/diagram/DiagramView.test.ts` |

---

## Expected Behaviour

All cases below are phrased against the public contract (`on("selection", …)` observed from outside) plus the documented no-emit guarantees for `selectNode` (`Tree`, `DiagramView`). None depends on current buggy output — they pin the fixed behaviour.

### Tree — unit-testable offline

The existing test file already exercises `Tree`'s private selection methods through a typed cast (see [`Tree.test.ts:163-176`](../../packages/lib/tests/component/tree/Tree.test.ts#L163) for the `selectNode` no-emit test, and the `asPrivate(tree)` pattern used throughout for `_onToggle` / `_flatRows`). Reach `_selectAtIndex`, `_extendSelectionTo`, and `_handleClick` the same way — no real DOM click required.

1. Two calls to `priv._selectAtIndex(i)` for the same `i` in a row: `"selection"` fires once, not twice.
2. `priv._selectAtIndex(i)` then `priv._selectAtIndex(j)` for `i !== j`: fires twice, once per call.
3. `priv._extendSelectionTo(i)` producing the same range as the current selection (e.g. calling it twice with the same index and no state change in between): fires once, not twice.
4. Simulated ctrl/cmd-click via `_handleClick` (or by driving the toggle branch directly if a private seam is cleaner) that removes a node, then a second ctrl/cmd-click that re-adds it: fires on **both** clicks (each is a real change relative to its own "before" — see the worked-example table).
5. `selectNode` still never emits, and a click reproducing what `selectNode` silently selected does not emit either (this is a new case worth a regression test given the snapshot-vs-cache decision above).
6. Keyboard navigation (`ArrowDown` etc. driving `_selectAtIndex`) at a boundary row (already the last/first row) does not emit; navigating to a genuinely different row does.

### Body (covers Table + TreeTable) — unit-testable offline

The existing `Body.test.ts` already drives `onRowClick` via `(b as any).onRowClick(row, makeEvent(...))` and asserts `"selection"` payloads (see [`Body.test.ts:266-284`](../../packages/lib/tests/component/table/Body.test.ts#L266) and the `cellclick`-ordering test at line 370). Add:

1. `b.selectRecord(rec)` called twice in a row for the same `rec`: fires once.
2. `b.selectRecord(null)` called on an already-empty selection: does not fire.
3. `b.setSelectedRecords([recs[0], recs[1]])` followed by `b.setSelectedRecords([recs[1], recs[0]])` (same two records, reversed order): does not fire — membership, not order, decides.
4. Two `onRowClick` calls with a plain click on the same row: fires once, not twice — this is the motivating double-fetch bug (originally reported on `TreeTable`'s double-click; `TreeTable` inherits `Body`'s guard with no code of its own).
5. `onRowClick` with ctrl/cmd on an unselected row, then a plain click elsewhere producing a different set: fires on both.
6. Keyboard row navigation (`selectRecord` called from the arrow-key path, [`Body.ts:1407`](../../packages/lib/src/typescript/lib/component/table/Body.ts#L1407)) at a boundary (already on the last/first row) does not emit; moving to a different row does.
7. `TreeTable`'s `moveFocusTo` (which calls the inherited `selectRecord`) inherits the same guard with no `TreeBody`-specific code — a `TreeBody.test.ts` regression test calling `moveFocusTo` twice for the same record, asserting one emit, is worth adding but is not required to prove the fix (the fix lives entirely in `Body`).

### DiagramView — unit-testable offline

`DiagramView.test.ts` already drives `_handleClick` directly via `view._handleClick(makeEvent(handle, 'click'))` (see [`DiagramView.test.ts:188-206`](../../packages/lib/tests/component/diagram/DiagramView.test.ts#L188)).

1. Two `_handleClick` calls on the same node: fires once, not twice — this is the second half of the motivating double-fetch bug.
2. `_handleClick` on node A, then on node B: fires twice.
3. `_handleClick` on empty canvas when nothing is selected: does not fire (already covered by the existing empty-space guard; add a regression test if none exists).
4. `_handleClick` on node A, then on empty canvas: fires once (the clear).
5. `selectNode('a')` then a click on the DOM node for `'a'`: does not fire — the click reproduces what the silent `selectNode` already set (same snapshot-vs-cache reasoning as the `Tree` case above).

### `selectionsEqual` — unit-testable offline (pure function)

Mirror [`reduceModifierSelection.test.ts`](../../packages/lib/tests/component/shared/reduceModifierSelection.test.ts)'s style (plain describe/it, no DOM):

1. Two empty sets: equal.
2. Same members, different insertion order: equal.
3. Different sizes: not equal.
4. Same size, disjoint members: not equal.
5. Same size, one member differs: not equal.

### Manual / DOM verification

Nothing in this plan requires manual verification — every guarded site is already reached by an offline private-cast or `makeEvent`-driven test elsewhere in the suite, per the citations above. As a final sanity check, exercise a live `Tree` and `TreeTable` (or `Table`) in a running app and confirm re-clicking the selected row/node no longer fires a redundant listener callback (e.g. temporarily log from an `on("selection", …)` handler).

---

## Verification

- `grep -n 'emit("selection"' packages/lib/src/typescript/lib/component/tree/Tree.ts` — exactly one match, inside `_notifySelectionChange`.
- `grep -n 'notifySelectionChange' packages/lib/src/typescript/lib/component/table/Body.ts` — exactly 4 matches (1 definition + 3 call sites), each call site passing an argument.
- `grep -n 'emit("selection"' packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` — still 2 matches (one per branch of `_handleClick`), unchanged in count — only the guard around the first one changed.
- Run the package's typecheck/build command.
- Run the package's test suite (`Tree.test.ts`, `Body.test.ts`, `TreeBody.test.ts`, `DiagramView.test.ts`, the new `selectionsEqual.test.ts`) — all green, including the new cases from `## Expected Behaviour`.
- Confirm no existing test regresses: none of the current `Tree.test.ts` / `Body.test.ts` / `DiagramView.test.ts` assertions click or select the same target twice in a row expecting two emits (verified during investigation — the existing `"emits the current selection on select / set / clear"` test in `Body.test.ts` and the click test in `DiagramView.test.ts` each only select a genuinely different target per call).

---

## Potential Challenges

- **Forgetting a snapshot before a mutation.** Taking `before` *after* the selection has already been mutated makes the guard compare a set to itself and silently swallow every emit. Each step above says explicitly where the snapshot goes (before the first line that touches the selection `Set`) — follow the order exactly.
- **`ReadonlySet` typing.** `new Set(this._selectedNodes)` / `new Set(this._selectedRecords)` produce a `Set<T>`, which is assignable to `ReadonlySet<T>` — no cast needed. If TypeScript complains, the snapshot was probably taken from the wrong variable.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/shared/reduceModifierSelection.ts`](../../packages/lib/src/typescript/lib/component/shared/reduceModifierSelection.ts) — the precedent for a shared, `@internal`, one-function-per-file selection helper in `component/shared/`; `selectionsEqual.ts` follows its shape.
- [`packages/lib/tests/component/shared/reduceModifierSelection.test.ts`](../../packages/lib/tests/component/shared/reduceModifierSelection.test.ts) — the precedent for testing such a helper: plain, DOM-free `describe`/`it` blocks.
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](../../packages/lib/src/typescript/lib/component/table/Body.ts) — read `notifySelectionChange`, `onRowClick`, `selectRecord`, `setSelectedRecords`, and `columnWidthsEqual` (the local guard-before-invalidate precedent) in full before editing.
- [`packages/lib/src/typescript/lib/component/tree/Tree.ts`](../../packages/lib/src/typescript/lib/component/tree/Tree.ts) — read `_selectAtIndex`, `_extendSelectionTo`, `_handleClick`, and `selectNode` (the no-emit contract) in full before editing.
- [`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`](../../packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) — read `_handleClick`, `setSelection`, and `selectNode` in full before editing.
- [`packages/lib/src/typescript/lib/component/table/TreeBody.ts`](../../packages/lib/src/typescript/lib/component/table/TreeBody.ts) — read `moveFocusTo` to confirm it still routes through the inherited, now-guarded `selectRecord` after this change.
- [`packages/lib/src/typescript/lib/component/input/Toggle.ts`](../../packages/lib/src/typescript/lib/component/input/Toggle.ts) — the scalar "no-op when unchanged" precedent for `setValue`.

---

## Non-Goals

- Changing the `"selection"` event's payload or the public signature of `on("selection", …)` on any component — this plan only changes when the event fires.
- Touching `AbstractChart` or `ButtonGroup` — their `"selection"` semantics are click-report / radio-button, not "the set changed" (see `## Architecture Decisions`).
- Touching `MultiSelectList` — it has no `"selection"` event; its `"change"` event is a separate contract this plan does not touch.
- Changing `Tree.selectNode`'s or `DiagramView.selectNode`'s documented no-emit behaviour.
- Fixing the consumer app's double metadata-fetch directly — that is downstream of this library fix, not part of it.
- Refactoring `Tree`'s selection internals beyond adding the one `_notifySelectionChange` choke point needed for the guard.

---

## Notes

[^multiselect-change]: `AbstractSelectableList` (the base `MultiSelectList` extends) exposes `on("change", …)` / `on("binding", …)` as the value-bearing input's committed-value events, fired through `fireChange()` ([`AbstractSelectableList.ts:1607`](../../packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1607)). This is the same `"change"` contract every `Bindable` input in the framework uses (`ComboBox`, `ToggleButton`, `List`, …), governed by ARCHITECTURE.md's event-handling section, not the `"selection"` contract this plan is scoped to. Whether `fireChange` itself ever redundantly re-fires on an unchanged value is a legitimate question but a different one — out of scope here because the event name and contract differ from every other component this plan touches.

[^diagram-scalar]: `DiagramView` is single-select: `_selection` is a `DiagramNodeData[]` that only ever holds 0 or 1 entries. Routing a single optional id through the generic `Set`-based `selectionsEqual` would mean constructing a `Set` on every click just to compare it to another `Set` of at most one element — extra allocation and a level of indirection for a comparison that is one strict-equality check (`id === (this._selection[0]?.id ?? null)`) both before and after. `Tree` and `Body` are genuinely multi-select (`Set<TreeNode>` / `Set<ModelRecord>` with no size cap), where the shared helper earns its keep by avoiding two near-duplicate membership-comparison loops.

[^snapshot-vs-cache]: A cache-based alternative — an instance field holding "the last emitted selection," updated only when an emit actually fires, compared against on every guarded call — was considered and rejected. That form breaks the moment a silent setter (`Tree.selectNode`, `DiagramView.selectNode`) changes the live selection without emitting: the cache goes stale relative to the live selection, and the next guarded call compares against the wrong baseline — it could wrongly suppress an emit for a selection that differs from what the cache remembers, or wrongly allow one for a selection that matches the live (but not cached) state. The snapshot-before/compare-after form sidesteps this entirely because "before" is read fresh, from live state, at the top of every guarded call — there is nothing to keep in sync with the silent setters.

[^shared-precedent]: Searched `packages/lib/src/typescript/lib/component/shared/` (contains only `VirtualRowView.ts` and `reduceModifierSelection.ts`) and grepped for existing `Set`-equality or array-equality helpers across the package (`ModelRecord.arraysEqual`, a private static used only for deep-equality of field values — not selection-shaped, and not exported/shared) and for any other "fires only on change" comment (`Toggle.ts`, `TabBar.ts`). No existing shared selection-equality helper was found; `reduceModifierSelection.ts` is the nearest sibling in both purpose (a selection primitive shared across `Body` and `MultiSelectList`) and shape (single exported generic function, `@internal`, own file), so `selectionsEqual.ts` follows it rather than introducing a new convention.

---

## Implementation Notes

Step 17 called for updating three JSDoc sites — `Tree`'s `on`/`emit` overload
docs, `Body`'s `on` doc, and `Table`'s forwarding doc — to say the event
"fires when the selected set changes" instead of implying it fires on every
click. Re-reading the current source at implementation time (not just the
plan's own citations) found that `Tree.on`'s doc already reads `"selection"
fires whenever the selection changes` (`Tree.ts`, near line 370) and
`Table.on`'s doc already reads `"selection" fires whenever the
selected-record set changes` (`Table.ts`, near line 238) — both already
state the post-fix contract accurately, the same situation the plan itself
already called out for `DiagramView`'s doc comment. Only `Body`'s `on` doc
was actually vague ("fires with the current selected-record array", with no
"when" clause), so only that one line was edited. Tree.ts and Table.ts were
left untouched per the surgical-changes convention — editing accurate,
unrelated doc text is not something this change should do.

**Post-audit addendum.** An independent audit of the implemented branch found
that the plan's Overview claim — "Guarding `Body` alone covers `Table` and
`TreeTable`" — is incomplete: `Table.ts` also drives selection directly
through its own `_rotatedRecord` field while {@link Table.setDisplayMode} is
`"rotated"`, via three of its own `emit("selection", …)` call sites
(`Table.ts` near lines 349, 624, 886) that bypass `Body`'s guarded choke
point entirely. Of the three, `setDisplayMode`'s entry-into-rotated emit
(~349) is already guarded by that method's own `mode === this._displayMode`
early return, so it cannot re-fire for an unchanged selection. The other two
were genuinely unguarded and have been fixed as a follow-up to the audit,
test-first, in `packages/lib/tests/component/table/RotatedView.test.ts`:

- `Table.selectRecord`'s rotated branch (~624) now early-returns when
  `record === this._rotatedRecord`, mirroring `DiagramView`'s scalar
  comparison (this is a single-record field, not a `Set`, so
  `selectionsEqual` does not apply — same reasoning as the plan's
  `[^diagram-scalar]` footnote).
- `Table.onSourceStoreChange`'s re-target on a removed/reloaded record
  (~886) now only emits when the newly resolved `_rotatedRecord` differs
  from what it was before the retarget, so a reload that leaves an
  already-`null` rotated selection at `null` no longer re-fires
  `"selection"`.
