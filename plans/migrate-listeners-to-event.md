# Migrate Direct `addEventListener` / `removeEventListener` Calls Through The `Event` Class — Implementation Plan

## Overview

[ARCHITECTURE.md](../ARCHITECTURE.md), "Event handling", binds every component listener to `Event.addListener(this, type, handler)` / `Event.addViewportListener`. Native `addEventListener` is allowed **only** on raw DOM helper elements that aren't `Component`s. The Event class is defined in [core/Event.ts](../src/typescript/lib/core/Event.ts); it owns a single window-level capture handler per event type and routes by element id (`addListener`), by ancestor chain (`addSubtreeListener`), or unconditionally (`addViewportListener`).

`grep -rn '\.addEventListener(' src/typescript --include="*.ts"` currently returns 23 hits. After excluding the Event-class internals (lines 151, 236, 313, 376 of [Event.ts](../src/typescript/lib/core/Event.ts)) and the three documented raw-DOM cases (Glyph media-query, Animation `transitionend`, Popover ancestor scroll), 14 sites violate the rule:

1. **Component-owned element listeners** (8 sites): [Header.ts:144, 146](../src/typescript/lib/component/table/cell/Header.ts#L144), [Body.ts:428](../src/typescript/lib/component/table/Body.ts#L428), [Notification.ts:172, 173](../src/typescript/lib/core/Notification.ts#L172), [VirtualScroller.ts:79, 281, 294, 384, 392](../src/typescript/lib/component/container/VirtualScroller.ts#L79).
2. **Viewport listeners** (4 sites): [Dialog.ts:528, 529](../src/typescript/lib/core/Dialog.ts#L528), [Window.ts:226](../src/typescript/lib/core/Window.ts#L226), [Popover.ts:870](../src/typescript/lib/core/Popover.ts#L870).
3. **Tooltip's external-element attach** (3 sites): [Tooltip.ts:315, 329, 334](../src/typescript/lib/core/Tooltip.ts#L315). The attached target may or may not be a Component; the docstring at [Tooltip.ts:299-309](../src/typescript/lib/core/Tooltip.ts#L299) already notes the Event system's exact-target-id limitation. Decision (see Architecture Decisions): leave the raw listeners in place — this is the canonical raw-DOM-helper case ARCHITECTURE.md carves out.

The migration also reveals two API gaps in `Event.ts` that block a clean conversion:

- **`Event.addListener` can't pass `{ passive: false }`** — required by `VirtualScroller.onWheel` ([VirtualScroller.ts:243-244](../src/typescript/lib/component/container/VirtualScroller.ts#L243), which calls `preventDefault()` on the wheel event). The central handler in Event.ts hardcodes `passive: PASSIVE_TYPES.has(type)` at [Event.ts:24-26](../src/typescript/lib/core/Event.ts#L24), and `"wheel"` is in `PASSIVE_TYPES`, so wheel listeners can never `preventDefault`. This plan extends `captureOpts` and `addListener`/`addSubtreeListener` to accept an `{ passive?: boolean }` override, plus widens `PASSIVE_TYPES` decision to "default passive, opt out per call".
- **`Event.addViewportListener` doesn't accept a `capture` flag** — [Dialog.ts:528](../src/typescript/lib/core/Dialog.ts#L528) and [Window.ts:226](../src/typescript/lib/core/Window.ts#L226) currently pass `true` as the third arg to register capture-phase document/window listeners. Event.ts's `captureOpts` already returns `{ capture: true, … }` unconditionally at [Event.ts:25](../src/typescript/lib/core/Event.ts#L25), so the **default already matches** what these two call sites want. No API change for the viewport side; the migration drops the explicit `true` and relies on the framework's capture-by-default behaviour. Documented as a Decision so the implementer doesn't accidentally try to add a flag.

---

## Architecture Decisions

### Pick the right Event API per call-site shape

| Call site | API |
|---|---|
| `HeaderCell.init()` — click / contextmenu on the cell's own root element | `Event.addListener(this, type, handler)` — exact-target match against the cell's id is correct because the cell's `Card` layout puts content inside child Components but the root catches bubbled clicks via the window-level capture handler. |
| `Body.growRowPool()` — click on a row element that lives inside Body's DOM tree | `Event.addSubtreeListener(this, "click", …)` on **Body**, not per-row. One subtree listener replaces N per-row listeners and aligns with the memory entry "addListener matches exact target ID only — use addSubtreeListener when catching events from child components." The handler determines which row was clicked by walking up from `event.target` to find the `Row` element. |
| `Notification` mouseover / mouseout — events fire on the toast root and bubble from children | `Event.addSubtreeListener(this, "mouseover" / "mouseout", …)`. The `addListener` exact-id form would miss bubbled events from the badge / label children, exactly the regression the existing memory entry warns about. The two `Notification.acquireHoverHold` / `releaseHoverHold` statics take a `MouseEvent` and already filter via `relatedTarget`; the subtree-listener invocation count is unchanged because the events bubble to the root naturally. |
| `VirtualScroller` wheel + touch — events fire on the owner element | `Event.addListener(this._owner, type, …)` for wheel (exact target — `wheel` doesn't bubble to children we care about) and `Event.addListener(this._owner, …)` for the four touch types. VirtualScroller itself isn't a Component; it holds an `_owner: Component` field at [VirtualScroller.ts:36](../src/typescript/lib/component/container/VirtualScroller.ts#L36) and routes through that. |
| `Dialog` keydown (document) + resize (window) | `Event.addViewportListener(this, type, handler)` on both — fires irrespective of element id. |
| `Window` mousedown (window-wide outside-click) | `Event.addViewportListener` — but the existing handler is a **static** (`Window.deactivateIfOutside`), not per-instance. The static needs a "marker" Component to register against. Use the first open `Window` instance — see "Window's static handler" below. |
| `Popover` resize | `Event.addViewportListener(this, "resize", this._onWindowResize)`. Straightforward per-instance migration. |
| `Tooltip.attachToElement` mouseover / mousemove / mouseout on an external DOM element | **No migration.** This is the canonical raw-DOM-helper case ARCHITECTURE.md exempts. See "Tooltip stays native" below. |

### Extend `Event.addListener` / `addSubtreeListener` with a `passive` opt-out

`VirtualScroller.onWheel` calls `preventDefault()` to suppress native page scroll, which requires the listener be registered with `passive: false`. The central handler at [Event.ts:24-26](../src/typescript/lib/core/Event.ts#L24) currently produces `{ capture: true, passive: PASSIVE_TYPES.has(type) }`, and `"wheel"`/`"touchmove"` are in `PASSIVE_TYPES`. Once the central handler is registered as passive, **no** downstream component can `preventDefault()` on that event type — even with `evt.preventDefault()` the browser will warn and ignore.

Add an `options` bag to the listener-registration APIs:

```typescript
interface ListenerOptions {
    passive?: boolean;  // override the type's PASSIVE_TYPES default
}

export function addListener(
    component: Component,
    type: string,
    listener: Function,
    options?: ListenerOptions
): void;

export function addSubtreeListener(
    component: Component,
    type: string,
    listener: Function,
    options?: ListenerOptions
): void;
```

When `options.passive === false`, register the window-level handler with `{ capture: true, passive: false }` instead of the default. Because the **window handler is per-type**, the first call for a given type wins — the simplest correct contract is: "the first registration for a type sets the passive flag for that type; subsequent calls must agree or throw." `VirtualScroller` is currently the only `passive: false` consumer in the codebase, so the contract is robust in practice.

Implementation shape inside Event.ts:

```typescript
let installedListenerOpts = new Map<string, AddEventListenerOptions>();

function captureOpts(type: string, override?: ListenerOptions): AddEventListenerOptions {
    const passive = override?.passive ?? PASSIVE_TYPES.has(type);
    return { capture: true, passive };
}

export function addListener(component, type, listener, options?) {
    // ... existing checks ...

    if (!installedListenerTypes.has(type)) {
        const opts = captureOpts(type, options);
        installedListenerTypes.add(type);
        installedListenerOpts.set(type, opts);
        window.addEventListener(type, baseListener, opts);
    } else if (options) {
        const prev = installedListenerOpts.get(type)!;
        const next = captureOpts(type, options);

        if (prev.passive !== next.passive || prev.capture !== next.capture) {
            throw new Error(
                "Event listener options for '" + type +
                "' conflict with earlier registration"
            );
        }
    }

    // ... rest unchanged ...
}
```

`removeListener` / `removeSubtreeListener` already pass `captureOpts(type)` to `window.removeEventListener`. After the migration, they should pass the **stored** opts via `installedListenerOpts.get(type)` so removal matches the original registration. (Re-deriving from `captureOpts(type)` after the type's last listener is gone would yield the default, not the override — silent removal failure.)

`addViewportListener` does not need the passive override; none of the four viewport sites in scope `preventDefault` on their handled events.

### `addViewportListener` capture-phase is already the default

`captureOpts` at [Event.ts:25](../src/typescript/lib/core/Event.ts#L25) returns `{ capture: true, passive: PASSIVE_TYPES.has(type) }` — and `addViewportListener` calls it at [Event.ts:313](../src/typescript/lib/core/Event.ts#L313). So Dialog's `keydown` capture (currently `addEventListener('keydown', handler, true)`) and Window's `mousedown` capture (currently `addEventListener('mousedown', handler, true)`) translate directly to `Event.addViewportListener(this, type, handler)` — the framework already installs the underlying listener in capture mode. **Do not add a `capture: boolean` flag to the API.** The migration drops the `true` third-arg and relies on the existing default.

The matching `removeViewportListener` already symmetrically passes `captureOpts(type)` to `removeEventListener` at [Event.ts:363](../src/typescript/lib/core/Event.ts#L363).

### Window's static handler — register against the first open window

[Window.ts:69](../src/typescript/lib/core/Window.ts#L69) defines `deactivateIfOutside` as a **static** arrow function. The current install/uninstall pattern at [Window.ts:225-227](../src/typescript/lib/core/Window.ts#L225) / [Window.ts:351-353](../src/typescript/lib/core/Window.ts#L351) hooks on first-window-open and unhooks on last-window-close.

`Event.addViewportListener` requires a Component instance. Two options:

1. **Register against the opening Window instance.** On each `show()` call, when `Window.openWindows.size === 0`, route through `Event.addViewportListener(this, "mousedown", Window.deactivateIfOutside)`. On the matching `onExitAction`, route `Event.removeViewportListener(this, "mousedown", Window.deactivateIfOutside)`. Issue: if the **first** opened window closes while a later window is still open, the framework drops the listener even though there's another window that needs it.

2. **Register against a sentinel component.** Allocate a single static `Component` instance held by the `Window` namespace as the listener owner. All install/uninstall calls use that sentinel.

Pick option 2. It mirrors the existing install/uninstall lifecycle (tied to `openWindows.size`, not to any particular window) and avoids the listener-leak bug option 1 introduces. The sentinel is a plain `new Component()` allocated once at module load — it never enters the DOM, exists purely as the Event-API key.

```typescript
// Window.ts — module scope
const _viewportListenerOwner = new Component();
```

The install/uninstall code becomes:

```typescript
// show():
if (Window.openWindows.size === 0) {
    Event.addViewportListener(
        _viewportListenerOwner,
        'mousedown',
        Window.deactivateIfOutside
    );
}

// onExitAction():
if (Window.openWindows.size === 0) {
    Event.removeViewportListener(
        _viewportListenerOwner,
        'mousedown',
        Window.deactivateIfOutside
    );
}
```

### Tooltip stays native

`Tooltip.attachToElement` at [Tooltip.ts:310](../src/typescript/lib/core/Tooltip.ts#L310) accepts an arbitrary `HTMLElement`, not a Component. The docstring at [Tooltip.ts:299-309](../src/typescript/lib/core/Tooltip.ts#L299) explicitly justifies its existence as the "raw element" pair to the separate `attach(component, text)` overload — and notes the Event API's exact-target-id limitation. Migrating these three listeners would require either threading a Component handle into every `attachToElement` call site (large blast radius, breaks an external API) or fabricating a sentinel Component per attachment (allocates one per tooltip target, contradicts the "single window-level handler" optimisation the Event class exists to enforce).

ARCHITECTURE.md's wording — "Native `addEventListener` only on raw DOM helper elements that aren't `Component`s" — exempts this case. Flag in Non-Goals; do not migrate.

The other `attach` overload on the Tooltip class (`Tooltip.attach(component: Component, text: string)`, if one exists) is the Component-aware path and already routes correctly. Verify by inspection that no Component-aware Tooltip path uses `addEventListener` directly.

### Body's per-row click listener becomes one subtree listener

Today [Body.ts:428](../src/typescript/lib/component/table/Body.ts#L428) attaches a click listener per pool row inside `growRowPool`. A 500-row table allocates 500 listeners, and the closure captures `row` — preventing the row from being GC'd if the pool ever shrinks.

Replace with a single `Event.addSubtreeListener(this, "click", …)` registered once in `Body.init()`. The handler walks up from `event.target` to find the Row element (matched by checking each ancestor against the pool — `this._rowPool.find(r => r.getElement() === ancestor)`). The replaced lookup is `O(poolSize)` per click, identical complexity to the existing `addEventListener('click', …)` per-row approach (which costs O(N) at pool-growth time and O(1) per click) — but it's a single registration and a single hot-path event lookup through the Event window handler.

The `row` lookup at click time uses the row's DOM element identity. If `Row` exposes its element via `getElement()`, the loop is straightforward; otherwise, set `data-row-index` on the row element at pool growth time and read it back. Choose the simpler path during implementation — prefer matching by `_rowPool` lookup if no new DOM attribute is needed.

### `PASSIVE_TYPES` mental model

The set at [Event.ts:22](../src/typescript/lib/core/Event.ts#L22) (`scroll`, `wheel`, `touchstart`, `touchmove`) reflects the browser default for performance — these event types are passive by default in modern browsers, and that's what the framework should reproduce for the common case. The opt-out parameter is an escape hatch for cases like VirtualScroller's `wheel`-with-`preventDefault`.

After the migration:
- `VirtualScroller` registers `wheel` with `{ passive: false }`.
- `VirtualScroller` registers `touchmove` **without** the override — its touch handlers don't `preventDefault` (verified by reading lines 281-395; only `setScrollY`/`setScrollX` are called, no `preventDefault`).
- `touchstart`, `touchend`, `touchcancel` register without override.

---

## Public API (TypeScript Signatures)

### `Event.addListener` / `Event.addSubtreeListener` — add options bag

```typescript
// src/typescript/lib/core/Event.ts

/**
 * Options that override the default listener-installation behaviour.
 */
export interface ListenerOptions {
    /**
     * Override the type's default passive setting. When `false`, listeners for
     * this type may call `preventDefault()`. Must be consistent across all
     * registrations of the same event type, else `addListener` throws.
     */
    passive?: boolean;
}

export function addListener(
    component: Component,
    type: string,
    listener: Function,
    options?: ListenerOptions
): void;

export function addSubtreeListener(
    component: Component,
    type: string,
    listener: Function,
    options?: ListenerOptions
): void;
```

`removeListener` / `removeSubtreeListener` / `addViewportListener` / `removeViewportListener` signatures are unchanged.

### No other public-API surface change

The 14 migration sites are internal-to-component refactors. No `XOptions` field is added, no Component setter introduced. The only widening is the optional fourth parameter on two Event-namespace functions.

---

## Internal Structure

### Canonical Component-listener migration

```typescript
// Before — Header.ts:144:
el.addEventListener('click', (e: MouseEvent) => this.onSortClick(e.shiftKey));

// After:
Event.addListener(this, 'click', (e: MouseEvent) => this.onSortClick(e.shiftKey));
```

### Canonical viewport-listener migration

```typescript
// Before — Dialog.ts:528-529:
document.addEventListener('keydown', this._boundKeyHandler, true);
window.addEventListener('resize', this._boundResizeHandler);

// After:
Event.addViewportListener(this, 'keydown', this._boundKeyHandler);
Event.addViewportListener(this, 'resize', this._boundResizeHandler);

// Before — Dialog.ts:661-662:
document.removeEventListener('keydown', this._boundKeyHandler, true);
window.removeEventListener('resize', this._boundResizeHandler);

// After:
Event.removeViewportListener(this, 'keydown', this._boundKeyHandler);
Event.removeViewportListener(this, 'resize', this._boundResizeHandler);
```

The `true` third-arg drops because `captureOpts` already returns `{ capture: true, … }`.

### Body per-row click → one subtree listener

```typescript
// Before — Body.ts:428 (inside growRowPool):
rowEl.addEventListener('click', (e: MouseEvent) => this.onRowClick(row, e));

// After — single registration in Body.init():
Event.addSubtreeListener(this, 'click', (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    let node: HTMLElement | null = target;

    while (node) {
        const row = this._rowPool.find(r => r.getElement() === node);
        if (row) {
            this.onRowClick(row, e);
            return;
        }

        node = node.parentElement;
    }
});

// The per-row attach inside growRowPool is removed.
```

### VirtualScroller wheel with passive opt-out

```typescript
// Before — VirtualScroller.ts:79:
element.addEventListener("wheel", (e: WheelEvent) => this.onWheel(e), { passive: false });

// After:
Event.addListener(
    this._owner,
    "wheel",
    (e: WheelEvent) => this.onWheel(e),
    { passive: false }
);
```

The four touch listeners (lines 281, 294, 384, 392) route through `Event.addListener(this._owner, …)` **without** an options bag — they don't `preventDefault`.

### Window's static handler routed through a sentinel

```typescript
// Window.ts — module scope, near other module-level state:
const _viewportListenerOwner = new Component();

// show() — replace line 225-227:
if (Window.openWindows.size === 0) {
    Event.addViewportListener(
        _viewportListenerOwner,
        'mousedown',
        Window.deactivateIfOutside
    );
}

// onExitAction() — replace line 351-353:
if (Window.openWindows.size === 0) {
    Event.removeViewportListener(
        _viewportListenerOwner,
        'mousedown',
        Window.deactivateIfOutside
    );
}
```

### Notification mouseover/mouseout → subtree

```typescript
// Before — Notification.ts:172-173:
const el = this.getElement(true);
el.addEventListener("mouseover", (e: MouseEvent) => Notification.acquireHoverHold(e));
el.addEventListener("mouseout",  (e: MouseEvent) => Notification.releaseHoverHold(e));

// After:
Event.addSubtreeListener(this, "mouseover", (e: MouseEvent) => Notification.acquireHoverHold(e));
Event.addSubtreeListener(this, "mouseout",  (e: MouseEvent) => Notification.releaseHoverHold(e));
// (the `getElement(true)` call is dropped — Event.addSubtreeListener routes by component id.)
```

The two `Notification.acquireHoverHold` / `releaseHoverHold` statics already use `relatedTarget` to filter out intra-element movements, so the same payload semantics survive a subtree listener.

---

## Ordered Implementation Steps

Each step ends with a grep checkpoint targeting just the file(s) it touched, plus the final `npx tsc --noEmit` gate at the end.

1. **Event.ts — extend `captureOpts` + `addListener` + `addSubtreeListener` with the `passive` opt-out.**
   - Add `interface ListenerOptions { passive?: boolean }`.
   - Add a module-level `installedListenerOpts: Map<string, AddEventListenerOptions>`.
   - Widen `captureOpts(type, override?: ListenerOptions)` to honour `override.passive`.
   - Widen `addListener` / `addSubtreeListener` signatures with an optional fourth param `options?: ListenerOptions`.
   - On first registration for a type, store the resolved opts in `installedListenerOpts` and pass them to `window.addEventListener`.
   - On subsequent registrations for the same type, throw if `options` disagrees with the stored opts.
   - Update `removeListener` / `removeSubtreeListener` to read `installedListenerOpts.get(type)` (falling back to `captureOpts(type)` for clean-up after the map entry is gone).
   - **Verify:** `npx tsc --noEmit src/typescript/lib/core/Event.ts` → 0 errors; `grep -n 'ListenerOptions\|installedListenerOpts' src/typescript/lib/core/Event.ts` → ≥ 4 hits.

2. **Header.ts — migrate two listeners.**
   - Replace [line 144](../src/typescript/lib/component/table/cell/Header.ts#L144) `el.addEventListener('click', …)` with `Event.addListener(this, 'click', …)`.
   - Replace [line 146](../src/typescript/lib/component/table/cell/Header.ts#L146) `el.addEventListener('contextmenu', …)` with `Event.addListener(this, 'contextmenu', …)`.
   - **Verify:** `grep -n '\.addEventListener(' src/typescript/lib/component/table/cell/Header.ts` → 0.

3. **Body.ts — replace per-row listener with one subtree listener.**
   - Drop line 428 from inside `growRowPool`.
   - In `Body.init()` (after `super.init(...)`), register `Event.addSubtreeListener(this, 'click', …)` using the lookup body from "Internal Structure" above.
   - **Verify:** `grep -n '\.addEventListener(' src/typescript/lib/component/table/Body.ts` → 0; in the slow-table demo, row click selects and the listener count in DevTools' "Event Listeners" panel for `<body>` doesn't grow with `Show details` row count.

4. **Notification.ts — migrate two listeners to `addSubtreeListener`.**
   - Drop the `const el = this.getElement(true);` cache (no longer needed).
   - Replace lines 172-173 with `Event.addSubtreeListener(this, "mouseover" / "mouseout", …)`.
   - **Verify:** `grep -n '\.addEventListener(' src/typescript/lib/core/Notification.ts` → 0.

5. **VirtualScroller.ts — migrate one wheel listener (passive: false) + four touch listeners.**
   - Replace line 79 `element.addEventListener("wheel", …, { passive: false })` with `Event.addListener(this._owner, "wheel", …, { passive: false })`.
   - Replace lines 281, 294, 384, 392 (touch handlers) with `Event.addListener(this._owner, type, handler)` — no options bag.
   - **Verify:** `grep -n '\.addEventListener(' src/typescript/lib/component/container/VirtualScroller.ts` → 0; in the slow-table demo, mouse-wheel scrolls the table without triggering native page scroll, and touch-scrolling (Chrome DevTools mobile mode) works.

6. **Dialog.ts — migrate two install + two uninstall calls.**
   - Replace lines 528-529 with `Event.addViewportListener(this, …, …)` × 2 (drop the `true` third arg).
   - Replace lines 661-662 with `Event.removeViewportListener(this, …, …)` × 2.
   - **Verify:** `grep -n '\.addEventListener(\|\.removeEventListener(' src/typescript/lib/core/Dialog.ts` → 0.

7. **Window.ts — introduce module-level sentinel + migrate install/uninstall.**
   - Add `const _viewportListenerOwner = new Component();` at module scope (after imports).
   - Replace lines 225-227 (`window.addEventListener('mousedown', Window.deactivateIfOutside, true)`) with `Event.addViewportListener(_viewportListenerOwner, 'mousedown', Window.deactivateIfOutside)`.
   - Replace lines 351-353 with the matching `Event.removeViewportListener(_viewportListenerOwner, …)`.
   - **Verify:** `grep -n '\.addEventListener(\|\.removeEventListener(' src/typescript/lib/core/Window.ts` → 0.

8. **Popover.ts — migrate the window resize listener.**
   - Replace line 870 `window.addEventListener("resize", this._onWindowResize)` with `Event.addViewportListener(this, "resize", this._onWindowResize)`.
   - Replace line 885 `window.removeEventListener("resize", this._onWindowResize)` with `Event.removeViewportListener(this, "resize", this._onWindowResize)`.
   - **Leave** lines 876 + 888 (`ancestor.addEventListener("scroll", …)` / `removeEventListener`) **as is**. These attach to arbitrary scrollable ancestor elements that are not Components — the canonical raw-DOM-helper exception.
   - **Verify:** `grep -nE 'window\.(add|remove)EventListener' src/typescript/lib/core/Popover.ts` → 0; the two `ancestor.addEventListener(... "scroll" ...)` lines remain, and a follow-up grep `grep -n 'ancestor\.addEventListener\|ancestor\.removeEventListener' src/typescript/lib/core/Popover.ts` → 2.

9. **Final grep gate.** `grep -rn '\.addEventListener(' src/typescript --include="*.ts"` should return exactly:
   - 4 Event.ts internals (the central window handler registrations).
   - 3 Tooltip.ts attaches (raw-DOM exemption).
   - 1 Glyph.ts matchMedia change (raw-DOM exemption — `window.matchMedia(...).addEventListener("change", …)`).
   - 2 Animation.ts transitionend (raw-DOM exemption).
   - 1 Popover.ts ancestor scroll (raw-DOM exemption).

   Total: **11 matches**, all documented exemptions. Anything else is a regression.

   Matching `removeEventListener` grep should return:
   - 3 Event.ts internals.
   - 1 Animation.ts transitionend cleanup.
   - 1 Popover.ts ancestor scroll cleanup.

   Total: **5 matches**.

10. **Typecheck.** `npx tsc --noEmit` → 0 errors.

11. **Manual smoke verification.** Open `http://localhost:8015`, exercise:
    - **Header (Header.ts:144, 146):** click any column header sorts; Shift+click multi-sorts; right-click opens the column menu.
    - **Body (Body.ts:428):** click any row in the slow table selects it. Verify with DevTools' Performance panel that the click handler is invoked once per click, not N times where N is pool size.
    - **Notification (Notification.ts:172-173):** trigger a notification (use the demo panel that posts one); hover the toast — its auto-dismiss timer pauses; unhover — it resumes.
    - **VirtualScroller (VirtualScroller.ts:79, 281+):** scroll the slow table with the mouse wheel — the table scrolls; the surrounding page does **not** scroll (this is what `passive: false` + `preventDefault` enables). Touch-scroll in Chrome DevTools' mobile emulation also works.
    - **Dialog (Dialog.ts:528-529):** open any modal dialog (e.g. from the demo). Press Escape — closes. Resize the browser window — dialog re-centers.
    - **Window (Window.ts:226):** open a Window from the demo, then click outside its bounds — the window deactivates (title bar style change). Close all windows, reopen one, then click outside — still deactivates (verifying the static-handler install/uninstall cycle survives the sentinel-component re-wiring).
    - **Popover (Popover.ts:870):** open any Popover (e.g. an Autocomplete dropdown). Resize the browser window — popover repositions relative to its anchor.
    - **Tooltip (Tooltip.ts):** hover a Header cell with a tooltipText; the tooltip appears after 500ms, moves with the cursor, disappears on mouseout. (Tooltip listeners stay raw; this confirms the non-migration is correct.)

12. **`graphify update .`** — refresh the graph; Community 45 (Event API) should gain new in-edges from the migrated call sites. Commit `graphify-out/**` per the implement skill's three-commit structure.

---

## Files to Create / Modify / Delete

| Action | File                                                                |
|--------|---------------------------------------------------------------------|
| Modify | `src/typescript/lib/core/Event.ts` — extend `addListener` / `addSubtreeListener` with `options?: ListenerOptions`; widen `captureOpts`; add `installedListenerOpts` map; update `removeListener` / `removeSubtreeListener` to read from the stored opts. |
| Modify | `src/typescript/lib/component/table/cell/Header.ts` — two listeners. |
| Modify | `src/typescript/lib/component/table/Body.ts` — replace per-row with one subtree listener. |
| Modify | `src/typescript/lib/core/Notification.ts` — two listeners. |
| Modify | `src/typescript/lib/component/container/VirtualScroller.ts` — five listeners (wheel + 4 touch). |
| Modify | `src/typescript/lib/core/Dialog.ts` — two install + two uninstall. |
| Modify | `src/typescript/lib/core/Window.ts` — sentinel component + one install + one uninstall. |
| Modify | `src/typescript/lib/core/Popover.ts` — one install + one uninstall (window resize). Ancestor scroll listeners stay native. |

No files created, no files deleted. No theme tokens. No new public components.

---

## Verification

- `grep -rn '\.addEventListener(' src/typescript --include="*.ts"` → **11 matches** (Event.ts × 4 + Tooltip.ts × 3 + Glyph.ts × 1 + Animation.ts × 2 + Popover.ts × 1 — all documented exemptions).
- `grep -rn '\.removeEventListener(' src/typescript --include="*.ts"` → **5 matches** (Event.ts × 3 + Animation.ts × 1 + Popover.ts × 1).
- `npx tsc --noEmit` → 0 errors.
- `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- Manual smoke per step 11 above in both light and dark themes.
- `graphify update .` succeeds; Community 45 (`addListener()`, `addSubtreeListener()`, `addViewportListener()`, …) gains in-edges from `HeaderCell.init`, `Body.init`, `Notification.constructor`, `VirtualScroller.constructor`, `Dialog.open`/`hide`, `Window.show`/`onExitAction`, `Popover.attachRepositionListeners`/`detachRepositionListeners`.

---

## Documentation Impact

`Event.addListener` and `Event.addSubtreeListener` are public — they gain an optional fourth parameter (`options?: ListenerOptions`) and a new interface (`ListenerOptions`). Both are picked up by typedoc automatically from the JSDoc blocks on each function. Update the JSDoc for both:

- Add a fourth `@param options - Optional override for default registration options.` line on each.
- Note in `@remarks` the per-type passive-opt-out contract: "Once a listener type has been registered with a given `passive` setting, subsequent registrations must use the same setting (`Event.addListener` throws on conflict)."

The `ListenerOptions` interface is exported from `core/Event.ts`; no per-subpath barrel change is needed because `Event` is already re-exported from `src/typescript/lib/core/index.ts` (verify by inspection; if `ListenerOptions` needs to be added to the barrel, do so as part of step 1).

No curated `docs/core/Event.md` page changes are required — typedoc regenerates from source. Verify the regenerated API page lists `ListenerOptions` and the widened `addListener` signature after `docs:build`.

---

## Potential Challenges

- **`Event.addListener`'s per-type passive contract.** The "first registration sets the passive flag" rule means a future contributor who adds a Component-owned `wheel` listener without `{ passive: false }` after `VirtualScroller`'s registration will see an exception at registration time rather than a silent runtime warning. Mitigation: the exception message names the event type and tells them to check the existing registration; that's actionable. Document it in the `addListener` `@remarks`.

- **`Window.deactivateIfOutside` registered against a sentinel.** Since the sentinel is a plain `Component` with no DOM element, calls to `getElement()` on it return `undefined`. `Event.addViewportListener` is targeted-by-id-of-`component.getId()`, but only reads `getId()` (the id is a string allocated at Component construction), so it doesn't care that the element is absent. Verify by reading `Event.addViewportListener` — it indexes by `component.getId()`, not `component.getElement()`. The sentinel's id is unique, never collides.

- **Body subtree listener click on a non-row child** (e.g. a button rendered inside a Cell). The current per-row listener fires the row click for *any* descendant click. The subtree variant preserves that: the loop walks up from `event.target` until it hits a row element, so a click on a Cell's child still maps to the row. Behaviour is identical; flag because the click target may not visually look like a row.

- **Tooltip mousemove on every pointer move.** Lines 329-332 fire on every mouse-move sample over the tooltip-anchored element. After this plan, those stay native. Per-Event-routing overhead is therefore **not** added on this hot path — this is part of the rationale for not migrating Tooltip. Flag because a reader of the diff might be confused that Tooltip is being left out.

- **`Notification.acquireHoverHold` / `releaseHoverHold` signature compatibility with subtree listeners.** Both statics take a `MouseEvent` and use `relatedTarget` to detect entering/leaving the toast as a whole (vs. intra-element bubble noise). `Event.addSubtreeListener` invokes the handler with the original event object, so `relatedTarget` is intact. Verify by reading both methods (around [Notification.ts:200+](../src/typescript/lib/core/Notification.ts)) — no signature change required.

- **VirtualScroller's `_owner` lifecycle.** If the owning Component is destructed while VirtualScroller is still alive, `Event.addListener` registrations keyed against that Component's id leak (the listener map retains the id → CompFunc mapping). Today the native listeners attached to the element die with the element. The migration shifts the cleanup burden onto VirtualScroller — it needs a `destroy()` that calls `Event.removeListener(this._owner, type, handler)` for each registered type. Inspect VirtualScroller's current destruction path; if `destroy()` doesn't exist, add one and route the owner's `destructor()` to call it. (Sibling work — confirm in step 5 whether the existing tests / smoke run leak listeners.)

- **`installedListenerOpts` removal-time lookup race.** `removeListener` reads from the map before deciding whether to call `window.removeEventListener`. If the map entry is gone (only happens when removal already ran for the last remaining listener of that type), fall back to `captureOpts(type)` to derive the same opts that the original `addEventListener` was called with. Both paths must produce identical option objects so `removeEventListener` finds the registration. Mitigation: the stored opts are the canonical source; only delete the map entry **after** `window.removeEventListener` succeeds.

- **`addViewportListener`'s `viewportListenerMap` doesn't know about `installedListenerOpts`.** The viewport API is unchanged in this plan (no passive override needed). But the `viewportListenerMap` and the new `installedListenerOpts` map are kept on different paths; `addViewportListener` continues to call `captureOpts(type)` without a second arg. Don't accidentally widen `addViewportListener` — its callers don't need the option, and adding it would needlessly enlarge the API surface.

---

## Critical Files

- [src/typescript/lib/core/Event.ts](../src/typescript/lib/core/Event.ts) — the API being extended; read `captureOpts` (line 24), `addListener` (line 138), `addSubtreeListener` (line 223), `addViewportListener` (line 302), `removeListener` (line 177), `removeViewportListener` (line 339).
- [ARCHITECTURE.md](../ARCHITECTURE.md), "Event handling" section — the rule this plan implements.
- [src/typescript/lib/component/container/VirtualScroller.ts](../src/typescript/lib/component/container/VirtualScroller.ts) — `_owner` field at line 36; `onWheel` at line 243 calls `preventDefault`.
- [src/typescript/lib/component/table/Body.ts](../src/typescript/lib/component/table/Body.ts) — `growRowPool` at line 403, `_rowPool` field.
- [src/typescript/lib/core/Window.ts](../src/typescript/lib/core/Window.ts) — `deactivateIfOutside` static at line 69; `openWindows` static; the install/uninstall lifecycle at lines 225-227 / 351-353.
- [src/typescript/lib/core/Notification.ts](../src/typescript/lib/core/Notification.ts) — existing `Event.addListener` / `addSubtreeListener` usage at lines 155, 162 (canonical pattern in the same file).
- [src/typescript/lib/core/Tooltip.ts](../src/typescript/lib/core/Tooltip.ts) — `attachToElement` (raw-DOM exemption, line 310) vs `attach` (Component-aware path).

---

## Non-Goals

- **Migrating `Tooltip.attachToElement`.** Documented in "Tooltip stays native" above. The function accepts an arbitrary `HTMLElement`; ARCHITECTURE.md exempts raw-DOM-helper cases.
- **Migrating `Glyph.ts:98` `window.matchMedia(...).addEventListener("change", …)`.** Media-query change events are unique to `MediaQueryList`, not on `window`/`document`/Component elements. Event.ts has no API for them; one would have to be invented (`addMediaQueryListener` or similar), which is outside this plan's scope.
- **Migrating `Animation.ts:125 / 218` `transitionend` listeners.** Animation operates on arbitrary `HTMLElement`s (often non-Component DOM nodes inside other components). Routing through Event would require threading a Component owner into every Animation.play call site — large blast radius for a low-leverage change. Out of scope; flag in Non-Goals so the implementer doesn't widen the migration.
- **Migrating `Popover.ts:876` ancestor scroll listeners.** Scroll ancestors are arbitrary DOM elements collected from the live DOM tree at attach time; they're not Components. Raw-DOM exemption.
- **Removing `Event.addViewportResizeListener`.** [Event.ts:373](../src/typescript/lib/core/Event.ts#L373) is a still-present alternative API that wraps `window.addEventListener('resize', …)` and yields a `{width, height}` object. None of the four viewport sites in scope use it (Dialog and Popover use the more direct `addViewportListener` shape). Whether `addViewportResizeListener` should be removed in favour of `addViewportListener` is a separate API-pruning decision.
- **Adding a `capture: boolean` flag to `addViewportListener`.** Documented in "`addViewportListener` capture-phase is already the default" — the framework already installs in capture mode; no flag needed. Future Dialog / Window-like sites get capture-mode for free.
- **Extending `addViewportListener` with the `passive` opt-out.** None of the four viewport sites in scope `preventDefault` on handled events. Out of scope; add it later if a real need arises.
- **Touching `VirtualScroller`'s lifecycle.** The "VirtualScroller `_owner` lifecycle" challenge above is real but out of scope; the existing native listeners die with the element today, and a clean Component-listener teardown is a separate maintenance pass.
