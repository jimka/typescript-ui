---
depends-on: [data-field-types-and-validation, data-proxy-reader-writer, data-store-sync-and-events, data-store-collection-and-aggregation]
touches-shared: [src/typescript/lib/data/AbstractModel.ts, src/typescript/lib/data/AbstractStore.ts, src/typescript/lib/data/ModelRecord.ts, src/typescript/lib/data/index.ts]
---

# Record Associations (hasMany / belongsTo) — Implementation Plan

## Overview

This is the capstone of the five-plan data-layer effort. It lets a model declare that one of its records **owns** records of another model — `Department hasMany Employee`, `Employee belongsTo Department` — and surfaces those children as a fully-featured child [`Store`](../src/typescript/lib/data/Store.ts#L25) scoped to the parent record, not a plain array. It builds directly on the four sibling plans: typed-field conversion + the client-side `internalId` ([`data-field-types-and-validation`](./data-field-types-and-validation.md)), the `remoteFilter` load path ([`data-proxy-reader-writer`](./data-proxy-reader-writer.md)), the `sync()` rework + `'exception'` event ([`data-store-sync-and-events`](./data-store-sync-and-events.md)), and the child-store-grade collection API ([`data-store-collection-and-aggregation`](./data-store-collection-and-aggregation.md)). It does **not** re-specify any of their internals — it consumes their abstractions.

The work lives entirely under [`src/typescript/lib/data/`](../src/typescript/lib/data). It adds an `Association` abstraction (new file `Association.ts` with `HasManyAssociation` / `BelongsToAssociation`), an `associations` schema array on [`AbstractModel`](../src/typescript/lib/data/AbstractModel.ts#L16) mirroring `fields`, child-store accessors + FK plumbing on [`ModelRecord`](../src/typescript/lib/data/ModelRecord.ts#L26), an eager-hydration hook in [`AbstractModel.createRecord`](../src/typescript/lib/data/AbstractModel.ts#L107), and cascade-sync integration in [`AbstractStore.sync()`](../src/typescript/lib/data/AbstractStore.ts#L617) (as reworked by the sync plan).

Three product decisions are locked by the user: **(1) loading is both eager** (nested child array embedded in the parent payload) **and lazy** (child store loads on demand via its own proxy, `remoteFilter`-ed on the parent FK); **(2) persistence cascades through the parent's `sync()`** in dependency order, with nested-vs-own-proxy serialization configurable per association; **(3) access is a parent-scoped child `Store`**, cached on the record so repeated accessor calls return the same instance.

---

## Architecture Decisions

### `Association` is a declarative schema object, not a behavioural class — parallel to `Field`

[`Field`](../src/typescript/lib/data/Field.ts) is a passive descriptor: it holds `name`/`type`/`mapping` and a couple of pure helpers; the *behaviour* (ingest, sort, persist) lives in `AbstractModel`/`AbstractStore`/`Proxy`. Associations follow the same split. `Association` (abstract) + `HasManyAssociation` / `BelongsToAssociation` are **descriptors** — name/accessor, owner model, target model factory, `foreignKey`, the eager nested-payload key, and the persistence mode. They expose only pure getters (`getAccessor`, `getForeignKey`, `getNestedKey`, `resolveTarget`, …). The runtime logic — hydrate, lazy-load, cascade — lives in `ModelRecord`/`AbstractModel`/`AbstractStore`, exactly where the analogous field logic already lives. This keeps the new class small and matches the codebase's existing descriptor/behaviour separation.

### Associations are declared in an `associations` array on `AbstractModel`, mirroring `fields`

`AbstractModel` already owns the schema and lazily resolves `fields` into an indexed cache via `ensureIndex()` ([`AbstractModel.ts:32`](../src/typescript/lib/data/AbstractModel.ts#L32)). Associations are schema, so they belong there too: a new optional `associations?: (Association | AssociationOptions)[]` member, resolved and indexed the same way (`_resolvedAssociations`, `_associationsByAccessor`) inside the existing `ensureIndex()` call. New accessors `getAssociations()` / `getAssociation(accessor)` mirror `getFields()` / `getField(name)`. Declaring on the model (not the record) is correct because the schema is per-type, not per-instance — every `Department` record shares the same `employees` association definition; only the *child store instance* is per-record.

`Model` ([`Model.ts:22`](../src/typescript/lib/data/Model.ts#L22)) gains an optional `associations` field in `ModelOptions` and assigns it in the constructor alongside `fields`. Because `associations` is optional on `AbstractModel` (default `[]`), every existing model and the four sibling plans compile unchanged.

### The target model is resolved through a factory to break the declaration cycle

`Department`'s `employees` association references the `Employee` model and vice-versa (`Employee belongsTo Department`). A direct `target: EmployeeModel` reference would force a module/initialization cycle and an ordering constraint at declaration time. So `AssociationOptions.target` is a **thunk**: `target: () => AbstractModel` (or a `Model` instance for the runtime `Model` path). `Association.resolveTarget()` calls the thunk once and memoizes the result. This is the standard ORM pattern for mutually-referential associations and keeps declaration order irrelevant. The thunk returns an `AbstractModel` *instance* (models are cheap, schema-only objects with lazy field resolution), so the child store can be constructed from it directly.

### `ModelRecord` exposes a hasMany child as a cached, parent-scoped `Store`

Per the locked access decision, `record.<accessor>()` returns a full [`Store`](../src/typescript/lib/data/Store.ts#L25) — CRUD, filter, sort, events, the new collection/aggregation API — not an array. The record holds a lazily-created cache `Map<string, AbstractStore>` keyed by accessor; the first accessor call builds the child store and stores it, so repeated calls return the **same** instance (stable identity is required for listeners and the collection `_idIndex`). The child store is a `Store` built from `association.resolveTarget()` and the target model's proxy when one is configured (lazy path), seeded directly from records when the parent payload embedded them (eager path).

The accessor is **not** a generated method named per association (see the CODE_CONVENTIONS tension below); it is a single typed method `getAssociated(accessor: string): AbstractStore` on `ModelRecord`, plus a thin convenience the *model author* may expose. `getAssociated` looks the association up via `this._model.getAssociation(accessor)`, throws a clear error for an unknown accessor (programmer error, not a runtime data condition), and returns the cached store.

### hasMany child stores carry a `remoteFilter` on the parent FK for the lazy path

When the parent record was **not** loaded with an embedded child array, the child store loads on demand through the target model's proxy. The scoping is expressed exactly through the dependency plan's mechanism: the child store is constructed with `remoteFilter: true` and a seed filter `{ type: 'eq', field: association.getForeignKey(), value: parent.getId() }` in its `filters` option, so its `load()` serializes that filter into `ReadParams.filters` and the proxy returns only the children of this parent. No new load machinery is invented — this is the `remoteFilter` path from `data-proxy-reader-writer` applied with a fixed parent-scoped filter. When the parent has no server id yet (a brand-new unsynced parent), the lazy store is created empty and not auto-loaded (there is nothing to fetch); children are added in-memory and stamped during cascade sync (see the FK-stamping decision).

### Eager hydration happens in `createRecord`, after field mapping, keyed by the association's nested key

The eager path piggybacks on the one boundary where external data enters a record: [`AbstractModel.createRecord`](../src/typescript/lib/data/AbstractModel.ts#L107). After the existing field-mapping loop produces `mapped` (and the field-types plan's conversion has run on it), a new step reads each association's `nestedKey` out of the **raw `source`** (not `mapped`). If present and array-valued, the nested rows are stashed so the resulting `ModelRecord` can seed its child store with them on first accessor call. The nested rows are *not* eagerly turned into a live `Store` inside `createRecord` (that would build a store for every loaded row whether or not the children are ever read); they are held as raw arrays and the child store is built lazily on first `getAssociated()` call, seeded from the stash. This keeps `createRecord` cheap and preserves the lazy-construction-of-the-store guarantee while still being *eager* about the data (no second network round-trip).

Critically, the nested key must not be mistaken for a field. Because `mapped` is built only from `this._resolvedFields`, an embedded `employees: [...]` array under a key that is not a declared field name is already ignored by the field loop — so there is no collision as long as **association nested keys are not also field mappings** (validated; see Potential Challenges). The stash lives in a new private `_associatedSeed: Record<string, any[]>` passed to the `ModelRecord` constructor (a new optional constructor parameter, defaulting to `{}`), never in `_data`, so `getData()` / the proxy writers never see it.

### belongsTo exposes a parent-reference accessor plus the FK getter — no child store

A `belongsTo` association is the inverse: the record carries a foreign-key field pointing at its owner. It needs no child store. `record.getAssociated(accessor)` for a `BelongsToAssociation` instead resolves the **single** parent record: it reads the FK value from the record's own data (`this.get(association.getForeignKey())`) and returns a one-shot lookup against the target model's store *if one is wired*, else a lazily-loaded single-record store filtered to that id. To keep scope tight and avoid inventing a "single record loader," `belongsTo` returns a parent-scoped child `Store` (target model, `remoteFilter` on the target's primary key === this FK) whose first record is the owner — symmetric with hasMany, reusing the identical machinery. A convenience `getForeignKeyValue(accessor)` returns the raw FK value without loading. This keeps one access mechanism (`getAssociated` → a `Store`) and one cache, rather than a second record-returning path.

### Persistence cascades through the parent store's `sync()`, in dependency order, per the sync plan

`AbstractStore.sync()` is being reworked by [`data-store-sync-and-events`](./data-store-sync-and-events.md) into an orchestrator over `syncCreates` / `syncUpdates` / `syncDeletes` with per-op `'exception'` emission and `syncErrorPolicy`. Cascade sync hooks **after** the parent's own creates/updates resolve and **before** its deletes, walking each parent record's hasMany associations and invoking the child store's `sync()`. The order is: parent creates → (for each just-created/updated parent) FK-stamp + child cascade → parent deletes. This is "dependency order": a child create cannot be persisted until its parent has a server id, and a parent delete should follow its children's deletes (or rely on server cascade — see Non-Goals). Cascade reuses the child `Store`'s own `sync()` wholesale, so child `'exception'` events, `syncErrorPolicy`, and batch behaviour all come for free; the parent store does not reimplement persistence. A new parent-store option `cascadeSync?: boolean` (default `true`) gates the walk so a consumer can opt a store out.

Child failures do **not** silently corrupt the parent: a child `sync()` that records failures surfaces through the *child* store's `'exception'` event (its own listeners), and the cascade respects the parent store's `syncErrorPolicy` for whether to continue to the next parent. The parent's terminal `'sync'` payload is unchanged in shape; cascade failures are observed on the child stores. This deliberately avoids inventing a cross-store aggregated failure type — it reuses the per-store event surface the sync plan already defines.

### Per-association persistence mode: nested vs own-proxy

`AssociationOptions.persist?: 'nested' | 'proxy'` (default `'proxy'`) is honored during cascade. `'proxy'` — the default and the simple case — persists children through the **child store's own proxy** (the target model's proxy), exactly as any store syncs; the cascade is just "call the child store's `sync()`." `'nested'` — children serialize *inside the parent's write body*: the parent's `Writer` (from `data-proxy-reader-writer`) is asked to embed the children under the association's `nestedKey` when serializing the parent create/update, and the child store is **not** synced independently. Because the `Writer` abstraction is owned by the proxy plan, the `'nested'` mode is implemented as a parent-record serialization concern: `ModelRecord.getData()` stays unchanged (children are never fields), and a new `ModelRecord.getDataWithNested()` produces the parent data object augmented with `{ [nestedKey]: childStore.getRecordsData() }` for `'nested'` associations, which a nested-aware writer (or the default writer via an opt-in flag) consumes. To keep the surface minimal, the plan ships `'proxy'` fully and `'nested'` as the per-association switch plus the `getDataWithNested()` helper, documenting that `'nested'` requires the parent proxy's `Writer` to read the augmented data (the hook point, not a new writer class).

### New-parent FK is unknown until cascade sync stamps it from the parent's server id

A child added to a brand-new parent cannot know its `foreignKey` value yet — the parent has no server id. The record-layer plan ([`data-field-types-and-validation`](./data-field-types-and-validation.md)) gives every record a client-side `getInternalId()` that exists before the server PK. The cascade uses it as the join key during sync: after the parent's create resolves and `getId()` returns the real server id, the cascade walks the parent's hasMany child stores and, for every child whose FK is still unset (or points at nothing), stamps `child.set(association.getForeignKey(), parent.getId())` **before** invoking the child store's `sync()`. Children added to an already-persisted parent already carry the correct FK at add time (the child store can default it; see below), so the stamp is a no-op for them. The `internalId` is the stable identity that lets the child store cache and the table key the child rows in the UI before the FK exists; the real FK is stamped exactly once, post-parent-create, inside the cascade.

To make children added through the child store carry the FK eagerly when the parent *is* persisted, the hasMany child store is configured to default new records' FK field to the parent's current id at `add()` time — implemented not by subclassing `Store` but by the child-store factory passing the FK as part of a `defaultValues` seed merged in `add` is **out of scope** (no such option exists); instead the cascade's unconditional post-create stamp covers both cases uniformly. This keeps one code path: **the cascade always stamps the FK from the live parent id before syncing children**, whether the parent was just created or already existed.

---

## Public API (TypeScript Signatures)

New file `data/Association.ts`:

```ts
/** Per-association persistence strategy during cascade sync. @category Data */
export type AssociationPersist = 'nested' | 'proxy';

/** Construction-time options shared by all association kinds. @category Data */
export interface AssociationOptions {
    /** Accessor name exposed on the record (e.g. 'employees'). */
    accessor : string;
    /** Thunk returning the target model — a thunk to break declaration cycles. */
    target   : () => AbstractModel;
    /** The child field holding the owner's id (hasMany) / the owner's PK this record points at (belongsTo). */
    foreignKey: string;
    /** Raw-payload key carrying an embedded child array for eager hydration. Defaults to `accessor`. */
    nestedKey?: string;
    /** Cascade persistence strategy; defaults to 'proxy'. */
    persist?  : AssociationPersist;
}

/** Declarative association descriptor; behaviour lives in Model/Record/Store. @category Data */
export abstract class Association {
    constructor(options: AssociationOptions);
    getAccessor(): string;
    getForeignKey(): string;
    getNestedKey(): string;          // nestedKey ?? accessor
    getPersist(): AssociationPersist;
    resolveTarget(): AbstractModel;  // memoized thunk call
    abstract readonly kind: 'hasMany' | 'belongsTo';
}

/** Parent owns many child records, surfaced as a parent-scoped child Store. @category Data */
export class HasManyAssociation extends Association { readonly kind: 'hasMany'; }

/** Record references a single owner via its foreign key. @category Data */
export class BelongsToAssociation extends Association { readonly kind: 'belongsTo'; }
```

Extended `data/AbstractModel.ts`:

```ts
export abstract class AbstractModel {
    // …existing…
    readonly associations?: (Association | AssociationOptions)[];   // optional; defaults to none
    getAssociations(): Association[];
    getAssociation(accessor: string): Association | undefined;
    // createRecord gains internal eager-hydration; signature unchanged for callers.
}
```

Extended `data/Model.ts` — `ModelOptions` gains `associations?`:

```ts
export interface ModelOptions {
    fields:        Array<Field | FieldOptions>;
    primaryKey?:   string;
    associations?: Array<Association | AssociationOptions>;
}
```

Extended `data/ModelRecord.ts`:

```ts
export class ModelRecord {
    // new optional 4th-style constructor seed for embedded children (defaults to {}):
    constructor(model: AbstractModel, data: Record<string, any>, associatedSeed?: Record<string, any[]>);

    /** Returns the cached, parent-scoped child Store for an association accessor. */
    getAssociated(accessor: string): AbstractStore;
    /** Raw foreign-key value for a belongsTo accessor, without loading. */
    getForeignKeyValue(accessor: string): any;
    /** Parent data plus embedded children for 'nested'-persist associations. */
    getDataWithNested(): Record<string, any>;
}
```

Extended `data/AbstractStore.ts`:

```ts
export interface AbstractStoreOptions {
    // …existing…
    cascadeSync?: boolean;   // default true — walk hasMany child stores during sync()
}
```

---

## Internal Structure

### Eager-hydration step in `createRecord` (after the existing mapping loop)

```ts
// after `mapped` is built (field loop + field-types conversion):
const seed: Record<string, any[]> = {};

for (const assoc of this.getAssociations()) {
    const raw = source[assoc.getNestedKey()];

    if (assoc.kind === 'hasMany' && Array.isArray(raw)) {
        seed[assoc.getAccessor()] = raw;
    }
}

return new ModelRecord(this, mapped, seed);
```

`getAssociations()` resolves through the same lazy `ensureIndex()` already used for fields; promotion of `AssociationOptions` → `Association` mirrors the `Field` promotion at [`AbstractModel.ts:37`](../src/typescript/lib/data/AbstractModel.ts#L37) (default kind chosen by an explicit subclass instance or a `kind` discriminant on the options — see Ordered Steps).

### `ModelRecord.getAssociated` (lazy child-store build + cache)

```ts
getAssociated(accessor: string): AbstractStore {
    const cached = this._childStores?.get(accessor);

    if (cached) {
        return cached;
    }

    const assoc = this._model.getAssociation(accessor);

    if (!assoc) {
        throw new Error(`ModelRecord.getAssociated: no association '${accessor}'`);
    }

    const store = this.buildChildStore(assoc);   // private: Store over assoc.resolveTarget()
    (this._childStores ??= new Map()).set(accessor, store);

    return store;
}
```

`buildChildStore(assoc)` constructs a `Store` from `assoc.resolveTarget()` + that model's proxy. For hasMany: if an eager seed exists (`this._associatedSeed[accessor]`), call `store.loadData(seed)` and mark each child committed (loaded, not new); otherwise configure `remoteFilter: true` + the parent-FK filter so the first `load()` is parent-scoped. For belongsTo: configure `remoteFilter` on the target PK === this record's FK value.

### Cascade hook in the reworked `sync()`

The sync plan's orchestrator runs `syncCreates` → `syncUpdates` → `syncDeletes`. Cascade inserts a `syncCascade(failures)` phase **after** `syncUpdates` (parents now have server ids) and **before** `syncDeletes`:

```ts
private async syncCascade(failures: StoreExceptionEvent[]): Promise<void> {
    if (this.cascadeSync === false) { return; }

    for (const parent of this._allRecords) {
        for (const assoc of parent.getModel().getAssociations()) {
            if (assoc.kind !== 'hasMany') { continue; }
            if (!parent.hasChildStore(assoc.getAccessor())) { continue; }  // never accessed → nothing pending

            const child = parent.getAssociated(assoc.getAccessor());
            this.stampForeignKeys(child, assoc, parent);                   // child.set(fk, parent.getId())
            await child.sync();                                            // reuses child events + policy
        }
    }
}
```

Only associations whose child store was actually materialized are walked (a `hasChildStore(accessor)` predicate on the record), so loaded-but-untouched parents cost nothing. `stampForeignKeys` sets the FK on every child whose FK is unset/stale before the child's own `sync()` runs.

---

## Ordered Implementation Steps

1. **`data/Association.ts`** — new file: `AssociationPersist`, `AssociationOptions` (with `kind?: 'hasMany' | 'belongsTo'` discriminant so a plain options object resolves to the right subclass), abstract `Association` + getters + memoized `resolveTarget`, `HasManyAssociation`, `BelongsToAssociation`. `@category Data` on each. → verify: `npx tsc --noEmit` clean.
2. **`data/AbstractModel.ts`** — add optional `associations` member; resolve + index it inside `ensureIndex()` (`_resolvedAssociations`, `_associationsByAccessor`), promoting options to the right subclass by `kind`; add `getAssociations()` / `getAssociation()`. → verify: existing model tests pass (associations default empty).
3. **`data/AbstractModel.ts` — `createRecord`** — after the mapping loop, build the `seed` map from `source[assoc.getNestedKey()]` for hasMany; pass `seed` as the new `ModelRecord` constructor arg. → verify: a record loaded with an embedded child array stashes it; a record without one passes `{}`.
4. **`data/ModelRecord.ts`** — add the optional `associatedSeed` constructor param (store as `_associatedSeed`, never in `_data`); add `_childStores` lazy map; implement `getAssociated`, private `buildChildStore`, `hasChildStore`, `getForeignKeyValue`, `getDataWithNested`. Import `AbstractStore`/`Store` (watch for cycles — see Challenges). → verify: `getAssociated` returns the same instance twice; `getData()` excludes seed/children.
5. **`data/Model.ts`** — add `associations?` to `ModelOptions`; assign in constructor. → verify: `new Model({ fields, associations })` resolves.
6. **`data/AbstractStore.ts`** — add `cascadeSync?` option + backing field via `applyOptions`; add the `syncCascade` phase + `stampForeignKeys` helper, wired into the sync plan's orchestrator **after `syncUpdates`, before `syncDeletes`**. → verify: a parent create followed by cascade stamps the child FK from the parent's new id, then the child store syncs.
7. **`data/index.ts`** — export `Association`, `HasManyAssociation`, `BelongsToAssociation`, and `type { AssociationOptions, AssociationPersist }`. → verify: `grep -n Association src/typescript/lib/data/index.ts`.
8. **Tests** — eager hydration (embedded array → child store seeded, children committed not new); lazy load (child store loads through proxy with the parent-FK filter); cache identity (`getAssociated` twice → same store); cascade FK stamp (new parent → child FK becomes parent server id before child sync); `getData()` excludes children; belongsTo `getForeignKeyValue`. → verify: `npm test` green.
9. **Docs** — see Documentation Impact. → verify: `npm run docs:build` 0 errors / 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/data/Association.ts` |
| Modify | `src/typescript/lib/data/AbstractModel.ts` (associations schema + `createRecord` eager hydration) |
| Modify | `src/typescript/lib/data/Model.ts` (`ModelOptions.associations`) |
| Modify | `src/typescript/lib/data/ModelRecord.ts` (child-store accessors, seed, FK helpers) |
| Modify | `src/typescript/lib/data/AbstractStore.ts` (`cascadeSync`, `syncCascade` phase) |
| Modify | `src/typescript/lib/data/index.ts` (new exports) |
| Create | `tests/unit/data/Association.test.ts` |
| Modify | `tests/unit/data/AbstractModel.test.ts` (eager hydration) |
| Modify | `tests/unit/data/ModelRecord.test.ts` (accessors, cache, FK) |
| Modify | `tests/unit/data/AbstractStore.test.ts` (cascade sync) |
| Create | `docs/data/associations.md` |
| Modify | `docs/data/index.md` (catalog entry) |
| Modify | `docs/.vitepress/config.mts` (sidebar entry) |
| Modify | `docs/data/model.md` (declaring associations) |
| Modify | `docs/data/record.md` (`getAssociated`) |

---

## Verification

- **Typecheck:** `npx tsc --noEmit` — 0 errors. Watch the `ModelRecord` → `Store` import edge for a cycle (mitigation in Challenges).
- **Unit tests:** `npm test` —
  - **Eager:** a parent loaded from `{ id: 1, name: 'Sales', employees: [{...},{...}] }` exposes `getAssociated('employees')` as a `Store` with two records, each committed (not new/dirty), with no second proxy read.
  - **Lazy:** a parent loaded without the nested key, child store's `load()` issues a proxy read whose `ReadParams.filters` contains `{ type:'eq', field: fk, value: parentId }`.
  - **Cache identity:** two `getAssociated('employees')` calls return the same instance; a listener added to the first fires for a mutation made through the second.
  - **Cascade FK stamp:** add a new parent + a new child to its child store, `parentStore.sync()` → child's FK equals the parent's server id, and the child's create is sent *after* the parent's.
  - **Encapsulation:** `record.getData()` contains no children/seed; the proxy writer never serializes them (except `getDataWithNested()` for `'nested'`-persist).
  - **belongsTo:** `getForeignKeyValue('department')` returns the FK without loading.
- **Grep invariants:** `grep -n "associations" src/typescript/lib/data/AbstractModel.ts` (schema present); the `createRecord` seed never writes into `mapped`.
- **Docs:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted); confirm `Association` lands under `docs/api/data/`.
- **Manual smoke:** the data demo — declare a `Department hasMany Employee`, load a department with embedded employees, render the child store in a nested `Table`, add an employee, sync, confirm the FK is stamped.

---

## Documentation Impact

- **Barrel:** `Association`, `HasManyAssociation`, `BelongsToAssociation` (classes) and `AssociationOptions` / `AssociationPersist` (types) re-export from `src/typescript/lib/data/index.ts` (the `data` subpath barrel — there is no root barrel). Each carries `@category Data`. `AbstractStoreOptions.cascadeSync`, `ModelOptions.associations`, and the new `ModelRecord` methods are additions to already-exported symbols.
- **New curated page:** add `docs/data/associations.md` (declaring hasMany/belongsTo, eager vs lazy loading, the parent-scoped child store, cascade sync + the new-parent FK timing). Link it in `docs/.vitepress/config.mts` (the `/data/` sidebar block at [config.mts:179-188](../docs/.vitepress/config.mts#L179), after the `Record` entry) and add it to the `docs/data/index.md` catalog.
- **Existing pages:** `docs/data/model.md` documents the `associations` array; `docs/data/record.md` documents `getAssociated` / `getForeignKeyValue`.
- **Cross-bucket JSDoc:** all new references stay within the `data` bucket (`Association`, `Store`, `ModelRecord`, `AbstractStoreOptions` are all `data`), so `{@link …}` resolves; no markdown-link form needed. The cascade-sync prose links to the sync plan's `'exception'` event via the same-bucket `StoreExceptionEvent`.

---

## Potential Challenges

- **`ModelRecord` → `Store` import cycle.** `ModelRecord` building a `Store` pulls `data/Store.ts`, which imports `AbstractStore` and `Model`, which import `ModelRecord` — a runtime cycle. Mitigation: import the concrete `Store` lazily inside `buildChildStore` (`await import` is overkill for a sync method; instead type the field as `AbstractStore` and have the child-store factory live behind a thin indirection, or accept the cycle since ES modules tolerate it as long as `Store` isn't referenced at `ModelRecord` module-eval time — it is only referenced inside a method body, which runs long after both modules initialize). Verify with `npx tsc --noEmit` and a smoke test.
- **Nested key colliding with a field mapping.** If an association's `nestedKey` equals a field's `mapping`, the embedded array would also be (mis)read by the field loop. Mitigation: `ensureIndex()` asserts (dev-time `throw`) that no `nestedKey` collides with any `field.getMapping()`; documented in `associations.md`.
- **Cascade ordering vs parent delete.** Deleting a parent with children relies on either child stores being synced first or server-side cascade delete. Mitigation: the cascade runs hasMany child sync *before* the parent's own `syncDeletes`; deeper delete-ordering (orphan cleanup) is a Non-Goal — documented.
- **`'nested'` persistence needs writer cooperation.** The default `JsonWriter` serializes `record.getData()`, which excludes children. Mitigation: `'nested'` mode is the per-association switch + `getDataWithNested()` hook; shipping a nested-aware writer is documented as the integration point, and `'proxy'` (the default) needs no writer change.
- **Lazy load with no parent id.** A child store on an unsynced parent has nothing to fetch. Mitigation: don't auto-load when `parent.getId()` is undefined; children are added in-memory and FK-stamped at cascade time.

---

## Architecture Decisions — CODE_CONVENTIONS tensions (flagged)

- **Generated accessor methods vs typed getters / one-element-per-class.** A natural API would generate `record.employees()` per association. CODE_CONVENTIONS favours explicit typed methods and the framework's one-DOM-element-per-class rule discourages dynamic method synthesis; dynamically attaching per-association methods to `ModelRecord` also defeats TypeScript's typing (the methods wouldn't appear in the type). **Resolution:** expose one explicit, fully-typed method `getAssociated(accessor: string): AbstractStore` (plus `getForeignKeyValue`), not synthesized per-name accessors. A model author who wants `dept.employees()` ergonomics writes a one-line method on their `Model` subclass that calls `record.getAssociated('employees')` — opt-in, statically typed, no metaprogramming. This is the only deviation from the brief's "`record.<accessor>()`" phrasing and is taken deliberately to stay within the conventions.
- **`ModelRecord` is not a `Component`** — the cascade-dispatched-setter / `declare`-field trap from CODE_CONVENTIONS does not apply (no `super()` `applyOptions` cascade here); the new `_childStores`/`_associatedSeed` fields are plain initialized fields.
- **Decompose-large-functions** — `sync()` is already decomposed by the sync plan; this plan adds one named phase (`syncCascade`) plus `stampForeignKeys`/`buildChildStore` helpers, each one nameable step, honoring the rule.

---

## Critical Files

- [`src/typescript/lib/data/AbstractModel.ts`](../src/typescript/lib/data/AbstractModel.ts) — `ensureIndex` (schema resolution to mirror), `createRecord` (the eager-hydration site, [L107](../src/typescript/lib/data/AbstractModel.ts#L107)).
- [`src/typescript/lib/data/ModelRecord.ts`](../src/typescript/lib/data/ModelRecord.ts) — `getData`/`getId`/`getModel`, the constructor that gains the seed param; `getInternalId` (from `data-field-types-and-validation`) used as the pre-sync child identity.
- [`src/typescript/lib/data/AbstractStore.ts`](../src/typescript/lib/data/AbstractStore.ts) — the reworked `sync()` orchestrator (from `data-store-sync-and-events`) the cascade phase plugs into; `loadData`/`add`/`getById`/`remoteFilter` wiring used by child stores.
- [`src/typescript/lib/data/Store.ts`](../src/typescript/lib/data/Store.ts) — the concrete child store built per association.
- [`src/typescript/lib/data/Field.ts`](../src/typescript/lib/data/Field.ts) — `getMapping`/`getName`, the descriptor/behaviour split `Association` mirrors.
- [`src/typescript/lib/data/index.ts`](../src/typescript/lib/data/index.ts) — export surface.
- The four sibling plans (this plan consumes their abstractions; do not re-spec): [`data-field-types-and-validation`](./data-field-types-and-validation.md), [`data-proxy-reader-writer`](./data-proxy-reader-writer.md), [`data-store-sync-and-events`](./data-store-sync-and-events.md), [`data-store-collection-and-aggregation`](./data-store-collection-and-aggregation.md).

---

## Non-Goals

- **Many-to-many / through associations** — only hasMany and belongsTo, per the brief.
- **Multi-level / recursive cascade beyond one hop** — cascade walks a parent's direct hasMany children; grandchild cascade falls out of each child store being a normal store (its own `cascadeSync`), but is not specially orchestrated or tested here.
- **Orphan cleanup / delete-ordering guarantees beyond "children sync before parent delete"** — server-side cascade delete is assumed for the deep case.
- **A nested-aware `Writer` class** — `'nested'` persistence ships the per-association switch + `getDataWithNested()` hook; wiring a concrete nested writer is left to the consumer / a follow-up.
- **Re-specifying the four dependency plans** — conversion, `remoteFilter`, the `sync()` rework / `'exception'` event, and the collection API are consumed, not redefined.
- **Inverse-association auto-maintenance** — setting a child's `belongsTo` does not auto-insert it into the owner's hasMany store; the two are independent stores.
