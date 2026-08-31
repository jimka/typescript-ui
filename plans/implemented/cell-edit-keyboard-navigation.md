# Table Cell-Editor Keyboard Navigation — Implementation Plan

## Overview

Today, pressing Tab while editing a table cell does nothing intentional — it falls through to the browser's native tab order, which usually leaves the table entirely, since no other cell is natively focusable. Enter commits the edit and returns to the renderer view but never moves anywhere else. This plan makes Tab / Shift+Tab / Enter / Shift+Enter move editing to a neighboring cell, committing the current one first through the existing commit path.

The change lives almost entirely in [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts) (key detection) and [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts#L2443-L2571) (the row/column offset math, already established there for arrow-key navigation). A small prerequisite fix in [`packages/lib/src/typescript/lib/component/table/cell/editor/CellEditor.ts`](packages/lib/src/typescript/lib/component/table/cell/editor/CellEditor.ts) closes a latent gap that would otherwise make the new feature silently not work for three of the seven built-in cell editors.

Arrow-key caret movement inside an active editor is untouched — no code path in this plan inspects or reacts to arrow keys.

---

## Architecture Decisions

### Reuse `commitEdit()` / `startEdit()` exactly as they exist

Tab/Shift+Tab/Enter/Shift+Enter call the same `Cell.commitEdit()` and `Cell.startEdit()` every other commit/edit-entry path already calls[^existing-mechanism]. No new commit or edit-session mechanism is introduced.

### Body learns about the keypress through a setter-callback, not a widened event

`Cell` gains two single-callback setters — `setNavigateHandler` and `setEditEndHandler` — that `Body` installs on every cell, mirroring the existing `Cell.setScrollIntoViewHandler` (`Cell.ts:266`) callback Body already installs the same way in `Body.wireRowCells` (`Body.ts:428`)[^setter-not-listener].

### Grid edges clamp — this is the table's only existing convention

`Body.onKeyDown`'s ArrowLeft/ArrowRight and ArrowUp/ArrowDown/PageUp/PageDown/Home/End branches (`Body.ts:2474-2571`) already clamp at both edges; nothing in the table wraps. This plan's Tab/Enter clamp the same way, reusing the identical clamp shape[^clamp-precedent]:

| Key | At the boundary | Existing code |
|---|---|---|
| ArrowRight at the last column | stays on the last column | `Math.min(visibleColCount - 1, this._focusedColIndex + 1)` (`Body.ts:2481`) |
| ArrowLeft at column 0 | stays on column 0 | `Math.max(0, this._focusedColIndex - 1)` (`Body.ts:2479`) |
| ArrowDown at the last row | stays on the last row, still calls `selectRecord` | `Math.min(currentIdx + 1, records.length - 1)` (`Body.ts:2540`) |
| ArrowUp at row 0 | stays on row 0 | `Math.max(currentIdx - 1, 0)` (`Body.ts:2543`) |

Tab at the last column clamps to the last column (re-opens editing on the same cell, since `commitEdit()` already returned it to renderer view). Shift+Tab at column 0 clamps the same way. Enter at the last row clamps to the last row; Shift+Enter at row 0 clamps to row 0.

### Prerequisite fix: Date/Time/DateTime editors don't actually forward Enter/Escape today

`StringEditor`, `NumberEditor`, and `ComboEditor` wrap a child control (`TextField` / `ComboBox`), so their own element never receives a native `keydown` — they manually re-fire it as a `CustomEvent("keydown", { detail: {...} })` on themselves (`String.ts:31-37`, `Number.ts:51-57`, `Combo.ts:73-79`), which `Cell.onKeyDown` reads via `evnt.detail?.keyCode`.

`DateEditor`, `TimeEditor`, and `DateTimeEditor` extend `TextInputCellEditor`, whose own element **is** the `<input>` (`TextInputCellEditor.ts:32`, calling `super("input")`). They never re-fire anything — so the listener that reaches `Cell.onKeyDown` (`CellEditorPool.wireListeners`, `CellEditorPool.ts:147-149`, or `Cell`'s own constructor wiring, `Cell.ts:173`) receives the **raw native `KeyboardEvent`** instead of the expected `CustomEvent<ForwardedKeyDetail>`[^native-event-bug]. `evnt.detail` on a real `KeyboardEvent` is the numeric `UIEvent.detail` (`0`), not an object, so `evnt.detail?.keyCode` silently resolves to `undefined` and neither branch of `onKeyDown` ever fires. Enter/Escape are already broken for these three editors today, and Tab/Shift+Enter would be broken the same way without a fix.

The fix mirrors an existing precedent in the very same file: `CellEditor.ts` already normalizes an analogous native-vs-synthetic split for blur (`blurRelatedTargetHandle`, `CellEditor.ts:32-34`, called out in that function's own doc comment as covering exactly this String/Number vs Date/Time/DateTime split). This plan adds a twin helper, `forwardedKeyDetail()`, so `Cell.onKeyDown` reads key info the same way regardless of which shape arrived.

### Suppressing Tab's native focus-shift

Left alone, an unhandled Tab always moves native DOM focus. Whichever listener sits on the **real** event target must return `{ prevent: true }` for Tab; returning it from a listener reacting to the re-fired synthetic event does nothing, because `preventDefault()` on a synthetic event has no effect on the original native one[^prevent-default-target].

| Editor | Real native `keydown` target | Where to return `{ prevent: true }` |
|---|---|---|
| `StringEditor` | its inner `TextField` | `String.ts:31`'s own listener |
| `NumberEditor` | its inner `TextField` | `Number.ts:51`'s own listener |
| `ComboEditor` | its inner `ComboBox` | `Combo.ts:73`'s own listener |
| `DateEditor` / `TimeEditor` / `DateTimeEditor` | the editor's own element | `CellEditorPool.wireListeners`'s shared listener (`CellEditorPool.ts:147`) and `Cell`'s own constructor listener (`Cell.ts:173`) |

The two shared-listener sites (`CellEditorPool.ts:147`, `Cell.ts:173`) return `{ prevent: true }` for Tab unconditionally — harmless-but-redundant for the three wrapped-child editors (whose real prevention already happened at their own inner listener), necessary for the three native-input editors.

### `"editend"` keeps firing unchanged; navigation is additive

`Cell.onKeyDown` keeps `emit("editend")` on every branch exactly as today, so any existing consumer of the public `on("editend", ...)` event sees no change. The new setter-callbacks fire alongside it, not instead of it.

Body's current transient wiring — `typedCell.on("editend", () => { this.focus(); ... })`, re-registered every time Enter/Space starts a keyboard-driven edit (`Body.ts:2521-2525`) — is replaced by the persistent `setEditEndHandler` installed once per cell in `wireRowCells`[^transient-listener-risk]. This also happens to fix a pre-existing gap where a double-click-started edit never got this refocus on Escape at all (only a keyboard-started one did); that gap is closed as a side effect of doing the wiring correctly, not pursued separately.

### Scope: `Body`'s data cells only

`BooleanCell.startEdit()` (`Boolean.ts:113-119`) toggles the checkbox immediately and never sets `_activeEditor` — there is no distinct edit session for Tab/Enter to interrupt, so this feature does not apply to it. `HeaderCell`, `FilterCell`, and `ParentHeaderCell` belong to the header row and filter row, a different keyboard context from the body's data grid, and are out of scope.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/table/cell/editor/CellEditor.ts
export function forwardedKeyDetail(
    e: CustomEvent<ForwardedKeyDetail> | KeyboardEvent
): ForwardedKeyDetail;

// packages/lib/src/typescript/lib/component/table/cell/Cell.ts
export type CellNavigateDirection = "left" | "right" | "up" | "down";

class Cell<T> extends Component {
    setNavigateHandler(handler: ((direction: CellNavigateDirection) => void) | null): this;
    setEditEndHandler(handler: (() => void) | null): this;

    // Widened parameter type (was CustomEvent<ForwardedKeyDetail> only):
    onKeyDown(evnt: CustomEvent<ForwardedKeyDetail> | KeyboardEvent): void;
}
```

No changes to `BooleanCell`, `HeaderCell`, `FilterCell`, or `ParentHeaderCell` — their `on()`/`off()` overload sets are untouched (see Non-Goals).

---

## Internal Structure

### `CellEditor.ts` — key-detail normalizer

```typescript
export function forwardedKeyDetail(e: CustomEvent<ForwardedKeyDetail> | KeyboardEvent): ForwardedKeyDetail {
    const detail = (e as CustomEvent<ForwardedKeyDetail>).detail;

    if (detail && typeof detail === "object") {
        return detail;
    }

    const native = e as KeyboardEvent;

    return {
        key: native.key,     code: native.code,     keyCode: native.keyCode,
        shiftKey: native.shiftKey, ctrlKey: native.ctrlKey,
        altKey: native.altKey,    metaKey: native.metaKey,
    };
}
```

### `Cell.ts` — `onKeyDown`

```typescript
onKeyDown(evnt: CustomEvent<ForwardedKeyDetail> | KeyboardEvent): void {
    const detail = forwardedKeyDetail(evnt);

    if (detail.keyCode == 13) { // Enter / Shift+Enter
        this.commitEdit();
        this.emit("editend");
        this._navigateHandler?.(detail.shiftKey ? "up" : "down");
    } else if (detail.keyCode == 27) { // Escape
        this.cancelEdit();
        this.emit("editend");
        this._editEndHandler?.();
    } else if (detail.keyCode == 9) { // Tab / Shift+Tab
        this.commitEdit();
        this.emit("editend");
        this._navigateHandler?.(detail.shiftKey ? "left" : "right");
    }
}
```

`_navigateHandler` and `_editEndHandler` are plain nullable fields (`private _navigateHandler: ((direction: CellNavigateDirection) => void) | null = null;` and the `() => void` equivalent), initialized the same way `_scrollIntoView` already is (`Cell.ts:104`) — no `declare` needed, since nothing dispatched from `applyOptions` writes them.

### `Body.ts` — wiring and navigation

`wireRowCells` (`Body.ts:428-433`) gains two more idempotent setter calls, alongside the existing `setEditorPool` / `setScrollIntoViewHandler`:

```typescript
private wireRowCells(row: Row, cells?: Cell<any>[]): void {
    for (const cell of cells ?? (row.getComponents() as Cell<any>[])) {
        cell.setEditorPool(this._editorPool);
        cell.setScrollIntoViewHandler(() => this.scrollColumnIntoView(this._focusedColIndex));
        cell.setEditEndHandler(() => {
            this.focus();
            this._updateFocusStyle();
            this._updateActiveDescendant();
        });
        cell.setNavigateHandler((direction) => this.navigateFromEditingCell(direction));
    }
}
```

The Enter/Space "start editing" branch (`Body.ts:2496-2531`) drops its own transient `on("editend", ...)` wiring (now redundant with the persistent `setEditEndHandler` above) and its inline pool-row/cell resolution, both extracted into a shared helper also used by the new navigation method:

```typescript
// Enter/Space branch becomes:
if (e.key === 'Enter' || e.key === ' ') {
    if (!this._anchorRecord) {
        return { prevent: true };
    }

    this.scrollColumnIntoView(this._focusedColIndex);
    this.renderWindow();

    this.startEditAtFocusedCell();

    return { prevent: true };
}
```

```typescript
/**
 * Resolves the cell at the current anchor row + `_focusedColIndex` and
 * starts editing it, if one is bound. Shared by the Enter/Space
 * keyboard-start-edit path and `navigateFromEditingCell`.
 */
private startEditAtFocusedCell(): void {
    if (!this._anchorRecord) {
        return;
    }

    const anchorIdx = this.getVisibleRecords().indexOf(this._anchorRecord);
    const poolSlotIdx = this._boundIndices.indexOf(anchorIdx);

    if (poolSlotIdx < 0) {
        return;
    }

    const row   = this._rowPool[poolSlotIdx];
    const cells = row.getComponents();
    const slot  = this._focusedColIndex - row.getColumnWindowStart();
    const cell  = (slot >= 0 && slot < cells.length) ? cells[slot] : undefined;

    if (cell instanceof Cell) {
        cell.startEdit();
    }
}

/**
 * Moves editing to the neighboring cell after `Cell.onKeyDown` commits an
 * edit via Tab / Shift+Tab / Enter / Shift+Enter. Installed on every cell
 * as its navigate handler by `wireRowCells`.
 *
 * Tab/Shift+Tab move within the row, mirroring the ArrowLeft/Right clamp.
 * Enter/Shift+Enter move to the next/previous row in the same column,
 * mirroring the ArrowDown/Up clamp (including `skipSeparators`). Both
 * clamp at the grid edge rather than wrapping — see Architecture Decisions.
 */
private navigateFromEditingCell(direction: CellNavigateDirection): void {
    const records = this.getVisibleRecords();

    if (records.length === 0 || !this._anchorRecord) {
        return;
    }

    if (direction === "left" || direction === "right") {
        const visibleColCount = this._store.model.getFields()
            .filter(f => !this._hiddenColumns.has(f.getName())).length;

        this._focusedColIndex = direction === "left"
            ? Math.max(0, this._focusedColIndex - 1)
            : Math.min(visibleColCount - 1, this._focusedColIndex + 1);

        this.scrollColumnIntoView(this._focusedColIndex);
        this.renderWindow();
    } else {
        const currentIdx = records.indexOf(this._anchorRecord);
        let newIdx = direction === "down"
            ? Math.min(currentIdx + 1, records.length - 1)
            : Math.max(currentIdx - 1, 0);

        if (this._rowSeparator) {
            newIdx = this.skipSeparators(records, newIdx, direction === "down" ? 1 : -1);
        }

        const newAnchor = records[newIdx];

        this.selectRecord(newAnchor);
        this.scrollRecordIntoView(newAnchor);
        this.renderWindow();
    }

    this._updateActiveDescendant();
    this._updateFocusStyle();

    this.startEditAtFocusedCell();
}
```

`CellNavigateDirection` is imported into `Body.ts` alongside the existing `Cell` import (`Body.ts:13`).

---

## Ordered Implementation Steps

1. **`CellEditor.ts`**: add `forwardedKeyDetail()` next to `blurRelatedTargetHandle()` (both handle the same native-vs-synthetic split, for keydown instead of blur). → verify: `npm run typecheck` passes.
2. **`Cell.ts`**: add `export type CellNavigateDirection = "left" | "right" | "up" | "down";` next to `CellEvent`. Add `private _navigateHandler` / `private _editEndHandler` fields and their setters (`setNavigateHandler`, `setEditEndHandler`), placed near `setScrollIntoViewHandler` (`Cell.ts:266`). Import `forwardedKeyDetail` from `CellEditor.ts`. → verify: fields compile, no call sites yet.
3. **`Cell.ts`**: widen `onKeyDown`'s parameter type to `CustomEvent<ForwardedKeyDetail> | KeyboardEvent` and rewrite its body per `## Internal Structure` above. Update the constructor's own keydown listener (`Cell.ts:173`) to the widened type and to return `{ prevent: true }` for `keyCode === 9`. Update the class-level doc comment (`Cell.ts:38-39`) and `onKeyDown`'s own doc comment (`Cell.ts:495-502`) to describe Tab/Shift+Tab/Enter/Shift+Enter. → verify: `npx vitest run packages/lib/tests/component/table/cell/editor.test.ts` — existing Enter/Escape/no-op tests still pass unmodified (both `_navigateHandler` and `_editEndHandler` are `null` by default, so the new calls are no-ops for those tests).
4. **`CellEditorPool.ts`**: widen `wireListeners`'s keydown listener (`CellEditorPool.ts:147-149`) to the same union type and return `{ prevent: true }` for `keyCode === 9` (via `forwardedKeyDetail(e).keyCode`). → verify: typecheck.
5. **`String.ts`, `Number.ts`, `Combo.ts`** (cell editors): each inner-field keydown listener (`String.ts:31`, `Number.ts:51`, `Combo.ts:73`) returns `{ prevent: true }` when `evnt.keyCode === 9`, in addition to its existing re-fire. → verify: typecheck; existing forwarding test in `editor.test.ts` still passes.
6. **`Body.ts`**: import `CellNavigateDirection` alongside `Cell` (`Body.ts:13`). Add `startEditAtFocusedCell()` and `navigateFromEditingCell()` as new private methods. Update `wireRowCells` (`Body.ts:428-433`) to install `setEditEndHandler` and `setNavigateHandler`. Simplify the Enter/Space branch (`Body.ts:2496-2531`) to call `startEditAtFocusedCell()`, removing its inline pool/cell resolution and its transient `on("editend", ...)` wiring. → verify: `npx vitest run packages/lib/tests/component/table/Body.test.ts` — existing ArrowLeft/ArrowRight clamp tests (`Body.test.ts:1793-1819`) and row-navigation-at-boundary test (`Body.test.ts:606-622`) still pass unmodified.
7. **Tests — `editor.test.ts`**: in the `'Cell.onKeyDown commit / cancel contract'` block (`editor.test.ts:107-150`), add cases for Tab (keyCode 9, no shift → `setNavigateHandler` spy called with `"right"`), Shift+Tab (→ `"left"`), Enter with shift (→ `"up"`), and confirm plain Enter still resolves to `"down"`. Add a `DateEditor`/`TimeEditor`/`DateTimeEditor` regression case proving Enter/Escape (previously silently broken, see Architecture Decisions) now work through `forwardedKeyDetail`. → verify: new tests pass.
8. **Tests — `Body.test.ts`**: add a `'Column window — keyboard cell-editor navigation'` describe block mirroring the existing `'Column window — keyboard column navigation'` block (`Body.test.ts:1793-1819`): Tab moves to the next cell and re-enters edit mode; Shift+Tab moves left and, at column 0, clamps (re-enters edit on the same cell) instead of wrapping; Tab at the last column clamps the same way. A two-row fixture (mirroring `Body.test.ts:606-622`'s `MemoryStore(MODEL, [{a:'1'}, {a:'2'}])` pattern) covers Enter moving down a row and clamping at the last row, and Shift+Enter moving up and clamping at row 0. Add a case confirming an arrow-keycode passed to `Cell.onKeyDown` is still a no-op (regression guard that arrow keys were never touched). → verify: new tests pass; `npm run typecheck`; `npm test`.
9. **Docs**: re-run `npm run docs:api` — expect zero new warnings. Add one sentence to [`packages/lib/docs/components/Table.md`](packages/lib/docs/components/Table.md) near the existing `readOnly` keyboard-navigation bullet (`Table.md:57`) noting that Tab/Shift+Tab/Enter/Shift+Enter move the active edit while a cell is being edited.
10. **Manual verification**: run the dev app (`npm run dev`, localhost:8015 per project convention) and confirm in a real browser that Tab does not leave the table (native default is actually suppressed — the offline DOM harness cannot prove this, only that the listener's return value requested it).

---

## Files to Create / Modify

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/CellEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/String.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/Number.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/editor/Combo.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/tests/component/table/cell/editor.test.ts` |
| Modify | `packages/lib/tests/component/table/Body.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |

---

## Expected Behaviour

| # | Case | Testable how |
|---|---|---|
| 1 | Tab while editing a `StringCell`/`NumberCell`/`DateCell`/etc. commits the value and opens the editor on the next column, same row. | Unit (`Body.test.ts`) |
| 2 | Shift+Tab moves to the previous column, same row. | Unit |
| 3 | Enter commits and opens the editor on the same column, next row. | Unit |
| 4 | Shift+Enter commits and opens the editor on the same column, previous row. | Unit |
| 5 | Tab at the last column clamps: commits, then re-opens editing on the same (last) cell. | Unit |
| 6 | Shift+Tab at column 0 clamps the same way. | Unit |
| 7 | Enter at the last row clamps: commits, re-opens editing on the same row, same column — mirrors `ArrowDown`'s clamp-and-reselect. | Unit |
| 8 | Shift+Enter at row 0 clamps the same way. | Unit |
| 9 | Enter/Shift+Enter skip group-separator rows via the existing `skipSeparators`, matching ArrowDown/Up. | Unit |
| 10 | Arrow keys, while editing, are untouched — still pure native caret movement inside the editor's input; `Cell.onKeyDown` never inspects them. | Unit (regression: arrow keyCode is a no-op) |
| 11 | Escape still cancels and returns focus to the `Body` container, now via the persistent `setEditEndHandler` — this also now works for an edit started by double-click, not only by keyboard Enter/Space (closes a pre-existing gap). | Unit |
| 12 | Tab/Enter navigating onto a read-only cell commits the source edit and moves the focus ring/active-descendant, but does not open an editor there — `Cell.startEdit()`'s own `isReadOnly()` guard already no-ops. | Unit |
| 13 | `DateEditor`/`TimeEditor`/`DateTimeEditor`: Enter, Escape, and Tab now actually reach `Cell.onKeyDown` with usable key info (previously silently inert). | Unit (regression) |
| 14 | Pressing Tab while editing does not move native DOM focus out of the table. | Manual (real browser) |
| 15 | `BooleanCell` is unaffected — Space/Enter still toggles the checkbox immediately with no navigation. | Unit (existing `Boolean.ts` behavior unchanged, no new test required) |

---

## Verification

- `npm run typecheck` — must pass.
- `npm test` (runs `typecheck:test` + `vitest run`) — must pass, including the modified `editor.test.ts` and `Body.test.ts`.
- `npm run docs:api` — zero warnings (new public JSDoc on `Cell.setNavigateHandler` / `setEditEndHandler` / `onKeyDown` must not `{@link}` any non-public symbol, per `CODE_CONVENTIONS.md`).
- Manual: `npm run dev`, open a table demo, edit a cell, press Tab/Shift+Tab/Enter/Shift+Enter repeatedly across row/column edges, and confirm focus never leaves the table.

---

## Documentation Impact

`Cell.setNavigateHandler` / `Cell.setEditEndHandler` are public methods (matching the existing, equally-public `setScrollIntoViewHandler` / `setEditorPool`), so `npm run docs:api` will generate pages for them; no `{@link}` to an internal symbol is needed since they only reference other public `Cell` methods. `Table.md` gets one added sentence near its existing keyboard-navigation mention (`Table.md:57`); no new dedicated keyboard-shortcuts page exists to update.

---

## Potential Challenges

- **Stacked `"editend"` listeners** if a future change re-introduces per-edit-session `.on()` wiring instead of the persistent setter — mitigation: the setters are the only wiring point now; don't add a second one.
- **ComboBox's own dropdown key handling** could theoretically want Tab to accept the highlighted option instead of committing-and-moving — mitigation: verified `Combo.ts`'s existing keydown forward already reaches `Cell.onKeyDown` for Enter/Escape today (working, pre-existing), so adding Tab follows the identical, already-proven path; a dropdown left open when Tab fires is closed by the same blur-driven `closeDropdown()` every other commit path already triggers.
- **`forwardedKeyDetail`'s native/synthetic detection** (`typeof detail === "object"`) is a runtime discriminant, not a type-level one — mitigation: covered directly by the regression tests in step 7 for both shapes.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/cell/Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts) — `onKeyDown`, `commitEdit`, `startEdit`, `setScrollIntoViewHandler` (the precedent for the new setters).
- [`packages/lib/src/typescript/lib/component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts#L2443-L2571) — `onKeyDown`'s existing ArrowLeft/Right and row-navigation clamp math (the precedent this plan's clamp mirrors), `wireRowCells`.
- [`packages/lib/src/typescript/lib/component/table/cell/editor/CellEditor.ts`](packages/lib/src/typescript/lib/component/table/cell/editor/CellEditor.ts) — `blurRelatedTargetHandle` (the precedent `forwardedKeyDetail` mirrors).
- [`packages/lib/tests/component/table/cell/editor.test.ts`](packages/lib/tests/component/table/cell/editor.test.ts) — existing `onKeyDown` contract tests to extend.
- [`packages/lib/tests/component/table/Body.test.ts`](packages/lib/tests/component/table/Body.test.ts) — existing keyboard-navigation tests (`wideBody` fixture) to mirror.
- [ARCHITECTURE.md](ARCHITECTURE.md) — the cell-editor `Event` carve-out (Event handling section) and the return-value-controls-`preventDefault` convention this plan's Tab suppression relies on.

---

## Non-Goals

- Arrow-key cell-to-cell navigation while editing — explicitly out of scope per the request; no code in this plan inspects arrow keys.
- `BooleanCell` — no distinct edit session exists to hook into (see Architecture Decisions).
- `HeaderCell` / `FilterCell` / `ParentHeaderCell` keyboard behavior — a different keyboard context, untouched.
- Wraparound navigation (Tab past the last column onto the next row, or vice versa) — no such precedent exists in this codebase; the table's only established convention is clamping.

---

## Notes

[^existing-mechanism]: `Cell.commitEdit()` (`Cell.ts:586-600`) and `Cell.startEdit()` (`Cell.ts:540-579`) are already the single commit / edit-entry points used by blur, the `CellEditorPool`'s `requestCommit()` path, and the existing Enter/Escape handling — this plan adds no alternative.

[^setter-not-listener]: A `ListenerBag` event (`.on("navigate", ...)`) was considered instead, matching how `"commit"` is wired once per cell at construction in `Row.resolveEnteringCell` (`Row.ts:687-688`). It was rejected: `Row`'s per-cell `.on()` wiring is safe there because it runs exactly once, in the branch that constructs a brand-new `Cell` — never on a cache-restore or a rebind. Body's own cell wiring, by contrast, happens in `wireRowCells`, which the code's own comment (`Body.ts:421-423`) says runs on both a freshly-pooled row *and* every column-window reconciliation that retargets a surviving cell — calling `.on()` there would append a new listener on every rebind of the same cell, firing the navigation handler multiple times per keypress after enough scrolling. A setter, which simply replaces the single stored callback, is idempotent under repeated calls, matching the existing `setScrollIntoViewHandler` / `setEditorPool` calls already in that exact loop. This also avoids threading a new parameter through `Row`'s constructor (which `"commit"` needed, since `Row` — not `Body` — owns `resolveEnteringCell`), since Body can wire cells directly.

[^clamp-precedent]: No wraparound convention (Tab past the last column moving to the next row, etc.) exists anywhere in the table or tree-table source — `TreeBody.onKeyDown` (`TreeBody.ts:805-834`) only adds ArrowLeft/Right expand-collapse semantics on top of the same base clamp, and its own `moveFocusTo` helper (`TreeBody.ts:894-900`) reuses `selectRecord`/`scrollRecordIntoView` exactly like the base row-navigation block. Clamping is therefore not just the requester's stated default — it is the only pattern this codebase has ever used for grid-edge behavior.

[^native-event-bug]: Traced via `CellEditorPool.wireListeners` (`CellEditorPool.ts:135-150`), which registers one `Event.addListener(editor, "keydown", ...)` shared across every editor variant, typed as `(e: CustomEvent<ForwardedKeyDetail>) => void`. For `StringEditor`/`NumberEditor`/`ComboEditor` this type is accurate, because those editors manually dispatch a `CustomEvent` with that shape. For `DateEditor`/`TimeEditor`/`DateTimeEditor`, no such dispatch exists anywhere in their source (confirmed by grepping every `fireEvent(this, "keydown"` site in `component/table/cell/editor/`), so the listener actually receives the real native `KeyboardEvent` fired by the browser on the editor's own `<input>` element. `KeyboardEvent` inherits `UIEvent.detail: number` (default `0`); optional chaining (`0?.keyCode`) does not short-circuit on a non-nullish `0`, so it evaluates to `(0).keyCode`, which is `undefined` rather than a thrown error — the bug is silent, not a crash. The existing test suite's own comment (`editor.test.ts:50-51`) independently confirms "native-blur editors — Date/Time/DateTime — carry a real `null`/node" for the analogous blur case, corroborating that these three editors take the native-event path throughout, not the synthetic-forward path.

[^prevent-default-target]: Per `ARCHITECTURE.md`'s Event handling section, a DOM-routed listener controls the dispatcher by its return value, and `preventDefault()` operates on whichever event object the listener actually received. `Event.fireEvent(this, "keydown", { detail })` dispatches a *new*, separate event targeting the outer editor; it does not alter or replace the original native `keydown` still resolving on the inner `TextField`/`ComboBox`. Only a listener registered on that original target can suppress its default.

[^transient-listener-risk]: The current code (`Body.ts:2521-2525`) calls `typedCell.on("editend", () => {...})` freshly every time Enter/Space starts a keyboard-driven edit, with no matching `.off()` — each call appends to `Cell`'s `ListenerBag` (`Cell.ts:119`), so repeated keyboard-driven edits of the same pooled cell already stack duplicate listeners today (a pre-existing, low-frequency issue this plan does not otherwise chase). Reusing that same pattern for the new Tab/Enter navigation would make it far worse: navigating across a row with Tab reuses the same handful of pooled cells on every keystroke, so a session of ordinary use would stack hundreds of listeners, each re-running `this.focus()` / `_updateFocusStyle()` / `_updateActiveDescendant()` on every subsequent Escape. The persistent `setEditEndHandler`, installed once and simply overwritten (not appended) on every `wireRowCells` pass, avoids this entirely.

## Implementation Notes

- **`packages/lib/src/typescript/lib/component/table/index.ts` needed a one-line change, not listed in "Files to Create/Modify".** The plan's Public API section declares `CellNavigateDirection` as a new exported type from `Cell.ts`, mirroring the existing `CellEvent`. `CellEvent` is re-exported from the package entry point (`export type { CellEvent } from '~/component/table/cell/Cell.js';`), but the plan didn't call for the same treatment for `CellNavigateDirection`. Running `npm run docs:api` (the plan's own zero-warnings verification step) surfaced exactly the gap this would cause: `CellNavigateDirection, ... is referenced by component/table.BooleanCell.setNavigateHandler.handler.__type.direction but not included in the documentation`. Fixed by widening the existing `CellEvent` re-export line to `export type { CellEvent, CellNavigateDirection } from '~/component/table/cell/Cell.js';`, matching the precedent exactly. `npm run docs:api` is clean (0 warnings) after this change.

- **`Cell.ts`/`Boolean.ts`/`Dynamic.ts` needed a new `hasImmediateEditCommit()` hook, not anticipated by the plan.** The audit's first round found that `openEditingAfterNavigate` (added to fix that round's focus-loss finding) called `cell.startEdit()` unconditionally on whatever cell Tab/Enter navigation lands on. For most cells that's correct — it opens the neighboring editor — but `BooleanCell.startEdit()` has no distinct edit session: it toggles the checkbox immediately (this is intentional, existing behaviour for a deliberate Enter/Space keypress on an already-focused cell, per the plan's own Non-Goals; the bug was Tab/Enter silently toggling it as a side effect of merely navigating past it). The fix added an `instanceof BooleanCell` guard. A second audit round found this incomplete: `DynamicCell.startEdit()` (`Dynamic.ts:144-156`) mirrors `BooleanCell.startEdit()` exactly for its `'boolean'` variant — same immediate toggle, same missing edit session — so the `instanceof` check silently missed it, and Tab/Enter into any `cellType`-driven column currently resolved to `'boolean'` still flipped the checkbox. Rather than widen the `instanceof` check to a second hardcoded class (leaving the same gap open for any future cell with this shape), `Cell` gained a `hasImmediateEditCommit(): boolean` hook (default `false`), which `BooleanCell` overrides to always return `true` and `DynamicCell` overrides to return `this._activeType === 'boolean'`. `Body.openEditingAfterNavigate` now checks this hook instead of `instanceof BooleanCell`, and no longer needs to import `BooleanCell` at all. This follows the same base-class-hook shape `Cell` already uses for `getEditorKey()` / `clampsToContentSize()` / `canSkipUnchangedLayout()`.

- **Manual verification (Ordered Implementation Step 10 / Expected Behaviour row #14 / Verification section) performed and recorded here, as the offline harness cannot prove it.** Ran `npm run dev` against this worktree (symlinking `node_modules/@jimka/typescript-ui` to this worktree's own `packages/lib` first, per the known "worktree browser checks load main tree's lib" pitfall) and drove the Misc. demo's "Show window with table (slow)!" window in a real Chromium tab. Double-clicked the first row's `col5` string cell to open its editor (confirmed `document.activeElement` was its `<input>`, inside the table). Pressed Tab: the edit committed ("World" reappeared as static text), the neighboring `col4` cell opened its own editor with focus, and `document.activeElement` was still an `<input>` inside the table the whole time — native browser focus never left it. Pressed Escape from there: `document.activeElement` moved to the `TBODY.TableBody` element itself, confirming `setEditEndHandler`'s `this.focus()` genuinely returns focus to the body in a real browser, not just in the offline DOM harness's modelled focus tracking.

- **A pre-existing, unrelated test flake surfaces more often on this branch — not fixed, recorded here per the audit's own suggested resolution.** `npm test` fails intermittently (roughly 1 run in 4–5) with `Unhandled Rejection: Error: DOM handle N is not registered` in `TableHeader.onStoreFilterChange` → `HeaderCell.applyBounds`, originating from `tests/component/table/ColumnFilterRow.test.ts` — an async continuation outliving that file's own `afterEach(() => DOM.reset())`. Neither `Header.ts` nor `ColumnFilterRow.test.ts` is touched anywhere in this branch's diff. I reproduced the identical failure signature on unmodified `master` (`packages/lib`, clean working tree) running the same full `vitest run` suite: 1 failure in 4 consecutive runs, matching the branch's own rate — conclusive evidence this is a latent race pre-dating this branch, not a regression it introduces. This branch's ~24 new tests appear to shift vitest's file-level scheduling enough to make the pre-existing race visible somewhat more often, but the root cause is entirely outside this plan's scope (a different subsystem's async teardown), so it is left unfixed here rather than risking an out-of-scope change to `Header.ts` under this plan's review budget. A rerun of `npm test` after a failure of this specific shape passes cleanly; any other failure shape would be a real regression and should not be waved off the same way.
