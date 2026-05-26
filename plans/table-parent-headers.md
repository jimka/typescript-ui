---
touches-shared: [src/typescript/lib/component/table/Header.ts, src/typescript/lib/component/table/ColumnConfig.ts, src/typescript/lib/component/table/Column.ts]
---

# Table Parent Headers — Implementation Plan

## Overview

Adds an optional "parent header" row above the existing column header row. A parent header cell spans every column belonging to its group, giving consumers a visual grouping affordance ("Address" arching over `street`, `city`, `zip`; "Pricing" over `cost`, `margin`, `total`). Behaviour is purely presentational — groups do not introduce a new data model layer, do not change the column count, and do not alter how `Body.ts` renders cells.

Touch points are deliberately narrow:

- [`ColumnConfig`](../src/typescript/lib/component/table/ColumnConfig.ts) grows an optional `group?: string` and `groupColor?: string` field.
- [`Column`](../src/typescript/lib/component/table/Column.ts) grows a parallel `_group` field plus `getGroup()` / `getGroupColor()` getters.
- [`Header`](../src/typescript/lib/component/table/Header.ts:25) gains a second internal `Row` ahead of the existing one, populated with a new `ParentHeaderCell` per contiguous run of grouped columns and a placeholder spanning cell over any ungrouped column.
- [`layout/Table`](../src/typescript/lib/layout/Table.ts:78) positions both header rows and pays for the extra row in the body's available height.

This plan is the prerequisite for `tree-table.md`. The TreeTable plan will assume the column-group decisions below (flat `group?: string` keyed by name, group-bounded drag-reorder, group-cells-as-Components in a second header row).

---

## Architecture Decisions

### Flat `group?: string` on `ColumnConfig` — not a nested `ColumnGroupConfig`

Each `ColumnConfig` declares its group by name (`group: "Address"`) rather than wrapping columns inside a `ColumnGroupConfig` tree. Rationale:

- **Touches existing call sites by zero.** Tables today are defined as a flat array; an unset `group` is the existing behaviour. Wrapping in a tree would force every existing `spec.columns` array to be rewritten.
- **Resolution stays linear.** `Column.resolve` already iterates `spec.columns` and produces a flat `Column[]`. A nested config would force `resolve` to flatten and reorder by group, which conflicts with `Field.getOrder()` — the existing single source of truth for column display order.
- **TreeTable can layer the same scheme.** Nested grouping (group-within-group, two-tier parent headers) is explicitly **out of scope** here (see `## Non-Goals`); when TreeTable needs deeper nesting it can introduce a list-of-paths form (`group: ["Region", "Country"]`) without breaking the flat case.

Group identity is the string itself. Two non-adjacent columns sharing the same group name still render as **two** parent header cells — one per contiguous run. Reordering columns can therefore split a group visually; that is intentional and surfaced under "Drag-reorder behaviour across groups" below.

### Parent headers live as a **second `Row`** inside the existing `Header`

`Header` already contains one `Row` ([Header.ts:44](../src/typescript/lib/component/table/Header.ts#L44)). The simplest extension is a parent-row `Row` prepended ahead of it via `Header.addComponent`, with cells of a new `ParentHeaderCell` type — each spanning the cells beneath. Rejected alternatives:

- **A new `ParentHeader` component sibling of `Header`.** Would force `Table.ts` and the `layout/Table` manager to track three sections (parent header / header / body). Doubling the header surface is cheaper.
- **Multi-row HTML `<th>` with `rowspan`/`colspan`.** The framework positions every `Component` absolutely; `colspan` is a DOM-flow concept the layout pipeline does not honour. Width spanning is computed numerically by the layout manager and applied via `setWidth`.

### `ParentHeaderCell` is a `Component` subclass — not a reused `HeaderCell`

[`HeaderCell`](../src/typescript/lib/component/table/cell/Header.ts:73) carries machinery (sort indicator, `ResizeHandle`, `SortPriorityBadge`, `setColumnFocused`) that is meaningless for a group header. Subclassing `HeaderCell` and disabling those would violate one-element-per-class clarity. `ParentHeaderCell` extends `DefaultCell` (so it picks up the same renderer/padding/border baseline as ordinary header cells) and owns only what a group header needs: text, optional foreground/background tint, and its bottom border that visually merges with the row below.

### Layout: second-row height is added to the header band, not stolen from the body

[`layout/Table.doLayout`](../src/typescript/lib/layout/Table.ts:78) currently computes a single `columnHeight` for the header row and uses it as both `header.setHeight(columnHeight)` and `body.setY(headerHeight)`. With parent headers visible, the header band becomes `parentRowHeight + columnHeight`. The body shrinks by `parentRowHeight`. Parent row height is computed identically to the existing column header (header font × line-height + 2 × cell padding) — same theme tokens, same arithmetic, so a theme swap re-runs `doLayout` and the two rows stay aligned.

When **no** columns carry a `group` value, the parent row collapses to zero height and contributes nothing — existing tables are byte-identical at runtime.

### Drag-reorder behaviour across groups

Column drag-reorder does **not** exist in the current codebase (only **resize** drag, owned by [`ResizeHandle`](../src/typescript/lib/component/table/cell/ResizeHandle.ts) and wired through [`HeaderCell.onResizeDragStart`](../src/typescript/lib/component/table/cell/Header.ts:358)). This plan introduces no new drag-reorder code. **When drag-reorder is added later**, it must clamp the drop target to within the source column's group: a column tagged `group: "Address"` cannot be dragged into the run of `group: "Pricing"` columns. The rationale is that crossing groups would either (a) silently retag the moved column into the new group, mutating its config, or (b) leave the visual parent-header run fragmented. Both are surprises; refusing the cross-group drop is the principled position. This decision is recorded here so the future drag-reorder plan inherits it.

Reordering **within** a group is allowed and only renumbers the columns of one parent-header cell — the cell's width and label are unaffected.

### Sort priority interaction with grouping

Sorting is unchanged. Parent header cells are non-interactive (no `setOnSortClick` wiring; clicking a parent header does nothing). The existing per-column sort cycle in [`Header.handleSortClick`](../src/typescript/lib/component/table/Header.ts:274) and the multi-sort priority badge in [`HeaderCell`](../src/typescript/lib/component/table/cell/Header.ts:125) operate on individual columns and ignore group membership. A future feature — "click a parent header to sort all its columns asc" — is intentionally out of scope; see `## Non-Goals`.

### Header layout with a missing-parent column next to grouped columns

When the visible column list is `[A(no group), B(group "X"), C(group "X"), D(no group)]`, the parent header row renders four cells: a blank spanning A, "X" spanning B+C, a blank spanning D. The blanks are real `ParentHeaderCell` instances with empty text and the **parent row's** background but no foreground label or border tint — they render as a flat extension of the header band rather than a gap. Rationale: a true gap would leak `body` background through the header strip and break the visual seal of the header. A spanning blank cell preserves the header's continuity at zero behavioural cost (same `Component`, same layout slot, just empty text).

A run of one ungrouped column followed by another ungrouped column still produces **two** blank parent cells (one per column), not a single spanning blank. This keeps the parent row's cell count equal to the count of contiguous-group runs, which matches the column-grouping arithmetic done in `Header.rebuildParentCells` (see `## Internal Structure`).

### Visual borders between groups

The parent header row gets:

- **Bottom border**: identical to the existing header bottom border (`--ts-ui-table-header-border`).
- **Inter-group vertical borders**: a 1 px right border on each non-final `ParentHeaderCell`, using the same `--ts-ui-table-header-border` token. The cell directly above each visible inter-group boundary in the second header row mirrors this border, so the eye reads one continuous vertical separator between groups. Within a group the column-header row keeps its existing internal borders (rendered by [`DefaultCell`'s](../src/typescript/lib/component/table/cell/Default.ts) border config — not modified here).
- **Optional per-group background tint**: when `ColumnConfig.groupColor` is set on **any** column in the run, the parent cell adopts that background color (theme-aware via CSS variable fallback). All columns in a run must agree on `groupColor`; conflicting values within a run resolve to the first encountered value (the resolution is deterministic by `Field.getOrder`).

---

## Public API (TypeScript Signatures)

### `ColumnConfig` extension

```typescript
export interface ColumnConfig {
    field        : string;
    minWidth    ?: number;
    maxWidth    ?: number;
    hidden      ?: boolean;
    showSeconds ?: boolean;
    headerGlyph ?: string;
    /**
     * Name of the parent-header group this column belongs to. Adjacent columns
     * sharing the same group name render under a single spanning parent header
     * cell. Non-adjacent same-named columns render as two separate parent cells.
     * Omit to leave the column ungrouped; the parent row then renders an empty
     * spanning cell above it.
     */
    group       ?: string;
    /**
     * Optional background color (CSS color string) for the parent header cell.
     * All columns in a contiguous group should agree on this value; the first
     * encountered value in the run wins.
     */
    groupColor  ?: string;
}
```

### `Column` extension

```typescript
export class Column {
    // existing fields and methods unchanged

    getGroup(): string | null;
    getGroupColor(): string | null;
}
```

`Column` stores `_group: string | null` and `_groupColor: string | null` set from `config?.group ?? null` and `config?.groupColor ?? null` in the constructor. No setters — group membership is fixed at construction (matches the existing `_minWidth` / `_maxWidth` immutability).

### `ParentHeaderCell` (new file, `src/typescript/lib/component/table/cell/ParentHeader.ts`)

```typescript
export class ParentHeaderCell extends DefaultCell {
    /**
     * Constructs a parent header cell.
     *
     * @param text    - The group label to display. Empty string renders a blank spanning cell.
     * @param color   - Optional background color; omitted falls back to the header band gradient.
     * @param isLast  - When false, paints the right-edge inter-group divider.
     */
    constructor(text: string, color: string | null, isLast: boolean);

    getText(): string;
    getColor(): string | null;
    isLastInRow(): boolean;
}
```

Construction-time only — the layout manager rebuilds the parent row from scratch whenever the visible column set changes (hidden-column toggles, model swap, group config change). No post-construction mutators are exposed; this matches the existing `HeaderCell` constructor-only contract for its `text` and `fieldName`.

### `Header` extension

```typescript
export class Header {
    // existing methods unchanged

    /**
     * Returns the parent header row, or `null` when no visible column declares a group.
     * The returned Row's components are `ParentHeaderCell` instances in display order.
     */
    getParentRow(): Row | null;

    /**
     * Returns true when at least one visible column declares a group — i.e. the
     * parent header row is rendered with non-zero height. Driven by Column.getGroup()
     * across the resolved visible column list.
     */
    hasParentRow(): boolean;
}
```

`Header.setColumns(columns)` ([Header.ts:111](../src/typescript/lib/component/table/Header.ts#L111)) and `Header.setHiddenColumns(hidden)` ([Header.ts:96](../src/typescript/lib/component/table/Header.ts#L96)) already trigger a full rebuild; both grow a call into a new private `rebuildParentCells()` after the existing `rebuildCells()` so the two header rows always stay in sync.

---

## Internal Structure

### `Header.rebuildParentCells` — building the parent row

```typescript
private rebuildParentCells(): void {
    const parentRow = this.getParentRow();   // first child Row, lazily created

    parentRow.removeAllComponents();

    const visibleCols = this._columns
        .filter(c => !this._hiddenColumns.has(c.getField().getName()))
        .sort((a, b) => a.getField().getOrder() - b.getField().getOrder());

    // Walk the visible columns building contiguous runs. Each run becomes one
    // ParentHeaderCell. The run key is `col.getGroup()` (null counts as a key
    // distinct from any string — ungrouped columns produce blank cells).
    let runStart   = 0;
    let runKey     = visibleCols[0]?.getGroup() ?? null;
    let runColor   = visibleCols[0]?.getGroupColor() ?? null;

    for (let i = 1; i <= visibleCols.length; i++) {
        const nextKey = i < visibleCols.length ? visibleCols[i].getGroup() : Symbol() as unknown as string;

        if (nextKey !== runKey) {
            const isLast = i === visibleCols.length;
            const cell   = new ParentHeaderCell(runKey ?? "", runColor, isLast);

            parentRow.addComponent(cell, { data: { spanFrom: runStart, spanTo: i - 1 } });

            runStart = i;
            runKey   = nextKey;
            runColor = i < visibleCols.length ? visibleCols[i].getGroupColor() : null;
        }
    }
}
```

The `spanFrom`/`spanTo` indices live in the layout constraints `data` slot (same mechanism `Header` already uses for `Field` references — [Header.ts:244](../src/typescript/lib/component/table/Header.ts#L244)). The layout manager reads these to compute the parent cell's `x` and `width` by summing `columnWidths[spanFrom..spanTo]`.

### `layout/Table` — positioning two header rows

The existing `doLayout()` ([Table.ts:78](../src/typescript/lib/layout/Table.ts#L78)) is extended:

1. Compute `columnHeight` exactly as today.
2. Ask `header.hasParentRow()` — if true, set `parentRowHeight = columnHeight` (same arithmetic, same tokens); otherwise `parentRowHeight = 0`.
3. Set `header.setHeight(parentRowHeight + columnHeight)`.
4. Inner-row positioning: the existing column-header row moves to `y = parentRowHeight` (not `y = 0`).
5. Parent row is positioned at `y = 0`, height `parentRowHeight`.
6. For each `ParentHeaderCell` in the parent row, set `x = sum(columnWidths[0..spanFrom-1])` and `width = sum(columnWidths[spanFrom..spanTo])`.
7. Body Y offset becomes `containerInsets.top + parentRowHeight + columnHeight` — currently `containerInsets.top + columnHeight` ([Table.ts:180](../src/typescript/lib/layout/Table.ts#L180)).
8. Body height shrinks correspondingly ([Table.ts:182](../src/typescript/lib/layout/Table.ts#L182)).

---

## Theme Tokens

No new tokens. The parent header reuses:

| CSS Custom Property | Reused For |
|---|---|
| `--ts-ui-table-header-border` | Parent row's bottom border and inter-group vertical borders. |
| `--ts-ui-table-header-font-size` | Parent cell label font size. |
| `--ts-ui-button-bg` | Parent row background gradient (matches the column-header row, see [Header.ts:39](../src/typescript/lib/component/table/Header.ts#L39)). |

Per-group `groupColor` is consumer-supplied (a CSS color string passed through `ColumnConfig.groupColor`); it does not become a theme token because grouping is application data, not theme styling.

---

## Ordered Implementation Steps

1. **`ColumnConfig.ts`** — add the `group?: string` and `groupColor?: string` fields with JSDoc matching the existing field comments.
2. **`Column.ts`** — add `_group: string | null` and `_groupColor: string | null` private fields, initialise from config in the constructor, expose `getGroup()` / `getGroupColor()`.
3. **`cell/ParentHeader.ts`** (new) — `ParentHeaderCell extends DefaultCell` with the constructor signature above; wraps `DefaultCell`'s renderer with the supplied text, applies background color when supplied, paints the right-edge divider when `isLast === false`. Export via `callable()` pattern (see [`HeaderCell` export form](../src/typescript/lib/component/table/cell/Header.ts#L420)).
4. **`Header.ts`** — change the constructor to allocate **two** `Row` children up front (parent row at index 0, column row at index 1). Update `getColumns()` to keep returning the **column** row's children (it currently reads `getComponents()[0]` — bump to `getComponents()[1]`). Add `getParentRow()` and `hasParentRow()`. Add a private `rebuildParentCells()` invoked from the same places `rebuildCells()` is invoked ([Header.ts:47](../src/typescript/lib/component/table/Header.ts#L47), [Header.ts:99](../src/typescript/lib/component/table/Header.ts#L99), [Header.ts:114](../src/typescript/lib/component/table/Header.ts#L114)). Verify: `grep -n 'getComponents()\[0\]' src/typescript/lib/component/table/Header.ts` — fix every hit to `[1]` for column-row reads.
5. **`layout/Table.ts`** — apply the two-row arithmetic from `## Internal Structure`. Verify: a `npm run dev` smoke test with a no-group spec — parent row height is 0, body Y offset and height match pre-change values exactly.
6. **Resize callback wiring sanity check** — column resize callback indexes ([Header.ts:259](../src/typescript/lib/component/table/Header.ts#L259)) still refer to the **column** row, not the parent row. Confirm `wireCell` is only called from `rebuildCells`, never from `rebuildParentCells`.
7. **`docs/components/Table.md`** — add a new section "## Parent headers" with an example spec that groups two columns, and append `group` / `groupColor` rows to the `ColumnConfig` table.
8. **`docs/components/TableInternals.md`** — note the new `ParentHeaderCell` class and the dual-row `Header` shape.
9. **`docs/.vitepress/config.mts`** — no sidebar change (parent header is documented on the existing Table page); skip.
10. **`npm run docs:build`** — expect 0 errors and 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/table/ColumnConfig.ts` |
| Modify | `src/typescript/lib/component/table/Column.ts` |
| Modify | `src/typescript/lib/component/table/Header.ts` |
| Modify | `src/typescript/lib/layout/Table.ts` |
| Create | `src/typescript/lib/component/table/cell/ParentHeader.ts` |
| Modify | `src/typescript/lib/component/table/index.ts` (export `ParentHeaderCell`) |
| Modify | `docs/components/Table.md` |
| Modify | `docs/components/TableInternals.md` |

---

## Verification

- **Typecheck**: `npm run build` clean.
- **No-group regression**: open a demo screen using a `ColumnSpec` without any `group` value — header band height, body Y offset, and body height are byte-identical to pre-change.
- **Single-group smoke**: open a demo with two adjacent columns tagged `group: "Address"`; verify one spanning parent cell labelled "Address", inter-group dividers absent on its right (it's last), bottom border continuous with the column header.
- **Mixed grouped/ungrouped**: spec `[id(none), street(Address), city(Address), age(none)]`; expect four parent cells (blank, "Address" spanning two, blank).
- **Group splitting on hide**: hide the middle column of a 3-column group with `setColumnVisible(field, false)`; the remaining two adjacent columns continue as one "Address" parent cell. Hide a non-middle column; the parent cell shrinks to span the remaining two. Hide all columns of a group; the parent cell disappears entirely.
- **Theme toggle**: switch to dark theme — parent header band picks up the dark `--ts-ui-button-bg` gradient and dark border token without re-render.
- **`npm run docs:build`** — 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).

Demo screen: extend the existing Table demo (likely `src/typescript/app/demos/...`) with a spec that groups three person-record columns under "Identity" and "Demographics".

---

## Documentation Impact

- **Per-subpath barrel**: `src/typescript/lib/component/table/index.ts` re-exports `ParentHeaderCell` so it lands in `docs/api/component/table/` after build.
- **Curated page**: `docs/components/Table.md` grows a "Parent headers" section; the `ColumnConfig` table gains `group` and `groupColor` rows.
- **Internals page**: `docs/components/TableInternals.md` documents the dual-`Row` shape of `Header` and the new `ParentHeaderCell`.
- **JSDoc cross-bucket links**: none — every new symbol lives in `component/table`, so `{@link ParentHeaderCell}` and `{@link Header}` resolve within the same bucket.
- **Sidebar (`docs/.vitepress/config.mts`)**: no change — `Table` and `TableInternals` are already linked under the Table sidebar group ([config.mts:129-132](../docs/.vitepress/config.mts#L129)).

---

## Potential Challenges

- **`Header.getColumns()` index change** — moving the column row from index 0 to index 1 affects every internal reader. Mitigation: grep for `getComponents()[0]` inside `Header.ts` (currently five hits) and re-route each to whichever row it actually wanted.
- **Layout-manager arithmetic drift** — adding `parentRowHeight` to body Y must also be subtracted from body height. A copy-paste of the same offset in only one of the two writes manifests as a row-height-sized blank strip at the bottom. Mitigation: introduce a single local `headerBandHeight = parentRowHeight + columnHeight` used by both `setHeight` and the body's Y offset.
- **Group config conflict** — two columns in a contiguous run with different `groupColor` values. Mitigation: pre-validate at `rebuildParentCells` time; first non-null `groupColor` in the run wins, the others are silently ignored (no exception — the consumer's spec should self-correct in development).
- **Parent row appears under `getColumns()` for callers expecting the column row** — `Table.getColumns()` is consumer-facing ([Table.ts:167](../src/typescript/lib/component/table/Table.ts#L167)) and returns `Column[]`, not header cells; the impacted method is `Header.getColumns()`, which is internal to the table family. Mitigation: leave `Header.getColumns()` returning the column row (post-step-4) and add `Header.getParentColumns()` only if a follow-up reveals a real need.

---

## Critical Files

The implementer must read these before editing:

- [`src/typescript/lib/component/table/Header.ts`](../src/typescript/lib/component/table/Header.ts) — owner of both rows; understand `rebuildCells`, `wireCell`, `syncSortIndicators`, the index-0 / index-1 convention.
- [`src/typescript/lib/component/table/cell/Header.ts`](../src/typescript/lib/component/table/cell/Header.ts) — sibling of the new `ParentHeaderCell`; mimic its constructor / `init` / glyph machinery as the structural template.
- [`src/typescript/lib/component/table/cell/Default.ts`](../src/typescript/lib/component/table/cell/Default.ts) — parent class of `ParentHeaderCell`; understand its renderer / inset model.
- [`src/typescript/lib/layout/Table.ts`](../src/typescript/lib/layout/Table.ts) — owns header / body / footer positioning; the only file in the layout system that needs to know about the parent row.
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) — read the `table.header` block to confirm no new tokens are required.

---

## Non-Goals

- **Nested groups (group-within-group, three-row headers).** Out of scope. The flat `group?: string` is the v1; TreeTable's plan will extend the shape if needed.
- **Clicking a parent header to sort all its columns.** Out of scope — parent cells are non-interactive. Sort interaction stays on individual column headers.
- **Drag-reorder of columns** (with or without group constraints). No drag-reorder exists today; introducing it is a separate plan. The group-bounded constraint is **documented** here so the future plan inherits it.
- **Resizing a parent cell to redistribute the widths of its children.** Out of scope; columns retain their independent `ResizeHandle` machinery.
- **`Footer` parent row.** Footers have no analogue need today; symmetric extension would be straightforward but is out of scope.
- **Per-group hide/show toggle.** Hiding all columns of a group naturally collapses the parent cell. A "hide group" affordance in the column context menu is a follow-up if requested.
