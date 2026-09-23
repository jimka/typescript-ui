# Wave-3 implementation measurement — results

Run 2026-09-23 by the orchestrator, in one sitting, against the thirteen
implemented-but-unmerged wave-3 branches. Each plan's recipe — its base SHA,
its cells, its query parameters, its readers and its pass criteria — comes from
that branch's own *Verification* and *Implementation Notes* sections; nothing
here invents a cell or a bound. This file is the record the wave merges on, and
the successor to [`96-w3-0-bounding-sweep.md`](96-w3-0-bounding-sweep.md),
which bounded the same candidates before they were built.

| | |
|---|---|
| Stack measured | thirteen branches, `text-measurement-without-reflow` rooted on `master` `37606021`, tip `feature/tooltip-idle-reattach` at `9ea84575`; each branch's HEAD is the next plan's recorded BASE_SHA |
| Per-plan arms | `main`/`fix` = that plan's own worktree's built `packages/lib`; `wt`/`base` = the worktree of the branch **below** it in the stack. Plan 1's base is `.worktrees/_w3-master`, detached at `37606021` |
| Cumulative arms | `main`/`fix` = the tip worktree, `wt`/`base` = `.worktrees/_w3-master` (`37606021`) |
| Host | MiniBrowser (WebKitGTK `webkit2gtk-4.1`), full screen, one run in flight at a time |
| Instruments | `work=1&seam=1&geom=1` on every one of the 446 runs; `drag-resize-outline-mode` adds `resize=live\|outline` |
| Sessions | `i1` per-plan 06:40–07:52, `stk`+`i1` cumulative 07:53–08:09, `i2` confirmations 08:09–08:13 — one continuous sitting |
| Runs | **446 of 446 succeeded.** 359 per-plan + 67 cumulative + 20 confirmation. No error result, no `NO RESULT`, no retry, and no two reports share a run name, so no cell was silently doubled |
| Analysis | `qa-table.py` plus each recipe's own reader (`--read` for split-collapse and drag-resize, `lsre-read.py` for layout-size-read-economy, the `c21` one-liner for the tooltip witness). `qa-ab.py` is never used: it scores ablation arms, and a library-build arm has no `abl=` and no engagement counters |

Every count below is **per unit**, as the report stores it. The decision rule
is W3.0's, applied by hand: **bracket** is the largest minus smallest `avg` of
the cell's three base runs, **Δms** is the mean of the two fix runs minus the
mean of the three base runs, and a cell is `win` below −bracket, `regress`
above +bracket, `flat` between. Absolutes are comparable only inside one
session; every verdict is read inside its own cell.

Each plan's results live in its own worktree's `packages/qa/results`, because
each plan's runs were launched from that worktree's `runqa.sh`; the cumulative
pass's 67 reports are all in the tip worktree's.

## Verdicts

| Plan | Cells | Verdict | Strongest evidence |
|---|---|---|---|
| `text-measurement-without-reflow` | 9 | **passes**, one geometry caveat | every DOM text probe gone (48, 12, 10, 6, 0.75, 0.5 → 0 per unit); typing −31 to −35 ms; the new `text-metrics` panel −34.6 / −37.0 ms per update frame |
| `chart-repaint-gate` | 5 | **passes** | unchanged passes lose every mark write: `cdq` 4,329 → 125 writes, −10.59 ms; `clq` 1,081 → 30, −2.33 ms; no repaint suppressed in `clu`, `cdu`, `cdd` |
| `motion-transform-inline` | 5 | **passes** | `dgp` −36.20 ms, `ffk` −15.84, `fnk` −17.92, `ffc` −41.31, every rule write turned into exactly one inline write |
| `markdown-lexer-linear-time` | 2 | **passes** | `mdu480` 4,436.53 → 283.42 ms per update; the fix's 480/60 ratio is 2.94 against the base's 26.27 |
| `unchanged-commit-opt-ins` | 13 | **passes on the shell and window cells; two form cells short of their estimate** | shell passes −97% / −96% work and −2.59 / −2.00 ms; resizes −53% / −60% work; `fnq` and `ffq` move −3% / −7%, not the −84% the ceiling ablation promised |
| `layout-size-read-economy` | 8 | **passes on counters; the deep-shell resize costs 1–2 ms** | size-hint calls −16.6% (`sdr`) to −30.0% (`ffh`); `fnq` −0.65 ms, `ffq` −0.52 ms; `sdr` +0.93 then +1.92 ms with every counter falling |
| `split-collapse-static-participants` | 2 | **passes; saving smaller than the recipe's window** | `sidebar.doLayout` 0.16–0.19 → 0.03 per toggle, work −26.9% / −31.9%, frame time flat |
| `drag-resize-outline-mode` | 7 | **passes on the five gutter cells; the accordion gutter and the window edge are not helped** | outline drags −28.5 to −48.7 ms, work 0.2–0.7% of base, the page still and resting exactly where live puts it; `ssc` −0.57 and `we` −2.64 ms, both `flat` |
| `glyph-name-setter` | 2 | **passes** | census 12.03 → 1.03 per tree key (−91.4%) and 282.05 → 75.05 per tree-table toggle (−73.4%); −6.67 and −59.59 ms |
| `list-and-tree-row-economy` | 6 | **passes; the two shell check cells superseded by the opt-ins** | list key writes 604 → 8, 6,004 → 8, 3 → 0; tree passes work 288 → 2 |
| `environment-read-caching` | 4 | **counters pass; the menus criterion is unmet, and its premise disproved by a 10-run probe** | `getThemeVar` 16 / 4 / 1.2 → 0.01, `getViewportSize` −15 / −3 per viewport unit, work −57% / −26%; `mt` reads −0.71 ms on a 2.06 bracket, `flat`, where the plan demanded `win` |
| `event-dispatch-walk` | 3 | **passes** | the ancestor walk 11.98 → 3.04, 17.37 → 4.09 and 24.09 → 3.06 reads per unit (−75%, −76%, −87%); frame time flat |
| `tooltip-idle-reattach` | 5 | **passes** | `ffy` sink 2.74 → 1.02 and `getWindow` 1.73 → 0.01, both exactly −1.72; the C21 witness prints `True` on every run |

## Results by plan

Each table is one plan's cells: the scored phase, the base mean with its
bracket, the fix mean, Δms and its verdict, the plan's own counter, the
per-unit work and DOM writes, the geometry gate and the cell verdict.

### 1. `text-measurement-without-reflow` — 45 runs, prefix `g18i1-`

Base `37606021`. The counter is the plan's own: DOM text probe calls per unit,
`measureText + measureTexts + measureTextWidths`.

| Cell | Phase | Base ms (bracket) | Fix ms | Δms | ms | Probes base → fix | work/u | writes/u | geom | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| `cdt` | type×150 | 49.56 (1.57) | 18.46 | −31.10 | win | 0.75 → 0 | 275.3 = | 20.3 = | `=` | **win** |
| `sdy` | type×150 | 55.31 (2.17) | 21.79 | −33.53 | win | 0.75 → 0 | 2,614.1 = | 192.2 = | `=` | **win** |
| `ssy` | type×150 | 53.53 (2.66) | 18.69 | −34.84 | win | 0.75 → 0 | 2,203.7 = | 140.6 = | `=` | **win** |
| `clq` | passes×150 | 4.79 (0.24) | 2.75 | −2.03 | win | 12 → 0 | 450.0 = | 1,081.0 = | `=` | **win** |
| `cdq` | passes×150 | 23.20 (1.44) | 11.75 | −11.46 | win | 48 → 0 | 1,808.0 = | 4,329.0 = | `=` | **win** |
| `ffc` | click×150 | 63.08 (6.03) | 59.84 | −3.24 | flat | 10 → 0 | 1,288.0 = | 165.0 = | `=` | **win** (counter) |
| `mt` | toggle×150 | 34.38 (0.88) | 33.14 | −1.23 | win | 0.5 → 0 | 886.8 = | 456.7 = | `=` | **win** |
| `tnk` | key×150 | 91.32 (3.22) | 79.87 | −11.45 | win | 6 → 0 | 1,799.5 = | 476.6 = | `=` | **win** |
| `tmu` | update×24 (p0) | 51.66 (4.74) | 17.09 | −34.58 | win | 0.96 → 0 | 13,352.2 = | 946.3 = | `DIFF`, see below | **win** |
| `tmu` | theme×1 | 0.00 | 0.00 | — | flat | 1.00 → 0 | — | — | `=` | **engaged** |
| `tmu` | update×24 (p2) | 53.97 (2.48) | 17.02 | −36.95 | win | 0.96 → 0 | 13,352.2 = | 946.3 = | `=` | **win** |

Criteria 2 (typing Δms ≤ −25 ms), 3 (`cdq` and `tnk` `win`) and 4 (no
`regress`; probes ≤ 0.02 per unit on the fix outside the theme phase) are met
on every cell — the fix arm makes **no** DOM probe call anywhere; what it makes
instead is `measureTextAdvance` on a canvas, 0.75 per typing unit, 0.13 per
combo click, 0.07 per tree key, 4.50 in `tmu`'s first update phase and none
afterwards. Criterion 5 holds too: `getComputedFont` is absent everywhere but
`ffc`, where it reads 0.01 per unit. Work and DOM writes are identical on both
arms in all nine cells, which is what a measurement-path change should do.

Criterion 1, geometry `=` on every row, fails only in `tmu`'s **first** update
phase, and the failure is arm-independent — see *The `text-metrics` panel's
first update phase* below. `cdt` at −31.10 ms is the headline: a status-bar
width measurement, 0.75 per keystroke, was costing about 31 ms of forced
editor re-layout per frame.

### 2. `chart-repaint-gate` — 25 runs, prefix `crgi1-` (+ `crgi2-`)

Base `f573d580`, which carries `text-measurement-without-reflow` — criterion 6
requires it, and it holds: `measureText` is absent from both arms of all five
cells, so F26.2's saving is already in the base and this A/B scores F26.1
alone. The counter is `createElementNS` per unit.

| Cell | Phase | Base ms (bracket) | Fix ms | Δms | ms | `createElementNS` base → fix | `apply` base → fix | work/u | writes/u | geom | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `clq` | passes×150 | 2.74 (0.18) | 0.42 | −2.33 | win | 210 → 0 | 241.00 → 30.00 | 450.0 = | 1,081 → 30 | `=` | **win** |
| `cdq` | passes×150 | 11.49 (0.52) | 0.90 | −10.59 | win | 840 → 0 | 969.00 → 125.00 | 1,808.0 = | 4,329 → 125 | `=` | **win** |
| `clu` | update×150 | 60.52 (1.72) | 60.35 | −0.17 | flat | 208.6 → 208.6 | 239.39 → 238.40 | 448.0 = | 1,074.8 → 1,073.8 | `=` | **no repaint lost** |
| `cdu` | update×150 | 17.07 (0.04) | 17.28 | +0.21 | regress | 208.6 → 208.6 | 239.39 → 238.40 | 448.0 = | 1,074.8 → 1,073.8 | `=` | re-run, see below |
| `cdd` | drag×150 | 72.36 (1.05) | 73.10 | +0.74 | flat | 1,006 → 1,006 | 1,220.03 = | 2,762.0 = | 5,245.1 = | `=` | **no repaint lost** |

Criterion 4's surface guard lands to the hundredth: `apply` falls by 211.00 on
`clq` and 844.00 on `cdq` — the gate's own write plus the 210/840 marks — and
by exactly 0.99 on the two update cells, where the gate spares every real
repaint and only its own signature write disappears. Criteria 1, 2, 3 and 6 are
met on every row. Only `cdu`'s +0.21 ms on a 0.04 ms bracket reads `regress`;
it was re-run in session `i2` and is discussed under *The confirmation re-runs*.

### 3. `motion-transform-inline` — 25 runs, prefix `g28i1-`

Base `e2196b25`. Counter: `setRuleStyles` per unit, with `apply` as its mirror.

| Cell | Phase | Base ms (bracket) | Fix ms | Δms | ms | `setRuleStyles` base → fix | `apply` base → fix | work/u | writes/u | geom | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `ffk` | click×150 | 33.00 (0.84) | 17.16 | −15.84 | win | 0.50 → 0 | 2.50 → 3.00 | 0.5 = | 3.5 = | `=` | **win** |
| `dgp` | pan×150 | 53.25 (0.60) | 17.05 | −36.20 | win | 1.00 → 0 | 0 → 1.00 | 0.0 = | 1.0 = | `=` | **win** |
| `fnk` | click×150 | 34.91 (0.92) | 16.98 | −17.92 | win | 0.50 → 0 | 2.50 → 3.00 | 0.5 = | 3.5 = | `=` | **win** |
| `ffc` | click×150 | 59.19 (3.34) | 17.88 | −41.31 | win | 1.07 → 0.07 | 155.00 → 155.98 | 1,288.0 = | 165.0 = | `=` | **win** |
| `sdh` | drag×150 | 53.30 (0.70) | 52.73 | −0.57 | flat | 6.01 → 6.01 | 132.03 = | 872.0 = | 139.1 = | `=` | **guard holds** |

All three gates pass. Gate 2 is exact in every cell: the rule write does not
disappear, it becomes an inline write of the same count — `ffc` keeps a 0.07
per-unit residue on both counters and `ensureStyleRule` falls 0.06 → 0.05,
which is the one rule the combo still writes. `sdh` is the guard cell: the
deep shell's drag writes 6.01 rules per frame on **both** arms, so the translate
path this plan did not touch is untouched. Gate 3's demand that the fix sit near
the 16.7 ms refresh interval is met on the nose (17.16, 17.05, 16.98, 17.88).
`ffc` was not bounded by W3.0 and turns out to be the largest single frame
saving in the plan.

### 4. `markdown-lexer-linear-time` — 10 runs, prefix `g26lexi1-`

Base `57eb5738` (the Implementation Notes' correction of *Verification*'s
`11ad15eb`). Arms are `wt`/`main`.

| Cell | Phase | Base ms (bracket) | Fix ms | Δms | ms | work/u | writes/u | geom | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `mdu` (n=60) | update×20 | 168.90 (3.53) | 96.37 | −72.53 | win | 384.1 = | 4,285.0 = | `=` | **win** |
| `mdu480` (n=480) | update×20 | 4,436.53 (243.95) | 283.42 | −4,153.11 | win | 384.0 = | 31,955.9 = | `=` | **win** |

The pass condition is the ratio, and it is met with room: the fix's
283.42 ÷ 96.37 = **2.94**, against a bound of 8 and against the base arm's own
4,436.53 ÷ 168.90 = **26.27**. Every seam and work count is identical between
the arms in both cells, so the same document is being lexed and the same DOM
built; only the time changed. The 4.2-second update W3.0 named as the slowest
interaction any panel drives is now 0.28 s.

### 5. `unchanged-commit-opt-ins` — 65 runs, prefix `g9i1-`

Base `8765632c`. Eight scored cells and five gate-only cells (`sdt`, `sst`,
`sd4m`, `ss4m`, `ffy`), which carry no work or time expectation.

| Cell | Phase | Base ms (bracket) | Fix ms | Δms | ms | work/u base → fix | Δ | writes/u base → fix | geom | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| `sdh` | drag×150 | 53.54 (1.64) | 52.72 | −0.82 | flat | 872.0 → 824.0 | −5.5% | 139.1 → 119.1 | `=` | **as specified** |
| `sdr` | resize×150 | 64.91 (1.46) | 63.09 | −1.82 | win | 6,656.0 → 3,154.9 | −52.6% | 472.5 → 264.2 | `=` | **win** |
| `ssr` | resize×150 | 59.17 (2.05) | 56.20 | −2.97 | win | 5,832.6 → 2,336.9 | −59.9% | 345.8 → 138.2 | `=` | **win** |
| `sdq` | passes×150 | 2.75 (0.20) | 0.16 | −2.59 | win | 4,938.0 → 169.4 | −96.6% | 373.0 → 16.2 | `=` | **win** |
| `ssq` | passes×150 | 2.14 (0.17) | 0.15 | −2.00 | win | 4,120.0 → 168.7 | −95.9% | 271.0 → 16.2 | `=` | **win** |
| `fnq` | passes×150 | 7.02 (0.42) | 6.83 | −0.20 | flat | 13,550.1 → 13,080.1 | −3.5% | 588.0 → 572.0 | `=` | **short**, see below |
| `ffq` | passes×150 | 5.45 (0.30) | 5.18 | −0.27 | flat | 11,747.0 → 10,881.0 | −7.4% | 529.0 → 513.0 | `=` | **short**, see below |
| `wq` | passes×150 | 0.27 (0.00) | 0.07 | −0.20 | win | 521.0 → 89.0 | −82.9% | 38.0 → 13.0 | `=` | **win** |
| `sdt` (gate) | toggle×120 | 23.82 (1.68) | 20.20 | −3.62 | win | 1,115.6 → 646.7 | −42.0% | 85.7 → 44.7 | animation, see below | **gate** |
| `sst` (gate) | toggle×120 | 20.30 (1.02) | 18.81 | −1.49 | win | 987.4 → 616.4 | −37.6% | 62.7 → 27.7 | animation, see below | **gate** |
| `sd4m` (gate) | theme×10 | 181.37 (4.67) | 177.72 | −3.65 | flat | 10,489.8 → 7,612.4 | −27.4% | 1,164.8 → 923.5 | `=` | **gate** |
| `ss4m` (gate) | theme×10 | 132.18 (0.55) | 129.72 | −2.46 | win | 8,027.9 → 5,219.9 | −35.0% | 920.1 → 722.8 | `=` | **gate** |
| `ffy` (gate) | type×150 | 17.32 (0.17) | 17.09 | −0.23 | win | 0.0 = | — | 2.7 = | `=` | **gate** |

Criterion 1 holds: geometry is `=` on every scored cell, and the two toggle
cells' differences are the collapse animation on both arms (below). Criterion 3
holds: no scored cell reads `regress`, and three of the five `passes` cells
read `win`. Criterion 2 — each scored cell's `main` work/u within 10% of the recipe's
estimate — holds on six of the eight (`sdh` 824 vs 826, `sdr` 3,154.9 vs 3,175,
`ssr` 2,336.9 vs 2,355, `sdq` 169.4 vs 157, `ssq` 168.7 vs 157, `wq` 89.0 vs
89), with every listed engagement counter moving as tabled:
`doLayout@SelectableListRow` 60.40 → 0 in both resizes, `doLayout@Header` 4 → 0
on `sdh`, `doLayout@WindowHeader` 1 → 0 on `wq`, and a shell pass losing
`doLayout` on `Panel` 13 → 1, `Container` 11 → 0, `CodeEditor` 4 → 0,
`TabButton` 4 → 0 and `Text` 5 → 0.

**`fnq` and `ffq` do not meet criterion 2, by a wide margin.** The recipe
expects 13,550 → 2,210 and 11,747 → 1,887 (−84% each); the measurement gives
13,550.1 → 13,080.1 and 11,747.0 → 10,881.0. The engagement counters say why:
the estimate was read off W3.0's `g09.all` ablation, which opted **every** class
in, while the staged opt-in list this plan actually ships reaches only part of a
form pass — `doLayout@TextField` 16 → 8, `doLayout@Text` 72 → 64,
`doLayout@LabeledGrid` 9 → 8 on `fnq` (2 → 1 on `ffq`), where the ceiling
removed all of them. Nothing regressed and no counter rose; the saving is real
but is a twentieth of the ceiling's on these two panels. The two form-pass cells
are therefore evidence for a later staged opt-in, not for this one.

### 6. `layout-size-read-economy` — 40 runs, prefix `lri1-` (+ `lri2-`)

Base `e6d2701a`. Six scored cells, two gate-only theme cells. Counters are
`lsre-read.py`'s: size-hint calls (`getPreferredSize + getMinSize + getMaxSize`),
`sizeHintMiss` and `getLaidOutComponents`, all per unit.

| Cell | Phase | Base ms (bracket) | Fix ms | Δms | ms | Size-hint calls base → fix | Δ | `sizeHintMiss` | `getLaidOutComponents` | geom | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `sdr` | resize×150 | 63.11 (0.41) | 64.03 | +0.93 | regress | 1,806.4 → 1,506.5 | −16.6% | 686.0 → 616.5 | 464.2 → 399.0 | `=` | re-run, see below |
| `ssr` | resize×150 | 57.96 (3.09) | 55.95 | −2.00 | flat | 1,381.4 → 1,188.5 | −14.0% | 499.1 → 476.5 | 332.2 → 298.0 | `=` | **flat** |
| `fnq` | passes×150 | 6.79 (0.46) | 6.14 | −0.65 | win | 8,271.2 → 6,899.1 | −16.6% | 2,810.5 → 2,568.1 | 1,407.0 → 1,238.2 | `=` | **win** |
| `ffq` | passes×150 | 4.98 (0.22) | 4.46 | −0.52 | win | 6,866.0 → 5,916.0 | −13.8% | 2,340.0 → 2,101.0 | 1,161.0 → 1,009.0 | `=` | **win** |
| `ffh` | passes×150 | 0.10 (0.01) | 0.10 | −0.00 | flat | 160.0 → 112.0 | −30.0% | 78.0 → 63.0 | 18.0 = | `=` | **flat** |
| `cdq` | passes×150 | 0.61 (0.14) | 0.64 | +0.03 | flat | 440.0 → 356.0 | −19.1% | 236.0 → 232.0 | 102.0 → 94.0 | `=` | **flat** |
| `sd4m` (gate) | theme×10 | 179.74 (2.56) | 183.44 | +3.70 | — | 4,992.2 → 6,049.8 | +21.2% | 1,227.2 → 1,853.1 | `doLayout` 179.2 → 266.4 | `=` | **gate met** |
| `ss4m` (gate) | theme×10 | 129.82 (5.00) | 135.56 | +5.74 | — | 3,657.5 → 4,905.0 | +34.1% | 753.8 → 1,401.3 | `doLayout` 100.9 → 177.3 | `=` | **gate met** |

Criterion 1 (geometry `=` in all eight cells, base runs included) holds.
Criterion 4 holds: on both gate-only cells the fix's `doLayout` per theme switch
is **above** the base's, which is the point — the skip gate's text-metrics
condition makes the theme switch re-lay out what it used to keep, and the cost
stays inside its allowance (the opt-ins' own saving on the same cell, −3.65 and
−2.46 ms, plus this A/B's own bracket, 2.56 and 5.00: +3.70 ≤ 6.21 and
+5.74 ≤ 7.46).

Criterion 2 — each counter's Δ% within 2 points of the recipe's offline
derivation, 3 for `getLaidOutComponents` — holds exactly on `sdr` (−10.1%,
−16.6%, −14.0%), `ssr` (−4.5%, −14.0%, −10.3%), `ffh` (−19.2%, −30.0%, 0.0%)
and `cdq` (−1.7%, −19.1%, −7.8%). It does **not** hold on `fnq` and `ffq`,
where the measured absolutes are three to five times the derivation's (`ffq`
2,340 misses against a predicted 430) and the reductions are larger than
predicted, not smaller — the offline derivation for those two cells does not
describe the panel the cell actually drives (`passes=form`, the whole form).
Both move the right way and no counter rose.

Criterion 3 — no scored cell reads `regress` — is the one real failure, on
`sdr`, and it reproduced: +0.93 ms on a 0.41 bracket in `i1`, +1.92 on a 0.70
bracket in `i2`. See *The confirmation re-runs*.

### 7. `split-collapse-static-participants` — 10 runs, prefix `g12i1-`

Base `54d4cf4b`. Read with the plan's own `--read` reader, which gates only the
labels the collapse never moves and skips the units that may still be mid-animation.

| Cell | Phase | Base ms (bracket) | Fix ms | Δms | ms | work/u base → fix | Δ | `sidebar.doLayout` | `main.doLayout` | geom (plan gate) | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `sdt` | toggle×120 | 19.38 (1.50) | 19.52 | +0.14 | flat | 554.03 → 405.06 | −26.9% | 0.16 → 0.03 | 0.17 → 0.17 | `=` | **flat, engaged** |
| `sst` | toggle×120 | 18.60 (0.58) | 18.34 | −0.26 | flat | 518.42 → 353.10 | −31.9% | 0.17–0.19 → 0.03 | 0.18–0.20 → 0.20 | `=` | **flat, engaged** |

Criteria 1, 3 and 4 are met: the plan's geometry gate reads `=` on every run,
both fix runs read `sidebar.doLayout` 0.03 (bound 0.04) with `main.doLayout`
inside 0.03 of the base, and neither cell regresses.

Criterion 2 is not met as written: the windows are −45% to −57% (`sdt`) and
−51% to −65% (`sst`), and the measurement gives −26.9% and −31.9%. The window
was derived from W3.0's ablation against `master`, where a `sdt` toggle cost
1,115.66 work units; by the time this plan's base is reached the opt-ins and the
size-read economy have already taken it to 554.03, so the same kind of saving is
a smaller share of a smaller number. The criterion's own stop condition is a
saving *larger* than the window — a smaller one is not. Note also that these
cells' work counters are not deterministic: the base runs read 554.03/554.03/554.03
on `sdt` but 497.54/539.26/518.45 on `sst`, and the two fix runs of `sdt` read
421.42 and 388.69, because the collapse animation is sampled at different points
from run to run.

### 8. `drag-resize-outline-mode` — 49 runs, prefix `roi1-`

Base `d7bd731d`. Three arms — `base`, `live` and `outline` — and three phases
per run: `drag×150`, `dragout×40`, `idle×4`. Read with the plan's own three-arm
`--read` reader; the table scores phase 0.

| Cell | Base ms (bracket) | live Δms | live Δwork | outline ms | outline Δms | work/u base → outline | `apply/u` | excess removed | gates | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| `sdh` | 53.38 (2.44) | +0.53 flat | +0.0% | 17.01 | −36.37 win | 648.02 → 4.42 | 112.03 → 1.49 | 81% | all | **win** |
| `sd4h` | 53.06 (0.68) | +0.42 flat | +0.0% | 15.44 | −37.63 win | 2,220.02 → 15.38 | 160.03 → 1.81 | 88% | all | **win** |
| `sdv` | 37.96 (0.54) | +0.13 flat | +0.0% | 9.48 | −28.48 win | 294.02 → 1.99 | 78.03 → 1.29 | 102% | all | **win** |
| `sds` | 66.91 (3.32) | −0.02 flat | +0.0% | 18.22 | −48.69 win | 5,831.90 → 17.00 | 551.10 → 1.71 | 85% | all | **win** |
| `sss` | 59.55 (1.49) | +0.12 flat | +0.0% | 12.19 | −47.36 win | 5,218.90 → 13.14 | 434.10 → 1.41 | 95% | all | **win** |
| `ssc` | 12.93 (1.51) | −0.12 flat | +0.0% | 12.36 | −0.57 flat | 1,144.80 → 18.99 | 46.59 → 2.49 | 15% | `still`, `rest` | **flat** |
| `we` | 43.06 (2.83) | −0.28 flat | +1.1% | 40.42 | −2.64 flat | 599.60 → 4.17 | 51.45 → 1.45 | 10% | `rest` only | **flat** |

Criterion 1 (`rest =` on every run of every cell) holds everywhere: whatever the
arm, the layout at rest after the gesture is identical to the base's, which is
the correctness claim outline mode has to make. Criterion 2's live arm is flat
in ms and identical in work in six of seven cells; only `we` moves, +1.1%
against a 0 to +1% allowance, which the recipe already anticipates as the
release frame landing inside the phase.

Criterion 3 holds on the five gutter cells — `still =` (the page does not move),
`outline yes` in every unit of phases 0 and 1 and absent in phase 2, travel
149/149 units, work 0.3–0.7% of the base against a 2% bound, `rules/u` 0.01–0.07
against 0.1, `raf/u` 1.01 against 1.05, and `sidebar.doLayout` 0.01 on `sds`
and `sss` where the base writes 1.00. It fails on `ssc`, whose outline `apply/u`
of 2.49 exceeds its bound of 1.47, and on `we`, whose `still` gate reads
`DIFF(header0, win0)` — see *The window edge* below.

Criterion 4, the recorded-not-blocking one, asks for at least 80% of the drag's
excess over idle removed: five cells give 81–102%, `ssc` 15% and `we` 10%.

### 9. `glyph-name-setter` — 10 runs, prefix `g17i1-` (+ `g17i2-`)

Base `ac017455`. The counter is the plan's census,
`ensureStyleRule + createElementNS + querySelector` per unit, computed by hand.

| Cell | Phase | Base ms (bracket) | Fix ms | Δms | ms | Census base → fix | Δ | work/u | writes/u | geom | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `tnk` | key×150 | 80.78 (2.67) | 74.11 | −6.67 | win | 12.03 → 1.03 | −91.4% | 1,799.5 = | 476.6 → 412.6 | `=` | **win** |
| `ttg` | toggle×20 | 180.23 (8.53) | 120.63 | −59.59 | win | 282.05 → 75.05 | −73.4% | 11,009.0 → 8,996.0 | 4,019.6 → 2,954.6 | `DIFF(1)` on one run | **win** |

Every counter in the recipe's table reproduces to the hundredth on both arms and
in both sessions: `ensureStyleRule`, `setRuleStyles` and `deleteStyleRule`
1.50 → 0 per tree key and 70.50–70.55 → 0–0.05 per tree-table toggle;
`createElementNS` 7.03 → 1.03 and 141.00 → 75.00; `querySelector` 3.50 → 0 and
70.50 → 0; `createElement` 3.50 → 0.50 and 70.50 → 37.50; `removeElement`
3.50 → 0.50 and 141.00 → 75.00; `release` 10.50 → 1.50 and 211.50 → 112.50. The
only departure from the table is a residue of 0.05 per unit on `ttg`'s
`ensureStyleRule` and `setRuleStyles` — one rule write in the 20-unit phase,
present on both arms and in both sessions, where the table predicts a flat 0.
The mount census (`svg` 102/34, `use` 102/33) is equal across all five runs of
each cell, so both arms build the same glyph tree. Frame time is not predicted
by this plan and both cells nonetheless read `win`.

The `DIFF(1)` is on the `focused` label and is arm-independent — see *The
tree-table's `focused` label* below.

### 10. `list-and-tree-row-economy` — 26 runs, prefix `g24i1-`

Base `9cd902a1`. Four scored cells and two shell geometry-check cells of three
runs each.

| Cell | Phase | Base ms (bracket) | Fix ms | Δms | ms | Counter base → fix | Δ | work/u | geom | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| `li3` | key×150 | 16.89 (0.48) | 16.90 | +0.01 | flat | sink 604.00 → 8.00 | −98.7% | 0.0 = | `=` | **win** (work) |
| `li30` | key×150 | 16.98 (0.33) | 16.88 | −0.09 | flat | sink 6,004.00 → 8.00 | −99.9% | 0.0 = | `=` | **win** (work) |
| `li1` | key×150 | 17.05 (0.14) | 17.16 | +0.12 | flat | sink 3.00 → 0.00 | −100% | 0.0 = | `=` | **win** (work) |
| `tnq` | passes×150 | 0.10 (0.02) | 0.01 | −0.09 | win | work 288.00 → 2.00 | −99.3% | sink 1.00 → 0.00 | `=` | **win** |
| `sdq` (check) | passes×150 | 0.18 | 0.13 | −0.05 | — | `apply` 16.15 → 16.13 | — | 167.2 → 165.7 | `=` | **check** |
| `ssq` (check) | passes×150 | 0.19 | 0.17 | −0.02 | — | `apply` 16.15 → 16.13 | — | 166.8 → 165.3 | `=` | **check** |

The four scored cells match the recipe's table exactly, to the hundredth and in
both fix runs: `apply` 603 → 7, 6,003 → 7 and 2 → 0 with `dispatchCustomEvent`
held at 1.00 (0 in `li1`), the source reads unchanged at 3.00 (`intern`,
`getId`, `getScrollMetrics` 1.00 each), and a tree pass losing
`setStyleState@TreeRow` 186, `getPreferredSize@Text` 90 and the scrollbars' 10
hints while keeping `doLayout@Tree` and `getLaidOutComponents@Tree` at 1.00.
Geometry is `=` on every run of every cell, and no cell regresses.

The two shell check cells' **absolute** expectations (`apply` 361 → 359, work
falling by at least 20) do not reproduce, and cannot: they were W3.0's readings
on `83cfb0d7`, and `unchanged-commit-opt-ins`, four branches below this one,
has since taken a shell pass from 4,938 work units to 169. What is left to skip
in a shell pass is 1.5 work units and 0.02 `apply`, which is what the cells
read. The recipe anticipates this in words ("unless a plan that landed since
changed that count"); the check they still perform — geometry `=` and nothing
rising — passes.

### 11. `environment-read-caching` — 20 runs, prefix `g08i1-`

Base `b9c159a3`.

| Cell | Phase | Base ms (bracket) | Fix ms | Δms | ms | `getViewportSize` | `getThemeVar` | work/u base → fix | writes/u base → fix | geom | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `w8v` | viewport×150 | 17.11 (0.33) | 17.08 | −0.03 | flat | 25.00 → 10.00 | 16.00 → 0.01 | 4,903.0 → 2,131.0 (−56.5%) | 550.0 → 226.0 (−58.9%) | `=` | **win** (work) |
| `w4v` | viewport×150 | 17.12 (0.27) | 16.97 | −0.15 | flat | 11.00 → 8.00 | 4.00 → 0.01 | 1,763.0 → 1,301.0 (−26.2%) | 188.0 → 134.0 (−28.7%) | `=` | **win** (work) |
| `wdlg` | toggle×120 | 28.24 (0.35) | 28.52 | +0.28 | flat | 0.05 = | 1.20 → 0.01 | 15.4 = | 15.3 = | `=` | **win** (work) |
| `mt` | toggle×150 | 33.99 (2.06) | 33.28 | −0.71 | flat | 1.00 → 1.00 | — | 805.6 = | 456.7 = | `=` | **criterion unmet** |

Criteria 1, 3, 4, 5 and 6 are met exactly: geometry `=` everywhere including
`min0`, `getViewportSize` down by 15.00 on `w8v` and by 3.00 on `w4v` as
specified, `getThemeVar` at 0.01 against bounds of 0.02 and 0.05, work and DOM
writes down 56.5% / 58.9% on `w8v` (bound 40%) and 26.2% / 28.7% on `w4v`
(bound 15%), and no cell regressing.

**Criterion 2 is not met.** The plan demands that `mt` read `win`, near −1.52 ms,
and says in terms that a `flat` there means `innerWidth` still forces a layout in
this WebKitGTK build and that the reading should be recorded and reported before
merging. The measurement is −0.71 ms on a 2.06 ms bracket: `flat`. The bracket is
the widest of the four cells (base runs 34.75, 32.69, 34.53), so the reading is
as much about the menus cell's variance as about the change. Two other readings
bear on it: the same `mt` cell reads −1.23 ms on a 0.88 bracket in
`text-measurement-without-reflow`'s own A/B, and −3.06 ms on a 0.53 bracket in
the cumulative pass — so a menu toggle does get faster across the wave; it is
this plan's own slice of that which the session could not separate from noise.

**The criterion's inference is disproved, by a 10-run probe.** The criterion
reads a `flat` as evidence that `innerWidth` still forces a layout, which would
make the plan's decision to add no viewport cache wrong. The tested
`g08.env-reads` ablation answers that directly: on this very build it caches the
viewport read per task, and because the library now caches theme variables
itself, what it removes is the viewport half alone. Run against
`.worktrees/_g08-probe` (detached at `586d2102`), prefix `g08p-`, three plain
runs bracketing two ablated ones per cell:

| Cell | Plain ms (bracket) | Arm ms | Δms | ms | Counter plain → arm | Δ | geom | Cell verdict |
|---|---|---|---|---|---|---|---|---|
| `mt` | 31.15 (1.63) | 30.41 | −0.74 | flat | 1.00 → 0.50 | −50.0% | `=` | **flat** |
| `w8v` | 17.10 (0.28) | 16.98 | −0.12 | flat | 10.01 → 1.01 | −89.9% | `=` | **win** (work only) |

Caching the viewport removes half the menus cell's reads and nine tenths of the
dock cell's, and buys no time in either — on `w8v` against the tightest bracket
in this record, 0.28 ms. So the viewport read does not force a layout here, the
plan's no-cache decision stands on its own evidence, and W3.0's −1.52 ms on `mt`
is not reproducible against the library as it now stands. Criterion 2 is unmet
as written; the risk it was written to catch does not exist.

### 12. `event-dispatch-walk` — 15 runs, prefix `edwi1-` (+ `edwi2-`)

Base `586d2102`. The counter is the walk:
`getParentElement + getId + closestWithId` per unit. The scored phase is 0 for
the chart cells and 1 (`hover`) for `ffyh`.

| Cell | Phase | Base ms (bracket) | Fix ms | Δms | ms | Walk base → fix | Δ | work/u | writes/u | geom | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `clh` | hover×150 | 18.11 (0.31) | 17.88 | −0.23 | flat | 11.98 → 3.04 | −74.6% | 2.5 = | 9.5 = | `=` | **win** (work) |
| `cdh` | hover×150 | 19.09 (0.20) | 19.54 | +0.45 | regress | 17.37 → 4.09 | −76.5% | 5.5 = | 10.2 = | `=` | re-run, see below |
| `ffyh` | type×150 (p0) | 17.33 (0.25) | 17.19 | −0.14 | flat | 1.00 → 1.00 | 0.0% | 0.0 = | 2.7 = | `=` | **flat** |
| `ffyh` | hover×150 (p1) | 16.98 (0.41) | 17.11 | +0.13 | flat | 24.09 → 3.06 | −87.3% | 0.0 = | 2.7 = | `=` | **win** (work) |

Criterion 2 holds: `ffyh`'s base rows read `getParentElement` 11.37 per unit in
the hover phase, well over the 5.0 that proves a decorator was in error and the
walk was really being driven. Criterion 3 holds with margin — 74.6% and 76.5%
against a 70% bar, 87.3% against an 80% bar, `getId` 0.00 on `clh`'s fix and
`getParentElement` absent from `ffyh`'s fix (bound 0.05). Criterion 4 holds:
every other seam counter, every sink counter and work/u are identical between
the arms, `intern` included (1.03, 1.05, 2.71). Criterion 1 holds on all four
phases.

Criterion 5 asks for no `regress`, and `cdh` reads +0.45 ms on a 0.20 bracket.
It was re-run; see below.

### 13. `tooltip-idle-reattach` — 19 runs, prefix `g19i1-`

Base `77ce5a1d`; the stack tip.

| Cell | Phase | Base ms (bracket) | Fix ms | Δms | ms | Counter base → fix | Δ | work/u | geom | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| `ffy` | type×150 | 17.41 (0.06) | 17.27 | −0.14 | win | sink 2.74 → 1.02; `getWindow` 1.73 → 0.01 | −1.72 on both | 0.0 = | `=` | **win** |
| `fny` | type×150 | 17.25 (0.63) | 17.41 | +0.16 | flat | sink 1.01 =; source 3.00 = | 0.0% | 0.0 = | `=` | **flat, as specified** |
| `clh` | hover×150 | 18.08 (0.10) | 17.76 | −0.32 | win | sink 9.5 = | 0.0% | 2.5 = | `=` | **counts equal** |
| `cdh` | hover×150 | 19.64 (0.08) | 19.74 | +0.10 | regress | sink 10.2 = | 0.0% | 5.5 = | `=` | see below |
| `c21` | call×120 | 17.73 (0.12) | 17.61 | −0.12 | — | — | — | 0.4 = | witness, not `geom` | **confirmed** |

The base-independent gate the notes name is met exactly: `ffy`'s fix is its base
minus 1.72 on sink calls (2.74 → 1.02, `addListener` 0.87 → 0.01 and
`removeListener` 0.86 → 0) **and** minus 1.72 on `getWindow` (1.73 → 0.01), with
`setValue` held at 1.00. `fny` is flat on every count, as the plan predicts —
its saving is script-side and invisible to the seam. The two chart cells' counts
equal their base runs.

`c21` runs three reps, not five, and its −0.12 ms sits exactly on its two-run
spread, so it makes no timing claim. The C21 witness prints `29 True`, `29 True` and `28 True` on `base-a`, `fix-1`
and `base-b`: the tooltip rectangle is `null` until the hover delay runs out and
then is the same rectangle in every later unit, on both arms. The unit it
appears on differs between the two base runs, which is why the plan makes the
one-liner the gate and not the `geom` column — and indeed `c21`'s `base-b` reads
`DIFF(1)` on exactly that label.

`cdh`'s +0.10 ms sits on a 0.08 ms bracket over three base runs, the tightest
bracket in the whole sweep. Its counts are identical between the arms and this
plan claims no millisecond gain on it; the cumulative pass reads the same cell
at −6.50 ms.

## The cumulative pass — the stack against `master`

67 runs, prefix `stki1-`, all launched from the tip worktree: the whole
thirteen-branch stack (`9ea84575`) as `fix` against `master` `37606021` as
`base`. One cell per plan — the cell that plan's own notes treat as its headline
— run with that cell's own parameters and rep pattern.

| Plan | Cell | Phase | Base ms (bracket) | Fix ms | Δms | ms | work/u base → fix | writes/u base → fix | geom |
|---|---|---|---|---|---|---|---|---|---|
| text-measurement | `cdt` | type×150 | 52.63 (4.21) | 19.49 | −33.14 | win | 275.3 → 258.0 | 20.3 → 17.8 | `=` |
| chart-repaint-gate | `cdq` | passes×150 | 23.13 (0.64) | 0.59 | −22.54 | win | 1,808.0 → 704.0 | 4,329.0 → 53.0 | `=` |
| motion-transform-inline | `dgp` | pan×150 | 54.90 (0.38) | 17.02 | −37.88 | win | 0.0 = | 1.0 = | `=` |
| markdown-lexer | `mdu480` | update×20 | 4,295.51 (8.79) | 156.76 | −4,138.75 | win | 384.0 = | 31,955.9 → 31,909.9 | `=` |
| unchanged-commit-opt-ins | `sdq` | passes×150 | 2.80 (0.08) | 0.17 | −2.63 | win | 4,938.0 → 165.7 | 373.0 → 16.1 | `=` |
| layout-size-read-economy | `fnq` | passes×150 | 6.93 (0.38) | 6.17 | −0.76 | win | 13,550.1 → 11,289.8 | 588.0 → 572.0 | `=` |
| split-collapse | `sdt` | toggle×120 | 22.43 (1.15) | 18.97 | −3.46 | win | 1,084.5 → 399.5 | 83.2 → 42.0 | plan gate `=` |
| drag-resize-outline (live) | `sds` | drag×150 | 66.10 (2.38) | 65.64 | −0.46 | flat | 6,460.9 → 5,831.9 | 551.1 = | `=` |
| drag-resize-outline (outline) | `sds` | drag×150 | 66.10 (2.38) | 18.78 | −47.32 | win | 6,460.9 → 15.51 | 551.1 → 1.69 | `still`/`rest` pass |
| glyph-name-setter | `ttg` | toggle×20 | 174.42 (7.47) | 121.69 | −52.74 | win | 12,089.0 → 8,996.0 | 4,019.6 → 2,954.6 | `=` |
| list-and-tree-row-economy | `li3` | key×150 | 16.84 (0.48) | 17.02 | +0.18 | flat | 0.0 = | 604.0 → 8.0 | `=` |
| environment-read-caching | `mt` | toggle×150 | 33.48 (0.53) | 30.42 | −3.06 | win | 886.8 → 805.6 | 456.7 = | `=` |
| event-dispatch-walk | `cdh` | hover×150 | 25.88 (1.72) | 19.38 | −6.50 | win | 5.5 = | 10.2 = | `=` |
| tooltip-idle-reattach | `ffy` | type×150 | 17.24 (0.61) | 17.37 | +0.13 | flat | 0.0 = | 2.7 → 1.0 | `=` |

Eleven of the fourteen rows read `win`; the two `flat` ones (`li3`, `ffy`) are
vsync-bound cells whose own plans predict flat frame time and score on writes,
which fall 99% and 63%. The live arm of `sds` is flat by design: it is the
unchanged path, and across the whole wave it loses 9.7% of its work and no
measurable time.

Read as a whole, against `master`, the wave turns a 4.3-second Markdown update
into 0.16 s; a 50-chart dashboard's unchanged layout pass from 23.1 ms into
0.59 ms; a diagram pan and a code-editor keystroke from 55 and 53 ms into 17 and
19; a tree-table expand-all from 174 ms into 122; a shell layout pass from 2.8 ms
into 0.17; a chart hover from 25.9 ms into 19.4; and — when an application opts
in — a sidebar drag from 66 ms into 19.

## The confirmation re-runs

Twenty runs in session `i2`, five per cell, base-bracketed exactly as `i1`, for
the three cells whose first reading was a small `regress` and the one cell where
a single run differed on a geometry label.

| Cell | `i1` reading | `i2` reading | Reading |
|---|---|---|---|
| `crgi2-cdu` | +0.21 ms on a 0.04 bracket | +0.38 ms on a 0.33 two-run spread, after excluding a 53.36 ms outlier | the gate's own cost, a few tenths |
| `lri2-sdr` | +0.93 ms on a 0.41 bracket | +1.92 ms on a 0.70 bracket | reproduced; engine-side, see below |
| `edwi2-cdh` | +0.45 ms on a 0.20 bracket | +0.32 ms on a 0.89 bracket, `flat` | sub-half-millisecond |
| `g17i2-ttg` | one **fix** run `DIFF` on `focused` | one **base** run `DIFF` on `focused` | arm-independent, see below |

**The chart gate's dashboard update.** `crgi2-cdu`'s first run, `base-a`, took
53.36 ms per unit where every other run of the cell in either session took
17.03–17.92 — the only outlier of its kind in 446 runs, and the first run of the
`i2` session. Excluding it, the base mean is 17.20 and the fix mean 17.58, so the
gate costs about 0.2 ms (`i1`) to 0.4 ms (`i2`) per update frame on a chart whose
data really changed. Against that, `cdq` shows the gate saving 10.59 ms on every
unchanged pass, with `createElementNS` 840 → 0. The cost is the signature
comparison a changed chart pays and does not use; the accepted trade.

**The dispatch walk's dashboard hover.** +0.45 then +0.32 ms, on brackets of
0.20 and 0.89, on a cell whose base mean moved from 19.09 to 19.14 between the
sessions. Every seam and work counter is identical between the arms in both
sessions, and the walk itself falls 76.5%. The honest reading is that the cost,
if it exists, is under half a millisecond and below what this cell can resolve.

**The layout size-read economy's deep-shell resize.** This one reproduced
cleanly: +0.93 ms and +1.92 ms, each above its own bracket. What the plan's own
instruments say is worth recording exactly. Of the 152 counters the cell
reports — every work counter, every seam source read and every seam sink write —
**none rose**: 51 fell and 101 were unchanged, identically in both sessions.
Size-hint calls go 1,806.4 → 1,506.5, misses 686.0 → 616.5,
`getLaidOutComponents` 464.2 → 399.0, `getPreferredSize@Container` 34 → 0,
`border.getPreferredSize@Border` 15 → 0, and DOM writes are untouched at 264.2.
So the cost is engine-side — work the fix moves rather than removes, invisible to
every instrument the plan ships — and it is small against the session drift on
the same build: the identical `wt` build read 63.11 ms in `i1` and 66.37 ms in
`i2`, a 3.27 ms shift, larger than the effect being measured. Accepted.

## Caveats read across the whole sweep

**The `text-metrics` panel's first update phase is not deterministic.** In
`g18i1-tmu`, six of the 117 labelled rectangles differ between runs — `t0r9`,
`t1r9`, `t2r9`, `t5r9`, `t6r9`, `t7r9` — always in **width** only, always by 1 or
2 px (30/31, 33/35, 26/27, 45/46), always in **unit 0 of the first `update`
phase**, and never afterwards: units 1–23 of that phase, the theme phase and the
whole second `update` phase agree on every label in every run. The split is
across arms, not between them — `base-a` and `fix-2` read one value, `base-b`,
`base-c` and `fix-1` the other — so it says nothing about canvas-versus-probe
parity, which is what the plan's gate exists to test. Every other label in the
panel, and every label in the other eight cells, is identical. The most likely
cause is the panel measuring row 9 before the web font has settled. This is a QA
app defect, not a library one, and it is owed a fix: until the panel's first
update is deterministic, the strongest gate `text-measurement-without-reflow`
has cannot be read cleanly on its own panel. (Its other eight cells, including
three shells and two charts, read `=` throughout.)

**The accordion-toggle and pane-collapse cells differ on both arms.** `sdt`,
`sst` (in both `split-collapse-static-participants` and
`unchanged-commit-opt-ins`) and `sds` show geometry differences on base runs as
readily as on fix runs, because the collapse animation is sampled at different
points from run to run — the same reason their work counters vary run to run.
This is why `split-collapse-static-participants` ships its own reader, which
gates only the labels the collapse never moves and only the units that cannot
still be mid-animation; under that reader both cells read `=` on every run. It is
a behaviour of the measurement, not of the change.

**The tree-table's `focused` label is timing-sensitive.** `ttg` shows exactly one
`DIFF` in each session: on a **fix** run in `i1` and on a **base** run in `i2`.
Since it lands on either arm indifferently, it is a property of the
`treetable-rows` panel's focus timing under a 20-unit expand-all, not of the
glyph-name change. W3.0 saw the same label void two of G22's cells; it is the one
label in the suite that has now been unstable in two independent sweeps.

**The window edge's in-drag geometry is unstable.** In `roi1-we`, base runs
`base-b` and `base-c` each differ from `base-a` on `header0` and `win0` in
exactly one unit of 150 (unit 2: a width of 418 against 421 — one 3 px drag
step), so the two base runs agree with each other and the reference is the odd
one out. The recipe's own rule is that a base run's `drag` `DIFF` voids that
cell's in-drag gate; the cell was not re-run, so `we`'s in-drag gate stays
unresolved and the cell is judged on `rest` and its counters, both of which pass.
The outline arm's `still` `DIFF` on the same two labels is a related artefact: in
phase 0 the window holds its pre-press rectangle in all 150 units exactly as the
gate demands, and in phase 1 it holds a rectangle 3 px from it — one committed
drag step at the phase boundary — while `rest` is exact on both arms.

## What the wave does not improve

**A live gutter drag.** Across every cell of `drag-resize-outline-mode`, the
`live` arm is inside its bracket of the base: +0.53, +0.42, +0.13, −0.02, +0.12,
−0.12 and −0.28 ms, with work identical to a tenth of a percent. The cumulative
pass says the same at stack scale: a sidebar drag against `master` is −0.46 ms
with work down 9.7%. A drag that lays the page out every frame still costs
53–67 ms a frame in this engine. What removes that cost is outline mode
(−28.5 to −48.7 ms, 81–102% of the drag's whole excess over idle), and outline
mode is **opt-in** — an application must call `Body.setResizeMode("outline")`.
Nothing in the wave makes the default path faster.

**A window-edge resize.** `we` is the clearest negative result in the sweep and
worth keeping: outline mode takes its work from 599.60 to 4.17 per unit, a −99.3%
cut, and `apply` from 51.45 to 1.45 — and the frame time moves from 43.06 ms to
40.42, inside the cell's own 2.83 ms bracket. Only 10% of the excess over idle is
layout work at all; the rest is paint, which no amount of skipped layout touches.
The accordion-section gutter (`ssc`) is the same story at a smaller scale: work
1,144.80 → 18.99 and 15% of the excess removed, with the cell already close to
idle (12.9 ms against 9.0) before anything is skipped.

## What is still owed

**The manual by-eye checks are done, 2026-09-23, and all pass.** Three plans
carry checks the A/B explicitly does not cover. The user ran them in the demo
app (`npm run dev`):

- `motion-transform-inline` — the `Toggle` thumb, the `ComboBox` caret and the
  `SplitButton` caret all animate as before, and a diagram pan drags smoothly
  even with the window maximised. The counters prove each rule write became
  exactly one inline write; this is what proves the motion still looks right.
- `tooltip-idle-reattach` — M1 and M2 pass: the error tooltip stays up when a
  further character is typed, and it appears without the pointer having to leave
  and re-enter. M3 passes in two steps, and the second step is a finding: the
  tooltip fades when the message changes, but the **new** message does not appear
  until the pointer leaves the field and comes back. That is not this change. It
  is the open agenda item from the phase-2 post-merge audit — a decorator's error
  arms only when the pointer enters from outside, so `FieldDecorator.showError`
  called with the pointer already at rest shows nothing
  (`00-post-campaign-agenda.md`, *Found by the post-merge audit*). M3 is the
  first user-visible confirmation of that bug, which until now rested on a code
  reading, and it raises its priority: validating on change after a click into
  the field is the common case.
- `drag-resize-outline-mode` — the plan treats its `--read` gates as the manual
  check, and they pass; no separate by-eye pass was owed.

**The QA app's `text-metrics` panel.** Make the first `update` phase
deterministic — most likely by waiting for the font to settle before the first
measured unit — so that
[`text-measurement-without-reflow`](../../implemented/text-measurement-without-reflow.md)'s
parity gate can be read without an arm-independent 1–2 px difference on one row.
Until then the panel's other 111 labels, and the eight other cells, carry the
parity claim.

**Two readings that a later plan should pick up.** `unchanged-commit-opt-ins`
reaches only a twentieth of the ceiling ablation's saving on a form layout pass
(`fnq` −3.5%, `ffq` −7.4% against a predicted −84%), so the form panels remain
the obvious surface for a second staged opt-in. `environment-read-caching`'s `mt` cell did not
reproduce the −1.5 ms its plan demands in isolation, but the probe above settles
what that criterion was guarding: caching the viewport read buys no time on this
build, so nothing is owed there and no follow-up is needed.
