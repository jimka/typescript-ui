# W2.0 — the wave-2 bounding sweep, measured

**Run 2026-09-17, same session, 11 runs, plain-bracketed at both ends of each
scenario.** Every arm carried `work=1` and `widthprobe=1`, so instrument
overhead is identical across arms and each ablated arm can be checked for
identical geometry. This is the sweep `98-wave2-rejustification.md` called "the
single highest-value action available", run before any wave-2 plan was drafted.

## Results

S1 = 2×2 dock grid, 4 editors, 2387 elements. S3 = explorer gutter, 1 editor.
Δ is against the mean of that scenario's two plain arms.

| scene | arm | avg ms | Δ | geometry | engaged? |
|---|---|---|---|---|---|
| S1 | plain (a / b) | 58.71 / 58.56 | — (spread **0.15**) | — | — |
| S1 | `size.memo` | 59.21 | **+0.58** | **differs** | yes — 717 memo hits/frame, size calls 2875 → 946 |
| S1 | `skip.unchanged` (G09) | 59.09 | **+0.46** | **differs** | barely — 8 skips/frame |
| S1 | `split.recalc-gate` (G12 F06.4) | 58.20 | −0.44 | **differs** | — |
| S1 | `border.region-memo` (G12 F06.5) | **56.92** | **−1.72** | identical | yes — 44 memo hits/frame |
| S3 | plain (a / b) | 58.99 / 57.95 | — (spread **1.04**) | — | work 2036.0 both, byte-identical |
| S3 | `size.memo` | 57.18 | −1.29 | identical | yes |
| S3 | `clamp.once` (G10) | 57.47 | −1.00 | identical | yes |
| S3 | `accordion.seed` (G13 F08.2) | **55.28** | **−3.19** | identical | yes — work 2036 → 1634/frame |

## What survives

Only two arms are outside their scenario's drift **and** reached identical
geometry **and** are confirmed engaged by the work counters:

- **G13 F08.2 (`accordion.seed`): −3.19 ms on S3, −5.5%.** Removes 20% of all
  counted per-frame work (`openContentHeight` 4 → 2.03/frame). The
  re-justification predicted "1–3 ms"; it lands at the top of that range. Best
  result in the sweep, and it is one of the *smallest, safest* changes on the
  list — slice 08 probe E1 already proved every section's rectangle is
  byte-identical under it.
- **G12 F06.5 (`border.region-memo`): −1.72 ms on S1, −2.9%.** 44 memoised
  region reports per frame, geometry identical.

## What is measured dead

**The size-hint recursion is not where the time goes — and this is the sweep's
most valuable finding.** `size.memo` removed **1,929 size-hint calls per frame**
(2875 → 946, a 67% cut) and the frame got *no faster* (+0.58 ms on S1, and on S3
its −1.29 sits inside a 1.04 drift). The synthesis lists "size hints are never
memoised" as one of the campaign's recurring defects; measured in the real
engine, memoising them is worth nothing. Three thousand cheap calls do not add
up to a frame.

This also de-fangs **G10**: `clamp.once` came in at −1.00 ms against a 1.04 ms
drift, and `clampTally` shows G10's re-scoped target does not exist — there is
no `TreeRow` or `SelectableListRow` *component* in the live tree (tree rows are
renderer-produced DOM). The classes that actually clamp are `Text` (21),
`Component` (16), `ButtonLabelText` (10), `ButtonIconGlyph` (10),
`ToggleButton` (5), `CodeEditor` (4).

**G09 is dead on S1:** the unrestricted upper bound of its own change skipped
only 8 commits per frame and measured +0.46 ms. The re-justification already
called it "the highest risk in the campaign"; it now has a ceiling of zero to
go with that.

## The geometry column is doing real work here

`size.memo`, `skip.unchanged` and `split.recalc-gate` all produced a *different*
layout from plain (editor heights reaching 835 or 1615 px against plain's
963–1188). Their timings are void — an ablated page that lays out differently is
not doing equivalent work. It is also a planning signal: the naive form of
G09's skip and G12's recalc gate are **not** behaviour-preserving, so those
plans would have to earn their correctness rather than assume it.

## Verdict

Wave 2 as scoped is worth roughly **2–3 ms on a ~58 ms frame**, all of it in the
two smallest items. The recommendation is to implement **G13 F08.2 and G12
F06.5 only**, drop G09, G10 and G15, and abandon the size-hint memoisation idea
outright.

The frame is dominated by engine-side restyle, layout and paint of the existing
tree — which is what the original baseline concluded for S1 before any wave
ran, and which three waves of JS-side work have not changed. The only remaining
lever of a different order is the `resizeMode: "live" | "outline"` flag: not
doing live layout during a drag at all. That is a feature, not a perf group, and
it would dominate every number in this table.
