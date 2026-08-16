# Size-Stable Position Fast Path — Implementation Plan

## Overview

[`LayoutManager.commitBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L484) is the single chokepoint that every generic layout manager (`HBox`, `VBox`, `Grid`, `Border`, `Absolute`, `Card`, `Split`, `Tab`) calls to place a child: it writes `left`/`top`/`width`/`height` via [`Component.setX`/`setY`/`setWidth`/`setHeight`](packages/lib/src/typescript/lib/core/Component.ts#L3372-L3590), then recurses into the child's own `doLayout`. A live microbenchmark (3000 absolutely-positioned elements, forced-synchronous-layout methodology) measured during this session found that when a child's size doesn't change but its position does, writing the move as `transform: translate3d()` instead of `left`/`top` is ~24% cheaper (13.7ms vs 18.0ms median); when size changes too, adding a `transform` write on top is a net loss (25.9ms vs 24.3ms for `left`/`top` alone), so the two paths must stay strictly separated.

This plan adds that fast path to `commitBounds` only. When a child's `[width, height]` are unchanged from its last commit, the position move goes through [`Component.setTranslate`](packages/lib/src/typescript/lib/core/Component.ts#L3775) instead of `setX`/`setY`; when size changes (with or without a position change), `commitBounds` keeps writing `left`/`top`/`width`/`height` exactly as it does today, and folds any leftover `transform` back to zero in the same write batch. The only other file touched is [`LayoutManager.reserveContentFrame`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L256-L296), which reads the same children's committed geometry immediately afterward and must account for the new translate-only case.

---

## Architecture Decisions

### The fast path lives in `commitBounds`, not in the individual setters

`Component.setX`/`setY`/`setWidth`/`setHeight` stay exactly as they are today. The size-vs-position comparison needs both the old and new width/height/x/y in hand at once, which only `commitBounds` has — the setters don't know about each other's calls.[^chokepoint-scope]

### Trigger: size unchanged, and no CSS transition already covers the move

Before writing anything, `commitBounds` compares the incoming `width`/`height` against `component.getWidth()`/`getHeight()`. When they match, and the component has no CSS transition configured (`component.getTransition()` is `null` or `"none"`), it takes the fast path; otherwise it writes `left`/`top`/`width`/`height` exactly as today.[^transition-evidence]

| Incoming commit | `getTransition()` | Path |
|---|---|---|
| size same, position same | `null` | fast (no-op — `setTranslate` computes a zero delta) |
| size same, position moved | `null` | fast |
| size same, position moved | `"left 200ms ease"` | slow |
| size changed (position moved or not) | any | slow |

### `getX()`/`getY()` keep reporting the pre-move value; `getX() + getTranslateX()` is the true visual position

The fast path does **not** update `_left`/`_top` — it leaves them at the last value a real `setX`/`setY` wrote, and drives the whole move through `_translateX`/`_translateY`. This is not a new rule invented for this feature; it matches the convention the codebase has already shipped and tested for its three existing `setTranslate` users.[^getxgety-precedent]

`commitBounds` computes the translate delta as `x - component.getX()` / `y - component.getY()` on every fast-path call — an absolute offset from the frozen anchor, not an incremental one — so a run of many consecutive fast-path commits (e.g. every `mousemove` tick of a `Split` gutter drag) never accumulates drift:

| Call | `x` target | `getX()` before | `getTranslateX()` after | `getX() + getTranslateX()` |
|---|---|---|---|---|
| 1st fast-path commit | 120 | 100 (frozen) | 20 | 120 |
| 2nd fast-path commit | 145 | 100 (still frozen) | 45 | 145 |
| slow-path commit (size changes) | 150 | 150 (`setX` ran) | 0 (folded back) | 150 |

### `reserveContentFrame` must add the translate offset back in

[`reserveContentFrame`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L256-L296) reads each just-placed child's `getX()`/`getY()` immediately after the placement loop, in the same `doLayout` pass — the one place in the framework guaranteed to observe a child mid-fast-path. Its `farRight`/`farBottom` computation is updated to read `getX() + getTranslateX()` and `getY() + getTranslateY()`, or a scroll-enabled host with a fast-pathed child gets the wrong scroll extent on the very next frame.[^reservecontentframe-required]

Other framework code that reads a `Component`'s `getX()`/`getY()` outside this same pass (`DragFeedback`, `CollapseSupport.captureRect`, `DiagramView`, `TabBar`, `Popover`, `Rail`, `FloatingPanel`, `BaselinePanel`) is **not** changed by this plan — see `## Potential Challenges` and `## Non-Goals`.

### `will-change: transform` is promoted lazily, only while the fast path is active

`commitBounds` calls `component.setWillChange("transform")` only inside the fast-path branch, and `component.setWillChange(null)` in the slow-path branch (both are cheap no-ops via `setWillChange`'s own `_willChange === value` guard when nothing needs to change). This mirrors `AbstractWindow.onDrag`/`onMouseUp`, which promote and release the layer around exactly the same-shaped gesture.[^willchange-lazy]

### Real occurrence beyond rows/drag/collapse: `Split` gutter-drag trailing panes

`Split.commitPanes` places every pane through `commitBounds`, and a gutter drag resizes only the one or two panes adjacent to it — every pane past that point keeps its own width/height and only shifts `x`/`y`, repeated on every `mousemove` tick for the length of the drag. `Grid`, `HBox`, `VBox`, `Border`, `Absolute`, and `Card` route their own sibling-shift reflows (an earlier child growing/shrinking and displacing the ones after it) through the same `commitPlacements` → `commitBounds` path, so they benefit automatically, with no changes outside `LayoutManager.ts`.

`Accordion` and `Table` do **not** benefit — both place their children with direct `setX`/`setY`/`setWidth`/`setHeight` calls, bypassing `commitBounds` entirely. Routing them through it would be a separate, larger change to each manager and is out of scope here.[^opportunity-sizing]

---

## Internal Structure

`LayoutManager.commitBounds` (replaces the current unconditional four-setter body):

```typescript
protected commitBounds(component: Component, x: number, y: number, width: number, height: number): void {
    component.setAutoCommitStyle(false);

    const sizeUnchanged = component.getWidth() === width && component.getHeight() === height;
    const transition = component.getTransition();
    const canFastPath = sizeUnchanged && (transition === null || transition === "none");

    if (canFastPath) {
        component.setWillChange("transform");
        component.setTranslate(x - component.getX(), y - component.getY());
    } else {
        component.setX(x);
        component.setY(y);
        component.setTranslate(0, 0);
        component.setWillChange(null);
    }

    component.setWidth(width);
    component.setHeight(height);

    component.doLayout();

    component.setAutoCommitStyle(true);
}
```

`setWidth`/`setHeight` stay unconditional in both branches — they're guaranteed no-ops on the fast path (that's the definition of `sizeUnchanged`) and cost only an equality check, matching how `commitBounds` already calls every setter unconditionally today and lets each one's own guard decide whether to write.

`LayoutManager.reserveContentFrame`'s placement loop (`packages/lib/src/typescript/lib/layout/LayoutManager.ts:276-279`):

```typescript
for (const component of components) {
    farRight  = Math.max(farRight,  component.getX() + component.getTranslateX() + component.getWidth());
    farBottom = Math.max(farBottom, component.getY() + component.getTranslateY() + component.getHeight());
}
```

---

## Ordered Implementation Steps

1. In `packages/lib/src/typescript/lib/layout/LayoutManager.ts`, replace `commitBounds`'s body (lines 484-494) with the version in `## Internal Structure`. Update its JSDoc (lines 466-483) to describe the fast path: when it engages, what it writes, and that `getX()`/`getY()` continue to report the pre-move value while it's active (point readers at `getX() + getTranslateX()`).
   Verify: `grep -n "component.setX(x)" packages/lib/src/typescript/lib/layout/LayoutManager.ts` shows the call now inside the `else` branch only.

2. In the same file, update `reserveContentFrame`'s placement loop (lines 276-279) to add `getTranslateX()`/`getTranslateY()` as shown in `## Internal Structure`. Update the docstring at lines 248-249 ("reads each child's committed `getX`/`getY`/`getWidth`/`getHeight`") to mention the translate offset.
   Verify: the two `Math.max` lines both include a `getTranslateX()`/`getTranslateY()` term.

3. Add `packages/lib/tests/component/layout/LayoutManager.commitBounds.test.ts` covering the cases in `## Expected Behaviour`, built on `HBox` (simplest manager that routes through `commitPlacements`). Use the existing `getX() + getTranslateX()` idiom from `content-box-containment.test.ts`'s `rect()` helper for any assertion that needs the true visual position.

4. Run the full test suite (`npm test` from `packages/lib`). Any pre-existing failure caused by a bare `getX()`/`getY()` assertion on a child that now takes the fast path (most likely in multi-pass reflow tests under `packages/lib/tests/component/layout/`) is fixed by adding `+ getTranslateX()`/`+ getTranslateY()` to that assertion — never by disabling or narrowing the fast path to make the old assertion pass unchanged.
   Verify: full suite green.

5. Typecheck: `npm run typecheck` (or the project's configured check script) from the repo root — zero errors.

6. Manual smoke test: run the docs app (`npm run docs:dev`, per the project's dev-server convention) and open the Split-panes demo (`packages/docs/src/demos/split-panes.ts`) with 3+ panes. Drag a gutter and confirm every pane — including ones not adjacent to the dragged gutter — tracks the cursor with no visible jump or lag. Toggle a pane's collapse chevron and confirm the collapse/restore animation still slides smoothly (not a snap) for panes shifted by the toggle.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/LayoutManager.ts` |
| Create | `packages/lib/tests/component/layout/LayoutManager.commitBounds.test.ts` |

---

## Expected Behaviour

Unit-testable (via `HBox` + `commitPlacements`, following `## Ordered Implementation Steps` #3):

1. **Position-only move, size unchanged**: after a second `doLayout` pass that only shifts a child's `x`/`y`, `child.getTranslateX()` (or `getTranslateY()`) equals the delta, and `child.getX() + child.getTranslateX()` equals the new target position.
2. **First-ever placement**: a component's very first `commitBounds` call always takes the slow path (its cached width/height start at `NaN`, so `sizeUnchanged` is false), writing real `left`/`top`/`width`/`height`. No special-casing is needed for this — it falls out of the `NaN === width` comparison being false.
3. **Nothing changed**: a `doLayout` pass that reproduces the same `x`/`y`/`width`/`height` as last time takes the fast-path branch (size matches) but produces zero DOM writes — `setTranslate`'s own no-op guard absorbs the zero-delta call.
4. **Size change, with or without a position change**: `commitBounds` writes real `left`/`top`/`width`/`height` as it does today. If the component had a nonzero translate from a prior fast-path run, this same commit resets it to `(0, 0)` in the same batched flush (no extra write pass).
5. **A configured CSS transition blocks the fast path**: a component with `getTransition()` returning a non-`null`, non-`"none"` value takes the slow path even when size is unchanged, so an active `left`/`width`-covering transition (as `CollapseSupport.primeCollapse` sets up) keeps animating a real `left` write.
6. **`will-change`**: `child.getWillChange()` is `"transform"` only while the fast path is engaged for that component, and reverts to `null` the next time the slow path runs for it.

Manual-verify only (see step 6): the Split-panes gutter-drag and collapse-animation smoke test — geometry-under-drag and CSS-transition-interaction aren't exercised by the offline test harness.

---

## Verification

- `npm run typecheck` (repo root) — zero errors.
- `npm test` in `packages/lib` — full suite green, including the new `LayoutManager.commitBounds.test.ts` and any adjusted pre-existing assertions per step 4.
- Manual smoke test per step 6, on the docs dev server (`npm run docs:dev`, localhost:5173).

---

## Potential Challenges

- **A component picks up a CSS transition while still mid-fast-path** (translate active, no size-changing commit has run yet to fold it back into `left`/`top`): the next commit sees a transition and takes the slow path, writing `setX`/`setY` plus `setTranslate(0, 0)` in the same batch. Because the transition's `left` start value is the frozen pre-fast-path anchor — not the translate-adjusted visual position — and `transform` snaps to zero in the same frame, this can produce a one-frame visual jump before the transition's slide begins. Reaching this needs two independent gestures landing back-to-back on the same component with no intervening size change; the final position is still correct, only the transition's start frame is briefly off. Not mitigated in this plan — documented as an accepted, low-severity edge case.
- **Existing tests asserting bare `getX()`/`getY()` on a child that starts taking the fast path**: mitigated by step 4's triage guidance (add `+ getTranslateX()`/`+ getTranslateY()`, following the `rect()` helper precedent already in `content-box-containment.test.ts`).
- **Cross-component `getX()`/`getY()` readers outside the same reflow pass** (`DragFeedback`, `CollapseSupport.captureRect`, `DiagramView`, `TabBar`, `Popover`, `Rail`, `FloatingPanel`, `BaselinePanel`): could observe a stale position while a fast-pathed component hasn't yet had a size-changing commit to fold back into `left`/`top`. Left unfixed — see `## Non-Goals`.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts) — `commitBounds` (L484), `commitPlacements` (L503), `placeComponent` (L318), `reserveContentFrame` (L256) — the code this plan changes.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `setX`/`setY`/`setWidth`/`setHeight` (L3372-L3590), `setTranslate`/`getTranslateX`/`getTranslateY` (L3749-L3790), `getTransition`/`setTransition` (L4215-L4237), `setWillChange` (L4467) — every primitive the new `commitBounds` body calls; none of these need to change.
- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts:1811-1844`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1811-L1844) — the precedent this plan's `getX()`/`getY()` decision follows (`onDrag`/`onMouseUp`, the "field-DOM invariant" comment).
- [`packages/lib/src/typescript/lib/layout/CollapseSupport.ts:132-175`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L132-L175) — `primeCollapse`, the reason the fast path checks `getTransition()`.
- [`packages/lib/src/typescript/lib/layout/Split.ts:1636-1639`](packages/lib/src/typescript/lib/layout/Split.ts#L1636-L1639) — `commitPanes`, the concrete "real occurrence" case this plan is sized against.
- [`packages/lib/tests/component/content-box-containment.test.ts:77-90`](packages/lib/tests/component/content-box-containment.test.ts#L77-L90) — the existing `rect()` helper; reuse its `getX() + getTranslateX()` idiom in the new tests and in any triage from step 4.
- [`packages/lib/tests/component/container/Scrollbar.test.ts:223-258`](packages/lib/tests/component/container/Scrollbar.test.ts#L223-L258) — the existing test that pins down "static X/Y unaffected by translate" as already-shipped, already-tested behavior.

---

## Non-Goals

- Routing `Accordion` or `Table` through `commitBounds` so their reflows can also take the fast path — a separate, larger change to each manager's placement code, not requested here.
- `Text`-measurement batching (`plans/text-measurement-batching.md`) — a different mechanism, unrelated to geometry commits.
- CSS `contain`/containment.
- Changing `getX()`/`getY()`'s formula to fold in translate globally — rejected; would break the already-shipped, already-tested "static X/Y, translate carries the live offset" contract (`Scrollbar.test.ts`).
- Fixing every cross-component `getX()`/`getY()` read site outside the same reflow pass (`DragFeedback`, `DiagramView`, etc.) — see `## Potential Challenges`; only `reserveContentFrame` is fixed, because it's the one call guaranteed to run in the same pass as the commit it reads.
- Live profiling/tracing of the `Split` gutter-drag scenario in a running app — the "real occurrence" evidence in this plan is a static read of `Split.commitPanes` and `Split.doLayout`'s drag handling, not a captured trace. No live app instrumentation was available while drafting this plan.

---

## Implementation Notes

Step 6's manual smoke test was run against a live `npm run docs:dev` server (this worktree's own `packages/lib`, symlinked and rebuilt via `npm install` + `npm run build:lib` inside the worktree — see `feedback_worktree_browser_checks_load_main_tree_lib`), driven via the Chrome DevTools MCP. `packages/docs/src/demos/split-panes.ts` was temporarily edited to add a third pane for the duration of the test, then reverted (`git checkout --`) — the demo file carries no permanent change.

- **Gutter drag** (`/layouts/Split`, dragging the gutter between the first two panes via synthetic `mousedown`/`mousemove`/`mouseup` at the gutter's DOM coordinates): the two adjacent panes resized continuously and smoothly across every sampled tick, with no jump, lag, or `NaN` geometry. The third, non-adjacent pane's position never changed during the drag — expected, not a regression: `Split.onDrag` (`Split.ts:1015-1063`) moves only the two panes adjacent to the dragged gutter via raw `setX`/`setWidth` calls on every `mousemove` tick, and never calls `commitBounds`, so this plan's fast path is not on the live per-tick drag path at all (only a full `Split.doLayout()` — e.g. on collapse, resize, or initial mount — reaches it via `commitPanes`). This narrows the plan's Architecture Decision "real occurrence" framing (dragging a gutter is not itself an occurrence of the fast path), but does not affect the implementation: `commitBounds`'s fast path is exercised elsewhere in this same page (see next point) and is proven correct in isolation by `LayoutManager.commitBounds.test.ts`.
- **Collapse/restore animation** (double-clicking a gutter's chevron): confirmed live that `CollapseSupport.primeCollapse`'s transition correctly keeps the collapse/restore pass on the slow path — every sampled frame showed real `left`/`width` writes (no `transform`) on the panes whose size changed during the animation, sliding smoothly with no snap, and settling at the exact pre-collapse geometry on restore. No console errors were observed during either interaction.
- Separately, a real `doLayout()` pass with unchanged geometry (page load's own post-mount remeasure) was observed live promoting `will-change: transform` on ordinary page-chrome components with no visible effect — confirming the fast path's zero-delta branch engages correctly outside the offline test harness too.

**Deviation — `TabBar.ts` fixed, outside the plan's file list.** The plan's `## Potential Challenges` named `TabBar` among the cross-component `getX()`/`getY()` readers it judged safe to leave unfixed as "outside the same reflow pass," per the selection rule stated in `## Non-Goals` ("only `reserveContentFrame` is fixed, because it's the one call guaranteed to run in the same pass as the commit it reads"). That premise was wrong for `TabBar`: `TabBar.positionIndicator()` (`TabBar.ts:2494-2511`) runs immediately after `_tabClip.layoutContent()` in the same synchronous `layoutChrome()` pass (`TabBar.ts:2697,2706`) that places tab wrappers through `commitBounds` via the strip's `HBox({ mode: "equal" })` — so it *is* guaranteed same-pass, by the plan's own stated criterion, and was simply misclassified. Left unfixed, a same-tab-count reorder (equal-width mode keeps every wrapper's width unchanged, only positions shift) drives the active tab's wrapper onto the fast path, and the bare `wrapper.getX()`/`getY()` read in `positionIndicator()` then feeds the pre-move coordinate to the sliding selection indicator, visibly detaching it from the active tab. `updateReorderSlot()` and `slotBoundary()` (`TabBar.ts:2947-3011`) read the same wrappers' bare `getX()`/`getY()` to place the drag-reorder drop indicator, sharing the identical risk once any preceding relayout left a wrapper mid-fast-path (the frozen state persists until that wrapper's next size-changing commit, not just for one pass). All three were fixed the same way as `reserveContentFrame` — folding in `getTranslateX()`/`getTranslateY()` — with a new regression test (`TabBar.test.ts`, "TabBar selection indicator tracks the active tab across a same-count reorder") pinning the `positionIndicator` case, the one with a live, empirically-confirmed repro. This was found by the second audit round, not by the original implementation pass.

**Deviation — `Toggle.ts` fixed, also outside the plan's file list.** Found by the third audit round: `Toggle.doLayout()` (`Toggle.ts:282-292`) nudges its inline label down after `super.doLayout()` places it, via `label.setY(label.getY() + offset)` — a relative rewrite that relied on `commitBounds` always having just rewritten `label`'s `_top` to the layout-computed natural value first. Once `label`'s own size stabilizes (the common case — its text and the pill height don't change pass to pass), `commitBounds` fast-paths its placement instead, leaving `_top` frozen at the *previous pass's already-nudged* value while the actual move rides on `getTranslateY()`. The old relative rewrite then compounded the nudge on top of itself every subsequent pass — `label.getY()` growing without bound (nudge, 2×nudge, 3×nudge, …) while `getTranslateY()` grew correspondingly negative to cancel it out visually, leaving `will-change: transform` permanently promoted and a real style write on every pass instead of the documented zero-write no-op. Fixed by folding `getTranslateY()` into the read before nudging, then re-zeroing the translate — `label.setY(label.getY() + label.getTranslateY() + offset); label.setTranslate(label.getTranslateX(), 0);` — mirroring the same read-fold/write-reset pairing `commitBounds`'s own slow path uses. A regression test (`Toggle.test.ts`, "keeps the label at a stable static Y across no-op relayouts") pins the static-Y stability across repeated no-op `doLayout()` passes that the unfixed code failed (the value grew every pass instead of holding steady).

**Audit loop stopped at its 3-iteration cap — two BLOCKING findings from the fourth (final) round are still open, unfixed.** Each prior round's fix uncovered a new instance of the same bug class (a bare `getX()`/`getY()` read on a component `commitBounds` can fast-path) in code outside the plan's original scope, and round 4 found two more instead of converging to zero:

1. **`CollapseSupport.captureRect`** (`packages/lib/src/typescript/lib/layout/CollapseSupport.ts:202`, used by `runCollapse` at `:451,459`) — reads a collapse/restore participant's bare `getX()`/`getY()` around the `container.doLayout()` that places every participant through `commitBounds`. Empirically confirmed exploitable: a container resize that leaves a weight-pinned pane mid-fast-path, followed by an unrelated sibling's collapse toggle, snaps that pane to a stale position. Shared by `Split.setPaneCollapsed` and `Border.setRegionCollapsed`.
2. **`Rail.handleMainAxisOffset`** (`packages/lib/src/typescript/lib/overlay/Rail.ts:1169`, call sites `:1177,1189`) — reads a rail handle's bare `getX()`/`getY()`, feeding `AbstractWindow.railGenieTransform()`'s minimize/restore animation geometry. Empirically confirmed exploitable: restoring one minimized window compacts the rail's remaining handles via the fast path, and the next handle's genie transform reads the stale pre-compaction position.

Both were reported with an empirical repro (scratch vitest tests, run then discarded) by the round-4 reviewer. Neither has been fixed — the audit skill's own 3-iteration cap was reached (each iteration fixed the round's finding(s) and folded them via `--fixup`/`git rebase --autosquash`, which is done; the fold changed no tree content, verified before/after). Per `implement/worker.md`'s Audit section, the run is not done: the plan stays at `plans/in-progress/`, not moved to `plans/implemented/`. A follow-up session should treat these two sites as the next fix, verify no further instances of the class remain (round 4's reviewer swept broadly and found only these two beyond the already-fixed `TabBar`/`Toggle`, with explicit reasoning for six other candidates it ruled out as safe), and re-run the audit loop fresh from there.

---

## Notes

[^chokepoint-scope]: `commitBounds` is defined once, in `LayoutManager.ts`, and never overridden by a subclass (`grep -rn "commitBounds(.*): void {" packages/lib/src/typescript/lib/layout/*.ts` returns exactly one match). Every call site — `placeComponent`, `commitPlacements`, and `Border.ts`'s five direct calls — funnels through it, so a single edit here reaches every generic layout manager.

[^transition-evidence]: `CollapseSupport.primeCollapse` sets `component.setTransition("left …ms …, width …ms …")` on `Split`'s panes (and `Border`'s regions) immediately before the `doLayout` pass that animates a pane collapsing — its docstring: "The caller is expected to flip its collapsed flag and call `scheduleLayout` immediately after — the next `doLayout` writes the new geometry, which the just-installed transition animates." `properties` for `Split`/`Border` is `["left", "width"]`-shaped (a move-and-resize). `Split.commitPanes` (`Split.ts:1636-1639`) places every pane through `commitBounds`, so without this guard, a trailing pane whose width is unchanged during that collapse would get its move written as `transform`, which the `left`-scoped transition does not cover — the pane would snap instead of sliding. Checking `getTransition()` — a plain cached-field read, no DOM access — is cheap enough to run on every commit.

[^getxgety-precedent]: `AbstractWindow.ts:1820-1821`: "Compositor-only translate during drag; the cached left/top stay at the start position so the field-DOM invariant holds (left === style.left throughout)." `AbstractWindow.ts:1833-1837` (`onMouseUp`): "Commit the in-progress translate back to left/top so subsequent layout passes operate from the new position." `Scrollbar.test.ts:234-239` moves the thumb via `setTranslate` and asserts `getY()` is unchanged. Both predate this plan and were not written for it — they establish the contract this plan extends to a new call site rather than one invented for this feature. The alternative (folding `_translateX`/`_translateY` into `getX()`/`getY()`'s formula globally) was considered and rejected: it would flip the `Scrollbar.test.ts` assertion from correct to failing, for no compensating benefit, since every real internal reader that needs the true position in the same reflow pass (`reserveContentFrame`) is fixed directly instead.

[^reservecontentframe-required]: Confirmed by reading `reserveContentFrame`'s own docstring (`LayoutManager.ts:248-252`): "Call AFTER the placement loop: it reads each child's committed `getX`/`getY`/`getWidth`/`getHeight`." This is the only framework-internal call site found (via `grep -rn "\.getX()\|\.getY()" packages/lib/src/typescript/`) that is guaranteed, by construction, to run inside the same `doLayout` pass as the `commitBounds` calls that placed those same children.

[^willchange-lazy]: `VirtualRowView` promotes `will-change: transform` eagerly, at pool-slot creation, because a pooled row is *known* to move on every scroll frame for its whole pool membership. A `commitBounds`-placed child is the opposite case — most such children never take the fast path in their whole lifetime (most reflows are either no-op or involve a size change), so eagerly promoting every one of them would be exactly the indiscriminate layer-bloat `Component.setWillChange`'s own JSDoc warns against. `AbstractWindow.onDrag`/`onMouseUp` promote and release around a single bounded gesture the same way this plan's fast/slow branches do.

[^opportunity-sizing]: `Accordion.placeSection` (`Accordion.ts:1479-1503`) calls `header.setX(...)`/`setY(...)`/`setWidth(...)`/`setHeight(...)` and the same for `wrapper` and `component` directly — never `commitBounds`. `Table.ts:292-296`'s own comment: "`Absolute.doLayout`'s own `commitBounds` is what normally cascades a freshly-positioned child into its own `doLayout()` … this button is instead committed via raw setters, mirroring how the header/body/footer/rows above are positioned" — confirming Table's header/body/footer/rows bypass `commitBounds` by the same pattern. Both managers already use `setTranslate`/`setWillChange`/`setTransition` internally on some of these same children for scroll-sync and animation (`Header.setScrollX`, `Accordion`'s collapse `setWillChange("height")`), which is consistent with why they need hand-written placement in the first place — a manager sophisticated enough to need per-child translate/transition control already has a reason to not go through the generic four-setter chokepoint.
