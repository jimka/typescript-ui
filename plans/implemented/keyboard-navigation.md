# Keyboard Navigation and Focus Management — Implementation Plan

## Executive Summary

The framework already has significant groundwork: `Aria` provides typed attribute setters including `setTabIndex`, both `Table/Body` and `Tree` have `tabIndex=0` on their containers, and `Tab`/`Tree`/`Body` all have partial keyboard handlers. The work is therefore incremental rather than greenfield. This plan fills the remaining gaps, adds missing ARIA state, and introduces the roving tabindex pattern for composite widgets where current code relies on a single focusable container.

---

## 1. Current State Audit

| Widget | `tabIndex=0` set? | keydown handler? | Roving tabindex? | `aria-activedescendant`? |
|---|---|---|---|---|
| Table/Body | Yes | Yes — Up/Down/Home/End only | No | No |
| Tree | Yes | Yes — full ARIA tree pattern | No | No |
| Tab layout | No explicit `tabIndex` on buttons | Yes — Left/Right with `focus()` | Partial | N/A |
| ButtonGroup | No | No | No | N/A |
| RadioButton | Native `<input type="radio">` | Native browser | No | N/A |
| ComboBox / List | Native `<select>` | Native browser | N/A | N/A |

Key observations:
- `Table/Body` is missing: column navigation (Left/Right), Page Up/Down, Enter to activate cell edit, and `aria-activedescendant`.
- `Tree` is missing: `aria-activedescendant` on the container, and `aria-setsize`/`aria-posinset` on rows.
- `Tab` toolbar lacks `tabIndex=0`, meaning keyboard users cannot Tab into the toolbar at all.
- `ButtonGroup`/`RadioButton` need roving tabindex (ToggleButton) or shared `name` attribute (RadioButton).
- `ComboBox`/`List` are backed by native `<select>` — browser handles navigation; only ARIA role declarations are missing.

---

## 2. Shared Abstraction: `RovingTabIndex`

### Rationale

Three widgets need roving tabindex: `ButtonGroup`, `Tab` toolbar. A shared helper avoids duplication.

### Proposed class: `Base/RovingTabIndex.ts`

Manages a list of `Component` items and tracks the active index.

- On construction, sets all items to `tabIndex=-1` and the initial active item to `tabIndex=0`.
- `moveTo(index: number): void` — sets previous active to `tabIndex=-1`, new one to `tabIndex=0`, calls `component.focus()`.
- `moveNext(): void` and `movePrev(): void` — wrap-around wrappers over `moveTo`.
- `add(component: Component): void` — appends; sets `tabIndex=-1` unless it is the first item.
- `remove(component: Component): void` — removes; if the removed item was active, moves focus to the previous sibling or index 0.
- `getActiveIndex(): number` and `getItems(): Component[]`.

### Where it does NOT apply

`Table/Body` and `Tree` use `aria-activedescendant` on the container. Rows are virtual-scrolled — pooled, re-bound, and may not be in the DOM. `RovingTabIndex` is designed for fully-resident DOM nodes. Using it for virtual rows would mean managing tabindex on pool slots that get rebound continuously — `aria-activedescendant` is the correct pattern here.

---

## 3. ARIA Additions Required in `Aria.ts`

Add the following methods:

```typescript
setActiveDescendant(id: string | null): void
setColIndex(value: number): void
getColIndex(): number | null
setColCount(value: number): void
getColCount(): number | null
setSetSize(value: number): void
getSetSize(): number | null
setPosInSet(value: number): void
getPosInSet(): number | null
setControls(id: string): void
getControls(): string | null
setPressed(value: boolean): void
getPressed(): boolean | null
```

Also extend the `AriaRole` union type with `'listbox' | 'combobox' | 'option'`.

---

## 4. Widget-by-Widget Changes

### 4.1 Table (`Body.ts` — primary; `Row.ts`, `Cell.ts`, `Table.ts` also touched)

#### What already works
Up/Down/Home/End move row selection. `aria-rowindex`, `aria-rowcount`, and `aria-selected` are set.

#### What is missing

**Column focus tracking**

Add to `Body`:
- `private _focusedColIndex: number = 0`
- `private _activeRowId: string | null = null`

**`aria-activedescendant` on the Body container**

After every navigation keystroke that changes row or column focus:
1. Call `scrollRecordIntoView` (already called for row nav).
2. Call `renderWindow` explicitly if not triggered by scroll.
3. Find the pool slot bound to the target index.
4. Call `this.getAria().setActiveDescendant(slot.getId())`.

This works because `scrollRecordIntoView` sets `element.scrollTop` synchronously, `renderWindow` reads it synchronously, guaranteeing the target row enters the pool before step 3.

**Extend `onKeyDown`**

- `ArrowLeft` / `ArrowRight` — decrease/increase `_focusedColIndex`, clamped to visible columns. Update `aria-colindex` on the focused cell. Update `aria-activedescendant` to the cell's element ID.
- `PageDown` — move selection down by `Math.floor(this.getHeight() / this.rowHeight)` rows.
- `PageUp` — mirror of PageDown.
- `Enter` — find the pool slot for the anchor record, call `startEdit()` on the cell at `_focusedColIndex`. No-op if the cell has no editor.

**`aria-colcount` on the grid**

In `Table.ts`, call `this.getAria().setColCount(this.getColumns().length)` after resolving columns and after each `setColumnVisible` call.

**`aria-colindex` on cells**

In `Body.renderWindow`, after positioning each cell, set `cell.getAria().setColIndex(ci + 1)`.

**`aria-activedescendant` when no row is selected**

Set to `""` (empty string removes the attribute) to signal no focus within the widget.

---

### 4.2 Tree (`Tree.ts`, `TreeRow.ts`)

#### What already works
Complete keyboard handler: Up/Down/Left/Right/Home/End. `aria-selected`, `aria-expanded`, `aria-level` are set.

#### What is missing

**`aria-activedescendant` on the container**

After every `_selectAtIndex` and `_extendSelectionTo`, scroll the focused node into view first, then find the pool slot bound to `_focusNode` and call `this.getAria().setActiveDescendant(row.getId())`.

**`aria-setsize` and `aria-posinset` on `TreeRow`**

In `_renderWindow`, when binding each row, compute the sibling count and position within the parent's children array. Pass these to `setRowData` as additional parameters. Inside `setRowData`, call:
```typescript
this.getAria().setSetSize(siblingCount);
this.getAria().setPosInSet(posInSiblings + 1);
```

**Focus indicator styling**

Add a CSS focus ring to the focused row that is distinct from the selection highlight. Update `_updateSelectionStyle` to apply/remove a focus ring style on the row whose `getNode() === this._focusNode`.

---

### 4.3 Tab Layout (`layout/Tab.ts`)

#### What already works
Left/Right key handler cycles between tabs and calls `newTab.focus()`. `aria-selected`, `role="tab"`, `role="tabpanel"`, and `aria-labelledby` are set.

#### What is missing

**Roving tabindex on the toolbar**

Apply `RovingTabIndex` in the `Tab` layout. When `createTab` is called, add the button to a `RovingTabIndex` instance. The existing `onToolbarKeyDown` handler replaces its manual `focus()` call with `this._rovingTabIndex.moveTo(newIdx)`. On tab activation by click, also call `this._rovingTabIndex.moveTo(clickedIdx)` to keep state consistent.

**`tabIndex=-1` on panel containers**

Set `tabIndex=-1` on each panel container so it can receive programmatic focus without entering the natural Tab order.

**`aria-controls`**

In `createTab`, call `tabButton.getAria().setControls(component.getId())` after both IDs are known.

---

### 4.4 ButtonGroup / RadioButton (`ButtonGroup.ts`, `RadioButton.ts`, `ToggleButton.ts`)

**For `RadioButton` groups — native name grouping:**
In `ButtonGroup.addButton`, if the button is a `RadioButton`, assign a shared `name` attribute to all `RadioButton.radio` elements in the group. Add `setRadioName(name: string): void` to `RadioButton` that calls `this.radio.setAttribute("name", name)`. The browser's native radio group navigation takes over.

`private _groupId: string` (UUID) is assigned once in the `ButtonGroup` constructor.

**For `ToggleButton` groups — roving tabindex via `RovingTabIndex`:**
In `ButtonGroup.addButton`, if the button is a `ToggleButton`, add it to a `RovingTabIndex` instance.

Add `setContainer(container: Component): void` to `ButtonGroup`. When set, register Left/Right/Up/Down keydown handlers via `Event.addSubtreeListener` on the container. On arrow press, call `rovingTabIndex.movePrev()` / `moveNext()`. On Space, trigger the focused `ToggleButton`'s action.

**`aria-pressed` on `ToggleButton`**

In `ToggleButton.setSelected`, call `this.getAria().setPressed(value)`.

---

### 4.5 List / ComboBox

Both are backed by native `<select>` — the browser fully handles keyboard navigation. No changes needed to event handling.

Required changes:
- In `ComboBox` constructor: `this.getAria().setRole("combobox")`.
- In `List` constructor: `this.getAria().setRole("listbox")`.

---

## 5. Virtual Scrolling and Keyboard Focus

The core tension: **the logically focused item may not have a DOM element** when its data index is outside the render window.

### Solution: `aria-activedescendant` + scroll-before-set

The container holds `tabIndex=0` and `aria-activedescendant="{rowId}"`. The implementation guarantees the referenced element exists by always scrolling first. The sequence for every navigation keystroke:

1. Compute new logical index.
2. Call `scrollRecordIntoView` / `_scrollIntoView` — sets `scrollTop` synchronously, triggering `renderWindow` synchronously.
3. Call `renderWindow` explicitly if not triggered by scroll.
4. Find the pool slot now bound to the target index (iterate `boundIndices`).
5. Set `aria-activedescendant` to that slot's element ID.
6. Update visual selection state.

### Edge cases

- **Empty store**: keydown handler already returns early — no change needed.
- **No row selected**: set `aria-activedescendant` to `""` (removes the attribute).
- **Single-row store**: all navigation resolves to index 0; scroll is a no-op; row is always in the pool.

---

## 6. ARIA Attributes Summary Per Widget

| Widget | Container role | Container tabIndex | Missing today |
|---|---|---|---|
| Table/Body | `rowgroup` / `grid` | 0 | `aria-activedescendant`, `aria-colcount`, `aria-colindex` per cell |
| Tree | `tree` | 0 | `aria-activedescendant`, `aria-setsize`, `aria-posinset` |
| Tab toolbar | `tablist` | Via roving tabindex | `aria-controls`, roving tabindex |
| ButtonGroup (ToggleButton) | None (caller-provided container) | Via roving tabindex | Roving tabindex, `aria-pressed` |
| ButtonGroup (RadioButton) | None | Native | Shared `name` attribute |
| ComboBox | `combobox` | Native | ARIA role declaration |
| List | `listbox` | Native | ARIA role declaration |

---

## 7. Key Design Decisions and Tradeoffs

**`aria-activedescendant` vs. roving tabindex for Table and Tree rows**
Chosen: `aria-activedescendant`. With large datasets, managing `tabIndex` on pool slots (which get rebound constantly) is more complex and confusing than keeping `tabIndex=0` only on the container and updating one attribute. The cost is reduced support in very old screen readers (NVDA < 2019, JAWS < 2018), which is acceptable for a modern framework.

**Shared `RovingTabIndex` class vs. inline per widget**
Chosen: shared class. `Tab` and `ButtonGroup` need identical semantics. The class is small (< 60 lines) and has no dependencies beyond `Component` and `Aria`.

**Native radio name grouping vs. custom roving tabindex for `RadioButton`**
Chosen: native name grouping. Correct semantic HTML, zero additional event handling, best screen reader experience. Cost: `ButtonGroup` must distinguish `RadioButton` from `ToggleButton` (it already stores them with a union type) and assign a shared `name` attribute.

**`tabIndex=-1` on Tab panels**
`tabIndex=0` would add an extra Tab stop before panel content, which is confusing. `tabIndex=-1` allows programmatic `panel.focus()` without entering Tab order.

**`aria-controls` on tab buttons**
Required by the ARIA `tab` role spec. Cost: two lines per tab button in `createTab`.

---

## 8. Ordered Implementation Steps

Steps are ordered from least risky (isolated ARIA additions) to most complex (virtual-scroll focus plumbing).

**Step 1 — Extend `Aria.ts`**
Add all new methods listed in section 3. Extend `AriaRole` union.

**Step 2 — Create `Base/RovingTabIndex.ts`**
Dependency-free aside from `Component` and `Aria`. Export from `Base/index.ts`.

**Step 3 — `ToggleButton` — add `aria-pressed`**
In `setSelected`, call `this.getAria().setPressed(value)`. One-line change.

**Step 4 — `Tab` layout — roving tabindex and `aria-controls`**
Instantiate `RovingTabIndex` in constructor. In `createTab`, add button to `rovingTabIndex` and set `aria-controls`. Replace manual `focus()` in `onToolbarKeyDown` with `rovingTabIndex.moveTo(newIdx)`.

**Step 5 — `ButtonGroup` / `RadioButton`**
Add `_groupId` to `ButtonGroup`. In `addButton`: apply native name grouping for `RadioButton`; apply `RovingTabIndex` for `ToggleButton`. Add `setContainer` to register subtree key handler. Add `setRadioName` to `RadioButton`.

**Step 6 — `Table/Body` — column navigation, Page Up/Down, Enter, `aria-activedescendant`**
Add `_focusedColIndex`. Set `aria-colindex` per cell in `renderWindow`. Set `aria-colcount` in `Table.ts`. Extend `onKeyDown` with ArrowLeft/Right, PageUp/Down, Enter. Set `aria-activedescendant` after every navigation.

**Step 7 — `Tree` — `aria-activedescendant`, `aria-setsize`, `aria-posinset`**
Set `aria-activedescendant` after `_selectAtIndex` and `_extendSelectionTo`. Compute and pass sibling metadata when binding rows. Add focus ring styling.

**Step 8 — `ComboBox` / `List` — ARIA roles**
Set `role="combobox"` and `role="listbox"` in constructors.

---

## 9. Files to Create or Modify

| File | Action | Key changes |
|---|---|---|
| `Base/Aria.ts` | Modify | Add methods listed in section 3; extend `AriaRole` union |
| `Base/RovingTabIndex.ts` | Create | New `RovingTabIndex` class |
| `Base/index.ts` | Modify | Export `RovingTabIndex` |
| `Base/component/ToggleButton.ts` | Modify | Call `setPressed` in `setSelected` |
| `Base/layout/Tab.ts` | Modify | Integrate `RovingTabIndex`; add `aria-controls`; fix toolbar `tabIndex` |
| `Base/ButtonGroup.ts` | Modify | Add `_groupId`, `setContainer`, `RovingTabIndex` for ToggleButton, `name` for RadioButton |
| `Base/component/RadioButton.ts` | Modify | Add `setRadioName` method |
| `Base/component/table/Body.ts` | Modify | Column nav, PageUp/Down, Enter, `aria-activedescendant`, `aria-colindex` |
| `Base/component/table/Table.ts` | Modify | Set `aria-colcount` on grid |
| `Base/component/tree/Tree.ts` | Modify | `aria-activedescendant`, `aria-setsize`, `aria-posinset`, focus ring |
| `Base/component/tree/TreeRow.ts` | Modify | Accept `setSize`/`posInSet` params; expose focus-ring state |
| `Base/component/ComboBox.ts` | Modify | Set `role="combobox"` |
| `Base/component/List.ts` | Modify | Set `role="listbox"` |

---

## Critical Files

- `src/typescript/Base/Aria.ts`
- `src/typescript/Base/component/table/Body.ts`
- `src/typescript/Base/component/tree/Tree.ts`
- `src/typescript/Base/layout/Tab.ts`
- `src/typescript/Base/ButtonGroup.ts`
- `src/typescript/Base/RovingTabIndex.ts` (new)
