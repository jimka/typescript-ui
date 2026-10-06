---
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
---

# Spatial Navigation Redesign — Implementation Plan

## Overview

`SpatialNavigation` ([packages/lib/src/typescript/lib/core/SpatialNavigation.ts:761](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L761)) moves keyboard focus by direction. `Ctrl+Alt`+arrow (the *control chord*, tier `"component"`) moves to a single control. `Ctrl+Alt+Shift`+arrow (the *region chord*, tier `"target"`) moves to a marked region.

This plan replaces how the control chord chooses where to go. The new rules are written so a person can predict them: an arrow moves to the control a person would point at as "the next one that way", it never lands on something that cannot be seen, and it leaves focus where it is when nothing qualifies. The region chord keeps its ranking and landing.[^tiers]

Three things are wrong today, all confirmed by running the current code on SQLAdmin's sidebar layout (see `## Addendum: Diagnosis`):

1. **A container rule overrides geometry.** Every candidate inside the focused control's nearest collapsible or scrolling container ranks ahead of every candidate outside it. `Ctrl+Alt+→` from the last tool button of the *Database* accordion header lands on the Properties table's three-dots button about 530 px lower.
2. **Things that cannot be seen are candidates.** Controls scrolled out of any scrolling panel, clipped away, off screen, or behind a floating window all compete. A `Tree` or `Table` that takes focus shows no sign of it.
3. **"In line" wins at any distance.** A control exactly in line always beats a nearer one slightly off line, however far away the in-line one is.

The change is library-only. It adds one pure ranking module (`core/SpatialRanking.ts`), rewrites the control-chord half of `core/SpatialNavigation.ts`, and adds a little supporting API: a `navigationGroup` marker on `Component`, an optional `getScrollViewportElement()` on `FocusRevealer`, and `LayerManager.getLayerContaining()` / `getLayers()`. SQLAdmin needs no change.

**The user's feel for the result is the acceptance test.** The offline tests pin the rules; the short manual checklist in `## Expected Behaviour` is what decides whether the rules are right. Every tunable number is a named, documented constant in `core/SpatialRanking.ts`.

---

## Architecture Decisions

### Vocabulary used by every rule below

| Term | Meaning |
|---|---|
| **origin** | The focused element the move starts from. |
| **candidate** | An element the move may land on. |
| **forward gap** | Distance from the origin's edge on the arrow's side to the candidate's nearest edge, along the arrow's axis. `0` when they touch. |
| **side gap** | How far the two rectangles fail to overlap on the other axis. `0` when they overlap at all. |
| **in line** | The two rectangles overlap on the other axis by more than zero. Touching edges do not count. |
| **in the cone** | `side gap ≤ CONE_SLOPE × forward gap`. With `CONE_SLOPE = 1` the candidate is at least as far forward as it is sideways. |
| **group** | An element marked `data-ts-ui-navigation-group`: one row or column of related controls. |
| **roving group** | Controls that share one Tab stop through `RovingTabIndex`; every member carries `data-ts-ui-roving-member`. A roving group is not automatically a group. |
| **scroll viewport** | The element whose box is the visible window onto scrolled content, reported by a registered `FocusRevealer`. |
| **search root** | The element the whole search stays inside. |
| **in view** | Some part of the element is actually on screen (rule C4). |

### Precedent — which established ideas this design takes

The in-repo precedent for *ranking* is the code being replaced, so the ranking rules lean on external designs. The in-repo precedent for *scopes and markers* is kept.

| Idea | Source | Used here |
|---|---|---|
| Search the nearest container first, then walk outward | W3C CSS Spatial Navigation, "spatial navigation container" steps | Yes — rule S1 |
| A scroll container is a container; exhaust it before leaving it | W3C | Yes — rule S1, scroll viewports |
| Only candidates at least partly visible count | W3C `visibleOnly` | Yes — rule C4 |
| One distance: forward distance plus weighted sideways distance | W3C distance function | Yes — the score |
| An off-line candidate also pays half the origin's width or height | W3C `orthogonalBias` | Yes — the score |
| Ties go to document order | W3C | Yes — rule D1 |
| A candidate "in the beam" is preferred | Android `FocusFinder.beamBeats` | Yes, but as score and acceptance, never as an unconditional first tier |
| Named focus containers; a row is searched as a row | Norigin Spatial Navigation, BBC LRUD | Yes — groups |
| Scroll the container one step when nothing is visible | W3C | No — the next hidden control is focused and scrolled into view |
| Remember the last-focused child when entering a container | Norigin, LRUD | No for the control chord — the region chord already does it |
| Different sideways weights for left/right (30) and up/down (2) | W3C | No — one weight |

Each choice is explained in [^w3c] and [^tv].

In-repo precedents followed:

- **Marker attribute mirrored by a `Component` setter**: [`Component.setNavigationTarget`](packages/lib/src/typescript/lib/core/Component.ts#L2358) and `setTabKeyOwner`. `navigationGroup` copies that shape exactly.[^group-marker]
- **Containers that register themselves**: [`FocusReveal`](packages/lib/src/typescript/lib/core/FocusReveal.ts#L15) and [`LayerManager`](packages/lib/src/typescript/lib/core/LayerManager.ts#L658). Scroll viewports and layer scopes are read from those two registries; no third registry is added.
- **A focus ring painted as an inset `::after`**: [`.List:focus::after`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L216) and [`registerFocusVisibleRing`](packages/lib/src/typescript/lib/component/input/focusRing.ts#L112).

### The region chord is unchanged, apart from the search root

Tier `"target"` keeps `rankInDirection`, `rankWithContainerPriority`, `targetLandings` and its focus memory exactly as they are on `master`. It shares only rule R1 (the search root) with the control chord.[^tiers]

### R1 — The search root is the layer the origin is in

A *layer* is a floating surface registered with `LayerManager`: a window, drawer, dialog, menu or dropdown.

- The search root is the element of the registered layer that contains the origin. If no layer contains the origin, or nothing is focused, the search root is `<body>`.
- The service still stands down completely while any layer that takes input is open (a modal dialog, menu, dropdown or popover). `claimsKey` is not changed.

| Open layers | Focus is in | Search root | Effect |
|---|---|---|---|
| none | main page | `<body>` | whole page |
| one floating window | that window | the window's element | moves never leave the window |
| one floating window | main page | `<body>` | moves never enter the window |
| modal dialog | anywhere | — | service stands down, as today |

Today the root is always the topmost layer, so with a window open every chord pressed in the main page jumps into the window.[^layer-root]

### C — Which elements are candidates

An element is a candidate for the control chord only when **all** of C1–C6 hold. Each rule is one assertion a test can make.

| Rule | Requirement | Read through |
|---|---|---|
| C1 focusable | Matches `FOCUSABLE_SELECTOR` or carries `data-ts-ui-roving-member`; is inside the search root; is not the origin | one `querySelectorAll` |
| C2 enabled | No `disabled` attribute, and `aria-disabled` is not `"true"` | `hasAttribute`, `getAttribute` |
| C3 rendered | `DOM.source.isRenderedVisible` — no `display: none` or `visibility: hidden` on the element or any ancestor | existing |
| C4 in view | Its *view rectangle* shows at least `MIN_VISIBLE_PX` (4) on each axis — or its whole extent, when the element is smaller than that | below |
| C5 not covered | Its view rectangle is not entirely inside the element of an open layer stacked above the search root | `LayerManager.getLayers` |
| C6 a leaf | Survives the existing [`leafFocusables`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L402) filter, unchanged | existing |

**View rectangle.** Take the element's own rectangle. Intersect the rectangle with the rectangle of every *clipping ancestor* from its parent up to and including the search root. Then intersect with the browser viewport `(0, 0, viewport width, viewport height)`. A clipping ancestor is one whose computed `overflow`, `overflow-x` or `overflow-y` is anything but `visible`, or which carries `data-ts-ui-clip-frame`. `<body>` and `<html>` are never clipping ancestors; the viewport stands in for them.[^body-clip]

The view rectangle is also the rectangle the candidate is ranked by, so a half-hidden control is measured by the half that shows.

What C3–C5 exclude, in the cases the user reported:

| Case | Excluded by |
|---|---|
| Content of a collapsed accordion section (wrapper clips to zero height) | C4 |
| A page behind an inactive tab, a `Card` page, a collapsed `Split` pane or `Border` region (`display: none`) | C3 |
| A control scrolled out of a scrolling panel or tab strip | C4 — see V1 for the one exception |
| A control with zero width or zero height | C4 |
| A control outside the browser window | C4 |
| A control wholly hidden behind a floating window | C5 |
| A disabled `ComboBox`, `Checkbox` or `Slider` inside a `ToolBar` | C2 |

**V1 — the one exception to C4: scrolled out of the origin's own scroll viewport.** A control that fails C4 is still a candidate at the level of a scroll viewport `S` (see S1) when `S` contains both the control and the origin, and nothing *inside* `S` clips the control away. The control's rectangle at that level is its own rectangle intersected only with the clipping ancestors strictly inside `S`. A control scrolled out of a viewport that does not contain the origin is never a candidate.

**Opting in and out.** A control takes part by being focusable. There is no separate opt-out flag: `tabindex="-1"` outside a roving group, `disabled`, or `aria-disabled="true"` removes it.

How the composite widgets take part:

| Widget | Candidates it contributes | Group? |
|---|---|---|
| `ToolBar`, `TabBar` | every enabled member, not only the current tab stop | yes |
| `MenuBar` | every menu button | yes |
| `AccordionHeader` | its title button and each tool button | yes |
| `ButtonGroup` | every enabled member | no — its container is not a `Component` the library owns |
| `Tree`, `Table` body, `List` | one candidate: the widget itself | no |
| A tab's ✕ button | a candidate, but never chosen from its own tab or a neighbour | — |

The tab ✕ row describes today's behaviour too, and is not changed.[^close-button]

### O1 — The rectangle the move starts from

1. If the origin has an `aria-activedescendant` attribute that names an element inside the origin, and that element has a view rectangle (C4), the move starts from that element. This is the focused row of a `Tree` or `List` and the focused cell of a `Table`.[^active-descendant]
2. Otherwise the move starts from the origin's own view rectangle.
3. If step 2 gives nothing — the origin itself was scrolled or clipped out of sight — the move starts from the view rectangle of the origin's nearest ancestor that has one.
4. If no ancestor has one, the move returns `false`.

| Origin | Move starts from |
|---|---|
| a button | the button |
| a `Tree` whose current row is on screen | that row, not the 500 px-tall tree |
| a `Tree` with no current row | the whole tree |
| a button the user scrolled out of its panel with the mouse wheel | the panel's visible box |

### S1 — Search order: group, then scroll viewports, then the search root

Walk from the origin's parent up to, but not including, the search root. Each ancestor that is a **group** or a **scroll viewport containing the origin** is one *level*, innermost first. The search root is the last level.

| Level | Candidates considered | A candidate is accepted when it is ahead and… |
|---|---|---|
| a group | in-view candidates inside the group | in line with the origin |
| a scroll viewport `S` | every candidate inside `S`, in view or scrolled out of `S` (V1) | in line with the origin |
| the search root | every in-view candidate | in line with the origin, **or** in the cone, **or** in line with the origin's nearest group |

"Ahead" means the forward gap is not negative by more than `EDGE_TOLERANCE_PX` (1). A candidate that contains the origin, or sits inside it, is never ahead.

The first level that has an accepted candidate decides the move. Its accepted candidates are ordered by rule SC1 and tried best-first. If every one refuses focus, the search continues at the next level.

Inner levels accept only in-line candidates, so a group or a scrolling panel can keep a move *along its row or column* but can never pull a move sideways onto something far away.[^line-only]

**What makes a group.** `Component.setNavigationGroup(true)`, or the `navigationGroup` option, writes `data-ts-ui-navigation-group="true"` on the element. `ToolBar`, `MenuBar`, `TabBar` and `AccordionHeader` default it to `true`. An app marks its own row of controls the same way.[^group-marker]

**What makes a scroll viewport.** A registered `FocusRevealer` that implements the new optional `getScrollViewportElement()`. `Panel` (registered only while `autoScroll` is on) returns its scroll element; `ScrollStrip` returns its clip element. `Accordion`, `Tab`, `Split` and `Border` do not implement it, so they are no longer levels.[^scroll-viewport]

What groups do that geometry alone would not:

| Layout | Move | Geometry alone | With groups |
|---|---|---|---|
| Menu bar `[File][Query][View] ……800 px gap…… [Shortcuts]`, a toolbar button just below-right of *View* | `→` from *View* | the toolbar button (score 33 beats 760) | *Shortcuts* — the row continues |
| Tool bar button at x 300–320; a form field below at x 0–250, 8 px down | `↓` from the button | nothing: the field is neither in line nor in the cone | the field — it is in line with the tool bar as a whole |

### SC1 — The score

For each accepted candidate:

```
offAxis = 0                                    when the candidate is in line
offAxis = sideGap + (origin's extent on the side axis) / 2      otherwise
score   = round(forwardGap + OFF_AXIS_WEIGHT × offAxis)
```

Lower is better. `OFF_AXIS_WEIGHT` is `2`.

The off-line term measures from the origin's centre line, so a wide origin treats off-line candidates as further off than a small origin does.[^off-line-bias]

Worked cases. Origin `O = (left 0, top 0, right 100, bottom 20)`, arrow `east`, so the side axis is vertical and the origin's side extent is 20:

| Candidate (left, top, right, bottom) | Forward | Side gap | In line / cone | Score | Outcome at the search root |
|---|---|---|---|---|---|
| A `(120, 0, 160, 20)` | 20 | 0 | in line | **20** | wins |
| C `(150, 40, 190, 60)` | 50 | 20 | cone (20 ≤ 50) | 50 + 2×(20+10) = **110** | second |
| B `(105, 30, 140, 50)` | 5 | 10 | neither (10 > 5) | — | rejected |
| F `(700, 0, 760, 20)` | 600 | 0 | in line | **600** | loses to N |
| N `(110, 24, 150, 44)` | 10 | 4 | cone | 10 + 2×(4+10) = **38** | beats F: near and slightly off line beats far and in line |

At a group or scroll-viewport level only A and F are accepted, so F beats N there. That is intended: inside a row, the row wins.

The three tunable numbers, the cone slope, and the visibility floor live together:

| Constant | Value | Meaning |
|---|---|---|
| `EDGE_TOLERANCE_PX` | 1 | how far a candidate may overlap the origin's forward edge and still count as ahead |
| `OFF_AXIS_WEIGHT` | 2 | cost of one sideways pixel, in forward pixels |
| `CONE_SLOPE` | 1 | most sideways distance allowed per forward pixel, for a candidate that is not in line |
| `MIN_VISIBLE_PX` | 4 | least visible width and height for a control to count as in view |

Reasons for each value: [^weight], [^cone], [^min-visible]. All four are module constants in `core/SpatialRanking.ts` and nowhere else.[^one-place]

### D1 — Determinism

- Candidates are read with **one** `querySelectorAll` over `FOCUSABLE_SELECTOR + ", " + ROVING_MEMBER_SELECTOR`, so the list is in document order.[^dom-order]
- Scores are rounded to whole pixels. Equal scores keep document order (`Array.prototype.sort` is stable).
- Nothing else enters the choice: no timestamps, no focus memory, no registration order.

The same layout and the same origin always give the same landing.

### N1 — No candidate: stay put

When no level has an accepted candidate that takes focus, `move()` returns `false`. It calls neither `focus` nor `blur`, writes no marker, scrolls nothing, and changes no component state. The keydown is still consumed, as today.

A candidate is scrolled into view (`FocusReveal.reveal`) only **after** it has taken focus, so a candidate that refuses focus leaves no trace.[^reveal-after-focus]

### L1 — A landing always shows

`Tree` and the `Table` body are each one focus stop, and neither shows anything when the element itself gains focus. Both get an inset focus ring that is painted only while the element carries `data-ts-ui-focus-visible` — the marker the service already writes on every landing and removes on `focusout`.[^landing-ring]

### How geometry reaches the tests

The offline harness has no layout. Tests supply geometry the way [`tests/unit/core/SpatialNavigation.test.ts`](packages/lib/tests/unit/core/SpatialNavigation.test.ts#L43) already does:

| Need | How |
|---|---|
| an element's rectangle | `place(handle, left, top, right, bottom)` — writes inline `left/top/width/height`, which `TestDOM.getElementRect` composes. A child's numbers are relative to its placed parent |
| a clipping ancestor | `vi.spyOn(DOM.source, 'getComputedOverflow')` returning `hidden` for chosen handles (precedent at [line 709](packages/lib/tests/unit/core/SpatialNavigation.test.ts#L709)) |
| the browser viewport | `installTestDOM({ viewport })` |
| hidden by `display: none` | `setRenderedVisible(handle, false)` |
| the candidate list, in document order | `setQuerySelectorAllResult(root, NAVIGATION_CANDIDATE_SELECTOR, handles)` |
| a scroll viewport | a fake `FocusRevealer` with `getScrollViewportElement` (extend `registerFakeRevealer`, [line 65](packages/lib/tests/unit/core/SpatialNavigation.test.ts#L65)) |
| a layer | `LayerManager.register({ getLayerElement, getDismissMode: () => 'manual', requestClose })` (precedent at [line 794](packages/lib/tests/unit/core/SpatialNavigation.test.ts#L794)) |
| pure ranking | `Rect` literals passed to `rankLevel` — no harness at all |

### Worked example — the *Database* tool buttons and the three-dots button

SQLAdmin's sidebar at a 1500 × 850 window. The three-dots button is the Properties table header's *Column options* button. Rectangles are `left–right × top–bottom`.[^geometry-source]

| Control | Rectangle | Notes |
|---|---|---|
| *Database* title button | 47–181 × 59–81 | accordion header, group `header0` |
| *Create schema* | 183–205 × 59–81 | group `header0` |
| *Show diagram* | 209–231 × 59–81 | group `header0` |
| *Refresh* | 235–257 × 59–81 | group `header0`; the chevron at 259–273 is not focusable |
| navigator tree | 41–279 × 81–585 | one focus stop |
| *Properties* title button | 47–257 × 587–609 | group `header1` |
| *Column options* (three dots) | 262–274 × 614–634 | its left edge (262) is right of *Refresh*'s right edge (257) |
| table body | 46–274 × 635–824 | one focus stop |
| first dock tab | 281–380 × 57–81 | present only when a tab is open |
| *Run* (query tool bar) | 284–306 × 83–101 | present only in a query tab |

**Move: `Ctrl+Alt+→` from *Refresh*.**

*What `master` picks: Column options.* *Refresh* is inside the sidebar's `Accordion`, which is a registered `FocusRevealer`. [`rankWithContainerPriority`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L559) ranks every candidate inside that container before every candidate outside it. *Column options* is the only candidate inside the accordion whose left edge is right of *Refresh*, so it ranks first — ahead of the dock tab 24 px away in the same row.

*What the parked branch picks: the dock tab when one is open, Column options otherwise.* The parked branch is `feature/spatial-navigation-container-priority-band`, an earlier unmerged attempt. It ranks in-line candidates first and applies the container rule after that. With no control in rows 59–81 east of *Refresh* (the start page, for example), nothing is in line, the container rule decides again, and the result is the same jump.

*What the new rules pick:*

| Level | Candidate | Forward | Side gap | Accepted? | Score |
|---|---|---|---|---|---|
| group `header0` | — nothing east of *Refresh* in the header | | | | |
| search root | *Column options* | 5 | 533 | **no** — not in line, 533 > 1 × 5, not in line with `header0` | — |
| search root | first dock tab | 24 | 0 | yes, in line | **24** |
| search root | *Run* | 27 | 2 | yes, cone | 27 + 2×(2+11) = 53 |

| Dock contents | `→` from *Refresh* lands on |
|---|---|
| a tab is open | the first dock tab |
| a query tab's tool bar but no control in rows 59–81 | *Run* |
| nothing within the cone (start page with no nearby control) | nowhere — focus stays on *Refresh* |

*Column options* is rejected in all three.

### The parked branch and the old plan

- **Parked branch `feature/spatial-navigation-container-priority-band` — nothing is merged or cherry-picked.** All five commits are dropped.[^parked]
- **Salvaged as test cases, re-derived under the new rules:** the SQLAdmin editor case (`Ctrl+Alt+←` from the SQL editor must reach the tree, case E-13) and the scrolled-column case (E-20).
- **`plans/spatial-navigation-container-priority-band.md` is deleted** by this plan's bookkeeping. It describes an approach this plan replaces.
- The implementer does **not** delete the parked branch or its worktree. The user removes them after this plan merges:
  `git worktree remove .worktrees/spatial-navigation-container-priority-band && git branch -D feature/spatial-navigation-container-priority-band`.

---

## Public API

```ts
// core/Component.ts
export const NAVIGATION_GROUP_ATTR = "data-ts-ui-navigation-group";

export interface ComponentOptions {
    /** Marks this component as a spatial-navigation group — see `setNavigationGroup`. */
    navigationGroup?: boolean;
}

class Component {
    setNavigationGroup(value: boolean): this;   // caches in this._options.navigationGroup
    isNavigationGroup(): boolean;               // _options ?? _defaultOptions ?? false
}
```

There is no separate backing field: `_options.navigationGroup` is the cache, and `applyOptions` always dispatches the setter, exactly like `navigationTarget` ([Component.ts:992](packages/lib/src/typescript/lib/core/Component.ts#L992)).

```ts
// core/FocusReveal.ts
export interface FocusRevealer {
    getRevealElement(): Handle | null;
    revealDescendant(target: Handle): void;
    /**
     * Implemented only by a revealer that reveals by scrolling: the element
     * whose box is the visible window onto its scrolled content. Null when
     * unrendered.
     */
    getScrollViewportElement?(): Handle | null;
}
```

```ts
// core/LayerManager.ts
export namespace LayerManager {
    /** The registered layer whose element contains `target`, or null. */
    export function getLayerContaining(target: Handle): DismissableLayer | null;
    /** Every registered layer, in registration order. */
    export function getLayers(): readonly DismissableLayer[];
}
```

Unchanged: `SpatialNavigation.enable / disable / isEnabled / configure / claimsKey / move`, `rankInDirection`, and every exported type. `core/index.ts` needs no edit.

Module exports that are **not** part of the public API, because no package entry point re-exports them: everything in `core/SpatialRanking.ts`; `NAVIGATION_CANDIDATE_SELECTOR` in `core/SpatialNavigation.ts` (for tests); and the new `registerNavigationLandingRing(baseSelector: string): void` in `component/input/focusRing.ts`.

---

## Internal Structure

### `core/SpatialRanking.ts` — pure, reads no DOM

`project`, `gapBetween`, `spansOverlap` and the `Span` interface **move** here from `SpatialNavigation.ts` unchanged and are exported; `SpatialNavigation.ts` imports them for `rankInDirection`. The new code:

```ts
import type { Handle, Rect } from "~/core/DOM.js";
import type { SpatialCandidate, SpatialDirection } from "~/core/SpatialNavigation.js";

export const EDGE_TOLERANCE_PX: number = 1;
export const OFF_AXIS_WEIGHT:   number = 2;
export const CONE_SLOPE:        number = 1;
export const MIN_VISIBLE_PX:    number = 4;

/** Which candidates a search level accepts: in-line only, or also cone and group-line. */
export type LevelAcceptance = "line" | "open";

/** One candidate measured against the origin for a direction. */
export interface DirectionalMeasure {
    forwardGap:       number;
    sideGap:          number;
    inLine:           boolean;
    originSideExtent: number;
}

/** Null when the candidate is not ahead of the origin. */
export function measureInDirection(origin: Rect, candidate: Rect, direction: SpatialDirection): DirectionalMeasure | null {
    const { primary, originSpan, candidateSpan } = project(origin, candidate, direction);

    if (primary < -EDGE_TOLERANCE_PX) {
        return null;
    }

    return {
        forwardGap:       Math.max(0, primary),
        sideGap:          gapBetween(originSpan, candidateSpan),
        inLine:           spansOverlap(originSpan, candidateSpan),
        originSideExtent: originSpan.end - originSpan.start,
    };
}

/** Whether `candidate` overlaps `reference` on the side axis of `direction`. */
export function isInLineWith(reference: Rect, candidate: Rect, direction: SpatialDirection): boolean {
    const { originSpan, candidateSpan } = project(reference, candidate, direction);

    return spansOverlap(originSpan, candidateSpan);
}

/** Rule SC1. */
export function scoreOf(measure: DirectionalMeasure): number {
    const offAxis = measure.inLine ? 0 : measure.sideGap + measure.originSideExtent / 2;

    return Math.round(measure.forwardGap + OFF_AXIS_WEIGHT * offAxis);
}

/** Accepted candidates of one level, best first; equal scores keep the supplied order. */
export function rankLevel(
    origin:     Rect,
    candidates: readonly SpatialCandidate[],
    direction:  SpatialDirection,
    acceptance: LevelAcceptance,
    groupRect:  Rect | null,
): Handle[] {
    const scored: Array<{ handle: Handle; score: number }> = [];

    for (const { handle, rect } of candidates) {
        const measure = measureInDirection(origin, rect, direction);

        if (measure === null) {
            continue;
        }

        const accepted = isAccepted(measure, rect, direction, acceptance, groupRect);

        if (accepted) {
            scored.push({ handle, score: scoreOf(measure) });
        }
    }

    // Array.prototype.sort is stable, so equal scores keep the supplied (document) order.
    scored.sort((a, b) => a.score - b.score);

    return scored.map(entry => entry.handle);
}

/** Rule S1's acceptance test for one measured candidate. Module-private. */
function isAccepted(
    measure:    DirectionalMeasure,
    rect:       Rect,
    direction:  SpatialDirection,
    acceptance: LevelAcceptance,
    groupRect:  Rect | null,
): boolean {
    if (measure.inLine) {
        return true;
    }

    if (acceptance === "line") {
        return false;
    }

    if (measure.sideGap <= CONE_SLOPE * measure.forwardGap) {
        return true;
    }

    return groupRect !== null && isInLineWith(groupRect, rect, direction);
}
```

Each constant carries a comment stating what it is and why it has that value; take the "why" from the matching footnote. The snippets here carry one-line summaries to stay short; the real file documents every parameter and return value as `CODE_CONVENTIONS.md` requires.

The type import from `SpatialNavigation.ts` is type-only, so the two modules do not form a runtime cycle.

### `core/SpatialNavigation.ts` — the control chord

The one new module export, and the module-private shapes:

```ts
export const NAVIGATION_CANDIDATE_SELECTOR: string = FOCUSABLE_SELECTOR + ", " + ROVING_MEMBER_SELECTOR;

/** One clipping ancestor and its rectangle. */
interface ClipBox { handle: Handle; rect: Rect; }

/** One element with the geometry every rule needs. */
interface Control {
    handle: Handle;
    rect:   Rect;          // own rectangle
    clips:  ClipBox[];     // clipping ancestors, innermost first, up to and including the search root
    view:   Rect | null;   // view rectangle, or null when it fails C4 or C5
}

interface SearchLevel { kind: "group" | "viewport"; element: Handle; }

/** Per-move cache: an ancestor's clip box, or null when that ancestor does not clip. */
type ClipCache = Map<Handle, ClipBox | null>;
```

Module-private functions, each with one job:

| Function | Contract |
|---|---|
| `searchRoot(origin: Handle \| null): Handle` | Rule R1 |
| `clipBoxOf(handle, cache): ClipBox \| null` | Reads `getComputedOverflow` and `CLIP_FRAME_ATTR` once per ancestor per move |
| `clipChain(handle, root, cache): ClipBox[]` | Walks `ancestorsToDocument(parent)`; skips `<body>` and `<html>`; stops after `root` |
| `clipTo(rect, boxes): Rect` | Repeated `intersectRects` |
| `hasExtent(clipped, full): boolean` | `full` is non-empty and `clipped` shows `min(MIN_VISIBLE_PX, full extent)` on both axes |
| `coveringRects(root): Rect[]` | Rule C5 — rectangles of layers above the search root's layer |
| `describeControl(handle, root, cache, covers): Control` | Fills `rect`, `clips`, `view` |
| `collectControls(root, origin, cache, covers): Control[]` | Rules C1–C3 and C6, then `describeControl` |
| `originAnchor(origin, root, cache): Control` | Rule O1 steps 1–2: the described active descendant when it has a view rectangle, else the described origin |
| `scrollViewportsOf(origin): Set<Handle>` | From `FocusReveal.containing(origin)` |
| `searchLevels(origin, root): SearchLevel[]` | Rule S1 |
| `contentRectIn(control, viewport): Rect` | Rule V1 rectangle |
| `moveComponentFocus(direction, origin, root): boolean` | The loop below |

The three bodies that are easy to get wrong:

```ts
function clipChain(handle: Handle, root: Handle, cache: ClipCache): ClipBox[] {
    const parent = DOM.source.getParentNode(handle);
    const boxes: ClipBox[] = [];

    if (parent === null) {
        return boxes;
    }

    const body            = DOM.source.getBody();
    const documentElement = DOM.source.getDocumentElement();

    for (const ancestor of ancestorsToDocument(parent)) {
        if (ancestor !== body && ancestor !== documentElement) {
            const box = clipBoxOf(ancestor, cache);

            if (box !== null) {
                boxes.push(box);
            }
        }

        if (ancestor === root) {
            break;
        }
    }

    return boxes;
}

function contentRectIn(control: Control, viewport: Handle): Rect {
    // `contains` is inclusive, so the viewport itself must be excluded by hand.
    const inside = control.clips.filter(box =>
        box.handle !== viewport && DOM.source.contains(viewport, box.handle));

    return clipTo(control.rect, inside);
}

function searchLevels(origin: Handle, root: Handle): SearchLevel[] {
    const viewports = scrollViewportsOf(origin);
    const levels: SearchLevel[] = [];

    for (const ancestor of ancestorsBefore(origin, root)) {
        if (viewports.has(ancestor)) {
            levels.push({ kind: "viewport", element: ancestor });
        } else if (DOM.source.hasAttribute(ancestor, NAVIGATION_GROUP_ATTR)) {
            levels.push({ kind: "group", element: ancestor });
        }
    }

    return levels;
}
```

`scrollViewportsOf` keeps a revealer's `getScrollViewportElement?.()` result only when it is non-null, is not the origin, and contains the origin. A `ScrollStrip`'s arrow buttons sit inside the strip but outside its clip, so the containment check on the viewport element — not on the reveal element — is required.

The move:

```
moveComponentFocus(direction, origin, root):
    cache    = new Map
    covers   = coveringRects(root)
    controls = collectControls(root, origin ?? body, cache, covers)
    inView   = controls with view !== null

    if origin is null:                       # nothing focused, or <body> focused
        list = (south or east) ? inView : reversed inView
        return tryFocusCandidates(handles of list, "component")

    anchor     = originAnchor(origin, root, cache)
    originView = anchor.view ?? view of the nearest ancestor of origin that has one
                 # walk ancestorsBefore(origin, root), describing each with describeControl(…, [])
    if originView is null: return false

    pruneStaleMemory(); recordOrigin(origin)   # unchanged; keeps the region chord's memory current

    levels = searchLevels(origin, root)
    for level of levels:
        if level.kind == "group":
            from = originView
            pool = inView inside level.element, each ranked by its view
        else:
            from = contentRectIn(anchor, level.element); skip the level when hasExtent(from, anchor.rect) is false
            pool = controls inside level.element, each ranked by contentRectIn(control, level.element),
                   kept only when hasExtent(that rect, control.rect)
        ranked = rankLevel(from, pool, direction, "line", null)
        if tryFocusCandidates(ranked, "component"): return true

    group     = first level with kind "group", if any
    groupRect = group ? describeControl(group.element, root, cache, []).view : null
    ranked    = rankLevel(originView, inView ranked by view, direction, "open", groupRect)
    return tryFocusCandidates(ranked, "component")
```

"Inside `X`" is `DOM.source.contains(X, handle)`.

`collectControls` reads `DOM.source.querySelectorAll(root, NAVIGATION_CANDIDATE_SELECTOR)`, drops the origin, drops C2 and C3 failures, runs `leafFocusables` on what is left, then maps each survivor through `describeControl`.

`coveringRects(root)`: let `rootLayer = LayerManager.getLayerContaining(root)` (null for `<body>`). Keep each layer from `LayerManager.getLayers()` that is not `rootLayer` and — when `rootLayer` is not null — has a higher `LayerManager.getZIndex`. Return the `getElementRect` of each kept layer's non-null, rendered-visible `getLayerElement()`.

`tryFocusCandidates` for tier `"component"` changes order: focus with `{ preventScroll: true }`, check `getActiveElement() === landing`, and only then call `FocusReveal.reveal(landing)` and write the marker. Tier `"target"` keeps reveal-before-focus.

`moveFocus` becomes a short dispatcher: resolve `origin` (null when nothing or `<body>` is focused), resolve `root = searchRoot(origin)`, then call `moveComponentFocus` for `"component"` or the existing target-tier code — moved into its own `moveTargetFocus(direction, origin, root)` — for `"target"`.

---

## Ordered Implementation Steps

Work test-first: in each step write the listed tests, see them fail, then make them pass. Run only the named test file until step 12.

1. **Pure ranking module.** Create `packages/lib/tests/unit/core/SpatialRanking.test.ts` with cases E-1 to E-9. Create `packages/lib/src/typescript/lib/core/SpatialRanking.ts` as in `## Internal Structure`. Move `Span`, `project`, `gapBetween`, `spansOverlap` out of `SpatialNavigation.ts` into it and import them back.
   Check: `cd packages/lib && npx vitest run tests/unit/core/SpatialRanking.test.ts tests/unit/core/SpatialNavigation.test.ts` — all pass; `grep -n "^function project\|^function gapBetween\|^function spansOverlap" src/typescript/lib/core/SpatialNavigation.ts` — zero matches.

2. **`navigationGroup` on `Component`.** In `packages/lib/tests/component/default-options-fallback.test.ts`, copy the `describe('isNavigationTarget folds a subclass navigationTarget default', …)` block ([line 808](packages/lib/tests/component/default-options-fallback.test.ts#L808)) as a `navigationGroup` block (attribute key `ts-ui-navigation-group`). In `packages/lib/src/typescript/lib/core/Component.ts`: add `NAVIGATION_GROUP_ATTR` beside `NAVIGATION_TARGET_ATTR` ([line 522](packages/lib/src/typescript/lib/core/Component.ts#L522)); add `navigationGroup?: boolean` beside `navigationTarget` ([line 174](packages/lib/src/typescript/lib/core/Component.ts#L174)); add the always-dispatch line after [line 992](packages/lib/src/typescript/lib/core/Component.ts#L992); add `setNavigationGroup` / `isNavigationGroup` directly after `isNavigationTarget` ([line 2376](packages/lib/src/typescript/lib/core/Component.ts#L2376)), bodies identical to the `navigationTarget` pair with the names swapped.

3. **Default groups.** Create `packages/lib/tests/component/navigationGroupDefaults.test.ts` asserting `isNavigationGroup()` is `true` for `new ToolBar()`, `new MenuBar()`, `new TabBar()` and `new AccordionHeader("x")`, and `false` for `new Component()` and `new Panel()`. Add `navigationGroup: true` to `_defaultToolBarOptions` ([ToolBar.ts:96](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L96)), `_defaultMenuBarOptions` ([MenuBar.ts:45](packages/lib/src/typescript/lib/component/menubar/MenuBar.ts#L45)), `_defaultTabBarOptions` ([TabBar.ts:460](packages/lib/src/typescript/lib/component/container/TabBar.ts#L460)) and `_defaultAccordionHeaderOptions` ([AccordionHeader.ts:151](packages/lib/src/typescript/lib/component/container/AccordionHeader.ts#L151)), each with a one-line comment. `_defaultAccordionHeaderOptions` also feeds that class's `ownClassStyleDefaults`; a non-style key there is harmless, as `navigationTarget` in `ToolBar`'s bag already shows. The test installs the offline harness first, as every component test does.

4. **Scroll viewports.** Add `getScrollViewportElement?(): Handle | null` to `FocusRevealer` ([FocusReveal.ts:15](packages/lib/src/typescript/lib/core/FocusReveal.ts#L15)). Implement in `Panel` after `getRevealElement` ([Panel.ts:632](packages/lib/src/typescript/lib/core/Panel.ts#L632)): `return this.getScrollElement() ?? this.getElement() ?? null;`. Override in `ScrollStrip` beside `revealDescendant` ([ScrollStrip.ts:969](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L969)): `return this._clip.getElement() ?? null;`. Tests: in `packages/lib/tests/component/container/ScrollStrip.test.ts` next to the `getRevealElement` test ([line 260](packages/lib/tests/component/container/ScrollStrip.test.ts#L260)), assert the strip returns its clip's element and not its own; create `packages/lib/tests/core/PanelScrollViewport.test.ts` asserting a rendered `Panel` returns its own element.

5. **Layer accessors.** In `packages/lib/tests/overlay/LayerManager.test.ts` add: `getLayerContaining` returns the layer whose element contains a node and `null` for a node in no layer; `getLayers` lists registered layers in order and is empty after they unregister. In `packages/lib/src/typescript/lib/core/LayerManager.ts` add both functions after `getTopLayer` ([line 469](packages/lib/src/typescript/lib/core/LayerManager.ts#L469)): `getLayerContaining` returns `nodeOwning(target)?.layer ?? null`; `getLayers` returns `_stack.map(node => node.layer)`.

6. **Rework the service tests.** In `packages/lib/tests/unit/core/SpatialNavigation.test.ts`:
   - First add the one-line `NAVIGATION_CANDIDATE_SELECTOR` export to `SpatialNavigation.ts` (see `## Internal Structure`) so the test file compiles; nothing reads it yet. Import it in the test file. In every test that calls `SpatialNavigation.move(…, 'component')` or dispatches the control chord, replace `setQuerySelectorAllResult(root, FOCUSABLE_SELECTOR, list)` with `setQuerySelectorAllResult(root, NAVIGATION_CANDIDATE_SELECTOR, list)`. Where a test also seeds `ROVING_MEMBER_SELECTOR`, merge those handles into the one list in document order and delete the second seed. Leave every `'target'` test's seeds alone.
   - Add helpers: `clipping(...handles)` (the `getComputedOverflow` spy), `placeIn(parent, child, pageRect)` (subtracts the parent's `left`/`top`), `markNavigationGroup(handle)`, and a `registerFakeRevealer(element, scrollViewport?)` that sets `getScrollViewportElement` when the second argument is given.
   - Rewrite the three tests in `describe('SpatialNavigation.move — scrolling-container priority', …)` ([line 811](packages/lib/tests/unit/core/SpatialNavigation.test.ts#L811)) as E-20, E-21 and "no scroll viewport ranks at the search root". The container must now be placed, clipping, and registered as a scroll viewport.
   - Rewrite the test at [line 769](packages/lib/tests/unit/core/SpatialNavigation.test.ts#L769) as: a candidate appended directly under `documentElement` is measured without the clip walk reading past `documentElement`. Seed the candidate on `<body>`; keep the throwing `getComputedOverflow` spy for the `document` stand-in.
   - In `describe('SpatialNavigation.move — no genuine origin', …)` the candidates are deliberately unplaced. An unplaced handle has a zero rectangle and is no longer a candidate (C4), so `place` each one inside the viewport. Keep those tests proving document order: place the first candidate *below* the second, so a geometric ranking would give the opposite answer.
   - Add cases E-10 to E-34.
   Check: the new cases and the converted control-chord tests fail (the service still reads the old selectors until step 7); every `'target'`, `claimsKey` and `rankInDirection` test still passes.

7. **Rewrite the control chord** in `packages/lib/src/typescript/lib/core/SpatialNavigation.ts` as in `## Internal Structure`. Split `moveFocus` into the dispatcher, `moveComponentFocus` and `moveTargetFocus`. Reduce `collectCandidates` to its target branch and rename it `collectTargets(root, origin)`. Change `tryFocusCandidates` as described. Delete what the control chord no longer uses: `mergeHandles`, `rovingGroupMembers`, and the `visibleFocusable` and `focusScopeRoot` imports. Keep `ancestorGeometry`, `effectiveRect`, `nearestRevealerElement`, `rankWithContainerPriority` and `rankInDirection` — the region chord uses them. Update the `SpatialNavigation` namespace JSDoc to describe the new control-chord rules in two or three sentences, with no `{@link}` to `SpatialRanking`.
   Check: `npx vitest run tests/unit/core/SpatialNavigation.test.ts tests/unit/core/SpatialRanking.test.ts` — all pass. `grep -n "focusScopeRoot\|rovingGroupMembers\|mergeHandles" src/typescript/lib/core/SpatialNavigation.ts` — zero matches. `grep -n "rankWithContainerPriority(" src/typescript/lib/core/SpatialNavigation.ts` — the definition plus exactly one call, inside `moveTargetFocus`.

8. **Landing ring.** In `packages/lib/tests/component/input/focusRing.test.ts` add a test that `registerNavigationLandingRing('.X, .Y')` registers one rule for `.X[data-ts-ui-focus-visible]::after, .Y[data-ts-ui-focus-visible]::after` and one for `.X[data-ts-ui-focus-visible], .Y[data-ts-ui-focus-visible]`. In `packages/lib/src/typescript/lib/component/input/focusRing.ts` add `registerNavigationLandingRing` after `registerFocusVisibleRing`: the same two `StyleRule`s inside one `deferStyleSheetWrite`, using only the `[FOCUS_VISIBLE_ATTR]` half of each selector — `{ outline: "none" }` on the bare selector and `INSET_FOCUS_RING_STYLES` on `::after`. At module top level, after the imports, call `registerNavigationLandingRing('[role="tree"]')` in `packages/lib/src/typescript/lib/component/tree/Tree.ts` and `registerNavigationLandingRing("tbody")` in `packages/lib/src/typescript/lib/component/table/Body.ts`.
   Check: `npx vitest run tests/component/input/focusRing.test.ts tests/unit/import-without-dom.test.ts`.

9. **Guard tests for the neighbours.** `npx vitest run tests/component/menubar/ToolBar.test.ts tests/component/container/TabBar.test.ts tests/component/layout/Accordion.manager.test.ts tests/component/tree/Tree.test.ts tests/component/table/Body.test.ts tests/core/FocusTraversal.test.ts tests/core/FocusTraversalCompositeWidgets.test.ts tests/unit/core/FocusReveal.test.ts` — all pass with no edits. The `ToolBar` file holds the text-entry yield tests; they must be untouched.

10. **Documentation.** Edit `packages/lib/docs/concepts/accessibility.md` and `packages/lib/docs/reference/changelog/next.md` as in `## Documentation Impact`.

11. **Remove the old plan.** `git rm plans/spatial-navigation-container-priority-band.md`.

12. **Final checks** — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/SpatialRanking.ts` |
| Create | `packages/lib/tests/unit/core/SpatialRanking.test.ts` |
| Create | `packages/lib/tests/component/navigationGroupDefaults.test.ts` |
| Create | `packages/lib/tests/core/PanelScrollViewport.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/SpatialNavigation.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/FocusReveal.ts` |
| Modify | `packages/lib/src/typescript/lib/core/LayerManager.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Panel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/ToolBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/TabBar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/AccordionHeader.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/focusRing.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/tests/unit/core/SpatialNavigation.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/tests/component/container/ScrollStrip.test.ts` |
| Modify | `packages/lib/tests/overlay/LayerManager.test.ts` |
| Modify | `packages/lib/tests/component/input/focusRing.test.ts` |
| Modify | `packages/lib/docs/concepts/accessibility.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Delete | `plans/spatial-navigation-container-priority-band.md` |

---

## Expected Behaviour

Rectangles are `(left, top, right, bottom)` in page coordinates. **Offline** cases run in the harness. **Manual** cases need a browser.

### Pure ranking — offline, `rankLevel` with `Rect` literals

Origin `O = (0, 0, 100, 20)`, direction `east`, `groupRect` null unless stated. Candidates A, B, C, F, N are the ones in the SC1 table.

| # | Call | Result |
|---|---|---|
| E-1 | `"open"`, candidates `[A, B, C]` | `[A, C]` — B rejected |
| E-2 | `"line"`, candidates `[A, B, C]` | `[A]` |
| E-3 | `"open"`, candidates `[F, N]` | `[N, F]` (38, 600) |
| E-4 | `"line"`, candidates `[F, N]` | `[F]` |
| E-5 | origin `(300, 0, 320, 24)`, `south`, candidate `field (0, 32, 250, 56)`: `"open"` with `groupRect (0, 0, 800, 24)`; then with `groupRect` null | `[field]` (score 8 + 2×(50+10) = 128); then `[]` |
| E-6 | origin *Refresh* `(235, 59, 257, 81)`, `east`, `"open"`, `groupRect (41, 59, 279, 81)`, candidates *Column options* `(262, 614, 274, 634)`, dock tab `(281, 57, 380, 81)` | `[dock tab]` |
| E-7 | origin `(0, 100, 300, 120)`, `north`, `"open"`, candidates supplied as `[Q (70, 60, 120, 98), P (10, 60, 60, 98)]` | `[Q, P]` — equal score 2, supplied order kept |
| E-8 | candidates not ahead: `(90, 0, 140, 20)` straddles `O`'s right edge by 10; `(−50, 0, −10, 20)` is behind; `(99.5, 0, 140, 20)` overlaps by 0.5 | first two excluded; the third included with forward gap 0 |
| E-9 | off-line cost follows the origin's size. Origin `(47, 587, 257, 609)`, `south`, `"open"`: *Column options* `(262, 614, 274, 634)`, table body `(46, 635, 274, 824)`. Then origin = *Column options*, `north`, `"open"`: *Properties* title `(47, 587, 257, 609)`, tree `(41, 81, 279, 585)` | `[table body (26), Column options (225)]`; then `[Properties title (27), tree (29)]` |

Also mirror E-1 through all four directions, as the existing `rankInDirection` mirror test does.

### Service, sidebar fixture — offline, `SpatialNavigation.move(direction, 'component')`

Install the harness with `viewport: { width: 1500, height: 850 }`. Candidates, in this document order, each a child of the group named:

| Name | Rectangle | Group (group's rectangle) |
|---|---|---|
| `menuQuery` | 48, 33, 100, 57 | `menuBar` (0, 33, 1500, 57) |
| `databaseTitle` | 47, 59, 181, 81 | `header0` (41, 59, 279, 81) |
| `createSchema` | 183, 59, 205, 81 | `header0` |
| `showDiagram` | 209, 59, 231, 81 | `header0` |
| `refresh` | 235, 59, 257, 81 | `header0` |
| `tree` | 41, 81, 279, 585 | — |
| `propertiesTitle` | 47, 587, 257, 609 | `header1` (41, 587, 279, 609) |
| `columnOptions` | 262, 614, 274, 634 | — |
| `tableBody` | 46, 635, 274, 824 | — |
| `dockTab` | 281, 57, 380, 81 | `tabBar` (280, 57, 1500, 81) |
| `runQuery` | 284, 83, 306, 101 | `queryToolbar` (280, 81, 1500, 103) |
| `formatQuery` | 310, 83, 332, 101 | `queryToolbar` |
| `saveQuery` | 336, 83, 358, 101 | `queryToolbar` |
| `editor` | 331, 103, 890, 253 | — |
| `recordView` | 280, 284, 300, 308 | `resultToolbar` (280, 282, 1500, 310) |
| `resultBody` | 280, 310, 1500, 829 | — |

Group elements are plain placed handles carrying `data-ts-ui-navigation-group`; they are not in the candidate list. Use `placeIn` for their children.

| # | Start, moves | Lands on, in order |
|---|---|---|
| E-10 | `createSchema`, `east` × 4 | `showDiagram`, `refresh`, `dockTab`, then `false` with focus still on `dockTab` |
| E-11 | `createSchema`, `east` × 3, `dockTab` left out of the fixture | `showDiagram`, `refresh`, `runQuery` |
| E-12 | `refresh`, `east`, every dock control left out | `false`; active element is still `refresh`; `DOM.sink.focus` was not called; no element carries `data-ts-ui-focus-visible` |
| E-13 | `editor`, `west` | `tree` (52) — not `recordView` (243) |
| E-14 | `refresh`, `west` × 4 | `showDiagram`, `createSchema`, `databaseTitle`, then `false` |
| E-15 | `menuQuery`, `south` × 4 | `databaseTitle`, `tree`, `propertiesTitle`, `tableBody` |
| E-16 | `tableBody`, `north` × 5 | `columnOptions`, `propertiesTitle`, `tree`, `databaseTitle`, `menuQuery` |
| E-17 | `tableBody` with `aria-activedescendant` naming a child placed at (46, 635, 166, 656), `north`; then the child at (166, 635, 274, 656). Give the child an `id` with `DOM.sink.edit(child).attr('id', …)`; the child is not in the candidate list | `propertiesTitle`; then `columnOptions` |
| E-18 | `tree`, `east`; then with `aria-activedescendant` naming a child at (41, 150, 279, 174) | `recordView` (score 1, before `resultBody` in document order); then `editor` |
| E-19 | `runQuery`, `south` | `editor` — accepted only because it is in line with `queryToolbar` (score 74) |

E-13 is the case the parked branch was written for.

### Service, focused layouts — offline

| # | Layout | Move | Result |
|---|---|---|---|
| E-20 | Scroll viewport `V (0, 40, 230, 400)`, clipping. Inside `V`: `origin (8, 214, 218, 243)`, `sibling (8, −25, 170, 4)`. Outside: `outside (109, 0, 131, 31)` | `north` | `sibling`; `FocusReveal.reveal(sibling)` is called after the focus call |
| E-21 | E-20 without `sibling` | `north` | `outside` |
| E-22 | `V (280, 100, 600, 400)` clipping, a scroll viewport. `hidden (300, 10, 400, 30)` inside `V`. `origin (300, 60, 400, 80)` outside `V` | `north` | `false` — a control scrolled out of a viewport that does not contain the origin is not a candidate |
| E-23 | `wrapper (0, 150, 100, 150)` clipping, holding `phantom` at page (0, 150, 100, 200). `origin (0, 200, 100, 220)`, `visible (0, 80, 100, 100)` | `north` | `visible` |
| E-24 | E-23 with `wrapper (0, 150, 100, 152)`; then `wrapper (0, 150, 100, 160)` | `north` | `visible` (2 px showing is under `MIN_VISIBLE_PX`); then `phantom`, ranked by (0, 150, 100, 160) |
| E-25 | viewport 1280 × 800. `origin (0, 700, 100, 720)`, `below (0, 900, 100, 920)` | `south` | `false` |
| E-26 | `origin (0, 200, 100, 220)`, `thin (0, 100, 100, 100)`, `real (0, 40, 100, 60)` | `north` | `real` — zero height fails C4 |
| E-27 | `origin (0, 200, 100, 220)`; `member (0, 150, 100, 170)` is a roving member with `aria-disabled="true"`; `other (0, 80, 100, 100)` | `north` | `other` |
| E-28 | `origin (0, 300, 100, 320)` in `<body>`. Layer `W` (dismiss mode `manual`) with element at (400, 200, 800, 600). `covered (500, 300, 560, 320)` in `<body>`; `peeking (380, 300, 440, 320)` in `<body>` | `east` | `peeking` — `covered` fails C5 |
| E-29 | Layer `W` as in E-28. Seed `W`'s element with `inW1 (420, 300, 480, 320)` and `inW2 (500, 300, 560, 320)`. Seed `<body>` with `left (0, 300, 100, 320)` and `main (900, 300, 960, 320)` | from `inW1`, `east` × 2; then from `left`, `east` | `inW2`, then `false`; then `main` — not `inW1`, which `master` picks |
| E-30 | `origin (0, 200, 100, 220)`, `near (0, 150, 100, 170)`, `far (0, 80, 100, 100)`; a `DOM.sink.focus` spy refuses `near` | `north` | `far`; `FocusReveal.reveal` was never called with `near` |
| E-31 | Panel `P (0, 100, 200, 300)` clipping. `origin` at page (10, 20, 110, 40) inside `P`, so it has no view rectangle. `target (260, 150, 320, 170)` | `east` | `target` — the move starts from `P`'s rectangle |
| E-32 | Group `bar (0, 0, 1000, 24)` holds `view (90, 0, 140, 24)` and `about (900, 0, 950, 24)`. Outside: `tool (145, 26, 175, 50)` | `east` from `view`; then the same with the group mark removed | `about`; then `tool` |
| E-33 | Tab strip. Group `tabBar (0, 0, 400, 24)` holds clip `C (0, 0, 300, 24)` — clipping, a scroll viewport — and `stripTool (370, 0, 394, 24)`. `C` holds `tab1 (0, 0, 100, 24)` with `close1 (82, 4, 98, 20)` inside it, `tab2 (100, 0, 200, 24)`, `tab3 (200, 0, 300, 24)`, `tab4 (300, 0, 400, 24)`. Every tab and `close1` is a `<button>` | `east` × 4 from `tab1` | `tab2`, `tab3`, `tab4` (scrolled out, reached at the viewport level before `stripTool`), `stripTool` — never `close1` |
| E-34 | Nothing focused. Candidates in document order: `offscreen (0, 900, 100, 920)`, `first (0, 0, 100, 20)`, `last (0, 40, 100, 60)` | `south`; then `north` from a fresh state | `first`; `last` |

Also offline:

- **Determinism.** Run E-10 twice from a fresh fixture; both runs give the same sequence.
- **Region chord untouched.** Every existing `'target'` test passes with its seeds unchanged.
- **Text-entry yield untouched.** `tests/component/menubar/ToolBar.test.ts` passes unedited.

### Manual — SQLAdmin against the symlinked `dist/lib`

The offline cases cannot judge feel, real layout, or painting. The user walks this list; anything that surprises is a finding.

1. Focus *Create schema* in the *Database* header. `Ctrl+Alt+→` twice reaches *Show diagram*, then *Refresh*. A third press lands in the work area level with the header, or leaves focus on *Refresh* when the start page is showing. It never lands on the Properties table's three-dots button.
2. `Ctrl+Alt+←` walks back to the *Database* title. One more press does nothing.
3. `Ctrl+Alt+↓` from a header tool lands on the tree, and a ring appears around the tree. `↓` again reaches the *Properties* title, then the table, which also shows a ring. `↑` walks back.
4. Select a tree row half-way down. `Ctrl+Alt+→` lands on a work-area control level with that row, not one near the top.
5. In a query tab, `Ctrl+Alt+←` from the SQL editor lands on the tree.
6. `Ctrl+Alt+↑` and `↓` move between the tab strip, the query tool bar, the editor and the result area. Each press lands on a control directly above or below the one it left.
7. In the menu bar, `Ctrl+Alt+→` from the last left-hand menu reaches *Shortcuts* at the far right, not something on the row below.
8. Open enough tabs that the strip scrolls. `Ctrl+Alt+→` walks tab by tab and scrolls hidden tabs into view; it does not leave the strip while tabs remain.
9. Collapse the *Properties* section. `Ctrl+Alt+↓` from the tree reaches the *Properties* title; the next press does not land inside the hidden table and does not expand the section.
10. Open the *Local Storage* window. Chords pressed inside it stay inside it. Chords pressed in the main window never enter it and never land on a control hidden behind it.
11. `Ctrl+Shift+←` / `→` still selects by word in the SQL editor, and plain arrows inside a text field in a tool bar still move the caret.
12. The region chord (`Ctrl+Alt+Shift`+arrow) behaves as before.

Demo app: in `MiscPanel`'s scrolling left column, scroll a button partly out of view, focus the one below it, press `Ctrl+Alt+↑` — focus reaches the hidden button and scrolls it into view.

If a move feels wrong, the number to adjust is one of the four constants in `core/SpatialRanking.ts`; rebuild with `npm run build:lib` and retry.

---

## Verification

- `npm run typecheck` and `npm run lint` from the repo root — clean.
- `npm test` from the repo root — the whole suite passes, including E-1 to E-34.
- `npm run docs:api` — zero warnings. Then `npm run docs:llms:check` — passes; no class was added.
- `npm run build:lib` — succeeds.
- Grep checks from steps 1 and 7.
- The manual checklist, by the user, in SQLAdmin with `node_modules/@jimka/typescript-ui` symlinked to this branch's build. Record in the plan's implementation notes that the manual list was left for the user if the implementing session cannot drive a browser.

---

## Documentation Impact

**`packages/lib/docs/concepts/accessibility.md`**

- [Line 168](packages/lib/docs/concepts/accessibility.md#L168): replace the control-chord bullet with: "**`Ctrl+Alt`+arrow** (the **component** tier) moves to the control a person would point at as the next one in that direction. It only considers controls that are visible, and it leaves focus where it is when nothing qualifies."
- After the `configure` paragraph and its two collision bullets, add a subsection `### How the control chord chooses` that states, in this order and using the wording of this plan's rules: the candidate rules C1–C5 as a short list; rule O1 (a tree, list or table moves from its current row or cell); the search order S1 with one sentence each for group, scroll viewport and the rest; the score SC1 as the formula plus the sentence "a control in line counts by its distance alone; one off to the side costs twice its sideways distance, and is only considered when it is at least as far forward as sideways"; and rule N1.
- Add, after that subsection, a paragraph and snippet for groups: "`ToolBar`, `MenuBar`, `TabBar` and an accordion section's header are *navigation groups*: an arrow pressed along the row stays in the row while it has another control that way. Mark your own row of controls with `navigationGroup: true` or `setNavigationGroup(true)`."
- [Line 200](packages/lib/docs/concepts/accessibility.md#L200): scope the last sentence to the region chord: "With the region chord, navigating into a collapsed region expands it first. The control chord never opens or switches anything: a hidden control is not a candidate, and a control scrolled out of the focused control's own panel is scrolled into view when focus lands on it."
- [Line 202](packages/lib/docs/concepts/accessibility.md#L202): replace the last sentence with: "Inside a non-modal window the chords stay inside that window, and chords pressed in the page behind it never enter it."
- [Lines 78–82](packages/lib/docs/concepts/accessibility.md#L78): the sentence saying a tab's ✕ "is reached with spatial navigation" is false today and stays false. Replace "so it is reached with [spatial navigation](#spatial-focus-navigation) (`Ctrl+Alt`+arrow) rather than by tabbing, and `Delete` closes the tab from the ✕ just as it does from the tab button" with "so it is not a Tab stop of its own; `Delete` on the tab button closes the tab".

**`packages/lib/docs/reference/changelog/next.md`**

Add a `### Core` subsection under `## Changed`, between the existing `### Components` subsection ([line 100](packages/lib/docs/reference/changelog/next.md#L100)) and `### Overlay` ([line 120](packages/lib/docs/reference/changelog/next.md#L120)), with:

```markdown
- **`SpatialNavigation`'s control chord (`Ctrl+Alt`+arrow) chooses its
  landing by new rules.** It only considers controls that are visible —
  not ones scrolled out of another panel, clipped away, off screen, behind a
  floating window, or disabled — and it leaves focus where it is when nothing
  qualifies. A move searches the focused control's own row first (a
  `ToolBar`, `MenuBar`, `TabBar` or accordion header), then its scrolling
  panel, then everything else. Outside its row a control must be in line
  with the focused one, or at least as far forward as it is sideways. A
  `Tree`, `List` or `Table` moves from its current row or cell. Inside a
  non-modal window the chords stay in that window. The container rule that
  ranked everything in the same collapsible or scrolling container first is
  gone: `Ctrl+Alt+→` along an accordion header's tool buttons no longer
  jumps to a button elsewhere in the same accordion. The region chord
  (`Ctrl+Alt+Shift`+arrow) keeps its ranking. No consumer action is needed.

- **`Tree` and the `Table` body show a focus ring when a spatial-navigation
  move lands on them.** Neither showed anything before.
```

Add under `## Added` → `### Core` ([line 172](packages/lib/docs/reference/changelog/next.md#L172)):

```markdown
- **`Component` gains `navigationGroup` / `setNavigationGroup` /
  `isNavigationGroup`.** A group is one row or column of related controls
  that the control chord searches before looking elsewhere. `ToolBar`,
  `MenuBar`, `TabBar` and `AccordionHeader` are groups by default.

- **`FocusRevealer` gains an optional `getScrollViewportElement()`,** which
  a revealer that scrolls implements to name the element its content scrolls
  inside. `Panel` and `ScrollStrip` implement it.

- **`LayerManager` gains `getLayerContaining(node)` and `getLayers()`.**
```

No migration entry: no signature changed and no option was removed. No new component page, no sidebar entry, no `core/index.ts` export.

---

## Potential Challenges

- **Almost every control-chord test seeds `FOCUSABLE_SELECTOR`.** After step 7 an unconverted test finds no candidates and fails with "expected true, got false". Convert the seeds in step 6 before touching the service.
- **An existing control-chord test may expect a landing the new rules no longer give.** Decide by the rules in this plan, not by the old expectation, and list each such test in the implementation notes. The clip-frame, collapsed-wrapper, container-versus-content, roving-member and refusal tests were checked against the new rules and keep their outcomes.
- **The harness reports every overflow as `visible`.** A test that needs a clipping ancestor must install the `clipping(...)` spy, or nothing is ever clipped.
- **`place` is parent-relative.** The tables give page coordinates; use `placeIn`. An unplaced parent contributes no offset.
- **`DOM.source.contains(a, a)` is `true`.** Exclude the element itself wherever "inside" must be strict — `contentRectIn` and `scrollViewportsOf`.
- **`DOM.source.getBody()` mints a new handle per call offline.** Keep using `stableBody()`, and read `getBody()` once per move in the service.
- **`::after` on a `<tbody>`.** The body is `display: block; position: absolute` like every component, so the inset ring should paint as it does on `List`. If manual check 3 shows no ring on the table, stop and report it; do not substitute another indicator.
- **A `CodeEditor`'s focusable element is `.cm-content`, which excludes the line-number gutter.** A move starting from the editor measures from the text area, so `Ctrl+Alt+↑` lands on the first tool bar button above the text, not above the gutter. This is expected.
- **Cost per keypress.** Each candidate walks its ancestors. The `ClipCache` makes each ancestor's overflow and rectangle a single read per move; do not bypass it.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/SpatialNavigation.ts`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts) — `rankInDirection` (122), `leafFocusables` (402), `intersectRects` (418), `collectCandidates` (508), `rankWithContainerPriority` (559), `tryFocusCandidates` (620), `moveFocus` (659).
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts#L2358) — `setNavigationTarget` / `isNavigationTarget`, the precedent `navigationGroup` copies; marker constants at 521–524.
- [`packages/lib/src/typescript/lib/core/Focusable.ts`](packages/lib/src/typescript/lib/core/Focusable.ts#L36) — `FOCUSABLE_SELECTOR`, `ancestorsToDocument` (65), `ancestorsBefore` (87).
- [`packages/lib/src/typescript/lib/core/RovingTabIndex.ts`](packages/lib/src/typescript/lib/core/RovingTabIndex.ts#L18) — `ROVING_MEMBER_SELECTOR`.
- [`packages/lib/src/typescript/lib/core/FocusReveal.ts`](packages/lib/src/typescript/lib/core/FocusReveal.ts#L15) — the `FocusRevealer` interface and `containing` (66).
- [`packages/lib/src/typescript/lib/core/LayerManager.ts`](packages/lib/src/typescript/lib/core/LayerManager.ts#L658) — `nodeOwning`, `_stack` (227), `getZIndex` (584).
- [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts#L627) and [`ScrollStrip.ts`](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L969) — the two scroll viewports.
- [`packages/lib/src/typescript/lib/component/input/focusRing.ts`](packages/lib/src/typescript/lib/component/input/focusRing.ts#L112) and [`AbstractSelectableList.ts`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L216) — the ring precedents.
- [`packages/lib/tests/unit/core/SpatialNavigation.test.ts`](packages/lib/tests/unit/core/SpatialNavigation.test.ts#L43) — `place`, `registerFakeRevealer`, the overflow spy.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts#L1234) — how `getElementRect` composes a rectangle offline.
- `ARCHITECTURE.md` — *All attributes and styles go through typed setters*, *Class-level defaults must survive the getter*, *Defer DOM work to render time*.

---

## Non-Goals

- **The region chord's ranking and landing.** Unchanged; see [^tiers].
- **Text-entry controls and arrow keys.** Already fixed (`toolbar-arrow-keys-yield-to-text-entry`); this plan must not edit those handlers.
- **Reaching a tab's ✕ with the arrows.** Not possible today and not added; see [^close-button].
- **Run-time tuning API.** The constants are source constants. No `configure` field is added for them.
- **Per-control overrides** such as "the control to my right is X". No report asked for one.
- **Whole-page scrolling.** A control below the fold of a scrolling *page* is not a candidate. The library's apps fill the window.
- **A focus ring on `Tree` and `Table` for ordinary `Tab` focus.** The new ring is for spatial-navigation landings only.
- **Marking a `ButtonGroup`'s container as a group by default.** The app can set `navigationGroup` on the container it passes to `setContainer`.
- **Spatial navigation inside modal dialogs, menus and dropdowns.** The service still stands down there.
- **Any change in SQLAdmin**, including its `LIBRARY_NOTES.md` entry.
- **`plans/directional-panel-navigation.md`.** An older plan whose algorithm the implemented `spatial-focus-navigation` plan already replaced. Left alone.

---

## Addendum: Diagnosis

What the control chord does on `master` (`40eb0dda6`), read from the code and confirmed by running `SpatialNavigation.move` in the offline harness on the sidebar fixture of `## Expected Behaviour`.

**Candidate collection** ([`collectCandidates`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L508)). Two queries are merged: `visibleFocusable(root)` and every roving member. Filters: `display`/`visibility`, the `disabled` attribute, the `leafFocusables` container rule, and "an ancestor with `overflow: hidden` has zero width or height". The rectangle is the raw `getBoundingClientRect`, intersected only with `data-ts-ui-clip-frame` ancestors.

**Ranking** ([`rankInDirection`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L122)). Sort by: in line first; then `forward gap + 2 × side gap`; then centre distance.

**Container rule** ([`rankWithContainerPriority`](packages/lib/src/typescript/lib/core/SpatialNavigation.ts#L559)). All candidates inside the origin's nearest registered `FocusRevealer` are ranked ahead of all others. `Accordion`, `Tab`, `Split`, `Border`, `ScrollStrip` and scrolling `Panel`s all register.

**Scope** ([`focusScopeRoot`](packages/lib/src/typescript/lib/core/Focusable.ts#L179)). The topmost registered layer's element, wherever focus is.

Findings:

| # | Finding | Evidence |
|---|---|---|
| a | The container rule beats geometry | Harness run: `createSchema → showDiagram → refresh → columnOptions → recordView`, with a dock tab 24 px away in line |
| a′ | The parked branch only moves the problem | Same run on its code: `refresh → dockTab` with a tab in line, `refresh → columnOptions` without |
| b1 | A control scrolled out of *any* scrolling panel is a candidate, at its raw page position | The zero-size test is the only clip test; the code comment says a scrolled-out sibling "keeps its full raw rect" on purpose |
| b2 | A control partly or wholly clipped by a non-zero `overflow: hidden` ancestor is a candidate at its unclipped position | Same test; every `Component` defaults to `overflow: hidden` |
| b3 | Zero width *or* zero height passes; only both-zero is dropped | `rect.width === 0 && rect.height === 0` |
| b4 | Off-screen and covered controls pass | no viewport or layer test |
| b5 | A disabled non-native roving member passes | only the `disabled` attribute is tested; `Checkbox`, `ComboBox`, `Slider` use `aria-disabled` and `tabindex="-1"` |
| b6 | Collapsed accordion bodies and inactive tab pages are **already** excluded on `master` | zero-height wrapper; `display: none` |
| b7 | Landing on a `Tree` or `Table` body shows nothing | `Tree` has no focus listener and no `:focus` rule; its row ring follows `_focusNode`, not DOM focus. `Body.onFocus` paints a cell ring only when an anchor record exists. `List` is the only one with a container ring |
| b8 | Every tried candidate is revealed before its focus attempt | `tryFocusCandidates` calls `FocusReveal.reveal` first, so a refused candidate can still scroll a panel |
| c | In line wins at any distance | first sort key of `rankInDirection` |
| d | A tall origin is measured as a whole | a 504 px tree moving `→` lands on whichever control is nearest anywhere along its height |
| e | With a floating window open, every chord pressed in the page jumps into the window | `focusScopeRoot`; an existing test documents it at [line 769](packages/lib/tests/unit/core/SpatialNavigation.test.ts#L769) |
| f | Ties are not in document order | merged lists put every tabbable element before every roved-off member |

Finding b6 corrects the earlier, lost diagnosis: those two cases were not a cause. Findings b7, d, e and f are new.

"Vanishes into nowhere" is b1–b4 plus b7. "Jumps are random" is a, c, d, e and f. "Skipping over elements" is a and c.

---

## Notes

[^tiers]: The region chord is left alone for three reasons. No report describes a region-chord defect, and SQLAdmin's `LIBRARY_NOTES.md` records it as working. Its candidates are a handful of large regions, where "in line first" is the right rule and visibility clipping matters little. And its ranking function `rankInDirection` is a public export shipped in 0.10.0, so changing it would be a breaking change with no report behind it. The search root is shared because the "jumps into the open window" defect (finding e) is a scope fault, not a ranking fault, and one resolver for both chords is simpler than two.

[^w3c]: The W3C draft (*CSS Spatial Navigation Level 1*, §8) searches inside the origin's nearest "spatial navigation container" — by default a scroll container or the viewport — and walks to the parent container only when that one has no candidate. Its distance is `euclidean + displacement − alignment − sqrt(overlap)`, where `displacement = (sideways distance + orthogonalBias) × orthogonalWeight`, `orthogonalBias` is half the origin's width or height for a candidate that is not aligned, and `orthogonalWeight` is 30 for left/right and 2 for up/down. Adopted: the container order, visible-only candidates, a single additive distance, the half-extent bias, and document-order ties. Not adopted: the 30/2 split, which is tuned for web pages where text lines are long rows — with 30, any in-line control beats a near off-line one at almost any distance, which is finding c again. Also not adopted: scrolling the container by a step when nothing is visible; the library already has `FocusReveal` to scroll one named control into view, so the move focuses the next hidden control directly. The `alignment` and `sqrt(overlap)` terms are dropped because they make a wide origin prefer whichever candidate overlaps it most, which picks the second button of a row over the first when the origin's edge cuts the first.

[^tv]: Android's `FocusFinder` accepts any candidate in the half-plane ahead, prefers one "in the beam" (`beamBeats`), and otherwise compares `13 × major² + minor²`. That weighting favours a tiny forward distance so strongly that it would choose the three-dots button in the worked example (forward 5, sideways 533), so it is not used; the beam idea is kept as the in-line test. Android's `ScrollView.arrowScroll` focuses the next focusable when it is within scrolling reach, which is the same choice made here for scrolled-out controls. Norigin Spatial Navigation and BBC LRUD organise controls into named containers and search a container's own children first; that is the group level. Both also restore the last-focused child on entry. That is not used for the control chord, because landing on a remembered button far from where the arrow points is a jump the user did not ask for; the region chord already offers it.

[^group-marker]: Three existing signals were considered for "what is a group" and rejected. *Navigation targets*: `ToolBar`, `MenuBar` and `TabBar` are already targets, but an accordion header is not, and marking it would make the region chord stop at every header. Apps also mark large regions (SQLAdmin marks its whole sidebar view and its dock) as targets, and treating those as rows would bring "in line wins at any distance" back across a whole region. *Roving-tabindex membership*: the member attribute says an element is in some group but not which, and `MenuBar` and `AccordionHeader` have no roving group. *ARIA roles* (`toolbar`, `menubar`, `tablist`): an accordion header has none. A dedicated marker follows the exact shape `setNavigationTarget` and `setTabKeyOwner` established — option, always-dispatched setter, data attribute, folding getter, a row in `default-options-fallback.test.ts` — so it adds a concept but no new mechanism.

[^line-only]: If a group or scroll viewport accepted cone candidates too, the old defect would return in a new form: from SQLAdmin's SQL editor, `←` would land on the *Record view* button below-left of the editor (inside the same panel, in the cone) instead of the tree directly beside it. Restricting inner levels to in-line candidates means they can only carry a move straight along a row or column. Two in-line candidates, one inside a level and one outside, do not end up in the wrong order: the level's box spans from the origin to its own candidate, so a nearer in-line candidate outside the level would have to overlap that box, which sibling components in the library's layouts do not do.

[^scroll-viewport]: A scroll viewport is identified through the `FocusReveal` registry and not by computed `overflow: auto | scroll`, because `ScrollStrip` scrolls a clip that is `overflow: hidden`, and a `Panel` with overlay scrollbars scrolls an inner element, not the panel's own. The registry is also what performs the scroll, so the element that is exempt from clipping and the element that will scroll are guaranteed to be the same. `Accordion`, `Tab`, `Split` and `Border` reveal by changing state — opening a section, switching a tab — and the control chord must never do that, so they are not levels. On `master` they were, through `nearestRevealerElement`, which is how an accordion became the container that decided the reported jump.

[^off-line-bias]: Without the half-extent term, `↓` from the 210 px-wide *Properties* title would land on the three-dots button (forward 5, side gap 5, score 15) ahead of the table body directly below (score 26). With it, the three-dots button scores `5 + 2×(5 + 105) = 225` and the table wins. The same term costs little for a small origin: `↑` from the 12 px-wide three-dots button scores the title at `5 + 2×(5 + 6) = 27`, just ahead of the tree at 29. The intuition: nearly everything is "in line" with a wide control, so a candidate that still misses it is well off; almost nothing is in line with a tiny control, so a near diagonal is plausible.

[^weight]: `OFF_AXIS_WEIGHT = 2` keeps the value `master` already uses (`PERPENDICULAR_WEIGHT`) and equals the W3C draft's up/down weight. On the sidebar fixture it orders every pair the way the walk-throughs in `## Expected Behaviour` expect. It is the first constant to adjust if moves feel too eager to go sideways (raise it) or too reluctant (lower it).

[^cone]: `CONE_SLOPE = 1` is 45°: a candidate counts as "to the right" only when it is at least as far right as it is up or down. It is the one boundary where a diagonal candidate belongs to exactly the two directions a person would accept. A wider cone (slope 2, about 63°) would accept a start-page button 300 px right and 500 px down from *Refresh*, which reads as a jump downward for a `→` press. A cone alone cannot enter an offset row just below a tool bar (forward 8, sideways 50), which is why the search root also accepts a candidate in line with the origin's group. A hard pixel limit on sideways distance was rejected: no single number separates "the field under this tool bar" (50) from "the three-dots button" (533) across window sizes, while the cone and the group line separate them by shape.

[^min-visible]: `MIN_VISIBLE_PX = 4` stops a control with a one-pixel sliver showing under a clipping edge from counting as visible, while still admitting a control cut in half by a scrolling panel's edge (it is scrolled fully into view on landing). The `min(4, own extent)` form keeps a legitimately tiny control eligible.

[^one-place]: `PERPENDICULAR_WEIGHT` and `PRIMARY_GAP_EPSILON` stay in `SpatialNavigation.ts` beside `rankInDirection`. They belong to the region chord's unchanged ranking and are not part of what the user tunes. Moving `rankInDirection` itself would be a refactor with no behaviour behind it.

[^dom-order]: `master` merges two query results, so a tool bar's current tab stop sorts before its other members and every roved-off member sorts after every tabbable element on the page. The seam has no document-position primitive, so the two lists cannot be re-sorted after the fact. One query with a combined selector returns document order directly. The cost is that offline tests seed one selector instead of two; `NAVIGATION_CANDIDATE_SELECTOR` is exported from the module so tests use the exact string, as they already do with `FOCUSABLE_SELECTOR`.

[^layer-root]: `LayerManager` already has the lookup needed — the private `nodeOwning(target)` — because it resolves which layer a click landed in. Exposing it as `getLayerContaining` avoids a second implementation. `FocusTraversal` keeps using `focusScopeRoot()`; Tab traversal is out of scope. C5 needs the list of open layers, which is `getLayers`. A layer's `"manual"` dismiss mode is what a window and a non-modal drawer use; every other mode makes `claimsKey` false, so C5 only ever has windows and drawers to consider.

[^body-clip]: `<body>` and `<html>` are skipped because their rectangles are not reliable clip boxes: a page whose body has `overflow: hidden` and no explicit height can report a zero-height body while its absolutely positioned content fills the window, which would clip every candidate to nothing. The browser viewport rectangle is always correct for what they would clip.

[^active-descendant]: `Tree`, `List` and the `Table` body each hold DOM focus on one element and point `aria-activedescendant` at the current row or cell (`Tree.ts:2168`, `AbstractSelectableList.ts:1763`, `Body.ts:2837`). That attribute is the standard statement of "where focus really is" inside such a widget, so it is read through the seam (`getAttribute`, `getElementById`) with no new component API. The containment check keeps an `AutoCompleteField`, whose active descendant lives in a dropdown layer, on its own rectangle.

[^reveal-after-focus]: Revealing first matters only for a control that cannot take focus until something opens — a collapsed section, an inactive tab. Such a control is never a control-chord candidate, so the order can be reversed there, and a refused candidate no longer scrolls a panel. The region chord does land inside collapsed regions, so it keeps reveal-before-focus.

[^landing-ring]: The ring is tied to the service's own marker and not to `:focus` or `:focus-visible`, so nothing changes for a mouse click or an ordinary `Tab`. The selectors are `[role="tree"]` and `tbody`, not `.Tree` and `.TableBody`: the class token on the element is the leaf class name, and SQLAdmin's navigator is a `NavigatorTree` two subclasses below `Tree`. `AbstractSelectableList` documents the same hazard for `.List`. `registerFocusVisibleRing` is not reused directly because its `:focus-visible` half would also paint on `Tab` focus.

[^close-button]: A tab's ✕ lies inside its tab button's rectangle. From its own tab it is not ahead in any direction. From a neighbouring tab, or from a control above or below, the tab button is always at least as near and so always ranks first. Running `rankInDirection` on `master` confirms it: from tab 2 moving west the order is `[tab 1, ✕ 1]`, and from tab 1 moving east ✕ 1 is absent. The ✕ is reached only as a fallback when its tab refuses focus. Making it reachable needs an "enter the control you are on" rule that would double the key presses along a strip; `Delete` on the tab button already closes the tab.

[^parked]: The five commits are `226d39342` and `a25e5256d` (moving the old plan file between folders), `037a6786e` (notes added to that plan), `0fc45750c` (the four-group ranking and its tests) and `2818e9116` (its changelog entry). The ranking commit edits `rankWithContainerPriority`, which the control chord stops calling, and its changelog entry describes behaviour this plan replaces. Applying it to the region chord alone would change that chord without a report asking for it. Its test geometry for the SQLAdmin editor case is reused as E-13 with the expected value re-derived.

[^geometry-source]: The horizontal positions come from laying out the real `AccordionPanel`, `AccordionHeader`, `Table` and three compact glyph buttons at SQLAdmin's 238 px sidebar width in the offline harness. The tree's rectangle and the dock rectangles come from the live measurements recorded in SQLAdmin's `LIBRARY_NOTES.md` at 1500 × 850. The lower section's vertical positions are derived from those plus the 22 px compact header and the inspector's 220 px height, so they may be a few pixels off. The argument depends on only two facts, both exact: the three-dots button's left edge (262) is right of *Refresh*'s right edge (257), and the button is several hundred pixels lower.

---

## Implementation Notes

### Deviations from the plan

1. **A candidate inside the focused control, or containing it, is dropped by an explicit test.** Rule S1 says such a candidate "is never ahead", and the plan's `collectControls` left that to geometry. Geometry covers it only while the two boxes nest: a focusable child the widget lays out beyond its own box, or a focusable container whose box does not enclose the focused child, measures as ahead. `collectControls` now drops every survivor of `leafFocusables` that `DOM.source.contains` relates to the origin in either direction. It takes `origin: Handle | null` instead of `origin ?? body` so the test is skipped when nothing is focused. Pinned by *"a candidate inside the focused control is never ahead of it, even when it is laid out beyond the control's own box"* and *"a candidate that contains the focused control is never ahead of it…"*.

2. **A scroll-viewport level admits a control only when landing on it would show something.** Rule V1 and the plan's pseudo-code admit every control inside the viewport `S` that nothing *inside* `S` clips away. That also admits a control that sits inside `S`'s own box but is hidden by something else — beyond the browser window, clipped by an ancestor *outside* `S`, or wholly behind a floating window — and revealing such a control scrolls nothing, so focus would land on something nobody can see. `rankViewportLevel` therefore works out where the control would sit once `S` has scrolled it in (`scrolledInto`, the same least-scroll `Panel.revealDescendant` performs), and keeps it only when that rectangle shows inside the part of `S` that is itself on screen and is not wholly behind a layer. A level whose viewport has no part on screen is skipped. A control that is merely scrolled out of `S` is reached exactly as V1 says. Pinned by the four tests under *"scroll viewports, what may be reached"* that name the window, the outer ancestor, the partly shown viewport and the off-screen viewport, and by *"a control in the origin's scroll viewport that is wholly behind a floating window…"*. Found by the second review round.

3. **`ancestorGeometry` is folded into `effectiveRect`.** The plan said to keep both. With the control chord gone from it, `ancestorGeometry`'s `clippedToNothing` output had no reader, so only the clip-frame intersection the region chord uses is left. The region chord's rectangles are unchanged.

4. **Helpers beyond the plan's function table.** `openMoveScope`, `isRectInside`, `showsUncovered`, `isEnabledControl`, `alongAndAcross`, `nearestAncestorView`, `viewCandidates`, `rankGroupLevel`, `rankViewportLevel`, `scrolledInto` and `shiftInto` split `describeControl`, `originAnchor` and `moveComponentFocus` into named steps; `takesFocus` and `landOn` split `tryFocusCandidates`' two orders (focus-then-reveal for the control chord, reveal-then-focus for the region chord). They add no behaviour beyond the plan's pseudo-code, except what deviations 2, 12 and 13 describe.

5. **The measuring functions take one `MoveScope` instead of `(root, cache)`.** The plan's `clipChain` snippet reads `<body>` and `<html>` for every candidate, and `describeControl` would read the browser viewport for every element, while *Potential Challenges* asks for one read per move. `openMoveScope(root)` reads the three once and carries the clip cache; `clipChain`, `describeControl`, `collectControls`, `originAnchor`, `nearestAncestorView` and `rankViewportLevel` take it. `searchRoot` and the dispatcher still read `<body>` themselves, once each.

6. **A fifth named constant, `ORIGIN_EXTENT_BIAS` (0.5).** The plan's `scoreOf` divides the origin's side extent by a literal `2`. That is a scoring number too, so it is named and documented beside the other four in `core/SpatialRanking.ts`. The score is unchanged.

7. **The moved helpers gained JSDoc.** The plan moves `project`, `gapBetween` and `spansOverlap` "unchanged". Their bodies are. Now that they are exported, each carries a JSDoc block, and `project`'s no longer points at "the plan's ranking-rule table" of an older plan.

8. **`Panel.getScrollViewportElement()` returns null for a panel that does not scroll, and otherwise `this.getScrollElement() ?? null`.** The plan's expression returned the element for every rendered panel and repeated a fallback `getScrollElement()` already has. A panel with `autoScroll: "none"` is not a scroll viewport; it was safe only because such a panel does not register as a revealer, which a subclass can do on its own (`ScrollStrip` does).

    **`scrollViewportsOf` no longer tests containment.** The plan keeps a viewport only when it is not the origin and contains it. `searchLevels` matches the set against the origin's own ancestors, which already guarantees both, so the test could not change a result. The `break` at the search root in `clipChain` is kept as the plan wrote it, though layers mount on `<html>` and the walk would end there anyway.

9. **`Body.ts`'s comment gives a different reason for the `tbody` selector.** The plan's `[^landing-ring]` says the class token on the element is the leaf class's. That holds for `Tree`, but `TableBody` declares `ownClassStyleDefaults`, so a `TreeBody` element carries `.TableBody` too. The selector is the plan's; the comment says that every table body renders as a `<tbody>`, and that another `<tbody>` (a `Markdown` table's) never matches because it never carries the landing marker.

10. **Documentation.** Beyond the listed edits, `accessibility.md`'s opening sentence no longer says the two chords "run the same geometric search", the existing navigation-target text sits under a new `### Navigation targets` heading so it does not read as part of the new subsection, and one sentence mentions the landing ring. The search order is described as "each group and each scrolling panel, nearest first", not "group, then scrolling panel": a tab's scrolling strip is searched before the tab bar around it (E-33). The changelog entry's sentence about windows reads "Both chords stay inside the non-modal window focus is in, and neither enters one from the page behind it" — the plan's sentence left out the second half, which is the region chord's one behaviour change — and its sentence about `Tree`, `List` and `Table` says "moves level with", for deviation 12.

11. **One demo edit and one `ARCHITECTURE.md` edit outside the plan's file table.** `TabDemoPanel`'s three rows of controls are plain containers, so each is now built with `navigationGroup: true` — the only place the app-facing option is used rather than a library default. `ARCHITECTURE.md` names `registerNavigationLandingRing` beside the two existing ring helpers in its list of sanctioned module-level registrations.

12. **A widget with a current row or cell starts level with it, but from the widget's own edge.** Rule O1 starts every move from the `aria-activedescendant` element's own rectangle. That is right across the arrow and wrong along it. `↓` from a tree whose current row is in its upper half would measure the control directly below the tree as hundreds of pixels away, and a control beside the row — 1 px sideways, so inside the cone — would win: on the plan's own sidebar fixture, with the E-18 row, `↓` lands on *Record view* in the dock (350) instead of the *Properties* title (413). The plan's manual steps 3 and 9 expect the title after a tree row has been clicked, so the plan contradicts itself here, and its acceptance list decides. `originAnchor` now joins the two rectangles (`alongAndAcross`): the row or cell supplies the extent across the arrow, the widget the extent along it. E-17 and E-18 are unchanged — the cell still decides between the title and the three-dots button, and `→` from a tree still lands level with the row. Pinned by *"a tree with a current row still leaves through its own edge…"*. Found by the third review round.

13. **Focus on the search root itself counts as nothing focused.** A floating window focuses its own element when it is activated. Every control in the window is inside that element, so deviation 1 drops them all and no chord could ever leave it — and since rule R1 stops chords entering a window from the page, a window in that state was reachable only by `Tab` or a click. With the origin equal to the search root the control chord now lands on the root's first in-view control (`↓`/`→`) or its last (`↑`/`←`), as it does with nothing focused. The region chord is not changed. Pinned by *"with focus on a window's own element…"*. Found by the third review round.

### Test changes worth knowing

- **E-31's target moved from `(260, 150, 320, 170)` to `(260, 250, 320, 270)`.** At the plan's position the target is inside the cone of the origin's raw rectangle as well (forward 150, side gap 110), so the test passed whether the move started from the panel's visible box or from the scrolled-out origin. At the new position it is outside that cone and in line with the panel.
- **No existing control-chord test changed its expected landing.** One fixture moved: in *"reaches the ancestor's remembered leaf rather than a geometrically-closer sibling target…"* the `elsewhere` control sat at `(0, 1000, 50, 1020)`, below the 800 px viewport, and the test's control-chord "move away" step needs an in-view candidate. It is now at `(0, 700, 50, 720)`.
- The three *no genuine origin* tests place their candidates, first below second, as step 6 asks.
- The existing collapsed-wrapper test is E-23, relabelled. E-34 adds a second off-screen control at the end of the document order so the backward case is not vacuous.
- `afterEach` gained `vi.restoreAllMocks()`. A spy on `FocusReveal.reveal` — a module namespace, outside the DOM seam — outlived `DOM.reset()` and carried its mock implementation into every later test.
- Cases beyond the plan's table: the two deviations above; a state-revealer (accordion-like) container is not a search level; a control clipped away *inside* the scroll viewport is not readmitted; a layer stacked *below* the focused window does not cover; `aria-disabled="false"`; an `aria-activedescendant` naming an element outside the control; a control smaller than `MIN_VISIBLE_PX`; a group whose candidate refuses focus falls through to the search root; the region chord shares the search root; a current row scrolled out of its widget is ignored; a layer that is not rendered, or has no element, covers nothing; a group inside a scroll viewport is searched before the viewport.
- Added after the second review round, each for a rule that could be broken with every test still green: a group reaches only its in-view members; `<body>` never clips; an origin wheeled out of its panel still reaches the next control in the panel; a scroll viewport is skipped when the origin has no extent in it, or when none of it is on screen; the group line is the *nearest* group's; a control and the origin are measured as content of the viewport, not by what shows; the exact `EDGE_TOLERANCE_PX` boundary; and that importing `Tree` and the table `Body` registers the landing ring.
- Thirty-nine one-line mutations of `SpatialNavigation.ts` and `SpatialRanking.ts` — the search root, the clip walk, the window test, the cover test, the level order, each acceptance and each constant among them — each fail at least one test. That is a spot check of the rules listed, not a proof that no rule is unpinned.

### Verified in a real browser

Chrome, through the chrome-devtools MCP, against this worktree's demo dev server on a spare port, 1500 × 850, with real key presses. The server was stopped afterwards. SQLAdmin was not driven.

| Check | Result |
|---|---|
| Landing ring on a `Tree` | Painted: 2 px inset ring around the whole tree |
| Landing ring on a `Table` body | Painted around the `<tbody>` (paginated table in a `Window`) |
| Stay put when nothing qualifies | `↑` from the top button of *Misc.*'s left column, `→` from the last tool of an accordion header, and `←`/`↑` at the edges of a window all leave focus where it is |
| Group first, tool bar | *ToolBar* section: `→` from the *Save* split button lands on the *50%* combo box 900 px along the same bar. With the bar's group mark removed by hand, the same press lands on *Find* in a bar two rows down. `←` × 7 walks back one control at a time |
| Group first, accordion header | *Accordion* section, tools revealed: title `→` tool `→` tool `→` stays |
| Group marked by the app | *Tab* section's three control rows (`navigationGroup: true`): `→` × 5 walks *Add Lazy Tab* to *Toggle Under-border* one button per press; `↓` lands on the combo box directly below |
| Window, pressed in the page behind it | `↓` skips the eight buttons hidden behind the window and lands on the next one showing; `→` lands on a control in the right-hand panel; focus never enters the window |
| Window, pressed inside it | Every landing is inside the window |
| Scrolled out of the origin's panel | *Misc.* left column scrolled with the wheel: `↑` reaches the hidden button and scrolls it into view |
| Tree moves from its current row | With *Showcase* current (rows 144–168), `→` lands on the button at 132–160, not the top one |
| Table moves level with its current cell | With the cell in the *name* column, `↓` lands on the pager button under that column and `↑` on the tool bar button above it; never on a checkbox in another row. With the cell in the *id* column, `↓` stays put: the two pager buttons under that column are disabled and the next one is 83 px to the side |
| Tree leaves through its own edge | With a row current in the demo's full-height tree, `↓` stays on the tree (nothing is below it) instead of jumping to a button beside the row; `→` still lands level with the row |
| Focus on a window's own element | `↓` lands on the window's first control |
| Scrolling tab strip | 52 tabs: `→` walks *Tab 34* to *Tab 38* one per press, scrolling each in; never the strip's `+` tool, never a ✕ |
| Cost | About 3 ms per press with 194 focusable elements on the page |

Six things that are **not** defects under the plan's rules, and are the first places to look if a move feels wrong. The fourth and sixth follow from the rules and were not seen in a browser; the rest were:

- **A diagonal landing just inside the cone.** In the demo window, `→` from the last pager button lands on *Column options* 435 px right and 377 px up. `CONE_SLOPE = 1` accepts it. Lowering `CONE_SLOPE` to about `0.5` rejects it.
- **A wide row and a far-left control.** `↓` from an accordion header's tool at the far right lands on the next header directly below (712 px) rather than on the section's own checkboxes at the far left (7 px down, 1082 px sideways). `OFF_AXIS_WEIGHT = 2` prices the sideways distance at 2164.
- **A control peeking out from behind a window is a candidate.** Rule C5 excludes a control only when what shows of it is *wholly* behind a layer, so a button with a 14 px strip showing above a window is reached.
- **Inside a scrolling panel, in line wins at any distance.** The panel is searched, in-line candidates only, before the search root. So inside an `autoScroll` panel a far control that overlaps the focused one's width or height — even one scrolled out of view — beats a near control that is slightly off line. The same rule is why "in line with the tool bar as a whole" does not help a tool bar inside a scrolling panel: `↓` from one of its buttons prefers any control further down the panel that the button overlaps over a field just below the bar that it does not. Outside a scrolling panel the nearer control wins (E-3, E-19). No constant changes this; it would need the cone and the group line accepted at a scroll-viewport level too.
- **A narrow start under or over disabled controls stays put.** A table whose current cell is in a narrow column starts `↓` from that column's width at the table's bottom edge. When the controls directly under the column are disabled and the next enabled one is further to the side than it is down, nothing qualifies. Moving the cell one column over, or raising `CONE_SLOPE`, reaches it.
- **A row of controls that spans only part of the widget next to it can be skipped.** SQLAdmin's result tool bar has its buttons at the far left, above a grid that spans the dock. `↑` from a grid cell that is not under those buttons finds nothing in line in the tool bar, and the tool bar's buttons are far outside the cone, so the move lands on the editor above the tool bar. With no current cell the grid is measured whole and `↑` lands on the tool bar.

One artifact of the test method, not of this branch: setting `scrollTop` on a panel's scroll element directly, bypassing `Panel.setScrollTop` and the wheel handler, leaves `Panel`'s cached scroll offset stale, and the reveal that follows then scrolls from 0. A wheel scroll, a scrollbar drag and every library scroll go through the cache.

### Review record

The branch went through the `audit` skill's three review rounds, its cap. Every BLOCKING and ADVISORY finding of all three was fixed. The third round's one BLOCKING finding (deviation 12) and its advisory findings (deviations 5 and 13 among them) were fixed after that last review, so those changes have been checked by tests, by the mutation run above and in a browser, but not by a further independent review.

### Manual checklist — walk this in SQLAdmin

This is the acceptance test. It replaces the short list under *Manual — SQLAdmin against the symlinked `dist/lib`* with one press per line. **Start** is how to get focus there, **Press** is the chord, **Expect** is what must take focus. A blue ring shows where focus is after every press.

**Setup**

1. Build this branch: `cd /home/jika/typescript/typescript-ui/.worktrees/spatial-navigation-redesign && npm run build:lib`.
2. Point SQLAdmin at it. `frontend/node_modules/@jimka/typescript-ui` is currently a link to the main tree's `packages/lib`:
   `cd /home/jika/typescript/sqladmin/frontend && rm node_modules/@jimka/typescript-ui && ln -s /home/jika/typescript/typescript-ui/.worktrees/spatial-navigation-redesign/packages/lib node_modules/@jimka/typescript-ui`
3. Stop the Vite dev server and start it again with `npx vite --force`. A reload alone can serve the old build.
4. Size the window to about 1500 × 850, connect, and leave the *Database* and *Properties* sections open.
5. To go back afterwards: repeat step 2 with `/home/jika/typescript/typescript-ui/packages/lib`, then step 3.

**A. The Database header — the reported jump**

| # | Start | Press | Expect |
|---|---|---|---|
| A1 | Click any row in the navigator tree | `Ctrl+Alt+↑` | The *Database* title |
| A2 | — | `Ctrl+Alt+→` | *Create schema* |
| A3 | — | `Ctrl+Alt+→` | *Show diagram* |
| A4 | — | `Ctrl+Alt+→` | *Refresh* |
| A5 | — | `Ctrl+Alt+→` | With a tab open in the dock: the first dock tab, level with the header. With no control level with the header: the nearest control up-right or down-right of *Refresh* that is at least as far right as it is up or down. On the start page with nothing there: **focus stays on *Refresh***. In every case, **never** the three-dots button of the Properties table |
| A6 | Put focus back on *Refresh* (`Ctrl+Alt+←` from where A5 landed, or repeat A1–A4) | `Ctrl+Alt+←` three times | *Show diagram*, *Create schema*, the *Database* title |
| A7 | — | `Ctrl+Alt+←` | Focus stays on the *Database* title |

**B. Down and up the sidebar — the landing ring**

| # | Start | Press | Expect |
|---|---|---|---|
| B1 | *Refresh* (A1–A4) | `Ctrl+Alt+↓` | The navigator tree, with a ring around the whole tree |
| B2 | — | `Ctrl+Alt+↓` | The *Properties* title — whichever tree row is current, and whatever is open in the dock |
| B3 | — | `Ctrl+Alt+↓` | The Properties table, with a ring around its body. Not the three-dots button |
| B4 | — | `Ctrl+Alt+↑` | The three-dots button when the table has no current cell or its current cell is in the right-hand column; the *Properties* title when the current cell is in the left-hand column |
| B5 | — | `Ctrl+Alt+↑` until the top | *Properties* title (if not already there), the tree, the *Database* title, then a menu in the menu bar |

**C. A tree row decides where `→` goes**

| # | Start | Press | Expect |
|---|---|---|---|
| C1 | Click a tree row about half-way down the tree | `Ctrl+Alt+→` | A control in the dock level with that row — not one near the top of the dock. If the dock has nothing level with the row or in the cone, focus stays on the tree |
| C3 | Click a row in the upper half of the tree, with a query tab open | `Ctrl+Alt+↓` | The *Properties* title, directly below the tree. Not a control in the dock |
| C2 | Click a tree row near the top | `Ctrl+Alt+→` | A control level with *that* row. C1 and C2 land in different places |

**D. A query tab**

| # | Start | Press | Expect |
|---|---|---|---|
| D1 | Open a query tab and click in the SQL editor | `Ctrl+Alt+←` | The navigator tree. Not the *Record view* button below-left of the editor |
| D2 | Click in the SQL editor | `Ctrl+Alt+↑` | A query tool bar button directly above the editor's text — above the text, not above the line-number gutter |
| D3 | — | `Ctrl+Alt+↑` | The tab above it in the tab strip |
| D4 | — | `Ctrl+Alt+↓` twice | Back to the tool bar button, then the editor |
| D5 | — | `Ctrl+Alt+↓` | A control of the result area directly below the editor |
| D6 | A tool bar button of the query tab | `Ctrl+Alt+→` / `←` | The next button along the tool bar, one per press, none skipped |

**E. The menu bar**

| # | Start | Press | Expect |
|---|---|---|---|
| E1 | The *Database* title (A1) | `Ctrl+Alt+↑` | A menu in the menu bar |
| E2 | — | `Ctrl+Alt+→` until the last left-hand menu | One menu per press |
| E3 | The last left-hand menu | `Ctrl+Alt+→` | *Shortcuts* at the far right of the bar. Not a control on the row below |

**F. A tab strip that scrolls**

| # | Start | Press | Expect |
|---|---|---|---|
| F1 | Open enough tabs that the strip scrolls; click a tab near the right edge | `Ctrl+Alt+→` several times | The next tab each press. A hidden tab scrolls into view as it takes focus. Focus does not leave the strip while a tab remains to the right, and never lands on a tab's ✕ |

**G. A collapsed section**

| # | Start | Press | Expect |
|---|---|---|---|
| G1 | Collapse *Properties*; click a tree row | `Ctrl+Alt+↓` | The *Properties* title |
| G2 | — | `Ctrl+Alt+↓` | Focus stays on the title, or moves to a visible control below it. It does **not** land inside the hidden table and the section does **not** expand |

**H. A floating window**

| # | Start | Press | Expect |
|---|---|---|---|
| H1 | Open the *Local Storage* window; click a control inside it | `Ctrl+Alt`+each arrow, several times | Every landing is inside the window. At the window's edges focus stays put |
| H2 | Click a control in the main window, with the *Local Storage* window still open over part of it | `Ctrl+Alt`+arrow toward the window | Focus never enters the window and never lands on a control wholly hidden behind it. It skips to the next control that shows, or stays put |
| H3 | Click the *Local Storage* window's title bar, so the window itself has focus | `Ctrl+Alt+↓` | The first control in the window. `Ctrl+Alt+↑` from the same start lands on its last |

**I. What must not have changed**

| # | Start | Press | Expect |
|---|---|---|---|
| I1 | Click in the SQL editor on a line of text | `Ctrl+Shift+←` / `→` | Selects by word, as before |
| I2 | A text field inside a tool bar | plain `←` / `→` | Moves the caret, as before |
| I3 | Anywhere | `Ctrl+Alt+Shift`+arrow | The region chord moves between sidebar, dock and status bar as before. The one intended difference: pressed in the main window with *Local Storage* open, it no longer jumps into that window |

**Demo app** (`npm run dev` in the library): in *Misc.*, wheel-scroll the left column so a button is partly out of view, click the button below it, press `Ctrl+Alt+↑` — focus reaches the hidden button and scrolls it into view.

**If a move feels wrong**

All five numbers are constants at the top of `packages/lib/src/typescript/lib/core/SpatialRanking.ts`, each with a comment saying what it does. Change one, run `npm run build:lib`, restart Vite with `--force`, retry. Once a value is settled, three places restate it and must follow: the constants test at the top of `packages/lib/tests/unit/core/SpatialRanking.test.ts`, the worked scores in the test comments beside it, and the numbers in `packages/lib/docs/concepts/accessibility.md` under *How the control chord chooses* ("at least 4 pixels", "2 ×", "half", "at least as far forward as it is sideways").

| What it feels like | Constant | Change |
|---|---|---|
| An arrow goes too far sideways, or picks a diagonal control over a straight one | `OFF_AXIS_WEIGHT` (2) | Raise |
| An arrow refuses a control that is only slightly off line | `OFF_AXIS_WEIGHT` (2) | Lower |
| A wide control (a header title, a wide field) goes to a small control off its corner instead of the one straight ahead | `ORIGIN_EXTENT_BIAS` (0.5) | Raise |
| `→` lands on something that is more up or down than right | `CONE_SLOPE` (1) | Lower, e.g. `0.5` |
| An arrow stays put when a control diagonally ahead looks reachable | `CONE_SLOPE` (1) | Raise |
| Focus lands on a control with only a sliver showing | `MIN_VISIBLE_PX` (4) | Raise |
| The control right next to the focused one is skipped | `EDGE_TOLERANCE_PX` (1) | Raise |

A move that feels wrong in a way none of these change is a rule finding, not a tuning one: note the control focus was on, the chord, where it landed, and where it should have.
