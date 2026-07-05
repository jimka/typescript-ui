---
depends-on: [shared-clamp-timer-size-sentinel-utils]
touches-shared: [src/typescript/lib/component/container/VirtualScroller.ts]
---

# Data-View Virtualization Consolidation — Implementation Plan

## Overview

The three data-display widget families under `src/typescript/lib/component/{table,list,tree}/` independently re-implement the same mechanics. The largest offender is the **transform-based virtual-scroll window**: [`table/Body.ts`](src/typescript/lib/component/table/Body.ts) and [`tree/Tree.ts`](src/typescript/lib/component/tree/Tree.ts) are the only two consumers of [`container/VirtualScroller.ts`](src/typescript/lib/component/container/VirtualScroller.ts), and each carries a near-verbatim copy of the window/pool/geometry machinery. Alongside that, the **modifier-key selection reducer** is written three times, **scroll-into-view + page-nav** twice more, and there are two **parallel renderer hierarchies** with duplicate default label renderers. Finally the audit surfaced two dead/broken public surfaces and two rule violations (cross-component `Event` listening, inline-arrow listeners).

This plan extracts a shared `VirtualRowView<TRow>` base that `Body` and `Tree` extend ([Body:112](src/typescript/lib/component/table/Body.ts#L112), [Tree:92](src/typescript/lib/component/tree/Tree.ts#L92)), a pure `reduceModifierSelection` utility the three selection sites call, a shared `RowRenderer<TContext>` renderer base, and removes the dead code. It is the most invasive of the consolidation series and is sequenced in phases so the low-risk cleanups can land independently of the high-risk virtualization extraction.

`AbstractCustomList` ([list/AbstractCustomList.ts:587](src/typescript/lib/component/list/AbstractCustomList.ts#L587)) is a **third** row-pool implementation, but it is *native-overflow* (a `Panel` with `autoScroll: "y"` and a `VBox`), not `VirtualScroller`-backed — folding it into `VirtualRowView` is out of scope (see Non-Goals). It participates only in the selection-reducer and (partially) the renderer consolidation.

**Terminology is frozen** — `record`/`dataIndex` (Body), `node`/`flatRow` (Tree), `item`/`index` (List), and the class-name disambiguation are all owned by the `api-naming-harmonization` plan. This plan designs the shared base around an internal-only neutral vocabulary (`dataIndex`, `row`, `TRow`) and does **not** rename any public surface. See Architecture Decisions → *Naming is out of scope*.

---

## Architecture Decisions

### `VirtualRowView<TRow>` — the shared virtual-scroll base

Both `Body` and `Tree` today own an identical set of members (verified line-by-line, cosmetic diffs only):

| Concern | Body | Tree |
|---|---|---|
| `SCROLL_BUFFER = 2` | [:23](src/typescript/lib/component/table/Body.ts#L23) | [:29](src/typescript/lib/component/tree/Tree.ts#L29) |
| `computeVisibleWindow` | [:743](src/typescript/lib/component/table/Body.ts#L743) | [:1058](src/typescript/lib/component/tree/Tree.ts#L1058) |
| `computePoolTarget` | [:769](src/typescript/lib/component/table/Body.ts#L769) | [:1080](src/typescript/lib/component/tree/Tree.ts#L1080) |
| `growRowPool` (fragment batch, `setY(0)`, `setWillChange`, parallel-array push) | [:786](src/typescript/lib/component/table/Body.ts#L786) | [:1097](src/typescript/lib/component/tree/Tree.ts#L1097) |
| `hideExcessPoolRows` | [:921](src/typescript/lib/component/table/Body.ts#L921) | [:1217](src/typescript/lib/component/tree/Tree.ts#L1217) |
| `_rowGeom` translate write + displayed toggle | [:866-880](src/typescript/lib/component/table/Body.ts#L866) | [:1181-1209](src/typescript/lib/component/tree/Tree.ts#L1181) |
| `invalidateGeom` | [:375](src/typescript/lib/component/table/Body.ts#L375) | [:150](src/typescript/lib/component/tree/Tree.ts#L150) |
| `setScrollX` / `setScrollY` | [:634](src/typescript/lib/component/table/Body.ts#L634) / [:621](src/typescript/lib/component/table/Body.ts#L621) | [:703](src/typescript/lib/component/tree/Tree.ts#L703) / [:690](src/typescript/lib/component/tree/Tree.ts#L690) |
| Scroller construct + `ownedHandles`/`trackHandle` | [:569-581](src/typescript/lib/component/table/Body.ts#L569) | [:1242-1248](src/typescript/lib/component/tree/Tree.ts#L1242) |
| scroll-into-view (by index) | [:1521](src/typescript/lib/component/table/Body.ts#L1521) | [:667](src/typescript/lib/component/tree/Tree.ts#L667) |

Introduce `abstract class VirtualRowView<TRow extends Component, TOptions extends ComponentOptions = ComponentOptions> extends Component<TOptions>` between `Component` and each of `Body` / `Tree`. It owns the parallel-array pool state (`_rowPool`, `_boundIndices`, `_rowGeom`, `_rowDisplayed`, `_scroller`), the `SCROLL_BUFFER` constant, and the shared methods above. The pieces that genuinely differ are pushed to abstract/overridable hooks:

- **Row height** — `Body` derives it live from the theme line-box (`computeRowHeight`, [Body:168](src/typescript/lib/component/table/Body.ts#L168)); `Tree` uses a fixed `ROW_HEIGHT = 24`. The base reads it through `protected abstract getRowHeight(): number`.
- **Row construction** — `growRowPool`'s scaffolding is identical, but `Body` additionally wires each new row's cells (`setEditorPool`, `setScrollIntoViewHandler`, [:797-800](src/typescript/lib/component/table/Body.ts#L797)) and `Tree` just does `new TreeRow(factory)`. The base's `growRowPool` calls `protected abstract createPoolRow(): TRow`, which returns a fully-constructed, un-appended row; the base owns the fragment append + parallel-array bookkeeping + `setY(0)` + `setWillChange("transform")`.
- **Scroller onScroll callback** — `Tree` re-renders only; `Body` also emits `verticalscroll`/`horizontalscroll`. The base's `initScroller(el)` wires `() => this.onScrollerTick()`; `onScrollerTick()` defaults to `this.renderWindow()` and `Body` overrides it to add the emits.
- **`renderWindow` / bind+position** — stays subclass-specific and is **not** hoisted. The content-width derivation genuinely diverges: `Body` sizes rows to `max(bodyWidth, Σ columnWidths)` and lays out per-cell geometry against a `_cellGeom` cache it alone owns; `Tree` measures each row's natural content width (`_bindAndMeasure`) and sizes rows to `max(effectiveViewportWidth, maxContentWidth)`. Forcing these through one method would relocate complexity, not remove it (ARCHITECTURE → *Compose before specializing*). The base instead exposes the shared primitives each `renderWindow` calls: `computeVisibleWindow`, `computePoolTarget`, `growRowPool`, `positionRow(i, targetY, rowWidth): boolean` (the geom-write + displayed-toggle block), `hideExcessPoolRows`.

`invalidateGeom` moves to the base (clears `_rowGeom`); `Body` overrides it to `super.invalidateGeom()` then clear its extra `_cellGeom`. `TreeBody extends Body` is unaffected — the extraction adds no member to `Body`'s public/protected surface that `TreeBody` doesn't already see, and every hook `TreeBody` overrides (`getVisibleRecords`, `createRow`, `afterRowBound`, `onKeyDown`, `onSubtreeClick`, `computeRowAria`, `invalidateRowBindings`, `bindAndPositionRows`) stays on `Body`.

This is the core of the plan: ~150–200 lines of true duplication removed. It is also the **highest-risk** change — see *Characterization tests first*.

### Naming is out of scope

The shared base uses an internal neutral vocabulary (`dataIndex`, `row`, `TRow`, `getRowHeight`). It does **not** rename `Body._selectedRecords`, `Tree._flatRows`, `record`/`node`, or any public method — those belong to `api-naming-harmonization`. Where a base method needs a caller-supplied identity, it takes a generic type parameter rather than committing to either domain's noun. If `api-naming-harmonization` lands first, its renames flow into the already-extracted base with no structural change; if this plan lands first, the base's internal names are renamed by that plan like any other member. Either order works; no hard dependency in that direction.

### `reduceModifierSelection` — one pure reducer, three callers

The shift-range / ctrl-toggle / plain-replace ladder is written three times with identical semantics over different identity types:

- `Body.onRowClick` — `Set<ModelRecord>`, range resolved via `records.indexOf` ([:982-1009](src/typescript/lib/component/table/Body.ts#L982)).
- `Tree._handleClick` + `_rangeSelect` — `Set<TreeNode>`, range via `_flatRows.findIndex` ([:839-854](src/typescript/lib/component/tree/Tree.ts#L839), [:603-612](src/typescript/lib/component/tree/Tree.ts#L603)).
- `MultiSelectList.reduceSelection` — `Set<number>`, range over integer bounds, JSDoc says *"Ported verbatim from Body.onRowClick"* ([:197-224](src/typescript/lib/component/list/MultiSelectList.ts#L197)).

Extract a pure generic function that abstracts the identity key and the order lookup:

```typescript
// component/shared/reduceModifierSelection.ts (internal — not barrel-exported)
export function reduceModifierSelection<T>(
    selection: Set<T>,                 // mutated in place
    anchor: T | null,
    target: T,
    indexOf: (t: T) => number,         // position of a member in display order
    at: (i: number) => T,              // member at a display position
    ev: { ctrl: boolean; shift: boolean },
): T | null;                           // returns the new anchor; caller assigns
```

- **shift + anchor present**: `lo/hi = min/max(indexOf(anchor), indexOf(target))`; if `!ctrl` clear `selection`; add `at(i)` for `i` in `[lo, hi]`; **anchor unchanged** (matches all three — shift moves focus only).
- **ctrl**: toggle `target`; anchor := `target`.
- **plain**: clear; add `target`; anchor := `target`.

Callers keep their focus/`_focusedIndex`/`_focusNode` and notify logic (which legitimately differ) and pass the accessors: `Body` → `indexOf = r => records.indexOf(r)`, `at = i => records[i]`; `List` → `indexOf = i => i`, `at = i => i` (index-native, no allocation); `Tree` → `indexOf = n => flatRows.findIndex(r => r.node === n)`, `at = i => flatRows[i].node`. This is pure, dependency-free, and unit-testable without a DOM.

The reducer lives in a new **internal** module `component/shared/` (no existing dir; created here). It imports nothing from the component layer, so it needs no barrel/tsconfig subpath entry — the three consumers import it by relative path.

### Scroll-into-view is shared on the base; page-nav stays split

`Body.scrollRecordIntoView` ([:1521](src/typescript/lib/component/table/Body.ts#L1521)) and `Tree._scrollIntoView` ([:667](src/typescript/lib/component/tree/Tree.ts#L667)) have byte-identical bodies once row height is a hook: `top = index * rowHeight; bottom = top + rowHeight; …setScrollY(target)`. Hoist a `protected scrollRowIntoView(index: number): void` onto `VirtualRowView`; `Body.scrollRecordIntoView(record)` becomes a two-line wrapper (`index = getVisibleRecords().indexOf(record)` then delegate), `Tree` calls the base directly.

The **full keyboard handlers stay subclass-specific** (`Body.onKeyDown` has column nav + Enter-to-edit, `Tree._onKeyDown` has expand/collapse + parent-jump, `AbstractCustomList.handleNavigationKey` has type-ahead + select-follows-focus). Only the one-line `pageSize = max(1, floor(viewportH / rowHeight))` recurs; hoist it as `protected computePageSize(): number` on the base for `Body`/`Tree` and leave `List`'s copy (native-overflow, different scroll model) alone. `List`'s `scrollIndexIntoView` ([:1685](src/typescript/lib/component/list/AbstractCustomList.ts#L1685)) reads/writes native `scrollTop` and is **not** shared — it belongs to the native-overflow path, not `VirtualScroller`.

### `RowRenderer<TContext>` — one renderer base, two label renderers

`ListItemRenderer` and `TreeNodeRenderer` both are `Component` + `abstract update(context)` + `abstract layoutChildren(w, h)`; `TreeNodeRenderer` additionally declares `abstract getContentWidth()`. Introduce an **internal** `abstract class RowRenderer<TContext> extends Component` carrying `abstract update(context: TContext)` + `abstract layoutChildren(width, height)`. `ListItemRenderer = RowRenderer<ListItemRenderContext>`; `TreeNodeRenderer = RowRenderer<TreeNodeRenderContext>` adding `abstract getContentWidth()`. The two public names are unchanged (still exported from their barrels), so there is no public-API churn — `RowRenderer` is not exported.

The two default label renderers share their constructor (`clearInsets()` + a `Text` child with `clearInsets()` + `setAutoMeasure(false)`) and their `init()` (append the label). Extract a shared **internal** `abstract class LabelRowRenderer<TContext> extends RowRenderer<TContext>` owning the `_label: Text`, `getLabel()`, the constructor, and `init()`. `LabelListItemRenderer` and `LabelTreeNodeRenderer` keep only what genuinely differs: `update()` (Tree calls `_label.measure()`, List does not) and `layoutChildren()` (Tree sizes to `getContentWidth()` / natural width, List sizes to full `width`), plus Tree's `getContentWidth()`.

**Honest payoff assessment**: this dedup is *modest* (~25 lines of shared constructor+init per label renderer, and one merged abstract signature). The claim that the two Label renderers are "near-identical copies" overstates it — their `update`/`layoutChildren` genuinely diverge (measured natural width vs. stretch-to-fill). This phase is worth doing for coherence but is the lowest-value item and is safe to defer.

### `CellRenderer` is **not** folded in

The audit lists `CellRenderer` as a third near-identical renderer, but it is structurally different: it declares `abstract getValue(): T` / `abstract setValue(t: T)` (value-based binding), **not** `update(context)`. It is also deliberately kept structurally compatible with `CellEditor` so `BooleanCell` can reuse an editor as a renderer ([CellRenderer.ts:22-33](src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L22)). Merging it into `RowRenderer` would break that compatibility and conflate two different binding contracts. It stays as-is (Non-Goal).

### Bug 5 — remove the dead selection surface from `AbstractListComponent`

`AbstractListComponent.getSelectedIndex` / `setSelectedIndex` / `getSelectedValue` / `on("action")` / `off("action")` ([:107-176](src/typescript/lib/component/list/AbstractListComponent.ts#L107)) route through `DOM.source.getSelectedIndex` / `getSelectedOptionDataset` / `DOM.sink.setSelectedIndex`, which cast the element to `HTMLSelectElement` and read `.selectedIndex` ([DOM.ts:1353](src/typescript/lib/core/DOM.ts#L1353), [:1781](src/typescript/lib/core/DOM.ts#L1781), [:1786](src/typescript/lib/core/DOM.ts#L1786)). But `BulletedList` renders `<ul>` and `NumberedList` renders `<ol>` — neither has `.selectedIndex`, so the getters silently return `undefined`/`-1` and the setter writes a dead expando. This is a vestige of a former `<select>`-backed design.

**Decision: remove the selection surface** (both concrete lists, the `selectedIndex?` option on `AbstractListOptions`, and its `applyOptions` dispatch at [:67-69](src/typescript/lib/component/list/AbstractListComponent.ts#L67)). Justification: (a) zero real callers — the only consumer, `BorderPanel.ts`, merely constructs a `BulletedList`/`NumberedList` and never touches selection; the selectable list controls are `List`/`MultiSelectList` via `AbstractCustomList`, an entirely separate hierarchy; (b) `BulletedList`/`NumberedList` are presentational static lists (bullet/number chrome), not interactive selection controls — re-implementing selection against the `ListItem` children would be adding a feature nobody asked for (Simplicity-First); (c) a public getter that always returns `-1`/`undefined` and a setter that silently no-ops is a trap.

Removing the three call sites makes `DOM.source.getSelectedIndex`, `DOM.source.getSelectedOptionDataset`, and `DOM.sink.setSelectedIndex` orphans (grep confirms `AbstractListComponent` is their sole caller). Remove those seam methods and their interface declarations ([DOM.ts:673](src/typescript/lib/core/DOM.ts#L673), [:1066](src/typescript/lib/core/DOM.ts#L1066), [:1075](src/typescript/lib/core/DOM.ts#L1075)) **only after** confirming the test DOM stubs (`tests/dom/TestDOM`) don't also declare them; if they do, drop the stub rows too. These are *my* orphans (created by this change), so removing them is in scope.

### Bug 6 — cross-component `Event` listening in cells: documented carve-out, proper fix deferred

`Cell` listens on its child `editor`/`renderer` ([:74,81,84](src/typescript/lib/component/table/cell/Cell.ts#L74)), `CellEditorPool` on the shared `editor` ([:121,128](src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L121)), and `Combo`/`String`/`Number` editors on their private inner `_combo`/`_textField` ([Combo:65,69](src/typescript/lib/component/table/cell/editor/Combo.ts#L65), [String:26,29,36](src/typescript/lib/component/table/cell/editor/String.ts#L26), [Number:28,31,38](src/typescript/lib/component/table/cell/editor/Number.ts#L28)). Every site is `Event.addListener(otherComponent, …)` against a child the caller constructed — an ARCHITECTURE violation (*A component must not listen to another component's events through `Event`*, which is explicit that the local-child case still counts).

**Decision: document these as an explicit internal-wiring carve-out now; defer the proper typed-surface fix to a focused follow-up (Non-Goal here).** Rationale: the framework-consistent fix is to widen typed `on()` DOM shorthands (`"blur"` / `"keydown"` / `"input"` / `"dblclick"`) onto `TextField`, `ComboBox`, `CellEditor`, and `CellRenderer`, then route these sites through them. But `TextField` / `ComboBox` are **input** components owned by the in-flight `input-field-fixes-and-scaffolding-consolidation` plan — widening their event surface here would collide with that plan's ownership. Bundling a broad input-component API change into a virtualization refactor also violates Surgical-Changes. So: add a one-line carve-out comment at each site (`// Internal cell-editor wiring: listens on a privately-owned child; see ARCHITECTURE carve-out.`) and a short paragraph in `ARCHITECTURE.md` naming the cell-editor subsystem as the single accepted exception, with the typed-surface fix flagged as the intended end state. This is decisive and honest: the carve-out is provisional, not permanent.

### Bugs 7 & 8 — dead methods and inline-arrow listeners

`Body.sortColumns` (no-op, [:1279](src/typescript/lib/component/table/Body.ts#L1279)) and `Body.sortRows` (`throw Error("Not implemented yet.")`, [:1286](src/typescript/lib/component/table/Body.ts#L1286)) have zero callers (grep: only the unrelated `Header.sortColumns` and a `Row.ts` comment). Remove both — a public method that throws is a trap.

Inline-arrow listeners wrapping a named method violate *Listeners must reference a named function*. Convert to direct method references (the `Event` machinery applies via `listener.apply(component, …)`, so an unbound method ref is a stable, removable, grep-able reference — the pattern already used at [AbstractCustomList:685](src/typescript/lib/component/list/AbstractCustomList.ts#L685)):

- `Body`: `:588` (`onKeyDown`) and `:596` (`onSubtreeClick`) → direct refs; `:583` (focus listener with a two-statement body) → extract `private onFocus(): void` and pass the ref.
- `Tree`: `:1250`/`:1254`/`:1258`/`:1262` → `this._handleClick` / `this._handleContextMenu` / `this._handleDblClick` / `this._onKeyDown`.
- `TabBar`: `:726` → `this.onToolbarKeyDown`.

The `Body`/`Tree` listener wiring moves into `VirtualRowView`'s `init` during the phase-A extraction, so those direct-ref conversions ride along there; `TabBar:726` is a standalone one-line fix (unrelated to the base, same rule).

---

## Public API

No public API changes. All new types are internal (not barrel-exported):

```typescript
// component/shared/VirtualRowView.ts — internal base, not exported from any barrel
abstract class VirtualRowView<TRow extends Component, TOptions extends ComponentOptions = ComponentOptions>
    extends Component<TOptions>
{
    protected _rowPool: TRow[];
    protected _boundIndices: number[];
    protected _rowGeom: Array<{ ty: number; w: number; h: number } | null>;
    protected _rowDisplayed: boolean[];
    protected _scroller: VirtualScroller | null;

    protected abstract getRowHeight(): number;
    protected abstract createPoolRow(): TRow;      // constructed, not yet appended
    protected onScrollerTick(): void;              // default: this.renderWindow()

    protected initScroller(element: Handle): void; // construct + trackHandle
    setScrollX(x: number): this;
    setScrollY(y: number): this;
    protected computeVisibleWindow(scrollY: number, visibleHeight: number, totalRows: number):
        { firstRow: number; lastRow: number; windowSize: number };
    protected computePoolTarget(windowSize: number, visibleHeight: number, totalRows: number): number;
    protected computePageSize(): number;
    protected growRowPool(poolTarget: number): void;
    protected positionRow(slot: number, targetY: number, rowWidth: number): boolean; // returns geomChanged
    protected hideExcessPoolRows(windowSize: number): void;
    protected invalidateGeom(): void;
    protected scrollRowIntoView(index: number): void;
}
```

```typescript
// component/shared/reduceModifierSelection.ts — internal pure util
export function reduceModifierSelection<T>(
    selection: Set<T>, anchor: T | null, target: T,
    indexOf: (t: T) => number, at: (i: number) => T,
    ev: { ctrl: boolean; shift: boolean },
): T | null;
```

```typescript
// component/shared/RowRenderer.ts + LabelRowRenderer.ts — internal renderer bases
abstract class RowRenderer<TContext> extends Component {
    abstract update(context: TContext): void;
    abstract layoutChildren(width: number, height: number): void;
}
abstract class LabelRowRenderer<TContext> extends RowRenderer<TContext> {
    protected _label: Text;
    getLabel(): Text;
    protected init(element?: Handle): this;
}
```

`renderWindow` (Body) / `_renderWindow` (Tree) keep their exact current names and bodies (only their internal helper calls now resolve to the base).

---

## Ordered Implementation Steps

Phases are independent enough to land and verify separately. Recommended order A → B → C, with D optional.

### Phase A — `VirtualRowView` extraction (high value, high risk)

1. **Write characterization tests first** (before touching source) that pin the *current* behaviour of the virtual-scroll reconciliation for both `Body` and `Tree`: window bounds at top/middle/bottom scroll, pool grow target, rebind flags across a slide, hide-excess on shrink, geom-cache invalidation on width change, translate positions. The audit found these paths largely untested — extend `tests/component/table/Body.test.ts` and `tests/component/tree/Tree.test.ts` using the established white-box pattern (poke `_scroller` / `_lastColumnWidths`, drive `renderWindow`). Run green against `master`.
2. Create `component/shared/VirtualRowView.ts` with the pool state, `SCROLL_BUFFER`, and the shared methods (copy Body's bodies as the canonical form; they and Tree's are equivalent modulo row-height source). Add the abstract hooks.
3. Re-base `Body extends VirtualRowView<Row>`: delete the hoisted members, add `getRowHeight()` (returns `this._rowHeight`), `createPoolRow()` (its current `growRowPool` inner-loop row construction incl. cell wiring), override `onScrollerTick()` to add the scroll emits, override `invalidateGeom()` to also clear `_cellGeom`. Repoint `renderWindow` to the base helpers. `init` wires listeners via the base's `initScroller` + direct-ref listeners (folds in bug 8 for Body).
4. Re-base `Tree extends VirtualRowView<TreeRow, TreeOptions>`: same deletions; `getRowHeight()` returns the `ROW_HEIGHT` const; `createPoolRow()` returns `new TreeRow(this._rendererFactory)`; `_renderWindow` repointed to base helpers; `init` uses `initScroller` + direct-ref listeners (folds in bug 8 for Tree).
5. Hoist `scrollRowIntoView`; make `Body.scrollRecordIntoView` a wrapper and `Tree._scrollIntoView` a call to the base.
6. Verify: `TreeBody` compiles and its tests pass unchanged (it overrides only `Body` hooks). Typecheck + full test run + the phase-1 characterization tests still green.
   - Checkpoint: `grep -n "SCROLL_BUFFER\|computeVisibleWindow\|computePoolTarget" src/typescript/lib/component/table/Body.ts src/typescript/lib/component/tree/Tree.ts` — expect zero (moved to base).

### Phase B — selection reducer (medium value, medium risk)

7. Create `component/shared/reduceModifierSelection.ts`; unit-test it directly (pure, no DOM) against the three modifier combinations incl. empty-selection and out-of-range edges.
8. Route `Body.onRowClick`, `Tree._handleClick`/`_rangeSelect`, `MultiSelectList.reduceSelection` through it, preserving each caller's focus + notify logic. Their existing tests must stay green.

### Phase C — cheap, safe cleanups

9. Bug 7: delete `Body.sortColumns` / `Body.sortRows`. Checkpoint: `grep -rn "\.sortRows\|\.sortColumns" src/` — only `Header`/`Row` remain.
10. Bug 5: remove the selection surface + `selectedIndex` option from `AbstractListComponent`; then remove the now-orphaned `DOM.source.getSelectedIndex` / `getSelectedOptionDataset` / `DOM.sink.setSelectedIndex` (+ interface decls + any test-DOM stubs) after confirming no other caller.
11. Bug 8 (TabBar): `TabBar.ts:726` → direct method ref.
12. Bug 6: add the carve-out comments at the six cell/editor sites + the `ARCHITECTURE.md` paragraph.

### Phase D — renderer consolidation (low value, deferrable)

13. Create internal `RowRenderer<TContext>` and `LabelRowRenderer<TContext>`; re-base `ListItemRenderer`/`TreeNodeRenderer` on `RowRenderer`, and `LabelListItemRenderer`/`LabelTreeNodeRenderer` on `LabelRowRenderer`, keeping only their divergent `update`/`layoutChildren` (+ Tree's `getContentWidth`). Public names/exports unchanged. Verify `tests/component/list/renderer.test.ts` and `tests/component/tree/Tree.test.ts` (renderer cases) pass.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/shared/VirtualRowView.ts` |
| Create | `src/typescript/lib/component/shared/reduceModifierSelection.ts` |
| Create | `src/typescript/lib/component/shared/RowRenderer.ts` (Phase D) |
| Create | `src/typescript/lib/component/shared/LabelRowRenderer.ts` (Phase D) |
| Create | `tests/component/shared/reduceModifierSelection.test.ts` |
| Modify | `src/typescript/lib/component/table/Body.ts` (extends base; bugs 7, 8; selection reducer) |
| Modify | `src/typescript/lib/component/tree/Tree.ts` (extends base; bug 8; selection reducer) |
| Modify | `src/typescript/lib/component/list/MultiSelectList.ts` (selection reducer) |
| Modify | `src/typescript/lib/component/list/AbstractListComponent.ts` (bug 5 removal) |
| Modify | `src/typescript/lib/core/DOM.ts` (remove orphaned select seam methods) |
| Modify | `src/typescript/lib/component/container/TabBar.ts` (bug 8) |
| Modify | `src/typescript/lib/component/table/cell/Cell.ts` (bug 6 comment) |
| Modify | `src/typescript/lib/component/table/cell/editor/CellEditorPool.ts` (bug 6 comment) |
| Modify | `src/typescript/lib/component/table/cell/editor/{Combo,String,Number}.ts` (bug 6 comment) |
| Modify | `src/typescript/lib/component/list/ListItemRenderer.ts` + `tree/TreeNodeRenderer.ts` (Phase D) |
| Modify | `src/typescript/lib/component/list/renderer/Label.ts` + `tree/renderer/Label.ts` (Phase D) |
| Modify | `ARCHITECTURE.md` (bug 6 carve-out paragraph) |
| Modify | `tests/component/table/Body.test.ts`, `tests/component/tree/Tree.test.ts` (characterization) |
| Modify | `tests/dom/TestDOM.*` (drop select-seam stubs if present) |

---

## Expected Behaviour

Every behaviour below must be **identical to today** — this is a refactor, not a feature change. Derive tests from these before editing (test-first per the implement skill).

**Virtual-scroll window (unit-testable, Phase A)** — via the offline geometry oracle used by the existing tests:
- `computeVisibleWindow`: at scrollY = 0, `firstRow = 0`, `lastRow = min(totalRows-1, ceil(visibleHeight/rowHeight) + SCROLL_BUFFER)`; mid-scroll pads ±`SCROLL_BUFFER`; near the bottom `lastRow` clamps to `totalRows-1`; empty store → `windowSize = 0`.
- `computePoolTarget`: grows to the *max possible* window (`ceil(visibleHeight/rowHeight) + 2*SCROLL_BUFFER + 2`), capped at `totalRows`, never shrinking below the live `windowSize`.
- `growRowPool`: pool grows monotonically to `poolTarget`; each new row is appended once (via the fragment), pinned `setY(0)`, hinted `will-change: transform`, and parallel arrays (`_boundIndices=-1`, `_rowGeom=null`, `_rowDisplayed=false`) extend in lockstep. `Body`'s new rows carry wired cells (editor pool + scroll-into-view handler); `Tree`'s carry the current renderer factory.
- Rebind/rebind-skip: a slot rebinds (`setData`/`setRowData`) only when its `dataIndex` changes; a pure scroll that leaves a slot's index unchanged skips the rebind.
- `positionRow`: writes translate/size only when `_rowGeom[slot]` differs from the target; toggles `setDisplayed(true)` only on the false→true edge.
- `hideExcessPoolRows`: slots ≥ `windowSize` flip to `setDisplayed(false)` (once), reset `_boundIndices=-1` and `_rowGeom=null`.
- `invalidateGeom`: clears `_rowGeom` for all slots; `Body` additionally clears `_cellGeom`. Triggered by a body-width / column-width change (`Body`) or a row-width change (`Tree`).
- `scrollRowIntoView`: no movement when the row is already fully visible; scrolls to `top` when above the viewport, to `bottom - viewportHeight` when below; delegates through `VirtualScroller.setScrollY` so the header translate + scrollbar thumb stay in sync.

**Selection reducer (unit-testable, Phase B)** — for each of the three identity types, `reduceModifierSelection` produces the exact set + anchor as the current inline code:
- plain click → selection `= {target}`, anchor `= target`.
- ctrl click on unselected → adds `target`, anchor `= target`; on selected → removes `target`, anchor `= target`.
- shift click with anchor → range `[min, max]` over the anchor/target indices; when ctrl is absent the prior selection is cleared first, when present it is unioned; anchor unchanged.
- shift with no anchor → falls back to a plain single-target selection (matches current `_anchorIndex === null` guards).

**Renderer (unit-testable, Phase D)**: `LabelListItemRenderer.update` sets text without measuring and `layoutChildren` sizes the label to full `width`; `LabelTreeNodeRenderer.update` sets text *and* measures, `getContentWidth` returns the cached natural width, `layoutChildren` sizes to that width. Both centre the line-box via `setLineHeight(height)`.

**Bug removals (unit-testable, Phase C)**:
- `Body` no longer exposes `sortRows`/`sortColumns` (compile-time / reflection check).
- `AbstractListComponent` no longer exposes `getSelectedIndex`/`setSelectedIndex`/`getSelectedValue`/`on("action")`; `BulletedList`/`NumberedList` still render `<ul>`/`<ol>` and lay out their `ListItem` children unchanged.

**Needs manual verification (not offline-exercisable)** — drive the real app (dev server, `MiscPanel` table + a `Tree` demo + `BorderPanel` lists):
- Actual scroll pixels, fling momentum, and header/scrollbar sync during wheel + touch scroll of a large table and tree (transform positions are geometry-committed offline, but real paint + momentum are not).
- Keyboard nav landing the focused row inside the viewport (focus-scroll interaction).
- `TreeBody` drag-reparent (DnD reparent path is untested — smoke-test a drag after Phase A to confirm the row-pool rebind still re-wires the per-row drag source/target).
- Multi-modifier selection with real mouse + shift/ctrl on all three widgets.
- Cell in-place edit commit-on-blur (offline-untestable focus/blur) still works after the bug-6 comment-only change (behaviourally a no-op, but confirm nothing was disturbed).

---

## Verification

- `npm run build` / typecheck clean; `npm test` green (existing + new characterization + reducer unit tests).
- Phase-A checkpoint greps (see steps) confirm the duplicated members are gone from `Body`/`Tree`.
- `grep -rn "Event.addListener(this, .*=>\|addSubtreeListener(this, .*=>" src/typescript/lib/component/table/Body.ts src/typescript/lib/component/tree/Tree.ts src/typescript/lib/component/container/TabBar.ts` — expect no inline-arrow wrappers of named methods remain.
- `grep -rn "getSelectedIndex\|getSelectedOptionDataset\|setSelectedIndex" src/typescript/lib` — expect only `AbstractCustomList`'s own index-based `getSelectedIndex`/`setSelectedIndex` (unrelated to the removed `<select>` seam).
- `npm run docs:build` — zero warnings (Phase D touches exported renderer classes; confirm no `{@link}` breakage from the new internal bases).
- Manual smoke of the scroll/DnD/edit cases above in the dev app.

---

## Documentation Impact

Internal refactor for Phases A–C — no exported symbol added, renamed, or removed, so no doc-page changes. Phase D re-bases the exported `ListItemRenderer`/`TreeNodeRenderer`/`LabelListItemRenderer`/`LabelTreeNodeRenderer` on internal (`@internal`, non-exported) `RowRenderer`/`LabelRowRenderer` bases; keep the public JSDoc describing behaviour in prose rather than `{@link}`-ing the internal bases (CODE_CONVENTIONS → *Don't `{@link}` internal symbols*). Bug 5 removes public methods on `BulletedList`/`NumberedList` — grep `docs/` for `getSelectedIndex`/`getSelectedValue` on those classes and prune any reference. Bug 6 adds an `ARCHITECTURE.md` carve-out paragraph.

---

## Potential Challenges

- **`super()`-cascade field traps in the base.** `VirtualRowView`'s pool arrays are written by methods (`growRowPool`) that can run during a subclass's construction/first render, but they are plain fields not touched by a cascade-dispatched setter, so ordinary initializers are fine; the `_scroller` is only built in `init`. Confirm no base field is written by an `applyOptions`-dispatched setter (none is) — if that changes, use `declare` per CODE_CONVENTIONS.
- **`TreeBody` regression surface.** It overrides eight `Body` hooks and adds untested DnD; the extraction must not move any of those hooks off `Body`. Mitigation: the base holds only the scroll/pool scaffolding; every `TreeBody`-facing hook stays on `Body`. Run `TreeBody.test.ts` + a manual DnD smoke.
- **Row-height timing divergence.** `Body` recomputes `_rowHeight` on theme change and re-renders; `Tree` uses a const. `getRowHeight()` must read the live value each call (not cache in the base) so `Body`'s theme-change path keeps working.
- **`touches-shared` overlap with the clamp/timer/sentinel plan.** That plan migrates `VirtualScroller`'s three `Math.max(0, Math.min(...))` clamp sites ([:181](src/typescript/lib/component/container/VirtualScroller.ts#L181), [:206](src/typescript/lib/component/container/VirtualScroller.ts#L206), [:234](src/typescript/lib/component/container/VirtualScroller.ts#L234)) to `Util.clamp`. This plan constructs and wires `VirtualScroller` from the new base but does not edit its internals; the shared-file declaration + `depends-on` order the two so a concurrent edit doesn't conflict. Land the clamp plan first.
- **Reducer accessor allocation.** `List`'s `indexOf = i => i` / `at = i => i` are allocation-free; `Body`/`Tree` do an `indexOf` scan per click (already what the current inline code does) — no regression.

---

## Critical Files

- [`src/typescript/lib/component/table/Body.ts`](src/typescript/lib/component/table/Body.ts) — canonical virtual-scroll source; the base is copied from here.
- [`src/typescript/lib/component/tree/Tree.ts`](src/typescript/lib/component/tree/Tree.ts) — the second consumer; verify equivalence when hoisting.
- [`src/typescript/lib/component/table/TreeBody.ts`](src/typescript/lib/component/table/TreeBody.ts) — `extends Body`; the extraction must be invisible to it.
- [`src/typescript/lib/component/container/VirtualScroller.ts`](src/typescript/lib/component/container/VirtualScroller.ts) — the shared scroll machinery (read-only here; `touches-shared`).
- [`src/typescript/lib/component/list/AbstractCustomList.ts`](src/typescript/lib/component/list/AbstractCustomList.ts) — the native-overflow third pool (reducer consumer only).
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the event-handling rules governing bugs 6 & 8.
- [`tests/component/table/Body.test.ts`](tests/component/table/Body.test.ts), [`tests/component/tree/Tree.test.ts`](tests/component/tree/Tree.test.ts), [`tests/component/container/VirtualScroller.test.ts`](tests/component/container/VirtualScroller.test.ts) — the offline white-box patterns the characterization tests extend.

---

## Non-Goals

- **Folding `AbstractCustomList` into `VirtualRowView`.** It is native-overflow, not `VirtualScroller`-backed; unifying the two scroll models is a separate, larger effort. It participates only in the selection-reducer (and optionally renderer) consolidation.
- **Merging `CellRenderer` into `RowRenderer`.** Different (value-based) binding contract and deliberate `CellEditor` structural compatibility.
- **The proper typed-surface fix for bug 6.** Deferred to a follow-up jointly scoped with `input-field-fixes-and-scaffolding-consolidation` (widening `TextField`/`ComboBox` event surfaces); this plan only documents the carve-out.
- **Any public rename** (`record`/`node`/`item`, class disambiguation) — owned by `api-naming-harmonization`.
- **Migrating `VirtualScroller`'s clamp sites to `Util.clamp`** — owned by `shared-clamp-timer-size-sentinel-utils` (this plan's `depends-on`).
- **Sharing the full keyboard handlers or List's native `scrollIndexIntoView`** — their key maps and scroll mechanisms genuinely differ; only `pageSize` and the `VirtualScroller`-based scroll-into-view are shared.
