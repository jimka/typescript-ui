---
depends-on: [data-record-associations]
---

# Association Lazy Fetch — Implementation Plan

## Overview

The merged [`data-record-associations`](./implemented/data-record-associations.md) feature ships eager hydration (embedded child arrays) and cascade sync (FK stamping) fully working and tested, but the **lazy child-fetch path is configured-but-dead**. [`ModelRecord.buildChildStore`](../src/typescript/lib/data/ModelRecord.ts#L392) builds the parent-scoped child [`Store`](../src/typescript/lib/data/Store.ts#L25) from `association.resolveTarget()`, which returns a bare [`AbstractModel`](../src/typescript/lib/data/AbstractModel.ts) carrying **no proxy**. Only a concrete `Store` holds a proxy — taken from its options bag at [`Store.ts:43`](../src/typescript/lib/data/Store.ts#L43). So the lazily-built child store is created with `proxy: undefined`, and when its parent-FK `remoteFilter` load fires, [`AbstractStore.load()`](../src/typescript/lib/data/AbstractStore.ts#L298) throws `Store.load() called but no proxy is configured` ([AbstractStore.ts:299](../src/typescript/lib/data/AbstractStore.ts#L299)).

This gap shipped because the current lazy test ([Association.test.ts:127-149](../tests/unit/data/Association.test.ts#L127)) asserts the seed filter is merely *present* on the child store (`getActiveFilters()`), then probes a *separately constructed* proxy-backed store — it never calls `child.load()`. This plan makes the lazy path functional by letting an association carry a proxy for its target model, wires that proxy into the child store, and replaces the configuration-only assertions with tests that actually call `load()` and assert the parent-FK filter rode into the proxy `read`.

Work is confined to the data layer: [`Association.ts`](../src/typescript/lib/data/Association.ts), [`ModelRecord.ts`](../src/typescript/lib/data/ModelRecord.ts), the `data` barrel, the association tests, and two curated docs pages. The eager and cascade paths are untouched.

---

## Architecture Decisions

### A direct `proxy?: Proxy` reference, **not** a thunk — there is no declaration cycle to break

The brief asks whether the proxy needs a thunk (`proxy?: () => Proxy`) to mirror the existing `target: () => AbstractModel`. **It does not.** The `target` thunk exists for one reason: `Department`'s `employees` association references the `Employee` model and vice-versa, so a direct `target: EmployeeModel` reference forces a module/initialization cycle (each model file imports the other at evaluation time). A **proxy** has no such mutual reference — a proxy is a plain runtime object constructed independently of any model (`new MemoryProxy({...})`, `new AjaxProxy({...})`), holding no back-reference to the association or the owning model. Referencing it at association-declaration time pulls in `~/data/proxy/Proxy.js`, which imports `ModelRecord` (runtime) but **not** `Association` — so no cycle is created. `Association.ts` itself imports only `~/data/AbstractModel.js` today; adding a *type-only* `import type { Proxy }` keeps `Association.ts`'s runtime import graph unchanged.

Therefore `AssociationOptions` gains a plain `proxy?: Proxy` member. Choosing the thunk would add indirection for a non-problem and diverge from how every other store in the codebase takes its proxy (a direct instance via the options bag). State this rationale in the implementation comment so a future reader doesn't "fix" it into a thunk by analogy with `target`.

### `Association` exposes a memoised `resolveProxy()` getter, mirroring `resolveTarget()`

Per the original plan's descriptor/behaviour split, `Association` stays a passive descriptor exposing pure getters; runtime logic lives in `ModelRecord`. The proxy is descriptor data, so it gets a getter. To stay symmetric with `resolveTarget()` (memoised) — even though a direct reference needs no lazy thunk call — `resolveProxy()` simply returns the stored `proxy` field (or `undefined`). It is named `resolveProxy()` rather than `getProxy()` to parallel `resolveTarget()` and signal "the target model's proxy, resolved for this association," and it is the single point both child-store kinds read. No memoisation machinery is needed (the value is stored verbatim, not produced by a thunk), but the getter name and shape match `resolveTarget()` so the two read identically at the call site.

### One mechanism for both kinds — `buildChildStore` wires `resolveProxy()` into every branch

`buildChildStore` ([ModelRecord.ts:392](../src/typescript/lib/data/ModelRecord.ts#L392)) builds a `Store` in three branches: belongsTo (PK-filtered), hasMany-eager (seed), hasMany-lazy (FK-filtered). The fix threads `proxy: association.resolveProxy()` into the `StoreOptions` bag on **all** branches that construct a loadable store — the belongsTo branch and the hasMany-lazy branch. The eager-seed branch (`store.loadData(seed)`) does not load through a proxy, so wiring one there is harmless but unnecessary; for uniformity and because a consumer may later `load()`/`sync()` an eagerly-seeded store, pass the proxy there too. This is the "one proxy-resolution mechanism for both kinds" the brief requires: belongsTo and hasMany both read `association.resolveProxy()` and both feed the same `StoreOptions.proxy` slot `Store` already understands ([Store.ts:43](../src/typescript/lib/data/Store.ts#L43)).

### The "no parent id" lazy-load guard is a caller contract, not a regression risk

The original plan documents: a brand-new unsynced parent (`parent.getId() === undefined`) has nothing to fetch, so don't auto-load. Crucially, **`buildChildStore` never auto-loads** — it only *configures* `remoteFilter` + the seed filter; the actual `load()` is caller-triggered (the UI, or a test). So no code path auto-fires a load on an idless parent today, and this plan does not add one. When `getId()` is undefined the lazy hasMany branch still sets a filter of `{ type:'eq', field: foreignKey, value: undefined }`; that is inert until a caller chooses to `load()`. The guard therefore holds by construction and is not regressed. The plan documents the contract (call `load()` only once the parent has an id) on `getAssociated` and in `associations.md`, but adds no runtime auto-load and no new guard branch — adding one would be speculative (no caller auto-loads).

### Tests exercise `load()` through a recording proxy, mirroring the existing harness

The existing data tests already use the canonical fake-proxy pattern: subclass [`Proxy`](../src/typescript/lib/data/proxy/Proxy.ts#L44), implement the four CRUD methods, capture `ReadParams` ([Association.test.ts:119](../tests/unit/data/Association.test.ts#L119) `RecordingProxy`, [AbstractStore.load.test.ts:28](../tests/unit/data/AbstractStore.load.test.ts#L28) `RecordingProxy`). The new lazy tests reuse that exact pattern — declare a `proxy` on the association, call `record.getAssociated(accessor).load()`, and assert `proxy.lastParams?.filters` contains the parent-FK `eq` filter. No new mock/reader/writer machinery is invented.

---

## Public API (TypeScript Signatures)

Extended `data/Association.ts` — `AssociationOptions` gains `proxy?`, `Association` gains `resolveProxy()`:

```ts
import type { Proxy } from '~/data/proxy/Proxy.js';   // type-only — no runtime cycle

export interface AssociationOptions {
    accessor:   string;
    target:     () => AbstractModel;
    foreignKey: string;
    nestedKey?: string;
    persist?:   AssociationPersist;
    kind?:      'hasMany' | 'belongsTo';
    /**
     * Proxy used to load (and persist) the target model's records for this
     * association's parent-scoped child store. Required for the lazy fetch path;
     * a direct reference (not a thunk) because a proxy has no declaration cycle.
     */
    proxy?:     Proxy;
}

export abstract class Association {
    // …existing getters…
    /** Returns the proxy for the target model's child store, or undefined. */
    resolveProxy(): Proxy | undefined;
}
```

No change to `HasManyAssociation` / `BelongsToAssociation` (they inherit `resolveProxy()`).

`ModelRecord.buildChildStore` keeps its private signature; only its body changes (threads `proxy: association.resolveProxy()` into each `new Store({ … })` bag). No public `ModelRecord` signature changes.

---

## Internal Structure

### `Association.resolveProxy()` (new getter + backing field)

```ts
private _proxy: Proxy | undefined;

constructor(options: AssociationOptions) {
    // …existing assignments…
    this._proxy = options.proxy;
}

/**
 * Returns the proxy for this association's parent-scoped child store.
 *
 * @returns The configured target-model proxy, or undefined when none was set
 *   (the lazy fetch path then has no transport and load() will throw).
 */
resolveProxy(): Proxy | undefined {
    return this._proxy;
}
```

### `ModelRecord.buildChildStore` (proxy threaded into each loadable branch)

```ts
private buildChildStore(association: Association): AbstractStore {
    const targetModel = association.resolveTarget() as Model;
    const proxy       = association.resolveProxy();

    if (association.kind === 'belongsTo') {
        const pkName = targetModel.getPrimaryKeyField()?.getName() ?? association.getForeignKey();

        return new Store({
            model: targetModel,
            proxy,
            remoteFilter: true,
            filters: [{ type: 'eq', field: pkName, value: this.get(association.getForeignKey()) }],
        });
    }

    const seed = this._associatedSeed[association.getAccessor()];

    if (seed) {
        const store = new Store({ model: targetModel, proxy });

        store.loadData(seed);

        return store;
    }

    return new Store({
        model: targetModel,
        proxy,
        remoteFilter: true,
        filters: [{ type: 'eq', field: association.getForeignKey(), value: this.getId() }],
    });
}
```

Only `proxy` is added per branch; the FK/PK filter logic is unchanged.

---

## Ordered Implementation Steps

1. **`data/Association.ts`** — add `import type { Proxy } from '~/data/proxy/Proxy.js';`, add `proxy?: Proxy` to `AssociationOptions` (with the no-thunk rationale comment + JSDoc), add `private _proxy: Proxy | undefined;`, assign it in the constructor from `options.proxy`, add the `resolveProxy(): Proxy | undefined` getter with full JSDoc. → verify: `npx tsc --noEmit` clean; `Association.ts`'s only runtime import is still `AbstractModel`.
2. **`data/ModelRecord.ts`** — in `buildChildStore`, read `const proxy = association.resolveProxy();` once and thread `proxy` into all three `new Store({ … })` option bags. No other change. → verify: `npx tsc --noEmit` clean.
3. **`tests/unit/data/Association.test.ts`** — replace the configuration-only `lazy load` describe block ([L127-149](../tests/unit/data/Association.test.ts#L127)) with tests that (a) wire a `RecordingProxy` onto the hasMany association, call `dept.getAssociated('emps').load()`, and assert `proxy.lastParams?.filters` equals `[{ type:'eq', field:'deptId', value: 7 }]`; (b) wire a proxy onto a belongsTo association, call `getAssociated('department').load()`, and assert `lastParams?.filters` equals `[{ type:'eq', field:'id', value: 42 }]` (FK points at the target PK). Keep the existing `getActiveFilters()` assertion as a cheap pre-check if useful. Reuse the in-file `RecordingProxy` class — do not invent a new harness. → verify: `npm test tests/unit/data/Association.test.ts` green; the load tests fail if the proxy is dropped (sanity-check by temporarily removing the wiring).
4. **Docs** — update `docs/data/associations.md` (lazy-fetch section: declare a `proxy` on the association, call `getAssociated().load()`, the parent-id contract) and `docs/data/record.md` (`getAssociated` note that lazy load requires a proxy and a synced parent). See Documentation Impact. → verify: `npm run docs:build` 0 errors / 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/data/Association.ts` (`AssociationOptions.proxy`, `resolveProxy()`) |
| Modify | `src/typescript/lib/data/ModelRecord.ts` (`buildChildStore` threads the proxy) |
| Modify | `tests/unit/data/Association.test.ts` (lazy `load()` tests replace config-only assertions) |
| Modify | `docs/data/associations.md` (lazy fetch with a proxy) |
| Modify | `docs/data/record.md` (`getAssociated` lazy-load note) |

No barrel change is needed: `Proxy` and the `Association` classes are already exported from `src/typescript/lib/data/index.ts` ([index.ts:10,25](../src/typescript/lib/data/index.ts#L10)); `AssociationOptions` is re-exported as a type, so its new `proxy?` member surfaces automatically.

---

## Verification

- **Typecheck:** `npx tsc --noEmit` — 0 errors. Confirm `Association.ts` gained only a `import type` (erased) edge to `Proxy`, so no runtime cycle (`grep -n "from '~/data/proxy/Proxy" src/typescript/lib/data/Association.ts` shows `import type`).
- **Unit tests:** `npm test tests/unit/data/Association.test.ts` —
  - **Lazy hasMany:** `dept.getAssociated('emps').load()` resolves and the recording proxy's `read` saw `filters: [{ type:'eq', field:'deptId', value:<parentId> }]`.
  - **Lazy belongsTo:** `emp.getAssociated('department').load()` resolves and the proxy saw `filters: [{ type:'eq', field:'id', value:<fkValue> }]`.
  - **No-proxy still throws:** an association with no `proxy` → `getAssociated(...).load()` rejects with `no proxy is configured` (documents the requirement, proves the wiring is load-bearing).
  - **Eager/cascade untouched:** the existing eager-hydration, cache-identity, cascade-FK-stamp, `cascadeSync:false`, and `getDataWithNested` tests still pass unchanged.
- **Guard intact:** a brand-new unsynced parent's lazy child store is built but **not** auto-loaded (no `load()` is called by `getAssociated`); confirm no test or runtime path auto-loads on `getId() === undefined`.
- **Docs:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

- **Barrel:** no new exports. `AssociationOptions.proxy` and `Association.resolveProxy()` are additions to already-exported symbols (`Association`, `HasManyAssociation`, `BelongsToAssociation`, `type AssociationOptions`) in the `data` subpath barrel `src/typescript/lib/data/index.ts` — there is no root barrel. `Proxy` is already exported there too.
- **Curated pages:** `docs/data/associations.md` (created by the original plan) gains a lazy-fetch subsection — declare a `proxy` on the association, the child store loads through it on `getAssociated(accessor).load()` with the parent-FK filter, and the parent-must-be-synced contract. `docs/data/record.md` notes on `getAssociated` that the lazy path needs a target-model proxy and a parent with an id. No `index.md` catalog or sidebar (`docs/.vitepress/config.mts`) change — both pages already exist and are linked.
- **Cross-bucket JSDoc:** `Proxy`, `Association`, `Store` are all in the `data` bucket, so `{@link Proxy}` in the new `resolveProxy()` / `AssociationOptions.proxy` JSDoc resolves without markdown-link form.

---

## Potential Challenges

- **A future reader "fixes" `proxy?` into a thunk by analogy with `target`.** Mitigation: the implementation comment on `proxy?` states explicitly that a proxy carries no declaration cycle, so a direct reference is correct.
- **Type-only import mistaken for a runtime edge.** Mitigation: use `import type { Proxy }` (not `import { Proxy }`) in `Association.ts`; verify it stays erased (`grep` for `import type`).
- **Eager-seed branch with a proxy could be read as "now it loads twice."** Mitigation: the seed branch calls `loadData(seed)` and never `load()`; the proxy there is inert unless the consumer explicitly loads/syncs. Note this in the branch comment.

---

## Critical Files

- [`src/typescript/lib/data/Association.ts`](../src/typescript/lib/data/Association.ts) — the descriptor gaining `proxy?` + `resolveProxy()`; mirror `resolveTarget()`.
- [`src/typescript/lib/data/ModelRecord.ts`](../src/typescript/lib/data/ModelRecord.ts#L392) — `buildChildStore`, the only behaviour change.
- [`src/typescript/lib/data/Store.ts`](../src/typescript/lib/data/Store.ts#L43) — how `StoreOptions.proxy` is consumed from the bag (`this.proxy = modelOrOptions.proxy`).
- [`src/typescript/lib/data/AbstractStore.ts`](../src/typescript/lib/data/AbstractStore.ts#L298) — `load()` (the throw at L299 this fixes) and `buildReadParams` (L356, serialises `remoteFilter` filters into `ReadParams`).
- [`src/typescript/lib/data/proxy/Proxy.ts`](../src/typescript/lib/data/proxy/Proxy.ts#L44) — the base class tests subclass; `ReadParams.filters`.
- [`tests/unit/data/Association.test.ts`](../tests/unit/data/Association.test.ts#L119) — the `RecordingProxy` harness to reuse; the config-only lazy block (L127) to replace.

---

## Non-Goals

- **Touching the eager or cascade paths** — they work and are tested; this plan only enables lazy fetch.
- **New association kinds (many-to-many / through)** — out, per the original plan.
- **New proxy/reader/writer classes** — reuse the existing `data-proxy-reader-writer` machinery; tests use the existing fake-proxy pattern.
- **A runtime auto-load on `getAssociated`** — load stays caller-triggered; the "no parent id" guard is a documented contract, not new branching.
- **A proxy thunk** — rejected; a proxy has no declaration cycle, so a direct `proxy?: Proxy` reference is used.
