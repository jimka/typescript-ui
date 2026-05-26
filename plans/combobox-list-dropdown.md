# ComboBox List-Backed Dropdown — Implementation Plan

## Overview

Replace `ComboBox`'s in-file `ComboBoxDropdown` + `ComboBoxRow` row pool with a hosted [`List`](../src/typescript/lib/component/list/List.ts#L31) instance. The dropdown becomes a thin [`AnimatedDropdown`](../src/typescript/lib/core/AnimatedDropdown.ts#L108) wrapper containing one `List` — the row pool, selection set, keyboard model, type-ahead, store binding, scroll-into-view, and ARIA wiring all delegate to [`AbstractCustomList`](../src/typescript/lib/component/list/AbstractCustomList.ts#L352), which already implements every behaviour `ComboBoxDropdown` currently re-implements.

The change deletes ~150 lines of `ComboBox.ts` (the inner `ComboBoxDropdown` and `ComboBoxRow` classes plus their shared style rules) and replaces them with a `ComboBoxDropdown` that hosts a `List` configured for "click commits + close". `ComboBox`'s public API stays the same; the only public additions are a one-liner `setItemsArray` on `List` (described below) so the dropdown can push items without forging fake `String[]` casts.

This plan covers ComboBox only. The other dropdowns (`AutoCompleteField`, `Menu`, the picker dropdowns) are surveyed in **Reuse Assessment** with verdicts; follow-up plans are recommended where a fit exists.

---

## Architecture Decisions

### Embed a `List` instance — don't make `List` extend `AnimatedDropdown`

`List` is an in-flow input that participates in a form ([`Bindable<string>`](../src/typescript/lib/core/Bindable.ts), takes `setStore` / `setValue`, lives inside layouts as a sized component). The dropdown is a floating overlay with its own positioning math, fade lifecycle, and viewport-pointerdown dismiss path. Wiring `AnimatedDropdown` into `List` would drag the overlay machinery into every standalone list and force conditional code in `showAnimated`/`placeAnchored`/`onHideComplete` ("am I floating or am I in-flow?"). The cleaner shape is composition: `ComboBoxDropdown` extends `AnimatedDropdown` (no behaviour change) and contains one `List` filling its `Fit` layout.

### Re-use, don't extend

`AbstractCustomList` already houses the row pool (`_rowPool`), the focused/selected/anchor state, the click + keyboard reducers, type-ahead, scroll-into-view, ARIA `activedescendant`, and store binding ([`AbstractCustomList.ts:357-1054`](../src/typescript/lib/component/list/AbstractCustomList.ts#L357-L1054)). Every one of these is duplicated inline in `ComboBox` today — either inside the dropdown class (`ComboBoxDropdown.syncRows` is a [verbatim copy](../src/typescript/lib/component/list/AbstractCustomList.ts#L740) of the list pattern) or on `ComboBox` itself (selection state, store binding, refresh). Embedding `List` lets the dropdown hand off its row-rendering responsibilities entirely; `ComboBox` keeps only the inline-surface concerns (label, caret, dropdown open/close, focus management on the input surface).

### `ComboBox` keeps owning the items + selection; the embedded `List` mirrors them

Two equally consistent shapes exist:
1. **List owns items, ComboBox proxies** — `setItems`/`setValue`/`getSelectedIndex` on ComboBox delegate to the list.
2. **ComboBox owns items, pushes to List on open** — list is repopulated each show.

Choice: **(1)**. The list is the data view in either case; making it the source of truth removes the duplicate `_items` array (currently held on both `ComboBox._items` and the dropdown's `_rows`). `ComboBox` retains `_value` for the pre-open "selected by key" state and `_selectedIndex` as a cached integer view on `_list.getSelectedIndex()`. The store binding moves to the list — `ComboBox.setStore` becomes a one-line forward to `_list.setStore`. Net code reduction.

### Click commits and closes — wire it explicitly on the inner `List`

`List` fires `change` on user-driven selection (mouse click / keyboard Enter); `ComboBox` already wants exactly that semantic to advance the surface label and close the dropdown. The dropdown subscribes to the inner list's `change` and routes it through the existing `onRowSelected(idx)` path. Programmatic writes (`ComboBox.setValue` / cycleSelection during keyboard navigation while open) bypass the reducer and don't auto-close, matching today's behaviour.

### Keyboard navigation moves into `List` — `ComboBox` only handles the inline-surface keys

`ComboBox.onKeyDown` currently handles ArrowDown/Up/Enter/Escape on the input surface. After the refactor:
- **Dropdown closed:** `ComboBox` still owns the open gesture (ArrowDown/Up/Enter opens the dropdown). Same as today.
- **Dropdown open:** `ComboBox` no longer cycles selection itself. The dropdown's `List` is `focus()`-ed when it opens (the listbox surface holds `tabindex=0`), and the list's own keyboard model takes over (ArrowUp/Down/Home/End/PageUp/PageDown/Enter/Space/printable type-ahead). Escape on the list bubbles to `ComboBox`, which closes the dropdown.

This deletes `ComboBox.cycleSelection` and shrinks `ComboBox.onKeyDown` to "open on arrow keys; close on Escape; everything else is the list's problem when it's open".

The one wrinkle: today the input surface keeps focus while the dropdown is open (rows suppress focus loss via `pointerdown.preventDefault`). After the move, focus shifts to the list when the dropdown opens. The `pointerdown.preventDefault` guard on the input surface (`AbstractInput.focus()` behaviour) and the list's own focus model already cover the cell-editor-pool case (`AnimatedDropdown`'s JSDoc explicitly documents the pointer-down contract — both `ComboBoxRow` and `CustomListRow` already implement it).

### Drop the standalone `ComboBoxRow` class and its shared style rules

`.ComboBoxRow` / `.ComboBoxRow:hover` are dead after the swap — the embedded list uses `.CustomListRow` / `.CustomListRow:hover` / `.CustomListRow.selected` / `.CustomListRow.focused` ([`AbstractCustomList.ts:104-134`](../src/typescript/lib/component/list/AbstractCustomList.ts#L104-L134)) which already cover hover, selection, and focus, and which are themed via the same `--ts-ui-autocomplete-item-*` / `--ts-ui-list-row-*` tokens. Delete the IIFE that registers `.ComboBoxRow` rules.

### `setItemsArray(items: Array<CustomListItem>)` — new typed setter on `List`

The dropdown needs to push **typed** items (key + label pairs derived from `ComboBox._items`) into the embedded list. Today `AbstractCustomList.setItems(items: String | Array<String>)` only accepts label strings and synthesises keys from the index, which would drop ComboBox's store-driven keys. The minimal addition: a sibling `setItemsArray(items: Array<CustomListItem>)` setter that takes pre-formed `{key, label}` entries. Internally it's two lines (`this._items = items.slice(); this.syncRows();`). No new options-bag entry — this is a runtime-only pathway used by the dropdown.

Rejected alternative: overload `setItems` to accept `Array<CustomListItem>`. Adds runtime type-sniffing for a public method's parameter that's already a union and complicates the JSDoc.

### Dropdown width / max-height computation stays on the dropdown wrapper

The "widest label + viewport clamp + min-width floor" math in `ComboBoxDropdown.showAt` is specific to ComboBox's "match the input's width" contract; it doesn't belong on `List` (a standalone list is sized by its parent layout). Keep `measureWidestLabel` and the `min(naturalH, MAX_HEIGHT)` cap on the new dropdown wrapper.

---

## Public API (TypeScript Signatures)

### `List` (additions only)

```typescript
class List extends AbstractCustomList<string, ListOptions> implements Bindable<string> {
    // NEW: push pre-formed key+label pairs (forwarded to AbstractCustomList).
    setItemsArray(items: Array<CustomListItem>): this;
}
```

(The companion runtime method on `AbstractCustomList` is `protected` — only the leaf class exposes it publicly via the same name.)

### `ComboBoxDropdown` (rewritten — same external surface)

```typescript
class ComboBoxDropdown extends AnimatedDropdown<AnimatedDropdownOptions> {
    constructor(onSelect: (index: number) => void);

    showAt(anchorEl: HTMLElement, items: Array<ComboBoxItem>, selectedIndex: number): this;

    setMinWidth(px: number): this;
    getMinWidth(): number;

    // Test seam — gives ComboBox direct access to the inner List for setStore
    // forwarding, value writes, and focus delegation.
    getList(): List;
}
```

`showAt`'s third parameter (`selectedIndex`) is new — the previous implementation re-built rows from labels and lost any prior selection. Routing the current index into the list keeps the visible selection / focused row in sync when the dropdown re-opens.

### `ComboBox` (no public API change)

Internally `_items` / `_selectedIndex` either become thin caches over `_list.getItems()` / `_list.getSelectedIndex()` or stay as-is and forward writes — choose during implementation based on which makes the diff smaller. `setStore` forwards to the dropdown's list once the dropdown exists, and replays cached store/items/value through it when the dropdown is built lazily.

---

## Internal Structure

After the refactor, `ComboBoxDropdown` shrinks to roughly:

```typescript
class ComboBoxDropdown extends AnimatedDropdown<AnimatedDropdownOptions> {
    private readonly _list: List;
    private readonly _onSelect: (index: number) => void;
    private _minWidth: number = COMBOBOX_DROPDOWN_MIN_WIDTH_PX;

    constructor(onSelect: (index: number) => void) {
        super(undefined, { /* same defaults as today */ });

        this._onSelect = onSelect;
        this.getAria().setRole("listbox");
        this.setContain("layout");

        // Fit layout makes the inner List fill the dropdown's content box.
        this._list = new List();
        this.addComponent(this._list);
        this._list.addActionListener(() => this._onSelect(this._list.getSelectedIndex()));
    }

    showAt(anchorEl: HTMLElement, items: Array<ComboBoxItem>, selectedIndex: number): this {
        this.pauseLayout();
        this._list.setItemsArray(items);
        this._list.setSelectedIndex(selectedIndex, false);
        this.resumeLayout();

        // …existing widest-label measurement, viewport clamp, placeAnchored, showAnimated…
        // After showAnimated mounts the panel, focus() the list so its keyboard
        // model takes over.
        this._list.focus();

        return this;
    }

    getList(): List { return this._list; }
}
```

`ComboBox.onKeyDown` collapses to:
```typescript
private onKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
        case "ArrowDown":
        case "ArrowUp":
        case "Enter":
        case " ":
            e.preventDefault();

            if (!this.ensureDropdown().isOpen()) {
                this.toggleDropdown();
            }
            // When already open, the list's own handleKeyDown runs because
            // the list element holds focus.
            break;
        case "Escape":
            this.closeDropdown();
            break;
    }
}
```

---

## Reuse Assessment

For each dropdown that currently rolls its own row pool / selection model:

| Candidate | Verdict | Reason |
|---|---|---|
| **`ComboBox` / `ComboBoxDropdown`** ([ComboBox.ts:104](../src/typescript/lib/component/input/ComboBox.ts#L104)) | **Fit** — this plan | One-to-one mapping: rows, single-selection, keyboard model, type-ahead, store binding, ARIA listbox. `List` already implements every one. |
| **`AutoCompleteDropdown` / `AutoCompleteItem`** ([AutoCompleteDropdown.ts:40](../src/typescript/lib/component/input/AutoCompleteDropdown.ts#L40)) | **Fit (follow-up plan)** | Same row-pool reconciliation, same listbox role, same "click commits + close" gesture. The semantic difference — `highlighted` (keyboard cursor) vs `selected` — is already represented inside `List` as `_focusedIndex` vs `_selectedSet`; the autocomplete just needs the focused-row visual without committing it as the selected row. A thin `List` subclass that fires `change` on Enter without writing the surface field, or a `setSelectMode("focus-only")` flag, would close the gap. Recommend a separate `autocomplete-list-dropdown.md` plan after this one ships. |
| **`Menu` / `MenuItem`** ([Menu.ts:58](../src/typescript/lib/core/Menu.ts#L58), [MenuItem.ts](../src/typescript/lib/component/container/MenuItem.ts)) | **Not fit** | Menu items carry per-row config the list model has no slot for: glyph, shortcut text, submenu chevron, disabled flag, separator rows, "skip during focus traversal" semantics. `MenuItem` is also a `Component` with its own activation lifecycle. Forcing this through `CustomListItem` ({key, label}) would either widen `CustomListItem` into a union with menu-specific fields or push everything into the label string — both are worse than the current dedicated row class. Keep `Menu` as-is. |
| **`DatePickerDropdown`** ([DatePickerDropdown.ts:40](../src/typescript/lib/component/input/DatePickerDropdown.ts#L40)) | **Not fit** | The calendar is a 7-column `Grid` of day cells plus a header row with month/year navigation chevrons and an in-place year-scroller swap; the year-scroller is the only column-of-rows surface in the picker and it's already a `PickerColumn` ([AbstractCalendarDropdown.ts](../src/typescript/lib/component/input/AbstractCalendarDropdown.ts)). Day cells are not "labels in a single column" — every cell is a clickable, themed component with month-context state (current month / adjacent month / out-of-range). Mapping that onto a single-column listbox would erase the grid. Keep the calendar's bespoke layout. |
| **`TimePickerDropdown`** ([TimePickerDropdown.ts:44](../src/typescript/lib/component/input/TimePickerDropdown.ts#L44)) | **Requires adapter** | The hour / minute / (optional) second columns are each a vertical scrollable list of integer cells with a column header — structurally close to a `List` (single column, single-selection, scrollable, type-ahead-friendly). However the live implementation uses `PickerColumn` which gives every cell `PickerCell` semantics (disabled clamping for outside-bounds values, decorated header) and ties the three columns together via shared `_onCellSelected` callback per unit (`hours` / `minutes` / `seconds`). Three side-by-side `List` instances could replace `PickerColumn`, but would lose the disabled-cell theming and the column-header decoration that `PickerColumn` provides. Verdict: an adapter `PickerList extends List` adding `setColumnHeader` and `setCellDisabled(idx, value)` is conceivable, but the value-per-LOC is low and the existing `PickerColumn` is already shared between the time picker and the year scroller. Recommend deferring; not in scope for this plan. |
| **`DateTimePickerDropdown`** ([DateTimePickerDropdown.ts](../src/typescript/lib/component/input/DateTimePickerDropdown.ts)) | **Not fit** | Composition of the date grid and the time columns; shares both prior verdicts. |
| **`AnimatedDropdown`** ([AnimatedDropdown.ts:108](../src/typescript/lib/core/AnimatedDropdown.ts#L108)) | **N/A** | Pure overlay lifecycle (fade in/out, layer stack, anchored positioning). Has no row pool, no selection — nothing to reuse from `List`. Stays the parent class every dropdown extends. |

**Summary:** `List` is a fit for ComboBox (this plan) and AutoComplete (recommended follow-up). The picker dropdowns are structurally further apart; force-fitting them would be a loss.

---

## Ordered Implementation Steps

### Step 1 — Add `setItemsArray` to `List`

[`src/typescript/lib/component/list/List.ts`](../src/typescript/lib/component/list/List.ts) — add one public method that pushes pre-formed `Array<CustomListItem>` into `this._items`, clears the selection set, resets `_focusedIndex` / `_anchorIndex`, then runs the same `pauseLayout → syncRows → resumeLayout → updateActiveDescendant` sequence as [`AbstractCustomList.setItems`](../src/typescript/lib/component/list/AbstractCustomList.ts#L475). JSDoc states "consumer-facing for hosts that already own typed item pairs (e.g. `ComboBoxDropdown` pushing `ComboBoxItem[]`)".

Verification: typecheck; existing `List` tests still pass.

### Step 2 — Rewrite `ComboBoxDropdown` to host a `List`

[`src/typescript/lib/component/input/ComboBox.ts`](../src/typescript/lib/component/input/ComboBox.ts) — replace the body of `class ComboBoxDropdown` per the snippet in **Internal Structure**. `showAt` now takes `items: Array<ComboBoxItem>` and `selectedIndex: number`; widest-label measurement and viewport clamping stay. The internal `_list = new List()` is added in `Fit` layout (the existing `_list: Panel` field is renamed and re-typed).

### Step 3 — Delete `ComboBoxRow` and its style rules

Remove the `class ComboBoxRow` definition and the IIFE block registering `.ComboBoxRow` / `.ComboBoxRow:hover`. The list's `.CustomListRow*` rules already cover the visual; the `.ComboBox` / `.ComboBoxLabel` rules stay (they style the input surface, not the dropdown rows).

### Step 4 — Update `ComboBox.toggleDropdown` to pass the current selection

`toggleDropdown` becomes:
```typescript
dropdown.showAt(this.getElement(true), this._items, this._selectedIndex);
```
The third argument is new; without it, the embedded list would always open with no selection focused.

### Step 5 — Collapse `ComboBox.onKeyDown`

Delete `ComboBox.cycleSelection` (the inner list's `handleNavigationKey` covers it) and shrink `onKeyDown` to the open-gesture / Escape switch from **Internal Structure**. Verify the inner list takes focus on dropdown open — add an explicit `this._list.focus()` at the end of `ComboBoxDropdown.showAt` after `showAnimated()` returns.

### Step 6 — Bridge the inner list's `change` event to `onRowSelected`

In the new `ComboBoxDropdown` constructor: `this._list.addActionListener(() => onSelect(this._list.getSelectedIndex()))`. `ComboBox.onRowSelected` already calls `setSelectedIndex(idx, true)` + `closeDropdown()`; the contract is preserved.

### Step 7 — Forward store binding to the list when present

`ComboBox.setStore` already maintains its own store-refresh handler. After the dropdown is built, call `this._dropdown.getList().setStore(store, displayField, valueField)` so the embedded list refreshes when records change. Keep `ComboBox`'s own item array in sync via the existing `refreshFromStore`.

(Optional simplification — out of scope for the first pass: delete `ComboBox._items` / `refreshFromStore` and read everything from `_list.getItems()`. Keep it for a separate follow-up to limit diff surface.)

### Step 8 — Manual regression sweep

- ComboBox demo screen (`MiscPanel` or the ComboBox-specific demo). Open the dropdown, click each row, verify selection commits and the surface label updates.
- Keyboard: focus the closed combobox, press ArrowDown — dropdown opens. Press ArrowDown / Up — focus moves through rows. Press Enter — selects, closes. Press Escape on closed combobox — no-op; on open — closes.
- Type-ahead: type a letter, focus jumps to the matching row.
- Store-bound combobox: load a store, verify rows reflect records; mutate via `store.add(record)` and confirm the list updates.
- Cell editor (`ComboBoxCellEditor` if present): open dropdown inside a table cell — focus must not be lost when a row is clicked. `CustomListRow.onPointerDown` already calls `e.preventDefault`.

### Step 9 — Export bookkeeping

The internal `_ComboBoxDropdown` export (re-exported as `_ComboBoxDropdown`) at [ComboBox.ts:1166](../src/typescript/lib/component/input/ComboBox.ts#L1166) is the only external surface that referenced the inner classes. No external consumer should depend on `ComboBoxRow`; verify with `grep -rn ComboBoxRow src/`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/list/List.ts` — add `setItemsArray(items: Array<CustomListItem>): this`. |
| Modify | `src/typescript/lib/component/input/ComboBox.ts` — rewrite `class ComboBoxDropdown`; delete `class ComboBoxRow` and its style-rule IIFE; collapse `ComboBox.onKeyDown` / `cycleSelection`; route store binding to the inner list. |
| (No new files.) | — |
| (No deletes.) | — |

No `index.ts` change needed — only the internal `_ComboBoxDropdown` re-export already exists and its identity is preserved.

---

## Verification

- **Typecheck:** `npm run build` — 0 errors.
- **Grep invariants:**
  - `grep -rn 'ComboBoxRow' src/` → only the (deleted) declarations should match; expect 0 matches after the change. JSDoc references in `AbstractCustomList.ts` to "verbatim copy of … ComboBoxDropdown.syncRows" need rewording (it's no longer a copy; the verbatim wording can be dropped or replaced with "mirrors the pool-reconciliation pattern shared with the autocomplete dropdown").
  - `grep -rn '\.ComboBoxRow' src/` → 0 matches in `.ts` files (the style-rule strings).
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning). `setItemsArray` is a new public method on `List`; TypeDoc picks it up automatically since it's exported from `~/component/list/List.ts`.
- **Manual smoke test:** ComboBox demo — open/close, click selection, ArrowUp/Down, Home/End, Enter, Escape, type-ahead, store-bound items, theme toggle.
- **Cell-editor regression:** if `ComboBoxCellEditor` exists in the table cell editor family, smoke-test that opening the dropdown inside a cell and clicking a row commits without the table's cell-editor blur racing the dropdown click.

---

## Documentation Impact

- `setItemsArray` is a new public method on the existing `List` class. Already exported through `src/typescript/lib/component/list/index.ts`; no new index entry needed. TypeDoc will surface it under `docs/api/component/list/classes/List`.
- The curated page for `List` (`docs/components/list.md` or similar — confirm path at implement time) should mention the new method only if a consumer-facing recipe exists. Otherwise the API page suffices.
- Cross-bucket JSDoc reference inside `List.setItemsArray`'s comment should link to `[`ComboBoxItem`](/api/component/input/interfaces/ComboBoxItem)` and `[`CustomListItem`](/api/component/list/interfaces/CustomListItem)` — both live in different subpaths than `List`, so use the markdown form per `_shared/docs-conventions.md`.
- No `docs/concepts/` page changes — the architectural choice (embed vs subclass) is internal.

---

## Potential Challenges

- **Focus shift on dropdown open.** Today the input surface stays focused while the dropdown is open (rows are not focusable). After the move, the list element takes focus. Hosts that gate "commit on blur" off the input surface (cell editor pool) could over-commit. Mitigation: `CustomListRow.onPointerDown` already calls `preventDefault`, and the list's `focus()` call happens after `showAnimated` completes; the input surface's blur fires once, the list takes focus, and on close `ComboBox` re-focuses itself.
- **`_selectedIndex` drift between `ComboBox` and the inner list.** The dropdown is lazy-built. Until the user opens it, the list doesn't exist; `ComboBox._items` / `_selectedIndex` / `_value` must remain authoritative. On first open, those values seed the list (via `setItemsArray` + `setSelectedIndex(idx, false)`). Mitigation: keep `ComboBox`'s existing fields and forward on every write; the list mirrors them after first open.
- **Store re-binding while the dropdown exists.** `setStore` on `ComboBox` must replay the store onto the list. Mitigation: in `ComboBox.setStore`, after the local store registration, also call `this._dropdown?.getList().setStore(store, displayField, valueField)` so a store swap mid-session is reflected in the inner list.
- **The verbatim-copy JSDoc in `AbstractCustomList`.** [`AbstractCustomList.syncRows`'s comment](../src/typescript/lib/component/list/AbstractCustomList.ts#L740) currently reads "Verbatim copy of the pattern in `ComboBoxDropdown.syncRows`." That line becomes incorrect after this plan ships (there is no `ComboBoxDropdown.syncRows` anymore — the list **is** the row pool). Update the comment to "Reconciles the row pool against `_items`" without the historical reference.
- **`MultiSelectList` reuse.** ComboBox is single-select today. A separate plan could expose a `multi: true` option that swaps the embedded `List` for a `MultiSelectList`; out of scope here. Flag this in **Non-Goals** so the implementer doesn't speculatively widen the surface.

---

## Critical Files

- [`src/typescript/lib/component/list/AbstractCustomList.ts`](../src/typescript/lib/component/list/AbstractCustomList.ts) — owns the row pool, keyboard model, type-ahead, ARIA. Read end-to-end; this is what `ComboBoxDropdown` is delegating to.
- [`src/typescript/lib/component/list/List.ts`](../src/typescript/lib/component/list/List.ts) — concrete single-select reducer; the only file gaining a new public method.
- [`src/typescript/lib/component/input/ComboBox.ts`](../src/typescript/lib/component/input/ComboBox.ts) — the file under modification.
- [`src/typescript/lib/core/AnimatedDropdown.ts`](../src/typescript/lib/core/AnimatedDropdown.ts) — read the pointer-down contract JSDoc (cell editor blur race) before changing dropdown focus behaviour.
- [`src/typescript/lib/component/input/AutoCompleteDropdown.ts`](../src/typescript/lib/component/input/AutoCompleteDropdown.ts) — read but **don't modify**; the follow-up plan will mirror the ComboBox shape.

---

## Non-Goals

- **Migrate AutoComplete to `List` in this plan.** Recommended follow-up (`autocomplete-list-dropdown.md`); requires the `focus-only` selection mode discussed in **Reuse Assessment**.
- **Replace `PickerColumn` with `List`.** The picker columns have disabled-cell theming and column headers `List` doesn't have; the value/LOC ratio is poor.
- **Replace `Menu` row rendering with `List`.** Menu rows carry glyph + shortcut + submenu chevron + separator state — not a fit for the `{key, label}` shape.
- **Add `multi: true` to `ComboBox`.** Defer to a separate plan if the use case arrives.
- **Delete `ComboBox._items` / `refreshFromStore`.** Possible but expands the diff; keep the existing internal fields, just push to the inner list in parallel. Cleanup can be a follow-up.
- **Touch `ComboBoxLabel` / `ComboBoxCaret`.** These style the input surface, not the dropdown rows. They stay.
