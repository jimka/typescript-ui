# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Changed

### Table

- **A `DynamicCell` number row (the rotated `\x`-style view, or any column
  using `ColumnConfig.cellType`/`cellValues` for a per-row mixed-type
  column) now renders left-aligned instead of right-aligned.** A
  homogeneous `number`-typed column still right-aligns via `NumberCell` /
  `NumberRenderer`'s default — only the mixed-type `DynamicCell` context
  changes, since there a lone right-aligned number row sat oddly against
  every other row's left-aligned string/date/combo text. No consumer action
  is needed.

## Added

### Tree

- **`Tree` `"expand"` / `"collapse"` events.** Fire whenever a single node's
  expansion changes — a caret click, `ArrowRight` / `ArrowLeft`, a
  double-click on a parent row, or a programmatic `expandNode(node)` /
  `expandNodeAsync(node)` — after the expansion has committed and the rows
  have been rebuilt. Bulk changes (`setNodes`, `expandAll`,
  `revealByPredicate`) stay silent, matching their existing contract. No
  consumer action is needed.
- **New method `getExpandedNodes()`** returns a snapshot of every currently
  expanded node, so a consumer can read the expansion state after a bulk
  change or before persisting it. No consumer action is needed.
- **New method `expandNodeAsync(node)`** expands a node and resolves once
  the expansion has committed, including after an unloaded lazy node's
  `loadChildren` settles — unlike `expandNode`, which starts the same
  expansion with no way to await it. A second call for a node already
  loading joins the first load instead of triggering a second
  `loadChildren`. No consumer action is needed.

## Fixed

### Editor

- **A `CodeEditor` with `autoHeightMaxRows` set could collapse a live
  editor's committed height to `0px` on certain document shrinks**, even
  though the underlying document was intact and correct — for example,
  growing to fit a 4-line document and then shrinking back to the original
  3 lines. A chain of re-entrant CodeMirror geometry-remeasure events
  against an unchanged document shape could each report a slightly smaller
  content height than the last, with nothing stopping repeated events from
  walking the committed height down to zero. This mirrors an already-fixed
  growth-side bug: a genuine document/width change is required to shrink
  the editor again, the same trust rule growth already followed. No
  consumer action is needed.

