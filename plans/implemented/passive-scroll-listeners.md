# Passive Listener Support for Scroll/Touch Events

## Context

The library's [Event.ts](src/typescript/lib/core/Event.ts) namespace routes all component DOM events through two window-level capture handlers — `baseListener` for exact/subtree targeting and `baseViewportListener` for unfiltered global delivery. Both are installed with the third argument set to `true` (capture phase only).

In Chromium and Safari, scroll/touch event listeners registered as `passive: true` allow the compositor thread to keep scrolling without waiting for the JS handler to return. A non-passive listener forces the browser to wait for `event.preventDefault()` to be a possibility, which can stall scroll inertia by tens of milliseconds per event when the main thread is busy. The library's virtualized scroll surfaces (Table body and Tree) and the header-sync scroll in [Table.ts:129](src/typescript/lib/component/table/Table.ts#L129) run on the main thread, so this is a real cost for the `Event.ts` route.

Switching the window-level handlers to passive for `scroll`, `wheel`, `touchstart`, and `touchmove` is a small, mechanical change that lets the compositor run scroll/touch work off the main thread for events routed through `Event.ts`. The constraint is that no handler registered through `Event.addListener` / `Event.addSubtreeListener` / `Event.addViewportListener` for those types may call `event.preventDefault()` — doing so logs a console warning and is silently ignored.

The desired outcome is smoother scroll/touch performance with no behavioral change for any current caller.

---

## Audit findings

### Window-level installation sites in [Event.ts](src/typescript/lib/core/Event.ts)

| Site | Line | Pair removeEventListener |
| --- | --- | --- |
| `baseListener` install (in `addListener`) | [Event.ts:145](src/typescript/lib/core/Event.ts#L145) | [Event.ts:201](src/typescript/lib/core/Event.ts#L201) |
| `baseListener` install (in `addSubtreeListener`) | [Event.ts:230](src/typescript/lib/core/Event.ts#L230) | [Event.ts:281](src/typescript/lib/core/Event.ts#L281) |
| `baseViewportListener` install (in `addViewportListener`) | [Event.ts:307](src/typescript/lib/core/Event.ts#L307) | [Event.ts:357](src/typescript/lib/core/Event.ts#L357) |

`baseListener` and `baseViewportListener` themselves never call `preventDefault()`.

### Caller audit (scroll/wheel/touch routed through Event.ts)

`grep -rn "addListener\|addViewportListener\|addSubtreeListener" src/typescript --include="*.ts"` filtered to scroll/wheel/touch types:

| Listener | Site | Calls `preventDefault()`? |
| --- | --- | --- |
| scroll | [Table.ts:129](src/typescript/lib/component/table/Table.ts#L129) | No — sets header transform only |
| touchmove (viewport) | [SplitGutter.ts:143](src/typescript/lib/component/container/SplitGutter.ts#L143) → `onDrag` | No — reads `movementX`/`movementY`, fires drag listeners |
| touchmove (viewport) | [WindowBorder.ts:142](src/typescript/lib/component/container/WindowBorder.ts#L142) → `fireDragListener` | No — fires drag listeners only |
| touchend / touchcancel (viewport) | [SplitGutter.ts:140-141](src/typescript/lib/component/container/SplitGutter.ts#L140-L141), [WindowBorder.ts:139-140](src/typescript/lib/component/container/WindowBorder.ts#L139-L140) | No — drag-stop bookkeeping |

No `wheel`, `touchstart`, or `mousewheel` listeners are registered through `Event.ts` anywhere in the codebase. All `preventDefault()` calls on the `Event.ts` route are in keyboard, click, and dragstart handlers — none are in a scroll/wheel/touch path that would route through `baseListener` or `baseViewportListener`.

### Out-of-scope: VirtualScroller's local listeners

[VirtualScroller.ts](src/typescript/lib/component/container/VirtualScroller.ts) — the abstraction used by `Body` and `Tree` for virtualized scrolling — bypasses `Event.ts` entirely and calls `element.addEventListener` directly on its own DOM element:

- `wheel` ([VirtualScroller.ts:79](src/typescript/lib/component/container/VirtualScroller.ts#L79)) is explicitly registered with `{ passive: false }` because the handler calls `e.preventDefault()` at [VirtualScroller.ts:244](src/typescript/lib/component/container/VirtualScroller.ts#L244) to trap wheel events for JS-controlled scrolling.
- `touchstart` / `touchmove` / `touchend` / `touchcancel` ([VirtualScroller.ts:281-392](src/typescript/lib/component/container/VirtualScroller.ts#L281-L392)) are registered with no options (browser default — non-passive on legacy types, passive on `touchstart`/`touchmove` per the modern intervention).

These listeners are on a local element, not the window, and do not pass through `baseListener` / `baseViewportListener`. They are unaffected by this change.

Conclusion: switching `scroll`/`wheel`/`touchstart`/`touchmove` to passive on the `Event.ts` window-level handlers is safe for the current codebase.

---

## Implementation

### [src/typescript/lib/core/Event.ts](src/typescript/lib/core/Event.ts)

Add a module-level constant just below the existing maps (around [Event.ts:20](src/typescript/lib/core/Event.ts#L20)):

```
const PASSIVE_TYPES: Set<string> = new Set(["scroll", "wheel", "touchstart", "touchmove"]);

function captureOpts(type: string): AddEventListenerOptions {
    return { capture: true, passive: PASSIVE_TYPES.has(type) };
}
```

Replace the six `window.addEventListener(type, ..., true)` / `window.removeEventListener(type, ..., true)` call sites listed above with `captureOpts(type)` as the third argument:

- [Event.ts:145](src/typescript/lib/core/Event.ts#L145): `window.addEventListener(type, baseListener, captureOpts(type));`
- [Event.ts:201](src/typescript/lib/core/Event.ts#L201): `window.removeEventListener(type, baseListener, captureOpts(type));`
- [Event.ts:230](src/typescript/lib/core/Event.ts#L230): `window.addEventListener(type, baseListener, captureOpts(type));`
- [Event.ts:281](src/typescript/lib/core/Event.ts#L281): `window.removeEventListener(type, baseListener, captureOpts(type));`
- [Event.ts:307](src/typescript/lib/core/Event.ts#L307): `window.addEventListener(type, baseViewportListener, captureOpts(type));`
- [Event.ts:357](src/typescript/lib/core/Event.ts#L357): `window.removeEventListener(type, baseViewportListener, captureOpts(type));`

Browsers only match `removeEventListener` against the `capture` flag (the `passive` flag is ignored at removal time), but using the same `captureOpts(type)` call in both places keeps the code symmetric and prevents a future regression if the helper grows.

`addViewportResizeListener` ([Event.ts:367](src/typescript/lib/core/Event.ts#L367)) installs a separate `'resize'` listener and is unaffected — `resize` is not in `PASSIVE_TYPES`.

---

## Critical files to modify

- [src/typescript/lib/core/Event.ts](src/typescript/lib/core/Event.ts) — add `PASSIVE_TYPES` + `captureOpts`, swap the six `true` arguments.

No other files change. The API surface is unchanged.

## Existing primitives to reuse

- The `installedListenerTypes` set ([Event.ts:20](src/typescript/lib/core/Event.ts#L20)) — install/remove bookkeeping is unchanged; only the third-argument shape moves.
- DOM `AddEventListenerOptions` — standard, supported in every browser the library targets.

---

## Risks

- **Future caller calls `preventDefault()` on a passive event.** The browser logs `[Intervention] Unable to preventDefault inside passive event listener` and ignores the call. No silent breakage today (audit above confirms zero such callers on the `Event.ts` route), but if a future feature needs preventDefault on `wheel`/`touchmove` through `Event.addListener` / `Event.addViewportListener`, the caller must know to use a non-passive handler (the VirtualScroller pattern — direct `element.addEventListener` with `{ passive: false }` — is the existing precedent). Mitigation: the audit doc above lists the affected types; this file lives next to the source for future reference.
- **Older browsers** (pre-Chrome 51, pre-Safari 10) treat the third argument as a boolean and ignore the options object's `passive` flag. They fall back to non-passive capture — same behavior as today, no regression.
- **Symmetry concern**: `removeEventListener` only matches on the `capture` flag, so passing the full `captureOpts(type)` is correct. Mixing `true` on add with `{ capture: true }` on remove (or vice versa) would also match, but using `captureOpts(type)` in both keeps the pair textually identical.

---

## Verification

1. **Type-check**: `npx tsc --noEmit` produces no new errors above the existing baseline.
2. **Build**: `npx vite build` succeeds.
3. **DevTools Performance** (`npm run dev`):
   - Open the ComplexUIPanel virtualized Table; record a Performance trace while flick-scrolling. The Table-level scroll listener at [Table.ts:129](src/typescript/lib/component/table/Table.ts#L129) (header sync) will now run passive — main-thread JS time during scroll inertia drops for that handler. The VirtualScroller's wheel handler remains non-passive (it must, to preventDefault) and is unchanged.
   - Inspect the window-level scroll listener via DevTools Elements > Event Listeners and confirm `passive: true`.
4. **Demo-panel sweep** in `npm run dev`:
   - **ComplexUIPanel** — fast scroll table vertically and horizontally; rows still render in the right window, header still slides via [Table.ts:129-136](src/typescript/lib/component/table/Table.ts#L129-L136).
   - **Tree panel** — fast scroll, expand/collapse; rows render correctly.
   - **Window dragging via touch** (or DevTools touch emulation) — drag a Window's title bar and resize via [WindowBorder.ts](src/typescript/lib/component/container/WindowBorder.ts) handles; movement still tracks the touch.
   - **SplitGutter** — drag a split divider via touch emulation; resize behavior unchanged.
5. **Console check**: no `[Intervention] Unable to preventDefault inside passive event listener` warnings during the sweep. Such a warning indicates a caller violated the passive contract.
6. Per [CLAUDE.md](CLAUDE.md): run `graphify update . --directed` after the change lands.
