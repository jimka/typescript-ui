---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/layout/LayoutConstraints.ts
  - packages/lib/docs/layouts/Constraints.md
  - packages/lib/docs/layouts/Tab.md
  - packages/lib/docs/reference/changelog/next.md
---

# Card deferred child keys — Implementation Plan

## Overview

[`Card`](packages/lib/src/typescript/lib/layout/Card.ts#L26) picks its one visible child by that child's component id — the resolution loop is [`Card.ts:215-226`](packages/lib/src/typescript/lib/layout/Card.ts#L215), reached from the [`setVisibleComponentId`](packages/lib/src/typescript/lib/layout/Card.ts#L146) setter. A child that has not been built has no component id, so `Card` cannot name one — and `Tab` is the only manager in the library that can register an unbuilt child at all ([`Tab.ts:1776`](packages/lib/src/typescript/lib/layout/Tab.ts#L1776) is the sole override of the [`LayoutManager.addDeferredComponent`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L93) seam).

This plan gives `Card` a second way to name a child: a **key**, supplied by the caller in the child's layout constraints. A key can name a live child or an unbuilt factory, so `container.addComponent(() => new Panel(), { key: "misc" })` registers a page that is constructed the first time `card.setVisibleKey("misc")` asks for it — or, when the key was selected before the registration, on the first layout pass of a rendered container.

Three source files change: `LayoutConstraints` gains the `key` field (and its `lazy` field's doc comment is corrected, because `Card` now reads `lazy` too), `Card` gains the key selector plus its `addDeferredComponent` override, and two sentences of `Component.addComponent`'s doc comment are corrected. The library's own demo-app navigation rebuild is the first consumer.[^demo-fit]

---

## Architecture Decisions

### The key is a `LayoutConstraints` field, and registration uses `Tab`'s idiom

A caller registers a deferred page exactly as they register a deferred tab — `container.addComponent(factory, constraints)` — and the key rides in the constraints as a new optional `key` field. `Card` claims the factory only when a key is present.[^key-on-constraints]

| `addComponent` call on a `Card`-managed container | Claimed? | Result |
|---|---|---|
| `addComponent(panel)` | n/a — not a factory | added now; selectable by id |
| `addComponent(() => panel)` | no — no `key` | built now, added now; selectable by id |
| `addComponent(() => panel, { lazy: true })` | no — no `key` | built now, added now, **and the missing key is reported** |
| `addComponent(() => panel, { key: "a" })` | **yes** | registered unbuilt; built on first `setVisibleKey("a")` |
| `addComponent(() => panel, { key: "a", lazy: false })` | no — deferral declined | built now, added now; selectable by key `"a"` or by id |
| `addComponent(() => panel, { key: "a" })` when `"a"` already names a slot | **yes, then discarded** | nothing is built; the first slot keeps the key, and the collision is reported |
| `addComponent(panel, { key: "a" })` | n/a — not a factory, so the hook never runs | added now; selectable by key `"a"` or by id, and it takes the key from any pending slot |

`lazy: false` declines the deferral on a `Card` for the same reason and with the same spelling as on a `Tab` ([`LayoutConstraints.ts:64`](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts#L64)), so a consumer who knows `Tab` writes one *registration* idiom for both. Selection is where they diverge and must: `Tab` selects by strip index or by live content, and has no by-name selection at all, so `setVisibleKey` is a capability `Card` gains rather than a second spelling of something `Tab` already has. `lazy: true` with no key is the one case the card reports rather than silently absorbing: the caller asked for a deferral and got an immediate build, and without the key nothing could have selected the child afterwards. No `Card.addLazyPage` convenience method is added.[^no-alias]

**A live child outranks a pending factory for the same key.** A registration whose key is already taken is reported and discarded rather than handed back to the container (row six). Row seven is the reverse order — a live keyed child arriving after a registration — and because a live component never reaches the claim hook, that collision is caught when the factory is about to run instead. `## Internal Structure` gives both guards and the reason.[^one-slot-per-key]

### A key collision is caught when the factory is about to run

A pending factory is dropped, unbuilt and with a warning, if a live child already carries its key by the time it would run. The check sits in `buildDeferredChild` rather than behind a new `componentAdded` seam on `LayoutManager`.[^collision-at-build-time]

### The deferral mechanism is shared where it can be, and not extracted further

`Card` does not get a shared base class or a new shared helper module, and `Tab` is not refactored. The two seams that carry real mechanism are already shared: `LayoutManager.addDeferredComponent` is the base-class hook both managers implement, and the yield-spinner-fade lifecycle is already extracted into [`Animation.materialize`](packages/lib/src/typescript/lib/core/Animation.ts#L611), which `Tab` and `AbstractWindow` already share. What is left per manager is the registry of pending factories, and `Tab`'s registry is a tab-strip slot record, not a deferral record.[^shared-not-extracted] Full analysis: `## Addendum: Where the deferral mechanism already lives`.

### `Card` builds a deferred child synchronously; an async factory throws

`Card` runs the factory on the calling stack, inside `setVisibleKey`, and adds the built child to the container immediately. A factory that returns a promise throws, with a message naming `Tab` as the manager that hosts an asynchronous build.[^sync-build] This is a stated deviation from `Tab`, whose build is asynchronous behind a spinner.

### Key selection and id selection are one slot; the last write wins

`Card` holds one selection, reachable through two setters. `setVisibleKey(key)` stores the key and clears the configured id; `setVisibleComponentId(id)` stores the id and clears the key. Clearing is what keeps each setter's existing same-value early return correct, and it is why the two can never both be set.[^one-slot]

| `visibleKey` | `visibleComponentId` | The card resolves | Warns? |
|---|---|---|---|
| `null` | `null` | the first live child — today's rule, unchanged | no |
| `null` | `"c17"` | the child whose `getId()` is `"c17"` | only if no child has that id, and then the first live child is shown |
| `"misc"` | `null` | the first live child whose `key` constraint is `"misc"` | only if no child carries it **and** no slot is pending for it, and then the first live child is shown |
| `"misc"`, slot still pending | `null` | the first live child *for this resolution only* — the selection that registered the key, or the next `doLayout`, builds `"misc"`'s own child and re-resolves to it | **no** — "not built yet" is not "not found" |

**Two message shapes, one rule.** A *resolver* message mirrors its id twin verbatim and carries no prefix, because the point of the shared resolver is that both selectors report identically: the key branch's `"Visible key is specified but no matching component was found."` is the existing `"Visible component id is specified but no matching component was found."` ([`Card.ts:224`](packages/lib/src/typescript/lib/layout/Card.ts#L224)) with one word changed. A *registration* message is `Card: `-prefixed, because it has no twin to mirror and names a caller mistake rather than an unresolved selector. Neither existing message is reworded, so no console check anywhere has to move.[^warning-prefix]

Row four is the state this feature exists to create, and it is why the key branch suppresses the warning while `_deferred` still holds the key: a card mid-way through resolving a deferred page is not a card with a bad selector. The other no-match arm is deliberately identical for both spellings, because one resolver serves both. `hasKey(key)` is the pre-flight that keeps a caller off it — a router handed an unknown URL segment asks first and leaves the card alone.

### The factory runs from a selection, never from a size query

Building happens in exactly two places: `setVisibleKey`, and `doLayout` for a key that was selected before its slot existed. It never happens in `syncVisible` or `getVisibleComponent`, which the size getters reach ([`Card.ts:122`](packages/lib/src/typescript/lib/layout/Card.ts#L122)). `Tab` holds the same line, and its own documentation states it as a contract.[^no-build-from-sizing]

### The source lands before the test file, and the mutation table is the red-green proof

`## Ordered Implementation Steps` writes `Card.ts` before `Card.deferred.test.ts`, departing from the test-first rule the `implement` skill applies. The 25-row mutation table in `## Verification` is what substitutes for a red first run.[^source-before-tests]

### The `docs:api` bar is master's warning count, not zero

[`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md) requires `npm run docs:api` to finish with zero warnings; step 13 asks only for no more than the 14 master already reports. The gap is knowing and owned elsewhere.[^docs-api-bar]

### Id-based selection stays

`setVisibleComponentId` keeps working unchanged. It is not redundant: it has seven in-library call sites — four in [`Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L669) and three in [`MarkdownEditor.ts`](packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts#L1178) — so the pre-1.0 "delete unused public API rather than deprecate it" rule does not apply here.[^keep-ids]

---

## Public API

`packages/lib/src/typescript/lib/layout/LayoutConstraints.ts`:

```typescript
export class LayoutConstraints {
    /**
     * Caller-supplied name for a child slot, read by the
     * [`Card`](/api/layout/classes/Card) manager only. A key selects a child
     * through `Card.setVisibleKey`, and — unlike a component id — it can name a
     * child that has not been built yet, which is what lets a factory passed to
     * `Component.addComponent` be registered and selected later. Ignored by
     * every other layout manager.
     */
    key?: string | null = null;
}
```

`packages/lib/src/typescript/lib/layout/Card.ts`:

```typescript
export interface CardOptions extends LayoutManagerOptions {
    visibleComponentId?: string;
    /** Selects the visible child by its `key` constraint. Clears any `visibleComponentId`. */
    visibleKey?: string;
}

class Card extends LayoutManager {
    // Backing field for `visibleKey`: `private _visibleKey: string | null = null`.
    // Registry of unbuilt keyed slots: `private _deferred: Map<string, DeferredCardChild> = new Map()`.

    setVisibleKey(key: string): this;
    getVisibleKey(): string | null;

    /** Whether `key` names a slot — a pending factory or a live keyed child. */
    hasKey(key: string): boolean;

    /**
     * Claims a factory carrying a `key` constraint, discarding it when that key
     * already names a slot; declines every other factory.
     */
    override addDeferredComponent(factory: ComponentFactory, constraints?: LayoutConstraints): boolean;
}
```

Unchanged in signature, changed in behaviour: `setVisibleComponentId(id: string): this` also clears `_visibleKey`.

Every one of the four new methods is written with a full JSDoc block — description, `@param`, `@returns`, and `@throws` where one throws — as `## Internal Structure` gives them. The step-13 gate cannot catch a missing one: `typedoc.json` sets no `requiredToBeDocumented`, so an undocumented public method adds no warning.

Neither new field needs `declare`. `Card`'s `applyOptions` is dispatched from its own constructor **body** after `super()` returns ([`Card.ts:44-46`](packages/lib/src/typescript/lib/layout/Card.ts#L44)), not from inside the `super()` cascade, so the field initializers have already run — which is why the existing `_visibleComponentId = null` initializer is correct too. Give `_visibleKey` and `_deferred` ordinary initializers.

---

## Internal Structure

### The registry

One module-private record, not exported, so it never enters the API docs:

```typescript
/**
 * An unbuilt keyed child: the factory, plus the constraints the caller
 * registered it with, which are handed to `addComponent` when it is built so a
 * deferred child ends up with exactly the constraints an eager one would have.
 *
 * @remarks The caller's own constraints instance is held, not a copy — the same
 * as the eager path, where `setLayoutConstraints` stores what it was given. A
 * caller that mutates one constraints object between registrations therefore
 * changes what its already-registered slots will be built with. The registry
 * key is a string captured at registration and is unaffected.
 */
interface DeferredCardChild {
    factory:     ComponentFactory;
    constraints: LayoutConstraints;
}
```

Two rules govern the registry.

1. **A slot is pending or built, never both.** A pending entry leaves `_deferred` the moment its factory is about to run, so it is in the map or in the container and not in each. This is why the registry needs no per-slot status field — the map *is* the status.
2. **A factory never runs while a live child already carries its key.** Otherwise the built panel would be appended *behind* that child, `syncVisible` resolves the first match in `getComponents()` order, and the page just constructed would be parented and never shown, with nothing to report it.

Rule 2 cannot be enforced at registration alone, because a live keyed child can enter the container without the manager seeing it: `Component.addComponent` offers only a *factory* to `addDeferredComponent` ([`Component.ts:7510-7514`](packages/lib/src/typescript/lib/core/Component.ts#L7510)), and `moveComponent` carries a moved child's old constraints across by default ([`Component.ts:7600-7601`](packages/lib/src/typescript/lib/core/Component.ts#L7600)), so a key can arrive on a child with no call site writing `{ key }` at all. So the rule is enforced at **two** points, and only the second actually holds it:

| Guard | Where | When the key is taken |
|---|---|---|
| Registration-time | `addDeferredComponent` | reports the collision and discards the registration — catches the ordinary case early, before a factory is even stored |
| Build-time | `buildDeferredChild`, before `pending.factory()` | reports the collision, drops the pending entry unbuilt, and leaves the live child holding the key — the backstop for a child that never passed the hook |

Two *live* children can still share a key, through two eager `addComponent(panel, { key })` calls. That resolves deterministically to the first in `getComponents()` order, and no page is built-and-hidden by it, because nothing was deferred.

### Querying a key and reading the selection

`hasKey` comes first because the claim hook below calls it: it is the single definition of "this key is taken", used both by a consumer pre-flighting a selection and by the registry enforcing rule 1.

```typescript
/**
 * The live child carrying `key` as its layout constraint, or `null` when none
 * does. The **first** match in `getComponents()` order wins.
 *
 * @param key - The key to look for.
 * @returns The child carrying `key`, or `null`.
 *
 * @remarks One definition of "which child owns this key", read by the resolver,
 * by `hasKey`, and by the collision check that runs before a deferred factory.
 * They must agree on *which* child wins for the collision check to protect the
 * page the resolver would otherwise hide, so they share this one lookup rather
 * than each carrying a loop.
 */
private liveChildForKey(key: string): Component | null {
    const container = this.getContainer();
    if (!container) {
        return null;
    }

    for (const c of container.getComponents()) {
        if (this.getLayoutConstraints(c)?.key === key) {
            return c;
        }
    }

    return null;
}

/**
 * Reports whether `key` names a slot on this card: either a registered factory
 * that has not run yet, or a live child carrying that `key` constraint.
 *
 * @param key - The key to look for.
 * @returns `true` when a pending slot or a live child answers to `key`.
 *
 * @remarks The pre-flight for a caller that may hold a key this card does not
 * have — a router reading a URL segment, say. Selecting an unknown key reports
 * it and leaves the card on its first child, the same fallback an unknown
 * component id gets, so asking first is what avoids that path.
 */
hasKey(key: string): boolean {
    // Pending first, because that is the cheap answer and the common one at
    // startup. A slot that has been built is no longer in `_deferred`, so the
    // live-child lookup is what keeps the answer stable across the first
    // selection — a caller asking a second time must still be told yes.
    return this._deferred.has(key) || this.liveChildForKey(key) !== null;
}

/**
 * Returns the key selecting the visible child, or `null` when the card is
 * selecting by component id or falling back to its first child.
 *
 * @returns The visible key, or `null`.
 */
getVisibleKey(): string | null {
    return this._visibleKey;
}
```

### Claiming a factory

The three guards run in this order, and the order matters: the collision check sits **above** the `lazy` check, because a `lazy: false` registration under a taken key would otherwise be declined, built by the container, and left shadowing a pending slot — the state rule 1 exists to prevent.

```typescript
/**
 * Claims an unbuilt child offered by `Component.addComponent`, registering it
 * under the `key` its constraints carry so a later `setVisibleKey` can build
 * and show it. A factory with no key, or one declining deferral with
 * `lazy: false`, is handed back for the container to build immediately.
 *
 * @param factory - Produces the child on its key's first selection — or, when
 *   the key was already selected before this registration, on the first layout
 *   pass of a rendered container.
 * @param constraints - The constraints the caller passed: the source of `key`
 *   and `lazy`, and stored so the built child is added with exactly the
 *   constraints an eager one would have carried.
 * @returns `true` when this manager has taken the factory over — registered
 *   under its key, or discarded because that key already names a slot — and
 *   `false` when the container should build it immediately.
 */
override addDeferredComponent(factory: ComponentFactory, constraints?: LayoutConstraints): boolean {
    const key = constraints?.key ?? null;

    // A factory with no key could never be selected afterwards, so there is
    // nothing to defer it for: declining hands it back to the container, which
    // builds it immediately — what every manager but Tab did before this
    // change. An explicit `lazy: true` asked for a deferral this card cannot
    // give, so that one case is reported instead of silently absorbed. The
    // combined test also narrows `constraints` and `key` for everything below.
    if (!constraints || !key) {
        if (constraints?.lazy === true) {
            console.warn("Card: a deferred child needs a `key` constraint to be selectable; building it immediately.");
        }

        return false;
    }

    // Claimed and dropped rather than declined: declining would hand the factory
    // back to the container, which would build it and leave a second slot
    // answering to `key`. The first registration keeps the key. Claiming in
    // order to discard is within `addDeferredComponent`'s own contract, which
    // gives a claiming manager ownership of when *and whether* the factory runs.
    if (this.hasKey(key)) {
        console.warn(`Card: key "${key}" already names a slot on this card; this registration is discarded.`);

        return true;
    }

    // `lazy: false` declines the deferral, with the same spelling and the same
    // meaning it has on a Tab.
    if (constraints.lazy === false) {
        return false;
    }

    this._deferred.set(key, { factory, constraints });

    // A key selected before this registration is resolved by the pass this
    // schedules — `doLayout` builds the pending slot.
    this.getContainer()?.scheduleLayout();

    return true;
}
```

A missing key must **decline**, never fall back to a generated one. `Tab` can default a missing `name` to its minted tab id ([`Tab.ts:1788`](packages/lib/src/typescript/lib/layout/Tab.ts#L1788)) because that id is a real handle the strip already holds; a `Card` key invented here would name a slot no caller can ask for.

### Building a pending slot

```typescript
/**
 * Runs the pending factory for `key` and adds the result to the container.
 *
 * @param key - The slot to build.
 * @returns `true` when a factory ran; `false` when `key` has no pending slot,
 *   when this manager is not attached yet, or when a live child has taken the
 *   key and the slot was therefore discarded.
 * @throws Error - when the factory returns a promise, which a synchronous
 *   build has nothing to host. The slot has already been dropped by then, so
 *   the failure is reported once rather than on every later selection.
 */
private buildDeferredChild(key: string): boolean {
    const container = this.getContainer();
    const pending   = this._deferred.get(key);

    if (!container || !pending) {
        return false;
    }

    // The registration-time collision guard cannot see this case: a live child
    // reaches the container without passing `addDeferredComponent` at all, and
    // `moveComponent` can bring this key in on a child nobody keyed here. If one
    // now carries the key, building would append the new panel behind it and the
    // resolver would go on showing the older child — so the slot is dropped
    // unbuilt and the live child keeps the key. The caller's next `syncVisible`
    // resolves to that child, so the card still shows something for the key.
    if (this.liveChildForKey(key)) {
        console.warn(`Card: key "${key}" is carried by a live child of this container; `
                   + `the factory registered under it is discarded unbuilt.`);

        this._deferred.delete(key);

        return false;
    }

    // Dropped before the factory runs, so a factory that throws — or returns a
    // promise, or a component that already has a parent — is never run a second
    // time by a later selection or a later layout pass. "Built at most once"
    // then holds for the failure paths as well as the happy one.
    this._deferred.delete(key);

    const built = pending.factory();

    // The message names the key rather than a caller: this method is reached
    // from `setVisibleKey` *and* from `doLayout`'s catch-up, so naming either one
    // would be wrong on the other path.
    if (built instanceof Promise) {
        throw new Error(`Card: the deferred child for key "${key}" returned a promise. `
                      + "A Card builds a deferred child synchronously, so there is nothing to host "
                      + "the wait — an asynchronous factory needs a Tab-managed container.");
    }

    container.addComponent(built, pending.constraints);

    return true;
}
```

### Selecting by key

```typescript
/**
 * Selects the visible child by its `key` constraint, building it first when the
 * key names a factory that has not run yet. Clears any configured visible
 * component id, so the card carries one selection however it was named.
 *
 * @param key - The key of the child to make visible.
 * @returns This layout manager, for method chaining.
 * @throws Error - when the key's deferred factory returns a promise. A Card
 *   builds a deferred child synchronously, so there is nothing to host the
 *   wait; an asynchronous factory needs a Tab-managed container. The same
 *   failure can surface from a layout pass instead, when the key was selected
 *   before its factory was registered, so the message names the key and not
 *   this method.
 *
 * @remarks A key no slot answers to is reported and leaves the card on its
 * first child — the same fallback an unknown component id gets. Call `hasKey`
 * first when the key may not be one this card has.
 */
setVisibleKey(key: string): this {
    if (this._visibleKey === key) {
        return this;
    }

    // One selection slot, two spellings: storing a key retires any configured
    // id, which is also what keeps `setVisibleComponentId`'s own same-value
    // early return correct after a key has been selected.
    this._visibleComponentId = null;
    this._visibleKey         = key;

    this.buildDeferredChild(key);
    this.syncVisible();

    // Same reason as `setVisibleComponentId`: `doLayout` only ever lays out the
    // visible child, so one first shown here has never been sized.
    this.getContainer()?.scheduleLayout();

    return this;
}
```

`buildDeferredChild` runs **before** `syncVisible`, so the child exists in `getComponents()` by the time the resolver looks for it. Reversing the two is the one ordering mistake that produces a silently blank card.

### Resolution inside `syncVisible`

The key branch is added ahead of the existing id branch as an `else if`, which makes the two selectors mutually exclusive in the resolver itself and not only by convention in the setters:

```typescript
if (this._visibleKey !== null) {
    resolved = this.liveChildForKey(this._visibleKey);

    // A key whose factory has not run yet is "not built", not "not found" —
    // the next `doLayout` builds it. Only a key that no slot carries at all is
    // worth reporting.
    if (!resolved && !this._deferred.has(this._visibleKey)) {
        console.warn("Visible key is specified but no matching component was found.");
    }
} else if (this._visibleComponentId) {
    /* the existing id loop and its existing warning, unchanged */
}
```

The existing first-child fallback below this block ([`Card.ts:228-230`](packages/lib/src/typescript/lib/layout/Card.ts#L228)) is untouched and now covers the unresolved-key case too.

### `doLayout`'s catch-up

Inserted immediately after `doLayout`'s container guard and before its existing `if (!this._currentVisible)` check:

```typescript
// A key selected before its slot existed — from `CardOptions.visibleKey`, or
// from a `setVisibleKey` call that landed before the factory was registered —
// is built here, on the first pass that can both see the registration and
// place what it builds. Building stays out of `syncVisible`, which the size
// getters reach, and out of a pass on an unrendered container: `getElement()`
// is the framework's own test for "too early to lay anything out", and this
// pass returns on the matching `getInnerSize()` null further down anyway.
if (container.getElement() && this._visibleKey !== null && this.buildDeferredChild(this._visibleKey)) {
    this.syncVisible();
}
```

The element gate is the one thing in this block that is not obvious, and it is not moved below `doLayout`'s `getInnerSize()` guard because it cannot be: an existing early return on `!this._currentVisible` sits above that guard ([`Card.ts:343-345`](packages/lib/src/typescript/lib/layout/Card.ts#L343)), and a card whose only slots are deferred has no current visible child, so a catch-up placed below it would never run for the case it exists to serve.[^element-gate]

The existing `if (!this._currentVisible) { this.syncVisible(); }` below cannot double-sync: a successful build has just set `_currentVisible`.

---

## Ordered Implementation Steps

The source changes come before the test file, for the reason `## Architecture Decisions` gives; the mutation table in `## Verification` is the red-green proof, applied once the suite is green.

1. **`packages/lib/src/typescript/lib/layout/LayoutConstraints.ts`** — two edits.
    - Add the `key` field with the JSDoc from `## Public API`, placed immediately after `name` / `description` (it is metadata of the same kind, and `Constraints.md` groups them together).
    - Reword the **`lazy`** field's own JSDoc ([`:56-64`](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts#L56)). It currently reads "Read by the [`Tab`](/api/layout/classes/Tab) manager **only**, where it defaults to `true`" and ends "Ignored when the child is an already-constructed component, **and by every other manager**." Both clauses become false in this change, and `LayoutConstraints` is exported from [`layout/index.ts:5`](packages/lib/src/typescript/lib/layout/index.ts#L5), so the sentence renders into `docs/api/`. Reword to: read by `Tab`, where deferral defaults to `true`, and by `Card`, where it is only an opt-out — a `Card` defers a factory when its constraints carry a `key`, and `lazy: false` declines that. Keep the "ignored for an already-constructed component" clause; drop "and by every other manager" in favour of naming the two that read it.

    → verify: `npm run typecheck`, and `grep -n 'every other manager' packages/lib/src/typescript/lib/layout/LayoutConstraints.ts` — zero matches.

2. **`packages/lib/src/typescript/lib/layout/Card.ts`** — imports first: add `import type { ComponentFactory } from "~/core/Component.js";` and `import type { LayoutConstraints } from "~/layout/LayoutConstraints.js";`. Both are type-only — `Card` never constructs a `LayoutConstraints` — so nothing is added to the runtime module graph and `tests/unit/import-without-dom.test.ts` is unaffected.

3. **`Card.ts`** — add the module-private `DeferredCardChild` interface above the `CardOptions` declaration, and the two fields `_visibleKey` / `_deferred` beside `_visibleComponentId` ([`Card.ts:28`](packages/lib/src/typescript/lib/layout/Card.ts#L28)). Do **not** use `declare` on either (see `## Public API`). Field names carry the leading underscore the `@typescript-eslint/naming-convention` block in [`eslint.config.js`](packages/lib/eslint.config.js#L57) requires for private properties.

4. **`Card.ts`** — add `visibleKey` to `CardOptions` and dispatch it from `applyOptions` ([`Card.ts:55`](packages/lib/src/typescript/lib/layout/Card.ts#L55)), after the existing `visibleComponentId` dispatch, guarded the same way (`if (options.visibleKey !== undefined)`).

5. **`Card.ts`** — add `setVisibleKey`, `getVisibleKey`, `hasKey`, `addDeferredComponent` and the two private helpers `liveChildForKey` and `buildDeferredChild`, exactly as `## Internal Structure` gives them. Write `liveChildForKey` first: `hasKey`, `syncVisible`'s key branch and `buildDeferredChild`'s collision check all read it, and they must agree on which child owns a key. `hasKey` is `_deferred.has(key) || liveChildForKey(key) !== null`; returning only the `_deferred` half is the bug cases 2 and 18 exist to catch.

6. **`Card.ts`** — add `this._visibleKey = null;` to `setVisibleComponentId` ([`Card.ts:146`](packages/lib/src/typescript/lib/layout/Card.ts#L146)), **after** the same-value early return and before `this._visibleComponentId = id;`.

7. **`Card.ts`** — add the key branch to `syncVisible` ([`Card.ts:206`](packages/lib/src/typescript/lib/layout/Card.ts#L206)) and the catch-up block to `doLayout` ([`Card.ts:333`](packages/lib/src/typescript/lib/layout/Card.ts#L333)), as `## Internal Structure` gives them. → verify: `npm run typecheck` and `npm test` — the pre-existing `Card.test.ts`, `Card.undisplay.test.ts`, `DegenerateChildSets.test.ts` and `PrematureLayout.test.ts` all stay green, because none of them sets a key.

8. **`Card.ts` — the comments.** The nine bullets below are the complete set of comments in `Card.ts` that the preceding steps make inaccurate — doc comments and inline ones alike, in file order. The four new methods and two new helpers already carry their own blocks from step 5.

    - **The class comment** ([`Card.ts:18-25`](packages/lib/src/typescript/lib/layout/Card.ts#L18)) gains a paragraph on keys and deferred pages. **Leave the first two sentences byte-identical**: `llms.txt` truncates this comment at 140 characters ([`generate.mjs:91`](packages/lib/scripts/llms/generate.mjs#L91)) and the current row ends mid-second-sentence, so any edit inside them changes a tracked generated file.
    - **`_pendingScrollRestore`'s field comment** ([`:31-37`](packages/lib/src/typescript/lib/layout/Card.ts#L31)) — "`syncVisible` flips a child's display outside of any layout pass (reachable from `setVisibleComponentId`)" now has a second entry point. Say "reachable from `setVisibleComponentId` and `setVisibleKey`"; change nothing else about the rationale, which still holds.
    - **`applyOptions`** ([`:49-54`](packages/lib/src/typescript/lib/layout/Card.ts#L49)) — "dispatching the initial visible component id" is now also a key; say "the initial visible component id or key".
    - **`getVisibleComponentId`** ([`:62-66`](packages/lib/src/typescript/lib/layout/Card.ts#L62)) — "Returns the ID of the currently visible child component, or `null` if none is set" becomes actively wrong, not merely incomplete: with a key selected, a child *is* visible and this returns `null`. Reword to "the configured visible-component id", and say that it is `null` when the card is selecting by key or falling back to its first child — the reading `getVisibleKey` answers for.
    - **`setVisibleComponentId`** ([`:138-145`](packages/lib/src/typescript/lib/layout/Card.ts#L138)) — add that it retires any visible key, so the card carries one selection however it was named. The block also has no `@returns` today although the method returns `this`; add one, since step 6 is already editing this method.
    - **`getVisibleComponent`** ([`:163-170`](packages/lib/src/typescript/lib/layout/Card.ts#L163)) — two sentences. "the child component matching `visibleComponentId`, or the first child if no ID is set" becomes the three-way resolution: the child carrying the visible key, else the one whose id matches the visible component id, else the first child. And "the cache is refreshed when `setVisibleComponentId` is called or when `doLayout` runs without a resolved component" now has a third trigger — `setVisibleKey` — so name all three. State also that this method never runs a deferred factory: a size query reaches it, and building here is what `## Architecture Decisions` rules out.
    - **`syncVisible`** ([`:200-205`](packages/lib/src/typescript/lib/layout/Card.ts#L200)) — the same three-way resolution in place of "from `visibleComponentId` (or first child if unset)", and the same no-building note.
    - **`syncVisible`'s inline comment on the deferred restore** ([`:254-262`](packages/lib/src/typescript/lib/layout/Card.ts#L254)) — the same "(reachable from `setVisibleComponentId`)" parenthetical, and this one is load-bearing: it is the stated justification for parking the restore at all. Widen it the same way.
    - **`doLayout`** ([`:329-332`](packages/lib/src/typescript/lib/layout/Card.ts#L329)) — "Visibility transitions are handled in `setVisibleComponentId`, not here" stops being true, because step 7's catch-up builds a pending slot and syncs. Reword to: display transitions still belong to the two setters, and this pass additionally builds and shows a key whose slot did not exist when it was selected. Add a `@throws Error` clause: the catch-up runs a factory, so a factory returning a promise throws out of the layout pass. Say what that leaves behind — the pass aborts before `placeComponent`, so the visible child is not re-placed this pass, and the `_pendingScrollRestore` consume at [`:375-381`](packages/lib/src/typescript/lib/layout/Card.ts#L375) does not run, so a parked restore survives and the next successful pass performs it. The slot has already left `_deferred`, so the next pass does not throw again.

    → verify: three greps over `packages/lib/src/typescript/lib/layout/Card.ts`, each expecting zero matches: `grep -n 'not here'`, `grep -n 'reachable from .setVisibleComponentId.)'`, and `grep -n 'or the first child if no ID is set'`. Plus step 13's `git diff --exit-code packages/lib/llms.txt`.

9. **`packages/lib/tests/component/layout/Card.deferred.test.ts`** — create the file and write cases 1 to 24 of `## Expected Behaviour`. Copy the harness preamble from [`Card.test.ts:1-26`](packages/lib/tests/component/layout/Card.test.ts#L1) — the `installTestDOM` import, the `CONFIG` bag, `afterEach(() => DOM.reset())`, and the `hostCard` helper, which already calls `getElement(true)` and `clearInsets()`. Add `LayoutConstraints` to the imports and these two helpers:

   ```typescript
   // Records every build, in order, so a case can assert what was and was not
   // constructed. A list, not a flag: "the factory ran" and "the factory ran
   // exactly once" are different claims, and only the list pins the second.
   function recordingFactory(label: string, built: string[], panels: Map<string, Component>): () => Component {
       return () => {
           built.push(label);

           const panel = new Component({ preferredSize: { width: 10, height: 10 } });

           panels.set(label, panel);

           return panel;
       };
   }

   function constraints(fields: Partial<LayoutConstraints>): LayoutConstraints {
       return Object.assign(new LayoutConstraints(), fields);
   }
   ```

   Every case except 24 hosts its card through `hostCard` before the first `setVisibleKey`, because `buildDeferredChild` returns `false` with no attached container. Case 24 is the deliberate exception: its first arm needs a container with **no** element, so it builds one with `new Container({ layoutManager: card })` directly and calls `getElement(true)` only for the second arm. Cases 11, 13 to 15, and 17 to 21 need `vi.spyOn(console, 'warn').mockImplementation(() => undefined)` — the idiom [`StoreWorkerClient.test.ts:40`](packages/lib/tests/unit/data/StoreWorkerClient.test.ts#L40) uses — restored in `afterEach` with `vi.restoreAllMocks()`. Case 11 needs it because the key is selected before any slot exists, which is the reported state; cases 13 and 15 need it because the layout pass that follows the failed build logs the same warning; 14 and 17 to 21 assert on the call count, so each of those must reset it per case. → verify: `npm test` passes.

10. **`packages/lib/src/typescript/lib/core/Component.ts`** — correct two JSDoc blocks; change no code.
    - [`ComponentFactory`](packages/lib/src/typescript/lib/core/Component.ts#L67) — "An async factory is only accepted by a layout manager that defers it (today: `Tab`)" is now wrong, because `Card` defers and refuses a promise. Reword to say that an async factory needs a manager that can host the wait, which is `Tab`, and that `Card` defers a keyed child but builds it synchronously.
    - [`addComponent`](packages/lib/src/typescript/lib/core/Component.ts#L7494) — **two separate sentences**, both wrong after this change, in the library's most-read public JSDoc.
      - [`:7498`](packages/lib/src/typescript/lib/core/Component.ts#L7498): "Every other manager declines, and the factory runs immediately." `Card` no longer declines. Reword to say that `Card` also defers, claiming a factory whose constraints carry a `key`, and that every *other* manager declines so the factory runs immediately.
      - [`:7500-7502`](packages/lib/src/typescript/lib/core/Component.ts#L7500): "A factory returning a promise is only meaningful to a manager that defers it, because that manager is the one showing a spinner for the wait." Deferring is no longer sufficient — `Card` defers and refuses a promise. Reword to "only meaningful to a manager that can host the wait", and name `Tab` as the one that can.

      Leave the thrown message at [`:7521`](packages/lib/src/typescript/lib/core/Component.ts#L7521) alone — it describes the non-deferring path, which is unchanged.

    Use the markdown link form the surrounding JSDoc uses (`` [`Card`](/api/layout/classes/Card) ``), not `{@link}`, so no TypeDoc link resolution is involved. → verify: step 13's `npm run docs:api` warning count.

11. **`packages/lib/tests/core/DeferredChild.test.ts`** — two stale header paragraphs; change no test body, since every case here uses `HBox` or `Tab` and stays green.
    - Lines **3-6** claim "every manager except Tab behaves as if the caller had written `addComponent(factory())`", which stops being true. Reword to name the condition — a manager claims a factory only if it wants to; `Tab` claims by default, `Card` claims one carrying a `key` — and point at `Card.deferred.test.ts` for the `Card` rows.
    - Lines **8-10** claim "A factory that returns a promise is only meaningful on the deferred path, because that path is the one with a spinner to show and an owner for the wait." Deferring is no longer the test: `Card`'s deferred path has no spinner and throws on a promise. Reword so the test is hosting the wait, which only `Tab` does, matching the same correction step 10 makes to `Component.addComponent`'s JSDoc.

    → verify: `grep -n 'except Tab\|only meaningful on the deferred path' packages/lib/tests/core/DeferredChild.test.ts` — zero matches.

12. **Documentation.** Four files, each per `## Documentation Impact`: `packages/lib/docs/layouts/Card.md`, `packages/lib/docs/layouts/Constraints.md`, `packages/lib/docs/layouts/Tab.md` (the one falsified sentence at [`:179`](packages/lib/docs/layouts/Tab.md#L179), and nothing else on that page), and `packages/lib/docs/reference/changelog/next.md`. In `next.md`, add a `### Layouts` subsection under the existing `## Added`, after `### Components` — the order the numbered pages use ([`0.10.0.md:580-658`](packages/lib/docs/reference/changelog/0.10.0.md#L580)). Append only; four other plans drafted today add their own entries to this file. → verify: `grep -n 'does not defer it' packages/lib/docs/layouts/Tab.md` — zero matches.

13. **Full offline gate**, from the worktree root (a fresh worktree needs `npm install` first):

    ```
    npm run typecheck
    npm run lint
    npm test
    npm run docs:api
    npm run docs:llms:check
    npm run docs:llms && git diff --exit-code packages/lib/llms.txt
    npm run build:lib
    ```

    `npm run docs:api` must report no more than the 14 warnings master reports (17 counting the three `typedoc.json` suppresses) — a no-regression bar, not the convention's bar; see `## Architecture Decisions`. `docs:llms:check` needs `docs:api` to have run first. Never pass a bare `--root` to vitest; run `npm test` from the worktree root.

14. **Mutation proof.** Run the table in `## Verification` before declaring the work done.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/LayoutConstraints.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Card.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` (JSDoc only) |
| Create | `packages/lib/tests/component/layout/Card.deferred.test.ts` |
| Modify | `packages/lib/tests/core/DeferredChild.test.ts` (header comment only) |
| Modify | `packages/lib/docs/layouts/Card.md` |
| Modify | `packages/lib/docs/layouts/Constraints.md` |
| Modify | `packages/lib/docs/layouts/Tab.md` (one sentence) |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

Nothing is deleted. `packages/lib/llms.txt` and `packages/lib/docs/api/**` are regenerated; `llms.txt` is expected byte-identical (step 8) and `docs/api/**` is gitignored, so neither is a row above.

---

## Expected Behaviour

Every case is unit-testable offline — `Card`'s build is synchronous, so none of them needs the `requestAnimationFrame` capture [`Tab.lazy.test.ts:33-37`](packages/lib/tests/component/layout/Tab.lazy.test.ts#L33) has to install. All 24 belong in `packages/lib/tests/component/layout/Card.deferred.test.ts`. Nothing here needs manual verification; the visual check on the first consumer is `## Verification`'s one manual step.

**1. Registration builds nothing and adds nothing.** Register three keyed factories on a hosted `Card`. `built` is `[]` and `host.getComponents()` is `[]`.

**2. `hasKey` answers for a pending slot, for a built slot, and for an unknown key.** With `"a"`, `"b"`, `"c"` registered: `hasKey("a")` is `true`; after `setVisibleKey("a")`, `hasKey("a")` is **still** `true`; `hasKey("nope")` is `false`. The middle assertion is the one that matters — a `hasKey` that only consults the pending map answers `false` once the child exists, which breaks the second visit to a page.

**3. The first selection builds exactly the requested slot.** After `setVisibleKey("b")`: `built` is `["b"]` and `host.getComponents()` is `[panels.get("b")]`.

**4. An unselected slot's factory has not run.** Same setup as case 3: `built` does **not** contain `"a"` or `"c"`, asserted as the exact array `["b"]` rather than as three membership checks.

**5. Repeated selection builds each slot exactly once.** `setVisibleKey("a")`, `setVisibleKey("b")`, `setVisibleKey("a")` → `built` is exactly `["a", "b"]`, and `host.getComponents()` has length `2`. A boolean "the factory ran" would pass here without the once-only property; the array pins the count.

**6. Switching displays the new page and undisplays the old — both arms.** After case 5's sequence: `panels.get("a")!.isDisplayed()` is `true` **and** `panels.get("b")!.isDisplayed()` is `false`. Both arms, so a state where neither is displayed cannot pass.

**7. Selecting a key retires the configured id.** With `"a"` and `"b"` registered: `setVisibleKey("b")` (builds `b`), then `setVisibleComponentId(b.getId())`, then `setVisibleKey("a")` → `getVisibleKey()` is `"a"`, `getVisibleComponentId()` is `null`, and `getVisibleComponent()` is `a`. The **id** assertion is the load-bearing one here: without the clear, the resolver's key-first branch still resolves `"a"`, so only the stale `getVisibleComponentId()` reading exposes the miss.

**8. Selecting an id retires the key.** Same registrations, reversed: `setVisibleKey("a")`, `setVisibleKey("b")`, then `setVisibleComponentId(a.getId())` → `getVisibleKey()` is `null`, `getVisibleComponentId()` is `a`'s id, and `getVisibleComponent()` is `a`. The **`getVisibleComponent()`** assertion is the load-bearing one here: without the clear, the resolver takes the key branch and the card shows `b` while its id says `a`.

**9. `lazy: false` on a keyed factory builds it at registration.** `addComponent(factory, { key: "a", lazy: false })` → `built` is `["a"]` and `getComponents()` has length `1` straight away; `hasKey("a")` is `true`, because the live child carries the key; `setVisibleKey("a")` then shows it and adds nothing to `built`.

**10. A factory with no key is built at registration — both spellings.** `addComponent(factoryA)` with no constraints at all, and `addComponent(factoryB, { name: "B" })` with constraints that carry no key: `built` is `["a", "b"]` and `getComponents()` has length `2`. Both arms, because one guard covers the missing-constraints case and the missing-key case together and a single-arm case list would not notice which half broke. This is the pre-change behaviour of every non-`Tab` manager and nothing pins it for `Card` today.

**11. A key selected before its slot exists is built by the next layout pass.** `setVisibleKey("a")` on an empty hosted card, then register `"a"`. `built` is `[]` immediately after registering; after `host.doLayout()`, `built` is `["a"]` and `getVisibleComponent()` is `panels.get("a")`.

**12. `CardOptions.visibleKey` is honoured.** `new Card({ visibleKey: "a" })`, hosted, then `"a"` registered: `getVisibleKey()` is `"a"`, and after `host.doLayout()`, `built` is `["a"]` and `getVisibleComponent()` is that panel.

**13. A promise-returning factory throws, and is not retried.** Register `"a"` with an `async` factory that increments a counter. `setVisibleKey("a")` throws matching `/setVisibleKey/` and the counter is `1` (an async function body runs synchronously up to its first `await`, so the factory did run). Then `host.doLayout()` does not throw and the counter is **still** `1`. The regex matters: without the promise check the failure comes out of `insertComponent` instead and carries a different message.

**14. A duplicate key is reported and discarded, and the first registration keeps the key.** Register `"a"` twice, with factories labelled `"first"` and `"second"`. `console.warn` was called once; `built` is `[]` — the second factory was discarded, not built; `getComponents()` is `[]`; `hasKey("a")` is `true`. Then `setVisibleKey("a")`: `built` is `["first"]`, `getComponents()` has length `1`, and `getVisibleComponent()` is `panels.get("first")`. The assertions **after** the selection are the load-bearing half: a guard that overwrote the map entry rather than discarding the registration leaves every pre-selection count identical, and only the built label differs.

**15. A throwing factory propagates once and is not re-run.** Register `"a"` with a factory that increments a counter and then throws. `setVisibleKey("a")` throws and the counter is `1`; `host.doLayout()` afterwards does not throw and the counter is **still** `1`. `getVisibleKey()` is still `"a"`, and `getVisibleComponent()` falls back to the first live child (or `null` when there is none), exactly as an unresolvable id does.

**16. An unbuilt slot contributes no size; a built one does.** Register `"a"` (preferred `10 × 10`) and `"b"` on a `200 × 150` host with cleared insets: `card.getPreferredSize()` is `null`. Then `setVisibleKey("a")`: `card.getPreferredSize()` is `{ width: 10, height: 10 }`. The second assertion is load-bearing — on its own the `null` is also what an empty card reports, so only the pair proves the `null` came from the slot being unbuilt rather than from a card that can never report a size. `null` is the answer [`ARCHITECTURE.md:99`](ARCHITECTURE.md#L99) prescribes for a show-one-child manager with nothing to show.

**17. `lazy: true` with no key is reported, and a keyless factory without it is not — both arms.** On one hosted card, `addComponent(factoryA, { lazy: true })`: `console.warn` was called once, `built` is `["a"]`, and `getComponents()` has length `1`. On a second hosted card, `addComponent(factoryB)` with no constraints: the warn count is **still** `1`, `built` is `["a", "b"]`, and that card's `getComponents()` has length `1`. Both arms, so the warning is pinned to the explicit unsatisfiable request and not to every keyless factory.

**18. A key that already names a *built* child is discarded too.** Register `"a"` and `"b"`; `setVisibleKey("a")` builds `a`; then `addComponent(factoryC, { key: "a" })` → `console.warn` was called once, `built` is still `["a"]`, and `getComponents()` has length `1`. Then `setVisibleKey("b")` and `setVisibleKey("a")`: `built` is `["a", "b"]` with no third entry, `getComponents()` has length `2`, and `getVisibleComponent()` is the original `panels.get("a")`. This is the arm a collision check on `_deferred` alone would miss — the first slot has left the map by then, so only `hasKey`'s live-child scan still sees the key.

**19. A `lazy: false` registration under a taken key is discarded, not built.** Register `"a"` with `"first"`; then `addComponent(second, { key: "a", lazy: false })` → `console.warn` was called once, `built` is `[]`, and `getComponents()` is `[]`. Then `setVisibleKey("a")`: `built` is `["first"]` and `getComponents()` has length `1`. This pins the guard **order**: with the collision check below the `lazy: false` return, this registration is declined, the container builds it, and it shadows the still-pending slot — so the selection would build a second child and show the eager one.

**20. A live child that takes a pending key wins, and the factory is dropped — nothing shown yet.** Register `"a"` with factory `"first"`, then `host.addComponent(panelX, constraints({ key: "a" }))` — a live component, so no claim hook runs and the registration survives. Nothing has been selected and no layout pass has run, so `_currentVisible` is still `null`. Then `setVisibleKey("a")`: `console.warn` was called once; `built` is `[]` — the factory never ran; `getComponents()` is `[panelX]`; `getVisibleComponent()` is `panelX`; `panelX.isDisplayed()` is `true`; `hasKey("a")` is `true`. The `built` assertion is the load-bearing one: without the check the factory runs and its panel is appended behind `panelX`, where the first-sync undisplay loop ([`Card.ts:242-246`](packages/lib/src/typescript/lib/layout/Card.ts#L242)) then hides it — parented, invisible and unreachable.

**21. The same collision while another page is showing — both display arms.** Register `"a"` and `"b"`; `setVisibleKey("b")` builds `b` and makes it the current child. Then `host.addComponent(panelX, constraints({ key: "a" }))`, then `setVisibleKey("a")`: `console.warn` was called once; `built` is `["b"]` with no `"first"` entry; `getComponents()` has length `2`; `getVisibleComponent()` is `panelX`; `panelX.isDisplayed()` is `true` **and** `panels.get("b")!.isDisplayed()` is `false`. Both display arms, so a state where neither shows cannot pass. Without the check this is the worse of the two shapes: the else branch ([`Card.ts:248`](packages/lib/src/typescript/lib/layout/Card.ts#L248)) undisplays only `b`, so the freshly built panel stays displayed and overlaps `panelX` with stale geometry.

**22. A key on two live children resolves to the first in container order.** Add `panelX` and then `panelY`, both eagerly with `{ key: "a" }` and neither through a factory. `getVisibleComponent()` after `setVisibleKey("a")` is `panelX`, and `panelY.isDisplayed()` is `false`. This pins `liveChildForKey`'s first-match rule, which the resolver and the collision check both depend on — a last-match lookup would have the check protect one child while the resolver shows the other.

**23. An async factory reached through `doLayout`'s catch-up throws there, names the key rather than a setter, and is not retried.** `new Card({ visibleKey: "a" })`, hosted, then `host.addComponent(asyncFactory, constraints({ key: "a" }))` — `setVisibleKey` is never called. `host.doLayout()` throws matching `/returned a promise/`, the counter is `1`, and the captured message does **not** match `/setVisibleKey/`. A second `host.doLayout()` does not throw and the counter is still `1`. The negative assertion on the message is the load-bearing one: a message hard-coding `Card.setVisibleKey:` is true on the other path and false here, and no other case reaches the throw from a layout pass — case 13 reaches it through `setVisibleKey` and then asserts `doLayout()` stays quiet.

**24. An element-less pass builds nothing; the first rendered pass builds — both arms.** Construct `new Card({ visibleKey: "a" })` on a `Container` that has **not** been given an element (do not use `hostCard`, which calls `getElement(true)`), register `"a"`, then `host.doLayout()`: it does not throw, `built` is `[]`, `getComponents()` is `[]`, and `hasKey("a")` is still `true` — the slot is intact, not consumed. Then `host.getElement(true)`, `setWidth(200)`, `setHeight(150)`, `clearInsets()`, and `host.doLayout()` again: `built` is `["a"]` and `getVisibleComponent()` is that panel. Both arms are required — the first alone passes on a card that never builds at all, and the second alone passes on one that builds too early. This is `PrematureLayout.test.ts`'s F2 discipline extended to construction: that file exists because `Fit` and `Card` once laid a child out against a 0×0 rectangle before their host was rendered, and running a consumer's factory on such a pass is the same defect with a larger bill.

**Behaviour deliberately left as it is**, and therefore not given cases:

- An unbuilt slot is not a `Component`, so `getComponents()`, the disposal walk and the diagnostics component count never see it — the same as for an unregistered `Tab` factory ([`Tab.ts:1776`](packages/lib/src/typescript/lib/layout/Tab.ts#L1776)'s remarks).
- A factory returning an already-parented component fails in `insertComponent`'s existing `already has a parent` throw, which needs no new code and is not worth a second test.
- A factory returning `null` or `undefined` violates the `ComponentFactory` type and fails the same way it does on `Component.addComponent`'s immediate path. No guard is added, matching `Tab`.
- Removing a keyed child leaves the configured key alone, so re-adding a child carrying that key resolves it again — the rule `componentRemoved`'s own comment already states for ids ([`Card.ts:285`](packages/lib/src/typescript/lib/layout/Card.ts#L285)). `componentRemoved` needs no change.
- `Card` gets no `detach` override. There is no in-flight animation to cancel, and clearing `_deferred` on detach would silently discard registrations across a manager swap.

---

## Verification

**Offline gate** — step 13's command list, run from the worktree root.

**Mutation proof.** Apply one mutation, run `npm test`, confirm the listed cases go red, revert before the next. A case that stays green under its own mutation is not testing what it claims — fix the case, not the mutation.

| Mutation | Must turn red |
|---|---|
| `addDeferredComponent` returns `false` unconditionally | 1, 3, 4, 16 |
| `const key = constraints?.key ?? null` becomes `?? "page"` — a generated key instead of a decline | 10 |
| Delete the `if (constraints?.lazy === true)` warn block | 17 |
| Delete the `constraints.lazy === false` early return from `addDeferredComponent` | 9 |
| Delete the `this.hasKey(key)` collision guard | 14, 18 |
| Change the collision guard's `return true` to `return false` | 14 |
| Narrow the collision guard from `this.hasKey(key)` to `this._deferred.has(key)` | 18 |
| Move the collision guard below the `constraints.lazy === false` return | 19 |
| Delete the `liveChildForKey(key)` check from `buildDeferredChild` | 20, 21 |
| `liveChildForKey` returns the last match instead of the first | 22 |
| Restore the `Card.setVisibleKey:` prefix on the promise throw | 23 |
| Delete `container.getElement() &&` from `doLayout`'s catch-up condition | 24 (first arm) |
| Replace the catch-up condition with `container.getElement() === null &&` | 24 (second arm), 11, 12 |
| `hasKey` returns `this._deferred.has(key)` and nothing more | 2, 18 |
| Delete the `buildDeferredChild(key)` call from `setVisibleKey` | 3, 16 |
| `buildDeferredChild` reads `this._deferred.values().next().value` instead of `get(key)` | 3, 4 |
| Delete the `this._deferred.delete(key)` line | 5, 13, 15 |
| Move `this._deferred.delete(key)` below `container.addComponent(...)`, so it runs only on success | 13, 15 |
| Delete the `built instanceof Promise` throw | 13 |
| Delete `this.syncVisible()` from `setVisibleKey` | 6 |
| Swap `buildDeferredChild(key)` and `syncVisible()` in `setVisibleKey` | 6 |
| Delete `this._visibleComponentId = null;` from `setVisibleKey` | 7 |
| Delete `this._visibleKey = null;` from `setVisibleComponentId` | 8 |
| Delete the `visibleKey` dispatch from `applyOptions` | 12 |
| Delete the `buildDeferredChild` block from `doLayout` | 11, 12 |

Nine rows turn on something that is easy to get wrong, so each is spelled out:

- **A generated key instead of a decline.** This is the plausible mutation, not a contrived one — `Tab` really does default a missing label to its own minted id, so writing `?? "page"` here is the mistake a reader of `Tab` might make. It is also the only type-clean way to break case 10: simply deleting the guard leaves `key` typed `string | null` at the `_deferred.set` call and `typecheck:test` rejects the mutation before any assertion runs.
- **Deleting versus moving `_deferred.delete(key)`.** Deleting it lets a slot rebuild on a later selection, which is case 5. Moving it below `addComponent` keeps the happy path once-only but leaves a *failed* slot pending, which cases 13 and 15 catch on the layout pass that follows the throw. Both mutations are needed because neither covers the other.
- **Re-checking the failure paths with `doLayout`, not a second `setVisibleKey`.** Cases 13 and 15 re-check with `host.doLayout()` because `setVisibleKey`'s same-value early return would swallow a second `setVisibleKey("a")` and the assertion would pass whatever the mutation. `doLayout`'s catch-up has no such guard, so a re-run is observable there.
- **Swapping the build and the sync.** Case 3 does **not** catch this, which is why the row points at case 6: with the resolver running first, the incoming child does not exist yet, so the card resolves to the outgoing one, returns early, and then the freshly-added child is left displayed beside it. Only case 6's `b.isDisplayed() === false` arm sees it — the outgoing page stays displayed beneath the incoming one. `built` and `getComponents()` are unaffected, so a case that asserted only those would pass.
- **`hasKey` narrowed to the pending map.** Case 2 asserts `hasKey("a")` *after* `"a"` has been built. A case list testing only a pending key and an unknown key — the two symmetric arms — would miss it entirely, and the symptom in the first consumer is that the second visit to a page falls back to the default one. Case 18 catches the same narrowing through the collision guard, which reads `hasKey` for exactly this reason.
- **Discarding versus declining a collision.** The two are one character apart in the source and produce opposite outcomes, so case 14 asserts both sides of the moment: nothing built at registration (`return false` would have built the second factory eagerly) and the *first* factory's panel showing after the selection (an overwritten map entry would show the second's). Neither assertion alone separates the three behaviours.
- **The build-time check's two shapes.** Cases 20 and 21 are the same collision in the two states `syncVisible` distinguishes, and they fail differently without the check — 20 leaves the built panel undisplayed by the first-sync loop, 21 leaves it displayed and overlapping. A case list holding only one of them would pass while the other shape shipped, which is why both are written out rather than one being taken as representative.
- **First match, not last.** Case 22 is the only case with two live children under one key, so it is the only one that can tell `liveChildForKey`'s ordering apart. It matters because the same lookup decides which child the collision check protects and which child the resolver shows; if those disagreed, the check would fire for one page and hide another.
- **The collision guard's position.** Case 19 exists only to pin the guard sitting above the `lazy: false` return. Nothing else in the suite passes a `lazy: false` factory under a key that is already taken, so without case 19 the ordering paragraph in `## Internal Structure` would be prose no assertion holds to.

**Existing rows this change could make vacuous — checked, none.** Every current row that pins `Card`'s selection selects by id and passes no constraints, so `_visibleKey` stays `null` and the new `else if` branch is never entered: `Card.test.ts`'s four switching cases, `Card.undisplay.test.ts`, `DegenerateChildSets.test.ts` C1-C10 (including C8's "with no `visibleComponentId` set the resolution rule is the first child", which the untouched fallback still enforces), and `PrematureLayout.test.ts` F2 and B2-4. Two more files construct a `Card` and are equally unaffected, listed so the sweep reads as complete rather than partial: [`Border.collapseUndisplay.test.ts:322`](packages/lib/tests/component/layout/Border.collapseUndisplay.test.ts#L322) and [`Split.collapseUndisplay.test.ts:749`](packages/lib/tests/component/layout/Split.collapseUndisplay.test.ts#L749), each asserting that a collapse leaves a `Card`-managed page undisplayed across the round trip — both select by id and neither passes constraints. `DeferredChild.test.ts`'s cases run against `HBox` and `Tab`, so the seam's own rows are unaffected; only its header comment is wrong, and step 11 fixes it.

**Manual step — the user runs this, not the implementer.** Nothing in `Card`'s new surface is visual on its own; the check is that the first consumer still renders. After the demo-app navigation plan lands on top of this one, start the demo app however you normally do, click three sections in the nav tree, then return to the first. Each panel appears, the previous one disappears, and the returned-to panel keeps its scroll position. The browser console shows no `Card:` or `Visible key is specified…` warning at any point — either one means a key was selected that no slot carries.

---

## Documentation Impact

`key` is exported API on `LayoutConstraints`, and `visibleKey` / `setVisibleKey` / `getVisibleKey` / `hasKey` on `Card` — plus the `addDeferredComponent` override, which renders as a member of `Card` in its own right — so all six reach `packages/lib/docs/api/` through `layout/index.ts`, which already re-exports both owning symbols: `LayoutConstraints` at [`index.ts:5`](packages/lib/src/typescript/lib/layout/index.ts#L5), and `Card` with `CardOptions` at [`index.ts:46-47`](packages/lib/src/typescript/lib/layout/index.ts#L46). No new export line is needed.

- **`packages/lib/docs/layouts/Card.md`** — three edits. The lead paragraph's "The visible child is selected by component ID" becomes "by component ID, or by a caller-supplied key". The **Per-child constraints** section currently reads "None" ([`Card.md:36`](packages/lib/docs/layouts/Card.md#L36)) and gains a one-row table for `key`. A new **Lazy page construction** section mirrors [`Tab.md:121-142`](packages/lib/docs/layouts/Tab.md#L121) — the same `container.addComponent(factory, constraints)` idiom, the `lazy: false` opt-out, the fact that the key rather than a generated id is what names the slot — and states the three `Card`-specific rules: the build is synchronous, so a promise-returning factory throws and points at `Tab`; a key names at most one slot, so a second registration under a taken key is reported and discarded; and `hasKey` is the pre-flight for a caller (a router) that may be handed a key no slot carries. Note also that `lazy: true` without a `key` is reported and built immediately, since a deferred page with no name could never be selected.
- **`packages/lib/docs/layouts/Constraints.md`** — the optional-metadata table ([`Constraints.md:20-24`](packages/lib/docs/layouts/Constraints.md#L20)) gains a `key` row, and the `lazy` row — today "consumed by `Tab`, where it defaults to `true`" — is widened to say `Card` also reads it, as the opt-out for a factory carrying a `key`. The field's own JSDoc is corrected in step 1, and it is the one that renders into `docs/api/`; the table row alone would leave the API page contradicting it.
- **`packages/lib/docs/reference/changelog/next.md`** — a `### Layouts` subsection under `## Added`, in the register [`0.10.0.md:658`](packages/lib/docs/reference/changelog/0.10.0.md#L658) uses: what the key is, that a keyed factory is registered unbuilt and built on first selection (or, for a key selected before it was registered, on the first layout pass of a rendered container), that id-based selection is unchanged, and that the build is synchronous so an async factory still needs `Tab`.
- **`packages/lib/llms.txt`** — tracked and generated. Step 8 keeps `Card`'s JSDoc lead byte-identical inside the 140-character cap, so the regenerated file must be unchanged; `git diff --exit-code packages/lib/llms.txt` after `npm run docs:llms` is the check.
- **`packages/lib/scripts/llms/manifest.data.mjs`** — no change. `check-coverage.mjs` triages *concrete classes*, this change adds none, and `Card` already has its manifest row ([`manifest.data.mjs:43`](packages/lib/scripts/llms/manifest.data.mjs#L43)).
- **`packages/docs/src/content/pages.ts`** — no change. No doc page is added; `/layouts/Card` is already in the sidebar ([`pages.ts:302`](packages/docs/src/content/pages.ts#L302)).
- **`packages/lib/docs/layouts/Tab.md:179`** — one sentence, which this change falsifies. It reads "Passing one to a container whose manager does not defer it — or declining deferral with `lazy: false` — throws, because there is no spinner and no owner for the pending state." Both halves break: a `Card` *does* defer and *does* own the slot, and still throws. Reword so the test is hosting the wait rather than deferring — `Tab` is the only manager that can host it; a manager that declines the factory throws on the immediate path, `lazy: false` declines it here, and a `Card` throws too because it builds a keyed factory synchronously. Leave the trailing cross-reference to `ProgressSpinner` alone.

No symbol is renamed or removed, so there is no old-name sweep.

---

## Potential Challenges

- **Selecting before registering warns; selecting a registered-but-unbuilt key does not.** The two look alike and the resolver treats them differently, exactly as the fourth row of the resolution table says. `setVisibleKey("a")` on an attached card that has no `"a"` slot *at all* resolves nothing and is reported, so a size query before the next layout pass logs it; `setVisibleKey("a")` for a key `_deferred` already holds is silent, because the pass that follows builds it. Register first, then select — the order `Card.md` documents for ids as well — and the warning stays a real signal rather than startup noise.
- **Reversing the build and the sync shows two pages, not an error.** Building after `syncVisible` leaves the resolver looking for a child that does not exist yet, so it keeps the outgoing page selected and returns early — and the child added a moment later is displayed by default and never undisplayed. Two pages overlap until an unrelated relayout, with no warning. The `Swap buildDeferredChild(key) and syncVisible()` mutation row in `## Verification` is exactly this reversal.
- **A failing factory has no error event to go to.** `Card` owns no `ListenerBag`, so a throw propagates to whoever called `setVisibleKey` — typically a router handler. A consumer who needs the failure contained wraps the call; this plan adds no event surface for it.
- **`buildDeferredChild` adds a child from inside `doLayout`.** `insertComponent` schedules another layout pass and relays a preferred-size change upward, both from within the running pass. That is the shape `Tab` already has — `materializeAsync` mounts its spinner through `container.addComponent` from `Tab.doLayout` — and `scheduleLayout` only sets a flag and queues an animation frame, so nothing re-enters.
- **A shared constraints object is the caller's to keep stable.** The registry holds the caller's `LayoutConstraints` instance rather than copying it, so reusing one object across registrations — `bag.key = "a"; add(f1, bag); bag.key = "b"; add(f2, bag);` — builds both children with `key: "b"`, and the first is then unreachable by `"a"`. The registry key is snapshotted as a string, so the collision guards and every `_deferred` lookup stay correct; what drifts is only the built child's own constraint, which degrades to the documented unknown-key path (report, then the first child) rather than to a wrong child being shown. Copying was rejected.[^constraints-by-reference]

- **A live keyed child never passes the claim hook, so two guards are needed, not one.** `addComponent(panel, { key })` and a `moveComponent` that carries a key across both reach `insertComponent` directly. The registration-time guard therefore cannot be the whole rule, and deleting the build-time check in `buildDeferredChild` as redundant is the regression cases 20 and 21 exist to catch. What remains genuinely uncovered is two *eager* keyed adds: the resolver shows the first in `getComponents()` order, deterministically, and no deferred page is lost, because nothing was deferred. Case 22 pins that order.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/Card.ts`](packages/lib/src/typescript/lib/layout/Card.ts) — the file being changed. Read `syncVisible`'s id resolution, its first-sync undisplay loop, the first-child fallback, and `doLayout`'s existing ordering end to end before editing.
- [`packages/lib/src/typescript/lib/layout/Tab.ts:1776-1839`](packages/lib/src/typescript/lib/layout/Tab.ts#L1776) and [`:1917-1981`](packages/lib/src/typescript/lib/layout/Tab.ts#L1917) — **the precedent for the registration idiom.** `addDeferredComponent`'s `lazy` handling and constraint storage are what `Card`'s override mirrors; `materializeAsync` is the asynchronous half `Card` deliberately does not reproduce.
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts:80-94`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L80) — the `addDeferredComponent` contract `Card` now implements, and `getLayoutConstraints` at [`:719`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L719), the map the key is read back out of.
- [`packages/lib/src/typescript/lib/core/Component.ts:7494-7530`](packages/lib/src/typescript/lib/core/Component.ts#L7494) — `addComponent`'s factory branch: the offer to the manager, and the throw on the immediate path whose wording the new `Card` throw echoes.
- [`packages/lib/src/typescript/lib/layout/CollapseSupport.ts:482`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L482) — **the precedent for the sharing decision.** `runCollapse` is how this library shares behaviour between two layout managers: a free function taking the caller's own state as parameters, with `Split` and `Border` each keeping their own flags and lists. No base class, no shared record.
- [`packages/lib/src/typescript/lib/core/Animation.ts:611`](packages/lib/src/typescript/lib/core/Animation.ts#L611) — `Animation.materialize`, the deferral lifecycle that is *already* extracted, with `Tab` and [`AbstractWindow.ts:814`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L814) as its two consumers.
- [`packages/lib/src/typescript/lib/layout/LayoutConstraints.ts`](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts) — how a manager-specific metadata field is declared and documented on the shared class (`name`, `lazy`, `transient`), and why `key` belongs there rather than in a subclass.
- [`packages/lib/tests/component/layout/Card.test.ts:1-26`](packages/lib/tests/component/layout/Card.test.ts#L1) — the harness preamble and `hostCard` helper the new test file copies.
- [`packages/lib/tests/component/layout/DegenerateChildSets.test.ts:240`](packages/lib/tests/component/layout/DegenerateChildSets.test.ts#L240) — C1 to C10, the rows that pin `Card`'s removal, reorder and fallback behaviour. Read them to confirm the new branch leaves each one meaningful.
- [`packages/lib/tests/core/DeferredChild.test.ts`](packages/lib/tests/core/DeferredChild.test.ts) — the seam's own suite, and the header comment step 11 corrects.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — *Size constraints: who is responsible for what* (the `null` answer for a show-one-child manager) and *All attributes and styles go through typed setters* (the options-bag-plus-setter shape `visibleKey` follows).
- [`packages/lib/llms.txt`](packages/lib/llms.txt) — the capability manifest; `Card` and `Tab` are the entries this change is about, and the file is regenerated by step 13.

---

## Non-Goals

- **Extracting `Tab`'s deferral machinery into a shared base class or module.** Decided against with evidence; see `## Addendum`. `Tab` is not edited by this plan at all.
- **An asynchronous or spinner-backed build on `Card`.** It would need `Card`'s first event surface to report a rejection and a resolvable placeholder child to hold the slot mid-build. Nothing needs it, and `Tab` remains the manager for an async factory.
- **Making `Card` a recognised arrangement manager in `layout/LayoutSerialization.ts`.** `Card` does not serialize today and does not start to here.[^serialization]
- **Converting `Cell` or `MarkdownEditor` to keys.** Both work by component id and keep working; rewriting the table's hottest path to use a new selector buys nothing.
- **A `Card.addLazyPage` convenience method** mirroring `Tab.addLazyTab`. See the footnote on the API decision.
- **Editing `plans/demo-app-category-navigation.md` or the demo app.** That plan is read here to check the API against a real consumer and is revised separately; no demo-app file — anything at the top level of `packages/lib/src/typescript/` — is touched.
- **A key on any manager other than `Card`.** `LayoutConstraints.key` is documented as `Card`-only, the way `glyph` and `name` are documented as `Tab`-only.

---

## Addendum: Where the deferral mechanism already lives

The question this plan had to answer first was whether two managers with deferral means two mechanisms. It does not, because the mechanism splits into three parts and two of them are already shared.

**The seam is shared.** `Component.addComponent` offers a factory to the container's manager, and `LayoutManager.addDeferredComponent` is the base-class hook that accepts or declines it ([`LayoutManager.ts:93`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L93)). It was built as a seam for exactly this — the 0.10.0 notes describe `componentRemoved` as "the counterpart to the existing `addDeferredComponent` seam". `Card` implements the hook; nothing is copied.

**The lifecycle is already extracted.** The expensive, subtle half of `Tab`'s deferral — mount a placeholder, yield two animation frames so it paints, run the factory, await a promise, cross-fade the result in, and handle cancellation, staleness and rejection — is not in `Tab` at all. It is `Animation.materialize` ([`Animation.ts:611`](packages/lib/src/typescript/lib/core/Animation.ts#L611)), whose own doc comment records why: "Both `Tab.materializeAsync` and `Window.show` (when a content factory is set) drive activation through this helper so the yield-and-fade lifecycle lives in one place." There are already two consumers, in two different layers, and the shared spinner recipe sits beside it in [`SpinnerWrap.ts:28`](packages/lib/src/typescript/lib/component/display/SpinnerWrap.ts#L28). `Card` does not use either, because its build is synchronous — so this part is not duplicated; it is simply not reached.

**The registry is per manager, and cannot usefully be otherwise.** `Tab`'s `ContentEntry` ([`Tab.ts:270`](packages/lib/src/typescript/lib/layout/Tab.ts#L270)) has seven fields. `id` links the record to a `TabBar` cell; `spinner` holds the placeholder mounted during the yield; `materializeAnimation` is the cancel handle for the in-flight fade; `announceActivation` records that `Tab`'s `"activate"` event is owed until the content exists; `state` is a three-value machine (`"lazy"`, `"building"`, `"ready"` — [`Tab.ts:249`](packages/lib/src/typescript/lib/layout/Tab.ts#L249)) that exists to suppress a second factory run while the first is in flight. Only `component` and `factory` are about deferral as such; the other five exist because the build is asynchronous or because there is a strip to drive. `Card` has neither: its registry is `Map<string, { factory, constraints }>`, an entry is deleted the instant its factory is about to run, and "pending" versus "built" needs no status field because the two states are different containers. A shared record would be `Tab`'s minus five fields, which is `Card`'s map with extra ceremony.

**The library's own precedent points the same way.** Behaviour shared between layout managers here is shared as free functions parameterised by the caller's state: `runCollapse` / `commitRect` in `layout/CollapseSupport.ts` for `Split` and `Border`'s collapse, `ResizeDrag` in `core/` for their gutter drags, `LayoutSizes` for their size arrays. In every case each manager keeps its own state and hands it in. Inheritance is used only for two axis variants of one algorithm — `BoxLayout` for `HBox`/`VBox`, `FlowLayout` for `HFlow`/`VFlow`. Every other manager, `Card` and `Tab` included, extends `LayoutManager` directly. A `DeferringLayoutManager` base would be a new pattern, and the thing it would hold is 15 lines that differ between its two subclasses.

**What this costs.** `Card` gains roughly 120 lines of logic, of which the part that resembles `Tab` — read `lazy`, read the key, store the record, schedule a layout — is about 20. `Tab` gains nothing and loses nothing. The alternative, extracting a shared registry, would touch `Tab`'s lazy-load state machine, which is the most intricate code in `layout/`, for a saving smaller than the diff needed to get there.

---

## Notes

[^demo-fit]: Checked against `plans/demo-app-category-navigation.md` (untracked, drafted the same day), whose `DemoSectionDeck` needs exactly three things: register 32 slug-keyed panels unbuilt, build one on first selection, and report whether a slug is known so an unrecognised URL segment can fall back. This API meets all three, and the deck shrinks to a constructor loop of `this.addComponent(section.factory, { key: section.slug })` plus a `show(slug)` of `if (!card.hasKey(slug)) return false; card.setVisibleKey(slug); return true;`. Four things in that plan become unnecessary: its `DeckEntry` record and per-slug `Map`, its `if (entry.component === null)` build guard, its add-then-`setVisibleComponentId` ordering rule (the library now owns that ordering inside `buildDeferredChild`), and its `read-the-id` footnote about `Component.setId` breaking a `Panel`'s `autoScroll` wheel registration — a caller-supplied key never touches the component's id, so the trap does not arise. Its manual step watching the console for `Card`'s unresolved-selector warning also stops being needed, because `hasKey` keeps the router off that path. One thing it still owns: the deck must resolve the slug before calling, since an unknown key falls back to the first child rather than doing nothing. That plan is revised separately; this one does not edit it.

[^key-on-constraints]: Three spellings were considered. A `key` field on the shared `LayoutConstraints` wins because it is how this class already carries every other manager-specific per-child datum — `name`, `glyph`, `tooltip`, `disposeOnClose`, `italic` and `modified` are all documented there as read by `Tab` alone, and `weight` and `collapsible` as read by a named few. `lazy` is the closest precedent of all, and this change turns it into a second two-manager field: `Card` reads it as an opt-out, so its doc comment moves from "`Tab` only" to naming both (step 1). A `CardConstraints extends LayoutConstraints` subclass is the shape used for `AccordionConstraints`, `AnchorConstraints` and `GridConstraints`, but each of those carries several fields (and `AccordionConstraints` a required one with a positional constructor); a single optional string does not earn a class, and a subclass would also force consumers off the plain-object-literal call style the rest of the library uses (`addComponent(child, { weight: 1 })`). Reusing the existing `name` field — the nearest candidate, already a caller-supplied string on this class — was considered and rejected: `name` is a *human label*, read by `Tab` into a button's visible text, and a `Card` key is an identifier a router matches against a URL segment. Folding the two would mean a slug showing up as a tab label the moment such a child were moved into a `Tab`, and would leave a consumer no way to give a `Card` page both a stable key and a display name later. A dedicated `card.registerPage(key, factory)` method would be a second registration idiom for the same thing `Tab` already spells through `addComponent`, which is exactly what the "a consumer who knows `Tab` should not learn a second idiom" constraint rules out. The name is unprefixed like its neighbours; if a second manager ever wants a caller-supplied slot name, sharing `key` is the right outcome rather than a collision.

[^no-alias]: `Tab` has both the primary path and an `addLazyTab` alias, but its own JSDoc says "prefer that form; this one remains for callers that hold the layout manager rather than its container" ([`Tab.ts:1807`](packages/lib/src/typescript/lib/layout/Tab.ts#L1807)). The alias exists for history, not as the recommended surface. The first consumer adds children through its own `Container`, so a `Card` alias would ship with no caller — and the pre-1.0 rule for public API with no callers is to not have it.

[^one-slot-per-key]: The alternative was to *decline* a colliding registration, handing the factory back so the container builds it eagerly — which looks gentler, because nothing is dropped. It is worse, and the reason is not aesthetic. A declined-and-built duplicate leaves a live child carrying a key a pending factory still answers to, and `syncVisible` resolves the first match in `getComponents()` order; so the next `setVisibleKey` for that key runs the pending factory, appends its panel *behind* the eager one, and shows the eager one. A page is constructed, parented, never shown, and never reported. Discarding the second registration instead means no factory is ever stored under a key something else already answers to — so the choice is between one discarded factory the console names, and a silently orphaned panel. The collision test is `hasKey`, not `_deferred.has`, so a key belonging to an already-built child collides too; and the guard sits above the `lazy: false` return, so an eager-build request cannot slip a shadowing child past it. This guard is not the whole rule: a live keyed child can enter the container without passing this hook at all, which is what the build-time check exists for (see the decision on catching a collision when the factory is about to run). The registry's lack of a per-slot status field rests on the pending-xor-built rule alone, not on this one. Claiming a factory in order to discard it is within the seam's own contract: `LayoutManager.addDeferredComponent`'s doc states that a manager returning `true` owns "when — and whether — the factory runs" ([`LayoutManager.ts:80-94`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L80)).

[^collision-at-build-time]: The alternative was a `componentAdded(component)` hook on `LayoutManager` — the mirror of the existing `componentRemoved` — so `Card` could see a live keyed child arrive and drop the colliding slot at that moment instead. It would catch the collision earlier and report it at the call site that caused it, which is genuinely better diagnostics. It is not worth the price: a new public seam on the base class obliges every future manager to reason about it, `Component.insertComponent` would have to call it on a path that is per-frame hot for pooled table cells, and the whole expense would buy a better error message for a collision that is already a caller mistake. The build-time check costs one container scan on the one call that was about to construct a panel anyway, needs no new API, and holds the rule at the last moment before the second child for a key would exist. One gap survives either design and is worth naming: a factory that itself adds a live keyed sibling from inside its own body runs after the check, so it can create the collision it was screened for. Nothing in the library does that, no reachable call site suggests it, and the same body could equally add a child under any other key — it is a caller reaching around the manager, not a hole in the guard. It also leaves the no-status-field decision untouched, since the check reads the container rather than any stored slot state.

[^warning-prefix]: Leaving the resolver message unprefixed while the two registration messages carry `Card: ` is a decision, not an oversight. The unprefixed form has the precedent — [`Card.ts:224`](packages/lib/src/typescript/lib/layout/Card.ts#L224) has shipped that wording for the id selector — and the key branch's message is deliberately the same sentence, because the two selectors run through one resolver and a consumer debugging a blank card should not have to learn that the two spellings report differently. Prefixing the new one alone would break that symmetry; prefixing both would reword a shipped message that another plan's console check quotes, for no gain. The registration messages are a different family: they fire while a caller is wiring a card up, name a mistake in the call rather than an unresolved selector, and have no existing twin to match, so they carry the class name a reader would otherwise have to guess at.

[^source-before-tests]: Both orderings have precedent in `plans/implemented/` — `panel-resize-metrics-staleness` is source-first, `field-internals-unchanged-commit-opt-in` is red-first — so this is a choice, not a rule being broken. The reason is the project's own gate: `npm test` runs `typecheck:test` before `vitest run`, so a suite naming `setVisibleKey` before that method exists never reaches its assertions, and a "red" first run would mean reading a compile error rather than a failing expectation. A red first run *is* reachable by calling `npx vitest run <file>` directly, which strips types without checking and fails at runtime instead — but that bypasses the command every other step in this plan verifies against, and a TypeError is a weaker signal than a failed assertion about the behaviour under test. What actually protects these 24 cases is that each one names the mutation of a shipped line it catches, and `## Verification`'s table is run before the work is called done; that check is stronger than a red-first run, because it proves each case can fail *for the right reason* rather than merely that it once failed.

[^docs-api-bar]: The zero-warning requirement is right and this plan is not the change that reaches it: master already carries 14, so a plan that adopted the convention's bar would be gated on clearing warnings it did not create. `plans/docs-api-warning-clearance.md` owns that clearance. Until it lands, matching master exactly is the strongest bar this change can hold — it catches every warning this change would add, which is the only thing it can be responsible for. The number is stated as an exact figure rather than "no new warnings" so that a drop is noticed too: if the count falls, the clearance plan has landed and this bar should be tightened to zero rather than left loose at 14.

[^element-gate]: Two resolutions were weighed. Pinning the unguarded behaviour — factory runs, child is inserted, the pass then bails at `getInnerSize()` — would have meant correcting "built on first selection" throughout to admit a third trigger nobody asked for, and leaving a consumer's whole component tree (a `CodeEditor`, a `DiagramView`) constructed by a pass that was always going to discard its geometry. The gate is better on the merits: deferral exists to postpone construction until the page is needed, and a pass that cannot size anything is by definition not that moment. The framework says as much itself — `Component.doLayout`'s own comment names `Card` and `Fit` as managers that "cannot actually place [their] children on a pass run before this component is rendered" — and `PrematureLayout.test.ts` exists because those two once did work on exactly such a pass. Moving the block below the `getInnerSize()` guard, rather than gating it, was rejected as unimplementable rather than merely worse: `doLayout` returns on `!this._currentVisible` *above* that guard ([`Card.ts:343-345`](packages/lib/src/typescript/lib/layout/Card.ts#L343)), and a card holding only deferred slots has no current visible child, so the catch-up would be unreachable for the one case it is for — case 12 would fail. Gating costs one condition and reorders nothing. `setVisibleKey` is unaffected either way: it builds synchronously on the caller's stack, so only the `CardOptions.visibleKey` path and a select-before-register both reach the catch-up at all.

[^constraints-by-reference]: Copying onto a fresh instance is what `Tab.addLazyTab` does ([`Tab.ts:1834-1838`](packages/lib/src/typescript/lib/layout/Tab.ts#L1834)), and its comment gives the reason: that method *writes* `name` and `lazy` into the bag, so without a copy it would mutate a caller-owned object. `Card` writes nothing into the constraints it is handed, so the reason does not transfer. Three things then argue against copying anyway. It would make the deferred path behave differently from the eager one, where `LayoutManager.setLayoutConstraints` already stores the caller's instance by reference ([`LayoutManager.ts:683-695`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L683)) — so a caller mutating a shared bag after an eager `addComponent` already sees exactly this drift today, and copying would fix one route while leaving its twin, which is worse than one consistent rule. It would need a runtime `LayoutConstraints` import in `Card.ts`, against step 2's type-only instruction, which is what keeps `Card` out of `LayoutConstraints`'s own runtime module graph. And the failure it would prevent is bounded: the registry key is a captured string, so both collision guards and every lookup keep working, and a drifted child is merely unreachable by the key it was registered under — which is what the caller's own mutation asked for. The contract is documented on `DeferredCardChild` and in `## Potential Challenges` instead. No test pins it, deliberately: the absence of a copy is a non-guarantee, and a case asserting that drift happens would pin the library to today's aliasing rather than to a behaviour anyone wants.

[^shared-not-extracted]: The full argument, with the field-by-field breakdown of `Tab`'s `ContentEntry` and the in-repo precedents, is in `## Addendum: Where the deferral mechanism already lives`. The short version: the base-class hook and `Animation.materialize` already carry everything that generalises, and what remains per manager is a registry whose shape is dictated by whether the build is asynchronous and by whether there is a strip to keep in step.

[^sync-build]: `Tab`'s asynchronous build is right for `Tab` and inseparable from machinery `Card` does not have. A spinner needs somewhere to live: `Animation.materialize` mounts it as a real container child, and `Tab` can surface it because `getVisibleComponent` returns `entry.spinner` while the entry is `"building"` ([`Tab.ts:1593`](packages/lib/src/typescript/lib/layout/Tab.ts#L1593)) and because `Tab.doLayout` undisplays every non-selected child on every pass. `Card` writes display state only on a transition, so a spinner added mid-flight would sit displayed beside the current page until the next switch — making it resolvable means giving `Card` a placeholder slot and a three-state machine. A rejection needs somewhere to go: `Tab` closes the tab and emits `"exception"`, and `Card` owns no `ListenerBag` and no event surface at all, so supporting async would mean adding `Card`'s first custom event for a failure mode nothing needs. Against that, the synchronous build costs one rule — "an async factory needs `Tab`" — which the library already states in `Component.addComponent`'s own throw at [`Component.ts:7521`](packages/lib/src/typescript/lib/core/Component.ts#L7521). It also makes the whole feature testable offline with no `requestAnimationFrame` capture, which is what lets the once-only construction count be asserted directly rather than through a driven frame queue.

[^one-slot]: Two independent pieces of state would need a precedence rule for the both-set case, and a precedence rule invites the question of which setter a caller reached for last anyway. Clearing the other selector makes the question unanswerable by construction, and it has a second, less obvious payoff: `setVisibleComponentId`'s existing `if (this._visibleComponentId === id) return this;` guard stays correct after a key has been selected, because the key setter left `_visibleComponentId` at `null` and the guard therefore cannot short-circuit a genuine change back to the previous id. The `else if` in the resolver enforces the same exclusivity a second time, so a future setter that forgot to clear would still resolve deterministically rather than consulting both.

[^no-build-from-sizing]: `Tab` fixed this once already and wrote the contract into its own documentation: "Layout-sizing queries (`getPreferredSize` / `getMinSize` / `getMaxSize`) do not trigger factory invocations" ([`Tab.ts:1822`](packages/lib/src/typescript/lib/layout/Tab.ts#L1822)). `Card`'s size getters all run through `computeSize`, which calls `getVisibleComponent`, which calls `syncVisible` on a cold cache ([`Card.ts:108`](packages/lib/src/typescript/lib/layout/Card.ts#L108) and [`:171`](packages/lib/src/typescript/lib/layout/Card.ts#L171)) — so putting the build in `syncVisible` would make a parent measuring its child construct 32 panels. `doLayout` is not a size query, which is why the catch-up can live there.

[^keep-ids]: Id-based selection is redundant in principle — `Cell` and `MarkdownEditor` could each attach `key: "editor"` / `key: "renderer"` constraints and switch by key — but "redundant in principle" is not what the pre-1.0 delete rule is about. That rule targets public API with no callers anywhere; this has seven in-library call sites, a documented options field, a doc page section, and rows in four test files. Converting `Cell` would also mean rewriting the table's per-cell editor-pool swap path, which is among the hottest code in the library, for no behavioural gain. The two selectors coexist, and `Card.md` presents the key as the way to name a child that may not exist yet rather than as a replacement.

[^serialization]: Established by reading `layout/LayoutSerialization.ts`. `managerKind` ([`:177`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L177)) classifies a container by its manager's class name, and only `"Split"` and `"Tab"` are recognised: `nodeFor` falls through to the opaque `panel` leaf branch ([`:322`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L322)) for a `Card` container, so the card itself is recorded by its own component id and its children are never walked. `collectLeaves` ([`:426`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L426)) descends into the same two kinds only, so a `Card`'s pages are never parked or re-homed either, and `constraintsFor` ([`:517`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L517)) whitelists six `Tab`-only fields, so it needs no `key` row. A `Card` therefore neither saves nor restores its selection today, and an unbuilt keyed page is doubly invisible to it — it is not a container child, and the container is not descended into. Worth recording for whoever does take that on: `Tab` cannot record a never-built lazy tab either. `nodeFor`'s tab branch reads `manager.getActiveContent()` ([`:302`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L302)), which returns `null` for an entry whose factory has not run ([`Tab.ts:2300`](packages/lib/src/typescript/lib/layout/Tab.ts#L2300)), so `activeIndex` falls back to `0` — and because an unbuilt entry is not in `getComponents()`, it is absent from the saved children as well. The remapping at [`:631`](packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L631) realigns the active index against the children that actually landed on restore, which is a different problem from an active child that was never captured. Both are `Tab`'s, and neither is touched here.

---

## Implementation Notes

Implemented as written, with the source landing before the test file as
`## Architecture Decisions` directs. Thirteen deviations, listed below in the
order they arose. Four came from reading the plan against the code: its
internal contradiction over case 13's regex, its stale `docs:api` bar, case
23's missing warn spy, and a piece of public API its prescribed doc edits left
undocumented. Two came from running the mutation table and the supplementary
mutations: case 5's strengthening and the added case 25. The remaining seven
came from the three audit rounds — one code defect (`setVisibleKey` not
re-resolving when a factory throws, with case 15b added for the arm the plan's
own case 15 had left uncovered), one comment of the plan's own that was wrong
about one of its two callers, and five gaps where a shipped line had no
assertion behind it: cases 26, 27, 28, 29 and the second visit added to case
21. Every case added to or beyond the plan's own 24 is mutation-proved in the
tally at the end of this section.

**Case 13's regex was unimplementable as specified.** The plan asks case 13 to
assert `setVisibleKey` throws `/setVisibleKey/`, but the throw message is
decided as caller-neutral — pinned by case 23's `not.toMatch(/setVisibleKey/)`
and by the `Restore the Card.setVisibleKey: prefix` mutation row. The two
cannot both hold. Case 13 uses `/returned a promise/`, which is what its own
stated purpose needs ("without the promise check the failure comes out of
`insertComponent` instead and carries a different message") and what case 23
already uses. Nothing else changed.

**Case 5 did not go red under its own mutation, so the case was strengthened.**
Deleting `this._deferred.delete(key)` left case 5 green: the build-time
collision guard sees the live child the first build added, suppresses the
rebuild, and keeps `built` at `["a", "b"]`. The registry's once-only role on
the happy path is therefore redundant with that guard, and the only observable
trace of the stale entry is the collision it reports on a page the caller
merely revisited. Case 5 now asserts `console.warn` was not called, which kills
the mutation. Cases 13 and 15 pinned the failure paths as predicted.

**A 25th case was added, for the element gate's placement.** The gate lives in
`doLayout`'s catch-up, and cases 11, 12 and 24 pin it there. But relocating it
into `buildDeferredChild` — where it also suppresses `setVisibleKey`'s
synchronous build — passes all 24 planned cases, while silently narrowing the
contract `[^element-gate]` states as unaffected ("`setVisibleKey` builds
synchronously on the caller's stack"). Case 25 registers a slot on an attached
but unrendered container, selects it, and asserts the factory ran. It is the
only case that separates the two placements; the relocation mutation was run
and turns exactly case 25 red.

**The `docs:api` bar is zero, not 14.** `plans/docs-api-warning-clearance.md`
has landed, so step 13's "no more than the 14 warnings master reports" and the
`[^docs-api-bar]` footnote are both stale. Measured on this worktree: 0
warnings before any edit and 0 after, which is the bar `CODE_CONVENTIONS.md`
now states.

**Case 23 got the `console.warn` spy the plan's list omits.** The layout pass
that follows its throw reports the now-slotless key, exactly as in cases 13 and
15, which the plan does list. Without the spy the case passes but prints a
warning; nothing is asserted on the spy.

**`Card.md` got a fourth edit.** `CardOptions.visibleKey` is public API that
the plan's three prescribed edits left undocumented, so the new section states
it alongside `visibleComponentId`, together with the select-before-register
rule and the one-selection-two-spellings rule.

**`setVisibleKey` syncs in a `finally`, which the plan's code sketch does not.**
The plan's `## Internal Structure` calls `buildDeferredChild` and then
`syncVisible` as two plain statements, so a factory that throws leaves the
method before the sync — and `doLayout` re-resolves only when nothing is
currently visible, so no later pass corrects it. The card then goes on showing
the outgoing page while `getVisibleKey` reports the new key. That contradicts
case 15's own stated contract, which requires a failed build to fall back "to
the first live child (or `null` when there is none), exactly as an unresolvable
id does". The sketch and the contract cannot both hold; `## Expected Behaviour`
is the authority the implement skill derives tests from, so the code was fixed
to match it rather than the contract restated. Case 15 covered only the
empty-card arm, where the old code passes by accident, so **case 15b** was
added for the non-empty arm — the one the contract is actually about.

**Four cases were added for shipped lines no assertion stood behind.** Each was
found by mutating the line and watching the suite stay green, and each is now
red under that same mutation.

*Case 26 — the resolution table's fourth row.* The suppression in
`syncVisible`'s key branch, `!resolved && !this._deferred.has(...)`, is what
makes "not built yet" different from "not found"; narrowing it to `!resolved`
left all 25 earlier cases green. The plan's `## Expected Behaviour` and mutation
table never covered it, although the fourth row is a settled decision. Case 26
reaches it the way a consumer does — a size query landing before the first
layout pass — and pins both sides: a pending key is silent, a key no slot
carries is still reported.

*Case 27 — the catch-up's own sync.* Cases 11, 12, 23 and 24 all start from an
empty card, where `doLayout`'s following `if (!this._currentVisible)` re-sync
stands in for the one inside the catch-up, so deleting the catch-up's
`syncVisible()` left them all green. With a page already showing, that deletion
leaves the built page displayed while the old one stays resolved — two pages
overlapping, unreported. Case 27 selects an unregistered key on a card with a
live child, so something is resolved before the catch-up runs.

*Case 21's second visit — the collision branch's `_deferred.delete(key)`.* The
guard table says this branch "drops the pending entry unbuilt", but cases 20
and 21 each triggered the collision only once, and a single collision passes
whether or not the entry was dropped. Deleting the line left all 30 cases
green; without it the discarded factory stays pending, every later visit to the
key reports the same collision again, and removing the live child brings the
factory back. Case 21 now switches away and back, asserting the warning count
stays at one.

*Cases 28 and 29 — the two new `scheduleLayout()` calls.* Neither had an
assertion; either could be deleted with the suite green. The one in
`addDeferredComponent` is the load-bearing one: a claimed factory returns from
`addComponent` before `insertComponent`, and `setVisibleKey`'s same-value early
return swallows a re-selection, so that call is the only thing that brings the
pass case 11 drives by hand. Both are spied the way
[`Card.test.ts:122-127`](packages/lib/tests/component/layout/Card.test.ts#L122)
already pins `setVisibleComponentId`'s own schedule — the in-repo precedent for
this assertion, which the plan did not point at. Case 29 selects an
already-built key so no `addComponent` runs and the setter's own call is the
only scheduler left to observe.

No demo was added: the plan's `## Non-Goals` excludes the demo app, and
`demo-app-category-navigation` is the first consumer.

**One comment of the plan's own was wrong about one of its two callers.**
`buildDeferredChild`'s collision-branch comment, given verbatim in
`## Internal Structure`, ended "The caller's next `syncVisible` resolves to
that child, so the card still shows something for the key." That holds for
`setVisibleKey`, which re-resolves in its `finally`, and is false for a
`doLayout` catch-up, which syncs only on a successful build while the pass
re-resolves only when nothing is visible. The behaviour is right — it is the
rule any live child added after the first sync already follows — so the comment
was corrected to name both paths rather than the behaviour changed.

**Mutation proof: all 32 rows kill their predicted cases**, with no predicted
case staying green. That is the plan's own 25 rows, plus seven added here: the
gate relocation (case 25), `setVisibleKey`'s missing sync (case 15b), the
narrowed resolver suppression (case 26), the catch-up's deleted sync (case 27),
the two deleted `scheduleLayout()` calls (cases 28 and 29), and the collision
branch's deleted registry drop (case 21). Two of the plan's own claims were checked rather than assumed: the
`?? "page"` mutation is type-clean while deleting the guard outright is not
(`typecheck:test` exits 2), and the docs suite's anchor checker was
mutation-tested — a deliberately broken anchor fails it — so the green run on
the new cross-page links is not vacuous.
