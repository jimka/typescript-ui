# Test Suite — Implementation Plan

## Overview

A layered test suite for the UI framework split into two tiers: **pure-logic unit tests** (no DOM, run in Node) and **component integration tests** (DOM required, run in jsdom). Both tiers share the same Vitest runner and `tsconfig`, keeping the toolchain minimal and coherent with the existing Vite build.

---

## Test Framework Choice and Rationale

**Vitest** is the correct choice. The project already depends on Vite 8.x. Vitest is Vite-native — it reuses the same `vite.config.ts` module resolution, the same `tsconfig.json` compiler options (`ESNext`, `moduleResolution: "bundler"`, `strict`), and the same import aliases. The `.js` extension on every internal import works natively in Vitest but requires manual resolver configuration in Jest. No transpilation mismatch.

Alternatives rejected:
- **Jest**: Requires Babel or ts-jest for ESNext modules; `moduleResolution: "bundler"` is not natively supported.
- **Playwright/Cypress**: Appropriate for end-to-end tests against a running Vite dev server — a future addition, not the initial scope.
- **Karma + Jasmine**: Legacy browser-test approach, poor TypeScript integration.

**jsdom** is used as the Vitest environment for component tests. A per-file `// @vitest-environment jsdom` annotation means pure-logic files run in Node (faster) while component files load jsdom only where needed.

---

## Architecture: What Needs DOM vs. What Does Not

### Tier 1 — Pure Logic (Node environment, no jsdom)

| File | Why it qualifies |
|---|---|
| `data/Field.ts` | Plain value object |
| `data/AbstractModel.ts` | Field indexing, `createRecord` — pure data transformation |
| `data/ModelRecord.ts` | State machine for dirty/new/commit/reject — pure |
| `data/MemoryStore.ts` (via `AbstractStore`) | Filter, sort, CRUD, event dispatch — pure. `MemoryProxy` uses only `Promise.resolve`. |
| `data/proxy/MemoryProxy.ts` | In-memory array; no DOM |
| `validation/Validator.ts` | Pure function `applyRule` — ideal first test target |
| `Insets.ts` | Pure value object |

### Tier 2 — DOM Required (jsdom environment)

| File | DOM dependency |
|---|---|
| `CSS.ts` | `document.getElementsByTagName`, `style.sheet` — called in `Component` constructor |
| `Component.ts` | `CSS.createComponentRule` called in constructor; `render()` calls `document.createElement` |
| All layout managers | `container.getInnerSize()` touches DOM element |
| `Event.ts` | `window.addEventListener` |
| `Binding.ts` | Instantiates `FieldDecorator` which calls `Component` constructors |
| All UI components | `Component` subclasses |

---

## File Structure

```
/home/jika/typescript/typescript/
├── vitest.config.ts                        ← new
├── tsconfig.test.json                      ← new
└── tests/
    ├── setup/
    │   └── jsdom-setup.ts                  ← global jsdom setup hooks
    ├── unit/                               ← Tier 1: Node env
    │   ├── data/
    │   │   ├── Field.test.ts
    │   │   ├── ModelRecord.test.ts
    │   │   ├── Model.test.ts
    │   │   ├── MemoryStore.test.ts
    │   │   └── proxy/
    │   │       ├── MemoryProxy.test.ts
    │   │       └── AjaxProxy.test.ts
    │   ├── validation/
    │   │   └── Validator.test.ts
    │   └── Insets.test.ts
    └── component/                          ← Tier 2: jsdom env
        ├── Component.test.ts
        ├── layout/
        │   ├── HBox.test.ts
        │   └── VBox.test.ts
        └── binding/
            └── Binding.test.ts
```

---

## Build / Config Changes

### `vitest.config.ts` (new file at project root)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',    // default; jsdom tests opt in per-file
        globals: true,
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/typescript/Base/**/*.ts'],
            exclude: ['src/typescript/Base/index.ts'],
        },
        setupFiles: ['tests/setup/jsdom-setup.ts'],
    },
});
```

### `tsconfig.test.json` (new file at project root)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noUnusedLocals": false,
    "noUnusedParameters": false
  },
  "include": ["tests/**/*", "src/**/*"]
}
```

### `package.json` script additions

```json
"test":          "vitest run",
"test:watch":    "vitest",
"test:coverage": "vitest run --coverage"
```

### New `devDependencies`

```
vitest              (^3.x)
@vitest/coverage-v8 (matches vitest major)
jsdom               (pin explicitly)
```

---

## Ordered Implementation Steps

### Step 1 — Install dependencies and scaffold configuration

1. Add `vitest`, `@vitest/coverage-v8`, `jsdom` to `devDependencies`.
2. Create `vitest.config.ts` at project root.
3. Create `tsconfig.test.json` at project root.
4. Add `test`, `test:watch`, `test:coverage` scripts to `package.json`.
5. Create `tests/setup/`, `tests/unit/`, `tests/component/` directories.

### Step 2 — Write pure-logic unit tests (Tier 1)

**`Validator.test.ts` first** — purest function in the codebase, proves toolchain works end-to-end.

**`Field.test.ts`** — default type, mapping, order, description fallback.

**`ModelRecord.test.ts`** — state machine: dirty/clean transitions, commit, reject, isNew, getId.

**`MemoryStore.test.ts`** — highest value:
- `loadData()` populates `getRecords()`
- `getCount()`, `getAt()`, `getById()`
- `find()`, `findAll()` with property/value matching
- `add()` appends, marks as new, fires `add` and `datachanged` events
- `remove()` removes from view; non-new records go into pendingRemoved
- `filter()` hides non-matching; `clearFilter()` restores all
- `filterBy()` with custom predicate
- `sort()` ascending/descending; null values sort to end
- `clearSort()` restores insertion order
- `on()` / `off()` listener registration and removal
- `sync()` with a spy `MemoryProxy`: verifies create/update/destroy call sequencing

**`AjaxProxy.test.ts`** — use `vi.stubGlobal('fetch', ...)` to mock the Fetch API:
- `read()` with a root key; without a root key
- `read()` throws on non-OK response
- `create()` POSTs record data
- `update()` PUTs to `{url}/{id}`
- `destroy()` sends DELETE

### Step 3 — Write jsdom component tests (Tier 2)

Each file starts with `// @vitest-environment jsdom`.

**`jsdom-setup.ts`** — ensures a `<head>` element exists before any `Component` is constructed (jsdom provides this by default but a hook confirms the `<style id="Base">` element is present for `CSS.getStyle`).

**`Component.test.ts`** — tests that don't require layout measurement (jsdom returns 0 for `offsetWidth`):
- UUID-based id format
- `getWidth()` returns 0 before sizing; `setWidth(100)` stores the value
- Default insets (4 on all sides)
- `setInsets()` changes stored values
- `setBackgroundColor()` stores and returns value
- `setVisible(true/false)` and `isVisible()`
- `setVisible("foo")` throws
- `addComponent()` registers child
- `addComponent()` throws if child already has a parent
- `removeComponent()` removes the child

**`HBox.test.ts`** — verifies API without measuring layout (jsdom always returns 0):
- `getComponentSpacing()` defaults to 5; `setComponentSpacing(10)` changes it
- `isStretching()` defaults false; `setStretching(true)` changes it
- `doLayout()` does not throw with an empty container

**`Binding.test.ts`**:
- `bind()` with explicit accessors: `setRecord(record)` pushes field values to the accessor
- Changing the accessor value calls the listener and updates the record's field
- `commit()` commits the record
- `reject()` reverts field values
- `validate()` returns true when all rules pass, false when a rule fails
- `clearValidation()` does not throw

---

## Initial Test Examples

### `tests/unit/validation/Validator.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { applyRule } from '../../../src/typescript/Base/validation/Validator';

describe('applyRule', () => {
    describe('required', () => {
        it('fails on null', () => {
            const r = applyRule({ type: 'required' }, null);
            expect(r.valid).toBe(false);
        });
        it('fails on empty string', () => {
            expect(applyRule({ type: 'required' }, '   ').valid).toBe(false);
        });
        it('passes on a non-empty value', () => {
            expect(applyRule({ type: 'required' }, 'hello').valid).toBe(true);
        });
    });

    describe('minLength', () => {
        it('fails when string is too short', () => {
            expect(applyRule({ type: 'minLength', min: 5 }, 'ab').valid).toBe(false);
        });
        it('passes when string meets minimum', () => {
            expect(applyRule({ type: 'minLength', min: 3 }, 'abc').valid).toBe(true);
        });
    });
});
```

### `tests/unit/data/ModelRecord.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { Model } from '../../../src/typescript/Base/data/Model';
import { ModelRecord } from '../../../src/typescript/Base/data/ModelRecord';

function makeRecord(data: Record<string, any> = {}): ModelRecord {
    const model = new Model([{ name: 'name' }, { name: 'age' }]);
    return new ModelRecord(model, data);
}

describe('ModelRecord', () => {
    it('is not dirty on construction', () => {
        expect(makeRecord({ name: 'Alice' }).isDirty()).toBe(false);
    });
    it('becomes dirty after set() changes a value', () => {
        const r = makeRecord({ name: 'Alice' });
        r.set('name', 'Bob');
        expect(r.isDirty()).toBe(true);
    });
    it('stays clean when set() receives the same value', () => {
        const r = makeRecord({ name: 'Alice' });
        r.set('name', 'Alice');
        expect(r.isDirty()).toBe(false);
    });
    it('commit() clears dirty flag', () => {
        const r = makeRecord({ name: 'Alice' });
        r.set('name', 'Bob');
        r.commit();
        expect(r.isDirty()).toBe(false);
        expect(r.get('name')).toBe('Bob');
    });
    it('reject() reverts to original values', () => {
        const r = makeRecord({ name: 'Alice' });
        r.set('name', 'Bob');
        r.reject();
        expect(r.isDirty()).toBe(false);
        expect(r.get('name')).toBe('Alice');
    });
});
```

### `tests/unit/data/MemoryStore.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { MemoryStore } from '../../../src/typescript/Base/data/MemoryStore';
import { Model } from '../../../src/typescript/Base/data/Model';

const MODEL = new Model([{ name: 'id' }, { name: 'name' }, { name: 'score' }], 'id');
const SAMPLE = [
    { id: 1, name: 'Alice', score: 80 },
    { id: 2, name: 'Bob',   score: 60 },
    { id: 3, name: 'Carol', score: 90 },
];

function makeStore(data: any[] = []) {
    const store = new MemoryStore(MODEL, data);
    store.loadData(data);
    return store;
}

describe('MemoryStore', () => {
    it('loadData populates getRecords()', () => {
        expect(makeStore(SAMPLE).getCount()).toBe(3);
    });
    it('getAt returns the record at the given index', () => {
        expect(makeStore(SAMPLE).getAt(0)?.get('name')).toBe('Alice');
    });
    it('getById finds a record by primary key', () => {
        expect(makeStore(SAMPLE).getById(2)?.get('name')).toBe('Bob');
    });
    it('filter reduces visible records', () => {
        const store = makeStore(SAMPLE);
        store.filter('name', 'Bob');
        expect(store.getCount()).toBe(1);
    });
    it('clearFilter restores all records', () => {
        const store = makeStore(SAMPLE);
        store.filter('name', 'Bob');
        store.clearFilter();
        expect(store.getCount()).toBe(3);
    });
    it('sort ascending orders correctly', () => {
        const store = makeStore(SAMPLE);
        store.sort('score', 'asc');
        expect(store.getAt(0)?.get('score')).toBe(60);
    });
    it('add fires add and datachanged events', () => {
        const store = makeStore([]);
        const addSpy = vi.fn();
        store.on('add', addSpy);
        store.add({ id: 99, name: 'Dave', score: 70 });
        expect(addSpy).toHaveBeenCalledOnce();
        expect(store.getCount()).toBe(1);
    });
    it('off unregisters a listener', () => {
        const store = makeStore([]);
        const spy = vi.fn();
        store.on('datachanged', spy);
        store.off('datachanged', spy);
        store.add({ id: 1, name: 'X', score: 0 });
        expect(spy).not.toHaveBeenCalled();
    });
});
```

---

## Future: Visual Regression Tests

Once the unit and component tiers are established, the natural next step is Playwright-based visual tests:
- Boot the Vite dev server (`vite preview`) and navigate to the demo pages.
- Screenshot and compare against committed baselines.
- Lives under `tests/visual/` with a separate Playwright config.

Deferred until the component API stabilises.

---

## Files to Create / Modify

| Action | File |
|---|---|
| Create | `vitest.config.ts` |
| Create | `tsconfig.test.json` |
| Create | `tests/setup/jsdom-setup.ts` |
| Create | `tests/unit/validation/Validator.test.ts` |
| Create | `tests/unit/data/Field.test.ts` |
| Create | `tests/unit/data/ModelRecord.test.ts` |
| Create | `tests/unit/data/MemoryStore.test.ts` |
| Create | `tests/unit/data/proxy/MemoryProxy.test.ts` |
| Create | `tests/unit/data/proxy/AjaxProxy.test.ts` |
| Create | `tests/unit/Insets.test.ts` |
| Create | `tests/component/Component.test.ts` |
| Create | `tests/component/layout/HBox.test.ts` |
| Create | `tests/component/binding/Binding.test.ts` |
| Modify | `package.json` (add vitest deps + scripts) |

---

## Critical Files

- `/home/jika/typescript/typescript/package.json`
- `/home/jika/typescript/typescript/src/typescript/Base/data/AbstractStore.ts`
- `/home/jika/typescript/typescript/src/typescript/Base/validation/Validator.ts`
- `/home/jika/typescript/typescript/src/typescript/Base/Component.ts`
- `/home/jika/typescript/typescript/src/typescript/Base/CSS.ts`
