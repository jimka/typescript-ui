---
depends-on: [focus-history-can-go-back-follows-focus]   # the tip of the keyboard stack; every line number below was taken there (59a5c2e27)
touches-shared:
  - packages/lib/src/typescript/lib/overlay/AbstractWindow.ts    # window-focus-on-show edits the show and focus paths; this plan edits resolveBodyHost and fadeRectSwap
  - packages/lib/src/typescript/lib/overlay/Menu.ts
  - packages/lib/src/typescript/lib/overlay/Popover.ts
  - packages/lib/src/typescript/lib/overlay/DragManager.ts
  - packages/lib/docs/reference/changelog/next.md                # edited by every branch
---

# References to Disposed Components — Implementation Plan

## Overview

`plans/deferred-work-after-dispose.md` covers a component that is disposed while work it deferred is still pending. This plan covers the opposite arrangement: **an object that lives on while something it refers to goes away**. The survivor then reads a released DOM handle, calls a destroyed component, or waits for an event that can no longer arrive. A *handle* is the library's opaque id for one DOM element; a component releases its handles when it is disposed, and using a released handle throws `DOM handle N is not registered`.

Four survivors were found, each reproduced by a test run. They share no code, and each fix uses an idiom the library already has.

| # | Survivor | What goes away | What happens today |
|---|---|---|---|
| 1 | an open `Popover` | the component it is anchored to, or a scrolling ancestor of it | the next window resize throws `handle … is not registered`; closing the popover throws in a browser |
| 2 | `DragManager`'s drag session | the component being dragged from — disposed by the application, or by the drop handler the drag ends in | the session never ends: no drag can start again on the page, the ghost stays on screen, and `DragManager.cancel()` throws |
| 3 | a `Window` | its body content, replaced by the application | a replacement made during a maximise or restore animation throws and leaves the window unusable; one made at rest is not hidden when the window is minimised |
| 4 | a `MenuItem`'s 150 ms submenu timer | the menu, which closed | the timer opens a submenu for a menu that is no longer shown |

All four are in `packages/lib/src/typescript/lib/overlay/` and `component/container/MenuItem.ts`. No public API changes. The plan does not depend on `deferred-work-after-dispose` and can be implemented before or after it.

---

## Architecture Decisions

### A stored handle is checked with `DOM.source.isRegistered` before it is used

`Popover` keeps the handle of its anchor and the handles of the anchor's scrolling ancestors. Before reading or writing through one of them it asks `DOM.source.isRegistered(handle)`. `Dialog.restorePreviousFocus` ([Dialog.ts:1533](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1533)), `Drawer` ([Drawer.ts:527](packages/lib/src/typescript/lib/overlay/Drawer.ts#L527)), `Menu` ([Menu.ts:1358](packages/lib/src/typescript/lib/overlay/Menu.ts#L1358)) and `Tooltip` ([Tooltip.ts:132](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L132)) already guard a stored handle this way.[^is-registered]

### A popover whose anchor is gone closes

`Popover._reposition` already closes the popover when the anchor measures zero by zero, which is how a detached element reads. A released anchor is the same situation and gets the same answer: `hide()`.[^popover-close]

### A drag whose source is destroyed is abandoned, and its source is told nothing

`DragManager.makeDragSource` registers one `onDestroy` callback per component. When the source of the active session is destroyed, the session ends: the ghost, the validity tint and the insertion indicator are disposed, the cursor is restored, and the current drop target hears `onDragLeave`. Neither `"dragend"` nor `onDragEnd` fires. `Tooltip.attach` wires its own cleanup through `onDestroy` in the same way ([Tooltip.ts:662](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L662)).[^abandon]

### The window looks its body host up again when the cached one is stale

`AbstractWindow.resolveBodyHost` discards a cached host that is destroyed or is no longer the window's child. The glide of `fadeRectSwap` checks, when it lands, that the host it captured is still the window's body host. `Split` and `Border` test `isDestroyed()` on a component they kept a reference to for the same reason ([Split.ts:2055](packages/lib/src/typescript/lib/layout/Split.ts#L2055)).[^body-host]

### A closing menu cancels its items' pending submenu timers

`Menu.hide` and `Menu.close` cancel the hover timer of every item, next to the existing `closeOpenSubmenu()` call. The timer's own cancel on `mouseout` cannot be relied on, because the browser sends no `mouseout` for an element removed under a resting pointer.[^menu-timer]

### The branch goes on the keyboard stack

The branch starts from `feature/focus-history-can-go-back-follows-focus`. That stack rewrote `overlay/Menu.ts` and `overlay/Popover.ts`, and no file this plan edits is touched by the Markdown stack or by `feature/nested-scroll-reveal`.

---

## Decisions Awaiting Sign-off

| # | Change | Before | After | Recommendation |
|---|---|---|---|---|
| D1 | A drag source destroyed mid-drag | the session stays open for ever | the session is abandoned; `"dragend"` and `onDragEnd` do not fire for it | Yes. Ending it the normal way would report a release over empty space, which a `TabBar` answers by tearing the tab off into a new window. |
| D2 | An open `Popover` whose anchor is disposed | stays open until the next resize or scroll, which throws | closes on that resize or scroll, and `onClose` fires | Yes. It matches what a detached anchor already does. |
| D3 | `Popover.show()` with an anchor that was disposed since `attachToComponent` | throws from `_reposition` | warns and does nothing, as it does with no anchor | Yes. |

None needs a migration note: no consumer code has to change.

---

## Internal Structure

### `Popover`

`show()` — the opening test becomes:

```ts
    show(): this {
        const anchor     = this._anchorElement;
        const anchorLive = anchor !== null && DOM.source.isRegistered(anchor);

        if (!anchorLive) {
            console.warn("Popover.show(): no anchor attached; call attachToComponent first.");
            return this;
        }
```

`_reposition()` — after the existing `if (!this._anchorElement) { return; }`:

```ts
        // The anchor was stored when it was attached and may have been
        // disposed since. isRegistered first: the rect read below throws on a
        // released handle.
        const anchorLive = DOM.source.isRegistered(this._anchorElement);

        if (!anchorLive) {
            this._anchorElement = null;
            this.hide();

            return;
        }
```

`detachRepositionListeners()` — the loop becomes:

```ts
        for (const ancestor of this._scrollAncestors) {
            // An ancestor disposed while the popover was open took its
            // listener with it; removing through its released handle throws.
            const live = DOM.source.isRegistered(ancestor);

            if (live) {
                DOM.sink.removeListener(ancestor, "scroll", this._onScroll);
            }
        }
```

### `DragManager`

`endSession` gains a fourth parameter, defaulting to today's behaviour:

```ts
function endSession(dropped: boolean, clientX: number, clientY: number, notifySource: boolean = true): void {
```

and its last block becomes:

```ts
    if (session.committed && notifySource) {
```

New module-level state, next to `dragSources`:

```ts
// Components whose teardown already abandons their drag session. `onDestroy`
// has no matching removal, so each component is wired once however often it
// is registered — as `Tooltip.attach` does.
const destroyWired: WeakSet<Component> = new WeakSet<Component>();
```

A new function, after `tearDownDropTarget`:

```ts
/**
 * Ends the active session without telling its source, for a source that is
 * being destroyed. The session's own end runs from viewport listeners
 * registered against the source, which its teardown has just purged, so
 * without this the session would stay open for the life of the page.
 *
 * The source hears neither `"dragend"` nor `onDragEnd`: both report a release,
 * and a release over empty space is what tears a tab off into a new window.
 * The current drop target does hear `onDragLeave`, so its highlight clears.
 *
 * @param component - The component being destroyed.
 */
function abandonSessionOf(component: Component): void {
    if (activeSession === null || activeSession.source !== component) {
        return;
    }

    const session = activeSession;

    leaveCurrentTarget(session, buildDetail(session, 0, 0));

    // A tab drag parks its content in the registry until the gesture ends.
    const data = session.dragData as Partial<TabDragData>;

    if (data.tabDrag === true && typeof data.componentId === "string") {
        tabDragRegistry.delete(data.componentId);
    }

    endSession(false, 0, 0, false);
}
```

`makeDragSource` — after the existing two statements:

```ts
        const wired = destroyWired.has(component);

        if (!wired) {
            destroyWired.add(component);
            component.onDestroy(abandonSessionOf.bind(null, component));
        }
```

`onMouseUp` — a drop handler may itself dispose the source. The dispatch after `onDrop` becomes:

```ts
                const onDropResult = target.options.onDrop?.(detail);
                const sourceGone   = session.source.isDestroyed();

                if (onDropResult !== false && !sourceGone) {
                    Event.fireEvent(session.source, "drop", { detail });
                }
```

The `endSession(dropped, e.clientX, e.clientY)` call that follows is unchanged: when the source was destroyed inside `onDrop`, `abandonSessionOf` has already ended the session and `endSession` returns at its first line.

### `AbstractWindow`

```ts
    private resolveBodyHost(): Component | null {
        const cached = this._bodyHost;

        // The application may have replaced the content since the host was
        // cached; a destroyed or re-parented one is no longer this window's body.
        const stale = cached !== null && (cached.isDestroyed() || cached.getParentComponent() !== this);

        if (cached === null || stale) {
            this._bodyHost = this.findBodyHost();
        }

        return this._bodyHost;
    }
```

In `fadeRectSwap`, the glide's `onComplete` starts with:

```ts
                    onComplete: (): void => {
                        // The body was replaced or removed during the glide.
                        // `host` and `element` are then dead: there is nothing
                        // to resume and nothing to fade back in.
                        const current = this.resolveBodyHost();

                        if (current !== host) {
                            this._stateAnimHandle = null;
                            this._bodyFadeActive  = false;
                            onDone?.();

                            return;
                        }

                        // The one relayout the glide above deferred, paid now
```

### `MenuItem` and `Menu`

`MenuItem` — a new public method, and `_onMouseOut` and `destructor` call it in place of their own copies of the same three lines:

```ts
    /**
     * Cancels the hover timer that would open this item's submenu. Called by
     * the owning menu when it closes: no `mouseout` arrives for an item removed
     * under a resting pointer.
     *
     * @internal
     */
    cancelPendingSubmenu(): void {
        if (this._submenuTimer !== null) {
            clearTimeout(this._submenuTimer);
            this._submenuTimer = null;
        }
    }
```

`Menu` — a new private method, called from `hide()` and `close()` directly after `this.closeOpenSubmenu();`:

```ts
    /**
     * Cancels every item's pending submenu timer, so a hover that began just
     * before this menu closed cannot open a submenu for it afterwards.
     */
    private cancelPendingSubmenus(): void {
        for (const row of this._menuItems) {
            if (row instanceof MenuItem) {
                row.cancelPendingSubmenu();
            }
        }
    }
```

---

## Ordered Implementation Steps

Run every command from `packages/lib`, with one vitest process and `--maxWorkers=1` or `2`.

1. **Record the baseline.** `npx vitest run --maxWorkers=2 2>&1 | tail -15`; write the "Test Files" and "Tests" lines into the Implementation Notes.

2. **Popover.**
   - Add cases P1–P4 of `## Expected Behaviour` to `tests/overlay/Popover.test.ts`, in a new `describe('Popover — anchor disposed while open', …)`. Run the file: P1, P2 and P3 fail; P4 passes.
   - Edit `show()` (line 507), `_reposition()` (line 726) and `detachRepositionListeners()` (line 1014) of `src/typescript/lib/overlay/Popover.ts` as in `## Internal Structure`.
   - Run the file again: no failure.

3. **Drag session.**
   - Create `tests/overlay/DragManager.sourceDisposed.test.ts` with cases S1–S5, built as `## Expected Behaviour` → *Drag session* describes. Run each case alone, for example `npx vitest run tests/overlay/DragManager.sourceDisposed.test.ts -t "S1" --maxWorkers=1`: S1, S2, S3 and S5 fail; S4 passes.
   - Edit `src/typescript/lib/overlay/DragManager.ts`: the `endSession` parameter (line 721) and its last block (line 779), `destroyWired`, `abandonSessionOf`, the wiring in `makeDragSource` (line 247), and the `onMouseUp` dispatch (line 701).
   - Run the file again, then `npx vitest run tests/overlay/DragManager.test.ts tests/overlay/DragManager.repeatedDragDisposal.test.ts tests/component/dispose-drag-teardown.test.ts --maxWorkers=1`: no failure.

4. **Window body host.**
   - Create `tests/overlay/AbstractWindow.bodyHostReplaced.test.ts` with cases W0–W3, using the `beforeEach`, `flushFrame` and `makeWindow` of `tests/overlay/AbstractWindow.largeResizeFade.test.ts`. Run it: W1 and W2 fail, W3 fails on its last assertion, W0 passes.
   - Edit `resolveBodyHost` (line 2879) and the glide's `onComplete` in `fadeRectSwap` (line 3345) of `src/typescript/lib/overlay/AbstractWindow.ts`.
   - Run the file again, then `npx vitest run tests/overlay/AbstractWindow.largeResizeFade.test.ts tests/overlay/AbstractWindow.minimizeMinSize.test.ts --maxWorkers=1`: no failure.

5. **Menu submenu timer.**
   - Add cases M1–M3 to `tests/overlay/Menu.test.ts`, in a new `describe('Menu — a submenu hover pending at close', …)`. Run the file: M1 and M2 fail; M3 passes.
   - Add `cancelPendingSubmenu` to `src/typescript/lib/component/container/MenuItem.ts` and replace the bodies of the timer clears in `_onMouseOut` (line 331) and `destructor` (line 541) with a call to it.
   - Add `cancelPendingSubmenus` to `src/typescript/lib/overlay/Menu.ts` and call it in `hide()` (after line 592) and `close()` (after line 798).
   - Run the file again: no failure.

6. **Changelog** (`## Documentation Impact`), then everything in `## Verification`. Compare the full run with step 1: the failed count is unchanged and the passed count is higher by the 16 new tests.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/overlay/DragManager.sourceDisposed.test.ts` |
| Create | `packages/lib/tests/overlay/AbstractWindow.bodyHostReplaced.test.ts` |
| Modify | `packages/lib/tests/overlay/Popover.test.ts` |
| Modify | `packages/lib/tests/overlay/Menu.test.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Popover.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/DragManager.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/MenuItem.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases are unit tests unless marked manual.

### Popover

The fixture: a `Panel({ autoScroll: 'y' })` mounted on the document element at (50, 50), 200 by 100, holding a `Component` at (10, 10), 40 by 20; a `Popover` attached to that component with `attachToComponent` and shown. The modelled DOM reports no overflow for any element, so the fixture mocks `DOM.source.getComputedOverflow` to answer `{ overflow: 'auto', overflowX: 'auto', overflowY: 'auto' }` for the panel's element and the real answer for every other. `_scrollAncestors` then holds two handles: the panel's element and the document element. Assert that length in the fixture, so a fixture that stopped finding the panel fails loudly.

| # | Steps | Required | Today |
|---|---|---|---|
| P1 | dispose the panel; call the popover's `_onWindowResize` | no throw; `isOpen()` is `false` | throws `is not registered` from `_reposition` |
| P2 | spy on `DOM.sink.removeListener`; dispose the panel; `popover.hide()` | every recorded call's first argument satisfies `DOM.source.isRegistered` | the spy records the panel's released handle |
| P3 | attach, dispose the panel, then `show()` | no throw; one `console.warn`; `isOpen()` is `false` | throws from `_reposition` |
| P4 | control: no dispose; `_onWindowResize` | no throw; `isOpen()` stays `true` | same |

P2 asserts on the spy because the test DOM's `removeListener` does not look its handle up, while the browser seam's does and throws.[^test-dom-gap]

### Drag session

The file follows `tests/overlay/DragManager.pointerCoalescing.test.ts`: its `press`, `move` and `release` helpers, its `dragSource()` helper that keeps the teardown closure, and its `afterEach` — `DragManager.cancel()`, the kept teardown, then `DOM.reset()`. A press at (10, 10) and a move to (100, 100) commit a drag.

The session is module-level state. On the run before the fix, S1 leaves it open and every case after S1 in the same run fails with it. Run each case alone with `-t` to see its own failure.

| # | Steps | Required | Today |
|---|---|---|---|
| S1 | commit a drag; `source.dispose()` | `DragManager.isDragging()` is `false` | `true` |
| S2 | as S1, then commit a drag from a second source and release it | the second source's `onDragEnd` runs once | never runs: the press is ignored while the old session is open |
| S3 | a source with an `onDragEnd` spy and a `"dragend"` listener; commit; dispose | neither was called | not called either, but the session is still open (S1) |
| S4 | control: commit; release over nothing | `onDragEnd` called once with `dropped === false`; `isDragging()` is `false` | same |
| S5 | a drop target covering (50, 50) to (450, 450) whose `onDrop` disposes the source; commit over it; release | no throw; `isDragging()` is `false`; `onDragEnd` was not called | throws `Cannot fire event 'drop'. Component … is not in the DOM`; the session stays open |

S3 asserts `isDragging() === false` as well, so it fails today on that line.

### Window body host

`makeWindow(300, 200)` gives a shown window with one body child. `swap(win, body)` runs `win.removeComponent(body)`, `body.dispose()`, and adds a new `Component` with `Placement.CENTER`. `settle()` advances fake time by 300 ms and flushes frames, twelve times.

| # | Steps | Required | Today |
|---|---|---|---|
| W0 | control: `minimize()`, settle | the body's `isDisplayed()` is `false` | same |
| W1 | `minimize()`, settle, `restore()`, settle; swap; `minimize()`, settle | the replacement's `isDisplayed()` is `false` | `true`: the window hid the disposed component |
| W2 | `toggleMaximize()`, flush, advance 240 ms (the fade-out lands and the glide starts); swap; advance 150 ms, flush, settle; then `toggleMaximize()`, settle | no throw from any frame; `_bodyFadeActive` is `false`; the width reaches the viewport's 2000 and returns to 300 | the glide's last frame throws `is not registered`, and so does the next toggle |
| W3 | `toggleMaximize()`, flush, advance 100 ms (mid fade-out); swap; settle; then `toggleMaximize()`, settle | no throw; the second toggle leaves the window in state `"normal"` at width 300 | the second toggle throws |

In W3 the window stays 300 wide while its state reads `"maximized"`, until the second toggle. That is so before and after this plan (`## Non-Goals`).

### Menu

A persistent menu `new Menu([{ text: 'A', submenu: { items: [{ text: 'A1', action }] } }, { text: 'B', action }], onDismiss)`, opened on an anchor element, under `vi.useFakeTimers()`.

| # | Steps | Required | Today |
|---|---|---|---|
| M1 | dispatch `mouseover` on item A; `menu.close()`; advance 200 ms | the menu's `_openSubmenuPanel` is `null` | a `Menu` instance |
| M2 | a rebuild-mode menu shown with the same items; `mouseover` on A; `menu.hide()`; advance 200 ms | `_openSubmenuPanel` is `null` | a `Menu` instance |
| M3 | control: `mouseover` on A; advance 200 ms | `_openSubmenuPanel` is a `Menu` | same |

### Manual

1. **Popover.** In the demo, open a page with a popover anchored inside a closable dock tab. Open the popover, close the tab, then resize the browser window. The popover closes and the console stays clean.
2. **Drag.** Start dragging a dock tab and, while holding the button, close its window from the console (`win.dispose()` on a reference taken beforehand). Release. The ghost is gone, no window is torn off, and another tab can be dragged afterwards.

---

## Verification

- `npx vitest run tests/overlay/Popover.test.ts tests/overlay/Menu.test.ts tests/overlay/DragManager.sourceDisposed.test.ts tests/overlay/AbstractWindow.bodyHostReplaced.test.ts --maxWorkers=1` — no failure.
- `npx vitest run tests/overlay tests/component/dispose-drag-teardown.test.ts --maxWorkers=2` — no failure.
- `npm run typecheck`, `npm run typecheck:test`, `npm run lint` — clean.
- `npm run test` — the failed count equals step 1's; the passed count is step 1's plus 16.
- `npm run docs:api` — zero warnings.
- `npm run docs:llms:check` and `npm run build:lib` — succeed.
- `grep -n "clearTimeout(this._submenuTimer)" src/typescript/lib/component/container/MenuItem.ts` — one match, inside `cancelPendingSubmenu`.
- The two manual checks.

---

## Documentation Impact

No public API changes. `packages/lib/docs/reference/changelog/next.md`, under `## Fixed` → `### Overlay`, as the last bullets:

```markdown
- **A `Popover` whose anchor is disposed closes without an error.** Closing
  the panel that held the anchor while the popover was open made the next
  window resize, and the popover's own close, throw `DOM handle … is not
  registered`.
- **Disposing a component in the middle of a drag from it ends the drag.**
  The drag used to stay open for the life of the page: its ghost stayed on
  screen and no other drag could start. The drag is abandoned — its source
  hears neither `"dragend"` nor `onDragEnd`.
- **A `Window` whose content is replaced keeps working.** Replacing the body
  during a maximise or restore animation threw and left the window unable to
  change state, and a replacement made at any time stayed visible when the
  window was minimised.
- **A menu closed just after the pointer reached a submenu item no longer
  opens that submenu.**
```

---

## Potential Challenges

- **`onDestroy` callbacks run inside `Component.destructor`, after the element is removed.** `abandonSessionOf` therefore must not dispatch a DOM event on the source; it does not.
- **`destroyWired` must be a `WeakSet`.** A `Set` would pin every component that ever was a drag source.
- **A drop target can hear `onDragLeave` right after its own `onDrop`.** That happens when its `onDrop` disposed the source: the abandon runs inside the drop. Both callbacks clear the same hover visuals, so the second is harmless; do not add a guard for it.
- **A row re-registered as a drag source keeps its drag.** `tearDownDragSource` does not abandon the session — only destruction does. `TreeBody` tears its rows' registrations down and builds them again on a rebind, which can happen during a drag.
- **`getParentComponent()` on a removed child.** `removeComponent` clears the child's parent link, which is what makes the stale test in `resolveBodyHost` work for a replaced body. The `isDestroyed()` half covers a body disposed without being removed.
- **`Menu.hide()` is rebuild-mode only and `close()` persistent-mode only.** Both need the call; M1 and M2 cover one each.
- **Line numbers drift.** Find each site by the symbol named in the step. The numbers are from `59a5c2e27`.

---

## Critical Files

- [packages/lib/src/typescript/lib/overlay/Popover.ts](packages/lib/src/typescript/lib/overlay/Popover.ts) — `show` (507), `hide` (551), `_reposition` (726), `attachRepositionListeners` (998), `detachRepositionListeners` (1014).
- [packages/lib/src/typescript/lib/overlay/DragManager.ts](packages/lib/src/typescript/lib/overlay/DragManager.ts) — `TabDragData` and `tabDragRegistry` (47–66), `makeDragSource` (247), `tearDownDragSource` (314), `onSourceMouseDown` (339), `leaveCurrentTarget` (446), `onMouseUp` (671), `endSession` (721).
- [packages/lib/src/typescript/lib/component/container/TabBar.ts:3301](packages/lib/src/typescript/lib/component/container/TabBar.ts#L3301) — `onTabDragEnd`: why a session must not be ended with `dropped === false` on the source's behalf.
- [packages/lib/src/typescript/lib/overlay/Tooltip.ts:662](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L662) — the `onDestroy` wiring `DragManager` copies, with its `WeakSet`.
- [packages/lib/src/typescript/lib/overlay/AbstractWindow.ts](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) — `findBodyHost` (2863), `resolveBodyHost` (2879), `fadeRectSwap` (3315), `beginStateAnimation` (3412), `endBodyFade` (3427).
- [packages/lib/src/typescript/lib/overlay/Menu.ts](packages/lib/src/typescript/lib/overlay/Menu.ts) — `hide` (588), `close` (795), `clearItemHighlights` (820), `closeOpenSubmenu` (1248), `handleItemOpenSubmenu` (1797).
- [packages/lib/src/typescript/lib/component/container/MenuItem.ts:310](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L310) — the hover handlers and the timer.
- [packages/lib/src/typescript/lib/overlay/Dialog.ts:1520](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1520) — `restorePreviousFocus`, the `isRegistered` precedent.
- [packages/lib/tests/overlay/DragManager.pointerCoalescing.test.ts](packages/lib/tests/overlay/DragManager.pointerCoalescing.test.ts), [packages/lib/tests/overlay/AbstractWindow.largeResizeFade.test.ts](packages/lib/tests/overlay/AbstractWindow.largeResizeFade.test.ts), [packages/lib/tests/overlay/Popover.test.ts](packages/lib/tests/overlay/Popover.test.ts) — the fixtures the new cases reuse.
- [plans/implemented/pointer-drag-ends-on-dispose.md](plans/implemented/pointer-drag-ends-on-dispose.md), [plans/implemented/dialog-focus-restore-disposed-opener.md](plans/implemented/dialog-focus-restore-disposed-opener.md) — the same two shapes of defect, fixed earlier for other owners.

---

## Non-Goals

- **Landing the window on its target when the body is replaced during the 200 ms fade-out.** The fade is cancelled with the body's handle, so the glide it would have started never runs; the window keeps its old rectangle until the next state change (case W3). Closing that needs the window to hear the removal and jump to the target, which means new state on `AbstractWindow` for a replacement inside a 200 ms window.
- **What a `Dock` or a `Rail` owes the windows registered with it when it is disposed.** Both leave their `on` handlers on those windows. Whether a disposed dock closes its floats has to be decided first.
- **Ending a drag whose current drop target is destroyed.** Read, not reproduced: every library owner removes its target registration in `destructor`, after which the session treats the pointer as being over nothing.
- **Making the test DOM's `addListener` and `removeListener` reject a released handle.** It would let P2 assert a throw directly, and its effect on the existing suite is not known.
- **Removing the explicit drag-source teardown calls from library destructors.** They still remove the registration; `onDestroy` only adds the session's end.

---

## Notes

[^is-registered]: `HandleRegistry.resolve` throws on a released handle so that a use after release is loud, and `isRegistered` is the one read that answers instead of throwing. Six sites already ask it before using a handle they stored and do not own. A `try`/`catch` around the popover's reads would hide the same condition instead of testing for it.

[^popover-close]: Keeping the popover open with no anchor was the alternative: it would stay where it last was, pointing at nothing, until dismissed. `_reposition` already treats "the anchor is gone" as a reason to close, and its comment says so; the released-handle case was simply not reachable before handles were released on dispose.

[^abandon]: Reproduced two ways. After `source.dispose()` during a committed drag, `DragManager.isDragging()` stays `true`, a press on any other source is ignored (`onSourceMouseDown` returns while a session exists), and `DragManager.cancel()` throws `Cannot fire event 'dragend'. Component … is not in the DOM`. When the drop handler itself disposes the source — a drop that makes the application close or rebuild the place the drag came from — the release throws `Cannot fire event 'drop'` and leaves the same open session. The cause is the one `pointer-drag-ends-on-dispose` fixed for resize drags: the session's `mousemove` and `mouseup` listeners are registered against the source, and `Component.destructor` purges them. Three ways to end the session were weighed. Calling `endSession(false, …)` as `cancel()` does reports a release over empty space, and `TabBar.onTabDragEnd` answers that by emitting `"tearoffrequested"`, which opens a window for the tab of a strip that is being destroyed. Ending it from `tearDownDragSource` would also end a drag whose source is merely re-registered, which `TreeBody` does on a rebind — a change to what a live component does. A registry beside `PendingPointerDrags`, drained from `Component.destructor`, would put a `DragManager` concern into `core/`; `onDestroy` is the public hook the lifecycle guide gives for exactly this ("a module outside a component's class hierarchy that attaches state keyed by component identity").

[^body-host]: Reproduced three ways. Content replaced while a maximise glide runs: the glide's last frame calls `resumeLayout()` and `startFadeIn` on the disposed host and throws; `_bodyFadeActive` stays `true` and `_bodyHost` stays stale, so every later state change throws from `endBodyFade`. Content replaced during the fade-out: the same stale cache makes the next change throw. Content replaced with nothing in flight: `setBodyHostDisplayed(false)` hides the disposed component, and the new content stays visible in the minimised strip. The cache is written in three places and never cleared. Dropping the cache altogether was considered; `findBodyHost` is a walk over the window's children on each call, and the stale test costs two field reads.

[^menu-timer]: Reproduced: `mouseover` on an item with a submenu, `Menu.close()` within 150 ms, and the timer still calls `handleItemOpenSubmenu`, which builds a submenu panel, sets `_openSubmenuPanel` and marks the item expanded on a menu that is detached. `Menu.clearItemHighlights` documents the missing `mouseout`: "the browser fires no `mouseout` for an element removed under a stationary pointer". The earlier sweep listed this site as undecided because the item is not disposed when its menu closes; the item's own `destructor` does clear the timer.

[^test-dom-gap]: `RecordingDOMSink.addListener` and `removeListener` index their target handle without resolving it, so they accept a released one. `ProductionDOMSink.removeListener` ([DOM.ts:2350](packages/lib/src/typescript/lib/core/DOM.ts#L2350)) resolves the handle and throws. The resize path (P1) does throw offline, because `getElementRect` resolves in both.
