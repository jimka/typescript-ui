# Baseline measurement — unmodified master, before any wave-0/1/2 work

Taken 2026-09-16, 19:44–19:52 local, machine otherwise idle (the user had
stepped away; no other work ran on the box).

## What was measured

| Field | Value |
|---|---|
| Library | `typescript-ui` `master` @ `3688d9f1` (*Merge branch 'feature/scroll-strip-deferred-resync'*) |
| Bundle | `packages/lib/dist/lib`, built 2026-09-16 19:23:40, newer than the last src commit — current |
| Loom | `main` @ `5f307a8`, tree clean, no debug overrides in `src/main.ts` |
| Resolution | Loom's `node_modules/@jimka/typescript-ui` symlinked to the main-tree lib |
| Engine | WebKitGTK via MiniBrowser, full-screen, software-rendered under WSLg |
| Harness | `runqa.sh <name> main <params>`, Vite restarted per run |

Four scenarios, each run twice, strictly sequential and interleaved in the
order S1 S2 S3 S4 S1 S2 S3 S4 — interleaved because identical baselines have
drifted ~10 ms across a session before, and interleaving makes such drift
visible instead of silent.

## Results

| Run | Scenario | elems | idle | drag avg | p90 | resize avg | scroll |
|---|---|---:|---:|---:|---:|---:|---:|
| S1 r1 | 2×2 grid, 4 editors, **dock-h** gutter | 2387 | 12.2 | **103.8** | 109 | – | 19.4 |
| S1 r2 | "                                     | 2387 | 12.8 | **104.0** | 109 | – | 19.7 |
| S2 r1 | 2×2 grid, 4 editors, **dock-v** gutter | 2387 | 11.2 | **109.1** | 113 | – | 19.4 |
| S2 r2 | "                                     | 2387 | 11.0 | **108.5** | 113 | – | 19.3 |
| S3 r1 | file tree, 1 editor, **explorer** gutter | 992 | 17.4 | **73.2** | 80 | – | 21.4 |
| S3 r2 | "                                     | 992 | 17.5 | **72.7** | 86 | – | 21.6 |
| S4 r1 | no project, window resize           | 212 | 17.2 | 64.5 | 95 | **54.2** | 17.4 |
| S4 r2 | "                                     | 212 | 17.3 | 62.8 | 93 | **56.5** | 17.6 |

All figures ms/frame. Budget is 16.7.

**Reproducibility is excellent.** Repeat pairs differ by 0.2 (S1), 0.6 (S2)
and 0.5 (S3) ms. The session drift that motivated interleaving did not recur.
Treat a post-change delta under ~1.5 ms in S1–S3 as noise; S4's `drag` column
is the exception (see caveats).

## The run validated itself

The measurement carried a built-in check. The scroll-strip fix was merged into
this master, and the pre-merge/post-merge pair had been measured before:

| Prior run | drag ms/frame | Today |
|---|---:|---:|
| `ssd-h-main` (before the fix) | 219.8 / 250.4 | — |
| `ssd-h-wt` (with the fix) | 106.6 / 108.5 | S1 = **103.8 / 104.0** |
| `ssd-v-*` (unaffected by it) | 111.3 / 112.7 | S2 = **109.1 / 108.5** |

S1 landing at ~104 rather than ~220 proves the harness resolved the merged
library and not a stale bundle. Both scenarios came in 2–4 ms *below* their
earlier counterparts, consistent with Loom's own `5f307a8` status-bar fix:
element count fell 2484 → 2387 in an otherwise byte-identical scene (same 88
rows, same `treeRectHeight` 1852, same 4/16/15 editor/invisible/undisplayed
split). Scroll also improved, 26 → 19.

## The important finding: per-frame JS work is already gone in the headline case

Complete unfiltered per-frame write counters for S1 — seven counters, nothing
hidden below a display threshold:

```
attr.data-insets.same                  = 12
classList.add.changed@…:hover          = 0.01
sheet.insertRule                       = 0.01
classList.add.changed@?:ts-ui-dragging = 0.01
forced.getBoundingClientRect           = 0.01
classList.remove.changed@…:dragging    = 0.01
classList.remove.changed@…:hover        = 0.01
```

Twelve same-valued attribute writes per frame. No stylesheet-rule writes, no
inline writes, no mutations, and forced reads at one per hundred frames.

**So the 104 ms is not JS write churn — it is engine-side restyle, layout and
paint of the tree that already exists.** Deduping twelve same-value attribute
writes will not move 104 ms.

**This does not refute G04 — it shows S1 does not exercise it.** Slice 06's
headline "14 stylesheet-rule writes per gutter-drag frame" was measured by
probe `Q3b` on a synthetic **`sidebar | 2×2 Split grid`** tree, and the writes
it counts are `Split.commitPanes` → `setClipPath` (`Split.ts:2137-2148`) and
`Border.applyRegionClip` (`Border.ts:744-765`). Loom's 2×2 editor grid is a
**Dock** grid — the harness reports `drag target: dock-h` — so S1 never drives
that path, and its zero is consistent with, not contrary to, slice 06.

The consequence is about *evidence*, not scope: **synthesis headline number 2
(`rule writes per gutter-drag frame: 14 → 0`) cannot be quoted from S1 or S2.**
Before G04 is planned, either add a fifth scenario that drags a real `Split`
gutter in the Loom shell, or accept slice 06's probe as the proof and stop
claiming the 2×2 grid as G04's demonstration. The open question G04's plan must
answer is how much of Loom's *real* UI drives `Split`/`Border` clip-path writes
per frame — S3 and S4's one rule write per frame says the answer is "some, but
far less than 14".

`attr.data-insets.same` tracks gutter count exactly — 12 (dock-h), 6 (dock-v),
3 (explorer) — and every one is a same-value write. Pure waste, but small.

## A latent hazard the small scenes expose

S3 and S4 each write **one stylesheet rule per frame** (`rule.cssText.same=1`)
plus one same-value inline `cssText`. The dock-gutter scenes write none, so
this belongs to the explorer/sidebar drag path specifically.

This matters out of proportion to its count. A stylesheet-rule mutation forces
a **full-document restyle** in WebKitGTK even when the write is same-valued —
measured at ~195 ms/frame on a 21k-node document. At S3's 992 elements it is
affordable, which is exactly why it has survived unnoticed. It is a
correctness-of-cost bug waiting for a large document, and the cheapest real
win on this table.

S3 also carries the only meaningful forced read, 0.12/frame, stack:
`getScrollOffset ← measure` — CodeMirror's own measure path, and present only
when a single editor is visible (S1, with four, shows 0.01).

## Caveats on reading these numbers

- **S4's `drag` column is unreliable** (avg 64.5, p90 95 — a 30 ms spread,
  versus ~5 ms for every other row). It drags an explorer gutter in a shell
  with no project behind it. Use S4's **`resize` 54.2 / 56.5** as the
  framework floor; it matches the ~52 recorded earlier and is stable.
- **The forced-read counter under-counts** reads dirtied by inline-style
  writes — a known limitation from the earlier investigation. Timing and the
  write counters are primary evidence; `forced.*` corroborates, never leads.
- **Idle is lower in the big scenes** (11–12) than the small ones (17). The
  ~17 ms idle floor appears to be a fixed per-frame cost the larger scenes
  amortise differently. Unexplained, unimportant, noted so it is not later
  mistaken for a regression.

## The three headline numbers — and why you must NOT compare against them

1. **S1 — 103.9** ms/frame (mean of 103.8/104.0), 2×2 grid, dock-h gutter.
2. **S3 — 73.0** ms/frame (mean of 73.2/72.7), file tree, single editor.
3. **S4 resize — 55.4** ms/frame (mean of 54.2/56.5), framework floor.

> **CORRECTION, 2026-09-17 — these absolutes are not comparable across
> sessions.** This section originally said to re-measure them after each wave.
> That instruction is wrong and produced two false regressions before it was
> caught. On 2026-09-17 the *pre-wave-0 build* (`3688d9f1` — the exact commit
> measured above) was rebuilt and re-run: it came back at **S1 112.2** and
> **S3 83.4**, i.e. **+8.0% and +14.2% against its own numbers from the night
> before**, same bytes, same scenarios, same harness. The machine differs
> between sessions by more than almost every effect this campaign is trying to
> measure — G04's real effect was 1.6%.

### The only valid comparison: same-session A/B

Build the pre-change library into a worktree and interleave the two libraries
**in one sweep**, so drift hits both arms equally:

```
git worktree add .worktrees/_prewave0 <pre-change-sha> --detach
ln -sfn <repo>/node_modules .worktrees/_prewave0/node_modules
ln -sfn <repo>/packages/lib/node_modules .worktrees/_prewave0/packages/lib/node_modules
(cd .worktrees/_prewave0/packages/lib && npm run build:lib)

export QA_WT_LIB=<repo>/.worktrees/_prewave0/packages/lib
runqa.sh ab-s1-post-r1 main "<params>"   # post-change
runqa.sh ab-s1-pre-r1  wt   "<params>"   # pre-change, minutes later
...alternating, two rounds
```

`runqa.sh`'s `main`/`wt` switch exists for exactly this and is how the
scroll-strip fix was originally validated at 220 → 107. Use it. Afterwards,
restore Loom's symlink — the script leaves it pointing at whichever arm ran
last:
`ln -sfn <repo>/packages/lib <loom>/node_modules/@jimka/typescript-ui`.

**Effects that survive this caveat:** the scroll-strip 220 → 107 (far larger
than any plausible drift) and any within-session ablation, such as the G04
`norules` measurement below, where both arms ran minutes apart.

**What the numbers above are still good for:** the *shape* of the tree
(element counts, editor/invisible/undisplayed splits, `treeRectHeight`), the
per-frame write counters, and the ratios between scenarios within that one
session. Not absolutes.

## Reproducing

```
cp .../qa-harness/vite.config.qa.ts <loom>/vite.config.ts   # never commit this
runqa.sh base-s1-rN main "mode=filetree&tabs=4&grid=2x2&gutter=dock-h&count=1"
runqa.sh base-s2-rN main "mode=filetree&tabs=4&grid=2x2&gutter=dock-v&count=1"
runqa.sh base-s3-rN main "mode=filetree&tabs=1&gutter=explorer&count=1"
runqa.sh base-s4-rN main "mode=noproject&resize=120&count=1"
cd <loom> && git checkout -- vite.config.ts
python3 qa-table.py base- --writes ; python3 qa-forced.py base-s1
```

Raw results: `qa-harness/qa-results/base-s{1..4}-r{1,2}-*.json`.


## Post-wave-0 A/B result (2026-09-17)

Wave 0's four correctness branches, measured same-session against their own
pre-merge parent, interleaved over two rounds:

| Scenario | pre-wave-0 (`3688d9f1`) | post-wave-0 (`68136db0`) | delta |
|---|---:|---:|---:|
| S1 2×2 grid, dock-h | 112.2 | **111.6** | −0.6 (post faster) |
| S3 file tree, 1 editor | 83.4 | **81.4** | −2.0 (post faster) |

**Wave 0 cost nothing.** This matters because wave 0 put a `try`/`catch` around
every entry in the batched layout flush — a per-frame hot path — and changed
size reporting in `Grid`, `HBox`, `VBox`, `Fit` and `Card`. Both were worth
checking; neither shows up. The per-frame write counters are also byte-identical
before and after (seven counters on S1, thirteen on S3), so no JS-side work was
added either.

## G04 ablation result (2026-09-17)

What one stylesheet-rule write per frame actually costs on Loom's real trees,
measured within-session with `abl=norules`:

| Scenario | with rules | `norules` | delta |
|---|---:|---:|---:|
| S3 — 1 rule write/frame | 83.1 | 81.8 | **1.3 ms** |
| S1 — **0** rule writes (control) | 111.9 | 109.8 | 2.1 ms |

The control is the reading. S1 writes no rules, so its 2.1 ms "effect" is pure
noise — and S3's real effect is *smaller than that*. The ~195 ms/frame
full-document restyle is real at 21k nodes; at Loom's 992–2387 it is free.

**Consequence for G04:** it must not lead wave 1. The synthesis ranks it "land
first of the perf groups" because "the same-valued rule writes dominate every
drag-frame measurement" — that premise is now measured false for every Loom
scenario. G04 is a latent hazard for large documents and a hygiene item, not a
performance win. G07's setter guards include `setClipPath` and will close most
of it incidentally.

## Wave-1 A/B result (2026-09-17) — and the mechanism the campaign mis-ranked

Wave 1 (`pending-plan-amendments` → `progress-indicator-resize-relay` →
`component-setter-guards`) measured same-session against its own pre-merge
parent, interleaved over two rounds:

| Scenario | pre-wave-1 | post-wave-1 | delta |
|---|---:|---:|---:|
| **S3** file tree, 1 editor, explorer gutter | 70.8 | **58.5** | **−12.3 ms (−17.4%)** |
| S1 2×2 grid, 4 editors, dock-h gutter | 103.9 | 102.9 | −1.0 (noise) |

Both arms reproduced tightly (pre-arm spread 0.1 ms), so S3's win is real.
S1 barely moves, which is consistent with the baseline: S1's drag path already
did almost no JS work (seven counters, twelve same-value attribute writes).

### What actually produced the win

S3's per-frame write counters, before and after — all three same-value writes
are gone, 13 distinct counters down to 10:

```
pre:   attr.data-insets.same = 3 ;  inline.cssText.same = 1 ;  rule.cssText.same = 1
post:  (all three absent)
```

**The stylesheet-rule write was not the lever.** The `norules` ablation above
measured that single rule write at **1.3 ms**. The remaining ~11 ms came from
the attribute and inline writes and — the part no counter shows — the *side
effects* those setters stopped running: the `scheduleLayout()` calls, cache
invalidations and attribute writes that a same-value call used to re-execute.

This matters beyond wave 1. The synthesis ranks G04 `style-write-dedup` first
among the performance groups on the reasoning that *a stylesheet-rule mutation
forces a full-document restyle, therefore same-valued rule writes dominate
every drag frame*. The restyle cost is real (~195 ms/frame at 21k nodes) but
Loom's trees are 992–2387 nodes, where it is free. The group ranked below it
delivered 17% instead, because it guarded **side effects** rather than writes.

**Apply this when planning the remaining groups:** count what a same-value call
*does* — layout scheduling, invalidation, child rebuilds — not just what it
writes. Several remaining groups carry the same rule-write reasoning and should
be re-justified on that basis before being scheduled.
