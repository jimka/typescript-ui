---
depends-on: [component-style-rule-disposal]
touches-shared:
  - packages/lib/src/typescript/lib/layout/Tab.ts
  - packages/lib/src/typescript/lib/component/container/TabBar.ts
---

# Component Teardown Seam — Implementation Plan

## Overview

`Component.destructor()` ([Component.ts:693](src/typescript/lib/core/Component.ts#L693)) does the whole job of tearing a component down: it recurses over `_components`, releases theme subscriptions, removes the element, deletes the component's per-instance `#uuid` stylesheet rules, and releases tracked DOM handles. It is `protected`, so TypeScript error TS2446 stops anyone outside the class hierarchy from calling it. An owner that holds a component in a private field — rather than as a registered child in `_components` — therefore has no way to destroy it, and neither does a plain namespace function. `removeComponent` is not a substitute: it deliberately only detaches, because a removed child may be re-parented by a `moveComponent`.

The result is a leak class. Owners hand-roll partial `dispose()` methods that clean up the one or two concerns they happen to remember, and each orphaned component's rules stay on the shared `<style id="Base">` sheet for the life of the page. Sixteen classes already define a `dispose()` method; none of them deletes a style rule, except the one added last week ([WindowBorder.ts:319](src/typescript/lib/component/container/WindowBorder.ts#L319)), which does it by delegating to its own `destructor()`.

This plan promotes that delegation into the base class: `Component` gains a public `dispose()` whose body calls `this.destructor()`. Every existing `dispose()` becomes a real override that ends in `super.dispose()`, so one call always means full teardown. `Animation.materialize` then disposes the spinner it mounts, closing the deferred-content leak at both call sites, and the duplicated spinner-wrap construction moves into one shared module.

**Git base.** This work branches off `feature/stylesheet-rule-leak` (local, unmerged, one commit ahead of local `master`), which added `WindowBorder.dispose()` and the rule-disposal test this plan's tests mirror. Never rebase onto `origin/master` — local `master` is ahead of it.

---

## Architecture Decisions

### `dispose()` is the public teardown verb; the base implementation delegates to `destructor()`

`Component` gains `public dispose(): void`, whose entire body is `this.destructor()`. The protected `destructor()` stays exactly as it is and keeps its role as the **override hook**; `dispose()` is the **call entry point**.[^naming]

This mirrors [WindowBorder.ts:319](src/typescript/lib/component/container/WindowBorder.ts#L319), which is literally `dispose() { this.destructor(); }` — added in commit `3e72223a` for the same reason (a privately-held component the base recursion cannot reach). Promoting one line to the base class deletes that override rather than inviting sixteen more like it.

### Every existing `dispose()` becomes a real override ending in `super.dispose()`

A `dispose()` that does not chain to the base silently under-delivers once the base contract exists. Every one that survives this plan therefore ends with `super.dispose()` (two are deleted instead — `WindowBorder`'s body becomes exactly the inherited one, and `Text`'s single concern moves onto the base theme bag). This is safe because **every in-library call site is a permanent-discard site** — the owner drops the reference and rebuilds, so full teardown is what each site already wanted:[^absorb]

| Call site | What happens right after | Classification |
|---|---|---|
| [Tab.ts:962](src/typescript/lib/layout/Tab.ts#L962) `this._bar.dispose()` | `Tab.detach()`; only reached when `setLayoutManager` replaces the manager | full destroy |
| [MenuBar.ts:151](src/typescript/lib/component/menubar/MenuBar.ts#L151) / [:155](src/typescript/lib/component/menubar/MenuBar.ts#L155) | `_panels.length = 0` / `_buttons.length = 0`, then rebuild | full destroy |
| [Menu.ts:263](src/typescript/lib/overlay/Menu.ts#L263) / [:880](src/typescript/lib/overlay/Menu.ts#L880) | `_menuItems = []` + `removeAllComponents()`, then rebuild | full destroy |
| [Menu.ts:774](src/typescript/lib/overlay/Menu.ts#L774) | inside `Menu.dispose()` — the menu itself is being torn down | full destroy |
| [TablePanel.ts:171](src/typescript/lib/component/table/TablePanel.ts#L171) | bar already `removeComponent`'d, replaced by a new one | full destroy |
| [TreeTablePanel.ts:208](src/typescript/lib/component/table/TreeTablePanel.ts#L208) | same as `TablePanel` | full destroy |
| [AbstractChart.ts:1090](src/typescript/lib/component/chart/AbstractChart.ts#L1090) `this._legend.dispose()` | inside `AbstractChart.dispose()` | full destroy |
| [MarkdownEditor.ts:815](src/typescript/lib/component/editor/MarkdownEditor.ts#L815) | inside `MarkdownEditor.dispose()` | full destroy |
| [VideoPlayer.ts:554](src/typescript/lib/component/display/VideoPlayer.ts#L554) | inside `VideoPlayer.dispose()` | full destroy |
| [Link.ts:273](src/typescript/lib/component/input/Link.ts#L273) `super.dispose()` | inside `Link.dispose()` | full destroy |
| [AbstractWindow.ts:888](src/typescript/lib/overlay/AbstractWindow.ts#L888) `border.dispose()` | inside `AbstractWindow.destructor()` | full destroy |

There is no partial-cleanup call site to preserve. Test call sites (`Video.test.ts:310`, `PaginationBar.test.ts:212`, `Markdown.test.ts:554`, `Link.test.ts:56` / `:329`, `MenuBarButton.test.ts:95`, `Chart.test.ts:163` / `:183`) only assert that disposal runs without throwing, and stay valid.

Two of the sixteen need more than an appended line:

- **[TabBar.ts:782](src/typescript/lib/component/container/TabBar.ts#L782)** returns `this` and removes its own element. It changes to return `void` (matching the base) and drops the element-removal block, because the base already removes the element. Its drag teardown, spring-raise reset, and move-trigger teardown stay.
- **[Text.ts:1275](src/typescript/lib/component/input/Text.ts#L1275)** is deleted outright — see the theme-subscription decision below.

`WindowBorder.dispose()` is deleted too: it becomes exactly the inherited body.

### `Animation.materialize` disposes what it discards

`dropSpinner` ([Animation.ts:438](src/typescript/lib/core/Animation.ts#L438)) currently calls `host.removeComponent(spinner)` and stops there, orphaning the wrap and its two descendants — three components, so at least three rules stranded on the shared sheet per materialization. It gains `spinner.dispose()` after the removal. The stale path additionally disposes the component the factory built, which is discarded without ever being attached.[^stale]

The same orphaning exists at [Tab.ts:1072](src/typescript/lib/layout/Tab.ts#L1072), where closing a tab mid-build removes the mounted spinner without disposing it. It gets the same one-line fix.

### One shared spinner wrap

[Tab.createSpinnerWrap](src/typescript/lib/layout/Tab.ts#L1485) and [AbstractWindow.show](src/typescript/lib/overlay/AbstractWindow.ts#L638) build a byte-identical wrap: a bare `Component` with `Fit({ fill: FillType.NONE })` holding `new ProgressSpinner(24)`. That construction moves to a new module `component/display/SpinnerWrap.ts` exporting `createSpinnerWrap(): Component`, which both call sites import.

The module is **not** added to the `component/display` barrel. It mirrors [core/ScrollShadow.ts](src/typescript/lib/core/ScrollShadow.ts), the framework's existing "shared visual recipe imported directly by its two consumers, never re-exported" module — so the helper stays out of the published API surface and out of the generated docs.

### `Text` subscribes through the base theme bag

`Text` holds its own `_unsubscribeTheme` disposer ([Text.ts:104](src/typescript/lib/component/input/Text.ts#L104), assigned at [Text.ts:145](src/typescript/lib/component/input/Text.ts#L145)), which is the only thing its `dispose()` releases. The field and the `dispose()` override are both removed, and the subscription is registered through the inherited `this.subscribeTheme(...)` ([Component.ts:686](src/typescript/lib/core/Component.ts#L686)) instead, whose disposers the base `destructor()` already drains. `TabBar`'s `_themeCleanup` field ([TabBar.ts:497](src/typescript/lib/component/container/TabBar.ts#L497), assigned once in the constructor at [TabBar.ts:632](src/typescript/lib/component/container/TabBar.ts#L632)) moves the same way.[^themebag]

Only these two migrate. `Markdown`, `CodeEditor`, `AbstractChart`, and `Tab` keep their hand-held disposers — their `dispose()` methods have other work to do regardless, so migrating them would be churn without a deletion.

### A registry test enforces the contract class-wide

Whether a `dispose()` chains to `super` is invisible to a typechecker and invisible to any single behavioural test. The codebase already guards one such class-wide, mechanically-checkable rule with a table-driven registry test — [tests/component/default-options-fallback.test.ts](tests/component/default-options-fallback.test.ts), which carries one row per class that defaults a field. This plan adds `tests/component/dispose-full-teardown.test.ts` in the same shape: one row per class that defines `dispose()`, each asserting that constructing, rendering, and disposing an instance leaves zero new keys in the `StyleTarget` rule cache.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/core/Component.ts
class Component<TOptions extends ComponentOptions = ComponentOptions> {
    /** Destroys the component: children, subscriptions, element, style rules, handles. */
    dispose(): void;
}
```

```typescript
// packages/lib/src/typescript/lib/component/display/SpinnerWrap.ts  (new, not barrelled)
export function createSpinnerWrap(): Component;
```

Changed signature:

```typescript
// packages/lib/src/typescript/lib/component/container/TabBar.ts
dispose(): void;   // was: dispose(): this
```

Removed: `Text.dispose()`, `WindowBorder.dispose()`, `Text._unsubscribeTheme`, `TabBar._themeCleanup`, `Tab.createSpinnerWrap`.

---

## Ordered Implementation Steps

Written test-first: steps 1–2 add failing tests, steps 3–11 make them pass.

1. **Add `tests/core/ComponentDispose.test.ts`.** Mirror the structure of [tests/overlay/AbstractWindow.styleRuleDisposal.test.ts](tests/overlay/AbstractWindow.styleRuleDisposal.test.ts) — `installTestDOM(CONFIG)` in `beforeEach`, `DOM.reset()` in `afterEach`, `_ruleCacheKeys()` from `~/core/StyleTarget` for the before/after diff. Cover the `Component.dispose()` cases in `## Expected Behaviour`. These fail to compile until step 3.

2. **Add `tests/component/dispose-full-teardown.test.ts`.** A `const REGISTRY: Array<{ name: string; make?: () => Component; reason?: string }>` with one row per class that defines its own `dispose()`. For each row with a `make`, construct, call `getElement(true)`, call `dispose()`, and assert the rule-cache diff against `before` is empty. A class that cannot be built in the offline harness carries a `reason` string and no `make`, so the enumeration stays complete and the gap is visible. Do not write a hard-coded class count into the test — step 12's grep is what keeps the registry complete.

3. **Add `dispose()` to `Component`** ([Component.ts](src/typescript/lib/core/Component.ts), immediately above `destructor()` at line 693). Body: `this.destructor();`. JSDoc must describe the destructor's work in prose — it may not `{@link destructor}`, which is `protected` and excluded from the docs build (see `CODE_CONVENTIONS.md`). State that it is idempotent and that an override must call `super.dispose()`.

4. **`Animation.materialize`** ([Animation.ts:438](src/typescript/lib/core/Animation.ts#L438)): add `spinner.dispose();` between `host.removeComponent(spinner)` and `host.scheduleLayout()`. In `attach`, inside the `config.isStale?.()` branch, add `component.dispose();` after `dropSpinner()`.

5. **Create `component/display/SpinnerWrap.ts`** exporting `createSpinnerWrap(): Component` with the body currently at [Tab.ts:1486-1489](src/typescript/lib/layout/Tab.ts#L1486). Carry over the two comments explaining the `FillType.NONE` centring and the 24 px diameter. Do **not** add it to `component/display/index.ts`.

6. **`Tab.ts`**: delete `createSpinnerWrap` (line 1485), import `createSpinnerWrap` from `~/component/display/SpinnerWrap.js`, and update the call at line 1566. Add `spinner.dispose();` after `container.removeComponent(spinner)` at [Tab.ts:1072](src/typescript/lib/layout/Tab.ts#L1072). Drop the now-unused `ProgressSpinner` / `Fit` / `FillType` imports **only if** nothing else in the file uses them — check before deleting.

7. **`AbstractWindow.ts`**: replace the four-line inline spinner construction at [line 638](src/typescript/lib/overlay/AbstractWindow.ts#L638) with `const spinner = createSpinnerWrap();` and add the import. Drop now-unused imports under the same check as step 6.

8. **`WindowBorder.ts`**: delete the `dispose()` override at line 319. `AbstractWindow.destructor()`'s `border.dispose()` call at line 888 is unchanged and now resolves to the inherited method.

9. **`Text.ts`**: delete the `dispose()` method (line 1275) and the `_unsubscribeTheme` field (line 104); change the assignment at line 145 to `this.subscribeTheme(() => { … });` keeping the callback body verbatim. Then check `Link.dispose()` ([Link.ts:269](src/typescript/lib/component/input/Link.ts#L269)) still compiles — its `super.dispose()` now binds to `Component.dispose()`.

10. **`TabBar.ts`**: delete the `_themeCleanup` field (line 497); change line 632 to `this.subscribeTheme(() => { … });` keeping the callback body verbatim; rewrite `dispose()` (line 782) to return `void`, drop the `_themeCleanup` block and the `getElement()` / `DOM.sink.removeElement` block and the `return this`, keep `teardownTabDnD()` / `clearSpringRaise()` / `_moveTriggerTeardown`, and end with `super.dispose();`.

11. **Append `super.dispose();` as the last statement** of each remaining `dispose()` method: `Markdown.ts:515`, `Video.ts:493`, `VideoPlayer.ts:553`, `MenuItem.ts:436`, `AbstractChart.ts:1065`, `ChartLegend.ts:322`, `MenuBarButton.ts:165`, `CodeEditor.ts:458`, `MarkdownEditor.ts:811`, `PaginationBar.ts:154`, `Menu.ts:769`, `Popover.ts:596`. `Link.dispose()` already ends with `super.dispose()` — leave it unchanged.

12. **Regression checkpoints.** `grep -rn 'this.destructor()' packages/lib/src/typescript/lib` — expect hits only inside `Component.dispose()`. `grep -rn 'dispose(): this' packages/lib/src/typescript/lib` — expect zero matches. Count the `dispose()` definitions with `grep -rn '^\s*dispose(' packages/lib/src/typescript/lib` and confirm the registry in step 2 has exactly that many rows, `Component`'s own definition excluded; if the two disagree, stop and report rather than adjusting either number to match.

13. **Run `npm run test`** in `packages/lib` (typechecks the tests, then runs vitest). Confirm the `Errors` line reports 0 and the process exit code is 0 — a passing test count alone does not mean the run was clean.

14. **Update documentation** per `## Documentation Impact`, then run `npm run docs:build` and confirm 0 errors and 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/component/display/SpinnerWrap.ts` |
| Create | `packages/lib/tests/core/ComponentDispose.test.ts` |
| Create | `packages/lib/tests/component/dispose-full-teardown.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Animation.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Popover.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/WindowBorder.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/MenuItem.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Markdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/Video.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/VideoPlayer.ts` |
| Modify | `packages/lib/src/typescript/lib/component/display/PaginationBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/chart/AbstractChart.ts` |
| Modify | `packages/lib/src/typescript/lib/component/chart/ChartLegend.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/MarkdownEditor.ts` |
| Modify | `packages/lib/docs/concepts/component-lifecycle.md` |
| Modify | `packages/lib/docs/concepts/performance.md` |
| Modify | `packages/lib/docs/concepts/theming.md` |
| Modify | `packages/lib/docs/reference/troubleshooting.md` |
| Modify | `packages/lib/docs/components/Text.md` |
| Modify | `packages/lib/docs/components/PaginationBar.md` |

---

## Expected Behaviour

All cases below are unit-testable in the offline harness. "New rule-cache keys" means `_ruleCacheKeys()` entries absent from a snapshot taken before the component was constructed — the cache is module state that survives `DOM.reset()`, so an absolute count would be polluted by earlier tests.

| # | Case | Expected |
|---|---|---|
| 1 | A rendered `Component` with children is `dispose()`d | zero new rule-cache keys remain; `getElement()` returns undefined |
| 2 | `dispose()` is called twice on the same component | second call is a no-op, throws nothing, still zero new keys |
| 3 | A never-rendered component is `dispose()`d | throws nothing; no keys were added, none removed |
| 4 | A component held only in a private field (not in `_components`) is `dispose()`d by its owner | zero new keys — the case `removeComponent` could not close |
| 5 | Any class in the `dispose-full-teardown` registry: construct → render → `dispose()` | zero new rule-cache keys |
| 6 | `Animation.materialize` completes its fade | the spinner wrap's three components leave zero new keys |
| 7 | `Animation.materialize` settles while `isStale()` returns `true` | spinner and the built component both leave zero new keys; nothing is attached to the host |
| 8 | A `Tab` lazy tab is closed while its build is in flight | the mounted spinner leaves zero new keys |
| 9 | `TabBar.dispose()` | element removed, drag wiring torn down, zero new keys |
| 10 | A `Text` is constructed, rendered, and `dispose()`d | its theme subscription is released and zero new keys remain |
| 11 | A theme change fires after a `Text` has been disposed | the disposed instance's callback does not run |

Manual verification (not reachable offline): open and close a lazy `Tab` and a factory-backed `Window` several times in the dev app on `http://localhost:8015` with DevTools open, and confirm the `Base` stylesheet's rule count returns to its pre-open value rather than climbing per cycle.

---

## Verification

- `npm run typecheck` and `npm run typecheck:test` in `packages/lib`.
- `npm run test` in `packages/lib`. **Check the `Errors` line and the exit code, not just the passed count** — an unhandled async or GC-time exception fails the run without failing any individual test.
- `grep -rn 'dispose(): this' packages/lib/src/typescript/lib` — zero matches.
- `grep -rn '_unsubscribeTheme' packages/lib/src/typescript/lib/component/input/Text.ts` — zero matches.
- `grep -rn 'ProgressSpinner(24)' packages/lib/src/typescript/lib` — exactly one match, in `SpinnerWrap.ts`.
- `npm run docs:build` — 0 errors, 0 link warnings (TypeDoc's "unsupported TypeScript version" notice is the only acceptable one).
- Manual: the dev app at `http://localhost:8015` — the tab demo panel's lazy tabs and a window opened through `setContentFactory`.

---

## Documentation Impact

**Export surface.** `Component` is already re-exported from the `core` barrel ([core/index.ts:17](src/typescript/lib/core/index.ts#L17)), so a new method needs no barrel change and picks up the existing `@category Core`. `SpinnerWrap.ts` is deliberately **not** barrelled, so it produces no API page — same treatment as `core/ScrollShadow.ts`.

**JSDoc.** `Component.dispose()` gets a full doc comment. It must not `{@link destructor}` or `{@link trackHandle}` — both are `protected` and excluded from the build, which would emit a "resolved but is not included in the documentation" warning. Describe the work in prose instead. Cross-bucket references from `component/*` files back to `Component` use the link form `` [`Component`](/api/core/classes/Component) ``, not `{@link}`.

**Pages to edit:**

- `docs/concepts/component-lifecycle.md` — the "Subclass hooks" table (line ~127) gains a `dispose()` row, and the "Disposal" section (line ~133) is rewritten around `dispose()` as the general teardown call rather than a `Text`-specific listener detach.
- `docs/concepts/performance.md` (lines ~81-95) — the sample custom component currently overrides `destructor()` to reach a child's `dispose()`; change it to override `dispose()` and call `super.dispose()`.
- `docs/reference/troubleshooting.md` (lines ~75-85) — same code sample, same change.
- `docs/concepts/theming.md` (line ~241) and `docs/components/Text.md` (line ~44) — `Text` no longer needs a bespoke `dispose()`; restate as "call `dispose()` on any component you create and discard yourself".
- `docs/components/PaginationBar.md` (lines ~69-76) — `bar.dispose()` now also destroys the bar; adjust the wording from "detach its store listeners" to full disposal.

`packages/lib/llms.txt` is generated by `npm run docs:llms` (folded into `docs:build`) — never hand-edit it.

---

## Potential Challenges

- **A `dispose()` override that forgets `super.dispose()` reintroduces the leak silently.** The registry test in `tests/component/dispose-full-teardown.test.ts` is the guard; every new `dispose()` must add a row.
- **Disposing a child that is still in the parent's `_components`.** `Menu.showAnchored` disposes its items and *then* calls `removeAllComponents()`. This is safe in either order because `removeComponent` → `unwireChild` → `removeElement()` early-returns when `getElement()` is undefined, which it is after teardown. Keep the existing order rather than reshuffling these methods.
- **Anything reachable from the `FinalizationRegistry` callback in `Component.ts` that touches `document` throws at an arbitrary GC time in the node test environment.** This plan adds nothing to that path — keep it that way; if a step tempts you to, guard with `typeof document === "undefined"`.
- **`Tab.detach()` destroying its strip makes the manager single-use.** That is already true today (the current `dispose()` removes the strip's element), and `detach()` is only reached from `setLayoutManager` replacing the manager. Do not add re-attach support.
- **`Menu.dispose()` asserts persistent mode** before doing anything, so a rebuild-mode context menu still cannot be disposed. That predates this plan; leave the assertion where it is.

---

## Critical Files

- [`src/typescript/lib/core/Component.ts`](src/typescript/lib/core/Component.ts) — `destructor()` (693), `subscribeTheme()` (686), `trackHandle()` (753), `removeComponent` / `unwireChild`.
- [`src/typescript/lib/component/container/WindowBorder.ts`](src/typescript/lib/component/container/WindowBorder.ts) — the precedent this plan promotes to the base class (`dispose()` at 319).
- [`src/typescript/lib/core/StyleTarget.ts`](src/typescript/lib/core/StyleTarget.ts) — `disposeStyleRule` (202), `_ruleCacheKeys` (215).
- [`tests/overlay/AbstractWindow.styleRuleDisposal.test.ts`](tests/overlay/AbstractWindow.styleRuleDisposal.test.ts) — the rule-cache-diff test shape to copy.
- [`tests/component/default-options-fallback.test.ts`](tests/component/default-options-fallback.test.ts) — the registry-test shape to copy.
- [`src/typescript/lib/core/ScrollShadow.ts`](src/typescript/lib/core/ScrollShadow.ts) — the unbarrelled shared-recipe module `SpinnerWrap.ts` mirrors.
- [`src/typescript/lib/core/Animation.ts`](src/typescript/lib/core/Animation.ts) — `materialize` (432) and `dropSpinner` (438).

---

## Non-Goals

- **Purging `Event`'s listener maps on teardown.** `Event`'s `type → id → fn` maps ([core/Event.ts:52-54](src/typescript/lib/core/Event.ts#L52)) retain an entry for every destroyed component that registered a listener and never removed it. That is a second leak class with its own design questions (an `Event.removeAllListeners(component)` seam), and folding it in here would change what a dozen `dispose()` overrides are for mid-flight.
- **Migrating the remaining hand-held theme disposers.** `Markdown`, `CodeEditor`, `AbstractChart`, and `Tab` keep theirs; only the two whose migration deletes a `dispose()` method are touched.
- **Making `removeComponent` destroy.** It must keep detaching only, or `moveComponent` breaks.
- **Making `destructor()` public.** It stays the protected override hook.

---

## Notes

[^naming]: Two alternatives were considered and rejected.

    **A differently-named public method (`destroy()`).** It sidesteps the name collision entirely and needs no edits to the sixteen existing `dispose()` methods. It was rejected because the collision is the point: leaving sixteen `dispose()` methods that each tear down a fraction of a component, beside a `destroy()` that tears down all of it, means a consumer calling the documented `dispose()` still leaks rules, and now has to know to call both. The codebase has also already voted — `dispose()` is its teardown verb in sixteen classes and in five docs pages, and the most recent teardown fix (`WindowBorder`, commit `3e72223a`) spelled full destruction `dispose() { this.destructor(); }`.

    **Widening `destructor()` to public.** Rejected because `destructor()` is documented as a *subclass hook* — the thing you override, in the "Subclass hooks" table of `docs/concepts/component-lifecycle.md` — not the thing you call. Making the override point the call point also publishes every existing subclass override at once, a much wider API change than adding one method, and it still leaves the sixteen `dispose()` methods under-delivering.

[^absorb]: The classification matters because a base contract can only absorb an existing method if no caller depended on the weaker behaviour. Every in-library caller was read in context; each one either nulls its reference to the disposed component immediately, empties the array holding it, or is itself inside a teardown method. None re-uses the component afterwards, so none can observe the difference between "listeners detached" and "fully destroyed" — except by no longer leaking. The `Tab.detach()` site is the closest call, since "detach" sounds reversible; it is reached only from `Component.setLayoutManager` replacing the manager, and the pre-existing `dispose()` already removed the strip's element, so a re-attached `Tab` was already broken.

[^stale]: In the stale path the factory has already run and returned a component that is then thrown away without ever being passed to `host.addComponent`. An unattached component has usually materialised no rules, so this is often a no-op — but a factory that calls `getElement(true)` on its own tree during construction leaves rules on the sheet, and nothing else can reach the discarded root to clean them up.

[^themebag]: `Component.subscribeTheme` pushes the disposer into `_themeCleanups`, which `destructor()` drains. Both migrations are safe because each subscription happens exactly once, in a constructor body after `super()` has returned — `_themeCleanups` is initialised by then, and there is no re-entry path that could stack a duplicate subscription. A subscription registered from a method that can run more than once would need the duplicate-listener check instead.

---

## Implementation Notes

**Two verification greps in `## Verification` / step 12 have known, pre-existing, out-of-scope hits.** Both were checked by hand; neither is a defect in this implementation.

- `grep -rn 'this.destructor()' packages/lib/src/typescript/lib` returns 4 hits, not 1: `Component.ts:707` (this plan's `dispose()`) plus three pre-existing self-closing lifecycle methods that predate this plan and are not in the Files table — `DialogBackdrop.ts:74` (`destroy()`), `Dialog.ts:1095` (`hide()`'s `finalize`), `AbstractWindow.ts:855` (`close()`'s `finalize`). Each is a class tearing down *itself* from its own lifecycle method, not a `dispose()` override forgetting to chain.
- `grep -rn 'ProgressSpinner(24)' packages/lib/src/typescript/lib` returns 3 hits, not 1: `SpinnerWrap.ts:31` (the new shared module) plus `TablePanel.ts:79` and `TreeTablePanel.ts:93`, each a separate, pre-existing store-loading spinner. Only `Tab.createSpinnerWrap` and `AbstractWindow.show`'s inline construction were ever in the dedup scope (`## Architecture Decisions` → "One shared spinner wrap"); the table spinners were never part of that pair.

**`tests/dom/TestDOM.ts`'s modelled `getElementById` cannot verify "`getElement()` returns `undefined`" after dispose.** Expected Behaviour row 1 (and the TabBar row) include this assertion, but the recording sink's `removeElement` detaches an element from its parent without evicting it from the id-lookup table (`TestHandleTable._byId`), so a disposed component's `getElement()` still resolves the stale handle by id. In production this holds automatically — `document.getElementById` only searches the connected document tree, so a genuinely removed element becomes unfindable with no extra step — so this is a test-harness fidelity gap, not a `Component.ts` defect. `tests/dom/TestDOM.ts` is not in the plan's Files table and fixing it (shared infrastructure for ~220 test files) is out of scope here. The `getElement()`-undefined sub-assertion was dropped from `ComponentDispose.test.ts`; the rule-cache-zero assertion (the part that is verifiable and is the plan's actual concern) stays.

**Two additional raw-appended-outside-`_components` leaks had to be closed for `TabBar.dispose()` to actually deliver "zero new keys" (Expected Behaviour row 9).** Both mirror the exact `WindowBorder` precedent this plan promotes to the base class, just one and two levels deeper than the plan's own read of `TabBar.ts` anticipated:

- `TabBar` itself raw-appends six chrome overlays straight to its own element in `init()` (`_tabClip`, `_toolGroup`, `_leadGroup`, `_indicator`, `_dropTint`, `_reorderBar` — see the doc comment there: "Raw-appends the chrome overlays ... rather than enrolled in a box"), so none of them were ever reachable by the base class's `_components` recursion. `TabBar.dispose()` now disposes all six before `super.dispose()`.
- One of those six, `_tabClip` (a `ScrollStrip`), does the same thing internally: its scrolling clip (`_clip` — which holds every item added via `addItem`, i.e. every tab cell) and its lazily-built paging arrows (`_leadArrow` / `_trailArrow`) are raw-appended to `ScrollStrip`'s own element rather than registered as children. `ScrollStrip` (`src/typescript/lib/component/container/ScrollStrip.ts`, not in the plan's Files table) gained its own `dispose()` override for this reason.

Without the `ScrollStrip` fix specifically, a tab cell's `Text` label kept a live `ThemeManager` subscription past `TabBar.dispose()`, which cross-test-polluted later `ThemeManager.setTheme()` calls elsewhere in the suite (see the `TextDispose.test.ts` note below).

**Two more instances of the same leak shape were found but deliberately NOT fixed — out of scope, and each warrants its own plan:**

- `Panel`'s `_scrollbarV` / `_scrollbarH` overlay-scrollbar visuals (`src/typescript/lib/core/Panel.ts`) are raw-appended the same way, lazily built only when a `Panel` actually overflows. `Panel` is a foundational class used throughout the framework (every `ScrollStrip`, every scrollable surface) and was never one of the sixteen `dispose()`-defining classes this plan's contract covers — fixing it is a materially larger, separate undertaking.
- `Border`'s resize gutters (`src/typescript/lib/layout/Border.ts:382`) are raw-appended by a *layout manager*, not a `Component` subclass at all — a different architectural layer this plan never touched. Surfaced via `VideoPlayer`, which uses `Border` as its layout manager.

Both are the same architectural gap as the `WindowBorder` leak this plan's own precedent fixed, and both are worth tracking as follow-up work (in the same vein as the already-tracked stylesheet-rule-leak and theme-listener-teardown-leak projects). The `TabBar` and `VideoPlayer` rows in `tests/component/dispose-full-teardown.test.ts`, and the `TabBar.dispose()` test in `tests/core/ComponentDispose.test.ts`, scope their "zero new keys" assertion to each component's own known subtree (via a recursive `collectIds` helper) rather than a blanket cache diff, specifically to avoid false failures from these two out-of-scope, geometry-dependent gaps.

**`TabBar.removeBarEntry` (reached from `Tab.closeEntry` when a tab closes) detaches a tab cell without disposing it — a further, separate, out-of-scope leak in the tab-*close* flow** (as opposed to the whole-bar `dispose()` flow this plan's row 8/9 cover). This is why the Text-specific dispose/theme-subscription tests (Expected Behaviour rows 10-11) were split out of `ComponentDispose.test.ts` into their own file, `tests/core/TextDispose.test.ts`: those tests call `ThemeManager.setTheme`, which synchronously fires every listener still registered in the process, and the orphaned tab cell from the row-8 test (closed mid-build, `TabBar.dispose()`/`ScrollStrip.dispose()` never gets a chance to reach it because `removeBarEntry` already detached it) left one behind that threw against a since-`DOM.reset()` handle when reached from a shared file. This mirrors the project's existing convention for this class of hazard (`feedback_viewport_listener_test_isolation`).

**Two pre-existing tests had assumptions invalidated by the fuller `dispose()` contract and needed narrow updates**, not because they were wrong about the feature they test, but because `dispose()` now does more than they assumed:

- `tests/component/display/PaginationBar.test.ts`'s dispose test resolved its label component live via `bar.getComponents()[2]` *after* `bar.dispose()`; `_components` is now empty at that point (full teardown), so the label reference is now captured once, before dispose, instead.
- `tests/component/chart/Chart.test.ts`'s "dispose releases the last repaint marks" test asserted the release count was *exactly* the mark count; `dispose()` now also releases the chart's other tracked handles via the base class, so the assertion was widened to `toBeGreaterThanOrEqual`.
