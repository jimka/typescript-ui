# Table Multi-Column Sorting — Implementation Plan

> **Codebase reconciliation note (2026-05-10):** the plan was authored against an earlier `AbstractStore`. Since then the store gained `'loadingchanged' | 'pagechanged' | 'pagechangeblocked'` events, `sort()`/`clearSort()` were promoted to return `Promise<void>`, `sort()` acquired server-side pagination side effects, and `applyView()` gained a worker-offload path. `HeaderCell` uses `getRenderer().getText()` (not `getLabel()`) and `onSortClick()` carries an `isDragging` guard. All of these points are now folded into the steps below; new constraints introduced by the drift are called out inline.

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

The current union already carries `'loadingchanged' | 'pagechanged' | 'pagechangeblocked'` (added since this plan was first drafted). Keep them and append `'sortchanged'`:

```typescript
export type StoreEvent =
    | 'load' | 'datachanged' | 'add' | 'remove'
    | 'beforesync' | 'sync'
    | 'loadingchanged' | 'pagechanged' | 'pagechangeblocked'
    | 'sortchanged';   // NEW
```

### Modified: `AbstractStore` — sort overloads

`sort()` and `clearSort()` currently return `Promise<void>` (callers chain on `applyView()`); preserve that. The single-arg overload also has server-side pagination side effects (resets `_page` to 1, emits `'pagechanged'`, fires a `void this.load()` after the local view rebuild) — the multi-arg overload must mirror this.

```typescript
/** Single-column sort (backward-compatible). */
sort(field: string, dir?: 'asc' | 'desc'): Promise<void>;

/** Multi-column sort. Empty array clears all sorters. */
sort(descriptors: SortDescriptor[]): Promise<void>;

/** Returns a copy of all active sort descriptors in priority order. */
getActiveSorters(): SortDescriptor[];

/**
 * @deprecated Use getActiveSorters() instead.
 */
getActiveSorter(): { property: string; direction: 'asc' | 'desc' } | null;

clearSort(): Promise<void>;   // unchanged signature
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
2. Replace `private activeSorter: SorterConfig | null = null` with `private activeSorters: SortDescriptor[] = []`. The `SorterConfig` interface (declared above the class) becomes unused — delete it.
3. Add two public overload signatures and one private implementation. **Both overloads must return `Promise<void>` and must preserve the existing pagination side effects** that the current `sort()` performs:
   - String path: build `[{ field, dir }]`, assign to `activeSorters`.
   - Array path: assign directly (empty array = clear all).
   - If `this._pageSize != null`: set `this._page = 1`, emit `'pagechanged'`.
   - Return `this.applyView().then(() => { emit 'sortchanged'; emit 'datachanged'; if (this._pageSize != null) void this.load(); })`.
4. Update `clearSort()` (still returns `Promise<void>`): set `activeSorters = []`, then `applyView().then(() => { emit 'sortchanged'; emit 'datachanged'; })`. Pagination side effects are *not* required here today (current code doesn't do them) — leave as-is.
5. Add `getActiveSorters()`: return `this.activeSorters.map(s => ({ ...s }))`.
6. Update `getActiveSorter()` (deprecated): `const first = this.activeSorters[0]; return first ? { property: first.field, direction: first.dir } : null;`.
7. Update `applyView()` multi-key comparator. Note the current method returns `Promise<void>` and may delegate to `applyViewOnWorker()`; only the in-process branch changes here:

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

8. **Worker-offload path (`applyViewOnWorker`)**: today it forwards a single `{ field, direction }` to `StoreWorkerClient.sortFilter`. The worker protocol does not yet accept multiple sorters. Two acceptable choices:
   - **(a) Minimal — degrade to primary sorter on worker path.** Forward only `activeSorters[0]` when present. Multi-sort still works correctly under the threshold (1000 records); above the threshold only the primary sorter applies. Document this in the method comment.
   - **(b) Full — extend the worker protocol.** Change `StoreWorkerClient.sortFilter` and `StoreWorker` to accept `sorters: { field; direction }[]`, and update the worker's comparator to be multi-key. Larger surface; touches `StoreWorkerClient.ts` and `StoreWorker.ts`.

   Recommend **(a)** for this iteration unless the team has a near-term need for multi-sort on >1000-record stores; promote to **(b)** later.

9. Add `'sortchanged'` to the `StoreEvent` union (alongside the existing `'loadingchanged' | 'pagechanged' | 'pagechangeblocked'`).

### Step 2 — `HeaderCell.ts`: thread `shiftKey`, add priority badge

1. Update callback type: `private onSortClickCallback: ((fieldName: string, shiftKey: boolean) => void) | null = null;`
2. Update `setOnSortClick` signature.
3. In `init()`, change native click listener (currently `el.addEventListener('click', () => this.onSortClick());`):
   ```typescript
   el.addEventListener('click', (e: MouseEvent) => this.onSortClick(e.shiftKey));
   ```
4. Update `onSortClick(shiftKey: boolean)` to pass `shiftKey` through to the callback. **Preserve the existing `isDragging` guard** that swallows the click immediately after a resize drag:
   ```typescript
   private onSortClick(shiftKey: boolean): void {
       if (this.isDragging) {
           this.isDragging = false;
           return;
       }
       this.onSortClickCallback?.(this.fieldName, shiftKey);
   }
   ```
5. Add private field: `private priorityBadge: HTMLSpanElement | null = null;`
6. In `init()`, after the resize handle is appended (and before/after the tooltip block — order doesn't matter), create the badge span:
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
7. Update `setSortState` to accept and apply priority. **Use `getRenderer().getText()`** — the current renderer exposes `getText()`, not `getLabel()`:
   ```typescript
   setSortState(state: 'asc' | 'desc' | null, priority?: number | null): void {
       const arrow = state === 'asc' ? ' ▲' : state === 'desc' ? ' ▼' : '';
       this.getRenderer().getText().setText(this.text + arrow);
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
2. Update `wireCell` callback (currently `cell.setOnSortClick((fieldName) => this.handleSortClick(fieldName));`):
   ```typescript
   cell.setOnSortClick((fieldName, shiftKey) => this.handleSortClick(fieldName, shiftKey));
   ```
3. Replace `handleSortClick(fieldName)` with the shift-aware version below. The current implementation also explicitly clears every cell's sort state before re-applying — the rewrite delegates that to `syncSortIndicators()` (called at the end), which now iterates all cells unconditionally:

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

4. Rewrite `syncSortIndicators()`. The current implementation early-returns when there's no active sorter, which leaves stale arrows on previously-sorted cells when `setModel()` is called after a `clearSort()`. The rewrite below incidentally fixes that latent bug by always iterating every visible cell:

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

**Worker offload above 1000 records**: `applyViewOnWorker()` currently forwards a single sorter to the worker. Until the worker protocol is extended (Step 1.8 option (b)), multi-sort silently degrades to single-sort on large stores. The user-visible badges would still draw all priorities, mismatching the actual ordering. Either gate the badge on `allRecords.length < WORKER_THRESHOLD` or commit to extending the worker protocol up front.

**Pagination semantics for multi-sort**: the array overload should mirror the string overload's behaviour and reset `_page` to 1 + emit `'pagechanged'` + fire `void this.load()` on paginated stores. Server-side proxies must understand the new ordering — but `ReadParams` does not currently carry sort information at all (the proxy is fed by `_page`/`_pageSize` only). That gap exists today for single-sort too; the multi-sort change does not make it worse but should be flagged.

---

## Files to Create / Modify

| File | Action | Summary |
|---|---|---|
| `Base/data/AbstractStore.ts` | Modify | Add `SortDescriptor`; `'sortchanged'` (alongside the existing `'loadingchanged' \| 'pagechanged' \| 'pagechangeblocked'`); replace `activeSorter`/delete unused `SorterConfig` with `activeSorters[]`; overloaded `sort()` returning `Promise<void>` and preserving pagination side effects; `getActiveSorters()`; deprecate `getActiveSorter()`; update `clearSort()` and `applyView()`; degrade worker path to primary sorter (or extend worker protocol) |
| `Base/component/table/cell/Header.ts` | Modify | Thread `shiftKey` (preserving the `isDragging` guard); extend `setSortState(state, priority?)` with raw `<span>` priority badge using `getRenderer().getText()` |
| `Base/component/table/Header.ts` | Modify | Import `SortDescriptor`; update `wireCell`; replace `handleSortClick` with shift-aware multi-sort; rewrite `syncSortIndicators` to iterate all cells (also fixes a stale-arrow bug after `setModel`) |
| `Base/index.ts` | Modify | Export `SortDescriptor` type |
| `Base/data/StoreWorkerClient.ts`, `Base/data/StoreWorker.ts` | (Optional, only if Step 1.8 option (b)) | Extend the `sortFilter` protocol to accept `sorters[]` instead of a single `sort` argument and update the worker comparator to be multi-key |

No new files needed.

---

## Critical Files

- `src/typescript/Base/data/AbstractStore.ts`
- `src/typescript/Base/component/table/Header.ts`
- `src/typescript/Base/component/table/cell/Header.ts`
- `src/typescript/Base/index.ts`
