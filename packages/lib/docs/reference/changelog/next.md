# Next

Notes for the next release, collected here as they land — this page is not
tied to a version number yet. Once this release is tagged, its content moves
onto its own numbered page (see [Changelog](/reference/changelog)) and this
page resets to empty.

## Breaking changes

### Data

- **`AbstractStore.getActiveSorter()` is removed**, in favour of
  `getActiveSorters()`. Use `getActiveSorters()[0]` and read `field` / `dir`
  instead of `property` / `direction`. See
  [Migration](/reference/migration) for the full replacement.

### Components

- **`Slider`'s deprecated `setMinValue` / `getMinValue` / `setMaxValue` /
  `getMaxValue` and the `minValue` / `maxValue` options are removed.** Use
  `setMin` / `getMin` / `setMax` / `getMax` and the `min` / `max` options.
  See [Migration](/reference/migration) for the full replacement.

## Changed

### Components

- **`TextField` is now generic over its options bag**
  (`class TextField<TOptions extends TextFieldOptions = TextFieldOptions>`),
  matching `TextInput`'s own shape. A subclass with its own options
  interface — as `PasswordField`/`UsernameField` now are — can extend
  `TextField<ItsOptions>` without losing type information on `this._options`.
  Existing bare `TextField` references and unparameterised `extends
  TextField` clauses are unaffected.
- **`Form`'s constructor now accepts an optional `subclassDefaults` bag**,
  layered under its own `{ tag: "form" }` default — the same forwarding
  shape every other generic base class already uses. No consumer action is
  needed; existing `new Form(options)` calls are unaffected.
- **`CodeEditor` gains code folding, line wrapping, a search panel, parser-error
  linting, and keyword/snippet completion**, plus the CSS and Python
  languages. Four new options — `lineWrap`, `placeholder`,
  `highlightWhitespace`, and `lint` — join their matching accessors;
  everything else (folding, search, selection ergonomics, and completion)
  installs unconditionally. `LanguageDefinition` gains an optional
  `loadLintSource` field mirroring `loadFormatter`, and `LintSource` and
  `collectSyntaxErrors` (a syntax-only diagnostics source built from a
  grammar's own parse tree) are newly exported from `component/editor`. No
  consumer action is needed.

### Menu

- **`CheckboxMenuRow` and `RadioMenuRow` now share a new `AbstractBooleanMenuRow`
  base.** `action` moves onto the framework's `on` / `off` listener surface;
  the call shapes are unchanged. The unused `CheckboxMenuRowEvent` and
  `RadioMenuRowEvent` type exports are removed in favour of
  `AbstractBooleanMenuRowEvent`. No consumer action is needed.

### Table

- **Tab / Shift+Tab / Enter / Shift+Enter now move an in-progress cell edit
  to a neighboring column or row**, committing the current cell first.
  Previously Tab fell through to the browser's native tab order (usually
  leaving the table entirely) and Enter committed without moving anywhere.
  Navigation clamps at the grid's edges rather than wrapping, matching the
  existing arrow-key behaviour, and skips mutating a read-only or
  boolean-toggle cell it merely passes through. `Cell` gains
  `setNavigateHandler` / `setEditEndHandler` — the callbacks a host grid
  installs to drive this — and a `hasImmediateEditCommit()` hook a custom
  cell can override to opt out of the auto-open-on-navigate step, alongside
  the new `CellNavigateDirection` type. No consumer action is needed.

## Added

### Components

- **`HeadingScrollTracker` / `HeadingScrollHost`**, exported from
  `component/display`. The heading-scroll tracking `MarkdownViewer` and the
  docs site's own `DocsContent` pane each implemented locally — resolving
  the active heading as a pane scrolls, and scrolling to a chosen heading —
  is now one shared class, reached through a structural `HeadingScrollHost`
  interface so it depends on neither class concretely.
- **`CodeEditor` now reports itself dirty** through `Component.isDirty()`
  whenever its document differs from the text at the last clean point, and
  gains `markClean()`, which accepts the current document as that point. An
  edit undone back to the clean text clears the flag on its own. No consumer
  action is needed.
- **`Table` (and `TreeTable`, by inheritance) now reports itself dirty**
  through `Component.isDirty()` whenever its bound store has unsynced
  changes, updating automatically as the store changes and clearing on sync
  or reject. No consumer action is needed; `TablePanel`/`TreeTablePanel`'s
  own Sync/Reject button logic is unchanged.
- **`MarkdownEditor` now reports itself dirty** through `Component.isDirty()`
  whenever its Markdown differs from the value at the last clean point, in
  either editing mode, and gains `markClean()` to accept the current document
  as that point. Switching between the WYSIWYG and source surfaces is not an
  edit. No consumer action is needed.
- **Every `AbstractInput` subclass** — `TextField`, `TextArea`,
  `PasswordField`, `UsernameField`, `PickerInput`, `Checkbox`, `RadioButton`,
  `Toggle`, `ComboBox`, `Slider`, `NumberSpinner`, `FileField`,
  `FileDropZone`, `AutoCompleteField`, `DateField`, `TimeField`,
  `DateTimeField`, `List`, and `MultiSelectList` — **now reports
  `Component.isDirty()`** whenever its committed value differs from the value
  at the last clean point, and gains the inherited `markClean()`, which
  accepts the current value as that point. A composite control (a picker
  field's inner text input, `NumberSpinner`'s inner field, and similar)
  re-baselines together with its host. No consumer action is needed.
- **`TabBar` gains `setEntryGlyph(id, glyph)` / `clearEntryGlyph(id)` /
  `getEntryGlyph(id)`** — a cell's leading icon was previously fixed at
  creation; these swap, remove, or read it on a live cell, mirroring the
  existing `setEntryName` / `getEntryName` pair.
- **`TabBar` gains `setEntryItalic(id, italic)` / `isEntryItalic(id)`**, and
  **`Button` gains `setFontStyle(value)` / `getFontStyle()`** as the
  label-level mechanism they run through — italicising a cell's label
  (the VS Code-style preview-tab treatment) with nothing else about the tab
  changed.

### Data

- **`Binding.commit()` and `Binding.reject()` now also clear each bound
  `AbstractInput`'s presentation-dirty flag**, via a new optional
  `BindingAccessors.markClean` hook that `Binding.bind()` auto-supplies when
  the bound component is an `AbstractInput`. No consumer action is needed.

### Layouts

- **`Tab.setTabName(content, name)`** relabels a live tab's button and
  re-lays out the strip — a tab's label was previously frozen at creation.
- **`Tab`'s `"beforetabclose"` event** fires on the user close path (the ✕,
  the context menu's *Close*, and every bulk-close row) before a tab is torn
  down, and can be vetoed via its `TabCloseController.preventDefault()`. The
  programmatic `closeTab` is not guarded by it.
- **`Tab.setTabGlyph(content, glyph)` / `clearTabGlyph(content)`** swap or
  remove the leading icon of a live tab, mirroring the existing
  `setTabName`. The change writes back to the tab's `glyph` constraint, so
  it survives a tear-off, a re-dock, or a saved-and-restored layout.
- **`Tab.setTabItalic(content, italic)` / `isTabItalic(content)`** italicise
  or restore a live tab's label. Unlike `setTabGlyph`, the flag is
  view-only — it is not written to the tab's `LayoutConstraints`, so it
  does not survive a tear-off, a re-dock, or a saved layout.
- **`Tab`'s `"tabdblclick"` event** fires when a tab button in the strip is
  double-clicked, carrying that tab's content and its zero-based index. It
  does not fire for a double-click on the strip's blank area or fixed
  chrome, nor for a lazy tab whose deferred content has not been built.
- **`HFlow` and `VFlow` now honour a per-child cross-axis `fill` constraint**
  as align-self: a child whose stored `fill` carries the flow's cross axis
  (`FillType.VERTICAL`/`BOTH` in an `HFlow`, `FillType.HORIZONTAL`/`BOTH` in
  a `VFlow`) stretches to its own wrapped line's cross extent — the row
  height or column width — overriding `itemAlign` for that child only. No
  consumer action is needed; a child with no `fill` constraint is unaffected.

### Core

- **`Component.isDirty()`**, with `onDirtyChange()` / `offDirtyChange()`
  listeners and a protected `setDirty()` setter a subclass calls to report
  its own uncommitted edits. Every container automatically folds each
  child's dirty state into its own `isDirty()`, so an ancestor at any depth
  learns about a dirty descendant — a text editor, an input, a form — with
  no code walking down into the tree. No consumer action is needed.

## Fixed

- `TreeRow`, `FieldSet`, `ComboBox`'s collapsed-control label, and the
  `Label` / `IconLabel` / `Glyph` item renderers used by `Tree` and
  `List` / `MultiSelectList` each raw-append a child (a toggle glyph, a
  loading spinner, an icon, a legend, a label, a row's content renderer)
  instead of registering it via `addComponent`, so `dispose()` never reached
  it — a `Tree` row's toggle glyph, for example, leaked on every
  expand/collapse rather than only at teardown. Every such child is now
  disposed when it is discarded (a rebind, a renderer swap) or, failing
  that, on the owning component's own teardown.
- `List` / `MultiSelectList`'s row pool leaked every row (and everything it
  owned) when shrunk by `setItems`, since `AbstractSelectableList.syncRows`
  only detached the surplus rows via `removeComponent` rather than disposing
  them. The cached empty-state placeholder had the same gap when replaced or
  torn down while detached.
- `Tree.setRendererFactory`, `AbstractSelectableList.setRendererFactory`,
  and `ComboBox.setRendererFactory` now dispose the renderer they replace on
  each row, instead of leaving the caller with no reference to release it.

### Core

- **`callable()` no longer wraps a class in a `Proxy`.** On Tauri's Linux
  webview (WebKitGTK/JavaScriptCore), a `Proxy` anywhere above a method in an
  `extends` chain resolved that method's own `super.<name>()` calls to
  `undefined` — V8 (Chrome, Node) never showed this, so it surfaced only in a
  desktop build. The wrapper is now a plain function sharing the class's own
  `.prototype`, so every `extends` link is a real prototype-chain edge. No
  consumer action is needed; `new`, a bare call, `instanceof`, and `extends`
  all still work exactly as documented.
- **`setId` on an already-rendered component now deletes the `#<old-id>`
  rule it replaces instead of leaving it on the shared stylesheet.** A
  `setId` call after first render swapped in a fresh per-instance
  `StyleRule` for the new selector but never disposed the one it replaced,
  leaving a dead rule behind for the life of the page. No consumer action
  is needed.
- **Re-registering an already-registered listener reference through
  `Event.addListener` / `addSubtreeListener` now applies the new call's
  `button` / `stop` / `prevent` options instead of silently keeping the
  first registration's.** No consumer action is needed.
- **`Event.addViewportListener` now ignores a repeat registration of the
  same function reference instead of registering it a second time and
  firing it twice.** No consumer action is needed.
- **A layout-managed child whose minimum size exceeds its maximum is now
  placed at its minimum instead of its maximum.** `LayoutManager.resolveBounds`
  clamped size with an `if`/`else if` ladder, so the maximum branch, once
  taken, skipped the minimum check — the opposite of every other clamp in
  the framework. A component with such a contradictory constraint pair now
  lands where its size already put it, instead of overflowing its own cell.
- **Adjacent components positioned at fractional coordinates no longer paint
  a 1px seam between them.** `setX` / `setY` / `setWidth` / `setHeight`
  rounded their own value independently; a box's rounded width is now
  derived from its rounded origin (`round(origin + extent) - round(origin)`),
  so its far edge always lands on the same pixel as the next box's rounded
  origin. `setSize`, previously unrounded, now rounds the same way. No
  consumer action is needed.

### Menu

- **Activating a `CheckboxMenuRow` or `RadioMenuRow` with Enter now fires its
  `action` listener.** Previously only a mouse click did, so a keyboard user
  could flip the control without the application ever hearing about it. No
  consumer action is needed.
- **A `MenuBar` dropdown's `separator: true` entry now renders through
  `MenuSeparator`,** the same class a context menu already used. No consumer
  action is needed.

### Components

- `Text.setFontStyle` now re-measures the text and re-lays out its parent,
  so a label switched to italics no longer keeps its upright width and
  clip. No consumer action is needed.
- **`PasswordField` and `UsernameField` now extend `TextField` instead of
  duplicating it.** Both classes were near-verbatim copies of `TextField`
  that had drifted from it: neither re-derived its height when `setBorder`
  was called at runtime, and `UsernameField` rendered with the browser's own
  focus outline instead of the framework's inset focus mark, since it
  carried no `TextField` class token. Extending `TextField` directly fixes
  both — `setBorder` on either field now re-derives preferred/min/max
  height, and a focused `UsernameField` shows the same inset focus ring as a
  plain `TextField`. No consumer action is needed.
- A fenced code block in a rendered `Markdown` document no longer leaves a
  strip of empty space below itself when the block shows a horizontal
  scrollbar. `CodeEditor`'s auto-height pass committed an intermediate
  measurement height and, on one path, returned without putting the height
  back; the gap then persisted for the life of the block.
- A fenced code block in a rendered `Markdown` document that queued for its
  `CodeEditor` upgrade while its subtree was hidden no longer gets stuck as
  an un-upgraded placeholder when the subtree is re-shown with no further
  scroll or resize. `onEffectiveVisibilityChange` now also schedules a
  viewport pass on the visible edge, so a queued entry is re-checked at rest
  instead of waiting on an event that may never come.
- **`AbstractCanvasSurface` is now the shared base for `Canvas` and
  `WebGLCanvas`.** The diagram viewer no longer leaks theme listeners for a
  graph discarded by a superseded `setData`, a failed layout, or disposal
  mid-layout, and simplified nodes are no longer clipped at low zoom. No
  consumer action is needed.
- `HBox`'s `itemAlign: "start"` / `"center"` / `"end"`, and both `HBox` and
  `VBox`'s `justify: "center"` / `"end"` / `"between"` / `"around"` and
  per-child anchor/fill cross-axis placement, no longer double-subtract a
  non-zero inset. Each read the row/column's usable extent as the
  container's already-inset-excluded inner size, minus the same insets a
  second time, shrinking the band and leaving an outsized, asymmetric gap on
  the trailing/bottom/right side. Both axes now use the container's inner
  extent directly, matching the `mode: "equal"` code path, which never had
  the bug. No consumer action is needed; a justified, aligned, anchored, or
  filled child in a host with non-zero insets or padding now lands flush
  with the host's true far edge instead of stopping short of it.
- **`Button.setGlyph` / `clearGlyph` now dispose the glyph they replace or
  remove**, instead of leaving it detached but alive. Every repeated swap on
  the same button previously stranded a `Glyph` component holding its
  element and its per-instance stylesheet rule. A caller holding a
  reference from an earlier `getGlyph()` must not reuse it across a
  `setGlyph` / `clearGlyph` call.
