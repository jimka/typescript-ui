---
touches-shared:
  - packages/docs/src/demos/
  - packages/lib/docs/layouts/
---

# Grid Page Uniform-Demo Mismatch — Implementation Plan

## Overview

The docs app's Grid layout page opens with a paragraph and an ASCII diagram claiming `Grid` "tiles children in a uniform grid of equal-sized cells," showing a 2×3 grid of cells A-F ([packages/lib/docs/layouts/Grid.md:3-12](packages/lib/docs/layouts/Grid.md#L3)). The live demo directly beneath that diagram is `grid-tracks` ([packages/lib/docs/layouts/Grid.md:14-18](packages/lib/docs/layouts/Grid.md#L14)), whose module ([packages/docs/src/demos/grid-tracks.ts](packages/docs/src/demos/grid-tracks.ts)) deliberately builds a 3-column grid with a fixed, a weighted, and a content-sized column track — three visibly unequal-width columns. A reader sees "uniform" and "equal-sized," then immediately sees three different widths.

`grid-tracks` is not a bug. It is a correct, well-documented demo of the `## Flexible track sizing` section further down the same page ([Grid.md:40-59](packages/lib/docs/layouts/Grid.md#L40)), whose own code fence uses the identical `fixed: 120` / `weight: 1` / `content` track configuration the demo builds. The mismatch is placement: the page's only demo sits where the [`docs-component-demo-set`](plans/implemented/docs-component-demo-set.md) Addendum's corrected rule puts every page's *first* demo — directly after the summary, before the first `##` heading — which for a single-demo page means directly under a paragraph the demo doesn't illustrate.

The fix adds a second demo module, `grid-uniform`, that actually renders the uniform 2×3 grid the diagram promises, and takes over the top-of-page slot. `grid-tracks` moves down to become the page's *second* demo, at the end of `## Flexible track sizing` — the section it has always illustrated. This is the same two-demo shape `components/Table.md` and `layouts/VBox.md` already use: a first demo at the top introducing the component, a second demo lower down, tied to the specific section it demonstrates.

The fix is a `packages/docs` and `packages/lib/docs/layouts/Grid.md` content change only. No `packages/lib` source code changes: `Grid`'s default (no `columnTracks`/`rowTracks` supplied) already produces equal-sized cells, which is exactly what a uniform-demo needs, and no library behaviour is being added or altered.

---

## Architecture Decisions

### Give the page a second demo instead of rewording the intro

`Grid.md` gets a new first demo, `grid-uniform`, matching the diagram, and keeps `grid-tracks` as its second demo, moved to the section it illustrates. Rewording the intro to stop claiming uniformity was rejected: the prose is correct — `Grid`'s default *is* a uniform grid of equal-sized cells — and the ASCII diagram is a bespoke illustration of exactly that default. The mismatch is where the demo sits, not what the prose says.[^why-two-demos]

### `grid-uniform` follows the marker-placement rule already established for a page's first demo

`grid-uniform`'s marker goes directly after the ASCII diagram and before `## Usage` — the same slot `grid-tracks`'s marker occupies today ([Grid.md:14](packages/lib/docs/layouts/Grid.md#L14)). This is the corrected rule `docs-component-demo-set.md`'s Addendum states for a page's first demo, and the one `docs-component-demo-set-remaining.md` restates and applies throughout: "A page's first demo goes directly after the summary paragraph, before the page's first `##` heading."[^first-demo-rule]

### `grid-tracks`'s marker moves to the end of `## Flexible track sizing`, unchanged otherwise

`grid-tracks`'s module, fallback text, and demo id stay unchanged — only its marker's position in `Grid.md` moves, to directly before `## Cell spanning and explicit placement` ([Grid.md:61](packages/lib/docs/layouts/Grid.md#L61)), the last line of `## Flexible track sizing`. This mirrors the shipped second-demo placement on `components/Table.md` (`table-cell-types`, marker at [Table.md:153](packages/lib/docs/components/Table.md#L153), immediately after `## Per-cell cell types` content) and `layouts/VBox.md` (`vbox-sizing-modes`, marker at [VBox.md:74](packages/lib/docs/layouts/VBox.md#L74), immediately after `## Sizing modes` content).[^original-row-13]

### `grid-uniform`'s content is the plainest possible `Grid`, sized and labelled to match the diagram

`create()` builds six `Header` cells labelled `'A'` through `'F'`, added in that order to `Grid({ rows: 2, columns: 3 })` with no track configuration — `Grid`'s documented default (`defaultFill: FillType.BOTH`, no `columnTracks`/`rowTracks`) already makes every column and row share space equally ([Grid.md:44](packages/lib/docs/layouts/Grid.md#L44)). `Grid` fills children in row-major order, so adding the cells in that order renders exactly the diagram's layout: `A B C` on row one, `D E F` on row two.[^row-major-evidence] `Header` as the cell content matches `grid-tracks.ts`'s own choice, so the two demos on this page read as a matched pair.

`height` is `260`, the "layout-manager demo" class every other demo on this page and every sibling layout page already uses (`vbox-stack`, `hbox-justify`, `border-regions`, `grid-tracks` itself, `split-panes`, `tab-strip`, `accordion-sections`, `hflow-wrap`, `anchor-positions` — all `260`).

---

## Internal Structure

### `packages/docs/src/demos/grid-uniform.ts`

```typescript
import type { Component } from '@jimka/typescript-ui/core';
import { Panel } from '@jimka/typescript-ui/core';
import { Grid } from '@jimka/typescript-ui/layout';
import { Header } from '@jimka/typescript-ui/component/display';

/**
 * Pixel height of the framed live area this demo is rendered into on its docs
 * page: `DocsDemo` applies it as both the minimum and the preferred height of
 * the bordered stage that holds `create()`'s component tree, so it fixes how
 * tall the frame in the Markdown page is — it is not a maximum, and content
 * whose own minimum is taller will still push the frame open.
 *
 * 260 is two rows of grid cells plus the surrounding frame — the same
 * layout-manager height class every other demo on this page and its sibling
 * layout pages uses.
 */
export const height: number = 260;

/**
 * A uniform 2×3 `Grid` — six labelled cells, every column and row the same
 * size, matching the diagram at the top of this page.
 *
 * @returns The demo's component tree.
 */
export function create(): Component {
    const cellA = Header('A');

    const cellB = Header('B');

    const cellC = Header('C');

    const cellD = Header('D');

    const cellE = Header('E');

    const cellF = Header('F');

    return Panel({
        layoutManager: Grid({ rows: 2, columns: 3 }),
        components:    [cellA, cellB, cellC, cellD, cellE, cellF],
    });
}
```

This follows the same shape, import style, and one-`const`-per-cell rule as [packages/docs/src/demos/vbox-stack.ts](packages/docs/src/demos/vbox-stack.ts) and [packages/docs/src/demos/grid-tracks.ts](packages/docs/src/demos/grid-tracks.ts).

### `packages/lib/docs/layouts/Grid.md` — top-of-page marker

Replace the existing `grid-tracks` marker block (current lines 14-18) with a `grid-uniform` marker in the same position, directly after the ASCII diagram and before `## Usage`:

```markdown
<!-- demo: grid-uniform -->
> **Live demo** — a uniform 2×3 grid of equal-sized cells, matching the
> diagram above.
> [Open the Grid page](https://jimka.github.io/typescript-ui/layouts/Grid)
<!-- /demo -->
```

### `packages/lib/docs/layouts/Grid.md` — moved `grid-tracks` marker

Insert the `grid-tracks` marker, fallback text unchanged from its current form, directly after the last line of `## Flexible track sizing` (currently line 59, ending "...cells pack to the top-left).") and before the blank line that precedes `## Cell spanning and explicit placement`:

```markdown
<!-- demo: grid-tracks -->
> **Live demo** — a 3-column grid with fixed, weight, and content column
> tracks; resizing the pane moves only the weighted column.
> [Open the Grid page](https://jimka.github.io/typescript-ui/layouts/Grid)
<!-- /demo -->
```

Worked before/after of the page's marker positions:

| Section | Before | After |
|---|---|---|
| Intro (before `## Usage`) | `<!-- demo: grid-tracks -->` | `<!-- demo: grid-uniform -->` |
| End of `## Flexible track sizing` (before `## Cell spanning and explicit placement`) | *(no marker)* | `<!-- demo: grid-tracks -->` |

---

## Ordered Implementation Steps

1. **Create `packages/docs/src/demos/grid-uniform.ts`** exactly as shown in `## Internal Structure`.
   *Check:* `npm -w packages/docs run typecheck` passes.

2. **Edit `packages/lib/docs/layouts/Grid.md`.** Replace the current `<!-- demo: grid-tracks -->` ... `<!-- /demo -->` block (lines 14-18) with the `grid-uniform` marker block shown in `## Internal Structure`, in the same location (directly after the ASCII diagram fence, before `## Usage`).
   *Check:* `grep -n '<!-- demo:' packages/lib/docs/layouts/Grid.md` — expect exactly one match so far, `grid-uniform`, before line 20 (`## Usage`).

3. **Insert the `grid-tracks` marker block** at the end of `## Flexible track sizing`, directly before `## Cell spanning and explicit placement`, per `## Internal Structure`. Keep one blank line on each side of the block, matching every other marker in the corpus.
   *Check:* `grep -n '<!-- demo:\|^## ' packages/lib/docs/layouts/Grid.md` — expect `grid-uniform` before `## Usage` and `grid-tracks` between `## Flexible track sizing` and `## Cell spanning and explicit placement`, in that order.

4. **Run the existing docs test suite** — no test file changes are needed. `demo-catalogue.test.ts` and `demos.test.ts` both glob `packages/docs/src/demos/*.ts` and the `packages/lib/docs/` corpus dynamically ([packages/docs/tests/demo-catalogue.test.ts:7-8](packages/docs/tests/demo-catalogue.test.ts#L7), [packages/docs/tests/demos.test.ts:15-19](packages/docs/tests/demos.test.ts#L15)), so the new module and the moved/added markers are picked up automatically.
   *Check:* `npm -w packages/docs test` green, including the corpus↔registry bijection and the per-page marker-balance / duplicate-heading-slug / fallback-link guards.

5. **Build and look at it.** `npm run build:lib`, then `npm run docs:dev`, then walk `## Verification`'s manual checks on `/layouts/Grid`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/docs/src/demos/grid-uniform.ts` |
| Modify | `packages/lib/docs/layouts/Grid.md` |

---

## Expected Behaviour

**Source hygiene (automatable, via the existing `demo-catalogue.test.ts` — no test file changes needed, restated for reference):**

1. `grid-uniform.ts` exports exactly `height` and `create`, matches the five-value height scale (`260`), declares no timer, no colour literal, no top-level binding besides `height`, and constructs no component inside a `components: […]` array literal.

**Corpus/registry (automatable, via the existing `demos.test.ts`):**

2. `getDemo('grid-uniform')` resolves to `grid-uniform.ts`'s module and source.
3. `/layouts/Grid.md`'s two markers (`grid-uniform`, `grid-tracks`) both resolve through `getDemo`, and both ids appear in `getDemoIds()`.
4. `/layouts/Grid.md` has no two headings sharing a slug, balances both marker pairs, and has no heading or non-`https://` link inside either fallback region.

**Live behaviour (manual — `packages/docs` has no component-level test harness):**

5. `/layouts/Grid` renders, in order: the intro paragraph, the ASCII diagram, a bordered live area showing a 2×3 grid of six equal-sized cells labelled `A` through `F` in reading order (`A B C` / `D E F`), then `## Usage`.
6. Further down the same page, `## Flexible track sizing`'s prose and code fence are followed by a second bordered live area showing the fixed/weight/content 3-column grid (unequal column widths, only the weighted column's edge moving on resize), then `## Cell spanning and explicit placement`.
7. Neither live area shows a "demo not found" panel.
8. "Show source" on `grid-uniform` reveals `grid-uniform.ts`'s own TypeScript, matching what was written in step 1.

---

## Verification

Run from the repo root, in order:

```bash
npm run build:lib
npm -w packages/docs run typecheck
npm -w packages/docs test
npm run build:docs
```

Then `npm run docs:dev` and open `http://localhost:5173/typescript-ui/layouts/Grid` to check Expected Behaviour cases 5-8.

Also confirm the moved and added markers didn't disturb the corpus guards for this page specifically:

```bash
npm -w packages/docs test -- demos
npm -w packages/docs test -- demo-catalogue
```

---

## Documentation Impact

No library export changes, so no TypeDoc, barrel, or `packages/lib/llms.txt` change. The only edits to shipped documentation are the marker-block changes in `packages/lib/docs/layouts/Grid.md` — HTML comments, hidden by every Markdown renderer, so the corpus reads unchanged on GitHub and npm; the intro prose, the ASCII diagram, and every other section's text are untouched.

---

## Potential Challenges

- **Row-major fill order is inferred, not directly stated in the API docs.** The evidence is the page's own numpad `## Usage` example, which only makes sense if `Grid` fills left-to-right, top-to-bottom. Check the live page against Expected Behaviour case 5 before calling this demo done. If the cells land in a different order, keep `Grid({ rows: 2, columns: 3 })` and reorder the six `addComponent` calls (not the grid's `rows`/`columns`) until the rendered page matches `A B C` / `D E F` — do not guess at the fill order from prose.
- **`grid-uniform`'s six equal cells might look visually thin at `height: 260` in a 2-row grid**, since `grid-tracks` (also `260`) shows only one row. If the cells read as excessively tall in the manual walk, drop to `height: 200` — but keep the `260` "layout-manager demo" class first per the established scale, and only deviate if the walk actually shows a problem.

---

## Critical Files

- [packages/lib/docs/layouts/Grid.md](packages/lib/docs/layouts/Grid.md) — the page being edited; read in full before editing, matching line numbers cited above.
- [packages/docs/src/demos/grid-tracks.ts](packages/docs/src/demos/grid-tracks.ts) — the existing demo whose marker moves; module itself is unchanged.
- [packages/docs/src/demos/vbox-stack.ts](packages/docs/src/demos/vbox-stack.ts) — the precedent for a plain, labelled-cell layout-manager demo at `height: 260`.
- [plans/implemented/docs-component-demo-set.md](plans/implemented/docs-component-demo-set.md) — read `## Addendum: review pass over the rendered catalogue` for the corrected first-demo marker-placement rule this plan follows, and the original catalogue row 13 this plan's second-demo placement restores.
- [plans/docs-component-demo-set-remaining.md](plans/docs-component-demo-set-remaining.md) — restates the corrected first-demo placement rule and applies it throughout; confirms it is the codebase's current, live convention, not a superseded draft.
- [packages/lib/docs/components/Table.md:124-159](packages/lib/docs/components/Table.md#L124) and [packages/lib/docs/layouts/VBox.md:42-80](packages/lib/docs/layouts/VBox.md#L42) — shipped precedent for a page's second demo sitting at the end of the section it illustrates.
- [packages/docs/tests/demo-catalogue.test.ts](packages/docs/tests/demo-catalogue.test.ts) and [packages/docs/tests/demos.test.ts](packages/docs/tests/demos.test.ts) — the dynamically-globbing tests that cover this change with no edits of their own.
- [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) — the *Construction* rule (options bag at instantiation), already followed by `grid-uniform.ts`.

---

## Non-Goals

- **Any change to `packages/docs/src/content/blocks.ts`, `demos.ts`, or `DocsDemo.ts`.** The marker machinery and registry are unaffected; this plan only adds a module and edits marker positions in one `.md` page.
- **Any `packages/lib` source change.** `Grid`'s default equal-sized-cell behaviour already exists and needs no change.
- **Editing the page's prose or ASCII diagram.** Both are correct as written; only demo placement changes.
- **Auditing other pages for the same first-demo/section mismatch.** This plan fixes the one reported page. A page-by-page audit of every single-demo page for a similar mismatch is separate follow-up work, not part of this fix.

---

## Notes

[^why-two-demos]: Two other fixes were considered and rejected. Rewording the intro (option (b) in the originating request) would either weaken a true, useful claim about `Grid`'s default behaviour or require restructuring the paragraph around whichever demo happens to sit below it — fragile, since a future demo reshuffle would silently re-break the prose. Deleting `grid-tracks` from the top slot with no replacement was never on the table: the page would then have no demo above `## Flexible track sizing` at all, losing the "first demo introduces the component" shape every other page in the catalogue has. Adding a real uniform-grid demo costs one small module and fixes the mismatch at its actual source: the wrong demo was in the intro slot, not the wrong prose.

[^first-demo-rule]: `docs-component-demo-set.md`'s `## Addendum: review pass over the rendered catalogue` states: "Every page's *first* demo now sits between the summary paragraphs and the first `##` heading — the shape `components/Button.md` already had. A page's *second* demo (`Button`, `Table`, `VBox`) stays at the end of the section it illustrates, because it exists to illustrate that section rather than the component." `docs-component-demo-set-remaining.md`'s `## Architecture Decisions` restates the same rule as current and live: "A page's first demo goes directly after the summary paragraph, before the page's first `##` heading — not at the end of the section it illustrates." Both sources agree, and both are the only demo-catalogue plans this codebase has (one implemented, one drafted against the same live corpus), so this is the established convention as of this plan, not one interpretation among several.

[^row-major-evidence]: `Grid.md`'s own `## Usage` example adds twelve buttons labelled `'1'` through `'#'` in sequence to a `Grid({ rows: 4, columns: 3 })` and the page presents this as producing a numpad layout — which only reads correctly if the fill order is row-major (`1 2 3` / `4 5 6` / `7 8 9` / `* 0 #`). No line in `Grid.md`, `GridOptions`, or `GridConstraints`'s API pages states the fill order explicitly in prose; this is the only concrete evidence in the corpus, which is why `## Potential Challenges` flags the fallback if a manual check finds otherwise.

[^original-row-13]: `docs-component-demo-set.md`'s own catalogue originally specified this exact placement for `grid-tracks` (row 13: "Marker before: `## Cell spanning and explicit placement`"), before that plan's own Addendum introduced the top-of-page rule for a page's *first* demo and overrode it, because `grid-tracks` was that page's only demo at the time. Restoring the row-13 placement now that `grid-tracks` is the page's *second* demo is not a new invention — it is the row's original, correct second-demo placement, unreachable until this page had a first demo of its own to take the top slot.
