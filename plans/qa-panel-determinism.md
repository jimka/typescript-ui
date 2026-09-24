# QA Panel Determinism — Implementation Plan

## Overview

Three cells of the W3.0 sweep were voided because the QA panel under them, not
the library change, gave a different answer on each run. `text-metrics`
disagrees with itself on six of 117 probed rectangles, `table-rows`' wheel
phase (`trw`) and `treetable-rows`' key phase (`ttk`) disagree between *plain*
runs. A geometry gate is only worth having when the plain arms agree, so those
three cells say nothing — including G23's fourth cell, whose other three each
measured a clean 25–27 ms win.

This plan makes the three phases repeatable. It adds a `settle` driver to the
harness that waits for the page to stop moving before its first measured unit,
so a burst can be gated on the layout it comes to rest in; it makes
`text-metrics` wait for the page's web fonts and lay itself out once before it
is measured; and it makes `bin/qa-ab.py` name the labels the plain arms
disagree on, so "is this phase repeatable?" is one command. Everything is in
`packages/qa`; no library file changes.[^library-untouched]

---

## Architecture Decisions

### The gate belongs on the settled state, and the harness is where that is decided

A burst's mid-flight rectangles are not a soundness signal: a candidate that
defers work inside a burst is *supposed* to differ there, and a panel whose
burst is driven by wall-clock timing differs there between two runs of the same
build. The page's resting layout is the thing worth comparing. A new `settle`
driver in [packages/qa/src/harness/drivers.ts:1155](packages/qa/src/harness/drivers.ts#L1155)
waits — unmeasured — until every probed rectangle has stopped changing, then
measures ordinary idle frames. Every unit of a `settle` phase is therefore a
settled sample, so every reader's existing geometry gate compares the resting
layout with no change to the reader at all.[^harness-not-analyser]

This follows the drivers that already keep a settling wait out of their
counters: `key` and `type` focus their element and then
`await tools.waitFrames(SETTLE_FRAMES)` inside `tools.suspendCounting` before
their first measured unit ([packages/qa/src/harness/drivers.ts:890](packages/qa/src/harness/drivers.ts#L890)).
`settle` is that same lead-in, with the fixed frame count replaced by a wait
that watches the probe and says in a note how long it took.

### A wheel or key burst is gated on its settle phase, not unit by unit

A wheel event does not scroll the body directly. `Component` hands it to
`SmoothScroller`, an easing loop that closes a fraction
`k = 1 − 0.75^(Δt / 16.667)` of the remaining distance each frame
([packages/lib/src/typescript/lib/core/SmoothScroller.ts:205](packages/lib/src/typescript/lib/core/SmoothScroller.ts#L205)).
`Δt` is the real frame duration, so the scroll offset at unit *i* is a function
of how long the previous frames took — and `trw` runs at 91.5 ms per frame with
its own spread. Every label that rides the scroll therefore moves by a
different amount in each run.

The fix is not to remove the ease — that is the path the cell exists to
measure. It is to add a settle phase after the burst and read the gate there.
The settled position is exactly the starting one, so the settled rectangles are
the panel's mount rectangles in every run and on both arms.[^net-zero]

`treetable-rows`' key phase gets the same treatment for the same reason. Its
150 units alternate ArrowDown and ArrowUp, so the anchor ends where it began
and the settled focused cell is the one the panel mounted with; what moves
between runs is where the focus sits part-way through the burst. So the two
cells become `drive=wheel,settle:4` and `drive=key,settle:4`, gated on phase 1,
with the burst phase's moving labels taken out by `--allow-diff <label>@0`.

### `text-metrics` waits for the web fonts, then lays itself out once

The panel's first `update` unit is the only probe that reads the *mount*
layout, and the mount layout's row 9 is measured against whichever font face
was active at the moment that row was first measured. Row 9 is `Łódź`
([packages/qa/src/panels/text-metrics.ts:40](packages/qa/src/panels/text-metrics.ts#L40)),
the only string in the panel whose characters need the framework's Latin-Ext
subset, which is fetched lazily — after `Body.init` has already resolved.
Nothing lays a plain `Text` out again when that subset lands, so which of the
two widths row 9 gets is decided by a race the mount never revisits — and that
first `update` unit reads the winner.[^font-race]

`text-metrics` gains an `afterMount` that awaits a new
`awaitFontsSettled(tools, label)` and then calls `root.doLayout()`. The wait
makes the faces final; the layout pass makes every label re-measure against
them. The wait lives in the panel, not the harness: it mirrors
`awaitStoreView` ([packages/qa/src/builders/store.ts:85](packages/qa/src/builders/store.ts#L85)),
which is a panel-level wait in `afterMount` for exactly this class of problem —
something the panel needs arrives after the mount.[^panel-not-harness]

### The plain line reports the plain arms' own agreement

`qa-ab.py` already computes whether the plain arms disagree, and already knows
which labels ([packages/qa/bin/qa-ab.py:678](packages/qa/bin/qa-ab.py#L678)) —
it just prints a bare `unstable` on the arm lines and nothing at all when a
cell has no ablated arm. Printing `geom =` or `geom unstable(<labels>)` on the
plain line names what varies and makes a cell of three plain runs a complete
determinism check, which is what the verification below runs.[^plain-line]

---

## Public API

```ts
// packages/qa/src/builders/fonts.ts — new
export function awaitFontsSettled(tools: HarnessTools, label: string): Promise<void>;
```

```ts
// packages/qa/src/harness/probes.ts — new export
export function awaitSettledGeometry(tools: HarnessTools, stableFrames: number, capFrames: number): Promise<string>;
```

```ts
// packages/qa/src/harness/drivers.ts — DRIVERS gains one entry
export const DRIVERS: Record<string, Driver>;   // + settle

// packages/qa/src/pageTargets.ts — the returned record gains one entry
export function pageTargets(root: Component): Record<string, unknown>;   // { idle, settle, theme, viewport }
```

---

## Internal Structure

### `awaitSettledGeometry`

Samples the probe's targets once per frame without recording them, and ends
when the sample has equalled the one before it for `stableFrames` frames in a
row.

| Frame | `focused` sample | Equal to the frame before? | Run of equal frames | What it does |
|---|---|---|---|---|
| 0 | `[1,82,2431,20]` | — | 0 | first sample, taken before any wait |
| 1 | `[1,68,2431,20]` | no | 0 | keeps waiting |
| 2 | `[1,62,2431,20]` | no | 0 | keeps waiting |
| 3 | `[1,62,2431,20]` | yes | 1 | keeps waiting |
| 4 | `[1,62,2431,20]` | yes | 2 | returns `settle: stable after 4 frames` |

```ts
export async function awaitSettledGeometry(tools: HarnessTools, stableFrames: number, capFrames: number): Promise<string> {
    if (!geometryTargets) {
        await tools.waitFrames(stableFrames);

        return `settle: no geometry targets; waited ${stableFrames} frames`;
    }

    let previous = rectsSignature();
    let stable = 0;

    for (let frame = 1; frame <= capFrames; frame++) {
        await tools.waitFrames(1);

        const current = rectsSignature();

        stable = current === previous ? stable + 1 : 0;
        previous = current;

        if (stable >= stableFrames) {
            return `settle: stable after ${frame} frames`;
        }
    }

    throw new Error(`settle: still moving after ${capFrames} frames`);
}
```

`rectsSignature()` is a module-private helper returning
`JSON.stringify(Object.values(geometryTargets).map((target) => sampleTarget(target)))`
— one string per frame, compared exactly, `null` for a missing element
included.

### The `settle` driver

```ts
async function settle(ctx: DriveContext): Promise<number[]> {
    ctx.notes.push(await ctx.tools.suspendCounting(async () => awaitSettledGeometry(ctx.tools, SETTLE_STABLE_FRAMES, SETTLE_CAP_FRAMES)));

    return ctx.tools.runFrames(ctx.units, () => {});
}
```

### `awaitFontsSettled`

```ts
export async function awaitFontsSettled(tools: HarnessTools, label: string): Promise<void> {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;

    if (fonts) {
        await Promise.race([allBatchesDone(fonts), failAfter(FONTS_TIMEOUT_MS, label)]);
    }

    await tools.waitFrames(REFLOW_FRAMES);
}
```

`allBatchesDone` re-reads `fonts.ready` while `fonts.status === 'loading'`: a
`ready` promise covers the batch in flight when it is read, and rendering text
that needs a further subset starts a new batch afterwards.

---

## Ordered Implementation Steps

1. **`packages/qa/src/harness/probes.ts`** — add the module-private
   `rectsSignature()` and the exported `awaitSettledGeometry(tools, stableFrames, capFrames)`
   shown above, below `takeGeometry`. `probes.ts` already imports `HarnessTools`
   from `./types.js`; no new import is needed.

2. **`packages/qa/src/harness/drivers.ts`** — import `awaitSettledGeometry`
   from `./probes.js`. Add two constants beside `SETTLE_FRAMES`
   (line 44), each with the doc comment the file's other constants carry:
   `SETTLE_STABLE_FRAMES = 2` (two frames, so one frame's pause inside a burst
   does not read as settled) and `SETTLE_CAP_FRAMES = 120` (two seconds at
   60 Hz, over ten at the 91 ms per frame `table-rows`' wheel phase runs at).
   Add the `settle` driver after `idle`
   ([packages/qa/src/harness/drivers.ts:371](packages/qa/src/harness/drivers.ts#L371)),
   and register it in `DRIVERS` between `idle` and `call`.

3. **`packages/qa/src/pageTargets.ts`** — return `settle: root` beside
   `idle: root`, and update the function's `@returns` line and the file's
   header comment, both of which list the page-wide targets by name.

4. **`packages/qa/tests/pageTargets.test.ts:20`** — the case asserts the exact
   key list; change it to `['idle', 'settle', 'theme', 'viewport']` and rename
   the case to name `settle` too. Run `npm -w packages/qa run test` — expect this
   file green.

5. **`packages/qa/tests/drivers.test.ts`** — in `E16 call and idle`, add a case
   that `settle` runs its frames after the wait, using the existing
   `fakeTools()` (its `waitFrames` resolves at once) and no geometry targets:
   `expect(tools.runFrames.mock.calls[0][0]).toBe(5)` and a note matching
   `/^settle: /`. This file runs in plain node, and nothing on the new import
   path touches `document` at import time or when the probe has no targets, so
   no environment comment is needed.

6. **`packages/qa/tests/drivers.dom.test.ts`** — add a `settle` block under
   *setup settles before the measured units*. Build a real `div`, append it,
   override its `getBoundingClientRect` with a `vi.fn` that returns a moving
   rectangle for the first two calls and a fixed one after, call
   `setGeometryTargets({ box: '#<id>' })`, drive `DRIVERS.settle`, and assert
   the note names the frame it settled on and that the measured frames ran
   after it. Add a second case: a rectangle that never stops moving rejects
   with `settle: still moving after`. Call `setGeometryTargets(null)` in an
   `afterEach`, since the probe is module state.

7. **`packages/qa/src/builders/fonts.ts`** — new file, header comment in the
   shape of `builders/store.ts`'s: what the framework's startup font wait does
   cover, what a lazily fetched subset does not, and which panel therefore
   waits here. Two documented constants — `FONTS_TIMEOUT_MS = 10_000`
   (`mount.ts`'s paint cap, for the same reason) and `REFLOW_FRAMES = 3` (the
   three frames `store.ts`' `RENDER_FRAMES` and `drivers.ts`' `SETTLE_FRAMES`
   both count) — and the exported `awaitFontsSettled` shown above. The timeout
   rejects with
   `` `${label}: the page's web fonts were still loading ${FONTS_TIMEOUT_MS}ms after the mount` ``.

8. **`packages/qa/tests/fonts.test.ts`** — new file, jsdom, mirroring
   `tests/store.test.ts` ([packages/qa/tests/store.test.ts:144](packages/qa/tests/store.test.ts#L144)):
   reuse its `heldTools`, `watch` and `flush` helpers' shape. Stub
   `document.fonts` per case and restore it in `afterEach`. Cases: an already
   loaded set waits `REFLOW_FRAMES` and resolves; a set that reports `loading`
   holds until its `ready` settles and its `status` turns `loaded`; a set that
   starts a second batch — `status` back to `loading` after the first `ready`
   — is waited for as well; no `document.fonts` at all waits the frames and
   resolves; a set that never finishes rejects naming the panel.

9. **`packages/qa/src/panels/text-metrics.ts`** — import `awaitFontsSettled`
   from `../builders/fonts.js` and `HarnessTools` from `../harness/types.js`,
   add a `PANEL = 'text-metrics'` constant in the shape the other panels use,
   and add to the returned `PanelBuild`:

   ```ts
   afterMount: async (tools: HarnessTools): Promise<Record<string, unknown>> => {
       // Row 9's `Łódź` needs the framework's Latin-Ext subset, which is
       // fetched only once it renders — after `Body.init`'s startup font wait
       // has resolved. A plain Text is marked stale by the reflow that
       // follows but re-measures only when a layout pass next asks for its
       // size, so the mount layout keeps whichever face was active when it
       // was measured. Wait for the faces, then lay out once, so the first
       // probed unit reads the same box in every run.
       await awaitFontsSettled(tools, PANEL);
       root.doLayout();

       return {};
   },
   ```

   Update the `build` JSDoc's `@returns` to name the `afterMount`. Do **not**
   add a module export: `tests/panels.test.ts`'s P1 asserts a panel's exports
   are exactly `build`, `defaultDrive`, `defaultScale`, `description`.

10. **`packages/qa/tests/fonts.test.ts`** — add a second block, in the shape of
    `store.test.ts`'s `P13`: `text-metrics`' `afterMount` is held by the font
    wait (with `waitFrames` held, `afterMount` has not settled) and lays the
    root out once released. Say in a comment that `text-metrics` is the only
    panel that measures text outside the preloaded Latin subset, and so the
    only one that needs this wait.

11. **`packages/qa/bin/qa-ab.py`** — in `print_phase`
    ([packages/qa/bin/qa-ab.py:678](packages/qa/bin/qa-ab.py#L678)), replace the
    boolean `unstable` with the sorted label list, derive
    `plain_geom = f'unstable({",".join(labels)})' if labels else '='`, append
    `  geom {plain_geom}` to the plain line
    ([packages/qa/bin/qa-ab.py:684](packages/qa/bin/qa-ab.py#L684)), and pass
    `bool(labels)` to `read_arm`, whose signature and behaviour are unchanged.
    Update `print_phase`'s docstring.

12. **`packages/qa/tests/qaAb.test.ts`** — extend `T2` to assert the plain line
    ends `geom =`; change the `reads every arm as unstable when the plain arms
    disagree` case to also assert the plain line reads `geom unstable(chart)`;
    add a case where two plain reports disagree on two labels and the plain
    line reads `geom unstable(chart,point)` (add the second label to both
    reports inside `cellCopy`, so it exists on each).

13. **`packages/qa/README.md`** — see *Documentation Impact*.

14. Run `npm -w packages/qa run typecheck` and `npm -w packages/qa run test`
    (both need the built library); both must pass. Then
    `grep -rn "'idle', 'theme', 'viewport'" packages/qa` — expect zero matches.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/qa/src/builders/fonts.ts` |
| Create | `packages/qa/tests/fonts.test.ts` |
| Modify | `packages/qa/src/harness/probes.ts` |
| Modify | `packages/qa/src/harness/drivers.ts` |
| Modify | `packages/qa/src/pageTargets.ts` |
| Modify | `packages/qa/src/panels/text-metrics.ts` |
| Modify | `packages/qa/bin/qa-ab.py` |
| Modify | `packages/qa/README.md` |
| Modify | `packages/qa/tests/pageTargets.test.ts` |
| Modify | `packages/qa/tests/drivers.test.ts` |
| Modify | `packages/qa/tests/drivers.dom.test.ts` |
| Modify | `packages/qa/tests/qaAb.test.ts` |

---

## Expected Behaviour

Unit-testable in `packages/qa`'s vitest suite:

1. `awaitSettledGeometry` with no geometry targets waits `stableFrames` frames
   and returns `settle: no geometry targets; waited 2 frames`.
2. With a target whose rectangle is already fixed, it returns
   `settle: stable after 2 frames` — the minimum, since two equal samples must
   still be observed.
3. With the frame-by-frame samples of the worked table above, it returns
   `settle: stable after 4 frames`.
4. With a rectangle that changes every frame, it throws
   `settle: still moving after <cap> frames` after exactly `capFrames` waits.
5. The `settle` driver pushes that string onto `ctx.notes`, runs the wait
   inside `tools.suspendCounting`, and then calls `tools.runFrames(units, …)`
   exactly once — in that order.
6. `pageTargets(root)` returns keys `['idle', 'settle', 'theme', 'viewport']`,
   with `settle` the root.
7. `awaitFontsSettled` resolves after `REFLOW_FRAMES` when the font set reports
   `loaded`; holds while it reports `loading`; holds again when a second batch
   starts after the first `ready` resolves; resolves after the frames alone
   when the engine exposes no `document.fonts`; and rejects with
   `text-metrics: the page's web fonts were still loading 10000ms after the mount`
   when the set never finishes.
8. `text-metrics`' `afterMount` does not settle while the font wait is held,
   and lays the root out once released.
9. `qa-ab.py`'s plain line ends `geom =` for the unchanged fixture cell, and
   `geom unstable(chart)` when one plain report's `chart` series is altered;
   two altered labels print `geom unstable(chart,point)`, sorted and
   comma-joined.
10. An arm's own `geom` reading is unchanged: `=`, `DIFF(<labels>)`, or
    `unstable` when the plain arms disagree.

Needs the engine (a run the user makes — see *Verification*):

11. Three plain runs of `panel=text-metrics&drive=update:24,theme:1,update:24`
    agree on every label in every unit of every phase.
12. Three plain runs of `panel=table-rows&drive=wheel,settle:4` agree on every
    label in every unit of the `settle` phase.
13. Three plain runs of `panel=treetable-rows&drive=key,settle:4` agree on
    every label in every unit of the `settle` phase.
14. Each `settle` phase's note reports it stabilised well inside the cap.

---

## Verification

**Offline, from the repository root:**

```sh
npm run build:lib
npm -w packages/qa run typecheck
npm -w packages/qa run test
```

Behaviours 1–10 are covered by `tests/drivers.test.ts`,
`tests/drivers.dom.test.ts`, `tests/pageTargets.test.ts`, `tests/fonts.test.ts`
and `tests/qaAb.test.ts`.

**In the engine — one sitting, nine runs, for the user to make.** Every run
opens a full-screen window and holds it until it ends; do not start these
without the user's go-ahead. From the repository root, with the arm built:

```sh
for r in a b c; do
  packages/qa/runqa.sh qpd-tmu-plain-$r main 'panel=text-metrics&drive=update:24,theme:1,update:24&work=1&seam=1&geom=1'
done
for r in a b c; do
  packages/qa/runqa.sh qpd-trw-plain-$r main 'panel=table-rows&drive=wheel,settle:4&work=1&seam=1&geom=1'
done
for r in a b c; do
  packages/qa/runqa.sh qpd-ttk-plain-$r main 'panel=treetable-rows&drive=key,settle:4&work=1&seam=1&geom=1'
done

for cell in tmu trw ttk; do
  python3 packages/qa/bin/qa-ab.py packages/qa/results "qpd-$cell-"
done
```

Each cell prints one plain line per phase. The pass criteria:

| Cell | Phase | Required plain line |
|---|---|---|
| `qpd-tmu-` | all three | `geom =` |
| `qpd-trw-` | 1 (`settle ×4`) | `geom =` |
| `qpd-ttk-` | 1 (`settle ×4`) | `geom =` |

Phase 0 of `qpd-trw-` and `qpd-ttk-` is the burst and is expected to read
`unstable(…)`; the labels it names are the ones a later sweep takes out of that
phase with `--allow-diff <label>@0`. A `settle` phase that reads `unstable(…)`
means the page had not come to rest, and the plan has not landed.

Also check each report's `notes` for its `settle: stable after <n> frames`
line: `n` well under 120 confirms the wait ended on the page settling rather
than on the cap.

---

## Documentation Impact

`packages/qa/README.md` only; the QA app exports nothing to the library's API
docs.

- **Built-in drivers** table — a `settle` row after `idle`: target *any defined
  value; ignored*; per unit *nothing, as `idle` — but before the first unit it
  waits, unmeasured, until every probed rectangle has been unchanged for two
  frames, so every unit is a settled sample; it fails the run after 120 frames
  of movement*.
- The paragraph after that table lists the drivers that add a note (`hover`,
  `park`, `type`, `theme`); add `settle` and what its note says.
- **Panels** — under *A store-backed panel waits for its view*, a sibling
  paragraph **A font-sensitive panel waits for the faces**: what `Body.init`'s
  startup wait covers, why a lazily fetched subset falls outside it, that a
  plain `Text` re-measures only when a layout pass next asks for its size, and
  that `text-metrics` therefore awaits `awaitFontsSettled` and calls
  `root.doLayout()` in its `afterMount`. Update the `text-metrics` row's
  *Drivers and parameters* cell to say its `afterMount` waits for the fonts.
- **Analysers** — the sample output block gains `  geom =` on the plain line;
  the sentence beginning "When the plain reports disagree among themselves"
  gains "…and the plain line reads `unstable(<labels>)`, naming them; a cell of
  three plain runs and no ablated arm is therefore a determinism check on the
  panel itself."
- **Measurement rules** — a new bullet: **Gate a burst on its settled state.**
  A mid-burst rectangle is not a soundness signal — a candidate that defers
  work inside a burst differs there by design, and a burst whose timing drives
  the layout (an eased wheel scroll) differs there between two runs of one
  build. End such a phase with `settle:<n>` and read the gate on that phase,
  taking the burst phase's moving labels out with `--allow-diff <label>@0`.
  Cite `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`'s
  *G22 unblocked* section.

---

## Potential Challenges

- **jsdom reports every rectangle as zero**, so a `settle` test cannot let real
  layout drive the samples — step 6 overrides `getBoundingClientRect` on the
  probed element with a `vi.fn` returning a scripted sequence.
- **jsdom's `document.fonts` may be absent or a stub** — `awaitFontsSettled`
  skips the wait when it is absent, and `tests/fonts.test.ts` substitutes its
  own stub per case and restores the original in `afterEach`.
- **The geometry probe is module state in `probes.ts`** — a test that calls
  `setGeometryTargets` must clear it with `setGeometryTargets(null)` afterwards,
  or the next file's runs sample stale targets.
- **`settle` fails the run when the page never rests** — that is the intent, and
  it matches `park`'s "the element moved during the measured units" failure. A
  panel with a permanent animation (`canvas-idle`) uses `idle`, not `settle`.
- **`text-metrics` gains an `afterMount`, so `mountPanel` runs its `settled()`
  wait a second time** — one extra second per run of that panel, paid by every
  arm equally.

---

## Critical Files

- [packages/qa/src/harness/drivers.ts:371](packages/qa/src/harness/drivers.ts#L371)
  and [:890](packages/qa/src/harness/drivers.ts#L890) — `idle`, which `settle`
  extends, and `key`, the precedent for an unmeasured settling lead-in inside
  `tools.suspendCounting`.
- [packages/qa/src/harness/probes.ts:36](packages/qa/src/harness/probes.ts#L36) —
  `sampleGeometry` and `sampleTarget`, which the new wait reuses without
  recording.
- [packages/qa/src/harness/run.ts:347](packages/qa/src/harness/run.ts#L347) —
  `drivePhase`: it sets the geometry targets *before* calling the driver, which
  is what lets `settle` watch them.
- [packages/qa/src/builders/store.ts:85](packages/qa/src/builders/store.ts#L85)
  and [packages/qa/tests/store.test.ts:144](packages/qa/tests/store.test.ts#L144) —
  the panel-level wait `awaitFontsSettled` and its tests are modelled on.
- [packages/qa/src/panels/text-metrics.ts:40](packages/qa/src/panels/text-metrics.ts#L40) —
  `MOUNT_STRINGS`, whose row 9 is the only Latin-Ext string in the panel.
- [packages/lib/src/typescript/lib/component/input/Text.ts:567](packages/lib/src/typescript/lib/component/input/Text.ts#L567) —
  `needsMeasure`: a `Text` re-measures lazily, "the next time a caller actually
  asks for a size". Read only; nothing here changes.
- [packages/lib/src/typescript/lib/core/SmoothScroller.ts:146](packages/lib/src/typescript/lib/core/SmoothScroller.ts#L146) —
  `scrollBy` and `step`, the eased wheel loop. Read only.
- [packages/qa/bin/qa-ab.py:664](packages/qa/bin/qa-ab.py#L664) — `print_phase`.
- `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`, section
  *G22 unblocked: the tree table's focused cell (2026-09-24)* — the settled-gate
  rule this plan implements.

---

## Non-Goals

- **No library change.** The eased wheel scroll and the lazy font subset are
  the library behaving as designed; the sweep's own record calls the
  `text-metrics` failure "a QA app defect, not a library one".
- **No change to any panel's `defaultDrive`.** `table-rows` keeps `wheel` and
  `treetable-rows` keeps `toggle`; the settle phase is named by the cell's
  `drive=`, exactly as G22's cells already named `drive=resize,idle:4`.
- **No re-run of `sweeps/w3-0.sh`.** That script is the record of a sweep that
  happened; the confirmation runs above stand on their own, and the cells a
  later sweep re-measures are that sweep's business.
- **No change to `bin/qa-table.py`.** Its `geom` column is a fixed-width `=`/
  `DIFF` against the first report and reads a `settle` phase correctly as it
  stands.
- **No new report field.** `PhaseReport` and `schema: 1` are untouched: a
  `settle` phase is an ordinary phase whose samples happen to be settled, so
  every existing reader gains the settled gate without knowing about it.

---

## Notes

[^library-untouched]: Both root causes are library behaviour working as
    designed. `SmoothScroller`'s ease is the wheel path the `trw` cell exists
    to measure, and `Text`'s lazy re-measurement is a deliberate replacement
    for a per-instance theme subscription (its own `@remarks` says so). The
    W3.0 implementation record reaches the same conclusion for the panel:
    "This is a QA app defect, not a library one, and it is owed a fix"
    (`plans/research/render-review-2026-09-15/97-w3-implementation-measurement.md`,
    *The `text-metrics` panel's first update phase is not deterministic*).

[^harness-not-analyser]: The alternative was a `--settled` option in
    `bin/qa-ab.py` that compares only the last unit of a named phase. It was
    rejected because the geometry series is read by more than one reader:
    `qa-table.py`'s `geom` column compares whole phases, and several plans ship
    their own `--read` script. A settled series in the report serves all of
    them; an option in one analyser serves one. A `settle` phase also costs
    nothing to a reader that does not know about it, whereas an analyser flag
    has to be remembered at every call site.

[^net-zero]: The `wheel` driver's triangle nets to zero: `triangleStep` gives
    +40 px for the first half of the units and −40 px for the second, so 150
    units scroll 3,000 px down and 3,000 px back, and `SmoothScroller` clamps
    only at the ends, which the phase never reaches at 10,000 rows. The row
    pool returns with it: `VirtualRowView.alignPoolWindow` rotates the pool
    arrays by the change in the window's first row, and those changes telescope
    to the difference between the last window start and the first — zero — so
    the net rotation is a whole number of pool lengths, which is the identity.
    Pool slot 0 therefore holds record 0 again, and `.TableBody .StringCell`,
    which resolves to the first pool cell in document order, reads the
    rectangle it read at mount. The same argument covers `treetable-rows`' key
    phase: 150 units alternate ArrowDown and ArrowUp from a row that is visible
    at the top of a fully expanded tree, so 75 moves each way leave the anchor
    where it started and nothing scrolls.

[^font-race]: The chain, from the library's own source. `ensureFontLoaded`
    injects the `@font-face` rules for two subsets, Latin and Latin-Ext, then
    calls `startFontLoad`, which fetches with a single space as its sample text
    — the Latin subset alone.
    [`Body.init`](packages/lib/src/typescript/lib/core/Body.ts#L140) awaits
    [`whenFontActivated`](packages/lib/src/typescript/lib/core/FontActivation.ts#L56),
    which settles on the first batch to finish, so the mount proceeds with only
    Latin active. Rendering `Łódź` then starts the Latin-Ext fetch, whose own
    `loadingdone` runs
    [`ThemeManager.onFontsSettled`](packages/lib/src/typescript/lib/core/Theme.ts#L1485)
    → `reflowText`, which bumps the text-metrics generation and notifies the
    theme listeners. A plain `Text` is not among them: it compares its own
    generation lazily, "the next time a caller actually asks for a size"
    ([Text.ts:567](packages/lib/src/typescript/lib/component/input/Text.ts#L567)).
    Nothing asks, so the mount layout keeps whichever width it measured. The
    evidence matches this and nothing else: the difference is confined to unit
    0 of the *first* `update` phase — the only probe taken before any layout
    pass of the phase has run — to widths, to row 9, and it falls on plain and
    ablated arms alike.

[^panel-not-harness]: A font wait at the harness's phase start was considered
    and rejected. Every other panel's text is Basic Latin, which
    `startFontLoad` preloads and `Body.init` already waits for, so a wait in
    the harness would slow every run to fix one panel — and it would hide a
    cost worth measuring, since a first frame that is font-bound is a real
    thing for a panel to show. `root.doLayout()` beside the wait is the other
    half and cannot move into the harness at all: it is the panel's own root,
    and it is exactly what the panel's `passes` target already does to it.

[^plain-line]: `read_arm` keeps its boolean `unstable` parameter and its
    `unstable` reading unchanged, so no arm line moves. Putting the labels on
    the plain line rather than on every arm line says them once, keeps the arm
    lines aligned, and covers the case the arm lines cannot: a cell run with no
    ablated arm at all, which is what a determinism check on a panel is.
