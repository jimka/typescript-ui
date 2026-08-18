# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Breaking changes

### Core

`DOMSource` gains one required member: `measureTexts(requests)`, returning
one `TextMetrics` per request measured in a single document reflow. Only a
consumer implementing its own `DOMSource` is affected.

`DOMSink` gains one required member: `writeClipboardText(text)`. Only a
consumer implementing its own `DOMSink` is affected.

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
- **`user-select`, `outline`, `color` and `border` now join the framework's
  hoisted style declarations** (see the `cursor` note in the 0.6.0 changelog
  and the `ts-ui-component` note in 0.3.0): a component whose value for one
  of these is left at the default, or matches its class's own default, no
  longer gets a redundant per-instance CSS rule for it. The visible
  consequence is one of specificity: a consumer stylesheet targeting a
  component by class now *ties* with the generated `.ClassName` rule where
  the framework's per-instance `#id` rule previously always won, so such a
  rule lands or loses on source order rather than being overridden outright.
  Raise the selector's specificity, or target the component's id, if a
  consumer rule stops applying. Every per-instance and class-level override
  set through the framework's own setters behaves exactly as before.
- **[`Text`](/api/component/input/classes/Text)'s font/text declarations
  (`font-family`, `text-align`, `font-weight`, and most of the rest of the
  twelve `applyStyle` writes) now join the hoisted style declarations too.**
  A `Text` (or `Link`/`Label`/`Legend`/`SelectableText`) instance with no
  per-instance font override no longer writes eleven of the twelve to its
  own `#id` rule; it shares its concrete class's `.Text`/`.Link`/`.Label`/
  `.Legend`/`.SelectableText` rule instead (`text-overflow` is the one
  exception — it keeps writing per-instance for now). As with the note
  above, a consumer stylesheet targeting one of these classes now ties on
  specificity with the generated class rule rather than always losing to the
  framework's per-instance rule, for every declaration but that one.
- **A stock component now materialises no per-instance CSS rule at all on
  first render.** Previously `border: null` was written unconditionally by
  every component without a border, which forced a rule for it. Nothing
  changes visually; a component that sets anything genuinely per-instance
  still gets its own rule.

### Components

- **[`Link`](/api/component/input/classes/Link) text is now selectable by
  default** (`userSelect: "text"`), matching what the table's link cell
  renderer already did per-cell — a link's label is content a reader may want
  to select and copy. The pointer cursor is unchanged. Pass
  `userSelect: "none"` to opt an individual link back out.
- **Narrowing a table (a window minimize, a horizontal resize, a split-gutter
  drag) and widening it again no longer destroys and rebuilds the cells that
  left the view.** Each row keeps its own displaced cells and restores them
  once their columns come back, at the cost of holding those cells — and
  their DOM nodes — in memory until they are restored, the column set or its
  configuration changes, or the table is torn down. No consumer action is
  needed.
- **Horizontal scrolling on a wide table now touches only the columns
  entering or leaving the visible window**, instead of re-deriving every
  rendered column's cell assignment on every tick. A resize, a column-set
  change, or a jump larger than the visible window still reconciles the
  whole window as before. No consumer action is needed.

### Table

- **Selecting and copying table cells no longer relies on the browser's
  native text selection.** Click-drag across cells now selects a rectangular
  range — replacing character-level text selection — and Ctrl/Cmd+C, or a
  right-click cell's context-menu **Copy** entry, writes it to the clipboard
  as tab-separated columns and newline-separated rows. A range always copies
  whole cells; selecting or copying a substring of one cell's text is no
  longer possible. The selected range survives scrolling — previously, a
  drag-selection that scrolled while active could silently copy the wrong
  cells — and a copy now formats off-screen rows and columns the same way
  `exportCSV`/`exportJSON` already do. The active range highlights with a new
  themed `--ts-ui-table-cell-range-selected` background. No consumer action
  is needed.

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
- **`ComponentOptions.userSelect`**, giving construction-time parity with the
  existing `setUserSelect` setter — `new Foo({ userSelect: "text" })` now
  works the same way `cursor` already did, and a subclass can seed it as a
  class default. `getUserSelect()` folds that default, so a class-level value
  is visible to consumers and to the render path alike.

### Components

- **[`SelectableText`](/api/component/input/classes/SelectableText)**, a
  [`Text`](/api/component/input/classes/Text) subclass that the reader can
  select and copy, with a matching I-beam cursor. Framework `Text` is
  unselectable by default because most text in a UI is chrome — a button
  label, a menu title — so reach for `SelectableText` when the text is
  content instead: a dialog or notification message, a data cell's value.
  It adds no API of its own; the two values come from its class defaults, so
  a per-instance `setUserSelect("text")` call is no longer needed. The
  library's own dialog and notification messages and the table's
  text-bearing cell renderers now use it.

## Fixed

### Components

- **A construction-time `fontSize`/`lineHeight` option on
  [`Text`](/api/component/input/classes/Text) (and its subclasses) was
  silently ignored in the rendered CSS** — a field-initializer ordering
  quirk reverted the derived CSS rule back to the class default immediately
  after the constructor's cascade set it. `getLineHeight()` still reported
  the caller's value correctly despite the wrong rendered CSS;
  `getFontSize()` was wrong in the same direction as the CSS, so this also
  fixes a case where the measured size silently didn't match the option
  passed to the constructor. Fixes
  `PickerColumn`'s date/time column headers and
  `AbstractCalendarDropdown`'s header cells, both of which construct a
  `Text` with `fontSize: 12` and previously rendered at the theme's base
  size instead.

### Table

**A table display-mode switch (`setDisplayMode`) reconciled and re-rendered the row pool up to seven times when one pass would do.** `Table` pushed the new store, columns, column configs, hidden-column set and row predicates into `Body` through eight separate setter calls, three of which each triggered their own pool-cell reconciliation and render. The switch now goes through one bulk `Body.bindViewState(state)` call that writes every field first and reconciles + renders once, cutting a mode switch to one reconciliation and at most two render passes. No consumer action is needed.
