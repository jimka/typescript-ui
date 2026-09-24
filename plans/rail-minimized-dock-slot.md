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

### The display hand-over stays out

Moving a minimized window between the rail and the dock does not change what is on screen: an attach leaves the window visible in the strip it was already in, and a detach leaves it hidden. This plan changes which slots the dock hands out, not what each window shows.[^handover]

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

- **The display hand-over between rail and dock.** Attaching a rail to a docked window leaves that window visible in its strip while the rail also shows a handle for it; detaching a rail from a rail-minimized window leaves it hidden, and still carrying the shrink-into-the-rail transform its collapse left on it, in the dock slot it is now given. Both are pre-existing and unchanged by this plan, which decides slots, not what each window shows. Fixing them means running the docked branch's own preparation — the relaxed minimum size, the hidden body host, and the reverse of that collapse — from `setRail`, a geometry change with its own risk, its own tests, and its own plan.
- **The construct-minimized defect** — a window constructed with `windowState: "minimized"` is not placed until something triggers a relayout. See `## Architecture Decisions`.
- **A rail-minimized case in the QA app.** See `## Architecture Decisions`.
- **Any change to the dock's resize listener.** `installStackResizeListener` / `uninstallStackResizeListener` / `onStackViewportResize` and `show()`'s guard are already rail-aware and are left exactly as `environment-read-caching` left them; only the count that drives the install changes, and only because the loop it sits in changed.

---

## Notes

[^docked-term]: *Docked window* is `environment-read-caching`'s own term, defined in its *The minimized dock answers a resize through one listener of its own* decision as "a minimized window with no `Rail`, the kind the dock places along the bottom edge". This plan reuses the term rather than coining a second one.

[^ownership]: The alternative considered was a predicate that also demands the window be displayed, so a hidden window could never hold a slot. It was rejected on two counts. `environment-read-caching` already settled `_rail === null` as the dock's ownership test — it is what `show()` guards on and what the relayout's `docked` tally counted — and a second, subtly different test in the same method is how the two drift apart. And `_rail` is set the moment `setRail` runs, whereas the rail path hides the window only when its collapse animation completes 150 ms later; a displayed-based test would hand the dock a slot to write for the length of that animation, every time.

[^setrail-relayout]: The call sites that already end in a relayout are `onExitAction` (`:1039`), `destructor` (`:1075`), and the three `setWindowState` animation completions (`:1236`, `:1276`, `:1293`). Leaving `setRail` out would not produce a *different* row — the next relayout from any of those would correct it — but it would leave a stale gap, or a stale slot, visible until some unrelated event happened to close it. The guard is `isMinimized()` rather than an unconditional call because a rail attached to a normal or maximized window changes nothing the dock lays out.

[^construct-minimized]: Recorded in `environment-read-caching`'s Implementation Notes: `initChrome` calls `setWindowState(this.getWindowState())`, which short-circuits on a state that is already current, so the docked branch never runs and the window has no captured restore rect, no relaxed minimum size and no hidden body host. That plan's audit probed placing it at `show()` and measured the cost — the window is clamped to its 200×200 minimum and a restore hands back the clamped rect instead of the one it was constructed with — so a real fix has to run the docked branch's preparation, which is a geometry change with tests of its own. It is a defect about a window's *preparation* for docking; this plan is about *which* windows the dock holds, and changes no geometry for a window the dock already held. One part of it does improve here for free: a window constructed minimized *with* a rail is no longer dragged into a dock slot by the next relayout.

[^handover]: The display hand-over is what a window shows once its owner changes: the rail hides the window it holds and shows a handle instead, while the dock shows the window itself as a header-height strip. `setRail` does neither today, so an attached rail adds a handle beside a window still visible in its dock slot, and a detached one leaves the window hidden. `## Non-Goals` records the shape a fix would take. The one consequence worth knowing while reading `## Expected Behaviour`: W15's detached window lands at the right slot position but keeps its normal-state minimum size, so its box is taller than the row — which is why the case asserts `x` and `y` and not `width` and `height`.

[^qa-panel]: `packages/qa/src/panels/windows.ts` builds `n` windows, a bare one, an insets one and an always-on-top one, and minimizes `⌊n / 2⌋` of them; none is given a rail, so the relayout's new guard never fires there and every counter, every `geometry` label including `min0`, and the panel's recorded baselines are unchanged. That is itself the useful check — the `windows` row of `packages/qa/README.md` carries Validated readings from three sessions plus the W3.0 baseline and the wave-3 A/B, and a rail added to the panel would move every one of them for a change with no measured cost component. If in-engine coverage is ever wanted, the panel's own idiom for it is an opt-in URL parameter (as `grip=` is), defaulting to no rail so the recorded cells still describe what the panel does — not worth its README and baseline churn for a bug the offline cases pin exactly.
