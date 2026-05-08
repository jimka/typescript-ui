# Render Performance Pass III — Containment, rAF Coalescing, Worker Offload

## Context

The earlier passes (DOM-access caching, CSS transforms) targeted what gets written and how often. This pass targets three orthogonal axes the codebase hasn't exploited yet:

1. **Layout/paint scope** — without explicit hints the browser must assume any subtree change might affect anything else. CSS containment narrows the reflow region per change.
2. **Layout call frequency** — `setSize`/`addComponent`/event handlers each trigger a synchronous `doLayout()`. A user event that fires N state changes runs N layout passes per frame instead of one.
3. **Main-thread blocking on data ops** — `AbstractStore.sort`/`filter` are O(N log N) / O(N) on the main thread; for 100K-row stores this stalls input and paint.

The desired outcome is smoother input handling and lower main-thread time during scroll, drag, sort, filter, and panel state changes — with the field↔DOM invariant preserved (every cached field still mirrors the DOM property it represents) and demo panels behaving identically.

---

## Phase 1 — CSS containment on bounded subtrees

### Goal
Set `contain` on the components whose layout/paint is independent of the rest of the document, so the browser can scope reflow to the smallest dirty region.

### Recommended assignments (from exploration)

| Component | File | Containment | Reason |
| --- | --- | --- | --- |
| Dialog | [Dialog.ts:270-277](src/typescript/Base/Dialog.ts#L270-L277) | `strict` | Fixed width/height (480px), `setOverflow("hidden")`, no absolute escapes. |
| Notification | [Notification.ts:55-59](src/typescript/Base/Notification.ts#L55-L59) | `strict` | Hardcoded 320×64, `overflow:hidden`, top-level. |
| Window | [Window.ts:107-122](src/typescript/Base/Window.ts#L107-L122) | `layout` | Resizable, so size containment is unsafe; layout containment is fine. |
| Tooltip | [Tooltip.ts:63-74](src/typescript/Base/Tooltip.ts#L63-L74) | `layout paint` | Top-level overlay, dynamic sizing; safe to scope layout+paint. |
| ContextMenu | [ContextMenu.ts:48-71](src/typescript/Base/ContextMenu.ts#L48-L71) | `layout` | Dynamic size set on `show()`. |
| MenuPanel | [MenuPanel.ts:85-109](src/typescript/Base/component/menubar/MenuPanel.ts#L85-L109) | `layout` | Width fixed (220), height per item count. |
| AutoCompleteDropdown | [AutoCompleteDropdown.ts:41-85](src/typescript/Base/component/AutoCompleteDropdown.ts#L41-L85) | `layout` | Dynamic dimensions from anchor + suggestions. |
| Accordion section wrapper | [Accordion.ts:324-327](src/typescript/Base/layout/Accordion.ts#L324-L327) | `layout paint` | Already `position:absolute; overflow:hidden`; clipping animation. Nested popovers re-parent to documentElement, so they don't get clipped. |
| Tab content panel | [Tab.ts:366-373](src/typescript/Base/layout/Tab.ts#L366-L373) | `layout` | Sized by Tab layout manager; default `overflow:hidden`. |

### Implementation

Apply via the per-component CSS rule (each Component already owns one — see [Component.ts:94](src/typescript/Base/Component.ts#L94)). One line per constructor: `this.cssRule.style.contain = "strict";` (or whatever value applies). No new API; uses existing `cssRule` machinery.

For **Tab content** and **Accordion sections**, set `contain` on the wrapper component the layout manager creates (not on user-supplied children) so it doesn't leak into user code.

### Risks to verify during demo sweep

- Accordion content with absolutely-positioned descendants that visually overflow the panel: such children are normally re-parented to documentElement (Tooltip, MenuPanel, AutoCompleteDropdown all do this), so this should be a non-issue. Confirm in the demo.
- `contain: strict` on Dialog: requires explicit dimensions before paint. Dialog does set width/height before show, so safe.

---

## Phase 2 — `requestAnimationFrame` coalescing of `doLayout()`

### Decision
Setter and event-driven paths auto-coalesce via a new `scheduleLayout()`. Internal `LayoutManager.placeComponent` recursion stays synchronous (it's an invariant — children must be sized before parent continues). A `flushLayout()` escape hatch lets callers force a synchronous run when they need to read a layout-derived value.

### New API on Component

In [Component.ts](src/typescript/Base/Component.ts):

- Add module-level state (in Component.ts or a small new helper at top of file):
  - `pendingLayouts: Set<Component> = new Set()`
  - `rafHandle: number | null = null`
- `scheduleLayout()`: `if (this.layoutPaused) return; pendingLayouts.add(this); if (rafHandle === null) rafHandle = requestAnimationFrame(flushPendingLayouts)`.
- Module-level `flushPendingLayouts()`: walks pendingLayouts, prunes any component whose ancestor is also pending (ancestor's layout will recurse into it anyway), calls `doLayout()` on each remaining root, clears state.
- `flushLayout()` (instance method): if this component is in `pendingLayouts`, removes it and calls `doLayout()` synchronously. Used by callers that need a synchronous layout commit before reading.

`pauseLayout()` / `resumeLayout()` continue to work — `scheduleLayout()` honors `layoutPaused`, and `resumeLayout()` flushes immediately.

### Switch internal callers

Replace the synchronous `doLayout()` call inside these public-API setters and event-driven paths with `scheduleLayout()`:

- [Component.setSize:1135](src/typescript/Base/Component.ts#L1135)
- [Component.addComponent:1563,1575](src/typescript/Base/Component.ts#L1563)
- [Component.removeComponent:1605](src/typescript/Base/Component.ts#L1605)
- [Accordion section toggle handlers:161,178,382,402,461](src/typescript/Base/layout/Accordion.ts#L161)
- [Tab.selectTab:357 / Tab.onTabClose:415](src/typescript/Base/layout/Tab.ts#L357)
- [Dialog.show/onAccept/onCancel](src/typescript/Base/Dialog.ts) — all three call sites
- [Notification.show/dismiss](src/typescript/Base/Notification.ts)
- [Tooltip.show](src/typescript/Base/Tooltip.ts)
- [ContextMenu.show](src/typescript/Base/ContextMenu.ts)

### Stay synchronous

- `LayoutManager.placeComponent` ([LayoutManager.ts:229](src/typescript/Base/layout/LayoutManager.ts#L229)) — internal recursion invariant.
- `Component.doChildrenComponentLayouts` ([Component.ts:1748](src/typescript/Base/Component.ts#L1748)) — same.
- `Window.flushResize` ([Window.ts:208-277](src/typescript/Base/Window.ts#L208-L277)) — already rAF-coalesced; calling `doLayout()` synchronously inside the rAF callback is correct.
- `Body.renderWindow` and `Tree._renderWindow` — these run inside the geometry-cached scroll loop; layout there is already minimized and tightly coupled to data binding. Scheduling would risk visual drift on scroll. Leave synchronous.
- `Component.resumeLayout` flush.

### Coalescing logic (the tricky bit)

In `flushPendingLayouts`, prune the set so we only call `doLayout()` on components whose ancestors aren't also dirty. Naive: for each `c` in set, walk `c._parent` chain — if any ancestor is in set, skip `c`. Keeps the work O(M·D) where M is dirty count and D is tree depth, fine for typical M/D.

### Risks

- Code that does `comp.setSize(...); comp.getInnerSize();` expects layout to have already run. Audit reads of layout-derived state immediately following setters. Add `comp.flushLayout()` calls where needed. Likely sites: layout managers reading their own children's dimensions. Search for `setSize` / `addComponent` followed by `getInnerSize` / `getBoundingClientRect` / `getWidth` / `getHeight`.
- One-frame visual delay on accordion/tab open. Acceptable trade-off for the smoother batched case (multiple changes in one event handler).

---

## Phase 3 — FilterDescriptor + Web Worker for store sort/filter

### Decision
Refactor `filterBy(fn)` to `filterBy(descriptor)` with a fixed serializable filter vocabulary, then move `sort` and all filter operations onto a worker for stores above a threshold. AutoCompleteField migrates to the descriptor language.

### New file: `src/typescript/Base/data/FilterDescriptor.ts`

Define a small algebra of descriptors (plain serializable objects):

```
type FilterDescriptor =
    | { type: 'eq';        field: string; value: any }
    | { type: 'neq';       field: string; value: any }
    | { type: 'contains';  field: string; value: string; caseSensitive?: boolean }
    | { type: 'startsWith'; field: string; value: string; caseSensitive?: boolean }
    | { type: 'gt' | 'gte' | 'lt' | 'lte'; field: string; value: number | string | Date }
    | { type: 'in';        field: string; values: any[] }
    | { type: 'and';       filters: FilterDescriptor[] }
    | { type: 'or';        filters: FilterDescriptor[] }
    | { type: 'not';       filter: FilterDescriptor };
```

Plus a `matchesFilter(record: ModelRecord | Record<string, any>, descriptor): boolean` evaluator that works on either side of the worker boundary (uses field name to look up value).

### Worker: `src/typescript/Base/data/StoreWorker.ts`

A single worker module that owns a snapshot of raw records keyed by store id. Messages:

- `{ type: 'snapshot', storeId, records }` — main thread sends the current data array (plain objects from `record.getData()`, not `ModelRecord` instances).
- `{ type: 'sort', storeId, field, direction, fieldType, requestId }` → returns `{ requestId, indices: number[] }` (sorted indices into the snapshot).
- `{ type: 'filter', storeId, descriptor, requestId }` → returns `{ requestId, indices: number[] }`.
- `{ type: 'sortFilter', storeId, sort, filter, requestId }` → combined op, single round-trip.

The worker holds a `Map<storeId, rawData[]>` so we don't re-ship the dataset on every op.

### AbstractStore changes ([AbstractStore.ts](src/typescript/Base/data/AbstractStore.ts))

- Add a private `workerHandle: StoreWorkerClient | null` lazily created the first time the store grows past the threshold (e.g., 1000 records).
- `sort(field, direction): Promise<void>` — under threshold, run synchronously as today; over threshold, ship to worker, receive sorted indices, reorder the in-memory `records` array of `ModelRecord` instances. Emit `'datachanged'` on completion.
- `filter(field, value)`: rewrite as `filter({ type: 'eq', field, value })` → routes through `filterBy(descriptor)`.
- `filterBy(descriptor: FilterDescriptor): Promise<void>` — replaces the existing function form. Same threshold-gate path as sort.
- The worker sends back `indices`, main thread maps them to the existing `ModelRecord[]` array (records stay on the main thread; the worker only operates on plain data + emits indices).

### Snapshot synchronization

When `add`/`remove`/`load`/`set` mutates data, send a snapshot delta to the worker (`{ type: 'snapshot-update', storeId, ops: [...] }`) so the worker's copy stays in sync. A simpler V1: re-send the full snapshot on each mutation when over threshold. Worth measuring before optimizing.

### Caller migrations

- [AutoCompleteField.querySuggestions:377-406](src/typescript/Base/component/AutoCompleteField.ts#L377-L406): replace the closure passed to `filterBy(fn)` with `filterBy({ type: 'contains', field, value: lower, caseSensitive: false })`. The existing `matches` method (which selects between `startsWith` / `contains` modes) becomes a small switch that builds a descriptor.
- [Header.handleSortClick:214-246](src/typescript/Base/component/table/cell/Header.ts#L214-L246): `await store.sort(...)` instead of synchronous call. Already fires inside an async-friendly event handler.
- Body.renderWindow only calls `store.getRecords()`, which stays synchronous.

### Risks

- **Stale results during in-flight worker ops**: A user who sorts then filters quickly could get out-of-order results. Tag every request with a monotonically-increasing `requestId`; on response, drop results from a request older than the latest applied one.
- **Date and Boolean handling in descriptors**: structured clone supports `Date`. Boolean and number compare natively. String comparisons need `localeCompare` for locale-correctness — keep it simple (`<`/`>`) for V1, document the limitation.
- **Filter descriptors aren't as expressive as arbitrary functions**. Document the limitation and the available operators. The descriptor algebra above covers all current callers (AutoCompleteField is the only `filterBy` user).

---

## Critical files to modify

- [src/typescript/Base/Component.ts](src/typescript/Base/Component.ts) — Phase 1 (containment via cssRule for some), Phase 2 (`scheduleLayout` / `flushLayout` / pending-layout queue), switch setSize/addComponent/removeComponent
- [src/typescript/Base/Dialog.ts](src/typescript/Base/Dialog.ts) — Phase 1 strict containment, Phase 2 swap to scheduleLayout
- [src/typescript/Base/Notification.ts](src/typescript/Base/Notification.ts) — Phase 1, Phase 2
- [src/typescript/Base/Window.ts](src/typescript/Base/Window.ts) — Phase 1
- [src/typescript/Base/Tooltip.ts](src/typescript/Base/Tooltip.ts) — Phase 1, Phase 2
- [src/typescript/Base/ContextMenu.ts](src/typescript/Base/ContextMenu.ts) — Phase 1, Phase 2
- [src/typescript/Base/component/menubar/MenuPanel.ts](src/typescript/Base/component/menubar/MenuPanel.ts) — Phase 1
- [src/typescript/Base/component/AutoCompleteDropdown.ts](src/typescript/Base/component/AutoCompleteDropdown.ts) — Phase 1
- [src/typescript/Base/layout/Accordion.ts](src/typescript/Base/layout/Accordion.ts) — Phase 1 (wrapper), Phase 2 (toggle handlers)
- [src/typescript/Base/layout/Tab.ts](src/typescript/Base/layout/Tab.ts) — Phase 1 (content wrapper), Phase 2 (selectTab/onTabClose)
- [src/typescript/Base/data/AbstractStore.ts](src/typescript/Base/data/AbstractStore.ts) — Phase 3 sort/filter become async, threshold-gated worker dispatch
- **NEW** [src/typescript/Base/data/FilterDescriptor.ts](src/typescript/Base/data/FilterDescriptor.ts) — Phase 3 descriptor algebra + matcher
- **NEW** [src/typescript/Base/data/StoreWorker.ts](src/typescript/Base/data/StoreWorker.ts) — Phase 3 worker module
- **NEW** [src/typescript/Base/data/StoreWorkerClient.ts](src/typescript/Base/data/StoreWorkerClient.ts) — Phase 3 main-thread client (handles requestId, snapshot sync)
- [src/typescript/Base/component/AutoCompleteField.ts](src/typescript/Base/component/AutoCompleteField.ts) — Phase 3 migrate to descriptor
- [src/typescript/Base/component/table/cell/Header.ts](src/typescript/Base/component/table/cell/Header.ts) — Phase 3 await sort

## Existing primitives to reuse

- `cssRule` per-component CSS rule ([Component.ts:94](src/typescript/Base/Component.ts#L94)) — apply `contain` here.
- `setElementStyle` / `setAutoCommitStyle` batching ([Component.ts:269-332](src/typescript/Base/Component.ts#L269-L332)) — unchanged.
- `pauseLayout` / `resumeLayout` ([Component.ts:1721-1738](src/typescript/Base/Component.ts#L1721-L1738)) — `scheduleLayout` honors `layoutPaused`; `resumeLayout` triggers an immediate flush.
- Existing rAF pattern in `Window.flushResize` ([Window.ts:208-277](src/typescript/Base/Window.ts#L208-L277)) — same idiom for the new layout queue.
- Existing async pattern: `store.load(): Promise<void>` ([AbstractStore.ts:49](src/typescript/Base/data/AbstractStore.ts#L49)) and `store.sync(): Promise<void>` ([AbstractStore.ts:239](src/typescript/Base/data/AbstractStore.ts#L239)) — sort/filter join this group.
- Existing perf harness at [perf/Benchmark.ts](src/typescript/perf/Benchmark.ts) — extend with a `benchSortFilter(rowCount)` for Phase 3 measurement.

## Order of execution (lowest-risk first)

1. **Phase 1 (containment)** — pure CSS additions, single line per component, easy to revert. Smoke-test the demo panels with each addition.
2. **Phase 2 (rAF coalescing)** — add `scheduleLayout`/`flushLayout` first as additive API. Then migrate setSize/addComponent/removeComponent. Then migrate event-driven paths. Audit synchronous-read sites with grep for `setSize` immediately followed by `getInnerSize`/`getBoundingClientRect`/`getWidth`/`getHeight`.
3. **Phase 3 (worker + descriptors)** —
   1. Land FilterDescriptor + matchesFilter (synchronous main-thread evaluator).
   2. Migrate AutoCompleteField to descriptors. Tests: autocomplete still filters correctly.
   3. Make sort/filter async (under-threshold path stays main-thread). Update Header sort caller to await.
   4. Add the worker + client. Snapshot ship + indices return path.
   5. Wire threshold dispatch.

## End-to-end verification

1. **Type-check**: `npx tsc --noEmit` produces no new errors above the 9-error baseline.
2. **Build**: `npx vite build` succeeds.
3. **Capture baseline**: extend [Benchmark.ts](src/typescript/perf/Benchmark.ts) with `benchSortFilter(rowCount = 100000)` that times sort + equality filter on a synthetic store. Run before each phase to capture deltas.
4. **Demo-panel sweep** in `npm run dev`:
   - **ComplexUIPanel** — virtual-scroll table, sort headers (now async), hide columns. Verify no visual regressions; sort completes without UI jank when N is large.
   - **MiscPanel** — autocomplete still filters correctly using the descriptor language.
   - **MenuBarPanel / AccordionPanel / TabPanel** — open/close menus, expand/collapse sections, switch tabs. Watch for one-frame visual delay (acceptable) but no broken layouts. Multiple rapid clicks should now batch into one layout pass per frame.
   - **Window dragging + Dialog show/dismiss + Notification toast** — visual smoke test; containment shouldn't change anything visible.
   - **AutoCompleteField** — type fast; autocomplete stays responsive even with a large suggestion store.
5. **Compare perf harness numbers** to pre-phase baselines. Expectations:
   - Sort 100K rows: drops from main-thread blocking (>100ms) to non-blocking (worker time, ~similar wall, but main thread free).
   - Accordion/tab rapid clicks: total time roughly the same, but coalesced into fewer frames.
   - Containment: hard to measure with the existing harness; rely on DevTools' "Layout" panel to see narrower reflow scope per change.
6. Per [CLAUDE.md](CLAUDE.md): run `graphify update .` after the implementation lands.
