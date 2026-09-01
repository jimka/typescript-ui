---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Component Dirty-State Propagation — Implementation Plan

## Overview

Add a generic, library-wide mechanism for reporting "I have uncommitted edits" up the component tree. Two things land in [`core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts):

1. **Self-report.** A public `isDirty()` query and a protected `setDirty(dirty)` setter any component can call to flag its own uncommitted edits — a text editor, an input field, a form.
2. **Automatic relay.** Every container already wires each child through `wireChild`/`unwireChild` ([Component.ts:6348](packages/lib/src/typescript/lib/core/Component.ts#L6348), [Component.ts:6371](packages/lib/src/typescript/lib/core/Component.ts#L6371)) — the same seam `addComponent`/`removeComponent` already use to bubble a preferred-size change upward via `_onPreferredSizeChange`. This plan adds a matching bubble for dirty state, so a container's own `isDirty()` folds in every direct child's, and that child's own descendants, recursively, with no code anywhere that walks down into a subtree or knows what kind of leaf is actually dirty.

The whole change lives in `Component.ts` — `isDirty`/`setDirty` live there because `addComponent`/`removeComponent`/`getComponents` already live there (not on `Container`), so a leaf component (which extends `Component` directly, not `Container` — [`CodeEditor`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L186) is the concrete example) and a container both get the mechanism from the same base class. No consumer component adopts it in this plan; the mechanism ships proven by a test-only subclass, matching how [`plans/implemented/component-element-release.md`](plans/implemented/component-element-release.md) shipped `release()`.

---

## Architecture Decisions

### The mechanism is universal on `Component`, not a narrow opt-in interface

Every `Component` instance — including a `Glyph` or a `Spacer` that can never be dirty — gets `isDirty()` and participates in the relay. There is no `DirtyAware` marker interface and no runtime type-check in `wireChild` deciding whether to wire a given child.[^universal-vs-optin]

### `onDirtyChange`/`offDirtyChange` are dedicated methods, not `on("dirtychange", …)`

`Component` exposes the event through its own `onDirtyChange(listener)` / `offDirtyChange(listener)` pair — mirroring the shape of the existing `onDestroy(cleanup)` ([Component.ts:920](packages/lib/src/typescript/lib/core/Component.ts#L920)) — instead of the discriminated-union `on(event, listener)` shape [ARCHITECTURE.md](ARCHITECTURE.md)'s *Event handling* section describes for a class's own custom events.[^overload-collision] Internally it is still backed by a `ListenerBag`, per that same section's rule that custom events must use the `on`/`off`/`emit` + `ListenerBag` shape — the deviation is only in the public method names, not the underlying mechanism.

### Aggregation is a cached own-flag plus a dirty-descendant count, not a live recursive walk

`isDirty()` reads two plain fields in O(1); it does not walk `getComponents()` on every call. `Row`/`Cell`/`TreeRow`'s pooled `.dirty` CSS state ([Row.ts:331](packages/lib/src/typescript/lib/component/table/Row.ts#L331)) does not aggregate anything — it is a flat, single-level tint set straight from `ModelRecord.isDirty()`, a different axis entirely (see *Keep presentation state out of data Models*, below). `Component.isEffectivelyVisible()` ([Component.ts:2250](packages/lib/src/typescript/lib/core/Component.ts#L2250)) does aggregate a boolean across the tree, but in the opposite direction — it walks *up* the ancestor chain to ask "is anything above me hiding me," and its change propagation (`propagateEffectiveVisibility`, [Component.ts:2291](packages/lib/src/typescript/lib/core/Component.ts#L2291)) fans *down* from parent to children. Neither is a precedent for a child-to-parent aggregate; the actual precedent is `wireChild`'s own `_onPreferredSizeChange` bubble ([Component.ts:502](packages/lib/src/typescript/lib/core/Component.ts#L502)), which this plan's relay mirrors in shape (wired unconditionally per child, bubbling one level at a time) while diverging in mechanism (a `ListenerBag`-backed multi-listener event, not a single nullable callback slot) because dirty state — unlike preferred size — legitimately has more than one interested listener per component: a container's own relay, plus any consumer that wants to react to one specific component's dirty flag directly.[^count-not-recursive]

### `Tab`'s `"busychange"` is the closest precedent for the relay step, not for the aggregation

`Dock` listens to a hosted `Tab`'s own `"busychange"` and re-derives its own frame state (`Dock.ts:621-626`, `tab.on("busychange", onBusyChanged)` → `this.setFrameBusy(spec.id, busy)`), and `Tab` itself fires `"busychange"` "exactly once per real transition" ([Tab.ts:1637](packages/lib/src/typescript/lib/layout/Tab.ts#L1637), guarded by the identity check at [Tab.ts:1631](packages/lib/src/typescript/lib/layout/Tab.ts#L1631)). This plan's relay reproduces exactly that "listen to a child's own event, re-derive, re-emit only on an actual flip" shape and its "fires once per transition" discipline. It differs in two ways `busychange` doesn't need to: it is wired generically by the base class for every parent/child edge rather than by one call site (`Dock` wiring one `Tab`), and it must aggregate across possibly many children rather than track one child's single boolean.

### Keep presentation state out of data Models — this stays a separate axis from `ModelRecord.isDirty()`

`ModelRecord.isDirty()` / `AbstractStore.hasPendingChanges()` ([`data/ModelRecord.ts:526`](packages/lib/src/typescript/lib/data/ModelRecord.ts#L526), [`data/AbstractStore.ts:1035`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1035)) track whether a *record* differs from what the server last confirmed — domain data. `Component.isDirty()` tracks whether a *view* has an uncommitted edit buffer — presentation state, per [ARCHITECTURE.md](ARCHITECTURE.md)'s *Keep presentation state out of data Models*. The vocabulary coincides; the two never derive from or feed into each other. `Row`/`Cell`/`TreeRow`'s `.dirty` CSS state stays wired to `ModelRecord.isDirty()` exactly as it is today — this plan does not touch it.

---

## Public API

New members on the already-exported `Component` (`core/Component.ts`). No new exported symbol, no barrel or subpath change.

```typescript
// core/Component.ts

/**
 * Whether this component or any of its descendants has uncommitted edits.
 * True when this component's own dirty flag is set (see the protected
 * dirty setter) or when at least one direct child reports dirty — so an
 * ancestor at any depth learns about a dirty descendant without reaching
 * down into the tree itself.
 *
 * @returns `true` if this component or any descendant is dirty.
 */
isDirty(): boolean;

/**
 * Registers a listener for a change in {@link isDirty}'s return value —
 * fired exactly once per real transition, whether the change originates on
 * this component or bubbles up from a descendant.
 *
 * @param listener - Called with the new {@link isDirty} value.
 * @returns This component, for method chaining.
 */
onDirtyChange(listener: (dirty: boolean) => void): this;

/**
 * Removes a listener registered with {@link onDirtyChange}.
 *
 * @param listener - The exact listener reference to remove.
 * @returns This component, for method chaining.
 */
offDirtyChange(listener: (dirty: boolean) => void): this;
```

```typescript
// core/Component.ts — new PROTECTED setter

/**
 * Sets this component's own dirty flag. For a subclass that holds
 * uncommitted edits — a text editor, an input field, a form — to report
 * itself dirty. A component's descendants are folded into its own
 * `isDirty()` automatically; a subclass only ever calls this for its own
 * edit buffer, never to account for children. No-op if the value is
 * unchanged.
 *
 * @param dirty - The new own-dirty state.
 */
protected setDirty(dirty: boolean): void;
```

New private fields (plain initializers — never touched by `applyOptions`, so no `declare` is needed, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s *Fields written during the `super()` cascade*):

```typescript
private _ownDirty              : boolean                     = false;
private _dirtyDescendantCount  : number                      = 0;
private readonly _dirtyListeners: ListenerBag<"dirtychange">  =
    this.registerListenerBag(new ListenerBag<"dirtychange">());
private readonly _handleChildDirtyChange = (dirty: boolean): void => { /* see Internal Structure */ };
```

---

## Internal Structure

Shared flip-detection helper, plus the two call sites that use it:

```typescript
/** Fires `"dirtychange"` only if `isDirty()` actually differs from `before`. */
private _fireDirtyChangeIfFlipped(before: boolean): void {
    const after = this.isDirty();
    if (after !== before) {
        this._dirtyListeners.fire("dirtychange", after);
    }
}

isDirty(): boolean {
    return this._ownDirty || this._dirtyDescendantCount > 0;
}

protected setDirty(dirty: boolean): void {
    if (this._ownDirty === dirty) {
        return;
    }
    const before = this.isDirty();
    this._ownDirty = dirty;
    this._fireDirtyChangeIfFlipped(before);
}

private readonly _handleChildDirtyChange = (dirty: boolean): void => {
    const before = this.isDirty();
    this._dirtyDescendantCount += dirty ? 1 : -1;
    this._fireDirtyChangeIfFlipped(before);
};

onDirtyChange(listener: (dirty: boolean) => void): this {
    this._dirtyListeners.add("dirtychange", listener);
    return this;
}

offDirtyChange(listener: (dirty: boolean) => void): this {
    this._dirtyListeners.remove("dirtychange", listener);
    return this;
}
```

`wireChild`/`unwireChild` ([Component.ts:6348-6380](packages/lib/src/typescript/lib/core/Component.ts#L6348-L6380)) gain two lines each. `wireChild` registers the relay and reconciles a child that is already dirty at attach time (re-parenting a dirty subtree, or a `components:` construction-time child built dirty):

```typescript
private wireChild(component: Component): void {
    component._parent = this;
    component._onPreferredSizeChange = () => { /* unchanged */ };
    component._onConstraintSizeChange = () => { /* unchanged */ };
    component.onDirtyChange(this._handleChildDirtyChange);
    if (component.isDirty()) {
        this._handleChildDirtyChange(true);
    }
}
```

`unwireChild` detaches the listener and reconciles the count so a dirty child that is removed (not disposed) does not leave the old parent stuck reporting dirty forever:

```typescript
private unwireChild(component: Component): LayoutConstraints | undefined {
    const constraints = this.delLayoutConstraints(component);
    component._parent = null;
    component._onPreferredSizeChange = null;
    component._onConstraintSizeChange = null;
    component.offDirtyChange(this._handleChildDirtyChange);
    if (component.isDirty()) {
        this._handleChildDirtyChange(false);
    }
    component.removeElement();
    return constraints ?? undefined;
}
```

The `isDirty()` check runs before `removeElement()` — it only reads two plain fields on the child, unaffected by element teardown, so ordering relative to `removeElement()` does not matter; it is placed here to sit next to the other three `_on*` unwiring lines it belongs with.

---

## Ordered Implementation Steps

1. **[Component.ts:502](packages/lib/src/typescript/lib/core/Component.ts#L502)** — Add the four new private fields (`_ownDirty`, `_dirtyDescendantCount`, `_dirtyListeners`, `_handleChildDirtyChange`) directly below `_onConstraintSizeChange`. `_handleChildDirtyChange`'s body needs `_fireDirtyChangeIfFlipped`, added in step 2 — write the field now with its final body; method placement order inside a class does not matter for the arrow-field-to-method reference (both resolve at call time, not declaration time).

2. **[Component.ts:2313](packages/lib/src/typescript/lib/core/Component.ts#L2313)** (right after `scheduleEffectiveVisibilityReconcile()`, before `getInsets()`) — Add `isDirty()`, `onDirtyChange()`, `offDirtyChange()`, the protected `setDirty()`, and the private `_fireDirtyChangeIfFlipped()` helper, with the bodies and JSDoc from **Public API** / **Internal Structure**.

3. **[Component.ts:6348](packages/lib/src/typescript/lib/core/Component.ts#L6348)** — In `wireChild`, add the two-line relay registration shown in **Internal Structure**, after the two existing `_on*` assignments.

4. **[Component.ts:6371](packages/lib/src/typescript/lib/core/Component.ts#L6371)** — In `unwireChild`, add the two-line relay teardown shown in **Internal Structure**, after the two existing `_on*` nullings and before `component.removeElement()`.

5. **Create `packages/lib/tests/component/dirty-state-propagation.test.ts`**, modelled on [`packages/lib/tests/core/StructureMutationPropagation.test.ts`](packages/lib/tests/core/StructureMutationPropagation.test.ts) for the harness (`installTestDOM(CONFIG)`, plain `new Component({})` for wiring plumbing) and on [`packages/lib/tests/component/element-release.test.ts`](packages/lib/tests/component/element-release.test.ts) for the protected-member probe pattern:

   ```typescript
   class DirtyProbe extends Component {
       markDirty(dirty: boolean): void { this.setDirty(dirty); }
   }
   ```

   Cover every case in **Expected Behaviour**.

6. Run `cd packages/lib && npm run typecheck && npm test` — clean, including the new test file.

7. Run `cd packages/lib && npm run lint` — the `@typescript-eslint/naming-convention` rule (see [`plans/implemented/component-underscore-prefix-rename.md`](plans/implemented/component-underscore-prefix-rename.md)) must accept the four new `_`-prefixed private fields with no findings.

8. Update docs (see **Documentation Impact**): [`packages/lib/docs/concepts/events.md`](packages/lib/docs/concepts/events.md), [`packages/lib/docs/concepts/component-lifecycle.md`](packages/lib/docs/concepts/component-lifecycle.md), [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md).

9. Run `cd packages/lib && npm run docs:llms` (regenerates `packages/lib/llms.txt` — never hand-edit) then `npm run docs:api` — zero warnings. Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s *Don't `{@link}` internal symbols*, `isDirty()`'s JSDoc must describe the protected setter in prose, not `{@link}` it.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Create | `packages/lib/tests/component/dirty-state-propagation.test.ts` |
| Modify | `packages/lib/docs/concepts/events.md` |
| Modify | `packages/lib/docs/concepts/component-lifecycle.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify (regenerate) | `packages/lib/llms.txt` |

---

## Expected Behaviour

All offline-testable — this is pure JS state and listener wiring, with no DOM writes involved, so unlike a rendering or geometry change nothing here needs manual browser verification.

**Self-report (single component, no tree).**

1. `new Component({}).isDirty()` is `false`.
2. `new DirtyProbe({})`: `markDirty(true)` makes `isDirty()` `true`; `markDirty(false)` makes it `false` again.
3. `onDirtyChange` fires exactly once per real transition: `markDirty(true)` fires the listener once with `true`; a second `markDirty(true)` fires it zero additional times; `markDirty(false)` fires it once with `false`.
4. `offDirtyChange` with the same listener reference stops delivery: after removal, `markDirty(true)` does not call it.

**Single-level relay (`parent.addComponent(child)`).**

5. `child.markDirty(true)` flips `parent.isDirty()` to `true`; `child.markDirty(false)` flips it back to `false`.
6. A `dirtychange` listener registered on `parent` fires once with `true` when `child.markDirty(true)` runs.
7. Two dirty children collapse correctly — the parent's own `dirtychange` fires only on the underlying count's `0 ↔ >0` transition:

   | step | child A | child B | parent `isDirty()` | parent fires? |
   |---|---|---|---|---|
   | 1 | dirty | clean | `true` | yes (`true`) |
   | 2 | dirty | dirty | `true` | no — already `true` |
   | 3 | clean | dirty | `true` | no — still `true` |
   | 4 | clean | clean | `false` | yes (`false`) |

**Arbitrary depth (grandparent → parent → child).**

8. `child.markDirty(true)` makes both `parent.isDirty()` and `grandparent.isDirty()` `true`, and a `dirtychange` listener on `grandparent` fires exactly once — with no code anywhere reading below `grandparent`'s own direct child (`parent`).

**Attach/detach reconciliation.**

9. Building `child`, calling `child.markDirty(true)`, and only then `parent.addComponent(child)`: immediately after the add, `parent.isDirty()` is `true` with no further event needed to "catch up" — `wireChild`'s attach-time check accounts for it, and a `dirtychange` listener already registered on `parent` before the add fires once as a result of it.
10. `parent.addComponent(child)`, then `child.markDirty(true)`, then `parent.removeComponent(child)`: `parent.isDirty()` returns to `false`, and a `dirtychange` listener on `parent` fires once with `false`. `child.isDirty()` is unaffected — still `true` — because removal detaches, it does not clear the child's own state.
11. Same setup, but `parent.disposeAllComponents()` instead of `removeComponent`: `parent.isDirty()` still returns to `false` — the dispose-then-detach sequence ([Component.ts:6591](packages/lib/src/typescript/lib/core/Component.ts#L6591)) reconciles through the same `unwireChild` call as a plain remove.
12. A clean child contributes nothing: adding and then removing a child that is never marked dirty never fires the parent's `dirtychange`.

**Combining own-dirty and descendant-dirty.**

13. A `DirtyProbe` container that both calls `markDirty(true)` on itself and has one dirty child: clearing its own flag while the child stays dirty leaves `isDirty()` `true` (and fires no `dirtychange`, since the aggregate didn't change); only clearing both returns it to `false`.

---

## Verification

- `cd packages/lib && npm run typecheck` — clean.
- `cd packages/lib && npm test` — clean, including all 13 cases above in `dirty-state-propagation.test.ts`.
- `cd packages/lib && npm run lint` — no new findings, including the naming-convention check on the four new private fields.
- `cd packages/lib && npm run docs:llms && npm run docs:api` — zero warnings.
- `grep -n 'on(event: "dirtychange"' packages/lib/src/typescript/lib/core/Component.ts` — zero matches (confirms no discriminated `on(event, listener)` overload was added alongside the dedicated `onDirtyChange`/`offDirtyChange` pair).
- `grep -rn "onDirtyChange\|isDirty()" packages/lib/docs/concepts/events.md packages/lib/docs/concepts/component-lifecycle.md` — both docs mention the new surface.

---

## Documentation Impact

- **[`packages/lib/docs/concepts/events.md`](packages/lib/docs/concepts/events.md)**, `## on / off / emit — framework custom events` section (line 136): add one short paragraph noting `Component.onDirtyChange`/`offDirtyChange` as the one exception to the discriminated `on(event, listener)` shape described there — a dedicated method pair on the base class itself, for the reason in this plan's `## Architecture Decisions`. Do not add `Component` to the bulleted list of emitters that use the `on("event", …)` form on that same page — it uses the dedicated form instead.
- **[`packages/lib/docs/concepts/component-lifecycle.md`](packages/lib/docs/concepts/component-lifecycle.md)**, `## Adding to a parent` section (line 42): add one sentence noting that `addComponent`/`insertComponent` also fold a child's dirty state into the parent's own `isDirty()`, alongside the existing description of constraint registration.
- **[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md)**: add a `### Core` subsection under the existing `## Added` heading (mirroring the `### Core` subsection already used under `## Fixed` at line 79), naming `Component.isDirty()` / `onDirtyChange()` / `offDirtyChange()`.
- **`packages/lib/llms.txt`**: regenerate via `npm run docs:llms` (per `## Ordered Implementation Steps`) — this is a new library capability (dirty-state propagation), not just an internal method, matching how `release()` was included when `plans/implemented/component-element-release.md` shipped.
- `isDirty()`'s public JSDoc must not `{@link}` the protected `setDirty` — describe it in prose, per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md).

---

## Potential Challenges

- **A raw `child.dispose()` on a still-parented child, without going through `removeComponent`/`disposeAllComponents`, leaves the parent's dirty count stuck.** `destructor()` ([Component.ts:974](packages/lib/src/typescript/lib/core/Component.ts#L974)) recurses into `_components` directly and never calls `unwireChild`, so a dirty child destroyed this way never fires the "false" transition that would decrement its old parent's count. This is a pre-existing gap in `wireChild`/`unwireChild`'s own contract — `_onPreferredSizeChange` has the identical exposure today (an orphaned callback slot on a destroyed child, though moot there since nothing reads it again) — and this plan neither fixes nor worsens it. The two documented, correct teardown paths (`removeComponent`, `disposeAllComponents`) are exactly what `unwireChild`'s reconciliation covers, and are the only paths a container is expected to use to discard live children (see `disposeAllComponents`'s own JSDoc, [Component.ts:6591](packages/lib/src/typescript/lib/core/Component.ts#L6591)).
- **Top-down cascading destroy** (an ancestor's own `dispose()` recursively destroying a whole live subtree) never calls `unwireChild` either, for the same reason. This is harmless here: every component in that cascade is being destroyed together, so a stale count on a mid-tree container is moot the instant that container is itself gone.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `_onPreferredSizeChange`/`_onConstraintSizeChange` fields ([:502-507](packages/lib/src/typescript/lib/core/Component.ts#L502-L507)), `onDestroy` ([:920](packages/lib/src/typescript/lib/core/Component.ts#L920)), `registerListenerBag` ([:935](packages/lib/src/typescript/lib/core/Component.ts#L935)), `isEffectivelyVisible`/`propagateEffectiveVisibility` ([:2250](packages/lib/src/typescript/lib/core/Component.ts#L2250)/[:2291](packages/lib/src/typescript/lib/core/Component.ts#L2291)), `clampsToContentSize` ([:3892](packages/lib/src/typescript/lib/core/Component.ts#L3892)), `getParentComponent` ([:6301](packages/lib/src/typescript/lib/core/Component.ts#L6301)), `addComponent`/`insertComponent`/`wireChild` ([:6400](packages/lib/src/typescript/lib/core/Component.ts#L6400)/[:6435](packages/lib/src/typescript/lib/core/Component.ts#L6435)/[:6348](packages/lib/src/typescript/lib/core/Component.ts#L6348)), `removeComponent`/`unwireChild` ([:6541](packages/lib/src/typescript/lib/core/Component.ts#L6541)/[:6371](packages/lib/src/typescript/lib/core/Component.ts#L6371)), `disposeAllComponents` ([:6591](packages/lib/src/typescript/lib/core/Component.ts#L6591)). **The precedent this plan's relay mirrors.**
- [`packages/lib/src/typescript/lib/core/ListenerBag.ts`](packages/lib/src/typescript/lib/core/ListenerBag.ts) — `add`/`remove`/`fire`, the backing structure for `_dirtyListeners`.
- [`packages/lib/src/typescript/lib/layout/Tab.ts`](packages/lib/src/typescript/lib/layout/Tab.ts) — `setEntryBusy` ([:1626](packages/lib/src/typescript/lib/layout/Tab.ts#L1626)) and its `"busychange"` emit ([:1637](packages/lib/src/typescript/lib/layout/Tab.ts#L1637)). **The precedent for the relay step's "listen, re-derive, re-emit once per transition" shape.**
- [`packages/lib/src/typescript/lib/overlay/Dock.ts:621-626`](packages/lib/src/typescript/lib/overlay/Dock.ts#L621-L626) — `tab.on("busychange", onBusyChanged)`, the closest existing example of one component relaying another's custom event into its own derived state.
- [`packages/lib/src/typescript/lib/component/table/Row.ts:331`](packages/lib/src/typescript/lib/component/table/Row.ts#L331) — the pooled `.dirty` CSS state driven by `ModelRecord.isDirty()`. Read to confirm it is untouched by this plan.
- [`packages/lib/src/typescript/lib/data/ModelRecord.ts:526`](packages/lib/src/typescript/lib/data/ModelRecord.ts#L526) and [`packages/lib/src/typescript/lib/data/AbstractStore.ts:1035`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1035) — the domain-data dirty axis this plan stays separate from.
- [`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts:186`](packages/lib/src/typescript/lib/component/editor/CodeEditor.ts#L186) — `class CodeEditor extends Component`, confirming an editable leaf sits directly on `Component`, not `Container`.
- [`packages/lib/tests/core/StructureMutationPropagation.test.ts`](packages/lib/tests/core/StructureMutationPropagation.test.ts) — the harness template for the new test file (plain `Component` instances, `installTestDOM`, spying on the ancestor-notify hook).
- [`packages/lib/tests/component/element-release.test.ts`](packages/lib/tests/component/element-release.test.ts) and [`plans/implemented/component-element-release.md`](plans/implemented/component-element-release.md) — the precedent for shipping a new base-`Component` mechanism proven by a test-only probe subclass, with no real adopter in the same plan.
- [`plans/implemented/component-underscore-prefix-rename.md`](plans/implemented/component-underscore-prefix-rename.md) — the naming rule the four new private fields must follow.
- [ARCHITECTURE.md](ARCHITECTURE.md) — *Event handling*, *Compose before specializing*, *Keep presentation state out of data Models*.

---

## Non-Goals

- **No real adopter.** `CodeEditor` is not changed to call `setDirty()` in this plan, even though it is the concrete motivating case and already has a `"change"` event to key off. The mechanism needs no per-component enablement step (unlike `release()`'s `canRelease()` gate) — any future component, including `CodeEditor`, can call the inherited `setDirty()` with no base-class work required first. Wiring a real component is deferred to its own follow-up plan.
- **`plans/code-editor-desktop-app.md`'s `FileEditor._dirty`.** That plan's `FileEditor` hand-rolls its own dirty flag and manually calls `tab.setTabName` on every flip. Reconciling it with this mechanism — having `FileEditor` (or `CodeEditor` directly) call the new `setDirty()`, and having a `Tab` decorate its label from `onDirtyChange` instead of a manual call — is natural follow-up work, out of scope here. `plans/code-editor-desktop-app.md` itself is not modified by this plan.
- **No built-in visual decoration.** This plan reports state only. How a `Tab` shows a dot, a `Window` shows an asterisk, or any other container renders "something inside me is dirty" is each consumer's own decision, made by listening to `onDirtyChange` — not a concrete API this plan adds.
- **No change to `Row`/`Cell`/`TreeRow`'s existing `.dirty` CSS state or to `ModelRecord`/`AbstractStore`.** Confirmed as a separate axis in `## Architecture Decisions`; untouched here.

---

## Implementation Notes

- **`tests/overlay/Tooltip.test.ts`'s exact `_destroyCleanups.length` assertion needed updating.** The new `_dirtyListeners` field is `this.registerListenerBag(new ListenerBag<"dirtychange">())`, which calls `onDestroy` once per `Component` instance unconditionally — exactly the per-instance overhead this plan's `[^universal-vs-optin]` footnote already accounts for. One pre-existing test ("does not register a duplicate teardown hook across repeated attach() calls on the same component") hardcoded the absolute baseline count as `1`; it is now `2` for every `Component`, `Tooltip.attach` included. Updated the assertion to `2` with a comment explaining the new baseline, folded into this branch's code commit since the fix exists only because this feature's field addition needs it.
- **`packages/lib/llms.txt` regenerated byte-identical**, confirming this plan's `## Documentation Impact` expectation was based on a mistaken reading of precedent: `component-element-release.md`'s `release()`/`canRelease()` addition to `Component` also left `llms.txt` byte-identical (see commit `fa05ff52`'s message) — the manifest is a hand-curated capability catalog (`scripts/llms/manifest.data.mjs`), not an auto-scan of every class member, so new members on an already-exported class never change it. `npm run docs:llms` was still run per `## Ordered Implementation Steps`, confirming the no-op rather than skipping the step.
- **`unwireChild`'s reconcile (`## Internal Structure`) needed a guard the plan's literal code sample omitted, found by the audit loop.** `removeComponent` calls `unwireChild` unconditionally, even when the target was never actually a child (a redundant second `removeComponent` call, or a call against a component that belongs to a different parent) — a pre-existing trait of `unwireChild` that was harmless before this plan (nulling already-null slots) but, with the dirty relay added, drove `_dirtyDescendantCount` negative on the receiving parent, permanently under-reporting a genuinely dirty descendant added later. Fixed by capturing `const wasChild = component._parent === this` before the pre-existing `component._parent = null` line, and gating the two dirty-relay lines on it — mirroring `insertComponent`'s existing `component._parent === this` / `!== null` guard on the add side. Two regression tests were added to `dirty-state-propagation.test.ts` and confirmed to fail without the fix.
- **`_fireDirtyChangeIfFlipped` fires `_dirtyListeners` directly rather than through a `protected emit(...)`, which the audit loop initially flagged against `ARCHITECTURE.md`'s *Event handling* rule that a custom event MUST use the full `on`/`off`/`emit` + `ListenerBag` shape.** Adding `protected emit(event: "dirtychange", dirty: boolean)` was tried and reverted: `emit`, like `on`/`off`, is one shared method name, and empirically verified against a probe subclass overriding `emit()` for its own event, `this.emit("dirtychange", …)` called from `Component`'s own method resolves to the *subclass's* `emit()` at runtime (ordinary JS prototype dispatch), silently swallowing the dirty-change fire on any of the framework's many custom-event-emitting subclasses. The plan's original direct-fire design was correct; `ARCHITECTURE.md` gained a new "Accepted exception: `Component`'s own `"dirtychange"` event" paragraph instead, alongside the existing cell-editor carve-out, so the rule document matches what the code actually does. Folded in as this branch's one tooling commit.

---

## Notes

[^universal-vs-optin]: Applying [ARCHITECTURE.md](ARCHITECTURE.md)'s *Compose before specializing* test — "does this reduce total complexity summed across every component involved" — the relay side (a parent listening to a child's dirty state and re-deriving its own) has to be wired on *every* parent/child edge regardless of the child's own type, because arbitrary-depth propagation depends on it: a `Panel` that itself never becomes dirty still has to relay a `CodeEditor` three levels below it, so every container-capable class needs the relay wiring whether or not it can itself be marked dirty. A `DirtyAware`-style marker could only ever gate the tiny remainder — children that are guaranteed to never accept children of their own and never call `setDirty` (a `Glyph`, a `Spacer`) — and even there the saving is one `onDirtyChange`/`offDirtyChange` pair per such child, smaller than the cost of the runtime check needed to decide whether to skip it. Meanwhile a marker interface pushes a permanent classification burden onto every future container class (each one must remember to implement/inherit the marker just to let an arbitrary future descendant relay through it), which is exactly *relocating* complexity across a component seam rather than removing it — the case the compose-before-specializing bar rules out. The existing `_onPreferredSizeChange` bubble already settles this precedent at the base-`Component` level: it is wired unconditionally for every child in `wireChild`, including children that never change size, and no opt-in gate was ever introduced for it. On raw cost: `wireChild` already runs once per `addComponent`/`insertComponent` call regardless of this feature, so the two added lines add no new call site; and `Component` already allocates roughly a dozen always-present per-instance objects (`_ownedHandles`, `_ownedSelectors`, `_themeCleanups`, `_destroyCleanups`, `_styleRule`, `_inlineStyle`, `_instanceStyle`, `_activeStates`, `_valueStyleTokens`, `_clipFrameStyle`, `_contentFrameStyle` — [Component.ts:444-637](packages/lib/src/typescript/lib/core/Component.ts#L444-L637)) whether or not a given instance ever uses them, so one more small `ListenerBag` (an empty `Map`) plus two primitives and one arrow-function field is proportionally a minor addition. `Table`/`Tree`'s pooled rows ([`component/table/Body.ts`](packages/lib/src/typescript/lib/component/table/Body.ts), `_rowPool`) don't change this calculus: the pool is a fixed set of `Row`/`Cell` components built once and repositioned on scroll rather than re-added — `addComponent`/`wireChild` runs once per pool slot at construction, not once per scroll frame, so the relay's cost there is bounded and one-time, not per-tick.

[^overload-collision]: `Component` today declares no custom `on`/`off`/`emit` surface of its own — every existing example (`Tab`, `CodeEditor`, `Button`, and roughly fifty other classes) declares its *own* `XEvent` union and its own `on(event: XEvent, …)` overload set on a subclass. TypeScript overload resolution does not merge a subclass's own `on(...)` declaration with an inherited one: the moment a subclass declares `on(event: "change", …): this` (as `CodeEditor` does), only that subclass's declared overloads are visible on instances of it — a hypothetical `Component.on(event: "dirtychange", …)` would be silently unreachable on every one of those ~50 classes unless each one's own event union were widened to include `"dirtychange"`, which is far outside this plan's scope and would need to be repeated for every future custom-event class too. A dedicated `onDirtyChange`/`offDirtyChange` pair sidesteps the collision entirely, because it isn't part of the `on`/`off` overload set any subclass might redeclare — mirroring how `onDestroy(cleanup)` already lives directly on `Component` as its own named method rather than as an `on("destroy", …)` overload.

[^count-not-recursive]: A live recursive walk (`this._ownDirty || this.getComponents().some(c => c.isDirty())`) was considered and rejected: it needs no bookkeeping and no `unwireChild` reconciliation, but it makes `isDirty()` cost O(subtree) instead of O(1) on every call, and — because "fires exactly once per real transition" requires comparing a before/after value — the push notification would still need the same relay wiring to know *when* to re-check, so the recursive form doesn't actually avoid the wiring, only the caching. Given the wiring is needed either way, caching a count avoids the O(subtree) query cost for free.
