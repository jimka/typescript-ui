# Animation Timer Cancellation — Implementation Plan

## Overview

`Animation.play` and `Animation.afterTransition` each arm a fallback `setTimeout` that runs the completion work when `transitionend` never arrives. Neither timer is ever cancelled. When the element the animation targets is torn down first, the timer still fires and writes to a DOM handle that no longer resolves, so [`HandleRegistry.resolve`](packages/lib/src/typescript/lib/core/DOM.ts#L226) throws `DOM handle N is not registered`.

Two changes fix this together. First, the `setTimeout` / `clearTimeout` pair joins the `DOMSink` seam alongside the `requestAnimationFrame` / `cancelAnimationFrame` pair it already owns ([core/DOM.ts:683-690](packages/lib/src/typescript/lib/core/DOM.ts#L683)), both `Animation` fallbacks route through it, and `DOM.reset()` cancels whatever is still armed. Second, `play`, `afterTransition`, and `materialize` each return a cancel handle in the shape [`Animation.tween`](packages/lib/src/typescript/lib/core/Animation.ts#L295) already returns, and every owner cancels its animation from `destructor()` (or, for a layout manager, `detach()`).

The fix touches the seam ([core/DOM.ts](packages/lib/src/typescript/lib/core/DOM.ts), [tests/dom/TestDOM.ts](packages/lib/tests/dom/TestDOM.ts)), the animation helpers ([core/Animation.ts](packages/lib/src/typescript/lib/core/Animation.ts), [core/AnimatedDropdown.ts](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts), [layout/CollapseSupport.ts](packages/lib/src/typescript/lib/layout/CollapseSupport.ts)), and every class that owns an animation — enumerated in full in the [ownership table](#animation-ownership-table).

The visible symptom today is a red `npm test`: the full suite reports between 0 and 30 unhandled errors while every test passes, because each test file's teardown calls `DOM.reset()` and whichever fallback timers happen to be armed at that moment fire against the rebuilt registry.[^not-test-only]

---

## Architecture Decisions

### Timers join the `DOMSink` seam

`DOMSink` gains `setTimeout`, `clearTimeout`, and `clearAllTimeouts`. This mirrors the `requestAnimationFrame` / `cancelAnimationFrame` pair the sink already owns — the established precedent for a scheduling global that the seam wraps so tests can drive or suppress it ([core/DOM.ts:683-690](packages/lib/src/typescript/lib/core/DOM.ts#L683), [ProductionDOMSink:1548-1555](packages/lib/src/typescript/lib/core/DOM.ts#L1548)).[^seam-scope]

### Both sinks track their outstanding timer ids

`ProductionDOMSink` and the test `RecordingDOMSink` each hold a `Set` of live timer ids; `clearAllTimeouts()` clears every one. `DOM.reset()` calls `DOM.sink.clearAllTimeouts()` **before** it swaps in fresh seams. Replacing the sink instance on its own does not disarm anything, because the timer lives in the host's scheduler, not on the sink object.[^reset-must-cancel]

### One handle type for all four helpers

`Animation.TweenHandle` is renamed `Animation.CancelHandle` and becomes the return type of `play`, `afterTransition`, `tween`, and `materialize`. A single module-level `NOOP_HANDLE` constant serves every early-return path (reduced motion, no element).[^one-handle]

### `cancel()` never touches the element

Cancelling clears the fallback timer, cancels a pending animation frame, and flips a flag so the completion callback becomes a no-op. It performs no DOM write and does not remove the `transitionend` listener. That makes `cancel()` safe to call at any point in a teardown, including after the element's handle has already been released.[^cancel-touches-nothing]

### Each owner holds one field per call site, cancelled in its existing teardown hook

Every `Animation.play` / `afterTransition` call site gets a named `CancelHandle | null` field on its owning class, cancelled in that class's `destructor()` — the documented dispose override hook ([core/Component.ts:726](packages/lib/src/typescript/lib/core/Component.ts#L726)) — before `super.destructor()` runs. A layout manager has no `destructor()`; its teardown hook is `detach()`, which `Component.destructor()` calls ([core/Component.ts:762-765](packages/lib/src/typescript/lib/core/Component.ts#L762)). The full owner table is in [Internal Structure](#animation-ownership-table).[^field-per-site]

The precedent this mirrors is [`MenuItem.destructor`](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L437) and [`StatusBar.destructor`](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L323), which already clear a pending `setTimeout` field before deferring to `super.destructor()`.

### Free functions return their handle to the caller

`fadeShow`, `fadeHideAndDetach`, `Animation.materialize`, and `CollapseSupport.primeCollapse` are module-level functions with no instance to hang a field on, so each returns its `CancelHandle` and the caller stores it. For `primeCollapse` the caller is `runCollapse`, which already returns a canceller its two managers store and re-submit ([layout/CollapseSupport.ts:318-359](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L318)) — the two `primeCollapse` handles fold into that existing canceller rather than adding a second channel.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/core/DOM.ts

/** A timer id as returned by the host's `setTimeout`. */
export type TimerId = ReturnType<typeof setTimeout>;

export interface DOMSink {
    // …existing members unchanged…

    /** Schedules `callback` after `delayMs`. Returns the id for `clearTimeout`. */
    setTimeout(callback: () => void, delayMs: number): TimerId;

    /** Cancels a timer scheduled by `setTimeout`. */
    clearTimeout(id: TimerId): void;

    /** Cancels every timer this sink scheduled that has not yet fired. */
    clearAllTimeouts(): void;
}
```

```typescript
// packages/lib/src/typescript/lib/core/Animation.ts

export namespace Animation {
    /**
     * Handle returned by every animation helper. `cancel()` stops the
     * animation mid-flight and suppresses its completion callback;
     * it is idempotent and a no-op once the animation has completed.
     */
    export interface CancelHandle {
        cancel(): void;
    }

    export function play(el: Handle, config: PlayConfig): CancelHandle;
    export function afterTransition(config: AfterTransitionConfig): CancelHandle;
    export function tween<T extends { [K in keyof T]: number }>(config: TweenConfig<T>): CancelHandle;
    export function materialize(config: MaterializeConfig): CancelHandle;
}
```

```typescript
// packages/lib/src/typescript/lib/core/AnimatedDropdown.ts
export function fadeShow(component: Component, options?: FadeOptions): Animation.CancelHandle;
export function fadeHideAndDetach(component: Component, options?: FadeOptions): Animation.CancelHandle;
```

```typescript
// packages/lib/src/typescript/lib/layout/CollapseSupport.ts (module-private)
function primeCollapse(
    animating: Component,
    properties: string[],
    participants: Component[],
    completionProperty?: string,
): Animation.CancelHandle;
```

`Animation.TweenHandle` is removed. Its single consumer is [`AbstractWindow.ts:239`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L239).

---

## Internal Structure

### `Animation.play`

```typescript
const NOOP_HANDLE: CancelHandle = { cancel: (): void => {} };

export function play(el: Handle, config: PlayConfig): CancelHandle {
    const easing   = config.easing ?? "ease-out";
    const fallback = config.fallbackBufferMs ?? 40;

    const buf = new InlineStyle();
    buf.attach(el);

    if (isReducedMotion()) {
        buf.setMany(config.to as Record<string, string | null>);
        config.onComplete?.();

        return NOOP_HANDLE;
    }

    let done      = false;
    let cancelled = false;
    let frameId: number  | null = null;
    let timerId: TimerId | null = null;

    const finish = (): void => {
        if (done || cancelled) {
            return;
        }

        done = true;

        // transitionend won the race: disarm the fallback so it never runs
        // against an element that may be gone by then.
        if (timerId !== null) {
            DOM.sink.clearTimeout(timerId);
            timerId = null;
        }

        buf.set("transition", null);
        config.onComplete?.();
    };

    const applyTransitionAndTo = (): void => {
        frameId = null;

        if (cancelled) {
            return;
        }

        // …unchanged transition + `to` writes…

        DOM.sink.addListener(el, "transitionend", finish, { once: true });
        timerId = DOM.sink.setTimeout(finish, config.durationMs + fallback);
    };

    if (config.from) {
        buf.setMany(config.from as Record<string, string | null>);
        frameId = DOM.sink.requestAnimationFrame(() => {
            frameId = DOM.sink.requestAnimationFrame(applyTransitionAndTo);
        });
    } else {
        applyTransitionAndTo();
    }

    return {
        cancel: (): void => {
            if (done || cancelled) {
                return;
            }

            cancelled = true;

            if (frameId !== null) {
                DOM.sink.cancelAnimationFrame(frameId);
                frameId = null;
            }

            if (timerId !== null) {
                DOM.sink.clearTimeout(timerId);
                timerId = null;
            }
        },
    };
}
```

`afterTransition` takes the same shape: `done` / `cancelled` / `timerId`, `finish` clears the timer before removing the `transitionend` listener and calling `onComplete`, and `cancel()` only clears the timer and sets `cancelled`. Its no-element early return (`config.onComplete(); return NOOP_HANDLE;`) keeps today's behaviour.

### `Animation.materialize`

```typescript
export function materialize(config: MaterializeConfig): CancelHandle {
    // …host / factory / spinner / fadeMs and dropSpinner unchanged…

    let cancelled = false;
    let fade: CancelHandle | null = null;

    const attach = (component: Component): void => {
        // The owner was torn down while the factory was in flight. Its own
        // teardown already disposed the spinner (a registered child), so touch
        // nothing on the host — just discard the built component.
        if (cancelled) {
            component.dispose();

            return;
        }

        if (config.isStale?.()) {
            dropSpinner();
            component.dispose();

            return;
        }

        // …unchanged addComponent + scheduleLayout…

        fade = play(el, { /* …unchanged… */ });
    };

    const fail = (error: unknown): void => {
        if (cancelled) {
            return;
        }

        // …unchanged dropSpinner + isStale + onError…
    };

    // …unchanged addComponent(spinner) + scheduleLayout…

    DOM.sink.requestAnimationFrame(() => {
        DOM.sink.requestAnimationFrame(() => {
            if (cancelled) {
                return;
            }

            // …unchanged factory invocation and attach/fail dispatch…
        });
    });

    return {
        cancel: (): void => {
            cancelled = true;
            fade?.cancel();
        },
    };
}
```

### `ProductionDOMSink` timer bookkeeping

```typescript
private readonly _timers = new Set<TimerId>();

/** @inheritDoc */
setTimeout(callback: () => void, delayMs: number): TimerId {
    const id = setTimeout(() => {
        this._timers.delete(id);
        callback();
    }, delayMs);

    this._timers.add(id);

    return id;
}

/** @inheritDoc */
clearTimeout(id: TimerId): void {
    this._timers.delete(id);
    clearTimeout(id);
}

/** @inheritDoc */
clearAllTimeouts(): void {
    for (const id of this._timers) {
        clearTimeout(id);
    }

    this._timers.clear();
}
```

`RecordingDOMSink` gets the identical three methods plus its `record('setTimeout')` / `record('clearTimeout')` / `record('clearAllTimeouts')` calls, so `vi.useFakeTimers()` and `vi.spyOn(DOM.sink, 'setTimeout')` both keep working offline.[^recording-delegates]

### Animation ownership table

Every row: the call site, the field that holds its handle, and the method that cancels it. A cancel call always precedes `super.destructor()` / `super.detach()`.

| Call site | Field | Cancelled in |
|---|---|---|
| `AnimatedDropdown.showAnimated` — [AnimatedDropdown.ts:242](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L242) | `_showAnimation` | new `AnimatedDropdown.destructor()` |
| `AnimatedDropdown.hideAnimated` — [:285](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L285) | `_hideAnimation` | same |
| `fadeShow` — [:511](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L511) | returned to caller | caller (below) |
| `fadeHideAndDetach` — [:554](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L554) | returned to caller | caller (below) |
| `Popover.show` — [Popover.ts:486](packages/lib/src/typescript/lib/overlay/Popover.ts#L486) | `_fadeShowAnimation` | existing `Popover.destructor()` ([:598](packages/lib/src/typescript/lib/overlay/Popover.ts#L598)) |
| `Popover.hide` — [:511](packages/lib/src/typescript/lib/overlay/Popover.ts#L511) | `_fadeHideAnimation` | same |
| `Menu` fade in — [Menu.ts:641](packages/lib/src/typescript/lib/overlay/Menu.ts#L641) | `_fadeShowAnimation` | new `Menu.destructor()` |
| `Menu` fade out — [:650](packages/lib/src/typescript/lib/overlay/Menu.ts#L650) | `_fadeHideAnimation` | same |
| `Animation.materialize` internal fade — [Animation.ts:459](packages/lib/src/typescript/lib/core/Animation.ts#L459) | returned to caller | caller (below) |
| `Tab.materializeAsync` — [Tab.ts:1552](packages/lib/src/typescript/lib/layout/Tab.ts#L1552) | `materializeAnimation` on `ContentEntry` | `Tab.detach()` ([:944](packages/lib/src/typescript/lib/layout/Tab.ts#L944)) |
| `Tab` tab-switch fade — [:1824](packages/lib/src/typescript/lib/layout/Tab.ts#L1824) | `_tabFadeAnimation` | `Tab.detach()` |
| `AbstractWindow.show` — [AbstractWindow.ts:620](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L620) | `_showAnimation` | existing `destructor()` ([:879](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L879)) |
| `AbstractWindow` content materialize — [:635](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L635) | `_materializeAnimation` | same |
| `AbstractWindow` close — [:863](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L863) | `_closeAnimation` | same |
| `AbstractWindow.animateRailCollapse` — [:2053](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2053) | `_railCollapseAnimation` | same |
| `AbstractWindow.animateRailExpand` — [:2074](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L2074) | `_railExpandAnimation` | same |
| `Dialog.animateIn` panel — [Dialog.ts:839](packages/lib/src/typescript/lib/overlay/Dialog.ts#L839) | `_panelInAnimation` | new `Dialog.destructor()` |
| `Dialog.animateIn` backdrop — [:847](packages/lib/src/typescript/lib/overlay/Dialog.ts#L847) | `_backdropInAnimation` | same |
| `Dialog` close panel — [:1118](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1118) | `_panelOutAnimation` | same |
| `Dialog` close backdrop — [:1126](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1126) | `_backdropOutAnimation` | same |
| `Rail` collapse/expand — [Rail.ts:669](packages/lib/src/typescript/lib/overlay/Rail.ts#L669) | `_collapseAnimation` | new `Rail.destructor()` |
| `Rail` unmount slide-out — [:836](packages/lib/src/typescript/lib/overlay/Rail.ts#L836) | `_slideOutAnimation` | same |
| `Rail.animateIn` — [:856](packages/lib/src/typescript/lib/overlay/Rail.ts#L856) | `_slideInAnimation` | same |
| `Drawer.animateIn` — [Drawer.ts:528](packages/lib/src/typescript/lib/overlay/Drawer.ts#L528) | `_panelInAnimation` | new `Drawer.destructor()` |
| `Drawer.animateOutAndFinalize` — [:562](packages/lib/src/typescript/lib/overlay/Drawer.ts#L562) | `_panelOutAnimation` | same |
| `Drawer.openBackdrop` — [:586](packages/lib/src/typescript/lib/overlay/Drawer.ts#L586) | `_backdropInAnimation` | same |
| `Drawer.fadeBackdropOut` — [:605](packages/lib/src/typescript/lib/overlay/Drawer.ts#L605) | `_backdropOutAnimation` | same |
| `Notification.animateIn` — [Notification.ts:310](packages/lib/src/typescript/lib/overlay/Notification.ts#L310) | `_showAnimation` | new `Notification.destructor()` |
| `Notification.dismiss` — [:556](packages/lib/src/typescript/lib/overlay/Notification.ts#L556) | `_dismissAnimation` | same |
| `Tooltip.show` — [Tooltip.ts:298](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L298) | `_showAnimation` (instance field, written through `inst`) | new `Tooltip.destructor()` |
| `Tooltip.hide` — [:334](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L334) | `_hideAnimation` (same) | same |
| `Accordion` shrink reflow — [Accordion.ts:1630](packages/lib/src/typescript/lib/layout/Accordion.ts#L1630) | `_shrinkAnimations: Map<number, CancelHandle>`, keyed by the loop's section index `i` | `Accordion.detach()` ([:1123](packages/lib/src/typescript/lib/layout/Accordion.ts#L1123)) |
| `Accordion.primeWrapper` — [:2636](packages/lib/src/typescript/lib/layout/Accordion.ts#L2636) | `_wrapperAnimations: Map<number, CancelHandle>`, keyed by `index` | same |
| `CollapseSupport.primeCollapse` — [CollapseSupport.ts:71](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L71) | returned to `runCollapse`, folded into its canceller | `Split.detach()` / `Border.detach()` via `_collapseAnimation` |
| `CodeEditor.flashReadOnly` — [CodeEditor.ts:679](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L679) | `_flashAnimation` | existing `destructor()` ([:459](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L459)) |

Two rows need a note beyond the table. `Tab`'s per-entry handle also gets cancelled wherever an entry leaves `_contents` (tab close), not only at `detach()`, because closing one tab disposes that tab's component while the manager lives on. `Split` and `Border` already store `runCollapse`'s canceller in `_collapseAnimation` and already invoke it on a re-toggle; the new work is calling it from their `detach()` overrides ([Split.ts:1028](packages/lib/src/typescript/lib/layout/Split.ts#L1028), [Border.ts:1109](packages/lib/src/typescript/lib/layout/Border.ts#L1109)).

---

## Ordered Implementation Steps

Steps 1-9 are the mechanism. Steps 10-22 wire owners and are independent of one another. Steps 23-26 verify.

1. **`core/DOM.ts`** — add `export type TimerId = ReturnType<typeof setTimeout>;` next to the `Handle` type alias.
2. **`core/DOM.ts`** — add `setTimeout`, `clearTimeout`, `clearAllTimeouts` to the `DOMSink` interface ([:465](packages/lib/src/typescript/lib/core/DOM.ts#L465)), immediately after `cancelAnimationFrame` ([:690](packages/lib/src/typescript/lib/core/DOM.ts#L690)), with the JSDoc from `## Public API`.
3. **`core/DOM.ts`** — implement all three on `ProductionDOMSink` after `cancelAnimationFrame` ([:1553](packages/lib/src/typescript/lib/core/DOM.ts#L1553)), with the `_timers` set from `## Internal Structure`.
4. **`core/DOM.ts`** — in `DOM.reset()` ([:2165](packages/lib/src/typescript/lib/core/DOM.ts#L2165)), call `DOM.sink.clearAllTimeouts()` as the **first** statement, before `_registry` and the seams are rebuilt. Add a comment saying why: a pending timer fires against whatever registry is current when it runs.
5. **`core/index.ts`** — add `TimerId` to the `export type { … } from '~/core/DOM.js'` list ([:14](packages/lib/src/typescript/lib/core/index.ts#L14)).
6. **`tests/dom/TestDOM.ts`** — add the same three methods to `RecordingDOMSink` after `cancelAnimationFrame` ([:545](packages/lib/tests/dom/TestDOM.ts#L545)), delegating to the global timer functions and recording each op. Check: `npm run typecheck` is clean (the interface additions would otherwise fail here).
7. **`core/Animation.ts`** — rename `TweenHandle` to `CancelHandle`, widen its doc comment to cover all four helpers, and add the module-level `NOOP_HANDLE` constant. Point `tween`'s reduced-motion branch ([:300](packages/lib/src/typescript/lib/core/Animation.ts#L300)) at `NOOP_HANDLE`. Check: `grep -rn 'TweenHandle' packages/lib/src` — expect one match, `AbstractWindow.ts:239`.
8. **`overlay/AbstractWindow.ts:239`** — retype `_stateAnimHandle` to `Animation.CancelHandle | null`. Check: `grep -rn 'TweenHandle' packages/lib/src` — expect zero matches.
9. **`core/Animation.ts`** — rework `play`, `afterTransition`, and `materialize` per `## Internal Structure`. All three now return `CancelHandle`; the two fallback timers route through `DOM.sink.setTimeout` / `DOM.sink.clearTimeout`. Check: `grep -n 'setTimeout' packages/lib/src/typescript/lib/core/Animation.ts` — every match is `DOM.sink.setTimeout` or `DOM.sink.clearTimeout`.
10. **`core/AnimatedDropdown.ts`** — return the `play` handle from `fadeShow` and `fadeHideAndDetach`; add `_showAnimation` / `_hideAnimation` fields to the `AnimatedDropdown` class and a `destructor()` override that cancels both then calls `super.destructor()`.
11. **`overlay/Popover.ts`** — store the `fadeShow` / `fadeHideAndDetach` handles in `_fadeShowAnimation` / `_fadeHideAnimation`; cancel both at the top of the existing `destructor()`.
12. **`overlay/Menu.ts`** — same two fields; add a `destructor()` override that cancels them and calls `super.destructor()`.
13. **`overlay/AbstractWindow.ts`** — add the five fields from the ownership table; cancel all five at the top of the existing `destructor()`.
14. **`overlay/Dialog.ts`** — add the four fields; add a `destructor()` override on the `Dialog` class ([:527](packages/lib/src/typescript/lib/overlay/Dialog.ts#L527)) cancelling them.
15. **`overlay/Rail.ts`** — add the three fields; add a `destructor()` override.
16. **`overlay/Drawer.ts`** — add the four fields; add a `destructor()` override.
17. **`overlay/Notification.ts`** — add the two fields; add a `destructor()` override.
18. **`overlay/Tooltip.ts`** — add the two instance fields, assigned through the `inst` local in the static `show` / `hide` methods; add a `destructor()` override.
19. **`component/editor/CodeEditor.ts`** — add `_flashAnimation`; cancel it at the top of the existing `destructor()`.
20. **`layout/Tab.ts`** — add `materializeAnimation: Animation.CancelHandle | null` to `ContentEntry` ([:233](packages/lib/src/typescript/lib/layout/Tab.ts#L233)) and initialise it to `null` at both entry-creation sites ([:1357](packages/lib/src/typescript/lib/layout/Tab.ts#L1357), [:1430](packages/lib/src/typescript/lib/layout/Tab.ts#L1430)); add `_tabFadeAnimation`; cancel the fade plus every entry's handle in `detach()`, and cancel the entry's handle wherever an entry is dropped from `_contents`.
21. **`layout/Accordion.ts`** — add the two `Map<number, CancelHandle>` fields; store each handle under its section index; in `detach()` cancel every entry in both maps and clear them.
22. **`layout/CollapseSupport.ts`, `layout/Split.ts`, `layout/Border.ts`** — return the handle from `primeCollapse`; in `runCollapse`, collect the two handles and cancel them from the canceller it returns; call `this._collapseAnimation?.()` from `Split.detach()` and `Border.detach()` and null the field.
23. Check: `grep -rn 'Animation.play(\|Animation.afterTransition(\|Animation.materialize(' packages/lib/src/typescript/lib` — every match's result is assigned to a field, returned, or stored in a map. The match set must line up one-for-one with the ownership table above; re-count from the grep rather than trusting any number quoted here, and stop and report if a site appears that the table does not list.
24. Write the tests in `packages/lib/tests/core/Animation.test.ts` covering the offline-testable rows of `## Expected Behaviour`.
25. `npm run typecheck` — clean.
26. `npm test` from the repo root, **three times**. Each run must report `Errors 0` with every test passing.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/core/index.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Animation.ts` |
| Modify | `packages/lib/src/typescript/lib/core/AnimatedDropdown.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Drawer.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Notification.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Popover.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Rail.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Tooltip.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/CollapseSupport.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Border.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |
| Modify | `packages/lib/docs/concepts/component-lifecycle.md` |
| Create | `packages/lib/tests/core/Animation.test.ts` |

---

## Expected Behaviour

Offline-testable rows use the modelled DOM harness. Because `RecordingDOMSink.requestAnimationFrame` discards its callback, a test that exercises a `play({ from: … })` path must spy on `DOM.sink.requestAnimationFrame` and drive the queue by hand, the way [`AfterNextLayout.test.ts:35-54`](packages/lib/tests/core/AfterNextLayout.test.ts#L35) already does; the fallback timer is driven with `vi.useFakeTimers()` plus `vi.advanceTimersByTime`, as [`ComponentDispose.test.ts:245`](packages/lib/tests/core/ComponentDispose.test.ts#L245) already does.

| # | Case | Expected | Testable |
|---|---|---|---|
| 1 | `play` without `from`, then `transitionend` fires | `onComplete` runs once; the fallback timer is cleared (a later `advanceTimersByTime` produces no second call) | Offline |
| 2 | `play` without `from`, no `transitionend`, timer elapses | `onComplete` runs once; the `transitionend` listener is left attached but inert | Offline |
| 3 | `play(...).cancel()` before the timer elapses | `onComplete` never runs; no `apply` write for `transition: null` appears in `sink.writes` after the cancel; advancing timers changes nothing | Offline |
| 4 | `play(...).cancel()` after `onComplete` has run | No-op, no throw, `onComplete` call count stays 1 | Offline |
| 5 | `play(...).cancel()` twice | Second call is a no-op; no `clearTimeout` recorded the second time | Offline |
| 6 | `play` under `prefers-reduced-motion: reduce` | `to` styles applied synchronously, `onComplete` fires on the same tick, the returned handle's `cancel()` is a safe no-op | Offline (set `themeVars` / `matchMedia` in the harness config) |
| 7 | `play` with `from`, cancelled during the two-frame yield | The queued frame is cancelled, `applyTransitionAndTo` never runs, no transition is written, no timer is armed | Offline |
| 8 | `afterTransition`, `transitionend` for the filtered property fires | `onComplete` runs once, the listener is removed, the fallback timer is cleared | Offline |
| 9 | `afterTransition`, fallback timer wins | `onComplete` runs once **and** `removeListener` is recorded for `transitionend` | Offline |
| 10 | `afterTransition(...).cancel()` before either wins | `onComplete` never runs; no `removeListener` is recorded | Offline |
| 11 | `afterTransition` on a component with no element | `onComplete` fires synchronously; the returned handle cancels harmlessly | Offline |
| 12 | `DOM.reset()` with a sink timer outstanding | The timer never fires: arm one via `DOM.sink.setTimeout`, call `DOM.reset()`, advance timers, assert the callback was not invoked | Offline |
| 13 | `Dialog` disposed while its entrance animation is in flight | No `DOM handle … is not registered` error; `onComplete` never runs | Offline (construct, `show()`, `dispose()`, advance timers) |
| 14 | `materialize(...).cancel()` while the factory promise is pending | Resolving the promise attaches nothing, disposes the built component, and touches no method on the host | Offline |
| 15 | Every animation that runs to completion normally | Identical timing and identical DOM writes to before this change | Manual — open the demo app and exercise a dialog, a drawer, a notification, a tooltip, a dropdown, a tab switch, an accordion toggle, and a window minimise/restore |
| 16 | A window closed mid-entrance-fade in a real browser | The window disappears with no console error | Manual — `transitionend` never fires in the offline harness, so only a live browser exercises the transitionend-wins path against a real element |

---

## Verification

1. `npm run typecheck` — clean.
2. `npm test` from the repo root, run **three consecutive times**. Each run: every test passes **and** the summary reports `Errors 0`. One green run proves nothing here — whether a fallback timer lands before or after a file's `DOM.reset()` depends on machine load, which is why the current failure count swings between 0 and 30 across runs on identical code.
3. `grep -rn 'TweenHandle' packages/lib/src packages/lib/docs` — zero matches.
4. `grep -n 'setTimeout\|clearTimeout' packages/lib/src/typescript/lib/core/Animation.ts` — every match is a `DOM.sink.` call.
5. `npm run docs:build` — finishes with zero warnings (public JSDoc changed on `Animation`).
6. Manual smoke test in the demo app (`npm run dev`, http://localhost:8015): rows 15 and 16 of `## Expected Behaviour`. Watch the console for `DOM handle` errors while opening and closing dialogs, drawers, windows, and menus quickly.

---

## Documentation Impact

- `Animation` is exported from the `core` entry point ([core/index.ts:8](packages/lib/src/typescript/lib/core/index.ts#L8)); `TimerId` joins the type export on [line 14](packages/lib/src/typescript/lib/core/index.ts#L14). The renamed `CancelHandle` and the new return types are picked up by TypeDoc from the source JSDoc — no catalog entry to add, since `Animation` has no hand-written doc page.
- [`docs/concepts/dom-seams.md:63`](packages/lib/docs/concepts/dom-seams.md#L63) lists the globals that route through the seam. Add `setTimeout` / `clearTimeout` beside `requestAnimationFrame` in that list.
- [`docs/concepts/component-lifecycle.md:127`](packages/lib/docs/concepts/component-lifecycle.md#L127) describes what `destructor()` is for ("Clean up listeners, timers, theme subscriptions"). Extend it to name in-flight animations.
- Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), public JSDoc must not `{@link}` internal symbols. `CancelHandle`, `play`, `afterTransition`, `tween`, and `materialize` are all exported, so cross-links between them are fine; do not link `NOOP_HANDLE`.

---

## Potential Challenges

- **`cancel()` running inside its own `onComplete`.** `AbstractWindow`'s close animation calls `this.destructor()` from its completion callback, which cancels `_closeAnimation` — the handle that is mid-`finish`. The `done` flag is set before `onComplete` runs, so `cancel()` sees `done === true` and no-ops.
- **Ordering inside a `destructor()` override.** Cancel before `super.destructor()`. After the base runs, the element handle is released; a cancel that touched the DOM would then throw — which is exactly why `cancel()` touches nothing (see `## Architecture Decisions`).
- **`RecordingDOMSink.writes` gains new entries.** Every test that inspects `writes` filters by `op`, so recording `setTimeout` is safe; if a new assertion counts raw entries, filter it.
- **`Menu` is never disposed today.** No owner calls `dispose()` on `Table._columnContextMenu` or `TabBar._contextMenu`, so `Menu.destructor()` is currently unreachable. Add it anyway — the seam is right, and `DOM.reset()`'s sweep covers the test-side symptom meanwhile.
- **`Tooltip` is a page-lifetime singleton.** Its `destructor()` is likewise dormant in production. The fields still belong on the instance rather than the class, so a future teardown path works without restructuring.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Animation.ts`](packages/lib/src/typescript/lib/core/Animation.ts) — the two uncancelled timers, and `tween` (lines 295-344) as the handle-shape precedent.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — `HandleRegistry.resolve` (226) for the throw contract, the `DOMSink` rAF pair (683-690, 1548-1555) as the seam precedent, `DOM.reset()` (2165).
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `dispose()` / `destructor()` (709-806) and how `_themeCleanups` / `_ownedHandles` are released.
- [`packages/lib/src/typescript/lib/component/container/MenuItem.ts:437`](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L437) and [`StatusBar.ts:323`](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L323) — the "clear a pending timer in `destructor()`" precedent this plan mirrors.
- [`packages/lib/src/typescript/lib/layout/CollapseSupport.ts:234-359`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L234) — `animateLayout` / `runCollapse`, the existing returned-canceller plumbing.
- [`packages/lib/tests/dom/TestDOM.ts:312`](packages/lib/tests/dom/TestDOM.ts#L312) — `RecordingDOMSink`, which must implement every new `DOMSink` member.
- [`packages/lib/tests/setup/node-setup.ts:45-49`](packages/lib/tests/setup/node-setup.ts#L45) — the global `afterEach(DOM.reset)` that triggers the failure.
- [`packages/lib/tests/core/AfterNextLayout.test.ts:29-54`](packages/lib/tests/core/AfterNextLayout.test.ts#L29) — how to drive a seam-scheduled callback deterministically offline.

---

## Non-Goals

- **Asserting in test teardown that no sink timer remains armed.** It would turn this bug class deterministic, but many tests legitimately end with an animation still in flight on a component nobody disposed, so the assertion would fail for benign reasons across the suite. Revisit only after every such test disposes its fixtures.
- **Routing the eleven other raw `setTimeout` call sites through the seam.** `AutoRepeat`, `Tooltip.showTimer`, `StatusBar`, `MenuItem`, `DockRegion`, `TabBar`, `Notification._dismissTimer`, `AutoCompleteField`, `AbstractCalendarDropdown`, and `Header` keep their direct calls. Each already clears its own timer in a `destructor()` or an equivalent, and none writes through a released handle.
- **Cancelling `Notification._dismissTimer` in a destructor.** Same bug class, different timer; `dismiss()` clears it on the normal path. Out of scope here.
- **Making `Menu` reachable from an owner's teardown.** `TabBar.destructor` and `Table` still leave their context menus undisposed; fixing that is a separate change.
- **Adding a liveness predicate to the sink.** Rejected — see `## Notes`.

---

## Notes

[^not-test-only]: The same throw is reachable in production, not only under the test harness. Disposing a component mid-animation releases its element handle while the fallback timer is still pending, and the timer then resolves a dead handle. The test suite just makes it frequent and visible: `DOM.reset()` rebuilds the whole registry at once, so every outstanding handle dies together. Three runs on `96556f40^1` (the pre-merge parent) produced 21, 18, and 0 errors, so this is long-standing rather than a regression from the teardown-seam merge. Vitest attributes each error to whichever file happened to be running when the timer fired, which is why innocent files like `tests/overlay/Menu.test.ts` get blamed.

[^seam-scope]: Only `Animation`'s two fallback timers move onto the seam. Eleven other modules call `setTimeout` directly, and raw timer use is not banned by the `local/no-raw-dom` rule — the point here is not seam purity but that `DOM.reset()` needs a way to disarm the timers that write through released handles, and those are exactly `Animation`'s two.

[^reset-must-cancel]: A `setTimeout` registered with the host scheduler keeps its own reference to the callback; the sink object it was created through is irrelevant once the call returns. The callback closes over `finish`, which reads the *current* `DOM.sink` at fire time — so after `DOM.reset()` it writes through the freshly built `ProductionDOMSink` against a registry that has never seen its handle. Swapping the sink instance therefore disarms nothing, and both sinks need the id bookkeeping. Because `clearAllTimeouts` is on the `DOMSink` interface, the compiler forces every test sink to provide it.

[^one-handle]: Three parallel handle types would be three names for one contract. `TweenHandle` is renamed rather than kept as an alias: it is exported public API, but the library is pre-1.0 and has exactly one consumer (`AbstractWindow.ts:239`), with no references in `docs/`, the demo app, or the create-app template. Keeping a deprecated alias would leave two names for one interface with nothing gained.

[^cancel-touches-nothing]: The alternative — having `cancel()` remove the `transitionend` listener — reintroduces the bug it fixes, since a cancel arriving after the handle is released would throw inside `removeListener`. Leaving the listener attached costs nothing: it is registered `once` in `play`, the element is being removed anyway, and `finish` early-returns on the `cancelled` flag so the handler is inert if it ever does fire. A rejected third option was a `sink.isRegistered(handle)` liveness guard that would let `finish` skip its writes silently. It was rejected because it weakens the deliberate contract documented on `HandleRegistry.resolve` — a use-after-free should be a loud failure, not the silent no-op a stale element pointer would give — and because it would break `play`'s documented "always fires exactly once" guarantee for `onComplete`.

[^field-per-site]: One field per call site rather than one shared bag per class, or a `trackAnimation()` helper on `Component`. A per-class bag has to prune completed handles or it grows without bound on a long-lived component that animates repeatedly, and a `Component`-level bag could not serve `Tab`, `Accordion`, `Split`, or `Border` at all, since a `LayoutManager` is not a `Component`. Named fields are bounded by the number of call sites, are greppable, and say which animation is which at the cancel site. The cost is verbosity — `AbstractWindow` carries five fields, `Dialog` and `Drawer` four each.

[^recording-delegates]: `RecordingDOMSink.requestAnimationFrame` discards its callback and returns `0`, but `setTimeout` must **not** follow that part of the pattern: [`ComponentDispose.test.ts:245`](packages/lib/tests/core/ComponentDispose.test.ts#L245) drives `play`'s fallback with `vi.advanceTimersByTime(300)` to prove the materialize spinner gets disposed. Delegating to the global keeps that test working unchanged, keeps `vi.useFakeTimers()` effective, and leaves `DOM.reset()`'s sweep — not a swallowed callback — as the thing that fixes the flake.

---

## Implementation Notes

Two deviations from the plan as written, both surfaced by the post-implementation audit.

**`runCollapse` returns a two-channel handle, not one folded canceller.** The plan
said the two `primeCollapse` handles should "fold into that existing canceller
rather than adding a second channel" (`## Architecture Decisions`, *Free functions
return their handle to the caller*). That is wrong on the re-toggle path.
`runCollapse` invokes the previous canceller as `previous?.()` before priming the
new toggle, so folding made a second toggle cancel the *first* toggled
component's `afterTransition` — and that callback is the only thing that clears
its `transition` and `will-change`. The result was a stale `clip-path` transition
and a permanent compositor layer on the previously toggled pane: a regression
against `master`, where the primed transitions always ran to completion. The plan
considered only the teardown use of the canceller, not the re-toggle use.

The fix keeps the two intents separate. `runCollapse` now returns a
`CollapseHandle` with `cancelLayout()` (geometry only — what a re-toggle wants)
and `cancelAll()` (everything, including the primed transitions — what teardown
wants). `Split` and `Border` hold a `CollapseHandle` instead of a `() => void` and
call `cancelAll()` from `detach()`.

**The `CollapseHandle` two-channel split was itself replaced.** The first attempt
at the fix above returned a handle with `cancelLayout()` and `cancelAll()`. A
second audit pass showed that still leaked: the manager nulls its canceller when
the *geometry* animation settles, ~40 ms before the primed transitions' fallbacks
disarm, and a re-toggle replaces the handle outright while the previous toggle's
transitions may still be running — both strand a live handle no `detach()` can
reach. `runCollapse` therefore went back to returning a plain `() => void`
(as on `master`) and now takes the manager's `pending` list of primed transitions,
which each entry removes itself from on completion. `Split` and `Border` hold that
list in `_pendingCollapseTransitions` and cancel exactly the live entries on
`detach()`.

**Every handle assignment cancels the outgoing handle first.** The plan's
ownership table gives each call site one field but never says what happens when a
site fires twice inside one animation duration. Assigning over a live handle
orphans it, which reintroduces exactly the uncancellable fallback timer this plan
exists to remove — a rapid re-toggle of one `Accordion` section, or a fast tab
switch, was enough. Each assignment is now preceded by a cancel of the outgoing
handle, matching the precedent already in `AbstractWindow.setWindowState`, which
cancels and nulls `_stateAnimHandle` before installing the next tween.

That blanket guard was wrong in one place, and the second audit pass caught it:
`Accordion.primeWrapper` incremented `_toggleAnimations` *before* cancelling, and
the matching decrement lived only in the cancelled animation's `onComplete`. A
re-toggle inside the animation duration therefore lost a decrement permanently,
so the counter never returned to zero and `setSectionTransitions(false)` was
unreachable for the rest of the manager's life — a regression against `master`.
A replacement animation now inherits the outgoing one's slot in the counter
rather than adding a second, completed animations delete themselves from both
maps so a `get` only ever returns a live handle, and `Accordion.detach()` runs the
toggle-cleanup work the animations it cancels would have run. The general lesson,
which cost two audit cycles: cancelling a handle suppresses its completion
callback, so any cleanup that callback uniquely owns must be re-homed at the
cancel site.

**Cancelling a closing animation drops the teardown its callback owned.** The
same lesson, found a third time and this time across five classes. A dismiss
animation's `onComplete` is often the *only* place a component leaves the layer
tree, tears down a privately-held backdrop, drops out of a static list, or
settles the promise its `show()` handed the caller — none of which
`super.destructor()`'s child recursion reaches. Cancelling it on dispose
therefore lost that work silently. `AnimatedDropdown`, `Dialog`, `Drawer` and
`Notification` now re-home their callback's bookkeeping into `destructor()`;
`Dialog` needs a `_finalizing` guard because its `finalize` calls `destructor()`
partway through and resolves the caller's real result afterwards. `Menu`,
`Popover` and `AbstractWindow` needed nothing — each already unregisters its
layer before starting the fade. `Split` and `Border` got the layout-manager
version: `detach()` *settles* the primed transitions (running their cleanup) when
the container still has children — the manager-swap path — and merely cancels
them when it does not, which is the dispose path, where every participant has
already been destroyed and touching one would write through a released handle.

The rule applies to the *geometry* canceller too, not only the primed
transitions: `Border`'s `onIdle` is the sole place `_collapsing` is cleared, so
cancelling it on a manager-swap detach left a re-attached `Border` taking the
unframed / `clearClipFrame` branch for every region permanently. `Border.detach()`
now clears the flag itself. `Split` needed no equivalent because its `onIdle`
only nulls the field that `detach()` already nulls by hand — an asymmetry worth
remembering, since it is what made the `Border` case easy to miss.

Two new test files pin this: `tests/component/layout/CollapseAnimationTeardown.test.ts`
(six cases) and the teardown block in `tests/core/Animation.test.ts`. Each was
checked to fail when its corresponding fix is reverted.

**The manual verification in `## Verification` step 6 was NOT run.** Rows 15-16 of
`## Expected Behaviour` — the demo-app smoke test of the normal-completion path
and the `transitionend`-wins path — remain outstanding. The offline harness cannot
reach either (`transitionend` never fires under the modelled sink), so the
normal-completion path after `finish` was hoisted out of `applyTransitionAndTo`
has no automated coverage. This is recorded rather than quietly skipped; the smoke
test is the one piece of the plan's verification still owed.
