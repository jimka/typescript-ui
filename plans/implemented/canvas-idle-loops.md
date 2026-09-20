# Canvas Idle Loops — Implementation Plan

## Overview

Two `requestAnimationFrame` loops keep running for content that paints nothing, and this plan closes both.

**C35** — a canvas surface schedules a frame every browser frame even when it has no rendering context to draw into. [`AbstractCanvasSurface.shouldAnimate():386-389`](packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts#L386) consults the consumer's intent and effective visibility, never whether a context exists, so the loop runs and [`WebGLCanvas.renderFrame():268-272`](packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts#L268) returns at its first line, forever. The fix adds one term to that predicate.

**C36** — a canvas that is animating on screen and is then moved under an already-hidden parent keeps its loop. [`AbstractCanvasSurface.onEffectiveVisibilityChange():452-455`](packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts#L452) is the only thing that pauses the loop, and it is reached only from the coalesced effective-visibility flush, which only [`setVisible():2391-2393`](packages/lib/src/typescript/lib/core/Component.ts#L2391) and [`setDisplayed():2469-2471`](packages/lib/src/typescript/lib/core/Component.ts#L2469) arm. A reparent fires neither. The fix has [`Component.wireChild():7210-7226`](packages/lib/src/typescript/lib/core/Component.ts#L7210) arm the same flush for the child it is attaching.

Both are already reproduced by [`packages/qa/src/panels/canvas-idle.ts`](packages/qa/src/panels/canvas-idle.ts), whose expected counters are pinned in [`packages/qa/README.md:317`](packages/qa/README.md#L317). The change touches two source files, four test files, the QA panel and its README, and three doc pages.

---

## Scope

### Both fixes ship in one plan

C35 and C36 are fixed together, in one plan, with no split.

C36's fix gives every `onEffectiveVisibilityChange` override an extra edge whenever a child with a live element is attached to a container. There are five overrides. Each was read and each is safe under a repeated edge:

| Override | What it does on an edge | Safe under an extra edge? |
|---|---|---|
| [`Component:2536-2540`](packages/lib/src/typescript/lib/core/Component.ts#L2536) | writes `animation-play-state` when the component has its own animation | yes — a value write derived from `effective`, no accumulation |
| [`Glyph:562-572`](packages/lib/src/typescript/lib/component/display/Glyph.ts#L562) | same write, gated on `_glyphAnimation` | yes — same shape |
| [`Markdown:1471-1493`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1471) | drains `_awaitingVisibilityKickoffs`, then `scheduleViewportPass()` | yes — the queue is emptied before the loop, and the pass no-ops on an empty queue |
| [`CodeEditor:1943-1952`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L1943) | `requestMeasure()` + `syncAutoHeight()` | yes — both schedule rather than measure, and a reparented editor needs the remeasure |
| [`Panel:1152-1158`](packages/lib/src/typescript/lib/core/Panel.ts#L1152) | `scheduleLayout()` when `autoScroll !== "none"` | yes — coalesced, and a reparent already schedules a layout |

The edge is also narrower than "every reparent": the schedule is guarded on the child already owning an element, which no child does during ordinary tree building.[^element-guard] The surviving blast radius is the docking subsystem, which is where `moveComponent` is actually used — 13 calls in `layout/DockRegion.ts`, 8 in `overlay/Dock.ts`, 2 in `layout/Tab.ts`, 1 each in `overlay/TabWindow.ts` and `component/container/ScrollStrip.ts`. That is covered by a manual dock smoke test in `## Verification`.

### C35's severity is latent, not routine

The original probe (F26.7) argued that a context-less `WebGLCanvas` is "the normal case in software-rendered WebKitGTK — the target environment". That claim does not hold: the QA panel measured `webglContexts` 4 of 4 under WSLg MiniBrowser, so that engine does have WebGL2. The mechanism is real and the panel forces the precondition deliberately, but the defect is a latent one — a surface that legitimately cannot obtain a context, on an engine or a machine that refuses one — not something every run pays.[^severity-latent]

---

## Architecture Decisions

### Gate the loop on a rendering context, in the shared base

`shouldAnimate()` gains `&& this.hasRenderingContext()`, placed after the intent term and before the visibility term. The gate lives on `AbstractCanvasSurface`, so it covers `Canvas` and `WebGLCanvas` alike.[^gate-at-the-base]

Precedent: [`AbstractCanvasSurface.syncBackingStore():285-288`](packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts#L285) opens with the identical `if (!this.hasRenderingContext()) return;` guard, one method away in the same class.

Which combinations animate, after the change:

| `startAnimation()` called | rendering context | effectively visible | `animateWhenHidden` | `isAnimating()` |
|---|---|---|---|---|
| no | yes | yes | `false` | `false` |
| yes | yes | yes | `false` | `true` |
| yes | yes | no | `false` | `false` |
| yes | yes | no | `true` | `true` |
| yes | **no** | yes | `false` | **`false`** — changed |
| yes | **no** | yes | **`true`** | **`false`** — changed |

`animateWhenHidden` opts out of the visibility term only. It never opts out of the context term.

### Re-reconcile once, on the first connected layout

`AbstractCanvasSurface.render()` registers `this.onFirstLayout(() => this.reconcileAnimation());`. A `startAnimation()` that ran before the element existed found no context and scheduled nothing; this is what starts the loop once there is one.[^first-layout-resume]

Precedent: [`WebGLCanvas.render():258`](packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts#L258) already uses `onFirstLayout` for its own auto-start. `WebGLCanvas` keeps that call; the two run in order and the second one reconciles anyway.

### `wireChild` arms the effective-visibility flush for an attached child that already has an element

[`Component.wireChild()`](packages/lib/src/typescript/lib/core/Component.ts#L7210) ends with a guarded `component.scheduleEffectiveVisibilityReconcile()`. `wireChild` has exactly one caller, [`insertComponent():7334`](packages/lib/src/typescript/lib/core/Component.ts#L7334), which `addComponent`, `moveComponent` and `replaceComponent` all route through.

There is **no in-file precedent** for this: `wireChild` propagates parentage, size-change relays and the dirty flag today, and nothing visibility-related. This is new `Component` surface.[^new-surface] The `if (component.getElement())` guard, however, is copied verbatim from the two existing callers of `scheduleEffectiveVisibilityReconcile` — `setVisible():2391` and `setDisplayed():2469`.

Which attachments queue a reconcile:

| Call | Child owns an element when `wireChild` runs | Reconcile queued |
|---|---|---|
| `parent.addComponent(freshChild)` while building a detached tree | no | no |
| `renderedParent.addComponent(freshChild)` | no — the element is built later in `insertComponent` | no |
| `hiddenParent.moveComponent(runningCanvas)` | yes — `removeComponent` detaches the node but keeps the handle | yes |
| `shownParent.moveComponent(pausedCanvas)` | yes | yes |
| `parent.removeComponent(child)`, no re-insert | `wireChild` does not run | no |

### `hasRenderingContext()` is left exactly as it is

Neither `Canvas.hasRenderingContext():166-168` nor `WebGLCanvas.hasRenderingContext():222-224` changes. In particular `WebGLCanvas` does not fold `_contextLost` into it, so the loop keeps running across a context loss and restore.[^context-loss]

This also means F26.7's suggested extra reconcile in the `webglcontextrestored` handler ([`WebGLCanvas.ts:101-105`](packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts#L101)) is not added: the cached `_gl` survives a loss, so the new gate never closes on one and there is nothing to reopen.

### The `WebGLCanvas` and `Canvas` animation tests change contract, deliberately

Under the modelled sink `getContext()` returns `null` by design, and twenty-three tests in the library suite assert that a canvas animates in exactly that state — plus one in the QA suite, under jsdom, which has no 2D context either. They are wrong about the new contract, not incidentally broken: "a surface with no context does not schedule frames" is the behaviour being introduced. Every test that calls `startAnimation()` outside the `offline no-op (U3)` describes gets an instance-level context stub, and the U3 describes gain the new assertion instead.[^test-contract]

Precedent: the stub already exists, twice — [`Canvas.test.ts:410-413`](packages/lib/tests/component/display/Canvas.test.ts#L410) and [`WebGLCanvas.test.ts:400-403`](packages/lib/tests/component/display/WebGLCanvas.test.ts#L400). Each is hoisted to its file's module scope and reused.

---

## Internal Structure

`AbstractCanvasSurface.shouldAnimate()`, after the change:

```typescript
private shouldAnimate(): boolean {
    return this._animationRequested
        && this.hasRenderingContext()
        && (this.getAnimateWhenHidden() || this.isEffectivelyVisible());
}
```

`Component.wireChild()`, the appended block only:

```typescript
    // A reparent fires no setVisible/setDisplayed edge, so nothing else
    // recomputes the attached subtree's effective visibility. Guarded on the
    // child already owning an element, exactly as setVisible/setDisplayed
    // guard their own call: a child whose element is built later in
    // insertComponent has never been reconciled and needs no catch-up.
    if (component.getElement()) {
        component.scheduleEffectiveVisibilityReconcile();
    }
```

The shared test helper, hoisted to module scope in `Canvas.test.ts` (the `WebGLCanvas.test.ts` twin keeps its own `viewport` / `clear` / `clearColor` shape):

```typescript
/** Gives the canvas a context, so the loop's context gate opens offline. */
function withStubContext(canvas: Canvas): void {
    vi.spyOn(canvas, 'getContext')
        .mockReturnValue({ clearRect() {}, save() {}, restore() {}, setTransform() {} } as unknown as CanvasRenderingContext2D);
}
```

---

## Ordered Implementation Steps

### C35 — the context gate

1. **`packages/lib/tests/component/display/Canvas.test.ts` and `WebGLCanvas.test.ts` — hoist the stub helper.** In each file, move `withStubContext` out of the `frame timing and frame cap` describe (`Canvas.test.ts:410-413`, `WebGLCanvas.test.ts:400-403`) to module scope, deleting the inner copy, and add a module-scope `afterEach(() => vi.restoreAllMocks());` next to the existing `afterEach(() => DOM.reset());`. No test bodies change yet. Run `npx vitest run tests/component/display` from `packages/lib` — expect green.

2. **The same two files — new pins (red).** In each `offline no-op (U3)` describe, extend the `… animates without throwing when the context is null` test (`Canvas.test.ts:68-76`, `WebGLCanvas.test.ts:68-80`) with `expect(canvas.isAnimating()).toBe(false);` after the `startAnimation()` call. Add a new describe `Canvas context gate (C35)` — and its `WebGLCanvas` twin — with two tests each: **(a)** a rendered canvas with a stubbed context animates on `startAnimation()`; **(b)** `{ animateWhenHidden: true }`, rendered, no stub, `startAnimation()` ⇒ `isAnimating()` false. Add a third test to `Canvas.test.ts` only, because `WebGLCanvas` auto-starts: **(c)** `startAnimation()` *before* `getElement(true)`, then `getElement(true)`, then `setConnected(el, true)` (imported from `../../dom/TestDOM`), then `withStubContext(canvas)`, then `canvas.doLayout()` ⇒ `isAnimating()` true. Run the two files — expect the new tests to fail.

3. **`packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts` — the gate.** Add `&& this.hasRenderingContext()` to `shouldAnimate()` (lines 387-388), in the position shown in `## Internal Structure`. Update the method's JSDoc (lines 381-385) to name the context term. Do **not** reorder the existing two terms.

4. **`packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts` — the resume hook.** In `render()` (lines 335-348), add `this.onFirstLayout(() => this.reconcileAnimation());` after the `_armDevicePixelRatioWatch();` call and before `return element;`. Extend `render()`'s JSDoc to mention it. Verify: `npm run typecheck` clean.

5. **`packages/lib/tests/component/display/Canvas.test.ts` and `WebGLCanvas.test.ts` — adapt the existing suites.** Insert a `withStubContext(canvas);` call immediately after the `getElement(true)` line of **every** test that calls `startAnimation()`, except the two inside the `offline no-op (U3)` describes. The tests to change:

   | File | Tests (by line) |
   |---|---|
   | `Canvas.test.ts` | 113-123, 124-133, 135-145, 147-157, 190-206, 208-219, 221-238, 240-264, 266-281, 283-295, 297-305, 307-318, 579-612 |
   | `WebGLCanvas.test.ts` | 136-145, 147-156, 158-168, 170-180, 213-229, 231-242, 244-261, 263-287, 289-304, 306-318, 320-328, 330-341 |

   Twenty-five tests in all. Four of them construct the canvas inside a container (`Canvas.test.ts:208-219`, `:266-281`, `WebGLCanvas.test.ts:231-242`, `:289-304`) — stub the canvas, not the container. One (`Canvas.test.ts:579-612`) constructs a `DefaultedCanvas`; stub it the same way. Four (`Canvas.test.ts:190-206`, `:208-219`, `WebGLCanvas.test.ts:213-229`, `:231-242`) already pass without a stub, because they assert that the loop does *not* start; they take the stub anyway, so they keep testing the visibility gate instead of passing for the wrong reason.

6. **Grep checkpoint.** From `packages/lib`: `grep -n 'startAnimation()' tests/component/display/Canvas.test.ts tests/component/display/WebGLCanvas.test.ts` — every hit must sit either inside an `offline no-op (U3)` describe or in a test whose body contains `withStubContext`. Run `npx vitest run tests/component/display` — expect green.

### C36 — the reparent edge

7. **`packages/lib/tests/component/display/Canvas.test.ts` — new pins (red).** Add a describe `Canvas reparent reconcile (C36)` with two tests: **(a)** a stubbed, animating canvas under a rendered shown container, moved via `hiddenParent.moveComponent(canvas)` where `hiddenParent` was constructed `{ displayed: false }` and rendered, then `Component.flushEffectiveVisibility()` ⇒ `isAnimating()` false; **(b)** the reverse — a canvas paused under a hidden parent with intent still set, moved to a shown rendered parent, then flushed ⇒ `isAnimating()` true. Run the file — (a) fails, (b) may already pass.

8. **`packages/lib/tests/component/EffectiveVisibility.test.ts` — adapt, and pin the construction path (red).** Add a file-local `withStubContext(canvas: Canvas)` helper matching the one in `Canvas.test.ts`, and call it after the `canvas.getElement(true)` line in the two tests that start a loop: `Edge-triggered walk / no churn (case 4)` (lines 118-147) and `Nested-hidden is not resumed (case 5)` (lines 149-183). Add `afterEach(() => vi.restoreAllMocks());` if the file has none. Then add a describe `A fresh child pays nothing on attach (C36 guard)`: construct a rendered `Component` container, construct a fresh never-rendered `Canvas`, spy on it through the file's existing `hookTarget(canvas)` helper (line 27), `container.addComponent(canvas)`, `Component.flushEffectiveVisibility()`, and expect the spy not to have been called. Run the file — the two adapted tests are green, the new one passes today and must stay passing after step 9.

9. **`packages/lib/src/typescript/lib/core/Component.ts` — the schedule.** Append the guarded block from `## Internal Structure` to the end of `wireChild()` (after the `if (component.isDirty())` block, line 7225). Extend `wireChild`'s JSDoc (lines 7201-7209) to say it also queues the attached child for the next effective-visibility flush when the child already owns an element — in prose, without naming `scheduleEffectiveVisibilityReconcile`, so the grep checkpoint below stays exact. Verify: `npm run typecheck` clean, then run the files from steps 7 and 8 — expect green.

10. **Full library suite.** From the repo root: `npm test`. Expect green. Any remaining failure is a test asserting the old contract — fix it the same way, never by weakening the gate.

### The QA surface

11. **`packages/qa/tests/mount.test.ts` — re-point the `canvas-idle hidden group` test (lines 186-201).** Change `import type { Component }` (line 11) to a value import. Inside the describe, add a `beforeEach` that stubs jsdom's canvas context and an `afterEach(() => vi.restoreAllMocks());`:

    ```typescript
    vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext')
        .mockImplementation((id: string) => (id === '2d'
            ? { font: '', clearRect() {}, save() {}, restore() {}, setTransform() {}, measureText: () => ({ width: 0 }) }
            : null) as unknown as RenderingContext);
    ```

    In the test body, call `Component.flushEffectiveVisibility();` after `mountPanel` resolves and before reading `describe()`. Keep `hiddenStarted` asserted at `SMOKE_SCALE`; change `hiddenAnimating` to `0`, with the message `'paused by the reparent under the hidden panel'`. Rewrite the comment above the describe to state that the reparent now pauses the loop, that the stub is needed because jsdom implements no 2D context (the same gap `JSDOM_GAPS` records at lines 131-133), and that without it neither counter would mean anything. Rename the test to `starts its 2D canvases while shown and pauses them when moved under the hidden panel`. Run `npm -w packages/qa run test`.

12. **`packages/qa/src/panels/canvas-idle.ts` — re-word only, no behaviour change.** The panel keeps forcing both preconditions; it becomes a regression check rather than a reproduction. Update the `description` export (line 12) to end with the post-fix expectation instead of "one requestAnimationFrame per such canvas per idle frame". In `takeTwoDimensionalContexts`'s JSDoc (lines 26-42), keep the WSLg measurement paragraph and replace its closing claim — "the loop is gated on visibility alone, never on a context" — with a sentence saying the loop is now gated on a context as well, so the panel's counters should read zero. Leave `build` and `describe` untouched.

13. **`packages/qa/README.md:317` — the M14 row.** In the *Reproduces* cell, keep the check's shape (`seam.sink.requestAnimationFrame` = `webglAnimating` + `hiddenAnimating` ±0.05) and change the operands to the post-fix figures: `webglContexts` 0 with `webglAnimating` **0**, `hiddenStarted` **4** and `hiddenAnimating` **0**, so `requestAnimationFrame` is **0** per idle unit. Mark the two existing *Validated* entries as pre-fix measurements by prefixing each with `pre-fix:` — do not delete or restate their numbers.

### Documentation

14. **`packages/lib/docs/components/Canvas.md` and `WebGLCanvas.md`.** In each page's `## Notes`, extend the **Live-only** bullet with one sentence: a surface that cannot obtain a context does not schedule an animation loop either, so `isAnimating()` stays `false` offline even after `startAnimation()`. In `Canvas.md`, extend the **The loop pauses while hidden** bullet to say the pause also applies when the canvas is moved under a hidden parent; mirror that into `WebGLCanvas.md`'s equivalent bullet.

15. **`packages/lib/docs/reference/changelog/next.md`.** Add two bullets under `## Fixed`: one under `### Components` for C35 (a canvas or WebGL surface with no rendering context no longer schedules animation frames; `animateWhenHidden` does not override this), one under `### Core` for C36 (attaching a component that already has an element now recomputes the attached subtree's effective visibility, so a canvas moved under a hidden parent pauses and one moved back resumes). No migration note — no signature changes.

16. **Final verification.** Run the full `## Verification` list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/tests/component/display/Canvas.test.ts` |
| Modify | `packages/lib/tests/component/display/WebGLCanvas.test.ts` |
| Modify | `packages/lib/tests/component/EffectiveVisibility.test.ts` |
| Modify | `packages/qa/tests/mount.test.ts` |
| Modify | `packages/qa/src/panels/canvas-idle.ts` |
| Modify | `packages/qa/README.md` |
| Modify | `packages/lib/docs/components/Canvas.md` |
| Modify | `packages/lib/docs/components/WebGLCanvas.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

No files are created or deleted. `Canvas.ts` and `WebGLCanvas.ts` are **not** modified.

---

## Expected Behaviour

Unit-testable, under the modelled sink unless stated.

**The context gate (C35)**

1. A rendered `WebGLCanvas` whose `getContext()` returns `null`, after `startAnimation()`: `isAnimating()` is `false` and no `requestAnimationFrame` is recorded beyond whatever the framework itself scheduled.
2. The same canvas with `getContext` stubbed: `startAnimation()` ⇒ `isAnimating()` `true`, one `requestAnimationFrame` recorded.
3. Both of the above hold identically for `Canvas`.
4. `new Canvas({ animateWhenHidden: true })`, rendered, no context, `startAnimation()` ⇒ `isAnimating()` `false`. The opt-out covers visibility only.
5. A `Canvas` that called `startAnimation()` before its element existed starts once its first connected layout runs with a context available: `getElement(true)`, `setConnected(el, true)`, stub, `doLayout()` ⇒ `isAnimating()` `true`.
6. `stopAnimation()` and the destructor still cancel a running loop, and a canvas that never called `startAnimation()` still never animates. Unchanged.
7. A `WebGLCanvas` whose context is lost keeps its loop running and resumes drawing on restore. Unchanged — the gate reads the cached context, which a loss does not clear.

**The reparent edge (C36)**

8. A stubbed, animating `Canvas` under a rendered shown container, after `hiddenParent.moveComponent(canvas)` and `Component.flushEffectiveVisibility()`: `isAnimating()` is `false`.
9. A stubbed `Canvas` with animation intent still set, paused under a hidden parent, after `shownParent.moveComponent(canvas)` and a flush: `isAnimating()` is `true`.
10. Attaching a fresh, never-rendered child to a rendered parent fires no `onEffectiveVisibilityChange` on that child after a flush — the construction path pays nothing.
11. `removeComponent(child)` on its own queues no reconcile; a detached child's loop state is unchanged by the removal.
12. A hide-then-show of an ancestor within one frame still nets zero hook calls on a contained canvas. Unchanged — `EffectiveVisibility.test.ts` case 4.

**Manual verification** — not reachable from the offline harness.

13. Docking: drag a dock panel between regions, undock it to a floating window, and re-dock it. Layout, scrolling and any `CodeEditor` inside it behave as before.
14. Tab tear-off: tear a tab into its own window and drop it back.
15. The QA `canvas-idle` panel, at its default scale of 4, reports `webglContexts` 0, `webglAnimating` 0, `hiddenStarted` 4, `hiddenAnimating` 0, and `seam.sink.requestAnimationFrame` 0 per idle unit. **Do not run it without the user's explicit go-ahead** — every run opens a full-screen window on their desktop.

---

## Verification

From the repo root unless stated:

- `npm run typecheck` — clean.
- `npm -w packages/lib run typecheck:test` — clean.
- `npm test` — the full library suite green, including the new C35 and C36 cases.
- `npm -w packages/qa run test` — green, including the re-pointed `canvas-idle hidden group` test.
- `npm run lint` — clean (the source diff touches no DOM APIs, so the `local/no-raw-dom` baseline is unaffected).
- `npm run docs:api` — zero warnings.
- From `packages/lib`: `grep -n 'startAnimation()' tests/component/display/Canvas.test.ts tests/component/display/WebGLCanvas.test.ts tests/component/EffectiveVisibility.test.ts` — every hit is either inside an `offline no-op (U3)` describe or in a test body that also calls `withStubContext`.
- From `packages/lib`: `grep -n 'hasRenderingContext()' src/typescript/lib/component/display/AbstractCanvasSurface.ts` — expect three hits: the `syncBackingStore` guard, the new `shouldAnimate` term, and the abstract declaration.
- From `packages/lib`: `grep -n 'scheduleEffectiveVisibilityReconcile()' src/typescript/lib/core/Component.ts` — expect four hits: the declaration and three guarded call sites (`setVisible`, `setDisplayed`, `wireChild`).
- Manual: behaviours 13-15 above, exercised from the QA app's `canvas-idle` panel and from any docked demo screen. Ask before launching either.

---

## Documentation Impact

No exported signature changes, so the API surface and `packages/lib/llms.txt` are unaffected.

- `packages/lib/docs/components/Canvas.md` — `## Notes`, the **Live-only** and **The loop pauses while hidden** bullets.
- `packages/lib/docs/components/WebGLCanvas.md` — `## Notes`, the same two bullets.
- `packages/lib/docs/reference/changelog/next.md` — one bullet under `## Fixed` → `### Components`, one under `## Fixed` → `### Core`.
- `packages/lib/docs/reference/migration/next.md` — no entry; nothing a consumer wrote stops compiling.
- `packages/qa/README.md` — the `canvas-idle` row's *Reproduces* and *Validated* cells.

---

## Potential Challenges

- **A move followed by an immediate removal, inside one frame, can resume a loop on a detached canvas.** `wireChild` queues the child; if it is then removed before the flush, the flush still finds its handle and computes a parentless component as effectively visible. The window is one frame, and a detached canvas already keeps animating today (only `dispose` stops it), so this is not made worse. Not fixed here; see `## Non-Goals`.
- **Stubbing `getContext` makes `syncBackingStore` actually run in tests that previously skipped it,** adding `setAttr` writes to the recorder. Every affected assertion filters the recorder by op name (`requestAnimationFrame` / `cancelAnimationFrame`), so none of them sees the extra writes — but check the recorder-based assertions after step 5 rather than assuming.
- **The jsdom stub in `packages/qa/tests/mount.test.ts` must stay scoped to its own describe.** A file-wide stub would change what the `JSDOM_GAPS` tests (lines 126-138, 147-148) expect from `table-rows`, `form-flat` and `form-nested`, which assert a *throw* caused by the missing 2D context.
- **`onFirstLayout` in the base `render()` also calls `scheduleLayout()`.** That is new cost for a static `Canvas` that never animates: one scheduled layout pass at render time. `WebGLCanvas` already paid it, and a canvas must be laid out to size its backing store regardless.

---

## Critical Files

Read before starting:

- [`packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts`](packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts) — `syncBackingStore:285-288` (the precedent), `render:335-348`, `shouldAnimate:386-389`, `reconcileAnimation:397-410`, `animationStep:419-443`, `onEffectiveVisibilityChange:452-455`, `hasRenderingContext:464`.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `flushPendingVisibility:361-371` (note the elementless skip at 368), `_lastEffectiveVisible:659-662`, `setVisible`'s guarded schedule `:2391-2393`, `setDisplayed`'s `:2469-2471`, `isEffectivelyVisible:2515-2524`, `onEffectiveVisibilityChange:2536-2540`, `propagateEffectiveVisibility:2556-2568`, `scheduleEffectiveVisibilityReconcile:2575-2578`, `wireChild:7210-7226`, `insertComponent:7320-7361`, `moveComponent:7393-7414`, `onFirstLayout:7814-7830`, `flushEffectiveVisibility:8044-8050`.
- [`packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts`](packages/lib/src/typescript/lib/component/display/WebGLCanvas.ts) — `_onContextRestored:101-105`, `getContext:158-171`, `hasRenderingContext:222-224`, `render:250-261`, `renderFrame:268-272`.
- [`packages/lib/src/typescript/lib/component/display/Canvas.ts`](packages/lib/src/typescript/lib/component/display/Canvas.ts) — `getContext:102-115`, `hasRenderingContext:166-168`.
- The four other `onEffectiveVisibilityChange` overrides, listed with line numbers in `## Scope`.
- [`packages/qa/src/panels/canvas-idle.ts`](packages/qa/src/panels/canvas-idle.ts) — the surface both fixes are shown on.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `setConnected`, needed by expected behaviour 5.
- [`plans/implemented/canvas-pause-when-hidden.md`](plans/implemented/canvas-pause-when-hidden.md) and [`plans/implemented/effective-visibility-standardization.md`](plans/implemented/effective-visibility-standardization.md) — the two plans that built the machinery this one extends.

---

## Non-Goals

- **A context-loss pause.** A `WebGLCanvas` between `webglcontextlost` and `webglcontextrestored` keeps its loop. Folding `_contextLost` into `hasRenderingContext()` would also change `syncBackingStore`, which is outside both defects.
- **The stale-viewport suspicion sitting next to the context-loss case.** `syncBackingStore` runs during a loss and caches the new size, so a resize that happens while the context is lost may leave `gl.viewport` un-reissued after the restore. Unverified, unfiled, and untouched here.
- **Pausing a detached component's loop.** `removeComponent` is documented as detach-only; stopping a loop on detach is a separate behavioural decision.
- **A `Glyph` or `Markdown` created fresh inside an already-hidden parent.** `wireChild`'s `getElement()` guard deliberately skips those. Such a component has never been reconciled, which is a different hole from C36's reparent and is not filed.
- **Reducing the loop's wake-up rate.** `maxFps` thins draws, not frames; that is documented behaviour ([`AbstractCanvasSurface.ts:22-32`](packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts#L22)) and F26.7 recorded it as a note rather than a defect.
- **Running the QA panel.** The plan states the expected counters; a run needs the user's explicit go-ahead.

---

## Notes

[^element-guard]: Without the guard, every `insertComponent` anywhere would queue its child, and the first mount of an application would fire `onEffectiveVisibilityChange(true)` on essentially every component in the tree — each node's edge cache starts `null`, so the first `propagateEffectiveVisibility(true)` counts as a change. That is an app-wide ripple through five overrides to fix a reparent. With the guard, a child built bottom-up has no element when `wireChild` runs, and a child inserted into a rendered parent does not get one until later in `insertComponent` (line 7341), so ordinary construction queues nothing at all and only a genuine reparent does. The cost of the guard is that a fresh component attached straight into a hidden parent is not reconciled either; that case is listed in `## Non-Goals`.

[^gate-at-the-base]: The register locates C35 in `AbstractCanvasSurface.shouldAnimate`, and the slice report's blast-radius note calls it "`WebGLCanvas` only" — that note is wrong, because `shouldAnimate` is the shared base's private predicate and `Canvas` runs the same loop. Gating only `WebGLCanvas` would need a new override and would leave a 2D canvas with no context spinning for nothing, which is the same waste. The gate goes after `_animationRequested` so a construction-time `setAnimateWhenHidden` dispatched from inside `applyOptions` still short-circuits before touching a field whose initializer has not run; it goes before `isEffectivelyVisible()` because a cached context read is cheaper than the ancestor walk.

[^first-layout-resume]: Before the gate, `startAnimation()` on an unrendered canvas scheduled a frame immediately and the loop simply painted nothing until the element appeared. After the gate it schedules nothing, and `Canvas` — unlike `WebGLCanvas` — has no auto-start to reconcile it later, so without a resume hook `const c = Canvas({…}); c.startAnimation(); parent.addComponent(c);` would never animate. Two other placements were rejected. A `reconcileAnimation()` at the end of `doLayout` is what the merged `canvas-pause-when-hidden` plan originally shipped and what `effective-visibility-standardization` deliberately removed, because it forces an `isEffectivelyVisible()` ancestor walk on every layout pass; two tests pin that removal (`Canvas.test.ts:221-238`, `WebGLCanvas.test.ts:244-261`). A reconcile inside `render()` itself is too early: the base assigns `_element` only after `render()` returns, so `getContext()` would still find nothing.

[^new-surface]: The alternative seam is the end of `insertComponent`, after the child's element is built and attached. That placement cannot carry the element guard — the element always exists by then — so it collapses into the unguarded variant this plan rejects. `wireChild` is also where `insertComponent` already hands ownership of the child to the container, alongside the parentage write and the dirty-flag relay, so the new line sits with its peers.

[^context-loss]: `hasRenderingContext()` reads the cached `_gl`, and the WebGL specification keeps `getContext` returning the same object across a loss, so the gate stays open through a loss and restore. Making it context-loss-aware would be defensible on the method's own wording ("a live rendering context"), but it would also close `syncBackingStore`, whose behaviour during a loss is a separate question with its own unverified suspicion attached (see `## Non-Goals`). Leaving the method alone keeps C35's diff to a single `&&`.

[^test-contract]: Twenty-three tests across three library test files assert that a canvas animates under the modelled sink, where `getContext()` is `null` by design — eleven in `Canvas.test.ts`, ten in `WebGLCanvas.test.ts`, two in `EffectiveVisibility.test.ts` — and one more in the QA suite under jsdom. The register named only `WebGLCanvas.test.ts:136-145`, but the same assumption runs through both canvas suites, two `EffectiveVisibility` cases, and the QA mount smoke test. Making the modelled sink hand out a context instead was rejected: `Canvas.test.ts:60-66`, `:332-344` and `WebGLCanvas.test.ts:60-66` pin "the offline sink returns null" as the live-only contract, and both component docs state it. Stubbing per instance, which both files already do for their frame-timing tests, leaves that contract intact and keeps each adapted test testing what its name says — `does not start when explicitly hidden (P3)` in particular would otherwise pass for the wrong reason.

[^severity-latent]: The 2026-09-20 `val-canvas` sweep under WSLg MiniBrowser measured `webglContexts` 4 of 4, refuting F26.7's claim that WebKitGTK has no WebGL2. The panel reaches the precondition by taking each surface's 2D context first, which makes the engine refuse it a WebGL2 one — a deliberate construction, not something an application does. `01-phase2-status-pass.md:110-115` and `99-synthesis.md:922` both carry the correction; the register's C35 row is marked "open, severity down" for this reason. Two of the register's own line references for C36 have since drifted — `99-synthesis.md:923` cites `core/Component.ts:2429-2438`, which is now `getAria`, and `01-phase2-status-pass.md:75` cites `:2563-2566`, which is `propagateEffectiveVisibility`'s child loop. `scheduleEffectiveVisibilityReconcile` is at `:2575-2578`. Every line number in this plan was re-read against `b3d67f7f`.

---

## Implementation Notes

**`wireChild`'s guard needed a second term the plan did not specify.** The
plan's `## Internal Structure` gives the block as `if (component.getElement())`
alone, and `## Scope` reasons that this confines the new edge to genuine
reparents because "a child built bottom-up has no element when `wireChild`
runs". The first half holds; the conclusion does not. `unwireChild` calls
`component.removeElement()`, which detaches the node but leaves `_element`
cached — only `release()` clears it — so **every** child that has ever rendered
still reports an element on re-attach, and a plain `removeComponent` +
`addComponent` pair queues a reconcile just as a `moveComponent` does. The
hot path that exposes it is the table's cell pool: `Row.retireCell` retires a
cell with `removeComponent` and `Row.resolveEnteringCell` restores it with
`addComponent`, once per entering column per pooled row on every column-window
slide — i.e. per frame while scrolling horizontally. `Header` has the same
shape, and so does every `if (x.getParentComponent() !== this) addComponent(x)`
toggle. The plan's blast-radius enumeration, which lists only `moveComponent`
call sites, is therefore the wrong predicate as well as incomplete.

The guard now also requires the attach to change something:
`component.isEffectivelyVisible() !== component._lastEffectiveVisible`. That
preserves all four rows of the plan's own attach table — a never-reconciled
child carries a `null` cache, which differs from either computed value, so
C36's two directions still queue — while a pooled cell whose visibility is
unchanged queues nothing, costs no flush entry, arms no frame and triggers no
subtree descent. `EffectiveVisibility.test.ts`'s
`queues nothing when a rendered child is re-attached with its effective
visibility unchanged` pins it, and fails against the plan's own one-term guard.

**A residual per-attach cost remains and is a decision for the user.** The
tightened guard still evaluates `isEffectivelyVisible()` — an ancestor walk
whose `isVisible()` / `isDisplayed()` each resolve a style layer — once per
re-attach of an already-rendered child, so the table's column slide pays that
walk per entering cell per frame. Two ways out were identified and neither was
taken, since both are design changes the plan did not sanction. One moves the
seam — scheduling from `moveComponent`, which knows the old parent — at the
cost of missing `replaceComponent` and hand-rolled remove/add pairs. The other
keeps the seam and replaces the walk with `propagateEffectiveVisibility`'s own
O(1) formula, `parentEffective && child.isVisible() !== false &&
child.isDisplayed()`, whenever the container's own `_lastEffectiveVisible` is
already recorded, falling back to the walk when it is not. The cost itself is
unmeasured: proving or dismissing it needs a real engine recording, which the
no-window constraint rules out here.

**Step 5's test table undercounted `Canvas.test.ts` by three.** Beyond the
thirteen rows listed, `frame timing and frame cap`'s `draws every frame when
the cap is explicitly removed`, `skips frames that arrive faster than the cap
allows` and `keeps the loop alive across a skipped frame` also call
`startAnimation()` without a stub, so the gate stops their loops before the
first `runFrame`. They took the stub the same way, which is what step 6's grep
checkpoint and step 10's "fix it the same way" already prescribe. The real
figures are sixteen adapted tests in `Canvas.test.ts` and twenty-eight across
the two canvas files, not thirteen and twenty-five; the count of tests that
actually asserted the old contract is twenty-four (fourteen + ten + two), not
twenty-three.

**Step 6's grep checkpoint needs a third accepted category.** Step 2(b)'s new
`does not animate without a context even when animateWhenHidden is set` pins —
one per canvas file — are deliberately unstubbed and sit outside an
`offline no-op (U3)` describe, so the checkpoint's two categories cannot cover
them. Every other `startAnimation()` hit in the three library test files is
either inside a U3 describe or in a body that calls `withStubContext`.

**Three wording fixes outside the text the plan scoped.** Step 12 scoped the
panel's `description` export to its closing clause and step 13 scoped the QA
README to the *Reproduces* and *Validated* cells, but both texts also claimed
the surfaces are "all animating and drawing nothing" — a statement the fix
makes false. Each was corrected to "none of them drawing anything"; nothing
else in the *Builds* cell changed. Step 12's "leave `build` and `describe`
untouched" likewise left a comment inside `build` asserting that "nothing
reconciles the loop and it keeps running", which now contradicts the same
file's updated `description`; it was put in the past tense. No behaviour in
`build` or `describe` changed.

**One code commit, not two.** C35 and C36 are distinct defects with distinct
changelog bullets, but they are coupled: the library test files share one
contract change, and the QA regression surface — the panel, its mount test and
the README's M14 row — states both fixes' figures in the same cells. A split
was possible (C35 first, C36 second, with the whole QA surface in the second
commit) but would have put the shared test-contract churn in both commits for
no gain in reviewability.

**`plans/in-progress/` did not exist** at the start point and was created by
the in-progress move.

**Two pre-existing flakes were observed under load,** neither caused by this
change: `tests/unit/import-without-dom.test.ts` timed out once on the cold
baseline run at `54d9b6c3`, and `tests/component/code-editor.test.ts`'s
`caps output at 100 diagnostics` returned 95 once during a full-suite run.
Both pass in isolation, and the latter passes in isolation against the
unmodified sources too. The verified baseline is 480 files / 7,868 passed +
2 todo; the branch is 480 files / 7,878 passed + 2 todo, the ten new pins.

**`npm run docs:api` reports 14 warnings, not the zero the plan's
`## Verification` asks for.** All 14 predate this branch and name symbols it
does not touch (`SpatialNavigation`, `rankInDirection`, `FieldDecorator`,
`MarkdownViewer`, `MarkdownEditor`); the bar this run held itself to was
therefore no *new* warnings, and the count is unchanged from the start point.

**Manual verification 13-15 is unproven.** The docking drag, the tab tear-off
and the `canvas-idle` panel run each open a window on the user's desktop and
were not run. The offline harness covers the mechanism — the five
`onEffectiveVisibilityChange` overrides are exercised by the library suite, and
the QA mount test pins the reparent pause under jsdom — but the docking
subsystem's own behaviour under the extra edge, and the panel's in-engine
counters, still need the user's own run.
