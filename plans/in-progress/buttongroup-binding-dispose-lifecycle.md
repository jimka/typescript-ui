# ButtonGroup and Binding Dispose Lifecycle — Implementation Plan

## Overview

[`ButtonGroup`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts) and [`Binding`](packages/lib/src/typescript/lib/core/Binding.ts) each own a private `ListenerBag` for their own emitted events (`ButtonGroupEvent`, `BindingEvent`) but have no lifecycle hook that ever clears it — the same bug the `Component.registerListenerBag` / `LayoutManager.registerListenerBag` retrofit fixed everywhere else. Neither class can reuse that fix directly: `ButtonGroup` extends nothing ([`ButtonGroup:51`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L51)), and `Binding extends BaseObject` ([`Binding:64`](packages/lib/src/typescript/lib/core/Binding.ts#L64)), whose only members are `getId()` / `setId()` / `getClassName()` — no teardown hook at all.

This plan adds a plain `dispose()` method to each class, following the precedent [`CellEditorPool.dispose()`](packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts#L120) already establishes for a non-`Component` class that owns disposable resources: a public method the *owner* calls explicitly, with no base-class machinery. `Binding.dispose()` does one thing beyond clearing its bag — it also unwinds the field-change subscriptions `Binding` itself registers on the components it binds to, reusing the deactivation mechanism `unbind()` already has.

Both changes are purely additive. The two files that currently construct a `Binding` — [`MultiSelectListPanel.ts`](packages/lib/src/typescript/MultiSelectListPanel.ts) and [`BindingPanel.ts`](packages/lib/src/typescript/BindingPanel.ts) — are demo panels under `packages/lib/src/typescript/` (not library internals) and are explicitly left unwired; see *Demo panels stay unwired* below.

---

## Architecture Decisions

### `dispose()` is a plain public method, not a `registerListenerBag`-style base hook

Both classes get a `dispose(): void` method that clears `_listeners` directly, with no generic "any class can register a bag" mechanism.[^why-not-layoutmanager]

### `ButtonGroup.dispose()` only clears its own bag

`ButtonGroup.addButton` registers `button.on("action", () => this.updateButtonStates(button))` ([`ButtonGroup:220`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L220)), and `setContainer` registers `Event.addSubtreeListener(container, "keydown", …)` ([`ButtonGroup:271`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts#L271)). Both are DOM-routed `Event` API registrations keyed by the *target's own component id* — the button's or the container's — not by `ButtonGroup`'s. `Component.destructor()` already calls `Event.purgeComponent(this.getId())` on itself ([`Component.ts:979`](packages/lib/src/typescript/lib/core/Component.ts#L979)), which drops every registration under that id regardless of who added it. So both registrations are released automatically when the button or the container is destroyed — the "listen to my own children" case, not "listen to something I don't own."[^event-ownid] `ButtonGroup.dispose()` therefore only needs `this._listeners.clear()`.

### `Binding.dispose()` also unwinds its field subscriptions, reusing `unbind()`

`Binding.bind()` calls `acc.listen(fn)` ([`Binding:105`](packages/lib/src/typescript/lib/core/Binding.ts#L105)), which — in the short form — is `component.on("binding", fn)`: `fn` is registered into the *bound component's own* `ListenerBag`, not `Binding`'s. This is the "listen to something I don't own" case: unlike a `Component`, `Binding` is not on any tree a bound component's destructor would notice, so nothing tears this down automatically. Neither `Bindable` nor `BindingAccessors` gives `Binding` a way to physically remove `fn` (`listen` returns `void`; there is no matching `unlisten`/`off` callback) ([`Bindable.ts:9-13`](packages/lib/src/typescript/lib/core/Bindable.ts#L9-L13)). Widening those interfaces to add one is out of scope for a minimal fix.[^bindable-interface-scope]

`unbind()` already has a way to make a stray subscription harmless without removing it: it sets `entry.active = false` ([`Binding:138`](packages/lib/src/typescript/lib/core/Binding.ts#L138)), and the closure `bind()` registered checks `entry.active` before doing anything else ([`Binding:110`](packages/lib/src/typescript/lib/core/Binding.ts#L110)). `dispose()` reuses this: it calls `unbind(fieldName)` for every bound field, so any listener still registered on a bound component becomes a permanent no-op, then clears its own `_listeners` bag.

### Demo panels stay unwired

[`MultiSelectListPanel.ts:121`](packages/lib/src/typescript/MultiSelectListPanel.ts#L121) and [`BindingPanel.ts:72`](packages/lib/src/typescript/BindingPanel.ts#L72) each construct a `Binding` as a local `const`, never stored on a field, with no `destructor()` override in either panel. Wiring `binding.dispose()` into either file is left as a follow-up, not built here: every listener `Binding` registers in both panels lives inside a component that is itself a descendant of the panel (added via `addComponent`, directly or through a row/`LabeledFieldSet`), so disposing the panel already clears every one of those components' own bags — including the closures `Binding.bind()` registered into them — via the existing `registerListenerBag` fix.[^demo-reachability] `Binding.dispose()` becomes necessary at these two call sites only if a future edit stops holding one of the bound components as a panel descendant.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/overlay/ButtonGroup.ts
class ButtonGroup {
    dispose(): void;
}

// packages/lib/src/typescript/lib/core/Binding.ts
export class Binding extends BaseObject {
    dispose(): void;
}
```

---

## Ordered Implementation Steps

1. **`ButtonGroup.dispose()`** — in [`ButtonGroup.ts`](packages/lib/src/typescript/lib/overlay/ButtonGroup.ts), insert a new public method directly after `setAllowDeselect()` ends (line 128) and before the `on()` JSDoc begins (line 130):

   ```typescript
   /**
    * Releases this group's own event-listener bag. The buttons this group
    * manages, and any container passed to {@link setContainer}, each own
    * their registrations independently and release them on their own
    * teardown — see the class-level remarks — so this only needs to clear
    * the group's own `"selection"` listeners.
    */
   dispose(): void {
       this._listeners.clear();
   }
   ```

   Verify: `grep -n "dispose" packages/lib/src/typescript/lib/overlay/ButtonGroup.ts` shows the new method.

2. **`Binding.dispose()`** — in [`Binding.ts`](packages/lib/src/typescript/lib/core/Binding.ts), insert a new section directly after `emit()` ends (line 294) and before the `// ── Validation ───...` comment (line 296):

   ```typescript
   // ── Disposal ────────────────────────────────────────────────────────────

   /**
    * Releases this binding's own resources: detaches every field registered
    * via {@link bind} — mirroring {@link unbind}, so a bound component's
    * still-registered "binding"/"change" listener becomes a permanent
    * no-op instead of writing into a dead binding — then clears the
    * emitted-event listener bag.
    *
    * @remarks Does not touch validation state; see {@link clearValidation}
    *   for that.
    */
   dispose(): void {
       for (const fieldName of [...this._entries.keys()]) {
           this.unbind(fieldName);
       }

       this._listeners.clear();
   }
   ```

   Verify: `grep -n "dispose" packages/lib/src/typescript/lib/core/Binding.ts` shows the new method.

3. **Tests — `ButtonGroup.dispose()`** — append a new `describe('ButtonGroup.dispose()', …)` block to the end of [`tests/overlay/ButtonGroup.test.ts`](packages/lib/tests/overlay/ButtonGroup.test.ts), reusing the file's existing `selectVia` helper and `installTestDOM(CONFIG)` setup. See *Expected Behaviour* for the cases to cover.

4. **Tests — `Binding.dispose()`** — append a new `describe('Binding.dispose()', …)` block to the end of [`tests/component/binding/Binding.test.ts`](packages/lib/tests/component/binding/Binding.test.ts), reusing the file's existing `FakeWidget` / `accessors()` helpers. See *Expected Behaviour* for the cases to cover.

5. **Changelog** — add one bullet under `## Added` → `### Core` in [`docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md), directly below the existing `ListenerBag.clear()` bullet (ends line 67), matching that section's voice:

   ```markdown
   - **`ButtonGroup.dispose()` and `Binding.dispose()`** release each class's
     own emitted-event `ListenerBag`. Neither class is a `Component` or
     `LayoutManager`, so neither had a teardown hook to piggyback on — unlike
     `registerListenerBag`'s automatic clearing above, a caller that
     constructs a `ButtonGroup` or `Binding` outside a `Component` tree must
     call `dispose()` itself when done with it. `Binding.dispose()`
     additionally deactivates every field registered via `bind()`, the same
     way `unbind()` already does, so a bound component's listener becomes
     inert rather than writing into a dead binding.
   ```

6. **Verify** — run the full check sequence in *Verification* below.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/ButtonGroup.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Binding.ts` |
| Modify | `packages/lib/tests/overlay/ButtonGroup.test.ts` |
| Modify | `packages/lib/tests/component/binding/Binding.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases below are unit-testable offline; none needs a live browser.

1. **`ButtonGroup.dispose()` clears the selection bag.** Register a `"selection"` listener via `on()`, call `dispose()`, then drive a selection change through the existing `selectVia` helper — the listener must not fire.
2. **`ButtonGroup.dispose()` is idempotent.** Calling it twice must not throw.
3. **`Binding.dispose()` deactivates bound fields.** After `bind('name', w, accessors(w))` and `dispose()`, calling `w.edit(...)` must leave the record's `'name'` field unchanged (mirrors the existing `unbind()`-only case, now reached through `dispose()`).
4. **`Binding.dispose()` clears its own emitted-event bag.** Register an `on('commit', fn)` listener, call `dispose()`, then call `binding.commit()` again — `fn` must not fire. (`commit()` calls `this._record?.commit()` unconditionally regardless of `dispose()`, so this isolates the `_listeners.clear()` half from the per-field `unbind()` half tested in case 3.)
5. **`Binding.dispose()` is idempotent.** Calling it twice, including with no bound fields and no listeners, must not throw.

---

## Verification

- `npm run typecheck` (from `packages/lib/`) — must pass with no new errors.
- `npm run test` — must pass, including the four new tests from steps 3–4 above.
- `npm run docs:api` — must finish with zero warnings (per [`CODE_CONVENTIONS.md`](CODE_CONVENTIONS.md), *Don't `{@link}` internal symbols from public JSDoc*); confirms the new JSDoc on both `dispose()` methods resolves cleanly and regenerates the gitignored `packages/lib/docs/api/overlay/classes/ButtonGroup.md` / `packages/lib/docs/api/core/classes/Binding.md` pages.

---

## Documentation Impact

- `packages/lib/docs/api/overlay/classes/ButtonGroup.md` and `packages/lib/docs/api/core/classes/Binding.md` are TypeDoc-generated and gitignored (`packages/lib/docs/api` in `.gitignore`) — no manual edit, just regenerate via `npm run docs:api` per *Verification*.
- `packages/lib/docs/concepts/component-lifecycle.md` already generalizes this exact shape — "a `dispose()` method... on a plain object that merely wraps a `Component`... an owning `Component`'s `destructor()` must call the wrapper explicitly if the wrapper's cleanup needs to run" ([`component-lifecycle.md:155`](packages/lib/docs/concepts/component-lifecycle.md#L155)) — so it needs no edit; `ButtonGroup` and `Binding` are new instances of a pattern the page already documents in the abstract.
- `packages/lib/docs/components/ButtonGroup.md` and `packages/lib/docs/data/binding.md` (the hand-written guide pages) currently say nothing about lifecycle or cleanup for either class; adding a caveat there is left out of scope, consistent with *Demo panels stay unwired* above.
- Changelog entry: see step 5.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts`](packages/lib/src/typescript/lib/component/table/cell/editor/CellEditorPool.ts) — the precedent this plan's `dispose()` shape follows: a plain class, no base-class lifecycle, explicit `dispose()` called by its owner.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) (`registerListenerBag` at line 918, `destructor()`'s `Event.purgeComponent` call at line 979) and [`packages/lib/src/typescript/lib/layout/LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts) (`registerListenerBag` at line 137) — the original fix this plan extends to two classes it couldn't reach.
- [`packages/lib/src/typescript/lib/core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) (`addListener`/`purgeComponent`, lines 540-552 and 677-701) — confirms `Event` registrations are keyed by the target's own component id, which is why `ButtonGroup.dispose()` needs no unwind of its `Event.addListener`/`addSubtreeListener` calls.
- [`packages/lib/docs/concepts/component-lifecycle.md`](packages/lib/docs/concepts/component-lifecycle.md) (Disposal section, line 144 onward) — states the general contract this plan's two classes now instantiate.
- [`packages/lib/tests/core/ComponentDispose.test.ts`](packages/lib/tests/core/ComponentDispose.test.ts) and [`packages/lib/tests/unit/core/ListenerBag.test.ts`](packages/lib/tests/unit/core/ListenerBag.test.ts) — the test shape the new `ButtonGroup.dispose()` / `Binding.dispose()` tests follow (assert the bag is empty and a subsequent fire/emit is a no-op, plus an idempotency case).

---

## Non-Goals

- Widening `Bindable`/`BindingAccessors` with an `unlisten`/`off` callback so `Binding.dispose()` could physically remove its subscriptions instead of deactivating them via `unbind()`'s existing flag. The flag mechanism already renders a stray subscription harmless; a public-API change to do the same thing more expensively is not justified by this bug.
- Wiring `binding.dispose()` into `MultiSelectListPanel.ts` or `BindingPanel.ts`. See *Demo panels stay unwired*.
- Touching `ButtonGroup`'s `_rovingTabIndex` / `setContainer`'s subtree-listener registration. It is a pre-existing `Event`-API registration on an externally-owned `container`, self-cleaning via that container's own `Component.destructor()` — a different mechanism from the `ListenerBag` bug this plan fixes, and not touched here.
- Any change to `Binding`'s validation state (`_validationConfigs`, `FieldDecorator`) on `dispose()`. Out of scope; `clearValidation()` already exists for that and is untouched.

---

## Notes

[^why-not-layoutmanager]: `LayoutManager.registerListenerBag` exists because three concrete subclasses (`Tab`, `Split`, `Accordion`) share one base class and one teardown hook (`detach()`), so a generic "push a cleanup, run it once" array on the shared base pays for itself. `ButtonGroup` and `Binding` are each the only class of their kind — there is no shared base to put a registration helper on, and no second caller to justify one. `CellEditorPool.dispose()` is the closer precedent: a single plain class, no inheritance hook, `dispose()` just does the cleanup inline.

[^event-ownid]: `Event.addListener(component, type, listener)` stores `listener` keyed by `component`'s id in a module-level map ([`Event.ts:540-552`](packages/lib/src/typescript/lib/core/Event.ts#L540-L552)); `Component.destructor()` calls `Event.purgeComponent(this.getId())` on itself ([`Component.ts:979`](packages/lib/src/typescript/lib/core/Component.ts#L979)), which deletes every entry under that id from both the exact-target and subtree listener maps ([`Event.ts:677-701`](packages/lib/src/typescript/lib/core/Event.ts#L677-L701)) — regardless of which module originally called `addListener`. So a registration `ButtonGroup` makes against a button or a container is torn down when *that* component is destroyed, not when `ButtonGroup` is.

[^bindable-interface-scope]: `BindingAccessors.listen: (fn: () => void) => void` and `Bindable.on(event, listener): unknown` ([`Bindable.ts:9-13`](packages/lib/src/typescript/lib/core/Bindable.ts#L9-L13), [`Bindable.ts:21-30`](packages/lib/src/typescript/lib/core/Bindable.ts#L21-L30)) give `Binding` no way to remove a listener it registered — no returned disposer, no `unlisten`/`off` counterpart. Adding one would touch every existing `Bindable` implementor and every long-form `bind()` call site across the codebase for a problem `unbind()`'s existing `active` flag already solves without any interface change.

[^demo-reachability]: In both panels every component `Binding.bind()` subscribes to (`nameField`, `activeCheck`, `roleCombo`, `birthDateField`, `reminderTimeField`, `recordCombo`, `tagList`, plus the commit/reject buttons) is added to the panel's own tree via `addComponent`, directly or through a row/`LabeledFieldSet`/`HBox` container. When the panel is disposed, `Component.destructor()` recurses into every one of those descendants, which clears each one's own `_listeners` bag via the earlier `registerListenerBag` fix — removing the very closure `Binding.bind()` registered into it. Once every such closure is gone, nothing in the panel's tree still references the local `binding` variable, and it becomes ordinary garbage. This only holds because today's two call sites bind exclusively to panel descendants; a future bind to a component *outside* the panel's tree would need `binding.dispose()` wired to the panel's own teardown.
