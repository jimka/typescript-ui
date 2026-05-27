# ComboBox State Delegation — Implementation Plan

## Overview

Delete the four parallel-state fields on [`ComboBox`](../src/typescript/lib/component/input/ComboBox.ts) — `_items`, `_selectedIndex`, `_value`, `_storeRefresh` — and route every read and write through the embedded [`List`](../src/typescript/lib/component/list/List.ts). The previous refactor ([`plans/implemented/combobox-list-dropdown.md`](implemented/combobox-list-dropdown.md)) stood up the inner `List` but kept ComboBox's duplicate state intact "to limit diff surface" — see the explicit out-of-scope note at [combobox-list-dropdown.md:219](implemented/combobox-list-dropdown.md). This plan finishes that simplification.

Today's duplication: `ComboBox._items` + `ComboBox._storeRefresh` + `ComboBox.refreshFromStore` ([ComboBox.ts:451](../src/typescript/lib/component/input/ComboBox.ts#L451), [ComboBox.ts:457](../src/typescript/lib/component/input/ComboBox.ts#L457), [ComboBox.ts:914-1007](../src/typescript/lib/component/input/ComboBox.ts#L914-L1007)) mirror `AbstractCustomList._items` + `AbstractCustomList._storeRefresh` + `AbstractCustomList.refreshFromStore` ([AbstractCustomList.ts:398](../src/typescript/lib/component/list/AbstractCustomList.ts#L398), [AbstractCustomList.ts:418](../src/typescript/lib/component/list/AbstractCustomList.ts#L418), [AbstractCustomList.ts:652-676](../src/typescript/lib/component/list/AbstractCustomList.ts#L652-L676), [AbstractCustomList.ts:811-864](../src/typescript/lib/component/list/AbstractCustomList.ts#L811-L864)). Two arrays, two store-event registrations per ComboBox+dropdown pair, two refresh paths to keep in sync.

This plan covers ComboBox only. The sibling [`plans/autocomplete-list-dropdown.md`](autocomplete-list-dropdown.md) is still pending; it adds `setSelectFollowsFocus` / `getFocusedRowId` to `AbstractCustomList` but doesn't touch ComboBox state shape — independent.

---

## Architecture Decisions

### Eager dropdown construction is the enabler

The hosted `List` currently lives inside the lazy-built `ComboBoxDropdown` ([ComboBox.ts:663-687](../src/typescript/lib/component/input/ComboBox.ts#L663-L687)). With state delegation, every `getValue` / `getSelectedIndex` / `setItems` / `setStore` call on ComboBox needs to reach the inner list — which means the list must exist before the user opens the dropdown.

A `ComboBoxDropdown` with no items attached is cheap: the outer `AnimatedDropdown` `<div>` is built lazily by `getElement(true)` on first show, the inner `List` allocates a `Panel` + empty row pool but its `_innerPanel`'s DOM is only mounted when the dropdown root mounts. Net cost of eager construction: three JS instances (`ComboBoxDropdown`, `List`, `Panel`) and one `Fit` layout manager — no DOM nodes until first open.

The `ensureDropdown` lazy block at [ComboBox.ts:663-687](../src/typescript/lib/component/input/ComboBox.ts#L663-L687) collapses to a single field-init line in the constructor. The currently-replayed `setAnimated` / `setMinWidth` / `setStore` calls in that block all become regular `setX` forwarders that the constructor's options-bag dispatch path runs once, after the dropdown exists.

### ComboBox keeps its outer surface; only the state moves

The visual chrome (label, caret, click-to-open, viewport-pointerdown dismiss, `aria-expanded` toggle) stays on ComboBox itself. The `_label` (`ComboBoxLabel`) and `_caret` (`ComboBoxCaret`) children at [ComboBox.ts:455-456](../src/typescript/lib/component/input/ComboBox.ts#L455-L456) are unchanged. Only the data state and store binding shift to the embedded list.

### `_value` survives only as a pre-items cache

Today ComboBox accepts `setValue("admin")` before `setItems([…])` runs — the value is cached in `_value` ([ComboBox.ts:796-808](../src/typescript/lib/component/input/ComboBox.ts#L796-L808)) and re-resolved when items arrive via `refreshFromStore` ([ComboBox.ts:997-1004](../src/typescript/lib/component/input/ComboBox.ts#L997-L1004)). The inner list's `setValue` rejects unknown keys ([List.ts:103-109](../src/typescript/lib/component/list/List.ts#L103-L109)) — `findIndex` returns `-1`, `setSelectedIndex(-1, false)` clears the selection, and the prior write is lost.

Mitigation: keep a single ComboBox-level `_pendingValue: string | null` field. `setValue` writes the inner list (which may no-op for unknown keys) **and** stashes the key in `_pendingValue`. Any path that loads items (`setItems`, `addItem`, store refresh via the inner list's `change`-channel-adjacent rebuild) consults `_pendingValue` and re-attempts the list write. Cleared once a list `getValue()` round-trips the same key.

Rejected alternative: lift the pre-items cache into `AbstractCustomList` so any consumer gets it for free. Adds an axis to the list contract for one consumer; out of scope here.

### Re-fire the inner list's `change` on the ComboBox surface

Today ComboBox's `setSelectedIndex(idx, true)` fires `"change"` on `this` via `Event.fireEvent(this, "change")` ([ComboBox.ts:848](../src/typescript/lib/component/input/ComboBox.ts#L848)), and the constructor wires that into the `Bindable` channel via `notifyChange` ([ComboBox.ts:495](../src/typescript/lib/component/input/ComboBox.ts#L495)). After delegation, the *list* fires `"change"` on user gestures (click / Enter / Space through `notifyUserChange` → `fireChange`). The list's change source is the list itself — ComboBox's `Event.addListener(this, "change", …)` won't see it.

Wire it explicitly: bridge the list's `addActionListener` (already used at [ComboBox.ts:145](../src/typescript/lib/component/input/ComboBox.ts#L145) for `onRowSelected`) to also call `Event.fireEvent(this, "change")` — or, equivalently, fold the `notifyChange` call into the existing `onRowSelected` so the "change" event on ComboBox stays the single fire point.

Choice: fold into `onRowSelected`. `onRowSelected` already runs on every user commit and already calls `setSelectedIndex(idx, true)`; after delegation, `setSelectedIndex` becomes a forwarder that doesn't fire ComboBox-side, so the fire moves up to `onRowSelected`. Programmatic `setSelectedIndex(idx, true)` callers (none in the codebase outside `DateTimePickerSelect`'s `setSelectedIndex(snapped, false)` which passes `false`) get the fire from the forwarder explicitly re-emitting on `this`.

### Forwarders preserve the public API

Every `getX` / `setX` on ComboBox becomes a one-liner forwarding to the inner list. The forwarders survive for binding compatibility and so subclasses like `DateTimePickerSelect` ([DateTimePickerDropdown.ts:69-136](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L69-L136)) continue to call `combo.setItems(labels)` / `combo.setSelectedIndex(idx, false)` / `combo.getSelectedIndex()` / `combo.addActionListener(…)` without changing.

Net diff: ~80 lines deleted from ComboBox (`_items`, `_selectedIndex`, `_value`, `_storeRefresh` fields; `refreshFromStore` body; the lazy `ensureDropdown` replay block; the in-place option-bag dispatch for `store` / `items` / `selectedIndex` / `value` / `selectedItem`), ~15 lines of forwarders added.

---

## Public API (TypeScript Signatures)

No public-API changes. Every existing `ComboBox` method keeps its signature and visibility; bodies forward to `this._dropdown.getList()`. The `_dropdown` field's nullability flips from `ComboBoxDropdown | null` to `ComboBoxDropdown` (always present after construction).

---

## Internal Structure

After delegation, the ComboBox state shape is:

```typescript
class ComboBox<...> extends AbstractInput<string, TOptions> {
    private readonly _dropdown:      ComboBoxDropdown;            // eager
    private          _label:         ComboBoxLabel;
    private          _caret:         ComboBoxCaret;
    private          _pendingValue:  string | null = null;        // pre-items cache
    private readonly _onViewportPointerDown: (e: PointerEvent) => void;
    // deleted: _items, _selectedIndex, _value, _storeRefresh
}
```

The setters / getters become:

```typescript
setItems(items: String | Array<String>): this {
    this._dropdown.getList().setItems(items);
    this.reapplyPendingValue();
    this.refreshLabel();

    return this;
}

addItem(item: String): this {
    this._dropdown.getList().addItem(item);
    this.reapplyPendingValue();
    this.refreshLabel();

    return this;
}

setStore(store: AbstractStore, displayField: string, valueField?: string): this {
    this._options.store        = store;
    this._options.displayField = displayField;
    this._options.valueField   = valueField;

    this._dropdown.getList().setStore(store, displayField, valueField);
    this.reapplyPendingValue();
    this.refreshLabel();

    return this;
}

setValue(value: string): this {
    this._pendingValue = value;
    this._dropdown.getList().setValue(value);
    this.refreshLabel();

    return this;
}

getValue(): string {
    const v = this._dropdown.getList().getValue();

    // List returns "" for "nothing selected"; surface the cached
    // pending value so the pre-items setValue contract survives.
    return v || (this._pendingValue ?? "");
}

setSelectedIndex(idx: number, fireEvent: boolean = true): this {
    this._dropdown.getList().setSelectedIndex(idx, false);
    this._pendingValue = null;
    this.refreshLabel();

    if (fireEvent) {
        Event.fireEvent(this, "change");
    }

    return this;
}

getSelectedIndex(): number {
    return this._dropdown.getList().getSelectedIndex();
}

getItems(): Array<CustomListItem> {
    return this._dropdown.getList().getItems();
}

getSelectedRecord(): ModelRecord | undefined {
    return this._dropdown.getList().getSelectedRecord();
}

getStore(): AbstractStore | null {
    return this._dropdown.getList().getStore();
}

private reapplyPendingValue(): void {
    if (this._pendingValue === null) return;

    const list = this._dropdown.getList();
    list.setValue(this._pendingValue);

    if (list.getSelectedIndex() >= 0) {
        this._pendingValue = null;
    }
}

private computeLabel(): string {
    const list = this._dropdown.getList();
    const idx  = list.getSelectedIndex();
    const items = list.getItems();

    if (idx >= 0 && idx < items.length) {
        return items[idx].label;
    }

    return "";
}
```

The constructor's eager-build line replaces the field default:

```typescript
this._dropdown = new ComboBoxDropdown(idx => this.onRowSelected(idx));
```

…added **before** the existing late-state dispatch block ([ComboBox.ts:499-528](../src/typescript/lib/component/input/ComboBox.ts#L499-L528)) so `setItems` / `setValue` / `setStore` / `setSelectedIndex` can all forward into a live list. The dispatch block's order stays exactly as today (store → items → selectedIndex → value → selectedItem → enabled → readOnly).

---

## Ordered Implementation Steps

### Step 1 — Build the dropdown eagerly; collapse `ensureDropdown` to `getDropdown`

In the [`ComboBox` constructor](../src/typescript/lib/component/input/ComboBox.ts#L467) replace the `_dropdown: ComboBoxDropdown | null = null` field declaration with `readonly _dropdown: ComboBoxDropdown` and assign it before the late-dispatch block:

```typescript
this._dropdown = new ComboBoxDropdown(idx => this.onRowSelected(idx));
```

Move the prior `ensureDropdown` body's `setAnimated` and `setMinWidth` replay into either (a) the new `setDropdownAnimated` / `setDropdownMinWidth` forwarders, which now run unconditionally because `this._dropdown` is always present, or (b) a constructor-tail block after the dropdown is built. The `setStore` replay disappears entirely — Step 3's `setStore` forwarder writes the list every time.

Rename `ensureDropdown` → `getDropdown` (or inline it at the one remaining call site in `toggleDropdown`). Drop the null check in `closeDropdown` ([ComboBox.ts:646-652](../src/typescript/lib/component/input/ComboBox.ts#L646-L652)) and the `_dropdown?.` null-safe operator in `onViewportPointerDown` ([ComboBox.ts:695-705](../src/typescript/lib/component/input/ComboBox.ts#L695-L705)) and `setDropdownAnimated` ([ComboBox.ts:1014-1022](../src/typescript/lib/component/input/ComboBox.ts#L1014-L1022)) / `setDropdownMinWidth` ([ComboBox.ts:1042-1050](../src/typescript/lib/component/input/ComboBox.ts#L1042-L1050)).

### Step 2 — Delete `_items`, `_selectedIndex`, `_value`, `_storeRefresh`, `refreshFromStore`

Remove the four field declarations at [ComboBox.ts:451-457](../src/typescript/lib/component/input/ComboBox.ts#L451-L457). Remove the `refreshFromStore` method at [ComboBox.ts:974-1007](../src/typescript/lib/component/input/ComboBox.ts#L974-L1007). Add the single `_pendingValue: string | null = null` field per **Internal Structure**.

### Step 3 — Forward `getItems` / `setItems` / `addItem` / `getStore` / `setStore` / `getSelectedRecord` to the inner list

Replace bodies per **Internal Structure**. `setStore` keeps writing `this._options.store` / `displayField` / `valueField` so `applyEnabled` / `applyReadOnly` / the dispatch-block re-entry path continues to find them; the actual store-event subscription moves to the list. Drop the `_storeRefresh`-unsubscribe block from `setStore` ([ComboBox.ts:917-920](../src/typescript/lib/component/input/ComboBox.ts#L917-L920)) — the inner list's `setStore` already de-registers its previous handlers ([AbstractCustomList.ts:655-658](../src/typescript/lib/component/list/AbstractCustomList.ts#L655-L658)).

### Step 4 — Forward `getValue` / `setValue` / `getSelectedIndex` / `setSelectedIndex` to the inner list

Replace bodies per **Internal Structure**. `setValue` writes the list **and** caches in `_pendingValue` for the pre-items case. `getValue` reads the list and falls back to `_pendingValue` when the list returns `""`. `setSelectedIndex(idx, fireEvent)` clears `_pendingValue` (the index resolves to a real selection) and explicitly re-emits `"change"` on `this` when `fireEvent` is true.

### Step 5 — Re-fire user-driven `change` from `onRowSelected` only

The list's user-commit path is `addActionListener(() => onSelect(this._list.getSelectedIndex()))` ([ComboBox.ts:145](../src/typescript/lib/component/input/ComboBox.ts#L145)) → `onSelect(idx)` → `onRowSelected(idx)` → `setSelectedIndex(idx, true)` + `closeDropdown()`. After delegation, `setSelectedIndex(idx, true)` already re-emits `"change"` on `this` (per Step 4), so `onRowSelected` stays unchanged. Verify the existing `Event.addListener(this, "change", () => this.notifyChange(this.getValue()))` at [ComboBox.ts:495](../src/typescript/lib/component/input/ComboBox.ts#L495) still picks up the re-emitted event — it does, because the fire target is `this` (ComboBox), not the list.

### Step 6 — Wire `_pendingValue` reapplication on items / store loads

Every items-load path (`setItems`, `addItem`, `setStore` initial pull, list's own store-refresh events) needs `reapplyPendingValue` to run. `setItems` / `addItem` / `setStore` call it directly per **Internal Structure**. The list's own store-event refresh runs inside `AbstractCustomList.refreshFromStore` ([AbstractCustomList.ts:811-864](../src/typescript/lib/component/list/AbstractCustomList.ts#L811-L864)) — ComboBox doesn't observe that path directly. Mitigation: subscribe to the list's existing event bus for a refresh signal, or — cheaper — re-resolve `_pendingValue` lazily inside `getValue` and `computeLabel` so the binding read picks up the correct value once items land. The cheaper path is good enough (the only consumer of "value after store refresh fires" is the binding system, which polls via `getValue`).

### Step 7 — Update `computeLabel` to read from the list

Replace the `_items[_selectedIndex]` read at [ComboBox.ts:765-771](../src/typescript/lib/component/input/ComboBox.ts#L765-L771) with the list-backed version per **Internal Structure**. Replace the `toggleDropdown` call `dropdown.showAt(this.getElement(true), this._items, this._selectedIndex)` ([ComboBox.ts:633](../src/typescript/lib/component/input/ComboBox.ts#L633)) with `dropdown.showAt(this.getElement(true), dropdown.getList().getItems(), dropdown.getList().getSelectedIndex())` — the dropdown's `showAt` already calls `setItemsArray` on its own inner list ([ComboBox.ts:185](../src/typescript/lib/component/input/ComboBox.ts#L185)), so passing the list's own items round-trips harmlessly; this preserves the existing `showAt` signature without rewiring its body in this plan.

Alternative: extend `ComboBoxDropdown.showAt` to read items / selectedIndex from its own `_list` and drop the redundant params. Out of scope — keep the public method signature.

### Step 8 — Drop the in-constructor items / value / selectedIndex dispatch order risks

The late-dispatch block at [ComboBox.ts:499-528](../src/typescript/lib/component/input/ComboBox.ts#L499-L528) currently runs in a specific order (store → items → selectedIndex → value → selectedItem → enabled → readOnly). After delegation, every dispatched setter forwards into the inner list which is built one line earlier (Step 1). Verify the order still produces correct results — specifically, that `selectedIndex` followed by `value` ends with `value` winning (today's behaviour: `setValue` overwrites `_selectedIndex` and `_value`; after delegation: `setValue` writes the list which re-resolves by key).

### Step 9 — Audit `DateTimePickerSelect` and the cell-editor variant

[`DateTimePickerSelect extends ComboBox`](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L69-L136) uses `setItems(labels)` ([:101](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L101)), `setSelectedIndex(idx, false)` ([:106-108](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L106-L108)), `getSelectedIndex()` ([:130](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L130)), `addActionListener(…)` ([:111](../src/typescript/lib/component/input/DateTimePickerDropdown.ts#L111)). All forwarders preserve their semantics; smoke-test the picker time row to confirm.

Demo combos in [`BindingPanel.ts:54-58`](../src/typescript/BindingPanel.ts#L54-L58) (`roleCombo` — store-bound) and [`BindingPanel.ts:125-129`](../src/typescript/BindingPanel.ts#L125-L129) (`recordCombo` — store-bound), [`MiscPanel.ts:835`](../src/typescript/MiscPanel.ts#L835) (`animatedCombo`), [`ToolBarPanel.ts:58`](../src/typescript/ToolBarPanel.ts#L58) (`zoom` — items-array), [`ComplexUIPanel.ts:40`](../src/typescript/ComplexUIPanel.ts#L40) (`addItem`-chain), and [`LayoutTestPanel.ts:21`](../src/typescript/LayoutTestPanel.ts#L21) / [`BaselinePanel.ts:47`](../src/typescript/BaselinePanel.ts#L47) (empty combo) all exercise different option paths — run them all.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/input/ComboBox.ts` — eager dropdown build; delete `_items` / `_selectedIndex` / `_value` / `_storeRefresh` fields and `refreshFromStore` method; replace `ensureDropdown` with `getDropdown`; convert every public getter/setter into a forwarder; add `_pendingValue` + `reapplyPendingValue`; re-emit `"change"` from `setSelectedIndex` when `fireEvent` is true. |
| (No new files.) | — |
| (No deletes.) | — |

---

## Verification

- `npx tsc --noEmit` — 0 errors.
- `npm run docs:build` — 0 errors, 0 new link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- `grep -n '_items\b\|_selectedIndex\b\|_value\b\|_storeRefresh\b\|refreshFromStore' src/typescript/lib/component/input/ComboBox.ts` — expect zero matches for the deleted symbols (cache-related `_pendingValue` and the unrelated `_options.value` survive).
- **Manual smoke test on `BindingPanel`**: the two store-bound combos (`roleCombo`, `recordCombo`) round-trip selection through the Binding correctly; record-pick updates the form; binding commit / reject paths trigger expected status text.
- **Manual smoke test on `MiscPanel`**: the animated ComboBox demo opens, click / keyboard commit, type-ahead, store-bound items, theme toggle.
- **Manual smoke test on `ToolBarPanel`** (`zoom`) and **`ComplexUIPanel`** (`addItem` chain): items-array path, `addItem` path.
- **Manual smoke test on `DateTimePickerSelect`** via any DateTime demo: open dropdown inside the picker panel, click an hour / minute, confirm the time row updates without tearing down the parent picker (the existing `setFocusOnRowClick(false)` + ComboBox-keeps-focus contract from `combobox-list-dropdown` survives the refactor).
- **Pre-items setValue regression**: in dev, `const c = new ComboBox(); c.setValue("x"); c.setItems(["a","x","b"]);` should leave `c.getValue() === "x"` and `c.getSelectedIndex() === 1` (the `_pendingValue` reapplication path).

---

## Potential Challenges

- **Construction-time dispatch order.** The eager `new ComboBoxDropdown(…)` line must run *before* the late-dispatch block at [ComboBox.ts:499-528](../src/typescript/lib/component/input/ComboBox.ts#L499-L528) so `setItems` / `setValue` / `setStore` forwarders can reach the live list.
- **`_pendingValue` reapplication race with store refresh.** When the bound store fires `load` after `setValue` ran pre-items, the inner list's `refreshFromStore` re-populates items; the list doesn't notify ComboBox. Mitigation: the lazy `reapplyPendingValue` path inside `getValue` covers binding-driven reads; UI label refresh on store events is wired by the existing `Event.addListener(this, "change", …)` only on user commits. If the label needs to reflect a store-load while the dropdown is closed, subscribe to the store's `load` / `datachanged` events on the ComboBox side (one extra listener pair) and call `refreshLabel` + `reapplyPendingValue`. Decide at implement time based on whether the existing demos exercise this path.
- **`setSelectedIndex(idx, true)` re-emit.** Today the fire flows: ComboBox.`setSelectedIndex` → `Event.fireEvent(this, "change")` → ComboBox's own listener → `notifyChange`. After delegation, the forwarder must keep firing `"change"` on `this` so the listener at [ComboBox.ts:495](../src/typescript/lib/component/input/ComboBox.ts#L495) still runs. Do **not** rely on the list's own `fireChange` — that fires on the list, not on `this`.
- **`onRowSelected` double-fire risk.** `onRowSelected` calls `setSelectedIndex(idx, true)` which re-emits `"change"` on ComboBox. The inner list's `addActionListener` registration at [ComboBox.ts:145](../src/typescript/lib/component/input/ComboBox.ts#L145) is the gateway — if that handler *also* directly fired `"change"` on ComboBox, the binding would notify twice. Keep the fire in exactly one place (`setSelectedIndex` re-emit).
- **`getStore` return shape.** Today `getStore` reads from `this._options.store` ([ComboBox.ts:953-955](../src/typescript/lib/component/input/ComboBox.ts#L953-L955)). After delegation, forwarding to `this._dropdown.getList().getStore()` returns the same value because `setStore` writes both `this._options.store` and `list._options.store`. Either source works; pick the list for single-source consistency.
- **`getSelectedRecord` ordering.** Today reads `store.getRecords()[this._selectedIndex]` ([ComboBox.ts:962-970](../src/typescript/lib/component/input/ComboBox.ts#L962-L970)); the list's `getSelectedRecord` does the same ([AbstractCustomList.ts:697-711](../src/typescript/lib/component/list/AbstractCustomList.ts#L697-L711)). Identical semantics — straight forwarder.

---

## Critical Files

- [`src/typescript/lib/component/input/ComboBox.ts`](../src/typescript/lib/component/input/ComboBox.ts) — the file under modification.
- [`src/typescript/lib/component/list/List.ts`](../src/typescript/lib/component/list/List.ts) — the inner list; read `setItemsArray` ([List.ts:90-92](../src/typescript/lib/component/list/List.ts#L90-L92)), `setValue` ([List.ts:103-109](../src/typescript/lib/component/list/List.ts#L103-L109)), `getValue` ([List.ts:117-125](../src/typescript/lib/component/list/List.ts#L117-L125)) to confirm contracts.
- [`src/typescript/lib/component/list/AbstractCustomList.ts`](../src/typescript/lib/component/list/AbstractCustomList.ts) — owns `setStore` ([:652-676](../src/typescript/lib/component/list/AbstractCustomList.ts#L652-L676)), `refreshFromStore` ([:811-864](../src/typescript/lib/component/list/AbstractCustomList.ts#L811-L864)), `setSelectedIndex` ([:746-766](../src/typescript/lib/component/list/AbstractCustomList.ts#L746-L766)), `getSelectedRecord` ([:697-711](../src/typescript/lib/component/list/AbstractCustomList.ts#L697-L711)).
- [`src/typescript/lib/component/input/DateTimePickerDropdown.ts`](../src/typescript/lib/component/input/DateTimePickerDropdown.ts) — the `DateTimePickerSelect` subclass that must keep working through forwarders.
- [`src/typescript/lib/core/AnimatedDropdown.ts`](../src/typescript/lib/core/AnimatedDropdown.ts) — read the lazy `getElement(true)` contract to confirm eager `new ComboBoxDropdown(…)` doesn't mount the DOM until first show.
- [`plans/implemented/combobox-list-dropdown.md`](implemented/combobox-list-dropdown.md) — the prior refactor; specifically the out-of-scope note about deferred state cleanup that this plan completes.
- [`plans/autocomplete-list-dropdown.md`](autocomplete-list-dropdown.md) — pending sibling; independent of this plan's scope but touches the same `AbstractCustomList` surface.

---

## Non-Goals

- **Make `ComboBox` extend `List`.** ComboBox has an outer chrome surface (label + caret + viewport-pointerdown dismiss + click-to-open) that `List` doesn't have. Composition is correct.
- **Delete `ComboBox._dropdown`.** The dropdown is still the floating overlay; it stays.
- **Replace `ComboBoxLabel` / `ComboBoxCaret` with anything else.** Out of scope.
- **Add a `multi: true` ComboBox.** Defer to a separate plan if the use case arrives.
- **Lift the pre-items-cache pattern (`_pendingValue`) into `AbstractCustomList`.** Adds a feature for one consumer; out of scope.
- **Re-shape `ComboBoxDropdown.showAt(anchorEl, items, selectedIndex)` to drop the redundant `items` / `selectedIndex` params now that the list owns them.** A signature change is a separate plan; this one preserves all current public method shapes.
