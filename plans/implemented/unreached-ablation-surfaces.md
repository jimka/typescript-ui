---
touches-shared:
  - packages/qa/src/harness/ablations.ts
  - packages/qa/tests/ablations.test.ts
  - packages/qa/tests/mount.test.ts
  - packages/qa/README.md
  - plans/research/render-review-2026-09-15/00-post-campaign-agenda.md
---

# Surfaces for the two unreached ablations — Implementation Plan

## Overview

Two registered ablations have never produced a reading on the panel built for
them. This plan builds the missing instrument for each, as two separable parts
with one scored cell each, so one can be measured even if the other proves
harder.

**Part one — `g16.scroll-reads`.** The arm skips a scroll-shadow overlay resize
whose size and gutter did not change, and serves repeated scroll-metric reads
from a per-task memo. It scored `unreached` on `scroll-panes`
([`00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md),
*First measurements of G16, G25 and G27*). The panel's panes do have live scroll
shadows, and the ablation does reach them; what the panel has no phase for is a
*scroll* that the framework itself performs. The framework's scroll-shadow
path — the two methods the arm patches and the reads inside them — is reachable
only from a scroll event: `resizeScrollShadowOverlay` has one caller,
`updateScrollShadows`
([`packages/lib/src/typescript/lib/core/Panel.ts:1499`](packages/lib/src/typescript/lib/core/Panel.ts#L1499)),
and that method is called only from `init`, from `refreshScrollShadows`, and
from the subtree `scroll` listener
([`Panel.ts:1351`](packages/lib/src/typescript/lib/core/Panel.ts#L1351)). The
pass-driven `remeasureScrollMetrics` calls neither
([`Panel.ts:1150`](packages/lib/src/typescript/lib/core/Panel.ts#L1150)), so no
`passes` phase can ever engage this arm, and the panel's `wheel` phase is a
synthetic `WheelEvent` whose scroll depends on the framework's eased wheel
controller landing a write.[^why-unreached] `scroll-panes` gains a `call` target
that walks the panes through a fixed ladder of absolute `scrollTop` values, and
two witnesses that say whether the scroll-shadow path ran.

**Part two — G12's F06.3.** F06.3 is the no-op drag-frame gate on
`Split.onDrag`: a drag frame whose clamp leaves both panes where they were still
lays both out again, and the gate skips the layout of a pane the frame left in
place. The record's reason for "never measured" is stale. `shell-deep` and
`shell-shallow` already expose a `park` target, and it already parks a `Split`
gutter against the sidebar's minimum-width clamp
([`packages/qa/src/builders/shell.ts:316`](packages/qa/src/builders/shell.ts#L316)).
F06.3 *was* measured, in W3.0's cells `sdp` and `ssp`: engaged, geometry
identical, work −93.8% and −93.4%, and the clock +3.28 and +4.27 ms
([`96-w3-0-bounding-sweep.md:181`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L181)).
The co-run `split.recalc-gate` arm, which avoided no work at all in the same
cell, also read +3.52 ms
([`:187`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L187)),
so that park cell charges about 3.4 ms to *any* runtime patch on that path. What
F06.3 lacks is therefore not a park target but a control: an arm carrying the
patch's own cost and removing none of the work. This plan adds one,
`split.noop-control`, built from the same code as `split.noop-drag` so it cannot
drift from it.

Everything lands in `packages/qa` — one panel, one new ablation, the package's
own vitest suite and `README.md` — plus two one-sentence corrections to the
campaign's agenda. No library file changes. This plan runs no measurement: both
cells are written up in `## Verification` as steps for the user to run.

---

## Architecture Decisions

### Part one drives the scroll from a `call` ladder, not from a wheel

`scroll-panes` gains a `call` target that writes an absolute `scrollTop` to each
of its panes once per unit, walking a triangle from 0 to that pane's own
scrollable span and back. It mirrors `markdown-doc`'s ladder
([`packages/qa/src/panels/markdown-doc.ts:192`](packages/qa/src/panels/markdown-doc.ts#L192)),
which the campaign built for the same reason: a wheel's landing positions depend
on elapsed time, so no two runs visit the same offsets.[^ladder-not-wheel]

| Unit index | 0 | 6 | 12 | 18 | 24 |
|---|---|---|---|---|---|
| `scrollTop` written to a scrolled pane | 0 | `span / 2` | `span` | `span / 2` | 0 |

### The ladder leaves pane 1 alone, and pane 0 gains a moving probe

The ladder skips pane 1 and writes to every other pane, so the existing `pane1`
and `row1` labels stay still and keep their present meaning. A new label `row0` —
pane 0's first row — moves with the ladder, deterministically, and is the probe
that says the arm changed nothing on screen while the panes scrolled.[^still-pane]

### Part one's cell measures the read half and cannot speak to the paint half

`g16.scroll-reads` removes DOM reads and one no-op size write. It does not
remove the shadow overlay, its four edge strips, or their `box-shadow` layers,
so the cell says nothing about the per-frame rasterisation cost a consuming app
traced to that cue. A paint-side candidate is a different change measured with a
different instrument, and is a `## Non-Goals` bullet here.[^read-not-paint]

### Part one needs no new panel and no new parameter

A `call` target on `scroll-panes` is the whole surface. The panel already has
subclassed panes that pay every layout pass, content that overflows, `autoScroll:
'y'`, and the default `scrollbarStyle: "overlay"` — which is what makes the
scroll-metric memo able to hit at all, because a single scroll event runs two
listeners over the same inner scroller inside one task.[^no-new-panel]

### Part one proves its premise with two witnesses before the arm is read

`installWork` gains `pane.shadowUpdate`, one count per `updateScrollShadows`
entry, and `describe()` gains `ladderPanes`, the number of panes the ladder
actually writes to. Together with the existing `pane.scrollTick` they separate
"the scroll-shadow path never ran" from "it ran and the arm still saved nothing"
— the distinction the `unreached` reading could not make. This follows the
precedent panel's own rule that a surface proves its premise before its arm is
read
([`plans/implemented/qa-surfaces-for-stalled-candidates.md:26`](plans/implemented/qa-surfaces-for-stalled-candidates.md#L26)).

### Part two adds a control arm rather than a second park target

`split.noop-control` patches `Split.prototype.onDrag` exactly as
`split.noop-drag` does, pays the same per-frame bookkeeping, and always
delegates. The gate's own time is then `mean(split.noop-drag) −
mean(split.noop-control)`, with the instrument's cost cancelled.[^control-arm]

### Both arms are built from one helper, so the control cannot drift

`splitNoopDrag`'s body
([`packages/qa/src/harness/ablations.ts:394`](packages/qa/src/harness/ablations.ts#L394))
moves into a shared `splitDragGate(tools, name, prefix, what, skip)`, and both
registry entries call it. Rewriting a `split.*` ablation in place is the
precedent's own move
([`plans/implemented/w3-0-bounding-sweep.md:68`](plans/implemented/w3-0-bounding-sweep.md#L68)).[^shared-gate]

### The control's counter uses the `dose.` prefix

`dose.split.noop-control.wouldSkip` counts each frame where `split.noop-drag`
would have skipped. `dose.` keeps the count out of `work/u`, so the control's
`work` verdict reads `flat` — which is the statement that it removes nothing —
and makes `qa-ab.py` label the arm `dose` rather than scoring it as a candidate
([`plans/implemented/w3-0-bounding-sweep.md:132`](plans/implemented/w3-0-bounding-sweep.md#L132)).

### Both verdict rules put render time first and never let a flat clock retire a work reduction

The campaign's standing rule, set 2026-09-26: render performance is the primary
priority and reduced work is secondary, but a work reduction with a flat clock is
still worth shipping unless it costs considerable code complexity
([`00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md),
*Judged again*). So each cell's table has a row for `ms flat` with `work win`,
and that row reads **plan it** — with the gate's code cost named, since
complexity is the only thing that may overrule it.

### Both cells carry the same two protections against session drift

Each cell runs one discarded warm-up run first, named outside the cell's prefix
so no analyser sees it, and each cell's three plain arms are read for a
monotonic trend before any verdict is taken. Both remedies come from readings
this campaign had to throw away.[^drift]

---

## Public API

### `packages/qa/src/panels/scroll-panes.ts` (modified)

The four module exports are unchanged in name and type — the panel-contract test
in [`packages/qa/tests/panels.test.ts:66`](packages/qa/tests/panels.test.ts#L66)
requires exactly `build`, `defaultDrive`, `defaultScale`, `description`, so the
ladder stays internal. `defaultDrive` keeps its present value,
`'passes,wheel,idle:4'`, so the recorded `passes`-phase reading still describes
the panel's default. `description` gains a sentence naming the ladder.

| Part | Change |
|---|---|
| `afterMount` | becomes `async`; measures each pane's scrollable span, waits `LADDER_SETTLE_FRAMES`, and adds `call: <the ladder>` beside its existing `wheel` |
| `geometry` | adds `row0`, pane 0's first `Text` |
| `describe()` | adds `ladderPanes` |
| `installWork` | adds `tools.countMethod(panes[0], 'updateScrollShadows', 'pane.shadowUpdate')` |

### `packages/qa/src/harness/ablations.ts` (modified)

```typescript
export const ABLATIONS: Record<string, Ablation>;   // gains 'split.noop-control'
```

| Ablation | Counter | Meaning |
|---|---|---|
| `split.noop-drag` | `skipped.split.noop-drag.paneLayout` | one pane layout skipped because the frame left it in place (unchanged) |
| `split.noop-control` | `dose.split.noop-control.wouldSkip` | one pane layout `split.noop-drag` would have skipped, run anyway |

---

## Internal Structure

### The scroll ladder (`scroll-panes`)

Module constants, mirroring `markdown-doc`'s:

```typescript
/** Past any pane's end: written once per pane to read the browser-clamped maximum back. */
const LADDER_PROBE_PX = 10_000_000;

/** Units per lap: one second of units at 60 Hz, and a divisor of the cell's 144. */
const LADDER_PERIOD = 24;

/** The unit a lap peaks on: the top of the triangle, half a lap from either end. */
const LADDER_HALF = LADDER_PERIOD / 2;

/** Frames the span probe's writes are given to settle before the first phase. */
const LADDER_SETTLE_FRAMES = 2;

/** The pane the ladder leaves at rest, so the `pane1` and `row1` labels do not move. */
const UNSCROLLED_PANE = 1;
```

The span probe, run once per pane in `afterMount`, needs no DOM lookup:
`setScrollTop` writes the native offset and reads the browser-clamped result
back
([`Component.setScrollTop`](packages/lib/src/typescript/lib/core/Component.ts#L4967)).

```typescript
pane.setScrollTop(LADDER_PROBE_PX);
const span = pane.getScrollTop();   // the clamped maximum
pane.setScrollTop(0);
```

The target itself:

```typescript
function scrollLadder(panes: readonly Component[], spans: readonly number[]): CallTarget {
    return function ladderStep(index: number): void {
        const step = index % LADDER_PERIOD;
        const fraction = step <= LADDER_HALF ? step / LADDER_HALF : (LADDER_PERIOD - step) / LADDER_HALF;

        for (let k = 0; k < panes.length; k++) {
            if (k !== UNSCROLLED_PANE && spans[k] > 0) {
                panes[k].setScrollTop(Math.round(fraction * spans[k]));
            }
        }
    };
}
```

### What one scroll tick costs, and what the arm removes

Per pane, per scroll event, in the default overlay mode. Both subtree `scroll`
listeners run inside the one event dispatch, so the per-task memo covers both.

| Call | Handle read | Plain | Under the arm |
|---|---|---|---|
| `syncOverlayScrollbars` → `getScrollMetrics` | inner scroller | 1 read | 1 read |
| `updateScrollShadows` → `getScrollMetrics` | inner scroller | 1 read | memo hit (`metricsHit`) |
| `resizeScrollShadowOverlay` → `getScrollMetrics` | panel element | 1 read | skipped (`shadowResize`) |
| **cell counter** `getScrollMetrics − metricsHit` | | **3** | **1** |

### The shared drag gate (`ablations.ts`)

```typescript
function splitDragGate(tools: HarnessTools, name: string, prefix: OwnCounterPrefix, what: string, skip: boolean): string;
```

Its body is today's `splitNoopDrag` verbatim, with one change inside the
per-pane replacement, whose builder `skipLayoutIfUnmoved` is renamed
`gateUnmovedLayout` because it no longer always skips: when the pane's rectangle
still equals the snapshot, the replacement bumps `prefix.name.what`, then
returns `self` if `skip` and delegates if not. Everything else — the
`_gutters.indexOf`, the `getLaidOutComponents`, the `withOwnMethodOnEach` install
and restore, the `rectOf` snapshot, the `sameValues` compare, the guard that
delegates when either pane is missing — is shared, so the control pays it too.

| Registry entry | `prefix` | `what` | `skip` |
|---|---|---|---|
| `split.noop-drag` | `skipped` | `paneLayout` | `true` |
| `split.noop-control` | `dose` | `wouldSkip` | `false` |

---

## Ordered Implementation Steps

Steps 1–5 are part one, steps 6–8 part two, steps 9–11 shared. The two parts
touch disjoint source files and can be implemented in either order.

1. **`packages/qa/src/panels/scroll-panes.ts` — add the ladder's constants and
   the `scrollLadder` function.** Place the five constants after `ROWS_PER_PANE`
   and the function after `countScrollTicks`, exactly as `## Internal Structure`
   gives them. Add `CallTarget` to the existing type import from
   `../harness/types.js`. Export neither the constants nor the function: the
   panel-contract test requires exactly the four existing exports.

2. **`scroll-panes.ts` — make `afterMount` measure the spans and return the
   `call` target.** Declare `let ladderSpans: number[] = [];` inside `build`,
   before the `return`. Change `afterMount` to an `async` arrow returning
   `Promise<Record<string, unknown>>`, which:
   - assigns `ladderSpans = panes.map(...)` using the three-line span probe;
   - `await tools.waitFrames(LADDER_SETTLE_FRAMES);`
   - returns `{ wheel: elementFor(tools, panes[0], PANEL), call: scrollLadder(panes, ladderSpans) }`.

3. **`scroll-panes.ts` — add the `row0` label and correct the geometry
   comment.** Add `row0: panes[0].getComponents()[0]` to the `geometry` object
   literal beside `pane0`. The comment above that literal (lines 94–98) says no
   phase scrolls pane 1 and that no label sits on scrolled content; rewrite it
   to say that the ladder leaves pane 1 alone so `pane1` and `row1` hold still,
   and that `row0` does move — by an absolute offset every run repeats, which is
   what a wheel could not promise.

4. **`scroll-panes.ts` — add the two witnesses.** In `describe()`, add
   `ladderPanes: ladderSpans.filter((span, k) => k !== UNSCROLLED_PANE && span > 0).length`.
   In `installWork`, add
   `tools.countMethod(panes[0], 'updateScrollShadows', 'pane.shadowUpdate')`
   to the returned array. Both carry a doc comment saying what a zero means.

5. **`scroll-panes.ts` — extend `description`.** Append one sentence: the panel's
   `call` driver steps every pane but pane 1 through a fixed ladder of absolute
   offsets, which is the only phase that reaches the framework's scroll-shadow
   path. Cheap checks:
   `grep -n "defaultDrive" packages/qa/src/panels/scroll-panes.ts` — the value is
   still `'passes,wheel,idle:4'`; and
   `grep -cn "^export " packages/qa/src/panels/scroll-panes.ts` — still 4.

6. **`packages/qa/src/harness/ablations.ts` — extract the shared gate.** Rename
   `splitNoopDrag` to `splitDragGate` and give it the signature in
   `## Internal Structure`. Rename `skipLayoutIfUnmoved` to `gateUnmovedLayout`,
   give it `prefix`, `what` and `skip` as extra parameters, and replace its single
   `bump(tools, 'skipped', name, 'paneLayout')` plus early return with
   `bump(tools, prefix, name, what)` followed by a return of `self` when `skip`
   and `delegate(self, args)` when not. Thread the three parameters through from
   `splitDragGate`. The returned note becomes
   `` `Split.onDrag ${skip ? 'skips' : 'still runs'} the layout of a pane the frame left in place` ``.
   Update both JSDoc blocks to describe the two uses.

7. **`ablations.ts` — register both entries.** Replace the `'split.noop-drag'`
   entry with
   `'split.noop-drag': (tools) => splitDragGate(tools, 'split.noop-drag', 'skipped', 'paneLayout', true),`
   and add
   `'split.noop-control': (tools) => splitDragGate(tools, 'split.noop-control', 'dose', 'wouldSkip', false),`
   directly below it, following the `g09.all` / `g09.chrome` pair's shape.
   Cheap check: `grep -n "split.noop" packages/qa/src/harness/ablations.ts` —
   expect exactly the function, its JSDoc, and the two registry lines.

8. **`packages/qa/tests/ablations.test.ts` — add the control's check beside
   A3.** A new `describe('A3b split.noop-control')` reusing `splitFixture()`
   (`:257`), asserting the behaviours in `## Expected Behaviour` cases 7–9.

9. **`packages/qa/tests/mount.test.ts` — extend the `P16 scroll-panes` block.**
   Add the cases in `## Expected Behaviour` 1–6. The existing case *labels a row
   of a pane no phase scrolls* stays green unchanged, and is what pins step 3's
   decision. Reuse the file's existing `snapshotPatchables` /
   `restorePatchables` guard around any `installWork` call — one snapshot of
   `tools.ownerProto(pane0, 'remeasureScrollMetrics')` covers `updateScrollShadows`
   too, because both are own properties of the same prototype.

10. **`packages/qa/README.md` — two tables.** In the panel table's
    `scroll-panes` row: add `call` to the drives column with what it does, add
    `pane.shadowUpdate` and `ladderPanes` to the counters and `before.host`
    text, and add `row0` to the labels column. In the ablation table
    (`:472`–`:482`), add a `split.noop-control` row below `split.noop-drag`.

11. **`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md` — two
    corrections.** Replace the sentence "`g16.scroll-reads` never engaged on this
    surface and is still unmeasured." with the corrected record in
    `## Documentation Impact`, and correct the Phase 3 bullet's claim that F06.3
    "was never measured because Loom's drag never parks against a clamp". Do not
    add the cells' results: they do not exist yet.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/qa/src/panels/scroll-panes.ts` |
| Modify | `packages/qa/src/harness/ablations.ts` |
| Modify | `packages/qa/tests/mount.test.ts` |
| Modify | `packages/qa/tests/ablations.test.ts` |
| Modify | `packages/qa/README.md` |
| Modify | `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md` |

Four of these are shared with plans implemented in the same batch.
`packages/qa/src/harness/ablations.ts` and `packages/qa/tests/ablations.test.ts`
are touched by both `plans/table-row-filter-panel.md` and
`plans/platform-call-cost-sweep.md`; `packages/qa/README.md` by both; and
`packages/qa/tests/mount.test.ts` and the agenda by
`plans/table-row-filter-panel.md`. Every edit here is an addition at a named
site — a new registry entry, a new `describe` block, a new table row — so the
three plans can land in any order, resolving additions rather than rewrites.

---

## Expected Behaviour

Cases 1–9 are unit-testable offline. Cases 10–13 need the desktop runs in
`## Verification` and cannot be tested.

Cases 1–5 all need the same setup, which the ladder precedent's own tests
already use (`mount.test.ts`, *P18 markdown-doc scroll ladder…*): jsdom lays
nothing out, so a pane's clamped read-back would be 0 and the ladder would write
nothing. `vi.spyOn(DOM.source, 'getScrollTop').mockReturnValue(SPAN)` — the read
`setScrollTop` takes its clamped result from — gives every pane a span, and the
offsets are then arithmetic. **The stub must be installed before `mountPanel`**,
because the spans are measured in `afterMount` and held for the run. The
assertions read `vi.spyOn(pane, 'setScrollTop')` rather than a pane's offset,
because jsdom's own `scrollTop` is not a layout value — and that spy is installed
*after* mounting, so the span probe's own three writes per pane are not counted.

Every case below mounts at the file's own `SMOKE_SCALE`, 3, so the board has
panes 0, 1 and 2 and pane 1's exclusion is visible.

1. **The ladder walks a triangle of absolute offsets.** With `SPAN` stubbed to an
   even number, driving the target at units `0, 6, 12, 18, 24` writes
   `0, SPAN / 2, SPAN, SPAN / 2, 0` to pane 0, in that order.
2. **The ladder is periodic.** Units `k` and `k + 24` write the same offset, for
   `k` in `0…24`.
3. **The ladder leaves pane 1 at rest.** Over a whole lap, `setScrollTop` is
   never called on `panes[1]`, while panes 0 and 2 each receive the triangle.
4. **A pane that cannot scroll is not written.** With `getScrollTop` stubbed to
   0, `describe().ladderPanes` is 0, no unit calls `setScrollTop` on any pane,
   and no unit throws.
5. **`describe().ladderPanes` counts the panes the ladder writes.** At `n = 3`
   with a non-zero span, `ladderPanes` is 2 — pane 1 is excluded.
6. **`row0` is pane 0's first row, and `row1` is still pane 1's.** At `n > 1`,
   `panes[0].getComponents()` contains `geometry.row0` and not `geometry.row1`.
7. **`split.noop-control` counts what `split.noop-drag` would have skipped.**
   On the `splitFixture()` split, after applying `split.noop-control`,
   `onDrag(container, gutter, 0)` raises `dose.split.noop-control.wouldSkip` 2
   and raises no `skipped.split.noop-drag.paneLayout`.
8. **`split.noop-control` skips nothing.** With `vi.spyOn(lhs, 'doLayout')` and
   `vi.spyOn(rhs, 'doLayout')` installed before the call — own properties the
   ablation's stand-in delegates to — the same `onDrag(container, gutter, 0)`
   calls each of them. A drag that moves the panes,
   `onDrag(container, gutter, 20)`, raises no `wouldSkip` and leaves the first
   pane 20 px wider, as A3 asserts for the candidate.
9. **`split.noop-control` leaves no own `doLayout` behind.** In a case with no
   spy installed, after its `onDrag` returns `Object.hasOwn(lhs, 'doLayout')` and
   `Object.hasOwn(rhs, 'doLayout')` are both `false`, as A3 already asserts for
   `split.noop-drag`.
10. **The `call` phase runs the scroll-shadow path.** In cell `spc`'s plain arms,
    `pane.shadowUpdate@ScrollPane` is about `n − 1` per unit of the `call` phase
    and `pane.scrollTick` at least 1.
11. **The arm engages on the `call` phase.** Both
    `skipped.g16.scroll-reads.shadowResize` and
    `memo.g16.scroll-reads.metricsHit` are at least 1 per unit in both arm
    repetitions.
12. **The arm does not engage on the `passes` phase**, in either repetition:
    `remeasureScrollMetrics` calls neither patched method. That is the shape of
    the cell, not a finding.
13. **`split.noop-control` and `split.noop-drag` agree on the population.** In
    cell `sdp`, `dose.split.noop-control.wouldSkip` and
    `skipped.split.noop-drag.paneLayout` are both about 2.00 per unit and within
    1% of each other. If they differ, the control is not a control and the
    cell says nothing.

---

## Verification

```sh
npm -w packages/qa run typecheck
npm -w packages/qa run test
```

Then, by eye, with no window of its own: `npm -w packages/qa run dev` and open
`http://localhost:5190/?panel=scroll-panes`. Every pane must show a scrollbar or
a shadow edge.

The two cells below each open a full-screen window per run and must be run by
the user. Each is one sitting; no comparison crosses a cell. `FLAGS` is the
sweep's instrument set, and every run of a cell carries it.

```sh
FLAGS='work=1&seam=1&geom=1'
```

### Cell `spc` — part one, `g16.scroll-reads`

```sh
P='panel=scroll-panes&drive=passes,call:144,idle:4'
packages/qa/runqa.sh w6a-warm-spc-0            main "$P&$FLAGS"
packages/qa/runqa.sh w6a-spc-plain-a           main "$P&$FLAGS"
packages/qa/runqa.sh w6a-spc-g16.scroll-reads-1 main "$P&$FLAGS&abl=g16.scroll-reads"
packages/qa/runqa.sh w6a-spc-plain-b           main "$P&$FLAGS"
packages/qa/runqa.sh w6a-spc-g16.scroll-reads-2 main "$P&$FLAGS&abl=g16.scroll-reads"
packages/qa/runqa.sh w6a-spc-plain-c           main "$P&$FLAGS"

python3 packages/qa/bin/qa-table.py packages/qa/results w6a-spc- --work \
    --before host.scrollablePanes,host.ladderPanes,host.maxScrollTop0
python3 packages/qa/bin/qa-ab.py packages/qa/results w6a-spc- \
    --counter 'seam.source.getScrollMetrics - work.memo.g16.scroll-reads.metricsHit'
```

`w6a-warm-spc-0` is a discarded warm-up: its name is outside the cell prefix, so
neither script reads it. The verdict is taken from **phase 1**, the `call` phase.
144 units is six whole laps of the ladder, so every position is visited the same
number of times in every run.

Read the witnesses first, from the `--work` table:

| Witness | Required before any verdict | If it fails |
|---|---|---|
| `before.host.scrollablePanes` | equals `n` | the board does not overflow at this viewport — raise `ROWS_PER_PANE` and re-run |
| `before.host.ladderPanes` | equals `n − 1`, so 23 at this cell's `n` | a pane reported no span — same remedy |
| `pane.shadowUpdate@ScrollPane` per `call` unit | about `n − 1` | the scroll-shadow path never ran; the surface is still wrong and no verdict is available |
| `pane.scrollTick` per `call` unit | at least 1 | as above |

Then the verdict, pre-registered. `bracket` is the largest plain average minus
the smallest over the cell's three plain arms, and `ms` / `work` / `geom` /
`engaged` are `qa-ab.py`'s own columns.

| Reading on phase 1 | Verdict |
|---|---|
| the witnesses hold, `engaged` is not `yes` | **drop** G16's scroll half: the path runs and neither sub-patch can fire on it |
| `geom` is `DIFF` or `unstable` | **drop** G16's scroll half, and record the unsoundness — nothing here is deferred, so a moved rectangle is a wrong one |
| `engaged yes`, `geom =`, `ms win` | **plan it** |
| `engaged yes`, `geom =`, `ms flat`, `work win` | **plan it** — a real reduction in DOM reads with a flat clock, and the gate is a four-value signature compare plus a per-task memo, the shape `border-region-size-memo` already ships |
| `engaged yes`, `geom =`, `ms flat`, `work flat` | **drop**: no reads removed and no time |
| `engaged yes`, `geom =`, `ms regress` | no verdict — the arm's own bookkeeping is being timed, and G16's scroll half then needs a `wt` arm: a second library build carrying the fix itself, which `runqa.sh` takes in place of `main`. That is its own plan |

There is no mid-burst `--allow-diff` here, and a `DIFF` must not be re-read as
one: the arm defers no work, so no label may move.

### Cell `sdp` — part two, G12 F06.3

Run in the recorded shape — `shell-deep` at its default `n` — so the control's
reading is directly comparable to the +3.28 and +3.52 ms on record.

```sh
P='panel=shell-deep&drive=park'
packages/qa/runqa.sh w6b-warm-sdp-0               main "$P&$FLAGS"
packages/qa/runqa.sh w6b-sdp-plain-a              main "$P&$FLAGS"
packages/qa/runqa.sh w6b-sdp-split.noop-drag-1    main "$P&$FLAGS&abl=split.noop-drag"
packages/qa/runqa.sh w6b-sdp-split.noop-control-1 main "$P&$FLAGS&abl=split.noop-control"
packages/qa/runqa.sh w6b-sdp-plain-b              main "$P&$FLAGS"
packages/qa/runqa.sh w6b-sdp-split.noop-control-2 main "$P&$FLAGS&abl=split.noop-control"
packages/qa/runqa.sh w6b-sdp-split.noop-drag-2    main "$P&$FLAGS&abl=split.noop-drag"
packages/qa/runqa.sh w6b-sdp-plain-c              main "$P&$FLAGS"

python3 packages/qa/bin/qa-table.py packages/qa/results w6b-sdp- --work
python3 packages/qa/bin/qa-ab.py packages/qa/results w6b-sdp- --counter 'work'
```

The `park` driver proves its own premise: it throws after restoring if the
gutter moved during the measured units
([`packages/qa/src/harness/drivers.ts:875`](packages/qa/src/harness/drivers.ts#L875)),
and every report's notes carry the rectangle it held. A run that did not park
fails with exit 1 and cannot be read by mistake.

Read case 13's agreement check first. Then define the gate's own time as

```
G = mean(split.noop-drag) − mean(split.noop-control)
```

Both arms are measured against the same plain arms, so the plain mean cancels
and `G` is the difference of the two arms' own means. Judge it against the plain
`bracket`.

| Reading | Verdict |
|---|---|
| `geom` `DIFF`/`unstable`, or either arm not `engaged` | no verdict — the cell failed |
| `work` is not `win` for `split.noop-drag` | **drop** F06.3: the gate skips nothing on the gesture it names |
| `G < −bracket` | **plan it** — the gate buys time once the instrument's cost is removed |
| `−bracket ≤ G ≤ +bracket`, `work win` | **plan it** under the standing rule: two whole pane layout passes a frame removed, a flat clock, and the gate is one rectangle compare per pane per frame |
| `G > +bracket` | **drop** F06.3: the gate itself costs time in the parked frame it exists to make cheap |

Two readings about the control, recorded either way:

| Control's reading | What it says |
|---|---|
| its `work` is not `flat` | it is not a control: it removed or added counted work, and `G` means nothing |
| its Δms above `+bracket` | the park cell's patch cost reproduces, and it is the instrument's, not the candidate's |
| its Δms within `±bracket` | the cost does not reproduce; `G` then equals `split.noop-drag`'s own Δms and the sweep's rule applies unchanged |

### The drift checks, for both cells

Before either verdict:

- **Cold start.** The discarded warm-up run absorbs it. One plain rep once read
  97.69 ms against 31–36 for the others in this campaign, which opened a 66.00
  bracket and made its cell unreadable.
- **Warm-up drift.** If the three plain reps are monotonic in run order and the
  bracket exceeds 10% of the plain mean, the cell measures the sitting rather
  than the arm: re-run it in a quieter one instead of reading it.
- **Interleaving.** Run each cell's lines in the order given. The order spreads
  each arm's two repetitions to opposite ends of the sitting; clustering them in
  the middle once manufactured a −2.22 ms win that vanished on a re-run.

---

## Documentation Impact

No library public API changes, so no TypeDoc page moves and
`npm run docs:api` is not part of this plan's verification.

**`packages/qa/README.md`** is the QA app's only reference. Two tables change:

- The panel table's `scroll-panes` row (`:334`): `call` joins its drives, with
  the note that it writes an absolute `scrollTop` to every pane but pane 1 and
  is the only phase that reaches the scroll-shadow path; `pane.shadowUpdate`
  joins its `work=1` counters; `ladderPanes` joins its `before.host` fields; and
  `row0` joins its labels.
- The ablation table gains a `split.noop-control` row below `split.noop-drag`
  (`:472`), reading: *the control for `split.noop-drag` — the same per-frame
  bookkeeping, no skip, so a cell can price the instrument and subtract it.*

**`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`** carries
two corrections, each replacing one sentence:

- In *First measurements of G16, G25 and G27 (2026-09-25)*, the G16 bullet's
  last sentence becomes: `g16.scroll-reads` never engaged on `scroll-panes`,
  because the panel has no phase that makes the framework scroll — W3.0 did
  measure it, reading **win** on three wheel cells (`cdw` −4.80, `sdw` −3.29,
  `ssw` −3.41 ms, counter −50%, geometry `=`;
  [`96-w3-0-bounding-sweep.md:316`](plans/research/render-review-2026-09-15/96-w3-0-bounding-sweep.md#L316)),
  at two memo hits a unit, and what is missing is a reading at a realistic
  population of scrolling panels.
- In *Phase 3 — wave 3*, the G12 bullet's claim that F06.3 "was never measured
  because Loom's drag never parks against a clamp" becomes: F06.3 was measured
  in W3.0's `sdp` and `ssp` park cells — engaged, geometry identical, work
  −93.8% and −93.4%, and 3.3 to 4.3 ms *slower* — and the record attributes the
  slowdown to the runtime patch rather than to the gate, because the
  no-work-avoided `split.recalc-gate` arm cost the same in the same cell.

---

## Potential Challenges

- **The board may still not reach the scroll-shadow path.** If
  `pane.shadowUpdate@ScrollPane` reads 0 in the plain arm, the ladder's writes
  are not producing scroll events at all, and no verdict is available. The
  witness makes that visible in the first run instead of hiding as a second
  `unreached`.
- **The ladder's first unit cannot skip.** Ablations are applied after
  `afterMount` ([`packages/qa/src/harness/run.ts:254`](packages/qa/src/harness/run.ts#L254)),
  so the span probe's scroll events do not warm the arm's signature map: unit 0
  records a signature and units 1 onwards skip. Over 144 units that is 143/144
  and changes no verdict.
- **A pane's span could differ between the probe and the phase.** The `passes`
  phase re-commits every pane at the rectangle it holds, so no span moves; if
  one did, the ladder would write a clamped offset and `row0` would still be
  deterministic.
- **`row0` is a label on scrolled content**, which the precedent forbade. It is
  safe only because the ladder writes absolute integers: if a future phase
  scrolls pane 0 by wheel, `row0` must be dropped from that cell's gates.
- **The control could diverge from the candidate** if a later edit touches only
  one of them. The shared helper makes that impossible by construction, and case
  13's 1% agreement check catches it in-engine if it happens anyway.
- **`shell-deep`'s park cell is only about 9.8 ms a unit**, so a millisecond is
  10% of it. That is why the cell needs the control rather than a bigger scale:
  changing `n` would make the control's reading incomparable with the recorded
  +3.28 and +3.52.

---

## Critical Files

- [`packages/qa/src/panels/scroll-panes.ts`](packages/qa/src/panels/scroll-panes.ts) — the panel part one extends; its `ScrollPane` comment explains why the panes are a subclass.
- [`packages/qa/src/panels/markdown-doc.ts:182-290`](packages/qa/src/panels/markdown-doc.ts#L182) — the ladder precedent: the span probe, the triangle, the async `afterMount`, the `describe()` witness.
- [`packages/qa/src/harness/ablations.ts:263-430`](packages/qa/src/harness/ablations.ts#L263) — `withOwnMethodOnEach`, `rectOf`, `sameValues`, `splitNoopDrag` and `skipLayoutIfUnmoved` — the last two renamed by step 6.
- [`packages/qa/src/harness/ablations.ts:1256-1380`](packages/qa/src/harness/ablations.ts#L1256) — `g16ScrollReads` and its three sub-patches, unchanged by this plan.
- [`packages/lib/src/typescript/lib/core/Panel.ts:1150-1205`](packages/lib/src/typescript/lib/core/Panel.ts#L1150), [`:1240-1360`](packages/lib/src/typescript/lib/core/Panel.ts#L1240), [`:1460-1510`](packages/lib/src/typescript/lib/core/Panel.ts#L1460), [`:1620-1780`](packages/lib/src/typescript/lib/core/Panel.ts#L1620) — the pass-driven re-measure, the two scroll listeners, the shadow methods, `syncOverlayScrollbars`.
- [`packages/qa/src/harness/drivers.ts:750-880`](packages/qa/src/harness/drivers.ts#L750) — the `park` driver, its target contract and its moved check; [`:1186`](packages/qa/src/harness/drivers.ts#L1186) — `DRIVERS`, where `call` and `park` are registered.
- [`packages/qa/src/builders/shell.ts:56-65`](packages/qa/src/builders/shell.ts#L56), [`:316`](packages/qa/src/builders/shell.ts#L316), [`:352`](packages/qa/src/builders/shell.ts#L352) — the sidebar's clamp, the existing `park` target, and the `Split` it parks against.
- [`plans/implemented/w3-0-bounding-sweep.md:84`](plans/implemented/w3-0-bounding-sweep.md#L84) — the scored-cell shape; [`:117-146`](plans/implemented/w3-0-bounding-sweep.md#L117) — the decision rule and the per-candidate rule; [`:415-425`](plans/implemented/w3-0-bounding-sweep.md#L415) — the two G16 arms as specified; [`:996`](plans/implemented/w3-0-bounding-sweep.md#L996) — the counter each arm is scored on.
- [`plans/implemented/qa-surfaces-for-stalled-candidates.md`](plans/implemented/qa-surfaces-for-stalled-candidates.md) — the direct precedent, including its `## Verification` cell shape.
- [`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md) — *Judged again: render time first, work second, complexity last*, the standing rule both verdict tables encode.
- [`packages/qa/tests/mount.test.ts:290-400`](packages/qa/tests/mount.test.ts#L290) and [`packages/qa/tests/ablations.test.ts:257-284`](packages/qa/tests/ablations.test.ts#L257) — the existing `P16` block and `splitFixture()`/`A3`, which the new cases extend.

---

## Non-Goals

- **The paint half of the scroll cue.** Removing or restructuring the shadow
  overlay so WebKitGTK stops rasterising a viewport-sized inset `box-shadow`
  every frame is a different change, and it needs a real engine Timeline
  recording rather than the harness's counters. Cell `spc` measures reads.
- **A `wt` prototype library arm.** Cell `spc`'s last row names the reading
  that would call for one; building it is a separate plan, and a library change
  rather than a QA-app one. For F06.3 the control arm replaces the `wt` arm
  W3.0 recommended, because it answers the same question inside one build.
- **A second `park` target, on any panel.** One exists and parks against a real
  clamp; another would re-measure the same gesture with the same confound.
- **Changing `scroll-panes`' `defaultDrive`.** The recorded `passes`-phase
  reading describes the present default, and a changed default would leave that
  record describing nothing.
- **Removing the `wheel` target from `scroll-panes`.** It stays documented and
  tested; the ladder is added beside it.
- **G12 F06.4 (`split.recalc-gate`).** Cell `sdp`'s control also prices the
  artifact that voided F06.4's cell, but F06.4's own recommendation is *drop*
  and this plan takes no position on it.
- **A scale arm for either cell.** Both cells are run at one scale, chosen for
  comparability with the record.

---

## Implementation Notes

**Step 11 was skipped: `master` already carries both corrections, in a shape
that replacing the two sentences would break.** `master` `6db01b15` ("Correct
the record: g16.scroll-reads and F06.3 were both measured in W3.0") added a
dated `## Corrections: two candidates were already measured (2026-09-26)`
section to `00-post-campaign-agenda.md`, covering the same two claims this
plan's `## Documentation Impact` prescribed and more of them. It does so by
*pointing at* the stale sentences rather than editing them — "the note above
saying so is wrong" for the G16 bullet, "The wave-2 line above saying it was
never measured for want of a clamp is stale" for F06.3. So rewriting either
sentence in place would orphan those back-references, and would also falsify
a record the file dates: the G16 sentence lives inside *First measurements of
G16, G25 and G27 (2026-09-25)*, which states what was believed then. That
commit's own text already names this plan as the control arm's home. No edit
was made to the agenda on this branch; `touches-shared` still lists it for any
sibling branch planned against the pre-correction text.

**Three smaller departures, all in test scaffolding.** `mount.test.ts`'s three
ladder constants were shared with the new `P16` cases rather than duplicated:
`LADDER_PERIOD` was added, `LADDER_UNITS` derived from it, and the group's
comments generalised from naming `P18` to naming both blocks. `P16` sits above
those declarations and reads them from test bodies, which run after the module
is evaluated. `ablations.test.ts` needed two roster edits step 8 does not
mention — `split.noop-control` joins `LATER_ABLATIONS` for `A1` and
`ABSENT_ON_CANVAS_IDLE` for `A2` — because both lists are exhaustive over
`ABLATIONS`. And `gateUnmovedLayout` takes `pane` last, after the three new
switches, so its parameter order matches `splitDragGate`'s rather than keeping
`pane` third.

**`row0`'s wheel exemption is documented, not left to a future cell.** The
`## Potential Challenges` bullet on `row0` frames a wheel over pane 0 as a
*future* phase, but the panel's own `defaultDrive` already drives one, and
geometry labels are the panel's rather than a phase's — so the recorded default
cell would read `DIFF(row0)` the moment its wheel scrolls, with nothing telling
a reader to discount it. Rather than drop the label the plan asks for, the
panel's `geometry` comment, its `description` and the README row now all name
the remedy the campaign already uses for a burst phase's moving labels,
`--allow-diff row0@<phase>`, and say that such a cell reads `pane1` and `row1`
instead. Relatedly, both the `description` and the README row now say that the
ladder reaches the scroll-shadow path *deterministically* rather than that it
is the only phase that reaches it: the panel's existing text says the `wheel`
phase really scrolls pane 0, and `pane.shadowUpdate` is the instrument that
settles which of the two is right, so neither document may assume the answer.

**No measurement was run.** Both cells in `## Verification`, and the by-eye
`npm -w packages/qa run dev` check, need a desktop window and are left to the
user; the code is in place and covered offline by `P16` cases 1–6 and `A3b`
cases 7–9. Cases 10–13 remain unanswered by construction — they are the cells'
own readings.

---

## Notes

[^why-unreached]: What was verified, and what was ruled out. The reading the
    record offers is "nothing on that panel has live scroll shadows" or "the
    methods live on a class `findComponent('Panel')` does not reach". Both are
    false. `findComponent` matches on the prototype chain
    (`packages/qa/src/harness/tree.ts:155`), so a `ScrollPane` matches `'Panel'`;
    and `g16.panel-settled` engaged on the same panel through the same lookup and
    the same `ownerProto` walk, which proves the lookup resolves. The panes are
    built with `autoScroll: 'y'`, `scrollShadows` defaults to `true`
    (`Panel.ts:110`), and `init` installs the overlay and its scroll listener for
    exactly that combination (`Panel.ts:1254-1256`), so the shadows are live.
    What remains is the scroll itself. `resizeScrollShadowOverlay` has one caller
    and `updateScrollShadows` three, none of them a layout pass, so the arm can
    only engage on a phase that produces scroll events; `scroll-panes`' only such
    phase dispatches a synthetic `WheelEvent`, which performs no default action,
    and reaches a scroll only if `Component.onWheelScroll` claims the gesture
    (`Component.ts:5548-5549`) and its eased `SmoothScroller` then lands a write.
    An absolute-offset ladder removes every one of those conditions. This is a
    mechanism argument, not a measurement: the run is what settles it, which is
    why the cell carries `pane.shadowUpdate` and cannot read `unreached` again
    without saying why.

[^ladder-not-wheel]: A wheel was rejected for two recorded reasons. The campaign
    has one panel whose `wheel` phase is unusable — every `wheel` cell in the
    2026-09-26 sitting voided on `geom unstable(cell,focused)` in the *plain*
    arm, so `table-rows` cannot answer a wheel question at all — and
    `SmoothScroller.step` makes a wheel's landing positions a function of
    elapsed time, so a label on scrolled content disagrees between two plain
    runs of any panel. The ladder writes `Math.round(fraction * span)` with
    `fraction` derived from the unit index alone, so unit `k` is at the same
    integer pixel in every run of every arm, which is what lets `row0` be a
    gate instead of a liability. `markdown-doc` reached the same conclusion for
    G27 and the `call` driver already exists for it.

[^still-pane]: Leaving one pane unscrolled costs one pane of population out of a
    default 24 and keeps two things: the `pane1` and `row1` labels as stationary
    probes of a wrongly reserved gutter or a wrongly sized overlay, and the
    existing test that pins them (`mount.test.ts`, *labels a row of a pane no
    phase scrolls*). Pane 1 rather than pane 0 because `wheel` and every work
    counter already target pane 0, so the two phases keep the same subject.

[^read-not-paint]: The consuming app's finding is that the framework's
    viewport-sized inset `box-shadow` scroll cue is software-rasterised every
    frame in WebKitGTK, for any populated scroller. `g16.scroll-reads` skips
    `resizeScrollShadowOverlay` when the panel's size and gutter are unchanged
    and serves repeated `getScrollMetrics` from a per-task memo. The overlay,
    its four strips and their shadow layers all remain, and the skipped write
    was writing the value already there. So the cell can show the read cost
    falling to zero while the paint cost is untouched, and a flat clock in this
    cell is not evidence about the paint at all. The campaign's own rule applies:
    a Chromium sandbox measurement can miss a paint-bound cost entirely, so the
    paint question needs an engine recording.

[^no-new-panel]: `scrollbarStyle` defaults to `"overlay"` (`Panel.ts:110`), and
    that default is what makes the memo reachable. In overlay mode a panel
    registers two subtree `scroll` listeners — one calling
    `syncOverlayScrollbars`, wired by `installOverlayScrollbars`
    (`Panel.ts:1640`), and one calling `updateScrollShadows`, wired by
    `installScrollShadows` (`Panel.ts:1351`) — and both run inside one event
    dispatch, so two `getScrollMetrics` calls land on the same inner scroller in
    one task and `perTask` serves the second. `getScrollElement()` returns the
    inner scroller there (`Panel.ts:632`), which is also why
    `updateScrollShadows`' own read and `resizeScrollShadowOverlay`'s read are on
    *different* handles and never memo-hit each other. A `scrollbars=native`
    parameter was considered and dropped: native mode loses the overlay
    listener, so it has fewer reads to remove, and the default is the case a
    consuming app runs.

[^control-arm]: Three options were weighed. A cheaper rewrite of
    `split.noop-drag` — moving the per-frame `withOwnMethodOnEach` install and
    restore out of the measured path — was rejected because the co-run
    `split.recalc-gate` arm cost the same 3.4 ms in the same cell by a
    completely different mechanism (a signature computed inside
    `recalculateSizes`, no own-property churn at all), which points at replacing
    a hot prototype method rather than at either patch's particular shape. A
    `wt` prototype library arm is what W3.0 recommended and would settle it, but
    it is a library change, it compares two builds, and the fix's design is
    F06.3's own plan's job. The control arm is the cheapest instrument that
    answers the question inside one build and one session: it carries exactly the
    candidate's patching cost, removes exactly none of its work, and the
    difference of the two arms' means is the gate's own time. It is the mirror of
    `g20.walk-dose`, which prices work by adding it; this prices the instrument
    by adding it.

[^shared-gate]: A copy-pasted control is a control only until someone edits one
    of the two. Sharing the body makes the two entries differ in exactly three
    literals — the counter prefix, the counter's `what`, and the boolean that
    decides whether the replacement returns early — so any later change to the
    gate's per-frame cost lands in both arms at once. The cost is that
    `splitNoopDrag` is renamed and takes its name and three switches as
    parameters, which W3.0 already did once to these two ablations for the same
    kind of reason.

[^drift]: Both traps cost this campaign a result. A cold-start first plain rep
    read 97.69 ms against 31.69, 35.00 and 36.54 for the rest of its cell,
    opening a 66.00 bracket and making the scale unmeasurable in that shape; and
    a cell whose plain reps declined monotonically (41.85, 39.46, 37.23) put a
    plain arm *below* an arm rep, so the cell measured the sitting's warm-up
    rather than the arm. The warm-up run is named `w6a-warm-spc-0` rather than
    `w6a-spc-warm-0` on purpose: `qa-ab.py` and `qa-table.py` select by prefix
    and would otherwise treat it as an arm named `warm`.
