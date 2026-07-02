# Table Cell-Click Event — Implementation Plan

## Overview

Add a first-class **`"cellclick"`** event to the table so consumers can react to a click on a specific cell (record + column) without inferring the column from `"selectionchange"`. The event is emitted by [`Body`](src/typescript/lib/component/table/Body.ts) — which already resolves the clicked record and column index inside its existing click handler — and forwarded up by [`Table`](src/typescript/lib/component/table/Table.ts) exactly as it forwards the body's `"selectionchange"` today.

The wiring reuses the single subtree click listener already installed in `Body.init` ([Body.ts:546](src/typescript/lib/component/table/Body.ts#L546)) that routes through `onSubtreeClick` → `onRowClick`. `onRowClick` ([Body.ts:926](src/typescript/lib/component/table/Body.ts#L926)) already walks the clicked row's cells to find the clicked column index (`_focusedColIndex`, [Body.ts:968-978](src/typescript/lib/component/table/Body.ts#L968)). The plan factors that element→column resolution into a pure, unit-testable function and emits `"cellclick"` at the end of `onRowClick`, after selection and focus have been applied — so it never fights selection or the inline-edit path.

No new DOM listeners, no new element structure: the column-blind `"selectionchange"` workaround becomes a typed, column-aware event that rides the existing delegation.

---

## Architecture Decisions

### Event name and payload — `"cellclick"` with a single detail object

The event is named `"cellclick"`, carrying one payload object rather than positional arguments (positional would be brittle to extend and unlike the framework's DOM-detail conventions):

```typescript
export interface CellClickEvent {
    record:      ModelRecord;   // the row's bound record
    field:       string;        // the column's model field name
    columnIndex: number;        // visible-column index (matches getComponents() cell order)
    value:       unknown;       // record.get(field) at click time
    rowIndex:    number;        // index into the body's visible-records list
    event:       MouseEvent;    // the raw DOM MouseEvent
}
```

`field` (the model field name) is the stable column identity; `columnIndex` is included because it aligns 1:1 with the cell order the body already exposes and with keyboard `_focusedColIndex`. `rowIndex` is the index into `getVisibleRecords()` (the filtered + sorted view), the same index basis selection and focus use — **not** a pool-slot index. `value` is read live via `record.get(field)` at emit time so a consumer needn't re-derive it.

### `on`/`off`/`emit` custom-event surface (mirrors `"selectionchange"`)

Per [ARCHITECTURE.md](ARCHITECTURE.md) *Event handling*, `"cellclick"` is a **framework-custom** semantic event (it is not a raw DOM `click` re-exposed verbatim — it carries a resolved record/column/value tuple and only fires for clicks that map to a data cell). It therefore rides the `ListenerBag` `on`/`off`/`emit` surface, identical to how `Body` and `Table` already handle `"selectionchange"`:

- `BodyEvent` union widens to include `"cellclick"`; `Body` adds an `on`/`off`/`emit` overload and fires it from `onRowClick`.
- `TableEvent` union widens to include `"cellclick"`; `Table` adds an `on`/`off`/`emit` overload and, in its constructor, subscribes to the body's `"cellclick"` and re-emits its own — the exact pattern at [Table.ts:180](src/typescript/lib/component/table/Table.ts#L180) for `"selectionchange"`.

The `Body._listeners` / `Table._listeners` bags already exist and are typed on their event unions; widening the union and adding overloads is the whole surface change. No new field.

### No `"celldblclick"` companion

The user asked for cell-*click*. A `"celldblclick"` is deliberately **out of scope**: the renderer already consumes `dblclick` to start inline editing (`Event.addListener(renderer, 'dblclick', () => this.startEdit())`, [Cell.ts:84](src/typescript/lib/component/table/cell/Cell.ts#L84)), so a body-level `celldblclick` would either fire redundantly alongside edit-start or require disentangling the two — added surface for a use case nobody requested. Listed in Non-Goals.

### Emit position — after selection + focus, from `onRowClick`

`onRowClick` performs, in order: selection mutation → visual-state refresh → `notifySelectionChange()` → clicked-column resolution → focus. `"cellclick"` fires **last**, after focus is set, so:

- Selection has already updated and its `"selectionchange"` has already fired (a consumer listening to both sees selection settle before cellclick).
- The handler never calls `preventDefault` on anything and does not alter selection — it is purely additive.
- The existing `INPUT`/`TEXTAREA`/`SELECT` focus guard ([Body.ts:981-984](src/typescript/lib/component/table/Body.ts#L981)) is untouched; a click that lands on an active editor's field still resolves to that cell's column and fires `cellclick` (a click *is* a click), but does not steal focus from the editor. This is the correct, honest behaviour — see Expected Behaviour for the exact case.

### Reuse the existing delegation; resolve via a pure function

The clicked column is resolved by walking the row's cells and testing which cell element contains the event target — logic that already exists inline in `onRowClick`. Extract it into a pure module function `resolveClickedColumn(cells, target)` that takes cell handles + the target handle and returns the matching index (or `-1`), so the mapping has red-green unit coverage. `onRowClick` calls it once and reuses the result for both `_focusedColIndex` and the `cellclick` payload, removing the current duplicated inline walk. The record comes from `row.getData()` (already read at [Body.ts:927](src/typescript/lib/component/table/Body.ts#L927)); the field name from `row.getFieldNames()[columnIndex]` ([Row.ts:139](src/typescript/lib/component/table/Row.ts#L139)); `rowIndex` from `getVisibleRecords().indexOf(record)`.

### Virtual scrolling — record identity comes from the live row binding

Row elements recycle through the pool, so a clicked recycled row must resolve to its **current** record, not a stale index. `onRowClick` already does this correctly: the record is read from `row.getData()` — the binding `bindAndPositionRows` writes on each rebind ([Body.ts:805](src/typescript/lib/component/table/Body.ts#L805)) — never from a cached pool index. `rowIndex` is then derived by `getVisibleRecords().indexOf(record)`, so it reflects the record's position in the current view, immune to pool recycling. The plan preserves this: the payload is built from `row.getData()` and the field name, never from `_boundIndices`.

---

## Public API

### `Body` — widened event surface

```typescript
export type BodyEvent = "verticalscroll" | "horizontalscroll" | "selectionchange" | "cellclick";

export interface CellClickEvent {
    record:      ModelRecord;
    field:       string;
    columnIndex: number;
    value:       unknown;
    rowIndex:    number;
    event:       MouseEvent;
}

// new overloads on the existing on/off/emit trio
on(event: "cellclick", listener: (e: CellClickEvent) => void): this;
off(event: "cellclick", listener: Function): this;               // covered by existing BodyEvent signature
protected emit(event: "cellclick", detail: CellClickEvent): void;
```

`CellClickEvent` is exported from `Body.ts` and re-exported through the table barrel ([index.ts:16](src/typescript/lib/component/table/index.ts#L16) sits beside `BodyEvent`).

### `Table` — forwarded event surface

```typescript
export type TableEvent = "selectionchange" | "cellclick";

on(event: "cellclick", listener: (e: CellClickEvent) => void): this;   // added overload
protected emit(event: "cellclick", detail: CellClickEvent): void;      // added overload
```

`Table` imports `CellClickEvent` from `Body.ts` and re-exports it (or the barrel re-exports it from `Body`); `Table` subscribes to the body's `"cellclick"` in its constructor and re-emits.

### Pure resolution helper (module-scope in `Body.ts`)

```typescript
// Returns the index of the cell whose element is, or contains, `target`; -1 if none.
function resolveClickedColumn(cells: Component[], target: Handle | null): number;
```

Kept module-private in `Body.ts` alongside the existing `columnWidthsEqual` helper ([Body.ts:32](src/typescript/lib/component/table/Body.ts#L32)); exposed to the test via the same white-box `(b as any)`-style access the Body tests already use, or exported as `@internal` if a direct import reads cleaner. It takes `DOM` `Handle`s and uses `DOM.source.contains` — pure with respect to the interned handles, no component state.

---

## Ordered Implementation Steps

1. **`Body.ts` — widen the union + add the payload interface.** Add `"cellclick"` to `BodyEvent` ([Body.ts:30](src/typescript/lib/component/table/Body.ts#L30)); export `CellClickEvent`. → verify: `npx tsc --noEmit` still compiles (overloads added next).

2. **`Body.ts` — extract `resolveClickedColumn`.** Add the module function near `columnWidthsEqual`. It walks `cells`, interning each cell element and testing `cellEl === target || DOM.source.contains(cellEl, target)`, returning the first match index or `-1`. This is the same test currently inline at [Body.ts:971-978](src/typescript/lib/component/table/Body.ts#L971).

3. **`Body.ts` — add `on`/`off`/`emit` overloads for `"cellclick"`.** Mirror the `"selectionchange"` overloads at [Body.ts:1072-1108](src/typescript/lib/component/table/Body.ts#L1072). `off` is already covered by the `BodyEvent` fallback signature.

4. **`Body.ts` — emit from `onRowClick`.** Replace the inline column-resolution loop ([Body.ts:968-978](src/typescript/lib/component/table/Body.ts#L968)) with a single `resolveClickedColumn(cells, targetHandle)` call, assign `_focusedColIndex` from it, and — after the focus block ([Body.ts:986](src/typescript/lib/component/table/Body.ts#L986)) — build and `emit("cellclick", { record, field: row.getFieldNames()[columnIndex], columnIndex, value: record.get(field), rowIndex: this.getVisibleRecords().indexOf(record), event: e })`. Guard: if `columnIndex < 0` (click landed inside the row but outside any cell — should not happen for a `<td>` grid, but keep it total), skip the emit. → verify: existing Body/selectionchange tests still green.

5. **`Table.ts` — widen the union + forward.** Add `"cellclick"` to `TableEvent` ([Table.ts:23](src/typescript/lib/component/table/Table.ts#L23)); import `CellClickEvent`; add the `on`/`emit` overloads mirroring `"selectionchange"` ([Table.ts:192-221](src/typescript/lib/component/table/Table.ts#L192)); in the constructor, after the `"selectionchange"` forward ([Table.ts:180](src/typescript/lib/component/table/Table.ts#L180)), add `this._body.on("cellclick", e => this.emit("cellclick", e));`. → verify: `npx tsc --noEmit`.

6. **Barrel re-export.** Confirm `CellClickEvent` is exported through [index.ts](src/typescript/lib/component/table/index.ts) beside `BodyEvent` so consumers can type their listener. → verify: `grep -n "CellClickEvent" src/typescript/lib/component/table/index.ts`.

7. **`TreeBody` sanity check.** `TreeBody.onSubtreeClick` ([TreeBody.ts:761](src/typescript/lib/component/table/TreeBody.ts#L761)) intercepts toggle clicks and otherwise calls `super.onSubtreeClick(e)`, which reaches `onRowClick` — so tree-table cell clicks emit `"cellclick"` for free, and a toggle click (handled + returned early) does not. No change needed; note it as verified behaviour. → verify: read the override, confirm the `super` fall-through.

8. **Tests** (see Verification).

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/component/table/Body.ts` (union, `CellClickEvent`, `resolveClickedColumn`, overloads, emit) |
| Modify | `src/typescript/lib/component/table/Table.ts` (union, overloads, constructor forward) |
| Modify | `src/typescript/lib/component/table/index.ts` (re-export `CellClickEvent` if not carried transitively) |
| Modify | `tests/component/table/Body.test.ts` (pure-fn + selection-coexistence unit tests) |
| Modify | `docs/components/Table.md` (document the event) |

---

## Expected Behaviour

**Unit-testable (offline harness):**

- **`resolveClickedColumn` — target is a cell element.** Given a cell-handle list and a target equal to one cell's element, returns that cell's index.
- **`resolveClickedColumn` — target is a descendant of a cell.** Given a target that is a child node of cell *k*'s element (renderer span), returns *k* (via `DOM.source.contains`).
- **`resolveClickedColumn` — target outside all cells.** Returns `-1`.
- **`resolveClickedColumn` — null target.** Returns `-1`.
- **Payload assembly from a bound row (white-box).** Constructing a `Body`, materialising it, binding a row to a known record, and invoking `onRowClick(row, syntheticEvent)` (as the tests already poke privates) with a target set to a chosen cell element yields an emitted `"cellclick"` whose `record`, `field`, `columnIndex`, `value` (= `record.get(field)`), and `rowIndex` (= `getVisibleRecords().indexOf(record)`) match the chosen cell. This exercises the mapping end-to-end without a real DOM click.
- **Coexistence with selection.** In the same `onRowClick` invocation, `"selectionchange"` fires (record becomes selected) **and** `"cellclick"` fires; a listener on both observes selection settled first. Assert both fired and selection contains the record.
- **Virtual-scroll identity.** After rebinding a pool row to a *different* record (`row.setData(other)`), invoking `onRowClick` emits a `cellclick` whose `record` is the newly-bound one and whose `rowIndex` matches its position in `getVisibleRecords()` — proving the payload reads the live binding, not a stale index.
- **`Table` forwarding.** A `Table`'s `"cellclick"` fires when its body emits `"cellclick"` (drive by emitting on the body via its public path or the white-box hook), delivering the same payload.

**Manual-verify in a browser (not offline-testable — the recording DOM sink delivers no events to listeners and `elementsFromPoint` returns empty, so a real click firing `"cellclick"` cannot be exercised offline):**

- Clicking a data cell fires `"cellclick"` with the correct column/record/value and **does not** break row selection (the row still selects, `"selectionchange"` still fires).
- Clicking does **not** open the inline editor (edit remains dblclick/Enter); `"cellclick"` fires on the single click regardless.
- Double-clicking still starts inline editing; a subsequent single click inside the *active* editor's `<input>` still fires `"cellclick"` for that column and does **not** steal focus from the editor (the existing `INPUT`/`TEXTAREA`/`SELECT` guard holds).
- On a `TreeTable`, clicking a cell fires `"cellclick"`; clicking the expand/collapse toggle does **not** (it is intercepted before `super.onSubtreeClick`).
- On a virtual-scrolled table, clicking a cell after scrolling reports the record actually shown in that row, not a recycled/stale one.

---

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run tests/component/table/Body.test.ts tests/component/table/Table.test.ts` — new unit tests green, existing green.
- `grep -n '"cellclick"' src/typescript/lib/component/table/Body.ts src/typescript/lib/component/table/Table.ts` — event wired in both.
- `grep -n "CellClickEvent" src/typescript/lib/component/table/index.ts` — type re-exported.
- `npm run docs:build` — zero warnings (public JSDoc on the new `on` overloads must not `{@link}` internal symbols per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)).
- Manual smoke: the table demo screen (`MiscPanel` slow table / any Table demo) — wire a temporary `table.on("cellclick", console.log)`, click cells, confirm payload + that selection/editing still work per the manual-verify list.

---

## Documentation Impact

- **Export/barrel:** `CellClickEvent` re-exported from `src/typescript/lib/component/table/index.ts` beside `BodyEvent`/`Body`.
- **Doc page:** [`docs/components/Table.md`](docs/components/Table.md) — add the event under "Sorting and selection" (or a short "Events" note) and to the "Common methods" table, alongside `getSelectedRecord()`. Show the payload shape and a foreign-key-navigation example (the motivating use case). Cross-reference the same on `Body` if the internals page ([`docs/components/TableInternals.md`](docs/components/TableInternals.md)) documents body events.
- **JSDoc:** the new `Body.on("cellclick", …)` and `Table.on("cellclick", …)` overloads get JSDoc describing the payload; per convention, describe the payload fields in prose rather than `{@link}`-ing internal symbols.
- No renames/removals — no old-name sweep needed.

---

## Potential Challenges

- **Synthetic clicks during scroll rebind.** `onSubtreeClick` already filters non-`MouseEvent` clicks ([Body.ts:902](src/typescript/lib/component/table/Body.ts#L902)) — the `Checkbox.setSelected` synthetic `CustomEvent("click")` storm during rebind — so `onRowClick` (and thus `cellclick`) only sees genuine `MouseEvent`s. Mitigation: emit only from inside `onRowClick`, which is already downstream of that guard; do not add a second listener.
- **Editor-field clicks.** A click on an active editor's `<input>` resolves to the cell's column (correct) and must not steal editor focus. Mitigation: emit *after* the existing focus-guard block, which is unchanged; document the behaviour as intended in Expected Behaviour.
- **`columnIndex` vs hidden columns.** `row.getComponents()` and `row.getFieldNames()` are both already filtered to visible fields and share order, so `columnIndex` and `field` stay consistent under column show/hide. Mitigation: derive `field` from `getFieldNames()[columnIndex]` (never from a raw model-field index).
- **Real-click delivery is not offline-testable.** Mitigation: pure `resolveClickedColumn` + white-box `onRowClick` invocation carry the red-green coverage; the click→event delivery and edit/selection coexistence are documented manual-verify steps.

---

## Critical Files

- [`src/typescript/lib/component/table/Body.ts`](src/typescript/lib/component/table/Body.ts) — `onSubtreeClick`/`onRowClick`, the `ListenerBag` surface, `bindAndPositionRows` (row→record binding).
- [`src/typescript/lib/component/table/Table.ts`](src/typescript/lib/component/table/Table.ts) — event forwarding pattern for `"selectionchange"` (the template).
- [`src/typescript/lib/component/table/Row.ts`](src/typescript/lib/component/table/Row.ts) — `getData()`, `getFieldNames()`, cell ordering.
- [`src/typescript/lib/component/table/cell/Cell.ts`](src/typescript/lib/component/table/cell/Cell.ts) — the renderer `dblclick`→edit path (why no `celldblclick`).
- [`src/typescript/lib/component/table/TreeBody.ts`](src/typescript/lib/component/table/TreeBody.ts) — `onSubtreeClick` override and its `super` fall-through.
- [`src/typescript/lib/core/ListenerBag.ts`](src/typescript/lib/core/ListenerBag.ts) — the `on`/`off`/`emit` backing.
- [`tests/component/table/Body.test.ts`](tests/component/table/Body.test.ts) — the white-box test conventions for privates and the `selectionchange` test template.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — Event handling (custom vs DOM surface), listeners-reference-a-named-function.

---

## Non-Goals

- **`"celldblclick"`.** Collides with the renderer's `dblclick`→edit path; not requested. Excluded to avoid ambiguous double-firing with edit-start.
- **Per-cell `on("click")` on `Cell`.** The existing single subtree listener already delegates every click; adding per-cell listeners would multiply registrations against the row pool for no gain and violate the "wire once" listener-stacking lesson.
- **Preventing selection or edit on cell click.** `"cellclick"` is purely additive; it does not gate, consume, or `preventDefault` selection/edit.
- **Right-click / context-menu cell event.** Out of scope; the column header already owns `"columncontextmenu"`, and a body cell context event is a separate feature.
