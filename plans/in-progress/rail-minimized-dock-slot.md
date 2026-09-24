---
depends-on: [environment-read-caching]
touches-shared:
  - packages/lib/src/typescript/lib/overlay/AbstractWindow.ts
  - packages/lib/tests/overlay/AbstractWindow.minimizedViewportResize.test.ts
  - packages/lib/docs/reference/changelog/next.md
  - packages/lib/docs/components/Window.md
  - packages/lib/docs/components/Rail.md
---

# Rail-Minimized Windows Take No Dock Slot — Implementation Plan

## Overview

A window can minimize in one of two places. With no [`Rail`](packages/lib/src/typescript/lib/overlay/Rail.ts) attached it shrinks to a header-height strip in the **minimized dock** — the gap-free row along the bottom of the viewport that [`AbstractWindow.relayoutMinimizedStack`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2853) lays out. With a rail attached it is hidden outright and represented by a handle on that rail instead ([`AbstractWindow.ts:1246-1255`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1246)).

The dock does not make that distinction. Its relayout loop accepts every minimized window in `openWindows` ([`AbstractWindow.ts:2859-2862`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2859)), so a window the rail holds takes a slot the dock then leaves empty, and has its `x` / `y` / `width` / `height` overwritten with that slot's rect on every relayout and every viewport resize — while the window is hidden and its rail handle is what the user sees. [`computeDockSlotIndex`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2833), which picks the slot a minimize animation aims at, counts the same way.

This plan makes the dock hold exactly the **docked windows**: minimized, with no rail.[^docked-term] Three sites change, all in [`overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) — the relayout loop, `computeDockSlotIndex`, and `setRail`, which re-anchors the dock when a rail is attached to or detached from an already-minimized window. No public API changes.

---

## Architecture Decisions

### `_rail === null` is the ownership test, reused as-is

A window belongs to the dock when it is minimized and `_rail` is `null`. That is the expression [`environment-read-caching`](plans/implemented/environment-read-caching.md) already installed for the dock's resize listener — in [`show()`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L785) and in the relayout's own `docked` tally at [`AbstractWindow.ts:2885`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2885) — and this plan applies the same test to the slot arithmetic rather than adding a second notion of ownership.[^ownership]

### `setRail` re-anchors the dock when the window is minimized

Attaching or detaching a rail on a minimized window moves it between the rail and the dock, which changes the set of windows the dock holds. Every other change to that set already ends in `AbstractWindow.relayoutMinimizedStack()` — close, dispose, and each of the three state-change completions — so `setRail` calls it too.[^setrail-relayout]

### The construct-minimized defect stays out

A window constructed with `windowState: "minimized"` is not placed in a dock slot until something else triggers a relayout. That defect stays out of this plan.[^construct-minimized]

### The visibility half of the display hand-over is handled here; only the sizing half stays out

This plan's own `setRail` relayout forces the visibility half: closing the slot an attached window leaves lays the next docked window out over the top of it unless the window is also hidden, so `setRail` hides it on attach. Everything else follows from that one hide, because a hand-over done by halves strands the window somewhere new each time. Detaching pairs the hide with a show, since `setWindowState`'s rail re-show is gated on `_rail !== null` and a window left hidden would hold its returned slot invisibly with its handle already removed. A collapse still in flight is cancelled, since its completion ends in `setDisplayed(false)` and would undo that show. A completed collapse's transform and opacity are reset to the end state the reverse genie lands on, since nothing else will clear them once the rail is gone and a faded-out window is invisible but still hit-testable. What stays out is the *sizing* half — the docked branch's relaxed minimum size and hidden body host — so a window handed back sits at the right slot position but taller than the row.[^handover]

### The QA `windows` panel gains nothing

The fix is not observable in [`packages/qa/src/panels/windows.ts`](packages/qa/src/panels/windows.ts) — the panel builds no `Rail`, so every window it minimizes is dock-held and the relayout behaves identically before and after. The panel is not given a rail-minimized case.[^qa-panel]

---

## Internal Structure

### `relayoutMinimizedStack` — [`overlay/AbstractWindow.ts:2846-2895`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2846)

The loop guard gains the rail test, and the separate `docked` tally disappears — `index` is now the count of docked windows, because nothing else reaches the body.

```typescript
    /**
     * Re-positions every docked window — a minimized window with no rail —
     * into a gap-free row along the bottom of the viewport. A minimized
     * window its rail holds is skipped: the rail's handle is that window's
     * minimized representation, so it takes no slot here and its geometry is
     * left untouched. Runs after any change to the open/minimized set or to a
     * minimized window's rail, and on every viewport `resize` through the
     * dock's own listener, which it installs while the row holds a docked
     * window and removes once it holds none.
     */
    private static relayoutMinimizedStack(): void {
        let index          = 0;
        let dockWidth      = 0;
        let viewportHeight = 0;

        for (const win of AbstractWindow.openWindows) {
            if (win.getWindowState() !== "minimized" || win._rail !== null) {
                continue;
            }

            // Read once per relayout, not per window: neither can change
            // between two windows of the same row.
            if (index === 0) {
                dockWidth      = win.getMinDockWidth();
                viewportHeight = DOM.source.getViewportSize().height;
            }

            const headerHeight = win.chromeHeight() || CHROME_HEIGHT_FLOOR_PX;
            const x = index * (dockWidth + SNAP_DOCK_GAP_PX);
            const y = viewportHeight - headerHeight;

            win.setAutoCommitStyle(false);
            win.setX(x);
            win.setY(y);
            win.setWidth(dockWidth);
            win.setHeight(headerHeight);
            win.doLayout();
            win.setAutoCommitStyle(true);

            index++;
        }

        if (index > 0) {
            AbstractWindow.installStackResizeListener();
        } else {
            AbstractWindow.uninstallStackResizeListener();
        }
    }
```

### `computeDockSlotIndex` — [`overlay/AbstractWindow.ts:2827-2844`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2827)

```typescript
    /**
     * Returns this window's slot index in the minimized dock — the count of
     * docked windows ahead of it in the open-windows order. A minimized
     * window its rail holds takes no slot, so it is not counted.
     *
     * @returns The zero-based dock slot index.
     */
    private computeDockSlotIndex(): number {
        let index = 0;
        for (const win of AbstractWindow.openWindows) {
            if (win === this) {
                return index;
            }
            if (win.getWindowState() === "minimized" && win._rail === null) {
                index++;
            }
        }
        return index;
    }
```

### `setRail` — [`overlay/AbstractWindow.ts:1406-1422`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1406)

The existing body is unchanged; one block is appended before the `return`, after `rail.registerWindow(this)`.

```typescript
        // Attaching or detaching a rail moves a minimized window between the
        // rail and the dock, so the row the dock lays out has changed: close
        // the slot the window leaves, or open the one it joins, and let the
        // relayout re-derive the dock's resize listener from the new count.
        if (this.isMinimized()) {
            AbstractWindow.relayoutMinimizedStack();
        }
```

---

## Ordered Implementation Steps

1. **Extend `packages/lib/tests/overlay/AbstractWindow.minimizedViewportResize.test.ts`** with the seven cases W11–W17 of `## Expected Behaviour`, inside the file's existing `describe`. Add, above the cases:

   - A module-level constant beside the imports:
     ```typescript
     // One dock slot's pitch: DEFAULT_MIN_DOCK_WIDTH_PX (200) plus
     // SNAP_DOCK_GAP_PX (4), both module-private to AbstractWindow.ts.
     const DOCK_SLOT_PITCH_PX = 204;
     ```
   - Three helpers beside the file's existing ones (`shownWindow`, `listenerInstalled`, …):
     ```typescript
     /** A mounted WEST rail, the minimize target a rail-held window gets. */
     function mountedRail(): Rail {
         const rail = new Rail({ edge: Placement.WEST });

         rail.mount();

         return rail;
     }

     /** Shows a window at an explicit position, so a dock write to it is unmistakable. */
     function shownWindowAt(title: string, x: number, y: number): Window {
         const win = new Window(title, { x, y });

         win.show();

         return win;
     }

     /** One window's dock slot index — the slot its minimize tween aims at. */
     function dockSlotIndex(win: Window): number {
         return (win as unknown as { computeDockSlotIndex(): number }).computeDockSlotIndex();
     }
     ```
   - Replace W7's own rail setup (`const rail = new Rail({ edge: Placement.WEST });` and `rail.mount();`) with `const rail = mountedRail();`, so the file holds one copy of it.

   Extend the file's header comment with one sentence: *W11–W17 are `plans/rail-minimized-dock-slot.md`'s rows — the dock's row holds only the minimized windows no rail holds.*

2. **Run the file** — `npm -w packages/lib run test -- AbstractWindow.minimizedViewportResize`. W11–W17 fail; W1–W10 pass.

3. **`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`, `relayoutMinimizedStack`** (`:2846-2895`): replace the JSDoc and body with the version in `## Internal Structure`. The changes are the loop guard's added `|| win._rail !== null`, the removal of the `docked` local and its `if (win._rail === null) { docked++; }` block, and `if (docked > 0)` becoming `if (index > 0)`.

4. **Same file, `computeDockSlotIndex`** (`:2827-2844`): replace the JSDoc and body as in `## Internal Structure` — the counting `if` gains `&& win._rail === null`.

5. **Same file, `setRail`** (`:1406-1422`): append the `isMinimized()` block from `## Internal Structure` after `rail.registerWindow(this)` and before `return this;`.

6. **Re-run the file** — all of W1–W17 pass. Then `npm test` for the whole library: `tests/overlay/Rail.test.ts`, `AbstractWindow.minimizedStackResize.test.ts` and `AbstractWindow.minimizeMinSize.test.ts` must pass unchanged.

7. **Checkpoint greps:**
   - `grep -c '_rail === null\|_rail !== null' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — expect `6`: `show`, the two `setWindowState` branches, `setRail`'s unregister guard, the relayout's loop guard, and `computeDockSlotIndex`.
   - `grep -n 'let docked' packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` — zero matches; `index` is now the docked count.
   - `grep -n 'relayoutMinimizedStack' packages/qa/src/harness/ablations.ts` — still resolves; ablation A7 wraps the method by name and the name is unchanged.

8. **Docs** — the three edits of `## Documentation Impact`.

9. **Verification** — run `## Verification` end to end.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/tests/overlay/AbstractWindow.minimizedViewportResize.test.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts` (added by the audit — see `## Implementation Notes`) |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/docs/components/Window.md` |
| Modify | `packages/lib/docs/components/Rail.md` |

---

## Expected Behaviour

All seven cases are **unit-testable offline**, in `packages/lib/tests/overlay/AbstractWindow.minimizedViewportResize.test.ts` alongside W1–W10. They inherit that file's `beforeEach` (the test DOM at 1280×800, the `requestAnimationFrame` / `setTimeout` mocks, and the reduced-motion mock that makes every state change commit synchronously) and its `afterEach`. The in-engine check is separate, under `## Verification`.

The dock's row is what these cases read. With three shown windows A, B, C — shown in that order, so `openWindows` iterates in that order — and B holding a rail:

| Window | State | Rail | Dock slot | Rect the dock writes |
|---|---|---|---|---|
| A | minimized | none | 0 | `x = 0` |
| B | minimized | attached | — | none; B keeps the rect it had |
| C | minimized | none | 1 | `x = 204` |

Today C lands at `x = 408` and B is written into slot 1.

| Case | Setup | Expected |
|---|---|---|
| W11 | `mountedRail()`; show A, B, C; `b.setRail(rail)`; minimize A, B, C | `a.getX()` is `0`; `c.getX()` is `DOCK_SLOT_PITCH_PX`; `c.getY()` equals `a.getY()` (today `c.getX()` is `2 * DOCK_SLOT_PITCH_PX`) |
| W12 | `mountedRail()`; show A, B; `b.setRail(rail)`; `b.minimize()`; note `b.getRect()`; then `a.minimize()` and `relayoutStack()` | `b.getRect()` is unchanged — the dock writes no geometry to a window the rail holds |
| W13 | `mountedRail()`; show A, B; `b.setRail(rail)`; minimize A then B; `resizeViewport(800)`; note `a.getY()` and `b.getRect()`; `resizeViewport(500)` | `a.getY()` dropped by exactly `300`; `b.getRect()` unchanged |
| W14 | `mountedRail()`; show A, B; minimize both, so `b.getX()` is `DOCK_SLOT_PITCH_PX`; then `a.setRail(rail)` | `b.getX()` is `0` — B moves up into the slot A vacated |
| W15 | `mountedRail()`; show A and `shownWindowAt('B', 300, 200)`; `b.setRail(rail)`; minimize A then B; assert `b.getX()` is still `300`; then `b.setRail(null)` | `b.getX()` is `DOCK_SLOT_PITCH_PX` and `b.getY()` equals `a.getY()` — B joins the row in the next free slot |
| W16 | `mountedRail()`; show W; `w.minimize()`; then `w.setRail(rail)`; then `w.setRail(null)` | `listenerInstalled()` reads `true`, then `false`, then `true` |
| W17 | `mountedRail()`; show B then A; `b.setRail(rail)`; `b.minimize()` | `dockSlotIndex(a)` is `0` (today `1`) — the slot A's own minimize tween would aim at |

Cases W1–W10 are unchanged and must keep passing. W7 in particular (a rail-minimized window alone installs no dock listener) already holds today, because the dock's *listener* was made rail-aware by `environment-read-caching`; it is only the *slot* arithmetic that was not.

---

## Verification

1. `npm run typecheck` and `npm -w packages/lib run typecheck:test` — clean.
2. `npm test` — the whole library suite green, including W1–W17, `tests/overlay/Rail.test.ts` and `tests/overlay/AbstractWindow.minimizedStackResize.test.ts`.
3. `npm run lint` — clean.
4. The three checkpoint greps of *Ordered Implementation Steps* 7.
5. `npm run docs:api` — no new warnings (no public API changed, so the count must match `master`'s). `npm run docs:llms:check` — clean.
6. **In-engine, by eye** — this is the user's to run; it opens windows.
   - `npm run dev`, open the **Misc** panel.
   - Click **Toggle launcher rail (Rail)**: an EAST rail appears, and a *Rail-docked window* opens at (220, 140).
   - Open two plain windows from the same panel (**Hello World!** and **blaah!**) and minimize both: two strips sit at the bottom-left, side by side with no gap.
   - Minimize the *Rail-docked window*: its handle appears on the rail, and the bottom row still shows **exactly two** strips in slots 0 and 1 — no third strip, no gap. Before the fix a third, empty-looking strip appeared in slot 2 and the rail-held window's rect was overwritten.
   - Resize the browser window: the two bottom strips follow the bottom edge; the rail handle does not move.
   - Click the rail handle: the window restores to its own rect (220, 140, 360×240), not to a dock slot.

---

## Documentation Impact

No exported symbol changes, so the generated API pages and `packages/lib/llms.txt` are untouched. Three prose edits:

- **`packages/lib/docs/reference/changelog/next.md`**, `## Fixed` → `### Overlay` (`:1510`): add an entry —

  > **A window minimized into a [`Rail`](/components/Rail) no longer takes a slot in the bottom dock strip.** The strip counted every minimized window, so a rail-held one left an empty slot in the row and had its position and size overwritten with that slot's rect on every relayout and every viewport resize — while the window itself was hidden and its rail handle was what showed. The strip now holds only the minimized windows with no rail, and attaching or detaching a rail on an already-minimized window re-closes the row. No consumer action is needed.

- **`packages/lib/docs/components/Window.md:93`**: the sentence *"Multiple minimized windows lay out side-by-side in insertion order with a 4 px gap."* becomes *"Multiple minimized windows lay out side-by-side in insertion order with a 4 px gap. A window with a [`Rail`](/components/Rail) attached minimizes into that rail instead and takes no slot in the strip."*

- **`packages/lib/docs/components/Rail.md:78`**: after *"Passing `null` to `setRail` detaches the rail and falls back to the built-in strip."*, add *"While the rail holds a minimized window, that window takes no slot in the built-in strip and keeps the rect it had — the strip lays out only the minimized windows with no rail."*

---

## Potential Challenges

- **The slot order is `openWindows` insertion order**, which is `show()` order, not construction order — a test that asserts a slot index must `show()` its windows in the order it expects. W11's A/B/C and W17's B-then-A both depend on this.
- **`setRail` may be called before `show()`.** The new relayout then sweeps an `openWindows` that does not contain this window, which is harmless: it re-derives the row from the windows that *are* open. `tests/overlay/Rail.test.ts`'s `minimizeIntoRail` helper (`:159`) takes exactly this path with no window shown at all.
- **A window the rail holds keeps its normal-state minimum size.** The dock's relaxed minimum is applied only by the docked branch of `setWindowState`, so a window detached from a rail while minimized (W15) lands at the right slot `x` / `y` but keeps a taller box. The cases therefore assert position, not size; see `## Non-Goals`.
- **New cases need the reduced-motion mock to see the dock's writes**, because the relayout runs from each transition's animation completion. It is already in the file's `beforeEach`; a case added to a different file would have to re-establish it.

---

## Critical Files

- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) — the three sites this plan changes (`:1406` `setRail`, `:2833` `computeDockSlotIndex`, `:2853` `relayoutMinimizedStack`), plus `:785`, the `_rail === null` ownership test they follow, and `:1246`, the rail branch of `setWindowState` that hides the window.
- [`packages/lib/src/typescript/lib/overlay/Rail.ts:984-1077`](packages/lib/src/typescript/lib/overlay/Rail.ts#L984) — `registerWindow` / `unregisterWindow` / `showWindowHandle`: what "the rail holds this window" means, including the already-minimized registration at `:1001`.
- [`plans/implemented/environment-read-caching.md`](plans/implemented/environment-read-caching.md) — the precedent: its *The minimized dock answers a resize through one listener of its own* decision defines a docked window, and its Implementation Notes record the construct-minimized defect.
- [`packages/lib/tests/overlay/AbstractWindow.minimizedViewportResize.test.ts`](packages/lib/tests/overlay/AbstractWindow.minimizedViewportResize.test.ts) — cases W1–W10 and the mocks, helpers and teardown the new cases extend.
- [`packages/lib/tests/overlay/Rail.test.ts:153-162`](packages/lib/tests/overlay/Rail.test.ts#L153) — `minimizeIntoRail`, the minimize-then-attach path `setRail`'s new relayout runs through.

---

## Non-Goals

- **The sizing half of the display hand-over.** `setRail` now carries the whole *visibility* half: it hides a minimized window on attach, shows it on detach, cancels a collapse still in flight, and clears the shrink-into-the-rail transform and fade a completed one left behind — because the slot arithmetic this plan changes forces that much, and a half-done version of it is what the audit kept catching (see `## Architecture Decisions`). What it does not do is run the docked branch's own preparation: the relaxed minimum size and the hidden body host. So a window handed back to the dock lands at its slot's position but at its normal 200×200 minimum rather than the row's strip height, standing taller than the strips beside it until something restores it — which is why `## Expected Behaviour`'s W15 asserts `x` and `y` and not `width` and `height`. Fixing that means running that preparation from `setRail`: a geometry change with its own risk, its own tests, and its own plan.
- **The construct-minimized defect** — a window constructed with `windowState: "minimized"` is not placed until something triggers a relayout. See `## Architecture Decisions`.
- **A rail-minimized case in the QA app.** See `## Architecture Decisions`.
- **Any change to the dock's resize listener.** `installStackResizeListener` / `uninstallStackResizeListener` / `onStackViewportResize` and `show()`'s guard are already rail-aware and are left exactly as `environment-read-caching` left them; only the count that drives the install changes, and only because the loop it sits in changed.

---

## Notes

[^docked-term]: *Docked window* is `environment-read-caching`'s own term, defined in its *The minimized dock answers a resize through one listener of its own* decision as "a minimized window with no `Rail`, the kind the dock places along the bottom edge". This plan reuses the term rather than coining a second one.

[^ownership]: The alternative considered was a predicate that also demands the window be displayed, so a hidden window could never hold a slot. It was rejected on two counts. `environment-read-caching` already settled `_rail === null` as the dock's ownership test — it is what `show()` guards on and what the relayout's `docked` tally counted — and a second, subtly different test in the same method is how the two drift apart. And `_rail` is set the moment `setRail` runs, whereas the rail path hides the window only when its collapse animation completes 150 ms later; a displayed-based test would hand the dock a slot to write for the length of that animation, every time.

[^setrail-relayout]: The call sites that already end in a relayout are `onExitAction` (`:1039`), `destructor` (`:1075`), and the three `setWindowState` animation completions (`:1236`, `:1276`, `:1293`). Leaving `setRail` out would not produce a *different* row — the next relayout from any of those would correct it — but it would leave a stale gap, or a stale slot, visible until some unrelated event happened to close it. The guard is `isMinimized()` rather than an unconditional call because a rail attached to a normal or maximized window changes nothing the dock lays out.

[^construct-minimized]: Recorded in `environment-read-caching`'s Implementation Notes: `initChrome` calls `setWindowState(this.getWindowState())`, which short-circuits on a state that is already current, so the docked branch never runs and the window has no captured restore rect, no relaxed minimum size and no hidden body host. That plan's audit probed placing it at `show()` and measured the cost — the window is clamped to its 200×200 minimum and a restore hands back the clamped rect instead of the one it was constructed with — so a real fix has to run the docked branch's preparation, which is a geometry change with tests of its own. It is a defect about a window's *preparation* for docking; this plan is about *which* windows the dock holds, and changes no geometry for a window the dock already held. One part of it does improve here for free: a window constructed minimized *with* a rail is no longer dragged into a dock slot by the next relayout.

[^handover]: The display hand-over is what a window shows once its owner changes: the rail hides the window it holds and shows a handle instead, while the dock shows the window itself as a header-height strip. `setRail` did neither before this plan, so an attached rail added a handle beside a window still visible in its dock slot, and a detached one left the window hidden. The attach side cannot stay that way here: the slot-closing relayout this plan adds to `setRail` hands that still-visible window's slot to the next docked window, which is then laid out on top of it, so `setRail` hides it — `Rail.registerWindow` has already shown its handle (it raises one at once for a window that is already minimized), and `setWindowState`'s `from === "minimized" && _rail !== null` branch re-shows the window and plays the reverse genie on restore, from a `from` it sets itself rather than one read off the element, so a window hidden without a collapse having played still restores correctly. (`registerWindow`'s handle is raised hidden when the rail is *collapsed* — `Rail.ts:1054` — so an attach to a collapsed rail leaves no representation at all; pre-existing, and recorded in `## Implementation Notes` for the follow-up.) The detach side has to pair that hide with a show for the same reason — `setWindowState`'s re-show is gated on `_rail !== null`, so once the rail is gone a window the attach hid would hold its returned slot invisibly with its handle already removed — and it has to cancel any collapse still running and reset a finished one's transform and opacity, since that completion would re-hide the window and that fade would leave it invisible but hit-testable. What `## Non-Goals` still defers is the sizing half: the docked branch's relaxed minimum size and hidden body host. The one consequence worth knowing while reading `## Expected Behaviour`: W15's detached window lands at the right slot position but keeps its normal-state minimum size, so its box is taller than the row — which is why the case asserts `x` and `y` and not `width` and `height`.

[^qa-panel]: `packages/qa/src/panels/windows.ts` builds `n` windows, a bare one, an insets one and an always-on-top one, and minimizes `⌊n / 2⌋` of them; none is given a rail, so the relayout's new guard never fires there and every counter, every `geometry` label including `min0`, and the panel's recorded baselines are unchanged. That is itself the useful check — the `windows` row of `packages/qa/README.md` carries Validated readings from three sessions plus the W3.0 baseline and the wave-3 A/B, and a rail added to the panel would move every one of them for a change with no measured cost component. If in-engine coverage is ever wanted, the panel's own idiom for it is an opt-in URL parameter (as `grip=` is), defaulting to no rail so the recorded cells still describe what the panel does — not worth its README and baseline churn for a bug the offline cases pin exactly.

## Implementation Notes

The three sites of *Internal Structure* went in as written, and the checkpoint
greps of *Ordered Implementation Steps* 7 all report what the plan says they
should: `_rail === null` / `_rail !== null` counts 6 (`show`, the two
`setWindowState` branches, `setRail`'s unregister guard, the relayout's loop
guard and `computeDockSlotIndex`), `let docked` is gone, and
`relayoutMinimizedStack` still resolves in `packages/qa/src/harness/ablations.ts`
for ablation A7. One source change the plan did not call for went in on top of
them, and the plan's own *Non-Goals* were corrected to match.

The audit found that attaching a rail to a window that was **already**
minimized and docked left two windows drawn on the same rect. `setRail`'s new
relayout closes the slot the attached window gives up, but nothing hid that
window — the hide lives only in `setWindowState`'s minimized branch, which
does not re-run for a window that is already minimized — so the next docked
window was laid out straight over the top of it. With three docked windows and
a rail attached to the middle one, the third window landed on the second's
rect with both still on screen. This was a genuine regression: before this
plan `setRail` ran no relayout at all, so nothing moved into that slot, and
the plan's *Non-Goals* claim that the attach case was "pre-existing and
unchanged by this plan" was wrong in both directions — the plan's relayout did
change it, and this branch now fixes it.

The fix, authorised by the parent as a deliberate narrowing of the plan's
scope rather than the whole hand-over: `setRail` calls `setDisplayed(false)`
when the rail being attached is non-null and the window is minimized, before
the relayout. The surrounding code already carries the rest of that direction.
`Rail.registerWindow` raises the handle at once for a window that is already
minimized, so a hidden window is still represented and still restorable by a
click. `setWindowState`'s `from === "minimized" && this._rail !== null` branch
calls `setDisplayed(true)` and `animateRailExpand`, which sets its own `from`
to the genie transform instead of reading the element's, so a window hidden
without a collapse having played restores correctly rather than from a
half-state; the `"normal"` branch's `setBodyHostDisplayed(true)` and its
completion's `restoreNormalMinSize()` undo the docked preparation the window
still carries. No genie plays on attach: the window is already minimized, so
there is no minimize gesture left to animate.

A second audit round then caught that the attach hide had no reverse, which
was a regression of its own: `minimize` → `setRail(rail)` → `setRail(null)`
left the window holding a dock slot invisibly, and unrecoverably, because
`setWindowState`'s re-show is gated on `_rail !== null` and
`Rail.unregisterWindow` had already removed the handle — so `restore()` gave
back a `"normal"` window that was still `display: none`, where before this
branch the same sequence left a plainly visible one. The round also pointed at
the precedent that settles it: every other ownership hand-over in these
classes pairs its hide with a show on the reverse transition inside the same
class (`AbstractWindow.ts:1259`↔`1213`, `Split.ts`, `Border.ts`, `Tab.ts`,
`Card.ts`, `Accordion.ts`), and this was the only unpaired one. So `setRail`
now calls `setDisplayed(rail === null)` — hide on attach, show on detach —
and **W20** and **W21** pin both the returned strip and the restore.

A fourth independent round then found that the show was still only half a
hand-over, in two ways. The collapse `setWindowState` starts when a rail-held
window minimizes ends in `setDisplayed(false)`, and `setRail` did not cancel
it — so `setRail(rail)`, `minimize()`, `setRail(null)` showed the window and
then let the completion hide it again, landing in exactly the stranded state
the round before had just removed. And a window whose collapse had *finished*
was being shown while still wearing that collapse's `opacity: 0` and genie
transform, which nothing would ever clear, because the reverse genie is gated
on `_rail !== null`: an invisible but still hit-testable window in the window
band, above the rail — worse than the overlap the hide was introduced to fix,
since on `master` that element had at least been `display: none`. `setRail`
now cancels both animation handles, the way `destructor` already does, and a
detach runs `endRailCollapse`, which puts back what the collapse took.

A fifth round then found that first version of the reset was itself two
defects, both of them the same mistake in a different place: it wrote a
resting state of its own instead of undoing what the collapse had installed.
It set `Component._transform` to the expanded transform and left it there, and
that cache is folded into every later transform write and replayed after every
inline-style wipe — so a window that had merely been round-tripped through a
rail could never free its compositor layer again, because the drop's
`setTranslate(0, 0)` wrote `translate(0, 0) scale(1)` instead of clearing.
Worse, it did this even to a window that never collapsed at all. And it left
the `transition` shorthand `Animation` arms in place, because only a
completion clears that and a cancel writes no styles at all: every later write
to such a window animated through it, so a drag trailed the pointer for its
whole duration — while the reset's own JSDoc claimed it did not animate.

Both of those, and the round before them, trace to one root cause: **undoing
an animation means undoing everything it installed** — the cache it bypassed
and the transition rule it armed, not just the visual end state it left on
screen. `endRailCollapse` now takes all three back. Because `Animation` plays
through an inline-style buffer of its own, none of what it wrote is in the
component's caches, and each of those setters skips a write whose value it
believes is already current; so every property is moved off its cached value
and then cleared, which makes the clear a real write and still ends with the
cache where it started. The transition goes first, or the other two writes
animate through the rule being removed. The whole thing is gated on
`_railCollapseActive`, set when a collapse actually plays — the
`_bodyFadeActive` / `endBodyFade` pair is this class's own precedent for that
shape, and the gate is what keeps a detach from touching a window no collapse
ever ran on.

**The leftover transition was fixed at the `setRail` call site rather than in
`Animation.cancel`,** on the strength of an existing precedent for exactly
that. `Accordion.detach` (`layout/Accordion.ts:1248-1271`) cancels its shrink
and wrapper animations and then runs, by hand, the cleanup branch those
animations owned — resetting the toggle counter and clearing the transitions
with `container?.setTransition(null)` — under a comment making the same
argument this code makes: *"Those cancelled animations owned the
toggle-cleanup branch, so run its work here."* That is the same shape as both
of `setRail`'s obligations, the transition clear and the owed `"minimize"`, so
the call site is where this library already puts a cancelled animation's
unfinished business.

Clearing it inside `cancel` would fix the shape everywhere, and `cancel`
leaving behind a rule its own `play` installed is arguably the primitive's bug
rather than this caller's; that remains a defensible future change. It was not
made here because `Animation.cancel` is on the path of roughly forty cancel
sites across `Tooltip`, `Drawer`, `Dialog`, `AnimatedDropdown`, `Menu`,
`Popover`, `Accordion`, `Tab` and `AbstractWindow`'s own `beginStateAnimation`
and `onExitAction`, and giving all of them a new style write to serve this one
is the wrong trade to make inside a plan about dock slots — several of them
cancel on an element that is being torn down in the same breath. An earlier
version of this note claimed `setRail` was the library's *first* cancel with no
successor on a live element. That was wrong: `Tab.detach`
(`layout/Tab.ts:1004-1005`) cancels the opacity fade armed at `:2268-2274` with
no replacement `play`, on a live content element, and `detach` is not a
destructor. The conclusion stands on the `Accordion.detach` precedent instead,
which is a positive precedent and does not depend on the count.

A sixth round found that the undo's *gate* was wrong in three ways, two of
them because the tests could not have caught them. `_railCollapseActive` was
set when a collapse played and cleared only by the detach, but the **restore**
path also ends the collapse's ownership — `animateRailExpand` undoes the genie
itself — so after `setRail(rail)`, `minimize()`, `restore()` the flag stayed
`true` for the window's life, and a much-later detach would undo styles the
dock by then owned. That is a structural divergence from the precedent this
code claimed, not an edge case: `_bodyFadeActive` is cleared from every path
that ends the fade's ownership, both completions and `beginStateAnimation`.
The flag is now cleared in `animateRailExpand`, where the expansion takes
ownership. It is deliberately *not* cleared from `beginStateAnimation` the way
`endBodyFade` is: `beginStateAnimation` runs from the `animateRect` that the
restore starts *after* `animateRailExpand` has begun, so undoing there would
clobber the expansion mid-flight — the supersession belongs with the
superseding animation, which is what `animateRailExpand` now does.

The gate was also untested, and so was the write ordering the code's own
comment calls load-bearing: deleting the gate, or moving the transition clear
after the transform and opacity writes, left the whole overlay suite green.
W23 was the specific failure — it asserted the caches end `null`, which they
do whether the undo ran or not, since the undo *ends* by clearing exactly
those caches. Both are now pinned on the write log rather than the end state:
W23 and W25 assert that **no** transform, opacity or transition write happens
at all, and W26 asserts every transition write precedes the first transform
and opacity write.

The third was a contract violation this branch introduced: cancelling the
collapse also swallowed the `"minimize"` its completion emits, which is the
rail path's only emitter. `setRail(rail)`, `minimize()`, `setRail(null)`
inside 150 ms therefore produced a window that was minimized and docked having
never announced it, and a later `restore()` emitted an unpaired `"restore"`
against the documented contract that `"minimize"` fires when the window enters
`"minimized"`. The window genuinely did enter that state — the event was only
deferred to the animation's end — so `setRail` now fires what the cancelled
collapse owed, tracked by `_railMinimizeEmitPending`. The emit sits after the
existing `unregisterWindow`, which is defensively right rather than
load-bearing — a rail still subscribed would raise a handle and have it removed
again inside this same call, so the order keeps the old rail out of an event
that no longer concerns it without anything depending on that. A newly attached
rail has already raised its handle in `registerWindow` and takes the emit as
the no-op `showWindowHandle`'s `reg.handle !== null` guard makes it. R6 pins
the detach direction and the paired `"minimize"`/`"restore"`, R7 the
re-attach-a-different-rail direction.

A seventh round found the *exactly-once* half of that emit untested, and it was
reachable two ways: dropping the completion's own clear left the debt armed
after a collapse that had already emitted, so the next `setRail` announced a
second time; and making the emit unconditional doubled a plain docked
`minimize()`, which emits synchronously and defers nothing. Both are public
lifecycle events, and both passed the whole suite. **W27** and **W28** now
count emissions rather than asserting one happened — a detach after a completed
collapse, and an attach to an already-docked window. The same round found
`_railMinimizeEmitPending` had the supersession hole its sibling flag had just
had fixed: a restore ends the debt as surely as a completion does, because a
restored window is not minimized and has nothing left to announce. It is
cleared in `animateRailExpand` alongside the other flag, which is the shape
`Card`'s parked scroll restore already follows in invalidating a debt that has
gone stale, and **R9** pins it. That one was not a regression — `master` emits
the same doubled stream — but it is the symmetric completion of this round's
own fix, so it went in with it.

Behind all five rounds is the thing this plan's own *Non-Goals* was right
about: **the display hand-over cannot be done by halves.** Changing which
windows the dock lays out made a window's owner meaningful, and every partial
answer to "what does the window show now that its owner changed" produced a
new defect one round later — a slot given away under a visible window, then a
hidden window holding a slot, then a shown window that was invisible anyway,
then a visible window that could no longer drag properly. What makes the
visibility half safe to finish here, rather than defer with the rest, is that
it is reversible state with an existing end state to reset to; the sizing half
is not.

So the sizing half stays deferred, and is what *Non-Goals* now scopes itself
to: a window handed back to the dock lands at the right slot position but at
its own normal minimum size instead of the row's strip height, so it stands
taller than its neighbours until restored. Two further observations belong to
that same follow-up plan, both found while checking this one and both
pre-existing. `Rail.showWindowHandle` creates a handle with
`setDisplayed(!isCollapsed())` (`Rail.ts:1054`), so attaching a *collapsed*
rail to a docked window hides the window and raises no visible handle — the
window has no on-screen representation at all until the rail expands. And
`Rail.unmount` (`:824`) detaches the strip while keeping its registrations, so
unmounting a rail that holds minimized windows leaves them hidden with their
handles off-screen and no `setRail` call to hand them back. Neither is touched
here.

One more belongs with them, and it is the reason two doc sentences were
softened rather than left absolute: `setRail` cancels the two rail animations
but not `_stateAnimHandle`, so a rail attached during a *docked* minimize tween
lets that tween keep writing dock geometry to a window the dock no longer owns.
A restore recovers the right rect from `_restoreRect`, the only visible trace is
where the reverse genie starts from, and there is no gesture that reaches it —
it is programmatic-only, and still better than `master`, which wrote dock
geometry to rail-held windows unconditionally. `relayoutMinimizedStack`'s JSDoc
and `Rail.md` now say the *loop* writes no geometry, rather than claiming the
window's rect is untouched full stop.

Two smaller ones belong with them. `endRailCollapse` does not undo the
`transformOrigin` the collapse sets, and it clears the transform, opacity and
transition outright rather than restoring whatever a consumer had set on them
— the `endBodyFade` precedent has the same limitation, so this is consistent
with the class rather than new, but a hand-over that owns these declarations
properly would need to save and restore them. And `onExitAction` does not
cancel the rail animation handles at all, so closing a window mid-collapse
leaves them to complete against a closing window; pre-existing, and untouched
here.

A third observation is the same defect as this plan's own round-four one, in
the path this plan does not own: `animateRailExpand` (`:2880-2900`) cancels
only `_railExpandAnimation`, never `_railCollapseAnimation`. So a `restore()`
arriving inside the collapse's 150 ms leaves that collapse to complete
afterwards and call `setDisplayed(false)` on a window whose state is already
`"normal"` — hidden, and unrecoverable through the ordinary route, because
`setWindowState` early-returns on a state that is already current. It is
pre-existing, it predates this branch, and it belongs to the restore path
rather than the hand-over, so it is left alone here and recorded for whoever
picks the sizing plan up: the fix is the same one-line pairing `setRail` now
makes, applied to the expand.

Twenty cases beyond the plan's *Expected Behaviour* table pin the hand-over.
Eleven extend the existing file's W-series: **W18**, that a docked window is no
longer displayed after `setRail(rail)`; **W19**, that the slot the attach
gives away holds no second visible window — three docked windows, a rail
attached to the middle, and the third lands on the second's frozen rect with
only the third still displayed; **W20**, that a detach returns the window to
the row as a visible strip; **W21**, that such a round-tripped window still
restores; **W22**, that a detach after a completed collapse leaves the element
carrying neither transform nor opacity, asserted against the style writes
themselves *and* against the caches, which is what separates undoing the
collapse from writing a resting state over it; **W23**, that a detach undoes
nothing at all when no collapse ever applied; and **W24**, that a window
detached after a collapse still frees its compositor layer when a drag drops,
which is the concrete form of the cache having been handed back; **W25**, that
a restore ends the collapse's ownership so a later detach undoes nothing; and
**W26**, that the transition comes off before anything is written through it;
and **W27** / **W28**, that the hand-over announces a minimize exactly once —
never twice after a collapse that already emitted, and never twice on a plain
docked minimize.

The other three needed the collapse to be genuinely in flight, which that
file's whole-file reduced-motion mock rules out — it runs every completion
synchronously, so there is never anything to race. They went in a new file,
`packages/lib/tests/overlay/AbstractWindow.railHandoverAnimated.test.ts`, on
`AbstractWindow.largeResizeFade.test.ts`'s fake-timer-and-frame harness:
**R1**, that a detach cancels the collapse so its completion cannot re-hide
the window; **R2**, that a window detached mid-collapse still restores
visible; **R3**, the guard on both — a collapse left alone must still hide the
window, or R1 would pass against an animation that never completes offline at
all; **R4**, that a cancelled collapse leaves no `transition` armed; and
**R5**, that such a window then drags with neither a leftover transition nor a
cached transform; **R6**, that a detach mid-collapse still fires the
`"minimize"` the cancelled collapse owed and then pairs with one `"restore"`;
**R7**, the same for re-attaching a different rail mid-collapse; and **R8**,
the guard on the guard — that the collapse a case cancels really is armed,
asserted against the genie transform, because a transition write alone would
also match the entrance animation's and let the drains be deleted unnoticed;
and **R9**, that a restore voids the collapse's deferred `"minimize"` instead
of spending it on the next one. R4 and R5 exist in a state the first version of that file
never reached: its `collapsingWindow` helper returned before the collapse's
two frames had been drained, so every case cancelled an animation that had
armed nothing yet. The helper now drains them, which is the only state in
which the leftover transition exists at all. A new test file is itself a departure from *Files to Create /
Modify / Delete*, which lists only modifications; the file-per-mocking-regime
split is the convention the existing file's own header cites, and R3 is why
the regime had to be real.

Each case was written before its fix and failed first — W19 with every
geometry assertion already passing and only `isDisplayed()` false, which is
exactly the overlap the second round reproduced, and W22 with no transform
write happening at all. The audit's first round also corrected a stale
`plans/` path in the test file's header comment.

*Verification* 1-5 all pass: `npm run typecheck` and
`npm -w packages/lib run typecheck:test` clean, `npm test` green at 508 files
and 8,440 tests (8,438 passing, 2 todo) including `tests/overlay/Rail.test.ts`
and `AbstractWindow.minimizedStackResize.test.ts`, `npm run lint` clean,
`npm run docs:api` at the same 0 errors and 14 pre-existing warnings as
`master` with none in the overlay package, and `npm run docs:llms:check` clean
at 108 catalogued. Step 6, the in-engine pass by eye, is the user's to run —
it opens windows, and it exercises the plan's original rows as written. The
attach-while-docked path W18-W28 and R1-R9 cover has no in-engine affordance to exercise
it: `MiscPanel`'s rail demo keeps its `Rail` inside the toggle button's closure
and calls `setRail` only on the window it constructs, before that window is
shown, so nothing there attaches a rail to a window that is already minimized.
Giving the panel one would be a demo change this plan did not scope (the same
reasoning as its *The QA `windows` panel gains nothing* decision), so those
four cases are pinned offline only — deliberately, not silently.
