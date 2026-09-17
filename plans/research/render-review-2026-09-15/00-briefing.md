# Render-work review 2026-09-15 — reviewer briefing

This directory holds a whole-library review of `@jimka/typescript-ui`, split into
28 slices, one fresh-context reviewer per slice. Every reviewer reads this file
first, then the governing docs it names, then its slice's source in full, and
writes one report file next to this briefing. The reports are later merged into
implementation plans (via the `plan` skill); nothing in this review changes code.

## The question

For every `Component`, every `LayoutManager`, and every helper they use:

1. **Function vs implementation.** What is this entity for (its doc page, its
   JSDoc, its role in the tree)? Does the implementation do that, and only that?
   Could it be simpler and do the same job? Where does the implementation do
   work its function does not require?
2. **Render work.** What DOM does it write, and when? What does it read, and
   when? Which of that work is unnecessary — repeated with unchanged inputs,
   done for content nobody can see, forced synchronously when it could be
   deferred, or done at all when nothing observable depends on it? **This is
   the primary concern**: the goal is to remove as much unnecessary render work
   as possible, judged by what the user sees and feels.
3. **Redundant, duplicated and dead code.** Two places solving one problem;
   code with no caller; exports with no importer; guards for impossible states;
   caches nothing reads; abstractions with one user that add nothing.

## Target environment — the cost model

Performance is gauged in the slowest environment available: **Tauri on Linux =
WebKitGTK, software-rendered (no GL) under WSLg**, driving the Loom editor app
(a `Dock` of `Tab`s holding CodeMirror editors, a `Split` with a file `Tree` in
an `Accordion`, a `MenuBar`, a `ToolBar`, a `StatusBar`). Chromium numbers do
not transfer for anything paint- or layout-bound. Measured facts to reason
with (all from real WebKitGTK sessions, per animation frame during a
`Split`-gutter drag or a window resize unless noted):

- **Forced synchronous layout is the dominant JS-side cost.** Any geometry or
  style read (`getBoundingClientRect`, `offset*`/`client*`/`scroll*`,
  `getComputedStyle`, scroll setters) after a DOM write in the same task
  flushes style+layout for the whole document. One such read per visible tab
  strip per frame cost ~110 ms/frame in a 2×2 editor grid (fixed 2026-09-15).
- **Any stylesheet-rule mutation forces a full-document restyle**:
  ~195 ms/frame at 21k nodes, even for a same-value write or a rule that
  matches nothing. Inline-style writes and class toggles are cheap *when no
  read follows them*. `StyleRule` writes on a per-frame path are therefore a
  hazard on their own, independent of what they set.
- **Hidden content still costs.** A subtree hidden with `visibility:hidden`
  stays in the render tree and is charged on every ancestor resize
  (~9 ms/frame per hidden CodeMirror editor). `display:none` removes the cost.
  `content-visibility:hidden` only partly removes it. Absolutely positioned
  subtrees that are *displayed* but off-screen are nearly free during ancestor
  resizes.
- **Paint scales with screen area and with blur.** A blurred inset
  `box-shadow` on a viewport-sized element was re-rasterized every frame
  (~21–57 ms/frame depending on lit edges; fixed 2026-09-14 by 12 px edge
  strips). Software Cairo pays for every large repaint; anything that
  repaints a large surface per frame (a background change, a shadow, a large
  transform on a non-composited element, an SVG re-render) is suspect.
- **A visible CodeMirror editor costs ~15–20 ms/frame of its own re-measure**
  on every size change; a 2×2 grid of editors sits at ~107 ms/frame after the
  library-side fixes. Anything the library adds on top of that per visible
  editor per frame is what this review hunts.
- Idle floor of the shell is ~17 ms/frame; an empty project drags at ~52.
- Frame budget at 60 Hz is 16.7 ms. A per-frame cost below ~1 ms is noise
  unless it multiplies by the number of visible components.

The layout pipeline you are reviewing against (see `docs/concepts/*`):
setters call `scheduleLayout()`; a rAF flush runs `doLayout()` top-down from
the dirtiest ancestor; `applyBounds` writes a child's rectangle and recurses
only when it changed (when the child opts in via `canSkipUnchangedLayout`);
managers must **resolve every child, then commit** (no interleaved reads and
writes); geometry is cached in memory and never re-read from the DOM; all
DOM access goes through `core/DOM.ts` (`DOM.sink` writes, `DOM.source`
reads); style writes go through `StyleRule` / `InlineStyle` buffers and flush
at render; construction is JS-only.

## Already fixed — do not re-report, do build on

Recent performance work already merged into `master` (plans in
`plans/implemented/`, entries in `packages/lib/docs/reference/changelog/next.md`):
`undisplay-inactive-tab-pages`, `collapsed-panes-leave-render-tree`,
`scroll-shadow-edge-strips`, `scroll-strip-deferred-resync`,
`scrollstrip-resize-resync-coalescing`, `panel-scroll-metrics-resize-coalescing`,
`virtual-row-view-resize-relayout`, `dragmanager-pointer-coalescing`,
`table-scroll-forced-reflow`, `table-scroll-recycling-cost`,
`tree-row-toggle-rebind-perf`, `text-measurement-batching`,
`stylerule-batched-flush`, `layout-calc-commit-split`, `relayout-loop-fix`,
`will-change-hints`, `passive-scroll-listeners`, `accordion-gutter-drag-coalescing`,
`resize-settle-afternextlayout-uplift`, `render-perf-pass-iii`.
Before proposing to undo a decision one of these plans made, read that plan's
`## Architecture Decisions` and say what evidence has changed.

Also read `plans/research/codebase-health-audit-2026-08-29.md` — its
Priority 2 (duplication) and Priority 3 (dead code) lists overlap this review.
For any item there that touches your slice: check whether it is still open,
and if it is, carry it into your report (cite the audit) rather than
rediscovering it.

Open plans in `plans/` (not implemented) that may touch your slice — do not
contradict them without saying so: `two-phase-baseline-resolution`,
`overlay-scrollbars-non-panel`, `text-tooltip-on-truncate`,
`button-primary-press-filtering-exploration`, `minification-safe-class-names`,
`callable-inline-class`, `table-column-pinning`, `table-cell-alignment-override`.

## Required reading, in order

1. `/home/jika/typescript/typescript-ui/CLAUDE.md`, `ARCHITECTURE.md`,
   `CODE_CONVENTIONS.md` (repo root) and `~/.claude/CODE_CONVENTIONS.md`.
2. `packages/lib/docs/concepts/performance.md`, `layout-system.md`,
   `sizing.md`, `component-lifecycle.md`, `dom-seams.md`.
3. The doc page for every entity in your slice (`packages/lib/docs/components/`,
   `packages/lib/docs/layouts/`) — that page plus the class JSDoc is the
   entity's *stated function*. `packages/lib/llms.txt` gives the one-line
   role of each.
4. Every source file listed for your slice, **in full**. Do not sample. Where a
   slice lists line ranges of a shared file (`Component.ts`), read those ranges
   in full and skim the rest for the seams you call into.
5. The tests for your slice under `packages/lib/tests/` — they tell you which
   behaviour is contractual (keep) and which is incidental (candidate for
   removal). Read test *names* for the whole slice and bodies where a finding
   depends on them.

## Hot paths to trace, in priority order

Trace each of these through your slice's code as a call chain, frame by frame
where it repeats, and account for every DOM write and read on the way:

1. **Continuous resize**: `Split`/`Accordion` gutter drag, `Dock` pane resize,
   window resize, window drag/resize — i.e. `doLayout` from `Body` down, once
   per frame, with mostly unchanged inputs for most of the tree.
2. **Scroll**: native `Panel` scroll, `VirtualScroller` scroll, wheel,
   keyboard-driven reveal, the scroll-shadow and scrollbar updates.
3. **Pointer movement**: `mouseover`/`mouseout` routing, hover states,
   tooltips, drag ghosts, cursor changes — anything that runs per `mousemove`.
4. **Typing / keyboard**: editor and input keystrokes, focus moves, focus
   rings, ARIA updates.
5. **Show / hide / switch**: tab switch, card switch, expand/collapse, menu
   open/close, dialog open/close, `setVisible`/`setDisplayed` cascades.
6. **Construction and first render**: rule materialisation, measurement,
   listeners; and **data refresh** (row/item rebinding).
7. **Theme change** and **teardown**.

## Finding categories

Tag every finding with one or more:

- **A. Forced sync read on a hot path** — a live geometry/style read that lands
  after a write in the same task, per frame or per event. Name the read, the
  write it follows, and the frequency.
- **B. Unchanged-value write** — a DOM write (style, rule, attribute, class,
  text, transform) made when the value is already what is written.
- **C. Stylesheet-rule write on a hot path** — any `StyleRule` / CSS-rule
  mutation reachable per frame or per pointer event.
- **D. Avoidable layout pass** — unconditional `scheduleLayout`/`doLayout`,
  a missing `canSkipUnchangedLayout` opt-in, a setter that relayouts on a no-op,
  a relayout loop, layout work recomputed with unchanged inputs (missing or
  broken cache), work done in `doLayout` that belongs in a setter.
- **E. Work for invisible content** — updates to undisplayed / hidden /
  off-screen / collapsed / inactive content; measurement of hidden content.
- **F. Paint-heavy styling** — blur, large shadows, large repaint surfaces,
  transforms on non-composited large elements, `will-change` misuse, SVG or
  canvas redraws with unchanged input.
- **G. Listener and allocation churn** — listeners added/removed per pass,
  closures or arrays allocated per frame in the layout path, observers left
  running for hidden content.
- **H. Function/implementation mismatch or over-engineering** — code doing
  more than its stated function, configurability nobody uses, speculative
  generality, a simpler design that meets the same contract.
- **I. Duplication** — the same logic in two places (cite both), or a helper
  that already exists and is not used.
- **J. Dead code** — zero callers, zero importers, unreachable branches,
  caches never read, options never honoured. Give the grep you ran and its
  count (search all of `packages/` — lib, docs app, create-app — and tests).

## What counts as evidence

- Every finding cites `file:line` (paths relative to
  `packages/lib/src/typescript/lib/` unless stated), and for hot-path
  findings the **call chain** from the event or the layout pass to the
  write/read, one hop per line.
- Frequency: per frame / per event / per pass / once. Multiply by the number
  of instances a realistic screen has (e.g. one per visible tab strip, one per
  pooled row, one per visible editor).
- Do not trust a JSDoc or a plan note that says something is cached, skipped
  or coalesced — read the code path that would do it and confirm.
- Optional **probe tests** for claims that are cheap to prove offline
  ("this setter schedules a layout when the value is unchanged"; "this path
  writes the same attribute twice per pass"). Put them in a git-ignored probe
  directory and run them against the lib's real vitest setup:

      mkdir -p /home/jika/typescript/typescript-ui/.worktrees/_probes/<slice>
      # write <slice>/*.test.ts there, importing from '~/...' like the lib's tests
      cd /home/jika/typescript/typescript-ui
      PROBE_DIR=.worktrees/_probes/<slice> npx vitest run --config .worktrees/_probes/vitest.probe.config.ts

  The modelled DOM under node records writes; the existing tests under
  `packages/lib/tests/` show the counting helpers available (grep for
  `countWrites`, `DOM.sink`, `recordedWrites`, `writeLog` and the like in
  `tests/helpers/` and `tests/setup/` before inventing one). Quote the probe
  result in the finding. Delete nothing in the main tree; probes stay in
  `.worktrees/_probes/<slice>/`.
- **Do not run the Loom/MiniBrowser harness or open any window.** Real-engine
  measurement is done by the orchestrator after the plans exist.
- **Do not modify any source, test or doc file.** Your only output is your
  report file.

## Report format

Write to `plans/research/render-review-2026-09-15/<NN>-<slice>.md`. Sections,
in this order:

1. `# <NN> <slice> — render-work review` and a **Summary**: 5–10 lines. The
   three to five findings with the largest user-visible payoff, each with its
   estimated per-frame or per-event cost and the hot path it sits on.
2. `## Findings` — one `### F<NN>.<n> <title>` per finding, most impactful
   first. Fields, as a short list: **Category**, **Impact** (HIGH = per frame
   on hot path 1–3 or multiplied by instance count; MEDIUM = per event or per
   pass on a common interaction; LOW = one-off, cold path, or code health
   only), **Where** (file:line list), **Hot path** (the trace), **Evidence**
   (what you read, what a probe showed), **Proposed change** (concrete: which
   method changes how; keep it to the mechanism, the plan skill will design
   the rest), **Risk / blast radius** (who else calls this; which tests pin
   it), **Proof at implement time** (which counter, probe, or harness scenario
   would show the gain — e.g. "ms/frame on the 2×2 editor-grid horizontal
   drag", "rule writes per frame under `count=1`", "a probe asserting zero
   `DOM.source` reads in `doLayout` with unchanged bounds").
3. `## Entity inventory` — a table, one row per class/manager/helper in the
   slice: **Entity** · **Stated function** (one line) · **Owns DOM** (elements,
   rules) · **Per-layout-pass writes/reads** (what and how many) · **Verdict**
   (`fits` / `over-built` / `mismatch` / `dead`) · **Findings**.
4. `## Redundant, duplicated and dead code` — items not already in Findings,
   each with the grep and count.
5. `## Cross-slice notes` — anything you saw that belongs to another slice
   (name it: e.g. "→ 01 core-component-lifecycle: `applyBounds` …"), and any
   seam in `Component`/`LayoutManager`/`DOM` whose contract your slice relies
   on but that does not hold.
6. `## Suggested plan grouping` — how you would group this slice's findings
   into implementation plans (each plan = one coherent change set that can
   be measured on its own), with dependencies between them and on other
   slices, and which findings are too small to plan and should ride along
   with a neighbour.

Style: plain words, one idea per sentence, no rhetorical framing, no filler.
Precision over length; a report with twelve well-evidenced findings beats one
with forty guesses. Say "not verified" when you did not confirm something.

## Slices

| NN | slice | files (relative to `packages/lib/src/typescript/lib/`) |
|---|---|---|
| 01 | core-component-lifecycle | `core/Component.ts` — construction, options and listener wiring (≈731–1000); dispose/destructor/handle tracking (≈1001–1240); element lifecycle: `getElement`, `removeElement`, `release`, clip and content frames, attach nodes, `reparentContent` (≈1284–1690); id, name, data attributes, `setVisible`/`setDisplayed`/effective visibility, dirty (≈1933–2520); size constraints, preferred/min/max, `getInnerSize`/`getContentBounds`/borders/perimeter/baseline, `setSize`/`setBounds`/`applyBounds`/`canSkipUnchangedLayout`/`writeBounds`, width/height/x/y and their clamps (≈3339–4370); scroll offsets, `syncScrollOffsets`, subtree scroll capture, wheel scrolling (≈4372–4990); focus (≈5464–5510); children, layout manager, pause/resume, `doLayout`, `onFirstLayout`, `invalidateLayout`, `scheduleLayout`, `notifyIntrinsicSizeChanged`, `afterNextLayout`, `flushLayout`, `init`, `render` (≈6657–7683). Plus `core/ComponentDefaults.ts`, `core/BorderWidths.ts`, `core/Callable.ts`. Skim the styling half (slice 02) only for seams. |
| 02 | core-component-styling | `core/Component.ts` — the typed style setters (≈2520–3340 and ≈4988–5460), style layers/tiers, `writeStyle`, `resolveStyleValue`, state styles, `flushStyleBag`, `flushStateStyleBag`, value-style states, `applyStyle`, `replayGeometryStyles`, `applyMiscInlineStyles`, materialisation (≈5511–6656); `core/ClassStyleRules.ts`, `core/StyleTarget.ts`, `core/ElementAttributes.ts`, `core/Aria.ts`, `core/Theme.ts`, `core/themes/*`. |
| 03 | core-dom-seam-events | `core/DOM.ts`, `core/Event.ts`, `core/ListenerBag.ts`, `core/PointerDrag.ts`, `core/AutoRepeat.ts`, `core/Util.ts`, `core/Type.ts`, `core/Diagnostics.ts`, `diagnostics/*`, `core/Body.ts`, `core/Favicon.ts`. Focus: which `DOM.source` reads are live geometry, which are cached; what `Event`'s window-level routing costs per `mousemove`; what `Body` does per resize frame. |
| 04 | core-panel-scrolling | `core/Panel.ts`, `component/container/VirtualScroller.ts`, `component/container/Scrollbar.ts`, `core/ScrollShadow.ts`, `core/SmoothScroller.ts`, `component/container/ScrollStrip.ts`, `core/FocusReveal.ts`. |
| 05 | layout-base-box-flow-grid | `layout/LayoutManager.ts`, `LayoutConstraints.ts`, `LayoutSizes.ts`, `BoxLayout.ts`, `HBox.ts`, `VBox.ts`, `FlowLayout.ts`, `HFlow.ts`, `VFlow.ts`, `Fit.ts`, `Absolute.ts`, `Anchor.ts`, `AnchorConstraints.ts`, `Card.ts`, `Grid.ts`, `GridConstraints.ts`, `GridTrack.ts`, `FillType.ts`, `AnchorType.ts`. |
| 06 | layout-split-border-dockregion | `layout/Split.ts`, `layout/Border.ts`, `layout/DockRegion.ts`, `layout/CollapseSupport.ts`, `component/container/SplitGutter.ts`, `component/container/CollapseButton.ts`. |
| 07 | layout-tab-tabbar | `layout/Tab.ts`, `component/container/TabBar.ts`, `component/container/TabPanel.ts`, `component/container/tabCloseTargets.ts`, `component/button/TabButton.ts`, `component/button/TabCloseButton.ts`. |
| 08 | layout-accordion-table-serialization | `layout/Accordion.ts`, `layout/AccordionConstraints.ts`, `component/container/AccordionPanel.ts`, `component/container/AccordionHeader.ts`, `component/container/AccordionIndicator.ts`, `layout/Table.ts`, `layout/LayoutSerialization.ts`, `layout/index.ts`. |
| 09 | overlay-windows-dialogs | `overlay/AbstractWindow.ts`, `overlay/Window.ts`, `overlay/TabWindow.ts`, `overlay/Dialog.ts`, `overlay/windowControls.ts`, `component/container/WindowHeader.ts`, `component/container/WindowBorder.ts`, `component/container/DialogBackdrop.ts`. |
| 10 | overlay-dock-drag-rail-drawer | `overlay/Dock.ts`, `overlay/DragManager.ts`, `overlay/DragGhost.ts`, `overlay/DragFeedback.ts`, `overlay/DropZoneOverlay.ts`, `overlay/ReorderIndicator.ts`, `overlay/Rail.ts`, `overlay/RailHandle.ts`, `overlay/Drawer.ts`. |
| 11 | overlay-popups-layers-animation | `overlay/Popover.ts`, `overlay/Tooltip.ts`, `overlay/Notification.ts`, `overlay/NotificationHistoryButton.ts`, `overlay/PopupPanel.ts`, `overlay/ButtonGroup.ts`, `core/AnimatedDropdown.ts`, `core/LayerManager.ts`, `core/OverlayPosition.ts`, `core/OverlayFade.ts`, `core/Animation.ts`, `component/container/FloatingPanel.ts`. |
| 12 | menus-toolbars | `overlay/Menu.ts`, `component/container/MenuItem.ts`, `MenuRow.ts`, `AbstractBooleanMenuRow.ts`, `CheckboxMenuRow.ts`, `RadioMenuRow.ts`, `MenuSeparator.ts`, `component/menubar/*`, `component/button/MenuButton.ts`, `PopupButton.ts`, `SplitButton.ts`, `component/shared/buildClipboardMenuItems.ts`, `buildSelectionCopyMenuItems.ts`. |
| 13 | button-glyph-image | `component/button/Button.ts`, `component/button/ToggleButton.ts`, `component/display/Glyph.ts`, `component/display/Glyphs.ts`, `component/display/Image.ts`, `component/input/focusRing.ts`, and the structure (not the data) of `glyphs/*/index.ts`. |
| 14 | text-and-small-display | `component/input/Text.ts`, `Label.ts`, `Link.ts`, `SelectableText.ts`, `component/container/Legend.ts`, `component/display/IconLabel.ts`, `IconText.ts`, `Header.ts`, `component/container/Separator.ts`, `Spacer.ts`, `StatusBar.ts`, `component/display/ProgressBar.ts`, `ProgressSpinner.ts`, `PaginationBar.ts`, `SpinnerWrap.ts`. |
| 15 | inputs-text-boolean-slider | `component/input/AbstractInput.ts`, `TextInput.ts`, `TextField.ts`, `PasswordField.ts`, `UsernameField.ts`, `TextArea.ts`, `AbstractBooleanInput.ts`, `Checkbox.ts`, `RadioButton.ts`, `Toggle.ts`, `Slider.ts`, `core/Form.ts`, `core/Binding.ts`, `validation/*`. |
| 16 | inputs-combo-spinner-file | `component/input/ComboBox.ts`, `AutoCompleteField.ts`, `AutoCompleteDropdown.ts`, `NumberSpinner.ts`, `SpinButton.ts`, `FileField.ts`, `FileDropZone.ts`, `PickerInput.ts`, `PickerButton.ts`. |
| 17 | inputs-pickers-calendar | `component/input/AbstractPickerField.ts`, `AbstractCalendarDropdown.ts`, `DateField.ts`, `TimeField.ts`, `DateTimeField.ts`, `DatePickerDropdown.ts`, `TimePickerDropdown.ts`, `DateTimePickerDropdown.ts`, `PickerColumn.ts`, `TimeColumns.ts`, `dateMath.ts`, `data/temporalText.ts`. |
| 18 | lists-trees | `component/list/*`, `component/tree/*`, `component/shared/VirtualRowView.ts`, `component/shared/selectionsEqual.ts`, `component/shared/reduceModifierSelection.ts`. |
| 19 | table-core | `component/table/Table.ts`, `Body.ts`, `Row.ts`, `RowMetrics.ts`, `TablePanel.ts`. |
| 20 | table-header-columns-filters | `component/table/Header.ts`, `Column.ts`, `ColumnConfig.ts`, `ColumnFilter.ts`, `Footer.ts`, `cell/Header.ts`, `cell/ParentHeader.ts`, `cell/ResizeHandle.ts`, `cell/SortPriorityBadge.ts`, `cell/FilterClauseBadge.ts`, `cell/Filter.ts`, `cell/renderer/Filter.ts`. |
| 21 | table-cells-renderers | `component/table/cell/Cell.ts`, `CellText.ts`, `Default.ts`, `String.ts`, `Number.ts`, `Date.ts`, `Time.ts`, `DateTime.ts`, `Boolean.ts`, `Combo.ts`, `Glyph.ts`, `GroupSeparator.ts`, `Dynamic.ts`, `cell/renderer/*` (except `Filter.ts`). |
| 22 | table-editors-treetable-export | `component/table/cell/editor/*`, `component/table/TreeTable.ts`, `TreeTablePanel.ts`, `TreeBody.ts`, `TreeTableSpec.ts`, `TableExporter.ts`. |
| 23 | editor-code | `component/editor/CodeEditor.ts`, `CodeEditorSearchPanel.ts`, `theme.ts`, `editorTheme.ts`, `languages.ts`, `LanguageRegistry.ts`, `syntaxDiagnostics.ts`, `editorNodes.ts`, `formatters/*`. Focus: what the wrapper adds per frame on top of CodeMirror's own measure during resize, scroll and typing. |
| 24 | editor-markdown | `component/editor/MarkdownEditor.ts`, `MarkdownDocumentPanel.ts`, `markdownTransformers.ts`, `markdownBlockTransformer.ts`, `markdownTableTransformer.ts`, `markdownImageTransformer.ts`, `markdownStyleTransformers.ts`, `markdownImageNode.ts`, `markdownBlockNode.ts`. |
| 25 | display-markdown | `component/display/Markdown.ts`, `MarkdownViewer.ts`, `MarkdownMinimap.ts`, `HeadingScrollTracker.ts`, `markdownExtensions.ts`, `markdownTableExtension.ts`, `markdownAttributes.ts`. |
| 26 | charts-canvas-video | `component/chart/*`, `component/display/Canvas.ts`, `WebGLCanvas.ts`, `AbstractCanvasSurface.ts`, `Video.ts`, `VideoPlayer.ts`, `PlaybackEngine.ts`. |
| 27 | diagram | `component/diagram/*`. |
| 28 | focus-navigation-forms-primitives | `core/FocusTraversal.ts`, `core/FocusHistory.ts`, `core/Focusable.ts`, `core/RovingTabIndex.ts`, `core/SpatialNavigation.ts`, `component/container/FieldSet.ts`, `LabeledFieldSet.ts`, `LabeledGrid.ts`, `primitive/*`. |

Out of scope for this review: `data/*` (except `temporalText.ts`), `router/*`,
and the generated glyph data files under `glyphs/*/` — none of them renders.

## Findings from reviewers that finished before you

Confirmed by an earlier slice's reviewer, with probes. Do not re-derive these;
do check whether your slice is affected and say so, and do correct them if
your slice's code shows they are wrong.

- **No built-in layout manager uses `Component.applyBounds`** (slices 01 and
  05, independently). `LayoutManager.commitBounds:567` calls `child.doLayout()`
  unconditionally, and exactly one class in the library
  (`component/table/cell/Cell.ts:256`) overrides `canSkipUnchangedLayout`. So
  the "a child handed the rectangle it already has is not re-laid-out"
  contract in `docs/concepts/layout-system.md` is inert: every resize frame
  re-lays out the whole tree, including the half whose rectangle is identical.
  If your slice contains a manager or a container that commits child bounds,
  say which path it uses; if it contains a component that could safely opt
  into `canSkipUnchangedLayout`, say so.
- **Size hints have no memo anywhere and are re-derived per query** (slices 01
  and 05). One unchanged pass over 53 nodes cost 788 `getMaxSize` + 788
  `getMinSize` + 484 `getPreferredSize` and ~5,400 allocations, growing
  superlinearly with depth; 44% of it is charged to `Component.clampWidth` /
  `clampHeight`, which run two full content-size aggregations per axis per
  commit.
- **`Component.setSize` has no unchanged-value guard** (slice 01), unlike its
  four per-axis siblings, so it writes geometry and calls `scheduleLayout()`
  on a no-op. Any `doLayout` that calls `setSize` on itself is a perpetual
  layout loop (`ProgressSpinner` is one). Check your slice for `setSize` calls
  inside layout paths.
- **`getBorderSize`'s pre-connect estimate is uncached and resolves `var()`
  widths through `getComputedStyle(documentElement)`** (slice 01): 152 such
  reads in one pass over a 4-node detached bordered subtree — a forced-style
  storm on dialog/menu open and first render.
- **Every bounds commit ends with an empty `DOM.sink.apply`** (slice 01), and
  unbatched geometry sites (including `Split`'s live gutter-drag handler) pay
  8 style applies for 4 values, 4 of them unchanged re-writes.
- **Size reports are recomputed, never memoised, and re-entered 4–8 times per
  child per pass** (slice 05): one unchanged pass over a 31-component tree
  cost 267 `getPreferredSize`, 263 `getMinSize`, 263 `getMaxSize`, 288
  `getBaseline` calls and 104 array allocations. `resolveBounds` then discards
  four of those reads whenever the child fills both axes, which is the common
  case. If your slice's components override any size report, note what one
  call costs and whether it recurses.
- **Pan/zoom and similar continuous gestures write through
  `Component.setTransform`, which targets the component's `#id` stylesheet
  rule, not an inline style** (slice 27) — a full-document restyle per raw
  pointer event in the target engine, with no rAF coalescing. Check every
  continuous-motion path in your slice for the same shape.
- **`SpatialNavigation` resolves ~1,500 computed styles per arrow keypress and
  its candidate collection is quadratic** (slice 28); `FOCUSABLE_SELECTOR`'s
  `:not([tabindex="-1"])` binds only its last branch, so roved-off elements
  stay candidates. Relevant to any slice whose components are focusable or
  set `tabindex`.
- **`Component.getContentInsets()` allocates a fresh `Insets` (with a UUID)
  per call** (slice 28) — 282 allocations per pass over a 241-container tree.
  Relevant to any slice that calls it in a layout path.
- **`Button.setGlyph` has no same-name guard** (slice 04), so a caller that
  re-sets the glyph it already has deletes and re-inserts two stylesheet
  rules. `ScrollStrip.layoutArrows:801-802` does exactly that every pass: 108
  DOM ops on an identical pass, 76 of them from `setGlyph`, per visible
  overflowing tab strip per frame. Stylesheet mutation is the most expensive
  write in the target engine. Check every setter in your slice that re-applies
  an unchanged value, and every per-pass caller of one.
- **`InlineStyle.flushDirty` lacks the empty-bag guard its `StyleRule` sibling
  has** (slices 01, 03 and 04, independently), so `applyBounds`'s auto-commit
  re-enable flushes an empty patch even on unchanged bounds: 200 applies, all
  empty, across a 201-component unchanged pass; 29 in one `ScrollStrip` pass.
- **`DOMSource.getViewportSize()` forces a document layout for a value that
  `Math.max` then discards** (slice 03) — `documentElement.clientWidth` is
  always <= `window.innerWidth`. 30 call sites; one `resize` event costs one
  read per registered viewport listener, the later ones landing after earlier
  handlers' writes. If your slice registers a viewport listener, count them.
- **`Event`'s subtree walk climbs to `<html>` for every event of any
  registered type** (slice 03): 20 `getId` + 20 `getParentElement` seam calls
  on a 20-deep chain with zero matches, each ancestor interned with a
  `WeakRef` and a finalizer. `Button` and `SplitGutter` keep pointer/mouse
  over-and-out listeners installed for the app's life. If your slice registers
  a subtree listener for a high-frequency event, say so.
- **The DOM sink filters nothing; `Component`'s typed setters do the filtering**
  (slice 03). A repeated identical `setBackgroundColor` reaches the sink zero
  times. So an unchanged-value write that *does* reach the sink means the
  setter above it is missing its guard — that is the finding to report.
- **A settled overlay `Panel` handed its own unchanged rectangle still runs
  the full live remeasure** (slice 04): 10 identical commits → 20
  `getScrollMetrics`, i.e. 2 forced sync layouts per frame. The
  `panel-scroll-metrics-resize-coalescing` relay never arms because it keys
  only on the panel's own size changing. Any component in your slice that is
  or contains a `Panel` inherits this.
- **`StyleTarget` has no last-written-value filter** (slice 02), so any caller
  that re-writes an identical value onto a materialised rule issues a real
  stylesheet mutation. The worst live instance: `Split.commitPanes` and
  `Border.doLayout` call `Component.setClipPath` per pane/region per layout
  pass, i.e. an identical-value rule mutation per pane per frame of a gutter
  drag. Writes onto an already-materialised rule also fan out to **one
  `setRuleStyles` call per property**, so a two-property state write is two
  full-document restyles. Check every per-frame and per-pointer-event write in
  your slice for both shapes.
- **Guards are inconsistent across `Component`'s typed setters** (slice 02):
  15 guarded, 15 not. If your slice calls an unguarded one on a hot path, that
  is a finding — name the setter.
- **Every component allocates a guarded resting-isolation `StyleRule` at first
  render that is never materialised** (slice 02), because `Component`'s own
  `ownStyleStates` makes `isRestingChromeIsolated()` true for everything; and
  `applyStyle` wipes the inline style `init()` just flushed, replaying each
  property as its own apply (12 style ops per component at first render where
  1 would do). Relevant to any slice reporting construction/first-render cost.
- **Quantified on a Loom-shaped tree** (slice 06): an unchanged whole-tree pass
  through `Split`/`Border` mutates the shared stylesheet **18 times**, and a
  gutter-drag frame **14 times**, every one of them a same-valued write. Two
  causes: `clip-path` re-asserted per pane/region (`Split.ts:2145`,
  `Border.ts:1272/1320/1377/1419`) and `CollapseButton`'s `transform`/`width`
  rewritten three times per gutter per pass (`CollapseButton.ts:219/242`).
  This is currently the campaign's largest single finding. If your slice sits
  inside a `Split` or `Border`, its per-frame cost is charged on top of these.
- **A gutter drag clamped at a pane's minimum still re-lays out both panes'
  subtrees every frame** (slice 06, `Split.ts:1387-1393`) with zero geometry
  change — in the target app that is a full CodeMirror re-measure per visible
  editor for nothing.
- **`SplitGutter` is the only component in a Loom shell registering a subtree
  `mouseover`/`mouseout`** (slice 06), so every mouseover in the document
  walks the target's ancestor chain. Combined with slice 03's `Event` finding.
- **Tab-strip chrome is recomputed wholesale per pass** (slice 07): the arrow
  glyphs are rebuilt (2 `insertRule` + 2 `deleteRule` + 2 `setRuleStyles` + 10
  element creations per frame per pane), `TabBar.stripThickness()` has no memo
  and runs ~10x per pane per frame (20 `stripThickness` / 160
  `buttonCrossExtent` for 2 panes x 8 tabs), `applyTabButtonStyles` rewrites
  every button's insets/writing-mode/text-align per pass, and
  `Button.setTextAlign`'s unconditional `scheduleLayout()` creates N extra
  layout roots that run on the *next* frame. The default `widthMode: "equal"`
  is quadratic in tab count (8 tabs → 192 `computePreferredSize`/pass, 16 →
  640).
- **`Tab.setBarVisible(false)` hides the bar with `visibility:hidden`** (slice
  07), leaving all 9 elements in the render tree to be charged on every
  ancestor resize — the exact hazard the merged `undisplay-inactive-tab-pages`
  work removed elsewhere. Look for the same `setVisible`-instead-of-
  `setDisplayed` shape in your slice.
- **A setter whose `scheduleLayout()` provably never re-runs the work it was
  meant to trigger is a finding** (slice 07 found 13 such `TabBar` setters).
- **`Dock` itself adds zero per-frame work** (slice 10) — no `doLayout`, no
  render, no viewport listener, no geometry read, no rule write. Everything a
  dock pane costs belongs to `Split` and `Tab`. Treat that as settled.
- **Continuous gestures should move a pre-promoted layer with `setTranslate`,
  not `left`/`top`** (slice 10): the drag ghost writes 4 applies per raw
  mousemove, 2 of them unchanged, on an un-composited translucent
  box-shadowed box, while `AbstractWindow`'s header drag already does the
  right thing (`setWillChange("transform")` + `setTranslate`). That contrast
  is the precedent to cite for any continuous-motion finding.
- **The `CodeEditor` wrapper adds essentially nothing per layout pass** (slice
  23): zero `DOM.source` geometry reads and no editor-owned style writes over
  10 identical passes; CodeMirror's own `ResizeObserver` self-throttles to one
  measure per 75 ms. The measured 15-20 ms/frame per visible editor is engine
  layout of CodeMirror's line DOM caused by the box changing size. The only
  lever is decoupling the box CodeMirror observes from the box the framework
  commits during a drag. Treat "the editor wrapper is wasteful per frame" as
  refuted.
- **`codeEditorTheme()` mints 2 fresh `StyleModule`s and 51 CSS rules per
  call** (slice 23) — once per editor and again per theme toggle, never
  released, with the accumulated sheet re-serialized on each new mount (a
  Markdown preview with 15 fenced blocks adds 765 rules). Look for the same
  per-instance-theme shape in your slice.
- **Warning for a pending plan** (slice 23): `plans/overlay-scrollbars-non-panel.md`
  step 5 would add `commitElementStyle()` + `getScrollMetrics()` to
  `CodeEditor.doLayout` — the exact write-then-read shape that cost ~110
  ms/frame in the ScrollStrip case. If your slice touches an open plan that
  would add a per-frame forced read, say so.
- **`Button.setGlyph` costs 37 sink ops per call, including one stylesheet-rule
  insert and one delete, identical whether the name changed or not** (slice
  13). Per-frame/per-event callers found so far: `ScrollStrip.layoutArrows`
  and `VideoPlayer.syncFromState:590-591` (every `timeupdate`, 4+/s during
  playback). `Button.getPreferredSize()` also re-derives live with no memo (4
  entries per button per plain `HBox` pass, 9 per tab-strip pass) and bypasses
  the min/max clamp, so an auto-sized `Button` can report a preferred width
  below its own minimum.
- **Two premises in this briefing were wrong; do not repeat them** (slice 13):
  the `Image.getPreferredSize` "reports raw natural size" bug **is already
  fixed** (commit `0e7b07db`; the override is now dead code), and
  `plans/button-primary-press-filtering-exploration.md` is **stale**,
  superseded by `plans/implemented/primary-button-interaction-filtering.md`.
  If an open plan named in this briefing turns out to be superseded, say so.
- **Positives worth protecting** (slice 13): button press/release costs one
  class toggle, idle hover costs zero sink ops, and a plain `Button` /
  `ToggleButton` materialises zero per-instance stylesheet rules. Record the
  equivalent positives for your slice — a plan must not regress them.
- **`Glyph` names are immutable, so every icon change disposes and rebuilds a
  `Glyph`** (slice 18): one tree expand = 3 shared-stylesheet mutations + 74
  DOM ops; one collapse = 5 + 94. The fix is upstream — a `Glyph.setName()`.
  If your slice swaps an icon in response to state, it pays this.
- **Unguarded `setSelected`/`setFocused` on a list row rewrites the whole
  `class` attribute** (slice 18): one arrow keypress on a 300-item list issues
  600 class-attribute writes, 598 of them same-valued, then a
  `getScrollMetrics()` read in the same task. `Component.setStyleState` is
  guarded and `TreeRow` already uses it — that is the precedent.
- **`AbstractSelectableList` is not virtualised** (slice 18): 300 items = 900
  components, 906 applies per unchanged layout pass (902 empty) and 901
  `left`+`width` writes per resize frame.
- **Renderers must not call `Text.measure()` inline** (slice 18): the two tree
  renderers do, costing 23 separate forced layouts on a force-rebind where the
  framework's batched `measureTexts` gives one; the two list renderers already
  use the correct lazy pattern. Check any renderer in your slice.
- **`Tree`'s gutter-drag path is already clean** (slice 18) — 1 DOM write, 0
  rule ops, 0 forced reads on an unchanged pass. Another positive to protect.
- **`Tooltip.attach` is not idempotent and `Tooltip.hide()` never early-returns**
  (slice 11): identical text costs 4 listener removals + 4 additions + 5 fresh
  closures (which defeat `Event`'s same-reference dedup) + a stray `hide()`;
  every stray hide plays a full fade on a detached element and leaks 2 native
  listeners. 50 labelled `Button`s carry 200 tooltip registrations, 50 of them
  the app's only resting `mousemove`. `Tooltip.show` also measures text one
  line at a time (2-4 forced layouts per hover) instead of using the mandated
  `measureTextWidths` batch.
- **`FloatingPanel.placeNextTo` forces a layout per host pass** (slice 11), and
  `MarkdownViewer.doLayout` calls it twice after `super.doLayout()` — 2 forced
  synchronous layouts per frame per visible Markdown preview.
- **An open `Popover` pays 4 forced document layouts per scroll/resize event
  and writes nothing** when the anchor has not moved (slice 11): uncoalesced
  raw `scroll` listeners, and two repositioning helpers re-reading the same
  anchor rect.
- **Refuted for slice 11, worth knowing:** `LayerManager` writes no DOM and
  reads no geometry; `Animation.play` is CSS-driven with zero per-frame JS and
  inline-only writes; no stylesheet-rule write is reachable on any per-frame
  path in that slice. The `Menu`-hand-rolls-`OverlayPosition` audit item is
  closed.
- **`Text.setText` forces a whole-document layout per call, even for a
  byte-identical string** (slice 14): no same-value guard, and the next layout
  pass issues an off-screen `<span>` probe (`appendChild` + 2
  `getBoundingClientRect`). This is what the target app hand-works-around with
  `setAutoMeasure(false)`. A wrapping `Text` re-measures *inside* the bounds
  commit — two probes per frame, 20 `measureText` over 10 drag frames.
- **`Text.setLineHeight(px)` inserts a permanent shared stylesheet rule per
  distinct pixel value, with no deletes** (slice 14) — an unbounded rule leak,
  and a *changing* line height (`ComboBox.doLayout:922`,
  `CellRenderer.doLayout:120`, the tree/list renderers) is a full-document
  restyle per frame. Check whether your slice drives a changing line height.
- **ORDERING CONSTRAINT for the plan phase** (slice 14): `ProgressSpinner`'s
  overlay mode is a perpetual layout+rAF loop *and is load-bearing* — the
  overlay is raw-appended and in nobody's laid-out set, so it resizes only
  because of that loop. Slice 01's proposed `Component.setSize` unchanged-value
  guard would silently break overlay resizing unless the `ProgressSpinner` fix
  lands first. If your slice depends on a no-op setter still doing work, say
  so explicitly — that is the kind of hidden coupling a plan must not trip on.
- **`Header` runs one west-anchored label through a full `Border` manager**
  (slice 14): every settled pass costs 1 `setRuleStyles` (`clipPath`) + 4
  unchanged geometry applies + 2 empty applies, per `Header`/`WindowHeader` on
  screen. A manager chosen for generality on a single-child container is a
  finding shape worth checking in your slice.
- **`MenuBar` and `ToolBar` add zero per-frame work of their own** (slice 12):
  a settled pass issues no rule writes, no geometry reads and no non-empty
  style writes — only the already-confirmed empty `InlineStyle` flush (4 per
  child per pass, ~28 per resize frame for the target app's chrome). Refuted.
- **Opening a menu is expensive and crosses the read-after-rule-write line**
  (slice 12): one 12-row `Menu.show()` costs 873 sink writes and 57
  stylesheet-rule ops, with 19 text measurements sandwiched between two
  batches of rule writes in the same task — the exact hazard
  `docs/concepts/performance.md:140` names. 24 rows → 1,497 writes / 105 rule
  ops. Any "build a panel then measure it" path in your slice has this shape.
- **Invisible-but-present chrome** (slice 12): every glyph-less `MenuItem`
  builds a permanently-invisible legacy icon `Text` (12 of 51 element
  creations in a 12-row menu, each with a rule), kept in the render tree by
  `visibility:hidden`, for an option with zero callers anywhere.
- **Constructors must not lay out** (slice 12): `new ToolBar()` runs three
  synchronous `doLayout()` calls from its own constructor, against
  `ARCHITECTURE.md`'s render-time-deferral rule. Check your slice's
  constructors.
- Both 2026-08-29 audit items for that slice are **closed** (the
  `RadioMenuRow`/`CheckboxMenuRow` copy was absorbed into
  `AbstractBooleanMenuRow`; `Menu.open()` routes both axes through
  `OverlayPosition`).
- **`Accordion.doLayout` writes 4 identical `border*` declarations to the
  shared stylesheet on every pass** (slice 08), including every gutter-drag
  frame: `applyContainerTheming()` is called unconditionally and
  `Component.setBorder` has no unchanged-value guard. Its shrink/fill pipeline
  also runs in full every resizable pass and its output is provably discarded
  (stubbing it leaves every rectangle byte-identical), and a **closed** section
  still gets a full `getPreferredSize` + `doLayout` per frame while clipped to
  zero height — `Accordion` never received the `collapsed-panes-leave-render-tree`
  treatment `Split`/`Border`/`Tab` got.
- **CORRECTIONS to earlier entries in this list** (slice 08, probe-backed):
  1. `layout/Table` **is** a built-in manager that uses `Component.applyBounds`
     (`layout/Table.ts:389`, `:405`) — the "no built-in manager uses it" claim
     from slices 01 and 05 is too strong; `layout/Table` is a second precedent
     alongside `component/table/*`.
  2. `Accordion.layoutSections` **already implements** the no-op-drag-frame
     skip that slice 06 proposes for `Split` (3 over-travel frames → 0
     `doLayout` calls). The fix should be ported Accordion → Split, not
     invented.
  If your slice contradicts something in this list, say so plainly and show
  the probe — corrections are as valuable as findings.
- **Cross-slice blocker** (slice 08): `Accordion` installs 2 subtree
  `mouseover`/`mouseout` listeners **per section**, so fixing `SplitGutter`'s
  subtree listeners alone will not remove `Event`'s per-mousemove ancestor
  walk. Any fix for that walk must cover every registrant — list yours.
- **The unchanged-geometry skip works where it is used, and the bigger lever
  next to it is `clampsToContentSize()`** (slice 19). In `component/table/*`
  the skip gives zero `Cell.doLayout` on unchanged passes and non-sliding
  horizontal scrolls. Two things make it pay, both transferable: the host
  caches the rectangles it hands down, and `Cell.clampsToContentSize()`
  returns `false`, which drives `getMinSize`/`getMaxSize` to **zero calls
  across 90 `applyBounds`** — a direct and bigger lever on the clamp cost
  slices 01/05 found than the skip itself. Correction: there are **7**
  `applyBounds` sites, not eight, and `layout/Table.ts:389` (a `Button`) gets
  no skip at all. Honest limit: `applyBounds` on a settled cell still costs
  one wasted DOM patch plus four guarded setters.
- **The empty-patch bug is worst in the table** (slice 19): a settled
  14-column table issues 200 DOM patches per layout pass, 199 empty, 180 of
  them the trailing auto-commit flush of the very `applyBounds` calls that
  just correctly decided to skip — per drag frame, per scroll tick, per
  keypress.
- **Warning for a pending plan** (slice 19): `plans/table-column-pinning.md`
  has stale line references, proposes a `Body.setSelectedRecords` that already
  exists, and would double every per-frame cost in that slice.
  `plans/table-cell-alignment-override.md` is Markdown-dialect work and does
  not touch the table runtime.
- **`Markdown.measureContentHeight` is a per-frame collapse/measure/restore
  probe** (slice 25): `height:auto` → read `scrollHeight` → `height:Npx` on
  every assigned-width change, i.e. every frame of a horizontal drag — 7 style
  applies (4 empty) + 1 forced `getScrollMetrics` + 2 document-layout
  invalidations per frame, plus a `parent.scheduleLayout()` that adds a second
  pass next frame. Any "collapse it to measure it" path in your slice has this
  shape.
- **`lexMarkdown` is quadratic** (slice 25): both block tokenizer extensions
  `split("\n")` the whole remaining source at every block-token position —
  408.70 ms vs marked's own 3.98 ms at 3,200 blocks (103x), run synchronously
  inside `setMarkdown`.
- **One un-pooled `CodeEditor` per fenced block, rebuilt from scratch on every
  `setMarkdown`** (slice 25), and nothing releases `codeEditorTheme()`'s 51
  rules — so that cost recurs per preview toggle, not once per document
  (~3,060 leaked rules for ten toggles of a six-fence README).
- **Measuring an undisplayed element poisons a cache** (slice 25): a theme
  change while a `Markdown` is undisplayed measures a `display:none` element
  and permanently writes a zero height that never recovers. Any cache written
  from a measurement in your slice must be checked for this.
- **The continuous-motion precedent, verified and corrected** (slice 09):
  `AbstractWindow`'s header drag does lazy `setWillChange` on first motion, a
  guarded inline `setTranslate`, no rule write and no layout — 1 apply/frame.
  Correction to slice 10: that move path is **not** rAF-coalesced, so it still
  pays one `getViewportSize()` forced layout per raw mousemove, unlike the
  resize and snap paths in the same class. Copy the layer/translate half of
  the pattern, and add the coalescing the original lacks.
- **Laying out detached is expensive because of the uncached border estimate**
  (slice 09, compounding slice 01's finding): `AbstractWindow.show()` runs the
  whole first `doLayout()` before mounting — 516 `getComputedStyle(documentElement)`
  calls on a bare window vs 0 attached. `Dialog.open()` mounts first and pays
  3. If your slice builds and lays out before attaching, measure it.
- **Clip frames write four separate unchanged applies** (slice 09):
  `StyleTarget.setMany` loops `set()`, so one clip frame's `left/top/width/height`
  is four applies, and a settled zero-change window pass costs 43 applies (27
  empty) + 1 same-valued rule write.
- **A default cap nobody set halves the window-resize frame rate** (slice 09):
  `PerFrameCoalescer` compares against 16.667 ms while a real 60 Hz frame is
  ~16.6 ms, so 6 buffered moves apply 3. The option has zero production
  callers. Look for the same "throttle that mis-rounds" shape in your slice.
- **`MarkdownEditor` re-serialises the whole document on every Lexical commit**
  (slice 24), selection-only commits included — a pure caret move exports with
  zero dirty elements, and the export is 68-86% of every commit (1.65-2.2 ms
  on a 9 KB doc). Inside a table it multiplies: 25 transformer-index rebuilds
  and 25 sub-walks per keystroke for a 4x6 table. `getValue()` has no cache,
  so a `"change"` listener that reads it doubles the cost — the library's own
  demo does exactly that.
- **All three custom Lexical nodes return `true` from `updateDOM()`
  unconditionally** (slice 24), so one keystroke inside a `:::` region
  rebuilds the region's whole DOM. Root cause is a genuine seam gap:
  `DOM.sink` has `createViewElement` but no update counterpart. If your slice
  needs a seam that does not exist, say so — that is a finding, not a
  workaround.
- **The precedent for fixing per-instance theme rules** (slice 24):
  `ensureMarkdownEditorClassRules()` is a module singleton that inserts 20
  rules once. That is the shape `codeEditorTheme()` (slice 23) should adopt.
- **Refuted** (slice 24): slice 23's `syncAutoHeight` HIGH does **not** apply
  to `MarkdownEditor` — `autoHeightMaxRows` is set only by `Markdown.ts:1194`,
  i.e. the viewer's embedded code blocks, not the Markdown editor.
  `MarkdownEditor` has no `doLayout`, no size override, zero geometry reads
  and zero style writes on any layout path, and construction issues zero sink
  ops.
- **The table header's continuous-motion paths are already clean** (slice 20):
  a column-resize drag frame costs 0 stylesheet-rule mutations and 0 forced
  reads over 10 frames; an unchanged pass costs 0 header-cell `doLayout`. All
  its per-frame waste is the upstream empty-flush tax (42 of 68 applies per
  resize frame). Another positive to protect.
- **A compositor hint on the wrong element** (slice 20): `Table.ts:336`
  promotes the `<thead>`, which receives zero transform writes, while
  `Header.setScrollX:1694-1696` transforms the three inner `Row`s, which carry
  no `will-change` — the inverse of what `docs/concepts/performance.md`
  documents. Check that every `setWillChange` in your slice is on the element
  that actually moves.
- **Unguarded `Button.setGlyph` again, on a data path** (slice 20): each store
  `filterchange` rebuilds every rendered filter cell's operator glyph twice —
  8 cells → 48 stylesheet-rule ops, 411 applies, 48 `Tooltip.attach`; 120 rule
  ops at 20 columns. And a sort click writes byte-identical titles through the
  unguarded `Text.setText` (32 text applies at 8 columns), confirming slice 14.
- The 2026-08-29 audit's duplicated-reconciler item and its `range()`
  triplication are both **closed** (slice 20).
- **`FieldDecorator.clearError()` mutates a stylesheet rule on every call, even
  with no error showing** (slice 15): 10 calls → 10 `setRuleStyles`. The
  target app wires it to `on("change")`, so that is one full-document restyle
  **per keystroke** in its dialogs. A "clear" that writes when there is
  nothing to clear is a finding shape worth checking in your slice.
- **`Slider` fails the continuous-motion pattern in three ways** (slice 15):
  it moves an un-promoted thumb with `left`/`top` instead of
  `setTranslate`+`setWillChange`, takes an uncoalesced `getViewportRect`
  forced read per raw pointer sample (10 reads for 10 moves that write
  nothing), and its settled `doLayout` writes 12 same-valued geometry
  declarations plus 3 needless child layout roots per pass by driving its
  children through the unguarded `Component.setSize`. `Toggle` separately
  routes its thumb through `setTransform` (an instance `#id` rule write per
  flip) where `Checkbox`/`RadioButton` do the same job with one inline
  `opacity` write.
- **The `clampsToContentSize()` lever works but stops too early** (slice 21):
  `Cell.clampsToContentSize() === false` gives 0 `getMinSize`/`getMaxSize`
  across 105 cells per frame, but `CellRenderer` and its `Text` still clamp to
  content — **1,710 size-hint calls per width-changing frame**, two-thirds of
  them charged to `clampWidth`/`clampHeight`. One override on `CellRenderer`
  removes it. This makes the clamp opt-out the campaign's best-evidenced
  transferable lever: look for leaf components in your slice that cannot
  usefully clamp to content.
- **MORE CORRECTIONS** (slice 21, probe-backed):
  1. Slice 14's claim that `CellRenderer.doLayout:120` drives a *changing*
     `Text.setLineHeight` per frame is **refuted** — 72 calls, 0 rule ops; the
     row height is theme-derived and the guard short-circuits.
  2. Slice 19's focus-sweep finding is real but **should drop from HIGH**: all
     105 `setStyleState` calls are guarded and produce zero DOM writes.
  3. `docs/concepts/performance.md`'s column-window paragraph is **wrong in
     four places**: `Row._cellCache` (landed 2026-08-17, after the paragraph)
     is exactly the per-type pool it says does not exist; a cell has no `#id`
     rule to delete; and a second traverse of the same range costs 0 element
     creations (vs 72) and 0 rule ops even cold. The docs need fixing too.
- **`temporalDisplayText` builds a fresh `Intl.DateTimeFormat` per value**
  (slice 21): 42-48 µs/call vs 0.65-0.87 µs cached, a 55-66x factor — per
  rebound temporal cell and per exported row (~4.8 s of formatter construction
  on a 100k-row CSV export). Check for uncached `Intl` or `RegExp`
  construction on per-value paths in your slice.
- **A `NaN` geometry write that never stops** (slice 16): every `ComboBox`
  writes `transform: translate3d(NaNpx,NaNpx,0)` on its caret glyph on every
  layout pass, forever, with `will-change: transform` permanently pinned. Root
  cause is in the layout base — `Absolute.doLayout` feeds an unset `getX()`
  into `commitBounds`'s translate fast path. Check your slice for unset
  geometry reaching a commit, and for `will-change` that is never released.
- **Opening a dropdown is unbounded** (slice 16): 500 items → 21,822 sink
  writes, 16,249 applies, 1,522 elements and **500 one-at-a-time `measureText`
  reflows**, for a panel capped at 200 px that shows nine rows.
  `Util.measureTextWidths` batches 40 into 1 and is unused. Same shape as
  slice 12's `Menu.show()`.
- **CORRECTION, again on the line-height item** (slice 16, superseding both
  slice 14's F14.3 and slice 21's correction of it): `ComboBox.doLayout:922`
  drives a *constant* line height — `applySingleLineBox` pins min == max, so 8
  requested heights all commit as 22 with zero rule ops, and a session mints
  one rule per theme font scale, not per pixel. The real unbounded leak is
  `Text.setLineHeight(NaN)` minting a permanent `.Text.lhNaNpx` rule.
- **`AutoCompleteField.querySuggestions` mutates the consumer's shared store
  per keystroke** (slice 16) — it destroys the app's own filters, leaves its
  own installed, emits two `datachange` plus two `filterchange`, and reads
  records on the sync side of an async rebuild. A correctness bug, not a perf
  one.
- **A component fighting its own layout manager** (slice 17): a closed
  `AbstractPickerField` runs the default `Absolute` manager first, which
  commits the button at its *preferred* rect, then overwrites that rect and
  re-fires `_button.doLayout()`. Three identical settled passes → 5 real style
  writes each (height flipping 16↔18 every pass), 10 `doLayout` calls and 161
  size-hint queries per pass, against a `TextField`'s 1 empty apply, 1 pass, 4
  queries. Look for `doLayout` overrides that commit *after* `super`.
- **Rebuild-instead-of-rebind, quantified** (slice 17): the year scroller
  rebuilds 171 identical cells per open — a second open costs 513 shared-
  stylesheet mutations for a byte-identical list — and retains the detached
  column with all 171 rules while closed (`dispose()` releases 44 of 215,
  because the column is not a registered child). The same file's
  `refreshYearSelection`/`setSelectedValue` already prove the in-place path
  works. Where your slice rebuilds a list it could rebind, say so.
