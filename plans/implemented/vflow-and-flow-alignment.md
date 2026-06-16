# VFlow & Flow Line-Alignment — Implementation Plan

## Overview

Two related layout features. First, a new **`VFlow`** layout manager — the vertical transpose of [`HFlow`](../src/typescript/lib/layout/HFlow.ts): it packs children top-to-bottom into vertical columns and wraps to a new column rightward when the next child would exceed the container's inner height. Second, **main-axis line alignment** for both flows: today [`HFlow.doLayout`](../src/typescript/lib/layout/HFlow.ts#L339) always packs each line from the leading edge, leaving the trailing residual empty; a new `align` option packs that residual at the leading edge (`start`, current behaviour), the centre, or the trailing edge.

To share mechanics, a new abstract base **`FlowLayout`** ([`src/typescript/lib/layout/FlowLayout.ts`](../src/typescript/lib/layout/FlowLayout.ts), new) is introduced, mirroring how [`BoxLayout`](../src/typescript/lib/layout/BoxLayout.ts) backs `HBox`/`VBox`. `FlowLayout` carries the axis-agnostic flow config and helpers; `HFlow` and `VFlow` each implement the axis-specific size hints and the two-phase `doLayout`. `HFlow` is refactored to extend `FlowLayout` with its public behaviour and option names preserved exactly.

This touches the layout barrel ([`index.ts`](../src/typescript/lib/layout/index.ts)), the demo app ([`HFlowPanel.ts`](../src/typescript/HFlowPanel.ts), [`main.ts`](../src/typescript/main.ts)), and the docs ([`docs/layouts/HFlow.md`](../docs/layouts/HFlow.md), [`docs/layouts/index.md`](../docs/layouts/index.md), [`docs/.vitepress/config.mts`](../docs/.vitepress/config.mts)).

---

## Architecture Decisions

### Shared abstract base `FlowLayout`, mirroring `BoxLayout`

`HFlow` deliberately does **not** extend `BoxLayout` (see its `@remarks` at [HFlow.ts:45](../src/typescript/lib/layout/HFlow.ts#L45)) — a wrapping flow has no `mode`/`stretching`/`weight`/shrink. That stays true. The new `FlowLayout` is a *separate* abstract base that holds only the flow's own axis-agnostic plumbing: the `_spacing` / `_lineSpacing` / `_uniform` / new `_align` fields, their typed getters/setters, the `applyOptions` dispatch, the uniformity predicates and extent helper, and `clampedPreferredSize`. The geometric algorithms (`getPreferredSize` / `getMinSize` / `getMaxSize` / `doLayout`) are mirror-image per axis and stay concrete on each subclass — exactly the split `BoxLayout` documents at [BoxLayout.ts:57](../src/typescript/lib/layout/BoxLayout.ts#L57).

Like `BoxLayout`, `FlowLayout` is `abstract` and is **not** wrapped in `callable(...)`; only the concrete `HFlow`/`VFlow` get the `_X`/`X` callable export pair. The base's shared fields are `protected` (not `private`) so the subclass geometry methods can read them — the same visibility precedent `BoxLayout` sets at [BoxLayout.ts:69](../src/typescript/lib/layout/BoxLayout.ts#L69).

### What is genuinely shared vs axis-specific

**Moves into `FlowLayout` (axis-agnostic):**

- Fields `_spacing` (default 5), `_lineSpacing` (default 5), `_uniform` (`"none"`), `_align` (new, `"start"`).
- The constructor (`super()` then `applyOptions(options)`) and `applyOptions` dispatch (now also dispatching `align`).
- `getComponentSpacing`/`setComponentSpacing`, `getLineSpacing`/`setLineSpacing`, `getUniform`/`setUniform`, and the new `getAlign`/`setAlign`.
- `isUniformWidth` / `isUniformHeight` — these test the `_uniform` value (`"width"`/`"height"`/`"both"`) and are not axis-relative (they keep their literal width/height meaning for both managers), so they are shared verbatim.
- `computeUniformExtents` — returns the widest×tallest `{width,height}` across children; axis-agnostic, shared verbatim.
- `clampedPreferredSize` — pref clamped to min/max; axis-agnostic, shared verbatim.
- The `FlowUniformity` type and the `FlowLayoutOptions` interface (carrying `spacing`/`lineSpacing`/`uniform`/`align`).

**Stays axis-specific (concrete on each subclass):**

- `getPreferredSize`, `getMinSize`, `getMaxSize` — each is a single-line/single-column estimate along its own main axis; the existing HFlow versions sum widths and roll up `computeRowHeight` for the cross axis, VFlow transposes this (sum heights, max width, and — see below — VFlow gets no `computeRowHeight` baseline roll-up).
- `doLayout` — the two-phase grouping/placement, written per axis.
- The cross-axis size of a *column* in VFlow does not align text baselines (a wrapped vertical column has no shared baseline), so VFlow's hint methods use a plain `max(width)` for the cross axis where HFlow uses `computeRowHeight`. This is the VBox precedent: VBox's cross axis (width) is a plain `max`, only HBox rolls up baselines. Keep `computeRowHeight`/`computeRowMetrics` usage in HFlow only.

### New `align` option: orientation-relative `start | center | end`

The new option is `align?: FlowAlign` where `FlowAlign = "start" | "center" | "end"`, default `"start"` (preserves current HFlow leading-pack behaviour). It lives on `FlowLayout`/`FlowLayoutOptions` so both flows inherit one definition. Orientation-relative names (rather than directional `west`/`east`/`north`/`south`) are chosen because a single shared type must read correctly for both managers, and `start`/`center`/`end` matches the CSS `justify-content` mental model the framework already evokes elsewhere. Orientation mapping, documented on the type and in the per-manager docs:

- **HFlow** (main axis = horizontal): `start` = west (leading, current), `center` = centred, `end` = east (trailing).
- **VFlow** (main axis = vertical): `start` = north (leading), `center` = centred, `end` = south (trailing).

This aligns *each packed line's content block* along the line's main axis within the inner main extent. It is distinct from the per-child `AnchorType`, which positions a child *within its own (possibly uniform) cell* — both still apply.

### Two-phase `doLayout` for alignment

Today HFlow places greedily in a single pass from `lineStartX`. To align, placement must know each line's total content extent *before* placing, so `doLayout` becomes two phases:

1. **Group** children into lines (HFlow) / columns (VFlow): walk children, apply the same wrap test as today, and record per line: the ordered cells (each with its placed main/cross extent) and the line's **content main-extent** (sum of placed cell main-extents + inter-item spacing). Also track the running cross offset (`y` for HFlow, `x` for VFlow) and per-line cross extent (`lineHeight`/`lineWidth`).
2. **Place** each line: compute `residual = innerMainExtent − lineContentExtent`, clamp `residual = max(0, residual)` (an over-long single cell yields a negative residual → 0), then a per-line leading offset `lead = start→0 | center→residual/2 | end→residual`. Place each cell at `lineStart + lead + runningMainWithinLine`, with the cross coordinate from phase 1.

The existing over-wide-cell clamp is preserved: a cell that is the first on its line and wider than the inner main extent is clamped to the inner extent ([HFlow.ts:379](../src/typescript/lib/layout/HFlow.ts#L379)). That single over-long cell makes `lineContentExtent ≈ innerMainExtent`, so `residual` clamps to 0 and the alignment offset is 0 — the cell still starts at the leading inset, exactly as today. Per-child `placeComponent(..., FillType.NONE)` and the child's `AnchorType` within its cell are unchanged.

### Callable export & abstract-base interplay

`HFlow`'s callable export pair (`_HFlow`/`HFlow` via `callable(HFlow)`) is preserved verbatim; `VFlow` gets the identical pair. `FlowLayout`, being abstract, is exported as a plain `export { FlowLayout }` + `export type { FlowLayoutOptions }` like `BoxLayout` — never wrapped in `callable`.

---

## Public API (TypeScript Signatures)

### `FlowLayout.ts` (new)

```typescript
/** HFlow start=west/end=east; VFlow start=north/end=south. Default "start". */
export type FlowAlign = "start" | "center" | "end";

export type FlowUniformity = "none" | "width" | "height" | "both"; // moved from HFlow.ts

export interface FlowLayoutOptions extends LayoutManagerOptions {
    spacing?:     number;
    lineSpacing?: number;
    uniform?:     FlowUniformity;
    align?:       FlowAlign;
}

export abstract class FlowLayout extends LayoutManager {
    protected _spacing: number;       // = 5
    protected _lineSpacing: number;   // = 5
    protected _uniform: FlowUniformity; // = "none"
    protected _align: FlowAlign;      // = "start"

    constructor(options?: FlowLayoutOptions);
    protected applyOptions(options: FlowLayoutOptions): void;

    getComponentSpacing(): number;
    setComponentSpacing(spacing: number): this;
    getLineSpacing(): number;
    setLineSpacing(lineSpacing: number): this;
    getUniform(): FlowUniformity;
    setUniform(uniform: FlowUniformity): this;
    getAlign(): FlowAlign;
    setAlign(align: FlowAlign): this;

    protected isUniformWidth(): boolean;
    protected isUniformHeight(): boolean;
    protected computeUniformExtents(components: Component[]): Size;
    protected clampedPreferredSize(component: Component): Size;

    // each subclass implements:
    abstract getPreferredSize(): Size | null;
    abstract getMinSize(): Size | null;
    abstract getMaxSize(): Size | null;
    abstract doLayout(): void;
}
```

`FlowUniformity` moves to `FlowLayout.ts`. `HFlow.ts` keeps `export type { FlowUniformity }` only if it currently re-exports it — the barrel currently exports `FlowUniformity` *from* `HFlow.ts` ([index.ts:28](../src/typescript/lib/layout/index.ts#L28)), so re-export it from `FlowLayout.ts` instead (see barrel changes).

### `HFlow.ts` (refactored)

```typescript
export interface HFlowOptions extends FlowLayoutOptions {} // now empty; inherits all fields

class HFlow extends FlowLayout {
    getPreferredSize(): Size | null; // unchanged body
    getMinSize(): Size | null;       // unchanged body
    getMaxSize(): Size | null;       // unchanged body
    doLayout(): void;                // reworked to two-phase, default align "start" == today
}
const HFlowCallable = callable(HFlow);
type HFlowCallable = HFlow;
export { HFlow as _HFlow, HFlowCallable as HFlow };
```

Spacing/uniform/align getters/setters are inherited from `FlowLayout`; their HFlow JSDoc moves to the base. `HFlowOptions` becomes an empty extension of `FlowLayoutOptions` (keeps the named type the docs/barrel reference and the consumer-facing name stable).

### `VFlow.ts` (new)

```typescript
export interface VFlowOptions extends FlowLayoutOptions {}

class VFlow extends FlowLayout {
    getPreferredSize(): Size | null; // transpose: max child width, sum heights + spacing
    getMinSize(): Size | null;       // max child min height (floor), max width
    getMaxSize(): Size | null;       // sum child max heights, max child width
    doLayout(): void;                // top-to-bottom, wrap rightward, two-phase aligned
}
const VFlowCallable = callable(VFlow);
type VFlowCallable = VFlow;
export { VFlow as _VFlow, VFlowCallable as VFlow };
```

`getComponentSpacing` is the gap between items in a column (vertical); `getLineSpacing` is the gap between columns (horizontal) — same field names, transposed meaning, documented in `VFlow.md`.

---

## Internal Structure

### Two-phase `doLayout` (HFlow form; VFlow swaps width↔height, x↔y)

```
innerMain  = innerSize.width            // VFlow: innerSize.height
lineStart  = insets.getLeft()           // VFlow: insets.getTop()   (main-axis inset)
crossStart = insets.getTop()            // VFlow: insets.getLeft()  (cross-axis inset)

// phase 1 — group
lines = []                              // each: { cells:[{component, main, cross}], contentMain, crossExtent, crossOffset }
cross = crossStart
for component in components:
    cell      = clampedPreferredSize(component)
    cellMain  = uniformMain  ? extents.<main>  : cell.<main>     // HFlow: width / VFlow: height
    cellCross = uniformCross ? extents.<cross> : cell.<cross>
    if currentLine not empty and currentLineMainUsed + spacing + cellMain > innerMain:
        finalize currentLine (record contentMain, crossExtent); cross += crossExtent + lineSpacing; start new line
    placedMain = (currentLine empty) ? min(cellMain, innerMain) : cellMain   // over-long-cell clamp
    push {component, placedMain, cellCross}; currentLineMainUsed += (first? placedMain : spacing+placedMain)
    lineCrossExtent = max(lineCrossExtent, cellCross)
finalize last line

// phase 2 — place
for line in lines:
    residual = max(0, innerMain - line.contentMain)
    lead     = align=="start" ? 0 : align=="center" ? residual/2 : residual
    main = lineStart + lead
    for cell in line.cells:
        // HFlow: placeComponent(c, main, line.crossOffset, cell.placedMain, line.crossExtent, NONE)
        // VFlow: placeComponent(c, line.crossOffset, main, line.crossExtent, cell.placedMain, NONE)
        main += cell.placedMain + spacing
reserveContentFrame()
```

`contentMain` is the sum of `placedMain` over the line's cells plus `spacing*(count-1)`. Because phase 1 already enforced the wrap so the unaligned content fits within `innerMain` (except the single over-long-cell case, which clamps), `residual ≥ 0` after the clamp and alignment never pushes a cell before `lineStart`.

The HFlow cross axis keeps using `line.crossExtent` = the line's `computeRowHeight`-equivalent (tallest cell), and each child is anchored within `(placedMain × crossExtent)` exactly as today. VFlow's cross extent is the column's widest cell.

Per CODE_CONVENTIONS "decompose large functions": split phase 1 into a private `groupIntoLines(...)` (returns the line descriptors) and phase 2 into `placeLines(...)`; `doLayout` orchestrates the two plus `reserveContentFrame`. The line descriptor is a small private interface/type local to each file.

---

## Ordered Implementation Steps

1. **Create `FlowLayout.ts`.** Move `FlowUniformity`, add `FlowAlign` and `FlowLayoutOptions`, write the abstract `FlowLayout` with the four shared fields (`protected`), the constructor, `applyOptions` (dispatching spacing/lineSpacing/uniform/**align**), all the getters/setters incl. `getAlign`/`setAlign`, and the shared helpers `isUniformWidth`/`isUniformHeight`/`computeUniformExtents`/`clampedPreferredSize`. Declare the four geometry methods `abstract`. → verify: `npx tsc --noEmit` compiles the new file.
2. **Refactor `HFlow.ts`** to `extends FlowLayout`: delete the now-inherited fields, constructor, `applyOptions`, spacing/uniform getters/setters, and the moved helpers; make `HFlowOptions extends FlowLayoutOptions {}`; keep the three size-hint methods unchanged; rework `doLayout` into the two-phase form (default `align "start"`). Keep the `_HFlow`/`HFlow` callable export. → verify: `npx tsc --noEmit`.
3. **Regression-confirm HFlow unchanged at `align: "start"`.** With no `align` set the wrap test, placement order, over-long-cell clamp, and `reserveContentFrame` call must produce identical geometry to the pre-refactor single pass. Eyeball the **HFlow** demo tab (uniform `"both"`, anchored). → verify: HFlow tab renders as before; lines still pack from the west edge.
4. **Create `VFlow.ts`** as the transpose: size hints (max width / sum heights for preferred; max-child-min-height + max width for min; sum max heights + max width for max — no baseline roll-up on the cross axis), two-phase `doLayout` packing top-to-bottom and wrapping rightward, `_VFlow`/`VFlow` callable export, `VFlowOptions`. → verify: `npx tsc --noEmit`.
5. **Barrel** ([`layout/index.ts`](../src/typescript/lib/layout/index.ts)): add `export { FlowLayout }` + `export type { FlowLayoutOptions, FlowAlign }`; change the `FlowUniformity` re-export source to `FlowLayout.js`; add `export { VFlow }` + `export type { VFlowOptions }`. Mirror the HFlow lines (27-28). → verify: `npx tsc --noEmit`; `grep -n "FlowUniformity\|FlowAlign\|VFlow\|FlowLayout" src/typescript/lib/layout/index.ts`.
6. **Demo: `VFlowPanel.ts`** mirroring [`HFlowPanel.ts`](../src/typescript/HFlowPanel.ts) (extend `LayoutTestPanel`, set `new VFlow({ uniform: "both" })`, cycle `AnchorType` per child). Optionally set a non-default `align` on one of the flow panels to make the feature visible. Register a `"VFlow"` lazy tab in [`main.ts`](../src/typescript/main.ts) right after the HFlow tab ([main.ts:45](../src/typescript/main.ts#L45)) with its import beside [main.ts:8](../src/typescript/main.ts#L8). → verify: `npm run dev`; new **VFlow** tab appears and packs into columns.
7. **Docs.** Add `docs/layouts/VFlow.md` (transpose of HFlow.md, documenting the column packing, the transposed spacing/lineSpacing meaning, and the `align` north/center/south mapping). Update `docs/layouts/HFlow.md` with an `align` section (west/center/east) and add `align` to the `HFlowOptions`/setters prose and common-methods table. Add the VFlow catalog row to `docs/layouts/index.md` and the sidebar entry in `docs/.vitepress/config.mts` after HFlow ([config.mts:158](../docs/.vitepress/config.mts#L158)). → verify: `npm run docs:build` — 0 errors, 0 link warnings.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Create | `src/typescript/lib/layout/FlowLayout.ts` |
| Create | `src/typescript/lib/layout/VFlow.ts` |
| Create | `src/typescript/VFlowPanel.ts` |
| Create | `docs/layouts/VFlow.md` |
| Modify | `src/typescript/lib/layout/HFlow.ts` (extend FlowLayout; two-phase doLayout) |
| Modify | `src/typescript/lib/layout/index.ts` (exports) |
| Modify | `src/typescript/main.ts` (import + VFlow lazy tab) |
| Modify | `docs/layouts/HFlow.md` (align section) |
| Modify | `docs/layouts/index.md` (VFlow catalog row) |
| Modify | `docs/.vitepress/config.mts` (sidebar entry) |

---

## Verification

- **Typecheck:** `npx tsc --noEmit` clean after each of steps 1–5.
- **HFlow regression:** with `align` unset, the **HFlow** demo tab (Tab "HFlow") packs each line from the west edge and the over-wide first cell still clamps to the inner width — pixel-identical to pre-refactor. Toggle the theme to confirm no styling regressions.
- **Alignment:** set `align: "center"` / `"end"` on the HFlow panel and confirm wrapped lines shift their content block right; set the same on VFlow and confirm columns shift down.
- **VFlow:** the **VFlow** demo tab (Tab "VFlow") packs children top-to-bottom and wraps to a new column rightward once a column exceeds the inner height; with `uniform: "both"` cells form a grid; scrolling the host overflows horizontally (columns grow rightward), via `reserveContentFrame`.
- **Barrel:** `grep -n "VFlow\|FlowAlign\|FlowLayout" src/typescript/lib/layout/index.ts` shows the new exports; `FlowUniformity` now re-exported from `FlowLayout.js`.
- **Docs:** `npm run docs:build` — 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning); confirm `VFlow` lands under `docs/api/layout/classes/` (callable plugin promotion) and `FlowLayout` under `classes/` too.

---

## Documentation Impact

- **Barrel:** `layout/index.ts` exports `VFlow`/`VFlowOptions`, `FlowLayout`/`FlowLayoutOptions`/`FlowAlign`; `FlowUniformity` re-export source changes to `FlowLayout.js`. There is no root barrel.
- **`@category Layouts`** on every new exported symbol (`FlowLayout`, `VFlow`, `FlowAlign`, `FlowLayoutOptions`, `VFlowOptions`) so they land in `docs/api/layout/index.md`.
- **Curated pages:** new `docs/layouts/VFlow.md`; updated `docs/layouts/HFlow.md` (align); catalog row in `docs/layouts/index.md`; sidebar entry in `docs/.vitepress/config.mts`.
- **Cross-bucket JSDoc:** flow JSDoc references stay within the `layout` bucket, so `{@link …}` resolves; no cross-bucket markdown links needed for the new symbols. Per the docs conventions, verify `VFlow` and `FlowLayout` appear under `classes/` (not `variables/`) after build — `VFlow` via the `_VFlow`/`callable` form, `FlowLayout` as a plain abstract class.
- **Callable-plugin check:** `VFlow` must export as `VFlowCallable as VFlow` with inner `class VFlow` and a literal `callable(VFlow)` call for the auto-promotion.

---

## Potential Challenges

- **`HFlowOptions` becoming empty.** An empty `interface X extends Y {}` is valid and keeps the public name; the lint may flag `no-empty-interface` — mirror whatever `VBoxOptions extends BoxLayoutOptions {}` ([VBox.ts:22](../src/typescript/lib/layout/VBox.ts#L22)) already does (it is an empty extension and compiles), so follow that precedent verbatim.
- **`FlowUniformity` move breaking the barrel import.** The barrel re-exports it from `HFlow.js` today; missing the source change yields a build error. Step 5 changes the source; grep confirms.
- **Residual sign on the over-long cell.** A single cell wider/taller than the inner extent must not produce a negative offset — the `max(0, residual)` clamp handles it; verify by placing one oversized child in the demo.
- **VFlow baseline.** A wrapped vertical column has no shared text baseline; `getContentBaseline` stays `null` (inherited) and the cross axis uses plain `max`, not `computeRowHeight` — do not copy HFlow's baseline roll-up into VFlow.
- **Decomposition.** The two-phase `doLayout` plus grouping can exceed ~30 lines; split into `groupIntoLines`/`placeLines` private methods per CODE_CONVENTIONS to keep each readable.

---

## Critical Files

- [`src/typescript/lib/layout/HFlow.ts`](../src/typescript/lib/layout/HFlow.ts) — the manager refactored and transposed; source of every shared helper and the wrap/clamp logic.
- [`src/typescript/lib/layout/BoxLayout.ts`](../src/typescript/lib/layout/BoxLayout.ts) — precedent for an abstract base splitting config (here) from per-axis geometry (subclasses), incl. `protected` field visibility and the empty-options-extension pattern.
- [`src/typescript/lib/layout/VBox.ts`](../src/typescript/lib/layout/VBox.ts) — model for writing a vertical manager as a transpose (cross-axis `max`, no baseline roll-up, `reserveContentFrame`).
- [`src/typescript/lib/layout/LayoutManager.ts`](../src/typescript/lib/layout/LayoutManager.ts) — `placeComponent`/`resolveBounds`/`commitBounds` (anchor handling within the cell), `reserveContentFrame`, `computeRowHeight`/`computeRowMetrics`/`nullChildY`, the `_overflowing` machinery.
- [`src/typescript/lib/layout/AnchorType.ts`](../src/typescript/lib/layout/AnchorType.ts), [`FillType.ts`](../src/typescript/lib/layout/FillType.ts) — per-child cell positioning, applied unchanged.
- [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts) — export surface (lines 27-28 mirror).
- [`src/typescript/HFlowPanel.ts`](../src/typescript/HFlowPanel.ts), [`main.ts`](../src/typescript/main.ts) — demo wiring to mirror for VFlow.

---

## Non-Goals

- **No per-line justify / space-between / space-around distribution.** `align` moves each line's content block as a single unit; it does not redistribute inter-item spacing. Justified spacing is out of scope.
- **No cross-axis alignment of short final lines** beyond what the per-child `AnchorType` already does within each cell. A short last line is not vertically (HFlow) / horizontally (VFlow) re-centred against the others.
- **No new sizing knobs on the flows.** No `mode`/`stretching`/`weight`/shrink — that is the reason HFlow does not extend `BoxLayout`, and it stays true for `FlowLayout`/`VFlow`.
- **No change to `HFlow`'s public option names or default behaviour.** `align` defaults to `"start"`, which is today's leading pack.
- **No reading `direction` / RTL knob.** A right-to-left or bottom-to-top flow is deliberately out of scope: the framework has no notion of text directionality today, so a flow-only RTL would be inconsistent with `HBox`/`VBox`/`Grid`/text rendering. RTL belongs to a future framework-wide effort; `align: "end"` already covers the common "pack to the trailing edge" need, and reversed item order is better expressed by reversing the component order. The two-phase `doLayout` leaves room to add main-axis reversal later without rework.
- **No new theme tokens** — flow geometry is driven by pixel options, not CSS custom properties.
