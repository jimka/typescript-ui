# QA surfaces for three stalled wave-3 candidates — Implementation Plan

## Overview

Three wave-3 candidates read **needs a different surface** in the W3.0 bounding
sweep because no panel in `packages/qa` exercises what they change:
G16 `panel-settled-pass-and-scroll-reads`, G25 `codemirror-theme-singleton` and
G27 `markdown-heading-scroll-cache`
([`plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md)).
This plan builds those surfaces: two new panels, `scroll-panes` and
`editor-tabs`, and an extension of the existing `markdown-doc`. It also repairs
one ablation, `g16.panel-settled`, whose skip test pays for a size measurement
it would then multiply across a board of panes.

Everything lands in `packages/qa`: `src/panels/`, one gate in
`src/harness/ablations.ts` ([`packages/qa/src/harness/ablations.ts:1195`](packages/qa/src/harness/ablations.ts#L1195)),
the package's own vitest suite, and `README.md`. No library file changes.

The plan runs no measurement. Every run opens a full-screen window, so the
three cells are written up in `## Verification` as steps for the user to run.

---

## Architecture Decisions

### Each surface proves its own premise before its arm is read

Every panel here reports, in its own counters and `describe()` fields, whether
the situation the candidate needs actually occurred — a settled pass that
re-measured something, a wheel that really scrolled, a hidden editor that still
holds a view, a scroll tick that resolved a heading. An `unreached` verdict is
then a statement about the candidate; without those witnesses it is only a
statement about the panel.[^witness]

### G16 gets a board of scrolling panes, driven by both a pass and a wheel

`scroll-panes` is a `Grid` of `n` scrolling `Panel`s (default 24), each holding
more `Text` rows than fit. One panel id carries both halves of G16: `passes` on
the board re-measures every pane's scroll metrics, and `wheel` scrolls pane 0.
Both halves run against the same scrollable `Panel`s in one cell.[^board]

### The settled-pass gate stops paying for a size measurement

`g16.panel-settled`'s skip signature calls `getPreferredSize()`, which computes
a size hint over the panel's subtree. The signature is rewritten to read only
values the panel has already cached: its width, its height, its child count and
`_lastContentExtent`, the content extent
[`Panel.scheduleGutterSettleOnShrink`](packages/lib/src/typescript/lib/core/Panel.ts#L920)
records on every pass.[^gate-cost]

### G25 gets a tabbed editor group beside a reference editor

`editor-tabs` is a `Split` of one always-visible `CodeEditor` — the reference —
beside a `TabPanel` of `n` editors (default 8). Its `afterMount` shows every tab
once, so every editor mounts a CodeMirror view, then returns to tab 0. A hidden
tab's content is undisplayed, not disposed
([`Tab.doLayout`](packages/lib/src/typescript/lib/layout/Tab.ts#L2112)), so the
hidden editors keep their views — the state
`g25.theme-withhold` needs and never found in the shells.[^tabs]

### The tab is shown inside the theme phase

The `theme` driver restores the page's starting theme when its phase ends, so a
withheld editor is consistent again by the time any later phase could look at
it. `editor-tabs` therefore supplies its own `theme` target whose `cycle(index)`
also shows the next tab and checks the one shown before it — the only point at
which a hidden editor is observably stale.[^inside-theme]

### The re-theme is witnessed by the editor's class list, not its colour

`codeEditorTheme(dark)`
([`packages/lib/src/typescript/lib/component/editor/theme.ts:83`](packages/lib/src/typescript/lib/component/editor/theme.ts#L83))
writes every colour as a `var(--ts-ui-…)` reference and uses one fixed syntax
palette for both modes, so a theme switch recolours even an editor that was
never reconfigured. What the reconfigure does change is the `.cm-editor`
element's class list, which carries CodeMirror's light/dark style-module
classes. The check compares the newly shown editor's class list with the
reference editor's.[^classlist]

### The geometry gate sits on the trailing settled phase

G22's record establishes that comparing every unit mid-burst is the wrong gate
for a candidate that defers work inside a burst, and that the gate belongs on
the settled state
([`00-post-campaign-agenda.md`, *G22 unblocked*](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md#L376)).
G16's skipped shadow resize and G25's withheld reconfigure are both of that
shape, so both cells end in an `idle:4` phase, and a mid-burst `DIFF` on a
deferred label is re-read with `--allow-diff <label>@0` rather than voiding the
cell.[^settled-gate]

### G27 extends `markdown-doc` with a scroll ladder and a live oracle

`markdown-doc` gains a `call` target that steps the viewer's `scrollTop` through
a fixed ladder of absolute positions, and its heading counter gains an oracle:
at the instant the tracker reports a heading, the panel re-derives
`findActiveHeading`'s rule from live rectangles and counts agreement or
disagreement.[^ladder]

### The heading gate is an in-run counter, not a cross-arm tally

W3.0 gated G27 with `--same 'work.heading@*'`, which compares each arm's tally
of resolved headings against the first plain run's. Those tallies depend on
where each scroll tick landed, and a wheel's landing positions are a function of
elapsed time
([`SmoothScroller.step`](packages/lib/src/typescript/lib/core/SmoothScroller.ts#L198)),
so the comparison cannot separate a changed answer from a differently-paced
scroll. The gate becomes `work.heading.disagree`, which the panel raises in the
run that made the wrong choice.[^in-run]

### No geometry label tracks scrolled content

Every label these panels declare is a container whose box stays put when its
content scrolls. A label on scrolled content would move with a scroll position
no two runs share, and every plain arm would then disagree with every other —
`qa-ab.py` would report `unstable` and the cell would say nothing.[^no-scrolled-labels]

### No new harness option and no new sweep script

The three cells need nothing from the harness that it does not already have:
phases, `--allow-diff LABEL@PHASE`, `--same`, and a trailing `idle` phase cover
the settled gate. In particular this plan takes no dependency on the sibling
`qa-panel-determinism` plan, which owns making `text-metrics`, the `table-rows`
wheel and the `treetable-rows` key repeatable.[^no-option]

---

## Public API

### `packages/qa/src/panels/scroll-panes.ts` (new)

```typescript
export const description: string;
export const defaultScale = 24;              // scrolling panes
export const defaultDrive = 'passes,wheel,idle:4';
export function build(n: number): PanelBuild;
```

| Part | Value |
|---|---|
| `root` | `Panel({ layoutManager: Grid({ rows: Math.ceil(n / GRID_COLUMNS), columns: GRID_COLUMNS }), components: panes })` |
| pane `k` | `Panel({ autoScroll: 'y', layoutManager: VBox({ stretching: true }), components: ROWS_PER_PANE × Text })` |
| `targets` | `passes: root`, `resize: root` |
| `afterMount` | `wheel: <pane 0's element>` |
| `geometry` | `board` (root), `pane0`, `pane1`, `row1` (pane 1's first `Text`), `paneLast` |
| `describe()` | `{ panes: n, rowsPerPane, scrollablePanes, maxScrollTop0 }` |
| `installWork` | `pane.remeasure@Panel`, `pane.scrollTick` |

### `packages/qa/src/panels/editor-tabs.ts` (new)

```typescript
export const description: string;
export const defaultScale = 8;               // tabs, one CodeEditor each
export const defaultDrive = 'theme:14,idle:4';
export function build(n: number): PanelBuild;
```

| Part | Value |
|---|---|
| `root` | `Panel({ layoutManager: Split({ orientation: 'horizontal' }), components: [reference, tabbed] })` |
| `reference` | `CodeEditor(codeDocument(EDITOR_LINES), { language: 'javascript' })`, always visible |
| `tabbed` | `TabPanel({ tabs: n × { label: 'file<k>.ts', component: CodeEditor(...) } })` |
| `targets` | `passes: root`, `resize: root` |
| `afterMount` | `theme: <the panel's own theme target>` (see *The theme phase's schedule*) |
| `geometry` | `tabbed` (the `TabPanel`), `reference`, `editor0`, `editorLast` |
| `describe()` | `{ tabs: n, lines: EDITOR_LINES, editorViews }` |
| `installWork` | `onThemeChange@CodeEditor`, then `theme.hidden` / `theme.shown` |

### `packages/qa/src/panels/markdown-doc.ts` (modified)

Unchanged exports. Added:

| Part | Value |
|---|---|
| `afterMount` | now `async`; adds `call: <the scroll ladder>` to its existing `drag` and `wheel` |
| `describe()` | adds `maxScrollTop` |
| `installWork` | `heading@<id>` as today, plus `heading.agree` and `heading.disagree` |

---

## Internal Structure

### The theme phase's schedule (`editor-tabs`)

`cycle(index)` does up to three things, in this order. `base` is
`themeTarget(THEME_CYCLE)` from
[`packages/qa/src/pageTargets.ts:21`](packages/qa/src/pageTargets.ts#L21);
`THEME_CYCLE` is `[DarkTheme, ModernTheme]`, and `ModernTheme` is the theme the
page starts on.

| `index` | 1. check | 2. apply | 3. show |
|---|---|---|---|
| even, `index / 2 + 1 ≤ n - 1` | — | `base.cycle(index)` → `DarkTheme` | tab `index / 2 + 1` |
| odd, `(index - 1) / 2 + 1 ≤ n - 1` | tab `(index - 1) / 2 + 1` | `base.cycle(index)` → `ModernTheme` | — |
| any later unit | — | `base.cycle(index)` | — |

At `n = 8` and `theme:14` that is one lap: shows at units 0, 2 … 12 (tabs 1–7),
checks at units 1, 3 … 13. `restore()` restores the theme and selects tab 0.

Each tab is shown exactly once, so the theme it carries when shown is always the
mount theme (`ModernTheme`), and every show lands on a `DarkTheme` unit: an
editor that was never caught up is always distinguishable from one that
was.[^one-lap]

A check compares the class list of the shown tab's `.cm-editor` element with the
reference editor's, both with `cm-focused` removed:

| Case | Counter |
|---|---|
| the two class lists are equal | `theme.match` |
| they differ | `theme.mismatch` |

One check raises exactly one of those two, and also raises `theme.indistinct`
when the reference editor's own class list still equals the one recorded at
mount. `theme.indistinct` says the theme switch left no trace in the class list
at all, so that unit's check could not have failed whatever the arm did.

### The scroll ladder (`markdown-doc`)

`afterMount` measures the scrollable span once, with no DOM lookup:
`setScrollTop` writes the native offset and reads the browser-clamped result
back ([`Component.setScrollTop`](packages/lib/src/typescript/lib/core/Component.ts#L4967)).

```typescript
viewer.setScrollTop(LADDER_PROBE_PX);   // 10_000_000: past any document's end
const span = viewer.getScrollTop();     // the clamped maximum
viewer.setScrollTop(0);
```

The `call` target then walks a triangle of absolute positions, so a phase ends
where it started and every unit's position is the same in every run:

```typescript
const p = index % LADDER_PERIOD;                       // LADDER_PERIOD = 24
const f = p <= HALF ? p / HALF : (LADDER_PERIOD - p) / HALF;   // HALF = 12
viewer.setScrollTop(Math.round(f * span));
```

| `index` | 0 | 6 | 12 | 18 | 24 |
|---|---|---|---|---|---|
| `scrollTop` | 0 | `span / 2` | `span` | `span / 2` | 0 |

### The heading oracle (`markdown-doc`)

`installWork` already replaces the tracker's `setActiveHeading` to tally
`heading@<id>`
([`packages/qa/src/panels/markdown-doc.ts:77`](packages/qa/src/panels/markdown-doc.ts#L77)).
It now also checks the reported id before delegating. The check reads
`getBoundingClientRect()` directly, not through the library's DOM seam, so it
adds nothing to the seam counters the cell is scored on.

The pane is the element the viewer actually scrolls: `afterMount` adds a capture
`scroll` listener on the viewer's element and keeps `event.target`, which is
that element by definition.

Let `tol` be 1 px (the library's `ACTIVE_HEADING_TOP_TOLERANCE_PX`), `paneTop`
the pane's rectangle top, and *above(h)* mean
`rect(h).top <= paneTop + tol`. *Present* headings are those whose element
exists inside the pane, in document order. `atMax` is
`scrollHeight > clientHeight && scrollTop >= scrollHeight - clientHeight - tol`.

Because tops increase down the document, *above* holds for a prefix of the
present headings, so checking the reported heading and its neighbour decides the
whole rule:

| Reported | Required for `heading.agree` |
|---|---|
| `null` | no present heading is *above*, and — when `atMax` — there is no present heading at all |
| `h_k`, not `atMax` | `h_k` is *above*, and the next present heading does not exist or is not *above* |
| `h_k`, `atMax`, `h_k` is not *above* | the previous present heading exists and is *above* |
| `h_k`, `atMax`, `h_k` is *above* | `h_k` is the last present heading |

Anything else raises `heading.disagree`. The plain arm agrees by construction —
it is the same rule over the same rectangles, read in the same task — so any
`heading.disagree` at all is a candidate that changed which heading is active.

---

## Ordered Implementation Steps

1. **`packages/qa/src/harness/ablations.ts` — rewrite `g16.panel-settled`'s
   signature.** In `g16PanelSettled`
   ([`:1178`](packages/qa/src/harness/ablations.ts#L1178)) replace the four-term
   signature at [`:1195`](packages/qa/src/harness/ablations.ts#L1195) with five
   cached reads:

   ```typescript
   const extent = this._lastContentExtent as { width: number; height: number };

   const signature = [
       call(this, 'getWidth'),
       call(this, 'getHeight'),
       call<unknown[]>(this, 'getComponents').length,
       extent.width,
       extent.height,
   ];
   ```

   Nothing else in the function changes. Update its doc comment: the gate reads
   only values the panel has already cached, and calls no size hint.

2. **`packages/qa/tests/ablations.test.ts` — pin the cheap gate.** In the
   existing `A11 g16.panel-settled` describe, add a case that spies on the
   panel's `getPreferredSize` (as `A10` spies on `preferred`) and asserts it is
   not called across two settled passes, while
   `skipped.g16.panel-settled.remeasure` still rises. Run
   `npm -w packages/qa run test` — A11's two existing cases must still pass.

3. **`packages/qa/src/panels/scroll-panes.ts` — add the panel.** Follow
   `chart-dashboard`'s shape
   ([`packages/qa/src/panels/chart-dashboard.ts:63`](packages/qa/src/panels/chart-dashboard.ts#L63))
   for the `Grid`, and `form.ts`'s scroller
   ([`packages/qa/src/builders/form.ts:654`](packages/qa/src/builders/form.ts#L654))
   for the scrolling `Panel`. Constants: `GRID_COLUMNS = 6`,
   `ROWS_PER_PANE = 40`. Row text comes from `outlineLabels(ROWS_PER_PANE)` in
   `src/builders/data.js`. `description` states what it builds, that it exists
   for G16, and that no outside behaviour is reproduced (as `code-document`'s
   does).

4. **`scroll-panes` — the witnesses.** `describe()` returns
   `scrollablePanes` (panes whose `getMaxScrollTop() > 0`) and `maxScrollTop0`
   (pane 0's). `installWork` returns two notes:
   `tools.countMethod(panes[0], 'remeasureScrollMetrics', 'pane.remeasure')`,
   and a capture `scroll` listener on pane 0's element that calls
   `tools.bumpWork('pane.scrollTick')`. The listener is added with
   `capture: true`, because a `scroll` event does not bubble and, under overlay
   scrollbars, fires on an inner element.

5. **`packages/qa/tests/mount.test.ts` — cover `scroll-panes`.** Add a `P16`
   describe: at `n = 3` the panel builds 3 panes of `ROWS_PER_PANE` rows,
   `describe().panes` is 3, and the `wheel` target is a connected element. `P1`
   and `P7` pick the panel up on their own.

6. **`packages/qa/src/panels/editor-tabs.ts` — add the panel.** Root, reference
   editor and `TabPanel` per `## Public API`; `EDITOR_LINES = 300`, as
   `builders/shell.ts` uses. `build` returns `passes` and `resize` targets only.

7. **`editor-tabs` — `afterMount`.** For `k` from 0 to `n - 1`:
   `tabbed.getTab().setActiveTabIndex(k)`, `root.doLayout()`, then
   `await tools.waitFrames(2)`. Select tab 0 again and wait two more frames.
   Record the reference editor's `.cm-editor` class list under the mount theme —
   the `theme.indistinct` guard compares against it. Return the panel's `theme`
   target.

8. **`editor-tabs` — the theme target.** Build it over
   `themeTarget(THEME_CYCLE)` from `src/pageTargets.js`, following the schedule
   table in `## Internal Structure`. The check bumps `theme.match`,
   `theme.mismatch` or `theme.indistinct` through `tools.bumpWork`. `restore()`
   calls the base `restore()` and selects tab 0.

9. **`editor-tabs` — the work counters.** `installWork` returns, **in this
   order**, `tools.countMethod(reference, 'onThemeChange')` and then one
   `countInstance`-style wrapper per tab editor that bumps `theme.hidden` or
   `theme.shown` from the panel's own record of the selected tab before
   delegating. The order matters: an instance wrapper captures whatever the
   prototype holds when it is installed, so the prototype counter must already
   be in place or its count would miss every tab editor.[^counter-order]

10. **`packages/qa/tests/mount.test.ts` — cover `editor-tabs`.** Add a `P17`
    describe: at `n = 3`, `cycle(0)` selects tab 1, `cycle(2)` selects tab 2,
    `cycle(4)` leaves the selection alone (no tab 3), and `restore()` selects
    tab 0 and puts back the starting theme.

11. **`packages/qa/src/panels/markdown-doc.ts` — the ladder.** Make `afterMount`
    `async`. Add the capture `scroll` listener on the viewer's element that
    keeps `event.target` as the pane; probe the span with `LADDER_PROBE_PX`;
    `await tools.waitFrames(2)`; return `call` alongside today's `drag` and
    `wheel`. Add `maxScrollTop` to `describe()`. The `call` target does nothing
    when the span is 0, so a page that cannot scroll fails no run.

12. **`markdown-doc` — the oracle.** Extend `countActiveHeadings`
    ([`:77`](packages/qa/src/panels/markdown-doc.ts#L77)) so the replacement
    `setActiveHeading` bumps `heading.agree` or `heading.disagree` per the
    predicate table before its existing `heading@<id>` tally and delegation. It
    checks nothing and counts neither while the pane element is still unknown.
    The heading ids come from `extractMarkdownHeadings(draft)`
    (`@jimka/typescript-ui/component/display`), so the panel needs no access to
    the tracker's own list.

13. **`packages/qa/tests/mount.test.ts` — cover the ladder.** Add a `P18`
    describe: after mounting `markdown-doc`, `call(k)` for `k` = 0, 6, 12, 18
    and 24 throws nothing and leaves `getScrollTop()` inside `[0, span]`, with
    `k` = 0 and 24 back at 0. jsdom lays nothing out, so the span there may be 0
    and the target then writes nothing; the exact offsets are an engine check
    (`## Expected Behaviour` 16), not a jsdom one.

14. **`packages/qa/README.md` — record the surfaces.** Add a *Panels* row for
    `scroll-panes` and one for `editor-tabs`, both with an empty *Validated*
    cell; extend `markdown-doc`'s row with the `call` driver, `maxScrollTop` and
    the two heading counters; and restate `g16.panel-settled`'s entry in *Built-in
    ablations* as skipping while the panel's size, child count and recorded
    content extent are unchanged.

15. **Check the package.** `npm -w packages/qa run typecheck` and
    `npm -w packages/qa run test` both pass, and
    `sed -n '/function g16PanelSettled/,/^}/p' packages/qa/src/harness/ablations.ts | grep -c getPreferredSize`
    prints `0` (other ablations still use it, so the check has to be scoped to
    this one).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/qa/src/panels/scroll-panes.ts` |
| Create | `packages/qa/src/panels/editor-tabs.ts` |
| Modify | `packages/qa/src/panels/markdown-doc.ts` |
| Modify | `packages/qa/src/harness/ablations.ts` |
| Modify | `packages/qa/tests/ablations.test.ts` |
| Modify | `packages/qa/tests/mount.test.ts` |
| Modify | `packages/qa/README.md` |

---

## Expected Behaviour

Unit-testable in the package's own vitest suite (jsdom lays nothing out, so
every case below is about structure and bookkeeping, never about rectangles):

1. `scroll-panes` at `n = 3` builds three panes, each with `ROWS_PER_PANE` rows;
   `describe().panes` is 3.
2. `scroll-panes` resolves a `wheel` target that is an element in the document
   (`P7`'s own assertion).
3. `editor-tabs` at `n = 3` builds four editors: the reference and one per tab.
4. `editor-tabs`' `cycle(0)` selects tab 1 and `cycle(2)` selects tab 2.
5. `editor-tabs`' `cycle(4)` at `n = 3` selects nothing: the lap is over.
6. `editor-tabs`' `restore()` selects tab 0 and puts back the theme the page had.
7. `markdown-doc`'s `call(k)` throws nothing and leaves `getScrollTop()` inside
   `[0, span]` for `k` = 0, 6, 12, 18 and 24, and back at 0 for `k` = 0 and 24.
8. `markdown-doc`'s `call(k)` writes no offset at all when the measured span is
   0 — the state jsdom, which lays nothing out, leaves the viewer in.
9. `g16.panel-settled` still skips a second settled pass and still runs after a
   width change, and calls `getPreferredSize` on neither.

Verified only in the engine, by the runs in `## Verification`:

10. A `passes` unit of `scroll-panes` re-measures every pane:
    `pane.remeasure@Panel` is about `n` per unit, and
    `seam.source.getScrollMetrics` is of the same order.
11. A `wheel` unit of `scroll-panes` really scrolls: `pane.scrollTick` is at
    least 1 per unit, and `describe().scrollablePanes` equals `n`.
12. `editor-tabs` keeps a view behind every hidden tab: `describe().editorViews`
    is `n + 1`.
13. Each theme unit of `editor-tabs` finds `n - 1` hidden editors:
    `theme.hidden` is `n - 1` per unit and `theme.shown` is 1 (the selected tab;
    the reference editor carries no wrapper of its own).
14. Every check passes on the plain arm: `theme.match` is 0.5 per unit,
    `theme.mismatch` and `theme.indistinct` are absent.
15. Every heading the plain `markdown-doc` resolves satisfies the rule:
    `heading.agree` is one per scroll tick and `heading.disagree` is absent from
    the report.
16. The ladder lands on the same offsets in every run, where the wheel does not:
    the three plain runs of cell `m60l` agree on geometry in phase 0 and report
    the same `heading@<id>` tallies there, while their phase 1 tallies need not
    agree.

---

## Verification

```sh
npm -w packages/qa run typecheck
npm -w packages/qa run test
```

The three cells below each open a full-screen window per run and must be run by
the user, in one session, in this order. They follow the sweep's scored-cell
shape — `plain-a`, each arm, `plain-b`, each arm in reverse, `plain-c` — and its
run-name grammar, so `qa-ab.py` reads each cell from its prefix. `FLAGS` is the
sweep's own instrument set, and every arm of a cell carries it.

```sh
FLAGS='work=1&seam=1&geom=1'
```

### Cell `spp` — G16

```sh
P='panel=scroll-panes&drive=passes,wheel,idle:4'
packages/qa/runqa.sh w31s1-spp-plain-a                  main "$P&$FLAGS"
packages/qa/runqa.sh w31s1-spp-g16.panel-settled-1      main "$P&$FLAGS&abl=g16.panel-settled"
packages/qa/runqa.sh w31s1-spp-g16.scroll-reads-1       main "$P&$FLAGS&abl=g16.scroll-reads"
packages/qa/runqa.sh w31s1-spp-plain-b                  main "$P&$FLAGS"
packages/qa/runqa.sh w31s1-spp-g16.scroll-reads-2       main "$P&$FLAGS&abl=g16.scroll-reads"
packages/qa/runqa.sh w31s1-spp-g16.panel-settled-2      main "$P&$FLAGS&abl=g16.panel-settled"
packages/qa/runqa.sh w31s1-spp-plain-c                  main "$P&$FLAGS"

python3 packages/qa/bin/qa-table.py packages/qa/results w31s1-spp- --work \
    --before host.scrollablePanes,host.maxScrollTop0
python3 packages/qa/bin/qa-ab.py packages/qa/results w31s1-spp- \
    --counter 'seam.source.getScrollMetrics' --same 'work.pane.remeasure@Panel'
python3 packages/qa/bin/qa-ab.py packages/qa/results w31s1-spp- \
    --counter 'seam.source.getScrollMetrics - work.memo.g16.scroll-reads.metricsHit'
```

Read `g16.panel-settled` from phase 0 of the first `qa-ab.py` call and
`g16.scroll-reads` from phase 1 of the second. Both arms are printed in every
phase block: `g16.panel-settled` reads `unreached` in the wheel phase, which
drives no layout pass, and that is the shape of the cell rather than a finding.

Before either verdict, the table must show `scrollablePanes` equal to `n`,
`pane.remeasure@Panel` about `n` per `passes` unit, and `pane.scrollTick` at
least 1 per `wheel` unit. If `scrollablePanes` is below `n`, the panes do not
overflow at this viewport — raise `ROWS_PER_PANE` and re-run rather than reading
the cell. If the settled arm's Δms sits inside the bracket — the spread between
the cell's fastest and slowest plain run — raise `n=` and re-run: the bracket
belongs to the phase, and the saving has to clear it.

### Cell `etm` — G25

```sh
P='panel=editor-tabs&n=8&drive=theme:14,idle:4'
packages/qa/runqa.sh w31s1-etm-plain-a                  main "$P&$FLAGS"
packages/qa/runqa.sh w31s1-etm-g25.theme-withhold-1     main "$P&$FLAGS&abl=g25.theme-withhold"
packages/qa/runqa.sh w31s1-etm-plain-b                  main "$P&$FLAGS"
packages/qa/runqa.sh w31s1-etm-g25.theme-withhold-2     main "$P&$FLAGS&abl=g25.theme-withhold"
packages/qa/runqa.sh w31s1-etm-plain-c                  main "$P&$FLAGS"

python3 packages/qa/bin/qa-table.py packages/qa/results w31s1-etm- --work --before host.editorViews
python3 packages/qa/bin/qa-ab.py packages/qa/results w31s1-etm- \
    --counter 'work.onThemeChange@CodeEditor - work.skipped.g25.theme-withhold.theme' \
    --same 'work.theme.match' --same 'work.theme.mismatch' --same 'work.theme.indistinct'
grep -l 'theme.mismatch\|theme.indistinct' packages/qa/results/w31s1-etm-*.json
```

The `grep` must print nothing: a single bad check is 0.07 per unit over 14
units, which `--same` catches, but a longer phase could hide one under its
tolerance. Read the arm's engagement against the panel's own population:

| plain `theme.hidden` | arm `skipped.g25.theme-withhold.theme` | Reading |
|---|---|---|
| 0 | 0 | the panel hid no editor — the surface is wrong, not the candidate |
| `n - 1` per unit | 0 | hidden editors hold no view; G25 has nothing to withhold |
| `n - 1` per unit | about `n - 1` per unit | engaged: read the cell |

### Cell `m60l` — G27

```sh
P='panel=markdown-doc&drive=call:48,wheel'
packages/qa/runqa.sh w31s1-m60l-plain-a                 main "$P&$FLAGS"
packages/qa/runqa.sh w31s1-m60l-g27.heading-cache-1     main "$P&$FLAGS&abl=g27.heading-cache"
packages/qa/runqa.sh w31s1-m60l-plain-b                 main "$P&$FLAGS"
packages/qa/runqa.sh w31s1-m60l-g27.heading-cache-2     main "$P&$FLAGS&abl=g27.heading-cache"
packages/qa/runqa.sh w31s1-m60l-plain-c                 main "$P&$FLAGS"

python3 packages/qa/bin/qa-table.py packages/qa/results w31s1-m60l- --work --before host.maxScrollTop
python3 packages/qa/bin/qa-ab.py packages/qa/results w31s1-m60l- \
    --counter 'seam.source.querySelector + seam.source.getElementRect' \
    --same 'work.heading.disagree'
grep -l 'heading.disagree' packages/qa/results/w31s1-m60l-*.json
```

`heading.agree` must be about 1 per unit of phase 0 in every arm: a ladder that
resolves no heading has measured nothing. The three plain runs must also report
the same `heading@<id>` tallies in phase 0 — that is the ladder being
deterministic, and it is what the wheel phase cannot promise. The `grep` must
print nothing; a file it names is an arm that changed which heading is active,
which is the answer G27 was sent away for.

### Reading a mid-burst geometry `DIFF`

If phase 0 of `spp` or `etm` reports `DIFF(<label>)` on a label the arm's
deferral touches — a pane whose shadow resize was skipped, an editor whose
reconfigure was withheld — re-read that cell with `--allow-diff '<label>@0'` and
take the soundness verdict from the trailing `idle` phase. A mid-burst
difference on deferred work is the deferral, not a wrong layout; the settled
state is what has to match.

### By eye

Open `http://localhost:5190/?panel=scroll-panes` and
`?panel=editor-tabs` under `npm -w packages/qa run dev` (this opens no window of
its own). The board's panes must show scrollbars or shadow edges, and the
tabbed group must show eight tabs beside a second editor.

---

## Documentation Impact

`packages/qa/README.md` is the QA app's only reference. Three edits, all in
step 14: two new *Panels* rows, `markdown-doc`'s row extended with its new
driver and counters, and `g16.panel-settled`'s line in *Built-in ablations*
restated. The panels' `description` exports carry the same facts in the report,
which is where a reader of a result looks first.

Nothing in `packages/lib/llms.txt` or the library docs changes: no library
symbol moves.

---

## Potential Challenges

- **The panes may not overflow at the host's viewport.** `describe().scrollablePanes`
  says so in the report; raise `ROWS_PER_PANE` and re-run.
- **CodeMirror may not mount a view for a tab shown only briefly.**
  `describe().editorViews` is the check; if it is below `n + 1`, raise the frame
  wait in `afterMount` before concluding anything about G25.
- **The check could compare two editors that differ for an unrelated reason.**
  Only `cm-focused` is expected to vary, and `type` and `key` never run in these
  cells; `theme.mismatch` in the *plain* arm would mean the comparison itself is
  wrong, and the cell says nothing until that is fixed.
- **`_lastContentExtent` is only refreshed while a scroll affordance shows**
  ([`Panel.scheduleGutterSettleOnShrink`](packages/lib/src/typescript/lib/core/Panel.ts#L920)).
  For a pane that shows none, the gate falls back to size and child count. That
  is sound for these cells, whose content never changes, and the geometry gate
  catches it if it ever is not.
- **jsdom neither lays out nor scrolls.** Every new test asserts structure or
  bookkeeping; the ladder's positions are exercised through `setScrollTop`'s own
  cache, which jsdom does keep.
- **A new panel that cannot mount under jsdom** gets a `JSDOM_GAPS` entry in
  `tests/mount.test.ts` naming the exact error it throws there, as `form-flat`
  and `table-rows` have. Neither panel is expected to need one — `shell-shallow`
  already mounts `CodeEditor`s and a `Tab` under jsdom — and weakening a panel to
  suit jsdom is the wrong trade: the engine is what these surfaces are for.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/qa/README.md`](packages/qa/README.md) | The panel contract, the drivers, the ablations, the analysers and the measurement rules. |
| [`packages/qa/src/panels.ts`](packages/qa/src/panels.ts) | `PanelBuild` and `PanelModule`: the four exports a panel file may have. |
| [`packages/qa/src/panels/chart-dashboard.ts`](packages/qa/src/panels/chart-dashboard.ts) | The `Grid`-of-components precedent `scroll-panes` follows. |
| [`packages/qa/src/panels/markdown-doc.ts`](packages/qa/src/panels/markdown-doc.ts) | The panel being extended, and the precedent for a panel-installed counter that wraps a library method. |
| [`packages/qa/src/builders/shell.ts`](packages/qa/src/builders/shell.ts) | `countMethod(editor, 'onThemeChange')`, the editor document, and the `afterMount` element lookups. |
| [`packages/qa/src/pageTargets.ts`](packages/qa/src/pageTargets.ts) | `themeTarget`, which `editor-tabs` wraps rather than reimplements. |
| [`packages/qa/src/harness/ablations.ts`](packages/qa/src/harness/ablations.ts) | `g16PanelSettled`, `g25ThemeWithhold` and `g27HeadingCache`: what each arm patches and counts. |
| [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts) | `remeasureScrollMetrics`, the settle relay and the content-extent record. |
| [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts) | `findActiveHeading`: the rule the oracle re-derives, and its 1 px tolerance. |
| [`packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts`](packages/lib/src/typescript/lib/component/display/HeadingScrollTracker.ts) | `trackScroll` and `setActiveHeading`: what the ablation replaces and what the panel wraps. |
| [`packages/lib/src/typescript/lib/layout/Tab.ts`](packages/lib/src/typescript/lib/layout/Tab.ts) | `doLayout` undisplays every inactive page — why a hidden tab's editor keeps its view. |
| [`packages/lib/src/typescript/lib/component/editor/theme.ts`](packages/lib/src/typescript/lib/component/editor/theme.ts) | `codeEditorTheme`: what a reconfigure actually changes, and what it does not. |
| [`packages/qa/bin/qa-ab.py`](packages/qa/bin/qa-ab.py) | How a cell is scored: the bracket, `engaged`, `--allow-diff`, `--same` and their tolerances. |
| [`plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md) | The verdicts, the counter each arm is scored on, and the surface each candidate was told it needed. |

---

## Non-Goals

- **Deciding the three candidates.** The plan builds the surfaces and states
  what each cell must show; the runs, and the verdicts, are the user's.
- **A sweep script.** Three cells of five to seven runs are written out in
  `## Verification`; a `sweeps/*.sh` file would need its own tests and would
  collide with the sibling `qa-panel-determinism` plan in the same directory.
- **Repairing the form panels' wheel cells.** `form-flat` and `form-nested` are
  where `g16.scroll-reads` read `unreached`; `scroll-panes` replaces them as
  G16's surface, and diagnosing the forms is not needed to measure the
  candidate.
- **Changing `g25.theme-withhold` or `g27.heading-cache`.** Both engage on the
  surfaces this plan builds. Only `g16.panel-settled`, whose gate would be paid
  once per pane per pass, changes.
- **Any library change.** These are measurement surfaces; a candidate that wins
  becomes its own plan.

---

## Notes

[^witness]: W3.0's decision rule turns on `engaged`, which reads the *arm's* own
    counters. That is the right test for "did the patch fire", and the wrong one
    for "was the patch's situation ever set up": both read 0. G25's two cells
    read `unreached` for the second reason — the shells mount tabs that are never
    shown, so no hidden editor ever holds a view — and nothing in the report said
    so; the sweep's authors had to work it out afterwards. A panel-side witness
    puts that fact in the report: `theme.hidden` counts the population the arm
    could have skipped, `pane.remeasure@Panel` the re-measures it could have
    skipped, and `heading.agree` the resolutions it could have changed.

[^board]: The two halves have to share a panel because the sweep's record asks for a
    settled pass and a real scroll "on the same scrollable `Panel`", and because
    a cell that holds both phases gates both against one set of plain runs.
    Twenty-four panes is the lever: `fnq` and `ffq` had two re-measures per pass,
    a saving no frame time could resolve against a 0.02 ms bracket. The bracket
    belongs to the phase, not to the change, so the only way to make it mean
    something is to make the avoided work large. `n=` scales the board if 24 is
    not enough.

[^gate-cost]: The gate exists to avoid one `getScrollMetrics` read; paying a
    subtree size computation to decide it inverts the trade, and `getPreferredSize`
    is itself one of the work counters the harness tracks. On the form panels
    that cost was paid twice per pass; on a 24-pane board it would be paid 24
    times, and the arm would measure the gate rather than the candidate. The
    replacement reads `_lastContentExtent`, which the panel's own
    `scheduleGutterSettleOnShrink` writes at the end of the same `doLayout` that
    ran the re-measure, so the value the gate compares is the previous pass's —
    exactly the "nothing has changed since last time" test the gate wants. This
    is a bounding ablation, not the fix: a real fix would design its own
    invalidation, and the geometry gate is what keeps a wrong skip from being
    read as a win.

[^tabs]: `Tab.doLayout` undisplays every inactive page, and `setDisplayed(false)`
    only adds a class ([`Component.setDisplayed`](packages/lib/src/typescript/lib/core/Component.ts#L2488)),
    so the element stays in the document and `CodeEditor` keeps `_view` —
    `onEffectiveVisibilityChange` only asks the view to re-measure when the
    editor comes back. That is why a tab switch, and not a disposal, is the
    hiding mechanism the sweep's record asks for. The reference editor beside the tab
    group is what makes a check possible at all: with one tab shown at a time,
    there would otherwise be no correctly-themed editor to compare against.

[^inside-theme]: The `theme` driver calls `restore()` after its last unit
    ([`packages/qa/src/harness/drivers.ts:1023`](packages/qa/src/harness/drivers.ts#L1023)),
    and `ThemeManager.setTheme` notifies every editor, so a withheld editor's
    last reconfigure is under the page's starting theme either way. A phase
    ordered `theme` then `toggle` would therefore show a tab under the very theme
    the hidden editor already carried, and the check could never fail. Putting
    the show inside `cycle` is what keeps the page on a different theme at the
    moment the editor comes back. A separate `toggle` phase whose target left the
    theme switched was rejected: `restore()` is the contract that keeps a theme
    phase from leaking into later phases, and a panel that broke it would make
    every other phase of that run unreadable.

[^classlist]: `EditorView.theme(spec, { dark })` contributes CodeMirror's
    `darkTheme` facet, and the view puts the matching style-module class on the
    `.cm-editor` element. Everything else in `codeEditorTheme` is either a CSS
    custom property, which the browser re-resolves for every editor the moment
    `ThemeManager` writes the document element, or the fixed syntax palette,
    which is the same in both modes. So a computed colour cannot tell a
    reconfigured editor from a withheld one, and the class list can.
    `theme.indistinct` is the guard for the day that stops being true: it fires
    when the reference editor's own class list did not change across the switch,
    which is the case where the check proves nothing.

[^settled-gate]: The agenda's *G22 unblocked* section retires `ttr`'s
    `DIFF(focused)` verdict: the probe compared every unit including the
    mid-burst ones the deferral exists to skip, and the settled rectangles
    matched exactly. The same shape applies here — G16's arm skips a shadow
    resize while a signature holds, G25's withholds a reconfigure until the
    editor is shown — so both cells end in `idle:4`, the same trailing phase
    G22's own re-measurement used, and `--allow-diff <label>@0` is the documented
    way to read a mid-burst difference rather than voiding the cell. G27 caches a
    lookup and defers nothing, so its cell needs no trailing phase.

[^ladder]: A wheel's per-unit scroll position depends on the gap between frames,
    so two runs of the same phase stop at different offsets. That is fine for
    timing, which is averaged, and useless for a question asked per position. The
    ladder writes absolute offsets through the viewer's public `setScrollTop`, so
    unit `k` is at the same pixel in every run of every arm, and "the active
    heading at each scroll position" is a well-defined thing to assert. The
    triangle returns the pane to 0, so the `wheel` phase after it starts where the
    old `m60w` cell did.

[^in-run]: `qa-ab.py` derives `unstable` from geometry alone
    ([`packages/qa/bin/qa-ab.py:678`](packages/qa/bin/qa-ab.py#L678)): when the
    plain runs disagree among themselves on a `--same` counter, every arm is
    reported as `DIFF(same …)` and nothing says the plain runs disagreed too. So
    `--same 'work.heading@*'` over a wheel phase cannot distinguish a changed
    answer from a differently-paced scroll, and W3.0's G27 verdict rests on it. An
    in-run oracle removes the comparison: `heading.disagree` is raised by the run
    that made the wrong choice, whatever its scroll positions were, and a
    candidate that only caches the lookup never raises it. Calling the library's
    exported `findActiveHeading` as the oracle was rejected: a candidate that
    changes that function would move the oracle with it.

[^no-scrolled-labels]: This is why `scroll-panes` labels pane 1's first row
    rather than pane 0's: a row inside the pane catches a wrong scrollbar gutter
    or a wrongly sized shadow overlay, both of which move content, but only a
    pane that never scrolls can carry that label. `markdown-doc`'s existing
    labels — `side`, `viewer`, `minimap` — are already of this kind, which is why
    its wheel cells were geometry-`=` in W3.0 and failed only on the `--same`
    heading keys.

[^no-option]: The one harness-level thing these cells want is a geometry gate
    that reads the settled state rather than every mid-burst unit, and that
    already exists as a shape rather than an option: a trailing `idle` phase
    plus `--allow-diff <label>@<phase>`, which is how G22's own re-measurement
    was read. Building a second mechanism for it would duplicate that, and
    would land in the same harness files `qa-panel-determinism` is editing. If
    that plan does add a repeatability option for a driver, none of these three
    cells needs it: `scroll-panes` and `editor-tabs` declare no label that a
    scroll or an animation moves, and `markdown-doc`'s heading gate is an
    absolute count rather than a comparison with another run.

[^one-lap]: Showing each tab twice would break the check. An editor shown a
    second time carries whatever theme it last saw while visible, and with a
    two-theme cycle and a two-unit show period that is the same theme the check
    would compare it against. One lap keeps every tab's stale theme equal to the
    mount theme, and every show on a `DarkTheme` unit, so a missing catch-up is
    always visible. Units after the lap keep switching the theme without showing
    anything, which is what lets the phase be lengthened for timing without
    weakening the check.

[^counter-order]: `countInstance`
    ([`packages/qa/src/builders/work.ts:18`](packages/qa/src/builders/work.ts#L18))
    reads `host[method]`, which resolves through the prototype chain at the moment
    it installs. The full chain in a measured run is: the panel's instance
    wrapper, then `countMethod`'s prototype counter, then the ablation's wrapper,
    then the original — ablations are applied before any work counter
    ([`packages/qa/src/harness/run.ts:254`](packages/qa/src/harness/run.ts#L254)).
    That order is what makes the cell's scoring counter,
    `work.onThemeChange@CodeEditor - work.skipped.g25.theme-withhold.theme`, the
    number of reconfigures actually performed.
