# Size-Constraint Invariant Regressions — Corrective Implementation Plan

## Implementation outcome — as built

The shipped change diverged from the corrective design described below. Rather than keeping the merged-min commit clamp and fixing each leaf's `min > preferred` inversion, the final model separates **what a component reports upward** from **what it imposes on itself**:

- **Reports stay merged.** `getMinSize`/`getMaxSize` still fold the component's own constraints with the layout-manager-derived ones. `getMaxSize` now merges with `Math.min` (the *tighter* bound) so an explicit `setMaxSize` cap actually binds — which surfaced and required fixing latent `getMaxSize` bugs in **Grid, HBox, VBox, Border, and HFlow** (they summed child *min* widths, took `Math.min` on the cross axis, or — in Border — dropped the centre row entirely; all masked before because the old `Math.max` merge never tightened anything).
- **Self-clamp splits on component type (the key decision).** `clampWidth`/`clampHeight` clamp a *general* component to its **merged** `[min, max]` (it adheres to its content size), but a **`Panel`** clamps only to its **own explicit** constraints — it fits whatever space it is allocated and clips or scrolls the overflow. Implemented as a protected `Component.clampsToContentSize()` (default `true`), overridden to `false` in `Panel`.
- **`getPreferredSize` stays own-scoped.** It clamps to the component's own explicit `[min, max]`, not the merged range: clamping it to the merged max would make the layout-gathering recursion re-entrant through `Grid.measureContent` and exponential in tree depth.
- **The box cross-axis min-floor was removed.** The original edits (3)/(4) `Math.max(height, minSize.height)` floor dogmatically inflated a child back up to its content minimum even when its row/column was shorter, defeating a scrolling/clipping child. The box now assigns the available cross-axis space capped to the child's max and delegates the minimum to the child's own clamp.
- **Grid clip now honours fill/anchor.** The clip-at-preferred branch resolves fill/anchor on the axis that fits and overrides only the overflowing axis to the child's natural extent.
- **Leaf inversions were NOT fixed as planned, and the `clipSizing` knob was NOT shipped.** Button/Header/Table were left untouched (the report-vs-self-limit split makes their derived mins harmless); the only leaf source-fix kept is the WindowHeader trailing-button insets, which were genuinely wrong. Grid's clip stays unconditional, now fill/anchor-aware — no `clipSizing` / `GridClipSizing` public surface was added.

The user-facing model is documented in [`docs/concepts/sizing.md`](../docs/concepts/sizing.md) ("Content size vs. allocated size"). The sections below are retained for historical context but describe the superseded "fix the leaves + clipSizing knob" approach.

---

## Overview

The already-committed `feature/size-constraint-invariant` work (commit [34b7eeb1](../src/typescript/lib/core/Component.ts), docs [d7ba8128](../docs/concepts/sizing.md)) began enforcing `min ≤ preferred ≤ max` honestly: [`Component.getPreferredSize`](../src/typescript/lib/core/Component.ts#L1927) now clamps its resolved size into the **merged** `getMinSize()`/`getMaxSize()`, and [`clampWidth`](../src/typescript/lib/core/Component.ts#L2479)/[`clampHeight`](../src/typescript/lib/core/Component.ts#L2538) re-point from `_options.minSize` to the same merged range. The merged minimum folds in the layout-manager-**derived** minimum ([`Component.getMinSize`](../src/typescript/lib/core/Component.ts#L2005) merges `layoutManager.getMinSize()` via `Math.max`). The codebase carries pre-existing `min > preferred` inversions in those derived minimums that master tolerated only because nothing enforced the floor downward. Enforcing them inflates components (the window header doubled 26→52px) and over-aggressive-min-enforcement breaks the scroll/overflow/clip machinery across six demo panels.

The fix makes the invariant hold **honestly** — fix the three leaf inversions at their source (lift the under-reporting preferred, or shrink an over-reported min, per component) — **not** by scoping enforcement to explicit-only constraints. Edits 1–5 of the original change stay; this plan corrects the leaves they exposed and verifies the scroll/overflow/clip paths recover once the leaves report a consistent `min ≤ preferred`.

This work lives in [`Button`](../src/typescript/lib/component/button/Button.ts), [`Header`](../src/typescript/lib/component/display/Header.ts), [`Table`](../src/typescript/lib/component/table/Table.ts), and is verified against the demo panels under [`src/typescript/`](../src/typescript/) (`*Panel.ts`). The leaf inversion and regression fixes are an internal correctness fix; the one piece of new public surface is folded in alongside them — [`Grid`](../src/typescript/lib/layout/Grid.ts) gains its own `clipSizing` knob (`GridClipSizing` type + `getClipSizing`/`setClipSizing`) governing the already-committed clip-at-preferred read, defaulting to the current behaviour (see *Grid gains its own `clipSizing` knob* and *Public API*).

**The branch is NOT mergeable until this lands.** This plan supersedes the open [`plans/in-progress/size-constraint-invariant.md`](in-progress/size-constraint-invariant.md) (which `/implement` already moved to `in-progress`): that plan's edits are committed; this is the corrective follow-up that makes them safe to merge.

---

## Architecture Decisions

### The regressions are a single mechanism: enforcing inflated derived mins

Every one of the six regressions and three inversions traces to the same chain. A leaf reports `min > preferred` on some axis. Its container's [`getMinSize`](../src/typescript/lib/core/Component.ts#L2005) folds that inflated leaf min in (via `Math.max` with `layoutManager.getMinSize()`). Then either:

- **read path** — [`getPreferredSize`](../src/typescript/lib/core/Component.ts#L1943) clamps the container's resolved preferred **up** to that inflated min, so the container reports a preferred larger than it should; or
- **commit path** — [`clampWidth`](../src/typescript/lib/core/Component.ts#L2479)/[`clampHeight`](../src/typescript/lib/core/Component.ts#L2538) lift the committed `_width`/`_height` **up** to the inflated merged min, so the laid-out box physically exceeds the room the host gave it.

The committed-box inflation is what breaks scroll/overflow/clip: a child forced wider/taller than its host's inner extent makes the host's `scrollWidth/scrollHeight` exceed its `clientWidth/clientHeight`, which (a) shows false scroll shadows ([`Panel`](../src/typescript/lib/core/Panel.ts) shadow strength reads the DOM scroll geometry), (b) overflows the viewport (clipping), and (c) — because the inflated child already fills/overflows the host — suppresses the *legitimate* overflow signal that other content needed to trigger a real scrollbar.

**Therefore: fixing the three leaf inversions so each reports `min ≤ preferred` removes the inflation at the source, and the merged-min clamp (edits 1–2) and the cross-axis lift (edits 3–4) become no-ops on the previously-inverted axes — they only ever bite now where a *real* `min ≤ preferred` constraint exists.** No change to edits 1–5 is required for the six regressions; they are collateral damage of the leaves, not bugs in the enforcement itself. (One guard is added defensively — see *The cross-axis lift must not read a still-inverted preferred*.)

### Inversion (i) — Button: LIFT preferred to its own min (width)

`Button` has no explicit `minSize`; its min comes from `_options.minSize` default `{0,0}` merged with its [`Fit`](../src/typescript/lib/layout/Fit.ts#L115) layout manager's min — which is the content row's `getMinSize()` + the button perimeter (insets `Insets(5,10,5,10)` + `2px` border = 24px horizontal). [`Button.computePreferredSize`](../src/typescript/lib/component/button/Button.ts#L1067) returns `content.getPreferredSize() + perimeter` with **no min floor**. For a glyph/icon button the content row's *min* width (glyph box pinned at line-height + spacing) exceeds the content row's *preferred* width (the empty/narrow `Text` preferred under-reports), so the button reports preferred `28` vs Fit-derived min `40` on width (×24 glyph buttons across the app — this is a **class**, every glyph/icon button, not one instance).

**Decision: the min is the legitimate usable minimum; LIFT preferred to `≥ min`.** A button narrower than its own minimum is not a desirable preferred size — a glyph button should prefer at least the room its glyph needs. Make [`Button.getPreferredSize`](../src/typescript/lib/component/button/Button.ts#L1010) (the auto-derived branch) return `max(computePreferredSize(), getMinSize())` per axis, so the derived preferred is never below the Fit-derived min. This fixes it at the Button leaf rather than relying on `Component.getPreferredSize`'s clamp (which already lifts it to 40 — but lifting *inside Button* makes the report self-consistent so the box-manager pre-clamp math, baselines, and the `_content` HBox sums all see a coherent value, and the consumer-pinned branch via `super.getPreferredSize()` keeps the base clamp). Rationale for not shrinking the min: the glyph box pinning (min=preferred via `Glyph.setPreferredSize`) is correct — the glyph must render at its size; shrinking it would clip glyphs.

### Inversion (ii) — WindowHeader: SHRINK the over-reported min (height)

[`Header.updatePreferredSize`](../src/typescript/lib/component/display/Header.ts#L161) pins an explicit `setPreferredSize(100, textHeight + topPad + bottomPad)` ≈ `(100, 22)` — a deliberately thin title bar. Its [`Border`](../src/typescript/lib/layout/Border.ts#L522) layout's `getMinSize` takes the middle-row height as `max(titleRow.minHeight, trailingRow.minHeight)`. The EAST trailing row ([`WindowHeader`](../src/typescript/lib/component/container/WindowHeader.ts#L92)) holds three glyph `Button`s whose min height (glyph line-box + button perimeter ≈ 28, perimeter-stacked to ≈ 48) **exceeds the explicit preferred height 22**. `Component.getPreferredSize` then clamps `22 → 48`, +perimeter → the observed 52px (26→52 doubling).

**Decision: the 48 min is over-reported; SHRINK it by making the trailing buttons not impose a tall floor.** The intended design is a ~26px header — the title bar's height should be driven by the title text, not the chrome buttons. The trailing glyph buttons are `chromeless` (no border) and decorative; they should *not* force the header taller than its text. Give the `WindowHeader` trailing `Button`s an explicit small `preferredSize`/`maxSize` matching the header line box (as `TablePanel` already does with `setPreferredSize(28,28)` on its toolbar buttons — but here also cap height), OR pin the trailing-row / each trailing button `setMaxSize(_, headerLineHeight)` so the Border middle-row min does not exceed the title height. Concretely: in [`WindowHeader`'s constructor](../src/typescript/lib/component/container/WindowHeader.ts#L88) size each trailing button to the header's content height (so its Fit-derived min height collapses to the header line box), making `trailingRow.minHeight ≤ titleRow.minHeight`. This keeps `Header`'s explicit preferred height honest (`min ≤ preferred`) without touching `Header.updatePreferredSize` (which other `Header` subclasses share). Note: once inversion (i) is fixed, each trailing button's preferred height already equals its min height — but its min height is still the full 48-ish line+perimeter; the cap is what brings it down to the header line box. Rationale for not lifting the header preferred to 48: that would defeat the deliberate thin-header design and regress every `Header`/`WindowHeader` in the app.

### Inversion (iii) — TablePanel: LIFT the table's preferred height to its own min

[`Table.setMinSize(100, 100)`](../src/typescript/lib/component/table/Table.ts#L112) declares a legitimate "show at least ~100px of rows" floor. The table's *preferred* height under-reports it (header-only / near-zero body preferred), so via [`Border`](../src/typescript/lib/layout/Border.ts#L451) the `TablePanel` reports preferred height `36` vs min `136` (= toolbar NORTH + Table CENTER min 100 + perimeter).

**Decision: the 100px min is legitimate (a table that shows no rows is useless); LIFT the Table's preferred height to `≥ its min`.** A `Table` should *prefer* to show the rows it minimally reserves. Make `Table.getPreferredSize` return a preferred height `≥ getMinSize().height` (i.e. floor its derived/header-only preferred to 100, or report a preferred that accounts for a sensible default row count). This makes the `TablePanel` report `min ≤ preferred` so the Border-derived min no longer inflates the panel's preferred above what it should be. Rationale for not shrinking the min: a `setMinSize(100,100)` is an explicit, intentional floor the author chose; the bug is that preferred didn't respect it.

### These three are representatives of a class; add detection, not whack-a-mole

Inversion (i) is every glyph/icon button (×24). (ii) is every `WindowHeader`. (iii) is every `Table`/`TablePanel`. Other leaf components that compute preferred/min independently are candidates for latent inversions: [`Text`](../src/typescript/lib/component/input/Text.ts#L459) (height floor — but it folds the floor into *min* and lifts via the clamp, so it is *correct* under the new rule), [`Glyph`](../src/typescript/lib/component/display/Glyph.ts) (pins min=preferred — consistent), `ProgressBar`, `TextField`, `List`, [`Image`](../src/typescript/lib/component/display/Image.ts) (caps min at natural — consistent).

**Decision: add a temporary, dev-only detection probe** rather than auditing every leaf by hand. The instrumentation that found these three was a log in `getPreferredSize` when `getMinSize()` exceeds the resolved (pre-clamp) preferred. Add the same probe (guarded so it is trivially removable / behind a dev flag) at the clamp site in [`Component.getPreferredSize`](../src/typescript/lib/core/Component.ts#L1939) for the duration of this work: when the un-clamped `preferredSize` is below `getMinSize()` on either axis, `console.warn` the component class + the two sizes. Run every demo panel with it on, fix any newly-surfaced leaf the same way (lift-vs-shrink per the same rule), then **remove the probe before commit**. This catches the whole class without speculative edits.

### Keep edits 1–5; only the cross-axis lift gets a defensive guard

Edits 1–5 are the enforcement and are correct in principle. Once the leaves report `min ≤ preferred`, the merged-min clamp and cross-axis lift only fire where a real constraint exists — which is the intended behaviour. **No structural change to edits 1–5.**

One defensive adjustment in the box managers (decision below) keeps the cross-axis lift from re-introducing inflation if a leaf is *still* inverted (e.g. a future regression the probe missed): the lift reads `size` (the child's preferred) as its overflow floor — if that preferred is itself below the child's min, the subsequent `Math.min(_, maxSize)` could still under- or over-shoot. Because the leaf fix makes `size ≥ minSize`, the existing code is correct; the guard just makes the box manager robust to a still-inverted child by clamping the chosen floor into `[minSize, maxSize]` before applying. This is a belt-and-braces change, optional if the probe comes back clean.

### The cross-axis lift must not read a still-inverted preferred

[`HBox.layoutPreferredMode`](../src/typescript/lib/layout/HBox.ts#L481) lifts the cross axis to `size.height` (preferred) on overflow. If a child's preferred is below its min (the bug we are removing), this would commit below min — but [`clampHeight`](../src/typescript/lib/core/Component.ts#L2538) (edit 2) then lifts it back to merged min, so the *committed* size is safe; only the *positioning* math (`y` advance) would use the lower value. After the leaf fixes this cannot happen. **Decision: rely on the leaf fixes; do not special-case the box managers** beyond the optional defensive clamp above. Verified by the probe being clean.

### Grid gains its own `clipSizing` knob — fold it into the same corrective pass

Edit 5 of the original change committed Grid's clip branch as an **unconditional** clip-at-preferred read: [`Grid.layoutOccupancy`](../src/typescript/lib/layout/Grid.ts#L856)'s `placeAt` clip branch ([`Grid.ts:901-915`](../src/typescript/lib/layout/Grid.ts#L901)) calls `component.getPreferredSize()` at [`Grid.ts:910`](../src/typescript/lib/layout/Grid.ts#L910) and commits the inner child at that preferred (per-axis null-preferred → min fallback) inside the cell-sized clip frame. The sibling plan [`in-progress/size-constraint-invariant.md`](in-progress/size-constraint-invariant.md) specifies this read should be governed by Grid's **own** option rather than wired hard — consistent with its *Per-manager clip knobs* decision: each clip-capable manager owns its own option and default (the box managers already carry `overflowSizing`; Grid gets `clipSizing`).

**Decision: this corrective pass folds the knob in.** Grid gains a `clipSizing?: GridClipSizing` option (`GridClipSizing = "preferred" | "min"`), a private `_clipSizing` backing field **defaulting to `"preferred"`**, `applyOptions` dispatch, and a typed `getClipSizing`/`setClipSizing` pair — mirroring the existing `defaultFill`/`defaultAnchor`/`baselineAlign` idiom ([`Grid.ts:18-37`](../src/typescript/lib/layout/Grid.ts#L18) interface, [`47-54`](../src/typescript/lib/layout/Grid.ts#L47) backing fields, [`71-105`](../src/typescript/lib/layout/Grid.ts#L71) dispatch, [`113-128`](../src/typescript/lib/layout/Grid.ts#L113) getter/setter). The clip branch at [`Grid.ts:910`](../src/typescript/lib/layout/Grid.ts#L910) then reads `_clipSizing`: `"preferred"` reads `component.getPreferredSize()` (per-axis null-preferred → min fallback), `"min"` commits the inner child at its min floor. The clip *frame* stays cell-sized either way.

Because the default is `"preferred"`, default behaviour is **identical** to the currently-committed unconditional clip-at-preferred — the knob only lets a consumer set `"min"` to clip at the min floor instead. Grid does **not** reuse the box managers' `BoxOverflowSizing`; sub-min clip sizing is Grid's own concern, so it carries its own `GridClipSizing` type. `GridClipSizing` is re-exported from the layout barrel ([`src/typescript/lib/layout/index.ts:28`](../src/typescript/lib/layout/index.ts#L28)) alongside `GridOptions`. **This is additive public surface — the only public API this corrective pass adds;** the leaf inversion and regression fixes remain internal-only.

---

## Root-Cause Summary

### Three inversions

| # | Component | Axis | Numbers (pref vs min) | Root-cause line | Decision |
|---|---|---|---|---|---|
| i | Button (×24 glyph/icon) via Fit | width | 28 vs 40 | [`Button.computePreferredSize`](../src/typescript/lib/component/button/Button.ts#L1067) returns content+perimeter, no min floor; merged Fit min ([`Fit.getMinSize`](../src/typescript/lib/layout/Fit.ts#L115)) folds the content row's larger min width | LIFT preferred to ≥ min |
| ii | WindowHeader via Border | height | 22 vs 48 | [`Header.updatePreferredSize`](../src/typescript/lib/component/display/Header.ts#L169) pins `(100, ~22)`; [`Border.getMinSize`](../src/typescript/lib/layout/Border.ts#L522) takes middle-row `max(titleRow, trailingRow)` height, and the EAST glyph-button [trailing row](../src/typescript/lib/component/container/WindowHeader.ts#L92) min height ≈ 48 | SHRINK min: cap trailing buttons to the header line box |
| iii | TablePanel via Border | height | 36 vs 136 | [`Table.setMinSize(100, 100)`](../src/typescript/lib/component/table/Table.ts#L112); Table's preferred height under-reports the 100px floor; [`Border.getMinSize`](../src/typescript/lib/layout/Border.ts#L522) sums toolbar + table min | LIFT Table preferred height to ≥ min |

`Border.getMinSize`/`getPreferredSize` are structurally identical faithful propagators — the inversions originate at the leaves, not Border. The width half of (ii) cascades from (i) and resolves once (i) is fixed.

### Six regressions (all the same mechanism — inflated committed box)

| # | Demo panel (source) | Symptom | Responsible path |
|---|---|---|---|
| 1 | [`MiscPanel.ts`](../src/typescript/MiscPanel.ts) | false horizontal scroll shadows (can't scroll X) | child boxes inflated past inner width by [`clampWidth`](../src/typescript/lib/core/Component.ts#L2479) reading inflated merged min → `scrollWidth > clientWidth` → [`Panel`](../src/typescript/lib/core/Panel.ts) shadow geometry shows. Fixed by leaf fixes (i)/(iii) shrinking the inflated mins. |
| 2 | [`BindingPanel.ts`](../src/typescript/BindingPanel.ts) | textfields clip; insets ignored | rows hold glyph buttons (i); the inflated row min forces [`clampWidth`](../src/typescript/lib/core/Component.ts#L2479) to widen the row past the field's inner box, clipping the field. Fixed by (i). |
| 3 | [`RowPanel.ts`](../src/typescript/RowPanel.ts) / [`ColumnPanel.ts`](../src/typescript/ColumnPanel.ts) / [`HBoxPanel.ts`](../src/typescript/HBoxPanel.ts) / [`VBoxPanel.ts`](../src/typescript/VBoxPanel.ts) | scrollbar no longer shows when it should | children forced up to inflated min already fill/overflow the host so the *intended* overflow that should trigger the scrollbar is masked, or [`inflateForOverflow`](../src/typescript/lib/layout/BoxLayout.ts#L232) inflates the working size to an over-reported `computeTotalMinSize` so the host content exactly fits its (also-inflated) box. Fixed by leaves; verify [`BoxLayout.inflateForOverflow`](../src/typescript/lib/layout/BoxLayout.ts#L232) reads sane `computeTotalMinSize` afterwards. |
| 4 | [`MultiSelectListPanel.ts`](../src/typescript/MultiSelectListPanel.ts) / [`GridPanel.ts`](../src/typescript/GridPanel.ts) | scrolls but clipped in viewport, scrollbar clipped | same root as #3: host inflated wrong (merged-min commit) so the scroll viewport itself overflows its parent and is clipped. Fixed by leaves; verify [`Grid`](../src/typescript/lib/layout/Grid.ts#L901) clip branch and the merged-min clamp on the viewport host. |
| 5 | [`SplitPanel.ts`](../src/typescript/SplitPanel.ts) | the lower-right pane control (a **Slider**, not a ProgressBar — the prompt's "ProgressBar" is the last Split pane) not showing | the EAST/last Split cell child is squeezed to zero or pushed out of view because sibling panes' inflated mins (the `Button "Hello World button!"` and `List` in the north/south splits) consume the cell space via the merged-min commit. Fixed by (i); verify Split cell sizing against the merged-min `clampWidth/Height`. |
| 6 | [`BorderPanel.ts`](../src/typescript/BorderPanel.ts) | clips the viewport | a Border region holding glyph buttons / a table inflates the region past the panel, overflowing the viewport. Fixed by (i)/(iii). |

---

## Public API (TypeScript Signatures)

The only new public surface is Grid's `clipSizing` knob, mirroring its existing `defaultFill`/`defaultAnchor`/`baselineAlign` idiom (private backing field, `GridOptions` field, `applyOptions` dispatch, typed getter/setter). The leaf inversion and regression fixes add no public surface.

```typescript
// src/typescript/lib/layout/Grid.ts

/** How {@link Grid} sizes a child whose min exceeds its assigned cell block (the clip case). */
export type GridClipSizing = "preferred" | "min";

export interface GridOptions extends LayoutManagerOptions {
    // ... existing fields (rows/columns/spacing/defaultFill/defaultAnchor/baselineAlign/columnTracks/rowTracks) ...

    /** Inner-child sizing when a cell is smaller than the child's min and the child is clipped. Default `"preferred"`. */
    clipSizing?: GridClipSizing;
}

class Grid extends LayoutManager {
    private _clipSizing: GridClipSizing = "preferred";

    getClipSizing(): GridClipSizing;
    setClipSizing(clipSizing: GridClipSizing): this;
}
```

`GridClipSizing` is re-exported alongside `GridOptions` from the layout barrel ([`src/typescript/lib/layout/index.ts:28`](../src/typescript/lib/layout/index.ts#L28)). Default `"preferred"` reproduces the currently-committed unconditional clip-at-preferred behaviour exactly.

---

## Ordered Implementation Steps

1. **Add the dev-only detection probe** to [`Component.getPreferredSize`](../src/typescript/lib/core/Component.ts#L1939): just before the `clampPreferredToConstraints` call, when the un-clamped `preferredSize` is below `getMinSize()` on either axis, `console.warn` `this.getClassName()` + both sizes. Mark it clearly as temporary. → verify: `npm run typecheck` clean; running the app logs the three known inversions (Button, WindowHeader/Header, Table).

2. **Fix inversion (i) — Button.** In [`Button.getPreferredSize`](../src/typescript/lib/component/button/Button.ts#L1010) auto-derived branch, return `computePreferredSize()` floored per-axis to `getMinSize()` (lift preferred to ≥ min). Keep the `_consumerSetPreferredSize` branch delegating to `super`. → verify: probe no longer warns for glyph buttons; a glyph button reports `pref.width ≥ min.width`; `npm run typecheck` clean.

3. **Fix inversion (iii) — Table.** Make `Table.getPreferredSize` floor its preferred height to `≥ getMinSize().height` (respect the `setMinSize(100,100)` floor). → verify: probe no longer warns for `Table`; `TablePanel.getPreferredSize().height ≥` its min; table demo still scrolls rows.

4. **Fix inversion (ii) — WindowHeader.** Cap the trailing min/maximize/close `Button`s to the header line box so [`Border.getMinSize`](../src/typescript/lib/layout/Border.ts#L522)'s middle-row height no longer exceeds the title height (per *Architecture Decisions*). → verify: probe no longer warns for `WindowHeader`/`Header`; a window header measures ~26px again, not 52px.

5. **Run every demo panel with the probe on** (Misc, Binding, Row, Column, Fit, Split, Border, HBox, VBox, HFlow, Grid, Complex, Accordion, Tab, MenuBar, ToolBar, MultiSelect, Baseline). Fix any newly-surfaced leaf inversion with the same lift-vs-shrink rule (legitimate min → lift preferred; over-reported min → shrink). → verify: zero probe warnings across all panels.

6. **(Optional, defensive) Box-manager floor clamp.** If step 5 surfaces a leaf that cannot be cleanly fixed at the leaf, clamp the cross-axis overflow `floor` into `[minSize, maxSize]` in [`HBox.layoutPreferredMode`](../src/typescript/lib/layout/HBox.ts#L481) and [`VBox`](../src/typescript/lib/layout/VBox.ts#L425) before applying. Skip if step 5 is clean. → verify: `npm run typecheck` clean.

7. **Add Grid's `clipSizing` knob** ([`Grid.ts`](../src/typescript/lib/layout/Grid.ts)). (a) Declare `export type GridClipSizing = "preferred" | "min";`. (b) Add `clipSizing?: GridClipSizing;` to the `GridOptions` interface near `defaultFill`/`defaultAnchor`/`baselineAlign` ([`Grid.ts:18-37`](../src/typescript/lib/layout/Grid.ts#L18)). (c) Add the private backing field `private _clipSizing: GridClipSizing = "preferred";` with Grid's other backing fields ([`Grid.ts:47-54`](../src/typescript/lib/layout/Grid.ts#L47)). (d) Dispatch in `applyOptions`: `if (options.clipSizing !== undefined) { this.setClipSizing(options.clipSizing); }` ([`Grid.ts:71-105`](../src/typescript/lib/layout/Grid.ts#L71)). (e) Add the JSDoc'd `getClipSizing(): GridClipSizing` / `setClipSizing(clipSizing: GridClipSizing): this` pair mirroring `getDefaultFill`/`setDefaultFill` ([`Grid.ts:113-128`](../src/typescript/lib/layout/Grid.ts#L113)). (f) Re-export `GridClipSizing` from the layout barrel ([`src/typescript/lib/layout/index.ts:28`](../src/typescript/lib/layout/index.ts#L28), alongside `GridOptions`). → verify: `grep -n "clipSizing\|GridClipSizing" src/typescript/lib/layout/Grid.ts` shows all six (type, option field, backing field, dispatch, getter, setter); `npm run typecheck` clean.

8. **Make Grid's clip branch read `_clipSizing`** ([`Grid.ts:901-915`](../src/typescript/lib/layout/Grid.ts#L901), inside `layoutOccupancy`'s `placeAt` `min > cell` branch). Replace the unconditional `const pref = component.getPreferredSize();` at [`Grid.ts:910`](../src/typescript/lib/layout/Grid.ts#L910) with a `_clipSizing` read: `const pref = this._clipSizing === "preferred" ? component.getPreferredSize() : null;`. `"preferred"` keeps the current per-axis null-preferred → min fallback; `"min"` commits the inner child at its min floor. The `setClipFrame(x, y, w, h)` frame stays cell-sized. → verify: `grep -n "this._clipSizing" src/typescript/lib/layout/Grid.ts` returns the clip-branch line; `npm run typecheck` clean.

9. **Remove the probe** added in step 1. → verify: `grep -rn "console.warn" src/typescript/lib/core/Component.ts` returns nothing from this work.

10. **Regression walk** of all six named panels (see *Verification*). → verify each symptom resolved.

11. **Self-review checklist:** (a) every changed line traces to a named inversion, regression, or the `clipSizing` knob; (b) edits 1–4 of the prior commit are untouched, and edit 5 (the Grid clip branch) only gains the `_clipSizing` read (default behaviour unchanged); (c) the original invariant still enforced (explicit `setMinSize(120,40)+setPreferredSize(0,0)` child still lands ≥ its min); (d) probe removed; (e) `clipSizing` wired through `GridOptions` + `applyOptions` + getter/setter + barrel, default `"preferred"`. → verify: `git diff` review + the explicit-min assertion below.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [`src/typescript/lib/component/button/Button.ts`](../src/typescript/lib/component/button/Button.ts) — `getPreferredSize` floors auto-derived preferred to `getMinSize()` (inversion i) |
| Modify | [`src/typescript/lib/component/table/Table.ts`](../src/typescript/lib/component/table/Table.ts) — `getPreferredSize` floors preferred height to its `setMinSize` floor (inversion iii) |
| Modify | [`src/typescript/lib/component/container/WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts) — cap trailing buttons to the header line box (inversion ii) |
| Modify (temporary) | [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — add then **remove** the dev detection probe (steps 1 + 7) |
| Modify (optional) | [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) / [`VBox.ts`](../src/typescript/lib/layout/VBox.ts) — defensive cross-axis floor clamp (only if step 5 demands it) |
| Modify | [`src/typescript/lib/layout/Grid.ts`](../src/typescript/lib/layout/Grid.ts) — add the `clipSizing` option + `GridClipSizing` type + `_clipSizing` backing field + `GridOptions` field + `applyOptions` dispatch + `getClipSizing`/`setClipSizing`; the clip branch reads `_clipSizing` (default `"preferred"` preserves the committed behaviour) |
| Modify | [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts) — re-export `GridClipSizing` alongside `GridOptions` |

No files created or deleted. Edits 1–4 of the prior commit (`Component.clampPreferredToConstraints`/`clampWidth`/`clampHeight`, the HBox/VBox cross-axis lift) are **kept as-is**; edit 5 (the Grid clip branch) is **kept** and additively gains the `_clipSizing` read whose `"preferred"` default reproduces the committed behaviour exactly.

---

## Verification

- **Detection probe clean:** with the probe active, every demo panel logs **zero** `min > preferred` warnings (after steps 2–5). Removed before commit.
- **Window header height:** a `WindowHeader` measures ~26px (its text line + padding), not 52px.
- **Original invariant still enforced (the bitten shape):** a child with explicit `setMinSize(120, 40)` + `setPreferredSize(0, 0)` placed in an HBox/VBox still lands `getWidth() ≥ 120 && getHeight() ≥ 40`, and its parent's `getPreferredSize()` reports it contributing ≥ its min — confirming the corrective fixes did NOT weaken enforcement to explicit-only.
- **Per-panel manual checks:**
  - **Misc** ([`MiscPanel.ts`](../src/typescript/MiscPanel.ts)): no horizontal scroll shadows when the panel cannot scroll horizontally; the slow table still scrolls.
  - **Binding** ([`BindingPanel.ts`](../src/typescript/BindingPanel.ts)): textfields render full-width, not clipped; insets visible.
  - **Row / Column / HBox / VBox** ([`RowPanel.ts`](../src/typescript/RowPanel.ts) / [`ColumnPanel.ts`](../src/typescript/ColumnPanel.ts) / [`HBoxPanel.ts`](../src/typescript/HBoxPanel.ts) / [`VBoxPanel.ts`](../src/typescript/VBoxPanel.ts)): a scrollbar appears when content overflows.
  - **MultiSelect / Grid** ([`MultiSelectListPanel.ts`](../src/typescript/MultiSelectListPanel.ts) / [`GridPanel.ts`](../src/typescript/GridPanel.ts)): scrolls without the viewport or scrollbar being clipped.
  - **Split** ([`SplitPanel.ts`](../src/typescript/SplitPanel.ts)): the lower-right Slider pane is visible.
  - **Border** ([`BorderPanel.ts`](../src/typescript/BorderPanel.ts)): content fits within the viewport, no clipping.
- **Grid `clipSizing` — both values:** in [`GridPanel.ts`](../src/typescript/GridPanel.ts), an oversized child whose `min` exceeds its cell. With the default `clipSizing: "preferred"`, the clipped child renders at its **preferred** size inside the cell-sized clip frame (default behaviour — identical to the committed clip-at-preferred). With `clipSizing: "min"`, the same child renders at its **min** floor inside the cell-sized frame — confirming Grid's own knob flips the behaviour. A null-preferred child floors to min under both values.
- **`GridClipSizing` grep:** `grep -n "clipSizing\|GridClipSizing" src/typescript/lib/layout/Grid.ts` shows the type, option field, backing field, `applyOptions` dispatch, getter, and setter; `grep -n "this._clipSizing" src/typescript/lib/layout/Grid.ts` returns the clip-branch read; `grep -n "GridClipSizing" src/typescript/lib/layout/index.ts` shows the barrel re-export.
- **No-op spot-check:** Fit/Tab/Accordion panels render pixel-identical to pre-regression master where no inverted leaf is present.
- **Typecheck:** `npm run typecheck` (`tsc -p tsconfig.lib.json --noEmit`) — 0 errors.
- **Docs:** `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).

---

## Documentation Impact

[`docs/concepts/sizing.md`](../docs/concepts/sizing.md) (commit d7ba8128) describes the invariant as holding (`min ≤ preferred ≤ max`, min-wins resolution) and the clip-at-preferred behaviour. **The corrective design makes that documentation *true* rather than aspirational** — it does not change the documented contract, so **no revision is required for the leaf inversion / regression fixes**. The doc's example (`setMinSize(120,0)` then `setPreferredSize(0,0)` reports width 120) remains exactly the enforced behaviour. Do **not** weaken the doc to describe explicit-only enforcement; the user's decision is that the invariant holds for derived mins too, which this plan delivers.

**Grid's `clipSizing` knob is public layout surface and does need docs** (per `_shared/docs-conventions.md`):

- **Barrel:** the layout subpath barrel ([`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts)) already exports `Grid`/`GridOptions`; the new `GridClipSizing` type re-export (step 7f) carries an `@category Layouts` tag like its siblings so it lands in `docs/api/layout/`.
- **Curated page:** [`docs/layouts/Grid.md`](../docs/layouts/Grid.md) covers Grid — add `clipSizing` to the `## Usage` `GridOptions` field list, extend the clip section to explain the clipped child renders at its preferred size by default with `clipSizing: "min"` reverting to the min floor, and add a `setClipSizing(...)` row to the `## Common methods` table. No new page, so no `docs/layouts/index.md` catalog or `docs/.vitepress/config.mts` sidebar entry is needed (Grid is already listed).
- **JSDoc:** `clipSizing`/`GridClipSizing` references stay within the `layout` bucket, so `{@link GridClipSizing}` resolves without a cross-bucket markdown link.

Re-run `npm run docs:build` — 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning); the new `clipSizing` / `GridClipSizing` / `setClipSizing` surface must resolve. The leaf-fix API signatures touched are not exported-surface changes, so they need no barrel or curated-page edits.

---

## Potential Challenges

- **Button lift vs. the base clamp double-applying.** `Component.getPreferredSize` already lifts Button's preferred to 40 via the clamp; lifting inside `Button.getPreferredSize` too is redundant but harmless (both lift to the same merged min) — the point is a self-consistent Button report for the box-manager pre-clamp math and baselines. Verify the consumer-pinned branch still routes through `super` so an explicit `setPreferredSize` is respected.
- **WindowHeader cap interacting with `Button._syncGlyphSize`.** The trailing buttons size their glyph to the title line height; capping the button box must not clip the glyph. Cap to the header line box (which the glyph already targets), not below it. Verify the close/min/max glyphs render fully.
- **Table preferred-height floor vs. pagination/empty store.** Flooring preferred height to 100 must not fight an empty-store or paginated table. Verify `TablePanel` with 0 rows and with a `PaginationBar` still lays out.
- **The probe must be removed.** A left-in `console.warn` would spam production. Step 7 + the grep check guard this.
- **A regression that is NOT a leaf inversion.** If the probe comes back clean but a panel still regresses, the cause is the enforcement interacting with `inflateForOverflow` / Split cell sizing rather than a leaf — then the optional defensive clamp (step 6) or a targeted fix in [`BoxLayout.inflateForOverflow`](../src/typescript/lib/layout/BoxLayout.ts#L232) is warranted. Treat as a fallback, not the primary path.

---

## Critical Files

- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `getPreferredSize` (1927) + the kept clamp (1943), `clampPreferredToConstraints` (1958), `getMinSize` (2005), `getMaxSize` (2074), `clampWidth` (2479), `clampHeight` (2538). The probe and its removal live here.
- [`src/typescript/lib/component/button/Button.ts`](../src/typescript/lib/component/button/Button.ts) — `getPreferredSize` (1010), `computePreferredSize` (1067), `_syncGlyphSize` (708), default insets (137).
- [`src/typescript/lib/component/display/Header.ts`](../src/typescript/lib/component/display/Header.ts) — `updatePreferredSize` (161) and the `Border` layout (50); the shared base whose preferred-pin must stay intact for non-window headers.
- [`src/typescript/lib/component/container/WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts) — trailing-row construction (88–99).
- [`src/typescript/lib/component/table/Table.ts`](../src/typescript/lib/component/table/Table.ts) — `setMinSize(100,100)` (112); and [`TablePanel.ts`](../src/typescript/lib/component/table/TablePanel.ts) — Border layout + toolbar (43–74).
- [`src/typescript/lib/layout/Border.ts`](../src/typescript/lib/layout/Border.ts) — `getPreferredSize` (451) / `getMinSize` (522) faithful propagators (read-only — do not modify).
- [`src/typescript/lib/layout/Grid.ts`](../src/typescript/lib/layout/Grid.ts) — the option pattern to mirror for `clipSizing` (`GridOptions` 18-37, backing fields 47-54, `applyOptions` dispatch 71-105, `getDefaultFill`/`setDefaultFill` 113-128), and the `min > cell` clip branch (901-915, in `layoutOccupancy`'s `placeAt`) whose preferred read at 910 becomes the `_clipSizing` read; [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts) (27-28) — the barrel that re-exports `Grid`/`GridOptions` and gains `GridClipSizing`.
- [`src/typescript/lib/layout/BoxLayout.ts`](../src/typescript/lib/layout/BoxLayout.ts) — `inflateForOverflow` (232), `computeTotalMinSize` (abstract, 219), `_overflowSizing` (75); [`HBox.ts`](../src/typescript/lib/layout/HBox.ts) cross-axis lift (481) / `computeTotalMinSize` (256); [`VBox.ts`](../src/typescript/lib/layout/VBox.ts) cross-axis lift (425).
- [`src/typescript/lib/core/Panel.ts`](../src/typescript/lib/core/Panel.ts) — scroll-shadow geometry (reads DOM scroll extents) and `setAutoScroll`/`setOverflowing`.
- Demo panels under [`src/typescript/`](../src/typescript/): `MiscPanel`, `BindingPanel`, `RowPanel`, `ColumnPanel`, `HBoxPanel`, `VBoxPanel`, `GridPanel`, `MultiSelectListPanel`, `SplitPanel`, `BorderPanel`.

---

## Non-Goals

- **Reverting edits 1–5 or scoping enforcement to explicit-only constraints.** The user's decision is that the invariant holds honestly for derived mins; this plan fixes the leaves so it can.
- **Refactoring `Border`/`Fit`/`Tab` size propagation.** They are faithful — the inversions are at the leaves.
- **Touching `Header.updatePreferredSize` for non-window headers.** Only `WindowHeader`'s trailing-row chrome is capped; the shared base pin stays.
- **A general "min-floor on every leaf preferred" base-class change.** The base `getPreferredSize` clamp already does this on read; the leaf fixes exist to make each leaf's *self-report* consistent, not to add a second global mechanism.
- **Keeping the detection probe.** It is a temporary investigation aid, removed before commit.
