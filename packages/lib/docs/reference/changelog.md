# Changelog

Release history for `@jimka/typescript-ui`.

## 0.4.0

### Breaking changes

**Breaking:** `BulletedList` and `NumberedList` paint their own markers instead
of the browser's. Every `NumberedListItemStyle` and `BulletedListItemStyle`
member renders, and nothing warns. No enum member is removed and `getStyle()`
still returns exactly what you set, so code keeps compiling; only the rendered
marker changes. The bullet characters are the framework's own and differ
slightly from what each browser drew. `UPPER_GREEK` now renders uppercase
Greek, which no browser did — it is not a predefined CSS counter style, so it
used to fall back to decimal. `LOWER_ALPHA`/`LOWER_LATIN` and
`UPPER_ALPHA`/`UPPER_LATIN` render identically, as CSS defines them, and roman
numbering falls back to decimal above item 3999.

**Breaking:** every item in a marker list now shares one marker column, as wide
as that list's widest marker, with the marker right-aligned inside it. Markers
share a right edge and labels share a left edge, so an item's label may sit a
few pixels further right than it did when each item sized its own marker slot.

**Breaking:** `AbstractMarkerList` declares a protected abstract
`markerText(index)`. A consumer subclassing it directly must implement that
method, returning the marker string for a given position; `BulletedList` and
`NumberedList` are unaffected.

**Breaking:** `DOMSource` gains a required `startFontLoad(family)` member,
returning whether it started an asynchronous font load. Only a consumer
implementing its own `DOMSource` is affected, and a source that cannot load
fonts asynchronously implements it as `return false` — the framework treats
`false` as "no activation callback will follow" and skips the startup layout
hold described under *Changed*, so returning `true` from a source that never
reports back would delay the first layout by the full 50 ms bound.

**Breaking:** `DOMSource` also gains a required
`measureTextWidths(texts, options?)` member, returning one width per input
string. Again only a consumer implementing its own `DOMSource` is affected; the
straightforward implementation maps the existing single-string measurement over
the array, and the batched form exists so a whole column-width derivation costs
a fixed number of reflows rather than one per string.

**Breaking:** `SplitGutter.destroy()` and `CollapseButton.destroy()` are
removed. Both only unhooked listeners and left the component's per-instance
stylesheet rules on the shared sheet. Call the inherited `dispose()`
instead, which does the listener cleanup *and* the full teardown.

### Changed

- **The first layout pass now waits for the web font to activate.** Text
  measured before the bundled Manrope face activates is measured against the
  browser's fallback font, so the first layout used to commit fallback-derived
  sizes and then move every text box at once when the real face arrived. The
  coalesced layout queue now holds its first flush until the font set reports
  the load settled, so the first geometry committed is already correct. The
  hold is bounded at 50 ms of idle time and is skipped entirely where no
  asynchronous font load started, so a page that loads no web font is
  unaffected. `Tree` and the table body additionally defer their own render
  passes while the hold is in force — both render from several synchronous
  entry points (including element creation) rather than from the layout queue,
  so holding the queue alone would not have covered them. Three consequences are
  worth knowing: `flushLayout()` and `resumeLayout()` lay out synchronously and
  deliberately bypass the hold — except on `Tree` and the
  table body, which check it inside their own render pass, so flushing one
  during startup leaves its rows unrendered until the hold ends rather than
  rendering them at fallback sizes; a programmatic scroll on either — including
  a reveal such as `Table.selectRecord` — is likewise held and applied when the
  hold ends, since the offset would otherwise clamp against a content extent
  the deferred render had not published yet; and
  the post-layout callbacks queued during startup — `Component.afterNextLayout`
  and `Component.onFirstLayout` alike — run after the release rather than on the
  first frame.

- **Table columns derive their starting width from one per-type policy.** The
  table previously ran two disagreeing width models — one seeding the first
  layout, another applied when a column was hidden and shown again — so a
  column could change width the first time it was toggled. Both are replaced by
  `Table.getColumnMinWidth` and `Table.getIntrinsicColumnWidths`, read by the
  table layout and by every site that used to substitute its own fallback. A
  generated table (one built from a schema, with no hand-authored widths) is
  the case this most affects: columns now start at a width derived from their
  type and header rather than an equal share of the viewport.

- **Dragging a column edge now takes width from more than one neighbour.** The
  drag used to be strictly zero-sum between the dragged column and the one
  beside it, and stalled outright once that single neighbour reached its
  minimum. Width is now taken nearest-first along the row: the closest column
  gives up space until it reaches its minimum, then the next one out takes
  over. When nothing is left to take, the table itself widens and scrolls
  horizontally instead of stalling, bounded by the columns' own maximum widths;
  a leftward drag narrows the table back before it regrows any column. The last
  column's right edge is now a working handle that changes the table's width
  only — it did nothing before.

### Added

- **`Favicon`, `DEFAULT_FAVICON` and `BodyOptions.favicon`** — `Body.init`
  installs a built-in mark by default. Pass `favicon: '/brand.svg'` for your
  own, or `favicon: false` to install none. A `<link rel="icon">` already
  present in the page's HTML always wins.

- **Automatic column sizing from content** — `ColumnSpec.autoSizeColumns` opts
  a table into sizing its `string` and `auto` columns from the data as well as
  the header. `boolean`, `glyph`, `date`, `time`, `datetime` and `number`
  columns are sized from their type with or without the flag. At most 50
  records are read, and a whole derivation costs at most three batched text
  measurements regardless of column count — derivations run on first layout,
  store swap, reset, and the single post-load re-derive, never per row and
  never on scroll.

- **`ColumnConfig.width` and `ColumnConfig.maxContentLength`** — an explicit
  starting width for a column, and a cap on how much sampled content counts
  toward an automatic one. An explicit `width` outranks every derived value.
  Read them back with `Column.getWidth()` and `Column.getMaxContentLength()`.

- **`Table.isAutoSizeColumns()`, `Table.getColumnMinWidth(column)` and
  `Table.getIntrinsicColumnWidths()`** — the public seam a custom layout can
  read to size columns the way the built-in table layout does.

- **`Table.getAvailableColumnWidth()` and `Table.getColumnWidthTarget()`** —
  the width the columns have to fill, and the total a resize drag has grown
  them to (`0` when the columns still fit without growth).

- **`TablePanel(store, spec?)`** — an optional column spec, so a panel-hosted
  table can be configured the same way a bare `Table` can. `TablePanel`
  previously accepted no spec at all, leaving its columns unconfigurable.

- **`Util.measureTextWidths(texts, options?)`** — measures many strings in one
  batch, returning one width per input.

- **`VirtualScroller.dispose()`** — disposes the scroller's two overlay
  `Scrollbar`s. `VirtualRowView` calls it on teardown, so an owner of a
  `Table`, `TreeTable` or `Tree` needs no change.

### Added

- **`Canvas` and `WebGLCanvas` hand their draw hook the elapsed animation
  time.** `onDraw` and `onFrame` receive a fourth argument, `elapsedMs`: the
  milliseconds since the current animation run started, or `0` when the
  component is not animating. Frames arrive at the display's refresh rate, so
  advancing a counter once per call runs three times faster on a 180Hz monitor
  than on a 60Hz one; deriving motion from `elapsedMs` instead is refresh-rate
  independent. Existing callbacks are unaffected — the argument is additive and
  ignoring it compiles and behaves exactly as before. Outside the animation loop
  (a resize, a DPR change, an explicit `redraw()`) the value repeats the most
  recent frame's, so a redraw re-renders the same moment rather than jumping.

- **`Canvas` and `WebGLCanvas` accept a `maxFps` cap.** New `maxFps` option plus
  `setMaxFps` / `getMaxFps`, bounding how often the animation loop draws. A
  frame arriving sooner than `1000 / maxFps` after the last draw is skipped; the
  loop keeps running, so the cap trades smoothness for CPU rather than pausing
  anything, and changing it takes effect on the next frame. Pass `0` to opt out
  and draw on every frame the browser delivers.

### Changed

- **An animating `Canvas` or `WebGLCanvas` now redraws at up to 30fps by
  default, rather than on every animation frame.** Previously the loop drew once
  per frame the browser delivered, so an animation's cost scaled with the
  display's refresh rate — the same canvas cost three times as much on a 180Hz
  monitor as on a 60Hz one. The cap makes that cost predictable and independent
  of the display. Motion driven from the new `elapsedMs` argument is unaffected
  and runs at the same speed; motion that advances a fixed amount per draw call
  will run slower than before, and should be converted to `elapsedMs`. Restore
  the old behaviour per instance with `maxFps: 0` (or `setMaxFps(0)`).

### Fixed

- **Animated glyphs no longer cost main-thread work on every frame.** A
  `Glyph`'s root element was an `<svg>`, and browsers will not run a
  `transform` animation on an SVG element on the compositor thread. Every
  animated glyph therefore forced the main thread to rebuild its layer
  assignment once per frame, at a cost that scales with the whole page rather
  than with the glyph — measured at 3.66 ms per frame, about 21% of a CPU core,
  with a 45-column table open elsewhere on screen. An SVG glyph now renders as
  `<span><svg><use/></svg></span>` and the animation class sits on the `<span>`,
  which composites. Consumers that append `glyph.getElement()` directly now
  receive that `<span>` instead of the `<svg>`; nothing in the library read the
  tag. `setAnimated` also no longer sets `will-change: transform` — the hint
  cannot make an animation compositable, and glyphs are numerous enough that
  hinting each one would exceed the count where browsers ignore the hint.
  Two defects in the per-instance duration override fall out of the same fix:
  a duration passed at construction was written as an inline style and wiped
  before first paint, and passing `animationDuration` without `animation` wrote
  an orphan duration onto a glyph that was never animated.

- **Component constructors accept a `subclassDefaults` bag.** Twenty-nine
  constructors passed their own `_defaultXxxOptions` constant straight to
  `super()`, which made them dead ends: nothing below them in the hierarchy
  could seed a class default, and the only route left was editing the parent's
  own constant. Each now takes an optional `subclassDefaults` parameter and
  layers it over that constant, matching what `Component`, `ComboBox` and
  `TextInput` already did. The parameter is optional and spread last, so
  existing construction is unaffected and a subclass default still loses to a
  caller-supplied option. A new `local/require-subclass-defaults` lint rule
  keeps the pattern from regressing.

- **A table header no longer leaks stylesheet rules when it is torn down.**
  Each `HeaderCell` mounts a resize handle, a sort-priority badge and an
  optional header glyph as absolutely-positioned overlays, held in private
  fields and attached directly rather than registered as child components, so
  the recursive teardown never reached them and their per-instance rules
  outlived the cell. The residue scaled with column count — roughly 102 rules
  per open/close cycle of the 45-column demo table — and retained rules are not
  inert, since style-recalc cost grows with the size of the sheet, so each cycle
  made later frames dearer. Measured after the fix, three open/close cycles of
  that table retain nothing at all. Swapping a header glyph also disposes the
  outgoing one, which previously stranded a rule set per change.

- **An animated `Glyph` now pauses while it is off-screen.** A glyph animated
  via `setAnimated` (or the `animation` option) kept running for the lifetime of
  the page even once it was no longer effectively visible — on a hidden tab, in
  a collapsed section, or under any hidden ancestor — consuming a compositor
  frame on every display refresh and holding its `will-change: transform` layer
  hint live. `ProgressSpinner` and `ProgressBar` were unaffected: they register
  their animation through `Component.setAnimation`, which the framework's
  effective-visibility pass already paused. `Glyph` drives its animation from a
  shared `ts-ui-glyph-<kind>` class rule instead, which that pass could not see.
  Glyphs now pause and resume with their effective visibility like every other
  animated component. The cost this removes scales with the display's refresh
  rate and with how much is on the page, so it is most noticeable on
  high-refresh monitors and pages with large component trees.
  reported their single-line shape — an `HFlow` said it needed one row's
  height however many rows its children actually wrapped into — so a parent
  sized the host for one line and the rest was clipped. Each flow now reports
  the cross extent it measured at its last layout, so a parent that honours
  preferred sizes grows the host to fit every line. The main axis is unchanged:
  an `HFlow` still reports the full unwrapped width it would like. The
  cross-axis maximum is floored at the same measurement, so a host that clamps
  to its content cannot clamp the flow back to one line. The cross-axis minimum
  is not floored — it stays one line's worth — but it now measures that line
  with the same `itemAlign` rule the preferred size uses, so the two can no
  longer disagree about how tall a line is. A layout that measures nothing
  usable (a child with no resolved size, or a host with no width yet) publishes
  nothing and the flow keeps reporting its single-line estimate.

- **Wrapped `HFlow` rows no longer overlap under `itemAlign: "baseline"`.**
  A row advanced by its tallest cell, but baseline alignment offsets a cell by
  `rowAscent - baseline`, which can push a low-baseline child's descender below
  that. The next row started underneath it. A baseline-aligned row is now as
  tall as `rowAscent + rowDescent`, so it clears its own descenders. This
  changes rendered output for wrapping flows that set `itemAlign: "baseline"`;
  every other alignment is unaffected, as is `VFlow`, whose baseline arm has
  always degraded to `"start"`.

- **A table, tree table or tree no longer leaks its rows' stylesheet rules on
  teardown.** The virtual row pool appended each pooled row straight onto the
  rows container rather than registering it as a child component, so the
  owner's `destructor()` recursion never reached the rows — and, through them,
  their cells. The shared stylesheet grew by roughly the view's whole cell
  count every time such a view was destroyed, which is what made repeatedly
  opening and closing a window holding a wide table progressively slower.
  Measured on a 45-column table, one open-and-close cycle now retains 104 rules
  where it used to retain 5512.

- **Overlay scrollbars, split/border/accordion gutters, accordion section
  headers and wrappers, a `Rail`'s collapse chevron, and a dock region's
  drop-zone overlay no longer leak their stylesheet rules on teardown.** Each
  is appended straight onto its owner's element rather than registered as a
  child component, so the owner's `destructor()` recursion never reached it
  and its per-instance rule survived on the shared sheet. Each of the owners
  listed here now disposes what it raw-appended.

- **A completed drag no longer leaks its chrome's stylesheet rules.**
  `DragManager` builds a `DragGhost`, a `DragFeedback` and a
  `ReorderIndicator` for every committed gesture and previously only detached
  them at the end, so the shared sheet grew by one rule per drag and never
  shrank — across tab, split and dock drags alike. A ghost returned by a
  caller's `ghostFactory` is still only detached, since that component
  belongs to the caller.

- **`Border.doLayout()` and `Accordion.doLayout()` no longer fail when they
  run before the container has a DOM element.** Both now defer to the next
  pass instead, matching `HBox`, `VBox`, `Grid`, `Split` and `Tab`. An
  `autoScroll` host's synchronous layout pass during its own construction is
  what used to trigger this against a not-yet-rendered child.

- **`VBox`, `HBox`, and the flow layouts no longer let a child's smaller
  maximum win over its explicit larger minimum.** `resolveChildHeight`,
  `resolveChildWidth`, and `clampedPreferredSize` capped to the maximum and
  then floored to the minimum — the reverse of the order every other clamp
  in the framework uses — so a component that set a hard maximum on itself
  (`ComboBox` capping its own height, for instance) could shrink an
  ancestor's reserved cell below the minimum that ancestor explicitly
  demanded, and the next sibling in the column, row, or flow advanced into
  the space the shrunk cell never gave back. All three sites now cap to the
  maximum first and floor to the minimum last, matching
  `clampPreferredToConstraints` and `clampWidth`.

## 0.3.0

### Breaking changes

**Breaking:** `Aria.applyToElement` is removed. Every `Aria` mutator already
writes through the component's attribute channel, so ARIA state reaches the
element without a second flush; no consumer replacement is needed, since no
consumer had a reason to call it directly.

**Breaking:** the optional `elkjs` peer dependency moved from `^0.10.0` to
`^0.12.0`. A consumer of `@jimka/typescript-ui/component/diagram` that stays on
elkjs 0.10.x now fails to install with an `ERESOLVE` peer conflict; bump elkjs
alongside the library. No `layoutOptions` key changed — ELK 0.12 only added
layout options — but laid-out coordinates can shift, so re-check any diagram
whose spacing was tuned by eye.

**Breaking:** `DOMSink.setRuleStyle(rule, key, value)` is replaced by
`setRuleStyles(rule, styles)`, which takes a whole declaration bag so a
component's dirty rule keys reach the sheet in one mutation instead of one
per key. Only a consumer implementing its own `DOMSink` is affected; the
method is not something application code calls.

**Breaking:** `Component._defaultOptions` is now a `Readonly<TOptions>` bag
that is **frozen and shared by every instance of the class**, rather than a
fresh object literal per construction. A subclass that wrote into it after
`super(...)` returned now throws in strict mode, and one that read
`this._defaultOptions.layoutManager` now reads `undefined` — a layout
manager holds per-instance container state, so it moved out of the shared
bag into a private per-instance slot. Passing defaults through the
`subclassDefaults` constructor parameter, the documented mechanism, is
unaffected.

**Breaking:** every rendered element now carries a `ts-ui-component` CSS
class, and the declarations that are identical across all components —
`position: absolute` among them — moved out of each instance's `#uuid` rule
onto a zero-specificity `:where(.ts-ui-component)` rule. Any code that
rewrites an element's whole `class` attribute must re-state that class, or
the element loses its positioning and collapses into document flow.

See [Migration](/reference/migration#upgrading-from-0-2-x-to-0-3-0) for the
full upgrade note.

### Changed

- **A `"selection"` event is no longer emitted for an unchanged selection.**
  `Tree`, the table body, and `Table`'s rotated mode now compare the
  resolved selection against the one already held — by membership for a set,
  by identity for the rotated view's single record — and stay silent when
  nothing moved. A store reload that re-resolves to the same records, or a
  click on an already-selected row, therefore no longer re-fires; a listener
  that was relying on the redundant emit as a general "something happened"
  signal needs a different trigger.

- **A `Border` fixed region is now reserved at its component's own minimum**
  when the consumer pinned a sub-minimum `preferredSize`, instead of at the
  under-sized preferred value the region would then be clip-framed to —
  which is what let a north region's buttons get clipped. The middle row's
  contribution to the container's preferred height is also now the tallest
  of west/center/east rather than a running sum of `Math.max` against
  itself, so a `Border` with side regions no longer over-reports its height.

- **`DOMSource.onFontsReady` now fires on each `loadingdone` batch** rather
  than once on `document.fonts.ready`. `ready` is a snapshot of a font set
  that is still idle at the moment the framework subscribes, so it resolved
  on the next microtask — long before the real face arrived — and text was
  re-measured against the very fallback the callback exists to replace. The
  callback may now be invoked more than once (each reflow is idempotent
  under that) and is never invoked at all on a document that loads no web
  fonts.

- **Style and default-option work moved off the per-instance path.**
  `Component._defaultOptions` resolves once per class instead of allocating
  a fresh bag (and a throwaway layout manager) per construction; a render's
  dirty style-rule keys flush as one sheet mutation instead of one per key;
  `ProductionDOMSink` looks its rules up through a lazily built index rather
  than scanning the sheet; and `Text` reads its bound font size and line
  height from `Util`'s theme-invalidated metrics cache instead of taking a
  `ThemeManager` subscription per instance. A wide table window previously
  paid all four costs per cell.

- **The documentation site is now built with the framework itself** and
  served from the site root in the router's History mode, replacing the
  VitePress site. Content is unchanged; only the URLs lose their `#`.

- `CodeEditor` now scrolls through the framework's eased wheel scroller
  instead of CodeMirror's raw native scroll, so a wheel gesture inside the
  editor glides like every other scrolling surface. `CodeEditor`'s effective
  `overflow` default is `"auto"` rather than the inherited `"hidden"` (the
  editor's own box still never scrolls — CodeMirror's inner viewport does).

- `Component`'s `data-*` map, its `attributes` options bag, the
  `_disabledAttribute` replay, and `Aria`'s DOM writes now share one
  attribute buffer instead of four separate stores. Two narrow behaviour
  changes follow: `getDataAttribute` now also answers for a `data-`-prefixed
  key written through the `attributes` bag or through `setElementAttribute`
  (previously `undefined`), and a post-construction `setElementAttribute` /
  `setDataAttribute` write is no longer undone by a later re-render when the
  same key also appears in the `attributes` bag.

- `DiagramView.revealNode(id)` now lowers the zoom when the named node is too
  large to fit the viewport whole, so a centred node is never clipped. It
  never raises the zoom, so a node that already fits is centred at the
  current zoom exactly as before.

- A de-emphasised edge now recedes to `0.15` opacity instead of `0.4`, so an
  emphasised edge stands out clearly on a dense graph — the previous strength
  was tuned for a filled `ChartLegend` swatch, which reads very differently
  from a 1.5px hairline. There is no option to restore the old strength.

### Added

- **`Table` rotated record view.** `setDisplayMode("rotated")` /
  `getDisplayMode()` and the exported `TableDisplayMode` swap the table from
  one row per record to a psql `\x`-style expanded view: one `field` /
  `value` row per source column, for the record the table has selected. The
  displayed record *is* the selection — `selectRecord` re-targets the view
  and `getSelectedRecord()` keeps answering with the source record, never a
  projection row. The projection is read-only, per-field cell variants come
  from the existing `cellType` / `cellValues` mechanism, and the two columns
  are width-bounded with a blank expanding filler absorbing the rest, so a
  wide record keeps its labels and values grouped on the left. Export always
  covers the source table regardless of mode. See
  [Table](/components/Table#rotated-record-view).

- **`Tab` `"select"` event.** Fires the moment a tab is picked — by a click
  or `setActiveTabIndex` — carrying its index and label, *before* any
  deferred content is built. That is selection **intent**, which is what a
  router should write its URL from, so a deep link lands on the destination
  while the spinner is still up rather than trailing a slow factory;
  `"activate"` remains the completion half, carrying the live content, and
  for a lazy tab's first selection now fires once its factory has run rather
  than being skipped entirely. Neither fires on the silent post-close
  re-selection of a surviving sibling.

- **`Router` History mode.** `RouterOptions.mode` (`"hash"` — the default —
  or `"history"`, typed by the newly exported `RouterMode`) and
  `RouterOptions.base` let the router read and write `location.pathname` via
  `pushState` / `replaceState`, so URLs are ordinary paths. This needs the
  host to serve the app for every path or a deep link 404s. A new
  `getHref(path)` builds the href an `<a>` should carry in whichever mode
  the router is in, so a mode change never needs a second place fixed, and
  `getPath` gained an optional `href` argument as its inverse. See
  [Routing](/concepts/routing#routing-modes).

- **`Router` fragment support.** In History mode `location.hash` is free to
  carry a real fragment alongside the path. A new `getFragment(href?)` reads
  it, `getHref` / `getPath` split and re-append it, `navigate("/a#b")`
  treats a fragment-only change as a real navigation, and every
  `RouteHandler` now receives the fragment as a third argument alongside
  `params` and `path`. Hash mode is unchanged — its `#` is already spent on
  the route, so `getFragment()` there always returns `""`.

- **`DiagramView` viewport navigation.** The view is now an infinite canvas:
  dragging the empty canvas pans freely in any direction with no clamping
  and no scrollbars, the cursor says what a drag will do (`grab` over
  pannable canvas, `pointer` over a node), and a viewport resize keeps
  whatever was centred centred instead of letting the graph drift into a
  corner. New `zoomIn()` / `zoomOut()` step the zoom about the viewport
  centre, `resetView()` returns to the initial view — the graph's centre, or
  the `initialFocusNode` when one is configured — and a built-in
  zoom / fit / reset control cluster is pinned to the bottom-right — hide it
  with `controls: false` or `setControlsVisible(false)` / `isControlsVisible()`
  when driving the view from your own toolbar. A new `"contextmenu"` event
  fires with the node data and the originating `MouseEvent` when a node is
  right-clicked, suppressing the browser's own menu; a right-click on empty
  canvas is left to the browser. The first render centres the graph at the
  configured `zoom` rather than auto-fitting; call `zoomToFit()` from a
  `"layout"` listener for the old behaviour.

- **ELK layout in a Web Worker.** `DiagramViewOptions.elkWorkerFactory` — a
  `() => Worker` the consumer supplies, since bundling a worker is the
  application's job, not the library's — moves the ELK layout pass off the
  main thread, so a large graph no longer freezes the UI while it is being
  placed. The same factory is reachable through the newly exported
  `ElkLayoutEngineOptions`. `ElkLayoutEngine.dispose()` terminates the
  worker it owns, and `DiagramView.dispose()` calls it, so a view torn down
  with a layout still in flight does not strand a live worker — including
  when disposal lands mid-`import()`, before there is an instance to
  terminate. An `ElkLayoutEngine.layout` call outstanding at disposal
  rejects rather than hanging; `DiagramView.whenLaidOut()` still settles. See
  [DiagramView](/components/DiagramView#running-elk-layout-in-a-web-worker).

- **`EDGE_MARKER_EXTENT`.** Exported from
  `@jimka/typescript-ui/component/diagram`: how far, in unscaled graph units,
  the longest end marker reaches back along an edge from where it attaches.
  A consumer that rewrites edge routes needs it to keep whatever it places on
  the route from landing underneath the marker glyph.

- **`DiagramView` busy indicator.** A view now covers itself with a spinner
  overlay while a layout pass is in flight, so a live `setData` — a filter or
  depth control being changed on a large graph — shows progress instead of a
  frozen canvas. It is view-owned with nothing to wire and no opt-out, and it
  stays up until the new graph is on screen rather than until the layout
  result arrives. A view with no committed size shows none, so a consumer's
  own first-load placeholder is never doubled.

- **`ElementAttributes`** (`core`) — the deferred-write buffer backing every
  attribute write, exported alongside `StyleTarget` / `InlineStyle`. A new
  `setAutoCommitAttributes` / `getAutoCommitAttributes` /
  `commitElementAttributes` switch on `Component` batches attribute writes,
  mirroring the existing style-commit switch.

- **`DiagramView.whenLaidOut()`** — resolves once the layout pass currently in
  flight has finished placing nodes; resolves at once when idle, and never
  rejects (a failed or disposed-mid-pass layout still settles it). Lets a
  consumer gate a spinner, or any other "is it ready" state, on placement.

- **`DiagramView.focusNode(id)`** — centres a node in the viewport, retried
  after each layout pass until it succeeds, unlike `revealNode`, which only
  centres when the graph and viewport are both already measured. Also lowers
  the zoom, if needed, until the node's whole box fits the viewport; never
  raises it.

- **`DiagramViewOptions.initialFocusNode`** — the one-shot initial view
  centres this node instead of the graph's bounds. An id naming no node in
  the graph falls back to centring the bounds. The configured `zoom` is
  honoured, except that a focus node too large to fit the viewport lowers it
  until the node fits.

- **`DiagramView.setEdgeEmphasis(ids)` / `getEdgeEmphasis()`** — dims every
  drawn edge outside the given set to a reduced opacity while the named ones
  keep their normal weight, so clicking a node's connection can highlight
  just the edges attached to it. `null` or an empty array clears the
  emphasis; the next `setData` clears it too, since the emphasis is computed
  against the graph it was set on. Forwards to a new `DiagramEdgeLayer`
  method of the same name.

- **`DiagramView.setNodeEmphasis(ids)` / `getNodeEmphasis()`** — dims every
  node component outside the given set to a reduced opacity while the named
  ones keep full strength, mirroring `setEdgeEmphasis` for nodes. `null` or an
  empty array clears the emphasis; the next `setData` clears it too. Emits
  nothing.

- **`DiagramView` `"edgehover"` / `"edgeleave"` events.** Each drawn edge now
  carries an invisible wide hit path (`DiagramEdgeLayer.edgeIdAt` /
  `edgesNear`) that opts itself back into pointer events without making the
  layer as a whole interactive — the root `<svg>` stays `pointer-events:
  none`, so empty canvas still pans and nodes still take their own clicks. An
  edge press pans the canvas just like empty canvas does, and still never
  clears the node selection. Hovering fires
  `"edgehover"` with **every** model edge within a small hit tolerance of the
  pointer (not just the topmost DOM hit), so a bundle of edges that share a
  route — e.g. under `elk.layered.mergeEdges` — reports as a bundle instead
  of an arbitrary single edge; moving off fires `"edgeleave"`.

- **`DiagramNodeData.badge` / `DiagramNodeOptions.badge`** — an optional short
  marker string drawn after the label by the default `DiagramNode` renderer,
  in flow so ELK reserves room for it (e.g. a "+3 neighbours not shown"
  annotation). Construction-time only, with no `setBadge`, mirroring the
  neighbouring `glyph` field; read back with `DiagramNode.getBadge()`. A
  custom `nodeRenderer` receives it like any other field and must draw it
  itself; the default `groupRenderer` ignores it, so a container node never
  shows one.

### Fixed

- **List rows no longer stack on top of each other after a selection
  change.** `AbstractSelectableList` rewrites a row's whole `class`
  attribute from its selected/focused state and omitted the framework's own
  `ts-ui-component` class — harmless until this release moved
  `position: absolute` onto the class-wide rule, after which every row lost
  its positioning the first time the selection moved.

- **Text is no longer measured against the fallback font.** The web-font
  callback resolved on the next microtask — measured roughly half a second
  before the real face arrived — so every `Text` kept a fallback-derived
  preferred size that no later layout could clear, since re-measurement
  gates on the metrics generation. The framework now subscribes to the
  font set's `loadingdone` event, which catches the swap-in itself.

- **Disposing a component with a layout pending no longer aborts the whole
  flush.** `scheduleLayout()` parks a component in a queue that drains on
  the next animation frame, and teardown released the component's DOM
  handles without removing it from that queue; the flush then laid out a
  disposed component, wrote through a released handle, threw, and left every
  component queued behind it unlaid. Teardown now drops the component from
  the queue, matching the sibling visibility queue.

- **Dimmed diagram edges no longer stack where they overlap.** The emphasis
  dimming moved from each dimmed edge onto a group holding all of them, so an
  overlap composites once instead of once per path. Overlapping routes are
  ordinary — a fan-in or fan-out bundle shares its approach to a node — and
  two dimmed hairlines at `0.15` previously resolved to `0.28`, three to
  `0.39`, so a bundle read as emphasised exactly where it was densest. The
  full-strength group is painted second, so an emphasised edge now also draws
  over any dimmed edge it crosses.

- **`DiagramView` no longer paints an unplaced graph.** New node components
  are now built and measured off the component tree and are mounted,
  positioned, and revealed together once ELK has placed them, instead of
  being mounted up front and appearing stacked at the content host's origin
  until the first layout result lands. A `setData` on an already-laid-out
  view keeps the previous graph on screen until the new one is placed, so a
  re-layout never blanks the canvas mid-round-trip. A graph superseded by a
  newer `setData` before its layout lands is now never rendered, so rapid
  changes to a filter or depth control stop paying the render cost of graphs
  the user never sees.

- **Edges now draw when their routes arrive before the layer is mounted.** A
  diagram built inside a dock tab runs its whole ELK layout while the tab is
  still detached, so `DiagramEdgeLayer.setEdges` was handed the routes with no
  element to draw into and the only draw for them was silently lost — the
  diagram rendered its nodes with no edges at all until some later `setEdges`
  happened to find an element (changing a filter or depth control redrew them).
  The layer now defers that draw to its first connected layout.

- **Disposing a component mid-transition no longer logs a stray
  `DOM handle N is not registered` error.** `Component.destructor()` now
  cancels every `Animation.play` transition still running against a handle
  it is about to release, so a deferred write from that transition's
  two-frame entrance dance — or the `transition: null` reset its completion
  performs — never lands on an already-released handle.

- **`DiagramView.resetView()` now returns to the focus node rather than
  always to the graph bounds**, so on a rooted diagram the built-in Reset
  control brings the root back instead of centring a graph the root may sit
  far outside — which is what made Reset look broken after a live `setData`
  re-layout grew the graph around the existing pan.

- **A pan drag no longer clears the diagram's selection.** A press that
  travels past a 4px slop before release is now treated as a drag, so the
  native `click` it still fires (on the nearest common ancestor of press and
  release) is ignored instead of clearing the node selection — this used to
  happen for any pan, including one starting on empty canvas or ending there
  after beginning on a node.

## 0.2.0

### Breaking changes

**Breaking:** `Component.setPreferredSize`, `setMinSize`, and `setMaxSize` now
take a single `Size` object instead of two loose numbers, matching the
`Size`-typed `preferredSize` / `minSize` / `maxSize` options-bag fields and
the existing `setSize(size: Size)`. There is no `(width, height)` overload.

```typescript
// Before
sidebar.setPreferredSize(240, 0);

// After
sidebar.setPreferredSize({ width: 240, height: 0 });
```

**Breaking:** event listeners registered through `Event.addListener`,
`Event.addSubtreeListener`, and `Event.addViewportListener` now consume an
event by **returning** a disposition (`true`, or `{ stop, prevent }`) rather
than calling `stopPropagation()` themselves. A direct `stopPropagation()` call
still halts native propagation but no longer influences the dispatcher's
subtree walk. `async` listeners no longer typecheck, since `Promise<void>` is
not a disposition, and a concise arrow whose expression evaluates to a value —
`on('action', () => store.goToPage(1))`, where `goToPage` returns `this` — no
longer compiles either. Both apply to the semantic `on(...)` shorthands as well
as the `Event.*` registrars. An arrow returning a **boolean** still compiles and
now silently consumes — the one break with no compiler signal. Five public overridable drag handlers changed signature with
it — `AbstractWindow.onMouseUp`, `SplitGutter.onDragStop`, and
`WindowBorder.onDragStop` dropped their event parameter, and those plus
`AbstractWindow.onDrag` and `SplitGutter.onDrag` now return a disposition. An
override written against the old signature still compiles and silently stops
consuming; see the migration note.

**Breaking:** six public listener-forwarding methods narrowed their parameter
from `Function` to `Event.Listener` — `Component.addMouseDownListener` /
`removeMouseDownListener`, `Component.addMouseDownSubtreeListener` /
`removeMouseDownSubtreeListener`, `Button.addPointerDownListener`, and
`WindowHeader.addHeaderDoubleClickListener` — so a handler passed to any of them
is now checked against the listener contract and an `async` or value-returning
one no longer typechecks.

See [Migration](/reference/migration#upgrading-from-0-1-x-to-0-2-0) for the full upgrade note.

### Added

- **`Component.dispose()`** — a public teardown call that detaches a component
  from its parent and recursively tears down its subtree (releasing theme
  subscriptions, style rules, and DOM). Teardown was previously reachable only
  through the protected `destructor()`.
- A subclass can now **clear a preferred size inherited from a class default**
  by declaring `preferredSize: undefined` in its own defaults, so a
  content-sized subclass no longer inherits a fixed box and leaves dead space.

### Fixed

- Animations cancelled on teardown no longer let their fallback timers fire
  after the component is disposed.
- A window's resize borders and the `Popover` arrow now remove their rules from
  the shared stylesheet on teardown, fixing a steadily growing rule count.
- Attributes set on a detached component now replay when it renders, instead of
  being silently dropped.
- A tab reserves its close-button gutter per tab so label justification keeps
  its space, and the close glyph is centred.
- A minimized window's genie animation targets the window's own rail handle.

## 0.1.1

### Added

- **New `@jimka/typescript-ui/router` subpath** — a hash router (`Router`, with
  `RouteParams`, `RouteHandler`, `RouterEvent`, `RouteMatch`, and
  `RouterOptions`) that maps the URL hash to registered `"/data/rows/:sel"`-style
  patterns, picking the most specific match.
- **GFM tables in Markdown** — the `Markdown` viewer renders GFM pipe tables and
  the `MarkdownEditor` edits them WYSIWYG.
- **Markdown heading ids and a link resolver** — the `Markdown` viewer emits
  heading-id slugs and accepts a `linkResolver`; the new `MarkdownLinkResolution`
  and `MarkdownLinkResolver` types are exported from the display barrel.
- **`Body.init`** — a mount idiom that constructs and mounts the body singleton
  in one call: `Body.init({ layoutManager: Fit(), components: [shell] })`.
- **Tab indents in `CodeEditor`** — Tab is bound to indent the current line or
  selection.

### Fixed

- The viewport event dispatcher no longer swallows every event app-wide;
  viewport listeners follow a documented propagation policy.
- The `Accordion` drag-end now consumes correctly, and `AbstractWindow.onMouseUp`
  stays source-compatible.

## 0.1.0

First public release — the initial published surface of `@jimka/typescript-ui`, a
layout-driven, retained-mode web UI framework written in TypeScript (closer to Java
Swing than to React: every component is a rectangle absolutely positioned and sized in
JavaScript by a layout manager in a single `doLayout()` pass; no flexbox, CSS grid, or
document flow). The public API is **subpath-only** — there is no bare
`@jimka/typescript-ui` import; consumers import from `@jimka/typescript-ui/<group>`.
Each subpath ships as its own ESM bundle plus a `.d.ts` declaration barrel under
`dist/lib/`. Licensed under PolyForm Noncommercial 1.0.0.

The capabilities below cover the primary components of each entry point.

### `@jimka/typescript-ui/core`

Framework runtime shared by every component.

- **Component / Container / Panel / Form** — the component base classes; `Panel` adds
  native auto-scroll (`autoScroll`) and a synced overlay-scrollbar style, `Form` bakes a
  semantic `<form>` with submit handling.
- **Binding** (+ `Bindable`, `BindingAccessors`) — two-way synchronisation between a
  `ModelRecord` and a set of UI components, with a `beforerecord` veto.
- **ThemeManager, BaseTheme, ClassicTheme, DarkTheme, ModernTheme** —
  token-based theming; `ModernTheme` is the default, `ClassicTheme` the gradient light
  look, `DarkTheme` the dark variant.
- **Event** — the DOM-event seam (route DOM events through `Event`, never
  `addEventListener`); semantic events flow through `on` / `off` / `emit`.
- **Util** — exact text metrics, self-determined baselines, optical centring.
- **DOM, ProductionDOMSink, ProductionDOMSource** — the testable DOM
  read/write seam (sink/source), with production implementations.
- **StyleTarget, StyleRule, InlineStyle** — styling primitives behind the typed setters.

### `@jimka/typescript-ui/overlay`

Floating UI, docking, and drag-and-drop.

- **Window, TabWindow** — floating, draggable, resizable windows
  with maximize/minimize/snap; `TabWindow`'s interior is itself a tab strip.
- **Dialog** (+ `DialogTitleBar`, `DialogButtons`) — modal dialogs with title bar,
  scrollable content, and preset confirm/ok/cancel/close button rows.
- **Menu** — context / dropdown menu (right-click-rebuild and persistent modes).
- **Popover, Tooltip** — anchored click popover with arrow tail; hover tooltip singleton.
- **Notification, NotificationHistoryButton** — auto-dismissing toasts with a browsable
  history.
- **Drawer** — edge-anchored sliding panel.
- **Rail** — an activity rail that hosts collapsible drawers.
- **Dock** — a dockable multi-panel workspace (tear-out, redock, edge-drop-to-split).

### `@jimka/typescript-ui/layout`

Layout managers — the framework's answer to CSS layout.

- **HBox / VBox** (`BoxLayout`) — single-axis rows/columns with `preferred` and `equal`
  modes, weights, and justification.
- **HFlow / VFlow** (`FlowLayout`) — wrapping flows.
- **Border** — five named regions (north/south/east/west/center).
- **Grid** (`GridConstraints`, `GridTrack`) — a tracked rows-and-columns grid with
  spanning.
- **Split** — resizable panes with draggable gutters, collapsible, size-persisting.
- **Tab** — tabbed panels sharing one region.
- **Card** — one-child-at-a-time card stack.
- **Fit** — stretch a single child to fill.
- **Accordion** (`AccordionConstraints`) — collapsible animated sections, resizable and
  weighted-fill.
- **Absolute / Anchor** (`AnchorConstraints`, `AnchorType`, `FillType`) — absolute and
  anchored positioning.

### `@jimka/typescript-ui/data`

Model / store / proxy data layer.

- **Model** (+ `AbstractModel`), **Field** — typed record schemas (field types,
  defaults, raw-data mapping).
- **ModelRecord** — a single editable record.
- **Store, MemoryStore, AjaxStore** (+ `AbstractStore`) — in-memory and REST-backed
  record collections with sort/filter/pagination and change events.
- **TreeStore** — hierarchical (parent/child) store.
- **Proxy, MemoryProxy, AjaxProxy, WebStorageProxy** (+ `AjaxError`) — the read/write
  backends behind stores.
- **JsonReader, JsonWriter** — JSON payload decode/encode for proxies.

### `@jimka/typescript-ui/validation`

- **FieldDecorator, ValidationRule, FieldValidationResult** — field-level validation
  rules and results.

### `@jimka/typescript-ui/component/input`

Form controls and text.

- **Text, Label, Link** — static text, form label, in-app text link.
- **TextField, TextArea, PasswordField, UsernameField** — text inputs (the latter two
  preset browser-credential autocomplete).
- **Checkbox, RadioButton, Toggle, Slider** — custom-drawn boolean/range controls.
- **ComboBox, AutoCompleteField** — store-bound dropdown select and type-ahead field.
- **NumberSpinner** — numeric input with spin buttons.
- **DateField, TimeField, DateTimeField** — date/time picker fields with their picker
  dropdowns (`DatePickerDropdown`, `TimePickerDropdown`, `DateTimePickerDropdown`,
  `PickerColumn`).
- **FileField** — file chooser and drag-to-drop file zone.
- Abstract bases (`AbstractInput`, `AbstractBooleanInput`, `AbstractPickerField`,
  `TextInput`) for building custom controls.

### `@jimka/typescript-ui/component/button`

- **Button, ToggleButton, SplitButton, MenuButton** — push,
  two-state, split-with-dropdown, menu-opening.

### `@jimka/typescript-ui/component/display`

Read-only display components.

- **Image, Glyph, IconText, IconLabel** — image, Font Awesome icon, and
  icon+text/label composites.
- **Markdown** — renders a Markdown string as a live DOM subtree (uses `marked`).
- **ProgressBar, ProgressSpinner** — determinate/indeterminate progress and a
  busy spinner.
- **Canvas, WebGLCanvas** — 2D and WebGL drawing surfaces.
- **Video, VideoPlayer** — media element and a player with chrome.

### `@jimka/typescript-ui/component/editor`

- **CodeEditor** — syntax-highlighting, one-command-formatting editor wrapping
  CodeMirror 6, with five built-in languages (HTML, JavaScript, JSON, Markdown, SQL) and
  a `registerLanguage` registry.
- **MarkdownEditor** — WYSIWYG rich-text editor (Lexical) whose value is a Markdown
  string, with an optional raw-source mode.

### `@jimka/typescript-ui/component/chart`

- **LineChart, BarChart** — store-bindable SVG charts.
  d3 (`d3-array`, `d3-scale`, `d3-shape`) is bundled into this subpath.

### `@jimka/typescript-ui/component/list`

- **List, MultiSelectList** — custom-rendered single- and multi-selection list boxes
  with keyboard navigation and store binding.
- **BulletedList, NumberedList** — static ordered/unordered lists.

### `@jimka/typescript-ui/component/container`

Composite containers and chrome.

- **FieldSet, LabeledFieldSet, LabeledGrid** — bordered/legended and chrome-less
  baseline-aligned labelled-field forms.
- **TabPanel, AccordionPanel** — self-managing tab and accordion containers.
- **StatusBar** — bottom status strip with message and indicator zones.
- **Spacer** — layout filler.

### `@jimka/typescript-ui/component/menubar`

- **MenuBar, MenuBarButton** — application menu bar.
- **ToolBar, ToolBarSeparator** — a horizontal/vertical toolbar with roving focus.

### `@jimka/typescript-ui/component/table`

Data-bound tables.

- **Table, TablePanel** — an editable data grid (per-column or per-cell editor/renderer
  types) and a store-bound panel with an add/remove/sync toolbar.
- **TreeTable, TreeTablePanel** — tables whose rows form an expandable hierarchy.
- **TableExporter** — export table data.
- Typed **cells** (`BooleanCell`, `NumberCell`, `StringCell`, `DateCell`, `TimeCell`,
  `DateTimeCell`, `GlyphCell`, `ComboCell`, `DynamicCell`, …), **editors**
  (`CellEditor` + Boolean/Number/String/Date/Time/DateTime/Combo, `CellEditorPool`), and
  **renderers** (`CellRenderer` + Number/String/Date/Time/DateTime/Glyph/Combo/Link/Tree)
  for building custom columns.

### `@jimka/typescript-ui/component/tree`

- **Tree** — a virtual-scrolling collapsible node view.
- **TreeNodeRenderer** (`LabelTreeNodeRenderer`, `IconLabelTreeNodeRenderer`) — pluggable
  per-row renderers.

### `@jimka/typescript-ui/component/diagram`

Node-and-edge diagram rendering. **Requires the optional `elkjs` peer dependency** —
`ElkLayoutEngine` lazily `import()`s `elkjs` and it is left external in the library
build, so a consumer using this subpath must install `elkjs` themselves; every other
subpath works without it.

- **DiagramView** — the diagram surface with pan/zoom and pluggable node renderers.

### `@jimka/typescript-ui/glyphs`

The bundled Font Awesome Free icon registry, importable individually or as namespaces:

- **`@jimka/typescript-ui/glyphs/solid`** (~2000 icons), **`/regular`** (~273), and
  **`/brands`** (~587) — each importable as a whole namespace (`glyphs/solid`) or as a
  single glyph (`glyphs/solid/<name>`); **`@jimka/typescript-ui/glyphs`** re-exports all
  three as `solid` / `regular` / `brands` namespaces. Registered names feed the `Glyph`
  display component and any glyph slot (buttons, tree toggles, table cells).

### Packaging notes

- **Optional peer:** `elkjs` (`^0.10.0`) — required only for
  `@jimka/typescript-ui/component/diagram`.
- **Bundled third-party code:** d3 (`d3-array` / `d3-scale` / `d3-shape`) is bundled into
  the chart subpath; the Manrope variable font ships with the package.
- **Externalized runtime dependencies** (declared as regular `dependencies`, so a package
  manager installs them for the consumer): the CodeMirror family (editor), the Lexical
  family (Markdown editor), `marked` (Markdown display), `prettier` and `sql-formatter`
  (code-editor formatting).
