# Test Suite — Implementation Plan

## Overview

A layered test suite for the UI framework split into two tiers: **pure-logic unit tests** (no DOM, run in Node) and **component integration tests** (DOM required, run in jsdom). Both tiers share one Vitest runner and one `tsconfig`, keeping the toolchain minimal and coherent with the existing Vite build.

All framework source lives under [`src/typescript/lib/`](../src/typescript/lib) (subdirs `core/`, `data/`, `validation/`, `primitive/`, `layout/`, `component/`, `glyphs/`) and is imported throughout the codebase via the `~` alias (`~` → `src/typescript/lib`) and the `@jimka/typescript-ui/*` subpath aliases declared in [vite.config.ts:8-26](../vite.config.ts#L8). The suite reuses that resolution so tests import the same way source does.

---

## Architecture Decisions

### Vitest, configured by merging the existing Vite config

**Vitest** is the correct runner. The project already depends on Vite 8.x ([package.json:116](../package.json#L116)), and Vitest reuses Vite's module resolution, the project `tsconfig.json` compiler options (`ESNext`, `moduleResolution: "bundler"`, `strict`), and — critically — the `resolve.alias` block. The `.js` extension on every internal import (e.g. `~/validation/ValidationRule.js`) resolves natively under Vitest's bundler resolution but needs manual resolver config in Jest.

The aliases are **not** inherited automatically: Vitest loads `vitest.config.ts` *instead of* `vite.config.ts`, so a standalone config would drop every `~`/`@jimka` alias and break all source imports (even the "purest" `Validator.ts` transitively imports `~/validation/...`). The config therefore **merges** the production Vite config via `mergeConfig(viteConfig, …)` so `resolve.alias` carries over.

Rejected alternatives:
- **Jest** — needs Babel or ts-jest for ESNext; `moduleResolution: "bundler"` not natively supported.
- **Playwright/Cypress** — end-to-end against a running dev server; out of initial scope (see Non-Goals).
- **Karma + Jasmine** — legacy browser-test approach, poor TS integration.

### Two-tier environment split — Node default, jsdom opt-in

Pure-logic files run in the default **node** environment (faster, no DOM cost). Component files opt into **jsdom** with a per-file `// @vitest-environment jsdom` annotation, so jsdom loads only where needed.

### jsdom now; the modelled DOM seam later

The DOM-seam plan [`dom-sink-source.md`](dom-sink-source.md) declares `depends-on: [test-suite]`, so **this suite cannot assume the seam exists** — it must stand alone. Component tests use jsdom for the DOM dependency today. When the seam lands, Tier-2 tests can migrate from jsdom to the modelled `DOMSource` for real offline geometry; that migration is explicitly that plan's Stage 2, not this one.

### Tests import the concrete module via the `~` alias, not the callable barrels

A unit test targets the module under test directly (`~/validation/Validator`, `~/data/MemoryStore`) rather than the public per-subpath barrel, so internals can be exercised without the callable/options-bag construction idiom that `CODE_CONVENTIONS.md` mandates for *production* call sites. Constructing instances directly in a test is deliberate and not a convention violation.

### Construction is JS-only; jsdom is needed only at render/layout time

Per `CODE_CONVENTIONS.md`, `Component` construction touches no DOM — `document.createElement` runs in `createFrame`/`getElement(true)` ([Component.ts:734](../src/typescript/lib/core/Component.ts#L734), [Component.ts:4505](../src/typescript/lib/core/Component.ts#L4505)) and the shared `<style id="Base">` sheet is created lazily by `StyleTarget` ([StyleTarget.ts:162-183](../src/typescript/lib/core/StyleTarget.ts#L162)). Component tests thus need jsdom only when they call `getElement()`/`doLayout()`, not merely to construct.

---

## Architecture: What Needs DOM vs. What Does Not

### Tier 1 — Pure Logic (Node environment, no jsdom)

| File | Why it qualifies |
|---|---|
| [`data/Field.ts`](../src/typescript/lib/data/Field.ts) | Plain value object |
| [`data/AbstractModel.ts`](../src/typescript/lib/data/AbstractModel.ts) / [`data/Model.ts`](../src/typescript/lib/data/Model.ts) | Field indexing, `createRecord` — pure data transformation |
| [`data/ModelRecord.ts`](../src/typescript/lib/data/ModelRecord.ts) | State machine for dirty/new/commit/reject — pure |
| [`data/MemoryStore.ts`](../src/typescript/lib/data/MemoryStore.ts) (via [`data/AbstractStore.ts`](../src/typescript/lib/data/AbstractStore.ts)) | Filter, sort, CRUD, event dispatch — pure. `MemoryProxy` uses only `Promise.resolve`. |
| [`data/proxy/MemoryProxy.ts`](../src/typescript/lib/data/proxy/MemoryProxy.ts) | In-memory array; no DOM |
| [`validation/Validator.ts`](../src/typescript/lib/validation/Validator.ts) | Pure function `applyRule` — ideal first test target |
| [`primitive/Insets.ts`](../src/typescript/lib/primitive/Insets.ts) | Pure value object |

### Tier 2 — DOM Required (jsdom environment)

| File | DOM dependency |
|---|---|
| [`core/Component.ts`](../src/typescript/lib/core/Component.ts) | `render()`/`getElement(true)` call `document.createElement` ([734](../src/typescript/lib/core/Component.ts#L734)/[4505](../src/typescript/lib/core/Component.ts#L4505)); first style write lazily creates `<style id="Base">` in [`core/StyleTarget.ts:162`](../src/typescript/lib/core/StyleTarget.ts#L162) |
| All layout managers ([`layout/`](../src/typescript/lib/layout)) | `doLayout()` reads element sizes off the DOM node |
| [`core/Event.ts`](../src/typescript/lib/core/Event.ts) | `window`/element `addEventListener` |
| [`core/Binding.ts`](../src/typescript/lib/core/Binding.ts) | Wires `FieldDecorator` ([`validation/FieldDecorator.ts`](../src/typescript/lib/validation/FieldDecorator.ts)) onto `Component`s |

---

## File Structure

```
/home/jika/typescript/typescript/
├── vitest.config.ts                        ← new
├── tsconfig.test.json                      ← new
└── tests/
    ├── setup/
    │   └── jsdom-setup.ts                  ← jsdom global polyfills, node-guarded
    ├── unit/                               ← Tier 1: Node env
    │   ├── data/
    │   │   ├── Field.test.ts
    │   │   ├── ModelRecord.test.ts
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
        │   └── HBox.test.ts
        └── binding/
            └── Binding.test.ts
```

---

## Build / Config Changes

### `vitest.config.ts` (new file at project root)

```typescript
import { mergeConfig, defineConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Merge the production Vite config so tests inherit `resolve.alias`
// (`~` → src/typescript/lib plus the `@jimka/typescript-ui/*` subpath aliases
// in vite.config.ts:8-26). Without this merge a standalone Vitest config
// resolves none of the `~/...` imports every source file uses.
export default mergeConfig(viteConfig, defineConfig({
    test: {
        environment: 'node',              // default; component tests opt in via `// @vitest-environment jsdom`
        globals: true,
        include: ['tests/**/*.test.ts'],
        setupFiles: ['tests/setup/jsdom-setup.ts'],   // self-guards to a no-op under the node env
        coverage: {
            provider: 'v8',
            include: ['src/typescript/lib/**/*.ts'],
            exclude: ['src/typescript/lib/**/index.ts', 'src/typescript/lib/glyphs/**'],
        },
    },
}));
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

This governs `tsc` type-checking of the test tree only; runtime module resolution is handled by the merged Vite aliases above, not by this file.

### `package.json` script additions

The existing `test:lint` script ([package.json:102](../package.json#L102)) runs the ESLint-rule `.test.mjs` checks and is unrelated; the new scripts are additive and do not collide. `test` runs the Vitest suite only (it intentionally does **not** chain `test:lint`).

```json
"test":          "vitest run",
"test:watch":    "vitest",
"test:coverage": "vitest run --coverage"
```

### New `devDependencies`

```
vitest              (latest stable compatible with Vite 8 — verify at install; Vite 8 needs a recent Vitest)
@vitest/coverage-v8 (must match the resolved vitest major/minor)
jsdom               (pin explicitly)
```

---

## Ordered Implementation Steps

### Step 1 — Install dependencies and scaffold configuration

1. Add `vitest`, `@vitest/coverage-v8`, `jsdom` to `devDependencies` (pick a `vitest` version that supports Vite 8 — check at install time).
2. Create `vitest.config.ts` at project root (merging `vite.config.ts` per above).
3. Create `tsconfig.test.json` at project root.
4. Add `test`, `test:watch`, `test:coverage` scripts to `package.json`.
5. Create `tests/setup/`, `tests/unit/`, `tests/component/` directories.
6. → verify: `npx vitest run` discovers zero tests without error (toolchain boots; aliases resolve).

### Step 2 — Write pure-logic unit tests (Tier 1)

**`Validator.test.ts` first** — purest function in the codebase; proves the toolchain (alias resolution + `.js` imports) works end-to-end.

**`Field.test.ts`** — default type, mapping, order, description fallback.

**`ModelRecord.test.ts`** — state machine: dirty/clean transitions, commit, reject, isNew, getId.

**`MemoryStore.test.ts`** — highest value. Note the **view-mutating methods `filter()`, `clearFilter()`, `sort()`, `clearSort()` return `Promise<void>`** ([AbstractStore.ts:669-795](../src/typescript/lib/data/AbstractStore.ts#L669)) and must be `await`ed before asserting; `loadData()`, `getCount()`, `getAt()`, `getById()`, `on()`/`off()` are synchronous.
- `loadData()` populates `getRecords()`
- `getCount()`, `getAt()`, `getById()`
- `find()`, `findAll()` with property/value matching
- `add()` appends, marks as new, fires `add` and `datachanged` events
- `remove()` removes from view; non-new records go into pendingRemoved
- `await filter()` hides non-matching; `await clearFilter()` restores all
- `await sort()` ascending/descending; null values sort to end; `await clearSort()` restores insertion order
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

**`jsdom-setup.ts`** — a global setup file that stubs the DOM globals jsdom omits but components may touch (e.g. `ResizeObserver`, `matchMedia`). It is **node-guarded** (`if (typeof window === 'undefined') return;`) so it is a harmless no-op for Tier-1 files running in the node environment. No special `<style id="Base">` bootstrap is needed — `StyleTarget` creates that sheet lazily on first write.

**`Component.test.ts`** — tests that don't require layout measurement (jsdom returns 0 for `offsetWidth`):
- UUID-based id format
- `getWidth()` returns 0 before sizing; `setWidth(100)` stores the value
- Default insets are `(0, 0, 0, 0)` ([Component.ts:344](../src/typescript/lib/core/Component.ts#L344))
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
import { applyRule } from '~/validation/Validator';

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
import { Model } from '~/data/Model';
import { ModelRecord } from '~/data/ModelRecord';

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
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';

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
    it('filter reduces visible records', async () => {
        const store = makeStore(SAMPLE);
        await store.filter('name', 'Bob');
        expect(store.getCount()).toBe(1);
    });
    it('clearFilter restores all records', async () => {
        const store = makeStore(SAMPLE);
        await store.filter('name', 'Bob');
        await store.clearFilter();
        expect(store.getCount()).toBe(3);
    });
    it('sort ascending orders correctly', async () => {
        const store = makeStore(SAMPLE);
        await store.sort('score', 'asc');
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

## Verification

- `npm test` (`vitest run`) — all tests green; the node tier and the jsdom tier both run.
- `npx tsc -p tsconfig.test.json --noEmit` — clean (test tree type-checks against the source).
- `npm run test:coverage` — reports non-empty coverage over `src/typescript/lib/**` (confirms the coverage globs resolve to real files).
- `npm run test:lint` — the pre-existing ESLint-rule tests still pass (the new `test` script is additive, not a replacement).
- A deliberately failing assertion fails the run (confirms the runner reports, not silently passes).

---

## Potential Challenges

- **jsdom omits layout + observers** — `offsetWidth`/`getBoundingClientRect` return 0 and `ResizeObserver`/`matchMedia` are absent; mitigation: stub the missing globals in `jsdom-setup.ts` and keep Tier-2 assertions on stored API state, not measured geometry (real geometry is the DOM-seam plan's job).
- **Async store methods** — `filter`/`clearFilter`/`sort`/`clearSort` return `Promise<void>`; mitigation: `await` them in tests (they resolve synchronously today, so a missing `await` can pass by accident and rot later).
- **Vitest ↔ Vite 8 version pairing** — Vite 8 is recent; mitigation: select a Vitest version that lists Vite 8 support at install time rather than pinning blind.
- **`setupFiles` runs in every environment** — a jsdom-oriented setup file also executes for node-tier files; mitigation: the node-guard (`typeof window`) keeps it a no-op there.

---

## Critical Files

- [`package.json`](../package.json) — existing `vite`/script setup; `test:lint` at [102](../package.json#L102).
- [`vite.config.ts`](../vite.config.ts) — the `resolve.alias` block ([8-26](../vite.config.ts#L8)) the Vitest config merges to inherit `~`/`@jimka` resolution.
- [`tsconfig.json`](../tsconfig.json) — base compiler options `tsconfig.test.json` extends.
- [`src/typescript/lib/data/AbstractStore.ts`](../src/typescript/lib/data/AbstractStore.ts) — async `filter`/`sort`/`clearFilter`/`clearSort` ([669-795](../src/typescript/lib/data/AbstractStore.ts#L669)); sync `loadData`/`getCount`/`getAt`/`getById`.
- [`src/typescript/lib/validation/Validator.ts`](../src/typescript/lib/validation/Validator.ts) — `applyRule(rule, value): FieldValidationResult` ([16](../src/typescript/lib/validation/Validator.ts#L16)).
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — default insets ([344](../src/typescript/lib/core/Component.ts#L344)); DOM only at render/getElement ([734](../src/typescript/lib/core/Component.ts#L734)/[4505](../src/typescript/lib/core/Component.ts#L4505)).
- [`src/typescript/lib/core/StyleTarget.ts`](../src/typescript/lib/core/StyleTarget.ts) — lazy shared `<style id="Base">` ([162-183](../src/typescript/lib/core/StyleTarget.ts#L162)).
- [`src/typescript/lib/core/Binding.ts`](../src/typescript/lib/core/Binding.ts) — binding wiring exercised by `Binding.test.ts`.

---

## Non-Goals

- **Visual regression tests** — Playwright-based screenshot diffing against the demo pages (would live under `tests/visual/` with a separate config) is deferred until the component API stabilises; out of scope here.
- **Layout-measurement assertions** — jsdom returns 0 for all geometry, so pixel/position assertions are not attempted; real offline geometry is delivered by [`dom-sink-source.md`](dom-sink-source.md), not this plan.
- **Replacing jsdom with the modelled `DOMSource`** — migrating Tier-2 off jsdom onto the DOM seam is that plan's Stage 2, which `depends-on` this suite.
- **End-to-end / dev-server tests** — no booting of `vite preview`; unit + component tiers only.
