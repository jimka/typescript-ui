---
touches-shared:
  - packages/lib/src/typescript/lib/layout/Split.ts
  - packages/lib/docs/concepts/performance.md
  - packages/lib/docs/reference/changelog/next.md
  - packages/qa/README.md
---

# Split No-op Drag-Frame Gate — Implementation Plan

## Overview

A `Split` gutter drag runs one [`onDrag`](packages/lib/src/typescript/lib/layout/Split.ts#L1436) per animation frame. Every frame writes the two neighbouring panes' sizes and then lays both of them out, at [Split.ts:1464](packages/lib/src/typescript/lib/layout/Split.ts#L1464) and [:1468](packages/lib/src/typescript/lib/layout/Split.ts#L1468). When the drag is parked — the pointer held past a pane's minimum or maximum, which is what dragging a sidebar shut produces — [`resolveLhsSize`](packages/lib/src/typescript/lib/layout/Split.ts#L1511) returns the size the leading pane already has, every setter in the frame is a no-op, and both pane layouts run for a geometry nobody moved. This is G12's finding F06.3.

This plan makes each of those two layout calls conditional. A pane whose committed box this frame did not move is laid out only when `Component.canSkipUnchangedCommit()` says the pass cannot be withheld — the same question [`LayoutManager.commitBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L654) already asks about the same panes on every non-drag pass, through `Split`'s own [`commitPanes`](packages/lib/src/typescript/lib/layout/Split.ts#L2267). The change is three samples, two comparisons and one small private helper in [layout/Split.ts](packages/lib/src/typescript/lib/layout/Split.ts); no public API moves.

**This ships on the work criterion, not on the clock.** W3.0's `split.noop-drag` arm removes **85.5%** of a parked frame's counted work (2018.46 → 293.00 per unit) with geometry identical, and its Δms of +2.90 sits inside the cell's own 3.04 bracket — flat, not a win.[^measurement] The project's standing rule takes a work reduction with a flat clock unless it costs considerable code complexity, so the case rests entirely on how small the gate is. The plan must not be read as promising faster frames.

---

## Architecture Decisions

### A parked frame asks the library's own commit gate before laying a pane out

`onDrag` lays a pane out when this frame moved the pane's committed box, or when `pane.canSkipUnchangedCommit()` returns `false`. That predicate is the library's single definition of "an unchanged commit may withhold this component's pass": the class opted in through its protected `canSkipUnchangedLayout` gate, no pass is owed, no first-layout callback is queued, the text-metrics generation is current, and the component has an element ([`Component.ts:4507`](packages/lib/src/typescript/lib/core/Component.ts#L4507)).[^why-the-gate]

The precedent is [`Component.applyBounds`](packages/lib/src/typescript/lib/core/Component.ts#L4456), whose whole body is this rule — write the box, then `if (changed || !this.canSkipUnchangedCommit()) this.doLayout()` — and [`LayoutManager.commitBounds:654`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L654), which applies it to a child it just placed. `Split` already routes its non-drag pane writes through the second of those, at [`commitPanes:2267`](packages/lib/src/typescript/lib/layout/Split.ts#L2267). `onDrag` becomes the third caller of the same rule, so both of `Split`'s pane writers give a given pane the same answer.

### The ablated gate is not this gate, and the measured saving is a ceiling

W3.0's `split.noop-drag` arm skips an unmoved pane's layout **unconditionally** ([`packages/qa/src/harness/ablations.ts:411`](packages/qa/src/harness/ablations.ts#L411)). The shipped gate cannot: skipping unconditionally strands a pass the pane is owed, with a named consequence — a descendant moved size-stably during an earlier frame of the same drag left `will-change: transform` promoted and its true position in a translate, and only the pane's next pass folds that back.[^unsound]

The arm's −85.5% is therefore an **upper bound**. It reproduces on the measured cell, whose two panes are plain `Panel` instances and so opt in ([`packages/qa/src/builders/shell.ts:202`](packages/qa/src/builders/shell.ts#L202), [`:344`](packages/qa/src/builders/shell.ts#L344)). It does not reproduce for a `Split` over panes whose class did not opt in: those save nothing, exactly as they save nothing from `commitBounds` today.

### "Moved nothing" is read back from the committed box

Whether a pane moved is decided by re-reading the pane's own main-axis numbers after the frame's setters ran, never by testing whether `dragAmount` came out zero. A pane's `setWidth` clamps to its own minimum and maximum, so a requested size that equals the size the pane already holds can still commit somewhere else — the reason [`Component.writeBounds`](packages/lib/src/typescript/lib/core/Component.ts#L4555) and `commitBounds` both compare committed-before against committed-after and say so in their comments.[^read-back]

`onDrag` writes the leading pane's main-axis extent, and the trailing pane's main-axis position and extent. Nothing else. So three numbers sampled before the writes and re-read after them are the whole of what one frame can move:

| Frame | Written | Sampled before, compared after |
|---|---|---|
| horizontal | `lhs.setWidth`, `rhs.setX`, `rhs.setWidth` | `lhs.getWidth()`; `rhs.getX()`, `rhs.getWidth()` |
| vertical | `lhs.setHeight`, `rhs.setY`, `rhs.setHeight` | `lhs.getHeight()`; `rhs.getY()`, `rhs.getHeight()` |

### The stored pane sizes are still written on a parked frame

`this._sizes.set(lhs, newLhs)` and `this._sizes.set(rhs, newRhs)` stay where they are, above the layout calls, and run on every frame including a parked one. Only the two `doLayout()` calls become conditional.[^keep-sizes]

### The gate is a private helper, and `onDrag` keeps writing with setters

The two conditional layout calls move into one new private method, `Split.layoutDraggedPane(pane, moved)`, which also carries the existing collapsed-neighbour check. `onDrag` keeps its four targeted setter writes rather than being rewritten to commit through `applyBounds` or `commitBounds`.[^not-applybounds]

---

## Internal Structure

All of the code below is in [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts).

### `onDrag`'s new locals and tail

The `const` block at [:1441-1445](packages/lib/src/typescript/lib/layout/Split.ts#L1441) gains three samples, and `dragAmount` is computed from the first of them instead of re-reading:

```typescript
        const horizontal = this._orientation === "horizontal";
        const total      = this._dragOriginLhsSize + this._dragOriginRhsSize;
        const newLhs     = this.resolveLhsSize(this.pairBounds(lhs, rhs, horizontal), position);
        const newRhs     = total - newLhs;
        // Read before the writes and compared after them, the rule
        // `Component.writeBounds` and `commitBounds` share: a pane's own clamp
        // can move it somewhere other than the size it was handed. These three
        // numbers are the whole of what one frame writes.
        const wasLhsMain = horizontal ? lhs.getWidth() : lhs.getHeight();
        const wasRhsMain = horizontal ? rhs.getWidth() : rhs.getHeight();
        const wasRhsPos  = horizontal ? rhs.getX()     : rhs.getY();
        const dragAmount = newLhs - wasLhsMain;
```

The setter block and the two `_sizes.set` lines are unchanged. The tail — today's comment plus the two `_undisplayedPaneContent` blocks at [:1462-1470](packages/lib/src/typescript/lib/layout/Split.ts#L1462) — becomes:

```typescript
        const lhsMoved = (horizontal ? lhs.getWidth() : lhs.getHeight()) !== wasLhsMain;
        const rhsMoved = (horizontal ? rhs.getWidth() : rhs.getHeight()) !== wasRhsMain
                      || (horizontal ? rhs.getX()     : rhs.getY())      !== wasRhsPos;

        this.layoutDraggedPane(lhs, lhsMoved);
        this.layoutDraggedPane(rhs, rhsMoved);
```

### `Split.layoutDraggedPane`

New private method, placed immediately after `onDrag` and before `pairBounds`:

```typescript
    private layoutDraggedPane(pane: Component, moved: boolean): void {
        // A collapsed neighbour whose content is out gets its box only, as in
        // `commitPanes`: its own layout must not run while it stays collapsed.
        if (this._undisplayedPaneContent.has(pane)) {
            return;
        }

        if (moved || !pane.canSkipUnchangedCommit()) {
            pane.doLayout();
        }
    }
```

`canSkipUnchangedCommit` is `@internal`. `layoutDraggedPane` is private, so its own doc comment may `{@link}` that member; `onDrag`'s is public JSDoc and may not — see *Documentation Impact*.

### The rule on one scene

The scene is [`Split.resizeMode.test.ts`](packages/lib/tests/component/layout/Split.resizeMode.test.ts#L123)'s: a 400 × 300 host split horizontally, leading pane preferred 100 / min 60 / max 250 / weight 0, trailing pane preferred 100 / min 80 / weight 1, pressed at `clientX` 100. Boxes are `x, y, width, height`.

| Frame | Resolved leading size | Leading box | Trailing box | Moved? | Layouts run |
|---|---|---|---|---|---|
| (at rest) | — | 0, 0, 100, 300 | 104, 0, 296, 300 | — | — |
| `clientX` 400 | 250 — the leading pane's own max binds | 0, 0, 250, 300 | 254, 0, 146, 300 | yes | both panes |
| `clientX` 500 | 250 | unchanged | unchanged | no | neither, for a pane that opted in; both, for one that did not |
| `clientX` 600 | 250 | unchanged | unchanged | no | as above |
| `clientX` 200 | 200 | 0, 0, 200, 300 | 204, 0, 196, 300 | yes | both panes |

---

## Ordered Implementation Steps

Step 1's three parts are one edit, not three: `noUnusedLocals` is on for the library build ([`packages/lib/tsconfig.json:9`](packages/lib/tsconfig.json#L9)), so applying any part alone — samples nothing reads, or a private helper nothing calls — fails `npm run typecheck`.

1. **[`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) — add `layoutDraggedPane` and rewire `onDrag`, in one edit.** Three parts, exactly as *Internal Structure* shows:
   - Add the private method `layoutDraggedPane(pane, moved)` immediately after `onDrag` and before [`pairBounds`](packages/lib/src/typescript/lib/layout/Split.ts#L1484). Give it a doc comment saying: it lays a dragged pane out unless this frame left the pane's committed box where it was and the pane's own unchanged-commit gate allows the pass to be withheld; that the collapsed-neighbour early return is behaviour moved out of `onDrag`; and that the predicate is the one `{@link Component.applyBounds}` and `LayoutManager.commitBounds` apply. Document both parameters.
   - In `onDrag`'s `const` block at [:1441](packages/lib/src/typescript/lib/layout/Split.ts#L1441), insert `wasLhsMain`, `wasRhsMain` and `wasRhsPos`, keeping the block's existing `=` alignment, and rewrite `dragAmount` as `newLhs - wasLhsMain`.
   - Replace `onDrag`'s tail — today's comment plus both `if (!this._undisplayedPaneContent.has(…))` blocks at [:1462-1470](packages/lib/src/typescript/lib/layout/Split.ts#L1462) — with `lhsMoved`, `rhsMoved` and the two `layoutDraggedPane` calls.

   Leave the setter block and both `_sizes.set` lines untouched. Check: `npm run typecheck && npm run lint`.

2. **Same file — correct the two public `@remarks` that describe the old behaviour.** In `onDrag`'s ([:1418-1435](packages/lib/src/typescript/lib/layout/Split.ts#L1418)), add one paragraph: a frame whose clamp leaves a pane at the box it already holds does not lay that pane out again, when the pane's class opted into the unchanged-geometry layout skip and the pane owes no pass; the stored sizes are still written on every frame. In `scheduleDrag`'s ([:1547-1552](packages/lib/src/typescript/lib/layout/Split.ts#L1547)), qualify the sentence "`onDrag` is not cheap: it triggers a real `doLayout()` of both adjacent panes on every call" — on every call that moves them. Describe the predicate in prose in both — **do not** write `{@link Component.canSkipUnchangedCommit}` in either, because that member is `@internal` and the docs build warns on a link from public JSDoc to an excluded symbol. Check: `npm run docs:api` finishes with zero warnings.

3. **Create [`packages/lib/tests/component/layout/Split.dragFrameGate.test.ts`](packages/lib/tests/component/layout/Split.dragFrameGate.test.ts).** Cover cases D1–D8 from *Expected Behaviour*. Copy the harness wholesale from [`Split.resizeMode.test.ts:1-175`](packages/lib/tests/component/layout/Split.resizeMode.test.ts#L1) — the `installTestDOM` config, the `requestAnimationFrame` capture, the `afterEach` teardown, `scene()` and `drive()` — and change `scene()` to take the pane class as a parameter. Build the opted-in pane as a local subclass overriding the protected gate, the way [`UnchangedCommitSkip.test.ts:158`](packages/lib/tests/core/UnchangedCommitSkip.test.ts#L158)'s `SkippableContainer` does. Check: `npm test`.

4. **[`packages/qa/tests/ablations.test.ts`](packages/qa/tests/ablations.test.ts) — keep A3 and A3b measuring the arms.** Both cases assert that a parked `onDrag` raises their counter by exactly 2 ([:288](packages/qa/tests/ablations.test.ts#L288), [:310](packages/qa/tests/ablations.test.ts#L310), [:333](packages/qa/tests/ablations.test.ts#L333)); with the shipped gate in place `onDrag` may no longer call `doLayout` at all, so the arms' stand-ins would never run and all three assertions would read 0. Add a helper beside `splitFixture` that calls `invalidateLayout()` on both panes, and call it in each of A3's one case and A3b's two, after `splitFixture()` and before the arm is applied. Document it as: the arms bound the work the fork-point build did, so the fixture must owe both panes a pass rather than letting the shipped gate withhold it. Check: `npm -w packages/qa run test`.

5. **[`packages/qa/src/harness/ablations.ts`](packages/qa/src/harness/ablations.ts#L384) — correct `splitDragGate`'s doc block.** Its second paragraph calls the skip "F06.3's proposed fix". Replace that clause with: the shipped fix asks each pane's unchanged-commit gate, which this arm does not, so the arm bounds the fix from above. Change nothing executable, and do not touch `splitRecalcGate`. Check: `npm -w packages/qa run test`.

6. **[`packages/qa/README.md`](packages/qa/README.md#L488) — one clause on the `split.noop-drag` row.** Append that the library now ships a gated form of this skip, so the arm reads its full population only against a build from before it. Leave the `split.noop-control` row alone.

7. **Documentation.** Edits 1–3 in *Documentation Impact*, in that order; edit 4 was step 6. Check: `npm run docs:llms:check`.

8. **Full gate.** `npm test && npm -w packages/qa run test && npm run lint && npm run build:lib && npm run docs:api`. Then `grep -n '\.doLayout();' packages/lib/src/typescript/lib/layout/Split.ts` — expect exactly two matches: `reconcileCollapsedContent`'s at [:694](packages/lib/src/typescript/lib/layout/Split.ts#L694) and `layoutDraggedPane`'s. The two bare calls in `onDrag` must be gone.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` — **shared** with `directional-panel-navigation` |
| Create | `packages/lib/tests/component/layout/Split.dragFrameGate.test.ts` |
| Modify | `packages/qa/tests/ablations.test.ts` |
| Modify | `packages/qa/src/harness/ablations.ts` — doc comment only |
| Modify | `packages/lib/docs/layouts/Split.md` |
| Modify | `packages/lib/docs/concepts/performance.md` — **shared** with `table-column-resize-outline-mode` |
| Modify | `packages/lib/docs/reference/changelog/next.md` — **shared** with every plan landing in this release |
| Modify | `packages/qa/README.md` — **shared** with `table-column-resize-outline-mode` and `table-cell-date-formatter-memo` |

`plans/table-column-resize-outline-mode.md` makes `Table` the fourth owner of the `ResizeMode` seam. It **cites** `layout/Split.ts` and `core/ResizeDrag.ts` as the pattern it mirrors but modifies neither, so the two plans share no source file and can land in either order. Their shared files are `packages/lib/docs/concepts/performance.md`, `packages/lib/docs/reference/changelog/next.md` and `packages/qa/README.md`, each edited in a different section.

`plans/directional-panel-navigation.md` does edit `layout/Split.ts`, adding `PanelNavigator` members and a `_lastFocus` clear in `detach`. It touches neither `onDrag` nor `commitPanes`, so the two edits do not overlap, but whichever lands second rebases over the other.

---

## Expected Behaviour

D1–D8 are unit-testable in `Split.dragFrameGate.test.ts`. D9 needs a real pointer drag and D10 an engine measurement, so both are manual.

**D1. A frame that moves a pane lays it out, whatever the pane's class.** On the scene in *Internal Structure*, `clientX` 400 lays both panes out, with both an opted-in pane class and a plain `Component`. Boxes land at `0,0,250,300` and `254,0,146,300`.

**D2. A parked frame lays out neither opted-in pane.** Driving `[400, 500, 600]`, each pane's `doLayout` is called exactly once — on the first frame. The boxes after all three frames are the ones D1 gives, and `getPaneSize(lhs)` is 250.

**D3. A parked frame still lays out a pane that did not opt in.** The same drive over plain `Component` panes — the class the copied scene already uses, which leaves `canSkipUnchangedLayout` at its `false` default — lays both panes out three times. This is today's behaviour, unchanged.

**D4. The stored sizes are written on a parked frame.** After `[400, 500, 600]`, `getPaneSizes()` reports the leading pane at `{ unit: 'px', value: 250 }`, and releasing the gutter fires `paneresize` once with those sizes.

**D5. A pane owed a pass is laid out on the next parked frame, then stops.** Driving `[400, 500]`, then calling `lhs.invalidateLayout()`, then `[500]` again: the leading pane lays out on that third frame and the trailing pane does not. A fourth frame at 500 lays out neither.

**D6. A descendant's `markPassOwedAbove()` reaches the pane the same way.** As D5, over a scene whose leading pane holds one child, and with `child.markPassOwedAbove()` in place of `lhs.invalidateLayout()`. Same outcome. This is the condition that makes the shipped gate differ from the arm, so it is the case that must not be dropped.

**D7. A stale text-metrics generation is laid out.** As D5, with `ThemeManager.setTheme(ThemeManager.getTheme())` in place of `invalidateLayout()` — the bump [`UnchangedCommitMetricsGate.test.ts:189`](packages/lib/tests/core/UnchangedCommitMetricsGate.test.ts#L189) already uses for the same gate. Both panes lay out on the next parked frame, and neither on the one after.

**D8. A collapsed neighbour is unchanged.** With the leading pane collapsed and its content undisplayed, no frame lays it out — moving or parked — and the trailing pane behaves as D1–D3 say. Reuse [`Split.collapseUndisplay.test.ts`](packages/lib/tests/component/layout/Split.collapseUndisplay.test.ts)'s collapse setup.

**D9. Manual — a real parked drag.** Drag a `Split` gutter past a pane's minimum, hold, wiggle, then reverse. The gutter stays under the cursor, the panes' content does not change while parked, and the reversal starts moving at the boundary coordinate, not after a dead zone. Nothing visually settles or flickers on the first parked frame.

**D10. Manual — the engine cell.** The cell in *Verification*.

---

## Verification

### Offline

From the repository root, in this order:

```sh
npm run typecheck
npm test
npm -w packages/qa run test
npm run lint
npm run build:lib
npm run docs:api          # must finish with zero warnings
npm run docs:llms:check
```

`npm test` must be run from the repository root, not with a bare `--root`: one library test depends on the working directory.

Grep checks:

- `grep -n '\.doLayout();' packages/lib/src/typescript/lib/layout/Split.ts` — two matches, as step 8 lists.
- `grep -n 'canSkipUnchangedCommit(' packages/lib/src/typescript/lib/layout/Split.ts` — one match: the call inside `layoutDraggedPane`.

### The engine cell

**Do not run this as part of implementing the plan.** Every run opens a full-screen window on the desktop and needs the user's explicit go-ahead.

The cell is `panel=shell-deep&drive=park`, the shape recorded as `w7b-sdp-*`, which works: the `park` driver proves the sidebar gutter has parked *before* the measured units, doubling its lead until the rectangle holds ([`packages/qa/src/harness/drivers.ts:816`](packages/qa/src/harness/drivers.ts#L816)), and a page-level guard drops trusted device input from a measured run and tallies it into the report. That guard matters here: it logged live mouse interference it absorbed during two scored runs of this very cell, and an earlier uncaught instance of the same interference is what produced a phantom park reading.[^guard]

This is a **library A/B**, not an ablation cell: `wt` is a build of the commit this branch forked from, `main` is this branch's `packages/lib`. Build the base arm with the README recipe ([`packages/qa/README.md:95`](packages/qa/README.md#L95)).

```sh
P='panel=shell-deep&drive=park'
FLAGS='work=1&seam=1&geom=1'

packages/qa/runqa.sh w8a-warm-sdp-0 wt   "$P&$FLAGS"      # discarded
packages/qa/runqa.sh w8a-sdp-wt-a   wt   "$P&$FLAGS"
packages/qa/runqa.sh w8a-sdp-main-1 main "$P&$FLAGS"
packages/qa/runqa.sh w8a-sdp-wt-b   wt   "$P&$FLAGS"
packages/qa/runqa.sh w8a-sdp-main-2 main "$P&$FLAGS"
packages/qa/runqa.sh w8a-sdp-wt-c   wt   "$P&$FLAGS"

# Counters only, to prove the shipped gate covers the arm's whole population.
packages/qa/runqa.sh w8a-sdp-main-split.noop-drag    main "$P&$FLAGS&abl=split.noop-drag"
packages/qa/runqa.sh w8a-sdp-main-split.noop-control main "$P&$FLAGS&abl=split.noop-control"

python3 packages/qa/bin/qa-table.py packages/qa/results w8a-sdp- --work
```

**bracket** is the largest `wt` average minus the smallest; **Δms** is the mean of the two `main` averages minus the mean of the three `wt` averages.

| Reading | Expected |
|---|---|
| `geom` | `=` on every run; every run exits 0, so the driver's parked-rectangle proof held |
| Engagement | `sidebar.doLayout` and `main.doLayout` fall from about 0.99 to about 0 per unit on `main` |
| `work` | about 2018 → 293 per unit, −85.5% |
| Δms | inside the bracket — flat |
| `abl=split.noop-drag` on `main` | `skipped.split.noop-drag.paneLayout` about 0, against 2.00 on `wt` |
| `abl=split.noop-control` on `main` | `dose.split.noop-control.wouldSkip` about 0, against 2.00 on `wt` |

Verdicts:

| Reading | What it means |
|---|---|
| `work win`, `geom =`, Δms inside the bracket | keep the change, on the work criterion |
| `work` flat, or a reduction much smaller than 85.5% | a pane did not opt in, or stayed owed a pass on every frame — investigate before keeping |
| Δms above `+bracket` | the gate costs time in the frame it exists to make cheap — revert |
| `geom` `DIFF` or a run that exits 1 | no verdict; the cell failed |

Two rules for reading it:

- **A flat Δms is the expected result, and is not a failure.** The recorded plain mean on this cell is 8.84 ms against a 3.04 bracket, so the cell cannot resolve the fraction of a millisecond two withheld pane passes are worth. Nothing in this plan may be reported as a render-time improvement.
- **Never read an `abl=` arm's Δms against plain on this cell.** A park cell charges roughly 4 ms to any runtime patch on this path: `split.noop-control`, which removes no work at all, read **+4.27 ms** there. An arm's milliseconds are meaningful only against `split.noop-control`, never against plain — which is why the two `abl=` runs above are read for counters and nothing else.

---

## Documentation Impact

No public API changes, so no catalog or sidebar entry moves. Four doc edits, following [`split-collapse-static-participants`](plans/implemented/split-collapse-static-participants.md)'s doc set for the sibling gate on the same class:

1. **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md#L408), `## Changed` → `### Layouts`.** One entry, placed after the existing *A `Split` pane or `Border` region whose box does not move during a collapse or expand…* bullet it sits beside: a gutter drag frame whose clamp leaves a pane at the box it already holds no longer lays that pane out, for a pane whose class opted into the unchanged-commit skip; the stored sizes are still written every frame; and a custom pane that relied on a `doLayout` call per drag frame to pick up a change it never announced must call `scheduleLayout()` itself. Not a breaking change — the collapse gate's entry sets that precedent.

2. **[`packages/lib/docs/layouts/Split.md`](packages/lib/docs/layouts/Split.md#L190).** In the resize-mode paragraph, qualify "lays both neighbouring panes out on every frame": a frame that cannot move either pane, because the drag is parked against a clamp, lays out neither.

3. **[`packages/lib/docs/concepts/performance.md`](packages/lib/docs/concepts/performance.md#L44), `## Outline resizing`.** One sentence after the paragraph that prices a live drag: a live drag already costs nothing on a frame parked against a clamp, which is a common gesture, but every frame that does move the gutter pays in full — which is what outline mode is for.

4. **[`packages/qa/README.md`](packages/qa/README.md#L488).** The clause from step 6.

The two `@remarks` edits in step 2 are public JSDoc, so per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) each describes the predicate in prose rather than linking `canSkipUnchangedCommit`, which is `@internal` and excluded from the docs build.

---

## Potential Challenges

- **A3 and A3b in `packages/qa/tests/ablations.test.ts` fail without step 4.** Both assert a parked `onDrag` raises their counter by exactly 2, which the shipped gate can reduce to 0 by never calling `doLayout`. Step 4 makes the fixture owe both panes a pass so the arms still intercept a real call.
- **The first parked frame of a real drag may still lay out.** A moving frame can leave a pane owed a pass, because a descendant that only moved marked every opted-in ancestor through `markPassOwedAbove`. That frame is the settling pass that folds the descendant's translate back; frames after it skip. One settling pass in the park's 150 measured units rounds away in the cell's per-unit figures, and D6 pins the behaviour offline.
- **`getX()` and `getWidth()` can report the "never assigned" `NaN` sentinel.** `NaN !== NaN`, so a pane no layout has placed always reads as moved and is always laid out. That is the conservative direction and needs no special case — the same reasoning `split-collapse-static-participants`' exact `sameRect` rests on.
- **A leftover translate is not compared, and must not be.** `onDrag` never writes a pane's translate, so it cannot change across a frame; adding `getTranslateX()` to the comparison would compare a constant. `onDrag`'s pre-existing habit of writing a real `left` without folding a leftover translate back is untouched and out of scope.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts) — `onDrag` ([:1436](packages/lib/src/typescript/lib/layout/Split.ts#L1436)), `resolveLhsSize` ([:1511](packages/lib/src/typescript/lib/layout/Split.ts#L1511)), `pairBounds` ([:1484](packages/lib/src/typescript/lib/layout/Split.ts#L1484)), `onDragEnd` ([:1577](packages/lib/src/typescript/lib/layout/Split.ts#L1577)), `commitPanes` and its `commitBounds` call ([:2262](packages/lib/src/typescript/lib/layout/Split.ts#L2262), [:2267](packages/lib/src/typescript/lib/layout/Split.ts#L2267)), and `_undisplayedPaneContent` ([:268](packages/lib/src/typescript/lib/layout/Split.ts#L268)).
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — **the precedent**: `applyBounds` ([:4456](packages/lib/src/typescript/lib/core/Component.ts#L4456)), `canSkipUnchangedLayout` ([:4479](packages/lib/src/typescript/lib/core/Component.ts#L4479)), `canSkipUnchangedCommit` ([:4507](packages/lib/src/typescript/lib/core/Component.ts#L4507)), `markPassOwedAbove` ([:4531](packages/lib/src/typescript/lib/core/Component.ts#L4531)), `writeBounds` ([:4555](packages/lib/src/typescript/lib/core/Component.ts#L4555)), `invalidateLayout` ([:8092](packages/lib/src/typescript/lib/core/Component.ts#L8092)) and `doLayout`'s dirty-flag clear ([:7951](packages/lib/src/typescript/lib/core/Component.ts#L7951)).
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts) — `commitBounds` ([:601](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L601)), its contract comment, its translate fast path and the gate at [:654](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L654).
- [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts#L610) — why a plain `Panel` opts in and a subclass does not, and the writer audit that grants it.
- [`packages/lib/src/typescript/lib/layout/Accordion.ts`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1841) — the sibling drag path's extent gate, and its `reflowAll: false` drag call site ([:2148](packages/lib/src/typescript/lib/layout/Accordion.ts#L2148)).
- [`packages/lib/tests/component/layout/Split.resizeMode.test.ts`](packages/lib/tests/component/layout/Split.resizeMode.test.ts#L1) — the drag harness and scene the new test file copies.
- [`packages/lib/tests/core/UnchangedCommitSkip.test.ts`](packages/lib/tests/core/UnchangedCommitSkip.test.ts#L158) — how a test builds an opted-in component.
- [`packages/qa/src/harness/ablations.ts`](packages/qa/src/harness/ablations.ts#L384) — `splitDragGate` and `gateUnmovedLayout`: what the arm actually did.
- [`plans/implemented/split-collapse-static-participants.md`](plans/implemented/split-collapse-static-participants.md) — the same class's shipped skip, and the model for this plan's doc set and read-back rule.
- [`plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`](plans/research/render-review-2026-09-15/00-post-campaign-agenda.md) — *Judged again* for the standing rule, and *The two repaired cells answer* for F06.3's numbers.

---

## Non-Goals

- **G12's F06.4, the `recalculateSizes` signature gate, stays a separate candidate.** Its ablation `split.recalc-gate` laid the page out differently when applied, so it owes a correctness answer before any number about it means anything. Nothing here touches `recalculateSizes`, `splitRecalcGate` or harness case A4, and no verdict about F06.4 follows from this plan's cell even though both candidates were measured on it.
- **Accordion's equivalent gate is not changed.** [`Accordion.layoutSections:1841`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1841) skips an unchanged-height section's layout during a gutter drag without asking that section's unchanged-commit gate, so it carries the same hole this plan closes in `Split`. Fixing it is a second change on a second file with its own measurement, and belongs in its own plan.[^accordion]
- **`onDrag` is not rewritten to commit through `commitBounds`.** That would change the drag's batching, its translate handling and the order its gutter write lands in, for no work saved beyond this gate.
- **F06.11's allocation churn in `onDrag` is untouched.** `container.getLaidOutComponents()` is still called twice per frame and `this._gutters.indexOf(gutter)` still runs; this plan removes no allocation.
- **No pane class is opted into the unchanged-commit skip.** Extending the opt-in list is G09's staged work and needs a per-class writer audit. This plan takes the list exactly as it stands.
- **No new ablation arm.** `split.noop-drag` and `split.noop-control` already exist and already bounded this candidate; a third arm duplicating the shipped gate would only drift from it.

---

## Notes

[^measurement]: The numbers, from *The two repaired cells answer, and both change a verdict (2026-09-26)* in `plans/research/render-review-2026-09-15/00-post-campaign-agenda.md`. Fourteen runs on `master` at `423b3a7c`, cell `panel=shell-deep&drive=park`: plain mean 8.84 (7.26, 8.97, 10.30) for a 3.04 bracket; `split.noop-drag` +2.90 ms, inside it, removing 85.5% of the work (2018.46 → 293.00 per unit) with geometry `=`; `split.noop-control`, patched from the same helper and removing no work, **+4.27 ms** — more than the arm that removes the work. W3.0's earlier `sdp` reading of **+3.28 ms** was therefore the cell's own bookkeeping, and its `regress` verdict is retired. Net of the tax the candidate reads about −1.4 ms, but the agenda records that as a direction and not a figure: the plain bracket is wide and subtracting one arm's delta from another's compounds both arms' noise. Nothing in this plan rests on it.

[^why-the-gate]: Why the predicate and not a bare "the box did not move" test. `onDrag`'s `doLayout()` is the *only* pass either pane gets for the length of a live drag — `Split.doLayout` does not run per frame, and `onDragEnd` flushes the freshest move back through `onDrag` rather than laying the container out. So withholding it withholds a pass the pane may be owed for a reason that has nothing to do with the gutter: `invalidateLayout()` marks a pane stale without scheduling anything at all and is documented as relying on the next pass not being withheld (`Component.ts:8092`); a queued `onFirstLayout` drain waits for a connected pass; a theme switch or web-font load moves the text-metrics generation without moving any rectangle. `canSkipUnchangedCommit()` is the one predicate that already answers all of those together, and its own doc says it is public precisely so callers other than `applyBounds` can ask it about arbitrary instances. Consulting it also keeps `Split`'s two pane writers consistent: a pane that `commitPanes` must re-lay-out at an unchanged box on a normal pass is not silently exempted from that on a drag frame.

[^unsound]: The concrete failure of an unconditional skip. `LayoutManager.commitBounds` writes a size-stable move as a compositor `transform` rather than `left`/`top`, promotes the moved child with `will-change: transform`, and calls `markPassOwedAbove()` so that "the redundant pass that folds this translate back and releases the promotion is not withheld" (`LayoutManager.ts:624-630`). That mark sets `_layoutDirty` on every ancestor that opted into the skip — including the `Split` pane. A drag frame that moves the gutter can therefore leave the pane owed exactly one fold-back pass. An unconditional skip on the next frame, which is parked, never runs it: the moved descendant keeps `will-change: transform` and a live translate, and `getX()` keeps reporting its pre-move value while the translate carries the real position, until some unrelated layout pass happens along. The drag's own release cannot clear it, because `onDragEnd` flushes through `onDrag` and that final frame is parked too. Asking `canSkipUnchangedCommit()` closes this: the pane reads dirty, the fold-back runs, and every frame after it skips. W3.0 built the arm to bound the work, and it bounded it; it was never a candidate fix.

[^read-back]: Why not `dragAmount === 0`. F06.3's own finding proposed that test, and it is very nearly right: `dragAmount` is the requested leading size minus the size the pane currently holds, so zero means the frame asked for the box the pane already has. But `Component.setWidth` clamps its argument to the pane's own minimum and maximum before comparing, and those bounds can have changed since the pane was last written — a pane whose `minSize` grew mid-drag commits somewhere new on a request that looks like a no-op. Reading the committed numbers back after the setters ran costs five extra reads of cached fields and removes the question. It is also the rule both `Component.writeBounds` and `LayoutManager.commitBounds` state in their comments, each warning in as many words against comparing the request instead, and the rule `split-collapse-static-participants` adopted for the same class's collapse gate.

[^keep-sizes]: `_sizes` is the split's stored per-pane size, which the next `doLayout` reads to preserve the user's ratio. A frame at offset zero writes the rendered size back into it, so an early return above those two lines would skip that sync. W3.0's arm keeps them for the same reason, and its own spec records it as the one behaviour the skip must not touch.

[^not-applybounds]: `onDrag` could instead write each pane through `Component.applyBounds` or `LayoutManager.commitBounds` and inherit the gate with no new code. Rejected: both take a whole rectangle, so `onDrag` would have to read and re-write the cross-axis numbers it deliberately leaves alone; both open and close a style-batching window per pane, where `onDrag` batches nothing today; `commitBounds` would additionally fold back any leftover translate and rewrite `will-change`, changing how a dragged pane moves; and the collapsed-neighbour case would still need its own branch, because neither entry point knows about `_undisplayedPaneContent`. That is a rewrite of a method with a documented, deliberate write shape, against a plan whose entire case is that the gate is cheap in code.

[^guard]: From *The two repaired cells answer* and *The sitting* in the post-campaign agenda. Three of nine `sdp` runs in the earlier sitting were spoiled by a trusted `mousemove` at the physical cursor reaching the driver's live drag: two returned error results and a third passed the end-of-phase check while carrying six distinct sidebar rectangles, its width sweeping 4520 → 4675 px across five units at a `maxMs` of 88 against plain means near 8.7. Both repairs landed with `qa-cell-determinism`, and the repaired sitting confirms them on real data — the guard reports 22 device-input types dropped on every run and names the interference it absorbed during two scored runs of this cell.

[^accordion]: `Accordion`'s drag path calls `layoutSections` with `reflowAll: false` (`Accordion.ts:2148`), which withholds a section's `doLayout()` whenever `contentHeight === oldHeight`, asking nothing about that section's own dirty or metrics state. A section owed a fold-back pass loses it for the length of a parked accordion-gutter drag, the same way an ungated `Split` pane would. F06.10 already records that the two managers mirror each other's drag mechanics, and this is one more instance. It is left alone here deliberately: this plan's measured surface is the `Split` park cell, and no cell in the campaign parks an `Accordion` gutter, so a change there would ship unmeasured.

---

## Implementation Notes

Implemented as designed: three samples in `onDrag`'s `const` block, two
read-back comparisons, one private `Split.layoutDraggedPane(pane, moved)` holding
the collapsed-neighbour early return and the `canSkipUnchangedCommit()` gate. No
public API moved. `grep -n '\.doLayout();' layout/Split.ts` gives the two matches
step 8 lists, and `canSkipUnchangedCommit(` gives one.

### The test set is larger than D1-D8, because D1-D8 did not pin the gate

`Split.dragFrameGate.test.ts` carries fourteen cases, not eight. Fourteen
mutations of the shipped gate were applied one at a time and the suite re-run
against each; every one kills at least one case. With only the prescribed D1-D8 in
place, **eight of the fourteen stayed green** — the prescribed set could not tell
the implementation from:

- `rhsMoved` with its position term deleted;
- `rhsMoved` with its extent term deleted;
- the two panes' verdicts swapped, so each pane is gated on the other's;
- `lhsMoved` computed as `dragAmount !== 0` instead of from the read-back;
- any of the **four orientation ternaries** collapsed onto the x axis —
  `wasLhsMain`, `wasRhsMain`, `wasRhsPos` or `lhsMoved` reading `getWidth()` /
  `getX()` unconditionally.

Four cases close them. **D2b** and **D2c** drive the state in which the *trailing*
pane's two terms come apart: `onDrag` captures the pair's combined size once, at
the press, so a container resize under a live drag leaves that capture larger than
the two panes now hold. D2b then drives a frame back to the press coordinate,
where the leading pane is asked for the width it already has and nothing moves it,
while the stale capture still widens the trailing pane: extent term only. D2c
drives the one travel for which the stale capture asks the trailing pane for the
width it already holds, so only the gutter's travel moves it: position term only.
The swap dies on D2b.

**That stale capture is a pre-existing `onDrag` defect, not a legitimate state**,
and neither case asserts the geometry it produces. Because the trailing pane's
requested size is `total − newLhs`, both frames commit it wider than the shrunken
host and overflow it. D2b and D2c therefore assert only the pass counts — this
gate's contract — and the leading pane's box, with the overflow named in a comment
as out of scope, exactly as D2d does for its sibling instance of the same capture
defect. Asserting the overflowing boxes would have pinned a bug as expected
output. Both instances are recorded in the agenda as their own candidate.

**D6b** is the case the plan's own `[^unsound]` argues for but does not
prescribe, and the one a counter cannot express. An opted-in pane whose manager
commits one child against its trailing edge takes `LayoutManager.commitBounds`'
size-stable-move fast path on the first moving frame. D6b asserts, on the *next
and parked* frame, that `child.getTranslateX()` is back to `0`, that
`getWillChange()` is `null`, and that the child's committed box carries the real
position — and that the frame after that skips. Dropping the gate turns it red.
The soundness claim is pinned by its consequence, not by a call count.

**D2d** closes the fourth, and it exists because the first version of these notes
got the mechanism wrong; the audit caught it. This file previously claimed the
leading pane's read-back was provably equal to `dragAmount !== 0` and that the
plan's `[^read-back]` described a case that could not happen. Both claims were
false, for a reason neither the plan nor the first reading of it named:
`resolveLhsSize` clamps as `Math.max(loLhs, Math.min(hiLhs, …))`
(`layout/Split.ts:1561`), so when the bracket **inverts** — `loLhs`, which is
`total − maxRhs`, passing `hiLhs`, which is `min(maxLhs, total − minRhs)` — the low
bound wins and the returned size can sit past the leading pane's own maximum.
Dropping the trailing pane's ceiling mid-drag does exactly that: on the scene's
parked 250, a trailing max of 100 makes `loLhs` 296, the leading pane is handed
296, its own `setWidth` clamps it back to 250, and `dragAmount` is 46 while the
pane moved nowhere. D2d drives that and the read-back skips it correctly, where
`dragAmount !== 0` would not. The `[^read-back]` rationale stands; it simply
names a different trigger (a grown `minSize`) than the reachable one (an inverted
bracket).

Two smaller claims in that first version were wrong too, and are worth recording
so they are not repeated: `pairBounds` does **not** read the panes' live sizes
directly — it goes through `paneMinSize` / `paneMaxSize`, which return the collapse
snapshot for an undisplayed pane (`layout/Split.ts:753-772`); and
`Component.clampWidth` does not apply the merged min/max for every pane — a
`Container` or `Panel` clamps only to its explicit constraints
(`core/Component.ts:4734-4750`). So `pairBounds` and the pane's own clamp have two
independent reasons to disagree, not zero.

**Dv1** and **Dv2** close the last four. Every case D1-D8 prescribes is
horizontal, and `onDrag` samples its three numbers through an orientation
ternary, so the whole `getHeight()` / `getY()` arm of the gate was unexercised:
collapsing any of those ternaries onto the x axis left the other twelve cases —
and the whole library suite — green while a vertical `Split` over opted-in panes
stopped laying its panes out on a gutter move at all. Dv1 and Dv2 repeat D1 and
D2 on a 300x400 vertical split whose main-axis figures are chosen to match the
horizontal scene's exactly, so the two pairs read against each other. This gap was
found by the audit, not by the prescribed set.

### D6's prescribed expectation was wrong, and needed splitting in two

The plan's D6 reuses "a scene whose leading pane holds one child" and expects the
same counts as D5 — one pass per pane after driving `[400, 500]`. It cannot be:
once the pane's manager really places that child, the moving frame can leave the
pane owed the fold-back pass, which the parked frame then runs, giving `[2, 1]`.
The plan predicts this in *Potential Challenges* ("The first parked frame of a
real drag may still lay out") without carrying it into D6. Rather than assert the
compound number, the two mechanisms were separated: D6 uses a `PinnedChild`
manager that commits the child at the pane's origin, so no frame moves it and
`markPassOwedAbove()` is isolated, and D6b uses `TrailingEdge` for the fold-back.

One pre-existing defect surfaced while proving D2d, and is left alone: on the
inverted-bracket frame `onDrag` moves the gutter and the trailing pane by the
*unclamped* `dragAmount` while the leading pane's own clamp holds it back, so the
gutter ends up detached from the pane edge it divides (gutter x 293 against a
leading pane ending at 250). It predates this branch — `dragAmount` was computed
and used the same way before it — and this gate neither causes nor fixes it. D2d
therefore asserts only the leading pane's box, with a comment saying why, rather
than locking the wrong geometry in. The agenda entry records it as its own
candidate.

### One instruction had to be weighed against another — flagged for the user

The dispatch for this phase said **do not touch `packages/qa/tests/`**, scoped to
five inherited failures (A11's three cases, A12, P16) that this worker was told
not to fix. The plan's step 4 requires an additive fixture change in
`packages/qa/tests/ablations.test.ts`: the shipped gate withholds the pane passes
that A3's and A3b's `doLayout` stand-ins intercept, so without it this branch adds
**three new failures** (A3, and A3b's two cases) — which the other half of the
same instruction, *no new failures beyond those five*, forbids. Step 4 was
implemented, as narrowly as possible: one `owePaneLayouts(fixture)` helper beside
`splitFixture` calling `invalidateLayout()` on both panes, and one call in each of
the three cases. It touches none of the five inherited cases and makes none of
them pass. `npm -w packages/qa run test` reads **448 passed / 5 failed both
before and after**, with the same five titles. The user may still prefer this hunk
to move to whichever branch settles the five.

### Smaller notes

- **`npm run docs:api` finishes with 14 warnings, not the zero step 2 asks for.**
  All 14 pre-date this branch and none names `Split` or a symbol this change
  touches; the bar applied was no new warnings. Neither `@remarks` edit links
  `canSkipUnchangedCommit`, as the plan requires — both describe the predicate in
  prose.
- **`plans/in-progress/` did not exist** in this worktree, so the plan's move
  needed the directory created before `git mv`.
- **Line numbers drifted, no API did.** `Component.canSkipUnchangedCommit` is at
  `:4540` (plan: 4507) and `Panel.canSkipUnchangedLayout` at `:622` (plan: 610);
  phase 6's `protected isLayoutSettled()` sits between them and
  `canSkipUnchangedCommit` now delegates to it, which changes nothing this plan
  relies on. Phase 7's eleven opt-ins are all form-control internals and reach no
  `Split` pane.
- **Baselines measured on the start point before any edit:** library `npm test`
  8685 passed / 517 files; `npm -w packages/qa run test` 448 passed, 5 failed. The
  library suite now reads 8699 passed / 518 files, all green.

### Manual verification still owed

Neither manual case was run: both open a window on the user's desktop, which this
run was forbidden from doing.

- **D9 — a real parked drag.** In the demo or Loom, drag a `Split` gutter past a
  pane's minimum, hold, wiggle the pointer, then reverse. Expect: the gutter stays
  glued to the cursor; the panes' content does not change or flicker while parked,
  including on the first parked frame; and the reversal starts moving at the
  boundary coordinate with no dead zone. A pane whose content visibly settles one
  frame *into* the park is the fold-back D6b pins, and is correct.
- **D10 — the engine cell.** The `wt`/`main` library A/B on
  `panel=shell-deep&drive=park` exactly as *Verification → The engine cell*
  specifies, read against `split.noop-control` and never against plain. Expect
  `geom =` on every run, `work` about 2018 → 293 per unit, and Δms inside the
  cell's own bracket. Nothing here may be reported as a render-time win.
