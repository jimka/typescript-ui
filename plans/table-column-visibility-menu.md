---
touches-shared: [packages/lib/docs/components/Table.md, packages/lib/docs/components/Menu.md, packages/lib/docs/reference/changelog/next.md]
---

# Table Column Visibility Menu — Implementation Plan

## Overview

`Table`'s header right-click menu currently lists every column as a top-level row, so on a wide table the column toggles push "Reset columns", "Filter", and the export entries far down a very long panel ([`Table.ts:1445-1496`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1445)). This plan moves those toggles off the top level into one of two places, chosen by column count: a **submenu** when the table has 20 or fewer resolved columns, and a **modal dialog** of checkboxes when it has more.

Everything else in the menu is untouched. "Reset columns", the optional "Filter" toggle, the optional export entries, and the rotated-mode export-only branch keep their current text, order, and behaviour in the top-level list.

The work is confined to [`Table.ts`](../packages/lib/src/typescript/lib/component/table/Table.ts): four new module constants, one new private field, four new private methods, and one rewritten private method. No public API changes, no new component classes, no changes to `Menu`, `MenuItem`, `Dialog`, or `Checkbox`.

---

## Architecture Decisions

### The submenu mirrors `TabBar`'s context-menu submenu

The `≤ 20` path builds `{ text: 'Show/hide columns', submenu: { label: 'Show/hide columns', items: [...] } }` — the same shape [`TabBar.openTabMenu`](../packages/lib/src/typescript/lib/component/container/TabBar.ts#L1772) already ships for its "Switch to" and "Tools" rows, on the same kind of rebuild-mode `Menu` field.[^tabbar-precedent] The submenu's `items` is a plain array, not a provider function.[^array-not-provider]

### Check state uses `MenuItemConfig.checked`, not a text prefix

Each column row sets `checked: visible` and drops the hand-written `'✓ '` / `'  '` prefix. `MenuItem` renders the mark in a dedicated leading zone and `Menu.layOutColumns` reserves that zone for the whole panel, so checked and unchecked rows keep their labels at the same x position ([`MenuItem.ts:50-66`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L50), [`Menu.ts:207`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L207)).[^checked-cleanup] The top-level "Filter" entry keeps its text-prefix form — it is out of scope here.

### The dialog body is a `Component` + `VBox`; the `Dialog` supplies the scrolling

The `> 20` path passes a plain `Component` with a `VBox` layout manager as `contentComponent`, exactly as the dialog recipe's custom-content example does ([`dialog-modal.md`](../packages/lib/docs/recipes/dialog-modal.md)). No scroll container is built by hand: `Dialog`'s own content area is already a `Panel` with `autoScroll: "y"`, and `Dialog.resizeToContent` caps the panel at the viewport so a taller body scrolls inside it ([`Dialog.ts:620-624`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L620), [`DialogCappedScroll.test.ts`](../packages/lib/tests/overlay/DialogCappedScroll.test.ts)).[^no-hand-rolled-scroll] The dialog is given a `width` but no `height`.[^no-height]

### Checkbox edits are staged in a local `Set`; only Apply writes to the table

Opening the dialog captures `snapshot = new Set(this._hiddenColumns)` and `staged = new Set(snapshot)`. Every checkbox `change` listener mutates `staged` only. Apply walks the columns and calls `setColumnVisible` for each field where `staged` and `snapshot` disagree; Cancel, the title-bar ×, Escape, and a dispose-while-open all return without writing anything.[^snapshot-is-the-baseline]

### `Table` owns the open dialog and disposes it

`Dialog` disposes its own content component and every checkbox under it when it closes ([`Dialog.ts:1119-1137`](../packages/lib/src/typescript/lib/overlay/Dialog.ts#L1119)), so the caller never disposes the body. But a `Dialog` is a `LayerManager`-mounted overlay, not a registered child, so `Table`'s destructor recursion cannot reach one that is still open. `Table` therefore holds it in a `_columnDialog` field and disposes it in `destructor()`, mirroring what the file already does for `_columnContextMenu` ([`Table.ts:1415-1420`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1415)).[^dispose-open-dialog]

### The threshold is a module-level constant, not an option

`COLUMN_MENU_DIALOG_THRESHOLD = 20` joins the existing `SCREAMING_SNAKE` block of width-policy constants at the top of `Table.ts` ([`Table.ts:48-71`](../packages/lib/src/typescript/lib/component/table/Table.ts#L48)), each carrying a trailing `//` comment — the same convention `Header.ts` uses for `COLUMN_FILTER_DEBOUNCE_MS`. It is not exposed on `ColumnSpec` or `TableOptions`.[^not-an-option]

### The group indent stays, expressed as insets in the dialog

Grouped columns are indented under their group header in both paths: non-breaking spaces in the submenu (kept verbatim from today's code) and a left inset on the `Checkbox` in the dialog. The indent encodes which group a row belongs to, the same structural job `TreeCellRenderer`'s `DEFAULT_INDENT_PX` does for tree depth — it is not the cosmetic nudge [ARCHITECTURE.md](../ARCHITECTURE.md)'s *No cosmetic insets or padding* rule forbids.[^indent-is-structural]

---

## Internal Structure

### New module constants (`Table.ts`, appended to the constant block at lines 48-71)

```typescript
// Column show/hide entries. At or below the threshold they live in a submenu of
// the header context menu; past it a leaf row opens a modal dialog instead,
// which lists far more rows comfortably and scrolls.
const COLUMN_MENU_DIALOG_THRESHOLD  = 20;   // Resolved columns above which the dialog replaces the submenu.
const COLUMN_DIALOG_WIDTH_PX        = 360;  // Dialog panel width; fits a field name beside its checkbox.
const COLUMN_DIALOG_INSET_PX        = 16;   // Body inset, matching the padding Dialog gives its own message text.
const COLUMN_DIALOG_GROUP_INDENT_PX = 16;   // One nesting level, matching the submenu's group indent.
```

### New private field

```typescript
// The open column dialog, or null. A LayerManager-mounted overlay, never a
// registered child, so `destructor()` disposes it explicitly.
private _columnDialog: Dialog | null = null;
```

### Ordered column list, shared by both paths

```typescript
private columnsInMenuOrder(): Column[] {
    return this._resolvedColumns
        .slice()
        .sort((a, b) => a.getField().getOrder() - b.getField().getOrder());
}
```

This is the sort already inlined at [`Table.ts:1445-1447`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1445), lifted so `showColumnMenu` and `showColumnDialog` share one order.

### The grouping rule (both paths)

Walk the ordered columns. Track `lastGroup`, starting at `undefined`. For each column, with `group = col.getGroup()`:

1. If `group !== lastGroup` **and** at least one row has already been emitted → emit a separator (submenu only; the dialog emits nothing here).
2. If `group !== lastGroup` **and** `group !== null` → emit a group-header row (`{ text: group, enabled: false }` in the submenu; a bold `Text` in the dialog).
3. Emit the column's own row, indented when `group !== null`.
4. `lastGroup = group`.

Worked against the demo app's 10-column spec ([`MiscPanel.ts:605-626`](../packages/lib/src/typescript/MiscPanel.ts#L605) — `Name` is `unhideable`, `Notes` and `locked` start `hidden`), the submenu renders:

```
Identity                 ← disabled group header
    ✓ Name               ← disabled (unhideable), still checked
    ✓ Active
─────────────            ← group changed Identity → ungrouped
✓ Score
✓ Role
─────────────            ← group changed ungrouped → Activity
Activity
    ✓ Joined
    ✓ Meeting
    ✓ LastSeen
─────────────            ← group changed Activity → ungrouped
✓ Manager
  Notes                  ← unchecked (hidden in the spec)
  locked
```

No separator leads the list: at the first group change no row has been emitted yet.

### The threshold branch

| Resolved columns | Top-level row |
| --- | --- |
| 0 | *(no row at all — the list starts at the separator before "Reset columns", exactly as today)* |
| 1 – 20 | `Show/hide columns` ▸ submenu |
| 21 + | `Show/hide columns…` → modal dialog |

### `showColumnMenu` after the change

The rotated-mode early return, the "Reset columns" pair, the "Filter" block, and the export block are all copied through unchanged. Only the column-row loop is replaced:

```typescript
const columns = this.columnsInMenuOrder();
const items: MenuItemConfig[] = [];

if (columns.length > 0) {
    items.push(
        columns.length > COLUMN_MENU_DIALOG_THRESHOLD
            ? { text: 'Show/hide columns…', action: () => this.showColumnDialog() }
            : {
                text:    'Show/hide columns',
                submenu: { label: 'Show/hide columns', items: this.buildColumnMenuItems(columns) },
            }
    );
}
```

### `buildColumnMenuItems`

```typescript
private buildColumnMenuItems(columns: Column[]): MenuItemConfig[] {
    const items: MenuItemConfig[] = [];
    let lastGroup: string | null | undefined = undefined;

    // The indent uses non-breaking spaces (` `) because the menu item renders
    // text with the default `white-space: nowrap` setting, which still collapses
    // runs of ASCII spaces — regular `'    '` would render as a single space.
    const GROUP_INDENT = "    ";

    for (const col of columns) {
        const fieldName = col.getField().getName();
        const visible   = !this._hiddenColumns.has(fieldName);
        const group     = col.getGroup();

        if (group !== lastGroup) {
            if (items.length > 0) {
                items.push({ separator: true });
            }

            if (group !== null) {
                items.push({ text: group, enabled: false });
            }
        }

        items.push({
            text:    (group !== null ? GROUP_INDENT : "") + fieldName,
            checked: visible,
            action:  () => this.setColumnVisible(fieldName, !visible),
            enabled: !col.isUnhideable(),
        });

        lastGroup = group;
    }

    return items;
}
```

The four characters inside `GROUP_INDENT` above are literal U+00A0 non-breaking spaces, not ASCII spaces — copy the string and its comment verbatim from [`Table.ts:1461-1465`](../packages/lib/src/typescript/lib/component/table/Table.ts#L1461) rather than retyping them.

### `showColumnDialog` and `buildColumnDialogBody`

```typescript
private showColumnDialog(): void {
    const columns  = this.columnsInMenuOrder();
    const snapshot = new Set(this._hiddenColumns);
    const staged   = new Set(snapshot);

    const dialog = new Dialog({
        title:            'Show/hide columns',
        contentComponent: this.buildColumnDialogBody(columns, staged),
        width:            COLUMN_DIALOG_WIDTH_PX,
        buttons: [
            DialogButtons.Cancel,
            { ...DialogButtons.Confirm, text: 'Apply', primary: true },
        ],
    });

    this._columnDialog = dialog;

    void dialog.show().then(result => {
        this._columnDialog = null;

        if (result !== 'confirm') {
            return;
        }

        for (const col of columns) {
            const fieldName = col.getField().getName();

            if (staged.has(fieldName) !== snapshot.has(fieldName)) {
                this.setColumnVisible(fieldName, !staged.has(fieldName));
            }
        }
    });
}

private buildColumnDialogBody(columns: Column[], staged: Set<string>): Component {
    const rows: Component[] = [];
    let lastGroup: string | null | undefined = undefined;

    for (const col of columns) {
        const fieldName = col.getField().getName();
        const group     = col.getGroup();

        if (group !== lastGroup && group !== null) {
            rows.push(new Text(group, { fontWeight: "bold" }));
        }

        rows.push(new Checkbox({
            label:     fieldName,
            selected:  !staged.has(fieldName),
            enabled:   !col.isUnhideable(),
            insets:    group !== null
                ? new Insets(0, 0, 0, COLUMN_DIALOG_GROUP_INDENT_PX)
                : undefined,
            listeners: {
                change: (on: boolean) => {
                    if (on) {
                        staged.delete(fieldName);
                    } else {
                        staged.add(fieldName);
                    }
                },
            },
        }));

        lastGroup = group;
    }

    return new Component({
        layoutManager: new VBox({ itemAlign: "stretch" }),
        insets:        new Insets(COLUMN_DIALOG_INSET_PX, COLUMN_DIALOG_INSET_PX, COLUMN_DIALOG_INSET_PX, COLUMN_DIALOG_INSET_PX),
        components:    rows,
    });
}
```

### The Apply diff, worked

For a table whose hidden set at open time is `{ notes, city }`, after the user unticks `age` and ticks `notes`:

| Column | In `snapshot` | In `staged` | Written on Apply |
| --- | --- | --- | --- |
| `name` (unhideable) | no | no | — |
| `age` | no | yes | `setColumnVisible('age', false)` |
| `notes` | yes | no | `setColumnVisible('notes', true)` |
| `city` | yes | yes | — |
| `email` | no | no | — |

Two writes, not five. On Cancel the table is written to zero times regardless of what `staged` holds.

---

## Ordered Implementation Steps

1. **`Table.ts` — imports.** Add `Dialog, DialogButtons` from `~/overlay/Dialog.js`, `Checkbox` from `~/component/input/Checkbox.js`, `Text` from `~/component/input/Text.js`, and `VBox` from `~/layout/VBox.js`. `Component`, `Insets`, `Column`, and `MenuItemConfig` are already imported.
   *Check:* `npm run typecheck` still passes (no cycle — nothing under `overlay/` or `component/input/` imports `component/table/Table.js`).

2. **`Table.ts` — constants.** Append the four constants from `## Internal Structure` to the block ending at line 71, keeping the trailing-comment style of its neighbours.

3. **`Table.ts` — field.** Add `private _columnDialog: Dialog | null = null;` beside `_columnContextMenu` (line 157).

4. **`Table.ts` — destructor.** Add `this._columnDialog?.dispose();` to `destructor()` (line 1415), above the existing `this._columnContextMenu.dispose();`, and extend the method's JSDoc to say the dialog is disposed for the same reason.

5. **`Table.ts` — add the four private methods**, all purely additive so the file still compiles after this step: `columnsInMenuOrder()` (the sort currently inlined at lines 1445-1447, copied), `buildColumnMenuItems(columns)` (the column-row loop at lines 1449-1491, restructured per the grouping rule and using `checked`; `GROUP_INDENT` and its comment come along), `showColumnDialog()`, and `buildColumnDialogBody(columns, staged)` — each exactly as written in `## Internal Structure`. Place them after `showColumnMenu`.
   *Check:* `npm run typecheck`.

6. **`Table.ts` — rewrite `showColumnMenu`'s normal-mode body** to the shape in `## Internal Structure`, which deletes the now-duplicated inline sort and column-row loop and replaces them with the `columnsInMenuOrder()` call and the single trigger row. Leave the rotated branch, the "Reset columns" pair, the "Filter" block, and the export block byte-identical.
   *Check:* `npm run typecheck`, then `grep -n "'✓ '" packages/lib/src/typescript/lib/component/table/Table.ts` — expect exactly one match, the "Filter" entry.

7. **Create `packages/lib/tests/component/table/ColumnVisibilityMenu.test.ts`** covering every case in `## Expected Behaviour` marked *unit*. Mirror [`TabBar.contextMenu.test.ts`](../packages/lib/tests/component/container/TabBar.contextMenu.test.ts)'s `openMenuFor` / `labels` helpers and [`ColumnFilterRow.test.ts:604-614`](../packages/lib/tests/component/table/ColumnFilterRow.test.ts#L604)'s `capturedMenuItems` stub. For the dialog cases, stub reduced motion first so `Dialog.hide` settles synchronously:
   ```typescript
   vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} });
   ```
   (the same spy [`Dock.lifecycle.test.ts:907`](../packages/lib/tests/overlay/Dock.lifecycle.test.ts#L907) uses), reach the dialog through `(table as any)._columnDialog`, stage with `checkbox.setSelected(...)`, and finish with `dialog.hide('confirm')` followed by an `await` so the promise continuation runs.
   *Check:* `npm test`.

8. **Docs.** Apply the three edits in `## Documentation Impact`.
   *Check:* `npm run docs:api` finishes with zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Create | `packages/lib/tests/component/table/ColumnVisibilityMenu.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/docs/components/Menu.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

No file is deleted. `Menu.ts`, `MenuItem.ts`, `Dialog.ts`, `Checkbox.ts`, `Column.ts`, `Header.ts`, and `ColumnFilterRow.test.ts` are untouched.

---

## Expected Behaviour

**Top-level menu, normal mode** *(unit)*

1. A 10-column table's menu has exactly one column-related row, at index 0, with text `'Show/hide columns'` and a `submenu`. No `MenuItemConfig` at the top level carries a field name.
2. A 45-column table's menu has one row at index 0 with text `'Show/hide columns…'`, an `action`, and **no** `submenu`.
3. Exactly 20 resolved columns yields the submenu; exactly 21 yields the dialog row.
4. A table with zero resolved columns emits no column row at all: the list starts with a separator followed by `'Reset columns'`.
5. `'Reset columns'` still follows a separator, the `'Filter'` entry still follows `'Reset columns'` behind its own separator when any column is filterable, and the two export entries still trail behind a separator when `setExportMenuEnabled(true)`. Their texts are unchanged, including `'✓ Filter'` / `'  Filter'`.
6. Rotated mode is unchanged: with export enabled the menu is exactly the two export rows; with it disabled the menu does not open.

**Submenu contents** *(unit)*

7. Rows appear in field order, one per resolved column, each labelled with the field name.
8. `checked` is `true` for a visible column and `false` for one in `_hiddenColumns`. No row's `text` begins with `'✓ '` or `'  '`.
9. A group header row (`enabled: false`, no `checked`) precedes the first column of each grouped run, and only grouped runs get one.
10. A `{ separator: true }` row sits at every group boundary except before the first row. Mapping each row to its `text`, or to `'---'` when it is a separator, the worked example in `## Internal Structure` gives exactly:
    `['Identity', '␣Name', '␣Active', '---', 'Score', 'Role', '---', 'Activity', '␣Joined', '␣Meeting', '␣LastSeen', '---', 'Manager', 'Notes', 'locked']`, where `␣` stands for the four-non-breaking-space indent.
11. A column with `unhideable: true` has `enabled: false` and `checked: true`.
12. Invoking a visible column's row `action` removes that column from `table.getColumns()` and leaves every other column in place; rebuilding the submenu then shows that row with `checked: false`.

**Dialog** *(unit unless noted)*

13. Opening it (invoking the leaf row's `action`) sets `_columnDialog` to a live `Dialog` and leaves `_hiddenColumns` unchanged.
14. The body holds one `Checkbox` per resolved column in field order, plus one bold `Text` per grouped run placed before that run's first checkbox. Ungrouped runs contribute no `Text`.
15. Each `Checkbox`'s `isSelected()` matches the column's visibility at open time; an `unhideable` column's `Checkbox` is `isEnabled() === false` and selected.
16. Toggling checkboxes changes nothing on the table — `_hiddenColumns` is identical before and after, and no re-layout is triggered — until a button is pressed.
17. Apply (`hide('confirm')`) calls `setColumnVisible` exactly once per column whose staged state differs from the open-time snapshot, with the correct `visible` argument, and never for an unchanged or `unhideable` column.
18. Cancel (`hide('cancel')`), close (`hide('close')`), and Escape leave `_hiddenColumns` byte-identical to its open-time value even after every checkbox has been flipped.
19. After the dialog settles by any route, `_columnDialog` is `null`.
20. Disposing the table while the dialog is open does not throw, the dialog's promise settles, and no `setColumnVisible` call follows.
21. *(manual)* The dialog scrolls its checkbox list when the column count exceeds the viewport allowance, and the button row stays visible.

**Disposal** *(unit)*

22. Showing the menu and then disposing the table leaves no orphaned stylesheet rules — the existing `Table` row in [`dispose-full-teardown.test.ts:186-196`](../packages/lib/tests/component/dispose-full-teardown.test.ts#L186) keeps passing unmodified.

**Visual** *(manual)*

23. In the submenu, checked and unchecked rows' labels start at the same x, group headers sit one indent step left of their members, and the chevron on the trigger row is present.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — the new `ColumnVisibilityMenu.test.ts` plus the whole suite; `ColumnFilterRow.test.ts` tests 35-37 and `dispose-full-teardown.test.ts` must pass **unmodified**, which is the regression proof that the non-column parts of the menu are untouched.
- `npm run lint` — clean.
- `grep -n "'✓ '" packages/lib/src/typescript/lib/component/table/Table.ts` — exactly one match (the "Filter" entry).
- `grep -rn "COLUMN_MENU_DIALOG_THRESHOLD" packages/lib/src/typescript/lib/` — matches only in `Table.ts`.
- `npm run docs:api` — zero warnings.
- **Manual**, `npm run dev` at <http://localhost:8015>, the **Misc.** tab:
  - Right-click the 10-column spec table's header → "Show/hide columns" opens a submenu matching the worked example (group headers, separators, `Name` disabled, `Notes` / `locked` unchecked). Toggle a column; the menu closes and the column disappears.
  - Press **Show window with wide table (45 columns)!**, right-click that table's header → "Show/hide columns…" opens the dialog. Untick several columns, press **Cancel** — nothing changes. Reopen, untick the same columns, press **Apply** — exactly those disappear.
  - Reopen the dialog and press Escape — nothing changes.

---

## Documentation Impact

No exported symbol changes, so no TypeDoc or barrel work. Three prose edits:

1. **`packages/lib/docs/components/Table.md`** — expand the bullet at line 256 and add a short `### Showing and hiding columns` subsection immediately before `### Resizing columns` (line 259) describing the submenu, the dialog past 20 columns, that group names appear as section headers, that an `unhideable` column is listed but disabled, and that the dialog's Apply/Cancel are all-or-nothing. Cross-reference [`setColumnVisible`](/api/component/table/classes/Table#setcolumnvisible) in the existing link style.
2. **`packages/lib/docs/components/Menu.md`** — line 76 currently reads "Submenus inside right-click context menus are not in scope — submenu config is honoured only in persistent mode." That is wrong: `Menu.showAnchored` wires `handleItemOpenSubmenu` on every rebuild-mode item ([`Menu.ts:297`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L297)) and `TabBar` already ships one. Replace it with a bullet stating that submenus work in both modes and that a submenu panel is built fresh on each open.[^stale-menu-doc]
3. **`packages/lib/docs/reference/changelog/next.md`** — one bullet under the existing `## Changed` → `### Table` heading (line 10), leading with the user-visible change: the header context menu's per-column toggles now live in a "Show/hide columns" submenu, or a modal dialog past 20 columns. Note that no consumer action is needed.

---

## Potential Challenges

- **A submenu click still closes the whole menu chain.** `Menu.buildPersistentItems` runs the item's `action` and then the parent's `onClose`, which is `dismissAll()` ([`Menu.ts:927`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L927), [`Menu.ts:1006`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1006)). One toggle per open, exactly as today. Do not try to keep the panel open — see `## Non-Goals`.
- **A submenu panel is themed as a menu-bar dropdown, not a context menu.** `buildPersistentItems` builds its items with `MenuItem`'s default `"menu-bar"` CSS-variable prefix, so the submenu reads its background, border, and hover colours from the `--ts-ui-menu-bar-*` family while its parent uses `--ts-ui-context-menu-*`. Pre-existing and shared by every submenu in the library (`TabBar`'s included); leave it alone here.
- **Apply runs one `setColumnVisible` per changed column, each of which calls `doLayout()`.** Writing only the diff keeps that count at the number of boxes the user actually flipped. Do not add a batch API for this.
- **Importing `Dialog` into `Table.ts` pulls its module-level `Glyph.register` calls into every bundle containing `Table`.** Acceptable: `Table` already imports `Menu` from the same overlay layer, and the registry tolerates repeat registration.
- **`Dialog.hide` finishes through an animation callback, so the promise does not settle synchronously in tests.** Stub `DOM.source.matchMedia` to match, which routes `Animation.play` down its reduced-motion branch and fires `onComplete` on the same tick ([`Animation.ts:116-120`](../packages/lib/src/typescript/lib/core/Animation.ts#L116)).

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Table.ts`](../packages/lib/src/typescript/lib/component/table/Table.ts) — `showColumnMenu` (1431), `destructor` (1415), `setColumnVisible` (618), `resetColumns` (1712), the constant block (48-71), the private fields (155-157).
- [`packages/lib/src/typescript/lib/component/container/TabBar.ts`](../packages/lib/src/typescript/lib/component/container/TabBar.ts) — `openTabMenu` (1751): **the precedent this plan's submenu mirrors**, including the `_contextMenu` field (518) and its explicit dispose (808).
- [`packages/lib/src/typescript/lib/component/container/MenuItem.ts`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts) — `MenuItemConfig` (41) and its `checked` (66), `submenu` (87), `separator` (89) fields; `MenuConfig` (97).
- [`packages/lib/src/typescript/lib/overlay/Menu.ts`](../packages/lib/src/typescript/lib/overlay/Menu.ts) — `showAnchored` (279), `layOutColumns` (202), `handleItemOpenSubmenu` (1092), `dismissAll` (1006).
- [`packages/lib/src/typescript/lib/overlay/Dialog.ts`](../packages/lib/src/typescript/lib/overlay/Dialog.ts) — `DialogConfig` (76), `DialogButtons` (500), the `autoScroll` content `Panel` (620), `show` (756), `hide` / `finalize` (1115).
- [`packages/lib/src/typescript/lib/component/input/Checkbox.ts`](../packages/lib/src/typescript/lib/component/input/Checkbox.ts) — `CheckboxOptions` (22), `setSelected` (231); the `label` / `enabled` / `listeners` options come from [`AbstractBooleanInput.ts:17`](../packages/lib/src/typescript/lib/component/input/AbstractBooleanInput.ts#L17) and [`AbstractInput.ts:22-33`](../packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L22).
- [`packages/lib/src/typescript/lib/component/table/Column.ts`](../packages/lib/src/typescript/lib/component/table/Column.ts) — `getField` (65), `isUnhideable` (122), `getGroup` (186).
- [`packages/lib/tests/component/container/TabBar.contextMenu.test.ts`](../packages/lib/tests/component/container/TabBar.contextMenu.test.ts) — the `openMenuFor` / `labels` / submenu-reading test shape to copy.
- [`packages/lib/tests/component/table/ColumnFilterRow.test.ts`](../packages/lib/tests/component/table/ColumnFilterRow.test.ts#L603) — `capturedMenuItems` (604), and tests 35-37, which must keep passing untouched.
- [`packages/lib/docs/recipes/dialog-modal.md`](../packages/lib/docs/recipes/dialog-modal.md) — the custom-content composition the dialog body follows.

---

## Non-Goals

- **Keeping the menu or submenu open across several toggles.** That would mean changing `Menu`'s activation contract for every consumer; the dialog is the answer for multi-toggle work.
- **Converting the top-level "Filter" entry to `MenuItemConfig.checked`.** It stays a text prefix; changing it would break `ColumnFilterRow.test.ts` tests 35-37, which are this plan's regression proof.
- **A public option or `ColumnSpec` field for the threshold.** Hardcoded, per the decision above.
- **Search, "select all" / "select none", or reordering inside the dialog.** Not requested.
- **Any change to rotated mode.** Its export-only branch returns before the threshold branch is reached.
- **A batch `setColumnVisible` / `setHiddenColumns` API.** Apply loops the existing per-column setter over the diff.
- **Touching `Menu.ts`, `MenuItem.ts`, `Dialog.ts`, or `Checkbox.ts`.** Every capability this plan needs already exists on them. (`docs/components/Menu.md` *is* edited — see `## Documentation Impact` — but only to delete a sentence that contradicts what already ships.)

---

## Notes

[^tabbar-precedent]: `TabBar` holds a rebuild-mode `Menu` in a plain field, disposes it in its destructor, and builds `{ text, submenu: { label, items } }` rows inside the array it hands to `show()` — the identical situation, one layer up in the same overlay stack. Following it means the plan introduces no new pattern at all. It also settles a question the docs get wrong: `Menu.md` claims submenus are persistent-mode only, but `Menu.showAnchored` passes `handleItemOpenSubmenu` to every rebuild-mode `MenuItem` it constructs, and `TabBar` has shipped a context-menu submenu for some time.

[^array-not-provider]: `MenuConfig.items` also accepts a provider re-invoked on every submenu open. It buys nothing here: the parent menu is rebuilt from scratch on each `show()`, and any click inside the submenu closes the whole chain, so no state can change between building the array and reading it. An array is also directly assertable in tests, where a provider would force every assertion to call it first.

[^checked-cleanup]: `MenuItemConfig.checked` has existed and been rendered by `MenuItem` all along; this menu simply never used it, hand-prefixing `'✓ '` onto `text` instead — the exact approach the field's own JSDoc warns against, because the leading whitespace collapses inconsistently under `white-space: nowrap`. Adopting it here is incidental cleanup that falls out of rebuilding the rows, not a separate refactor: the rows are being rewritten anyway.

[^no-hand-rolled-scroll]: `Dialog`'s content region is a `Panel` constructed with `autoScroll: "y"` and a `Fit` layout, and `Dialog.clampsToContentSize()` returns `false` so `resizeToContent` can cap the panel at `viewport - 2 × 24px`. A plain `Component` body *does* clamp to its content size, so it keeps its full height inside that capped panel and the panel scrolls it — which is precisely the arrangement `DialogCappedScroll.test.ts` pins. Nesting a second `autoScroll` `Panel` inside would produce two scrollbars for one overflow.

[^no-height]: `resizeToContent` recomputes the height from the content and ignores `DialogConfig.height` entirely, and it runs via `Component.afterNextLayout` on every open. Passing a `height` would therefore be silently overridden after the first layout. Passing only `width` lets the dialog fit its content and cap at the viewport, which is the behaviour wanted.

[^snapshot-is-the-baseline]: Cancel is a no-op by construction — the only code that writes to the table lives inside the `result === 'confirm'` branch — so the snapshot is not what makes Cancel safe. Its job is to be the baseline the staged set is diffed against, so Apply issues one `setColumnVisible` per genuinely changed column rather than one per column. An `unhideable` column can never enter that diff: it is never in `_hiddenColumns` (`initHiddenFromSpec` skips it and `setColumnVisible(_, false)` refuses it), so it is in neither set, and its checkbox is disabled so its `change` listener never fires.

[^dispose-open-dialog]: `Component.destructor()` recurses through `_components`, which is how the dialog's own teardown reaches its content component and every `Checkbox` under it — hence no caller-side disposal. But `Dialog` mounts itself through `LayerManager`, so it is not in *`Table`*'s `_components` and an ancestor teardown cannot reach it. Without the explicit dispose, closing a window while the dialog is open would leave a modal backdrop over the app and a promise that never settles. `Dialog.destructor` handles that route: it destroys the backdrop, unregisters the layer, and resolves the pending promise with `'close'` — which lands in the `result !== 'confirm'` early return, so nothing is written to the now-dead table.

[^not-an-option]: The threshold is a presentation heuristic about when a list stops being comfortable in a menu panel, not a property of a table's data or of any column. Exposing it would add a public surface that has to be documented, defaulted, and supported forever, in exchange for a knob no caller has asked for. `Header.ts` treats its own `COLUMN_FILTER_DEBOUNCE_MS` the same way.

[^indent-is-structural]: The *No cosmetic insets or padding* rule targets padding added to mask a wrong preferred size or a mismeasured baseline. This indent carries information — with several groups and ungrouped columns interleaved, a flat list gives the reader no way to tell where a group's members end. The submenu already indents for exactly this reason, and `TreeCellRenderer` uses `DEFAULT_INDENT_PX = 16` for the same job on tree rows, which is where the 16px comes from. `Table.ts` already imports `DEFAULT_INDENT_PX`, but the dialog gets its own constant rather than reusing it: a later change to the tree's indent must not move the column dialog's rows. Using the `Checkbox`'s own `insets` option keeps the write on a typed setter, as the rules for DOM writes require.

[^stale-menu-doc]: Ordinarily a neighbouring doc line would be left alone under the surgical-changes rule. This one is different: it states that the feature being shipped is impossible. Leaving it would send the next reader looking for a `Menu` change this plan deliberately does not make.
