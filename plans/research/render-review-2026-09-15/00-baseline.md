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

## The three headline numbers to re-measure after each wave

1. **S1 — 103.9** ms/frame (mean of 103.8/104.0), 2×2 grid, dock-h gutter.
2. **S3 — 73.0** ms/frame (mean of 73.2/72.7), file tree, single editor.
3. **S4 resize — 55.4** ms/frame (mean of 54.2/56.5), framework floor.

Re-run with exactly the harness parameters in the sweep script; interleave and
repeat as here, or the comparison is not sound.

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
