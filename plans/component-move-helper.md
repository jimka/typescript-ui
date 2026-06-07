---
depends-on:
  - size-constraint-invariant.md
touches-shared:
  - src/typescript/lib/core/Component.ts
---

# Atomic Component Re-Parent / Move API — Implementation Plan

## Overview

`Component` currently has no way to move a child from one container to another in a single call. Both [`addComponent`](../src/typescript/lib/core/Component.ts#L3473) and [`insertComponent`](../src/typescript/lib/core/Component.ts#L3520) *throw* `Component … already has a parent. Remove it first.` when the incoming component's [`_parent`](../src/typescript/lib/core/Component.ts#L278) is non-null. Callers wanting to re-parent are forced into a throw-prone `oldParent.removeComponent(child)` then `newParent.addComponent(child)` two-step, with no single primitive that carries layout constraints across or guarantees both ends schedule a layout.

This plan adds a public `moveComponent(child, index?, constraints?)` method on [`Component`](../src/typescript/lib/core/Component.ts#L188) that atomically detaches `child` from its present parent (if any) and attaches it to `this` at an optional index, returning `this`. It is **foundational primitive #1 of 5** for a future dock/tab manager (plans #2 tab drag-reorder + detach, #3 edge-drop-to-split, #5 dock/tab manager all call it). The work is confined to `Component.ts`.

This is an internal structural method, not a new DOM property, so there is no `XOptions` field, no typed-setter backing field, and no theme token.

---

## Architecture Decisions

### The method lives on the *destination* — `moveComponent(child, index?, constraints?)`, not `child.reparentTo(target)`

The existing container vocabulary is destination-centric: `addComponent`, `insertComponent`, `removeComponent`, `addComponents` are all methods on the parent that take the child as the first argument. A `child.reparentTo(target)` form would invert that convention and would also breach the **child-to-parent communication ban** documented at [`_parent`](../src/typescript/lib/core/Component.ts#L276) ("Do NOT use this reference to propagate information upward … Parent-to-child communication … is the only intended flow"). `reparentTo` would have the child reach into and mutate its *current* parent's `_components`. Keeping the method on the destination container makes the destination the actor and the old parent merely a source it detaches from, matching the established direction of control. **Chosen signature (verbatim for downstream plans):**

```typescript
moveComponent(child: Component, index?: number, constraints?: LayoutConstraints): this
```

When `index` is omitted the child is appended (mirrors `addComponent`'s relationship to `insertComponent`); when supplied it is clamped to `[0, children.length]` exactly as `insertComponent` already does.

### Route through `removeComponent` + `insertComponent`, do **not** relax the `addComponent`/`insertComponent` throw

The Surgical-Changes rule and the project's one-responsibility bias both argue against duplicating the detach/attach bodies. `moveComponent` is implemented as: capture the source parent, call `oldParent.removeComponent(child)` (which returns the child's old constraints), then call `this.insertComponent(child, resolvedIndex, constraints ?? oldConstraints)`. Because `removeComponent` clears `_parent` to `null` *before* `insertComponent` runs, the existing throw guard is satisfied naturally — **the guard stays in place** as the safety net for the genuine "added to two parents" programming error. We do not add a "force" flag or a private throw-bypassing path; the move is expressed entirely in terms of the existing public mutators.

Routing through the public `removeComponent`/`insertComponent` (rather than splicing `_components` directly) also means subclass overrides are honoured: `AbstractListComponent`, `Table`, `Row`, `Header`, `Footer`, and `ToolBar` all override `addComponent`/`removeComponent` to narrow accepted types or run side effects. A direct-splice implementation would bypass them; the compose-from-public-methods implementation does not. (Type narrowing on those subclasses is a compile-time concern only — `moveComponent` is not overridden there, so it accepts the base `Component`; see Potential Challenges.)

### Both parents schedule a layout — for free

`removeComponent` ends with `this.scheduleLayout()` on the old parent; `insertComponent` ends with `this.scheduleLayout()` on the new parent. Composing the two therefore schedules layout on **both** ends with no extra code, which is exactly the required behaviour. `scheduleLayout` dedupes through the module-level `pendingLayouts` set and a single `requestAnimationFrame`, so two schedules in one synchronous call collapse to one rAF flush.

### DOM element is removed then re-inserted — accept the transition reset, document it

`removeComponent` calls `child.removeElement()`, which tears down any active clip/content frame and detaches the element from the document; `insertComponent` then calls `child.getElement(true)` (re-resolving or re-rendering) and re-attaches it under the new parent's child host. Re-parenting a live DOM node cancels in-flight CSS transitions on its descendants (a known framework gotcha — see the Accordion content-frame note in project memory). For a panel-move primitive this is acceptable and arguably correct: a docked panel that jumps containers should not animate mid-flight. The JSDoc must state plainly that the element is detached and re-attached, so any descendant CSS transition is reset by the move. Preserving the live node across the move is explicitly a **Non-Goal**.

### Layout constraints are carried by default, overridable per call

`removeComponent` returns the constraints the old parent's layout manager held for the child (via `delLayoutConstraints`). `moveComponent` captures that return value and, when the caller passes no explicit `constraints`, forwards the captured constraints to `insertComponent` so a panel keeps its weight/region across the move. When the caller *does* pass `constraints`, those win — the new container's layout vocabulary (e.g. a Border region) usually differs from the old one's, so an explicit override is the common case for a dock manager. Constraints are layout-manager-specific objects; carrying an old manager's constraints into an incompatible new manager is the caller's responsibility, documented in `@remarks`.

### No-op and same-parent fast paths

If `child._parent === this`, `moveComponent` still has meaningful work when an `index` is supplied: a *reorder within the same parent*. `insertComponent` currently early-returns when `component._parent === this`, so a naive route would silently drop an intra-parent reorder. To keep this primitive honest for plan #2 (tab drag-*reorder*), `moveComponent` detects the same-parent case and routes it through `removeComponent` + `insertComponent` as well (remove clears `_parent`, so the subsequent `insertComponent` no longer short-circuits). When `child` has no parent at all (`_parent === null`), `moveComponent` degrades to a plain `insertComponent` (no `removeComponent` call). When `child._parent === this` *and* `index` is undefined, it is a true no-op and returns `this` immediately.

---

## Public API (TypeScript Signatures)

```typescript
class Component<TOptions extends ComponentOptions = ComponentOptions> extends BaseObject {
    /**
     * Atomically moves a child from its current parent (if any) to this
     * container, at an optional index, in a single call.
     */
    moveComponent(child: Component, index?: number, constraints?: LayoutConstraints): this;
}
```

No new option field, backing field, getter, or theme token. `LayoutConstraints` is already imported in `Component.ts`.

---

## Internal Structure

Reference implementation sketch (final code must satisfy the project's blank-line and brace conventions and full JSDoc):

```typescript
moveComponent(child: Component, index?: number, constraints?: LayoutConstraints): this {
    const oldParent = child.getParentComponent();

    // True no-op: already here and no reorder requested.
    if (oldParent === this && index === undefined) {
        return this;
    }

    // Detach from the present parent, capturing its layout constraints so they
    // can be carried unless the caller overrides them. removeComponent clears
    // child._parent to null, which satisfies insertComponent's parent guard
    // and disarms its same-parent early-return for intra-parent reorders.
    const carried = oldParent ? oldParent.removeComponent(child) : undefined;

    const targetIndex = index ?? this._components.length;

    this.insertComponent(child, targetIndex, constraints ?? carried ?? undefined);

    return this;
}
```

Key points the implementer must preserve:

- `oldParent.removeComponent(child)` returns `LayoutConstraints | null | undefined`; coalesce a `null` to `undefined` before forwarding so `insertComponent`'s optional `constraints` parameter is satisfied cleanly.
- `index ?? this._components.length` computes the append index *after* `removeComponent` has spliced `child` out (relevant only in the same-parent reorder case, where the length shrinks by one first).
- Do not touch `_parent`, `_components`, or `_onPreferredSizeChange` directly — every mutation flows through `removeComponent`/`insertComponent`.

---

## Ordered Implementation Steps

1. **Add `moveComponent`** to `Component.ts`, placed immediately after [`insertComponent`](../src/typescript/lib/core/Component.ts#L3520) (before `removeComponent`) so the add/insert/move/remove cluster reads in lifecycle order. Implement per *Internal Structure*. Full JSDoc: describe the atomic detach-from-old / attach-to-new behaviour, the `index` append-vs-insert semantics, that **both** parents re-layout, that the DOM element is detached and re-attached (resetting descendant CSS transitions), and the constraints carry-vs-override rule in `@remarks`.
2. **Typecheck:** `npm run build` (or the project's `tsc` task) — expect zero errors. Confirm `LayoutConstraints` needs no new import (`grep -n "LayoutConstraints" src/typescript/lib/core/Component.ts` — expect the existing import line).
3. **Guard-still-armed checkpoint:** `grep -n "already has a parent" src/typescript/lib/core/Component.ts` — expect the two existing throws in `addComponent` and `insertComponent` to remain untouched.
4. **No-direct-mutation checkpoint:** confirm `moveComponent`'s body contains no `_components`, `_parent`, or `_onPreferredSizeChange` token (`grep -n "_components\|_parent\|_onPreferredSizeChange"` should show only pre-existing lines, none inside the new method).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/Component.ts` — add `moveComponent` method |

---

## Verification

- **Typecheck:** project `tsc`/build passes with zero errors.
- **Manual smoke (no new demo screen required):** in an existing multi-container demo (e.g. `LayoutTestPanel.ts` or `BorderPanel.ts`), temporarily wire a button that calls `targetContainer.moveComponent(child)` and confirm: (a) the child's element appears under the new container, (b) it is gone from the old container, (c) both containers re-layout, (d) no console error/throw. Remove the temporary wiring before commit.
- **Reorder smoke:** call `parent.moveComponent(child, 0)` on a child already in `parent` and confirm it moves to the front (validates the same-parent reorder path that `insertComponent` alone would no-op).
- **No-parent smoke:** call `container.moveComponent(freshComponent)` on a never-added component and confirm it attaches with no `removeComponent` side effects and no throw.
- **Docs build:** `npm run docs:build` — expect 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted).

---

## Documentation Impact

`moveComponent` is a new public method on the already-exported `Component` class — TypeDoc picks up the JSDoc automatically; no new barrel export (Component is already exported from `src/typescript/lib/core/index.ts`). Update the curated container/Component concept material if one enumerates the add/insert/remove family:

- Check `docs/concepts/` and `docs/core/` for a page listing `addComponent`/`insertComponent`/`removeComponent`; if found, add a one-line `moveComponent` entry alongside (`grep -rln "insertComponent" docs/`).
- No sidebar (`docs/.vitepress/config.mts`) or catalog `index.md` change is needed unless a brand-new page is created (it should not be).
- JSDoc cross-bucket: `LayoutConstraints` lives in the `layout` bucket, so reference it as `` [`LayoutConstraints`](/api/layout/interfaces/LayoutConstraints) `` (verify the exact kind/path at write time), not `{@link LayoutConstraints}`.

---

## Potential Challenges

- **Subclass `addComponent`/`removeComponent` overrides narrow the child type** (`AbstractListComponent`→`ListItem`, `Table`/`Row`/`Header`/`Footer`/`ToolBar`). `moveComponent` is defined only on the base `Component` and accepts a base `Component`, so calling `listContainer.moveComponent(arbitraryComponent)` would route into `AbstractListComponent.removeComponent`/`insertComponent` without the compile-time narrowing — acceptable for a low-level primitive, but document that moving *into* a type-restricted container is the caller's responsibility. Do **not** add per-subclass `moveComponent` overrides (scope creep; none of plans #2/#3/#5 need them).
- **`insertComponent` same-parent early-return** would silently swallow an intra-parent reorder if `removeComponent` were skipped — the implementation must always detach first when `index` is supplied, even when `oldParent === this`. Covered by the reorder smoke check.
- **`removeComponent` return type is `LayoutConstraints | null | undefined`** while `insertComponent`'s param is `LayoutConstraints | undefined` — coalesce `null`→`undefined` or TS will reject the forward.
- **Element re-render cost:** `getElement(true)` inside `insertComponent` re-renders only if the element was fully removed and the cache cleared; `removeElement` removes from the document but the `_element` cache persists, so re-attach reuses the node. No extra mitigation needed, but the implementer should not assume a render happens.

---

## Critical Files

- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `addComponent` (3473), `insertComponent` (3520), `removeComponent` (3567), `getParentComponent` (3434), `setLayoutConstraints` (3655), `delLayoutConstraints` (3672), `getChildHost` (844), `getAttachNode` (831), `scheduleLayout` (3794), and the field declarations `_parent` (278), `_components` (193), `_onPreferredSizeChange` (219).
- `src/typescript/lib/layout/LayoutConstraints.ts` — the carried constraint type.
- Subclass overrides to be aware of: `AbstractListComponent.ts` (186/199), `Table.ts` (440), `Row.ts` (209), `Header.ts` (335), `Footer.ts` (62), `ToolBar.ts` (286).

---

## Non-Goals

- **Preserving the live DOM node / in-flight CSS transitions across the move** — the element is intentionally detached and re-attached (Architecture Decisions); animated cross-container moves are out of scope and belong to plan #2/#3 if ever needed.
- **A `child.reparentTo(target)` child-side method** — rejected on direction-of-control grounds.
- **Relaxing or removing the `already has a parent` throw guards** — they remain the safety net for the two-parents bug.
- **Per-subclass `moveComponent` overrides / type-narrowing** — no downstream plan requires them.
- **Bulk `moveComponents(...)`** — not requested; add only if a later plan needs it.

---

## Blocking Prerequisite

[`plans/size-constraint-invariant.md`](size-constraint-invariant.md) (the `min ≤ preferred ≤ max` enforcement) should land first. A move re-runs layout on both the source and destination containers; doing so while the size-constraint invariant is still violated can surface inconsistent sizing at the new parent. That fix is referenced here only as an ordering dependency — its contents are **not** re-planned in this document.
