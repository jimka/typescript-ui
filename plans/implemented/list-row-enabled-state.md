---
touches-shared:
  - packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts
  - packages/lib/src/typescript/lib/component/list/MultiSelectList.ts
---

# Per-row enabled state for selectable lists — Implementation Plan

## Overview

[`AbstractSelectableList`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L727) — the base behind [`List`](packages/lib/src/typescript/lib/component/list/List.ts#L30) and [`MultiSelectList`](packages/lib/src/typescript/lib/component/list/MultiSelectList.ts#L38) — can be enabled or disabled only as a whole, through the `enabled` flag it inherits from `AbstractInput`. A single row cannot be marked unavailable. A host that wants one row greyed out has to leave that row out of the item array entirely.

This plan adds a per-row flag. A [`SelectableListItem`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L31) gains an optional `enabled` field beside its existing `glyph` and `tooltip`. A row whose item carries `enabled: false` renders dim, refuses a click and an Enter/Space commit, and is stepped over by arrow-key navigation and type-ahead. It keeps its index, its key, and its place in `getValue()`, so nothing about the item array's numbering changes.

The change is almost entirely inside `AbstractSelectableList.ts`: one new item field, one new class-tier style rule, a typed setter on the internal `SelectableListRow`, a query and a setter on the list, and guards on the gesture paths. [`MultiSelectList`](packages/lib/src/typescript/lib/component/list/MultiSelectList.ts#L38) additionally keeps its `Shift`-range and `Ctrl+A` gestures from selecting a disabled row.

---

## Architecture Decisions

### The flag lives on the item, as `enabled?: boolean`

`SelectableListItem` gains `enabled?: boolean`. A row is disabled only when the field is exactly `false`; `undefined` and `true` both mean enabled. This is [`MenuItemConfig.enabled`](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L71) and [`MenuItem.isEnabled()`](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L467)'s shape verbatim — the library's existing answer for "a disabled entry inside a keyboard-navigable list of entries".[^why-item-field] [^why-tri-state]

### Navigation skips a disabled row; the commit paths also guard

Arrow keys, `Home`, `End`, `PageUp`, `PageDown` and type-ahead only ever move the focus highlight to an enabled row. On top of that, the click and Enter/Space paths check the targeted row again before committing, exactly as [`MenuItem.activate()`](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L524) refuses a disabled row that the menu's highlight has landed on.

The skip is one deliberate divergence from `Menu`. [`Menu.isItemSkipped`](packages/lib/src/typescript/lib/overlay/Menu.ts#L1094) skips only rows that are not navigable — separators and control rows — so a *disabled* `MenuItem` still receives the menu's arrow-key highlight and is refused later by `activateFocused`. A list cannot copy that arrangement: `_selectFollowsFocus` is `true` by default, so in a list an arrow key **is** a selection commit.[^why-skip]

### A disabled row keeps its index, key and value semantics

`_items`, `getItems()`, row indices, `getValue()`, `setValue` / `setValues`, `getSelectedIndex`, `getSelectedRecord` and `scrollIndexIntoView` all treat a disabled item exactly like any other. A disabled row is not a separator: it occupies index `i` and its row sits at `_rowPool[i]`.[^why-indices-keep]

### Only user gestures refuse; programmatic writes do not

`setSelectedIndex`, `List.setValue` and `MultiSelectList.setValues` may select a disabled row and are left untouched. Every guard added by this plan sits on a user-driven path — the row click, the row double-click, Enter/Space, arrow navigation, type-ahead, `Ctrl+A`, and the `Shift`-range extension.[^why-programmatic-unfiltered]

### Dimming is a `.disabled` class token on the row, dimming label and glyph together

`SelectableListRow` already computes its whole `class` attribute from cached state in [`applyRowClass`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L580), which is how `.selected` and `.focused` are applied. A `disabled` token joins that set, and a new module-level `.SelectableListRow.disabled` rule sets `color` to the existing `--ts-ui-list-row-disabled-color` theme token. This mirrors [`PickerColumn`](packages/lib/src/typescript/lib/component/input/PickerColumn.ts#L59)'s `.PickerCell.disabled` rule and [`MenuItem`](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L494)'s use of the matching `--ts-ui-*-item-disabled-color` token.[^why-class-rule]

One `color` declaration dims both the label and the icon: the built-in renderers set no foreground of their own, and a `Glyph` renders with `fill: currentColor` ([Glyph.ts:718](packages/lib/src/typescript/lib/component/display/Glyph.ts#L718)).

The disabled rule declares `color` and nothing else, and the row's existing hover rule gains a `:not(.disabled)` guard. Those two facts settle which rule paints what:

| Row state | Competing rules | Outcome |
|---|---|---|
| enabled, hovered | `.SelectableListRow:not(.disabled):hover` matches | hover background applies, as today |
| disabled, hovered | `:not(.disabled)` cannot match | no hover background |
| selected and disabled | `.selected` `(0,2,0)`, declared earlier, vs `.disabled` `(0,2,0)`, declared later | `.disabled` wins `color`; `background-color` stays `.selected`'s, because `.disabled` never declares it |

The row's `cursor` is written per instance from the row's own `setEnabled`, not in the class rule.[^why-cursor-instance]

### `setItemEnabled(index, enabled)` for a live change

A row's availability can change after `setItems`, so the list gets `setItemEnabled(index, enabled)` alongside the construction-time field — the same pair [`Menu.setItemEnabled`](packages/lib/src/typescript/lib/overlay/Menu.ts#L561) and [`MenuItem.setEnabled`](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L485) already form.[^why-setter] It replaces the item object rather than mutating it in place.[^why-copy-on-write]

### `MultiSelectList` prunes disabled indices after the shared modifier reducer

[`MultiSelectList.reduceSelection`](packages/lib/src/typescript/lib/component/list/MultiSelectList.ts#L221) drops any disabled index from `_selectedSet` after [`reduceModifierSelection`](packages/lib/src/typescript/lib/component/shared/reduceModifierSelection.ts#L31) has run, and [`selectAll`](packages/lib/src/typescript/lib/component/list/MultiSelectList.ts#L268) skips disabled indices while filling the set. The shared reducer itself is not touched.[^why-prune-local]

---

## Public API

New field on the exported item interface. It is already re-exported from the subpath barrel ([`component/list/index.ts:7`](packages/lib/src/typescript/lib/component/list/index.ts#L7)), so the field is public with no barrel change.

```typescript
export interface SelectableListItem {
    key:      string;
    label:    string;
    glyph?:   string;
    tooltip?: string;
    /**
     * Whether the row is interactive. Defaults to `true` — only an explicit
     * `false` disables the row, which then renders dim, refuses clicks and
     * Enter/Space, and is skipped by arrow-key navigation and type-ahead. A
     * disabled row keeps its index and its key: it is still returned by
     * `getItems`, and a programmatic `setValue` / `setValues` can still select
     * it.
     */
    enabled?: boolean;
}
```

New members on `AbstractSelectableList<TValue, TOptions>`, inherited unchanged by `List` and `MultiSelectList`:

```typescript
/**
 * Whether the item at `index` is interactive. `false` for an item carrying
 * `enabled: false`, and for an index outside the item array.
 */
isItemEnabled(index: number): boolean;

/**
 * Updates one item's enabled state in place, repainting just that row.
 * Selection and focus are left exactly as they are. No-op for an index
 * outside the item array.
 */
setItemEnabled(index: number, enabled: boolean): this;
```

A private `nearestEnabledIndex(from: number, direction: 1 | -1): number` helper backs the navigation filter — see *Internal Structure*. It is not part of the public surface.

New members on the internal `SelectableListRow` (not exported; the public surface is the item field and the two methods above). They match `setSelected` / `isSelected` and `setFocused` / `isFocused` in shape, and `MenuRow.isEnabled` / `MenuItem.setEnabled` in name:

```typescript
/** Cached; written by `setEnabled`, read by `applyRowClass`. */
private _enabled: boolean = true;

setEnabled(value: boolean): this;
isEnabled(): boolean;
```

`SelectableListRow` has no `enabled` options-bag field: the row is internal and framework-driven, and the item array is the consumer's configuration surface. This is the same treatment `_selected` and `_focused` already get.

---

## Internal Structure

The single place that encodes the "only `false` disables" rule:

```typescript
isItemEnabled(index: number): boolean {
    const item = this._items[index];

    return item !== undefined && item.enabled !== false;
}
```

The navigation scan. The first loop walks in the direction of travel; the second walks back the other way from one step behind the target:

```typescript
private nearestEnabledIndex(from: number, direction: 1 | -1): number {
    for (let i = from; i >= 0 && i < this._items.length; i += direction) {
        if (this.isItemEnabled(i)) {
            return i;
        }
    }

    for (let i = from - direction; i >= 0 && i < this._items.length; i -= direction) {
        if (this.isItemEnabled(i)) {
            return i;
        }
    }

    return -1;
}
```

The row's typed setter, guarded on change so a selection repaint does not re-queue a style write per row:

```typescript
setEnabled(value: boolean): this {
    if (this._enabled === value) {
        return this;
    }

    this._enabled = value;
    this.getAria().setDisabled(!value);
    this.setCursor(value ? "pointer" : "default");
    this.applyRowClass();

    return this;
}
```

`setItemEnabled` replaces the item object and repaints one row:

```typescript
setItemEnabled(index: number, enabled: boolean): this {
    const item = this._items[index];

    if (item === undefined) {
        return this;
    }

    this._items[index] = { ...item, enabled };
    this._rowPool[index]?.setEnabled(enabled);

    return this;
}
```

---

## Ordered Implementation Steps

Every path below is under `packages/lib/`.

1. **Add the item field.** In `src/typescript/lib/component/list/AbstractSelectableList.ts`, add `enabled?: boolean` to `SelectableListItem` ([L31](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L31)) after `tooltip` ([L51](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L51)), with the JSDoc from *Public API*.

2. **Carry the field through the item builders.** In `setItems` ([L1176](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1176)) and `addItem` ([L1242](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1242)), add `enabled: (entry as SelectableListItem).enabled` to the object literal each builds, beside the existing `glyph` / `tooltip` copies. A plain-string entry stays `{ key, label }` with no `enabled` key. `setItemsArray` ([L1212](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1212)) copies items verbatim and needs no change; `refreshFromStore` ([L1510](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1510)) is deliberately left alone (see *Non-Goals*).

3. **Add the row's style rule.** At the **end** of the module-level style IIFE ([L188–L264](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L188)), after the existing `.SelectableListRow.focused` rule, add:
   ```typescript
   // Registered last on purpose. `.SelectableListRow.selected` and
   // `.SelectableListRow.focused` have the same (0,2,0) specificity as this
   // rule, so stylesheet order decides: a selected-but-disabled row keeps
   // its selection background (this rule declares none) but takes the
   // dim colour. `color` alone dims the label and the glyph together — the
   // built-in renderers set no foreground and a Glyph paints with
   // `fill: currentColor`.
   new StyleRule({
       scope:  "selector",
       name:   ".SelectableListRow.disabled",
       styles: {
           color: "var(--ts-ui-list-row-disabled-color, rgb(170, 170, 170))",
       },
   });
   ```

4. **Suppress the hover background on a disabled row.** Change the existing hover rule's selector ([L236](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L236)) from `.SelectableListRow:hover` to `.SelectableListRow:not(.disabled):hover`, keeping its declaration block unchanged. Leave the row's pointer events alone, so the row still receives hover and its `Tooltip` still opens.
   - Checkpoint: `grep -n 'SelectableListRow:hover' src/typescript/lib/component/list/AbstractSelectableList.ts` — expect zero matches.

5. **Add the row's cached flag and typed setter.** In `SelectableListRow`, add `private _enabled: boolean = true;` beside `_selected` / `_focused` ([L286–L287](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L286)), and add `setEnabled` / `isEnabled` per *Internal Structure*, placed after `setFocused` / `isFocused` ([L482](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L482)). A plain field initializer is correct here — no setter dispatched during the `super()` cascade writes `_enabled`, exactly as for `_selected` and `_focused`.

6. **Push the token into the class list.** In `applyRowClass` ([L580](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L580)), after the `_focused` branch, add:
   ```typescript
   if (!this._enabled) {
       classes.push("disabled");
   }
   ```

7. **Bind the flag when a row binds an item.** In `SelectableListRow.updateItem` ([L358](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L358)), after the `applyTooltip` call, add `this.setEnabled(item.enabled !== false);`. `updateItem` is the one place a row binds to an item, so it covers both `syncRows` loops ([L1574](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1574) and [L1583](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1583)) and the pooled-row reuse path. Do **not** add an `enabled` line to `refreshRowVisualState` ([L1628](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1628)) — the flag changes only when an item changes, and `setItemEnabled` repaints its own row.

8. **Add `isItemEnabled` and `setItemEnabled`.** Add both public methods per *Internal Structure*, placed after `setSelectedIndex` ([L1398](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1398)), with the JSDoc from *Public API*.

9. **Add `nearestEnabledIndex`.** Add the private helper per *Internal Structure*, placed immediately before `handleNavigationKey` ([L1912](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1912)).

10. **Filter navigation.** In `handleNavigationKey` ([L1912](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1912)), keep the existing per-key `next` computation unchanged, then resolve it through `nearestEnabledIndex` before calling `moveFocus`. Each key also declares its direction of travel:
    ```typescript
    // ArrowDown / PageDown / Home travel forward, ArrowUp / PageUp / End back.
    const direction: 1 | -1 = (e.key === "ArrowDown" || e.key === "PageDown" || e.key === "Home") ? 1 : -1;
    const target = this.nearestEnabledIndex(next, direction);

    // Every row disabled: the list still owns the key (preventDefault above
    // already ran) but the focus highlight has nowhere legal to go.
    if (target < 0) {
        return true;
    }

    this.moveFocus(target, ctrl, e.shiftKey);

    return true;
    ```

11. **Filter type-ahead.** In `handleTypeAhead` ([L2007](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L2007)), change the match to skip disabled rows:
    ```typescript
    const idx = this._items.findIndex(
        (item, i) => this.isItemEnabled(i) && item.label.toLowerCase().startsWith(buf),
    );
    ```

12. **Refuse a click on a disabled row.** In `handleRowClick` ([L1680](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1680)), after the existing range check and before `reduceSelection`, add:
    ```typescript
    if (!this.isItemEnabled(idx)) {
        return;
    }
    ```

13. **Refuse a double-click on a disabled row.** Add the same guard to `handleRowDblClick` ([L1735](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1735)), after its range check. Leave `handleRowContextMenu` ([L1717](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1717)) unguarded.[^why-dblclick-not-contextmenu]

14. **Refuse an Enter/Space commit on a disabled row.** In `commitFocusedRow` ([L1988](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1988)), widen the existing guard:
    ```typescript
    if (this._focusedIndex < 0 || !this.isItemEnabled(this._focusedIndex)) {
        return;
    }
    ```
    The widened guard is what catches a focus position parked on a disabled row by a programmatic `setSelectedIndex`.

15. **Prune the multi-select range.** In `MultiSelectList.reduceSelection` ([MultiSelectList.ts:221](packages/lib/src/typescript/lib/component/list/MultiSelectList.ts#L221)), after the `reduceModifierSelection` call and before `this._focusedIndex = idx;`, add:
    ```typescript
    // The shared modifier reducer sweeps a contiguous index range, so a
    // Shift-extension can cross a disabled row. Drop those: a gesture must
    // never select a row the user could not have clicked.
    for (const i of [...this._selectedSet]) {
        if (!this.isItemEnabled(i)) {
            this._selectedSet.delete(i);
        }
    }
    ```

16. **Skip disabled rows in select-all.** In `MultiSelectList.selectAll` ([MultiSelectList.ts:268](packages/lib/src/typescript/lib/component/list/MultiSelectList.ts#L268)), guard the fill loop with `if (this.isItemEnabled(i))`. Leave the `_anchorIndex = 0` / `_focusedIndex = this._items.length - 1` lines as they are — the commit guard covers a focus parked on a disabled last row.
    - Checkpoint: `grep -rn 'enabled !== false' src/typescript/lib/component/list/` — expect exactly **two** matches: `isItemEnabled`'s body and `updateItem`'s call. Every other check routes through `isItemEnabled`.

17. **Write the tests.** Add the cases from *Expected Behaviour* to `tests/component/list/List.test.ts` (item plumbing, `isItemEnabled` / `setItemEnabled`, navigation, type-ahead, click and commit refusal) and `tests/component/list/MultiSelectList.test.ts` (range prune, select-all). Add the rendered class/cursor cases to `tests/component/list/RowFrameworkClass.test.ts`, whose `lastClassTokens` helper and `installTestDOM` setup are already exactly the harness those need.

18. **Update the docs.** `docs/components/List.md`: add a `## Disabled rows` section after *Item renderers*, note under the keyboard table that navigation and type-ahead skip disabled rows, and extend the theme-token sentence to say what `--ts-ui-list-row-disabled-color` now colours. `docs/components/MultiSelectList.md`: add a one-paragraph *Disabled rows* section pointing at `List`'s, and note in the *Selection model* table that `Ctrl`-`A` and `Shift`-extension skip disabled rows.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/MultiSelectList.ts` |
| Modify | `packages/lib/tests/component/list/List.test.ts` |
| Modify | `packages/lib/tests/component/list/MultiSelectList.test.ts` |
| Modify | `packages/lib/tests/component/list/RowFrameworkClass.test.ts` |
| Modify | `packages/lib/docs/components/List.md` |
| Modify | `packages/lib/docs/components/MultiSelectList.md` |

No files are created or deleted. `List.ts`, `ListItemRenderer.ts`, `ListItemRenderContext.ts`, the renderers, `Theme.ts` and `reduceModifierSelection.ts` are **not** touched.

---

## Expected Behaviour

The fixture for the navigation cases: six rows, with rows 1, 2 and 5 disabled.

```typescript
const ROWS = [
    { key: 'a', label: 'Apple'   },
    { key: 'b', label: 'Banana',  enabled: false },
    { key: 'c', label: 'Cherry',  enabled: false },
    { key: 'd', label: 'Date'    },
    { key: 'e', label: 'Elder'   },
    { key: 'f', label: 'Fig',     enabled: false },
];
```

Set the starting focus with `setSelectedIndex(i, false)`, which parks `_focusedIndex` at `i` without firing `change`. An offline list has no height, so `handleNavigationKey`'s page size falls back to one row and `PageDown` behaves exactly as `ArrowDown` — which is why the table has no page-key row; the page keys use the same code path and need no separate case.

| Focus before | Key | Raw target | Scan | Focus after |
|---|---|---|---|---|
| 0 | `ArrowDown` | 1 | forward from 1: 1 ✗, 2 ✗, 3 ✓ | 3 |
| 4 | `ArrowDown` | 5 | forward from 5: 5 ✗, end; back from 4: 4 ✓ | 4 (no move) |
| 3 | `ArrowUp` | 2 | back from 2: 2 ✗, 1 ✗, 0 ✓ | 0 |
| 0 | `ArrowUp` | 0 | back from 0: 0 ✓ | 0 (no move) |
| −1 (none) | `Home` | 0 | forward from 0: 0 ✓ | 0 |
| −1 (none) | `End` | 5 | back from 5: 5 ✗, 4 ✓ | 4 |

**Unit-testable** (offline harness — `new _List({ items })`, `handleKey` with a `{ key, preventDefault(){}, stopPropagation(){} }` stub as in [ComboBox.test.ts:21](packages/lib/tests/component/input/ComboBox.test.ts#L21), and `installTestDOM` + `RecordingDOMSink` for the two rendered cases):

1. **The field round-trips.** `setItemsArray(ROWS)` then `getItems()[1].enabled === false` and `getItems()[0].enabled === undefined`. Same through `setItems(ROWS)` and through `addItem({ key: 'g', label: 'Grape', enabled: false })`.
2. **A plain string stays enabled.** `setItems(['Apple'])` then `isItemEnabled(0) === true`.
3. **`isItemEnabled`.** `true` for a missing field, `true` for `enabled: true`, `false` for `enabled: false`, `false` for index `-1` and for an index past the end.
4. **`setItemEnabled` updates the flag.** `setItemEnabled(0, false)` then `isItemEnabled(0) === false` and `getItems()[0].enabled === false`; `setItemEnabled(1, true)` then `isItemEnabled(1) === true`.
5. **`setItemEnabled` does not mutate the caller's object.** Hold a reference to the object passed to `setItemsArray`, call `setItemEnabled` on its index, and assert the held object's own `enabled` is unchanged.
6. **`setItemEnabled` out of range is a no-op.** `setItemEnabled(99, false)` returns the list and leaves `getItems()` unchanged.
7. **`setItemEnabled` leaves selection and focus alone.** `setSelectedIndex(0, false)` then `setItemEnabled(0, false)` → `getSelectedIndex() === 0` and `getFocusedIndex() === 0`.
8. **Navigation skips.** Each row of the table above, driven through `handleKey` and read back with `getFocusedIndex()`.
9. **An all-disabled list consumes the key but does not move.** Every item `enabled: false` → `handleKey(key('ArrowDown')) === true` and `getFocusedIndex()` unchanged.
10. **Type-ahead skips a disabled match.** Items `[{ key:'a', label:'Apple', enabled:false }, { key:'b', label:'Avocado' }]`, then `TestList`'s existing `typeAhead('a')` widening → `getFocusedIndex() === 1`.
11. **A click on a disabled row is refused.** `TestList` must widen `handleRowClick` the way it already widens `handleRowContextMenu` / `handleRowDblClick`. With `setFocusOnRowClick(false)` and a listener registered through `on('change', fn)` — the listener-bag event, which fires without a rendered element, unlike `'action'` — driving the widened click at index 1 leaves `getSelectedIndex()` unchanged and fires no `change`.
12. **A double-click on a disabled row fires nothing.** A registered `dblclick` listener is not called for index 1.
13. **A right-click on a disabled row still fires.** A registered `contextmenu` listener **is** called for index 1, and the event's default is prevented.
14. **Enter on a focus parked at a disabled row is refused.** `setSelectedIndex(1, false)` (which parks focus at 1) then `handleKey(key('Enter'))` leaves `getValue()` and `getSelectedIndex()` unchanged and fires no `on('change', …)` callback.
15. **Programmatic selection still reaches a disabled row.** `List.setValue('b')` → `getSelectedIndex() === 1` and `getValue() === 'b'`. `MultiSelectList.setValues(['b'])` → `getValue()` includes `'b'`.
16. **A `Shift`-range excludes a disabled row.** `MultiSelectList` over `ROWS`: `reduce(0, { ctrl:false, shift:false })` then `reduce(3, { ctrl:false, shift:true })` → `getValue()` is `['a', 'd']`, not `['a','b','c','d']`.
17. **`Ctrl+A` excludes disabled rows.** `MultiSelectList.selectAll()` over `ROWS` → `getValue()` is `['a', 'd', 'e']`.
18. **The rendered row carries the `disabled` class.** A rendered list over `ROWS`: the last `class` write for `_rowPool[1]` contains `disabled`, `SelectableListRow` and `ts-ui-component`; the write for `_rowPool[0]` contains no `disabled` token.
19. **The disabled row's cursor.** `_rowPool[1].getCursor() === 'default'`; `_rowPool[0].getCursor() === 'pointer'`.
20. **Re-enabling repaints.** `setItemEnabled(1, true)` on the rendered list → the row's latest `class` write has no `disabled` token and `_rowPool[1].getCursor() === 'pointer'`.
21. **No regressions.** `tests/component/list/`, `tests/component/default-options-fallback.test.ts` (its `SelectableListRow cursor` row expects `'pointer'`) and `tests/component/input/ComboBox.test.ts` stay green.

**Manual verification** (visual and hover behaviour the offline harness cannot exercise):

22. In a browser, a `List` with a disabled row renders that row's label dim in both shipped themes, and a `GlyphListItemRenderer` icon on the same row dims with it.
23. Hovering a disabled row shows no hover background; hovering its enabled neighbours still does. A `tooltip` set on a disabled row still opens on hover.
24. Arrow keys walk past disabled rows without stopping; the dashed focus outline never rests on one.
25. A row selected programmatically and then disabled keeps its selection background and is dim at the same time.

---

## Verification

Run from the repository root:

- `npm run typecheck` — clean.
- `npm test` — the new cases pass and the whole `tests/component/list/` suite stays green.
- `npm run lint` — clean; no new `local/no-raw-dom` or `local/require-content-bounds` baseline entries (this change adds no raw DOM access and no child placement).
- `npm run docs:api` — must finish with **zero** warnings. The new `SelectableListItem.enabled` JSDoc and the two new public methods must not `{@link}` any `private` / `protected` symbol, per `CODE_CONVENTIONS.md`.
- Grep invariants: `grep -n 'SelectableListRow:hover' packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` — zero matches. `grep -rn 'enabled !== false' packages/lib/src/typescript/lib/component/list/` — exactly two matches.
- `npm run build:lib` — required before a consuming app can see the change.

Manual pass: `npm run docs:dev`, then open the **List** and **MultiSelectList** component pages and exercise cases 22–25. Both demos are store-bound, so `enabled` cannot come from the store — add a temporary `list.setItemEnabled(2, false)` after the `store.load()` call in `packages/docs/src/demos/list-selection.ts`, verify, then revert that edit before committing.

---

## Documentation Impact

- **Export surface**: unchanged. `SelectableListItem` is already re-exported from `packages/lib/src/typescript/lib/component/list/index.ts`, so the new field and the two new methods appear in the generated API docs without a barrel edit.
- **`packages/lib/docs/components/List.md`**: new `## Disabled rows` section, a note under the keyboard table, and an extension to the theme-token sentence at [L115](packages/lib/docs/components/List.md#L115) — which already names `--ts-ui-list-row-disabled-color` — saying it now colours a disabled row as well as the empty-state placeholder.
- **`packages/lib/docs/components/MultiSelectList.md`**: a short *Disabled rows* section cross-linking `List`'s with the site-relative form the page already uses (`[List](/components/List#disabled-rows)`), plus two notes in the *Selection model* table.
- **`packages/lib/llms.txt`**: no change. It is generated from `scripts/llms/manifest.data.mjs` and carries one row per component; a per-row flag adds no capability row.
- **`packages/lib/docs/concepts/theming.md`**: no change. The `list.row.disabledColor` token and its CSS variable already exist ([Theme.ts:1149](packages/lib/src/typescript/lib/core/Theme.ts#L1149)); this plan only gives that token a second consumer.

---

## Potential Challenges

- **A custom renderer that sets its own foreground will not dim.** The `.disabled` rule reaches a renderer's children by inheritance, so a renderer whose child writes an explicit `color` overrides the inherited colour. Mitigation: say so in `List.md`'s *Disabled rows* section, and point the reader at `context.item.enabled`, which every renderer already receives through `ListItemRenderContext`.
- **The row's `#id` rule can outrank the class rule.** An id selector beats any number of chained classes, so a caller-supplied per-row colour would defeat the dim. Mitigation: nothing sets a per-row foreground today, and the dimming is the row's own class-tier concern; a consumer wanting a custom disabled colour re-themes the token.
- **Style-rule order is load-bearing.** `.SelectableListRow.disabled` must be registered after `.selected` and `.focused` or the selection colour wins the tie. Mitigation: step 3 places it last in the IIFE and the code comment records why.
- **Focus can still sit on a disabled row.** `setSelectedIndex` parks focus wherever it selects, so a programmatic write can leave the highlight on a dim row. Mitigation: the guard in `commitFocusedRow` (step 14) means Enter does nothing there, and the next arrow key moves off it.
- **`setItemEnabled` assumes a full row pool.** It indexes `_rowPool[index]` directly. Mitigation: `syncRows` keeps the pool exactly as long as `_items` — this list does not virtualise — and the optional-chained call is a no-op if it ever does not.

---

## Critical Files

Read before implementing:

- [`packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts) — the file carrying almost all of the change. In particular the style IIFE ([L188](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L188)), `SelectableListRow` ([L283](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L283)) and its `applyRowClass` ([L580](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L580)), and the keyboard block ([L1867–L2032](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1867)).
- [`packages/lib/src/typescript/lib/component/container/MenuItem.ts`](packages/lib/src/typescript/lib/component/container/MenuItem.ts) — the precedent this plan follows: the `enabled?: boolean` config field ([L71](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L71)), `isEnabled` ([L467](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L467)), `setEnabled` ([L485](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L485)) and the refusing `activate` ([L524](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L524)).
- [`packages/lib/src/typescript/lib/overlay/Menu.ts`](packages/lib/src/typescript/lib/overlay/Menu.ts) — `focusNext` / `focusPrev` ([L802](packages/lib/src/typescript/lib/overlay/Menu.ts#L802)), `isItemSkipped` ([L1094](packages/lib/src/typescript/lib/overlay/Menu.ts#L1094)), `activateFocused` ([L854](packages/lib/src/typescript/lib/overlay/Menu.ts#L854)) and `setItemEnabled` ([L561](packages/lib/src/typescript/lib/overlay/Menu.ts#L561)).
- [`packages/lib/src/typescript/lib/component/container/MenuRow.ts`](packages/lib/src/typescript/lib/component/container/MenuRow.ts) — the `isEnabled` / `isNavigable` split ([L75](packages/lib/src/typescript/lib/component/container/MenuRow.ts#L75), [L89](packages/lib/src/typescript/lib/component/container/MenuRow.ts#L89)) the divergence decision rests on.
- [`packages/lib/src/typescript/lib/component/input/PickerColumn.ts`](packages/lib/src/typescript/lib/component/input/PickerColumn.ts) — the `.PickerCell.disabled` class rule ([L59](packages/lib/src/typescript/lib/component/input/PickerColumn.ts#L59)) and `PickerCell.setDisabled` ([L232](packages/lib/src/typescript/lib/component/input/PickerColumn.ts#L232)), the nearest existing "dim one row in a scrolling list" pattern.
- [`packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts`](packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts) — the `DISABLED_OPACITY` treatment ([L15](packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts#L15), [L256](packages/lib/src/typescript/lib/component/container/AbstractBooleanMenuRow.ts#L256)) that this plan deliberately does not use.
- [`packages/lib/src/typescript/lib/component/list/MultiSelectList.ts`](packages/lib/src/typescript/lib/component/list/MultiSelectList.ts) and [`reduceModifierSelection.ts`](packages/lib/src/typescript/lib/component/shared/reduceModifierSelection.ts) — the shared modifier reducer whose contiguous index range the prune corrects.
- [`packages/lib/tests/component/list/List.test.ts`](packages/lib/tests/component/list/List.test.ts) and [`RowFrameworkClass.test.ts`](packages/lib/tests/component/list/RowFrameworkClass.test.ts) — the `TestList` white-box widening idiom and the recorded-class-write helper the new tests reuse.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Component CSS tiers and state-rule dedup* (why an id beats a chained class, and the `:not()` fix) and *Three non-negotiable rules for every DOM write*.

---

## Non-Goals

- **No store-bound `enabledField`.** `glyph` and `tooltip` each have a matching `glyphField` / `tooltipField`, but both resolve through `String(record.get(field))`, and a boolean has no single obvious spelling in a record (`false`, `0`, `"false"`, `null`). Choosing that coercion is a separate decision and no consumer needs it; `refreshFromStore` therefore leaves `enabled` unset and every store-bound row is enabled.
- **No change to the whole-list `enabled` flag.** [`applyEnabled`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L918) keeps its current behaviour — root cursor, ARIA, parked focus — and does not dim individual rows. The list-level flag and the per-row flag are separate controls.
- **No `ComboBox` / `AutoCompleteField` work.** Both build their dropdown rows from the same item type, so an `enabled: false` item in a `ComboBox` will dim and refuse inside the dropdown. Nothing about the collapsed control's display, its value round-trip, or its Enter handling is specified or tested here, and no consumer asks for it.
- **No new docs demo.** The component pages carry one demo each and a per-row flag is not a new component; the existing `list-selection` demo stays as it is.
- **No opacity-based dimming.** A `color` token change matches `MenuItem` and `PickerCell` and leaves the selection background intact; `AbstractBooleanMenuRow`'s `setOpacity(0.5)` exists because a checkbox graphic does not inherit text colour, which no built-in list renderer has.
- **No change to the requesting app.** The host asking for this is the sibling Loom app's command palette, which builds its rows through `setItemsArray` on every keystroke; switching it from filtering unavailable commands out to dimming them is its own change in its own repository.

---

## Notes

[^why-item-field]: The alternative was a parallel API on the list — `setDisabledIndices(number[])`, or a `Set<number>` field. It was rejected because every other per-row property the list already has (`label`, `glyph`, `tooltip`) lives on the item, and an index-keyed side table has to be re-based every time `setItems` reorders or replaces the array. Putting the flag on the item means the existing `setItems` / `setItemsArray` / `addItem` paths carry it for free, and a host that rebuilds its item list on every keystroke — which the requesting consumer does — never has to keep two structures in step.

[^why-tri-state]: Two other spellings were considered. `disabled?: boolean` reads slightly better at a call site but inverts the sense against `MenuItemConfig.enabled`, `MenuRow.isEnabled` and `AbstractInput.isEnabled`, which are the three places a reader of this codebase already knows. Normalising to an explicit `enabled: true` inside `setItems` was rejected because `getItems()` would then start returning a key that was never passed in, changing what several existing `toEqual` assertions see; leaving the field `undefined` keeps the item objects byte-identical to today for every caller that does not use the feature.

[^why-skip]: `Menu` can let its highlight rest on a disabled row because the highlight is purely visual there — the only commit path is `activateFocused`, which checks `isEnabled` before calling `activate`. In `AbstractSelectableList` the highlight is not free: `moveFocus` calls `reduceSelection` and `notifyUserChange` whenever `_selectFollowsFocus` is `true`, which is the default, so an arrow key that landed on a disabled row would select it and fire `change`. Suppressing the commit instead of the move was considered and rejected: it would leave `ArrowDown` visibly dead on some rows and not others, and the user would have to press it repeatedly to cross a run of disabled rows. Skipping is also what the request asks for and what a command palette needs.

[^why-indices-keep]: The other option was to treat a disabled row like a `MenuSeparator` — present in the DOM, absent from the model. That would mean either renumbering indices around it or introducing a second, "visible" index space. Both break invariants that several methods rely on: `_rowPool[i]` is parallel to `_items[i]` (`syncRows`, `refreshRowVisualState`, `updateActiveDescendant`), `store.getRecords()[i]` is parallel to `_items[i]` (`getSelectedRecord`, `MultiSelectList.setSelectedRecords`), and `scrollIndexIntoView` computes a pixel offset as `idx * ROW_HEIGHT_PX`. A disabled row is a row that is there and cannot be picked, which is exactly what a disabled `MenuItem` is.

[^why-programmatic-unfiltered]: Filtering `setValue` would mean a binding whose stored value happens to name a currently-unavailable row silently reads back as empty, and the host would have no way to tell "not in the list" from "in the list but disabled". `Menu` makes the same call: it never polices `checked` or the caller's own state against `enabled`, only activation. Keeping the refusal on the gesture paths also gives one clean statement of the rule — a disabled row is one the *user* cannot pick — and leaves the `Bindable` contract untouched.

[^why-class-rule]: Three treatments exist in the library and the choice between them turns on what has to stay visible. `AbstractBooleanMenuRow.installControl` uses `setPointerEvents("none")` plus `setOpacity(0.5)`; that was rejected here because `pointer-events: none` also kills the row's `mouseover`, and with it the per-row `Tooltip` the row attaches in `applyTooltip` — which is precisely where a host explains *why* a row is unavailable. `MenuItem` recolours its title with the disabled token but keeps hovering; a hover background on an unclickable list row is misleading, so this plan takes `MenuItem`'s colour treatment and `PickerCell`'s trick of neutralising hover in CSS — except that `PickerCell` neutralises it with `pointer-events: none` in the same rule, where this plan uses a `:not(.disabled)` guard on the hover selector instead, keeping the row's pointer events and its tooltip. `:not()` is the framework's own documented answer to a rule that must not apply in one state (see `ARCHITECTURE.md`, *Component CSS tiers and state-rule dedup*).

[^why-cursor-instance]: `cursor: pointer` reaches a row from two places — the module-level `.SelectableListRow` rule and the `_defaultSelectableListRowOptions` class default, which `Component` always-dispatches through the real `setCursor`. That dispatch writes `pointer` into the row's instance style layer, where flush-time dedup against the class tier normally removes it again; `tests/component/list/SelectableListRow.classStyleDefaults.test.ts` asserts the row's own `#id` rule ends up carrying no real `cursor` declaration. Putting `cursor: default` in the `.disabled` class rule would therefore work today, but only because of that dedup — if anything ever makes the row's `#id` rule carry a real `cursor`, the id would silently outrank the class rule. Writing the cursor per instance from `setEnabled` cannot lose that race, is one line, and is exactly what `MenuItem.setEnabled` and `PickerCell.setDisabled` both do. It also makes the behaviour readable from `getCursor()`, which `tests/component/default-options-fallback.test.ts` already checks.

[^why-setter]: The requesting consumer rebuilds its whole item array on every keystroke, so the construction-time field alone would cover it, and the project's *Simplicity First* rule argues for stopping there. The setter is included anyway because without it the only way to change a row's availability is `setItems`, and `setItemsArray` clears `_selectedSet`, resets `_anchorIndex` to `null` and `_focusedIndex` to `-1` — so a long-lived list would lose the user's selection and keyboard position every time one row became unavailable. `Menu.setItemEnabled` exists for the same reason and its doc comment says so: pushing a live availability change into a panel without rebuilding it. `isItemEnabled` is public rather than protected because it is needed internally anyway and a reader is the natural pair for the writer.

[^why-copy-on-write]: `setItemsArray` does `this._items = items.slice()`, a shallow copy, so `_items[i]` **is** the object the caller passed in — the existing `getItems` contract says so explicitly ("Element objects are shared by reference"). Writing `enabled` onto it would reach back into the caller's own data. Replacing the entry with `{ ...item, enabled }` keeps the list's copy private, costs one object per call, and makes `getItems()` report the new value straight away.

[^why-prune-local]: `reduceModifierSelection` is shared with the table body (`Body`) and is deliberately generic over the selection identity type — it knows nothing about items, let alone about an enabled flag. Teaching it a predicate would widen its signature for every caller and pull `Body` into this change. Pruning in `MultiSelectList.reduceSelection` instead is three lines in one place, and it is provably a user-gesture-only path: `reduceSelection` is reached from `handleRowClick`, `moveFocus` and `commitFocusedRow` and from nowhere else, while `setValues` writes the selection set directly. `List.reduceSelection` needs no prune — it selects exactly the one index it is given, and all three of its callers now filter that index.

[^why-dblclick-not-contextmenu]: The two events differ in what the library says they mean. `handleRowDblClick`'s own doc comment describes it as layering "an activation signal on top" of the click that already selected the row, so it must refuse wherever the click refuses. `handleRowContextMenu` is documented as deliberately *not* changing the selection, mirroring `Tree` — it opens an inspection surface rather than activating anything, and a host may well want a context menu on an unavailable row ("why is this greyed out", "install this"). It therefore keeps firing, and the host decides what to offer.

---

## Implementation Notes

**Step 4's `:not(.disabled)` guard on the hover selector was replaced with a separate override rule, because the guard as specified regresses hovering a selected row.**

The plan called for changing the hover selector from `.SelectableListRow:hover` to `.SelectableListRow:not(.disabled):hover`. `:not()` takes the specificity of its argument, so this raised the hover rule's specificity from `(0,2,0)` to `(0,3,0)` — one class higher than `.SelectableListRow.selected`'s `(0,2,0)`. Before the change, the two rules tied at `(0,2,0)` and `.selected` won ties on `background-color` purely by being declared later in the same IIFE (the file's existing tie-breaking idiom, also relied on by the `.disabled`/`.selected` combination the plan's own specificity table documents). After the change, the hover rule unconditionally outranks `.selected` by specificity regardless of declaration order, so hovering an **enabled, selected** row now paints the weaker `--ts-ui-list-row-hover-bg` over the stronger `--ts-ui-list-row-selected-bg` — a real visual regression the plan's specificity table (which enumerates only *enabled+hovered*, *disabled+hovered*, and *selected+disabled*) did not catch, because it never enumerated *selected+enabled+hovered*.

The fix keeps the hover rule at its original `.SelectableListRow:hover` (`(0,2,0)`), so its tie with `.selected` resolves by source order exactly as before, and adds a new, separate rule registered after `.disabled`:

```typescript
new StyleRule({
    scope:  "selector",
    name:   ".SelectableListRow.disabled:hover:not(.selected)",
    styles: {
        backgroundColor: "transparent",
    },
});
```

This rule's specificity (`(0,4,0)`) only matters when it actually matches, and `:not(.selected)` means it never matches a selected row — so a selected-and-disabled row's hover leaves the `.selected`/hover tie (still `(0,2,0)`/`(0,2,0)`, still resolved by source order) completely alone, and its selection background survives exactly as the plan's *selected and disabled* row of the specificity table requires. For a disabled, non-selected row, the new rule does match and overrides the hover rule's `background-color` back to `transparent` — the row's own un-hovered default, since neither `SelectableListRow` nor its class defaults set a resting `background-color`.

Verified in a browser (`npm run docs:dev`, the same temporary `list.setItemEnabled(2, false)` edit to `packages/docs/src/demos/list-selection.ts` the plan's Verification section describes, reverted after) across all four combinations: enabled+hover (hover tint, unchanged), enabled+selected+hover (selection wash, the fixed case), disabled+hover (no wash), and disabled+selected+hover (selection wash retained). The plan's step-4 checkpoint (`grep -n 'SelectableListRow:hover'` expecting zero matches) no longer holds, since the plain selector was restored; the checkpoint was written for the specific (buggy) selector text the plan specified, and the intent it was checking — that hover is suppressed on a disabled row — is instead covered by the new rule and the manual verification above.
