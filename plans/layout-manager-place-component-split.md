# LayoutManager `placeComponent` Split — Implementation Plan

## Overview

Every layout manager — [`HBox`](../src/typescript/lib/layout/HBox.ts), [`VBox`](../src/typescript/lib/layout/VBox.ts), [`Column`](../src/typescript/lib/layout/Column.ts), [`Row`](../src/typescript/lib/layout/Row.ts), [`Border`](../src/typescript/lib/layout/Border.ts), [`Grid`](../src/typescript/lib/layout/Grid.ts), [`Tab`](../src/typescript/lib/layout/Tab.ts), [`Card`](../src/typescript/lib/layout/Card.ts), [`Fit`](../src/typescript/lib/layout/Fit.ts), [`Split`](../src/typescript/lib/layout/Split.ts) — routes child placement through [`LayoutManager.placeComponent`](../src/typescript/lib/layout/LayoutManager.ts#L126) ([LayoutManager.ts:126](../src/typescript/lib/layout/LayoutManager.ts#L126)). That single method does three things: resolves the child's effective `width`/`height` against constraints and a hard clamp to `maxWidth`/`maxHeight` ([lines 153-163, 179-189](../src/typescript/lib/layout/LayoutManager.ts#L153)), computes anchor displacement ([lines 195-239](../src/typescript/lib/layout/LayoutManager.ts#L195)), and commits via `setX/setY/setWidth/setHeight` + `doLayout` wrapped in `setAutoCommitStyle(false/true)` ([lines 241-249](../src/typescript/lib/layout/LayoutManager.ts#L241)).

The clamp is the blocker for any layout manager that wants to place a child larger than its cell — required for the native overflow that the shipped [`Panel.setAutoScroll`](../src/typescript/lib/core/Panel.ts#L124) plan demands when an oversized child sits inside a [`Fit`](../src/typescript/lib/layout/Fit.ts)-laid panel. Today the demo at [MiscPanel.ts:746-788](../src/typescript/MiscPanel.ts#L746) puts an 800x600 child inside a 360x240 `Fit`-laid scroll panel; `Fit.doLayout` calls `placeComponent(..., FillType.BOTH)` which silently shrinks the child to the cell size, so the native scroll viewport has nothing to scroll.

This plan splits `placeComponent` into two primitives — `resolveBounds` (pure computation) and `commitBounds` (writes) — so a layout manager that wants to bypass the clamp can call `commitBounds` directly at the child's preferred size. [`Absolute`](../src/typescript/lib/layout/Absolute.ts) is rewritten as the first concrete demonstration of the new seam. All ten existing `placeComponent` call sites keep their current behaviour through the default `placeComponent = commitBounds(component, ...resolveBounds(...))` composition.

---

## Architecture Decisions

### Split into two pure primitives, default `placeComponent` composes them

`placeComponent` is the *only* point of leverage every layout manager already routes through, so changing its public signature would touch every layout file. Adding a sibling seam (`resolveBounds` + `commitBounds`) keeps `placeComponent` byte-equivalent for current callers and exposes a lower-level opt-in for managers that need a different sizing policy. This is additive, not a rewrite.

### `resolveBounds` returns `{ x, y, width, height }` rather than mutating

A return value lets callers inspect the resolved rect (for clamping against insets, for logging, for measurement) before committing. A mutating signature would force callers to either re-read the values off the component or unroll the same fill/anchor logic themselves. The shape matches the four values `placeComponent` was already going to write.

### Both methods are `protected`, instance methods on `LayoutManager`

Layout managers are the only legitimate callers — outside-the-class consumers should still go through `placeComponent`. `protected` enables subclass use (the `Absolute` rewrite below) without widening the public surface. Instance methods (not statics) preserve the existing `this`-bound `getLayoutConstraints` lookup that `placeComponent` relies on at [line 127](../src/typescript/lib/layout/LayoutManager.ts#L127).

### Names: `resolveBounds` / `commitBounds`

`resolve` reads as pure computation; `commit` reads as write-through. Both are verbs that match the existing house style (`placeComponent`, `doLayout`, `applyOptions`). Considered and rejected: `computeBounds` / `applyBounds` (collides mentally with `applyOptions` which is option-bag dispatch, not commit), `measure` / `paint` (paint implies render-time visuals, not layout writes).

### Discrepancy with the task brief: `Absolute.doLayout` is currently a no-op

The task description states `Absolute.doLayout` "works around the clamp by passing the child's own `preferredSize` as `maxWidth`/`maxHeight`". The actual code at [Absolute.ts:33-34](../src/typescript/lib/layout/Absolute.ts#L33-L34) is a no-op (`doLayout(): void {}`) — children are expected to be positioned by the application via `setX`/`setY`/`setWidth`/`setHeight` directly. **No layout manager in the tree currently bypasses the clamp.** The `Fit`-based shipped demo at [MiscPanel.ts:773-775](../src/typescript/MiscPanel.ts#L773-L775) therefore already hits the clamp today and the oversized child is being silently shrunk to the viewport — meaning `Panel.setAutoScroll` is currently broken end-to-end and this plan is what unblocks it.

This plan rewrites `Absolute.doLayout` from "no-op" to "place each child at its `preferredSize` (or current `size`), bypassing the clamp via `commitBounds`, optionally honouring an explicit `x`/`y` from the constraint or falling back to `getX`/`getY`". That is the demonstration of the new seam and the fix for the shipped autoScroll demo — but it is a behaviour change to `Absolute`. Existing direct-positioning callers that explicitly set `x`/`y`/`width`/`height` will still see those values honoured because the new `doLayout` reads them off the component, not zero.

### Right/bottom inset is a positioning question, not a sizing question

The brief notes that the *old* (hypothetical) `Absolute` workaround "breaks right/bottom inset enforcement". In the new `Absolute.doLayout` the child's `x`/`y` come from the component's own `getX`/`getY` (set by the application). The container's left/top insets contribute to the inner-coordinate origin via `getInnerSize` / `getInsets` — `Absolute` does not impose extra insets on top. Right/bottom inset enforcement on an `Absolute`-laid container is the application's responsibility because the application is the one positioning children; this plan does not change that contract.

The "child can be 800 wide in a 350-wide container — that's fine" point in the brief is the explicit acceptance criterion: `Absolute` no longer clamps the child's size, period. If the host `Panel` has `autoScroll: "auto"` the overflow scrolls; if it has `autoScroll: "none"` (the default) the overflow clips. The clipping behaviour is owned by `Panel`, not by `Absolute`.

### Backward compatibility for the other nine layout managers

Every existing `placeComponent(...)` call site continues to call `placeComponent`, which keeps its current body, which now reads `commitBounds(component, ...resolveBounds(...))`. Because both halves of the split are extracted verbatim from the existing body (same locals, same control flow, same writes), the composition is observably identical. The plan calls this out as a regression risk but the mechanical refactor leaves no room for behavioural drift inside `placeComponent` itself.

---

## Caller Inventory

Every current `placeComponent` call site, with what it passes for `maxWidth`/`maxHeight` and `fill`/`anchor`. All ten callers pass cell-bounded `maxWidth`/`maxHeight` and rely on the clamp — none currently bypass it.

| File:Line | Caller | `maxWidth` / `maxHeight` source | `fill` |
| --- | --- | --- | --- |
| [Column.ts:270](../src/typescript/lib/layout/Column.ts#L270) | `Column.doLayout` (stretching branch) | `columnWidth`, `columnHeight` derived from container inner size | `FillType.BOTH` |
| [Column.ts:319](../src/typescript/lib/layout/Column.ts#L319) | `Column.doLayout` (non-stretching branch) | `columnWidth`, child's preferred `height` | `FillType.BOTH` |
| [Row.ts:217](../src/typescript/lib/layout/Row.ts#L217) | `Row.doLayout` | `columnWidth = containerSize.width`, even `columnHeight` | `FillType.BOTH` |
| [Tab.ts:616](../src/typescript/lib/layout/Tab.ts#L616) | `Tab.doLayout` (content area) | container width, container height minus toolbar | `FillType.BOTH` |
| [Card.ts:279](../src/typescript/lib/layout/Card.ts#L279) | `Card.doLayout` (visible card) | container inner width/height | `FillType.BOTH` |
| [Grid.ts:362](../src/typescript/lib/layout/Grid.ts#L362) | `Grid.doLayout` (stretching) | even `columnWidth`/`columnHeight` per cell | `FillType.BOTH` |
| [Grid.ts:429](../src/typescript/lib/layout/Grid.ts#L429) | `Grid.doLayout` (non-stretching) | `columnWidth`, per-row `height` | `FillType.BOTH` |
| [Border.ts:383](../src/typescript/lib/layout/Border.ts#L383) | `Border.doLayout` (north) | container width, north preferred height | `FillType.BOTH` |
| [Border.ts:409](../src/typescript/lib/layout/Border.ts#L409) | `Border.doLayout` (south) | container width, south preferred height | `FillType.BOTH` |
| [Border.ts:427](../src/typescript/lib/layout/Border.ts#L427) | `Border.doLayout` (west) | west preferred width, middle height | `FillType.BOTH` |
| [Border.ts:454](../src/typescript/lib/layout/Border.ts#L454) | `Border.doLayout` (east) | east preferred width, middle height | `FillType.BOTH` |
| [Border.ts:465](../src/typescript/lib/layout/Border.ts#L465) | `Border.doLayout` (center) | computed center width/height | `FillType.BOTH` |
| [VBox.ts:283](../src/typescript/lib/layout/VBox.ts#L283) | `VBox.doLayout` | resolved per-row `width`/`height` | `FillType.BOTH` |
| [HBox.ts:330](../src/typescript/lib/layout/HBox.ts#L330) | `HBox.doLayout` | resolved per-cell `width`/`height` | `FillType.BOTH` |
| [Split.ts:193](../src/typescript/lib/layout/Split.ts#L193) | `Split.doLayout` | resolved pane size from `_sizes` map | `FillType.BOTH` |
| [Fit.ts:236](../src/typescript/lib/layout/Fit.ts#L236) | `Fit.doLayout` | container inner width/height | `this._fill` (defaults to `BOTH`) |

`Absolute` and `Accordion` do not call `placeComponent` in their current form. `Accordion` uses its own placement path that bypasses `LayoutManager.placeComponent`; `Absolute.doLayout` is a no-op.

**Net behavioural impact of this plan on the other nine layout managers: zero.** They all keep calling `placeComponent`, which keeps its current behaviour through composition.

---

## Public API (TypeScript Signatures)

```ts
// New in src/typescript/lib/layout/LayoutManager.ts

/**
 * Pure resolution of a child's effective bounds within a cell. Looks up
 * stored constraints, applies fill/anchor overrides, clamps to the cell, and
 * computes anchor displacement. Does NOT mutate the component.
 */
protected resolveBounds(
    component: Component,
    x:         number,
    y:         number,
    maxWidth:  number,
    maxHeight: number,
    fill?:     FillType | null,
    anchor?:   AnchorType | null,
): { x: number; y: number; width: number; height: number };

/**
 * Commits a resolved rect to the component: writes setX/setY/setWidth/setHeight,
 * recurses into doLayout, all wrapped in setAutoCommitStyle(false/true). Used
 * by `placeComponent` and by layout managers that want to bypass the clamp.
 */
protected commitBounds(
    component: Component,
    x:         number,
    y:         number,
    width:     number,
    height:    number,
): void;

// Existing signature, now a one-liner:
placeComponent(
    component: Component,
    x:         number,
    y:         number,
    maxWidth:  number,
    maxHeight: number,
    fill?:     FillType | null,
    anchor?:   AnchorType | null,
): void;
```

`placeComponent` keeps its current public visibility (no modifier — same as today at [line 126](../src/typescript/lib/layout/LayoutManager.ts#L126)). The new methods are `protected` because they are subclass-only seams.

The current `placeComponent` has an implicit `void` return; the explicit `void` on all three signatures matches the project's "explicit return type on every function/method" rule from [`_shared/code-conventions.md`](../.claude/skills/_shared/code-conventions.md).

---

## Internal Structure

### `resolveBounds` body — extracted from current `placeComponent` lines 127-239

```ts
protected resolveBounds(
    component: Component,
    x: number, y: number,
    maxWidth: number, maxHeight: number,
    fill?: FillType | null, anchor?: AnchorType | null,
): { x: number; y: number; width: number; height: number } {
    const layoutConstraints = this.getLayoutConstraints(component);
    const preferredSize     = component.getPreferredSize();
    const size              = component.getSize();
    const maxSize           = component.getMaxSize();
    const minSize           = component.getMinSize();

    fill   = ((layoutConstraints ? layoutConstraints.fill   : undefined) || fill   || FillType.NONE)   as FillType;
    anchor = ((layoutConstraints ? layoutConstraints.anchor : undefined) || anchor || AnchorType.CENTER) as AnchorType;

    let width: number;
    let height: number;

    // ... existing width/height resolution block (current lines 138-193) ...
    // ... existing anchor-displacement block (current lines 195-239) ...

    return { x, y, width, height };
}
```

The body is a verbatim move of the existing computation. No logic changes. The closing block that wrote `setAutoCommitStyle`/`setX`/`setY`/`setWidth`/`setHeight`/`doLayout` is removed from this method.

### `commitBounds` body — extracted from current `placeComponent` lines 241-249

```ts
protected commitBounds(
    component: Component,
    x: number, y: number,
    width: number, height: number,
): void {
    component.setAutoCommitStyle(false);
    component.setX(x);
    component.setY(y);
    component.setWidth(width);
    component.setHeight(height);

    component.doLayout();

    component.setAutoCommitStyle(true);
}
```

Verbatim move. No logic changes.

### `placeComponent` body — composition

```ts
placeComponent(
    component: Component,
    x: number, y: number,
    maxWidth: number, maxHeight: number,
    fill?: FillType | null, anchor?: AnchorType | null,
): void {
    const r = this.resolveBounds(component, x, y, maxWidth, maxHeight, fill, anchor);
    this.commitBounds(component, r.x, r.y, r.width, r.height);
}
```

### `Absolute.doLayout` — concrete demonstration of the new seam

```ts
doLayout(): void {
    const container = this.getContainer();
    if (!container) {
        return;
    }

    const components = container.getComponents();

    for (const component of components) {
        const preferredSize = component.getPreferredSize();
        const size          = component.getSize();

        // Width/height policy: prefer explicit preferredSize, fall back to
        // current size, fall back to 0. NO clamp — this is the whole point of
        // bypassing placeComponent.
        const width  = preferredSize?.width  ?? size?.width  ?? 0;
        const height = preferredSize?.height ?? size?.height ?? 0;

        // x/y policy: honour whatever the application already set on the
        // component. Absolute is "application positions, we just commit".
        const x = component.getX();
        const y = component.getY();

        this.commitBounds(component, x, y, width, height);
    }
}
```

The child can be larger than the container — `commitBounds` writes raw values, no clamp. Whether the overflow is visible or clipped is then governed by the host `Panel`'s `autoScroll` mode (or by `Component`'s default `overflow: hidden` on a non-Panel container).

---

## Ordered Implementation Steps

1. **Extract `resolveBounds`** as a `protected` method on `LayoutManager` containing lines 127-239 of the current `placeComponent` body, returning `{ x, y, width, height }`. Update the existing locals (`width`, `height`, `x`, `y`) to flow into the return value. Verify: `npm run typecheck` clean.
2. **Extract `commitBounds`** as a `protected` method on `LayoutManager` containing lines 241-249 of the current `placeComponent` body. Verify: `npm run typecheck` clean.
3. **Rewrite `placeComponent`** body as the two-line composition shown above; keep public signature unchanged. Verify: `npm run typecheck` clean; `grep -n 'placeComponent(' src/typescript/lib/layout/*.ts` shows all ten existing callers untouched.
4. **JSDoc both new methods** per the project's JSDoc conventions ([`_shared/code-conventions.md`](../.claude/skills/_shared/code-conventions.md)). Same-bucket references (`Component`, `LayoutConstraints`, `FillType`, `AnchorType`, `LayoutManager`) — `Component` lives in `core`, the others in `layout`, so the cross-bucket markdown-link rule from [CLAUDE.md](../CLAUDE.md) applies for `Component`. Use ``[`Component`](/api/core/classes/Component)`` for that one; `{@link FillType}` / `{@link AnchorType}` / `{@link LayoutConstraints}` stay as same-bucket `{@link}`.
5. **Rewrite `Absolute.doLayout`** per the block above. Verify: `npm run typecheck` clean.
6. **Manual smoke test on `MiscPanel`** — `npm run dev`, open `http://localhost:8015`, click through every `autoScroll: <mode>` button on the Misc tab ([MiscPanel.ts:752](../src/typescript/MiscPanel.ts#L752)). The 800x600 child in the 360x240 window must overflow the viewport (not silently shrink) and the scrollbars must appear per the mode:
   - `"none"`: child overflows, no scrollbars, content clips at the viewport edge.
   - `"auto"`: both scrollbars appear (because both axes overflow).
   - `"x"`: horizontal only; vertical overflow clips.
   - `"y"`: vertical only; horizontal overflow clips.
   - `"both"`: both scrollbars always visible.
7. **Regression sweep on the other nine layout managers** — open the existing demo screens (HBox/VBox/Column/Row/Grid/Border/Card/Tab/Fit/Split) and confirm visually that no child's size changes from the master baseline. The composition is mechanical so this is a sanity check, not a behaviour change.
8. **Run `npm run docs:build`** — expect 0 errors and 0 link warnings (the lone acceptable warning is typedoc's pre-existing "unsupported TypeScript version" notice).
9. **Run `graphify update .`** to refresh the knowledge graph (per [CLAUDE.md](../CLAUDE.md) graphify rules).

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | [src/typescript/lib/layout/LayoutManager.ts](../src/typescript/lib/layout/LayoutManager.ts) — extract `resolveBounds` + `commitBounds`; reduce `placeComponent` to a two-line composition; add JSDoc on the two new methods. |
| Modify | [src/typescript/lib/layout/Absolute.ts](../src/typescript/lib/layout/Absolute.ts) — rewrite `doLayout` from no-op to per-child `commitBounds` at the child's preferred (or current) size, honouring application-set `x`/`y`. |

No new files. No deletions. No barrel changes (the new methods are `protected` and not part of the export surface).

---

## Verification

- `npm run typecheck` — clean.
- `grep -n 'placeComponent(' src/typescript/lib/layout/*.ts` — still ten call sites in the nine existing layout managers (count unchanged; `Absolute` continues not to call it).
- `grep -n 'resolveBounds\|commitBounds' src/typescript/lib/layout/LayoutManager.ts` — both methods defined exactly once.
- `grep -n 'commitBounds' src/typescript/lib/layout/Absolute.ts` — exactly one call in `doLayout`.
- Demo screen at `http://localhost:8015`, Misc tab, "autoScroll: auto" button — opens a 360x240 window containing an 800x600 child; both native scrollbars appear and scroll the oversized content. Confirms the seam works end-to-end.
- The other four `autoScroll` modes on the same row behave as enumerated in step 6.
- Visual spot-check of HBox / VBox / Column / Row / Border / Grid / Tab / Card / Fit / Split demos — no visible change from master.
- `npm run docs:build` — 0 errors, 0 link warnings (typedoc "unsupported TypeScript version" notice excepted).
- `graphify update .` — runs to completion.

---

## Documentation Impact

- `resolveBounds` and `commitBounds` are `protected` — they are NOT public API and do NOT need barrel re-export or curated doc pages.
- `LayoutManager`'s typedoc-generated page at `/api/layout/classes/LayoutManager` will pick up the new methods automatically when `npm run docs:build` runs.
- JSDoc cross-bucket reference: the new methods reference `Component` (which lives in `core`, a different bucket from `layout`). Use ``[`Component`](/api/core/classes/Component)`` markdown links, not `{@link Component}`, per [CLAUDE.md](../CLAUDE.md) and [`_shared/docs-conventions.md`](../.claude/skills/_shared/docs-conventions.md). Same-bucket references to `FillType`, `AnchorType`, `LayoutConstraints`, and other `LayoutManager` methods stay as `{@link}`.
- `Absolute`'s typedoc page picks up the new `doLayout` behaviour automatically; update the class-level JSDoc on `Absolute` to reflect that children are placed at their preferred size with application-set positions, replacing the current "no automatic layout" wording at [Absolute.ts:15-18](../src/typescript/lib/layout/Absolute.ts#L15-L18). No curated `docs/` page exists for `Absolute`.
- No renames, no removals, no `grep` over `docs/` required.

---

## Potential Challenges

- **Silent behaviour change in callers that incidentally rely on the clamp.** The mechanical move keeps the clamp inside `resolveBounds` which `placeComponent` still calls — so no existing caller loses the clamp. Mitigation: the regression sweep in step 7 spot-checks every existing demo screen. The risk surface is the verbatim extraction itself, which the diff makes easy to audit.
- **`Absolute.doLayout` was a no-op; making it active is a behaviour change.** Any existing usage of `Absolute` in the codebase that depended on the no-op (relying on children to position themselves and never have `doLayout` recursed into them) would see new `commitBounds` calls. Mitigation: `grep -rn 'new Absolute\b\|Absolute()' src/typescript/` to enumerate call sites before stepping through. The new `doLayout` honours application-set `x`/`y`/`preferredSize`, so an application that already configured those values continues to render at the same position; the new code merely formalises what the application was already doing manually.
- **`commitBounds` recurses into `child.doLayout`.** A child that has never had `doLayout` called (because `Absolute` was a no-op) now will. If a child's own `doLayout` has assumptions about being called only after explicit configuration, those surface now. Mitigation: spot-check is the same as the previous risk; the per-child recursion is what every other layout manager already does.
- **`preferredSize` fallback chain.** The `Absolute` rewrite uses `preferredSize ?? size ?? 0`. A component constructed without any of these renders at 0x0. That matches existing `placeComponent` behaviour at [LayoutManager.ts:145-152](../src/typescript/lib/layout/LayoutManager.ts#L145) where `sw` starts at 0 and stays 0 if neither size is set. No new failure mode.
- **JSDoc cross-bucket link to `Component`.** Easy to forget the markdown-link form and use `{@link Component}`. Mitigation: `npm run docs:build` will warn; the step-8 verification catches it.

---

## Critical Files

- [src/typescript/lib/layout/LayoutManager.ts](../src/typescript/lib/layout/LayoutManager.ts) — file under refactor; current `placeComponent` body is the source for the verbatim extraction.
- [src/typescript/lib/layout/Absolute.ts](../src/typescript/lib/layout/Absolute.ts) — currently a no-op `doLayout`; gets the demonstration rewrite.
- [src/typescript/lib/layout/FillType.ts](../src/typescript/lib/layout/FillType.ts), [AnchorType.ts](../src/typescript/lib/layout/AnchorType.ts), [LayoutConstraints.ts](../src/typescript/lib/layout/LayoutConstraints.ts) — types referenced in the new method signatures.
- [src/typescript/lib/core/Panel.ts](../src/typescript/lib/core/Panel.ts) — the shipped `setAutoScroll` that this plan unblocks; reads the host's `overflow*` properties which only matter once `commitBounds` lets children actually overflow.
- [src/typescript/MiscPanel.ts:746-788](../src/typescript/MiscPanel.ts#L746) — the golden-path demo: oversized 800x600 child inside a 360x240 `Fit`-laid `autoScroll` `Panel`.
- [plans/implemented/panel-auto-scroll.md](implemented/panel-auto-scroll.md) — the upstream feature that depends on this seam; format precedent for this plan.
- [CLAUDE.md](../CLAUDE.md) — JSDoc cross-bucket link rules and the graphify update step.

---

## Non-Goals

- **Scroll-aware `VBox` / `Column` / other layout managers.** The brief explicitly defers these. Once `commitBounds` exists, a future plan can add per-axis "let children overflow" modes to individual managers; this plan ships only the seam plus the `Absolute` demonstration.
- **A public-facing API change on `placeComponent`.** Signature and visibility are unchanged.
- **Removing the clamp from `placeComponent`.** The clamp stays where it is, inside `resolveBounds`, called by `placeComponent`. Every current caller continues to see the clamp.
- **Right/bottom inset enforcement on `Absolute`.** The brief flags this as worth thinking about; the decision here is that `Absolute`-laid containers do not enforce right/bottom insets because positioning is the application's responsibility. A separate plan can add a constrained `Absolute` variant if a concrete need surfaces.
- **A new `setScrollBypassClamp` knob on `LayoutManager`.** `commitBounds` is the seam; layout managers that want to bypass call it directly. No flag, no configuration object.
