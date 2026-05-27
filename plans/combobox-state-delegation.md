# ComboBox State Delegation — Implementation Plan

## Overview

Delete `ComboBox._items` / `ComboBox._selectedIndex` / `ComboBox._value` / `ComboBox._storeRefresh` / `ComboBox.refreshFromStore` and route every state read and write through the embedded [`List`](../src/typescript/lib/component/list/List.ts) instance. The current refactor (see [`plans/implemented/combobox-list-dropdown.md`](implemented/combobox-list-dropdown.md)) kept ComboBox's parallel state intact "to limit diff surface"; this plan finishes that simplification.

Trade-off: the dropdown must be **built eagerly** at ComboBox construction (not lazily on first open) so the inner `List` exists as the source-of-truth from the start. A no-DOM `List` component is cheap (no row pool, no inner-panel DOM until the dropdown is mounted) but it's not free — the cost of the eager build is the price of state unification.

This plan covers ComboBox only.

---

## Architecture Decisions

### Eager dropdown construction is the enabler

The hosted `List` currently lives inside the lazy-built `ComboBoxDropdown`. With state delegation, `getValue` / `getSelectedIndex` / `setItems` / etc. on ComboBox all need to read from the list — which means the list must exist before the user opens the dropdown.

Mitigation: a `List` Component without a DOM-mounted parent is inert. Its `_items` array, selection set, and store binding work fine; row-pool DOM is created lazily inside `_innerPanel.addComponent(row)` but that just allocates Component instances — the actual DOM `<div>` elements aren't attached until `_innerPanel.getElement(true)` runs (i.e. when the dropdown is shown). The cost of eager construction is therefore: one `List` instance, one `Panel` instance, one `Fit` layout manager. Bounded.

### ComboBox keeps its outer surface; only the state moves

The visual chrome (label, caret, click-to-open) stays on ComboBox itself. The `_label` (ComboBoxLabel) and `_caret` (ComboBoxCaret) children are unchanged. Only the data state and store binding shift to the embedded list.

### `_value` survives until the first item write

Today's ComboBox can take `setValue("admin")` before `setItems(...)` runs — the value is cached in `_value` and applied when items arrive. After delegation, the inner list's `setValue` rejects unknown keys (no-op when the key isn't in `_items`). The list's existing `selectedIndex < 0` handling already covers this — the value just sits in the list's `_anchorIndex = null` state until items appear; on first `setItems`, the value reapplication needs to be wired explicitly.

Two options:
1. Reapply `_value` from a ComboBox-level cache after every items update (small ceremony).
2. Lift the cache-on-setValue / reapply-on-setItems pattern into `AbstractCustomList` so any consumer of the list gets it.

Choice: **(1)** for this plan — adding a feature to the abstract base is out of scope. Keep a small ComboBox `_pendingValue` until items arrive, then fold.

### Removed methods become forwarders

Every `getX` / `setX` on ComboBox becomes a one-liner forwarding to the inner list (`getValue() { return this._list.getValue() }`). The forwarders survive for binding-API compatibility — call sites continue to read `combo.getValue()` instead of `combo.getList().getValue()`.

Net diff: ~50–80 lines deleted from ComboBox, ~10 lines of forwarders added.

---

## Public API (TypeScript Signatures)

No public-API changes. Every existing `ComboBox` method keeps its signature; the body just forwards to the embedded list.

---

## Ordered Implementation Steps

### Step 1 — Eagerly build the dropdown

In `ComboBox` constructor, replace the `_dropdown = null` field with an eager `this._dropdown = new ComboBoxDropdown(...)` call. Remove the `ensureDropdown` lazy-build path; it becomes `getDropdown(): ComboBoxDropdown` (just returns `this._dropdown`).

### Step 2 — Route `setItems` / `addItem` / `setItemsArray` / `setStore` to the inner list

Delete `ComboBox._items` and `ComboBox._storeRefresh`. `setItems(items)` becomes `this._dropdown.getList().setItems(items)`. `setStore` becomes `this._dropdown.getList().setStore(store, displayField, valueField)`. The list's existing store-refresh listeners cover what `ComboBox.refreshFromStore` did.

### Step 3 — Route selection getters to the inner list

`getValue()` → `this._dropdown.getList().getValue()`. `getSelectedIndex()` → `this._dropdown.getList().getSelectedIndex()`. `getItems()` → `this._dropdown.getList().getItems()`. `getSelectedRecord()` → `this._dropdown.getList().getSelectedRecord()`. `getStore()` → `this._dropdown.getList().getStore()`.

### Step 4 — Route selection setters to the inner list

`setSelectedIndex(idx, fire)` → forward, BUT preserve the "change" event ComboBox itself fires (it's bridged to `notifyChange` for the binding system). Either:
- Subscribe to the inner list's `change` event in the ComboBox constructor and re-fire on ComboBox itself, OR
- Listen via `addActionListener` and translate.

Already wired: `ComboBox.constructor` does `Event.addListener(this, "change", () => this.notifyChange(this.getValue()))`. Keep this — the inner list fires "change" on user gestures; we re-emit on ComboBox.

### Step 5 — Drop `refreshFromStore`, `_items`, `_storeRefresh`, `_selectedIndex`, `_value`

Delete the fields and the method. Replace any internal reference (e.g. `computeLabel` reads `this._items[this._selectedIndex].label`) with `this._dropdown.getList().getSelectedItem()` — wait, we deleted `getSelectedItem`. Use `this._dropdown.getList().getItems()[this._dropdown.getList().getSelectedIndex()]?.label ?? ""` instead.

### Step 6 — Handle the late-built / out-of-order `setValue` case

ComboBox accepts `setValue("admin")` before items load. Today `_value` caches the key; on `setItems`, the index is re-resolved. After delegation, the inner list's `setValue` will set the selection to -1 (key not found). The reapplication needs an explicit hook: cache the last-set value in ComboBox itself (e.g. `_pendingValue: string | null = null`), set it via `setValue`, and reapply via a listener on the list's `change` event or on `setItems` / `setStore` completion.

Simpler: keep `_value` on ComboBox solely as the pre-items cache, drop everything else. On `setItems`, call `this._dropdown.getList().setValue(this._value)` after the items land.

### Step 7 — Audit `MiscPanel` ComboBox demo + cell-editor variant

The cell-editor variant (`ComboBoxCellEditor`?) reads `getValue` / `setValue` via the binding system. Confirm no regressions.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/input/ComboBox.ts` — eager dropdown build; state fields and `refreshFromStore` deleted; getters / setters become forwarders. |
| (No new files.) | — |
| (No deletes.) | — |

---

## Verification

- `npx tsc --noEmit` — 0 errors.
- `npm run docs:build` — 0 errors, 0 new link warnings.
- Manual smoke test on `MiscPanel`'s ComboBox demo: open, click, keyboard, type-ahead, store-bound items, theme toggle.
- Manual smoke test on any cell-editor variant that uses ComboBox — open dropdown inside a cell, click row, confirm value commits without focus loss.

---

## Potential Challenges

- **Construction-time dispatch order.** Today `ComboBox.applyOptions` writes pure into `_options` and dispatches in the constructor tail. After delegation, `setItems` / `setValue` / `setSelectedIndex` need to fire *after* the inner list exists. The eager dropdown build in Step 1 must run before the constructor-tail dispatch block.
- **`_value` before items arrive.** Step 6 covers this; verify the order of `setItems` then `setValue` is preserved.
- **Change event re-fire ordering.** Today ComboBox listens to its own `change` event and routes through `notifyChange`. After delegation, the list fires `change`; ComboBox's existing listener fires (via Event bus on `this`). Verify the event still routes through `this` and not the list.
- **`addItem`.** Today's ComboBox `addItem(label)` appends. List has the same method; just forward.

---

## Non-Goals

- **Make ComboBox extend List.** ComboBox has an outer chrome surface (label + caret) that List doesn't have. The composition shape is correct.
- **Delete `ComboBox._dropdown`.** The dropdown is still the floating overlay; keep it.
- **Replace `ComboBoxLabel` / `ComboBoxCaret` with anything else.** Out of scope.
