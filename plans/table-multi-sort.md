# Table Multi-Column Sorting — Implementation Plan

## Overview

Adds multi-column sorting to the Table component. A new `SortDescriptor` interface becomes the canonical sort unit. `AbstractStore` gains an overloaded `sort()` that accepts either the classic `(field, dir)` signature or a `SortDescriptor[]` array, fires a new `'sortchanged'` event, and applies a stable multi-key comparison in `applyView()`. `HeaderCell` threads `MouseEvent.shiftKey` up through the callback chain. `HeaderCell` also renders a raw `<span>` priority badge when more than one sorter is active. `getActiveSorter()` is kept but deprecated; `getActiveSorters()` is the authoritative read path.

---

## Architecture Decisions

### `SortDescriptor` lives in `AbstractStore.ts`

The descriptor is a store-layer concept, not a UI concept. Placing it next to `SorterConfig` avoids circular imports.

### `activeSorters: SortDescriptor[]` replaces `activeSorter`

The private field is replaced; backward compatibility is maintained at the public API boundary by the overloaded `sort()` and deprecated `getActiveSorter()`.

### `sort()` uses TypeScript overloads

Two public overloads (`sort(field, dir)` and `sort(descriptors[])`) with a private implementation signature handling both.

### `'sortchanged'` added to `StoreEvent`

`'datachanged'` continues to fire for everything; `'sortchanged'` lets listeners react specifically to sort changes.

### `shiftKey` passed as second argument to `onSortClick` callback

The click listener in `HeaderCell.init()` already uses native `addEventListener('click', ...)`. Changing the callback signature to `(fieldName: string, shiftKey: boolean) => void` passes the boolean through the chain. All multi-sort logic stays in `Header` where store access already lives.

### Priority badge is a raw `<span>`

Non-interactive, one or two characters, no framework lifecycle. A raw DOM `<span>` appended inside the `<th>` element matches the existing pattern for the resize handle `<div>`.

---

## Public API (TypeScript Signatures)

### New: `SortDescriptor`

```typescript
export interface SortDescriptor {
    field: string;
    dir  : 'asc' | 'desc';
}
```

### Modified: `StoreEvent`

```typescript
export type StoreEvent =
    | 'load' | 'datachanged' | 'add' | 'remove'
    | 'beforesync' | 'sync'
    | 'sortchanged';   // NEW
```

### Modified: `AbstractStore` — sort overloads

```typescript
/** Single-column sort (backward-compatible). */
sort(field: string, dir?: 'asc' | 'desc'): void;

/** Multi-column sort. Empty array clears all sorters. */
sort(descriptors: SortDescriptor[]): void;

/** Returns a copy of all active sort descriptors in priority order. */
getActiveSorters(): SortDescriptor[];

/**
 * @deprecated Use getActiveSorters() instead.
 */
getActiveSorter(): { property: string; direction: 'asc' | 'desc' } | null;
```

### Modified: `HeaderCell`

```typescript
setOnSortClick(fn: (fieldName: string, shiftKey: boolean) => void): void;
setSortState(state: 'asc' | 'desc' | null, priority?: number | null): void;
```

---

## Ordered Implementation Steps

### Step 1 — `AbstractStore.ts`

1. Add `export interface SortDescriptor { field: string; dir: 'asc' | 'desc'; }`.
2. Replace `private activeSorter: SorterConfig | null = null` with `private activeSorters: SortDescriptor[] = []`.
3. Add two public overload signatures and one private implementation:
   - `typeof fieldOrDescriptors === 'string'`: build `[{ field, dir }]` and assign to `activeSorters`.
   - Array path: assign directly (empty array = clear all).
   - After assigning: call `applyView()`, emit `'sortchanged'`, emit `'datachanged'`.
4. Update `clearSort()`: set `activeSorters = []`, emit both events.
5. Add `getActiveSorters()`: return `this.activeSorters.map(s => ({ ...s }))`.
6. Update `getActiveSorter()` (deprecated): `const first = this.activeSorters[0]; return first ? { property: first.field, direction: first.dir } : null;`.
7. Update `applyView()` multi-key comparator:

```typescript
if (this.activeSorters.length > 0) {
    view.sort((a, b) => {
        for (const { field, dir } of this.activeSorters) {
            const av = a.get(field);
            const bv = b.get(field);
            if (av == null && bv == null) { continue; }
            if (av == null) { return 1; }
            if (bv == null) { return -1; }
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            if (cmp !== 0) { return dir === 'asc' ? cmp : -cmp; }
        }
        return 0;
    });
}
```

8. Add `'sortchanged'` to the `StoreEvent` union.

### Step 2 — `HeaderCell.ts`: thread `shiftKey`, add priority badge

1. Update callback type: `private onSortClickCallback: ((fieldName: string, shiftKey: boolean) => void) | null = null;`
2. Update `setOnSortClick` signature.
3. In `init()`, change native click listener:
   ```typescript
   el.addEventListener('click', (e: MouseEvent) => this.onSortClick(e.shiftKey));
   ```
4. Update `onSortClick(shiftKey: boolean)` to pass `shiftKey` through to the callback.
5. Add private field: `private priorityBadge: HTMLSpanElement | null = null;`
6. In `init()`, after the resize handle, create the badge span:
   ```typescript
   const badge = document.createElement('span');
   badge.style.cssText =
       'position:absolute;top:2px;right:8px;font-size:10px;line-height:1;' +
       'background:var(--ts-ui-sort-badge-bg,rgba(0,0,0,0.15));' +
       'color:var(--ts-ui-sort-badge-color,inherit);' +
       'border-radius:3px;padding:1px 3px;display:none;pointer-events:none;';
   el.appendChild(badge);
   this.priorityBadge = badge;
   ```
7. Update `setSortState` to accept and apply priority:
   ```typescript
   setSortState(state: 'asc' | 'desc' | null, priority?: number | null): void {
       const arrow = state === 'asc' ? ' ▲' : state === 'desc' ? ' ▼' : '';
       this.getRenderer().getLabel().setText(this.text + arrow);
       this.getAria().setSort(
           state === 'asc' ? 'ascending' : state === 'desc' ? 'descending' : 'none'
       );
       if (this.priorityBadge) {
           const showBadge = priority != null && priority >= 2;
           this.priorityBadge.textContent   = showBadge ? String(priority) : '';
           this.priorityBadge.style.display = showBadge ? '' : 'none';
       }
   }
   ```
   Badge is hidden when only one active sorter (priority = 1 or null), shown when two or more.

### Step 3 — `Header.ts`: multi-sort click handling and indicator sync

1. Import `SortDescriptor` from `AbstractStore.ts`.
2. Update `wireCell` callback: `cell.setOnSortClick((fieldName, shiftKey) => this.handleSortClick(fieldName, shiftKey))`.
3. Replace `handleSortClick(fieldName)` with the shift-aware version:

```typescript
private handleSortClick(fieldName: string, shiftKey: boolean): void {
    if (shiftKey) {
        const sorters = this.store.getActiveSorters();
        const idx     = sorters.findIndex(s => s.field === fieldName);
        let next: SortDescriptor[];

        if (idx === -1) {
            next = [...sorters, { field: fieldName, dir: 'asc' }];
        } else if (sorters[idx].dir === 'asc') {
            next = sorters.map((s, i) =>
                i === idx ? { field: s.field, dir: 'desc' } : s
            );
        } else {
            next = sorters.filter((_, i) => i !== idx);
        }

        if (next.length === 0) {
            this.store.clearSort();
        } else {
            this.store.sort(next);
        }
    } else {
        const sorters = this.store.getActiveSorters();
        const current = sorters.length === 1 && sorters[0].field === fieldName
            ? sorters[0] : null;

        if (!current) {
            this.store.sort(fieldName, 'asc');
        } else if (current.dir === 'asc') {
            this.store.sort(fieldName, 'desc');
        } else {
            this.store.clearSort();
        }
    }

    this.syncSortIndicators();
}
```

4. Rewrite `syncSortIndicators()`:

```typescript
private syncSortIndicators(): void {
    const cells         = this.getColumns() as HeaderCell[];
    const visibleFields = this.model.getFields()
        .filter(f => !this.hiddenColumns.has(f.getName()))
        .sort((a, b) => a.getOrder() - b.getOrder());

    const sorters      = this.store.getActiveSorters();
    const fieldToSorter = new Map(sorters.map((s, i) => [s.field, { dir: s.dir, priority: i + 1 }]));
    const showPriority = sorters.length > 1;

    cells.forEach((cell, i) => {
        const fieldName = visibleFields[i]?.getName();
        const entry     = fieldName ? fieldToSorter.get(fieldName) : undefined;

        if (entry) {
            cell.setSortState(entry.dir, showPriority ? entry.priority : null);
        } else {
            cell.setSortState(null);
        }
    });
}
```

### Step 4 — `index.ts`

```typescript
export type { SortDescriptor } from './data/AbstractStore.js';
```

---

## Potential Challenges

**`applyView()` stability**: `Array.prototype.sort` has been stable since ES2019 in all modern browsers.

**`SortDescriptor` import in `Header.ts`**: add as a named import from `AbstractStore`.

**Badge z-index vs. resize handle**: badge positioned `right: 8px` avoids collision with the 5 px resize handle. Verify against actual rendered column widths.

**Backward compatibility**: any code calling `store.sort(field, dir)` then reading `store.getActiveSorter()` expecting `null` when cleared will still work — `getActiveSorter()` reads from `activeSorters[0]` which is `undefined` when empty, returns `null`.

---

## Files to Create / Modify

| File | Action | Summary |
|---|---|---|
| `Base/data/AbstractStore.ts` | Modify | Add `SortDescriptor`; `'sortchanged'`; replace `activeSorter` with `activeSorters[]`; overloaded `sort()`; `getActiveSorters()`; deprecate `getActiveSorter()`; update `clearSort()` and `applyView()` |
| `Base/component/table/cell/Header.ts` | Modify | Thread `shiftKey`; extend `setSortState(state, priority?)` with raw `<span>` priority badge |
| `Base/component/table/Header.ts` | Modify | Import `SortDescriptor`; update `wireCell`; replace `handleSortClick` with shift-aware multi-sort; rewrite `syncSortIndicators` |
| `Base/index.ts` | Modify | Export `SortDescriptor` type |

No new files needed.

---

## Critical Files

- `src/typescript/Base/data/AbstractStore.ts`
- `src/typescript/Base/component/table/Header.ts`
- `src/typescript/Base/component/table/cell/Header.ts`
- `src/typescript/Base/index.ts`
