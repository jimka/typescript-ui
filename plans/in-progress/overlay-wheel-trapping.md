# Overlay Wheel Trapping — Implementation Plan

## Overview

A floating overlay that currently cannot scroll lets wheel events fall through to the content behind it: scrolling over the overlay natively scrolls whatever native-scrollable ancestor sits beneath it, with a hard jump rather than the framework's smooth scroll. The fix makes overlays **trap** wheel events that no inner scroller handled, so they never reach the content behind them — while inner scrollable content keeps scrolling smoothly through the existing pipeline.

The root cause lives in the wheel pipeline on `Component`. `attachWheelScrolling` ([Component.ts:3329](../src/typescript/lib/core/Component.ts#L3329)) only registers a non-passive subtree `wheel` listener when an overflow axis is `auto`/`scroll`, so a non-scrollable overlay has **no** wheel listener at all — the native wheel bubbles up the real DOM to a scrollable ancestor behind/under the overlay. Even when a listener exists, `onWheelScroll` ([Component.ts:3383](../src/typescript/lib/core/Component.ts#L3383)) early-returns at `if (dx === 0 && dy === 0) return;` ([Component.ts:3395](../src/typescript/lib/core/Component.ts#L3395)) **without** `e.preventDefault()`, so a wheel over a scrollable-but-at-its-limit axis still leaks to the page.

The framework already has the right seam for the trap: the central [`LayerManager`](../src/typescript/lib/core/LayerManager.ts) registry that every dismissable overlay joins, and the [`consumeWheel`](../src/typescript/lib/core/SmoothScroller.ts#L31) once-marker plus descendant-first `Event.addSubtreeListener` dispatch ([Event.ts:126](../src/typescript/lib/core/Event.ts#L126)) that already lets an inner scroller claim a wheel before an ancestor sees it. The trap is an overlay-level non-passive subtree wheel listener that calls `preventDefault` only when the event reaches it **unconsumed**.

---

## Architecture Decisions

### Mechanism — an overlay-level non-passive subtree wheel listener gated on `consumeWheel`

The overlay registers `Event.addSubtreeListener(this, "wheel", handler, { passive: false })` on its own element. Because subtree dispatch walks **target → root** ([Event.ts:126-140](../src/typescript/lib/core/Event.ts#L126)), any inner `SmoothScroller`-driven container under the pointer fires first and claims the event via `consumeWheel(e)`; the overlay's handler fires last, as the outermost ancestor. The handler does exactly one thing:

```
if (consumeWheel(e)) {   // claim succeeded ⇒ nobody inner handled it
    e.preventDefault();  // trap: stop the native page/ancestor scroll
}
```

If an inner scroller already claimed the wheel, `consumeWheel` returns `false` and the overlay does nothing — inner scroll proceeds untouched, exactly as today. If nothing inner handled it, the overlay claims and `preventDefault()`s, so the native event never reaches a scrollable ancestor behind the overlay. This reuses the existing once-marker contract verbatim (project memory: *"nested JS wheel/scroll handlers need a consume-once marker (consumeWheel)"*) and adds no second easing path — the overlay never scrolls anything, it only swallows the leftover wheel.

The listener must be `{ passive: false }` to match the only existing `wheel` registration (`attachWheelScrolling` registers `wheel` with `passive: false`); `Event.addSubtreeListener` throws if a later registration for an already-registered type disagrees on `passive` ([Event.ts:215-217](../src/typescript/lib/core/Event.ts#L215)). `passive: false` is consistent and is required anyway so `preventDefault()` takes effect.

**Rejected — a backdrop/scrim element that catches events.** Only modal overlays (`Dialog`, modal `Drawer`) own a scrim; non-modal windows, popovers, and dropdowns do not, and adding one purely to catch wheel would change hit-testing, focus, and visual layering for the whole overlay family. The wheel that leaks is the one over the overlay *itself*, not the gap around it, so a scrim solves the wrong region. Rejected.

**Rejected — fixing it only inside `Component.onWheelScroll`** (e.g. always `preventDefault` on the `dx===0 && dy===0` return). That helps only overlays that already have a scroll listener (a scrollable axis at its limit) and does nothing for the common case — a non-scrollable overlay that never attaches a wheel listener at all. It would also change wheel behaviour for *every* scrollable component (a list scrolled to its end would start trapping page scroll), a broad regression well outside the overlay scope. The plan does **not** touch `onWheelScroll`.

### Scope — trap on `AbstractWindow`, `Dialog`, `Popover`, `Drawer`; not on `Tooltip` / `Notification`

The overlays split cleanly into two groups by how they mount and whether they own pointer interaction:

- **Trapping overlays** — `AbstractWindow` (and thus `Window` / `TabWindow`), `Dialog`, `Popover`, `Drawer`. These are the surfaces a user actively interacts with that float over scrollable content. All four already implement `DismissableLayer` and call `LayerManager.register(this)` from their show path, so they share one join point. A modal `Dialog` *definitely* must trap (the whole point of modality is that content behind it is inert); a floating `Window` must trap per the reported bug. `Popover` and `Drawer` are the same class of floating interactive surface and get it for consistency.
- **Non-trapping overlays** — `Tooltip` and `Notification`. `Tooltip` sets `pointer-events: none` ([Tooltip.ts:107](../src/typescript/lib/overlay/Tooltip.ts#L107)) so a wheel passes straight through it to the content below — which is correct; a tooltip must never eat a scroll. `Notification` is a transient toast the user does not scroll over intentionally. Neither registers with `LayerManager`, so neither is in scope, and trapping them would be a regression (a tooltip hovering over a scrollable list would freeze that list's scroll).

The dropdown family (`AnimatedDropdown` and its pickers) also registers with `LayerManager`. Dropdowns that need to scroll already attach their own scroller (e.g. `Menu` via `setOverflowY("auto")`), and a short dropdown over scrollable content arguably should not freeze the page. They are **out of scope** (see `## Non-Goals`) — the reported bug is about windows, and widening to dropdowns risks the more surprising regression. The mechanism is built so it *could* be opted into later without rework.

### Home for the shared behaviour — a small helper invoked from each overlay's show/hide, not a new base class

`AbstractWindow`, `Dialog`, `Popover`, and `Drawer` do **not** share a common concrete base (they extend `Container`, `Component`, `Container`, `Component` respectively) — only the `DismissableLayer` *interface*. A new shared base class is therefore impossible without a large refactor, and `DismissableLayer` is an interface (no implementation body). The minimal, surgical home is a tiny pair of free functions in a new module under `core/` — `trapWheel(component)` / `untrapWheel(component)` — that wrap the `Event.addSubtreeListener` / `removeSubtreeListener` calls and the gated `preventDefault`. Each of the four overlays calls `trapWheel(this)` from its show path and `untrapWheel(this)` from its hide/teardown path. This keeps the consume-once logic in exactly one place (no four copies), respects the one-element-per-class rule (it adds no DOM, only a listener), and avoids touching the class hierarchy.

The handler reference must be stable per component (so `removeSubtreeListener` matches), so the helper stores the bound handler on a `WeakMap<Component, (e: WheelEvent) => void>` keyed by the component — mirroring how `LayerManager` keys per-layer state with a `WeakMap`. No new field is added to any overlay class.

**Rejected — centralising the listener inside `LayerManager.register`/`unregister`.** Tempting because all four overlays already route through it, but `LayerManager` deliberately owns *dismissal and z-order*, never per-layer DOM listeners on the layer's own element (its only listeners are the module-global document-level handlers on a sentinel owner). Putting a per-layer subtree wheel listener there would also force the dropdown family into the trap (they register too), contradicting the scope decision, and would entangle two unrelated concerns. A standalone helper called explicitly from the four in-scope overlays keeps the scope precise. Rejected.

### No new option / flag

The trap is unconditional for the in-scope overlays — there is no requested configurability, and adding a `trapWheel?: boolean` option would be speculative (CLAUDE.md §2). No `XOptions` field, no setter, no `_defaultOptions` entry — so the "class-level defaults must survive the getter" invariant ([ARCHITECTURE.md:197](../ARCHITECTURE.md#L197)) is not engaged. If configurability is ever needed, it would be added then, folding the default in the getter per that invariant.

---

## Public API (TypeScript Signatures)

New module `src/typescript/lib/core/WheelTrap.ts`:

```typescript
/**
 * Registers a non-passive subtree wheel listener on `component` that
 * preventDefault()s any wheel the event reaches it unconsumed — trapping
 * wheels an inner scroller did not claim so they cannot fall through to
 * content behind a floating overlay. Idempotent per component.
 */
export function trapWheel(component: Component): void;

/**
 * Removes the trap installed by {@link trapWheel}. Safe to call when none
 * was installed.
 */
export function untrapWheel(component: Component): void;
```

Both are internal framework plumbing called from overlay show/hide paths; neither is exported from a public barrel (see `## Documentation Impact`).

---

## Internal Structure

`WheelTrap.ts` holds a module-private `WeakMap<Component, (e: WheelEvent) => void>` so each component's bound handler is stable for removal:

```typescript
const _handlerByComponent = new WeakMap<Component, (e: WheelEvent) => void>();

export function trapWheel(component: Component): void {
    if (_handlerByComponent.has(component)) {
        return;                                   // idempotent — show may run twice
    }
    const handler = (e: WheelEvent): void => {
        if (consumeWheel(e)) {                    // unclaimed ⇒ no inner scroller took it
            e.preventDefault();                   // swallow; do not reach ancestor scroll
        }
    };
    _handlerByComponent.set(component, handler);
    Event.addSubtreeListener(component, "wheel", handler, { passive: false });
}

export function untrapWheel(component: Component): void {
    const handler = _handlerByComponent.get(component);
    if (!handler) {
        return;
    }
    _handlerByComponent.delete(component);
    Event.removeSubtreeListener(component, "wheel", handler);
}
```

Call-site wiring per overlay:

- **`AbstractWindow`** — `trapWheel(this)` in `show()` (after the element exists, alongside `LayerManager.register(this)` at [AbstractWindow.ts:600](../src/typescript/lib/overlay/AbstractWindow.ts#L600)); `untrapWheel(this)` in `onExitAction()` near the `LayerManager.unregister(this)` at [AbstractWindow.ts:838](../src/typescript/lib/overlay/AbstractWindow.ts#L838). Covers `Window` and `TabWindow` for free.
- **`Dialog`** — `trapWheel(this)` by its `LayerManager.register(this)` ([Dialog.ts:635](../src/typescript/lib/overlay/Dialog.ts#L635)); `untrapWheel(this)` in its hide/close teardown beside `LayerManager.unregister`.
- **`Popover`** — `trapWheel(this)` in `show()` by `LayerManager.register(this)` ([Popover.ts:465](../src/typescript/lib/overlay/Popover.ts#L465)); `untrapWheel(this)` in `hide()` beside its unregister.
- **`Drawer`** — `trapWheel(this)` in `open()` by `LayerManager.register(this)` ([Drawer.ts:336](../src/typescript/lib/overlay/Drawer.ts#L336)); `untrapWheel(this)` in `close()` beside its unregister.

The trap is installed only after the element is in the DOM, since `addSubtreeListener` resolves the component's element. The exact teardown method per class is verified by the implementer against the `LayerManager.unregister(this)` call site already present in each.

---

## Ordered Implementation Steps

1. **Create `src/typescript/lib/core/WheelTrap.ts`** with `trapWheel` / `untrapWheel` as above, importing `Component`, `Event`, and `consumeWheel` from `~/core/SmoothScroller.js`. Full JSDoc per `CODE_CONVENTIONS.md`.
2. **`AbstractWindow.ts`** — import `trapWheel` / `untrapWheel`; call `trapWheel(this)` in `show()` (after `getElement(true)`), `untrapWheel(this)` in `onExitAction()` beside the existing `LayerManager.unregister(this)`.
3. **`Dialog.ts`** — same wiring at its register/unregister sites.
4. **`Popover.ts`** — same wiring in `show()` / `hide()`.
5. **`Drawer.ts`** — same wiring in `open()` / `close()`.
6. **Regression grep** — `grep -rn "consumeWheel" src/typescript/lib/` should now show `SmoothScroller.ts` (definition), `Component.ts` (existing inner scroller), and `WheelTrap.ts` (new) — confirming a single shared marker, no fork.
7. **Typecheck** — `npm run build` (or the project's typecheck script) passes with zero errors.
8. **Manual smoke test** per `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/core/WheelTrap.ts` |
| Modify | `src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `src/typescript/lib/overlay/Dialog.ts` |
| Modify | `src/typescript/lib/overlay/Popover.ts` |
| Modify | `src/typescript/lib/overlay/Drawer.ts` |

---

## Expected Behaviour

Wheel delivery and native scroll are **not exercisable by the offline recording DOM sink** — it delivers no events to listeners and models no real native scroll offset. The behaviours below are therefore mostly **manual-verify**; the few structural facts that the offline harness *can* assert are marked.

1. **Trap on a non-scrollable overlay.** Open a `Window` whose body content fits (no scrollbar) over a tall, native-scrollable page region. Wheeling over the window does **not** scroll the page behind it; the page stays put. — *Manual.*

2. **Inner scroll still works.** Open a `Window` whose body content overflows (a tall table/list, e.g. one of MiscPanel's table windows). Wheeling over the window smoothly scrolls the window's inner content via the existing `SmoothScroller`, and the page behind does **not** move. — *Manual.*

3. **Inner scroll at its limit does not leak.** With an inner scrollable window scrolled fully to the bottom, continued wheeling does **not** start scrolling the page behind. — *Manual.* (The inner scroller claims the wheel via `consumeWheel` regardless of whether it can move further on that axis; the overlay handler then sees it consumed.)

4. **No double-handling.** Wheeling over inner scrollable content scrolls it by the normal amount — not double — i.e. the overlay handler never also scrolls. — *Manual.* (Structurally guaranteed: the overlay handler only `preventDefault`s, it never drives a scroller.)

5. **Modal `Dialog`.** Wheeling anywhere over an open modal `Dialog` never scrolls content behind it. — *Manual.*

6. **`Popover` / `Drawer`.** Wheeling over an open popover or drawer panel does not scroll content behind it; a scrollable drawer/popover body still scrolls. — *Manual.*

7. **`Tooltip` unaffected.** A tooltip shown over a scrollable list does **not** freeze that list — wheeling scrolls the list beneath the (pointer-events:none) tooltip. — *Manual.* (No code change touches Tooltip; this guards the scope boundary.)

8. **Teardown removes the listener.** After a window/dialog/popover/drawer is closed, its wheel trap is gone (no lingering listener). — *Offline-testable:* with the recording sink, assert that `trapWheel(component)` registers exactly one `wheel` subtree listener for the component's id and that `untrapWheel(component)` removes it (inspect `Event`'s subtree registration, or spy on `Event.addSubtreeListener` / `removeSubtreeListener`). Idempotency (`trapWheel` twice registers once) is also offline-testable.

9. **`consumeWheel` gating logic.** Offline-testable in isolation: construct a fake `WheelEvent`-like object, call the trap handler directly — first call (`consumeWheel` returns `true`) invokes `preventDefault`; a second call on the *same* event object (already marked) does **not**. This unit-tests the gate without DOM delivery.

---

## Verification

- **Typecheck:** `npm run build` — zero errors.
- **Offline unit tests** (the only automatable parts, per `## Expected Behaviour` 8–9):
  - `trapWheel` registers one non-passive `wheel` subtree listener; `untrapWheel` removes it; `trapWheel` is idempotent.
  - The handler calls `preventDefault` exactly when `consumeWheel` returns `true` for the event, and not when the event is already consumed.
- **Grep invariant:** `grep -rn "consumeWheel" src/typescript/lib/` shows only `SmoothScroller.ts`, `Component.ts`, `WheelTrap.ts` — one shared marker.
- **Manual smoke test** (run `npm run dev`, app on http://localhost:8015 — see project dev URL memory; demo screen is **MiscPanel**, which opens windows via `new Window(...).show()` including a fitting "Hello World!" window and several overflowing table/tree windows):
  1. Scroll MiscPanel itself so there is scrollable content behind a window.
  2. Open "Hello World!" (non-scrollable window) → wheel over it → page behind must not move (was the bug). Confirm motion is *blocked*, not a native jump.
  3. Open a table window (overflowing) → wheel over it → inner content scrolls smoothly; page behind stays put; scroll to the bottom and keep wheeling → page still does not move.
  4. Repeat the over-overlay check for a `Dialog`, a `Popover`, and a `Drawer` if a demo path exists; otherwise note them as covered by the shared helper.
  5. Confirm a `Tooltip` over a scrollable region still lets that region scroll.
- **Theme toggle:** not applicable (no CSS/token change).
- **Docs:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc "unsupported TypeScript version" notice is the lone acceptable warning). No public-API surface is added, so no doc page changes are expected.

---

## Potential Challenges

- **Passive-setting conflict.** `Event` throws if a later `wheel` registration disagrees on `passive` with an existing one; the trap uses `{ passive: false }`, matching `attachWheelScrolling` — mitigated by design, but the implementer must not omit the option (the default for `wheel` may be passive).
- **Install timing.** `addSubtreeListener` resolves the component's element, so `trapWheel` must run only after the overlay is mounted — call it at/after the existing `LayerManager.register(this)` site in each overlay, which is already post-mount.
- **Teardown symmetry.** Each overlay must call `untrapWheel` on every close path (animated close, Escape-driven `requestClose`, programmatic close). Wiring it beside the existing `LayerManager.unregister(this)` — which every close path already reaches — guarantees symmetry; the implementer verifies there is exactly one unregister site per overlay.
- **Offline test reach.** Wheel delivery cannot be driven offline; over-claiming testability would produce green tests that prove nothing. The plan confines automated tests to listener registration and the pure gate logic, and routes behavioural confidence through the manual smoke test.

---

## Critical Files

- [src/typescript/lib/core/SmoothScroller.ts](../src/typescript/lib/core/SmoothScroller.ts) — `consumeWheel` once-marker (the contract the trap reuses) and `SmoothScroller` (the inner-scroll pipeline that must keep working).
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — `onWheelScroll` / `attachWheelScrolling` / `refreshWheelScrolling` (lines 3310–3405): the inner scroller that fires first and claims the wheel. Read to confirm the trap never double-handles.
- [src/typescript/lib/core/Event.ts](../src/typescript/lib/core/Event.ts) — `addSubtreeListener` (target→root dispatch, lines 126–140; passive-conflict throw, lines 215–217).
- [src/typescript/lib/core/LayerManager.ts](../src/typescript/lib/core/LayerManager.ts) — the shared register/unregister sites the trap wiring sits beside; confirms the overlay set in scope.
- [src/typescript/lib/overlay/AbstractWindow.ts](../src/typescript/lib/overlay/AbstractWindow.ts), [Dialog.ts](../src/typescript/lib/overlay/Dialog.ts), [Popover.ts](../src/typescript/lib/overlay/Popover.ts), [Drawer.ts](../src/typescript/lib/overlay/Drawer.ts) — the four call sites.
- [src/typescript/lib/overlay/Tooltip.ts](../src/typescript/lib/overlay/Tooltip.ts) — `pointer-events: none` is why it is correctly excluded.

---

## Non-Goals

- **Dropdowns (`AnimatedDropdown` and pickers).** Out of scope; the reported bug is windows, and trapping short dropdowns over scrollable content risks a more surprising regression. The helper can be opted in later without rework.
- **`Tooltip` / `Notification`.** Intentionally excluded — a tooltip must let wheels pass through (`pointer-events: none`); a notification is a transient toast.
- **Changing `Component.onWheelScroll`.** The `dx===0 && dy===0` early-return is left as-is; altering it would change wheel behaviour for every scrollable component, far outside this scope.
- **A configurable `trapWheel` option/flag.** Not requested; would be speculative.
- **A backdrop/scrim for non-modal overlays.** Rejected mechanism; not added.
