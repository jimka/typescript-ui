# VBox First-Child Baseline Forwarding — Implementation Plan

## Overview

`VBox` currently exposes no baseline. A plain `Component` laid out by `VBox` reports `getBaseline() === null`, because `VBox` does not override `LayoutManager.getContentBaseline()` — the base returns `null` at [src/typescript/lib/layout/LayoutManager.ts:614](src/typescript/lib/layout/LayoutManager.ts#L614). `Component.getBaseline` at [src/typescript/lib/core/Component.ts:2675](src/typescript/lib/core/Component.ts#L2675) delegates to `this.getLayoutManager().getContentBaseline()` and, when non-null, wraps it with `wrapInnerBaseline` (adds `insets.top + border.top + padding.top`, [Component.ts:2696](src/typescript/lib/core/Component.ts#L2696)). So a VBox-managed container has no baseline, and a baseline-aware parent — a non-stretching `HBox` — places it via `nullChildY` ([LayoutManager.ts:522](src/typescript/lib/layout/LayoutManager.ts#L522)), vertically centring it in the row's text-line height instead of aligning its first row of text.

This plan adds `VBox.getContentBaseline(): number | null` that forwards the **first laid-out child's** baseline verbatim, mirroring the existing `HBox.getContentBaseline` override at [src/typescript/lib/layout/HBox.ts:45](src/typescript/lib/layout/HBox.ts#L45). The change is confined to `VBox.ts` (one new method + its JSDoc) plus tests and a changelog note. No sizing methods, no `HBox`, no `LayoutManager` base, no `Component.getBaseline` change.

The first laid-out child is placed at `y = insets.getTop() + lead` in `layoutPreferredMode` ([VBox.ts:419-420](src/typescript/lib/layout/VBox.ts#L419)); `lead` is `0` for the default `"start"` justify. In `layoutEqualMode` the first child is placed at `y = insets.getTop()` ([VBox.ts:279](src/typescript/lib/layout/VBox.ts#L279)). In both modes the first child's top coincides with the container's content-top, so the container's content-baseline (measured from content-top, before `wrapInnerBaseline` adds chrome) equals the first child's own `getBaseline()` with **no extra offset** — symmetric with `HBox.getContentBaseline` returning `rowAscent` computed purely from child baselines and ignoring justify/layout offsets.

---

## Architecture Decisions

### Forward the literal first child's baseline, not the first baseline-bearing child

`getContentBaseline` returns `container.getLaidOutComponents()[0].getBaseline()` **verbatim** — including `null` when that first child has no baseline. It does NOT scan for a later child that happens to expose a baseline.

Considered alternative: mirror `HBox.getContentBaseline`/`computeRowMetrics`, which skips null-baseline children and takes the max baseline among those that have one ([HBox.ts:58-64](src/typescript/lib/layout/HBox.ts#L58), [LayoutManager.ts:538](src/typescript/lib/layout/LayoutManager.ts#L538)). Rejected because (a) the feature request is explicitly "first child's baseline," and (b) a column has a single well-defined first row, so forwarding it verbatim is the most predictable contract — a consumer reading "VBox aligns by its first row" gets exactly that, with no surprise when the first row is graphical. This is a deliberate divergence from HBox's multi-child max-baseline semantics and must be stated in the JSDoc.

### Assume natural `"start"` placement; ignore the layout-time justify `lead`

`getContentBaseline` is a pure query, independent of the container's allocated size and of `justify`. It must NOT add the `lead` computed by `justifyOffsets` ([VBox.ts:401-411](src/typescript/lib/layout/VBox.ts#L401)) for `"center"`/`"end"` justify. The baseline reflects the first child's intrinsic baseline at its natural top-of-content position (offset 0), consistent with `HBox.getContentBaseline` which derives `rowAscent` from baselines alone and ignores its own `lead`/`gap` ([HBox.ts:483-495](src/typescript/lib/layout/HBox.ts#L483)). The implementation achieves this simply by never consulting `lead` — it just reads the child's `getBaseline()`.

### `stretching` and `equal` mode do NOT disable baseline forwarding — do NOT copy HBox's stretching guard

`HBox.getContentBaseline` returns `null` when `isStretching()` ([HBox.ts:46-48](src/typescript/lib/layout/HBox.ts#L46)) because HBox's `stretching` fills the **cross axis (height)**, forcing every child to the row height and destroying any shared baseline. In `VBox`, `stretching` fills the **cross axis (width)** — it leaves each child's height and intrinsic baseline untouched. The first child still stacks at content-top in both the stretch branch ([VBox.ts:280-290](src/typescript/lib/layout/VBox.ts#L280)) and the non-stretch branch of `layoutEqualMode`, and in `layoutPreferredMode`. A text child's `getBaseline()` is measured from its own top and is independent of the width (or the `equal`-mode `cellHeight`) VBox assigns it. Therefore `VBox.getContentBaseline` must **omit** the `isStretching()` guard entirely and be mode-agnostic. This is the single most important divergence from the HBox template; getting it wrong (copying the guard) would silently no-op the feature for the many `new VBox({ stretching: true })` call sites.

---

## Public API

No new exported symbol, option, or setter. One new public method on the `VBox` class (already exported), overriding the base `LayoutManager.getContentBaseline`:

```ts
getContentBaseline(): number | null
```

Returns the first laid-out child's baseline, measured from the container's content-top; `null` when there is no container, no laid-out children, or the first child's own baseline is `null`.

---

## Internal Structure

Full method body (place it in `VBox` near the top, adjacent to `getPreferredSize`, matching HBox's placement of `getContentBaseline` before `getPreferredSize`):

```ts
getContentBaseline(): number | null {
    const container = this.getContainer();
    if (!container) {
        return null;
    }

    const components = container.getLaidOutComponents();
    if (components.length === 0) {
        return null;
    }

    return components[0].getBaseline();
}
```

Notes for the implementer:
- `getContainer()` and `getLaidOutComponents()` are the same accessors `getPreferredSize` uses ([VBox.ts:44-50](src/typescript/lib/layout/VBox.ts#L44)); no new imports.
- The `if (!container) return null` guard mirrors `getPreferredSize` ([VBox.ts:45-47](src/typescript/lib/layout/VBox.ts#L45)).
- `components[0].getBaseline()` already returns the child's outer baseline (from the child's own top). Since the child's top equals the container content-top, this is exactly the container's content-baseline — no arithmetic. `Component.getBaseline` on the VBox container then wraps this via `wrapInnerBaseline`, adding the container's own `insets.top + border.top + padding.top` exactly once.

---

## Ordered Implementation Steps

1. **Add the override** in [src/typescript/lib/layout/VBox.ts](src/typescript/lib/layout/VBox.ts), immediately before `getPreferredSize` (after the `_defaultComponentHeight` field at line 34). Use the body from _Internal Structure_.

2. **Write the JSDoc** on the new method, mirroring `HBox.getContentBaseline`'s doc ([HBox.ts:36-44](src/typescript/lib/layout/HBox.ts#L36)) but stating the VBox-specific contract: it forwards the **first** laid-out child's baseline (not a max over children) so a VBox container aligns by its first row rather than auto-centring in a baseline-aware parent; returns `null` when there is no container, no children, or the first child reports no baseline; and — unlike HBox — it is NOT disabled while stretching, because VBox `stretching` is the cross (width) axis and leaves child baselines intact. Follow the project's documentation comment conventions in [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md).

3. **Typecheck**: `npm run typecheck` (or the project's tsc script) — expect clean.

4. **Add tests** to [tests/component/layout/VBox.test.ts](tests/component/layout/VBox.test.ts) covering the cases in _Expected Behaviour_. Reuse the file's existing `hostVBox(width, height, vbox)` helper and `CONFIG`/`fontMetrics` imports for the container-under-test; add a local `hostHBox` helper (Container with `new HBox()`, `getElement(true)`, `setWidth/Height`, `clearInsets`) for the placement case, mirroring `Anchor.test.ts`'s host pattern.

5. **Run the suite**: `npx vitest run tests/component/layout/VBox.test.ts` — expect green.

6. **Changelog note**: add a bullet under `## Unreleased (pre-1.0)` in [docs/reference/changelog.md](docs/reference/changelog.md) (see _Documentation Impact_).

7. **Full test run**: `npx vitest run` — confirm no other layout/baseline test regressed (esp. `tests/component/layout/Grid.test.ts`, `Split.test.ts`, and any HBox/HFlow test), since VBox containers embedded in those layouts now report a baseline.

---

## Files to Create / Modify / Delete

| Action | File |
| --- | --- |
| Modify | `src/typescript/lib/layout/VBox.ts` — add `getContentBaseline` override + JSDoc |
| Modify | `tests/component/layout/VBox.test.ts` — add baseline test cases |
| Modify | `docs/reference/changelog.md` — Unreleased behaviour-change bullet |

---

## Expected Behaviour

All cases are offline-testable with the TestDOM geometry harness (`installTestDOM(CONFIG)` + `font-metrics.test-font.json`), which is proven for placement/baseline geometry. Build the tall baseline-bearing sibling as a `Text` with an explicit `preferredSize` override — `getPreferredSizeConstraint` wins over the measured size ([Component.ts:2280-2282](src/typescript/lib/core/Component.ts#L2280)), so the box is tall while `Text.getBaseline` stays the intrinsic first-line ascent ([Text.ts:441-447](src/typescript/lib/component/input/Text.ts#L441)). Derive expected numbers from the components' **measured** baselines/heights at runtime (read `getBaseline()`/`getHeight()`), not from hardcoded font constants, so the assertions survive font-metric changes.

1. **First child is a text control → container reports that child's baseline (+ own chrome).**
   VBox container (zero insets/border/padding via `clearInsets`) whose first child is a `Text`. Assert `container.getBaseline() === firstChild.getBaseline()` (chrome adds 0 here). — unit-testable.

2. **Placed in a non-stretching HBox alongside a tall baseline-bearing sibling → baseline-aligned, not centred.**
   Host = `Container({ layoutManager: new HBox() })`, `getElement(true)`, sized wide/tall, `clearInsets()`. Child A = the VBox container from case 1 (short, e.g. height ~20, baseline `bC`). Child B = `Text({ preferredSize: { width: 40, height: 200 } })` (tall box, small baseline `bB`). `addComponent(A)`, `addComponent(B)`, `host.doLayout()`. With `rowAscent = max(bC, bB)` and both text baselines near the font ascent, assert `A.getY() === rowAscent - bC` (≈ 0, i.e. A sits at the row top). Contrast with the pre-change centred position `nullChildY = (rowAscent + rowDescent − A.height)/2` where `rowDescent = B.height − bB ≈ 184`, which lands A near the middle (~y 90). Assert `A.getY()` is the baseline value, NOT the centred value. — unit-testable.

3. **Empty VBox container (no children) → `getBaseline()` null.**
   VBox container with no `addComponent`. Assert `container.getBaseline() === null`. — unit-testable.

4. **First child has a null baseline → `getBaseline()` null.**
   VBox container whose first (and only) child is a plain `Component` with a `preferredSize` but no baseline (its `getBaseline()` is `null`). Assert `container.getBaseline() === null`. Forwarding is verbatim — do NOT look past the first child even if a later child has a baseline (optionally assert this by adding a `Text` second child and still expecting `null`). — unit-testable.

5. **Container chrome added exactly once via `wrapInnerBaseline`.**
   Same as case 1 but give the container non-zero top chrome (e.g. `setInsets`/`setPadding` adding `T` px on top). Assert `container.getBaseline() === firstChild.getBaseline() + T`, confirming the chrome is added once by `Component.getBaseline`→`wrapInnerBaseline` and NOT double-counted inside `getContentBaseline`. — unit-testable.

6. **`stretching: true` VBox still forwards the baseline (regression guard for the omitted stretching guard).**
   VBox container built with `new VBox({ stretching: true })`, first child a `Text`. Assert `container.getBaseline() === firstChild.getBaseline()` (non-null), proving the feature is NOT disabled while stretching. — unit-testable.

---

## Verification

- `npm run typecheck` — clean.
- `npx vitest run tests/component/layout/VBox.test.ts` — the six cases above pass.
- `npx vitest run` — full suite green; specifically confirm `tests/component/layout/Grid.test.ts` and `tests/component/layout/Split.test.ts` (both reference baselines) and any HBox/HFlow tests are unaffected.
- Manual smoke (dev server `npm run dev`, http://localhost:8015): inspect demo panels that place a VBox-managed container inside a non-stretching baseline-aware parent (see _Potential Challenges_ / blast radius). Confirm the first row of a column now sits on the surrounding text baseline rather than floating to the row's vertical centre, and that no previously-correct layout regressed. The Baseline demo panel ([src/typescript/BaselinePanel.ts](src/typescript/BaselinePanel.ts)) is the natural place to eyeball baseline behaviour.

---

## Documentation Impact

- **JSDoc → TypeDoc**: the new method's doc comment flows automatically to the generated `VBox` API page; no manual API-page edit needed.
- **Changelog**: add a bullet under `## Unreleased (pre-1.0)` in [docs/reference/changelog.md](docs/reference/changelog.md), grouped with the existing baseline work ("Graphical controls participate in baseline alignment" / "Exact text metrics and a self-determined baseline"). Note it as a behaviour change: *`VBox` now reports its first laid-out child's baseline via `getContentBaseline`, so a VBox-managed container placed in a baseline-aware row (a non-stretching `HBox`, `HFlow`, or `Grid`) aligns by its first row's text baseline instead of being auto-centred as a null-baseline child. Unlike `HBox`, this is not disabled while `stretching`, since VBox stretching is the cross (width) axis.*
- **Prose docs (optional but recommended)**: [docs/layouts/VBox.md](docs/layouts/VBox.md) has no baseline section; [docs/layouts/HBox.md](docs/layouts/HBox.md#L144) has a "## Baseline alignment" section. Consider adding a short note to `VBox.md` that a VBox container forwards its first child's baseline (mirroring, in one paragraph, HBox.md's baseline section) so `docs/layouts/VBox.md` documents the new participation. Follow the document skill / docs conventions. This is a doc enhancement, not required for the code to function.

---

## Potential Challenges — Blast Radius

Only three layouts consume a child's `getBaseline()`: `HBox` (`computeRowMetrics`/`rowChildY`, [HBox.ts:335,353,524](src/typescript/lib/layout/HBox.ts#L335)), `HFlow` ([HFlow.ts:96,142,305](src/typescript/lib/layout/HFlow.ts#L96)), and `Grid` ([Grid.ts:726](src/typescript/lib/layout/Grid.ts#L726)). So the visible blast radius is exactly: **a VBox-managed container placed as a child of a non-stretching HBox, an HFlow, or a Grid.** Such a container previously reported `null` (auto-centred / bottom-edge treated as baseline) and now reports its first child's baseline, changing both its own placement and, via `computeRowMetrics`, the row's ascent/descent and preferred height.

- **Most demo VBox call sites are top-level tab panels** (placed by the tab layout manager, which is not baseline-aware) or are the *host* HBox row rather than a VBox child — e.g. `new VBox` at [MiscPanel.ts:207-208](src/typescript/MiscPanel.ts#L207), the panels in [ComplexUIPanel.ts:40-57](src/typescript/ComplexUIPanel.ts#L40), [VBoxPanel.ts:11](src/typescript/VBoxPanel.ts#L11), [BoxJustifyPanel.ts:19](src/typescript/BoxJustifyPanel.ts#L19), [AlignSelfPanel.ts:21](src/typescript/AlignSelfPanel.ts#L21), [AccordionDemoPanel.ts](src/typescript/AccordionDemoPanel.ts). These do not shift as *children* unless they are themselves added to a non-stretching HBox/HFlow/Grid. — mitigation: during the manual smoke, open these panels and confirm no column's first row jumps; the change is only visible where a VBox column shares a non-stretching HBox row with a taller sibling. Log/inspect rather than assume.
- **Internal library composites that put a VBox inside a row** are the higher-risk sites — check `Button` (title column VBox at [Button.ts:463](src/typescript/lib/component/button/Button.ts#L463) and [Button.ts:1099](src/typescript/lib/component/button/Button.ts#L1099)) and `NumberSpinner` ([NumberSpinner.ts:112](src/typescript/lib/component/input/NumberSpinner.ts#L112)), which have their own `getBaseline` overrides that delegate to an inner control ([Button.ts:1443](src/typescript/lib/component/button/Button.ts#L1443), [NumberSpinner.ts:178](src/typescript/lib/component/input/NumberSpinner.ts#L178)) and therefore do NOT go through `VBox.getContentBaseline`. — mitigation: because these override `getBaseline` directly, they are insulated; confirm with the full test run and a Button/NumberSpinner smoke that their baselines are unchanged.
- **No existing test asserts a VBox container's baseline or its placement inside an HBox** (`tests/component/layout/VBox.test.ts` has no baseline case; the grep for `getContentBaseline` in `tests/` finds none). So no test needs updating for the new value — only new tests are added. Still run the full suite to catch any indirect row-height assertion.

---

## Critical Files

- [src/typescript/lib/layout/HBox.ts:45-65](src/typescript/lib/layout/HBox.ts#L45) — the `getContentBaseline` template to mirror (and diverge from re: the stretching guard and the max-vs-first semantics).
- [src/typescript/lib/layout/LayoutManager.ts:602-616](src/typescript/lib/layout/LayoutManager.ts#L602) — the base `getContentBaseline` (returns `null`) being overridden; [LayoutManager.ts:522](src/typescript/lib/layout/LayoutManager.ts#L522) `nullChildY` (the centring being avoided).
- [src/typescript/lib/core/Component.ts:2675-2708](src/typescript/lib/core/Component.ts#L2675) — `getBaseline` delegation and `wrapInnerBaseline` chrome arithmetic.
- [src/typescript/lib/layout/VBox.ts:372-473](src/typescript/lib/layout/VBox.ts#L372) (`layoutPreferredMode`, first child at `insets.getTop() + lead`) and [VBox.ts:274-312](src/typescript/lib/layout/VBox.ts#L274) (`layoutEqualMode`, first child at `insets.getTop()`) — proof the first child stacks at content-top in every mode.
- [tests/component/layout/Anchor.test.ts](tests/component/layout/Anchor.test.ts) and [tests/component/layout/VBox.test.ts](tests/component/layout/VBox.test.ts) — harness conventions (`installTestDOM`, host container, `getElement(true)`, `clearInsets`, `doLayout`).

---

## Non-Goals

- No change to VBox sizing (`getPreferredSize`/`getMinSize`/`getMaxSize`/`computeTotalMinSize`) — the baseline is a read-only query, orthogonal to size.
- No change to `HBox`, `HFlow`, `Grid`, `nullChildY`, or the `LayoutManager` base's `null` default (other managers must keep returning `null`).
- No change to `Component.getBaseline`/`wrapInnerBaseline` — they already delegate and wrap correctly.
- No new public option, setter, or constructor field — the feature is a pure override with no configurability (per Simplicity First; nothing was requested beyond forwarding the first child's baseline).
- No hunting for a later baseline-bearing child when the first child's baseline is `null` — verbatim forwarding only.
