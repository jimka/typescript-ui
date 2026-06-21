---
touches-shared: [src/typescript/lib/layout/BoxLayout.ts, src/typescript/lib/layout/HBox.ts, src/typescript/lib/layout/VBox.ts]
---

# Box Main-Axis Justification — Implementation Plan

## Overview

Add a configurable **main-axis justification** to the single-axis box layouts `HBox`/`VBox`, plumbed through their shared `BoxLayout` base. Today, when a box in `"preferred"` mode has no weight cells and the children's combined main extent is shorter than the inner main extent, the children pack at the leading edge ([HBox.ts:466](../src/typescript/lib/layout/HBox.ts#L466), [VBox.ts:371](../src/typescript/lib/layout/VBox.ts#L371)) and the slack sits at the trailing edge — only a manual `Spacer` child can move it. This adds a `justify` option supporting `"start"` (current behaviour, default), `"center"`, `"end"`, `"between"`, `"around"`.

The option lives on `BoxLayout` ([BoxLayout.ts:51](../src/typescript/lib/layout/BoxLayout.ts#L51)) as a backing field with a typed getter/setter and `applyOptions` dispatch, mirroring the existing `_spacing`/`_stretching`/`_mode`/`_overflowSizing` plumbing. A shared helper `BoxLayout.justifyOffsets` returns a leading offset plus an inter-child gap; both `HBox.layoutPreferredMode` and `VBox.layoutPreferredMode` call it and apply the results inside their placement loops. This mirrors `FlowLayout.alignLead` ([FlowLayout.ts:299](../src/typescript/lib/layout/FlowLayout.ts#L299)) but is a superset: `alignLead` only moves a block (a leading offset), whereas the box version also distributes gaps *between* children for `"between"`/`"around"`.

This plan **only** touches `"preferred"` mode. Equal mode and the cross axis are out of scope (the latter is the sibling `box-cross-axis-align-self` plan, drafted next, which depends on the helper and field added here).

---

## Architecture Decisions

### Name the option `justify`, type `BoxJustify`

`justify` (not `pack`) — it reads as "justify content along the main axis", matches CSS `justify-content`, and avoids collision with the box's `weight`/fill vocabulary. The type is a new exported union:

```typescript
export type BoxJustify = "start" | "center" | "end" | "between" | "around";
```

`"between"`/`"around"` are the short forms of CSS `space-between`/`space-around`; the box vocabulary already uses single-word values (`"preferred"`, `"equal"`, `"min"`), so the shorter names fit the house style. Default is `"start"` — byte-for-byte the current behaviour.

### Justify applies only in `"preferred"` mode, only when residual > 0 and no weight cells consume it

Justification is meaningful only when leftover main-axis space exists. Three no-op gates, checked inside `layoutPreferredMode`:

1. **Weight cells present** — `totalWeight > 0`. Weight cells already absorb all slack (`remaining` is split among them, [HBox.ts:558](../src/typescript/lib/layout/HBox.ts#L558)), so there is no residual to justify. No-op.
2. **No residual / overflow** — `residual <= 0`. When the content exactly fills or overflows the inner main extent (the row is shrinking, scrolling, or clipping), there is nothing to distribute, and pushing children would shove the leading child out of view. Clamp to `"start"` (offset 0, gap 0), exactly as `alignLead` clamps an over-long line to 0 ([FlowLayout.ts:300](../src/typescript/lib/layout/FlowLayout.ts#L300)).
3. **`justify === "start"`** — the fast path; the helper returns `{ lead: 0, gap: 0 }` and the loops behave identically to today.

The residual is computed from the **placed** child extents, not the resolved widths array — see the next decision.

### Compute residual from placed extents, advancing by spacing (not `getWidth()`) for the gap math

The existing HBox loop advances the cursor by `component.getWidth()` *after* `placeComponent` ([HBox.ts:474](../src/typescript/lib/layout/HBox.ts#L474)), because `placeComponent` may clamp the child below the resolved width. To justify correctly the layout must know the *total placed content extent* before positioning. The plan therefore:

- Sums the resolved per-child main extents (the `widths[]` / per-iteration `height`) plus `spacing * (n - 1)` into `contentMain` **before** the placement loop. In `"preferred"` mode with no weight cells, `placeComponent` does not clamp below the resolved width for normally-sized children, so the resolved sum is the placed sum; any clamp can only *increase* a child past its resolved size when it has a larger min, which would push `contentMain` up and drive `residual <= 0`, correctly triggering the `"start"` clamp. This matches how `alignLead` measures `contentMain` from cell extents up front.
- Computes `residual = innerMain - contentMain`, where `innerMain` is `containerSize.{width|height}` minus the main-axis insets. **Insets:** the placement loop already starts the cursor at `insets.getLeft()`/`getTop()` and the inner main extent excludes both insets, so `innerMain = containerSize.main - (insets.lead + insets.trail)`. HBox uses `insets.getLeft() + insets.getRight()`; VBox uses `insets.getTop() + insets.getBottom()`.

> Note: `containerSize` here is the *working* size, already inflated for overflow ([HBox.ts:285](../src/typescript/lib/layout/HBox.ts#L285)). When the host scrolls, `containerSize.main` is inflated to the content's min total, so `residual` is ~0 and justify no-ops — the correct behaviour (do not justify a scrolling row).

### Distribution math — leading offset + inter-child gap

`BoxLayout.justifyOffsets(contentMain, innerMain, count)` returns `{ lead: number; gap: number }`:

| `justify`   | `lead`           | `gap` (added on top of `spacing`)        |
|-------------|------------------|------------------------------------------|
| `"start"`   | `0`              | `0`                                      |
| `"center"`  | `residual / 2`   | `0`                                      |
| `"end"`     | `residual`       | `0`                                      |
| `"between"` | `0`              | `count > 1 ? residual / (count - 1) : 0` |
| `"around"`  | `residual / (2 * count)` | `count > 0 ? residual / count : 0` |

where `residual = max(0, innerMain - contentMain)`.

- `"between"`: first child at the leading edge, last at the trailing edge, equal extra gap between each pair. With one child it degenerates to `"start"` (`gap` guarded to 0).
- `"around"`: equal space around every child — half a unit before the first and after the last, a full unit between neighbours. `lead` is half the per-child unit; `gap` is a full unit. With one child, `lead = residual/2` (centres it) and `gap` is unused.
- `lead`/`gap` are **added** to the existing leading inset and existing spacing respectively; the helper never returns negatives because `residual` is floored at 0 (the overflow clamp).

### Shared helper on `BoxLayout`, analogous to `alignLead`

Add `protected justifyOffsets(...)` to `BoxLayout` so both subclasses share one implementation (the math is axis-agnostic — it operates on scalar main extents). This mirrors `FlowLayout.alignLead`'s placement on the flow base. The subclasses remain responsible for measuring `contentMain` and `innerMain` (axis-specific) and for the no-op gates that depend on `totalWeight` (already computed locally in each `layoutPreferredMode`).

### Equal mode and stretching: justify is a no-op there

In `"equal"` mode the cells are sized to `(inner − spacing·(n−1)) / n` and therefore **always tile the full main extent** (or overflow it past the min floor while scrolling) — they are never under-filled, so there is no *trailing* main-axis residual to justify. `justify` is silently ignored in equal mode, documented as such, and no code path in `layoutEqualMode` is touched.

**Main axis vs cross axis — why the `feature/decouple-equal-stretching` merge does not pull equal mode into scope.** Since that merge ([BoxLayout.ts:111](../src/typescript/lib/layout/BoxLayout.ts#L111)) `stretching` defaults to `false` in **both** modes — the old `mode === "equal" → stretching = true` default is gone — so a non-stretching equal-mode box now leaves children at their preferred cross-size and the surplus shows as visible empty space ([HBox.ts:325](../src/typescript/lib/layout/HBox.ts#L325)–345, [VBox.ts:292](../src/typescript/lib/layout/VBox.ts#L292)–299). It is tempting to think `justify` should fill that space, but it is on the **cross** axis; `justify` only distributes slack **along** the main axis. Positioning a child within its cross extent is the sibling `box-cross-axis-align-self` plan's domain. `justify` (main axis) and `stretching`/align-self (cross axis) are orthogonal, so they compose freely with no interaction code.

---

## Public API (TypeScript Signatures)

### `BoxLayout.ts`

```typescript
export type BoxJustify = "start" | "center" | "end" | "between" | "around";

export interface BoxLayoutOptions extends LayoutManagerOptions {
    spacing?:         number;
    stretching?:      boolean;
    mode?:            BoxMode;
    overflowSizing?:  BoxOverflowSizing;
    justify?:         BoxJustify;          // NEW
}

export abstract class BoxLayout extends LayoutManager {
    protected _justify: BoxJustify = "start";   // NEW backing field

    // dispatched in applyOptions after overflowSizing
    getJustify(): BoxJustify;                     // NEW
    setJustify(justify: BoxJustify): this;        // NEW

    // shared offset helper, called by both subclasses' layoutPreferredMode
    protected justifyOffsets(contentMain: number, innerMain: number, count: number): { lead: number; gap: number };   // NEW
}
```

- Backing field: `_justify`; default `"start"`.
- Getter/setter: `getJustify()` / `setJustify()` (chainable `this`, matching `setMode`/`setStretching`).
- `applyOptions` adds, after the `overflowSizing` block:
  ```typescript
  if (options.justify !== undefined) {
      this.setJustify(options.justify);
  }
  ```

### Helper body (`BoxLayout.justifyOffsets`)

```typescript
protected justifyOffsets(contentMain: number, innerMain: number, count: number): { lead: number; gap: number } {
    const residual = Math.max(0, innerMain - contentMain);

    if (residual === 0 || this._justify === "start") {
        return { lead: 0, gap: 0 };
    }

    if (this._justify === "center") {
        return { lead: residual / 2, gap: 0 };
    }

    if (this._justify === "end") {
        return { lead: residual, gap: 0 };
    }

    if (this._justify === "between") {
        return { lead: 0, gap: count > 1 ? residual / (count - 1) : 0 };
    }

    // "around"
    return { lead: count > 0 ? residual / (2 * count) : 0, gap: count > 0 ? residual / count : 0 };
}
```

> The `totalWeight > 0` no-op gate is **not** in the helper — it lives at the call site in `layoutPreferredMode`, which already has `totalWeight` in scope. The helper only sees `residual === 0`, covering the overflow clamp.

---

## Internal Structure

### HBox.layoutPreferredMode insertion (`HBox.ts:406`–`477`)

After `widths[]`/`heights[]`/`baselines[]` are populated and `rowAscent`/`rowDescent` are resolved, before the placement loop:

```typescript
// Sum placed main extents to find the trailing slack, then ask the
// shared helper how to distribute it. Weight cells already consume all
// slack, so justify is a no-op when any are present.
let lead = 0;
let gap  = 0;

if (totalWeight === 0) {
    let contentWidth = spacing * (components.length - 1);
    for (const w of widths) {
        contentWidth += w;
    }

    const innerWidth = containerSize.width - (insets.getLeft() + insets.getRight());
    ({ lead, gap } = this.justifyOffsets(contentWidth, innerWidth, components.length));
}

let x = insets.getLeft() + lead;

for (let idx = 0; idx < components.length; idx += 1) {
    const component = components[idx];
    const y = this.rowChildY(insets.getTop(), heights[idx], baselines[idx], rowAscent, rowDescent);

    this.placeComponent(component, x, y, widths[idx], heights[idx], FillType.BOTH);

    x += widths[idx];        // advance by the resolved width, not getWidth()
    x += spacing + gap;
}
```

Two surgical changes to the existing loop ([HBox.ts:466](../src/typescript/lib/layout/HBox.ts#L466)–477):
1. `let x = insets.getLeft();` → `let x = insets.getLeft() + lead;`
2. `x += component.getWidth();` → `x += widths[idx];` and `x += spacing;` → `x += spacing + gap;`

**Why `widths[idx]` instead of `getWidth()`:** the inter-child `gap` must be added to the *same* extent that `contentWidth` summed, or the trailing edge drifts. `widths[idx]` is the resolved width; `placeComponent` can only clamp it upward (toward a larger min), which the residual clamp already absorbs. Using `getWidth()` would double-count any clamp delta against the gap. This is a behaviour-preserving change for `justify: "start"` (where `gap === 0` and the resolved width equals the placed width for fitting rows).

### VBox.layoutPreferredMode insertion (`VBox.ts:360`–`410`)

VBox resolves heights inline in the loop rather than into an array, so the residual must be computed in a pre-pass. Mirror the HBox structure:

```typescript
// Pre-pass: resolve each child's height into an array so the trailing
// slack can be measured before placement (mirrors HBox's widths[]).
const heights: number[] = [];
for (const component of components) {
    const weight  = this.getLayoutConstraints(component)?.weight ?? 0;
    const size    = component.getPreferredSize();
    const minSize = component.getMinSize();
    const maxSize = component.getMaxSize();
    heights.push(this.resolveChildHeight(size, minSize, maxSize, weight, totalWeight, remainingHeight, shrinkRatio));
}

let lead = 0;
let gap  = 0;

if (totalWeight === 0) {
    let contentHeight = spacing * (components.length - 1);
    for (const h of heights) {
        contentHeight += h;
    }

    const innerHeight = containerSize.height - (insets.getTop() + insets.getBottom());
    ({ lead, gap } = this.justifyOffsets(contentHeight, innerHeight, components.length));
}

const x = insets.getLeft();
let y = insets.getTop() + lead;

for (let idx = 0; idx < components.length; idx += 1) {
    const component = components[idx];
    const size    = component.getPreferredSize();
    const maxSize = component.getMaxSize();

    // cross-axis width: unchanged from the current loop body
    let width: number;
    if (!size || this.isStretching()) {
        width = containerSize.width;
    } else {
        width = Math.min(size.width, containerSize.width);
    }
    if (maxSize) {
        width = Math.min(width, maxSize.width);
    }

    this.placeComponent(component, x, y, width, heights[idx], FillType.BOTH);

    y += heights[idx];
    y += spacing + gap;
}
```

This refactors the current single loop ([VBox.ts:373](../src/typescript/lib/layout/VBox.ts#L373)–409) into a height pre-pass plus a placement loop. `totalWeight` and `remainingHeight` are already in scope from the `measureFixedHeights`/`computeShrink` calls above ([VBox.ts:361](../src/typescript/lib/layout/VBox.ts#L361)). Cursor advance changes from `component.getHeight()` to `heights[idx]` for the same reason as HBox.

> **Alternative considered & rejected:** keeping VBox's single loop and summing `getHeight()` in a second pass after placement. Rejected — the offset must be known *before* the first child is placed, so a pre-pass is unavoidable. The pre-pass is the minimal change.

---

## Ordered Implementation Steps

1. **`BoxLayout.ts` — type + option + field.** Add the `BoxJustify` union (with JSDoc mirroring `BoxOverflowSizing`'s doc style), add `justify?: BoxJustify` to `BoxLayoutOptions`, add `protected _justify: BoxJustify = "start";` to the field group. → verify: `npx tsc --noEmit` clean.
2. **`BoxLayout.ts` — getter/setter.** Add `getJustify()`/`setJustify()` after `getOverflowSizing`/`setOverflowSizing`, JSDoc'd like the neighbours. → verify: typecheck.
3. **`BoxLayout.ts` — applyOptions dispatch.** Add the `if (options.justify !== undefined) this.setJustify(...)` block after the `overflowSizing` block. → verify: typecheck.
4. **`BoxLayout.ts` — `justifyOffsets` helper.** Add the protected helper (body above), JSDoc'd analogous to `alignLead`. → verify: typecheck.
5. **`HBox.ts` — wire `layoutPreferredMode`.** Compute `lead`/`gap` (gated on `totalWeight === 0`), apply `lead` to the initial `x`, advance by `widths[idx]` + `spacing + gap`. → verify: typecheck.
6. **`VBox.ts` — wire `layoutPreferredMode`.** Refactor to the height pre-pass + placement loop, compute `lead`/`gap`, apply. → verify: typecheck.
7. **Demo wiring (optional but recommended for eyeballing).** Add a `justify` control to `HBoxPanel`/`VBoxPanel` or simply construct one panel with `HBox({ justify: "between" })` to verify visually (see Verification). → verify: dev server renders.
8. **Docs.** Update `docs/layouts/HBox.md`, `docs/layouts/VBox.md`, `docs/layouts/index.md` catalog rows, and the barrel export (`src/typescript/lib/layout/index.ts`) per Documentation Impact. → verify: `npm run docs:build` 0 errors / 0 link warnings.
9. **Regression checkpoint.** `grep -rn 'getWidth()\|getHeight()' src/typescript/lib/layout/HBox.ts src/typescript/lib/layout/VBox.ts` — confirm the preferred-mode cursor advances now use `widths[idx]`/`heights[idx]` and no stray `getWidth()`/`getHeight()` remain in those loops.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/layout/BoxLayout.ts` — `BoxJustify` type, `justify` option, `_justify` field, getter/setter, applyOptions dispatch, `justifyOffsets` helper |
| Modify | `src/typescript/lib/layout/HBox.ts` — `layoutPreferredMode` lead/gap wiring |
| Modify | `src/typescript/lib/layout/VBox.ts` — `layoutPreferredMode` height pre-pass + lead/gap wiring |
| Modify | `src/typescript/lib/layout/index.ts` — export the `BoxJustify` type alias |
| Modify | `docs/layouts/HBox.md` — justify section + methods-table row |
| Modify | `docs/layouts/VBox.md` — justify section + methods-table row |
| Modify | `docs/layouts/index.md` — catalog row mentions for HBox/VBox (optional) |
| Modify (optional) | `src/typescript/HBoxPanel.ts` / `src/typescript/VBoxPanel.ts` — a `justify` demo control |

---

## Verification

- **Typecheck:** `npx tsc --noEmit` clean.
- **`justify: "start"` is byte-identical to today.** With `gap === 0` and `lead === 0`, the only behavioural delta is the cursor advancing by `widths[idx]`/`heights[idx]` instead of `getWidth()`/`getHeight()`. For a fitting `"preferred"`-mode row these are equal; confirm visually that `HBoxPanel` (which uses a plain `new HBox()`) is unchanged.
- **Manual smoke — main demo:** the project's box demos are **`HBoxPanel`** (a `LayoutTestPanel` with a plain `new HBox()`, [src/typescript/HBoxPanel.ts](../src/typescript/HBoxPanel.ts)) and **`VBoxPanel`**. Run `npm run dev` (app on `http://localhost:8015`), open the HBox panel, and temporarily construct it with each `justify` value:
  - `"start"` — children at the west edge, slack east (unchanged).
  - `"center"` — block centred, equal slack on both sides.
  - `"end"` — children flush east.
  - `"between"` — first west, last east, even gaps between.
  - `"around"` — even gaps around every child (half-gaps at the ends).
  Repeat on `VBoxPanel` for the vertical axis.
- **No-op gates:** add a weight cell to one child (`addComponent(c, { weight: 1 })`) and confirm `justify` has no visible effect (the weight cell eats the slack). Shrink the host below the content extent and confirm the row clamps to `"start"` (nothing pushed out of view).
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).

---

## Documentation Impact

- **Barrel:** `BoxJustify` is exported from the per-subpath layout barrel `src/typescript/lib/layout/index.ts` ([index.ts:22](../src/typescript/lib/layout/index.ts#L22)), added to the existing `export type { BoxLayoutOptions, BoxMode, BoxOverflowSizing } from '~/layout/BoxLayout.js';` line. There is no root barrel.
- **Curated pages:** `docs/layouts/HBox.md` and `docs/layouts/VBox.md` each gain a "Justify" section (between "Overflow sizing" and "Per-child constraints" reads well) describing the five modes, the weight-cell/overflow no-op, and that it is `"preferred"`-mode-only; add a `setJustify(...)` row to each "Common methods" table and mention `justify` in the `HBoxOptions`/`VBoxOptions` declarative-options paragraph ([HBox.md:26](../docs/layouts/HBox.md#L26)).
- **Catalog + sidebar:** the catalog `docs/layouts/index.md` ([index.md:15](../docs/layouts/index.md#L15)) may note justify in the HBox/VBox row; the sidebar `docs/.vitepress/config.mts` already lists HBox/VBox and needs no new entry (no new page).
- **Cross-bucket JSDoc:** the `BoxJustify` JSDoc may `{@link HBox}`/`{@link VBox}` within the same `layout` bucket (same-bucket `{@link}` is fine; only cross-bucket references need markdown links per `_shared/docs-conventions.md`).

---

## Critical Files

- [`src/typescript/lib/layout/BoxLayout.ts`](../src/typescript/lib/layout/BoxLayout.ts) — the option/field/getter-setter pattern (`_overflowSizing` is the closest precedent) and `applyOptions` ordering.
- [`src/typescript/lib/layout/FlowLayout.ts:299`](../src/typescript/lib/layout/FlowLayout.ts#L299) — `alignLead`, the precedent for the offset helper and the residual-clamp-to-start rule.
- [`src/typescript/lib/layout/HBox.ts:406`](../src/typescript/lib/layout/HBox.ts#L406) — `layoutPreferredMode`, the placement loop edited here.
- [`src/typescript/lib/layout/VBox.ts:360`](../src/typescript/lib/layout/VBox.ts#L360) — `layoutPreferredMode`, refactored to a pre-pass + loop.

---

## Non-Goals

- **Cross-axis `align-self`** — covered by the sibling `box-cross-axis-align-self` plan, which depends on the `_justify` field and `justifyOffsets` helper this plan adds; it is drafted after this one.
- **Equal-mode justification** — equal cells leave no main-axis residual; intentionally a no-op.
- **Per-child justify overrides** — `justify` is a layout-wide setting; per-child positioning stays the domain of `AnchorType`/`FillType` constraints.
- **`Spacer`-child removal** — manual `Spacer` children keep working; this plan does not deprecate or rewrite any call site that uses them.
