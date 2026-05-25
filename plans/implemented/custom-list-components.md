# Custom `List` and `MultiSelectList` — Implementation Plan

## Overview

[`List`](../src/typescript/lib/component/list/List.ts) and [`MultiSelectList`](../src/typescript/lib/component/list/MultiSelectList.ts) currently wrap a native `<select size=N>` (and `<select multiple>`) element. The browser owns the row chrome, the focus ring, the selection highlight, the keyboard navigation, and the scrollbar — none of which respect the framework's theme tokens, and none of which match the rest of the custom-styled UI. This plan converts both components to fully custom Components built out of a scrolling row container, mirroring the row/pool/keyboard model already proven inside [`ComboBoxDropdown`](../src/typescript/lib/component/input/ComboBox.ts#L104) and [`Table.Body`](../src/typescript/lib/component/table/Body.ts#L49).

The conversion keeps the existing call sites in [`SplitPanel.ts:34`](../src/typescript/SplitPanel.ts#L34), [`LayoutTestPanel.ts:29`](../src/typescript/LayoutTestPanel.ts#L29), [`AccordionDemoPanel.ts:135`](../src/typescript/AccordionDemoPanel.ts#L135), [`BorderPanel.ts:19`](../src/typescript/BorderPanel.ts#L19), and [`MultiSelectListPanel.ts:26-110`](../src/typescript/MultiSelectListPanel.ts#L26) working unmodified — the public surface (`addItem`, `setItems`, `setStore`, `getValue`/`setValue`, `getValues`/`setValues`, `addActionListener`, `getSelectedRecord(s)`) survives intact. The component changes underneath: native `<select>` → `<div role="listbox">` populated with `<div role="option">` rows; native `selectedIndex` mutation → an internal selection model; native scrollbar → the framework's `auto`-overflow path or the existing `VirtualScroller` (decision below).

Touched files: [`src/typescript/lib/component/list/List.ts`](../src/typescript/lib/component/list/List.ts), [`src/typescript/lib/component/list/MultiSelectList.ts`](../src/typescript/lib/component/list/MultiSelectList.ts), [`src/typescript/lib/component/list/index.ts`](../src/typescript/lib/component/list/index.ts), [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts), and the docs entries under [`docs/components/`](../docs/components/).

---

## Architecture Decisions

### Single base class `AbstractCustomList<TValue>` — `List` and `MultiSelectList` differ only by selection-model arity

Both components share 90% of the surface (items, store binding, rows, scroll container, keyboard navigation, ARIA wiring). They differ in two things: (a) selection state is a single index vs a set of indices, and (b) the click/keyboard reducers respect modifier keys differently. Extract the row pool, store binding, items array, and keyboard plumbing into an abstract base `AbstractCustomList<TValue>` parameterised over the value type (`string` for single-select, `string[]` for multi-select). `List` extends it with `TValue = string` and a single-selection reducer; `MultiSelectList` extends it with `TValue = string[]` and the modifier-aware reducer that already lives at [`Body.ts:572-605`](../src/typescript/lib/component/table/Body.ts#L572) — that algorithm is exactly what callers expect (plain click replaces, Ctrl/Cmd toggles, Shift-click ranges from anchor).

This matches today's inheritance shape (`MultiSelectList extends List`) but moves the shared mechanics one level down so the base contains no `string`-specific assumptions.

### Reuse `ComboBoxRow` patterns; do **not** reuse `ComboBoxRow` itself

`ComboBoxRow` at [`ComboBox.ts:434`](../src/typescript/lib/component/input/ComboBox.ts#L434) is private to `ComboBox.ts` and owns its `_onSelect(index)` callback as a constructor argument, with no concept of a per-row selected/hover/focus state — the dropdown closes on the first click. A list row needs three persistent visual states (hover, selected, focused) and lives long enough to receive theme changes. Build a new sibling component `CustomListRow` next to the existing list files, parallel in shape to `ComboBoxRow` but with `setSelected(boolean)` / `setFocused(boolean)` setters that drive `.CustomListRow.selected` / `.CustomListRow.focused` CSS class rules. Static styling goes through `StyleRule` exactly like [`ComboBoxRow` at `ComboBox.ts:316-336`](../src/typescript/lib/component/input/ComboBox.ts#L316).

### Selection model: shared `Set<number>` storage; `List` constrains size to ≤ 1

Use a single `Set<number>` of selected row indices in the base class, plus an `_anchorIndex: number | null`. `List`'s reducer clears the set before adding the clicked index (size ≤ 1 invariant); `MultiSelectList`'s reducer ports the modifier logic from `Body.onRowClick`. Reading `selectedIndex` becomes `firstOrNeg1(set)`; reading `selectedIndices` becomes `[...set].sort()`. This avoids two parallel data structures while keeping the existing single-select API exact.

### Keyboard model mirrors `Table.Body.onKeyDown`

[`Body.ts:844-927`](../src/typescript/lib/component/table/Body.ts#L844) already implements ArrowUp/ArrowDown/Home/End/PageUp/PageDown the right way — clamp to records, derive page size from `getHeight() / rowHeight`. Port that to the new base class. Add Shift-modifier handling for `MultiSelectList` (extends selection from anchor to the new focus), and Ctrl/Cmd+Space to toggle the focused row without moving focus. Enter / Space on `List` selects the focused row. Type-ahead search (typing a letter jumps to the first row whose label starts with that letter) — the native `<select>` had it; preserve the behaviour with a simple 700 ms-debounced buffer and a linear scan.

### Virtualization: **NO for v1, reserve the hook**

Native `<select size=N>` rendered every option but the browser only painted what was visible — there was never a virtualization layer here. The current consumer pattern is short lists (5-30 items: see all five call sites). The performance bar the project measures against is the slow [`MiscPanel` table](file:///home/jika/.claude/projects/-home-jika-typescript-typescript/memory/project_perf_benchmark.md), which already uses `Table.Body` + `VirtualScroller` and is the right tool for thousands of rows. Building a virtual `List` would duplicate `VirtualScroller` plumbing for no demonstrated workload — the project's own [virtualized-list recipe](../docs/recipes/virtualized-list.md) explicitly steers users to `Table`/`Tree` for that case.

Implement v1 with a flat row stack inside an `autoScroll: "y"` `Panel` (exactly the [`ComboBoxDropdown._list`](../src/typescript/lib/component/input/ComboBox.ts#L137) pattern). Keep the row pool reconciliation (`syncRows` from [`ComboBox.ts:207`](../src/typescript/lib/component/input/ComboBox.ts#L207)) so re-binding a 50-element store doesn't churn DOM. If a future caller surfaces a thousand-row list, swap the inner `Panel` for a `VirtualScroller`-backed body without changing the public surface — the row pool already exists, and `scrollIndexIntoView` is the only new method needed.

### Breaking change: `List` no longer extends `Component<TOptions>` as a leaf — it extends `AbstractCustomList`

External code that does `instanceof List` keeps working (the class still exists, the callable export shape is preserved). Code that does `instanceof Component` keeps working. The narrow case that breaks: a caller relying on `list.getElement()` returning an `HTMLSelectElement` (today's signature at [`List.ts:124`](../src/typescript/lib/component/list/List.ts#L124)). The new root is `HTMLDivElement`. Audit shows zero in-tree consumers of that specific cast — the demos call only the public Bindable surface — but the change must be called out in the changelog.

A second breaking change: the `Option` class (today's row component, [`Option.ts:25`](../src/typescript/lib/component/input/Option.ts#L25)) is no longer used inside `List` / `MultiSelectList`. `getItems()` previously returned `Array<Option>`. Change the return type to `Array<{ key: string, label: string }>` — same shape `ComboBox` already returns. The `Option` class itself stays (still consumed by external integrations and `<select>`-anywhere usage) but loses its only in-tree caller. This is consistent with the comment at [`ComboBox.ts:14-18`](../src/typescript/lib/component/input/ComboBox.ts#L14) about Option being deliberately retired from the ComboBox dropdown for the same reason.

### `addBindingListener` semantics: fire on user gestures only, not programmatic `setValue`

Today's `List.addBindingListener(fn)` aliases `addActionListener`, which is wired to the native `change` event — the browser only fires `change` on user input, so this is "user-driven" by accident of `<select>` semantics. The custom version must preserve that. Fire `change` (and run binding listeners) exclusively from the click/keyboard reducers; `setValue` / `setValues` / `setSelectedIndex(idx, false)` do not fire it. `setSelectedIndex(idx, true)` does fire it (matching the existing `fireEvent` parameter at [`List.ts:204`](../src/typescript/lib/component/list/List.ts#L204)).

### Focus model: container is the focusable element, rows are not

`<select>` was naturally focusable; the new `<div role="listbox">` needs `tabindex=0` on the root. Rows carry `role="option"` and `aria-selected`, with the active descendant set via `aria-activedescendant`. This is what `Body` already does (see [`Body.ts:76`](../src/typescript/lib/component/table/Body.ts#L76)) and what the WAI-ARIA listbox pattern specifies. No row receives the actual DOM focus — that prevents focus loss when the list re-renders after a store refresh.

---

## Public API (TypeScript Signatures)

### `AbstractCustomList<TValue>` (new base)

```typescript
export interface AbstractCustomListOptions extends AbstractInputOptions {
    items?:         String | Array<String>;
    store?:         AbstractStore;
    displayField?:  string;
    valueField?:    string;
}

abstract class AbstractCustomList<
    TValue,
    TOptions extends AbstractCustomListOptions = AbstractCustomListOptions
> extends AbstractInput<TValue, TOptions> {

    protected _items:        Array<{ key: string, label: string }> = [];
    protected _rowPool:      CustomListRow[]                       = [];
    protected _innerPanel:   Panel;
    protected _selectedSet:  Set<number>                           = new Set();
    protected _anchorIndex:  number | null                         = null;
    protected _focusedIndex: number                                = -1;
    protected _typeAheadBuf: string                                = "";
    protected _typeAheadAt:  number                                = 0;
    private _storeRefresh:   (() => void) | null                   = null;

    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>);

    // Item / store management
    getItems():  Array<{ key: string, label: string }>;
    setItems(items: String | Array<String>): this;
    addItem(item: String): this;
    setStore(store: AbstractStore, displayField: string, valueField?: string): this;
    getStore(): AbstractStore | null;

    // Selection — single-index helpers shared by both subclasses
    getSelectedIndex(): number;
    setSelectedIndex(idx: number, fireEvent?: boolean): this;
    getSelectedRecord(): ModelRecord | undefined;

    // Listeners
    addActionListener(listener: Function): this;

    // Render hooks
    protected refreshFromStore(): void;
    protected abstract reduceSelection(idx: number, ev: { ctrl: boolean, shift: boolean }): void;

    // ARIA / keyboard
    protected onKeyDown(e: KeyboardEvent): void;
    protected onRowClick(idx: number, e: MouseEvent): void;
    protected scrollIndexIntoView(idx: number): void;
}
```

### `List` (revised)

```typescript
export interface ListOptions extends AbstractCustomListOptions {
    selectedIndex?: number;
    value?:         string;
    selectedItem?:  string;
}

class List<TOptions extends ListOptions = ListOptions>
    extends AbstractCustomList<string, TOptions>
    implements Bindable<string>
{
    constructor(options?: TOptions);

    setValue(value: string): this;
    getValue(): string;
    getSelectedItem(): string | null;

    protected reduceSelection(idx: number, ev: { ctrl: boolean, shift: boolean }): void;
    protected applyEnabled(value: boolean): void;
    protected applyReadOnly(value: boolean): void;
}
```

### `MultiSelectList` (revised)

```typescript
export interface MultiSelectListOptions extends ListOptions {
    selectedIndices?: number[];
}

class MultiSelectList
    extends AbstractCustomList<string[], MultiSelectListOptions>
    implements Bindable<string[]>
{
    constructor(options?: MultiSelectListOptions);

    setValue(value: string[]): this;        // aliases setValues; satisfies Bindable<string[]>
    getValue(): string[];
    setValues(values: string[]): this;
    getValues(): string[];
    getSelectedRecords(): ModelRecord[];
    setSelectedRecords(records: ModelRecord[]): this;

    protected reduceSelection(idx: number, ev: { ctrl: boolean, shift: boolean }): void;
}
```

`MultiSelectList` now implements `Bindable<string[]>` directly — today's docs (`docs/components/MultiSelectList.md` lines 33-42) tell consumers to wire it via explicit `BindingAccessors` because `Bindable<string>` doesn't fit a multi-value control. With the base class parameterised over `TValue`, `Bindable<string[]>` becomes the natural shape and the explicit-accessor workaround in the docs goes away.

### `CustomListRow` (new internal)

```typescript
class CustomListRow extends Component {
    private _text:     string  = "";
    private _index:    number;
    private _selected: boolean = false;
    private _focused:  boolean = false;
    private readonly _onClick: (idx: number, e: MouseEvent) => void;

    constructor(onClick: (idx: number, e: MouseEvent) => void, index: number);
    setLabel(text: string): this;
    setIndex(index: number): this;
    setSelected(value: boolean): this;
    setFocused(value: boolean): this;
}
```

The setters write `.selected` / `.focused` class names directly via `setElementAttribute("class", ...)` (matching how [`Body` updates row visual state via `updateRowVisualState`](../src/typescript/lib/component/table/Body.ts#L607)), keeping the styling in the CSS rules registered at module init.

---

## Theme Tokens

Add a `list` block to the `Theme` interface, both theme instances, and `themeToVars`. Tokens mirror the `autoComplete.item` / `table.row` shape that already exists.

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-list-bg` | `rgb(255, 255, 255)` | `rgb(40, 40, 40)` | List container background |
| `--ts-ui-list-border` | `rgb(200, 200, 200)` | `rgb(80, 80, 80)` | List container border |
| `--ts-ui-list-row-hover-bg` | `rgba(30, 100, 200, 0.08)` | `rgba(100, 140, 220, 0.12)` | Row hover background |
| `--ts-ui-list-row-selected-bg` | `rgba(30, 100, 200, 0.18)` | `rgba(100, 140, 220, 0.28)` | Selected-row background |
| `--ts-ui-list-row-selected-color` | `inherit` | `rgb(220, 220, 255)` | Selected-row foreground |
| `--ts-ui-list-row-focus-ring` | `rgb(30, 100, 200)` | `rgb(120, 170, 240)` | Focused-row outline colour |
| `--ts-ui-list-row-disabled-color` | `rgb(170, 170, 170)` | `rgb(100, 100, 100)` | Disabled-row text colour |
| `--ts-ui-list-row-separator` | `transparent` | `transparent` | Optional between-row hairline (off by default; theme can opt in) |

The defaults reuse `autoComplete` values numerically because both surfaces are popovers of selectable rows — keeping them in lockstep means a custom theme that overrides one automatically gets the other matching. The separator token defaults to `transparent` so the visual is identical to today's native `<select>` (no row borders); a theme can override it to a `1px solid rgba(...)` for a denser look without code changes.

The `Theme` interface gains:

```typescript
list: {
    background:  string;
    border:      string;
    row: {
        hoverBackground:    string;
        selectedBackground: string;
        selectedColor:      string;
        focusRing:          string;
        disabledColor:      string;
        separator:          string;
    };
};
```

Add corresponding entries to `DefaultTheme`, `DarkTheme`, and `themeToVars` in [`Theme.ts`](../src/typescript/lib/core/Theme.ts).

---

## Internal Structure

### DOM tree

```
<div role="listbox" tabindex="0" class="List" aria-activedescendant="ListRow-{focusedIdx}">
  <div class="Panel" autoScroll="y">           ← _innerPanel; framework-positioned, VBox child layout
    <div role="option" id="ListRow-0"  class="CustomListRow"          aria-selected="true">Apple</div>
    <div role="option" id="ListRow-1"  class="CustomListRow focused"  aria-selected="false">Banana</div>
    <div role="option" id="ListRow-2"  class="CustomListRow selected" aria-selected="true">Cherry</div>
    …
  </div>
</div>
```

The outer `<div>` carries the framework-level border, background, focus ring (theme token), and `role="listbox"`. The inner `Panel` is just the scroll container — same trick as `ComboBoxDropdown._list` ([ComboBox.ts:137](../src/typescript/lib/component/input/ComboBox.ts#L137)) — and its `VBox(spacing: 0, stretching: true)` lays the rows out vertically, full-width.

For `MultiSelectList`, the outer element adds `aria-multiselectable="true"`. Each row sets `aria-selected` per its membership in `_selectedSet`.

### Static styling

Register at module init in `AbstractCustomList.ts` using `StyleRule`:

```typescript
(() => {
    const surface = new StyleRule({ scope: "class", name: "AbstractCustomList" });
    surface.setMany({ userSelect: "none", outline: "none" });
    surface.ensure();

    const surfaceFocus = new StyleRule({ scope: "selector", name: ".AbstractCustomList:focus" });
    surfaceFocus.set("boxShadow", "0 0 0 2px var(--ts-ui-list-row-focus-ring, rgb(30, 100, 200))");
    surfaceFocus.ensure();

    const row = new StyleRule({ scope: "class", name: "CustomListRow" });
    row.setMany({
        lineHeight:   "22px",
        whiteSpace:   "nowrap",
        overflow:     "hidden",
        textOverflow: "ellipsis",
        borderBottom: "1px solid var(--ts-ui-list-row-separator, transparent)",
        cursor:       "default",
    });
    row.ensure();

    new StyleRule({ scope: "selector", name: ".CustomListRow:hover" })
        .set("backgroundColor",
             "var(--ts-ui-list-row-hover-bg, rgba(30, 100, 200, 0.08))")
        .ensure();

    new StyleRule({ scope: "selector", name: ".CustomListRow.selected" })
        .setMany({
            backgroundColor: "var(--ts-ui-list-row-selected-bg, rgba(30, 100, 200, 0.18))",
            color:           "var(--ts-ui-list-row-selected-color, inherit)",
        })
        .ensure();

    new StyleRule({ scope: "selector", name: ".CustomListRow.focused" })
        .set("outline", "1px dashed var(--ts-ui-list-row-focus-ring, rgb(30, 100, 200))")
        .ensure();
})();
```

The selected + focused row stacks both classes — the dashed focus outline sits on top of the solid selection wash. This matches Table's two-axis "selected" + "focused cell" visualisation.

### Row pool reconciliation

Copy the pattern verbatim from [`ComboBoxDropdown.syncRows`](../src/typescript/lib/component/input/ComboBox.ts#L207):

```typescript
protected syncRows(): void {
    const newLen  = this._items.length;
    const oldLen  = this._rowPool.length;
    const overlap = Math.min(newLen, oldLen);

    for (let i = 0; i < overlap; i++) {
        const row = this._rowPool[i];
        row.setLabel(this._items[i].label);
        row.setIndex(i);
        row.setSelected(this._selectedSet.has(i));
        row.setFocused(i === this._focusedIndex);
    }

    if (newLen > oldLen) {
        for (let i = oldLen; i < newLen; i++) {
            const row = new CustomListRow((idx, e) => this.onRowClick(idx, e), i);
            row.setLabel(this._items[i].label);
            row.setSelected(this._selectedSet.has(i));
            row.setFocused(i === this._focusedIndex);
            this._innerPanel.addComponent(row);
            this._rowPool.push(row);
        }
    } else if (newLen < oldLen) {
        for (let i = newLen; i < oldLen; i++) {
            this._innerPanel.removeComponent(this._rowPool[i]);
        }
        this._rowPool.splice(newLen);
    }
}
```

### `reduceSelection` — the only meaningful subclass difference

```typescript
// List
protected reduceSelection(idx: number, _ev: { ctrl: boolean, shift: boolean }): void {
    this._selectedSet.clear();
    this._selectedSet.add(idx);
    this._anchorIndex  = idx;
    this._focusedIndex = idx;
}

// MultiSelectList — ported from Body.onRowClick (Body.ts:572-605)
protected reduceSelection(idx: number, ev: { ctrl: boolean, shift: boolean }): void {
    if (ev.shift && this._anchorIndex !== null) {
        const lo = Math.min(this._anchorIndex, idx);
        const hi = Math.max(this._anchorIndex, idx);
        if (!ev.ctrl) this._selectedSet.clear();
        for (let i = lo; i <= hi; i++) this._selectedSet.add(i);
    } else if (ev.ctrl) {
        if (this._selectedSet.has(idx)) this._selectedSet.delete(idx);
        else                            this._selectedSet.add(idx);
        this._anchorIndex = idx;
    } else {
        this._selectedSet.clear();
        this._selectedSet.add(idx);
        this._anchorIndex = idx;
    }
    this._focusedIndex = idx;
}
```

### Keyboard map

| Key | Behaviour |
|---|---|
| `ArrowDown` | `_focusedIndex++` (clamped). `List`: also selects. `MultiSelectList`: selects unless `shift`, then extends from anchor; `ctrl` moves focus without selecting |
| `ArrowUp` | symmetric |
| `Home` / `End` | focus first / last; selection rule follows arrow rules |
| `PageDown` / `PageUp` | focus ± `floor(getHeight() / rowHeight)`; rule as above |
| `Enter` / `Space` | `List`: re-selects focused row (fires `change`). `MultiSelectList`: with `ctrl`, toggles focused row; without modifiers, replaces selection with `{focusedIndex}` |
| `Ctrl+A` (MultiSelectList only) | select all |
| printable char | append to type-ahead buffer (debounced 700 ms); jump focus to first row whose label, lowercased, starts with buffer |
| `Escape` | clear type-ahead buffer |

Always `e.preventDefault()` on a handled key — same as `Body.onKeyDown` at [Body.ts:860](../src/typescript/lib/component/table/Body.ts#L860).

---

## Ordered Implementation Steps

### Step 1 — Add theme tokens to `Theme.ts`

Extend the `Theme` interface with the `list` block, write entries into `DefaultTheme` and `DarkTheme`, and add the eight `--ts-ui-list-*` keys to `themeToVars`. Zero runtime risk (no existing token names collide; verified via `grep '\-\-ts-ui-list' src/ docs/` — only the lone `list:hover` mention in [Theme.ts:140](../src/typescript/lib/core/Theme.ts) is unrelated `header.padding`).

### Step 2 — Add `CustomListRow` and `AbstractCustomList` (new file)

File: `src/typescript/lib/component/list/AbstractCustomList.ts`.

- Static `StyleRule` block at module top (rows + container).
- `CustomListRow` class (small, follows `ComboBoxRow` shape; ID prefix `"ListRow-"` so `aria-activedescendant` is stable).
- `AbstractCustomList<TValue, TOptions>` extends `AbstractInput<TValue, TOptions>`. Body builds the inner `Panel`, attaches `keydown`, sets the listbox role + tabindex, wires `setStore` via the existing pattern (copy from `ComboBox.setStore` at [ComboBox.ts:998](../src/typescript/lib/component/input/ComboBox.ts#L998)).
- Re-implements `refreshFromStore`, `setItems`, `addItem`, `getItems`, `setStore`, `getStore`, `getSelectedIndex`, `setSelectedIndex`, `getSelectedRecord` from the current `List.ts`, but writing into the rowPool / selectedSet model instead of `<select>.options`.
- Implements `addActionListener` (wires the `"change"` event the same way today does) and overrides `addBindingListener` to forward.
- Abstract `reduceSelection` for subclasses.

Do **not** export `AbstractCustomList` from the per-subpath barrel — it's internal infrastructure (same treatment `ComboBoxDropdown` gets at [ComboBox.ts:1164-1168](../src/typescript/lib/component/input/ComboBox.ts#L1164)).

### Step 3 — Rewrite `List.ts` against `AbstractCustomList`

Replace today's `class List extends Component<TOptions> implements Bindable<string>` with `class List extends AbstractCustomList<string, TOptions> implements Bindable<string>`. Body shrinks to:

- `reduceSelection` (single-select branch above).
- `setValue` / `getValue` / `getSelectedItem` (read/write `_selectedSet` + `_items`).
- `applyEnabled` / `applyReadOnly` (`AbstractInput` requires them — write to `_innerPanel`, toggle ARIA `disabled` / `readonly`, gate the click/keydown reducers).
- Default options bag (`tag: "div"`, theme-token background/border, `preferredSize(200, 200)`).
- `applyOptions` cascade pure-routing `selectedIndex` / `value` / `selectedItem` via the same construct-tail dispatch pattern as `ComboBox` ([ComboBox.ts:583-610](../src/typescript/lib/component/input/ComboBox.ts#L583)).

Remove `getElement(): HTMLSelectElement` (the cast is now wrong — let it inherit the `HTMLElement` signature from `Component`).

### Step 4 — Rewrite `MultiSelectList.ts` against `AbstractCustomList`

- `class MultiSelectList extends AbstractCustomList<string[], MultiSelectListOptions> implements Bindable<string[]>`.
- `reduceSelection` (multi-select branch above).
- `setValues` / `getValues` / `setValue` (alias of `setValues`) / `getValue` (alias of `getValues`).
- `getSelectedRecords` / `setSelectedRecords` — keep the existing algorithm (parallel iteration over `getItems()` and `store.getRecords()` — see today's [MultiSelectList.ts:111-131](../src/typescript/lib/component/list/MultiSelectList.ts#L111)).
- Sets `aria-multiselectable="true"` on the root in the constructor.
- Construct-tail dispatch of `selectedIndices` via the populated rowPool, exactly like today's [MultiSelectList.ts:33-42](../src/typescript/lib/component/list/MultiSelectList.ts#L33).

### Step 5 — Verify barrel + callable shape

`src/typescript/lib/component/list/index.ts` already re-exports `List`, `MultiSelectList`, `ListOptions`, `MultiSelectListOptions` (lines 3-6). Confirm no churn needed. The `callable(List)` / `callable(MultiSelectList)` wrappers stay — the callable contract is independent of the parent class.

### Step 6 — Update demo panels (no API breakage; verify visually)

Walk every call site:
- [SplitPanel.ts:34](../src/typescript/SplitPanel.ts#L34), [LayoutTestPanel.ts:29](../src/typescript/LayoutTestPanel.ts#L29), [AccordionDemoPanel.ts:135](../src/typescript/AccordionDemoPanel.ts#L135), [BorderPanel.ts:19](../src/typescript/BorderPanel.ts#L19), [MultiSelectListPanel.ts:26+77+110](../src/typescript/MultiSelectListPanel.ts#L26).
- All use only `addItem` / `setItems` / `setValues` / `getValues` / `addActionListener` / `setStore` / `getSelectedRecords` — every one survives the conversion. No source edits needed; only a manual smoke pass per panel.

Regression checkpoint: `grep -rn 'new Option' src/typescript/lib/component/list/` — expect zero matches (the `Option` import inside the new `List`/`MultiSelectList` is gone).

### Step 7 — Update docs

Per `docs-conventions.md`:
- Rewrite [`docs/components/List.md`](../docs/components/List.md) — drop the "extends ComboBox… backed by a `<select>`" framing; describe the new custom shape; example stays unchanged.
- Rewrite [`docs/components/MultiSelectList.md`](../docs/components/MultiSelectList.md) — drop the "does not implement Bindable directly" section (no longer true); replace the explicit-accessors example with a plain `binding.bind("tags", tagsList)` example.
- No catalog edits — [`docs/components/index.md`](../docs/components/index.md) lines 76-80 already list both classes correctly.
- No sidebar edits — [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts) lines 103-108 already wire `/components/List` and `/components/MultiSelectList`.

### Step 8 — Build + verify

`npm run docs:build` → 0 errors, 0 link warnings. `npm run dev` (port 8015) → walk each of the five demo panels, run through the keyboard verifications below.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/list/AbstractCustomList.ts` |
| Modify | `src/typescript/lib/component/list/List.ts` |
| Modify | `src/typescript/lib/component/list/MultiSelectList.ts` |
| Modify | `src/typescript/lib/core/Theme.ts` |
| Modify | `docs/components/List.md` |
| Modify | `docs/components/MultiSelectList.md` |

No deletions. `Option.ts` stays (still publicly exported, still useful for direct `<select>` usage outside the framework's `List`).

---

## Verification

### Type / build

- `npx tsc --noEmit` — no new errors.
- `grep -rn 'getElement(.*).*HTMLSelectElement' src/typescript/lib/component/list/` — expect zero (the old cast is gone).
- `grep -rn 'new Option(' src/typescript/lib/component/list/` — expect zero (rowPool no longer constructs `Option`).
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).

### Visual smoke (`npm run dev`, http://localhost:8015)

1. **SplitPanel** — list of 13 items in the south split. Theme-toggle between Default / Dark; row hover, selected row, focus ring follow the theme.
2. **LayoutTestPanel** — list below a ComboBox; visual baseline of "I am a label!" still aligns with the ComboBox text inside the same HBox column (the `getBaseline(): null` from [List.ts:114](../src/typescript/lib/component/list/List.ts#L114) is preserved in the new class).
3. **AccordionDemoPanel** — file list inside the second accordion section; scrollbar is the framework's custom one, not the native browser scrollbar.
4. **BorderPanel** — list in WEST region; flexes correctly when the window resizes.
5. **MultiSelectListPanel** — static section, store-backed section, binding section all still work. Plain click replaces selection; Ctrl-click toggles individual rows; Shift-click ranges from anchor; "Select All" / "Clear" buttons still drive `setValues`; the `Binding` "modified" / "clean" status text still ticks on selection change.

### Keyboard

For both components, with focus on the list root:
- Arrow Up / Down move the focus highlight and (in `List`) the selection.
- Home / End jump to first / last; PageUp / PageDown jump by visible-rows.
- Type "ap" within 700 ms — focus jumps to "Apple"; pause 1 s, type "b" — focus jumps to "Banana".
- In `MultiSelectList`: Shift+ArrowDown extends; Ctrl+Space toggles the focused row without moving focus.
- Tab order: list root is focusable; rows are not — pressing Tab leaves the list, doesn't iterate rows.

### Accessibility

Inspect with the browser DevTools accessibility tree:
- Root element shows `role="listbox"`, `tabindex="0"`, and for `MultiSelectList`, `aria-multiselectable="true"`.
- Rows show `role="option"`, `aria-selected` matching the selection state.
- `aria-activedescendant` on the root points to the focused row's ID.

---

## Documentation Impact

Public API:
- `List`, `MultiSelectList`, `ListOptions`, `MultiSelectListOptions` continue to be exported from `~/component/list/index.ts` (lines 3-6 of [`src/typescript/lib/component/list/index.ts`](../src/typescript/lib/component/list/index.ts)). No barrel change needed.
- `AbstractCustomList` and `CustomListRow` are **internal** — do not re-export. Same treatment as `ComboBoxDropdown` / `ComboBoxRow` (kept private inside `ComboBox.ts`).
- `MultiSelectList` now implements `Bindable<string[]>` directly. Cross-bucket JSDoc reference uses [`Bindable`](/api/core/interfaces/Bindable) markdown form (per `docs-conventions.md` table — different bucket from `component/list`).

Curated pages:
- Rewrite [`docs/components/List.md`](../docs/components/List.md) — replace "backed by a `<select>` element" framing; add a short note on the new theme tokens.
- Rewrite [`docs/components/MultiSelectList.md`](../docs/components/MultiSelectList.md) — drop the "does not implement Bindable directly" workaround; the new direct-Bindable example replaces the `BindingAccessors` snippet.
- No edits to [`docs/components/index.md`](../docs/components/index.md) lines 76-80 (catalog rows still accurate).
- No edits to the sidebar in [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts) lines 103-108 (links unchanged).
- No edits to [`docs/recipes/virtualized-list.md`](../docs/recipes/virtualized-list.md) — the recipe still correctly steers users to `Table`/`Tree` for thousands of rows.

Run `grep -rln '<select\b' docs/` after the rewrite — expect zero matches in `docs/components/List.md` or `docs/components/MultiSelectList.md`.

---

## Potential Challenges

- **Late-built state dispatch.** `selectedIndex`, `value`, `selectedItem`, `selectedIndices` are written pure into `_options` by `applyOptions` (super-time) and must dispatch from the constructor body *after* `_innerPanel` and `_rowPool` exist. Follow the exact dispatch order at [ComboBox.ts:583-610](../src/typescript/lib/component/input/ComboBox.ts#L583); the [class-field super-cascade trap](file:///home/jika/.claude/projects/-home-jika-typescript-typescript/memory/feedback_class_field_super_trap.md) is the relevant trap.
- **`getBaseline(): null` must survive.** Today's [List.ts:114](../src/typescript/lib/component/list/List.ts#L114) returns `null` so the list is treated as a replaced element by `HBox` (per the implemented baseline-alignment plan). Preserve the override on `AbstractCustomList` — multi-line surface, no inherent text baseline.
- **`Panel`-as-scroll-container size discipline.** `_innerPanel` is laid out by the framework, but its rows are positioned by VBox. When the list root is resized (e.g. `BorderPanel`'s WEST region), the panel must re-flow. `Panel + VBox + autoScroll: "y"` already handles this in `ComboBoxDropdown`; the same `pauseLayout()` / `syncRows()` / `resumeLayout()` discipline ([ComboBox.ts:155-157](../src/typescript/lib/component/input/ComboBox.ts#L155)) applies on every `setItems` / `refreshFromStore`.
- **Type-ahead during fast typing.** Reset the buffer if the keypress arrives more than 700 ms after the previous one — without that, "ap" → "apb" rapidly typed would land nowhere.
- **Focus restoration after store refresh.** When the store reloads (records arrive late), `refreshFromStore` rebuilds `_items`. Preserve the previously selected key by re-locating it in the new `_items`; if it's gone, clear the selection but keep the focus on row 0 (matching native `<select>` behaviour). Mirror the logic at [ComboBox.ts:1073-1080](../src/typescript/lib/component/input/ComboBox.ts#L1073).

---

## Critical Files

- [src/typescript/lib/component/list/List.ts](../src/typescript/lib/component/list/List.ts) — current implementation (to be rewritten).
- [src/typescript/lib/component/list/MultiSelectList.ts](../src/typescript/lib/component/list/MultiSelectList.ts) — current implementation (to be rewritten).
- [src/typescript/lib/component/input/ComboBox.ts](../src/typescript/lib/component/input/ComboBox.ts) — closest analogue; the dropdown's `ComboBoxRow` pool, `syncRows`, theme-token defaults, late-state dispatch, store binding, and keyboard handling are all the templates to follow.
- [src/typescript/lib/component/input/AbstractInput.ts](../src/typescript/lib/component/input/AbstractInput.ts) — new base for both classes; owns the `Bindable<T>` contract.
- [src/typescript/lib/component/table/Body.ts](../src/typescript/lib/component/table/Body.ts) — `onRowClick` (572-605), `onKeyDown` (844-927), and `_selectedRecords` / `_anchorRecord` model are the keyboard + multi-selection templates.
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — add `list` block to interface, both theme instances, and `themeToVars`.
- [src/typescript/lib/core/StyleTarget.ts](../src/typescript/lib/core/StyleTarget.ts) — `StyleRule` is the registration surface for the new `.CustomListRow` rules.
- [src/typescript/lib/component/container/VirtualScroller.ts](../src/typescript/lib/component/container/VirtualScroller.ts) — read-only reference. Reserved for a future virtualization swap; not used in v1.

---

## Non-Goals

- **No virtualization in v1.** Decision rationale in `## Architecture Decisions`. `Table` and `Tree` cover the large-dataset case.
- **No drag-and-drop reorder.** Out of scope; would belong in a separate plan that consumes the existing `DragManager`.
- **No multi-column / icon-bearing rows.** The native `<select>` supported only single-line text labels — preserve that surface. A richer "item template" is a future feature, not a conversion-blocker.
- **No checkbox-style multi-select toggles.** `MultiSelectList` stays modifier-key-driven, matching today's behaviour and the WAI-ARIA listbox pattern. A checkbox variant would be a sibling component, not this one.
- **No `Option` class removal.** It remains exported from `~/component/input/`; only its in-tree consumption inside `List` / `MultiSelectList` goes away.
- **No changes to `BulletedList` / `NumberedList`.** Those are pure-presentation `<ul>` / `<ol>` containers built around `AbstractListComponent`; they share no implementation with the selectable list components and are out of scope.
