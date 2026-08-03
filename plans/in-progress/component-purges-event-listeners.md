---
depends-on:
  - dock-disposes-tab-content
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/Event.ts
  - packages/lib/src/typescript/lib/component/container/TabBar.ts
  - packages/lib/src/typescript/lib/overlay/Notification.ts
  - packages/lib/docs/concepts/component-lifecycle.md
  - packages/lib/docs/reference/changelog/0.4.1.md
---

# Disposing a Component Purges Its Event Registrations — Implementation Plan

## Overview

[`core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) keeps three module-level registration maps — `listenerMap`, `subtreeListenerMap` and `viewportListenerMap` ([Event.ts:52-54](packages/lib/src/typescript/lib/core/Event.ts#L52)) — each a `Map<eventType, Map<componentId, CompFunc>>`. A `CompFunc` holds `{ component, listeners }` ([Event.ts:14-17](packages/lib/src/typescript/lib/core/Event.ts#L14)): a **strong reference to the `Component`** plus its handler functions.

[`Component.destructor()`](packages/lib/src/typescript/lib/core/Component.ts#L753) makes no `Event` call. So a disposed component's entries stay in those maps for the life of the page, and each entry pins the component, its handlers, and everything those handlers captured. This is a memory leak, and it has two further consequences:

- **A stale viewport entry keeps firing.** `baseViewportListener` iterates a type's whole map and invokes every entry regardless of target ([Event.ts:190-208](packages/lib/src/typescript/lib/core/Event.ts#L190)). A component disposed while a viewport listener is live therefore keeps handling every `resize` / `keydown` / `mousemove` — running handler code against released handles.
- **The `Component` GC finalizer can never fire for such a component.** `_componentFinalizer` ([Component.ts:320](packages/lib/src/typescript/lib/core/Component.ts#L320)) releases a discarded component's handles and stylesheet selectors *when the instance is collected*. A live map entry holding the instance makes it permanently reachable, so that backstop is disarmed for any component that ever registered a listener.[^finalizer-disarmed]

This plan adds `Event.purgeComponent(componentId)`, called once from the top of `Component.destructor()`, and then **deletes the hand-rolled per-site unhooks the central purge makes redundant** — the ones that run at teardown time. Unhooks that fire while the component lives on (a drag ending, a public `off()`, a menu closing) are a different operation and all stay.

---

## Architecture Decisions

### `Event.purgeComponent(componentId)` — one internal namespace export, keyed by id

The purge is an `export function` inside the `Event` namespace, tagged `@internal`, taking the id string rather than the `Component`. It mirrors [`Event.reindexComponent`](packages/lib/src/typescript/lib/core/Event.ts#L442), the existing internal export `Component.setId` calls for the same reason — a cross-module call into namespace-private state.[^why-namespace-export]

### The purge covers all three id-keyed maps

`reindexComponent` deliberately skips `viewportListenerMap` because that map's key is inert for dispatch. Purging is the opposite case: the viewport map is exactly where a stale entry does live damage, because every entry fires on every event of its type. All three maps are purged.

`installedListenerTypes` and `installedListenerOpts` ([Event.ts:55-56](packages/lib/src/typescript/lib/core/Event.ts#L55)) are keyed by *event type*, not by component id, and are already cleaned by `uninstallBaseListener`. They need no purge of their own — the purge simply feeds them the same last-listener-removed accounting the `removeX` functions already perform.[^opts-map]

### The purge sits at the top of `destructor()`, beside `pendingLayouts.delete(this)`

It becomes the second line of [`Component.destructor()`](packages/lib/src/typescript/lib/core/Component.ts#L753), immediately after `pendingLayouts.delete(this)` ([Component.ts:763](packages/lib/src/typescript/lib/core/Component.ts#L763)) and before the child recursion. Both lines do the same job for the same reason: drop a module-level registration that outlives the component and would otherwise re-enter it after its handles are released.[^placement]

Descendants are not orphaned by this placement — the purge is per-id and self-only, and the child recursion reaches this same line for every descendant.

### The GC finalizer payload is left alone

`OwnedResources` ([Component.ts:315](packages/lib/src/typescript/lib/core/Component.ts#L315)) keeps carrying only `handles` and `selectors`. Adding the component id to it would be dead code: a component with a live registration is strongly reachable from the map, so it is never collected and its finalizer never runs.[^finalizer-dead-code]

### Only teardown-time unhooks are deleted

A `removeX` call is deleted when its enclosing method is a `destructor()` — the central purge now does that work. A `removeX` call that runs while the component keeps living is kept, because unhooking mid-life is a different operation with no teardown involved.

| Site | Enclosing method | Verdict |
|---|---|---|
| [`ChartLegend.ts:325`](packages/lib/src/typescript/lib/component/chart/ChartLegend.ts#L325) | `destructor()` | delete — the purge covers it |
| [`AbstractChart.ts:1079-1081`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L1079) | `destructor()` | delete |
| [`TabBar.ts:1585`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1585) | `removeBarEntry()`, which the dock plan makes dispose the button | delete |
| [`SplitGutter.ts:547-551`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L547) | `onDragStop()` | keep — the gutter lives on after the drag |
| [`Slider.ts:444`](packages/lib/src/typescript/lib/component/input/Slider.ts#L444) | `off()` | keep — the consumer is unsubscribing, not destroying |
| [`Dialog.ts:1116-1117`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1116) | `hide()` | keep — a hidden dialog can be shown again |
| [`Component.ts:3874`](packages/lib/src/typescript/lib/core/Component.ts#L3874) | `detachWheelScrolling()` | keep — fires when an axis stops being scrollable |

### `Tooltip.detach` stays where it is

[`TabBar.removeBarEntry`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1568) loses its `Event.removeSubtreeListener` line and keeps its `Tooltip.detach(entry.button)` line. `Tooltip` holds its own id-keyed `attachments` map ([Tooltip.ts:80](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L80)), which nothing in `Event` touches.[^tooltip]

### Lands after `dock-disposes-tab-content`, in the same 0.4.1 release

Two of the sites this plan deletes are created by that plan: the `entry.button.dispose()` in `TabBar.removeBarEntry` that makes the existing `contextmenu` unhook redundant, and the two `Event.removeSubtreeListener` calls it adds to `Notification.destructor()`. Deleting `TabBar`'s unhook before that plan lands would be a regression, because the cell button is not disposed today.[^order]

Both ship in **0.4.1**, alongside the shared border-measurement fix in `plans/table-scroll-forced-reflow.md`, which touches `core/Component.ts` for an unrelated reason. This plan writes a changelog line and touches no `package.json` version.

### Verification counts registrations, mirroring the rule-count harness

`Event` gains a second `@internal` export, `_registeredComponentIds()`, returning every id currently holding a registration in any of the three maps. It is the direct analogue of [`_ruleCacheKeys()`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L222), which the 0.4.0 leak work uses to assert that a disposed component leaves no stylesheet rule behind. The class-level test mirrors [`tests/component/dispose-full-teardown.test.ts`](packages/lib/tests/component/dispose-full-teardown.test.ts) row for row, swapping the rule inventory for the registration inventory.

---

## Public API

No consumer-facing API changes. Two `@internal` exports are added to the `Event` namespace, alongside the existing `reindexComponent`:

```typescript
// core/Event.ts — inside `export namespace Event`

/**
 * @internal Drops every exact-target, subtree and viewport listener
 * registration held under `componentId`, and uninstalls each window-level
 * base listener whose last registration this removed. Called from
 * `Component.destructor`. No-op for an id with no registrations.
 */
export function purgeComponent(componentId: string): void;

/** Ids currently holding any listener registration; for tests only. @internal */
export function _registeredComponentIds(): readonly string[];
```

`Component.destructor()` keeps its signature; only its body gains the purge call.

---

## Implementation

`purgeComponent` reuses the base-listener accounting the existing `removeX` functions perform, batched over the types it actually touched:

```typescript
export function purgeComponent(componentId: string): void {
    const touched = new Set<string>();

    for (const [type, typeMap] of listenerMap) {
        if (typeMap.delete(componentId)) {
            touched.add(type);

            if (typeMap.size === 0) {
                listenerMap.delete(type);
            }
        }
    }

    for (const [type, typeMap] of subtreeListenerMap) {
        if (typeMap.delete(componentId)) {
            touched.add(type);

            if (typeMap.size === 0) {
                subtreeListenerMap.delete(type);
            }
        }
    }

    // Both id-routed maps share one window-level base listener per type, so the
    // uninstall check runs once per touched type after both loops — mirroring
    // the `bothEmpty` test in removeListener / removeSubtreeListener.
    for (const type of touched) {
        if (!listenerMap.has(type) && !subtreeListenerMap.has(type) && installedListenerTypes.has(type)) {
            uninstallBaseListener(type);
        }
    }

    // The viewport map has its own base listener, installed and removed with
    // the type-map itself rather than through installedListenerTypes.
    for (const [type, typeMap] of viewportListenerMap) {
        if (!typeMap.delete(componentId) || typeMap.size > 0) {
            continue;
        }

        viewportListenerMap.delete(type);
        DOM.sink.removeListener(DOM.source.getWindow(), type, baseViewportListener, captureOpts(type));
    }
}
```

`_registeredComponentIds` collects across all three maps:

```typescript
export function _registeredComponentIds(): readonly string[] {
    const ids = new Set<string>();

    for (const map of [listenerMap, subtreeListenerMap, viewportListenerMap]) {
        for (const typeMap of map.values()) {
            // The maps are declared with `String` (object) keys throughout this
            // module while every write passes a primitive, so normalise here.
            for (const id of typeMap.keys()) {
                ids.add(String(id));
            }
        }
    }

    return Array.from(ids);
}
```

The call site, in `Component.destructor()`, directly below `pendingLayouts.delete(this)`:

```typescript
// Same reason as the line above: a module-level registration keyed by this
// component's id outlives it, and each entry holds the component itself. An
// entry left behind pins the whole instance (disarming the GC finalizer), and
// a stale viewport entry keeps firing its handler against handles released at
// the bottom of this method.
Event.purgeComponent(this.getId());
```

---

## Ordered Implementation Steps

**Tests first** — each behavioural case in `## Expected Behaviour` is written before the code that satisfies it. Step 1 adds the two `Event` exports ahead of the tests so they compile; the destructor call lands in step 4, after the tests that fail without it.

1. `packages/lib/src/typescript/lib/core/Event.ts` — add `purgeComponent` and `_registeredComponentIds` per `## Implementation`, placed after `reindexComponent` ([Event.ts:442-462](packages/lib/src/typescript/lib/core/Event.ts#L442)). Both carry the `@internal` JSDoc from `## Public API`.

2. `packages/lib/tests/unit/core/Event.test.ts` — add a `describe('Event.purgeComponent')` block covering cases **E1**–**E5**. Follow the file's existing discipline: `installTestDOM(CONFIG)` per test, `afterEach(() => DOM.reset())`, and a fresh `uniqueType()` for every test, because `Event`'s module state has no reset hook.

3. Create `packages/lib/tests/component/dispose-listener-teardown.test.ts`, beside [`tests/component/dispose-full-teardown.test.ts`](packages/lib/tests/component/dispose-full-teardown.test.ts). Copy that file's registry shape — one `REGISTRY` array of `{ name, make }` rows driven by a single `describe` / `it` loop — and its local `collectIds(component)` helper verbatim, replacing `_ruleCacheKeys()` from `~/core/StyleTarget` with `Event._registeredComponentIds()`. Drop its warm-up pass and its before/after set diff: those exist because stylesheet rules are shared process-wide, whereas a component id is unique per instance, so asserting that no snapshotted id is present is already exact. Cover rows **R1**–**R6**. These fail until step 4.

4. `packages/lib/src/typescript/lib/core/Component.ts` — add the `Event.purgeComponent(this.getId())` call and its comment to `destructor()` ([Component.ts:753](packages/lib/src/typescript/lib/core/Component.ts#L753)), immediately after `pendingLayouts.delete(this)` ([Component.ts:763](packages/lib/src/typescript/lib/core/Component.ts#L763)) and before the child-recursion loop. `Component.ts` already imports the `Event` namespace, so no import changes. Run steps 2-3's tests — all green.

5. `packages/lib/src/typescript/lib/core/Component.ts` — extend the `destructor()` and `dispose()` doc comments ([Component.ts:723-752](packages/lib/src/typescript/lib/core/Component.ts#L723)) with "unregisters every DOM listener it registered through the `Event` API" in the existing list of what teardown does. `dispose()` is public, so describe the behaviour in prose — do **not** write `{@link Event.purgeComponent}`, which would fail the zero-warning docs build for linking an `@internal` symbol.

**Delete the redundant teardown unhooks.** Each of the four classes below is left with an empty `destructor()` override once its `Event` lines go, so the whole override is removed. Every one of these files keeps other `Event.` calls, so no import is removed anywhere.

6. `packages/lib/src/typescript/lib/component/input/Link.ts` — delete the whole `destructor()` override ([Link.ts:269-274](packages/lib/src/typescript/lib/component/input/Link.ts#L269)), including its doc comment. Leave the `off()` unhook at [Link.ts:246](packages/lib/src/typescript/lib/component/input/Link.ts#L246).

7. `packages/lib/src/typescript/lib/component/container/CollapseButton.ts` — delete the whole `destructor()` override ([CollapseButton.ts:311-316](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L311)) and its doc comment.

8. `packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts` — delete the whole `destructor()` override ([MenuBarButton.ts:167-172](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts#L167)) and its doc comment.

9. `packages/lib/src/typescript/lib/component/chart/ChartLegend.ts` — delete the whole `destructor()` override ([ChartLegend.ts:324-327](packages/lib/src/typescript/lib/component/chart/ChartLegend.ts#L324)) and its doc comment, which explains the now-obsolete manual unhook.

**Trim the surviving overrides.** These three keep their `destructor()` — only the `Event` lines go.

10. `packages/lib/src/typescript/lib/component/container/MenuItem.ts` — delete the three `Event.removeListener` lines ([MenuItem.ts:442-444](packages/lib/src/typescript/lib/component/container/MenuItem.ts#L442)); keep the `_submenuTimer` clear above them.

11. `packages/lib/src/typescript/lib/component/container/SplitGutter.ts` — delete the `Event.removeListener(this, 'mousedown', this.onDragStart)` line ([SplitGutter.ts:493](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L493)); keep `this._collapseButton?.dispose()`. Leave the five viewport unhooks in `onDragStop` ([SplitGutter.ts:547-551](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L547)) untouched — a finished drag is not a teardown.

12. `packages/lib/src/typescript/lib/component/chart/AbstractChart.ts` — delete the three `Event.removeSubtreeListener` lines ([AbstractChart.ts:1079-1081](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts#L1079)); keep the store-unbind, theme-cleanup and mark-release blocks around them.

**Reconcile with the dock plan.** Both sites below exist only because that plan (already landed) added or kept them.

13. `packages/lib/src/typescript/lib/component/container/TabBar.ts` — in `removeBarEntry` ([TabBar.ts:1568](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1568)), delete the `Event.removeSubtreeListener(entry.button, "contextmenu", entry.contextMenuListener)` call and its two-line comment. The `entry.button.dispose()` that the dock plan added as the method's last statement now performs that unhook. Keep `Tooltip.detach(entry.button)`. Also update the `BarEntry.contextMenuListener` field comment ([TabBar.ts:204](packages/lib/src/typescript/lib/component/container/TabBar.ts#L204)), which says the reference is retained so `removeBarEntry` can remove it — the field is still needed to register the listener, but no longer for removal.

14. `packages/lib/src/typescript/lib/overlay/Notification.ts` — delete the two `Event.removeSubtreeListener(this, "mouseover" | "mouseout", …)` calls the dock plan added to `destructor()` ([Notification.ts:644](packages/lib/src/typescript/lib/overlay/Notification.ts#L644)), and the comment explaining them. Everything else that plan changed in the file stays.

15. Regression checkpoint. Run `grep -cn 'Event\.remove' <file>` for each file below and compare against the expected count:

    | File | Remaining `Event.remove*` lines |
    |---|---|
    | `component/input/Link.ts` | 1 (the `off()` unhook) |
    | `component/container/CollapseButton.ts` | 0 |
    | `component/menubar/MenuBarButton.ts` | 0 |
    | `component/chart/ChartLegend.ts` | 0 |
    | `component/container/MenuItem.ts` | 0 |
    | `component/chart/AbstractChart.ts` | 0 |
    | `component/container/SplitGutter.ts` | 5 (all in `onDragStop`) |
    | `component/container/TabBar.ts` | 3 (two in `installMoveTrigger`, one in `installTabDnD`) |
    | `overlay/Notification.ts` | 0 |

    And `grep -rn 'protected destructor' packages/lib/src/typescript/lib/component/input/Link.ts packages/lib/src/typescript/lib/component/container/CollapseButton.ts packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts packages/lib/src/typescript/lib/component/chart/ChartLegend.ts` — zero matches.

**Documentation.**

16. `packages/lib/docs/concepts/events.md` — under `## DOM event removal` (line 152), add a short paragraph after the code block: disposing a component drops every registration it holds through the `Event` API, so teardown needs no explicit `removeX`; `removeX` is for unhooking while the component keeps living (a finished drag, a consumer unsubscribing).

17. `packages/lib/docs/concepts/component-lifecycle.md` — in `## Disposal` (line 131), add "unregisters every DOM listener it registered through the `Event` API" to the list of what `dispose()` does in the second bullet (line 136). The dock plan also edits this section; this edit goes on top of its text, not in place of it.

18. `packages/lib/docs/reference/changelog/0.4.1.md` — the dock plan creates this page. Append one bullet under its `## Fixed` heading, in a `### Core` group: disposing a component now unregisters its DOM listeners. Previously every disposed component left its entries in the `Event` module's registration maps, which hold the component itself — so the instance and everything its handlers captured were retained for the life of the page, a component disposed with a live viewport listener kept handling `resize` / `keydown` events, and the garbage-collection backstop that releases a discarded component's handles and stylesheet rules could never run for it. No consumer action is needed and no migration entry is added: the change removes retained state and makes no signature or contract change.

19. Run the full `## Verification` list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Event.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Link.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/CollapseButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/MenuItem.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/SplitGutter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/chart/ChartLegend.ts` |
| Modify | `packages/lib/src/typescript/lib/component/chart/AbstractChart.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Notification.ts` |
| Create | `packages/lib/tests/component/dispose-listener-teardown.test.ts` |
| Modify | `packages/lib/tests/unit/core/Event.test.ts` |
| Modify | `packages/lib/docs/concepts/events.md` |
| Modify | `packages/lib/docs/concepts/component-lifecycle.md` |
| Modify | `packages/lib/docs/reference/changelog/0.4.1.md` |

---

## Expected Behaviour

The **E** and **R** cases below are unit-testable under the offline harness; the manual checks are called out separately at the end. `Event`'s modelled dispatch has no live DOM tree, so the automated cases assert the **bookkeeping** contract — which registrations exist and which base listeners are installed — exactly as the existing `Event` tests do.

**`Event` mechanics — `packages/lib/tests/unit/core/Event.test.ts`**

- **E1 — the purge clears all three maps for one id.** Register an exact-target, a subtree and a viewport listener on the same component, each with its own `uniqueType()`. `Event._registeredComponentIds()` contains the component's id. After `Event.purgeComponent(comp.getId())`, it does not.
- **E2 — the purge uninstalls a base listener whose last registration it removed.** One component holds the only listener of a type. After the purge, the recording sink shows one `removeListener` write for that type. Assert the same for a second component holding the only *viewport* listener of its own type — the viewport map carries its own window-level handler.
- **E3 — a sibling's registrations for the same type survive.** Components `a` and `b` both register for one type. After purging `a`, `_registeredComponentIds()` still contains `b`'s id and the sink shows **no** `removeListener` write for that type.
- **E4 — purging an id with no registrations is a no-op.** `Event.purgeComponent(new Component({}).getId())` produces no sink writes and does not throw.
- **E5 — `dispose()` drives the purge; `removeComponent` does not.** Register a subtree listener on a child, add it to a container, then `container.removeComponent(child)` — the child's id is still in `_registeredComponentIds()`, and re-adding it to another container leaves the registration intact. Calling `child.dispose()` afterwards removes it. This is the move-vs-discard rule: `removeComponent` only detaches.

**Class registry — `packages/lib/tests/component/dispose-listener-teardown.test.ts`**

Each row constructs the component, snapshots `collectIds(component)`, calls `dispose()`, and asserts that no snapshotted id appears in `Event._registeredComponentIds()`. Every listed class registers its listeners in its constructor, so no render or layout pass is needed.

- **R1 — `Link`**, `new Link('x')` (registers `keydown`).
- **R2 — `MenuItem`**, `new MenuItem({ text: 'A' }, () => {}, () => {})` (registers `mouseover` / `mouseout` / `click`).
- **R3 — `MenuBarButton`**, `new MenuBarButton('File', () => {}, () => {})` (registers `click` / `mouseover`).
- **R4 — `CollapseButton`**, `new CollapseButton()` (registers `dblclick` / `mousedown`).
- **R5 — `ChartLegend`**, `new ChartLegend()` (registers a `click` subtree listener).
- **R6 — `AbstractChart` via `LineChart`**, `new LineChart({})` (registers `mousemove` / `mouseout` / `click` subtree listeners).

**Manual verification** (the offline harness models no live event tree):

- In the demo app, open and close a `Dock` panel several times, then confirm the surviving panels still respond to hover, click and context-menu — the purge must remove only the closed panel's registrations.
- Tear a tab off into a float window and drag it back onto a strip: the new strip cell's context menu still opens, confirming `removeBarEntry`'s dropped unhook did not take a live registration with it.
- Open a chart, dispose its containing panel, then resize the window and press keys: no console error from a handler running against a released handle.

---

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run test` — full suite green. Pay particular attention to `tests/unit/core/Event.test.ts`, `tests/component/dispose-full-teardown.test.ts`, `tests/core/ComponentDispose.test.ts`, `tests/component/input/Link.test.ts`, `tests/component/MenuButton.test.ts`, `tests/component/chart/Chart.test.ts` and any `TabBar` or drag test — the purge is now on all of their teardown paths.
- `grep -rn 'Event.purgeComponent' packages/lib/src/typescript/lib` — exactly one hit, in `core/Component.ts`.
- The step 15 per-file table, verbatim.
- `npm run docs:api` — must finish with **zero** warnings; the two new `Event` exports are `@internal` and must not be `{@link}`ed from any public JSDoc.
- `npm run build:lib` — succeeds.
- Manual: run the demo app and exercise the three manual cases in `## Expected Behaviour`.

---

## Documentation Impact

No public API changes: both new `Event` exports are `@internal`, so TypeDoc excludes them and no API page gains an entry. Two concept pages are updated: `concepts/events.md` presents `removeX` as the only way a registration goes away, and `concepts/component-lifecycle.md`'s list of what `dispose()` does never mentions listeners. `packages/lib/llms.txt` is a capability index keyed by component and needs no edit.

`packages/lib/docs/reference/changelog/0.4.1.md` gains one `## Fixed` → `### Core` bullet (step 18). `packages/lib/docs/reference/migration.md` is **not** touched: the project's compatibility policy asks a breaking change for a migration entry, and this change breaks nothing — it removes retained state and alters no signature or contract. The dock plan's migration work on that page stands alone.

---

## Potential Challenges

- **A consumer that disposes a component and keeps using it.** Its listeners are now gone as well as its handles and rules — but a disposed component was already unusable, so nothing that worked before stops working. Mitigation: case **E5** pins that the re-parent path (`removeComponent`) is untouched, which is the only supported way to keep a component alive after taking it out of a tree.
- **Two live components sharing an id.** `getId()` is a random UUID ([`Util.generateUUID`](packages/lib/src/typescript/lib/core/Util.ts#L355)) and ids are never recycled, but `setId` lets a consumer assign any string. Two components under one id would have the purge of either drop both. Mitigation: none needed — an id collision already merges the two components' listeners into a single `CompFunc` bound to whichever registered first, so the registration path is broken well before the purge is reached. This is the same collision policy `reindexComponent` settled.
- **Deleting four `destructor()` overrides changes a hand-maintained count.** The header comment in `tests/component/dispose-full-teardown.test.ts` quotes a `protected destructor(` grep count that is already stale (it says 20; the tree currently has 34). Mitigation: leave it — the registry's rows all still pass, and correcting a pre-existing stale comment is not this plan's work.
- **The purge runs inside an event dispatch when a handler disposes its own component.** `baseListener` iterates a `CompFunc`'s `listeners` array it already holds a reference to, and the purge deletes whole map entries rather than splicing that array, so the in-flight iteration completes normally.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) — `CompFunc` (14), the three maps (52-54), `installedListenerTypes` / `installedListenerOpts` (55-56), `captureOpts` (60), `uninstallBaseListener` (121), `baseViewportListener` (190), `removeListener` (312), `removeSubtreeListener` (401), `reindexComponent` (442), `removeViewportListener` (520).
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `OwnedResources` (315), `_componentFinalizer` (320), `dispose` (736), `destructor` (753), `trackHandle` (865), `setId` (1570), `detachWheelScrolling` (3874), `removeComponent` (5025).
- [`packages/lib/src/typescript/lib/core/StyleTarget.ts:217-224`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L217) — `_ruleCacheHas` / `_ruleCacheKeys`, the `@internal` test-accessor shape `_registeredComponentIds` copies.
- [`packages/lib/tests/component/dispose-full-teardown.test.ts`](packages/lib/tests/component/dispose-full-teardown.test.ts) — the class registry and `collectIds` helper the new test file mirrors.
- [`packages/lib/tests/unit/core/Event.test.ts`](packages/lib/tests/unit/core/Event.test.ts) — the `uniqueType()` / `countWrites()` harness the mechanics tests extend.
- `plans/implemented/setid-reindex-event-listeners.md` — establishes the `@internal` namespace export called from `Component`, and the id-collision policy.
- `plans/implemented/component-style-rule-disposal.md` and `plans/implemented/component-teardown-seam.md` — the teardown contract and the dual eager/finalizer disposal design this plan extends.
- `plans/dock-disposes-tab-content.md` — must land first; adds the `TabBar` button disposal and the `Notification` unhooks this plan reconciles.

---

## Non-Goals

- **Making `CompFunc` hold a `WeakRef` to its component.** Weakening the reference would let a forgotten registration be collected instead of purged, which hides the defect rather than fixing it and gives dispatch a nullable component. Fixing teardown at its source is the smaller and more direct change.
- **Purging `Tooltip.attachments`.** `Tooltip` keeps its own id-keyed module map of attachments whose closures capture the component, so it has a leak of the same shape. Fixing it belongs with `Tooltip` — `core/Component.ts` cannot import `overlay/Tooltip.ts`, and the explicit `Tooltip.detach` calls at the sites that need it stay.
- **Deleting mid-life `removeX` calls.** Only teardown-time unhooks are redundant. Every `off()`, `hide()`, `close()`, `detach*()` and drag-end unhook is kept; the table in `## Architecture Decisions` is the full ruling.
- **Adding a reset hook to `Event`'s module state for tests.** The existing `Event` tests handle isolation with a unique event type per test, and the new tests follow that. A reset hook is a separate change with its own harness implications.

---

## Notes

[^finalizer-disarmed]: This also explains a symptom the dock plan measured but could not account for. That plan's `gc-backstop` footnote records four open/close cycles growing the shared stylesheet perfectly linearly while live component and DOM-node counts returned to baseline — the selector-releasing finalizer demonstrably never fired. A table cell, a header and a row each register `Event` listeners, so every one of them was held by a map entry and was never a candidate for collection. Fixing the purge restores the backstop for anything disposed through `destructor()`, but the backstop's own timing is still unguaranteed, which is why eager teardown remains the path that matters.

[^order]: The reverse order was considered and rejected. Landing this plan first would leave the dock plan adding two `Notification` unhooks that are dead on arrival, and would leave `TabBar.removeBarEntry` in a genuinely broken state in between: `removeBarEntry` today calls `_buttonGroup.removeButton`, `_rovingTabIndex.remove` and `_tabClip.removeItem` on the cell button, none of which destroys it — `ScrollStrip.removeItem` delegates to `removeComponent`, which only detaches — so the button's registration would survive with no unhook and no dispose to reach it. The dock plan's `entry.button.dispose()` is what closes that gap.

[^why-namespace-export]: `Event` is a `namespace` and `Component.ts` is a separate module, so a cross-module call requires an `export function` inside the namespace — TypeScript has no module-internal-but-cross-module visibility for namespace members. `@internal` keeps it off the rendered API surface, since TypeDoc excludes `@internal` members. `reindexComponent` was added under exactly this reasoning and is the pattern followed here. Taking the id string rather than the `Component` follows the same precedent and makes it plain the function neither reads nor retains the instance.

[^opts-map]: Checked rather than assumed: `installedListenerOpts` is `Map<string, AddEventListenerOptions>` keyed by event type, written in `installBaseListener` and deleted in `uninstallBaseListener`, both keyed by type. It is bounded by the number of distinct DOM event types the library uses and holds no component reference, so it is not a leak surface at all. The same holds for `installedListenerTypes`.

[^placement]: Three placements were considered against the ordering constraints. Purging **after** the handle-release block at the bottom would leave a window inside `destructor()` where a viewport listener could still fire and write through a released handle — the exact hazard `pendingLayouts.delete(this)` exists to close, and the reason that line sits first. Purging **between** the child recursion and the element removal buys nothing and separates two lines that do the same job. Purging **first** has no cost: the id is stable for the whole method (nothing in `destructor()` calls `setId`), the maps are keyed by that id alone, and every descendant reaches this same first line through the recursion, so no entry is orphaned.

[^finalizer-dead-code]: The finalizer's held value must not strongly reference the `Component`, and an id string satisfies that — so the idea is well-formed and still wrong. `CompFunc.component` is a strong reference from a module-level `Map`, which is a GC root: while any registration for a component exists, the instance is reachable and the registry will never enqueue its callback. The finalizer could therefore only purge components that have nothing to purge. The reverse dependency is the useful one and is what this plan delivers: purging eagerly is what makes a discarded component collectable at all, which is what lets the existing handle/selector finalizer do its job.

[^tooltip]: `Tooltip.attach(component, …)` writes a `TooltipAttachment` into a static `Map<string, TooltipAttachment>` keyed by the component's id, holding four handler closures that capture the component, *and* registers those four handlers through `Event.addListener`. `Tooltip.detach` undoes both halves. The purge only reaches the `Event` half, so dropping the `Tooltip.detach` call in `removeBarEntry` would trade one leak for another. It stays, and the `Tooltip`-side gap is named as a non-goal.
