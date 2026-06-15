---
depends-on: [container-base-class]
touches-shared:
  - src/typescript/lib/core/Panel.ts
---

# Reparent Chrome / Layout-Wrapper Components off `Panel` onto `Container` — Implementation Plan

## Overview

Follow-up to [`plans/implemented/container-base-class.md`](implemented/container-base-class.md), which introduced a `Container` station between [`Component`](../src/typescript/lib/core/Component.ts) and [`Panel`](../src/typescript/lib/core/Panel.ts). **That dependency has landed** — [`Container.ts`](../src/typescript/lib/core/Container.ts) now exists on disk and `Panel extends Container`, so every reference below is verified against current code. `Container` is the fit-parent (`clampsToContentSize() === false`, [Container.ts:49](../src/typescript/lib/core/Container.ts#L49)), zero-default-inset (inherits `Component`'s zero default, [Container.ts:26](../src/typescript/lib/core/Container.ts#L26)), no-autoScroll / no-body-host / no-scroll-shadow base; `Panel extends Container` keeps the `Insets(4,4,4,4)` content padding ([Panel.ts:99](../src/typescript/lib/core/Panel.ts#L99)) and the full native-scroll stack.

This plan migrates the `Panel` subclasses that use `Panel` purely as a fit-parent structural container — they call **no** Panel-only API (`setAutoScroll`/`getAutoScroll`/`clearAutoScroll`, the body-host / content-frame / `getChildHost` scroll path, the scrollbar-gutter `getInnerSize` override, scroll shadows) — from `extends Panel` to `extends Container`. The win is shedding the unused scroll machinery and the stray 4px default inset; several classes already fight that 4px and that cleanup goes away.

Audited targets fall into three buckets: **migrate now** (8 chrome classes), **migrate in a separate deferred phase** (2 core overlays — `Popover`, `AbstractWindow`), and **stay on `Panel`** (`PickerColumn`'s inner `PickerCellList`). All migrations are behavior-preserving except the intended loss of the 4px ring where a class did not already clear it.

---

## Architecture Decisions

### Migration is mechanical: swap the base and the options parent

For each migrated class the change is two lines plus an import: `extends Panel<TOptions>` → `extends Container<TOptions>`, and `interface XOptions extends PanelOptions` → `extends ContainerOptions`. Because `Container` adds no fields and no setters (verified: `interface ContainerOptions extends ComponentOptions {}` with no new members, [Container.ts:15](../src/typescript/lib/core/Container.ts#L15)), and because every option these classes actually pass to `super` (`tag`, `insets`, `layoutManager`, `id`, `name`, `components`, …) lives on `ComponentOptions`, the options-side change is type-only — no runtime behaviour shifts. The `super(options, defaults)` two-arg form keeps working: `Container`'s constructor forwards `(options, subclassDefaults)` to `Component` unchanged, exactly as `Panel` did.

`clampsToContentSize` stays `false` for all of them — `Container` supplies it (moved down from `Panel`). So fit-parent sizing/layout is byte-identical to today. None of these classes overrode `clampsToContentSize` themselves (verified: only `Panel` did), so nothing to delete there.

### No migrated class touches Panel-only API — verified

A grep across the eight migrate-now files for `setAutoScroll` / `getAutoScroll` / `clearAutoScroll` / `getChildHost` / `getInnerSize` / `scrollShadow` / `contentFrame` / `bodyHost` returns **zero** hits in their own bodies. Every `setLayoutManager(...)` call they make resolves to `Component.setLayoutManager` (the dependency plan confirms the layout-manager + children + insets machinery lives on `Component`, not `Panel`), so layout wiring is unaffected by dropping the `Panel` layer. This is the gate that makes them reparent-safe.

### Inset cleanups: remove the *redundant* zero, keep the *intentional* non-zero

`Container` defaults to zero insets, so any `insets: new Insets(0,0,0,0)` / `clearInsets()` a migrated class performs purely to undo Panel's 4px becomes redundant and is removed. But three classes carry a *deliberate non-zero* inset that is part of their visual spec and **must stay**:

- **StatusBar** outer panel: `insets: new Insets(0, 6, 0, 6)` ([`StatusBar.ts:53`](../src/typescript/lib/component/container/StatusBar.ts#L53)) — 6px left/right breathing room for the strip. **Keep.** What becomes redundant is the `insets: new Insets(0,0,0,0)` on the *internal* `_leftZone`/`_rightZone` panels ([`StatusBar.ts:112-113`](../src/typescript/lib/component/container/StatusBar.ts#L112)) — but only if those inner panels are themselves migrated to `Container` (see below).
- **ToolBar** compact toggle: `setInsets(new Insets(inset, inset, inset, inset))` where `inset` is the compact value (2px) vs the default ([`ToolBar.ts:228`](../src/typescript/lib/component/menubar/ToolBar.ts#L228)) — this is a runtime state change, not a Panel-default override. **Keep the setter**, but the *default* (non-compact) inset must be re-established explicitly now that `Container` defaults to zero instead of Panel's 4px (see ToolBar note in Steps).
- **Header** theme padding: `applyThemePadding()` → `setInsets(new Insets(pad, pad, pad, pad))` from the theme ([`Header.ts:174`](../src/typescript/lib/component/display/Header.ts#L174)), applied only when the caller passed no `insets` ([`Header.ts:70`](../src/typescript/lib/component/display/Header.ts#L70)). **Keep** — Header's inset is theme-driven, not Panel's 4px, and `updatePreferredSize` reads it back ([`Header.ts:163`](../src/typescript/lib/component/display/Header.ts#L163)).

### TabBar already documents relying on `Container` semantics

[`TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) already calls `this.clearInsets()` in its constructor ([`TabBar.ts:567`](../src/typescript/lib/component/container/TabBar.ts#L567)) and its class doc states it relies on `clampsToContentSize() === false` so the strip fills its edge ([`TabBar.ts:450`](../src/typescript/lib/component/container/TabBar.ts#L450)). After migration the top-level `clearInsets()` on `this` is redundant (Container is already zero) and is removed; the `clearInsets()` / `setInsets(0,…)` calls on TabBar's **internal** `_tabClip` / `_toolGroup` / `_leadGroup` (which stay `Panel` — see breakage check) are left untouched. Update the class-doc reference from `Panel.clampsToContentSize()` to `Container.clampsToContentSize()`.

### Header is the one class whose options don't extend `PanelOptions`

`HeaderOptions extends TextOptions` ([`Header.ts:19`](../src/typescript/lib/component/display/Header.ts#L19)), and `TextOptions extends ComponentOptions` ([`Text.ts:14`](../src/typescript/lib/component/input/Text.ts#L14)). So Header never depended on `PanelOptions` at the type level — it used `Panel` only as a fit-parent shell. Its `super(options, { ..._defaultHeaderOptions, tag: "header" } as Partial<TOptions>)` passes `tag`, which lives on `ComponentOptions` ([`Component.ts:106`](../src/typescript/lib/core/Component.ts#L106)), so the `Container` move needs **no** options-interface change for Header — only `extends Panel` → `extends Container` and the import swap. (The existing `as Partial<TOptions>` cast already bridges the field set.)

### TablePanel / TreeTablePanel have no options interface — pure base swap

Both are `class TablePanel extends Panel` / `class TreeTablePanel extends Panel` with **no** generic and **no** `XOptions` interface ([`TablePanel.ts:31`](../src/typescript/lib/component/table/TablePanel.ts#L31), [`TreeTablePanel.ts:38`](../src/typescript/lib/component/table/TreeTablePanel.ts#L38)); their constructors call `super()` with no args. Migration is a single token change (`Panel` → `Container`) plus the import swap. The 4px default they currently inherit silently disappears — confirm in the visual smoke that the docked toolbar (north) and table (center) read correctly flush to the panel edge.

### Higher-stakes overlays go in a separate, independently-landable phase

`Popover` and `AbstractWindow` are core overlays with their own position/lifecycle and are load-bearing. The audit found no scroll dependency, but:

- **Popover** carries an intentional `insets: new Insets(5, 5, 5, 5)` bubble padding ([`Popover.ts:96`](../src/typescript/lib/core/Popover.ts#L96)) — **keep**; it is not Panel's 4px. No autoScroll / scroll-shadow / `getChildHost` calls in its body (verified zero hits). `PopoverOptions extends PanelOptions` → `extends ContainerOptions`, `extends Panel<PopoverOptions>` → `extends Container<PopoverOptions>`.
- **AbstractWindow** is the abstract base for `Window` and `TabWindow`. It calls `this.getInnerSize()` inside its `doLayout` border-sizing math ([`AbstractWindow.ts:1482`](../src/typescript/lib/core/AbstractWindow.ts#L1482)). `getInnerSize` is overridden on `Panel` to subtract the scrollbar gutter ([`Panel.ts:337`](../src/typescript/lib/core/Panel.ts#L337)); losing that override means falling back to `Component.getInnerSize` ([`Component.ts:2264`](../src/typescript/lib/core/Component.ts#L2264)). For a window the gutter is `{right:0, bottom:0}` (windows never set `autoScroll` on themselves — verified: no `setAutoScroll` in the file), so the two return identical values **today** — but this is a real coupling to a Panel-only override, which is exactly why this class is deferred. It also owns its own `_bodyHost` field ([`AbstractWindow.ts:191`](../src/typescript/lib/core/AbstractWindow.ts#L191)) + `findBodyHost()` (definition [`AbstractWindow.ts:1590`](../src/typescript/lib/core/AbstractWindow.ts#L1590)) and folds `getInsets()` into the resize-border thickness inside `doLayout` ([`AbstractWindow.ts:1475-1476`](../src/typescript/lib/core/AbstractWindow.ts#L1475): `(...) + insets.getLeft()` / `+ insets.getTop()`). **Confirmed regression:** `_defaultWindowOptions` ([`AbstractWindow.ts:106-124`](../src/typescript/lib/core/AbstractWindow.ts#L106)) sets `border`/`borderRadius`/`shadow`/… but **no `insets`** — every window currently inherits Panel's 4px, and that 4px feeds the border math above. Dropping to `Container`'s zero insets shifts every window body 4px top/left. So Phase 2 **must add** an explicit `insets: new Insets(4, 4, 4, 4)` to `_defaultWindowOptions` to preserve today's behaviour (see Step 11); this is a prescribed change, not a "verify".

Isolating these two in a clearly-marked Phase 2 lets the implementer ship the eight low-risk chrome strips (Phase 1) without being blocked, and land or hold the overlays independently.

### `callable()` export form is unchanged

Every migrated class already uses the `callable(...)` export tail (`class _X` + `const XCallable = callable(X)` + `export { X as _X, XCallable as X }`). The base-class swap does not touch the tail — `callable` wraps the class regardless of what it extends. Verified present on all ten files. No change needed to any export block; the `callable()` form stays correct.

---

## Public API (TypeScript Signatures)

No new public API. Per-class signature deltas (Phase 1):

```typescript
// display/Header.ts — options interface UNCHANGED (extends TextOptions)
class Header<TOptions extends HeaderOptions = HeaderOptions> extends Container<TOptions> // was extends Panel

// container/AccordionPanel.ts
interface AccordionPanelOptions extends ContainerOptions {…}  // was extends PanelOptions
class AccordionPanel<TOptions extends AccordionPanelOptions = AccordionPanelOptions> extends Container<TOptions>

// container/StatusBar.ts
interface StatusBarOptions extends ContainerOptions {…}       // was extends PanelOptions
class StatusBar extends Container<StatusBarOptions>

// menubar/ToolBar.ts
interface ToolBarOptions extends ContainerOptions {…}         // was extends PanelOptions
class ToolBar<TOptions extends ToolBarOptions = ToolBarOptions> extends Container<TOptions>

// container/TabPanel.ts
interface TabPanelOptions extends ContainerOptions {…}        // was extends PanelOptions
class TabPanel<TOptions extends TabPanelOptions = TabPanelOptions> extends Container<TOptions>

// container/TabBar.ts
interface TabBarOptions extends ContainerOptions {…}          // was extends PanelOptions
class TabBar extends Container<TabBarOptions>

// table/TablePanel.ts — no options interface
class TablePanel extends Container                            // was extends Panel

// table/TreeTablePanel.ts — no options interface
class TreeTablePanel extends Container                        // was extends Panel
```

Phase 2 (deferred):

```typescript
// core/Popover.ts
interface PopoverOptions extends ContainerOptions {…}         // was extends PanelOptions
class Popover extends Container<PopoverOptions> implements DismissableLayer

// core/AbstractWindow.ts
interface WindowOptions extends ContainerOptions {…}          // was extends PanelOptions
abstract class AbstractWindow extends Container<WindowOptions> implements DismissableLayer
```

---

## Critical Breakage Check — `instanceof Panel` / `Panel` type assumptions

Repo-wide audit (`src/typescript`):

- **`instanceof Panel`** — **zero matches** anywhere. No runtime type-narrowing on `Panel` to break.
- **`as Panel` casts** — **zero matches**.
- **`: Panel` parameter/return/field types** — hits, each assessed:
  | Site | Type | Handled? |
  | --- | --- | --- |
  | [`DockRegion.ts:431`](../src/typescript/lib/layout/DockRegion.ts#L431) `newStack(): Container` | Already migrated to `Container` by the `container-base-class` dependency — constructs `new Container({ layoutManager: new Tab(...) })`. Returns a `Container`, not any of the classes this plan migrates. | Unaffected. |
  | [`MiscPanel.ts:1078`,`1112`](../src/typescript/MiscPanel.ts#L1078) `const scrollPanel: Panel = new Panel({...})` | Real `Panel` instances in a demo. | Unaffected. |
  | [`TabBar.ts:465`,`508`,`518`](../src/typescript/lib/component/container/TabBar.ts#L465) `_tabClip / _toolGroup / _leadGroup: Panel = new Panel()` | TabBar's **internal** children, kept as `Panel`. The *outer* `TabBar` migrates; these inner fields stay `Panel` (they are explicitly typed and constructed as `Panel`). | Keep as `Panel`; do not migrate the inner clip/group panels. |
  | [`StatusBar.ts:87`,`88`](../src/typescript/lib/component/container/StatusBar.ts#L87) `_leftZone! / _rightZone!: Panel` | StatusBar's internal zone panels, `new Panel({ insets: 0 })`. | See decision below. |
- **`PanelOptions` used as an external parameter type** — only inside the migrated classes' own `interface XOptions extends PanelOptions` declarations (changed to `ContainerOptions`) and the legitimate `Panel`-keepers (`Popover` in Phase 1 scope only until Phase 2, `Dock`/`WindowOptions`). No third-party consumer takes `PanelOptions` as an argument.

**StatusBar internal zones decision:** the brief frames StatusBar as "constructs internal panels with `insets: 0` — that cleanup becomes redundant." The cleanest behaviour-preserving move is to migrate `_leftZone`/`_rightZone` to `Container` (retyping the two fields `private _leftZone!: Container` etc.) and **drop** their now-redundant `insets: new Insets(0,0,0,0)`. These zones only host an HBox of children — no scroll, no Panel API — so they qualify. This removes the `Insets` import only if no other use remains (the outer `Insets(0,6,0,6)` keeps it; verify before removing the import). If the implementer prefers minimal churn, leaving them as `Panel` is also valid and harmless — but then the `insets: 0` is **not** redundant (Panel still defaults to 4px) and must stay; the redundancy only materialises after the Container retype. The plan's intent (shed redundant inset cleanup) is realised only by migrating the zones, so do that.

No `instanceof`/cast breakage exists; the only type-coupling is the internal `Panel`-typed fields above, all handled by keeping the inner helpers on `Panel` (TabBar) or deliberately retyping (StatusBar zones).

---

## Ordered Implementation Steps

### Phase 1 — Chrome strips (low-risk, land first)

For each file: add `import { Container, ContainerOptions } from "~/core/Container.js";` (omit `ContainerOptions` for the no-options classes), change the `extends` clause, change the `XOptions extends PanelOptions` → `extends ContainerOptions`, and **remove the `Panel` import if no longer referenced** (check for residual `new Panel(...)` or `Panel`-typed fields first — TabBar and StatusBar still use `Panel` internally and keep the import).

1. **`display/Header.ts`** — `extends Panel<TOptions>` → `extends Container<TOptions>` ([L40](../src/typescript/lib/component/display/Header.ts#L40)). `HeaderOptions` is **unchanged** (extends `TextOptions`). Import: swap `import { Panel }` → `import { Container }` (Header has no internal `Panel`). Keep `applyThemePadding` / `updatePreferredSize` inset logic intact.

2. **`container/AccordionPanel.ts`** — `AccordionPanelOptions extends PanelOptions` → `extends ContainerOptions` ([L28](../src/typescript/lib/component/container/AccordionPanel.ts#L28)); `extends Panel<TOptions>` → `extends Container<TOptions>` ([L60](../src/typescript/lib/component/container/AccordionPanel.ts#L60)); import swap `{ Panel, PanelOptions }` → `{ Container, ContainerOptions }`. Update the class-doc line that says "A `Panel` subclass…" ([L38](../src/typescript/lib/component/container/AccordionPanel.ts#L38)) to `Container`.

3. **`container/StatusBar.ts`** — `StatusBarOptions extends PanelOptions` → `extends ContainerOptions` ([L34](../src/typescript/lib/component/container/StatusBar.ts#L34)); `class StatusBar extends Panel<StatusBarOptions>` → `extends Container<StatusBarOptions>` ([L82](../src/typescript/lib/component/container/StatusBar.ts#L82)). **Keep** `_defaultStatusBarOptions.insets = new Insets(0,6,0,6)` ([L53](../src/typescript/lib/component/container/StatusBar.ts#L53)). Migrate internal zones: `private _leftZone!: Panel` / `_rightZone!: Panel` → `Container` ([L87-88](../src/typescript/lib/component/container/StatusBar.ts#L87)); `new Panel({ insets: new Insets(0,0,0,0) })` → `new Container()` (drop the redundant zero-inset) ([L112-113](../src/typescript/lib/component/container/StatusBar.ts#L112)). Import: now needs `Container` and `ContainerOptions`; the `Insets` import stays (outer inset uses it) — verify before any removal. Update class-doc "`StatusBar` extends `Panel`" ([L60](../src/typescript/lib/component/container/StatusBar.ts#L60)) to `Container`.

4. **`menubar/ToolBar.ts`** — `ToolBarOptions extends PanelOptions` → `extends ContainerOptions` ([L38](../src/typescript/lib/component/menubar/ToolBar.ts#L38)); `extends Panel<TOptions>` → `extends Container<TOptions>` ([L102](../src/typescript/lib/component/menubar/ToolBar.ts#L102)); import swap. **Inset: verified migration-safe — no default to add.** `_defaultToolBarOptions` sets `compact: false` ([L62](../src/typescript/lib/component/menubar/ToolBar.ts#L62)), which `applyOptions` merges into `opts` ([L148](../src/typescript/lib/component/menubar/ToolBar.ts#L148)), so the `opts.compact !== undefined` guard at [L151](../src/typescript/lib/component/menubar/ToolBar.ts#L151) is satisfied and `setCompact(false)` runs at construction. `_compact` is `declare private` (runtime `undefined`) at that point, so the `value === this._compact` early-return at [L219-221](../src/typescript/lib/component/menubar/ToolBar.ts#L219) does **not** fire on that first call — the body runs and `setInsets(new Insets(4,4,4,4))` executes explicitly (`inset = value ? 2 : 4`, [L225,228](../src/typescript/lib/component/menubar/ToolBar.ts#L225)). So the non-compact ToolBar sets its own 4px and does not lean on Panel's default; dropping the Panel base changes nothing. The only doc touch is the class-doc line that says it "inherits the standard 4-pixel insets" ([L72-73](../src/typescript/lib/component/menubar/ToolBar.ts#L72)) — reword to say it sets its 4px insets itself (via `setCompact`), since it no longer inherits them.

5. **`container/TabPanel.ts`** — `TabPanelOptions extends PanelOptions` → `extends ContainerOptions` ([L30](../src/typescript/lib/component/container/TabPanel.ts#L30)); `extends Panel<TOptions>` → `extends Container<TOptions>` ([L69](../src/typescript/lib/component/container/TabPanel.ts#L69)); import swap. Update class-doc "A `Panel` subclass…" ([L47](../src/typescript/lib/component/container/TabPanel.ts#L47)) to `Container`.

6. **`table/TablePanel.ts`** — `class TablePanel extends Panel` → `extends Container` ([L31](../src/typescript/lib/component/table/TablePanel.ts#L31)); import swap `{ Panel }` → `{ Container }`. No options interface. Update the class-doc "composite panel" wording only if it names `Panel`.

7. **`table/TreeTablePanel.ts`** — `class TreeTablePanel extends Panel` → `extends Container` ([L38](../src/typescript/lib/component/table/TreeTablePanel.ts#L38)); import swap. No options interface.

8. **`container/TabBar.ts`** — `TabBarOptions extends PanelOptions` → `extends ContainerOptions` ([L122](../src/typescript/lib/component/container/TabBar.ts#L122)); `class TabBar extends Panel<TabBarOptions>` → `extends Container<TabBarOptions>` ([L457](../src/typescript/lib/component/container/TabBar.ts#L457)). **Keep the `Panel` import** — `_tabClip`/`_toolGroup`/`_leadGroup` stay `new Panel()` ([L465,508,518](../src/typescript/lib/component/container/TabBar.ts#L465)). Add `Container`/`ContainerOptions` to the import. Remove the now-redundant top-level `this.clearInsets()` ([L567](../src/typescript/lib/component/container/TabBar.ts#L567)) — Container is zero by default. Leave the internal `_tabClip.clearInsets()` etc. ([L580,590,604](../src/typescript/lib/component/container/TabBar.ts#L580)) untouched (those clear Panel's 4px on the inner panels). Update the class-doc `Panel.clampsToContentSize()` reference ([L450](../src/typescript/lib/component/container/TabBar.ts#L450)) to `Container.clampsToContentSize()`.

9. **Phase 1 regression checkpoints:**
   - `grep -rn "instanceof Panel" src/typescript` → expect zero (was zero; confirm migration introduced none).
   - `grep -n "extends Panel" src/typescript/lib/component/display/Header.ts src/typescript/lib/component/container/AccordionPanel.ts src/typescript/lib/component/container/StatusBar.ts src/typescript/lib/component/menubar/ToolBar.ts src/typescript/lib/component/container/TabPanel.ts src/typescript/lib/component/table/TablePanel.ts src/typescript/lib/component/table/TreeTablePanel.ts src/typescript/lib/component/container/TabBar.ts` → expect zero.
   - `grep -n "extends PanelOptions" <same eight files>` → expect zero.
   - `grep -n "new Panel" src/typescript/lib/component/container/TabBar.ts` → expect three (internal clip/groups, intentionally kept).
   - `npx tsc --noEmit` → 0 errors.

### Phase 2 — Core overlays (deferred; land or hold independently)

10. **`core/Popover.ts`** — `PopoverOptions extends PanelOptions` → `extends ContainerOptions` ([L79](../src/typescript/lib/core/Popover.ts#L79)); `class Popover extends Panel<PopoverOptions>` → `extends Container<PopoverOptions>` ([L139](../src/typescript/lib/core/Popover.ts#L139)); import swap. **Keep** `_defaultPopoverOptions.insets = new Insets(5,5,5,5)` ([L96](../src/typescript/lib/core/Popover.ts#L96)). Update class-doc "`Popover` extends `Panel`" ([L109](../src/typescript/lib/core/Popover.ts#L109)) to `Container`.

11. **`core/AbstractWindow.ts`** — **Required inset fix (do not skip):** `_defaultWindowOptions` ([L106-124](../src/typescript/lib/core/AbstractWindow.ts#L106)) sets no `insets`, so the window inherits Panel's 4px today, and `doLayout` folds `getInsets()` into the resize-border thickness ([L1475-1476](../src/typescript/lib/core/AbstractWindow.ts#L1475)). Migrating to `Container` (zero insets) would shift every window body 4px, so **add `insets: new Insets(4, 4, 4, 4)` to `_defaultWindowOptions`** as part of this step (import `Insets` if not already imported). Then `WindowOptions extends PanelOptions` → `extends ContainerOptions` ([L77](../src/typescript/lib/core/AbstractWindow.ts#L77)); `abstract class AbstractWindow extends Panel<WindowOptions>` → `extends Container<WindowOptions>` ([L152](../src/typescript/lib/core/AbstractWindow.ts#L152)); import swap. The `this.getInnerSize()` call in `doLayout` ([L1482](../src/typescript/lib/core/AbstractWindow.ts#L1482)) now resolves to `Component.getInnerSize` ([L2264](../src/typescript/lib/core/Component.ts#L2264)) — verified the window's `_scrollbarGutter` was always `{0,0}` (no `setAutoScroll` in the file — zero hits) so the result is identical; if a future code path enables window-body scrolling, **abort this class and keep it on `Panel`**, flagging it. `_bodyHost` field ([L191](../src/typescript/lib/core/AbstractWindow.ts#L191)) / `findBodyHost` (definition [L1590](../src/typescript/lib/core/AbstractWindow.ts#L1590)) are AbstractWindow's own members (not Panel's) — unaffected.
   - Update the class-doc "Two concrete subclasses extend it: `Window`… `TabWindow`…" only if it names `Panel`; check `Window.ts`/`TabWindow.ts` still compile (their `extends AbstractWindow` is unaffected, but `WindowOptions` flowing from `ContainerOptions` must still satisfy their option usage — `tsc` is the gate).

12. **Phase 2 regression checkpoints:**
   - `grep -n "extends Panel" src/typescript/lib/core/Popover.ts src/typescript/lib/core/AbstractWindow.ts` → expect zero.
   - `npx tsc --noEmit` → 0 errors (confirms `Window`/`TabWindow` subclasses and every overlay call site still resolve).

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/component/display/Header.ts` (Phase 1) |
| Modify | `src/typescript/lib/component/container/AccordionPanel.ts` (Phase 1) |
| Modify | `src/typescript/lib/component/container/StatusBar.ts` (Phase 1; zones → Container) |
| Modify | `src/typescript/lib/component/menubar/ToolBar.ts` (Phase 1; verify default inset) |
| Modify | `src/typescript/lib/component/container/TabPanel.ts` (Phase 1) |
| Modify | `src/typescript/lib/component/table/TablePanel.ts` (Phase 1) |
| Modify | `src/typescript/lib/component/table/TreeTablePanel.ts` (Phase 1) |
| Modify | `src/typescript/lib/component/container/TabBar.ts` (Phase 1; drop top-level clearInsets) |
| Modify | `src/typescript/lib/core/Popover.ts` (Phase 2) |
| Modify | `src/typescript/lib/core/AbstractWindow.ts` (Phase 2; add explicit `insets: Insets(4,4,4,4)` to `_defaultWindowOptions`) |

No files created or deleted. `PickerColumn.ts` is **not** modified (stays on `Component` with its inner `PickerCellList` on `Panel`).

---

## Verification

- **Typecheck:** `npx tsc --noEmit` after Phase 1 and again after Phase 2 — 0 errors. This is the primary gate: it proves every `extends Container` / `extends ContainerOptions` resolves and that no call site assumed these classes were `Panel`.
- **Grep invariants:** the checkpoints in Steps 9 and 12.
- **Docs build:** `npm run docs:build` — **0 errors and 0 link warnings** (the typedoc "unsupported TypeScript version" notice is the only acceptable warning). Confirms the updated `{@link}` / doc-prose references (`Header`, `AccordionPanel`, `StatusBar`, `TabPanel`, `Popover` class-docs changed from "Panel subclass" to "Container subclass") still resolve, and that the `callable()` promotion still lands each migrated class under `classes/` (not `variables/`).
- **Visual smoke (demo screens), comparing against `master`:**
  - **Window** (Misc / window demos): open a `Window` and a `TabWindow`; the resize-border gutter, header chrome, and body content must render and resize exactly as before — verifies the `AbstractWindow` `getInnerSize`/insets coupling is non-regressive (Phase 2).
  - **ToolBar** (any screen with a toolbar; e.g. table panels' north toolbar): buttons must sit with the same resting spacing as `master` — verifies the default-inset guard in Step 4.
  - **StatusBar** (window/status demos): the strip keeps its 6px L/R inset and the left/right zones butt correctly with no extra gutter.
  - **TablePanel / TreeTablePanel** (Misc slow-table / table demos): toolbar docked north, table filling center, content flush to the panel edge (the lost 4px is the intended change) — confirm no clipped or shifted content.
  - **Tabs** (Tab demo / `TabDemoPanel`): `TabPanel` and `TabBar` strips fill their edge, tab buttons keep their insets, reorder/scroll/close still work — verifies the TabBar `clearInsets` removal and `clampsToContentSize` continuity. Scope DevTools queries to the specific demo class (e.g. `.TabDemoPanel .TabBar`) since many same-type instances coexist.
- **Inset-removal confirmation:** for any class that previously inherited (without clearing) Panel's 4px — Header (theme-padded, so unchanged), TablePanel/TreeTablePanel (no explicit inset, so they *do* lose 4px) — confirm the 4px is gone and the layout still reads correctly.

---

## Documentation Impact

Internal reparenting of existing components — no new exported symbols, no renames, no removals. Per `_shared/docs-conventions.md` this is a refactor, so **no curated doc pages and no sidebar entries** are added or changed.

The only doc-surface touch is in-source JSDoc class-prose that names the parent class: change "A `Panel` subclass…" / "extends `Panel`" to `Container` in `Header`, `AccordionPanel`, `StatusBar`, `TabPanel`, `Popover`, and the `Panel.clampsToContentSize()` reference in `TabBar`. Match each site's existing link style: `Header`/`AccordionPanel`/`StatusBar`/`TabPanel`/`ToolBar` use a markdown `/api/.../Panel` link, while `Popover` uses a `{@link Panel}` tag ([Popover.ts:109](../src/typescript/lib/core/Popover.ts#L109)) — for Popover swap to `{@link Container}` (both classes live in the `core` bucket, so the link resolves). The TypeDoc-generated API pages for these classes pick up the new base automatically. Catalog tables in `docs/` reference the components by name, not by base class, so they need no edits.

---

## Potential Challenges

- **ToolBar resting inset (verified safe):** ToolBar's non-compact state sets its own 4px at construction via `setCompact(false)` (driven by `_defaultToolBarOptions.compact = false`), so dropping Panel's default does **not** shift button spacing — no inset addition needed (see Step 4). Still confirm against `master` in the visual smoke as a backstop.
- **StatusBar zone retype churn:** retyping `_leftZone`/`_rightZone` to `Container` is required to make the `insets: 0` redundancy real; skipping it leaves the inset cleanup unfulfilled. Mitigation: do the retype; it is a pure fit-parent host with no Panel API.
- **AbstractWindow body-inset regression (Phase 2, must-fix):** `_defaultWindowOptions` sets no `insets`, so the window inherits Panel's 4px and `doLayout` folds it into the resize-border math. Migrating to Container's zero insets shifts every window body 4px unless an explicit `insets: new Insets(4,4,4,4)` is added to `_defaultWindowOptions`. Mitigation: Step 11 prescribes the addition (not optional); verify the window demos against `master`.
- **AbstractWindow `getInnerSize` coupling:** the call falls back from Panel's gutter-aware override to Component's plain inner size. Today identical (no window self-scroll), but a future window-body-scroll feature would diverge. Mitigation: deferred Phase 2 + the explicit "abort and keep on Panel if any window-scroll path exists" instruction in Step 11.
- **Stale `Panel` import after swap:** removing the base leaves an unused `Panel` import in classes with no internal `Panel` (Header, AccordionPanel, ToolBar, TabPanel, TablePanel, TreeTablePanel). Mitigation: `tsc`/lint flags unused imports; TabBar and StatusBar keep the import (internal `Panel` usage).
- **Dependency ordering:** the `container-base-class` dependency has **landed** (`Container.ts` + barrel export + `Panel extends Container` are on disk), so this plan is ready to implement. The `depends-on` frontmatter records the relationship for provenance.

---

## Critical Files

- [`plans/implemented/container-base-class.md`](implemented/container-base-class.md) — the landed dependency: defines `Container`, `ContainerOptions`, the moved `clampsToContentSize`, and `Panel extends Container`. [`Container.ts`](../src/typescript/lib/core/Container.ts) is on disk — read it to confirm the zero-field / zero-inset / `clampsToContentSize()===false` contract this plan relies on.
- [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts) — the base being shed: `getInnerSize` gutter override ([L337](../src/typescript/lib/core/Panel.ts#L337)), `setAutoScroll` stack ([L217](../src/typescript/lib/core/Panel.ts#L217)), `_defaultPanelOptions` 4px ([L99](../src/typescript/lib/core/Panel.ts#L99)) — confirms what each migrated class is no longer inheriting.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `getInnerSize` base ([L2264](../src/typescript/lib/core/Component.ts#L2264)), zero-inset default, `tag` option ([L106](../src/typescript/lib/core/Component.ts#L106)), `setLayoutManager`.
- [`src/typescript/lib/component/container/StatusBar.ts`](../src/typescript/lib/component/container/StatusBar.ts) — intentional outer inset + redundant zone insets.
- [`src/typescript/lib/component/menubar/ToolBar.ts`](../src/typescript/lib/component/menubar/ToolBar.ts) — compact-inset toggle; the resting-inset risk.
- [`src/typescript/lib/component/container/TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) — already `clearInsets()` + documents `clampsToContentSize`; internal `Panel` children kept.
- [`src/typescript/lib/core/AbstractWindow.ts`](../src/typescript/lib/core/AbstractWindow.ts) — Phase 2 overlay with `getInnerSize`/`_bodyHost`/border-inset coupling.
- [`src/typescript/lib/component/input/PickerColumn.ts`](../src/typescript/lib/component/input/PickerColumn.ts) — the keep-on-Panel reference (its `PickerCellList` uses `autoScroll: "y"`).

---

## Non-Goals

- **`PickerColumn` migration.** `PickerColumn` itself already `extends Component` ([`PickerColumn.ts:251`](../src/typescript/lib/component/input/PickerColumn.ts#L251)); its inner `PickerCellList extends Panel` with `autoScroll: "y"` ([`PickerColumn.ts:83`,`92`](../src/typescript/lib/component/input/PickerColumn.ts#L83)) and depends on Panel's native scrolling. It **stays on `Panel`** — documented here so a future sweep does not retry it.
- **`Dock`'s structural panels.** Handled by the `container-base-class` plan, not here.
- **TabBar / StatusBar internal helper panels beyond what's stated.** TabBar's `_tabClip`/`_toolGroup`/`_leadGroup` stay `Panel` (only the outer class migrates); StatusBar's zones migrate to `Container` deliberately, but no other internal restructuring.
- **New curated docs pages or sidebar entries** for these existing components — internal refactor, generated API pages suffice.
- **Adding options or setters to any migrated class.** Pure base-class swap; behaviour-preserving except the intended 4px removal.
- **Changing `Window` / `TabWindow` subclasses** beyond what `tsc` requires from `WindowOptions` now extending `ContainerOptions`.
