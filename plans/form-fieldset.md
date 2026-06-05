# FormFieldSet — Implementation Plan

## Overview

`FormFieldSet` formalises the hand-rolled labelled-form pattern in the Binding demo ([BindingPanel.ts:140-196](../src/typescript/BindingPanel.ts#L140)) into a reusable container. It is a [`FieldSet`](../src/typescript/lib/component/container/FieldSet.ts) with a **required** title (the legend) whose content is one or more **columns**, each holding **rows** of a title/field pair: a label [`Text`](../src/typescript/lib/component/input/Text.ts) next to an input `Component`, baseline-aligned so the label sits on the input's baseline. It generalises the demo's single two-column grid to **N** independent columns of title/field pairs sitting side by side, plus full-width rows that span all columns (the demo's status line and button bar use `GridConstraints.colSpan = 2`).

It lives at `src/typescript/lib/component/container/FormFieldSet.ts`, extends `_FieldSet`, and is exported from the container barrel ([index.ts](../src/typescript/lib/component/container/index.ts)). It touches only that new file, the barrel, a new docs page, the docs catalog/sidebar, and (optionally) a demo screen.

The base `FieldSet` already owns the legend, legend clearance, `getMinSize` augmentation, and `getPerimiterSize` ([FieldSet.ts:55-236](../src/typescript/lib/component/container/FieldSet.ts#L55)); `FormFieldSet` adds only the internal form layout and the field-building API on top.

---

## Architecture Decisions

### Internal layout — one Grid with `2 × columns` grid-columns, not N sub-containers

A single [`Grid`](../src/typescript/lib/layout/Grid.ts) with `baselineAlign: true` and `2 × columns` grid-columns is the layout. For `C` columns the `columnTracks` repeat the demo's pair — `{mode:"content"}` (titles hug) then `{mode:"weight", value:1}` (inputs take slack) — `C` times. Reasons:

- **Reuses the exact machinery the demo proves.** The demo is a 2-column baseline grid ([BindingPanel.ts:151-161](../src/typescript/BindingPanel.ts#L151)); a `2C`-column grid is the same code path. `Grid.doLayout`'s baseline branch already auto-flows by `colSpan` and baseline-aligns each row ([Grid.ts:632-724](../src/typescript/lib/layout/Grid.ts#L632)), and `measureContent`/`resolveTracks` already size `"content"` columns independently per column index ([Grid.ts:796-842](../src/typescript/lib/layout/Grid.ts#L796)). N independent `content` title tracks therefore size independently for free.
- **Row alignment across columns is a feature here, not a bug.** Baseline mode computes one ascent/descent per *grid row* across all cells in that row ([Grid.ts:681-723](../src/typescript/lib/layout/Grid.ts#L681)), so a label in form-column 0 and a label in form-column 1 on the same visual row share a baseline. That is the desired "rows line up across columns" look. The N-sub-container alternative (an `HBox` of N independent 2-col grids) would let each sub-grid drift vertically and break cross-column row alignment, and would need extra plumbing for full-width spanning rows. Rejected.
- **Spanning rows fall out of `colSpan`.** A full-width row is one cell with `colSpan = 2 × columns`; the grid's baseline auto-flow already honours `colSpan` ([Grid.ts:660-676](../src/typescript/lib/layout/Grid.ts#L660)), exactly as the demo's `spanBothColumns()` does ([BindingPanel.ts:179-196](../src/typescript/BindingPanel.ts#L179)).

**Row count.** The grid needs an explicit `rows` value (baseline auto-flow advances `flowRow` and stops at `rows` — [Grid.ts:655](../src/typescript/lib/layout/Grid.ts#L655)). `FormFieldSet` tracks the running row count internally and re-sets `rows` + `rowTracks` (all `{mode:"content"}`) on the grid whenever a row is added, so callers never hand-maintain a `FORM_ROW_COUNT` constant the way the demo does ([BindingPanel.ts:149](../src/typescript/BindingPanel.ts#L149)). The grid's `columns` is `2 × columns`.

### Column flow model — a row fills column 0 first, then column 1, …

With one grid, "column" is a logical pair of grid-columns. A title/field pair added to logical column `k` occupies grid-columns `2k` (title) and `2k+1` (input). Because the baseline path auto-flows left-to-right by `colSpan` and only advances `flowRow` when `flowCol >= cols` ([Grid.ts:671-676](../src/typescript/lib/layout/Grid.ts#L671)), a row that is meant to place a pair in *every* column is simply the pairs added consecutively until the row fills. To let a caller target a specific column while leaving others on that row empty, `FormFieldSet` pads with spacer cells: when a row is committed, any logical columns not filled by the caller get an empty placeholder pair so the next row starts at grid-column 0. This keeps the auto-flow model intact (no explicit `col`/`row`, which baseline mode does not support — [Grid.ts:636](../src/typescript/lib/layout/Grid.ts#L636)).

Given the demo's actual usage (every row fills both columns, then full-width spans), the **primary** `addField(title, component)` auto-flows pair-by-pair, and a row-oriented `addRow([...pairs])` / the declarative `rows` descriptor is how a caller fills a multi-column row deterministically. Per-column targeting beyond "fill row left-to-right" is intentionally minimal (see Non-Goals).

### Declarative and imperative share one internal add path

The options bag does **not** route through the inherited `applyOptions` `components` path — that would drop raw cells into the grid in document order with no titles. Instead `FormFieldSet` reads its *own* new options (`columns`, `rows`/`fields`) in the **constructor body** (after `super()`), translating each descriptor into the same internal `addField` / `addFullWidth` calls the imperative API uses. This sidesteps two traps:

- **Class-field super-cascade trap** ([memory](../../.claude/projects/-home-jika-typescript-typescript/memory/feedback_class_field_super_trap.md)): the running-row-count and grid backing fields are written in the constructor body, after `super()` has returned, so they need no `declare` gymnastics — but the grid reference assigned by the constructor must be declared with `declare` if any setter that runs during `super()`'s `applyOptions` cascade could touch it. It cannot (the new options are read in the body, not `applyOptions`), so plain initialisers are safe. The grid itself is created and installed in the constructor body.
- **Setter-defer-DOM-work trap** ([memory](../../.claude/projects/-home-jika-typescript-typescript/memory/feedback_setter_defer_dom_work.md)): building the form (creating `Text` labels, `addComponent`) happens in the constructor body, never inside an `applyOptions`-dispatched setter, so no setter forces `getElement(true)` during `super()`.

The new `FormFieldSetOptions` fields are therefore **consumed in the constructor**, not wired into `applyOptions`. They are construction-only form structure, matching "construct via options bag" while staying off the runtime-setter path. No new typed runtime *setter* is needed (titles/fields are structural, added once); the only public mutator is `addField` / `addRow`, which mirror `addComponent`.

### Column count is fixed at construction

`columns` (logical column count, default `1`) is read once in the constructor to build the grid's `columnTracks` and `columns`. Changing column count at runtime would require rebuilding the grid and re-flowing every cell; the demo never does this and it is out of scope. `columns` is thus a construction option with **no** runtime setter (see Non-Goals).

### Title is a required positional arg, like FieldSet

`FormFieldSet`'s constructor takes `(title, options?, subclassDefaults?)` and forwards to `super(title, options, {..._defaultFormFieldSetOptions, ...subclassDefaults})`, exactly mirroring `FieldSet`'s signature ([FieldSet.ts:55](../src/typescript/lib/component/container/FieldSet.ts#L55)) so subclassing stays open. The legend machinery is fully inherited.

### Callable dual-export idiom

Follows `FieldSet`'s pattern verbatim ([FieldSet.ts:239-244](../src/typescript/lib/component/container/FieldSet.ts#L239)): `const FormFieldSetCallable = callable(FormFieldSet); type FormFieldSetCallable = FormFieldSet; export { FormFieldSet as _FormFieldSet, FormFieldSetCallable as FormFieldSet };`.

---

## Public API (TypeScript Signatures)

```typescript
import { Component } from "~/core/Component.js";
import { FieldSetOptions } from "~/component/container/FieldSet.js";

/** A title/field pair: a label and the input it labels. */
export interface FormFieldDescriptor {
    /** Label text rendered as a baseline-aligned `Text`. */
    title: string;
    /** The input/component placed beside the label. */
    component: Component;
}

/**
 * One row of a {@link FormFieldSet}: either an array of pairs (one per logical
 * column, left-to-right; a short array leaves trailing columns empty), or a
 * single component that spans every column (status lines, button bars).
 */
export type FormRowDescriptor =
    | FormFieldDescriptor[]
    | { component: Component; fullWidth: true };

/** Construction-time options for {@link FormFieldSet}. */
export interface FormFieldSetOptions extends FieldSetOptions {
    /** Logical title/field columns laid side by side. Default `1`. */
    columns?: number;
    /** Inter-cell spacing in px for the internal grid. Default mirrors the demo's `8`. */
    fieldSpacing?: number;
    /** Declarative rows, applied in order at construction via the same path as `addRow`. */
    rows?: FormRowDescriptor[];
}

class FormFieldSet extends _FieldSet {
    constructor(title?: string, options?: FormFieldSetOptions, subclassDefaults?: Partial<FormFieldSetOptions>);

    /** Appends one title/field pair into the next free logical column, flowing to a new row when the current one fills. */
    addField(title: string, component: Component): this;

    /** Appends a full row of pairs (one per logical column; trailing columns left empty for a short array). */
    addRow(fields: FormFieldDescriptor[]): this;

    /** Appends a component spanning every column on its own row. */
    addFullWidthRow(component: Component): this;

    /** Returns the configured logical column count. */
    getColumns(): number;
}

const FormFieldSetCallable = callable(FormFieldSet);
type FormFieldSetCallable = FormFieldSet;
export {
    FormFieldSet         as _FormFieldSet,
    FormFieldSetCallable as FormFieldSet
};
```

No new DOM property/typed-setter (`setX`/`_x`/`XOptions`) is introduced — `columns`/`fieldSpacing`/`rows` are structural construction inputs, not runtime-mutable DOM state, so they get no `setColumns`-style runtime setter (the inherited `Grid` already owns column-track state).

---

## Internal Structure

```typescript
class FormFieldSet extends _FieldSet {
    /** Logical title/field column count (grid has 2× this many grid-columns). */
    private _columns: number;
    /** The internal baseline grid; rows/rowTracks are re-set as rows are added. */
    private _grid: Grid;
    /** Next free grid-column on the current flow row (0-based, in grid-columns). */
    private _flowCol: number = 0;
    /** Running grid-row count, pushed into the grid's `rows` + `rowTracks`. */
    private _rowCount: number = 0;
}
```

Constructor body (after `super(title, options, ...)`):
1. `this._columns = options?.columns ?? 1`.
2. Build `columnTracks`: for each logical column push `{mode:"content"}` then `{mode:"weight", value:1}` → `2 × _columns` tracks.
3. `this._grid = new Grid({ baselineAlign: true, columns: 2 * this._columns, spacing: options?.fieldSpacing ?? FIELD_SPACING_DEFAULT, columnTracks, rows: 0, rowTracks: [] })` and `this.setLayoutManager(this._grid)`.
4. Replay `options?.rows` through `addRow` / `addFullWidthRow`.

`addField` flow: create `new Text(title)`, `addComponent(text)` then `addComponent(component)` ([addComponent](../src/typescript/lib/core/Component.ts#L3449)), advance `_flowCol` by 2; when `_flowCol >= 2*_columns`, reset to 0 and bump `_rowCount`; when starting a fresh row (`_flowCol === 0`) increment `_rowCount` and push the grid's `rows`/`rowTracks`. `addFullWidthRow` first pads the current row to its end if mid-row, then adds the component with `GridConstraints { colSpan: 2 * _columns }` on its own new row. A private `growRows()` helper keeps `_grid.setRows()` / `_grid.setRowTracks()` in sync — every row track is `{mode:"content"}` so inputs keep natural height (demo parity, [BindingPanel.ts:160](../src/typescript/BindingPanel.ts#L160)).

`FIELD_SPACING_DEFAULT = 8` is a documented const (mirrors the demo's grid `spacing: 8`).

---

## Ordered Implementation Steps

1. **Create `src/typescript/lib/component/container/FormFieldSet.ts`.** SPDX header, imports (`_FieldSet`/`FieldSetOptions` from `./FieldSet.js`, `Grid` from `~/layout/Grid.js`, `GridConstraints`/`GridTrack` from `~/layout/`, `Text` from `~/component/input/Text.js`, `Component` from `~/core/Component.js`, `callable` from `~/core/Callable.js`). Define `FormFieldDescriptor`, `FormRowDescriptor`, `FormFieldSetOptions`, the class, and the Callable dual export per the signatures above. JSDoc every member per [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md) (description, `@param`, `@returns`, explicit return types, explicit field types).
2. **Wire the constructor body** to build `columnTracks`, create+install the grid, and replay `options.rows`. Read the new options in the body, not `applyOptions`.
3. **Implement `addField` / `addRow` / `addFullWidthRow` / `getColumns`** plus the private `growRows()` helper. Keep each method short; extract row-padding into a named private helper if the body exceeds ~30 lines (CODE_CONVENTIONS "Decompose").
4. **Export from the barrel** ([container/index.ts](../src/typescript/lib/component/container/index.ts)): add `export { FormFieldSet } …` and `export type { FormFieldSetOptions, FormFieldDescriptor, FormRowDescriptor } …` next to the `FieldSet` lines.
5. **Typecheck** — `npm run typecheck` (or `tsc -p`) → 0 errors. Confirm the `2C`-track / `colSpan` math against `Grid.measureContent`.
6. **Docs** — new `docs/components/FormFieldSet.md`, sidebar entry, catalog (see Documentation Impact).
7. **Demo** — exercise via a screen (see Verification); refactoring `BindingPanel` to consume it is a Non-Goal unless the swap is a near-1:1 drop-in.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Create | `src/typescript/lib/component/container/FormFieldSet.ts` |
| Modify | `src/typescript/lib/component/container/index.ts` (barrel export) |
| Create | `docs/components/FormFieldSet.md` |
| Modify | `docs/.vitepress/config.mts` (sidebar entry near `FieldSet`) |
| Modify | docs catalog/index page that lists container/display components (see Documentation Impact) |
| Create *(optional)* | a demo screen wiring, e.g. extend an existing showcase panel (see Verification) |

---

## Verification

- **Typecheck:** `npm run typecheck` → 0 errors.
- **Barrel grep:** `grep -n FormFieldSet src/typescript/lib/component/container/index.ts` → 2 matches (value + type).
- **Docs build:** `npm run docs:build` → 0 errors, 0 link warnings (the typedoc "unsupported TypeScript version" notice is the lone acceptable warning).
- **Manual smoke (dev server `http://localhost:8015`, `npm run dev`):** render a `FormFieldSet("Information", { columns: 2, rows: [...] })` and confirm (a) the legend shows, (b) titles right-of-nothing hug their content while inputs share a right edge per column, (c) labels baseline-align to inputs, (d) a `fullWidth` button-bar row spans all columns, (e) the fieldset's min-size still reserves legend width (inherited). Compare side-by-side with the existing Binding demo screen (`BindingPanel`) which is the reference look.
- **Demo screen:** add a `FormFieldSet` instance to an existing showcase/misc panel, or—only if it is a clean drop-in—refactor `BindingPanel`'s inline grid+`addField` ([BindingPanel.ts:151-196](../src/typescript/BindingPanel.ts#L151)) to `new FormFieldSet("Information", {...})`. Treat the refactor as the cleanest verification *if trivial*; otherwise add a dedicated demo and leave `BindingPanel` untouched.

No theme tokens are added — the component reuses `FieldSet`'s border/radius tokens and the grid's spacing is a numeric option, so there is no `Theme.ts` change.

---

## Documentation Impact

- **Barrel:** the symbol is exported from `src/typescript/lib/component/container/index.ts` (the per-subpath barrel — `@jimka/typescript-ui/component/container`); no root barrel exists.
- **Curated page:** add `docs/components/FormFieldSet.md` modelled on [docs/components/FieldSet.md](../docs/components/FieldSet.md): a one-line intro linking the typedoc API page (`/api/component/container/classes/FormFieldSet`), a `## Usage` block showing both the declarative `rows` bag and the imperative `addField`, a `## Common methods` table (`addField`, `addRow`, `addFullWidthRow`, `getColumns`), and a `## See also` linking `FieldSet` and `Grid`.
- **Sidebar:** add `{ text: 'FormFieldSet', link: '/components/FormFieldSet' }` in `docs/.vitepress/config.mts` directly after the `FieldSet` entry ([config.mts:96](../docs/.vitepress/config.mts#L96)).
- **Catalog index:** add `FormFieldSet` to whichever `docs/.../index.md` catalogs container/display components alongside `FieldSet` (locate with `grep -rln '\bFieldSet\b' docs/*/index.md docs/index.md`).
- **JSDoc cross-bucket refs:** `Grid`, `GridConstraints`, and `Text` live in other subpaths; if referenced in prose use markdown links per [_shared/docs-conventions.md](../.claude/skills/_shared/docs-conventions.md), and tag the class `@category Components` to match `FieldSet`.

---

## Potential Challenges

- **Baseline mode ignores explicit `col`/`row`** ([Grid.ts:636](../src/typescript/lib/layout/Grid.ts#L636)) — the whole design must rely on `colSpan`-driven auto-flow and spacer padding, never on `cons.col`. Mitigation: per-column targeting is row-oriented (`addRow`) + spacer padding only.
- **Row count must be pre-set** before layout — `flowRow` stops at `rows` ([Grid.ts:655](../src/typescript/lib/layout/Grid.ts#L655)). Mitigation: `growRows()` bumps `_grid.setRows()` and `rowTracks` on every committed row, so the grid always has enough rows; a stale count silently drops cells.
- **Empty spacer cells for partially-filled multi-column rows** still consume a `content`/`weight` track pair. Mitigation: spacers are bare `Component()` with no preferred size, contributing 0 to `measureContent` ([Grid.ts:808](../src/typescript/lib/layout/Grid.ts#L808)) so they don't widen tracks.
- **`fieldSpacing` default** must match the demo (`8`) or the look drifts. Mitigation: named const `FIELD_SPACING_DEFAULT = 8` with the demo-parity rationale in its comment.

---

## Critical Files

- [src/typescript/lib/component/container/FieldSet.ts](../src/typescript/lib/component/container/FieldSet.ts) — base class: constructor `(title, options, subclassDefaults)`, `applyOptions`, `_defaultFieldSetOptions`, legend/clearance/min-size, Callable dual export.
- [src/typescript/BindingPanel.ts](../src/typescript/BindingPanel.ts) — the pattern being formalised: grid config (lines 151-161), `addField` helper (165-168), `spanBothColumns` (179-184), baseline rows.
- [src/typescript/lib/layout/Grid.ts](../src/typescript/lib/layout/Grid.ts) — baseline `doLayout` (632-724), `measureContent` (796-842), `resolveTracks` (742-778); confirms `2C`-track + `colSpan` flow.
- [src/typescript/lib/layout/GridConstraints.ts](../src/typescript/lib/layout/GridConstraints.ts) / [GridTrack.ts](../src/typescript/lib/layout/GridTrack.ts) — `colSpan`, track modes.
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) — `addComponent` (3449), `setLayoutManager`, `getBaseline` (2255).
- [src/typescript/lib/component/container/index.ts](../src/typescript/lib/component/container/index.ts) — export surface.
- [docs/components/FieldSet.md](../docs/components/FieldSet.md) — doc page template.

---

## Non-Goals

- **Runtime column-count changes.** `columns` is construction-only; rebuilding the grid mid-life is out of scope (the demo never does it).
- **Explicit per-cell placement / arbitrary `col`/`row` targeting.** Baseline mode does not support it; the API is auto-flow + spacer padding only.
- **`rowSpan > 1` fields.** Baseline mode does not support it ([Grid.ts:636](../src/typescript/lib/layout/Grid.ts#L636)).
- **Refactoring `BindingPanel`** beyond a trivial drop-in. The binding/validation wiring is orthogonal; only the layout block would change, and only if the swap is near-1:1.
- **New theme tokens / typed runtime setters.** None are needed; structure is construction-time, visuals inherit `FieldSet`.
