# Compositor-Layer Hints via `will-change: transform`

## Context

The previous passes (DOM-access caching, CSS transforms for hot-path motion, containment + rAF coalescing + worker offload) reduced redundant DOM work and moved continuous motion onto the compositor. What remains is a small but visible cost on the *first* frame of motion: the browser only promotes an element to its own compositor layer when it sees a transform actually being animated, so the first translate on a "cold" element pays a layout-tree restructure that the next frames don't pay. The standard fix is `will-change: transform`, which pre-creates the layer.

The hint is double-edged: leaving it set permanently wastes GPU memory and, past a threshold, browsers ignore it (defeating the optimization). It must be set only over the active-motion lifetime — `mousedown` to `mouseup` for drag, "in the row pool" for virtualized rows, and the lifetime of the table for the always-translating header.

The intended outcome: the first dragged frame and the first scrolled frame look identical to subsequent frames; no perceptible "settle" tick.

---

## Phase 1 — `setWillChange` helper on Component

### [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts)

Add a single typed setter that routes through the existing batched style channel and follows the framework's three-rule contract (typed setter, cached field, options-bag entry).

- Add private backing field `_willChange: string | null = null` next to the geometry / option-less runtime fields around [Component.ts:173](src/typescript/lib/core/Component.ts#L173).
- Add `willChange?: string | null` to `ComponentOptions` around [Component.ts:74-102](src/typescript/lib/core/Component.ts#L74-L102) (placed near `transform` / `opacity`).
- Add `setWillChange(value: string | null): this` (public) and `getWillChange(): string | null` near the other transform/visual setters (after `setOpacity` / `clearOpacity` ~ [Component.ts:2128-2144](src/typescript/lib/core/Component.ts#L2128-L2144)). Behaviour:
  - Equality short-circuit against `_willChange`.
  - On `null`, call `setElementStyle("willChange", null)` to remove the hint and release the speculative layer.
  - Otherwise, call `setElementStyle("willChange", value)`.
  - Cache `value` in `_willChange` so the field equals what's in the DOM (mirrors the `translateX`/`translateY` invariant used by `setTranslate` at [Component.ts:1855-1869](src/typescript/lib/core/Component.ts#L1855-L1869)).
- Forward `options.willChange` in `applyOptions` around [Component.ts:297-331](src/typescript/lib/core/Component.ts#L297-L331), next to `options.transform`.

`setElementStyle` already coalesces into `inlineStyle` ([Component.ts:535-545](src/typescript/lib/core/Component.ts#L535-L545)); no new batching needed.

---

## Phase 2 — Window drag (transient)

### [src/typescript/lib/core/Window.ts](src/typescript/lib/core/Window.ts)

Drag is the textbook transient case. Hint on `mousedown`, clear on `mouseup`.

- [Window.onMouseDown:392-406](src/typescript/lib/core/Window.ts#L392-L406) — after snapshotting `_dragStartLeft` / `_dragStartTop` / `_dragDX` / `_dragDY` and before the two `Event.addViewportListener` calls, call `this.setWillChange("transform")`. The layer exists by the time the first `mousemove` fires.
- [Window.onMouseUp:527-536](src/typescript/lib/core/Window.ts#L527-L536) — after committing the drag delta back into `left`/`top` and resetting `setTranslate(0, 0)`, call `this.setWillChange(null)` to release the layer.

Risk: a window's WindowBorder children inherit composite behavior from the parent transform during drag. Adding `will-change` doesn't change the compositing tree for children — it just primes the parent — so resize hit-testing is unaffected. Multiple windows dragged in sequence each pay only their own brief hint lifetime, so memory stays bounded.

---

## Phase 3 — Body row pool (transient over pool membership)

### [src/typescript/lib/component/table/Body.ts](src/typescript/lib/component/table/Body.ts)

A pooled row is "always about to translate" — every scroll tick writes `setTranslate(0, targetY)`. Hinting per-row across pool membership is a good fit because the pool is bounded (window size + buffer ~20–40 rows, not thousands).

- Pool grow path [Body.growRowPool:408-436](src/typescript/lib/component/table/Body.ts#L408-L436) — immediately after `row.setY(0)`, call `row.setWillChange("transform")`. Each pooled row keeps the hint for as long as it remains in the pool.
- `clearRowPool` [Body.ts:162-181](src/typescript/lib/component/table/Body.ts#L162-L181) — for each pooled row before discarding (inside the loop at [Body.ts:166-172](src/typescript/lib/component/table/Body.ts#L166-L172), or in a separate iteration), call `row.setWillChange(null)`. This covers both `setHiddenColumns` and `setColumnConfigs`, the two pool-shrink paths that call `clearRowPool` (lines 145 and 153).

Risk: pool size is bounded by visible window (`windowSize`) plus `SCROLL_BUFFER`. Even on a 4K display this is tens of rows, well under the per-page `will-change` threshold (~50–100 elements depending on browser). Hinting cells inside rows would blow that budget for no gain — cells don't translate independently.

---

## Phase 4 — Tree row pool (transient over pool membership)

### [src/typescript/lib/component/tree/Tree.ts](src/typescript/lib/component/tree/Tree.ts)

Mirror of Phase 3 against `_rowPool`. **No pool-clear path exists in Tree.ts today** — `_rowPool` only grows (`_growRowPool` at [Tree.ts:670-694](src/typescript/lib/component/tree/Tree.ts#L670-L694)). Rows live for the Tree's lifetime, so the hint is effectively static — fine given the pool is bounded by `windowSize + buffer`.

- Pool grow path [Tree._growRowPool:678-691](src/typescript/lib/component/tree/Tree.ts#L678-L691) — after `row.setY(0)`, call `row.setWillChange("transform")`. No clear is needed.

Risk: identical to Body. Pool is a small bounded set.

---

## Phase 5 — Table header (static, lifetime of Table)

### [src/typescript/lib/component/table/Table.ts](src/typescript/lib/component/table/Table.ts)

The header writes `setTranslate(-scrollLeft, 0)` on every body-scroll event ([Table.ts:142-150](src/typescript/lib/component/table/Table.ts#L142-L150)). Unlike a row, the header is **always** the scroll target — there's no "stops translating" lifecycle to clear against.

- After the header is constructed and added (around [Table.ts:114-117](src/typescript/lib/component/table/Table.ts#L114-L117), or just before the scroll listener at [Table.ts:142](src/typescript/lib/component/table/Table.ts#L142)), call `this.header.setWillChange("transform")` once. No clear path; it holds for the table's lifetime.

Why permanent here is correct: there's exactly one header per table, so the per-element cost is paid once per table instance. Even ten tables on a page is ten hints, well under the threshold. The alternative (set/clear around every scroll event) would defeat the optimization — the layer would be created and torn down per tick.

---

## Critical files to modify

- [src/typescript/lib/core/Component.ts](src/typescript/lib/core/Component.ts) — Phase 1 (`setWillChange`, field, options entry)
- [src/typescript/lib/core/Window.ts](src/typescript/lib/core/Window.ts) — Phase 2 (drag)
- [src/typescript/lib/component/table/Body.ts](src/typescript/lib/component/table/Body.ts) — Phase 3 (row pool)
- [src/typescript/lib/component/tree/Tree.ts](src/typescript/lib/component/tree/Tree.ts) — Phase 4 (row pool — grow-only)
- [src/typescript/lib/component/table/Table.ts](src/typescript/lib/component/table/Table.ts) — Phase 5 (header)

## Existing primitives reused

- `setElementStyle` / `inlineStyle` batching ([Component.ts:535-545](src/typescript/lib/core/Component.ts#L535-L545)) — `setWillChange` writes through this.
- Field-DOM invariant pattern from `setTranslate` ([Component.ts:1855-1869](src/typescript/lib/core/Component.ts#L1855-L1869)) — `setWillChange` follows the same cache-field-mirrors-DOM rule.
- Drag lifecycle hooks `onMouseDown` / `onMouseUp` already exist as the natural set/clear pair.
- Body row-pool grow / `clearRowPool` already exist as the natural set/clear pair for the row case.

## Order of execution (lowest-risk first)

1. **Phase 1** (helper) — additive, no callers, zero risk.
2. **Phase 5** (header) — single call site, static, easy to verify in the Layers panel.
3. **Phase 2** (Window drag) — isolated to two methods, easy to revert.
4. **Phase 3** (Body pool) — pool grow + clear, two small edits.
5. **Phase 4** (Tree pool) — grow-only, single edit.

## End-to-end verification

1. **Type-check**: `npx tsc --noEmit` produces no new errors above the baseline.
2. **Build**: `npx vite build` succeeds.
3. **DevTools Layers panel** sweep in `npm run dev`:
   - **ComplexUIPanel** — open the table; Layers panel should show one composited layer for the header. Begin scrolling; pooled rows appear as their own layers (count matches windowSize+buffer). Stop scrolling and trigger `setHiddenColumns` / `setColumnConfigs`; row layers disappear.
   - **Tree panel** — same pattern; pooled tree rows are layered.
   - **Window drag** — before mousedown, the window has no `will-change`. On mousedown, a layer appears in the Layers panel. On mouseup, the layer is released.
4. **No-regression smoke test** of all panels — `will-change` should be visually invisible. Any visual difference is a bug (most likely a stacking-context shift from the implicit layer).
5. **GPU memory sanity check** — open DevTools Performance Monitor, confirm "GPU memory used" doesn't trend upward with repeated drags / scroll sessions (hint is being cleared correctly).
6. Per [CLAUDE.md](CLAUDE.md): run `graphify update . --directed` after the implementation lands.
