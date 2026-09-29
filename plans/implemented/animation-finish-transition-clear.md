---
depends-on: [rail-handover-follow-ups]
touches-shared:
  - packages/lib/src/typescript/lib/core/Animation.ts
  - packages/lib/src/typescript/lib/core/PendingTransitions.ts
  - packages/lib/src/typescript/lib/overlay/AbstractWindow.ts
  - packages/lib/tests/core/Animation.test.ts
  - packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Animation Finish's Transition Clear — Implementation Plan

## Overview

When an `Animation.play` transition completes, its `finish` takes the `transition` declaration back off the element: [`core/Animation.ts:201`](packages/lib/src/typescript/lib/core/Animation.ts#L201) writes `buf.set("transition", null)`. The declaration is one CSS property on one element, so two animations playing on the same element share it. Whichever of the two finishes first therefore takes the rule out from under the other. When the two durations match — which they do in every pair in the library — that is the one armed first, which is the one the second animation has already superseded. The live animation loses its transition mid-flight and **truncates**: the element snaps to that animation's end state instead of travelling to it. What it loses is the gap between the two arming times, less `play`'s 40 ms fallback grace ([`Animation.ts:111`](packages/lib/src/typescript/lib/core/Animation.ts#L111)) — so a second gesture 108 ms into a 120 ms fade costs the fade 68 of its 120 ms. When the durations differ the order can invert, and the first-armed animation outlives the second; `## Expected Behaviour`'s case A4 is that arrangement.

Two changes ship on this branch, as two code commits.

**The central fix.** `finish` skips the clear when another transition has been registered against the same element since this one was. The question is already answerable: [`core/PendingTransitions.ts`](packages/lib/src/typescript/lib/core/PendingTransitions.ts) is the framework-internal registry that records every live `play` and `afterTransition` against the element handle it animates, and its per-handle `Set` is insertion-ordered. It gains one predicate, and `finish` reads it. Eleven same-element animation families across nine classes are fixed at once by that one guard, and a twelfth added later inherits the fix.[^why-central]

**The close fade's start state.** [`AbstractWindow.onExitAction`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1015) cancels an in-flight rail collapse but never undoes it, and `Animation.cancel` writes no styles — so the shrink-into-the-rail genie's `transform` and `opacity` are still on the element when the close fade starts, and a window closed mid-collapse fades out from the shrunken, half-faded state rather than from its resting one. `onExitAction` gains an [`endRailCollapse()`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2995) call, and the close fade gains a `from` so the browser has committed the resting state before the fade begins.

---

## Architecture Decisions

### The registry answers whether a transition has been superseded

`PendingTransitions` gains `isSupersededTransition(handle, cancel)`, returning `true` when a transition registered against `handle` *after* `cancel` is still live. `Animation.play`'s `finish` reads it once, before it unregisters itself, and skips the `transition` clear when the answer is `true`.[^registry-precedent]

The predicate counts `afterTransition` waits as well as `play` transitions, because both mean a live transition on that element.[^counts-both]

The shape has a second precedent in the library: [`LayerManager.isTopmostInputLayer`](packages/lib/src/typescript/lib/core/LayerManager.ts#L476) is the same thing one layer up — a predicate over an ordered registration stack answering "has a later registration superseded me?", built on a private walk of that stack rather than on state cached in the caller. `isSupersededTransition` introduces no new pattern.

### A superseded animation's completion callback still fires

The fix is scoped to the `transition` clear. A superseded `play` still runs its `onComplete`, unchanged.[^oncomplete-must-fire]

### Nothing else depended on the superseded animation's clear

The clear exists so that later writes to the element are not retroactively animated through a rule nobody wanted. Under the central fix the newest animation on the element still performs it, so the guarantee is intact; and a path that cancels an animation and keeps the element already clears explicitly rather than waiting for a completion — [`AbstractWindow.endRailCollapse`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2995) and [`endBodyFade`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3305) are the two existing instances.[^clear-survey]

### The rail's cancel-both lines stay, and two of them need a new pin

`plans/implemented/rail-handover-follow-ups.md` added four cancels across three methods — the expand pair in `animateRailCollapse` (`:2916-2917`), the collapse pair in `animateRailExpand` (`:2965-2966`), and both in `onExitAction` (`:1032-1035`). The two *collapse* cancels are untouched by the central fix: they exist because the collapse's `onComplete` hides the window and emits `"minimize"`, and the central fix suppresses no callback. The two *expand* cancels lose their stated reason — the truncation they prevent is now prevented centrally — but they stay, because deleting them would leave `animateRailCollapse` and `onExitAction` cancelling one handle where `destructor` and `setRail` cancel both.[^keep-expand-cancels]

Keeping them has a cost this plan pays: after the central fix, **R13's and R14's "exactly one clear" assertion is satisfied by either mechanism alone**, so neither row pins the expand cancels any more. Each row gains one assertion that only the cancel can satisfy, and each is verified by mutation rather than by a red-green cycle.[^r13-r14-truth-table]

### A close arriving mid-collapse commits the window's resting state before it fades

`onExitAction` captures `_railCollapseActive`, calls `endRailCollapse()`, and — when a collapse was active — hands the close fade a `from` of the window's resting `transform` and `opacity`. `endRailCollapse()` alone does not change what the fade animates out of: it writes the resting state in the same task as the fade's own `to`, and a CSS transition's start value is the element's state at the *previous* style recalculation, which is still the mid-genie one. `play`'s `from` is the mechanism that buys a committed start state — it writes `from`, yields two animation frames so the browser reaches a recalculation with it in place, and only then arms the transition.[^from-not-just-undo]

The `from` is conditional so an ordinary close is unchanged: an unconditional one would delay every window's fade by two frames, and would snap a window closed mid-drag back to an untranslated `transform`.[^conditional-from]

---

## Internal Structure

### `PendingTransitions.isSupersededTransition`

Appended after `unregisterTransition` ([`PendingTransitions.ts:56`](packages/lib/src/typescript/lib/core/PendingTransitions.ts#L56)), above `cancelTransitions`.

```typescript
/**
 * Returns whether another transition has been registered against `handle`
 * since `cancel` was — i.e. whether the transition `cancel` belongs to has
 * been superseded by a later one on the same element.
 *
 * @param handle - The element handle the transition is writing to.
 * @param cancel - The transition's own cancel function.
 *
 * @returns `true` when a transition registered after this one is still live.
 */
export function isSupersededTransition(handle: Handle, cancel: () => void): boolean {
    const cancels = running.get(handle);

    if (!cancels) {
        return false;
    }

    let found = false;

    for (const registered of cancels) {
        if (found) {
            return true;
        }

        if (registered === cancel) {
            found = true;
        }
    }

    return false;
}
```

A `Set` iterates in insertion order, so "appears after `cancel`" is "registered after `cancel`". An unregistered `cancel` reports `false`, which is the behaviour the library had before this plan.[^absent-reports-false]

### `Animation.play`'s `finish`

The only change to [`Animation.ts:178-204`](packages/lib/src/typescript/lib/core/Animation.ts#L178): read the answer first, then guard the clear.

```typescript
        const finish = (): void => {
            if (done || cancelled) {
                return;
            }
            done = true;

            // Read before the unregister below, which takes this transition
            // out of the registry the answer is derived from.
            const superseded = isSupersededTransition(el, cancel);

            unregisterTransition(el, cancel);

            stopListening();

            // transitionend won the race: disarm the fallback so it can never
            // run against an element that may be torn down by then.
            if (timerId !== null) {
                DOM.sink.clearTimeout(timerId);
                timerId = null;
            }

            // Clear the transition rule so subsequent style changes
            // (e.g. a Window drag setting `transform: translate(...)`
            // after the entrance fade) aren't retroactively animated
            // through it. Done before `onComplete` so callers that
            // start a fresh `play()` from the callback can install
            // their own transition without it being clobbered.
            //
            // Skipped when a later animation on this same element is running
            // through that rule: `transition` is one property on one element,
            // so this deadline would otherwise take the live animation's rule
            // away and snap it to its end state. The live one clears it at its
            // own completion instead.
            if (!superseded) {
                buf.set("transition", null);
            }

            config.onComplete?.();
        };
```

`isSupersededTransition` joins the existing import on [`Animation.ts:8`](packages/lib/src/typescript/lib/core/Animation.ts#L8). `afterTransition`'s own `finish` needs no change — it never writes `transition`.

### `AbstractWindow.onExitAction`

Replaces the close-fade block at [`AbstractWindow.ts:1068-1074`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1068) — the `_closeAnimation` cancel and the `Animation.play` below it, and nothing above them. `:1057-1067` keep `const el`, `const finalize` and the `if (!el)` early return exactly as they are; the snippet references all three and replaces none of them. The `endRailCollapse()` call sits immediately after the rail-pair cancels on `:1032-1035`, so "cancel the pair" and "undo what it left" read as one unit. `setRail`'s detach is the precedent for *pairing* the two — it cancels both handles at [`:1474-1477`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1474) and calls `endRailCollapse()` at [`:1523`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1523) — but not for their adjacency: there the two sit about 47 lines apart, with the hand-over's event and display work between them.

Inserted after `:1035`:

```typescript
        // The cancel above writes no styles, so the genie's transform and
        // opacity are still on the element and the close fade below would
        // animate out of the shrunken, faded state. `endRailCollapse` takes
        // them and the collapse's own `transition` back off, as `setRail`'s
        // detach does for the same reason. Captured first, because the call
        // clears the flag that says whether there was anything to undo.
        const wasCollapsing = this._railCollapseActive;

        this.endRailCollapse();
```

And the fade itself:

```typescript
        this._closeAnimation?.cancel();
        this._closeAnimation = Animation.play(el, {
            // The resting state `endRailCollapse` just restored is only the
            // fade's start state if the browser reaches a style recalculation
            // with it in place — a transition starts from the element's state
            // at the *previous* recalculation, and everything here runs in one
            // task. A `from` buys that: `play` writes it, yields two animation
            // frames, and arms the transition afterwards. Omitted for an
            // ordinary close, which already rests where the fade should start
            // and must not pay two frames for it — nor have a drag's own
            // `transform` overwritten.
            from:       wasCollapsing
                ? { transform: "translate(0, 0) scale(1)", opacity: "1" }
                : undefined,
            to:         { opacity: "0", transform: "scale(0.97)" },
            durationMs: WINDOW_ANIM_DURATION_MS,
            properties: ["opacity", "transform"],
            onComplete: finalize,
        });
```

`translate(0, 0) scale(1)` is `animateRailExpand`'s `to` and `endRailCollapse`'s own transform ([`:3010`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3010)) — the window's resting transform, named the same way in all three places.

---

## Ordered Implementation Steps

Steps 1-9 are the central fix and ship as one code commit. Steps 10-12 are the close fade's start state and ship as the second. Steps 13-14 verify and document.

1. **`packages/lib/tests/core/Animation.test.ts`** — add a `describe('play — superseded by a later animation on the same element')` block after the existing `describe('play')` (it closes at `:410`), holding cases **A1-A6** from `## Expected Behaviour`. Extend the file's header comment with one sentence: *The superseded block is `plans/implemented/animation-finish-transition-clear.md`'s rows — `transition` is one property on one element, so a finishing animation must not clear the rule a later one is running through.*

2. **Run it** — `npm -w packages/lib run test -- Animation`. **A1, A5 and A6 fail; A2, A3 and A4 pass** — the last three are the guards that stop A1 from being satisfiable by never clearing at all.

3. **`packages/lib/src/typescript/lib/core/PendingTransitions.ts`** — add `isSupersededTransition` from `## Internal Structure` after `unregisterTransition`. Then extend the module header comment (`:3-13`): it currently says the registry exists so `Component.destructor()` can stop a deferred write landing on a released handle; add that it also answers, for a transition about to finish, whether a later one on the same element is still running through the `transition` rule it is about to clear.

4. **`packages/lib/src/typescript/lib/core/Animation.ts`** — add `isSupersededTransition` to the `~/core/PendingTransitions.js` import on `:8`, then apply the `finish` change from `## Internal Structure`.

5. **Same file, `play`'s JSDoc** (`:81-108`) — add one sentence to `@remarks`: the transition rule this call installs is taken back off at its completion, unless another animation has since started on the same element, in which case that one's completion does it. Describe it in prose; do **not** `{@link}` `isSupersededTransition`, which is internal and would make `docs:api` warn.

6. **Re-run step 2's file** — A1-A6 all pass. Then `npm -w packages/lib run test -- AbstractWindow.railHandoverAnimated` — R1-R14 all pass, unchanged: the central fix leaves every existing rail row's outcome exactly as it was, which is the finding `## Architecture Decisions` records as a cost.

7. **`packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts`** — add the one prescribed assertion to **R13** (`:379`) and to **R14** (`:410`), and add case **R16** at the end of the `describe`, per `## Expected Behaviour`. R16 must inline `restoringWindow()`'s steps rather than call it, so its `DOM.sink.apply` spy is installed before the genie arms — the row is red on correct code otherwise. All three additions pass immediately; step 8 verifies them by mutation instead.

8. **Mutation-verify steps 7's two assertions.** Delete `animateRailCollapse`'s two `_railExpandAnimation` lines (`:2916-2917`) and re-run the file — R13 must fail. Restore them. Delete `onExitAction`'s two `_railExpandAnimation` lines (`:1034-1035`) and re-run — R14 must fail. Restore them. Then, for **R16**, change `isSupersededTransition`'s body to `return running.has(handle);` and re-run both files — A3 and R16 must both fail. Restore it. None of the three mutations may be left in place.

9. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`** — update the two expand-cancel comments so their stated reason matches the code. `animateRailCollapse` (`:2911-2915`) and `onExitAction` (`:1025-1031`) both justify the expand cancel by "its completion clears the `transition` it armed … cutting the genie short"; `Animation` now refuses that clear for a superseded transition, so each comment says instead that the superseded half's handle is released here rather than one deadline later, keeping all five paths that start, supersede or end the pair uniform.

10. **`packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts`** — add cases **R15**, **R17** and **R18** from `## Expected Behaviour` at the end of the `describe`, and extend the file's header comment with one sentence covering all four rows this plan owns, R16 included: *R15-R18 are `plans/implemented/animation-finish-transition-clear.md`'s rows — a close arriving inside a rail collapse fades out from the window's resting state rather than from the genie, a close arriving at any other time still fades from wherever the window already is, and a reverse genie with a rect animation beside it still clears its own transition.* Then run `npm -w packages/lib run test -- AbstractWindow.railHandoverAnimated`: R15 fails; R1-R14, R16, R17 and R18 pass.

11. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`, `onExitAction`** — insert the `wasCollapsing` capture and the `endRailCollapse()` call immediately after the `_railExpandAnimation` cancel pair step 9 re-commented, then add the conditional `from` to the close fade's `Animation.play` further down the same method. Both snippets are in `## Internal Structure`.

12. **Re-run step 10's file** — R1-R18 all pass. Then **mutation-verify the `from`'s conditionality**, which no red-green cycle reaches: replace `wasCollapsing ? { … } : undefined` with the object alone, so the `from` is unconditional, and re-run — **R17 and R18 must both fail**. Restore the ternary. R11 has been seen to flake about once in ten runs of this file, so re-run before believing a surprising result.

13. **Checkpoint greps:**
    - `grep -c 'this.endRailCollapse()' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — expect `2`: `setRail`'s detach and `onExitAction`. The `this.` prefix is load-bearing: the bare `endRailCollapse()` also matches the declaration on `:2995`, so it already counts `2` on `master` and would count `3` here — a check that fails on correct code and passes when the new call is missing.
    - `grep -c '_railExpandAnimation?.cancel()' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — expect `5`, unchanged by step 8.
    - `grep -rn 'buf.set("transition", null)' packages/lib/src/typescript/lib/core/Animation.ts` — expect exactly one match, inside the `if (!superseded)` guard.

14. **Docs** — the two changelog entries of `## Documentation Impact`. Then run `## Verification` end to end.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/PendingTransitions.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Animation.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/tests/core/Animation.test.ts` |
| Modify | `packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### The rule the fix changes

`play` arms its fallback deadline at `transition-start + duration + 40 ms`. An exit (`to` only) arms its transition in the calling task; an entrance (`from` and `to`) arms it two animation frames later, about 32 ms. So when a second animation **B** starts on the same element, the first animation **A**'s deadline lands *before* B's end whenever B arms more than 40 ms after A did — and B is cut short by exactly that difference.

A 120 ms fade pair on one element, in the engine, all times in milliseconds from the first gesture. (Offline there is no `transitionstart`, so a test's deadline is counted from the `to` write instead — which is why A1-A5 below play the exit shape, whose write and arm are the same moment, and why A6 drains the entrance's two frames before it advances the clock at all.)

| Gestures | A arms | A's deadline | B arms | B ends | Clear lands | B loses |
|---|---|---|---|---|---|---|
| show, then hide at 100 | 32 | 192 | 100 | 220 | 192 | 28 of 120 ms |
| show, then hide at 140 | 32 | 192 | 140 | 260 | 192 | 68 of 120 ms |
| hide, then show at 60 | 0 | 160 | 92 | 212 | 160 | 52 of 120 ms |

After the fix the "clear lands" column reads *at B's end* in every row, and the "B loses" column reads *nothing*. Which pairs a real gesture can drive into this window is in `## Addendum: Which pairs a gesture can reach`.

### Central fix — A1-A6, unit-testable

In `packages/lib/tests/core/Animation.test.ts`, inheriting its `beforeEach` (recording sink, fake timers, hand-drained `requestAnimationFrame`), its `makeElement()`, `stylesSince()`, `DURATION_MS` (100) and `PAST_FALLBACK_MS` (300). A1-A5 play the exit shape (`to` only), so each arms its transition in the calling task and its deadline sits at *arm time + 140 ms*. A6 is the exception: it drives a real `showAnimated()` entrance, whose two-frame yield the row drains before it advances the clock.

A helper for the shared setup: `supersededPair(el)` plays A with `onComplete: aDone`, advances 50 ms, plays B with `onComplete: bDone`, and returns `{ aDone, bDone }`. Both plays are exit shapes with `DURATION_MS`, so A's deadline is at 140 ms and B's at 190 ms.

| Case | Setup | Expected |
|---|---|---|
| A1 | `supersededPair(el)`; mark the writes; `vi.advanceTimersByTime(110)` — past A's 140 ms deadline, short of B's 190 ms | `aDone` called once and `bDone` not called (A's deadline really did fire), and not one style write since the mark carries a `transition` key |
| A2 | as A1, then mark again and `vi.advanceTimersByTime(60)` | `bDone` called once, and the writes since the second mark include `{ transition: null }` — the live animation still clears at its own end |
| A3 | one `play` on `makeElement()`; `vi.advanceTimersByTime(PAST_FALLBACK_MS)` | the writes include `{ transition: null }` — an animation nothing superseded still clears |
| A4 | A with `durationMs: 400` on `el`; advance 50 ms; B with `durationMs: 100` on the same `el`; advance 500 ms | both `onComplete`s called once, and exactly two `{ transition: null }` writes landed: B's at its own end, and A's at its deadline, by which point B has finished and left the registry |
| A5 | `listen = vi.spyOn(DOM.sink, 'addListener')`; `supersededPair(el)`; mark; take **every** recorded `transitionend` handler and invoke each with `{ propertyName: 'opacity' }`, in registration order | both `onComplete`s called once, and exactly one `{ transition: null }` write since the mark |
| A6 | `dropdown = new AnimatedDropdown()`; `getElement(true)`; `showAnimated()`; two `flushFrame()` calls, arming the show fade with its deadline at 160 ms; `vi.advanceTimersByTime(60)`; `dropdown.hideAnimated()`, which arms in the same task with its deadline at 220 ms; **then** mark the writes; then the two phases below | see the two phases below |

The mark is taken **after** `hideAnimated()` returns, as A1's and A5's are: the dismiss arms its own `transition` shorthand synchronously inside that call, so a mark taken before it would put that write inside the window phase 1 asserts is free of `transition` keys, and the row would be red on correct code.

A6 runs in two phases, because one advance past both deadlines cannot tell "the superseded fade completed and skipped its clear" from "the superseded fade never completed at all".

- **Phase 1** — `vi.advanceTimersByTime(110)`, reaching 170 ms: past the show fade's deadline, short of the dismiss's. Since the mark there is a `{ willChange: null }` write — the superseded show fade's own `onComplete` ran — and **not one** write carrying a `transition` key. `dropdown.isVisible()` is still `true`.
- **Phase 2** — `vi.advanceTimersByTime(60)`, reaching 230 ms: exactly one `{ transition: null }` write since the mark, and `dropdown.isVisible()` is `false`.

Two notes on why those two observables and not the obvious ones. **`dropdown.getElement()` is not `null` after the dismiss** and must not be asserted: `hideAnimated`'s `finalize` ([`AnimatedDropdown.ts:249-258`](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L249)) calls `Component.removeElement` ([`Component.ts:1502-1517`](packages/lib/src/typescript/lib/core/Component.ts#L1502)), which detaches the node and leaves `_element` cached; only `Component.release` ([`:1529`](packages/lib/src/typescript/lib/core/Component.ts#L1529)) clears it, and that is gated on `canRelease()`, which returns `false` ([`:4720`](packages/lib/src/typescript/lib/core/Component.ts#L4720)) and is overridden nowhere in the library. `isVisible()` is the part of `finalize` that does change. And **`willChange` is the superseded fade's only observable completion effect**: `showAnimated`'s `onComplete` clears it, while `hideAnimated`'s own `setWillChange("opacity, transform")` dedupes against the value `showAnimated` already set ([`Component.ts:6016`](packages/lib/src/typescript/lib/core/Component.ts#L6016)), so exactly one `willChange` write lands after the mark and it is the one phase 1 is looking for.

Which mutation each case catches:

| Case | Mutation of a shipped line it kills |
|---|---|
| A1 | the `if (!superseded)` guard removed, so `finish` clears unconditionally — A's deadline writes `{ transition: null }` while B is live |
| A2 | the guard's condition inverted, or `buf.set("transition", null)` deleted outright — no clear ever lands |
| A3 | `isSupersededTransition` returning `true` unconditionally, or reduced to `return running.has(handle)` — step 8's mutation. A lone animation then reads as superseded and its rule is never taken off |
| A4 | a `superseded` flag latched when the *next* `play` starts, instead of read from the registry inside `finish` — A would then never clear and the declaration would stay on the element |
| A5 | the guard removed, on `finish`'s **other** entry point: B's `transitionend` reaches A's still-armed `once` listener as well as B's own, so both finishes run off one event |
| A6 | the guard removed, reached from a real library pair rather than two raw `play` calls — and the proof that `showAnimated` and `hideAnimated` do share one element. Phase 1 additionally kills any mutation that stops the superseded fade completing at all, which phase 2's single-clear count would otherwise read as success |

A1's `aDone`/`bDone` assertions are load-bearing, not decoration: without them the case passes whenever nothing ran at all, which is the shape a mutation of the timer arming would produce.

**No row covers `isSupersededTransition`'s `if (!cancels) return false` guard, and none can.** The guard is there to narrow `running.get(handle)`'s `Set | undefined`, not to answer a case that arises: `play` registers at [`Animation.ts:245`](packages/lib/src/typescript/lib/core/Animation.ts#L245) before it arms anything, and `finish` reads the predicate before it unregisters, so the handle always has a non-empty set by then.[^absent-reports-false] Flipping that branch to `true` changes no behaviour and would leave every row green — which is a fact about the branch, not a gap in the rows.

### The rail's expand cancels — R13 and R14 additions, unit-testable

In `packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts`. Each row gains a `DOM.sink.removeListener` spy beside its existing `apply` spy, and one assertion read **before** any frame drain or timer advance:

| Row | Added assertion |
|---|---|
| R13 | after `win.minimize()`, the spy has recorded exactly one `removeListener(element, 'transitionend', …)` — the superseded expansion's handle is released here, not one deadline later |
| R14 | after `win.requestClose()`, the same: exactly one such removal |

Both need the window's element captured before the call (R14 already does) and the filter applied on that element, so a removal on the body host's element cannot satisfy them.

These two assertions pass on the code as it stands. They exist because this plan's central fix removes what previously pinned those four lines: **R13's and R14's "exactly one clear" assertion is satisfied by the central fix alone once it ships**, so without the addition, deleting `animateRailCollapse`'s and `onExitAction`'s expand cancels would leave the whole suite green.[^r13-r14-truth-table] Step 8 verifies them by mutation for that reason. No sharper consequence is available: after the central fix a superseded expansion's `finish` writes nothing and calls nothing, because `animateRailExpand`'s `play` has no `onComplete`, so the listener release is the only trace the cancel leaves.

### The close fade's start state — R15, unit-testable

In the same file, from its `collapsingWindow()` helper — a window whose collapse is in flight *and armed*. The contract: **the element's last committed state before the close fade arms its transition is the window's resting one, and the fade arms a frame later, not in the same task.**

| Case | Setup | Expected |
|---|---|---|
| R15 | `collapsingWindow()`; capture `element = win.getElement()`; spy on `DOM.sink.apply`; `win.requestClose()` — then assert, **before** any `flushFrame()`; then two `flushFrame()` calls and assert again | see the two phases below |

"Last value written" below means the last entry of `styleWritesFor(apply, win, prop, element)` — R4 (`:227`) already reads it that way, with `.pop()`.

Before any frame drain, on `element`:

- the last `transition` value written is `null` — the collapse's rule has been taken off;
- the last `transform` value written is `'translate(0, 0) scale(1)'`;
- the last `opacity` value written is `'1'`.

After two `flushFrame()` calls, on `element`:

- the last `transition` value written contains `'150ms'` — the fade armed one yield later;
- the last `transform` value written is `'scale(0.97)'` — the fade's own end state landed.

Which mutation each phase kills:

| Assertion | Mutation it kills |
|---|---|
| last `transition` is `null` before the drain | `endRailCollapse()` deleted from `onExitAction` — no `transition` write lands at all, so the read is `undefined`; or the `from` deleted, which makes the fade arm in the same task and the last value its own shorthand |
| last `transform` is the resting one | the `from` deleted — the fade then arms in the same task, so its own `to` lands after `endRailCollapse`'s clears and the last value reads `'scale(0.97)'` |
| last `opacity` is `'1'` | the `from` deleted — the last value reads `'0'`, the fade's own end state, for the same reason |
| both, after the drain | the whole `Animation.play` removed from `onExitAction` — phase 1 alone passes for a close that never fades at all, because `endRailCollapse`'s writes are the only ones left |

Both `transform` and `opacity` rows above read the fade's own end state, not the `null` that `endRailCollapse`'s `clearTransform()` and `clearOpacity()` write: [`Animation.ts:236`](packages/lib/src/typescript/lib/core/Animation.ts#L236) writes `config.to` immediately after the shorthand, so once the fade arms in the same task its `to` is the last word on both properties. The assertions still go red — `'scale(0.97)'` is not the resting transform and `'0'` is not `'1'` — but a reader comparing a run against this table should expect those values.

The first phase is what makes R15 a start-state row rather than a write-order coincidence: with the `from` removed, the fade's `transition` shorthand and its `to` land in the same task as `endRailCollapse`'s writes, so every "last value before the drain" reads as the fade's own.

### The reverse genie is not superseded by a rect animation — R16, unit-testable

In the same file. R16 **inlines `restoringWindow()`'s steps instead of calling it**, because the helper drains the two frames that run `applyTransitionAndTo` (`:180-181`), so the reverse genie's `transition` shorthand is written inside the helper and a spy installed afterwards never sees it. R8 (`:309`) installs its spy ahead of `collapsingWindow()` for the same reason; R13 gets away with a spy after the helper only because `win.minimize()` arms a fresh transition under it.

| Case | Setup | Expected |
|---|---|---|
| R16 | `collapsingWindow()`; `runAnimationToCompletion()` so the collapse lands; capture `element = win.getElement()`; **then** spy on `DOM.sink.apply`; `win.restore()`; two `flushFrame()` calls; `vi.advanceTimersByTime(PAST_FALLBACK_MS)`; `flushFrame()` | in `styleWritesFor(apply, win, 'transition', element)`: the first entry contains `'150ms'` — the reverse genie armed its own rule under the spy — and the last entry is `null` — it cleared that rule at its deadline, with `tweenRect`'s `Animation.tween` running alongside it the whole time |

The traced list is exactly `[genie shorthand, null]`; the two assertions are written against its ends rather than its length so an unrelated write appearing between them cannot redden the row. The `transform`, `opacity` and geometry writes the genie and the rect tween also emit carry no `transition` key and are filtered out by `styleWritesFor`.

This is a **guard, not a pin**: it passes before and after the central fix, because `Animation.tween` registers nothing with the transition registry and the genie is therefore the only live transition on that element. What it catches is an over-application of the fix — a widening of `isSupersededTransition` that counted a concurrent rect animation as a supersession, most plausibly a later refactor giving `Animation.tween` a handle and a `registerTransition` call. The genie would then skip its own clear — the list would be `[genie shorthand]` alone and the last-entry assertion would go red — leaving `transition` declared on a window that is back on screen, and every later write to it animated. A3 does not catch that: its `play` runs on a bare element with no tween beside it.

### An ordinary close takes no `from` — R17 and R18, unit-testable

The conditionality of the `from` is load-bearing, and R15 exercises only its `wasCollapsing === true` arm. R14 does not cover the other one: with the `from` made unconditional, its drain sequence still yields `[shorthand, null]` and it stays green. Two rows cover the false arm, in the same file, on a plain `Window` with no rail at all — so `_railCollapseActive` is `false`, `endRailCollapse()` no-ops, and the close fade must arm in the calling task exactly as it does today.

Shared setup: `win = new Window('W')`; `win.show()`; two `flushFrame()` calls to drain the entrance fade's own yield; capture `element = win.getElement()`; spy on `DOM.sink.apply`. Both rows then assert **before** any further `flushFrame()`.

| Case | Setup | Expected |
|---|---|---|
| R17 | the shared setup; `win.requestClose()` | `styleWritesFor(apply, win, 'transition', element)` holds exactly one entry and it contains `'150ms'` — the fade armed in the same task, with no two-frame yield; and `styleWritesFor(apply, win, 'transform', element)` does not contain `'translate(0, 0) scale(1)'` |
| R18 | the shared setup plus `win.setTranslate(20, 20)` before the spy; `win.requestClose()` | `styleWritesFor(apply, win, 'transform', element)` is exactly `['scale(0.97)']` — the fade's own end state and nothing before it, so the element still carries the drag's own transform when the fade arms |

Both catch one mutation: **dropping the `wasCollapsing` ternary so the `from` is passed unconditionally.** They catch it from two sides, and each side is worth having. R17 catches the timing — an unconditional `from` defers `applyTransitionAndTo` by two frames, so no `transition` write lands in the task and the single-entry assertion reads an empty list. R18 catches the state: the `from` writes `translate(0, 0) scale(1)` synchronously, so the window is moved off the drag's position and held there for two frames before the fade starts, and the transform list reads `['translate(0, 0) scale(1)']` instead. R17's `transform` assertion catches the same write on an undragged window, where the resting value is where the window already is and only the extra write betrays the mutation.

Both rows pass before and after this plan's second commit — there is no `from` to be conditional about yet — so they are mutation-verified by step 12 rather than by a red-green cycle, the same way R13, R14 and R16 are.

R12 (`collapsingWindow()`, `requestClose()`, `runAnimationToCompletion()`, expecting `['close']`) stays green: its drain sequence already includes the two frames the `from` branch now yields. R14 is on the *expand* arm, where `_railCollapseActive` is `false`, so `endRailCollapse()` no-ops, no `from` is passed, and the row's write counts are unchanged — which is also why R14 cannot stand in for R17 and R18: unchanged counts are exactly what an unconditional `from` would leave it reading.

### In-engine, by eye — the user's to run

Every item opens a window, so none of it runs offline.

1. **The docs app** (`npm run docs:dev`), the ComboBox page's `combobox-store` demo: click the field's caret to open the dropdown, then click it again about a tenth of a second later, and keep alternating at that rate. Each open and each close should fade and translate over its full 120 ms. Before the fix, the second and later toggles snap — the panel jumps to fully opaque or fully transparent part-way through.
2. **Same app**, the Dialog page's `dialog-basic` demo: open the dialog and press `Escape` immediately, before its entrance fade has settled. The dialog and its backdrop should fade out over the full 150 ms rather than vanishing part-way through.
3. **Same app**, the MenuBar page's `menubar-basic` demo: open a top-level menu and click the neighbouring one straight away. Both the close and the open should fade.
4. **A window attached to a mounted `Rail`**: minimize it and click its close button while the shrink-into-the-rail genie is still running. The window should fade out from its full size and opacity, not from the shrunken, half-faded state it had reached. This is the second commit's behaviour; before it the fade starts mid-genie and reads as the window simply disappearing.
5. **Same setup**: restore the rail-minimized window and minimize it again immediately. The genie should play in full — the behaviour `rail-handover-follow-ups` already shipped, re-checked here because this plan changes how that outcome is produced.
6. **A plain window, no rail**: close one, and close another while dragging it by the header. Each should begin fading the instant the close is clicked — no pause before the fade, and no jump to a different position first. This is the arm R17 and R18 pin offline; the by-eye pass is here because the pause an unconditional `from` would add is ~32 ms, which the rows measure in frames but only an eye judges as a hitch.
7. **Same rail setup, as a control rather than a check of this plan**: minimize the rail-docked window, restore it from the rail handle, then maximize it, watching for motion at each of the three steps. Expected: the minimize genie plays (step 1), and the restore and the maximize look the same as they did before this branch. The restore's and the maximize's missing motion is the separate defect recorded in `## Non-Goals` — if it is still absent, that is not a failure of this plan, and if it has *changed*, say so, because nothing here was meant to touch it.

---

## Verification

1. `npm install` in the worktree, then `npm run typecheck` and `npm -w packages/lib run typecheck:test` — clean.
2. `npm test` from the worktree root — the whole library suite green, including A1-A6 and R1-R18. Never pass a bare `--root`: `llms-generate.test.ts` resolves its fixture from the working directory.
3. `npm run lint` — clean.
4. The three checkpoint greps of *Ordered Implementation Steps* 13, with the `this.`-prefixed `endRailCollapse` pattern that counts calls rather than the declaration too.
5. The four mutation checks, each run and reverted — step 8's three and step 12's: R13 red without `animateRailCollapse`'s expand cancel, R14 red without `onExitAction`'s, A3 and R16 both red with `isSupersededTransition` reduced to `running.has(handle)`, and R17 and R18 both red with the close fade's `from` made unconditional.
6. `npm run docs:api` — `0 errors and 14 warnings`, matching `master`; no exported symbol changes and the new JSDoc sentence adds no `{@link}`. Then `npm run docs:llms:check` — clean. `docs:llms:check` aborts without `docs:api` having run first.
7. `npm run build:lib`, then `npm -w packages/qa run test` — unchanged. The QA suite mis-collects six of its twenty files without the build.
8. The in-engine list under `## Expected Behaviour` — the user's to run.

---

## Documentation Impact

No exported symbol changes: `isSupersededTransition` lives in `core/PendingTransitions.ts`, which no package entry point re-exports, and `Animation.play`'s signature is untouched. `Animation` is not a catalogued capability in `packages/lib/llms.txt`, and no doc page states the clearing behaviour.

Two entries in `packages/lib/docs/reference/changelog/next.md`. The page currently carries an `## Added` section only, so the `## Fixed` heading and its two `###` subheadings are all new; place `## Fixed` after `## Added` and order its subheadings the way `0.10.0.md` does (`### Core` before `### Overlay`). Re-read the page before editing — it collects entries from every branch in flight and may have grown again.

- **`### Core`** — *A completing animation no longer clears a `transition` a later animation on the same element is running through.* State the mechanism in one sentence (`transition` is one property on one element; the animation that started first also finishes first, and its completion was taking the rule out from under the one that superseded it), the visible symptom (a fade or slide that snaps to its end state instead of travelling to it, by as much as its whole duration minus 40 ms), and that no consumer action is needed. Name the surfaces a gesture reaches: `ComboBox` and the other picker dropdowns, `PopupButton` panels, `Menu`, `Popover`, `Dialog`, `Drawer`, and `Window` — whose own element carries four of these animations at once (its entrance fade, its close fade, and the two rail genies), and whose rail pair is the instance `rail-handover-follow-ups` fixed per-site.
- **`### Overlay`** — *A window closed while its rail-minimize genie is still running now fades out from its resting state.* One sentence on the cause (the cancel writes no styles, so the genie's `transform` and `opacity` stayed on the element) and one on the fix (the collapse is undone and the resting state is committed two animation frames before the fade arms, so the close fade of a window caught mid-collapse starts that much later than an ordinary one). No consumer action is needed.

---

## Potential Challenges

- **The superseded animation's `onComplete` now runs with a live `transition` still declared.** A write in such a callback that touches a property in the *live* animation's `properties` list would now animate where it used to snap. Every `onComplete` in the library was enumerated and none does: they write `will-change`, `display` or `visibility`, remove the element, dispose, emit, or — for the rail's collapse and `Rail`'s own `finalize` — write geometry that no concurrent animation on that element lists.[^oncomplete-survey]
- **The registry read must precede the unregister.** `finish` removes itself from the registry, so reading `isSupersededTransition` afterwards would always report `false`. Step 4's snippet puts the read first and says why in a comment.
- **A `play` superseded by an `afterTransition` wait leaves the rule declared**, because `afterTransition` never clears. Unreachable today: the two `afterTransition` owners are `Accordion` and `CollapseSupport`, and neither ever `play`s on an element it waits on.[^no-mixed-element]
- **Closing an already-collapsed rail window now costs two extra frames.** `_railCollapseActive` stays `true` after a collapse completes, so a close on a rail-minimized window also takes the `from` branch. The window is `display: none` by then, so nothing is visible either way; the only effect is that its destruction lands two animation frames later.
- **R15's `collapsingWindow()` must not advance the fake timers before the assertion.** The row reads the writes between `requestClose()` and the first `flushFrame()`; any advance in between lets the fade arm and every "last value" assertion reads the fade's own.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Animation.ts:109-257`](packages/lib/src/typescript/lib/core/Animation.ts#L109) — `play`, its `finish` (`:178`), the registration on `:245`, and the `cancel`-writes-no-styles contract documented on `:97-107`.
- [`packages/lib/src/typescript/lib/core/PendingTransitions.ts`](packages/lib/src/typescript/lib/core/PendingTransitions.ts) — the whole 76-line module; the precedent the new predicate joins.
- [`packages/lib/src/typescript/lib/core/LayerManager.ts:447-478`](packages/lib/src/typescript/lib/core/LayerManager.ts#L447) — `topmostInputLayer` and `isTopmostInputLayer`, the second precedent for a "has a later registration superseded me?" predicate over an ordered stack.
- [`packages/lib/src/typescript/lib/core/Component.ts:1323`](packages/lib/src/typescript/lib/core/Component.ts#L1323) and [`:1557`](packages/lib/src/typescript/lib/core/Component.ts#L1557) — the two paths that cancel every registered transition before releasing a handle, which is why an unregistered `cancel` reporting `false` is safe.
- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts:1015-1075`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1015) — `onExitAction`; [`:1448-1530`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1448) — `setRail`, the precedent for cancel-then-`endRailCollapse`; [`:2995-3014`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2995) — `endRailCollapse` and its cache-dance remarks.
- [`packages/lib/src/typescript/lib/core/OverlayFade.ts`](packages/lib/src/typescript/lib/core/OverlayFade.ts) — `fadeShow` (`:52`) and `fadeHideAndDetach` (`:97`), the shared pair behind `Menu` and `Popover`; both play on `component.getElement()`.
- [`packages/lib/tests/core/Animation.test.ts`](packages/lib/tests/core/Animation.test.ts) — the harness A1-A6 extend, and `stylesSince` / `fireTransitionEnd` / `flushFrame`.
- [`packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts`](packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts) — `collapsingWindow`, `restoringWindow`, `styleWritesFor`, and R13/R14.
- [`plans/implemented/rail-handover-follow-ups.md`](plans/implemented/rail-handover-follow-ups.md) — its `### Every path that starts, supersedes, or ends the rail-animation pair cancels both handles` decision and its `### R13's contract is a write count, so it carries two guards` note.

---

## Non-Goals

- **Suppressing a superseded animation's `onComplete`.** It would make the rail's collapse cancels redundant too, and it would strand callers: `Dialog.hide`'s completion settles the `show()` promise, `Notification`'s drops the toast from a static list, `AnimatedDropdown`'s detaches the panel. See `## Architecture Decisions`.
- **Deleting the rail's two expand cancels.** Argued in `## Architecture Decisions`; they stay and gain a pin.
- **The close fade's start state when a rail *expand* is interrupted.** `animateRailExpand` sets `_railCollapseActive = false` with a reason stated in source, so `endRailCollapse()` is a no-op on that arm and a close mid-expand still fades out of wherever the reverse genie had reached. Covering it needs that flag to mean "either rail genie owns these styles", which reverses a decision `rail-handover-follow-ups` made on the record; and the error is smaller, because an interrupted expand leaves the element between the genie and its resting state rather than at the genie.
- **Property-filtering `play`'s `transitionend` listener.** A multi-property `play` completes on the first property's `transitionend`, and a superseded `play`'s listener fires on the *live* animation's `transitionend`. Both are pre-existing, neither truncates anything once the clear is guarded, and A5 pins the outcome that matters.
- **The missing maximize / restore animation on a rail-docked window.** Observed by the user on `master`, traced, and shown in `## Addendum: Which pairs a gesture can reach` not to be an instance of this truncation: the rect animation `setWindowState` starts beside the reverse genie is either a JS tween that registers no transition or a fade on the body host's element, so the genie's deadline has nothing of its to clear. It wants its own investigation against a running engine, which this plan is fenced off from. R16 pins only that this plan leaves the genie's own clear intact there.
- **Reducing the number of `play` handles on one element.** `AbstractWindow` alone holds four against its own element; consolidating them is a redesign, and the central fix makes the count harmless.

---

## Addendum: Which pairs a gesture can reach

Every family below plays all of its animations on one element, verified at the call sites. "Harm window" is the interval, measured from the first animation's start, in which a second gesture truncates it — from about 40 ms after the first armed its transition to the first's natural end.

| Family | Element | Duration | Harm window | Reachable by |
|---|---|---|---|---|
| `AnimatedDropdown.showAnimated` / `hideAnimated` — [`:225`](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L225), [`:269`](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L269) | the dropdown's own | 120 ms | 8-120 ms (hide→show), 72-152 ms (show→hide) | **Gesture.** `PopupPanel.toggleFor` ([`:175`](packages/lib/src/typescript/lib/overlay/PopupPanel.ts#L175)) opens on one click and closes on the next, so a double- or triple-click on a `PopupButton`, `ComboBox` caret or picker field lands squarely in the window |
| `Menu` fade in / out — [`:740`](packages/lib/src/typescript/lib/overlay/Menu.ts#L740), [`:754`](packages/lib/src/typescript/lib/overlay/Menu.ts#L754) | the menu panel | 120 ms | as above | **Gesture.** Clicking one `MenuBar` item then the next, or `Escape`-then-reopen |
| `Popover.show` / `hide` — [`:512`](packages/lib/src/typescript/lib/overlay/Popover.ts#L512), [`:539`](packages/lib/src/typescript/lib/overlay/Popover.ts#L539) | the popover | 120 ms | as above | **Gesture.** Trigger click, then an outside click or a second trigger click |
| `Dialog.animateIn` / `hide`, panel — [`:990`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L990), [`:1303`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1303) | the dialog panel | 150 ms | 72-182 ms | **Gesture.** `Escape`, a backdrop click or a button press inside the entrance fade |
| `Dialog` backdrop in / out — [`:999`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L999), [`:1319`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1319) | the shared backdrop | 150 ms | as above | **Gesture**, the same one |
| `Drawer.animateIn` / `animateOutAndFinalize` — [`:536`](packages/lib/src/typescript/lib/overlay/Drawer.ts#L536), [`:571`](packages/lib/src/typescript/lib/overlay/Drawer.ts#L571) | the drawer panel | 220 ms | 72-252 ms | **Gesture.** A scrim click or `Escape` inside the slide-in |
| `Drawer` backdrop in / out — [`:596`](packages/lib/src/typescript/lib/overlay/Drawer.ts#L596), [`:616`](packages/lib/src/typescript/lib/overlay/Drawer.ts#L616) | the scrim | 220 ms | as above | **Gesture**, the same one |
| `Notification.animateIn` / `dismiss` — [`:336`](packages/lib/src/typescript/lib/overlay/Notification.ts#L336), [`:583`](packages/lib/src/typescript/lib/overlay/Notification.ts#L583) | the toast | 200 ms | 72-232 ms | **Public parameter.** `Notification.show(message, type, duration)` takes an unclamped `duration` ([`:265`](packages/lib/src/typescript/lib/overlay/Notification.ts#L265)), so `duration: 150` puts the auto-dismiss inside the window. By gesture it needs a click on the close button of a toast that is still sliding in — no ordinary gesture produces it |
| `Tooltip.show` / `hide` — [`:437`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L437), [`:471`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L471) | the shared tooltip | 100 ms | 8-100 ms | **Programmatic only.** Every hover-driven show goes through the 500 ms delay in `_armHoverDelay` ([`:720`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L720)), and a re-show while one is up takes the `alreadyShown` branch ([`:428`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L428)) which plays nothing. A consumer calling the public `Tooltip.show` within 100 ms of `Tooltip.hide` reaches it |
| `Rail` collapse / slide-out / slide-in — [`:677`](packages/lib/src/typescript/lib/overlay/Rail.ts#L677), [`:849`](packages/lib/src/typescript/lib/overlay/Rail.ts#L849), [`:870`](packages/lib/src/typescript/lib/overlay/Rail.ts#L870) | the rail strip | 200 ms | 72-232 ms | **Programmatic only.** The chevron toggle reuses one handle, so it cancels itself; crossing between two of the three needs `mount()` or `unmount()` inside 232 ms of a toggle |
| `AbstractWindow` show / close / rail collapse / rail expand — [`:798`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L798), [`:1069`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1069), [`:2920`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2920), [`:2969`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2969) | the window element | 150 ms | 72-182 ms | **Gesture.** Four handles on one element, not two: the rail pair's three crossings are already fixed, but a close or a minimize inside the entrance fade is not, and both are ordinary clicks |

### Observed, and traced to a different cause — maximize / restore of a rail-docked window

Running the by-eye checks against `master` on 2026-09-29, the user found that **a rail-docked window maximizes and restores with no animation at all**. The path is real and its asymmetry is suggestive: [`setWindowState:1225-1228`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1225) plays the reverse genie on the window's own element for any transition *out of* `"minimized"` while railed, and the `"normal"` and `"maximized"` branches then both call [`animateRect`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3148) in the same task — whereas the minimize direction runs [`animateRailCollapse`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2897) with no `animateRect` beside it, and that genie is the one the user saw working.

**It is not an instance of this truncation, and this plan does not fix it.** `animateRect` runs no CSS transition on the window's own element, so there is no `transition` there for the genie's deadline to take away:

| `animateRect` branch | What it animates | On which element |
|---|---|---|
| `tweenRect` ([`:3338`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3338)) — the small-change path, and the one a restore takes | `Animation.tween`, a JS `requestAnimationFrame` loop whose `onStep` is `commitRect` (`setX`/`setY`/`setWidth`/`setHeight` plus `doLayout`) | no element at all: `tween` takes no `Handle`, declares no `transition`, and never calls `registerTransition` |
| `fadeRectSwap` ([`:3193`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3193)) — the large-change path, and the one a maximize takes | an opacity `play`, then a rect `tween`, then a second opacity `play` | `resolveBodyHost()?.getElement()` (`:3194-3195`), and `findBodyHost` ([`:2737`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2737)) returns a non-chrome **child**, never `this` |

So `isSupersededTransition` reports `false` for the genie on this path — correctly, because nothing on that element supersedes it — and `finish` still clears as it always did. Two candidate causes were found while tracing and neither belongs to this plan: a restore's `animateRect` target is the rect the window never left (the rail branch leaves the geometry untouched, [`:1266-1267`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1266)), so `isLargeRectChange` is `false` and `tweenRect` tweens from a rect to the identical rect — a rect animation with nothing to animate, by design, with the genie meant to supply the motion; and `fadeRectSwap` on a window with no body host commits the target and returns synchronously (`:3199-3204`), so a chrome-only window maximizes as a jump. Settling which one the user saw needs the engine. R16 below is what keeps this plan from making the path worse.

`Tab` is the one class whose two `play` sites can target the same element and is still not a twelfth family: its content fade ([`Tab.ts:2269`](packages/lib/src/typescript/lib/layout/Tab.ts#L2269)) is gated on the selected entry's state being `"ready"` (`:2261`), and an entry becomes `"ready"` only inside `Animation.materialize`'s `onReady` ([`Tab.ts:1976`](packages/lib/src/typescript/lib/layout/Tab.ts#L1976)), which `materialize` invokes from its own fade's `onComplete` ([`Animation.ts:655-658`](packages/lib/src/typescript/lib/core/Animation.ts#L655)) — i.e. from inside the `finish` that has already unregistered that fade. The two are strictly sequential on that element, never concurrent, so neither can supersede the other. `CodeEditor.flashReadOnly` is the other single-handle `play` owner and has no sibling at all.

Two further things remain unknown, and neither is settleable offline. The harm windows above are computed from the library's own constants plus `play`'s two-frame yield and 40 ms buffer; the real `transitionstart` latency moves them, and on a busy main thread it moves them a long way — the comment on [`Animation.ts:206-212`](packages/lib/src/typescript/lib/core/Animation.ts#L206) records a measured ~100 ms delay after a large window's rect commit, which is why the deadline is re-armed from `transitionstart`. And how visible a given truncation is depends on the property: a cut opacity fade reads as a pop, a cut `transform` as a jump, and the threshold for noticing either is a judgement made in the engine. `## Expected Behaviour`'s in-engine list is where both get settled.

---

## Notes

[^why-central]: The alternative — cancelling the other handle at each of the eleven families' play sites, the way `rail-handover-follow-ups` did for the rail — was rejected by the user before this plan was written, and the reason is that it leaves `finish`'s behaviour in place: a twelfth family added later reintroduces the truncation, and nothing in the library says so. The eleven are enumerated in `## Addendum: Which pairs a gesture can reach`; the agenda's count of eight pairs predates two observations — that `Dialog` and `Drawer` each animate a backdrop as well as a panel, and that `AbstractWindow` holds four handles against its own element rather than two.

[^registry-precedent]: `PendingTransitions` already owns exactly this knowledge and already keys it by element handle: `registerTransition` is called by both `play` ([`Animation.ts:245`](packages/lib/src/typescript/lib/core/Animation.ts#L245)) and `afterTransition` ([`:394`](packages/lib/src/typescript/lib/core/Animation.ts#L394)), and `cancelTransitions` is what `Component.destructor` ([`Component.ts:1323`](packages/lib/src/typescript/lib/core/Component.ts#L1323)) and `Component.release` ([`:1557`](packages/lib/src/typescript/lib/core/Component.ts#L1557)) run before releasing a handle — those two and no others; `Component.removeElement` detaches the node without releasing the handle or consulting the registry at all. Adding the question to the module that holds the answer keeps `Animation.ts` and `Component.ts` from importing each other, which is the module's stated reason for existing. The alternative considered was comparing the element's current inline `transition` against the string this `play` wrote: it needs a read through `DOM.source`, and two plays that write identical shorthands — two 150 ms `["opacity","transform"]` fades, which the window's show and close fades are — would be indistinguishable.

[^counts-both]: `afterTransition` exists for a transition installed on the element by something other than `play`, so a wait registered after a `play` means there is another live transition on that element and clearing `transition` would truncate that one too. The converse direction needs no special case: a `play` registered after a wait is the newest registration and still clears, which is right, because it owns the rule it wrote.

[^oncomplete-must-fire]: Suppressing it would break three callers outright. `Dialog.hide`'s `finalize` ([`Dialog.ts:1275`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1275)) is the only place `show()`'s promise is settled; `Notification.finishDismiss` ([`Notification.ts:598`](packages/lib/src/typescript/lib/overlay/Notification.ts#L598)) is the only place a toast leaves the static active list that `restack` writes to; `AnimatedDropdown.hideAnimated`'s `finalize` ([`AnimatedDropdown.ts:249`](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L249)) is the only place the panel detaches and leaves the layer tree. It would also make every one of `rail-handover-follow-ups`'s cancels redundant, which is a much larger change than the one the truncation calls for.

[^clear-survey]: Three facts together. First, the newest animation on the element clears when it completes, so after any burst of animations settles the declaration is off. Second, a superseded animation whose deadline happens to fire *after* the live one finished finds itself alone in the registry and clears anyway — a redundant write of `null` over `null`, and the reason A4 pins that outcome rather than treating it as a bug. Third, the remaining gap is an animation cancelled with the element kept, which writes no styles either before or after this change; the library's answer to that is already an explicit clear at the cancelling site, and `setRail`'s detach calling `endRailCollapse()` is the case R4 and R5 pin.

[^keep-expand-cancels]: Three reasons to keep them. The rule `rail-handover-follow-ups` states — every path that starts, supersedes or ends the pair cancels both handles — is what makes `destructor`, `setRail`, `animateRailExpand`, `animateRailCollapse` and `onExitAction` read alike; deleting two lines restores the asymmetry R14 was written to close. `destructor` and `setRail` must cancel the expand regardless, because they release or hand over the element. And this plan's scope is the central fix and the close fade's start state; removing merged, plan-justified lines from `AbstractWindow` is a third change with an argument of its own to make. What the deletion would buy is that R13 and R14 become sharp pins of the central fix with no new assertions — which is real, and is why the option is recorded rather than dismissed.

[^r13-r14-truth-table]: R13 asserts that exactly one `transition: null` write lands while a collapse supersedes an armed expansion. The four combinations:

    | Central fix | `animateRailCollapse`'s expand cancel | Clears | R13 |
    |---|---|---|---|
    | absent | present | 1 | green |
    | absent | absent | 2 | **red** |
    | present | present | 1 | green |
    | present | absent | 1 | green |

    So the row catches the missing cancel only while the central fix is absent, and catches the missing central fix only while the cancel is absent. Once both ship, either alone satisfies it and the row distinguishes nothing. R14 has the same table with `onExitAction`'s expand cancel. The added listener-release assertion is false in the fourth row, which restores the pin. The central fix itself is pinned sharply by A1, A5 and A6, where neither animation is cancelled at all.

[^absent-reports-false]: `finish` early-returns when `done` or `cancelled` is set, and both `finish` and `cancel` unregister before any later call can reach the predicate, so `cancel` is always registered at the point `finish` reads it. `cancelTransitions` drops the whole per-handle entry and then invokes each cancel, which sets `cancelled` — so a handle released underneath a live transition takes the early return rather than the predicate. Reporting `false` for an absent registration is therefore unreachable defensive behaviour, and it degrades to exactly what the library did before this plan: clear the rule.

[^from-not-just-undo]: A CSS transition starts by comparing the element's *before-change* style — its computed style as of the previous style change event — against its after-change style. Every write inside one task collapses into a single after-change style, so writing the resting `transform` and then the fade's `scale(0.97)` in the same task leaves the browser comparing the mid-genie value it last computed against `scale(0.97)`, and the fade animates out of the genie exactly as before. Nothing in between is visible to it: `endRailCollapse`'s `setTransition("none")` and `clearTransition()` collapse the same way. A forced style recalculation would commit the resting state — `relayoutMinimizedStack()` runs between the two points and may cause one — but depending on whether an unrelated relayout happens to read geometry is not a contract. `play`'s `from` is: it writes `from`, yields two `requestAnimationFrame` turns so a style change event lands with it in place, and arms the transition only afterwards. The two-frame count is `play`'s own, because one frame still races layout in Firefox.

[^conditional-from]: An unconditional `from` would cost every window close two animation frames before its fade starts, roughly 32 ms of dead time on the commonest overlay gesture in the library, in a codebase whose whole render-review campaign was about exactly that kind of cost. It would also read worse for a window closed mid-drag. The fade's own `to` of `scale(0.97)` discards a `setTranslate` offset either way, since `transform` is one property; what the `from` adds is that the discard happens two frames *earlier* and on its own — the window jumps back to its undragged position, sits there for the yield, and only then begins to fade, instead of losing the offset in the same frame the fade starts. R18 pins the difference. The flag `_railCollapseActive` already means "a rail collapse owns this element's transform, opacity and transition" ([`AbstractWindow.ts:335`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L335)), which is precisely the condition under which the resting state has to be re-committed.

[^oncomplete-survey]: The enumeration, by animated property list. `OverlayFade`'s two completions and `AnimatedDropdown`'s write `will-change` and then either nothing (the superseded arm returns early on its `_dismissing` guard) or `setVisible(false)` plus `removeElement()`; neither `will-change` nor `visibility` appears in any `properties` list. `Tooltip.hide`'s returns early on the same kind of guard. `Dialog.hide`'s, `Drawer.animateOutAndFinalize`'s and `Notification.dismiss`'s destroy or detach the element. `Rail`'s collapse `finalize` calls `applyRestingGeometry()`, which writes `width`/`height` and sometimes `left`/`top` — the rail's own tween properties, but the only other animations on that element are the two slides, whose list is `["transform"]` alone. `AbstractWindow`'s rail collapse ends in `setDisplayed(false)`, which writes `display`. `Animation.materialize`'s internal fade removes the spinner. `Tab`'s tab-switch fade and `Notification.animateIn` have no completion callback at all.

[^no-mixed-element]: `Animation.afterTransition` has three call sites — `CollapseSupport.primeCollapse` ([`CollapseSupport.ts:163`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L163)) and `Accordion`'s shrink and wrapper waits ([`Accordion.ts:1844`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1844), [`:3011`](packages/lib/src/typescript/lib/layout/Accordion.ts#L3011)) — and all three target a laid-out child or an internal wrapper. `Animation.play`'s call sites are the overlay classes, `OverlayFade`, `Tab`'s content fade and `CodeEditor`'s read-only flash. No element appears in both lists.

---

## Implementation Notes

Implemented as planned; the central fix and the close fade's start state ship
as the two code commits `## Ordered Implementation Steps` calls for, and every
step's predicted red/green outcome held exactly as written. Deviations and
findings worth recording:

- **`## Verification` item 6's warning count is stale.** It expects
  `0 errors and 14 warnings, matching master`. The phase-1 branch
  `docs-api-warning-clearance` cleared all fourteen, and
  [`CODE_CONVENTIONS.md`](../../CODE_CONVENTIONS.md)'s standing bar is now
  **zero** warnings on every branch. Measured on this worktree: 0 warnings
  before any change and 0 after, so the bar is met on its current terms
  rather than the plan's.
- **`plans/in-progress/` did not exist** in this worktree and was created by
  the in-progress move.
- **Two test-local names the plan described only in prose.** The `'150ms'`
  literal R15, R16 and R17 all read is a module constant
  `WINDOW_ANIM_DURATION_DECL` with a comment saying why it is spelled out
  rather than imported (`WINDOW_ANIM_DURATION_MS` is module-private to
  `AbstractWindow`), per the magic-number convention. R17's and R18's
  "shared setup" is a `plainShownWindow()` helper, matching the file's
  existing `collapsingWindow` / `restoringWindow` idiom rather than being
  duplicated across the two rows.
- **R13's and R14's own pre-existing setup comments were corrected.** Both
  stated that the superseded expansion's completion clears the `transition`
  the live animation is running through — which the central fix makes false.
  They now say that is what *used to* happen, with the surviving reason for
  the cancel in the new assertion's comment. Not in the plan, but a comment
  this branch falsified.

All four prescribed mutations were applied and reverted, and each went red
where the plan said it would: deleting `animateRailCollapse`'s expand cancel
reddened R13 alone; deleting `onExitAction`'s reddened R14 alone; reducing
`isSupersededTransition` to `return running.has(handle)` reddened A3 and R16
(and A2, A4, A5, A6, R13, R14 besides); and making the close fade's `from`
unconditional reddened R17 and R18 — R17 on the timing (its transition list
reads empty) and R18 on the state (`translate(0, 0) scale(1)` written over
the drag's own transform). No assertion this plan added is vacuous.

Measured on this worktree, against its own baselines rather than any figure
in the plan: library suite 521 files / 8765 (8763 + 2 todo) before, 521 /
8775 (8773 + 2 todo) after — exactly the ten rows added, A1-A6 and R15-R18.
QA suite 20 files / 453 tests, unchanged. `npm run typecheck`,
`npm -w packages/lib run typecheck:test`, `npm run lint`, `npm run build:lib`
and `npm run docs:llms:check` all clean. The three checkpoint greps report
`2`, `5` and one match inside the `if (!superseded)` guard. R11, noted in
step 12 as flaking about once in ten runs, was stable across six runs of its
file here.

`## Expected Behaviour`'s **in-engine, by-eye list is not run** and remains
the user's. Every item opens a real window, which this run is fenced off
from; it is the `implement` standard's documented manual-verify substitute,
not a skipped check. Item 7 is the control for the separate
maximize/restore-on-a-railed-window defect `## Non-Goals` fences off, and
R16 is the offline guard that this branch leaves that path's own clear
intact.
