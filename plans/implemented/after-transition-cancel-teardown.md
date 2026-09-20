# `afterTransition`'s Cancel Teardown — Implementation Plan

## Overview

`Animation.afterTransition` registers a `transitionend` listener and arms a
fallback timer. Its completion path removes that listener
([`Animation.ts:344`](packages/lib/src/typescript/lib/core/Animation.ts#L344));
its cancel path
([`:357-370`](packages/lib/src/typescript/lib/core/Animation.ts#L357)) does
not. Every cancelled wait therefore leaves one dead `transitionend` listener
attached to the element for as long as that element lives. This is defect
**C37** in
[`plans/research/render-review-2026-09-15/01-phase2-status-pass.md:352`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L352).

The heaviest caller is `Accordion.primeWrapper`
([`Accordion.ts:2856`](packages/lib/src/typescript/lib/layout/Accordion.ts#L2856)),
which cancels and replaces the in-flight wait on every re-toggle inside the
animation window. Measured offline: **20 re-toggles of one section add 20
`transitionend` listeners to that section's panel wrapper element and remove
none**; the same 20 toggles, each allowed to settle, add 20 and remove
20.[^leak-measurement]

This plan makes `cancel()` remove the listener, and pays for that by
registering the wait with the framework's pending-transition registry
(`core/PendingTransitions.ts`) so a cancel can never reach a released element
handle. It rewrites the one test that currently pins the leak as intended
behaviour
([`tests/core/Animation.test.ts:456`](packages/lib/tests/core/Animation.test.ts#L456)),
adds one growth case and two teardown cases, and corrects three public JSDoc
blocks. No caller changes.

---

## Architecture Decisions

### The wait registers its cancel with the pending-transition registry

`afterTransition` calls `registerTransition(el, cancel)` on the element it
listens to, and `unregisterTransition(el, cancel)` from both `finish()` and
`cancel()` — the same three calls `Animation.play` makes at
[`Animation.ts:245`](packages/lib/src/typescript/lib/core/Animation.ts#L245),
[`:184`](packages/lib/src/typescript/lib/core/Animation.ts#L184) and
[`:175`](packages/lib/src/typescript/lib/core/Animation.ts#L175). The
precedent is `play` itself, and the guarantee it buys is the one the C15 fix
relied on: `Component.destructor` cancels every transition registered against
a handle immediately before releasing it
([`Component.ts:1308`](packages/lib/src/typescript/lib/core/Component.ts#L1308),
release loop at
[`:1311`](packages/lib/src/typescript/lib/core/Component.ts#L1311)), and
`Component.release()` does the same at
[`:1511`](packages/lib/src/typescript/lib/core/Component.ts#L1511).

The guarantee transfers because `afterTransition`'s element is always a handle
those two paths own. It is `config.component.getElement()`, and a component's
root handle is tracked in `_ownedHandles` by `render()`
([`Component.ts:8245`](packages/lib/src/typescript/lib/core/Component.ts#L8245)).[^handle-ownership]

The import line this needs is already present at
[`Animation.ts:8`](packages/lib/src/typescript/lib/core/Animation.ts#L8).

### `cancel()` removes the listener, with no armed-yet flag

`play` guards its removal behind a `listening` flag because it registers its
listeners inside a deferred callback, two animation frames after the caller
gets the handle. `afterTransition` registers its listener synchronously,
before it returns, so by the time any caller can call `cancel()` the listener
is always attached. The removal is therefore unconditional.[^no-flag]

### Destroying the owner mid-wait suppresses `onComplete` instead of throwing

Once the wait is registered, `Component.destructor` cancels it, so
`config.onComplete` does not run for a component destroyed mid-transition.
That is not a new loss: on the current code the fallback timer fires after
teardown, and the `removeListener` on line 344 runs *before* `onComplete` and
throws against the released handle, so `onComplete` never ran on that path
either.[^throw-before-complete]

The behaviour the two live callers depend on is unaffected, because both
already cancel their own handles before anything releases an element.[^caller-audit]

| Sequence | today | after |
|---|---|---|
| `afterTransition`, then `handle.cancel()` | listener leaks; `onComplete` suppressed | listener removed; `onComplete` suppressed |
| `afterTransition`, then owner `dispose()`, then fallback due | `removeListener` throws on a released handle; `onComplete` never runs | cancelled during teardown; `onComplete` never runs |
| `afterTransition`, then `transitionend` | listener removed; `onComplete` runs | unchanged |
| `afterTransition`, then fallback fires | listener removed; `onComplete` runs | unchanged |

### The test that pins the leak is rewritten, not deleted

[`tests/core/Animation.test.ts:456`](packages/lib/tests/core/Animation.test.ts#L456),
*'suppresses onComplete and the listener removal when cancelled first'*,
asserts that no `removeListener` is recorded after a cancel. That assertion is
the contract this plan reverses, so the test keeps its subject and flips its
claim: cancelling suppresses `onComplete` **and** removes the listener. Its
title changes with it.[^test-rewrite]

### `afterTransition`'s `@returns` is rewritten a second time

The merged C15 plan already narrowed this block once, to say that cancelling
here touches no DOM *unlike* `play`'s
([`Animation.ts:314-317`](packages/lib/src/typescript/lib/core/Animation.ts#L314)).
This plan falsifies that wording, so the block is rewritten to match `play`'s.
`CancelHandle`'s own `@remarks`
([`:405-417`](packages/lib/src/typescript/lib/core/Animation.ts#L405)) names
`play` as the sole handle that reaches the element and must name both.

---

## Internal Structure

### `Animation.afterTransition` — the new body

Replaces everything from the `let done` declaration to the `return` at
[`Animation.ts:327-370`](packages/lib/src/typescript/lib/core/Animation.ts#L327).
The `const el` guard above it is unchanged.

```ts
let done      = false;
let cancelled = false;
let timerId: TimerId | null = null;

// Declared before `finish` so the registration below can hand the pending-
// transition registry the same reference — the mechanism
// `Component.destructor()` uses to abandon a still-running wait before
// releasing `el`. It forward-references `onEnd`, declared further down;
// nothing can call `cancel` until this function has returned, by which point
// `onEnd` exists. The removal is unconditional because the listener is
// registered synchronously below, before any caller holds this handle.
const cancel = (): void => {
    if (done || cancelled) {
        return;
    }

    cancelled = true;

    if (timerId !== null) {
        DOM.sink.clearTimeout(timerId);
        timerId = null;
    }

    DOM.sink.removeListener(el, "transitionend", onEnd);

    unregisterTransition(el, cancel);
};

const finish = (): void => {
    if (done || cancelled) {
        return;
    }
    done = true;

    unregisterTransition(el, cancel);

    // transitionend won the race: disarm the fallback before it can
    // fire against an element that may be torn down by then.
    if (timerId !== null) {
        DOM.sink.clearTimeout(timerId);
        timerId = null;
    }

    DOM.sink.removeListener(el, "transitionend", onEnd);
    config.onComplete();
};

const onEnd = (event: TransitionEvent): void => {
    if (config.property !== undefined && event.propertyName !== config.property) {
        return;
    }
    finish();
};

DOM.sink.addListener(el, "transitionend", onEnd);
timerId = DOM.sink.setTimeout(finish, config.durationMs + (config.fallbackBufferMs ?? 40));

registerTransition(el, cancel);

return { cancel };
```

---

## Ordered Implementation Steps

Write the tests in steps 1-3 first and watch them fail, then make step 4's
change.

1. **Rewrite the cancel test.** In
   [`packages/lib/tests/core/Animation.test.ts`](packages/lib/tests/core/Animation.test.ts),
   inside `describe('afterTransition')`, replace the case at `:456`. Rename it
   to `'removes the listener and suppresses onComplete when cancelled first'`,
   drop the `mark` local, call `handle.cancel()` **twice** before advancing the
   timers, and replace the `removeListener`-absent assertion with the balanced
   pair, using the file's existing `listenerOps` helper
   ([`:117`](packages/lib/tests/core/Animation.test.ts#L117)):

   ```ts
   expect(onComplete).not.toHaveBeenCalled();
   expect(listenerOps('addListener',    'transitionend')).toBe(1);
   expect(listenerOps('removeListener', 'transitionend')).toBe(1);
   ```

   The second `cancel()` is what pins the handle's documented idempotence: the
   counts must stay at one, not two.

   Check: `npx vitest run tests/core/Animation.test.ts` — this case fails
   (0 removals recorded).

2. **Add the growth case.** In the same `describe`, after the rewritten case,
   add `'leaves no listener behind across repeated cancelled waits on one
   retained element'`, mirroring the `play` sibling at
   [`:390`](packages/lib/tests/core/Animation.test.ts#L390). Build one
   `Component` and materialise it with `getElement(true)` — `afterTransition`
   takes the `Component`, so the file's `makeElement()` helper, which returns
   a bare `Handle`, does not fit here. Run `REPEATED_PLAY_COUNT` iterations
   that each start a wait on that component and immediately `cancel()` the
   returned handle, then assert `listenerOps('addListener', 'transitionend')`
   and `listenerOps('removeListener', 'transitionend')` both equal
   `REPEATED_PLAY_COUNT`.

   Check: the new case fails with `removeListener` at 0.

3. **Add the two teardown cases.** In
   [`packages/lib/tests/core/DisposedPendingTransition.test.ts`](packages/lib/tests/core/DisposedPendingTransition.test.ts),
   after the existing cases, add:

   - `'suppresses an afterTransition completion when its component is disposed
     mid-wait'` — build a `Component`, materialise it with
     `getElement(true)`, start an `afterTransition` on it with a `vi.fn()`
     `onComplete`, call `component.dispose()`, advance past the fallback, and
     assert `onComplete` was not called. **Fails on the unfixed code**: the
     fallback still fires and calls it once.
   - `'control: an undisposed component's afterTransition still completes at
     the fallback'` — the same driver without the `dispose()`, asserting
     `onComplete` was called once. Passes before and after; it exists so a
     future change that simply stops arming the timer cannot make the case
     above pass vacuously.

   This file already imports `Animation`, `Component`, `DOM`, `installTestDOM`
   and the fake-timer setup it needs; no new imports.

   Check: `npx vitest run tests/core/DisposedPendingTransition.test.ts` — the
   first new case fails, the control passes.

4. **Apply the fix.** In
   [`packages/lib/src/typescript/lib/core/Animation.ts`](packages/lib/src/typescript/lib/core/Animation.ts),
   replace `afterTransition`'s body from `let done` (`:327`) through the
   `return` block (`:370`) with the code in *Internal Structure*. Do not touch
   the `const el` guard above it, and do not add an import — `:8` already
   imports both registry functions.

   Check: steps 1-3's cases now pass.

5. **Rewrite `afterTransition`'s `@returns`** at `:314-317` to:

   ```
   * @returns A handle whose `cancel()` abandons the wait and suppresses
   * `onComplete`. Cancelling removes the `transitionend` listener this call
   * registered, so it reaches the element rather than being pure bookkeeping.
   * That stays safe because the wait registers itself, for the component's
   * own element, with a framework-internal pending-transition registry, and
   * both library paths that release a component's handle — a component's
   * teardown and its element release — run that registry's cancels before
   * releasing. A cancel a caller is still holding is therefore already a
   * no-op by the time the handle is gone. The same registry abandons the wait
   * when the component is destroyed mid-transition, so `onComplete` does not
   * run in that case.
   ```

   Do not `{@link}` the registry module: `core/PendingTransitions.ts` is not
   exported from `core/index.ts`, and CODE_CONVENTIONS.md bans a link from a
   rendered page to an unrendered symbol. `play`'s own `@returns` describes it
   in prose for the same reason.

6. **Narrow `AfterTransitionConfig.onComplete`'s doc** at
   [`:293-297`](packages/lib/src/typescript/lib/core/Animation.ts#L293).
   Replace "Always called exactly once." with "Always called exactly once
   unless the wait is cancelled — through the returned handle, or by the
   component's own teardown."

7. **Widen `CancelHandle`'s `@remarks`** at `:405-417`. The sentence naming
   `play` as the one handle that reaches the element becomes:
   "{@link Animation.play}'s and {@link Animation.afterTransition}'s handles
   are the ones that still reach the element: each removes the transition
   listeners its call registered, which is safe because the framework cancels
   every transition running against a handle before releasing it." Leave the
   surrounding sentences alone.

8. **Record C37 as settled.** In
   [`plans/research/render-review-2026-09-15/01-phase2-status-pass.md`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md),
   append to the C37 entry (starts at `:352`, ends at `:364` with "Place it in
   a later correctness batch."): **Fixed by `plans/after-transition-cancel-teardown.md`
   (2026-09-20): the registry guarantee does transfer — the wait's element is
   the component's own handle, so `Component.destructor` cancels before
   releasing it.** Follow the marker style already used at
   [`:165`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L165)
   and
   [`:278`](plans/research/render-review-2026-09-15/01-phase2-status-pass.md#L278).

9. **Regression checkpoint.** Three greps over
   `packages/lib/src/typescript/lib/core/Animation.ts`, each with the expected
   count:

   | Command | Expect | Why |
   |---|---|---|
   | `grep -c 'removeListener(el, "transitionend"' …` | 2 | one in `cancel`, one in `finish` |
   | `grep -cE '^ +registerTransition\(el, cancel\);' …` | 2 | one per helper (`play`, `afterTransition`) |
   | `grep -c 'unregisterTransition(el, cancel);' …` | 4 | one per exit path, two helpers × (`finish`, `cancel`) |

   The second pattern is anchored to the start of the line because
   `unregisterTransition(el, cancel);` contains the unanchored one as a
   substring.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Animation.ts` |
| Modify | `packages/lib/tests/core/Animation.test.ts` |
| Modify | `packages/lib/tests/core/DisposedPendingTransition.test.ts` |
| Modify | `plans/research/render-review-2026-09-15/01-phase2-status-pass.md` |

---

## Expected Behaviour

All cases below are unit-testable with the offline harness. Nothing here needs
a browser.

### `afterTransition` balances its listener registrations

| Driver | `transitionend` adds | `transitionend` removes | `onComplete` calls |
|---|---|---|---|
| wait, then `transitionend` for the filtered property | 1 | 1 | 1 |
| wait, then advance past `durationMs + 40` | 1 | 1 | 1 |
| wait, then `cancel()`, then advance past the fallback | 1 | 1 | 0 |
| wait, then `cancel()` twice, then advance past the fallback | 1 | 1 | 0 |
| 10 × (wait, `cancel()`) on one retained component | 10 | 10 | 0 |
| component with no element | 0 | 0 | 1 |

Rows three, four and five are the ones that change — today all three record 0
removals. Rows three and four are driven by the one case step 1 rewrites; the
double cancel is there so a removal cannot leak out a second time.

### Teardown abandons the wait before the handle goes

- A component disposed while a wait is in flight: advancing past the fallback
  calls `onComplete` **zero** times. Today it calls it once offline, and in a
  real browser throws inside the timer callback instead.
- Control: the same driver without the `dispose()` still calls `onComplete`
  once at the fallback.
- The `transitionend` removal is recorded *during* `dispose()`, while the
  handle is still live — one `removeListener` op for one in-flight wait.

### Callers keep their current observable behaviour

Every case in
[`tests/component/layout/CollapseAnimationTeardown.test.ts`](packages/lib/tests/component/layout/CollapseAnimationTeardown.test.ts)
must stay green unchanged. Three matter most, because they are exactly where a
framework-driven cancel could wedge a manager:

- `'turns section transitions back off after a section is re-toggled
  mid-animation'` (`:125`) — the Accordion's toggle counter still reaches
  zero.
- `'leaves transitions off when detached mid-toggle'` (`:149`).
- `'abandons the primed transitions without touching a pane when disposed
  mid-collapse'` (`:273`) — `Split.detach` still writes nothing through a
  released handle.

### Manual verification (optional, needs the user's go-ahead)

Nothing in this change is visual, and the offline cases cover it. If a live
check is wanted anyway, an `Accordion` section toggled rapidly in a browser
must still settle at its final height with `will-change` cleared. The QA app's
panels are the only harness for that and **must not be launched without the
user asking** — each run opens a full-screen window on their desktop.

---

## Verification

Run from `packages/lib`:

1. `npm run typecheck` — 0 errors.
2. `npm run typecheck:test` — 0 errors.
3. `npx vitest run tests/core/Animation.test.ts tests/core/DisposedPendingTransition.test.ts`
   — the two files this plan changes.
4. `npx vitest run tests/component/layout/CollapseAnimationTeardown.test.ts tests/component/layout/Split.collapseUndisplay.test.ts tests/component/layout/Border.collapseUndisplay.test.ts`
   — the three `afterTransition` callers' teardown suites, unchanged and
   expected to stay green.
5. `npm test` — the full suite. On the base commit it is green (478 files,
   7783 passing); after this plan the only expected difference is the rewritten
   and added cases.[^suite-baseline]
6. `npm run lint`.
7. `npm run docs:api` — must finish at **14 warnings**, the count the base
   commit emits. Steps 5-7 of *Ordered Implementation Steps* touch rendered
   JSDoc, so a 15th warning means a `{@link}` reached an unrendered symbol.
8. `grep -n 'removeListener(el, "transitionend"' packages/lib/src/typescript/lib/core/Animation.ts`
   — expect two matches.

---

## Documentation Impact

`Animation.afterTransition`, `Animation.AfterTransitionConfig` and
`Animation.CancelHandle` all render as public API pages, so steps 5-7 are
corrections to promises the code will no longer keep. No narrative doc states
the cancel contract:
[`packages/lib/docs/layouts/Accordion.md:212`](packages/lib/docs/layouts/Accordion.md#L212)
names `afterTransition` but describes only the
`transitionend`-with-fallback shape, and
[`packages/lib/docs/concepts/component-lifecycle.md:140`](packages/lib/docs/concepts/component-lifecycle.md#L140)
tells a subclass to cancel its own handle before `super.destructor()`, which
stays correct advice. Neither changes.

`npm run docs:llms:check` is unaffected: it guards newly-shipped concrete
classes, and `Animation` is a namespace.

---

## Potential Challenges

- **A test counts total sink writes across a cancel.** One new
  `removeListener` op per cancelled wait would shift such a count. Mitigation:
  *Verification* step 4 runs every caller's teardown suite and step 5 runs the
  whole suite; on the base commit the only case that moves is the one step 1
  rewrites.
- **The `cancel`-before-`onEnd` forward reference.** `cancel` closes over
  `onEnd`, which is declared below it. This is the same forward reference
  `play`'s `stopListening` already relies on
  ([`Animation.ts:141`](packages/lib/src/typescript/lib/core/Animation.ts#L141))
  and is safe for the same reason: nothing can call `cancel` until
  `afterTransition` has returned. Mitigation: keep the declaration order in
  *Internal Structure* exactly as written, and keep the comment that says why.
- **A component whose element was never created by the framework.**
  `getElement()` can intern a handle for an element the framework did not
  render. Such a handle is not in `_ownedHandles`, so no teardown path
  releases it and the removal stays valid for the node's life. No mitigation
  needed; recorded so it is not mistaken for a hole.[^interned-handle]

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Animation.ts`](packages/lib/src/typescript/lib/core/Animation.ts)
  — `play` at `:109` is the precedent for every part of this change; its
  `cancel` at `:156`, its `registerTransition` at `:245`, its `@returns` at
  `:97`.
- [`packages/lib/src/typescript/lib/core/PendingTransitions.ts`](packages/lib/src/typescript/lib/core/PendingTransitions.ts)
  — the registry, and the reason its header says it is framework-internal.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts)
  — `destructor`'s cancel-then-release pair at `:1307-1312`, its child
  recursion at `:1215` and its `layoutManager.detach()` at `:1258`;
  `release()`'s equivalent at `:1511`; `render()`'s `trackHandle` at `:8245`.
- [`packages/lib/tests/core/DisposedPendingTransition.test.ts`](packages/lib/tests/core/DisposedPendingTransition.test.ts)
  — the template for step 3, including its header's rule: assert on whether
  the effect happened, never on `not.toThrow()`, because the offline sink keeps
  serving a released handle.
- [`packages/lib/tests/core/Animation.test.ts:390`](packages/lib/tests/core/Animation.test.ts#L390)
  — the growth-case template step 2 mirrors.
- [`packages/lib/tests/component/layout/CollapseAnimationTeardown.test.ts`](packages/lib/tests/component/layout/CollapseAnimationTeardown.test.ts)
  — the three manager-teardown cases this change must not disturb.
- [`packages/lib/src/typescript/lib/layout/Accordion.ts:2802`](packages/lib/src/typescript/lib/layout/Accordion.ts#L2802)
  and
  [`packages/lib/src/typescript/lib/layout/CollapseSupport.ts:132`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L132)
  — the two callers, read to confirm neither relies on a cancelled wait's
  `onComplete`.

---

## Non-Goals

- **No caller changes.** `Accordion` and `CollapseSupport` already cancel
  their own handles before anything releases an element, so nothing about
  their teardown needs rewriting for this fix.
- **No change to `Accordion`'s re-toggle policy.** `primeWrapper` keeps
  cancelling and replacing the in-flight wait; this plan makes that cancel
  clean up after itself, not rarer.
- **No change to `onComplete`'s one-finish-only contract on the paths that do
  complete.** Only the cancelled paths are touched.
- **No new Accordion-level regression test.** The leak's contract lives in
  `Animation.afterTransition`, and the growth case in step 2 pins it directly;
  a second test driving it through `Accordion` would pin the same arithmetic
  one layer further from the code that owns it.
- **No revision of `play`.** Its fix shipped in
  `plans/implemented/listener-and-rule-removal-paths.md` and stands; this plan
  only widens the shared `CancelHandle` doc that names it.

---

## Notes

[^leak-measurement]: Measured offline against the base commit `2097d27d` with
    a throwaway vitest probe (since deleted), the recording sink's write log
    and a spy on `DOM.sink.addListener` to attribute each registration to a
    handle. Driver: a `Container` laid out by an `Accordion` with two
    sections, then 10 × (`closeSection(0)`, `openSection(0)`) with no timer
    advance at all, so every toggle lands inside the 200 ms animation window
    and is cancelled by the next one. Result: **20 `transitionend`
    registrations, all on handle 12 — section 0's panel wrapper element — and
    0 removals.** The same 20 toggles with `vi.advanceTimersByTime(2000)`
    between each: 20 registrations, 20 removals. Re-running the first driver
    with this plan's fix applied: 20 registrations, 19 removals, net 1 — the
    wait still in flight. `Animation.afterTransition` on its own, 10 ×
    (start, `cancel()`) against one retained component: 10 registrations, 0
    removals before the fix, 10 after. In practice the rate is one dead
    listener per section toggle interrupted within `animationDuration + 40`
    ms — 240 ms at the default duration of 200
    ([`Accordion.ts:169`](packages/lib/src/typescript/lib/layout/Accordion.ts#L169))
    — accumulating for the life of the wrapper element, which `Accordion`
    disposes only in `detach()`.

[^handle-ownership]: `afterTransition` resolves its element through
    `config.component.getElement()`
    ([`Component.ts:1424`](packages/lib/src/typescript/lib/core/Component.ts#L1424)).
    That returns the cached `_element`, and `render()` puts every root element
    it creates through `trackHandle`
    ([`:8245`](packages/lib/src/typescript/lib/core/Component.ts#L8245)), so
    the handle is in `_ownedHandles` — the exact array `destructor` iterates
    at `:1307` to cancel and at `:1311` to release. The by-id fallback inside
    `getElement` does not weaken this: `DOM.source.getElementById` interns
    through the handle registry
    ([`DOM.ts:2792`](packages/lib/src/typescript/lib/core/DOM.ts#L2792) →
    `intern` at [`:212`](packages/lib/src/typescript/lib/core/DOM.ts#L212)),
    which returns the node's existing canonical handle when there is one, so a
    framework-rendered element resolves to the same tracked handle whichever
    branch produced it. This is the audit the merged C15 plan's
    cancel-safety footnote performed for `play`; its wording names
    "`Component.removeElement` at `:1499`", which on the current file is
    `release()` at `:1483` with its `cancelTransitions` at `:1511` —
    `removeElement()` at `:1456` detaches the node but releases no handle, so
    it is not a release path at all.

[^no-flag]: `play` sets `listening = true` inside `applyTransitionAndTo`
    ([`Animation.ts:240`](packages/lib/src/typescript/lib/core/Animation.ts#L240)),
    which runs either synchronously or two animation frames later depending on
    whether `PlayConfig.from` was supplied — so its `cancel` can genuinely
    arrive before anything is registered, and the flag is what keeps
    `stopListening` from calling `removeListener` for a pair that was never
    added. `afterTransition` has no deferred branch: `DOM.sink.addListener`
    runs on the straight-line path before the handle is returned, and the only
    two ways out of the armed state (`finish`, `cancel`) are mutually excluded
    by the `done`/`cancelled` guards. Copying the flag across would add a
    condition that is provably always true.

[^throw-before-complete]: In `finish`, the `removeListener` at `:344` sits
    above `config.onComplete()` at `:345`. The production sink's
    `removeListener` resolves the handle through the registry
    ([`DOM.ts:2002`](packages/lib/src/typescript/lib/core/DOM.ts#L2002) →
    `resolve` at [`:235`](packages/lib/src/typescript/lib/core/DOM.ts#L235)),
    which throws `DOM handle N is not registered` for a released one. So a
    fallback that fires after its component's teardown throws before reaching
    `onComplete`. Offline the throw does not happen — the recording sink's
    `removeListener` only appends to the write log — which is why a probe
    against the base commit shows `onComplete` firing once after `dispose()`,
    and why step 3's first case is a real red-to-green rather than a vacuous
    one. It is also why `DisposedPendingTransition.test.ts`'s header forbids
    `not.toThrow()` assertions in that file.

[^caller-audit]: Three call sites, all checked against the base commit.
    `Accordion.primeWrapper`
    ([`Accordion.ts:2856`](packages/lib/src/typescript/lib/layout/Accordion.ts#L2856))
    and the shrink wait in `doLayout`
    ([`:1779`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1779))
    both target a panel wrapper the `Accordion` itself owns, and `detach()`
    cancels every entry in `_shrinkAnimations` and `_wrapperAnimations`
    ([`:1184-1192`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1184))
    before disposing any wrapper at
    [`:1253`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1253) — so
    the registry's cancel fires only on an already-cancelled handle and is a
    no-op. `CollapseSupport.primeCollapse`
    ([`CollapseSupport.ts:163`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L163))
    targets a caller-owned pane or gutter, and `Border.detach`
    ([`Border.ts:1662`](packages/lib/src/typescript/lib/layout/Border.ts#L1662))
    and `Split.detach`
    ([`Split.ts:1746`](packages/lib/src/typescript/lib/layout/Split.ts#L1746))
    already distinguish the two shapes: a manager swap `settle()`s each
    pending transition (running its cleanup), a dispose `cancel()`s it
    silently. The dispose branch is the interesting one, because
    `Component.destructor` destroys children at
    [`:1215`](packages/lib/src/typescript/lib/core/Component.ts#L1215) and
    only then detaches the manager at
    [`:1258`](packages/lib/src/typescript/lib/core/Component.ts#L1258) — so
    that `transition.cancel()` runs *after* the pane's handle is released.
    Registering is what makes it safe: the pane's own destructor cancels the
    wait while its handle is still live, and the manager's later cancel finds
    it already cancelled. `runCollapse` deliberately does not cancel the
    previous toggle's primed transitions on a re-toggle
    ([`CollapseSupport.ts:462`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L462)),
    so a `Border` or `Split` re-toggle leaks nothing: those two cancel only at
    teardown, and only whatever is still in flight then. That is why the
    measured volume is all `Accordion`'s.

[^test-rewrite]: Deleting the case instead would drop the only coverage of
    what a cancel does to `onComplete`, which is unchanged and still worth
    pinning. Keeping it and merely loosening the assertion — dropping the
    `removeListener` clause without replacing it — would leave the new
    contract unpinned in the very test named for it. Flipping the assertion
    keeps one case per exit path in `describe('afterTransition')`, matching
    the fired- and fallback-path cases immediately above it, both of which
    already assert that a removal was recorded.

[^suite-baseline]: `npx vitest run` from `packages/lib` on `2097d27d` — the
    commit whose `packages/lib` tree is identical to the current master tip
    `87aed309`, which only edits a research doc — is green at 478 files
    / 7783 passing / 2 todo. The fix in
    *Internal Structure* was then applied to a scratch worktree and reverted
    before this plan was written: `tsc -p tsconfig.lib.json --noEmit` reported
    0 errors, `eslint` on `Animation.ts` reported nothing, and the suite
    produced exactly one failure — the case step 1 rewrites. An earlier run of
    that same patch also showed `tests/component/code-editor.test.ts`'s
    syntax-error count off by 13 and an unhandled rejection from
    `tests/component/table/ColumnFilterRow.test.ts`; neither reproduced
    standalone or in two repeat full runs, so both are load-related flakes
    rather than fallout. `npm run docs:api` on the base commit ends at "Found
    0 errors and 14 warnings".

[^interned-handle]: The case is a `Component` whose element exists in the
    document but was not minted by `render()` — `getElement`'s by-id branch
    then interns a fresh weakly-held handle
    ([`DOM.ts:212`](packages/lib/src/typescript/lib/core/DOM.ts#L212)) that
    never enters `_ownedHandles`. `cancelTransitions` would not reach it, but
    neither would `DOM.sink.release`, so the handle stays resolvable for as
    long as the node lives and a late `removeListener` against it is valid.
    The registration is harmless there: `unregisterTransition` from `finish`
    or `cancel` clears the map entry either way.

---

## Implementation Notes

Four departures from the plan as written, all recorded rather than designed
around.

**Step 9's first grep expects 2 and the file now holds 3.** The pattern
`removeListener(el, "transitionend"` is unanchored, so it also matches
`play`'s own removal at `Animation.ts:148` — `DOM.sink.removeListener(el,
"transitionend",   finish);` — which the plan's count overlooked; the base
commit already returned 2 for it, not 1. The substance the step checks is
unchanged and was verified directly: `afterTransition`'s body holds exactly
two, one in `cancel` and one in `finish`. *Verification* step 8 carries the
same off-by-one.

**Step 8's C37 entry no longer ends where the plan says.** The plan describes
it as ending at `:364` with "Place it in a later correctness batch.", but
`d2e8c937` (*Correct C37's soundness premise, which I also had wrong*) had
already replaced that tail while this plan was being written; the entry now
ends at `:373`. The "Fixed by" marker was appended after that current last
line, in the marker style the plan cites.

**A changelog entry was added, which the plan's Documentation Impact did not
call for.** That section checked the narrative docs and correctly found
nothing to change, but it did not consider
`packages/lib/docs/reference/changelog/next.md`, where the directly analogous
`play` fix recorded itself one branch earlier (`13edc684`, *Record
Animation.play's listener removal in the changelog*). A consumer-visible
narrowing of a documented promise is exactly what that file carries, so the
sibling entry was written immediately below `play`'s.

**Three comments the change falsified were corrected.** `PendingTransitions.ts`'s
header described the registry as holding "the cancel functions of the
`Animation.play` transitions", which this change makes untrue — that file is
therefore edited although it is not in the plan's Files table. The two test
files' headers were narrowed the same way: `Animation.test.ts`'s said
"cancel() disarms it without touching the DOM" (already falsified for `play`
by the merged C15 fix, and now falsified twice over, one line above a case
asserting the opposite), and `DisposedPendingTransition.test.ts`'s described
its subject as `Animation.play` transitions alone. `REPEATED_PLAY_COUNT`'s
own comment now reads "assertions" rather than "assertion", since the growth
case in step 2 is a second user of it.

No deviation was needed in the fix itself: *Internal Structure*'s body was
applied verbatim.
