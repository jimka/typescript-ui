# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

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

