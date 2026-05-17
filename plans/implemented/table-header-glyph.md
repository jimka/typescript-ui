# Table Header Glyph — Implementation Plan

## Overview

Adds an optional leading glyph slot to table column headers. A column can carry a registry glyph name (e.g. `"times"`); when present, the corresponding `Glyph` renders to the left of the header text inside the `<th>` cell. When absent, the header renders exactly as today — no reserved gap, no layout shift.

The slot lives on [Column.ts:17](../src/typescript/lib/component/table/Column.ts#L17) as the canonical owner (column metadata is already the single source of truth for header-side presentation; headers are derived from it via [Header.rebuildCells](../src/typescript/lib/component/table/Header.ts#L209)). It is sourced from a new `headerGlyph?: string` field on [ColumnConfig](../src/typescript/lib/component/table/ColumnConfig.ts#L12) so a `ColumnSpec` can declare it at table construction.

The renderer surface changes in [cell/Header.ts:39](../src/typescript/lib/component/table/cell/Header.ts#L39): the constructor accepts an optional glyph name, and `init()` mounts a sibling `Glyph` to the left of the existing `Text` produced by the [StringRenderer](../src/typescript/lib/component/table/cell/renderer/String.ts#L14). The sort-arrow suffix on the text and the `<span>` priority badge (still anchored to the cell's right edge) are untouched, so the visual order is `[glyph?] [text + sort-arrow] [priority-badge?] [resize-handle]`.

---

## Architecture Decisions

### Glyph slot lives on `Column`, not on `HeaderCell`

`Column` (the resolved descriptor at [Column.ts:17](../src/typescript/lib/component/table/Column.ts#L17)) already carries every other per-column header concern — width constraints, initial visibility, the field reference. Adding `headerGlyph` there keeps presentation metadata in one place and gives [Header.rebuildCells](../src/typescript/lib/component/table/Header.ts#L209) one descriptor to consult when it builds cells. Putting the slot directly on `HeaderCell` would force the same data to round-trip through field name → cell lookup on every rebuild.

### Source the option through `ColumnConfig`, not a new public `ColumnOptions`

`Column` instances are constructed exclusively by `Column.resolve(...)` at [Column.ts:93](../src/typescript/lib/component/table/Column.ts#L93) — never by application code. The user-facing entry point is the `columns: ColumnConfig[]` array passed to the [Table constructor](../src/typescript/lib/component/table/Table.ts#L96). Add `headerGlyph?: string` to [ColumnConfig](../src/typescript/lib/component/table/ColumnConfig.ts#L12) so spec authors can declare it; `Column.resolve` copies it onto the constructed `Column`. The `setHeaderGlyph` / `getHeaderGlyph` / `clearHeaderGlyph` triple on `Column` itself remains the runtime API for programmatic changes after construction.

### Renderer mounts the glyph inside `HeaderCell`, not via `IconText`

[IconText](../src/typescript/lib/component/display/IconText.ts) is a tempting fit (Glyph + Text in an HBox with a configurable gap) but `HeaderCell` does not own its `Text` directly — the text lives inside a [StringRenderer](../src/typescript/lib/component/table/cell/renderer/String.ts#L14) which the cell consumes through `getRenderer().getText()`. The renderer is wrapped in a [Fit layout](../src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L21) and is the cell's sole layout child; the sort-arrow code path mutates the renderer's `Text` content. Replacing the renderer with an `IconText` would force the sort logic ([cell/Header.ts:120](../src/typescript/lib/component/table/cell/Header.ts#L120)) to learn a new internal shape and would also re-plumb the empty/no-glyph case.

Instead, mount the `Glyph` as a sibling DOM child of the `<th>` element via absolute positioning — the same lightweight pattern the cell already uses for the resize handle and priority badge at [cell/Header.ts:83-103](../src/typescript/lib/component/table/cell/Header.ts#L83). The renderer keeps owning the text; the cell pads its left inset by `glyph-width + gap` only when a glyph is mounted, so the text never overlaps the glyph and the no-glyph case is pixel-identical to today.

### Position: absolute, left edge, vertically centred

Mirrors the existing resize handle and priority badge. Top `0`, left `var(--ts-ui-table-header-glyph-gap, 4px)`, vertical centring via `top: 50%; transform: translateY(-50%);` — `transform: translate` doesn't disturb the header's existing `will-change: transform` hint set at [Table.ts:120](../src/typescript/lib/component/table/Table.ts#L120) because the hint targets the header element, not the glyph child.

The glyph instance uses `pointer-events: none` so clicks pass through to the `<th>` and continue to trigger sort.

### Sort indicator stays on text, glyph stays on the left

The sort arrow (▲/▼) is a suffix appended to the cell text by `setSortState` ([cell/Header.ts:120](../src/typescript/lib/component/table/cell/Header.ts#L120)); the priority badge is positioned at the cell's `right: 8px` ([cell/Header.ts:97](../src/typescript/lib/component/table/cell/Header.ts#L97)). The new header glyph anchors to the cell's left edge. Visual order becomes `[glyph] [text ▲] … [badge] [resize]`, with no interaction between glyph and sort affordances. Glyph state is independent of sort state — `setSortState` / `clearSortState` do not touch the glyph.

### Gap and color are themed tokens

`--ts-ui-table-header-glyph-gap` (default `4px`) controls the horizontal gap between the glyph's right edge and the start of the text. `--ts-ui-table-header-glyph-color` defaults to `currentColor` so the glyph inherits the header text color (the `Glyph` contract at [Glyph.ts:48](../src/typescript/lib/component/display/Glyph.ts#L48) already wires `fill="currentColor"` for SVG and lets char glyphs inherit). A token rather than a hard-coded `4px` keeps the value tunable from `Theme.ts` per the project's CSS-via-setters convention.

### Sizing fixed at 16×16

`Glyph`'s default preferred size is already 16×16 ([Glyph.ts:37](../src/typescript/lib/component/display/Glyph.ts#L37)). The header cell does not override it. Glyphs larger than `--ts-ui-table-cell-height` (`22px` in both themes at [Theme.ts:314](../src/typescript/lib/core/Theme.ts#L314)) are out of scope; if a future use case appears, expose a setter then.

---

## Public API (TypeScript Signatures)

### `ColumnConfig` — new field

```typescript
// src/typescript/lib/component/table/ColumnConfig.ts
export interface ColumnConfig {
    field        : string;
    minWidth    ?: number;
    maxWidth    ?: number;
    hidden      ?: boolean;
    showSeconds ?: boolean;
    /** Registry glyph name shown to the left of the header text. Omit for no glyph. */
    headerGlyph ?: string;
}
```

### `Column` — new triple

```typescript
// src/typescript/lib/component/table/Column.ts
export class Column {
    // ...existing methods

    /**
     * Sets the registry glyph name shown to the left of this column's header text.
     * Pass `null` (or call `clearHeaderGlyph()`) to remove the glyph.
     */
    setHeaderGlyph(name: string | null): this;

    /** Returns the registry glyph name, or `null` if no header glyph is set. */
    getHeaderGlyph(): string | null;

    /** Equivalent to `setHeaderGlyph(null)`. */
    clearHeaderGlyph(): this;
}
```

Cached backing field: `private _headerGlyph: string | null`. Construction routes `config?.headerGlyph ?? null` into `_headerGlyph` at [Column.ts:30](../src/typescript/lib/component/table/Column.ts#L30); `Column.resolve` does not need to grow new logic because the new field flows through `configMap.get(...)` exactly like `minWidth` and `maxWidth`.

### `HeaderCell` — constructor gains optional glyph name

```typescript
// src/typescript/lib/component/table/cell/Header.ts
class HeaderCell extends DefaultCell {
    constructor(text: string, fieldName: string, headerGlyph?: string | null);

    /**
     * Mounts (or replaces) the leading header glyph. Pass `null` to remove it.
     * Mutates the `<th>` directly; cheap enough to call on each rebuild.
     */
    setHeaderGlyph(name: string | null): this;

    /** Returns the registry name currently mounted, or `null`. */
    getHeaderGlyph(): string | null;
}
```

Cached backing fields: `private _headerGlyph: string | null = null;` and `private _headerGlyphInstance: Glyph | null = null;`. The instance reference is needed so `setHeaderGlyph(null)` can detach the previous DOM node.

---

## Theme Tokens

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-table-header-glyph-gap` | `4px` | `4px` | Horizontal gap between the header glyph and the start of the header text. |
| `--ts-ui-table-header-glyph-color` | `currentColor` | `currentColor` | Foreground color of the header glyph. Defaults to `currentColor` so it inherits the header text color. |

`Theme.ts` blocks to update:

- `Theme` (the interface around [Theme.ts:101](../src/typescript/lib/core/Theme.ts#L101)) — extend `table.header` with `glyph: { gap: string; color: string }`.
- `DefaultTheme` (around [Theme.ts:305](../src/typescript/lib/core/Theme.ts#L305)) — add `glyph: { gap: '4px', color: 'currentColor' }` to the `table.header` block.
- `DarkTheme` (around [Theme.ts:459](../src/typescript/lib/core/Theme.ts#L459)) — same shape.
- `themeToVars` (around [Theme.ts:599](../src/typescript/lib/core/Theme.ts#L599)) — emit `'--ts-ui-table-header-glyph-gap': theme.table.header.glyph.gap` and `'--ts-ui-table-header-glyph-color': theme.table.header.glyph.color` alongside the existing `--ts-ui-table-header-*` entries.

---

## Internal Structure

`HeaderCell.setHeaderGlyph(name)` body:

```typescript
setHeaderGlyph(name: string | null): this {
    this._headerGlyph = name;

    // Detach previous instance, if any. No framework lifecycle — it's a raw DOM child.
    if (this._headerGlyphInstance) {
        this._headerGlyphInstance.getElement()?.remove();
        this._headerGlyphInstance = null;
    }

    const el = this.getElement();
    if (!name || !el) {
        // No glyph requested, or cell not yet rendered. The init() path will retry.
        // Restore the renderer's default left padding by clearing the override.
        this.getRenderer().setInsets(/* theme default */);
        return this;
    }

    const glyph = new Glyph(name);
    glyph.setPointerEvents("none");

    // Render and absolutely position the glyph element inside the <th>.
    const gEl = glyph.getElement()!;
    gEl.style.cssText =
        'position:absolute;left:var(--ts-ui-table-header-glyph-gap,4px);' +
        'top:50%;transform:translateY(-50%);' +
        'color:var(--ts-ui-table-header-glyph-color,currentColor);' +
        'pointer-events:none;';
    el.appendChild(gEl);
    this._headerGlyphInstance = glyph;

    // Shift the text right so it doesn't overlap the glyph.
    // 16 = Glyph default preferredSize.width.
    const themePad = ThemeManager.getTheme().table.cell.padding;
    const offset   = 16 + /* var(--ts-ui-table-header-glyph-gap) numeric */ 4 + themePad;
    this.getRenderer().setInsets(new Insets(0, themePad, 0, offset));

    return this;
}
```

`init()` ([cell/Header.ts:65](../src/typescript/lib/component/table/cell/Header.ts#L65)) calls `setHeaderGlyph(this._headerGlyph)` once the element exists so the deferred case from a constructor-time name is mounted; the call is a no-op when `_headerGlyph` is null.

Header wiring at [Header.rebuildCells](../src/typescript/lib/component/table/Header.ts#L209) takes a `Map<string, Column>` (or scans the resolved `Column[]` once into one) and passes `column.getHeaderGlyph()` as the third constructor argument when building each `HeaderCell`. This means `Header` needs the column list; thread it from `Table` via a new `setColumns(columns: Column[])` setter that mirrors the existing `setHiddenColumns` shape. `Table` already owns `this.resolvedColumns` ([Table.ts:75](../src/typescript/lib/component/table/Table.ts#L75)); call `this.header.setColumns(this.resolvedColumns)` after construction and after every `setStore` rebuild ([Table.ts:202](../src/typescript/lib/component/table/Table.ts#L202)).

---

## Ordered Implementation Steps

1. **Extend `ColumnConfig`.** [ColumnConfig.ts:12](../src/typescript/lib/component/table/ColumnConfig.ts#L12) — add `headerGlyph?: string`. Document inline with the same JSDoc tone as `minWidth`.

2. **Add the triple to `Column`.** [Column.ts](../src/typescript/lib/component/table/Column.ts) — add private `_headerGlyph: string | null = null` initialised from `config?.headerGlyph ?? null` at [Column.ts:30](../src/typescript/lib/component/table/Column.ts#L30). Add `setHeaderGlyph(name: string | null): this`, `getHeaderGlyph(): string | null`, and `clearHeaderGlyph(): this` (which delegates to `setHeaderGlyph(null)`). `Column.resolve` ([Column.ts:93](../src/typescript/lib/component/table/Column.ts#L93)) needs no change — the new field rides on the existing `ColumnConfig` plumbing.

3. **Extend `HeaderCell` constructor and add the runtime setter pair.** [cell/Header.ts](../src/typescript/lib/component/table/cell/Header.ts):
   - Add `private _headerGlyph: string | null = null;` and `private _headerGlyphInstance: Glyph | null = null;` fields.
   - Add optional third `headerGlyph?: string | null` constructor parameter; assign to `_headerGlyph`.
   - Add `setHeaderGlyph(name: string | null): this` (mounts/detaches the absolute-positioned `Glyph`, updates the renderer's left inset; see Internal Structure).
   - Add `getHeaderGlyph(): string | null` returning `_headerGlyph`.
   - In `init()` ([cell/Header.ts:65](../src/typescript/lib/component/table/cell/Header.ts#L65)), after the existing badge/handle setup, call `this.setHeaderGlyph(this._headerGlyph)` to materialise the glyph for the constructor-time case.
   - Import `Glyph` from `~/component/display/Glyph.js` and `Insets` from `~/primitive/Insets.js`.

4. **Thread `Column[]` through `Header`.** [Header.ts](../src/typescript/lib/component/table/Header.ts):
   - Add `private columns: Column[] = [];`.
   - Add `setColumns(columns: Column[]): this` that stores the list and calls `rebuildCells()`.
   - In `rebuildCells()` ([Header.ts:209](../src/typescript/lib/component/table/Header.ts#L209)), build a `Map<string, Column>` from `this.columns` keyed by `field.getName()`, then pass `columnMap.get(field.getName())?.getHeaderGlyph() ?? null` as the third argument to `new HeaderCell(...)`.
   - Import `Column` from `~/component/table/Column.js`.

5. **Wire from `Table` to `Header`.** [Table.ts](../src/typescript/lib/component/table/Table.ts):
   - After `this.addComponent(this.header)` in the constructor ([Table.ts:121](../src/typescript/lib/component/table/Table.ts#L121)), call `this.header.setColumns(this.resolvedColumns)`.
   - In `setStore()` ([Table.ts:202](../src/typescript/lib/component/table/Table.ts#L202)), after `this.header.setModel(store.model)`, call `this.header.setColumns(this.resolvedColumns)`.

6. **Add theme tokens.** [Theme.ts](../src/typescript/lib/core/Theme.ts):
   - Extend the `Theme` interface's `table.header` block ([Theme.ts:101](../src/typescript/lib/core/Theme.ts#L101)) with `glyph: { gap: string; color: string }`.
   - Add the `glyph` entry to `DefaultTheme.table.header` ([Theme.ts:306](../src/typescript/lib/core/Theme.ts#L306)) with `{ gap: '4px', color: 'currentColor' }`.
   - Add the same shape to `DarkTheme.table.header` ([Theme.ts:460](../src/typescript/lib/core/Theme.ts#L460)).
   - In `themeToVars` ([Theme.ts:599](../src/typescript/lib/core/Theme.ts#L599)), add `'--ts-ui-table-header-glyph-gap': theme.table.header.glyph.gap` and `'--ts-ui-table-header-glyph-color': theme.table.header.glyph.color` directly after `--ts-ui-table-header-font-size`.

7. **Regression checkpoint.** `grep -rn '--ts-ui-table-header-glyph' src/` — expect two entries in `Theme.ts` (var declarations in `themeToVars`) plus the two `var(...)` consumer references in `cell/Header.ts`. `grep -rn 'headerGlyph' src/` — expect entries in `ColumnConfig.ts`, `Column.ts`, `Header.ts`, `cell/Header.ts`, and no stray references.

8. **Verify the no-glyph path is byte-identical.** Render `new Table(store)` with no `ColumnSpec` (or with a spec that omits `headerGlyph` on every column). The `<th>` DOM under `init()` must contain exactly the same children as today: the renderer wrapper, the resize-handle `<div>`, and the priority-badge `<span>`. No new child appended. Confirm by inspecting the DOM in the dev server's Inspector.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/table/ColumnConfig.ts` |
| Modify | `src/typescript/lib/component/table/Column.ts` |
| Modify | `src/typescript/lib/component/table/Header.ts` |
| Modify | `src/typescript/lib/component/table/Table.ts` |
| Modify | `src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `src/typescript/lib/core/Theme.ts` |

No files created. No files deleted. No public exports change — `Column` and `ColumnConfig` are already exported from [component/table/index.ts:5-6](../src/typescript/lib/component/table/index.ts#L5).

---

## Verification

1. **Type check:**
   ```
   npm run typecheck
   ```

2. **Library build:**
   ```
   npm run build:lib
   ```

3. **Grep invariants:**
   ```
   grep -rn 'headerGlyph' src/typescript/lib/
   grep -rn '--ts-ui-table-header-glyph' src/typescript/lib/
   ```
   Expect entries only in `ColumnConfig.ts`, `Column.ts`, `Header.ts`, `cell/Header.ts`, and `Theme.ts`.

4. **Dev-server smoke test** (`npm run dev`, http://localhost:8015):
   - In a demo screen that already renders a `Table` with a `ColumnSpec` (the MiscPanel slow-table fixture is convenient), add `headerGlyph: "times"` to one column entry. Confirm the X glyph appears at the left edge of that column's header, vertically centred, with the text shifted right so it does not overlap.
   - Confirm columns without `headerGlyph` render with no left-side glyph and no reserved gap (visually identical to before).
   - Click the header with the glyph — sort still cycles asc → desc → cleared, the ▲/▼ arrow still appears after the text, and the priority badge still anchors to the cell's right edge when multi-sort is active.
   - Drag the resize handle at the right edge — drag still works and is unaffected by the glyph on the left.
   - Programmatic API: call `table.getColumns()[0].setHeaderGlyph("arrow-down")` from the console and confirm the glyph appears after a header rebuild (or trigger a rebuild via `setHiddenColumns`); `clearHeaderGlyph()` removes it.

5. **Theme toggle:** switch between light and dark themes. The header glyph must recolour with the surrounding header text (`currentColor` contract). The 4px gap remains constant.

6. **`npm run docs:build`** — 0 errors, 0 link warnings. (The lone acceptable warning is typedoc's pre-existing "unsupported TypeScript version" notice.)

7. **Refresh the knowledge graph:**
   ```
   graphify update . --directed
   ```

---

## Documentation Impact

`Column`, `ColumnConfig`, and `HeaderCell` are already exported from [component/table/index.ts](../src/typescript/lib/component/table/index.ts) — no barrel changes.

JSDoc on the new `Column` methods stays within the `component/table` bucket and can use `{@link Column}` / `{@link ColumnConfig}` freely. The reference from `HeaderCell` JSDoc to `Glyph` is cross-bucket (`component/display`) and must use the markdown form: `` [`Glyph`](/api/component/display/classes/Glyph) ``.

The curated docs page covering the table component lives under `docs/component/table/` — add a short subsection under the column-configuration section showing the `headerGlyph` field on `ColumnConfig` and the `setHeaderGlyph` runtime API on `Column`. Update its catalog `index.md` and the sidebar in `docs/.vitepress/config.mts` only if the table page index entry needs the new subsection linked.

---

## Potential Challenges

- **Renderer left inset shift.** The `setInsets` override on the renderer must be reverted to the theme default when the glyph is cleared, otherwise the text stays shifted. Capture the theme padding from `ThemeManager.getTheme().table.cell.padding` (the same value used by [CellRenderer](../src/typescript/lib/component/table/cell/renderer/CellRenderer.ts#L26)) on every call rather than caching it, so a theme change mid-life still produces the right padding.
- **Theme-changed gap recalculation.** The text-shift offset hard-codes `16` (Glyph default width) and `4` (gap default). A theme override of `--ts-ui-table-header-glyph-gap` to a different pixel count would visually pad the wrong amount unless the offset is recomputed. Mitigation: subscribe to `ThemeManager.onThemeChange` in `setHeaderGlyph` and re-read the gap from the theme block (`theme.table.header.glyph.gap` as a parsed pixel number), or — simpler — keep the offset formula `16 + theme.table.header.glyph.gap-as-px + theme.table.cell.padding`. Pick the simpler path during implementation; if themes never change the gap in practice, hard-coding `4` is acceptable.
- **`init()` runs once.** `HeaderCell.init()` is called once when the cell renders; the constructor-time glyph mounts there. A `setHeaderGlyph` call before render must defer to `init` — the body's `if (!el) return this;` early-out handles that, and `init` re-invokes `setHeaderGlyph` after element creation.
- **Column rebuild path.** `Header.setModel` short-circuits when the visible field list is unchanged ([Header.ts:76-87](../src/typescript/lib/component/table/Header.ts#L76)). If `setColumns` is called with a list whose glyphs changed but whose fields did not, cells are not rebuilt and the glyph change is invisible. Mitigation: `setColumns` always calls `rebuildCells()` unconditionally; the cost is one DOM rebuild per `setColumns`, which is the same cost as the existing `setHiddenColumns` path.

---

## Critical Files

- [src/typescript/lib/component/table/Column.ts](../src/typescript/lib/component/table/Column.ts) — owner of the new field and setter triple.
- [src/typescript/lib/component/table/ColumnConfig.ts](../src/typescript/lib/component/table/ColumnConfig.ts) — public-facing entry point for declaring `headerGlyph`.
- [src/typescript/lib/component/table/cell/Header.ts](../src/typescript/lib/component/table/cell/Header.ts) — DOM site where the glyph is mounted; the existing resize-handle and priority-badge code at lines 83-103 is the pattern to mirror.
- [src/typescript/lib/component/table/Header.ts](../src/typescript/lib/component/table/Header.ts) — rebuilds cells; needs the new `setColumns` plumbing.
- [src/typescript/lib/component/table/Table.ts](../src/typescript/lib/component/table/Table.ts) — wires `Column[]` into `Header` at construction and on `setStore`.
- [src/typescript/lib/component/display/Glyph.ts](../src/typescript/lib/component/display/Glyph.ts) — `currentColor` contract, default 16×16 sizing, `pointer-events: none` usage.
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — all four theme blocks need the new `glyph` entry.

---

## Non-Goals

- **No right-side header glyph.** The sort arrow already occupies the right side of the text (as a suffix) and the priority badge occupies the cell's right edge. A second user-controlled glyph slot there is not requested.
- **No size override.** Header glyphs render at the `Glyph` default 16×16. A `setHeaderGlyphSize` setter is not exposed; if a use case appears, add it then.
- **No icon-only headers.** The glyph is always rendered to the left of the text; suppressing the text label is out of scope. Use an empty `Field.getName()` is not supported and would break sort.
- **No glyph in `FooterRow`.** Footer cells are a different code path ([Footer.ts](../src/typescript/lib/component/table/Footer.ts)); this plan touches header only.
- **No `IconText`-based refactor of `HeaderCell`.** Documented in Architecture Decisions — would force the existing sort and priority code to learn a new internal shape.
