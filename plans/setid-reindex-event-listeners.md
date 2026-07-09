# setId Event-Listener Reindex — Implementation Plan

## Overview

`Component.setId(id)` re-points the component's per-component `StyleRule` and the DOM element's `id`, but does **not** migrate the component's `Event` listener registrations. In [`core/Event.ts`](src/typescript/lib/core/Event.ts), both `addListener` (exact-target, `listenerMap`) and `addSubtreeListener` (`subtreeListenerMap`) store their `CompFunc` keyed by `component.getId()` **at registration time** ([Event.ts:244](src/typescript/lib/core/Event.ts#L244), [Event.ts:251](src/typescript/lib/core/Event.ts#L251), [Event.ts:334-338](src/typescript/lib/core/Event.ts#L334)), while the window-level `baseListener` matches incoming events by walking DOM element ids via `DOM.source.getId(handle)` ([Event.ts:112](src/typescript/lib/core/Event.ts#L112), [Event.ts:132-135](src/typescript/lib/core/Event.ts#L132)). After a `setId` that changes the id, the element's id no longer equals the map key: every listener registered **before** the `setId` is silently orphaned (never fires), and `removeListener` / `removeSubtreeListener` — which look up `component.getId()` = the **new** id ([Event.ts:277](src/typescript/lib/core/Event.ts#L277), [Event.ts:360](src/typescript/lib/core/Event.ts#L360)) — can neither find nor clean the stale entry.

Real-world impact: `Component.attachWheelScrolling()` registers the eased `SmoothScroller` wheel listener as `Event.addSubtreeListener(this, "wheel", this.onWheelScroll, { passive: false })` at the moment `autoScroll` turns on ([Component.ts:3413](src/typescript/lib/core/Component.ts#L3413)). A later `setId` (e.g. a `Dock` restoring a serialized layout keyed by id, or sqladmin's Card-deck page id) orphans that listener, so the container falls back to native (non-smooth) scrolling.

The fix: add an internal `Event.reindexComponent(oldId, newId)` that moves this component's `CompFunc` from `oldId` to `newId` in **both** `listenerMap` and `subtreeListenerMap`, and call it from `Component.setId` with the id captured **before** `super.setId` mutates it. The `viewportListenerMap` is iterated wholesale by `baseViewportListener` ([Event.ts:147-167](src/typescript/lib/core/Event.ts#L147)) — it never keys dispatch on the element id — so it is **unaffected** and must not be touched.

---

## Architecture Decisions

### `Event.reindexComponent(oldId, newId)` migrates both id-keyed maps, never the viewport map

Dispatch correctness depends on the map key equalling the live element id for exactly the two maps the `baseListener` looks up by id: `listenerMap` (exact target, [Event.ts:109-119](src/typescript/lib/core/Event.ts#L109)) and `subtreeListenerMap` (ancestor walk, [Event.ts:125-144](src/typescript/lib/core/Event.ts#L125)). Both are `Map<eventType, Map<id, CompFunc>>`. The reindex iterates every type-map in each and, where a `CompFunc` is stored under `oldId`, moves it to `newId` (`typeMap.set(newId, cf); typeMap.delete(oldId)`). `viewportListenerMap` is deliberately excluded: `baseViewportListener` iterates all entries of a type-map and fires every registered `CompFunc` regardless of key ([Event.ts:155-166](src/typescript/lib/core/Event.ts#L155)), so its id key is inert bookkeeping — reindexing it would be dead work and would blur the "only the two id-routed maps need it" invariant.

### `oldId === newId` and missing-key are both no-ops — and the equality guard is load-bearing

If `oldId === newId`, `reindexComponent` returns immediately. This is not merely an optimization: the naive `set(newId, cf); delete(oldId)` sequence with equal keys would **delete the entry it just re-set**, actively destroying live registrations. `Component.setId` is called during construction whenever an `{ id }` option is present ([Component.ts:482](src/typescript/lib/core/Component.ts#L482)), so a real path can hit equal-or-trivial ids; the guard makes the whole operation safe to call unconditionally. When a given type-map has no entry under `oldId` (the common case — most components register listeners for only a handful of event types), that type-map is skipped; the overall call is a no-op when the component had no listeners at all.

### Collision policy: move wins, because ids are unique per component

The `getId()` UUID is unique per `BaseObject` ([BaseObject.ts:16](src/typescript/lib/core/BaseObject.ts#L16)); the framework's own contract (e.g. `Dock` serialization keys off id uniqueness) treats ids as unique. So `newId` cannot legitimately already hold **another** component's `CompFunc`. The migration therefore just moves (`set` then `delete`); no merge of two components' listener arrays is attempted. If a consumer violated uniqueness by assigning a duplicate id, the move would overwrite — that is an upstream id-collision bug, out of scope here, and merging would be the wrong repair (it would fan a component's events onto a foreign component's listeners).

### `reindexComponent` is exported from the `Event` namespace but marked `@internal`

`Event` is a `namespace` and `Component.ts` is a separate module, so the only way `Component.setId` can call the helper is for it to be an `export function` inside the namespace — TypeScript has no module-internal-but-cross-module visibility for namespace members. To keep it off the public API surface, tag its JSDoc `@internal`: TypeDoc excludes `@internal` members from the docs build ([CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), *Don't `{@link}` internal symbols*), so it does not appear as public `Event` API and no consumer-facing doc references it. Component already imports the namespace (`import { Event } from "~/core/Event.js"`, [Component.ts:16](src/typescript/lib/core/Component.ts#L16)), so no new import is needed.

### Capture `oldId` before `super.setId`

`Component.setId` currently calls `super.setId(id)` first ([Component.ts:1261](src/typescript/lib/core/Component.ts#L1261)), which writes `BaseObject._id = id` ([BaseObject.ts:34](src/typescript/lib/core/BaseObject.ts#L34)) — after that point `this.getId()` returns the **new** id and the old key is unrecoverable. The fix reads `const oldId = this.getId()` on the first line of `Component.setId`, before `super.setId(id)`, then calls `Event.reindexComponent(oldId, id)` after the id has changed. The `reindexComponent` internal guard already handles `oldId === id`, so `setId` needs no extra conditional.

---

## Public API

No consumer-facing API changes. One internal namespace export is added:

```typescript
// core/Event.ts — inside `export namespace Event`
/**
 * @internal Migrates a component's exact-target and subtree listener
 * registrations from `oldId` to `newId` after its id changes. No-op when the
 * ids are equal or the component has no registrations. Does not touch viewport
 * listeners (dispatched by whole-map iteration, not by id).
 */
export function reindexComponent(oldId: string, newId: string): void;
```

`Component.setId(id: string): this` keeps its signature; only its body gains the capture + reindex call.

---

## Internal Structure

`reindexComponent` body (mirrors the `Map<String, Map<String, CompFunc>>` shape used throughout Event.ts — note the map keys are `String` objects there, but `.get`/`.set` with primitive `string` keys interoperate exactly as the existing code already relies on):

```typescript
export function reindexComponent(oldId: string, newId: string): void {
    if (oldId === newId) {
        return;
    }

    for (const typeMap of listenerMap.values()) {
        const compFunc = typeMap.get(oldId);
        if (compFunc) {
            typeMap.set(newId, compFunc);
            typeMap.delete(oldId);
        }
    }

    for (const typeMap of subtreeListenerMap.values()) {
        const compFunc = typeMap.get(oldId);
        if (compFunc) {
            typeMap.set(newId, compFunc);
            typeMap.delete(oldId);
        }
    }
}
```

`Component.setId` change ([Component.ts:1260](src/typescript/lib/core/Component.ts#L1260)):

```typescript
setId(id: string): this {
    const oldId = this.getId();

    super.setId(id);

    Event.reindexComponent(oldId, id);

    // …existing StyleRule re-point + DOM.sink.setId + applyStyle unchanged…
}
```

---

## Ordered Implementation Steps

1. **Write the regression tests first** (they fail red against current code). Add a new `describe('Modelled event delivery — setId reindex', …)` block to [`tests/dom/events.test.ts`](tests/dom/events.test.ts), modelled on the existing delivery tests there (same `CONFIG`, `uniqueType()`, `afterEach(() => DOM.reset())`, `getElement(true)` + `DOM.sink.dispatchEvent(el, makeEvent(el, type))` pattern). Cover the cases in **Expected Behaviour**. Run `npx vitest run tests/dom/events.test.ts` — the reindex cases must fail (listener does not fire after `setId`).
2. **Add `reindexComponent` to `core/Event.ts`.** Insert the `export function` (body in *Internal Structure*) inside `export namespace Event`, e.g. immediately after `removeSubtreeListener` ([Event.ts:383](src/typescript/lib/core/Event.ts#L383)). Include the `@internal` JSDoc.
3. **Wire it into `Component.setId`** ([Component.ts:1260](src/typescript/lib/core/Component.ts#L1260)): add `const oldId = this.getId();` as the first line, keep `super.setId(id)`, then call `Event.reindexComponent(oldId, id)` after it (before the existing `StyleRule` re-point). No new import — `Event` is already imported ([Component.ts:16](src/typescript/lib/core/Component.ts#L16)).
4. **Re-run** `npx vitest run tests/dom/events.test.ts` — reindex cases now pass green.
5. **Run the existing Event suites** to confirm no accounting regression: `npx vitest run tests/dom/events.test.ts tests/unit/core/Event.test.ts`.
6. **Typecheck + full suite:** `npm run test` (runs `typecheck:test` then `vitest run`).
7. **Grep invariant:** `grep -rn "reindexComponent" src/` — expect exactly two matches (definition in Event.ts, call in Component.ts).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Event.ts` — add `reindexComponent` |
| Modify | `src/typescript/lib/core/Component.ts` — capture `oldId`, call reindex in `setId` |
| Modify | `tests/dom/events.test.ts` — add `setId reindex` describe block |

---

## Expected Behaviour

All cases below are **unit-testable** with the modelled delivery harness in `tests/dom/events.test.ts` (`makeEvent` + `DOM.sink.dispatchEvent` drive the real `baseListener`; `getElement(true)` realises the element and records its id onto the stub, and `component.setId(newId)` updates the stub id via `DOM.sink.setId`). No manual verification is required for the fix itself.

1. **Exact-target listener survives `setId`.** Realise `comp.getElement(true)`; `Event.addListener(comp, type, fn)`; `comp.setId("new-id")`; `DOM.sink.dispatchEvent(comp.getElement()!, makeEvent(comp.getElement()!, type))` → `fn` fires exactly once (and `this === comp`).
2. **Subtree listener survives `setId`.** `root.getElement(true)`; `root.addComponent(child)`; `Event.addSubtreeListener(root, type, fn)`; `root.setId("new-root")`; dispatch with target = `child.getElement()!` → `fn` fires once (the ancestor walk reaches `root`'s new id).
3. **`removeListener` after `setId` still removes.** Register (exact-target) before `setId`; `comp.setId("new-id")`; `Event.removeListener(comp, type, fn)`; dispatch → `fn` does **not** fire (the entry, now re-keyed to the new id, is found and deleted; no orphan left behind).
4. **`removeSubtreeListener` after `setId` still removes.** Same as (3) for the subtree map.
5. **`oldId === newId` no-op.** Register a listener; `comp.setId(comp.getId())` (same id); dispatch → listener still fires exactly once (the equality guard prevents the set-then-delete self-destruct).
6. **No-listener no-op.** `comp.setId("x")` on a component with zero registrations does not throw and records no spurious writes.
7. **Viewport listener unaffected.** (Regression guard for the exclusion.) `Event.addViewportListener(comp, type, fn)`; `comp.setId("new-id")`; dispatch an event whose target is an **unrelated** component → `fn` still fires (viewport dispatch never keyed on id, so `setId` neither helps nor harms it — asserts we did not accidentally break it).

---

## Verification

- `npm run test` — typecheck (`typecheck:test`) + full `vitest run` green.
- `npx vitest run tests/dom/events.test.ts tests/unit/core/Event.test.ts` — new reindex cases pass; existing exact-target / subtree / viewport / accounting cases unchanged.
- `grep -rn "reindexComponent" src/` — exactly two matches.
- No `npm run docs:build` gate needed for public JSDoc changes (the only new symbol is `@internal`), but running it must still finish with zero warnings since we added an `@internal` JSDoc block.

---

## Documentation Impact

None required. This is an internal correctness fix to an existing public method; no public API is added (the new symbol is `@internal`) and no behaviour a doc page describes changes in contract — `setId` was always meant to fully re-point the component, and this restores that. The two existing `setId` mentions ([`docs/concepts/dom-seams.md`](docs/concepts/dom-seams.md) lists it as a seam op; [`docs/components/Dock.md`](docs/components/Dock.md) cites it as the serialization key) remain accurate and need no edit — indeed the Dock serialization path is a beneficiary of the fix.

---

## Potential Challenges

- **`getId()`-before-`super()` ordering.** Reading `oldId` after `super.setId(id)` would capture the new id and silently make the reindex a no-op — the whole fix hinges on capturing first. Mitigation: `const oldId = this.getId()` is the first statement; the plan pins it and the `oldId === newId` test would catch a regression only weakly, so the exact-target/subtree tests (which change to a genuinely different id) are the real guard.
- **`oldId === newId` self-destruct.** `set(id, cf)` then `delete(id)` on equal keys destroys a live registration. Mitigation: the early-return guard in `reindexComponent`, covered by Expected Behaviour case 5.
- **No double-registration / no duplication.** The operation *moves* (`set` + `delete`), never copies, so a component's listener array is never duplicated across two keys; after reindex the `CompFunc` exists under exactly one key. Construction-time `setId` (the `{ id }` option path) runs before any listeners are registered under the UUID, so it is a harmless no-op then.
- **Dispatch-time DOM id vs component-field id equivalence.** The fix relies on the invariant that after `setId` the element's DOM id (what `baseListener` reads via `DOM.source.getId`) equals `component.getId()` (the new map key). `Component.setId` already writes `DOM.sink.setId(element, id)` right after ([Component.ts:1279](src/typescript/lib/core/Component.ts#L1279)), so the two stay in lockstep; the reindex simply makes the *map key* track the same new id. If the element is not yet realised, no event can target it until it is (at which point `getElement(true)` writes the current id), so the invariant holds either way.
- **`String` vs `string` map keys.** Event.ts declares the maps as `Map<String, …>` (boxed `String`) yet already `.get`/`.set`s them with primitive `string` ids everywhere; `reindexComponent` follows the exact same existing usage, so no new type friction is introduced.

---

## Critical Files

- [`src/typescript/lib/core/Event.ts`](src/typescript/lib/core/Event.ts) — the three id-keyed maps, `baseListener` dispatch, `add`/`removeListener`, `add`/`removeSubtreeListener`, `baseViewportListener` (to confirm the viewport exclusion).
- [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts) — `setId` ([1260](src/typescript/lib/core/Component.ts#L1260)), `attachWheelScrolling` ([3402](src/typescript/lib/core/Component.ts#L3402)) as the motivating real caller, the `Event` import ([16](src/typescript/lib/core/Component.ts#L16)).
- [`src/typescript/lib/core/BaseObject.ts`](src/typescript/lib/core/BaseObject.ts) — `setId`/`getId` semantics.
- [`tests/dom/events.test.ts`](tests/dom/events.test.ts) — the delivery harness the regression tests extend.
- [`tests/dom/TestDOM.ts`](tests/dom/TestDOM.ts) — `makeEvent`, `RecordingDOMSink.dispatchEvent`, `setId`→stub-id round-trip, `getId` read (why the delivery test works offline).

---

## Non-Goals

- Migrating `viewportListenerMap` — it is not id-routed at dispatch, so it needs no reindex (see Architecture Decisions).
- Re-pointing `_deferredStyleRules` (the per-component `:hover`/`:active`/`.selected` state rules) on `setId` — those are also keyed by id at creation ([Component.ts:736](src/typescript/lib/core/Component.ts#L736)) and may share this class of bug, but it is a separate concern outside the "event-listener re-key" scope of this plan.
- Any change to `setId`'s existing `StyleRule` re-point or `DOM.sink.setId` behaviour.
- Guarding against duplicate/colliding component ids — out of scope; ids are contractually unique.
