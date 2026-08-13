---
touches-shared: [packages/lib/docs/components/Menu.md, packages/lib/docs/reference/changelog/next.md]
---

# Menu Item Close-on-Activate Flag — Implementation Plan

## Overview

`Menu` closes itself the instant any item is activated: rebuild-mode (`new Menu()`, a right-click context menu) calls `this.hide()` inside the `onActivate` callback it hands each item ([`Menu.ts:293-296`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L293)), and persistent-mode (`new Menu(items, onClose)`, a `MenuBar` dropdown) calls `this._onClose!()` the same way ([`Menu.ts:927`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L927)). This plan adds an opt-in `closeOnActivate?: boolean` field to [`MenuItemConfig`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L41), defaulting to `true`, so a caller can mark an item `false` and keep the menu open after it runs. Paired with the existing `checked` field, this turns a menu into a multi-select control: the user clicks several checkable rows and the panel stays open, closing only via the outside-click / Escape / window-blur path `Menu` already owns through `LayerManager` ([`LayerManager.ts:451-509`](../packages/lib/src/typescript/lib/core/LayerManager.ts#L451)) — untouched by this plan.

The work is confined to [`MenuItem.ts`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts) and [`Menu.ts`](../packages/lib/src/typescript/lib/overlay/Menu.ts): one new config field, one new `MenuItem` getter, one new private `MenuItem` method, and a small branch in each of `Menu`'s two `onActivate` closures. No changes to `LayerManager`, `MenuButton`, `SplitButton`, `MenuBar`, or the existing single-select `checked` consumer in [`Filter.ts`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L82).

---

## Architecture Decisions

### `closeOnActivate` is a per-item config flag, defaulting to `true`

`MenuItemConfig` gets `closeOnActivate?: boolean`, read at both `onActivate` call sites in `Menu.ts`. Omitted or `true` reproduces today's behaviour exactly — every existing caller, including Filter.ts's single-select operator picker, is untouched.[^visibility-menu-sibling] `false` runs the item's `action` and leaves the menu open.

### `MenuItem` self-manages its own checkmark on activation — the crux

A checkable item (`hasCheck()`) that also sets `closeOnActivate: false` flips its own checkmark on every activation, entirely inside `MenuItem` — no new coordination with `Menu`, and no requirement for the caller to push a fresh `checked` value back in. This mirrors `Checkbox.activate()`, which calls `this.setSelected(!this.isSelected())` and lets the app read the result via `"change"` rather than the app driving the visual state ([`Checkbox.ts:195-203`](../packages/lib/src/typescript/lib/component/input/Checkbox.ts#L195), the `abstract activate()` hook it implements at [`AbstractBooleanInput.ts:188-192`](../packages/lib/src/typescript/lib/component/input/AbstractBooleanInput.ts#L188)).[^checkbox-precedent] A full menu rebuild (tearing down and reconstructing every item, as a rebuild-mode `show()` already does) is the alternative the codebase already has, and it is the wrong tool here: it is built for "the whole item set changed," not "one checkmark flipped while the panel stays open," and it would flicker and drop scroll position on every click of a menu the user is expected to click several times in a row.

The caller's `action` callback is unrelated plumbing: it updates the caller's own model (exactly as it does today), and does not need to touch the menu or the item.

### The `onActivate` wrapper still closes a lingering open submenu, even when it skips closing the menu

Both `onActivate` closures, when they skip `hide()` / `_onClose!()`, call `this.closeOpenSubmenu()` instead. Today that call is reached only via `hide()` ([`Menu.ts:448`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L448)) or `close()` ([`Menu.ts:611`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L611)), both skipped when `closeOnActivate: false`. A real pointer click is preceded by a hover, and hovering a submenu-less item already closes any sibling open submenu via `handleItemOpenSubmenu` ([`Menu.ts:1092-1099`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1092)), so this call is a no-op for the common mouse-driven case. It matters for `Menu.activateFocused()` (persistent-mode keyboard activation, [`Menu.ts:757-769`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L757)) and for a direct programmatic `MenuItem.activate()` call, neither of which passes through a hover first — without it, a still-open sibling submenu would be stranded visible once the panel itself stops closing on every click.

### `toggleFor`'s toggle-shut identity needs no change

`toggleFor` closes an open menu on a second press of the *same* opener by comparing `this._currentOpener` ([`Menu.ts:417-421`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L417)), which is cleared only inside `hide()`. A `closeOnActivate: false` item click never calls `hide()`, so `_currentOpener` stays set to the opener that showed the menu — the next press of that same opener still lands on the toggle-shut branch and closes it. Verified by reading, not changed.

### Submenu items are unaffected; a checkable submenu leaf keeps the whole chain open

An item with `submenu` set never calls `onActivate` — `MenuItem.activate()` and `_onClick` both route it to `_onOpenSubmenu` instead ([`MenuItem.ts:465-469`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L465), [`MenuItem.ts:318-322`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts#L318)), so `closeOnActivate` never applies to a submenu trigger. A *leaf* item **inside** an open submenu is built by the same `buildPersistentItems` code path as a top-level persistent item ([`Menu.ts:921-938`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L921) — `handleItemOpenSubmenu` always opens a submenu in persistent mode, [`Menu.ts:1107-1110`](../packages/lib/src/typescript/lib/overlay/Menu.ts#L1107)), so `closeOnActivate: false` on it falls out for free: skipping `this._onClose!()` there skips the `dismissAll()` call that would otherwise tear down the parent chain, leaving both the submenu and its parent open.

### Both modes get identical treatment

Rebuild mode and persistent mode get the same field, the same default, and the same two-line branch, mirroring how they already share `MenuItemConfig` and the `handleItemOpenSubmenu` submenu hook. Nothing about the feature is mode-specific — a right-click context menu and a `MenuBar` dropdown are equally plausible hosts for a multi-select item set — so there is no reason to special-case one.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/container/MenuItem.ts

interface MenuItemConfig {
    // ...existing fields unchanged...
    /** New. Defaults to `true`. See ## Internal Structure for the full JSDoc. */
    closeOnActivate?: boolean;
}

class MenuItem extends Component {
    // ...existing public surface unchanged...
    /** New. Current checkmark state; meaningless unless `hasCheck()` is `true`. */
    isChecked(): boolean;
}
```

No changes to `Menu`'s public surface — the new behaviour is entirely driven by the config field consumers already pass into `show()` / `toggleFor()` / the constructor.

---

## Internal Structure

### `MenuItemConfig.closeOnActivate` (`MenuItem.ts`, after `action` at line 45)

```typescript
    /** Called when the item is activated (click or Enter). Ignored when `submenu` is set. */
    action?: () => void;
    /**
     * When `false`, activating this item runs `action` but leaves the menu
     * open — the menu still closes on an outside click, Escape, or window
     * blur. Defaults to `true` (close on activation, today's behaviour).
     * Ignored for a submenu-opening item (see `submenu`), which never calls
     * `action`.
     *
     * Pair with {@link MenuItemConfig.checked} for a multi-select menu: each
     * activation flips that item's own checkmark without dismissing the
     * panel, so the user can pick several items in one open.
     */
    closeOnActivate?: boolean;
```

Append one sentence to `checked`'s existing `@remarks` block (lines 63-65): "Paired with `closeOnActivate: false`, the checkmark also flips automatically on each activation — see `closeOnActivate`."

### `MenuItem` checkmark state (`MenuItem.ts`)

New field, placed with the other per-item state near `_checkText` (line 157):

```typescript
    // The item's own live checkmark state, decoupled from `_config.checked`
    // (the caller-owned initial value) so `activateLeaf` can flip it without
    // mutating a config object the caller still holds a reference to.
    private _checked: boolean = false;
```

Seeded in the constructor, inside the existing `if (config.checked !== undefined)` block (lines 241-246):

```typescript
        if (config.checked !== undefined) {
            this._checked = config.checked;
            this._checkText = new Text(config.checked ? "✓" : "");
            this._checkText.setPointerEvents("none");
            this._checkText.setTextAlign("center");
            this.addComponent(this._checkText);
        }
```

New getter, placed after `hasCheck()` (line 377):

```typescript
    /**
     * Returns the item's current checkmark state. Meaningless when
     * `hasCheck()` is `false` — there is no checkmark to report.
     *
     * @returns Whether the checkmark is currently shown.
     */
    isChecked(): boolean {
        return this._checked;
    }
```

New private method, placed directly above `activate()` (before line 454):

```typescript
    /**
     * Shared leaf-activation path for a pointer click and {@link activate}.
     * A checkable item that keeps the menu open (`closeOnActivate: false`)
     * flips its own checkmark first; a checkable item that closes the menu
     * (the default) is left alone here, since the menu tears the item down
     * immediately after and there is nothing left to keep in sync.
     */
    private activateLeaf(): void {
        if (this.hasCheck() && this._config.closeOnActivate === false) {
            this._checked = !this._checked;
            this._checkText?.setText(this._checked ? "✓" : "");
        }

        this._onActivate();
    }
```

`_onClick` (lines 318-322) and `activate()` (lines 460-470) route their leaf case through it instead of calling `this._onActivate()` directly:

```typescript
        this._onClick = () => {
            if (enabled && !this.hasSubmenu()) {
                this.activateLeaf();
            }
        };
```

```typescript
    activate(): void {
        if (this.isSeparator() || !this.isEnabled()) {
            return;
        }

        if (this.hasSubmenu()) {
            this._onOpenSubmenu(this);
        } else {
            this.activateLeaf();
        }
    }
```

### `Menu.ts` — `showAnchored`'s item construction (lines 288-303)

```typescript
        for (const config of configs) {
            const item: MenuItem | MenuSeparator = config.separator === true
                ? new MenuSeparator("context-menu")
                : new MenuItem(
                    config,
                    () => {
                        config.action?.();

                        if (config.closeOnActivate === false) {
                            this.closeOpenSubmenu();
                        } else {
                            this.hide();
                        }
                    },
                    (hoveredItem) => { this.handleItemOpenSubmenu(hoveredItem); },
                    "context-menu"
                );

            this.addComponent(item);
            this._menuItems.push(item);
        }
```

### `Menu.ts` — `buildPersistentItems` (lines 921-938)

```typescript
    private buildPersistentItems(items: MenuItemConfig[]): void {
        this.pauseLayout();

        for (const config of items) {
            const item = new MenuItem(
                config,
                () => {
                    config.action?.();

                    if (config.closeOnActivate === false) {
                        this.closeOpenSubmenu();
                    } else {
                        this._onClose!();
                    }
                },
                (hoveredItem) => { this.handleItemOpenSubmenu(hoveredItem); }
            );

            this.addComponent(item);
            this._menuItems.push(item);
        }

        this.resumeLayout();

        this.setWidth(this.layOutColumns());
    }
```

### The rule, worked

| `closeOnActivate` | Item declares `checked` | On activation |
| --- | --- | --- |
| omitted / `true` | no | `action` runs, menu closes (today's behaviour, unchanged) |
| omitted / `true` | yes | `action` runs, menu closes; the item (and its checkmark) is disposed with it |
| `false` | no | `action` runs, menu stays open; nothing else changes |
| `false` | yes | `action` runs, menu stays open, `isChecked()` flips and the row's checkmark updates in place |

---

## Ordered Implementation Steps

1. **`MenuItem.ts` — add `closeOnActivate` to `MenuItemConfig`.** Insert the field and JSDoc from `## Internal Structure` after `action` (current lines 44-45); append the one-sentence cross-reference to `checked`'s `@remarks` (lines 63-65).
   *Check:* `npm run typecheck`.

2. **`MenuItem.ts` — add the `_checked` field and seed it.** Add `private _checked: boolean = false;` near `_checkText` (line 157); set `this._checked = config.checked;` as the first line inside the `if (config.checked !== undefined)` block (lines 241-246).

3. **`MenuItem.ts` — add `isChecked()`.** Insert directly after `hasCheck()` (line 377), as shown above.

4. **`MenuItem.ts` — add `activateLeaf()` and route both leaf-activation call sites through it.** Insert the new private method directly above `activate()` (before line 454). Change `_onClick`'s body (lines 318-322) and `activate()`'s else-branch (line 468) to call `this.activateLeaf()` instead of `this._onActivate()`.
   *Check:* `grep -n "_onActivate()" packages/lib/src/typescript/lib/component/container/MenuItem.ts` — expect exactly one match, inside `activateLeaf()`.

5. **`Menu.ts` — branch `showAnchored`'s `onActivate` closure.** Replace the unconditional `this.hide();` at line 295 with the `if (config.closeOnActivate === false) { this.closeOpenSubmenu(); } else { this.hide(); }` block shown above.

6. **`Menu.ts` — branch `buildPersistentItems`'s `onActivate` closure.** Replace the unconditional `() => { config.action?.(); this._onClose!(); }` at line 927 with the branched form shown above.
   *Check:* `npm run typecheck`.

7. **Tests — `packages/lib/tests/component/container/leaves.smoke.test.ts`.** Add a `describe('MenuItem checkmark self-toggle', ...)` block covering Expected-Behaviour items 8-10 below (MenuItem-level, no `Menu` involved).

8. **Tests — `packages/lib/tests/overlay/Menu.test.ts`.** Add a `describe('Menu closeOnActivate', ...)` block covering Expected-Behaviour items 1-4, 6, and 7 below as new tests. Item 5 is already covered by the existing `'activateFocused fires the item action and then closes for an enabled leaf'` test — cite it rather than duplicating it.
   *Check:* `npm test`.

9. **Docs.** Apply the three edits in `## Documentation Impact`.
   *Check:* `npm run docs:api` — zero warnings.

10. **Regression sweep.** `npm run lint`. Confirm `packages/lib/tests/component/table/ColumnFilterRow.test.ts` tests 35-37 (Filter.ts's existing single-select `checked` consumer, the closest thing to a real-world caller this plan must not disturb) still pass unmodified.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `packages/lib/src/typescript/lib/component/container/MenuItem.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Modify | `packages/lib/tests/component/container/leaves.smoke.test.ts` |
| Modify | `packages/lib/tests/overlay/Menu.test.ts` |
| Modify | `packages/lib/docs/components/MenuItem.md` |
| Modify | `packages/lib/docs/components/Menu.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

No file is created or deleted. `LayerManager.ts`, `MenuButton.ts`, `SplitButton.ts`, `MenuBar.ts`, and `Filter.ts` are untouched.

---

## Expected Behaviour

All items below are unit-testable offline (`installTestDOM`, no browser-only geometry or visual behaviour is introduced — a checkmark flip is a plain DOM text write, already exercised offline elsewhere in `Menu.test.ts`). No manual verification step is needed.

**Menu-level (rebuild mode)** — build with `menu.show(0, 0, configs)`, drive activation via the constructed `MenuItem`'s `.activate()` (mirrors the existing `'activateFocused fires...'` test's approach of calling the API directly rather than simulating a DOM click):

1. Default (`closeOnActivate` omitted): activating a leaf item still calls `hide()` — `LayerManager.getTopLayer()` is no longer the menu afterward, and the item's own `action` ran exactly once.
2. `closeOnActivate: false`: activating the item runs `action` exactly once and `LayerManager.getTopLayer() === menu` afterward (still open).
3. `toggleFor` second-press-closes: `toggleFor(openerA, rect, [{ text, checked: false, closeOnActivate: false, action }])`; activate that item (menu stays open, per case 2); call `toggleFor(openerA, rect, [...])` again with the same opener — `LayerManager.getTopLayer()` is no longer the menu (the toggle-shut branch still fires).
4. Open submenu torn down by a sibling: `menu.show(0, 0, [{ text: 'Export', submenu: {...} }, { text: 'Bold', checked: false, closeOnActivate: false, action }])`; open the submenu via `exportItem._onOpenSubmenu(exportItem)` (mirrors the existing submenu tests); activate the `'Bold'` item — `(menu as any)._openSubmenuPanel` is now `null`, while `LayerManager.getTopLayer() === menu` (the menu itself stayed open; only the submenu closed).

**Menu-level (persistent mode)** — build with `new Menu(configs, onClose)`, drive activation via `menu.focusItem(i); menu.activateFocused();`:

5. Default: `activateFocused()` on a leaf item calls `onClose` exactly once — already covered by the existing `'activateFocused fires the item action and then closes for an enabled leaf'` test; no new test needed, cite it in `## Verification` as the regression proof.
6. `closeOnActivate: false`: `activateFocused()` runs `action` exactly once and does **not** call `onClose`.
7. A submenu leaf with `closeOnActivate: false`: build a persistent menu with a submenu item; call `submenuTriggerItem._onOpenSubmenu(submenuTriggerItem)` to open the child panel (mirrors case 4), then read it back via `(menu as any)._openSubmenuPanel`; activate a `closeOnActivate: false` leaf inside that child `Menu` (via its own `_menuItems`) — the child's own `onClose` (`() => parentMenu.dismissAll()`) is not invoked, so `(menu as any)._openSubmenuPanel` still holds the same child instance and the parent is still the top layer.

**MenuItem-level** — construct `MenuItem` directly (`new MenuItem(config, onActivate, onOpenSubmenu)`), no `Menu` involved:

8. `closeOnActivate: false` + `checked: false`: after one `.activate()`, `isChecked()` is `true`; after a second `.activate()`, it is `false` again (toggles back and forth on repeated activation).
9. `closeOnActivate: false` + `checked` omitted (not checkable): `.activate()` does not throw; `hasCheck()` stays `false` and `isChecked()` stays `false` throughout.
10. Default (`closeOnActivate` omitted) + `checked: false`: `.activate()` still calls `onActivate` exactly once — the checkmark self-toggle is irrelevant to this case since the menu tears the item down immediately after in real use; the test only needs to confirm `activateLeaf`'s guard doesn't throw or skip `onActivate` when `closeOnActivate` is unset.

---

## Verification

- `npm run typecheck` — clean.
- `npm test` — the new blocks in `leaves.smoke.test.ts` and `Menu.test.ts`, plus the whole suite. `Menu.test.ts`'s existing `'activateFocused fires the item action and then closes for an enabled leaf'` test and `ColumnFilterRow.test.ts` tests 35-37 must pass **unmodified** — the regression proof that the default (`closeOnActivate` omitted) path is untouched.
- `npm run lint` — clean.
- `grep -n "_onActivate()" packages/lib/src/typescript/lib/component/container/MenuItem.ts` — exactly one match, inside `activateLeaf()`.
- `npm run docs:api` — zero warnings.

---

## Documentation Impact

1. **`packages/lib/docs/components/MenuItem.md`** — add a `closeOnActivate` row to the "Config shape" table (after `action`): *"When `false`, the item runs `action` but the menu stays open; pairs with `checked` for a multi-select menu."* Extend "## Checkable items" with a short paragraph plus code sample showing `checked` + `closeOnActivate: false` producing a multi-select menu, noting the checkmark flips automatically and the panel closes only via outside click / Escape / blur.
2. **`packages/lib/docs/components/Menu.md`** — add a `closeOnActivate` row to the "Item config" table (after `action`); amend the sentence *"The menu closes itself on item click, outside click, or when the browser window loses focus... you don't need to call `hide()`"* in the Rebuild mode section with an exception clause for `closeOnActivate: false` items. That table is already missing `checked`, `glyph`, and `glyphColor` rows (pre-existing, unrelated to this plan) — add only `closeOnActivate`, don't backfill the others.
3. **`packages/lib/docs/reference/changelog/next.md`** — new `### Menu` subsection under `## Added` (no such subsection exists yet), one bullet: **`MenuItemConfig.closeOnActivate`** lets an item run its `action` without closing the menu; paired with `checked`, the item's own checkmark toggles automatically on each activation, turning a menu into a multi-select control. Defaults to `true` (today's behaviour). No consumer action is needed.

---

## Potential Challenges

- **The checkmark flip is optimistic and cannot be vetoed by `action`.** If a caller's own state update can fail or be rejected, `MenuItem`'s local `isChecked()` has no built-in way to be corrected from outside — there is no public setter, and no per-item handle is exposed to a caller the way an app keeps a `Checkbox` reference. Mitigation: none needed for this plan's scope; no existing or planned consumer requires it.
- **No mutually-exclusive (radio-style) coordination between items.** `activateLeaf()` flips only the clicked item's own checkmark; a caller wanting "exactly one of these five is checked" with the panel staying open must uncheck the others itself (e.g. by rebuilding, as Filter.ts already does for its own single-select, `closeOnActivate: true` case). Not addressed here — flagged in `## Non-Goals`.
- **`closeOpenSubmenu()` in the "stays open" branch is a no-op for ordinary mouse clicks.** It exists for `activateFocused()` (keyboard) and a direct programmatic `activate()` call, neither of which passes through the hover step that already closes a sibling submenu. Keep it — it costs nothing to call when there is no open submenu to close — rather than trying to special-case it away.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/container/MenuItem.ts`](../packages/lib/src/typescript/lib/component/container/MenuItem.ts) — `MenuItemConfig` (41), `checked` (66), `_checkText` (157), the `config.checked` construction block (241-246), `hasCheck` (375), `_onClick` (318-322), `activate` (460-470).
- [`packages/lib/src/typescript/lib/overlay/Menu.ts`](../packages/lib/src/typescript/lib/overlay/Menu.ts) — `showAnchored` (279, item construction 288-303), `buildPersistentItems` (921-938), `closeOpenSubmenu` (990-997), `dismissAll` (1006-1012), `hide` (445-465), `close` (608-621), `toggleFor` (410-438), `handleItemOpenSubmenu` (1092-1118).
- [`packages/lib/src/typescript/lib/core/LayerManager.ts`](../packages/lib/src/typescript/lib/core/LayerManager.ts) — `handleOutside` (451-509), `onKeyDown` (548-566): **the precedent confirming the outside-click / Escape / blur dismissal path needs no change.**
- [`packages/lib/src/typescript/lib/component/input/AbstractBooleanInput.ts`](../packages/lib/src/typescript/lib/component/input/AbstractBooleanInput.ts) (188-192) and [`packages/lib/src/typescript/lib/component/input/Checkbox.ts`](../packages/lib/src/typescript/lib/component/input/Checkbox.ts) (195-203) — **the precedent `activateLeaf()`'s self-toggle mirrors.**
- [`packages/lib/src/typescript/lib/component/table/cell/Filter.ts`](../packages/lib/src/typescript/lib/component/table/cell/Filter.ts) (74-90) — the existing single-select `checked` consumer that must keep working unmodified.
- [`packages/lib/tests/overlay/Menu.test.ts`](../packages/lib/tests/overlay/Menu.test.ts) — `'Menu focus navigation (persistent)'` and `'Menu rebuild-mode submenus'` describe blocks: the shape to extend.
- [`packages/lib/tests/component/container/leaves.smoke.test.ts`](../packages/lib/tests/component/container/leaves.smoke.test.ts) — `'MenuItem pure boolean getters'`: the shape to extend.
- [`packages/lib/tests/component/table/ColumnFilterRow.test.ts`](../packages/lib/tests/component/table/ColumnFilterRow.test.ts) (tests 35-37, from line 603) — must keep passing unmodified.

---

## Non-Goals

- **Mutually-exclusive (radio-style) auto-uncheck of sibling items.** `closeOnActivate` and the checkmark self-toggle operate on one item at a time; coordinating a set stays the caller's job.
- **A correction/veto API letting `action` reject an optimistic checkmark flip.** No consumer needs it today.
- **Embedding arbitrary custom controls (text inputs, custom components) into a menu row.** A separate, larger plan. `closeOnActivate` does not paint that work into a corner: it is a plain per-row config flag that has nothing to do with what the row renders, and a future component-based row would read the same flag the same way.
- **Any change to `LayerManager`, `getDismissMode`, or the outside-click / Escape / window-blur dismissal path.** Confirmed correct as-is; out of scope.
- **Changes to `MenuButton`, `SplitButton`, `MenuBar`, or `Filter.ts`.** None of them need to set the new field; all keep working unmodified.

---

## Notes

[^checkbox-precedent]: `AbstractBooleanInput.activate()` is the abstract hook `Checkbox`, `RadioButton`, and `Toggle` all implement; `Checkbox.activate()` calls `this.setSelected(!this.isSelected())` unconditionally on every click or Space press, updating its own `_options.selected` and notifying `"change"` listeners with the already-applied new value — the app reacts to what happened, it does not drive the visual state. `activateLeaf()` follows the same shape: `MenuItem` owns `_checked`, flips it on activation, and the caller's `action` is free-standing side-effect code, exactly like a `"change"` handler. The alternative — routing the new value from the caller's `action` back into the menu (e.g. the caller re-writing `config.checked` and something re-reading it) — was rejected because it requires the caller to self-reference the very config object it is constructing, is easy to forget, and has no precedent anywhere else in the codebase; self-managed toggle state does.

[^visibility-menu-sibling]: An unrelated, unmerged plan (`table-column-visibility-menu`, in its own worktree/branch, not yet copied into `plans/`) hit this exact wall from the other side: it explicitly ruled out keeping its column-toggle submenu open across several clicks because doing so "would mean changing `Menu`'s activation contract for every consumer," and built a modal dialog instead for its many-column case. An opt-in field defaulting to `true` is precisely what avoids that cost — no existing consumer's activation contract changes. This is cited as motivation only; this plan does not modify that plan or its branch.
