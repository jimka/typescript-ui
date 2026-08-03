---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/component/chart/ChartLegend.ts
  - packages/lib/src/typescript/lib/overlay/Menu.ts
  - packages/lib/src/typescript/lib/component/menubar/MenuBar.ts
  - packages/lib/src/typescript/lib/layout/LayoutSerialization.ts
  - packages/lib/docs/concepts/component-lifecycle.md
  - packages/lib/docs/layouts/LayoutSerialization.md
---

# `Component.disposeAllComponents()` — Implementation Plan

## Overview

`Component.removeComponent()` / `removeAllComponents()` are detach-only by design: they never call `dispose()` on the children they remove, because [`addComponent`'s re-parent path](../packages/lib/src/typescript/lib/core/Component.ts#L5007) — `moveComponent`, reached from tab drag-reorder, tear-off windows, and `Button._rebuildContentRow`'s topology rebuilds — depends on the removed child staying alive so it can be carried into a new parent.[^reparent-evidence]

A caller that means to *discard* removed children instead of re-parenting them currently has to remember to loop `.dispose()` over `getComponents()` before calling `removeAllComponents()`. This plan adds `Component.disposeAllComponents()` — dispose every current child, then remove them all — as the single safe call for the discarding case, placed next to `removeAllComponents()` in [`Component.ts`](../packages/lib/src/typescript/lib/core/Component.ts#L5047), then applies it at every library call site that needs it: the one clean precedent found during the original survey ([`MenuBar.setMenus`](../packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L145)), plus six call sites the same survey found leaking a discarded child's per-instance stylesheet rule (and any theme/listener subscriptions) on every rebuild:

| Site | What leaked each rebuild |
|---|---|
| [`ChartLegend.setEntries`](../packages/lib/src/typescript/lib/component/chart/ChartLegend.ts#L174) | Old `_rows` (`Panel` + swatch `Component` + `Text` per row) |
| [`PickerColumn.clearCells`](../packages/lib/src/typescript/lib/component/input/PickerColumn.ts#L326), called from `AbstractCalendarDropdown.buildYearScroller` | Old year `PickerCell`s |
| [`AbstractCalendarDropdown.buildDayGrid`](../packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L702) | Old day cells (`PickerDay` / `PickerBlankCell`), rebuilt on every month navigation |
| [`TableHeader.rebuildParentCells`](../packages/lib/src/typescript/lib/component/table/Header.ts#L626) | Old `ParentHeaderCell`s |
| [`Menu.showAnchored`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L286) | `MenuSeparator` instances specifically — the dispose loop filtered `item instanceof MenuItem`, so a reshow of any menu with separator items leaked one `MenuSeparator` per separator, forever |
| [`LayoutSerialization.restoreLayout`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L574) | The interior `Split`/`Tab` scaffold under `root` |

Five of these six are mechanical swaps: the container being cleared has exactly one writer (verified per site below), so `removeAllComponents()` is always clearing children that are about to be discarded, never ones a caller expects back. `LayoutSerialization.restoreLayout` is not — a straight swap would dispose a live component a `Dock` still owns, because of an invariant the original survey assumed but did not verify. That site gets a companion fix, not just a swap; see its own step and `## Addendum` below.

Investigating these sites turned up five other in-flight plans (worktrees already exist for them) that touch the same files: `component-purges-event-listeners` (`ChartLegend.ts`, `Component.ts`), `table-tab-close-residual-leak` (`Menu.ts`, `MenuBar.ts`), `dock-disposes-tab-content` (`LayoutSerialization.ts` and its doc page), and `table-scroll-forced-reflow` / `table-scroll-recycling-cost` (`Component.ts`). None edits the same methods this plan touches, but `dock-disposes-tab-content`'s own reasoning depends on the exact line this plan changes in `LayoutSerialization.ts` — see that plan's `[^restore-fix]` footnote and this plan's `## Addendum` below. The `touches-shared` list above reflects every file in common; `/implement`'s ordering rules apply if any of these land concurrently.

---

## Architecture Decisions

### Unconditional, no predicate

`disposeAllComponents()` takes no filter argument; it disposes every current child. Every call site that reaches it — `MenuBar.setMenus`, the five straightforward fixes below, and `Menu`'s two call sites — clears its container wholesale. `LayoutSerialization.restoreLayout` needs a preparatory step before the container it clears is safe to hand to an unconditional `disposeAllComponents()` (see that site's own decision below), but the call itself, once made, is still unconditional. No surveyed site wants "dispose some, keep others," so per this project's no-speculative-API-surface convention the method stays all-or-nothing.[^no-filter-search]

### Placement and cross-referencing

`disposeAllComponents()` is added immediately after `removeAllComponents()` in `Component.ts` (before `sortComponents()`), mirroring the existing adjacency of `removeComponent` / `removeAllComponents`. Both existing methods' doc comments gain a cross-reference to the new one, and the new method's doc comment explains why it exists relative to `removeAllComponents`, so a reader landing on any of the three finds the others.

### Five sites are mechanical swaps; each is verified single-writer first

`ChartLegend.setEntries`, `PickerColumn.clearCells`, `AbstractCalendarDropdown.buildDayGrid`, and `TableHeader.rebuildParentCells` each clear a container that has exactly one code path adding to it — the same rebuild method the clear sits in. `Menu.showAnchored`'s clear is one writer too, once its filtered dispose loop (see below) is replaced. For each, `container.getComponents()` at the point of the clear is always exactly what that container's own last rebuild put there, mirroring the evidence already gathered for `MenuBar.setMenus`.[^menubar-buttons-evidence] The per-site evidence is in each site's own implementation step, not repeated here.

`PickerColumn.clearCells` has exactly one caller (`AbstractCalendarDropdown.buildYearScroller`), so the fix lands inside `clearCells` itself rather than at the call site — any future caller inherits the correct behavior for free.[^pickercolumn-single-caller]

### `Menu`'s two call sites both migrate, for different reasons

The original draft of this plan left `Menu.showAnchored` and `Menu.rebuildPersistentItems` untouched, reasoning that swapping either to the unconditional `disposeAllComponents()` would silently start disposing `MenuSeparator` instances too — "a real behavior change dressed as a mechanical refactor." That reasoning is reversed here: disposing every child unconditionally, separators included, is the *correct* fix for `showAnchored`'s `MenuSeparator` leak, not an accidental side effect to avoid. A `MenuSeparator` is constructed fresh on every `showAnchored` call (`new MenuSeparator("context-menu")`) and materializes its own per-instance CSS rule the same way every other rebuilt child in this plan does; nothing else in the library holds a `MenuSeparator` by identity across a reshow, so there is no survival requirement being broken.[^menuseparator-fresh]

`rebuildPersistentItems` filters the same way but does not have the same bug: persistent-mode items are always constructed as `new MenuItem(config, ...)`, never `new MenuSeparator(...)` — a persistent-mode "separator" is a `MenuItem` built with `config.separator: true`, which renders as a thin rule internally (see `MenuItem.isSeparator()`). So `_menuItems` in persistent mode never contains anything but `MenuItem`, and the `instanceof MenuItem` filter there is always true — dead code, not a bug. It is migrated anyway, for the same reason `Menu`'s own `destructor()` already dropped an equivalent dead `instanceof`-guarded loop: once a guard is proven unreachable, removing it is a simplification, not a behavior change.[^rebuildpersistent-dead-guard] Both migrations land in the same implementation step, since they are the same file and the same shape of change.

### `LayoutSerialization.restoreLayout` needs a companion fix, not just a swap

The original survey that flagged this site assumed that by the time `root.removeAllComponents()` runs, every remaining descendant of `root` is disposable scaffold — because `parkLeaves` already detaches every leaf individually first. That assumption holds for leaves, but not for `transient` children: a `transient` child (the only shipping example is `Dock`'s empty-state placeholder, set once via `Dock.setEmptyContent` and reused indefinitely across every empty/non-empty transition) is excluded from `collectLeaves`'s walk entirely, so `parkLeaves` never detaches it — it is still nested under `root` when the scaffold-clearing line runs. A straight swap to `root.disposeAllComponents()` would destroy that live, externally-owned singleton the first time a caller restores a saved layout while its `Dock` is empty.[^dock-placeholder-evidence]

The fix is to make `collectLeaves` also detach (never dispose) any `transient` child it finds, alongside its existing leaf-collection walk, before `restoreLayout`'s scaffold-clearing line runs. Once every leaf is parked and every transient child is detached, what remains under `root` really is disposable scaffold — including a leaf a misbehaving factory declined to vouch for, which is now disposed instead of silently orphaned. See `## Addendum` for the full evidence trail and `## Ordered Implementation Steps` for the exact diff.

---

## Public API

```typescript
class Component {
    /**
     * Disposes every current child, then removes them all.
     *
     * @returns This component, for method chaining.
     */
    disposeAllComponents(): this;
}
```

No other exported signature changes anywhere in this plan. Every fixed call site keeps its existing public signature (`setEntries`, `clearCells`, `buildDayGrid`, `rebuildParentCells`, `showAnchored`, `restoreLayout`) — only their internal teardown call changes.

---

## Implementation

Insert directly after `removeAllComponents()` (currently `Component.ts:5047-5055`), before `sortComponents()`:

```typescript
/**
 * Disposes every current child, then removes them all.
 *
 * The discarding counterpart to {@link removeAllComponents}: that method
 * only detaches children (a re-parenting move, e.g. through
 * {@link moveComponent}, depends on the detached child staying alive), so a
 * caller that means to throw the children away instead has to loop
 * `.dispose()` over {@link getComponents} itself before calling it —
 * forgotten, that loop leaks each child's per-instance stylesheet rule and
 * any theme/listener subscriptions on every rebuild. Use this whenever a
 * rebuild's old children are not going to be reused.
 *
 * @returns This component, for method chaining.
 */
disposeAllComponents(): this {
    for (const component of this._components) {
        component.dispose();
    }

    return this.removeAllComponents();
}
```

Iterates `this._components` directly (not a copy) — `component.dispose()` recurses into the *child's own* `_components` (its grandchildren), never reaching back into this container's `_components` array, so nothing shifts under the loop. The parent-side removal only happens afterward, in the `removeAllComponents()` call. This mirrors `removeAllComponents()`'s own direct-field-access style immediately above it.

---

## Ordered Implementation Steps

1. **Add `disposeAllComponents()`** to [`Component.ts`](../packages/lib/src/typescript/lib/core/Component.ts#L5047), exactly as shown in `## Implementation`, directly after `removeAllComponents()`.

2. **Cross-reference the doc comments.** Add one `@remarks` line to `removeComponent`'s existing doc comment (`Component.ts:5018-5024`):
   `@remarks Detach-only — does not call {@link Component.dispose}. To discard every child at once instead of re-parenting them, use {@link disposeAllComponents}.`
   Add one `@remarks` line to `removeAllComponents`'s existing doc comment (`Component.ts:5042-5046`):
   `@remarks Detach-only, like {@link removeComponent} — none of the removed children are disposed, so a re-parenting caller keeps them alive. To discard the children instead, use {@link disposeAllComponents}.`

3. **Migrate `MenuBar.setMenus`** ([`MenuBar.ts:145-161`](../packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L145)). Before:
   ```typescript
   for (const panel of this._panels) {
       panel.dispose();
   }

   for (const button of this._buttons) {
       button.dispose();
   }

   this._buttons.length = 0;
   this._panels.length = 0;

   this.removeAllComponents();
   ```
   After:
   ```typescript
   for (const panel of this._panels) {
       panel.dispose();
   }

   this._buttons.length = 0;
   this._panels.length = 0;

   this.disposeAllComponents();
   ```
   `_panels` (the `Menu` overlays) are never registered via `addComponent` — only `_buttons` are (`MenuBar.ts:188`) — so `_panels` keeps its own manual dispose loop; only the `_buttons` loop + trailing `removeAllComponents()` collapses into `disposeAllComponents()`.

4. **Update the lifecycle doc.** In [`packages/lib/docs/concepts/component-lifecycle.md`](../packages/lib/docs/concepts/component-lifecycle.md#L138), append one sentence to the end of the "Disposal" section's closing paragraph (after "…nothing does that step for you."):
   `Discarding every child at once (a rebuild, not a re-parent) is what \`disposeAllComponents()\` is for — it disposes each one first.`

5. **Migrate `ChartLegend.setEntries`** ([`ChartLegend.ts:174`](../packages/lib/src/typescript/lib/component/chart/ChartLegend.ts#L174)). Before:
   ```typescript
   this.removeAllComponents();
   this._rows = [];
   ```
   After:
   ```typescript
   this.disposeAllComponents();
   this._rows = [];
   ```
   `ChartLegend` has exactly one `addComponent` call site (`ChartLegend.ts:181`, inside this same method's rebuild loop), so `this.getComponents()` here is always exactly the previous call's `_rows`.[^chartlegend-single-writer]

6. **Migrate `PickerColumn.clearCells`** ([`PickerColumn.ts:325-329`](../packages/lib/src/typescript/lib/component/input/PickerColumn.ts#L325)). Before:
   ```typescript
   clearCells(): this {
       this._cellList.removeAllComponents();

       return this;
   }
   ```
   After:
   ```typescript
   clearCells(): this {
       this._cellList.disposeAllComponents();

       return this;
   }
   ```

7. **Migrate `AbstractCalendarDropdown.buildDayGrid`** ([`AbstractCalendarDropdown.ts:701-702`](../packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts#L701)). Before:
   ```typescript
   protected buildDayGrid(): void {
       this._dayGrid.removeAllComponents();
   ```
   After:
   ```typescript
   protected buildDayGrid(): void {
       this._dayGrid.disposeAllComponents();
   ```
   `_dayGrid` is only ever populated inside this method (`AbstractCalendarDropdown.ts:717, 732, 739`); the swap-in/out of `_dayGrid` itself against `_root` when the year scroller opens (`removeComponent`/`insertComponent`, `AbstractCalendarDropdown.ts:929-930, 951`) is unrelated — that is `_root` re-arranging its one persistent `_dayGrid` container, not the day cells inside it.

8. **Migrate `TableHeader.rebuildParentCells`** ([`Header.ts:623-626`](../packages/lib/src/typescript/lib/component/table/Header.ts#L623)). Before:
   ```typescript
   private rebuildParentCells(): void {
       const row = this.getParentRow();

       row.removeAllComponents();
   ```
   After:
   ```typescript
   private rebuildParentCells(): void {
       const row = this.getParentRow();

       row.disposeAllComponents();
   ```
   `getParentRow()` returns a fixed structural slot (`getComponents()[0]`), and its only writer is this method's `flush` closure (`Header.ts:662`, `row.addComponent(cell, ...)`), so the same single-writer argument applies.[^parentrow-single-writer]

9. **Migrate both `Menu.ts` call sites.** ([`Menu.ts:275-286`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L275) and [`Menu.ts:895-908`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L895).) `showAnchored` before:
   ```typescript
   for (const item of this._menuItems) {
       if (item instanceof MenuItem) {
           item.dispose();
       }
   }

   this._menuItems = [];
   this.removeAllComponents();
   ```
   After:
   ```typescript
   this._menuItems = [];
   this.disposeAllComponents();
   ```
   `rebuildPersistentItems` before:
   ```typescript
   private rebuildPersistentItems(configs: MenuItemConfig[]): void {
       this.closeOpenSubmenu();

       for (const item of this._menuItems) {
           if (item instanceof MenuItem) {
               item.dispose();
           }
       }

       this._menuItems = [];
       this._focusedIndex = -1;
       this.removeAllComponents();

       this.buildPersistentItems(configs);
   }
   ```
   After:
   ```typescript
   private rebuildPersistentItems(configs: MenuItemConfig[]): void {
       this.closeOpenSubmenu();

       this._menuItems = [];
       this._focusedIndex = -1;
       this.disposeAllComponents();

       this.buildPersistentItems(configs);
   }
   ```
   Both sites have exactly one `addComponent` call site each (`Menu.ts:303` and `Menu.ts:926` respectively — the only two `addComponent` calls anywhere in the file), so `this.getComponents()` at each clear is always exactly that mode's previous `_menuItems`.

10. **Fix `LayoutSerialization.ts`: detach transient chrome before the scaffold-disposal sweep.** Three edits in one file:

    a. `collectLeaves` ([`LayoutSerialization.ts:300-310`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L300)). Before:
    ```typescript
    function collectLeaves(component: Component, into: Component[]): void {
        serializableChildren(component).forEach(child => {
            const kind = managerKind(child);

            if (kind === "Split" || kind === "Tab") {
                collectLeaves(child, into);
            } else {
                into.push(child);
            }
        });
    }
    ```
    After:
    ```typescript
    function collectLeaves(component: Component, into: Component[]): void {
        component.getComponents().forEach(child => {
            if (component.getLayoutConstraints(child)?.transient === true) {
                // Transient chrome (e.g. a Dock empty-state placeholder) is never
                // captured in `state` and not owned by this module — detach it now,
                // before restoreLayout's scaffold-disposal sweep, so that sweep
                // cannot reach and dispose it. Its owner re-mounts the same
                // instance on its own next sweep (see Dock.showEmptyState).
                component.removeComponent(child);

                return;
            }

            const kind = managerKind(child);

            if (kind === "Split" || kind === "Tab") {
                collectLeaves(child, into);
            } else {
                into.push(child);
            }
        });
    }
    ```
    Also update `collectLeaves`'s doc comment (`LayoutSerialization.ts:290-299`) to add, after the existing paragraph: `Also detaches (but does not dispose) every transient child it finds along the way — chrome like a Dock empty-state placeholder, excluded from state so it has no slot to be re-homed into.`

    b. `parkLeaves`'s doc comment (`LayoutSerialization.ts:312-323`): append one sentence after "Parked leaves are **not** destroyed — they carry panel state.": `Transient children are also detached along the way (see collectLeaves) so the caller's teardown sweep cannot reach them either.`

    c. `restoreLayout` ([`LayoutSerialization.ts:573-574`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts#L573)). Before:
    ```typescript
    liveWindows.forEach(win => win.onExitAction());
    root.removeAllComponents();
    ```
    After:
    ```typescript
    liveWindows.forEach(win => win.onExitAction());
    root.disposeAllComponents();
    ```
    Update `restoreLayout`'s `@remarks` (`LayoutSerialization.ts:546-553`): change "it parks every factory-known leaf (detaching but never destroying them, so their state survives), tears down all `Split`/`Tab` containers under `root` and closes all open windows" to "it parks every factory-known leaf and detaches any transient chrome (so both survive undisposed), disposes whatever scaffold remains under `root`, and closes all open windows".

    d. Update [`packages/lib/docs/layouts/LayoutSerialization.md`](../packages/lib/docs/layouts/LayoutSerialization.md#L59)'s "How restore works" numbered list: step 1 ("Park every factory-known leaf…") gains ", and detach any transient chrome (e.g. a Dock empty-state placeholder) the same way"; step 2 ("Tear down all Split/Tab containers under root…") changes "Tear down" to "Dispose" and drops "These are cheap, stateless arrangement managers" (no longer merely detached, so the "cheap to leak" framing no longer applies — they are actively reclaimed now).

    This is the one site in this plan where the fix is not a one-line swap; `## Architecture Decisions` and `## Addendum` explain why.

11. **Add tests** per `## Expected Behaviour` below:
    - `packages/lib/tests/component/Component.test.ts` — five cases in the existing `'Component child lifecycle — wiring & teardown'` block (`Component.test.ts:264-361`), one in the existing `'Component — destructor disposes style rules'` block (`Component.test.ts:368-396`).
    - `packages/lib/tests/component/chart/ChartLegend.test.ts` — one new `describe` block with its own `installTestDOM`/`DOM.reset` hooks (the file has none today), mirroring `Component.test.ts`'s isolated-hooks style for its style-rule block. Add `installTestDOM` (from `../../dom/TestDOM`), `fontMetrics`, `DOM` (from `~/core/DOM`), and `_ruleCacheKeys` (from `~/core/StyleTarget`) to the file's imports — none are imported there today.
    - `packages/lib/tests/component/input/PickerColumn.test.ts` — one new `describe` block, again with its own DOM hooks (the file has none today). Same four new imports as above.
    - `packages/lib/tests/component/input/DatePickerDropdown.test.ts` — **new file**; no test file exists today for `AbstractCalendarDropdown` or either of its concrete subclasses. Mirror `TimePickerDropdown.test.ts`'s setup (`installTestDOM` in `beforeEach`, `DOM.reset` in `afterEach`, an `any`-cast helper to reach the protected members under test) and its imports, plus `_ruleCacheKeys` from `~/core/StyleTarget`.
    - `packages/lib/tests/component/table/Header.disposal.test.ts` — **new file**, named to match the sibling `HeaderCell.disposal.test.ts` in the same directory (which already covers a different disposal gap on the same table). Build a grouped-column `Table` the way `HeaderColumnWindow.test.ts` does, and drive the rebuild through `TableHeader.setHiddenColumns`, which calls `rebuildParentCells` unconditionally. Mirror `HeaderCell.disposal.test.ts`'s imports (`Table`, `MemoryStore`, `Model`, `_ruleCacheKeys`, plus `installTestDOM`/`DOM`/`fontMetrics`).
    - `packages/lib/tests/overlay/Menu.test.ts` — two new cases in a new `describe` block. Add `_ruleCacheKeys` (from `~/core/StyleTarget`) and `installTestDOM` (already imported) to cover the new style-rule assertions; wrap the new block in its own `installTestDOM(CONFIG)` / `afterEach(() => DOM.reset())` since the file installs the DOM per-test rather than in a shared `beforeEach`.
    - `packages/lib/tests/component/layout/LayoutSerialization.test.ts` — one new case, plus one new assertion added to the existing `'skips a leaf whose factory returns null, warns, and re-aligns survivors'` case (`LayoutSerialization.test.ts:150-179`). Add `_ruleCacheKeys` (from `~/core/StyleTarget`) and `LayoutConstraints` (already imported) to the file's imports.

12. **Regression checks**:
    - `grep -n "removeAllComponents" packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` — expect exactly one match, inside `disposeAllComponents()`'s own definition being called (no bare `this.removeAllComponents()` left in `setMenus`).
    - `grep -n "removeAllComponents" packages/lib/src/typescript/lib/component/chart/ChartLegend.ts packages/lib/src/typescript/lib/component/input/PickerColumn.ts packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts packages/lib/src/typescript/lib/component/table/Header.ts packages/lib/src/typescript/lib/overlay/Menu.ts` — expect zero matches (all six call sites now use `disposeAllComponents`).
    - `grep -n "instanceof MenuItem" packages/lib/src/typescript/lib/overlay/Menu.ts` — expect exactly one match, inside `layOutColumns` (the width-measurement filter, untouched — it excludes separators from column measurement, an unrelated concern from disposal).
    - `grep -n "root.removeAllComponents\|root.disposeAllComponents" packages/lib/src/typescript/lib/layout/LayoutSerialization.ts` — expect one match, `root.disposeAllComponents()`.

13. Run `npm run typecheck`, `npm run lint`, `npm run test -- Component MenuBar ChartLegend PickerColumn DatePickerDropdown LayoutSerialization`, `npm run test -- packages/lib/tests/component/table/Header.disposal.test.ts`, `npm run test -- packages/lib/tests/overlay/Menu.test.ts`, and `npm run docs:api` (zero warnings) per `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/chart/ChartLegend.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/PickerColumn.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/LayoutSerialization.ts` |
| Modify | `packages/lib/docs/concepts/component-lifecycle.md` |
| Modify | `packages/lib/docs/layouts/LayoutSerialization.md` |
| Modify | `packages/lib/tests/component/Component.test.ts` |
| Modify | `packages/lib/tests/component/chart/ChartLegend.test.ts` |
| Modify | `packages/lib/tests/component/input/PickerColumn.test.ts` |
| Create | `packages/lib/tests/component/input/DatePickerDropdown.test.ts` |
| Create | `packages/lib/tests/component/table/Header.disposal.test.ts` |
| Modify | `packages/lib/tests/overlay/Menu.test.ts` |
| Modify | `packages/lib/tests/component/layout/LayoutSerialization.test.ts` |

---

## Expected Behaviour

### `Component.disposeAllComponents()`

| # | Case | Behaviour | Test type |
|---|---|---|---|
| 1 | Parent with children `[a, b]`, no options | `a.dispose()` then `b.dispose()` run, in `getComponents()` order, before the array clears | Unit |
| 2 | Same, after the call | `parent.getComponents()` returns `[]` | Unit |
| 3 | Same, after the call | Each of `a`, `b`: `getParentComponent()` is `null`, and both `_onPreferredSizeChange` / `_onConstraintSizeChange` hooks are `null` (same postcondition `removeAllComponents` already guarantees) | Unit |
| 4 | Ordering: dispose before removal | At the moment `a.dispose()` runs, `parent.getComponents()` still contains `a` (proves the dispose loop runs first, not after the array is cleared) | Unit |
| 5 | Parent with a rendered child holding a materialized style rule | After `parent.disposeAllComponents()`, the child's per-instance style rule is evicted from the rule cache (`_ruleCacheHas` returns `false`) — the leak this method exists to close | Unit |
| 6 | No layout side effect | `disposeAllComponents()` does not call `parent.scheduleLayout()` (inherits `removeAllComponents()`'s no-layout contract) | Unit |
| 7 | Fresh child added afterward | `parent.disposeAllComponents()` then `parent.addComponent(fresh)` succeeds; `getComponents()` is `[fresh]`; no residual `scheduleLayout` fires from touching a disposed ex-child's now-null hooks | Unit |
| 8 | Empty parent | `parent.disposeAllComponents()` on a parent with no children is a no-op returning `this` | Unit |

Case 4's ordering proof (worked example — spy each child's `dispose` and record when it fires relative to the parent's child list):

```typescript
const parent = new Component({});
const a = new Component({});
parent.addComponent(a);

let sawAWhileStillRegistered = false;
vi.spyOn(a, 'dispose').mockImplementation(() => {
    sawAWhileStillRegistered = parent.getComponents().includes(a);
});

parent.disposeAllComponents();

expect(sawAWhileStillRegistered).toBe(true);
expect(parent.getComponents()).toEqual([]);
```

Case 5 lives in the DOM-installed `'Component — destructor disposes style rules'` block (needs `installTestDOM`/`DOM.reset` from that block's hooks), mirroring `Component.test.ts:372-385`'s existing single-component version but through `parent.disposeAllComponents()` instead of a direct `destructor()` call.

### `ChartLegend.setEntries`

| # | Case | Behaviour | Test type |
|---|---|---|---|
| C1 | Legend renders two entries (`getElement(true)` on the resulting rows), then `setEntries` is called again with different entries | Each of the first call's row `Panel`s has its per-instance style rule evicted from the rule cache after the second call | Unit |

### `PickerColumn.clearCells`

| # | Case | Behaviour | Test type |
|---|---|---|---|
| P1 | A column has cells added and rendered (`getElement(true)` on each), then `clearCells()` is called | Each old cell's per-instance style rule is evicted from the rule cache | Unit |

### `AbstractCalendarDropdown.buildDayGrid`

| # | Case | Behaviour | Test type |
|---|---|---|---|
| A1 | `buildDayGrid()` called directly (via cast), its resulting cells rendered, then called again — mirroring a month-arrow navigation | Every day/blank cell built by the first call has its style rule evicted after the second call | Unit |

### `TableHeader.rebuildParentCells`

| # | Case | Behaviour | Test type |
|---|---|---|---|
| H1 | A grouped-column `Table`'s header renders its parent row, then `setHiddenColumns` triggers a rebuild | The old `ParentHeaderCell`'s style rule is evicted after the rebuild | Unit |

### `Menu.showAnchored` / `Menu.rebuildPersistentItems`

| # | Case | Behaviour | Test type |
|---|---|---|---|
| M1 | `show()` called twice (rebuild mode) with a `{ separator: true }` config in the item list both times | The first `show()`'s `MenuSeparator` instance has its style rule evicted after the second `show()` — the leak this fix closes | Unit |
| M2 | A persistent menu (constructed with a fixed item array, `getElement(true)` to render) is rebuilt via `rebuildPersistentItems` (cast to call it directly) with a new config list, including one item built with `config.separator: true` | The first build's `MenuItem`s all have their style rules evicted after the rebuild — confirms the migration preserves already-correct behavior (no `MenuSeparator` is ever involved in this path) | Unit |

Worked example for M1 (rebuild-mode `show`, mirroring `Menu.test.ts`'s existing setup style):

```typescript
const menu = new Menu();
menu.show(0, 0, [{ text: 'A', action: () => {} }, { separator: true }]);

const oldSeparator = (menu as any)._menuItems[1];
oldSeparator.getElement(true);
const id = oldSeparator.getId();
expect(_ruleCacheKeys().some(k => k.startsWith('#' + id))).toBe(true);

menu.show(0, 0, [{ text: 'B', action: () => {} }]);

expect(_ruleCacheKeys().some(k => k.startsWith('#' + id))).toBe(false);
```

### `LayoutSerialization.restoreLayout`

| # | Case | Behaviour | Test type |
|---|---|---|---|
| L1 | `root` is a `Split` containing a nested `Split` scaffold (rendered via `getElement(true)`) whose two leaves both resolve through the factory | After `restoreLayout`, the nested scaffold `Split` container's style rule is evicted — the leak this fix closes | Unit |
| L2 | `root` (a `Tab`) has a normal leaf and a second child added with `{ transient: true }` layout constraints (rendered via `getElement(true)`), mirroring a `Dock` empty-state placeholder | After `restoreLayout`, the transient child's `getParentComponent()` is `null` (detached) but its style rule is still present in the rule cache (not disposed) | Unit |
| L3 | Extends the existing `'skips a leaf whose factory returns null, warns, and re-aligns survivors'` case: the dropped leaf is rendered (`getElement(true)`) before `restoreLayout` runs | After `restoreLayout`, the dropped leaf's style rule is evicted — previously it was silently orphaned but never disposed | Unit |

L1 and L2 both need `root` to genuinely have a `Split`/`Tab` manager kind so `nodeFor`/`populateContainer` take the container branch, not the single-panel branch — mirror the existing `'reproduces a split arrangement from its own serialized state'` case's `Container`/`Split` setup (`LayoutSerialization.test.ts:104-120`).

---

## Verification

- `npm run typecheck` — zero errors.
- `npm run lint` — zero warnings.
- `npm run test -- Component` — cases 1–8 pass; `MenuBar.test.ts:49` (`'disposes and rebuilds so the child count tracks the new descriptor list'`) stays green.
- `npm run test -- ChartLegend` — existing cases plus C1 pass.
- `npm run test -- PickerColumn` — existing cases plus P1 pass.
- `npm run test -- DatePickerDropdown` — new file, case A1 passes.
- `npm run test -- packages/lib/tests/component/table/Header.disposal.test.ts` — new file, case H1 passes.
- `npm run test -- packages/lib/tests/overlay/Menu.test.ts` — existing suite plus M1/M2 pass.
- `npm run test -- LayoutSerialization` — existing suite plus L1/L2/L3 pass.
- `npm run docs:api` — zero TypeDoc warnings (new `@remarks` blocks only link to in-package, publicly-exported symbols: `Component.dispose`, `disposeAllComponents`, `removeAllComponents`, `removeComponent`, `getComponents`, `moveComponent` — all already public).

---

## Documentation Impact

- [`packages/lib/docs/concepts/component-lifecycle.md`](../packages/lib/docs/concepts/component-lifecycle.md) — "Disposal" section gets the one-sentence addition in step 4. No other doc page names `removeComponent` or `removeAllComponents` in a way `disposeAllComponents` itself changes.
- [`packages/lib/docs/layouts/LayoutSerialization.md`](../packages/lib/docs/layouts/LayoutSerialization.md) — the "How restore works" numbered list (step 10d) currently describes the scaffold-clearing step as a cheap, stateless detach; it becomes a dispose, and step 1 gains the transient-detachment behavior. This is the only doc page describing `restoreLayout`'s internal mechanics in prose.
- TypeDoc picks up `disposeAllComponents()` automatically from its JSDoc — it's a public method on an exported class, no manual API-reference page to touch. None of the six fixed call sites change a public signature, so no other API-reference page is affected.

---

## Potential Challenges

- **A future re-parenting call site might be tempted to use `disposeAllComponents()` by mistake**, since its name reads like a stronger `removeAllComponents()`. Mitigation: the new method's doc comment states up front that it is the *discarding* counterpart and names `moveComponent` as the re-parenting path to use instead.
- **`collectLeaves`'s new side effect (detaching transient children) is easy to miss** when a future maintainer adds a new kind of transient chrome, if that chrome is added somewhere `collectLeaves`'s walk does not reach (e.g. nested inside a container kind that is not `Split`/`Tab` and therefore never descended into). Mitigation: the updated doc comment on `collectLeaves` states the detachment behavior explicitly, and `## Addendum` records the concrete counterexample (`Dock`'s placeholder) that motivated it, so the next reader has a worked case to check against.
- **This plan and `dock-disposes-tab-content` both touch `LayoutSerialization.ts`.** They do not touch the same lines, but that plan's `[^restore-fix]` footnote describes the exact pre-change behavior of the line this plan edits. Mitigation: whichever plan implements second should re-read the other's `LayoutSerialization.ts` diff before starting, and update `[^restore-fix]`'s prose if it lands first (it becomes stale, not wrong — the placeholder is still merely detached, just now via a different mechanism).

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts`](../packages/lib/src/typescript/lib/core/Component.ts) — `addComponent` (`:4887`), `insertComponent` (`:4922`), `moveComponent` (`:4995`), `removeComponent` (`:5025`), `removeAllComponents` (`:5047`) — the precedent this plan mirrors and must not disturb.
- [`packages/lib/src/typescript/lib/component/menubar/MenuBar.ts`](../packages/lib/src/typescript/lib/component/menubar/MenuBar.ts) — `setMenus` (`:145`) — the original migration target and evidence pattern every other site's single-writer argument mirrors.
- [`packages/lib/src/typescript/lib/component/chart/ChartLegend.ts`](../packages/lib/src/typescript/lib/component/chart/ChartLegend.ts) — `setEntries` (`:167`).
- [`packages/lib/src/typescript/lib/component/input/PickerColumn.ts`](../packages/lib/src/typescript/lib/component/input/PickerColumn.ts) — `clearCells` (`:325`).
- [`packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts`](../packages/lib/src/typescript/lib/component/input/AbstractCalendarDropdown.ts) — `buildDayGrid` (`:701`), `openYearScroller` / `closeYearScroller` (`:919`, `:946`) for context on `_dayGrid`'s own persistent lifecycle.
- [`packages/lib/src/typescript/lib/component/table/Header.ts`](../packages/lib/src/typescript/lib/component/table/Header.ts) — `rebuildParentCells` (`:623`), `getParentRow` (`:325`), `setHiddenColumns` (`:205`) — the public trigger the new test drives.
- [`packages/lib/src/typescript/lib/overlay/Menu.ts`](../packages/lib/src/typescript/lib/overlay/Menu.ts) — `showAnchored` (`:275`), `rebuildPersistentItems` (`:895`), `buildPersistentItems` (`:916`), the class comment at `:113-124` establishing the "remove a proven-dead guard" precedent this plan's `rebuildPersistentItems` migration follows.
- [`packages/lib/src/typescript/lib/component/container/MenuItem.ts`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts) — `isSeparator` (`:401`), the `separator` config field (`:71-72`) — proves persistent mode never constructs a `MenuSeparator`.
- [`packages/lib/src/typescript/lib/layout/LayoutSerialization.ts`](../packages/lib/src/typescript/lib/layout/LayoutSerialization.ts) — `collectLeaves` (`:300`), `parkLeaves` (`:324`), `serializableChildren` (`:196`), `restoreLayout` (`:561`).
- [`packages/lib/src/typescript/lib/overlay/Dock.ts`](../packages/lib/src/typescript/lib/overlay/Dock.ts) — `setEmptyContent` / `getEmptyContent` (`:345`, `:371`), `showEmptyState` (`:944`) — the concrete counterexample motivating the `LayoutSerialization` companion fix; read before touching that file.
- [`packages/lib/tests/component/Component.test.ts`](../packages/lib/tests/component/Component.test.ts) — `'Component child lifecycle — wiring & teardown'` (`:264`) and `'Component — destructor disposes style rules'` (`:368`) — the test-style precedent for every new style-rule regression case.
- [`packages/lib/tests/component/table/HeaderCell.disposal.test.ts`](../packages/lib/tests/component/table/HeaderCell.disposal.test.ts) — the `_ruleCacheKeys` / `survivingRulesFor` idiom the new `Header.disposal.test.ts` follows.
- [`packages/lib/tests/component/input/TimePickerDropdown.test.ts`](../packages/lib/tests/component/input/TimePickerDropdown.test.ts) — the `installTestDOM` + `any`-cast setup style the new `DatePickerDropdown.test.ts` follows.

---

## Non-Goals

- Does not change `removeComponent` / `removeAllComponents`'s detach-only contract or touch any re-parenting call site (`Button._rebuildContentRow`, `moveComponent`).
- Does not add a predicate/filter form — see `## Architecture Decisions`.
- Does not touch `AbstractWindow.onExitAction`'s existing recursive-dispose teardown for torn-off float windows, even though a torn-off `Dock` float showing its empty-state placeholder would already hit the same class of problem there today. That is a pre-existing, separate code path (window close, not `restoreLayout`'s scaffold clear) this plan's six sites do not include, and fixing it is not made harder or easier by this plan.
- Does not touch SQLAdmin (a separate app repo). SQLAdmin's own `StartPage.ts` fix already landed independently and is commented to migrate onto this method once it ships.

---

## Addendum: Why `LayoutSerialization` needed more than a swap

The original survey that found these six sites assumed, for `LayoutSerialization.restoreLayout`, that everything left under `root` by the time its scaffold-clearing line runs is disposable — on the reasoning that `parkLeaves` already detaches every leaf individually first, so only interior `Split`/`Tab` containers remain. That reasoning is incomplete: `parkLeaves` collects leaves via `collectLeaves`, which walks `serializableChildren` — a filter that *excludes* any child whose layout constraints mark it `transient`. A transient child is therefore never visited by `collectLeaves` at all, never parked, and still sitting under `root` when the old assumption said only scaffold remained.

The only shipping example of a transient child is `Dock`'s empty-state placeholder. `Dock.setEmptyContent(component)` caches a single `Component` instance in `this._options.emptyContent` for the dock's entire lifetime; `showEmptyState()` mounts that same instance, under `{ transient: true }` constraints, as a tab in the dock's root region whenever the region has no live panels; `hideEmptyState()` detaches it (through `Tab.closeTab`, not a bare `removeComponent`, specifically to avoid leaving a stale tab-strip cell) when a real panel arrives. `Dock.setLayoutState(state)` calls `restoreLayout(this.getRootRegion(), state, ...)` directly on this same region — so restoring a saved layout while a dock is empty is not a rare edge case, it is the mainline "switch to a named workspace" path applied to an empty dock.

Before this plan, `restoreLayout`'s scaffold-clearing line was `root.removeAllComponents()` — detach-only. The placeholder, still nested under `root` (never parked, because it is filtered out of `collectLeaves`), was detached along with everything else and left parentless. `Dock`'s own `showEmptyState()` — called again by whatever later event re-triggers a Dock reconcile — checks `placeholder.getParentComponent() !== region` and, finding it true, re-mounts the *same* instance. This is exactly the mechanism the `dock-disposes-tab-content` plan's `[^restore-fix]` footnote describes when it says the placeholder "is transient, so it is never captured, and `restoreLayout`'s `root.removeAllComponents()` merely detaches it — leaving it parentless, which makes `showEmptyState`'s … branch re-mount it."

Swapping `root.removeAllComponents()` to `root.disposeAllComponents()` without any other change would have broken this re-mount: `dispose()`'s recursion tears down every descendant of whatever it is called on, and the placeholder — still a descendant of one of `root`'s old children — would be destroyed (element removed, style rule deleted, listeners released) the first time `setLayoutState` ran on an empty dock. Every later `showEmptyState()` call would then try to re-mount a torn-down component.

The fix keeps the original survey's goal (dispose the interior scaffold, which today only leaks) while restoring the invariant the swap needs: `collectLeaves` now detaches every transient child it encounters, the same way `parkLeaves` already detaches every leaf, so nothing but genuinely disposable scaffold is left under `root` by the time the dispose sweep runs. A leaf a misbehaving factory declined to vouch for (`factory(id) !== leaf`) is not transient and is not parked either — it is left in place today, silently orphaned but never disposed. Under the fix it is caught by the same scaffold-disposal sweep and disposed. The factory's own contract already treats this as an accepted degrade path ("a misbehaving factory degrades to 'state not preserved' rather than re-homing a stale orphan") with no code anywhere that re-attaches that specific instance later by identity, unlike the `Dock` placeholder's documented re-mount contract — so closing this smaller, secondary leak is a safe side effect of the same fix, not a separate risk.

---

## Notes

[^reparent-evidence]: `moveComponent` (`Component.ts:4995-5016`) calls `oldParent.removeComponent(child)` then `insertComponent(child, …)` on the new parent — if `removeComponent` disposed the child, the subsequent `insertComponent` would operate on a torn-down component. Confirmed against three call sites: `Button._rebuildContentRow` (`Button.ts:1146-1154`, doc comment explicitly states it re-adds from field state after emptying), `LayoutSerialization.parkLeaves` (`LayoutSerialization.ts:350-356`, parks a leaf via `removeComponent` specifically so its state "survives" for the eventual re-home via `moveComponent`), and `moveComponent` itself, which is the tab drag-reorder / tear-off-window primitive per its own doc comment.

[^no-filter-search]: Searched every `removeAllComponents()` call site in `packages/lib/src` (nine total: `MenuBar.setMenus`, `Menu`'s two sites, the six sites this plan fixes) for one that discards *some* children while keeping others: none exists, once `Menu`'s `MenuItem`-only filters are recognized as the defect (`showAnchored`) or dead code (`rebuildPersistentItems`) rather than a legitimate selective-keep case. Designing a filter parameter to accommodate either would have baked a bug into the new API's shape.

[^menubar-buttons-evidence]: `grep -n "addComponent\|insertComponent\|removeComponent\b" packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` shows exactly one `addComponent` call site (`MenuBar.ts:188`, inside `setMenus`, one call per `button`). `_panels` (the `Menu` overlays) are never passed to `addComponent` — they are opened through `Menu.open()` against the `LayerManager`, not registered as `MenuBar` children — so `this.getComponents()` at the top of `setMenus`'s teardown is always exactly `this._buttons` from the previous call.

[^pickercolumn-single-caller]: `grep -rn "clearCells" packages/lib/src packages/lib/tests` returns two matches: the method's own definition and its one call site in `AbstractCalendarDropdown.buildYearScroller` (`AbstractCalendarDropdown.ts:971`).

[^menuseparator-fresh]: `MenuSeparator`'s constructor (`MenuSeparator.ts:44-60`) calls `setElementCSSRule` — the same per-instance stylesheet mechanism every other leaked child in this plan uses. `showAnchored` constructs one with `new MenuSeparator("context-menu")` (`Menu.ts:292`) fresh on every call; nothing stores a `MenuSeparator` reference anywhere else in the library, and `Menu.ts`'s own class comment (`:113-124`) confirms no `Menu` — and by extension nothing it builds — is ever reached by an ancestor's teardown recursion, so there is no second path that could need this instance to survive.

[^rebuildpersistent-dead-guard]: `Menu.ts:113-124`'s comment on the `_menuItems` field documents that an earlier version of `destructor()` re-disposed persistent-mode items through a guard identical in shape to the one this plan removes from `rebuildPersistentItems`, and that the guard was deleted once proven unreachable — "removed simply because it was redundant, not because the guard made it unsafe." `buildPersistentItems` (`Menu.ts:916-933`) is the only place persistent-mode items are constructed, and it only ever calls `new MenuItem(config, ...)` (never `new MenuSeparator`), confirmed by `grep -n "separator" packages/lib/src/typescript/lib/overlay/Menu.ts` showing no `MenuSeparator` construction outside `showAnchored`.

[^chartlegend-single-writer]: `grep -n "addComponent" packages/lib/src/typescript/lib/component/chart/ChartLegend.ts` returns one call site (`:181`) plus one unrelated doc-comment mention (`:322`, about the legend itself being added to its owning chart).

[^parentrow-single-writer]: `getParentRow()` (`Header.ts:325-327`) returns `this.getComponents()[0]` — a fixed slot never reassigned. `grep -n "row.addComponent\|\.getParentRow().addComponent" packages/lib/src/typescript/lib/component/table/Header.ts` returns the one call inside `rebuildParentCells`'s `flush` closure (`:662`).

[^dock-placeholder-evidence]: `Dock.setEmptyContent` (`Dock.ts:345-364`) caches its argument in `this._options.emptyContent`, read back unchanged by `getEmptyContent()` (`Dock.ts:371-373`) for the life of the `Dock`. `showEmptyState()` (`Dock.ts:944-961`) mounts that instance under `{ transient: true }` constraints (`placeholderConstraints`, `Dock.ts:1014-1019`) whenever `placeholder.getParentComponent() !== region`. `Dock.setLayoutState` (`Dock.ts:549-551`) calls `restoreLayout(this.getRootRegion(), state, ...)` — the same region `showEmptyState` targets. See `## Addendum` for the full trail, including the exact wording of `dock-disposes-tab-content`'s `[^restore-fix]` footnote this evidence confirms.

---

## Implementation Notes

- **Step 12's `instanceof MenuItem` regression-check grep was inaccurate.** The plan expected `grep -n "instanceof MenuItem" packages/lib/src/typescript/lib/overlay/Menu.ts` to return exactly one match (inside `layOutColumns`) once both disposal-loop filters were migrated. In practice the file has several other pre-existing, unrelated `instanceof MenuItem` checks — focus navigation (`focusNext`/`focusPrevious`), hover highlighting, and submenu open/close bookkeeping — none of which this plan touches. The correct check is that removing exactly two occurrences (the two disposal-loop filters in `showAnchored` and `rebuildPersistentItems`) leaves every other pre-existing occurrence in place; verified via `git diff` rather than an absolute grep count.

- **The Verification section's "zero TypeDoc warnings" claim needed one link-syntax fix to hold.** Writing `removeComponent`'s new `@remarks` as `{@link Component.dispose}` (class-qualified) — as literally shown in `## Ordered Implementation Steps`, step 2 — produced 154 new TypeDoc warnings, one per class whose own generated doc page inherits `removeComponent`: `Component.dispose` "was resolved but is not included in the documentation." Every other in-repo `{@link dispose}` reference (`MarkdownEditor.ts`, `Markdown.ts`, `TabBar.ts` ×2) links to it bare, with no class qualifier, since the reference already sits inside `Component`'s own source. Switching to the same bare `{@link dispose}` form resolved all 154 warnings with no other change; `npm run docs:api` now reproduces the plan's claimed baseline (only the one pre-existing, unrelated `Component.onFirstLayout` warning survives, present before this plan on `master` too).
