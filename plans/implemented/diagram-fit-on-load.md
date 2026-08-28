---
depends-on: [diagram-recentre-on-rescale]
touches-shared:
  - packages/lib/src/typescript/lib/component/diagram/DiagramView.ts
  - packages/lib/tests/component/diagram/DiagramView.test.ts
  - packages/lib/docs/components/DiagramView.md
  - packages/lib/docs/reference/changelog/next.md
---

# Diagram Fit on Load — Implementation Plan

## Overview

[`DiagramView`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) centres its graph once, on the first layout that manages to centre, and today deliberately keeps the configured zoom while doing it: [`tryInitialCentre:1233`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1233) calls [`centreGraph:1258`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1258), which writes a pan and never touches the zoom factor. A view therefore opens at `zoom` (default `1`) however large or small the graph is — a big graph opens overflowing, a small one opens adrift in empty canvas. Fitting the graph to the viewport is available only as a separate gesture: the built-in **Fit to view** button, or [`zoomToFit:1129`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1129) called by hand.

Every current consumer wants the fitted opening.[^consumer-evidence] This plan adds one optional `DiagramViewOptions` field, `fitOnLoad`, **defaulting to `true`**. With it at its default, the view's first successful centring computes the same zoom `zoomToFit()` computes instead of holding the configured one; everything else about the view is untouched. This is a behaviour change for every existing consumer that does not pass an explicit `zoom`-holding override: a diagram that used to open at zoom 1 (or whatever `zoom` was configured) now opens fitted instead. A consumer that wants the old opening passes `fitOnLoad: false` explicitly.

The one real hazard is that [`resetView:1153`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1153) reaches the initial-centring code too, one line after restoring the default zoom itself. **Fit to view** and **Reset view** are two separate buttons with two different contracts, and a naive implementation would collapse them into one whenever the fit branch can run. The design below gates the new behaviour on a second, never-re-armed flag so that cannot happen — and, because that flag (not the option's default) is what protects `resetView`, the default flip changes nothing about that protection.

---

## Architecture Decisions

### `fitOnLoad` defaults to `true`

Every real consumer already fits the opening view by hand today, so the plan makes that the built-in default instead of an opt-in.[^consumer-evidence] A consumer that relies on the pre-existing "hold the configured zoom" opening passes `fitOnLoad: false`.

### The option gates a new one-shot flag, not the existing pending flag

`fitOnLoad` fits on the view's **first-ever successful centring** and never again. That "first ever" is recorded by a new private boolean, `_hasCentredOnce`, kept completely separate from the existing `_needsInitialCentre`.[^two-flags]

The new flag mirrors [`Component._firstLayoutCallbacks:417`](packages/lib/src/typescript/lib/core/Component.ts#L417) and its drain in [`runFirstLayoutCallbacks:6817`](packages/lib/src/typescript/lib/core/Component.ts#L6817), the library's existing never-re-armed one-shot: it is spent only by a pass that actually did the work, and a pass that ran too early leaves it intact for the next one.[^precedent-search]

The two flags answer different questions:

| Flag | Question | Written by |
|---|---|---|
| `_needsInitialCentre` | Is a centring owed right now? | armed at construction, re-armed by `resetView`, `focusNode`, and `rearmCentreIfOffScreen`; cleared by a centring that succeeded |
| `_hasCentredOnce` | Has this view ever centred at all? | set by the first centring that succeeded, and forced by `resetView`; never cleared |

### Reset view spends the one-shot before it re-arms

`resetView()` sets `_hasCentredOnce = true` before arming `_needsInitialCentre`, so a Reset click is never treated as a first load — no matter whether the view had already centred when it was clicked. This protection reads only `_hasCentredOnce`, never the `fitOnLoad` option itself, so it is unaffected by which way that option now defaults.[^reset-forces]

### The focus node still wins

When a focus node is set and present in the graph, the focus branch runs exactly as today and `fitOnLoad` does nothing. The focus branch already fits its target: [`centreNode:1508`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1508) lowers the zoom through `zoomFittingNode` until the node's whole box fits, and never raises it.[^focus-wins]

Worked cases, all on the test suite's 1280 × 800 viewport with the `fixedResult()` fixture (graph 160 × 230; node `a` at (10, 20, 60, 30)):

| Situation | `_hasCentredOnce` on entry | Focus node | Branch | Resulting transform |
|---|---|---|---|---|
| default (`fitOnLoad` unset), first centring | `false` | none | fit | `scale(3.478…)`, pan (361.74, 0) |
| `fitOnLoad: false`, first centring | `false` | none | centre | `scale(1)`, pan (560, 285) |
| default, `initialFocusNode: 'a'` | `false` | `a` | focus | `scale(1)`, pan (600, 365) |
| any `fitOnLoad` value, **Reset view** clicked later | forced `true` | none | centre, at the default zoom | `scale(1)`, pan (560, 285) |
| any `fitOnLoad` value, later off-screen re-arm | `true` | none | centre, at the current zoom | pan recomputed, zoom untouched |

The last row is the off-screen re-centring floor added by [`plans/implemented/diagram-recentre-on-rescale.md`](plans/implemented/diagram-recentre-on-rescale.md): a `setData` whose new graph lands entirely outside the viewport re-arms `_needsInitialCentre` through [`rearmCentreIfOffScreen:1197`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L1197). Because `_hasCentredOnce` is already `true` by then, that recovery keeps its current "hold the zoom" semantics — the floor stays a floor rather than becoming a policy, whatever zoom happened to be in effect (the configured one, or a fit zoom the first load already applied).[^floor-unchanged]

### `zoomToFit` and the new branch share one fit computation

The fit-zoom arithmetic is extracted from `zoomToFit()` into a private `fitGraph(): boolean` that both call. `fitGraph` returns whether it actually wrote the zoom and pan, so `tryInitialCentre` can gate on it exactly as it gates on `centreGraph()` and `centreNode()` today.[^extract-fit] `zoomToFit()`'s own guard, arithmetic, and observable behaviour are unchanged — it becomes a two-line forwarder that discards the boolean.

### No accessor pair for the new option

`fitOnLoad` is construction-time only: it is consumed once, and after the first centring there is nothing left for a setter to change. It follows [`initialFocusNode:250`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L250) — the other initial-view option on this class — which is cached in `applyOptions` and read directly, with no `setInitialFocusNode`/`getInitialFocusNode` pair and no class-level default.[^no-accessors]

### The default lives as a bare literal, not a named constant

`tryInitialCentre` reads `this._options.fitOnLoad ?? true` directly. No `DEFAULT_FIT_ON_LOAD` constant is added alongside `DEFAULT_ZOOM` / `DEFAULT_MIN_ZOOM` / `DEFAULT_MAX_ZOOM` (declared at [DiagramView.ts:54-60](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts#L54)).[^bare-literal]

---

## Public API

One new optional field on `DiagramViewOptions`. No method is added, removed, or changed.

```typescript
export interface DiagramViewOptions extends PanelOptions {
    // …existing fields unchanged…

    /**
     * Fit the whole graph to the viewport on the view's first centring,
     * instead of holding the configured `zoom` (default `true`). The scale
     * chosen is the one {@link DiagramView.zoomToFit} would choose — the
     * largest at which the graph bounds fit both axes — so the view opens
     * exactly as the built-in "Fit to view" control would leave it. Applies
     * once, to the first centring that succeeds, and only when no focus node
     * is set: {@link DiagramViewOptions.initialFocusNode} still wins, and
     * neither a later `setData` nor the "Reset view" control is affected.
     * Pass `false` to hold the configured `zoom` instead — the opening every
     * `DiagramView` had before this option existed.
     */
    fitOnLoad?: boolean;
}
```

Two private members join `DiagramView`; neither is exported and neither reaches the API docs:

```typescript
private _hasCentredOnce: boolean;
private fitGraph(): boolean;
```

---

## Internal Structure

### The new field

Placed directly below `_needsInitialCentre` (line 398), so the two read together:

```typescript
    /**
     * Whether this view has ever completed a centring. Set by the first
     * `tryInitialCentre` pass that actually centres, and forced by
     * `resetView` before it re-arms, so a Reset click is never treated as a
     * first load. Never cleared. Deliberately separate from
     * `_needsInitialCentre`, which is a pending *request* that `resetView`,
     * `focusNode`, and `rearmCentreIfOffScreen` all legitimately re-arm:
     * this flag records that the first-load moment has passed, so the
     * `fitOnLoad` option fits exactly once.
     */
    private _hasCentredOnce: boolean = false;
```

A plain initializer is correct here — nothing reachable during the `super()` cascade writes this field, so the `declare` rule in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) does not apply. `_needsInitialCentre` and `_focusNodeId` are declared the same way.

### The extracted fit

Placed directly below `zoomToFit` (which ends at line 1141):

```typescript
    /**
     * Fits the whole graph in the viewport: picks the largest zoom at which
     * the graph bounds fit both axes, then centres the graph at that zoom.
     * Shared by `zoomToFit` and the fit-on-load branch of `tryInitialCentre`,
     * which needs the success flag to decide whether its one-shot is spent.
     *
     * @returns `true` when the zoom and pan were written, `false` when no
     *   layout has completed or the view has no committed size yet.
     */
    private fitGraph(): boolean {
        if (this._graphWidth <= 0 || this._graphHeight <= 0) {
            return false;
        }

        const zoomX = this.getWidth()  / this._graphWidth;
        const zoomY = this.getHeight() / this._graphHeight;

        this.setZoom(Math.min(zoomX, zoomY));

        return this.centreGraph();
    }
```

The guard is `zoomToFit`'s current one, moved verbatim.[^guard-verbatim] On an unsized view the two divisions are `NaN`, `setZoom` rejects a non-finite request, and `centreGraph` declines and returns `false` — the same silent no-op `zoomToFit` performs today, now reported to the caller.

### The rewritten centring

```typescript
    private tryInitialCentre(): void {
        if (!this._needsInitialCentre || !(this._graphWidth > 0) || !(this._graphHeight > 0)) {
            return;
        }

        const focus = this._focusNodeId !== null && this._nodeComponents.has(this._focusNodeId)
            ? this._focusNodeId
            : null;

        const fitting = !this._hasCentredOnce && (this._options.fitOnLoad ?? true);

        const centred = focus !== null
            ? this.centreNode(focus)
            : (fitting ? this.fitGraph() : this.centreGraph());

        if (centred) {
            this._needsInitialCentre = false;
            this._hasCentredOnce     = true;
        }
    }
```

`_hasCentredOnce` is set on *any* successful branch, including the focus branch: the question it answers is "has this view ever centred", not "has it ever fitted". The only change from an unflipped default is the `?? true` on the line computing `fitting` — every other line is identical.

### The rewritten reset

```typescript
    resetView(): this {
        this.setZoom(this._defaultOptions.zoom ?? DEFAULT_ZOOM);

        // Reset is never a first load: spend the fit-on-load one-shot before
        // re-arming, so `fitOnLoad` cannot override the default zoom this
        // method just restored. "Reset view" and "Fit to view" are two
        // separate controls and must stay two separate outcomes.
        this._hasCentredOnce     = true;
        this._needsInitialCentre = true;
        this.tryInitialCentre();

        return this;
    }
```

---

## Ordered Implementation Steps

Line numbers below are cited against the real files as read while drafting this plan; they are accurate for the *first* step that touches a given file, but earlier edits in the same file shift later line numbers by a few lines. Locate every subsequent target primarily by its test name / `describe` block text, using the given number only as a starting point. Work from `packages/lib` for every command.

### Source surface (no behaviour change yet)

1. **`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`** — add the `fitOnLoad?: boolean;` field with the JSDoc block given in `## Public API` to `DiagramViewOptions`, directly after `initialFocusNode` (line 250) and before the `listeners` bag (line 251). Then cache it in `applyOptions`, on the line after the `initialFocusNode` cache (line 565), in the file's one-line style with its own "cached only" comment:

   ```typescript
        // Cached only: read once by `tryInitialCentre`, which is where the
        // view's first centring decides between fitting and holding the zoom.
        if (options.fitOnLoad !== undefined) this._options.fitOnLoad = options.fitOnLoad;
   ```

   Do **not** seed a `fitOnLoad` default in the constructor's defaults bag (lines 430–433): the class has no `subclassDefaults` parameter for `fitOnLoad` to route through, and nothing reads `_defaultOptions.fitOnLoad` (see `## Architecture Decisions` → "No accessor pair for the new option").

   Check: `npm run typecheck` is clean, and `new DiagramView({ fitOnLoad: false })` now compiles while changing nothing (the field is not read anywhere yet).

### Pre-existing tests: recompute the six whose assertions assumed "hold zoom" (now red)

2. **`packages/lib/tests/component/diagram/DiagramView.test.ts`** — the following six tests construct a plain view (no `initialFocusNode`, no `zoom` override that matters, no `fitOnLoad`) and reach a successful *default* first centring, so once the source behaviour in steps 5–8 below lands they will fit instead of holding zoom 1. Edit each now, before the source change, so it goes red for the right reason and green once the source change lands. Every fitted number below is `Math.min(1280 / 160, 800 / 230)` on the `fixedResult()` fixture (160 × 230 graph, 1280 × 800 viewport) — the exact same fit the existing `zoomToFit` test at line 590 already asserts through `parseTransform` + `toBeCloseTo`, because the zoom (`800/230`) is not exactly representable.

   **a. `it('centres the graph on the first layout instead of showing its top-left corner', …)` (line 668).** Rename to `'fits the graph on the first layout by default, instead of showing its top-left corner'` and replace its final line — `expect(view._contentHost.getTransform()).toBe('translate(560px, 285px) scale(1)');` — with:

   ```typescript
       // fitOnLoad now defaults to true: the first centring fits instead of
       // holding zoom 1. The fit zoom is 800/230, not exactly representable.
       const expectedZoom = Math.min(1280 / 160, 800 / 230);
       const { panX, panY, zoom } = parseTransform(view._contentHost.getTransform());

       expect(zoom).toBeCloseTo(expectedZoom, 5);
       expect(panX).toBeCloseTo((1280 - 160 * expectedZoom) / 2, 3);
       expect(panY).toBeCloseTo((800 - 230 * expectedZoom) / 2, 3);
   ```

   **b. `it('falls back to the graph bounds when the focus id names no node in the graph', …)` (line 1776, in the `initialFocusNode / focusNode` block).** `initialFocusNode: 'nope'` names no node, so `tryInitialCentre` resolves `focus` to `null` and falls into the same default fit branch. Rename to `'falls back to fitting the graph bounds when the focus id names no node in the graph'` and apply the identical replacement as 2a (same fixture, same viewport, same numbers).

   **c. `it('centres the graph bounds, unchanged, when no initialFocusNode is configured', …)` (line 1787, same block).** Rename to `'fits the graph bounds by default when no initialFocusNode is configured'` and apply the identical replacement as 2a.

   **d. `it('defers the centring when the layout lands before the view has been sized', …)` (line 697).** Only its *second* assertion (line 714, after the mount/size/`doLayout()` retry) changes — the first assertion (line 706, still unsized) stays, since an unsized view declines regardless of `fitOnLoad`. Replace line 714 with the same three-line `parseTransform` + `toBeCloseTo` block as 2a (fresh `expectedZoom`/`panX`/`panY`/`zoom` locals — this test already has its own `view`).

   **e. `it('does not lose the centring when a layout pass runs while the view is still unsized', …)` (line 719).** Only its *second* assertion (line 742, after `setSize` + `doLayout()`) changes, the same way as 2d. The two earlier assertions (lines 706-equivalent at 737, both against the unsized-view corner case) stay.

   **f. `it('centres only the first layout — a later setData leaves the current pan alone', …)` (line 747).** This one is subtler: `view.setSize(...)` runs *before* `await flush()`, so the automatic first centring now fits (to the same zoom as 2a) before the test's manual `view._panX = 99; view._panY = 77;` override runs. That override writes the pan fields directly and never touches zoom, so the zoom stays at the fit value the automatic centring set. Add a comment above the override noting this — `// The first centring already fit (fitOnLoad defaults to true), so the zoom here is the fit zoom, not 1 — only the pan is overwritten below.` — and replace the final assertion, `expect(view._contentHost.getTransform()).toBe('translate(99px, 77px) scale(1)');`, with:

      ```typescript
       const expectedZoom = Math.min(1280 / 160, 800 / 230);
       const { panX, panY, zoom } = parseTransform(view._contentHost.getTransform());

       expect(zoom).toBeCloseTo(expectedZoom, 5);
       expect(panX).toBe(99);
       expect(panY).toBe(77);
      ```

   Run `npx vitest run tests/component/diagram/DiagramView.test.ts` and confirm exactly these six tests fail (the source has not changed yet) and every other test still passes.

### Pre-existing tests: isolate the eleven whose setup — not their point — assumed "hold zoom"

3. **Same test file.** The following eleven tests are about a *different* mechanism (the off-screen re-centring floor, `focusNode`'s own zoom-lowering, or low-zoom simplification) and use a plain view purely as scaffolding on the way to it. Left alone, the new default would change that scaffolding's zoom out from under several of them — directly, in tests asserting an absolute transform or zoom value, and indirectly, in tests asserting node/edge residency, since the residency rect's size in graph coordinates scales with zoom.[^focusnode-zoom-floor] Rather than re-verify each one's tolerance to that shift individually, add `fitOnLoad: false` uniformly across all eleven, so every one of them keeps testing exactly what it always tested, unchanged. This is the same one-line edit at eleven call sites — add `, fitOnLoad: false` to the options object:

   | File | Line | Test | Block |
   |---|---|---|---|
   | `DiagramView.test.ts` | 682 | `'keeps a consumer-configured zoom rather than resetting it to the default'` | `resetView` / initial view |
   | `DiagramView.test.ts` | 789 | `'a setData whose graph lands entirely off screen re-centres on the graph bounds'` | off-screen floor |
   | `DiagramView.test.ts` | 822 | `'the recovery mounts the new graph's nodes'` | off-screen floor |
   | `DiagramView.test.ts` | 836 | `'the recovery never changes the zoom'` | off-screen floor |
   | `DiagramView.test.ts` | 850 | `'a single node touching the viewport edge is enough to keep the pan'` | off-screen floor |
   | `DiagramView.test.ts` | 866 | `'a new graph with no nodes leaves the flag alone'` | off-screen floor |
   | `DiagramView.test.ts` | 880 | `'a failed layout never re-centres'` | off-screen floor |
   | `DiagramView.test.ts` | 896 | `'panning the graph off screen by hand does not snap back'` | off-screen floor |
   | `DiagramView.test.ts` | 1821 | `'focusNode centres a different node on a settled, sized view'` | `initialFocusNode / focusNode` |
   | `DiagramView.test.ts` | 3225 | `'focusNode mounts its target'` | node virtualization |
   | `DiagramView.test.ts` | 3642 | `'at zoom 1 the view is not simplified, and residency mounts only the nodes near the viewport'` | level-of-detail |

   The one other off-screen-floor test, `'the same swap centres the focus node when the new graph has one'` (line 805), already passes `initialFocusNode: 'a'` — the focus branch wins regardless of `fitOnLoad`, so it needs no change.

   Run the same command as step 2. These eleven stay green throughout (before and after this step, and before and after the source behaviour in steps 5–8) — this step is a no-op today and only matters once `fitOnLoad` defaults to `true`.

### New tests: the dedicated `fitOnLoad` block (added red, turns green with the source change)

4. **Same test file** — add a `describe('DiagramView — fitOnLoad fits the graph on the first centring', …)` block covering every case in `## Expected Behaviour` §A, placed directly after the existing `describe('DiagramView — initial view is centred, matching resetView', …)` block (ends at line 765 before this plan's edits — step 2 lengthens several of its tests, so locate the block's actual end by name, not by this number) and before the off-screen-floor block (starts at line 767), so the three initial-view rules still read in order. Reuse the file's existing `simpleGraph()`, `fixedResult()`, `offScreenResult()`, and `parseTransform()` fixtures (lines 80–171) — add no new fixture function. The one case that needs a two-layout stub (§A case 9) cannot call the off-screen-floor block's `twoCallStub` (defined at line 773, scoped to that block's own closure and not in scope before it) — give it its own small inline stub object instead, matching the shape already used independently in three other places in this file (e.g. the `resetView targets the focus node` block's second test, line 2638): `{ layout: () => { call += 1; return call === 1 ? Promise.resolve(fixedResult()) : Promise.resolve(offScreenResult()); }, dispose: () => {} } as unknown as StubEngine`.

   Run `npx vitest run tests/component/diagram/DiagramView.test.ts` and confirm the new cases fail (the source has not changed yet) while every other case — the six recomputed in step 2, the eleven isolated in step 3, and everything else — passes.

### Source behaviour (turns the red tests green)

5. **`DiagramView.ts`** — add the `_hasCentredOnce` field with its JSDoc exactly as given in `## Internal Structure`, directly below `_needsInitialCentre` (line 398).

6. **Same file** — add the private `fitGraph()` method exactly as given in `## Internal Structure`, directly below `zoomToFit` (which ends at line 1141), then rewrite `zoomToFit`'s body to:

   ```typescript
    zoomToFit(): this {
        this.fitGraph();

        return this;
    }
   ```

   Leave `zoomToFit`'s JSDoc (lines 1122–1128) exactly as it is — its contract has not changed.

7. **Same file** — rewrite `tryInitialCentre` (line 1233) to the body given in `## Internal Structure` — note the `?? true`, not `?? false` — and update its JSDoc: the paragraph claiming "The configured `zoom` deliberately stands" is now conditional, so state that the fit branch runs by default unless `fitOnLoad: false` is passed or a focus node wins, name `_hasCentredOnce` as what makes the fit a one-shot, and keep the existing sentences about the focus-node target and the retry contract.

8. **Same file** — rewrite `resetView` (line 1153) to the body given in `## Internal Structure`, and add one sentence to its JSDoc: the default zoom it restores is never overridden by the fit-on-load default, because a Reset is not a first load.

9. Run `npx vitest run tests/component/diagram/DiagramView.test.ts` — every case green: the six recomputed in step 2, the eleven isolated in step 3 (now genuinely exercising their guard, not just carrying a no-op option), the new dedicated block from step 4, and every other pre-existing case untouched by this plan.

### Docs and changelog

10. **`packages/lib/docs/components/DiagramView.md`** — rewrite the **Initial view** bullet (line 131). Current text opens "the first render centres the graph in the viewport, at whatever `zoom` was configured (default `1`) … It does **not** auto-fit". Replace with:

    > **Initial view** — the first render fits the whole graph to the viewport by default — the same scale and centring the built-in Fit to view control produces — so a graph larger or smaller than the viewport never opens overflowing or adrift in empty canvas. Pass `fitOnLoad: false` to hold the configured `zoom` instead — the same placement the built-in Reset control returns to. Pass `initialFocusNode` to centre that node instead of the graph's bounds — it wins over `fitOnLoad` — an id naming no node in the graph falls back to the (fitted, by default) bounds, and the configured zoom stands unless the focus node is too large to fit the viewport, in which case it is lowered until the node fits. A later `setData` keeps the current pan and zoom exactly as they were, with one exception: a replacement graph that would land entirely outside the viewport is re-centred as if it were the first render, at the current zoom (never re-fitted), so a data refresh at a very different scale never leaves the canvas blank.

    Do not repeat the option in the **Zoom** bullet (line 136) or the **Control cluster** bullet (line 141), and add no row to `## Common methods` — no method is added.

11. **`packages/lib/docs/reference/changelog/next.md`** — this is a default-behaviour change, not a purely additive one, so it belongs in `## Breaking changes` → `### Components` (line 30), alongside the existing table-body-class bullet, in that section's shape (bold lead sentence stating what breaks, the mechanism, then explicit migration guidance) — not in `## Added`, whose `### Components` bullets in this file are reserved for changes every existing consumer is unaffected by. Add one bullet at the end of the `### Components` list under `## Breaking changes`:

    > - **[`DiagramView`](/components/DiagramView) now opens its graph fitted to the viewport by default.** A new `fitOnLoad` option controls the view's first successful centring — fitted (the same scale and centring the built-in Fit to view control produces) when `true`, or holding the configured `zoom` when `false` — and it **defaults to `true`**: every current consumer was already fitting the initial view by hand, so the useful default is now built in. **A consumer relying on the previous opening — the configured `zoom`, however large or small the graph is relative to the viewport — must now pass `fitOnLoad: false` explicitly.** The change applies once, to the first centring that succeeds, and only when no `initialFocusNode` is set; a later `setData`, the off-screen re-centring floor, and the Reset view control are all unaffected.

12. Run the full set in `## Verification`.

### Manual demo check

13. **`packages/lib/src/typescript/DiagramPanel.ts:80`** (`new DiagramView({ data: SAMPLE })`) — no temporary edit is needed: with `fitOnLoad` now defaulting to `true`, this line already opens fitted. Run `npm run dev`, open the **Diagram** section, and confirm the graph opens filling the viewport rather than at 1× in the middle of empty canvas. Click **Reset view** (the crosshairs button): the diagram must return to 1× centred, *not* re-fit. Click **Fit to view** (the expand button): it must return to the opening scale. Then, to confirm the opt-out still works, temporarily change the line to `new DiagramView({ data: SAMPLE, fitOnLoad: false })`, reload, and confirm the diagram now opens at 1× centred (the pre-this-plan behaviour) instead of fitted. Revert the temporary edit and confirm `git status` shows no change to `DiagramPanel.ts`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` |
| Modify | `packages/lib/tests/component/diagram/DiagramView.test.ts` |
| Modify | `packages/lib/docs/components/DiagramView.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### §A — the view (`DiagramView.test.ts`), all unit-testable

Every case sizes the view to 1280 × 800 and uses the `fixedResult()` fixture unless it says otherwise. The fit zoom for that fixture is `Math.min(1280 / 160, 800 / 230)` = 3.478…, giving pan (361.739…, 0). **A fitted transform must be asserted through `parseTransform` + `toBeCloseTo`, never as a literal string** — the fit zoom is not exactly representable. This is no longer a corner case confined to explicit `zoomToFit()` calls: because the default now fits, most of a *default* view's opening assertions need the same treatment (see the six pre-existing tests recomputed in `## Ordered Implementation Steps` step 2).

1. **Explicit `fitOnLoad: true`, sized before the layout lands, fits.** The transform's zoom is 3.478… and its pan is (361.739…, 0) — identical to what `zoomToFit()` produces on the same fixture, and identical to the default-opening test updated in step 2 (line 668). Pinning it with the option stated explicitly, independent of the default's own resolution, protects against a future change to how the default is implemented silently breaking this contract.
2. **The default opening matches `zoomToFit()`'s own output.** A second view built with no `fitOnLoad` key, sized before the layout lands like case 1, relies on the new default. Before any explicit call, its post-layout transform already equals case 1's numbers; an explicit `zoomToFit()` call afterward changes nothing (the fit is idempotent). This is the plan's headline claim, pinned directly rather than by comparing hand-computed literals.
3. **`fitOnLoad: true` overrides a configured `zoom`.** Built with `{ fitOnLoad: true, zoom: 2 }`, sized before the layout lands, the first centring lands at zoom 3.478…, not 2.
4. **`fitOnLoad: false` restores the pre-this-plan opening.** Built with `{ fitOnLoad: false }` and no other option, sized before the layout lands, the transform is `translate(560px, 285px) scale(1)` — the exact opening every `DiagramView` had before this plan.
5. **`initialFocusNode` wins over an explicit `fitOnLoad: true`.** Built with `{ fitOnLoad: true, initialFocusNode: 'a' }`, the transform is `translate(600px, 365px) scale(1)` — the focus node's own centring at zoom 1, unchanged from the existing test at line 1743.
6. **A `focusNode` call before the first centring also wins.** On an unsized view (no `fitOnLoad` key), `focusNode('b')` then mount + size + `doLayout()` gives `translate(510px, 185px) scale(1)`, and `view._hasCentredOnce` is then `true`. Focus resolution runs before the fit-vs-hold decision, so this is unaffected by the default either way.
7. **`fitOnLoad` is one-shot across a later `setData`.** After case 1, a `setData(simpleGraph())` whose layout resolves to `fixedResult()` again leaves the fitted transform from case 1 untouched — no second fit, no re-centring.
8. **A user pan survives a later `setData`.** After case 1, writing `view._panX = 99; view._panY = 77; view.applyTransformToHost();` and then running a `setData` that stays on screen leaves the pan at (99, 77) — the zoom stays at case 1's fit value, since the manual override never touches it.
9. **The off-screen floor recovers by holding the fit zoom, not re-fitting.** Built with `{ fitOnLoad: true }`, sized before the first layout lands, using a locally-defined two-call stub (see step 4) whose second layout resolves to `offScreenResult()`: after the first layout, `view.getZoom()` is the fit zoom (≈3.478…); after the second, `view.getZoom()` is unchanged from that value, and the pan equals `(1280 − 80000 × zoom) / 2` and `(800 − 40000 × zoom) / 2`, computed in the test from that same `view.getZoom()` rather than a hardcoded literal.
10. **`resetView()` never fits.** After case 1, `view.resetView()` gives `translate(560px, 285px) scale(1)` and `view.getZoom()` is `1`.
11. **`resetView()` before the view has ever centred still never fits.** On an unsized `fitOnLoad: true` view whose layout has landed, `view.resetView()` sets `view._hasCentredOnce` to `true` immediately and leaves `view._needsInitialCentre` `true`; after mounting, sizing, and one `doLayout()`, the transform is `translate(560px, 285px) scale(1)` at zoom 1 — the deferred retry honours Reset's zoom, not the fit.
12. **A first layout that itself lands off screen still fits.** A `fitOnLoad: true` view sized to 1280 × 800 whose *first* layout resolves to `offScreenResult()` (graph 80000 × 40000, nodes at 40000, 20000) parses to zoom 0.016 with pan (0, 80) — both exact (no `toBeCloseTo` needed here: `1280 / 80000` and `800 / 40000` both terminate). The floor's re-arm cannot un-spend a one-shot that was never spent.
13. **`_hasCentredOnce` is set by a non-fitting centring too.** Built with `{ fitOnLoad: false }`, `view._hasCentredOnce` is `false` before the first layout and `true` after it settles on a sized view — the flag tracks "has centred", not "has fitted".

### Pre-existing tests requiring an edit — summary

- **Six recomputed** (their assertion assumed "hold zoom", now wrong): lines 668, 697, 719, 747, 1776, 1787 — see step 2.
- **Eleven isolated with `fitOnLoad: false`** (their setup, not their point, assumed "hold zoom"): lines 682, 789, 822, 836, 850, 866, 880, 896, 1821, 3225, 3642 — see step 3.
- **Every other pre-existing test in the file is unaffected**, including: the two `zoomToFit` tests (580, 599; the second stays unsized throughout, the first calls `zoomToFit()` explicitly, whose recomputation is idempotent whether or not an automatic fit already ran); the three `resetView` tests (617, 632, 644; `resetView` always forces `_hasCentredOnce` before re-centring, so it never takes the fit branch regardless of the default — the third test's drag-then-reset math depends on the pan being exactly (0, 0) *before* the drag begins, which it is, because `setSize` alone — with no subsequent `doLayout()` — never triggers the automatic centring); the five in the `resetView`-targets-focus block (2610, 2629, 2666, 2696, 2718; every one either sets `initialFocusNode` or never reaches a sized+laid-out state before `resetView` is called); the one remaining off-screen-floor test not listed above (805, whose focus node wins regardless — the block's other seven are all in the isolated list); the four remaining focus-node tests not listed above (1743, 1755, 1798, 1832 — the block's other three, 1776, 1787, and 1818, are in the recomputed and isolated lists respectively); and the "centring a node fits it in the viewport" block (2731–2815), the "viewport resize" block (923–987, which measures relative graph-point equality, not absolute pixels), the busy-indicator block, the incoming-nodes block, and the rest of the node/edge-virtualization and level-of-detail blocks — all either use `initialFocusNode`, stay unsized throughout, or assert set membership / relative deltas rather than an absolute pixel value tied to zoom 1.

### §B — in the demo app (**manual**)

14. **manual** — see `## Ordered Implementation Steps` step 13.

---

## Verification

Run from the repository root unless stated otherwise.

- `npm run typecheck` — clean.
- `npm test` — the whole suite green, including the six recomputed and eleven isolated pre-existing tests from steps 2–3 and the new block from step 4.
- `npm run lint` — clean; the ESLint baseline must not grow.
- `npm run docs:api` — finishes with zero warnings (required by [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) after touching public JSDoc; the new option's `{@link}` targets are the public `DiagramView.zoomToFit` and `DiagramViewOptions.initialFocusNode`, both documented, so neither trips the "links to an excluded symbol" warning).
- `grep -n 'this._hasCentredOnce' packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` — expect exactly three matches: the read and the write in `tryInitialCentre`, and the write in `resetView`. A fourth means something else is driving the one-shot.
- `grep -n 'Math.min(zoomX, zoomY)' packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` — expect exactly one match, inside `fitGraph`. The fit arithmetic must exist in one place.
- `grep -rn 'fitOnLoad' packages/lib/src/typescript/lib/component/diagram/DiagramView.ts` — the option must appear in exactly three code positions: the interface field, the `applyOptions` cache, and the `tryInitialCentre` read (`this._options.fitOnLoad ?? true`; JSDoc mentions aside). No setter, no getter, no `DEFAULT_FIT_ON_LOAD` constant (see `## Architecture Decisions` → "The default lives as a bare literal").
- `grep -c 'fitOnLoad: false' packages/lib/tests/component/diagram/DiagramView.test.ts` — expect exactly 13: the eleven pre-existing-test isolations from the step 3 table, plus the two in the new dedicated block (`## Expected Behaviour` §A cases 4 and 13).
- Manual, per `## Expected Behaviour` §B.

---

## Documentation Impact

- **[`packages/lib/docs/components/DiagramView.md`](packages/lib/docs/components/DiagramView.md)** — the **Initial view** bullet (line 131) is rewritten to describe the new default and its opt-out, not an opt-in. That bullet is the only place the initial-centring contract is described; `## Common methods` (lines 103–127) needs no row, since no method is added or changed.
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — one bullet under `## Breaking changes` → `### Components` (line 30), not `## Added` — this changes default behaviour for any consumer that does not opt out.
- **No export or barrel change.** `fitOnLoad` is a field on the already-exported `DiagramViewOptions`; `_hasCentredOnce` and `fitGraph` are private and never reach TypeDoc.
- **No `llms.txt` change.** That file is generated by `npm run docs:llms` and does not mention `DiagramView` at all.

---

## Potential Challenges

- **Every existing consumer that passes an explicit `zoom` without also passing `fitOnLoad: false` now has that zoom silently overridden on the first load.** This is the core breaking change this plan makes — see the changelog bullet (step 11) and the docs bullet (step 10) for the migration path. It is deliberate: [^consumer-evidence] found no consumer that wants the old opening.
- **The fit lands on whichever graph is current when the first centring succeeds.** A view that is sized only after several `setData` passes fits the graph it can finally see, not the first one it was given. That is the same rule the existing initial centring already follows, and it is the first placement the user actually sees.
- **A consumer using the documented `view.on('layout', () => view.zoomToFit())` recipe now fits twice on the first pass by default**, not only when opting in to `fitOnLoad`. Both produce the same numbers, so the result is correct and only the work is duplicated; the docs bullet points out that the option covers the first render and the listener covers every render, so a consumer relying only on the option can drop the listener if it exists solely for the first render.
- **The fit zoom is a repeating fraction, and this now applies to most default-opening assertions, not just explicit `zoomToFit()` calls.** Any test asserting a *default* view's opening transform — not only one that explicitly requests a fit — must parse the transform and use `toBeCloseTo`; a literal string comparison will be brittle. This is why six pre-existing tests in step 2 needed recomputing, not just the new cases in step 4.
- **A graph that auto-fits to a very different scale on first load, then has `focusNode`/`revealNode` called on a small node afterward, stays at the graph's fit zoom rather than zooming back in.** `zoomFittingNode` (line 1360) only ever *lowers* the current zoom to fit a node, never raises it — a pre-existing rule, unchanged by this plan — so once the default fit has zoomed far out for a large or widely-spread graph, a later explicit centring on a small node no longer zooms back in on its own. This is why the `focusNode mounts its target` and `at zoom 1 …` tests in step 3 needed `fitOnLoad: false`: without it, their small-node/zoom-1 assumptions broke against the graph-spanning fixtures those tests use.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/diagram/DiagramView.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramView.ts) — read, in this order: the `initialFocusNode` option (250), the constructor defaults bag (430–433), `applyOptions` (542–568), `applyLayout`'s centring calls (875–881), `zoomToFit` (1129), `resetView` (1153), `rearmCentreIfOffScreen` (1197), `tryInitialCentre` (1233), `centreGraph` (1258), `zoomFittingNode` (1360), `centreNode` (1508), `focusNode` (1551), `doLayout` (1664), `buildControls`' Fit and Reset buttons (2133–2134), and `isSimplifyAtLowZoom` (2193) as the contrasting option shape that *does* get an accessor pair and a class default.
- [`packages/lib/tests/component/diagram/DiagramView.test.ts`](packages/lib/tests/component/diagram/DiagramView.test.ts) — the fixtures block (80–171), the `zoomToFit` block (579), the `resetView` block (616), the initial-view block (667), the off-screen-floor block (767) with its `twoCallStub` helper (773, out of scope for the new block placed before it), the focus-node block (1742), the `resetView`-targets-focus block (2609), the `farGraph`/`farResult` fixtures (3072–3117) and node-virtualization block (3119) used by the `focusNode mounts its target` fix in step 3, and the `gridGraph`/LOD block (3572–4012) used by the `at zoom 1 …` fix in the same step.
- [`plans/implemented/diagram-recentre-on-rescale.md`](plans/implemented/diagram-recentre-on-rescale.md) — the off-screen floor's own reasoning, in particular its "no auto-fit" non-goal, which this plan keeps intact for the floor while making the first-load fit the default.
- [`packages/lib/src/typescript/lib/core/Component.ts:6793`](packages/lib/src/typescript/lib/core/Component.ts#L6793) — `onFirstLayout` and its drain at line 6817: the library's existing "spend a one-shot only on a pass that actually did the work" mechanism, which `_hasCentredOnce` mirrors.
- [`packages/lib/docs/components/DiagramView.md:131`](packages/lib/docs/components/DiagramView.md#L131) — the **Initial view** bullet to rewrite.
- [`packages/lib/docs/reference/changelog/next.md:30`](packages/lib/docs/reference/changelog/next.md#L30) — the `## Breaking changes` → `### Components` section, and its existing table-body-class bullet, whose shape (bold lead, mechanism, explicit migration instruction) the new bullet mirrors.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) (*Three non-negotiable rules for every DOM write*, *Class-level defaults must survive the getter*) and [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) (the `declare` rule for fields written during `super()`) — both bear on how the new option and field are declared.

---

## Non-Goals

- **No sqladmin change required to benefit.** sqladmin's `DiagramShell` (`frontend/src/dock/diagramShell.ts` in the sibling repository) currently works around this exact gap: its constructor calls `view.onFirstLayout(() => this.settleViewport())`, and `settleViewport()` calls `view.zoomToFit()` when the panel has no root, or `view.focusNode(root)` when it does. Once this ships and sqladmin upgrades its dependency, the no-root half of that call already happens automatically — the default already fits, so sqladmin does not need to pass `fitOnLoad` at all. Whether to trim the now-redundant `onFirstLayout` call itself, and whether the rooted case wants the same treatment, is a judgement about that app's panels, made in that repository against its own tests, and is not planned here.[^sqladmin-partial]
- **No `setFitOnLoad` / `isFitOnLoad` pair.** The option is spent by the first centring; `zoomToFit()` is already the runtime equivalent.
- **No change to `zoomToFit`'s observable behaviour.** Only its body moves.
- **No change to the off-screen re-centring floor.** It keeps centring at the current zoom, on every graph swap, whatever `fitOnLoad` is set to.
- **No fit on later layouts.** `fitOnLoad` is not an auto-fit mode; fitting after every pass stays the documented `view.on('layout', () => view.zoomToFit())` recipe.
- **The default changes existing behaviour, deliberately.** `fitOnLoad` does not default to a value that leaves every existing consumer's opening view byte-for-byte unchanged — it defaults to `true` because every known consumer already wants the fitted opening[^consumer-evidence]. A consumer that genuinely wants the old "hold the configured zoom" opening states that explicitly with `fitOnLoad: false`.

---

## Notes

[^consumer-evidence]: Every `DiagramView` in the sibling sqladmin repository is built through one shared base class, `frontend/src/dock/diagramShell.ts`, and on its `feature/diagram-recentre-settleviewport` branch that constructor ends with `view.onFirstLayout(() => this.settleViewport())` — a hand-rolled fit-on-first-layout. Its commit message records why the app reached for it: "every diagram tab opened small and adrift in a mostly-empty canvas until a later gesture (or a manual Fit to view) ran settleViewport() for the first time". The library's own demo app (`packages/lib/src/typescript/DiagramPanel.ts`) shows the identical gap: its sample diagram opens at zoom 1 in a corner of empty canvas until Fit to view is clicked by hand. With every known consumer independently reaching for the same fix, an opt-in option would just relocate the workaround from the app to the app's construction call — every consumer would still write `fitOnLoad: true` on every `DiagramView` it builds. Defaulting to `true` removes that universal boilerplate; a consumer that genuinely wants the old opening (none exists today) writes the one-line opt-out instead.

[^two-flags]: Re-using `_needsInitialCentre` alone cannot express "first ever". It is a *pending request*, legitimately re-armed by `resetView`, `focusNode`, and `rearmCentreIfOffScreen`, so a fit branch keyed to it would fire again on every one of those paths. The `resetView` case is the damaging one: it calls `setZoom(default)` and then `tryInitialCentre()` on the very next line, so a fit keyed to the pending flag would immediately discard the zoom `resetView` had just restored — making the toolbar's **Reset view** button behave identically to its **Fit to view** button for as long as the fit branch could run. A second flag that is only ever set, never cleared, is the smallest thing that separates "owed a centring" from "has never centred".

[^reset-forces]: Forcing the flag inside `resetView` rather than relying on the first centring having already happened makes the outcome independent of timing. `resetView()` is reachable before any centring has succeeded — the existing test at line 2696 does exactly that on an unsized view, and the pending centring is then retried from a later `doLayout`. Without the forced write, that retry would take the fit branch and silently override the default zoom `resetView` had restored, which is the same collapse of the two controls described above, just deferred by one layout pass. This reasoning, and the fix, do not depend on which way `fitOnLoad` defaults — only on whether the fit branch *can* run at all, which `_hasCentredOnce` forecloses either way.

[^focus-wins]: The focus branch already does what fit-on-load is for: `centreNode` resolves its zoom through `zoomFittingNode`, which lowers the zoom until the node's whole box fits and never raises it. Fitting the whole graph instead would contradict the point of naming a focus node. This also matches how the app-level workaround behaves — sqladmin's `settleViewport` fits the whole graph only when there is no root, and calls `focusNode(root)` otherwise.

[^floor-unchanged]: The off-screen floor exists to replace a blank canvas, and its own plan rejected fitting for that recovery on the grounds that a fit would silently discard the consumer's configured zoom. Gating the fit branch on `_hasCentredOnce` keeps that rejection intact without a special case: by the time the floor can fire, the first centring has already happened, so the flag is `true` and the fit branch is unreachable. The floor stays a floor — it now most often holds a *fit* zoom rather than the configured one, since the first load fits by default, but it still never re-fits on its own.

[^extract-fit]: The alternative was to duplicate the two divisions and the `Math.min` in `tryInitialCentre`. Sharing them costs one small private method and removes the possibility of the "opens fitted" path drifting from what the Fit control does — which would be a subtle and hard-to-spot defect, since both paths look right in isolation. Returning a boolean rather than `this` is what lets the shared helper slot into `tryInitialCentre`'s existing success-gated shape, where a centring that silently no-opped must leave the pending flag armed for a later retry; `centreGraph` and `centreNode` already return booleans for exactly that reason.

[^guard-verbatim]: `zoomToFit`'s guard is `this._graphWidth <= 0 || this._graphHeight <= 0`, which is looser than the `!(x > 0)` form its neighbours (`centreGraph`, `effectiveMinZoom`, `zoomFittingNode`) use — the difference shows only for a `NaN` graph extent, which ELK never produces. Tightening it would be an unrelated improvement to adjacent code, which [CLAUDE.md](CLAUDE.md) §3 rules out, and it would give the extraction a behaviour delta to argue about. It is moved verbatim instead. The new call site is unaffected either way, because `tryInitialCentre` already applies the tighter test before dispatching.

[^no-accessors]: The class has both shapes. `simplifyAtLowZoom` carries a class default, a folding `isSimplifyAtLowZoom()` getter, a `setSimplifyAtLowZoom()` setter that re-runs the residency pass, and a row in the default-resolution registry — because it governs an ongoing rendering decision that a consumer can sensibly flip mid-life. `initialFocusNode` carries none of that: it is cached in `applyOptions`, dispatched once into `_focusNodeId` from the constructor body, and its runtime counterpart is the `focusNode(id)` method. `fitOnLoad` is the second kind. A `setFitOnLoad(true)` call after the first centring would do nothing at all, and one before it would be a slower way of writing `zoomToFit()`; per [CLAUDE.md](CLAUDE.md) §2, configurability that was not asked for does not get added.

[^bare-literal]: The file's only precedent for a top-level `DEFAULT_*` constant is numeric and multi-site: `DEFAULT_ZOOM` / `DEFAULT_MIN_ZOOM` / `DEFAULT_MAX_ZOOM` each appear in the constructor's defaults bag *and* in a folding getter *and* (for `DEFAULT_ZOOM`) in `resetView` — three call sites apiece, where naming the literal also documents what an otherwise-bare `1` / `0.25` / `4` means. No boolean option in this file gets a top-level constant: `controls` and `simplifyAtLowZoom` both resolve their `true` default as a bare literal inside a folding getter (`isControlsVisible`, `isSimplifyAtLowZoom`), and neither has a module-level `DEFAULT_CONTROLS` / `DEFAULT_SIMPLIFY_AT_LOW_ZOOM` alongside it. `fitOnLoad` has no getter and no defaults-bag entry at all (see "No accessor pair for the new option"), so `?? true` appears at exactly one call site, `tryInitialCentre`. Introducing a constant used exactly once would be the file's first instance of that pattern, contradicting the precedent search this plan is required to run (`../_shared/pattern-conformance.md`), and CLAUDE.md §2 rules out configurability or abstraction beyond what a single call site needs. The option's own JSDoc already states "(default `true`)" at its declaration, which is where a reader already looks for a `DiagramViewOptions` field's default — matching every other field in the interface.

[^sqladmin-partial]: The redundancy is partial, not total. `DiagramShell.settleViewport()` also runs after every control gesture (root selection, Mode, Direction, Depth, prune), and its rooted branch calls `focusNode(root)`, neither of which this option touches. What the new default replaces is the single `onFirstLayout` call in the shell's constructor, and only for a panel that has no root at that moment. Whether removing it is worth it — and whether the rooted case wants the same treatment — is a judgement about that app's panels, made in that repository against its own tests.

[^precedent-search]: The precedent search for an existing "true first ever" versus "re-armed later" distinction found no pair anywhere in the library. What it found are three single-flag shapes this design stays inside: `DiagramView._needsInitialCentre` itself and `TabBar._scrollToSelected` (`TabBar.ts:552`, consumed by `revealSelectedIfRequested` at 2594) are both re-armable pending requests cleared only by a pass that actually did the work; `Component._firstLayoutCallbacks` (`Component.ts:417`, drained at 6817) is a genuine never-re-armed one-shot, nulled by the first *connected* layout and left intact by a layout that ran too early. `_hasCentredOnce` is the second instance of that last shape, written in the same idiom as the first: a private boolean with a plain initializer, a JSDoc block naming every writer, and no clearing path. Since no existing pair prescribes a naming convention for the combination, the field's name follows its neighbour `_needsInitialCentre` — a `_`-prefixed predicate that reads as the question it answers.

[^focusnode-zoom-floor]: Two different mechanisms are at work here. First, several off-screen-floor tests hardcode a pixel-space fixture against the pre-existing zoom-1 opening — `edgeTouchingResult()`, for instance, places a node so its edge lands exactly on the viewport's right edge *at zoom 1*; at the new default's fit zoom that same node lands nowhere near the edge, inverting what the test means to exercise. Second, `zoomFittingNode` (line 1360) resolves its zoom from `this.getZoom()` — whatever zoom is currently in effect — and only ever lowers it, never raises it. This is why `focusNode mounts its target` and `at zoom 1 …` specifically break: both use a graph fixture spread far wider than the viewport (`farGraph()` / a 220-node grid), so the default fit zooms out much further than 1 on first load, and the later explicit `focusNode`/zoom-1 assumption in each test then observes that far-out zoom instead of the value the test was written against. `fitOnLoad: false` keeps every one of the eleven tests' scaffolding at zoom 1, as originally written, regardless of which of the two mechanisms would otherwise have disturbed it.

---

## Implementation Notes

- **Step 13's manual demo check was performed and passed**, driving the actual
  `npm run dev` demo app (the **Diagram** section) through `chrome-devtools`
  browser automation rather than by hand, since the harness has no automated
  substitute for visual/gesture verification (see `implement/worker.md`'s
  test-first escape hatch). All four outcomes matched the plan: (1) the
  diagram opened filled to the viewport at the fitted zoom, not at 1× in a
  corner of empty canvas; (2) clicking **Reset view** returned it to 1×,
  centred, without re-fitting; (3) clicking **Fit to view** afterward
  returned it to the same fitted opening scale as (1); (4) temporarily
  changing `DiagramPanel.ts:80` to `new DiagramView({ data: SAMPLE,
  fitOnLoad: false })` and reloading opened the diagram at 1× centred (the
  pre-this-plan opening) instead of fitted. The temporary edit was reverted
  and confirmed via `git status` to leave `DiagramPanel.ts` unchanged.
