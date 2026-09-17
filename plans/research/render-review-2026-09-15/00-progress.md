# Render-review progress tracker

One line per slice. Update the status when a report lands. The slice table,
prompts and report format live in `00-briefing.md`.

Reviewers run in throttled batches of five (the user asked for less
parallelism on 2026-09-15; the harness ceiling is 20). Fable's budget ran out
mid-campaign, so every remaining reviewer runs on Opus.

| NN | slice | status |
|---|---|---|
| 01 | core-component-lifecycle | **done** |
| 02 | core-component-styling | **done** |
| 03 | core-dom-seam-events | **done** |
| 04 | core-panel-scrolling | **done** |
| 05 | layout-base-box-flow-grid | **done** |
| 06 | layout-split-border-dockregion | **done** |
| 07 | layout-tab-tabbar | **done** |
| 08 | layout-accordion-table-serialization | **done** |
| 09 | overlay-windows-dialogs | **done** |
| 10 | overlay-dock-drag-rail-drawer | **done** |
| 11 | overlay-popups-layers-animation | **done** |
| 12 | menus-toolbars | **done** |
| 13 | button-glyph-image | **done** |
| 14 | text-and-small-display | **done** |
| 15 | inputs-text-boolean-slider | **done** |
| 16 | inputs-combo-spinner-file | **done** |
| 17 | inputs-pickers-calendar | **done** |
| 18 | lists-trees | **done** |
| 19 | table-core | **done** |
| 20 | table-header-columns-filters | **done** |
| 21 | table-cells-renderers | **done** |
| 22 | table-editors-treetable-export | **done** |
| 23 | editor-code | **done** |
| 24 | editor-markdown | **done** |
| 25 | display-markdown | **done** |
| 26 | charts-canvas-video | **done** |
| 27 | diagram | **done** |
| 28 | focus-navigation-forms-primitives | **done** |

## Batch order

Highest render-performance value first, so an interrupted campaign still has
the slices that matter for the target app.

1. 01, 02, 03, 04, 05 — core and the layout base
2. 06, 07, 10, 13, 23 — the hottest containers and the editor
3. 09, 11, 12, 14, 18 — overlays, menus, text, lists/trees
4. 08, 15, 16, 17, 19 — accordion, inputs, table core
5. 20, 21, 22, 24, 25 — table chrome/cells/editors, markdown
6. 26 — charts/canvas/video

## Correctness bugs found alongside the performance work

These are not render-work findings and should not wait on a performance plan.
Listed here so the synthesis cannot lose them.

| Severity | Bug | Slice | Status |
|---|---|---|---|
| **Data loss** | An open cell editor survives its pool row being rebound by a scroll and then commits the user's text onto whichever record the slot now holds; the edited record is left untouched (probe: `WROTE_TO_WRONG_RECORD: true`). `Body.commitEditsOutsideWindow` guards the column axis only. | 22 | Fixed — `feature/cell-editor-record-binding` |
| Data loss | `AutoCompleteField.querySuggestions` mutates the consumer's shared store per keystroke — destroys the app's own filters, leaves its own installed, reads records on the sync side of an async rebuild. | 16 | Fixed — `feature/autocomplete-store-query` |
| Crash | An auto-sized `Grid` whose laid-out children drop to zero throws `RangeError` from every size report and from `doLayout`; with no `try`/`catch` in `flushLayouts` that aborts the whole frame's layout flush. | 05 | Fixed — `feature/layout-flush-degenerate-inputs` |
| Crash | A childless `ToolBar` crashes on arrow-key navigation. | 12 | Fixed — `feature/focusable-selector-and-roving` |
| Wrong render | An emptied `HBox`/`VBox` reports negative or unbounded preferred sizes, starving siblings to ~0 px. | 05 | Fixed — `feature/layout-flush-degenerate-inputs` |
| Wrong render | A theme change while a `Markdown` is undisplayed measures a `display:none` element and permanently caches height 0. | 25 | Open |
| Wrong render | Two `Markdown` previews sharing a heading name break each other's outline (document-wide `getElementById`). | 25 | Open |
| Wrong render | `Card` keeps a removed child as `_currentVisible`, leaving the container permanently blank. | 05 | Fixed — `feature/layout-flush-degenerate-inputs` |
| Stuck state | `LayerManager`'s z counter is burned by `bringToFront`, so a window crosses the Pinned/Popover bands after ~400 title-bar clicks. | 11 | Open |
| A11y | `FOCUSABLE_SELECTOR`'s `:not([tabindex="-1"])` binds only its last branch, so roved-off elements stay Tab stops and spatial candidates. | 28 | Fixed — `feature/focusable-selector-and-roving` |
| Leak | `Dock` registers a global drop target and never unregisters it, retaining every `Dock` ever built. | 10 | Open |
| Leak | `collapseAll` re-mints a `Glyph` per visible branch row without disposing the replaced one (18 leaked glyphs, 36 rule mutations); `TreeBody` leaks 18 `DragManager` registrations on dispose. | 22 | Open |
| Leak | `Button.clearDescription()` strands the description `Text` (element, rule, theme subscription, measurement entry). | 13 | Open |
| Leak | The picker's year column is retained with all 171 rules while closed; `dispose()` releases 44 of 215. | 17 | Open |
| Leak | `Text.setLineHeight(NaN)` mints a permanent `.Text.lhNaNpx` rule; `codeEditorTheme()` leaks 51 rules per mount. | 16, 23 | Open |
| Battery/CPU | A `WebGLCanvas` whose `getContext()` returns null still runs its rAF loop forever — the normal case in software-rendered WebKitGTK, i.e. the target environment. | 26 | Open |
| Battery/CPU | A canvas reparented under an already-hidden ancestor keeps animating (no edge event fires). | 26 | Open |

## Found during wave-0 implementation (2026-09-16/17)

Not from the slice reviews — these surfaced while implementing the four wave-0
plans, and are out of scope for every plan that exists today.

| Severity | Bug | Found in | Status |
|---|---|---|---|
| A11y | A **closeable** tab strip still exposes one extra Tab stop per `TabCloseButton`. The wave-0 selector fix removed the roved-off stops but not these, because each close button is a real `button` that was never roved. | phase 4 browser sweep | Open |
| A11y | `Dialog`'s Tab trap has no concept of who owns the Tab key, so an editing surface placed first or last in a dialog has Tab taken by the trap's wrap instead of reaching the editor. Interacts with the new `[contenteditable]` selector branch: the surface is now *findable*, which is what makes the stolen Tab visible. | phase 4 browser sweep | Open |
| Doc gap | `CellEditorPool.register`'s `@remarks` reads narrower than the code — `commitActiveCell(null)` commits whichever cell holds the active slot, whatever key it borrowed. | phase 2 audit (advisory) | Open |
| Doc gap | The consumer-facing consequence of the cell-editor fix — a scroll ends an open edit, and focus is not restored — is documented in `TableInternals.md` and the changelog but not in the consumer-facing `docs/components/Table.md`. | phase 2 audit (advisory) | Open |

## Repo hygiene surfaced by wave 0

Neither is a library defect, but both cost real time across the four runs and
will keep doing so until fixed.

| Issue | Detail | Status |
|---|---|---|
| Typecheck rot invisible to the gates | `tsc -p tsconfig.json` reports **28 errors in test files** on master — all `typeof setTimeout` conversion errors in `TextBatchMeasure`, `Dock.*`, `DiagramView`, `AbstractWindow.*`, `Tab.tabModified`. No gate catches them: `npm run typecheck` covers `tsconfig.lib.json` (sources only) and vitest transpiles without typechecking. Every wave-0 worker had to be told these were pre-existing so it would not chase them. | Open |
| An unmeetable bar copied into every plan | `npm run docs:api` emits **14 warnings** on master (`SpatialNavigation`, `MarkdownViewer`, `MarkdownEditor`, `FieldDecorator`), yet three of the four wave-0 plans specified "zero `docs:api` warnings" in `## Verification`. Each run independently rediscovered the bar was unmeetable and recorded it as a deviation. Either fix the 14 or stop writing the zero-warning bar into plans. | Open |
