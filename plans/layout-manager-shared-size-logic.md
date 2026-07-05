# Layout Manager — Shared Size Logic Consolidation — Implementation Plan

## Overview

The layout managers under [`src/typescript/lib/layout/`](src/typescript/lib/layout/) have accreted six flavours of duplicated size logic. This plan consolidates them without changing any observable layout behaviour — it is a pure refactor plus two documentation/typo fixes.

The single highest-leverage change is the **overflow-inflation** block: the "grow the working size to the children's combined min on any host-overflowing axis" idiom is copy-pasted, near-byte-identical, into `Fit`, `Card`, `Grid`, `Border`, and `Split` — while the same logic already exists extracted as [`BoxLayout.inflateForOverflow`](src/typescript/lib/layout/BoxLayout.ts#L374) (used only by `HBox`/`VBox`). Meanwhile `computeTotalMinSize` is declared `abstract` on `BoxLayout` ([`BoxLayout.ts:287`](src/typescript/lib/layout/BoxLayout.ts#L287)) yet independently re-declared as a concrete method on managers that do **not** extend `BoxLayout` (`Fit`, `Card`, `Grid`, `Border`, `Split`, `Accordion`, `Tab`). Hoisting both onto `LayoutManager` collapses seven scattered idioms into one.

Two other duplications: `Fit` and `Card` each triplicate their `getPreferredSize`/`getMinSize`/`getMaxSize` bodies (byte-identical apart from the child accessor), which collapse to one accessor-parametrized helper the way `Split` already does with [`computeContentSize`](src/typescript/lib/layout/Split.ts#L550). And five managers still use `for (let idx in …)` (for-in over arrays), which the plan converts to `for-of`, aligning them with the newer flow/split style.

Finally two non-mechanical fixes: `Split` and `Accordion` omit `getMaxSize` (every other sizing manager overrides all three) — each gets a documented, deliberately-unbounded override; and a user-facing error typo ("more then one" → "more than one") in `Fit`.

---

## Architecture Decisions

### Hoist a concrete `computeTotalMinSize()` default and a concrete `inflateForOverflow()` onto `LayoutManager`

`LayoutManager` gains:

- `protected computeTotalMinSize(): Size` returning `{ width: 0, height: 0 }` — a **concrete default**, not abstract, so managers that never overflow-inflate (`Absolute`, the `FlowLayout` family, `Table`) inherit a harmless no-op and are not forced to implement anything.
- `protected inflateForOverflow(containerSize: Size): Size` — the exact current body of [`BoxLayout.inflateForOverflow`](src/typescript/lib/layout/BoxLayout.ts#L374), moved up verbatim. It early-returns `containerSize` unchanged when neither axis is host-overflowing, otherwise `Math.max`-inflates each host-overflowing axis to `computeTotalMinSize()`.

`BoxLayout` then **drops** both its `abstract computeTotalMinSize()` declaration ([`BoxLayout.ts:287`](src/typescript/lib/layout/BoxLayout.ts#L287)) and its `inflateForOverflow` method ([`BoxLayout.ts:374`](src/typescript/lib/layout/BoxLayout.ts#L374)); `HBox`/`VBox` keep their concrete `computeTotalMinSize` overrides and their existing `this.inflateForOverflow(innerSize)` call sites resolve to the hoisted method unchanged.

**Name kept as `inflateForOverflow`, not renamed to `applyOverflowInflation`.** The method is `protected` (not public API, so outside the `api-naming-harmonization` ownership boundary), and `inflateForOverflow` is the established name with two live callers and a full doc-comment. Renaming would churn `HBox`/`VBox` call sites for no behavioural or clarity gain. The audit's suggested `applyOverflowInflation` was considered and rejected on the surgical-change principle.

### `Fit`, `Card`, `Grid`, `Border`, `Split` call the hoisted `inflateForOverflow`; their inline blocks are deleted

Each of these five currently inlines:

```typescript
if (this.isOverflowingX() || this.isOverflowingY()) {
    const totalMin = this.computeTotalMinSize();
    const w = this.isOverflowingX() ? Math.max(containerSize.width,  totalMin.width)  : containerSize.width;
    const h = this.isOverflowingY() ? Math.max(containerSize.height, totalMin.height) : containerSize.height;
    containerSize = { width: w, height: h };
}
```

which is bit-for-bit what `inflateForOverflow` computes. Each keeps its own `computeTotalMinSize` override (the per-geometry min differs) and replaces the inline block:

- `Grid`/`Border`/`Split` have already proven `containerSize` non-null at that point → `containerSize = this.inflateForOverflow(containerSize);` (the helper's internal guard subsumes the `if`).
- `Fit`/`Card` reach the block with a possibly-null `containerSize` (their current block is guarded by `containerSize && …`) → `if (containerSize) { containerSize = this.inflateForOverflow(containerSize); }`, preserving the null-guard exactly.

### `Tab` participates by repurposing its dead `computeTotalMinSize` to the visible-child min

**Finding requiring care:** `Tab.computeTotalMinSize` ([`Tab.ts:1474`](src/typescript/lib/layout/Tab.ts#L1474)) is **dead code** — declared but never called (verified: the only occurrence of the symbol in `Tab.ts` is its declaration). Its overflow block ([`Tab.ts:1684`](src/typescript/lib/layout/Tab.ts#L1684)) inflates the **content area** (`contentW`/`contentH`, already net of the strip thickness), reading `component.getMinSize()` **directly** — it does *not* call `computeTotalMinSize`, and the dead method's strip-inclusive result would be *wrong* for the content area (it double-counts the strip).

Rather than leave a divergent inline block plus a dead method, repurpose the method to what the content-area inflation actually needs:

```typescript
protected computeTotalMinSize(): Size {
    const container = this.getContainer();
    if (!container) {
        return { width: 0, height: 0 };
    }

    const visible = this.getVisibleComponent() ?? container.getComponents()[0];
    const min = visible?.getMinSize();

    return min ?? { width: 0, height: 0 };
}
```

The block then becomes `const inflated = this.inflateForOverflow({ width: contentW, height: contentH }); … contentWidth = inflated.width; contentHeight = inflated.height;`. This is behaviour-preserving: the current block already resolves the same component (`getVisibleComponent() ?? components[0]`), only inflates the axis the host marked, and treats a null child-min as no inflation — all three properties are exactly what `inflateForOverflow` + the new `computeTotalMinSize` reproduce (see `## Expected Behaviour`). The strip thickness the dead method added is *dropped*, which is correct because it was never reflected in any live computation.

Rejected alternative: delete the dead `computeTotalMinSize` and keep the inline `component.getMinSize()` block. This removes dead code but leaves `Tab` as the one manager still hand-rolling the inflation. Full participation deletes both the dead method's wrong logic and the inline copy, at the cost of the equivalence argument below — an acceptable trade given the offline tests cover it.

### `Accordion` stays a single-axis (X-only) inline block — deliberately excluded from the shared helper

`Accordion` ([`Accordion.ts:1188`](src/typescript/lib/layout/Accordion.ts#L1188)) inflates **width only**, honouring `isOverflowingX()` and deliberately **ignoring** the Y flag because its section-height animation conflicts with vertical overflow (documented at the call site and on its `computeTotalMinSize`). The shared `inflateForOverflow` inflates *both* host-overflowing axes, so routing `Accordion` through it would (incorrectly) inflate height whenever a host enabled Y-scroll. `Accordion` therefore keeps its two-line X-only block and its `computeTotalMinSize` override. This is flagged as an intentional non-consolidation, not an oversight.

### `Fit` and `Card` collapse their three size queries to one accessor-parametrized helper

Mirror `Split.computeContentSize`: a private `computeSize(sizeOf: (component: Component) => Size | null): Size | null` holding the shared perimeter + child-resolution + `null`-propagation, with the three public methods delegating (`getPreferredSize` → `c.getPreferredSize()`, etc.). `Fit` resolves the child via `container.getLaidOutComponents()[0] ?? null`; `Card` via `this.getVisibleComponent()` (keeping its extra `if (!perimiterSize) return null` guard). Both keep the `size.width + outer{Width,Height}` return shape verbatim.

### `Split` and `Accordion` get documented, deliberately-unbounded `getMaxSize`

Both currently inherit `LayoutManager.getMaxSize` (returns `{ UNBOUNDED, UNBOUNDED }`), which satisfies the `min ≤ preferred ≤ max` invariant but leaves the "override all three" contract visibly incomplete. Rather than *derive* a real max, both get an explicit override that returns the unbounded default with a JSDoc stating *why* — because unbounded genuinely is accurate here:

- **`Split`** — a user-resizable split absorbs arbitrary slack; its panes are dragged, so there is no meaningful ceiling. Deriving `computeContentSize(c => c.getMaxSize())` was rejected: `computeContentSize` sums extents without the `isUnbounded` saturation that [`BoxLayout.aggregateMaxSize`](src/typescript/lib/layout/BoxLayout.ts#L301) performs, so a pane reporting an `UNBOUNDED` max would sum to a huge *finite* number instead of saturating — a subtly wrong report, and replicating the saturation is scope creep for a container whose purpose is to absorb space.
- **`Accordion`** — a height-animated vertical stack whose open/closed section state and in-flight animation make any static height ceiling meaningless.

The explicit override gives the rationale a greppable home next to `getMinSize` and makes the deliberate choice auditable. Deciding *per manager* per the audit: both land on the documented-unbounded option for the reasons above.

### Style alignment is confined to lines already being rewritten

Per surgical-change rules, `let`→`const` and for-in→for-of conversions happen **only** in method bodies this plan already touches (the collapsed `Fit`/`Card` queries and the enumerated for-in loops). No drive-by reformatting of untouched code.

---

## Public API

None. Every changed symbol is `protected` or `private`. No exported signature, option field, or callable surface changes. `## Documentation Impact` is therefore empty (internal refactor).

---

## Internal Structure

### `LayoutManager` additions

```typescript
/**
 * Computes the children's combined minSize along this manager's geometry.
 * The default is a no-op ({0,0}); managers that support host-driven overflow
 * scrolling override it to report the min the working size must inflate to.
 */
protected computeTotalMinSize(): Size {
    return { width: 0, height: 0 };
}

/**
 * Inflates a working container size to computeTotalMinSize on whichever axes
 * the host marked overflowing (Panel.setAutoScroll). [moved verbatim from BoxLayout]
 */
protected inflateForOverflow(containerSize: Size): Size {
    if (!this.isOverflowingX() && !this.isOverflowingY()) {
        return containerSize;
    }

    const totalMin = this.computeTotalMinSize();

    return {
        width:  this.isOverflowingX() ? Math.max(containerSize.width,  totalMin.width)  : containerSize.width,
        height: this.isOverflowingY() ? Math.max(containerSize.height, totalMin.height) : containerSize.height,
    };
}
```

### `Fit.computeSize` / `Card.computeSize` shape

```typescript
private computeSize(sizeOf: (component: Component) => Size | null): Size | null {
    const container = this.getContainer();
    if (!container) {
        return null;
    }

    const perimiterSize = container.getPerimiterSize();
    // Card only: if (!perimiterSize) return null;

    const outerWidth  = perimiterSize.left + perimiterSize.right;
    const outerHeight = perimiterSize.top  + perimiterSize.bottom;

    const component = /* Fit: */ container.getLaidOutComponents()[0] ?? null
                      /* Card: */ this.getVisibleComponent();
    if (!component) {
        return null;
    }

    const size = sizeOf(component);
    if (!size) {
        return null;
    }

    return { width: size.width + outerWidth, height: size.height + outerHeight };
}
```

---

## Ordered Implementation Steps

1. **`LayoutManager.ts`** — add the concrete `computeTotalMinSize()` (default `{0,0}`) and move `inflateForOverflow` here verbatim from `BoxLayout` (both `protected`). `Size` is already imported.
2. **`BoxLayout.ts`** — delete the `abstract computeTotalMinSize()` declaration (line ~287) and the `inflateForOverflow` method (lines ~374-385). Verify `HBox`/`VBox` still compile (they override `computeTotalMinSize` and call `inflateForOverflow`, both now inherited). Update the class-doc bullet that lists `inflateForOverflow` as owned here if it names it.
3. **`Fit.ts`** — (a) collapse the three size queries into `computeSize`; (b) replace the overflow block in `doLayout` with `if (containerSize) { containerSize = this.inflateForOverflow(containerSize); }`; (c) fix the error typo at both throw sites; (d) `let`→`const` only within the rewritten `computeSize`.
4. **`Card.ts`** — (a) collapse the three size queries into `computeSize` (keep the `if (!perimiterSize) return null` guard); (b) replace the overflow block with `if (containerSize) { containerSize = this.inflateForOverflow(containerSize); }`.
5. **`Grid.ts`** — (a) replace the overflow block in `doLayout` with `containerSize = this.inflateForOverflow(containerSize);`; (b) convert the two `for (let idx in components)` loops (getPreferredSize ~350, getMinSize ~410) to `for (const component of components)`.
6. **`Border.ts`** — replace the overflow block in `doLayout` with `containerSize = this.inflateForOverflow(containerSize);`.
7. **`Split.ts`** — (a) replace the overflow block in `doLayout` with `containerSize = this.inflateForOverflow(containerSize);`; (b) convert `for (let idx in this._gutters)` in `detach` (~776) to `for (const gutter of this._gutters)`; (c) add a documented, deliberately-unbounded `getMaxSize()` override.
8. **`Tab.ts`** — (a) repurpose `computeTotalMinSize` to the visible-child min (drop strip thickness); (b) replace the content-area overflow block (~1684-1696) with `inflateForOverflow({ width: contentW, height: contentH })`, assigning `contentWidth`/`contentHeight` from the result; (c) convert `for (let idx in components)` (~1555) to `for (const component of components)`.
9. **`Accordion.ts`** — add a documented, deliberately-unbounded `getMaxSize()` override. Leave the X-only overflow block and `computeTotalMinSize` untouched.
10. **Regression sweep:** `grep -rn 'for (let idx in' src/typescript/lib/layout/` — expect zero matches (item #3 fully done). `grep -rn 'more then one' src/typescript/lib/layout/` — expect zero. `grep -rn 'inflateForOverflow' src/typescript/lib/layout/BoxLayout.ts` — expect zero (moved out).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/layout/LayoutManager.ts` (add `computeTotalMinSize` default + `inflateForOverflow`) |
| Modify | `src/typescript/lib/layout/BoxLayout.ts` (remove abstract `computeTotalMinSize` + `inflateForOverflow`) |
| Modify | `src/typescript/lib/layout/Fit.ts` (collapse queries, use helper, typo, for `computeSize`) |
| Modify | `src/typescript/lib/layout/Card.ts` (collapse queries, use helper) |
| Modify | `src/typescript/lib/layout/Grid.ts` (use helper, for-in→for-of ×2) |
| Modify | `src/typescript/lib/layout/Border.ts` (use helper) |
| Modify | `src/typescript/lib/layout/Split.ts` (use helper, for-in→for-of, add `getMaxSize`) |
| Modify | `src/typescript/lib/layout/Tab.ts` (repurpose `computeTotalMinSize`, use helper, for-in→for-of) |
| Modify | `src/typescript/lib/layout/Accordion.ts` (add documented `getMaxSize`) |

---

## Expected Behaviour

This is a refactor: for every case below the post-change output must be **identical** to today's, except the two newly-added `getMaxSize` overrides (which return what the base already returned, now documented) and the two `getMaxSize` reports that were already unbounded.

### Overflow-inflation equivalence (unit-testable)

For `Fit`, `Card`, `Grid`, `Border`, `Split`, with a host whose `setOverflowing(x, y)` is toggled through all four combinations and children whose combined min is (a) smaller, (b) larger than the host inner rect on each axis:

- **Neither axis overflowing** → working size equals the host inner rect unchanged (helper early-returns).
- **X only** → width = `max(inner.width, computeTotalMinSize().width)`, height unchanged. Symmetric for **Y only**.
- **Both** → both axes inflated to their respective `computeTotalMinSize` component.
- **Children fit** (`totalMin ≤ inner` on the active axis) → that axis unchanged (the `Math.max` is a no-op).
- **`Fit`/`Card` with `getInnerSize()` null** → no inflation, no throw (the `if (containerSize)` guard holds); layout proceeds with the null-fallback zero sizes exactly as before.

Pin these against the pre-change output captured from the same manager+child fixtures (the existing `Fit.test.ts`, `Card.test.ts`, `Split.test.ts` already host scroll/overflow scenarios; extend Grid/Border coverage if absent).

### `Tab` content-area inflation equivalence (unit-testable)

For a `Tab` whose visible child has a known min, with the host overflowing on each axis combination:

- `contentWidth` = `isOverflowingX ? max(contentW, childMin.width) : contentW`; `contentHeight` symmetric — identical to the pre-change inline block.
- **Visible child min is null** → no inflation (helper sees `computeTotalMinSize` = `{0,0}`, `max(contentW, 0) = contentW`).
- **`getVisibleComponent()` null but children present** → resolves to `components[0]`, same as the old inline `component` fallback.
- The **strip thickness is not added** to the content-area inflation (it never was in the live block); the tab strip still reserves its own thickness upstream, unchanged.

### `Fit`/`Card` collapsed size queries (unit-testable)

`getPreferredSize`/`getMinSize`/`getMaxSize` each return `{ childSize + perimeter }` for the resolved (displayed/visible) child, `null` when there is no container, no resolved child, or the child reports `null` for that accessor — byte-identical to the three pre-collapse methods across: no container; empty container; single displayed child; `Fit` with a hidden sole child (`getLaidOutComponents` empty → `null`); `Card` with `visibleComponentId` set vs. defaulted to first child.

### `Split`/`Accordion` `getMaxSize` (unit-testable)

Returns `{ UNBOUNDED, UNBOUNDED }` (i.e. `Size.UNBOUNDED` on both axes) — the value each already reported via the inherited base method — for any child configuration. The invariant `min ≤ preferred ≤ max` holds because the reported min and preferred are finite. No consumer-visible layout change; this only makes the report explicit and documented.

### for-in→for-of conversions (unit-testable via existing suites)

`Grid.getPreferredSize`/`getMinSize`, `Split.detach`, and `Tab.doLayout` produce identical results/side-effects after conversion. In particular `Split.detach` still removes every gutter element and destroys every gutter (order preserved), and `Tab.doLayout` still hides every child before revealing the visible one.

---

## Verification

- `npx tsc --noEmit` (or the project's typecheck script) — clean; confirms `HBox`/`VBox` still satisfy the (now-inherited) `computeTotalMinSize` and `inflateForOverflow`, and no manager lost a needed override.
- `npm test -- tests/component/layout/` — the full layout suite green before and after (`Fit`, `Card`, `Grid`, `Border`, `Split`, `HBox`, `VBox`, `Tab.*`, `Accordion` if present). Add red-green cases for any `## Expected Behaviour` bullet the existing suite doesn't already cover (Grid/Border overflow, `Split`/`Accordion` `getMaxSize`, `Tab` content-area inflation with null child-min).
- `grep -rn 'for (let idx in' src/typescript/lib/layout/` → zero.
- `grep -rn 'more then one' src/typescript/lib/layout/` → zero.
- `grep -rn 'inflateForOverflow\|computeTotalMinSize' src/typescript/lib/layout/BoxLayout.ts` → zero (both moved to `LayoutManager`).
- Manual smoke (offline-untestable scroll geometry is exercised by the suite's `TestDOM`, so no live pass is strictly required, but if driving the app: scroll an auto-scroll `Panel` hosting each of `Fit`/`Card`/`Grid`/`Border`/`Split`/`Tab` and confirm the scrollbar still appears exactly when children overflow).

---

## Potential Challenges

- **`Tab` equivalence hinges on same-component resolution.** `computeTotalMinSize` re-calls `getVisibleComponent()`; if a future change made resolution non-deterministic within a `doLayout` pass this would drift. Mitigation: the equivalence is pinned by a unit test, and both paths share the identical `getVisibleComponent() ?? components[0]` expression.
- **Dropping `BoxLayout`'s `abstract computeTotalMinSize` could silently un-force an override.** Mitigation: `HBox`/`VBox` still override concretely; the typecheck plus existing box tests catch any regression. The base default `{0,0}` is only ever the fallback for managers that don't overflow-inflate.
- **`Fit`/`Card` null-guard placement.** The helper takes a non-null `Size`; forgetting the `if (containerSize)` wrapper would pass `null` and throw. Mitigation: explicit in step 3b/4b and pinned by the "`getInnerSize()` null" expected-behaviour case.

---

## Critical Files

- [`src/typescript/lib/layout/LayoutManager.ts`](src/typescript/lib/layout/LayoutManager.ts) — the hoist target; read `getMaxSize`/`_defaultMaxSize` (the unbounded default `Split`/`Accordion` inherit) and the `isOverflowingX/Y` getters.
- [`src/typescript/lib/layout/BoxLayout.ts`](src/typescript/lib/layout/BoxLayout.ts) — source of the moved methods; `aggregateMaxSize` (L301) shows the `isUnbounded` saturation a naive `Split.getMaxSize` would miss.
- [`src/typescript/lib/layout/Split.ts`](src/typescript/lib/layout/Split.ts) — `computeContentSize` (L550) is the accessor-parametrized pattern `Fit`/`Card` mirror.
- [`src/typescript/lib/layout/Tab.ts`](src/typescript/lib/layout/Tab.ts) — the divergent content-area block (~L1684) and the dead `computeTotalMinSize` (L1474).
- [`ARCHITECTURE.md`](ARCHITECTURE.md) *"Size constraints: who is responsible for what"* — rules 2/3 (accurate manager reports) and the aggregation contract (sum main / max cross / saturate unbounded).
- [`tests/component/layout/Fit.test.ts`](tests/component/layout/Fit.test.ts) — the `installTestDOM` + `hostFit` harness pattern every new test reuses.

---

## Non-Goals

- **No `Util.clamp` / sentinel-constant migration** — owned by `shared-clamp-timer-size-sentinel-utils`. This plan uses the existing `UNBOUNDED`/`Math.max` idioms verbatim.
- **No public renames** — owned by `api-naming-harmonization`. The `protected inflateForOverflow` name is kept as-is.
- **No `Table` changes** — `Table` intentionally opts out of size negotiation (heuristic/force-assigned widths); its redesign is deferred and owned elsewhere.
- **No merging of the deliberate `HBox`/`VBox`/`FlowLayout` per-axis mirroring** — documented as intentional at [`BoxLayout.ts:98-104`](src/typescript/lib/layout/BoxLayout.ts#L98) and [`FlowLayout.ts:66-71`](src/typescript/lib/layout/FlowLayout.ts#L66); the mirror-image geometric methods stay concrete per subclass.
- **No relocation of `DockRegion.ts`** out of `layout/` — its placement is a judgement call left untouched.
- **`Accordion` is not routed through the shared two-axis `inflateForOverflow`** — its X-only inflation is a deliberate consequence of the height-animation constraint, not duplication to be removed.
