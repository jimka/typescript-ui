# 24 editor-markdown — render-work review

**Summary**

1. `MarkdownEditor` re-serialises the **entire document to Markdown on every Lexical
   commit** (`MarkdownEditor.ts:2294` → `:2889`), including commits that changed no
   node at all. Probed: a pure caret move commits with `dirtyElements.size === 0`
   and `dirtyLeaves.size === 0` and still runs one full export. On a 9 KB document
   that is **1.65–2.2 ms per keystroke and per caret move in Node/V8 — 68–83 % of the
   whole commit** — and it sits on hot path 4 (typing) and hot path 3 (every
   selection change of a mouse drag-select). **HIGH.**
2. Inside a table that multiplies: the curated `TABLE`/`BLOCK` transformers call
   `$convertToMarkdownString` **once per cell and once per column**, and
   `@lexical/markdown` rebuilds its transformer index on every such call. Probed:
   **25 index rebuilds + 25 sub-document walks per commit** for a 4×6 table, with no
   memo of the cells that did not change. **HIGH.**
3. `MarkdownBlockNode.updateDOM()` / `MarkdownColumnNode.updateDOM()` /
   `MarkdownImageNode.updateDOM()` return `true` unconditionally
   (`markdownBlockNode.ts:70,245`, `markdownImageNode.ts:153`). Lexical's reconciler
   answers `true` with `$createNode(key, null)` + `parentDOM.replaceChild`, which
   **destroys and recreates the whole subtree**, and an element is "dirty" whenever
   *any* descendant is. So one keystroke inside a `:::` region rebuilds every
   element of that region. **HIGH.**
4. `getValue()` re-exports with no cache, so a `"change"` listener that reads it
   pays a **second** whole-document export per keystroke — which is exactly what the
   library's own worked example does (`MarkdownEditorPanel.ts:101-103`), on top of a
   full `Markdown` preview teardown/rebuild per keystroke. **MEDIUM–HIGH.**
5. Positives to protect: `new MarkdownEditor()` issues **zero** sink ops;
   `MarkdownEditor` has **no `doLayout`, no size override, no `DOM.source` geometry
   read and no style write on any layout path**; `Card` takes the inactive surface
   out of the render tree with `display:none`; an unchanged `applySelectionState`
   costs **0** sink ops; `ensureMarkdownEditorClassRules()` is a module singleton
   (20 shared rules once per document), unlike `codeEditorTheme()`'s 51-per-call.

Paths below are relative to `packages/lib/src/typescript/lib/` unless stated.

---

## Findings

### F24.1 Every Lexical commit re-serialises the whole document, including selection-only commits

- **Category:** D (layout/work recomputed with unchanged inputs), H
- **Impact:** **HIGH** — per keystroke, per caret move, and per selection change of a
  mouse drag-select, scaling linearly with document size.
- **Where:** `component/editor/MarkdownEditor.ts:2294-2297` (the
  `registerUpdateListener` callback), `:2889-2896` (`handleChange`), `:2872-2882`
  (`onDocChange`).
- **Hot path:**
  - user types a character / presses an arrow key / drags a selection
  - Lexical commits an update (`$commitPendingUpdates`)
  - `editor.registerUpdateListener(() => { this.handleChange(); this.updateSelectionState(); })` — `MarkdownEditor.ts:2294`
  - `handleChange()` → `editor.read(() => $convertToMarkdownString(TRANSFORMERS))` — `MarkdownEditor.ts:2896`
  - `$convertToMarkdownString` → `createMarkdownExport(transformers)` → `transformersByType(transformers)` → a walk of **every top-level node and every descendant**
  - `onDocChange(value)` → `value === this._options.value` → early return on a caret move, **after** the work is already done
- **Evidence:**
  - Read `node_modules/@lexical/markdown/src/index.ts:114-124` and
    `src/MarkdownExport.ts:39-90`: `$convertToMarkdownString` builds a fresh
    `createMarkdownExport` closure per call — a `transformersByType` index plus a
    `.filter().sort()` — then walks the root's children.
  - Probe `commit-shape.test.ts`, *"reports empty dirtyElements/dirtyLeaves for a
    pure caret move, yet still exports"*:
    `caret-move update payload shapes: [{"elements":0,"leaves":0},{"elements":0,"leaves":0},{"elements":0,"leaves":0}] | full-document exports per caret move: 1`.
    The `UpdateListenerPayload` already carries the two dirty sets
    (`node_modules/lexical/src/LexicalEditor.ts:524-541`); the callback at
    `MarkdownEditor.ts:2294` takes no parameter and ignores them.
  - Probe `commit-timing.test.ts` (three arms: full / `handleChange` shadowed /
    both shadowed), Node/V8:

    | document | total ms/commit | `handleChange` | `updateSelectionState` | Lexical itself | wrapper share |
    |---|---|---|---|---|---|
    | prose ×5 (633 ch) | 0.41 | 0.34 | 0.01 | 0.06 | 86 % |
    | prose ×20 (2.5 kB) | 0.63 | 0.51 | 0.00 | 0.12 | 80 % |
    | prose ×60 (7.6 kB) | 1.27 | 0.91 | 0.03 | 0.32 | 75 % |
    | prose ×20 + 20-row table (3.0 kB) | 0.67 | 0.48 | 0.00 | 0.22 | 68 % |
    | prose ×60 + 60-row table (9.2 kB) | 2.86 | 2.20 | 0.03 | 0.64 | 78 % |

    `updateSelectionState` is free; the export is the whole wrapper cost. WebKitGTK
    under WSLg is materially slower than Node/V8, and a real README-sized document
    is 5–10× the largest row here, so the per-keystroke figure in the target
    environment is well past the 16.7 ms frame budget.
  - *Not verified:* the number of commits a live mouse drag-select produces. Lexical
    routes `selectionchange` through `editor.update`, so the shape is one commit per
    selection change, but that was not measured in a real browser.
- **Proposed change:** give the update listener its payload and skip `handleChange()`
  when `dirtyElements.size === 0 && dirtyLeaves.size === 0` — a commit that dirtied
  no node cannot have changed the Markdown, so the export's only possible outcome is
  `onDocChange`'s existing early return. Keep `updateSelectionState()` unconditional
  (it is the selection-tracking half and costs ~0). Second step: replace the eager
  export with a `_valueDirty` flag set here and drained lazily by `getValue()` (see
  F24.4), so a content change that nobody observes costs nothing either.
- **Risk / blast radius:** `"change"` must still fire synchronously from a
  `discrete: true` `setValue` — pinned by `markdown-editor.test.ts:327` ("fires a
  change with the new markdown on a content-changing setValue") and the dirty-state
  block at `:999-1150`. The dirty-set skip preserves that (a `setValue` dirties
  nodes). `markdown-document-panel.test.ts` re-emits the same event.
- **Proof at implement time:** the `commit-shape.test.ts` probe asserting
  `exports per caret move === 0` and `=== 1` per keystroke; plus the
  `commit-timing.test.ts` three-arm split showing the wrapper share collapsing on
  the caret-move path.

---

### F24.2 `updateDOM()` returns `true` unconditionally on all three custom nodes, so any edit inside a `:::` region rebuilds the whole region's DOM

- **Category:** D, E, F, H
- **Impact:** **HIGH** for any document containing a `:::` alignment/column fence —
  per keystroke, and the rebuilt surface is the visible prose. MEDIUM for images
  (a replaced `<img>` re-fetches/re-decodes).
- **Where:** `component/editor/markdownBlockNode.ts:70-74` (`MarkdownColumnNode`),
  `:245-249` (`MarkdownBlockNode`), `component/editor/markdownImageNode.ts:153-157`
  (`MarkdownImageNode`). The stated reason is identical in all three: *"the node has
  no way to touch an existing element under the seam rule, so Lexical must rebuild
  it on any change."*
- **Hot path:**
  - user types one character inside a paragraph inside a `MarkdownColumnNode`
  - `internalMarkNodeAsDirty` → `internalMarkParentElementsAsDirty` walks `__parent` to the root, setting every ancestor in `_dirtyElements` (`node_modules/lexical/src/LexicalUtils.ts:452-478, 568-583`)
  - the reconciler reaches the `MarkdownBlockNode`: `isDirty = activeDirtyElements.has(key)` is **true** (`LexicalReconciler.ts:1669-1672`)
  - `activeEditorDOMRenderConfig.$updateDOM(...)` → our `updateDOM()` → `true` (`LexicalReconciler.ts:1734-1741`)
  - `const replacementDOM = $createNode(key, null); parentDOM.replaceChild(replacementDOM, dom); $destroyNode(key, null);` (`:1742-1748`)
  - `$createNode` (`:662`) calls `$createDOM` then `$createChildren` for every descendant (`:755-762`) — the whole region's element tree is re-created, and the `slot === null` argument disables the "cross-parent move" DOM-reuse branch at `:686-704`
- **Evidence:** the reconciler source above, read in full. Cannot be probed offline:
  the test sink's `createViewElement` returns `null`
  (`packages/lib/tests/dom/TestDOM.ts:851-855`), so the Lexical view never mounts and
  the reconciler path is unreachable under vitest — this finding is evidenced from
  the library source, not a probe.
- **Proposed change:** add an *update* counterpart to the existing
  `DOM.sink.createViewElement` escape — the seam already carries the whole
  `ElementPatch` vocabulary these three nodes need (`addClass`, `style`, `setAttr`),
  and `createViewElement` (`core/DOM.ts:881`, impl `:2008`) already establishes the
  pattern of an unannotated `factory` parameter so no call site names a DOM type.
  With that, `updateDOM(prev, dom)` becomes a diff: return `false` after applying the
  changed attributes/styles, `true` only when the tag itself must change.
  `MarkdownColumnNode` has no per-node state at all, so its `updateDOM` can return a
  bare `false` the moment the seam method exists; `MarkdownBlockNode` compares
  `__align`/`__columnGap`; `MarkdownImageNode` compares `src`/`alt`/`width`/`height`.
  This is a genuine library-seam gap, not a workaround — it should be planned as a
  `core/DOM.ts` addition with the three nodes as its first callers.
- **Risk / blast radius:** the seam addition touches `DOMSink`, `ProductionDOMSink`
  and `TestDOM`; the `local/no-raw-dom` rule's *hold* clause must stay green, which
  is why the new method has to take the element positionally with its type inferred
  from the seam signature, as `mountView`/`createViewElement` already do. No existing
  test asserts `updateDOM()`'s return value.
- **Proof at implement time:** a probe counting `createViewElement` sink records
  across two commits that touch one paragraph inside a two-column region — today
  every column and block element is re-minted on the second commit; after the change
  the count is zero. In the real engine: paint/layout ms per keystroke on a document
  with one `::: columns` region.

---

### F24.3 The table and block transformers rebuild the transformer index once per cell and once per column, on every commit

- **Category:** D, I
- **Impact:** **HIGH** — multiplies F24.1 by the cell count. A document with one 4×6
  table costs 25 whole index rebuilds + 25 sub-document walks per keystroke *and* per
  caret move.
- **Where:** `component/editor/markdownTableTransformer.ts:385` (`renderHeaderRow`),
  `:421` (`renderBodyRow`), `component/editor/markdownBlockTransformer.ts:152`
  (`export`); import side `markdownTableTransformer.ts:290, 344` and
  `markdownBlockTransformer.ts:99`.
- **Hot path:**
  - `handleChange()` → `$convertToMarkdownString(TRANSFORMERS)` (one index build)
  - → `TABLE.export(tableNode)` → per body cell `escapeCellText($convertToMarkdownString(getTransformers(), cell))`
  - → each of those calls `createMarkdownExport(transformers)` → `transformersByType(transformers)` → `indexBy` over 15 transformers, 4 fresh arrays, one `.filter()`, one `.sort()` (`node_modules/@lexical/markdown/src/utils.ts:427-442`, `MarkdownExport.ts:43-58`)
  - the same shape for `BLOCK.export` → one nested conversion per `MarkdownColumnNode`
- **Evidence:** probe `commit-cost.test.ts` (an own `Symbol.iterator` on
  `TRANSFORMERS` counts every `transformersByType` pass):
  - `plain doc — per keystroke: 1, per caret move: 1`
  - `table doc (4 cols × 6 rows) — per keystroke: 25, per caret move: 25`
  - `setValue(table doc) — categorisation passes: 50` (25 import + 25 export)
  - `document walks — setValue: 2 (import + export) | markClean: 1` on a
    table-free document, i.e. the documented host sequence `setValue(…)` +
    `markClean()` costs three whole-document walks.
  Every one of those nested conversions re-derives a cell whose content did not
  change.
- **Proposed change:** two independent levers, both inside our own transformers.
  (a) Memoise the per-cell / per-column Markdown in a
  `WeakMap<LexicalNode, string>` keyed on the **node object**, not its key: Lexical
  clones a node only when it is written, so an unchanged cell is the *same object*
  across commits and the memo hits. A 24-cell table with one edited cell then costs 1
  conversion instead of 24. (b) `@lexical/markdown` does not export
  `createMarkdownExport`, so the index rebuild itself cannot be hoisted from outside;
  (a) removes almost all of it anyway. If the index cost still shows, the remaining
  option is to ask upstream for the export, or to inline a minimal cell exporter —
  do not do that speculatively.
- **Risk / blast radius:** the memo must be invalidated by nothing (node identity is
  the key), but it must not be keyed on `__key` — a written node keeps its key and
  changes its object. `markdown-editor.test.ts:1168-1394` (table import/export edge
  cases, merged cells, column widths, alignment fixpoints) is the pinning suite and
  is thorough; every one of its round-trip/fixpoint assertions must still pass.
- **Proof at implement time:** the `commit-cost.test.ts` probe asserting
  `per keystroke` drops from 25 to ≤ 2 for the 4×6 table document, with the
  `markdown-editor.test.ts` table suite green.

---

### F24.4 `getValue()` re-exports with no cache, so a `"change"` listener that reads it doubles the per-keystroke cost — and the library's own example does exactly that

- **Category:** D, H
- **Impact:** **MEDIUM–HIGH** — per keystroke, on top of F24.1, for any host that
  reads `getValue()` from its change handler (the pattern the docs and the demo
  both show).
- **Where:** `component/editor/MarkdownEditor.ts:1252-1265` (`getValue`), `:1319-1325`
  (`markClean`, which calls `getValue()`), and the consumer at
  `packages/lib/src/typescript/MarkdownEditorPanel.ts:97,101-103`.
- **Hot path:**
  - keystroke → `handleChange()` exports the document and stores it in `_options.value` (F24.1)
  - `emit("change", { value })` → `MarkdownDocumentPanel` re-emits → `MarkdownEditorPanel.syncViewer()` (`MarkdownEditorPanel.ts:101`)
  - `syncViewer` **ignores the payload** and calls `this._editorPanel.getValue()` → `MarkdownEditor.getValue()` → a **second** `$convertToMarkdownString(TRANSFORMERS)` over the same unchanged state
  - → `Markdown.setMarkdown(value)` (`component/display/Markdown.ts:899-916`), which unconditionally `clearContent()`s and re-appends every block token, then `measureContentHeight()` → `commitElementStyle()` + `syncCodeEditors()` + a `height: auto` probe with its forced reads
- **Evidence:** read both call sites; `getValue()` has no memo and `_options.value`
  already holds the value `handleChange` just computed. `Markdown.setMarkdown` has no
  unchanged-value guard and no incremental path. Probe `commit-shape.test.ts` shows
  `markClean:` costing one further whole-document walk for the same reason.
- **Proposed change:** memoise `getValue()`'s WYSIWYG branch behind a `_valueDirty`
  flag that the update listener sets (pairs with F24.1's second step), so
  `getValue()` between two commits is free and `markClean()` costs nothing extra.
  Separately, fix `MarkdownEditorPanel.syncViewer` to take the `"change"` payload's
  `value` instead of calling `getValue()`, and document in `MarkdownEditor.md` that
  the payload is the cheap read. The per-keystroke preview rebuild is a `Markdown`
  concern — see *Cross-slice notes*.
- **Risk / blast radius:** the memo must be invalidated by `setMode`, `setValue` and
  every command, all of which go through a commit, so the update listener is the
  single invalidation point. `markdown-editor.test.ts` uses `getValue()` in ~200
  assertions, which makes it a good regression net for a stale cache.
- **Proof at implement time:** a probe asserting that two consecutive `getValue()`
  calls with no intervening commit produce exactly one `TRANSFORMERS`
  categorisation pass.

---

### F24.5 Source mode re-materialises the whole document string per keystroke for a value it already has

- **Category:** D, G (allocation)
- **Impact:** **MEDIUM** — per keystroke while `mode === "source"`; two full-document
  string allocations per character typed.
- **Where:** `component/editor/MarkdownEditor.ts:2935-2938` (`handleCodeChange`),
  which calls `this._codeEditor.markClean()` → `CodeEditor.ts:776-781` →
  `this.getValue()` → `CodeEditor.ts:734-740` → `this._view.state.doc.toString()`.
- **Hot path:**
  - keystroke in source mode → CodeMirror update → `CodeEditor`'s `"change"` → `handleCodeChange(payload)` (`MarkdownEditor.ts:1171`)
  - `onDocChange(payload.value)` — the new text is **already in hand**
  - `this._codeEditor.markClean()` → `getValue()` → `doc.toString()` materialises the same string a second time, assigns it to `_cleanValue`, and calls the (guarded, therefore no-op) `setDirty(false)`
- **Evidence:** read all three methods. `Component.setDirty`
  (`core/Component.ts:2489-2495`) has an unchanged-value guard, so the only work the
  call does is the discarded `doc.toString()` plus the `_cleanValue` assignment.
- **Proposed change:** give `CodeEditor.markClean` an optional already-known value
  (or add a `protected` re-baseline seam) so `handleCodeChange` can pass
  `payload.value` through instead of forcing a re-read. Keeping the two surfaces'
  clean points in sync is the documented intent
  (`MarkdownEditor.ts:2925-2934`); only the re-derivation is waste.
- **Risk / blast radius:** `CodeEditor.markClean` is public with 37 call sites across
  lib + docs; an optional parameter is additive.
  `markdown-editor.test.ts:1099-1150` pins the source-surface dirty relay.
- **Proof at implement time:** a probe spying on `CodeEditor.prototype.getValue`
  and asserting zero calls per source-mode keystroke.

---

### F24.6 The toolbar re-implements five of `MarkdownEditor`'s own context-menu item lists and all three of its prompt helpers, verbatim

- **Category:** I, H
- **Impact:** **LOW** (code health only — no per-frame cost), but it is ~200 lines of
  duplicated behaviour with two copies of the same preset tables, and the two copies
  can drift.
- **Where (both sides):**

  | item list | `MarkdownEditor.ts` | `MarkdownDocumentPanel.ts` |
  |---|---|---|
  | Text style (Colour/Font/Size presets) | `:2528-2571` | `:357-394` |
  | Columns (2/3/4/None) | `:2582-2594` | `:410-419` |
  | Alignment (L/C/R/J/Default) | `:2675-2689` (inline) | `:397-407` |
  | Insert (Quote/Code/lists/Table/Image…) | `:2721-2738` (inline) | `:297-307` |
  | Table submenu | `:2818-2868` | `:310-354` |
  | `promptForText` | `:2390-2404` | `:434-450` |
  | `promptAndInsertImage` | `:2465-2471` | `:453-459` |
  | `promptAndSetColumnWidth` | `:2446-2458` | `:462-474` |

- **Evidence:** read both files in full. The colour presets (`#cc0000`, `#008000`,
  `#2563eb`), fonts (`Georgia, serif`, `monospace`) and sizes (`0.8em`, `1.2em`)
  appear twice, byte-identical. `MarkdownDocumentPanel.ts:421-433` documents the
  `promptForText` duplication as an accepted decision *because the editor's copy is
  private* — which is an argument for changing the visibility, not for the copy.
- **Proposed change:** hoist the five item-list builders and the three prompt helpers
  into module-level factories in `MarkdownEditor.ts` parameterised by the target
  editor (`(editor: MarkdownEditor) => MenuItemConfig[]`), exported the way
  `$classifyContextMenuTarget` and `$selectEnclosingWordIfCollapsed` already are
  (`MarkdownEditor.ts:681, 748`) for exactly this "tests/siblings need it, the barrel
  does not" reason. `MarkdownDocumentPanel` then adds only the live `checked:` state
  it layers on top.
- **Risk / blast radius:** `markdown-editor.test.ts:2586-3170` asserts exact item
  counts and orders per context (19/20/22/17/18/20 entries), and
  `markdown-document-panel.test.ts` asserts the toolbar's own lists; both must be
  kept literal after the hoist.
- **Proof at implement time:** both existing suites green with no assertion edits,
  and a line-count delta on the two files.

---

### F24.7 `new MarkdownDocumentPanel()` mutates the shared stylesheet 34 times and schedules a layout frame, from a constructor

- **Category:** C, H
- **Impact:** **MEDIUM** — once per panel, but stylesheet mutation is the most
  expensive write in the target engine and
  `docs/concepts/performance.md` states construction is JS-only ("no stylesheet
  inserts, no forced layout").
- **Where:** `component/editor/MarkdownDocumentPanel.ts:195-294` (the constructor
  calls `buildToolbar()`, which builds 5 `ToggleButton`s, 1 `PopupButton`, 4
  `MenuButton`s, 1 `ToggleButton`, a `ToolBar` and 2 separators).
- **Evidence:** probe `panel-construction.test.ts`:
  - `new MarkdownDocumentPanel({ value: '# Hello…' })` (cold):
    `{"ensureStyleRule":16,"setRuleStyles":18,"addListener":14,"requestAnimationFrame":1}`
  - probe `toolbar-attribution.test.ts` attributes it: `new ToolBar()` alone is
    `{"addListener":1}`; the **first** glyph `ToggleButton` is
    `{"ensureStyleRule":5,"setRuleStyles":5,"requestAnimationFrame":1,"addListener":10}`;
    a `MenuButton` adds `{"setRuleStyles":2}`. The cost is `Button`/`ToggleButton`/
    `Glyph` shared-state-rule materialisation and one scheduled layout, reached
    through this constructor.
  - Contrast: `new MarkdownEditor('# Hello…')` records **zero** sink ops of any kind.
- **Proposed change:** nothing in this slice's own code is wrong — the fix belongs to
  `Button`/`ToggleButton`/`Glyph` (slices 13/02), whose state rules should
  materialise at first render rather than at construction. Record here that
  `MarkdownDocumentPanel` is a concrete 34-mutation instance of it, and that the
  panel's eager toolbar is correct by its stated function (the toolbar *is* the
  component), so the lever is upstream, not lazy toolbar construction.
- **Risk / blast radius:** none in this slice.
- **Proof at implement time:** the `panel-construction.test.ts` probe asserting
  `ensureStyleRule + setRuleStyles === 0` for construction alone.

---

### F24.8 `WysiwygSurface` is a non-`Panel` `overflow: auto` scroll host — a hazard for the open `overlay-scrollbars-non-panel` plan

- **Category:** A (forward-looking), D
- **Impact:** **LOW today, HIGH if the plan is widened.**
- **Where:** `component/editor/MarkdownEditor.ts:882` (`this.setOverflow("auto")` on
  `WysiwygSurface`).
- **Evidence:** `plans/overlay-scrollbars-non-panel.md` names only `CodeEditor` and
  `TextArea` as its two clients, so `WysiwygSurface` is out of scope as written. But
  its step 5 adds `commitElementStyle()` + `getScrollMetrics()` to
  `CodeEditor.doLayout` — the write-then-read shape that cost ~110 ms/frame in the
  `ScrollStrip` case, already flagged by slice 23. **This slice owns a `CodeEditor`
  instance** (`MarkdownEditor.ts:1168-1172`), so a `MarkdownEditor` in source mode
  inherits that cost directly, and `WysiwygSurface` has exactly the same
  "framework-owned element with native overflow" shape that would invite the same
  treatment in a follow-up.
- **Proposed change:** none now. When that plan is implemented, `WysiwygSurface` must
  not be added as a third client without resolving the forced-read first, and the
  plan's `CodeEditor` step must be measured with a `MarkdownEditor` in source mode in
  the scenario set.
- **Risk / blast radius:** n/a.
- **Proof at implement time:** a probe asserting zero `DOM.source` geometry reads in
  a `MarkdownEditor` layout pass, run before and after that plan lands.

---

### F24.9 Five byte-identical format-toggle methods and a redundant table resolution

- **Category:** H, I, J
- **Impact:** **LOW** (code health; the redundant walk is per command invocation, not
  per frame).
- **Where:**
  - `MarkdownEditor.ts:1387-1392, 1403-1408, 1419-1424, 1434-1439, 1449-1454` —
    `toggleBold` / `toggleItalic` / `toggleInlineCode` / `toggleStrikethrough` /
    `toggleUnderline` differ only in the string handed to `FORMAT_TEXT_COMMAND`.
  - `MarkdownEditor.ts:234-236` — `$selectionIsInTableCell()` is
    `$getEnclosingTableNode() !== null`, and `$getEnclosingTableNode` (`:221-225`)
    calls `$getTableNodeFromLexicalNodeOrThrow(cell)` purely to discard it. The
    predicate is equivalent to `$getEnclosingTableCellNode() !== null`; the extra
    ancestor walk runs on each of the six table commands that guard with it
    (`:1974, 1992, 2012, 2030, 2110`).
  - `MarkdownEditor.ts:1167` and `:1171` pass **inline arrow functions** as
    listeners, against ARCHITECTURE.md's *"Listeners must reference a named
    function"*. `MarkdownDocumentPanel.ts:184-188` shows the correct shape (named
    readonly arrow fields) for the identical `ListenerBag`-dispatch constraint the
    comment at `MarkdownEditor.ts:1165-1166` cites.
  - `MarkdownEditor.ts:1686` — `copy()` calls `this.ensureEditor()` again after
    already holding the editor in a local (`:1663`); `paste()` resolves it three
    separate times (`:1729, 1734, 1746`).
- **Evidence:** read; `grep -c "discrete: true"` = 31, `grep -c "this.ensureEditor()"`
  = 38 in a 2,946-line file, and six occurrences of the identical
  `editor.update(() => { $selectEnclosingWordIfCollapsed(); }, { discrete: true });`
  line (`:1390, 1406, 1422, 1438, 1453, 1664`).
- **Proposed change:** one `private toggleFormat(format: TextFormatType): this`
  behind the five public methods (which stay, for the documented API); make
  `$selectionIsInTableCell` test the cell, not the table; convert the two inline
  listener arrows to named readonly fields; reuse the local `editor`.
- **Risk / blast radius:** `markdown-editor.test.ts:352-579` covers all five toggles
  and `:1254-1394` the table guards.
- **Proof at implement time:** the existing suites, plus a line-count delta.

---

### F24.10 `MarkdownEditor.setContentEditable` / `getContentEditable` are dead public facades

- **Category:** J
- **Impact:** **LOW** (API surface only).
- **Where:** `component/editor/MarkdownEditor.ts:2220-2225` and `:2231-2233` — both
  forward to `WysiwygSurface` (`:918-928`, `:930-932`).
- **Evidence:**
  `grep -rn "getContentEditable\|setContentEditable" packages/ --include=*.ts --include=*.md`
  (excluding `dist/` and the declaring file) → **4 hits, all in
  `packages/lib/tests/component/markdown-editor.test.ts` (:232-234, :275) plus the
  two generated TypeDoc pages**. Zero production callers in `packages/lib/src`,
  `packages/docs`, `packages/create-app`, and zero in
  `/home/jika/typescript/loom/src` (which does not use `MarkdownEditor` at all —
  `grep -rn "MarkdownEditor\|MarkdownDocumentPanel" /home/jika/typescript/loom/src`
  → 0 files). Neither method appears in the *Common methods* table of
  `packages/lib/docs/components/MarkdownEditor.md`.
- **Proposed change:** delete both from `MarkdownEditor`; the surface's own pair stays
  (the constructor uses it at `:880`). If the facade is wanted for symmetry, document
  it — but an undocumented, unused public method on a 2,946-line class is the
  opposite of the *Simplicity First* rule.
- **Risk / blast radius:** two test assertions to retarget at `WysiwygSurface`
  (already reachable white-box via `wysiwygOf()`, `markdown-editor.test.ts:99-103`).
- **Proof at implement time:** the grep count above, re-run at zero.

---

### F24.11 The source `CodeEditor` is constructed for every editor, though `"wysiwyg"` is the default mode

- **Category:** H
- **Impact:** **LOW** — construction is JS-only (probed: 0 sink ops) and `Card`
  keeps the surface `display:none`, so there is no render cost. The cost is the
  object graph and the eager CodeMirror import.
- **Where:** `component/editor/MarkdownEditor.ts:1168-1172`.
- **Evidence:** probe `panel-construction.test.ts`, *"bare MarkdownEditor
  construction sink ops"* → `{}`. `Card.syncVisible`
  (`layout/Card.ts:206-268`, undisplay loop at `:236-248`) undisplays every non-resolved child at the first sync, so
  CodeMirror's view never mounts in WYSIWYG mode (`Card.doLayout` lays out only the
  visible child, so `CodeEditor`'s `onFirstLayout` mount trigger never fires).
- **Proposed change:** build `_codeEditor` lazily on the first `setMode("source")` /
  `getValue()` in source mode. Only worth doing if it rides along with another change
  in this file — on its own it buys little, given the zero sink ops.
- **Risk / blast radius:** `setReadOnly`'s forwarding (`:1348`) and
  `markClean` (`:1322`) both reach `_codeEditor` unconditionally and would need a
  null guard; `markdown-editor.test.ts:984-998, 1099-1150` pins both.
- **Proof at implement time:** ride-along only; no separate measurement.

---

## Entity inventory

| Entity | Stated function | Owns DOM | Per-layout-pass writes/reads | Verdict | Findings |
|---|---|---|---|---|---|
| `MarkdownEditor` (`MarkdownEditor.ts:1079`) | WYSIWYG rich-text editor whose value is Markdown, with a source-mode surface | Its own element only; layout manager is a `Card` over two child surfaces | **None.** No `doLayout`, no `getPreferredSize`/`getMinSize`/`getMaxSize` override, no `DOM.source` geometry read, no style write, no viewport listener. Construction: 0 sink ops (probed) | fits (layout); **over-built** (2,946 lines; ~400 of them duplicated menu construction) | F24.1, F24.3, F24.4, F24.5, F24.9, F24.10, F24.11 |
| `WysiwygSurface` (`MarkdownEditor.ts:858`) | Private mount element for Lexical's `contenteditable` | One element; `overflow:auto`; one `#id` rule (`lineHeight`, queued at construction, flushed at render); shared `.WysiwygSurface` class defaults | None. One `onFirstLayout` one-shot → `mountWysiwyg()` | fits | F24.8 |
| `MarkdownDocumentPanel` (`MarkdownDocumentPanel.ts:165`) | `Border` container: glyph toolbar NORTH, editor CENTER | Its own element; owns a `ToolBar` + 13 controls | None of its own. Per `"selectionstate"` emit: 5 `setSelected` + 2 `setEnabled`, all guarded — **0 sink ops on an unchanged push** (probed) | fits (runtime); **over-built** (duplicates the editor's menu lists) | F24.6, F24.7 |
| `LinkPopupPanel` (`MarkdownDocumentPanel.ts:60`) | Link URL popup content for the toolbar's Link button | A `PopupPanel` with a `TextField` + 2 `Button`s | Only on `showAt` (per open): `setValue` + `setText` + `setVisible` | fits | — |
| `TRANSFORMERS` (`markdownTransformers.ts:68`) | The curated 15-transformer dialect array, single source of truth for import, export and shortcut typing | none | Re-categorised by `@lexical/markdown` once per `$convertToMarkdownString`/`$convertFromMarkdownString` call — 25×/commit with a 4×6 table (probed) | fits (the curation); the **per-call rebuild** is the cost | F24.1, F24.3 |
| `createTableTransformer` (`markdownTableTransformer.ts:241`) | GFM pipe-table import/export incl. alignment, widths, `<<`/`^^` merges | none | Export: one nested `$convertToMarkdownString` **per cell**, no memo | **over-built** on the cost axis, correct on the behaviour axis | F24.3 |
| `createBlockTransformer` (`markdownBlockTransformer.ts:45`) | `:::` alignment / column-region fence import/export | none | Export: one nested `$convertToMarkdownString` **per column**, no memo | same as above | F24.3 |
| `UNDERLINE` / `STYLED_TEXT` (`markdownStyleTransformers.ts:95, 107`) | `++u++` and `[t]{color=…}` text transformers | none | `STYLED_TEXT.export` early-returns on `getStyle() === ""`, so unstyled text nodes cost one string compare | fits | — |
| `IMAGE` (`markdownImageTransformer.ts:146`) | `![alt](src){width=… height=…}` with scheme validation | none | `export` early-returns on a non-image node | fits | — |
| `MarkdownBlockNode` (`markdownBlockNode.ts:115`) | `:::` fence element node carrying align + column gap | One `<div>` minted via `DOM.sink.createViewElement` | `updateDOM()` → `true` **always** → whole-subtree re-create on any descendant edit | **mismatch** | F24.2 |
| `MarkdownColumnNode` (`markdownBlockNode.ts:37`) | One column of a `:::` region | One `<div>` via the same seam | `updateDOM()` → `true` **always**, though the node carries **no state at all** | **mismatch** | F24.2 |
| `MarkdownImageNode` (`markdownImageNode.ts:40`) | Inline atomic sized image (`DecoratorNode`, `decorate()` → `null`) | One `<img>` via the same seam | `updateDOM()` → `true` **always** → `<img>` element replaced whenever the node or a sibling is dirtied | **mismatch** | F24.2 |

---

## Redundant, duplicated and dead code

Items not already covered by a finding above.

1. **`markdownBlockTransformer.ts:131` and `markdownTableTransformer.ts:364` both
   carry a `replace: () => false` documented as *"Never reached"*.** True — the
   `MultilineElementTransformer` contract requires the field, so this is dead by
   interface obligation, not by accident. No change; recorded so a later reader does
   not "fix" it.
   `grep -n "Never reached" packages/lib/src/typescript/lib/component/editor/markdown*.ts` → 2.
2. **`keepElement<T>(element: T): T` is defined identically in two files** —
   `markdownBlockNode.ts:22-24` and `markdownImageNode.ts:24-26`, with the same
   six-line JSDoc. `grep -rn "function keepElement" packages/lib/src` → 2. One shared
   helper next to the seam would do; it stays duplicated only because each file
   avoids naming a DOM type. Rides along with F24.2, which rewrites both anyway.
3. **`WysiwygSurface._onReady`** (`MarkdownEditor.ts:864, 878, 905`) is a stored
   field read exactly once, by the arrow at `:905`. `onFirstLayout(onReady)` takes
   the callback directly; the field and the wrapper arrow are both removable.
4. **`MarkdownEditor.getMode()`** has zero external production callers
   (`grep -rn "\.getMode(" packages/lib/src packages/docs --include=*.ts` excluding
   `MarkdownEditor.ts` → 0; tests → 3). Unlike F24.10's pair it *is* documented
   (`MarkdownEditor.md`, *Common methods*) and is the natural read half of
   `setMode`, so keep it. Recorded for completeness of the surface sweep.
5. **No open item from `plans/research/codebase-health-audit-2026-08-29.md` lands in
   this slice.** Its only editor entries are `CodeEditor.ts:924` (slice 23) and item
   7, `MarkdownViewer`/`DocsContent` scroll-tracking duplication (slice 25).
   `grep -n -i markdown plans/research/codebase-health-audit-2026-08-29.md` → 4 hits,
   none naming a file in slice 24.

---

## Cross-slice notes

- **→ 25 display-markdown: `Markdown.setMarkdown` has no unchanged-value guard and no
  incremental path** (`component/display/Markdown.ts:899-916`): it `clearContent()`s
  and re-appends every block token, then runs `measureContentHeight()` with its
  `commitElementStyle()` + `syncCodeEditors()` + `height: auto` probe. The library's
  own worked example drives it **once per keystroke**
  (`packages/lib/src/typescript/MarkdownEditorPanel.ts:101-103`). Combined with slice
  23's finding that `codeEditorTheme()` mints 51 never-released stylesheet rules per
  call, a live-preview document with fenced blocks leaks 51 × *blocks* rules **per
  keystroke**. That is the single largest consequence of this slice's `"change"`
  contract, and it belongs to slice 25's owner to fix (a same-value guard plus a
  coalesced re-render), with F24.4's payload fix on this side.
- **→ 23 editor-code: the `syncAutoHeight` HIGH rating does not apply to this
  slice.** `syncAutoHeight` early-returns when `autoHeightMaxRows` is unset
  (`component/editor/CodeEditor.ts:2333-2337`), and `MarkdownEditor` never sets it —
  its source `CodeEditor` is constructed with only `language`, `readOnly` and
  `listeners` (`MarkdownEditor.ts:1168-1172`).
  `grep -rn "autoHeightMaxRows" packages/ --include=*.ts` shows the only production
  setter is `component/display/Markdown.ts:1194`, i.e. the **viewer's** embedded
  code blocks (slice 25), not the Markdown *editor*. The briefing's routing of that
  finding to slice 24 should be corrected to slice 25.
- **→ 23 editor-code: this slice does not reproduce the `codeEditorTheme()` shape.**
  `ensureMarkdownEditorClassRules()` (`component/editor/editorTheme.ts:49-54`) is
  guarded by a module-level `_classRulesEnsured` flag and mints **20 shared class
  rules once per document**, not per instance. `EDITOR_THEME` (`:274`) is a frozen
  module constant handed to every `createEditor`. This is the right shape and the
  precedent `codeEditorTheme()` should be moved to.
- **→ 01 core-component-lifecycle / 03 core-dom-seam-events: `core/DOM.ts` has a
  `createViewElement` escape but no *update* counterpart** (`core/DOM.ts:864-881`),
  which is the direct cause of F24.2. Any future Lexical (or other foreign-widget)
  node hits the same wall. The seam addition is the enabling dependency for F24.2.
- **→ 13 button-glyph-image / 02 core-component-styling:** F24.7's 34 construction-time
  stylesheet mutations are `Button`/`ToggleButton`/`Glyph` state-rule
  materialisation reached through a constructor. `new ToolBar()` on its own is
  `{"addListener":1}` here — consistent with slice 12's "MenuBar and ToolBar add zero
  per-frame work", though slice 12's *"`new ToolBar()` runs three synchronous
  `doLayout()` calls"* did not show up as sink ops in this slice's probe.
- **→ 07 layout-tab-tabbar / performance doc:** `Card.syncVisible`
  (`layout/Card.ts:206-268`, undisplay loop at `:236-248`) correctly uses `setDisplayed(false)`, not
  `setVisible(false)`, for the inactive surface — so a `MarkdownEditor` in WYSIWYG
  mode does **not** pay the ~9 ms/frame-per-hidden-CodeMirror cost the target
  environment charges for `visibility:hidden`. This is the opposite of
  `Tab.setBarVisible(false)`'s shape and should be protected by any plan that touches
  the mode switch.
- **Contract this slice relies on that does hold:** `Component.setDirty`
  (`core/Component.ts:2489`), `Component.setStyleState`, `Button.setEnabled`
  (`component/button/Button.ts:2873`) and `Aria.setAttribute`
  (`core/Aria.ts:791-798`) are all unchanged-value-guarded, which is why an unchanged
  `applySelectionState` push costs 0 sink ops. `ToggleButton.setSelected`
  (`component/button/ToggleButton.ts:174`) has no guard of its own but writes only
  through those two guarded seams.

---

## Suggested plan grouping

**Plan A — "Markdown editor commit cost" (highest payoff, self-contained).**
F24.1 + F24.4 + F24.5. One change set: give the update listener its
`UpdateListenerPayload` and skip the export on a no-dirty-node commit; add a
`_valueDirty` flag so `getValue()`/`markClean()` drain the export lazily; pass
`payload.value` through `handleCodeChange` instead of forcing a `CodeEditor.getValue()`
re-read (needs an optional-value parameter on `CodeEditor.markClean`, which is the
only cross-file edit). Measurable on its own with the `commit-shape.test.ts` and
`commit-timing.test.ts` probes. No dependencies.

**Plan B — "Markdown transformer export memo".** F24.3 alone: a
`WeakMap<LexicalNode, string>` memo over the table transformer's per-cell and the
block transformer's per-column conversions. Independent of Plan A, but its measured
gain is largest *after* Plan A (Plan A removes the caret-move commits, Plan B removes
the per-cell cost of the keystroke commits that remain). Pinned by the existing table
round-trip suite, so it is low-risk and measurable on its own.

**Plan C — "A view-element update seam" (enabling, cross-slice).** F24.2. Add an
update counterpart to `DOM.sink.createViewElement` in `core/DOM.ts` +
`ProductionDOMSink` + `TestDOM`, then rewrite the three custom nodes' `updateDOM` to
diff instead of returning `true`. **Depends on nothing, but blocks nothing either** —
it should be sequenced with slice 01/03's `core/DOM.ts` work so the seam is designed
once. F24.9's `keepElement` duplication rides along here. This is the only plan in
the slice that needs a real-engine measurement (paint/layout ms per keystroke inside
a `::: columns` region), since it cannot be probed offline.

**Plan D — "Markdown menu-construction de-duplication" (code health).** F24.6 +
F24.9 + F24.10 + F24.11. Hoist the five shared item-list builders and the three
prompt helpers to module-level factories; collapse the five format toggles into one
private helper; fix `$selectionIsInTableCell`; convert the two inline-arrow listeners
to named fields; delete the two dead `contentEditable` facades; lazily build the
source `CodeEditor`. No measurable frame cost — its justification is the ~200
duplicated lines and the two drifting copies of the preset tables. Should land
**after** Plan A, which touches the same file's change seams.

**Too small to plan on their own, ride along:** F24.9's `ensureEditor()` re-calls
(with Plan D); `WysiwygSurface._onReady` (with Plan D); the `keepElement` duplicate
(with Plan C).

**Not a plan for this slice:** F24.7 (belongs to slices 13/02 — record the
34-mutation instance in their plan) and F24.8 (a constraint on the
`overlay-scrollbars-non-panel` plan, not a change).

---

## Probes

Written to `.worktrees/_probes/24-editor-markdown/` and run with
`PROBE_DIR=.worktrees/_probes/24-editor-markdown npx vitest run --config .worktrees/_probes/vitest.probe.config.ts`:

- `commit-cost.test.ts` — counts `transformersByType` passes per commit via an own
  `Symbol.iterator` on `TRANSFORMERS`. Result: 1 per keystroke **and per caret move**
  for plain prose; 25 for a document with a 4×6 table; 50 for one `setValue` of it.
- `commit-timing.test.ts` — three-arm wall-clock split (full / `handleChange`
  shadowed / both shadowed) across five document sizes. Result: `handleChange` is
  68–86 % of every commit.
- `commit-shape.test.ts` — the `UpdateListenerPayload` shape on a selection-only
  commit (`{elements:0, leaves:0}`, yet 1 export), exports per keystroke (1), per
  `toggleBold()` from a collapsed mid-word caret (1, with the value correctly
  becoming `Hello **wonderful** world.`), and per `setValue` + `markClean` (2 + 1).
- `panel-construction.test.ts` — sink ops for `new MarkdownEditor()` (`{}`), for
  `new MarkdownDocumentPanel()`
  (`{"ensureStyleRule":16,"setRuleStyles":18,"addListener":14,"requestAnimationFrame":1}`),
  and for an unchanged `applySelectionState` (`{}`).
- `toolbar-attribution.test.ts` — attributes the panel's construction cost to
  `ToggleButton`/`MenuButton` shared state rules rather than to `ToolBar` or the
  panel itself.
