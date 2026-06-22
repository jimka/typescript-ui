# Core → Overlay Tier Split — Implementation Plan

## Overview

`src/typescript/lib/core/` currently holds two distinct tiers in one folder: the genuine framework **kernel** (`Component`, `Container`, `Panel`, `Event`, `DOM`, `Theme`, `LayerManager`, `Body`, `AnimatedDropdown`, `Binding`, `StyleTarget`, the `BaseObject`/`Callable`/`Util` primitives, …) and a tier of top-level **overlay/shell components** that depend *downward* on `src/typescript/lib/component/` — windows, dialogs, menus, popovers, notifications, tooltips, drawers, rails, the dock, and the drag-and-drop overlay subsystem. That downward edge inverts the expected layering (kernel must not import widgets).

This plan moves the overlay tier into a new sibling folder `src/typescript/lib/overlay/`, leaving `core/` as a true kernel. It is a **pure file-move + import-rewrite refactor — no behavior changes**. The moved files keep their names, their `callable()` wrapping, and every cross-reference; only their folder and module specifiers change (`~/core/X.js` → `~/overlay/X.js`).

Two facts shrink the blast radius dramatically (verified, see *Architecture Decisions*): (1) **no code anywhere in the repo imports the bare `~/core` barrel** ([`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts)) — every consumer uses deep `~/core/X.js` paths, so the move is a mechanical specifier rewrite, not a barrel-surface change; (2) after the move, **zero staying-kernel file imports any moving symbol** — the tier split is clean with no residual inversion.

---

## Architecture Decisions

### The decisive criterion — a file moves iff it is part of the overlay tier that depends downward on `component/`

A `core/` file belongs in `overlay/` when it is a top-level shell/overlay component that (directly or transitively) imports from `~/component/`, and is consumed *upward* by `component/`, `layout/`, `validation/`, or the app — never by genuine kernel files. A file *stays* in `core/` when it has no `~/component/` import and is imported broadly as infrastructure.

Verified with `grep -E "from ['\"]~/component"` over every `core/*.ts` and `core/component/*.ts`, cross-checked against importer maps.

### Files that MOVE to `overlay/`

**Top-level overlay components (each directly imports `~/component/`):**

| File | Rationale |
|---|---|
| `AbstractWindow.ts` | Imports `~/component/`; abstract base for `Window`/`TabWindow`. Imported by `Window`, `TabWindow`, `Rail`, `Dock` (all overlay) and by `layout/Tab.ts`, `layout/DockRegion.ts`, `layout/LayoutSerialization.ts` (upward). |
| `Window.ts` | Imports `~/component/`; extends `AbstractWindow`. |
| `TabWindow.ts` | Imports `~/component/`; extends `AbstractWindow`, imports `windowControls`. |
| `Dialog.ts` | Imports `~/component/`. |
| `Menu.ts` | Imports `~/component/`; extends `AnimatedDropdown` (stays in core — upward edge, fine). |
| `Popover.ts` | Imports `~/component/`; extends `AnimatedDropdown`. |
| `Notification.ts` | Imports `~/component/`; imports `Dialog` (overlay). |
| `Tooltip.ts` | Imports `~/component/`; consumed by `component/button`, `component/table`, `validation`. |
| `Drawer.ts` | Imports `~/component/`. |
| `Rail.ts` | Imports `~/component/`; imports `AbstractWindow`, `Drawer`, `RailHandle` (all overlay). |
| `RailHandle.ts` | Imports `~/component/`. |
| `ButtonGroup.ts` | Imports `~/component/`. |
| `windowControls.ts` | Imports `~/component/`; used by `TabWindow`. |
| `Dock.ts` | Imports `~/component/` and `AbstractWindow`/`TabWindow`/`DropZoneOverlay`; imported only by `core/index.ts`. |

**Drag-and-drop overlay subsystem (moves as one cohesive unit):**

| File | Rationale |
|---|---|
| `DragManager.ts` | Currently in `core/` root. Orchestrates the drag overlays; module-level `import`s and `new`s `DragGhost`/`DragFeedback`/`ReorderIndicator`. **No genuine kernel file imports it** — only `Window`, `Dock` (overlay) inside `core/`, plus `layout/`, `component/table`, `component/container` (upward consumers). It is a drag *service*, not a primitive. |
| `component/DragGhost.ts` | Imports `~/component/input/Text.js` — the single direct downward edge that proves the whole subsystem is overlay. |
| `component/DragFeedback.ts` | Drag overlay (imports only kernel + primitive); cohesive with the subsystem. |
| `component/DropZoneOverlay.ts` | Drag overlay; imported by `Dock` (overlay) and `layout/DockRegion.ts` (upward). |
| `component/ReorderIndicator.ts` | Drag overlay; `new`d by `DragManager`. |

**Why the whole drag subsystem moves together (not just `DragGhost`):** `DragManager` already depends transitively on `~/component/` *today* (via `DragGhost`), so the inversion exists inside `core/` right now. If only `DragGhost` moved, `core/DragManager` → `overlay/DragGhost` would become a *fresh, explicit* core→overlay edge — a worse state. Moving `DragManager` plus all four drag overlays as a unit eliminates the inversion entirely and keeps the subsystem's tight internal coupling in one place. `DragFeedback`/`DropZoneOverlay`/`ReorderIndicator` import only kernel + primitive, so they could technically stay, but splitting the subsystem across the tier boundary would re-create the inversion at the `DragManager` import line; cohesion wins.

### Files that STAY in `core/` (kernel) — explicit tier assignment for every borderline candidate

| File | Decision | Rationale |
|---|---|---|
| `AnimatedDropdown.ts` | **STAY** | No `~/component/` import (imports only `Animation`, `Callable`, `Component`, `DOM`, `LayerManager`, `primitive/Position`). Base class for `Menu`/`Popover` (overlay) and for `component/input` pickers — its consumers are *above* it. Moving it would force every picker dropdown in `component/input` to import `~/overlay/`, and it is genuine portaled-layer infrastructure. |
| `LayerManager.ts` | **STAY** | No `~/component/` import. Kernel layer registry; imported by the entire overlay tier and by `component/table/cell/editor`. The "opened-from" layer tree is core infrastructure. |
| `Body.ts` | **STAY** | No `~/component/` import; singleton bootstrap wrapping `document.body`. |
| `Panel.ts` | **STAY** | No `~/component/` import; `Container` subclass that is a fundamental base for most components. Kernel. |
| `Container.ts`, `Component.ts`, `BaseObject.ts`, `Callable.ts`, `Event.ts`, `ListenerBag.ts`, `DOM.ts`, `Util.ts`, `Aria.ts`, `RovingTabIndex.ts`, `Animation.ts`, `SmoothScroller.ts`, `StyleTarget.ts`, `Theme.ts`, `Type.ts`, `Bindable.ts`, `Binding.ts` | **STAY** | Pure kernel primitives/infrastructure; no `~/component/` dependency. |
| `themes/`, `fontsource.d.ts` | **STAY** | Theme assets + ambient types belong with the kernel `Theme.ts`. |

**No new inversion is created.** Verified: after the move, no staying-kernel `core/*.ts` file imports any moving symbol. The only `core/` files that reference moving symbols are themselves moving (`AbstractWindow`↔`Rail`, `Window`/`TabWindow`/`Dock`→`AbstractWindow`, `Notification`→`Dialog`, `Rail`→`Drawer`/`RailHandle`, `TabWindow`→`windowControls`, `DragManager`→drag trio) — those references stay inside `overlay/` and rewrite to `~/overlay/`. The moving files' upward dependencies on kernel (`Component`, `DOM`, `Callable`, `LayerManager`, `AnimatedDropdown`, …) keep pointing at `~/core/` — the correct direction.

### Within-folder structure — flatten `core/component/` into `overlay/`

The four drag overlays currently sit in a `core/component/` subfolder. That folder name is confusing (it is *not* `~/component/`) and exists only to group the drag overlays. After the move the subfolder would be left empty (all four files move), so it is **deleted**. The four drag files land directly in `overlay/` alongside `DragManager.ts` — a flat `overlay/` folder. This keeps the drag subsystem visibly together without a nested folder whose only purpose was grouping inside `core/`.

Resulting layout:

```
src/typescript/lib/overlay/
    AbstractWindow.ts  Window.ts  TabWindow.ts  windowControls.ts
    Dialog.ts  Notification.ts  Tooltip.ts  Popover.ts  Menu.ts
    Drawer.ts  Rail.ts  RailHandle.ts  ButtonGroup.ts  Dock.ts
    DragManager.ts  DragGhost.ts  DragFeedback.ts  DropZoneOverlay.ts  ReorderIndicator.ts
    index.ts
```

### Path-alias mechanism and the new `overlay/` barrel

Two alias systems coexist (verified in `tsconfig.json`, `vite.config.ts`, `vite.lib.config.ts`, `package.json`):

- **`~/*` → `./src/typescript/lib/*`** — the internal deep-path wildcard. *Every* moved file is reached internally via `~/overlay/X.js`, which the wildcard resolves **with no new config entry** (this is *not* the directory-subpath gotcha from memory — that gotcha applies to explicit `@jimka/typescript-ui/<group>` subpaths and glob entries, not the `~/*` catch-all).
- **`@jimka/typescript-ui/<group>` → `<group>/index.ts`** — the *public* per-group package barrels (one per `exports` entry in `package.json`, one per `vite.config.ts`/`vite.lib.config.ts` alias/lib entry, one per `tsconfig.json` path, one per `typedoc.json` entry point).

**Create a new public `overlay/` barrel and register it in all four config surfaces**, mirroring how `core` is registered, so the public API stays first-class and the moved symbols regenerate clean typedoc pages under `/api/overlay/`:

1. `src/typescript/lib/overlay/index.ts` — new barrel re-exporting exactly the moved symbols (see *Public API*).
2. `tsconfig.json` `paths` — add `"@jimka/typescript-ui/overlay": ["./src/typescript/lib/overlay/index.ts"]`.
3. `vite.config.ts` `resolve.alias` — add `{ find: '@jimka/typescript-ui/overlay', replacement: sub('overlay/index.ts') }` **before** the `~` catch-all entry (alias order matters — the longer, more specific find must precede `~`).
4. `vite.lib.config.ts` `build.lib.entry` — add `'overlay': r('overlay/index.ts')`.
5. `package.json` `exports` — add `"./overlay": { "import": "./dist/lib/overlay.es.js", "types": "./dist/lib/types/overlay/index.d.ts" }`.
6. `typedoc.json` `entryPoints` — add `"src/typescript/lib/overlay/index.ts"` so API docs regenerate under `docs/api/overlay/`.

`tsconfig.lib.json` uses a wildcard `include` (`src/typescript/lib/**/*`), so `overlay/` is picked up automatically — no edit there.

### `core/index.ts` barrel — strip the moved exports, keep it kernel-only

`core/index.ts` currently re-exports all the moving symbols (lines 25–33, 36–51, 63–68 of [the file](../src/typescript/lib/core/index.ts)). Since **no code imports the `~/core` barrel** (verified zero hits for `from "~/core"` / `from "~/core/index"` across the whole repo), removing those lines breaks nothing internal. The moved exports are **moved**, not duplicated: delete them from `core/index.ts` and put them in `overlay/index.ts`. This keeps `core` as a kernel barrel and `overlay` as the shell barrel — no symbol is exported from two public packages.

**`DragManager`'s `TabDragData` / `DragGhost` etc. were re-exported by `core/index.ts` and also by `layout/index.ts`** ([`layout/index.ts:21`](../src/typescript/lib/layout/index.ts#L21) re-exports `TabDragData` from `~/core/DragManager.js`; [line 44](../src/typescript/lib/layout/index.ts#L44) re-exports `DropZone` from `~/core/component/DropZoneOverlay.js`). Those two `layout/index.ts` re-export *specifiers* must update to `~/overlay/DragManager.js` and `~/overlay/DropZoneOverlay.js` — the `layout` public surface keeps the back-compat re-exports, only the source path changes.

### Keep the diff reviewable — one code commit

Per the commit skill's one-functionality rule this is a single logical change ("move overlay tier out of core"), so it is **one code commit** containing: the 19 file moves (`git mv` to preserve history), the new `overlay/index.ts`, the edits to `core/index.ts` and `layout/index.ts`, the 73 internal import-specifier rewrites across 26 files, and the four config-surface edits. The doc-link rewrites (source JSDoc + curated `.md`) are a separate **documentation** commit (the commit skill's buckets). Use `git mv` so each moved file shows as a rename, not delete+add, keeping the diff legible despite its breadth.

---

## Public API (TypeScript Signatures)

`src/typescript/lib/overlay/index.ts` re-exports exactly the symbols removed from `core/index.ts`, with specifiers pointing at the flattened `overlay/` paths. No signatures change. The export list, verbatim from the current `core/index.ts` (lines to migrate), with `~/core/…` → `~/overlay/…` and `~/core/component/X.js` → `~/overlay/X.js`:

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

export { ButtonGroup } from '~/overlay/ButtonGroup.js';
export type { ButtonGroupOptions, ButtonGroupEvent } from '~/overlay/ButtonGroup.js';
export { AbstractWindow } from '~/overlay/AbstractWindow.js';
export { Window } from '~/overlay/Window.js';
export { TabWindow } from '~/overlay/TabWindow.js';
export type { WindowOptions, WindowState, WindowEvent, WindowMaximizeBounds, WindowSnapModifier, WindowRect } from '~/overlay/AbstractWindow.js';
export { Menu } from '~/overlay/Menu.js';
export { Tooltip } from '~/overlay/Tooltip.js';
export type { TooltipColors } from '~/overlay/Tooltip.js';
export { Popover } from '~/overlay/Popover.js';
export type { PopoverOptions, PopoverPlacement, PopoverDismissMode } from '~/overlay/Popover.js';
export { Notification } from '~/overlay/Notification.js';
export type { NotificationType } from '~/overlay/Notification.js';
export { Dialog, DialogTitleBar, DialogButtons } from '~/overlay/Dialog.js';
export type { DialogConfig, DialogButtonConfig, DialogResult } from '~/overlay/Dialog.js';
export { Drawer } from '~/overlay/Drawer.js';
export type { DrawerOptions, DrawerEdge, DrawerEvent, DrawerCloseController } from '~/overlay/Drawer.js';
export { Rail } from '~/overlay/Rail.js';
export type { RailOptions, RailEdge, RailOrientation, RailEvent, RailDrawerRegistration } from '~/overlay/Rail.js';
export { RailHandle } from '~/overlay/RailHandle.js';
export type { RailHandleOptions } from '~/overlay/RailHandle.js';
export { Dock } from '~/overlay/Dock.js';
export type { DockOptions, DockPanelSpec, DockLayoutSpec } from '~/overlay/Dock.js';

export { DragManager } from '~/overlay/DragManager.js';
export type { DragData, DragEventDetail, DragSourceOptions, DropTargetOptions, TabDragData } from '~/overlay/DragManager.js';
export { DragGhost } from '~/overlay/DragGhost.js';
export { DragFeedback } from '~/overlay/DragFeedback.js';
export { ReorderIndicator } from '~/overlay/ReorderIndicator.js';
export { DropZoneOverlay } from '~/overlay/DropZoneOverlay.js';
export type { DropZone } from '~/overlay/DropZoneOverlay.js';
```

`windowControls.ts` is not re-exported today (it is an internal helper used only by `TabWindow`), so it does not appear in the barrel — confirm during implementation that `core/index.ts` has no `windowControls` export to migrate.

**`@category` tags:** the moved files currently carry `@category Core` (e.g. `AbstractWindow`, `Dialog`, `DragManager`, `Window`) and `@category Components` (`Menu`). Leave the tag *text* as-is for this pure-move refactor unless a follow-up decision adds an `Overlay` category to `typedoc.json`'s `categoryOrder` — changing categories is a docs-taxonomy decision, not part of the mechanical move. (Flag for the implementer: do **not** silently invent an `Overlay` category; keep existing tags.)

---

## Ordered Implementation Steps

1. **Create the folder + move files with history.** `mkdir src/typescript/lib/overlay`, then `git mv` each of the 14 top-level overlay files (`AbstractWindow.ts`, `Window.ts`, `TabWindow.ts`, `windowControls.ts`, `Dialog.ts`, `Notification.ts`, `Tooltip.ts`, `Popover.ts`, `Menu.ts`, `Drawer.ts`, `Rail.ts`, `RailHandle.ts`, `ButtonGroup.ts`, `Dock.ts`) from `core/` into `overlay/`, and `git mv` the four drag files (`DragGhost.ts`, `DragFeedback.ts`, `DropZoneOverlay.ts`, `ReorderIndicator.ts`) from `core/component/` plus `DragManager.ts` from `core/` into `overlay/` (flatten — no `overlay/component/`). → verify: `core/component/` is now empty; `ls src/typescript/lib/overlay/` lists 19 `.ts` files.
2. **Delete the empty `core/component/` directory.** → verify: `test ! -d src/typescript/lib/core/component`.
3. **Rewrite imports *inside* the moved files.** Within each `overlay/*.ts`, change every `from "~/core/<MovedSymbol>.js"` and `from "~/core/component/<Drag>.js"` to `from "~/overlay/<Symbol>.js"` (intra-tier references: `Window`→`AbstractWindow`, `Rail`→`Drawer`/`RailHandle`/`AbstractWindow`, `Notification`→`Dialog`, `TabWindow`→`windowControls`/`AbstractWindow`, `Dock`→`AbstractWindow`/`TabWindow`/`DropZoneOverlay`/`DragManager`, `DragManager`→`DragGhost`/`DragFeedback`/`ReorderIndicator`). Leave kernel imports (`~/core/Component.js`, `~/core/LayerManager.js`, `~/core/AnimatedDropdown.js`, `~/core/DOM.js`, …) and `~/component/` / `~/layout/` / `~/primitive/` imports untouched. → verify after step 4.
4. **Rewrite imports in external consumers.** In the remaining files (`component/button/Button.ts`, `component/button/SplitButton.ts`, `component/container/SplitGutter.ts`, `component/container/TabBar.ts`, `component/container/WindowHeader.ts`, `component/menubar/MenuBar.ts`, `component/menubar/ToolBar.ts`, `component/table/Table.ts`, `component/table/TablePanel.ts`, `component/table/TreeBody.ts`, `component/table/TreeTablePanel.ts`, `component/table/cell/Header.ts`, `component/table/cell/ParentHeader.ts`, `layout/DockRegion.ts`, `layout/Tab.ts`, `layout/LayoutSerialization.ts`, `validation/FieldDecorator.ts`), rewrite each `from "~/core/<MovedSymbol>.js"` / `from "~/core/component/<Drag>.js"` to `from "~/overlay/<Symbol>.js"`. → verify: `grep -rnE "from ['\"]~/core/(AbstractWindow|Window|TabWindow|Dialog|Menu|Popover|Notification|Tooltip|Drawer|Rail|RailHandle|ButtonGroup|windowControls|Dock|DragManager|component/(DragGhost|DragFeedback|DropZoneOverlay|ReorderIndicator))" src/` returns **zero**.
5. **Create `overlay/index.ts`** with the export block from *Public API*. → verify: file exists, exports compile.
6. **Strip moved exports from `core/index.ts`.** Remove the `ButtonGroup`, `AbstractWindow`/`Window`/`TabWindow` (+ `WindowOptions…` types), `Menu`, `Tooltip`, `Popover`, `Notification`, `Dialog`, `Drawer`, `Rail`, `RailHandle`, `Dock`, `DragManager` (+ `DragData…` types), `DragGhost`, `DragFeedback`, `ReorderIndicator`, `DropZoneOverlay` export lines. **Keep** `BaseObject`, `Event`, `ListenerBag`, `Animation`, `SmoothScroller`, `Util`, `DOM`, `callable`, `Component`, `Container`, `Panel`, `Aria`, `RovingTabIndex`, `Body`, `AnimatedDropdown`, `LayerManager`, `Theme*`, `StyleTarget`, `Binding`, `Bindable`. → verify: `core/index.ts` no longer references any moved symbol.
7. **Fix `layout/index.ts` re-export specifiers.** Change line 21 `from '~/core/DragManager.js'` → `'~/overlay/DragManager.js'` and line 44 `from '~/core/component/DropZoneOverlay.js'` → `'~/overlay/DropZoneOverlay.js'` (keep the re-exports themselves — they are the `layout` public back-compat surface). → verify in step 9.
8. **Register the new `overlay` group in the four config surfaces** (tsconfig `paths`, `vite.config.ts` alias before `~`, `vite.lib.config.ts` lib entry, `package.json` exports) plus `typedoc.json` entryPoints, per *Architecture Decisions*. → verify: `npm run typecheck`.
9. **Typecheck.** `npm run typecheck` → verify: 0 errors.
10. **Rewrite documentation links** (separate docs commit). Source JSDoc: rewrite the ~65 `/api/core/<kind>/<MovedSymbol>` cross-ref links inside `src/**/*.ts` to `/api/overlay/<kind>/<MovedSymbol>` (only for moved symbols — leave `LayerManager`, `AnimatedDropdown`, `Component`, etc. as `/api/core/`). Curated docs: rewrite the 86 `/api/core/<kind>/<MovedSymbol>` links across `docs/**/*.md` (excluding generated `docs/api/`) the same way. → verify: `grep -rnE "/api/core/(classes|interfaces|type-aliases|functions|variables|namespaces)/(AbstractWindow|Window|TabWindow|Dialog|Menu|Popover|Notification|Tooltip|Drawer|Rail|RailHandle|ButtonGroup|Dock|DragManager|DragGhost|DragFeedback|DropZoneOverlay|ReorderIndicator)\b" src/ docs/ --include=*.ts --include=*.md | grep -v "docs/api/"` returns zero.
11. **Build + docs build.** `npm run build` and `npm run docs:build` → verify: both clean (docs: 0 errors, 0 link warnings; the typedoc "unsupported TypeScript version" notice is the lone acceptable warning).
12. **Smoke test.** Run the app (`npm run dev`, http://localhost:8015) and exercise the overlay tier via `MiscPanel` (the demo screen that news up `Window`/`Dialog`/`Menu`/`Notification` — see `src/typescript/MiscPanel.ts`): open a window, drag it, open a dialog, open a menu, fire a notification, drag-reorder a tab. → verify: no console errors, visuals unchanged.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/overlay/index.ts` |
| Move (`git mv`) | `core/AbstractWindow.ts` → `overlay/AbstractWindow.ts` |
| Move | `core/Window.ts` → `overlay/Window.ts` |
| Move | `core/TabWindow.ts` → `overlay/TabWindow.ts` |
| Move | `core/windowControls.ts` → `overlay/windowControls.ts` |
| Move | `core/Dialog.ts` → `overlay/Dialog.ts` |
| Move | `core/Notification.ts` → `overlay/Notification.ts` |
| Move | `core/Tooltip.ts` → `overlay/Tooltip.ts` |
| Move | `core/Popover.ts` → `overlay/Popover.ts` |
| Move | `core/Menu.ts` → `overlay/Menu.ts` |
| Move | `core/Drawer.ts` → `overlay/Drawer.ts` |
| Move | `core/Rail.ts` → `overlay/Rail.ts` |
| Move | `core/RailHandle.ts` → `overlay/RailHandle.ts` |
| Move | `core/ButtonGroup.ts` → `overlay/ButtonGroup.ts` |
| Move | `core/Dock.ts` → `overlay/Dock.ts` |
| Move | `core/DragManager.ts` → `overlay/DragManager.ts` |
| Move (flatten) | `core/component/DragGhost.ts` → `overlay/DragGhost.ts` |
| Move (flatten) | `core/component/DragFeedback.ts` → `overlay/DragFeedback.ts` |
| Move (flatten) | `core/component/DropZoneOverlay.ts` → `overlay/DropZoneOverlay.ts` |
| Move (flatten) | `core/component/ReorderIndicator.ts` → `overlay/ReorderIndicator.ts` |
| Delete | `core/component/` (now-empty directory) |
| Modify | `src/typescript/lib/core/index.ts` (strip moved exports) |
| Modify | `src/typescript/lib/layout/index.ts` (re-export specifiers → `~/overlay/…`) |
| Modify | 24 internal import-rewrite files (see step 3 + step 4 lists; the moving files rewrite intra-tier refs, the consumers rewrite their imports) |
| Modify | `tsconfig.json` (add `@jimka/typescript-ui/overlay` path) |
| Modify | `vite.config.ts` (add overlay alias before `~`) |
| Modify | `vite.lib.config.ts` (add `overlay` lib entry) |
| Modify | `package.json` (add `./overlay` export) |
| Modify | `typedoc.json` (add overlay entry point) |
| Modify | ~65 source `.ts` JSDoc cross-ref links + ~86 curated `docs/**/*.md` links (`/api/core/…` → `/api/overlay/…`, moved symbols only) |

---

## Verification

- `npm run typecheck` — 0 errors.
- `grep -rnE "from ['\"]~/core/(AbstractWindow|Window|TabWindow|Dialog|Menu|Popover|Notification|Tooltip|Drawer|Rail|RailHandle|ButtonGroup|windowControls|Dock|DragManager|component/(DragGhost|DragFeedback|DropZoneOverlay|ReorderIndicator))" src/` — **zero** matches (every moved-symbol import now uses `~/overlay/`).
- `test ! -d src/typescript/lib/core/component` — the flattened subfolder is gone.
- `grep -rnE "/api/core/.*(AbstractWindow|Window|TabWindow|Dialog|Menu|Popover|Notification|Tooltip|Drawer|Rail|RailHandle|ButtonGroup|Dock|DragManager|DragGhost|DragFeedback|DropZoneOverlay|ReorderIndicator)" src/ docs/ --include=*.ts --include=*.md | grep -v "docs/api/"` — zero (doc links repointed).
- **No-inversion invariant:** `grep -rlE "from ['\"]~/overlay/" src/typescript/lib/core/` — **zero** (no kernel file imports overlay).
- `npm run build` — succeeds (production bundle; class names preserved by the existing `keepNames` minify config — unaffected by the move).
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc TS-version notice excepted); confirm `docs/api/overlay/` is generated and `docs/api/core/` no longer contains the moved symbols.
- **Smoke test:** `npm run dev` → `MiscPanel` demo — open/drag a `Window`, open a `Dialog`, open a `Menu`, fire a `Notification`, drag-reorder a tab; no console errors, behavior and visuals unchanged.

---

## Documentation Impact

- **Per-subpath barrels.** The moved symbols leave the `core` barrel (`src/typescript/lib/core/index.ts`) and gain a new `overlay` barrel (`src/typescript/lib/overlay/index.ts`), registered as the public package `@jimka/typescript-ui/overlay` in `tsconfig.json`, `vite.config.ts`, `vite.lib.config.ts`, `package.json`, and `typedoc.json`. After `npm run docs:build`, typedoc emits `docs/api/overlay/` and drops the moved symbols from `docs/api/core/`.
- **Curated pages are folder-agnostic — no page moves.** The curated component pages live under `docs/components/` keyed by component name (`/components/Window`, `/components/Dialog`, …) and the sidebar in `docs/.vitepress/config.mts` links those curated paths, not `/api/core/` — so the **sidebar needs no change** and no curated `.md` file is renamed.
- **Cross-bucket JSDoc links must repoint.** ~65 source `/api/core/<kind>/<MovedSymbol>` links (e.g. in `DragManager.ts`, `concepts/layering.md`-referenced symbols) and ~86 curated-doc links (`docs/components/Window.md`, `docs/components/Dialog.md`, `docs/components/Menu.md`, `docs/components/Notification.md`, `docs/components/Rail.md`, `docs/components/Drawer.md`, `docs/components/Dock.md`, `docs/components/Tooltip.md`, `docs/components/ButtonGroup.md`, `docs/components/TabWindow.md`, `docs/components/AbstractWindow.md`, `docs/components/Popover.md`, `docs/components/index.md`, `docs/concepts/layering.md`, `docs/concepts/events.md`, `docs/concepts/performance.md`, `docs/concepts/theming.md`, `docs/recipes/drag-and-drop.md`, `docs/recipes/dialog-modal.md`, `docs/layouts/Tab.md`, `docs/layouts/DockRegion.md`, `docs/layouts/LayoutSerialization.md`, `docs/layouts/Fit.md`, `docs/reference/changelog.md`, …) must change `/api/core/…` → `/api/overlay/…` for moved symbols only. Per `_shared/docs-conventions.md`, cross-bucket references use markdown links `[\`Foo\`](/api/overlay/classes/Foo)` (not `{@link}`), which is already the form in use — only the subpath segment changes.
- **`@category` tags** stay as-is (this is a pure move); introducing an `Overlay` typedoc category is a deliberate taxonomy decision left out of scope (see Non-Goals).

---

## Potential Challenges

- **Vite alias ordering.** The `@jimka/typescript-ui/overlay` alias must be inserted *before* the `~` catch-all in `vite.config.ts`'s array — Vite matches aliases top-to-bottom and `~` would otherwise shadow it. Mitigation: place it in the `@jimka/typescript-ui/*` block alongside `core`.
- **Intra-tier vs. kernel import confusion during rewrite.** A moved file imports both moving symbols (rewrite to `~/overlay/`) and staying kernel symbols (`~/core/Component.js`, `~/core/LayerManager.js`, `~/core/AnimatedDropdown.js` — leave alone). Mitigation: rewrite only the specific moved-symbol specifiers from the enumerated list, not a blanket `~/core/` → `~/overlay/` sed.
- **`layout/index.ts` back-compat re-exports.** `TabDragData` and `DropZone` are re-exported through `layout` for back-compat; only the source specifier moves. Mitigation: the two lines are called out explicitly (step 7).
- **Two `Body`-style name collisions in cross-bucket links.** Doc-conventions note colliding names (`Body`, `Border`, …) need spelled-out subpaths. `Body` stays in core; none of the *moved* symbols collide with a same-named symbol in another bucket, so the `/api/overlay/` repoint is unambiguous.
- **`docs/api/` is gitignored / generated.** Do not hand-edit it; it regenerates from typedoc. Only the *committed* source JSDoc and curated `.md` links are edited.

---

## Critical Files

- [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts) — the barrel whose moved exports define the migration set (lines 25–33, 36–51, 63–68).
- [`tsconfig.json`](../tsconfig.json) (`paths`), [`vite.config.ts`](../vite.config.ts) (`resolve.alias`), [`vite.lib.config.ts`](../vite.lib.config.ts) (`build.lib.entry`), [`package.json`](../package.json) (`exports`), [`typedoc.json`](../typedoc.json) (`entryPoints`) — the five config surfaces that register a public group.
- [`src/typescript/lib/core/DragManager.ts`](../src/typescript/lib/core/DragManager.ts) — the kernel-vs-overlay borderline whose `new DragGhost()` (importing `~/component/input/Text.js`) is the proof the drag subsystem is overlay.
- [`src/typescript/lib/core/AnimatedDropdown.ts`](../src/typescript/lib/core/AnimatedDropdown.ts), [`LayerManager.ts`](../src/typescript/lib/core/LayerManager.ts) — the two highest-traffic *staying* kernel files that the overlay tier depends *up* on; confirm they have no `~/component/` edge.
- [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts) — the only foreign barrel that re-exports moved symbols (`TabDragData`, `DropZone`).
- `src/typescript/MiscPanel.ts` — the demo that exercises the overlay tier for the smoke test.

---

## Non-Goals

- **No behavior, API-signature, or `callable()`-wrapping changes.** Pure folder + specifier move.
- **No `Overlay` typedoc category.** Existing `@category Core` / `@category Components` tags on moved files are left untouched; reclassifying the docs taxonomy is a separate decision.
- **No splitting the drag subsystem.** `DragManager` + the four drag overlays move together; this plan does not relocate `DragManager` to `data/` or keep `DragFeedback`/`DropZoneOverlay`/`ReorderIndicator` in `core/` (would re-create the inversion).
- **No moving the kernel borderline files** (`AnimatedDropdown`, `LayerManager`, `Body`, `Panel`) — they have no downward `component/` dependency and stay in `core/`.
- **No `overlay/component/` nesting.** The `core/component/` grouping folder is flattened away, not recreated under `overlay/`.
