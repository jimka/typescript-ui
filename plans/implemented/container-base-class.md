# Container Base Class — Implementation Plan

## Overview

Introduce a new `Container` station between [`Component`](../src/typescript/lib/core/Component.ts) and [`Panel`](../src/typescript/lib/core/Panel.ts) to stop accidental inset compounding in layout-heavy trees. `Container` is a `Component` that fits its parent's allocation (`clampsToContentSize() === false`, moved **down** from `Panel`) and keeps the inherited **zero** default insets — no autoScroll, no body-host, no scroll-shadow machinery. `Panel` then `extends Container`, contributing only the `Insets(4,4,4,4)` content-padding default and the full autoScroll / scrollbar-gutter / scroll-shadow stack it already owns.

The 4px perimeter is the right default for a *content* panel (one holding real widgets) but wrong for the *structural* panels that merely place other regions: in [`Dock`](../src/typescript/lib/core/Dock.ts) the chain `Split region → Tab region → identity frame → content` stacks ≈16px of dead inset, which also tensions with the project's "no cosmetic padding" guideline. The fix migrates `Dock`'s own structural panels — [`newTabRegion`](../src/typescript/lib/core/Dock.ts#L354), the `Split` region in [`compileLayout`](../src/typescript/lib/core/Dock.ts#L367), and the identity frame in [`resolvePanel`](../src/typescript/lib/core/Dock.ts#L248) — from `Panel` to `Container`. The same swap applies to the regions [`DockRegion`](../src/typescript/lib/layout/DockRegion.ts) mints at **runtime** — its `newStack` tab stack and the `splitOnEdge` wrap — so a region created by *dragging* (split / tab) matches an initial one (zero-inset) instead of re-adding a 4px ring on every rearrange. Finally `Dock` itself becomes a `Container`: it is a structural `Fit` host (never scrolls — its `Container` regions fill it) that should fill its slot flush, so it sheds `Panel`'s 4px outer ring and unused scroll stack and uses no `Panel`-only API.

New code lives in `src/typescript/lib/core/Container.ts`, exported from the core barrel [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts). `Panel.ts`, `Dock.ts`, `DockRegion.ts`, and the `MiscPanel.ts` Dock demo change. Backward-compatible: every existing `new Panel(...)` keeps its 4px.

---

## Architecture Decisions

### `Container` owns fit-parent, `Panel` owns padding + scroll

The split is mechanical and verified against the live code. Only two things currently on `Panel` are actually fit-parent concerns and move down:

1. `clampsToContentSize(): boolean { return false }` — currently [`Panel.ts:298`](../src/typescript/lib/core/Panel.ts#L298). It moves to `Container`. `Panel` no longer overrides it (inherits `false` from `Container`).
2. The fit-parent *semantics* documented there. `Container` gets the JSDoc; `Panel`'s removed override leaves no behavioural gap because `Panel extends Container`.

Everything else stays on `Panel`: the `Insets(4,4,4,4)` default ([`_defaultPanelOptions`](../src/typescript/lib/core/Panel.ts#L97)), `AutoScrollMode` + `setAutoScroll` / `getAutoScroll` / `clearAutoScroll` / `setLayoutManager` override / `getInnerSize` override / `doLayout` override / `init` / `destructor`, the scrollbar-gutter cache, and the entire scroll-shadow subsystem. None of that is fit-parent; it is content-panel behaviour.

`Container` adds **nothing** beyond the `clampsToContentSize` override — it does not even override `applyOptions`, because every option it supports (`layoutManager`, `id`, `name`, `components`, `insets`, `padding`, …) is already a `ComponentOptions` field dispatched by `Component.applyOptions`. `Container` is a *typed subclass marker* that flips one protected method.

### Scrolling stays on `Panel`, not `Container`

Scroll belongs to a fit-parent class — a content-sized `Component` can never overflow, so there is nothing to scroll — which makes `Container` and `Panel` its only valid homes. It stays on `Panel`. The conceptual pull toward `Container` is real (overflow handling, clip vs scroll, is the direct consequence of fit-parent sizing), but every current scrolling surface also wants `Panel`'s 4px padding, while the dock's structural `Container` regions must *not* scroll — so the existing bundling matches every actual use case, and `Container` stays the thin, low-risk marker this plan intends rather than absorbing the sizeable scroll stack (`AutoScrollMode`, the `getInnerSize` / `doLayout` overrides, the scrollbar-gutter cache, the scroll-shadow subsystem, `init` / `destructor`). The decision is cheaply reversible: pushing scroll down to `Container` later is backward-compatible — `Panel` keeps it by inheritance, and `Container`'s `autoScroll` would default off, so existing structural regions are unaffected. Revisit only when a genuine zero-inset scrolling region appears; the telltale is the first `new Panel({ insets: 0, autoScroll: … })` call site (the same "Panel with insets:0" workaround `Container` exists to remove).

### `Component` already implements the container machinery

The "layout manager + children + insets + childHost" machinery the user's brief mentions already lives entirely on `Component`, not `Panel`: [`setLayoutManager`/`getLayoutManager`](../src/typescript/lib/core/Component.ts#L4087), [`addComponent`/`addComponents`](../src/typescript/lib/core/Component.ts#L3785), the private [`getChildHost`](../src/typescript/lib/core/Component.ts#L854), [`getInsets`/`setInsets`](../src/typescript/lib/core/Component.ts#L1319), and the [`Absolute` default layout manager](../src/typescript/lib/core/Component.ts#L340). So `Container` does not *add* container mechanics — it only narrows the size policy. This is consistent with the brief's "a `Component` that supports a layout manager + children": `Component` already does. `Container`'s distinct value is `clampsToContentSize === false` + a name structural sites can target.

### `Container` keeps Component's zero insets — by doing nothing

`Component`'s default bag already seeds `insets: new Insets(0, 0, 0, 0)` ([`Component.ts:342`](../src/typescript/lib/core/Component.ts#L342)). `Container` passes no `insets` in its subclass-defaults, so it inherits zero. Only `Panel` layers `Insets(4,4,4,4)` on top via its `_defaultPanelOptions`. No new inset code is needed anywhere.

### Callable export, mirroring `Panel`

`Container` uses the same `callable(...)` idiom as every core class: a real `class _Container` declaration wrapped by `const ContainerCallable = callable(_Container)`, exported as `{ _Container, ContainerCallable as Container }` plus the companion `type ContainerCallable`. This is what the `typedoc-callable-plugin` promotes from `variables/` to `classes/`. `Panel` is the closest template — its tail uses the same **generic** `type PanelCallable<TOptions…> = Panel<TOptions>` form ([`Panel.ts:682`](../src/typescript/lib/core/Panel.ts#L682)); [`Drawer.ts`](../src/typescript/lib/core/Drawer.ts) applies the same idiom non-generically.

### Generic `TOptions` parameter so `Panel` can extend it

`Panel` is `class Panel<TOptions extends PanelOptions = PanelOptions> extends Component<TOptions>`. For `Panel` to extend `Container` without changing its own generic, `Container` must be `class Container<TOptions extends ContainerOptions = ContainerOptions> extends Component<TOptions>`, and `PanelOptions extends ContainerOptions`. `Panel` then becomes `extends Container<TOptions>`. The constructor's `super(options, { ..._defaultPanelOptions, ...subclassDefaults } )` keeps working because `Container` declares no constructor — its implicit constructor forwards all arguments to `Component` unchanged.

### `ContainerOptions` is a thin alias of `ComponentOptions`

`Container` adds no new option fields (it adds no setters). `ContainerOptions` therefore extends `ComponentOptions` with no new members — declared explicitly (not a bare type alias) so it is a stable extension point for future structural-container options and so `PanelOptions extends ContainerOptions` reads naturally. This matches the codebase habit of every class shipping its own `XOptions` interface.

### Identity frame becomes a `Container`; caller content keeps its own padding

The `resolvePanel` identity frame ([`Dock.ts:260`](../src/typescript/lib/core/Dock.ts#L260)) is structural — it exists only to carry the stable `id`/`name` and a `Fit` layout around the caller's content. It needs no scroll and no perimeter of its own; the caller's content component supplies whatever padding it wants. So the frame switches to `Container`, removing one 4px ring per docked panel. Its `getId()`-keyed serialization is unaffected: `Container` accepts `{ id, name, layoutManager }` (all `ComponentOptions`) and `Component.setId` re-points the `#id`-scoped style rule exactly as it does for `Panel` ([`Component.ts:1080`](../src/typescript/lib/core/Component.ts#L1080)). The frame is still the serialization leaf.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/core/Container.ts

/**
 * Construction-time options for {@link Container}. Adds no fields over
 * {@link ComponentOptions}; declared as a named extension point for
 * structural containers and so {@link PanelOptions} can extend it.
 *
 * @category Core
 */
export interface ContainerOptions extends ComponentOptions {}

/**
 * A fit-parent, zero-inset, no-scroll {@link Component} with a layout
 * manager and children. (full JSDoc — see Internal Structure)
 *
 * @category Core
 */
class Container<TOptions extends ContainerOptions = ContainerOptions> extends Component<TOptions> {
    protected clampsToContentSize(): boolean;   // returns false
}

const ContainerCallable = callable(Container);
type ContainerCallable<TOptions extends ContainerOptions = ContainerOptions> = Container<TOptions>;
export {
    Container         as _Container,
    ContainerCallable as Container,
};
```

```typescript
// src/typescript/lib/core/Panel.ts (changed signature only)

export interface PanelOptions extends ContainerOptions {   // was: extends ComponentOptions
    tag?:           string;
    autoScroll?:    AutoScrollMode;
    scrollShadows?: boolean;
}

class Panel<TOptions extends PanelOptions = PanelOptions> extends Container<TOptions> {
    // clampsToContentSize() override DELETED — inherited from Container.
    // Everything else unchanged.
}
```

No new DOM property, no new typed setter, no new backing field — `Container` adds only the `clampsToContentSize` policy flip.

---

## Internal Structure

`Container.ts` is small. Skeleton (full JSDoc written at implementation time, modelled on `Panel`'s class-doc and the `clampsToContentSize` doc-block currently at [`Panel.ts:287`](../src/typescript/lib/core/Panel.ts#L287)):

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { callable } from "~/core/Callable.js";

export interface ContainerOptions extends ComponentOptions {}

class Container<TOptions extends ContainerOptions = ContainerOptions> extends Component<TOptions> {
    protected clampsToContentSize(): boolean {
        return false;
    }
}

const ContainerCallable = callable(Container);
type ContainerCallable<TOptions extends ContainerOptions = ContainerOptions> = Container<TOptions>;
export {
    Container         as _Container,
    ContainerCallable as Container,
};
```

Class-doc must state: fits the parent's allocated rect (does not inflate to content size); zero default insets (inherited from `Component`); no autoScroll / scroll-shadow machinery — for those, use `Panel`; relationship to `Component` (adds the fit-parent size policy) and `Panel` (a `Container` that adds 4px content padding + native scrolling). Import note: keep the `.js` extension on the import specifier (codebase convention — Panel imports `~/core/Component`, the verbatim string there omits `.js` but `index.ts` and `Drawer.ts` use `.js`; match `Drawer.ts`'s `.js` form for a new file).

---

## Ordered Implementation Steps

1. **Create `src/typescript/lib/core/Container.ts`** with the skeleton above and full JSDoc on the class and `clampsToContentSize`. Add `@category Core` to both the class and `ContainerOptions`.

2. **Export from the core barrel** [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts): after the `Component` lines (≈L12) and before the `Panel` lines (L13), add
   `export { Container } from '~/core/Container.js';`
   `export type { ContainerOptions } from '~/core/Container.js';`

3. **Reparent `Panel`** in [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts):
   - Replace `import { Component, ComponentOptions } from "~/core/Component"` with `import { Container, ContainerOptions } from "~/core/Container.js";`. After reparenting, `Component`/`ComponentOptions` are no longer referenced in *code* (only in JSDoc `{@link}` / markdown links, which `noUnusedLocals` does not count), so the old import must be removed or typecheck fails; `{@link Component}` still resolves by name in TypeDoc without it.
   - Change `export interface PanelOptions extends ComponentOptions` → `extends ContainerOptions` (L72).
   - Change `class Panel<...> extends Component<TOptions>` → `extends Container<TOptions>` (L115).
   - **Delete** the `clampsToContentSize()` override and its doc-block (L287–L300) — now inherited from `Container`. Verify no other Panel member calls `super.clampsToContentSize()` (it does not).
   - Leave `_defaultPanelOptions`, `applyOptions`, all autoScroll/gutter/shadow members untouched.

4. **Migrate the dock's structural panels** in [`src/typescript/lib/core/Dock.ts`](../src/typescript/lib/core/Dock.ts):
   - Switch `Dock` itself to `Container`: replace the `Panel`/`PanelOptions` import with `import { Container, ContainerOptions } from "~/core/Container.js";`, change `class Dock extends Panel<DockOptions>` → `extends Container<DockOptions>` and `DockOptions extends PanelOptions` → `extends ContainerOptions`, and retarget the three "a `Panel` carrying…" region JSDocs to "`Container`". The `super(options, { layoutManager: new Fit(), ...subclassDefaults })` call is unchanged — `Container` inherits `Component`'s `(options, defaultOptions)` constructor. `Dock` is a structural `Fit` host that never scrolls and wants no 4px outer ring, and uses no `Panel`-only API.
   - `newTabRegion` (L355): `new Panel({ layoutManager: new Tab() })` → `new Container({ layoutManager: new Tab() })`.
   - `compileLayout` Split branch (L369): `new Panel({ layoutManager: new Split(...) })` → `new Container({ layoutManager: new Split(...) })`.
   - `resolvePanel` identity frame (L260): `new Panel({ id, name, layoutManager: new Fit() })` → `new Container({ id: spec.id, name: spec.title, layoutManager: new Fit() })`. Update the surrounding JSDoc that says "The frame is a `Panel` constructed with…" (L235) to "`Container`".
   - Local variable types stay `Component` (every site already returns/stores `Component`), so no signature churn. `regionKind`/`isRegionContainer` discriminate on the layout manager's class name, not on `Panel`/`Container`, so region detection is unaffected.
   - Then the **runtime-minted** regions in [`src/typescript/lib/layout/DockRegion.ts`](../src/typescript/lib/layout/DockRegion.ts), so drag-created regions match the initial ones: `newStack` (the `new Panel({ layoutManager: new Tab({ reorderable: true }) })`) and the `splitOnEdge` wrap (`new Panel({ layoutManager: new Split(...) })`) → `new Container(...)`. Replace the now-unused `Panel` import with `Container`, and change `newStack`'s return type from `Panel` to `Container` (only `Component`-level methods — `getLayoutManager`, `moveComponent` — are called on these stacks, so nothing else shifts).

5. **Update the Dock demo** in [`src/typescript/MiscPanel.ts`](../src/typescript/MiscPanel.ts). The visible inset reduction is **automatic** once `Dock`'s structural panels become `Container` (step 4) — the demo needs no change for the improvement to appear. One optional idiom cleanup: the window body host `body` ([`MiscPanel.ts:673`](../src/typescript/MiscPanel.ts#L673)) is `new Panel({ layoutManager: new Border(), insets: new Insets(0, 0, 0, 0) })` — it works around `Panel`'s 4px default with an explicit zero-insets override, exactly the idiom `Container` removes. Swap it to `new Container({ layoutManager: new Border() })` and drop the now-redundant `insets` (Container defaults to zero). Keep the `Insets` import — it is still used elsewhere in the file. This is behaviour-neutral (the host was already zero-inset) — it just models the intended idiom. **Leave the per-leaf content host** in the `dockPanel(text)` factory ([`MiscPanel.ts:636`](../src/typescript/MiscPanel.ts#L636), `new Panel({ layoutManager: new Fit() })` wrapping a `Text`) **as a `Panel`** — it is caller content and must keep its 4px. Do **not** touch the content panels.

6. **Regression checkpoints** (run after edits):
   - `grep -n "extends Component" src/typescript/lib/core/Panel.ts` → expect zero matches (now extends Container).
   - `grep -n "clampsToContentSize" src/typescript/lib/core/Panel.ts` → expect zero matches.
   - `grep -n "clampsToContentSize" src/typescript/lib/core/Container.ts` → expect one match (the override).
   - `grep -rn "new Panel(" src/typescript/lib/core/Dock.ts` → expect zero matches (all migrated to `Container`).
   - `grep -rn "new Panel(" src/typescript/lib/layout/DockRegion.ts` → expect zero matches (runtime stacks migrated to `Container`).

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Create | `src/typescript/lib/core/Container.ts` |
| Modify | `src/typescript/lib/core/index.ts` (barrel export) |
| Modify | `src/typescript/lib/core/Panel.ts` (reparent to `Container`, drop `clampsToContentSize`) |
| Modify | `src/typescript/lib/core/Dock.ts` (`Dock` → `Container`, structural panels → `Container`, frame JSDoc) |
| Modify | `src/typescript/lib/layout/DockRegion.ts` (runtime `newStack` / `splitOnEdge` regions → `Container`) |
| Modify | `src/typescript/MiscPanel.ts` *(optional)* — Dock demo `body` host → `Container`, drop `insets:0` |
| Modify | `docs/components/index.md` (catalog Core row for `Container`) |
| Modify | `src/typescript/lib/core/Component.ts` *(doc-only, optional)* — the `clampsToContentSize` doc-block at L2592 names `Panel` as the override; extend it to read "`Container` (and thus `Panel`)" |
| Modify | `src/typescript/lib/component/container/TabBar.ts` *(doc-only, optional)* — class JSDoc at L450 says "`Panel.clampsToContentSize()` is `false`" (still true via inheritance); reword to "`Container.clampsToContentSize()` (inherited by `Panel`)" for precision |

---

## Verification

- **Typecheck:** `npx tsc --noEmit` (or the project's typecheck script) — 0 errors. Confirms `Panel extends Container<TOptions>` and `PanelOptions extends ContainerOptions` resolve and that no caller broke.
- **Grep invariants:** the four checkpoints in step 6.
- **Docs build:** `npm run docs:build` — **0 errors and 0 link warnings** (the typedoc "unsupported TypeScript version" notice is the only acceptable warning). Confirm `Container` lands under `docs/api/core/classes/Container` (not `variables/`) — proves the callable-plugin promotion worked.
- **Visual smoke (Misc screen Dock demo):** run the app (`npm run dev`, http://localhost:8015), open the Misc screen, click **"Dockable layout (Dock)"**. Confirm the docked panels' content now sits flush against the region borders (no compounding ≈16px gutter at `Split → Tab → frame`), while each panel's *own* content keeps its intended padding. Scope DevTools queries to the dock window's class — many `Panel`/`Container` instances coexist on the page. Compare against `master` to see the inset reduction.
- **Panel-unchanged check:** on the same screen, the ordinary content `Panel`s (e.g. `leftColumn`/`rightColumn` at [`MiscPanel.ts:158`](../src/typescript/MiscPanel.ts#L158), `autoScroll: 'auto'`) must still show their 4px inset and still scroll with edge shadows — proves the `Panel` behaviour split is non-regressive.

---

## Documentation Impact

- **Barrel:** `Container` + `ContainerOptions` re-exported from the per-subpath core barrel `src/typescript/lib/core/index.ts` (step 2). There is no root barrel. `@category Core` on the class and the options interface.
- **API page:** `Container` is a *base class* (like `Component`, `BaseObject`, `Panel`), which in this repo are documented by their **TypeDoc-generated** pages at `/api/core/classes/Container`, not by a curated `docs/components/*.md` page. So **no curated page and no `docs/.vitepress/config.mts` sidebar entry are required** — match how `Component` and `Panel` are handled (neither has a curated page: `Component` has a catalog row, `Panel` has none and appears only as a link target inside other rows). Adding a curated page would be inconsistent with the sibling base classes; omit it.
- **Catalog:** add one Core-table row to `docs/components/index.md` (after the `Component`/`BaseObject`/`Body` rows, ≈L13):
  `| [\`Container\`](/api/core/classes/Container) | Fit-parent, zero-inset, no-scroll base for structural containers; `Panel` adds 4px padding + scrolling |`
- **Relate to Panel/Component:** the `Container` class JSDoc must cross-link both — `Container` adds the fit-parent size policy to `Component`; `Panel` is a `Container` that adds the 4px content inset and native scrolling. Use `{@link Component}` / `{@link Panel}` (same `core` bucket, so intra-bucket links resolve). Update the `Panel` class-doc opening line ([`Panel.ts:103`](../src/typescript/lib/core/Panel.ts#L103)) from "A `Component` subclass…" to "A {@link Container} subclass…" so the inheritance chain reads correctly in docs.
- **No cross-bucket links needed** — every reference is within `core`.

---

## Potential Challenges

- **Class-field super-cascade trap:** none introduced — `Container` declares no fields and no initialisers, and `Panel`'s existing `declare`d fields + `applyOptions` seeding are untouched. The reparent does not change *when* `Panel`'s setters fire (still leaf-first `applyOptions` chaining up through `Container.applyOptions` → `Component.applyOptions`, and `Container` has no `applyOptions` so the chain is byte-identical to today).
- **`super.applyOptions` chain:** `Panel.applyOptions` calls `super.applyOptions(options)`. With `Container` having no override, that resolves to `Component.applyOptions` exactly as before — verify no behavioural change by checking `Panel`'s scroll/inset options still apply in the visual smoke test.
- **Unused-import after reparent:** `extends Component` and `PanelOptions extends ComponentOptions` are the only *code* uses of `Panel.ts`'s `Component`/`ComponentOptions` import; once both switch to `Container`/`ContainerOptions`, the old import is unused and `noUnusedLocals` (tsconfig.json) fails the build — so it must be removed, not kept. Use `.js` on the new `Container` imports in `Container.ts`/`Panel.ts`/`Dock.ts`/`index.ts` to match the barrel convention (`index.ts`/`Drawer.ts` use `.js`).
- **Identity-frame regression risk:** if the frame's `Fit` child (caller content) was visually relying on the frame's 4px, removing it could make content touch the region edge. Mitigation: that 4px was accidental compounding (the brief's core complaint); the caller content owns its own padding. Confirm in the visual smoke test that real content still reads correctly.

---

## Critical Files

- [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts) — the class being reparented; read the `_defaultPanelOptions` (L97), `applyOptions` seeding (L162), `clampsToContentSize` (L287–300, being deleted), and the export tail (L682).
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — base class: `clampsToContentSize` default + `clampWidth`/`clampHeight` (L2592–2700), zero-inset default (L342), `setId` style-rule re-point (L1080), `getChildHost`/`addComponent` (L854, L3785), `setLayoutManager` (L4096).
- [`src/typescript/lib/core/Dock.ts`](../src/typescript/lib/core/Dock.ts) — `resolvePanel` (L248), `newTabRegion` (L354), `compileLayout` (L367), `regionKind`/`isRegionContainer` (L622, L597).
- [`src/typescript/lib/core/Drawer.ts`](../src/typescript/lib/core/Drawer.ts) — a non-generic example of the `callable(...)` export-tail idiom (`Panel` above is the generic template to mirror).
- [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts) — barrel; insert Container exports near the Component/Panel block.
- [`src/typescript/MiscPanel.ts`](../src/typescript/MiscPanel.ts) — Dock demo (L628–680): the `body` host (L673) and the per-leaf content host in `dockPanel` (L636), for the visual verification.

---

## Non-Goals

- **Reparenting chrome components off `Panel` onto `Container`** (`display/Header`, `StatusBar`, `ToolBar`, `TabBar`, `AccordionPanel`, `PickerColumn`, and any other `Panel` subclass that is structurally a non-scrolling container). That is a separate follow-up plan gated on a usage audit — each chrome class must be checked for whether it actually relies on `Panel`'s 4px or scroll machinery before it can move. This plan adds `Container`, reparents `Panel`, and migrates only `Dock`'s own structural panels.
- **Adding new options or setters to `Container`.** It is intentionally a size-policy marker over `Component`; speculative structural-container configuration is out (simplicity-first).
- **Changing any existing `new Panel(...)` content site** outside the `Dock`/`MiscPanel` structural panels named above. All content panels keep their 4px (backward compatibility).
- **A curated `docs/components/Container.md` page or sidebar entry** — base classes in this repo use only their generated API page; see Documentation Impact.
