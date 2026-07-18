---
touches-shared:
  - src/typescript/lib/core/Component.ts
---

# Canvas Pause-When-Hidden — Implementation Plan

## Overview

`WebGLCanvas` and `Canvas` each run a per-frame `requestAnimationFrame` render loop that never stops until teardown. `WebGLCanvas` auto-starts its loop on the first connected layout ([WebGLCanvas.ts:344](src/typescript/lib/component/display/WebGLCanvas.ts#L344), `onFirstLayout(() => this.startAnimation())`) and only stops in `destructor()` ([WebGLCanvas.ts:353](src/typescript/lib/component/display/WebGLCanvas.ts#L353)). `Canvas` does not auto-start — a consumer drives it via `startAnimation()` ([Canvas.ts:185](src/typescript/lib/component/display/Canvas.ts#L185)) — but once running it too never stops until teardown. Because a `Tab` keeps inactive panels mounted (it hides them with `component.setVisible(false)`, [Tab.ts:1581](src/typescript/lib/layout/Tab.ts#L1581), which keeps the layout slot), a canvas on a hidden tab keeps burning ~60fps forever. Confirmed live: the loop's `step`/`renderFrame` keeps scheduling `requestAnimationFrame` while the user is on a different, static tab.

The fix makes the render loop **pause by default whenever the component is not effectively on-screen**, with a per-instance opt-out (`animateWhenHidden`, default `false`) that keeps it running regardless. The two canvases share no base class today — they deliberately **mirror** each other (the JSDoc calls out "mirrors the 2D sibling" / "shared with the WebGL sibling"), each holding its own copy of `_rafId` / `startAnimation` / `stopAnimation` / `isAnimating` / `syncBackingStore` / DPR watch. This plan follows that established mirror pattern: the identical animation-lifecycle members are added to both classes, and the one genuinely shared computation — "am I visible up the whole ancestor chain?" — is hoisted to `Component` so it cannot diverge. `Component.ts` is the only shared file, coordinated below with the concurrent `theme-listener-teardown-leak.md` plan.

---

## Architecture Decisions

### The signal is effective **visibility** (ancestor-walk), not `isDisplayed()`

The task framing calls this the "displayed set", but the framework has no ancestor-aware displayed set and no enter/leave hook. `Component.isDisplayed()` ([Component.ts:1552](src/typescript/lib/core/Component.ts#L1552)) is the component's **own** `display:none` flag only; `getLaidOutComponents()` filters children by that flag, not by ancestor state. Crucially, `Tab` and `Card` hide inactive panels with `setVisible(false)` (CSS `visibility:hidden`, [Tab.ts:1581](src/typescript/lib/layout/Tab.ts#L1581) / [Card.ts:213](src/typescript/lib/layout/Card.ts#L213)) — **not** `setDisplayed(false)` — precisely so the slot is kept and siblings don't reflow. So a hidden-tab canvas is effectively hidden via an **ancestor's** `isVisible() === false`, while its own `isVisible()` is `null` (inherit) and its own `isDisplayed()` is `true`. The correct predicate therefore walks the parent chain checking both `isVisible()` and `isDisplayed()`. A new `protected Component.isEffectivelyVisible()` owns this walk (details in _Public API_).

### No push hook — pause is polled in the loop, resume is reconciled in `doLayout`

There is no existing "visibility changed" notification, and adding a general subtree-visibility broadcast to `setVisible` would be a large framework feature beyond this request (Simplicity First). Two asymmetric facts make a hook unnecessary:

- **Resume is reliable via `doLayout`.** When a tab is re-activated, `Tab` calls `placeComponent` → `commitBounds`, which calls `component.doLayout()` **unconditionally** ([LayoutManager.ts:460](src/typescript/lib/layout/LayoutManager.ts#L460)) regardless of whether bounds changed, and that recurses into the canvas's `doLayout`. So the canvas's `doLayout` is a dependable "I am being shown" signal.
- **Pause cannot use `doLayout`.** `Tab` lays out only the **active** panel ([Tab.ts:1696-1719](src/typescript/lib/layout/Tab.ts#L1696)); the outgoing panel gets `setVisible(false)` but **no** `doLayout`. The only code that keeps running for a just-hidden canvas is its own rAF loop — so the loop itself must be the pause trigger.

Design: every loop tick and every `doLayout`/`startAnimation`/`stopAnimation`/`setAnimateWhenHidden` funnels through one predicate `shouldAnimate()` and one `reconcileAnimation()`. The loop tick self-pauses (nulls `_rafId`, returns without re-arming) when `shouldAnimate()` is false; `doLayout` calls `reconcileAnimation()` to restart when the surface reappears. This mirrors the framework's existing "recompute derived state on the layout pass" habit (`syncBackingStore` is already called from `doLayout`).

### Intent (`_animationRequested`) is separated from actual running (`_rafId`)

Manual `startAnimation()`/`stopAnimation()` must keep working and take precedence. Model the consumer's/auto **intent** to animate in a new `_animationRequested` boolean, separate from whether the loop is physically scheduled (`_rafId`). The loop runs iff `shouldAnimate() === _animationRequested && (getAnimateWhenHidden() || isEffectivelyVisible())`.

- `startAnimation()` sets `_animationRequested = true` then reconciles; `stopAnimation()` sets it `false` then reconciles. Their public signatures and their observable effect while visible are unchanged, so existing tests stay green.
- **Precedence:** a manual `stopAnimation()` clears intent, so an auto-pause can never resurrect it. A manual `startAnimation()` while hidden records intent and begins on next show. `animateWhenHidden` short-circuits the visibility term. This cleanly resolves every case in _Expected Behaviour_ without a separate "was auto-paused" flag.
- `isAnimating()` stays `_rafId !== null` (its documented meaning, "the loop is currently running") — so while auto-paused it correctly reports `false`.

Rejected: a `_pausedByVisibility` boolean that wraps `startAnimation`/`stopAnimation`. It needs an internal-vs-manual carve-out (auto-pause must not clear its own flag) and mishandles "consumer stops while hidden". The intent/actual split is smaller and total.

### Mirror the lifecycle into both classes; do not extract a base

The two canvases already duplicate their rAF members by deliberate convention. Introducing an `AbstractCanvas` base now would relocate `syncBackingStore`, the DPR watch, exports, and the class hierarchy — a refactor far wider than this feature (Surgical Changes) — and the two loop bodies still differ (`renderFrame()` paints GL vs `redraw()` paints 2D). So the added members are **byte-identical** across both files except the single paint call inside the loop tick, and the one shared computation lives once on `Component`. Precedent: the existing mirrored `startAnimation`/`stopAnimation`/`isAnimating`/`syncBackingStore` pairs across [Canvas.ts](src/typescript/lib/component/display/Canvas.ts) and [WebGLCanvas.ts](src/typescript/lib/component/display/WebGLCanvas.ts).

### Coordination with `theme-listener-teardown-leak.md` (shared `Component.ts`)

That plan adds `subscribeTheme` + a `_themeCleanups` bag and makes `Component.destructor()` **recurse into `_components`**. This plan's only `Component.ts` change is adding a new read-only method `isEffectivelyVisible()` — no field, no `destructor` edit, no overlap. The two compose cleanly. Their destructor recursion is in fact **beneficial** here: once it lands, a closing `Window` reaches each descendant canvas's `destructor()`, which already stops the loop before `super.destructor()` — no change needed on this side.

---

## Public API

New consumer-visible members on **both** `CanvasOptions` / `Canvas` and `WebGLCanvasOptions` / `WebGLCanvas`:

```typescript
// XOptions bag — consumer-configurable, default false (pause when hidden).
animateWhenHidden?: boolean;

// Runtime setter/getter (options bag is the cache, per the typed-setter rule).
setAnimateWhenHidden(value: boolean): this;   // caches, then reconcileAnimation()
getAnimateWhenHidden(): boolean;              // this._options.animateWhenHidden ?? false
```

New method on `Component` (subclass-only, excluded from docs):

```typescript
// core/Component.ts
protected isEffectivelyVisible(): boolean;
```

Body (walks self + ancestors; any explicitly-hidden or undisplayed node ⇒ not visible):

```typescript
protected isEffectivelyVisible(): boolean {
    let node: Component | null = this;
    while (node) {
        if (node.isVisible() === false || !node.isDisplayed()) {
            return false;
        }
        node = node.getParentComponent();
    }
    return true;
}
```

`isVisible()` is tri-state (`boolean | null`, [Component.ts:1433](src/typescript/lib/core/Component.ts#L1433)); only an explicit `false` hides, `null`/`true` inherit. `isDisplayed()` defaults `true` ([Component.ts:1552](src/typescript/lib/core/Component.ts#L1552)). `getParentComponent()` is public ([Component.ts:4292](src/typescript/lib/core/Component.ts#L4292)).

No signature change to `startAnimation()` / `stopAnimation()` / `isAnimating()`.

---

## Internal Structure

The animation-lifecycle members added to **each** canvas. Identical in both classes **except** the marked paint call.

```typescript
/** Consumer/auto intent to animate; the loop actually runs only while also
 *  effectively visible (or animateWhenHidden is set). Plain initializer: never
 *  written during the super() cascade (only startAnimation/stopAnimation, which
 *  run post-render, write it), so it needs no `declare`. */
private _animationRequested = false;

/** Whether the loop should be scheduled right now. */
private shouldAnimate(): boolean {
    return this._animationRequested
        && (this.getAnimateWhenHidden() || this.isEffectivelyVisible());
}

/** Brings the raw rAF loop into agreement with shouldAnimate(). Idempotent —
 *  safe to call every doLayout and from the option setter. A no-op during the
 *  construction cascade because _animationRequested is still false. */
private reconcileAnimation(): void {
    if (this.shouldAnimate()) {
        if (this._rafId === null) {
            this._rafId = DOM.sink.requestAnimationFrame(this.animationStep);
        }
    } else if (this._rafId !== null) {
        DOM.sink.cancelAnimationFrame(this._rafId);
        this._rafId = null;
    }
}

/** One loop tick. Self-pauses when it should no longer animate — the ONLY
 *  signal a hidden-tab surface receives, because Tab does not lay out an
 *  inactive panel. Arrow field so the rAF callback keeps a stable bound ref. */
private readonly animationStep = (): void => {
    if (!this.shouldAnimate()) {
        this._rafId = null;
        return;
    }
    this.renderFrame();   // WebGLCanvas: this.renderFrame();  |  Canvas: this.redraw();
    this._rafId = DOM.sink.requestAnimationFrame(this.animationStep);
};

startAnimation(): this {
    this._animationRequested = true;
    this.reconcileAnimation();
    return this;
}

stopAnimation(): this {
    this._animationRequested = false;
    this.reconcileAnimation();
    return this;
}

setAnimateWhenHidden(value: boolean): this {
    this._options.animateWhenHidden = value;
    this.reconcileAnimation();
    return this;
}

getAnimateWhenHidden(): boolean {
    return this._options.animateWhenHidden ?? false;
}
```

`isAnimating()` is unchanged (`return this._rafId !== null;`). In `doLayout`, add `this.reconcileAnimation();` as the last statement (after `syncBackingStore()`).

`WebGLCanvas` keeps its existing private `renderFrame()` (paints one GL frame). `Canvas`'s loop paints via `this.redraw()` (already public), so `Canvas`'s **old self-rescheduling `renderFrame()`** ([Canvas.ts:301](src/typescript/lib/component/display/Canvas.ts#L301)) is removed (its reschedule role moves into `animationStep`; nothing else calls it).

---

## Ordered Implementation Steps

1. **`core/Component.ts` — add `isEffectivelyVisible()`.** Insert the `protected isEffectivelyVisible()` method (body in _Public API_) near `isDisplayed()` (~[L1552](src/typescript/lib/core/Component.ts#L1552)). Verify: `npm run typecheck` clean.

2. **`component/display/Canvas.ts` — options + intent field.** Add `animateWhenHidden?: boolean` to `CanvasOptions` (with JSDoc). Add `private _animationRequested = false;` beside `_rafId`. In `applyOptions`, after the `onDraw` block, add:
   ```typescript
   if (options.animateWhenHidden !== undefined) {
       this.setAnimateWhenHidden(options.animateWhenHidden);
   }
   ```

3. **`component/display/Canvas.ts` — lifecycle.** Add `shouldAnimate()`, `reconcileAnimation()`, the `animationStep` arrow field (paint = `this.redraw()`), `setAnimateWhenHidden`, `getAnimateWhenHidden` (bodies in _Internal Structure_). Rewrite `startAnimation`/`stopAnimation` to the intent+reconcile form. Add `this.reconcileAnimation();` as the last line of `doLayout` (after `syncBackingStore()`). **Delete** the old private `renderFrame()` ([Canvas.ts:301](src/typescript/lib/component/display/Canvas.ts#L301)). Leave `render()` unchanged (Canvas still does not auto-start). Verify: `npm run typecheck` clean.

4. **`component/display/WebGLCanvas.ts` — options + intent field.** Add `animateWhenHidden?: boolean` to `WebGLCanvasOptions` (with JSDoc). Add `private _animationRequested = false;` beside `_rafId`. In `applyOptions`, after the `onFrame` block, add the same `animateWhenHidden` forward as step 2.

5. **`component/display/WebGLCanvas.ts` — lifecycle.** Add the identical `shouldAnimate()`, `reconcileAnimation()`, `animationStep` arrow field (paint = `this.renderFrame()`), `setAnimateWhenHidden`, `getAnimateWhenHidden`. Rewrite `startAnimation`/`stopAnimation` to intent+reconcile, **removing** the local `step` closure. Add `this.reconcileAnimation();` as the last line of `doLayout`. Keep `render()`'s `onFirstLayout(() => this.startAnimation())` as-is — it now sets intent and reconciles (starts only if effectively visible / opt-out; otherwise begins on the show that lays it out). Keep the existing `renderFrame()`. Verify: `npm run typecheck` clean.

6. **Grep checkpoint.** `grep -n 'animateWhenHidden' src/typescript/lib/component/display/*.ts` — expect the option field, setter, getter, and applyOptions forward in **both** files. `grep -n 'reconcileAnimation' src/typescript/lib/component/display/*.ts` — expect it called from `startAnimation`, `stopAnimation`, `setAnimateWhenHidden`, and `doLayout` in both.

7. **Tests.** Add the P-series (below) to `tests/component/display/Canvas.test.ts` and `tests/component/display/WebGLCanvas.test.ts`, mirrored. Confirm the existing U5/U6 animation tests still pass unchanged.

8. **Docs.** Update `docs/components/Canvas.md` and `docs/components/WebGLCanvas.md` per _Documentation Impact_. Run `npm run docs:build` — zero warnings.

9. **Verify:** `npm run typecheck`, full unit suite, `npm run build:lib`, then the live M-series probe.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | src/typescript/lib/core/Component.ts (add `isEffectivelyVisible()`; shared with `theme-listener-teardown-leak.md`) |
| Modify | src/typescript/lib/component/display/Canvas.ts |
| Modify | src/typescript/lib/component/display/WebGLCanvas.ts |
| Modify | tests/component/display/Canvas.test.ts |
| Modify | tests/component/display/WebGLCanvas.test.ts |
| Modify | docs/components/Canvas.md |
| Modify | docs/components/WebGLCanvas.md |

---

## Expected Behaviour

Cases apply to **both** `Canvas` and `WebGLCanvas`. Offline, the modelled sink's `requestAnimationFrame` records the call and returns a handle but does **not** invoke the callback, so `isAnimating()` (i.e. `_rafId !== null`) reflects the reconcile decision; the per-frame self-pause inside `animationStep` is exercised only live (M-series).

Unit-testable (offline):

1. **Option round-trip.** `new Canvas({ animateWhenHidden: true }).getAnimateWhenHidden()` is `true`; `new Canvas().getAnimateWhenHidden()` is `false`; `setAnimateWhenHidden(true)`/`(false)` read back.
2. **Visible surface animates.** A canvas with no hidden ancestor: `getElement(true); startAnimation()` ⇒ `isAnimating()` true, one `requestAnimationFrame` recorded. (Existing U5 — must stay green.)
3. **Hidden surface does not start (default).** `getElement(true); setVisible(false); startAnimation()` ⇒ `isAnimating()` false, zero `requestAnimationFrame` recorded (intent recorded, loop not scheduled).
4. **Hidden ancestor pauses.** Add the canvas to a `Component` container, `container.setVisible(false)`, then `canvas.startAnimation()` ⇒ `isAnimating()` false. Proves the ancestor walk (canvas's own `isVisible()` is `null`).
5. **Resume when shown.** From case 3, `setVisible(true)` then `doLayout()` (or a second `startAnimation()`) ⇒ `isAnimating()` true, a `requestAnimationFrame` now recorded.
6. **Opt-out keeps a hidden surface running.** `new Canvas({ animateWhenHidden: true }); getElement(true); setVisible(false); startAnimation()` ⇒ `isAnimating()` true.
7. **Manual stop wins.** Visible canvas: `startAnimation()` (running), `stopAnimation()` ⇒ `isAnimating()` false and one `cancelAnimationFrame` recorded; a subsequent `doLayout()` does **not** restart it (intent is cleared). (Existing U5 stop case — must stay green.)
8. **Static canvas stays static.** A canvas that never called `startAnimation()`: repeated `doLayout()` ⇒ `isAnimating()` stays false (reconcile never starts an unrequested loop).
9. **Destructor stops the loop.** Running canvas: `destructor()` ⇒ one `cancelAnimationFrame` recorded, `isAnimating()` false. (Existing U6 — must stay green.)

Manual / live-only (M-series):

- **M1 — pause on tab-away.** In the dev app Misc panel Canvas demo ([MiscPanel.ts:1507](src/typescript/MiscPanel.ts#L1507)), start the canvas animation, hook `requestAnimationFrame` (count callbacks from this surface), switch to a different top-level tab, and confirm this canvas's frame count drops to ~0 within a frame. Repeat hosting a `WebGLCanvas` in a `Tab`.
- **M2 — resume on tab-back.** Switch back to the Misc tab ⇒ frames resume.
- **M3 — opt-out overrides.** Construct the demo canvas with `animateWhenHidden: true`; switch away ⇒ frames continue.

---

## Verification

- **Typecheck:** `npm run typecheck` — clean.
- **Unit:** the P-series (Expected Behaviour 1, 3-6, 8) plus the retained U5/U6 (2, 7, 9) green in both `Canvas.test.ts` and `WebGLCanvas.test.ts`; full suite green.
- **Grep invariants:** the two greps in step 6.
- **Build:** `npm run build:lib` succeeds; `npm run docs:build` — zero warnings.
- **Live:** M1-M3 on `npm run dev` (http://localhost:8015), Misc panel Canvas demo, using the rAF-hook probe. This is the definitive proof the ~60fps leak on a hidden tab is gone and that the opt-out keeps it running.

---

## Documentation Impact

`setAnimateWhenHidden` / `getAnimateWhenHidden` and the `animateWhenHidden` option are consumer-visible on both `Canvas` and `WebGLCanvas` (exported via `component/display`). Add a JSDoc'd options field and setter/getter (the setter/getter JSDoc must not `{@link}` the `protected` `isEffectivelyVisible` — describe the "effectively on-screen" behaviour in prose). Update `docs/components/Canvas.md` and `docs/components/WebGLCanvas.md`: document the default pause-when-hidden behaviour and the `animateWhenHidden` opt-out in their options coverage, and adjust the existing "loop starts automatically / stops on teardown" wording to note it also pauses while hidden. `isEffectivelyVisible()` is `protected` and needs no doc entry. Run `npm run docs:build` (zero warnings).

---

## Potential Challenges

- **Per-frame ancestor walk.** While visible, `animationStep` calls `shouldAnimate()` → `isEffectivelyVisible()` every frame — an O(tree-depth) pointer walk of cheap boolean reads. Negligible at realistic depths; do not cache (a cache would need the very visibility-change notification we are avoiding).
- **Construction-cascade read of `_animationRequested`.** `applyOptions` → `setAnimateWhenHidden` → `reconcileAnimation` runs during `super()`, before the subclass `_animationRequested = false` initializer. It reads as `undefined` (falsy) ⇒ `shouldAnimate()` false ⇒ reconcile is a no-op; the post-`super()` initializer then sets the correct value. Nothing writes the field during the cascade, so a plain initializer is correct (no `declare` needed).
- **`animateWhenHidden` has no class-level default seed.** It is not placed in `_defaultCanvasOptions` / `_defaultWebGLCanvasOptions`; the `?? false` getter is the intrinsic fallback, so no row is required in `tests/component/default-options-fallback.test.ts`.
- **Resume depends on `commitBounds` calling `doLayout` unconditionally.** Verified at [LayoutManager.ts:460](src/typescript/lib/layout/LayoutManager.ts#L460); if a future layout change gates that call on a bounds delta, same-size re-activation would stop resuming — pin it with Expected Behaviour case 5.

---

## Critical Files

- [src/typescript/lib/component/display/Canvas.ts](src/typescript/lib/component/display/Canvas.ts) — 2D canvas; mirror target.
- [src/typescript/lib/component/display/WebGLCanvas.ts](src/typescript/lib/component/display/WebGLCanvas.ts) — GL canvas; auto-start at `onFirstLayout` ([L344](src/typescript/lib/component/display/WebGLCanvas.ts#L344)).
- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) — `isVisible()` ([L1433](src/typescript/lib/core/Component.ts#L1433)), `isDisplayed()` ([L1552](src/typescript/lib/core/Component.ts#L1552)), `getParentComponent()` ([L4292](src/typescript/lib/core/Component.ts#L4292)); shared with `theme-listener-teardown-leak.md`.
- [src/typescript/lib/layout/Tab.ts](src/typescript/lib/layout/Tab.ts) — hides inactive panels via `setVisible(false)` ([L1581](src/typescript/lib/layout/Tab.ts#L1581)), lays out only the active panel ([L1696-1719](src/typescript/lib/layout/Tab.ts#L1696)). Proves the pause signal cannot be `doLayout`.
- [src/typescript/lib/layout/LayoutManager.ts](src/typescript/lib/layout/LayoutManager.ts) — `commitBounds` calls `doLayout()` unconditionally ([L460](src/typescript/lib/layout/LayoutManager.ts#L460)); the resume path.
- [tests/component/display/Canvas.test.ts](tests/component/display/Canvas.test.ts) / [WebGLCanvas.test.ts](tests/component/display/WebGLCanvas.test.ts) — recorder-sink test pattern to extend.
- [src/typescript/MiscPanel.ts](src/typescript/MiscPanel.ts) — live Canvas demo (~[L1507](src/typescript/MiscPanel.ts#L1507)) for M-series.

---

## Non-Goals

- **Extracting a shared `AbstractCanvas` base.** The siblings mirror by established convention; a base is a wider refactor outside this feature (see _Architecture Decisions_).
- **A general subtree visibility-change notification on `Component.setVisible`.** Not needed: resume comes from `doLayout`, pause from the loop's own tick.
- **Pausing on browser page/document hidden.** The browser already throttles `requestAnimationFrame` when the whole page is hidden; this plan targets in-app hidden tabs.
- **Changing `startAnimation` / `stopAnimation` / `isAnimating` signatures or their visible-surface behaviour.** Only their internal routing through intent + reconcile changes.

---

## Implementation Notes

- **M1-M3 all verified live**, not just M1/M2 as the initial bookkeeping commit stated. M1/M2 were run against the demo as shipped (`npm run dev`, a `requestAnimationFrame` hook counting frames, switching the top-level `Tab` away from and back to "Misc."): the frame count froze solid across two consecutive 500ms windows while hidden and resumed climbing on return, for both `Canvas` and `WebGLCanvas`. M3 required a temporary one-line edit to `MiscPanel.ts`'s `demoCanvas` construction (`animateWhenHidden: true`), verified the frame count kept climbing across the tab-away window, then reverted the edit before committing (`git diff` confirmed a clean revert) — no permanent demo change was needed since the plan's non-goals don't call for one.
- **Audit found and fixed a construction-cascade bug**, not anticipated by this plan's own "Potential Challenges" section. `reconcileAnimation()`'s pause branch used `this._rafId !== null` (strict). A construction-time `animateWhenHidden` option (`new Canvas({ animateWhenHidden: true })`, the project's preferred construction style) dispatches `setAnimateWhenHidden` → `reconcileAnimation()` from inside the `super()` cascade, before this class's own field initializers run — so `_rafId` reads as `undefined`, not its declared `null` default, at that point. `undefined !== null` is `true`, so the branch fired a spurious `cancelAnimationFrame(undefined)` on every such construction. The "Potential Challenges" section's reasoning ("reconcile is a no-op" during the cascade) only accounted for `_animationRequested` gating `shouldAnimate()` to false; it missed that the `else` branch has its own independent field read. Fixed by loosening the comparison to `!= null`, the same idiom already used elsewhere in this codebase (`Component.isVisible`/`isDisplayed`, `VideoPlayer`, `PaginationBar`) to treat `null` and `undefined` alike — a minimal, precedent-backed fix rather than a new mechanism. Pinned by a regression test in both `Canvas.test.ts` and `WebGLCanvas.test.ts` asserting zero `cancelAnimationFrame` calls on construction with the option set.
