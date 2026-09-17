---
touches-shared: [packages/lib/src/typescript/lib/core/Component.ts]
---

# Border per-pass region size record — Implementation Plan

## Overview

`Border` asks each of its five regions for the same size numbers many times inside one layout pass. On one unchanged pass over a five-region border, each edge region is asked for its preferred size 5 times, its minimum 8 times and its maximum 3 times. Every one of those questions is a recursive walk of that region's whole subtree — for a Loom `FileEditor`'s CENTER region, the entire CodeMirror wrapper.

This plan gives `Border` a small per-pass record: each region's `{preferred, min, max}` triple is computed at most once per layout pass and re-served for the rest of that pass. The record sits behind the three helpers that already stand in front of every region size read — [`regionPreferredSize`](packages/lib/src/typescript/lib/layout/Border.ts#L594), [`regionMinSize`](packages/lib/src/typescript/lib/layout/Border.ts#L607) and [`regionMaxSize`](packages/lib/src/typescript/lib/layout/Border.ts#L623) — so no caller changes shape.

Two supporting changes make that record possible. `Component` gains an internal counter identifying the layout pass currently running, which is what the record is keyed on. And `Border`'s three CENTER reads, which bypass the helpers today, are routed through them like the other four regions.

The change is measured, not speculative: a runtime ablation of this exact idea took 1.72 ms off a 58 ms WebKitGTK drag frame on Loom's 2×2 editor grid and removed 20.6% of all counted per-frame work, with byte-identical geometry.[^measured]

---

## Architecture Decisions

### The record stores each region's triple, not the border's own report

The record holds `{preferred, min, max}` per region. `Border.getPreferredSize`, `getMinSize`, `getMaxSize`, `computeTotalMinSize` and `doLayout` keep recomputing their own arithmetic on every call, from the recorded triples.[^triple-not-aggregate]

That shape mirrors [`RegionContentSnapshot`](packages/lib/src/typescript/lib/layout/Border.ts#L41-L49), the record `Border` already keeps for a collapsed region whose content has left the render tree: same `{preferred, min, max}` shape, same three helpers as the interposition point. The new record is a second, much shorter-lived tenant of that seam.[^snapshot-precedent]

### The key is the layout pass, not the frame

A record entry is keyed on `(region placement, layout pass)`. A **layout pass** is one outermost `Component.doLayout()` call — from the moment layout work starts at the top of some component until it returns, including everything it recurses into. `Component` counts these and hands out a number identifying the one currently running; `0` means no pass is running.

Outside a pass, nothing is recorded and every read is live. Inside a pass, a region is read live once and re-served after that.[^pass-not-frame]

Worked cases, with the pass currently numbered 7:

| Moment | Pass | Record for WEST | Result |
|---|---|---|---|
| Application code calls `panel.getPreferredSize()`, no layout running | 0 | not consulted | live read, nothing stored |
| Host's `doLayout` reads the border's preferred size, first time | 7 | empty | live read, stored |
| Same host pass reads it again while resolving bounds | 7 | holds `preferred` | **served from the record** |
| `Border.doLayout`, nested in the same host pass, reads WEST | 7 | holds `preferred` | **served from the record** |
| Host pass reads the border again after `Border.doLayout` returned | 7 | cleared on that return | live read, stored |
| Next frame's pass reads WEST | 8 | pass number differs | live read, stored |

### The record is dropped when `Border.doLayout` returns

`Border.doLayout` commits each region's rectangle, which lays that region's subtree out and can change what it reports next. So the record is cleared in a `finally` as `doLayout` returns, even when it throws.[^drop-on-dolayout] Reads *inside* `doLayout` still come from the record: each region is read before that region is committed, and committing one region cannot change another's report.

The record is also cleared whenever the border's own state behind a region read changes: a region slot is set or removed, a region's content snapshot is taken, restored or forgotten, or the manager is detached from its container.

### CENTER routes through the same three helpers

`Border.getPreferredSize` ([:909](packages/lib/src/typescript/lib/layout/Border.ts#L909)), `getMinSize` ([:988](packages/lib/src/typescript/lib/layout/Border.ts#L988)) and `computeTotalMinSize` ([:1105](packages/lib/src/typescript/lib/layout/Border.ts#L1105)) call the centre component's size methods directly instead of going through `regionPreferredSize` / `regionMinSize`. They are changed to use the helpers, which is what puts CENTER — the expensive region in Loom — behind the record. The substitution is exactly equivalent today.[^centre-equivalence]

### The collapse snapshot keeps its live reads

[`undisplayRegionContent`](packages/lib/src/typescript/lib/layout/Border.ts#L434-L436) captures a region's three sizes the instant before its content leaves the render tree. Those three calls stay direct live reads and are never served from the record.[^snapshot-live]

---

## Public API

One new internal member on `Component`. `@internal` members are excluded from the API docs (`typedoc.json` sets `excludeInternal`), so this adds no public surface.

```ts
class Component {
    /** @internal */
    static currentLayoutPass(): number;
}
```

Returns a number identifying the layout pass currently running, or `0` when no layout pass is running. The number changes on every new outermost pass and stays the same for everything that pass recurses into.

Backing module-level state in `core/Component.ts`, beside the existing `pendingLayouts` / `rafHandle` queue state ([:179-183](packages/lib/src/typescript/lib/core/Component.ts#L179-L183)):

```ts
let layoutPassDepth: number = 0;
let layoutPassToken: number = 0;
```

No options-bag field: a pass counter is framework bookkeeping, not consumer configuration, and ARCHITECTURE.md's rule 3 keeps bookkeeping off `XOptions`.

---

## Internal Structure

New type and fields in `layout/Border.ts`:

```ts
/**
 * One region's size reports as computed once for the current layout pass.
 * A field left `undefined` has not been asked for yet this pass; `null` is a
 * real answer meaning the region reports no size.
 */
interface RegionSizeRecord {
    preferred?: Size | null;
    min?:       Size | null;
    max?:       Size | null;
}

private readonly _regionSizes: Map<Placement, RegionSizeRecord> = new Map();
private _regionSizesPass: number = 0;
```

The single gate every read goes through:

```ts
private passRecord(placement: Placement): RegionSizeRecord | null {
    const pass = Component.currentLayoutPass();

    if (pass === 0) {
        return null;
    }

    if (this._regionSizesPass !== pass) {
        this._regionSizesPass = pass;
        this._regionSizes.clear();
    }

    let record = this._regionSizes.get(placement);

    if (!record) {
        record = {};
        this._regionSizes.set(placement, record);
    }

    return record;
}

private invalidateRegionSizes(): void {
    this._regionSizesPass = 0;
    this._regionSizes.clear();
}
```

Each helper becomes record-first, live-second. `regionPreferredSize` in full; `regionMinSize` and `regionMaxSize` are the same shape against `min` / `max` and `snapshot.min` / `snapshot.max`:

```ts
private regionPreferredSize(placement: Placement, component: Component): Size | null {
    const record = this.passRecord(placement);

    if (record && record.preferred !== undefined) {
        return record.preferred;
    }

    const snapshot = this._undisplayedRegionContent.get(placement);
    const size     = snapshot !== undefined ? snapshot.preferred : component.getPreferredSize();

    if (record) {
        record.preferred = size;
    }

    return size;
}
```

The pass counter in `Component.doLayout` ([:7440](packages/lib/src/typescript/lib/core/Component.ts#L7440)) wraps the existing body, leaving the `isLayoutPaused()` early return in front of it:

```ts
doLayout(): this {
    if (this.isLayoutPaused()) {
        return this;
    }

    if (layoutPassDepth === 0) {
        layoutPassToken++;
    }
    layoutPassDepth++;

    try {
        // ... the existing body, unchanged: noteLayoutPass, the layout-manager
        // lookup and throw, the _layoutDirty clear, lm.doLayout(),
        // runFirstLayoutCallbacks ...
    } finally {
        layoutPassDepth--;
    }

    return this;
}
```

---

## Ordered Implementation Steps

1. **`core/Component.ts` — add the pass counter state.** Beside `let rafHandle: number | null = null;` ([:183](packages/lib/src/typescript/lib/core/Component.ts#L183)), add `layoutPassDepth` and `layoutPassToken` as shown in `## Public API`, with a comment saying a layout pass is one outermost `doLayout` and that nested layouts share the outermost one's number.

2. **`core/Component.ts` — maintain the counter in `doLayout`.** In `doLayout()` ([:7440](packages/lib/src/typescript/lib/core/Component.ts#L7440)), after the `isLayoutPaused()` early return, bump the token when the depth is 0, increment the depth, wrap the rest of the existing body in `try { … } finally { layoutPassDepth--; }`. Do not change the body itself. The `finally` is required: `Border.doLayout` throws on a region that reports no preferred size, and the batched flush catches such throws and carries on ([:265-269](packages/lib/src/typescript/lib/core/Component.ts#L265-L269)), so a decrement that only ran on the success path would strand the depth above 0 for the rest of the session.

3. **`core/Component.ts` — add the accessor.** Add `static currentLayoutPass(): number` returning `layoutPassDepth > 0 ? layoutPassToken : 0`, with `@internal` in its JSDoc. Place it next to `static afterNextLayout` ([:7625](packages/lib/src/typescript/lib/core/Component.ts#L7625)).

4. **`layout/Border.ts` — add the record type and fields.** Add the `RegionSizeRecord` interface next to `RegionContentSnapshot` ([:41-49](packages/lib/src/typescript/lib/layout/Border.ts#L41-L49)), and the `_regionSizes` / `_regionSizesPass` fields next to `_undisplayedRegionContent` ([:120](packages/lib/src/typescript/lib/layout/Border.ts#L120)). Neither field is written during the `super()` cascade, so both take ordinary initialisers.

5. **`layout/Border.ts` — add `passRecord` and `invalidateRegionSizes`.** Put both private methods immediately above `regionPreferredSize` ([:594](packages/lib/src/typescript/lib/layout/Border.ts#L594)).

6. **`layout/Border.ts` — make the three helpers record-first.** Rewrite `regionPreferredSize` ([:594](packages/lib/src/typescript/lib/layout/Border.ts#L594)), `regionMinSize` ([:607](packages/lib/src/typescript/lib/layout/Border.ts#L607)) and `regionMaxSize` ([:623](packages/lib/src/typescript/lib/layout/Border.ts#L623)) per `## Internal Structure`. Keep each one's existing JSDoc and extend it with one sentence about the per-pass record.

7. **`layout/Border.ts` — route CENTER through the helpers.** Replace `center.getPreferredSize()` ([:909](packages/lib/src/typescript/lib/layout/Border.ts#L909)) with `this.regionPreferredSize(Placement.CENTER, center)`, `center.getMinSize()` ([:988](packages/lib/src/typescript/lib/layout/Border.ts#L988)) with `this.regionMinSize(Placement.CENTER, center)`, and replace `this.laidOut(this._centerComponent)?.getMinSize()` ([:1105](packages/lib/src/typescript/lib/layout/Border.ts#L1105)) with these two lines, matching how the neighbouring WEST and EAST lines are already written:

   ```ts
   const center    = this.laidOut(this._centerComponent);
   const centerMin = center ? this.regionMinSize(Placement.CENTER, center) : undefined;
   ```

   The `undefined` for an absent centre must be preserved — the lines below test `if (centerMin)`. Check: `grep -n 'center\.getPreferredSize()\|center\.getMinSize()' packages/lib/src/typescript/lib/layout/Border.ts` — expect zero matches. `regionMaxSize` already covers CENTER at [:1040](packages/lib/src/typescript/lib/layout/Border.ts#L1040); leave it alone.

8. **`layout/Border.ts` — drop the record when `doLayout` returns.** Wrap `doLayout`'s body ([:1182](packages/lib/src/typescript/lib/layout/Border.ts#L1182)) in `try { … } finally { this.invalidateRegionSizes(); }`, leaving its two early returns (no container, no container size) in front of the `try`.

9. **`layout/Border.ts` — drop the record on the other writers.** Call `this.invalidateRegionSizes()` at the end of `setLayoutConstraints` ([:170](packages/lib/src/typescript/lib/layout/Border.ts#L170)), `delLayoutConstraints` ([:226](packages/lib/src/typescript/lib/layout/Border.ts#L226)), `undisplayRegionContent` ([:408](packages/lib/src/typescript/lib/layout/Border.ts#L408)), `redisplayRegionContent` ([:464](packages/lib/src/typescript/lib/layout/Border.ts#L464)), `forgetRegionContent` ([:517](packages/lib/src/typescript/lib/layout/Border.ts#L517)) and `detach` ([:1507](packages/lib/src/typescript/lib/layout/Border.ts#L1507)). Leave `undisplayRegionContent`'s three live size reads ([:434-436](packages/lib/src/typescript/lib/layout/Border.ts#L434-L436)) exactly as they are.

10. **Add `packages/lib/tests/component/layout/Border.passRecord.test.ts`** covering every case in `## Expected Behaviour`. Model the scene on the existing Border suites: a `Container` with a `VBox` host wrapping a `Container` whose layout manager is the `Border`, one `Container` per placement, under `installTestDOM`.

11. **Run `## Verification`.**

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Border.ts` |
| Create | `packages/lib/tests/component/layout/Border.passRecord.test.ts` |

---

## Expected Behaviour

All cases below are unit-testable under the modelled DOM harness; none needs manual verification. Counts are for a five-region border inside a `VBox` host, each region a `Container` holding one 40×20 child — the scene probe `T1` used — driven by a single `outer.doLayout()`.

**1. Repeat reports inside one pass collapse to one.** Spying on each region component, one outer pass must call each region's `getPreferredSize`, `getMinSize` and `getMaxSize` exactly once. Today's counts, and the counts a working implementation produces:[^probe-numbers]

| Region | `getPreferredSize` | `getMinSize` | `getMaxSize` |
|---|---|---|---|
| NORTH / SOUTH / WEST / EAST — today | 5 | 8 | 3 |
| NORTH / SOUTH / WEST / EAST — after | **1** | **1** | **1** |
| CENTER — today | 4 | 3 | 3 |
| CENTER — after | **1** | **1** | **1** |

**2. Geometry is unchanged.** Every region's committed `(x, y, width, height)` after the pass is identical to what the same scene produces today. For the scene above that is `[0,0,120,20]`, `[0,0,120,20]`, `[0,0,40,10]`, `[0,0,40,10]`, `[0,0,30,10]` for north, south, west, east and centre.

**3. Nothing is recorded outside a layout pass.** With no layout running: read `host.getPreferredSize()`, add a child to the WEST region, read `host.getPreferredSize()` again. The second read must reflect the new child. (This is the case that a frame-keyed memo gets wrong.)

**4. Each pass reads afresh.** Two consecutive `outer.doLayout()` calls must produce two live reads per region, not one.

**5. A read taken after the border has laid out is live again, even inside the same pass.** This needs a host that reads its child twice around a commit, which no shipped manager does in this scene, so the test supplies one: a small `LayoutManager` subclass whose `doLayout` reads the border container's preferred size, calls `commitBounds` on it (which lays the border out), then reads it again. Spying on the WEST region, that single outer pass must ask it twice — once per host read — not once.

**6. A throwing layout leaves nothing behind.** Give the NORTH region a stub whose `getPreferredSize()` returns `null`, so `Border.doLayout` throws `"Unable to determine preferred size for north component."`. Assert the throw propagates, that `Component.currentLayoutPass()` is back to `0` afterwards, and that replacing the stub with an ordinary region and laying out again produces the normal geometry.

**7. Swapping the component in a region mid-pass is not served from the record.** With the probe host of case 5, and the second read replaced by: install a differently-sized component into the WEST slot via `host.addComponent(other, { placement: Placement.WEST })`, then read the border's preferred size. The new component's width must be used, not the outgoing one's.

**8. A collapsed, undisplayed region still reports its snapshot.** With WEST collapsed and its content out of the render tree, `Border.getMinSize()` must use the snapshot's minimum, not the now-childless region's live report — the behaviour `Border.collapseUndisplay.test.ts` already pins.

**9. Nested borders keep separate records.** A `Border` inside another `Border`'s CENTER region records its own regions; neither serves the other's numbers.

---

## Verification

Run from `packages/lib`:

- `npm run typecheck` and `npm run typecheck:test` — clean.
- `npm test` — the full suite (470 files / 7,519 tests before this plan's new file) must stay green. The simulated form of this change was run against that whole suite with zero failures, so a red test means the implementation diverges from this plan, not that the design is wrong.[^suite-prevalidated]
- `npm run lint` — clean.
- `grep -n 'center\.getPreferredSize()\|center\.getMinSize()' src/typescript/lib/layout/Border.ts` — zero matches.
- `npm run docs:api` — zero warnings. Public JSDoc on `Border.getPreferredSize` / `getMinSize` / `getMaxSize` must not `{@link}` the new private helpers or the `@internal` `Component.currentLayoutPass`; describe them in prose instead (CODE_CONVENTIONS.md, *Don't `{@link}` internal symbols from public JSDoc*).

Then re-measure in real WebKitGTK, against the same harness arms the ablation used — scenario S1 (2×2 dock grid, four editors, 2,387 elements), `work=1` and `widthprobe=1`, plain-bracketed at both ends:

- **Work avoided (the primary bar).** Counted per-frame work must fall from 2,969 to about 2,356 calls or fewer — the ablation's −20.6%. The permanent version should reach at least that: it also covers `doLayout`'s and `computeTotalMinSize`'s reads and the maximum-size reports, which the ablation did not.
- **Geometry.** The `widthprobe` width series must be byte-identical to the plain arms. Not "close" — identical, as the ablation's was.
- **Frame time.** Must not regress against the two plain arms (58.71 / 58.56 ms). The ablation measured 56.92 ms, −1.72 ms. A flat result at equal geometry and 20% less work still passes; a regression does not.

---

## Documentation Impact

None. `Component.currentLayoutPass` is `@internal` and `typedoc.json` sets `excludeInternal`, so it renders on no page; everything else is private. `scripts/llms/check-coverage.mjs` tracks concrete classes only, so `llms.txt` needs no entry. No barrel or export changes.

---

## Potential Challenges

- **Reindenting `Component.doLayout` around the `try`.** The body must be moved verbatim. Re-read the diff for the `try`/`finally` braces and confirm `lm.doLayout()` and `runFirstLayoutCallbacks()` are both inside the `try`.
- **`undefined` versus `null` in the record.** `null` is a real answer — "this region reports no size" — and must be re-served, not recomputed. Test the `undefined !== record.preferred` guard against a region whose manager reports `null`.
- **A future CENTER entry in `_undisplayedRegionContent` would change behaviour.** Routing CENTER through the helpers is equivalent only because that map can never hold a CENTER entry today. Say so in a comment at the helpers, so a later change that collapses the centre region does not quietly acquire a different meaning.
- **Only `Component.doLayout` may maintain the depth.** It is the sole place `LayoutManager.doLayout()` is invoked from, and the counter is only correct while that stays true.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/Border.ts`](packages/lib/src/typescript/lib/layout/Border.ts) — the whole file, and in particular `RegionContentSnapshot` ([:41-49](packages/lib/src/typescript/lib/layout/Border.ts#L41-L49)), the three region helpers ([:594-627](packages/lib/src/typescript/lib/layout/Border.ts#L594-L627)) and `doLayout` ([:1182](packages/lib/src/typescript/lib/layout/Border.ts#L1182)). `RegionContentSnapshot` is the precedent this plan follows.
- [`packages/lib/src/typescript/lib/core/Component.ts:7440-7460`](packages/lib/src/typescript/lib/core/Component.ts#L7440) — `doLayout`, the single funnel every layout pass goes through, and [`:179-183`](packages/lib/src/typescript/lib/core/Component.ts#L179-L183), the module-level layout-queue state the new counter joins.
- [`packages/lib/src/typescript/lib/core/Component.ts:676-682`](packages/lib/src/typescript/lib/core/Component.ts#L676-L682) — `_resolvedCache`, the library's model for a memo whose safety rests on naming every writer that can invalidate it.
- [`packages/lib/src/typescript/lib/component/container/ScrollStrip.ts:522-604`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L522) — `layoutItems` / `arrowRefreshDueThisPass`, the per-pass "does this pass have to re-derive it" gate this campaign already landed.
- [`packages/lib/tests/component/layout/Border.test.ts`](packages/lib/tests/component/layout/Border.test.ts) and [`Border.collapseUndisplay.test.ts`](packages/lib/tests/component/layout/Border.collapseUndisplay.test.ts) — the suites that pin the minimum floor, middle-row aggregation, overflow inflation and the snapshot substitution.
- [`ARCHITECTURE.md`](ARCHITECTURE.md), *Size constraints: who is responsible for what* — rule 3: a manager that does not report accurate sizes is a bug, fixed at the manager. The record must not become such a bug.
- [`plans/research/render-review-2026-09-15/97-wave2-measurement.md`](plans/research/render-review-2026-09-15/97-wave2-measurement.md) — the sweep this plan implements one arm of, and the acceptance numbers.

---

## Non-Goals

- **F06.4, the `Split.recalculateSizes` signature gate.** Its ablation produced a *different* layout from the unablated arm, so it is not behaviour-preserving as tested and would have to earn its correctness separately.[^f064]
- **F06.3, the no-op drag-frame gate on `Split.onDrag`.** Never measured — the harness's drag never parks against a clamp, so the frames it targets did not occur in the sweep.[^f063]
- **A general size-hint memo across all components.** The same sweep measured it: a 65% cut in size-hint calls bought no frame time and broke geometry on S1. Whatever becomes of that idea, it is not this plan.[^size-memo]
- **`Split`, `CollapseButton` and `SplitGutter` changes** from the rest of group G12. This plan touches `Border` and the `Component` counter it needs, nothing else.
- **Recording sizes across passes.** The record never outlives the pass that filled it. Anything longer needs an invalidation signal for arbitrary subtree mutations, which the framework does not have.

---

## Notes

[^measured]: From `plans/research/render-review-2026-09-15/97-wave2-measurement.md`, arm `border.region-memo` on scenario S1 (2×2 dock grid, four editors, 2,387 elements): 56.92 ms average frame against plain arms at 58.71 / 58.56 ms, so −1.72 ms or −2.9%; counted per-frame work 2,969 → 2,356 calls, −20.6%; 44 memoised region reports per frame; geometry identical to the unablated arm. Two other arms in the same sweep — `size.memo` and `split.recalc-gate` — produced different geometry and had their timings voided, so "identical" here is a measured result, not an assumption. `Border` is on Loom's hot path four times over in S1: `FileEditor` is a container with a `BorderLayout` (one per editor panel) plus two more in `EditorShell`, and a `Dock` region is itself a `Split` whose panes are these borders — correction C3 in `98-wave2-rejustification.md`.

[^triple-not-aggregate]: The ablation memoised `Border.getPreferredSize` / `getMinSize` wholesale — the border's own aggregated answer. Recording the per-region triples instead is both safer and worth more. Safer, because everything the border computes locally — the container's perimeter, the spacing, the collapsed flags, the `laidOut` displayed-or-absent test — is re-read on every call, so a change to any of them is picked up immediately; only the recursive subtree walk is re-served. Worth more, because the helpers are also what `doLayout`, `computeTotalMinSize` and `getMaxSize` read through, none of which the ablation covered. The arithmetic that is recomputed is a handful of `Math.max` calls per region.

[^snapshot-precedent]: `Border` already interposes a per-region `{preferred, min, max}` record in front of the live read: `RegionContentSnapshot`, taken when a collapsed region's content leaves the render tree and served by `regionPreferredSize` / `regionMinSize` / `regionMaxSize` until it comes back. Slice 06's own write-up of F06.5 named those three helpers "the natural cache point" for the same reason. The second precedent is `Component._resolvedCache` (`core/Component.ts:676-682`), whose correctness argument is the one this plan copies in structure: name every writer that could change an answer, clear the memo there, and state why nothing else can. `ScrollStrip.arrowRefreshDueThisPass` is the third — a per-pass "must this pass re-derive it" decision that landed earlier in this same campaign.

[^pass-not-frame]: The alternative keys were both rejected. **A frame** is what the ablation used and what `size.memo` used, and `size.memo` broke geometry on S1 with it: one animation frame runs several layout passes, sizes legitimately change between them, and a frame-keyed memo serves the first pass's numbers to the third. **A stack scope** — a record living only while a `Border` call is on the stack — is provably safe but collapses nothing, because the repeated reports are separate top-level calls made by the host manager, not re-entries. The outermost-`doLayout` pass is the interval that is both long enough to catch them and short enough to contain no application code: while the stack is inside a layout pass, nothing else can run and mutate a region's subtree. Outside a pass there is no such guarantee, which is why nothing is recorded there. `Component.doLayout` is the only place `LayoutManager.doLayout()` is called from, so counting there sees every pass, including the ones `Split.onDrag` drives outside the batched flush.

[^drop-on-dolayout]: A layout pass is only free of writes until the border starts committing. `Border.doLayout` hands each region its rectangle, which lays that region's subtree out, which can change what the region reports next — a text that re-wraps at its new width being the standard case. If the host reads the border again later in the same pass, it must see the new numbers. Clearing the record as `doLayout` returns gives that. Reads taken *during* `doLayout` are still safe to serve, because `doLayout` reads each region once and reads it before committing that region, and committing one region cannot change a different region's subtree. The `finally` matters: `doLayout` throws on a region that reports no preferred size, and the batched flush catches and continues, so a record left behind would outlive its pass.

[^centre-equivalence]: `regionPreferredSize(CENTER, c)` returns `snapshot.preferred` when `_undisplayedRegionContent` holds a CENTER entry and `c.getPreferredSize()` otherwise. That map can never hold a CENTER entry: `setRegionCollapsed` returns early for CENTER (`layout/Border.ts:308`), `isRegionCollapsible(CENTER)` is always `false` (`:638`), and `reconcileCollapsedRegions` — the only caller of `undisplayRegionContent` — loops over the four edges only (`:541`). So the substitution returns the same value on every input today, and CENTER is the region the change matters most for: in Loom it is the whole CodeMirror wrapper.

[^snapshot-live]: The snapshot is the region's truth at the instant its content leaves the render tree, and it is taken from `reconcileCollapsedRegions` at the tail of `doLayout` — after the commits. A record entry filled before those commits could be older than that instant, and the snapshot then stands in for the region's size for as long as it stays collapsed, so a stale capture would persist far beyond the pass. The three reads at `:434-436` stay direct.

[^probe-numbers]: Both rows were measured, not estimated, on 2026-09-17 against `master` at 3dccbf8f. The "today" row reproduces slice 06's probe `T1` exactly (5 preferred / 8 min / 3 max per edge region, 4 / 3 / 3 for the centre). The "after" row was produced by wrapping the three helpers with the record described here and routing CENTER through them, in a throwaway test against unmodified library source; all five regions fell to 1 / 1 / 1 and the five committed rectangles were unchanged. The eight surplus minimum reports per edge region are why `getMinSize` is the biggest single line in the table: `getPreferredSize` asks for each region's minimum as well as its preferred, and runs four times itself.

[^suite-prevalidated]: On 2026-09-17 the design was applied to unmodified library source at runtime — a pass counter around `Component.prototype.doLayout`, the record behind the three `Border` helpers keyed on it, cleared when `Border.prototype.doLayout` returned — and the full `packages/lib` suite was run against it: 470 files, 7,519 tests, 2 todo, zero failures, including `Border.test.ts`, `Border.collapseUndisplay.test.ts`, `Split.collapseUndisplay.test.ts`, `CollapseAnimationTeardown.test.ts` and `DegenerateChildSets.test.ts`. That shim did not include the CENTER routing, which is argued separately and is a no-op substitution today.

[^f064]: F06.4 would gate `Split.recalculateSizes` on a change signature. Its ablation (`split.recalc-gate`) measured −0.44 ms and −14.8% work on S1 but laid the page out differently from the plain arms — editor heights reaching 835 or 1615 px against plain's 963–1188 px. An ablated page that lays out differently is not doing equivalent work, so its timing is void and its correctness is unproven. It belongs in its own plan, where it can earn the correctness this one gets for free.

[^f063]: F06.3 would skip `Split.onDrag`'s two `doLayout()` calls when the clamp absorbed the whole move. It was never measured: the harness's drag walks a triangle wave of ±step for half the frames each way, so at the default 3 px × 150 frames it travels 225 px and returns without ever reaching the pane minimum. The clamped frames the change targets did not occur. Measuring it needs only new parameters (`step=8&frames=150` on the explorer gutter), not a new scenario — but until that run exists, including it here would put unmeasured scope inside a plan whose whole warrant is a measurement.

[^size-memo]: `size.memo` memoised `getPreferredSize` / `getMinSize` / `getMaxSize` on every component, keyed per frame. It removed 1,929 size-hint calls per frame on S1 (−65%) and the frame got no faster (+0.58 ms); on S1 it also produced different geometry. It is the largest work lever measured anywhere in the campaign and the sweep's re-scoring keeps it alive as an open question at per-pass granularity. `Component.currentLayoutPass` is the granularity that question needs, so this plan leaves it available — but a general memo has to answer for every component in the tree, which is a different and much larger correctness argument than five regions behind three helpers in one file.

---

## Implementation Notes

Implemented as written — the three `Border` helpers, the CENTER routing, the
six invalidation sites and `Component.currentLayoutPass` all landed in the
shape `## Internal Structure` and `## Ordered Implementation Steps` specify,
and the new suite's scene reproduces probe `T1` exactly (5 / 8 / 3 per edge
region and 4 / 3 / 3 for the centre before the change, 1 / 1 / 1 for all five
after, with the five committed rectangles the plan lists). One correction to
the plan's definition of a layout pass, and four other findings, are worth
recording. Cases 10 to 12 in the new suite are additions beyond the plan's
nine: two pin the halves of that correction, and one pins the `null`-versus-
`undefined` guard `## Potential Challenges` asked for.

**Case 7's test is arranged more strictly than the plan's wording.** The plan
described it as case 5's probe with "the second read replaced by" the slot
swap, which would leave `commitBounds` — and therefore `doLayout`'s own
invalidation — between the swap and the read, so the test would pass whether
or not `setLayoutConstraints` dropped the record. The test instead performs
the swap between the two reads with no commit in between, which is the
arrangement that actually pins the slot-swap invalidation the plan's
`## Architecture Decisions` calls for.

**`npm run docs:api` reports 14 warnings, not zero.** All 14 are pre-existing:
the same build on the base branch (`master` at `3a9a002e`) reports exactly the
same 14, in `SpatialNavigation`, `rankInDirection`, `FieldDecorator`,
`MarkdownViewer` and `MarkdownEditor`. This branch adds none — nothing it
touches renders, as `## Documentation Impact` predicted. The plan's "zero
warnings" was stale against the base, not a statement this change violates.

**The WebKitGTK re-measurement passes on work and geometry; frame time is
flat, not −1.72 ms.** Twenty-one S1 runs (`work=1&widthprobe=1`, alternating
plain and branch) across three rounds, the last of which measures the final
code: counted per-frame work falls 2,969 → 2,116, **−28.7%**, comfortably past
the −20.6% the plan required, and every branch arm's `widthprobe` width series
and ranges are byte-identical to every plain arm's. Frame time in the final
round came out at a 56.13 ms median against plain's 57.08 — no regression, but
no resolvable gain either, because the plain arms alone spanned 4.5 ms across
the session against the original sweep's 0.15 ms spread. Per `## Verification`'s
own rule, a flat result at equal geometry and 20% less work passes.

**The `null`-guard case reads the preferred size only.** `## Potential
Challenges` asks for the `undefined !== record.preferred` guard to be tested
against a region whose manager reports `null`. Case 12 does that on a centre
region reporting `null` on all three axes, but asserts only on the preferred
size: a region's minimum and maximum are additionally read by its own
commit-time clamp, which this record deliberately does not sit in front of, so
those two counts carry reads the guard has no say over. The preferred size is
read only through `Border`'s helper, and rewriting the guard as a truthiness
check takes that count from 1 to 4 — verified by mutation.

**The work counters confirm the CENTER routing is what pays.** The per-class
diff shows `getMinSize@CodeEditor` 52 → 24, `getMaxSize@CodeEditor` 44 → 16
and `getPreferredSize@CodeEditor` 16 → 8 — the Loom editor wrapper sitting in
a `FileEditor` border's CENTER slot, which the ablation never covered. That,
plus `FileBreadcrumbs` and everything under it, is the extra 8 points over the
ablation's −20.6%.

**A layout pass does run consumer code at two points, and the pass number
ends at each — this corrects the plan, and the three sibling plans keyed on
the number.** Footnote `[^pass-not-frame]` argues the outermost-`doLayout`
interval "contain[s] no application code", and `## Public API` says the number
"stays the same for everything that pass recurses into". Neither holds. The
`onFirstLayout` drain at the end of `Component.doLayout` runs consumer
callbacks inside the pass; and `notifySizeChange` dispatches the public
`sizechange` bag from inside `setWidth` / `setHeight`, which `commitBounds`
reaches for every child every manager commits. A listener at either point can
mutate a subtree a manager measured earlier in the same pass. Both were
reproduced before being fixed: an unfixed record served a west region's
pre-callback width and committed it at 40 px where `master` commits 80 px.
Cases 10 and 11 in the new suite pin one each.

The fix keeps the plan's design and narrows its definition to what is
actually true: **a pass number identifies an interval during which nothing has
run that could change a layout-derived answer.** It starts at an outermost
`doLayout()` and ends at whichever comes first — that call returning, an
`onFirstLayout` drain that actually ran callbacks, or a `sizechange` dispatch
on a component that has listeners. The two consumer-code points share one
module-level `endLayoutPassNumber()` in `core/Component.ts`. Nested layouts
still share the enclosing number and `0` still means no pass. A sibling plan
should key on this weaker, true guarantee, not on "no application code runs
inside a pass". The `sizechange` half was foreseen: `plans/size-hint-per-pass-memo.md`'s
`[^border-consistency]` names this plan and says `commitBounds` fires those
listeners mid-pass. Ending the pass there costs nothing measurable — the same
2,969 → 2,116 work and the same byte-identical geometry as before the fix.

One consequence of maintaining the counter inside `Component.doLayout`, also
for the sibling plans: a `Component` subclass that overrides `doLayout()` runs
the part of its own body outside `super.doLayout()` under the *enclosing*
frame's number — `0` only when it is itself the outermost call, and the live
pass number whenever anything above it is still laying out. Reads taken there
are therefore not automatically live.
