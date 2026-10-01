# SpatialNavigation Container Priority Within the Band — Implementation Plan

## Overview

`SpatialNavigation` ranks candidates in two layers. [`rankInDirection`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L122) is the pure geometric ranking: a candidate that *shares the origin's band* ranks ahead of one that doesn't. "Sharing the band" means the candidate's perpendicular span overlaps the origin's by a positive width — its rows overlap the origin's rows for `←`/`→`, its columns overlap the origin's columns for `↑`/`↓` ([`spansOverlap`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L80)). On top of that, [`rankWithContainerPriority`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L559) (called from `moveFocus` at [line 679](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L679), for both tiers) ranks every candidate inside the origin's nearest `FocusReveal` container ahead of every candidate outside it. The container rule exists so a move can't skip a sibling scrolled out of its container's view.

Because the container split runs *before* the band test, an off-band candidate inside the container beats an in-band neighbour outside it. SQLAdmin hit this: `Ctrl+Alt+←` from a `CodeEditor` lands on a result-pane button below and left of the editor, inside the same panel, instead of the tree directly beside it.

This plan swaps the order of the two rules: band first, then container, then score. Only `rankWithContainerPriority` changes, and it gains two small module-private helpers. `rankInDirection` and its public contract are untouched. It ships in 0.11.0 with a `## Fixed → ### Core` changelog entry.

---

## Architecture Decisions

### Band membership outranks container membership — four groups, in fixed order

`rankWithContainerPriority` splits candidates by band first, and applies the existing inside-before-outside split within each half. Each group is ranked by `rankInDirection` and the groups are concatenated:

1. in band, inside the container
2. in band, outside the container
3. off band, inside the container
4. off band, outside the container

This keeps the scrolled-out-sibling guarantee, because scrolling never changes whether an inside candidate shares the origin's band.[^band-scroll-invariant] The rule also covers every case the existing container-priority tests protect.[^covered-cases]

The shape mirrors the current `rankWithContainerPriority` body — "rank each group separately with `rankInDirection`, then concatenate" — which already keeps each group's internal order ([SpatialNavigation.ts:571-581](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L571)). The plan adds one more partition in front of that; it introduces no new mechanism.[^rejected]

Worked cases (west, origin = SQLAdmin's `.cm-content` at x 331–890, y 103–253, inside a revealer container):

| Candidate | Rect (x, y) | Inside? | In band? | Score | Old rank | New rank |
|---|---|---|---|---|---|---|
| *Record view* button | 280–300, 284–308 | yes | no (gap 31) | 31 + 2×31 = 93 | **1st** | 2nd |
| navigator tree | 41–279, 81–585 | no | yes | 52 | 2nd | **1st** |

| Candidates (north, origin x 8–218, y 214–243, inside) | Winner | Why |
|---|---|---|
| inside sibling x 8–170, y −25–4 (scrolled out, in band); outside x 109–131, y 0–31 (in band, nearer) | inside sibling | both in band → container decides (today's MiscPanel regression test) |
| inside x 230–260, y −25–4 (off band); outside x 109–131, y 0–31 (in band) | outside | band decides before container |

### The band test reuses `project` + `spansOverlap`, not a second definition

A new module-private `sharesOriginBand(origin, candidate, direction)` returns `spansOverlap` of the two spans `project` computes. This is the same test `rankInDirection` applies at [line 144](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L144), so a touching-but-not-overlapping edge counts as off band in both places.[^one-definition] `rankInDirection` itself is not edited.

### The region tier gets the same order, and SQLAdmin's region move is unchanged

`rankWithContainerPriority` serves both tiers, so the `"target"` tier (`Ctrl+Alt+Shift`+arrow) follows the same four-group order. The plan does not special-case it.[^target-tier] SQLAdmin reports that `Ctrl+Alt+Shift+←` from the editor already reaches the sidebar. That outcome cannot change: an in-band outside candidate is preceded under the new order only by candidates that also preceded it under the old order, so an in-band outside winner stays the winner.[^subset]

### No public API or documentation change beyond the changelog

`rankInDirection`, `SpatialNavigation`, and the options types keep their signatures. The container rule is not described in [`docs/concepts/accessibility.md`](packages/lib/docs/concepts/accessibility.md#L158), so that page needs no edit.

---

## Implementation

`packages/lib/src/typescript/lib/core/SpatialNavigation.ts`, replacing lines 540–582 (the `rankWithContainerPriority` JSDoc and body). Place `sharesOriginBand` directly after `spansOverlap` (after line 82) so it sits beside the helpers it uses.

```ts
/**
 * Whether `candidate` shares `origin`'s perpendicular band for `direction` —
 * the same positive-width overlap test {@link rankInDirection} ranks by.
 *
 * @param origin - The origin's rectangle.
 * @param candidate - The candidate's rectangle.
 * @param direction - The compass direction being searched.
 */
function sharesOriginBand(origin: Rect, candidate: Rect, direction: SpatialDirection): boolean {
    const { originSpan, candidateSpan } = project(origin, candidate, direction);

    return spansOverlap(originSpan, candidateSpan);
}
```

```ts
/**
 * Ranks `candidates` in `direction` from `originRect` in four groups, in
 * order: in `origin`'s band and inside its nearest scrolling/hiding
 * container; in band and outside it; off band and inside; off band and
 * outside. Each group is ranked with {@link rankInDirection} and the groups
 * are concatenated, so each keeps its own internal order.
 *
 * The container split stops a move escaping the container past a sibling
 * scrolled out of view: in raw page coordinates such a sibling can sit
 * farther from `origin` than an unrelated element elsewhere on the page.
 * The band split runs first because scrolling moves a container's content
 * along with `origin`, so an inside candidate's band membership is never
 * distorted — and an in-band neighbour outside the container must beat an
 * off-band control inside it. `origin` having no such container ranks
 * exactly as {@link rankInDirection} alone would.
 *
 * @param originRect - The origin's rectangle.
 * @param origin - The origin element, used to find its nearest container.
 * @param candidates - The candidates to rank.
 * @param direction - The compass direction to search in.
 */
function rankWithContainerPriority(
    originRect: Rect,
    origin: Handle,
    candidates: readonly SpatialCandidate[],
    direction: SpatialDirection,
): Handle[] {
    const container = nearestRevealerElement(origin);

    if (container === null) {
        return rankInDirection(originRect, candidates, direction);
    }

    const inBand:  SpatialCandidate[] = [];
    const offBand: SpatialCandidate[] = [];

    for (const candidate of candidates) {
        (sharesOriginBand(originRect, candidate.rect, direction) ? inBand : offBand).push(candidate);
    }

    return [
        ...rankInsideFirst(originRect, container, inBand, direction),
        ...rankInsideFirst(originRect, container, offBand, direction),
    ];
}

/**
 * Ranks `candidates` with every one inside `container` ahead of every one
 * outside it, each side ranked by {@link rankInDirection}.
 *
 * @param originRect - The origin's rectangle.
 * @param container - The origin's nearest scrolling/hiding container.
 * @param candidates - The candidates to rank.
 * @param direction - The compass direction to search in.
 */
function rankInsideFirst(
    originRect: Rect,
    container: Handle,
    candidates: readonly SpatialCandidate[],
    direction: SpatialDirection,
): Handle[] {
    const inside:  SpatialCandidate[] = [];
    const outside: SpatialCandidate[] = [];

    for (const candidate of candidates) {
        (DOM.source.contains(container, candidate.handle) ? inside : outside).push(candidate);
    }

    return [
        ...rankInDirection(originRect, inside, direction),
        ...rankInDirection(originRect, outside, direction),
    ];
}
```

`rankInsideFirst` is the old `rankWithContainerPriority` body moved verbatim; only the container lookup stays in the caller. Candidates that `rankInDirection` rejects (zero rect, behind the origin) are still dropped inside each group's call, so partitioning them first is harmless.

---

## Ordered Implementation Steps

1. **Write the failing tests first.** In [`packages/lib/tests/unit/core/SpatialNavigation.test.ts`](packages/lib/tests/unit/core/SpatialNavigation.test.ts#L811), inside the existing `describe('SpatialNavigation.move — scrolling-container priority', …)` block, after the test ending at line 877, add component-tier cases 4–8 from `## Expected Behaviour`. Add target-tier case 9 in the same block. Reuse the file's helpers: `liveHandle`, `place`, `registerFakeRevealer` (line 65), `stableBody`, `setQuerySelectorAllResult`, and for target case 9, `markNavigationTarget` with a leaf target seeded as its own `FOCUSABLE_SELECTOR` result (mirror the test at [line 1187](packages/lib/tests/unit/core/SpatialNavigation.test.ts#L1187)). For case 8, record the focus order with a `vi.spyOn(DOM.sink, 'focus')` that records the handle and never calls the real `focus` (mirror the spy at [line 575](packages/lib/tests/unit/core/SpatialNavigation.test.ts#L575)). Update the `describe` block's header comment to say the container rule applies within the band.
   Check: `cd packages/lib && npx vitest run tests/unit/core/SpatialNavigation.test.ts` — cases 4, 5, 7, 8, 9 fail; case 6 and the three existing container tests pass.
2. **Add `sharesOriginBand`** in `packages/lib/src/typescript/lib/core/SpatialNavigation.ts`, right after `spansOverlap` (line 82), exactly as in `## Implementation`.
3. **Replace `rankWithContainerPriority`** (JSDoc + body, lines 540–582 before step 2's insertion) with the `rankWithContainerPriority` + `rankInsideFirst` pair from `## Implementation`. Leave the call site at line 679 unchanged.
   Check: `grep -n 'rankWithContainerPriority\|rankInsideFirst\|sharesOriginBand' packages/lib/src/typescript/lib/core/SpatialNavigation.ts` — one definition each, `rankWithContainerPriority` called once from `moveFocus`, `rankInsideFirst` called twice, `sharesOriginBand` called once.
4. **Run the suite.** `npm test` from the repo root — every test passes, including all nine container-priority cases.
5. **Add the changelog entry** to [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md#L240) under `## Fixed → ### Core`, after the `FocusTraversal` entry that ends at line 243. Text:

   ```markdown
   - **`SpatialNavigation` no longer skips an in-line neighbour to stay inside
     the focused control's scrolling container.** A move ranks candidates
     inside the focused element's nearest scrolling or collapsible container
     first, so it can't jump past a sibling scrolled out of view — but that
     rule also beat alignment. From a `CodeEditor`, `Ctrl+Alt+←` landed on a
     button below and left of the editor inside the same panel, not on the
     tree right beside it. A candidate in line with the focused element
     (overlapping its rows for `←`/`→`, its columns for `↑`/`↓`) now always
     ranks ahead of one that isn't, and the container rule decides only among
     candidates on the same side of that test. The `Ctrl+Alt+Shift`+arrow
     region chord uses the same order. No consumer action is needed.
   ```
6. **Final checks** — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/SpatialNavigation.ts` |
| Modify | `packages/lib/tests/unit/core/SpatialNavigation.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

All cases are unit-testable through `SpatialNavigation.move(direction, tier)` in the offline harness. "Inside" means appended under a handle registered with `registerFakeRevealer`, with the origin appended under the same handle. Rects are `place(handle, left, top, right, bottom)`.

Cases 1–3 are the existing tests at lines 819, 842 and 862. They must keep passing unchanged.

| # | Tier, direction | Origin | Candidates | Lands on |
|---|---|---|---|---|
| 1 | component, north | 8, 214, 218, 243 — inside | `withinSibling` 8, −25, 170, 4 — inside, in band (scrolled out); `outsideCandidate` 109, 0, 131, 31 — outside, in band, nearer | `withinSibling` |
| 2 | component, north | 8, 214, 218, 243 — inside, sole inside candidate | `outsideCandidate` 109, 0, 131, 31 | `outsideCandidate` |
| 3 | component, north | 0, 200, 100, 220 — no revealer | `nearer` 0, 160, 100, 180; `farther` 0, 80, 100, 100 | `nearer` |
| 4 | component, west — **SQLAdmin case** | 331, 103, 890, 253 — inside | `recordView` 280, 284, 300, 308 — inside, off band (score 93); `tree` 41, 81, 279, 585 — outside, in band (score 52) | `tree` |
| 5 | component, west | 331, 103, 890, 253 — inside | `touching` 280, 253, 300, 270 — inside, top edge touches the band's bottom edge, so off band; `tree` 41, 81, 279, 585 — outside, in band | `tree` |
| 6 | component, west | 331, 103, 890, 253 — inside | `recordView` 280, 284, 300, 308 — inside, off band (score 93); `nearOff` 300, 260, 325, 280 — outside, off band (score 6 + 2×7 = 20) | `recordView` — container still decides among off-band candidates |
| 7 | component, north | 8, 214, 218, 243 — inside | `insideOff` 230, −25, 260, 4 — inside, off band (scrolled out); `outsideCandidate` 109, 0, 131, 31 — outside, in band | `outsideCandidate` |
| 8 | component, west — full order | 331, 103, 890, 253 — inside | `inBandInside` 100, 150, 120, 170 (primary 211); `inBandOutside` 290, 110, 310, 130 (primary 21); `offBandInside` 280, 284, 300, 308 (score 93); `offBandOutside` 300, 260, 325, 280 (score 20). Every focus refuses. | `move` returns `false`; focus attempts, in order: `inBandInside`, `inBandOutside`, `offBandInside`, `offBandOutside` |
| 9 | target, west | 331, 103, 890, 253 — inside | `insideTarget` 280, 284, 300, 308 — inside, off band, leaf target; `outsideTarget` 41, 81, 279, 585 — outside, in band, leaf target | `outsideTarget` |

Case 8 pins the four-group order in one test. Under the old code the order was `inBandInside, offBandInside, inBandOutside, offBandOutside`; pure geometry would give `inBandOutside, inBandInside, offBandOutside, offBandInside`. Seed `FOCUSABLE_SELECTOR` on `body` with `[origin, …candidates]` in the order listed. The no-origin fallback (`describe('SpatialNavigation.move — no genuine origin')`) does not rank, so it is unaffected; its existing tests must pass unchanged.

**Manual verification** (focus and real layout can't be exercised offline):

- Demo app: in `MiscPanel`'s left column (an `autoScroll` panel), scroll so a button is partly out of view, focus the one below it, and press `Ctrl+Alt+↑` — focus reaches the scrolled-out button and scrolls it into view, not the tab strip above.
- SQLAdmin via the symlinked build: open a query tab, focus the SQL editor, press `Ctrl+Alt+←` — focus lands on the navigator tree, not the result pane's *Record view* button. Press `Ctrl+Alt+Shift+←` — focus still lands in the sidebar.

---

## Verification

- `npm test` (repo root) — typecheck of tests plus the full vitest run; all nine container-priority cases pass.
- `npm run typecheck` and `npm run lint` — clean.
- `npm run docs:api` — zero warnings. The new JSDoc links only `rankInDirection`, which is exported.
- `npm run build:lib`, then the two manual checks above; the SQLAdmin one runs against the symlinked `dist/lib`.

---

## Potential Challenges

- **Case 8's spy also swallows the harness's own focus bookkeeping.** Install the spy *after* `DOM.sink.focus(origin)`, so the origin is focused before every later call is recorded and refused.
- **Case 9 needs each target to be a leaf.** Seed `setQuerySelectorAllResult(target, FOCUSABLE_SELECTOR, [target])` for both targets, or `targetLandings` has nothing to focus and falls through to the next target.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/SpatialNavigation.ts`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts) — `project` (line 40), `spansOverlap` (80), `rankInDirection` (122), `nearestRevealerElement` (534), `rankWithContainerPriority` (559, the precedent this plan extends), `moveFocus` (659).
- [`packages/lib/src/typescript/lib/core/FocusReveal.ts`](packages/lib/src/typescript/lib/core/FocusReveal.ts#L66) — `containing`, which `nearestRevealerElement` reads.
- [`packages/lib/tests/unit/core/SpatialNavigation.test.ts`](packages/lib/tests/unit/core/SpatialNavigation.test.ts#L811) — the container-priority block and its helpers.

---

## Non-Goals

- **Changing `rankInDirection`.** It is public and its band-first contract is already right; the defect is only in the layer above it.
- **Ranking scrolled-out candidates by their visible (clipped) position.** The container rule stays a group ordering; see `[^rejected]`.
- **Editing SQLAdmin's `LIBRARY_NOTES.md`.** That entry is pruned on the SQLAdmin side once 0.11.0 ships.

---

## Notes

[^band-scroll-invariant]: A `FocusReveal` container's scrolling moves the origin and every inside candidate by the same offset, so their positions relative to each other stay true. Band membership of an inside candidate is measured against the origin, so it is never distorted by scrolling. Band membership of an outside candidate compares two real on-screen rects, so it is true too. The only measurement scrolling distorts is the *primary distance* between an inside candidate and anything outside the container. That is what the container rule corrects, and it only needs to decide among candidates the band rule has already tied. One gap remains, and it exists today too: an inside candidate inside a *further* nested scroller that doesn't contain the origin can be shifted relative to the origin. The plan doesn't address that.

[^covered-cases]: The container rule was added during `spatial-focus-navigation`'s implementation (commit `7aabe2e9`), not in that plan's text; its three tests are the full record of what it protects. The MiscPanel regression (test at line 819): `Ctrl+Alt+↑` inside a scrolling left column jumped to the app's tab strip instead of the next scrolled-off button. Both candidates there overlap the origin's columns (x 8–170 and x 109–131 vs x 8–218), so both land in the in-band group and the container still decides. The other two tests (line 842: no inside candidate left; line 862: no revealer at all) have no band conflict. The same holds for a `TabBar`'s `ScrollStrip` moving `→` past a scrolled-out tab: tabs in one row share the band.

[^rejected]: Two alternatives were considered. (a) Apply the container rule only to inside candidates that are not yet revealed (scrolled out of the container's view). This needs the container's visible rect, a "how much must be hidden" threshold, and extra DOM reads per move. It also does not fix the reported defect in general: if the *Record view* button were itself scrolled out of view, it would still beat the in-band tree. (b) Drop the container rule and rank inside candidates by their rect clipped to the container. A fully scrolled-out sibling clips to nothing and becomes unreachable, which is the MiscPanel bug again. A score penalty or bonus for inside candidates was also rejected: any fixed value would be wrong for some scroll distance.

[^one-definition]: `spansOverlap` requires positive-width overlap so a toolbar flush against the row above it doesn't count as sharing the row (see the comment at lines 75–79). Recomputing band membership with a different test in `rankWithContainerPriority` could split candidates differently from how `rankInDirection` then orders them. Case 5 in `## Expected Behaviour` pins the touching-edge result. `rankInDirection` keeps its own inline `spansOverlap` call rather than calling `sharesOriginBand`, because it already has the projected spans for its score and would otherwise project twice.

[^target-tier]: The container distortion and the band argument are the same for navigation targets as for leaf controls: a target inside the origin's scrolling container scrolls with the origin. Keeping one shared ranking function for both tiers also keeps `moveFocus` unchanged. A region-tier variant of the SQLAdmin defect is possible: a marked target inside the panel, off band and west of the editor, would win over the sidebar today. Case 9 pins that it no longer does.

[^subset]: Under the old order, an in-band outside candidate X was preceded by every eligible inside candidate plus in-band outside candidates scoring better than X. Under the new order, X is preceded only by in-band inside candidates plus those same in-band outside candidates. The new set is a subset of the old one, so X never drops in rank, and a move that already landed on X still does. The sidebar is in band from the editor (tree y 81–585 overlaps editor y 103–253). The only moves whose outcome changes are those where the old winner was an off-band inside candidate and an in-band outside candidate existed.
