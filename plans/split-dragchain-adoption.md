# Split DragChain Adoption — Implementation Plan

## Overview

Three places in this codebase redistribute a dragged boundary's travel across bounded siblings, nearest-first, with min/max clamping: [`Split.onDrag`](packages/lib/src/typescript/lib/layout/Split.ts#L1030), [`Accordion.onGutterDrag`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1829), and [`Table.onColumnResize`](packages/lib/src/typescript/lib/component/table/Table.ts#L2167). The last two share [`core/DragChain.ts`](packages/lib/src/typescript/lib/core/DragChain.ts)'s `chainRoom`/`distributeDragChain`, which fan a drag's travel out across an arbitrary number of siblings. `Split` alone still has its own two-neighbor clamp.

This plan investigates whether `Split` is really just the N=2 case of what `DragChain` generalizes, or a genuinely different mechanism that happens to also be simpler. It concludes the latter: **`Split` should not be migrated.** The two designs solve structurally different problems, and `Split`'s closed-form clamp already gets a property `DragChain`'s incremental model has to rebuild by hand. The only change this plan makes is two short doc-comment additions that record the decision, so a future reader doesn't rediscover the same question and propose the same migration again. It also audits both clamps against the codebase's established "minimum wins over maximum" rule and finds both already comply — no correctness fix is needed there either.

---

## Architecture Decisions

### `Split`'s clamp is a closed form for a case that never exceeds two neighbors — not a `DragChain` candidate

`Split.onDrag` ([Split.ts:1030](packages/lib/src/typescript/lib/layout/Split.ts#L1030)) keeps its own two-line closed-form clamp instead of adopting `chainRoom`/`distributeDragChain` from [`core/DragChain.ts`](packages/lib/src/typescript/lib/core/DragChain.ts). A Split boundary only ever has exactly two neighbors — `container.getLaidOutComponents()[gutterIdx]` and `[gutterIdx + 1]` ([Split.ts:1032-1033](packages/lib/src/typescript/lib/layout/Split.ts#L1032)) — so there is no chain to fan out across, and the closed form already reproduces everything `DragChain` would add.[^no-migrate]

### Both clamps already put the minimum ahead of the maximum — no fix needed

Split's clamp and DragChain's room arithmetic both already follow the codebase's rule that a component's minimum wins over its maximum when the two conflict (`plans/implemented/layout-manager-clamp-and-rounding-fixes.md`, `plans/implemented/box-child-clamp-ordering.md`). Neither file needs a change for this.

**Split**, isolating `lhs`'s own bound by giving `rhs` an unconstrained `[0, Infinity]` range (so `loLhs` reduces to `minLhs` and `hiLhs` to `maxLhs`, [Split.ts:1052-1053](packages/lib/src/typescript/lib/layout/Split.ts#L1052)):

| `minLhs` | `maxLhs` | requested `newLhs` | `Math.max(loLhs, Math.min(hiLhs, x))` result | Reading |
|---|---|---|---|---|
| 40 | 200 | 120 | 120 | ordinary case |
| 40 | 200 | 10 | 40 | floored to min |
| 40 | 200 | 900 | 200 | capped to max |
| **120** | **47** | *(any value)* | **120** | **min wins** |

Only the last row is the conflict case, and the outer `Math.max` already returns the minimum there — the same cap-then-floor order `plans/implemented/layout-manager-clamp-and-rounding-fixes.md` fixed everywhere else.

**DragChain** never performs a cap-then-floor step of its own — it measures *room* off `current[pos]`, which is the component's own already-committed size, itself floored to the minimum first by `Component.clampWidth`/`clampHeight`:

| `current` | `min` | `max` | growRoom `max(0, max−current)` | shrinkRoom `max(0, current−min)` | Effect |
|---|---|---|---|---|---|
| 120 *(already pinned at its own min by `clampHeight`)* | 120 | 47 | 0 | 0 | immovable — stays at its min in either direction |

A component resting at a minimum above its own maximum reports zero room both ways and simply never moves. The convention is inherited from each component's own clamp, not re-implemented by `DragChain` — so there is nothing to fix here either.[^clamp-audit]

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/layout/Split.ts`** — in `onDrag`'s doc comment ([Split.ts:1013-1029](packages/lib/src/typescript/lib/layout/Split.ts#L1013)), append one paragraph to the existing `@remarks` block, after "...preserves the user-defined split ratio.", stating that this clamp is deliberately not `core/DragChain.ts`'s N-way mechanism: a Split boundary always has exactly two neighbors, and recomputing from the fixed drag origin every move already keeps the pointer glued to the gutter on reversal, which `DragChain`'s incremental model has to rebuild by hand. Refer to `core/DragChain.ts`, `Accordion`, and `Table` as plain text, never `{@link}` — `Accordion.onGutterDrag` and `Table.onColumnResize` are both `private`, and `core/DragChain.ts` is not re-exported from any barrel, so a `{@link}` to any of them from this public method's JSDoc would violate the "don't `{@link}` internal symbols from public JSDoc" rule (`CODE_CONVENTIONS.md`) and fail `npm run docs:api`.
2. **`packages/lib/src/typescript/lib/core/DragChain.ts`** — append one sentence to the file-level doc comment ([DragChain.ts:1-15](packages/lib/src/typescript/lib/core/DragChain.ts#L1)) noting that `Split`'s two-neighbor gutter drag is deliberately not a third caller, and pointing at `Split.onDrag`'s own remarks for why. Plain text only, same reason as step 1 (this file's own doc comment is not itself public API, but the symbols it would name still are not linkable).
3. **Grep checkpoints:**
   - `grep -n "DragChain" packages/lib/src/typescript/lib/layout/Split.ts` — expect exactly one match: the new prose reference. Confirms no `import` was added.
   - `grep -n "{@link" packages/lib/src/typescript/lib/layout/Split.ts` — the new paragraph must add none.
   - `grep -n "Split" packages/lib/src/typescript/lib/core/DragChain.ts` — expect matches only inside the file-level doc comment.
4. **Run `## Verification`.**

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/src/typescript/lib/core/DragChain.ts` |

---

## Verification

- `npm run lint` in `packages/lib` — clean; both edits are doc-comment-only.
- `npm run docs:api` in `packages/lib` — zero warnings, confirming the new `Split.onDrag` remarks paragraph introduces no broken or non-public `{@link}`.
- `npx vitest run tests/component/layout/Split.test.ts` in `packages/lib` — the existing suite, including the min-equals-max / gutter-drag-cap cases at [Split.test.ts:710-750](packages/lib/tests/component/layout/Split.test.ts#L710), passes unchanged. Nothing here should move: no runtime code changes.
- `npm run typecheck` in `packages/lib`.

---

## Documentation Impact

- `Split.onDrag`'s rendered `@remarks` block (public API, on the `Split` class page) gains one paragraph. No exported symbol is added, removed, or renamed, so no barrel, catalog, or sidebar entry changes.
- `core/DragChain.ts` stays un-barreled and internal, matching the precedent set in `plans/implemented/table-chained-column-resize.md`'s own Documentation Impact section: its file comment does not render in the generated API docs, so the added sentence there has no effect beyond keeping `npm run docs:api` clean.

---

## Potential Challenges

- **A future `Split` feature needing a boundary to see past its two immediate neighbors.** None exists today: `this._gutters.indexOf(gutter)` always pairs `components[gutterIdx]` with `components[gutterIdx + 1]` ([Split.ts:998-1000](packages/lib/src/typescript/lib/layout/Split.ts#L998), [Split.ts:1031-1033](packages/lib/src/typescript/lib/layout/Split.ts#L1031)), so the two-neighbor limit is structural, not incidental. Treat any such future requirement as a fresh design decision, not a reason to generalize pre-emptively now.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/layout/Split.ts:985-1078`](packages/lib/src/typescript/lib/layout/Split.ts#L985) | `onDragStart`/`onDrag` — the closed-form clamp this plan leaves in place, and the site of the one doc-comment edit. |
| [`packages/lib/src/typescript/lib/core/DragChain.ts`](packages/lib/src/typescript/lib/core/DragChain.ts) | `chainRoom`/`distributeDragChain` — the shared N-way mechanism `Split` is not adopting, and the site of the other doc-comment edit. |
| [`packages/lib/src/typescript/lib/layout/Accordion.ts:1807-1924`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1807) | `onGutterDrag` — the precedent `DragChain` was built to serve, including the comment crediting Split's absolute-origin model with getting the dead-zone property "for free" ([Accordion.ts:1890](packages/lib/src/typescript/lib/layout/Accordion.ts#L1890)). |
| [`packages/lib/src/typescript/lib/component/table/Table.ts:2113-2237`](packages/lib/src/typescript/lib/component/table/Table.ts#L2113) | `onColumnResize` — the other `DragChain` caller, and the one that used to share `Split`'s absolute-origin model before it needed N-way chaining. |
| `plans/implemented/table-chained-column-resize.md` | Footnotes `[^mirror]` and `[^incremental]` state directly why `Split`/`Border` are excluded from the chain model, and why the absolute-origin form cannot express one. |
| `plans/implemented/resize-min-size-deadzone.md` | The plan that put `Split`'s current absolute-origin clamp in place (alongside `Window` and, at the time, `Table`). |
| `plans/implemented/layout-manager-clamp-and-rounding-fixes.md`, `plans/implemented/box-child-clamp-ordering.md` | Establish the minimum-wins-over-maximum rule this plan audits both clamps against. |
| [`packages/lib/tests/component/layout/Split.test.ts:710-750`](packages/lib/tests/component/layout/Split.test.ts#L710) | Existing coverage already pinning the min/max drag-clamp cases this plan confirms are correct and leaves untouched. |

---

## Non-Goals

- **Migrating `Split.onDrag` to `core/DragChain.ts`'s `chainRoom`/`distributeDragChain`.** The explicit conclusion of this plan.
- **Any change to `Split`'s, `Accordion`'s, or `Table`'s runtime drag behavior.** This plan is a documentation-only audit.
- **A shared abstraction spanning the two-neighbor closed form and the N-way chain.** A two-line clamp does not earn one; see `[^no-migrate]`.
- **Validating a `min > max` pair at `Split`'s own setters.** Out of scope, and already an accepted gap per `plans/implemented/box-child-clamp-ordering.md`.

---

## Notes

[^no-migrate]: `Split.onDrag` reads exactly `container.getLaidOutComponents()[gutterIdx]` and `[gutterIdx + 1]` ([Split.ts:1032-1033](packages/lib/src/typescript/lib/layout/Split.ts#L1032)) — a Split gutter's boundary is fixed at construction to two adjacent panes, with no path to a third. `core/DragChain.ts` exists for the opposite case: `Accordion.onGutterDrag` fans a drag across every open section on either side of the gutter ([Accordion.ts:1863-1872](packages/lib/src/typescript/lib/layout/Accordion.ts#L1863)), and `Table.onColumnResize` fans across every column on either side of the dragged edge ([Table.ts:2177-2187](packages/lib/src/typescript/lib/component/table/Table.ts#L2177)) — both genuinely open-ended in N. `plans/implemented/table-chained-column-resize.md` explains why `Table` itself moved off the same absolute-origin clamp `Split` still uses: "The absolute-origin form cannot express a chain. It reconstructs both widths from a snapshot taken at drag start, which works only while exactly two columns move; once the travel can land on any of `n` columns depending on which bounds have been hit along the way, the result depends on the path, not on the endpoints" (footnote `[^incremental]`). That same plan's `[^mirror]` footnote makes the comparison explicit: "`Split` and `Border` gutters move a single boundary between exactly two components and have no chain."

    Migrating would also give up a property `Split` gets for free today. `Split.onDrag` recomputes the clamped size from a fixed drag origin every move ([Split.ts:1047-1056](packages/lib/src/typescript/lib/layout/Split.ts#L1047)), so over-travel past a pane's bound is automatically idempotent — reversing the pointer does nothing until it crosses back over the boundary coordinate. `DragChain`'s incremental per-frame model has no origin to recompute against, so both of its callers rebuild the same behavior by hand with a tracked last-pointer field advanced only by the travel actually applied (`Accordion._dragLastPointer`, [Accordion.ts:1891](packages/lib/src/typescript/lib/layout/Accordion.ts#L1891); `Table._dragLastClientX`, [Table.ts:2229](packages/lib/src/typescript/lib/component/table/Table.ts#L2229)). `Accordion.onGutterDrag`'s own doc comment names this trade-off directly: "(Split/Border get this for free from their absolute origin+offset model.)" ([Accordion.ts:1890](packages/lib/src/typescript/lib/layout/Accordion.ts#L1890)). "Border" there does not add a fourth participant to this comparison: `Border`'s own gutters ([Border.ts:76](packages/lib/src/typescript/lib/layout/Border.ts#L76), `ensureGutter` at [Border.ts:374](packages/lib/src/typescript/lib/layout/Border.ts#L374)) are collapse-only today — non-movable, used only to reveal a collapse chevron, never to redistribute a drag — so `Border` is out of scope for this plan. Migrating `Split` would mean adding this dead-zone bookkeeping, a live min/max snapshot per pane, and a grow/shrink group split — all to reproduce behavior the current ~65-line `onDragStart`/`onDrag` pair ([Split.ts:997-1078](packages/lib/src/typescript/lib/layout/Split.ts#L997)) already has — for a case that structurally never exceeds two entries. That is a net complexity increase for zero behavior change, so this plan rejects the migration. `plans/implemented/resize-min-size-deadzone.md` is the plan that put the current absolute-origin clamp in place for `Split` (alongside `Window` and, at the time, `Table`); `Table` later left that model behind specifically because it needed the N-way chain, while `Split`'s two-neighbor case never has.

[^clamp-audit]: The worked cases in the body isolate `Split`'s own min/max by giving `rhs` an unconstrained `[0, Infinity]` range, so `loLhs` reduces to `minLhs` and `hiLhs` to `maxLhs` ([Split.ts:1052-1053](packages/lib/src/typescript/lib/layout/Split.ts#L1052)). `Math.max(loLhs, Math.min(hiLhs, newLhs))` caps to the maximum first (the inner `Math.min`) and floors to the minimum last (the outer `Math.max`) — the same cap-then-floor shape `plans/implemented/layout-manager-clamp-and-rounding-fixes.md` and `plans/implemented/box-child-clamp-ordering.md` established across `HBox`, `VBox`, `FlowLayout`, and `LayoutManager.resolveBounds`. When `minLhs > maxLhs`, `loLhs ≥ minLhs > maxLhs ≥ hiLhs`, so the inner `Math.min` can never exceed `hiLhs < loLhs`, and the outer `Math.max` always returns `loLhs = minLhs` — the minimum wins regardless of the requested target. `DragChain`'s `chainRoom`/`distributeDragChain` never perform this cap-then-floor step at all; they measure room off `current[pos]`, the component's own already-committed size. Because `Component.clampWidth`/`clampHeight` already apply the same minimum-wins rule before `current` is ever read, a component resting at a minimum above its own maximum is measured with zero room in both directions and simply does not move — the convention is inherited, not re-implemented, and there is nothing to fix.
