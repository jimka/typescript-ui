# Server-Side Pagination — Implementation Plan

## Overview

Opt-in server-side pagination without breaking any existing behavior. Stores that never call `setPageSize(n)` are completely unaffected. The feature spans four layers: the proxy contract (`ReadParams`), the proxy implementation (`AjaxProxy`), the store (`AbstractStore`), and the UI (`Button.setEnabled`, `PaginationBar`, `TablePanel.setPaginationBar`).

---

## Architecture Decisions

### Opt-in via `setPageSize(n)` — zero breaking changes

`AbstractStore` stores `_pageSize: number | undefined`. When undefined, `load()` calls `proxy.read()` with no arguments (identical to today). When set, it passes `ReadParams` and activates page-state tracking.

### `ReadParams` added to `Proxy.read()` signature, not a parallel method

`Proxy.read(params?: ReadParams)` keeps the CRUD interface compact. `MemoryProxy` can ignore the params. The abstract method becomes optional-params.

### Total count lives on `Proxy` (not just `AjaxProxy`)

Add `getLastTotalCount(): number | undefined { return undefined; }` as a concrete (non-abstract) method on `Proxy`, overridden in `AjaxProxy`. This avoids `instanceof` checks and coupling in `AbstractStore`.

### `AjaxProxy` appends query-string parameters

`page` and `pageSize` appended as URL query params. Server response envelope: `{ data: T[], total: number }`. Falls back to existing array/root-key behavior when params are absent.

### `sort()` and `clearFilter()` in paginated mode reset to page 1

When `_pageSize` is set, both methods reset `_page = 1` and call `void this.load()` fire-and-forget after the normal sort/filter logic.

### `PaginationBar` is a standalone `Component`

`PaginationBar extends Component` with `HBox` layout. `TablePanel.setPaginationBar(bar)` docks it to the `SOUTH` region of the `Border` layout. The bar is reusable without requiring a `TablePanel`.

### `Button.setEnabled(enabled: boolean)` uses native `disabled` attribute

`<button disabled>` natively suppresses pointer events. Visual feedback via CSS opacity.

---

## Public API (TypeScript Signatures)

### `Proxy` (modified)

```typescript
export interface ReadParams {
    page?    : number;
    pageSize?: number;
}

export abstract class Proxy {
    abstract read(params?: ReadParams): Promise<any[]>;
    abstract create(record: ModelRecord): Promise<Record<string, any>>;
    abstract update(record: ModelRecord): Promise<Record<string, any>>;
    abstract destroy(record: ModelRecord): Promise<void>;

    /** Returns the total record count from the last paginated read, or undefined. */
    getLastTotalCount(): number | undefined;
}
```

### `AjaxProxy` (modified)

```typescript
export class AjaxProxy extends Proxy {
    /** Appends ?page=N&pageSize=M when params provided; parses { data, total } envelope. */
    async read(params?: ReadParams): Promise<any[]>;

    getLastTotalCount(): number | undefined;
}
```

### `AbstractStore` (modified)

```typescript
export type StoreEvent = 'load' | 'datachanged' | 'add' | 'remove'
                       | 'beforesync' | 'sync' | 'pagechanged';

export class AbstractStore {
    setPageSize(n: number): void;
    getPageSize(): number | undefined;

    getPage(): number;
    getTotalCount(): number | undefined;
    getTotalPages(): number | undefined;

    nextPage(): void;
    prevPage(): void;
    goToPage(n: number): void;

    // Modified to pass ReadParams when paginated:
    async load(): Promise<void>;
}
```

### `Button` (modified)

```typescript
export class Button extends Component {
    setEnabled(enabled: boolean): void;
    isEnabled(): boolean;
}
```

### `PaginationBar` (new file)

```typescript
export class PaginationBar extends Component {
    constructor(store: AbstractStore);

    /** Detaches store listeners. Call when removing the bar permanently. */
    dispose(): void;
}
```

### `TablePanel` (modified)

```typescript
export class TablePanel extends Component {
    /** Docks PaginationBar to the SOUTH region. Replaces any previously attached bar. */
    setPaginationBar(bar: PaginationBar): void;
}
```

---

## Ordered Implementation Steps

### Step 1 — Add `ReadParams` interface to `Proxy.ts`

Export `ReadParams` interface and:
1. Change abstract `read()` to `read(params?: ReadParams)`.
2. Add concrete `getLastTotalCount(): number | undefined { return undefined; }`.

Also export `ReadParams` from `Base/index.ts`.

### Step 2 — Update `MemoryProxy.read()`

Change `read(): Promise<any[]>` to `read(params?: ReadParams): Promise<any[]>`. Body unchanged.

### Step 3 — Update `AjaxProxy.read()`

Add `private lastTotalCount: number | undefined`.

In `read(params?: ReadParams)`:
1. If `params` has `page` or `pageSize`: build URL with `URLSearchParams` appended as query string.
2. After `response.json()`, when params present: expect `{ data: T[], total: number }`. If `root` is set, read `json[root]` first, then extract `.data` and `.total`.
3. Store `json.total` in `this.lastTotalCount`.
4. Return `data` array.
5. When params absent: existing code path exactly — no behavioral change.

Override `getLastTotalCount(): number | undefined` to return `this.lastTotalCount`.

### Step 4 — Add page state and methods to `AbstractStore`

Add private fields: `_page = 1`, `_pageSize: number | undefined`, `_totalCount: number | undefined`.

**Modify `load()`:**
```typescript
const params: ReadParams | undefined = this._pageSize != null
    ? { page: this._page, pageSize: this._pageSize }
    : undefined;
const raw = await this.proxy.read(params);
// ...existing ingestion logic...
this._totalCount = this.proxy.getLastTotalCount();
```

**Add new methods:**
- `setPageSize(n)`: set `_pageSize = n`, reset `_page = 1`, emit `'pagechanged'`.
- `getPageSize()`: return `_pageSize`.
- `getPage()`: return `_page`.
- `getTotalCount()`: return `_totalCount`.
- `getTotalPages()`: `_pageSize != null && _totalCount != null ? Math.ceil(_totalCount / _pageSize) : undefined`.
- `nextPage()`: if not on last page, `_page++`, emit `'pagechanged'`, `void this.load()`.
- `prevPage()`: if `_page > 1`, `_page--`, emit `'pagechanged'`, `void this.load()`.
- `goToPage(n)`: clamp to `[1, totalPages ?? n]`, set `_page`, emit `'pagechanged'`, `void this.load()`.

**Modify `sort()` and `clearFilter()`:** when `_pageSize != null`, set `_page = 1` before emitting `'datachanged'`, and call `void this.load()` after.

Add `'pagechanged'` to `StoreEvent`.

### Step 5 — Add `setEnabled()` / `isEnabled()` to `Button`

Add `private _enabled: boolean = true`.

`setEnabled(enabled: boolean)`:
- `_enabled = enabled`.
- If false: `this.setAttribute('disabled', '')`, set opacity 0.5 via CSS rule, `setCursor('not-allowed')`.
- If true: `this.removeAttribute('disabled')`, restore opacity, restore cursor.

`isEnabled()`: return `_enabled`.

### Step 6 — Create `PaginationBar`

`Base/component/PaginationBar.ts`

Constructor (`store: AbstractStore`):
1. `super()`, set `HBox` layout with `setComponentSpacing(4)`.
2. Create: `firstBtn = new Button("<<")`, `prevBtn = new Button("<")`, `pageLabel = new Label("")`, `nextBtn = new Button(">")`, `lastBtn = new Button(">>")`.
3. Wire actions: `firstBtn` → `store.goToPage(1)`; `prevBtn` → `store.prevPage()`; `nextBtn` → `store.nextPage()`; `lastBtn` → `store.goToPage(store.getTotalPages() ?? store.getPage())`.
4. Store bound listener ref: `private readonly onPageChanged = () => this.refresh()`.
5. Subscribe: `store.on('pagechanged', this.onPageChanged)` and `store.on('load', this.onPageChanged)`.
6. Call `this.refresh()` once.

`refresh()`:
```typescript
private refresh(): void {
    const page       = this.store.getPage();
    const totalPages = this.store.getTotalPages();
    const text       = totalPages != null
        ? `Page ${page} of ${totalPages}`
        : `Page ${page}`;

    this.pageLabel.setText(text);
    this.firstBtn.setEnabled(page > 1);
    this.prevBtn.setEnabled(page > 1);
    this.nextBtn.setEnabled(totalPages == null || page < totalPages);
    this.lastBtn.setEnabled(totalPages != null && page < totalPages);
}
```

`dispose()`: `store.off('pagechanged', this.onPageChanged)`, `store.off('load', this.onPageChanged)`.

### Step 7 — Add `setPaginationBar()` to `TablePanel`

Add `private paginationBar: PaginationBar | undefined`.

```typescript
setPaginationBar(bar: PaginationBar): void {
    if (this.paginationBar) {
        this.removeComponent(this.paginationBar);
    }
    this.paginationBar = bar;
    this.addComponent(bar, { placement: Placement.SOUTH });
}
```

### Step 8 — Export from `index.ts`

```typescript
export { PaginationBar } from './component/PaginationBar.js';
export type { ReadParams } from './data/proxy/Proxy.js';
```

---

## Potential Challenges

**`PaginationBar` listener identity for `off()`**: must store the bound listener as a private field (not inline arrow function), so `dispose()` can remove the same reference.

**Fire-and-forget `load()` in `sort()` and `clearFilter()`**: the promise is intentionally unhandled. If the server request fails, the error appears as an unhandled rejection. A future `'loaderror'` event could address this.

**Button disabled state and `:active` CSS**: setting the native `disabled` attribute on `<button>` suppresses `:active` in all major browsers — no additional handling needed.

---

## Files to Create or Modify

| Action | File |
|---|---|
| Modify | `Base/data/proxy/Proxy.ts` |
| Modify | `Base/data/proxy/MemoryProxy.ts` |
| Modify | `Base/data/proxy/AjaxProxy.ts` |
| Modify | `Base/data/AbstractStore.ts` |
| Modify | `Base/component/Button.ts` |
| Create | `Base/component/PaginationBar.ts` |
| Modify | `Base/component/table/TablePanel.ts` |
| Modify | `Base/index.ts` |

---

## Critical Files

- `src/typescript/Base/data/AbstractStore.ts`
- `src/typescript/Base/data/proxy/AjaxProxy.ts`
- `src/typescript/Base/data/proxy/Proxy.ts`
- `src/typescript/Base/component/Button.ts`
- `src/typescript/Base/component/table/TablePanel.ts`
