---
depends-on: [checkbox-action-activation, doc-and-qa-record-drift]
touches-shared:
  - packages/qa/src/harness/ablations.ts
  - packages/qa/src/harness/counters.ts
  - packages/qa/src/harness/types.ts
  - packages/qa/src/harness/run.ts
  - packages/qa/src/main.ts
  - packages/qa/src/builders/shell.ts
  - packages/qa/bin/qa-table.py
  - packages/qa/README.md
---

# W3.0 Bounding Sweep — Implementation Plan

## Overview

Wave 3 of the render-performance campaign must be planned from measurement, not from the synthesis's ceilings, which were taken before three waves landed ([`00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L130), Phase 3). This plan builds that measurement, the way W2.0 — the bounding sweep run before wave 2 — built wave 2's ([`97-wave2-measurement.md`](plans/research/render-review-2026-09-15/97-wave2-measurement.md)). It changes only `packages/qa`; the library is not touched. The orchestrator runs the sweep once this plan is implemented, and plans wave 3 from its results.

It delivers five things:

1. **A status pass** of every wave-3 candidate against `master` `09a99c2a` (*Status Pass*, below). One candidate, G29, has no runtime work and is excluded. Eight sub-items are gone, and several candidates are partly absorbed. The two existing `split.*` ablations turn out not to measure what their names say.
2. **A bounding arm per live candidate**: 24 new runtime ablations in [`packages/qa/src/harness/ablations.ts`](packages/qa/src/harness/ablations.ts), two existing ones rewritten, and five counter-only reads. Each ablation counts its own engagement and has offline tests.
3. **The sweep**: a fresh baseline plus a same-session A/B matrix, delivered as the script `packages/qa/sweeps/w3-0.sh` — 20 batches, 394 runs, about 1 h 40 min of run time in three sessions.
4. **The analysis**: a new analyser `packages/qa/bin/qa-ab.py` that applies one decision rule to every cell, and a `--work` listing in `qa-table.py`.
5. **The owed in-engine witnesses** for C40 and C21, as the sweep's last batch.

The harness gains two small capabilities the ablations need: an ablation receives the page's library objects as well as the tools, and the work counters gain four methods. Six panels gain geometry labels or work counters, so that each arm's soundness and saving are visible.

---

## Architecture Decisions

### The sweep mirrors W2.0, in the QA app

Every bound is a same-session, interleaved A/B between a plain arm and an arm that removes one candidate's work at runtime. Each bound is scored on work avoided and on milliseconds, and gated on identical geometry. That is W2.0's method ([`97-wave2-measurement.md`](plans/research/render-review-2026-09-15/97-wave2-measurement.md#L1)), run in the QA app's panels instead of Loom's retired shell. The ablations follow the existing entries in [`ablations.ts`](packages/qa/src/harness/ablations.ts#L153) (`splitNoopDrag`, `splitRecalcGate`): each patches a prototype found through the tools, bumps its own counter, and returns a one-line note.[^w20-lessons]

### One bounding arm per candidate, chosen in a fixed order

For each live candidate the arm is, in order of preference:

1. **An ablation** that removes the candidate's work while keeping geometry equal.
2. **A counter-only read** of the baseline, where the counts alone decide the question.
3. **A prototype library-fix arm** built as `wt`, only where neither of the first two can work without changing geometry.

No candidate needs the third kind in this sweep.[^no-wt] The choice for each candidate, and why, is in *Status Pass*.

### An ablation bounds a whole group, with one counter per sub-item

Where a group bundles several findings, one ablation applies every sub-item that can be patched soundly, and each sub-item bumps its own counter. The verdict is taken per group, which is the unit wave 3 plans. The counters show which sub-items engaged.[^group-arm] Sub-items that cannot be patched soundly are named in *Status Pass* as unbounded, with the reason.

### Ablations receive the page's library objects

The `Ablation` type becomes `(tools: HarnessTools, lib: HarnessLibrary) => string`, and `applyAblations` passes the run's `lib`. `HarnessLibrary` gains two optional members, `Tooltip` and `AbstractWindow`, which the page imports from `@jimka/typescript-ui/overlay` and passes in. The harness still imports nothing from the library.[^lib-plumb]

### Every ablation names its counters after itself

An ablation's own counters are work counters named `skipped.<ablation>.<what>`, `memo.<ablation>.<what>` or `dose.<ablation>.<what>`, where `<ablation>` is its `abl=` name verbatim. `<what>` is camelCase with no hyphen. `dose.` joins `memo.`, `skipped.` and `stubbed.` as a bookkeeping prefix, which `work/u` leaves out.[^naming]

| Ablation | Counter | Meaning |
|---|---|---|
| `g05.lazy-reads` | `skipped.g05.lazy-reads.resolve` | one `resolveBounds` served without its four size reads |
| `g08.env-reads` | `memo.g08.env-reads.themeVarHit` | one `getThemeVar` served from the memo |
| `g20.walk-dose` | `dose.g20.walk-dose.extraCall` | one extra call the dose added |

The two existing `split.*` ablations are renamed to this scheme.

### `split.noop-drag` and `split.recalc-gate` are rewritten in place

On `master` `split.noop-drag` never engages, and `split.recalc-gate` always keyed on the string `"[]"`. Both are rewritten under their existing names so that each bounds the finding its name claims.[^split-rewrite]

### Soundness has three gates, declared per cell

1. **Geometry**: every labelled rectangle equal to the first plain arm's, in every unit.
2. **Declared counter equality** (`--same`): where geometry is blind to what an arm could break, a named counter must equal the plain arm's. Examples are a chart's marks and a Markdown viewer's active heading.
3. **Declared expected differences** (`--allow-diff`): where an arm changes a rectangle by design, the cell names the label, and optionally the phase, that may differ.

Each cell's gates are listed in *The Matrix*.[^soundness]

### One instrument set for every run

Every run of the sweep, baseline and witnesses included, carries `work=1&seam=1&geom=1` and nothing else. No run uses `count=1` or `deepwrites=1`.[^flags]

### A scored cell is three plain runs and two mirrored repetitions per arm

A **scored cell** is one panel, one set of parameters and one `drive=`, run as follows:

```
plain-a, A-1, B-1, C-1, plain-b, C-2, B-2, A-2, plain-c
```

A cell with `k` arms is `3 + 2k` runs. A **check cell**, used where only deterministic counts are read, is `plain-a`, each arm once, then `plain-b`.[^mirrored]

### Batches are self-bracketed; sessions only group batches

A **batch** is a list of cells run back to back. Every cell carries its own plain arms, so a batch can be re-run on its own, on another day, under a new session tag. Batches are grouped into three sessions of about 30–40 minutes for convenience; no comparison crosses a batch.[^batches]

### Run names encode session, batch, cell, arm and repetition

A run is named `w3<session>-<batch>-<cell>-<arm>-<rep>`. The session tag defaults to `s1`. A cell tag is lowercase letters and digits only, so one cell's prefix never matches another's.

| Run name | Session | Batch | Cell | Arm | Rep |
|---|---|---|---|---|---|
| `w3s1-b02-sdp-plain-a` | `s1` | `b02` | `sdp` | plain | `a` |
| `w3s1-b02-sdp-split.noop-drag-2` | `s1` | `b02` | `sdp` | `split.noop-drag` | `2` |
| `w3s2-b02-sdp-plain-c` | `s2` (a re-run) | `b02` | `sdp` | plain | `c` |

`qa-table.py packages/qa/results w3s1-b02-sdp-` then tabulates exactly one cell, with its first plain arm as the geometry reference.

### A new analyser applies the decision rule

`packages/qa/bin/qa-ab.py <results-dir> <cell-prefix>` reads one cell and prints, per phase and arm: Δms against the plain arms, the plain arms' spread, the change in a named counter, the geometry gate, engagement, and the cell verdict. It is a new script beside `qa-table.py`, self-contained like the other two.[^analyser] `qa-table.py` gains `--work`, which lists each phase's work counters as `--seam` lists the seam counters.

### The decision rule

**Per arm, in one cell** — `qa-ab.py` computes these:

- **bracket** is the largest plain average minus the smallest, over the cell's plain arms.
- **Δms** is the arm's mean average minus the plain arms' mean average.
  - `ms` is `win` when Δms < −bracket, `regress` when Δms > +bracket, and `flat` otherwise.
- **Δc** is the change in the cell's named counter from the plain mean to the arm mean.
  - `work` is `win` when Δc falls by at least 10% of the plain value and by at least 1.0 per unit. It is `more` when Δc rises by those amounts, and `flat` otherwise.
- **engaged** is `yes` when the arm's own counters (`skipped.<arm>.`, `memo.<arm>.`, `dose.<arm>.`) sum above 0 in every repetition.
- **geom** is `=` when every repetition's geometry equals the first plain arm's, outside the declared `--allow-diff` labels. It is `DIFF` otherwise, and `unstable` when the plain arms disagree among themselves. A `--same` counter that differs by more than 1% also makes the arm `DIFF`.

The cell verdict takes the first line that applies:

| Order | Condition | Cell verdict |
|---|---|---|
| 1 | geom is `DIFF` or `unstable` | `void` |
| 2 | engaged is not `yes` | `unreached` |
| 3 | the arm is a dose arm (`dose.` counters) | `dose` |
| 4 | ms is `regress` | `regress` |
| 5 | work is `win`, or ms is `win` | `win` |
| 6 | otherwise | `flat` |

W2.0's own numbers show the rule. They come from two of the review's Loom scenarios: S1, a 2×2 editor grid's gutter drag, and S3, the explorer gutter drag. S3's plain arms read 58.99 and 57.95, so the bracket is 1.04:

| W2.0 arm | Δms | ms | Δwork | work | geom | Cell verdict |
|---|---|---|---|---|---|---|
| `accordion.seed` on S3 | −3.19 | `win` | −19.9% | `win` | `=` | `win` |
| `clamp.once` on S3 | −1.00 | `flat` | 0.0% | `flat` | `=` | `flat` |
| `size.memo` on S1 (bracket 0.15) | +0.58 | `regress` | −65.2% | `win` | `DIFF` | `void` |

**Per candidate, over all its cells** — the orchestrator applies this:

| Order | Condition | Candidate verdict |
|---|---|---|
| 1 | any cell `void` or `regress` | **needs a different surface** |
| 2 | every cell `unreached` | **needs a different surface** |
| 3 | any cell `win` | **plan it** |
| 4 | otherwise | **drop it** |

Under this rule W2.0 would have read G13 as *plan it*, G10 as *drop it*, and the size-hint memo as *needs a different surface*. The last is what happened: it was re-designed per pass and gated by an offline prototype. *Needs a different surface* means the ablation could not bound the candidate — a panel, a driver, or a prototype library arm must be built first. The rule's reasoning is in the footnote.[^rule]

Two kinds of arm read differently:

- **The dose arm (`g20.walk-dose`)** adds the candidate's work instead of removing it. Its `work` verdict comes from the plain arms' counts: the fix removes the counted walk calls, so `work` is `win` when those calls are at least 10% of the phase's seam source calls and at least 1.0 per unit. Its `ms` verdict is `win` when the dose arm's Δms exceeds +bracket, meaning a second walk costs visible frame time.
  The candidate is *plan it* when either is `win`, and *drop it* otherwise. A dose cell that reads `void` or `unreached` makes it *needs a different surface*, as for any arm.
- **Counter-only reads** each carry their own rule in *Counter-only reads*.

### The owed witnesses ride in the same sweep

Two fixes merged without their in-engine check. C40 is a `Checkbox` or `Slider` announcing `"action"` for a programmatic write; C21 is a field's error tooltip hidden by another field's re-attach. C40's cases 24–27 ([`checkbox-action-activation.md`](plans/implemented/checkbox-action-activation.md#L452)) and C21's case 6 ([`doc-and-qa-record-drift.md`](plans/implemented/doc-and-qa-record-drift.md#L507)) need the same window the sweep opens. They are the last batch, `b19`, so a failure there cannot stop the sweep's own batches.[^witness]

### MiniBrowser only

Every run uses MiniBrowser, the runner's default host. Tauri is not added.[^host]

### Results go to a new dated record

The orchestrator records the sweep in `plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md`, in the shape of `97-wave2-measurement.md` (*Recording the Results*, below). This plan does not create that file: it has nothing to say until the runs exist.

---

## Status Pass

Every candidate was checked against `master` `09a99c2a`. G-numbers are the synthesis's plan groups, F-numbers the slice reports' findings, X-numbers its cross-cutting defects, and C-numbers correctness bugs. Library paths below are relative to `packages/lib/src/typescript/lib/`. "Absorbed" names the commit that took the work. The full evidence per candidate is in *Addendum: Status Pass Evidence*.

### The candidates

| Candidate | Status on `master` | Hot path now | Reached by (panel · driver) | Bounding arm |
|---|---|---|---|---|
| G05 `resolve-bounds-lazy-size-reads` | live; value partly absorbed by the size-hint memo (`7ec61ed6`) | `layout/LayoutManager.ts:406-421` | `shell-*` · `resize`; `form-*` · `passes` (`passes=form`, `passes=header`) | ablation `g05.lazy-reads` |
| G08 `environment-read-caching` | live, every item | `core/DOM.ts:2448-2458`; `overlay/AbstractWindow.ts:2775-2796` | `windows` · `viewport` (n=8 against n=4), `toggle`; `menus` · `toggle` | ablation `g08.env-reads` |
| G09 more opt-ins | live; only `MenuBar`, `ToolBar` and `Cell` opted in (`87cf3074`) | `layout/LayoutManager.ts:634`; `core/Component.ts:4374-4402` | `shell-deep` · `drag` (`grip=dock-h`); `shell-*` · `resize`, `passes`; `form-*` · `passes`; `windows` · `passes` | ablations `g09.all` (the ceiling) and `g09.chrome` |
| G11 `box-layout-per-pass-gather` | partly absorbed: repeat size reads within a pass are memo hits (`7ec61ed6`); `Border`'s region record landed (`41deeeb2`) | `layout/LayoutManager.ts:316-358`; `core/Component.ts:7570`; `layout/Grid.ts:893` | `shell-*` · `resize`; `form-*` · `passes`; `chart-dashboard` · `passes` | ablation `g11.gather-residue` |
| G12 F06.3 no-op drag frame | live | `layout/Split.ts:1334-1392` | `shell-*` · `park` | ablation `split.noop-drag`, rewritten |
| G12 F06.4 `recalculateSizes` gate | partly absorbed: the repeated min/max reads are memo hits (`7ec61ed6`) | `layout/Split.ts:1955`, `:2283-2555` | `shell-deep` · `passes`, `park`, `drag` (`grip=dock-h`); `shell-shallow` · `passes` | ablation `split.recalc-gate`, rewritten |
| G12 F06.9 collapse animation | live | `layout/CollapseSupport.ts:315-389`; `layout/Split.ts:490-493` | `shell-*` · `toggle` (`toggle=pane`) | ablation `g12.collapse-static` |
| G14 `accordion-closed-section-render-tree` | live; `accordion-seed-pass-economy` deferred it | `layout/Accordion.ts:1675`, `:1776-1790` | `shell-*` · `drag` (`grip=sidebar`) | ablation `g14.closed-section` |
| G16 `panel-settled-pass-and-scroll-reads` | live; not reached by the shells, which mount no scrolling `Panel` | `core/Panel.ts:660-706`, `:1082`, `:1392-1418`, `:1699`; `core/Component.ts:5026-5051` | `form-*` · `passes` (`passes=form`), `wheel`; `code-document`, `shell-*` (`wheel=editor`) · `wheel` | ablations `g16.panel-settled` and `g16.scroll-reads` |
| G17 `glyph-name-setter` | live, except C10's leak (`594d0bf5`) | `component/tree/TreeRow.ts:228-262`; `component/tree/renderer/IconLabel.ts:91-107`; `component/table/cell/renderer/TreeCell.ts:231-255` | `tree-nodes` · `key`; `treetable-rows` · `toggle` | counter-only |
| G18 `text-measurement-without-reflow` | live, except the identical-string half (`8d8adb29`) | `core/DOM.ts:2241-2293`; `component/input/Text.ts:531` | `code-document`, `shell-*` · `type` (S6, typing with the status bar live); `chart-*` · `passes`; `form-flat` · `click` (`click=combo`); `menus` · `toggle`; `tree-nodes` · `key` | ablations `g18.canvas-width` (the lever) and `g18.measure-memo` (repeats) |
| G19 `tooltip-hover-path` | partly absorbed: C15 (`7d28e5ac`) and C21 (`c3779b23`) closed the listener and ownership halves | `overlay/Tooltip.ts:346-380`, `:435-514` | `chart-*` · `hover`; `form-*` · `type` (`type=text`) | ablation `g19.tooltip-idle` |
| G20 `event-dispatch-and-registrants` | live; the walk lives in a closure no page code can reach | `core/Event.ts:296-346` | `chart-*` · `hover` | dose ablation `g20.walk-dose` |
| G21 `table-render-pass-economy` | live | `component/table/Body.ts:502-506`, `:2572-2616`, `:2498-2510`; `component/table/TreeBody.ts:512-514` | `table-rows` · `key` (n=10,000 against n=900), `update`, `passes`, `wheel`; `treetable-rows` · `key`, `update` | ablation `g21.render-pass` |
| G22 `table-resize-settle-relay` | live | `component/table/Body.ts:1105-1111`, `:1468-1476` | `table-rows`, `treetable-rows` · `resize` | ablation `g22.settle-relay` |
| G23 `table-header-and-cell-write-economy` | partly absorbed: the button and text guards (`8d8adb29`) removed the rule and DOM halves | `component/table/cell/Filter.ts:265-353`; `data/temporalText.ts:29-34` | `table-rows` · `update` (`update=filter`, n=900), `click` (n=900), `update`, `wheel` | ablation `g23.write-economy` |
| G24 `list-and-tree-row-economy` | live | `component/list/AbstractSelectableList.ts:506-537`, `:663-679`; `component/tree/Tree.ts:2277-2287` | `list-items` · `key` (n=300 against n=3,000); `tree-nodes` · `passes` | ablations `g24.list-rows` and `g24.tree-window` |
| G25 `codemirror-theme-singleton` | partly absorbed: C7's memo (`66d6e0f4`) removed the per-editor rules | `component/editor/CodeEditor.ts:692`, `:2637-2645` | `shell-*` · `theme` at n=4 | ablation `g25.theme-withhold` |
| G26 `markdown-viewer-resize-and-lexer` | live; the NaN write is gone (`7011aee3`) | `component/display/Markdown.ts:988-997`, `:1073-1124`; `component/container/FloatingPanel.ts:197-229`; `component/display/markdownExtensions.ts:128` | `markdown-doc` · `drag` (n=60 against n=240), `passes`, `update` | ablation `g26.viewer-resize`; the lexer half counter-only |
| G27 `markdown-heading-scroll-cache` | partly absorbed: C19 is gone (`83b90ad9`), and its counters are now `querySelector`, not `getElementById`/`contains` | `component/display/Markdown.ts:2263-2294`; `component/display/HeadingScrollTracker.ts:78-94` | `markdown-doc` · `wheel` (n=60 against n=240) | ablation `g27.heading-cache` |
| G28 `continuous-motion-pattern` | live, except the `ComboBox` caret (`7011aee3`) | `core/Component.ts:3552-3574` | `diagram-graph` · `pan`; `form-flat` · `click` (`click=toggle`) | ablation `g28.transform-inline` |
| G29 `dead-surface-and-docs-sweep` | no runtime cost | — | none: code with no caller runs under no driver | **excluded** |
| F26.1 / F26.2 `AbstractChart` per-pass rebuild | live; no chart commit since 2026-08-30 | `component/chart/AbstractChart.ts:574-598`, `:689-726` | `chart-line`, `chart-dashboard` · `passes`, `update`, `drag` | ablations `chart.repaint-gate` and `chart.margin-memo` |
| `resizeMode: "live" \| "outline"` | not built; three separate per-frame drag buffers | `layout/Split.ts:1412-1437`; `layout/Accordion.ts:2043-2056`; `overlay/AbstractWindow.ts:2114-2262` | `shell-*` · `drag` (every grip); `windows` · `drag` (`grip=edge`) | counter-only |

### The five counter-only reads

- **G17.** A glyph rename is deterministic: it removes each swap's rule insert, element creation and sprite lookup and leaves one attribute write. The swap census per unit is therefore exactly the work the fix removes. A runtime rename would need a sprite-mounting shim, and nothing it could add changes the work verdict.[^g17-counter]
- **`resizeMode`.** In outline mode a drag frame is an idle frame plus one composited move. So the bound is the live drag's average minus the same run's idle average, which every report already carries. An ablated arm would re-measure the idle floor and fail the geometry gate by design.[^resize-counter]
- **G26's lexer half.** The tokenizers are module-private, and swapping in `marked`'s own lexer drops the library's dialect. The bound is how `update` time scales from n=60 to n=480.
- **G21's single-record narrowing (F19.5, F22.2).** It rebinds by record identity inside `onStoreChange`, which a runtime patch cannot reproduce safely. Its excess work is read as `update` against `passes` in the same baseline run.
- **G24's no-op focus move (F18.7).** It is visible only in `list-items` at n=1, where every arrow key is clamped. The baseline's `dispatchCustomEvent` per unit is the work it would remove.

The rule for each is in *Counter-only reads*.

### Gone, merged or unbounded

**Gone since the synthesis, with the commit that took it:**

| Item | Gone by |
|---|---|
| F23.1 / C7, the per-editor CodeMirror rules | `66d6e0f4` |
| C19 and G27's `getElementById`/`contains` lookups | `83b90ad9` |
| C10's undisposed tree-table caret | `594d0bf5` |
| C15's `Animation.play` listeners | `7d28e5ac` |
| C21's foreign `hide` | `c3779b23` |
| the identical-string half of X5 and F14.12 | `8d8adb29` |
| F20.3, the rule half of F20.2, the DOM half of F20.7 | `8d8adb29` |
| the `ComboBox` caret's NaN transform | `7011aee3` |

**Merged:** F26.2's batching half is measured by `g18.measure-memo` in the chart cells, beside `chart.margin-memo`.

**Unbounded in this sweep, each for the reason given.** These stay in their group's plan if the group is planned.

| Sub-item | Why it has no arm |
|---|---|
| G08 F09.1 (window laid out before mount) | `LayerManager` cannot be reached from the page, and no driver shows a fresh window |
| G08 F17.4 | no driver opens a calendar |
| G08 `DialogBackdrop` `inset: 0`; `TextField`'s gate move | library edits, with no runtime seam |
| G11's generation-bump scoping | a different design from G11's gather, with its own correctness gates |
| G16 F04.4 `SmoothScroller` axis writes | only a same-value filter on a lazily created target; the scroll-read memo covers the reads |
| G16 F04.14 | no driver drags a scrollbar thumb |
| G16 the `writeNativeScroll` read-back | changes the `getScrollTop` cache for fractional offsets |
| G18 F14.6 (theme sweep over invisible `Text`s); F14.7 | F14.7 is circular without the canvas seam |
| G19 the fade restart on every blank chart move | stopping it changes when the fade ends |
| G21 F22.12; F22.2's double notify; F19.11 | no driver clicks tree rows, edits in-grid, or turns on `autoSizeColumns` |
| G23 F20.4 (sort sweep); F20.5 (`.columnFocused`); F20.6; F20.8; F20.10 | the badge is created after install; the rest are unreached or style-only |
| G24 F18.3 (tree label measurement); F18.5(2); F18.10; F16.2's arrow-key half | needs a bind/measure split; the rest have no panel |
| G25 the per-flip `<style>` rewrite; the `:has()` rule; the flash overlay | paint-side, and invisible to every counter |
| G26 F25.4; F25.9; F25.12; F25.14; F25.16 | need `DOM` inside a resync, or no panel reaches them |
| G28 the drag ghost, the layer hints, and the coalescing items (F15.4, F27.x per-event pan, F09.11) | every built-in driver sends one move per frame, so coalescing changes nothing |

### Found while planning

- **`IconText.setGlyph` and the display `IconLabel.setGlyph` leak the outgoing glyph (F14.11).** They detach it with `removeComponent` and never dispose it, as C10 did, with no same-name guard: `component/display/IconText.ts:126-133`, `component/display/IconLabel.ts:138-145`. `Button.setGlyph` has both the guard and the dispose (`component/button/Button.ts:1843-1877`). This is a correctness item missing from the register. No panel mounts either class.
- **README M22, the `windows` panel's recorded `viewport` figure, predates C33's fix** (`9755af10`), which adds a viewport listener. `windows` · `viewport` therefore needs the fresh baseline before any comparison.
- **The Coverage tables in the two implemented panel plans are stale for G27.** They name `getElementById` and `contains`, which C19's fix replaced with `querySelector`. This plan's *The Matrix* supersedes them for wave 3.

---

## Public API

None. Everything here is internal to the private `packages/qa` workspace package; nothing is exported from `@jimka/typescript-ui`.

---

## Internal Structure

### Harness changes

**`src/harness/types.ts`.**

```ts
export interface HarnessLibrary {
    Body: { getInstance(): object };
    DOM: { sink: object; source: object; install(impls: { sink?: object; source?: object }): void };
    /** The library's `Tooltip` class, for `g19.tooltip-idle`; absent in tests that do not pass it. */
    Tooltip?: object;
    /** The library's `AbstractWindow` class, for `g08.env-reads`; absent in tests that do not pass it. */
    AbstractWindow?: object;
}

/** Patches the page at runtime and returns a one-line note saying what it did. */
export type Ablation = (tools: HarnessTools, lib: HarnessLibrary) => string;
```

**`src/harness/run.ts`.** `applyAblations(abl, tools, notes)` becomes `applyAblations(abl, tools, notes, lib)` and calls `ablation(tools, lib)`. `instrument` passes `run.lib`. The install order does not change: write counters, stylesheet, ablations, work counters, seam counters ([`run.ts:240-269`](packages/qa/src/harness/run.ts#L240)). So a work or seam counter wraps whatever an ablation installed, and counts every call that reaches it, memo hits included.

**`src/main.ts`.** Import `AbstractWindow` and `Tooltip` from `@jimka/typescript-ui/overlay`, and build `const lib = { Body, DOM, Tooltip, AbstractWindow };`.

**`src/harness/counters.ts`.** `installWorkCounters` adds three root counters after `BASE_WORK_METHODS`:

| Call | Counter key | Why |
|---|---|---|
| `countMethod(any, 'beginSizeHintRecord', 'sizeHintMiss', true)` | `sizeHintMiss@<class>` | one per live size-hint computation, i.e. per memo miss ([`Component.ts:3651`](packages/lib/src/typescript/lib/core/Component.ts#L3651)): the real work under `g05` and `split.recalc-gate` |
| `countMethod(any, 'getLaidOutComponents', 'getLaidOutComponents', true)` | `getLaidOutComponents@<class>` | `g11`'s allocation half |
| `countMethod(lm, 'reserveContentFrame', 'reserveContentFrame', true)`, with `lm = tools.findLayoutManager('LayoutManager')` | `reserveContentFrame@<manager>` | `g11`'s child walk |

`countLayoutWork` adds `countMethod(grid, 'measureContent', 'measureContent')` when `tools.findLayoutManager('Grid')` finds one, and notes `no Grid layout manager` otherwise.

**The ablation helpers in `ablations.ts`.** Every new ablation that needs one of these patterns uses the shared helper rather than its own copy:

| Helper | What it does |
|---|---|
| `bump(tools, prefix, name, what)` | `tools.bumpWork(\`${prefix}.${name}.${what}\`)`, with `prefix` one of `skipped`, `memo`, `dose` |
| `perTask<T>(compute): () => T` | caches `compute()`'s result until the current task ends, by clearing it in a `queueMicrotask` scheduled at the first fill |
| `withOwnMethod(obj, method, replacement, body)` | defines `replacement` as `obj`'s own `method` for the duration of `body()`, then restores the previous own property, or deletes the property when there was none. `replacement` receives the function to delegate to: the previous own property, or the prototype's method looked up at call time |
| `chainClass(obj, name)` | the constructor named `name` in `obj`'s prototype chain, or `null` |

`withOwnMethod` is what lets an ablation skip one component's `doLayout` without touching the panels' own counters: `countInstance` installs `sidebar.doLayout`, `main.doLayout` and the `history.*` counters as own properties ([`work.ts:18-33`](packages/qa/src/builders/work.ts#L18)), and a skipped call must not reach them.

### The ablations

Every entry below:

- is added to `ABLATIONS` under the name given;
- returns a note beginning `no ` and patches nothing when its target is absent;
- names its counters by the scheme in *Architecture Decisions*.

"Root" means the prototype returned by `tools.rootOwnerProto(anyComponent, method)`, which is `Component.prototype` for `Component` methods. `source` and `sink` mean `lib.DOM.source` and `lib.DOM.sink`: the real seam objects, which an ablation patches with own properties before the seam counters wrap them. Library lines are `packages/lib/src/typescript/lib/…` on `master` `09a99c2a`. **If a method named here does not exist with the stated parameters, or a named private field is absent, stop and report it; do not improvise a different patch.**

#### `split.noop-drag` — G12 F06.3 (rewritten)

- **Target.** `Split.prototype.onDrag(container, gutter, position)` ([`layout/Split.ts:1334`](packages/lib/src/typescript/lib/layout/Split.ts#L1334)), found as today through `tools.findLayoutManager('Split')`.
- **Patch.** Before calling the original, take `lhs` and `rhs` exactly as it does (`this._gutters.indexOf(gutter)`, then `container.getLaidOutComponents()` at that index and the next). Snapshot each pane's `[getX(), getY(), getWidth(), getHeight()]`. Run the original inside `withOwnMethod(pane, 'doLayout', …)` for both panes. The replacement bumps `skipped.split.noop-drag.paneLayout` and returns `this` when the pane's rectangle still equals its snapshot; otherwise it delegates.
- **Keeps.** The original's `_sizes.set` still runs on every frame. Returning early before it would skip the sync of the rendered size.[^split-rewrite]
- **Geometry.** Identical: the panes' rectangles did not move, and their content was laid out at that rectangle on the previous frame.
- **Expected in `park`.** `skipped.split.noop-drag.paneLayout` 2.00 per unit, `sidebar.doLayout` and `main.doLayout` from 0.99 to 0.

#### `split.recalc-gate` — G12 F06.4 (rewritten)

- **Target.** `Split.prototype.recalculateSizes()` ([`:2283`](packages/lib/src/typescript/lib/layout/Split.ts#L2283)).
- **Patch.** Compute a signature `S` before calling the original:
  - `this._orientation`, the container's `getInnerSize()` width and height, `this._lastAvailableMain`, and `container.getComponents().length`;
  - then, per pane in `container.getComponents()` order: the pane itself (compared by identity), `this._sizes.get(pane)`, the main-axis extent of `this.paneMinSize(pane)` and `this.paneMaxSize(pane)` (`:698`, `:713`), `this._weights.get(pane)`, the pane's `weight` constraint, and `this._undisplayedPaneContent.has(pane)`.
  - Keep `S` as an array and compare element by element with `===`.
- **Skip rule.** Skip, bumping `skipped.split.recalc-gate.recalc`, only when `S` equals the previous call's `S` on this instance **and** that previous call left every `_sizes` entry unchanged within 1e-9. Otherwise run the original. After it, record `S` and whether the run changed any `_sizes` entry.
- **Why the stability condition.** Without it, a gate would freeze a pane that `recalculateSizes` is still re-clamping from one pass to the next.[^split-rewrite]
- **Geometry.** Identical: a skipped call is one that would have written the sizes it already holds.

#### `g12.collapse-static` — G12 F06.9

- **Target.** `Split.prototype.setPaneCollapsed(index, collapsed)` ([`:453`](packages/lib/src/typescript/lib/layout/Split.ts#L453)). The animation helpers in `layout/CollapseSupport.ts` are module functions the page cannot patch.
- **Patch.** For each laid-out pane of the split's container, install an own `doLayout` (not through `withOwnMethod`: it must outlive the call) that behaves as follows:
  - **The first call** passes through. It is `runCollapse`'s end layout, which an expand needs. Record the pane's rectangle.
  - **A later call while `this._collapsing` is `true`**, with the rectangle equal to the last one that ran, is skipped: bump `skipped.g12.collapse-static.staticRelayout` and return.
  - **Once `this._collapsing` is `false`**, the own property restores whatever was there before (the `countInstance` counter, or nothing) and delegates.
  - Compare rectangles with a tolerance of 1e-6 px.
- **Geometry.** `sidebar` and `status` identical. The animated labels (`files`, `outline`, `history`, `main`, `dock`, `editor0`–`editor3`, `header0`) follow `performance.now()`, so they may differ between any two runs, plain included: the cell allows them to differ.

#### `g05.lazy-reads` — G05

- **Target.** `LayoutManager.prototype.resolveBounds(component, x, y, maxWidth, maxHeight, fill?, anchor?)` ([`layout/LayoutManager.ts:406`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L406)), through `tools.ownerProto(tools.findLayoutManager('LayoutManager'), 'resolveBounds')`.
- **Patch.**

  ```ts
  const f = this.getLayoutConstraints(component)?.fill || fill || 'none';

  if (f === 'both') {
      bump(tools, 'skipped', 'g05.lazy-reads', 'resolve');

      return { x, y, width: maxWidth, height: maxHeight };
  }

  return original.call(this, component, x, y, maxWidth, maxHeight, fill, anchor);
  ```

  The `||` order is the original's: the constraint's fill wins over the argument (`:414`).
- **Geometry.** Identical by construction: the `BOTH` branch returns exactly this rectangle and discards the four reads (`:421-423`).
- **Self-check.** `getPreferredSize@*` + `getMinSize@*` + `getMaxSize@*` fall by exactly 3 × the skips, and `getSize` is not counted. The real work removed is the fall in `sizeHintMiss@*`.

#### `g08.env-reads` — G08

It patches `lib.DOM.source` and `lib.DOM.sink` as own properties on those objects. The seam proxies installed later forward to them.

- **Viewport.** `source.getViewportSize()` becomes a `perTask` memo of the original.
  - Counters: `memo.g08.env-reads.viewportHit` and `…viewportMiss`.
- **Theme variables.** `source.getThemeVar(name)` keeps a `Map<string, string>` of original results.
  - Counters: `memo.g08.env-reads.themeVarHit` and `…themeVarMiss`.
  - The map is cleared by a wrapper on `sink.apply(handle, patch)` whenever `handle === source.getDocumentElement()` ([`core/DOM.ts:2757`](packages/lib/src/typescript/lib/core/DOM.ts#L2757)). A theme switch writes its variables there first ([`core/Theme.ts:1419`](packages/lib/src/typescript/lib/core/Theme.ts#L1419)), before any listener reads them.
- **Minimized stack.** The static `relayoutMinimizedStack()` on `lib.AbstractWindow` ([`overlay/AbstractWindow.ts:2775`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2775)) runs at most once per task. A repeat call in the same task bumps `skipped.g08.env-reads.minStack` and returns.
  - Without `lib.AbstractWindow`, this part is skipped and the note ends `; no AbstractWindow`. The other two parts still install.
- **Geometry.** Identical: the page's viewport and theme do not change inside a task, and the minimized stack is recomputed from unchanged state.

#### `g09.all` and `g09.chrome` — G09

- **Target.** Root `canSkipUnchangedLayout()` ([`core/Component.ts:4374`](packages/lib/src/typescript/lib/core/Component.ts#L4374)). The shipped overrides on `MenuBar`, `ToolBar` and `Cell` own their prototypes, so they are unaffected.
- **Patch.**
  - `g09.all`: return `true`.
  - `g09.chrome`: return `true` when the receiver's chain contains `Header` or `StatusBar`, otherwise the original. Cache the answer per constructor in a `WeakMap`, since `markPassOwedAbove` asks on every invalidation.
- **Engagement.** Both also wrap the root `canSkipUnchangedCommit()` (`:4397`). When it returns `true` inside a layout pass (`Component.currentLayoutPass() !== 0`, `:8020`, with `Component` reached through `rootOwnerProto(any, 'doLayout').constructor`), bump `skipped.<ablation>.commit`.
- **Geometry.** Expected identical for `g09.chrome`. `g09.all` is the ceiling and the real-engine test W2.0 still owes: an unaudited writer shows as `DIFF`, which is itself the finding.

#### `g11.gather-residue` — G11

Three sub-patches, each geometry-identical by construction:

- **`reserveContentFrame()`** (root on `LayoutManager`, [`:316`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L316)): when `this.getContainer()` exists and neither `this.isOverflowingX()` nor `this.isOverflowingY()`, call `container.clearContentFrame()`, bump `skipped.g11.gather-residue.reserve`, and return `this`. Otherwise run the original.
- **`getLaidOutComponents()`** (root, [`core/Component.ts:7570`](packages/lib/src/typescript/lib/core/Component.ts#L7570)): when every entry of `this._components` is displayed, return `this._components` itself and bump `memo.g11.gather-residue.laidOutShared`. Otherwise run the original.
- **`Grid.prototype.measureContent(components, cols, rows)`** ([`layout/Grid.ts:893`](packages/lib/src/typescript/lib/layout/Grid.ts#L893)): when `this._columnTracks.length === 0`, `this._rowTracks.length === 0` and `!this._baselineAlign`, return `{ columns: new Array(cols).fill(0), rows: new Array(rows).fill(0) }` and bump `skipped.g11.gather-residue.measureContent`. With no tracks every track resolves as a weight and never reads the content sizes (`:849-858`). `LabeledGrid` declares tracks, so it never takes the shortcut.

#### `g14.closed-section` — G14

- **Target.** `Accordion.prototype.layoutSections(components, containerWidth, left, top, resizable, contentHeightFor, animateShrink, reflowAll)` ([`layout/Accordion.ts:1715`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1715)).
- **Patch.** Act only when `reflowAll === true`; otherwise delegate unchanged.
  - A section `i` is *settled closed* when `components[i].isDisplayed()`, `!this._openState[i]`, `!this._wrapperAnimations.has(i)`, `!this._shrinkAnimations.has(i)`, and `this._toggleAnimations === 0`.
  - Pass the original a wrapped `contentHeightFor`. For a settled-closed section it returns a height cached per component on first use, bumping `skipped.g14.closed-section.closedPreferred` when served from the cache; otherwise it delegates. A section that is not settled closed drops its cache entry.
  - Run the original inside `withOwnMethod(components[i], 'doLayout', …)` for every settled-closed section. The replacement bumps `skipped.g14.closed-section.closedReflow` and returns.
- **Geometry.** Identical: `placeSection` still writes the section at the same width and the cached height, and a `Tree`'s preferred height does not depend on its width. The closed tree's rows keep a stale width, but they are clipped, invisible and not probed.
- **Expected on `drag` with `grip=sidebar`.** `history.doLayout` and `history.getPreferredSize` from 1.00 to 0.

#### `g16.panel-settled` — G16, the settled pass

- **Target.** `Panel.prototype.remeasureScrollMetrics()` ([`core/Panel.ts:1082`](packages/lib/src/typescript/lib/core/Panel.ts#L1082)), through `tools.ownerProto(tools.findComponent('Panel'), …)`.
- **Patch.** Signature `[getWidth(), getHeight(), getComponents().length, JSON.stringify(getPreferredSize())]`. When it equals this instance's last full run, bump `skipped.g16.panel-settled.remeasure` and return. Otherwise run the original and record the signature.
- **Use.** Only in `passes` cells. A scroll moves the shadows without changing the signature, so this ablation must not run under `wheel`.

#### `g16.scroll-reads` — G16, the scroll path

- **Shadow overlay.** `Panel.prototype.resizeScrollShadowOverlay(element?)` (`:1392`) is skipped, bumping `skipped.g16.scroll-reads.shadowResize`, when `[getWidth(), getHeight(), this._scrollbarGutter]` equals the last call's on this instance.
- **Scroll-metric reads.** While a wrapped `syncOverlayScrollbars()` (`:1699`) or `updateScrollShadows(element?)` (`:1418`) is running, `lib.DOM.source.getScrollMetrics(handle)` is served from a per-handle `perTask` memo. Hits bump `memo.g16.scroll-reads.metricsHit`; calls outside those two methods pass through.
- **Max scroll.** Root `getMaxScrollLeft()` and `getMaxScrollTop()` ([`core/Component.ts:5026`](packages/lib/src/typescript/lib/core/Component.ts#L5026), `:5043`) return a per-instance `perTask` memo of the original, bumping `memo.g16.scroll-reads.maxScrollHit` on a hit.
- **Geometry.** Identical: nothing inside one task changes the metrics.

#### `g18.measure-memo` — G18, repeated measurement

It patches `lib.DOM.source` in place:

- **`measureText(text, options?)`** is memoised on `text + '\u0000' + JSON.stringify(options ?? {})`, so `maxWidth` is part of the key.
- **`measureTexts(requests)`** serves each request from the same memo and sends only the misses to the original, in one call.
- **`measureTextWidths(texts, options?)`** memoises each width on the same kind of key.

A call served entirely from the memo bumps `memo.g18.measure-memo.callHit`; any other bumps `memo.g18.measure-memo.callMiss`. The memo clears on the document-element `apply` hook (as in `g08.env-reads`) and on `document.fonts` `loadingdone`.

**Geometry.** Identical: the same text under the same theme and fonts measures the same.

#### `g18.canvas-width` — G18, measurement without reflow

- **Target.** `lib.DOM.source.measureText(text, options = {})` ([`core/DOM.ts:2241`](packages/lib/src/typescript/lib/core/DOM.ts#L2241)).
- **Patch.** At install, create a 2D context from a detached `<canvas>`; without one, note `no canvas 2D context` and patch nothing. Then, per call:
  - With `options.maxWidth` set, call the original.
  - Resolve `fontFamily`, `fontSize`, `fontWeight`, `fontStyle` and `fontVariant`, with the original's defaults (`:2244-2251`). Replace each `var(--name, fallback)` with `source.getThemeVar('--name')`, or the fallback when that is empty. When `fontFamily` or `fontSize` still contains `var(` or `calc(`, call the original and bump `memo.g18.canvas-width.fallback`.
  - The font key is the seven option strings as passed. For a key seen for the first time, call the original, cache its `height` and `baseline` under the key, and return its result.
  - Otherwise set `ctx.font = \`${style} ${variant} ${weight} ${size} ${family}\``, and return `{ width: Math.ceil(ctx.measureText(text).width), height, baseline }` from the cache. Bump `memo.g18.canvas-width.canvas`.
- **Geometry.** `editor` and `status` on `code-document` are placed by `Border`, so a width that differs by a pixel from the DOM probe's does not move them. A `DIFF` there is a real finding about canvas parity.

#### `g19.tooltip-idle` — G19

It patches statics on `lib.Tooltip`; without it, it notes `no Tooltip`.

- **`hide()`** ([`overlay/Tooltip.ts:346`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L346)): when `Tooltip.dismissing` is `false`, `Tooltip.watching` is `false`, and `Tooltip.instance` is `null` or not `isVisible()`:
  - call `Tooltip._cancelPendingShow()`;
  - set `Tooltip.activeElement = null`;
  - bump `skipped.g19.tooltip-idle.hide`, and return.

  Otherwise run the original. This also stops `hide()` creating an instance.
- **`_attachWith(component, text, colors, covering)`** (`:435`): keep a `WeakMap` from component to `{ text, covering, colors: JSON.stringify(colors ?? null) }`. A call equal to the stored entry bumps `skipped.g19.tooltip-idle.attach` and returns. Otherwise store it and run the original.
- **`detach(component)`**: delete the component's entry, then run the original. Without this, a later re-attach after a detach would be skipped.
- **Geometry.** Identical, the form panels' `tooltip` label included: a skipped `hide()` would have faded an invisible element, and a skipped attach re-registers the same text.

#### `g20.walk-dose` — G20

- **Why a dose.** The per-event ancestor walk lives in `Event`'s closure-private listener ([`core/Event.ts:296-346`](packages/lib/src/typescript/lib/core/Event.ts#L296)), which no page code can patch.
- **Patch.** Wrap `lib.DOM.source.getParentElement(handle)` and `getId(handle)` so each call runs the original twice and returns the second result. Each extra call bumps `dose.g20.walk-dose.extraCall`. Both methods are pure, so the results are the same.
- **Reading.** The dose arm's Δms is the cost of one more walk, and so of the walk the fix removes. The plain arms' `getParentElement` + `getId` per unit is the work it removes.

#### `g21.render-pass` — G21

It is found through `tools.findComponent('TableBody')`, which is a `TreeBody` in `treetable-rows`.

- **Visible records.** Patch `tools.ownerProto(body, 'getVisibleRecords')` ([`component/table/Body.ts:502`](packages/lib/src/typescript/lib/component/table/Body.ts#L502); `TreeBody.ts:512`).
  - The memo key is `this._store._records` and `this._rowVisible` for a flat body, or `this._flatRows` for a tree body, compared by identity.
  - A hit returns the cached array and bumps `memo.g21.render-pass.visibleHit`.
  - Both fields are only ever reassigned, never mutated, and no caller mutates the returned array.
- **Focus sweep.** Wrap `_updateFocusStyle()` (`:2572`). When `this._previousFocusedCell === null`, set it to a stub whose `getParentComponent()` returns `true` and whose `setStyleState()` does nothing, bump `skipped.g21.render-pass.focusSweep`, and run the original. The original then takes its targeted branch and nulls the field itself. No cell holds `.focused` while the field is `null`, because `.focused` is set only at `:2615`.
- **Required state.** Wrap `applyRequiredEmptyState(row, record)` (`:2498`). When no value of `this._columnConfigs` has `required === true` or a `requiredPredicate`, bump `skipped.g21.render-pass.requiredEmpty` and return.
- **Geometry.** Identical, including the new `focused` label.

#### `g22.settle-relay` — G22

- **`renderWindow(bodyWidth?, columnWidths?)`** ([`component/table/Body.ts:1105`](packages/lib/src/typescript/lib/component/table/Body.ts#L1105)), on the prototype that owns it:
  - Compute `widthsChanged` exactly as `updateColumnWidthCache` does (`:1275-1289`): `bodyWidth !== undefined`, and either `this._lastBodyWidth !== bodyWidth` or the widths differ element by element.
  - Call `this.deferRowLayoutWhileResizing(widthsChanged)` ([`component/shared/VirtualRowView.ts:500`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L500)). While it returns `true`, set the ablation's `deferring` flag for the duration of the original call.
- **Root `applyBounds(x, y, width, height)`** ([`core/Component.ts:4351`](packages/lib/src/typescript/lib/core/Component.ts#L4351)): while `deferring`, a receiver whose chain contains `Cell` and whose `getWidth()` is above 0 bumps `skipped.g22.settle-relay.cellBounds` and returns `this`. Otherwise delegate.
- **The settle.** `flushResizeSettle` calls `renderWindow()` with no arguments two frames after the burst, so `deferring` is `false` and every cell is laid out at the settled width.
- **Geometry.** The container labels are identical. The new `cell` label lags during the `resize` phase by design, and must be identical in the trailing `idle:4` phase.

#### `g23.write-economy` — G23

- **Filter operators.** Found through `tools.findComponent('FilterCell')` ([`component/table/cell/Filter.ts:265-353`](packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L265)):
  - `setOperators(operators)` returns when `operators === this._operators && operators.length > 0`, bumping `skipped.g23.write-economy.operators`.
  - `applyOperatorFace(op)` returns when `op` equals the last `op` it applied on this instance, bumping `skipped.g23.write-economy.operatorFace`.
- **Temporal formatting.** `Date.prototype.toLocaleTimeString`, `toLocaleDateString` and `toLocaleString`, when called with `undefined` or a string locale, format through a cached `Intl.DateTimeFormat` per `(method, locale, JSON.stringify(options))`. Each cache hit bumps `memo.g23.write-economy.intlHit`. Every hundredth hit also runs the original and bumps `memo.g23.write-economy.intlMismatch` when the two strings differ; that counter must read 0.
- **Absent target.** Without a `FilterCell` it notes `no FilterCell` and patches nothing, the `Date` part included.
- **Geometry.** Identical: the operator face and the formatted strings are unchanged.

#### `g24.list-rows` and `g24.tree-window` — G24

- **`g24.list-rows`.** Found through `tools.findComponent('SelectableListRow')`:
  - `setSelected(value)` returns `this` when `value === this._selected` ([`component/list/AbstractSelectableList.ts:506`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L506));
  - `setFocused(value)` returns `this` when `value === this._focused` (`:532`).
  - Each skip bumps `skipped.g24.list-rows.rowClass`. Geometry is identical: an unchanged state rewrites an identical class attribute.
- **`g24.tree-window`.** `Tree.prototype.renderWindow()` bumps `skipped.g24.tree-window.renderWindow` and returns.
  - This is sound **only** under `passes`, where nothing changes between passes, so every pass's re-render is redundant. It is the ceiling of G24's signature gate on that driver, and is used in no other cell.

#### `g25.theme-withhold` — G25

- **Target.** Found through `tools.findComponent('CodeEditor')`:
  - `onThemeChange()` ([`component/editor/CodeEditor.ts:2637`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L2637)), called by name from the theme subscription at `:692`;
  - `onEffectiveVisibilityChange(effective)` (`:1943`).
- **Patch.**
  - `onThemeChange()`: when `!this.isEffectivelyVisible()`, mark this instance as owing a reconfigure, bump `skipped.g25.theme-withhold.theme`, and return. Otherwise run the original.
  - `onEffectiveVisibilityChange(effective)`: run the original. Then, when `effective` is true and the instance owes a reconfigure, clear the mark and run the original `onThemeChange`.
- **Geometry.** Identical: a hidden editor has no box, and a theme change moves no box.

#### `g26.viewer-resize` — G26

- **Hug width.** Wrap `FloatingPanel.prototype.placeNextTo(textColumn)` ([`component/container/FloatingPanel.ts:197`](packages/lib/src/typescript/lib/component/container/FloatingPanel.ts#L197)), found through `tools.findComponent('MarkdownMinimap')`.
  - The key is `[textColumn?.getId(), textColumn?.getWidth(), textColumn?.getMaxMeasure?.(), textColumn?.getFontScale?.(), themeGeneration]`.
  - While the original runs, `source.getElementRect(handle)` serves the rectangle cached for this panel when the key is unchanged, bumping `memo.g26.viewer-resize.rectHit`. On a changed key the read runs, and its result is cached under the new key.
  - `themeGeneration` rises in a wrapper on `Markdown.prototype.onThemeChanged()` ([`component/display/Markdown.ts:1006`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1006)).
- **Height measurement.** Wrap `Markdown.prototype.setWidth(width)` (`:988`) to set an in-`setWidth` mark on the instance for the duration of the call.
  - `measureContentHeight()` (`:1073`), called while the mark is set, bumps `skipped.g26.viewer-resize.measure`. It then (re)arms a 100 ms timer that runs the original once, and returns.
  - A call without the mark runs the original.
- **Absent target.** Without a `MarkdownMinimap` it notes `no MarkdownMinimap` and patches nothing.
- **Geometry.** `side`, `viewer` and the new `minimap` label must be identical. The content height is stale during a drag by design, and nothing labels it.

#### `g27.heading-cache` — G27

- **Target.** `HeadingScrollTracker.prototype.trackScroll(scrollElement)` ([`component/display/HeadingScrollTracker.ts:78`](packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts#L78)), reached through `tools.findComponent('MarkdownViewer')._tracker`.
- **Patch.**
  - When `this._pendingClickScrollTop !== null`, run the original.
  - Otherwise read `m = source.getScrollMetrics(scrollElement)` once.
  - **Rebuild the offsets** when `this._headings`, `m.scrollHeight` or `m.clientWidth` differ from the cache. For each heading, `el = source.querySelector(scrollElement, \`[id="${source.escapeSelector(id)}"]\`)`, as `headingSelector` does (`Markdown.ts:447`). Its offset is `source.getElementRect(el).top - source.getElementRect(scrollElement).top + m.scrollTop`, or `null` when there is no element. Bump `memo.g27.heading-cache.rebuild`.
  - **Resolve the heading** as `findActiveHeading` does (`Markdown.ts:2263-2294`, tolerance 1 px), using `offset - m.scrollTop` for each heading's top relative to the pane. The same at-max-scroll rule applies.
  - Call `this.setActiveHeading(id)`, as the original does on every tick. On a tick served without a rebuild, bump `memo.g27.heading-cache.trackHit`.
- **Soundness.** The panel's new `heading@<id>` counters must be identical to the plain arm's. `viewer` and `side` cannot see a wrong heading.

#### `g28.transform-inline` — G28

- **Target.** Root `setTransform(value)` and `clearTransform()` ([`core/Component.ts:3552-3574`](packages/lib/src/typescript/lib/core/Component.ts#L3552)).
- **Patch.**
  - `setTransform(value)`: keep the same-value guard and `this._transform = value`, then write `this.setElementStyle('transform', value)` instead of the rule. Bump `skipped.g28.transform-inline.ruleWrite`.
  - `clearTransform()`: write `this.setElementStyle('transform', null)`.
  - At install, not counted: for every live component whose `_transform` is set, clear its rule with `setElementCSSRule('transform', null)` and write it inline.
- **Geometry.** Identical: the same transform on the inline style outranks the `#id` rule it replaces.

#### `chart.repaint-gate` and `chart.margin-memo` — F26.1, F26.2

Both are found through `tools.findComponent('AbstractChart')`, and both use one **revision**: an own `scheduleLayout(...args)` on `AbstractChart.prototype`, installed once by whichever ablation runs first. It adds one to `this.__w3Revision`, then calls the parent prototype's `scheduleLayout`, looked up at call time. Every chart state change schedules a layout (`AbstractChart.ts:194`, `:249`, `:323`, `:398`, `:422`, `:446`, `:470`, `:921`, `:1016`; `LineChart.ts:142`, `:166`, `:190`; `BarChart.ts:70`).

- **`chart.repaint-gate`.** Wrap `repaint(plot, xScale, yScale)` ([`component/chart/AbstractChart.ts:715`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L715)). The signature is `[plot.x, plot.y, plot.width, plot.height, String(xScale.domain()), String(xScale.range()), String(yScale.domain()), String(yScale.range()), this.__w3Revision]`. When it equals the last repaint's on this chart, bump `skipped.chart.repaint-gate.repaint` and return, keeping the marks. Otherwise run the original.
- **`chart.margin-memo`.** Wrap `computePlot(plotOuter)` (`:689`).
  - On a miss, run the original. Derive the insets: `left = r.x - plotOuter.x`, `top = r.y - plotOuter.y`, `right = plotOuter.width - left - r.width`, `bottom = plotOuter.height - top - r.height`. Cache them with the revision, unless `r.width` or `r.height` is 0.
  - On a hit (same revision), return `{ x: plotOuter.x + left, y: plotOuter.y + top, width: Math.max(0, plotOuter.width - left - right), height: Math.max(0, plotOuter.height - top - bottom) }`, and bump `memo.chart.margin-memo.plotHit`.
  - The margins depend on the scale domain, not on the pixel range (`ChartAxis.ts:54`, `AbstractChart.ts:682`), and a domain change is a revision.
- **Soundness.** Geometry cannot see a mark, so the `update` check cells require `seam.sink.createElementNS` equal to the plain arm's: a data change must still rebuild every mark.

### Panel additions

| Panel file | Geometry labels added | Work counters added (`installWork`) |
|---|---|---|
| `src/builders/shell.ts` (both shells) | `header0`: the first page's `Header`; `status`: the status bar | `tools.countMethod(editors[0], 'onThemeChange')` → `onThemeChange@CodeEditor` |
| `src/panels/windows.ts` | `header0`: `windows[0].getHeader()` | — |
| `src/panels/table-rows.ts` | `focused: '.Cell.focused'`; `cell: '.TableBody .StringCell'` | `tools.countMethod(store, 'getRecords')` → `getRecords@MemoryStore` |
| `src/panels/treetable-rows.ts` | `focused: '.Cell.focused'` | `tools.countMethod(store, 'getRecords')` |
| `src/panels/markdown-doc.ts` | `minimap: '.MarkdownMinimap'` | `heading@<id>`: the viewer's tracker (`viewer._tracker`) gets an own `setActiveHeading(id)` that bumps `heading@${id ?? 'none'}` and delegates |

In `shell.ts`, `page()` also returns its `Header`, and `buildShell` keeps the first one it builds. A selector label reads its first match, and `null` when there is none, which the geometry gate compares like any rectangle.[^labels]

---

## The Analysers

### `qa-table.py --work`

`--work` prints, under each phase's row, `work/unit: ` and every work counter of at least 0.05 per unit, largest first, bookkeeping counters included. It is `print_details`' third family, beside `--writes` and `--seam`. `BOOKKEEPING_PREFIXES` gains `'dose.'`, so `work/u` leaves the dose arm's extra calls out.

### `qa-ab.py`

```
python3 packages/qa/bin/qa-ab.py <results-dir> <cell-prefix> [--counter EXPR] [--allow-diff LABEL[@PHASE],…] [--same PATTERN]…
```

**Input.** Every `<cell-prefix>*.json`, ordered by the epoch-milliseconds suffix of the file name (the write order).

- A report's **arm** is its run name with the prefix removed and the last `-<rep>` removed. So `w3s1-b02-sdp-split.noop-drag-2` is arm `split.noop-drag`.
- An arm other than `plain` must equal the report's `params.abl`. When it does not, print `MISMATCH <run>` and exit 1.
- The script exits 1 after printing `ERROR <run> <error>` for an error, unreadable or old-format report. It also exits 1 when there are fewer than two `plain` reports, and when the reports' phase counts or drivers differ.

**The counter expression.** Tokens are separated by spaces; `+` and `-` are the only operators. A term is one of:

| Term | Value per unit |
|---|---|
| `work` | the phase's `work/u`, bookkeeping left out, as in `qa-table.py` |
| `sink` | the sum of `seam.sink` |
| `work.<key>`, `seam.sink.<key>`, `seam.source.<key>` | that counter, 0 when absent |
| any of the above ending in `*` | the sum of every counter whose key starts with the text before `*` |

| `--counter` | Plain report | Arm report | Value |
|---|---|---|---|
| `work.sizeHintMiss@*` | `sizeHintMiss@Text` 40, `sizeHintMiss@Panel` 12 | — | 52 |
| `seam.source.getThemeVar - work.memo.g08.env-reads.themeVarHit` | `getThemeVar` 16 | `getThemeVar` 16, `…themeVarHit` 15 | plain 16, arm 1 |
| `work` (the default) | work/u 2036 | work/u 1634 | Δ −19.7% |

**Geometry.** A phase's geometry is compared label by label against the first plain report's.

- `--allow-diff` removes labels from the comparison: `cell@0` removes `cell` in phase 0 only, and `files` removes it in every phase.
- When the plain reports' geometries, outside the allowed labels, differ among themselves, every arm's geom is `unstable`.
- `--same PATTERN` compares every work or seam counter matching the pattern (the same key syntax as a term) against the first plain report. A difference over 1% of the plain value, or over 0.01 when the plain value is 0, marks the arm `DIFF`, named `DIFF(same <key>)`.

**Output.** One block per phase. The header names the driver, the units and the counter, and gives the plain line: each plain average, their mean, the bracket and the counter's plain mean. Then one line per arm, in order of first appearance:

```
phase 0  park ×150  counter work
  plain            3 reps  avg 20.51 / 20.80 / 20.62  mean 20.64  bracket 0.29  counter 2969.00
  split.noop-drag  2 reps  mean 19.10  Δms -1.54 win   counter 2201.00  Δ -25.9% win   geom =  engaged yes  → win
  split.recalc-gate 2 reps mean 20.70  Δms +0.06 flat  counter 2930.00  Δ  -1.3% flat  geom =  engaged yes  → flat
```

(The figures are illustrative.) A `DIFF` names its labels, for example `geom DIFF(editor0,editor1)`. The verdict is the first row of the cell-verdict table in *Architecture Decisions* that applies.

**Constants**, each with its reason in a comment:

- `WORK_WIN_FRACTION = 0.10` and `WORK_WIN_MIN_PER_UNIT = 1.0`: the work bar.[^rule]
- `SAME_TOLERANCE = 0.01`: counts are deterministic, so 1% only absorbs rounding to hundredths.
- `RECT_TOLERANCE = 0`: rectangles are rounded integers.

**Exit.** 0 when every report was read; 1 as above; 2 for bad arguments.

---

## The Sweep Script

`packages/qa/sweeps/w3-0.sh` is the matrix. Copy it as given: `tests/sweep.test.ts` checks it (cases W1–W11), and *The Matrix* below is the same content as a table.

```bash
#!/bin/bash
# The W3.0 bounding sweep: packages/qa/sweeps/w3-0.sh [--dry-run | --list] [<batch> ...]
#
# Every run opens a full-screen window on the desktop and holds it until the
# run ends. Never start this script, or leave an agent to start it, without
# the user's go-ahead. --dry-run and --list open nothing.
#
# With no batch named, runs every batch in order. Each run goes through
# runqa.sh, and the sweep stops on the first failure. The matrix, the cell
# shape and the reading rule are in plans/w3-0-bounding-sweep.md.
#
#   W3_SESSION          run-name session tag (default s1): names are w3<session>-<batch>-<cell>-<arm>-<rep>
#   W3_C40_BEFORE_LIB   a built packages/lib at 3e36ca60: the wt arm of batch b19
#   W3_RUNQA            the runner to call (default runqa.sh beside this directory); tests point it at a stub
#   QA_MAIN_LIB         as for runqa.sh (default: this checkout's packages/lib)
#
#   exit 0   every selected run passed (or --dry-run / --list finished)
#   exit 1   a run failed; the sweep stopped there
#   exit 2   bad arguments or a missing build; nothing was started
set -u
QA=$(cd "$(dirname "$0")/.." && pwd)
RUNQA=${W3_RUNQA:-$QA/runqa.sh}
SESSION=${W3_SESSION:-s1}

# Every run of the sweep carries exactly these instruments, so every arm of a
# cell pays the same instrument cost and every phase is geometry-gated.
FLAGS='work=1&seam=1&geom=1'

BATCHES="b00 b01 b02 b03 b04 b05 b06 b07 b08 b09 b10 b11 b12 b13 b14 b15 b16 b17 b18 b19"

MODE=run
BATCH=
RUNS=0

# One run: prints it under --dry-run, counts it under --list, and otherwise
# runs it and stops the sweep on its first failure.
run() {
    RUNS=$((RUNS + 1))

    case "$MODE" in
        dry) printf 'runqa %s %s %s\n' "$1" "$2" "$3" ;;
        list) ;;
        *) "$RUNQA" "$1" "$2" "$3" || exit 1 ;;
    esac
}

# The run name of one run of a cell: w3<session>-<batch>-<cell>-<arm>-<rep>.
name() {
    printf 'w3%s-%s-%s-%s-%s' "$SESSION" "$BATCH" "$1" "$2" "$3"
}

# One run of an ablated arm on the main build.
arm() {
    run "$(name "$1" "$3" "$4")" main "$2&$FLAGS&abl=$3"
}

# One plain run on the main build.
plain() {
    run "$(name "$1" plain "$3")" main "$2&$FLAGS"
}

# A baseline cell: one plain run.
base() {
    plain "$1" "$2" a
}

# A scored cell: plain-a, each arm once, plain-b, each arm again in reverse
# order, plain-c.
ab() {
    local cell=$1 params=$2 i
    shift 2
    local arms=("$@")

    plain "$cell" "$params" a

    for ((i = 0; i < ${#arms[@]}; i++)); do
        arm "$cell" "$params" "${arms[$i]}" 1
    done

    plain "$cell" "$params" b

    for ((i = ${#arms[@]} - 1; i >= 0; i--)); do
        arm "$cell" "$params" "${arms[$i]}" 2
    done

    plain "$cell" "$params" c
}

# A check cell, for counts that do not drift: plain-a, each arm once, plain-b.
check() {
    local cell=$1 params=$2 a
    shift 2

    plain "$cell" "$params" a

    for a in "$@"; do
        arm "$cell" "$params" "$a" 1
    done

    plain "$cell" "$params" b
}

# A witness pair: the pre-fix build (wt), then this build (main).
pair() {
    run "$(name "$1" before 1)" wt "$2&$FLAGS"
    run "$(name "$1" after 1)" main "$2&$FLAGS"
}

batch_b00() {
    BATCH=b00
    base sdh 'panel=shell-deep&drive=drag,wheel:120'
    base sd4h 'panel=shell-deep&n=4&drive=drag,wheel:120,theme:4'
    base sds 'panel=shell-deep&grip=sidebar&drive=park,drag,theme:4'
    base sdv 'panel=shell-deep&grip=dock-v&drive=drag'
    base sss 'panel=shell-shallow&grip=sidebar&drive=park,drag,theme:4'
    base cl 'panel=chart-line&drive=passes,resize'
    base cd50 'panel=chart-dashboard&n=50&drive=passes'
    base cd 'panel=chart-dashboard&drive=resize,drag'
    base tr 'panel=table-rows&drive=key,update,passes,wheel'
    base tt 'panel=treetable-rows&drive=key,toggle:20'
    base tn 'panel=tree-nodes&drive=passes,key'
    base li 'panel=list-items&drive=passes,key'
    base li1 'panel=list-items&n=1&drive=key'
    base md 'panel=markdown-doc&drive=passes,drag,theme:4'
    base mdu 'panel=markdown-doc&drive=update:20'
    base mdu480 'panel=markdown-doc&n=480&drive=update:20'
    base cv 'panel=canvas-idle&drive=idle'
    base dg 'panel=diagram-graph&drive=click,pan,wheel:10'
    base cdoc 'panel=code-document&drive=passes,wheel,resize,key,drag,type'
    base me 'panel=markdown-editor&drive=call:40,type'
    base wh 'panel=windows&grip=header&drive=drag:40,drag:80'
    base we 'panel=windows&grip=edge&drive=drag,passes,viewport,toggle:60'
    base ffh 'panel=form-flat&passes=header&type=date&drive=passes,type:10'
    base ffd 'panel=form-flat&passes=date&drive=passes'
    base ffc 'panel=form-flat&passes=combo&drive=passes'
    base fnh 'panel=form-nested&passes=header&drive=passes'
    base mn 'panel=menus&drive=toggle'
    base tw 'panel=table-wide&drive=hwheel,passes,wheel,resize,key'
}

batch_b01() {
    BATCH=b01
    ab sdh 'panel=shell-deep&drive=drag' g09.all g09.chrome split.recalc-gate
}

batch_b02() {
    BATCH=b02
    ab sdp 'panel=shell-deep&drive=park' split.noop-drag split.recalc-gate
    ab ssp 'panel=shell-shallow&drive=park' split.noop-drag
}

batch_b03() {
    BATCH=b03
    ab sds 'panel=shell-deep&grip=sidebar&drive=drag' g14.closed-section
    ab sss 'panel=shell-shallow&grip=sidebar&drive=drag' g14.closed-section
}

batch_b04() {
    BATCH=b04
    ab sdr 'panel=shell-deep&drive=resize' g05.lazy-reads g11.gather-residue g09.all g09.chrome
    ab ssr 'panel=shell-shallow&drive=resize' g05.lazy-reads g11.gather-residue g09.all g09.chrome
}

batch_b05() {
    BATCH=b05
    ab sdq 'panel=shell-deep&drive=passes' split.recalc-gate g09.all
    ab ssq 'panel=shell-shallow&drive=passes' split.recalc-gate g09.all
}

batch_b06() {
    BATCH=b06
    ab sdt 'panel=shell-deep&toggle=pane&drive=toggle:120' g12.collapse-static
    ab sst 'panel=shell-shallow&toggle=pane&drive=toggle:120' g12.collapse-static
}

batch_b07() {
    BATCH=b07
    ab sd4m 'panel=shell-deep&n=4&drive=theme:10' g25.theme-withhold
    ab ss4m 'panel=shell-shallow&n=4&drive=theme:10' g25.theme-withhold
}

batch_b08() {
    BATCH=b08
    ab cdt 'panel=code-document&drive=type' g18.canvas-width
    ab sdy 'panel=shell-deep&drive=type' g18.canvas-width
    ab ssy 'panel=shell-shallow&drive=type' g18.canvas-width
}

batch_b09() {
    BATCH=b09
    ab clq 'panel=chart-line&drive=passes' chart.repaint-gate chart.margin-memo g18.measure-memo
    ab cdq 'panel=chart-dashboard&n=50&drive=passes' chart.repaint-gate chart.margin-memo g18.measure-memo g11.gather-residue
    check clu 'panel=chart-line&drive=update' chart.repaint-gate chart.margin-memo
    check cdu 'panel=chart-dashboard&n=50&drive=update' chart.repaint-gate chart.margin-memo
    ab cdd 'panel=chart-dashboard&n=50&drive=drag' chart.margin-memo
}

batch_b10() {
    BATCH=b10
    ab clh 'panel=chart-line&drive=hover' g19.tooltip-idle g20.walk-dose
    ab cdh 'panel=chart-dashboard&n=50&drive=hover' g19.tooltip-idle g20.walk-dose
}

batch_b11() {
    BATCH=b11
    ab fnq 'panel=form-nested&passes=form&drive=passes' g05.lazy-reads g11.gather-residue g16.panel-settled g09.all
    ab ffq 'panel=form-flat&passes=form&drive=passes' g05.lazy-reads g11.gather-residue g16.panel-settled g09.all
    check ffh 'panel=form-flat&passes=header&drive=passes' g05.lazy-reads
}

batch_b12() {
    BATCH=b12
    ab fnw 'panel=form-nested&drive=wheel' g16.scroll-reads
    ab ffw 'panel=form-flat&drive=wheel' g16.scroll-reads
    ab fny 'panel=form-nested&type=text&drive=type' g19.tooltip-idle
    ab ffy 'panel=form-flat&type=text&drive=type' g19.tooltip-idle
    ab ffc 'panel=form-flat&click=combo&drive=click' g18.measure-memo
    ab ffk 'panel=form-flat&click=toggle&drive=click' g28.transform-inline
}

batch_b13() {
    BATCH=b13
    ab w8v 'panel=windows&drive=viewport' g08.env-reads
    ab w4v 'panel=windows&n=4&drive=viewport' g08.env-reads
    ab wdlg 'panel=windows&drive=toggle:120' g08.env-reads
    ab wq 'panel=windows&drive=passes' g09.all g09.chrome
    ab mt 'panel=menus&drive=toggle' g08.env-reads g18.measure-memo
}

batch_b14() {
    BATCH=b14
    ab trk 'panel=table-rows&drive=key' g21.render-pass
    ab t9k 'panel=table-rows&n=900&drive=key' g21.render-pass
    ab tru 'panel=table-rows&drive=update' g21.render-pass g23.write-economy
    ab trq 'panel=table-rows&drive=passes' g21.render-pass
    ab ttk 'panel=treetable-rows&drive=key' g21.render-pass
    ab ttu 'panel=treetable-rows&drive=update' g21.render-pass
}

batch_b15() {
    BATCH=b15
    ab trr 'panel=table-rows&drive=resize,idle:4' g22.settle-relay
    ab ttr 'panel=treetable-rows&drive=resize,idle:4' g22.settle-relay
    ab t9f 'panel=table-rows&n=900&update=filter&drive=update' g23.write-economy
    ab t9s 'panel=table-rows&n=900&drive=click' g23.write-economy
    ab trw 'panel=table-rows&drive=wheel' g21.render-pass g23.write-economy
}

batch_b16() {
    BATCH=b16
    ab li3 'panel=list-items&drive=key' g24.list-rows
    ab li30 'panel=list-items&n=3000&drive=key' g24.list-rows
    ab tnq 'panel=tree-nodes&drive=passes' g24.tree-window
    ab tnk 'panel=tree-nodes&drive=key' g18.measure-memo
}

batch_b17() {
    BATCH=b17
    ab m60d 'panel=markdown-doc&drive=drag' g26.viewer-resize
    ab m240d 'panel=markdown-doc&n=240&drive=drag' g26.viewer-resize
    ab mdq 'panel=markdown-doc&drive=passes' g26.viewer-resize
    ab m60w 'panel=markdown-doc&drive=wheel' g27.heading-cache
    ab m240w 'panel=markdown-doc&n=240&drive=wheel:300' g27.heading-cache
}

batch_b18() {
    BATCH=b18
    ab cdw 'panel=code-document&drive=wheel' g16.scroll-reads
    ab sdw 'panel=shell-deep&wheel=editor&drive=wheel' g16.scroll-reads
    ab ssw 'panel=shell-shallow&wheel=editor&drive=wheel' g16.scroll-reads
    ab dgp 'panel=diagram-graph&drive=pan' g28.transform-inline
}

batch_b19() {
    BATCH=b19
    export QA_WT_LIB="${W3_C40_BEFORE_LIB:-}"
    pair c40u 'panel=form-flat&drive=update'
    pair c40r 'panel=form-flat&click=root&drive=click'
    pair c40t 'panel=form-flat&click=toggle&drive=click'
    pair c40p 'panel=form-flat&drive=pan'
    run "$(name c21 main 1)" main "panel=form-flat&drive=call:120&$FLAGS"
}

# Stops with exit 2, before any run, when a build the selected batches need is missing.
preflight() {
    local main_lib=${QA_MAIN_LIB:-$QA/../lib} b

    if [ ! -f "$main_lib/dist/lib/core.es.js" ]; then
        echo "no build at $main_lib/dist/lib — run npm run build:lib first" >&2
        exit 2
    fi

    for b in "$@"; do
        if [ "$b" = b19 ] && [ ! -f "${W3_C40_BEFORE_LIB:-/nonexistent}/dist/lib/core.es.js" ]; then
            echo "batch b19 needs W3_C40_BEFORE_LIB set to a built packages/lib at 3e36ca60" >&2
            exit 2
        fi
    done
}

case "${1:-}" in
    --dry-run) MODE=dry; shift ;;
    --list) MODE=list; shift ;;
esac

selected=("$@")

if [ ${#selected[@]} -eq 0 ]; then
    read -r -a selected <<< "$BATCHES"
fi

for b in "${selected[@]}"; do
    case " $BATCHES " in
        *" $b "*) ;;
        *) echo "unknown batch \"$b\" (batches: $BATCHES)" >&2; exit 2 ;;
    esac
done

if [ "$MODE" = run ]; then
    preflight "${selected[@]}"
fi

total=0

for b in "${selected[@]}"; do
    RUNS=0
    "batch_$b"
    total=$((total + RUNS))

    if [ "$MODE" = list ]; then
        printf '%s %d\n' "$b" "$RUNS"
    fi
done

if [ "$MODE" = list ]; then
    printf 'total %d\n' "$total"
fi
```

The script was exercised offline while drafting this plan, in `--list` and `--dry-run` modes and against a stub runner. It gave 394 runs, unique names, a stop at the stub's first failure, and exit 2 for an unknown batch or a missing `b19` build.

---

## The Matrix

S1, S2, S3 and S6 are the review's Loom scenarios (`99-synthesis.md`, *The scenarios*): the 2×2 dock grid's horizontal gutter drag, its vertical gutter drag, the explorer gutter drag, and typing with the status bar live. `shell-deep` and `shell-shallow` stand in for S1 and S3.

Every run is on MiniBrowser and the `main` build unless marked `wt`, and every run carries `work=1&seam=1&geom=1`. `n` is the panel's default unless given. Units are 150 unless the drive says otherwise. Phases that change the page for later phases — `toggle`, `theme`, `type` — come last or alone, as the README's rule requires; no cell drags `grip=tab`.

### The counter each arm is scored on

`qa-ab.py` takes one `--counter` per invocation. Read each cell once per arm it holds, with that arm's counter.

| Arm | Candidate | `--counter` |
|---|---|---|
| `split.noop-drag`, `split.recalc-gate`, `g12.collapse-static`, `g14.closed-section`, `g09.all`, `g09.chrome`, `g21.render-pass`, `g22.settle-relay`, `g24.tree-window` | G12, G14, G09, G21, G22, G24 | `work` |
| `g05.lazy-reads` | G05 | `work.sizeHintMiss@*` |
| `g08.env-reads` | G08 | `seam.source.getViewportSize + seam.source.getThemeVar - work.memo.g08.env-reads.viewportHit - work.memo.g08.env-reads.themeVarHit` |
| `g11.gather-residue` | G11 | `work.reserveContentFrame@* + work.measureContent@* + work.getLaidOutComponents@* - work.skipped.g11.gather-residue.* - work.memo.g11.gather-residue.*` |
| `g16.panel-settled` | G16 | `seam.source.getScrollMetrics` |
| `g16.scroll-reads` | G16 | `seam.source.getScrollMetrics - work.memo.g16.scroll-reads.metricsHit` |
| `g18.measure-memo` | G18 | `seam.source.measureText + seam.source.measureTexts + seam.source.measureTextWidths - work.memo.g18.measure-memo.callHit` |
| `g18.canvas-width` | G18 | `seam.source.measureText - work.memo.g18.canvas-width.canvas` |
| `g19.tooltip-idle`, `g23.write-economy`, `g24.list-rows`, `chart.repaint-gate` | G19, G23, G24, F26.1 | `sink` |
| `g20.walk-dose` | G20 | `seam.source.getParentElement + seam.source.getId` (the dose reading) |
| `g25.theme-withhold` | G25 | `work.onThemeChange@CodeEditor - work.skipped.g25.theme-withhold.theme` |
| `g26.viewer-resize` | G26 | `seam.source.getElementRect + seam.source.getScrollMetrics - work.memo.g26.viewer-resize.rectHit` |
| `g27.heading-cache` | G27 | `seam.source.querySelector + seam.source.getElementRect` |
| `g28.transform-inline` | G28 | `seam.sink.setRuleStyles` |
| `chart.margin-memo` | F26.2 | `seam.source.measureText` |

### Batches

Time is the estimated wall time for the batch: about 9 s of start-up, mount and idle frames per run, plus the units at the per-unit costs the README records.[^estimate] Cells marked *check* are check cells; all others are scored.

| Batch | Cell | Parameters | Arms | Extra gates | Runs | Time |
|---|---|---|---|---|---|---|
| `b00` baseline | 28 cells of one plain run each (listed in the script) | — | — | — | 28 | 11 min |
| `b01` S1's gesture | `sdh` | `panel=shell-deep&drive=drag` (grip `dock-h`) | `g09.all`, `g09.chrome`, `split.recalc-gate` | — | 9 | 4 min |
| `b02` park | `sdp` | `panel=shell-deep&drive=park` | `split.noop-drag`, `split.recalc-gate` | — | 7 | 2.5 min |
| | `ssp` | `panel=shell-shallow&drive=park` | `split.noop-drag` | — | 5 | |
| `b03` sidebar drag | `sds` | `panel=shell-deep&grip=sidebar&drive=drag` | `g14.closed-section` | — | 5 | 3.5 min |
| | `sss` | `panel=shell-shallow&grip=sidebar&drive=drag` | `g14.closed-section` | — | 5 | |
| `b04` resize | `sdr` | `panel=shell-deep&drive=resize` | `g05.lazy-reads`, `g11.gather-residue`, `g09.all`, `g09.chrome` | — | 11 | 7.5 min |
| | `ssr` | `panel=shell-shallow&drive=resize` | same four | — | 11 | |
| `b05` passes | `sdq` | `panel=shell-deep&drive=passes` | `split.recalc-gate`, `g09.all` | — | 7 | 2.5 min |
| | `ssq` | `panel=shell-shallow&drive=passes` | `split.recalc-gate`, `g09.all` | — | 7 | |
| `b06` pane collapse | `sdt` | `panel=shell-deep&toggle=pane&drive=toggle:120` | `g12.collapse-static` | `--allow-diff files,outline,history,main,dock,header0,editor0,editor1,editor2,editor3` | 5 | 2.5 min |
| | `sst` | `panel=shell-shallow&toggle=pane&drive=toggle:120` | `g12.collapse-static` | `--allow-diff files,outline,history,main,dock,header0,editor0` | 5 | |
| `b07` theme | `sd4m` | `panel=shell-deep&n=4&drive=theme:10` | `g25.theme-withhold` | — | 5 | 2.5 min |
| | `ss4m` | `panel=shell-shallow&n=4&drive=theme:10` | `g25.theme-withhold` | — | 5 | |
| `b08` typing (S6) | `cdt` | `panel=code-document&drive=type` | `g18.canvas-width` | — | 5 | 4.5 min |
| | `sdy` | `panel=shell-deep&drive=type` | `g18.canvas-width` | — | 5 | |
| | `ssy` | `panel=shell-shallow&drive=type` | `g18.canvas-width` | — | 5 | |
| `b09` chart passes | `clq` | `panel=chart-line&drive=passes` | `chart.repaint-gate`, `chart.margin-memo`, `g18.measure-memo` | — | 9 | 7 min |
| | `cdq` | `panel=chart-dashboard&n=50&drive=passes` | the same three and `g11.gather-residue` | — | 11 | |
| | `clu` *check* | `panel=chart-line&drive=update` | `chart.repaint-gate`, `chart.margin-memo` | `--same seam.sink.createElementNS` | 4 | |
| | `cdu` *check* | `panel=chart-dashboard&n=50&drive=update` | `chart.repaint-gate`, `chart.margin-memo` | `--same seam.sink.createElementNS` | 4 | |
| | `cdd` | `panel=chart-dashboard&n=50&drive=drag` | `chart.margin-memo` | — | 5 | |
| `b10` chart hover | `clh` | `panel=chart-line&drive=hover` | `g19.tooltip-idle`, `g20.walk-dose` | — | 7 | 3 min |
| | `cdh` | `panel=chart-dashboard&n=50&drive=hover` | `g19.tooltip-idle`, `g20.walk-dose` | — | 7 | |
| `b11` form passes | `fnq` | `panel=form-nested&passes=form&drive=passes` | `g05.lazy-reads`, `g11.gather-residue`, `g16.panel-settled`, `g09.all` | — | 11 | 4 min |
| | `ffq` | `panel=form-flat&passes=form&drive=passes` | the same four | — | 11 | |
| | `ffh` *check* | `panel=form-flat&passes=header&drive=passes` | `g05.lazy-reads` | — | 3 | |
| `b12` form events | `fnw` | `panel=form-nested&drive=wheel` | `g16.scroll-reads` | — | 5 | 6.5 min |
| | `ffw` | `panel=form-flat&drive=wheel` | `g16.scroll-reads` | — | 5 | |
| | `fny` | `panel=form-nested&type=text&drive=type` | `g19.tooltip-idle` | — | 5 | |
| | `ffy` | `panel=form-flat&type=text&drive=type` | `g19.tooltip-idle` | — | 5 | |
| | `ffc` | `panel=form-flat&click=combo&drive=click` | `g18.measure-memo` | — | 5 | |
| | `ffk` | `panel=form-flat&click=toggle&drive=click` | `g28.transform-inline` | — | 5 | |
| `b13` windows, menus | `w8v` | `panel=windows&drive=viewport` | `g08.env-reads` | — | 5 | 6.5 min |
| | `w4v` | `panel=windows&n=4&drive=viewport` | `g08.env-reads` | — | 5 | |
| | `wdlg` | `panel=windows&drive=toggle:120` | `g08.env-reads` | — | 5 | |
| | `wq` | `panel=windows&drive=passes` | `g09.all`, `g09.chrome` | — | 7 | |
| | `mt` | `panel=menus&drive=toggle` | `g08.env-reads`, `g18.measure-memo` | — | 7 | |
| `b14` table passes and keys | `trk` | `panel=table-rows&drive=key` | `g21.render-pass` | — | 5 | 7.5 min |
| | `t9k` | `panel=table-rows&n=900&drive=key` | `g21.render-pass` | — | 5 | |
| | `tru` | `panel=table-rows&drive=update` | `g21.render-pass`, `g23.write-economy` | — | 7 | |
| | `trq` | `panel=table-rows&drive=passes` | `g21.render-pass` | — | 5 | |
| | `ttk` | `panel=treetable-rows&drive=key` | `g21.render-pass` | — | 5 | |
| | `ttu` | `panel=treetable-rows&drive=update` | `g21.render-pass` | — | 5 | |
| `b15` table resize, filter, sort, wheel | `trr` | `panel=table-rows&drive=resize,idle:4` | `g22.settle-relay` | `--allow-diff cell@0` | 5 | 8 min |
| | `ttr` | `panel=treetable-rows&drive=resize,idle:4` | `g22.settle-relay` | — | 5 | |
| | `t9f` | `panel=table-rows&n=900&update=filter&drive=update` | `g23.write-economy` | — | 5 | |
| | `t9s` | `panel=table-rows&n=900&drive=click` | `g23.write-economy` | — | 5 | |
| | `trw` | `panel=table-rows&drive=wheel` | `g21.render-pass`, `g23.write-economy` | — | 7 | |
| `b16` lists and trees | `li3` | `panel=list-items&drive=key` | `g24.list-rows` | — | 5 | 5 min |
| | `li30` | `panel=list-items&n=3000&drive=key` | `g24.list-rows` | — | 5 | |
| | `tnq` | `panel=tree-nodes&drive=passes` | `g24.tree-window` | — | 5 | |
| | `tnk` | `panel=tree-nodes&drive=key` | `g18.measure-memo` | — | 5 | |
| `b17` Markdown | `m60d` | `panel=markdown-doc&drive=drag` | `g26.viewer-resize` | — | 5 | 6.5 min |
| | `m240d` | `panel=markdown-doc&n=240&drive=drag` | `g26.viewer-resize` | — | 5 | |
| | `mdq` | `panel=markdown-doc&drive=passes` | `g26.viewer-resize` | — | 5 | |
| | `m60w` | `panel=markdown-doc&drive=wheel` | `g27.heading-cache` | `--same 'work.heading@*'` | 5 | |
| | `m240w` | `panel=markdown-doc&n=240&drive=wheel:300` | `g27.heading-cache` | `--same 'work.heading@*'` | 5 | |
| `b18` scroll and motion | `cdw` | `panel=code-document&drive=wheel` | `g16.scroll-reads` | — | 5 | 5.5 min |
| | `sdw` | `panel=shell-deep&wheel=editor&drive=wheel` | `g16.scroll-reads` | — | 5 | |
| | `ssw` | `panel=shell-shallow&wheel=editor&drive=wheel` | `g16.scroll-reads` | — | 5 | |
| | `dgp` | `panel=diagram-graph&drive=pan` | `g28.transform-inline` | — | 5 | |
| `b19` witnesses | `c40u`, `c40r`, `c40t`, `c40p` | before (`wt`, `3e36ca60`) and after (`main`) | — | — | 8 | 2 min |
| | `c21` | `panel=form-flat&drive=call:120` | — | — | 1 | |
| **Total** | | | | | **394** | **≈ 1 h 41 min** |

**The baseline (`b00`)** re-measures, on `master`, the MiniBrowser shapes behind each panel's *Validated* entry in the README, recorded at `608544c9`. It adds six shapes that no entry covers:

- `sdh`: `shell-deep` with the default `grip=dock-h`, S1's own gesture, which has no recorded baseline;
- `sd4h`: the same at `n=4`, S1's tab count, closing with `theme:4`;
- `sdv`: the vertical dock gutter, S2's gesture;
- `li1`: `list-items` at n=1;
- `mdu` and `mdu480`: `markdown-doc`'s `update` at n=60 and n=480, for the lexer ratio.

The baseline's own reading is in *Counter-only reads*. Its numbers also replace the README's *Validated* figures, which describe `608544c9`.

**Deep and shallow.** Every candidate whose cost scales with the document has a deep and a shallow cell:

| Candidate | Deep | Shallow |
|---|---|---|
| shells | `shell-deep` | `shell-shallow` |
| charts | `chart-dashboard` | `chart-line` |
| forms | `form-nested` | `form-flat` |
| windows | `n=8` | `n=4` |
| tables | `n=10,000` | `n=900` |
| lists | `n=3,000` | `n=300` |
| Markdown | `n=240` | `n=60` |
| G25 | four tabs per region, 12 hidden editors | one region of four tabs, 3 hidden |

G22's cost scales with the row pool and the columns, not with n, so it has no size pair. G28's paths are per event and do not scale.

**Two-phase cells.** In `trr` and `ttr`, phase 0 (`resize`) is the scored phase. Phase 1 (`idle:4`) captures the settle, and only has to read geom `=`.

### Sessions

The three sessions group whole batches. Each takes about 30–40 minutes, and a session boundary never splits a batch.

| Session | Batches | Runs | Time |
|---|---|---|---|
| A | `b00`–`b08` | 130 | ≈ 40 min |
| B | `b09`–`b13` | 131 | ≈ 27 min |
| C | `b14`–`b19` | 133 | ≈ 34 min |

### Running the sweep (the orchestrator, with the user's go-ahead)

1. From the repository root, on the commit to measure: `npm run build:lib`.
2. Build the C40 before-arm, following the README's arm recipe:

   ```sh
   git worktree add .worktrees/_c40-before 3e36ca60 --detach
   ln -sfn "$PWD/node_modules" .worktrees/_c40-before/node_modules
   (cd .worktrees/_c40-before/packages/lib && npm run build:lib)
   export W3_C40_BEFORE_LIB="$PWD/.worktrees/_c40-before/packages/lib"
   ```

3. `packages/qa/sweeps/w3-0.sh --list` — expect the per-batch counts and `total 394`; it opens nothing.
4. Session A: `packages/qa/sweeps/w3-0.sh b00 b01 b02 b03 b04 b05 b06 b07 b08`. Session B: `… b09 b10 b11 b12 b13`. Session C: `… b14 b15 b16 b17 b18 b19`.
5. **To re-run one batch**, give it a new session tag so its names do not mix with the first run's: `W3_SESSION=s2 packages/qa/sweeps/w3-0.sh b04`. A re-run batch is read only against itself.
6. A stopped sweep prints the failing run's error or `NO RESULT`. Fix the cause, then re-run from the failing batch under a new session tag.

---

## Counter-only reads

Each reads the baseline batch `b00`, with `python3 packages/qa/bin/qa-table.py packages/qa/results w3s1-b00-<cell>- --seam --work`. Counts are deterministic, so one run decides.

| Candidate | Cell · phase | Read | Rule |
|---|---|---|---|
| G17 | `tn` · `key`; `tt` · `toggle` | per unit: `seam.sink.ensureStyleRule` + `seam.sink.createElementNS` + `seam.source.querySelector` | **plan it** when the sum is at least 1.0 per unit on either phase; **drop it** otherwise. A rename leaves one attribute write per swap and removes the rest. |
| `resizeMode` | `sdh`, `sd4h`, `sdv`, `sds`, `sss` · `drag`; `we` · `drag` | the phase's `avg` minus the run's `idle` | the bound per drag frame. **plan it** when it exceeds 16.7 ms, one 60 Hz frame, on any drag; otherwise **drop it** as a performance lever. The feature itself is already adopted (`00-agenda.md` Decision 2); this number only ranks it. |
| G26 lexer | `mdu` and `mdu480` · `update` | `r = avg(n=480) ÷ avg(n=60)` | linear work gives about 8 and a quadratic lexer up to 64. **plan it** when r ≥ 16; **drop it** when r ≤ 10; **needs a different surface** (a `wt` lexer arm) in between. |
| G21 narrowing (F19.5, F22.2) | `tr` · `update` against `tr` · `passes` | `sink/u(update) − sink/u(passes)` | the rebind excess a one-record update pays. **plan it** when it is at least 10% of `sink/u(update)` and at least 1.0 per unit; otherwise **drop it**. |
| G24 no-op move (F18.7) | `li1` · `key` | `seam.sink.dispatchCustomEvent` per unit | **plan it** when above 0; **drop it** at 0. |

G11 also gets a context line, recorded but not scored. On the plain arms of `b04`'s `sdr` cell, `getPreferredSize@*` + `getMinSize@*` + `getMaxSize@*` minus `sizeHintMiss@*` is the number of memo hits a per-phase gather could still remove. W2.0 measured hits of that kind as free.

## The Witnesses (`b19`)

Read with `python3 packages/qa/bin/qa-table.py packages/qa/results w3s1-b19-c40 --seam --work`.

| Case | Cell | Before (`wt`, `3e36ca60`) | After (`main`) |
|---|---|---|---|
| 24 | `c40u` · `update` | `seam.sink.dispatchCustomEvent` 2.00; `checkbox.action` and `slider.action` 1.00 each | all three 0 |
| 25 | `c40r` · `click` (`click=root`) | `checkbox.action` 1.00; `dispatchCustomEvent` 0 | `checkbox.action` 0; `dispatchCustomEvent` 0 |
| 26 | `c40t` · `click` (`click=toggle`, 150 units) | `dispatchCustomEvent` and `checkbox.action` 0.50 each | the same 0.50 each |
| 27 | `c40p` · `pan` | `slider.action` some value | the same value |

C21 has no before arm: the witness's hover arms the tooltip through the covering mode that `field-decorator-pointer-tooltip` added after C21's fix, so a pre-fix build could not show the tooltip at all. Read it with:

```sh
python3 -c "import json,glob; r=json.load(open(sorted(glob.glob('packages/qa/results/w3s1-b19-c21-main-1-*.json'))[-1])); t=r['phases'][0]['geometry']['tooltip']; f=next((i for i,x in enumerate(t) if x), None); print(f, f is not None and all(x==t[f] for x in t[f:]))"
```

It should print about `30 True`: `null` until the 500 ms hover delay runs out, then one unchanging rectangle to unit 119. `None False` means the hover never armed, and the run says nothing about C21. A number followed by `False` means the rectangle changed or went `null` after the keystroke, which is C21 back.

## Recording the Results

The orchestrator writes `plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md`, in `97-wave2-measurement.md`'s shape:

1. **Header.** The date, the `main` commit and the `3e36ca60` before-arm, the host, the flags, the session tags, and every batch re-run with the reason.
2. **Results.** One table per candidate, one row per cell: plain mean and bracket, arm mean, Δms, `ms`, the counter's plain and arm values, Δ%, `work`, `geom`, `engaged`, and the cell verdict, as `qa-ab.py` printed them. Then the candidate verdict by the rule.
3. **Counter-only reads**, with each rule applied.
4. **The fresh baseline**, one row per `b00` cell and phase, beside the README figure it replaces.
5. **The witnesses**, C40's four cases and C21's reading.
6. **What survives.** Every *plan it*, ordered by work avoided, then milliseconds. Every *needs a different surface*, with the surface it needs. Every *drop it*, with its evidence.

The README's *Validated* column is then updated from the baseline, naming the commit measured.

---

## Ordered Implementation Steps

Work test-first: write each step's cases from *Expected Behaviour*, watch them fail, then implement. **Never run `packages/qa/runqa.sh`, `packages/qa/sweeps/w3-0.sh` without `--dry-run` or `--list`, MiniBrowser, or the Tauri `qa-host`**: each opens a full-screen window on the user's desktop.

1. **Build the library** from the worktree root: `npm run build:lib`. The QA tests import the build, not the source.
2. **Plumb the library objects into ablations.**
   - `src/harness/types.ts`: the `HarnessLibrary` and `Ablation` shapes in *Harness changes*.
   - `src/harness/run.ts`: `applyAblations(abl, tools, notes, lib)` calls `ablation(tools, lib)`, and `instrument` passes `run.lib`.
   - `src/main.ts`: import `AbstractWindow` and `Tooltip` from `@jimka/typescript-ui/overlay` into `lib`.
   - Check: `npm -w packages/qa run typecheck` passes, and every existing ablation still compiles unchanged, since a function taking fewer parameters satisfies the type.
3. **Write the test support** `tests/patchGuard.ts`:
   - `snapshotPatchables(objects)` records `Object.getOwnPropertyDescriptors` of each object;
   - `restorePatchables(snapshot)` deletes every own property added since and redefines every one that changed;
   - `patchablesOf(tools, lib)` collects every prototype, and its constructor, along the chain of every live component and layout manager, plus `lib.DOM.sink`, `lib.DOM.source`, their prototypes, `lib.Tooltip`, `lib.AbstractWindow` and `Date.prototype`.

   Both ablation test files snapshot before applying an ablation or installing counters, and restore in `afterEach`, after unmounting as `mount.test.ts` does.
4. **Add the work counters** in `src/harness/counters.ts` (*Harness changes*). Check: case A29.
5. **Add the panel labels and counters** (*Panel additions*) in `src/builders/shell.ts`, `src/panels/windows.ts`, `src/panels/table-rows.ts`, `src/panels/treetable-rows.ts` and `src/panels/markdown-doc.ts`. Check: `npm -w packages/qa run test` still passes P1–P14, E1–E21 and the C21 file.
6. **Ablation helpers and the two rewrites** in `src/harness/ablations.ts`:
   - add `bump`, `perTask`, `withOwnMethod` and `chainClass`;
   - rewrite `split.noop-drag` and `split.recalc-gate`.

   Check: cases A3, A4.
7. **The layout ablations**: `g05.lazy-reads`, `g09.all`, `g09.chrome`, `g11.gather-residue`, `g12.collapse-static`, `g14.closed-section`. Check: A5, A6, A8, A9, A10.
8. **The environment, scroll and text ablations**: `g08.env-reads`, `g16.panel-settled`, `g16.scroll-reads`, `g18.measure-memo`, `g18.canvas-width`, `g19.tooltip-idle`, `g20.walk-dose`. Check: A7, A11–A16.
9. **The table and list ablations**: `g21.render-pass`, `g22.settle-relay`, `g23.write-economy`, `g24.list-rows`, `g24.tree-window`. Check: A17–A21.
10. **The editor, Markdown, motion and chart ablations**: `g25.theme-withhold`, `g26.viewer-resize`, `g27.heading-cache`, `g28.transform-inline`, `chart.repaint-gate`, `chart.margin-memo`. Check: A22–A27, then A1, A2 and A28 over every ablation.
11. **`bin/qa-table.py`**: add `--work` and the `dose.` bookkeeping prefix. Check: T1.
12. **`bin/qa-ab.py`** (executable, `#!/usr/bin/env python3`) and its fixtures in `tests/fixtures/ab/`. Check: T2–T5.
13. **`sweeps/w3-0.sh`**, copied from *The Sweep Script*, then `chmod +x`, and `tests/sweep.test.ts`. Check: W1–W11, and `packages/qa/sweeps/w3-0.sh --list` prints `total 394`.
14. **`packages/qa/README.md`** (*Documentation Impact*). Check: `grep -c 'qa-ab.py' packages/qa/README.md` is at least 2, and this loop prints nothing:

    ```sh
    grep -o "^    '[A-Za-z0-9.-]*':" packages/qa/src/harness/ablations.ts | tr -d " ':" | while read -r n; do grep -q "\`$n\`" packages/qa/README.md || echo "MISSING $n"; done
    ```

15. **Final checks** (*Verification*).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/qa/src/harness/types.ts` |
| Modify | `packages/qa/src/harness/run.ts` |
| Modify | `packages/qa/src/main.ts` |
| Modify | `packages/qa/src/harness/counters.ts` |
| Modify | `packages/qa/src/harness/ablations.ts` |
| Modify | `packages/qa/src/builders/shell.ts` |
| Modify | `packages/qa/src/panels/windows.ts` |
| Modify | `packages/qa/src/panels/table-rows.ts` |
| Modify | `packages/qa/src/panels/treetable-rows.ts` |
| Modify | `packages/qa/src/panels/markdown-doc.ts` |
| Modify | `packages/qa/bin/qa-table.py` |
| Create | `packages/qa/bin/qa-ab.py` |
| Create | `packages/qa/tests/fixtures/ab/` (seven reports; see T2) |
| Create | `packages/qa/tests/patchGuard.ts` |
| Create | `packages/qa/tests/ablations.test.ts` |
| Create | `packages/qa/tests/ablations.canvas.test.ts` |
| Create | `packages/qa/tests/sweep.test.ts` |
| Create | `packages/qa/sweeps/w3-0.sh` |
| Modify | `packages/qa/README.md` |

Nothing under `packages/lib` changes: `git diff --stat master -- packages/lib packages/docs` stays empty.

---

## Expected Behaviour

### Ablations — unit, jsdom (`tests/ablations.test.ts`, `tests/ablations.canvas.test.ts`)

Both files use `mount.test.ts`'s `tools` override and `SMOKE_WAITS`. `lib` is `{ Body, DOM, Tooltip, AbstractWindow }`. "Mount *p*" means `mountPanel('p', new URLSearchParams('n=3'), tools, SMOKE_WAITS)`, unless another `n` is given.

"Counted" means inside `startCounting()` … `stopCounting(1)`, reading the returned `work`; "seam-counted" also installs `installSeamCounters(DOM)` first, restoring the seam as `panels.test.ts`'s P3 does.

The canvas file stubs `HTMLCanvasElement.prototype.getContext` as `formCallTarget.test.ts` does, with a `measureText` returning a width of 7 per character. It holds A14, A18 and A19, whose panels need a 2D context.

| # | Ablation | Setup | Expect |
|---|---|---|---|
| A1 | all | — | `ABLATIONS` has the 26 names in *The ablations*, and every existing name besides. |
| A2 | every ablation with a component target | mount `canvas-idle` | the note starts with `no ` for `split.*`, `g12.collapse-static`, `g14.closed-section`, `g21.render-pass`, `g22.settle-relay`, `g23.write-economy`, `g24.*`, `g25.theme-withhold`, `g26.viewer-resize`, `g27.heading-cache` and `chart.*`. `g19.tooltip-idle` with a `lib` lacking `Tooltip` notes `no Tooltip`. `g18.canvas-width` with no 2D context notes `no canvas 2D context`. |
| A3 | `split.noop-drag` | mount `shell-shallow` at n=1; `split` = `tools.findLayoutManager('Split')`; `gutter` = `split._gutters[0]`; `container` = the component whose manager is `split`; set `_dragOriginPointer` to 0 and `_dragOriginLhsSize`/`_dragOriginRhsSize` to the two panes' widths | counted `split.onDrag(container, gutter, 0)` gives `skipped.split.noop-drag.paneLayout` 2. `onDrag(container, gutter, 20)` adds none, and the first pane is 20 px wider. Neither pane has an own `doLayout` afterwards. |
| A4 | `split.recalc-gate` | as A3 | three counted `split.recalculateSizes()` calls give `skipped.split.recalc-gate.recalc` at least 1. After `container.setWidth(container.getWidth() - 10)`, one more call adds none. |
| A5 | `g12.collapse-static` | as A3 | the note does not start with `no `; `split.setPaneCollapsed(0, true)` returns `split`, and `split.isPaneCollapsed(0)` is `true`. Engagement is engine-only: the animation needs frames. |
| A6 | `g05.lazy-reads` | mount `chart-line`; `lm` = `tools.findLayoutManager('Fit')`, with `vi.spyOn(lm, 'getLayoutConstraints').mockReturnValue(null)` so the argument decides the fill; spy on the chart's `getPreferredSize` | counted `lm.resolveBounds(chart, 0, 0, 100, 50, 'both')` returns `{ x: 0, y: 0, width: 100, height: 50 }`, `skipped.g05.lazy-reads.resolve` 1, spy not called. With `'none'` the spy is called and the counter does not move. |
| A7 | `g08.env-reads` | mount `windows` | counted: two `source.getViewportSize()` calls give `viewportMiss` 1 and `viewportHit` 1, and after `await Promise.resolve()` a third is a miss. Two `getThemeVar('--ts-ui-font-size')` give 1 miss and 1 hit; after `sink.apply(source.getDocumentElement(), {})` the next is a miss. Two `lib.AbstractWindow.relayoutMinimizedStack()` calls in one task give `skipped.g08.env-reads.minStack` 1. |
| A8 | `g09.chrome`, then `g09.all` in its own test | mount `shell-shallow` | under `g09.chrome`, a `Header`'s `canSkipUnchangedLayout()` is `true` and the root `Panel`'s is `false`. Under `g09.all` both are `true`, and a second counted `root.doLayout()` gives `skipped.g09.all.commit` at least 1. |
| A9 | `g11.gather-residue` | mount `chart-dashboard` | a counted `grid.doLayout()` gives `skipped.g11.gather-residue.measureContent` at least 1. `grid.getLaidOutComponents()` returns `grid._components` itself; after one chart's `setDisplayed(false)` it returns a new array without that chart. |
| A10 | `g14.closed-section` | mount `shell-shallow`; `sidebar` and `history` are `mounted.build.geometry.sidebar` and `.history`; spy on `history.getPreferredSize` | two counted `sidebar.doLayout()` calls: in the second, `closedReflow` and `closedPreferred` are each at least 1 and the spy is not called. `Object.hasOwn(history, 'doLayout')` is `false` afterwards. |
| A11 | `g16.panel-settled` | mount `markdown-doc`; `pane` = `tools.findComponent('MarkdownContentPane')` | a second counted `pane.doLayout()` gives `skipped.g16.panel-settled.remeasure` at least 1. After `pane.setWidth(pane.getWidth() - 10)`, the next pass adds none. |
| A12 | `g16.scroll-reads` | as A11 | two `pane.getMaxScrollTop()` calls in one task give `maxScrollHit` 1; after a microtask the next gives none. Two `pane.resizeScrollShadowOverlay()` calls give `skipped.g16.scroll-reads.shadowResize` 1. |
| A13 | `g18.measure-memo` | mount `chart-line` | counted: `measureText('abc')` twice gives `callMiss` 1 and `callHit` 1; with `{ maxWidth: 50 }` it misses. `measureTexts([{ text: 'abc' }, { text: 'xyz' }])` is a miss and returns two results, the first equal to the memoised one. After `sink.apply(source.getDocumentElement(), {})`, `measureText('abc')` misses. |
| A14 | `g18.canvas-width` | canvas file; mount `chart-line` | the first `measureText('abcd')` returns the original's result, with no `canvas` bump. `measureText('abcdef')` returns width 42 and the first call's height and baseline, with `canvas` 1. `{ maxWidth: 10 }` calls the original. `{ fontSize: 'calc(1px + 1em)' }` calls the original and bumps `fallback`. |
| A15 | `g19.tooltip-idle` | mount `chart-line`; `c` = the chart | `Tooltip.hide()` with no instance gives `skipped.g19.tooltip-idle.hide` 1 and leaves `Tooltip.instance` `null`. `Tooltip.attach(c, 'a')` twice gives `attach` 1; after `Tooltip.detach(c)`, `attach(c, 'a')` adds none. Two attaches whose `colors` are separate objects both equal to `{ background: 'red' }` add 1. |
| A16 | `g20.walk-dose` | mount `chart-line`; `h` = the chart's element handle; record `source.getParentElement(h)` before installing | after installing, `getParentElement(h)` returns the recorded handle, and each call adds `dose.g20.walk-dose.extraCall` 1; `getId(h)` likewise. |
| A17 | `g21.render-pass` | mount `treetable-rows`; `body` = `tools.findComponent('TableBody')` | two `body.getVisibleRecords()` calls return the same array, with `visibleHit` at least 1. With `body._previousFocusedCell = null`, a counted `body._updateFocusStyle()` gives `focusSweep` 1, and a spy on the first pool cell's `setStyleState` sees no `('.focused', false)` call. `body.applyRequiredEmptyState(body._rowPool[0], body.getVisibleRecords()[0])` gives `requiredEmpty` 1. |
| A18 | `g22.settle-relay` | canvas file; mount `table-rows` at n=20; `body` = `tools.findComponent('TableBody')` | counted `body.renderWindow(body._lastBodyWidth + 5, body._lastColumnWidths.map((w) => w + 5))`, then the same with `+ 10`: the first arms the settle and skips nothing; the second gives `skipped.g22.settle-relay.cellBounds` at least 1. |
| A19 | `g23.write-economy` | canvas file; mount `table-rows` at n=20; record `new Date(0).toLocaleTimeString(undefined, { hour: '2-digit' })` before installing | the same call after installing returns the recorded string, and a second gives `intlHit` 1. A `FilterCell`'s `setOperators(cell._operators)` gives `operators` 1. `Date.prototype` is restored after the test. |
| A20 | `g24.list-rows` | mount `list-items`; `row` = `tools.findComponent('SelectableListRow')` | `row.setSelected(row.isSelected())` gives `rowClass` 1. `row.setSelected(!row.isSelected())` adds none, and `isSelected()` flips. |
| A21 | `g24.tree-window` | mount `tree-nodes` | a counted `tree.renderWindow()` gives `skipped.g24.tree-window.renderWindow` 1. |
| A22 | `g25.theme-withhold` | mount `shell-shallow` at n=2: one visible and one hidden editor (`isEffectivelyVisible()` false); spy on each editor's `_themeCompartment.reconfigure` | the hidden editor's `onThemeChange()` gives `skipped.g25.theme-withhold.theme` 1, and its spy is not called; the visible editor's `onThemeChange()` calls its spy once. The hidden editor's `onEffectiveVisibilityChange(true)` then calls its spy once; a second `onEffectiveVisibilityChange(true)` does not. |
| A23 | `g26.viewer-resize` | mount `markdown-doc`; `minimap` = `tools.findComponent('MarkdownMinimap')`; `md` = `tools.findComponent('Markdown')`; fake timers | two counted `minimap.placeNextTo(md)` calls give `rectHit` 1. `md.setWidth(md.getWidth() + 20)` gives `skipped.g26.viewer-resize.measure` 1 and leaves a timer pending, which runs once after 100 ms. |
| A24 | `g27.heading-cache` | mount `markdown-doc`; `viewer` = `tools.findComponent('MarkdownViewer')`; `h` = `viewer._content.getContentScrollElement()`; spy on `viewer._tracker`'s `setActiveHeading` | two `viewer._tracker.trackScroll(h)` calls give `rebuild` 1 and `trackHit` 1. Every id passed to the spy equals `findActiveHeading(h, viewer._tracker.getHeadings())` from `@jimka/typescript-ui/component/display`. |
| A25 | `g28.transform-inline` | mount `chart-line`; `c` = the chart | `c.setTransform('translateX(3px)')` gives `ruleWrite` 1 and `getTransform()` `'translateX(3px)'`. After `Body.getInstance().flushLayout()`, the element's inline `style.transform` is `translateX(3px)`. `clearTransform()` empties it. |
| A26 | `chart.repaint-gate` | mount `chart-line` at n=50 | a second seam-counted `chart.doLayout()` gives `skipped.chart.repaint-gate.repaint` 1 and `seam.sink.createElementNS` 0. After `chart.setSeries(<the panel's shifted series>)`, `doLayout()` gives `createElementNS` above 0 and no further skip. |
| A27 | `chart.margin-memo` | as A26 | a second seam-counted `doLayout()` gives `seam.source.measureText` 0 and `memo.chart.margin-memo.plotHit` 1, and `chart._plot` deep-equals the first pass's. After `setSeries`, `measureText` is above 0. |
| A28 | naming | every case above | every work key an ablation bumps starts with `skipped.<name>.`, `memo.<name>.` or `dose.<name>.`, and its last segment has no hyphen. |
| A29 | work counters | mount `shell-shallow`, then `chart-dashboard` | `installWorkCounters(tools)`'s notes include `counting Component.beginSizeHintRecord`, `counting Component.getLaidOutComponents` and `counting LayoutManager.reserveContentFrame`. On `chart-dashboard` they include `counting Grid.measureContent`. |

### The sweep script — unit, node (`tests/sweep.test.ts`)

Each case runs `bash packages/qa/sweeps/w3-0.sh …` with `child_process.execFileSync` or `spawnSync`, with `W3_SESSION` unset unless the case sets it.

| # | Invocation | Expect |
|---|---|---|
| W1 | `--list` | 20 lines `b00 28` … `b19 9` in order, the per-batch counts of *The Matrix*, then `total 394`; exit 0 |
| W2 | `--dry-run` | 394 lines, each `runqa <name> <main\|wt> <params>`; names unique, all starting `w3s1-` |
| W3 | `--dry-run` | every params string contains `work=1&seam=1&geom=1` exactly once, and none contains `count=` or `deepwrites=` |
| W4 | `--dry-run` | every `abl=` value is a key of `ABLATIONS` (imported from `src/harness/ablations.ts`) |
| W5 | `--dry-run` | every `panel=` value is in `getPanelIds()` |
| W6 | `--dry-run` | every `drive=` value parses with `parseDrive`; `toggle`, `theme` and `type` appear only as the last phase; no run has `grip=tab` |
| W7 | `--dry-run` | grouping runs by name up to the arm, each cell's runs have identical params apart from `abl=`, and every cell tag matches `^[a-z0-9]+$`. Outside `b19`, each cell's first and last runs are `plain`, and every other arm name equals its run's `abl=` |
| W8 | `--dry-run b02` | exactly 12 lines, all starting `w3s1-b02-` |
| W9 | `--dry-run nope` | exit 2, nothing on stdout |
| W10 | `W3_SESSION=s2 --dry-run b01` | every name starts `w3s2-b01-` |
| W11 | `b02`, with `W3_RUNQA` a stub that logs its first argument and exits 1 on its third call, and `QA_MAIN_LIB` a temporary directory holding `dist/lib/core.es.js` | exit 1 after exactly three logged names (`…plain-a`, `…split.noop-drag-1`, `…split.recalc-gate-1`) |

Two more rows pin the baseline and the witnesses (part of W2's assertions): the `b00` lines include `panel=shell-deep&drive=drag,wheel:120`, with no `grip=` (S1's `dock-h`); the `b19` lines include 4 `wt` runs.

### The analysers — manual, offline (no window)

| # | Command | Expect |
|---|---|---|
| T1 | `python3 packages/qa/bin/qa-table.py packages/qa/tests/fixtures report --work` | `report.json`'s row with no work line, since it has no `work`, and an `ERROR` row for `report-error.json`; exit 0 |
| T2 | `python3 packages/qa/bin/qa-ab.py packages/qa/tests/fixtures/ab ab-fix-` over the seven fixtures below | exit 0. Plain mean 10.20, bracket 0.40, counter 100.00. Arm `x.y`: Δms −0.60 `win`, counter 80.00 (−20.0%) `win`, geom `=`, engaged yes, verdict `win`. Arm `x.z`: Δms 0.00 `flat`, counter 100.00 (0.0%) `flat`, `geom DIFF(chart)`, engaged yes, verdict `void`. |
| T3 | T2 with `--allow-diff chart` | arm `x.z` becomes geom `=`, verdict `flat` |
| T4 | `python3 packages/qa/bin/qa-ab.py packages/qa/tests/fixtures report-error` | prints `ERROR`, exit 1 |
| T5 | `python3 -m py_compile packages/qa/bin/*.py` | no output |

The fixtures are named `ab-fix-<arm>-<rep>-<epoch>.json`, epochs 1000–1006, in this order:

| Order | Arm | `avgMs` | Work | Geometry |
|---|---|---|---|---|
| 1 | `plain-a` | 10.0 | `{ "a": 100 }` | `{ "chart": [[0,0,100,50],[0,0,100,50]] }` |
| 2 | `x.y-1` | 9.5 | `{ "a": 80, "skipped.x.y.z": 5 }` | as plain |
| 3 | `x.z-1` | 10.1 | `{ "a": 100, "skipped.x.z.w": 3 }` | `chart` `[0,0,100,51]` in both units |
| 4 | `plain-b` | 10.4 | `{ "a": 100 }` | as plain |
| 5 | `x.z-2` | 10.3 | as `x.z-1` | as `x.z-1` |
| 6 | `x.y-2` | 9.7 | as `x.y-1` | as plain |
| 7 | `plain-c` | 10.2 | `{ "a": 100 }` | as plain |

Each fixture is a `schema: 1` report with one `passes` phase of 2 units; the arm fixtures carry `params.abl`. Their other fields are copied from `tests/fixtures/report.json`.

### Manual, in the engine (the orchestrator, with the user's go-ahead)

- The sweep itself, with the readings in *The Matrix*, *Counter-only reads* and *The Witnesses*.
- Every ablated arm in its cells reads `engaged yes` except where the matrix predicts none. Before reading any verdict, check one arm per ablation with `qa-table.py --work`.

---

## Verification

Automated, from the worktree root, after `npm run build:lib` (none opens a window):

1. `npm -w packages/qa run typecheck` — 0 errors.
2. `npm -w packages/qa run test` — all green: the existing suites, A1–A29 and W1–W11.
3. T1–T5.
4. `packages/qa/sweeps/w3-0.sh --list` — `total 394`.
5. `git diff --stat master -- packages/lib packages/docs` — empty.
6. `grep -rn "@jimka/typescript-ui" packages/qa/src/harness` — no match: the harness stays library-free.
7. `grep -n "skipped.split.onDrag\|skipped.split.recalculateSizes" packages/qa/src` — no match: the renamed counters are gone.

`npm run docs:api` is not needed, because no library TSDoc changes. If it is run anyway, the bar is master's 14 existing warnings and no new one, not zero.

Manual: the sweep, run by the orchestrator (*Running the sweep*).

---

## Documentation Impact

`packages/qa/README.md` is the only document that changes:

- **Built-in ablations.**
  - Add one row per new ablation: the name, the candidate, and what it removes, in *The ablations*' words.
  - Rewrite the `split.noop-drag` and `split.recalc-gate` rows.
  - State the counter naming scheme, and that an ablation receives `lib` as well as the tools.
- **Analysers.** Document `qa-ab.py`: usage, the counter-expression table, `--allow-diff`, `--same`, the output and the cell-verdict table. Document `qa-table.py --work`, and add `dose.` to the bookkeeping sentence.
- **A new *Sweeps* section.** `sweeps/w3-0.sh`: what it runs, `--list`, `--dry-run`, `W3_SESSION`, `W3_C40_BEFORE_LIB`, `W3_RUNQA`, and re-running one batch. Open it with the window warning.
- **Panels.**
  - Add the new geometry labels to the *Geometry* column of `shell-deep`, `shell-shallow`, `windows`, `table-rows`, `treetable-rows` and `markdown-doc`.
  - Name the new work counters: `sizeHintMiss`, `getLaidOutComponents`, `reserveContentFrame` and `measureContent` in the harness, plus `onThemeChange@CodeEditor`, `getRecords@MemoryStore` and `heading@<id>`.
- **The Coverage pointer** below the panel table: add that wave 3's candidate-to-cell map is this plan's *The Matrix*, and that G27's counters are now `querySelector` and `getElementRect`.

No library documentation changes. The research record `96-w3-0-bounding-sweep.md` is written by the orchestrator after the run, not by this plan.

---

## Potential Challenges

- **jsdom lays nothing out and animates nothing.** The offline cases prove that each patch installs, skips on its condition and delegates otherwise. Engagement in the engine, and identical geometry, are for the sweep's `engaged` and `geom` columns. That is why A5 claims no skip.
- **An ablation's own bookkeeping costs time**, for example `JSON.stringify` in `g16.panel-settled` or the signature in `split.recalc-gate`. That cost shows as `regress`, which the rule sends to *needs a different surface*, never to *drop it*.
- **Seam and work counters count memo hits**, because they wrap the patched methods. Each such arm's `--counter` subtracts its hit counter, as the matrix gives it.
- **Prototype patches outlive a test.** `tests/patchGuard.ts` restores every patchable object after each test, `Date.prototype` included.
- **`g09.all` may lay the page out differently.** That `DIFF` is the real-engine reading of G09's forced-on ceiling, which W2.0 left owed, not a harness fault. Record which labels differ.
- **The C40 before-arm serves `master`'s QA page against `3e36ca60`'s library.** A panel API missing from that build fails the run, and the sweep stops. `b19` is last so that no other batch depends on it.
- **A store of 1,000 records or more builds its view on a worker.** `n=900` cells stay on the synchronous path on purpose. `n=3000` and `n=10,000` cells wait for the view in `afterMount`.
- **An unknown `abl=` name is a note, not an error** ([`run.ts:303`](packages/qa/src/harness/run.ts#L303)). W4 catches a typo in the script, and `engaged` catches one in the engine.

---

## Critical Files

- [`packages/qa/src/harness/ablations.ts`](packages/qa/src/harness/ablations.ts) — the precedent every new ablation follows (`splitNoopDrag`, `splitRecalcGate`, `exposeCount`).
- [`packages/qa/src/harness/run.ts`](packages/qa/src/harness/run.ts#L240) — the install order and `applyAblations`.
- [`packages/qa/src/harness/counters.ts`](packages/qa/src/harness/counters.ts) — `countMethod`, `installWorkCounters`, `countLayoutWork`, `installSeamCounters`.
- [`packages/qa/src/harness/tree.ts`](packages/qa/src/harness/tree.ts) — `ownerProto`, `rootOwnerProto`, `findComponent`, `findLayoutManager`.
- [`packages/qa/src/builders/work.ts`](packages/qa/src/builders/work.ts) — `countInstance`, the own-property counters that `withOwnMethod` must preserve.
- [`packages/qa/src/builders/shell.ts`](packages/qa/src/builders/shell.ts) — the shells' parts, labels and counters.
- [`packages/qa/tests/mount.test.ts`](packages/qa/tests/mount.test.ts), [`tests/formCallTarget.test.ts`](packages/qa/tests/formCallTarget.test.ts), [`tests/panels.test.ts`](packages/qa/tests/panels.test.ts) — the jsdom mount, the 2D-context stub, and P3's seam-counted chart pass, which the ablation tests copy.
- [`packages/qa/bin/qa-table.py`](packages/qa/bin/qa-table.py), [`packages/qa/runqa.sh`](packages/qa/runqa.sh), [`packages/qa/README.md`](packages/qa/README.md) (*Measurement rules*).
- [`plans/research/render-review-2026-09-15/97-wave2-measurement.md`](plans/research/render-review-2026-09-15/97-wave2-measurement.md) — the precedent's method and its corrections.
- The library methods each ablation patches, at the lines *The ablations* cites.

---

## Non-Goals

- **Running the sweep.** It opens full-screen windows; the orchestrator runs it with the user's go-ahead.
- **Wave 3's plans.** This plan builds and specifies the measurement only.
- **Any library change.** A candidate that needs a prototype library arm gets *needs a different surface* from the rule, and its own plan builds the arm.
- **New panels or drivers** for the unreached sub-items (a thumb drag, a calendar opener, several moves per frame). Each is named in *Status Pass* with the reason.
- **The Tauri host.**
- **Fixing the `IconText`/`IconLabel` glyph leak**, which is recorded in *Found while planning* for the correctness register.
- **Editing the implemented plans' Coverage tables.** Implemented plans are records; the README pointer and this plan supersede them.
- **Updating the README's *Validated* figures.** That happens from the sweep's baseline, after the run.

---

## Addendum: Status Pass Evidence

The facts each status and each reach rests on, beyond the table:

- **G05.** `Border` calls `resolveBounds` only for a collapsible or collapsing region (`layout/Border.ts:552`, `:1392`, `:1576`). The `BOTH` placements in the panels are `Split` (`layout/Split.ts:2004`), `Tab` (`layout/Tab.ts:2239`), `Fit` (`layout/Fit.ts:245`), the box managers in the menu bar, toolbar, status bar and buttons, and `Grid` (`layout/Grid.ts:793`). `passes` hides the shipped `MenuBar`/`ToolBar` skips' boxes, so the shells are read under `resize`.
- **G09.** In-process forced-on sweeps skipped 68–78% of work at identical geometry. What shipped saves 0% on the dock and 4–5% on the shell (`unchanged-commit-skip-staged`). The unchanged rectangles on `drag` with `grip=dock-h` are the four page headers; on `resize`, the weight-0 sidebar. `TabBar` is placed by `placeStrip`, outside the gate.
- **G12 F06.3.** `onDrag`'s third argument is the pointer's absolute position; the drag amount is a local. So the old ablation's `args.find(number)` read the position, and skipped only a repeated position, which no driver produces. `park` does park: the sidebar holds 8,41,160,1999 in all 150 units while `sidebar.doLayout` and `main.doLayout` run 0.99 times a unit (README M5).
- **G12 F06.4.** `recalculateSizes()` has taken no arguments since `fca151df`, so the old key was always `"[]"`. The W2.0 `DIFF` says nothing about a correct gate.
- **G14.** `Accordion.doLayout` still passes `reflowAll = true` (`:1681`), and the closed branch still asks `getPreferredSize` (`:1675`). The per-pass memo does not help, because this is the pass's first request.
- **G16.** Only `form-*`, `list-items`, `markdown-*`, `menus` and the `windows` dialog mount an `autoScroll` `Panel`. `87cf3074` made the unchanged-commit skip opt-in, so a `Panel` is always laid out.
- **G18.** `measureText` is still a DOM probe: a fixed hidden span and a reference span, two `getBoundingClientRect`s, then removal (`core/DOM.ts:2241-2293`). The canvas context serves only `measureFontMetrics`.
- **G19.** The shells' `hover` now reads about 0: at the default step the 500 ms delay never elapses, so no tooltip element exists and each owner's hide returns at once. The chart's blank-space hides are the clean reach.
- **G20.** The walk's handles resolve only through `core/DOM.ts`'s module-private registry. The registrant list has drifted: the chart registers `mousemove`, not `mouseover`; the covering tooltip adds four subtree registrations per decorator in error; and `Body` registers none.
- **G25.** The two memoised builds are byte-identical in rule text. A dark/light flip still swaps the `darkTheme` facet, so each mounted view rewrites its `<style>` once per flip. Inactive tab pages are `display:none` but keep their `_view`, so they still reconfigure.
- **G27.** `[id="…"]` is an attribute selector, and likely misses the engine's `#id` fast path (inference, not measured).
- **G28.** `setTransform` writes the `#id` rule, while `setTranslate` writes inline. The payoff of moving it is paint-side, which only frame time shows.
- **F26.1.** `DiagramView.anchorCentreAcrossResize` returns early on an unchanged viewport (`component/diagram/DiagramView.ts:1760`, `:1778`): the precedent the chart lacks.
- **`resizeMode`.** `core/PointerDrag.ts` only suppresses pointer events and pins the cursor. The per-frame relayout lives in three separate buffers, and the shared helper `98-wave2-rejustification.md` Part 3 expected G12 to extract does not exist yet.

---

## Notes

[^w20-lessons]: W2.0 taught four things this plan builds in. First, geometry equality is the soundness gate: `size.memo`, `skip.unchanged` and `split.recalc-gate` all laid the deep scene out differently, and their timings were void. Second, an ablation bounds only the code it reaches, so its own counter must confirm it engaged. Third, an ablation can be right about the number and wrong about the attribution, as `accordion.seed` was: its win came mostly from F08.4, not the F08.2 it was written for. Fourth, work avoided is worth scoring beside milliseconds, because an engine-bound frame hides JS-side savings that grow with the document. The runtime-ablation approach itself is `98-wave2-rejustification.md`'s C4: an ablation applies a proposed change live, with no library edit and no plan.

[^no-wt]: The third kind was considered for four candidates and not needed. G08's F09.1 reorder and `DialogBackdrop` change are library edits with no runtime seam, and F09.1 is not reached by any driver, so they stay unbounded sub-items of a group that has an ablation. G26's lexer has no runtime seam either, but its value is decided by a scaling ratio that a build could not improve on. G20's walk cannot be removed at runtime, and a dose arm bounds its cost without the full fix, which must narrow every registrant at once (ordering constraint 3). G21's single-record narrowing is decided by its counters. A `wt` arm would mean writing a library change inside a measurement plan, which is the fix's own plan's job, and would need a second build per cell. *Needs a different surface* is how the rule asks for one when an ablation fails.

[^group-arm]: Wave 3 plans groups, not findings, so the verdict must be per group. One ablation per sub-item would multiply the arms, and so the runs, about threefold: G21 alone has six candidate patches. Applying the sound sub-items together gives the group's upper bound, which is what "plan it" needs, and the per-sub-item counters still show which parts engaged and which carried the work. W2.0 bounded single findings because wave 2 was scoped per finding.

[^lib-plumb]: G08, G16, G18, G20, G26 and G27 patch `DOM.source` or `DOM.sink`, which `HarnessTools` does not expose. G19 and G08 patch statics on `Tooltip` and `AbstractWindow`, which live outside the `Body` walk (windows and tooltips mount outside `Body`, as `mount.test.ts`'s `afterEach` records). Passing `lib` as a second parameter is additive: every existing ablation ignores it. Putting `lib` on `HarnessTools` instead would widen the object drivers and panels receive for a need only ablations have. `Tooltip` and `AbstractWindow` are optional, so the tests that pass `{ Body, DOM }` to `createTools` still type-check.

[^naming]: `qa-ab.py` must tell an arm's own counters from the page's, and from another arm's, to judge `engaged`. Prefixing with the ablation's own `abl=` name makes that a string test with no table to maintain. Keeping `<what>` free of hyphens keeps it readable in the analyser's space-separated counter expressions. The existing names `skipped.split.onDrag` and `skipped.split.recalculateSizes` would read as another arm's; no recorded result depends on them, since `split.noop-drag` never engaged and `split.recalc-gate`'s W2.0 run predates the QA app.

[^split-rewrite]: `split.noop-drag` looked for a numeric argument as the drag amount, but `onDrag(container, gutter, position)`'s only number is the pointer's absolute position; the amount is a local variable (`layout/Split.ts:1366`). It skipped on a zero or repeated position, which neither `drag` nor `park` ever produces, so it never engaged. The rewrite skips the two panes' layout when their rectangles did not move, which is F06.3's proposed fix: a port of `Accordion.layoutSections`' `contentHeight !== oldHeight` gate (ordering constraint 4). It keeps `_sizes.set`, because a frame at offset 0 writes the rendered size back into `_sizes`. `split.recalc-gate` keyed on the numeric and string arguments of a method that takes none, so its key was always `"[]"`: it ran `recalculateSizes` once per `Split` and never again, ignoring available space, panes and bounds. The rewrite's signature covers every input the method reads besides its arguments. The stability condition is there because the refill (`:2482-2547`) rescales flexible panes without re-clamping them: a pane pushed below its minimum converges over several passes, and a gate on inputs alone would freeze it mid-way.

[^soundness]: Geometry samples container rectangles only (the second correction in `97-wave2-measurement.md`). It cannot see a chart mark, a heading choice, or a cell inside a table. For those, a counter that must not move is the gate: marks rebuilt on a data change, headings chosen per scroll. An arm that changes a rectangle by design — the pane-collapse animation, cells lagging during a resize burst — declares the label and phase, so its other labels still gate it. `--same`'s 1% tolerance only absorbs rounding to hundredths per unit.

[^flags]: Instruments cost time, so every arm of a cell must carry the same ones (*Measurement rules*). One set everywhere also makes the baseline's counts directly comparable with every cell's plain arms. `work=1` and `seam=1` are what every candidate is scored on. `geom=1` is the soundness gate. `count=1` wraps hundreds of accessors, and `98-wave2-rejustification.md`'s C1 showed its write counters miss the library's camelCase writes anyway; the seam counters see every write through the seam. The C21 witness was specified without `work` and `seam` ([`doc-and-qa-record-drift.md:507`](plans/implemented/doc-and-qa-record-drift.md#L507)); adding them changes no count it reads.

[^mirrored]: With the arms in reverse order the second time, every arm's two runs sit symmetrically about the cell's centre, as do the three plain runs. A drift that is linear over the cell therefore cancels exactly in every arm's Δms. Two repetitions per arm and three plain runs also give the bracket three samples instead of W2.0's two: W2.0's end-of-wave A/B saw a 3.79 ms spread between two plain runs of one scene. A check cell reads only deterministic counts, where one run per arm is enough.

[^batches]: Absolute frame times drift 8–14% between sessions (`00-baseline.md`), so a comparison is valid only inside one bracket. Making the batch the bracket means a failure, a re-run or a machine change costs one batch, not the sweep. Sessions exist only to keep each sitting under 40 minutes.

[^analyser]: About 60 scored cells each need the same arithmetic — mean, spread, Δ against the spread, a counter's change, three gates and a verdict — and W2.0 did 11 runs of it by hand. Encoding the rule once removes transcription as a source of error, and lets the orchestrator re-read a cell under a different counter. It is a separate script because `qa-table.py`'s one-row-per-phase listing is documented as it is. It is self-contained, as `qa-verdict.py` and `qa-forced.py` are, and orders files by their epoch suffix rather than modification time, so its fixtures read the same after a checkout.

[^rule]: The thresholds carry W2.0's lessons. **Milliseconds must leave the bracket**: `clamp.once`'s −1.00 against a 1.04 spread was drift. **Work needs a relative and an absolute floor**: counts are deterministic, so any drop is real, but a plan must remove enough to pay for its own code. W2.0's smallest change taken seriously was F06.4's −14.8%, and its drop was G10's 0.0%; 10% sits between them. The 1.0-per-unit floor keeps a large percentage of a tiny count from passing. **A regression is not a drop**: an ablation's own bookkeeping, a memo lookup or a signature, costs time the real fix need not pay, so a slower arm says the instrument cost more than it saved, not that the idea is worthless. **`void` outranks everything**: a page laid out differently was not doing the same work. **`unreached` outranks the rest**: an arm that never engaged measured plain drift twice.

[^witness]: Each witness run opens the same window, so running them inside the sweep costs nine runs and no extra sitting. `3e36ca60` is the commit `checkbox-action-activation` was merged onto: its merge `96aab964` has it as first parent and merge base. Serving `master`'s QA page against that library is exactly the plan's own recipe ("`wt` is the before arm, `main` the after arm").

[^host]: Counts must match across hosts at the same viewport, and did for every panel on 2026-09-20 (21 of 23 reports byte-identical). Frame times are compared only within one host. So a second host would double the runs, adding only a second host's frame times, while no candidate here is host-specific: none touches Tauri's init scripts or window embedding. The paint-side candidates (G25's residue, G28) are the same WebKitGTK in both hosts.

[^g17-counter]: A runtime rename is possible but needs a shim: pre-mount the sprite symbols the swap would have mounted, rewrite the `<use>` element's `href` outside the seam, and patch three unrelated renderers. Its only product beyond the counts would be the millisecond cost of the rule churn. G17's plan has to prove that cost in a WebKitGTK recording anyway, because rule restyle is exactly what counters cannot price (`99-synthesis.md`, *Groups whose payoff is not yet verified in the real engine*).

[^resize-counter]: The harness times the gap between animation frames, which cannot fall below the display interval. So an outline arm would re-measure the idle floor plus one composited move, the value the report's `idle` already gives. The catch-up relayout on release is under 1% of a 150-unit phase. An emulated outline mode (a store-only `scheduleDrag`) fails the geometry gate by design, since every moved label holds its start rectangle through the drag.

[^labels]: `header0` and `status` put a G09 candidate's rectangle under the geometry gate. Without them no label covers `Header`, `StatusBar` or `WindowHeader`, and `g09.chrome` could not fail the gate. `focused` and `cell` do the same for G21's focus sweep and G22's lagging cells, `minimap` for G26's hug position, and `heading@<id>` for G27's choice of heading. `onThemeChange@CodeEditor` and `getRecords@MemoryStore` count the work `g25` and `g21` remove inside methods the harness would otherwise count only by entry.

[^estimate]: The start-up estimate is from the QA app's own results: three consecutive `menus` runs on 2026-09-21 (`sw-plain-1/2/3`) finished 13.4 s apart, of which 5.4 s were the 150 measured units and 1.5 s the idle frames. Per-unit costs are the README's *Validated* figures where one exists: for example 84.6 ms per sidebar drag unit on `shell-deep` and 21.4 ms per `table-rows` key. Where none exists, the estimate assumes about 90 ms for the `dock-h` drag and the shells' `resize`, and about 30 ms for tree and editor wheels. Heavier mounts (four editors, a 10,000-row store) add a few seconds. The total is an estimate to ±25%. Only `b00`'s `table-wide` run exceeds 100 s.

---

## Implementation Notes

**A finding that changes a reading: `g25.theme-withhold` will likely read `unreached` in `b07`.** A `CodeEditor` mounts its CodeMirror view on its first layout, and a dock tab that has never been shown is never laid out, so its editor has no view and its `onThemeChange` already returns at once. In `shell-deep` and `shell-shallow` as built, every inactive tab is one never shown — 12 of 16 editors at `n=4` in `shell-deep` — so the plan's premise for G25 ("inactive tab pages … keep their `_view`, so they still reconfigure") holds only for a tab once shown and then left, as in Loom. The ablation therefore withholds, and counts, only a hidden editor that has a view: counting a skip of a call that was already a no-op would have read as engaged with a work `win` over work that never existed — a false *plan it*. Expect `engaged no` in `sd4m` and `ss4m`, which the rule reads as *needs a different surface*: a shell that shows each tab once before measuring. A22 builds that state itself — it shows the second tab and then the first — and also pins that a never-shown editor is not counted.

**A second premise that fails at `master`: `g19.tooltip-idle`'s `hide` half removes nothing, so it is not built.** The plan's skip condition — not dismissing, not watching, and no tooltip instance or an invisible one — is exactly the state in which the tooltip has no element: `show` renders it, and a finished fade removes it. The original `hide` then returns at its `if (!el)` guard before any fade, so the plan's "a skipped `hide()` would have faded an invisible element" does not hold; the only work a skip saved was creating the singleton once. Built as planned, every idle chart-hover `hide` would have counted as engagement. `g19.tooltip-idle` therefore bounds only the attach half, and A15 pins that `hide` is left as it is and counts nothing. The chart cells never attach — the charts call `Tooltip.show` and `Tooltip.hide` directly — so expect `clh` and `cdh` in `b10` to read `unreached` for this arm; the form cells `fny` and `ffy` in `b12`, whose decorators re-attach on every keystroke, are its reach. The hide cost that does exist, the fade restarted on every blank chart move while one is running, is the sub-item the plan lists as unbounded.

**The plan's `engaged` rule counted misses as engagement; a counter ending in `Miss` no longer counts.** The plan files every miss, fall-back and rebuild under the arm's own `memo.` prefix (`viewportMiss`, `themeVarMiss`, `callMiss`, `fallback`, `rebuild`), and its `engaged` rule sums every own counter, so an arm whose memo only ever missed — `g08.env-reads` on `mt`'s one viewport read per open, say, or `g27.heading-cache` if lazily mounted fences change the content height every tick — would read `engaged yes → flat` and its candidate *drop it*, where the rule means `unreached` and *needs a different surface*. So a `<what>` ending in `Miss` now records work the arm did not remove, and `qa-ab.py`'s `engaged` leaves such counters out. Two counters were renamed to follow it: `memo.g18.canvas-width.fallback` is `…fallbackMiss` and `memo.g27.heading-cache.rebuild` is `…rebuildMiss` (A14 and A24 read the new names). Neither is in any `--counter` expression of *The Matrix*. `tests/qaAb.test.ts`, a file the plan did not list, pins the rule — an arm with only a `Miss` counter reads `engaged no → unreached` — and runs T2–T4 offline, with the analyser's other branches the matrix relies on: `--same`, `--allow-diff LABEL@PHASE`, `unstable`, `MISMATCH`, the dose reading and exit 2. The test suite therefore needs `python3`, as T1–T5 already did.

Smaller departures, each where the plan left the detail open or its literal wording would have mis-measured:

- **`g09.all` and `g09.chrome` count only their own skips.** `skipped.<ablation>.commit` is bumped only when the receiver's `canSkipUnchangedLayout` is the ablation's, so the shipped opt-ins (`MenuBar`, `ToolBar`, `Cell`) cannot make an arm read as engaged. A8 pins it: asked inside one pass, the menu bar and the status bar both answer `true`, and one skip is counted.
- **`g12.collapse-static`'s guards come off even when no collapse runs.** A guard removes itself on its first call once `_collapsing` is `false`, as planned; `Split` sets `_collapsing` before any pane is laid out, so no layout before a collapse reaches a guard. In addition, the patched `setPaneCollapsed` removes the guards at once when no collapse is running after it returns — an unchanged state, no serving gutter, or reduced motion, which ends the collapse inside the call — so a guard installed for a collapse that never started does not linger. A5 pins both, and the gate itself: with the collapse in flight, a second layout at the same rectangle is skipped.
- **`g16.panel-settled` passes a panel whose re-measure would do nothing straight through, uncounted.** `Panel.doLayout` calls `remeasureScrollMetrics` on every pass, and it returns at once for a panel that does not scroll — the default, and six of `shell-shallow`'s seven panels — or is not effectively visible or has no element. Gating those would have counted a skip on almost every panel of every pass, and paid a `getPreferredSize` and a `JSON.stringify` for each. A11 pins that a non-scrolling panel's re-measure is not counted.
- **The same rule for `g16.scroll-reads`' max-scroll memo and `g26.viewer-resize`'s deferred measure.** A component with no scroll element gets its maximum scroll offset, 0, without any read, and a `Markdown` with no element, or not effectively visible, returns from `measureContentHeight` without measuring; both pass through uncounted rather than count a hit or a deferral that saves nothing. A12 and A23 pin both.
- **`g19.tooltip-idle` records an attachment after the original runs.** `_attachWith` begins by detaching, which the `detach` wrapper turns into forgetting the entry; recorded before, every entry would be forgotten at once and no re-attach would ever be skipped.
- **`g23.write-economy` caches a date format only after the engine accepts the call**, and a miss returns the engine's own string. The cached format is built with ECMA-402's `ToDateTimeOptions` defaults for each method, since `Intl.DateTimeFormat` alone formats, say, an hour-only `toLocaleDateString` without the date the engine adds.
- **Reads an ablation makes on the page's behalf go through the live `lib.DOM.source`**, so the seam counters still count them: `g27.heading-cache`'s offset rebuild and `g18.canvas-width`'s theme-variable lookups. Patches still go on the real seam objects, as planned.
- **`perTask(compute, onHit?)`** takes an optional hit callback, for the memo counters.
- **`tests/patchGuard.ts`'s `patchablesOf`** also snapshots `lib.DOM` itself, so a case that installs the seam counters is undone too, and takes an `extras` list for an object outside the component walk whose prototype an ablation patches — `g27`'s heading tracker.
- **A11 waits three frames before counting.** The mount's first layout arms the panel's own resize-settle relay, which withholds the re-measure `g16.panel-settled` gates until two layout flushes have passed; offline that takes real frames.
- **`qa-ab.py`** reads `engaged` per phase, as it prints one block per phase, and gives a dose arm one extra line applying the plan's dose reading: the plain counter's share of the phase's seam source calls against the work bar, and `Δms` against the bracket.
- **Plan references point at `plans/implemented/w3-0-bounding-sweep.md`**, where the plan ends up, in the sweep script's header and the other new files.
- **The two new scripts are committed as executable** with `git update-index --chmod=+x`: this checkout has `core.fileMode` off.
