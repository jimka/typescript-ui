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
- **`background-color`, `background-image`, `box-shadow` and the four
  `border-*` longhands now join the hoisted style declarations too.** A
  component whose value matches its class's own default no longer writes a
  per-instance rule for it. The same specificity consequence applies as in
  the note above: a consumer stylesheet targeting a component by class now
  ties with the generated `.ClassName` rule and lands on source order, where
  the framework's `#id` rule previously always won — raise the selector's
  specificity, or target the component's id, if a consumer rule stops
  applying. One further consequence worth naming, because it can change
  appearance rather than merely change who wins an override: a framework
  state rule scoped to a class selector (a `:hover` or `.selected` rule) now
  outranks the resting chrome it previously lost to.
- **`setForegroundColor`, `setOutline`, `setUserSelect`, `setMinSize`,
  `setMaxSize`, `setOverflowX`, and `setOverflowY` now dedupe against the
  class-tier default too, not only the value resolved at render.** These
  properties already skipped a redundant per-instance declaration when their
  *render-time* value matched the class default; calling the setter directly
  with a value that happens to equal that default previously still wrote a
  real, redundant `#id` declaration — it now writes a removal instead, so the
  shared `.ClassName` rule (or the framework rule) supplies the value. No
  consumer action is needed; the rendered result is unchanged.
- **`border-radius` now dedupes against the class-tier default the same way
  `foregroundColor`/`outline`/`userSelect`/`minSize`/`maxSize`/`overflowX`/
  `overflowY` already do, and `visibility` now does too.** `border-radius`
  also moves from an inline style to the same `#id`/`.ClassName` stylesheet
  tier its `border`/`shadow`/`background-image` siblings already use — a
  consumer reading `element.style.borderRadius` directly will no longer find
  it there, and (as with the earlier hoisting notes) a consumer stylesheet
  rule targeting a component by class now ties with the generated
  `.ClassName` rule where the framework's per-instance rule previously
  always won. No other consumer action is needed; nothing changes visually.
- **[`Text`](/api/component/input/classes/Text)'s font/text declarations
  (`font-family`, `text-align`, `font-weight`, and most of the rest of the
  twelve `applyStyle` writes) now join the hoisted style declarations too.**
  A `Text` (or `Link`/`Label`/`Legend`/`SelectableText`) instance with no
  per-instance font override no longer writes eleven of the twelve to its
  own `#id` rule; it shares its concrete class's `.Text`/`.Link`/`.Label`/
  `.Legend`/`.SelectableText` rule instead. As with the note above, a
  consumer stylesheet targeting one of these classes now ties on specificity
  with the generated class rule rather than always losing to the framework's
  per-instance rule.
- **`white-space` and `text-overflow` now dedupe against the shared tier
  too, shrinking the per-instance CSS rule most `Text` instances write.**
  Every `Text` used to write `white-space: nowrap; text-overflow: ellipsis`
  to its own `#id` rule, even though the framework rule and the shared
  `.Text` rule already supply both — a `Text` with no per-instance font
  override no longer gets a `#id` rule inserted for either declaration at
  all. As with the earlier hoisting notes, a
  consumer stylesheet rule that sets `white-space` or `text-overflow` on a
  component by class now ties with the generated class rule (or beats the
  framework rule outright) where the framework's per-instance rule
  previously always won. Raise the selector's specificity, or target the
  component's id, if a consumer rule starts winning where it should not.
- **A stock component now materialises no per-instance CSS rule at all on
  first render.** Previously `border: null` was written unconditionally by
  every component without a border, which forced a rule for it. Nothing
  changes visually; a component that sets anything genuinely per-instance
  still gets its own rule.
- **The class-tier stylesheet is now hierarchy-aware, and rendered elements
  additionally carry every ancestor class's own name — this is a breaking
  change for a consumer stylesheet selector that targets one of those
  ancestor names.** A class's `.ClassName` rule now declares only its own
  deviation from its nearest ancestor's rule, instead of independently
  repeating every declaration that ancestor already shares; this is a pure
  size/dedup win with no rendering consequence on its own. What *is*
  consumer-visible: rendered elements for `Cell` and its built-in subclasses,
  `Text` and its built-in subclasses (`Label`, `Legend`, `Link`,
  `SelectableText`), `TextInput` and its subclasses, `AbstractPickerField`'s
  date/time field subclasses, `List`/`MultiSelectList`, `Window`/`TabWindow`,
  chart components, and the `AnimatedDropdown` family now additionally carry
  every ancestor class's own name (e.g. a `StringCell` element now also
  carries `Cell`). **A consumer stylesheet selector that targets one of
  these ancestor class names (`.Cell { ... }`, `.Text { ... }`) — previously
  matching nothing, since no framework element ever carried a bare
  ancestor's class name — now matches every concrete subclass instance
  too.** Audit any such selector before upgrading; this is a change in what
  a selector matches, not merely a specificity tie like the notes above.

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
- **A [`Button`](/api/component/button/classes/Button) that customises its
  resting background or shadow now shares its pressed treatment with every
  other `Button` of the same class again.** A caller-supplied
  `backgroundColor`, a `flat` button's transparent fill, or a `Dialog` close
  button's cleared shadow now carries that value on an internal
  `:not(.pressed)` rule instead of the button's own `#id` rule, so the
  shared `.ClassName.pressed` rule is no longer outranked while the button
  is pressed. No consumer action is needed.
- **`clearPressedBackgroundColor()`, `clearPressedBackgroundImage()`, and
  `clearPressedShadow()` on `Button` now pin the `.pressed` declaration to
  the button's current resting value** instead of removing the property —
  the same rendered result, reached differently, and needed so the pinned
  value keeps outranking the shared class-tier `.pressed` rule.
- **`ToggleButton`'s `.selected` background, background-image, and box-shadow
  now dedupe across instances of the same class, the same way `Button`'s
  `.pressed` chrome already does** — no consumer action needed, and
  `TabButton` inherits the same behaviour for its own selected fill and now
  also dedupes its own `.selected` border the same way.
- **`Button`, `ToggleButton`, `TabButton`, and `SpinButton` elements now
  additionally carry their ancestor classes** (`Button`, and for `TabButton`
  also `ToggleButton`) — the same consumer-facing selector-matching change
  noted above for `Cell`/`Text`/… applies here too. `TabButton`'s
  pressed-state rule now shares `Button`'s `.pressed` class rule instead of
  carrying its own copy. Nothing changes visually; no consumer action needed
  unless a consumer stylesheet targets `.Button`/`.ToggleButton` expecting to
  match only literal instances of those classes.
- **[`Checkbox`](/api/component/input/classes/Checkbox) and
  [`RadioButton`](/api/component/input/classes/RadioButton)'s internal box/ring
  graphics no longer duplicate their fixed size and cursor on every
  instance's own CSS rule**, and the check-mark/dot glyphs no longer duplicate
  their fixed colour. Each now shares one CSS rule per graphic across every
  `Checkbox`/`RadioButton` in the app for those properties. The check-mark
  and dot glyphs' fixed size now also dedupes the same way, so `_check`/`_dot`
  write no per-instance CSS rule at all. Nothing changes visually; no
  consumer action needed.
- **`Checkbox`'s checked/indeterminate and `RadioButton`'s selected
  background and border now dedupe across instances of the same class, the
  same way `Button`'s `.pressed` chrome already does.** The resting
  (unchecked/unselected) border also no longer duplicates per instance. No
  consumer action needed; nothing changes visually.
- **`Checkbox`'s box graphic (`CheckboxBox`) no longer duplicates its
  border-radius on every instance's own CSS rule**, the same way its fixed
  size, cursor, resting background, and resting border already were
  deduped. Nothing changes visually; no consumer action needed.
- **`ScrollArrowButton`, `Scrollbar`'s thumb, `ResizeHandle`, `ComboBoxCaret`,
  `SelectableListRow`, and `HeaderCell`'s text renderer no longer duplicate
  their fixed styling on every instance's own CSS rule.** Each now shares one
  CSS rule per piece across every instance in the app. Nothing changes
  visually; no consumer action needed.
- **`WindowBorder`'s snap-target glow, `HeaderCell`'s pressed shadow,
  `Scrollbar`'s disabled-arrow colour, and its thumb's hover fill now dedupe
  across instances of the same class, the same way `Button`'s `.pressed`
  chrome already does.** No consumer action needed; nothing changes visually.
- **[`Text`](/api/component/input/classes/Text)'s numeric-pixel
  `setLineHeight`/`centerInHeight` (used by table cell renderers, tree/list
  rows, and other row-height-synced text) now shares one CSS rule across
  every instance that resolves the same pixel value, instead of each
  instance writing its own.** The CSS-variable and theme-revert forms of
  `setLineHeight`/`centerInHeight` now also dedupe against the class-tier
  default the same way other hoisted properties do. No consumer action
  needed; nothing changes visually.
- **[`NumberRenderer`](/api/component/table/classes/NumberRenderer)'s
  value text no longer duplicates its text alignment on every instance's own
  CSS rule.** Its right-aligned value text (the default for a typed `number`
  column) now shares one CSS rule across every instance in the app;
  [`DynamicCell`](/api/component/table/classes/DynamicCell)'s left-aligned
  instances already share `Text`'s own default and are unaffected. Nothing
  changes visually; no consumer action needed.

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
- **Table cells no longer duplicate their resting background and border on
  every instance's own CSS rule.** `Cell` and its built-in subclasses
  (`StringCell`, `NumberCell`, `BooleanCell`, `DateCell`, `TimeCell`,
  `DateTimeCell`, `ComboCell`, `GlyphCell`, `DefaultCell`, `HeaderCell`,
  `DynamicCell`) now share both on their concrete class's own rule, the same
  way the text colour already did. Nothing changes visually; a cell that
  paints its own resting background (`FilterCell`, a grouped row's tint, a
  `ParentHeaderCell` / `GroupSeparatorCell` group colour) keeps its
  per-instance override exactly as before.

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
- **`ComponentOptions.styleGroup`** (with `setStyleGroup`/`getStyleGroup`)
  lets several instances of the same concrete class share one generated
  `.ClassName--<group>` CSS rule instead of each carrying its own — for
  callers who want many identically-configured instances (e.g. fifty
  `Button`s sharing one non-default `backgroundColor`) to share bytes without
  writing a dedicated subclass. The shared rule's content is fixed by
  whichever instance in the group renders first; a later member whose own
  value genuinely differs still writes it to its own rule. Instances with
  different `styleGroup` values, or none, are unaffected.

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

### Table

- **`Table.exportTSV(options?)`** downloads the current store view as a
  tab-separated file, alongside the existing `exportCSV`/`exportJSON`. Same
  `includeHidden`/`filename` options and the same combo/date/time/datetime
  formatting. A new "Export as TSV" entry joins "Export as CSV"/"Export as
  JSON" in the column context menu wherever `setExportMenuEnabled(true)` is
  set, including the rotated-mode menu. `TablePanel`/`TreeTablePanel`
  forward `exportTSV` the same way they already forward `exportCSV`/
  `exportJSON`. No consumer action is needed.

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
