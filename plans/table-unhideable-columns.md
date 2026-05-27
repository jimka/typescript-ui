# Table Unhideable Columns — Implementation Plan

## Overview

Adds a first-class `unhideable?: boolean` field to [`ColumnConfig`](../src/typescript/lib/component/table/ColumnConfig.ts) so a column spec can declare "the user must never hide this." A column marked unhideable always renders; its entry in the column context menu appears with the visible checkmark and is greyed out so the user still sees the column's identity but cannot toggle it off.

The flag is resolved at construction by [`Column.resolve`](../src/typescript/lib/component/table/Column.ts#L153) and surfaced via a new accessor `Column.isUnhideable()` (shape-matched to the existing [`isInitiallyHidden()`](../src/typescript/lib/component/table/Column.ts#L75)). [`Table.setColumnVisible`](../src/typescript/lib/component/table/Table.ts#L265), the column context menu in [`Table.showColumnMenu`](../src/typescript/lib/component/table/Table.ts#L590), and the lower-level [`Header.setHiddenColumns`](../src/typescript/lib/component/table/Header.ts#L107) / [`Body.setHiddenColumns`](../src/typescript/lib/component/table/Body.ts#L306) all consult the column-level flag directly. The interim protected `isColumnHideable(fieldName)` seam introduced on `feature/tree-table` is removed — there is one path, not two.

[`TreeTable`](../src/typescript/lib/component/table/TreeTable.ts) stops carrying its own `isColumnHideable` override and the constructor-time `super.setColumnVisible(spec.treeColumn, true)` poke. Instead the constructor overlays `unhideable: true` on the resolved `Column` whose field matches `spec.treeColumn`, so the canonical guard rail (the tree column never disappears) is enforced by the same single mechanism every consumer-declared unhideable column uses.

---

## Architecture Decisions

### Field name — `unhideable`

`unhideable: true` reads naturally as "the user cannot hide this column." Alternatives considered and rejected:

- `pinnedVisible` — collides conceptually with `feature/table-column-pinning` (frozen-at-edge layout), which is unrelated.
- `alwaysVisible` — ambiguous: could mean "scroll-locked" or "never hidden." Conflates with sticky positioning.
- `required` — domain-loaded; suggests data-entry semantics on the model side, not column UI behaviour.
- `permanent` — too strong; the column can still be excluded entirely from the spec by leaving it out, so it isn't truly permanent.

`unhideable` describes the user-facing capability the flag removes (the ability to hide) and reads cleanly in both the JSDoc and at call sites: `col.isUnhideable()`.

### Default — `false`

Every column is hideable unless explicitly marked otherwise. This matches the existing default of every other `ColumnConfig` boolean (`hidden`, `showSeconds`).

### Precedence when `unhideable: true` and `hidden: true` collide

`unhideable` wins. [`Table.initHiddenFromSpec`](../src/typescript/lib/component/table/Table.ts#L537) skips columns where `col.isUnhideable()` is true so they never enter `_hiddenColumns`, and [`Table.resetColumns`](../src/typescript/lib/component/table/Table.ts#L750) inherits the same behaviour by routing through `initHiddenFromSpec`. The combination is contradictory, not destructive — `Column.resolve` does not emit a warning to keep `Column.ts` free of `console` calls (consistent with the rest of the file). If a warning is warranted later, the right place is `Column.resolve` once, at construction, not on every `initHiddenFromSpec` rebuild.

### Resolution site — `Column.resolve`, not a Table-level overlay

The flag is a column-level descriptor and belongs on `Column`, populated by `Column.resolve` from `ColumnConfig.unhideable` the same way `headerGlyph`, `group`, and `groupColor` flow through today. No new overlay map on `Table`. The matching `Column.isUnhideable(): boolean` mirrors [`Column.isInitiallyHidden()`](../src/typescript/lib/component/table/Column.ts#L75) — read-only, no setter (per task constraints).

### TreeTable applies the flag via spec mutation, before `super(...)`

`TreeTable` already receives a `TreeTableSpec` extending `ColumnSpec`. Before forwarding the spec to `super(store, spec, ...)`, the `TreeTable` constructor builds a new spec whose `columns` array carries `unhideable: true` on the entry matching `spec.treeColumn` (and synthesises one if the tree column is not in `spec.columns`). The result flows through `Column.resolve` exactly like any other consumer-declared unhideable column — no parallel hook, no post-construction patch on the resolved `Column`.

Rejected alternatives:

- **Mutate the resolved `Column` after `super()` returns.** Possible but couples `TreeTable` to `Column`'s internal field shape. The spec-level overlay is the same path consumer code would take; `TreeTable` is now just another consumer.
- **Expose `Column.setUnhideable`.** Forbidden by the task ("not a runtime toggle"). Spec mutation pre-`super()` is the surgical answer.

### `setHiddenColumns` strips unhideable fields, in both `Header` and `Body`

`Body.setHiddenColumns` and `Header.setHiddenColumns` accept a `Set<string>` from `Table`. Today, `Table` already filters via `getEffectiveHiddenSet()`. After this change, `Body` and `Header` additionally drop any field name in the incoming set whose corresponding column reports `isUnhideable() === true`, so a direct caller (`table.getBody().setHiddenColumns(new Set([treeField]))`) cannot bypass the protection. This is the robust answer: trust no caller, including future internal ones. The pattern matches the existing tolerance posture (`setHiddenColumns` already silently no-ops when the field name isn't a known column).

`Header` needs the resolved `Column[]` to consult `isUnhideable()`; it already receives them via [`Header.setColumns`](../src/typescript/lib/component/table/Header.ts#L123) during construction. `Body` already receives a `Map<string, ColumnConfig>` via `setColumnConfigs` but that map carries raw configs, not resolved columns; this plan threads a `Column[]` (or a `Map<string, Column>`) into `Body` through a small new `setColumns` mirror so the body can read `isUnhideable()` directly without reaching back into `Table`. This mirrors the `Header.setColumns` shape introduced by the header-glyph plan.

### `Table.setColumnVisible` no-ops on unhideable columns

`Table.setColumnVisible(field, false)` checks `column.isUnhideable()` and returns `this` early without touching `_hiddenColumns`. `setColumnVisible(field, true)` runs normally — making an already-visible unhideable column "more visible" is harmless.

### Removal of `isColumnHideable`

The interim `protected isColumnHideable(fieldName)` hook on `Table` ([Table.ts:579](../src/typescript/lib/component/table/Table.ts#L579)) and the override on `TreeTable` ([TreeTable.ts:243](../src/typescript/lib/component/table/TreeTable.ts#L243)) both vanish. `Table.showColumnMenu` reads `column.isUnhideable()` directly. `TreeTable.setColumnVisible` override ([TreeTable.ts:223](../src/typescript/lib/component/table/TreeTable.ts#L223)) and the `super.setColumnVisible(spec.treeColumn, true)` poke in the constructor ([TreeTable.ts:108](../src/typescript/lib/component/table/TreeTable.ts#L108)) also vanish — the base-class `setColumnVisible` already rejects hides on unhideable columns, and `initHiddenFromSpec` already skips them, so the column never starts hidden either.

### Reset behaviour

`Table.resetColumns` ([Table.ts:750](../src/typescript/lib/component/table/Table.ts#L750)) already rebuilds visibility from the spec via `initHiddenFromSpec`. After the change, `initHiddenFromSpec` skips columns where `isUnhideable()` is true. An unhideable column therefore comes back visible on reset even if some external code path briefly forced it into `_hiddenColumns` (which it can't anymore, but defence-in-depth).

### `appendUnlisted: false` interaction

A column omitted from `spec.columns` is excluded from the resolved column list (Column.resolve at [Column.ts:163](../src/typescript/lib/component/table/Column.ts#L163)) and therefore from the menu and the layout. `unhideable: true` does not auto-add a column to the spec — declaring a column unhideable requires listing it. This is documented in the `ColumnConfig.unhideable` JSDoc.

### Export menu unaffected

`Table.exportCSV` / `exportJSON` ([Table.ts:672-689](../src/typescript/lib/component/table/Table.ts#L672)) consult `getColumns()` (or include all resolved when `includeHidden: true`). Neither path needs to know about `unhideable` — an unhideable column is just a column that happens to always be visible.

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
    /**
     * When `true` the user cannot hide this column via the context menu;
     * the entry renders disabled with the visible checkmark, and
     * `Table.setColumnVisible(field, false)` is a no-op. Takes precedence
     * over `hidden: true` — an unhideable column never starts hidden.
     *
     * Defaults to `false`. The flag does not auto-include the column when
     * `appendUnlisted: false` excludes unlisted fields; list the column
     * explicitly in `spec.columns` to mark it unhideable.
     */
    unhideable  ?: boolean;
    showSeconds ?: boolean;
    headerGlyph ?: string;
    group       ?: string;
    groupColor  ?: string;
}
```

### `Column` — new accessor

```typescript
// src/typescript/lib/component/table/Column.ts
export class Column {
    // ...existing methods

    /**
     * Returns whether this column is marked unhideable in the spec.
     * Unhideable columns always render and cannot be toggled off via
     * the column context menu or {@link Table.setColumnVisible}.
     *
     * @returns `true` when the spec declared `unhideable: true`.
     */
    isUnhideable(): boolean;
}
```

Cached backing field: `private _unhideable: boolean`, initialised from `config?.unhideable ?? false` in the constructor (same shape as `_hidden`). No `setUnhideable` setter — the flag is declared in the spec and frozen at construction.

### `Table.setColumnVisible` — behaviour clarification (signature unchanged)

```typescript
// src/typescript/lib/component/table/Table.ts
class Table {
    /**
     * Shows or hides the column identified by the given field name.
     *
     * Calls to hide a column marked `unhideable: true` in the spec are
     * a no-op — the column always remains visible. Calls to show any
     * column run normally.
     */
    setColumnVisible(fieldName: string, visible: boolean): this;
}
```

### `Body` — `setColumns` mirror (matches `Header.setColumns`)

```typescript
// src/typescript/lib/component/table/Body.ts
class Body {
    /**
     * Supplies the resolved column list so the body can read per-column
     * metadata (e.g. `isUnhideable()`) when filtering hidden-column sets.
     */
    setColumns(columns: Column[]): this;
}
```

`Body` already holds `_columnConfigs: Map<string, ColumnConfig>`; this plan adds `_columns: Column[]` (the resolved list). `Table` calls `this._body.setColumns(this._resolvedColumns)` once after `addComponent(this._body)` in the constructor, and again at the bottom of `setStore` alongside the existing `_header.setColumns` call. `Body.setHiddenColumns` then walks the incoming set and skips field names whose matching `Column` reports `isUnhideable() === true`.

---

## Implementation

### Spec-overlay helper in `TreeTable`

`TreeTable`'s constructor builds a new spec before calling `super`:

```typescript
constructor(store: AbstractStore, spec: TreeTableSpec) {
    const indentPx     = spec.indentPx ?? DEFAULT_INDENT_PX;
    const adjustedSpec = TreeTable.markTreeColumnUnhideable(spec);

    super(store, adjustedSpec, (s) => new TreeBody(s, {
        idField:     spec.idField,
        parentField: spec.parentField,
        treeColumn:  spec.treeColumn,
        indentPx,
    }));

    this._treeSpec = spec;
    this._treeBody = this.getBody() as TreeBody;
    this.getAria().setRole("treegrid");
}

/**
 * Returns a clone of `spec` with `unhideable: true` set on the column
 * matching `spec.treeColumn`. Synthesises a new ColumnConfig if the
 * tree column is not listed in `spec.columns`.
 */
private static markTreeColumnUnhideable(spec: TreeTableSpec): TreeTableSpec {
    const existing = spec.columns.find(c => c.field === spec.treeColumn);
    const updated  = existing
        ? spec.columns.map(c => c.field === spec.treeColumn ? { ...c, unhideable: true } : c)
        : [...spec.columns, { field: spec.treeColumn, unhideable: true }];

    return { ...spec, columns: updated };
}
```

The original `spec` is preserved on `this._treeSpec` so `getTreeSpec()` still returns what the consumer passed in. The cloned spec is what reaches `super()` and `Column.resolve`.

### `Table.showColumnMenu` — direct flag read

The `isColumnHideable(fieldName)` call at [Table.ts:628](../src/typescript/lib/component/table/Table.ts#L628) becomes:

```typescript
const hideable = !col.isUnhideable();
```

`col` is already in scope inside the `columns.forEach(col => { ... })` loop.

### `Table.setColumnVisible` — early-return on unhideable hide

At the top of the method, before the `if (visible)` branch:

```typescript
if (!visible) {
    const col = this._resolvedColumns.find(c => c.getField().getName() === fieldName);

    if (col && col.isUnhideable()) {
        return this;
    }
}
```

The lookup is O(n) but `n` is the column count, in practice < 100. No memoisation needed.

### `Table.initHiddenFromSpec` — skip unhideable columns

```typescript
private initHiddenFromSpec(): void {
    for (const col of this._resolvedColumns) {
        if (col.isInitiallyHidden() && !col.isUnhideable()) {
            this._hiddenColumns.add(col.getField().getName());
        }
    }
}
```

### `Header.setHiddenColumns` / `Body.setHiddenColumns` — strip unhideable fields

Each method gains a filter pass before storing the set:

```typescript
setHiddenColumns(hidden: Set<string>): this {
    const filtered = new Set<string>();

    for (const name of hidden) {
        const col = this._columns.find(c => c.getField().getName() === name);

        if (!col || !col.isUnhideable()) {
            filtered.add(name);
        }
    }

    this._hiddenColumns = filtered;
    // ...existing rebuild / re-render
}
```

`Header` already owns `_columns: Column[]` via [`setColumns`](../src/typescript/lib/component/table/Header.ts#L123). `Body` gains the new `_columns: Column[]` field and matching `setColumns(columns: Column[])` method described above.

---

## Ordered Implementation Steps

1. **Extend `ColumnConfig`.** [ColumnConfig.ts:12](../src/typescript/lib/component/table/ColumnConfig.ts#L12) — add `unhideable?: boolean` after `hidden`, with the JSDoc shown in **Public API**.

2. **Add the backing field and accessor on `Column`.** [Column.ts](../src/typescript/lib/component/table/Column.ts) — declare `private _unhideable: boolean;` next to `_hidden` at line 22; initialise in the constructor from `config?.unhideable ?? false` (mirrors `_hidden` at line 37); add `isUnhideable(): boolean { return this._unhideable; }` after `isInitiallyHidden()` at [line 75](../src/typescript/lib/component/table/Column.ts#L75). `Column.resolve` needs no change — the new field rides on the existing `configMap.get(...)` plumbing.

3. **Skip unhideable columns in `Table.initHiddenFromSpec`.** [Table.ts:537](../src/typescript/lib/component/table/Table.ts#L537) — add the `&& !col.isUnhideable()` clause shown in **Implementation**.

4. **Add early-return on unhideable hide in `Table.setColumnVisible`.** [Table.ts:265](../src/typescript/lib/component/table/Table.ts#L265) — insert the lookup + no-op block at the top of the method. Update the JSDoc to document the no-op behaviour for unhideable columns.

5. **Replace the `isColumnHideable` consumer in `Table.showColumnMenu`.** [Table.ts:628](../src/typescript/lib/component/table/Table.ts#L628) — change `const hideable = this.isColumnHideable(fieldName);` to `const hideable = !col.isUnhideable();`.

6. **Delete the `isColumnHideable` seam.** Remove the `protected isColumnHideable(_fieldName: string)` method entirely from [Table.ts:579-581](../src/typescript/lib/component/table/Table.ts#L579) (including its JSDoc).

7. **Thread `Column[]` into `Body`.** [Body.ts](../src/typescript/lib/component/table/Body.ts):
   - Add `private _columns: Column[] = [];` next to the existing `_columnConfigs` field.
   - Add `setColumns(columns: Column[]): this` that stores the list and calls `clearRowPool(); renderWindow();` (matches `setColumnConfigs` shape at [Body.ts:314](../src/typescript/lib/component/table/Body.ts#L314)).
   - Import `Column` from `~/component/table/Column.js` at the top of the file.

8. **Wire `Body.setColumns` from `Table`.** [Table.ts:131-148](../src/typescript/lib/component/table/Table.ts#L131):
   - After `this.addComponent(this._body)` (line 133), add `this._body.setColumns(this._resolvedColumns);`.
   - In `setStore` ([Table.ts:204](../src/typescript/lib/component/table/Table.ts#L204)), after `this._header.setColumns(this._resolvedColumns)` (line 212), add `this._body.setColumns(this._resolvedColumns);`.

9. **Filter unhideable fields out of `Body.setHiddenColumns`.** [Body.ts:306](../src/typescript/lib/component/table/Body.ts#L306) — wrap the incoming set with the filter shown in **Implementation** before assigning to `_hiddenColumns`. Keep the existing `clearRowPool() + renderWindow()` calls.

10. **Filter unhideable fields out of `Header.setHiddenColumns`.** [Header.ts:107](../src/typescript/lib/component/table/Header.ts#L107) — same filter shape, walking `this._columns` (already present).

11. **Mark the tree column unhideable in `TreeTable`.** [TreeTable.ts](../src/typescript/lib/component/table/TreeTable.ts):
    - Add the `private static markTreeColumnUnhideable(spec): TreeTableSpec` helper shown in **Implementation**.
    - In the constructor, build `adjustedSpec = TreeTable.markTreeColumnUnhideable(spec)` before `super()` and pass `adjustedSpec` as the second argument to `super()`.
    - Keep `this._treeSpec = spec;` — consumers reading `getTreeSpec()` should see what they passed in, not the cloned spec.

12. **Remove the obsolete TreeTable overrides.** [TreeTable.ts](../src/typescript/lib/component/table/TreeTable.ts):
    - Delete `setColumnVisible(fieldName, visible)` at [lines 223-231](../src/typescript/lib/component/table/TreeTable.ts#L223) — base class now enforces.
    - Delete `protected isColumnHideable(fieldName)` at [lines 243-245](../src/typescript/lib/component/table/TreeTable.ts#L243) — base class no longer reads it.
    - Delete the `super.setColumnVisible(spec.treeColumn, true);` line at [Table.ts:108](../src/typescript/lib/component/table/TreeTable.ts#L108) — `initHiddenFromSpec` now skips the column.

13. **Regression checkpoint.**
    ```
    grep -rn 'isColumnHideable' src/typescript/lib/
    ```
    Expect zero matches.
    ```
    grep -rn 'unhideable' src/typescript/lib/
    ```
    Expect entries in `ColumnConfig.ts`, `Column.ts`, `Table.ts`, `Body.ts`, `Header.ts`, and `TreeTable.ts` — and nowhere else.

14. **Typecheck.**
    ```
    npx tsc --noEmit -p tsconfig.lib.json
    ```
    Expect 0 errors.

15. **Docs build.**
    ```
    npm run docs:build
    ```
    Expect 0 errors and the baseline 5 link warnings only (the typedoc "unsupported TypeScript version" notice is acceptable).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/table/ColumnConfig.ts` |
| Modify | `src/typescript/lib/component/table/Column.ts` |
| Modify | `src/typescript/lib/component/table/Table.ts` |
| Modify | `src/typescript/lib/component/table/Body.ts` |
| Modify | `src/typescript/lib/component/table/Header.ts` |
| Modify | `src/typescript/lib/component/table/TreeTable.ts` |
| Modify | `docs/components/Table.md` |
| Modify | `docs/components/TreeTable.md` |

No files created. No files deleted (the removed code lives inside files that survive).

---

## Verification

1. **Typecheck.**
   ```
   npx tsc --noEmit -p tsconfig.lib.json
   ```
   0 errors.

2. **Docs build.**
   ```
   npm run docs:build
   ```
   0 errors and 0 new link warnings beyond the 5-warning baseline.

3. **Grep invariants.**
   ```
   grep -rn 'isColumnHideable' src/typescript/lib/   # expect zero matches
   grep -rn 'unhideable'        src/typescript/lib/   # expect entries only in the six modified files
   ```

4. **Manual smoke test** (`npm run dev`, http://localhost:8015):
   - **Menu entry rendering.** In a demo `Table` with `ColumnSpec`, add `{ field: 'id', unhideable: true }`. Right-click a header to open the column menu — the `id` entry shows the visible checkmark and is greyed out. Click it: nothing happens.
   - **`unhideable: true, hidden: true` precedence.** Add `{ field: 'id', unhideable: true, hidden: true }` to a spec. Open the table — the `id` column starts visible (not hidden); the menu entry is greyed out with the checkmark.
   - **`setColumnVisible` no-op.** In the console: `table.setColumnVisible('id', false)` — column stays visible. `table.getColumnVisible?.('id')` (or check `table.getColumns()`) returns / contains it.
   - **`Body.setHiddenColumns` strips unhideable fields.** In the console: `table.getBody().setHiddenColumns(new Set(['id', 'name']))` — `name` hides, `id` stays visible. (`Header.setHiddenColumns` mirrors the same behaviour, but in practice `Table` is the sole caller.)
   - **TreeTable auto-marks the tree column.** Open the `TreeTable` demo, right-click the header — the tree-column entry (e.g. `name`) is greyed out, the others toggle normally. Try the console: `tree.setColumnVisible('name', false)` — no-op, the tree column stays visible.
   - **Consumer-marked unhideable on a non-tree TreeTable column.** Add `unhideable: true` to a non-tree column in the `TreeTable` spec. Confirm it also greys out and resists hiding.
   - **Reset.** From the menu, "Reset columns" — unhideable columns stay visible (regardless of any prior toggling attempt). Other columns return to their spec-defined initial visibility.

5. **Refresh the knowledge graph.**
   ```
   graphify update . --directed
   ```

---

## Documentation Impact

### `docs/components/Table.md`

Extend the `ColumnConfig` table at [docs/components/Table.md:43-51](../docs/components/Table.md#L43) with a new row:

```
| `unhideable` | When `true`, the user cannot hide this column from the context menu. Takes precedence over `hidden`. |
```

Place the row after `hidden` (the two flags are related). The existing `appendUnlisted` note below the table need not change — the JSDoc covers the "must be listed to be marked unhideable" caveat.

### `docs/components/TreeTable.md`

Add one sentence to the `TreeTableSpec` section ([docs/components/TreeTable.md:52](../docs/components/TreeTable.md#L52)):

> The tree column is automatically marked `unhideable: true` so the indent and expand/collapse toggle always have a place to render. You may also declare `unhideable: true` on any other column in `spec.columns`.

### API JSDoc

- `ColumnConfig.unhideable` — JSDoc shown in **Public API**, includes precedence note and `appendUnlisted: false` caveat.
- `Column.isUnhideable` — shape-matched to `isInitiallyHidden`.
- `Table.setColumnVisible` — extend the existing JSDoc with the no-op clause for unhideable columns.

No barrel changes (no new public symbol — `Column` and `ColumnConfig` are already exported from [component/table/index.ts](../src/typescript/lib/component/table/index.ts)). No cross-bucket links needed; the only references are within `component/table`.

---

## Potential Challenges

- **Stale `_columns` in `Body` after `setStore`.** `setStore` already calls `this._header.setColumns(this._resolvedColumns)`; the new `this._body.setColumns(this._resolvedColumns)` must be paired in the same place or `Body.setHiddenColumns` will consult an out-of-date column list. The plan calls this out in Step 8.
- **`Header.setHiddenColumns` called before `setColumns`.** During construction, `Table` runs `Header.setHiddenColumns` after `_header.setColumns(this._resolvedColumns)` at [Table.ts:129](../src/typescript/lib/component/table/Table.ts#L129). The ordering is already correct; adding the filter in `Header.setHiddenColumns` does not break the construction sequence. Verify by inspecting the surrounding lines during step 10.
- **`TreeTable.markTreeColumnUnhideable` clones, doesn't mutate.** Mutating the consumer's `ColumnSpec` in place would surprise call sites that reuse a spec across tables. The helper uses a spread (`{ ...c, unhideable: true }`) and returns a new spec object.
- **Tree column not listed in `spec.columns`.** The helper synthesises a `{ field: spec.treeColumn, unhideable: true }` entry. That entry has no `minWidth`/`maxWidth` — same as the spec carrying just `{ field: 'name' }`. No regression vs. today's behaviour (where the tree column also didn't need to be listed thanks to `appendUnlisted: true`'s default).
- **`TreeTable` with `appendUnlisted: false` and unlisted tree column.** The synthesised entry above lands in `spec.columns`, so the tree column appears in the resolved list as required. Without the synthesis, `appendUnlisted: false` would silently drop the tree column — the synthesis closes that hole.

---

## Critical Files

- [src/typescript/lib/component/table/ColumnConfig.ts](../src/typescript/lib/component/table/ColumnConfig.ts) — public-facing entry point for declaring `unhideable`.
- [src/typescript/lib/component/table/Column.ts](../src/typescript/lib/component/table/Column.ts) — owner of the new field; mirror the `_hidden` / `isInitiallyHidden` pair.
- [src/typescript/lib/component/table/Table.ts](../src/typescript/lib/component/table/Table.ts) — five touch points: `setColumnVisible`, `initHiddenFromSpec`, `showColumnMenu`, the `isColumnHideable` removal, and the new `_body.setColumns` wiring.
- [src/typescript/lib/component/table/Body.ts](../src/typescript/lib/component/table/Body.ts) — new `setColumns` + filter pass in `setHiddenColumns`.
- [src/typescript/lib/component/table/Header.ts](../src/typescript/lib/component/table/Header.ts) — filter pass in `setHiddenColumns`; `_columns` field already present.
- [src/typescript/lib/component/table/TreeTable.ts](../src/typescript/lib/component/table/TreeTable.ts) — overlay helper + override removal.
- [plans/implemented/tree-table.md](../plans/implemented/tree-table.md) — context for the interim `isColumnHideable` seam this plan supersedes (Audit cycle 1).

---

## Non-Goals

- **No export-path changes.** `exportCSV` / `exportJSON` continue to honour `getColumns()` (visible by default) or include-all when `includeHidden: true`. An unhideable column is just a column that happens to always be visible — no special handling needed.
- **No drag-resize change.** Resize handles on unhideable columns behave exactly as on hideable columns (min/max width still apply).
- **No "lock icon" in the menu.** Disabled state with the visible checkmark suffices visually; adding a lock glyph is not requested.
- **No `Column.setUnhideable` setter.** The flag is declared in the spec and resolved at construction. Runtime toggling is out of scope; if a use case appears later, expose a setter then.
- **No auto-add of unhideable columns to a strict spec.** When `appendUnlisted: false` excludes a field that's not listed in `spec.columns`, declaring `unhideable: true` on an absent entry does not auto-include it — the column must be listed explicitly. Documented in the JSDoc.
- **No `console.warn` for `unhideable: true, hidden: true`.** Precedence is documented; `Column.resolve` stays free of `console` calls.
