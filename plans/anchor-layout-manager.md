---
touches-shared: [src/typescript/lib/layout/index.ts]
---

# Anchor Layout Manager — Implementation Plan

## Overview

Add a new layout manager, `Anchor`, that positions each child by **edge-relative and proportional offsets** and re-resolves those offsets on every `doLayout` pass, so children stay pinned to a container edge — or stretch between two edges — as the container resizes. It is the resize-reactive counterpart to the existing static [`Absolute`](../src/typescript/lib/layout/Absolute.ts) manager, which merely commits each child at its own `getX()`/`getY()` and preferred size and never reads the container's inner size.

`Anchor` lives at `src/typescript/lib/layout/Anchor.ts` alongside `Absolute`, with a sibling constraints class at `src/typescript/lib/layout/AnchorConstraints.ts` mirroring [`GridConstraints`](../src/typescript/lib/layout/GridConstraints.ts). Per child it supports: pinning a fixed distance from any edge (`left`/`right`/`top`/`bottom`), deriving extent from the container when both opposing edges are set (stretch), and expressing any offset or an explicit `width`/`height` as a **percentage of the container's inner extent**. It reads `getInnerSize()` + `getContentInsets()` like [`Grid.doLayout`](../src/typescript/lib/layout/Grid.ts#L662) and commits computed rects via [`LayoutManager.commitBounds`](../src/typescript/lib/layout/LayoutManager.ts#L417) (bypassing the cell clamp), exactly as `Absolute` does.

It touches one shared file — the layout barrel [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts) — for exports. No new tsconfig/vite/package.json subpath entry is needed: `Anchor.ts` sits in the already-mapped `layout/` directory, the same directory `Absolute.ts` is exported from through that barrel.

---

## Architecture Decisions

### Mirror the `Absolute` callable idiom exactly

`Anchor` copies `Absolute`'s shape one-for-one: a private `class Anchor extends LayoutManager` with a `constructor(options?: AnchorOptions)` that calls `super()` (with the `// eslint-disable-next-line local/forward-super-options` comment, since `LayoutManager`'s constructor takes no args) and forwards to `applyOptions` when options are present; then the `callable(Anchor)` wrap and the dual export:

```ts
const AnchorCallable = callable(Anchor);
type AnchorCallable = Anchor;
export {
    Anchor         as _Anchor,
    AnchorCallable as Anchor
};
```

This keeps the `_Anchor` (real class, used for `instanceof`/serialization-name stripping) / `Anchor` (callable factory) convention consistent with every other manager.

### Pixel-vs-percentage representation: a tagged `AnchorValue` union

Each anchor field is an `AnchorValue = number | { percent: number }`. A bare `number` is **pixels**; `{ percent: 50 }` is **50% of the relevant container inner extent** (inner width for `left`/`right`/`width`, inner height for `top`/`bottom`/`height`). Rationale:

- **A bare number = pixels** keeps the common case (`{ left: 10, right: 10 }`) terse and reads identically to `Component.setX`-style pixel coordinates already used throughout the framework.
- **A tagged object for percent** is unambiguous and self-documenting in serialized/JSON form, avoids the string-parsing and validation burden of `"50%"`, and avoids the 0–1-vs-0–100 ambiguity of a bare fraction. `percent` is on a 0–100 scale to match CSS intuition.
- Rejected: a `{ value, unit }` tag on **every** value — it forces `{ value: 10, unit: "px" }` for the overwhelmingly common pixel case, which is noisy. The union keeps pixels bare and only tags the rarer percent case.

A small private resolver `resolve(v: AnchorValue | undefined, extent: number): number | undefined` returns `v` for a number, `extent * v.percent / 100` for a percent tag, and `undefined` when unset.

### Per-axis resolution is independent and identical in shape

The X axis is resolved from `left`, `right`, `width` against inner width; the Y axis from `top`, `bottom`, `height` against inner height — with the **same precedence rules** applied per axis. Resolution is purely a function of the three inputs plus the child's preferred extent and the container inner extent (see the precedence table). This independence means a child can stretch horizontally (`left`+`right`) while staying pinned to the top at preferred height (`top` only), etc.

### `Anchor` does NOT clamp, and does NOT participate in the universal-scroll contract

Like `Absolute`, `Anchor` commits rects directly through `commitBounds`, bypassing `resolveBounds`' cell clamp — a child sized larger than the container (e.g. a fixed `width` percentage on a tiny container, or a negative stretch) is committed at its computed size and may overflow. **It does not call `reserveContentFrame` and does not read `isOverflowingX/Y`.** Justification: `Anchor`'s whole purpose is to derive geometry *from* the container's current inner size, so its children are by construction sized relative to the viewport — there is no meaningful "content extent beyond the viewport that should drive a scrollbar" the way `Absolute`'s application-positioned children have. `Absolute` itself also does not call `reserveContentFrame` (it just relies on the host `Panel`'s `autoScroll` to scroll overflow); `Anchor` takes the same hands-off stance. A host `Panel` with `autoScroll` still scrolls any overflow natively. This keeps `Anchor` single-responsibility (geometry resolution only) and avoids the content-frame re-parenting transition-snap pitfall.

### Negative/inverted stretch collapses to zero, never throws

When both opposing edges are set but the offsets exceed the inner extent (`inner − left − right < 0`), the derived extent clamps to `0` rather than going negative. This is a defensive floor, not a feature; it keeps `commitBounds` from receiving a negative width/height.

### Size-hint overrides: leave them inherited (null), like `Absolute`

`Anchor` does **not** override `getPreferredSize`/`getMinSize`/`getMaxSize`. It inherits the base defaults (`getPreferredSize` → `null`, `getMinSize` → `{0,0}`, `getMaxSize` → `{UNBOUNDED, UNBOUNDED}`). Rationale: a child's anchored geometry is defined entirely relative to whatever inner size the container is given, so the manager imposes no intrinsic preferred size on its host — exactly as `Absolute` (which also leaves them inherited). A host that wants a fixed size sets its own `preferredSize`. Overriding these would invent a "preferred container size" that has no well-defined meaning when children are percentage-anchored.

---

## Public API (TypeScript Signatures)

### `Anchor.ts`

```ts
/** A length expressed in pixels (`number`) or as a percentage of the
 *  container's inner extent (`{ percent }`, 0–100 scale). */
export type AnchorValue = number | { percent: number };

/** Construction-time options for {@link Anchor}. */
export interface AnchorOptions extends LayoutManagerOptions {
}

// internal
class Anchor extends LayoutManager {
    constructor(options?: AnchorOptions);
    /** Resolves each child's rect from its {@link AnchorConstraints} against the
     *  container's inner size + insets and commits via `commitBounds`. */
    doLayout(): void;
}

const AnchorCallable = callable(Anchor);
type AnchorCallable = Anchor;
export { Anchor as _Anchor, AnchorCallable as Anchor };
```

`AnchorOptions` is intentionally empty (mirrors `AbsoluteOptions`) — all configuration is per-child. The empty `applyOptions` from the base is sufficient; the constructor still calls `applyOptions(options)` when options is present, to keep the idiom identical to `Absolute` and leave a forward hook.

### `AnchorConstraints.ts`

```ts
/** Per-child constraints for a component added to an {@link Anchor} container.
 *  Each edge offset pins the child a fixed distance (px) or proportion
 *  (`{ percent }`) from that side of the container's inner box; setting both
 *  opposing edges stretches the child between them. `width`/`height` give an
 *  explicit extent (px or percent) used when only one edge of an axis is set
 *  (or neither — then the child is pinned at the top-left). Unset fields fall
 *  through to the axis precedence rules. */
export class AnchorConstraints extends LayoutConstraints {
    /** Distance from the container's inner left edge to the child's left edge. */
    left?:   AnchorValue;
    /** Distance from the container's inner right edge to the child's right edge. */
    right?:  AnchorValue;
    /** Distance from the container's inner top edge to the child's top edge. */
    top?:    AnchorValue;
    /** Distance from the container's inner bottom edge to the child's bottom edge. */
    bottom?: AnchorValue;
    /** Explicit width; used when at most one horizontal edge is constrained.
     *  Ignored when both `left` and `right` are set (the pair derives width). */
    width?:  AnchorValue;
    /** Explicit height; used when at most one vertical edge is constrained.
     *  Ignored when both `top` and `bottom` are set (the pair derives height). */
    height?: AnchorValue;

    constructor();
}
```

All fields documented in the same JSDoc-on-each-field style `GridConstraints` uses. The class-level doc names the precedence behaviour and the px-vs-percent rule, mirroring how `GridConstraints`' class doc explains its placement/spanning semantics.

---

## Internal Structure

### Per-axis resolution precedence

X axis uses (`left`, `right`, `width`, innerWidth, child preferred width); Y axis uses (`top`, `bottom`, `height`, innerHeight, child preferred height). The table is **identical per axis** — below is the X axis; substitute `top`/`bottom`/`height`/innerHeight for the Y axis. Let `L`, `R`, `W` be the resolved (px) values of `left`, `right`, `width` (each `undefined` when the field is unset), `I` the inner width, `P` the child's preferred width (from `getPreferredSize()?.width`, falling back to `getSize()?.width`, then `0` — matching `Absolute`).

| `left` | `right` | `width` | Resulting `x` | Resulting `width` | Meaning |
| --- | --- | --- | --- | --- | --- |
| set | set | (ignored) | `L` | `max(0, I − L − R)` | **Stretch** between both edges |
| set | unset | set | `L` | `W` | Pin left, explicit width |
| set | unset | unset | `L` | `P` | Pin left at preferred width |
| unset | set | set | `I − R − W` | `W` | Pin right, explicit width |
| unset | set | unset | `I − R − P` | `P` | Pin right at preferred width |
| unset | unset | set | child `getX()` | `W` | Explicit width, app-positioned x |
| unset | unset | unset | child `getX()` | `P` | Fallback: app x + preferred width |

Notes:
- The two **unset/unset** rows fall back to the child's own `getX()` (and `getY()` on the Y axis), so a child with no horizontal constraint behaves like `Absolute` on that axis — preserving any application-set position. This makes mixed usage predictable (anchor one axis, hand-place the other).
- `width`/`height` are **ignored when both edges of the axis are set** (the stretch row), matching CSS `position:absolute` where `width` is ignored once both `left` and `right` are specified.
- All resolved px values come from the `resolve()` helper, so any field may independently be a percentage.

### `doLayout` algorithm

```ts
doLayout(): void {
    const container = this.getContainer();
    if (!container) return;

    const inner = container.getInnerSize();   // null before connect → bail
    if (!inner) return;

    const insets = container.getContentInsets();
    const originX = insets.getLeft();          // child coords are inset-relative,
    const originY = insets.getTop();           // as in Grid.doLayout

    for (const component of container.getLaidOutComponents()) {
        const cons = this.getLayoutConstraints(component) as AnchorConstraints | undefined;

        const pref = component.getPreferredSize();
        const size = component.getSize();
        const prefW = pref?.width  ?? size?.width  ?? 0;
        const prefH = pref?.height ?? size?.height ?? 0;

        const xAxis = this.resolveAxis(cons?.left, cons?.right, cons?.width,
                                       inner.width,  prefW, component.getX());
        const yAxis = this.resolveAxis(cons?.top,  cons?.bottom, cons?.height,
                                       inner.height, prefH, component.getY());

        this.commitBounds(component,
            originX + xAxis.start, originY + yAxis.start,
            xAxis.extent, yAxis.extent);
    }
}
```

`resolveAxis(near, far, sizeHint, inner, preferred, ownStart)` implements the precedence table once and is called for both axes; it returns `{ start, extent }` in inset-relative coordinates. The two `commitBounds` coordinates add the inset origin, matching `Grid`'s convention that placement starts at `insets.getLeft()/getTop()`. (For the unset/unset fallback rows, `ownStart` is the child's own `getX()/getY()`, which is already absolute within the container; the table returns it as `start` and the `+ origin` offset is applied — acceptable and consistent because `Absolute` also commits `getX()` without subtracting insets, so behaviour matches the existing static manager closely enough for the fallback case. If exactness is wanted, `resolveAxis` can return `start` already absolute for the fallback rows and the caller skip the origin add for them — implementer's discretion, documented inline.)

---

## Serialization registration

`LayoutSerialization.ts` recognises managers **by string name** via `managerKind()`, which reads `manager.getClassName().replace(/^_/, "")` and switches on `"Split"` / `"Tab"`. There is **no constructor registry** — it only descends into `Split`/`Tab` containers and records everything else as an opaque `"panel"` leaf. `Anchor` is a child-positioning manager, not an arrangement container with savable ratios/order, so it needs **no entry in `LayoutSerialization.ts`**: an `Anchor`-managed container serializes today as an opaque panel leaf, exactly like an `Absolute`, `Grid`, `HBox`, or `Border` container (none of which are registered there either). This is the correct and intended behaviour — confirm by noting that `Absolute` has no entry in `LayoutSerialization.ts`. **No serialization changes required.**

---

## Ordered Implementation Steps

1. **Create `src/typescript/lib/layout/AnchorConstraints.ts`** — `AnchorConstraints extends LayoutConstraints` with the six `AnchorValue` fields above, each with JSDoc; class-level JSDoc describing px-vs-percent and the both-edges-stretch rule. Constructor calls `super()`. → verify: file compiles in isolation (typecheck in step 5).
2. **Create `src/typescript/lib/layout/Anchor.ts`** — define `AnchorValue` and `AnchorOptions`; the `Anchor` class with the `Absolute`-shaped constructor; private `resolve(v, extent)` and `resolveAxis(near, far, sizeHint, inner, preferred, ownStart)` helpers; `doLayout` per the algorithm above. End with the `callable` wrap + dual export. → verify: matches the `_Absolute as _Anchor` / `AbsoluteCallable as Anchor` pattern.
3. **Export from the barrel** `src/typescript/lib/layout/index.ts`: add
   ```ts
   export { Anchor } from '~/layout/Anchor.js';
   export type { AnchorOptions, AnchorValue } from '~/layout/Anchor.js';
   export { AnchorConstraints } from '~/layout/AnchorConstraints.js';
   ```
   placed adjacent to the `Absolute` export lines. → verify: `grep -n "Anchor" src/typescript/lib/layout/index.ts` shows the three lines.
4. **Add a smoke demo** in `src/typescript/MiscPanel.ts` (next to the existing `new Absolute()` windows around line 1194): a `Panel` with `layoutManager: new Anchor()` containing (a) a child `{ left: 0, right: 0, top: 0, height: 40 }` (full-width header band), (b) a child `{ right: 8, bottom: 8, width: 120, height: 32 }` (pinned bottom-right button), (c) a child `{ left: { percent: 25 }, top: { percent: 25 }, width: { percent: 50 }, height: { percent: 50 }}` (centred 50% box). Resize the host window and confirm all three re-anchor. → verify: visual smoke (step in Verification).
5. **Typecheck**: `npm run typecheck` (or the project's tsc check) — 0 errors.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Create | `src/typescript/lib/layout/Anchor.ts` |
| Create | `src/typescript/lib/layout/AnchorConstraints.ts` |
| Modify | `src/typescript/lib/layout/index.ts` (barrel exports) |
| Modify | `src/typescript/MiscPanel.ts` (smoke demo) |
| Create | `docs/layouts/Anchor.md` (doc page — see Documentation Impact) |
| Modify | `docs/layouts/index.md` (catalog table row) |
| Modify | `docs/.vitepress/config.mts` (sidebar entry) |

---

## Verification

- **Typecheck**: project tsc passes with 0 errors.
- **Barrel grep**: `grep -n "Anchor" src/typescript/lib/layout/index.ts` → the three export lines.
- **Serialization untouched**: `grep -n "Anchor" src/typescript/lib/layout/LayoutSerialization.ts` → zero matches (Anchor is intentionally an opaque leaf, like Absolute).
- **`npm run docs:build`**: 0 errors and 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning). The new `docs/layouts/Anchor.md`, its catalog row, and the sidebar entry must resolve all internal links.
- **Manual smoke** — open the MiscPanel `Anchor` demo window (step 4): the full-width header stretches across the top, the bottom-right button stays 8px from the right and bottom edges, and the 50% box stays centred and half-size. **Resize the window** and confirm all three re-anchor on the resize-driven `doLayout` (contrast with an `Absolute` child, which would not move). Check an over-constrained case (`{ left: 0, right: 0 }` on a very narrow host) commits a width of `0`, not negative.

---

## Documentation Impact

- **Barrel**: the per-subpath barrel `src/typescript/lib/layout/index.ts` exports `Anchor`, `AnchorOptions`, `AnchorValue`, `AnchorConstraints` (root has no barrel).
- **New curated page** `docs/layouts/Anchor.md`, mirroring `docs/layouts/Absolute.md`'s structure: intro + ASCII diagram, a `## Usage` block (import from `@jimka/typescript-ui/layout`, attach `Anchor()`, add children with edge/percent constraints), a `## Per-child constraints` section documenting `left`/`right`/`top`/`bottom`/`width`/`height` and the `AnchorValue` px-vs-percent rule plus the precedence table, a `## When to use it` section (edge-pinned toolbars, stretch-between-edges panes, percentage overlays — contrasting with `Absolute`'s static positioning), and a `## See also` linking `/api/layout/classes/Anchor` and the layouts overview.
- **Catalog** `docs/layouts/index.md`: add a table row `| [`Anchor`](/api/layout/classes/Anchor) | Edge-relative & percentage positioning; pins children to edges or stretches between them, reactive to container resize |` adjacent to the `Absolute` row.
- **Sidebar** `docs/.vitepress/config.mts`: add `{ text: 'Anchor', link: '/layouts/Anchor' }` to the `'/layouts/'` sidebar group, next to the `Absolute` entry (line ~158).
- **Constraints doc** `docs/layouts/Constraints.md`: if it enumerates per-manager constraint shapes, add the `AnchorConstraints` fields there too (verify by reading the page; add only if it lists other managers' constraints).
- JSDoc on the new symbols uses markdown links (not `{@link}`) for any cross-bucket references per `_shared/docs-conventions.md`; intra-`layout` references may use `{@link}` as `GridConstraints`/`Absolute` do.

---

## Potential Challenges

- **Inset-relative vs absolute fallback coordinates** — the unset/unset fallback returns the child's own `getX()/getY()`; reconcile whether to add the inset origin to it (documented inline in `resolveAxis`). Mitigation: match `Absolute`'s convention (commit `getX()` directly, no inset add) for the fallback rows so mixed Anchor/Absolute usage is consistent.
- **`getInnerSize()` returns `null` before the element connects** — bail early exactly as `Grid.doLayout` does; the first real layout runs on render. Mitigation: the `if (!inner) return;` guard.
- **Percent base ambiguity** — percentages resolve against **inner** size (post-insets), the same base `commitBounds` coordinates live in. Documented in the JSDoc and the doc page so users don't expect border-box percentages.

---

## Critical Files

- `src/typescript/lib/layout/Absolute.ts` — the structural sibling to copy (callable idiom, `commitBounds` placement, no clamp, no size-hint overrides).
- `src/typescript/lib/layout/LayoutManager.ts` — base class: `commitBounds` (L417, bypasses the cell clamp), `getContainer`, the inherited `getPreferredSize/getMinSize/getMaxSize`, and the `setOverflowing`/`isOverflowingX/Y` contract Anchor opts out of.
- `src/typescript/lib/layout/LayoutConstraints.ts` — base for `AnchorConstraints`.
- `src/typescript/lib/layout/GridConstraints.ts` — the per-child-fields subclass pattern + JSDoc style to mirror.
- `src/typescript/lib/layout/Grid.ts` (`doLayout`, L662+) — reference for reading `getInnerSize()` + `getContentInsets()` and placing from `insets.getLeft()/getTop()`.
- `src/typescript/lib/layout/LayoutSerialization.ts` — confirms no registration is needed (string-name recognition, Split/Tab only).
- `src/typescript/lib/layout/index.ts` — the barrel to extend.
- `docs/layouts/Absolute.md`, `docs/layouts/index.md`, `docs/.vitepress/config.mts` — doc templates and registration points.

---

## Non-Goals

- **Not modifying `Absolute`** — it remains the purely static manager; `Anchor` is wholly new.
- **No serialization round-trip beyond opaque-leaf** — `Anchor` containers serialize as panel leaves like every non-arrangement manager; per-child anchor constraints are not captured by `LayoutSerialization` (out of scope, and consistent with `Grid`/`Border`).
- **No min/max/preferred container-size synthesis** — Anchor imposes no intrinsic size on its host (matches `Absolute`).
- **No centering/anchor-enum integration** — Anchor positions via explicit edge offsets, not the `AnchorType` enum; the two are orthogonal and Anchor ignores `LayoutConstraints.anchor`.
