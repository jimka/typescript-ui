# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Changed

### Core

- **A layout pass that only moves a child — its size unchanged from the
  previous commit — is cheaper.** Every built-in layout manager (`HBox`,
  `VBox`, `Grid`, `Border`, `Absolute`, `Card`, `Split`, `Tab`) commits child
  placement through one shared internal path, which now writes a size-stable
  move as a compositor-only `transform` instead of `left`/`top`, measured
  ~24% cheaper on a live microbenchmark. A component with an active CSS
  transition, or a commit that also changes size, is unaffected — it still
  writes real `left`/`top`/`width`/`height` as before. No consumer action is
  needed.

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
  owed. See
  [Layout system](/concepts/layout-system#the-write-is-diffed). The internal
  `CellGeometryCache` — `@internal`, so this is not a consumer-facing
  break — is removed; `Table`'s cells, which call `applyBounds` directly,
  are the one component opted into the skip today, re-expressing the
  cache's old behaviour through this shared primitive instead of a private,
  table-only mechanism.
