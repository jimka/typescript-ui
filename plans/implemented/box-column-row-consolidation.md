# HBox/Column + VBox/Row Consolidation — Implementation Plan

## Overview

Today the layout package ships four single-axis managers that solve overlapping problems with diverging APIs: `HBox` + `Column` arrange children horizontally; `VBox` + `Row` arrange them vertically. The split inside each pair is the sizing strategy, not the geometry — `HBox` ([HBox.ts:259](../src/typescript/lib/layout/HBox.ts#L259)) gives each child its preferred width and supports `weight` cells, `Column` ([Column.ts:284](../src/typescript/lib/layout/Column.ts#L284)) divides the container width into equal cells; `VBox` and `Row` mirror that distinction along the Y axis. Two managers carry shrink-on-overflow logic; the other two do not. Two use `spacing`; the other two use `gap`. One (`VBox`) still has a legacy two-arg constructor.

This plan **collapses each axis pair into a single manager**, controlled by a `mode: "preferred" | "equal"` option. `HBox` absorbs `Column`'s equal-share path; `VBox` absorbs `Row`'s. The class names `Column` / `Row` (and their options interfaces) are **removed**, not deprecated — the framework has exactly one non-demo caller ([Tab.ts:15](../src/typescript/lib/layout/Tab.ts#L15) imports `Column`); `Row` has zero. The two demo files ([ColumnPanel.ts](../src/typescript/ColumnPanel.ts), [RowPanel.ts](../src/typescript/RowPanel.ts)) migrate to `HBox({ mode: "equal" })` / `VBox({ mode: "equal" })`.

Default `mode` is `"preferred"`, which preserves today's `HBox` / `VBox` behaviour byte-for-byte for the 26 existing call sites. The equal-share branch is the *new* behaviour these managers gain; it lives behind the explicit flag.

---

## Architecture Decisions

### Two managers, one per axis — not one `Box(orientation)`

Horizontal vs. vertical isn't a flag-controlled tweak; it's fundamentally different geometry (different size computation, different baseline semantics, different weight axis). Merging both axes behind one class would force every consumer through a runtime branch on `orientation` for properties that don't share meaning — `weight` along X for `HBox`, along Y for `VBox`; baseline alignment in `HBox` only ([HBox.ts:390](../src/typescript/lib/layout/HBox.ts#L390)); the row-metrics helpers on `LayoutManager` ([LayoutManager.ts:423](../src/typescript/lib/layout/LayoutManager.ts#L423)) are horizontal-specific by design. The existing names also dominate usage (HBox 17 imports + VBox 9 imports vs. Column 1 + Row 0), so keeping `HBox` / `VBox` is the lowest-churn path.

### `mode: "preferred" | "equal"` selects the sizing strategy

A string union, written as a public typed setter `setMode(mode)` and an options bag field. `"preferred"` is the default — each child gets its preferred size along the main axis, `weight` cells split the remainder, and an overflow-shrink path applies (the existing `HBox` / `VBox` behaviour). `"equal"` divides the container's inner extent equally among children, clamps the per-cell floor to `max(child.minSize)` along the main axis (today's `Column` behaviour), and ignores `weight` constraints. The two modes share `spacing`, `stretching`, the overflow-flag wiring, and the surrounding container/insets math; only the inner per-child sizing loop branches.

Rejected: a `Strategy`-object plug-in (`HBox({ strategy: new PreferredSizing() })`). Two modes don't justify the indirection — a single inner branch in `doLayout` is shorter and easier to follow than two strategy classes that share most of the surrounding code.

### Stretching default depends on mode

Today `HBox`/`VBox` default to `stretching: false`; `Column` defaults to `stretching: true`; `Row` is always stretching (no option). To preserve every existing call site, the default depends on `mode`:

- `mode: "preferred"` → `stretching: false` (matches HBox/VBox today)
- `mode: "equal"` → `stretching: true` (matches Column today; matches Row's behaviour, which had no option)

An explicit `stretching` value in the options bag always wins. The two demo panels both pass an explicit `stretching` value during migration so the default change is irrelevant for them.

### `spacing` survives; `gap` is dropped

`HBox`/`VBox` use `spacing` (3+ callsites); `Column`/`Row` use `gap`. Pick one name: `spacing`. The single non-demo `Column` import in `Tab.ts` doesn't pass `gap`, so no callsite has to change names. Inside the merged class the field stays `_spacing` and the accessor stays `getComponentSpacing`/`setComponentSpacing` — those are the names with existing call sites.

### `set*` does not call `doLayout`

`Column.setGap` calls `this.doLayout()` ([Column.ts:71](../src/typescript/lib/layout/Column.ts#L71)); `Row.setGap` calls `this.doLayout()` ([Row.ts:65](../src/typescript/lib/layout/Row.ts#L65)); `HBox.setComponentSpacing` / `setStretching` do not ([HBox.ts:70](../src/typescript/lib/layout/HBox.ts#L70), [HBox.ts:90](../src/typescript/lib/layout/HBox.ts#L90)); neither does `VBox`'s. The merged setter follows the `HBox`/`VBox` convention — setters store, the container re-lays out the next time it's asked to. The two `Column`/`Row` callsites that mutate at runtime are zero (grep confirms no `setGap` outside the class itself), so the change is internal.

### `VBox`'s legacy two-arg constructor is removed

`VBox(spacing?: number | VBoxOptions, options?: VBoxOptions)` ([VBox.ts:30](../src/typescript/lib/layout/VBox.ts#L30)) supports both `new VBox(8)` and `new VBox({ spacing: 8 })`. Every existing call site uses the options-bag form (grepped). The merged class takes options only, matching `HBox` / `Column` / `Row`.

### Column / Row are deleted, not deprecated

A deprecation shim (re-export `Column` as `HBox` with `mode: "equal"`) would add two more files with no maintenance upside — the names are unique enough (the table-cell `Row` / `Column` live in `component/table/` and aren't affected) and the framework has exactly one internal caller plus two demo files. Deleting the source files surfaces any stray external caller as a compile error, which is the right behaviour for a `0.x` framework. Tab's internal `Column` import switches to `HBox({ mode: "equal" })` ([Tab.ts:15](../src/typescript/lib/layout/Tab.ts#L15)); the demo panels switch in lock-step.

### `computeTotalMinSize` branches on mode

The min-size totals differ by mode (and are read by the universal-scroll path described in `plans/implemented/layout-system-overhaul.md`):

- `"preferred"` (HBox today, [HBox.ts:226](../src/typescript/lib/layout/HBox.ts#L226)): width = `sum(child.minSize.width) + spacing*(n−1)`, height = `max(child.minSize.height)`.
- `"equal"` (Column today, [Column.ts:247](../src/typescript/lib/layout/Column.ts#L247)): width = `n * max(child.minSize.width) + spacing*(n−1)`, height = `max(child.minSize.height)`.

VBox / Row swap width and height. The branch lives inside `computeTotalMinSize` itself.

### Public API audit: `weight` cells are documented as preferred-mode only

`LayoutConstraints.weight` is consulted in `HBox.doLayout` / `VBox.doLayout`. In `"equal"` mode it's silently ignored (today's `Column`/`Row` behaviour). Document this in the new `HBoxOptions` JSDoc: weight is honoured only when `mode === "preferred"`. Don't throw — callers that mix `weight` with equal mode get a no-op, matching today's `Column`.

---

## Public API (TypeScript Signatures)

```typescript
/** Sizing strategy along the main axis. */
export type BoxMode = "preferred" | "equal";

/**
 * Construction-time options for HBox.
 *
 * `mode: "preferred"` — each child gets its preferred width; weight cells
 * split the remainder; overflow triggers the shrink-to-min path.
 * `mode: "equal"` — children split the container width equally; per-cell
 * floor is `max(child.minSize.width)`; weight constraints are ignored.
 */
export interface HBoxOptions extends LayoutManagerOptions {
    spacing?:    number;
    stretching?: boolean;   // default depends on mode: false for "preferred", true for "equal"
    mode?:       BoxMode;   // default "preferred"
}

class HBox extends LayoutManager {
    constructor(options?: HBoxOptions);

    getComponentSpacing(): number;
    setComponentSpacing(spacing: number): this;

    isStretching(): boolean;
    setStretching(stretching: boolean): this;

    getMode(): BoxMode;
    setMode(mode: BoxMode): this;

    getPreferredSize(): Size | null;
    getMinSize():       Size | null;
    getMaxSize():       Size | null;
    doLayout(): void;
}
```

`VBox` / `VBoxOptions` mirror exactly the same surface, with `spacing` between rows and the equal-mode floor clamped to `max(child.minSize.height)` instead.

`Column`, `ColumnOptions`, `Row`, `RowOptions` are removed from `src/typescript/lib/layout/index.ts`.

---

## Internal Structure

`HBox.doLayout` after consolidation, in pseudo-code:

```
sync container/insets/overflow inflation             (shared)
if mode === "equal":
    cellWidth = clamp(equalShare, maxChildMinWidth)  (Column path today)
    place children at uniform cellWidth, +spacing
else /* "preferred" */:
    compute fixedPreferredWidth, fixedMinWidth, totalWeight
    shrinkRatio = computeShrink(fixedPreferredWidth, containerSize)
    place children with per-child preferred width
        + weight share of remainingWidth                (HBox path today)
height-and-baseline placement is shared between modes  (HBox path today,
    extended into equal mode — Column today already calls
    computeRowMetrics when !stretching, so the merge is a no-op)
```

The two branches share: container-size lookup, overflow inflation, height/baseline computation (already split into `computeRowMetrics` / `computeRowHeight` on `LayoutManager`), the final `placeComponent` call.

`getPreferredSize` / `getMinSize` / `getMaxSize` use the same shape: per-mode width loop, shared height computation. The `"equal"` width formula is `count * maxChildWidth + spacing*(n−1)` (today's `Column` formula); the `"preferred"` formula is `sum(childWidth) + spacing*(n−1)` (today's `HBox`).

---

## Ordered Implementation Steps

### Step 1 — Add `BoxMode` and extend `HBoxOptions` / `VBoxOptions`

In [HBox.ts](../src/typescript/lib/layout/HBox.ts) and [VBox.ts](../src/typescript/lib/layout/VBox.ts):

- Add `export type BoxMode = "preferred" | "equal"`.
- Extend the `*Options` interfaces with `mode?: BoxMode`.
- Add private `_mode: BoxMode = "preferred"`.
- Add `getMode()` / `setMode(mode)` typed setter following the framework's setter convention (cache the field, no DOM write, no `doLayout` call — the container schedules layout when it's added).
- Wire `mode` through `applyOptions` *before* the `stretching` dispatch, so the stretching default can read the resolved mode.
- Compute the stretching default from `mode`: in `applyOptions`, set the initial `_stretching` to `mode === "equal"` if the options bag does not pass `stretching`. The explicit options bag value always wins.

Verify: `tsc --noEmit` passes; no behaviour change yet (no `doLayout` reads `_mode`).

### Step 2 — Branch the inner sizing loop in `HBox.doLayout` / `VBox.doLayout`

In each manager's `doLayout`:

- After the existing container/insets/overflow setup, branch on `this._mode`.
- `"equal"` branch: lift the Column body verbatim — the `equalShare` / `maxChildMinWidth` clamp and the uniform cell placement at [Column.ts:317-396](../src/typescript/lib/layout/Column.ts#L317-L396). The stretching/baseline placement at the tail of that method already matches the shared helpers on `LayoutManager`.
- `"preferred"` branch: the existing HBox/VBox body, unchanged.
- VBox: identical structure with the Y-axis equivalent (lift Row's body from [Row.ts:232-277](../src/typescript/lib/layout/Row.ts#L232-L277), preserving the `containerSize.width` width and the equal-share height clamped to `maxChildMinHeight`).

Verify: HBox/VBox demos render identically (default mode); new equal-mode call sites added in step 5 render identically to the old Column/Row demos.

### Step 3 — Branch `getPreferredSize` / `getMinSize` / `getMaxSize`

In each method, branch on `this._mode`:

- `"equal"`: the formulas at [Column.ts:104-235](../src/typescript/lib/layout/Column.ts#L104-L235) (preferred-size = `count*(maxChild+gap) − gap`; min-size symmetric; max-size symmetric).
- `"preferred"`: the existing HBox/VBox formulas.

Mirror for VBox using Row's formulas at [Row.ts:76-188](../src/typescript/lib/layout/Row.ts#L76-L188).

### Step 4 — Branch `computeTotalMinSize`

`HBox.computeTotalMinSize` today computes sum-of-min for X, max-of-min for Y ([HBox.ts:226](../src/typescript/lib/layout/HBox.ts#L226)). Add a `"equal"` branch returning `count * maxChildMinWidth + spacing*(n−1)` on X, `max(child.minHeight)` on Y (today's `Column.computeTotalMinSize`). Mirror in VBox using Row's equal totals.

### Step 5 — Migrate `Tab.ts` from `Column` to `HBox`

In [Tab.ts:15](../src/typescript/lib/layout/Tab.ts#L15), change:

- `import { Column } from "~/layout/Column.js";` → `import { HBox } from "~/layout/HBox.js";`
- Every `new Column(...)` / `Column(...)` callsite → `new HBox({ mode: "equal", ...currentColumnOptions })`. (Grep `Column` inside `Tab.ts` first — there should be one or two usage sites in the toolbar wrapper.)

Verify: `npm run docs:dev` Tab demo renders identically; tab toolbar lays out as before.

### Step 6 — Migrate demos

- [ColumnPanel.ts:11-14](../src/typescript/ColumnPanel.ts#L11-L14): `new Column({ stretching: false })` → `new HBox({ mode: "equal", stretching: false })`. Update the import line.
- [RowPanel.ts:11](../src/typescript/RowPanel.ts#L11): `new Row()` → `new VBox({ mode: "equal" })` (equal-mode default is `stretching: true`, matching today's Row).
- The demo labels in [main.ts:36-37](../src/typescript/main.ts#L36-L37) (`"Row"`, `"Column"`) stay as-is — the demo *names* document the equal-mode preset for users browsing the catalogue.

Verify: Row, Column demos render identically.

### Step 7 — Delete `Column.ts`, `Row.ts`, `ColumnOptions`, `RowOptions`

Delete:
- `src/typescript/lib/layout/Column.ts`
- `src/typescript/lib/layout/Row.ts`

Remove from `src/typescript/lib/layout/index.ts`:
- `export { Column } from '~/layout/Column.js';`
- `export type { ColumnOptions } from '~/layout/Column.js';`
- `export { Row } from '~/layout/Row.js';`
- `export type { RowOptions } from '~/layout/Row.js';`

Regression checkpoint: `grep -rn 'lib/layout/Column\|lib/layout/Row\b\|ColumnOptions\|RowOptions' src/` — expect zero matches outside `src/typescript/lib/component/table/` (the table's `Row`/`Column` classes are unrelated and live in `component/table/`).

### Step 8 — Remove `VBox`'s legacy two-arg constructor

Replace [VBox.ts:30-42](../src/typescript/lib/layout/VBox.ts#L30-L42) with the HBox-style single-options constructor:

```typescript
constructor(options?: VBoxOptions) {
    super();
    if (options) {
        this.applyOptions(options);
    }
}
```

Grep `new VBox(` to confirm no remaining call site passes a bare number. (All audited usage today passes either `new VBox()` or `new VBox({ ... })`.)

### Step 9 — Update documentation

- Delete `docs/layouts/Column.md`, `docs/layouts/Row.md`.
- Update `docs/layouts/HBox.md` and `docs/layouts/VBox.md` to document `mode`; cover both modes with a side-by-side example. Carry over the diagrams and stretching notes from the old `Column.md` / `Row.md` into the equal-mode sections.
- Update `docs/layouts/index.md` catalog: drop the `Column` and `Row` rows; expand the `HBox`/`VBox` descriptions to mention the `mode` option.
- Update [docs/.vitepress/config.mts:148-151](../docs/.vitepress/config.mts#L148-L151): remove the `Row` and `Column` sidebar entries.

### Step 10 — Final verification

- `tsc --noEmit` passes.
- `npm run docs:build` produces 0 errors and 0 link warnings (the typedoc "unsupported TypeScript version" notice is the only acceptable warning).
- `grep -rn '\bColumn\b\|\bRow\b' src/typescript/lib/layout/` — expect zero matches.
- Manually open the HBox, VBox, Row, Column, Tab, and Baseline demos; confirm identical rendering to the pre-change build (load each demo via `npm run dev`, side-by-side with a `git stash`'d main if a regression is suspected).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/HBox.ts` |
| Modify | `src/typescript/lib/layout/VBox.ts` |
| Modify | `src/typescript/lib/layout/Tab.ts` |
| Modify | `src/typescript/lib/layout/index.ts` |
| Modify | `src/typescript/ColumnPanel.ts` |
| Modify | `src/typescript/RowPanel.ts` |
| Modify | `docs/layouts/HBox.md` |
| Modify | `docs/layouts/VBox.md` |
| Modify | `docs/layouts/index.md` |
| Modify | `docs/.vitepress/config.mts` |
| Delete | `src/typescript/lib/layout/Column.ts` |
| Delete | `src/typescript/lib/layout/Row.ts` |
| Delete | `docs/layouts/Column.md` |
| Delete | `docs/layouts/Row.md` |

---

## Verification

- `tsc --noEmit` — clean.
- `npm run docs:build` — 0 errors, 0 link warnings.
- `grep -rn "from \"~/layout/Column\|from \"~/layout/Row\b" src/` — zero matches (table's `Row`/`Column` use `~/component/table/` paths, so this grep is unambiguous).
- `grep -rn "ColumnOptions\|RowOptions" src/` — zero.
- Demo screens — open each of these tabs from the dev app and confirm identical rendering vs. `master` build:
  - `HBox`, `VBox` (preferred mode, unchanged path)
  - `Column`, `Row` (now backed by `HBox({ mode: "equal" })` / `VBox({ mode: "equal" })`)
  - `Tab` (internal `Column` switched to `HBox({ mode: "equal" })`)
  - `Baseline` (HBox-driven; covers stretching off + baseline alignment regression check)
  - `Misc` (heavy HBox / VBox user — quick smoke check on a panel that already stresses the preferred-mode path).
- Theme toggle — flip light/dark on each demo above to confirm nothing in the consolidation accidentally bypassed a token.

---

## Documentation Impact

- Public surface change: two interface deletions (`ColumnOptions`, `RowOptions`), two class deletions (`Column`, `Row`), two new fields (`mode`) on `HBoxOptions` / `VBoxOptions`, two new typed setters (`getMode` / `setMode`) on `HBox` / `VBox`.
- Per-subpath barrel: update `src/typescript/lib/layout/index.ts` — remove the four Column/Row exports; the `HBox` / `VBox` exports stay.
- Curated pages: delete `docs/layouts/Column.md` and `docs/layouts/Row.md`; expand `docs/layouts/HBox.md` and `docs/layouts/VBox.md` to cover the new `mode` field with examples of both modes (the equal-mode example should match the deleted `Column.md` content). Update `docs/layouts/index.md` catalog. Update the sidebar in `docs/.vitepress/config.mts`.
- Cross-bucket JSDoc references: search `grep -rn '@link Column\|@link Row\b' src/` — any survivors must be rewritten to plain prose or to `@link HBox` / `@link VBox`. `Column` and `Row` are colliding names (table cell classes also exist), so the doc-conventions reference at `.claude/skills/_shared/docs-conventions.md` applies: prefer explicit `[\`HBox\`](/api/layout/classes/HBox)` form in JSDoc when crossing buckets.
- After `npm run docs:build`, verify the layout subpath bundle no longer ships `Column` / `Row` entries.

---

## Potential Challenges

- **Baseline alignment in equal-mode**. `Column` today already routes through `computeRowMetrics` when stretching is off ([Column.ts:362](../src/typescript/lib/layout/Column.ts#L362)). After consolidation the same path runs from `HBox({ mode: "equal" })`. Verify the Baseline demo's row-of-text under `Column` looks identical pre/post — if it doesn't, the issue is that the equal-mode branch is calling `computeRowMetrics` with `widths` derived from the equal-share, not the preferred sizes (intentional — Column today does the same).
- **Tab toolbar regression**. `Tab.ts` uses `Column` for its toolbar layout; the equal-share width clamp on the toolbar might change tab-button widths if `maxChildMinWidth` is much larger than the equal share. Pre/post screenshot of a tab strip with three short labels and one long label should be byte-identical. If it isn't, the root cause is the `maxChildMinWidth` clamp at [Column.ts:317-323](../src/typescript/lib/layout/Column.ts#L317-L323), which is the same code that already runs in `Column` today — the regression is *pre-existing*, not introduced by consolidation.
- **Universal-scroll path** (per `plans/implemented/layout-system-overhaul.md`). Equal-mode `computeTotalMinSize` returns a *larger* total than preferred-mode (`n * max` vs `sum`). A host `Panel` with `autoScroll: "auto"` switching its inner layout from `Column` → `HBox({ mode: "equal" })` should keep showing the same scrollbar. The migration in step 5 doesn't touch the host Panel's `autoScroll` setting; the inflation math is preserved verbatim.
- **`VBox` two-arg constructor removal**. A search for `new VBox(` confirms no caller passes a bare number, but a fresh `grep -rn 'new VBox(' src/` immediately before step 8 lands is cheap insurance against a recent commit. Same for `new VBox\(\s*\d` to catch numeric literal positional calls.

---

## Critical Files

- `src/typescript/lib/layout/HBox.ts` (read in full — every step modifies it)
- `src/typescript/lib/layout/VBox.ts`
- `src/typescript/lib/layout/Column.ts` (read first; its body lifts into HBox's equal-mode branch)
- `src/typescript/lib/layout/Row.ts` (mirror for VBox)
- `src/typescript/lib/layout/LayoutManager.ts` (`computeRowMetrics`, `computeRowHeight`, `placeComponent` — shared helpers)
- `src/typescript/lib/layout/Tab.ts` (only non-demo `Column` caller)
- `src/typescript/lib/layout/index.ts` (export surface)
- `src/typescript/ColumnPanel.ts`, `src/typescript/RowPanel.ts` (demos)
- `docs/layouts/HBox.md`, `docs/layouts/VBox.md`, `docs/layouts/Column.md`, `docs/layouts/Row.md`, `docs/layouts/index.md`, `docs/.vitepress/config.mts`

---

## Non-Goals

- **No `Box(orientation: "h" | "v")` single class.** Horizontal and vertical have meaningfully different sizing (weight axis, baseline alignment, row-metrics helpers) and the existing names dominate usage. Merging the axes too is a different plan and the user didn't ask for it.
- **No `Grid` consolidation.** `Grid` has its own per-cell coordinate system and isn't an equal-share single-axis manager.
- **No deprecation shim for `Column` / `Row`.** Names are deleted in step 7. The framework is pre-1.0 and the surface area is tiny; a typecheck failure on a stray external caller is the right signal.
- **No `gap` → `spacing` migration on external consumer code.** The only callers that pass `gap` are inside `Column.ts` / `Row.ts` and the deleted unit tests; the field name in the merged options bag is `spacing`. No alias.
- **No change to `LayoutConstraints.weight`.** Weight stays a preferred-mode-only concept; equal-mode silently ignores it (today's Column behaviour). A future plan could add an "equal with weight overrides" branch but it's out of scope here.
