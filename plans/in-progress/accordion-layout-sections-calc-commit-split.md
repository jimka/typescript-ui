# Accordion `layoutSections` Calculate-Then-Commit Split — Implementation Plan

## Overview

[`plans/implemented/layout-calc-commit-split.md`](implemented/layout-calc-commit-split.md) — this plan calls it **the sweep** — converted six layout managers from an interleaved "resolve one child, write it, move to the next" loop into a calculate-then-commit shape: resolve every child's placement into an array first, then commit the array in one trailing pass. It excluded [`Accordion`](../packages/lib/src/typescript/lib/layout/Accordion.ts) for a structural reason only — Accordion writes `setX`/`setY`/`setWidth`/`setHeight` directly and never routes through the shared `LayoutManager.placeComponent`/`commitBounds` seam the other six managers share, so it was never evaluated for the same split on its own terms.

This plan carries out that evaluation, aimed at [`Accordion.layoutSections`](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1616) ([:1616–1710](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1616)) — the method that places every section's header, wrapper, and content, and the resizable gutters between open pairs. **Conclusion: the split is mechanically safe, but this plan does not implement it.** Like the sweep it would extend, this split has no live bug behind it and no measured performance gain — the only possible payoff is stylistic consistency with the six already-converted managers. Weighed against that: `layoutSections` folds in more than a bounds write (gutter placement, per-section animation bookkeeping, an open/closed visibility toggle), so a calculate-then-commit split here would defer coordination decisions, not just geometry, for a worse conceptual fit than any of the six managers the sweep already converted — and it would do so inside a method under active, unlanded development elsewhere in this codebase right now. This plan makes no source changes.

---

## Architecture Decisions

### The split would be mechanically safe

Every value `layoutSections` computes before a write — the running `y` cursor, each section's `panelHeight`/`contentHeight`, the gutter's `upperBottom`, and the pre-write `oldHeight` used to detect a shrink — is either pure arithmetic or a read of the *target* component's own cached state, never a read of another component's post-commit geometry. Deferring every section's writes to a trailing pass, the way the sweep's `commitPlacements` does, would not change any of these values.[^safety]

### Not implemented: no benefit to weigh against the cost of touching a live method

`layoutSections` is not implemented as calculate-then-commit because nothing today asks for it: no DOM read happens between one section's write and the next section's resolve, so there is no interleaving bug to fix, and no skip-unchanged or batching optimization is planned on top of it. The only thing on the other side of the ledger is a structural cost specific to this method: unlike `Grid`'s clip-frame flag or `Split`'s clip-path string — each a single extra field riding along a plain bounds write — `layoutSections`'s per-section "commit" step *is* the coordination logic (gutter placement and pooling, the open/closed visibility toggle, the shrink-vs-immediate-reflow decision backed by `_shrinkAnimations`), so a resolved-array record would have to carry most of the method's state to mean anything, and the method would still read exactly as much like a state machine as it does today, just spread across two passes instead of one.[^cost-detail]

---

## Ordered Implementation Steps

None. The investigation in `## Architecture Decisions` concluded against implementing the split, so there is nothing to build.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| None | — see `## Non-Goals` |

---

## Non-Goals

- **No changes to `Accordion.ts`, or to any file.** This plan concludes against implementing the split it investigated; there is nothing to build.
- **No change to `LayoutManager.ts`'s `ResolvedPlacement`/`commitPlacements` seam.** Per `layout-calc-commit-split.md`'s own exclusion, Accordion doesn't route through it, and this plan doesn't reopen that.
- **`Border.ts` is out of scope and was not re-investigated.** Its exclusion from the original sweep (`layout-calc-commit-split.md`, "`### Border is left unchanged`" and its `[^border]` footnote) is a separately-reasoned, still-valid conclusion this plan treats as settled.
- **`Table`**, the sweep's other excluded manager, is also out of scope — its exclusion (reads an earlier sibling's committed geometry to size a later one) is unrelated to Accordion and was not re-examined here.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/Accordion.ts`](../packages/lib/src/typescript/lib/layout/Accordion.ts) — the method investigated. `layoutSections` ([:1616–1710](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1616)), `doLayout` ([:1512–1594](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1512)), `placeSection` ([:1482–1506](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1482)), `placeGutter` ([:1757](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1757)), `getOrCreateResizeGutter` ([:1725](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1725)), `onGutterDrag` ([:1829](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1829)), `_shrinkAnimations` ([:214](../packages/lib/src/typescript/lib/layout/Accordion.ts#L214)).
- [`plans/implemented/layout-calc-commit-split.md`](implemented/layout-calc-commit-split.md) — the sweep this plan evaluates Accordion against, including Accordion's original exclusion and the `Border` exclusion this plan does not revisit.
- [`plans/implemented/hbox-vbox-layout-calc-commit-split.md`](implemented/hbox-vbox-layout-calc-commit-split.md) — the pilot the sweep mirrors, including its `## Implementation Notes` recording five separate rounds of audit-caught site-inventory misses on the two *simplest* managers in scope — cited here as evidence that even a mechanically safe split of this shape is error-prone in practice in this codebase, which raises the bar for taking one on without a benefit to justify the risk.
- [`plans/implemented/accordion-resizable-drag-perf-and-snap.md`](implemented/accordion-resizable-drag-perf-and-snap.md) — extracted `placeSection`/`placeGutter` from `doLayout` and generalized `layoutSections` to serve both the full layout pass and the chained drag path; fixed two real bugs rooted in exactly this method's write-ordering (the pre-write `oldHeight` read, a toggle-animation counter racing to zero). Establishes that this method's fragility is demonstrated, not hypothetical.
- [`plans/accordion-gutter-drag-coalescing.md`](accordion-gutter-drag-coalescing.md) — an approved, not-yet-implemented plan (a worktree for it already exists at `.worktrees/accordion-gutter-drag-coalescing`) that reads `layoutSections`, `onGutterDrag`, and `getOrCreateResizeGutter` as critical files and cites their current line numbers throughout, while explicitly leaving `layoutSections`'s body untouched ("this plan changes only how often that path runs"). Evidence that this file is under active near-term development elsewhere, which is part of why a benefit-free restructuring of the same method is poorly timed even where it would be safe.
- [`packages/lib/src/typescript/lib/core/Animation.ts`](../packages/lib/src/typescript/lib/core/Animation.ts) — `afterTransition` ([:289–341](../packages/lib/src/typescript/lib/core/Animation.ts#L289)), read in full to confirm it performs no DOM read and has no dependency on any other element's state, which is what makes its registration order-independent across sections.
- [`packages/lib/src/typescript/lib/core/Component.ts`](../packages/lib/src/typescript/lib/core/Component.ts) — `getHeight`/`setHeight` ([:4136](../packages/lib/src/typescript/lib/core/Component.ts#L4136), [:4155](../packages/lib/src/typescript/lib/core/Component.ts#L4155)) and the backing `_height` field ([:496](../packages/lib/src/typescript/lib/core/Component.ts#L496)), confirming `getHeight()` reads cached JS state, not a live DOM measurement — the basis for [^safety] below.

---

## Notes

[^safety]: Three checks confirm the split's safety, mirroring the reasoning `layout-calc-commit-split.md` already relies on for the six converted managers (its own `[^ordering]` footnote: "Children are independent subtrees, so a sibling's commit doesn't change another's reported size").

    **The pre-write height read is safe to hoist.** `layoutSections` reads `const oldHeight = component.getHeight()` ([Accordion.ts:1672](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1672)) immediately before `placeSection` overwrites that same component's height, to detect a shrink. `getHeight()` returns a cached `_height` field ([Component.ts:496](../packages/lib/src/typescript/lib/core/Component.ts#L496), read at [:4136–4143](../packages/lib/src/typescript/lib/core/Component.ts#L4136)) that only that component's own `setHeight` call can change ([:4155](../packages/lib/src/typescript/lib/core/Component.ts#L4155)) — so hoisting every section's `oldHeight` read into a single resolve pass that runs before any section's write, instead of reading it once per section immediately before that section's own write, returns identical values. The same holds for the `component.isDisplayed()` check ([Accordion.ts:1638](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1638)) that decides whether a section drops out of the stack entirely — also a cached-flag read ([Component.ts:2341](../packages/lib/src/typescript/lib/core/Component.ts#L2341)), not a DOM query.

    **The cursor and gutter geometry are pure arithmetic.** The running `y` cursor and the `previousOpenComponent`/`previousOpenBottom` state that positions each resizable gutter ([Accordion.ts:1625–1701](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1625)) advance from `placeSection`'s *return value* (`wrapperTop + panelHeight`, computed from arguments — [:1505](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1505)), never from a live-measured position. A resolve pass could walk the same sequence and compute the same numbers with zero writes committed yet, exactly like `HFlow.groupIntoRows`'s cell records do today.

    **The animation registration has no cross-section dependency.** The shrink branch calls `Animation.afterTransition({ component: wrapper, property: "height", ... })` ([Accordion.ts:1680](../packages/lib/src/typescript/lib/layout/Accordion.ts#L1680)). Read in full, `afterTransition` ([Animation.ts:289–341](../packages/lib/src/typescript/lib/core/Animation.ts#L289)) only calls `config.component.getElement()` and registers a `transitionend` listener plus a fallback `setTimeout` — it performs no DOM read (no `getComputedStyle`, no forced reflow) and touches no other component. It only needs its *own* section's height write to have already landed so the CSS transition it is listening for actually starts; it has no opinion about whether any other section has been written yet. Deferring every section's write-then-animate-decision into one trailing commit pass, in the same per-section order the loop uses today, changes nothing this depends on.

    None of this required inventing a new argument — it is the same "resolve reads only pure/independent state" contract the sweep already established, checked directly against this method's actual reads rather than assumed.

[^cost-detail]: The record a calculate-then-commit split would need is qualitatively different from anything in the sweep. `GridPlacement` and `SplitPlacement` each add exactly one field to the shared `ResolvedPlacement` — a clip decision riding along an otherwise-plain bounds write ([layout-calc-commit-split.md](implemented/layout-calc-commit-split.md), "`### A manager with an extra per-child write keeps a file-local record`"). A file-local Accordion record would need to carry, per section: whether it's hidden (and thus skips placement entirely), its resolved `top`/`panelHeight`/`contentHeight`, whether a gutter precedes it and that gutter's geometry, the pre-write `oldHeight`, and the resulting shrink/reflow decision — roughly eight fields, most of them *decisions* (hidden-or-not, shrink-or-not, gutter-or-not) rather than geometry. Where Grid's and Split's extra field is genuinely incidental to a bounds write, Accordion's record would carry most of what the method computes — the split would relocate this coordination into two passes bridged by a wide record, not simplify it. That relocation is exactly the trade `ARCHITECTURE.md`'s composition guidance rejects when "the mass of the thing is an irreducible coordinator" and the alternative "would merely *relocate* complexity across a … seam rather than remove it" (*Compose before specializing*) — the same logic applies one level down, to splitting a method's own internals.

    Weighed against a relocation with no reduction in complexity: no bug motivates it, and no optimization is waiting to build on top of it (unlike the sweep's six managers, where the resolved array is explicitly left available for a *future*, still-unbuilt skip-unchanged optimization — `layout-calc-commit-split.md`'s own `## Non-Goals`). Meanwhile `Accordion.ts` is demonstrably not a low-traffic file to restructure speculatively: `accordion-resizable-drag-perf-and-snap.md` fixed two real bugs rooted in this exact method's write ordering, and `accordion-gutter-drag-coalescing.md` — approved but not yet implemented, with its own worktree already checked out — cites `layoutSections`'s current shape and line numbers as load-bearing context for work still queued against this file. Restructuring `layoutSections` now buys stylistic consistency at the cost of invalidating that plan's site inventory for no functional gain, on a method this codebase's own history shows is easy to get subtly wrong even when the change is safe in principle (`hbox-vbox-layout-calc-commit-split.md`'s `## Implementation Notes` records five successive audit rounds catching site-inventory misses on `HBox`/`VBox` — two managers with a *simpler*, already-pure calc phase than Accordion's).
