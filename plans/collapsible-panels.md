# Collapsible Panels for Split & Border — Implementation Plan

## Overview

Add collapse/restore to the two divider-style layout managers. A pane (in `Split`) or an edge region (in `Border`) can be collapsed to a thin strip tucked against its outer edge, and a collapsed strip can be restored. Activation is a **double-click on a small chevron button** — single clicks are ignored so a gutter drag never collapses by accident. Collapse/restore animates via a CSS width/height transition that mimics `Accordion`'s feel. State is in-memory only.

The collapse trigger lives in the existing gutter for `Split` ([`SplitGutter.ts:52`](../src/typescript/lib/component/container/SplitGutter.ts#L52)) and in a new strip component for both managers. `Split` owns per-pane collapsed state in a `Map<Component, boolean>` paralleling its existing `_sizes` map ([`Split.ts:35`](../src/typescript/lib/layout/Split.ts#L35)); `Border` owns per-region collapsed flags plus per-region `collapsible` opt-out on its five slot fields ([`Border.ts:36`](../src/typescript/lib/layout/Border.ts#L36)). Both managers compute the collapsed/expanded geometry inside their existing `doLayout` ([`Split.ts:267`](../src/typescript/lib/layout/Split.ts#L267), [`Border.ts:402`](../src/typescript/lib/layout/Border.ts#L402)).

A shared `CollapseButton` component (the chevron) and a `CollapseStrip` component (the tucked strip carrying a restore `CollapseButton`) are added under `component/container/`, reusing the `AccordionIndicator` chevron idiom ([`AccordionIndicator.ts:63`](../src/typescript/lib/component/container/AccordionIndicator.ts#L63)) and the `Accordion` animation pattern ([`Accordion.ts:776`](../src/typescript/lib/layout/Accordion.ts#L776)).

---

## Architecture Decisions

### State ownership lives on the layout manager, not the child

`Split` already keeps per-pane sizing in `_sizes: Map<Component, number>` ([`Split.ts:35`](../src/typescript/lib/layout/Split.ts#L35)) and `Border` already routes each child into a named slot field via `setLayoutConstraints` ([`Border.ts:77`](../src/typescript/lib/layout/Border.ts#L77)). Collapsed state is layout geometry, so it belongs with that bookkeeping: `Split` gets `_collapsed: Map<Component, boolean>`; `Border` gets five `_xCollapsed: boolean` flags and five `_xCollapsible: boolean` flags. The child `Component` stays unaware it is collapsible — this keeps the feature off `Component`'s already-large surface and mirrors how both managers already treat children as opaque.

### Public API is addressed by index (Split) and by placement (Border)

`Split` panes have no stable handle except their container index, so the public setter is `setPaneCollapsed(index: number, collapsed: boolean)` / `isPaneCollapsed(index)`. `Border` regions are named, so the setter is `setRegionCollapsed(placement: Placement, collapsed: boolean)` / `isRegionCollapsed(placement)`, plus `setRegionCollapsible(placement, value)` for the per-region opt-out (default `true`). This matches each manager's existing addressing style — `Split` is index/ratio oriented, `Border` is placement oriented.

### `collapsible` opt-out rides `LayoutConstraints`, defaulting to true

`Border` regions are registered with a `LayoutConstraints` carrying a `placement` ([`LayoutConstraints.ts:18`](../src/typescript/lib/layout/LayoutConstraints.ts#L18)). Add an optional `collapsible?: boolean` field there; `Border.setLayoutConstraints` reads it into the matching `_xCollapsible` flag, defaulting to `true` when unset (only the center is hard-wired non-collapsible). This avoids a new per-child API channel and reuses the constraint object callers already pass to `addComponent`.

### Trigger = double-click, disambiguated from drag by event type

The browser fires `dblclick` as its own event independent of `mousedown`/`drag`, so wiring the collapse to `dblclick` (not a click counter) inherently cannot fire during a drag — a drag is `mousedown`→`mousemove`→`mouseup` with no `dblclick`. `SplitGutter` already owns `mousedown` for drag ([`SplitGutter.ts:71`](../src/typescript/lib/component/container/SplitGutter.ts#L71)); the collapse button is a **separate child element** inside the gutter with its own `dblclick` listener, and its `mousedown` is stopped from reaching the gutter (`evnt.stopPropagation()`) so grabbing the button never starts a resize drag. This is the central risk mitigation — see Potential Challenges.

### Animation mirrors Accordion: transition the size, never re-parent

Both managers already place children by writing `setX/setY/setWidth/setHeight` through `commitBounds` ([`LayoutManager.ts:414`](../src/typescript/lib/layout/LayoutManager.ts#L414)). To animate, each collapsing child (and the strip) carries an inline `transition: width/height …ms <easing>` set once at creation; flipping the collapsed flag and re-running `doLayout` then animates the new size. We must NOT move any DOM node to collapse — the memory note "re-parenting cancels CSS transitions" and `reserveContentFrame`'s persistent-frame rationale ([`LayoutManager.ts:189`](../src/typescript/lib/layout/LayoutManager.ts#L189)) both confirm a re-parent snaps the animation. The strip is a persistent child element (created once, shown/hidden by width/height and `visibility`, never appended/removed mid-animation). Reuse `Accordion`'s `Animation.afterTransition` + `will-change` priming and its reduced-motion branch ([`Accordion.ts:776`](../src/typescript/lib/layout/Accordion.ts#L776)) so the will-change layer is released on `transitionend`.

### Two new small components, one element each

Per the one-element-per-class rule, the chevron button is `CollapseButton extends Component` (its own `dblclick`, a rotatable chevron glyph like `AccordionIndicator`), and the collapsed strip is `CollapseStrip extends Component` that side-loads one restore `CollapseButton`. The strip is a sibling element the manager positions, not a wrapper around the collapsed child. Both go under `component/container/` next to `SplitGutter` and the accordion parts.

### Easing/duration are module constants, not theme tokens

`Accordion` keeps its easing curve and 200ms default as code, not theme, because "motion personality belongs to the layout, not the theme" ([`Accordion.ts:39`](../src/typescript/lib/layout/Accordion.ts#L39)). Follow that: a shared `COLLAPSE_EASING` / `COLLAPSE_DURATION` constant in each manager (or a tiny shared module). Only the **strip thickness** and the **button/chevron colour** become theme tokens, reusing the existing gutter colour where possible.

---

## Public API (TypeScript Signatures)

```typescript
// Split.ts — collapsed state keyed by pane index
class Split extends LayoutManager {
    // backing: private _collapsed: Map<Component, boolean> = new Map();
    setPaneCollapsed(index: number, collapsed: boolean): this;
    isPaneCollapsed(index: number): boolean;
}

interface SplitOptions extends LayoutManagerOptions {
    direction?: string;
    collapsedPanes?: number[];   // indices collapsed at construction
}
```

```typescript
// Border.ts — collapsed + collapsible keyed by placement
class Border extends LayoutManager {
    // backing per region: _northCollapsed … _eastCollapsed (boolean, default false)
    //                     _northCollapsible … _eastCollapsible (boolean, default true)
    setRegionCollapsed(placement: Placement, collapsed: boolean): this;
    isRegionCollapsed(placement: Placement): boolean;
    setRegionCollapsible(placement: Placement, value: boolean): this;
    isRegionCollapsible(placement: Placement): boolean;
}

interface BorderOptions extends LayoutManagerOptions {
    gap?: number;
}

// LayoutConstraints.ts — opt-out channel for Border regions
class LayoutConstraints {
    collapsible?: boolean;   // default treated as true by Border; ignored elsewhere
}
```

```typescript
// SplitGutter.ts — gutter gains a collapse trigger + collapse event
type SplitGutterEvent = "dragstart" | "drag" | "collapse";

interface SplitGutterOptions extends ComponentOptions {
    orientation?: string;
    collapsible?: boolean;   // default true; false hides the button
    listeners?: {
        dragstart?: (position: number) => void;
        drag?:      (position: number) => void;
        collapse?:  () => void;
    };
}
class SplitGutter extends Component<SplitGutterOptions> {
    setCollapsible(value: boolean): this;   // backing: _collapsible
    isCollapsible(): boolean;
    on(event: "collapse", listener: () => void): this;
}
```

```typescript
// CollapseButton.ts — the chevron, fires on dblclick only
type CollapseDirection = "north" | "south" | "east" | "west";

interface CollapseButtonOptions extends ComponentOptions {
    direction?: CollapseDirection;   // which way the chevron points
    listeners?: { collapse?: () => void };
}
class CollapseButton extends Component<CollapseButtonOptions> {
    setDirection(direction: CollapseDirection): this;   // backing: _direction
    getDirection(): CollapseDirection;
    on(event: "collapse", listener: () => void): this;
}
```

```typescript
// CollapseStrip.ts — the tucked strip carrying a restore button
interface CollapseStripOptions extends ComponentOptions {
    orientation?: string;            // horizontal | vertical (strip's long axis)
    restoreDirection?: CollapseDirection;
    listeners?: { restore?: () => void };
}
class CollapseStrip extends Component<CollapseStripOptions> {
    setOrientation(orientation: string): this;       // backing: _orientation
    setRestoreDirection(direction: CollapseDirection): this;
    on(event: "restore", listener: () => void): this;
}
```

Each new DOM property follows the project idiom: a typed setter (`setCollapsible`, `setDirection`, `setOrientation`, `setRestoreDirection`), a cached backing field (`_collapsible`, `_direction`, `_orientation`), and a matching `XOptions` field with full constructor/`applyOptions` routing. Listener bags are wired in the constructor body after `super()` — never in `applyOptions` — per the `options.listeners` super-trap already documented in `SplitGutter` ([`SplitGutter.ts:73`](../src/typescript/lib/component/container/SplitGutter.ts#L73)).

---

## Theme Tokens

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-collapse-strip-bg` | `#AAAAAA` | `#555` | Strip background; reuses the gutter colour values. |
| `--ts-ui-collapse-strip-size` | `18px` | `18px` | Strip thickness along its short axis. |
| `--ts-ui-collapse-button-color` | `rgb(100,100,100)` | `rgb(160,160,160)` | Chevron colour; mirrors the accordion indicator colour. |

Add a `collapse: { strip: { background, size }, button: { color } }` block to the `Theme` interface in [`Theme.ts:173`](../src/typescript/lib/core/Theme.ts#L173) (next to `gutter`), seed it in all three theme files ([`ClassicTheme.ts:87`](../src/typescript/lib/core/themes/ClassicTheme.ts#L87), [`DarkTheme.ts:85`](../src/typescript/lib/core/themes/DarkTheme.ts#L85), [`ModernTheme.ts:88`](../src/typescript/lib/core/themes/ModernTheme.ts#L88)), and emit the three vars in `themeToVars` ([`Theme.ts:620`](../src/typescript/lib/core/Theme.ts#L620)). The chevron/strip CSS reads them with a literal fallback so a custom theme missing the block still renders (the `gutter`/`AccordionIndicator` pattern at [`SplitGutter.ts:60`](../src/typescript/lib/component/container/SplitGutter.ts#L60) and [`AccordionIndicator.ts:42`](../src/typescript/lib/component/container/AccordionIndicator.ts#L42)).

---

## Internal Structure

**Split collapsed geometry.** In `doLayout`, after `recalculateSizes`, a collapsed pane is placed at the strip thickness instead of its stored `_sizes` value, and its adjacent gutter is hidden (or kept as the strip's grab edge). The freed main-axis space is given to the remaining expanded panes. The pane keeps its `_sizes` entry untouched so restore returns it to the same ratio. The collapse button sits on the gutter ([`Split.ts:299`](../src/typescript/lib/layout/Split.ts#L299) gutter-creation loop), pointing toward the pane it collapses; on collapse the manager shows a `CollapseStrip` overlaying the collapsed pane's edge.

**Border collapsed geometry.** `doLayout` already derives each edge region's extent from its preferred size ([`Border.ts:442`](../src/typescript/lib/layout/Border.ts#L442) onward). When a region's `_xCollapsed` flag is set, substitute the strip thickness for that region's preferred width/height in the same placement math, so the center grows into the reclaimed space automatically. The `CollapseButton` tucks against the region's own outer edge; the `CollapseStrip` replaces the region's visible body.

**Animation priming (both managers).** Reuse the `Accordion.primeWrapper` shape ([`Accordion.ts:776`](../src/typescript/lib/layout/Accordion.ts#L776)): on a collapse/restore toggle, set `will-change: width|height` on the animating child, call `Animation.afterTransition({ component, property, durationMs, onComplete })` to clear it, and under `Animation.isReducedMotion()` set `transition: none`, write the layout, then restore on the next frame.

---

## Ordered Implementation Steps

1. **`CollapseButton.ts`** (new, `component/container/`) — `extends Component`, single `span`/`div` element, chevron glyph rotated per `direction` via a shared class rule + per-instance state rule (copy `AccordionIndicator`'s `ensureClassRule` + `createStyleRule` pattern, [`AccordionIndicator.ts:26`](../src/typescript/lib/component/container/AccordionIndicator.ts#L26)). Wire `dblclick` via `Event.addListener(this, "dblclick", …)` to emit `collapse`; stop `mousedown` propagation so it never starts a parent drag. → verify: typecheck.
2. **`CollapseStrip.ts`** (new) — `extends Component`, side-loads one `CollapseButton` (restore direction), reads strip thickness/bg from the new tokens, emits `restore`. → verify: typecheck.
3. **`SplitGutter.ts`** — add `_collapsible`, `setCollapsible`/`isCollapsible`, `collapsible` option (default true), a side-loaded `CollapseButton` child appended in `init`/`render`, the `"collapse"` event in `SplitGutterEvent`/`on`/`emit`, and constructor listener routing. → verify: `grep -n '"collapse"' src/typescript/lib/component/container/SplitGutter.ts` shows the new event.
4. **`Split.ts`** — add `_collapsed: Map<Component, boolean>`, `setPaneCollapsed`/`isPaneCollapsed`, `collapsedPanes` option routing in `applyOptions` ([`Split.ts:71`](../src/typescript/lib/layout/Split.ts#L71)); wire each gutter's `collapse` event in the creation loop ([`Split.ts:299`](../src/typescript/lib/layout/Split.ts#L299)); branch `doLayout` to substitute strip thickness for collapsed panes and redistribute freed space; create/show a persistent `CollapseStrip` per pane; add the priming/animation. Update `computeTotalMinSize` ([`Split.ts:225`](../src/typescript/lib/layout/Split.ts#L225)) so a collapsed pane reports the strip thickness, not its stored size. → verify: typecheck.
5. **`LayoutConstraints.ts`** — add `collapsible?: boolean`. → verify: typecheck.
6. **`Border.ts`** — add the ten backing flags, the four public setters/getters, read `constraints.collapsible` in `setLayoutConstraints` ([`Border.ts:77`](../src/typescript/lib/layout/Border.ts#L77)) (center forced non-collapsible), branch `doLayout` ([`Border.ts:402`](../src/typescript/lib/layout/Border.ts#L402)) to use strip thickness for collapsed regions, create per-region `CollapseButton`/`CollapseStrip` lazily (mirror `Accordion.createSection`'s lazy element creation), and add priming/animation. Update `getPreferredSize`/`getMinSize`/`computeTotalMinSize` so collapsed regions contribute only the strip thickness. → verify: typecheck.
7. **`Theme.ts` + three theme files** — add the `collapse` block and `themeToVars` entries (see Theme Tokens). → verify: `grep -rn 'collapse-strip' src/typescript/lib/core` shows interface + 3 themes + themeToVars.
8. **Barrels** — export `CollapseButton`/`CollapseStrip` (+ option/event types) from [`component/container/index.ts`](../src/typescript/lib/component/container/index.ts#L19). `Split`/`Border`/`LayoutConstraints` are already exported from `layout/index.ts`. → verify: typecheck.
9. **Demo** — extend the `SplitPanel.ts` demo ([`src/typescript/SplitPanel.ts`](../src/typescript/SplitPanel.ts)) to show a collapsible Split pane and a Border with a collapsible region for manual smoke testing.
10. **Docs** — see Documentation Impact.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/component/container/CollapseButton.ts` |
| Create | `src/typescript/lib/component/container/CollapseStrip.ts` |
| Modify | `src/typescript/lib/component/container/SplitGutter.ts` |
| Modify | `src/typescript/lib/component/container/index.ts` |
| Modify | `src/typescript/lib/layout/Split.ts` |
| Modify | `src/typescript/lib/layout/Border.ts` |
| Modify | `src/typescript/lib/layout/LayoutConstraints.ts` |
| Modify | `src/typescript/lib/core/Theme.ts` |
| Modify | `src/typescript/lib/core/themes/ClassicTheme.ts` |
| Modify | `src/typescript/lib/core/themes/DarkTheme.ts` |
| Modify | `src/typescript/lib/core/themes/ModernTheme.ts` |
| Modify | `src/typescript/SplitPanel.ts` (demo) |
| Modify | `docs/layouts/Split.md`, `docs/layouts/Border.md` |
| Modify | `docs/.vitepress/config.mts` (if a new page is added) |

---

## Verification

- **Typecheck:** `npx tsc --noEmit` — 0 errors.
- **Doc build:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- **Grep invariants:**
  - `grep -rn 'collapse-strip' src/typescript/lib/core` — interface + 3 themes + themeToVars present.
  - `grep -n '"collapse"' src/typescript/lib/component/container/SplitGutter.ts` — event wired.
- **Manual smoke (demo screen `SplitPanel`):**
  - Double-click the gutter chevron collapses the pane with a width/height animation; single-click and drag still resize without collapsing.
  - Double-click the strip's restore chevron restores the pane to its prior ratio.
  - Border: each of N/S/E/W collapses to a strip against its own edge; center grows to fill; a region with `collapsible: false` shows no chevron and cannot collapse; center never shows one.
  - Toggle `ThemeManager.setTheme(DarkTheme)` — strip/chevron colours track the theme.
  - `prefers-reduced-motion: reduce` — collapse/restore is instant, no snap or flicker.
  - Window resize while a pane is collapsed — expanded panes rescale, collapsed pane stays at strip thickness.

---

## Documentation Impact

New public symbols `CollapseButton`, `CollapseStrip` (+ their options/event types) are exported from the per-subpath barrel `src/typescript/lib/component/container/index.ts` — there is no root barrel. The new manager setters live on already-exported `Split`/`Border`; the `collapsible` field on already-exported `LayoutConstraints`.

- Update the curated pages [`docs/layouts/Split.md`](../docs/layouts/Split.md) and [`docs/layouts/Border.md`](../docs/layouts/Border.md) with a "Collapsible panels" section covering `setPaneCollapsed`/`setRegionCollapsed`/`setRegionCollapsible`, the double-click trigger, and the `collapsible` constraint opt-out.
- If `CollapseButton`/`CollapseStrip` warrant a curated component page, add it under `docs/components/`, list it in that catalog's `index.md`, and add a sidebar entry in [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts) (alongside the existing `AccordionPanel` entry at line ~127). Otherwise they are documented inline on the Split/Border pages and via generated API docs only.
- Cross-bucket JSDoc references (e.g. `Split` → `CollapseStrip` across `layout` → `component/container`) must use markdown links, not `{@link}`, per `_shared/docs-conventions.md`.

---

## Potential Challenges

- **Double-click vs drag-grab on the gutter.** The button is a separate child element wired to `dblclick`, and its `mousedown` calls `stopPropagation` so the gutter's `onDragStart` ([`SplitGutter.ts:201`](../src/typescript/lib/component/container/SplitGutter.ts#L201)) never fires from a button grab; a gutter drag never produces a `dblclick`, so the two paths are physically disjoint.
- **Animation snapped by DOM moves.** Never re-parent to collapse. The strip and collapsed child are persistent elements toggled by size/`visibility`, matching the persistent-content-frame rationale ([`LayoutManager.ts:189`](../src/typescript/lib/layout/LayoutManager.ts#L189)) and the re-parent-cancels-transition memory note.
- **Layout recalculation after collapse.** Collapse only flips a flag then calls `getContainer()?.scheduleLayout()`; `doLayout` is the single source of geometry, so collapsed sizing flows through the existing placement path. `Split._sizes` and `Border`'s preferred reads are left untouched so restore is exact.
- **`Split` size redistribution and rescale.** `recalculateSizes` rescales stored sizes on container resize ([`Split.ts:402`](../src/typescript/lib/layout/Split.ts#L402)); ensure the collapsed pane's strip thickness is excluded from the rescale pool so a resize while collapsed doesn't corrupt the frozen ratio — subtract collapsed strips from `available` before dividing.
- **`will-change` layer leak.** Use `Animation.afterTransition` with a `setTimeout` fallback (as `Accordion.primeWrapper` does) so the compositor layer is released even when `transitionend` doesn't fire (e.g. collapsing a zero-delta region or a tab-switch mid-animation).
- **Theme without the new block.** Custom themes predating the `collapse` block must still render; every CSS read uses a literal fallback (`var(--ts-ui-collapse-strip-bg, #AAAAAA)`).

---

## Critical Files

- [`src/typescript/lib/layout/Split.ts`](../src/typescript/lib/layout/Split.ts) — `_sizes` bookkeeping, `recalculateSizes`, gutter-creation loop, `computeTotalMinSize`.
- [`src/typescript/lib/layout/Border.ts`](../src/typescript/lib/layout/Border.ts) — five-slot placement math in `doLayout`, the preferred/min/max size methods.
- [`src/typescript/lib/component/container/SplitGutter.ts`](../src/typescript/lib/component/container/SplitGutter.ts) — drag wiring, listener-bag idiom, `declare` backing-field trap.
- [`src/typescript/lib/layout/Accordion.ts`](../src/typescript/lib/layout/Accordion.ts) — `primeWrapper` animation pattern, `Animation.afterTransition`, reduced-motion branch, easing-as-constant.
- [`src/typescript/lib/component/container/AccordionIndicator.ts`](../src/typescript/lib/component/container/AccordionIndicator.ts) — chevron glyph + rotation via shared class rule and per-instance state rule.
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `commitBounds`/`placeComponent`, persistent content-frame rationale.
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) and `themes/*` — token block + `themeToVars` wiring.

---

## Non-Goals

- **No persistence.** Collapsed state is in-memory only — no state-key storage, no reload survival (confirmed design decision 3).
- **No collapsible center region.** `Border`'s center is never collapsible; `collapsible: true` on a center constraint is ignored (confirmed design decision 2).
- **No collapse for other managers.** Only `Split` and `Border` gain this; `HBox`/`VBox`/`Accordion`/`Tab`/`Fit`/`Absolute` are untouched.
- **No single-click collapse and no keyboard toggle in this pass.** Activation is double-click only, per design decision 1; keyboard activation can follow later but is out of scope here.
- **No new motion theme tokens.** Easing/duration stay code constants per the `Accordion` precedent; only strip thickness and colours are themed.
