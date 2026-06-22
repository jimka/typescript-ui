---
touches-shared:
  - src/typescript/lib/primitive/index.ts
  - src/typescript/lib/layout/index.ts
  - src/typescript/lib/component/container/Scrollbar.ts
---

# Primitive Axis Vocabulary — Implementation Plan

## Overview

Consolidate the scattered `"horizontal" | "vertical"` orientation unions and the axis position/end/spread literal unions into one coherent geometric vocabulary that lives beside the existing geometry primitives in `src/typescript/lib/primitive/`. A prior merged change already created `AxisPosition` and `AxisSpread` in [`lib/layout/AxisAlign.ts`](../src/typescript/lib/layout/AxisAlign.ts); this plan **moves** those two types into a new `lib/primitive/Axis.ts`, **adds** `AxisOrientation` and `AxisEnd`, deletes `AxisAlign.ts`, and replaces seven bespoke orientation aliases plus several inline literal unions with the shared `AxisOrientation`.

This is a **type-only consolidation plus renames**. No runtime string value changes except two explicitly-noted items: the [`Split`](../src/typescript/lib/layout/Split.ts) serialized key `direction` → `orientation` (and the `direction` option → `orientation`), and the `chevronSide` / `ToolBar.overflowSide` option *values* moving from physical `"left"`/`"right"` to logical `"start"`/`"end"`. The `ToolBar` overflow generalization to `AxisEnd` and the `chevronSide` generalization are the only two behavior-relevant edits; both reduce to a single equality check each (no CSS or DOM-attribute translation is needed — investigation below confirms both values are consumed purely as HBox child-ordering decisions).

The primitive subpath is **already fully wired** — `@jimka/typescript-ui/primitive` resolves in [`tsconfig.json:14`](../tsconfig.json#L14), [`vite.config.ts:19`](../vite.config.ts#L19), and [`package.json`](../package.json) `exports` — and is already a typedoc entry point ([`typedoc.json:5`](../typedoc.json#L5)). So **no new subpath registration is required**; only the primitive barrel ([`lib/primitive/index.ts`](../src/typescript/lib/primitive/index.ts)) gains new exports.

---

## Architecture Decisions

### One file `lib/primitive/Axis.ts` holds all four types

Following [`Placement.ts`](../src/typescript/lib/primitive/Placement.ts) / [`Position.ts`](../src/typescript/lib/primitive/Position.ts): single SPDX header, one `@category` JSDoc block per export. All four axis types are one cohesive vocabulary (orientation + position + end + spread), so they share one file rather than four micro-files. The two moved types (`AxisPosition`, `AxisSpread`) carry their existing JSDoc verbatim from `AxisAlign.ts` (only the `@category` is reconciled — see below).

### `@category Util` for the axis types

The existing `AxisPosition`/`AxisSpread` carry `@category Layouts`. The sibling primitive types ([`Placement`](../src/typescript/lib/primitive/Placement.ts), [`Position`](../src/typescript/lib/primitive/Position.ts)) use `@category Util`. typedoc groups API pages by **entry point**, not by `@category` (verified: [`typedoc.json`](../typedoc.json) lists each barrel as an entry point and `categorizeByGroup: false`), so the page *path* is driven by the barrel that exports the symbol, while `@category` only orders entries within a page. Moving these to the primitive barrel relocates their pages to `/api/primitive/type-aliases/`; setting `@category Util` keeps them grouped with their new primitive neighbours. All four new types use `@category Util`.

### `AxisEnd = Exclude<AxisPosition, "center">` (encoded, not literal)

Self-documenting: it states "an `AxisEnd` is an `AxisPosition` that isn't the centre", which is exactly the domain relationship, and matches the prior art `TabAlign = Exclude<AxisPosition, "center">` that it replaces. Resolves to `"start" | "end"`.

### Keep `start`/`end` spelling (not leading/trailing)

`start`/`end` are CSS flow-relative keywords, already RTL-neutral, and match `between`/`around` in `AxisSpread`. These names signal logical/flow-relative intent; actual RTL flipping is **future work, out of scope**. (Recorded per the brief — not re-litigated.)

### `lib/layout/AxisAlign.ts` is deleted; the layout barrel re-exports from primitive

`AxisAlign.ts` is removed. Its two types live in `primitive/Axis.ts`. Layout types that *compose* them stay in layout (`BoxJustify = AxisPosition | AxisSpread` in [`BoxLayout.ts:72`](../src/typescript/lib/layout/BoxLayout.ts#L72); `FlowLayout` `align`/`justify`). The layout barrel ([`lib/layout/index.ts:24`](../src/typescript/lib/layout/index.ts#L24)) keeps re-exporting `AxisPosition`/`AxisSpread` (now sourced from primitive) for back-compat, since existing consumers (e.g. [`TabDemoPanel.ts:5`](../src/typescript/TabDemoPanel.ts#L5)) import `AxisPosition` from `@jimka/typescript-ui/layout`.

### `Split.direction` → `orientation` is a persisted-format change — ACCEPTED (prerelease)

`orientation` is the better word and unifies with `Slider`/`Scrollbar`/`ToolBar`, which already say "orientation". The renamed `SplitNode.orientation` serialized key is a **breaking change to any persisted layout JSON** written by the old key. Accepted: the library is prerelease and `serializeLayout`/`restoreLayout` carry no migration shim. No back-compat alias for the old `direction` key is added.

### `chevronSide` / `overflowSide` value change to `AxisEnd` requires no physical-side translation

Investigation of both render paths (below) shows each literal is consumed **only** as an HBox child-ordering branch (insert-at-0 vs append), never as a CSS `left`/`right` property, DOM attribute, or map key. So switching the accepted values from `"left"`/`"right"` to `"start"`/`"end"` is a pure value rename plus one equality-check flip per site — no `AxisEnd`→physical-side mapping function is needed.

### Excluded: `TabOrientation` and `RailOrientation`

[`Tab.ts:116`](../src/typescript/lib/layout/Tab.ts#L116) `TabOrientation` and [`Rail.ts:48`](../src/typescript/lib/core/Rail.ts#L48) `RailOrientation` are `"horizontal" | "vertical-cw" | "vertical-ccw"` — text-rotation writing-modes, a different three-value concept. Verified by reading both declarations. They are **not** touched. (A confirming `grep '"horizontal" | "vertical"'` over `lib/` returns exactly the seven target files and excludes `Tab.ts`/`Rail.ts`.)

---

## Public API (TypeScript Signatures)

New file `src/typescript/lib/primitive/Axis.ts`:

```typescript
export type AxisOrientation = "horizontal" | "vertical";
export type AxisPosition    = "start" | "center" | "end";   // moved verbatim
export type AxisEnd         = Exclude<AxisPosition, "center">;
export type AxisSpread      = "start" | "between" | "around"; // moved verbatim
```

Renamed `Split` surface ([`Split.ts`](../src/typescript/lib/layout/Split.ts)):

```typescript
interface SplitOptions extends LayoutManagerOptions {
    orientation?: AxisOrientation;   // was: direction?: SplitDirection
    collapsedPanes?: number[];
}
// _orientation backing field (was _direction)
setOrientation(orientation: AxisOrientation): this;  // was setDirection(direction: SplitDirection)
getOrientation(): AxisOrientation;                   // was getDirection(): SplitDirection
// SplitDirection type dropped
```

Generalized `ToolBar` surface ([`ToolBar.ts`](../src/typescript/lib/component/menubar/ToolBar.ts)):

```typescript
overflowSide?: AxisEnd;            // was ToolBarOverflowSide ("left" | "right")
setOverflowSide(value: AxisEnd): this;
getOverflowSide(): AxisEnd;
// _overflowSide: AxisEnd; default "end" (was "right")
// ToolBarOverflowSide type dropped; ToolBarOrientation dropped (-> AxisOrientation)
```

`Tab` / `TabBar`: `TabAlign` dropped; `align` member typed `AxisEnd` directly.

Types **dropped** entirely (consumers must import `AxisOrientation`/`AxisEnd` instead): `SplitDirection`, `ScrollbarOrientation`, `ToolBarOrientation`, `ToolBarSeparatorOrientation`, `ToolBarOverflowSide`, `TabAlign`.

---

## Ordered Implementation Steps

### 1. Create the primitive axis file + wire the barrel

- Create [`src/typescript/lib/primitive/Axis.ts`](../src/typescript/lib/primitive/Axis.ts) with the four types, SPDX header, and one `@category Util` JSDoc block each. Copy the existing `AxisPosition`/`AxisSpread` doc bodies from `AxisAlign.ts` verbatim (they already `{@link}` `BoxJustify`/each other — keep those links).
- Add to [`lib/primitive/index.ts`](../src/typescript/lib/primitive/index.ts): `export type { AxisOrientation, AxisPosition, AxisEnd, AxisSpread } from '~/primitive/Axis.js';`
- No tsconfig/vite/package.json edits — the primitive subpath is already registered.

### 2. Delete `AxisAlign.ts`, repoint its importers

Delete [`src/typescript/lib/layout/AxisAlign.ts`](../src/typescript/lib/layout/AxisAlign.ts). Update the three internal importers' `import type` paths from `~/layout/AxisAlign.js` to `~/primitive/Axis.js`:
- [`BoxLayout.ts:6`](../src/typescript/lib/layout/BoxLayout.ts#L6) (`AxisPosition, AxisSpread`) — `BoxJustify` at line 72 unchanged.
- [`FlowLayout.ts:6`](../src/typescript/lib/layout/FlowLayout.ts#L6) (`AxisPosition, AxisSpread`).
- [`Tab.ts:21`](../src/typescript/lib/layout/Tab.ts#L21) (`AxisPosition`).
- [`TabBar.ts:32`](../src/typescript/lib/component/container/TabBar.ts#L32) imports `AxisPosition` (it imports `TabAlign` from `Tab.js` separately — handled in step 6).

### 3. `AxisOrientation` — replace the seven orientation declarations

Use `AxisOrientation` directly; drop the pure-alias named types. Field/member names stay domain-natural (`orientation`, `_orientation`).

- [`Scrollbar.ts:58`](../src/typescript/lib/component/container/Scrollbar.ts#L58) — drop `ScrollbarOrientation`; retype `_orientation` (line 331), the constructor param (line 360), and `getOrientation` (line 632) to `AxisOrientation`. Add `import type { AxisOrientation } from "~/primitive/Axis.js";`. **Do not touch** `ArrowDirection` (line 105) — owned by the sibling `primitive-edge-vocabulary` plan.
- [`ToolBarSeparator.ts:13`](../src/typescript/lib/component/menubar/ToolBarSeparator.ts#L13) — drop `ToolBarSeparatorOrientation`; retype the option (line 21), `_orientation` (line 59), `getOrientation` (line 98). Import `AxisOrientation`.
- [`ToolBar.ts:32`](../src/typescript/lib/component/menubar/ToolBar.ts#L32) — drop `ToolBarOrientation`; retype `_orientation` (line 147), the `orientation?` option (line 61), `setOrientation`/`getOrientation` (lines 231, 269). Import `AxisOrientation`.
- [`Slider.ts`](../src/typescript/lib/component/input/Slider.ts) — four inline `"horizontal" | "vertical"` annotations → `AxisOrientation`: the option (line 22), `getOrientation` (line 361), `setOrientation` (line 373), `applyOrientation` (line 692). Import `AxisOrientation`.
- [`Dock.ts:50`](../src/typescript/lib/core/Dock.ts#L50) — inline `{ split: "horizontal" | "vertical" }` in `DockLayoutSpec` → `{ split: AxisOrientation; … }`. Import `AxisOrientation`. (`spec.split` flows into the `Split` construction at line 372 — updated in step 4.)
- `Split.ts` and `LayoutSerialization.ts` inline `direction` literals are handled together with the rename in step 4.

### 4. `Split`: rename `direction` → `orientation`

In [`Split.ts`](../src/typescript/lib/layout/Split.ts):
- Drop the `SplitDirection` type (lines 19–25). Import `AxisOrientation` from `~/primitive/Axis.js`.
- `SplitOptions.direction?: SplitDirection` → `orientation?: AxisOrientation` (line 33).
- `_direction` → `_orientation` (declaration line 47; **all reads**: lines 149, 412, 473, 537, 568, 677, 689, 693, 719, 749, 779, 1078). Note line 749 passes `this._direction` as the positional `direction` arg to `new SplitGutter(...)` — that is `SplitGutter`'s own orientation param (typed `String`), unaffected by the rename; just feed `this._orientation`.
- `applyOptions` (lines 97–99): `options.direction` → `options.orientation`; `this.setDirection(...)` → `this.setOrientation(...)`.
- `getDirection()` → `getOrientation()` (line 261); `setDirection(direction)` → `setOrientation(orientation)` (line 270). Update their JSDoc and the param name inside.

In [`DockRegion.ts`](../src/typescript/lib/layout/DockRegion.ts) — four `Split.getDirection()` callers → `getOrientation()`: lines **350, 374, 424, 447** (each `String(<split>.getDirection()) === axis`). Also line 455 `new Split({ direction: axis })` → `new Split({ orientation: axis })`.

In [`Dock.ts:372`](../src/typescript/lib/core/Dock.ts#L372): `new Split({ direction: spec.split })` → `new Split({ orientation: spec.split })`.

In [`LayoutSerialization.ts`](../src/typescript/lib/layout/LayoutSerialization.ts):
- `SplitNode.direction: "horizontal" | "vertical"` (line 71) → `orientation: AxisOrientation`. Import `AxisOrientation` (the file already imports from `~/layout/...`; add the primitive import). Update the surrounding doc comment (line 65 mentions "direction").
- Serialize site (line 195): `direction: manager.getDirection() === "vertical" ? …` → `orientation: manager.getOrientation() === "vertical" ? …`.
- Restore site (line 430): `new Split({ direction: node.direction })` → `new Split({ orientation: node.orientation })`.

In [`SplitPanel.ts:16`](../src/typescript/SplitPanel.ts#L16) (demo): `new Split({ direction: "vertical" })` → `new Split({ orientation: "vertical" })`.

> **`getDirection`/`setDirection` NOT renamed** elsewhere: `SplitGutter` (lines 378/387), `CollapseButton` (lines 229/239), `WindowBorder` (lines 118/127), and `AbstractWindow.ts:1591` (`border.getDirection()` on a `WindowBorder`) are different classes — left untouched. Only `Split`'s pair is renamed.

### 5. `ToolBar` overflow → `AxisEnd` (behavior-relevant item #1)

Investigation of [`_positionOverflowTrigger`](../src/typescript/lib/component/menubar/ToolBar.ts#L379) (lines 379–404): the trigger is positioned **by child index** — `moveComponent(trigger, getComponents().length - 1)` for the trailing edge, `moveComponent(trigger, 0)` for the leading edge, with a flex `Spacer` parented only on the trailing case. This is already main-axis-relative: HBox and VBox both order children by index, and `Spacer.flex()` stretches along whichever axis is the main axis. Menu overflow itself is **horizontal-only** (`doLayout` returns early at line 538 when `_orientation !== "horizontal"`), so the reflow never runs vertically — but the trigger positioning is correct for VBox regardless. **Conclusion: a mechanical rename, no positioning rework.** The single physical-direction check is the `=== "right"` at line 386.

Edits in [`ToolBar.ts`](../src/typescript/lib/component/menubar/ToolBar.ts):
- Drop `ToolBarOverflowSide` (lines 45–53). Retype `overflowSide?` option (line 69), `_overflowSide` (line 150), `setOverflowSide` param (line 425), `getOverflowSide` return (line 443) to `AxisEnd`. Import `AxisEnd` from `~/primitive/Axis.js`.
- Default `overflowSide: "right"` → `"end"` ([`_defaultToolBarOptions`, line 103](../src/typescript/lib/component/menubar/ToolBar.ts#L103)).
- `_positionOverflowTrigger`: `this._overflowSide === "right"` → `=== "end"` (line 386).
- Update the doc comments referencing `"right"`/`"left"` (the dropped-type doc lines 45–53, the option doc lines 64–69, and the method docs at lines 369–377, 415–445) to `"end"`/`"start"`.
- **No call sites** outside `ToolBar.ts` pass `overflowSide` (grep of `src/typescript` returns none), so this value change has no external callers to update.

### 6. Collapse `TabAlign` into `AxisEnd` (no value change — identical members)

`TabAlign = Exclude<AxisPosition, "center">` is exactly `AxisEnd`; values `"start"`/`"end"` are unchanged, so this is type-only.

- [`Tab.ts`](../src/typescript/lib/layout/Tab.ts): drop the `TabAlign` declaration (lines 95–100). Retype `align?` (line 161), `setAlign` param (line 538), `getAlign` return (line 551) to `AxisEnd`. Add `AxisEnd` to the existing `import type { … } from "~/primitive/Axis.js"` (alongside `AxisPosition`). Update the `{@link TabAlign}` JSDoc references (lines 534, 549) to `AxisEnd`.
- [`TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts): remove `TabAlign` from the `~/layout/Tab.js` import (line 31); add `AxisEnd` to the primitive import. Retype `align?` (line 148), `_align` default (line 487, value `"start"` unchanged), `setAlign` (line 947), `getAlign` (line 960) to `AxisEnd`. Update the `[`TabAlign`](…)` JSDoc links (lines 943, 958) to `AxisEnd` and its `/api/primitive/...` path (see Documentation Impact).
- [`TabDemoPanel.ts`](../src/typescript/TabDemoPanel.ts): imports `TabAlign`? — verified it imports `AxisPosition` (line 5), **not** `TabAlign`, and uses `AxisPosition[]` at line 93. No change needed beyond confirming it still compiles (it imports from the layout barrel, which keeps `AxisPosition`).

### 7. `chevronSide` → `AxisEnd` (behavior-relevant item #2 — value change "left"/"right" → "start"/"end")

Investigation of the render path: `chevronSide` is consumed **only** in [`AccordionHeader.placeIndicator` (line 164)](../src/typescript/lib/component/container/AccordionHeader.ts#L164) — `if (this._chevronSide === "left") insertComponent(indicator, 0); else addComponent(indicator);`. It is an HBox child-ordering branch; it is never written to CSS, a DOM attribute, or a map key (grep of `AccordionHeader.ts` for `"left"`/`"right"` finds only this comparison, the default, the setter param, and doc text — no style/attribute use). So the value change needs only the one `=== "left"` → `=== "start"` flip plus default/param retyping. No `AxisEnd`→physical-side mapping.

- [`Accordion.ts`](../src/typescript/lib/layout/Accordion.ts): retype the four inline `"left" | "right"` sites — option (line 89), `_chevronSide` default (line 146, `"right"` → `"end"`), and the getter/setter pair return/param at the `chevronSide` accessors (lines 364–365 getter, 377–378 setter; `setChevronSide` param) — to `AxisEnd`. The pass-through at line 1049 (`{ chevronSide: this._chevronSide, … }`) is unchanged in shape (types now agree). Import `AxisEnd` from `~/primitive/Axis.js`.
- [`AccordionHeader.ts`](../src/typescript/lib/component/container/AccordionHeader.ts): retype the option (line 51), `_chevronSide` default (line 87, `"right"` → `"end"`; constructor default line 121 `?? "right"` → `?? "end"`), `setChevronSide` param (line 213), `getChevronSide` return (line 230) to `AxisEnd`. Flip `placeIndicator` comparison (line 164) `=== "left"` → `=== "start"`. Import `AxisEnd`. Update the doc comments that say `"left"`/`"right"` (lines 50, 67, 72, 155–156, 209, 228) to `"start"`/`"end"`.
- [`AccordionDemoPanel.ts:97`](../src/typescript/AccordionDemoPanel.ts#L97) (demo): `.setChevronSide("left")` → `.setChevronSide("start")` — the one external value-change call site.

> Accordion manager and header must agree (the manager passes `chevronSide` through to the header at `Accordion.ts:1049`), so both are retyped to `AxisEnd` in the same step.

### 8. Barrels last (atomic, minimal diffs)

- [`lib/primitive/index.ts`](../src/typescript/lib/primitive/index.ts): the `export type { AxisOrientation, AxisPosition, AxisEnd, AxisSpread }` line from step 1 (re-stated here as the canonical home).
- [`lib/layout/index.ts`](../src/typescript/lib/layout/index.ts):
  - Line 24 `export type { AxisPosition, AxisSpread } from '~/layout/AxisAlign.js';` → `export type { AxisPosition, AxisSpread } from '~/primitive/Axis.js';` (back-compat re-export retained; source repointed).
  - Line 42 `export type { SplitOptions, SplitDirection } from '~/layout/Split.js';` → drop `SplitDirection`: `export type { SplitOptions } from '~/layout/Split.js';`
  - Line 19 `export type { …, TabAlign, … } from '~/layout/Tab.js';` → drop `TabAlign` from the list.

### 9. Regression checkpoints (grep invariants)

- `grep -rn 'AxisAlign' src/` → zero matches.
- `grep -rn 'SplitDirection\|ScrollbarOrientation\|ToolBarOrientation\|ToolBarSeparatorOrientation\|ToolBarOverflowSide\|TabAlign' src/` → zero matches.
- `grep -rn '\.setDirection\|\.getDirection\|direction:' src/typescript/lib/layout/Split.ts src/typescript/lib/layout/DockRegion.ts src/typescript/lib/layout/LayoutSerialization.ts src/typescript/lib/core/Dock.ts src/typescript/SplitPanel.ts` → no `Split`-direction references remain (only the unrelated `CollapseDirection` params inside `Split.ts`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/primitive/Axis.ts` |
| Delete | `src/typescript/lib/layout/AxisAlign.ts` |
| Modify | `src/typescript/lib/primitive/index.ts` (barrel — new exports) |
| Modify | `src/typescript/lib/layout/index.ts` (barrel — repoint + drop `SplitDirection`/`TabAlign`) |
| Modify | `src/typescript/lib/layout/BoxLayout.ts` (import path) |
| Modify | `src/typescript/lib/layout/FlowLayout.ts` (import path) |
| Modify | `src/typescript/lib/layout/Tab.ts` (import path; drop `TabAlign`; `align` → `AxisEnd`) |
| Modify | `src/typescript/lib/component/container/TabBar.ts` (import; `align` → `AxisEnd`) |
| Modify | `src/typescript/lib/layout/Split.ts` (`direction` → `orientation`; drop `SplitDirection`) |
| Modify | `src/typescript/lib/layout/DockRegion.ts` (`getDirection`/`new Split` → orientation) |
| Modify | `src/typescript/lib/layout/LayoutSerialization.ts` (`SplitNode.orientation`; serialize/restore) |
| Modify | `src/typescript/lib/core/Dock.ts` (`DockLayoutSpec.split` → `AxisOrientation`; `new Split` orientation) |
| Modify | `src/typescript/lib/component/container/Scrollbar.ts` (drop `ScrollbarOrientation` → `AxisOrientation`) |
| Modify | `src/typescript/lib/component/menubar/ToolBar.ts` (drop `ToolBarOrientation`/`ToolBarOverflowSide`; `overflowSide` → `AxisEnd`) |
| Modify | `src/typescript/lib/component/menubar/ToolBarSeparator.ts` (drop `ToolBarSeparatorOrientation` → `AxisOrientation`) |
| Modify | `src/typescript/lib/component/input/Slider.ts` (inline literals → `AxisOrientation`) |
| Modify | `src/typescript/lib/layout/Accordion.ts` (`chevronSide` → `AxisEnd`; default `"end"`) |
| Modify | `src/typescript/lib/component/container/AccordionHeader.ts` (`chevronSide` → `AxisEnd`; `placeIndicator` flip; default `"end"`) |
| Modify | `src/typescript/SplitPanel.ts` (demo — `orientation` key) |
| Modify | `src/typescript/AccordionDemoPanel.ts` (demo — `setChevronSide("start")`) |
| Modify | docs (see Documentation Impact) |

---

## Documentation Impact

API reference pages are typedoc-generated from the barrels into `docs/api/<group>/…`. Curated guides live under `docs/layouts/`, `docs/components/`; there is **no** curated `docs/primitive/` section, and the API sidebar is auto-generated (`docs/api/typedoc-sidebar.json`), so no manual sidebar entry is needed for the moved type pages.

**Generated type-alias pages (rebuilt by `npm run docs:build`):**
- New: `AxisOrientation`, `AxisEnd` under `/api/primitive/type-aliases/`.
- Moved: `AxisPosition`, `AxisSpread` from `/api/layout/type-aliases/` → `/api/primitive/type-aliases/` (now canonically declared in the primitive barrel; the layout barrel re-export dedupes to the primitive declaration).
- Removed: `SplitDirection`, `ScrollbarOrientation`, `ToolBarOrientation`, `ToolBarSeparatorOrientation`, `ToolBarOverflowSide`, `TabAlign` pages disappear.

**Source-JSDoc `{@link}` / markdown-link path updates** (the moved types' API path changes from `/api/layout/...` to `/api/primitive/...`):
- `TabBar.ts` lines 943, 958, 994, 1009 — the `[`TabAlign`](/api/layout/type-aliases/TabAlign)` links become `[`AxisEnd`](/api/primitive/type-aliases/AxisEnd)`; the `[`AxisPosition`](/api/layout/type-aliases/AxisPosition)` links become `/api/primitive/type-aliases/AxisPosition`.
- Any `[`AxisPosition`](/api/layout/type-aliases/AxisPosition)` / `[`AxisSpread`](…)` markdown links in source JSDoc and curated docs must repoint to `/api/primitive/...`. Grep before editing: `grep -rln 'api/layout/type-aliases/AxisPosition\|api/layout/type-aliases/AxisSpread\|api/layout/type-aliases/TabAlign\|api/layout/type-aliases/SplitDirection' src/ docs/`.

**Curated guide edits:**
- [`docs/layouts/Split.md`](../docs/layouts/Split.md) — lines 3, 22, 28, 65, 89: replace `direction` with `orientation`, the `SplitDirection` link with `AxisOrientation` (`/api/primitive/type-aliases/AxisOrientation`), and `setDirection` with `setOrientation`.
- [`docs/components/ToolBar.md`](../docs/components/ToolBar.md) — lines 39, 47: `overflowSide` default `"right"` → `"end"`; `"left"`/`"right"` → `"start"`/`"end"`.
- [`docs/layouts/Accordion.md`](../docs/layouts/Accordion.md) — line 47: `chevronSide` default `"right"` → `"end"`.
- [`docs/layouts/Tab.md`](../docs/layouts/Tab.md) — line 104: `[`TabAlign`](/api/layout/type-aliases/TabAlign)` → `[`AxisEnd`](/api/primitive/type-aliases/AxisEnd)`; line 126 `AxisPosition` link → `/api/primitive/...`.
- [`docs/layouts/HFlow.md`](../docs/layouts/HFlow.md), [`docs/layouts/VFlow.md`](../docs/layouts/VFlow.md), [`docs/layouts/HBox.md`](../docs/layouts/HBox.md) — repoint any `AxisPosition`/`AxisSpread` links to `/api/primitive/...` (grep above enumerates them).
- [`docs/components/ToolBarSeparator.md`](../docs/components/ToolBarSeparator.md), [`docs/components/Scrollbar.md`] (if present) — repoint/remove the dropped-orientation-type references to `AxisOrientation`.
- [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts) — the manual sidebar lists curated pages only (Split/ToolBar/Accordion/Tab already present); no entry add/remove needed. Verify no manual link points at a removed `/api/.../type-aliases/SplitDirection` etc.

---

## Verification

1. `npx tsc -p tsconfig.lib.json --noEmit` → **0 errors**. (Catches every missed call site of the renamed `Split` API and the retyped options.)
2. Grep invariants (step 9): `grep -rn 'AxisAlign\|SplitDirection\|ScrollbarOrientation\|ToolBarOrientation\|ToolBarSeparatorOrientation\|ToolBarOverflowSide\|TabAlign' src/` → **zero matches**.
3. `npm run docs:build` → clean (0 errors, 0 link warnings; the lone acceptable warning is typedoc's "unsupported TypeScript version" notice). Confirms no dangling `/api/layout/type-aliases/{AxisPosition,AxisSpread,TabAlign,SplitDirection}` links remain.
4. Manual smoke (`npm run dev`, http://localhost:8015):
   - **Split** demo screen — horizontal and vertical splits drag and collapse as before; serialize → reload → restore round-trips (now via the `orientation` key).
   - **ToolBar** demo — horizontal `overflow: "menu"` still overflows the trailing buttons and the chevron sits at the trailing (`"end"`) edge; a `"start"` override leads it.
   - **Accordion** demo — `setChevronSide("start")` puts the chevron at the leading edge; default sits trailing.
   - **Slider**, **Scrollbar**, **ToolBarSeparator** — vertical/horizontal variants render unchanged (type-only).

---

## Potential Challenges

- **Split `_direction` read sites are numerous** (a dozen) — a missed rename is a compile error, caught by step-1 typecheck; enumerate against the list in step 4 before editing.
- **`SplitGutter` constructor positional `direction` arg** (Split.ts:749) is a *different* parameter than the renamed `Split` field — feed `this._orientation` but do not rename `SplitGutter`'s own API.
- **Persisted layout JSON** written with the old `direction` key won't restore — accepted (prerelease, decision above); no shim.
- **Doc link path drift** — moving `AxisPosition`/`AxisSpread` to the primitive group changes their generated API path; the grep in Documentation Impact must run before editing so no `/api/layout/...` link is left dangling (would surface as a `docs:build` link warning).

---

## Critical Files

- [`src/typescript/lib/primitive/Placement.ts`](../src/typescript/lib/primitive/Placement.ts), [`Position.ts`](../src/typescript/lib/primitive/Position.ts) — the SPDX-header + `@category` convention the new `Axis.ts` mirrors.
- [`src/typescript/lib/layout/AxisAlign.ts`](../src/typescript/lib/layout/AxisAlign.ts) — the JSDoc bodies to carry over (deleted after).
- [`src/typescript/lib/primitive/index.ts`](../src/typescript/lib/primitive/index.ts), [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts) — barrels (touches-shared).
- [`src/typescript/lib/layout/Split.ts`](../src/typescript/lib/layout/Split.ts) — the rename's hot file; read all `_direction` reads before editing.
- [`src/typescript/lib/component/menubar/ToolBar.ts`](../src/typescript/lib/component/menubar/ToolBar.ts) `_positionOverflowTrigger` and [`AccordionHeader.ts`](../src/typescript/lib/component/container/AccordionHeader.ts) `placeIndicator` — the two behavior-relevant render paths (verified ordering-only).
- [`typedoc.json`](../typedoc.json) — entry-point-driven API page grouping (why the page path moves to `/api/primitive/`).

---

## Non-Goals

- **Physical edge family** (`HorizontalSide`/`VerticalSide`/`Edge`, `DropZone`, `PopoverPlacement`, `ArrowDirection`) — owned by the sibling `primitive-edge-vocabulary` plan; not defined or touched here. (Both plans edit `Scrollbar.ts`, at different lines: this plan retypes `ScrollbarOrientation`; the sibling touches `ArrowDirection`.)
- **`TabOrientation` / `RailOrientation`** — three-value writing-mode unions, a different concept; left as-is.
- **RTL flipping** — `AxisEnd`/`AxisPosition` names signal logical intent, but actual right-to-left mirroring of `start`/`end` is future work.
- **Renaming `SplitGutter`/`CollapseButton`/`WindowBorder` `getDirection`/`setDirection`** — different classes, out of scope.
- **A `direction`-key back-compat shim** in layout serialization — prerelease, intentionally omitted.
