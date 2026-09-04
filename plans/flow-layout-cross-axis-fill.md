---
touches-shared:
  - packages/lib/src/typescript/lib/layout/FlowLayout.ts
  - packages/lib/src/typescript/lib/layout/HFlow.ts
  - packages/lib/src/typescript/lib/layout/VFlow.ts
  - packages/lib/docs/layouts/Constraints.md
  - packages/lib/docs/reference/changelog/next.md
---

# FlowLayout Cross-Axis Fill — Implementation Plan

## Overview

Give the wrapping flow layouts [`HFlow`](packages/lib/src/typescript/lib/layout/HFlow.ts#L57) and [`VFlow`](packages/lib/src/typescript/lib/layout/VFlow.ts#L58) a per-child **cross-axis fill**: a child whose stored `fill` constraint carries the flow's cross axis stretches to its own wrapped line's cross extent — the row height in an `HFlow`, the column width in a `VFlow`. This is the flow's version of CSS `align-self: stretch` under `flex-wrap`, and it mirrors what [`BoxLayout.crossPlacement`](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L525) already does for `HBox`/`VBox`.

Today a flow sizes every cell from the child's clamped preferred size ([`FlowLayout.clampedPreferredSize`](packages/lib/src/typescript/lib/layout/FlowLayout.ts#L406)) and its only cross-axis concept is `itemAlign`, which *offsets* a cell inside its line without resizing it ([`FlowLayout.crossOffset`](packages/lib/src/typescript/lib/layout/FlowLayout.ts#L480)). A child that carries no cross size of its own — a divider rule whose preferred, minimum and maximum extents are all `0` along the axis it spans — therefore renders as a zero-length, invisible line.

The plumbing is already half there. [`LayoutManager.resolveBounds`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L383) reads the child's stored `fill` and lets it outrank the fallback the caller passes ([LayoutManager.ts:392](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L392)), then sizes a filled axis to the cell extent it was given ([LayoutManager.ts:430](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L430)). What is missing is that the flow hands `resolveBounds` a cell whose cross extent is the child's own preferred extent. The change is therefore small and local: pass the **line's** cross extent as the cell extent for a cross-filled child, and place that child at the line's leading cross edge. Three source files — `FlowLayout.ts` (one new protected helper), `HFlow.ts` and `VFlow.ts` (one branch each in the placement loop) — plus tests, six stale statements claiming a flow never resizes a cell, two docs pages and a changelog entry.

---

## Architecture Decisions

### Read the existing `fill` constraint; add no new option

A cross-filled child is one whose stored [`LayoutConstraints.fill`](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts#L39) carries the flow's cross-axis component: `FillType.VERTICAL` or `FillType.BOTH` in an `HFlow`, `FillType.HORIZONTAL` or `FillType.BOTH` in a `VFlow`. No new `FlowLayoutOptions` field, no new constraint field, no new setter. This copies `BoxLayout.crossPlacement` ([BoxLayout.ts:530](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L530)) axis test for axis test.[^precedent]

### A filled child stretches to its own line, not to the container

The cell extent a filled child receives is the cross extent of the wrapped line it landed in — `row.rowHeight` for `HFlow`, `column.columnWidth` for `VFlow` — not the container's inner cross extent.[^per-line]

### The line's cross extent is computed exactly as it is today

`groupIntoRows` / `groupIntoColumns` keep folding each cell's own clamped preferred cross extent into the line ([HFlow.ts:357](packages/lib/src/typescript/lib/layout/HFlow.ts#L357), [VFlow.ts:341](packages/lib/src/typescript/lib/layout/VFlow.ts#L341)). A cross-filled child contributes its own cross extent to that fold — and, under `itemAlign: "baseline"`, its baseline to the row's height calculation — exactly as today.[^line-extent]

### A filled child ignores `itemAlign` and sits at the line's leading cross edge

`itemAlign` distributes the slack between a cell and its line. A filled cell has no slack, so its cross offset is `0` — the row top in an `HFlow`, the column left in a `VFlow` — and [`crossOffset`](packages/lib/src/typescript/lib/layout/FlowLayout.ts#L480) is not consulted for it. This matches CSS, where `align-self: stretch` overrides the container's `align-items`, and `BoxLayout.crossPlacement`, which returns `offset: crossLead` for a filled child ([BoxLayout.ts:535](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L535)).

### The child's own maximum is enforced by the child, not by the flow

The flow hands over the full line extent without capping it to the child's maximum size. A child whose maximum is smaller keeps its maximum, because `commitBounds` writes through `setWidth`/`setHeight`, which clamp ([Component.ts:4076](packages/lib/src/typescript/lib/core/Component.ts#L4076)) — so rule 5 of [ARCHITECTURE.md](ARCHITECTURE.md#L107) ("never stretch a component beyond its max size") holds at the committed size. `HBox`/`VBox` rely on the same clamp.[^max-clamp]

### The flow's reported sizes do not change

`getPreferredSize`, `getMinSize` and `getMaxSize` on both `HFlow` and `VFlow` are left alone. A filled child is stretched only up to a line extent that its siblings already set, so no line, and therefore no reported extent, grows because of a `fill` constraint.[^size-reports]

### A new predicate helper, not a copy of `crossPlacement`'s return shape

`FlowLayout` gets one protected predicate, `isCrossFilled(component, horizontal)`, shared by both subclasses. It returns a boolean rather than `BoxLayout.crossPlacement`'s `{ offset, extent } | null`.[^helper-shape]

---

## Public API

No new exported symbols, options, setters or types. The feature is consumed through the constraint bag `addComponent` already accepts:

```typescript
import { FillType } from '@jimka/typescript-ui/layout';

// HFlow: this child spans its wrapped row's full height; siblings are unaffected.
panel.addComponent(divider, { fill: FillType.VERTICAL });

// VFlow: this child spans its wrapped column's full width.
panel.addComponent(rule, { fill: FillType.HORIZONTAL });
```

### New protected helper on `FlowLayout`

```typescript
export abstract class FlowLayout extends LayoutManager {
    /**
     * Whether the child's stored `fill` constraint carries this flow's cross
     * axis, making it an align-self stretch against its wrapped line.
     *
     * @param component - The child whose constraints supply the fill intent.
     * @param horizontal - `true` for HFlow (cross axis is vertical), `false`
     *   for VFlow (cross axis is horizontal).
     * @returns `true` when the child stretches to its line's cross extent.
     */
    protected isCrossFilled(component: Component, horizontal: boolean): boolean;
}
```

`protected`, so per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) no public JSDoc may `{@link}` it — describe the behaviour in prose in the class docs instead.

---

## Implementation

`FlowLayout.isCrossFilled`, placed directly after `crossOffset` (which ends at [FlowLayout.ts:501](packages/lib/src/typescript/lib/layout/FlowLayout.ts#L501)) and before the `justifyGaps` doc comment:

```typescript
protected isCrossFilled(component: Component, horizontal: boolean): boolean {
    const fill = this.getLayoutConstraints(component)?.fill ?? null;

    return horizontal
        ? (fill === FillType.VERTICAL   || fill === FillType.BOTH)
        : (fill === FillType.HORIZONTAL || fill === FillType.BOTH);
}
```

`FlowLayout.ts` does not import `FillType` today; add `import { FillType } from "~/layout/FillType.js";` alongside the existing imports.

The `HFlow.resolveRows` cell loop ([HFlow.ts:396](packages/lib/src/typescript/lib/layout/HFlow.ts#L396)) becomes:

```typescript
for (const cell of row.cells) {
    const crossFilled = this.isCrossFilled(cell.component, true);
    const cellHeight  = crossFilled ? row.rowHeight : cell.height;
    const y           = row.y + (crossFilled ? 0 : this.crossOffset(cell.height, row.rowHeight, cell.baseline, rowAscent, rowDescent));

    placements.push({ component: cell.component, ...this.resolveBounds(cell.component, x, y, cell.width, cellHeight, FillType.NONE) });

    x += cell.width + gap;
}
```

The cursor advance stays `cell.width` — the main axis is untouched.

The `VFlow.resolveColumns` cell loop ([VFlow.ts:376](packages/lib/src/typescript/lib/layout/VFlow.ts#L376)) is the transpose:

```typescript
for (const cell of column.cells) {
    const crossFilled = this.isCrossFilled(cell.component, false);
    const cellWidth   = crossFilled ? column.columnWidth : cell.width;
    // rowAscent null → "baseline" degrades to "start"; cross axis is width.
    const x           = column.x + (crossFilled ? 0 : this.crossOffset(cell.width, column.columnWidth, null, null, 0));

    placements.push({ component: cell.component, ...this.resolveBounds(cell.component, x, y, cellWidth, cell.height, FillType.NONE) });

    y += cell.height + gap;
}
```

### Worked example

`HFlow({ spacing: 5 })` in a host with inner size 300 × 200 and no insets. Three children on one row: `A` (preferred 40 × 20), `R` (preferred 1 × 0, min 1 × 0, max 1 × `UNBOUNDED`, constraint `fill: FillType.VERTICAL`), `C` (preferred 60 × 30). The row's content width is 111, so nothing wraps, and `row.rowHeight` is `max(20, 0, 30) = 30`.

| Child | Cell height today | Cell height after | Committed height | Committed y, `itemAlign: "start"` | Committed y, `itemAlign: "center"` |
|---|---|---|---|---|---|
| `A` | 20 | 20 | 20 | 0 | 5 |
| `R` (filled) | 0 | 30 | 30 | 0 | 0 |
| `C` | 30 | 30 | 30 | 0 | 0 |

`R` is the only child whose geometry changes, and `itemAlign` stops applying to it.

### `fill` against `uniform`

`uniform` already forces a common cell extent on one or both axes ([`computeUniformExtents`](packages/lib/src/typescript/lib/layout/FlowLayout.ts#L382)). Where it fixes the *cross* axis, every cell in a line is already the line's cross extent, so `fill` changes nothing:

| Manager | `uniform` | `itemAlign` | Line cross extent | Filled child's cell cross extent | Net effect of `fill` |
|---|---|---|---|---|---|
| `HFlow` | `"none"` / `"width"` | any but `"baseline"` | tallest cell in the row | the row height | stretches |
| `HFlow` | `"height"` / `"both"` | any but `"baseline"` | the uniform cell height | the uniform cell height | none — the cell is already that tall |
| `HFlow` | `"height"` / `"both"` | `"baseline"` | `rowAscent + rowDescent`, which can exceed the uniform cell height | that row height | stretches past the uniform cell |
| `VFlow` | `"none"` / `"height"` | any | widest cell in the column | the column width | stretches |
| `VFlow` | `"width"` / `"both"` | any | the uniform cell width | the uniform cell width | none |

No `uniform`-specific code is needed: reading `row.rowHeight` / `column.columnWidth` produces every row of that table on its own.

---

## Ordered Implementation Steps

The `implement` skill works test-first: steps 1–3 add failing tests, steps 4–6 make them pass.

1. **`packages/lib/tests/component/layout/HFlow.test.ts`** — add a `describe('HFlow per-child cross-axis fill (align-self: stretch)')` block covering behaviours H1–H5 in `## Expected Behaviour`. Build constraints the way [HBox.test.ts:301](packages/lib/tests/component/layout/HBox.test.ts#L301) does: `Object.assign(new LayoutConstraints(), { fill: FillType.VERTICAL })`, then `host.addComponent(child, constraints)`. The block needs three imports the file does not have yet — `FillType` from `~/layout/FillType`, `LayoutConstraints` from `~/layout/LayoutConstraints`, `UNBOUNDED` from `~/primitive/Size`. Verify: `npx vitest run tests/component/layout/HFlow.test.ts` from `packages/lib` — the new tests fail, the existing ones pass.
2. **`packages/lib/tests/component/layout/VFlow.test.ts`** — add `describe('VFlow per-child cross-axis fill (align-self: stretch)')` covering V1–V3, with the same three imports. Verify: the same command against `VFlow.test.ts` — new tests fail, existing pass.
3. **`packages/lib/tests/component/layout/FlowLayout.test.ts`** — add `describe('FlowLayout cross-axis fill vs uniform cells and size reports')` covering U1, U2 and S1, with the same three imports. Verify: U1/U2 already pass (they are regression guards for the uniform no-op); S1 passes both before and after.
4. **`packages/lib/src/typescript/lib/layout/FlowLayout.ts`** — add the `FillType` import and the `isCrossFilled` helper from `## Implementation`, placed between `crossOffset` (ends line 501) and the `justifyGaps` doc comment (starts line 503).
5. **`packages/lib/src/typescript/lib/layout/HFlow.ts`** — replace the cell loop in `resolveRows` (lines 396–402) with the version in `## Implementation`. Verify: `npx vitest run tests/component/layout/HFlow.test.ts` — all green.
6. **`packages/lib/src/typescript/lib/layout/VFlow.ts`** — replace the cell loop in `resolveColumns` (lines 376–383) with the version in `## Implementation`. Verify: `npx vitest run tests/component/layout/VFlow.test.ts` — all green.
7. **Correct the six doc comments and doc sentences that state a flow never resizes a cell.** Each keeps its existing claim as the default and adds the exception:
   - [FlowLayout.ts:39](packages/lib/src/typescript/lib/layout/FlowLayout.ts#L39) — "Flow never resizes cells, so alignment only moves them." → say that alignment only moves a cell, and that a child with a cross-axis `fill` constraint instead takes the whole line extent and ignores `itemAlign`.
   - [HFlow.ts:39](packages/lib/src/typescript/lib/layout/HFlow.ts#L39) and [VFlow.ts:41](packages/lib/src/typescript/lib/layout/VFlow.ts#L41) — "never shrinks or stretches children" → never shrinks a child, and stretches one only on the cross axis and only when that child asks for it with a cross-axis `fill`.
   - [HFlow.ts:368](packages/lib/src/typescript/lib/layout/HFlow.ts#L368) and [VFlow.ts:353](packages/lib/src/typescript/lib/layout/VFlow.ts#L353) — "Each child keeps its preferred size (`FillType.NONE`)" → each child keeps its preferred size unless its own constraints set a cross-axis `fill`, which sizes it to the line's cross extent.
   - [VFlow.md:3](packages/lib/docs/layouts/VFlow.md#L3) — same amendment as the `VFlow.ts` class doc.

   Verify: `grep -rn "never resizes cells\|shrinks or stretches" packages/lib/src packages/lib/docs` — expect zero matches, which mechanically covers the first four sites. The two `FillType.NONE` sentences are named by file and line above; re-read them.
8. **`packages/lib/docs/layouts/HFlow.md`** — add a `## Per-child cross-axis alignment (align-self)` section after `## Item alignment` (which ends at line 137), modelled on [HBox.md:138](packages/lib/docs/layouts/HBox.md#L138): the `fill: FillType.VERTICAL` / `FillType.BOTH` values, that the child spans **its own wrapped row** and not the container, that it overrides `itemAlign` for that child only, and the `uniform` table row saying `fill` is inert under `uniform: "height"`/`"both"`. Also amend the `fill` bullet under `## Per-child constraints` (line 181).
9. **`packages/lib/docs/layouts/VFlow.md`** — the transposed section (`FillType.HORIZONTAL` / `BOTH`, spans its wrapped column, inert under `uniform: "width"`/`"both"`) after `## Item alignment`, plus the `fill` bullet at line 138.
10. **`packages/lib/docs/layouts/Constraints.md`** — extend the sentence at line 16 so the flow layouts join `HBox`/`VBox` as managers that read the cross-axis component of `fill`, noting the flows read `fill` only (not `anchor`) and measure against the wrapped line.
11. **`packages/lib/docs/reference/changelog/next.md`** — add one bullet under `## Added` → `### Layouts` (line 114), in the style of the entries already there.
12. Run the full verification in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/FlowLayout.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/HFlow.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/VFlow.ts` |
| Modify | `packages/lib/tests/component/layout/HFlow.test.ts` |
| Modify | `packages/lib/tests/component/layout/VFlow.test.ts` |
| Modify | `packages/lib/tests/component/layout/FlowLayout.test.ts` |
| Modify | `packages/lib/docs/layouts/HFlow.md` |
| Modify | `packages/lib/docs/layouts/VFlow.md` |
| Modify | `packages/lib/docs/layouts/Constraints.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Every case below is unit-testable with the existing `installTestDOM` harness; none needs a browser. "A rule child" means a `Component` with the geometry of a divider: `preferredSize` and `minSize` of `1 × 0`, `maxSize` of `1 × UNBOUNDED`, and constraint `fill: FillType.VERTICAL` (`0 × 1`, `UNBOUNDED × 1`, `fill: FillType.HORIZONTAL` for the `VFlow` transpose).

**H1 — a rule child spans its row.** `HFlow({ spacing: 5 })`, host 300 × 200, children `A` (40 × 20), `R` (rule), `C` (60 × 30). Expect `R.getHeight() === 30`, `R.getY() === 0`, `R.getWidth() === 1`, `R.getX() === 45`. `A.getHeight() === 20` and `C.getHeight() === 30` are unchanged.

**H2 — fill overrides `itemAlign` for that child only.** Same as H1 with `itemAlign: "center"`. Expect `A.getY() === 5` (centred in the 30-tall row) but `R.getY() === 0` and `R.getHeight() === 30`.

**H3 — the child's maximum caps the stretch.** Same as H1, but `R`'s `maxSize` is `1 × 12`. Expect `R.getHeight() === 12` and `R.getY() === 0` — the flow offers 30, the child's own clamp refuses it.

**H4 — a rule alone on a wrapped row stays zero-tall.** `HFlow({ spacing: 5, lineSpacing: 8 })`, host inner width 100, children `A` (95 × 20) then `R` (rule). `A` fills row 1; `R` does not fit beside it (95 + 5 + 1 = 101 > 100) and wraps alone. Expect `R.getHeight() === 0` — a line's cross extent comes from its members, and `R` is its only member. This is the documented limit, not a defect.

**H5 — an unconstrained child is untouched.** Same as H1 with `R` carrying no constraints at all. Expect `R.getHeight() === 0`, exactly as before the change.

**V1 — a rule child spans its column.** `VFlow({ spacing: 5 })`, host 300 × 200, children `A` (20 × 40), `R` (rule), `C` (30 × 60). Expect `R.getWidth() === 30`, `R.getX() === 0`, `R.getHeight() === 1`, `R.getY() === 45`.

**V2 — fill overrides `itemAlign` for that child only.** V1 with `itemAlign: "center"`. Expect `A.getX() === 5` but `R.getX() === 0` and `R.getWidth() === 30`.

**V3 — an unconstrained child is untouched.** V1 with `R` carrying no constraints. Expect `R.getWidth() === 0`.

**U1 — `fill` is inert when `uniform` already fixes the cross axis (HFlow).** `HFlow({ uniform: "height" })` with H1's children. Every cell is 30 tall, so `R.getHeight() === 30` — the same value with or without the constraint.

**U2 — `fill` is inert when `uniform` already fixes the cross axis (VFlow).** `VFlow({ uniform: "width" })` with V1's children. Expect `R.getWidth() === 30` with or without the constraint.

**S1 — the flow's reported sizes are unaffected.** Build two identical `HFlow` hosts with H1's children, giving `R` the `fill` constraint in one and no constraints in the other. Lay both out. Expect `getPreferredSize()`, `getMinSize()` and `getMaxSize()` to be equal between the two hosts on both axes.

**Manual, and only once the unmerged `feature/separator-component` branch is also on `master`:** `Separator` is the divider component that motivated this change — a one-pixel rule that spans its container by writing a cross-axis `fill` constraint from its own `init()`. Drop a `Separator({ orientation: "vertical" })` into an `HFlow` and a default `Separator()` into a `VFlow` in the demo app, and confirm each renders as a visible hairline spanning its line. `Separator` needs no code change for that to work — it writes exactly the constraint H1 and V1 model.[^separator]

---

## Verification

From the repo root unless noted:

- `npm run typecheck` — clean.
- `npm run test` — full suite green (this also runs `typecheck:test`).
- `npm run lint` — no new findings.
- `npm run docs:api` — must finish with **zero** warnings; a `{@link}` from public JSDoc to the new `protected isCrossFilled` would be flagged here.
- `grep -rn "never resizes cells\|shrinks or stretches" packages/lib/src packages/lib/docs` — zero matches, proving step 7 caught the four blanket "a flow never resizes anything" claims.
- `grep -rn "isCrossFilled" packages/lib/src` — exactly three matches: the definition in `FlowLayout.ts`, one call in `HFlow.ts`, one in `VFlow.ts`.
- Manual smoke: `npm run dev` (app on `localhost:8015`), open the `HFlow` and `VFlow` demo panels ([`packages/lib/src/typescript/HFlowPanel.ts`](packages/lib/src/typescript/HFlowPanel.ts), [`packages/lib/src/typescript/VFlowPanel.ts`](packages/lib/src/typescript/VFlowPanel.ts)) and confirm the existing demos are pixel-unchanged — no demo child sets a `fill` constraint, so nothing there should move.

---

## Documentation Impact

- **No export-surface change.** `HFlow`, `VFlow` and `FlowLayout` are already exported from `@jimka/typescript-ui/layout`; `isCrossFilled` is `protected` and does not appear in the generated API docs.
- **Pages to update:** `packages/lib/docs/layouts/HFlow.md` and `packages/lib/docs/layouts/VFlow.md` gain a `## Per-child cross-axis alignment (align-self)` section — same heading text as [HBox.md:138](packages/lib/docs/layouts/HBox.md#L138), so the anchor `#per-child-cross-axis-alignment-align-self` matches the form `Constraints.md` already links to for the boxes. Both pages' `## Per-child constraints` `fill` bullet needs rewording, and `packages/lib/docs/layouts/Constraints.md` line 16 needs the flows added to the list of managers that read a cross-axis `fill`.
- **No catalog or sidebar entry.** No new page, so `packages/lib/docs/layouts/index.md` and `packages/docs/src/content/pages.ts` are untouched.
- **Changelog:** one bullet in `packages/lib/docs/reference/changelog/next.md` under `## Added` → `### Layouts`.
- **Follow-up outside this plan:** once **both** this change and the `separator-component` branch are on `master`, [`Separator`](plans/separator-component.md)'s own documentation understates where it works. Its class doc says the spanning behaviour is read by `HBox` and `VBox`, and `packages/lib/docs/components/Separator.md` scopes it the same way; both should then add `HFlow`/`VFlow`. That edit is deliberately not in this plan, because `Separator.ts` and `Separator.md` do not exist on `master` yet.[^separator-docs]

---

## Potential Challenges

- **A filled child alone on a wrapped line still collapses.** Its line's cross extent is the maximum over its own members, and it is the only member. Mitigation: pinned as behaviour H4 and stated in the new docs section from steps 8 and 9, so it reads as a documented limit rather than a half-working feature.
- **A main-axis `fill` still does nothing, and looks like the same bug.** A horizontal rule dropped into an `HFlow` (rather than a `VFlow`) sets `FillType.HORIZONTAL`, which is the flow's *main* axis, and renders zero-wide. Mitigation: the new docs section names the axis pairing explicitly — `VERTICAL` for `HFlow`, `HORIZONTAL` for `VFlow` — mirroring the pairing rule the boxes already document.[^main-axis]
- **Row metrics for `itemAlign: "baseline"` still include the filled child.** A filled child with a reported baseline participates in `computeRowMetrics` as before and can therefore raise the row it is then stretched to. Mitigation: this is the existing measurement path, unchanged; the divider case reports a `null` baseline and cannot trigger it.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/BoxLayout.ts`](packages/lib/src/typescript/lib/layout/BoxLayout.ts#L525) — `crossPlacement`, the precedent this plan mirrors: the axis test at line 530 and the filled-child return at line 535.
- [`packages/lib/src/typescript/lib/layout/HBox.ts`](packages/lib/src/typescript/lib/layout/HBox.ts#L357) — how a box composes `crossPlacement`'s result into a `resolveBounds` call (also line 536).
- [`packages/lib/src/typescript/lib/layout/FlowLayout.ts`](packages/lib/src/typescript/lib/layout/FlowLayout.ts) — `crossOffset` (line 480), `clampedPreferredSize` (line 406), `computeUniformExtents` (line 382), and the `FlowItemAlign` doc comment at line 37 that this change makes stale.
- [`packages/lib/src/typescript/lib/layout/HFlow.ts`](packages/lib/src/typescript/lib/layout/HFlow.ts#L376) — `resolveRows`, the edit site; `groupIntoRows` (line 327) and `rowExtent` (line 461) show where `row.rowHeight` comes from.
- [`packages/lib/src/typescript/lib/layout/VFlow.ts`](packages/lib/src/typescript/lib/layout/VFlow.ts#L362) — `resolveColumns`, the transposed edit site; `groupIntoColumns` (line 311) sets `column.columnWidth`.
- [`packages/lib/src/typescript/lib/layout/LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L383) — `resolveBounds`: the stored-`fill` merge at line 392, the filled-axis sizing at lines 398–431, and `commitBounds` at line 547.
- [`packages/lib/src/typescript/lib/layout/LayoutConstraints.ts`](packages/lib/src/typescript/lib/layout/LayoutConstraints.ts#L39) — the `fill` field and its documented align-self meaning, which the docs step extends to the flows.
- [`ARCHITECTURE.md`](ARCHITECTURE.md#L93) — "Size constraints: who is responsible for what", especially rules 5 and 6 at lines 107–108.
- [`packages/lib/tests/component/layout/HBox.test.ts`](packages/lib/tests/component/layout/HBox.test.ts#L301) — the constraint-building and assertion idiom the new tests copy.
- [`packages/lib/docs/layouts/HBox.md`](packages/lib/docs/layouts/HBox.md#L138) — the `## Per-child cross-axis alignment (align-self)` section the two flow pages mirror.

---

## Non-Goals

- **Cross-axis `anchor` as align-self in a flow.** The boxes read a cross `anchor` edge as "pin to the leading/trailing edge of the band"; the flows keep reading `anchor` only as position-within-the-cell, which is what makes it meaningful under `uniform`. Adding a second, line-relative meaning for `anchor` would make its behaviour depend on `uniform` and is not needed for stretching.
- **Main-axis fill.** The flow owns main-axis sizing and wrapping; a main-axis `fill` component stays inert.
- **Changes to `Separator.ts` or `packages/lib/docs/components/Separator.md`.** Neither file is on `master`; the follow-up is recorded in `## Documentation Impact`.
- **A new demo.** The existing `HFlowPanel` / `VFlowPanel` demos stay as they are; the manual smoke test only confirms they are unchanged.
- **Changes to `FlowLayout`'s size reporting.** Covered by its own decision above.

---

## Notes

[^precedent]: The search for precedent found exactly two places in the layout package that read `fill` off a child's stored constraints: `LayoutManager.resolveBounds` (generic, cell-relative) and `BoxLayout.crossPlacement` (band-relative align-self). `crossPlacement` is the closest sibling mechanic — same constraint, same "cross axis only" projection, same "an explicit per-child intent overrides the container-wide alignment" rule — so this plan copies its axis test and its precedence rather than inventing a `FlowLayoutOptions` field. A new option would also be the wrong shape: the requirement is per-child, and a manager-wide `stretchItems` flag could not express "this one child spans the row".

[^per-line]: Two candidate meanings exist for "fill the cross axis" in a wrapping layout: the child's own line, or the container's whole inner cross extent. The container reading is unusable — lines stack along the cross axis, so a child stretched to the container's cross extent would overlap every other line, and the flow's own scroll extent (`reserveContentFrame`, fed by the children's committed bounds) would then disagree with the measured wrapped extent. The per-line reading is also what CSS does: under `flex-wrap: wrap`, `align-self: stretch` grows an item to its own flex line's cross size, never to the container's. A single-line flow is the case where the two readings coincide, so nothing is lost.

[^line-extent]: The alternative — excluding filled children when folding the line's cross extent — was rejected because it can only shrink the line, never grow it. A filled child's own clamped preferred cross extent is a floor it legitimately deserves; including it is what makes a filled child with a real preferred size behave like any other child when it happens to be the tallest in its row. CSS agrees: a stretch item contributes its hypothetical cross size to the line's cross size before being stretched back up to it.

[^max-clamp]: `resolveBounds`' filled branch assigns `height = maxHeight` (line 431) without consulting the child's `maxSize`, unlike the unfilled branch below it. That asymmetry is pre-existing and shared with `HBox`/`VBox`, which pass `crossPlacement`'s full-band extent straight through. The clamp that keeps rule 5 honest lives one level down, in `Component.clampHeight` / `clampWidth`, which `commitBounds` reaches through `setHeight` / `setWidth`. Adding a second clamp inside `FlowLayout` would diverge from the box precedent for no behavioural gain, and would be wrong for a `Panel` child, whose layout-derived maximum deliberately does not bind.

[^size-reports]: The question is whether a filled child now contributes more than its bare preferred size to what the flow reports upward. It does not, on either axis. The main axis is untouched — the cell's main extent, the wrap threshold and the cursor advance are all unchanged. On the cross axis, the child is stretched to a line extent that is by construction the maximum over the line's cells, so it is never stretched past a value one of its siblings had already established; when it *is* the largest cell it simply keeps its own extent. `HFlow.getPreferredSize` (measured wrapped height), `HFlow.getMinSize` (`lineExtent` over the children's minimums) and `HFlow.getMaxSize` (largest child maximum, floored at the measurement) therefore all keep reporting the same numbers, and the aggregation contract in ARCHITECTURE.md — sum along main, max along cross — still describes them. Behaviour S1 pins this rather than leaving it as an argument.

[^helper-shape]: `BoxLayout.crossPlacement` returns `{ offset, extent } | null` because it serves two intents: a fill (offset = band lead) and an anchor edge (offset = lead or trail, extent = the child's natural cross extent). This plan implements only the fill intent, whose offset is always the line's leading cross edge, so returning a computed offset would be returning a constant. A boolean keeps both call sites to three readable lines and leaves the `{ offset, extent }` shape available if cross-axis `anchor` is ever added to the flows.

[^main-axis]: The flow does not mask the main-axis component of `fill` before calling `resolveBounds`, and does not need to: the cell's main extent it passes in is already the child's clamped preferred main extent, so `resolveBounds`' filled branch (`width = maxWidth`) and its unfilled branch (preferred, clamped to the same bounds) compute the same number. Masking would add code that changes nothing.

[^separator]: `Separator` sets, for a vertical rule, `preferredSize` and `minSize` of `1 × 0` and `maxSize` of `1 × UNBOUNDED`, then writes `fill: FillType.VERTICAL` onto the parent's layout manager from its `init()` — precisely the shape behaviour H1 models, with an unbounded maximum so the clamp in H3 never fires. In an `HFlow` the cross axis is vertical, so that constraint matches and the rule spans its row; in a `VFlow` a default (horizontal) `Separator` sets `FillType.HORIZONTAL`, the cross axis there, and spans its column. So `Separator` needs no code change to work in the flows — which is why this plan tests the geometry directly with a plain `Component` and does not depend on the `separator-component` branch landing first.

[^separator-docs]: `Separator`'s class doc currently reads "which `HBox` and `VBox` read as per-child align-self … Other layout managers that don't consult `fill` render the separator at its preferred size, zero along its own axis", and the `separator-component` plan's own "Potential Challenges" section listed managers that ignore `fill` (naming `Absolute`) as a known limitation. This change removes `HFlow`/`VFlow` from that set. Editing those files here is impossible — they live only on `feature/separator-component` — and forcing a `depends-on` would serialise two changes that share no code. Whichever branch merges second should carry the one-line docs correction.
