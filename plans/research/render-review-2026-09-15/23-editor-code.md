# 23 editor-code — render-work review

Paths below are relative to `packages/lib/src/typescript/lib/` unless stated.

## Summary

The central question — how much of the ~15–20 ms/frame a visible editor costs
is the wrapper's — has a clean answer, and it is *almost none*. A probe over
ten identical `setSize` + `doLayout` passes on a mounted `CodeEditor` records
**zero `DOM.source` geometry reads** and only the framework's own four
geometry style writes plus one empty apply. `doLayout` (`CodeEditor.ts:2733`)
never calls `requestMeasure`, never reads the scroller, and writes no style of
its own. The 15–20 ms is the engine laying out CodeMirror's own rendered line
DOM because the box around it changed size; CodeMirror's `ResizeObserver` path
is even self-throttled to one measure per 75 ms
(`@codemirror/view` `DOMObserver`, `dist/index.js:7166-7171`), so this is
engine layout, not CodeMirror JS. The only lever the library holds is whether
the box CodeMirror observes changes at all mid-drag — **F23.2**.

The largest *actual* defects this slice carries are elsewhere:

- **F23.1 (HIGH)** — `codeEditorTheme()` mints two fresh `StyleModule`s and
  **51 CSS rules on every call**, and it is called once per editor and once
  per editor per theme toggle. Rules are appended to the document's single
  `<style>` and never removed; every new editor re-serialises the whole
  accumulated sheet. A `Markdown` preview with 15 fenced code blocks adds 765
  rules and 15 full-sheet rewrites. Stylesheet mutation is the most expensive
  write in the target engine (~195 ms/frame full-document restyle).
- **F23.5 (MEDIUM-HIGH)** — a theme toggle reaches every editor including
  those in `display:none` tabs, so the F23.1 cost multiplies by open tabs,
  not by visible ones.
- **F23.3 (HIGH, `Markdown`-hosted editors only)** — `syncAutoHeight` makes
  **7 live DOM reads on a repeat call and 10 on a shape change, with a
  `setHeight` write in the middle**, once per CodeMirror `geometryChanged`
  update, with no per-frame coalescing.
- **F23.4 (HIGH if shipped)** — the open plan
  `plans/overlay-scrollbars-non-panel.md` step 5 would add
  `commitElementStyle()` + `getScrollMetrics()` to `CodeEditor.doLayout`:
  one forced synchronous layout per visible editor per frame, the exact shape
  that cost ~110 ms/frame in the `ScrollStrip` case.
- **F23.6/F23.7 (MEDIUM)** — every compartment setter reconfigures CodeMirror
  on an unchanged value (probe: 7 unchanged setter calls → 7 reconfigure
  transactions), and every keystroke serialises the whole document to a string
  and compares it character-by-character (probe: 0.41 ms/keystroke at 1 MB vs
  0.006 ms for the rope-native `Text.eq`).

---

## Findings

### F23.1 `codeEditorTheme()` mints 51 fresh CSS rules per editor and per theme toggle, and never releases them

- **Category:** C (stylesheet-rule write), E (work for invisible content), I (duplication), H
- **Impact:** HIGH — per editor instance and per theme change, multiplied by
  open tabs and by fenced code blocks in a rendered Markdown document
- **Where:** `component/editor/theme.ts:68` (`codeEditorTheme`), `:67` (`EditorView.theme`),
  `:222` (`HighlightStyle.define`); `component/editor/CodeEditor.ts:2069`
  (mount-time call), `:2644` (theme-change call)
- **Hot path:**
  - construction → `CodeEditor.mount()` (`CodeEditor.ts:2009`)
  - → `this._themeCompartment.of(codeEditorTheme(dark))` (`:2069`)
  - → `EditorView.theme(spec, {dark})` → `StyleModule.newName()` + `new StyleModule(...)`
    (`@codemirror/view/dist/index.js:8741-8747`)
  - → `HighlightStyle.define([...])` → a second `StyleModule`
  - → `new EditorView(...)` → `mountStyles()` (`@codemirror/view` `:7923`, `:8303-8306`)
  - → `StyleModule.mount(root, modules)` → `StyleSet.mount` →
    `this.styleTag.textContent = <every module's rules, concatenated>`
    (`node_modules/style-mod/src/style-mod.js:105-140`)
  - and separately: `ThemeManager.onThemeChange` → `CodeEditor.onThemeChange` (`:2637`)
    → `_themeCompartment.reconfigure(codeEditorTheme(dark))` (`:2644`)
    → `EditorView.update` sees a new `styleModule` facet identity
    (`@codemirror/view` `:8016-8017`) → `mountStyles()` again
- **Evidence:** probe `theme-duplication.test.ts`:
  - `one codeEditorTheme(false) call => 2 StyleModules, 51 CSS rules` (36 chrome + 15 highlight)
  - `shared modules between two identical calls: 0 of 2`; the generated prefixes
    differ (`.ͼ14 {height: 100%; …}` vs `.ͼ1k {height: 100%; …}`), so the two
    sets are byte-identical apart from the class name
  - `highlight rule text identical across dark flag: true` — the
    `HighlightStyle` half is a fixed IDE palette that does not read `dark` at
    all, so it is rebuilt per instance and per theme toggle for no reason
  - `style-mod`'s own module doc states the contract this violates: *"Style
    modules should be created once and stored somewhere… to avoid leaking
    rules, don't create these dynamically, but treat them as one-time
    allocations."*
  - the non-`adoptedStyleSheets` path (`document`, which has a `head`) rewrites
    `styleTag.textContent` with the **entire** accumulated rule text on every
    `mount`, so each new editor re-serialises and re-parses everything already
    there.
  - `component/display/Markdown.ts:1191-1194` builds one `CodeEditor` per
    fenced code block, so the multiplier is code blocks, not just file tabs.
- **Proposed change:** hoist the two `StyleModule`-producing calls to module
  scope. `codeEditorTheme` becomes a lookup over two lazily-built constants
  (`_lightChrome`, `_darkChrome`) plus **one** shared
  `syntaxHighlighting(HighlightStyle.define([...]))` constant, since the
  highlight half is `dark`-independent. Every editor then shares the same two
  module identities; `StyleModule.mount` finds them already present and appends
  nothing, and `mountStyles` on a theme toggle swaps between two already-mounted
  modules instead of minting a third.
- **Risk / blast radius:** `codeEditorTheme` has no importer outside
  `CodeEditor.ts` (`grep -rn codeEditorTheme packages/ /home/jika/typescript/loom/src` →
  only `theme.ts` and `CodeEditor.ts`). The only behavioural coupling is
  CodeMirror's `theme` facet carrying the prefix class: sharing one prefix
  across editors is exactly what a normal CodeMirror app does. The existing
  `editorTheme.multicolumn.test.ts` covers `editorTheme.ts` (the Lexical map),
  not this module; no test pins per-instance identity.
- **Proof at implement time:** `document.styleSheets`-derived rule count after
  mounting *n* editors, expected flat instead of `51n`; plus the diagnostics
  overlay's *stylesheet rules* readout across two theme toggles with 6 tabs
  open (today: +612 rules, after: +0).

---

### F23.2 The wrapper adds nothing measurable per layout pass — the remaining 15–20 ms is engine layout of CodeMirror's box, and the only lever is not resizing that box mid-drag

- **Category:** D (avoidable layout pass), F (paint/layout-heavy)
- **Impact:** HIGH — this is the whole measured per-editor budget on hot path 1
- **Where:** `component/editor/CodeEditor.ts:2733-2745` (`doLayout`),
  `:1943-1953` (`onEffectiveVisibilityChange`), `:2332-2340` (`syncAutoHeight`'s guard),
  `theme.ts:69-73` (`"&": { height: "100%" }`)
- **Hot path:**
  - `Split.flushDrag` → `doLayout()` cascade → `Tab`/`Dock` → `LayoutManager.commitBounds`
  - → `editor.setSize(w, h)` → `Component.writeBounds` → inline `width`/`height` on the editor div
  - → `editor.doLayout()` → `super.doLayout()` (Anchor over 0 or 1 laid-out children)
    → `this.getInnerSize()` → `this._searchPanel.fitWithin(...)` (early-returns when hidden)
  - → **the engine** relays out `.cm-editor` (`height: 100%`) → `.cm-scroller` →
    `.cm-content` → every rendered `.cm-line` + the gutters
- **Evidence:** probe `layout-pass-cost.test.ts`, 10 identical
  `setSize(600,400)` + `doLayout()` passes on a mounted editor with the search
  panel closed:
  `sink ops: 50 (all "apply"); source reads: isConnected=10` — i.e. **5 applies
  and 1 non-geometry read per pass, zero live geometry reads**. The 5 applies
  are `{left}`, `{width}`, `{top}`, `{height}` and one empty `{style:{}}` —
  the `Component.setSize`/`applyBounds` shape slices 01 and 03 already
  reported, not the editor's own. Separately: `doLayout` contains no
  `requestMeasure` call (`grep -n requestMeasure component/editor/*.ts` → one
  hit, `CodeEditor.ts:1950`, inside `onEffectiveVisibilityChange`), so the
  brief's hypothesis *"a measure requested on every pass even when the size did
  not change"* is **not** what is happening. Nor is *"a forced read of the
  scroller"* or *"a style write that dirties layout before CodeMirror
  measures"* — both exist, but only inside `syncAutoHeight`, which returns at
  its first guard (`:2336-2338`) whenever `autoHeightMaxRows` is unset, which
  is every editor Loom builds (`/home/jika/typescript/loom/src/editor/FileEditor.ts:81`
  passes only `language`). CodeMirror's own resize path is additionally
  self-throttled: its `ResizeObserver` callback runs `onResize()` only when
  `docView.lastUpdate < Date.now() - 75`
  (`@codemirror/view/dist/index.js:7166-7171`).
- **Proposed change:** decouple the box CodeMirror observes from the box the
  framework commits, for the duration of a continuous resize. Concretely: keep
  a `_viewBox: Size | null`; in `doLayout`, commit the outer element as today
  but write an explicit pixel `width`/`height` onto the mounted `.cm-editor`
  element (it currently takes `height: 100%` from `theme.ts:70` and its width
  implicitly), refreshing that inner box only from a settle callback — the
  two-hop `Component.afterNextLayout` relay standardised by
  `plans/implemented/resize-settle-afternextlayout-uplift.md`. The editor's own
  box already carries `overflow: auto` (`:252`), so a momentarily stale inner
  box clips rather than overflows. With `lineWrap` off — the default, and
  Loom's setting — the rendered text is width-independent, so a width-only
  drag is *visually identical*; a height drag letterboxes until settle.
- **Risk / blast radius:** this is the one change in the slice with a visible
  tradeoff, and it must be A/B'd on the real shell before it ships. It changes
  nothing about the public API. `Markdown`'s auto-height code-block editors
  drive their own height via `setAutoHeight` and would need the settle path to
  reconcile with `syncAutoHeight` (see F23.3) rather than fight it. No existing
  test pins mid-drag inner-box geometry (the offline harness never mounts an
  `EditorView`).
- **Proof at implement time:** ms/frame on the 2×2 editor-grid horizontal drag
  in the real WebKitGTK shell, with 1, 2 and 4 visible editors, so the
  per-editor slope is visible. Expected: the ~15–20 ms per visible editor
  collapses to one settle-frame measure.

---

### F23.3 `syncAutoHeight` makes 7–10 live DOM reads per CodeMirror geometry update, with a style write between two read groups, and is not coalesced per frame

- **Category:** A (forced sync read on a hot path), D
- **Impact:** HIGH for every `Markdown`-hosted editor (Loom's Markdown preview
  builds one per fenced code block); inert for a plain file editor
- **Where:** `component/editor/CodeEditor.ts:2332` (`syncAutoHeight`), `:2339`
  (`getScrollMetrics`), `:2361` (`querySelector` for `.cm-line`), `:2247-2270`
  (`measureContentExtent` — a second `querySelector` plus two
  `getElementRect`), `:2473` (`setHeight` probe commit), `:2475` (second
  `getScrollMetrics`, **after** that write), `:2500-2501` (two more
  `getElementRect`), `:2531` (`getOffsetSize`); driven from `:2103-2105`
- **Hot path:**
  - any ancestor resize (or a CodeMirror settling pass)
  - → CodeMirror `measure()` → `updateListener` (`CodeEditor.ts:2085`)
  - → `update.heightChanged || update.geometryChanged` (`:2103`)
  - → `syncAutoHeight(...)` → the read/write sequence above
  - → `setAutoHeight` (`:2597`) → `setHeight` + `setPreferredSize` →
    `scheduleLayout()` on the parent → `Markdown.handleCodeEditorHeightChange`
    (`component/display/Markdown.ts:1233`) writes the wrapper height and calls
    `scheduleContentMeasure()`
- **Evidence:** probe `autoheight-reads.test.ts`, one editor with
  `autoHeightMaxRows: 20`, `DOM.source` instrumented per call:
  - `first call (shape change): getElementRect=5, getScrollMetrics=2, getOffsetSize=1, querySelector=2` — **10 live reads**, with `setHeight` (`:2473`) sitting between read group 1 and read group 2
  - `second call (unchanged shape): getElementRect=3, getScrollMetrics=1, getOffsetSize=1, querySelector=2` — **7 live reads**
  - The method's own doc (`:2314-2331`) states the write-then-read is
    deliberate ("the content-only height is committed FIRST, forcing a real
    layout pass … the reserve is measured against that"). That is correct as
    designed; the defect is the **frequency**, not the ordering. The code's own
    comment at `:2521` notes "CodeMirror's own settling fires one almost
    immediately", i.e. the method is re-entered repeatedly against an unchanged
    shape, paying 7 live reads each time to conclude nothing changed.
  - The two `querySelector` calls per call (`.cm-line`, `:scope > :last-child`)
    are selector matches against CodeMirror's live content, not id lookups.
- **Proposed change:** two mechanisms, independently measurable.
  1. **Coalesce.** Replace the direct call at `:2104` with a
     `scheduleAutoHeightSync()` that arms the standard two-hop
     `Component.afterNextLayout` settle relay (the shape all three sites in
     `resize-settle-afternextlayout-uplift` now use), collapsing N CodeMirror
     geometry echoes per frame into one sync per settled frame. The
     `pureSelectionChange` flag becomes sticky-AND across the coalesced window
     so its rejection semantics survive.
  2. **Batch the reads.** `metrics`, `lineElement`'s rect,
     `measureContentExtent`'s two rects and `getOffsetSize` can all be taken in
     one read phase before the probe `setHeight`; only the post-probe
     `getScrollMetrics`/`getElementRect` pair genuinely depends on the write.
     That takes the unchanged-shape path from 7 reads to 5 and the shape-change
     path from "reads, write, reads" to "reads, write, 2 reads".
- **Risk / blast radius:** ~40 existing tests pin this method
  (`packages/lib/tests/component/code-editor.test.ts:388-1318`), several
  asserting *call counts* on `setHeight` and `"heightchange"` emission
  ("is idempotent: a second call with unchanged inputs makes no further
  setHeight/emit calls", `:815`). Coalescing changes *when* those calls
  happen, not how many per settled shape, but every one of those tests drives
  `syncAutoHeight()` directly and would need the relay flushed. `Markdown`
  (slice 25) is the only production consumer of auto-height.
  Audit item `plans/research/codebase-health-audit-2026-08-29.md:59` ("strands
  an uncommitted height with no `heightchange` emitted") reads as **closed**:
  the `desired === previousHeight` branch at `:2537-2551` now reconciles the
  probe commit, and every remaining early return (`:2553`, `:2570`) is gated on
  `!shapeChanged`, i.e. on a path that committed no probe.
- **Proof at implement time:** a probe asserting ≤1 `syncAutoHeight` per
  settled frame under N synthetic `geometryChanged` updates; and
  `getScrollMetrics` + `getElementRect` calls per frame during a real
  WebKitGTK drag of a Markdown preview holding 15 fenced blocks.

---

### F23.4 The open `overlay-scrollbars-non-panel` plan would add one forced synchronous layout per visible editor per frame

- **Category:** A, D
- **Impact:** HIGH — if implemented as written, on hot path 1
- **Where:** `plans/overlay-scrollbars-non-panel.md:215` (step 5), against
  `component/editor/CodeEditor.ts:2733`
- **Hot path:** the plan's step 5 specifies
  `doLayout() { super.doLayout(); this.commitElementStyle(); this._overlayBars?.layout(0, 0, this.getWidth(), this.getHeight()); }`,
  and its *Internal Structure* (`:158-163`) has `apply()` "Read
  `m = DOM.source.getScrollMetrics(scroller)` once". That is a style commit
  immediately followed by a live scroll-metrics read of `.cm-scroller`, inside
  `doLayout`, i.e. **per layout pass per visible editor**. The plan even
  explains why the write must precede the read (`:215`), so the interleaving is
  load-bearing, not incidental.
- **Evidence:** this is the identical shape the briefing records as already
  fixed elsewhere — "One such read per visible tab strip per frame cost
  ~110 ms/frame in a 2×2 editor grid (fixed 2026-09-15)" — and the same shape
  slice 04 found still live in `Panel` ("10 identical commits → 20
  `getScrollMetrics`, i.e. 2 forced sync layouts per frame"). My own probe
  (F23.2) shows `CodeEditor.doLayout` currently makes **zero** such reads, so
  this plan would introduce the regression rather than compound an existing one.
- **Proposed change:** do not contradict the plan's design — its architecture
  (a composed `OverlayScrollbars` helper over a callback seam) is sound. Add
  one requirement to it before implementation: `apply()` must be gated the way
  the merged `scroll-strip-deferred-resync` fix gates `ScrollStrip.layoutItems`
  — a clamp-signature check on the band `(x, y, width, height)` plus the last
  pushed metrics, so an unchanged band performs **no** `getScrollMetrics` read
  at all, with a settle-frame catch-up for the content-changed-but-band-didn't
  case (the plan's own `sync()` entry point is already the right hook). The
  plan's expected-behaviour case 6 ("Non-positive band is a no-op —
  `layout(0,0,0,0)` performs no `getScrollMetrics` read") shows the author
  already accepts read-skipping as a contract; this extends it to the unchanged
  band.
- **Risk / blast radius:** none today (not implemented). Flagging it now is
  cheaper than measuring the regression after it lands.
- **Proof at implement time:** the plan's own `OverlayScrollbars.test.ts`
  should carry a case asserting zero `getScrollMetrics` calls across 10
  identical `layout()` calls, mirroring the `ScrollStrip.resizeResyncCoalescing`
  test shape.

---

### F23.5 A theme change reaches every editor, including those whose tab is `display:none`

- **Category:** E (work for invisible content), C
- **Impact:** MEDIUM-HIGH — per theme toggle, multiplied by *open* tabs and by
  every `Markdown` code block ever upgraded, visible or not
- **Where:** `component/editor/CodeEditor.ts:694`
  (`ThemeManager.onThemeChange(() => this.onThemeChange())`), `:2637-2645`
  (`onThemeChange`, guarded only on `_view`)
- **Hot path:**
  - `ThemeManager.setTheme(...)` → every registered listener
  - → `CodeEditor.onThemeChange()` on each editor, hidden or not (`:2637`)
  - → `_view.dispatch({ effects: _themeCompartment.reconfigure(codeEditorTheme(dark)) })` (`:2644`)
  - → 51 new rules (F23.1) → CodeMirror `mountStyles()` → full `<style>` rewrite
  - → a full-document restyle in the target engine, once per editor
- **Evidence:** the subscription is created unconditionally in the constructor
  and the handler's only guard is `if (!this._view) return` (`:2638-2640`). A
  `display:none` editor still holds a live `_view`, and a CodeMirror
  `dispatch` works regardless of display state. `onEffectiveVisibilityChange`
  (`:1943`) has the withhold-and-flush shape *for measurement* but does nothing
  for theming. The precedent the doc comment itself names —
  `Markdown.onEffectiveVisibilityChange`,
  `AbstractCanvasSurface.onEffectiveVisibilityChange` — is exactly the pattern
  that should cover this too.
- **Proposed change:** in `onThemeChange`, when
  `!this.isEffectivelyVisible()`, set a `_themeDirty` flag and return; flush it
  from `onEffectiveVisibilityChange(true)` alongside the existing
  `requestMeasure()`. Once F23.1 makes the theme objects process-wide
  constants, the reconfigure is a cheap facet swap and this becomes a small
  extra win rather than the main one — but it also caps the pathological case
  (20 open tabs, user toggling theme).
- **Risk / blast radius:** a hidden editor would render with the previous
  theme's chrome for the duration it stays hidden — invisible by construction.
  The syntax palette is theme-independent (`theme.ts:14-21`), so only the
  chrome and CodeMirror's `dark` heuristics lag. No test covers theme change
  on a hidden editor.
- **Proof at implement time:** stylesheet rule count and main-thread time for
  one theme toggle with 1 vs 10 open editor tabs; expected flat instead of
  linear.

---

### F23.6 Every compartment setter reconfigures CodeMirror on an unchanged value; `setValue` replaces the document with identical text; `setLanguage` re-imports and re-parses on the same id

- **Category:** B (unchanged-value write), D
- **Impact:** MEDIUM — per setter call; `setLanguage` is on Loom's
  file-rename / tab-rebind path (`/home/jika/typescript/loom/src/editor/FileEditor.ts:230`)
- **Where:** `component/editor/CodeEditor.ts:749` (`setValue`), `:806`
  (`setLanguage`), `:893` (`setReadOnly`), `:921` (`setLineWrap`), `:947`
  (`setPlaceholder`), `:975` (`setHighlightWhitespace`), `:1006` (`setLint`),
  `:1037` (`setTabSize`), `:1066` (`setLineNumbers`), `:1094` (`setSpellcheck`)
- **Hot path:** `FileEditor.setPath(path)` → `this._editor.setLanguage(languageForPath(path))`
  → `refreshLint()` dispatch → `getLanguage(id).loadExtension()` →
  `_langCompartment.reconfigure(extension)` → CodeMirror rebuilds its extension
  configuration and re-parses the document from scratch.
- **Evidence:** probe `setter-noop.test.ts`:
  - `7 unchanged-value setter calls => 7 CodeMirror reconfigure transactions`
  - `setLanguage(same id) => 1 loadExtension call(s), 2 dispatch(es) (1 lint + 1 grammar)`
  - `setValue(identical text) => 1 whole-document replace transaction(s)` with
    `changes: {"from":0,"to":1,"insert":"x"}`
  - By contrast `format()` *does* carry the guard: `applyFormatted` (`:1471`)
    returns early when `formatted === this.getValue()`, with a doc comment
    explaining exactly why ("no transaction, so no re-render, no undo entry,
    and no `"change"` event"). The same reasoning applies to `setValue`, and
    the `CodeEditor.md` doc page already promises it for `format()` only.
  - `mount()` additionally runs one guaranteed no-op reconfigure at startup:
    `setLanguage(language)` (`:2229`) → `refreshLint()` → with `lint` false,
    `_lintCompartment.reconfigure([])` (`:855`) on a compartment already
    holding `[]` (`:2078`).
- **Proposed change:** add the same-value early return each setter's sibling in
  `Component` already has. `setValue` guards on `value === this.getValue()`
  when a view is mounted (matching `applyFormatted`'s precedent, so the dirty
  flag and `"change"` semantics stay identical — an identical text is by
  definition not a change). `setLanguage` guards on
  `id === this._options.language` *and* a mounted view, so the pre-mount cache
  write still happens. The rest guard on their own `_options` field.
- **Risk / blast radius:** `setValue`'s guard is the only one with a subtle
  edge: a caller relying on `setValue(sameText)` to reset the selection to the
  document start would see a behaviour change. `CodeEditor.md`'s "Common
  methods" table describes it only as "Read or replace the whole document", and
  the dirty-state section describes an equality-based contract, so the guard
  matches the documented behaviour. The offline tests
  (`code-editor.test.ts:106`, `:290`, `:364`) drive `setValue` with *changed*
  text and would be unaffected; `:290` ("offline setValue leaves isDirty()
  unchanged") has no mounted view.
- **Proof at implement time:** a probe asserting zero `dispatch` calls for each
  setter handed its current value, and one `dispatch` when handed a new one.

---

### F23.7 Every keystroke serialises the whole document to a string and compares it character-by-character, for a payload the target app discards

- **Category:** G (allocation churn), H
- **Impact:** MEDIUM — per keystroke, scaling linearly with document size
  (Loom opens files up to 5 MiB: `/home/jika/typescript/loom/src/data/workspace.ts:34`)
- **Where:** `component/editor/CodeEditor.ts:2089`
  (`this.onDocChange(update.state.doc.toString())`), `:1519-1525` (`onDocChange`),
  `:520-527` (`_cleanValue`), `:776-781` (`markClean`)
- **Hot path:**
  - keystroke → CodeMirror transaction → `updateListener` (`:2085`)
  - → `update.docChanged` → `update.state.doc.toString()` — one full rope walk,
    one full-length string allocation
  - → `onDocChange(value)` → `this.setDirty(value !== this._cleanValue)` —
    one full-length string comparison
  - → `this.emit("change", { value })` — the string is handed to listeners
- **Evidence:** probe `keystroke-doc-cost.test.ts` (node/V8; the target engine
  is slower):
  - `document: 0.97 MB, 20000 lines` — `toString() + full string compare:
    0.407 ms per keystroke` vs `doc.eq(cleanDoc): 0.006 ms per keystroke`
    (**72×**), plus ~2 MB of UTF-16 allocated and immediately discarded per keystroke
  - `document: 100 KB, 2000 lines` — `0.0274 ms` vs `0.0020 ms`
  - `@codemirror/state`'s `Text.eq` (`dist/index.js:53-65`) short-circuits on
    identity, length and line count, then uses `scanIdentical` to skip shared
    rope nodes — so an ordinary insert answers in O(1) and an undo-back-to-clean
    in O(shared structure).
  - The payload is unused by the only production consumer:
    `/home/jika/typescript/loom/src/editor/FileEditor.ts:112,120` —
    `private handleChange = (): void => { this.schedulePreviewRefresh() }`,
    which takes no argument.
- **Proposed change:** hold the clean point as a CodeMirror `Text`
  (`_cleanDoc`) rather than a `string`, and decide dirtiness with
  `!update.state.doc.eq(this._cleanDoc)`. For the event payload, emit an object
  whose `value` is a lazy accessor (`{ get value() { return doc.toString(); } }`)
  so a listener that reads it pays the serialisation and one that ignores it
  pays nothing. `_options.value` (`:1520`) can be invalidated rather than
  eagerly rewritten, with `getValue()` (`:734`) already preferring the live
  view when mounted.
- **Risk / blast radius:** `CodeEditorChange.value` is public
  (`CodeEditor.ts:42`, exported from the barrel), so a getter must be
  indistinguishable to a property read — it is, for every consumer that does
  not `JSON.stringify` or spread the payload. `markClean()` and the ~20
  dirty-state tests (`code-editor.test.ts:200-387`) drive `onDocChange(string)`
  directly against a stubbed view with no real `Text`, so `onDocChange` must
  keep accepting a string for the offline path while the mounted path uses the
  rope compare; that is the same split `readCursorPosition`/`readSelection`
  already use (pure-over-state helpers plus a thin live caller).
- **Proof at implement time:** allocation delta and ms/keystroke on a 1 MB file
  in the real shell, held-key autorepeat; and a probe asserting `doc.toString`
  is not called when no `"change"` listener reads `value`.

---

### F23.8 The read-only rejection overlay is mounted in every editor for the component's whole life, for an event with zero listeners anywhere

- **Category:** E, F, J
- **Impact:** MEDIUM — one always-present, full-box, absolutely positioned
  stacking context per visible editor, re-resolved on every ancestor resize
- **Where:** `component/editor/CodeEditor.ts:2146` (unconditional
  `mountFlashOverlay(element)` in `mount`), `:2610-2635` (`mountFlashOverlay`),
  `:2686-2699` (`flashReadOnly`), `:2656-2684` (`onEditIntent` /
  `signalReadOnlyEdit`), `:2117-2122` (the three `domEventHandlers` that feed it)
- **Hot path:** `mount()` → `mountFlashOverlay` → a `<div>` with
  `position: absolute; inset: 0; z-index: 400; background-color: var(--ts-ui-validation-error-border, #dc2626); opacity: 0; pointer-events: none`
  appended to the editor element. `opacity < 1` plus `z-index` makes it a
  stacking context; `inset: 0` makes it exactly viewport-of-the-editor sized,
  so its box is re-resolved against the containing block on every frame of an
  ancestor resize. Per the briefing's cost model, an *off-screen* absolutely
  positioned subtree is nearly free during ancestor resizes — this one is not
  off-screen, it is exactly on top.
- **Evidence:** `readonlyedit` has zero listeners in the entire workspace:
  `grep -rn readonlyedit packages/lib/src packages/docs/src packages/create-app /home/jika/typescript/loom/src`
  → 1 hit, the declaration in `CodeEditor.ts` itself (the only other hits are
  generated API markdown under `packages/docs/dist/api/`). `tests:0`. The
  overlay is still reachable as a *visual* cue for read-only editors, and
  `Markdown`'s fenced-code editors are `readOnly: true`
  (`component/display/Markdown.ts:1192`), so the feature is not dead — but it
  is inert for every non-read-only editor, which is every editor Loom builds.
- **Proposed change:** build the overlay lazily on the first
  `flashReadOnly()` call and release it when the animation settles, or at
  minimum gate `mountFlashOverlay` on `this.getReadOnly()` at mount time and
  create it from `setReadOnly(true)` otherwise. The three
  `domEventHandlers` (`:2117-2122`) can stay — they are `false`-returning
  observers and cost nothing until an edit is attempted.
- **Risk / blast radius:** `destructor` (`:1726`) already cancels
  `_flashAnimation` before `super.destructor()` releases handles; a lazily
  created overlay must be tracked via `trackHandle` the same way (`:2611`).
  No test covers the overlay's presence.
- **Proof at implement time:** DOM node count per editor (one fewer), and
  ms/frame on the 2×2 grid drag with and without the overlay present —
  measurable in isolation by toggling the mount call.

---

### F23.9 `overflow: "auto"` is set on the editor's own box purely to make `Component.refreshWheelScrolling` attach — a seam that already exists on the sibling method

- **Category:** H (function/implementation mismatch), I (duplication), F
- **Impact:** MEDIUM — one extra scrollable render layer per editor, and a
  style the component explicitly does not want
- **Where:** `component/editor/CodeEditor.ts:239-252` (`_defaultCodeEditorOptions`,
  with a 12-line comment explaining that the style is inert and is set only to
  trigger an internal behaviour); `core/Component.ts:4852-4861`
  (`refreshWheelScrolling`), `:4491-4516` (`ownsNativeScroll`)
- **Evidence:** the two methods answer the same question and disagree.
  `ownsNativeScroll` (`Component.ts:4510-4515`) already tests
  `this.getScrollElement() !== element` **before** falling back to the
  own-overflow test — the exact condition `CodeEditor` satisfies, since its
  `getScrollElement` override (`CodeEditor.ts:1923`) returns `.cm-scroller`.
  `refreshWheelScrolling` (`:4852-4854`) tests only own-overflow, so the editor
  has to fake the overflow to get past it. The comment at `CodeEditor.ts:241-251`
  documents the whole workaround, including its own admission that the style is
  "inert as a style". In the target engine an `overflow: auto` box acquires a
  scrollable area and a render layer whether or not it ever scrolls.
- **Proposed change:** give `refreshWheelScrolling` the same first clause
  `ownsNativeScroll` has (`getScrollElement() !== getElement()`), then drop
  `overflow: "auto"` from `_defaultCodeEditorOptions` and let `CodeEditor`
  inherit `Component`'s `overflow: hidden` default. `Panel`'s overlay mode is
  named in the same comment as the precedent for the workaround; it would keep
  its current behaviour unchanged, since its own overflow really is `auto`.
- **Risk / blast radius:** `refreshWheelScrolling` is called from every
  overflow setter and from `applyStyle` (`Component.ts:6032`); widening its
  predicate attaches a wheel scroller to any component that overrides
  `getScrollElement`. `grep -rn "protected getScrollElement" packages/lib/src`
  shows `Panel` and `CodeEditor` as the overriders, both of which already want
  it. `TextArea` would join if the `overlay-scrollbars-non-panel` plan lands.
  This is a `Component` change, so it belongs with slice 01/03 — see
  *Cross-slice notes*.
- **Proof at implement time:** a probe asserting the wheel scroller attaches to
  a `CodeEditor` with `overflow: hidden`; and render-layer count / ms/frame on
  the 2×2 grid drag.

---

### F23.10 A wheel tick over the editor costs four `getScrollMetrics` reads of `.cm-scroller` plus a per-ancestor `matches()` climb; the eased scroll then writes-and-reads the scroller every frame

- **Category:** A, G
- **Impact:** MEDIUM — per wheel event and per eased-scroll frame; scrolling a
  document is the editor's most frequent interaction after typing
- **Where:** `component/editor/CodeEditor.ts:1980-2003` (`isForeignWheelTarget`),
  `:289-302` (`hasWheelExtent`); `core/Component.ts:4950-4979` (`onWheelScroll`),
  `:4588-4614` (`getMaxScrollLeft`/`getMaxScrollTop`), `:4903-4916`
  (`writeNativeScroll`); `core/SmoothScroller.ts:152-157`, `:220-221`
- **Hot path:**
  - `wheel` → `Event`'s window capture listener → subtree walk → `Component.onWheelScroll`
  - → `CodeEditor.isForeignWheelTarget(e)` → `DOM.source.intern` + `DOM.source.matches(handle, ".cm-tooltip")`
    + `DOM.source.getParentElement` per ancestor from the target up to the editor root
    (typically `.cm-line` → `.cm-content` → `.cm-scroller` → `.cm-editor` → root = 4–5 hops),
    plus one `climbed: Handle[]` array allocated per wheel event (`:1986`)
  - → `getMaxScrollLeft()` + `getMaxScrollTop()` → **2 × `getScrollMetrics(.cm-scroller)`**
  - → `SmoothScroller.scrollBy` → `clamp("x")` + `clamp("y")` → **2 more `getScrollMetrics`**
  - → per ease frame: `write("x")` then `write("y")` →
    `Component.writeNativeScroll` → `DOM.sink.apply({scrollTop})` **immediately
    followed by** `DOM.source.getScrollTop(element)` — a write-then-read of the
    same element in the same task, per axis, per frame, for the ease's duration
- **Evidence:** read directly from the sources cited. `getMaxScrollTop`
  (`Component.ts:4605-4613`) is a bare `getScrollMetrics` with no cache;
  `onWheelScroll` calls both axes' getters unconditionally
  (`:4960-4961`), and `SmoothScroller.scrollBy` calls `clamp` on both axes
  again (`SmoothScroller.ts:152-153`), so four reads reach the same element per
  tick. `writeNativeScroll`'s read-back is deliberate (its doc comment:
  "mirrors the browser-clamped result into the cache") but it is a textbook
  category-A pair. The `isForeignWheelTarget` doc (`:1972-1979`) correctly notes
  that the extent checks are deferred until a tooltip is found — the climb
  itself is not deferred, and runs on every tick.
- **Proposed change:** two independent pieces.
  1. In `CodeEditor.onWheelScroll`'s path, memoise the two max-scroll values
     for the duration of one wheel gesture (invalidated on document change,
     `heightChanged`, or the component's own size change), so a tick costs one
     `getScrollMetrics`, not four. This is a `Component` change and is shared
     with `Panel`.
  2. In `isForeignWheelTarget`, short-circuit the climb on the common case:
     `.cm-tooltip` elements are always children of `.cm-editor` and never of
     `.cm-scroller`, so a target that reaches `.cm-scroller` before anything
     else can return `false` immediately. Reuse a single instance-level scratch
     array instead of allocating `climbed` per event.
- **Risk / blast radius:** (1) touches `Component`, shared with `Panel`,
  `VirtualScroller` and `TextArea`; cache invalidation is the whole risk.
  (2) is local to `CodeEditor`, and the tooltip carve-out is covered by
  `code-editor.test.ts`'s wheel cases (grep `isForeignWheelTarget` in that file).
- **Proof at implement time:** `getScrollMetrics` calls per wheel tick under a
  counting source; and ms/frame during a sustained wheel fling over a
  1000-line file in the real shell.

---

### F23.11 CodeMirror's own search panel is kept mounted and hidden by two theme rules, one of them a `:has()` selector, replicated once per editor

- **Category:** C, F, E
- **Impact:** MEDIUM-LOW — confidence flagged; the `:has()` cost in WebKitGTK
  is **not verified** here
- **Where:** `component/editor/theme.ts:121-133` (`".cm-panel.cm-search": { display: "none" }`
  and `".cm-panels:has(> .cm-panel.cm-search:only-child)": { display: "none" }`);
  `component/editor/CodeEditor.ts:1773-1789` (`openSearch` calls
  `openSearchPanel(view)` and leaves CodeMirror's panel open)
- **Evidence:** the theme comment (`:118-122`) states the design: "CodeMirror's
  own search panel is kept installed and open (it still drives
  searchHighlighter's match tinting) but its DOM is hidden — a framework-built
  floating `CodeEditorSearchPanel` replaces it visually." So while search is
  open, every editor carries a second, fully-built, `display:none` panel DOM,
  and the document carries one `:has()` rule **per editor** (they are inside
  the per-instance `StyleModule` — see F23.1, which reports 36 chrome rules per
  instance). `display:none` is the right hiding mechanism per the cost model,
  so the hidden panel's own render cost is zero; the residual concerns are the
  duplicated rules (fixed by F23.1) and the `:has()` machinery, which in WebKit
  sets a document-level flag that makes invalidation more conservative. I did
  not measure that, and say so.
- **Proposed change:** replace the `:has()` rule with a class the wrapper
  toggles: `setSearchPanelOpen(true)` adds a marker class to the editor
  element, and the theme uses two ordinary descendant selectors. This removes
  `:has()` from the document entirely and is strictly cheaper to match. Fold it
  into F23.1's implementation, since both edit the same spec object.
- **Risk / blast radius:** the two rules only ever apply while CodeMirror's
  search state is open; `:only-child` exists so the go-to-line dialog and the
  lint panel keep their container (per the comment at `:125-127`), and the
  class-toggle version must preserve that (a `.cm-panel.cm-search` +
  `.cm-panels` pair scoped by the marker class does).
- **Proof at implement time:** style-recalc time in a WebKitGTK Timeline
  recording while typing with the search panel open, before and after.

---

### F23.12 While the search panel is open, its whole 13-control subtree is re-laid-out on every editor layout pass, and its bounds are committed twice

- **Category:** D, B
- **Impact:** LOW–MEDIUM — only while search is open, but that includes every
  frame of a gutter drag performed with search open
- **Where:** `component/editor/CodeEditor.ts:2733-2745` (`doLayout` →
  `fitWithin`), `component/editor/CodeEditorSearchPanel.ts:350-364` (`fitWithin`)
- **Hot path:** `editor.doLayout()` → `super.doLayout()` → `Anchor.doLayout`
  (`layout/Anchor.ts:158`) → `commitBounds` → panel `setBounds` + `panel.doLayout()`
  → two `ToolBar`s × 13 controls → **then** `CodeEditor.doLayout` calls
  `this._searchPanel.fitWithin(innerSize.width)` (`:2741`), which writes
  `setWidth` and `setX` over the bounds `Anchor` just committed, and calls
  `host.getContentInsets()` — which per slice 28 allocates a fresh `Insets`
  (with a UUID) per call.
- **Evidence:** probe `layout-pass-cost.test.ts`, second case — 10 identical
  passes with the panel displayed: `sink ops: 490` (49 per pass) against
  `sink ops: 50` (5 per pass) with it hidden. (The probe's
  `getThemeVar=720` / `isConnected=2790` counts are an artefact of a detached
  probe tree taking `getBorderSize`'s pre-connect estimate path — see
  *Cross-slice notes* — and should not be read as production numbers; the sink
  op count is not affected by connectedness.)
- **Proposed change:** `CodeEditorSearchPanel` is a near-ideal
  `canSkipUnchangedLayout` opt-in — it is a fixed-content floating card whose
  children never change once `buildControls()` has run. Override the gate to
  return `true`. Separately, fold `fitWithin`'s clamp into the layout rather
  than running it after the commit: `Anchor` could take a max-width constraint,
  or `fitWithin` could early-return when `availableWidth` matches the value it
  last fitted to. Note the briefing's confirmed cross-slice finding: the
  `canSkipUnchangedLayout` contract is currently **inert**, because
  `LayoutManager.commitBounds:567` calls `child.doLayout()` unconditionally —
  so this opt-in only pays off once that is fixed.
- **Risk / blast radius:** `fitWithin` already no-ops when the panel is not
  displayed (`CodeEditorSearchPanel.ts:353-355`), so the closed case is
  unaffected. `code-editor-search-panel.test.ts` pins the panel's fields,
  commands and keyboard routing, not its per-pass layout.
- **Proof at implement time:** sink applies per pass with the search panel
  open, expected to fall from 49 to ~5.

---

### F23.13 `countFoldedLines` runs on every CodeMirror update for a value only `syncAutoHeight` reads

- **Category:** E, D
- **Impact:** LOW
- **Where:** `component/editor/CodeEditor.ts:2101`
  (`this._foldedLines = this.countFoldedLines(update.state)`), `:2272-2282`
  (`countFoldedLines`), `:588-598` (`_foldedLines`'s only reader is the shape
  tuple at `:2406`)
- **Evidence:** `grep -n _foldedLines component/editor/CodeEditor.ts` → written
  at `:2101`, read only at `:2406`, inside `syncAutoHeight`, which returns at
  `:2336-2338` whenever `autoHeightMaxRows` is `null`. So for every editor Loom
  builds, the value is computed on every transaction *and every geometry-driven
  measure update* and never read. The cost itself is small — `foldedRanges` is
  a state-field read and `between` over an empty `RangeSet` is O(1) — but it
  grows with fold count (`state.doc.lineAt` twice per folded range) and it
  is pure waste when auto-height is off.
- **Proposed change:** move the assignment inside the
  `update.heightChanged || update.geometryChanged` branch and guard it on
  `this.getAutoHeightMaxRows() !== null`, or compute it lazily from inside
  `syncAutoHeight` behind the same `_view.state.field` availability check the
  field's own doc comment describes (`:592-597` explains the field exists
  because ~20 offline tests stub `_view.state` as a bare `{ doc: { lines: n } }`;
  a `typeof state.field === "function"` guard preserves that).
- **Risk / blast radius:** `code-editor.test.ts:1507-1541` ("CodeEditor
  countFoldedLines") drives the method directly against a real `EditorState`
  and is unaffected; the autoheight suite's fold cases drive `_foldedLines`
  through the field, which a lazy version must keep honouring.
- **Proof at implement time:** ride along with F23.3; a probe counting
  `countFoldedLines` invocations per N geometry updates with auto-height off.

---

### F23.14 Unused public option and method surface

- **Category:** J (dead code), H (configurability nobody uses)
- **Impact:** LOW — code health; each unused knob is a branch in `mount` and a
  setter that reconfigures a compartment
- **Where and counts** (each grep run over
  `packages/lib/src packages/lib/tests packages/docs/src packages/create-app /home/jika/typescript/loom/src`,
  excluding `CodeEditor.ts`'s own declaration and the generated
  `packages/docs/dist/api/**` markdown):
  | symbol | non-declaring hits | where |
  |---|---|---|
  | `autoHeightMinRows` / `getAutoHeightMinRows` | 0 production, 1 test file | `code-editor.test.ts:1124-1198` only |
  | `highlightWhitespace` / `get`/`setHighlightWhitespace` | 0 production, 1 test file | `code-editor.test.ts:1364-1383` only |
  | `readonlyedit` event | 0 anywhere | see F23.8 |
  | `moveCursorToEnd` | 0 anywhere | `CodeEditor.ts:1164` |
  The comparison set: `tabSize`, `lineNumbers`, `spellcheck`, `lineWrap` and
  `lint` each have a live consumer in the docs demo panel
  (`packages/lib/src/typescript/CodeEditorPanel.ts:132,147,150,153,248,262,274,281,288`),
  `autoHeightMaxRows` and `heightchange` in `component/display/Markdown.ts:1194,1201`,
  `scrollAlign` in `/home/jika/typescript/loom/src/editor/editorSearch.ts:84`,
  and `selectionchange` in `CodeEditorPanel.ts:200` and
  `/home/jika/typescript/loom/src/EditorController.ts:433,572`.
- **Proposed change:** these are documented public API
  (`packages/lib/docs/components/CodeEditor.md`), so removal is a judgement
  call for the maintainer, not a mechanical cleanup. Report, do not delete.
  `autoHeightMinRows` is the strongest candidate: it is the only one with no
  demo, no consumer and a documented footgun of its own ("Should not exceed
  `autoHeightMaxRows`… silently defeating the cap", `CodeEditor.ts:180-187`).
- **Risk / blast radius:** removing any of them is a breaking API change.
- **Proof at implement time:** n/a (code health).

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `CodeEditor` (`CodeEditor.ts`, 2753 lines) | Syntax-highlighting, formatting code editor wrapping CodeMirror 6; live-only, fills its assigned box | its own `<div>`; the flash overlay `<div>`; CodeMirror owns everything below `.cm-editor`; no per-instance `StyleRule` of its own beyond `Component`'s `#id` rule | **0 live geometry reads**, 0 own style writes; `getInnerSize()` (cached) + `fitWithin` (early-returns when search is closed). Measured: 5 sink applies + 1 `isConnected` per pass, all from `Component` | over-built (2.75k lines carrying auto-height, search, reveal, clipboard, read-only flash, wheel routing and 11 compartments in one class) but the layout path itself **fits** | F23.2, F23.5–F23.9, F23.13, F23.14 |
| `CodeEditor.syncAutoHeight` + `measureContentExtent` + `setAutoHeight` | Grow the editor to fit content up to a row cap, emitting `"heightchange"` | writes `height` + `preferredSize` on itself | 7 live reads per repeat call, 10 per shape change, with a `setHeight` between read groups; runs per CodeMirror geometry update, uncoalesced | mismatch (correct algorithm, wrong frequency and read ordering) | F23.3 |
| `CodeEditor.mount` + the extension list | Build the `EditorState` and mount the view once, on first connected layout | mounts the view, the flash overlay, resolves `.cm-scroller` / `.cm-content` handles, attaches one `contextmenu` listener | once per instance | fits, except the unconditional flash overlay and the guaranteed no-op lint reconfigure | F23.7, F23.6 |
| `CodeEditor`'s `updateListener` | Fan CodeMirror updates out to `"change"` / `"cursorchange"` / `"selectionchange"`, drive auto-height and the search panel | none | per CodeMirror update (including per measure-driven geometry update): whole-document `toString` on a doc change, `countFoldedLines` always, 4 search-state field reads | mismatch (does per-update work for consumers that may not exist) | F23.7, F23.13 |
| `CodeEditorSearchPanel` (`CodeEditorSearchPanel.ts`, 463 lines) | A floating find/replace card for `CodeEditor`, carrying no CodeMirror knowledge | a `FloatingPanel` subtree: 2 `ToolBar`s, 2 `TextField`s, 3 `ToggleButton`s, 6 `Button`s, 2 separators; `ownClassStyleDefaults` shared rules | 0 while hidden (excluded from `getLaidOutComponents`); **49 sink applies per pass** while displayed | fits (lazy `buildControls`, clean event seam), but no `canSkipUnchangedLayout` opt-in | F23.12 |
| `theme.ts` / `codeEditorTheme` | Build the editor's chrome + syntax extension, reading project CSS tokens so a theme toggle needs no rebuild | one `@keyframes` block via `StyleRule.ensureKeyframes` (module-singleton, correct); **two `StyleModule`s and 51 CSS rules per call** | n/a (not on the layout path) | mismatch — the doc promises "recolours immediately with no rebuild", the implementation rebuilds 51 rules per editor per toggle | F23.1, F23.5, F23.11 |
| `editorTheme.ts` | Lexical class-name theme map + shared class rules for the **Markdown** editor's WYSIWYG surface | 19 `StyleRule`s behind a `_classRulesEnsured` module singleton | n/a | fits — and is the model `theme.ts` should follow (guarded, once per process, token-driven) | — (belongs to slice 24; see *Cross-slice notes*) |
| `editorNodes.ts` | The Lexical node classes every `MarkdownEditor` registers | none | n/a | fits (a frozen constant array) | — (slice 24) |
| `LanguageRegistry.ts` | `LanguageDefinition` / `Formatter` / `LintSource` types and a module-level id→definition `Map` | none | n/a | fits — small, three functions, no state beyond the map | — |
| `languages.ts` | Registers the built-in languages as an import side effect; every grammar/formatter/lint loader is a dynamic `import()` | none | n/a | fits; header comment says "five built-in language definitions" and registers **seven** | see *Redundant, duplicated and dead code* |
| `syntaxDiagnostics.ts` / `collectSyntaxErrors` | Walk a parse tree for error nodes, capped at 100 diagnostics | none | n/a — runs only when `lint` is on, inside CodeMirror's own debounced linter | fits | — |
| `formatters/options.ts` (`mapFormatOptions`) | Rename `FormatOptions` onto one engine's config keys, dropping unhonoured and absent fields | none | n/a (per `format()` call) | fits — the right abstraction, two real users | — |
| `formatters/prettier.ts` (`formatWithPrettier`) | Prettier-backed formatter factory; imports `prettier/standalone` + plugins on first call | none | n/a | fits | — |
| `formatters/sql.ts` (`formatWithSql`) | `sql-formatter`-backed formatter; clamps the cursor since the engine has no cursor map | none | n/a | fits | — |
| `revealHighlightField` / `setRevealHighlight` | A CodeMirror `StateField` holding the single range `revealRange` last highlighted | a decoration only | per transaction: one `tr.effects` loop + one `isUserEvent("select")` check | fits | — |

---

## Redundant, duplicated and dead code

Items not already covered by a finding.

1. **`languages.ts:4-8` says "five built-in language definitions"; seven are
   registered.** `grep -c "^registerLanguage({" packages/lib/src/typescript/lib/component/editor/languages.ts`
   → `7` (`javascript`, `json`, `html`, `sql`, `markdown`, `css`, `python`).
   The same stale count appears in `component/editor/index.ts:3` ("Registers the
   five built-in language definitions as a side effect"). `CodeEditor.md`'s own
   table lists seven and is correct. One-line comment fix.

2. **`CodeEditor._contextMenu` is constructed eagerly for every editor.**
   `CodeEditor.ts:515` — `private readonly _contextMenu: Menu = new Menu();`.
   `Menu` construction is JS-only (no DOM per the lifecycle doc), so this is an
   object-graph cost, not a render cost, but it is per editor and per
   `Markdown` code block, and it forces `destructor` to carry an explicit
   `this._contextMenu.dispose()` (`:1747`). A lazily built menu (first
   `handleContextMenu` call) removes both.

3. **`Component.afterNextLayout(() => this.syncAutoHeight())` is registered at
   every mount**, including the majority case where `autoHeightMaxRows` is
   `null` and the callback returns at its first guard.
   `CodeEditor.ts:2231`. Gate it on `this.getAutoHeightMaxRows() !== null`.
   `grep -n "afterNextLayout" packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`
   → 1 hit.

4. **`setRevealHighlight` and `revealHighlightField` are exported (`@internal`)
   with no production importer.**
   `grep -rln "setRevealHighlight\|revealHighlightField" packages/ /home/jika/typescript/loom/src --include=*.ts`
   → 3 files: `CodeEditor.ts` (declaration), `packages/lib/tests/component/code-editor.test.ts`,
   and the generated `packages/lib/dist/lib/types/…d.ts`. They are not in the
   `component/editor` barrel, so the public API is unaffected; this is a
   test-only export and is legitimate. Listed for completeness, no action.

5. **`languages.ts`'s `loadBabelPlugins` is shared by `javascript` and `json`
   but each call re-awaits both imports.** `languages.ts:15-22` — the module
   loader caches the modules, so the second call is cheap; the
   `Promise.all` and the array allocation per `format()` call are the only
   waste. No action recommended.

6. **`Glyph.register(...)` runs at module-import time of
   `CodeEditorSearchPanel.ts:28`** for eight glyphs, pulling eight glyph data
   modules into whatever chunk imports `component/editor`, whether or not a
   search panel is ever opened. `registerGlyph` is a `Map` insert
   (`component/display/Glyph.ts:238-242`), so there is no DOM or style cost —
   this is a bundle-size observation only, and consistent with how every other
   component registers its glyphs.

7. **Audit item closed.** `plans/research/codebase-health-audit-2026-08-29.md:59`
   (#11, "`CodeEditor.syncAutoHeight` strands an uncommitted height with no
   `heightchange` emitted") no longer reproduces: the
   `desired === previousHeight` branch at `CodeEditor.ts:2537-2551` now
   re-commits `desired` before returning, with a comment naming exactly this
   failure, and every other early return (`:2553`, `:2570`, `:2404`) is on a
   path where no probe height was committed. Nothing else in Priority 2 or
   Priority 3 of that audit touches this slice.

---

## Cross-slice notes

- **→ 01 core-component-lifecycle / 03 core-dom-seam-events:
  `Component.refreshWheelScrolling` and `Component.ownsNativeScroll` answer the
  same question with different predicates.** `Component.ts:4852-4854` tests
  only own-overflow; `Component.ts:4510-4515` already tests
  `getScrollElement() !== element` first. `CodeEditor` pays for the gap by
  setting a style it explicitly does not want (`CodeEditor.ts:239-252`). Full
  detail in **F23.9**; the fix lands in `Component`, not here.
- **→ 01 / 04: `Component.writeNativeScroll` is a write-then-read pair on a
  per-frame path.** `Component.ts:4903-4916` does
  `DOM.sink.apply(element, { scrollTop: value })` followed immediately by
  `DOM.source.getScrollTop(element)`, per axis, per `SmoothScroller` ease frame
  (`SmoothScroller.ts:220-221`). `CodeEditor` is the library's
  highest-frequency instance of this, because its scroll element is
  `.cm-scroller` — a large subtree whose scrollable overflow the engine must
  re-resolve. Same for `getMaxScrollLeft`/`getMaxScrollTop`, which are
  uncached `getScrollMetrics` calls invoked four times per wheel tick
  (**F23.10**).
- **→ 01: a negative `getElementById` result is not cached.**
  `Component.getElement()` (`:1284-1296`) assigns the miss to `this._element`,
  so `!this._element` is true again on the next call and the document query
  repeats. My first probe pass recorded `getElementById=50` over 10 passes on
  an unrendered component. Low impact in production (components are rendered),
  but it made the probe misleading and is worth a line in slice 01.
- **→ 01: `getBorderSize`'s pre-connect estimate storm reproduces here.** My
  detached-tree probe recorded `getThemeVar=720` and `isConnected=2790` over 10
  passes with the search panel displayed — the same uncached
  `estimateBorderSideWidth` → `DOM.source.getThemeVar` path slice 01 already
  reported, hit once per border side per size query. Confirms their finding
  from a second angle; no new claim.
- **→ 05 layout-base-box-flow-grid: `CodeEditor` uses `Anchor` and commits its
  one child through `LayoutManager.commitBounds`**, i.e. the unconditional
  `child.doLayout()` path, not `Component.applyBounds`. `CodeEditorSearchPanel`
  is a good `canSkipUnchangedLayout` candidate once that contract is live
  (**F23.12**).
- **→ 25 display-markdown: `Markdown` is the only production consumer of
  auto-height, and it attaches its editors outside the component tree.**
  `component/display/Markdown.ts:1191-1220` builds one `CodeEditor` per fenced
  code block and mounts it with
  `DOM.sink.appendChild(wrapper, editor.getElement(true)!)` — **not**
  `addComponent`. Two consequences for slice 25 to weigh: (a) these editors
  never receive `onEffectiveVisibilityChange`, so the re-show `requestMeasure`
  at `CodeEditor.ts:1950` never fires for them when the preview page is
  undisplayed and shown again; (b) each one independently mints 51 CSS rules
  (**F23.1**), so a 15-block document costs 765 rules and 15 full-sheet
  rewrites. F23.3's coalescing directly reduces slice 25's resize cost.
- **→ 24 editor-markdown: `editorTheme.ts` and `editorNodes.ts` are in this
  slice's file list but are Lexical/`MarkdownEditor` modules**, with no
  `CodeEditor` relationship. I read both in full and found nothing to report —
  `editorTheme.ts`'s `ensureMarkdownEditorClassRules` is a correctly guarded
  module singleton (`editorTheme.ts:32,50-54`) and is the pattern `theme.ts`
  should copy. Slice 24 should treat them as theirs.
- **Open plan interaction:** `plans/overlay-scrollbars-non-panel.md` is
  addressed in **F23.4**. I do not contradict its architecture; I ask for one
  added requirement (an unchanged-band gate on its `apply()`), because as
  written its `CodeEditor.doLayout` step introduces the per-frame forced
  synchronous layout this slice currently does not have.

---

## Suggested plan grouping

**Plan A — "Share the CodeMirror theme across editors" (F23.1, F23.5, F23.11).**
One coherent change set, all inside `theme.ts` plus two lines of `CodeEditor.ts`:
hoist the chrome theme to two module constants, the highlight style to one,
withhold the theme reconfigure while an editor is not effectively visible, and
swap the `:has()` rule for a marker class. Measurable on its own as stylesheet
rule count after *n* mounts and after *k* theme toggles. **No dependencies.**
This is the highest value-to-risk ratio in the slice and should go first.

**Plan B — "Coalesce the editor's auto-height sync" (F23.3, F23.13, plus item 3
of the dead-code list).** Arm the standard two-hop `afterNextLayout` settle
relay in place of the direct `syncAutoHeight` call, split the method into a
read phase and a commit phase, and gate `countFoldedLines` and the mount-time
`afterNextLayout` on auto-height actually being configured. Measurable as
`getScrollMetrics`/`getElementRect` per frame on a Markdown-preview resize.
**Depends on:** nothing in this slice; touches the ~40 autoheight tests, which
is the bulk of the work. **Coordinate with slice 25**, whose
`handleCodeEditorHeightChange` / `scheduleContentMeasure` sits on the other end
of the relay.

**Plan C — "Unchanged-value guards on the editor's setters" (F23.6).**
Ten small guards plus the mount-time lint no-op. Measurable as reconfigure
transactions per setter call. **No dependencies.** Small enough that it could
ride with Plan A, but it touches a different file and has its own test surface,
so it is cleaner alone.

**Plan D — "Per-keystroke document cost" (F23.7).** Rope-based dirty
comparison plus a lazy `"change"` payload. Measurable as ms/keystroke and
allocations on a 1 MB file. **No dependencies**, but it is the change most
likely to need a doc-page note (`CodeEditor.md`'s *Dirty state* section), so
it should not be bundled with anything else.

**Plan E — "Wheel-path reads" (F23.9, F23.10).** These two share a root
(`Component` deciding scroll ownership from the wrong predicate) and a test
surface. **Depends on slice 01/03** agreeing to widen `refreshWheelScrolling`;
the `isForeignWheelTarget` short-circuit half is local and can ship first. The
max-scroll memo belongs with `Panel`'s equivalent (slice 04), not here.

**Plan F — "Stop resizing CodeMirror's box mid-drag" (F23.2).** The one large
lever, and the only one that attacks the measured 15–20 ms directly. It should
be planned **last**, after A–E have removed the noise, and it needs a real
WebKitGTK A/B before it is committed to — the tradeoff (content does not track
the drag until settle) is a product decision, not a performance one. **Depends
on** Plan B, because `Markdown`'s auto-height editors drive their own height
and the two settle paths must agree.

**Rides along, too small to plan:** F23.8 (drop the eager flash overlay) fits
inside Plan A or Plan C — it is one conditional in `mount`. F23.12 (the search
panel's `canSkipUnchangedLayout` opt-in) should wait for the
`LayoutManager.commitBounds` fix the briefing names, then ride along with
whatever plan lands that. F23.14 and the `languages.ts` comment-count fix are
code health with no measurable effect; carry them as a note to the maintainer,
not a plan.

---

*Probes for this slice live in
`/home/jika/typescript/typescript-ui/.worktrees/_probes/23-editor-code/`
(`theme-duplication.test.ts`, `setter-noop.test.ts`, `keystroke-doc-cost.test.ts`,
`layout-pass-cost.test.ts`, `autoheight-reads.test.ts`), run with
`PROBE_DIR=.worktrees/_probes/23-editor-code npx vitest run --config .worktrees/_probes/vitest.probe.config.ts`.
No file in the main tree was modified.*
