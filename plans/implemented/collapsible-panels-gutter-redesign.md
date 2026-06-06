# Collapsible Panels — Single Moving Gutter Redesign — Implementation Plan

## Overview

The shipped `collapsible-panels` feature ([`plans/implemented/collapsible-panels.md`](implemented/collapsible-panels.md)) mounts **three** coordinated pieces per collapse point — an expanded chevron (`CollapseButton` on the gutter or the region edge), a separate collapsed strip (`CollapseStrip`, carrying its own restore chevron), and the region/pane `Component` toggled with `setVisible` — and splits the collapse animation across the strip (which pops in) and the centre/sibling (which animates). The owner rejected this as too complex and visually broken.

This redesign collapses those three pieces into **one persistent moving component**: a generalized `SplitGutter` that carries a single `CollapseButton` and animates by *moving and resizing* between an expanded "divider" state and a collapsed "strip" state. The gutter is the only thing that animates, so collapse/restore is one coordinated transition on the gutter's `x/y/width/height`. `CollapseStrip` is deleted; the gutter *becomes* the strip in its collapsed state. The collapsed pane/region `Component` is hidden via `setVisible(false)` and the gutter is the visible affordance.

The same generalized `SplitGutter` is used by both managers — draggable in [`Split.ts`](../src/typescript/lib/layout/Split.ts), fixed (non-draggable) in [`Border.ts`](../src/typescript/lib/layout/Border.ts). `Border` currently has **no** gutter components at all (only a `gap`); this introduces one persistent gutter per collapsible edge region, created lazily. The collapse motion reuses [`CollapseSupport.ts`](../src/typescript/lib/layout/CollapseSupport.ts) (`COLLAPSE_*` constants, the `Accordion`-mirrored `primeCollapse` priming), extended so the single transition spans the geometry properties the gutter now moves through, never re-parenting the animating gutter ([`LayoutManager.reserveContentFrame`](../src/typescript/lib/layout/LayoutManager.ts#L189) rationale).

This **supersedes** the shipped design on the same branch `feature/collapsible-panels`. The public API shape is preserved: `Split.setPaneCollapsed`/`isPaneCollapsed`/`collapsedPanes`; `Border.setRegionCollapsed`/`isRegionCollapsed`/`setRegionCollapsible`/`isRegionCollapsible`; `SplitGutter`'s `collapse` event + `collapsible` option; `LayoutConstraints.collapsible`; the three `collapse.*` theme tokens. `CollapseButton` is kept; `CollapseStrip` is removed.

---

## Architecture Decisions

### One persistent gutter per collapse point, with two layout states

The generalized `SplitGutter` has two geometry states the owning manager drives:

- **Divider (expanded):** the resize/affordance bar between two panes (`Split`), or a transparent track at a region's *inner* edge showing only the chevron (`Border`).
- **Strip (collapsed):** an opaque `COLLAPSE_STRIP_SIZE` (~18px) bar at the collapsed pane/region's *outer* edge, background from `--ts-ui-collapse-strip-bg`, carrying the same `CollapseButton` now pointing the restore direction.

The manager flips the gutter between these states by writing its `x/y/width/height` (and toggling an opaque/transparent backing flag) inside `doLayout`. There is no second component and no second animation; one inline multi-property CSS transition on the gutter carries the whole motion. This is the central simplification — it removes `CollapseStrip` and the strip-pops-in/centre-animates split entirely.

### `SplitGutter` carries movable-vs-fixed and opaque-vs-transparent as flags

The user chose **one shared `SplitGutter`**, not a subclass. Two boolean options express the two managers' needs, both following the typed-setter + cached-field + `XOptions` idiom:

- `movable?: boolean` (default `true`) — when `false`, the gutter does **not** wire its drag listeners (`mousedown`/`onDragStart`), so `Border` gets a fixed, unmovable gutter while `Split` keeps drag-to-resize. The flag gates listener wiring in the constructor (not `applyOptions`, per the listener super-trap).
- `opaque?: boolean` (default `false`) — drives whether the gutter paints the `--ts-ui-collapse-strip-bg` fill (collapsed strip state) or stays transparent (expanded `Border` track / the existing translucent `Split` divider keeps its `--ts-ui-gutter-bg`). The manager sets this true on collapse, false on restore.

`Split` constructs its gutters `movable: true` and paints them with the existing `--ts-ui-gutter-bg` when expanded; `Border` constructs them `movable: false`, transparent when expanded. Both set `opaque: true` (strip fill) only while collapsed. Expressing both behaviours as flags on the one class is simpler than the rejected new-class route and keeps the drag machinery in one place.

### The gutter exposes its layout states to managers, the manager owns geometry

The gutter does not compute its own geometry — that stays in each manager's `doLayout`, which already owns all placement. The gutter exposes only: `setMovable`/`setOpaque` (state setters), the existing `setDirection` (axis + chevron rotation), the `collapse` event, and the `CollapseButton`'s direction flip. The manager decides *where* the gutter sits (inner edge expanded / outer edge collapsed) and *what size* it is (a few px divider / `GUTTER_SIZE` / `COLLAPSE_STRIP_SIZE`). This keeps the gutter a dumb, reusable affordance and the geometry single-sourced in the managers, matching how `Split`/`Border` already place children.

### The `CollapseButton` chevron flips direction between collapse and restore

`CollapseButton` is kept unchanged in API. Its `direction` now flips between the **collapse** direction (pointing toward the pane/region's outer edge, where it travels on collapse) and the **restore** direction (pointing back toward the centre) when the gutter toggles state. The gutter owns the single button and flips its direction in `setOpaque` (or a dedicated state method) so the one chevron serves both collapse and restore — no second restore button.

### `Border` is minimal until collapsed; the gutter moves inner→outer on collapse

`Border` keeps its current divider-less, clean look: expanded, the gutter is a transparent track at the region's **inner** edge (adjacent to centre) showing only the chevron. On collapse the gutter animates to the region's **outer** edge, becomes the opaque strip; the region `Component` hides; the centre grows to fill. Restore reverses. The per-region `collapsible` opt-out via `LayoutConstraints.collapsible` stays; the centre is never collapsible. The gutter is created lazily per collapsible edge region (mirroring the shipped `ensureButton`/`ensureStrip` lazy pattern, now a single `ensureGutter`).

### `Split` gutter `i` collapses leading pane `i`, travelling to that pane's outer edge

The shipped semantic is retained: the gutter between pane `i` and `i+1` collapses the **leading** pane `i` (its chevron points west/north toward that pane). On collapse, that same gutter animates from the inter-pane boundary to pane `i`'s **outer** edge (the container's leading edge for `i = 0`, otherwise the trailing edge of pane `i−1`'s region — i.e. the start of pane `i`'s slot). Pane `i` hides; its freed main-axis space flows to the expanded siblings via the existing `computeMainAxisSizes` redistribution. Restore animates the gutter back to the boundary and re-shows the pane. Drag-to-resize is retained in the expanded (divider) state only; a collapsed gutter is not draggable (`Split` skips its drag handling while collapsed, or the gutter is visually the strip and a drag on it is ignored — see Potential Challenges).

### Hide the collapsed `Component` via `setVisible(false)`, relying on the landed visibility replay

A component with an intrinsic `setMinSize` refuses to shrink to the strip thickness (`setWidth` clamps back up), so the collapsed pane/region must be *hidden*, not shrunk — the gutter is the visible strip. The `setVisible(true)→visibility:inherit` replay already landed in [`Component.applyStyle`](../src/typescript/lib/core/Component.ts#L3264) (verified: lines 3264–3273 write `inherit` for `true`, so a collapsed gutter or a hidden pane inside a switched-away Tab panel still inherits the ancestor's `hidden`). This redesign relies on that: hidden panes/regions and the gutter all honour ancestor hiding, so a collapsed Border/Split inside an inactive Tab disappears with the tab.

### Animation: extend `primeCollapse` to a multi-property geometry transition, never re-parent

The gutter now **moves** (`left`/`top`) as well as **resizes** (`width`/`height`), so a single-property `width|height` transition no longer covers the motion. [`primeCollapse`](../src/typescript/lib/layout/CollapseSupport.ts#L44) currently takes one `property: "width" | "height"`. Extend it to accept a **list of properties** (the axis-relevant `left|width` for a horizontal split / `top|height` for a vertical one, etc.) and build a comma-joined multi-property transition shorthand; the `Animation.afterTransition` completion filter keys off the size property (the one whose `transitionend` reliably fires). The animating element is the **gutter itself** (it is what visibly moves), primed with `will-change` and released on `transitionend` with the existing `setTimeout` fallback. Reduced-motion stays a no-op (no transition installed; the next `doLayout` writes land instantly). The gutter is persistent — created once, never appended/removed mid-animation — so the transition is never snapped by a DOM move, per the [`reserveContentFrame`](../src/typescript/lib/layout/LayoutManager.ts#L214) re-parent rationale and the project memory note.

### `CODE_CONVENTIONS` compliance and the one flagged tension

Every new DOM-affecting field on `SplitGutter` (`movable`, `opaque`) gets a typed setter, a `declare`-d cached backing field seeded through the setter during `super()` (the class-field super-cascade trap already handled for `_direction`/`_collapsible`), and an `XOptions` field routed in `applyOptions`. Listener wiring (drag, collapse) stays in the constructor body, gated by `movable`. **Flagged tension (not a violation):** the gutter writes `left/top/width/height` through `commitBounds`-style setters *and* an inline `transition` it owns; the manager must set the gutter's geometry through the same `setX/setY/setWidth/setHeight` setters so the inline transition animates them — this means the gutter geometry is written by the manager directly (as `Split` already does for gutters today at [`Split.ts:487`](../src/typescript/lib/layout/Split.ts#L487)), not via `placeComponent`. That is the existing gutter-placement pattern, so no new rule is broken; it is called out so the implementer routes geometry through the typed setters (which the transition observes) rather than `setElementStyle` directly.

---

## Public API (TypeScript Signatures)

```typescript
// SplitGutter.ts — generalized divider/strip, movable in Split, fixed in Border
type SplitGutterEvent = "dragstart" | "drag" | "collapse";

interface SplitGutterOptions extends ComponentOptions {
    orientation?: string;          // "horizontal" | "vertical" (existing)
    collapsible?: boolean;         // existing — gutter carries a collapse chevron (default true)
    movable?:     boolean;         // NEW — wires drag listeners (default true; Border passes false)
    opaque?:      boolean;         // NEW — paints the collapse-strip fill (default false)
    listeners?: {
        dragstart?: (position: number) => void;
        drag?:      (position: number) => void;
        collapse?:  () => void;
    };
}

class SplitGutter extends Component<SplitGutterOptions> {
    declare private _direction: String;
    declare private _collapsible: boolean;
    declare private _movable: boolean;      // backing for setMovable
    declare private _opaque: boolean;       // backing for setOpaque
    declare private _collapseButton: CollapseButton;

    setMovable(value: boolean): this;       // gate drag wiring; default true
    isMovable(): boolean;
    setOpaque(value: boolean): this;        // strip fill on/off + flips chevron to restore dir; default false
    isOpaque(): boolean;

    setCollapsible(value: boolean): this;   // existing
    isCollapsible(): boolean;               // existing
    setDirection(direction?: String): this; // existing — also re-derives the chevron's collapse direction

    on(event: "collapse", listener: () => void): this;   // existing
}
```

`setOpaque(true)` writes `background-color: var(--ts-ui-collapse-strip-bg, #AAAAAA)` and flips the `CollapseButton` to the restore direction; `setOpaque(false)` restores the expanded fill (`var(--ts-ui-gutter-bg …)` for `Split`, transparent for `Border`) and the collapse direction. Whether the expanded fill is the gutter colour or transparent is a per-construction concern — `Border` constructs the gutter with no/transparent background; `Split` keeps the existing `--ts-ui-gutter-bg`. Keep the existing positional-`direction` constructor signature (`new SplitGutter(direction, options?)`).

```typescript
// Split.ts — unchanged public surface
interface SplitOptions extends LayoutManagerOptions {
    direction?: string;
    collapsedPanes?: number[];
}
class Split extends LayoutManager {
    setPaneCollapsed(index: number, collapsed: boolean): this;   // unchanged signature
    isPaneCollapsed(index: number): boolean;                     // unchanged
}
```

```typescript
// Border.ts — unchanged public surface
interface BorderOptions extends LayoutManagerOptions {
    gap?: number;
}
class Border extends LayoutManager {
    setRegionCollapsed(placement: Placement, collapsed: boolean): this;   // unchanged
    isRegionCollapsed(placement: Placement): boolean;                     // unchanged
    setRegionCollapsible(placement: Placement, value: boolean): this;     // unchanged
    isRegionCollapsible(placement: Placement): boolean;                   // unchanged
}
```

```typescript
// LayoutConstraints.ts — unchanged
class LayoutConstraints {
    collapsible?: boolean;   // Border-only; default true
}
```

```typescript
// CollapseButton.ts — KEPT, unchanged
type CollapseDirection = "north" | "south" | "east" | "west";
class CollapseButton extends Component<CollapseButtonOptions> {
    setDirection(direction: CollapseDirection): this;
    getDirection(): CollapseDirection;
    on(event: "collapse", listener: () => void): this;
}
```

```typescript
// CollapseSupport.ts — primeCollapse generalized to multi-property geometry
export function primeCollapse(
    animating: Component,
    properties: string[],                 // was: property: "width" | "height"
    participants: Component[],
    completionProperty?: string,          // which property's transitionend ends it; defaults to properties[0]
): void;
```

---

## Theme Tokens

**No token changes.** The three shipped tokens are reused exactly:

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-collapse-strip-bg` | `#AAAAAA` | `#555` | Strip fill — now the gutter's opaque-state background. |
| `--ts-ui-collapse-strip-size` | `18px` | `18px` | Collapsed-strip thickness (mirrors `COLLAPSE_STRIP_SIZE`). |
| `--ts-ui-collapse-button-color` | `rgb(100,100,100)` | `rgb(160,160,160)` | Chevron colour (read by `CollapseButton`). |

The `collapse` block in the `Theme` interface ([`Theme.ts:194`](../src/typescript/lib/core/Theme.ts#L194)), the three theme files ([`ClassicTheme.ts:83`](../src/typescript/lib/core/themes/ClassicTheme.ts#L83), `DarkTheme.ts`, `ModernTheme.ts`), and the `themeToVars` emission ([`Theme.ts:720`](../src/typescript/lib/core/Theme.ts#L720)) stay as-is. The only behavioural change is that `--ts-ui-collapse-strip-bg` is now read by `SplitGutter.setOpaque` instead of by `CollapseStrip`.

---

## Internal Structure

### Gutter geometry — the two states (driven by the manager)

**Split, horizontal, gutter `i` (collapses leading pane `i`):**

- Expanded (divider): `x = boundary between pane i and i+1`, `width = GUTTER_SIZE`, `height = container inner height`, `opaque = false`, chevron = collapse direction (`west`).
- Collapsed (strip): `x = pane i's slot left edge`, `width = COLLAPSE_STRIP_SIZE`, `height = container inner height`, `opaque = true`, chevron = restore direction (`east`). Pane `i` is `setVisible(false)`; the freed space (`stored − strip`) flows to expanded siblings via the existing redistribution.

Vertical mirrors this on `y`/`height` with `north`/`south` chevrons.

**Border, region (e.g. WEST):**

- Expanded (track): gutter parked at the region's **inner** edge centre (`x = region.right`, full region height or just chevron-tall), transparent, chevron = `west` (collapse).
- Collapsed (strip): gutter at the region's **outer** edge (`x = region.left`), `width = COLLAPSE_STRIP_SIZE`, full middle height, `opaque = true`, chevron = `east` (restore). The region `Component` is `setVisible(false)`; the centre grows because `regionExtent` already returns `COLLAPSE_STRIP_SIZE` for a collapsed region, and the strip *is* that reserved extent.

### Animation (both managers, in `setPaneCollapsed`/`setRegionCollapsed`)

1. Flip the collapsed flag.
2. Resolve the axis property list: horizontal split / east-west region → `["left", "width"]`; vertical split / north-south region → `["top", "height"]`. (A move-only collapse where width is unchanged still needs the size property for the completion filter; include both since the gutter both moves and resizes.)
3. `primeCollapse(gutter, properties, [gutter], "width" | "height")` — install the multi-property transition on the gutter, `will-change` the gutter, release on `transitionend` of the size property with the `setTimeout` fallback. Reduced-motion → no-op.
4. `container.scheduleLayout()` — the next `doLayout` writes the gutter's new `x/y/width/height` and `setOpaque`, which the just-installed transition animates; it also `setVisible(false)`s the collapsing pane/region (hidden behind the animating gutter for the duration).

The pane/region is hidden immediately (it is occluded by the moving opaque gutter and would otherwise need its own animation). Only the gutter animates.

---

## Ordered Implementation Steps

1. **`SplitGutter.ts`** — add `movable`/`opaque` to `SplitGutterOptions` and `_defaultSplitGutterOptions` (`movable: true`, `opaque: false`); add `declare private _movable/_opaque`; add `setMovable`/`isMovable` and `setOpaque`/`isOpaque` (typed setters, cached fields). `setOpaque(true)` sets the strip background + flips the chevron to the restore direction; `setOpaque(false)` restores the expanded background + collapse direction. Gate the `Event.addListener(this, 'mousedown', this.onDragStart)` wiring on `_movable` (constructor body). Route `movable`/`opaque` in `applyOptions`. → verify: `npx tsc --noEmit`; `grep -n 'setMovable\|setOpaque' src/typescript/lib/component/container/SplitGutter.ts`.
2. **`CollapseSupport.ts`** — change `primeCollapse(animating, property: "width"|"height", participants)` to `primeCollapse(animating, properties: string[], participants, completionProperty?)`; build a comma-joined transition shorthand over `properties`; pass `completionProperty ?? properties[0]` (or the size property) to `Animation.afterTransition`'s `property` filter. → verify: typecheck; `grep -n 'primeCollapse' src/typescript/lib/layout` to enumerate call sites.
3. **`CollapseStrip.ts` + barrel** — delete `src/typescript/lib/component/container/CollapseStrip.ts`; remove its two export lines from [`component/container/index.ts:31`](../src/typescript/lib/component/container/index.ts#L31). → verify: `grep -rn 'CollapseStrip' src/` — expect zero matches after Split/Border are updated.
4. **`Split.ts`** — drop the `CollapseStrip` import, `_strips` map, `ensureStrip`, `positionStrip`. Keep `_collapsed`, `_pendingCollapsed`, `computeMainAxisSizes`, `computeTotalMinSize` (already strip-thickness aware). In `setPaneCollapsed`, prime the **gutter** (not a strip) with the multi-property transition and `scheduleLayout`. In `doLayout`'s gutter loop, when pane `i` is collapsed: set the gutter to the strip geometry (outer edge, `COLLAPSE_STRIP_SIZE`, `setOpaque(true)`), `setVisible(true)` (the gutter is the affordance), and `pane.setVisible(false)`; when expanded, restore the divider geometry + `setOpaque(false)` + `pane.setVisible(true)`. Remove the strip teardown from `detach` (keep the gutter teardown). → verify: typecheck; `grep -n 'Strip' src/typescript/lib/layout/Split.ts` — zero.
5. **`Border.ts`** — drop the `CollapseStrip` import, `_strips` map, `ensureStrip`; collapse `_buttons` + `updateRegionAffordance` + `regionInnerEdgeCentre` into a single per-region **gutter** map `_gutters: Map<Placement, SplitGutter>` and an `ensureGutter(placement)` (constructs `new SplitGutter(axis, { movable: false, collapsible: …, opaque: false, listeners: { collapse: … } })`, points the chevron via `COLLAPSE_CHEVRON`). Rework `updateRegionAffordance` into `updateRegionGutter(placement, x, y, w, h)`: expanded → gutter transparent at inner-edge centre, chevron = collapse dir, region visible; collapsed → gutter opaque at outer edge spanning the region, chevron = restore dir, region `setVisible(false)`. `regionExtent` stays. In `setRegionCollapsed`, prime the **gutter** with the multi-property transition. Update `detach` to tear down `_gutters` only. → verify: typecheck; `grep -n 'Strip' src/typescript/lib/layout/Border.ts` — zero.
6. **Demos** — `SplitPanel.ts`: optionally start a pane collapsed (`collapsedPanes`) to exercise restore-from-construction. `BorderPanel.ts`: keep the `collapsible: false` east opt-out; confirm N/S/W collapse to a single moving gutter. → verify: app loads, manual smoke (below).
7. **Docs** — update `docs/layouts/Split.md`, `docs/layouts/Border.md`, `docs/concepts/theming.md`: replace every `CollapseStrip` reference with the single-gutter model (the gutter *is* the strip). See Documentation Impact. → verify: `grep -rn 'CollapseStrip' docs/*.md docs/**/*.md` (source pages, not `dist/`) — zero; `npm run docs:build`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/container/SplitGutter.ts` |
| Modify | `src/typescript/lib/component/container/index.ts` (remove `CollapseStrip` exports) |
| Modify | `src/typescript/lib/layout/CollapseSupport.ts` (multi-property `primeCollapse`) |
| Modify | `src/typescript/lib/layout/Split.ts` |
| Modify | `src/typescript/lib/layout/Border.ts` |
| Delete | `src/typescript/lib/component/container/CollapseStrip.ts` |
| Modify | `src/typescript/SplitPanel.ts` (demo) |
| Modify | `src/typescript/BorderPanel.ts` (demo) |
| Modify | `docs/layouts/Split.md` |
| Modify | `docs/layouts/Border.md` |
| Modify | `docs/concepts/theming.md` |

`CollapseButton.ts`, `LayoutConstraints.ts`, `Theme.ts`, and the three theme files are **unchanged** (tokens reused as-is; `CollapseButton` kept).

---

## Verification

- **Typecheck:** `npx tsc --noEmit` — 0 errors.
- **Doc build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- **Grep invariants:**
  - `grep -rn 'CollapseStrip' src/` — zero (class deleted, all imports gone).
  - `grep -rn 'CollapseStrip' docs/layouts docs/concepts docs/components` — zero in source pages.
  - `grep -n 'setMovable\|setOpaque' src/typescript/lib/component/container/SplitGutter.ts` — both setters present.
  - `grep -n 'primeCollapse' src/typescript/lib/layout/*.ts` — `Split`, `Border`, `CollapseSupport` only, all passing a property **array**.
- **Manual smoke (`SplitPanel` demo):**
  - Double-click a gutter chevron: the **same** gutter slides to the pane's outer edge and widens into the opaque strip in one motion; the pane disappears; siblings grow. No strip pops in separately, no centre/strip split-animation.
  - Double-click the (now restore-pointing) chevron on the strip-state gutter: it slides back to the boundary and the pane re-appears.
  - Single-click and drag still resize an expanded gutter; a collapsed gutter does not resize.
- **Manual smoke (`BorderPanel` demo):**
  - Expanded N/S/W show only a chevron at the inner edge, no opaque divider line (clean look preserved).
  - Double-click a region chevron: the gutter slides to the region's outer edge, becomes the opaque strip, the region hides, the centre grows. Restore reverses.
  - The east region (`collapsible: false`) shows no chevron and cannot collapse; the centre never shows one.
- **Reduced motion:** `prefers-reduced-motion: reduce` — collapse/restore is instant (no transition installed), no flicker or mid-move snap.
- **Tab-switch hides the gutter:** place a collapsed Split/Border inside a Tab, switch to another tab — the collapsed gutter (strip state) disappears with the tab (relies on the `setVisible(true)→visibility:inherit` replay at [`Component.applyStyle:3264`](../src/typescript/lib/core/Component.ts#L3264)); switch back — it reappears collapsed.
- **Theme toggle:** `ThemeManager.setTheme(DarkTheme)` — the opaque strip-state gutter and chevron track the theme.

---

## Documentation Impact

`CollapseStrip` is removed from the public surface; `CollapseButton`, `Split`, `Border`, `LayoutConstraints` keep their exports. `SplitGutter` gains `movable`/`opaque` (documented via generated API from JSDoc).

- **Removed symbol sweep:** `grep -rln 'CollapseStrip' docs/` (source pages) — currently `docs/layouts/Split.md:62`, `docs/layouts/Border.md:69`. Rewrite both "Collapsible panels"/"Collapsible regions" sections so the gutter *is* the collapsed strip (drop the `CollapseStrip` link; the strip is the gutter's collapsed state). The public method tables (`setPaneCollapsed`, `setRegionCollapsed`, etc.) are unchanged.
- **`docs/concepts/theming.md:58-60`:** the three `collapse.*` rows stay; reword the `collapse.strip.background` purpose from "strip" to "collapsed-gutter strip fill" so it no longer implies a separate `CollapseStrip` component.
- No new curated page and no `docs/.vitepress/config.mts` sidebar change (no new public class; `CollapseStrip`'s removal drops its generated API page automatically).
- Cross-bucket JSDoc references (`Split`/`Border` in `layout` → `CollapseButton`/`SplitGutter` in `component/container`) use markdown links, not `{@link}`, per `_shared/docs-conventions.md`.

---

## Potential Challenges

- **Move-only vs resize transition completeness.** The gutter moves *and* resizes; a transition listing only `width`/`height` would snap the `left`/`top` move. Mitigation: `primeCollapse` installs a comma-joined shorthand over the full axis property list (`["left","width"]` / `["top","height"]`) and keys completion off the size property.
- **A collapsed gutter must not start a drag.** In `Split`, a collapsed gutter is the strip; a `mousedown` on it should not resize. Mitigation: while a pane is collapsed, `Split` skips its drag wiring effect — either the gutter's `onDragStart` early-returns when the leading pane is collapsed, or `Split.onDrag` ignores a collapsed gutter (read the flag live, as the existing drag handlers already resolve the gutter index live).
- **Border gutter geometry at the inner edge vs outer edge.** The expanded transparent track and the collapsed opaque strip occupy different edges; the in-between frames are the animation. Mitigation: compute both end-state rects in `doLayout` from the same region rect (`regionInnerEdgeCentre` logic for expanded, region outer edge for collapsed) and let the single transition interpolate; the gutter is full-region-tall in both states so only the cross-axis position/size changes.
- **`will-change` layer leak on interrupted collapse.** A tab-switch or zero-delta toggle mid-animation can drop `transitionend`. Mitigation: the existing `Animation.afterTransition` `setTimeout` fallback in `primeCollapse` releases `will-change` regardless.
- **Redistribution math unchanged but gutter now occupies the strip slot.** `Split.computeMainAxisSizes` already gives a collapsed pane `COLLAPSE_STRIP_SIZE`; ensure the gutter (now the strip) is placed *within* that reserved slot rather than added on top, so siblings don't shift by an extra `GUTTER_SIZE`. Mitigation: when collapsed, treat the gutter's `COLLAPSE_STRIP_SIZE` as the pane slot itself (the pane is hidden), not as an additional gutter — the existing `gutterTotal` reservation needs auditing so a collapsed pane's slot isn't double-counted.
- **Direction flip timing.** The chevron must read "collapse" when expanded and "restore" when collapsed; flipping it on `setOpaque` keeps the single button correct without a second component. Mitigation: drive the flip inside `setOpaque` so state and chevron stay coupled.

---

## Critical Files

- [`src/typescript/lib/component/container/SplitGutter.ts`](../src/typescript/lib/component/container/SplitGutter.ts) — the generalized component; existing drag wiring, `_collapseButton`, `declare` backing-field trap, listener-in-constructor idiom.
- [`src/typescript/lib/component/container/CollapseButton.ts`](../src/typescript/lib/component/container/CollapseButton.ts) — kept; `setDirection`/chevron rotation the gutter flips.
- [`src/typescript/lib/layout/Split.ts`](../src/typescript/lib/layout/Split.ts) — `doLayout` gutter loop ([line ~480](../src/typescript/lib/layout/Split.ts#L480)), `computeMainAxisSizes`, `_collapsed`, `setPaneCollapsed`, `detach`.
- [`src/typescript/lib/layout/Border.ts`](../src/typescript/lib/layout/Border.ts) — five-region `doLayout`, `regionExtent`, `updateRegionAffordance`/`regionInnerEdgeCentre`/`ensureButton`/`ensureStrip` (to be collapsed into one gutter path), `detach`.
- [`src/typescript/lib/layout/CollapseSupport.ts`](../src/typescript/lib/layout/CollapseSupport.ts) — `COLLAPSE_*` constants, `primeCollapse` (to be made multi-property).
- [`src/typescript/lib/layout/Accordion.ts`](../src/typescript/lib/layout/Accordion.ts#L776) — `primeWrapper` priming, `will-change`, reduced-motion branch, easing-as-constant the motion mirrors.
- [`src/typescript/lib/core/Animation.ts`](../src/typescript/lib/core/Animation.ts#L206) — `afterTransition` (property filter + fallback), `isReducedMotion`.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts#L3264) — `setVisible`, the `applyStyle` visibility replay (verify lines 3264–3273), `setX/setY/setWidth/setHeight`, `setTransition`, `setWillChange`, `createStyleRule`.
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts#L189) — `placeComponent`/`commitBounds`/`reserveContentFrame` (never-re-parent rationale).

---

## Non-Goals

- **No persistence.** Collapsed state stays in-memory only; no reload survival.
- **No collapsible centre region.** `Border`'s centre never collapses; a `collapsible: true` centre constraint is ignored.
- **No new theme tokens or motion tokens.** The three `collapse.*` tokens are reused; easing/duration stay code constants in `CollapseSupport`.
- **No second component reintroduced.** The whole point is one moving gutter; do not add a separate strip, overlay, or restore button.
- **No collapse for other managers.** Only `Split` and `Border`; `HBox`/`VBox`/`Accordion`/`Tab`/`Fit`/`Absolute`/`Grid` are untouched.
- **No single-click or keyboard collapse.** Activation stays double-click on the chevron, per the shipped trigger design.
