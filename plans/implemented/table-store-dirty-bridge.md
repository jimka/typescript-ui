---
depends-on:
  - component-dirty-state
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
---

# Table Store Dirty-State Bridge — Implementation Plan

## Overview

[`Table`](packages/lib/src/typescript/lib/component/table/Table.ts) can be bound to an [`AbstractStore`](packages/lib/src/typescript/lib/data/AbstractStore.ts), whose `hasPendingChanges()` ([AbstractStore.ts:1035](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1035)) reports unsynced record edits. Today only [`TablePanel`](packages/lib/src/typescript/lib/component/table/TablePanel.ts) and [`TreeTablePanel`](packages/lib/src/typescript/lib/component/table/TreeTablePanel.ts) read that flag, each through a private `refreshSyncButtons()` that exists purely to enable/disable their own Sync/Reject buttons. A bare `Table` — one dropped directly into a `Tab`, a `Window`, or a custom panel without going through `TablePanel` — has no way to tell anything hosting it "I have unsynced changes."

This plan makes `Table` call `Component`'s inherited, protected `setDirty()` ([Component.ts:2380](packages/lib/src/typescript/lib/core/Component.ts#L2380) — see [`plans/implemented/component-dirty-state.md`](plans/implemented/component-dirty-state.md) for the mechanism's full contract) from its bound store's `hasPendingChanges()`. `Table.isDirty()` then reflects the store, `onDirtyChange()` fires on every transition, and the framework's existing parent-to-child relay (`wireChild`/`unwireChild`) carries that signal to any ancestor — a `Tab`, a `Window`, a `TablePanel` — with no code in that ancestor reaching into the store itself. `TreeTable` ([`TreeTable extends Table`](packages/lib/src/typescript/lib/component/table/TreeTable.ts#L87)) inherits the wiring unchanged.

The change is two small private methods and one field on `Table`, wired at the three points `Table` already binds/unbinds its store (`constructor`, `setStore`, `destructor`), plus a test file, a doc section, and a small demo addition. No change to `Component.ts`, `AbstractStore.ts`, `ModelRecord.ts`, `TablePanel.ts`, or `TreeTablePanel.ts`.

---

## Architecture Decisions

### This is a deliberate, named exception to `component-dirty-state.md`'s "the two axes never derive from each other" rule

[`plans/implemented/component-dirty-state.md`](plans/implemented/component-dirty-state.md)'s Architecture Decisions draw an explicit line: `ModelRecord.isDirty()` / `AbstractStore.hasPendingChanges()` track domain data; `Component.isDirty()` tracks view edit-buffer state; "the vocabulary coincides; the two never derive from or feed into each other." This plan crosses that line on purpose. `Table` is not a data model — it is a `Component` that happens to be able to derive a domain-data fact through the one accessor it already owns (`getStore()`), the same way a future component's `isDirty()` might derive from any other read of its own state. The exception is warranted for the same reason `CodeEditor`'s adoption plan gave for `CodeEditor` itself: something *outside* `Table` — a `Tab`, a `Window`, a custom panel — wants a generic, store-implementation-agnostic way to know "does this embedded widget have work in flight," without reaching into `Table`'s internals or subscribing to store events itself.[^why-table-not-store]

### A new `bindDirtyRelay`/`unbindDirtyRelay` pair, not an extension of `bindSourceStore`/`unbindSourceStore`

`Table` already has a store-subscription pair, `bindSourceStore` / `unbindSourceStore` ([Table.ts:1255-1288](packages/lib/src/typescript/lib/component/table/Table.ts#L1255-L1288)), called from the constructor ([:314](packages/lib/src/typescript/lib/component/table/Table.ts#L314)), `setStore` ([:698](packages/lib/src/typescript/lib/component/table/Table.ts#L698), [:709](packages/lib/src/typescript/lib/component/table/Table.ts#L709)), and `destructor` ([:1649](packages/lib/src/typescript/lib/component/table/Table.ts#L1649)). Its documented purpose is narrow — rotated-view tracking and quick-search cache invalidation — and its event set (`load`, `add`, `remove`, `datachange`, `update`) is shaped for that purpose, not for `hasPendingChanges()`. This plan adds a second, independent pair, `bindDirtyRelay` / `unbindDirtyRelay`, placed directly after `unbindSourceStore` in the file and wired at the same three call sites, rather than folding a second responsibility into `onSourceStoreChange`.[^why-separate-pair]

### The dirty relay subscribes to the same five store events `TablePanel`, `PaginationBar`, and `AbstractSelectableList` already use for the same purpose

Three existing call sites already react to "does this store-derived thing need to be recomputed" with the identical event list `'load'`, `'add'`, `'remove'`, `'datachange'`, `'sync'`:

- `TablePanel.refreshSyncButtons()`'s own subscription ([TablePanel.ts:99-103](packages/lib/src/typescript/lib/component/table/TablePanel.ts#L99-L103)) — reacting to the same `hasPendingChanges()` this plan reads.
- `AbstractSelectableList.unbindStore()` ([AbstractSelectableList.ts:900-907](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L900-L907)) and its `setStore()` ([:1274-1295](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1274-L1295)).
- `PaginationBar` ([PaginationBar.ts:112-117](packages/lib/src/typescript/lib/component/display/PaginationBar.ts#L112-L117), plus its own `pagechange`).

`bindDirtyRelay` uses the same five-event array, `['load', 'add', 'remove', 'datachange', 'sync'] as const`, matching `AbstractSelectableList.unbindStore`'s literal shape exactly. `'update'` is not subscribed: `AbstractStore.notifyRecordChanged` always fires `'update'` immediately followed by `'datachange'` ([AbstractStore.ts:949-950](packages/lib/src/typescript/lib/data/AbstractStore.ts#L949-L950)), so `'datachange'` alone already catches a per-field edit — the same reason none of the three precedents subscribe to `'update'` either.

### `setStore()` rebinds the relay exactly where it already rebinds `bindSourceStore`/`unbindSourceStore`

`setStore()` unsubscribes from the outgoing store before reassigning `_store`, then resubscribes to the incoming one — the same bracket `unbindSourceStore(this._store)` / `bindSourceStore(store)` already uses at [Table.ts:698](packages/lib/src/typescript/lib/component/table/Table.ts#L698) and [:709](packages/lib/src/typescript/lib/component/table/Table.ts#L709), and the same shape `AbstractSelectableList.setStore()` uses for list-store rebinding ([:1274-1295](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1274-L1295)): unbind old, reassign, resubscribe new, recompute immediately so the flag never reads stale.

### `Table` has no "no store bound" case — the store is a required constructor argument

`AbstractSelectableList`'s store is optional (`_options.store: AbstractStore | undefined`), so its `unbindStore` guards on `!store`. `Table`'s constructor signature takes `store: AbstractStore` positionally with no default ([Table.ts:298](packages/lib/src/typescript/lib/component/table/Table.ts#L298)), so a `Table` cannot exist without one — there is no "never called `setStore()`" state to special-case. `isDirty()` reflects the constructor's store from the moment the constructor returns.

### `Table` gains no new public method — `isDirty()`/`onDirtyChange()`/`offDirtyChange()` are already inherited and public

Unlike `CodeEditor`, which needed a new `markClean()` because it had no other way to say "this edit buffer is now the accepted baseline," `AbstractStore` already owns that vocabulary: `sync()` clears `hasPendingChanges()` once every op commits ([AbstractStore.ts:1119-1147](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1119-L1147)), and `reject()` clears it by reverting ([:1060-1093](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1060-L1093)). `Table.sync()` and `Table.reject()` already forward to both ([:1079-1089](packages/lib/src/typescript/lib/component/table/Table.ts#L1079-L1089)). The relay is purely reactive: `setDirty(store.hasPendingChanges())` on every one of the five events. No new public surface on `Table` or `TreeTable`.

### `TablePanel`/`TreeTablePanel`'s `refreshSyncButtons()` is left exactly as it is — it does not derive from the new relay, and the new relay does not derive from it

Both stay wired to `this._table.getStore().hasPendingChanges()` / `this._treeTable.getStore().hasPendingChanges()` directly, unchanged. The two signals answer different questions and must not be merged: `refreshSyncButtons()` must reflect *only* the store's pending-changes state, because that is exactly what "click Sync" would act on; `Table.isDirty()` is a general presentation-state aggregate that, per `component-dirty-state.md`'s own contract, also folds in any dirty *descendant* — so a future component nested inside `Table` (a cell editor with its own edit buffer, say) that calls `setDirty()` would make `Table.isDirty()` `true` without the store having any pending changes at all. Driving the Sync button off `isDirty()` would then enable it when there is nothing to sync. Conversely, deriving `isDirty()` from `refreshSyncButtons()`'s button-enabled state would only work through `TablePanel`, defeating the entire point of moving the signal onto `Table` itself. The two stay independent, reading the same underlying store fact through two separate call paths for two separate purposes.

---

## Internal Structure

New field, placed directly after `_sourceUpdate` ([Table.ts:270](packages/lib/src/typescript/lib/component/table/Table.ts#L270)):

```typescript
// Set by bindDirtyRelay; guards unbindDirtyRelay the same way _sourceRefresh
// guards unbindSourceStore, though in practice bindDirtyRelay always runs
// first (constructor, then every setStore).
private _dirtyRelayRefresh: (() => void) | null = null;
```

New methods, placed directly after `unbindSourceStore` ([Table.ts:1276-1288](packages/lib/src/typescript/lib/component/table/Table.ts#L1276-L1288)):

```typescript
/**
 * Subscribes to the store events that can change {@link AbstractStore.hasPendingChanges},
 * recomputing this table's own dirty flag (see {@link Component.setDirty})
 * on each one — and once immediately, so a table constructed over an
 * already-dirty store reports dirty right away. Stores the callback in
 * `_dirtyRelayRefresh` so {@link unbindDirtyRelay} can remove exactly this
 * registration later.
 *
 * @param store - The store to subscribe to.
 */
private bindDirtyRelay(store: AbstractStore): void {
    const updateDirty = () => this.setDirty(store.hasPendingChanges());

    this._dirtyRelayRefresh = updateDirty;

    (['load', 'add', 'remove', 'datachange', 'sync'] as const).forEach(e =>
        store.on(e, updateDirty)
    );

    updateDirty();
}

/**
 * Unsubscribes the callback installed by {@link bindDirtyRelay} from `store`.
 *
 * @param store - The store to unsubscribe from.
 */
private unbindDirtyRelay(store: AbstractStore): void {
    if (!this._dirtyRelayRefresh) {
        return;
    }

    (['load', 'add', 'remove', 'datachange', 'sync'] as const).forEach(e =>
        store.off(e, this._dirtyRelayRefresh!)
    );
}
```

`bindDirtyRelay` folds the subscribe-then-seed sequence into one call (`AbstractSelectableList.setStore()` keeps them as two statements, `store.on(...)` then a separate `this.refreshFromStore()`); this plan's version is a same-shape simplification, not a different design — both resolve to "subscribe, then immediately compute a starting value."

Three call sites:

```typescript
// constructor, directly after this.bindSourceStore(store); (Table.ts:314)
this.bindDirtyRelay(store);
```

```typescript
// setStore(), bracketing unbindSourceStore/bindSourceStore (Table.ts:698, :709)
setStore(store: AbstractStore): this {
    this.setDisplayMode("normal");

    this._header.setStore(store);
    this.unbindSourceStore(this._store);
    this.unbindDirtyRelay(this._store);

    this._store = store;
    // … unchanged …

    this.bindSourceStore(store);
    this.bindDirtyRelay(store);

    // … unchanged …
}
```

```typescript
// destructor(), directly after this.unbindSourceStore(this._store); (Table.ts:1649)
this.unbindDirtyRelay(this._store);
```

### Demo addition (`MiscPanel.ts`)

The first `TablePanel` window demo — `buttonWindowTable`'s `on("action", ...)` handler ([MiscPanel.ts:284-348](packages/lib/src/typescript/MiscPanel.ts#L284-L348)) — currently ends its `win2.setContentFactory(() => { … })` closure with `return tablePanel;` directly after the existing `tableStore.sync();` call ([:341](packages/lib/src/typescript/MiscPanel.ts#L341)). Replace that `return tablePanel;` with a small status row wrapping `tablePanel` in a `VBox`-laid-out `Panel`, wired to `tablePanel.onDirtyChange`:

```typescript
                // TODO: Will this lead to a race condition if we don't 'await'?
                tableStore.sync();

                // Proves Table.isDirty() — this plan's new store-derived
                // dirty flag — bubbling up through TablePanel via the
                // framework's existing parent-to-child relay: nothing in
                // TablePanel.ts reads or forwards it.
                const dirtyStatus = new Text('');
                const updateDirtyStatus = () =>
                    dirtyStatus.setText(`Dirty — table: ${tablePanel.isDirty() ? 'yes' : 'no'}`);
                tablePanel.onDirtyChange(updateDirtyStatus);
                updateDirtyStatus();

                const host = new Panel({ layoutManager: new VBox() });
                host.addComponent(tablePanel, { weight: 1 });
                host.addComponent(dirtyStatus);

                return host;
            });
```

`Text`, `Panel`, and `VBox` are already imported in `MiscPanel.ts` — no new imports. The local-`const`-inside-the-closure style matches the file's own existing shape (`tableStore`, `tablePanel`, `rows` are all plain closure locals, not class fields), diverging cosmetically from `CodeEditorPanel.ts`'s private-field shape for the same kind of status row — a cosmetic difference in a different file's established style, not a pattern-conformance violation.

---

## Ordered Implementation Steps

1. **[Table.ts:270](packages/lib/src/typescript/lib/component/table/Table.ts#L270)** — add the `_dirtyRelayRefresh` field directly after `_sourceUpdate`, from **Internal Structure**.

2. **[Table.ts:1288](packages/lib/src/typescript/lib/component/table/Table.ts#L1288)** (directly after `unbindSourceStore` ends) — add `bindDirtyRelay` and `unbindDirtyRelay`, from **Internal Structure**.

3. **[Table.ts:314](packages/lib/src/typescript/lib/component/table/Table.ts#L314)** — in the constructor, directly after `this.bindSourceStore(store);`, add `this.bindDirtyRelay(store);`.

4. **[Table.ts:698](packages/lib/src/typescript/lib/component/table/Table.ts#L698) and [:709](packages/lib/src/typescript/lib/component/table/Table.ts#L709)** — in `setStore()`, add `this.unbindDirtyRelay(this._store);` directly after `this.unbindSourceStore(this._store);` (before the `this._store = store;` reassignment), and `this.bindDirtyRelay(store);` directly after `this.bindSourceStore(store);`.

5. **[Table.ts:1649](packages/lib/src/typescript/lib/component/table/Table.ts#L1649)** — in `destructor()`, add `this.unbindDirtyRelay(this._store);` directly after `this.unbindSourceStore(this._store);`.

6. Check: `grep -n 'this\.\(un\)\?bindDirtyRelay(' packages/lib/src/typescript/lib/component/table/Table.ts` — exactly four matches: the constructor call, the `setStore` unbind/bind pair, and the `destructor` call.

7. **Create `packages/lib/tests/component/table/Table.dirtyState.test.ts`**, modelled on [`Table.classStyleDefaults.test.ts`](packages/lib/tests/component/table/Table.classStyleDefaults.test.ts) for the harness boilerplate (`installTestDOM(CONFIG)`, the same `MODEL`/`MemoryStore` construction `Table.test.ts` already uses) and on [`dispose-store-subscription-teardown.test.ts`](packages/lib/tests/component/dispose-store-subscription-teardown.test.ts) for the store-double shape. Cover every case in **Expected Behaviour**.

8. Run `cd packages/lib && npm run typecheck && npm test` — clean, including the new test file and `dispose-store-subscription-teardown.test.ts` (unmodified, still green — see **Potential Challenges**).

9. Run `cd packages/lib && npm run lint` — no new findings.

10. **[`packages/lib/docs/components/Table.md`](packages/lib/docs/components/Table.md)** — add a `## Dirty state` section (see **Documentation Impact**).

11. **[`packages/lib/src/typescript/MiscPanel.ts`](packages/lib/src/typescript/MiscPanel.ts)** — extend the first `TablePanel` window demo per **Internal Structure**'s *Demo addition* subsection.

12. **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — add a bullet under `## Added` → `### Components` (see **Documentation Impact**).

13. Run `cd packages/lib && npm run docs:llms && npm run docs:api` — zero warnings.

14. Run the manual browser check in **Verification**.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Create | `packages/lib/tests/component/table/Table.dirtyState.test.ts` |
| Modify | `packages/lib/docs/components/Table.md` |
| Modify | `packages/lib/src/typescript/MiscPanel.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify (regenerate) | `packages/lib/llms.txt` |

---

## Expected Behaviour

All offline-testable — this is store-event wiring and a boolean recompute, no DOM writes, so nothing here needs manual browser verification except the demo status row.

**Initial state.**

1. `new Table(new MemoryStore(MODEL, []))` (empty store, never loaded): `table.isDirty()` is `false`.
2. A store already dirty *before* the table is constructed — `const store = new MemoryStore(MODEL, []); store.add({...});` then `new Table(store)` — reports `table.isDirty()` `true` immediately, with no event needed to "catch up" (the seed call inside `bindDirtyRelay`).

**Reacting to store mutation.**

3. `store.add({...})` on an already-constructed table's store makes `table.isDirty()` `true`.
4. `onDirtyChange` fires exactly once per real transition: a listener registered via `table.onDirtyChange(fn)` fires once with `true` on `store.add(...)`, zero more times on a second `store.add(...)`.
5. `await table.sync()` (the store's `MemoryProxy` accepts the create) makes `table.isDirty()` `false` again, firing the listener once with `false`.
6. Editing a committed (not new) record — seed the store with `store.loadData([{...}])` (which loads records as already-committed, per `AbstractStore.loadData`'s own contract, unlike `store.add()`), then `store.getAt(0)!.set(field, newValue)` — makes `table.isDirty()` `true`; `table.reject()` makes it `false` again.
7. Removing a record — on a store seeded via `loadData` as in case 6, `store.remove(record)` — makes `table.isDirty()` `true` (pending removal); `table.reject()` restores it and returns `isDirty()` to `false`.

**`setStore()` rebind safety.**

8. `table.setStore(newStore)` where `newStore` has no pending changes: `table.isDirty()` becomes `false` (even if the old store was dirty). Mutating the **old** store afterward (`oldStore.add({...})`) does not change `table.isDirty()` — the old subscription is gone. Mutating the **new** store (`newStore.add({...})`) does — the new subscription is live.

**Ancestor relay.**

9. `parent = new Component(); parent.addComponent(table);` with `store.add({...})` on the table's store: `parent.isDirty()` becomes `true` and a `dirtychange` listener on `parent` fires once — proving the framework's existing `wireChild` relay carries the store-derived flag with no code added to `parent`. (This does not re-test the generic relay itself, already covered by `dirty-state-propagation.test.ts`; it only confirms `Table` feeds into it.)

**Teardown.**

10. `table.dispose()` after `store.add({...})` leaves `table.isDirty()` at whatever it was (dispose does not clear it), and — the coverage `dispose-store-subscription-teardown.test.ts` already provides — leaves zero listeners registered on `store` across every event bucket including `'sync'`.

**`TreeTable` inherits this unchanged.**

11. `new TreeTable(store, spec)` (per the spec shape in [`TreeBody.test.ts:42`](packages/lib/tests/component/table/TreeBody.test.ts#L42)) over a store with a pending record reports `treeTable.isDirty()` `true` with no code written on `TreeTable` — confirming the inheritance claim. One case is enough; `TreeTable` adds no override anywhere in the path this plan touches.

**Manual verification (browser).**

12. `npm run dev` → <http://localhost:8015> → **Misc.** section → click **"Show window with table (slow)!"**. The window opens with a status row reading `Dirty — table: no` (the demo's existing `tableStore.sync()` call already leaves it clean by the time the window shows). Double-click a cell, edit it, and commit: the row flips to `Dirty — table: yes`. Click the panel's own **Sync** button (already part of `TablePanel`'s toolbar): the row returns to `Dirty — table: no`.

---

## Verification

- `cd packages/lib && npm run typecheck` — clean.
- `cd packages/lib && npm test` — clean, including all 11 offline cases above and the unmodified `dispose-store-subscription-teardown.test.ts`.
- `cd packages/lib && npm run lint` — no new findings.
- `cd packages/lib && npm run docs:llms && npm run docs:api` — zero warnings.
- `grep -n 'this\.setDirty(' packages/lib/src/typescript/lib/component/table/Table.ts` — exactly one match, inside `bindDirtyRelay`.
- `grep -n 'setDirty\|isDirty\|onDirtyChange' packages/lib/src/typescript/lib/component/table/TablePanel.ts packages/lib/src/typescript/lib/component/table/TreeTablePanel.ts` — zero matches; confirms neither panel class was touched.
- `git diff --name-only` lists none of `Component.ts`, `AbstractStore.ts`, `ModelRecord.ts`, `TablePanel.ts`, `TreeTablePanel.ts`.
- Manual: `npm run dev` → <http://localhost:8015> → **Misc.** → case 12 above.

---

## Documentation Impact

- **[`packages/lib/docs/components/Table.md`](packages/lib/docs/components/Table.md)** — add a `## Dirty state` section directly before `## Events` ([:327](packages/lib/docs/components/Table.md#L327)), matching the shape of [`CodeEditor.md`](packages/lib/docs/components/CodeEditor.md)'s own `## Dirty state` section ([:84-86](packages/lib/docs/components/CodeEditor.md#L84-L86)). State: the table reports itself dirty, through the framework's [`Component.isDirty()`](/api/core/classes/Component) mechanism, whenever its bound store's `hasPendingChanges()` is true; the flag updates automatically as the store's records are added, removed, edited, loaded, or synced, and clears once every pending change is synced or rejected; `isDirty()` folds up into every ancestor container automatically, so a `Tab`, `Window`, or custom panel hosting a bare `Table` can ask `isDirty()` without reaching into the store; swapping stores with `setStore()` re-derives the flag from the new store immediately; `TreeTable` inherits this unchanged; and this is a separate signal from `TablePanel`'s own Sync/Reject button enablement, which reads the store directly.
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)** — under the existing `## Added` → `### Components` heading ([:64](packages/lib/docs/reference/changelog/next.md#L64)), add a bullet mirroring the `CodeEditor` bullet already there ([:72-77](packages/lib/docs/reference/changelog/next.md#L72-L77)): `Table` (and `TreeTable`, by inheritance) now reports itself dirty through `Component.isDirty()` whenever its bound store has unsynced changes, updating automatically as the store changes and clearing on sync or reject. No consumer action is needed; `TablePanel`/`TreeTablePanel`'s own Sync/Reject button logic is unchanged.
- **`packages/lib/llms.txt`** — regenerate via `npm run docs:llms`; per `component-dirty-state.md`'s own precedent, this is likely a no-op (the manifest is hand-curated and a new adopter of an already-exported class's already-exported method rarely changes it) — still run the command to confirm rather than skip it.
- No `{@link}` to the private `bindDirtyRelay`/`unbindDirtyRelay` or the protected `setDirty` from any public-facing doc, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s *Don't `{@link}` internal symbols*.

---

## Potential Challenges

- **`dispose-store-subscription-teardown.test.ts` is not modified, but must still pass.** Its `totalListeners` helper ([:47-52](packages/lib/tests/component/dispose-store-subscription-teardown.test.ts#L47-L52)) already sums the `'sync'` bucket among others; a missing `unbindDirtyRelay(this._store)` call in `destructor()` would leave one extra listener in that bucket and fail this pre-existing test's `Table` and `TablePanel` cases without any change to the test file itself. Treat a failure there as a signal step 5 was skipped, not a reason to edit the test.
- **`MemoryStore`'s constructor `data` argument is not loaded until `.load()` is called.** A test that passes initial rows to `new MemoryStore(MODEL, rows)` and expects them present must call `await store.load()` first (see [Table.test.ts:35-36](packages/lib/tests/component/table/Table.test.ts#L35-L36)) — otherwise `getCount()` is `0` and `hasPendingChanges()` is trivially `false` regardless of this plan's change.
- **`sync()` no-ops silently when the store has no proxy configured**, firing neither `'sync'` nor `'datachange'` ([AbstractStore.ts:1122-1124](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1122-L1124)). `MemoryStore` always carries its own `MemoryProxy` ([MemoryStore.ts:25](packages/lib/src/typescript/lib/data/MemoryStore.ts#L25)), so this does not affect the test file's own store double, but it does mean `Table.sync()` is a true no-op — not just an unsynced state — on a table bound to a plain `Store` with no proxy ever set.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) — `_sourceRefresh`/`_sourceUpdate` fields ([:269-270](packages/lib/src/typescript/lib/component/table/Table.ts#L269-L270)), constructor ([:298-320](packages/lib/src/typescript/lib/component/table/Table.ts#L298-L320)), `setStore` ([:694-728](packages/lib/src/typescript/lib/component/table/Table.ts#L694-L728)), `bindSourceStore`/`unbindSourceStore` ([:1255-1288](packages/lib/src/typescript/lib/component/table/Table.ts#L1255-L1288)), `sync`/`reject` ([:1079-1089](packages/lib/src/typescript/lib/component/table/Table.ts#L1079-L1089)), `destructor` ([:1648-1655](packages/lib/src/typescript/lib/component/table/Table.ts#L1648-L1655)). The file being changed.
- [`packages/lib/src/typescript/lib/component/table/TablePanel.ts`](packages/lib/src/typescript/lib/component/table/TablePanel.ts) and [`TreeTablePanel.ts`](packages/lib/src/typescript/lib/component/table/TreeTablePanel.ts) — `refreshSyncButtons()` and its constructor/destructor event wiring ([TablePanel.ts:96-153](packages/lib/src/typescript/lib/component/table/TablePanel.ts#L96-L153)). **The event-list precedent this plan's relay mirrors**; read to confirm neither file changes.
- [`packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts) — `setStore` ([:1274-1295](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L1274-L1295)) and `unbindStore` ([:895-907](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L895-L907)). **The rebind-safety precedent this plan's `setStore()` change mirrors.**
- [`packages/lib/src/typescript/lib/component/display/PaginationBar.ts`](packages/lib/src/typescript/lib/component/display/PaginationBar.ts) — its store-event subscription ([:112-119](packages/lib/src/typescript/lib/component/display/PaginationBar.ts#L112-L119), [:156-161](packages/lib/src/typescript/lib/component/display/PaginationBar.ts#L156-L161)). Third confirmation of the five-event list.
- [`packages/lib/src/typescript/lib/data/AbstractStore.ts`](packages/lib/src/typescript/lib/data/AbstractStore.ts) — `hasPendingChanges` ([:1035-1047](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1035-L1047)), `sync` ([:1119-1147](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1119-L1147)), `reject` ([:1060-1093](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1060-L1093)), `notifyRecordChanged`'s `'update'`-then-`'datachange'` order ([:942-950](packages/lib/src/typescript/lib/data/AbstractStore.ts#L942-L950)). Read-only; confirms the event/state contract this plan relies on.
- [`plans/implemented/component-dirty-state.md`](plans/implemented/component-dirty-state.md) — the mechanism's contract (`isDirty()`/`setDirty()`/`onDirtyChange()`/`offDirtyChange()`, the `wireChild`/`unwireChild` relay) and its "never derive from each other" rule this plan is an explicit exception to.
- [`plans/implemented/code-editor-dirty-state-adoption.md`](plans/implemented/code-editor-dirty-state-adoption.md) — the adopter-shape precedent: doc "## Dirty state" section, demo status row driven by `onDirtyChange`, offline test-file shape.
- [`packages/lib/tests/component/dispose-store-subscription-teardown.test.ts`](packages/lib/tests/component/dispose-store-subscription-teardown.test.ts) — the existing registry test that must keep passing unmodified; its `totalListeners` helper already checks the `'sync'` bucket this plan adds to.
- [`packages/lib/tests/component/table/Table.test.ts`](packages/lib/tests/component/table/Table.test.ts) and [`Table.classStyleDefaults.test.ts`](packages/lib/tests/component/table/Table.classStyleDefaults.test.ts) — store/harness construction precedent for the new test file.
- [`packages/lib/tests/component/table/TreeBody.test.ts:42`](packages/lib/tests/component/table/TreeBody.test.ts#L42) — the minimal `TreeTableSpec`-shaped object to construct a `TreeTable` in a test.
- [`packages/lib/src/typescript/MiscPanel.ts`](packages/lib/src/typescript/MiscPanel.ts) — the demo file being extended; the first `TablePanel` window block, `buttonWindowTable`'s `on("action", ...)` handler ([:284-348](packages/lib/src/typescript/MiscPanel.ts#L284-L348)).
- [`packages/lib/docs/components/CodeEditor.md:84-86`](packages/lib/docs/components/CodeEditor.md#L84-L86) — the `## Dirty state` section shape to mirror on `Table.md`.
- [ARCHITECTURE.md](ARCHITECTURE.md) — *Keep presentation state out of data Models* (confirms `Row`/`Cell`'s `.dirty` CSS tint stays untouched), *Event handling* (confirms no `on`/`off`/`emit` collision — `Table`'s own `TableEvent` overload set at [Table.ts:397-429](packages/lib/src/typescript/lib/component/table/Table.ts#L397-L429) is unrelated to the inherited `onDirtyChange`).

---

## Non-Goals

- **No change to `Component.ts`, `AbstractStore.ts`, or `ModelRecord.ts`.** The mechanism and the store's own dirty vocabulary are used as they already exist.
- **No change to `TablePanel.ts` / `TreeTablePanel.ts` source.** `refreshSyncButtons()` stays exactly as it is — see **Architecture Decisions**. They gain a working `isDirty()`/`onDirtyChange()` only through the pre-existing `Component` relay, with zero lines changed in either file.
- **No new public API on `Table` or `TreeTable`.** `isDirty()` / `onDirtyChange()` / `offDirtyChange()` are inherited and already public; no `markClean()`-equivalent is added, since `AbstractStore` already owns the "this is now clean" vocabulary via `sync()`/`reject()`.
- **No visual decoration on `Table` itself.** No dirty-state CSS, no badge, no icon painted by the library. `component-dirty-state.md` made the same call for the base mechanism; this plan doesn't reopen it.
- **No change to `Row`/`Cell`/`TreeRow`'s existing `.dirty` CSS state.** That stays wired to `ModelRecord.isDirty()` directly, per `component-dirty-state.md`'s own confirmed-untouched axis.
- **No new demo panel or `main.ts` section.** The demo addition extends an existing `MiscPanel.ts` block; `TablePanel` gains no dedicated standalone demo in this plan.

---

## Notes

[^why-table-not-store]: The alternative — teaching `AbstractStore` itself to expose `hasPendingChanges()` through some `Component`-shaped surface — was not seriously considered: `AbstractStore` is not a `Component` and has no relay to bubble through; the whole value of `Component.isDirty()` is the automatic ancestor propagation `wireChild`/`unwireChild` already provide for free. `Table` is the natural place because it is the one `Component` that already holds a reference to the store (`getStore()`) and already sits in the component tree the relay walks. `hasPendingChanges()`'s own JSDoc even names this exact use case: "Used by the pagination guard to prevent navigation that would silently discard in-memory edits. Also useful for 'unsaved changes' prompts" ([AbstractStore.ts:1032-1033](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1032-L1033)) — an "unsaved changes" prompt is precisely the ancestor-facing use case this plan enables for a bare `Table`.

[^why-separate-pair]: Folding this into `bindSourceStore`/`onSourceStoreChange` was considered and rejected: that method's JSDoc scopes it to "so a rotated view tracks the record it displays, and so an active quick search's cached text … can be dropped" ([Table.ts:1246-1251](packages/lib/src/typescript/lib/component/table/Table.ts#L1246-L1251)) — a reader following that method should not also have to reason about dirty-state propagation, and `onSourceStoreChange` already runs meaningful, mode-dependent work (rotated-projection rebuilds) that a `hasPendingChanges()` recompute has no relationship to. `bindSourceStore` also does not subscribe to `'sync'`, which the dirty relay needs — extending it would mean widening a method whose contract is otherwise stable and tested, for a second, unrelated purpose. A parallel pair costs two small methods and three one-line call sites, and keeps each subscription's purpose readable on its own.
