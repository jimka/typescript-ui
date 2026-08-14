# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Changed

### Core

- **Disposing a large, currently-mounted component subtree — a `Table` with
  many rows and columns, for example — is cheaper.** `Component.destructor()`
  now removes its own element before recursing into its children instead of
  after. A still-connected ancestor's removal is the one call in the subtree
  that costs a live style/layout invalidation, and it already detaches the
  whole subtree from the document in one native step; every descendant's own
  removal still runs (nothing is skipped), but now against an
  already-detached node, which is a cheap pointer unlink rather than a
  rendering-affecting operation. Theme cleanup, style-rule disposal, and
  handle release are unaffected. One relative order inverts: a custom
  `LayoutManager.detach()` override now runs after the container's own
  element is removed instead of before, so it can no longer rely on that
  element still being connected. No built-in `LayoutManager` depends on this,
  so no consumer action is needed unless a custom manager's `detach()`
  override reads the container's connected element.
- **The browser's own right-click menu no longer appears in an app that
  mounts with `Body.init`**, including on text inputs — cut / copy / paste /
  spellcheck no longer show there either. `Body.init` now registers a single
  page-wide `contextmenu` suppression by default; every existing
  library-level context menu (`Tree`, `DiagramView`, `TabBar`, a `Split`
  gutter's chevron, a `Table` column header, …) keeps working unchanged. Opt
  back in with `Body.init({ nativeContextMenu: true })`.
  
### Split

- **`SplitGutter.setMovable` is now live at runtime**, instead of taking
  effect only at construction. Toggling it on an already-constructed gutter
  now enables or disables dragging (and its resize cursor) immediately.
- **`Split.setPaneResizeWeight` now accepts `weight: number | undefined`.**
  Passing `undefined` clears a previously-set pin, restoring the pane to
  ratio-based persistence in `getPaneSizes`. Existing callers passing a
  number are unaffected.
- **The gutter context menu's five toggles stay open across a click instead
  of closing on every one** — Lock gutter and the two Fix-pane pins are
  `CheckboxMenuRow` rows, and the collapse pair is `RadioMenuRow`, which
  reads as the single choice it is. Several controls can be flipped in one
  open. No consumer action is needed.

### Table

- **A `DynamicCell` number row (the rotated `\x`-style view, or any column
  using `ColumnConfig.cellType`/`cellValues` for a per-row mixed-type
  column) now renders left-aligned instead of right-aligned.** A
  homogeneous `number`-typed column still right-aligns via `NumberCell` /
  `NumberRenderer`'s default — only the mixed-type `DynamicCell` context
  changes, since there a lone right-aligned number row sat oddly against
  every other row's left-aligned string/date/combo text. No consumer action
  is needed.
- **`Equals` on a `date`/`time`/`datetime` column filter now matches by
  displayed value rather than exact instant** — a `date` column's `Equals`
  covers the whole calendar day, and a `time`/`datetime` column's covers the
  displayed minute (or second, under `showSeconds`). Programmatic
  `store.setFilter(field, { type: 'eq', value })` is unaffected; only the
  header filter row's build step changes.
- **`exportCSV()` / `exportJSON()` write a combo column's label rather than
  its stored code**, matching what the cell and the filter row show. Flag
  this if the export is meant to be re-imported.
- **The header context menu's per-column show/hide toggles now live in a
  "Show/hide columns" submenu**, or a "Show/hide columns" modal dialog once
  a table has more than 20 resolved columns, instead of one row per column
  at the menu's top level. The dialog splits its checkboxes into side-by-side
  columns of up to 15 each. No consumer action is needed.
- **A `number` column's header filter input now refuses non-numeric
  characters as they are typed** instead of accepting them and silently
  applying no filter. No consumer action is needed.
- **The header context menu's Filter toggle and its "Show/hide columns"
  submenu rows are now `CheckboxMenuRow` rows**, so toggling Filter or a
  column no longer closes the menu — several columns can be flipped in one
  open. No consumer action is needed.

### Display

- **Rendered `Markdown` prose can now be selected and copied**, like any
  other read-only text a reader might want to quote. No consumer action is
  needed.

## Added

### Table

- **`CellRenderer.getDisplayText()`** returns the exact text a cell renderer
  currently shows, computed from cached state rather than the DOM — safe to
  call on a renderer that was constructed, fed a value, and never rendered.
  Every built-in renderer overrides it; a consumer-authored `CellRenderer`
  subclass inherits the `""` default until it opts in. No consumer action is
  needed.
- **`Table.getCellText(field, record)`** returns the exact text a cell shows
  for a field on a record — a combo column's label, a formatted
  date/time/datetime, or `String(value)` — the same resolution export and
  the filter row use. Built for a quick search that matches what's on
  screen; see [Row visibility](/components/Table#row-visibility).
- **A `date` / `time` / `datetime` column's header filter now offers
  Contains / Starts with / Ends with**, matching the displayed text rather
  than the raw `Date`. No consumer action is needed.
- **`Table.setQuickSearch(text, fields?)`** hides every row whose displayed
  cell text does not contain `text`, replacing the hand-rolled
  `setRowVisible` + per-record cache pattern the demo app built by hand.
  With no `fields` argument the searched columns default to every resolved
  column whose filter row would offer a Contains operator; composes with
  `setRowVisible` via AND. See
  [Quick search](/components/Table#quick-search).

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
- **New option `expandTrigger`** lets a row's body toggle expansion on a
  plain click (`"click"`) instead of the default double-click
  (`"dblclick"`) — the IDE-sidebar convention. The caret keeps toggling on
  a single click either way, and Ctrl/Cmd-click and an anchored
  Shift-click never toggle. No consumer action is needed.

### Layout

- **`BoxLayout.itemAlign` / `BoxItemAlign`** — cross-axis alignment for
  `HBox`/`VBox` children that set no per-child `anchor`/`fill` align-self:
  `"start"`, `"center"`, `"end"`, `"baseline"` (the default), or `"stretch"`.
  Mirrors `FlowLayout`'s existing `itemAlign`, letting an `HBox` vertically
  centre a shorter control in a taller row (or a `VBox` centre a narrower
  child in a wider column) without every sibling needing its own align-self.
  `stretching` becomes a deprecated shorthand over `itemAlign: "stretch"` /
  `"baseline"`; every existing `stretching` call site keeps working
  unchanged.
- **`SplitOptions.collapseTrigger` / `SplitGutterOptions.collapseTrigger` /
  `CollapseButtonOptions.trigger`** — switches a gutter's collapse chevron
  from the default double-click activation to a single click. Defaults to
  `"dblclick"` everywhere, so no existing call site changes behaviour. No
  consumer action is needed.

### Split

- **A gutter's right-click context menu** — lock the gutter against
  dragging, pin either neighbouring pane's size against container resizes,
  and choose which neighbour the gutter collapses. Rebuilt from live state
  on every open; see [Gutter context menu](/layouts/Split#gutter-context-menu).
  `Border`'s fixed gutters build no menu.
- **`SplitGutter` / `CollapseButton` `"contextmenu"` event**, fired when the
  gutter's chevron is right-clicked, receiving the pointer's viewport
  coordinates. `Split` subscribes to it internally to open the new menu; a
  consumer can also listen directly.

### Menu

- **`MenuItemConfig.closeOnActivate`** lets an item run its `action` without
  closing the menu; paired with `checked`, the item's own checkmark toggles
  automatically on each activation, turning a menu into a multi-select
  control. Defaults to `true` (today's behaviour). No consumer action is
  needed.
- **`MenuRow`**, a new base class letting a `MenuItemConfig` carry
  `row: () => MenuRow` so a menu can host arbitrary component content in
  place of a `MenuItem`. Existing configs are unaffected; `MenuItem` and
  `MenuSeparator` now extend it, with no public-surface change.
- **`CheckboxMenuRow`**, a menu row hosting a real `Checkbox` that toggles
  without closing the menu — the worked example for `MenuRow`, and a
  ready-made way to build a multi-select menu. Its `enabled` option (default
  `true`) dims a disabled row and makes it ignore clicks and Enter.
- **`RadioMenuRow`**, a menu row hosting a real `RadioButton` for a
  single-choice group of rows. Selecting is one-way — a click on an
  already-selected row changes nothing — and the row does not deselect its
  siblings, so the caller owns clearing the rest of the group. Shares
  `CheckboxMenuRow`'s `enabled` option.

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

### Table

**A `date`/`time`/`datetime` auto-sized column could truncate a real value with a trailing ellipsis even though its computed width looked correct.** The per-type width policy's cell-padding allowance was applied to every column type except the content-driven `string`/`auto` branch, and the date/time reference measurement compared only the reference instant's own formatted digits — missing a non-tabular font where some other digit renders wider. Both gaps are closed: the content-driven branch now adds the same cell padding every other branch already did, and the date/time/datetime floor is measured against the widest digit-substituted variant of the reference text. No consumer action is needed.

**The rotated (`\x`-style) view's `field`/`value` columns no longer sit pinned at their maximum width regardless of what the displayed record holds.** Both columns now size from the actual field labels and formatted values on screen — measured the same way each cell's own renderer displays them, including a combo row's label rather than its stored code — and re-derive on every record switch. `field`/`value` still cap at their existing bounds (80–200px / 120–360px); a wide table's leftover space still goes to the trailing filler column. No consumer action is needed.

**A [combo column](/components/Table#combo-columns)'s header filter was unusable — it matched the stored code against text typed for the label, so filtering "Role" for "Developer" found nothing.** The filter row now resolves each declared option's label the same way the cell renders it and matches against that; `Contains` / `Starts with` / `Ends with` / `Equals` / `Not equals` all resolve to the matching stored value(s). A column no longer needs `filterable: false` to work around this. No consumer action is needed.

**A `time` column's header filter silently applied nothing, so every row stayed visible regardless of what was typed.** The operand parse only understood a full `Date`-parseable string, and a bare time like `09:30 AM` isn't one. The parser now also accepts `HH:MM[:SS]` with an optional `AM`/`PM` suffix, anchored to 1970-01-01 the same way the time cell editor normalises its own value. No consumer action is needed.

