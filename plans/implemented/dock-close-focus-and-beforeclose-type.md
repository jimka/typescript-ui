---
touches-shared:
  - packages/lib/src/typescript/lib/overlay/Dock.ts
  - packages/lib/src/typescript/lib/overlay/index.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Dock close focus and beforeclose type — Implementation Plan

## Overview

Two `Dock` defects reported by the SQLAdmin consumer app, fixed together for 0.11.0.

**Focus drops to `null` while a panel is still open.** When the focused panel closes, [`Dock.recomputeFocusAfterClose`](packages/lib/src/typescript/lib/overlay/Dock.ts#L1851) looks for a survivor only in the region the closed panel came from. When that region is empty, it calls `setFocus(null)` even though other panels are still open, tiled or floated. A float's chrome ✕ takes the same path: [`onFloatClosed`](packages/lib/src/typescript/lib/overlay/Dock.ts#L1777) passes `null` as the region, so closing a focused float always emits `focus(null)`, even with tiled panels left. Reported case: tear a tab into a float, close every tiled tab, and the Dock emits `focus(null)` while the float's panel is on screen. A click into the float's content then does not correct it, because the float is already the active window and its `"activate"` does not fire again. The fix is a fixed fallback order across the whole dock, so focus is `null` only once no panel remains anywhere.

**`"beforeclose"` has the wrong controller type.** [`Dock.on("beforeclose")`](packages/lib/src/typescript/lib/overlay/Dock.ts#L2275), [`off`](packages/lib/src/typescript/lib/overlay/Dock.ts#L2338) and [`DockOptions.listeners.beforeclose`](packages/lib/src/typescript/lib/overlay/Dock.ts#L108) type the listener's controller as `TabCloseController`. A float window's chrome ✕ passes a `WindowCloseController` through the same event, and [`emit`](packages/lib/src/typescript/lib/overlay/Dock.ts#L2365) is already typed as the union. The fix adds a Dock-owned `DockCloseController` and types all four signatures with it.

Both changes live in `overlay/Dock.ts`. They also touch the overlay barrel, the `Dock` docs page, the unreleased changelog, and two existing test files. The consumer write-ups are the SQLAdmin `LIBRARY_NOTES.md` sections "`Dock` drops focus to `null`…" and "`Dock.on("beforeclose")` types a window close's controller…".

---

## Architecture Decisions

### Focus fallback order — mirror `activeTabRegion`, then floats by z-order

After the focused panel closes, the Dock focuses the first panel it finds in this order, and `null` only when every step finds nothing:

1. **Same region.** The tab the closed panel's own `Tab` region re-selected (today's behaviour).
2. **Same float.** When the closed panel lived in a float that is still open (a bare-`Window` mini-dock with several regions), that float's active panel.
3. **Tiled tree.** The active panel of `_lastActiveRegion` when that region is still in the tiled tree, else of each tiled `Tab` region in depth-first order.
4. **Frontmost float.** Floats holding this dock's panels, highest `getZIndex()` first; the first one with an active panel wins. Equal z-indexes keep `AbstractWindow.getOpenWindows()` order.

| Closed panel | Still open | Focus goes to | Step |
|---|---|---|---|
| tiled `b`, root region also holds `a` | `a` tiled | `a` | 1 |
| tiled `b`, its region B empties; region A holds `a` | `a` tiled | `a`, `window: null` | 3 |
| tiled `b`, the last tiled panel; float W holds `a` (the reported case) | `a` in W | `a`, `window: W` | 4 |
| float W's chrome ✕ while its `a` was focused | `b` tiled | `b`, `window: null` | 3 |
| float WB's chrome ✕ while its `b` was focused; floats WA, WC shown in that order, nothing tiled | `a` in WA, `c` in WC | `c` (WC is frontmost) | 4 |
| the last panel anywhere | nothing | `null` | — |

Step 3 uses the same preference as [`Dock.activeTabRegion`](packages/lib/src/typescript/lib/overlay/Dock.ts#L729), which picks the region `addPanel` docks into. Steps 2 and 4 read a float's panel through [`Dock.activeFrameInFloat`](packages/lib/src/typescript/lib/overlay/Dock.ts#L2174), the helper [`onFloatActivated`](packages/lib/src/typescript/lib/overlay/Dock.ts#L1761) already uses.[^fallback-order] Ranking floats by z-index is new to `Dock`.[^zindex]

### A candidate must be a registered frame, and a tiled one must sit under the root

Each step accepts a panel only when `this._frames.get(frame.getId()) === frame`. Step 3 also requires `this.isUnder(root, frame)`. Without these checks the empty-state placeholder tab, or a stale entry in a `Tab`'s bookkeeping, could be picked as the survivor.[^registered-only]

### No new interaction hook — the order is what keeps later clicks working

The plan adds no listener for "the user clicked into a panel". Two rules together make any later click correct the focus:

- Focus is `null` only when no panel is left.
- Step 3 (tiled) comes before step 4 (other floats).

A click into a float that is not the active window fires that window's `"activate"`, which the Dock already turns into `"focus"`. A click into tiled content fires nothing. The order therefore never parks focus on a float while the user can still click into tiled content.[^interaction]

### `DockCloseController` — one controller type per emitting class

`Dock` declares its own `DockCloseController` interface (`preventDefault(): void`). `on`, `off`, the `listeners` bag and `emit` all use it. This matches the existing pattern: every class with a vetoable close declares its own controller type and uses it in its whole public surface — [`TabCloseController`](packages/lib/src/typescript/lib/layout/Tab.ts#L75), [`WindowCloseController`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L129), [`DrawerCloseController`](packages/lib/src/typescript/lib/overlay/Drawer.ts#L43). The internal forwarders `onPanelBeforeClose` and `onFloatBeforeClose` keep their incoming parameter types and pass the controller on unchanged. All three existing controller types have the same shape, so a consumer listener annotated with `TabCloseController` or `WindowCloseController` still compiles.[^controller-type]

---

## Public API

New type in `overlay/Dock.ts`, exported from `overlay/index.ts`:

```typescript
/**
 * Controller handed to a Dock `"beforeclose"` listener. Calling
 * `preventDefault()` aborts the close the user just requested — a tab's ✕
 * (tiled or floated) or a float window's chrome ✕.
 *
 * @category Core
 */
export interface DockCloseController {
    /** Aborts the close that is about to run. */
    preventDefault(): void;
}
```

Changed signatures on `Dock` (only the controller type changes):

```typescript
// DockOptions.listeners
beforeclose?: (event: DockPanelEvent, controller: DockCloseController) => void;

on(event: "beforeclose", listener: (event: DockPanelEvent, controller: DockCloseController) => void): this;
off(event: "beforeclose", listener: (event: DockPanelEvent, controller: DockCloseController) => void): this;
protected emit(event: "beforeclose", payload: DockPanelEvent, controller: DockCloseController): void;
```

The `"focus"` event's signature is unchanged. What changes is when it carries `null`: only once no panel remains anywhere.

---

## Implementation

The new private helpers and the rewritten recompute in `overlay/Dock.ts`. Place the helpers directly after `recomputeFocusAfterClose`. Each gets a JSDoc block per `CODE_CONVENTIONS.md`.

```typescript
private scheduleFocusRecompute(region: Component | null, host: AbstractWindow | null): void {
    DOM.sink.requestAnimationFrame(() => this.recomputeFocusAfterClose(region, host));
}

private recomputeFocusAfterClose(region: Component | null, host: AbstractWindow | null): void {
    if (this._frames.size === 0) {
        this.setFocus(null);

        return;
    }

    const survivor = this.registeredActiveFrame(region)
        ?? this.activeFrameInOpenFloat(host)
        ?? this.activeTiledFrame()
        ?? this.frontmostFloatFrame();

    this.setFocus(survivor ? survivor.getId() : null);
}

// Step 1 and the per-region test for step 3.
private registeredActiveFrame(region: Component | null): Component | null {
    if (!region || !this.isTab(region) || region.getComponents().length === 0) {
        return null;
    }

    const frame = (region.getLayoutManager() as Tab).getActiveContent();

    return frame && this._frames.get(frame.getId()) === frame ? frame : null;
}

// Step 2. A closed float no longer holds registered frames, so it drops out of
// floatWindowsHoldingFrames() and yields null.
private activeFrameInOpenFloat(host: AbstractWindow | null): Component | null {
    if (!host || !this.floatWindowsHoldingFrames().includes(host)) {
        return null;
    }

    return this.activeFrameInFloat(host);
}

// Step 3. Same preference as activeTabRegion: the last-focused region first
// (when it is still in the tiled tree), then every tiled Tab region depth-first.
private activeTiledFrame(): Component | null {
    const root = this.getRootRegion();

    if (!root) {
        return null;
    }

    const regions: Component[] = [];
    const last = this._lastActiveRegion;

    if (last && this.containsRegion(root, last)) {
        regions.push(last);
    }

    this.collectTabRegions(root, regions);

    for (const region of regions) {
        const frame = this.registeredActiveFrame(region);

        if (frame && this.isUnder(root, frame)) {
            return frame;
        }
    }

    return null;
}

// Step 4. Array.prototype.sort is stable, so equal z-indexes keep
// getOpenWindows() order.
private frontmostFloatFrame(): Component | null {
    const floats = this.floatWindowsHoldingFrames().sort((a, b) => b.getZIndex() - a.getZIndex());

    for (const win of floats) {
        const frame = this.activeFrameInFloat(win);

        if (frame) {
            return frame;
        }
    }

    return null;
}
```

The `if (!root)` guard copies the one in [`allTabRegions`](packages/lib/src/typescript/lib/overlay/Dock.ts#L2109). `_lastActiveRegion` may be the region that just emptied. `registeredActiveFrame` returns `null` for it, and the depth-first walk continues.

---

## Ordered Implementation Steps

1. **Tests first — focus fallback.** In [`packages/lib/tests/overlay/Dock.lifecycle.test.ts`](packages/lib/tests/overlay/Dock.lifecycle.test.ts), add a module-level helper `floatPanel(dock: Dock, id: string): Window`. It copies the setup of the existing test `'emits focus for a float\'s active panel on window activation'` (line 406): `new Window(...)`, `show()`, `moveComponent(frameOf(dock, id))`, `priv(dock).scheduleSweep()`, `flush()`, then `getElement(true)` on each collected float region and on the window, then `win.doLayout()`. Follow it with `dock.doLayout()` so the root `Tab` re-reads its children. Add the new cases from *Expected Behaviour* to the `describe('Dock close', …)` block. Run `npx vitest run tests/overlay/Dock.lifecycle.test.ts` from `packages/lib`: cases 1–5 must fail (each gets `null` or no focus event); the existing ones must still pass.
2. **`overlay/Dock.ts` — recompute.** Replace `scheduleFocusRecompute` (line 1840) and `recomputeFocusAfterClose` (line 1851) with the versions in *Implementation*. Add the four private helpers after them. Update both JSDoc blocks: the recompute now falls back across the whole dock and emits `focus(null)` only when no panel remains; `host` is the closed panel's last host (`null` for tiled).
3. **`overlay/Dock.ts` — `onPanelClosed` (line 1580).** Next to the existing `const region = …` line, and before the three `delete` calls, add `const host = this._panelHost.get(id) ?? null;`. Change the call to `this.scheduleFocusRecompute(region, host);`. Update the handler's JSDoc sentence about recomputing focus to match.
4. **`overlay/Dock.ts` — `onFloatClosed` (line 1777).** Change the call to `this.scheduleFocusRecompute(null, null);`. The closed float is gone, so steps 1 and 2 have nothing to offer; steps 3 and 4 do the work. Re-run step 1's test file: all cases green.
5. **Tests first — controller type.** In [`packages/lib/tests/overlay/Dock.beforeClose.test.ts`](packages/lib/tests/overlay/Dock.beforeClose.test.ts), import `DockCloseController` from `~/overlay/Dock`. In `describe('Dock "beforeclose" — float chrome ✕', …)`, add cases 7 and 8 from *Expected Behaviour*. `npm run typecheck:test` fails until step 6 adds the type.
6. **`overlay/Dock.ts` — `DockCloseController`.** Add the interface from *Public API* directly after the `DockEvent` type alias (line 158). Change the controller type at line 108 (`listeners.beforeclose`), line 2275 (`on`), line 2338 (`off`) and line 2365 (`emit`) to `DockCloseController`. Keep the `TabCloseController` and `WindowCloseController` imports: `onPanelBeforeClose`, `onFloatBeforeClose` and `subscribeFloatWindows` still use them. Check: `grep -n 'controller: TabCloseController\|TabCloseController | WindowCloseController' packages/lib/src/typescript/lib/overlay/Dock.ts` lists only `onPanelBeforeClose` (line 1710).
7. **`overlay/Dock.ts` — JSDoc.**
   - In the `DockEvent` block (lines 145–151), replace "carrying the same {@link TabCloseController} / {@link WindowCloseController} `Tab`/`AbstractWindow` handed Dock" with "carrying a {@link DockCloseController} — the controller the `Tab` or window handed Dock, passed on unchanged".
   - In the same block (lines 131–133), change "`null` when nothing is focused" to "`null` only once no panel remains anywhere".
   - In the `on("focus")` JSDoc (lines 2229–2231), make the same change to "or `null` when nothing is focused (e.g. the last panel closed)".
   - In the `on("beforeclose")` JSDoc, name `DockCloseController` in the `@param listener` line.
8. **`overlay/index.ts` (line 29).** Add `DockCloseController` to the `export type { … } from '~/overlay/Dock.js'` list.
9. **`packages/lib/docs/components/Dock.md`.**
   - In the events table (line 91), change the `beforeclose` payload cell to ``{ id, content, window }`, [`DockCloseController`](/api/overlay/interfaces/DockCloseController)``.
   - Extend the `focus` bullet (line 120) with: "When the focused panel closes, focus moves to the tab its region re-selects; if that region is empty, to the active panel of the same float, then of the tiled tree, then of the frontmost float. `null` means no panel is left anywhere."
10. **`packages/lib/docs/reference/changelog/next.md`.**
    - Under `## Added`, add a `### Overlay` subsection after `### Layouts`, with the `DockCloseController` entry from *Documentation Impact*.
    - Under `## Fixed` → `### Overlay`, append the focus entry from *Documentation Impact*.
11. **Full checks.** Run everything in *Verification*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/Dock.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/index.ts` |
| Modify | `packages/lib/tests/overlay/Dock.lifecycle.test.ts` |
| Modify | `packages/lib/tests/overlay/Dock.beforeClose.test.ts` |
| Modify | `packages/lib/docs/components/Dock.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Unit-testable in `Dock.lifecycle.test.ts`, `describe('Dock close', …)`. Every case records `dock.on('focus', …)` after setup, acts, then calls `flush()`.

1. **Tiled region empties, a float remains (the reported case).** Add `a`, `b`; `floatPanel(dock, 'a')` → `win`; `dock.focusPanel('b')`; `dock.removePanel('b')`. The last focus event has `id === 'a'` and `window === win`, and no recorded event is `null`.
2. **Same, with the empty-state placeholder.** As case 1, but build the dock with the existing `mountDockWithPlaceholder(placeholder)` helper (line 941). The last focus event has `id === 'a'`, and `priv(dock)._focusedPanelId === 'a'`. The placeholder's id is never focused.
3. **One tiled region empties, another tiled region remains.** Use the existing `twoRegionDock()` helper (line 268). Call `priv(dock).onPanelFocused(frameOf(dock, 'b'))`, then `dock.removePanel('b')`. The last focus event has `id === 'a'` and `window === null`.
4. **The focused float's chrome ✕, a tiled panel remains.** Add `a`, `b`; `floatPanel(dock, 'a')` → `win`; `win.onActivate(true)` (focus `a`); `win.requestClose()`. The last focus event has `id === 'b'` and `window === null`.
5. **The focused float's chrome ✕, nothing tiled, two other floats.** Add `a`, `b`, `c`. Call `floatPanel` for `a`, `b`, `c` in that order → `wa`, `wb`, `wc`, so `wc` has the highest z-index. `wb.onActivate(true)` (focus `b`); `wb.requestClose()`. The last focus event has `id === 'c'` and `window === wc`. Picking `a` would mean the fallback used insertion order instead of z-order.
6. **Existing cases unchanged.** `'emits focus(null) when the last panel closes'` and `'shifts focus to a surviving sibling when the focused tab closes'` still pass without edits.

Unit-testable in `Dock.beforeClose.test.ts`, `describe('Dock "beforeclose" — float chrome ✕', …)`:

7. **Float ✕ delivers a `DockCloseController`.** Add a module-level named function `vetoB(event: DockPanelEvent, controller: DockCloseController): void` that calls `controller.preventDefault()` when `event.id === 'b'`. Using `tearOffTwoIntoOneFloat`, register it with `dock.on('beforeclose', vetoB)`, then call `win.requestClose()`. The window stays in `AbstractWindow.getOpenWindows()` and no `"close"` fires.
8. **The `listeners` bag accepts the same listener.** `new Dock({ listeners: { beforeclose: vetoB } })` constructs without error. `npm run typecheck:test` compiling cases 7 and 8 is the type-level check.

Manual only (the offline harness cannot drive it):

9. **Step 2, a multi-region float.** Shift-tear two tabs into one bare-`Window` float, split it into two regions, focus a tab in one region, and close that region's last tab. Focus moves to the other region of the same float, not to a tiled panel.
10. **The reported repro in SQLAdmin** (see *Verification*).

---

## Verification

From `packages/lib`:

- `npm run typecheck` and `npm run typecheck:test` pass.
- `npx vitest run tests/overlay/Dock.lifecycle.test.ts tests/overlay/Dock.beforeClose.test.ts`: all green, including the new cases.
- `npm test` passes.
- `npm run lint` passes.
- `npm run docs:api` finishes with zero warnings.
- `grep -n 'DockCloseController' src/typescript/lib/overlay/index.ts` shows one match.

Manual, in SQLAdmin against the built library (`npm run build:lib`, then symlink it into SQLAdmin):

1. Tear a query tab into a float, then close every tiled tab through the tab menu's *Close all*. The status-bar caret readout stays visible and follows typing in the float's editor, with no click on the float's tab strip. This means the Dock emitted `focus` for the float's panel, not `null`.
2. With one tiled tab and two floats open, focus a float's panel and close that float with its chrome ✕. The address bar follows the tiled tab. Then click into the other float's editor: the address bar follows that float.

---

## Documentation Impact

- **Export:** `DockCloseController` joins the `overlay` barrel (step 8). TypeDoc publishes it at `/api/overlay/interfaces/DockCloseController`.
- **Docs page:** `packages/lib/docs/components/Dock.md` (step 9). No new page or sidebar entry.
- **Changelog entries** for `next.md` (step 10):

  Under `## Added` → `### Overlay`:

  > - **`DockCloseController`** types the controller a `Dock` `"beforeclose"` listener receives. `Dock.on("beforeclose")`, `off` and `DockOptions.listeners.beforeclose` used to declare a `TabCloseController`, although a float window's chrome ✕ passes a `WindowCloseController`. All three types have the same `preventDefault()` shape, so a listener annotated with either old type still compiles.

  Under `## Fixed` → `### Overlay`:

  > - **`Dock` no longer emits `focus(null)` while a panel is still open.** When the focused panel closed and its region was left empty — the last tiled tab closing while a float stayed open, or a focused float closed with its chrome ✕ — the Dock reported that nothing was focused. A click into an already-active float did not correct it. Focus now moves to the active panel of the same float, then of the tiled tree, then of the frontmost float. `focus(null)` fires only once no panel remains anywhere. No consumer action is needed.

- No migration note: nothing breaks.

---

## Potential Challenges

- **The root `Tab` keeps a stale entry after a raw `moveComponent` in tests.** A test that skips `dock.doLayout()` after floating a panel can pass case 1 for the wrong reason. Mitigation: `floatPanel` ends with `dock.doLayout()`, and step 3 of the fallback requires `isUnder(root, frame)`.
- **A float's z-index is 0 until it has been shown.** `floatPanel` calls `show()` before anything reads z-order, so `LayerManager` has already stamped each window.
- **`floatWindowsHoldingFrames()` returns a fresh array.** Sorting it in place in `frontmostFloatFrame` changes nothing shared.

---

## Critical Files

- [`packages/lib/src/typescript/lib/overlay/Dock.ts`](packages/lib/src/typescript/lib/overlay/Dock.ts) — `recomputeFocusAfterClose` (L1851), `onPanelClosed` (L1580), `onFloatClosed` (L1777), `setFocus` (L1811), `activeTabRegion` (L729, the precedent for step 3), `activeFrameInFloat` (L2174), `floatWindowsHoldingFrames` (L1166), `collectTabRegions` (L2140), `containsRegion` (L757), `isUnder` (L2203).
- [`packages/lib/src/typescript/lib/layout/Tab.ts#L75`](packages/lib/src/typescript/lib/layout/Tab.ts#L75), [`overlay/AbstractWindow.ts#L129`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L129), [`overlay/Drawer.ts#L43`](packages/lib/src/typescript/lib/overlay/Drawer.ts#L43) — the per-emitter controller precedent.
- [`packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L934`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L934) (`onActivate`) and [`core/LayerManager.ts#L722`](packages/lib/src/typescript/lib/core/LayerManager.ts#L722) (`markActive`) — why a click into the active window fires no `"activate"`.
- [`packages/lib/tests/overlay/Dock.lifecycle.test.ts`](packages/lib/tests/overlay/Dock.lifecycle.test.ts) — harness (`captureRaf`, `flush`, `mountDock`, `twoRegionDock`, `mountDockWithPlaceholder`) and the float-activation test the new helper copies.

---

## Non-Goals

- **A click into an active float after `focusPanel(tiledId)`.** A programmatic `focusPanel` on a tiled panel leaves a float that was the active window still active, so a later click into it fires no `"activate"`. This is older than this fix and reached by a different path. Fixing it needs a window-level signal for "pressed while already active", which is a separate `AbstractWindow` decision.
- **Telling a tab ✕ from a window ✕ in `"beforeclose"`.** The SQLAdmin note flags this as related, and the app does not need it.
- **Moving DOM keyboard focus or raising the fallback float.** The Dock's `"focus"` event is bookkeeping; it has never raised or focused anything on a close.
- **Ranking minimized floats last.** Step 4 uses z-index only.
- **Updating SQLAdmin's `LIBRARY_NOTES.md`.** That happens on the consumer side once 0.11.0 ships.

---

## Notes

[^fallback-order]: Order rationale. Step 1 keeps today's behaviour for the common case. Step 2 keeps focus inside the float the user was working in. Step 3 goes before step 4 because the Dock's two hosts report clicks differently. A click into a float that is not the active window fires its `"activate"`, and `onFloatActivated` turns that into `"focus"`. A click into tiled content fires nothing, since `Tab` emits `"activate"` only on a tab change. So when both a tiled panel and another float survive, focusing the tiled one leaves every later click able to correct focus; focusing the float would leave a click into tiled content unreported. The `activeTabRegion` preference (last-focused region, then depth-first) was reused so "which tiled panel" is answered the same way everywhere in `Dock`.

[^zindex]: No existing code in `Dock`, `DragManager` or the layout managers picks among open windows by stacking order; the nearest precedent is `LayerManager`'s own ordering, which is internal. `Component.getZIndex()` is public and, for a window, mirrors the stamp `LayerManager` assigns (`AbstractWindow.onZIndexChanged` is the window's only z-index writer), so it names the frontmost float without a new `LayerManager` export. Insertion order from `getOpenWindows()` was rejected: it names the oldest float, not the one on top. The SQLAdmin note suggested "the frontmost float's active panel" for the same reason.

[^registered-only]: The old recompute called `setFocus(frame.getId())` for whatever the region's `Tab` reported as active. With `emptyContent` set, the root region's re-selected tab after the last tiled close can be the placeholder, because the sweep that re-shows it runs in the same animation frame. `setFocus` then stored the placeholder's id in `_focusedPanelId` and emitted nothing, because `_frames` does not hold it. The `isUnder(root, frame)` check guards step 3 against a `Tab` whose internal list still names a frame that has moved into a float (see the stale-entry comment in `Dock.beforeClose.test.ts`'s `tearOffTwoIntoOneFloat`). That frame is registered, but it is not tiled.

[^interaction]: `AbstractWindow` subscribes a subtree `mousedown` that calls `bringToFront()`, which calls `LayerManager.markActive`. `markActive` returns early when the window is already the active layer, so `onActivate(true)`, and with it `"activate"`, fires only when activation actually changes. That is why the reported click into the float did nothing. Two alternatives were rejected. Making `"activate"` re-fire on every press would change a documented `AbstractWindow` event ("when the window becomes the active layer") for one consumer. A Dock-level press listener on float windows would break the ARCHITECTURE.md rule against listening to another component's events through `Event`. Keeping focus non-null while panels exist, plus the step order, removes the state the click was needed to repair.

[^controller-type]: Two other options were considered. Typing the listener as `TabCloseController | WindowCloseController` needs no new symbol, but it makes every consumer import two types from two modules to annotate one listener, and it leaves `Dock` as the only vetoable emitter without its own controller type. One shared cross-module `CloseController` would mean retyping `Tab`, `AbstractWindow` and `Drawer` too — a wider public change than the defect needs. TypeScript compares these interfaces by shape, and all four are `{ preventDefault(): void }`. So forwarding a `TabCloseController` or `WindowCloseController` into `emit`'s `DockCloseController` parameter compiles with no cast, and existing annotated listeners (including `Dock.beforeClose.test.ts`'s `WindowCloseController` one) keep compiling.

---

## Implementation Notes

- **`floatPanel` also prunes the source `Tab` entry.** Step 1 said to copy the float-activation test's setup and end with `dock.doLayout()` so the root `Tab` re-reads its children. That does not clear the stale entry: `Tab.doLayout` reconciles only *added* children, so after a raw `moveComponent` the root `Tab` still named the moved frame as its active content. With that setup, case 2 passed on the unfixed code, because the old recompute picked the stale-but-registered `a`. The helper now also calls the source `Tab`'s private `removeEntryKeepingContent` on the moved frame's strip entry, which is what a real tear-off (`Tab.detachTabToWindow`) does. With that change all five new cases fail before the fix and pass after it. The trailing `dock.doLayout()` stays. No production code differs from the plan.
- **Case 2 lays the dock out between queued frames.** In the offline harness, the sweep that re-shows the placeholder and the focus recompute are queued together and nothing lays the root `Tab` out between them. So the placeholder was never the `Tab`'s active content, and the case could not exercise the registered-frame guard: with that guard removed it still passed. The case now drains the queue through a `flushLayingOut(dock)` helper, which calls `dock.doLayout()` before each callback. It also asserts the precondition that the root `Tab`'s active content is the placeholder. Removing the guard now fails it.
- **Three cases beyond *Expected Behaviour*.** These pin ordering decisions the plan's cases left unobserved:
  - A focused float closes while both a tiled panel and another float survive. Focus goes to the tiled panel (step 3 before step 4).
  - A float closes while the last-focused tiled region is not the first one depth-first. Focus goes to the last-focused region's panel (the `_lastActiveRegion` preference).
  - A raw `moveComponent` leaves a tiled `Tab` naming a now-floated frame as its active entry. The recompute skips that entry for a genuinely tiled panel (the `isUnder(root, frame)` check).
  
  Each case fails when its rule is removed from `Dock.ts`. They use a new `regionsDock(regions)` helper, the n-region form of `twoRegionDock`.
