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
- **`Image.render()` is no longer public.** It falls back to `Component`'s
  own `protected render()` now that `Image`'s dead pass-through override —
  which only wrote the `src` attribute, now handled by the new `setSrc`
  typed setter — is deleted. Call `getElement(true)` to force rendering
  instead. See [Migration](/reference/migration) for the full replacement.

### Core

- **`DOMSource` gains one required member: `readClipboardText()`.** Only a
  consumer implementing its own `DOMSource` is affected.
- **`DOMSource` gains one required member: `getSelectionRange()`.** Only a
  consumer implementing its own `DOMSource` is affected.
- **`DOMSource` gains one required member: `getDocumentSelectionText()`.**
  Only a consumer implementing its own `DOMSource` is affected.

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
- **`CodeEditor` gains three options: `tabSize`, `lineNumbers`, and
  `spellcheck`.** `tabSize` controls the live editor's tab-stop width — how
  wide a literal tab renders and how many columns Tab / auto-indent insert
  — by setting CodeMirror's `EditorState.tabSize` and `indentUnit` facets
  together; unset (the default) leaves CodeMirror's own defaults in place.
  `lineNumbers` (default `true`) toggles the line-number gutter.
  `spellcheck` (default `false`) toggles the browser's native spellcheck
  inside the editor — distinct from the existing `lint` diagnostics, which
  come from the language's own parser, not the browser. New `getTabSize()`
  / `setTabSize(size)`, `getLineNumbers()` / `setLineNumbers(show)`, and
  `getSpellcheck()` / `setSpellcheck(spellcheck)` accessors. `tabSize` is
  also distinct from the existing `FormatOptions.indentWidth`, which only
  shapes `format()`'s one-shot reformat output. No consumer action is
  needed.
- **`CodeEditor.format()` now defaults `FormatOptions.indentWidth` from the
  editor's own `tabSize` when the caller omits it and `tabSize` is set.** An
  explicit `indentWidth` always wins, and the default is inert when
  `tabSize` is unset — unchanged from before. This keeps a reformat's indent
  width matching what the live editor already renders without requiring
  every caller to pass `tabSize` into every `format()` call by hand. No
  consumer action is needed.
- **`CodeEditor`'s search panel is now a framework-built floating card**,
  pinned to the editor's upper-right corner and overlaying the document,
  instead of CodeMirror's own panel docking a strip that pushed the
  document down. `Ctrl-F` (`Cmd-F` on macOS) and `Escape` still open and
  close it, and every match still tints while it's open; its nine controls
  (match case, whole word, regular expression, find previous/next, select
  all, close, replace, replace all) are now glyph-only `Button`/
  `ToggleButton` controls with hover tooltips rather than CodeMirror's own
  inline form. No consumer action is needed.
- **`Image` now caches and publishes its natural intrinsic size**, instead of
  reading the DOM element live from every `getPreferredSize()`/`getMinSize()`
  call (which threw before the element rendered). A native `load` handler
  caches the decoded size and publishes it through `setPreferredSize` unless
  the caller already set an explicit `preferredSize`; `getPreferredSize()`
  returns `null` until that happens, and `getMinSize()`'s pre-load default is
  the inherited `{0, 0}` "no minimum", not the previous undocumented `20×20`
  fallback. `Image` also gains `getBaseline()` (the bottom edge of its
  preferred size, so it participates in row baseline alignment like `Glyph`)
  and a typed
  `on(event, fn)` / `off(event, fn)` surface — plus a construction-time
  `listeners` option and the exported `ImageMediaEvent` type — re-emitting
  the native, non-bubbling `load` / `error` events, mirroring `Video`'s
  media-event bridge. No consumer action is needed for the common case; a
  consumer that depended on the live-DOM read or the `20×20` fallback should
  switch to `on('load', ...)`.
- **`Image` gains a typed attribute options surface.** `ImageOptions` adds
  `src`, `alt`, `loading`, `decoding`, `fetchPriority`, `crossOrigin`, and
  `referrerPolicy`, each with a typed getter/setter pair (`getSrc`/`setSrc`,
  `getAlt`/`setAlt`, and so on), mirroring `Video`'s shape. `src` is now
  settable post-construction via `setSrc(url)`, which invalidates the
  cached natural size so the next `load` re-measures instead of reporting
  the previous image's dimensions — an explicit `preferredSize` survives a
  source change. Pass `alt` (an empty string for a purely decorative image)
  for the image's accessible name. No consumer action is needed.
- **`Image` gains an `objectFit` / `objectPosition` / `preserveAspectRatio`
  fit model**, with matching `getObjectFit`/`setObjectFit`,
  `getObjectPosition`/`setObjectPosition`, and
  `getPreserveAspectRatio`/`setPreserveAspectRatio` accessors.
  `objectFit`/`objectPosition` are plain CSS `object-fit`/`object-position`
  pass-throughs — no default effect until set. `preserveAspectRatio`
  (opt-in, off by default) makes `setWidth`/`setHeight` re-derive the other
  axis from the image's natural aspect ratio and republish it as the
  preferred size, since CSS `aspect-ratio` has no effect once this
  framework's always-both-axes-assigned positioning sets both explicitly.
  The `100px`-per-axis auto-min-floor `getMinSize()` previously derived
  from the natural size is also removed: an `Image` with no explicit
  `setMinSize` now reports `{0, 0}` post-load, letting a parent shrink it
  freely, unless `preserveAspectRatio` has derived its own floor. No
  consumer action is needed for the common case; a consumer that relied on
  the implicit up-to-`100px` floor to keep a small image from collapsing
  should call `setMinSize()` explicitly or enable `preserveAspectRatio`.
- **`Image` gains `.loading` / `.broken` visual states, with `isLoading()` /
  `isBroken()` accessors.** `Image` carries `.loading` while a source is
  decoding — from construction, or a `setSrc` call, until `load`/`error`
  fires — and `.broken` instead if the decode fails, each a themed
  background wash (`--ts-ui-image-loading-bg` / `--ts-ui-image-broken-bg`).
  A broken image now publishes a fixed 48x48 placeholder as its preferred
  size (unless an explicit `preferredSize` overrides it) and as its minimum
  size (unless an explicit `setMinSize` overrides it — an explicit
  `preferredSize` alone does not suppress the minimum floor), instead of
  collapsing to nothing behind the browser's unstyled broken-image icon. No
  consumer action is needed.
- **`MarkdownEditor`'s right-click context menu is reorganized**: the
  table-cell menu's row/column **Insert**/**Delete** submenus and its
  **Merge cells** / **Unmerge cell** / **Column width…** / **Align column**
  items now nest under one **Table** submenu; the empty-line menu's
  **Quote** / **Code block** / **Table** / **Image…** items now nest under
  one **Insert** submenu, which also gains **Bulleted list** and
  **Numbered list** items wired to the existing `toggleUnorderedList()` /
  `toggleOrderedList()` commands. The inline-format toggles reorder to
  Bold / Italic / Underline / Strikethrough / Code, and **Inline code** is
  renamed to **Code**. No consumer action is needed — every item still
  calls the same command method it did before.

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
- **`MarkdownEditor` gains `cut()` / `copy()` / `paste()`**, and its
  right-click context menu now leads every context with Cut / Copy / Paste
  (dimmed for Cut/Copy when nothing is selected). Paste targets the caret the
  user actually right-clicked at rather than the word the menu auto-selects
  for its format toggles, and shows a toast when the browser refuses the
  clipboard read.
- **`MarkdownEditor`'s right-click context menu gains Insert link… / Edit
  link… / Remove link**, over a word/selection or a table cell, prompting
  for a URL via a dialog. `toggleLink(url)` now expands a collapsed caret to
  its enclosing word before wrapping it, and `removeLink()` is a new command
  that unwraps the whole enclosing link regardless of how much of it is
  selected.
- **`DateField`, `TimeField`, and `DateTimeField` now also accept a relative
  shorthand entry** — one or more signed `<number><unit>` terms such as
  `+9y`, `-2w3d`, or `1y 6mo`, resolved against the current moment.
  `DateField` accepts `y`/`mo`/`w`/`d`; `TimeField` accepts `h`/`mi`/`s`;
  `DateTimeField` accepts all seven. The typed text is left alone while
  typing and resolves to its formatted absolute value only when the field
  loses focus or Enter is pressed. No consumer action is needed.
- **`CodeEditor` gains `cut()` / `copy()` / `paste()`** and a right-click menu
  leading with Cut / Copy / Paste (dimmed for Cut/Copy when nothing is
  selected; a read-only editor shows only Copy), acting on the primary
  selection only.
- **`SelectableText` gains a `copyMenu` option** (and `setCopyMenu()` /
  `hasCopyMenu()`) offering a right-click Copy menu for text selected inside
  it; `Dialog`'s message body, `Notification`'s toast and detail messages,
  and the `Markdown` viewer all offer it, restoring what `Body.init`'s
  native-context-menu suppression removed.
- **`TextInput` (and every text field built on it — `TextField`, `TextArea`,
  `PasswordField`, `UsernameField`, `NumberSpinner`, `AutoCompleteField`,
  `DateField`, `DateTimeField`, `TimeField`) gains a right-click Cut/Copy/Paste
  menu and public `cut()` / `copy()` / `paste()` methods**, restoring what
  `Body.init`'s native-context-menu suppression removed.
- **`Table`/`TreeTable` cell ranges gain Cut and Paste**, alongside the
  existing Copy — via Ctrl/Cmd+X/V and the cell right-click menu.
  `DateEditor`/`TimeEditor`/`DateTimeEditor` (in-place cell editing) also
  gain a right-click Cut/Copy/Paste menu, matching `StringEditor`/`NumberEditor`,
  which already had one through their composed `TextField`.
- **`CodeEditor` gains `getCursorPosition()` and a `"cursorchange"` event**,
  for building a "Ln 12, Col 5 · Pos 245" status-bar readout.
  `getCursorPosition()` returns the primary caret's `{ line, column, offset }`
  — `line`/`column` 1-based, `offset` a 0-based raw document position, the
  same value `format()` uses internally — reading the document start before
  the editor mounts. `"cursorchange"` fires once per real move to a
  different line, column, or offset, and joins the construction-time
  `listeners` bag alongside `change` / `readonlyedit` / `heightchange`. The
  payload type `CodeEditorCursorPosition` is newly exported from
  `component/editor`. No consumer action is needed.
- **`MarkdownEditor` gains a table-cell right-click "Align column" submenu**
  (Left, Center, Right, None — the four alignments a GFM delimiter row can
  express) and a matching `setTableColumnAlignment(alignment)` command,
  along with the exported `MarkdownTableAlignment` type. Alignment is a
  whole-column property, so choosing one re-aligns every cell of the
  caret's column, header included.
- **New component `MarkdownDocumentPanel`** (`component/editor`), a
  `Container` combining a `MarkdownEditor` with a glyph-only toolbar:
  format toggles (Bold/Italic/Underline/Strikethrough/Code), a Link
  button, Insert and Table dropdowns, Text style/Alignment/Columns
  dropdowns, and an "Edit Markdown source" toggle pinned to the toolbar's
  far right. Delegates `getValue()`/`setValue()`/`markClean()`/the
  `"change"` event to the owned editor, and exposes
  `getEditor()`/`getToolbar()` for anything else. The `MarkdownEditorPanel`
  demo now builds one of these instead of its own hand-rolled toolbar.
- **`MarkdownEditor` gains a `"selectionstate"` event and `getSelectionState()`
  getter** reporting the five inline-format flags, whether there's a
  selection to act on, the enclosing link's URL (if any), table/column-alignment
  context, and block alignment/column count at the current selection. The
  event does not fire for the editor's initial position; seed a listener
  with the getter. No consumer action is needed.
- **`MarkdownDocumentPanel`'s toolbar is now live**: the five format
  buttons are `ToggleButton`s whose pressed state tracks the current
  selection; the Table button is disabled except while the caret is
  inside a table; the Link button is enabled with a text selection or
  while the caret is inside a link; and the Alignment, Columns, and Table
  dropdowns show a checkmark on the current value. No consumer action is
  needed.

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
- The mouse wheel now scrolls `CodeEditor`'s completion list when the
  pointer is over it, instead of scrolling the document behind it; the
  framework's eased wheel scroller no longer claims a wheel over one of
  CodeMirror's own tooltips when that tooltip can scroll itself. No
  consumer action is needed.
- `MarkdownEditor`'s table header cells now read left-aligned when
  unaligned, matching the read-only `Markdown` viewer's own header cells —
  previously they kept the browser's centred `<th>` default. No consumer
  action is needed.
