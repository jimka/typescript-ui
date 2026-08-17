# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Added

### Core

- **`Component.setBounds(x, y, width, height)`** writes a rectangle as one
  batched DOM update and returns whether it changed. **`Component.applyBounds`**
  does the same, then recurses into `doLayout()` unless the rectangle was
  unchanged and the component opts into skipping the pass through its
  protected `canSkipUnchangedLayout` gate — default off, so no built-in
  component's behaviour changes on its own. **`Component.invalidateLayout`**
  marks a component's layout stale so the next `applyBounds` cannot skip it;
  new **`Component.isLayoutDirty`** reports whether a layout pass is still
  owed. `LayoutManager.commitBounds` now routes through `applyBounds`, so
  every built-in layout manager picks up the skip for free. See
  [Layout system](/concepts/layout-system#the-write-is-diffed). The internal
  `CellGeometryCache` — `@internal`, so this is not a consumer-facing
  break — is removed; `Table`'s cells are the one component opted into the
  skip today, re-expressing the cache's old behaviour through this shared
  primitive instead of a private, table-only mechanism.
