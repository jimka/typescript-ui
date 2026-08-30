# Codebase health audit — 2026-08-29

Repeat of the 2026-07-05 whole-codebase health audit (duplicated code, overlapping functionality, dead/unused code), rescoped to everything added since. That audit produced 10 coordinated plans from 7 parallel subsystem reviewers; this one follows the same structure over a larger window.

**Window covered:** 2026-07-05 → 2026-08-29 (~8 weeks). 2,242 commits, 306 merged `feature/*` branches. Roughly a second major growth phase of the library: new standalone components (Diagram/ELK viewer, CodeEditor, Markdown viewer/editor, WebGL, Video, Canvas, SVG charting), heavy Table subsystem growth (virtualization, filters, cell editing, export), a component-lifecycle/leak-fix campaign, layout-engine changes (including `layout-propagate-on-mutation` and `Component.afterNextLayout`, the two most recent commits on `master`), and a large, separately-tracked StyleAudit CSS-dedup campaign (hundreds of mechanical commits, out of scope for re-review here except where it left inconsistency).

**Method:** 7 independent fresh-context reviewers (the project's `audit` skill's standard reviewer, one per subsystem slice), each reading the governing rule docs (`CLAUDE.md`, `ARCHITECTURE.md`, `CODE_CONVENTIONS.md`, `pattern-conformance.md`), then auditing its slice against BLOCKING/ADVISORY criteria. No reviewer saw another's output. Total run time ~15 minutes wall-clock (parallel), ~2.3M tokens.

**Totals: 46 BLOCKING findings, ~65 ADVISORY findings**, across:

| Subsystem | Blocking | Advisory |
|---|---|---|
| Visualization/media (Diagram, WebGL, Video, Canvas, charts) | 6 | 11 |
| Table subsystem growth | 3 | 11 |
| Docs / Markdown / CodeEditor | 5 | 12 |
| Core lifecycle & leak-fix campaign | 6 | 7 |
| Layout & overlay | 6 | ~15 |
| Forms/inputs & new component patterns | 2 | 9 |
| Infra & general dead-code sweep | 18 | ~25 |

This document has not been acted on yet — it is a survey, mirroring the shape of the 2026-07-05 audit's output before it became 10 implementation plans. See **Recommendation** at the end for suggested next steps.

---

## Priority 1 — Real correctness bugs and leaks

These are functional defects, not style preferences. Several are unbounded leaks on routine, high-frequency paths (scroll, row-refresh, keyboard nav), verified empirically by the reviewers with offline probes (not just read from source).

### 1. `TreeRow` leaks a renderer + `Glyph`/`ProgressSpinner` on every re-bind — unbounded
`packages/lib/src/typescript/lib/component/tree/TreeRow.ts:66` (`_renderer`), `:309` (raw append), `:64-65` (`_toggle`/`_spinner`). No `destructor()` in the file. `update()` (`:173-187`) discards `_toggle`/`_spinner` via `DOM.sink.removeChild` + `= null` — never `dispose()`. Measured: 20 `setNodes()` cycles on a 4-node tree → 40 components constructed, 0 destroyed, 40 permanent stylesheet rules added. Live on any routine data-refresh or scroll path. `VirtualRowView.destructor()` (`component/shared/VirtualRowView.ts:133-141`) already models the fix one level up.

### 2. `SelectableListRow` leaks its renderer per row; shrink path discards rows via detach-only API
`component/list/AbstractSelectableList.ts:301` (`_renderer`), `:432`/`:539` (raw appends), no `destructor()`. Separately, `:1597-1604` shrinks the pool via `removeComponent(...)` (documented detach-only) instead of disposing. Measured drift: 3-item list → 6; 10-item → 20; 10-then-shrink-to-2 → 28. `Row.destructor()` (`component/table/Row.ts:1001-1005`) is the sibling fix for the same shape of problem; `disposeAllComponents()` exists specifically for the discard case.

### 3. `FieldSet` / `LabeledFieldSet` leak their `Legend` on every dispose
`component/container/FieldSet.ts:58` constructs `_legend`, `:264` raw-appends it, no `destructor()`. Measured: `new FieldSet('T')` → 1 stylesheet rule left behind per instance. Precedent it should follow already exists in this campaign: `SplitGutter.destructor()`, `HeaderCell.destructor()`, `TabButton.destructor()`.

### 4. `ComboBoxLabel` leaks its renderer
`component/input/ComboBox.ts:413` (`_renderer`), `:465`/`:535` (raw appends). `ComboBox.destructor()` (`:1265-1270`) was extended by this campaign to dispose `_dropdown` but not the label's renderer. Drift of 2 per `ComboBox`.

### 5. The campaign's own regression guard has gone stale — the meta-failure
`tests/component/dispose-full-teardown.test.ts:18-37` states in its header that `grep -rn '^\s*protected destructor('` "currently returns 35 hits"; it returns 54 today. The registry holds 25 rows. The header's own list of "unreconciled classes" is stale too — many now-fixed and newly-added classes are absent from both lists. This is the exact "hand-written counts go stale" failure mode already on record for plan documents, now found in a test file whose entire job is catching findings 1–4.

### 6. `LayoutManager`'s shared clamp chokepoint still lets max beat min
`layout/LayoutManager.ts:418-422`, `:444-448` — an `if (max) … else if (min) …` ladder, the exact wrong ordering `box-child-clamp-ordering` (2026-07-05 audit) set out to fix. Only `HBox`/`VBox`/`FlowLayout` call sites were patched; `resolveBounds` — the shared chokepoint every layout manager funnels through — was missed because it assigns rather than calling `Math.max(...)`, which is what the plan's own completeness grep searched for. Live whenever `fill !== BOTH`: every `HFlow`/`VFlow` cell, `Grid`, `Border`, `Card`, `Anchor`. The same child gets `min` in an `HBox` and `max` in a `Grid`.

### 7. `round-layout-coordinates` breaks the gap-free-adjacency invariant `CollapseSupport` depends on
`core/Component.ts:3842, 3946, 4007, 4043` round `left`/`top`/`width`/`height` independently. With `x=0.4, w=10.4`: child A paints `[0,10]`, sibling B starts at `11` — a 1px seam, on exactly the fractional-coordinate case (proportional column-width distribution) the commit was written for. `CollapseSupport.ts:329-331`'s own comment states the invariant this now violates. No test pins adjacency. (Companion finding: the JSDoc claim that this rounds to "the nearest device pixel" is simply wrong — `Math.round` snaps to the nearest CSS pixel, and an existing `DOM.source.getDevicePixelRatio()` seam is not consulted. Renders on `Component`'s public API page.)

### 8. `DiagramView` leaks a `ThemeManager` listener per node on every superseded/failed/disposed-mid-flight layout
`component/diagram/DiagramView.ts:679-685` — `discardIncomingNodes()` only `.clear()`s maps; every `DiagramNode`/`DiagramGroupNode` registers a **global** static theme listener at construction (`ThemeManager.onThemeChange`, released only by `dispose()`). `destructor()` (`:534-566`) disposes non-resident `_nodeComponents` by hand but never `_incomingComponents`. Measured with a listener-count probe: fresh view → 9; after `setData(20 nodes)` → 29; after a second `setData` before layout lands → 49; after `dispose()` → still 42. Common path — ELK round-trips take seconds on the graphs this component targets.

### 9. `DiagramNodeLayer`'s `<svg>` is never given a box — LOD rects render into a clipped 300×150 default
`DiagramView.applyLayout` explicitly sizes the sibling edge layer but never the node layer. `createRootElement` (`DiagramNodeLayer.ts:96-98`) emits a bare `<svg>` with no `width`/`height`/`viewBox`. Verified offline: after `zoomToFit` on a 220-node grid, the node layer's committed size is `NaN`/`null`, the only style ever written against its id is `cursor: inherit`, and the framework's default `overflow: hidden` clips the graph — in exactly the fit-zoom case level-of-detail rendering exists for. Both existing SVG surfaces in the repo (`AbstractChart.sizeSurface`, `DiagramEdgeLayer`) size themselves explicitly; this is the unambiguous precedent that was skipped.

### 10. Table scroll hot path re-queries and re-filters the entire record store per pooled row, per tick
`component/table/Body.ts:1715` — `updateCellRangeVisualState` opens with `getVisibleRecords()[dataIdx]`, used only for a null guard, never read again. `getVisibleRecords()` does a full `O(N)` array copy and, when a quick-search or row-visibility predicate is installed, an `O(N)` `.filter()`. Measured on a 4,000-row table (21 pool slots): one-row scroll tick → 3 calls; page-jump (full rebind) → 41 calls; same page-jump **with quick search active → 164,000 predicate invocations for one tick**. Directly contradicts a doc comment three lines above the loop stating records are "passed in so this helper doesn't re-query." The new cell-range-selection feature (this window) doubled a pre-existing instance of the same cost and added a second (drag) path. Regresses the exact class of cost `table-scroll-recycling-cost`/`table-scroll-first-visit-cost` optimized earlier in this window; no existing test measures call count, only `doLayout` count.

### 11. `CodeEditor.syncAutoHeight` strands an uncommitted height with no `heightchange` emitted
`component/editor/CodeEditor.ts:924` commits an intermediate probe height (`setHeight(contentDesired)`) to measure scrollbar reserve, but the guard at `:988-990` can early-return before reconciling it, leaving the component 15px short with no event fired — so `Markdown.handleCodeEditorHeightChange` never re-pins the wrapper, and the growth guard at `:992-994` then permanently rejects the correction on the next call. Traced with a concrete reproduction (`previousHeight=115`, `contentDesired=100`, `hbarReserve=15`). Not covered by any of the 40 existing autoheight tests. The surrounding comment (`:130-137`) already names this exact failure mode as "a distinct bug to fix at the source."

### 12. `CheckboxMenuRow` / `RadioMenuRow` silently drop the `"action"` callback on keyboard Enter
Both expose `"action"` as a `click`-listener shorthand on the row element (`CheckboxMenuRow.ts:255-260`, `RadioMenuRow.ts:259-264`), but `activate()` (reached via ArrowDown+Enter in a `MenuBar`, through `Menu.ts:807-819`) only calls `setChecked(...)` — no click is produced. `Checkbox.setSelected` does fire a synthetic click, but non-bubbling and on the wrong element id, so `Event`'s exact-target-id router never delivers it; `RadioButton.setSelected` fires nothing at all. Net effect: keyboard-driven toggle flips the graphic but never notifies the consumer, live in the shipped `MenuBarPanel` demo. `isNavigable(): true` exists specifically to opt into this Enter path — this is the advertised route, not an edge case. Public JSDoc on both classes falsely claims the event fires "after each toggle (click or activate)". Root cause is duplication (see Priority 2, #2).

---

## Priority 2 — Structural duplication that should converge

Findings where two or more places in the codebase solve the same problem independently, creating drift risk (several of which have already drifted — see Priority 1 #6, #10, #12).

1. **`Header.ts` has two ~150-line duplicated windowed-cell reconcilers.** `reconcileColumnCells`/`reconcileColumnWindowSlide` (`:813-1030`) and `reconcileFilterCells`/`reconcileFilterWindowSlide` (`:1424-1612`) are the same algorithm written twice, differing only in cell type and two field names. The codebase's own precedent from the prior audit (`VirtualRowView`) is exactly this shape of extraction; a generic `reconcileWindowedRow<TCell>` would collapse ~100 lines and remove the risk of the two rows' window bookkeeping drifting apart. Within the column row alone, per-column state application is *also* duplicated between its full and slide paths.

2. **`RadioMenuRow` is a ~105-line uncredited copy of `CheckboxMenuRow`** (`component/container/RadioMenuRow.ts` vs `CheckboxMenuRow.ts`) — directly caused Priority-1 finding #12. The rejection of an `AbstractBooleanInput`-style shared base (`plans/implemented/split-gutter-collapse-radio.md:349`) rests on a technical claim ("cannot build the control before `super()`") that `AbstractBooleanInput` itself — the class the plan's own footnote names as "the shape to copy" — already solves via an abstract accessor, not a base-held field. The layout/overlay review independently flagged that a third boolean-menu-row mechanism (`MenuItemConfig.checked`, `MenuItem.ts:92`) already existed before this copy was written, meaning the "third occurrence justifies extraction" threshold was already crossed and missed.

3. **`Canvas`/`WebGLCanvas` are a ~250-line lockstep-edited copy.** 13 method bodies (88 lines) are byte-identical across the two files, plus nine identical fields. `Canvas.syncBackingStore`'s doc comment claims a "reusable seam shared with the WebGL sibling" that does not exist — `WebGLCanvas` doesn't extend `Canvas`. The original no-shared-base decision (`plans/implemented/webgl-component.md:24-30`) was grounded in the shared surface being "~6 lines"; the entire animation-loop layer (maxFps, animate-when-hidden, visibility reconciliation) was added to *both* files in the same two commits after that decision, i.e. the copy has already needed one lockstep edit. `AbstractChart` in the same window demonstrates the alternative for two siblings (`LineChart`/`BarChart`).

4. **Split and Accordion still haven't converged on shared resize mechanics**, despite sharing `SplitGutter` and `core/PointerDrag.ts`. Drag model, clamping, collapse animation, and weight pin/refill are each implemented twice with documented divergences (one plan explicitly calls its version "a mirror, not a share"). One piece has since become collapsible: `SplitGutter` gained `"dragend"` three days after Accordion shipped a viewport-listener workaround for the same gap — that workaround is now redundant but wasn't removed.

5. **`Panel` duplicates `VirtualScroller`'s scrollbar-layout algorithm** (`Panel.ts:1229-1307` vs `VirtualScroller.ts:299-455`) — same five steps, same variable roles, differing only in convergence strategy. `ScrollShadowEdges`/`setShadowEdge` are each declared twice. A plan note in this very window states VirtualScroller "already solves exactly this class of problem" and then reimplements it anyway.

6. **`Menu.open()`'s horizontal placement hand-rolls the primitives `overlay-edge-flip` built to replace exactly this.** `Menu.ts:596-600, 613-617` inline `positionAdjacent`/`positionAligned`-shaped logic that *clamps* where the exported primitives *flip* — while the same file's vertical axis and its rebuild-mode path already route through the real primitives. One `Menu` class now has two contradictory horizontal placement policies depending on entry point.

7. **`MarkdownViewer` and `DocsContent` duplicate ~60 lines of scroll-tracking** (`onNativeScroll`, three fields) beyond the one method (`scrollToHeading`) a plan explicitly justified duplicating.

8. **Two exported types named `AxisOrientation` with incompatible unions.** `primitive/Axis.ts:13` (`"horizontal"|"vertical"`, the established shared vocabulary used by 14 modules) vs `component/chart/ChartAxis.ts:14` (`"bottom"|"left"`, unrelated meaning). A third near-duplicate, `OverlayPosition.ts`'s `AnchorAxis`, re-declares the same structural union as `primitive/Axis.ts` under a third name. Neither newer declaration has an `## Architecture Decisions` justification.

9. **Minor, lower-cost duplication** (advisory-tier, listed for completeness): `range()` triplicated verbatim in `Body.ts`/`Row.ts`/`Header.ts`; row-height formula computed identically in three places in the Table layout code; `visiblePoints()` duplicated between `LineChart`/`BarChart`; the viewport→graph coordinate inversion written out three times in `DiagramView`; six copies of an identical `updateHeight()` body across `TextField`/`PasswordField`/`UsernameField`/`ComboBox`/`AbstractPickerField`/`NumberSpinner`; `WindowBorder`/`SplitGutter` share a cursor seam and drag-lifecycle shape but not the code.

---

## Priority 3 — Dead code and orphaned exports

From the dedicated sweep (method: import-graph analysis over all of `packages/`, cross-checked against git history to separate in-window from pre-window residue) plus incidental finds from the other six reviewers.

**Introduced in this window, orphaned exports (same class the original audit's cleanup plan removed):**
- `core/ScrollShadow.ts:25,35` — `SCROLL_SHADOW_EXTENT_PX`, `SCROLL_SHADOW_RAMP_PX`
- `router/RoutePattern.ts:9,12` — `SegmentKind`, `RouteSegment`
- `component/chart/ChartAxis.ts:14,42` — `AxisOrientation` (see Priority 2 #8), `AxisRenderOptions`
- `core/ClassStyleRules.ts:124,648` — `ResolvedStyleBag`, `ResolvedStyleState` (leak past a barrel comment that deliberately excludes them)
- `core/OverlayPosition.ts:12,20,140` — `AnchorAxis`, `AnchorOptions`, `FlexiblePlacement`
- `component/list/AbstractSelectableList.ts:2062` — `SelectableListRow` has zero importers anywhere (rename residue from `CustomListRow`→`SelectableListRow`); also exported without `callable()` wrapping, against ARCHITECTURE.md
- `component/container/CheckboxMenuRow.ts:11`, `RadioMenuRow.ts:11` — `CheckboxMenuRowEvent`/`RadioMenuRowEvent`, unused (the `on`/`off` overloads use the string literal directly)
- `chart/types.ts:44-56` — `ChartStoreBinding`, re-exported into the public API, referenced nowhere; `AbstractChartOptions` uses flat fields instead

**Dead script:** `packages/lib/package.json:139` — `"doc"` script, superseded by `docs:api`, would also override `typedoc.json`'s explicit entry points if ever run.

**Pre-window dead code, found incidentally while reading surrounding context** (outside the original cleanup's scope, unclaimed rather than missed): `Component.getCSSRule()` (`core/Component.ts:1166`, zero callers since 2026-06-19, also a DOM-seam violation by return type), `Component.clearPosition()` (`:4295`), `AbstractStore.getActiveSorter()` (`@deprecated`, zero callers), `AbstractSelectableList.getIndex()`, 15 of 17 symbols in an `AbstractCalendarDropdown.ts:1613-1633` export block, `PickerColumn.ts:422`'s `PICKER_HEADER_HEIGHT` alias, `TimeColumns.ts:192,194`, duplicate `TOGGLE_WIDTH` constants in `TreeRow.ts`/`cell/renderer/TreeCell.ts`, four deprecated `Slider` min/max methods with only their own deprecation tests as callers.

---

## Priority 4 — Documentation and build breakage

Left behind by `workspace-restructure`/`packages-docs` (paths moved, some docs weren't updated) and by the newest components (docs/manifest not extended to cover them).

- **`ARCHITECTURE.md`** — a governing rule document — has 6 dead relative links to pre-restructure paths (`docs/recipes/...`, `docs/concepts/sizing.md`, `src/typescript/lib/core/DOM.ts`, etc.); one link on an adjacent line was correctly updated, so this is a half-finished pass.
- **`docs:build` is referenced as the verification gate by two governing skill docs** (`.claude/skills/_shared/docs-conventions.md:14`, `.claude/skills/document/SKILL.md:28`) **but no such script exists** in any `package.json`; the correct command (`docs:api`) is named correctly in `CODE_CONVENTIONS.md`. Three still-open plans inherit the dead command.
- **`llms.txt`** — the capability index CLAUDE.md itself says to read before building any UI feature — **lists only 1 of the 8 components added this window** (`Canvas`; missing `WebGLCanvas`, `Video`, `VideoPlayer`, `LineChart`, `BarChart`, `ChartLegend`, `DiagramView`). Last touched 2026-08-24, well after all of these shipped — a live gap, not a race.
- **`npm run docs:api` finishes with a warning, not zero** — `DiagramEdgeLayer.ts:474/477` `{@link}`s a protected, doc-excluded symbol from public JSDoc, the exact case `CODE_CONVENTIONS.md` names as forbidden. Flagged independently by two reviewers (visualization and layout).
- **`packages/lib/docs/guide/installation.md`** claims "zero runtime npm dependencies" (29 are declared) and documents build commands (`npm run build`, `preview`, `clean`) that don't exist at the root; the root `README.md` already has the corrected version of the same table.
- **23 broken internal doc links** in the shipped corpus (e.g. `/api/overlay/variables/DragManager` ×6, `/api/core/classes/Animation` ×4, `/api/component/container/classes/Panel` ×4) — none guarded by any test; the existing link test only unit-tests the resolver, never the corpus's actual targets.
- **`NOTICE`** (repo root) is a stale, unlinked third-party-license file that contradicts the real one (`packages/lib/THIRD-PARTY-NOTICES.md`) and points at a pre-restructure source path.
- **`packages/create-app` scaffolds a project with no `license` field, no `LICENSE`, and no README mention**, while depending on a package whose license bars internal business tooling — a scaffolded-project user is never told.
- Several smaller stale citations: a plan-name reference in `DiagramEdgeLayer.ts` to a plan that doesn't exist in this repo; two stale line-number citations in docs content files; `windowControls.ts` claiming a helper is shared by two consumers when only one remains; `Panel.ts` prose describing a field (`_overlayHost`) that no longer exists.

---

## Items likely needing a design decision (not mechanical fixes)

Flagged separately because autonomous fixing isn't appropriate for these — each has more than one reasonable resolution:

- **Canvas/WebGLCanvas shared base class** — re-open the no-shared-base decision from `webgl-component.md` given the animation-loop layer has already forced one lockstep edit (Priority 2 #3).
- **RadioMenuRow/CheckboxMenuRow extraction** — the specific technical objection in `split-gutter-collapse-radio.md` doesn't hold against the `AbstractBooleanInput` precedent it names; worth revisiting now that the duplication has produced a live bug (Priority 1 #12, Priority 2 #2).
- **Split/Accordion convergence scope** — how much of the drag/clamp/collapse mechanics is worth unifying now vs. continuing to mirror (Priority 2 #4).
- **`dispose-full-teardown.test.ts` / `dispose-listener-teardown.test.ts` regeneration** — these are hand-maintained regression guards that have already gone stale once; worth deciding whether to make them self-counting (grep-derived) rather than hand-updated, matching the project's own recorded lesson about hand-written counts.
- **`component-element-release`'s `canRelease()` rollout** — still entirely unexercised outside a test double, 4 weeks after landing; and its dedup-by-reference mechanism will silently break for any `init()` override using an inline closure (~30 such sites exist). Worth deciding whether to schedule the opt-in rollout or defer further.

---

## Recommendation

The 2026-07-05 audit's output became 10 coordinated, dependency-ordered plans, implemented over the following weeks. This audit is comparable in scale (46 blocking findings vs. that audit's ~15-20 rolled into 10 plans) and the same treatment likely fits: group Priority 1 (real bugs/leaks) into a tests-first plan batch, mirroring the "safety net first, then parallel-safe fixes, then dependent fixes, renames last" ordering used last time. Priority 2/3/4 items are lower-urgency and could either fold into the same batch or run as a second, separate round once Priority 1 lands — the original 10-plan batch mixed both without issue.

Two working files from concurrent reviewer sessions were found and removed during this audit: `packages/lib/tests/zz-audit-probe.test.ts`, `tests/component/table/__tmp_audit_probe.test.ts`, `packages/lib/tests/component/diagram/__probe.test.ts` (all untracked scratch files, not repo content).
