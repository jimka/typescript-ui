---
touches-shared: [packages/qa/README.md, plans/research/render-review-2026-09-15/00-post-campaign-agenda.md]
---

# QA cell determinism — Implementation Plan

## Overview

Two `packages/qa` cells cannot be scored, and each is blocked by its own
defect. `panel=shell-deep&drive=park` loses runs because a person's own mouse
reaches the page while the driver's drag is live: the gutter follows the
physical cursor, and the run either errors or carries real drag frames inside
its measured window.[^park-evidence] `panel=table-rows` at n = 10,000 voids on
`geom DIFF(focused)` because the first column's width is derived from a sample
of the store's view, which at that scale arrives on a worker — so the width is
78 px when the first layout wins the race and 42 px when the view does.

The two repairs do not interact. Part one adds a page-level guard that drops
device input from a measured run
([`packages/qa/src/harness/run.ts:78`](packages/qa/src/harness/run.ts#L78)) and
makes the `park` driver prove the element has parked *before* the measured
units begin
([`packages/qa/src/harness/drivers.ts:780`](packages/qa/src/harness/drivers.ts#L780)).
Part two declares a digit budget on `table-rows`' three `number` columns
([`packages/qa/src/panels/table-rows.ts:116`](packages/qa/src/panels/table-rows.ts#L116)),
which is the option the library documents for exactly this case
([`ColumnConfig.ts:70-85`](packages/lib/src/typescript/lib/component/table/ColumnConfig.ts#L70)).

No library source changes. Together the two unblock F06.3's control-arm
comparison (cell `sdp` in
[`plans/implemented/unreached-ablation-surfaces.md:517`](plans/implemented/unreached-ablation-surfaces.md#L517))
and G21's memo under `rowfilter=title` at n = 10,000 (cell `trv` in
[`plans/implemented/table-row-filter-panel.md:432`](plans/implemented/table-row-filter-panel.md#L432)).

---

## Architecture Decisions

### Part one's cause is the real pointer, not the lead

The 160 px lead is correct for this panel: seven of the sitting's nine `sdp`
runs parked the sidebar at its 160 px minimum and held it for all 150 units. The
two that errored, and one that passed with real drag frames inside its window,
were disturbed by a trusted `mousemove` at the physical cursor's position while
the driver's drag was live.[^park-evidence] So the repair keeps device input out
of a measured run, and does not re-derive `leadPx`.[^no-geometry-lead]

### A measured run drops device input at `window`, in the capture phase

A run installs one `window` capture listener per device-input event type before
anything mounts; each drops a trusted event and tallies it, and lets every
untrusted one through. The drivers' events are script-made, so they are
untrusted and unaffected.[^trusted-split] The listeners must exist before
`Body.init()`, because the library registers its own `window` capture listener
for a type the first time something asks for that type, and the guard can only
stop a listener registered after itself.[^listener-order]

| Event | `isTrusted` | Guard |
|---|---|---|
| the `park` driver's `mousemove` on `document` | `false` | passes |
| a person's `mousemove` over the window | `true` | dropped and tallied |
| `beforeinput` from the `type` driver's `execCommand` | `true` | passes — not a guarded type[^excluded-types] |
| `scroll` after the `wheel` driver's event | `true` | passes — not a guarded type |

### `park` proves the park before the measured units, and extends its lead until it holds

After the lead-in's drag, the driver pushes one more `stepPx` — the first
measured unit's own step — and requires the element's rectangle to be unchanged.
While it changes, the lead doubles and the proof is taken again, up to twelve
times; the achieved lead is what `parkOffset` then uses. A cell therefore parks
whatever the element's distance from its clamp was, and a lead that cannot reach
a clamp fails before a unit is spent instead of after
150.[^prove-not-predict] The proof compares the rounded rectangle the driver
already uses.[^rounded-rects]

### Part two pins the digit budget of every `number` column

`table-rows`' three `number` columns — `id`, `salary` and `score` — declare
`maxContentLength: 8`. `Table` derives a `number` column's width from
`col.getMaxContentLength() ?? this.sampledDigits(col) ?? DEFAULT_NUMBER_DIGITS`
([`Table.ts:2700`](packages/lib/src/typescript/lib/component/table/Table.ts#L2700)),
and `ColumnConfig.maxContentLength` is documented as outranking the sample for
this field type, so a declared budget removes the store from the derivation
entirely. Nothing else in the panel's width derivation reads the
store.[^store-free]

| What a run measures, at 5120 × 2075 | Sample present (view won the race) | Sample absent (layout won) | With `maxContentLength: 8` |
|---|---|---|---|
| `id` (`number`), the column the `focused` probe reads | 42 px — the 4-digit floor | 78 px — 8 digits | **78 px** |
| `salary` (`number`) | 69 px — `129,999` is 7 characters | 78 px | **78 px** |
| the `cell` probe (a flex `string` cell) | 912 px wide at x 43 — the flex columns absorb the 81 px freed | 896 px at x 79 | **896 px at x 79** |

### The declared budget is 8, so prior recorded geometry stays comparable

Eight is `DEFAULT_NUMBER_DIGITS`, the value `Table` already assumes for an
unsampled `number` column, so every run now reproduces the layout four of five
runs produced on 2026-09-26 and five of six on 2026-09-20: `focused`
`[1, 44, 78, 20]` and `cell` `[79, ·, 896, ·]`. The fix removes the minority
layout rather than replacing the majority one, so this panel's recorded
rectangles are not superseded.[^budget-value]

### Column auto-sizing is not given up, because the panel never had it

`autoSizeColumns` is off in every panel — `packages/qa` does not mention it, and
the library's only user is `diagnostics/StyleAuditView.ts:63`. With the flag off
a `string`/`auto` column's content is never measured
([`Table.ts:2458`](packages/lib/src/typescript/lib/component/table/Table.ts#L2458)),
so the five flex columns share the leftover width and keep doing so after this
change. What the budget displaces is the 50-row digit sample a `number` column
takes regardless of the flag — not auto-sizing.[^no-explicit-widths]

---

## Internal Structure

### The guard

New file, `packages/qa/src/harness/input.ts`:

```ts
/** The device-input types a run drops. Engine-made trusted events the drivers depend on are deliberately absent. */
const GUARDED_TYPES: readonly string[] = [
    'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'pointercancel',
    'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'click', 'dblclick', 'contextmenu',
    'wheel',
    'keydown', 'keypress', 'keyup',
];

/** Trusted events dropped so far, by type; `null` while the guard is not installed. */
let dropped: Record<string, number> | null = null;

function dropIfTrusted(event: Event): void;          // tallies, preventDefault when cancelable, stopImmediatePropagation
export function installInputGuard(): string;         // one window capture listener per type; returns the note
export function removeInputGuard(): void;            // for tests; a run ends with the page
export function droppedInputNote(): string;          // 'input guard: nothing reached the page' | 'input guard: dropped mousemove×5'
```

### The lead-in's proof

In `packages/qa/src/harness/drivers.ts`, `leadIn` gains `stepPx` and returns the
lead it achieved:

```ts
async function leadIn(tools: HarnessTools, target: ParkTarget, stepPx: number): Promise<{ start: Point; lead: number; pushes: number; rect: string }> {
    // …press, LEAD_FRAMES moves to target.leadPx, waitFrames(SETTLE_FRAMES) — unchanged…
    let lead = target.leadPx;
    let parked = rectKey(target.element);

    for (let pushes = 0; ; pushes++) {
        const stepped = await pushAndRead(tools, target, start, lead + stepPx);

        if (stepped === parked) {
            return { start, lead, pushes, rect: parked };
        }

        if (pushes === PARK_PUSH_CAP) {
            throw new Error(`park: the element never parked; at a ${lead}px lead one more ${stepPx}px step still moved it (${parked} → ${stepped})`);
        }

        lead *= PARK_PUSH_FACTOR;
        parked = await pushAndRead(tools, target, start, lead);
    }
}
```

`pushAndRead` fires one `mousemove` on `document` at `parkPoint(start, target,
offset)`, waits `PARK_HOLD_FRAMES`, and returns `rectKey(target.element)`. The
unbounded `for` mirrors `admittedAt`
([`packages/qa/src/builders/store.ts:117`](packages/qa/src/builders/store.ts#L117)).

Three new constants, beside the driver's others:

```ts
/** Frames `park` waits for a push to land before reading whether the element moved: one to apply the move, one spare. */
const PARK_HOLD_FRAMES = 2;

/** How much further each extra push travels, as a multiple of the lead so far. */
const PARK_PUSH_FACTOR = 2;

/** The most extra pushes before the run fails: twelve doublings take a 10 px lead past 40,000 px, wider than any display. */
const PARK_PUSH_CAP = 12;
```

---

## Ordered Implementation Steps

### Part one — the park cell

1. **Create `packages/qa/src/harness/input.ts`** with the four functions in
   `## Internal Structure`. `installInputGuard` sets `dropped = {}` and adds
   `dropIfTrusted` for every `GUARDED_TYPES` entry with
   `{ capture: true, passive: false }`, returning
   `` `input guard: ${GUARDED_TYPES.length} device-input types dropped at window capture` ``.
   `dropIfTrusted` returns at once unless `event.isTrusted && dropped`, then
   tallies `dropped[event.type]`, calls `event.preventDefault()` when
   `event.cancelable`, and calls `event.stopImmediatePropagation()`.
   `droppedInputNote` returns `input guard: nothing reached the page` for an
   empty or absent tally, else `` `input guard: dropped ${type}×${n}, …` ``
   largest count first. File header comment: why a run drops what it did not
   dispatch, and that nothing runs at import time (the file's neighbours all say
   so).
2. **Wire it into `runQa`** in
   [`packages/qa/src/harness/run.ts:78`](packages/qa/src/harness/run.ts#L78):
   `run.notes.push(installInputGuard());` immediately after the `run` context is
   built — before `report` and before the `try`, with a comment giving the
   ordering reason from `## Architecture Decisions`. Then
   `run.notes.push(droppedInputNote());` between the `catch` block's closing
   brace and `await postReport(...)` at
   [`:101`](packages/qa/src/harness/run.ts#L101), so the tally is recorded
   whether the run succeeded or failed. Do **not** put either call in
   `instrument()` — it runs after the panel has mounted.
3. **Add the three constants** `PARK_HOLD_FRAMES`, `PARK_PUSH_FACTOR` and
   `PARK_PUSH_CAP` to `packages/qa/src/harness/drivers.ts`, beside
   `PARK_MIN_UNITS` ([`:67`](packages/qa/src/harness/drivers.ts#L67)), with the
   doc comments given above.
4. **Add `pushAndRead`** below `parkPoint`
   ([`:765`](packages/qa/src/harness/drivers.ts#L765)).
5. **Rewrite `leadIn`** ([`:780`](packages/qa/src/harness/drivers.ts#L780)) to
   take `stepPx`, keep the press and the `LEAD_FRAMES` gradual moves unchanged,
   and then run the proof loop. Its doc comment states that the lead-in proves
   the park and doubles the lead while it does not hold, and carries the
   `@throws` line for the never-parked error.
6. **Update `park`** ([`:857`](packages/qa/src/harness/drivers.ts#L857)). Rename
   the lead-in's result from `lead` to `parked`, so the achieved lead reads
   `parked.lead` rather than `lead.lead`, and update its four other uses
   (`parked.start` twice, `parked.rect` twice). Pass `ctx.stepPx` to `leadIn`;
   initialise `pointer` to
   `parkPoint(parked.start, target, parked.lead + ctx.stepPx)`, where the proof
   left it; pass `parked.lead` to `parkOffset` in place of `target.leadPx`;
   reword the post-restore error to
   `` `park: the element moved during the measured units (${parked.rect} → ${held}); it parked before them, so something moved it after` ``;
   and make the note one fixed shape:
   `` `park: lead ${target.leadPx}px + ${parked.pushes} pushes = ${parked.lead}px, element parked at ${parked.rect} and held for ${ctx.units} units` ``.
   Update the `@throws` lines to name both failures and say that the
   never-parked one fires before any unit.
7. **Correct the `ParkTarget.leadPx` doc** in
   [`packages/qa/src/harness/types.ts:91-100`](packages/qa/src/harness/types.ts#L91):
   `leadPx` is the lead-in's *first* push, which the driver doubles until the
   element stops moving. Leave the field and its shape check
   ([`drivers.ts:461`](packages/qa/src/harness/drivers.ts#L461)) alone.
8. **Correct the `PARK_OVERSHOOT_PX` comment** in
   [`packages/qa/src/builders/shell.ts:64-65`](packages/qa/src/builders/shell.ts#L64)
   — the comment only; the constant keeps its value, and the `park` target at
   [`:316`](packages/qa/src/builders/shell.ts#L316) is left alone. It is how far
   past the sidebar's minimum the lead-in's *first* push aims, which the driver
   extends if that push does not park the gutter. Check afterwards:
   `grep -n 'every measured unit is past the clamp'
   packages/qa/src/builders/shell.ts` — expect zero matches.
9. **Extend `packages/qa/tests/drivers.dom.test.ts`'s `park` block**
   ([`:482`](packages/qa/tests/drivers.dom.test.ts#L482)). Give its `gutter`
   helper a per-call rectangle function, as the `settle` block's `probedBox`
   already has ([`:386`](packages/qa/tests/drivers.dom.test.ts#L386)), because
   the never-parked case needs 27 reads. Cases: the happy path (one proof push,
   `0 pushes` in the note, and the proof's `mousemove` in the log before
   `runFrames`); a park after one doubling (`+ 1 pushes`, the log showing the
   doubled push); no park at all (rejects with the `never parked` prefix, and the
   log holds no `runFrames`); the reworded mid-window failure; and the existing
   two-unit minimum, unchanged.
10. **Add `packages/qa/tests/input.test.ts`**: a trusted-flagged `mousemove`
    (`Object.defineProperty(event, 'isTrusted', { value: true })`) dispatched on
    `document` never reaches a `window` capture listener added after the guard,
    and is tallied; an untrusted one reaches it and is not tallied; a trusted
    `scroll` reaches it; `droppedInputNote()` reads
    `input guard: nothing reached the page` before anything and names type and
    count after. `afterEach(removeInputGuard)`.
11. **Assert the two notes in `packages/qa/tests/run.test.ts`**: a posted
    report's `notes` starts with the install note and ends with the tally note,
    on both the success and the error path. `afterEach(removeInputGuard)`.

### Part two — the table's column layout

12. **Declare the digit budget** in
    [`packages/qa/src/panels/table-rows.ts:116`](packages/qa/src/panels/table-rows.ts#L116).
    Add one constant beside the panel's others:

    ```ts
    /**
     * Digits every `number` column declares room for. `Table` derives a number
     * column's width from a declared budget, else a 50-row sample of the store,
     * else eight digits — and at n ≥ 1,000 the view arrives on a worker, so
     * whether the sample exists at the first layout is a race. Eight is the
     * library's own unsampled default, so the pinned width is the one the
     * majority of runs already produced.
     */
    const NUMBER_DIGITS = 8;
    ```

    and a branch in the `columns` map, after the `department` branch:
    `if (f.type === 'number') { return { field: f.name, maxContentLength: NUMBER_DIGITS }; }`.
13. **Add the width witness** to the same file's `describe()`
    ([`:159`](packages/qa/src/panels/table-rows.ts#L159)):
    `idColumnWidth: Math.round(table.getColumnWidths()[0] ?? 0)`, with a comment
    that it reads 0 before the layout manager has run and is a run-time
    determinism witness, `[0]` being the `id` column because no column is
    hidden.
14. **Extend `packages/qa/tests/mount.test.ts`'s two `table-rows` `describe()`
    cases** ([`:207`](packages/qa/tests/mount.test.ts#L207),
    [`:216`](packages/qa/tests/mount.test.ts#L216)) with `idColumnWidth: 0`,
    since `table-rows` cannot mount under jsdom and those cases read `build()`
    alone. Add one case asserting the built spec: the three `number` columns
    carry `maxContentLength: 8` and no other column carries it.

### Documentation

15. **`packages/qa/README.md`**, four edits, as `## Documentation Impact` spells
    out.
16. **The two implemented plans and the agenda**, as
    `## Documentation Impact` spells out.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/qa/src/harness/input.ts` |
| Create | `packages/qa/tests/input.test.ts` |
| Modify | `packages/qa/src/harness/run.ts` |
| Modify | `packages/qa/src/harness/drivers.ts` |
| Modify | `packages/qa/src/harness/types.ts` |
| Modify | `packages/qa/src/builders/shell.ts` (comments only) |
| Modify | `packages/qa/src/panels/table-rows.ts` |
| Modify | `packages/qa/tests/drivers.dom.test.ts` |
| Modify | `packages/qa/tests/run.test.ts` |
| Modify | `packages/qa/tests/mount.test.ts` |
| Modify | `packages/qa/README.md` |
| Modify | `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md` |
| Modify | `plans/implemented/unreached-ablation-surfaces.md` |
| Modify | `plans/implemented/table-row-filter-panel.md` |

---

## Expected Behaviour

Offline, under vitest:

1. **A trusted device event never reaches the page.** With the guard installed
   and a `window` capture listener added after it, a `mousemove` carrying
   `isTrusted: true` dispatched on `document` does not reach that listener.
2. **A synthetic device event does.** The same dispatch with `isTrusted` left
   `false` — what `fireMouse` makes — reaches it, and the tally stays empty.
3. **A trusted event outside the guarded types reaches the page.** A `scroll`
   with `isTrusted: true` reaches a listener added after the guard.
4. **The tally reads as a note.** `input guard: nothing reached the page` with
   nothing dropped; `input guard: dropped mousemove×3` after three.
5. **Every report carries both notes.** A run's `notes` opens with the install
   note and closes with the tally note, on the success and the error path alike.
6. **A park that holds on the first proof push notes `+ 0 pushes`.** The note
   reads
   `park: lead 50px + 0 pushes = 50px, element parked at 40,0,10,200 and held for 4 units`,
   and the driver's log shows the proof's `mousemove` and its
   `waitFrames 2 suspended` between the lead-in's `waitFrames 3 suspended` and
   `runFrames 4`.
7. **A park that needs one doubling notes `+ 1 pushes` and uses the doubled
   lead.** The measured offsets start from `lead × 2 + stepPx`.
8. **An element that never parks fails before the first unit.** The driver
   rejects with `park: the element never parked; …`, the log holds no
   `runFrames` line, and `notes` stays empty.
9. **An element disturbed after parking still fails after restoring.**
   `park: the element moved during the measured units (40,0,10,200 →
   37,0,10,200); it parked before them, so something moved it after`.
10. **Fewer than two units still fails before anything is dispatched.**
    Unchanged.
11. **`table-rows` declares a digit budget on its three number columns only.**
    `id`, `salary` and `score` carry `maxContentLength: 8` and nothing else;
    `department` keeps its `values` and gains no budget; `notes` keeps
    `filterable: false`; the other seven columns declare only their `field`.
12. **`describe()` reports `idColumnWidth` 0 before the layout manager has
    run**, alongside the fields it already reports.

In engine, by the runs in `## Verification` (the harness cannot exercise real
input, drag, focus or geometry offline):

13. **Every `sdp` run parks at its declared lead.** Each report's notes read
    `park: lead 160px + 0 pushes = 160px, element parked at 165,42,10,1998 and
    held for 150 units`, and no run returns an error result.
14. **A moved mouse changes nothing.** With the mouse swept across the window
    during one run, that run's `geometry.sidebar` holds one rectangle for all
    150 units and its tally note names the dropped `mousemove`s.
15. **`table-rows` at n = 10,000 comes up in one layout.** `host.idColumnWidth`
    is 78 in every run, and both phases' plain lines read `geom =`.

---

## Verification

Offline, from the repository root:

```sh
npm -w packages/qa run typecheck
npm -w packages/qa run test
grep -rn 'leadPx does not reach the clamp' packages/qa            # expect zero matches
grep -rn 'allow-diff focused' plans/implemented/                  # expect zero matches
```

No library source changes, so the library's typecheck, tests and lint and
`npm run docs:api` are not part of this plan.

The two cells below, and the manual check after them, each open a full-screen
window per run and must be run by the user, in one sitting each, in the order
given. Comparisons hold only within a sitting, so a cell is read against its own
runs and nothing else.

### Cell `qcd-trv` — `table-rows`' initial layout, five plain runs

```sh
FLAGS='work=1&seam=1&geom=1'
P='panel=table-rows&rowfilter=title&update=record&drive=key,passes'

packages/qa/runqa.sh qcd-warm-trv   main "$P&$FLAGS"   # discarded; shares no cell prefix
packages/qa/runqa.sh qcd-trv-plain-a main "$P&$FLAGS"
packages/qa/runqa.sh qcd-trv-plain-b main "$P&$FLAGS"
packages/qa/runqa.sh qcd-trv-plain-c main "$P&$FLAGS"
packages/qa/runqa.sh qcd-trv-plain-d main "$P&$FLAGS"
packages/qa/runqa.sh qcd-trv-plain-e main "$P&$FLAGS"

python3 packages/qa/bin/qa-table.py packages/qa/results qcd-trv- --before host.idColumnWidth
python3 packages/qa/bin/qa-ab.py packages/qa/results qcd-trv- --counter 'work.getRecords@MemoryStore'
```

A cell of plain runs alone is a determinism check on the panel: the plain line
names the labels the plain runs disagree on
([`qa-ab.py:681`](packages/qa/bin/qa-ab.py#L681)). It passes when both phases'
plain lines read `geom =` and `host.idColumnWidth` is 78 in all five runs. Five
runs because the minority layout showed in about one run in five. A warm-up run is
discarded first: a cold rep at this scale once read 97.69 ms against 31–36 for
the rest of its sitting, which opens a bracket wide enough to swallow any arm's
saving.

### Cell `sdp` — F06.3's control-arm comparison

Run it exactly as
[`plans/implemented/unreached-ablation-surfaces.md:517-540`](plans/implemented/unreached-ablation-surfaces.md#L517)
gives it, under the prefix `qcd-sdp-` and with its warm-up as `qcd-warm-sdp`.
Before reading F06.3's verdict from that plan's own table, check that no run
returned an error result, that every run's notes carry
`park: lead 160px + 0 pushes = 160px`, and that the plain line and both arms
read `geom =`. Then read `G = mean(split.noop-drag) − mean(split.noop-control)`
against the plain bracket, exactly as that plan specifies.

### Manual check — the guard, with the mouse

During one extra `sdp` run (name it `qcd-guard-sdp`, outside both cells), sweep
the mouse across the window while the phase runs. The run must still succeed,
its `geometry.sidebar` must hold `[8, 42, 160, 1998]` for all 150 units, and its
tally note must name the dropped `mousemove`s. This is the only check that
exercises the guard in engine; offline vitest cannot make a trusted event.

---

## Documentation Impact

No library public API changes, so no TypeDoc page moves and `npm run docs:api`
is not part of this plan.

**`packages/qa/README.md`**, the QA app's only reference:

- The run sequence (`:212`) gains the guard as the first step: a run drops the
  real mouse and keyboard — every trusted pointer, mouse, wheel and key event
  stopped at `window` before the library sees it — then mounts the panel.
  `notes` says what was dropped.
- The `park` row of the drivers table (`:428`): before the units, a press, a
  10-frame drag of `leadPx`, and a proof that the element has parked — one more
  `step` must leave its rectangle alone, or the lead doubles and the proof is
  taken again, up to twelve times, before any unit runs. The note carries the
  lead it parked at, the extra pushes it took, and the rectangle it held.
- The `table-rows` panel row (`:339`): the three `number` columns declare an
  8-digit budget, so their widths do not depend on whether the worker's view
  beat the first layout; `describe()` adds `idColumnWidth`.
- `## Measurement rules` (`:807`) gains a bullet: **device input is dropped, not
  tolerated** — on 2026-09-26 a moved mouse cost two of nine `sdp` runs and
  polluted a third, and a run now drops what it did not dispatch.

**`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`**, in
*The sitting: one verdict, two blocked cells, one new price (2026-09-26)*:

- The park bullet (`:1147-1160`) is wrong about the cause and is replaced: the
  lead of 160 px parks the sidebar correctly — seven of nine runs held it at
  `165,42,10,1998` for all 150 units — and what broke the other three was a
  trusted `mousemove` at the physical cursor reaching the live drag.
  The first `w6b-sdp-split.noop-drag-2` result and `w6b-warm-sdp-0` error with
  lead rectangles at x 3802 and 4404, and the re-run that replaced the first
  carries six distinct `sidebar` rectangles, sweeping 4520 → 4675 px across units 26–30
  before unit 31 re-parks it — so its 13.13 ms is real drag frames, not an
  instrument tax, and the +1.35 read from it is not a reading. Name the repair:
  the input guard, and the `park` driver's proof before the units.
- The n = 10,000 bullet (`:1119-1135`) keeps its diagnosis and gains the
  mechanism and the fix: `Table` samples a `number` column's digits from the
  store whatever `autoSizeColumns` says, so `id` is 78 px when the first layout
  wins and 42 px when the worker's view does; the three columns now declare an
  8-digit budget, which pins the majority layout.
- One new bullet, found while planning and claimed by no plan: the library's own
  re-sample is gated on `autoSizeColumns`
  ([`Table.ts:2811`](packages/lib/src/typescript/lib/component/table/Table.ts#L2811))
  while its digit sample is not
  ([`Table.ts:2637`](packages/lib/src/typescript/lib/component/table/Table.ts#L2637)),
  so any consumer with a worker-backed store gets race-dependent `number`-column
  widths and no event ever corrects them. Production behaviour; needs its own
  plan and its own measurement.

**`plans/implemented/table-row-filter-panel.md`**, two places that tell a reader
to allow the `focused` label to differ, both superseded: *Reading a geometry
`DIFF`* (`:490-500`) and the first `## Potential Challenges` bullet (`:551-553`).
A `DIFF` or `unstable` on `focused` now voids the cell like any other label —
the probe was never flaky — and `host.idColumnWidth` says why when it happens.
Check: `grep -n 'allow-diff focused'
plans/implemented/table-row-filter-panel.md` — expect zero matches.

**`plans/implemented/unreached-ablation-surfaces.md`**, cell `sdp` (`:537-541`):
the driver proves its premise before the measured units as well as after, and
every report's notes carry the lead it parked at.

---

## Potential Challenges

- **The guard must be installed before `Body.init()`.** Placing it in
  `instrument()` would leave it second in line behind the library's own `window`
  capture listener and silently useless. Step 2 pins the call site, and the
  comment there says why.
- **`stopImmediatePropagation` also stops the Tauri host's devtools shortcut**
  (Ctrl+Shift+I, one of the two listeners Tauri injects on `document`). A run is
  not interactive anyway; to poke at a panel by hand, drop `qa=` and use the
  preview page, where no guard is installed.
- **Guarding too much would break the `type` driver.** It relies on the engine's
  own trusted `beforeinput` and `input` events, which `execCommand('insertText')`
  fires. Keep `GUARDED_TYPES` to the device families listed; the same applies to
  `scroll`, `resize`, `focus` and `selectionchange`.
- **Under `resize=outline` the proof passes without a clamp being reached**,
  because an outline drag lays nothing out until the release, so the gutter never
  moves. The park cells are run in live mode; a park cell under `resize=outline`
  measures no-op frames either way.
- **The proof adds unmeasured frames to every park phase.** Two frames per proof
  push, inside `suspendCounting`, before the first unit — no counter and no
  sample sees them.

---

## Critical Files

- [`packages/qa/src/harness/drivers.ts:33-70`](packages/qa/src/harness/drivers.ts#L33),
  [`:758-881`](packages/qa/src/harness/drivers.ts#L758) — the park driver's
  constants, `parkPoint`, `leadIn`, `releaseAndRestore`, `park` and the check it
  makes after restoring.
- [`packages/qa/src/harness/probes.ts:98-128`](packages/qa/src/harness/probes.ts#L98)
  — `awaitSettledGeometry`: the capped wait-until-still loop the proof's shape
  follows.
- [`packages/qa/src/harness/run.ts:70-101`](packages/qa/src/harness/run.ts#L70),
  [`:246-275`](packages/qa/src/harness/run.ts#L246) — `runQa` and `instrument`;
  the install-returns-a-note idiom, and the reason the guard cannot join it.
- [`packages/qa/src/harness/counters.ts:763-771`](packages/qa/src/harness/counters.ts#L763),
  [`:840-861`](packages/qa/src/harness/counters.ts#L840) — `installSeamCounters`
  and `installPlatformCounters`, the shape `installInputGuard` mirrors.
- [`packages/lib/src/typescript/lib/core/Event.ts:183-220`](packages/lib/src/typescript/lib/core/Event.ts#L183),
  [`:812`](packages/lib/src/typescript/lib/core/Event.ts#L812) — the library's
  lazily-registered `window` capture listeners, which the guard must precede.
- [`packages/lib/src/typescript/lib/component/table/Table.ts:2672-2730`](packages/lib/src/typescript/lib/component/table/Table.ts#L2672),
  [`:2560-2660`](packages/lib/src/typescript/lib/component/table/Table.ts#L2560),
  [`:2810-2822`](packages/lib/src/typescript/lib/component/table/Table.ts#L2810)
  — `columnWidthPolicy`, `collectCandidates`, `sampledDigits` and
  `maybeResampleColumnWidths`: where the width comes from and why no event
  corrects it.
- [`packages/lib/src/typescript/lib/component/table/ColumnConfig.ts:70-85`](packages/lib/src/typescript/lib/component/table/ColumnConfig.ts#L70)
  — `width` and `maxContentLength`, and the documented precedence this plan
  uses.
- [`packages/lib/src/typescript/lib/layout/Table.ts:150-182`](packages/lib/src/typescript/lib/layout/Table.ts#L150),
  [`:442-465`](packages/lib/src/typescript/lib/layout/Table.ts#L442) — the
  once-per-column-count gate and `initializeWidths`, so the race is a race for
  the first sized layout.
- [`packages/qa/src/builders/store.ts:1-91`](packages/qa/src/builders/store.ts#L1)
  — `awaitStoreView`, and the worker threshold that makes the view late.
- [`packages/qa/bin/qa-ab.py:437-466`](packages/qa/bin/qa-ab.py#L437),
  [`:573-600`](packages/qa/bin/qa-ab.py#L573),
  [`:669-697`](packages/qa/bin/qa-ab.py#L669) — `differing_labels`,
  `cell_verdict` and the plain line: how a geometry disagreement becomes `void`,
  and how a plain-only cell reads as a determinism check.
- [`plans/implemented/qa-panel-determinism.md:663-706`](plans/implemented/qa-panel-determinism.md#L663)
  — the first record of this column-layout flake, with the rectangles that
  localise it to the first column.

---

## Non-Goals

- **Deriving `leadPx` from live geometry.** The recorded runs show the declared
  lead reaching the clamp; the proof makes any lead sufficient, so a second
  derivation would add code and change nothing.[^no-geometry-lead]
- **Explicit `width` on `table-rows`' columns.** It would end the flex columns'
  share of the leftover width, which is part of what the panel
  exercises.[^no-explicit-widths]
- **`treetable-rows`.** Its `size` column carries the same exposure — a
  `number` column with no budget over a 2,600-record store — but the five runs
  on record (`g22r-ttr-*`) agree on `focused` `[1, 22, 2434, 20]`, no cell is
  waiting on that panel, and pinning its budget would shift a recorded
  rectangle by an unknown amount. The remedy, if a later cell needs it, is the
  same one line.
- **`table-rows`' `wheel` phase**, which voids on `unstable(cell,focused)` in
  the plain arm. That is mid-burst sampling, not the initial layout, and its
  answer is a gate on the settled state — the treatment G22 already
  established.
- **The library's re-sample gate.** Recorded in the agenda as a production
  question; changing it would move the geometry baseline of every table cell
  measured so far and needs its own measurement.
- **A second `park` target, a new panel or a new ablation.** Both cells exist
  and both are already specified by the plans they unblock.

---

## Notes

[^park-evidence]: The nine `sdp` reports of 2026-09-26 are still in
    `packages/qa/results/`, and they settle the cause. Seven parked: their notes
    read `park: lead 160px, element held at 165,42,10,1998 for 150 units`, their
    `geometry.sidebar` holds the single rectangle `[8, 42, 160, 1998]` for all
    150 units, and `before.viewport` is `5120 × 2075` in every one — so neither
    the display's width nor the panel's resting layout is at fault. Two errored:
    `w6b-warm-sdp-0` with a lead rectangle at x 4404 and the first
    `w6b-sdp-split.noop-drag-2` at x 3802, each restored to `165,42,10,1998` by
    the measured units. The re-run that replaced that second result passed the
    driver's end-of-phase check yet carries six distinct `sidebar` rectangles,
    its width sweeping 4520 → 4675 px across units 26–30 before unit 31 re-parks
    it, with `maxMs` 88 against plain means of 8.56–8.91 ms. The arithmetic
    names the source: `Split.onDrag` resolves the left pane from the drag origin
    as `originLhs + (position − originPointer)`
    ([`Split.ts:1436`](packages/lib/src/typescript/lib/layout/Split.ts#L1436)),
    so with this panel's origin — a 280 px sidebar and a press at x 290 — the
    pane's width tracks the pointer's own `clientX` less ten. The three spoiled
    runs therefore record a pointer at about x 3,807, x 4,409 and x 4,530–4,685.
    No driver sends one there: the lead-in's moves run from x 290 down to 130,
    and every measured unit's pointer sits at 127 or below. The only source of a
    `mousemove` that far right is outside the page, which makes it trusted;
    whether a hand moved the mouse or the engine re-delivered a stationary
    cursor's position after a layout change, the guard drops it identically, and
    the tally note will say which happened next time.
[^no-geometry-lead]: The diagnosis this plan replaces read the lead as too short
    for the dragged gutter — 160 px against a gutter 3,640 px from its clamp —
    and called for deriving it from the element's live rectangle. The reports
    rule that out: the gutter rests 120 px from its clamp at this viewport, the
    lead overshoots it by 40 px, and the two error messages quote a lead
    rectangle at the *physical cursor*, not at a resting layout. A geometric
    derivation would compute the 160 px the constants already give, and would
    not have saved one of the three spoiled runs. The proof in step 5 delivers
    what that derivation was wanted for — a park that holds whatever the
    viewport and whichever gutter is targeted — by measuring instead of
    predicting.
[^trusted-split]: Every driver builds its events with a constructor —
    `new MouseEvent` in `fireMouse`
    ([`packages/qa/src/harness/dom.ts:128`](packages/qa/src/harness/dom.ts#L128)),
    `new PointerEvent`, `new KeyboardEvent` and `new WheelEvent` in
    `drivers.ts` — so `isTrusted` is `false` on all of them, by specification.
    The engine sets it `true` only on events it dispatches itself.
[^listener-order]: `Event.installBaseListener` and `Event.addViewportListener`
    both call `DOM.sink.addListener(DOM.source.getWindow(), type, …,
    captureOpts(type))`, once per event type, the first time anything registers
    for that type
    ([`Event.ts:213`](packages/lib/src/typescript/lib/core/Event.ts#L213),
    [`:812`](packages/lib/src/typescript/lib/core/Event.ts#L812)). Two capture
    listeners on `window` run in registration order, and
    `stopImmediatePropagation` only stops the ones that have not run yet — so
    the guard works only if it is registered first. `runQa` is the earliest
    point that knows a run is a run: `Body.init()` happens below it, inside
    `mountPanel`, and no library import touches the DOM (pinned by
    `packages/lib/tests/unit/import-without-dom.test.ts`).
[^excluded-types]: The `type` driver inserts text with
    `document.execCommand('insertText')` precisely so the engine fires its own
    trusted `beforeinput` and `input`, which a synthetic `KeyboardEvent` cannot
    ([`drivers.ts:976`](packages/qa/src/harness/drivers.ts#L976)). `scroll`
    carries `isTrusted: true` even for a programmatic scroll, and
    `scroll-panes` counts `pane.scrollTick` from it
    ([`scroll-panes.ts:84`](packages/qa/src/panels/scroll-panes.ts#L84)).
    Guarding either family would break a driver. The rule for the list is
    therefore: device-input types only — what a person at the machine
    originates — never an engine-made consequence of the harness's own action.
[^prove-not-predict]: The old check read the element's rectangle after the last
    measured unit and compared it with the lead-in's
    ([`drivers.ts:873`](packages/qa/src/harness/drivers.ts#L873)). It cannot
    distinguish "parked before unit 0" from "parked during unit 0", and it pays
    150 units before saying so. Moving a proof in front of the units costs two
    unmeasured frames, states the parked lead in the report, and turns a
    too-short lead into an error before any sample exists. The post-restore
    check stays, because it is what catches a disturbance *inside* the window;
    with the guard in place the only remaining source is the page itself.
[^rounded-rects]: `qa-panel-determinism` established that the `settle` wait must
    compare exact rectangles, because `SmoothScroller` snaps only once the
    remaining gap falls under half a pixel, so several frames of an ease tail
    round to one value. A parked gutter has no such tail: `Split.onDrag` clamps
    the pane to the minimum computed from the pair's bounds and writes that same
    value on every further move, so the rectangle is exactly equal, not
    approaching. `park` therefore keeps `rectKey`, whose rounded strings its
    notes and error messages already print.
[^store-free]: With `autoSizeColumns` off, `resolveContentCandidates` returns
    `null` for every `string`/`auto` column
    ([`Table.ts:2458`](packages/lib/src/typescript/lib/component/table/Table.ts#L2458)),
    so `department`, `name`, `email`, `title` and `notes` are flex and read
    nothing from the store. `boolean` and `glyph` come from constants; `date`,
    `time` and `datetime` from a reference date; every branch's header width from
    one batched text measurement. `sampledDigits` for a `number` column is the
    only input the store feeds, and `samplesRecordText` returns `true` for that
    field type whatever the flag says
    ([`Table.ts:2637`](packages/lib/src/typescript/lib/component/table/Table.ts#L2637)).
    That is why three declarations make the whole derivation deterministic.
[^budget-value]: The arithmetic closes on the recorded rectangles, which is what
    makes 8 the right number rather than a guess. `digitPx` is 9 px in this
    theme, so a `number` column's floor is `9 × 4 + 6 = 42` px and its unsampled
    preference `9 × 8 + 6 = 78` px — the two widths `focused` has ever shown.
    The sampled case gives `id` 2-digit values (the sample is the first 50 rows)
    and `salary` the 7-character `129,999`, so the three number columns free
    `36 + 9 + 36 = 81` px, and the five flex columns take `81 / 5 ≈ 16` px each
    — exactly the `cell` difference `qa-panel-determinism` recorded, 896 against
    912, with x moving 79 → 43 by the `id` column's own 36
    ([`qa-panel-determinism.md:663-676`](plans/implemented/qa-panel-determinism.md#L663)).
    Pinning 8 keeps the 78/896/79 layout, which is the majority in both
    sittings on record.
[^no-explicit-widths]: Three other routes were weighed. Declaring `width` on
    every column would be deterministic too, but `initializeWidths` would then
    have no flex column to share the leftover with
    ([`layout/Table.ts:442`](packages/lib/src/typescript/lib/layout/Table.ts#L442)),
    so the panel would stop exercising the share-and-absorb path and every
    column's rectangle would move. Forcing a re-derivation in `afterMount` once
    the view has arrived — `setStore` with the same store clears the width
    caches — would pin the *sampled* layout instead, moving `focused` from 78 to
    42 and superseding the recorded geometry, and it would reach for a store
    swap to get a side effect. Waiting for the view before the first layout
    would need a change to `mountPanel` and would take away the very thing this
    panel exists to measure at 10,000 rows: rows that arrive after the mount.
