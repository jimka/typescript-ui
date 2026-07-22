# Tab Closeable-Label Squeeze in Shared-Cell Modes — Implementation Plan

## Overview

On a `TabBar`, when several tabs share one uniform cell size and only *some* are closeable, the closeable tabs render their label in less space than the non-closeable ones. Every tab gets the same cell, but the close-button reservation is subtracted (as a button inset) only from closeable tabs, so a closeable tab spends part of its shared cell on the reserve while a non-closeable tab spends all of it on the label.

The symptom is loudest with rotated text on a west/east strip, where the label runs the long way down a tall cell and the reserve is a big fraction of it. Measured in the Tab demo (west side, `vertical-cw`, `equal` width mode, strip too short to fit all tabs at natural size): every cell is 45px tall, a non-closeable label gets 29px, a closeable label gets 13px (`45 − 8 top − 24 bottom = 13`). The same asymmetry exists — less visibly — for upright text and for north/south strips whenever the tabs share a cell.

The reservation itself is correct: [`computeTabButtonInsets`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1825) reserves `scale.tabClose` on the reading-flow edge for a closeable tab, and [`applyTabButtonStyles`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2291) applies it before every measurement pass. The defect is that a *non-closeable* tab sharing the same cell reserves nothing, so the two tabs devote different amounts of one identical cell to the label.

The fix makes the reservation strip-wide: when a strip contains **any** closeable tab, **every** tab reserves the close-button gutter. Non-closeable tabs get the reserve as blank space, so all labels in a shared cell are treated identically. The change is one line in `computeTabButtonInsets`.

---

## Architecture Decisions

### Reserve the close gutter on every tab when the strip has any closeable tab

`computeTabButtonInsets` adds the `scale.tabClose` reservation to a tab's inset when *that* tab is closeable **or** when any tab in the strip is closeable.[^why-uniform] This is the only change needed: the reservation already flows through the button's insets into its preferred/min size and into the shared-cell arithmetic, so making it uniform makes every tab's label clearance uniform in every width mode and every space regime.

This mirrors the function's neighbour [`applyTabButtonStyles`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2291), which already feeds a **strip-wide** fact (`this._orientation`, `this._textAlign`) into each tab button's styling in the same loop that calls `computeTabButtonInsets`.[^precedent] The close-reservation becomes another strip-wide fact fed into the same per-tab inset computation.

### The shared cell size comes from `BoxLayout`'s equal-cell floor, not from `tabModeExtent`

The uniform cell in the reported scenario is computed by [`VBox.computeEqualCellHeight`](packages/lib/src/typescript/lib/layout/VBox.ts#L365) (the `HBox` twin is `computeEqualCellWidth`), which floors every cell at the tallest child's **min** size when the equal share is too small to fit.[^cell-path] A closeable tab's min size already includes the reserve (via its inset), so the floor is reserve-inclusive — but only the closeable tabs' label space is then reduced by it. This is why a probe placed in `tabModeExtent`'s `"equal"` branch never fired: that branch runs the *non-collapsed* equal path, while the demo hit the collapse-to-fill path where `BoxLayout` sizes the cells. **No change is made to `BoxLayout` or `tabModeExtent`** — fixing the inset makes both non-closeable and closeable tabs contribute the same reserve-inclusive min, so the floor and the per-tab label subtraction agree.

---

## Internal Structure

The whole change is the `closeReserve` line in `computeTabButtonInsets` ([TabBar.ts:1828](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1828)).

Before:

```typescript
const closeReserve = constraints?.closeable ? scale.tabClose : 0;
```

After:

```typescript
// Reserve the close gutter on every tab whenever the strip has any
// closeable tab, so tabs that share one cell devote the same space to
// the reserve — otherwise a closeable tab's label is squeezed by the
// reserve while a non-closeable tab in the same cell keeps it all.
const closeReserve = (constraints?.closeable || this.stripHasCloseable()) ? scale.tabClose : 0;
```

New private helper (place it next to `computeTabButtonInsets`):

```typescript
/**
 * Reports whether any tab in the strip is closeable — the strip-wide flag
 * that makes {@link computeTabButtonInsets} reserve the close gutter on
 * every tab, so tabs sharing one cell give their labels equal clearance.
 *
 * @returns True when at least one entry carries `closeable` constraints.
 */
private stripHasCloseable(): boolean {
    return this._entries.some(entry => entry.constraints?.closeable === true);
}
```

`computeTabButtonInsets` is called from two sites: [`createBarEntry`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1496) (an initial value, before the new entry is pushed to `_entries`) and [`applyTabButtonStyles`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2300) (re-derived for every tab on every layout pass). The strip-wide flag is finalised by the `applyTabButtonStyles` pass, which runs before each measurement — the same "initial value, then corrected on the first layout pass" pattern the close-button sizing already uses.[^createbarentry-timing]

---

## Ordered Implementation Steps

1. **Add the helper.** In [TabBar.ts](packages/lib/src/typescript/lib/component/container/TabBar.ts), add the private `stripHasCloseable()` method (shown above) immediately before `computeTabButtonInsets` (~line 1825).

2. **Widen the reservation.** In `computeTabButtonInsets` (~line 1828), change the `closeReserve` assignment to OR in `this.stripHasCloseable()`, with the explanatory comment (shown above).

3. **Update the method doc.** `computeTabButtonInsets`'s JSDoc (~line 1809) says "closeable tabs additionally reserve the … close-button box". Change it to state that the reserve is applied to **every** tab when the strip contains any closeable tab, so labels sharing a cell get equal clearance. Keep the rest of the doc (the per-orientation edge description) intact.

4. **Typecheck.** `npm -w packages/lib run typecheck` — expect zero errors.

5. **Add the offline test** described in `## Expected Behaviour` (new file `packages/lib/tests/component/container/TabCloseableLabelSqueeze.test.ts`). It is written against the fixed contract and must pass once steps 1–2 are applied.

6. **Run the tab suites.** `npx vitest run tests/component/container tests/component/button tests/layout` — expect all green, including the existing `TabCloseGlyphCentring.test.ts`.

7. **Full suite.** `npx vitest run` — expect all green (baseline is 2861 passing).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Create | `packages/lib/tests/component/container/TabCloseableLabelSqueeze.test.ts` |

---

## Expected Behaviour

Terms: a tab's **label clearance** is its cell extent minus its insets on the reading axis — the space the label actually gets. "Shared-cell modes" are `fill` (always one uniform cell) and `equal` when the strip is too small to fit tabs at natural size (it collapses to uniform cells); `fixed` also shares one cell (`fixedWidth`).

All cases below are for a strip that contains at least one closeable tab **and** at least one non-closeable tab.

**Automatable offline** — driven exactly like [`TabCloseGlyphCentring.test.ts`](packages/lib/tests/component/container/TabCloseGlyphCentring.test.ts): host a `Tab` (or a bare `TabBar`) in a sized `Container`, add closeable and non-closeable children, run `host.doLayout()`, and read geometry off the bar's private `_entries` (cast through `unknown`). Layout and sizing geometry are modelled by the offline DOM harness (`installTestDOM`).

1. **Insets are uniform (mechanism).** After a layout pass, every tab button's insets on the reading-flow edge are identical whether or not the tab is closeable. Read via the public `entry.button.getInsets()`. Concretely, west + `vertical-cw`: both a closeable and a non-closeable tab report the same bottom inset (`scale.tabClose + scale.tabButtonInset * 2`), where before the fix the non-closeable tab's bottom inset was only `scale.tabButtonInset * 2`.

2. **Equal label clearance in a shared cell (symptom).** West side, `vertical-cw`, `equal` width mode, strip short enough to collapse to uniform cells: a closeable tab and a non-closeable tab render the **same** label extent. Read the label height off the button's content region (private `_content`, reached by the same cast the sibling test uses for `_entries`). Before the fix these differed (e.g. 13 vs 29); after, they are equal. Assert equality, not a magic number — the exact value depends on the harness font metrics.

3. **Counter-clockwise reserves the top edge.** West side, `vertical-ccw`, same collapse: the uniform reservation lands on the **top** inset (the end of a bottom-to-top reading flow), and closeable/non-closeable top insets are equal. Assert the top inset carries the reserve and the bottom does not.

4. **North/south upright text.** North side, `fill` width mode, strip narrow enough that tabs share sub-natural cells: closeable and non-closeable tabs get equal label width; the reserve sits on the **right** inset for both.

5. **Empty of closeable tabs → no reservation.** A strip with only non-closeable tabs reserves nothing on any tab (the OR is false), so tab insets are unchanged from today. Assert a non-closeable tab in an all-non-closeable strip has no close reserve on its reading-flow edge.

6. **Roomy content mode keeps labels natural.** West side, `vertical-cw`, `content` width mode, strip tall enough for every tab at natural size: no label is clipped — closeable and non-closeable labels both render at their natural extent. (After the fix, non-closeable cells grow by the reserve to hold the now-uniform blank gutter; the labels themselves are unclipped.) Assert no label is smaller than its own natural (unrotated) content extent.

**Manual verification** — the reported live scenario, since a real browser (not the modelled sink) is where the rotated vertical label is visually confirmed:

- Run `npm run dev`, open the **Tab demo panel**, set **side = west** and **orientation = vertical-cw**. Before the fix, closeable tabs (Beta, Gamma, Tab 4) show a visibly shorter label than non-closeable tabs (Alpha, Lazy, Async). After the fix, all six labels have the same length and the ✕ sits in a consistent gutter at the bottom of every closeable tab. Repeat with **orientation = vertical-ccw** (gutter and equal labels at the top) and **side = east**.

---

## Verification

- `npm -w packages/lib run typecheck` — zero errors.
- `npx vitest run tests/component/container/TabCloseableLabelSqueeze.test.ts` — the new test (cases 1–6) passes.
- `npx vitest run tests/component/container tests/component/button tests/layout` — all green; `TabCloseGlyphCentring.test.ts` still passes (the close-button centring is untouched).
- `npx vitest run` — full suite green (baseline 2861 passing).
- Manual: Tab demo panel, west + vertical-cw / vertical-ccw, per `## Expected Behaviour`.

---

## Potential Challenges

- **`createBarEntry` orders the initial inset before the entry is in `_entries`.** The initial `computeTabButtonInsets` call at entry creation cannot see the entry it is building (it is pushed later). This is harmless: `applyTabButtonStyles` re-derives every tab's insets before the first measurement pass, so the strip-wide flag is correct by the time anything is measured — verified because the offline test asserts post-`doLayout()` geometry and passes.
- **Non-closeable cells widen in roomy content/fixed modes.** A non-closeable tab now carries a blank reserve gutter, so in `content`/`fixed` modes its cell grows by `scale.tabClose`. This is intended (uniform label clearance across the strip) and consistent with the reserve already being mode-independent; it is not a regression to fix.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/container/TabBar.ts`](packages/lib/src/typescript/lib/component/container/TabBar.ts) — `computeTabButtonInsets` (~1825, the change), `applyTabButtonStyles` (~2291, the strip-wide precedent and the re-derivation site), `createBarEntry` (~1485, the other call site).
- [`packages/lib/src/typescript/lib/layout/VBox.ts`](packages/lib/src/typescript/lib/layout/VBox.ts) — `computeEqualCellHeight` (~365), where the shared cell floor is computed (read-only; explains why the fix works without touching the layout manager). `HBox.computeEqualCellWidth` is the north/south twin.
- [`packages/lib/tests/component/container/TabCloseGlyphCentring.test.ts`](packages/lib/tests/component/container/TabCloseGlyphCentring.test.ts) — the offline-harness pattern the new test copies (host a `Tab`/`TabBar`, `doLayout`, read `_entries`).
- [`packages/lib/src/typescript/lib/component/button/TabButton.ts`](packages/lib/src/typescript/lib/component/button/TabButton.ts) — the tab button; its insets are what carry the reserve.

---

## Non-Goals

- **No change to `BoxLayout` / `HBox` / `VBox`.** The shared-cell arithmetic is correct once every tab reports a reserve-inclusive size; the manager is not the defect.
- **No change to `tabModeExtent` or the `"equal"` non-collapsed path.** Its uniform extent already takes the max preferred main extent, which is reserve-inclusive; it is not the code path that squeezes.
- **No change to close-button positioning or glyph centring.** `positionCloseButtons` and the `TabButton.buildCloseButton` construction-time sizing (the already-fixed centring bug on the base branch) are untouched.
- **No new `TabBarOptions` / public API.** The behaviour is intrinsic to how a strip with closeable tabs lays out; there is no consumer knob to add.

---

## Notes

[^why-uniform]: Two other shapes were considered and rejected. **(a) Grow the shared cell to a worst-case (reserve-inclusive) size instead of adding the reserve to non-closeable tabs.** This fails the exact reported scenario: the demo strip is space-constrained (six tabs collapse into a strip too short for their natural sizes), so there is no room to grow the shared cell — the cell is already at the min floor. Growing also would not equalise: a non-closeable tab with no reserve inset still spends the whole (grown) cell on its label while a closeable tab spends part on the reserve, so the asymmetry persists wherever the cell is tight. **(b) Make a closeable button report a larger preferred main extent.** A closeable button *already* reports a reserve-inclusive preferred and min size (the reserve is in its inset); adding more would not touch the non-closeable tabs, which are the ones keeping the extra label space. Only equalising the inset across all tabs makes the label clearance equal in a shared cell, which is the defect. The chosen fix is also the smallest — one predicate widened.

[^precedent]: `applyTabButtonStyles` ([TabBar.ts:2291](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2291)) loops `this._entries` and applies strip-wide state to each tab button: the writing mode derived from `this._orientation`, and `this._textAlign`. It already calls `computeTabButtonInsets(entry.constraints)` inside that same loop. Feeding a strip-wide "any tab closeable" fact into that inset computation is the same shape as feeding the strip-wide orientation into each button's writing mode — the precedent is the function the change lives next to. Confirmed by searching the tab-strip sizing pipeline (`computeTabButtonInsets`, `applyTabButtonStyles`, `stripThickness`, `applyTabWidths`, `tabModeExtent`) for how per-tab styling is derived from strip-wide state.

[^cell-path]: Traced empirically in the throwaway worktree by instrumenting a real layout pass. In the demo configuration (`equal` mode, strip shorter than the tabs' summed natural extent), `applyTabWidths` takes the "equal shrinks to fit" collapse ([TabBar.ts:2132](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2132)): it sets the clip box to `"equal"` mode and clamps each wrapper to `[0, MAX_VALUE]`. `VBox.computeEqualCellHeight` then computes `equalShare = innerHeight / count`; when that is below the tallest child's min height (it is — a closeable tab's reserve-inclusive min is 45px, the equal share ~33px), and the host is not scrolling, it returns `maxChildMinHeight` (45px). Every cell is therefore 45px, and the per-tab inset alone decides how much of it the label gets — 13px for a closeable tab (8 top + 24 bottom reserve), 29px for a non-closeable tab (8 + 8). The fix makes the non-closeable tab's bottom inset 24 too, so both labels get 13px and, crucially, both contribute the same 45px min so the floor is coherent. A probe in `tabModeExtent`'s `"equal"` branch never fired because that branch only runs the non-collapsed equal path.

[^createbarentry-timing]: `createBarEntry` calls `computeTabButtonInsets` at [TabBar.ts:1496](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1496), before pushing the new entry to `_entries` at line 1532, so `stripHasCloseable()` cannot observe the entry being created. This only affects the transient value set at construction; `prepareStrip` → `applyTabButtonStyles` re-derives every tab's insets from the full `_entries` before each measurement pass, so the strip-wide flag is correct by the time the strip is measured or painted. The same "set an initial value at construction, finalise on the first layout pass" shape is already used for the close-button size (`TabButton.buildCloseButton` sizes it at construction; `positionCloseButtons` re-pins it each layout).
