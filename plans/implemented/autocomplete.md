# AutoComplete Field — Implementation Plan

## Overview

An `AutoCompleteField` is a typeahead/autocomplete text input. Three new component classes and modifications to two existing framework files. The design uses composition: `AutoCompleteField` wraps an internal `TextField` rather than extending it, and uses a custom `AutoCompleteDropdown` rather than reusing `ContextMenu`.

---

## Architecture Decisions

### Composition, Not Inheritance

`AutoCompleteField extends Component implements Bindable<string>`. The internal `TextField` is a private child added via `addComponent`. This gives full control of input event sequencing without coupling to `TextField`'s DOM type.

### Custom Dropdown — Not `ContextMenu`

`AutoCompleteDropdown extends Component` for two reasons:
1. `ContextMenu.show()` rebuilds all children on every call. Per-keystroke updates require mutating an existing item list in-place (add/remove only the delta).
2. `baseViewportListener` calls `stopPropagation()` unconditionally, which would eat keydown events the field needs to see.

### Snapshot Strategy

Store queries are async. `AutoCompleteField` keeps a private `suggestions: string[]` snapshot. This array is replaced atomically when a query resolves, then passed to the dropdown. The dropdown owns no state about the data source — it only renders whatever snapshot it receives.

### z-Index Layering

`AutoCompleteDropdown` uses z-index **10050** — above windows and context menus, below dialog layer.

### Debounce Without a Utility

Private `debounceTimer: ReturnType<typeof setTimeout> | null` field, cleared and reset on each input event. Default 200 ms.

---

## Public API (TypeScript Signatures)

### `AutoCompleteFieldConfig`

```typescript
export interface AutoCompleteFieldConfig {
    suggestions?  : string[];
    store?        : AbstractStore;
    displayField? : string;          // required when store is set
    minChars?     : number;          // default: 1
    debounceMs?   : number;          // default: 200
    maxSuggestions?: number;         // default: 10
    placeholder?  : string;
}
```

### `AutoCompleteField`

```typescript
export class AutoCompleteField extends Component implements Bindable<string> {
    constructor(config?: AutoCompleteFieldConfig);

    // Bindable<string>
    setValue(value: string): void;
    getValue(): string;
    addBindingListener(fn: () => void): void;

    // Configuration
    setSuggestions(suggestions: string[]): void;
    setStore(store: AbstractStore, displayField: string): void;
    setMinChars(n: number): void;
    setDebounceMs(ms: number): void;
    setMaxSuggestions(n: number): void;

    // Events
    addSelectListener(fn: (value: string) => void): void;

    doLayout(): void;
}
```

### `AutoCompleteDropdown` (internal — not exported from `index.ts`)

```typescript
class AutoCompleteDropdown extends Component {
    constructor(onSelect: (value: string) => void);
    show(anchorEl: HTMLElement, suggestions: string[]): void;
    hide(): void;
    isOpen(): boolean;
    highlightNext(): void;
    highlightPrev(): void;
    getHighlightedValue(): string | null;
    selectHighlighted(): void;
}
```

### `AutoCompleteItem` (internal — not exported)

```typescript
class AutoCompleteItem extends Component {
    constructor(text: string, onSelect: (value: string) => void);
    getText(): string;
    setHighlighted(highlighted: boolean): void;
    update(text: string): void;
}
```

---

## Theme Tokens

### New entries in `Theme` interface

```typescript
autoComplete: {
    background: string;
    border    : string;
    shadow    : string;
    item: {
        hoverBackground    : string;
        highlightBackground: string;
        highlightColor     : string;
        disabledColor      : string;
    };
};
```

### Values (default to contextMenu appearance for visual consistency)

| CSS Variable | Light | Dark |
|---|---|---|
| `--ts-ui-autocomplete-bg` | `rgb(255, 255, 255)` | `rgb(45, 45, 45)` |
| `--ts-ui-autocomplete-border` | `rgb(200, 200, 200)` | `rgb(80, 80, 80)` |
| `--ts-ui-autocomplete-shadow` | `2px 4px 8px rgba(0,0,0,0.15)` | `2px 4px 8px rgba(0,0,0,0.5)` |
| `--ts-ui-autocomplete-item-hover-bg` | `rgba(30, 100, 200, 0.08)` | `rgba(100, 140, 220, 0.12)` |
| `--ts-ui-autocomplete-item-highlight-bg` | `rgba(30, 100, 200, 0.18)` | `rgba(100, 140, 220, 0.28)` |
| `--ts-ui-autocomplete-item-highlight-color` | `inherit` | `rgb(220, 220, 255)` |
| `--ts-ui-autocomplete-item-disabled-color` | `rgb(170, 170, 170)` | `rgb(100, 100, 100)` |

---

## Ordered Implementation Steps

### Step 1 — Extend `Theme.ts`

Add `autoComplete` block to `Theme` interface, `DefaultTheme`, `DarkTheme`, and `themeToVars()`. No runtime risk.

### Step 2 — Implement `AutoCompleteItem`

`Base/component/AutoCompleteItem.ts`. Mirrors `ContextMenuItem` but is mutable after construction.

- Fixed `HEIGHT = 24`; inner `Label` for text; click listener via `Event.addListener`.
- `setHighlighted(b)`: toggle background between highlight CSS variable and transparent.
- `update(text)`: updates the inner `Label`'s text.
- `doLayout()`: position label with 8 px horizontal padding.

### Step 3 — Implement `AutoCompleteDropdown`

`Base/component/AutoCompleteDropdown.ts`

**Key implementation points:**

**Construction:**
- `setVisible(false)`, `setZIndex(10050)`, `Position.FIXED`.
- Background, border, shadow from CSS variables.
- `VBox` layout with `setStretching(true)`, `setComponentSpacing(0)`.

**Item pool management (key distinction from `ContextMenu`):**
- Items are NOT discarded on each show.
- If new snapshot longer than pool: append new `AutoCompleteItem` instances.
- If shorter: call `removeComponent` on excess items and truncate pool array.
- For items in the overlap range: call `item.update(newText)`.
- This is O(n) in visible items rather than O(n) DOM creation per keystroke.

**`show(anchorEl, suggestions)`:**
1. Read `anchorEl.getBoundingClientRect()`.
2. Update item pool.
3. Reset `highlightedIndex = -1`.
4. Size panel: width = `anchorEl.offsetWidth`; height = item count × `HEIGHT` + 8 px insets.
5. Position: `x = rect.left`, `y = rect.bottom`. Clamp to viewport — flip above anchor if overflows bottom.
6. `document.documentElement.appendChild(el)` if not in DOM.
7. `setVisible(true)`.
8. Register `onViewportMouseDown` via `Event.addViewportListener`.

**`hide()`:**
- `setVisible(false)`, `removeElement()`, `Event.removeViewportListener`.

**`highlightNext()` / `highlightPrev()`:**
- Clamp or wrap `highlightedIndex`.
- Call `setHighlighted` on old/new items.

### Step 4 — Implement `AutoCompleteField`

`Base/component/AutoCompleteField.ts`

**Private fields:**
```typescript
private textField       : TextField;
private dropdown        : AutoCompleteDropdown;
private staticSuggestions: string[] | null;
private store           : AbstractStore | null;
private displayField    : string | null;
private minChars        : number;
private debounceMs      : number;
private maxSuggestions  : number;
private debounceTimer   : ReturnType<typeof setTimeout> | null;
private currentValue    : string;
private bindingListeners: Array<() => void>;
private selectListeners : Array<(value: string) => void>;
```

**Construction:**
1. Create `this.textField = new TextField()` and `addComponent(this.textField)`.
2. Create `this.dropdown = new AutoCompleteDropdown(value => this.onSuggestionSelected(value))`.
3. Register handlers as stable arrow-function fields, attach with `Event.addListener`:
   - `input` on `textField` → input handler
   - `keydown` on `textField` → keyboard handler
   - `focus` / `blur` on `textField`

**`doLayout()`:** Position `textField` to fill the container: `setX(0)`, `setY(0)`, match width/height.

**Input event flow:**
```
onInput():
    currentValue = textField.getValue()
    notify bindingListeners
    clearTimeout(debounceTimer)
    if (currentValue.length < minChars): dropdown.hide(); return
    debounceTimer = setTimeout(() => this.querySuggestions(currentValue), debounceMs)
```

**`querySuggestions(query)`:**
- Static: filter (case-insensitive `includes`), slice to `maxSuggestions`, call `showSuggestions(filtered)`.
- Store: call `store.filterBy(r => ...)` then read `store.getRecords().map(r => String(r.get(displayField)))`, slice, call `showSuggestions(results)`. Call `store.clearFilter()` before applying new predicate each time.

**`showSuggestions(list)`:**
- If empty: `dropdown.hide(); return`.
- Otherwise: `dropdown.show(textField.getElement(true), list)`.

**Keyboard handler:**
```
ArrowDown: if not open → querySuggestions immediately; else dropdown.highlightNext(); preventDefault
ArrowUp:   dropdown.highlightPrev(); preventDefault
Enter:     if open && highlighted → dropdown.selectHighlighted(); preventDefault
Escape:    dropdown.hide(); textField.focus()
Tab:       dropdown.hide()
```

**`onSuggestionSelected(value)`:**
1. `textField.setValue(value)`.
2. `currentValue = value`.
3. Notify `selectListeners`.
4. Notify `bindingListeners`.
5. `dropdown.hide()`.
6. `textField.focus()`.

**Blur handler:** Delayed hide — `setTimeout(() => { if (!dropdown contains activeElement) dropdown.hide() }, 150)`. The 150 ms delay is necessary because clicking a dropdown item blurs the input before the click event fires on the item.

**`Bindable<string>` implementation:**
- `getValue()`: return `this.currentValue`.
- `setValue(value)`: set `this.currentValue = value`, `this.textField.setValue(value)` (silent — no listener fire).
- `addBindingListener(fn)`: push to `this.bindingListeners`.

### Step 5 — Export from `index.ts`

In "Components — text and input" section:

```typescript
export { AutoCompleteField }          from './component/AutoCompleteField.js';
export type { AutoCompleteFieldConfig } from './component/AutoCompleteField.js';
```

`AutoCompleteDropdown` and `AutoCompleteItem` are internal and not exported.

---

## Edge Cases

**`stopPropagation` in `baseListener`:** `keydown` registered on `textField` (an `<input>`) hits the textField entry in `listenerMap` correctly. Focus never moves to the dropdown, so keyboard events always go to the field's listener.

**FIXED dropdown on scroll:** Panel stays at its original screen coordinates if the user scrolls. Acceptable behavior matching browser native `<datalist>`. A `scroll` viewport listener calling `dropdown.hide()` can be added later.

**Stale query guard:** Before calling `showSuggestions`, check that the queried value still matches `this.currentValue`. If the user typed more since the query was fired, discard the stale result.

**`addComponent` parent guard:** `dropdown` is attached to `document.documentElement` via DOM append (same pattern as `ContextMenu`), so it has no component-tree parent and the parent-check guard is not triggered.

---

## Files to Create / Modify

| Action | File |
|---|---|
| Create | `Base/component/AutoCompleteItem.ts` |
| Create | `Base/component/AutoCompleteDropdown.ts` |
| Create | `Base/component/AutoCompleteField.ts` |
| Modify | `Base/Theme.ts` |
| Modify | `Base/index.ts` |

---

## Critical Files

- `src/typescript/Base/Theme.ts`
- `src/typescript/Base/component/AutoCompleteField.ts`
- `src/typescript/Base/component/AutoCompleteDropdown.ts`
- `src/typescript/Base/component/AutoCompleteItem.ts`
- `src/typescript/Base/index.ts`
