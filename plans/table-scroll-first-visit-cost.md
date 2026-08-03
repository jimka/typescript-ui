# Table Scroll First-Visit Cost — Implementation Plan

## Overview

SQLAdmin's field notes, re-measured against the combined `table-scroll-forced-reflow` + `table-scroll-recycling-cost` fixes, found that running the identical steady 120px/frame scroll gesture twice in a row over the same territory cost 174.1ms/frame the first time and 18ms/frame the second — a ~10× gap the notes attribute, as an unverified guess, to some one-time "first-touch" cost per column that a revisit skips. This plan is that verification.

**The hypothesis does not hold up.** A rigorous first-visit/revisit protocol — reset to a known scroll position, sweep a column range once, reset back without leaving that range, sweep the identical range again — was run against the library's own demo tables in [`MiscPanel.ts`](src/typescript/MiscPanel.ts#L346), both as shipped (45 columns, 4 types) and widened to match SQLAdmin's `wide.cols_60` shape (60 columns, 6 types: string, number, boolean, date, time, datetime). Neither shows any gap: per-frame wall-clock time and the count of native `CSSStyleSheet.insertRule` calls are statistically identical between the first and every later pass over the same range — confirmed across four consecutive identical sweeps, not just two. Full data in `## Addendum: What Was Measured`.

The reason is structural, not incidental. [`Row.setColumnWindow`](src/typescript/lib/component/table/Row.ts#L273) and [`Header.reconcileColumnCells`](src/typescript/lib/component/table/Header.ts#L485) both dispose every cell a reconcile pass doesn't reuse — including that cell's per-instance stylesheet rule — before the pass returns.[^disposal-evidence] There is no cache spanning reconciles for a revisit to warm: whether a column shift builds a fresh cell or recycles one already depends only on whether the column entering the window shares a type with the column that just left, in that same frame — a fact about column adjacency, not about session history.

This plan makes no code change. It documents the finding in [`docs/concepts/performance.md`](docs/concepts/performance.md#L149), whose existing "CSS rule generation cost" section says virtual-scrolling components "reuse a fixed pool of rules" — true of a table's row pool, not of the cells inside a horizontally-scrolled row, which is worth being precise about now that this has been checked. It also names a concrete alternative explanation for the original field number: a scroll sweep that runs the column window past the table's last column stops changing what it renders, and per-frame cost collapses accordingly — an artifact this investigation hit by accident (`## Addendum`) that fits the field notes' own description of the two compared sweeps as "overlapping-but-shifted," not identical.

---

## Architecture Decisions

### The first-touch-materialization hypothesis is refuted

No code changes to `Row.ts`, `Header.ts`, `CellGeometry.ts`, or `core/StyleTarget.ts`. Four consecutive identical sweeps over the same, boundary-safe column range produced the same average frame cost (62.5 / 63.4 / 62.7 / 60.6 ms) and the exact same `insertRule` count (2166) every time.[^refutation-evidence] There is nothing to fix.

### The demo, widened to SQLAdmin's shape, is the test — not a live SQLAdmin session

The original 45-column/4-type demo already fails to show a gap; a 60-column/6-type rebuild matching `wide.cols_60`'s described type mix (string, number, boolean, date, time, datetime) also fails to show one. Both share the exact mechanism SQLAdmin's own table uses (`Row.setColumnWindow`, `Header.reconcileColumnCells`), so a faithful reproduction in the library's own demo is sufficient to test the hypothesis without touching the live SQLAdmin session another investigation currently has running.[^why-not-sqladmin]

### Document the row-pool/cell-pool distinction, not a new API

The only change is a clarifying paragraph in [`docs/concepts/performance.md`](docs/concepts/performance.md#L149)'s "CSS rule generation cost" section, mirroring how `table-scroll-forced-reflow` added its read-after-write-penalty bullet to the same file's "Avoiding layout thrash" section. No new public symbol, no behavior change.

---

## Ordered Implementation Steps

1. **Open [`docs/concepts/performance.md`](docs/concepts/performance.md#L149)** and locate the "CSS rule generation cost" section (starts at line 149).

2. **Insert a new paragraph** immediately after the section's first paragraph (which ends "...prefer the virtual-scrolling components which reuse a fixed pool of rules.") and before the "If you find yourself building a custom virtual list..." paragraph:

   > **A table's row pool is fixed size; the cells inside a row are not.** Sliding the column window rebuilds a cell — and its stylesheet rule — whenever the column entering the window doesn't share a type with the column that just left in the same row. A wide table with several column types crosses this on most single-column scroll steps, since neighbouring columns often differ. The freed cell's rule is deleted immediately, so nothing about this carries over between passes: scrolling across the same column range twice costs the same both times. If you need scrolling that stays cheap across many distinct column types, the lever is fewer type transitions between adjacent columns, not repetition — the framework has no per-column cache to warm.

3. **Checkpoint.** `grep -n "row pool is fixed size" docs/concepts/performance.md` — expect exactly one match, in the "CSS rule generation cost" section.

4. **Run the verification** in `## Verification`, including the first-visit/revisit control.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/docs/concepts/performance.md` |

---

## Verification

```bash
cd packages/lib
npm run typecheck
npm run test
npm run lint
npm run docs:api
grep -n "row pool is fixed size" docs/concepts/performance.md   # expect one match
```

**First-visit/revisit control** (repeats this investigation's own protocol so the "no gap" conclusion stays checkable). `npm run dev` in `packages/lib`, open the demo, go to **Misc**, click *"Show window with wide table (45 columns)!"*. In the console, this drives `VirtualScroller.setScrollX` directly rather than dispatching `WheelEvent`s, for the same reason `table-scroll-recycling-cost` did — `SmoothScroller`'s easing loop does not correspond 1:1 with a dispatched event:

```javascript
const domMod      = await import('/src/typescript/lib/core/DOM.ts');
const scrollerMod = await import('/src/typescript/lib/component/container/VirtualScroller.ts');

const origSetScrollX = scrollerMod.VirtualScroller.prototype.setScrollX;
scrollerMod.VirtualScroller.prototype.setScrollX = function (x) { window.__scroller = this; return origSetScrollX.call(this, x); };

document.querySelector('td').dispatchEvent(new WheelEvent('wheel', { deltaX: 10, bubbles: true, cancelable: true }));
await new Promise(r => requestAnimationFrame(r));

const styleEl = document.getElementById('Base');
const stats = { inserts: 0 };
const origInsertRule = styleEl.sheet.insertRule.bind(styleEl.sheet);
styleEl.sheet.insertRule = function (ruleText, index) { stats.inserts++; return origInsertRule(ruleText, index); };

// Confirm BASE + FRAMES*DELTA stays under the table's max scroll (check
// s.getScrollX() after setScrollX(100000) once) before trusting the numbers —
// a sweep that runs past the last column collapses to near-zero cost for its
// tail frames regardless of visit history (see `## Addendum`).
const s = window.__scroller;
const sweep = async (startX, frames, delta) => {
    s.setScrollX(startX);
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    let x = startX;
    const out = [];
    for (let i = 0; i < frames; i++) {
        const before = stats.inserts;
        const t0 = performance.now();
        x += delta;
        s.setScrollX(x);
        await new Promise(r => requestAnimationFrame(r));
        out.push({ ms: performance.now() - t0, ins: stats.inserts - before });
    }
    return out;
};
const summarize = (f) => ({
    avgMs: Math.round(f.reduce((a,x)=>a+x.ms,0) / f.length * 10) / 10,
    totalIns: f.reduce((a,x)=>a+x.ins,0),
});

const first  = await sweep(0, 25, 100);
s.setScrollX(0);
await new Promise(r => requestAnimationFrame(r));
await new Promise(r => requestAnimationFrame(r));
const second = await sweep(0, 25, 100);

console.log('first: ', summarize(first));
console.log('second:', summarize(second));
```

**Expect** `avgMs` and `totalIns` to match within normal frame-to-frame noise between `first` and `second` — not a large drop. A large drop on a re-run means either a real regression in this conclusion or a boundary-clamp artifact (confirm the sweep's end scroll position didn't hit the table's max before concluding anything).

---

## Documentation Impact

[`docs/concepts/performance.md`](docs/concepts/performance.md#L151)'s "CSS rule generation cost" section gains the clarifying paragraph from step 2. No public API changes, so no other doc page, catalog entry, or `/api/` reference is affected.

---

## Potential Challenges

- **A future change to `Row`'s or `Header`'s free-list disposal — making it persist across reconciles as a genuine idle pool — would invalidate this plan's documentation and reopen the original question.** Mitigation: the new paragraph names the mechanism ("the freed cell's rule is deleted immediately") rather than just the symptom, so a future reader changing that mechanism has a clear signal to revisit this page.
- **This refutation is bounded to the library's own in-memory demo.** SQLAdmin's real network-backed store, a much larger accumulated DOM, or residual state from the sibling leak investigations could reintroduce a cost this demo can't reach. Mitigation: `## Non-Goals` states this limitation plainly rather than overclaiming a SQLAdmin-side conclusion this plan didn't test.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Row.ts:273-435`](src/typescript/lib/component/table/Row.ts#L273) — `setColumnWindow`: Pass 2 (build-or-recycle, lines 337-369) and the "discard whatever is still free" disposal loop (lines 386-399) that removes the mechanism this plan investigated.
- [`packages/lib/src/typescript/lib/component/table/Row.ts:476-510`](src/typescript/lib/component/table/Row.ts#L476) — `cellKey` / `cellKeyFor`: the reuse-key rule that decides whether an incoming column can recycle a cell that just left.
- [`packages/lib/src/typescript/lib/component/table/Header.ts:485-608`](src/typescript/lib/component/table/Header.ts#L485) — `reconcileColumnCells`, the header's equivalent build-or-recycle-or-discard pass (Pass 2 at lines 523-553, discard loop at lines 582-586).
- [`packages/lib/src/typescript/lib/core/StyleTarget.ts:187-219`](src/typescript/lib/core/StyleTarget.ts#L187) — `_ruleFor` and `disposeStyleRule`: the module-level rule cache a disposed cell is evicted from, confirming disposal is real, not just a DOM removal.
- [`packages/lib/src/typescript/lib/core/DOM.ts:1528-1543`](src/typescript/lib/core/DOM.ts#L1528) — `ProductionDOMSink.ensureStyleRule`, the seam call whose native `insertRule` this plan's instrumentation counted directly.
- [`packages/lib/src/typescript/lib/core/Component.ts:838`](src/typescript/lib/core/Component.ts#L838) — `destructor`'s `this._styleRule.dispose()` call, confirming a disposed cell's `#id` rule leaves the shared stylesheet (not merely the component tree).
- [`packages/lib/src/typescript/lib/component/table/CellGeometry.ts`](src/typescript/lib/component/table/CellGeometry.ts) — `CellGeometryCache`, read to confirm it is keyed on cell identity and orthogonal to this investigation (a continuously-moving `x` during a steady scroll means it rarely hits regardless of visit history).
- [`packages/lib/src/typescript/MiscPanel.ts:341-400`](src/typescript/MiscPanel.ts#L341) — the wide-table demo this plan's control script drives, and the model this plan's widened 60-column reproduction was built from.
- [`plans/implemented/table-scroll-forced-reflow.md`](plans/implemented/table-scroll-forced-reflow.md) and [`plans/implemented/table-scroll-recycling-cost.md`](plans/implemented/table-scroll-recycling-cost.md) — the direct precedent for this plan's measurement discipline (live instrumentation over source reading, explicit refutation of a standing hypothesis, `## Addendum: What Was Measured` shape, the `SmoothScroller`-bypass control script this plan's own control reuses).
- [`packages/lib/docs/concepts/performance.md:149-153`](docs/concepts/performance.md#L149) — the section this plan edits.

---

## Non-Goals

- **No change to `Row.ts`, `Header.ts`, `CellGeometry.ts`, or `core/StyleTarget.ts`.** The investigation found the disposal-every-reconcile behavior correct and consistent between these two files; there is nothing to fix.
- **No direct re-test against SQLAdmin's live `wide.cols_60` through its real backend.** The widened 60-column/6-type library demo runs the identical framework code path SQLAdmin's table does; a live SQLAdmin re-test would add real-network and larger-DOM variables this plan didn't isolate, not a different mechanism to check. See `## Potential Challenges` for the resulting limitation.
- **No further chase of the stylesheet-size-scaling or GC-pause questions the field notes raised.** Sheet size grew from ~2100 to ~4300+ rules across this investigation's own sweeps with no first-visit/revisit difference at any point, which is evidence against sheet size being the dominant factor in *this* gap specifically — but confirming or refuting sheet-size-scaling as a general cost is the stylesheet-leak family's own domain (`plans/implemented/table-tab-close-residual-leak.md` and the `dock-disposes-tab-content` / `component-purges-event-listeners` chain), not this plan's.

---

## Addendum: What Was Measured

All figures from the library's own demo (`packages/lib`, `npm run dev`), driven via `VirtualScroller.setScrollX` directly (not `WheelEvent` dispatch, for the reason documented in `table-scroll-recycling-cost`'s own addendum). Native `CSSStyleSheet.insertRule` / `deleteRule` on the shared `<style id="Base">` sheet were counted by wrapping them directly, separately from `StyleTarget`'s own module cache — so a count is a real CSSOM mutation, not a cache hit.

**Original 45-column/4-type demo** (`MiscPanel.ts`'s wide-table button, as shipped). Sweep of 40 frames at 120px/frame, from `scrollX = 0`, reset to `0`, identical sweep repeated:

| | avg ms/frame | total `insertRule` | total `deleteRule` | frames > 50ms | worst |
|---|---|---|---|---|---|
| first pass | 25.8 | 1365 | 1092 | 1 | 55 |
| second pass (revisit) | 25.0 | 1365 | 1092 | 1 | 57 |

Identical `insertRule` count between passes — not merely similar frame time.

**Widened 60-column/6-type demo**, built to match `wide.cols_60`'s described shape (string, number, boolean, date, time, datetime; 400 rows; `autoSizeColumns: true`), first attempt at 40 frames × 120px from `scrollX = 3000`:

| | avg ms/frame | total `insertRule` |
|---|---|---|
| first pass | 59.2 | 2886 |
| second pass (revisit) | 59.1 | 2886 |

Still identical — but the per-frame breakdown revealed an unrelated artifact worth recording, because it is a plausible source of the original field number:

```
first:  [90,114,44,63,83,123,43,77,97,73,90,75,51,76,103,41,67,91,83,75,75,81,71,67,50,70,69,60,82, 18,17,16,17,18,16,17,17,18,17,15]
second: [79,119,42,70,94,123,44,74,100,71,94,83,60,81,96,40,68,86,74,74,69,81,66,67,50,70,70,60,80, 18,17,17,17,16,18,17,17,16,17,15]
```

Both passes cliff from ~70-90ms/frame down to ~15-18ms/frame at frame 30 — not because of anything visit-related, but because `scrollX = 3000 + 30×120 = 6600` exceeds this table's actual max scroll (~6557px, confirmed separately). Past that point the column window stops changing, so every later frame in the sweep does near-zero reconcile work. **A sweep that runs past a table's last column will look like a cheap "revisit" even when it isn't one.** The field notes describe the two compared sweeps as "overlapping-but-shifted" column ranges, not identical ones — exactly the shape that could hit this artifact if the second sweep's range extended closer to (or past) `wide.cols_60`'s last column than the first.

**Corrected widened-demo sweep**, re-run within confirmed bounds (`scrollX` 1000 → 3500, 25 frames × 100px, `endX` checked equal to the expected `3500` on every run — no clamping), four consecutive identical passes:

| pass | avg ms/frame | total `insertRule` | worst |
|---|---|---|---|
| 1 | 62.5 | 2166 | 122 |
| 2 | 63.4 | 2166 | 97 |
| 3 | 62.7 | 2166 | 98 |
| 4 | 60.6 | 2166 | 91 |

Flat across all four passes, both in timing (within ordinary frame-to-frame noise) and in `insertRule` count (exactly 2166 every time). This is the plan's primary evidence: with the boundary artifact controlled for, there is no first-visit/revisit gap at any pass, not just the second.

---

## Notes

[^disposal-evidence]: `Row.setColumnWindow`'s "Pass 2 — recycle a leftover with the same key, else build" ([Row.ts:337-369](src/typescript/lib/component/table/Row.ts#L337)) only recycles a cell freed in the *same* reconcile call, keyed by `cellKeyFor` (type, plus a field-namespaced key for a custom renderer/`cellType`/`values` column — [Row.ts:461-500](src/typescript/lib/component/table/Row.ts#L461)). Anything left in the `free` map after that pass is disposed before the method returns ([Row.ts:386-399](src/typescript/lib/component/table/Row.ts#L386)): `cell.dispose()` runs `Component.destructor()`, which calls `this._styleRule.dispose()` ([Component.ts:838](src/typescript/lib/core/Component.ts#L838)) — and `StyleRule.dispose()` calls the module-level `disposeStyleRule(selector)` ([StyleTarget.ts:209-214](src/typescript/lib/core/StyleTarget.ts#L209)), which evicts the selector from `_ruleCache` *and* calls `DOM.sink.deleteStyleRule`, physically removing the `CSSStyleRule` from the shared sheet. `Header.reconcileColumnCells` disposes its own leftovers the same way ([Header.ts:582-586](src/typescript/lib/component/table/Header.ts#L582)), though its free list isn't type-keyed (any leftover `HeaderCell` can be reused, since header cells are presentation-only). So neither file retains anything between reconcile calls that a later, identical reconcile could reuse — confirmed, not inferred, by the `insertRule` counts in `## Addendum` being bit-for-bit equal across repeated identical sweeps.

[^refutation-evidence]: Full methodology and all four figures in `## Addendum: What Was Measured`. In short: `CSSStyleSheet.prototype.insertRule` and `deleteRule` on the framework's shared `<style id="Base">` sheet were wrapped directly (counting real CSSOM mutations, not `StyleTarget`'s own module-cache hits), and `VirtualScroller.setScrollX` was driven directly per the `SmoothScroller`-bypass rationale `table-scroll-recycling-cost` already established. Every pass over an identical, confirmed-unclamped column range produced the same `insertRule` count and statistically the same frame time — checked on both the original 45-column demo and a widened 60-column/6-type rebuild, across two-pass and four-pass runs.

[^why-not-sqladmin]: A live SQLAdmin re-test was considered and set aside for two reasons. First, a separate, concurrently-running investigation (`table-toolbar-button-residual-leak`) has its own SQLAdmin session active against a different worktree, and driving scroll experiments through the same live app risks confounding both. Second, and more fundamentally, `Row.setColumnWindow` and `Header.reconcileColumnCells` are the same framework code in SQLAdmin as in the library's own demo — SQLAdmin imports the built library, it doesn't reimplement table recycling — so a faithful reproduction of `wide.cols_60`'s column count and type mix inside the library's own demo exercises the identical mechanism. What a live SQLAdmin session would add is real network latency, a much larger accumulated DOM, and possibly residual state from the leak investigations sharing that branch — variables worth isolating separately, not variables this plan's question (does a column materialize something a revisit skips?) needs a live backend to answer.
