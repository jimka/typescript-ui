# MultiSelectList — Implementation Plan

## Overview

`MultiSelectList` extends `List` and implements `Bindable<string[]>`. It enables multi-selection on a `<select>` element by setting the native `multiple` attribute, and participates fully in the `Binding` system by returning and accepting arrays of selected option values. No existing files require modification except `index.ts`.

---

## Architecture Decisions

### Why a subclass of `List` (not a flag on `List`)

TypeScript does not allow a single class to implement both `Bindable<string>` and `Bindable<string[]>` — the two interfaces produce conflicting method signatures for `getValue` and `setValue` that cannot coexist in one type. A subclass sidesteps this entirely: `MultiSelectList` overrides those methods with array-typed signatures without touching the parent's implementation.

### The `declare getValue(): string[]` shadowing trick

`List` inherits `getValue(): string` from `ComboBox`. TypeScript sees this as the class satisfying `getValue(): string`. When `MultiSelectList` implements `Bindable<string[]>`, the compiler requires `getValue(): string[]`. The `declare` keyword introduces a type-only declaration (no JS output) that tells the compiler to treat `getValue` as returning `string[]`. The concrete method provides the runtime body.

**Order matters**: the `declare` line must appear before the concrete method in the class body.

### Native `<select multiple>` element

The HTML `<select>` element natively supports multi-selection when `multiple` is set. No custom selection tracking is required. `setValues` iterates all `<option>` children and sets `option.selected` per membership in the incoming array.

### Value identity: option `value` attribute (key), not display text

`getValue()` and `setValue()` operate on the `key` strings (`element.value` for each option), consistent with how `ComboBox.getValue()` returns `element.value` for single selection.

### `addBindingListener` hooks into the existing `change` event

Delegates directly to `this.addActionListener`, matching the pattern in every other `Bindable` implementor (`ComboBox`, `Checkbox`, `TextField`).

---

## Public API (TypeScript Signatures)

```typescript
export class MultiSelectList extends List implements Bindable<string[]> {

    // TypeScript type narrowing — no runtime body
    declare getValue(): string[];

    // Bindable<string[]> contract
    getValue(): string[];
    setValue(values: string[]): void;
    addBindingListener(fn: () => void): void;

    // Named multi-select API (aliases)
    getValues(): string[];
    setValues(values: string[]): void;

    // Store helper
    getSelectedRecords(): ModelRecord[];

    // Rendering override
    render(): HTMLSelectElement;
}
```

---

## Implementation

### `getValues(): string[]`

```typescript
getValues(): string[] {
    const element = this.getElement();
    if (!element) { return []; }

    const result: string[] = [];
    for (const option of Array.from(element.selectedOptions)) {
        result.push(option.value);
    }

    return result;
}
```

### `setValues(values: string[]): void`

```typescript
setValues(values: string[]): void {
    const element = this.getElement();
    if (!element) { return; }

    const valueSet = new Set(values);

    for (const option of Array.from(element.options)) {
        option.selected = valueSet.has(option.value);
    }
}
```

### `getSelectedRecords(): ModelRecord[]`

Maps selected values back to store records by index correspondence (guaranteed by `ComboBox.refreshFromStore()` which builds `this.items` in the same order as `store.getRecords()`):

```typescript
getSelectedRecords(): ModelRecord[] {
    const store = this.getStore();
    if (!store) { return []; }

    const selected = new Set(this.getValues());
    const records  = store.getRecords();
    const items    = this.getItems();
    const result: ModelRecord[] = [];

    for (let i = 0; i < items.length && i < records.length; i++) {
        const optionEl = items[i].getElement() as HTMLOptionElement | undefined;
        if (optionEl && selected.has(optionEl.value)) {
            result.push(records[i]);
        }
    }

    return result;
}
```

### `render(): HTMLSelectElement`

```typescript
render(): HTMLSelectElement {
    const element = super.render() as HTMLSelectElement;
    element.multiple = true;
    return element;
}
```

---

## The `declare getValue()` Trick — Detailed Explanation

**The problem**: `List` inherits `getValue(): string` from `ComboBox`. When `MultiSelectList` writes `implements Bindable<string[]>`, the compiler requires `getValue(): string[]`, but the inherited `getValue(): string` conflicts.

**The solution**: the `declare` keyword introduces a type-only declaration — no code emitted to JavaScript:
```typescript
declare getValue(): string[];
```
This tells TypeScript: "for this class, treat `getValue` as returning `string[]`." The immediately following concrete method provides the runtime body.

**JavaScript output**: the `declare` line produces zero JavaScript. Only the concrete `getValue()` exists at runtime.

---

## Ordered Implementation Steps

### Step 1 — Create `MultiSelectList.ts`

`Base/component/MultiSelectList.ts`

Full structure:
1. License header.
2. Import `List`, `Bindable`, `ModelRecord`.
3. JSDoc class comment.
4. `declare getValue(): string[]` (before concrete method).
5. Concrete `getValue(): string[]` delegating to `getValues()`.
6. `setValue(values: string[]): void` delegating to `setValues()`.
7. `addBindingListener(fn: () => void): void` delegating to `addActionListener`.
8. `getValues(): string[]` — reads `element.selectedOptions`.
9. `setValues(values: string[]): void` — iterates `element.options` with `Set` lookup.
10. `getSelectedRecords(): ModelRecord[]` — index-mapped store lookup.
11. `render(): HTMLSelectElement` — `super.render()` then `element.multiple = true`.

### Step 2 — Export from `index.ts`

In the "Components — lists" section, directly after the `List` export:

```typescript
export { MultiSelectList } from './component/MultiSelectList.js';
```

---

## Potential Challenges

**`declare` + concrete method ordering**: `declare` line must appear before the concrete method. Reversing them has been observed to confuse some TypeScript compiler versions.

**`element.selectedOptions` availability**: available in all modern browsers. Wrap in `Array.from()` before iterating to avoid live-collection mutation issues.

**`setValues` before render**: when called before the component is rendered, `getElement()` returns `undefined`; method silently returns without error. This matches the established pattern throughout the codebase.

**`getItems()` alignment with store records**: `getSelectedRecords()` relies on `getItems()` and `store.getRecords()` being in the same order. Guaranteed by `ComboBox.refreshFromStore()` which rebuilds `this.items` by iterating `store.getRecords()` in sequence.

**`size` attribute**: the native browser rendering of `<select multiple>` shows 4 rows by default. `List.setItems()` / `addItem()` / `refreshFromStore()` all set `element.size = this.getItems().length + 1`, which is inherited and continues to work correctly.

---

## Files to Create / Modify

| Action | File |
|---|---|
| Create | `Base/component/MultiSelectList.ts` |
| Modify | `Base/index.ts` (one line added) |

No other files require changes: `Binding.ts`, `Bindable.ts`, `List.ts`, `ComboBox.ts`, and `ModelRecord.ts` are all untouched.

---

## Critical Files

- `src/typescript/Base/component/MultiSelectList.ts` (create)
- `src/typescript/Base/index.ts` (one export line)
- `src/typescript/Base/component/List.ts` (reference only)
- `src/typescript/Base/Bindable.ts` (reference only)
- `src/typescript/Base/component/ComboBox.ts` (reference only)
