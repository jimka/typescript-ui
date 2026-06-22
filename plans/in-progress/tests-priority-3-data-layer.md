# Priority 3 — Data-layer gaps — Implementation Plan

## Overview

This is a **test-authoring** plan. It adds Vitest unit tests for the data-layer modules under [`src/typescript/lib/data/`](../src/typescript/lib/data/) that currently have no dedicated test file, in an area whose adjacent modules (`AbstractStore`, `MemoryStore`, `TreeStore`, `Association`, `Field`, `ModelRecord`, the three proxies) are already well covered under [`tests/unit/data/`](../tests/unit/data/).

Target modules: `AjaxStore.ts`, `AbstractModel.ts`, `Model.ts`, `Store.ts`, `TreeNode.ts`, `StoreWorker.ts`, `StoreWorkerClient.ts`, `proxy/Proxy.ts`.

A core finding shaped this plan: **several targets are thin and are already exercised indirectly, so they warrant only a small amount of focused new coverage, not a full mirror suite.** The investigation below maps each target to what it actually contributes beyond its already-tested collaborators, and the per-module sections call out exactly where redundant tests would be wasteful. All new tests run under the default `node` environment (no `// @vitest-environment jsdom` line), matching every existing data test.

---

## Architecture Decisions

### Tests assert the contract, not the current output

This is the governing rule for the whole plan and is spelled out in full in **## Test methodology — assert specified behaviour** below. Every assertion must be derived from the module's documented contract (JSDoc, signatures, how it composes with the already-tested classes) **before** looking at runtime output. Where observed behaviour diverges from the derived expectation, the implementer **stops and surfaces the discrepancy** rather than conforming the test to the code.

### Match the existing data-test conventions exactly

All existing data tests share a tight house style; new files must mirror it:

- `import { describe, it, expect, vi } from 'vitest'` (add `afterEach`/`beforeEach` only when stubbing globals).
- `~/...` alias imports for source (`~/data/Model`, `~/data/proxy/Proxy`), never relative paths into `src/`.
- A module-level `const MODEL = new Model([{ name: 'id' }, { name: 'name' }], 'id')` fixture and a `SAMPLE`/`FLAT` data array, plus a small `makeStore()` helper when a setup is repeated. See [`MemoryStore.test.ts:5`](../tests/unit/data/MemoryStore.test.ts#L5) and [`TreeStore.test.ts:7`](../tests/unit/data/TreeStore.test.ts#L7).
- Network/storage are faked with `vi.stubGlobal('fetch', …)` / a hand-rolled `Storage` object and torn down with `vi.unstubAllGlobals()` in `afterEach` — see [`AjaxProxy.test.ts:15`](../tests/unit/data/proxy/AjaxProxy.test.ts#L15) and [`WebStorageProxy.test.ts:11`](../tests/unit/data/proxy/WebStorageProxy.test.ts#L11).
- Custom `Proxy` subclasses (`DeferredProxy`, `RecordingProxy`, `StubProxy`) are declared inline at the top of the file to drive store behaviour deterministically — see [`AbstractStore.load.test.ts:13`](../tests/unit/data/AbstractStore.load.test.ts#L13) and [`TreeStore.test.ts:124`](../tests/unit/data/TreeStore.test.ts#L124).
- One behaviour per `it`, short title in present tense.

### One file per target, only where the target adds testable surface

New files: `Model.test.ts` (covers `Model` **and** `AbstractModel`, since `Model` is the canonical concrete subclass), `Store.test.ts`, `AjaxStore.test.ts`, `TreeNode.test.ts`, `StoreWorkerClient.test.ts`, `proxy/Proxy.test.ts`. **No** standalone `AbstractModel.test.ts` (tested through `Model`) and **no** `StoreWorker.test.ts` (see its section — its logic is not feasibly testable in isolation and its pure helpers are owned elsewhere).

### Node environment; worker is absent by design

Confirmed empirically in this worktree: under the default `node` env, `typeof Worker === 'undefined'` and `StoreWorkerClient.isAvailable()` returns `false`. `AbstractStore.ts` statically imports `StoreWorkerClient`, which imports `~/data/StoreWorker.js?worker`; this import resolves cleanly under Vitest (the existing node-env data tests already prove this). So the `StoreWorkerClient` **fallback** path is directly testable under node, while its happy path needs a faked `Worker` global (details in that section).

---

## Test methodology — assert specified behaviour

**The new tests must assert the EXPECTED / specified behaviour — NOT merely lock in whatever the current implementation emits.** For every module, the implementer must:

1. **Derive expected behaviour from the contract first.** Read the JSDoc, the method signatures, and how the class composes with its already-tested collaborators (`AbstractStore`, `Proxy`, `ModelRecord`, `TreeStore`). Write down the expected result *before* running the code. The contract — not the implementation — is the oracle.
2. **Assert against that derived expectation.** The `expect(...)` value is the number/shape/sequence the contract says should happen, not a value copy-pasted from a first test run.
3. **On divergence, STOP and investigate.** If observed output disagrees with the derived expectation, do not silently rewrite the assertion to make it green. Determine whether the bug is in the expectation or in the code:
   - If the expectation was wrong, fix the expectation and add a one-line comment explaining the contract point that corrected it.
   - If the code looks wrong, **surface it to the user**: leave the test asserting the *correct* expected value and mark it `it.fails(...)` (or `it.todo` with a comment) plus a `// FIXME(plan): <module> — observed X, contract says Y` comment, and flag it in the implementation report. Never conform the assertion to buggy output to get a green run.

This rule is repeated per module below as a concrete "expected-behaviour oracle" so the implementer never loses the thread.

---

## Per-module test specifications

### `Model.ts` + `AbstractModel.ts` → `tests/unit/data/Model.test.ts`

**Relationship.** `Model` ([`Model.ts:24`](../src/typescript/lib/data/Model.ts#L24)) is a thin concrete subclass of the abstract `AbstractModel` ([`AbstractModel.ts:17`](../src/typescript/lib/data/AbstractModel.ts#L17)). `Model`'s only logic is its dual constructor: array-or-options-bag, assigning `fields`, `_primaryKey`, and `associations`. Every behavioural method (`getFields`, `getField`, `hasField`, `getPrimaryKeyField`, `getAssociations`, `getAssociation`, `createRecord`, the lazy `ensureIndex`, `promoteAssociation`, `assertNestedKeyFree`) lives on `AbstractModel`. `Model` is already used as the fixture in nearly every data test, so its array-form constructor is implicitly exercised — but `AbstractModel`'s own methods have **no direct assertions** and the options-bag constructor path is untested. Test `AbstractModel` *through* `Model` (the canonical concrete subclass); a separate abstract-only file would be redundant.

**Expected-behaviour oracle.** Derive from `AbstractModel` JSDoc: fields are resolved lazily and cached; `FieldOptions` are promoted to `Field`; lookups are name-keyed; `createRecord` maps by `field.getMapping()`, falls back to `getDefaultValue()`, supports positional arrays ordered by `getOrder()`, and seeds `hasMany` child arrays from the nested key.

**Behaviours / edge cases to cover (grounded in source):**

- **Constructor — array form:** `new Model([{name:'id'},{name:'name'}], 'id')` → `getFields()` returns two `Field` instances, `getPrimaryKeyField()?.getName()` is `'id'`. (`Model.ts:37`.)
- **Constructor — options-bag form:** `new Model({ fields:[…], primaryKey:'id', associations:[…] })` assigns all three; `getPrimaryKeyField()` and `getAssociations()` reflect the bag. This path is otherwise untested. (`Model.ts:40-44`.)
- **`getPrimaryKeyField()` with no primary key** → `undefined` (the early-return at `AbstractModel.ts:112`); contrast with a configured key.
- **`getField` / `hasField`:** present name returns the `Field`; absent name returns `undefined` / `false`. (`AbstractModel.ts:137,150`.)
- **`FieldOptions` promotion + caching:** pass plain config objects; assert `getFields()[0]` is `instanceof Field`, and that two successive `getFields()` calls return the **same array reference** (lazy cache at `AbstractModel.ts:49`). Asserting referential identity is the contract for the cache; do not weaken it to a deep-equal.
- **`createRecord` — object form:** mapping applied, missing fields take `getDefaultValue()`. Use a field with a `mapping` and a field with a `defaultValue` to prove both branches at `AbstractModel.ts:211-216`.
- **`createRecord` — array form:** values assigned by `getOrder()` ordering, not array index, when a field declares an out-of-sequence `order`. (`AbstractModel.ts:198-204`.) This is a sharp edge — derive the expectation from the `order` sort, not from naive positional assignment.
- **`createRecord` — hasMany seed:** with a `hasMany` association whose `nestedKey` holds an array, the seeded child data reaches the record. Assert via the record's associated-store surface used in [`Association.test.ts`](../tests/unit/data/Association.test.ts) (mirror its access pattern; do not invent an API). (`AbstractModel.ts:218-226`.)
- **`assertNestedKeyFree` collision:** a `hasMany` association whose `nestedKey` equals a field's `mapping` must throw with the message at `AbstractModel.ts:101` on first index build (i.e. on the first method call that triggers `ensureIndex`). Assert the throw and the message substring.
- **`promoteAssociation` discriminant:** options with `kind:'belongsTo'` vs `kind:'hasMany'` produce `BelongsToAssociation` / `HasManyAssociation` instances via `getAssociations()`. (`AbstractModel.ts:79-86`.) Cross-check against `Association.test.ts` so the assertion style matches.

**Avoid redundancy:** do not re-test `Field` conversion/defaults in depth — [`Field.test.ts`](../tests/unit/data/Field.test.ts) owns that; here only assert the *model-level* wiring (promotion, mapping, ordering, seeding).

---

### `Store.ts` → `tests/unit/data/Store.test.ts`

**Relationship.** `Store` ([`Store.ts:25`](../src/typescript/lib/data/Store.ts#L25)) is the general-purpose concrete `AbstractStore` pairing a `Model` with an **optional** `Proxy`. It is already the vehicle used by [`AbstractStore.load.test.ts`](../tests/unit/data/AbstractStore.load.test.ts) and [`AbstractStore.sync.test.ts`](../tests/unit/data/AbstractStore.sync.test.ts), so its store *behaviour* is heavily exercised. What is **not** directly asserted is `Store`'s own contribution: the dual constructor and the `applyOptions` forwarding when constructed from a bag.

**Expected-behaviour oracle.** From `Store`/`AbstractStore` JSDoc: positional `(model, proxy?)` assigns directly; the options-bag form pulls `model`/`proxy` from the bag and then calls `applyOptions` ([`AbstractStore.ts:229`](../src/typescript/lib/data/AbstractStore.ts#L229)) so pagination/sort/filter/listener defaults take effect.

**Behaviours / edge cases:**

- **Positional constructor:** `new Store(MODEL)` → `store.model === MODEL`, `store.proxy === undefined`. `new Store(MODEL, proxy)` → `store.proxy === proxy`. (`Store.ts:39-41`.)
- **Options-bag constructor wires `model`/`proxy`:** `new Store({ model, proxy })` assigns both. (`Store.ts:43-46`.)
- **`applyOptions` forwarding is the load-bearing new coverage:** construct with a bag carrying `listeners`, `pageSize`, `sorters`, `filters`, then assert the option took effect through the *public* surface, deriving each expectation from `applyOptions` (`AbstractStore.ts:229-255`):
  - `listeners: { datachanged: spy }` → spy registered before any autoLoad fires (order matters per the JSDoc at `AbstractStore.ts:225`).
  - `autoLoad: true` with a `RecordingProxy` (copy the helper from `AbstractStore.load.test.ts`) → exactly one `read()` at construction, and the pre-registered `'load'` listener fires. Derive "autoLoad triggers a load after listeners are registered" from the JSDoc, then assert it.
  - `pageSize: n` → first `read()` params carry `page: 1` (mirror the paginated assertion in [`AbstractStore.load.test.ts:104`](../tests/unit/data/AbstractStore.load.test.ts#L104)).
- **Proxy-less store guard:** with `new Store(MODEL)` (no proxy), calling an operation that needs the proxy (`load()` / `sync()`) — derive the expected behaviour from `AbstractStore`'s handling of an undefined proxy (read the relevant guard in `AbstractStore.ts` before asserting; do **not** assume it throws vs no-ops — investigate and assert whatever the contract specifies, flagging if undocumented).

**Avoid redundancy:** do **not** re-test load concurrency, remote sort/filter, or sync CRUD here — those are fully owned by the two `AbstractStore.*` test files. `Store.test.ts` is strictly about the subclass constructor + `applyOptions` plumbing.

---

### `AjaxStore.ts` → `tests/unit/data/AjaxStore.test.ts`

**Relationship.** `AjaxStore` ([`AjaxStore.ts:23`](../src/typescript/lib/data/AjaxStore.ts#L23)) is a convenience `AbstractStore` subclass that **constructs an `AjaxProxy` from an `AjaxProxyOptions` bag** so callers don't wire store + proxy separately. `AjaxProxy`'s HTTP behaviour is fully covered by [`AjaxProxy.test.ts`](../tests/unit/data/proxy/AjaxProxy.test.ts). `AjaxStore`'s own surface is: the dual constructor, the **required-proxy-options guard**, internal `AjaxProxy` construction, and `applyOptions` forwarding in the bag form.

**Expected-behaviour oracle.** From the constructor JSDoc (`AjaxStore.ts:28-33`): a `Model` first-arg **requires** `proxyOptions` and throws without it; an options-bag first-arg reads `model`/`proxy` from the bag and applies options. The store ends up with a real `AjaxProxy` instance built from the supplied URL/HTTP options.

**Behaviours / edge cases:**

- **Positional `(model, proxyOptions)`:** `new AjaxStore(MODEL, { url:'/api/users' })` → `store.proxy instanceof AjaxProxy`, `store.model === MODEL`. (`AjaxStore.ts:42-43`.)
- **Missing-proxy-options guard:** `new AjaxStore(MODEL)` with no second arg **throws** with the message at `AjaxStore.ts:39` (`'AjaxStore requires an AjaxProxyOptions argument when constructed with a Model.'`). Assert the throw + message substring — this guard is `AjaxStore`-specific and untested anywhere.
- **Options-bag form:** `new AjaxStore({ model, proxy: { url:'/api/users' } })` → builds the proxy from `bag.proxy` and applies bag options. (`AjaxStore.ts:45-48`.)
- **End-to-end load through the embedded proxy:** stub `fetch` (mirror `AjaxProxy.test.ts`'s `okResponse` helper exactly), call `store.load()`, assert the store's records reflect the fetched rows and `fetch` was called with the configured URL. This proves the *wiring* (store → embedded AjaxProxy → fetch) without re-testing `AjaxProxy`'s envelope/root/pagination matrix.
- **`applyOptions` forwarding in bag form:** include e.g. `listeners` or `autoLoad` in the bag and assert it takes effect (same approach as `Store.test.ts`), deriving the expectation from `applyOptions`.

**Avoid redundancy:** do **not** re-cover `AjaxProxy` root unwrapping, `{data,total}` envelopes, sort/filter query params, batch ops, custom reader/writer, or abort threading — all owned by `AjaxProxy.test.ts`. Here, assert only that `AjaxStore` *constructs and delegates to* an `AjaxProxy` correctly.

---

### `TreeNode.ts` → `tests/unit/data/TreeNode.test.ts`

**Relationship.** `TreeNode` ([`TreeNode.ts:26`](../src/typescript/lib/data/TreeNode.ts#L26)) is a thin structural wrapper produced by `TreeStore` during its index rebuild. Its getters (`getId`, `getParent`, `getChildren`, `getDepth`, `isLeaf`, `isLoaded`) are read indirectly by [`TreeStore.test.ts`](../tests/unit/data/TreeStore.test.ts), but two contract points are **not** directly asserted: the **synthetic-root semantics** (null record, depth -1, `getId()` undefined) and the **live-expansion delegation** (`isExpanded()` reflects store state, not a node field). The setters (`setChildren`/`setLeaf`/`setLoaded`) are store-internal.

**Expected-behaviour oracle.** From the class JSDoc (`TreeNode.ts:6-24`): the synthetic root has a null record and depth -1; `getId()` reads the store's id field off the wrapped record; `isExpanded()` is a **live view** of the store's expansion set keyed by record id, so expanding via `TreeStore.expand` must flip the node's `isExpanded()` with no node-level mutation.

**Approach.** The JSDoc is explicit that consumers obtain nodes through the store, not by direct construction, and that expansion must be mutated through the store. So prefer driving `TreeNode` **through a real `TreeStore`** (reuse the `MODEL`/`FLAT` fixtures and `makeStore()` shape from `TreeStore.test.ts`) rather than `new TreeNode(...)` with a hand-built store. Direct construction is acceptable only to assert the pure synthetic-root getter defaults if a real store doesn't expose a clean way to reach the root with a null record — but `TreeStore.getRootNode()` already does (`TreeStore.test.ts:30` asserts `getDepth()` is -1), so use that.

**Behaviours / edge cases:**

- **Synthetic root:** via `store.getRootNode()` → `getRecord()` is `null`, `getDepth()` is `-1`, `getId()` is `undefined` (the null-record branch at `TreeNode.ts:68`), `getParent()` is `null`. The `getRecord()===null`/`getId()===undefined` pair is the new coverage; depth -1 overlaps `TreeStore.test.ts` but is cheap to keep for a complete root-contract assertion.
- **`getId()` honours the store id field:** with a mapped-id model (mirror `TreeStore.test.ts:179`'s `MAPPED` model), a child node's `getId()` returns the logical id value, proving it reads `_store.getIdField()` not a raw key.
- **`isExpanded()` is live:** get a node, assert `isExpanded()` is `false`, `await store.expand(node)`, assert it is now `true`, `store.collapse(node)`, assert `false` again — without ever touching node fields. Derive from the "live view of store state" JSDoc.
- **`isLeaf()` / `isLoaded()` defaults:** a freshly built eager leaf node is `isLeaf() === true` after leaf determination and `isLoaded() === true` (default at `TreeNode.ts:33-34`); a lazy `hasChildrenField` branch is `isLoaded() === false` (overlaps `TreeStore.test.ts:120` — include only if it sharpens the node-level contract, else skip to avoid duplication).
- **`getChildren()` / `getParent()` linkage:** parent/child references are reciprocal for a resolved node (overlaps `TreeStore.test.ts:39`; keep only if framed as the node's own getter contract, otherwise skip).

**Avoid redundancy:** the tree-building, visible-view, lazy-load, and event behaviours belong to `TreeStore.test.ts`. `TreeNode.test.ts` asserts only the **node-local getter contract**, with the synthetic-root and live-expansion semantics as the genuinely-new coverage.

---

### `proxy/Proxy.ts` → `tests/unit/data/proxy/Proxy.test.ts`

**Relationship.** `Proxy` ([`proxy/Proxy.ts:44`](../src/typescript/lib/data/proxy/Proxy.ts#L44)) is an **abstract base class** with four abstract CRUD methods (`read`/`create`/`update`/`destroy`), three **optional** batch methods (`createBatch`/`updateBatch`/`destroyBatch`), and **one concrete method** — `getLastTotalCount()` whose default returns `undefined` (`proxy/Proxy.ts:136`). The concrete proxies (`MemoryProxy`, `AjaxProxy`, `WebStorageProxy`) already have full test files. The only directly-testable own behaviour on `Proxy` itself is the **default `getLastTotalCount()`** and the **optional-batch contract** (that absence of a batch method is the signal `AbstractStore.sync` uses to fall back).

**Expected-behaviour oracle.** From the JSDoc (`proxy/Proxy.ts:125-138` and the batch-method `@remarks`): the base `getLastTotalCount()` returns `undefined` for a non-paginating proxy; batch methods are optional, and when absent `AbstractStore.sync` issues one op per record. The `Proxy` base is therefore the place to assert the *default* and the *fallback trigger*, not the transport behaviour.

**Behaviours / edge cases:**

- **Default `getLastTotalCount()`:** a minimal concrete subclass (implement the four abstract methods as `Promise.resolve` stubs — mirror the `DeferredProxy`/`StubProxy` shape from existing tests, but without overriding `getLastTotalCount`) returns `undefined`. (`proxy/Proxy.ts:136`.) Cross-check the contract: `AjaxProxy` overrides this to return a real total ([`AjaxProxy.test.ts:87`](../tests/unit/data/proxy/AjaxProxy.test.ts#L87)), so the base default is the un-overridden case.
- **Batch methods are optional / undefined by default:** on the minimal subclass, `proxy.createBatch === undefined` (and likewise `updateBatch`, `destroyBatch`) — proving they are not inherited as no-ops. This is the structural signal `AbstractStore.sync` keys off; derive the expectation from the "When absent, sync falls back to issuing one create per record" JSDoc.
- **Sync fallback uses single-op path when batch is absent:** construct a `Store` with the minimal `Proxy` subclass (with `vi.spyOn` on `create`/`update`/`destroy`), stage a create+update+destroy, `await store.sync()`, and assert each single-op method was called per record (mirror the assertion shape in [`MemoryStore.test.ts:97`](../tests/unit/data/MemoryStore.test.ts#L97) and `AbstractStore.sync.test.ts`). This proves the *base-class optional-batch contract* end-to-end rather than re-testing any concrete proxy. Keep this minimal and reference `AbstractStore.sync.test.ts` to avoid duplicating its batch-vs-single matrix — assert only the "no batch method ⇒ single-op fallback" edge.

**Avoid redundancy:** do not re-test any concrete proxy's CRUD here. The abstract base only owns its default `getLastTotalCount` and the optional-batch contract.

---

### `StoreWorkerClient.ts` → `tests/unit/data/StoreWorkerClient.test.ts`

**Relationship.** `StoreWorkerClient` ([`StoreWorkerClient.ts:73`](../src/typescript/lib/data/StoreWorkerClient.ts#L73)) is the main-thread client: it lazily constructs one shared `Worker`, routes responses by `requestId`, and **falls back gracefully when `Worker` is unavailable** (the case `AbstractStore` guards via `isAvailable()` at [`AbstractStore.ts:1692`](../src/typescript/lib/data/AbstractStore.ts#L1692)). Confirmed empirically: under node, `typeof Worker === 'undefined'`, so `isAvailable()` is `false` and `send()` rejects with `'Worker unavailable'`.

**Expected-behaviour oracle.** From the module JSDoc (`StoreWorkerClient.ts:1-7`) and the method JSDoc: `isAvailable()` is `true` only when a worker can be constructed; `snapshot`/`sort`/`filter`/`sortFilter` post a message tagged with a unique `requestId` and resolve with the worker's indices (defaulting `undefined` → `[]`); concurrent requests must not crosstalk (routed by `requestId`); a worker error rejects the matching promise.

**Two test layers:**

1. **Fallback path (directly testable, node, no stubbing):**
   - `isAvailable()` returns `false` when `Worker` is undefined. (`StoreWorkerClient.ts:31-32`, `77-79`.)
   - `snapshot(...)` / `sort(...)` / `filter(...)` / `sortFilter(...)` **reject** with `Error('Worker unavailable')` because `send()` hits the no-worker branch (`StoreWorkerClient.ts:59-61`). Assert via `await expect(...).rejects.toThrow('Worker unavailable')`.

2. **Happy path (requires a faked `Worker` global):** Stub a minimal fake `Worker` via `vi.stubGlobal('Worker', FakeWorker)` (tear down with `vi.unstubAllGlobals()` in `afterEach`). The fake captures the assigned `onmessage`, records `postMessage` payloads, and lets the test push a synthetic response back. Derive expectations from the protocol the client implements:
   - `isAvailable()` returns `true` once a `Worker` can be constructed.
   - `snapshot(storeId, records)` posts `{ type:'snapshot', storeId, records, requestId }` and resolves (to `undefined`) when the fake replies `{ requestId }`. Assert the posted message shape and that a missing `indices` resolves to `undefined` for snapshot.
   - `sort` / `filter` / `sortFilter` post the documented message shape and **resolve to the `indices` array** the fake returns; assert `undefined` indices coerce to `[]` (`StoreWorkerClient.ts:94,101,115`).
   - **requestId routing / no crosstalk:** issue two overlapping requests, reply out of order, assert each promise resolves with its own response — derive from the "routes requests by requestId so concurrent stores don't crosstalk" JSDoc (`StoreWorkerClient.ts:2-4`).
   - **error propagation:** a reply carrying `{ requestId, error:'boom' }` rejects the matching promise with `Error('boom')` (`StoreWorkerClient.ts:48-49`).
   - **`requestId` for an unknown id is ignored:** pushing a response whose `requestId` isn't pending is a silent no-op (`StoreWorkerClient.ts:44`).

   > **Module-state caveat (must be in a comment):** `worker`, `nextRequestId`, and `pending` are **module-level singletons** (`StoreWorkerClient.ts:26-28`). Once a real-or-fake worker is constructed it is cached for the module's lifetime, and `nextRequestId` keeps incrementing across tests. The implementer must NOT assert absolute `requestId` values (assert relative/monotonic only), and the fallback-path tests must run in a context where no worker has yet been constructed — if Vitest's per-file module isolation is not sufficient (it usually is, since each test file gets a fresh module registry), the implementer must investigate and, if needed, split the fallback assertions into their own file or use `vi.resetModules()` + dynamic `import()`. Flag this in the report if isolation turns out to be a problem; do **not** paper over it by re-ordering tests until they happen to pass.

**Expectation-divergence rule applies in force here:** if a faked-worker happy-path assertion can't be made to reflect the documented protocol, stop and surface it rather than loosening the assertion.

---

### `StoreWorker.ts` → no standalone test file (justified omission)

**Finding.** `StoreWorker.ts` ([`StoreWorker.ts`](../src/typescript/lib/data/StoreWorker.ts)) is a **Web Worker entry point**: it installs `self.onmessage` and replies via `(self as any).postMessage`. It is imported elsewhere only as `~/data/StoreWorker.js?worker` ([`StoreWorkerClient.ts:15`](../src/typescript/lib/data/StoreWorkerClient.ts#L15)) — i.e. as a Vite worker module, never as a plain importable surface. Its message-handler is bound to module-load side effects on `self`; there is no exported function to call.

**Why no isolated test:**

- The only domain logic it owns is `sortIndices` (its null-last tie-break) and the dispatch that delegates filtering to `matchesFilter` and comparison to `compareValues`. The dispatch's branches (`snapshot` caching, "No snapshot for storeId" error, `filter`/`sort`/`sortFilter` combinations) are **not reachable** without driving `self.onmessage`, which a plain `node`/`jsdom` import does not set up meaningfully (and importing the module for its side effects under node touches a `self` that doesn't exist as a worker scope).
- Its sort/filter semantics are the *contract mirror* of `AbstractStore.applyView()` (the source comment at `StoreWorker.ts:36-38` says so), and that main-thread path is already covered by `MemoryStore.test.ts`'s sort/null-last/filter tests.

**Actionable recommendation (surface to user, do not silently skip).** The reusable nucleus — `compareValues` and `matchesFilter` — currently has **no direct test** (only indirect coverage). Rather than contort a fake worker scope, the implementer should add focused unit tests for those two pure helpers (in `tests/unit/data/compareValues.test.ts` and `tests/unit/data/FilterDescriptor.test.ts`, deriving expectations from their JSDoc: locale-aware string compare, timestamp dates, null-last ordering for `compareValues`; each filter `type` for `matchesFilter`). These are out of this plan's named target list, so **flag them as a recommendation in the implementation report** for the user to approve, rather than adding them unprompted. If the user declines, `StoreWorker.ts`'s logic remains covered indirectly via `MemoryStore.test.ts` and the `StoreWorkerClient` protocol tests. Either way, do **not** create a `StoreWorker.test.ts` that imports the worker entry for side effects — it would be brittle and assert nothing the contract guarantees.

---

## Ordered Implementation Steps

1. **`tests/unit/data/Model.test.ts`** — cover `Model` + `AbstractModel` per its section. Verify: `npx vitest run tests/unit/data/Model.test.ts`.
2. **`tests/unit/data/Store.test.ts`** — constructor + `applyOptions` forwarding. Reuse the `RecordingProxy` helper shape from `AbstractStore.load.test.ts`. Verify run.
3. **`tests/unit/data/AjaxStore.test.ts`** — dual constructor, missing-options guard, end-to-end load via stubbed `fetch` (reuse `okResponse` helper). Verify run.
4. **`tests/unit/data/TreeNode.test.ts`** — node-local getter contract, synthetic-root + live-expansion semantics, driven through a real `TreeStore`. Verify run.
5. **`tests/unit/data/proxy/Proxy.test.ts`** — default `getLastTotalCount`, optional-batch contract, single-op sync fallback. Verify run.
6. **`tests/unit/data/StoreWorkerClient.test.ts`** — fallback-path rejects + faked-`Worker` happy path with requestId routing and error propagation. Mind the module-singleton caveat. Verify run.
7. **Recommendation step (report only):** flag the `compareValues` / `matchesFilter` direct-coverage gap (StoreWorker section) to the user; do not author those files without approval.
8. **Full suite + typecheck checkpoint:** `npx vitest run tests/unit/data/` (expect all green, or any `it.fails`/`FIXME` discrepancies explicitly surfaced) and `npx tsc --noEmit` (expect no new errors from the test files).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `tests/unit/data/Model.test.ts` |
| Create | `tests/unit/data/Store.test.ts` |
| Create | `tests/unit/data/AjaxStore.test.ts` |
| Create | `tests/unit/data/TreeNode.test.ts` |
| Create | `tests/unit/data/proxy/Proxy.test.ts` |
| Create | `tests/unit/data/StoreWorkerClient.test.ts` |
| (Recommend, pending approval) | `tests/unit/data/compareValues.test.ts`, `tests/unit/data/FilterDescriptor.test.ts` — covers `StoreWorker`'s pure nucleus |
| None | `tests/unit/data/AbstractModel.test.ts` — covered via `Model.test.ts` |
| None | `tests/unit/data/StoreWorker.test.ts` — not feasibly testable in isolation (see its section) |

No source files are modified by this plan **unless** an expectation-divergence (per the methodology section) reveals a code bug — in which case the implementer stops and surfaces it rather than editing source under cover of a test plan.

---

## Verification

- `npx vitest run tests/unit/data/` — all new and existing data tests green, except any deliberately-marked `it.fails`/`it.todo` discrepancies which must be itemised in the report.
- `npx tsc --noEmit` — no new type errors introduced by the test files.
- **Discrepancy ledger:** the report must list every place an assertion was marked `it.fails`/`FIXME` because observed output diverged from the derived contract, with the contract point cited — these are findings for the user, not failures to hide.
- Manual sanity: confirm `tests/unit/data/StoreWorkerClient.test.ts` does not leak a stubbed `Worker` into later files (run the full data suite, not just the single file).

---

## Potential Challenges

- **`StoreWorkerClient` module-singleton state** (`worker`, `nextRequestId`, `pending`) persists within a file; assert relative ids only and rely on per-file module isolation, falling back to `vi.resetModules()` + dynamic import if a fallback/happy-path collision appears. Surface it if isolation proves insufficient.
- **Faking `Worker`** must capture the `onmessage` the client assigns and let the test push responses; getting the synthetic round-trip right (resolve vs reject, `undefined`→`[]` coercion) is the fiddly part — derive each from the client's own JSDoc, not from trial-and-error.
- **`createRecord` array-form ordering** keys off `field.getOrder()`, not array index; deriving the wrong expectation here is the most likely place to "lock in" a misunderstanding — compute the expected mapping from the `order` values by hand first.
- **Proxy-less `Store` operations** — behaviour for an undefined proxy is not obvious from the subclass; read the `AbstractStore` guard before asserting, and flag if the contract is undocumented.

---

## Critical Files

Read before authoring:

- [`tests/unit/data/MemoryStore.test.ts`](../tests/unit/data/MemoryStore.test.ts), [`tests/unit/data/TreeStore.test.ts`](../tests/unit/data/TreeStore.test.ts), [`tests/unit/data/AbstractStore.load.test.ts`](../tests/unit/data/AbstractStore.load.test.ts), [`tests/unit/data/AbstractStore.sync.test.ts`](../tests/unit/data/AbstractStore.sync.test.ts), [`tests/unit/data/Association.test.ts`](../tests/unit/data/Association.test.ts), [`tests/unit/data/Field.test.ts`](../tests/unit/data/Field.test.ts) — conventions, fixtures, faked-collaborator patterns.
- [`tests/unit/data/proxy/AjaxProxy.test.ts`](../tests/unit/data/proxy/AjaxProxy.test.ts), [`tests/unit/data/proxy/WebStorageProxy.test.ts`](../tests/unit/data/proxy/WebStorageProxy.test.ts) — `vi.stubGlobal` fetch/storage faking + teardown.
- [`src/typescript/lib/data/AbstractModel.ts`](../src/typescript/lib/data/AbstractModel.ts), [`src/typescript/lib/data/Model.ts`](../src/typescript/lib/data/Model.ts), [`src/typescript/lib/data/Store.ts`](../src/typescript/lib/data/Store.ts), [`src/typescript/lib/data/AjaxStore.ts`](../src/typescript/lib/data/AjaxStore.ts), [`src/typescript/lib/data/TreeNode.ts`](../src/typescript/lib/data/TreeNode.ts), [`src/typescript/lib/data/StoreWorkerClient.ts`](../src/typescript/lib/data/StoreWorkerClient.ts), [`src/typescript/lib/data/StoreWorker.ts`](../src/typescript/lib/data/StoreWorker.ts), [`src/typescript/lib/data/proxy/Proxy.ts`](../src/typescript/lib/data/proxy/Proxy.ts) — the contracts under test.
- [`src/typescript/lib/data/AbstractStore.ts:229`](../src/typescript/lib/data/AbstractStore.ts#L229) (`applyOptions`) and the proxy-guard / worker-dispatch sites — the inherited behaviour the subclass tests exercise.

---

## Non-Goals

- **No new source code.** This plan adds tests only; a discovered bug is surfaced, not fixed here.
- **No re-testing of already-covered behaviour** — concrete-proxy CRUD, store load-concurrency/remote-sort/sync-CRUD, tree building/lazy-load/events are owned by existing files; the new files assert only each target's own marginal contract.
- **No `StoreWorker.test.ts`** importing the worker entry for side effects — not feasibly testable in isolation; its logic is covered indirectly and via the recommended pure-helper tests (pending user approval).
- **No jsdom environment** — every new file runs under the default `node` env, consistent with all existing data tests.
