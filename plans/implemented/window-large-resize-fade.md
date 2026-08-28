---
touches-shared:
  - packages/lib/src/typescript/lib/overlay/AbstractWindow.ts
---

# Window Large-Resize Fade Path — Implementation Plan

## Overview

Maximizing, minimizing and restoring a window drives its geometry with a 150 ms JS tween. [`AbstractWindow.setWindowState`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1022) computes the target rect for each of its three branches and hands it to [`animateRect`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2369), whose per-frame `commit` runs a full synchronous `this.doLayout()`. For a window holding a wide data table on a very large display that is unwatchable: the table's column window is sized from the body's current viewport width ([`computeColumnWindowSize`](packages/lib/src/typescript/lib/component/table/Body.ts#L138)), so every frame of the sweep has to build, bind and position a burst of newly-entering column cells, and the transition reads as a stutter instead of a glide.

This plan adds a second path to `animateRect`. When the target rect changes the window's width or height by more than a new threshold constant, the window fades its body content out, jumps to the target rect in one commit, and fades the content back in — one expensive layout instead of nine. Every smaller transition keeps today's tween untouched.

The change is confined to [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) plus one new test file. No exported signature changes; every new symbol is a module constant or a private method.

---

## Architecture Decisions

### The path is chosen inside `animateRect`, not at its three call sites

`animateRect` keeps its name and its signature and becomes a small dispatcher: it cancels whatever was running, then calls a new private `tweenRect` or a new private `fadeRectSwap`. The three calls in `setWindowState` ([line 1065](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1065), [1105](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1105), [1122](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1122)) are not edited at all.[^dispatch-inside]

### The threshold is one fixed pixel constant on the larger of the two size deltas

A new module constant `WINDOW_FADE_THRESHOLD_PX = 960` sits beside `WINDOW_ANIM_DURATION_MS` at [AbstractWindow.ts:28](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L28). The fade path is taken when `max(|Δwidth|, |Δheight|)` between `currentRect()` and the target is **strictly greater** than that constant. Position deltas are ignored — moving a window costs one transform, only resizing it costs a relayout.[^threshold-value]

| Transition | From | To | \|Δw\| | \|Δh\| | max | Path |
|---|---|---|---|---|---|---|
| Maximize a mid-size window on a 1920×1080 screen | 1200×800 | 1920×1080 | 720 | 280 | 720 | tween |
| Maximize a small window on the same screen | 800×600 | 1920×1080 | 1120 | 480 | 1120 | fade |
| Restore a maximized window on a 3440×1440 screen | 3440×1440 | 1400×900 | 2040 | 540 | 2040 | fade |
| Minimize a mid-size window to the dock strip | 900×700 | 200×26 | 700 | 674 | 700 | tween |
| Minimize a maximized ultra-wide window | 3440×1440 | 200×26 | 3240 | 1414 | 3240 | fade |

### Only the body host fades; the chrome and the resize borders snap

The fade animates the window's **body host** — the first non-chrome child, already discovered lazily by [`setBodyHostDisplayed`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2121) via [`findBodyHost`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2106). The title chrome and the eight resize strips are separate components that resize for free, so they simply land at the new rect. No new element or wrapper is needed.[^body-host-separable]

The mechanism is `Animation.play` on the body host's element handle, mirroring [`animateRailCollapse`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2257) — the existing `Animation.play` fade in this same file — and [`Tab`'s cross-tab content fade](packages/lib/src/typescript/lib/layout/Tab.ts#L1983), which fades one child component's element by opacity and nothing else.

### The fade path does not tween the rect at all

`fadeRectSwap` writes the target rect in a single `commitRect` call inside the fade-out's `onComplete`, then runs the caller's `onDone`, then fades back in. It never interpolates.[^no-tween-on-fade]

The order inside that `onComplete` is fixed: **commit the rect, then run `onDone`, then fade in.** The `"normal"` branch's `onDone` calls [`restoreNormalMinSize`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1148), which must only reinstate the relaxed min-size floor once the window's live size is already above it; committing first guarantees that.

### Both paths share `_stateAnimHandle`

The fade stores its live `Animation.CancelHandle` in the existing `_stateAnimHandle` field ([line 253](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L253)), reassigning it when the fade-out hands over to the fade-in. The three sites that already read the field — `onExitAction` ([871](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L871)), `destructor` ([925](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L925)) and `animateRect` itself — then cancel a fade with no edit.[^one-handle]

### A cancelled fade is undone by the next transition, not by `cancel()`

Cancelling an `Animation.play` suppresses its `onComplete`, so a fade abandoned halfway leaves the body host stranded at a partial opacity. The repair runs at the *start* of the next transition: a new private `beginStateAnimation` cancels the handle and then, when a fade was in flight, clears the body host's inline opacity through `Component.clearOpacity`. A re-toggle therefore always starts from a fully opaque body, whichever path it then takes.[^restore-on-entry]

One boolean field, `_bodyFadeActive`, records whether a fade owns the body host's opacity. It is set when the fade-out starts and cleared by the restore.

### Reduced motion needs no new handling

`Animation.play` short-circuits under `prefers-reduced-motion: reduce` at [Animation.ts:116](packages/lib/src/typescript/lib/core/Animation.ts#L116): it applies the `to` styles and calls `onComplete` on the same tick. Both legs of the fade therefore collapse, the rect commit runs synchronously between them, and the window lands on its target in one tick — the same outcome `Animation.tween`'s own short-circuit ([Animation.ts:392](packages/lib/src/typescript/lib/core/Animation.ts#L392)) already produces. No `isReducedMotion()` call is added.

### No `will-change` hint on the faded body

The fade sets no compositor hint. Promoting a wide table's subtree to its own layer for the length of the fade costs exactly the kind of work this plan removes, and dropping the hint afterwards is a known repaint-flash source. `animateRailCollapse`, `Tab`'s cross-tab fade and `Animation.materialize` all fade without one.[^no-will-change]

---

## Internal Structure

Two new module constants, beside the existing ones at the top of `AbstractWindow.ts`:

```typescript
// Size delta, in pixels on the larger-changing axis, above which a window-state
// transition swaps its smooth rect tween for the fade path below. 960 px is half
// a 1920-wide screen: a sweep that reveals more than that much new content in
// 150 ms is one where a virtualized body (a wide table) has to build a burst of
// cells on every tween frame, which reads as a stutter. Everything smaller keeps
// the glide.
const WINDOW_FADE_THRESHOLD_PX: number = 960;
// Duration of each leg of that fade. Deliberately shorter than
// WINDOW_ANIM_DURATION_MS: the fade plays two legs back to back, so 100 ms keeps
// the round trip in the same bracket as the 150 ms tween it replaces. 100 ms is
// the framework's shortest existing transition (TOOLTIP_ANIM_DURATION_MS).
const WINDOW_FADE_DURATION_MS: number = 100;
```

One new field, beside `_bodyHost` at [line 247](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L247):

```typescript
/** True while a fade owns the body host's inline opacity. See `endBodyFade`. */
private _bodyFadeActive: boolean = false;
```

The dispatcher and its two paths:

```typescript
private animateRect(target: WindowRect, onDone?: () => void): void {
    this.beginStateAnimation();

    if (this.isLargeRectChange(target)) {
        this.fadeRectSwap(target, onDone);
    } else {
        this.tweenRect(target, onDone);
    }
}

private isLargeRectChange(target: WindowRect): boolean {
    const current = this.currentRect();

    return Math.max(
        Math.abs(target.width  - current.width),
        Math.abs(target.height - current.height),
    ) > WINDOW_FADE_THRESHOLD_PX;
}

private fadeRectSwap(target: WindowRect, onDone?: () => void): void {
    const host    = this.resolveBodyHost();
    const element = host?.getElement();

    // No body to fade (a chrome-only window, or one not rendered yet): the
    // swap is just the jump.
    if (!host || !element) {
        this.commitRect(target);
        onDone?.();

        return;
    }

    this._bodyFadeActive = true;
    this._stateAnimHandle = Animation.play(element, {
        to:         { opacity: "0" },
        durationMs: WINDOW_FADE_DURATION_MS,
        properties: ["opacity"],
        onComplete: (): void => {
            this.commitRect(target);
            onDone?.();

            // `onDone` may have hidden the body outright (the minimized
            // branch does). Fading a display:none element only burns the
            // fallback timer, so restore the opacity now and stop.
            if (!host.isDisplayed()) {
                this._stateAnimHandle = null;
                this.endBodyFade();

                return;
            }

            this._stateAnimHandle = Animation.play(element, {
                from:       { opacity: "0" },
                to:         { opacity: "1" },
                durationMs: WINDOW_FADE_DURATION_MS,
                properties: ["opacity"],
                onComplete: (): void => {
                    this._stateAnimHandle = null;
                    this.endBodyFade();
                },
            });
        },
    });
}
```

The shared helpers. `commitRect` is the closure `animateRect` holds today, lifted to a method; `tweenRect` is the rest of today's `animateRect` with its two cancel lines removed (they moved into `beginStateAnimation`):

```typescript
private beginStateAnimation(): void {
    this._stateAnimHandle?.cancel();
    this._stateAnimHandle = null;
    this.endBodyFade();
}

private endBodyFade(): void {
    if (!this._bodyFadeActive) {
        return;
    }

    this._bodyFadeActive = false;
    this.resolveBodyHost()?.clearOpacity();
}

private resolveBodyHost(): Component | null {
    if (!this._bodyHost) {
        this._bodyHost = this.findBodyHost();
    }

    return this._bodyHost;
}

private commitRect(rect: WindowRect): void {
    this.setAutoCommitStyle(false);
    this.setX(rect.x);
    this.setY(rect.y);
    this.setWidth(rect.width);
    this.setHeight(rect.height);
    this.doLayout();
    this.setAutoCommitStyle(true);
}
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`** — add the two module constants `WINDOW_FADE_THRESHOLD_PX` and `WINDOW_FADE_DURATION_MS` immediately after `WINDOW_ANIM_DURATION_MS` ([line 28](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L28)), with the comments given in `## Internal Structure`. Both are unused until step 4, so do not run lint until then.

2. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`** — add the `_bodyFadeActive` field beside `_bodyHost` ([line 247](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L247)). A plain `= false` initializer is correct here: no setter dispatched during the `super()` cascade writes it.

3. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`** — add `resolveBodyHost()` next to `findBodyHost` ([line 2106](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2106)) and rewrite `setBodyHostDisplayed` ([line 2121](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2121)) to call it, so the lazy discovery lives in one place:
   ```typescript
   private setBodyHostDisplayed(displayed: boolean): void {
       this.resolveBodyHost()?.setDisplayed(displayed);
   }
   ```
   Check: `grep -n 'this._bodyHost = this.findBodyHost()' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — expect exactly two matches, one inside `show()` ([line 689](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L689), left alone) and one inside `resolveBodyHost`.

4. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`** — replace `animateRect` ([line 2369](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2369)) with the seven methods `## Internal Structure` gives: the `animateRect` dispatcher, `isLargeRectChange`, `fadeRectSwap`, `beginStateAnimation`, `endBodyFade`, `commitRect`, and `tweenRect`. Do all seven in this one step — the dispatcher does not compile without `fadeRectSwap`. `tweenRect` keeps today's `Animation.tween` call verbatim except that its `onStep` becomes `(rect: WindowRect): void => this.commitRect(rect)` and the two `_stateAnimHandle` cancel lines at its top are gone, having moved into `beginStateAnimation`.
   Check: `npm run typecheck` and `npx eslint src/typescript/lib/overlay/AbstractWindow.ts` from `packages/lib` — both clean. `grep -n '_stateAnimHandle?.cancel()' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — expect three matches: `onExitAction`, `destructor`, and `beginStateAnimation`.

5. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`** — update the JSDoc on `setWindowState` ([line 1007](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1007)) and on `animateRect`: a transition whose width or height changes by more than `WINDOW_FADE_THRESHOLD_PX` fades the body out, jumps to the target rect and fades back in, instead of tweening; smaller transitions tween as before; reduced motion still collapses either path to one synchronous commit. Do not restate the reasoning from `## Architecture Decisions`. `setWindowState` is public, so per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) do not `{@link}` any of the new private members from it — describe them in prose.
   Check: `npm run docs:api` — no new warnings against the pre-change baseline.

6. **`packages/lib/tests/overlay/AbstractWindow.largeResizeFade.test.ts`** — create the file with the frame-and-timer harness copied from [`tests/core/Animation.test.ts:44`](packages/lib/tests/core/Animation.test.ts#L44): a `frames` array, `vi.useFakeTimers()`, a `DOM.sink.requestAnimationFrame` spy that pushes into it, and a `flushFrame()` that drains it. Use `CONFIG` with `viewport: { width: 2000, height: 800 }`. The `afterEach` must clear the static open-window set before restoring mocks and calling `DOM.reset()`, copying the line from [`AbstractWindow.maximizeRestoreViewportClamp.test.ts`](packages/lib/tests/overlay/AbstractWindow.maximizeRestoreViewportClamp.test.ts) — a leaked window makes `relayoutMinimizedStack` lay out a stale instance in the next case. Add the fixture helper from `## Expected Behaviour`.
   Check: `npm test -- largeResizeFade` — the file runs with no cases yet.

7. **`packages/lib/tests/overlay/AbstractWindow.largeResizeFade.test.ts`** — add cases 1–9 from `## Expected Behaviour`.
   Check: `npm test -- largeResizeFade` — all nine pass.

8. **`packages/lib/docs/reference/changelog/next.md`** — add a bullet under `## Fixed` → `### Components` per `## Documentation Impact`.

9. Run the full gate: `npm run typecheck`, `npm test`, `npm run lint`, `npm run docs:api`.

10. Manual verification per `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.largeResizeFade.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

The fixture every case builds, in a 2000×800 viewport:

```typescript
function makeWindow(width: number, height: number): { win: Window; body: Component } {
    const win  = new Window('W');
    const body = new Component();

    win.addComponent(body, { placement: Placement.CENTER });
    win.setSize({ width, height });
    win.show();
    flushFrame();   // drain the two frames show()'s entrance play() queued
    flushFrame();

    return { win, body };
}
```

`body` is the window's only non-chrome child, so `findBodyHost` returns it — the same route `Window.addContent` ([Window.ts:253](packages/lib/src/typescript/lib/overlay/Window.ts#L253)) takes. Every spy is installed **after** `makeWindow` returns, so the fixture's own layout passes are not counted.

Two sizes carry the threshold: a 1040-wide window maximizes to 2000 for a Δ of exactly 960 (not greater — tween), and a 1039-wide window maximizes for a Δ of 961 (greater — fade). Both are 800 tall, so `|Δheight|` is 0 and the width decides.

All nine cases are unit-testable offline.

- **1. A transition exactly at the threshold tweens.** `makeWindow(1040, 800)`, spy `win.doLayout` and `DOM.sink.addListener`, `win.toggleMaximize()`, `flushFrame()`. The flushed frame called `doLayout` (the tween's first step ran), no `transitionend` was registered against `body.getElement()`, and `win.getWidth()` is not 2000 — the tween has not landed. Do not assert a specific interpolated width: `Animation.tween` reads `performance.now()` directly, so the value depends on the fake clock's coverage.
- **2. One pixel over the threshold fades.** `makeWindow(1039, 800)`, spy `win.doLayout` and `DOM.sink.addListener`, `win.toggleMaximize()`. Immediately: `doLayout` has not been called, `win.getWidth()` is still 1039, and `addListener` recorded a `transitionend` registration whose target handle is `body.getElement()`.
- **3. The fade lands the rect in exactly one layout.** Case 2's setup and toggle, then `vi.advanceTimersByTime(300)` — past the 100 ms fade plus `Animation.play`'s 40 ms fallback buffer. `win.getX()` is 0, `win.getY()` is 0, `win.getWidth()` is 2000, `win.getHeight()` is 800, and `doLayout` has been called exactly once.
- **4. The chrome is not what fades.** Case 2's setup, with `DOM.sink.apply` spied as well, then the toggle and `vi.advanceTimersByTime(300)`. Across the whole swap an `opacity` style write landed on `body.getElement()`, and no `opacity` write landed on `win.getElement()`.
- **5. The min-size floor is reinstated only after the rect landed.** `makeWindow(1900, 700)`, `win.minimize()`, `vi.advanceTimersByTime(300)`, then `win.toggleMinimize()` (target is the 1900×700 restore rect, current is the 200-wide dock strip, so Δw is 1700 — the fade path). Before advancing timers, `win.getMinSizeConstraint()` is still `{ width: 0, height: 0 }` and `win.getWidth()` is still 200. After `vi.advanceTimersByTime(300)`, `win.getWidth()` is 1900 and `win.getMinSizeConstraint()!.height` is 200 again.
- **6. A fade-path minimize hides the body and leaves no fade pending.** `makeWindow(1900, 700)`, `win.minimize()`, `vi.advanceTimersByTime(300)`. `body.isDisplayed()` is false, and the private `_bodyFadeActive` is false — the fade-in was skipped and the opacity restored rather than left running against a hidden element.
- **7. Re-toggling mid-fade restores the body's opacity.** `makeWindow(1039, 800)`, `win.toggleMaximize()`, then — without advancing timers — spy `DOM.sink.apply` and call `win.toggleMaximize()` again. An `apply` call wrote `{ style: { opacity: null } }` against `body.getElement()`, and the private `_bodyFadeActive` is false.
- **8. Reduced motion lands in one tick.** Mock `DOM.source.matchMedia` to return `{ matches: true, addChangeListener: () => {} }` before building the fixture (mirroring [`AbstractWindow.maximizeRestoreViewportClamp.test.ts`](packages/lib/tests/overlay/AbstractWindow.maximizeRestoreViewportClamp.test.ts)). `makeWindow(1039, 800)`, spy `win.doLayout`, `win.toggleMaximize()`. With no frames flushed and no timers advanced, `win.getWidth()` is 2000, `win.getHeight()` is 800, and `doLayout` has been called exactly once.
- **9. A window with no body host still transitions.** Build a `Window` with no content child, size it 1039×800, `show()`, drain frames, spy `win.doLayout`, `win.toggleMaximize()`. With no frames flushed and no timers advanced, `win.getWidth()` is 2000 and `doLayout` has been called exactly once — the fade degrades to a plain jump. This is the shape every existing `AbstractWindow` test builds, so it is what keeps them green.

Manual only (the offline harness has no compositor and no real frame clock):

- **10. The ultra-wide case is smooth.** On a display wide enough that maximizing sweeps more than 960 px, maximize and restore the 45-column table window. The content blinks out, the frame lands at its new size, and the content fades back in — no stepping, no half-drawn columns.
- **11. Small transitions are unchanged.** Maximize and restore a small window on the same display so the sweep stays under the threshold. It glides exactly as it does today.
- **12. Rail minimize is untouched.** Minimize a window into a `Rail`. The genie collapse plays as before — that branch never reaches `animateRect`.

---

## Verification

**Layout counts, not wall-clock, are the measurement.** Timings taken through the DevTools MCP in this environment run roughly 60× inflated, so no millisecond figure from it is evidence. Assert on counts and final geometry.

Automated, from `packages/lib`:

- `npm test -- largeResizeFade` — cases 1–9 green.
- `npm test -- AbstractWindow` — every pre-existing `AbstractWindow` case green **with no edit to its body**. None of them sizes a window near the threshold: the largest existing delta is the maximize in `AbstractWindow.maximizeRestoreViewportClamp.test.ts`, which forces reduced motion and builds a window with no content child, so it lands synchronously either way.
- `npm test` — full suite.
- `npm run typecheck`, `npm run lint`, `npm run docs:api`.
- `grep -rn 'WINDOW_FADE_THRESHOLD_PX\|WINDOW_FADE_DURATION_MS' packages/lib/src/` — expect five lines, all in `AbstractWindow.ts`: the two declarations, one use of `WINDOW_FADE_THRESHOLD_PX` in `isLargeRectChange`, and two uses of `WINDOW_FADE_DURATION_MS` (one per fade leg).
- `grep -rn 'animateRect(' packages/lib/src/typescript/lib/` — expect four matches: the three calls in `setWindowState` and the declaration.

Manual, in the demo app (`npm run dev`, http://localhost:8015, MiscPanel), on the widest display available:

- "Show window with wide table (45 columns)!" — maximize, restore, minimize, restore (cases 10 and 11).
- Re-click the maximize button while the fade is still playing — the window must end up in the state of the *last* click with the content fully visible, never stuck faded (case 7's manual counterpart).
- Minimize a window into a `Rail` (case 12).

---

## Documentation Impact

No exported symbol changes, so no API page or sidebar entry moves. Two edits:

- The public JSDoc on `setWindowState` describes the tween ("Tweens geometry between the current rect and the rect implied by the target state over `WINDOW_ANIM_DURATION_MS`"), which is no longer the whole story — step 5 updates it.
- [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md) gets one bullet under `## Fixed` → `### Components`: a maximize / minimize / restore that changes the window's width or height by more than 960 px now fades the window's content out, applies the new size in one layout pass, and fades it back in, instead of tweening the rect across ~9 frames. Smaller transitions are unchanged. This removes the stutter a window holding a wide virtualized table showed on large displays, where every tween frame had to build a burst of newly-visible cells.

[`packages/lib/docs/components/AbstractWindow.md`](packages/lib/docs/components/AbstractWindow.md) needs no change: its "Window state" row lists the responsibilities the base owns, not how the geometry is animated.

---

## Potential Challenges

- **The fixture's own frames must be drained before any spy is installed.** `show()` queues two animation frames for its entrance `Animation.play`. A case that spies before draining them counts the fixture's work; `makeWindow` drains them, so use it rather than building windows inline.
- **`vi.useFakeTimers()` and `performance.now`.** `Animation.tween` reads `performance.now()` directly, not through the DOM seam. Case 1 therefore asserts only that the tween has *started* and has not landed — never a specific interpolated width, which would depend on whether vitest's fake clock covers `performance`.
- **`getElement()` returns `undefined`, not `null`.** `Component.getElement` ([Component.ts:1227](packages/lib/src/typescript/lib/core/Component.ts#L1227)) has an `undefined` no-element result. Guard with `if (!element)`, not `=== null`.
- **A `TabWindow`'s body host is its first tab's content, not the active one.** `TabWindow.isChromeComponent` ([TabWindow.ts:299](packages/lib/src/typescript/lib/overlay/TabWindow.ts#L299)) returns `false` for every child, so `findBodyHost` picks the first. The fade then dims a child that may not be the visible one. This is pre-existing — `setBodyHostDisplayed` already hides that same child on minimize — and is not fixed here; report it, do not widen the plan.
- **An in-flight, uncommitted test file sits beside this work.** `packages/lib/tests/overlay/AbstractWindow.closeable.test.ts` is untracked in the working tree. It covers only the `closeable` option and touches neither `setWindowState` nor `animateRect`, so it neither conflicts with nor duplicates anything here. Leave it alone.

---

## Critical Files

- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) — the only source file that changes. Read end to end before editing: the constants block (20–47), `_bodyHost` / `_stateAnimHandle` (247, 253), `onExitAction` (861), `destructor` (922), `setWindowState` (1022) and its three branches, `restoreNormalMinSize` (1148), `currentRect` (2091), `findBodyHost` (2106), `setBodyHostDisplayed` (2121), `computeMaximizeRect` (2136), `computeDockRect` (2162), `animateRailCollapse` (2257), `relayoutMinimizedStack` (2338), `animateRect` (2369), `clampRectToViewport` (2498).
- [`packages/lib/src/typescript/lib/core/Animation.ts`](packages/lib/src/typescript/lib/core/Animation.ts) — `play` (104) and its reduced-motion short-circuit (116), the `CancelHandle` contract (368), `tween` (391) and its short-circuit (392), `defaultTweenEase` (442), `materialize` (532). The `CancelHandle` doc comment is what makes "cancel touches no DOM" a rule the fade path must not break.
- [`packages/lib/src/typescript/lib/layout/Tab.ts`](packages/lib/src/typescript/lib/layout/Tab.ts) — the cross-tab content fade (1983) and `TAB_FADE_DURATION_MS` (126). The closest precedent for fading one child component's element by opacity alone.
- [`packages/lib/src/typescript/lib/core/OverlayFade.ts`](packages/lib/src/typescript/lib/core/OverlayFade.ts) — `DEFAULT_DURATION_MS` (7) and `fadeShow` (52), the framework's standard fade duration and shape. Read for the duration precedent; do not use the helper itself, which detaches the component it fades.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `getElement` (1227), `setDisplayed` (2154), `isDisplayed` (2195), `setOpacity` (4882), `clearOpacity` (4896).
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts) — `computeColumnWindowSize` (138), `computeColumnWindow` (186), `renderWindow` (1136), `renderWindowPass` (1241). Read to understand why a width sweep is expensive; do not edit.
- [`packages/lib/src/typescript/lib/layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts) — the `body.renderWindow(...)` call at 435 that ties a window `doLayout` to the column-window recompute. Read only.
- [`packages/lib/tests/core/Animation.test.ts`](packages/lib/tests/core/Animation.test.ts) — the frame-and-fake-timer harness to copy (44–90).
- [`packages/lib/tests/overlay/AbstractWindow.maximizeRestoreViewportClamp.test.ts`](packages/lib/tests/overlay/AbstractWindow.maximizeRestoreViewportClamp.test.ts) — the reduced-motion forcing convention for case 8, and the `openWindows` cleanup an `afterEach` needs.
- [`plans/implemented/table-column-virtualization.md`](plans/implemented/table-column-virtualization.md) and [`plans/implemented/table-resize-layout-scheduling.md`](plans/implemented/table-resize-layout-scheduling.md) — the diagnosis this plan builds on, and the sibling fix for the same class of bug on the column-drag driver.

---

## Non-Goals

- **Making a layout pass cheaper.** `plans/implemented/table-column-virtualization.md` owns what a pass costs. This plan only reduces how many passes a state transition runs.
- **Coalescing the tween's own passes.** Putting `commitRect` on the animation-frame layout queue (the fix `plans/implemented/table-resize-layout-scheduling.md` applied to column-drag resize) does not help here: the tween already runs one pass per frame, so there is nothing to coalesce.
- **The rail genie path.** A rail-docked minimize goes through `animateRailCollapse` / `animateRailExpand`, which never touch `animateRect` and already fade rather than relayout. Untouched.
- **The window entrance, close and drag animations.** `show()`, `onExitAction` and the move drag each animate the window's own element and run no layout per frame. Out of scope.
- **A proportional or content-aware threshold.** One fixed pixel constant, no option and no configuration. A window cannot know whether its content is expensive to relayout, and a ratio would fire on a tiny window growing modestly.
- **Fading a `TabWindow`'s *active* tab rather than its first child.** Fixing `findBodyHost` for tab windows is a pre-existing question this plan neither creates nor resolves.
- **Restoring a consumer-set body-host opacity.** `endBodyFade` calls `clearOpacity()`, which drops any opacity a consumer had set on the body host. The same is true of `fadeShow` and `Tab`'s cross-fade today; no snapshot-and-restore is added.

---

## Notes

[^dispatch-inside]: Putting the threshold check in each of the three branches was the other option. It means three copies of the same comparison, three places for the two paths to drift apart, and three edits to `setWindowState` — a method whose branches already carry a lot of ordering-sensitive bookkeeping. Every branch already funnels through `animateRect` with a fully computed target rect and an `onDone` closure, which is exactly the information the decision needs, so the dispatcher sees the same inputs the call sites would and the call sites do not move at all.

[^threshold-value]: The number is a coarse heuristic, chosen to switch on for the cases the fade exists for and stay off for the common ones. 960 px is half a 1920-wide screen — the width at which the two ends of the transition are showing substantially different content rather than a rescaled version of the same content. The tween's easing makes the front of the sweep the expensive part, not the back: `Animation.tween`'s default ease is `1 - (1 - t)^3` ([Animation.ts:442](packages/lib/src/typescript/lib/core/Animation.ts#L442)), and over 150 ms at 60 Hz the first of about nine steps lands at `t = 1/9`, where the eased progress is `1 - (8/9)^3 ≈ 0.30`. The first frame therefore applies roughly 30 % of the whole delta in one pass — for a 2000 px sweep, about 600 px of newly-entering columns at once. A proportional threshold was rejected: the cost tracks absolute pixels of newly-revealed content, not the ratio between the two rects, so a ratio would fire on a 200 px window doubling (cheap) and miss a 3000 px window growing by 40 % (expensive). A cost-derived constant was also rejected — deriving one needs per-cell build timings, and this environment's DevTools timings are known to run about 60× inflated, so any figure taken here would be fabricated precision.

[^body-host-separable]: Checked against both concrete windows. A `Window` puts its `WindowHeader` in the `Border` layout's NORTH region and content in CENTER, and `Window.isChromeComponent` ([Window.ts:263](packages/lib/src/typescript/lib/overlay/Window.ts#L263)) returns true only for the header — so `findBodyHost` returns the content child and fading it leaves the header untouched. The eight `WindowBorder` strips are appended straight to the window element by `render` ([AbstractWindow.ts:2069](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2069)) and are not children of the body host, so they are unaffected too. `setBodyHostDisplayed` already relies on exactly this separation to hide the body on minimize while the docked strip keeps showing its title bar, so the concept is load-bearing already and needs no new element.

[^no-tween-on-fade]: Tweening the rect *while* the body is faded out was considered and dropped. It would put the same per-frame `doLayout` back on the critical path — the whole cost this plan removes — because the body still has to relayout on every frame whether or not anyone can see it. Tweening only the chrome is not available either: the chrome's geometry is written by the window's own `doLayout`, so there is no way to move the frame without laying the body out. A single commit is the only shape that actually buys anything.

[^one-handle]: A dedicated second field was the alternative. It would need a matching `?.cancel()` added to `onExitAction` and `destructor`, and it would permit both a tween and a fade to be live at once if a future edit ever forgot one of those sites. Sharing the field makes the two paths mutually exclusive by construction — only one window-state animation can ever be in flight — and `Animation.materialize` ([Animation.ts:532](packages/lib/src/typescript/lib/core/Animation.ts#L532)) sets the precedent for one stored handle standing in for a multi-stage sequence.

[^restore-on-entry]: The obvious alternative — wrapping the fade in a composite handle whose `cancel()` also restores the opacity — breaks a documented contract. `Animation.CancelHandle`'s doc comment states that cancelling performs no DOM write, so an owner may call it from teardown without caring whether the animated element's handle has already been released; `AbstractWindow.destructor` does exactly that, right before `super.destructor()` releases the handle. Moving the restore to the *next* transition's entry keeps `cancel()` DOM-free and still covers every case that matters, because the only way the body host becomes visible again is through another `setWindowState`. A window torn down mid-fade leaves `_bodyFadeActive` true, which is harmless: the window and its body host are both gone.

[^no-will-change]: `OverlayFade.fadeShow` does set `will-change` around its fade, so the codebase is not unanimous. It is the minority: `animateRailCollapse` and `animateRailExpand` in this same file, `Tab`'s cross-tab content fade, and `Animation.materialize` all fade with no hint. The tie-breaker is what the hint would do here — promote a possibly enormous virtualized table subtree to its own compositor layer for 100 ms, then drop it, on a path whose entire purpose is to stop doing expensive work during a transition. Dropping a `will-change` hint at the end of a window animation is separately known in this project to re-snap paint. If the fade ever does show banding on a large body, the fix to try first is a longer duration, not a compositor hint.

## Implementation Notes

**`WINDOW_FADE_DURATION_MS` shipped at 200 ms, not the 100 ms this plan specified.** Live testing on the 45-column wide-table window confirmed both fade legs armed and completed correctly at 100 ms, but a handful of frames read as an instant cut rather than a deliberate fade against the chrome's own instant snap to the target rect. Lengthened to 200 ms per leg (~400 ms round trip) — long enough to register as motion without approaching the choppy multi-frame tween this path replaces. No plan-file table update: `AbstractWindow.ts` was already the plan's only source file.

**A new `WINDOW_FADE_IN_FALLBACK_BUFFER_MS` (1000 ms) constant was added, beyond the two this plan's `## Internal Structure` specified.** The fade-in leg's own `Animation.play` call passed only the plain default 40 ms fallback buffer. `commitRect`'s relayout, run synchronously just before that leg arms, can leave the main thread too busy to reach the style recalculation that starts the transition before that default deadline — the fallback then fired first and cleared the fade before the browser painted a frame of it, measured live as an instant pop with no fade-in on the wide-table window. The fade-in leg now pads its own fallback buffer to survive a slow relayout; the fade-out leg (not preceded by a relayout) keeps the plain default. No plan-file table update: same file.

**A later debug session first tried, then reverted, splitting `fadeRectSwap`'s rect commit from `doLayout` to fix a silent multi-hundred-ms freeze on the wide-table window — recorded here so the same attempt isn't repeated blindly.** Live tracing (real Chrome, transitionstart/transitionend timestamps and a `MutationObserver` on the window element's `style` attribute) confirmed the freeze precisely: `commitRect`'s single synchronous `doLayout` call — several hundred ms for the 45-column table — left the window pinned at its old, small size with no visible feedback for the whole relayout, then snapped to full size in the same instant the fade-in started. The first fix committed the window's own `x`/`y`/`width`/`height` synchronously (via a new `commitRectGeometry`, split out of `commitRect`) and deferred `doLayout` two `requestAnimationFrame` turns past it, so the box would get a real paint of its own before the relayout blocked the thread — one frame cannot deliver that paint, since an `rAF` callback runs *before* its own frame's paint step, so two nested calls (mirroring `Animation.play`'s own `from`-value wait) were used instead of one. It was reverted before landing: `AbstractWindow.doLayout` positions the `WindowHeader` and all eight `WindowBorder` strips from the *same* `Component.doLayout` → `LayoutManager.doLayout` call that lays out the body, per `Component.ts:6748-6768` — there is no way to defer only the body's expensive relayout without also deferring the header and border strips, which the plan's `### Only the body host fades; the chrome and the resize borders snap` decision requires to land with the rect, not two frames later. The result traded a silent freeze at the *old* size for a visibly broken window — full-width box, stale-width header, misplaced resize strips — held for the same several hundred ms, which is worse.

**The freeze was then fixed by pausing the body host's own layout, not by splitting the rect commit from `doLayout`.** `Component.pauseLayout()` / `resumeLayout()` (`Component.ts:6681-6711`) is an existing, public primitive already used for exactly this shape of problem elsewhere (`ComboBox`, `AutoCompleteDropdown`, `AbstractSelectableList`, `Menu`: pause, make several changes, resume once) — `Component.doLayout()` checks `isLayoutPaused()` before it even reads a layout manager, so pausing the *body host specifically* makes `Border.doLayout`'s `commitBounds` call for the body's region a no-op for that one component, while every other region (`WindowHeader` at NORTH, the eight `WindowBorder` strips `AbstractWindow.doLayout` positions after `super.doLayout()`) lays out normally in the same call, because `Border.doLayout` positions every region in one pass regardless of any one region's own pause state. `fadeRectSwap`'s fade-out `onComplete` now calls `host.pauseLayout()` immediately before `commitRect(target)`, so that commit repositions the chrome and the body's own box synchronously and cheaply, without recursing into the body's own (paused, potentially expensive) relayout; the same two-frame defer from the reverted attempt above then calls `host.resumeLayout()` — which un-pauses and immediately lays out the body — followed by the fade-in arm, both in the second frame. The window therefore visibly resizes to its final size and shape right away; only the (still invisible) body content is deferred past that, with no chrome caught mid-resize. `beginStateAnimation` was extended to resume a still-paused body host if a later transition supersedes one before its own deferred frame does, mirroring the existing `endBodyFade` restore-on-entry idiom for the same reason: `Animation.CancelHandle.cancel()` must perform no DOM write (`Animation.ts`'s own doc comment), so the resume — a real `doLayout` pass — lives in `beginStateAnimation`, not inside the handle's `cancel()` closure. No plan-file table update: `AbstractWindow.ts` and its test file only.

**The note above shipped an instant jump to `target`, not an animated glide — contradicting this plan's own stated goal (a smooth transition on large monitors) and a hard requirement, not a negotiable design point.** `pauseLayout`/`resumeLayout` on the body host was the right primitive; committing the geometry in one instant `commitRect` call instead of animating it was not. Fixed by keeping the same pause, but animating through it: `fadeRectSwap`'s fade-out `onComplete` now calls `host.pauseLayout()` and then runs `Animation.tween` (the same mechanism `tweenRect` already used for small deltas) from the current rect to `target` over `WINDOW_ANIM_DURATION_MS`, with `onStep: (rect) => this.commitRect(rect)` — every step still calls the window's own `doLayout`, so the chrome tracks the glide on every frame exactly as it did the single instant commit, at the same near-zero cost, since the body host's layout is paused for the glide's whole duration rather than just its landing instant. `host.resumeLayout()` — the one deferred relayout — now runs in the tween's `onComplete`, once the glide lands, followed immediately by the fade-in arm; the two-nested-`requestAnimationFrame` paint-boundary wait from the note above is gone, since a real multi-frame tween already paints several genuine intermediate frames before landing; nothing needs to force one artificially. Live verification (`MutationObserver` on the window and header elements' `style` attributes, both a stock run and under 6× CPU throttling) confirmed a real 8-9-step glide, window and header tracking each other within 2px at every step, for both maximize and restore. `beginStateAnimation`'s resume-a-still-paused-body guard is now load-bearing for a cancellation *mid-glide*, not just mid-freeze; both `pauseLayout` and the cancellation guard were re-verified to still be necessary by directly reverting each in turn and confirming the regression tests fail for the right reason. This also uncovered a latent gap in the test harness itself: `Animation.tween`'s `step` callback (unlike `Animation.play`'s) has no internal `cancelled` guard, relying entirely on `DOM.sink.cancelAnimationFrame` actually dropping the pending callback — which the suite's existing `requestAnimationFrame` mock never wired up, since nothing before this exercised a `tween` cancellation while a real step was in flight. The mock now tracks pending callbacks in an id-keyed map and a matching `cancelAnimationFrame` spy removes the cancelled entry, matching real-browser semantics; a stale glide step reliably does not fire post-cancellation. No plan-file table update: `AbstractWindow.ts` and its test file only.
