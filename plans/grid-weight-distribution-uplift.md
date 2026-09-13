# Grid Weight-Track Distribution Audit — Implementation Plan

## Overview

Commit `52cf01b1` fixed a real bug shared by `HBox` and `VBox`: each split main-axis space among weighted children independently, then clamped each child's share to its own `[min, max]` — but a clamp's shortfall or surplus was never redistributed to the other children, so the placed widths could sum past the container. `BoxLayout.resolveWeightedExtents` ([`BoxLayout.ts:461`](../packages/lib/src/typescript/lib/layout/BoxLayout.ts#L461)) now resolves every weight cell in a row or column together, through an iterative freeze-on-clamp pass, fixing this for both `HBox` and `VBox`.

This plan was commissioned to check whether `Grid`'s own track-sizing method, `resolveTracks` ([`Grid.ts:805`](../packages/lib/src/typescript/lib/layout/Grid.ts#L805)), has the same class of bug, since it independently re-implements "distribute space among flexible cells with min/max clamping." **It does not, and cannot**: `resolveTracks` applies no min/max clamp to a weight track's resolved extent at all — `GridTrack` ([`GridTrack.ts:27`](../packages/lib/src/typescript/lib/layout/GridTrack.ts#L27)) carries no min/max field, only a `mode` and a `value`. There is no clamp step whose shortfall or surplus could go unredistributed, so the failure mode `resolveWeightedExtents` fixes cannot arise in `Grid`. This is verified below with a repro that mirrors the new `HBox.test.ts` / `VBox.test.ts` cases from `52cf01b1`, adapted to `Grid`'s track model.

Because there is no bug, this plan does not touch `resolveTracks`, does not hoist `resolveWeightedExtents` anywhere, and does not change any `Grid` behaviour. It scopes down to two small, justified additions: a doc-comment note on `resolveTracks` recording why it doesn't need the `BoxLayout` treatment (so a future contributor doesn't "fix" this again from a shallow analogy), and one regression test that locks in the specific case this investigation checked, since the existing suite covers a fixed+weight combination but not a weight+weight one. The `layout/Table.ts` manager's own column-width logic (`initializeWidths`/`rescaleWidths`/`absorbSlackIntoGreedy`, [`Table.ts:442-551`](../packages/lib/src/typescript/lib/layout/Table.ts#L442)) is not examined here; `plans/implemented/layout-manager-shared-size-logic.md` already closed that question.

---

## Architecture Decisions

### `Grid.resolveTracks` is not touched — its track model has no clamp step for the bug to hide in

`resolveTracks` computes a `fixedSum` (literal `value`s) and a `contentSum` (measured content sizes), then splits whatever is left — `remaining = available − fixedSum − contentSum` — among weight tracks in exact proportion to their weight. No step compares a weight track's share to a bound and adjusts it. The three mechanisms side by side:[^repro]

| Manager | How shares combine | Clamp bound | What a too-small share does | Do the resolved extents still sum to the available space? |
|---|---|---|---|---|
| `HBox`/`VBox` before `52cf01b1` | Each child's `share = weight/totalWeight × remaining`, computed independently | the child's own `getMinSize()`/`getMaxSize()` | Clamped **in isolation**; other children keep their pre-clamp share | No — the clamped total could exceed or fall short of `remaining` |
| `HBox`/`VBox` after `52cf01b1` (`resolveWeightedExtents`) | Same proportional split, but an iterative freeze-on-clamp pass | the child's own `getMinSize()`/`getMaxSize()` | The cell freezes at its bound; its weight and extent leave the pool so the rest re-split what's left | Yes, whenever the combined bounds allow it |
| `Grid.resolveTracks` (unchanged) | `resolved[i] = remaining × weight/weightSum`, one pass, no bound | **none** — `GridTrack` has no min/max field | Never happens: nothing compares a track's share to a bound | Yes, always, by construction |

A `GridTrack` is `{ mode: "weight" \| "fixed" \| "content", value?: number }` — no `min`/`max` field exists to clamp against. A weight *track* can also host several children at once (row/column auto-flow assigns many components to the same column), so even if a bound existed, there would be no single child to source a per-track min/max from the way `HBox.measureWeightCells` sources one `[min, max]` pair per weight *child* ([`HBox.ts:607`](../packages/lib/src/typescript/lib/layout/HBox.ts#L607)).

Instead, an individual child whose own min size exceeds the cell its track resolved to is handled entirely differently: `layoutOccupancy`'s `min.width > w || min.height > h` branch ([`Grid.ts:994`](../packages/lib/src/typescript/lib/layout/Grid.ts#L994)) wraps that one child in a clip frame sized to the cell, and commits the child at its natural (larger) size inside it, clipped. The track's own resolved extent is never changed. This is `Grid`'s existing, tested behaviour — [`Grid.test.ts:225`](../packages/lib/tests/component/layout/Grid.test.ts#L225) already covers a fixed+weight version of it — and it matches [`ARCHITECTURE.md`](../ARCHITECTURE.md)'s rule 7 verbatim: *"If a component's minimum size is larger than the space its layout manager can assign it, the component's size is set to its preferred size and the component clips so it doesn't spill over; if it has no preferred size, the layout manager sizes it sensibly, to the best of its ability."* (`a` in the repro below has no preferred size, so it falls back to its min width — the "sizes it sensibly" branch.) `Grid` clips the individual offending child and leaves its sibling tracks untouched; `HBox`/`VBox` instead give the oversized child its full min and shrink its siblings to absorb the difference. Both are valid readings of rule 7 for their own geometry: a `Grid` track is a fixed geometric boundary shared by however many children flow into it, so keeping every track's size fixed and clipping the one child that doesn't fit preserves a predictable grid; an `HBox`/`VBox` weight cell is one child's exclusive share of a single row's main axis, so growing it and shrinking its neighbour keeps the row's total exactly full. Neither mechanism is a defect in the other.

### Hoisting `resolveWeightedExtents` to `LayoutManager` is considered and rejected

The task that produced this plan asked, conditional on a real bug being found, whether `resolveWeightedExtents` should move up to `LayoutManager` (the common ancestor of `BoxLayout` and `Grid`) so `Grid` could call it without inheriting from `BoxLayout`.[^hoist-precedent] No bug was found, so nothing needs to call it. Recording why the hoist wouldn't even fit cleanly if one existed: `resolveWeightedExtents` takes one `weight`/`minExtent`/`maxExtent` triple per *cell*, where a cell is one child. `Grid`'s weight unit is a *track*, which can carry zero, one, or many children (`GridConstraints` has no `weight` field at all — weight lives only on the track, in `GridTrack.value`). Feeding `Grid` into this algorithm would require first inventing a way to reduce a track's many children into one `[min, max]` pair, which is new speculative complexity for a problem `Grid` doesn't have. `resolveTracks` and `layoutOccupancy` stay exactly as they are.

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/layout/Grid.ts`** — extend `resolveTracks`'s existing `@remarks` doc-comment block (currently ending at line 804, just above `private resolveTracks(...)` at line 805) with one more paragraph:

   ```typescript
    * @remarks Fixed tracks keep their `value`; content tracks keep their measured
    * size; the remaining space is split among weight tracks in proportion to their
    * weights. When no weight track exists the remaining space is left unused.
    *
    * Unlike {@link BoxLayout.resolveWeightedExtents} — added to redistribute a
    * clamped weight *child*'s shortfall/surplus to its siblings in `HBox`/`VBox`
    * — this method applies no min/max clamp to a weight track's resolved
    * extent: {@link GridTrack} has no such bound, and a track can carry many
    * children via auto-flow, so there is no single per-track bound to clamp
    * against. A child whose own min size exceeds its resolved cell is clipped
    * in place by `layoutOccupancy`'s clip-frame branch instead — the track
    * itself is never resized. Track extents therefore always sum to
    * `available` (whenever a weight track exists); see
    * `plans/implemented/grid-weight-distribution-uplift.md` for the
    * investigation that confirmed this.
    */
   ```

   Leave the method body untouched.

2. **`packages/lib/tests/component/layout/Grid.test.ts`** — add one `it` to the existing `describe('Grid occupancy clip frame', ...)` block (after the test ending at line 258), covering the weight+weight case the current suite doesn't:

   ```typescript
    it('leaves an unclamped weight-1 sibling at its own proportional share when the other weight-1 track clips', () => {
        installTestDOM(CONFIG);

        const grid = new Grid({ rows: 1, columns: 2, spacing: 0 });
        const host = hostGrid(400, 100, grid);

        const a = new Component();
        a.setMinSize({ width: 300, height: 0 });
        const b = new Component();

        host.addComponent(a);
        host.addComponent(b);

        host.doLayout();

        // Both columns are implicit weight-1 tracks, so each resolves to its
        // proportional 200px share regardless of a's 300px min — resolveTracks
        // applies no clamp, so there is nothing for b's share to compensate
        // for. a is clipped to its 200px-wide track (parented into a clip
        // frame, not the host) at its natural 300px width; b is placed at its
        // own unaffected 200px share, immediately after a's track boundary.
        expect(a.getX()).toBe(0);
        expect(a.getWidth()).toBe(300);
        expect(DOM.source.getParentNode(a.getElement()!)).not.toBe(host.getElement());

        expect(b.getX()).toBe(200);
        expect(b.getWidth()).toBe(200);
        expect(DOM.source.getParentNode(b.getElement()!)).toBe(host.getElement());
    });
   ```

   `DOM`, `installTestDOM`, `hostGrid`, and `CONFIG` are already imported/defined earlier in the file — no new imports needed.

3. **Regression check:** `cd packages/lib && npx vitest run tests/component/layout/Grid.test.ts` — expect all tests green, including the new one.
4. **Typecheck:** `npm run typecheck:test` (from `packages/lib`) — expect clean; the change is a doc comment plus a test using only existing symbols.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/Grid.ts` (doc-comment addition only, no logic change) |
| Modify | `packages/lib/tests/component/layout/Grid.test.ts` (one new regression test) |

---

## Expected Behaviour

This plan adds no logic, so there is nothing to pin beyond the one new test. Its exact expected values, verified directly against the current code during this investigation:[^verified]

- **Setup:** a `Grid` with `rows: 1, columns: 2, spacing: 0` (both columns default to `{ mode: "weight", value: 1 }`), hosted at `400×100`. Child `a` has `setMinSize({ width: 300, height: 0 })` and no preferred size; child `b` has neither.
- **`a`** (weight-1 column 0, whose min exceeds its 200px share): placed at `x=0`, natural width `300` (falls back to its min since it has no preferred size), parented into a clip frame — `DOM.source.getParentNode(a.getElement())` is **not** the host element.
- **`b`** (weight-1 column 1): placed at `x=200`, width `200` — its own unclamped 50/50 share, unaffected by `a`'s min. Parented directly to the host.
- Both tracks' resolved extents still sum to `400`, the full container width — column 1 never grows to compensate for column 0's clip, because nothing shrank it in the first place.

This is a unit test (`Grid.test.ts`, using the existing `installTestDOM`/`hostGrid` harness); no manual verification is needed since the behaviour is pure layout arithmetic already exercised through `doLayout()`.

---

## Verification

- `cd packages/lib && npx vitest run tests/component/layout/Grid.test.ts` — all tests pass, including the new one.
- `npm run typecheck:test` (from `packages/lib`) — clean.
- `npm run docs:api` — zero warnings (the doc-comment addition is on a `private` method, so no public-facing link warning is expected per [`CODE_CONVENTIONS.md`](../CODE_CONVENTIONS.md)'s `{@link}` rule, but this confirms it).
- No `grep` invariant is needed: nothing is renamed or removed.

---

## Potential Challenges

- **A future reader may still see "Grid has a min-size overflow story" and assume it needs `resolveWeightedExtents`.** Mitigation: the doc-comment addition in step 1 states the reason inline, at the exact method a copy-paste fix would target, not just in this plan file.

---

## Critical Files

- [`packages/lib/src/typescript/lib/layout/BoxLayout.ts:461`](../packages/lib/src/typescript/lib/layout/BoxLayout.ts#L461) — `resolveWeightedExtents`, the method this investigation checked `Grid` against.
- [`packages/lib/src/typescript/lib/layout/Grid.ts:805`](../packages/lib/src/typescript/lib/layout/Grid.ts#L805) — `resolveTracks`, the method being documented.
- [`packages/lib/src/typescript/lib/layout/Grid.ts:949`](../packages/lib/src/typescript/lib/layout/Grid.ts#L949) — `layoutOccupancy`, whose clip-frame branch (`Grid.ts:994`) is `Grid`'s actual answer to a child's min exceeding its cell.
- [`packages/lib/src/typescript/lib/layout/GridTrack.ts`](../packages/lib/src/typescript/lib/layout/GridTrack.ts) — confirms the track model has no min/max field.
- [`packages/lib/tests/component/layout/Grid.test.ts:219`](../packages/lib/tests/component/layout/Grid.test.ts#L219) — the existing `'Grid occupancy clip frame'` describe block the new test extends.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) *"Size constraints: who is responsible for what"*, rule 7 — the rule `Grid`'s clip-frame behaviour already satisfies.
- [`plans/implemented/layout-manager-shared-size-logic.md`](implemented/layout-manager-shared-size-logic.md) — prior art establishing `Table`'s column-width logic as already, deliberately out of scope for any size-negotiation consolidation.

---

## Non-Goals

- **No change to `Grid.resolveTracks` or `layoutOccupancy`'s behaviour.** The investigation found no bug; changing working code to "match" `BoxLayout` would be consolidation with no bug behind it.
- **No hoist of `resolveWeightedExtents` to `LayoutManager` or extraction as a standalone utility.** There is no caller for it in `Grid` — see `## Architecture Decisions`.
- **No `Table` changes.** `plans/implemented/layout-manager-shared-size-logic.md` already documented that `Table` intentionally opts out of size negotiation; that is not revisited here.
- **No changes to `Grid`'s handling of `"fixed"`/`"content"` tracks whose combined size alone exceeds the container.** That is a different, pre-existing question from the one this plan was asked to check (a clamped *weight* track's shortfall/surplus going unredistributed) and is not evaluated here.

---

## Notes

[^repro]: Verified directly by running a scratch test against `Grid.doLayout()` (not committed — thrown away after use) mirroring the new `HBox.test.ts`/`VBox.test.ts` cases from `52cf01b1`: a `400×100` host, one row, two implicit weight-1 columns, `spacing: 0`, column 0's child given `setMinSize({ width: 300, height: 0 })`, column 1's child plain. Result: `a` (`x=0, width=300`, clip-frame parent) and `b` (`x=200, width=200`, host parent) — column 0 stayed at its proportional 200px share (never inflated to 300), and column 1 never grew to absorb any shortfall, because `resolveTracks` never produced one. Both columns' resolved extents still summed to exactly 400. This is the direct structural counterexample to "a clamped share's shortfall isn't redistributed": there is no clamp, so there is no shortfall.

[^hoist-precedent]: `plans/implemented/layout-manager-shared-size-logic.md` previously hoisted two other methods — a concrete `computeTotalMinSize()` default and `inflateForOverflow` — from `BoxLayout` up to `LayoutManager`, specifically so managers outside the `BoxLayout` family (`Fit`, `Card`, `Grid`, `Border`, `Split`, `Tab`) could call them. That is the established precedent for this kind of hoist when one is actually warranted; it doesn't apply here because there is nothing for `Grid` to call.

[^verified]: Reproduced with `npx vitest run` against a scratch test file inside the investigation worktree, then deleted; the same values are re-derived analytically from `resolveTracks`'s and `layoutOccupancy`'s source in `## Architecture Decisions` above.
