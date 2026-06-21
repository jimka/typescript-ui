---
depends-on: [box-main-axis-justification]
touches-shared: [src/typescript/lib/layout/BoxLayout.ts, src/typescript/lib/layout/HBox.ts, src/typescript/lib/layout/VBox.ts]
---

# Box Cross-Axis Align-Self — Implementation Plan

## Overview

Add **per-child cross-axis alignment** ("align-self") to the single-axis box layouts `HBox`/`VBox`. Today every box places children on the cross axis with a single row/column-wide policy, and — since the `feature/decouple-equal-stretching` merge made `stretching` default to **`false` in both `"preferred"` and `"equal"` mode** ([BoxLayout.ts:74](../src/typescript/lib/layout/BoxLayout.ts#L74), [BoxLayout.ts:100](../src/typescript/lib/layout/BoxLayout.ts#L100)) — the **non-stretch** cross path is now the common case, not an edge case. There is no way for a single child to opt into a different cross-axis position (top/centre/bottom in an HBox; left/centre/right in a VBox) or to stretch on the cross axis while its siblings keep their default placement.

The current cross-axis default is **not uniform across the two boxes** (and is **not** uniform across modes):

| Box  | Mode (non-stretch)        | Cross default today |
|------|---------------------------|---------------------|
| HBox | `"preferred"` ([HBox.ts:470](../src/typescript/lib/layout/HBox.ts#L470)) | **baseline-aligned** via `rowChildY` + `computeRowMetrics`; null-baseline children centre in the text line |
| HBox | `"equal"` ([HBox.ts:339](../src/typescript/lib/layout/HBox.ts#L339)) | **baseline-aligned** via `rowChildY` + `computeRowMetrics` at preferred height |
| VBox | `"preferred"` ([VBox.ts:393](../src/typescript/lib/layout/VBox.ts#L393)) | **left-aligned (WEST origin)** at `min(preferred.width, containerSize.width)` from `insets.getLeft()` — *not* baseline, *not* centred |
| VBox | `"equal"` ([VBox.ts:292](../src/typescript/lib/layout/VBox.ts#L292)) | **left-aligned (WEST origin)** at preferred width from `insets.getLeft()` |

When the box is `stretching`, both modes fill the full cross extent ([HBox.ts:312](../src/typescript/lib/layout/HBox.ts#L312), [HBox.ts:442](../src/typescript/lib/layout/HBox.ts#L442), [VBox.ts:280](../src/typescript/lib/layout/VBox.ts#L280), [VBox.ts:395](../src/typescript/lib/layout/VBox.ts#L395)). That fill is what per-child align-self overrides.

The feature **reuses the existing per-child `anchor`/`fill` constraints** already carried on `LayoutConstraints` ([LayoutConstraints.ts:23](../src/typescript/lib/layout/LayoutConstraints.ts#L23)) — no new constraint field. A child whose constraints set the **cross-axis component** of `anchor` (NORTH/SOUTH for HBox, WEST/EAST for VBox; CENTER on either axis stays inert) is positioned at that cross edge instead of on the row baseline / leading cross edge; a child whose constraints set a **cross-axis `fill`** (`FillType.VERTICAL` in an HBox, `FillType.HORIZONTAL` in a VBox, or `FillType.BOTH`) stretches to the full cross extent. Children that set neither keep today's exact default — baseline (HBox) or WEST-origin preferred (VBox).

The hook is a single per-child decision factored into one shared helper `BoxLayout.crossPlacement` so HBox and VBox share the projection logic, applied in **both** the `layoutPreferredMode` placement loop **and** the `layoutEqualMode` non-stretch branch of each box (the surfaces where a child sits smaller than its cross band). This plan touches **only the cross axis** and composes cleanly with the sibling `box-main-axis-justification` plan, which owns the **main axis** (the `lead`/`gap`/cursor math) — the two never touch the same offset.

---

## Architecture Decisions

### Reuse `anchor`/`fill`; do not add a new constraint field

`LayoutConstraints` already carries `fill?: FillType | null` ([LayoutConstraints.ts:23](../src/typescript/lib/layout/LayoutConstraints.ts#L23)) and `anchor?: AnchorType | null` ([LayoutConstraints.ts:24](../src/typescript/lib/layout/LayoutConstraints.ts#L24)), and `LayoutManager.resolveBounds` already reads them and applies anchor displacement when a child is smaller than its cell ([LayoutManager.ts:287](../src/typescript/lib/layout/LayoutManager.ts#L287)). `AnchorType` has the full 9-point set incl. NORTH/SOUTH/WEST/EAST/CENTER; `FillType` has HORIZONTAL/VERTICAL/BOTH/NONE. These express everything align-self needs. A dedicated `alignSelf` field would duplicate the meaning of `anchor` and force a new mapping; reuse is strictly simpler and matches how `Grid` already lets a child override `fill`/`anchor`. **Decision: reuse.**

The **main-axis** component of `anchor` is *not* consulted by the box (main-axis sequencing is owned by the box loop and, in `"preferred"` mode, by the sibling `justify` option). Only the **cross-axis** component projects:

| Box  | Cross axis | Cross anchor values read        | Cross fill value read                  |
|------|-----------|---------------------------------|----------------------------------------|
| HBox | vertical  | `NORTH`=top, `SOUTH`=bottom, `CENTER`/`WEST`/`EAST`=inert | `VERTICAL` or `BOTH` = stretch vertically |
| VBox | horizontal| `WEST`=left, `EAST`=right, `CENTER`/`NORTH`/`SOUTH`=inert | `HORIZONTAL` or `BOTH` = stretch horizontally |

A child that sets only a main-axis anchor (e.g. `WEST` in an HBox) projects to "no cross intent" — it does *not* opt out of the default placement path (see the precedence decision). Only a value whose **cross component is non-CENTER**, or a **cross-axis fill**, counts as an explicit align-self.

### Default-preserving precedence: the default path stays unless the child explicitly sets a cross-axis intent

A child with **no cross-axis intent** must keep today's behaviour byte-for-byte: baseline alignment via `rowChildY` (HBox, both modes) / WEST-origin preferred extent (VBox, both modes). The per-child decision is therefore a gate, evaluated for each child:

1. **Global `stretching` on AND the child sets no cross intent** → fill the cross extent (today's stretch). Unchanged.
2. **Child sets an explicit cross-axis `fill`** (`VERTICAL`/`BOTH` in HBox, `HORIZONTAL`/`BOTH` in VBox) → stretch this child to the full cross band, regardless of global `stretching`. This is "align-self: stretch".
3. **Child sets an explicit cross-axis `anchor`** (cross component ≠ CENTER, i.e. NORTH/SOUTH for HBox, WEST/EAST for VBox) → place the child at its natural cross extent, displaced to that cross edge within the full cross band.
4. **Otherwise** → today's default: HBox uses `rowChildY` (baseline/null-centre); VBox uses the leading (WEST) cross edge at preferred width.

"Explicit cross intent" = case 2 or case 3. What makes the gate default-preserving: a `CENTER` anchor or a main-axis-only anchor (`WEST`/`EAST` in HBox; `NORTH`/`SOUTH` in VBox) does **not** trip cases 2/3, so it falls to case 4 and the default path runs as today. We do *not* treat a bare `CENTER` as "align-self: center", because for HBox that would silently replace the baseline default (which is *not* a geometric centre — it is text-baseline alignment) for any child that happens to carry a `CENTER` anchor for another manager, and for VBox it would silently shift a WEST-origin child to centre. **CENTER is treated as "no cross intent"** and yields the default. This is the minimal, non-surprising rule; documented explicitly.

> Rationale for excluding CENTER: HBox's default cross placement is *baseline alignment*, which is more specific and more useful than geometric centring for text; VBox's default is a deliberate WEST origin. Reserving the explicit anchors (N/S, W/E) and explicit fills as the only opt-outs means no existing call site that set `anchor: CENTER` for a different manager changes behaviour when its component is later dropped into a box.

### Cross band = the full row/column cross extent, not the child's own extent

For an anchored or cross-stretched child, the "cell" it is positioned within is the **full cross extent** of the row (HBox: the working `containerSize.height` minus cross insets, i.e. the same band `stretching` fills) / column (VBox: `containerSize.width` minus cross insets). The child's own (capped) cross extent sits inside that band; anchor displacement moves it to the band's leading/trailing/centre edge.

For HBox the cross band's leading edge is `insets.getTop()` and its extent is `crossExtent = containerSize.height - (insets.getTop() + insets.getBottom())`. For VBox the leading edge is `insets.getLeft()` and `crossExtent = containerSize.width - (insets.getLeft() + insets.getRight())`.

> Note in equal mode the band is the same `containerSize.{height|width}` band the stretch branch fills ([HBox.ts:317](../src/typescript/lib/layout/HBox.ts#L317), [VBox.ts:281](../src/typescript/lib/layout/VBox.ts#L281)). The cross extent passed to the helper is identical to preferred mode; only the *main* extent (cell width/height) differs, and that stays the box's concern.

### Compute the cross offset/extent in the helper; do not delegate to `resolveBounds`

`resolveBounds` already does anchor displacement when a child is smaller than its cell ([LayoutManager.ts:350](../src/typescript/lib/layout/LayoutManager.ts#L350)), but it merges the child's **stored** `fill` over any fallback the caller passes with `||` ([LayoutManager.ts:287](../src/typescript/lib/layout/LayoutManager.ts#L287)) — a stored fill *wins*. A child that set `fill: VERTICAL` (cross-stretch in HBox) would, if the box passed `BOTH`, still resolve to `VERTICAL` and **not** fill the main axis, leaving its main extent at preferred and triggering an unwanted main-axis anchor displace. Routing the align-self path through `resolveBounds` therefore risks the box losing control of the main axis.

So the plan does **not** call `placeComponent`/`resolveBounds` to derive the align-self geometry. Instead `BoxLayout.crossPlacement` returns the cross **offset and extent** (the analogue of `resolveBounds`' cross branch, but reading the child's projected cross anchor/fill), and the box composes it with its own main `x`/`width` (HBox) / `y`/`height` (VBox) and commits via the existing `placeComponent(..., FillType.BOTH)` call using the *computed* cross offset as `y`/`x` and the *computed* cross extent as the cross size. This keeps one commit path and reuses the box's main-axis math untouched. Mitigation is structural — the box never lets `resolveBounds` re-derive the cross axis.

### Interaction with global `stretching`: per-child align-self overrides it

When the box is `stretching`, a child that sets an explicit cross anchor (case 3) **shrinks-and-anchors** rather than filling — align-self overrides the global stretch *for that child only*. Justification: `stretching` is the row-wide default; an explicit per-child anchor is a more specific instruction and should win, exactly as CSS `align-self` overrides the container's `align-items`. A child that sets an explicit cross fill (case 2) also "wins" but resolves to the same fill outcome as global stretch, so it is a no-op divergence. Siblings without cross intent keep filling. No special code beyond the per-child gate — the gate is evaluated before the `stretching` branch.

Because the gate runs first, the box must size the helper's `naturalCross` from the child's **preferred** cross extent (capped to the band and the child max), **not** the stretch-inflated `heights[idx]` (HBox) / inflated default width (VBox). Otherwise "shrink-and-anchor" wouldn't shrink: under global stretch the child's height/width was already inflated to the band. (For the cross-*fill* case the helper ignores `naturalCross` and returns the full band, so stretch vs. preferred is moot there.)

### Orthogonality with the sibling `justify` plan

`justify` (sibling plan) distributes **main-axis** slack: it adds a `lead` to the initial main cursor and a `gap` between children, and changes the cursor advance from `getWidth()`/`getHeight()` to `widths[idx]`/`heights[idx]`. This plan touches **only** the cross coordinate (`y` in HBox, `x` in VBox) and the cross extent passed to `placeComponent`. The two edit disjoint arguments of the same `placeComponent` call: justify owns `x`+`width` (HBox) / `y`+`height` (VBox); align-self owns `y`+`height` (HBox) / `x`+`width` (VBox). They compose by construction — neither reads nor writes the other's offset. The `"preferred"`-mode Ordered Steps below assume the sibling plan's loop shape (`for (let idx …)` with `widths[]`/`heights[]` arrays and a `lead`/`gap`-adjusted main cursor) is already in place; this plan slots the cross computation into that same loop. The equal-mode hook is independent of justify (justify is a no-op in equal mode), so it does not depend on the sibling refactor.

---

## Public API (TypeScript Signatures)

No new public types, options, or setters. The feature is consumed entirely through the existing per-child constraints:

```typescript
// HBox: anchor a single child to the bottom of the row, others stay baseline-aligned.
row.addComponent(tallChild, { anchor: AnchorType.SOUTH });

// HBox: stretch a single child to the full row height (align-self: stretch),
// while the row's global `stretching` stays false.
row.addComponent(divider, { fill: FillType.VERTICAL });

// VBox: pin a single child to the right edge of the column (default is left/WEST).
column.addComponent(badge, { anchor: AnchorType.EAST });

// VBox: stretch one child to the full column width.
column.addComponent(rule, { fill: FillType.HORIZONTAL });
```

`addComponent(component, constraints?: LayoutConstraints)` already accepts a `LayoutConstraints` bag carrying `anchor`/`fill`; no signature changes.

### New shared helper on `BoxLayout`

```typescript
export abstract class BoxLayout extends LayoutManager {
    /**
     * Resolves a child's cross-axis offset and extent within the full cross
     * band, honouring an explicit per-child cross `fill`/`anchor` (align-self).
     * Returns null when the child sets no explicit cross intent, signalling the
     * caller to fall back to its default cross placement (HBox baseline /
     * VBox WEST-origin preferred width).
     */
    protected crossPlacement(
        component:     Component,
        crossLead:     number,   // band leading edge (insets.top for HBox / insets.left for VBox)
        crossExtent:   number,   // full cross band extent
        naturalCross:  number,   // the child's preferred cross extent, capped to band + max
        horizontal:    boolean,  // true = HBox (cross = vertical), false = VBox (cross = horizontal)
    ): { offset: number; extent: number } | null;
}
```

- Returns `null` ⇒ "no explicit cross intent" ⇒ caller keeps its default path (HBox `rowChildY`; VBox WEST-origin preferred width).
- Returns `{ offset, extent }` ⇒ caller commits the child at that cross offset/extent (composed with its own main `x`/`width`).

---

## Internal Structure

### `BoxLayout.crossPlacement` body

Reads the child's stored constraints, projects `anchor`/`fill` onto the cross axis, and returns the cross offset+extent — or `null` to defer to the default.

```typescript
protected crossPlacement(
    component: Component,
    crossLead: number,
    crossExtent: number,
    naturalCross: number,
    horizontal: boolean,
): { offset: number; extent: number } | null {
    const c = this.getLayoutConstraints(component);
    const fill = c?.fill ?? null;
    const anchor = c?.anchor ?? null;

    // Cross-axis fill (align-self: stretch).
    const crossFill = horizontal
        ? (fill === FillType.VERTICAL || fill === FillType.BOTH)
        : (fill === FillType.HORIZONTAL || fill === FillType.BOTH);

    if (crossFill) {
        return { offset: crossLead, extent: crossExtent };
    }

    // Cross-axis anchor edge (align-self: start/end). CENTER and main-only
    // anchors return null → caller keeps its default (baseline / WEST-origin).
    let edge: "lead" | "trail" | null = null;

    if (anchor !== null) {
        if (horizontal) {
            if (anchor === AnchorType.NORTH || anchor === AnchorType.NORTHWEST || anchor === AnchorType.NORTHEAST) {
                edge = "lead";
            } else if (anchor === AnchorType.SOUTH || anchor === AnchorType.SOUTHWEST || anchor === AnchorType.SOUTHEAST) {
                edge = "trail";
            }
        } else {
            if (anchor === AnchorType.WEST || anchor === AnchorType.NORTHWEST || anchor === AnchorType.SOUTHWEST) {
                edge = "lead";
            } else if (anchor === AnchorType.EAST || anchor === AnchorType.NORTHEAST || anchor === AnchorType.SOUTHEAST) {
                edge = "trail";
            }
        }
    }

    if (edge === null) {
        return null;   // no explicit cross intent → default path
    }

    const extent = Math.min(naturalCross, crossExtent);
    const offset = edge === "lead"
        ? crossLead
        : crossLead + (crossExtent - extent);

    return { offset, extent };
}
```

> The corner anchors (NORTHWEST etc.) carry a cross component (N→top, S→bottom for HBox; W→left, E→right for VBox), so they project to an edge. Pure-main anchors (WEST/EAST in HBox; NORTH/SOUTH in VBox) and CENTER return `null`. `naturalCross` is clamped to the band so an over-large child fills the band exactly (extent === crossExtent, offset === crossLead) — same result as fill, which is correct.

### HBox `"preferred"` mode — cross hook (atop the sibling plan's loop)

The sibling `justify` plan leaves the placement loop ([HBox.ts:468](../src/typescript/lib/layout/HBox.ts#L468)–476) shaped like this (main-axis cursor `x` already carries `lead`/`gap`):

```typescript
const crossLead   = insets.getTop();
const crossExtent = containerSize.height - (insets.getTop() + insets.getBottom());

for (let idx = 0; idx < components.length; idx += 1) {
    const component = components[idx];

    // naturalCross for align-self is the child's *preferred* height capped to
    // the band + max — independent of the stretch-inflated heights[idx].
    const pref    = component.getPreferredSize();
    const maxSize = component.getMaxSize();
    let naturalCross = pref ? Math.min(pref.height, crossExtent) : crossExtent;
    if (maxSize) {
        naturalCross = Math.min(naturalCross, maxSize.height);
    }

    const cross = this.crossPlacement(component, crossLead, crossExtent, naturalCross, true);

    if (cross) {
        // Explicit align-self: place within the full cross band.
        this.placeComponent(component, x, cross.offset, widths[idx], cross.extent, FillType.BOTH);
    } else {
        // Default: baseline / null-centre placement (unchanged).
        const y = this.rowChildY(insets.getTop(), heights[idx], baselines[idx], rowAscent, rowDescent);
        this.placeComponent(component, x, y, widths[idx], heights[idx], FillType.BOTH);
    }

    x += widths[idx];        // sibling plan: advance by resolved width
    x += spacing + gap;      // sibling plan: spacing + justify gap
}
```

The only new lines are `crossLead`/`crossExtent`, the per-child `naturalCross`, and the `cross` branch. The `else` branch is verbatim today's body ([HBox.ts:470](../src/typescript/lib/layout/HBox.ts#L470)–472). `heights[idx]` (possibly stretch-inflated at [HBox.ts:442](../src/typescript/lib/layout/HBox.ts#L442)–443) is used only in the `else` (default) branch; the align-self branch sizes from preferred so it shrinks-and-anchors even under global stretch.

### HBox `"equal"` mode — cross hook (non-stretch branch)

The non-stretch branch of `layoutEqualMode` ([HBox.ts:325](../src/typescript/lib/layout/HBox.ts#L325)–345) baseline-aligns children at preferred height via `rowChildY`. Add the same gate; the cross band is the full container height (the band the stretch branch fills with `containerSize.height`):

```typescript
const crossLead   = insets.getTop();
const crossExtent = containerSize.height;   // equal-mode stretch band (no bottom inset subtraction — mirror line 317)

for (let idx = 0; idx < components.length; idx += 1) {
    const component = components[idx];

    const cross = this.crossPlacement(component, crossLead, crossExtent, heights[idx], true);

    if (cross) {
        this.placeComponent(component, x, cross.offset, cellWidth, cross.extent, FillType.BOTH);
    } else {
        const y = this.rowChildY(insets.getTop(), heights[idx], baselines[idx], rowAscent, rowDescent);
        this.placeComponent(component, x, y, cellWidth, heights[idx], FillType.BOTH);
    }

    x += cellWidth + spacing;
}
```

`heights[idx]` here is already the child's preferred height ([HBox.ts:331](../src/typescript/lib/layout/HBox.ts#L331)) — equal mode never inflates the cross axis when not stretching — so it is a sound `naturalCross`. The `else` branch is verbatim today's body ([HBox.ts:340](../src/typescript/lib/layout/HBox.ts#L340)–342). The main axis (`x`, `cellWidth`) is untouched.

> Match the equal-stretch band exactly: the stretch branch passes `containerSize.height` ([HBox.ts:317](../src/typescript/lib/layout/HBox.ts#L317)) with `y = insets.getTop()` and no bottom-inset subtraction, so the align-self band must use the same `crossExtent = containerSize.height` for an `EAST`/fill child to reach the same trailing edge a stretched sibling fills.

### VBox `"preferred"` mode — cross hook (atop the sibling plan's loop)

The sibling plan refactors VBox `layoutPreferredMode` ([VBox.ts:360](../src/typescript/lib/layout/VBox.ts#L360)) to a height pre-pass + a `for (let idx …)` placement loop with main-axis cursor `y` carrying `lead`/`gap`. The cross axis is horizontal; today's default is **WEST origin** at preferred width ([VBox.ts:370](../src/typescript/lib/layout/VBox.ts#L370), [VBox.ts:393](../src/typescript/lib/layout/VBox.ts#L393)–403):

```typescript
const crossLead   = insets.getLeft();
const crossExtent = containerSize.width - (insets.getLeft() + insets.getRight());

for (let idx = 0; idx < components.length; idx += 1) {
    const component = components[idx];

    // Default cross width (today's body, VBox.ts:393–403): full width when
    // stretching/sizeless, else preferred capped to the column, capped to max.
    const size    = component.getPreferredSize();
    const maxSize = component.getMaxSize();
    let defaultWidth: number;
    if (!size || this.isStretching()) {
        defaultWidth = containerSize.width;
    } else {
        defaultWidth = Math.min(size.width, containerSize.width);
    }
    if (maxSize) {
        defaultWidth = Math.min(defaultWidth, maxSize.width);
    }

    // naturalCross for align-self is the child's *preferred* cross extent
    // (independent of global stretching), capped to band + max.
    let naturalWidth = size ? Math.min(size.width, crossExtent) : crossExtent;
    if (maxSize) {
        naturalWidth = Math.min(naturalWidth, maxSize.width);
    }

    const cross = this.crossPlacement(component, crossLead, crossExtent, naturalWidth, false);

    if (cross) {
        this.placeComponent(component, cross.offset, y, cross.extent, heights[idx], FillType.BOTH);
    } else {
        // Default: WEST origin at preferred width (unchanged).
        this.placeComponent(component, crossLead, y, defaultWidth, heights[idx], FillType.BOTH);
    }

    y += heights[idx];
    y += spacing + gap;
}
```

The `else` branch reproduces today's VBox cross-width computation verbatim (currently inline in the single loop, [VBox.ts:393](../src/typescript/lib/layout/VBox.ts#L393)–405, with the WEST origin `x = insets.getLeft()` at [VBox.ts:370](../src/typescript/lib/layout/VBox.ts#L370)); the only additions are `crossLead`/`crossExtent`, `naturalWidth`, and the `cross` branch. `x` (the column's leading/WEST cross edge, == `insets.getLeft()`) is replaced by `cross.offset` for anchored children and stays `crossLead` otherwise.

> The default `defaultWidth` keeps reading `containerSize.width` (not the inset-trimmed `crossExtent`) to stay byte-identical with today's body; only the align-self path uses the inset-trimmed band, which is correct for placing an anchored child between the left and right insets.

### VBox `"equal"` mode — cross hook (non-stretch branch)

The non-stretch branch of `layoutEqualMode` ([VBox.ts:292](../src/typescript/lib/layout/VBox.ts#L292)–299) places children at **preferred width, WEST origin** (`x = insets.getLeft()`). Add the gate; the band is the full container width (the band the stretch branch fills with `containerSize.width`, [VBox.ts:281](../src/typescript/lib/layout/VBox.ts#L281)):

```typescript
const crossLead   = insets.getLeft();
const crossExtent = containerSize.width;   // equal-mode stretch band (mirror line 281)

for (const component of components) {
    const size  = component.getPreferredSize();
    const width = size ? size.width : 0;

    const cross = this.crossPlacement(component, crossLead, crossExtent, width, false);

    if (cross) {
        this.placeComponent(component, cross.offset, y, cross.extent, cellHeight, FillType.BOTH);
    } else {
        this.placeComponent(component, x, y, width, cellHeight, FillType.BOTH);   // WEST origin, unchanged
    }

    y += cellHeight + spacing;
}
```

`width` (the child's preferred width, [VBox.ts:294](../src/typescript/lib/layout/VBox.ts#L294)) is the `naturalCross`. The `else` branch is verbatim today's body ([VBox.ts:296](../src/typescript/lib/layout/VBox.ts#L296)). The main axis (`y`, `cellHeight`) is untouched.

---

## Ordered Implementation Steps

> The `"preferred"`-mode steps depend on `box-main-axis-justification` being implemented first: its loop refactor (the `widths[]`/`heights[]` arrays, the `for (let idx …)` placement loops, and the `lead`/`gap` main cursor) is the substrate they edit. If implemented before the sibling, adapt the cross hook into the current loops (HBox already has `widths[]`/`heights[]`/`baselines[]`; VBox needs the height pre-pass the sibling introduces). The `"equal"`-mode steps are independent of the sibling.

1. **`BoxLayout.ts` — `crossPlacement` helper.** Add the `protected crossPlacement(...)` method (body above), importing `FillType` and `AnchorType` (and `Component` is already imported via `LayoutManager` types — verify and add if missing). JSDoc it analogous to the neighbouring `computeShrink` ([BoxLayout.ts:340](../src/typescript/lib/layout/BoxLayout.ts#L340)). → verify: `npx tsc --noEmit` clean.
2. **`HBox.ts` — `layoutPreferredMode` cross hook.** In the placement loop ([HBox.ts:468](../src/typescript/lib/layout/HBox.ts#L468)), add `crossLead`/`crossExtent`, compute the preferred-derived `naturalCross` per child, call `crossPlacement`, and branch: explicit → place in the band, default → today's `rowChildY` path. → verify: typecheck; a plain HBox renders unchanged.
3. **`HBox.ts` — `layoutEqualMode` cross hook.** In the non-stretch branch ([HBox.ts:325](../src/typescript/lib/layout/HBox.ts#L325)–345), add `crossLead = insets.getTop()` / `crossExtent = containerSize.height`, call `crossPlacement` with `heights[idx]`, branch as above; the stretch branch ([HBox.ts:312](../src/typescript/lib/layout/HBox.ts#L312)–323) is untouched. → verify: typecheck.
4. **`VBox.ts` — `layoutPreferredMode` cross hook.** In the placement loop ([VBox.ts:373](../src/typescript/lib/layout/VBox.ts#L373)), add `crossLead`/`crossExtent`, split the existing inline cross-width computation into `defaultWidth` (today's, used in the `else`) and `naturalWidth` (preferred-derived, passed to the helper), call `crossPlacement`, branch (default = WEST origin). → verify: typecheck.
5. **`VBox.ts` — `layoutEqualMode` cross hook.** In the non-stretch branch ([VBox.ts:292](../src/typescript/lib/layout/VBox.ts#L292)–299), add `crossLead = insets.getLeft()` / `crossExtent = containerSize.width`, call `crossPlacement` with the child's preferred `width`, branch (default = WEST origin); the stretch branch ([VBox.ts:280](../src/typescript/lib/layout/VBox.ts#L280)–290) is untouched. → verify: typecheck.
6. **Demo wiring.** Add an align-self demo to `src/typescript/AlignSelfPanel.ts` (new) or extend `HBoxPanel`/`VBoxPanel`: an HBox row with one child `{ anchor: AnchorType.NORTH }`, one `{ anchor: AnchorType.SOUTH }`, one `{ fill: FillType.VERTICAL }`, and the rest default; mirror with a VBox column using `WEST`/`EAST`/`HORIZONTAL`. Include one `mode: "equal"` row/column to exercise the equal-mode hook. Register it the way sibling panels are registered (follow `HBoxPanel`/`VBoxPanel`'s entry point). → verify: `npm run dev` (app on `http://localhost:8015`) renders the placements distinctly.
7. **Regression checkpoint.** `grep -n 'rowChildY' src/typescript/lib/layout/HBox.ts` — confirm `rowChildY` is still called in the default (`else`) branch of *both* `layoutPreferredMode` and `layoutEqualMode`, and that a child with no constraints reaches it. Construct a plain `new HBox()`/`new VBox()` (and one with `mode: "equal"`) with no per-child constraints and confirm pixel-identical placement to `master`.
8. **Docs.** Update `docs/layouts/HBox.md`, `docs/layouts/VBox.md`, `docs/layouts/Constraints.md`, and the `LayoutConstraints` JSDoc per Documentation Impact. → verify: `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/layout/BoxLayout.ts` — `crossPlacement` helper + `FillType`/`AnchorType`/`Component` imports |
| Modify | `src/typescript/lib/layout/HBox.ts` — `layoutPreferredMode` + `layoutEqualMode` (non-stretch) cross hooks |
| Modify | `src/typescript/lib/layout/VBox.ts` — `layoutPreferredMode` + `layoutEqualMode` (non-stretch) cross hooks |
| Create (optional) | `src/typescript/AlignSelfPanel.ts` — demo row/column (preferred + equal) exercising the cross anchors + cross fill |
| Modify | `docs/layouts/HBox.md` — per-child cross-axis alignment section |
| Modify | `docs/layouts/VBox.md` — per-child cross-axis alignment section |
| Modify | `docs/layouts/Constraints.md` — note box managers honour cross-axis `anchor`/`fill` as align-self |
| Modify | `src/typescript/lib/layout/LayoutConstraints.ts` — extend `anchor`/`fill` JSDoc to mention box align-self |

> No barrel change: the feature adds no exported symbol (`crossPlacement` is `protected`). `src/typescript/lib/layout/index.ts` is untouched.

---

## Verification

- **Typecheck:** `npx tsc --noEmit` clean.
- **Default path unchanged.** A plain `new HBox()` / `new VBox()` with no per-child `anchor`/`fill`, in *both* `"preferred"` and `"equal"` mode, is pixel-identical to `master`: HBox stays baseline-aligned, VBox stays WEST-origin. The only code reaching a child with no cross intent is the `else` branch, which is verbatim today's body.
- **HBox cross anchors.** In the demo row: a `{ anchor: AnchorType.NORTH }` child sits flush with the row top; `{ anchor: AnchorType.SOUTH }` flush with the bottom; `{ fill: FillType.VERTICAL }` fills the full row height; un-constrained children stay baseline-aligned amongst themselves. The anchored children do **not** disturb the baseline of the un-constrained ones.
- **VBox cross anchors.** In the demo column: `{ anchor: AnchorType.WEST }` flush left (== default), `{ anchor: AnchorType.EAST }` flush right, `{ fill: FillType.HORIZONTAL }` full width, others at the leading (WEST) edge at preferred width — unchanged.
- **Equal-mode align-self.** Repeat both checks in a `mode: "equal"` box: an `EAST`/`SOUTH` child anchors to the trailing cross edge within its equal cell's full cross band, while un-constrained children keep today's equal-mode default (HBox baseline, VBox WEST origin) and the equal *cell width/height* (main axis) is unchanged.
- **CENTER / main-only anchors are inert.** A child with `{ anchor: AnchorType.CENTER }` or (HBox) `{ anchor: AnchorType.WEST }` / (VBox) `{ anchor: AnchorType.NORTH }` keeps the default (no cross displacement) — confirms the gate does not hijack non-cross anchors.
- **align-self overrides global stretching.** Set the box `stretching: true` and give one child `{ anchor: AnchorType.SOUTH }` (HBox): that child shrinks to its preferred height and pins to the bottom while its siblings still fill the row height.
- **Scoping caution:** many same-type panels coexist on the page — scope DevTools queries to the demo panel's class (e.g. `.AlignSelfPanel .HBox`), per the project's measurement convention.
- **Docs build:** `npm run docs:build` — 0 errors, 0 link warnings.

---

## Documentation Impact

- **No barrel change.** `crossPlacement` is `protected`; no new exported symbol. `src/typescript/lib/layout/index.ts` is untouched.
- **`LayoutConstraints` JSDoc** (`fill` [LayoutConstraints.ts:23](../src/typescript/lib/layout/LayoutConstraints.ts#L23), `anchor` [LayoutConstraints.ts:24](../src/typescript/lib/layout/LayoutConstraints.ts#L24)): extend the `fill` and `anchor` field docs to note that `HBox`/`VBox` read the **cross-axis component** as per-child align-self (cross fill = stretch; cross anchor edge = pin) in **both** preferred and equal mode, and that the main-axis component / CENTER are ignored by the box (the box owns main-axis sequencing). Same-bucket `{@link HBox}`/`{@link VBox}` references are fine (cross-bucket would need markdown links per `_shared/docs-conventions.md`).
- **`docs/layouts/HBox.md`** and **`docs/layouts/VBox.md`**: add a "Per-child cross-axis alignment (align-self)" section after the existing per-child-constraints / stretching discussion, showing the `addComponent(child, { anchor: ... })` and `{ fill: ... }` snippets, stating the projection table (which anchor → which edge), the CENTER/main-only no-op rule, that it applies in both modes, and that an explicit per-child intent overrides global `stretching`. State the differing defaults explicitly (HBox baseline; VBox WEST origin).
- **`docs/layouts/Constraints.md`**: in the shared `LayoutConstraints` table note that, beyond Grid, the box managers (`HBox`/`VBox`) now consume the **cross component** of `anchor`/`fill` as align-self; link to the new HBox/VBox sections.
- **Sidebar / catalog:** no new page → `docs/.vitepress/config.mts` and `docs/layouts/index.md` need no new entries (the catalog row for HBox/VBox may optionally mention align-self).

---

## Potential Challenges

- **`resolveBounds` `||`-merge footgun.** A child's stored cross `fill` wins over any fallback `resolveBounds` is handed ([LayoutManager.ts:287](../src/typescript/lib/layout/LayoutManager.ts#L287)); this plan sidesteps it by computing the cross offset/extent in `crossPlacement` and committing through the box's own `placeComponent(..., FillType.BOTH)` — never letting `resolveBounds` re-derive the cross axis. Mitigation is structural.
- **Global stretch vs. preferred-derived `naturalCross`.** Under `stretching`, `heights[idx]` (HBox preferred mode) / the default width (VBox preferred mode) is inflated to the band; an anchored child must size from *preferred*, not the inflated value, or "shrink-and-anchor" wouldn't shrink. Mitigation: the box derives a separate `naturalCross` from `getPreferredSize()` for the helper, using the inflated value only on the default branch. (Equal mode never inflates the cross axis when not stretching, so `heights[idx]`/`width` there are already preferred.)
- **Equal-mode band mismatch.** The equal-stretch branches pass the *un-trimmed* `containerSize.{height|width}` as the band (no trailing-inset subtraction, [HBox.ts:317](../src/typescript/lib/layout/HBox.ts#L317), [VBox.ts:281](../src/typescript/lib/layout/VBox.ts#L281)); the align-self band must mirror that exact extent so a trailing-anchored or filled child lands where a stretched sibling would. Preferred mode trims both insets; equal mode does not. Mitigation: use the per-mode `crossExtent` shown in Internal Structure, not a single shared formula.
- **Over-large children.** A child whose preferred cross extent exceeds the band clamps to the band (`extent === crossExtent`, `offset === crossLead`) — visually identical to fill, the correct, non-surprising outcome.
- **Loop-shape coupling to the sibling plan (preferred mode only).** The preferred-mode hook assumes the sibling's `for (let idx …)` loops and `widths[]`/`heights[]` arrays. If implemented first, adapt to the current loops (HBox already has the arrays; VBox does not — add the height pre-pass the sibling introduces, scoped to this change). The equal-mode hook has no such dependency.

---

## Critical Files

- [`src/typescript/lib/layout/LayoutManager.ts:278`](../src/typescript/lib/layout/LayoutManager.ts#L278) — `resolveBounds`: the existing anchor-displacement math the helper mirrors ([line 350](../src/typescript/lib/layout/LayoutManager.ts#L350)), and the `||`-merge gotcha ([line 287](../src/typescript/lib/layout/LayoutManager.ts#L287)) that drives the "don't delegate" decision.
- [`src/typescript/lib/layout/HBox.ts:406`](../src/typescript/lib/layout/HBox.ts#L406) — `layoutPreferredMode` (loop at 468); [`layoutEqualMode:309`](../src/typescript/lib/layout/HBox.ts#L309) (non-stretch branch 325–345); `rowChildY` ([line 589](../src/typescript/lib/layout/HBox.ts#L589)) is the HBox default cross path to preserve.
- [`src/typescript/lib/layout/VBox.ts:360`](../src/typescript/lib/layout/VBox.ts#L360) — `layoutPreferredMode` (WEST-origin default + inline cross-width at 393–405); [`layoutEqualMode:274`](../src/typescript/lib/layout/VBox.ts#L274) (non-stretch branch 292–299, WEST origin).
- [`src/typescript/lib/layout/BoxLayout.ts:74`](../src/typescript/lib/layout/BoxLayout.ts#L74) — `_stretching = false` default (both modes); `applyOptions` ([line 100](../src/typescript/lib/layout/BoxLayout.ts#L100)) no longer derives stretching from mode; `computeShrink` ([line 340](../src/typescript/lib/layout/BoxLayout.ts#L340)) is the JSDoc precedent for the helper.
- [`src/typescript/lib/layout/LayoutConstraints.ts:23`](../src/typescript/lib/layout/LayoutConstraints.ts#L23) — the reused `fill` (23) / `anchor` (24) fields.
- [`src/typescript/lib/layout/AnchorType.ts`](../src/typescript/lib/layout/AnchorType.ts) — the 9-point enum projected onto the cross axis.
- `plans/box-main-axis-justification.md` — the sibling plan whose loop refactor the preferred-mode hook builds on (`depends-on`).

---

## Non-Goals

- **Main-axis justification** — owned by the sibling `box-main-axis-justification` plan; this plan never touches the main `x`/`width` (HBox) or `y`/`height` (VBox) offsets, nor equal-mode cell sizing.
- **A dedicated `alignSelf` constraint field** — intentionally rejected in favour of reusing `anchor`/`fill`; revisit only if a future need can't be expressed by the 9-point anchor + fill.
- **Treating `CENTER` as geometric centring** — `CENTER`/main-only anchors are deliberately inert so each box's default (HBox baseline, VBox WEST origin) and existing non-box anchors are preserved; true centring stays the domain of null-baseline auto-centring (HBox) and global stretch-off.
- **Equal-mode *main-axis* changes** — the equal cell width/height (main axis) is untouched; only the *cross* placement within the equal cell's full cross band gains align-self.
- **Cross-axis alignment for the other box managers** (`Grid`, `Border`, flows) — those already have their own per-child fill/anchor handling; unchanged.
