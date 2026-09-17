# 25 display-markdown — render-work review

**Summary**

- `Markdown.measureContentHeight` is a write→read→write probe (`height: auto` →
  `scrollHeight` → `height: Npx`) that runs on **every assigned-width change**, i.e.
  every frame of a horizontal gutter drag or window resize with a preview visible.
  Probe: 7 style applies (4 of them empty) + 1 forced `getScrollMetrics` per frame,
  two full-document layout invalidations, plus a `parent.scheduleLayout()` that adds
  a second layout pass on the next frame. (F25.1, HIGH, hot path 1.)
- `lexMarkdown` is **quadratic in document length** — both block tokenizer extensions
  `split("\n")` the entire remaining source at every block-token position. Measured:
  marked's own lexer 3.98 ms at 3,200 blocks, `lexMarkdown` 408.70 ms — 103× slower,
  and it runs synchronously inside `setMarkdown`. (F25.2, HIGH, `setContent`.)
- `MarkdownViewer.doLayout` calls `FloatingPanel.placeNextTo` twice unconditionally.
  Probe: exactly **20 `getElementRect` over 10 identical passes** = 2 forced document
  layouts per frame per visible viewer. Confirms slice 11. (F25.3, HIGH, hot path 1.)
- `resyncCodeEditorWidths` interleaves one live geometry read per upgraded fenced
  block with the previous block's width write — probe shows reads at write-counts
  23/24/25/26, i.e. **N forced layouts per width change** for N live code blocks,
  each also triggering that `CodeEditor`'s own 15–20 ms re-measure. (F25.4, HIGH.)
- `findActiveHeading` re-derives every heading's geometry from scratch per scroll
  tick, after `Panel`'s own scroll-shadow inline write has already dirtied layout in
  the same task: 1 forced layout + up to N `getBoundingClientRect` + N **document-wide**
  `getElementById` per scroll event (probe: 33 rect reads for a 40-heading document).
  The document-wide id lookup also breaks outright when two previews share a heading
  name. (F25.5, HIGH, hot path 2.)
- Positives to protect: the token→DOM renderer materialises **zero per-instance
  stylesheet rules** (20 shared class rules, once per process, module-flag guarded);
  an unchanged-width commit costs **0 sink writes and 0 reads**; the minimap highlight
  is edge-triggered, not polled; the `CodeEditor` upgrade is genuinely lazy in three
  stages (import, effective visibility, viewport proximity) with a generation token.

## Findings

### F25.1 `measureContentHeight` runs a collapse/measure/restore DOM probe on every width change

- **Category**: A (forced sync read on hot path), D (avoidable layout pass), B (unchanged-value / empty writes)
- **Impact**: HIGH — per frame of every horizontal resize, per visible `Markdown`.
- **Where**: `component/display/Markdown.ts:972-984` (`setWidth`), `:1043-1089`
  (`measureContentHeight`), specifically `:1056`, `:1069-1071`, `:1075-1076`,
  `:1080-1081`, `:1088`.
- **Hot path**:
  - `Split`/`Dock` gutter drag or window resize → `Body` → … → `Anchor.doLayout`
  - `LayoutManager.commitBounds:566` → `component.setWidth(width)`
  - `Markdown.setWidth:977` — `changed` → `resyncCodeEditorWidths()` (F25.4)
  - `Markdown.setWidth:979` → `measureContentHeight()`
  - `:1056` `commitElementStyle()` — flushes the queued `width` (**write**)
  - `:1070` `setElementStyle("height", "auto")`; `:1071` `commitElementStyle()` (**write**, invalidates document layout)
  - `:1076` `DOM.source.getScrollMetrics(element).scrollHeight` (**forced synchronous layout #1**)
  - `:1080-1081` `setElementStyle("height", restoreHeight + "px")` + commit (**write**, invalidates again)
  - `:1088` `(parent ?? this).scheduleLayout()` whenever the height changed — during a
    horizontal drag the reflowed height changes every frame, so this enqueues a second
    full layout root for the *next* frame, every frame.
  - the next geometry read in the same task — `MarkdownViewer.doLayout`'s own
    `placeNextTo` (F25.3) — pays **forced synchronous layout #2**.
- **Evidence**: probe `.worktrees/_probes/25-display-markdown/markdown.probe.test.ts`
  (`P1`). One changed-width commit produced these style applies, in order:
  `{"width":"300px"}`, `{}`, `{}`, `{"height":"auto"}`, `{}`, `{"height":"NaNpx"}`, `{}`
  — **7 applies for 3 real values, 4 of them empty**, and one `getScrollMetrics`.
  An unchanged-width commit produced **0 writes and 0 reads** (the `changed` guard at
  `:973` works). The four empty applies are the `InlineStyle.flushDirty` missing
  empty-bag guard already reported by slices 01/03/04, instanced four times per
  measure here. The `NaNpx` is F25.13.
  `getBorderSize()` at `:1075` is free in the default case (`Component.getBorderSize:3686`
  early-returns for an unbordered component) — it becomes a `getComputedStyle` read
  only for a `Markdown` that was given a border.
- **Proposed change**: two mechanisms, either of which stands alone.
  (a) **Defer the measure to the resize settle.** The measured height only feeds
  `getMinSize`/`getPreferredSize` for the scroll host's extent; a stale extent during a
  drag is invisible except for a scrollbar thumb length. Route `setWidth`'s re-measure
  through the existing `scheduleContentMeasure()` coalescer (`:1540`) instead of calling
  `measureContentHeight()` synchronously, and add the `resize-settle-afternextlayout-uplift`
  gate so a continuous drag measures once at rest rather than once per frame.
  (b) **Remove the collapse/restore.** `scrollHeight` is floored at `clientHeight`,
  which is the only reason the box is collapsed to `auto` first. Measuring an inner,
  auto-height content wrapper (the prose already lives one level down for every other
  purpose) gives the true content height with no write before the read and no restore
  after it — dropping 4 of the 7 applies and both layout invalidations.
- **Risk / blast radius**: `Markdown.test.ts:1381-1524` pins the min/preferred-size
  folding, the growth re-measure, the unchanged-height no-relayout, the theme re-measure
  and the `Fit` scroll-host growth. `Markdown.test.ts:1861` pins that the width flush
  precedes the geometry read. Deferring the measure would need those tests to flush a
  layout; option (b) changes the measured element and needs the same suite re-pointed.
  `MarkdownViewer`, `DocsContent` and Loom's `FileEditor` preview all size through this.
- **Proof at implement time**: a probe asserting ≤1 style apply and 0 `DOM.source` reads
  per `setWidth` during a simulated 10-frame drag; ms/frame on a Loom horizontal
  gutter drag with a Markdown preview in one pane.

### F25.2 `lexMarkdown` is quadratic — both block extensions re-split the whole remaining source at every block position

- **Category**: H (implementation does far more than its function), D
- **Impact**: HIGH — per `setMarkdown`, i.e. per preview open in Loom and per keystroke
  in the docs live-preview demo. 408 ms for a 3,200-block document, on the main thread.
- **Where**: `component/display/markdownTableExtension.ts:168` (`const lines = src.split("\n")`),
  `component/display/markdownExtensions.ts:128-131` (`const lines = src.split("\n")`;
  `lines[0]!.trim()`; `if (!firstLine.startsWith(":::")) return undefined;`).
- **Hot path**: `Markdown.setMarkdown:911` (or `render:1102`, or
  `extractMarkdownHeadings:2168`) → `lexMarkdown` → `marked` `Lexer.blockTokens` loop →
  **for every block-token boundary**, each registered block extension tokenizer is called
  with the *entire remaining source*. `TABLE_EXTENSION` splits it into a full line array
  to look at `lines[0]` and `lines[1]`; `BLOCK_EXTENSION` splits it to look at `lines[0]`.
  Two full-source line arrays are allocated and discarded per block token.
- **Evidence**: probes `lex.probe.test.ts` and `lex2.probe.test.ts`. Paragraph-only
  documents, mean of 5 runs after a warm-up:

  | blocks | marked, no extensions | `TABLE_EXTENSION` only | `lexMarkdown` (full set) |
  |---|---|---|---|
  | 200  | 1.13 ms | — | 4.56 ms |
  | 400  | 0.93 ms | — | 7.42 ms |
  | 800  | 1.13 ms | 15.22 ms | 29.52 ms |
  | 1600 | 1.92 ms | 53.02 ms | 114.15 ms |
  | 3200 | 3.98 ms | 217.91 ms | 408.70 ms |

  marked's own lexer is linear; `lexMarkdown` quadruples per doubling. The two block
  extensions contribute roughly equally. This is not marked's cost — it is the two
  extensions' whole-source scan.
- **Proposed change**: neither tokenizer needs the whole source split.
  `TABLE_EXTENSION`: take the first two lines with two `src.indexOf("\n")` calls, reject
  immediately unless the second one parses as a delimiter row, and only then split what
  remains. `BLOCK_EXTENSION`: reject immediately unless the first line's trimmed form
  starts with `:::` — again resolvable from one `indexOf("\n")` — and only then scan for
  the matching close. Both also want marked's `start()` hook so the lexer can skip the
  call entirely at positions that cannot begin the construct.
- **Risk / blast radius**: `lexMarkdown` is the library's single lexing seam
  (`markdownExtensions.ts:202`), used by `Markdown.render`/`setMarkdown`,
  `extractMarkdownHeadings`, and the editor's parity guard. The table and fence grammars
  are pinned by `Markdown.test.ts:1055-1278` (tables, widths, merges) and `:382-524`
  (fences, nesting, escapes) — a pure early-out must leave all of those green.
- **Proof at implement time**: re-run the table above; `lexMarkdown` should track
  marked's own linear curve within a small constant.

### F25.3 `MarkdownViewer.doLayout` forces two document layouts per pass, unconditionally

- **Category**: A, D
- **Impact**: HIGH — 2 forced synchronous layouts per frame per visible viewer, on
  hot path 1. Confirms and quantifies slice 11's finding.
- **Where**: `component/display/MarkdownViewer.ts:214-224`;
  `component/container/FloatingPanel.ts:197-229` (`:205` `getContentInsets()`,
  `:223` `DOM.source.getElementRect(textEl)`, `:226` `setX`).
- **Hot path**:
  - any layout pass reaching the viewer → `MarkdownViewer.doLayout:215` `super.doLayout()`
    (commits the content pane, the minimap and the controls — **writes**)
  - `:220` `this._minimap.placeNextTo(this._markdown)` → `FloatingPanel.placeNextTo:223`
    `DOM.source.getElementRect(textEl)` — **forced layout #1**; `:226` `setX` (**write**,
    when the hug position moved)
  - `:221` `this._controls.placeNextTo(this._markdown)` → the same read — **forced layout #2**
  - both calls also allocate a fresh `Insets` with a UUID via `getContentInsets()`
    (slice 28's finding), and re-derive `host.getInnerSize()` and `this.getWidth()`
    with no memo (slice 05's finding).
- **Evidence**: probe `viewer.probe.test.ts`. Ten *identical* `root.doLayout()` passes
  over a mounted `MarkdownViewer`: `{ getElementRect: 20 }` — exactly 2 per pass, and
  no other `DOM.source` geometry read at all. The same run charged **350 sink applies,
  310 of them empty** (35 per pass, 31 empty) — again the `InlineStyle.flushDirty`
  empty-bag gap, this time multiplied by the viewer's component count.
- **Proposed change**: gate both `placeNextTo` calls on a clamp signature, the way
  `scroll-strip-deferred-resync` gated `ScrollStrip.layoutItems`. The hug X is a pure
  function of (host inner width, host left content inset, this panel's width, margin,
  `_markdown.getX()`, `_markdown`'s *rendered* width). Only the last term needs a live
  read, and it only changes when the viewer's width, the max-measure or the font scale
  changes — all three of which are known to the viewer without reading the DOM. Cache
  the last rendered width against that signature, skip the read when unchanged, and
  invalidate it from `setWidth`, `setMaxMeasure` and `setFontScale`. A cheaper variant:
  read once and reuse the same rect for both panels (halves the cost for one line).
- **Risk / blast radius**: `MarkdownViewer.test.ts` pins the hug behaviour indirectly
  through minimap placement; `stepWidth:389-390`, `stepZoom:404-405` and
  `resetViewerProperties:419-420` are the three non-layout callers and must keep
  forcing a re-hug. `DiagramView` uses `FloatingPanel` the same way — check it before
  changing `placeNextTo` itself rather than its caller.
- **Proof at implement time**: a probe asserting 0 `getElementRect` calls over 10
  identical passes and exactly 2 on the first pass after a width change.

### F25.4 `resyncCodeEditorWidths` reads wrapper geometry between editor width writes

- **Category**: A, G
- **Impact**: HIGH where a preview has fenced code — N forced layouts per width change
  for N live blocks, each followed by that editor's own CodeMirror re-measure
  (15–20 ms/frame each per slice 23).
- **Where**: `component/display/Markdown.ts:1273-1284`, specifically `:1281`.
- **Hot path**: `commitBounds` → `Markdown.setWidth:978` → `resyncCodeEditorWidths` →
  for each `{editor, wrapper}`: `DOM.source.getScrollMetrics(wrapper).clientWidth`
  (**read**) → `editor.setWidth(...)` (**write** — the editor is not a framework child
  of `Markdown`, so its own `_autoCommitStyle` is `true` and the write flushes
  immediately) → next iteration's read is **forced**.
- **Evidence**: probe `markdown.probe.test.ts` (`P2`). Four stand-in editors; the four
  `getScrollMetrics` calls landed at sink-write counts **23, 24, 25, 26** — one write
  between every pair of reads, i.e. every read after the first is forced by the
  preceding write. This is the exact "must resolve every child, then commit" rule in
  `docs/concepts/layout-system.md` being broken inside a single method.
- **Proposed change**: split the loop — read every wrapper's `clientWidth` into an
  array first, then write every `editor.setWidth` — turning N forced layouts into 1.
  Combined with F25.1's settle gate, the whole method runs once per drag instead of
  once per frame.
- **Risk / blast radius**: `Markdown.test.ts:1791-1859` pins the resync value, the
  hidden-subtree skip and the "measureContentHeight does not resync" split;
  `Markdown.test.ts:1861-1894` pins that the width flush precedes the first read — a
  read-all-then-write-all loop keeps that ordering.
- **Proof at implement time**: re-run probe `P2` and assert all reads land at the same
  sink-write count.

### F25.5 `findActiveHeading` re-derives the whole heading geometry per scroll tick, through a document-wide id lookup

- **Category**: A, G, plus a correctness bug
- **Impact**: HIGH on hot path 2 — per native scroll event (not rAF-coalesced), per
  visible viewer. MEDIUM-HIGH correctness: two previews of documents sharing a heading
  name silently break each other's outline.
- **Where**: `component/display/Markdown.ts:2206-2245`, specifically `:2207`, `:2208`,
  `:2215`, `:2217`, `:2221`; reached from `HeadingScrollTracker.ts:91`,
  `MarkdownViewer.ts:195` + `:429-435`, and `packages/docs/src/shell/DocsContent.ts`'s
  own `onNativeScroll`.
- **Hot path**:
  - native `scroll` on the inner scroller → `Event`'s single window-level capture
    listener (`core/Event.ts:181` marks `scroll` passive, `:213` installs on `window`)
    → subtree walk up the ancestor chain (slice 03's per-event ancestor-walk cost)
  - **`MarkdownContentPane` (a `Panel`) fires first** — `Panel.installScrollShadows:1283`
    → `updateScrollShadows:1418` → `resizeScrollShadowOverlay` + `applyShadowEdges` →
    `StyleTarget.set:35` writes straight through to the element when attached (**write**)
  - `MarkdownViewer.onNativeScroll:429` → `HeadingScrollTracker.trackScroll:91`
  - `findActiveHeading:2207` `DOM.source.getElementRect(scrollElement)` — **forced
    synchronous layout**, landing after the shadow write in the same task
  - `:2208` `getScrollMetrics(scrollElement)`
  - per heading, until the first one below the fold: `:2215`
    `DOM.source.getElementById(heading.id)` (a **document-wide** `document.getElementById`,
    `core/DOM.ts:2703`), `:2217` `DOM.source.contains(...)`, `:2221`
    `DOM.source.getElementRect(el)` — plus a `Rect` allocation each.
- **Evidence**: probe `markdown.probe.test.ts` (`P5`): a 40-heading document with the
  pane scrolled a third of the way down cost **33 `getElementRect` calls in one
  `findActiveHeading`**, plus 33 `getElementById` and 33 `contains`. At max scroll it
  walks all N. Reading `Panel.installScrollShadows` and `StyleTarget.set` confirms the
  write precedes the read in the same task, so the first rect read is genuinely forced
  rather than served from clean layout.
  The correctness half follows from the code: heading ids are deduped only *within one
  render* (`nextHeadingId:426`, a per-pass `Map`), and are written into the global
  document id space (`appendHeading:1619`). Two `Markdown` instances rendering documents
  that share a heading text both emit e.g. `id="install"`; `getElementById` returns
  whichever comes first in the document, `contains` rejects it for the second viewer,
  and that viewer's every heading is skipped — `findActiveHeading` returns `null`
  forever and the minimap never highlights. In Loom, two Dock panes previewing two
  Markdown files is the ordinary case.
- **Proposed change**: stop resolving headings by id at scroll time.
  `Markdown.appendHeading:1617` already holds each heading's `Handle`; record
  `{id, handle}` per render on the instance and hand that list to the tracker instead of
  a `MarkdownHeading[]`. That removes every `getElementById` and every `contains` call
  and fixes the cross-instance collision. Then cache each heading's offset within the
  scroll content once per render/re-measure (they only move when the content, width,
  max-measure, font scale or theme changes — all of which already have hooks) and resolve
  the active heading from the cached `scrollTop` by binary search: **zero geometry reads
  per scroll tick**, O(log N) instead of O(N). `HeadingScrollTracker` already owns the
  `_lastActiveHeadingId` edge trigger, so nothing downstream changes.
- **Risk / blast radius**: `findActiveHeading` is a public export
  (`component/display/index.ts:20`) with a documented signature and a six-case test
  suite (`Markdown.test.ts:891-973`), including the max-scroll tie-break rules;
  `DocsContent` depends on the same behaviour for a pane that stacks *several* `Markdown`
  blocks plus live demos, so a handle list has to be assemblable from more than one
  instance. Changing the exported signature is a breaking change — the offset-cache
  variant can ship behind the existing signature first.
- **Proof at implement time**: a probe asserting 0 `DOM.source` reads per `trackScroll`
  on a settled pane; and a two-viewer probe asserting each resolves its own heading.

### F25.6 A theme change re-measures undisplayed `Markdown`s and permanently zeroes their cached height

- **Category**: E (work for invisible content), plus a correctness bug
- **Impact**: MEDIUM-HIGH — one theme toggle silently breaks every `Markdown` currently
  on an inactive `Tab`/`Card` page, and it does not recover.
- **Where**: `component/display/Markdown.ts:990-993` (`onThemeChanged`), `:1043-1050`
  (`measureContentHeight` checks only `getElement()`, never `isEffectivelyVisible()`),
  `:741` (the theme subscription), `:972-984` (`setWidth`'s changed-only re-measure is
  the only recovery path, and a re-show changes no width).
- **Hot path**: theme toggle → `ThemeManager.onThemeChange` → `onThemeChanged:991`
  `resyncCodeEditorWidths()` (correctly skips while hidden, `:1275-1278`) → `:992`
  `measureContentHeight()` (**not** skipped) → writes `height:auto` / reads
  `scrollHeight` / writes back, against a `display:none` element. Per
  `docs/concepts/performance.md`, a `display:none` subtree reports every live geometry
  read as zero, so `_measuredHeight` becomes `0`.
- **Evidence**: probe `hidden.probe.test.ts` (`H1`). Measured height 500 → `setDisplayed(false)`
  → `ThemeManager.setTheme(DarkTheme)` → `getMinSize().height` is **0**, with 12 sink
  writes charged to the hidden component. Re-showing and re-committing the same width
  leaves it at **0** — `setWidth`'s `changed` guard never fires, and neither
  `onEffectiveVisibilityChange:1461` nor anything else re-measures.
  Reproduction in Loom: open a Markdown preview, switch back to the source page (the
  `Card` undisplays the preview), toggle the theme, switch back to the preview — the
  preview reports height 0 and the content pane cannot scroll to the document.
- **Proposed change**: give `measureContentHeight` the same
  `isEffectivelyVisible()` guard `resyncCodeEditorWidths` already has, and add a
  re-measure on the rising edge in `onEffectiveVisibilityChange` (which already runs
  and already flushes two other queues). The deferred-measure mechanism from F25.1
  is the natural place to park it.
- **Risk / blast radius**: `Markdown.test.ts:1463-1503` pins "re-measures on theme
  change" and "dispose detaches the theme listener" — the first needs the component
  made effectively visible. The same shape should be checked for the `setMarkdown`
  path (`:913`), which is also ungated but is at least followed by a later `setMarkdown`
  in practice.
- **Proof at implement time**: extend probe `H1` to assert the height survives a hidden
  theme change and is correct after re-show; assert 0 sink writes charged to a hidden
  `Markdown` on a theme toggle.

### F25.7 `setMaxMeasure` and `setFontScale` change the rendered width but never re-measure or re-sync

- **Category**: H (function/implementation mismatch), plus a correctness bug and a
  factually wrong JSDoc
- **Impact**: MEDIUM — every width/zoom step in `MarkdownViewer`'s own control cluster
  leaves the reported content height stale and every live code block at its old pixel width.
- **Where**: `component/display/Markdown.ts:825-830` (`setMaxMeasure`), `:875-880`
  (`setFontScale`), `:1265-1272` (the `resyncCodeEditorWidths` doc comment that claims
  `setWidth` and the theme handler are "the two things that can actually change a
  wrapper's width"); callers `MarkdownViewer.ts:383-391`, `:399-406`, `:414-421`.
- **Hot path**: user clicks Narrower/Wider/Zoom → `stepWidth:385` → `setMaxMeasure` →
  `setElementCSSRule("maxWidth", …)` and nothing else. The prose column narrows, so the
  prose reflows taller and every `ts-ui-md-code-host` wrapper narrows — but
  `measureContentHeight` is never called (it has exactly five callers: `:746`, `:913`,
  `:979`, `:992`, `:1558` — none of them these two setters) and neither is
  `resyncCodeEditorWidths`.
- **Evidence**: probe `markdown.probe.test.ts` (`P4`): after `setMaxMeasure('60ch')`
  and `setFontScale(1.3)`, `measureContentHeight` call count **0**, `resyncCodeEditorWidths`
  call count **0**, live editor widths `[]`. The doc comment at `:1265-1272` asserts the
  opposite of what the code does.
- **Proposed change**: have both setters mark the derived state stale and call
  `scheduleContentMeasure()` (which already coalesces) plus `resyncCodeEditorWidths()`,
  guarded by an unchanged-value check so a repeated `setMaxMeasure(null)` costs nothing.
  An unchanged-value guard is needed anyway: `setElementCSSRule` writes a per-instance
  stylesheet rule, and per slice 02 `StyleTarget` has no last-written-value filter, so
  clicking Narrower at the low bound re-mutates the shared sheet for nothing.
  Correct the `resyncCodeEditorWidths` doc comment.
- **Risk / blast radius**: `Markdown.test.ts:825-889` pins the exact rule values written
  by both setters (including `setFontScale(1)` writing `null`, not `"100%"`), and
  `default-options-fallback.test.ts` pins the defaults. `MarkdownViewer.ts:386-388` and
  `:402-404` already re-hug the floating panels after these calls by hand — once the
  setters own their own invalidation, those manual `placeNextTo` calls become the
  signature-invalidation hook F25.3 needs.
- **Proof at implement time**: a probe asserting one coalesced measure and one resync
  per step, and zero rule writes for a no-op step.

### F25.8 `setMarkdown` has no same-source guard

- **Category**: D, B
- **Impact**: MEDIUM — every Loom preview toggle tears down and rebuilds the whole
  rendered subtree, disposes and re-creates every `CodeEditor`, and re-lexes the source
  (through the quadratic lexer of F25.2) for content that has not changed.
- **Where**: `component/display/Markdown.ts:899-916`. Caller:
  `/home/jika/typescript/loom/src/editor/FileEditor.ts:149` — `showPreview()` calls
  `ensurePreview()` (which constructs with `this._editor.getValue()`) and then
  `refreshPreview()` → `:169` `setMarkdown(this._editor.getValue())` with the identical
  string. `MarkdownViewer.setMarkdown:269-277` forwards unconditionally too.
- **Evidence**: probe `markdown.probe.test.ts` (`P3`). Re-setting an identical
  five-element source: **5 `createElement`, 5 `removeElement`, 5 `release`, 31 sink ops
  total** — a complete teardown and rebuild. `clearContent:1131` additionally bumps
  `_renderGeneration`, disposes every live `CodeEditor`, and drops all four upgrade
  queues, so every fenced block's dynamic-import gate and viewport gate restart from
  scratch (F25.10 is the stylesheet cost of that).
- **Proposed change**: early-return in `setMarkdown` when the source is byte-identical
  to the current one **and** no render-affecting input changed since the last build.
  The one documented escape hatch that depends on re-rendering unchanged source is
  `setLinkResolver`'s ("call `setMarkdown` (with the same source, if needed) to re-render
  links with the new resolver", `:872` and `docs/components/Markdown.md`), so the guard
  must be defeated by a `setLinkResolver` since the last render — a one-field dirty flag
  set in `setLinkResolver:788`. Without that the guard is a behaviour break.
- **Risk / blast radius**: `Markdown.test.ts:1309-1333` asserts that `setMarkdown`
  removes the old nodes and rebuilds; `:197-209` asserts a second `setMarkdown` with
  the same single-heading source re-renders the same id. Both would need the guard's
  dirty-flag semantics spelled out. On the Loom side, the fix is equally available at
  the call site (`FileEditor.refreshPreview`), but the library guard is the one that
  also covers the docs live-preview demo's per-keystroke path
  (`packages/docs/src/demos/markdown-preview.ts:34`).
- **Proof at implement time**: re-run probe `P3` and assert 0 sink ops for an identical
  source, and >0 after an intervening `setLinkResolver`.

### F25.9 `MarkdownViewer` lexes the same source twice and rebuilds the minimap tree unconditionally

- **Category**: D, I
- **Impact**: MEDIUM — doubles F25.2's quadratic parse on every `setMarkdown` and on
  construction; rebuilds and fully re-expands the minimap `Tree` even when the outline
  is identical.
- **Where**: `component/display/MarkdownViewer.ts:172` + `:182` (construction),
  `:270` + `:272` (`setMarkdown`), `:275` → `MarkdownMinimap.setHeadings:272-311`
  (`:307` `setNodes`, `:308` `expandAll`). Same shape in
  `packages/docs/src/shell/DocsContent.ts:387`.
- **Hot path**: `MarkdownViewer.setMarkdown:270` → `Markdown.setMarkdown:911`
  `lexMarkdown(markdown)` (**parse #1**) → `:272` `extractMarkdownHeadings(markdown)` →
  `Markdown.ts:2168` `lexMarkdown(source)` (**parse #2, identical input**) → `:275`
  `_minimap.setHeadings` → rebuild every `TreeNode`, `setNodes`, `expandAll`.
- **Evidence**: read directly; both call sites pass the same string to `lexMarkdown`
  in the same statement sequence. `extractMarkdownHeadings` walks exactly the block-token
  shapes `appendBlockToken` walks (`collectHeadings:2136-2162` vs
  `appendBlockToken:1576-1594`) — a second, parallel token walker maintained alongside
  the renderer, which is also the drift risk the "produces the same id as the rendered
  element" test (`Markdown.test.ts:263-279`) exists to catch.
- **Proposed change**: have `Markdown` collect the headings during the render walk it
  already performs — it mints the id at `appendHeading:1617` anyway — and expose them
  (`Markdown.getRenderedHeadings()`), so `MarkdownViewer` and `DocsContent` read them
  instead of re-lexing. `extractMarkdownHeadings` stays for the no-DOM callers
  (`DocsSidebar.ts:250`). That also supplies the handles F25.5 needs, and retires the
  parallel walker's drift risk. Separately, `MarkdownMinimap.setHeadings` should
  early-return when the new heading list is deep-equal to the current one.
- **Risk / blast radius**: `extractMarkdownHeadings` is a public export with its own
  suite (`Markdown.test.ts:211-279`, `:491-504`); it must keep producing byte-identical
  ids to the render walk — which is easier, not harder, once one walk feeds both.
  `MarkdownViewer.test.ts:281` reads the tracker's headings.
- **Proof at implement time**: assert `lexMarkdown` is entered once per
  `MarkdownViewer.setMarkdown`; assert `Tree.setNodes` is not called for an unchanged
  outline.

### F25.10 One `CodeEditor` per fenced block, never pooled, rebuilt on every render — each minting 51 unreleased stylesheet rules

- **Category**: C (stylesheet-rule growth), G (allocation churn), E
- **Impact**: HIGH cumulative. This is the slice-23 question I was asked to settle.
- **Where**: `component/display/Markdown.ts:1200-1206` (`new CodeEditorClass(...)`),
  `:1218` (`this._codeEditors.push(...)`), `:1131-1155` (`clearContent` disposes them
  all and empties every queue), `:2064`/`:1490` (the per-block queue entries);
  `component/editor/CodeEditor.ts:2069` (`codeEditorTheme(dark)` in the extension list,
  per instance) and `:2644` (again per theme toggle);
  `component/editor/CodeEditor.ts:1726-1762` (`destructor` releases the view, the theme
  subscription and the menu — **nothing releases the `StyleModule` rules**).
- **Answer to the slice-23 question**: a rendered Markdown document creates **exactly one
  `CodeEditor` per fenced block whose info string maps through
  `FENCE_LANG_ALIASES:90-97`** — `js`/`ts`/`jsx`/`tsx`/`mjs`/`cjs`/`json`/`html`/`htm`/
  `sql`/`md`/`markdown`. They are **not pooled**: `applyCodeEditorUpgrade:1200`
  unconditionally constructs a new one and pushes it onto `_codeEditors`, and
  `clearContent:1146-1149` disposes the whole array on every `setMarkdown` and on
  disposal, so the next render constructs a fresh set. The count is bounded at any
  instant by the blocks that have come within `CODE_UPGRADE_LOOKAHEAD_VIEWPORTS` of the
  viewport (`isBlockNearViewport:1337-1343`), not by the document's total — but a reader
  who scrolls the whole document reaches the total, and the 51 rules per mount are never
  reclaimed. So slice 23's "a preview with 15 fenced blocks adds 765 rules" is correct as
  a scroll-through figure, and it **recurs in full on every `setMarkdown`**: in Loom,
  toggling the preview on a README with six supported-language fences ten times mounts
  60 editors and leaks ~3,060 rules onto the shared sheet, after which (per the briefing's
  cost model) every stylesheet mutation anywhere in the app is proportionally more expensive.
- **Evidence**: read of `applyCodeEditorUpgrade`, `clearContent` and `CodeEditor.destructor`;
  the disposal semantics are pinned by `Markdown.test.ts:2137-2216`. The 51-rules-per-call
  figure is slice 23's, not re-derived here.
- **Proposed change**: the durable fix is upstream in slice 23 — hoist `codeEditorTheme()`
  to a module-level singleton pair (light/dark) built once, so N editors share one
  `StyleModule`. Within this slice, two things help independently: (a) F25.8's same-source
  guard removes the whole re-mount cycle for an unchanged document; (b) keep a per-block
  cache keyed on `(text, languageId)` across a `setMarkdown` so a re-render of a document
  whose fenced blocks did not change reuses the existing editors instead of disposing
  and rebuilding them.
- **Risk / blast radius**: `clearContent`'s generation bump is load-bearing for the
  in-flight dynamic import (`loadCodeEditorUpgrade:1520`) and is pinned by
  `Markdown.test.ts:2153-2216`; any reuse cache must not let a stale handle survive a
  rebuild. Coordinate with slice 23 before changing anything in `CodeEditor` itself.
- **Proof at implement time**: `DiagnosticsOverlay`'s stylesheet-rule counter across ten
  preview toggles on a fenced-code-heavy document — it must stay flat.

### F25.11 Every interleaved text run costs a wrapper `<span>`, because the sink has no text-node primitive

- **Category**: H, and a cross-slice gap in `core/DOM`
- **Impact**: MEDIUM — ~31% more elements than the content needs, on a component whose
  whole purpose is to render a document. Node count is what the target engine's restyle
  and layout cost scale with.
- **Where**: `component/display/Markdown.ts:2055-2060` (`appendTextNode`), reached from
  `appendInlineToken:1928` (interleaved text), `:2000` (unsupported-token fallback),
  `appendTextWithBreaks:2073`, and `appendBlockToken:1592` (the block fallback).
  `core/DOM.ts` exposes `text?: string` on `ElementPatch` (`:149`, `:414`) — i.e.
  `textContent` on an element — and no `createTextNode`/`appendText` primitive.
- **Evidence**: probe `dom.probe.test.ts` (`D1`) on the repository's own `README.md`
  (6,020 bytes, 57 top-level tokens): **197 elements created**, of which **62 are
  `<span>`** — every one of them a wrapper for a text run that a text node would carry
  for free. Full tag census:
  `div 4, h1 1, p 16, blockquote 2, strong 7, span 62, h2 6, a 15, code 44, em 1, ul 1,
  li 7, pre 4, table 1, thead 1, tr 8, th 2, tbody 1, td 14`.
  Same run: 197 `createElement`, 199 `apply`, 196 `appendChild`, 25 `ensureStyleRule`,
  26 `setRuleStyles` (the last two are the one-off shared class rules plus the
  component's own, not per block).
- **Proposed change**: add an `appendText(parent, text)` primitive to `DOMSink` (a
  `document.createTextNode` + `appendChild` on the production side, a recorded write
  offline) and use it in `appendTextNode`. Nothing else about the no-HTML-string
  guarantee changes — a text node cannot carry markup by construction.
- **Risk / blast radius**: this is a `core/DOM` seam change (slice 03's territory) and
  needs the modelled source to model text nodes. A large number of `Markdown` tests
  assert on created tags and `{ text }` payloads (`createdTags`, `textWrites` helpers at
  `Markdown.test.ts:32-46`) and would need re-pointing. The gain is structural, so this
  is a standalone plan, not a rider.
- **Proof at implement time**: re-run `D1`; element count for the README should fall
  from 197 to ~135.

### F25.12 `MarkdownMinimap.applyActiveHeading` has no last-applied guard

- **Category**: B, D
- **Impact**: MEDIUM — a full `Tree.selectNode` (linear row scan, selection rebuild,
  style update, scroll-into-view, window re-render) per scroll tick that crosses a
  heading deeper than `maxHeadingDepth`, for an unchanged result.
- **Where**: `component/display/MarkdownMinimap.ts:352-368`, specifically `:357`
  (`_nearestShown.get(id)`) and `:366` (`this._tree.selectNode(node)`);
  `component/tree/Tree.ts:391-408` (`selectNode` is unguarded:
  `_flatRows.findIndex` → clear/add → `_updateSelectionStyle()` → `_scrollIntoView(index)`
  → `renderWindow()` → `_updateActiveDescendant()`).
- **Hot path**: scroll → `findActiveHeading` resolves a *new* id → `HeadingScrollTracker.setActiveHeading:125`
  fires (correctly edge-triggered) → `MarkdownViewer.handleActiveHeadingChange:145`
  → `MarkdownMinimap.applyActiveHeading:352` → `_nearestShown` maps the new id to the
  **same** shown ancestor row (the default `maxHeadingDepth` is 3, so every `h4`+ heading
  maps to its nearest `h3`) → `selectNode` on the node that is already selected.
- **Evidence**: read. `_nearestShown` is built at `:300` precisely to collapse
  out-of-depth headings onto a shown ancestor, so many-to-one is the designed mapping,
  not an edge case. `Tree.selectNode:391` has no `already selected` early return, and
  `_scrollIntoView` can move the minimap's own tree — visible motion for an unchanged
  selection.
- **Proposed change**: record the last applied node (or resolved id) on the minimap and
  early-return when it is unchanged — one field, two lines, entirely local. The upstream
  `Tree.selectNode` guard belongs to slice 18.
- **Risk / blast radius**: `MarkdownMinimap.test.ts` pins the highlight behaviour; a
  guard must still re-apply after `setHeadings` replaces the node objects, so the guard
  has to be cleared there.
- **Proof at implement time**: a probe scrolling through a document with `h4` headings
  under one `h3`, asserting one `selectNode` call rather than one per `h4`.

### F25.13 `measureContentHeight` writes an invalid `height` on the first commit, and four empty style applies on every commit

- **Category**: B
- **Impact**: LOW-MEDIUM — once per `Markdown` for the invalid write; four empty applies
  per measure, i.e. per frame during a horizontal drag.
- **Where**: `component/display/Markdown.ts:1069` (`const restoreHeight = this.getHeight()`)
  and `:1080` (`setElementStyle("height", restoreHeight + "px")`); `Component.getSize:3339`
  returns an object unconditionally, so `getHeight():4185` returns `_height`'s
  uninitialised value rather than the `0` its own fallback intends.
- **Hot path**: `LayoutManager.commitBounds:566` calls `setWidth(width)` **before**
  `setHeight(height)`, so on a component's first commit `measureContentHeight` runs
  with no height ever written.
- **Evidence**: probe `markdown.probe.test.ts` (`P1`) — the restore write is literally
  `{"height":"NaNpx"}`. The browser drops the invalid declaration, leaving the element at
  `height: auto` until `commitBounds`'s own `setHeight` lands a statement later, so it
  self-corrects; the write still reaches the DOM. The same probe shows 4 of 7 applies
  are empty `{}` patches — the `InlineStyle.flushDirty` empty-bag guard gap reported by
  slices 01/03/04, here charged four times per measure.
- **Proposed change**: skip the restore write when no height has been committed yet
  (`getSize()` has no real height), or read the committed height from the same source
  `writeBounds` uses. The empty-apply half is fixed upstream in `InlineStyle.flushDirty`.
- **Risk / blast radius**: none locally; no test asserts the restore write's value.
- **Proof at implement time**: assert no `height` apply whose value fails a
  `/^-?\d+(\.\d+)?px$/` match.

### F25.14 `setWidth`'s changed-guard compares the pre-clamp argument to the post-clamp state

- **Category**: D
- **Impact**: LOW normally; MEDIUM for a `Markdown` with any active width clamp, where
  it turns into a per-frame re-measure with no width change at all.
- **Where**: `component/display/Markdown.ts:973` (`const changed = width !== this.getWidth()`)
  followed by `:975` `super.setWidth(width)`; `Component.setWidth:4055-4056` clamps
  *inside* the setter (`width = this.clampWidth(width)`) and only then compares against
  `_width`.
- **Evidence**: read. When `clampWidth(w) !== w` — a `maxSize`/`minSize` width, or a
  content-derived clamp — `Markdown.setWidth` sees `changed === true` on every commit
  while `Component._width` never moves, so `resyncCodeEditorWidths()` and
  `measureContentHeight()` (F25.1, F25.4) run every frame for nothing. `Markdown`'s own
  defaults set no width clamp, so the common case is safe today; a consumer passing
  `preferredSize`/`maxSize` (the docs demo at `markdown-preview.ts:29` passes
  `preferredSize`) can walk into it.
- **Proposed change**: compare after the super call — `super.setWidth(width)`, then
  `const changed = this.getWidth() !== before` — so the guard tracks the committed value.
- **Risk / blast radius**: `Markdown.test.ts:1381-1430` drives re-measures through
  `setWidth`; all of those pass an unclamped width, so the change is invisible to them.
- **Proof at implement time**: a probe with a `maxSize.width` smaller than the assigned
  width, asserting one measure across ten identical commits.

### F25.15 `Markdown.applyStyle` overrides to re-assert a value the framework's own pass is about to clear

- **Category**: H
- **Impact**: LOW (cold path — `applyStyle` runs from `render:7587`, `setId:1972` and
  `sync:6663`, never per frame), but it is a library workaround for a library ordering
  bug, which the project's own conventions say should be fixed upstream instead.
- **Where**: `component/display/Markdown.ts:860-866`, with the override's own JSDoc
  (`:838-859`) documenting exactly why: `Component.applyStyle`'s size-constraint phase
  also targets `maxWidth`, resolves to the framework baseline for a component with no
  `maxSize`, and *queues a removal* onto the same key `setMaxMeasure` already queued a
  real value for, in the same pass — so `Markdown` re-asserts last to win.
- **Evidence**: the JSDoc states the mechanism; `Markdown.test.ts:825-861` pins the
  resulting rule values.
- **Proposed change**: this belongs to slice 02 — `Component`'s size-constraint style
  phase should not emit a removal for a property another phase set in the same pass, or
  the two should not share the `maxWidth` key. Once fixed, this override deletes.
- **Risk / blast radius**: removing the override without the upstream fix breaks the
  max-measure feature outright.
- **Proof at implement time**: the four `setMaxMeasure`/`getMaxMeasure` tests pass with
  the override deleted.

### F25.16 A heading-less viewer still pays two forced reads per scroll tick

- **Category**: A, D
- **Impact**: LOW — 2 forced reads per scroll event for a document with no headings
  (Loom previews plenty of those), and for the whole first-render window before
  `setHeadings` runs.
- **Where**: `component/display/HeadingScrollTracker.ts:78-94` (no empty-`_headings`
  early return) → `Markdown.ts:2207-2208` (`getElementRect` + `getScrollMetrics` both
  run before the loop is entered).
- **Evidence**: read; `findActiveHeading` performs both reads unconditionally and then
  falls straight out of an empty loop returning `null`.
- **Proposed change**: `if (this._headings.length === 0) return;` at the top of
  `trackScroll`. Subsumed entirely by F25.5's offset cache, so it should ride along
  rather than be planned on its own.
- **Risk / blast radius**: none — `setActiveHeading(null)` on an empty list is already
  a no-op after the first tick.
- **Proof at implement time**: covered by F25.5's zero-read assertion.

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `Markdown` (`Markdown.ts:600-2081`) | Render a Markdown source string as a live DOM subtree, reporting its flowed content height | Root element + every prose node (tracked in `_contentHandles`); its own `#id` rule; 20 shared class rules via the module singleton; **no** per-block rules | **Unchanged width: 0 writes, 0 reads.** Changed width: 7 style applies (4 empty) + 1 forced `getScrollMetrics` + N wrapper reads for N live code blocks + a parent `scheduleLayout()` | over-built (5 responsibilities in one 2,248-line file) | F25.1 F25.4 F25.6 F25.7 F25.8 F25.10 F25.11 F25.13 F25.14 F25.15 |
| `MarkdownViewer` (`MarkdownViewer.ts:120-475`) | Wrap one `Markdown` with a floating minimap and width/zoom controls | Inherits `Panel`; owns `MarkdownContentPane`, `Markdown`, `MarkdownMinimap`, a `FloatingPanel` and 5 `Button`s | **2 `getElementRect` per pass, unconditional** (probe: 20 over 10 identical passes); 35 sink applies per pass, 31 of them empty | mismatch (a `doLayout` override that forces layout on every pass, changed or not) | F25.3 F25.9 |
| `MarkdownContentPane` (`MarkdownViewer.ts:91-95`) | Expose `Panel.getScrollElement()` to a non-subclass | Inherits `Panel` (native `autoScroll: "y"`, scroll shadows) | Its own `Panel` cost; the shadow handler writes on every scroll tick, immediately before F25.5's reads | fits (4 lines, one genuine reason) | — (contributes to F25.5) |
| `MarkdownMinimap` (`MarkdownMinimap.ts:153-380`) | Floating card showing the heading outline as a `Tree`, highlighting the active heading | Inherits `FloatingPanel`; a header `Component`+`Text`, a `Tree`; `ownClassStyleDefaults` chrome (background/shadow/radius/min/max) | Nothing per pass beyond `FloatingPanel`/`Panel`/`Tree`; highlight is edge-triggered, not polled | fits, with one missing guard | F25.12 |
| `HeadingScrollTracker` (`HeadingScrollTracker.ts:26-133`) | Own the scroll→active-heading and scroll-to-heading technique shared by `MarkdownViewer` and `DocsContent` | none | 1 `getScrollTop` when a click pin is live; delegates all geometry to `findActiveHeading` | fits (this is the converged home the 2026-08-29 audit asked for) | F25.5 F25.16 |
| `findActiveHeading` (`Markdown.ts:2206-2245`) | Resolve which heading is at or nearest above the pane top | none | **1 forced layout + up to N `getElementRect` + N document-wide `getElementById` + N `contains`, per scroll event** | mismatch (lives in the render module, is pure scroll geometry, and resolves through a global id space) | F25.5 |
| `extractMarkdownHeadings` / `collectHeadings` / `inlineText` (`Markdown.ts:2098-2175`) | Compute the heading outline with no DOM | none | none (cold) | over-built (a second token walker parallel to the renderer, and a second lex of the same source) | F25.9 |
| `ensureMarkdownClassRules` (`Markdown.ts:169-400`) | Inject the 20 shared prose class rules once | 20 shared-sheet rules | **Zero after the first call** (module flag at `:166`) | fits — a positive to protect | — |
| `markdownExtensions.ts` (`lexMarkdown` + 4 tokenizer extensions) | The library's single lexing seam, with the dialect's extension grammar | none | **O(document²)** — two full-source `split("\n")` per block token | mismatch | F25.2 |
| `markdownTableExtension.ts` (`TABLE_EXTENSION`, `splitRow`, `parseDelimiterRow`, `resolveMergeGrid`) | Parse a whole GFM pipe table with widths and `<<`/`^^` merges in one pass | none | Full-source `split("\n")` per block token (`:168`); the table body work itself is linear and correct | mismatch on the entry scan only | F25.2, dup item 2 below |
| `markdownAttributes.ts` (the `{k=v}` and `\|\|\|` grammar, 12 exports) | One shared, validated grammar for the viewer and the editor | none | none (cold, per-token) | fits — genuinely shared, regex-validated, allow-listed | — |

## Redundant, duplicated and dead code

1. **`HeadingScrollTracker.getHeadings()` has no production caller.**
   `grep -rn --include=*.ts "getHeadings" packages/lib packages/docs packages/create-app /home/jika/typescript/loom/src` →
   5 hits: the declaration (`HeadingScrollTracker.ts:64`) and four test reads
   (`MarkdownViewer.test.ts:281,324,369,415`). Category J. Keeping it as a
   test-observability accessor is defensible; it should say so.

2. **`markdownTableExtension.splitRow` is a self-declared copy of the editor's
   `splitTableRow`.** `markdownTableExtension.ts:47-78` vs
   `component/editor/markdownTableTransformer.ts:40-…`; the viewer copy's own doc comment
   at `:36-38` states "Duplicated rather than imported — `component/display` does not
   reach into `component/editor`." The shared grammar module `markdownAttributes.ts`
   already exists and is imported by both halves — it is the obvious third home neither
   side considered. Category I. (Cross-slice: 24.)

3. **Four prose class rules are duplicated between the viewer and the editor, each side
   commenting that it mirrors the other.** `Markdown.ts:252-260` (`TABLE_CLASS`:
   `borderCollapse/breakInside`) ↔ `editorTheme.ts:162-168`; `Markdown.ts:340-354`
   (`BLOCK_CLASS`, `COLUMN_CLASS`, and the `> :first-child` margin reset) ↔
   `editorTheme.ts:218-255`; `Markdown.ts:394-399` (`IMAGE_CLASS: maxWidth 100%`) ↔
   `editorTheme.ts:257-260`; `UNDERLINE_CLASS` in both. Six of the eight sites carry a
   "Matches the …'s own … rule" comment, i.e. the drift risk is known and accepted.
   Category I. Both files can take the shared declarations from one module without
   sharing class *names* (the `ts-ui-md-` / `ts-ui-mde-` prefixes must stay distinct).
   (Cross-slice: 24.)

4. **The 2026-08-29 health audit's Priority-2 item 7 is closed, with a small residue.**
   The audit reported `MarkdownViewer` and `DocsContent` duplicating ~60 lines of
   scroll tracking. `HeadingScrollTracker` now exists and both hosts delegate to it
   (`MarkdownViewer.ts:148-149`, `packages/docs/src/shell/DocsContent.ts:119-120`).
   What remains duplicated is ~8 lines of unavoidable per-host wiring — a
   `handleNativeScroll` stable-reference field plus an `onNativeScroll`/`scrollToHeading`
   pair that each resolve their own scroll element
   (`MarkdownViewer.ts:137,429-435,444-450` vs `DocsContent.ts:112,584-604`). That is
   the host-specific half and is correctly not shared. **No further action;
   report as closed.**

5. **Options implemented and tested but with zero consumers outside the library.**
   `grep -rn --include=*.ts "\b<name>\b" packages/lib/src packages/docs/src packages/create-app /home/jika/typescript/loom/src`
   (excluding `dist/` and the defining files):
   `maxMeasure` → 3 hits, all the theme token (`BaseTheme.ts:31`, `Theme.ts:706`,
   `Theme.ts:1236`), none the `MarkdownOptions` field; `fontScale` → **0**;
   `showMinimap` → **0**; `showControls` → **0**; `maxHeadingDepth` → **0**;
   `setLinkResolver` → 1 hit, and it is inside a Markdown code-fence *string* in
   `packages/lib/src/typescript/MarkdownPanel.ts:39`, not executable code.
   `isMinimapVisible` / `isControlsVisible` / `getMaxHeadingDepth` appear only in
   `packages/lib/tests/component/display/MarkdownViewer.test.ts` and
   `packages/lib/tests/component/default-options-fallback.test.ts`.
   Category J-adjacent: not dead (the constructors honour them, and `setMaxMeasure` /
   `setFontScale` are the real engine behind `MarkdownViewer`'s control cluster), but
   **unexercised surface**. The live path into the width/zoom feature is the five
   control buttons, not the options bag — so F25.7's missing re-measure has never been
   hit by a consumer, only by a user clicking the buttons.

6. **`MarkdownMinimap` re-expands the whole outline on every `setHeadings`.**
   `MarkdownMinimap.ts:307-308` — `setNodes(roots)` then `expandAll()`. The outline is
   always fully expanded and never collapsible in this UI, so the `Tree`'s expander
   column and its per-row toggle machinery (slice 18 measured one tree expand at
   3 shared-stylesheet mutations + 74 DOM ops) is paid for a control the user can never
   use. Not measured here — flagged for slice 18 to confirm whether `Tree` offers an
   expander-free mode, and for F25.9's deep-equal guard to stop the rebuild entirely
   when the outline is unchanged.

7. **`BLOCK_EXTENSION` has no `start()` hook** (`markdownExtensions.ts:124-177`), unlike
   the three inline extensions in the same file (`:24`, `:53`, `:82`). marked uses
   `start` both to skip impossible positions (F25.2's fix) and to let a block extension
   interrupt a paragraph. Whether the missing interrupt is intentional is **not verified**
   — the table extension is missing one too, yet `Markdown.test.ts:1202` pins that a
   table immediately after a paragraph with no blank line still splits, so the behaviour
   is at least partly covered by marked's own paragraph handling.

## Cross-slice notes

- **→ 11 overlay-popups-layers-animation**: confirmed and quantified. `FloatingPanel.placeNextTo`
  forces a layout per host pass, and `MarkdownViewer.doLayout:220-221` calls it twice —
  probe measured exactly 20 `getElementRect` over 10 identical passes. The fix I propose
  is in the *caller* (a clamp-signature gate, F25.3), which leaves `FloatingPanel`'s
  contract alone; if slice 11 prefers to fix `placeNextTo` itself, the same signature
  is available there. `placeNextTo` also pays slice 28's `getContentInsets()` UUID
  allocation twice per pass.
- **→ 23 editor-code**: answering the question put to me. A rendered Markdown document
  creates **one un-pooled `CodeEditor` per supported-language fenced block**
  (`Markdown.ts:1200`), bounded at any instant by the viewport lookahead gate but
  reaching the document total on a scroll-through, and **rebuilt from scratch on every
  `setMarkdown`** (`clearContent:1146`). Nothing releases `codeEditorTheme()`'s
  `StyleModule`s (`CodeEditor.destructor:1726-1762` releases the view, the theme
  subscription and the menu, not the sheet). So the 51-rules-per-mount figure recurs per
  toggle, not once per document. A module-level light/dark theme singleton in slice 23
  is the fix that scales; F25.8 and F25.10's reuse cache reduce the mount count that
  feeds it.
- **→ 03 core-dom-seam-events**: `DOMSink` has no text-node primitive — `ElementPatch.text`
  (`core/DOM.ts:149`, `:414`) is `textContent` on an element. `Markdown` therefore mints a
  wrapper `<span>` per interleaved text run: **62 of the 197 elements** a 6 KB README
  renders (F25.11). An `appendText(parent, text)` sink method would remove all of them
  with no change to the no-markup guarantee. Also: `MarkdownViewer.ts:195` registers a
  subtree `"scroll"` listener, and `Panel.installScrollShadows:1283` registers another on
  the pane inside it — two subtree registrations for a high-frequency type, feeding
  slice 03's per-event ancestor-walk cost.
- **→ 04 core-panel-scrolling**: `Panel`'s scroll-shadow handler writes inline styles
  through `StyleTarget.set:35` (which flushes immediately when attached) on every scroll
  tick, and `MarkdownViewer`'s subtree scroll handler runs *after* it on the same event —
  which is what makes `findActiveHeading`'s first `getElementRect` a genuinely forced
  layout rather than a clean read (F25.5). Note also that slice 04's "settled overlay
  `Panel` still runs the full live remeasure" did **not** reproduce offline here: my
  10-identical-pass probe recorded **zero** `getScrollMetrics` calls for the
  `MarkdownContentPane`. Either the modelled source short-circuits that path or the
  remeasure is gated on something the probe did not trigger — **not verified** either way.
- **→ 01 core-component-lifecycle**: `Component.getSize():3339` returns an object
  unconditionally, so `getHeight():4185`'s `return 0` fallback is unreachable and an
  uncommitted height reads back as `NaN`/`undefined` — which is how `Markdown` comes to
  write `height: NaNpx` (F25.13). The docs (`concepts/layout-system.md`, "Querying size
  before render") promise `getSize()` returns `null` before layout; it does not.
  Also: `Component.setWidth:4055` clamps inside the setter, which makes the
  compare-then-call guard pattern `Markdown.setWidth:973` uses unsound (F25.14) — worth
  checking every other subclass that overrides an axis setter the same way.
- **→ 02 core-component-styling**: `Markdown.applyStyle:860` exists solely to win a
  same-pass key collision on `maxWidth` between `Component.applyStyle`'s size-constraint
  phase and `setMaxMeasure`'s rule write; the override's own JSDoc (`:838-859`) documents
  the collision. Fixing the phase ordering upstream deletes this override (F25.15).
  `setMaxMeasure:828` and `setFontScale:877` also write per-instance stylesheet rules
  with no unchanged-value guard, which per slice 02's `StyleTarget` finding means a
  clamped step button re-mutates the shared sheet for nothing.
- **→ 18 lists-trees**: `Tree.selectNode:391` has no already-selected early return and
  runs a linear `findIndex` plus `_scrollIntoView` + `renderWindow` on every call.
  `MarkdownMinimap` drives it from scroll (F25.12). The local guard is cheap; the
  upstream guard would help every caller.
- **→ 24 editor-markdown**: three duplications with `component/editor`, all self-declared
  in comments on one or both sides — `splitRow`/`splitTableRow`, four shared prose class
  rules, and the `{k=v}`/`|||` grammar (that last one already correctly shared via
  `markdownAttributes.ts`). `markdownAttributes.ts` is the precedent and the obvious home
  for the other two.
- **Contract this slice relies on that does not hold**: `docs/concepts/layout-system.md`'s
  "a child handed the exact rectangle it already has is not re-laid-out" — `Markdown`
  does not override `canSkipUnchangedLayout`, and per slices 01/05 nothing in the library
  does. `Markdown` is in fact a good candidate to opt in: with F25.1's settle gate and
  F25.14's guard fix, an unchanged rectangle leaves it with genuinely nothing to do
  (probe `P1` already measures 0 writes and 0 reads for an unchanged width).
  `MarkdownViewer` is **not** a candidate while `doLayout` re-hugs unconditionally — that
  is another reason to gate F25.3 on a signature rather than leave it per-pass.

## Suggested plan grouping

**Plan A — "markdown-resize-measure-coalescing"** (F25.1, F25.4, F25.13, F25.14, and
F25.16 riding along). The per-frame story on hot path 1, measurable on its own: make
`setWidth` schedule a coalesced measure instead of running one synchronously, gate it on
the resize settle, split `resyncCodeEditorWidths` into read-all-then-write-all, fix the
pre-clamp guard and the invalid restore write. Depends on nothing outside the slice.
Proof: ms/frame on a Loom horizontal gutter drag with a preview pane; a probe asserting
≤1 style apply and 0 reads per frame during a 10-frame simulated drag. This is the
largest single win in the slice.

**Plan B — "markdown-lexer-linear-scan"** (F25.2 alone). Self-contained in two tokenizer
files, with an unambiguous before/after measurement (the timing table in F25.2) and a
large existing test suite as the safety net. No dependencies. Should ship first — it is
the cheapest fix with the biggest ratio.

**Plan C — "markdown-heading-scroll-cache"** (F25.5, F25.12, and F25.9's heading half).
Have `Markdown` publish the headings *and their handles* from the render walk it already
does; cache their offsets; resolve the active heading from cached `scrollTop`; add the
minimap's last-applied guard. Removes the whole per-scroll-tick geometry walk, fixes the
duplicate-id cross-instance bug, and removes the double lex. Touches the public
`findActiveHeading` signature, so it needs a deprecation shim; `DocsContent` (a
multi-`Markdown` pane) is the second consumer that must keep working. Depends on nothing;
supersedes F25.16 entirely.

**Plan D — "markdown-content-invalidation"** (F25.6, F25.7, F25.8). One coherent theme:
`Markdown`'s derived state (measured height, live editor widths) is invalidated by the
wrong set of inputs. Gate the measure on effective visibility and re-measure on the
rising edge; make `setMaxMeasure`/`setFontScale` invalidate what they actually change,
with unchanged-value guards; add the same-source guard to `setMarkdown` with a
`setLinkResolver` dirty flag. Best done after Plan A, which supplies the deferred-measure
mechanism all three want. Proof: the `H1` probe's height survives a hidden theme change;
`P3` reports 0 sink ops for an identical source; `P4` reports one measure per zoom step.

**Plan E — "floating-panel-hug-signature"** (F25.3). Coordinate with slice 11, since the
choice of where to gate (caller vs `FloatingPanel`) affects `DiagramView` too. If slice
11 fixes `placeNextTo`, this becomes a rider on that plan; if not, it is a small
self-contained `MarkdownViewer` change. Its invalidation hooks come for free from
Plan D's setter work, so sequence it after D if they land together.

**Plan F — "dom-sink-text-node"** (F25.11). A `core/DOM` seam change owned by slice 03,
with `Markdown` as the first and largest beneficiary (−31% elements on a README). Do not
fold it into a Markdown plan — it needs the modelled source to grow text nodes and it
re-points a large number of assertions.

**Rides along, not worth planning**: F25.15 (delete the `applyStyle` override once
slice 02 fixes the `maxWidth` phase collision); dup items 2 and 3 in the section above
(fold into whatever slice 24 does about the viewer/editor split); dup item 1 (a JSDoc
line saying `getHeadings` is a test seam).

---

*Probes for this slice live in `.worktrees/_probes/25-display-markdown/`
(`markdown.probe.test.ts`, `viewer.probe.test.ts`, `hidden.probe.test.ts`,
`dom.probe.test.ts`, `lex.probe.test.ts`, `lex2.probe.test.ts`) and are run with
`PROBE_DIR=.worktrees/_probes/25-display-markdown npx vitest run --config .worktrees/_probes/vitest.probe.config.ts`.
No file in the repository was modified.*
