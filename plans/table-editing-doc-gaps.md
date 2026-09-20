---
depends-on: [cell-editor-record-binding]
touches-shared:
    - packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts
    - packages/lib/docs/components/Table.md
    - packages/lib/docs/components/TableInternals.md
---

# Table Editing Documentation Gaps — Implementation Plan

## Overview

Four pieces of prose about table cell editing are out of step with the code that ships
today: three say less than the code does or contradict it outright, and one is missing from
the page its audience reads. All four trace back to
[`plans/implemented/cell-editor-record-binding.md`](plans/implemented/cell-editor-record-binding.md),
whose Documentation Impact listed the pages a grep turned up rather than the pages the
affected audiences read.

This plan changes prose only: one TSDoc `@remarks` block in the library source and two
Markdown pages under `packages/lib/docs/`. No behaviour changes, no signature changes, no
new tests, no changelog entry.[^no-changelog]

| Item | Where | What is wrong |
|---|---|---|
| 2c | [`CellEditorPool.ts:68-72`](packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L68) | `register`'s `@remarks` says the commit is of a cell editing *in the dropped editor*. The code commits whichever cell holds the pool's one active slot, whatever key that cell borrowed. |
| 2d | [`Table.md:72`](packages/lib/docs/components/Table.md#L72) | The consumer-facing consequence — a rebind ends the edit, and keyboard focus is not restored — lives only in [`changelog/next.md:606-608`](packages/lib/docs/reference/changelog/next.md#L606). It is missing from the page a consumer building an editable table reads. |
| 2e | [`Table.md:438`](packages/lib/docs/components/Table.md#L438) | The `setRowVisible` bullet promises that hiding a row "never touches … a pending in-grid edit". Hiding a row above an edited one now commits and closes that edit. |
| 2f | [`TableInternals.md:67`](packages/lib/docs/components/TableInternals.md#L67) | The trigger list says the row rebind happens "as the user scrolls". The commit sweep keys on record identity, so a sort, a filter or a store change fires it too. |

Items 2e and 2f were found by this plan, not by wave 0. They are the answer to "is anything
else in the same neighbourhood now wrong" — and they are the whole answer: nothing else
is.[^neighbourhood-sweep]

---

## Architecture Decisions

### `register`'s `@remarks` states the commit by active slot, not by key

The amendment says the pool tracks one active cell at a time and commits that cell whatever
key it borrowed. It describes the private helper doing the commit in prose rather than
naming it, which would draw a TypeDoc warning.[^no-link-private]

| While the user is editing… | …something calls | Open edit committed? |
|---|---|---|
| a `"string"` cell | `register("combo:status", …)`, a cached `"combo:status"` editor exists | yes — the pool's active cell is the string cell, and it is the one committed |
| a `"string"` cell | `register("combo:status", …)`, no cached editor for that key | no — `register` leaves the active slot alone |
| a `"combo:status"` cell | `register("combo:status", …)`, a cached editor exists | yes — the case the current remark already covers |

Only the third row matches what the remark says today; the first is what the amendment
adds.

### `Table.md` owns the consumer-facing statement; the other two pages defer to it

The full rule — what ends an edit, what happens to the value, what happens to focus — is
stated once, in the editing paragraph of `Table.md`. `Table.md:438` and
`TableInternals.md:67` each get the smallest correction that stops them contradicting
it.[^say-it-once]

### The rule is stated by trigger, not by axis

An edit ends whether the row under it is rebound or its column scrolls out of the rendered
range, so the new paragraph names the triggers a consumer can actually cause rather than
splitting the statement into a row case and a column case.

| What the consumer does while a cell is open for editing | Ends the edit? | Why |
|---|---|---|
| Scrolls vertically far enough that the edited row's pool slot takes a different record | yes | `commitEditsBeforeRebind` — slot's record identity changed |
| Sorts, filters, or calls `setRowVisible` / `setQuickSearch` so rows shift under the editor | yes | same sweep — the visible-record list changed under a settled slot |
| A background store `add` / `remove` above the edited row | yes | same sweep |
| Scrolls horizontally until the edited column leaves the rendered column range | yes | `commitEditsOutsideWindow` — the pre-existing column-axis sweep |
| Scrolls vertically while the edited row's slot keeps the same record | no | the sweep skips a slot whose record is unchanged |

### `llms.txt` gets no line

`packages/lib/llms.txt` is generated and must not be hand-edited, its rows are one-line
capability pointers rather than behaviour caveats, and nothing this plan touches feeds
it.[^llms-unaffected]

---

## Ordered Implementation Steps

Every quoted "before" string below is the file's current text at `master` `2097d27d`. If a
string does not match, stop rather than guessing — the line has moved.

1. **`packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts`** —
   in `register`'s `@remarks` block (lines 68-72), replace:

   ```
     * a cell is editing in right now — `Table.setDisplayMode` re-registers every combo column's
     * factory — so that cell's open edit is committed before the editor goes. A key with no
     * cached editor, the setup-time case, commits and disposes nothing.
   ```

   with:

   ```
     * a cell is editing in right now — `Table.setDisplayMode` re-registers every combo column's
     * factory — so an open edit is committed before the editor goes. That commit is not narrowed
     * to the dropped key: the pool tracks one active cell at a time, so a cell editing in another
     * key's editor is committed too. A key with no cached editor, the setup-time case, commits
     * and disposes nothing.
   ```

   Keep the existing wrap width (the block wraps near column 100) and leave the first
   sentence, both `@param` lines and `@returns` untouched.

   *Check:* `grep -n "narrowed to the dropped key" packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts` — one match. `grep -c "commitActiveCell" packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts` — still 3 (two call sites plus the declaration); the new prose must add no fourth.

2. **`packages/lib/docs/components/Table.md`** — insert a blank line and then this new
   paragraph immediately after line 72 (the `While a cell is being edited, Tab / Shift+Tab …`
   paragraph), so it sits between that paragraph and the `Every column gets a width floor …`
   one. Write it as a single unwrapped line, matching line 72's style:

   > An open edit does not survive the rendered window moving out from under it. When the edited cell's row is bound to a different record — by a scroll, a sort, a column filter, `setRowVisible` / `setQuickSearch`, or a store change that shifts rows — or when its column scrolls out of the rendered column range, the edit is committed onto the record it was opened against rather than carried along, and keyboard focus is not restored afterwards.

   *Check:* `grep -n "keyboard focus is not restored" packages/lib/docs/components/Table.md` — one match, between the `Tab / Shift+Tab` paragraph and `Every column gets a width floor`.

3. **`packages/lib/docs/components/Table.md`** — in the **Row visibility** section, replace
   the `Display-only.` bullet (line 438 before step 2's insert; line 440 after it):

   > - **Display-only.** Hiding a row never touches `getStore()`'s records, the current selection, or a pending in-grid edit.

   with:

   > - **Display-only.** Hiding a row never removes a record from `getStore()` and never changes the current selection. It can still end an open in-grid edit: if re-applying the predicate binds the edited cell's row to a different record, that edit is committed onto the record it was opened against first.

   *Check:* `grep -c "pending in-grid edit" packages/lib/docs/components/Table.md` — zero.

4. **`packages/lib/docs/components/TableInternals.md`** — in the `Shared editor pool`
   section's ownership paragraph (line 67), replace the third trigger's trailing clause:

   > rebinding the editing cell's pooled row to a different record as the user scrolls.

   with:

   > rebinding the editing cell's pooled row to a different record — as the user scrolls, sorts or filters, or as a store change shifts rows.

   Change nothing else in that paragraph: the ownership rule, the other two triggers and
   the `release(cell)` sentence are all still correct.

   *Check:* `grep -c "as the user scrolls\." packages/lib/docs/components/TableInternals.md` — zero.

5. **Regression sweep.** `grep -rn "that cell's open edit" packages/lib/src` — zero matches
   (step 1 removed the only one in the source tree). Do not include `packages/lib/docs/api/`
   in that grep: it is stale generated output until step 6 regenerates it.
   `grep -rln "never written onto a different row" packages/lib/docs/components` — still
   exactly `packages/lib/docs/components/TableInternals.md`.

6. **Docs build.** Run the two commands in `## Verification`, in that order.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/components/TableInternals.md` |

---

## Verification

Run from the repository root:

1. `npm run docs:api` — regenerates the TypeDoc model and the Markdown API pages. The bar
   is **no new warnings**, not zero: `master` already emits 14.[^warning-baseline] Compare
   the count against a run on `master` if in doubt. Confirm the regenerated
   `packages/lib/docs/api/component/table/classes/CellEditorPool.md` carries the new
   sentence under `register`, and that no warning names `CellEditorPool.ts`.
2. `npm run docs:llms:check` — must pass. It reads the TypeDoc model `docs:api` just
   emitted, so it also confirms that step 1 produced a usable model. No class is added or
   removed, so its verdict must be unchanged.

`packages/lib/docs/api/` is gitignored (`.gitignore:14`), so step 1 produces no committable
diff — it is a check, not an edit.

There is nothing to unit-test: no code path changes. `## Expected Behaviour` is omitted for
the same reason.

---

## Documentation Impact

This plan *is* the documentation change. What it implies for the generated artefacts:

- `packages/lib/docs/api/component/table/classes/CellEditorPool.md` is TypeDoc output,
  gitignored, and regenerates from step 1's source edit. Never hand-edit it.
- `packages/lib/llms.txt` needs no line and gets no regeneration — see the
  `llms.txt` decision above and its footnote.
- `packages/lib/docs/reference/changelog/next.md` gets no entry.[^no-changelog]
- `packages/lib/docs/recipes/custom-cell.md` needs no change. Its "Lifecycle hooks" list
  (`:170-175`) describes how an edit starts, commits and cancels; it makes no claim about
  what happens to an edit left open across a render pass, so nothing in it is falsified.

---

## Critical Files

| File | Why the implementer should read it |
|---|---|
| [`component/table/cell/editor/CellEditorPool.ts:61-86`](packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L61) | `register` and the `@remarks` block step 1 edits; the `commitActiveCell(null)` call at `:78` is the code the amendment describes |
| [`component/table/cell/editor/CellEditorPool.ts:158-179`](packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L158) | `commitActiveCell` — commits `_activeCell` with no reference to any key, which is why the current remark is too narrow |
| [`component/table/Body.ts:1369-1412`](packages/lib/src/typescript/lib/component/table/Body.ts#L1369) | `commitEditsBeforeRebind` — the record-identity trigger behind steps 2, 3 and 4 |
| [`component/table/Body.ts:1348-1367`](packages/lib/src/typescript/lib/component/table/Body.ts#L1348) | `commitEditsOutsideWindow` — the pre-existing column-axis sweep the new paragraph's "or when its column scrolls out" clause refers to |
| [`component/table/Body.ts:813-819`](packages/lib/src/typescript/lib/component/table/Body.ts#L813) | `setRowVisible` — invalidates bindings and forces a render, which is how step 3's case is reached |
| [`docs/reference/changelog/next.md:598-608`](packages/lib/docs/reference/changelog/next.md#L598) | The only existing statement of the behaviour; step 2's paragraph is its consumer-page counterpart |
| [`CODE_CONVENTIONS.md:17-23`](CODE_CONVENTIONS.md#L17) | The `{@link}` rule step 1 must respect |

---

## Non-Goals

- **No behaviour change.** Nothing here alters when an edit is committed, what it writes,
  or where focus lands. If the "focus is not restored" behaviour is judged wrong, that is a
  separate plan; this one documents what ships.
- **No restructuring of `Table.md`.** No new heading, no new anchor, no reordering. The new
  paragraph joins the existing editing prose under `## Constraining columns`.
- **No hand-edit of `packages/lib/llms.txt` or `packages/lib/docs/api/`.** Both are
  generated.
- **No sweep of the other open agenda items.** Items 2a, 2b, 4 and 5 in
  `plans/research/render-review-2026-09-15/01-phase2-status-pass.md` stay open; only 2c and
  2d (plus the two contradictions found beside them) are in scope.

---

## Notes

[^no-changelog]: `packages/lib/docs/reference/changelog/next.md` records consumer-visible
    changes in behaviour or API. This plan corrects documents *about* an already-released
    behaviour, and the behaviour itself is already described at `next.md:598-608`. Adding a
    second entry would put the same fact in the changelog twice, one of them dated to the
    wrong change.

[^neighbourhood-sweep]: What was checked, and what came back clean. In
    `packages/lib/docs/components/Table.md`: the `readOnly` column row (`:57`), the
    combo-column and per-cell-cell-type notes (`:114`, `:161`, `:164`), the rotated
    read-only note (`:188`), the cell range copy/cut/paste paragraph (`:274`), the
    `cellclick` "clicking inside an active editor does not steal its focus" sentence
    (`:350-351`), the quick-search bulk-edit caching bullet (`:422`) and the
    auto-size-on-in-cell-edit paragraph (`:493`) — every one of them describes a different
    mechanism and none asserts anything about an edit surviving a render pass. In
    `packages/lib/docs/recipes/custom-cell.md`: the "register a factory before the first
    edit" advice (`:130`) and the lifecycle-hooks list (`:170-175`) are both still correct.
    In `packages/lib/docs/components/TreeTable.md`: `:60` and `:78` describe read-only
    columns and key bindings, both inherited unchanged. `TreeBody` overrides neither
    `bindAndPositionRows` nor the pool, so `TreeTable.md` needs nothing of its own. The two
    that did not come back clean are items 2e and 2f in the table above.

[^no-link-private]: [`CODE_CONVENTIONS.md:17-23`](CODE_CONVENTIONS.md#L17) forbids a public
    symbol's JSDoc from `{@link}`-ing a `private`, `protected` or `@internal` member —
    TypeDoc resolves the link, finds no generated page for it, and warns. `commitActiveCell`
    is `private`, so the amendment describes what it does ("the pool tracks one active cell
    at a time") instead of naming it. The same rule is why the surrounding block writes
    `` `Table.setDisplayMode` `` in backticks rather than as a link.

[^say-it-once]: Three pages could each carry the full rule, and then three pages would have
    to be kept in step. `Table.md` is the page a consumer building an editable table reads,
    so it gets the statement. `Table.md:438` is a promise about `setRowVisible` that is now
    false, so it is corrected in place rather than cross-linked — a link from the Row
    visibility section to an anchor named "Constraining columns" would read as a non
    sequitur. `TableInternals.md:67` is not false, only narrow, so it gets the trigger list
    widened and nothing more; repeating the focus consequence there would be the fourth copy
    of a fact that already appears in the changelog and on `Table.md`.

[^llms-unaffected]: Four independent reasons, any one of which is sufficient. (1)
    `packages/lib/llms.txt:1` reads `GENERATED by scripts/llms/generate.mjs from
    scripts/llms/manifest.data.mjs — do not edit by hand`. (2) Its rows are
    `task → symbol · import subpath · summary · docs` pointers; the `Table` row
    (`llms.txt:70`) already points at `docs/components/Table.md`, which is exactly where
    step 2's sentence lands, so the manifest already routes a reader to it. (3) Nothing this
    plan edits feeds the file: `CellEditorPool` is listed in `excludedSymbols`
    (`scripts/llms/manifest.data.mjs:230`) and so has no row, and `Table`'s row carries
    `Table`'s *class-level* summary, which is untouched — `npm run docs:llms` would emit a
    byte-identical file. (4) `docs:llms:check` (`scripts/llms/check-coverage.mjs`) only
    fails when a concrete public class appears in neither `groups` nor `excludedSymbols`, or
    when an `excludedSymbols` entry no longer resolves; no class is added, removed or
    renamed here.

[^warning-baseline]: [`CODE_CONVENTIONS.md:23`](CODE_CONVENTIONS.md#L23) says `docs:api`
    "must finish with zero warnings", but that has not been true of `master` for some time:
    [`plans/implemented/abstractwindow-throttle-consolidation.md:658`](plans/implemented/abstractwindow-throttle-consolidation.md#L658)
    records the same 14 pre-existing warnings and checks against them rather than against
    zero. Writing a zero bar into this plan would make it fail on arrival and invite the
    implementer to go fix 14 unrelated warnings. The bar is therefore "no new warnings, and
    none naming `CellEditorPool.ts`".
