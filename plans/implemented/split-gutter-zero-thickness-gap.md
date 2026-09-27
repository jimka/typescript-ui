---
touches-shared: [packages/lib/src/typescript/lib/layout/Split.ts]
---

# Zero-Thickness Split Gutter and Configurable Pane Gap — Implementation Plan

## Overview

`Split` reserves 4 px of main-axis space between every pair of panes (`GUTTER_SIZE`, [packages/lib/src/typescript/lib/layout/Split.ts:31](packages/lib/src/typescript/lib/layout/Split.ts#L31)) and gives the gutter that sits there an element 3 px wider on each side, so its real box is 10 px (`GUTTER_HIT_OVERHANG`, [packages/lib/src/typescript/lib/layout/Split.ts:37](packages/lib/src/typescript/lib/layout/Split.ts#L37)). `Border` does the same at a region's inner edge with its own pair of constants, `TRACK_SIZE` and `TRACK_OVERHANG` ([packages/lib/src/typescript/lib/layout/Border.ts:21](packages/lib/src/typescript/lib/layout/Border.ts#L21), [packages/lib/src/typescript/lib/layout/Border.ts:28](packages/lib/src/typescript/lib/layout/Border.ts#L28)). Both managers guarantee a 4 px **reserve** and a 10 px **hit box**. Neither guarantees a **visible divider**: an expanded gutter paints nothing, so what a user sees between two panes is the reserve plus whatever empty space the two neighbours' own content insets happen to leave.[^missing-invariant]

This plan removes the gutter's own main-axis thickness and makes the space between panes an explicit, configurable gap. The gutter element becomes pure overhang — `2 × GUTTER_HIT_OVERHANG` = 10 px, straddling the pane boundary 5 px into each neighbour — so the drag target keeps exactly the size it has today while contributing nothing to the layout. `Split` gains a `spacing` option that reserves the gap, defaulting to `0`. `Border` already has one ([packages/lib/src/typescript/lib/layout/Border.ts:79](packages/lib/src/typescript/lib/layout/Border.ts#L79)) and keeps its default of `5`; only its gutter placement changes, to centre the hit box on that gap.

The change touches `Split`, `Border` and `SplitGutter`. `Accordion` is out of scope — see `## Non-Goals`. Keeping the 10 px drag target reachable once it is nothing but overhang is the change's main risk; the reachability addendum below sets out the argument and enumerates what the overhang shadows.

---

## Architecture Decisions

### Reserve a gap, not a gutter — `Split` gains `spacing`

`Split` gets a `spacing?: number` option, a `_spacing` backing field, and `getComponentSpacing()` / `setComponentSpacing()` accessors. Every site that reserved `GUTTER_SIZE` reserves `this._spacing` instead, and `GUTTER_SIZE` is deleted. This mirrors `Border`'s own inter-region gap ([packages/lib/src/typescript/lib/layout/Border.ts:79](packages/lib/src/typescript/lib/layout/Border.ts#L79), [packages/lib/src/typescript/lib/layout/Border.ts:286-303](packages/lib/src/typescript/lib/layout/Border.ts#L286-L303)) and `BoxLayout`'s inter-child spacing ([packages/lib/src/typescript/lib/layout/BoxLayout.ts:106](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L106), [packages/lib/src/typescript/lib/layout/BoxLayout.ts:191-208](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L191-L208)), down to the accessor names.[^spacing-precedent]

### The default gap is `0`

`Split._spacing` starts at `0`. Panes touch out of the box, and the visible divider comes entirely from the panes' own insets. A consumer who wants a wider divider sets `spacing` themselves.[^default-zero]

### The gutter element is pure overhang, centred on the gap

`GUTTER_HIT_OVERHANG` goes from 3 to 5, and the element's main-axis size becomes `2 × GUTTER_HIT_OVERHANG` = 10 px with no contribution from the gap. The element is centred on the gap's midline, so it straddles the boundary 5 px into each neighbour. The 10 px figure is unchanged from today and is what keeps the 10 px chevron grip inside the element, which clips (`overflowX`/`overflowY: hidden`, [packages/lib/src/typescript/lib/core/ClassStyleRules.ts:141-142](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L141-L142)).[^main-axis-is-ten]

Worked example, horizontal `Split`, leading pane's trailing edge at `x = 200`:

| `spacing` | gap occupies | gutter element | next pane starts at |
|---|---|---|---|
| `0` (default) | nothing | `x=195, width=10` | `200` |
| `4` (today's effective value) | `200…204` | `x=197, width=10` | `204` |
| `12` | `200…212` | `x=201, width=10` | `212` |

### The visible divider is the gap plus each neighbour's *unpainted* facing inset

A pane's content insets only show as empty space when the pane paints no background of its own. A pane that paints has its insets inside its own painted surface, so they add nothing to the divider. The rule:

```
visible divider = spacing
                + (lhs paints a background ? 0 : lhs facing content inset)
                + (rhs paints a background ? 0 : rhs facing content inset)
```

The library owns `spacing`. The consumer owns both the insets and whether the pane paints. Only the combination of non-zero insets with no painted background produces a divider the library did not ask for.[^paint-rule]

| panes (facing content insets) | paints? | divider at `spacing: 0` | grip overhang per side |
|---|---|---|---|
| `Component` 0 \| `Component` 0 | no \| no | 0 px | +5.0 |
| `List` 0 \| `TextArea` 3 | yes \| yes | 0 px | +5.0 |
| `Button` 10 \| `Text` 0 | yes \| no | 0 px | +5.0 |
| `Panel` 4 \| `Panel` 4 | **no \| no** | **8 px** | +1.0 |

`Panel` is the only pane class in the demo app that combines non-zero insets with no painted background ([packages/lib/src/typescript/lib/core/Panel.ts:108](packages/lib/src/typescript/lib/core/Panel.ts#L108) sets `insets: Insets(4,4,4,4)`; `Panel` declares no background anywhere). That is why the reported defect appears on exactly the two demo panels built from `Panel` panes.[^demo-verdicts]

### The gutter carries `z-index: 1`

`SplitGutter` sets `zIndex` to `1` unless the caller supplies one. Panes carry no `z-index`, so `1` puts the gutter above them whatever order they were added in; a `Panel`'s overlay scrollbar carries `2` ([packages/lib/src/typescript/lib/core/Panel.ts:1734](packages/lib/src/typescript/lib/core/Panel.ts#L1734)), so it still wins over the gutter where the two overlap. With the gap at `0` there is no longer any part of the gutter that a pane does not overlap, so DOM order can no longer be relied on.[^zindex] The reachability addendum below works the consequences through in full.

### A locked gutter keeps its box and drops its pointer events

The `isMovable() ? GUTTER_HIT_OVERHANG : 0` gate in `Split.doLayout` is removed — with no `GUTTER_SIZE` left, a locked gutter would collapse to a 0 px element and clip its chevron away. Instead `SplitGutter.setMovable(false)` sets `pointerEvents: "none"` (and `setMovable(true)` restores `"auto"`), so a locked gutter's body stops swallowing the pane-edge clicks its overhang lies over. The chevron keeps its own `pointer-events: auto` ([packages/lib/src/typescript/lib/component/container/CollapseButton.ts:124](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L124)) and stays clickable.[^locked-gutter]

### `Border` keeps its `spacing` default of `5`

`Border`'s gap is pre-existing public API with a documented default of `5` ([packages/lib/docs/layouts/Border.md:45](packages/lib/docs/layouts/Border.md#L45)). Only its gutter placement changes, to centre the 10 px hit box on that gap instead of on a notional 4 px track at the region's edge — a 0.5 px shift at the default.[^border-default]

### `expandedBackground` defaults to `"transparent"`

All three managers construct the gutter with `expandedBackground: "transparent"` today, so `SplitGutter`'s own `var(--ts-ui-gutter-bg, #AAAAAA)` default ([packages/lib/src/typescript/lib/component/container/SplitGutter.ts:157](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L157), [packages/lib/src/typescript/lib/component/container/SplitGutter.ts:186](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L186)) is unreachable. The default becomes `"transparent"` and the three redundant arguments go. The option itself stays, for a consumer who wants a painted divider.[^expanded-background]

---

## Public API

`Split` gains one option and two accessors. Nothing is removed from the public surface.

```typescript
// packages/lib/src/typescript/lib/layout/Split.ts
export interface SplitOptions extends LayoutManagerOptions {
    // … existing fields unchanged …
    /**
     * Pixel gap reserved between adjacent panes — the space a gutter sits in.
     * Defaults to `0`, so panes touch and any visible divider comes from the
     * panes' own insets.
     */
    spacing?: number;
}

class Split extends LayoutManager {
    // Backing field, seeded by `applyOptions` via the setter.
    private _spacing: number = 0;

    /** Returns the pixel gap reserved between adjacent panes. */
    getComponentSpacing(): number;

    /** Sets the pixel gap between adjacent panes. Marks the container's layout pass as owed. */
    setComponentSpacing(spacing: number): this;
}
```

`SplitGutter`'s `expandedBackground` option keeps its signature; only its default value and doc comment change.

---

## Internal Structure

### `Split.ts` — constants

```typescript
// DELETE: const GUTTER_SIZE = 4;

// Half the gutter element's main-axis thickness. The gutter reserves
// no main-axis space of its own — the space between panes is the configurable
// `spacing` gap — so the element is pure overhang: 2 × GUTTER_HIT_OVERHANG =
// 10px, centred on the gap's midline and straddling the pane boundary 5px into
// each neighbour. 10px matches CollapseButton's own GRIP_ACROSS, which is what
// keeps the whole chevron inside the element (every Component clips).
const GUTTER_HIT_OVERHANG = 5;
```

### `Split.ts` — the reserve

`gutterTotal` is renamed `spacingTotal` and reads the field:

```typescript
private spacingTotal(componentCount: number): number {
    return Math.max(0, componentCount - 1) * this._spacing;
}
```

Its five call sites ([packages/lib/src/typescript/lib/layout/Split.ts:1165](packages/lib/src/typescript/lib/layout/Split.ts#L1165), [:1210](packages/lib/src/typescript/lib/layout/Split.ts#L1210), [:1301](packages/lib/src/typescript/lib/layout/Split.ts#L1301), [:2435](packages/lib/src/typescript/lib/layout/Split.ts#L2435), [:2510](packages/lib/src/typescript/lib/layout/Split.ts#L2510)) change name only. Two further sites read the constant directly and become `this._spacing`:

- [packages/lib/src/typescript/lib/layout/Split.ts:2039](packages/lib/src/typescript/lib/layout/Split.ts#L2039) — `splitTotal += GUTTER_SIZE;` in `computeTotalMinSize`.
- [packages/lib/src/typescript/lib/layout/Split.ts:2436](packages/lib/src/typescript/lib/layout/Split.ts#L2436) — `strips * (COLLAPSE_STRIP_SIZE - GUTTER_SIZE) + hiddenDividers * GUTTER_SIZE`.

The strip arithmetic stays exact at any gap: for two panes with the first collapsed, `available = mainInner − spacing` and `expandedTotal = available − (18 − spacing) = mainInner − 18`, which is what the placement loop lays out (an 18 px strip slot, then the surviving pane, with no gap between them).

### `Split.ts` — the expanded-divider placement

Replaces [packages/lib/src/typescript/lib/layout/Split.ts:2209-2226](packages/lib/src/typescript/lib/layout/Split.ts#L2209-L2226):

```typescript
// The element reserves nothing: 2 × GUTTER_HIT_OVERHANG of pure overhang,
// centred on the gap's midline. Not gated on `isMovable()` — with no reserve
// left, a locked gutter would collapse to 0px and clip its chevron away; a
// locked gutter drops its pointer events instead (see SplitGutter.setMovable).
const hitSize = 2 * GUTTER_HIT_OVERHANG;
const midGap  = this._spacing / 2;

if (horizontal) {
    gutter.setX(x + midGap - GUTTER_HIT_OVERHANG);
    gutter.setY(y);
    gutter.setWidth(hitSize);
    gutter.setHeight(crossSize);

    x += this._spacing;
} else {
    gutter.setX(x);
    gutter.setY(y + midGap - GUTTER_HIT_OVERHANG);
    gutter.setWidth(crossSize);
    gutter.setHeight(hitSize);

    y += this._spacing;
}
```

An odd `spacing` puts the element on a half-pixel. That is accepted — it is what centring on the gap means, and the boundary midpoint is already how the geometry is asserted.

### `Border.ts` — the inner-edge hit box

`TRACK_SIZE` is deleted, `TRACK_OVERHANG` becomes `5`, and `innerEdgeTrack` is renamed `innerEdgeHitBox` (there is no longer a track) and centred on `_spacing`:

```typescript
private innerEdgeHitBox(placement: Placement, x: number, y: number, width: number, height: number): { x: number; y: number; width: number; height: number } {
    const across = 2 * TRACK_OVERHANG;
    const midGap = this._spacing / 2;

    switch (placement) {
        case Placement.NORTH: return { x, y: y + height + midGap - TRACK_OVERHANG, width, height: across };
        case Placement.SOUTH: return { x, y: y - midGap - TRACK_OVERHANG,          width, height: across };
        case Placement.WEST:  return { x: x + width + midGap - TRACK_OVERHANG, y, width: across, height };
        case Placement.EAST:  return { x: x - midGap - TRACK_OVERHANG,          y, width: across, height };
        default:              return { x, y, width, height };
    }
}
```

The collapsed branch at [packages/lib/src/typescript/lib/layout/Border.ts:943](packages/lib/src/typescript/lib/layout/Border.ts#L943) is untouched: a collapsed region's gutter still fills the region's own strip-sized rect.

### `SplitGutter.ts` — z-index and the locked state

```typescript
// Above the panes (which carry no z-index) so DOM insertion order cannot put a
// pane on top of the gutter, and below a Panel's overlay scrollbar (z-index 2)
// so the bar still wins where the gutter's overhang lies over it.
const GUTTER_Z_INDEX = 1;
```

In the constructor, replacing the `if (!this._movable) { this.setPointerEvents("none"); }` block at [packages/lib/src/typescript/lib/component/container/SplitGutter.ts:212-214](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L212-L214):

```typescript
this.setZIndex(options?.zIndex ?? GUTTER_Z_INDEX);
```

The removed block is now redundant: `applyOptions` already dispatches `setMovable`, which owns the pointer-events decision:

```typescript
setMovable(value: boolean): this {
    this._movable = value;

    // A locked gutter is not a resize handle, so its body must not swallow the
    // pointer events of the pane edges its overhang lies over — the same
    // reason a fixed `Border` gutter never takes them. The chevron child keeps
    // its own `pointer-events: auto`, so it stays clickable either way.
    this.setPointerEvents(value ? "auto" : "none");

    // (existing hover-clearing and applyCursor calls unchanged)
    …
}
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/layout/Split.ts`** — add `spacing?: number` to `SplitOptions` ([:78-105](packages/lib/src/typescript/lib/layout/Split.ts#L78-L105)) with the doc comment from `## Public API`.
2. **`Split.ts`** — add `private _spacing: number = 0;` beside the other private fields, and `getComponentSpacing()` / `setComponentSpacing()` modelled on [packages/lib/src/typescript/lib/layout/BoxLayout.ts:191-208](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L191-L208). `setComponentSpacing` must end with `this.getContainer()?.invalidateLayout();` before `return this;`.
   Check: `grep -n 'invalidateLayout' packages/lib/src/typescript/lib/layout/Split.ts` shows the new call.
3. **`Split.ts`** — dispatch it from `applyOptions` ([:291](packages/lib/src/typescript/lib/layout/Split.ts#L291)), in the same `if (options.spacing !== undefined)` shape the neighbouring fields use.
4. **`Split.ts`** — delete `const GUTTER_SIZE = 4;` ([:31](packages/lib/src/typescript/lib/layout/Split.ts#L31)) and change `GUTTER_HIT_OVERHANG` to `5` with the new comment from `## Internal Structure`.
   Check: `grep -n 'GUTTER_SIZE' packages/lib/src/typescript/lib/layout/Split.ts` — expect zero matches once steps 5-7 are done.
5. **`Split.ts`** — rename `gutterTotal` to `spacingTotal` ([:1986-1988](packages/lib/src/typescript/lib/layout/Split.ts#L1986-L1988)) and make its body `Math.max(0, componentCount - 1) * this._spacing`. Update its doc comment (it returns the reserved gap total, not a gutter footprint) and its five call sites ([:1165](packages/lib/src/typescript/lib/layout/Split.ts#L1165), [:1210](packages/lib/src/typescript/lib/layout/Split.ts#L1210), [:1301](packages/lib/src/typescript/lib/layout/Split.ts#L1301), [:2435](packages/lib/src/typescript/lib/layout/Split.ts#L2435), [:2510](packages/lib/src/typescript/lib/layout/Split.ts#L2510)).
   Check: `grep -n 'gutterTotal' packages/lib/src/typescript/lib/layout/Split.ts` — expect zero matches.
6. **`Split.ts`** — replace the two direct `GUTTER_SIZE` reads with `this._spacing`: `computeTotalMinSize` ([:2039](packages/lib/src/typescript/lib/layout/Split.ts#L2039)) and the `expandedTotal` expression ([:2436](packages/lib/src/typescript/lib/layout/Split.ts#L2436)).
7. **`Split.ts`** — replace the expanded-divider placement block ([:2209-2226](packages/lib/src/typescript/lib/layout/Split.ts#L2209-L2226)) with the version in `## Internal Structure`.
8. **`Split.ts`** — refresh the four comments that name the old 4 px divider: the gutter-construction comment ([:2096-2098](packages/lib/src/typescript/lib/layout/Split.ts#L2096-L2098)), the toward-end-hidden-divider comment ([:2413-2418](packages/lib/src/typescript/lib/layout/Split.ts#L2413-L2418)), the `expandedTotal` rationale ([:2424-2434](packages/lib/src/typescript/lib/layout/Split.ts#L2424-L2434)), and `recalculateSizes`' ([:2503-2508](packages/lib/src/typescript/lib/layout/Split.ts#L2503-L2508)). Each should say "the reserved `spacing` gap" instead of "the `GUTTER_SIZE` divider".
9. **`Split.ts`** — drop `expandedBackground: "transparent"` from the gutter construction ([:2099](packages/lib/src/typescript/lib/layout/Split.ts#L2099)), leaving `{ collapseTrigger: this._collapseTrigger }`.
10. **`packages/lib/src/typescript/lib/layout/Border.ts`** — delete `const TRACK_SIZE = 4;` ([:21](packages/lib/src/typescript/lib/layout/Border.ts#L21)) and change `TRACK_OVERHANG` to `5` ([:28](packages/lib/src/typescript/lib/layout/Border.ts#L28)), rewriting both comments to say the gutter reserves nothing and its 10 px element is centred on the inter-region `spacing` gap.
11. **`Border.ts`** — rename `innerEdgeTrack` to `innerEdgeHitBox` ([:968-978](packages/lib/src/typescript/lib/layout/Border.ts#L968-L978)), replace its body with the version in `## Internal Structure`, and rewrite its doc comment. Update the one call site ([:943](packages/lib/src/typescript/lib/layout/Border.ts#L943)) and the comment above it ([:940-942](packages/lib/src/typescript/lib/layout/Border.ts#L940-L942)).
    Check: `grep -n 'TRACK_SIZE\|innerEdgeTrack' packages/lib/src/typescript/lib/layout/Border.ts` — expect zero matches.
12. **`Border.ts`** — drop `expandedBackground: "transparent"` from `ensureGutter`'s construction block ([:819-824](packages/lib/src/typescript/lib/layout/Border.ts#L819-L824)) and update the method's doc comment, which calls the gutter "transparent in its divider state" ([:801-809](packages/lib/src/typescript/lib/layout/Border.ts#L801-L809)).
13. **`packages/lib/src/typescript/lib/layout/Accordion.ts`** — drop `expandedBackground: "transparent"` from the resize gutter's construction ([:1897](packages/lib/src/typescript/lib/layout/Accordion.ts#L1897)), leaving `{ collapsible: false }`. Nothing else in `Accordion.ts` changes.
    Check: `grep -rn 'expandedBackground' packages/lib/src/` shows it only in `SplitGutter.ts`.
14. **`packages/lib/src/typescript/lib/component/container/SplitGutter.ts`** — add `const GUTTER_Z_INDEX = 1;` with the comment from `## Internal Structure`, beside the other module constants.
15. **`SplitGutter.ts`** — change the `_expandedBackground` default from `"var(--ts-ui-gutter-bg, #AAAAAA)"` to `"transparent"` in both places ([:157](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L157), [:186](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L186)), and rewrite the `expandedBackground` option's doc comment ([:63-68](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L63-L68)): it defaults to `"transparent"` because no manager paints an expanded gutter — the divider a user sees is the owning manager's configured gap — and a caller-supplied value fills the whole 10 px element, which overlaps both neighbours.
    Check: `grep -n 'ts-ui-gutter-bg' packages/lib/src/typescript/lib/component/container/SplitGutter.ts` — expect zero matches.
16. **`SplitGutter.ts`** — replace the `if (!this._movable) { this.setPointerEvents("none"); }` block ([:212-214](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L212-L214)) with `this.setZIndex(options?.zIndex ?? GUTTER_Z_INDEX);` and move its comment onto `setMovable`.
17. **`SplitGutter.ts`** — add the `this.setPointerEvents(value ? "auto" : "none");` line to `setMovable` ([:330-344](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L330-L344)), and extend the method's doc comment to say it also toggles whether the gutter body takes pointer events.
    Check: `npm run typecheck` passes.
18. **`packages/lib/tests/component/layout/Split.gutterHitBox.test.ts`** — rewrite the two locked-gutter cases ([:78-88](packages/lib/tests/component/layout/Split.gutterHitBox.test.ts#L78-L88), [:103-116](packages/lib/tests/component/layout/Split.gutterHitBox.test.ts#L103-L116)) per `## Expected Behaviour` item 9, and update the two widening cases' `toBeGreaterThan(4)` assertions to the exact-edge form in items 2-3. Add items 1, 4, 5, 10 here.
19. **`packages/lib/tests/component/layout/Border.test.ts`** — update the gutter-geometry case ([:407-425](packages/lib/tests/component/layout/Border.test.ts#L407-L425)): replace `TRACK_MID_PX = 2` ([:378](packages/lib/tests/component/layout/Border.test.ts#L378)) with the manager's own `getComponentSpacing() / 2`, and assert the exact 10 px thickness rather than `toBeGreaterThanOrEqual(GRIP_ACROSS_PX)`. Add items 12-13.
20. **New test file** `packages/lib/tests/component/layout/Split.spacing.test.ts` — the gap option's own coverage: items 6, 7, 8, 11.
21. Run `npm test` from the worktree root and update the ten remaining pre-existing failures in `packages/lib/tests/component/layout/Split.dragFrameGate.test.ts` (5), `packages/lib/tests/component/layout/Split.resizeMode.test.ts` (4) and `packages/lib/tests/component/layout/CollapseStaticParticipants.test.ts` (1), following `## Verification`'s rule for what may be renumbered.
22. **Docs** — apply every edit in `## Documentation Impact`.
23. Run the full verification pass below.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Border.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/SplitGutter.ts` |
| Modify | `packages/lib/tests/component/layout/Split.gutterHitBox.test.ts` |
| Modify | `packages/lib/tests/component/layout/Split.dragFrameGate.test.ts` |
| Modify | `packages/lib/tests/component/layout/Split.resizeMode.test.ts` |
| Modify | `packages/lib/tests/component/layout/CollapseStaticParticipants.test.ts` |
| Modify | `packages/lib/tests/component/layout/Border.test.ts` |
| Create | `packages/lib/tests/component/layout/Split.spacing.test.ts` |
| Modify | `packages/lib/docs/layouts/Split.md` |
| Modify | `packages/lib/docs/layouts/Border.md` |
| Modify | `packages/lib/docs/concepts/theming.md` |

---

## Expected Behaviour

Each case names the mutation it is there to catch. All are offline-testable unless marked otherwise.

1. **Default `spacing` is `0`; panes touch.** Two-pane horizontal `Split` with no `spacing` option, laid out in a 400×300 host: `leadingPane.getX() + leadingPane.getWidth() === nextPane.getX()`, and the two widths sum to `host.getInnerSize()!.width`. *Catches*: a non-zero default, or a `spacingTotal` that still subtracts a constant.
2. **The gutter element is 10 px on the main axis and `crossSize` on the other, straddling the boundary.** Same fixture: `gutter.getWidth() === 10`; `gutter.getX() === boundary - 5` and `gutter.getX() + gutter.getWidth() === boundary + 5`, where `boundary = leadingPane.getX() + leadingPane.getWidth()`; `gutter.getHeight() === leadingPane.getHeight()`. *Catches*: an element sized `spacing + 2 × overhang`, which at the default gap would be 0 px and clip the chevron away; an overhang left at 3. Asserting both edges rather than only the centre is what stops the `0`-equals-`0` pass a centre-only assertion allows at `spacing: 0`.
3. **Vertical orientation: the same relationships on `y`/`height`, with `getWidth() === leadingPane.getWidth()`.** *Catches*: a change applied to the horizontal arm only.
4. **A configured gap reaches the pass, and the element does not grow with it.** `new Split({ orientation: 'horizontal', spacing: 12 })`, two panes: `nextPane.getX() - (leadingPane.getX() + leadingPane.getWidth()) === 12`; `gutter.getWidth()` is still `10`; `gutter.getX() === boundary + 6 - 5`. *Catches*: conflating the gap with the element thickness — the single most likely mutation, and the only assertion that separates the two observables.
5. **Same with `new Split({ orientation: 'vertical', spacing: 12 })`.** *Catches*: a one-arm fix on the new code path.
6. **`setComponentSpacing` marks the pass owed.** After `host.doLayout()`, `host.isLayoutDirty() === false`; after `split.setComponentSpacing(8)`, `host.isLayoutDirty() === true`; after a further `host.doLayout()`, the measured gap is 8. *Catches*: a setter that stores the value without invalidating — the classic miss, and why both polarities of `isLayoutDirty` are asserted rather than just the `true` one.
7. **The option and the accessors agree.** `new Split({ spacing: 7 }).getComponentSpacing() === 7`; `split.setComponentSpacing(3).getComponentSpacing() === 3`; a fresh `new Split().getComponentSpacing() === 0`. *Catches*: an `applyOptions` dispatch that forgets the field, or a setter that writes a different field than the getter reads.
8. **Collapse and restore, both orientations.** After `split.setPaneCollapsedImmediate(0, true)` + `host.doLayout()`, the serving gutter's main-axis size is exactly `COLLAPSE_STRIP_SIZE` (18). After `setPaneCollapsedImmediate(0, false)` + `host.doLayout()`, it is back to exactly 10. *Catches*: a strip path that picked up the overhang arithmetic; a restore that leaves the 18 px strip width behind. Asserting the restore, not only the collapse, is what makes this fail under a mutation that never returns to the expanded size.
9. **A locked gutter keeps its box and stops taking pointer events.** `gutter.setMovable(false); host.doLayout();` → `gutter.getWidth() === 10` and `gutter.getPointerEvents() === "none"`. Then `gutter.setMovable(true); host.doLayout();` → still `10`, and `getPointerEvents() === "auto"`. *Catches*: a re-introduced `isMovable()` gate, which would shrink the element to 0 px and clip the chevron away; a lock that leaves the body swallowing 10 px of pane-edge clicks.
10. **The gutter's `z-index` is exactly `1`.** `gutter.getZIndex() === 1`. *Catches*: a missing z-index (DOM order then decides, and a late-added pane covers half the hit area); a value of 3 or higher, which would steal a `Panel`'s overlay scrollbar (`z-index: 2`).
11. **The library's contribution is identical whether or not a pane paints.** Two two-pane horizontal fixtures at `spacing: 0`, both panes `new Component({ insets: new Insets(4,4,4,4) })` — in fixture A with no background, in fixture B with `backgroundColor: 'red'`. Assert: both fixtures' pane boxes are identical; both fixtures' gutter boxes are identical; and `paneA.getBackgroundColor()` is `null` while `paneB.getBackgroundColor()` is not. *Catches*: any attempt to make `Split` compensate for the neighbours' insets (the rejected non-goal in `## Non-Goals`) — under that mutation the two fixtures' pane or gutter boxes would diverge. The two fixtures differ in exactly one property, so nothing else can explain a divergence.
12. **`Border`'s hit box is 10 px across, centred on the gap, for all four placements.** With the default `spacing` of 5: `north.getHeight() === 10` and `north.getY() + 5 === regions.north.getY() + regions.north.getHeight() + 2.5`; the symmetric forms for south, west and east. Repeat the whole set with `new Border({ spacing: 0 })`, where the centre lands exactly on each region's edge; the existing `hostCollapsibleRegions()` helper ([packages/lib/tests/component/layout/Border.test.ts:385](packages/lib/tests/component/layout/Border.test.ts#L385)) hardcodes `new Border()` and needs a spacing parameter added. *Catches*: a formula still offset by the deleted `TRACK_SIZE`; a hit box that ignores `spacing` (the two `spacing` values would then give the same centre).
13. **`Border`'s `spacing` default is still `5`.** `new Border().getComponentSpacing() === 5`. *Catches*: a sweep that gave all three managers a default of 0.

**Manual verification** (needs a real browser; the offline harness models no hit testing):

14. In each of the Split, MD Editor and Layout I/O demo panels, a divider can be grabbed and dragged by pressing on the boundary itself and at 4 px either side of it. In the Border demo panel, only the chevron needs checking — `Border`'s gutter body takes no pointer events — and each collapsible region must still collapse and restore on it.
15. In a demo panel whose pane is a scrolling `Panel`, the pane's overlay scrollbar can still be grabbed along its full 12 px width right next to a divider, and pressing it scrolls rather than starting a resize.
16. Locking a gutter through its context menu ([packages/lib/src/typescript/lib/layout/Split.ts:1694-1699](packages/lib/src/typescript/lib/layout/Split.ts#L1694-L1699)) leaves its chevron clickable and lets clicks 4 px inside either pane's edge reach the pane again.
17. A collapse and restore animates smoothly between the 10 px divider position and the 18 px strip, with no visible jump at either end.

---

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm test`, run from the worktree root (never with a bare `--root`: `llms-generate.test.ts`'s `resolveDoc` depends on the working directory and reports bogus failures otherwise).

Thirteen pre-existing cases fail before they are updated, across five files. Three of them — the two locked-gutter cases and the `Border` geometry case — are rewritten deliberately by steps 18-19. The other ten were measured as pure consequences of the reserve going from 4 px to 0 px:[^measured-breakage]

| File | Cases | Shape of the change |
|---|---|---|
| `Split.dragFrameGate.test.ts` | 5 | trailing pane `x` 254 → 250, `width` 146 → 150 |
| `Split.resizeMode.test.ts` | 4 | gutter `x` 97 → 95 and 67 → 65; `width` stays 10 |
| `Split.gutterHitBox.test.ts` | 2 | the two locked-gutter cases, redesigned per Expected Behaviour item 9 |
| `Border.test.ts` | 1 | gutter centre 42 → 42.5, re-expressed via `getComponentSpacing()` |
| `CollapseStaticParticipants.test.ts` | 1 | pane `width` 189 → 191 |

**The rule for updating them:** a failing expectation may be changed only when the difference is the reserve arithmetic — the old expectation minus the new one is a whole or half multiple of the 4 px that used to be reserved per gutter. Anything else is a real regression and must be investigated, not renumbered.

`npm run docs:api` should finish with no new warnings; the new `Split` members carry plain doc comments. `llms.txt` needs no regeneration — it is built from class-level doc summaries, and no class summary changes.

---

## Documentation Impact

- [packages/lib/docs/layouts/Split.md](packages/lib/docs/layouts/Split.md) — three edits.
  - Add a `## Spacing between panes` section after `## Three+ panes` ([:35](packages/lib/docs/layouts/Split.md#L35)): the `spacing` option, its default of `0`, and the "gap plus each neighbour's unpainted facing inset" rule with the worked table from `## Architecture Decisions`.
  - Add a `setComponentSpacing(px)` row to `## Common methods` ([:200-210](packages/lib/docs/layouts/Split.md#L200-L210)).
  - Rewrite the two `## Notes` bullets that are now false. The preferred-size bullet ([:213](packages/lib/docs/layouts/Split.md#L213)) says "plus the gutter footprint" — it is now the inter-pane spacing. The gutter bullet ([:215](packages/lib/docs/layouts/Split.md#L215)) makes two false claims: that gutter visuals are themed via `gutter.background` (no gutter has ever read that token), and that a movable gutter's hit box "extends a few pixels past its visual footprint" (a gutter has no visual footprint — its element is entirely hit area). Replace with: the gutter reserves no space and paints nothing in its expanded state; a movable gutter's hit box is 10 px straddling the pane boundary, 5 px into each neighbour, and fades in a `gutter.hoverBackground` wash on hover.
- [packages/lib/docs/layouts/Border.md](packages/lib/docs/layouts/Border.md) — extend the `spacing` sentence ([:45](packages/lib/docs/layouts/Border.md#L45)) to note that `spacing` also positions a collapsible region's gutter, whose 10 px hit box is centred on the gap.
- [packages/lib/docs/concepts/theming.md](packages/lib/docs/concepts/theming.md) — correct the `gutter.background` row ([:64](packages/lib/docs/concepts/theming.md#L64)). It describes the token as the `Split` drag gutter's background "also used as the scrollbar track color"; both are wrong. Its real consumers are the unfocused `WindowHeader` fill ([packages/lib/src/typescript/lib/component/container/WindowHeader.ts:354](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L354)) and the inactive `TabWindow` tab-toolbar fill ([packages/lib/src/typescript/lib/overlay/TabWindow.ts:250](packages/lib/src/typescript/lib/overlay/TabWindow.ts#L250)); the scrollbar track is `--ts-ui-scrollbar-track` ([packages/lib/src/typescript/lib/component/container/Scrollbar.ts:405](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L405)).
- No API reference page needs a hand edit: `typedoc` picks up `SplitOptions.spacing` and the two accessors from their doc comments.

---

## Potential Challenges

- **A pane that sets its own `z-index` above 1** sits over the gutter and shadows it on that side, leaving 5 px of hit area on the other. Mitigation: documented as the consumer's call, exactly as the neighbours' insets are; the fix is a higher `zIndex` on the gutter, not a redesign.
- **A pane that is temporarily promoted** (a compositor `transform` or `will-change` during a size-stable move) establishes a stacking context and takes its overlay scrollbar's `z-index: 2` with it, dropping the whole pane below the gutter. Mitigation: the promotion is transient and is folded back by the pass it marks owed, and it only ever occurs mid-drag, when the pointer is already captured.
- **Two panes touching with no visible divider** at the default gap, for pane classes that paint or have zero insets. Mitigation: accepted by design — set `spacing` for a visible divider.
- **Odd `spacing` values** put the gutter element on a half-pixel. Mitigation: harmless, and the geometry assertions use the boundary midpoint rather than integers.

---

## Critical Files

- [packages/lib/src/typescript/lib/layout/Split.ts](packages/lib/src/typescript/lib/layout/Split.ts) — `SplitOptions`, `applyOptions`, `gutterTotal`, `computeTotalMinSize`, `computeMainAxisSizes`, `recalculateSizes`, `doLayout`'s placement loop, `placeGutterAsStrip`, `openGutterMenu`'s "Lock gutter" row.
- [packages/lib/src/typescript/lib/layout/BoxLayout.ts:106](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L106) and [:191-208](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L191-L208) — the precedent this plan's `spacing` option and accessors mirror, including the `invalidateLayout()` call in the setter.
- [packages/lib/src/typescript/lib/layout/Border.ts:79](packages/lib/src/typescript/lib/layout/Border.ts#L79), [:100](packages/lib/src/typescript/lib/layout/Border.ts#L100), [:183-185](packages/lib/src/typescript/lib/layout/Border.ts#L183-L185), [:286-303](packages/lib/src/typescript/lib/layout/Border.ts#L286-L303) — the same option already implemented on the sibling manager, and `ensureGutter` / `innerEdgeTrack`.
- [packages/lib/src/typescript/lib/component/container/SplitGutter.ts](packages/lib/src/typescript/lib/component/container/SplitGutter.ts) — the constructor's pointer-events block, `setMovable`, `setOpaque`, `_expandedBackground`.
- [packages/lib/src/typescript/lib/component/container/CollapseButton.ts](packages/lib/src/typescript/lib/component/container/CollapseButton.ts) — `GRIP_ACROSS` (10 px), the class rule's `pointerEvents: "auto"`, and `setStripMode`'s 18 px collapsed width.
- [packages/lib/src/typescript/lib/layout/CollapseSupport.ts:13](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L13) — `COLLAPSE_STRIP_SIZE`, the one thickness this plan leaves alone.
- [packages/lib/src/typescript/lib/core/Panel.ts](packages/lib/src/typescript/lib/core/Panel.ts) — the default `insets`, `scrollbarStyle: "overlay"`, the overlay bar's placement and its `setZIndex(2)`, and the shadow overlay's `pointerEvents: "none"`.
- [packages/lib/src/typescript/lib/core/ClassStyleRules.ts:141-142](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L141-L142) — the framework `overflow: hidden` that makes the element's own size the grip's clip.
- [packages/lib/src/typescript/lib/core/Component.ts:8156-8172](packages/lib/src/typescript/lib/core/Component.ts#L8156-L8172) — `invalidateLayout` / `isLayoutDirty`, the pair Expected Behaviour item 6 asserts on.
- [plans/implemented/split-gutter-hover-grab-area.md](plans/implemented/split-gutter-hover-grab-area.md) — where `GUTTER_HIT_OVERHANG` came from, why it was tied to `GRIP_ACROSS`, why per-neighbour clamping was rejected, and why `Border` was left out of that change.
- [packages/lib/tests/component/layout/Split.gutterHitBox.test.ts](packages/lib/tests/component/layout/Split.gutterHitBox.test.ts) — the existing geometry suite this plan rewrites and extends.
- [packages/lib/tests/component/layout/Border.test.ts:375-425](packages/lib/tests/component/layout/Border.test.ts#L375-L425) — the `Border` gutter-geometry case and its two local constants.

---

## Non-Goals

- **`Accordion`.** Its resize gutter is not in scope, and `RESIZE_GUTTER_SIZE` ([packages/lib/src/typescript/lib/layout/Accordion.ts:72](packages/lib/src/typescript/lib/layout/Accordion.ts#L72)) stays. Four reasons, all specific to it: an inter-section `spacing` option already exists and already defaults to `0` ([:133](packages/lib/src/typescript/lib/layout/Accordion.ts#L133), [:204](packages/lib/src/typescript/lib/layout/Accordion.ts#L204), [:595](packages/lib/src/typescript/lib/layout/Accordion.ts#L595)); `RESIZE_GUTTER_SIZE` reserves nothing, so there is no reserve to convert and no missing-divider invariant to fix — the gutter simply overlays the upper section's last 6 px ([:1921-1928](packages/lib/src/typescript/lib/layout/Accordion.ts#L1921-L1928)); the gutter is chevron-less (`collapsible: false`) and never becomes a collapse strip, so the "must contain a 10 px grip" motivation does not apply; and re-centring it on the gap would move 5 px of drag area onto the next section's own clickable header, a conflict `Split` and `Border` do not have. Only the redundant `expandedBackground` argument is removed there.
- **Having `Split` subtract the neighbours' facing insets from the reserve.** It changes pane geometry, and it cannot work once an inset exceeds the reserve — `Button`'s 10 px already does.
- **Setting `flush: true` ([packages/lib/src/typescript/lib/core/Panel.ts:98](packages/lib/src/typescript/lib/core/Panel.ts#L98)) or `insets: 0` on the demo panels' panes.** It would make those panels match, but it is a per-consumer workaround for a library-level gap, and every consumer with padded split panes hits the same thing. It stays useful as a *diagnostic* — flipping it makes the spill reappear with no library change — and that is the only role it keeps.
- **A non-zero floor, minimum or "sensible default" for `spacing`.** `0` means `0`.
- **Painting the divider from the library.** No manager paints an expanded gutter; the divider is the gap. The `expandedBackground` option stays for a consumer who wants otherwise.
- **Changes to the drag path.** `Split.onDrag`'s press-time capture ([packages/lib/src/typescript/lib/layout/Split.ts:1463-1475](packages/lib/src/typescript/lib/layout/Split.ts#L1463-L1475)) belongs to the sibling plan `split-drag-unclamped-geometry`.
- **Deleting the `expandedBackground` option.** See `## Architecture Decisions`.

---

## Addendum: Gutter reachability at spacing 0

At the default gap the gutter's entire 10 px box overlaps its neighbours — 5 px into each. Reachability therefore rests on the gutter winning the hit test over pane content, which this design secures and bounds as follows.

**Who paints on top.** Panes carry no `z-index`, and `position: absolute` with `z-index: auto` establishes no stacking context, so a pane's descendants compete in the nearest ancestor's stacking context rather than being bundled with the pane. The gutter's explicit `z-index: 1` therefore puts it above every pane and every pane descendant that carries no z-index of its own. That replaces today's reliance on DOM order, which is not sound: `insertComponent` appends a late child at the end of the host's children ([packages/lib/src/typescript/lib/core/Component.ts:7576](packages/lib/src/typescript/lib/core/Component.ts#L7576)), so a pane added after the first layout lands *after* the gutters that were raw-appended during it.

**What the gutter now shadows.** Today's movable gutter already covers the outer 3 px of the leading pane and the first 3 px of the trailing one; the increment is 2 px per side, plus the loss of the 4 px reserve that used to sit between the overhang and the panes' own edges. Concretely, at `spacing: 0`:

| pane at the boundary | facing inset | what the 5 px overhang covers |
|---|---|---|
| bare `Component`, `List` | 0 | 5 px of live content (a list row's edge) |
| `TextArea` | 3 | 3 px of padding plus 2 px of text |
| `Panel` | 4 | 4 px of padding plus 1 px of content |
| `Button` | 10 | padding only |

The cost is that a press within 5 px of a pane's edge starts a resize instead of reaching the pane. That is the price of the 10 px drag target, it is symmetric on both sides of every boundary and in both orientations, and it applies whether or not the pane's content is inset.

**The overlay scrollbar.** A `Panel` defaults to `scrollbarStyle: "overlay"` ([packages/lib/src/typescript/lib/core/Panel.ts:111](packages/lib/src/typescript/lib/core/Panel.ts#L111)) and places its vertical bar flush with its own client-box right edge, `TRACK_WIDTH` = 12 px wide ([packages/lib/src/typescript/lib/core/Panel.ts:1080](packages/lib/src/typescript/lib/core/Panel.ts#L1080), [packages/lib/src/typescript/lib/component/container/Scrollbar.ts:51](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L51)). On a horizontal split that edge is the pane boundary, so the gutter's overhang lies over the bar's outer 5 px. The bar wins: it carries `z-index: 2` ([packages/lib/src/typescript/lib/core/Panel.ts:1734](packages/lib/src/typescript/lib/core/Panel.ts#L1734)) against the gutter's `1`, which preserves today's precedence (today the bar's `2` already beats the gutter's `auto`). The bar stays grabbable across its full 12 px; the gutter keeps the 5 px on the trailing side, down from today's 7 px. The pane's scroll-shadow overlay needs no arbitration — it is `pointer-events: none` ([packages/lib/src/typescript/lib/core/Panel.ts:1492](packages/lib/src/typescript/lib/core/Panel.ts#L1492)).

**Which axis clips.** For a horizontal split the gutter's main axis is `x`, and that is the 10 px one; `y` is `crossSize`. For a vertical split the two swap. The element is never 0 px on either axis — only the *reserve* becomes 0 — so the 10 px chevron grip (`GRIP_ACROSS`, [packages/lib/src/typescript/lib/component/container/CollapseButton.ts:16](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L16)) still fits inside the element's clip on both axes, in both orientations, for all four chevron rotations.

**Nothing keys off a non-zero reserve.** The drag itself reads the pointer's `clientX`/`clientY`, never the gutter's box. The outline-mode drag derives its 4 px line from the gutter's box midpoint (`gutterOutline`, [packages/lib/src/typescript/lib/core/ResizeDrag.ts:144-150](packages/lib/src/typescript/lib/core/ResizeDrag.ts#L144-L150)), which still lands on the boundary. The collapse strip's geometry is written directly by `placeGutterAsStrip` and never mentions the reserve.

---

## Notes

[^missing-invariant]: The reserve and the hit box are both guaranteed today — the reserve by the `x += GUTTER_SIZE` advance ([packages/lib/src/typescript/lib/layout/Split.ts:2217](packages/lib/src/typescript/lib/layout/Split.ts#L2217), [:2224](packages/lib/src/typescript/lib/layout/Split.ts#L2224)) and the hit box by the `GUTTER_SIZE + 2 * overhang` sizing ([:2214](packages/lib/src/typescript/lib/layout/Split.ts#L2214), [:2222](packages/lib/src/typescript/lib/layout/Split.ts#L2222)) and `Border`'s own equivalent ([packages/lib/src/typescript/lib/layout/Border.ts:969](packages/lib/src/typescript/lib/layout/Border.ts#L969)). The visible divider is guaranteed by nothing, because all three managers construct the gutter with `expandedBackground: "transparent"`, so what the user sees is a hole whose width the neighbours decide. Framing the defect as a missing guarantee is what makes the fix's success criterion testable: after this change the space between panes is whatever `spacing` says, independently of the neighbours.

[^spacing-precedent]: Three managers already express an inter-child gap this way and two of the three use these exact accessor names: `BoxLayout` (`spacing` option, `_spacing` field, `getComponentSpacing`/`setComponentSpacing`, `invalidateLayout()` in the setter) and `Border` (the same names, default `5`). `Accordion` uses `getSpacing`/`setSpacing` instead; `Split` follows the majority and, more importantly, follows `Border`, the manager it is most often compared with in the docs. Nothing new is invented: the option name, the field name, the accessor names, the `!== undefined` dispatch in `applyOptions` and the `invalidateLayout()` call all come from the precedent.

[^default-zero]: The user's decision, in their words: "We can set the default gap to 0. As long as the gutter is reachable. If someone wants another look without using panels, it's up to them." A default of `4` — today's effective value — would leave `Panel | Panel` at a 12 px divider with the 10 px grip still swallowed, so the reported defect would survive the fix for the most common pane class. A default of `0` puts `Panel | Panel` at 8 px with a 1 px spill per side and every other measured pairing at 0 px with a 5 px spill, so every usage in the demo app spills. Two bare `Component` panes touching with no visible divider is the accepted cost.

[^main-axis-is-ten]: The two figures must not be confused. The gutter's *reserve* becomes 0: it contributes nothing to `spacingTotal`, `computeTotalMinSize` or the placement cursor's advance. Its *element* stays 10 px on the main axis, because that thickness now comes entirely from the overhang rather than from a reserve plus an overhang. Since `Component` clips on both axes and the chevron grip is 10 px across (`GRIP_ACROSS`), a 0 px element would clip the grip to nothing — which is why the `isMovable()` gate that used to shrink a locked gutter to `GUTTER_SIZE` had to go with `GUTTER_SIZE` itself. Raising the overhang from 3 to 5 is what keeps the element at 10 px once the 4 px reserve inside it is gone, so the drag target's size is unchanged and nothing regresses for the user's pointer.

[^paint-rule]: The distinction was missed in the first measurement pass, which recorded each pane pair's *content* gap and treated it as the visible divider. That substitution only holds for a pane that paints nothing, where its padding shows the container through. Verified per class: `Panel` declares no background at all; `Button` declares both `backgroundColor` and `backgroundImage` ([packages/lib/src/typescript/lib/component/button/Button.ts:243-244](packages/lib/src/typescript/lib/component/button/Button.ts#L243-L244)); `TextArea` declares `backgroundColor` ([packages/lib/src/typescript/lib/component/input/TextArea.ts:54](packages/lib/src/typescript/lib/component/input/TextArea.ts#L54)); `List` inherits one from `AbstractSelectableList` ([packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts:167](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L167)); `Slider`'s root paints nothing but its content insets are 0, so it contributes 0 either way ([packages/lib/src/typescript/lib/component/input/Slider.ts:55](packages/lib/src/typescript/lib/component/input/Slider.ts#L55) is the track child's default, not the root's).

[^demo-verdicts]: Re-derived under the paint criterion for all seven `Split` gutters in the demo app, from the offline probe at `/tmp/claude-1000/-home-jika-typescript-loom/830a3250-2ae3-4aa7-9de8-6a3af9d923eb/scratchpad/gutter-rca-830a/` (`band.rca.test.ts`, `band-out.txt`), which measured every pane's committed box and content insets. Today (reserve 4, grip 10): `SplitPanel`'s four gutters are `Component | Component`, `Button | Text`, `List | TextArea` and `TextArea | Slider`, and every one of them has a 4 px divider and a +3 px spill, because in each pair both facing insets are either zero or inside a painted surface. `MarkdownEditorPanel`'s single gutter and `LayoutSerializationPanel`'s two are all `Panel | Panel`, giving 4 + 4 + 4 = 12 px and a −1 px overhang — the grip swallowed. That is exactly the report: the Split and Border panels look right, the MD Editor and Layout I/O panels do not. An earlier "three of six gutters spill" framing, and the claim that `SplitPanel` itself contains a non-spilling `Button | Text` gutter, both rested on the content-gap error and are withdrawn.

[^zindex]: Two hazards make an explicit z-index worth one line. First, `insertComponent` appends a late-added pane after the gutters, so DOM order does not reliably put gutters on top; with the gap at 0 there is no longer any sliver of gutter that no pane overlaps, so this stops being cosmetic and costs half the hit area. Second, the value must be chosen, not maximised: `1` clears the panes (no z-index) while staying under a `Panel`'s overlay scrollbar (`2`), preserving the precedence that already holds today by accident. A gutter at `3` or higher would take the outer 5 px of a 12 px scrollbar, which is not shippable. The previous plan in this area considered a gutter z-index and left it out precisely because the 4 px reserve made DOM order sufficient; removing the reserve removes that argument.

[^locked-gutter]: The constructor already turns pointer events off for a gutter constructed non-movable, which is every `Border` gutter, and documents why: a fixed gutter never resizes, so its body must not swallow clicks meant for what lies under it, and the chevron's own `pointer-events: auto` keeps it clickable regardless. A gutter locked at runtime through the "Lock gutter" context-menu row got the same treatment for free before this change, because its element shrank to the 4 px reserve and stopped overlapping the panes. With no reserve left, shrinking would mean a 0 px element with its chevron clipped away, so the element stays at 10 px and the pointer-events decision moves into `setMovable` — where the construction-time dispatch through `applyOptions` reaches it too, making the constructor's own block redundant. Two existing cases in `Split.gutterHitBox.test.ts` assert the old 4 px locked width and are rewritten to assert the new contract instead.

[^border-default]: Changing `Border._spacing` from `5` to `0` would alter every `Border` layout in the library and every consumer's, for no benefit to the reported defect — `Border`'s dividers already spill (5 px gap against a 10 px grip is +2.5 px per side). The instruction to default the gap to `0` applies to the option this plan *adds*; `Border`'s is pre-existing, documented, and left alone. The only `Border` behaviour change is the 0.5 px shift from centring the hit box on the real gap instead of on a 4 px track anchored at the region's edge, which also removes the last use of `TRACK_SIZE`.

[^expanded-background]: Three options were weighed. Leaving the default at the `gutter.background` token keeps a value no code path can reach and keeps `Split.md`'s theming promise false. Deleting the `expandedBackground` option outright is tempting under the project's pre-1.0 rule that public API with no callers gets removed — once the three managers stop passing it, nothing in the library does, and consumers do not construct gutters themselves. It was rejected because the user explicitly left a custom divider look to the consumer, and this option is the seam for it; `setOpaque(false)` also needs *some* expanded fill to restore, so the mechanism stays either way. Defaulting it to `"transparent"` gets the best of both: the dead token reference disappears, the triplicated argument disappears, and the option keeps working for anyone who wants it.

[^measured-breakage]: Measured, not estimated. The three constant changes and the new placement block were applied to a throwaway copy of the tip and the layout and gutter suites run offline: 13 of 704 cases failed across 5 of 44 files, and every failure's diff was inspected. The `Split.dragFrameGate` and `CollapseStaticParticipants` diffs are pane boxes shifted by the reclaimed 4 px; the `Split.resizeMode` diffs are the gutter element's `x` shifted by 2 px with its width unchanged at 10, which is the element moving from "offset from the boundary by half the old reserve" to "centred on the boundary"; the `Border` diff is the same 2 px story expressed as a centre. The spike was reverted before this plan was written; no source file is modified by it.

---

## Implementation Notes

- **The pre-existing breakage was seven files, not five, and the case count was higher than 13.** The plan's `## Verification` spike measured 13 failures across 5 files against the plan's own tip; this worktree's actual start point (`feature/qa-scroll-ablation-record`) carries two golden-geometry regression suites the spike never saw — `packages/lib/tests/core/Component.sizeHintMemo.test.ts` (one hash, "case 9") and `packages/lib/tests/core/UnchangedCommitSkip.test.ts` (four hashes — `deepWidth`, `deepHeight`, `shellWidth`, `shellHeight` — read by both "case 12, Arm A" and "case 13, Arm B", which share the same `BASELINE.geometry` constants rather than each owning their own) — both of which build a scene containing an unconfigured `Split({ orientation: 'horizontal' })` and hash its swept geometry against a hardcoded digest. Implementing the plan changed those digests. Before updating any of them, the raw pre-digest geometry was dumped (a temporary debug `console.log` of the concatenated `x,y,width,height` string, removed before committing) for both the old and new source, and diffed value-by-value: every one of the ~40-60 changed numbers per case was a shift of exactly `±2` (the single `Split`'s reclaimed 4px reserve, redistributed 2px+2px between its two near-equal-sized panes by the existing `computeMainAxisSizes` proportional-fill logic) — the same reserve-arithmetic rule `## Verification` already sanctions for the plan's own five files, just arithmetically confirmed rather than assumed. The five golden hash literals (one in `Component.sizeHintMemo.test.ts`, four in `UnchangedCommitSkip.test.ts`) were then updated to match. No other geometry, and no rect/frame count, differed in either file.
- **`Split.resizeMode.test.ts`'s outline-drag assertion needed one further fix the plan's table didn't name.** `gutterOutline` (`core/ResizeDrag.ts`) centres its 4px drag line on the gutter's own box midpoint. Under the old code that midpoint sat 2px past the true pane boundary (the gutter was centred on the old `[boundary, boundary+GUTTER_SIZE]` gap, not on the boundary itself), and `OUTLINE_LINE_PX` happened to also equal the old `GUTTER_SIZE` (4), so the two offsets cancelled and `S2`'s `outline.getX()` landed on the boundary (100) — itself centred on the old gutter's midpoint (102), just expressed as the outline's left edge rather than its centre. With `spacing: 0` the gutter's own midpoint now sits exactly on the true boundary (the intended, cleaner outcome), so the same subtraction leaves the outline 2px to the left of it (98) — an outline now symmetric ±2px around the boundary, which reads more naturally than the old one-sided placement. `gutterOutline` itself was not touched (it belongs to the sibling plan's drag path); only the test literal changed, verified as a `±2` reserve-arithmetic shift under the same rule. `OUTLINE_LINE_PX`'s own explanatory comment in `core/ResizeDrag.ts:84-86` was corrected in the same breath — a comment-only edit to a file outside this plan's `## Files to Create / Modify / Delete` table, recorded here because the plan did not sanction touching it. The old wording let the constant read as a stand-in for the reserved gap whose value it had coincidentally equalled, which is precisely the coincidence this change breaks; no code in that file was altered.
- **`setMovable`'s unlocked state clears the pointer-events override instead of writing `"auto"`, deviating from the plan's `## Internal Structure` snippet and Expected Behaviour item 9's literal `getPointerEvents() === "auto"`.** An inline `pointer-events: auto` beats the viewport-drag suppression rule any *other* handle's drag relies on (`html.ts-ui-dragging > *`, `core/PointerDrag.ts`) to take every direct child of `<html>` — and everything under it, gutters included — out of hit-testing for the duration. Writing `"auto"` on every movable gutter as the plan specifies would have kept each one clickable and hover-active during someone else's drag anywhere in the app (another split's gutter, a window border, a table column, a scrollbar thumb): the wrong cursor, and a stray hover wash. `Component.clearPointerEvents()` already exists for exactly this "restore to inherited" need (mirroring `setElementStyle("touchAction", null)`'s clear-not-force pattern) and was unused before this change. Clearing reproduces today's actual pre-existing behaviour for a movable gutter (which never had an inline pointer-events value before this plan) while still correctly restoring `"auto"`'s *visible* effect whenever no drag-suppression is in play, since `pointer-events`'s CSS initial value is `auto` and nothing else on the page constrains it outside a drag. `getPointerEvents()` therefore reads `null`, not `"auto"`, once unlocked or freshly constructed movable — `Split.gutterHitBox.test.ts`'s two affected cases assert `toBeNull()` instead of the plan's literal value.
- **Manual verification items 14-17 were not run.** This implementation ran in an environment where opening a browser or any windowed app is explicitly disallowed (diagnosing/verifying this plan's visual defect had to stay offline-only). Items 14-17 — dragging a divider at the boundary and ±4px in the Split/MD Editor/Layout I/O/Border demos, grabbing a `Panel`'s overlay scrollbar next to a divider, locking a gutter via its context menu, and watching the collapse/restore animation — are described in the plan but not exercised here. They need a manual pass by someone with a real browser before this is considered visually verified, per the plan's own "needs a real browser" marking.
