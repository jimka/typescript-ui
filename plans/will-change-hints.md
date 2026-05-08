# Compositor-Layer Hints via `will-change: transform`

## Context

The previous passes (DOM-access caching, CSS transforms for hot-path motion, containment + rAF coalescing + worker offload) reduced redundant DOM work and moved continuous motion onto the compositor. What remains is a small but visible cost on the *first* frame of motion: the browser only promotes an element to its own compositor layer when it sees a transform actually being animated, so the first translate on a "cold" element pays a layout-tree restructure that the next frames don't pay. The standard fix is `will-change: transform`, which pre-creates the layer.

The hint is double-edged: leaving it set permanently wastes GPU memory and, past a threshold, browsers ignore it (defeating the optimization). It must be set only over the active-motion lifetime — `mousedown` to `mouseup` for drag, "in the row pool" for virtualized rows, and the lifetime of the table for the always-translating header.

The intended outcome: the first dragged frame and the first scrolled frame look identical to subsequent frames; no perceptible "settle" tick.

---

## Phase 1 — `setWillChange` helper on Component

### [src/typescript/Base/Component.ts](src/typescript/Base/Component.ts)

Add a single thin setter that routes through the existing batched style channel:

- `setWillChange(value: string | null)`:
  - `if (value === null) writes "" via setElementStyle("will-change", "")` (removes the hint and the speculative layer).
  - Otherwise `setElementStyle("will-change", value)`.
  - Equality short-circuit on a cached `willChange: string` field, mirroring the field-DOM invariant used by `setTranslate` (cached field equals what's in the DOM).

The helper exists because four sites need the same property; doing it ad-hoc would diverge and miss the batching path. No new infrastructure — `setElementStyle` already coalesces into `dirtyStyle`.

---

## Phase 2 — Window drag (transient)

### [src/typescript/Base/Window.ts](src/typescript/Base/Window.ts)

Drag is the textbook transient case. Hint on `mousedown`, clear on `mouseup`.

- [Window.onMouseDown:182](src/typescript/Base/Window.ts#L182) — after snapshotting `_dragStartLeft` / `_dragStartTop` and before `Event.addViewportListener`, call `this.setWillChange("transform")`. The layer exists by the time the first `mousemove` fires.
- [Window.onMouseUp:315](src/typescript/Base/Window.ts#L315) — after committing the drag delta back into `left`/`top` and resetting `setTranslate(0, 0)`, call `this.setWillChange(null)` to release the layer.

Risk: a window's WindowBorder children inherit composite behavior from the parent transform during drag. Adding `will-change` doesn't change the compositing tree for children — it just primes the parent — so resize hit-testing is unaffected. Multiple windows dragged in sequence each pay only their own brief hint lifetime, so memory stays bounded.

---

## Phase 3 — Body row pool (transient over pool membership)

### [src/typescript/Base/component/table/Body.ts](src/typescript/Base/component/table/Body.ts)

A pooled row is "always about to translate" — every scroll tick writes `setTranslate(0, targetY)`. Hinting per-row across pool membership is a good fit because the pool is bounded (window size + buffer ~20-40 rows, not thousands).

- Pool grow path [Body.ts:259-274](src/typescript/Base/component/table/Body.ts#L259-L274) — immediately after `row.setY(0)`, call `row.setWillChange("transform")`. Each pooled row keeps the hint for as long as it remains in the pool.
- `clearRowPool` [Body.ts:117-132](src/typescript/Base/component/table/Body.ts#L117-L132) — for each pooled row before discarding, `row.setWillChange(null)`. This covers both `setHiddenColumns` and `setColumnConfigs`, the two pool-shrink paths.

Risk: pool size is bounded by visible window (`windowSize`) plus `SCROLL_BUFFER`. Even on a 4K display this is tens of rows, well under the per-page `will-change` threshold (~50–100 elements depending on browser). Hinting cells inside rows would blow that budget for no gain — cells don't translate independently.

---

## Phase 4 — Tree row pool (transient over pool membership)

### [src/typescript/Base/component/tree/Tree.ts](src/typescript/Base/component/tree/Tree.ts)

Mirror of Phase 3 against `_rowPool`.

- Pool grow path [Tree.ts:506-518](src/typescript/Base/component/tree/Tree.ts#L506-L518) — after `row.setY(0)`, call `row.setWillChange("transform")`.
- The Tree's pool-clear path (search for the symmetric counterpart of `clearRowPool` in Tree.ts) — clear the hint per-row before discarding. If no such path exists today (Tree may rely solely on grow-only pool), no clear is needed because rows live for the Tree's lifetime; in that case the hint is effectively static, which is fine because pool size is bounded the same way.

Risk: identical to Body. Pool is a small bounded set.

---

## Phase 5 — Table header (static, lifetime of Table)

### [src/typescript/Base/component/table/Table.ts](src/typescript/Base/component/table/Table.ts)

The header writes `setTranslate(-scrollLeft, 0)` on every body-scroll event ([Table.ts:99-107](src/typescript/Base/component/table/Table.ts#L99-L107)). Unlike a row, the header is **always** the scroll target — there's no "stops translating" lifecycle to clear against.

- After the header is constructed (before or after the scroll listener at [Table.ts:99](src/typescript/Base/component/table/Table.ts#L99)), call `this.header.setWillChange("transform")` once. No clear path; it holds for the table's lifetime.

Why permanent here is correct: there's exactly one header per table, so the per-element cost is paid once per table instance. Even ten tables on a page is ten hints, well under the threshold. The alternative (set/clear around every scroll event) would defeat the optimization — the layer would be created and torn down per tick.

---

## Critical files to modify

- [src/typescript/Base/Component.ts](src/typescript/Base/Component.ts) — Phase 1 (`setWillChange`)
- [src/typescript/Base/Window.ts](src/typescript/Base/Window.ts) — Phase 2 (drag)
- [src/typescript/Base/component/table/Body.ts](src/typescript/Base/component/table/Body.ts) — Phase 3 (row pool)
- [src/typescript/Base/component/tree/Tree.ts](src/typescript/Base/component/tree/Tree.ts) — Phase 4 (row pool)
- [src/typescript/Base/component/table/Table.ts](src/typescript/Base/component/table/Table.ts) — Phase 5 (header)

## Existing primitives reused

- `setElementStyle` / `dirtyStyle` batching ([Component.ts:269-332](src/typescript/Base/Component.ts#L269-L332)) — `setWillChange` writes through this.
- Field-DOM invariant pattern from `setTranslate` ([Component.ts](src/typescript/Base/Component.ts)) — `setWillChange` follows the same cache-field-mirrors-DOM rule.
- Drag lifecycle hooks `onMouseDown` / `onMouseUp` already exist as the natural set/clear pair.
- Row-pool grow/`clearRowPool` already exist as the natural set/clear pair for the row case.

## Order of execution (lowest-risk first)

1. **Phase 1** (helper) — additive, no callers, zero risk.
2. **Phase 5** (header) — single call site, static, easy to verify in the Layers panel.
3. **Phase 2** (Window drag) — isolated to two methods, easy to revert.
4. **Phase 3** (Body pool) — pool grow + clear, two small edits.
5. **Phase 4** (Tree pool) — symmetric to Phase 3.

## End-to-end verification

1. **Type-check**: `npx tsc --noEmit` produces no new errors above the baseline.
2. **Build**: `npx vite build` succeeds.
3. **DevTools Layers panel** sweep in `npm run dev`:
   - **ComplexUIPanel** — open the table; Layers panel should show one composited layer for the header. Begin scrolling; pooled rows appear as their own layers (count matches windowSize+buffer). Stop scrolling and trigger `setHiddenColumns` / `setColumnConfigs`; row layers disappear.
   - **Tree panel** — same pattern; pooled tree rows are layered.
   - **Window drag** — before mousedown, the window has no `will-change`. On mousedown, a layer appears in the Layers panel. On mouseup, the layer is released.
4. **No-regression smoke test** of all panels — `will-change` should be visually invisible. Any visual difference is a bug (most likely a stacking-context shift from the implicit layer).
5. **GPU memory sanity check** — open DevTools Performance Monitor, confirm "GPU memory used" doesn't trend upward with repeated drags / scroll sessions (hint is being cleared correctly).
6. Per [CLAUDE.md](CLAUDE.md): run `graphify update .` after the implementation lands.
