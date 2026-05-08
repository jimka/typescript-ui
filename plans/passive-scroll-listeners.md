# Passive Listener Support for Scroll/Touch Events

## Context

The library's [Event.ts](src/typescript/Base/Event.ts) namespace routes all component DOM events through two window-level capture handlers — `baseListener` for exact/subtree targeting and `baseViewportListener` for unfiltered global delivery. Both are installed with the third argument set to `true` (capture phase only).

In Chromium and Safari, scroll/touch event listeners registered as `passive: true` allow the compositor thread to keep scrolling without waiting for the JS handler to return. A non-passive listener forces the browser to wait for `event.preventDefault()` to be a possibility, which can stall scroll inertia by tens of milliseconds per event when the main thread is busy. The library's two virtualized scroll surfaces (Table body and Tree) run non-trivial work inside their `scroll` handlers (`renderWindow`, `_renderWindow`), so this is a real cost.

Switching the window-level handlers to passive for `scroll`, `wheel`, `touchstart`, and `touchmove` is a small, mechanical change that lets the compositor run scroll/touch work off the main thread. The constraint is that no handler in those types may call `event.preventDefault()` — doing so logs a console warning and is silently ignored.

The desired outcome is smoother scroll/touch performance with no behavioral change for any current caller.

---

## Audit findings

### Window-level installation sites in [Event.ts](src/typescript/Base/Event.ts)

| Site | Line | Pair removeEventListener |
| --- | --- | --- |
| `baseListener` install (in `addListener`) | [Event.ts:143](src/typescript/Base/Event.ts#L143) | [Event.ts:199](src/typescript/Base/Event.ts#L199) |
| `baseListener` install (in `addSubtreeListener`) | [Event.ts:228](src/typescript/Base/Event.ts#L228) | [Event.ts:279](src/typescript/Base/Event.ts#L279) |
| `baseViewportListener` install (in `addViewportListener`) | [Event.ts:305](src/typescript/Base/Event.ts#L305) | [Event.ts:355](src/typescript/Base/Event.ts#L355) |

`baseListener` and `baseViewportListener` themselves never call `preventDefault()`.

### Caller audit (scroll/wheel/touch)

`grep -rn "addListener.*scroll\|addListener.*wheel\|addListener.*touch\|addSubtreeListener.*scroll\|addViewportListener.*touch" src/typescript --include="*.ts"`:

| Listener | Site | Calls `preventDefault()`? |
| --- | --- | --- |
| scroll | [Body.ts:203-206](src/typescript/Base/component/table/Body.ts#L203-L206) | No — calls `renderWindow()` only |
| scroll | [Tree.ts:604-609](src/typescript/Base/component/tree/Tree.ts#L604-L609) | No — calls `_renderWindow()` only |
| scroll | [Table.ts:99-107](src/typescript/Base/component/table/Table.ts#L99-L107) | No — sets header transform only |
| touchmove (viewport) | [SplitGutter.ts:103](src/typescript/Base/component/SplitGutter.ts#L103) → `onDrag` | No — reads `movementX`/`movementY`, fires drag listeners |
| touchmove (viewport) | [WindowBorder.ts:114](src/typescript/Base/component/WindowBorder.ts#L114) → `fireDragListener` | No — fires drag listeners only |
| touchend / touchcancel (viewport) | [SplitGutter.ts:100-101](src/typescript/Base/component/SplitGutter.ts#L100-L101), [WindowBorder.ts:111-112](src/typescript/Base/component/WindowBorder.ts#L111-L112) | No — drag-stop bookkeeping |

No `wheel`, `touchstart`, or `mousewheel` listeners exist anywhere in the codebase. All `preventDefault()` calls in the project are in keyboard, click, and dragstart handlers — none are in a scroll/wheel/touch path that would route through `baseListener` or `baseViewportListener`.

Conclusion: switching scroll/wheel/touchstart/touchmove to passive is safe for the current codebase.

---

## Implementation

### [src/typescript/Base/Event.ts](src/typescript/Base/Event.ts)

Add a module-level constant just below the existing maps (around [Event.ts:18](src/typescript/Base/Event.ts#L18)):

```
const PASSIVE_TYPES: Set<string> = new Set(["scroll", "wheel", "touchstart", "touchmove"]);

function captureOpts(type: string): AddEventListenerOptions {
    return { capture: true, passive: PASSIVE_TYPES.has(type) };
}
```

Replace the six `window.addEventListener(type, ..., true)` / `window.removeEventListener(type, ..., true)` call sites listed above with `captureOpts(type)` as the third argument:

- [Event.ts:143](src/typescript/Base/Event.ts#L143): `window.addEventListener(type, baseListener, captureOpts(type));`
- [Event.ts:199](src/typescript/Base/Event.ts#L199): `window.removeEventListener(type, baseListener, captureOpts(type));`
- [Event.ts:228](src/typescript/Base/Event.ts#L228): `window.addEventListener(type, baseListener, captureOpts(type));`
- [Event.ts:279](src/typescript/Base/Event.ts#L279): `window.removeEventListener(type, baseListener, captureOpts(type));`
- [Event.ts:305](src/typescript/Base/Event.ts#L305): `window.addEventListener(type, baseViewportListener, captureOpts(type));`
- [Event.ts:355](src/typescript/Base/Event.ts#L355): `window.removeEventListener(type, baseViewportListener, captureOpts(type));`

Browsers only match `removeEventListener` against the `capture` flag (the `passive` flag is ignored at removal time), but using the same `captureOpts(type)` call in both places keeps the code symmetric and prevents a future regression if the helper grows.

`addViewportResizeListener` ([Event.ts:368](src/typescript/Base/Event.ts#L368)) installs a separate `'resize'` listener and is unaffected — `resize` is not in `PASSIVE_TYPES`.

---

## Critical files to modify

- [src/typescript/Base/Event.ts](src/typescript/Base/Event.ts) — add `PASSIVE_TYPES` + `captureOpts`, swap the six `true` arguments.

No other files change. The API surface is unchanged.

## Existing primitives to reuse

- The `installedListenerTypes` set ([Event.ts:18](src/typescript/Base/Event.ts#L18)) — install/remove bookkeeping is unchanged; only the third-argument shape moves.
- DOM `AddEventListenerOptions` — standard, supported in every browser the library targets.

---

## Risks

- **Future caller calls `preventDefault()` on a passive event.** The browser logs `[Intervention] Unable to preventDefault inside passive event listener` and ignores the call. No silent breakage today (audit above confirms zero such callers), but if a future feature needs preventDefault on `wheel`/`touchmove` (e.g., a custom scroll-trapping region), the caller must know to use a non-passive handler. Mitigation: the audit doc above lists the affected types; this file lives next to the source for future reference.
- **Older browsers** (pre-Chrome 51, pre-Safari 10) treat the third argument as a boolean and ignore the options object's `passive` flag. They fall back to non-passive capture — same behavior as today, no regression.
- **Symmetry concern**: `removeEventListener` only matches on the `capture` flag, so passing the full `captureOpts(type)` is correct. Mixing `true` on add with `{ capture: true }` on remove (or vice versa) would also match, but using `captureOpts(type)` in both keeps the pair textually identical.

---

## Verification

1. **Type-check**: `npx tsc --noEmit` produces no new errors above the existing baseline.
2. **Build**: `npx vite build` succeeds.
3. **DevTools Performance** (`npm run dev`):
   - Open the ComplexUIPanel virtualized Table; record a Performance trace while flick-scrolling. Expect: `scroll` event handler runs on the compositor thread; main-thread JS time during scroll inertia drops to near zero (only the row-window updates remain).
   - Same trace on the Tree panel.
   - Inspect a registered scroll listener via DevTools Elements > Event Listeners and confirm `passive: true`.
4. **Demo-panel sweep** in `npm run dev`:
   - **ComplexUIPanel** — fast scroll table vertically and horizontally; rows still render in the right window, header still slides via [Table.ts:99-107](src/typescript/Base/component/table/Table.ts#L99-L107).
   - **Tree panel** — fast scroll, expand/collapse; rows render correctly.
   - **Window dragging via touch** (or DevTools touch emulation) — drag a Window's title bar and resize via [WindowBorder.ts](src/typescript/Base/component/WindowBorder.ts) handles; movement still tracks the touch.
   - **SplitGutter** — drag a split divider via touch emulation; resize behavior unchanged.
5. **Console check**: no `[Intervention] Unable to preventDefault inside passive event listener` warnings during the sweep. Such a warning indicates a caller violated the passive contract.
6. Per [CLAUDE.md](CLAUDE.md): run `graphify update .` after the change lands.
