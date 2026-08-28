---
touches-shared:
  - packages/lib/src/typescript/lib/component/diagram/DiagramView.ts
  - packages/lib/src/typescript/lib/component/diagram/DiagramResidency.ts
  - packages/lib/tests/component/diagram/DiagramView.test.ts
  - packages/lib/tests/component/diagram/DiagramResidency.test.ts
  - packages/lib/docs/components/DiagramView.md
  - packages/lib/docs/reference/changelog/next.md
---

# Diagram Re-Centre on Rescale — Implementation Plan

## Overview

[`DiagramView`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) centres its graph once. The flag that owes the centring, [`_needsInitialCentre:395`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L395), is cleared by the first layout that manages to centre and is never re-armed by [`setData:574`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L574). That is deliberate: it is what keeps a live data refresh from yanking a pan the user has dragged to. It has no floor, though — when the replacement graph is laid out in a coordinate space far larger than the one the view is panned into, the preserved pan and zoom point at a region of the new graph that holds no node, and the view renders an empty canvas.

The symptom was reproduced live in sqladmin's database-diagram panel: switching the Mode dropdown from Overview (a ~7-node schema graph) to Tables (the full 325-table graph) leaves the canvas blank — zero node components mounted, zero edges drawn — until the built-in Fit-to-view button is clicked.[^observed] The ELK layout itself completes correctly; only the viewport is wrong.

This plan adds a floor under that preservation, and nothing else. After a completed layout, if no node box of the newly promoted graph overlaps the visible viewport, `DiagramView` re-arms the one-shot centring and runs it, putting the view exactly where a freshly constructed view would have put it. When any part of the new graph is on screen the pan is preserved, unchanged from today. No exported symbol changes; one consumer-visible behaviour changes, and it only replaces a blank canvas.[^behaviour-change] The app-side half of the fix — sqladmin's Mode toggle never calling its own re-anchor helper — is real but lives in a separate repository and is described here rather than planned here (see `## Non-Goals`).

---

## Architecture Decisions

### The library keeps preserving the pan and gains a floor under it

`setData` still leaves pan and zoom alone. The change is one guard on the layout path: a view that would otherwise show none of the graph it just laid out re-runs its initial centring instead.[^floor-not-policy]

This mirrors [`VirtualScroller.clampToContent:380`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L380), called at the top of every render pass by [`table/Body.ts:1261`](packages/lib/src/typescript/lib/component/table/Body.ts#L1261) and [`tree/Tree.ts:1348`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1348). A `Table` keeps the user's scroll offset across a store reload, and repairs it only when the new content is too short for it — the offset is preserved by default and corrected only when the content change would leave the view pointing at nothing. The diagram's one structural deviation: it cannot clamp, because its pan is unbounded on purpose (dragging a graph into empty space is a documented feature), so it re-centres rather than pulling the pan back to a bound.

### The trigger is "no node is on screen", not a scale ratio

The floor fires when **no node box of the new graph overlaps the visible viewport rectangle**. Not a change in graph bounds, not a ratio between the old and new extents.[^why-not-ratio] The graph's own bounding box is not the test either: a compound graph's box is mostly whitespace, so a viewport parked inside an empty region of it would pass a bounds test while showing nothing.[^why-not-bounds]

Worked cases, all at zoom 1 in the test suite's 1280 × 800 viewport. "Viewport in graph coords" is what [`viewportGraphRect:967`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L967) returns.

| Situation | Viewport in graph coords | New graph's node boxes | Re-centres? |
|---|---|---|---|
| User dragged to pan (99, 77); one small graph replaces another | x −99…1181, y −77…723 | `a` (10, 20, 60, 30), `b` (100, 200, 60, 30) | No — both boxes sit inside the viewport |
| Focus-centred at pan (600, 365); a re-layout moves both nodes | x −600…680, y −365…435 | `a` (500, 400, 60, 30), `b` (900, 700, 60, 30) | No — `a` overlaps the viewport's bottom-right |
| Bounds-centred at pan (560, 285); the replacement graph is laid out far from the origin | x −560…720, y −285…515 | `a` (40000, 20000, 60, 30), `b` (40200, 20400, 60, 30) | **Yes** — no box is anywhere near the viewport |
| Bounds-centred at pan (560, 285); the replacement graph has no nodes | x −560…720, y −285…515 | none | No — an empty graph has nothing to bring on screen |

Overlap is inclusive: a box touching the viewport edge counts as on screen, matching [`computeResidentIds:87`](packages/lib/src/typescript/lib/component/diagram/DiagramResidency.ts#L87), whose intersection test this shares.

### The recovery re-runs the initial centring, never an auto-fit

The floor sets `_needsInitialCentre` and lets the existing [`tryInitialCentre:1200`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1200) do the work, so the recovered view is the one a freshly constructed view would show: the focus node when there is one in the new graph, the graph bounds otherwise, at the current zoom. The floor never calls `zoomToFit`.[^not-fit] Setting the flag and re-calling `tryInitialCentre` is the shape [`resetView:1145`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1145) and [`focusNode:1518`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1518) already use.

### Only a completed layout can trigger the floor

The check runs from [`applyLayout:835`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L835), immediately before its existing `tryInitialCentre()` call, and from nowhere else. Panning the graph off screen by hand must not snap it back, and a failed layout must not move the viewport at all.[^only-applylayout]

### No option to turn the floor off or tune it

No new `DiagramViewOptions` field. The floor only ever replaces a state in which the view shows nothing, so there is no use case to configure, and per [CLAUDE.md](CLAUDE.md) §2 configurability that was not asked for does not get added.

---

## Internal Structure

Two pure functions join [`DiagramResidency.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramResidency.ts), which is internal — it is not re-exported from [`component/diagram/index.ts`](packages/lib/src/typescript/lib/component/diagram/index.ts), so neither is part of the public API.

```typescript
/** Whether two boxes overlap; inclusive, so edge-to-edge counts. @internal */
export function rectsIntersect(a: DiagramRect, b: DiagramRect): boolean;

/** Whether any box in `rects` overlaps `area`. @internal */
export function anyRectIntersects(rects: Iterable<DiagramRect>, area: DiagramRect): boolean;
```

`rectsIntersect` is the test [`computeResidentIds:87`](packages/lib/src/typescript/lib/component/diagram/DiagramResidency.ts#L87) already performs inline, lifted out so both callers share one definition rather than repeating the four comparisons:[^extract]

```typescript
export function rectsIntersect(a: DiagramRect, b: DiagramRect): boolean {
    return a.x <= b.x + b.width  && a.x + a.width  >= b.x
        && a.y <= b.y + b.height && a.y + a.height >= b.y;
}
```

One private method joins `DiagramView`:

```typescript
private rearmCentreIfOffScreen(): void;
```

Its body, in full — every early return is a "leave the pan alone" case:

```typescript
private rearmCentreIfOffScreen(): void {
    if (this._nodeRects.size === 0) {
        return;
    }

    const viewport = this.viewportGraphRect();

    if (viewport === null || anyRectIntersects(this._nodeRects.values(), viewport)) {
        return;
    }

    this._needsInitialCentre = true;
}
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/diagram/DiagramResidency.ts`** — add the exported `rectsIntersect(a, b)` function shown in `## Internal Structure`, above `computeResidentIds`, with a JSDoc block carrying `@param`/`@returns`/`@internal` like its siblings. State in the doc that overlap is inclusive.

2. **Same file** — rewrite `computeResidentIds`'s body to call it. Delete the hoisted `residencyRight` / `residencyBottom` locals and replace the inline `const intersects = …` expression with `const intersects = rectsIntersect(rect, residency);`. Behaviour is identical: `rectsIntersect(rect, residency)` expands to exactly the four comparisons it replaces.

3. **Same file** — add the exported `anyRectIntersects(rects, area)` function below `computeResidentIds`, looping and returning `true` on the first `rectsIntersect` hit, `false` after the loop.

4. **`packages/lib/tests/component/diagram/DiagramResidency.test.ts`** — extend the import on line 13 with `rectsIntersect` and `anyRectIntersects`, update the file header comment's "three pure functions" to "four pure functions" and name the new pair, and add the two `describe` blocks covering `## Expected Behaviour` §A. Run `npx vitest run tests/component/diagram/DiagramResidency.test.ts` from `packages/lib` — the pre-existing `computeResidentIds` cases must still pass untouched, which is the regression check for step 2.

5. **`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`** — extend the `DiagramResidency` value import (line 41) with `anyRectIntersects`.

6. **Same file** — add the private `rearmCentreIfOffScreen()` method exactly as given in `## Internal Structure`, placed immediately above `tryInitialCentre` (line 1200) so the two read in call order. Its JSDoc must say: what it does (re-arms the one-shot centring), when (the graph just promoted has no node overlapping the visible viewport), why each early return exists, and that it never centres itself — `tryInitialCentre`, called straight after, does.

7. **Same file, `applyLayout`** — insert the call immediately above the existing "Before emit, so a consumer's own layout listener…" comment block at line 869, so it reads:

   ```typescript
       // The floor under the preserved pan: when a graph swap at a very
       // different scale leaves the new graph entirely off screen, re-arm the
       // one-shot centring so the call below actually runs.
       this.rearmCentreIfOffScreen();

       // Before `emit`, so a consumer's own `"layout"` listener (the sanctioned
       // auto-fit hook, `view.on("layout", () => view.zoomToFit())`) still runs
       // afterwards and wins. Only succeeds if the view is already sized; the
       // `doLayout` override retries otherwise.
       this.tryInitialCentre();
   ```

   Placement matters: `promoteIncomingNodes()` (line 855) is what makes `_nodeRects` the new graph's boxes, so the check must sit after it and before `tryInitialCentre`.

8. **Same file** — update the `_needsInitialCentre` field JSDoc (lines 390–395). Its current text ("Cleared by the first layout that manages to centre, so a later `setData` re-layout never yanks a pan the user has since dragged to") is now only half true; add that a later layout re-arms it when the promoted graph lands entirely outside the viewport, naming `rearmCentreIfOffScreen`.

9. **`packages/lib/tests/component/diagram/DiagramView.test.ts`** — add the `offScreenResult()` and `edgeTouchingResult()` fixtures beside `movedRootResult()` (line 113), then add a `describe('DiagramView — a re-layout that lands off screen re-centres', …)` block covering `## Expected Behaviour` §B. Place it directly after the existing `describe('DiagramView — initial view is centred, matching resetView', …)` block, which ends at line 740, so the one-shot rule and its floor read together.

10. **Same file** — run the whole file: `npx vitest run tests/component/diagram/DiagramView.test.ts`. Three existing tests pin the unchanged half of the contract and must still pass with no edit: line 722 (`centres only the first layout — a later setData leaves the current pan alone`), line 1630 (`is one-shot: a later setData does not re-yank a pan the user has since dragged to`), and line 3196 (`a failed re-layout leaves the mounted set exactly as the first graph left it`).

11. **`packages/lib/docs/components/DiagramView.md`** — extend the **Initial view** bullet (line 131) with the floor, in the page's existing voice. State: a later `setData` keeps the current pan and zoom; the one exception is a new graph that would land entirely outside the viewport, which is re-centred as if it were the first, at the current zoom. Do not restate it in the **First paint** bullet (line 132).

12. **`packages/lib/docs/reference/changelog/next.md`** — add one bullet under `## Fixed` → `### Components` (the section starting at line 287), in the file's established shape: a bolded lead sentence, then the mechanism, ending with "No consumer action is needed."

13. Run the full verification set in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramResidency.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` |
| Modify | `packages/lib/tests/component/diagram/DiagramResidency.test.ts` |
| Modify | `packages/lib/tests/component/diagram/DiagramView.test.ts` |
| Modify | `packages/lib/docs/components/DiagramView.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every case below is unit-testable in the offline harness except the two marked **manual**.

### §A — the pure helpers (`DiagramResidency.test.ts`)

1. `rectsIntersect` returns `true` for two overlapping boxes.
2. `rectsIntersect` returns `true` for boxes touching edge-to-edge — `{x:0,y:0,w:10,h:10}` against `{x:10,y:0,w:10,h:10}` — matching `computeResidentIds`'s documented inclusive intersection.
3. `rectsIntersect` returns `false` for boxes separated on x only.
4. `rectsIntersect` returns `false` for boxes separated on y only.
5. `anyRectIntersects` returns `false` for an empty iterable.
6. `anyRectIntersects` returns `true` when one box out of several overlaps.
7. `anyRectIntersects` returns `false` when no box overlaps.
8. Every existing `computeResidentIds` case still passes unchanged after step 2's rewrite.

### §B — the view (`DiagramView.test.ts`)

All cases size the view to 1280 × 800 and let the first layout settle on `fixedResult()` before the second `setData`. Cases 9–15 need the two-call stub-engine shape already used at lines 2461 and 3196 (a stub whose `layout` returns `fixedResult()` on the first call, and the case's own second result — or a rejection, for case 15 — on the second).

9. **A `setData` whose graph lands entirely off screen re-centres on the graph bounds.** First layout centres at pan (560, 285). `setData(simpleGraph())` then resolves to `offScreenResult()` — nodes at (40000, 20000) and (40200, 20400), graph 80000 × 40000. The transform ends at `translate(-39360px, -19600px) scale(1)`: `centreGraph`'s `(1280 − 80000) / 2` and `(800 − 40000) / 2`.
10. **The same swap centres the focus node when the new graph has one.** Same fixtures, but the view is built with `initialFocusNode: 'a'`, so the first layout centres at pan (600, 365) and the recovery goes through `centreNode('a')` instead: node `a` at (40000, 20000, 60, 30) has centre (40030, 20015), giving `translate(-39390px, -19615px) scale(1)`.
11. **The recovery mounts the new graph's nodes.** After case 9, `view._residentIds` equals `new Set(['a', 'b'])` — the fix has to end the blank canvas, not just the wrong pan.
12. **The recovery never changes the zoom.** After case 9, `view.getZoom()` is still `1`, unlike `zoomToFit`, which would drop it to fit an 80000-wide graph.
13. **A single node touching the viewport edge is enough to keep the pan.** First layout centres at pan (560, 285) → viewport x −560…720. The second layout resolves to `edgeTouchingResult()` — one node `a` at (720, 400, 60, 30), graph 800 × 500 — whose left edge lands exactly on the viewport's right edge. The transform stays `translate(560px, 285px) scale(1)`.
14. **A new graph with no nodes leaves the flag alone.** `setData({ nodes: [], edges: [] })` resolving to a result with no nodes leaves `view._needsInitialCentre` `false`, so a later on-screen graph still keeps the user's pan.
15. **A failed layout never re-centres.** With the second layout rejecting, the transform is unchanged — `handleLayoutFailure` does not reach `applyLayout`, so the floor cannot fire. (The existing test at line 3196 already covers the mounted set; this one covers the transform.)
16. **Panning the graph off screen by hand does not snap back.** After the first layout settles, write `view._panX = 90000; view._panY = 90000; view.applyTransformToHost();` — the transform stays at `translate(90000px, 90000px) scale(1)` and `view._needsInitialCentre` stays `false`. Only a completed layout can arm the floor.
17. **The two existing one-shot tests keep passing verbatim** — line 722 and line 1630. Their graphs stay on screen at pan (99, 77), so the floor does not fire.

### §C — in the real app (**manual**)

18. **manual** — With this build symlinked into sqladmin, open a database diagram, leave it in its default Overview mode, then switch the Mode dropdown to Tables. The canvas must show a populated region of the 325-table graph without any click on Fit to view. It shows the centre of that graph at the current zoom, not the whole graph — fitting it is the consumer's call, and the companion app change in `## Non-Goals` is what makes it a fit.
19. **manual** — In the same panel, pan the Tables-mode diagram somewhere by hand, then toggle a schema's legend checkbox (an incremental re-filter of the same graph, whose result stays on screen). The pan must survive.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — the whole suite green, including `tests/component/diagram/DiagramResidency.test.ts` and `tests/component/diagram/DiagramView.test.ts`. The three named regression tests in step 10 must pass with no edit to them.
- `npm run lint` — clean; the ESLint baseline must not grow.
- `npm run docs:api` — finishes with zero warnings (per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), required after touching JSDoc).
- `grep -rn 'residencyRight\|residencyBottom' packages/lib/src/` — expect zero matches after step 2.
- `grep -rn 'rectsIntersect(' packages/lib/src/` — expect exactly three matches: the definition, the call from `computeResidentIds`, and the call from `anyRectIntersects`. No fourth copy of the intersection test may remain.
- Manual, per `## Expected Behaviour` §C: build with `npm run build:lib`, point sqladmin's `@jimka/typescript-ui` symlink at this worktree's `packages/lib`, restart the frontend dev server and clear `frontend/node_modules/.vite` (a stale Vite dependency snapshot otherwise serves the old library), then open a database diagram from the navigator's database node → "Open database diagram" and exercise cases 18 and 19.

---

## Documentation Impact

- **[`packages/lib/docs/components/DiagramView.md`](packages/lib/docs/components/DiagramView.md)** — the **Initial view** bullet (line 131) gains the floor. This is the only page describing the initial-centring contract; `## Common methods` needs no row, because no method is added or changed.
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — one bullet under `## Fixed` → `### Components`.
- **No export or barrel change.** `rectsIntersect` and `anyRectIntersects` live in `DiagramResidency.ts`, which [`component/diagram/index.ts`](packages/lib/src/typescript/lib/component/diagram/index.ts) does not re-export; both carry `@internal`, so neither reaches the TypeDoc output.
- **No `llms.txt` change.** It is generated by a separate `npm run docs:llms` pass and was left untouched by the three merged diagram plans.
- **No `{@link}` risk.** Every new JSDoc block is on a private or `@internal` symbol, so the rule against linking excluded symbols from public JSDoc does not bind — but `npm run docs:api` still has to come back clean.

---

## Potential Challenges

- **The recovery shows the centre of a huge graph, not the whole graph.** A 325-table graph centred at zoom 1 fills the viewport with one dense region. That is the documented initial-view contract (`DiagramView` never auto-fits), and a consumer wanting a fit calls `zoomToFit()` after `whenLaidOut()` — which is exactly what the companion app change does.
- **A view that loses its committed size between layouts is not covered.** `rearmCentreIfOffScreen` needs a viewport rectangle, so it returns early on an unsized view. That ordering is already the retry path `doLayout` owns: `_needsInitialCentre` is only ever cleared by a centring that succeeded, which requires a size.
- **`rectsIntersect` is now a call inside `computeResidentIds`'s loop**, which runs over every node and every edge on each residency refresh. The call performs the same four comparisons and adds two additions per candidate box, against a loop already doing a `Map` lookup per id. If a measurement ever shows that matters, hoist the two sums back into `computeResidentIds` and keep `rectsIntersect` for `anyRectIntersects` alone.
- **The harder blank-diagram variant is not claimed fixed.** A diagram that stayed blank *even after* clicking Fit to view was seen once, under repeated Mode-switch cycles combined with a Vite dependency re-optimization, and could not be reproduced again. A pan the floor can repair is repaired by Fit to view too, so that variant has a different cause and stays open.[^harder-variant]

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) — read `_needsInitialCentre` (line 395), `setData` (574), `applyLayout` (835), `viewportGraphRect` (967), `tryInitialCentre` (1200), `centreGraph` (1225), `centreNode` (1475), `focusNode` (1518), `doLayout` (1631).
- [`packages/lib/src/typescript/lib/component/diagram/DiagramResidency.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramResidency.ts) — all 96 lines; `computeResidentIds` (73) holds the intersection test being lifted out and shared.
- [`packages/lib/src/typescript/lib/component/container/VirtualScroller.ts:380`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L380) — the precedent this plan mirrors: keep the user's position, repair it only when a content change leaves the view pointing at nothing. Its callers, [`table/Body.ts:1261`](packages/lib/src/typescript/lib/component/table/Body.ts#L1261) and [`tree/Tree.ts:1348`](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1348), show where in a render pass the repair belongs.
- [`packages/lib/tests/component/diagram/DiagramView.test.ts`](packages/lib/tests/component/diagram/DiagramView.test.ts) — the fixtures block (lines 80–146) for `simpleGraph` / `fixedResult` / `movedRootResult` / `parseTransform`, the two-call stub-engine shape (2461, 3196), and the three regression tests named in step 10.
- [`packages/lib/tests/component/diagram/DiagramResidency.test.ts`](packages/lib/tests/component/diagram/DiagramResidency.test.ts) — the existing `computeResidentIds` block the new helpers sit beside.
- [`packages/lib/docs/components/DiagramView.md:131`](packages/lib/docs/components/DiagramView.md#L131) — the **Initial view** bullet to extend.

---

## Non-Goals

- **No auto-fit.** The recovery centres at the current zoom. `DiagramView`'s documented initial view does not fit, and the recovery must not diverge from it.
- **No new option.** The floor is unconditional; nothing configures or disables it.
- **No change when the new graph is even partly on screen.** Preserving the pan across a `setData` is the contract, not the bug.
- **No change to how `setData` promotes, mounts, or draws.** The residency, level-of-detail, and promotion machinery is untouched; only the pan the residency pass reads can now be repaired first.
- **Not the harder blank-diagram variant** (blank even after Fit to view) — see `## Potential Challenges`.
- **No sqladmin change.** The app half of the fix lives in a separate repository with its own `plans/` directory. For whoever picks it up, it is three edits:
  1. `frontend/src/dock/diagramShell.ts:437` — change `private settleViewport(): void` to `protected`, so a subclass can call it.
  2. `frontend/src/dock/DatabaseDiagramPanel.ts:150` — the `modeControl.on("change", …)` handler calls `this.view.setData(…)` on both branches and never settles the viewport; add one `this.settleViewport()` after the if/else. Every other control gesture in the shell already does this (`chooseRoot`, and the Direction / Depth / prune listeners at lines 295–311).
  3. `frontend/src/dock/DatabaseDiagramPanel.ts:215` — `focusSchema` (the Overview double-click drill-down) ends with `this.setRoot(null)`, which re-derives through `rootingChanged()` but never settles either; add `this.settleViewport()` after it. `setRoot` deliberately does not settle — only `chooseRoot`, the selector's own gesture, does.

  The per-schema legend checkboxes (`schemaLegendRow` → `applyFilter`, line 181) intentionally stay unsettled: hiding a schema is an incremental edit of the same graph, and keeping the user's pan is the right outcome there.

---

## Notes

[^observed]: The reproduction is the human operator's, taken live this session against a real 325-table database, and is not derivable from either repository offline. Opening the diagram (default Overview mode) and switching Mode to Tables left the canvas blank; clicking Fit to view immediately showed the correct graph; reproduced twice cleanly. An earlier session's measurement, recorded in sqladmin's `LIBRARY_NOTES.md`, quantified the same failure as zero node components and zero drawn edges in the view's DOM subtree, with the ELK worker confirmed to have returned a well-formed result. Zero mounted nodes means no node box reached even the *inflated* residency rectangle (the viewport grown by half a viewport per side), which implies no node box reached the viewport itself — the condition this plan's floor tests. That measurement, not a reconstruction of the exact pan arithmetic, is what the trigger is keyed to; the precise geometry that put the viewport in an empty region of the Tables graph is not recoverable from the repository.

[^behaviour-change]: The one consumer-visible change: a `setData` whose new graph lands entirely outside the viewport now moves the pan, where before it did not. It is worth stating even though it is unlikely to break anyone, because "the pan survives `setData`" is a documented contract. The states it can affect are exactly the states in which the view shows an empty canvas, so nothing a consumer could have been relying on is lost — and a consumer that hid the control cluster with `controls: false` previously had no recovery available to the user at all.

[^floor-not-policy]: Two other shapes were considered and rejected. *Re-centre on every `setData`* contradicts the documented contract and would break a consumer polling for live data while the user pans — and the library cannot tell a full graph replacement from an incremental refresh. *Leave it to the consumer entirely*, on the grounds that `zoomToFit` / `focusNode` / `resetView` are already the opt-in re-anchor APIs and sqladmin's own `settleViewport` exists to be that call, is the stronger objection: the consumer contract genuinely is "re-anchor after a replacement". It still leaves the library able to render an empty canvas with no error, no event, and — under `controls: false` — no user-reachable recovery, on a code path where the layout succeeded. A component should not have a reachable state in which correct data renders as nothing. Hence: the consumer keeps owning the policy, the library owns the floor.

[^why-not-ratio]: A scale-ratio trigger ("the new bounds are more than N× the old") needs a threshold with no principled value, fires on graph changes that are still perfectly visible, and misses a same-scale graph laid out in a different part of the coordinate space. The visibility test has neither problem and is decidable from state the view already holds.

[^why-not-bounds]: Testing the viewport against the graph's bounding box `(0, 0, graphWidth, graphHeight)` is cheaper but wrong for exactly the graph that produced the bug. sqladmin's Tables mode groups tables into one compound container per schema, so the graph's box spans tens of thousands of units of mostly whitespace; a viewport sitting inside a container's empty interior intersects that box while showing the user nothing. Node boxes are what is actually drawn, so they are what the test uses.

[^not-fit]: The user's own manual recovery was Fit to view, which is an argument for making the floor fit rather than centre. It was rejected because `DiagramView` deliberately does not auto-fit — the docs say so and offer `view.on('layout', () => view.zoomToFit())` as the opt-in — and because a fit would silently discard a consumer's configured `zoom`. Centring at the current zoom is what a freshly constructed view does with the same graph, which makes the recovered state one the consumer already understands. A consumer that wants the fit still gets it from its own `whenLaidOut()` handler.

[^only-applylayout]: Running the check from `doLayout` as well would cover one extra ordering (a view laid out while unsized, then sized), but `doLayout` also runs on every parent layout pass — including after the user has deliberately dragged the graph into empty space, which the docs describe as an infinite canvas. The floor would then fight the user on the next window resize. `applyLayout` is the only entry point where "the graph was just replaced" is true, so it is the only one that gets the check.

[^extract]: `computeResidentIds` currently hoists `residency.x + residency.width` and `residency.y + residency.height` into locals before its loop. Sharing one predicate costs those two additions per candidate box and buys a single definition of "these two boxes overlap" for the two callers that need it — worth it, since a second hand-written copy of the same four comparisons is the kind of drift that produces an inclusive test in one place and an exclusive one in the other.

[^harder-variant]: Recorded in sqladmin's `LIBRARY_NOTES.md` under the level-of-detail verification entry: after repeated Mode-switch cycles and a Vite dependency re-optimization, the diagram stayed at zero mounted nodes even after Fit to view, with a `Worker` proxy confirming ELK returned a well-formed result and a `Promise.prototype.catch` proxy catching nothing. It reproduced identically against a parent-commit build, so it predates the three merged diagram plans. Because `zoomToFit` writes a fresh finite pan from the graph bounds, any state that survives it is not a stale-pan state, so this plan's floor cannot be the fix for it. Left open.
