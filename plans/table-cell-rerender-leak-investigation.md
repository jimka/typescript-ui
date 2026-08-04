# Table Cell-Editor Pool Residual Stylesheet-Rule Leak — Implementation Plan

## Overview

This is the fourth plan in the stylesheet-leak chain that started with [`plans/implemented/dock-disposes-tab-content.md`](../implemented/dock-disposes-tab-content.md). After three rounds of fixes, SQLAdmin's own re-measurement of closing one 20-column table tab repeatedly still showed a residual ~66 stylesheet rules leaked per cycle, with round three's own hand-off guessing the cause was "most likely" [`Table`](packages/lib/src/typescript/lib/component/table/Table.ts)'s per-cell *rendering* at realistic column/row counts.

That guess does not hold up. A faithful reproduction — a `Dock` tab whose content is a `ToolBar` + `Table` (mirroring [`TablePanel`](packages/lib/src/typescript/lib/component/table/TablePanel.ts)'s own `Border` layout), with 20 mixed-type columns (string, number, boolean, date, time, datetime) rendering 43-44 pool rows, opened and closed across four cycles with a fresh tab id each time — leaks zero stylesheet rules.[^rendering-refuted] `Table`'s cell-*rendering* path was already fixed before this investigation chain even started: [`VirtualRowView.destructor()`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L125) disposes every pooled row (and the scroller's overlay scrollbars), and [`HeaderCell.destructor()`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L586) disposes its side-loaded resize handle, sort badge, and header glyph — both predate this leak-chain's first plan.

The real remaining defect is in `Table`'s in-place cell-*editing* path, and it is the same defect class every round of this chain has fixed: a component built lazily, held only in a private field, never registered via `addComponent`, so a base `destructor()`'s child recursion can never reach it. Two owners have this gap:

1. **[`Body._editorPool`](packages/lib/src/typescript/lib/component/table/Body.ts#L225)** (a [`CellEditorPool`](packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts)) lazily builds one shared editor per variant (`string`, `number`, `date`, `time`, `datetime`, plus a `combo:<field>` editor per `values`-configured column) the first time any cell of that type is edited, and holds it in a private `Map` for the table's entire lifetime. `Body` inherits [`VirtualRowView.destructor()`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L125), which disposes the row pool and the scroller — but never touches `_editorPool`. `Cell.detachEditor()` only `removeComponent`s a borrowed editor when an edit ends (so the pool can lend it to the next cell) — it never disposes it, because the editor must survive to be reused. Nothing else ever reaches it once it is no longer any cell's registered child.[^editorpool-repro]
2. **[`DateEditor`](packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts), [`TimeEditor`](packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts), and [`DateTimeEditor`](packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts)** each lazily build their own picker overlay (`DatePickerDropdown` / `TimePickerDropdown` / `DateTimePickerDropdown` — all `AnimatedDropdown` subclasses, mounted via `LayerManager.mount` the same way `Menu` is) the first time the editor receives focus, and hold it in a private `_dropdown` field. None of the three declares a `destructor()` override, so the dropdown is never disposed even when the editor itself is.

These compose: on any table with a date, time, or datetime column, a single double-click into one such cell — with the edit immediately cancelled, never committed, no day ever picked — is enough to leak that editor's own rule, plus its entire picker overlay's rule tree, on every later close of that table for the rest of the page's life. Directly measured: one opened-then-disposed `DateEditor` alone leaves 59 rule-cache keys behind; opening all three date/time/datetime editors' dropdowns leaves 198.[^dropdown-repro] This is the exact defect class [`plans/implemented/table-tab-close-residual-leak.md`](../implemented/table-tab-close-residual-leak.md) fixed for `Menu`'s six owners and [`plans/implemented/table-toolbar-button-residual-leak.md`](../implemented/table-toolbar-button-residual-leak.md) fixed for `TabButton`'s close affordance — just one layer deeper, inside the cell-editor subsystem.

---

## Architecture Decisions

### `CellEditorPool` disposes its cached editors; `Body` gets its first `destructor()` override to call it

`CellEditorPool` gains a public `dispose()` that disposes every editor it has lazily built and clears its cache. This mirrors [`VirtualScroller.dispose()`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L163) — a plain, non-`Component` helper class owned by a `VirtualRowView` subclass, already disposed the identical way, from the identical call site, in `VirtualRowView.destructor()`. `Body.destructor()` (new) calls `this._editorPool.dispose()` before `super.destructor()`, the same one-line-then-defer shape every fix in this chain uses.[^double-dispose-safety]

### `DateEditor`, `TimeEditor`, and `DateTimeEditor` each dispose their own lazily-built picker overlay

Each gets a one-line `destructor()` override: `this._dropdown?.dispose(); super.destructor();`. This mirrors [`MenuButton.destructor()`](packages/lib/src/typescript/lib/component/button/MenuButton.ts#L105)'s own shape from the `Menu` fix — same defect (a `LayerManager`-mounted overlay held in a private field, never a registered child), different overlay family (`AnimatedDropdown`'s pickers, not `Menu`). The three fixes are independent one-liners, not a shared base-class hook, because each subclass's `_dropdown` field has its own concrete type (`DatePickerDropdown` / `TimePickerDropdown` / `DateTimePickerDropdown`) and `TextInputCellEditor` — their common ancestor — declares no such field of its own.[^no-shared-hook]

### The per-cell-rendering hypothesis is refuted

No change to `Row.ts`, `Header.ts`, any cell *renderer*, or `VirtualRowView.ts`'s row-pool disposal — all four were already correct before this investigation began. The leak is confined to the two editor-pool owners above.

### This plan targets the next release after 0.4.1

0.4.1 is finalized — version bumped, changelog and migration guide already written and covering every fix that has landed for it (`dispose-all-components`, `dock-disposes-tab-content`, `component-purges-event-listeners`, `table-tab-close-residual-leak`, `table-toolbar-button-residual-leak`, `table-scroll-forced-reflow`, `table-scroll-recycling-cost`, `table-scroll-first-visit-cost`). The residual leak this plan fixes is a known, already-documented, non-blocking issue for 0.4.1's publication — round three's own `## Potential Challenges` said as much. This plan's changelog entry (see `## Documentation Impact`) goes into [`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md), the page reserved for exactly this — unreleased notes not yet tied to a version number — rather than into `0.4.1.md`, which stays untouched. No `package.json` version bump.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts
class CellEditorPool {
    // ... existing members unchanged ...

    /**
     * Disposes every editor this pool has lazily constructed, releasing
     * their per-instance stylesheet rules, and clears the cache.
     */
    dispose(): void;
}
```

No other exported signature changes. The three new `destructor()` overrides (`Body`, `DateEditor`, `TimeEditor`, `DateTimeEditor`) are `protected`, excluded from the public API surface by TypeDoc.

---

## Internal Structure

```typescript
// packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts
// New method, placed after release() (ends line 109)

/**
 * Disposes every editor this pool has lazily constructed, releasing their
 * per-instance stylesheet rules. Called once, from `Body.destructor()`,
 * when the owning table is torn down — a shared editor is acquired into
 * `_editors` only on a real edit gesture (`Cell.startEdit` → `acquire`),
 * held there for the table's whole lifetime, and detached-but-not-disposed
 * on every edit end (`Cell.detachEditor`'s `removeComponent`, which keeps a
 * reusable editor alive across edits) — so nothing else ever reaches it.
 */
dispose(): void {
    for (const editor of this._editors.values()) {
        editor.dispose();
    }

    this._editors.clear();
}
```

```typescript
// packages/lib/src/typescript/lib/component/table/Body.ts — new override,
// placed after getEditorPool() (ends line 785)

/**
 * Disposes the shared cell-editor pool, then runs the inherited teardown
 * (which disposes the row pool and the scroller — see
 * VirtualRowView.destructor()). `_editorPool`'s cached editors are held in
 * a private Map, never a registered child of this body, so the base
 * destructor's recursion cannot reach them.
 */
protected destructor(): void {
    this._editorPool.dispose();

    super.destructor();
}
```

```typescript
// packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts — new
// override, placed after the constructor (ends line 46) and before isEmpty()

/**
 * Disposes the lazily-created picker dropdown, then runs the inherited
 * teardown. `_dropdown` is a LayerManager-mounted overlay (AnimatedDropdown
 * subclass), never a registered child, so the base destructor's recursion
 * cannot reach it.
 */
protected destructor(): void {
    this._dropdown?.dispose();

    super.destructor();
}
```

`TimeEditor` and `DateTimeEditor` each gain the identical override (same body, same doc comment, `_dropdown`'s own concrete type differs only in its declared field type) — `TimeEditor`'s placed after its constructor (ends line 46, before `isEmpty()`), `DateTimeEditor`'s placed after its constructor (ends line 47, before `retainsFocus()`).

---

## Ordered Implementation Steps

**Baseline first.** In `packages/lib`, run `npm run test` and confirm it is green before making any change.

1. `packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts` — add the `dispose()` method from `## Internal Structure`, after `release()` (line 109).

2. `packages/lib/src/typescript/lib/component/table/Body.ts` — add the `destructor()` override from `## Internal Structure`, after `getEditorPool()` (line 785). No new import needed — `CellEditorPool` is already imported (line 12).

3. `packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts` — add the `destructor()` override from `## Internal Structure`, after the constructor (line 46) and before `isEmpty()` (line 53).

4. `packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts` — add the analogous override (identical body and doc comment, `_dropdown` typed `TimePickerDropdown | null`), after the constructor (line 46) and before `isEmpty()` (line 56).

5. `packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts` — add the analogous override (`_dropdown` typed `DateTimePickerDropdown | null`), after the constructor (line 47) and before `retainsFocus()` (line 62).

6. `packages/lib/tests/component/table/CellEditorPool.styleRuleDisposal.test.ts` (new) — mirror `tests/overlay/Menu.styleRuleDisposal.test.ts`'s shape (header comment naming the defect and this plan, `installTestDOM`/`DOM.reset()` harness, a warm-up pass, before/after `_ruleCacheKeys()` diffs). Cover:
   - **Base pool leak, generic across editor variants.** Build a `Table` with a `string` column and one row, render it, drive `Cell.startEdit()` on the first body-pool row's first cell (via `(table as unknown as { _body: {...} })._body.getRowPool()[0].getComponents()[0]`, matching the file's existing loose-cast idiom), then `cancelEdit()` (detaches, does not dispose — this is the case that used to leak). Dispose the `Table` directly and assert `_ruleCacheKeys()` gained nothing outside `before`.
   - **`DateEditor` in isolation.** Build a standalone `new DateEditor()`, render it, call its private `openDropdown()` (cast `as unknown as { openDropdown(): void }`, matching `dispose-full-teardown.test.ts`'s `ensureArrow()` / `toggleMenu()` idiom), then call `destructor()` directly. Assert no id belonging to the dropdown (or any of its descendants) survives — the dropdown's own id, captured via `(editor as unknown as { _dropdown: { getId(): string } })._dropdown.getId()` before disposal, must not appear in any post-disposal `_ruleCacheKeys()` entry.
   - **`TimeEditor` and `DateTimeEditor` in isolation.** Same shape as the `DateEditor` case.
   - **End-to-end: a real `Table` with a `date` column.** Build the table, start-edit a date cell (`Cell.startEdit()` calls `editor.focus(true)` internally, which fires the `DateEditor`'s own `"focus"` listener and opens the dropdown — no need to call `openDropdown()` directly here), `cancelEdit()`, then dispose the whole `Table`. Assert zero leaked rule-cache keys — proving `Body`'s pool disposal and `DateEditor`'s dropdown disposal compose correctly through the real `Cell.startEdit` → `CellEditorPool.acquire` → `Body.destructor` → `CellEditorPool.dispose` → `editor.dispose` → `DateEditor.destructor` chain, not just each fix in isolation.
   - **A pool that never acquired any editor disposes as a no-op.** A `Table` with only `string`/`number` columns, never edited, disposes with the same rule-cache diff as before this plan (empty `_editors` map — `dispose()`'s loop is a no-op).
   - **A cell mid-edit when the whole table disposes leaves nothing behind either, and does not throw.** Start-edit a cell, dispose the `Table` *without* committing or cancelling first. The active editor is reached twice — once via the normal `Cell` → registered-child recursion (it is still `addComponent`-registered on the editing cell), once via `Body`'s new `_editorPool.dispose()` call — both routes converge on the same instance; `Component.dispose()` is documented idempotent, so the second call is a harmless no-op. Assert no leaked keys and no thrown error.

7. `packages/lib/tests/component/dispose-full-teardown.test.ts` — add four new rows, each materialising the lazy field before disposing (mirroring the existing `Popover` / `MenuButton` rows' idiom). The pool-disposal row goes through a real `Table` (matching the file's existing `Table` row, which already builds one from a `MemoryStore` + single-column `Model`) rather than standing up a bare `Body` — `Body.setColumns` takes `Column[]`, not field names, so driving it through `Table`'s own constructor is the direct, already-established path to a rendered, edit-ready cell:
   ```typescript
   {
       name: 'Table (cell-editor pool)',
       make: () => {
           const table = new Table(new MemoryStore(new Model([{ name: 'a', type: 'string', order: 0 }], 'a'), [{ a: 'x' }]));

           table.getElement(true);

           const body = (table as unknown as { _body: { getRowPool(): Array<{ getComponents(): Array<{ startEdit(): void; cancelEdit(): void }> }> } })._body;
           const cell = body.getRowPool()[0].getComponents()[0];

           cell.startEdit();
           cell.cancelEdit();

           return table;
       },
   },
   {
       name: 'DateEditor',
       make: () => {
           const editor = new DateEditor();

           editor.getElement(true);
           (editor as unknown as { openDropdown(): void }).openDropdown();

           return editor;
       },
   },
   // TimeEditor and DateTimeEditor: identical shape, substituting the class.
   ```
   Confirm `getRowPool()` returns a non-empty pool immediately after `getElement(true)` for a one-row store (it should — `Table`'s own initial layout grows the pool to fit its content, the same as every other `Table`-based row in this file) before trusting the row; add the four imports (`Table` is already imported; add `DateEditor`, `TimeEditor`, `DateTimeEditor`, all barrel-exported from `~/component/table`).

8. Regression checkpoint: `grep -rn '^\s*protected destructor(' packages/lib/src/typescript/lib | wc -l` — 40 (was 36 before this plan: `Body`, `DateEditor`, `TimeEditor`, `DateTimeEditor`, one each). `grep -n 'dispose(): void' packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts` — one hit.

9. `packages/lib/docs/reference/changelog/next.md` — replace the "Nothing here yet." placeholder with a real entry, following `0.4.1.md`'s section shape (`## Fixed` → `### Table`):
   > ## Fixed
   >
   > ### Table
   >
   > **Editing a date, time, or datetime cell — even just opening it and cancelling, never committing — used to strand that editor's picker overlay on the shared stylesheet forever once the table itself was later disposed.** The shared editor pool behind in-place cell editing was never disposed when the owning table was, and none of the three date/time/datetime editors disposed their own lazily-built picker dropdown either. No consumer action is needed.

10. Run the full `## Verification` list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts` |
| Create | `packages/lib/tests/component/table/CellEditorPool.styleRuleDisposal.test.ts` |
| Modify | `packages/lib/tests/component/dispose-full-teardown.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases are unit-testable under the offline harness (`installTestDOM` + the modelled DOM; no real geometry, hover, or focus needed for the pool/dropdown disposal itself — a `DateEditor`'s `"focus"` DOM listener fires from the modelled DOM's synthetic focus dispatch the same way `Cell.startEdit()`'s real callers trigger it).

- **A `Body` whose editor pool never acquired an editor disposes with no behaviour change.** Empty `_editors` map, `dispose()`'s loop is a no-op.
- **A `Body` whose pool acquired a `StringEditor` (or `NumberEditor`, or a `combo:<field>` `ComboEditor`) — edited once, then cancelled — leaves no trace of that editor or its own children after the `Table`/`Body` disposes.**
- **A `DateEditor` / `TimeEditor` / `DateTimeEditor` whose dropdown was opened at least once leaves no trace of the dropdown or any of its descendants after the editor's own `destructor()` runs**, whether the dropdown was left open or closed at the moment of disposal — `dispose()` must tear it down regardless, matching the rule `plans/implemented/table-tab-close-residual-leak.md` already established for `Menu`.
- **The end-to-end path — a real `Table` with a date column, edited once and cancelled, then the whole `Table` disposed — leaves zero leaked rule-cache keys.** This is the case that proves the two fixes compose; each is independently testable but this is the one that matches the real-world defect.
- **Disposing a table while a cell is actively mid-edit is safe and leak-free.** The active editor is reached both via the normal child-recursion (still registered on its editing cell) and via the pool's own `dispose()` call; the second is a harmless idempotent no-op.
- **Every other existing `Body`, `DateEditor`, `TimeEditor`, and `DateTimeEditor` behavioural test passes unmodified** — this plan only adds disposal, it does not change any edit/commit/cancel/focus behaviour.

No case here needs manual/browser verification — the defect and the fix are both fully expressible through `getElement(true)` + the private trigger methods + `destructor()`/`dispose()` + `_ruleCacheKeys()`, exactly like the rest of the `*.styleRuleDisposal.test.ts` family.

---

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run test` — full suite green, including the new `CellEditorPool.styleRuleDisposal.test.ts`, the four new `dispose-full-teardown.test.ts` rows, and every pre-existing table/editor suite this branch carries (`tests/component/table/*`, `tests/component/shared/VirtualRowView.poolDisposal.test.ts`, `tests/component/table/HeaderCell.disposal.test.ts`, `tests/component/table/Header.disposal.test.ts`) — this plan must not regress any of them.
- The step 8 grep checkpoints.
- `npm run docs:api` — zero warnings (`CellEditorPool.dispose()` is a new public member and needs a clean doc comment with no `{@link}` to an excluded symbol; the three `destructor()` overrides are `protected`, excluded from the public surface).
- `npm run build:lib` — succeeds.
- **Manual, in the library's own demo app**, repeating the SQLAdmin measurement methodology so the fix is checkable the same way the defect was found — this is a sanity check on this branch; the authoritative re-measurement against SQLAdmin happens later, outside this plan:
  1. Open `MiscPanel`'s "Show window with wide table (45 columns)!" demo (`packages/lib/src/typescript/MiscPanel.ts:346`) — its columns are `string` / `number` / `date` / `boolean` only; temporarily widen the `TYPES` array to also include `time` and `datetime` for this manual check (matching `wide.cols_60`'s described shape), or add a second demo button with a smaller mixed-type model if editing the shipped one is inconvenient. Revert any temporary demo change afterward — it exists only to drive this check, not to ship.
  2. Open the browser console, record `[...document.styleSheets].reduce((n, s) => n + s.cssRules.length, 0)`.
  3. Double-click a date (or time/datetime) cell to start editing, press Escape to cancel, then close the window. Record the rule count again.
  4. Repeat four times. Before this plan's fix, the count grows every cycle by the editor's own rule plus its picker overlay's full rule tree; after the fix, it returns to the pre-cycle baseline each time.

---

## Documentation Impact

[`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) gains the `## Fixed` → `### Table` entry from step 9 — the page's placeholder "Nothing here yet." is replaced with real content for the first time since the 0.4.1 release reset it. [`docs/reference/changelog/index.md`](packages/lib/docs/reference/changelog/index.md) already links to "Next" unconditionally; no change needed there. `packages/lib/docs/reference/changelog/0.4.1.md` and any `package.json` are explicitly out of scope (see `## Non-Goals`).

---

## Potential Challenges

- **The step 7 registry row's exact pool-access cast is a sketch, not a fully verified sequence.** It mirrors the `CellEditorPool.styleRuleDisposal.test.ts` file's own "base pool leak" case (step 6), which is written and run first — confirm that case passes before copying its access pattern into the registry row, so any adjustment happens once rather than in two places.
- **`CellEditorPool.dispose()` running twice on the same editor instance (once via the pool, once via the normal child-recursion for a mid-edit cell) relies on `Component.dispose()`'s documented idempotency.** Mitigation: this is the same reasoning `plans/implemented/table-tab-close-residual-leak.md` used for `MenuBar`'s potential double-dispose — cited directly rather than re-derived; no new risk.
- **The manual demo-app verification needs `time`/`datetime` columns the shipped wide-table demo doesn't have.** Mitigation: the verification step spells out both options (temporarily widen `TYPES`, or add a second small demo button) and requires reverting whichever is used — this mirrors `plans/implemented/table-tab-close-residual-leak.md`'s own temporary-demo-addition-then-revert precedent.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/container/VirtualScroller.ts:156-166`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L156) — the precedent `CellEditorPool.dispose()` mirrors: a plain, non-`Component` helper class exposing its own `dispose()`, called from its owner's `destructor()`.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts:111-133`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L111) — `VirtualRowView.destructor()`, the base class `Body.destructor()` extends; read this so the new override's placement (before `super.destructor()`) and its interaction with row-pool disposal is clear.
- [`packages/lib/src/typescript/lib/component/button/MenuButton.ts:99-109`](packages/lib/src/typescript/lib/component/button/MenuButton.ts#L99) — the precedent the three editor `destructor()` overrides mirror.
- [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts:389-428`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L389) — `startEdit()` (the `acquire` + `addComponent` + `focus` call chain) — and [`Cell.ts:471-486`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L471) — `detachEditor()` (`removeComponent`, not `dispose`) — the exact lifecycle this plan's fix closes the gap in.
- [`packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts`](packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts) — `acquire()` (95-101), `release()` (107-109), the `_editors` cache this plan adds `dispose()` beside.
- [`packages/lib/src/typescript/lib/component/table/Body.ts:225`](packages/lib/src/typescript/lib/component/table/Body.ts#L225) — `_editorPool`'s declaration, and `getEditorPool()` (783-785), where the new `destructor()` is placed.
- [`packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts`](packages/lib/src/typescript/lib/component/table/cell/editor/Date.ts), [`Time.ts`](packages/lib/src/typescript/lib/component/table/cell/editor/Time.ts), [`DateTime.ts`](packages/lib/src/typescript/lib/component/table/cell/editor/DateTime.ts) — `_dropdown` field declarations, `openDropdown()` / `closeDropdown()`, and the `"focus"` listener that opens the dropdown from `Cell.startEdit()`'s `editor.focus(true)` call.
- [`packages/lib/tests/overlay/Menu.styleRuleDisposal.test.ts`](packages/lib/tests/overlay/Menu.styleRuleDisposal.test.ts) — the direct template for the new `CellEditorPool.styleRuleDisposal.test.ts`.
- [`packages/lib/tests/component/dispose-full-teardown.test.ts`](packages/lib/tests/component/dispose-full-teardown.test.ts) — the registry this plan extends; read its header comment and the `Popover` / `MenuButton` rows' "materialise the lazy field first" idiom before adding rows.
- [`plans/implemented/table-toolbar-button-residual-leak.md`](../implemented/table-toolbar-button-residual-leak.md) — the direct predecessor; its footnote is the hypothesis this plan tests and refutes.
- [`plans/implemented/table-tab-close-residual-leak.md`](../implemented/table-tab-close-residual-leak.md) — the `Menu` fix this plan's `DateEditor`/`TimeEditor`/`DateTimeEditor` fix mirrors one layer deeper.
- [`plans/implemented/table-scroll-first-visit-cost.md`](../implemented/table-scroll-first-visit-cost.md) — the "investigate, refute the standing hypothesis with a direct reproduction" shape this plan's rendering-refutation follows, even though this plan does not end up defect-free overall.

---

## Non-Goals

- **Closing the exact gap to SQLAdmin's field-measured ~66 rules/cycle.** This plan fixes two confirmed, directly-reproduced defects in the cell-editing path. Whether they explain the full field-measured number depends on whether SQLAdmin's own repeated open/close cycle included editing a date/time/datetime cell — not verified against the live app here, matching every predecessor plan's own "the SQLAdmin-side re-measurement happens later, outside this plan" scoping.
- **`ComboEditor`'s own dropdown.** `ComboEditor` wraps a `ComboBox` via `addComponent` (a registered child, not a raw field), so it is already reached by ordinary base-class recursion — confirmed by reading `Combo.ts`'s constructor; not a defect, not touched.
- **A shared `destructor()` hook on `TextInputCellEditor`.** Each of `DateEditor` / `TimeEditor` / `DateTimeEditor`'s `_dropdown` field has its own concrete type, and `TextInputCellEditor` declares no such field itself — three small overrides follow the established one-owner-one-line pattern (`MenuButton`, `SplitButton`, `ToolBar`, `Table`, `MenuBar` all did this individually in the `Menu` fix) rather than inventing a shared abstraction for three call sites.
- **The `Dock` tab-id-reuse rendering quirk found incidentally while building this plan's reproduction** — re-adding a panel under the same id immediately after `removePanel` renders with zero rows (table width/height both read back `NaN`). This is a `Dock` tab-identity question, unrelated to stylesheet leaks or cell rendering, and was not investigated further — the reproduction that surfaced it used a fresh id per cycle instead, which is unaffected by whatever this is.
- **No `package.json` version bump, and no edit to `packages/lib/docs/reference/changelog/0.4.1.md`.** This plan targets the next release after 0.4.1 (see `### This plan targets the next release after 0.4.1` above) — its changelog entry goes into `next.md` instead.

---

## Notes

[^rendering-refuted]: Verified with a throwaway offline reproduction before drafting this plan (not part of this plan's deliverable): a `Dock` hosting one tab whose content was a `Container(Border)` with a `ToolBar` (three titled `Button`s) in `NORTH` and a `Table` in `CENTER` — the same nesting `TablePanel` uses. The table's model had 20 fields cycling through `string` / `number` / `boolean` / `date` / `time` / `datetime` (matching `wide.cols_60`'s described type mix, narrowed to 20 columns), 200 rows, rendering a 43-44-row pool at an 800px-tall dock. Opening a fresh tab id, letting the table fully render, then calling `dock.removePanel(id)` — repeated across 4 cycles, after one untracked warm-up cycle — produced zero rule-cache keys outside the pre-cycle baseline on every cycle. Re-adding a panel under the *same* id immediately after `removePanel` was tried first and found to render with a zero-size table (width/height both `NaN`) — an unrelated `Dock` quirk, scoped out in `## Non-Goals`; switching to a fresh id per cycle sidesteps it and renders correctly every time.

[^editorpool-repro]: Verified directly: a `Table` with one `string` column and two rows, rendered once as a warm-up and disposed (to exclude any process-global rule from the diff), then rebuilt. The first pool row's first cell's `startEdit()` was called directly (acquiring a `StringEditor` from `Body`'s pool — confirmed materialised: the editor's id appeared in `_ruleCacheKeys()` immediately), then `cancelEdit()` (detaches, does not dispose). Disposing the `Table` directly left 2 new rule-cache keys behind: the `StringEditor`'s own id and its child `TextField`'s id.

[^dropdown-repro]: Verified directly: a standalone `new DateEditor()`, rendered and warmed up once (disposed, to exclude any process-global rule), then rebuilt with its private `openDropdown()` called directly (mounting the `DatePickerDropdown`, confirmed via its id appearing in `_ruleCacheKeys()`). Calling the editor's `destructor()` directly left 59 rule-cache keys behind. Repeating with all three of `DateEditor`, `TimeEditor`, and `DateTimeEditor` opened and then disposed left 198 rule-cache keys behind; a structural walk of each dropdown's `getComponents()` tree (captured before disposal) attributed the `DatePickerDropdown` portion to `PickerDay` (62), `PickerBlankCell` (22), `PickerDayHeader` (14), `PickerNavButton` (4), `PickerMonthLabel` (2), `Glyph` (5), a generic `Component` (9, the dropdown's own chrome), and the dropdown's own id (1) — 119 of the 198, with the remainder attributable to `TimePickerDropdown` / `DateTimePickerDropdown`'s own internal structure, which the walk script did not fully traverse. The gap does not affect the fix: `dispose()` on the top-level dropdown recurses through whatever it owns via `Component.destructor()`'s ordinary child recursion, regardless of what the throwaway measurement script's tree-walk helper understood.

[^double-dispose-safety]: A cell mid-edit when the whole table disposes is reached twice: once via the ordinary `Cell` → registered-child recursion (the borrowed editor is still `addComponent`-registered on the editing cell — `Cell.detachEditor()` only removes it when an edit actually *ends*), and once via `Body`'s new `_editorPool.dispose()` call, since the pool's own cache still holds the same instance (`release()` only clears the active-cell pointer, it does not evict the cache). `Component.dispose()` is documented idempotent, so the second call is a harmless no-op — the same reasoning `plans/implemented/table-tab-close-residual-leak.md` used for `MenuBar`'s potential double-dispose of an already-disposed panel.

[^no-shared-hook]: `TextInputCellEditor` (the shared base of `DateEditor` / `TimeEditor` / `DateTimeEditor`) declares no `_dropdown` field itself — each subclass's field has its own concrete picker type. A shared `destructor()` on the base would need either an abstract accessor or a loosely-typed field, adding an indirection layer to save three one-line overrides. The `Menu` fix's own six owners (`MenuButton`, `SplitButton`, `ToolBar`, `Table`, `MenuBar`, plus `TabBar`'s extended existing override) took the identical one-owner-one-line approach rather than a shared hook, for the same reason.
