---
touches-shared: [plans/overlay-scrollbars-non-panel.md, plans/table-column-pinning.md, plans/button-primary-press-filtering-exploration.md]
---

# Pending Plan Amendments — Implementation Plan

## Overview

Three plans sitting in `plans/` are unsafe or stale to implement as written. This plan amends two of them and retires the third. It edits Markdown under `plans/` only: nothing under `packages/` changes, no test moves, and no public API is touched.

The evidence is the 2026-09-15 whole-library render review, group `G01` ([plans/research/render-review-2026-09-15/99-synthesis.md:1260](plans/research/render-review-2026-09-15/99-synthesis.md#L1260)), which draws on four slice reports (23 F23.4, 19 Redundant #8, 13 F13.19, 04 F04.7) and the measured cost model in [plans/research/render-review-2026-09-15/00-baseline.md](plans/research/render-review-2026-09-15/00-baseline.md). Every claim that review recorded was re-checked against `master` on 2026-09-17, after four correctness branches merged. Where a claim had drifted, the corrected fact is the one written below.[^reverified]

| Plan | Action |
|---|---|
| [plans/overlay-scrollbars-non-panel.md](plans/overlay-scrollbars-non-panel.md) | Amend — add a read-skipping requirement, two cross-references, and re-base its source anchors. |
| [plans/table-column-pinning.md](plans/table-column-pinning.md) | Amend — add a corrections section that overrides the body, re-base its paths, and schedule it behind three table-performance plans. |
| [plans/button-primary-press-filtering-exploration.md](plans/button-primary-press-filtering-exploration.md) | Retire — move to `plans/implemented/` beside the plan that superseded it. |

---

## Architecture Decisions

### The overlay plan gains a clamp-signature gate, and keeps its architecture

`plans/overlay-scrollbars-non-panel.md` is sound in shape and stays as it is. One requirement is added to it: the helper's private `apply()` must skip its `getScrollMetrics` read when the band and the elements it targets are all unchanged. The band is the rectangle `(x, y, width, height)` that the helper's `layout()` is called with once per layout pass.[^why-gate]

The gate mirrors [`ScrollStrip.layoutItems`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L522), which compares a two-number clamp signature held in `_lastClipExtent` / `_lastItemsExtent` ([ScrollStrip.ts:191,196](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L191)) and reads live only when that signature moves. That gate shipped as [plans/implemented/scroll-strip-deferred-resync.md](plans/implemented/scroll-strip-deferred-resync.md).

### The overlay plan does not inherit `ScrollStrip`'s settle relay

`ScrollStrip` additionally withholds a read whose signature *did* move while a resize burst is in flight, and arms an `afterNextLayout` relay to catch up ([ScrollStrip.ts:584](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L584)). `OverlayScrollbars` needs no relay: a changed band reads immediately, and the plan's own `sync()` already covers the content-changed-but-band-did-not case.[^no-relay]

### The pinning plan gets a corrections section; its design is left as history

`plans/table-column-pinning.md` is not re-designed. A new `## Corrections required before implementation` section goes in directly after its `## Overview`, records every drifted fact, and states plainly that it overrides the body wherever the two disagree. Beyond that section, only paths, frontmatter and two verification lines change.[^corrections-not-rewrite]

This follows how the repo already handles a plan whose body has been overtaken: [plans/implemented/docs-component-demo-set-remaining.md:23](plans/implemented/docs-component-demo-set-remaining.md#L23) (*"Follow the Addendum's corrected rules, not the pre-addendum body"*) and [plans/implemented/size-constraint-invariant-regressions.md:14](plans/implemented/size-constraint-invariant-regressions.md#L14) (*"The sections below are retained for historical context but describe the superseded … approach"*).

### The button exploration moves to `plans/implemented/`

`plans/button-primary-press-filtering-exploration.md` is moved beside its successor, [plans/implemented/primary-button-interaction-filtering.md](plans/implemented/primary-button-interaction-filtering.md), and gains one sentence in its `## Overview` saying which plan superseded it. The move is the decision; the sentence is what keeps the destination directory honest, because the exploration's specific `createStyleRule(".pressed")` mechanism never shipped.[^why-move]

The wording mirrors [plans/implemented/split-gutter-aware-sizing.md:9](plans/implemented/split-gutter-aware-sizing.md#L9) and [plans/implemented/npm-package.md:9](plans/implemented/npm-package.md#L9), the two places the repo already records one plan superseding another.

### Stale anchors are re-resolved by symbol name, never by guessing an offset

All three plans' `path#Lnnn` anchors point at unrelated code now. The two older ones also predate the workspace restructure, so their paths do not resolve at all. Each anchor is re-resolved by searching for the symbol it names in the current tree; one whose symbol cannot be found is dropped to a plain file link rather than left pointing somewhere wrong.[^anchor-policy]

---

## Internal Structure

Seven blocks of Markdown are inserted into the two amended plans — `G1`–`G6` into `plans/overlay-scrollbars-non-panel.md`, `P1` into `plans/table-column-pinning.md`. Copy each verbatim rather than paraphrasing; `## Ordered Implementation Steps` says where each one goes. Every path and line number in them was checked on 2026-09-17.

### Block G1 — new Architecture Decision

```markdown
### `apply()` reads scroll metrics only when the band or the target moved

`apply()` remembers the band it last read against and the metrics it last pushed. When `layout()` hands it the same `(x, y, width, height)` and neither the bar host nor the scroll element changed since that read, it performs no `getScrollMetrics` read and writes nothing to either bar. `sync()` defeats the gate by clearing the remembered band before it calls `apply()`, so a `sync()` always reads: it is the catch-up for a change the band cannot see, such as typing that grows `scrollHeight` or a native scroll that moves `scrollTop`.

This mirrors [`ScrollStrip.layoutItems`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L522), which compares a clamp signature built from cached geometry and reads live only when that signature moves — the fix that took a 2×2 editor grid's horizontal gutter drag from ~220 to ~104 ms/frame ([plans/implemented/scroll-strip-deferred-resync.md](plans/implemented/scroll-strip-deferred-resync.md)). `CodeEditor.doLayout` ([CodeEditor.ts:2733](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2733)) makes no live scroll read today, and this requirement is what keeps that true once the helper is wired into it.

The `"native"` opt-out is unaffected: a component with no helper has nothing to gate.
```

### Block G2 — replacement for the `apply()` step list

Replaces the five numbered steps currently at [plans/overlay-scrollbars-non-panel.md:160-164](plans/overlay-scrollbars-non-panel.md#L160).

```markdown
1. Resolve `host = target.barHost()` and `scroller = target.scrollElement()`. Return when either is missing or `width <= 0 || height <= 0`.
2. When `host !== this._host`, append both bar elements to `host` (`DOM.sink.appendChild(host, bar.getElement(true)!)`) and record it. This is also the first-append path. Remember that this pass re-homed.
3. When `scroller !== this._hiddenOn`, remove `OVERLAY_SCROLLER_CLASS` from the old element and add it to `scroller`, then record it. This is what re-homes the hidden bar when `CodeEditor`'s view mounts and `getScrollElement()` starts answering `.cm-scroller`. Remember that this pass re-homed.
4. **Return here** when `_lastMetrics` is set, the band equals `_appliedBand`, and neither step 2 nor step 3 re-homed anything. No read, no write.
5. Read `m = DOM.source.getScrollMetrics(scroller)` once. Store the band in `_appliedBand` and `m` in `_lastMetrics`.
6. Compute the band split and push it (table below).

Steps 2 and 3 run *before* the gate on purpose: both are keyed on element identity, not on the band, and a re-homed scroll element invalidates any cached metrics.

`sync()` sets `_appliedBand = null` before calling `apply()`, so step 4 can never hold for a `sync()` — that is what makes `sync()` the catch-up path for a content change the band cannot see. `dispose()` needs no change: `apply()` already returns early once a bar is null.

| Call | Band | Host / scroller | `getScrollMetrics` reads | Why |
|---|---|---|---|---|
| 1st `layout(0, 0, 400, 300)` | new | first append | 1 | nothing cached yet |
| 2nd `layout(0, 0, 400, 300)` | same | unchanged | 0 | gate hit — the steady per-frame case |
| `layout(0, 0, 400, 280)` | changed | unchanged | 1 | the band moved |
| `layout(0, 0, 400, 280)` once the mounted view makes `getScrollElement()` answer `.cm-scroller` | same | scroller changed | 1 | step 3 re-homed |
| `sync()` after typing, or from the native `"scroll"` handler | cached | unchanged | 1 | `sync()` is never gated |
```

### Block G3 — two fields for the class snippet

Added under `private _band` in the snippet at [plans/overlay-scrollbars-non-panel.md:149](plans/overlay-scrollbars-non-panel.md#L149). `ScrollMetrics` is imported as a type from `~/core/DOM.js` ([DOM.ts:58](packages/lib/src/typescript/lib/core/DOM.ts#L58)).

```markdown
    private _appliedBand : { x: number; y: number; width: number; height: number } | null = null;  // band the last read ran against
    private _lastMetrics : ScrollMetrics | null = null;                                            // metrics last pushed to the bars
```

### Block G4 — new Expected Behaviour case

Appended to the *Unit-testable offline* list as case 18.

```markdown
18. **An unchanged band performs no read** — after a first `layout(0, 0, 400, 300)`, nine further `layout(0, 0, 400, 300)` calls with the same bar host and scroll element leave the `DOM.source.getScrollMetrics` spy at one call. A following `layout(0, 0, 400, 280)` takes it to two. `sync()` reads on every call regardless of the cached band. Mirror the harness of [`ScrollStrip.resizeResyncCoalescing.test.ts`](packages/lib/tests/component/container/ScrollStrip.resizeResyncCoalescing.test.ts).
```

### Block G5 — `MarkdownEditor` in the manual-verification set

Appended to the *Manual verification in the browser* bullet list.

```markdown
- **`MarkdownEditor` (Markdown Editor demo panel, `packages/lib/src/typescript/MarkdownEditorPanel.ts`)** — `MarkdownEditor` owns a `CodeEditor` as its raw-Markdown surface ([MarkdownEditor.ts:1108](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1108)), so it inherits the bars. In `"source"` mode ([setMode](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1224)) the bars must behave exactly as in a standalone editor. In `"wysiwyg"` mode the `Card` undisplays that editor ([Card.ts:197](packages/lib/src/typescript/lib/layout/Card.ts#L197)), so it must contribute no scroll read at all.
```

### Block G6 — how the shared numeric core composes

Appended to the decision *`Panel` and `VirtualScroller` are not migrated onto the helper*.

```markdown
A separate proposal extracts a shared *numeric* core from `Panel` and `VirtualScroller` — a `resolveScrollbarLayout(...)` function plus a `ScrollbarPair` holder that owns the two bars, the shadow host and the bar placement. That extraction composes with this decision rather than reversing it: `OverlayScrollbars` becomes a third consumer of the shared visibility and placement maths and of the bar pair, while each owner keeps its own scroller plumbing. Nothing in this plan should be written so that sharing that core later means undoing it.
```

### Block P1 — the pinning plan's corrections section

```markdown
## Corrections required before implementation

Re-checked against `master` on 2026-09-17. Everything in this section overrides the plan body wherever the two disagree; the body is kept for its design reasoning, which is still sound, not for its facts about the current code.

**The plan is scheduled behind three table-performance plans.** `PinnedTable` owns two full `Table` instances over one store, so every per-pass cost the render review measured in the table subsystem **doubles** under pinning: two `Body.renderWindowPass` runs, two `_updateFocusStyle` materialisations, two empty-apply fans, two `applyRequiredEmptyState` sweeps, two never-shown `FooterRow`s. Implementing pinning first would bake that doubling in before the single-table costs are removed. The `depends-on` frontmatter names the three plans that remove them.

**Three facts the body states are no longer true.**

1. `Body.setSelectedRecords(records: ModelRecord[])` already exists ([Body.ts:2331](packages/lib/src/typescript/lib/component/table/Body.ts#L2331)). The step that adds it is already done, and its `## Public API` entry describes a method that is already there. The selection design is unaffected — it just adds nothing.
2. The right body does **not** have `overflow-y: auto`. `Body`'s constructor calls `setOverflow("hidden")` ([Body.ts:348](packages/lib/src/typescript/lib/component/table/Body.ts#L348)) and delegates scrolling to `VirtualScroller`, whose clip box is `overflow: hidden` ([VirtualScroller.ts:85](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L85)). Scrolling is transform-based, so **the body never fires a native DOM `scroll` event** — `Table`'s own constructor says so and mirrors the header off the body's `"horizontalscroll"` event instead ([Table.ts:366-372](packages/lib/src/typescript/lib/component/table/Table.ts#L366)). Any design that waits for a native `scroll` on the body will never fire.
3. `setScrollY` is no longer defined on `Body`; it is inherited from `VirtualRowView` ([VirtualRowView.ts:196](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L196)). Mirroring through it still works — the call site is unchanged.

**The callback-setter seams the plan wires no longer exist.** `Body` and `TableHeader` publish typed events now, consumed with `on(...)`:

| The plan wires | What exists today |
|---|---|
| `Body.setOnVerticalScroll(fn)` | `BodyEvent = "verticalscroll" \| "horizontalscroll" \| "selection" \| "cellclick" \| "cellcontextmenu"` ([Body.ts:38](packages/lib/src/typescript/lib/component/table/Body.ts#L38)), emitted at [Body.ts:1067-1068](packages/lib/src/typescript/lib/component/table/Body.ts#L1067) |
| `Header.setOnColumnResize`, `onColumnContextMenu` | `TableHeaderEvent = "columnresizestart" \| "columnresize" \| "columncontextmenu"` ([Header.ts:181](packages/lib/src/typescript/lib/component/table/Header.ts#L181)), wired by `Table` at [Table.ts:330-332](packages/lib/src/typescript/lib/component/table/Table.ts#L330) |

The plan's step *Add `Body.setSelectedRecords` and `Body.setOnVerticalScroll`* also proposes a private handler that reads `this.getElement()!.scrollTop`. That is a raw DOM read outside the seam and is a **build error** under the `local/no-raw-dom` ESLint rule ([ARCHITECTURE.md:130](ARCHITECTURE.md#L130)). Drop the whole `setOnVerticalScroll` addition and subscribe to `"verticalscroll"` instead.

**Symbols the plan navigates by, at their current locations.**

| Symbol | Current location |
|---|---|
| `Body._selectedRecords` / `selectRecord` / `setSelectedRecords` | `component/table/Body.ts:313` / `:2285` / `:2331` |
| `Table` constructor | `component/table/Table.ts:302` |
| `Column.resolve` / `Column.getHeaderGlyph` | `component/table/Column.ts:258` / `:154` |
| `ColumnConfig.hidden` / `groupColor` | `component/table/ColumnConfig.ts:104` / `:248` |
| `TableLayout.attach` | `layout/Table.ts:104` |
| `Menu` | `overlay/Menu.ts` (not `core/Menu.ts`) |

The plan also predates the `Header`/`Body` column-window reconcilers, the cell cache, the slide fast path, cell-range selection and rotated mode. Re-read `Body.ts` and `Table.ts` in full before starting; both have roughly doubled in size since this plan was drafted.
```

---

## Ordered Implementation Steps

All edits happen inside the worktree. Steps 1–8 amend one plan, 9–12 the second, 13–14 the third.

### A. `plans/overlay-scrollbars-non-panel.md`

1. **Add the read-skipping decision.** Insert *Block G1* as the last `###` subsection of `## Architecture Decisions`, directly after the decision *The native `"scroll"` event reaches the owner through `Event.addSubtreeListener`* and before the `---` that closes the section.
   *Check:* `grep -n 'reads scroll metrics only when' plans/overlay-scrollbars-non-panel.md` — exactly one match, on a `###` line.

2. **Add the two cached fields.** In the `## Internal Structure` code block, insert *Block G3*'s two lines directly below the `private _band` line, keeping the existing column alignment of the `:` and `=` in that block.

3. **Replace the `apply()` step list.** In `## Internal Structure`, replace the five numbered items — the run that begins *Resolve `host = target.barHost()`* and ends *Compute the band split and push it (table below).* — with *Block G2* in full, including its two trailing paragraphs and its table. Leave the sentence above the list and the `dispose()` sentence below it untouched.
   *Check:* `grep -n 'Return here' plans/overlay-scrollbars-non-panel.md` — exactly one match.

4. **Add the behaviour case.** Append *Block G4* after case 17 in `## Expected Behaviour` → *Unit-testable offline*.

5. **Add the `MarkdownEditor` verification bullet.** Append *Block G5* to the bullet list under *Manual verification in the browser*, after the `Panel` is unaffected bullet.

6. **Add the composition note.** Append *Block G6* as a new final paragraph of the decision *`Panel` and `VirtualScroller` are not migrated onto the helper*, after the sentence beginning `What the three genuinely share is already shared`.

7. **Add one verification line.** In `## Verification`, after the `npm test` bullet, add:

   ```markdown
   - `OverlayScrollbars.test.ts` case 18 is green — ten identical `layout()` calls produce one `getScrollMetrics` read, not ten.
   ```

8. **Re-base the source anchors.** Every `#L` anchor in this plan except `SmoothScroller.ts#L50` and `Panel.ts#L126` now lands on unrelated code. Re-resolve each by the symbol it names, using the table below for the ones the steps navigate by, and `grep -n` for the rest. Two need more than a new number, and are called out under *Two anchors that are not just off by a few lines*.

   | Symbol the plan names | Current location |
   |---|---|
   | `ScrollbarStyle` type | `packages/lib/src/typescript/lib/core/Panel.ts:53` |
   | `OVERLAY_SCROLLER_CLASS` / `_scrollerClassRules` / `ensureOverlayScrollerClassRule` | `core/Panel.ts:121` / `:126` / `:136` |
   | `Panel.doLayout`, and its `commitElementStyle()` call | `core/Panel.ts:650`, `:660` |
   | `LayoutManager.commitBounds` | `layout/LayoutManager.ts:570` |
   | `Scrollbar` class / `setMetrics` / `getTrackWidth` | `component/container/Scrollbar.ts:519` / `:785` / `:867` |
   | `VirtualScroller` class / constructor | `component/container/VirtualScroller.ts:44` / `:70` |
   | `CodeEditor` class / `_defaultCodeEditorOptions` / `applyOptions` | `component/editor/CodeEditor.ts:469` / `:241` / `:709` |
   | `CodeEditor`'s `onFirstLayout(() => this.mount())` / `destructor` / `EditorView.updateListener.of` | `CodeEditor.ts:696` / `:1726` / `:2087` |
   | `TextArea` class / `_defaultTextAreaOptions` / `applyOptions` | `component/input/TextArea.ts:65` / `:38` / `:101` |
   | `TextInput`'s "must not wire a second `input` listener" rule | `component/input/TextInput.ts:184` |
   | `Component.setClipFrame`, and its `getParentNode` read | `core/Component.ts:1445`, `:1452` |
   | `Event`'s capture-phase option / the `if (id)` walk guard | `core/Event.ts:186` / `:320` |
   | `ScrollbarStyle` re-export | `core/index.ts:28` |
   | The class-default registry array | `packages/lib/tests/component/default-options-fallback.test.ts:279` |

   **Two anchors that are not just off by a few lines.** Both sit in the overlay plan's own numbered steps; the numbers below are that plan's, not this one's.

   - **Its step 9 has an insertion point that no longer exists.** That step says to add `refreshOverlayScrollbars()` to `TextArea`'s constructor body *after the existing `this.setElementCSSRules({ resize: "none" })`*. The call is gone: `resize: "none"` is now a module-level class-scope `StyleRule` at [TextArea.ts:19](packages/lib/src/typescript/lib/component/input/TextArea.ts#L19), and `TextArea`'s constructor body ([TextArea.ts:84](packages/lib/src/typescript/lib/component/input/TextArea.ts#L84)) contains nothing but its `super(...)` call. Rewrite that step to say: add the call as the first statement after `super(...)` returns.
   - **Its step 3 carries a wrong z-index rationale.** That step justifies `CM_OVERLAY_BAR_Z_INDEX = 250` as sitting *"above CodeMirror's sticky gutter (z-index: 200) and below the read-only flash overlay (z-index: 300)"*. The read-only wash is 400, not 300 ([CodeEditor.ts:2622](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2622)); 300 is CodeMirror's own panels. The documented ladder is gutters 200, CodeMirror panels 300, search panel 350, read-only wash 400, tooltips 500 ([CodeEditor.ts:340-347](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L340)). Keep the value 250 and rewrite the comment against that ladder, noting that 250 deliberately sits below CodeMirror's own panels so a completion list or the search panel covers a bar.

   *Check:* for each `path#Lnnn` anchor left in the file, `sed -n '<nnn>p' <path>` shows the symbol the surrounding sentence names.

### B. `plans/table-column-pinning.md`

9. **Fix the frontmatter.** Replace the whole block with:

   ```yaml
   ---
   depends-on: [table-render-pass-economy, table-resize-settle-relay, table-header-and-cell-write-economy]
   touches-shared: [packages/lib/src/typescript/lib/component/table/Column.ts, packages/lib/src/typescript/lib/component/table/ColumnConfig.ts, packages/lib/src/typescript/lib/component/table/index.ts]
   ---
   ```

   The three `depends-on` entries are the slugs the render review reserved for those three plans; none is drafted yet. Declaring a dependency on a plan that has not been implemented is already the repo's habit — `plans/tauri-desktop-hardened-python.md` depends on `tauri-desktop-prototype`, which is still sitting in `plans/`. Naming one not yet drafted goes one step further and is deliberate: `/implement` derives its own order when frontmatter is absent, so the only way to stop pinning being scheduled first is to say so in the file.

10. **Re-base the paths.** Do this before step 11, so the section that step inserts — which already carries correct paths — cannot be rewritten a second time. Apply the rewrite below across the whole file, dropping the `#Lnnn` fragment from every link as you go: the numbers are all stale, and a plain file link is better than a wrong line.

    | Before | After |
    |---|---|
    | `../src/typescript/lib/…` | `packages/lib/src/typescript/lib/…` |
    | `src/typescript/lib/…` (bare, in the files table) | `packages/lib/src/typescript/lib/…` |
    | `../src/typescript/MiscPanel.ts` | `packages/lib/src/typescript/MiscPanel.ts` |
    | `docs/components/…` | `packages/lib/docs/components/…` |
    | `…/lib/core/Menu.ts` | `packages/lib/src/typescript/lib/overlay/Menu.ts` |

    Rewrite only a `src/typescript/` that is not already preceded by `packages/lib/`, or the prefix is applied twice. Leave `../ARCHITECTURE.md` and `../.claude/skills/_shared/docs-conventions.md` alone — both still resolve from `plans/`.
    *Check:* `grep -c 'packages/lib/packages' plans/table-column-pinning.md` — zero. `grep -n '\.\./src/typescript' plans/table-column-pinning.md` — zero matches.

11. **Insert the corrections section.** Add *Block P1*, from `## Internal Structure` above, verbatim and directly after the `---` that closes `## Overview`, so it is the first section a reader meets after the summary. Its paths are already correct — do not re-run step 10's rewrite over it.

12. **Fix the two remaining verification and docs lines.**
    - `## Verification`: change `grep -rn 'position:\s*sticky' src/` to `grep -rn 'position:\s*sticky' packages/lib/src/`.
    - `## Documentation Impact` and the files table: `docs/.vitepress/config.mts` does not exist — the docs site is no longer VitePress; it is a typescript-ui app at `packages/docs/` with its own `src/shell/` and `src/content/`. Replace both mentions with a sentence saying the sidebar and catalog entry must be re-derived from `packages/docs/src/`, following whatever a recently added component page does, per the repo's `.claude/skills/_shared/docs-conventions.md`.

### C. `plans/button-primary-press-filtering-exploration.md`

13. **Record the supersession.** Add this as a new paragraph at the end of that plan's `## Overview`, just before the closing `---`:

    ```markdown
    **Superseded.** This exploration was overtaken by [plans/implemented/primary-button-interaction-filtering.md](plans/implemented/primary-button-interaction-filtering.md), which shipped the per-registration button filter and moved `Button`'s pressed visual off the native `:active` pseudo-class. Do not implement this plan. Its `createStyleRule(".pressed")` mechanism was not what shipped — `Button` declares `.pressed` and `:hover` as class-tier states in `ownStyleStates` ([Button.ts:408](packages/lib/src/typescript/lib/component/button/Button.ts#L408)) and toggles them with `setStyleState` ([Button.ts:591](packages/lib/src/typescript/lib/component/button/Button.ts#L591)). Every path it cites predates the workspace restructure and resolves to nothing. It is kept for the alternatives it weighed and rejected, notably `setPointerCapture`.
    ```

14. **Move the file.** `git mv plans/button-primary-press-filtering-exploration.md plans/implemented/button-primary-press-filtering-exploration.md`.
    *Check:* `ls plans/*.md | wc -l` — one fewer than before; `ls plans/implemented/button-primary-press-filtering-exploration.md` resolves.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `plans/overlay-scrollbars-non-panel.md` |
| Modify | `plans/table-column-pinning.md` |
| Modify | `plans/button-primary-press-filtering-exploration.md` |
| Move | `plans/button-primary-press-filtering-exploration.md` → `plans/implemented/button-primary-press-filtering-exploration.md` |

No file is created or deleted, and nothing under `packages/` is touched.

---

## Verification

This change adds no code, so the project's typecheck, test and build commands are unaffected and need not be run. The checks below are the ones that matter.

- `git status` — the only paths in the diff are under `plans/`. Nothing under `packages/` appears.
- `ls plans/*.md` — `button-primary-press-filtering-exploration.md` is gone; `overlay-scrollbars-non-panel.md` and `table-column-pinning.md` are still there.
- `grep -n 'Return here' plans/overlay-scrollbars-non-panel.md` — one match, inside the `apply()` step list.
- `grep -n '_appliedBand\|_lastMetrics' plans/overlay-scrollbars-non-panel.md` — both appear in the class snippet and in the step list.
- `grep -n 'MarkdownEditorPanel' plans/overlay-scrollbars-non-panel.md` — one match, in the manual-verification list.
- `grep -n '\.\./src/typescript\|\.vitepress' plans/table-column-pinning.md` — zero matches.
- `grep -n 'Corrections required before implementation' plans/table-column-pinning.md` — one match, immediately after `## Overview`.
- `grep -n 'Superseded' plans/implemented/button-primary-press-filtering-exploration.md` — one match, in `## Overview`.
- For every `path#Lnnn` anchor written or re-based by this change, `sed -n '<nnn>p' <path>` shows the symbol the surrounding sentence names.

---

## Potential Challenges

- **The pinning plan's corrections section will read as contradicting its own body.** That is intended and stated in the section's first paragraph; the alternative — rewriting 531 lines of design prose — is the pinning implementer's job, not this one's.
- **A `depends-on` entry naming a plan that does not exist yet** could look like a mistake to a later reader. Step 9's note says why it is deliberate.
- **Re-basing anchors is the step most likely to be rushed.** Each one is a one-line `grep -n` for the symbol the sentence already names; the checks closing steps 8 and 10 catch a skipped one.
- **Two of the overlay plan's anchors changed meaning, not just position** — the `TextArea` constructor insertion point and the z-index rationale. Both sit inside step 8 and are easy to skim past, which is why step 8 gives them their own heading.

---

## Critical Files

- [plans/research/render-review-2026-09-15/99-synthesis.md:1260](plans/research/render-review-2026-09-15/99-synthesis.md#L1260) — the `G01` brief this plan implements.
- [plans/research/render-review-2026-09-15/00-baseline.md](plans/research/render-review-2026-09-15/00-baseline.md) — the measured cost model behind the read-skipping requirement.
- [plans/implemented/scroll-strip-deferred-resync.md](plans/implemented/scroll-strip-deferred-resync.md) — the shipped clamp-signature gate the overlay plan's new requirement mirrors.
- [packages/lib/src/typescript/lib/component/container/ScrollStrip.ts:522](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L522) — that gate in code, including the settle relay this plan deliberately does not copy.
- [plans/implemented/primary-button-interaction-filtering.md](plans/implemented/primary-button-interaction-filtering.md) — the successor the button exploration is filed beside.
- [plans/implemented/split-gutter-aware-sizing.md:9](plans/implemented/split-gutter-aware-sizing.md#L9) and [plans/implemented/npm-package.md:9](plans/implemented/npm-package.md#L9) — how this repo words one plan superseding another.
- [plans/implemented/docs-component-demo-set-remaining.md:23](plans/implemented/docs-component-demo-set-remaining.md#L23) — how this repo words a corrections section that overrides a plan body.

---

## Non-Goals

- **Implementing any of the three plans.** This plan makes two of them safe to start and retires the third; it starts none of them.
- **Rewriting `plans/table-column-pinning.md`'s design.** Its dual-`Table` architecture is not reopened. Only its facts, paths, frontmatter and schedule change.
- **Changing `plans/overlay-scrollbars-non-panel.md`'s architecture.** The composed helper over a callback seam, the overlay-rather-than-inset decision, and the choice not to migrate `Panel` or `VirtualScroller` all stand.
- **Drafting the three table-performance plans** named in the pinning plan's new `depends-on`. They come from the same review and are separate work.
- **Extracting the shared scrollbar numeric core.** Block G6 records only that it composes with the overlay plan; the extraction itself is a different plan.
- **Touching any other plan in `plans/`.** The review flagged exactly three.

---

## Implementation Notes

- **Every step landed as written; the deviations below are all widenings of a step, never a
  narrowing.** All 50-odd source locations the plan asserts were re-checked against `master`
  before any edit and every one held, so no codebase drift had to be resolved. `npm run
  typecheck` is clean; the plan's own `## Verification` correctly waives the test and build
  commands, since nothing under `packages/` changed.

- **Step 2's "keeping the existing column alignment" meant re-aligning the whole field block,
  not just the two new lines.** `_appliedBand` and `_lastMetrics` are three characters longer
  than the block's previous widest name (`_hiddenOn`), so inserting *Block G3* verbatim at the
  old column would have left the `:` ragged. The eight existing declarations were re-padded so
  the `:` column still lines up; only whitespace moved, and *Block G3* itself is verbatim.

- **Step 8's re-basing had to move the link *labels*, not only the anchors.** Ten of the overlay
  plan's links are written `[L204](…#L204)` — the visible label repeats the line number. Moving
  only the anchor would have left the label asserting the old, wrong line, which is the staleness
  this step exists to remove. Each label now names the line its anchor points at. The same rule
  drove step 10 in the pinning plan, where dropping a `#Lnnn` fragment also meant trimming the
  label (`[Body.ts:433-449]` → `[Body.ts]`), so no label survives asserting a dropped line.

- **`Panel.ts:126-158` was re-based to `121-153` even though step 8 lists `Panel.ts#L126` as an
  anchor that still lands.** It does still land — on `_scrollerClassRules`, the second of the
  three symbols that sentence names. But the sentence's first symbol, `OVERLAY_SCROLLER_CLASS`,
  is at 121 (step 8's own table says so) and the function it ends with closes at 153, so the
  visible range `126-158` named neither end correctly.

- **The wrong z-index appears twice in the overlay plan, and both were corrected.** Step 8 calls
  out the rationale in that plan's step 3; the identical `z-index: 300` claim also sits in its
  *Manual verification in the browser* list, where the read-only wash is likewise 400
  ([CodeEditor.ts:2622](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2622)).
  Fixing one and leaving the other would have left the plan contradicting itself.

- **Step 12 names two `docs/.vitepress/config.mts` mentions; there are three.** The third is in
  the pinning plan's `## Ordered Implementation Steps`. This plan's `## Verification` requires
  `grep -n '\.\./src/typescript\|\.vitepress' plans/table-column-pinning.md` to return zero
  matches, which settles it — all three now point at `packages/docs/src/` instead.

- **`docs/api/component/table/` was deliberately left un-prefixed.** Step 10's rewrite table
  covers `docs/components/…`, not `docs/api/…`, and that path names generated output
  (`packages/lib/docs/api` is gitignored) which the repo's own
  `.claude/skills/_shared/docs-conventions.md` also writes bare. Prefixing it would have
  diverged from the convention the plan points readers at.

---

## Notes

[^reverified]: The review was written on 2026-09-15 and four correctness branches merged on 2026-09-17, so every claim was re-checked before being written down. Every substantive one held. One line number had drifted again in the two days between and is corrected here: the review put `Body.setSelectedRecords` at `Body.ts:2285-2302`, which is `selectRecord` today — the method it means is at `:2331`. Three claims turned out to understate the problem and are widened here: `plans/overlay-scrollbars-non-panel.md`'s own anchors are stale too, with one insertion point and one z-index rationale outright wrong; `plans/table-column-pinning.md` wires callback setters that typed events have replaced; and one method it proposes would read the DOM outside the seam and fail the build.

[^why-gate]: The shape the plan specifies today — a style commit followed immediately by a live `getScrollMetrics` read, inside `doLayout`, once per visible editor per frame — is the same shape that cost ~110 ms/frame in `ScrollStrip` before it was gated. `CodeEditor.doLayout` makes no such read today ([CodeEditor.ts:2733](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2733)), so the plan would introduce a regression rather than compound one. The baseline measurement puts a 2×2 editor grid's horizontal gutter drag at 103.9 ms/frame against a 16.7 ms budget, with per-frame JS write churn already at zero — there is no headroom to spend on a new forced read. The plan's own expected-behaviour case 6 (`layout(0,0,0,0)` performs no read) already accepts read-skipping as part of the contract, so the gate extends an existing rule rather than adding a new kind of one.

[^no-relay]: `ScrollStrip` withholds a read during a resize burst because its consumer — arrow enablement — is cosmetic and can lag a few frames. `OverlayScrollbars` pushes thumb geometry, which cannot lag a resize without the thumb visibly detaching from the content. Reading immediately on a changed band is both correct and cheap, because a band only changes on frames where the editor is genuinely being resized. Copying the relay would add an `afterNextLayout` handle, two flags and a flush path for no benefit.

[^corrections-not-rewrite]: Rewriting the pinning plan means re-designing its selection mirror and its scroll mirror against an event API that did not exist when it was drafted, and re-deriving its docs steps against a docs site that is no longer VitePress. That is design work, and it belongs to whoever next picks the plan up with the current files in front of them. Recording the corrections is enough to stop the plan being implemented as written, which is the only thing that had to happen before the three table-performance plans land.

[^why-move]: Two placements were weighed. Marking it superseded in place leaves it in `plans/`, which is the live queue `/implement` resolves names against and the list a future review reads as open work — and a banner only helps a reader who stops to read it. Moving it makes the file unreachable by name (`/implement` rejects a plan it cannot find at `plans/<name>.md`) and puts it beside the plan that actually shipped, where its rejected alternatives stay discoverable. The repo's one earlier precedent, `plans/split-layout-selection-shift.md`, was deleted outright in commit `3587f8e7` once `split-gutter-aware-sizing` superseded it; deletion is rejected here because the exploration weighed `setPointerCapture` and a filter-in-dispatcher design in more depth than its successor records, and that reasoning is worth keeping reachable. The one cost of moving is that `plans/implemented/` normally means "was carried out", and this plan's `.pressed` rule mechanism was not — which is what the added sentence says out loud.

[^anchor-policy]: Of the 32 distinct `#L` anchors in `plans/overlay-scrollbars-non-panel.md`, exactly two still land on the code their sentence describes. Guessing a corrected offset from how far the file has grown does not work: `Scrollbar.setMetrics` moved from 569 to 785, while `Component.setClipFrame` moved from 1029 to 1445 — different files drifted by very different amounts, and two anchors changed meaning entirely rather than position. Searching for the named symbol is the only method that gets all of them right, and it is what the check at the end of each re-basing step confirms.
