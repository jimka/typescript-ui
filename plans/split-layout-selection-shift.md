# Split-Layout Selection Shift — Implementation Plan

## Overview

On the **Split** demo panel ([`SplitPanel.ts`](../src/typescript/SplitPanel.ts)) the lower-left pane hosts a [`List`](../src/typescript/lib/component/list/List.ts) inside a horizontal [`Split`](../src/typescript/lib/layout/Split.ts), which itself sits in the south pane of a vertical `Split`. The report: selecting (or changing the selection of) a list row "recalculates the layout and shifts it slightly." The hypothesis handed to this plan is a box-sizing / border-width accounting problem in size measurement — selection re-triggers layout with a slightly different measured size because the list border isn't counted.

This plan owns the **List border / box-sizing measurement** angle. A sibling plan (`component-sizing-constraints.md`) adds a `min-height` to `List`; that change is explicitly **out of scope** here and must not be duplicated.

A root-cause investigation (static read of the full selection → relayout → measurement chain, plus a live probe of the running demo) was performed before drafting. The findings below **refute the literal border hypothesis as the trigger** and pin the real mechanism elsewhere. The plan therefore leads with a verifiable reproduction harness so the implementer reconfirms the live magnitude and the offending DOM delta before committing code, then specifies the measurement-correctness fix that actually removes the shift.

---

## Investigation Findings (root cause)

### The selection path performs no size measurement and schedules no layout

`handleRowClick` ([`AbstractCustomList.ts:1021`](../src/typescript/lib/component/list/AbstractCustomList.ts#L1021)) runs: `reduceSelection` (pure state) → `refreshRowVisualState` → `updateActiveDescendant` → `focus()` → `notifyUserChange` → `fireChange`. The only DOM writes are:

- `CustomListRow.applyRowClass` → `setElementAttribute("class", …)` ([`AbstractCustomList.ts:344`](../src/typescript/lib/component/list/AbstractCustomList.ts#L344)). `setElementAttribute` ([`Component.ts:619`](../src/typescript/lib/core/Component.ts#L619)) writes the attribute directly and **never calls `scheduleLayout`**.
- `getAria().setActiveDescendant(...)` — an ARIA attribute, no geometry.
- `focus()` — DOM focus, which activates the `.List:focus::after` ring ([`AbstractCustomList.ts:114`](../src/typescript/lib/component/list/AbstractCustomList.ts#L114)). That ring is `position: absolute; inset: 0; box-sizing: border-box` — a pseudo-element overlay that **cannot reflow siblings**.

The `.selected` rule changes only `background-color`/`color`; the `.focused` rule changes only `outline`. Neither alters box dimensions. `grep` confirms **nothing** in `src/typescript/lib/component/list/` calls `setBorder`, `getInnerSize`, `getPreferredSize`, or `flushLayout` — so selection never nulls `_borderWidths` and never re-measures the list.

### The surrounding Split doesn't measure the List on relayout

`Split.doLayout` ([`Split.ts:245`](../src/typescript/lib/layout/Split.ts#L245)) sizes each pane from the cached `_sizes` map via `recalculateSizes` ([`Split.ts:354`](../src/typescript/lib/layout/Split.ts#L354)), **not** from `List.getPreferredSize()`. Once a pane has a stored size it is stable across relayouts. The cross-axis comes from `container.getInnerSize()` of the (border-less) split container. So even a re-run of `Split.doLayout` produces identical pane rects.

### The border math is already correct

`getInnerSize` ([`Component.ts:1778`](../src/typescript/lib/core/Component.ts#L1778)) subtracts `getPerimiterSize` = insets + `getBorderSize` ([`Component.ts:1807`](../src/typescript/lib/core/Component.ts#L1807)). The framework default is `box-sizing: border-box` ([`Component.ts:301`](../src/typescript/lib/core/Component.ts#L301)), so a `setWidth(N)` yields an outer width of exactly `N` and the subtraction is correct. The List's border is `"1px solid var(--ts-ui-list-border, …)"`; `estimateBorderSideWidth` ([`Component.ts:1856`](../src/typescript/lib/core/Component.ts#L1856)) parses the leading `1px` to `1`, and the connected `getComputedStyle` path also yields `1`. **Pre-attach estimate == connected computed == 1px**, so the cached-vs-estimate seam produces no delta here.

### Live probe

The running demo (`http://localhost:8015`, Split tab) was driven: list `box-sizing: border-box`, border `1px` all sides; clicking rows 1, 6, and 9 produced **zero** change in the list rect, the textarea rect, or any gutter rect — measured synchronously, after a double-`requestAnimationFrame`, and after an 80 ms timeout. At the probed viewport the inner panel did **not** overflow (`scrollHeight == clientHeight`, no vertical scrollbar).

**Conclusion:** the literal "border not counted / box-sizing" hypothesis is **refuted** for the List's own border and for the Split's pane math. The remaining plausible trigger is **the native vertical scrollbar of the inner scroll panel appearing or disappearing as a side effect of selection-driven scrolling** (`scrollIndexIntoView`, [`AbstractCustomList.ts:1349`](../src/typescript/lib/component/list/AbstractCustomList.ts#L1349)) — when the panel gains/loses its scrollbar, `clientWidth` of the row viewport changes, which can nudge row layout and, at viewports where the list's preferred size feeds an ancestor, propagate a sub-pixel shift. This is a scrollbar-gutter accounting problem, not a border one. The harness in Step 1 must confirm which DOM box actually changes on the reporter's viewport before the fix is locked in.

---

## Architecture Decisions

### Reproduce first, then fix — the harness gates the code change

The live probe at the default viewport showed **no** shift, so the bug is viewport- / overflow-dependent. Committing a speculative border fix would violate "surgical changes" (CODE_CONVENTIONS §3) and the CLAUDE.md "root-cause before fix" rule. Step 1 builds a deterministic harness that forces the inner panel to overflow and captures the exact box whose geometry changes on selection. The fix in Steps 2–3 is then chosen from the two prepared branches based on what the harness shows. **The implementer must not skip Step 1.**

### Stabilise the scrollbar gutter rather than re-measuring on every selection

If the harness confirms the scrollbar-appearance mechanism, the correct fix is to make the inner scroll panel reserve a stable gutter so selection-driven scroll never toggles the scrollbar's contribution to `clientWidth`. This is a one-line, theme-neutral CSS-property addition on the existing inner `Panel`, not new measurement logic — it removes the shift at its source and keeps the row-width math constant. Reserving a gutter is preferred over recomputing layout on selection because the latter re-introduces per-selection relayout (the very thing the report complains about).

### If instead the harness shows a border-measurement delta, fix the cache seam

In the (per static analysis, unlikely) event the harness shows the list rect itself changing width by the border amount, the root cause would be a stale `_borderWidths` read: a measurement taken on the **pre-attach estimate** path that was never invalidated after connect. The fix is then to invalidate `_borderWidths` once on connect so the first connected measurement is authoritative — without widening any public API. The plan keeps this branch documented but secondary; the static + live evidence points to the scrollbar branch.

---

## Ordered Implementation Steps

1. **Build the reproduction harness (gate).** In the running Split demo, drive the lower-left list at a viewport short enough that 13 rows overflow the pane (the inner panel's `scrollHeight > clientHeight`). Capture, before and after selecting a row that is initially off-screen (forcing `scrollIndexIntoView` to scroll):
   - the list root rect, the inner panel's `clientWidth` / `offsetWidth`, and `scrollHeight > clientHeight`;
   - the sibling textarea / slider rects and every `.SplitGutter` rect.
   Record which box changes and by how many pixels. → verify: a non-zero delta is observed and attributed to a specific box (scrollbar gutter on the inner panel, vs. the list root's border).

2. **Apply the fix indicated by Step 1.**
   - **Scrollbar branch (expected):** on the inner scroll `Panel` constructed in `AbstractCustomList` ([`AbstractCustomList.ts:473`](../src/typescript/lib/component/list/AbstractCustomList.ts#L473)), reserve a stable scrollbar gutter so the row viewport `clientWidth` does not change when the vertical scrollbar appears/disappears, using the framework's existing inline-style setter seam (no new typed property unless a setter already exists for it). Keep the change to the inner panel only; do not touch the list root's border or the Split.
   - **Border branch (fallback):** if Step 1 shows the list root's own width oscillating by the border width, invalidate the cached `_borderWidths` on connect in [`Component.ts`](../src/typescript/lib/core/Component.ts) so the first connected `getBorderSize` re-reads `getComputedStyle`, and leave the estimate path for the disconnected case. Do not add public API.
   → verify: re-run the Step 1 harness; the previously-observed delta is now 0.

3. **Regression-guard the surrounding layout.** Re-run the harness selecting several rows in sequence (first, middle, last, off-screen) and confirm the list rect, textarea/slider rects, and all gutter rects are byte-stable across every selection. → verify: every rect delta is 0 px across the full sequence.

4. **Confirm scope hygiene.** `grep -rn "min-height\|setMinSize" src/typescript/lib/component/list/` — expect this plan's diff to contain **no** min-height/min-size change (that belongs to `component-sizing-constraints.md`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify (scrollbar branch) | `src/typescript/lib/component/list/AbstractCustomList.ts` |
| Modify (border fallback branch only) | `src/typescript/lib/core/Component.ts` |

Exactly one branch is implemented, per Step 1's finding. No new files; nothing deleted.

---

## Verification

- **Reproduction harness (primary):** the Step 1 before/after geometry probe on the Split demo lower-left list, run at an overflow-inducing viewport. Success: every measured rect (list root, inner panel `clientWidth`, textarea, slider, all `.SplitGutter`s) is identical before and after each selection and across a multi-row selection sequence.
- **No per-selection relayout:** selecting a row must not produce a visible shift in the surrounding split panes — the stated success criterion.
- **Typecheck:** `npm run build` (or the project's type-check task) passes.
- **Theme toggle:** toggle light/dark on the Split demo and reselect — no shift in either theme (guards against a var()-resolved border or scrollbar color re-entering the measurement).
- **Scope grep:** `grep -rn "min-height\|setMinSize" src/typescript/lib/component/list/` shows no addition from this change.
- **Demo screen:** the **Split** tab in the dev app (`http://localhost:8015`, `npm run dev`).

---

## Potential Challenges

- **Viewport dependence.** The shift did not reproduce at the wide default viewport; the harness must force inner-panel overflow or the fix can't be confirmed — mitigate by sizing the window short before probing.
- **Sub-pixel shifts.** The delta may be < 1 px (scrollbar gutter / fractional pane widths); measure with `getBoundingClientRect` to two decimals, not integer `offsetWidth`.
- **Native scrollbar variance.** Scrollbar width differs across platforms/overlay-scrollbar settings; reserving a stable gutter must not assume a fixed scrollbar width — mitigate by using a gutter-stable CSS strategy rather than a magic pixel constant.
- **Picking the wrong branch.** Static + live evidence favors the scrollbar branch; the border fallback exists only if Step 1 contradicts that. Do not implement both.

---

## Critical Files

- [`src/typescript/lib/component/list/AbstractCustomList.ts`](../src/typescript/lib/component/list/AbstractCustomList.ts) — inner scroll `Panel` construction (`autoScroll: "y"`, `VBox`), `scrollIndexIntoView`, `refreshRowVisualState`, the `.List:focus::after` / `.selected` / `.focused` style rules, and the `ROW_HEIGHT_PX` row chrome.
- [`src/typescript/lib/layout/Split.ts`](../src/typescript/lib/layout/Split.ts) — `doLayout` / `recalculateSizes`; confirms panes are sized from the cached `_sizes` map, not from List measurement.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — `getInnerSize`, `getPerimiterSize`, `getBorderSize` (cache + estimate seam), `setBorder` (cache invalidation), default `box-sizing: border-box`, `scheduleLayout`/`flushLayout`.
- [`src/typescript/SplitPanel.ts`](../src/typescript/SplitPanel.ts) — the exact demo wiring under test (vertical outer split, horizontal south split, 13-item list).

---

## Non-Goals

- **List `min-height` / min-size.** Owned by `component-sizing-constraints.md`; duplicating it here would collide on `AbstractCustomList`.
- **Reworking the `Split` sizing model** (`_sizes` proportional redistribution). The Split is confirmed not to be the trigger; touching it is out of scope.
- **New public API.** Both fix branches stay on existing setters / private cache fields; no new typed property, option field, or exported symbol — so no documentation impact.
