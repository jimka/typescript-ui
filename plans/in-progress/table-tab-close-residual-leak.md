# Table Tab Close Residual Stylesheet-Rule Leak — Implementation Plan

## Overview

`plans/implemented/dock-disposes-tab-content.md` made closing a `Dock` tab dispose its content subtree, cutting SQLAdmin's measured per-cycle leak on a 20-column table tab from 2288 rules to 78. The remaining 78 are still unaccounted for: a scan scoped to the closed tab's own `.TabPanel` subtree (snapshotting every `.ts-ui-component` id under it before close, then checking which had an orphaned rule after) caught only 4 rules — the already-fixed tab-button chain — leaving ~74 rules per cycle that never belonged to the tab's own DOM subtree at all.

The standing hypothesis was that a `LayerManager`-hosted overlay — a `Tooltip` or a `Menu` opened from a toolbar button — mounts outside the tab's subtree (into `document.documentElement`, see [`LayerManager.mount`](packages/lib/src/typescript/lib/core/LayerManager.ts#L245)) and leaks because its owner never disposes it. This plan confirms half of that hypothesis and refutes the other half:

- **`Tooltip` does not leak a rule.** It is a genuine singleton — one `Tooltip` instance for the whole page ([`Tooltip.ts:78`](packages/lib/src/typescript/lib/overlay/Tooltip.ts#L78)) that shows and hides the same element. A disposed button's own `#uuid` rule is removed by `Component.destructor()` regardless of any lingering `Tooltip.attachments` map entry, confirmed by direct test.[^tooltip-map]
- **`Menu` does leak, and by the exact mechanism the hypothesis named.** [`MenuButton._menu`](packages/lib/src/typescript/lib/component/button/MenuButton.ts#L54) is a lazily-created `Menu`, mounted via `LayerManager.mount`, and held only in a private field — never registered through `addComponent`. `Menu.ts`'s own class comment states the general rule: *"no `Menu` anywhere in the library is itself registered via `addComponent`"* ([`Menu.ts:120`](packages/lib/src/typescript/lib/overlay/Menu.ts#L120)). `MenuButton` has no `destructor()` override, so when a tab close disposes the `MenuButton` (a real registered child of the tab's toolbar), `Component.destructor()`'s child recursion never reaches `_menu` — its element, and every `MenuItem` it built, stay on the shared sheet forever. Verified directly: opening a `MenuButton`'s dropdown once, then closing its owning `Dock` tab, leaves the menu's `#uuid` rule in the cache.[^throwaway-confirm]

Searching for every place the library builds a `Menu` this way turns up five more owners with the identical gap, plus a second, independent defect inside `Menu` itself: an open child submenu is never disposed on `destructor()`, and `Menu` never defensively unregisters itself from `LayerManager` the way every sibling `DismissableLayer` does. This plan fixes all of them, following the disposal pattern `SplitGutter._collapseButton` already established ([`SplitGutter.ts:491`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L491)) and the defensive-unregister pattern `AnimatedDropdown.destructor()` already established ([`AnimatedDropdown.ts:403`](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L403)).

---

## Architecture Decisions

### Every raw-field `Menu` owner disposes it explicitly in its own `destructor()`

A `Menu` mounted via `LayerManager` is never a registered child of the component that opens it — this is true of every one in the library, by the class comment cited above. An owner that holds one in a private field must therefore dispose it itself, exactly as `SplitGutter` already does for `_collapseButton`, which is raw-appended to the DOM for the same reason (not a registered child) and disposed with the same one-line, defensively-null-checked call.[^splitgutter-precedent]

Six owners hold a `Menu` this way. Three already have a `destructor()` override that misses the field; three have no override at all:

| Owner | Field | Current `destructor()` |
|---|---|---|
| [`MenuButton`](packages/lib/src/typescript/lib/component/button/MenuButton.ts#L54) | `_menu: Menu \| null` | none |
| [`SplitButton`](packages/lib/src/typescript/lib/component/button/SplitButton.ts#L98) | `_menu: Menu \| null` | none |
| [`ToolBar`](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L137) | `_overflowMenu: Menu \| null` | none |
| [`Table`](packages/lib/src/typescript/lib/component/table/Table.ts#L151) | `_columnContextMenu: Menu` | none |
| [`MenuBar`](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L51) | `_panels: Menu[]` | none (`setMenus` disposes them on rebuild, but a `MenuBar` torn down without a final empty `setMenus` call skips it) |
| [`TabBar`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L509) | `_contextMenu: Menu` | exists ([`TabBar.ts:787`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L787)), disposes six other raw-appended pieces, misses this one |

`ToolBar._overflowButton` and `SplitButton._chevron` are **not** in this table — both are registered via `addComponent` (`ToolBar.ts:358` via `super.addComponent`, `SplitButton.ts:146`), so the base recursion already reaches them.

### `Menu` disposes its own open submenu and defensively leaves the layer tree

[`Menu._openSubmenuPanel`](packages/lib/src/typescript/lib/overlay/Menu.ts#L132) is a second instance of the same defect, one level in: a submenu is itself a `Menu`, built by `new Menu(...)` in [`handleItemOpenSubmenu`](packages/lib/src/typescript/lib/overlay/Menu.ts#L1087) and held only in this field — never a registered child of its parent `Menu`, for the same reason no `Menu` is ever registered anywhere. `closeOpenSubmenu()` ([`Menu.ts:985`](packages/lib/src/typescript/lib/overlay/Menu.ts#L985)) calls `.close()` on it (a fade-and-hide) but is only reached from `hide()` / `close()` — not from `destructor()`. A `Menu` disposed while a submenu is open (a real path once this plan's other fixes call `.dispose()` unconditionally on owners like `Table._columnContextMenu`) leaves that submenu, and everything it built, orphaned.

Separately, `Menu.destructor()` ([`Menu.ts:667`](packages/lib/src/typescript/lib/overlay/Menu.ts#L667)) cancels its in-flight fades but never calls `LayerManager.unregister(this)`. Every other `DismissableLayer` implementor's `destructor()` does this defensively — `AnimatedDropdown.ts:415`, `Popover.ts` (via `hide()` at `Popover.ts:611`), `Drawer.ts:771` — because cancelling a fade suppresses the completion callback that would otherwise have unregistered it, and a layer left in `LayerManager`'s `_stack` is walked on the next document `pointerdown` against a released element handle. `Menu` is the one `DismissableLayer` implementor missing this call.[^layermanager-scan]

The submenu disposal and the `LayerManager.unregister` call both land in `Menu.destructor()`, since both are about `Menu` failing to fully release its own registration and its own raw-held child on teardown — not about any of the six owners above.

---

## Internal Structure

`Menu.destructor()` gains the submenu disposal and the defensive unregister, in the same shape as `AnimatedDropdown.destructor()`:

```typescript
protected destructor(): void {
    this._fadeShowAnimation?.cancel();
    this._fadeShowAnimation = null;
    this._fadeHideAnimation?.cancel();
    this._fadeHideAnimation = null;

    // A still-open submenu is a raw field, not a registered child (see the
    // class comment above _menuItems: no Menu anywhere in the library is
    // registered via addComponent), so the child recursion in
    // super.destructor() below can never reach it.
    this._openSubmenuPanel?.dispose();
    this._openSubmenuPanel = null;

    // Cancelling the fades above suppresses whatever fade-completion callback
    // would otherwise have unregistered this menu from the layer tree
    // (mirrors AnimatedDropdown.destructor()). Idempotent, so an
    // already-closed menu costs nothing.
    LayerManager.unregister(this);

    super.destructor();
}
```

Each of the six owners gets the same one-line addition `SplitGutter.destructor()` uses, guarded where the field can be `null`:

```typescript
// packages/lib/src/typescript/lib/component/button/MenuButton.ts — new override
/**
 * Disposes the lazily-created dropdown, then runs the inherited teardown.
 * `_menu` is a LayerManager-mounted panel, never a registered child (see
 * Menu.ts's class comment), so `super.destructor()`'s child recursion
 * cannot reach it.
 */
protected destructor(): void {
    this._menu?.dispose();

    super.destructor();
}
```

`TabBar.destructor()` adds one line to its existing block (`TabBar.ts:793-798`) rather than gaining a new method:

```typescript
this._tabClip.dispose();
this._toolGroup.dispose();
this._leadGroup.dispose();
this._indicator.dispose();
this._dropTint.dispose();
this._reorderBar.dispose();
this._contextMenu.dispose();
```

`MenuBar` gains a `destructor()` it does not currently have, disposing only `_panels` — `_buttons` are registered via `addComponent` (`MenuBar.ts:188`) and already reached by the base recursion:

```typescript
protected destructor(): void {
    for (const panel of this._panels) {
        panel.dispose();
    }

    super.destructor();
}
```

---

## Ordered Implementation Steps

**Baseline first.** Before any source change, run `npm run test` in `packages/lib` and confirm it is green — this is the pre-existing suite `dock-disposes-tab-content` and `component-purges-event-listeners` left passing, and it must stay green throughout.

1. `packages/lib/src/typescript/lib/overlay/Menu.ts` — edit `destructor()` (line 667) per `## Internal Structure`: add the `_openSubmenuPanel` disposal and the `LayerManager.unregister(this)` call. `LayerManager` is already imported (`Menu.ts:6`).

2. `packages/lib/tests/overlay/Menu.test.ts` — in the `'Menu as DismissableLayer'` describe block (`Menu.test.ts:413`), add a case: open a rebuild-mode menu with `show()`, call `.dispose()` directly (not `.hide()`), and assert `LayerManager.getTopLayer()` is `null`.

3. `packages/lib/tests/overlay/Menu.styleRuleDisposal.test.ts` (new) — mirror the harness in `tests/overlay/Menu.test.ts`'s `'Menu rebuild-mode submenus'` block (`Menu.test.ts:69-102`): build a rebuild-mode menu, `show()` it with an item carrying a `submenu`, open the submenu via `exportItem._onOpenSubmenu(exportItem)`, capture the submenu's id and its own items' ids (via `_menuItems`), then call `menu.dispose()` — **not** `hide()` first, since the point is that `dispose()` alone must fully tear down an open submenu. Assert none of the captured ids appear in `_ruleCacheKeys()` (imported from `~/core/StyleTarget`, per the pattern in `tests/overlay/Dock.styleRuleDisposal.test.ts`).

4. `packages/lib/src/typescript/lib/component/button/MenuButton.ts` — add the `destructor()` override from `## Internal Structure`, placed after the constructor and before `setMenuItems`.

5. `packages/lib/src/typescript/lib/component/button/SplitButton.ts` — add the analogous override (`this._menu?.dispose();` then `super.destructor();`), placed after the constructor and before `setMenuItems`.

6. `packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` — add the analogous override (`this._overflowMenu?.dispose();` then `super.destructor();`). Place it near `_toggleOverflowMenu` (`ToolBar.ts:657`).

7. `packages/lib/src/typescript/lib/component/table/Table.ts` — add the analogous override (`this._columnContextMenu.dispose();`, no `?.` — the field is never null). Place it near `showColumnMenu` (`Table.ts:1171`).

8. `packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` — add the `destructor()` override from `## Internal Structure`, placed after `setMenus` (`MenuBar.ts:145-192`).

9. `packages/lib/src/typescript/lib/component/container/TabBar.ts` — add `this._contextMenu.dispose();` to the existing `destructor()` block (`TabBar.ts:793-798`) per `## Internal Structure`. Extend the method's doc comment (`TabBar.ts:775-786`) to name `_contextMenu` alongside the six pieces it already lists.

10. `packages/lib/tests/component/dispose-full-teardown.test.ts` — add five new `REGISTRY` rows (`MenuButton`, `SplitButton`, `ToolBar`, `Table`, `MenuBar`) and extend the existing `TabBar` row. Each `make()` must materialise the owner's `Menu` before returning — mirroring the existing `Popover` row's `ensureArrow()` idiom (`dispose-full-teardown.test.ts:112-125`) — because an unopened `Menu` writes no rule at all (`StyleTarget.set` queues into `_dirty` until the target's element exists; see `core/StyleTarget.ts:33-38`), so a row that never opens the menu would pass whether or not this plan's fix is present. Exact triggers, all private methods reached via `as unknown as { … }` casts like the rest of the file:
   - **`MenuButton`**: `new MenuButton('Export', { menuItems: [{ text: 'A', action: () => {} }] })`, `getElement(true)`, then call `toggleMenu()`.
   - **`SplitButton`**: `new SplitButton('Save', { menuItems: [{ text: 'A', action: () => {} }] })`, `getElement(true)`, then call `_toggleMenu()`.
   - **`ToolBar`**: `new ToolBar({ overflow: 'menu' })`, add several `new Button('Some Label')` children with real text (so `getPreferredSize().width` is nonzero), `getElement(true)`, `setWidth(40)` (narrower than any one button — forces every child into the overflow set per `_computeOverflowed`, `ToolBar.ts:604`), `doLayout()` (runs `_reflowOverflow`, `ToolBar.ts:556`), then call `_toggleOverflowMenu()`.
   - **`Table`**: `new Table(new MemoryStore(new Model([{ name: 'a', type: 'string', order: 0 }], 'a'), []))` (mirrors `tests/component/table/Table.test.ts:26`), `getElement(true)`, then call `showColumnMenu(0, 0)`.
   - **`MenuBar`**: `new MenuBar({ menus: [{ label: 'File', items: [{ text: 'A', action: () => {} }] }] })`, `getElement(true)`, then call `openMenu(0)`.
   - **`TabBar` (extend the existing row, `dispose-full-teardown.test.ts:129-146`)**: after constructing the bar and adding at least one entry, call the private `openTabMenu(entry, 0, 0)` (signature at `TabBar.ts:1697`, driven the same way `tests/component/container/TabBar.contextMenu.test.ts` reaches it, except against the real `_contextMenu` rather than a stub). Add `bar._contextMenu` to the row's `ownIds` callback's `extraSubtrees` list alongside the six existing fields.

   Every new/extended row needs its `Menu` closed or left open — either is fine, since `dispose()` must tear it down regardless (that is the point of this plan); do not add a closing call whose only purpose is to make the row pass without the fix.

11. Regression checkpoint: `grep -rn '_menu?.dispose()\|_overflowMenu?.dispose()\|_columnContextMenu.dispose()\|_contextMenu.dispose()\|_openSubmenuPanel?.dispose()' packages/lib/src/typescript/lib` — six hits: `MenuButton` and `SplitButton` both match the `_menu?.dispose()` alternative (one each), plus one each for `ToolBar`, `Table`, `TabBar`, and `Menu.ts`'s own submenu line. `MenuBar` uses `panel.dispose()` in a loop rather than the `?.` form, so match it separately: `grep -n 'panel.dispose()' packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` — two hits, the pre-existing one inside `setMenus` and the new one inside `destructor()`.

12. Run the full `## Verification` list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/MenuButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/SplitButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/tests/overlay/Menu.test.ts` |
| Create | `packages/lib/tests/overlay/Menu.styleRuleDisposal.test.ts` |
| Modify | `packages/lib/tests/component/dispose-full-teardown.test.ts` |

---

## Expected Behaviour

All cases are unit-testable under the offline harness (`installTestDOM` + the modelled DOM; none needs real geometry, drag, or focus).

- **A `MenuButton` whose dropdown was opened at least once leaks nothing after its owner disposes it.** Open the dropdown, then `dispose()` the button directly: no id belonging to the menu or its items remains in `_ruleCacheKeys()`.
- **The same holds for `SplitButton`, `ToolBar` (overflow menu), `Table` (column context menu), `MenuBar` (each top-level dropdown), and `TabBar` (its own right-click context menu).**
- **A `Menu` disposed while still open unregisters from `LayerManager`.** `LayerManager.getTopLayer()` is `null` afterward, whether the menu was disposed via `.dispose()` directly or via an owner's `destructor()`.
- **A `Menu` disposed while a submenu is open leaves neither the parent's nor the submenu's rules behind.** Covers `_openSubmenuPanel` specifically — the case a scan of the parent's own `_menuItems` cannot see, since the submenu was never one of them.
- **A `Menu` that was never opened disposes as a no-op.** `Component.dispose()` is documented idempotent; a `MenuButton` whose dropdown was never clicked, or a `Table` whose column menu was never right-clicked, still disposes cleanly (already implicitly covered — no test needed beyond the registry's `Popover`-style "warm, then real" pass, unchanged by this plan).
- **None of the six owners' *other* teardown regresses.** `TabBar`'s existing six-piece disposal list, `ToolBar`'s registered `_overflowButton`, `SplitButton`'s registered `_chevron`, and every button/table/menu-bar behavioural test already in the suite continue to pass unmodified.

No case here needs manual/browser verification — the defect and the fix are both fully expressible through `getElement(true)` + a private trigger method + `dispose()` + `_ruleCacheKeys()`, exactly like the rest of the `*.styleRuleDisposal.test.ts` family.

---

## Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run test` — full suite green, including (unmodified) `tests/overlay/Dock.closeDisposal.test.ts`, `tests/layout/Tab.closeDisposal.test.ts`, and `tests/component/*` event-purge suites left by `dock-disposes-tab-content` and `component-purges-event-listeners` — this plan must not regress either.
- The step 11 grep checkpoints.
- `npm run docs:api` — zero warnings (no public JSDoc changes are expected, but the doc-comment edits in steps 4-9 are new `protected` members, which TypeDoc excludes from the public surface — confirm the run stays clean regardless).
- `npm run build:lib` — succeeds.
- **Manual, in the library's own demo app** (`npm run dev` in `packages/lib`), repeating the SQLAdmin measurement methodology so the fix is checkable the same way the defect was found — this is a sanity check on this branch; the authoritative re-measurement against SQLAdmin happens later, outside this plan:
  1. Open `MiscPanel`'s "Dockable layout (Dock)" demo (`packages/lib/src/typescript/MiscPanel.ts:1018`).
  2. In one of the dock's tab-content factories (e.g. `dockPanel`, `MiscPanel.ts:1026`), temporarily add a small `ToolBar` holding a `MenuButton` with a couple of `menuItems`, so the demo has a closeable tab whose content opens a `Menu` — no such combination exists in the demo app today.
  3. Open the browser console, record `[...document.styleSheets].reduce((n, s) => n + s.cssRules.length, 0)`.
  4. Open the tab's `MenuButton` dropdown, close it, then close the tab. Record the rule count again.
  5. Repeat open/close four times. Before this plan's fix, the count grows every cycle by the menu's own rule plus one per item; after the fix, it returns to the pre-cycle baseline each time.
  6. Revert the temporary demo addition — it exists only to drive this manual check, not to ship. The offline suite from `## Ordered Implementation Steps` is the durable, permanent regression coverage; this plan adds no lasting demo surface.

---

## Potential Challenges

- **A row added to `dispose-full-teardown.test.ts` could pass by accident if its trigger silently no-ops** (e.g. `_toggleOverflowMenu()` returning early because nothing overflowed). Mitigation: step 10 spells out the exact setup each trigger needs (narrow width for `ToolBar`, at least one menu descriptor for `MenuBar`, etc.); run each new row once against the pre-fix code during implementation to confirm it fails first, per the project's test-first convention.
- **`MenuBar`'s new `destructor()` could double-dispose a panel already disposed by a `setMenus` call that ran just before teardown.** Mitigation: `Component.dispose()` is documented idempotent (`Component.ts:733`), so this is a harmless no-op, not a new failure mode.
- **Disposing `_openSubmenuPanel` inside `Menu.destructor()` could itself recurse into another open grandchild submenu.** Mitigation: this is correct and intended — a submenu can itself have `_openSubmenuPanel` set, and its own `destructor()` (now fixed by this same plan) disposes that in turn, so an arbitrarily deep open submenu chain is fully torn down by one top-level `dispose()` call.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/container/SplitGutter.ts:485-495`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L485) — the precedent this plan's six owner-side fixes mirror: dispose a raw-appended, non-registered child explicitly in `destructor()`.
- [`packages/lib/src/typescript/lib/core/AnimatedDropdown.ts:398-418`](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L398) — the precedent `Menu.destructor()`'s new `LayerManager.unregister(this)` call mirrors, including the reasoning comment about a cancelled fade suppressing the callback that would otherwise unregister.
- [`packages/lib/src/typescript/lib/overlay/Menu.ts`](packages/lib/src/typescript/lib/overlay/Menu.ts) — `_openSubmenuPanel` (132), `handleItemOpenSubmenu` (1087), `closeOpenSubmenu` (985), `destructor` (667), and the class comment at 120 establishing that no `Menu` is ever a registered child anywhere in the library.
- [`packages/lib/tests/component/dispose-full-teardown.test.ts`](packages/lib/tests/component/dispose-full-teardown.test.ts) — the registry this plan extends; read its header comment (the re-derived `protected destructor(` count) before adding rows, and update that count.
- [`plans/implemented/dock-disposes-tab-content.md`](plans/implemented/dock-disposes-tab-content.md) — the plan whose re-measurement against SQLAdmin surfaced this residual leak; its `### Tab is the only container with this gap` decision is the sibling-audit-table precedent this plan's owner table follows.
- [`plans/implemented/component-teardown-seam.md`](plans/implemented/component-teardown-seam.md) — establishes `dispose()` as the public entry point delegating to the `protected destructor()` override hook; its own `Menu` row audit (written before this defect existed) is why `Menu` had no `dispose()` override to begin with — this plan is the first to give `Menu` owner-side disposal responsibilities beyond its own children.

---

## Non-Goals

- **`Tooltip.attachments` map retention.** Confirmed during investigation: any `Button` with title text auto-attaches a `Tooltip` (`Button.ts:992`) and is never explicitly detached by a generic `Component.destructor()` — only specific owners like `TabBar.removeBarEntry` (`TabBar.ts:1584`) call `Tooltip.detach()` themselves. A disposed button's own stylesheet rule is still correctly removed (`Component.destructor()` deletes rules deterministically, not via GC), so this is not a stylesheet leak — confirmed by direct test.[^tooltip-map] It is a real memory-retention defect (the module-level `Tooltip.attachments` map holds a closure over the disposed component forever), the same *class* of bug `component-purges-event-listeners` fixed for `Event`'s own maps, but in a different module's private map that fix does not reach. Out of scope here because this plan is scoped to the residual *stylesheet-rule* leak; a `Tooltip`-side fix is a separate plan.
- **Auditing every `DismissableLayer`-owning raw field beyond `Menu`.** `ComboBox` / `AutoCompleteField` dropdowns and other `AnimatedDropdown` subclasses were not audited for the same raw-field-ownership pattern — this plan is scoped to `Menu`, the component the field evidence and the throwaway investigation both point at. A similar audit for other dropdown families is future work if a similar leak is ever measured there.
- **The SQLAdmin-side re-measurement.** The manual verification step in this plan checks the fix in the library's own demo app. Re-running the original 2288-rule methodology against SQLAdmin with a rebuilt local `dist/lib` happens later, outside this plan.
- **No `package.json` version bump**, in any package. This targets `0.4.1`, already in progress from `dock-disposes-tab-content`; the version bump is a separate, manual release step per the project's release process.

---

## Notes

[^tooltip-map]: Verified with a throwaway offline test before drafting this plan: a `Button` with a `Tooltip` attachment, added to a `Dock` tab and never hovered (so no popup rule ever materialises — `Tooltip.show` is never called), disposed via `Dock.removePanel`. The button's own `#uuid` rule is gone from `_ruleCacheKeys()` afterward. `Tooltip` itself is a private-constructor singleton (`Tooltip.ts:146`) — one instance for the whole page, reused across every `show()` — so there is no per-attachment rule to leak in the first place, only the map entry, which is memory retention, not a stylesheet leak.

[^throwaway-confirm]: A `MenuButton`'s dropdown was opened once (`toggleMenu()`), then closed, then its owning `Dock` tab was closed via `removePanel` (the `dock-disposes-tab-content` fix, already on this branch). The menu's own `#uuid` rule was still present in `_ruleCacheKeys()` afterward — the assertion the test made and passed. `menu.getParentComponent()` is `null` throughout by construction, not merely at teardown: per `Menu.ts`'s class comment, no `Menu` anywhere in the library is ever registered via `addComponent`, so it never has a parent to begin with — it was never reachable from the disposed subtree at all, not even transiently.

[^splitgutter-precedent]: `SplitGutter.destructor()`'s doc comment states the rule directly: *"the button is raw-appended to this gutter's element rather than registered as a child, so `super.destructor()`'s child recursion cannot reach it."* Every `Menu` owner in this plan is in the same position — the difference is the child is portaled into `document.documentElement` via `LayerManager.mount` rather than raw-appended into the owner's own element, but the consequence for the base class's `_components` recursion is identical: it was never registered, so it is never reached.

[^layermanager-scan]: Checked every `implements DismissableLayer` class in the library (`grep -rln 'implements DismissableLayer' packages/lib/src/typescript/lib`): `AnimatedDropdown`, `Popover`, `Dialog`, `AbstractWindow`, `Drawer`, `Menu`. `AnimatedDropdown.destructor()` (415), `Drawer.destructor()` (771), and `Dialog.destructor()` (1195, guarded by `!this._finalizing`) all call `LayerManager.unregister(this)` directly. `Popover.destructor()` (609) calls `this.hide()` when still open, and `hide()` itself unregisters (`Popover.ts:518`). `AbstractWindow` unregisters from its exit-action method (`AbstractWindow.ts:863`) before that method calls `this.destructor()` — so `AbstractWindow.destructor()` itself has no unregister call, but every close path still reaches one. `Menu` is the only one of the six where no path reaches `LayerManager.unregister` at all.
