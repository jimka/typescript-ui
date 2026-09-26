---
depends-on: [rail-minimized-dock-slot]
touches-shared:
  - packages/lib/src/typescript/lib/overlay/AbstractWindow.ts
  - packages/lib/src/typescript/lib/overlay/Rail.ts
  - packages/lib/tests/overlay/AbstractWindow.minimizedViewportResize.test.ts
  - packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts
  - packages/lib/docs/components/Rail.md
  - packages/lib/docs/reference/changelog/next.md
---

# Rail Hand-Over Follow-Ups — Implementation Plan

## Overview

A window can minimize in one of two places: the **dock** — the gap-free row of header-height strips along the bottom of the viewport that [`AbstractWindow.relayoutMinimizedStack`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3010) lays out — or a [`Rail`](packages/lib/src/typescript/lib/overlay/Rail.ts), which hides the window and puts a handle on the strip in its place. [`AbstractWindow.setRail`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1432) moves an already-minimized window between the two.

[`rail-minimized-dock-slot`](plans/implemented/rail-minimized-dock-slot.md) built that hand-over and left seven observations in its own notes, none of them introduced by it. This plan fixes three of them and states why the other four stand. All the code changes are in [`overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts); no exported symbol changes.

| # | Observation | Verdict |
|---|---|---|
| O1 | A window handed back to the dock lands at its own minimum size, not the row's strip height, so it stands taller than its neighbours | **Fix** — run the docked branch's own preparation from the detach |
| O2 | A collapsed rail raises a window's handle hidden, so an attach to one leaves the window with nothing on screen | **Stands** — the collapsed strip is the representation; already documented |
| O3 | `Rail.unmount` keeps its registrations, so minimized windows stay hidden with their handles off-screen | **Stands** — one doc sentence; a hand-back would break the documented remount |
| O4 | `setRail` does not cancel `_stateAnimHandle`, so a dock tween outlives the hand-over | **Stands** — programmatic-only, self-healing, cosmetic |
| O5 | `endRailCollapse` leaves `transform-origin` behind and clears rather than restores | **Stands** — the clear would not even reach the declaration |
| O6 | `onExitAction` cancels no rail animation handle, so a close mid-collapse leaves one running | **Fix** — cancel both, as `destructor` and `setRail` do |
| O7 | `animateRailExpand` cancels only its own handle, so a restore mid-collapse hides the window unrecoverably | **Fix** — the same pairing, plus its mirror in `animateRailCollapse` |

O7 is the seventh observation in the same notes, recorded there "for whoever picks the sizing plan up". It is the most severe of the set and its fix is the same two lines as O6's, so it ships here.[^o7-scope]

---

## Architecture Decisions

### The detach runs the docked branch's own preparation — O1

The `rail === null` branch of `setRail` relaxes the window's normal-resize minimum size and hides its body host, which is exactly what [`setWindowState`'s docked branch](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1262) does for a window entering the dock by minimizing.[^o1-precedent] Nothing new is needed on the way out: `restoreNormalMinSize` and the `"normal"` branch's `setBodyHostDisplayed(true)` already undo both.[^o1-undo]

The attach direction gets neither the relaxation nor the hide.[^o1-attach]

### Every path that starts, supersedes, or ends the rail-animation pair cancels both handles — O6, O7

A rail minimize plays a collapse (`_railCollapseAnimation`); a rail restore plays an expand (`_railExpandAnimation`). Whenever one of the pair takes over from the other, or the window's animated life ends, **both** handles are cancelled — not just the one the path is about.[^pair-rule] [`destructor`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1092) and [`setRail`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1458) already cancel both; three paths do not.

| Path | Cancels today | Cancels after | What the uncancelled handle does |
|---|---|---|---|
| `destructor` (`:1092`) | both | both — unchanged | — |
| `setRail` (`:1458`) | both | both — unchanged | — |
| `animateRailExpand` (`:2913`) | expand | **both** | the collapse lands and calls `setDisplayed(false)` on a `"normal"` window, hiding it with no route back |
| `onExitAction` (`:1022`) | neither | **both** | the collapse lands and emits `"minimize"` after `"close"`, on a window already unregistered |
| `animateRailCollapse` (`:2875`) | collapse | **both** | the expand's completion clears the transition the collapse is running through, cutting the genie short |

`Animation.cancel` writes no styles ([`Animation.ts:98`](packages/lib/src/typescript/lib/core/Animation.ts#L98)), so none of these cancels changes what is on the element — each only stops a completion callback and a transition clear from landing later.[^cancel-writes-nothing]

### A collapsed rail's strip is the minimized window's representation — O2 stands

A collapsed rail shows no handles at all, for windows and drawers alike, and its chevron is what expands it again. No code changes; the existing doc sentences stay.[^o2]

### An unmounted rail keeps what it holds — O3 stands

`Rail.unmount` is documented as reversible: registrations survive so a later `mount()` restores a working strip. Handing minimized windows back to the dock would either unregister them — breaking that — or need a park-and-unpark mechanism the framework has no precedent for. `unmount`'s JSDoc and `Rail.md` gain one sentence saying what the state is; no code changes.[^o3]

### The dock tween a rail attach outlives stays uncancelled — O4 stands

`setRail` still does not touch `_stateAnimHandle`. Reaching the case needs a `setRail` call inside the 150 ms of a programmatic docked minimize, no gesture produces it, and the next state change cancels the tween anyway.[^o4]

### `endRailCollapse` leaves `transform-origin` alone — O5 stands

The collapse's `transform-origin: 0 0` is written **inline** by `Animation`, while [`Component.clearTransformOrigin`](packages/lib/src/typescript/lib/core/Component.ts#L3712) writes the component's `#id` stylesheet rule — so the obvious one-line undo would not reach the declaration it is meant to clear. Nor does `endRailCollapse` save and restore a consumer's own `transform` / `opacity` / `transition`; it clears them, the same limitation [`endBodyFade`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3250) has.[^o5]

---

## Internal Structure

### `setRail` — the detach branch, [`AbstractWindow.ts:1499-1508`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1499)

The existing `if (rail === null)` block gains the preparation, still ahead of the `relayoutMinimizedStack()` call on `:1510` that writes the row's geometry.

```typescript
            // A window that genuinely collapsed into the rail is still
            // wearing that collapse, and the cancel above writes no styles —
            // only a completion clears what `Animation` armed. Nothing else
            // will take any of it off once the rail is gone, since the reverse
            // genie is gated on `_rail`: the window would be shown still faded
            // out, invisible but hit-testable above the rail, and every later
            // write to it would animate through the transition left behind.
            if (rail === null) {
                this.endRailCollapse();

                // The window is a docked strip from here, but it never ran the
                // preparation `setWindowState`'s docked branch runs for one:
                // the relayout below writes the row's strip height, which the
                // window's own normal-resize minimum would clamp straight back
                // up to its 200px body floor, and its body host would still be
                // laid out inside a strip that cannot show it. Run both now, so
                // a handed-back window is indistinguishable from one that
                // minimized into the dock. `restoreNormalMinSize` and the
                // `"normal"` branch's own `setBodyHostDisplayed(true)` undo them
                // on the way out. Guarded as the docked branch guards it, so a
                // window that reached the rail *from* the dock does not
                // overwrite the real floor with the relaxed 0x0 it already
                // carries.
                if (this._normalMinSize === null) {
                    this._normalMinSize = this.getMinSizeConstraint();
                }
                this.setMinSize({ width: 0, height: 0 });
                this.setBodyHostDisplayed(false);
            }
```

### `animateRailExpand` — the cancel pairing, [`AbstractWindow.ts:2913-2919`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2913)

```typescript
        // The collapse this expansion supersedes goes with the ownership handed
        // over above. `Animation.cancel` writes no styles, so the genie this
        // expansion animates out of is left exactly where it is — what the
        // cancel stops is the collapse's completion, which ends in
        // `setDisplayed(false)` and an `emit("minimize")` and would otherwise
        // land on a window whose state is `"normal"` again by then, hiding it
        // with no route back (`setWindowState` early-returns on the state it is
        // already in). Cancel both, the way `setRail` and `destructor` do.
        this._railCollapseAnimation?.cancel();
        this._railCollapseAnimation = null;
        this._railExpandAnimation?.cancel();
        this._railExpandAnimation = Animation.play(element, {
```

### `animateRailCollapse` — the mirror, [`AbstractWindow.ts:2875-2882`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2875)

```typescript
        // And the expansion this collapse supersedes, for the same reason in
        // the other direction: its completion clears the `transition` it armed
        // (`Animation`'s own `finish` does), which is the very declaration this
        // collapse is running through, so leaving it to land cuts the genie
        // short at whatever frame it reached.
        this._railExpandAnimation?.cancel();
        this._railExpandAnimation = null;
        this._railCollapseAnimation?.cancel();
        this._railCollapseAnimation = Animation.play(element, {
```

### `onExitAction` — the cancel pairing, [`AbstractWindow.ts:1022-1023`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1022)

```typescript
        this._stateAnimHandle?.cancel();
        this._stateAnimHandle = null;

        // A close arriving inside a rail minimize's 150ms genie ends this
        // window's animated life, so the pair goes too — the way `destructor`
        // and `setRail` cancel it. Left running, the collapse's completion
        // emits `"minimize"` after the `"close"` above, on a window whose rail
        // has already dropped it, and writes its own `transform` / `opacity`
        // over the close fade below.
        this._railCollapseAnimation?.cancel();
        this._railCollapseAnimation = null;
        this._railExpandAnimation?.cancel();
        this._railExpandAnimation = null;
```

The deferred `"minimize"` a cancelled collapse owes is **not** fired here, unlike in `setRail`.[^exit-no-emit]

---

## Ordered Implementation Steps

1. **`packages/lib/tests/overlay/AbstractWindow.minimizedViewportResize.test.ts`** — add two helpers beside `shownWindow` (`:115`): `contentWindow(title)`, returning `new Window(title, { contentFactory: () => new Panel() })` after `show()` (import `Panel` from `~/core/Panel`), and `bodyHostDisplayed(win)`, returning `(win as unknown as { resolveBodyHost(): { isDisplayed(): boolean } | null }).resolveBodyHost()?.isDisplayed()`. Then add cases **W29–W31** from `## Expected Behaviour` at the end of the `describe`. Extend the file's header comment with one sentence: *W29–W31 are `plans/rail-handover-follow-ups.md`'s sizing rows — a window handed back to the dock arrives as a dock strip, not at its own minimum size.*

2. **Run it** — `npm -w packages/lib run test -- AbstractWindow.minimizedViewportResize`. W29 and W30 fail; W31 passes already; W1–W28 pass.

3. **`packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts`** — give `collapsingWindow` (`:126`) an optional `events?: string[]` parameter, wiring the window's `"minimize"` / `"restore"` / `"close"` listeners to push onto it **before** the `win.setRail(rail)` call it already makes; add the `restoringWindow()` helper `## Expected Behaviour` specifies beside it; then add cases **R10–R13** at the end of the `describe`. Extend the file's header comment with one sentence: *R10–R13 are `plans/rail-handover-follow-ups.md`'s rows — every path that supersedes or ends the collapse/expand pair cancels both of its handles.*

4. **Run it** — `npm -w packages/lib run test -- AbstractWindow.railHandoverAnimated`. R10–R13 fail; R1–R9 pass.

5. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`, `onExitAction`** (`:1022`): insert the comment and four cancel lines from `## Internal Structure` after the `_stateAnimHandle` pair.

6. **Same file, `animateRailExpand`** (`:2913`): insert the comment and the two `_railCollapseAnimation` lines from `## Internal Structure` immediately above the existing `this._railExpandAnimation?.cancel();`.

7. **Same file, `animateRailCollapse`** (`:2875`): insert the comment and the two `_railExpandAnimation` lines from `## Internal Structure` immediately above the existing `this._railCollapseAnimation?.cancel();`.

8. **Re-run step 4's file** — R1–R13 all pass.

9. **Same file, `setRail`** (`:1506-1508`): extend the `if (rail === null)` block with the preparation from `## Internal Structure`. Do not move the block — it must stay ahead of `AbstractWindow.relayoutMinimizedStack()` on `:1510`.

10. **Re-run step 2's file** — W1–W31 all pass.

11. **Docs** — the eight edits of `## Documentation Impact`.

12. **Checkpoint greps**, after the docs, because the last one reads a comment step 11 rewrites:
    - `grep -c '_railCollapseAnimation?.cancel()' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — expect `5`: `destructor`, `setRail`, `animateRailExpand`, `animateRailCollapse`, `onExitAction`.
    - `grep -c '_railExpandAnimation?.cancel()' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — expect `5`, the same five paths.
    - `grep -n 'setMinSize({ width: 0, height: 0 })' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — expect exactly two matches: the docked branch of `setWindowState` and the new detach branch of `setRail`.
    - `grep -n 'follow-up hand-over plan' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — zero matches.

13. **Verification** — run `## Verification` end to end.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Rail.ts` |
| Modify | `packages/lib/tests/overlay/AbstractWindow.minimizedViewportResize.test.ts` |
| Modify | `packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts` |
| Modify | `packages/lib/docs/components/Rail.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

### Sizing — W29–W31, unit-testable

In `packages/lib/tests/overlay/AbstractWindow.minimizedViewportResize.test.ts`, inheriting its `beforeEach` (test DOM at 1280×800, the `requestAnimationFrame` / `setTimeout` mocks, and the reduced-motion mock that commits every state change synchronously) and its `afterEach`.

The contract: **a window handed back to the dock is indistinguishable from one that minimized into the dock.** So each case compares the handed-back window against a directly-docked sibling rather than pinning a pixel value.

With two content-bearing windows — A minimized straight into the dock, B round-tripped through a rail:

| Window | Route | Height | Body host |
|---|---|---|---|
| A | `minimize()` | strip height | hidden |
| B | `setRail(rail)`, `minimize()`, `setRail(null)` | strip height | hidden |

Today B's height is its own 200 px minimum and its body host is still displayed.

| Case | Setup | Expected |
|---|---|---|
| W29 | `mountedRail()`; `a = contentWindow('A')`, `a.minimize()`; `b = contentWindow('B')`, `b.setRail(rail)`, `b.minimize()`, `b.setRail(null)` | `b.getHeight()` equals `a.getHeight()`, and `b.getY()` equals `a.getY()` (today `b.getHeight()` is `200` against A's `34`, and `b.getY()` matches because the dock anchors both to the viewport bottom) |
| W30 | as W29 | `bodyHostDisplayed(b)` is `false`, matching `bodyHostDisplayed(a)` (today `true` for B) |
| W31 | `mountedRail()`; `b = contentWindow('B')`; capture `min = b.getMinSizeConstraint()`; `b.setRail(rail)`, `b.minimize()`, `b.setRail(null)`, `b.restore()` | `b.getMinSizeConstraint()` equals `min`; `bodyHostDisplayed(b)` is `true`; `b.getWindowState()` is `'normal'` — the relaxation and the hide are both undone by the existing restore path |

W31 passes before the fix as well (there is nothing to undo yet) and is the guard that the fix does not strand either change.

### Animation pairing — R10–R13, unit-testable

In `packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts`, inheriting its frame-and-fake-timer harness, its `collapsingWindow()` helper (a window whose collapse is in flight **and armed**), its `runAnimationToCompletion()` and its `styleWritesFor()`.

R13 needs a window whose *expand* is in flight and armed, so add a `restoringWindow()` helper: `collapsingWindow()`, then `runAnimationToCompletion()` to let the collapse land, then `win.restore()` followed by two `flushFrame()` calls to arm the expand.

| Case | Setup | Expected |
|---|---|---|
| R10 | `collapsingWindow()`; `win.restore()`; `runAnimationToCompletion()` | `win.isDisplayed()` is `true` and `win.getWindowState()` is `'normal'` (today the abandoned collapse lands and hides it) |
| R11 | `collapsingWindow(events)`; `win.restore()`; `runAnimationToCompletion()` | `events` is exactly `['restore']` — the cancelled collapse announces no minimize for a window that is `"normal"` again (today `['restore', 'minimize']`) |
| R12 | `collapsingWindow(events)`; `win.requestClose()`; `runAnimationToCompletion()` | `events` is exactly `['close']` (today `['close', 'minimize']`) |
| R13 | `restoringWindow()`; spy on `DOM.sink.apply`; `win.minimize()`; two `flushFrame()` calls; `vi.advanceTimersByTime(PAST_FALLBACK_MS)`; `flushFrame()` | `styleWritesFor(apply, win, 'transition')` holds exactly one `null` — the collapse's own clear (today two, because the superseded expand's deadline clears the transition the collapse is running through) |

R11's and R12's listeners are wired inside `collapsingWindow`, ahead of its `setRail` call, and not afterwards: `ListenerBag.fire` walks the live bucket array, so a listener sitting behind one that removes itself mid-fire is skipped entirely.[^listener-order]

### In-engine, by eye — the user's to run

- A window handed back from a rail sits flush in the row beside its docked neighbours instead of standing taller with a sliver of its body showing.
- Clicking minimize twice in quick succession on a rail-docked window leaves the window on screen and usable, not hidden with a dead handle on the rail.
- Closing a rail-docked window immediately after minimizing it fades out once, rather than fighting the shrink-into-the-rail genie.
- Restoring a rail-docked window and immediately minimizing it again plays the full genie rather than snapping part-way.

---

## Verification

1. `npm run typecheck` and `npm -w packages/lib run typecheck:test` — clean.
2. `npm test` — the whole library suite green, including W1–W31 and R1–R13. `tests/overlay/Rail.test.ts`, `AbstractWindow.minimizedStackResize.test.ts` and `AbstractWindow.minimizeMinSize.test.ts` must pass unchanged.
3. `npm run lint` — clean.
4. The four checkpoint greps of *Ordered Implementation Steps* 12.
5. `npm run docs:api` — the warning count must match `master`'s; no exported symbol changed. `npm run docs:llms:check` — clean.
6. The in-engine list under `## Expected Behaviour` — the user's to run, since it opens windows.

---

## Documentation Impact

No exported symbol changes, so the generated API pages and `packages/lib/llms.txt` are untouched. Eight prose edits across four files.

- **[`AbstractWindow.ts:1420-1426`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1420), `setRail`'s `@remarks`**: replace *"It comes back at its slot's position but at its normal minimum size rather than the row's strip height, so it stands taller than the strips beside it until it is restored."* with *"It comes back as a dock strip — at its slot's position, at the row's strip height, with its body hidden — and its own minimum size and body return when it is restored."*

- **[`AbstractWindow.ts:1484-1488`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1484), `setRail`'s inline comment**: the parenthetical *"(pre-existing, and the follow-up hand-over plan's to fix)"* becomes *"(by design — the collapsed strip's chevron is what expands it again)"*. That parenthetical is the only place in the source that promises this plan will fix O2.

- **[`Rail.ts:817-823`](packages/lib/src/typescript/lib/overlay/Rail.ts#L817), `unmount`'s JSDoc**: after *"Registered drawers and windows keep their subscriptions, so a later `mount()` restores a working strip."*, add *"A window minimized into the rail therefore stays minimized and hidden while the rail is unmounted, with no handle anywhere on screen; mounting the rail again brings its handle back, and {@link AbstractWindow.restore} still reaches it meanwhile."*

- **`packages/lib/docs/components/Rail.md`**, two edits:
  - `:9`, after *"Registered drawers and windows survive an unmount, so a later `mount()` restores a working strip."*: add *"A window minimized into the rail stays minimized and hidden while the rail is unmounted, with no handle on screen until it mounts again."*
  - `:78`, in the `setRail` paragraph: replace *"It comes back at that slot's position but at its own normal minimum size rather than the row's strip height, so it stands taller than the strips beside it until it is restored."* with *"It comes back as a strip like any other in the row — its own minimum size and its body content return when it is restored."* In the collapsed-rail sentence earlier in the same paragraph, replace *"until the rail is expanded."* with *"until the rail is expanded, which the collapsed strip's own chevron does."*

- **`packages/lib/docs/reference/changelog/next.md`**, `## Fixed` → `### Overlay`, two edits:
  - In the existing *"A window minimized into a [`Rail`](/components/Rail) no longer takes a slot in the bottom dock strip"* entry (`:1810`), replace *"It returns at its slot's position but at its own normal minimum size rather than the row's strip height, so it stands taller than the strips beside it until restored."* with *"It returns as a strip like any other in the row."*
  - Append a new entry at the end of the section:

    > **A rail-minimized window survives a restore or a close that arrives mid-animation.** A window minimizing into a [`Rail`](/components/Rail) shrinks into its handle over 150 ms, and three paths let that animation outlive the thing it belonged to. A `restore()` inside the window — two quick clicks on the minimize button — left the shrink to complete afterwards and hide a window whose state was already `"normal"`, with no route back: the rail's handle no longer restored it and `setWindowState` refused a state it was already in. A close inside the same window left it to complete against a closing window, emitting a `"minimize"` after the `"close"` and writing its own transform and fade over the close's. And a minimize arriving during a restore's reverse animation let that animation's end clear the transition the new one was running through, cutting it short. Each of the three now cancels both animations, as closing and re-railing the window already did. No consumer action is needed.

Two doc sentences stay softened, because O4 is not fixed: `relayoutMinimizedStack`'s JSDoc ([`:3003-3005`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L3003)) and `Rail.md:78` both say the loop *writes no geometry* rather than that a rail-held window's rect is untouched. Leave both exactly as they are.

---

## Potential Challenges

- **The detach's preparation must precede the relayout.** `relayoutMinimizedStack()` on `:1510` is what writes the strip height; a relaxation added after it has no effect until the next relayout. Step 9 keeps the new lines inside the existing `if (rail === null)` block.
- **`getMinSizeConstraint()` can in principle return `null`**, leaving the guard armed and the relaxed `0 × 0` never reinstated. `initChrome` (`:485`) always seeds a minimum, so no window reaches that state; the docked branch has carried the same shape since it was written and the mirror adds no handling for it.[^null-min]
- **The W-series' plain `new Window(title)` has no body host at all**, because `findBodyHost` returns the first non-chrome child and a bare window has none. W29–W31 must use step 1's `contentWindow` helper; against a bare window the body-host assertions compare `undefined` with `undefined` and prove nothing.
- **A listener registered after the rail's own is silently skipped when the rail's fires and removes itself.** `ListenerBag.fire` walks the live array, which is why step 3 wires R11's and R12's listeners inside `collapsingWindow`, ahead of its `setRail` call, rather than in the cases themselves.[^listener-order]
- **R13's two-clear count depends on both fallback timers being scheduled at the same virtual time.** No timer advance may sit between arming the expand and calling `minimize()`, or the expand's deadline fires before the collapse is armed and the count reads 1 either way.

---

## Critical Files

- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) — the four sites this plan changes (`:1015` `onExitAction`, `:1432` `setRail`, `:2861` `animateRailCollapse`, `:2890` `animateRailExpand`) and the three it mirrors: `:1073` `destructor` (the cancel-both precedent), `:1262` `setWindowState`'s docked branch (the preparation O1 copies), and `:1322` `restoreNormalMinSize` (its undo).
- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts:2940-2959`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2940) — `endRailCollapse`, and `:3250` `endBodyFade`, the precedent O5 is measured against.
- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts:663-747`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L663) — `chromeMinSize` and the `setWidth` / `setHeight` clamps: why relaxing the explicit minimum lands the window at the strip height and no lower.
- [`packages/lib/src/typescript/lib/core/Animation.ts:109-254`](packages/lib/src/typescript/lib/core/Animation.ts#L109) — `play`: its per-call inline-style buffer, the `transition` clear in `finish` (`:201`), and the cancel that writes no styles. Both the pairing rule and O5's verdict rest on this.
- [`packages/lib/src/typescript/lib/core/Component.ts:3653-3716`](packages/lib/src/typescript/lib/core/Component.ts#L3653) — `setTransform` / `clearTransform` (inline) beside `setTransformOrigin` / `clearTransformOrigin` (the `#id` rule). The split is O5's whole argument.
- [`packages/lib/src/typescript/lib/overlay/Rail.ts:731-1077`](packages/lib/src/typescript/lib/overlay/Rail.ts#L731) — `setAllHandlesDisplayed`, `unmount`, `registerWindow`, `showWindowHandle`: what a collapsed rail does to its handles (O2) and what an unmount leaves behind (O3).
- [`packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts`](packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts) — R1–R9, and the frame/fake-timer harness R10–R13 extend.
- [`packages/lib/tests/overlay/AbstractWindow.minimizedViewportResize.test.ts`](packages/lib/tests/overlay/AbstractWindow.minimizedViewportResize.test.ts) — W1–W28, and the helpers and reduced-motion mock W29–W31 extend.
- [`plans/implemented/rail-minimized-dock-slot.md`](plans/implemented/rail-minimized-dock-slot.md) — its `## Non-Goals` scopes O1 to exactly this plan, and its Implementation Notes (`:515-545`) record all seven observations.

---

## Non-Goals

- **O2, a collapsed rail's hidden window handle.** No behaviour change; one source comment is corrected because it promises a fix here. See `## Architecture Decisions`.
- **O3, a hand-back on `Rail.unmount`.** One doc sentence, no mechanism. See `## Architecture Decisions`.
- **O4, cancelling `_stateAnimHandle` from `setRail`.** Not changed, so `relayoutMinimizedStack`'s JSDoc and `Rail.md:78` keep the softened *writes no geometry* wording rather than reverting to an absolute claim about the window's rect. See `## Documentation Impact`.
- **O5, `endRailCollapse`'s `transform-origin` and its clear-versus-restore.** Not changed. See `## Architecture Decisions`.
- **Symmetry on the attach direction.** `setRail(rail)` still neither reinstates the minimum size nor re-shows the body host of a window it takes from the dock. The window is hidden, nothing reads its geometry, and `setWindowState`'s `"normal"` branch undoes both on restore.[^o1-attach]
- **The reverse genie's start rect for a window attached from the dock.** Such a window is at strip size when the rail takes it, so its restore expands the genie from a strip rather than from a full window. Pre-existing, cosmetic, and not among the seven.
- **`ListenerBag.fire`'s skipped listener.** A listener that removes itself mid-fire shifts the live array and the next one is missed ([`ListenerBag.ts:75-85`](packages/lib/src/typescript/lib/core/ListenerBag.ts#L75)). It affects every emitting class in the framework, not the rail, and needs its own plan; here it only decides where R11's and R12's listeners are wired.
- **`Rail.destructor` leaving its registrations attached.** Disposing a rail unregisters no window, so `window._rail` can outlive it. Found while checking O3, out of scope, recorded here rather than changed.

---

## Notes

[^o7-scope]: O7 is not in the agenda's six-item bullet, but it is in the same paragraph of `rail-minimized-dock-slot`'s notes, which say it "belongs to the restore path rather than the hand-over, so it is left alone here and recorded for whoever picks the sizing plan up: the fix is the same one-line pairing `setRail` now makes, applied to the expand." This plan is that pick-up. Including it costs two lines and closes the worst defect of the set — a restore arriving inside the collapse's 150 ms ends with the window hidden while its state reads `"normal"`, which no gesture can undo: `restore()` early-returns on a window that is not minimized, `setWindowState("normal")` early-returns on the state it is already in, and the rail has raised a handle whose click calls `restore()`. Fixing O6 while leaving O7 — the same missing cancel, in the same file, on the other half of the same pair — would be the kind of half-fix the prior plan's notes describe as producing a new defect one round later.

[^o1-precedent]: The docked branch at `:1262-1286` does three things for a window entering the dock: it captures and relaxes the normal-resize minimum, it animates to the dock rect, and it hides the body host at that animation's completion. A window handed back from a rail needs the first and third; the second is the relayout's job, which `setRail` already calls. Measured on the offline harness at 1280×800: a directly-docked content window lands at `34 px` tall with its body host hidden, while one handed back from a rail lands at `200 px` — its own minimum — with its body host still displayed. With the two lines added, the handed-back window lands at `34 px` with the body hidden, identical to the directly-docked one. The 200-versus-34 gap is the explicit `setMinSize` floor `initChrome` seeds (`{ width: minContentWidthSeed(), height: 200 }`); once that is relaxed the only remaining floor is `chromeMinSize` (`:663`), which is the strip height by construction. A window is a `Container` with `clampsToContentSize()` false, so hiding the body host changes no floor — it only stops the body being laid out inside a box that cannot show it.

[^o1-undo]: `restoreNormalMinSize` (`:1322`) is already called from the completion of both the `"normal"` and the `"maximized"` tweens, and the `"normal"` branch calls `setBodyHostDisplayed(true)` at `:1222` before its tween starts. Verified on the harness: after a handed-back window is restored, `getMinSizeConstraint()` is back to the pre-minimize value, `_normalMinSize` is `null` again, and the body host is displayed.

[^o1-attach]: Reinstating the floor and re-showing the body host on attach would be writing state onto a window that is about to be hidden and whose geometry nothing reads while the rail holds it — and `setWindowState`'s `"normal"` branch does both anyway on the way out. The guard `if (this._normalMinSize === null)` is what keeps a dock → rail → dock round trip from overwriting the real floor with the relaxed `0 × 0` the window is already carrying.

[^pair-rule]: The rule is stated once so the pair stays auditable: five paths end or supersede a rail animation, and a reader should not have to work out per path which half matters. Two of the three additions close a defect that ends with the window in a state no gesture recovers (O7) or an event fired after the window's own `"close"` (O6); the third, `animateRailCollapse`, closes a cosmetic truncation. Including the cosmetic one is what makes the rule uniform rather than a list of exceptions — and an asymmetric pair, where the expand cancels the collapse but not the reverse, is precisely the half-done hand-over shape the prior plan's notes warn about. Measured on the harness: without it, a minimize interrupting an armed expand produces two `transition: null` writes against the window instead of one, the first being the superseded expand's deadline clearing the declaration the live collapse is animating through.

[^cancel-writes-nothing]: `Animation.play`'s returned `cancel` stops listeners and timers and unregisters from the pending-transition registry; it writes no styles. So every added cancel is invisible on the element — the genie an expansion animates out of stays exactly where the collapse left it, and a closing window's element is untouched. What the cancel removes is the completion callback (`setDisplayed(false)` plus `emit("minimize")` on the collapse) and `finish`'s `buf.set("transition", null)` at [`Animation.ts:201`](packages/lib/src/typescript/lib/core/Animation.ts#L201).

[^o2]: `Rail.setCollapsed` narrows the strip to `RAIL_COLLAPSED_THICKNESS_PX` — 10 px — and `setAllHandlesDisplayed(false)` drops every handle, drawer and window alike, out of the layout ([`Rail.ts:731`](packages/lib/src/typescript/lib/overlay/Rail.ts#L731)). Displaying a window's handle anyway would not make it visible: the rail clips its overflow, a `RailHandle` laid out at 10 px wide is a sliver, and `positionChevron` raises the chevron over the whole strip with `zIndex: "1"` so a click lands on the chevron regardless. The collapsed strip is skinned as a themed button surface precisely to read as "click to expand", mirroring a `Split` / `Border` collapsed gutter. The same state is reached by minimizing into an already-collapsed rail, so the attach path is not a special case — and a `setRail` that expanded the rail as a side effect would override a rail the consumer deliberately constructed collapsed. `setRail`'s `@remarks` and `Rail.md:78` already state the behaviour, so the doc edits only add that the collapsed strip's own chevron is what expands it again, and correct the source comment that promises a fix here.

[^o3]: The stranded state is a minimized window with `setDisplayed(false)` and `_rail` pointing at an unmounted rail. Nothing is corrupted: `rail.mount()` brings the handle back, `window.restore()` still works, and an open `Drawer` on the same rail is left the same way. The two hand-back options both cost more than they buy. Calling `setRail(null)` per window unregisters them, which contradicts `unmount`'s documented "keep their subscriptions, so a later `mount()` restores a working strip" and destroys a registration the consumer made. Parking them — handing each to the dock while keeping `_rail` — needs new per-window state, a matching unpark in `mount()`, and an ordering contract between the two, for a case reachable only by unmounting a rail that holds a minimized window. A warning would be error handling for a consumer's own choice.

[^o4]: The case needs `setRail` to be called inside the 150 ms of a *docked* minimize's rect tween. No gesture reaches it — attaching a rail is programmatic — and the damage is bounded: the tween keeps writing dock geometry to a hidden window, and the next `setWindowState` cancels it through `beginStateAnimation` and reads its target from `_restoreRect`, so the rect self-heals. The only visible trace is where the reverse genie starts from, since `railGenieTransform` reads `currentRect()`. Cancelling it would also have to decide what to do with a `fadeRectSwap` caught mid-glide — its paused body-host layout and its faded body — which is `beginStateAnimation`'s job, not a hand-over's. CLAUDE.md's *Simplicity First* rules out handling for a scenario no gesture produces and that repairs itself.

[^o5]: Two separate limitations, both standing. The first looks like a one-liner and is not: the collapse writes `transformOrigin: "0 0"` through `Animation`'s own inline-style buffer, while `Component.clearTransformOrigin` writes `setElementCSSRule("transformOrigin", null)` — the `#id` stylesheet rule. Inline outranks every rule, so the clear would leave the inline declaration exactly where it was. The conformant alternative is to stop writing it from the animation and set it through the typed setter instead, which moves a per-minimize write from inline onto the `#id` rule — and per ARCHITECTURE.md's *Motion properties write inline*, a rule write restyles the whole document in WebKitGTK. Paying that at the start of every rail minimize and restore, to correct the origin of a later `scale(0.97)` close fade, is the wrong trade; `transform-origin: 0 0` is also idempotent here, since both genie directions want exactly that value. The second limitation — clearing `transform` / `opacity` / `transition` rather than restoring what a consumer had set — is `endBodyFade`'s too, and closing it means three saved fields and a restore path for a consumer that does not exist. CLAUDE.md's *Simplicity First* rules out both.

[^exit-no-emit]: `setRail` fires the `"minimize"` a cancelled collapse owed, because the window genuinely entered `"minimized"` and a later `"restore"` would otherwise be unpaired. `onExitAction` must not: it has already emitted `"close"`, the rail has already dropped the window through its own `onClose`, and a `"minimize"` after a `"close"` is the defect being fixed. `_railMinimizeEmitPending` and `_railCollapseActive` are both left as they are — the window is being destroyed, and nothing reads either again.

[^null-min]: `initChrome` seeds `setMinSize` unless the caller passed an explicit `minSize` in the options bag, so every window has a non-`null` minimum constraint and the capture in both branches always stores a real value. A consumer passing `minSize: null` would reach the state where `_normalMinSize` stays `null`, the guard stays armed, and the relaxed `0 × 0` is never reinstated — identical to what the docked branch has always done. Adding a branch for it in one of the two places would leave the pair inconsistent for a case no window reaches.

[^listener-order]: `ListenerBag.fire` iterates the live bucket array with `for...of`. `Rail.registerWindow` subscribes `onClose`, which calls `unregisterWindow`, which calls `window.off("close", reg.onClose)` — removing the entry being iterated, shifting everything after it down one, and skipping the next listener. A `"close"` listener registered after `setRail` is therefore never called at all; registered before it, the rail's own listener sits second and nothing is skipped. Verified on the harness: the same R12 case reports `['minimize']` with the listener registered late and `['close', 'minimize']` with it registered early.
