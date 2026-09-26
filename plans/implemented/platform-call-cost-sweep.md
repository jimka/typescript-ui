---
touches-shared:
  - packages/qa/src/harness/counters.ts
  - packages/qa/src/harness/types.ts
  - packages/qa/src/harness/run.ts
  - packages/qa/src/harness/ablations.ts
  - packages/qa/bin/qa-table.py
  - packages/qa/bin/qa-ab.py
  - packages/qa/README.md
---

# Platform-Call Cost Sweep — Implementation Plan

## Overview

The render-review campaign's instrument counts framework bookkeeping — method entries, DOM seam calls, style writes — and the campaign has just established that this bookkeeping is nearly free on WebKitGTK, while the one candidate that moved real time moved no counter at all ([`00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md), *Judged again*). G23's win was `Intl.DateTimeFormat` construction inside [`temporalText.ts:25-36`](packages/lib/src/typescript/lib/data/temporalText.ts#L25) — a **platform call**, which no counter in the harness watches.

This plan builds the instrument that finds costs of that shape, and the rule that turns a reading into a decision. It adds one counter family (`plat=1`) that tallies six platform functions, eight *dose* ablations that measure what one of those calls costs by making the page do it twice or five times, one analyser (`bin/qa-price.py`), and a scripted sweep (`sweeps/plat.sh`) of 84 runs in one session. Everything is inside the private `packages/qa` package; the library is not touched, and neither is `packages/qa/src/panels/`.

The sweep's product is not a set of counts. A count is used for two things only: to nominate a call for pricing, and — multiplied by the largest per-call price this campaign has ever measured — to close a call that cannot possibly matter. Every number that becomes a verdict is a **millisecond reading from a dose arm**, scored by the same bracket rule as every other cell in the campaign.

---

## Architecture Decisions

### The sweep prices an operation; it does not count one

A counter says how often something happens. A *dose arm* says what it costs: it makes the page perform the operation one extra time per real call and returns the second result, so the arm is behaviour-identical and its Δms is the operation's cost in milliseconds per unit. That reading is the candidate's ceiling directly — no arithmetic over a count, and no new statistics, because `qa-ab.py`'s bracket rule already scores it. The precedent is [`g20WalkDose`](packages/qa/src/harness/ablations.ts#L1670) (`ablations.ts:1670`), the campaign's one existing dose arm, which prices a per-event ancestor walk by running its two pure reads twice.[^dose-not-count]

### Four calls are instrumented; three of the five named candidates are dropped offline

`Intl.NumberFormat` and `Intl.Collator` have no call site in the library, and `RegExp` is constructed only twice, both at module level. Those three are dropped here, on the grep, rather than measured. What replaces `Intl.Collator` is `String.prototype.localeCompare`, which is the same per-call platform construction wearing a different name.

| Counted call | Library call sites | Evidence that it is per cell, per row or per frame |
|---|---|---|
| `date.toLocaleDateString`, `date.toLocaleTimeString`, `date.toLocaleString` | [`temporalText.ts:26,29,34`](packages/lib/src/typescript/lib/data/temporalText.ts#L26) | `temporalDisplayText` is called once per rendered cell by the three temporal cell renderers ([`renderer/Date.ts:40`](packages/lib/src/typescript/lib/component/table/cell/renderer/Date.ts#L40), [`Time.ts:43`](packages/lib/src/typescript/lib/component/table/cell/renderer/Time.ts#L43), [`DateTime.ts:42`](packages/lib/src/typescript/lib/component/table/cell/renderer/DateTime.ts#L42)) and once per filter chip ([`FilterDescriptor.ts:78`](packages/lib/src/typescript/lib/data/FilterDescriptor.ts#L78)). Measured at about 321 a unit on `table-rows` n=900. |
| `string.localeCompare` | [`compareValues.ts:59`](packages/lib/src/typescript/lib/data/compareValues.ts#L59) | `compareValues` is the single comparator of `AbstractStore` ([`AbstractStore.ts:1994`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1994)) and `StoreWorker`. A string-column sort calls it about *n* log *n* times: roughly 8,800 calls for one sort of 900 rows. |
| `style.getComputedStyle` | [`DOM.ts:2800,3092,3104,3118`](packages/lib/src/typescript/lib/core/DOM.ts#L3092) and two font probes at `:2730,:2768` | `isRenderedVisible` (`DOM.ts:3118`) calls it **once per ancestor**, and is itself called once per focusable candidate from [`Focusable.ts:161`](packages/lib/src/typescript/lib/core/Focusable.ts#L161) and [`SpatialNavigation.ts:361,507`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L361). `getBorderWidths` (`:3092`) is one read per rendered cell on a wide table's column-window slide ([`BorderWidths.ts:5-9`](packages/lib/src/typescript/lib/core/BorderWidths.ts#L5)). |
| `canvas.measureText` | [`DOM.ts:2748,2752,2755,2789`](packages/lib/src/typescript/lib/core/DOM.ts#L2748) | `measureTextAdvance` calls it once per word of a run plus once for the space, and the baseline probe once per metrics generation. |

`Intl.DateTimeFormat` itself is deliberately **not** wrapped: `Date.prototype.toLocaleDateString` constructs the formatter from the intrinsic, not from the global binding, so a wrapper on `Intl.DateTimeFormat` would count zero for every library call. The three `Date.prototype` entries are the only countable proxy for the construction.[^intrinsic]

### The counter is a counter family; the dose is an ablation

`plat=1` installs `installPlatformCounters()` in [`counters.ts`](packages/qa/src/harness/counters.ts#L743), beside `installSeamCounters`, and its tallies land in a new `plat` field of `PhaseReport` — the same shape as `seam`. It patches global prototypes, which is what [`installWriteCounters`](packages/qa/src/harness/counters.ts#L236) already does for `Element.prototype`, `CSSStyleDeclaration.prototype` and `window.getComputedStyle`: this is that pattern applied to compute rather than to DOM writes.[^family]

The eight dose arms live in [`ablations.ts`](packages/qa/src/harness/ablations.ts#L1670) beside `g20WalkDose` and are selected with `abl=`, like every other arm. Of the four operations they dose, two are dosed on a global prototype and two on `lib.DOM.source`.

### A dose ladder of two rungs

Each priced operation gets two arms: `-d1` adds one extra call per real call, `-d4` adds four. `-d1`'s Δms is the reading; `-d4` exists for two reasons. It resolves a cost four times smaller than the cell's *bracket* — the spread between the cell's largest and smallest plain average, which is the campaign's threshold for a real timing difference — and where both rungs clear the bracket it checks that repeating the call is linear. If it is not, the engine is serving the repeat from a cache and the reading is a weaker lower bound than it looks.[^ladder]

### A dose reading is a lower bound on the saving, and the plan says so everywhere

The library makes the call once; a dose measures the *second* call. A repeated call is at most as expensive as the first, because every cache the engine or the library holds is warm by then, so a dose's Δms is at most what removing the call would save.[^lower-bound] Two consequences are built into the rules below: a reading that clears the bar **proves** a candidate, and a reading that does not **never** closes one — only the count arithmetic can.

### The date entries are the calibration control

`cacheDateFormatters` ([`ablations.ts:1943`](packages/qa/src/harness/ablations.ts#L1943)) already removes the date formatting entirely and measured −29.04 ms per unit on `table-rows` n=900 `update=filter`. So one operation's true removal cost is known, and the dose of that same operation on that same cell must land near it. This is a pre-registered check on the instrument itself, not on the library.

**Gate 0 — the method works.** On cell `t9u`, `plat.intl-d1`'s Δms must fall between 14.5 and 43.6 ms, that is within ±50% of 29.04. If it does not, the dose method under-reads on this engine, and every other reading in the sweep is recorded as a bound only, with no `plan it` verdict available.

### Gate 1 — a census count meets a prior price

The census stage runs one plain run per panel and tallies `plat`. A call is nominated for a pricing cell when its count could reach half a millisecond a unit at the best price already known for it. Half a millisecond is the floor of what any cell in this campaign has resolved: the tightest plain bracket recorded is 0.24 ms and the usual range is 1.4 to 3.8 ms.

threshold = ⌈500 µs ÷ prior price⌉ calls per unit.

| Call | Prior price | Where the prior comes from | Gate 1 threshold |
|---|---|---|---|
| the three `date.*` entries, summed | 90 µs | 29.04 ms ÷ 321 calls, G23's `update=filter` cell | 6 per unit |
| `string.localeCompare` | 5 µs | G27's upper bound on a source read | 100 per unit |
| `style.getComputedStyle` | 5 µs | the same | 100 per unit |
| `canvas.measureText` | 5 µs | the same | 100 per unit |

Worked cases, against the counts the campaign already has:

| Census reading | Arithmetic | Gate 1 |
|---|---|---|
| `date.*` 321 per unit on `t9c` | 321 ≥ 6 | **price it** |
| `string.localeCompare` 8,800 per unit on `t9c` | 8,800 ≥ 100 | **price it** |
| `style.getComputedStyle` 3 per unit on `twh` | 3 < 100 | **skip it** — Gate 3 then decides it on the count alone |

### Gate 2 — the reading is trustworthy

A price is read only from a cell that `qa-ab.py` passed: `geom` `=` and `engaged` `yes` for the arm. Three further checks, all pre-registered:

1. **Self-verification.** Every hundredth extra call compares its result with the first call's and bumps `dose.<arm>.resultMismatch` when they differ. Each pricing cell declares `--same work.dose.<arm>.resultMismatch`, so any mismatch at all voids the cell.[^selfcheck]
2. **Dose fidelity.** `dose.<arm>.extraCall` per unit at the `-d4` rung must be 4 times the `-d1` rung's, within 5%. A ratio below 4 means the `-d4` arm did not reach every call site the `-d1` arm did.
3. **Linearity**, when both rungs clear the bracket. `|Δms(d1) − Δms(d4) ÷ 4| ÷ Δms(d1)` must be at most 0.5. A failure is recorded beside the reading; it does not void the cell, because `Δms(d1)` remains the better estimate.

### Gate 3 — the verdict

*count* is the call's census count per unit, taken from the cell's own plain arms. *ceiling* is `Δms(d1)` when the `-d1` arm clears the bracket; otherwise `Δms(d4) ÷ 4` when the `-d4` arm does; otherwise there is no ceiling. *share* is ceiling ÷ the phase's plain mean `avg`.

The first row that applies decides:

| Order | Condition | Verdict |
|---|---|---|
| 1 | ceiling ≥ 1.0 ms per unit **and** share ≥ 5% | **plan it** |
| 2 | count × 90 µs < 1.0 ms per unit, that is count < 12 per unit | **drop it** |
| 3 | otherwise | **needs a removal arm** |

Worked cases:

| Reading | Arithmetic | Verdict |
|---|---|---|
| `date.*` on `t9u`: Δms(d1) +28.89, count 321/u, avg 156.69 | ceiling 28.89 ms, share 18.4% | **plan it** |
| `style.getComputedStyle` on `t9k`: d1 +0.50 inside a 0.80 bracket, Δms(d4) +2.00 outside it, count 140/u, avg 16.0 | ceiling 0.50 ms, share 3.1% — row 1 fails, row 2 fails (140 ≥ 12) | **needs a removal arm** |
| `style.getComputedStyle` on `twh`: never priced, count 3/u | no ceiling; 3 < 12 | **drop it** |

Row 1 is set from what this campaign has and has not been able to resolve: G23's accepted win was 18.5% and 29 ms; G21's rejected effect was 0.8% and 0.30 ms on a cell that "cannot resolve it" below 2.5%. The 1.0 ms floor plays the part `WORK_WIN_MIN_PER_UNIT` plays in [`qa-ab.py:51`](packages/qa/bin/qa-ab.py#L51) — it stops a large share of a tiny absolute cost from passing. Row 2 uses the same 1.0 ms, against the largest per-call price this campaign has measured: a call too rare to reach one millisecond a unit even at 90 µs cannot reach it at any price, and counts are deterministic, so that row closes a call without pricing it at all. **Needs a removal arm** means the next step is a memo measured as a removal, the way `cacheDateFormatters` measured G23; that arm is out of scope here.

### The shim's own cost is measured, not asserted

Every wrapper is one `counting` test and one increment against a key that is a precomputed module constant, never a string built per call. Because every arm of a cell carries `plat=1`, the wrapper cost is identical in the plain and dose arms and cancels in Δms. That is asserted nowhere: batch `p01` measures it, and the sweep stops if it is visible.

**The overhead witness.** Three plain runs with `plat=1` (`ohw`) and three without (`ohn`), on the highest-count cell of the sweep. The two groups' `avg` ranges must overlap — `min(ohw) ≤ max(ohn)`. If they do not, the shim costs measurable time on the busiest surface in the sweep and the run stops there, before any price is read.[^overhead]

No wrapper reads `performance.now()`.[^no-clock]

### One instrument set, with one declared exception

Every run carries `work=1&seam=1&geom=1&plat=1` and nothing else, mirroring the W3.0 sweep's rule ([`w3-0-bounding-sweep.md`](plans/implemented/w3-0-bounding-sweep.md#L80), *One instrument set for every run*). The single exception is the `ohn` cell of batch `p01`, whose whole purpose is to run without `plat=1`.

### The first run of an invocation is discarded

The campaign has a recorded cold-start outlier of 97.69 ms against 31 to 36 for the rest of its cell. The script therefore opens with one throwaway run named `plat<session>-warm`, which no cell prefix matches and no analyser reads.

### `qa-price.py` reads the price; `qa-ab.py` still reads the gates

A new self-contained script beside the other three in `bin/`, with two modes: `--census` prints one row per run, phase and call with the Gate 1 arithmetic, and the default mode reads one pricing cell and prints the ladder, the ceiling and the Gate 3 verdict. It does not re-implement the geometry or engagement gates — those stay in `qa-ab.py`, which each pricing cell is also read with.[^two-scripts] `qa-table.py` gains `--plat`, listing the family under a phase's row exactly as `--seam` does. `qa-ab.py` gains `plat` as a keyed counter family, so `--counter plat.<key>` works and a dose arm's residual platform count is visible; its `dose:` share line is framed on seam-source calls and is context only here.

### Results go to a new dated record

The orchestrator writes `plans/research/render-review-2026-09-15/95-platform-call-cost-sweep.md` once the runs exist. This plan does not create it.

---

## Public API

None. Everything is internal to the private `packages/qa` workspace package; nothing is exported from `@jimka/typescript-ui`.

---

## Internal Structure

### `src/harness/types.ts`

```ts
/** One driven phase of a run. */
export interface PhaseReport {
    // … existing fields unchanged …
    /** `seam=1`: DOM seam calls by method name, per unit. */
    seam?: { sink: Record<string, number>; source: Record<string, number> };
    /** `plat=1`: platform calls by name, per unit. */
    plat?: Record<string, number>;
    // … `geometry` unchanged …
}
```

### `src/harness/counters.ts`

```ts
/** The counter fields of one phase's report. */
export type PhaseCounts = Pick<PhaseReport, 'writes' | 'forcedStacks' | 'work' | 'seam' | 'plat'>;

/**
 * Installs the platform-call counters (`plat=1`): the three `Date.prototype`
 * locale formatters, `String.prototype.localeCompare`, `getComputedStyle` and
 * the canvas `measureText`. …
 *
 * @returns A note naming what was wrapped and what the engine does not expose.
 */
export function installPlatformCounters(): string;
```

- `installed` gains `plat: false`; `startCounting` empties `platCounts`; `stopCounting` adds `out.plat = perUnit(platCounts, units)` when `installed.plat`, following the `seam` branch at [`counters.ts:98`](packages/qa/src/harness/counters.ts#L98).
- A module-private `bumpPlat(key: string): void` increments `platCounts[key]` while `counting`, mirroring [`bumpWork`](packages/qa/src/harness/counters.ts#L163). It is not exported and not added to `HarnessTools`: no ablation or panel bumps this family.
- The counter keys are module constants, one per wrapped function, so no key is built per call:

| Key | Wrapped |
|---|---|
| `date.toLocaleDateString` | `Date.prototype.toLocaleDateString` |
| `date.toLocaleTimeString` | `Date.prototype.toLocaleTimeString` |
| `date.toLocaleString` | `Date.prototype.toLocaleString` |
| `string.localeCompare` | `String.prototype.localeCompare` |
| `style.getComputedStyle` | `window.getComputedStyle` |
| `canvas.measureText` | `CanvasRenderingContext2D.prototype.measureText` |

- A target the engine does not expose is skipped and named in the note; `CanvasRenderingContext2D` is absent under jsdom, so the note must say so rather than throw.
- Wrapping `window.getComputedStyle` catches the library's bare `getComputedStyle(…)` calls, because a bare reference resolves the global property at call time. [`installForcedLayoutDetector`](packages/qa/src/harness/counters.ts#L257) already relies on this.

### `src/harness/run.ts`

`instrument` gains one branch, after the seam counters and before the settle sleep:

```ts
if (params.get('plat') === '1') {
    notes.push(installPlatformCounters());
}
```

Installing after the ablations is what makes the counter report the *ablated* page's platform calls, which is the dose-fidelity check's input.

### `src/harness/ablations.ts`

One shared helper and four dose functions, each registered twice.

```ts
/** How often a dose's repeat is checked against its first result: every hundredth extra call, as INTL_CHECK_EVERY does for a cached format. */
const DOSE_CHECK_EVERY = 100;

/**
 * Replaces `host[method]` with one that calls the original `1 + extra` times
 * and returns the *last* result, so the page's behaviour is unchanged while
 * the engine does the work `1 + extra` times. …
 *
 * @param items - How many priced operations one call covers; 1 when omitted.
 * @returns A note, or `NOT FOUND <method> on <host>` when the method is absent.
 */
function doseCalls(tools: HarnessTools, name: string, host: AnyObj, method: string, extra: number, items?: (args: unknown[]) => number): string;
```

`doseCalls` must, per call:

1. run the original once and keep its result as `first`;
2. run it `extra` more times, keeping the last result as `last`;
3. bump `dose.<name>.extraCall` once per extra **operation** — that is `extra × items(args)` times, so the counter's unit is operations, not calls;
4. every `DOSE_CHECK_EVERY`-th extra call, bump `dose.<name>.resultMismatch` when `JSON.stringify(first) !== JSON.stringify(last)`;
5. return `last`.

| Registry name | What it doses | `items` |
|---|---|---|
| `plat.intl-d1`, `plat.intl-d4` | `Date.prototype.toLocaleDateString`, `toLocaleTimeString`, `toLocaleString` | — |
| `plat.collate-d1`, `plat.collate-d4` | `String.prototype.localeCompare` | — |
| `plat.computed-d1`, `plat.computed-d4` | `lib.DOM.source`'s `getThemeVar`, `getBorderWidths`, `getComputedOverflow`, `isRenderedVisible` | — |
| `plat.measure-d1`, `plat.measure-d4` | `lib.DOM.source`'s `measureText`, `measureTextAdvance`, `measureTexts`, `measureTextWidths` | `measureTexts`: `args[0].length`; `measureTextWidths`: `args[0].length` |

Every dosed method is pure — each returns a value derived from its arguments and the page's current style, and writes nothing that survives the call — which is what makes returning the last result behaviour-identical. `ProductionDOMSource.measureText` ([`DOM.ts:2552`](packages/lib/src/typescript/lib/core/DOM.ts#L2552)) appends a probe `<span>` to the body and removes it again before returning, so a second call repeats the insert, the forced layout and the two rect reads, and leaves the document as it found it.

The `plat.computed-*` arms dose the **seam methods**, not `getComputedStyle` itself, because in WebKit the style resolution happens on the first property read of the returned declaration rather than on the call. Doubling `getComputedStyle` alone would price the call and miss the resolution; doubling `getBorderWidths` prices the whole operation, its four property reads included.[^computed-shape]

### `bin/qa-price.py`

```
qa-price.py <results-dir> <prefix> --census
qa-price.py <results-dir> <cell-prefix> --call <plat-key>[+<plat-key>…]
```

Census mode prints one line per run, phase and non-zero `plat` key:

```
plats1-p00-t9c  table-rows  0 click ×150  avg 152.41  date.toLocaleDateString  107.00/u  0.70/ms  prior 90µs → 9.63 ms/u (6.3%)  → price
```

Pricing mode reads the cell's plain arms for `avg`, the bracket and the `--call` count, and each `-d<k>` arm for its Δms and `extraCall`:

```
phase 0  click ×150  call date.toLocaleDateString+date.toLocaleTimeString+date.toLocaleString
  plain           3 reps  mean 156.69  bracket 2.61  count 321.00/u
  plat.intl-d1    2 reps  mean 185.58  Δms +28.89 outside  extra 321.00/u  price 90.0 µs
  plat.intl-d4    2 reps  mean 272.25  Δms +115.56 outside  extra 1284.00/u  price 90.0 µs  fidelity 4.00x
  linearity 0.0%  ok
  ceiling 28.89 ms/u  share 18.4%  → plan it
```

Rules the script implements, and nothing more:

- Arms are paired into a ladder by stripping the trailing `-d<k>`; `k` is the dose factor.
- The bracket is the plain arms' largest average minus their smallest, as [`qa-ab.py:646`](packages/qa/bin/qa-ab.py#L646) computes it. `Δms` prints `outside` when its absolute value exceeds the bracket and `inside` otherwise.
- `price` is `Δms × 1000 ÷ extraCall` µs per operation, printed only for a rung that is `outside`.
- `fidelity` is `extraCall(dk) ÷ extraCall(d1)`, printed on every rung but `-d1`; the script prints `FIDELITY` in place of the number when it is more than 5% from `k`.
- `ceiling`, `share` and the Gate 3 verdict as *Gate 3* states them. When no rung is `outside`, it prints `no ceiling` and applies only the drop row.
- Exit 0 when every report was read; 1 for an unreadable or error report, a cell with fewer than two plain arms, or reports whose phases differ; 2 for bad arguments. This mirrors [`qa-ab.py`](packages/qa/bin/qa-ab.py#L14)'s codes.

### `bin/qa-table.py` and `bin/qa-ab.py`

- `qa-table.py`: a `--plat` flag; `print_details` prints `plat/unit: k=v, …` for every key of at least `WRITES_FLOOR`, exactly as the `--seam` branch at [`qa-table.py:251`](packages/qa/bin/qa-table.py#L251) does.
- `qa-ab.py`: `'plat'` joins the family tuple in [`split_term`](packages/qa/bin/qa-ab.py#L267), and [`counter_family`](packages/qa/bin/qa-ab.py#L240) returns `phase.get('plat') or {}` for it. Nothing else changes.

### `sweeps/plat.sh`

A copy of [`sweeps/w3-0.sh`](packages/qa/sweeps/w3-0.sh)'s structure — `run`, `name`, `arm`, `plain`, `base`, `ab` — with these differences:

- `FLAGS='work=1&seam=1&geom=1&plat=1'` and `FLAGS_NOPLAT='work=1&seam=1&geom=1'`, the latter used by one helper `plain_noplat` for the `ohn` cell only.
- Run names are `plat<session>-<batch>-<cell>-<arm>-<rep>`; `PLAT_SESSION` defaults to `s1`, `PLAT_RUNQA` names the runner.
- Before the first selected batch, one discarded run named `plat<session>-warm` on `p00`'s first cell's parameters. It is counted by `--list` and printed by `--dry-run`, like any other run.
- Batch `p01` has no arms: it calls `plain` three times for `ohw` (reps `a`, `b`, `c`) and `plain_noplat` three times for `ohn`.
- Batches `p00` to `p05`; with no batch named, all six run in order.

---

## The Matrix

Every run is on MiniBrowser and the `main` build. A scored cell is `plain-a`, each arm, `plain-b`, each arm in reverse, `plain-c` — `3 + 2k` runs for `k` arms.

| Batch | Cell | Parameters | Arms | Extra gates | Runs |
|---|---|---|---|---|---|
| `p00` census | one cell per panel, tagged after it | `panel=<id>` at that panel's `defaultDrive` | — (1 plain run each) | — | 21 |
| | `t9c` | `panel=table-rows&n=900&drive=click` | — | — | 1 |
| | `t9u` | `panel=table-rows&n=900&drive=update&update=filter` | — | — | 1 |
| | `t9k` | `panel=table-rows&n=900&drive=key` | — | — | 1 |
| `p01` overhead | `ohw` | `panel=table-rows&n=900&drive=click`, with `plat=1` | — (3 plain runs) | — | 3 |
| | `ohn` | the same, without `plat=1` | — (3 plain runs) | — | 3 |
| `p02` sort and filter | `t9c` | `panel=table-rows&n=900&drive=click` | `plat.intl-d1`, `plat.intl-d4`, `plat.collate-d1`, `plat.collate-d4` | `--same work.dose.<arm>.resultMismatch` per arm | 11 |
| | `t9u` | `panel=table-rows&n=900&drive=update&update=filter` | `plat.intl-d1`, `plat.intl-d4` | the same | 7 |
| `p03` computed style | `t9k` | `panel=table-rows&n=900&drive=key` | `plat.computed-d1`, `plat.computed-d4` | the same | 7 |
| | `twh` | `panel=table-wide&drive=hwheel` | `plat.computed-d1`, `plat.computed-d4` | the same | 7 |
| `p04` text measurement | `tm` | `panel=text-metrics&drive=passes,update:24` | `plat.measure-d1`, `plat.measure-d4` | the same | 7 |
| | `cd` | `panel=chart-dashboard&drive=resize` | `plat.measure-d1`, `plat.measure-d4` | the same | 7 |
| `p05` collation, second surface | `ttk` | `panel=treetable-rows&drive=key` | `plat.collate-d1`, `plat.collate-d4` | the same | 7 |

83 runs in six batches, plus the one discarded warm-up run per invocation: `--list` prints `total 84`. About 45 minutes in one session.

Why these surfaces:

- **`t9c` and `t9u`** are G23's own cells, the only ones with a measured platform cost. `table-rows` sorts on `name`, a string column ([`table-rows.ts:43`](packages/qa/src/panels/table-rows.ts#L43)), and at `n=900` the sort runs **on the main thread**: `AbstractStore` hands a view rebuild to its worker only at 1,000 records or more ([`AbstractStore.ts:16,1920`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L16)). A page-installed shim never sees a worker's calls, and a worker's calls cost no main-thread frame time, so 900 is both the measurable scale and the one that matters.
- **`t9k` and `ttk`** drive arrow-key navigation, which is what reaches `Focusable` and `SpatialNavigation`, hence `isRenderedVisible`.
- **`twh`** slides a wide table's column window, the surface `BorderWidths.ts` names for its per-cell border read.
- **`tm`** re-texts 108 labels per unit with strings absent at mount ([`text-metrics.ts:15,47`](packages/qa/src/panels/text-metrics.ts#L15)), so every measurement misses the library's own cache and reaches a real measurement. **`cd`** re-lays every chart out at a new width every frame, which re-measures the axis labels; it runs at the panel's own defaults so its census row and its pricing cell share one set of parameters. `chart-dashboard`'s `passes` drive is deliberately **not** used: `text-measurement-without-reflow` took its 48 measurements per pass down to none, so a settled pass there has nothing to price.
- `p05` gives collation a second panel, per the README's rule that a cost is checked on two surfaces.
- The `plat.measure-*` arms dose all four measurement seam methods, so a cell prices whichever path the panel takes — the `<span>` probe or the canvas advance — without the plan having to decide which it is in advance.

### Running the sweep (the orchestrator, with the user's go-ahead)

1. From the repository root, on the commit to measure: `npm run build:lib`.
2. `packages/qa/sweeps/plat.sh --list` — expect `total 84`; it opens nothing.
3. `packages/qa/sweeps/plat.sh p00 p01` — the census and the overhead witness.
4. **Read `p01` first.** `qa-table.py packages/qa/results plats1-p01-`. If `min(ohw avg) > max(ohn avg)`, stop and report: the shim is visible and no price is valid.
5. Read the census: `qa-price.py packages/qa/results plats1-p00- --census`. Run only the `p02`–`p05` batches whose calls Gate 1 nominated.
6. Read `t9u` first of the pricing cells and apply **Gate 0** before reading any other.
7. Each pricing cell is read twice: `qa-ab.py packages/qa/results plats1-p02-t9c- --counter plat.<key> --same work.dose.<arm>.resultMismatch` for the gates, then `qa-price.py packages/qa/results plats1-p02-t9c- --call <keys>` for the price.
8. To re-run a batch, give it a new session tag: `PLAT_SESSION=s2 packages/qa/sweeps/plat.sh p03`. A re-run batch is read only against itself.

---

## Ordered Implementation Steps

Work test-first: write each step's cases from *Expected Behaviour*, watch them fail, then implement. **Never run `packages/qa/runqa.sh`, `packages/qa/sweeps/plat.sh` without `--dry-run` or `--list`, MiniBrowser, or the Tauri `qa-host`** — each opens a full-screen window on the user's desktop.

1. **Build the library** from the worktree root: `npm run build:lib`. The QA tests import the build, not the source.
2. **Add the report field.** `src/harness/types.ts`: `plat?: Record<string, number>` on `PhaseReport`, documented as in *Internal Structure*. Check: `npm -w packages/qa run typecheck` passes.
3. **Add the counter family.** Cases 1–7 in `tests/counters.test.ts` first. Then `src/harness/counters.ts`: the six key constants, `platCounts`, `bumpPlat`, `installed.plat`, the `startCounting` reset, the `stopCounting` branch, `PhaseCounts` widened, and `installPlatformCounters()`. Each wrapper tests `counting` and increments with a constant key; a missing target is skipped and named in the note.
4. **Wire the parameter.** `src/harness/run.ts`: the `plat=1` branch in `instrument`, after the seam counters. Check: `grep -n 'plat' packages/qa/src/harness/run.ts` shows only the import and the one branch.
5. **Add `doseCalls`** to `src/harness/ablations.ts`, beside `g20WalkDose`, with `DOSE_CHECK_EVERY`. It returns `NOT FOUND <method> on <class>` and patches nothing when the method is absent, as `countMethod` does at [`counters.ts:588`](packages/qa/src/harness/counters.ts#L588).
6. **Add the four dose functions and eight registry entries.** Cases 8–16 in `tests/ablations.test.ts` first, guarding each patch with `tests/patchGuard.ts`. Each dose function returns one note joining its `doseCalls` notes. The pair for one operation shares a function, taking the factor as an argument — `g09.all` / `g09.chrome`'s shape at [`ablations.ts:2668`](packages/qa/src/harness/ablations.ts#L2668).
7. **Extend `qa-table.py`**: the `--plat` flag and its `print_details` branch.
8. **Extend `qa-ab.py`**: `'plat'` in `split_term`'s family tuple and in `counter_family`. Check: existing `tests/qaAb.test.ts` still passes unchanged.
9. **Write `bin/qa-price.py`.** Its twelve fixture reports under `tests/fixtures/price/` and cases 17–26 in a new `tests/qaPrice.test.ts` first, modelled on `tests/qaAb.test.ts`'s `spawnSync` harness and its copy-and-edit helper. Make the script executable (`chmod +x`), matching the other three.
10. **Write `sweeps/plat.sh`.** Cases 27–34 in a new `tests/platSweep.test.ts` first, modelled on `tests/sweep.test.ts` with `PLAT_RUNQA` pointed at its stub. Build the script from `sweeps/w3-0.sh`'s structure and *The Matrix*'s batches, and `chmod +x` it.
11. **Update `packages/qa/README.md`** in the six places named in *Documentation Impact*.
12. **Run the offline checks** in *Verification*. Do not run the sweep.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/qa/src/harness/types.ts` |
| Modify | `packages/qa/src/harness/counters.ts` |
| Modify | `packages/qa/src/harness/run.ts` |
| Modify | `packages/qa/src/harness/ablations.ts` |
| Modify | `packages/qa/bin/qa-table.py` |
| Modify | `packages/qa/bin/qa-ab.py` |
| Create | `packages/qa/bin/qa-price.py` |
| Create | `packages/qa/sweeps/plat.sh` |
| Modify | `packages/qa/tests/counters.test.ts` |
| Modify | `packages/qa/tests/ablations.test.ts` |
| Create | `packages/qa/tests/qaPrice.test.ts` |
| Create | `packages/qa/tests/platSweep.test.ts` |
| Create | `packages/qa/tests/fixtures/price/` (12 report files) |
| Modify | `packages/qa/README.md` |

---

## Expected Behaviour

### The platform counters — unit, jsdom (`tests/counters.test.ts`)

1. With no counting window open, a wrapped call tallies nothing: call `new Date().toLocaleDateString()` after `installPlatformCounters()` but before `startCounting()`, and `stopCounting(1).plat` is `{}`.
2. Inside a window, three `toLocaleDateString` calls over 3 units give `plat['date.toLocaleDateString'] === 1`, that is the per-unit rounding of [`perUnit`](packages/qa/src/harness/counters.ts#L132).
3. `'x'.localeCompare('y')` tallies `string.localeCompare`, and the wrapper returns the engine's own result unchanged (negative for `'x'` against `'y'`).
4. `getComputedStyle(el)` tallies `style.getComputedStyle` and returns a declaration whose properties still read.
5. A target the engine does not expose is skipped: under jsdom, `installPlatformCounters()`'s note names `CanvasRenderingContext2D` as absent and the call does not throw.
6. `stopCounting` omits `plat` entirely when `installPlatformCounters` was never called, even if other families tallied.
7. `suspendCounting` suppresses platform tallies, like every other family.

### The dose ablations — unit, jsdom (`tests/ablations.test.ts`)

Each case applies the ablation through `ABLATIONS[name](tools, lib)` with `tests/patchGuard.ts` restoring the patched objects afterwards, as the existing ablation cases do.

8. `plat.intl-d1` makes `Date.prototype.toLocaleDateString` run twice: with a spy on the original, one call from the page produces two calls to it.
9. `plat.intl-d1` returns the **second** result: with a spy returning `'first'` then `'second'`, the page sees `'second'`.
10. `plat.intl-d1` bumps `dose.plat.intl-d1.extraCall` once per page call; `plat.intl-d4` bumps it four times.
11. `plat.intl-d4` runs the original five times per page call.
12. `resultMismatch` fires only on disagreement and only every hundredth extra call: with a spy returning a different value each call, `plat.intl-d1` over 200 page calls bumps `dose.plat.intl-d1.resultMismatch` exactly twice; with a constant spy it never bumps.
13. `plat.measure-d1` doses `DOM.source.measureTexts` and bumps `extraCall` once per **request**: a call with three requests bumps it three times; `plat.measure-d4` bumps it twelve.
14. `plat.computed-d1` doses all four source methods and names each in its note.
15. An absent method is reported, not patched: with a `lib.DOM.source` lacking `measureTextAdvance`, `plat.measure-d1`'s note contains `NOT FOUND measureTextAdvance` and the other three are still dosed.
16. Every dose arm leaves the object it patched restorable: after `restorePatchables`, the original method is the own property it was.

### `qa-price.py` — unit, offline (`tests/qaPrice.test.ts`)

Fixtures in `tests/fixtures/price/`. One census report `plats0-p00-fx-plain-a-1000.json` with one `click ×150` phase, `timing.avgMs` 100.00 and `plat` of `{"date.toLocaleDateString": 10.00, "string.localeCompare": 50.00}`. One pricing cell `plats0-p02-fx-` of eleven reports, epoch-ordered, all with one `click ×150` phase, geometry equal and no `resultMismatch`:

| Run | `avgMs` | `dose.<arm>.extraCall` | `plat.date.toLocaleDateString` | `plat.string.localeCompare` |
|---|---|---|---|---|
| `plain-a`, `plain-b`, `plain-c` | 100.00, 101.00, 102.00 | — | 100.00 | 100.00 |
| `plat.intl-d1-1`, `-2` | 111.00, 113.00 | 100.00 | 200.00 | 100.00 |
| `plat.intl-d4-1`, `-2` | 143.00, 145.00 | 400.00 | 500.00 | 100.00 |
| `plat.collate-d1-1`, `-2` | 101.50, 102.50 | 100.00 | 100.00 | 200.00 |
| `plat.collate-d4-1`, `-2` | 108.00, 110.00 | 400.00 | 100.00 | 500.00 |

17. Census mode prints one line per non-zero key. `date.toLocaleDateString` at 10.00 per unit prints `prior 90µs → 0.90 ms/u (0.9%)` and `→ price`, because 10.00 ≥ 6. `string.localeCompare` at 50.00 prints `→ skip`, because 50.00 < 100.
18. A census phase with no `plat` field prints no line for that phase and exits 0.
19. Pricing mode on `plat.intl`: bracket 2.00, count 100.00, `Δms(d1)` +11.00 `outside`, price 110.0 µs; `Δms(d4)` +43.00 `outside`, price 107.5 µs, fidelity 4.00x; linearity `|11.00 − 10.75| ÷ 11.00` = 2.3%, `ok`; ceiling 11.00 ms, share 10.9%, verdict **plan it**.
20. Pricing mode on `plat.collate`: `Δms(d1)` +1.00 `inside`, so no price from `d1`; `Δms(d4)` +8.00 `outside`, price 20.0 µs, ceiling `8.00 ÷ 4` = 2.00 ms, share 2.0% — row 1 fails on share, row 2 fails because count 100.00 ≥ 12 — verdict **needs a removal arm**.
21. The drop row: on a copy of the cell whose every `dose.plat.collate-*.extraCall` and `plat` count is 1.00 and whose dose `avgMs` are inside the bracket, the verdict is **drop it** and the line reads `no ceiling`.
22. A fidelity failure prints `FIDELITY`: on a copy whose `plat.collate-d4` reports `extraCall` 300.00, the `d4` line carries `FIDELITY` in place of `4.00x`.
23. `--call a+b` sums both keys' plain counts and prints both in the phase header.
24. A `--call` key no report carries counts 0, and the verdict is **drop it** — not an error, because a count of zero is a real reading.
25. Exit 1 for a cell with one plain report, for an unreadable file, and for a report carrying `error`; exit 2 for a missing `--call` in pricing mode, for a `--call` with an empty term, and for a mode given neither `--census` nor `--call`.
26. A cell whose reports' phase drivers differ exits 1 with the same message shape `qa-ab.py` prints.

### `sweeps/plat.sh` — unit, node (`tests/platSweep.test.ts`)

Mirroring `tests/sweep.test.ts`, with `PLAT_RUNQA` pointed at a stub that records its arguments.

27. `--list` prints each batch's count and `total 84`, and starts nothing.
28. `--dry-run p02` prints 19 `runqa` lines: the warm-up, then `t9c`'s 11 and `t9u`'s 7, each cell in the `ab` order `plain-a`, each arm, `plain-b`, each arm reversed, `plain-c`.
29. In a full `--dry-run`, every run but `ohn`'s three carries `work=1&seam=1&geom=1&plat=1`; `ohn`'s three carry the same without `plat=1`.
30. Each arm run carries `abl=<arm>` and its name ends `-<arm>-<rep>`.
31. `PLAT_SESSION=s2` puts `plats2-` on every name.
32. The first run of any invocation is named `plat<session>-warm`, and no cell prefix matches it.
33. An unknown batch exits 2 and prints nothing.
34. A failing run stops the sweep with exit 1 and the later runs are not started.

### Manual, in the engine (the orchestrator, with the user's go-ahead)

35. The sweep itself. Nothing in this list is automatable: every run opens a window.

---

## Verification

Offline only. No command below opens a window.

```sh
npm run build:lib
npm -w packages/qa run typecheck
npm -w packages/qa test
python3 -B packages/qa/bin/qa-price.py --help
packages/qa/sweeps/plat.sh --list          # expect: total 84
packages/qa/sweeps/plat.sh --dry-run p02   # expect: 19 runqa lines, none started
```

Invariants:

```sh
# The four dose functions, registered twice each: eight distinct abl= names.
grep -o "'plat\.[a-z0-9-]*'" packages/qa/src/harness/ablations.ts | sort -u | wc -l   # expect 8
# No wrapper reads the clock.
grep -n 'performance.now' packages/qa/src/harness/counters.ts  # expect no match
# Every platform counter key is a constant, not built per call.
grep -n 'bumpPlat(`' packages/qa/src/harness/counters.ts       # expect no match
# The scripts are executable, as the other three are.
test -x packages/qa/bin/qa-price.py && test -x packages/qa/sweeps/plat.sh
```

---

## Documentation Impact

`packages/qa/README.md`, six places. `packages/qa` is private and not in the API docs build, so `npm run docs:api` is unaffected.

1. *URL parameters*: a `plat=1` row — "platform-call counters", default off.
2. *Report format*: `plat` in the `phases[]` row.
3. *Built-in ablations*: the eight `plat.*` entries, with what each doses and that it returns the last result.
4. *Analysers*: `qa-price.py`'s two modes in the command block and a paragraph describing both, beside the `qa-ab.py` one; `--plat` in the `qa-table.py` paragraph.
5. *Sweeps*: `sweeps/plat.sh`, its options and variables, pointing at this plan.
6. *Measurement rules*: one new rule — **a count is not a cost; price it.** A counter proves an arm engaged and stayed correct; its magnitude is not milliseconds. Four of the five candidates the W3.0 sweep surfaced moved large counters and no time, and the one that moved time moved no counter.

---

## Potential Challenges

- **`t9c`'s plain bracket is wide.** In G23's sitting the same cell's `click` phase bracketed 20.31 ms against a 152 ms unit, so a `-d1` rung worth less than 20 ms reads `inside` there and yields no price. Mitigation: Gate 0 is taken on `t9u`, whose bracket was 2.61, and the `-d4` rung exists to resolve a cost a quarter of whatever the bracket turns out to be.
- **A dose changes the frame budget.** A `-d4` rung on an expensive call can double a unit's duration, and an eased driver whose easing is wall-clock-based would then lay out differently. Mitigation: no cell in *The Matrix* uses an eased driver for a dose; the geometry gate voids the cell if it happens anyway.
- **`plat.measure-*` doubles a DOM insert and a forced layout.** Mitigation: `ProductionDOMSource.measureText` removes its probe before returning, so the document is unchanged; the geometry gate and `resultMismatch` both cover it, and the sweep carries no `count=1`, so the mutation counters cannot be confused by it.
- **The census count for a call made in the store worker is always zero.** Mitigation: every collation cell runs below `WORKER_THRESHOLD` (`n=900`, and `treetable-rows`' default 200); the plan states why that is the scale that matters rather than a limitation.
- **`Intl` construction cannot be counted directly.** Mitigation: the three `Date.prototype` entries are counted instead, and *Architecture Decisions* records why a wrapper on `Intl.DateTimeFormat` would read zero.
- **A jsdom run has no canvas context.** Mitigation: `installPlatformCounters` skips an absent target and names it in the note; case 5 pins that.
- **Gate 0 could fail.** Then the dose method under-reads on this engine and the sweep yields bounds only. That is a declared outcome, not a failure to recover from: the record says so and no `plan it` verdict is available.

---

## Critical Files

| File | Why the implementer must read it |
|---|---|
| [`packages/qa/src/harness/ablations.ts:1670`](packages/qa/src/harness/ablations.ts#L1670) | `g20WalkDose`, the dose-arm precedent this plan follows. |
| [`packages/qa/src/harness/ablations.ts:1943`](packages/qa/src/harness/ablations.ts#L1943) | `cacheDateFormatters`, the self-verification precedent and the calibration control's source. |
| [`packages/qa/src/harness/counters.ts:743`](packages/qa/src/harness/counters.ts#L743) | `installSeamCounters`, the counter-family shape `plat` copies. |
| [`packages/qa/src/harness/counters.ts:236`](packages/qa/src/harness/counters.ts#L236) | `installWriteCounters`, which already patches global prototypes and `window.getComputedStyle`. |
| [`packages/qa/src/harness/run.ts:240`](packages/qa/src/harness/run.ts#L240) | `instrument`'s install order, which the new branch joins. |
| [`packages/qa/bin/qa-ab.py`](packages/qa/bin/qa-ab.py) | The bracket rule, the counter-term families, and the exit codes `qa-price.py` mirrors. |
| [`packages/qa/bin/qa-table.py:237`](packages/qa/bin/qa-table.py#L237) | `print_details`, which `--plat` extends. |
| [`packages/qa/sweeps/w3-0.sh`](packages/qa/sweeps/w3-0.sh) | The sweep script's structure, helpers and cell shapes. |
| [`packages/qa/tests/qaAb.test.ts`](packages/qa/tests/qaAb.test.ts) | How a Python analyser is tested offline, and the copy-and-edit fixture helper. |
| [`packages/qa/tests/patchGuard.ts`](packages/qa/tests/patchGuard.ts) | `snapshotPatchables` / `restorePatchables`, which every dose-arm case must use so a patched global prototype does not leak between cases. |
| [`packages/qa/tests/sweep.test.ts`](packages/qa/tests/sweep.test.ts) | How a sweep script is tested with a stub runner. |
| [`packages/qa/README.md`](packages/qa/README.md) | The six sections to update, and the measurement rules the sweep obeys. |
| [`plans/implemented/w3-0-bounding-sweep.md`](plans/implemented/w3-0-bounding-sweep.md) | The bounding-sweep precedent: cell shape, pre-registered thresholds, run naming, result recording. |
| [`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md) | *Judged again* (2026-09-26): the finding this plan answers and the standing priority rule. |
| [`packages/lib/src/typescript/lib/data/temporalText.ts`](packages/lib/src/typescript/lib/data/temporalText.ts) | The one platform cost already priced. |
| [`packages/lib/src/typescript/lib/data/compareValues.ts`](packages/lib/src/typescript/lib/data/compareValues.ts) | The collation call site, and the only one. |
| [`packages/lib/src/typescript/lib/core/DOM.ts:2552`](packages/lib/src/typescript/lib/core/DOM.ts#L2552) | `measureText`'s probe path, and the four `getComputedStyle`-backed source methods below it. |

---

## Non-Goals

- **No library change.** The sweep measures; a fix is a later plan.
- **No panel change.** Every surface in *The Matrix* exists today with the parameters given. A sibling plan is adding a body row-filter surface to the panels; this plan neither needs nor touches it.
- **No removal arm.** Gate 3's middle row names one as the next step for a candidate it cannot decide; building a memo and proving it sound is a plan of its own, as `cacheDateFormatters` was.
- **No `Intl.NumberFormat`, `Intl.Collator` or `RegExp` counter.** No library call site exists for the first two, and `RegExp` is constructed twice, both at module level in [`dateMath.ts:30,33`](packages/lib/src/typescript/lib/component/input/dateMath.ts#L30). A counter over any of the three would report zero by construction.
- **No regex-execution counter.** Wrapping `RegExp.prototype.test`/`exec` and the four `String.prototype` regex methods means six wrappers on the hottest primitives in the language, and no per-cell or per-frame regex call site was found to justify them.
- **No per-call timing.** See *The shim's own cost is measured, not asserted*.
- **No Tauri host.** MiniBrowser only, as the W3.0 sweep decided.
- **No run.** The implementer runs nothing that opens a window; the sweep is the orchestrator's, with the user's go-ahead.

---

## Notes

[^dose-not-count]: A counting shim alone would reproduce the mistake this plan exists to correct. The campaign has just spent five candidates learning that counter magnitude is not time: `getScrollMetrics` fell 99.3%, `querySelector` up to 99.9%, and neither moved the clock, while G23 moved the clock 18.5% with its counter flat. A new family of platform counters would be a new set of numbers of unknown worth. Two alternatives to a dose were considered. Timing each call inside the wrapper was rejected, for the reasons the clock-reading note below gives. Building a memo per call and measuring its removal is the G23 shape and gives the true saving rather than a lower bound, but it needs a correct, invalidation-complete cache per call before anything is known about whether the call matters; that is the work Gate 3 defers to a later plan for the calls that earn it.

[^intrinsic]: ECMA-402 specifies `Date.prototype.toLocaleDateString` as constructing `%Intl.DateTimeFormat%` — the intrinsic — so reassigning the `Intl.DateTimeFormat` property has no effect on it. This is also why `cacheDateFormatters` patches `Date.prototype` rather than `Intl`: the precedent had to solve the same problem. A wrapper on the global binding would count only explicit `new Intl.DateTimeFormat` calls, of which the library has none and the QA harness has one, inside the ablation itself.

[^family]: Riding in the `work` family under a new reserved prefix was the alternative. It would need `BOOKKEEPING_PREFIXES` widened in both [`qa-table.py:25`](packages/qa/bin/qa-table.py#L25) and [`qa-ab.py:34`](packages/qa/bin/qa-ab.py#L34) to keep `work/u` comparable with every reading the campaign has already recorded, and would put page work and engine work in one sum. A separate family keeps `work/u` untouched and matches how `seam` was added when the QA app was built.

[^ladder]: One rung would leave two questions open. A dose that reads flat could mean the call is cheap or that the cell cannot resolve it, and a dose that reads high could be the engine paying a one-off cost on the repeat. A second rung at four answers both: it resolves a cost a quarter of the bracket, and the two rungs' implied per-operation prices agree only if repeating the call is linear. Four rather than eight because an eight-fold dose of a 90 µs call at 321 calls a unit would add about 230 ms to a 152 ms unit, and a unit that slow stops being the unit that was measured.

[^lower-bound]: The direction is worth being precise about. WebKit resolves a computed style once per element per mutation and caches it, the engine caches a default collator after the first `localeCompare`, and the library's own `TextMeasure` memoises. So the second call of a pair can be much cheaper than the first, and Δms(d1) ÷ 1 is at most the cost of the call the library actually makes. Δms(d4) ÷ 4 averages calls two to five and is therefore an even weaker bound, which is why Gate 3 prefers the `-d1` rung whenever it resolves. The consequence is asymmetric and deliberate: the sweep can prove a cost and cannot disprove one, so Gate 3's only negative row is the count arithmetic, which is deterministic.

[^selfcheck]: Naming the counter `resultMismatch` rather than `resultMiss` is deliberate, even though [`qa-ab.py:42`](packages/qa/bin/qa-ab.py#L42) excludes a `Miss` suffix from engagement and would therefore keep a mismatching arm from reading as engaged. A `Miss` would also hide the mismatch from the `--same` gate's zero-tolerance comparison, which is the check that actually voids the cell — `SAME_ZERO_TOLERANCE` is 0.01, so a single mismatch in a hundred units fails it. `void` precedes `unreached` in the verdict order, so a mismatching arm is voided before its engagement is consulted either way. `intlMismatch` in `cacheDateFormatters` set the name.

[^overhead]: The witness is the one place in the sweep where two different instrument sets are compared, which the campaign's own rules otherwise forbid. It is sound here because both groups are plain arms of the same cell in the same session and the comparison is of *ranges*, not of means: the claim tested is only that the shim's cost does not lift the whole distribution clear of the unshimmed one. A tighter test would need the shim to be switchable inside one run, which would cost more instrumentation than it measures.

[^no-clock]: `performance.now()` twice around a call costs two clock reads, which on a 1 µs call is the same order as the call. WebKit also coarsens the timer, so a 1 µs call can read as 0 or as one whole tick, and the error does not average out — it biases. A wrapper that timed calls would therefore report a number whose relationship to the truth depends on the call's own duration, which is the quantity being measured. Pricing by dose moves the clock reads outside the measured window entirely: the frame loop already times the unit.

[^computed-shape]: `getBorderWidths` ([`DOM.ts:3092`](packages/lib/src/typescript/lib/core/DOM.ts#L3092)) makes one `getComputedStyle` call and four property reads; `isRenderedVisible` ([`DOM.ts:3118`](packages/lib/src/typescript/lib/core/DOM.ts#L3118)) makes one call and two reads per ancestor. In WebKit the style resolution is triggered by the first property read of the returned live declaration, not by the call, so the platform *count* and the platform *cost* attach to different statements. The counter is on the call, because that is the countable event and its ratio to the seam count is itself the finding — one seam call can be a whole ancestor chain of resolutions. The dose is on the seam method, because that is the smallest pure unit containing the resolution.

[^two-scripts]: Folding the price arithmetic into `qa-ab.py` was considered and rejected. `qa-ab.py`'s `dose_reading` ([`qa-ab.py:605`](packages/qa/bin/qa-ab.py#L605)) frames a dose's work verdict as a share of the phase's seam-source calls, which is G20's question and not this one, and its `cell_verdict` returns `dose` for any dose arm before ms or work is consulted. Reusing that machinery would mean two unrelated dose rules in one function. `bin/` already holds four small single-purpose scripts; a fifth follows the pattern, and reading a cell twice with two scripts is what the W3.0 sweep already does when it scores one cell once per arm with a different `--counter`.

---

## Implementation Notes

Places where the implementation had to settle a question the plan left open, or
extend it. The last three were found by the audit.

**`tests/counters.test.ts` runs under jsdom now.** Cases 4 and 5 need a global
`getComputedStyle` and an absent `CanvasRenderingContext2D`, and vitest's
default environment for that file was `node`, which has neither. The file
gained a `// @vitest-environment jsdom` header; its existing cases are DOM-free
and unaffected, and they pass unchanged. The platform counters are installed
once per file, in a `beforeAll`, because a second install would wrap the
wrappers and tally every call twice; `Date.prototype` and `String.prototype`
are restored with `tests/patchGuard.ts` and `getComputedStyle` by hand, since
it lives on the global object rather than a prototype.

**`qa-price.py`'s summary lines are keyed by their ladder.** The illustrated
pricing output in *Internal Structure* shows `linearity …` and `ceiling …`
unprefixed, which is unambiguous for the one-ladder cell it illustrates — but
*The Matrix*'s `p02` `t9c` cell carries two ladders, `plat.intl` and
`plat.collate`, and so do the plan's own fixtures for cases 19 and 20. Each
ladder's two summary lines therefore carry its name in the same column as its
rungs' arm names. Every token the plan specifies is unchanged.

**A dose's self-verification interval is per dosed method.** *Internal
Structure* says every `DOSE_CHECK_EVERY`-th extra call checks its result
without saying whether the count is the arm's or the method's. It is the
method's: `doseCalls` keeps its own counter, so each of an arm's methods gets
its own check and the helper stays self-contained. Case 12, which doses one
method, reads the same either way.

**The census cells pass `panel=<id>` and nothing else,** so each panel's own
`defaultDrive` applies, as *The Matrix* specifies. `tests/platSweep.test.ts`
asserts the census covers every registered panel exactly once, so a panel added
later fails the test rather than going uncounted.

**A dose of a counted function does not raise that function's `plat` count.**
*Internal Structure* says installing the platform counters after the ablations
"is what makes the counter report the *ablated* page's platform calls, which is
the dose-fidelity check's input." The first half holds; the second does not.
`installPlatformCounters` wraps whatever the ablations left at the call site, so
under `plat.intl-*` or `plat.collate-*` — the two arms that dose the very
function a counter watches — the counter fires once per *page* call and the
plain and dose arms read the same count. Gate 2's fidelity input is
`dose.<arm>.extraCall`, which is correct and unaffected. The install order is
the plan's and is kept; `instrument`'s comment and the README say what it
actually gives, and the `plat` counts of the pricing fixtures' dose arms were
set to the plain arms' values, against the *Expected Behaviour* fixture table's
200.00 and 500.00, because a fixture is a claim about what the harness emits and
no assertion reads those numbers.

**`qa-price.py` gained `--ladder`.** Gate 3's *count* is "the call's census
count per unit", and `--call` names one call — but *The Matrix*' `p02` `t9c`
cell doses two operations, so printing every ladder's verdict against one
`--call` count would print a verdict Gate 3 does not define. One ladder is
priced per invocation: `--ladder` names it, a cell with exactly one needs no
flag, and a cell with several exits 2 naming them. *Running the sweep* step 7's
invocation therefore carries `--ladder` as well, once per call the cell doses.

**`tests/patchGuard.ts` reaches `String.prototype` now.** `plat.collate-*`
patches `String.prototype.localeCompare`, and `patchablesOf` is the single
shared restore list that already holds `Date.prototype` for exactly this reason,
so the new host belongs there rather than in a per-case hand-snapshot. The file
is outside *Files to Create / Modify / Delete*; adding it was the precedent-
conforming fix, and without it `ablations.test.ts`' `afterEach` could not undo a
collation dose.

**`tests/qaAb.test.ts` gained a case for the `plat` counter family.** Step 8
asks only that the existing file still pass unchanged, and *Expected Behaviour*
has no case for `--counter plat.<key>` — but that term is what the sweep's own
read step uses, and `qaAb.test.ts` is the file that covers the same mechanism
for `work` and `seam`. One case was added there.
