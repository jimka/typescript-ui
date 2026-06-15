# Tab Font-Relative Sizing — Implementation Plan

## Overview

The tab strip's layout manager hard-codes a cluster of pixel constants that the
theme system can no longer keep honest. Today the framework's theme surface is
CSS-custom-property *strings* for colours, borders, and `font.size`
([Theme.ts:42](../src/typescript/lib/core/Theme.ts#L42)); there is no
JS-readable numeric spacing/size token. When a consumer scales the root font
(`theme.font.size`), the strip's fixed `STRIP_THICKNESS = 30`
([TabBar.ts:64](../src/typescript/lib/component/container/TabBar.ts#L64)) does
not grow with the label, so the label clips the instant the font outgrows 30px.

Since the `TabBar` extraction landed, the strip's layout math — the constants,
the measurement helpers, `stripThickness()`, and the overflow-arrow handlers —
all live in the bar component
[`src/typescript/lib/component/container/TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts),
**not** in the `Tab` layout manager. `Tab` only *consumes* the bar's thickness
(`this._bar.stripThickness()` at [Tab.ts:1165](../src/typescript/lib/layout/Tab.ts#L1165),
[1370](../src/typescript/lib/layout/Tab.ts#L1370),
[1453](../src/typescript/lib/layout/Tab.ts#L1453)). Phase 1's source edits are
therefore entirely in `TabBar.ts`.

The fix splits cleanly by dependency. **Phase 1** derives the strip thickness
from the *measured* tab-button preferred height plus chrome, and derives the
overflow scroll step from the *measured* tab extent — both doable now because
`TabBar` already remeasures buttons (`buttonCrossExtent`
[TabBar.ts:1859](../src/typescript/lib/component/container/TabBar.ts#L1859) /
`buttonMainExtent` [TabBar.ts:1841](../src/typescript/lib/component/container/TabBar.ts#L1841))
and already re-runs `stripThickness()` live: in its own `doLayout`
([TabBar.ts:2735](../src/typescript/lib/component/container/TabBar.ts#L2735)) and
in the owner's `composeSize` ([Tab.ts:1155](../src/typescript/lib/layout/Tab.ts#L1155),
which reads `this._bar.stripThickness()` at
[Tab.ts:1165](../src/typescript/lib/layout/Tab.ts#L1165)). Re-resolution on a
**font** change is driven by `Button.recomputePreferredSize`
([Button.ts:1284](../src/typescript/lib/component/button/Button.ts#L1284))
bubbling a relayout when the label height changes; re-resolution on a **theme
switch** is driven by the owner's `onThemeChange → scheduleLayout` listener
([Tab.ts:317-318](../src/typescript/lib/layout/Tab.ts#L317)). No new token
surface and no new invalidation wiring is required. **Phase 2** (insets,
close-button, close-glyph) needs a numeric spacing/size token surface that does
**not** exist yet, so it is gated behind a prerequisite that this plan only
*sketches* and recommends deferring to a dedicated theming plan.

Files in scope: [`src/typescript/lib/component/container/TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts)
(Phase 1) and, for Phase 2 only, [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts).

---

## Architecture Decisions

### Phase 1 — Derive strip thickness from the measured button, not a magic seed

`stripThickness()` ([TabBar.ts:1881](../src/typescript/lib/component/container/TabBar.ts#L1881))
already grows the *west/east* (vertical) strip from `base` to the widest
`buttonCrossExtent` ([TabBar.ts:1892-1905](../src/typescript/lib/component/container/TabBar.ts#L1892)),
so the measurement plumbing exists. The bug is that the *north/south*
(horizontal) path returns the flat `base` and never consults the button's
measured cross extent ([TabBar.ts:1884-1886](../src/typescript/lib/component/container/TabBar.ts#L1884)).

The fix is to make `base` itself a **measured floor**: `max(measured-button
cross extent + chrome, compact/non-compact minimum)`. The minimum constants
(`STRIP_THICKNESS` / `STRIP_THICKNESS_COMPACT`) are *retained* but demoted from
"the thickness" to "the floor when no tab has measured yet" (e.g. an empty
strip, or pre-first-layout). This keeps a sane strip height before any button
reports a size, and lets the strip grow with the font afterward. Because
`stripThickness()` runs fresh in every `doLayout` and `composeSize` pass (see
Overview), and a font change bubbles a relayout from `Button` while a theme
switch hits the owner's `onThemeChange → scheduleLayout`
([Tab.ts:317-318](../src/typescript/lib/layout/Tab.ts#L317)), the derived
thickness re-resolves automatically on font scaling — no new invalidation
wiring.

"Chrome" is the fixed vertical padding the strip adds around the tab label
(the strip background band beyond the button box). The implementer derives the
exact chrome delta empirically: measure the current 30px against a default
tab-button preferred height and pin the difference as a small documented
`STRIP_CHROME` const (one magic number, fully documented per
CODE_CONVENTIONS "Magic numbers must be documented"), or fold it into the
retained minimum. Prefer the smallest honest value that stops clipping; do not
invent breathing room (per the project's no-cosmetic-padding rule).

### Phase 1 — Derive the scroll step from the tab extent, not 80px

`SCROLL_ARROW_STEP = 80` ([TabBar.ts:90](../src/typescript/lib/component/container/TabBar.ts#L90))
is consumed only at the two arrow `action` handlers
([TabBar.ts:2461-2462](../src/typescript/lib/component/container/TabBar.ts#L2461)), each calling
`scrollStrip(±SCROLL_ARROW_STEP)` ([TabBar.ts:2612](../src/typescript/lib/component/container/TabBar.ts#L2612)).
Replace the constant with a per-click value derived from the actual tab extent
so "one click ≈ one tab" holds at any font size. The cleanest source is a new
private `scrollStepExtent()` that returns the first tab's predicted extent
(`predictedTabExtent(this._entries[0].button)`,
[TabBar.ts:2147](../src/typescript/lib/component/container/TabBar.ts#L2147)) —
which already collapses width-mode sizing and raw content width into the
laid-out width — and falls back to the retained `SCROLL_ARROW_STEP` (now a
floor) when no tab has measured. The fallback is sound because
`predictedTabExtent` returns `buttonMainExtent(button)` when no fixed mode
applies ([TabBar.ts:2150](../src/typescript/lib/component/container/TabBar.ts#L2150)),
and `buttonMainExtent` returns `0` before a button has a preferred size — so
`predictedTabExtent(...) || SCROLL_ARROW_STEP` correctly floors the `0`. Resolve
the step at click time, not at wiring time, so it tracks the current font.

### Phase 1 — Arrow handlers must use a named method, not the existing inline arrow

The existing arrow handlers register inline arrow functions
(`lead.on("action", () => this.scrollStrip(-SCROLL_ARROW_STEP))`,
[TabBar.ts:2461-2462](../src/typescript/lib/component/container/TabBar.ts#L2461)),
which violate ARCHITECTURE.md "Listeners must reference a named function — never
pass an inline arrow function" ([ARCHITECTURE.md:19-21](../ARCHITECTURE.md#L19)).
This is pre-existing, and per CODE_CONVENTIONS "surgical changes" the plan does
not undertake to fix unrelated violations. However, step 6 **rewrites these exact
two lines**, so it must not silently re-emit the violation. The implementer
extracts named private handlers (e.g. `scrollLeadClicked` / `scrollTrailClicked`,
each calling `this.scrollStrip(∓this.scrollStepExtent())`) and wires
`lead.on("action", this.scrollLeadClicked)` /
`trail.on("action", this.scrollTrailClicked)` — bringing the touched lines into
compliance as a side effect of the required edit, not as scope creep. Flagged
here per the plan format's requirement to surface rule tensions on touched code.

### Phase 1 — Keep `SCROLL_ARROW_SIZE` as-is for now

`SCROLL_ARROW_SIZE = 24` ([TabBar.ts:84](../src/typescript/lib/component/container/TabBar.ts#L84))
is the arrow *gutter* main-axis length, reserved via `computeArrowReserve`
([TabBar.ts:2163](../src/typescript/lib/component/container/TabBar.ts#L2163)); the
arrow buttons fill the strip `thickness` on their cross axis, so once the
thickness is font-derived the arrow already scales on the visible axis. The 24px
gutter is a click-target width holding a glyph that the strip thickness will
size. Deriving the gutter from the thickness is a *possible* Phase 1 follow-on
(`gutter = round(thickness * k)`), but it is lower value and risks shrinking the
click target on a compact strip. **Recommendation: leave `SCROLL_ARROW_SIZE`
fixed in Phase 1**; revisit only if the smoke test shows a visibly wrong gutter
at large fonts. Flagged here so the implementer doesn't silently "fix" it.

### Phase 2 — Insets and close-button/glyph need a numeric token surface (prerequisite, deferred)

`TAB_BUTTON_INSET` / `_COMPACT` ([TabBar.ts:53-56](../src/typescript/lib/component/container/TabBar.ts#L53)),
`CLOSE_BUTTON_SIZE = 16` ([TabBar.ts:43](../src/typescript/lib/component/container/TabBar.ts#L43)),
and `CLOSE_GLYPH_SIZE = 8` ([TabBar.ts:46](../src/typescript/lib/component/container/TabBar.ts#L46))
are consumed inside **JS layout math** — `computeTabButtonInsets`
([TabBar.ts:1760](../src/typescript/lib/component/container/TabBar.ts#L1760)), the
close-button placement in `positionCloseButtons`
([TabBar.ts:2395-2408](../src/typescript/lib/component/container/TabBar.ts#L2395)),
and the close-glyph pin `closeButton.pinGlyphSize(CLOSE_GLYPH_SIZE)`
([TabBar.ts:1507](../src/typescript/lib/component/container/TabBar.ts#L1507)).
They cannot be replaced with a CSS `var()` string the way colours are, because
the layout manager needs a **number**, not a CSS length applied by the browser.

Today every `Theme` field is a CSS string (e.g. `font.size: string`,
`indicator.thickness: string`), and `themeToVars`
([Theme.ts:699](../src/typescript/lib/core/Theme.ts#L699)) flattens them to
`--ts-ui-*` custom properties consumed *in CSS*. There is no precedent for a
token read back as a JS number — even `--ts-ui-table-cell-height`
([Theme.ts:794](../src/typescript/lib/core/Theme.ts#L794)) is only emitted as a
CSS var, never parsed in layout code (verified: no JS reader exists). So Phase 2
genuinely needs a **new** surface: numeric (or numeric-parseable) spacing/size
tokens that layout code can read.

**Minimal sketch of that surface** (do not build it in this plan):
- Add a `spacing` (and/or `size`) block to the `Theme` interface holding
  **numbers**, mirroring the existing nested-block convention
  (`theme.button.font.size`, `theme.tab.indicator.thickness`):
  ```ts
  // Theme.ts — sketch only
  tab: {
      // …existing colour/border blocks…
      spacing: { buttonInset: number; buttonInsetCompact: number };
      close:   { buttonSize: number; glyphSize: number };
  }
  ```
- Provide values in `DefaultTheme` / `DarkTheme` / `ClassicTheme` (wherever the
  existing `tab` block is defined — same files that already carry
  `tab.indicator.thickness`).
- These are **not** emitted through `themeToVars` (they're JS-only), or — if a
  matching CSS var is also wanted — emit them as `"4px"` strings *and* keep a
  numeric mirror; the layout reads the number, CSS reads the var. Decide in the
  dedicated theming plan.
- `TabBar` reads `ThemeManager.getTheme().tab.spacing.buttonInset` at layout time
  (the construction-time-read deferral rules from the implemented
  `defer-construction-time-theme-reads` plan apply: read at `doLayout`, not in
  the constructor) and the owner's existing `onThemeChange → scheduleLayout`
  listener re-resolves it on theme switch.

**Recommendation: defer Phase 2 to a dedicated "numeric theme tokens" plan**,
not this one. Introducing the first-ever numeric token surface is a
theme-system decision (where numbers live vs. strings, whether they double as
CSS vars, how `themeToVars` and the four theme objects change) that ripples far
past `TabBar` — Table, Menu, Split, Border all hold the same kind of constant
(see Non-Goals). Scoping that surface inside a Tab plan would either
under-design it or balloon this plan. Phase 1 ships the high-value, low-risk,
user-visible fix alone; Phase 2 is documented here as the blocked follow-on with
its prerequisite named.

### Generalize the pattern, or scope to TabBar? — Scope to TabBar first

A grep for `^const X = <px>;` sizing constants across `layout/` and the
container/menu groups shows the same pattern is widespread:
`core/Menu.ts` `PANEL_WIDTH = 220` / `DEFAULT_REBUILD_WIDTH = 180`,
`layout/Split.ts` `GUTTER_SIZE = 4`, `layout/Border.ts` `TRACK_SIZE = 4`,
`layout/Table.ts` `CHAR_WIDTH = 8` / `HEADER_PAD = 16` / the type-width
defaults. Generalizing now would mean designing the numeric-token surface and
retrofitting five components in one change — exactly the scope blow-up
CODE_CONVENTIONS' "surgical changes" warns against. **Recommendation: fix
`TabBar` only.** The cross-component evidence belongs in the Phase 2 theming
plan's motivation, not in this implementation. This plan touches no file
outside `TabBar.ts` (Phase 1) — Phase 2's `Theme.ts` edits are themselves
deferred.

### Convention tension — measured-floor consts stay as documented magic numbers

CODE_CONVENTIONS requires every literal to carry "what" and "why". The retained
`STRIP_THICKNESS` / `_COMPACT` / `SCROLL_ARROW_STEP` constants change *meaning*
from "the value" to "the floor used pre-measurement". Their JSDoc must be
rewritten to say so (what: minimum/floor; why: a sane size before any tab has
reported a preferred size, and the empirical chrome delta). No new public API,
no new DOM property, so the typed-setter / `XOptions` machinery does not apply
in Phase 1.

---

## Ordered Implementation Steps

### Phase 1 (this plan — ship independently)

1. **Measure the chrome delta.** In the Tab demo at the default font, record a
   default tab-button preferred height (via `buttonCrossExtent`
   [TabBar.ts:1859](../src/typescript/lib/component/container/TabBar.ts#L1859) on
   a north/south strip). The chrome is `30 − thatHeight`. Capture it as a
   documented `STRIP_CHROME` const, or fold it into the retained minimum if the
   delta is ~0. — verify: the number is justified in a comment, not guessed.

2. **Rewrite `stripThickness()`** ([TabBar.ts:1881](../src/typescript/lib/component/container/TabBar.ts#L1881))
   so the north/south path ([TabBar.ts:1884-1886](../src/typescript/lib/component/container/TabBar.ts#L1884))
   returns `max(retained-minimum, widest buttonCrossExtent + STRIP_CHROME)`
   instead of the flat `base`. Keep the existing west/east growth loop
   ([TabBar.ts:1892-1905](../src/typescript/lib/component/container/TabBar.ts#L1892))
   and the `"fixed"`-mode branch
   ([TabBar.ts:1888-1890](../src/typescript/lib/component/container/TabBar.ts#L1888));
   the `base` they start from becomes the same measured floor. Re-document the
   method's JSDoc to describe the measured derivation. — verify: typecheck.

3. **Re-document the floor constants.** Update the JSDoc on `STRIP_THICKNESS`
   ([TabBar.ts:64](../src/typescript/lib/component/container/TabBar.ts#L64)) and
   `STRIP_THICKNESS_COMPACT` ([TabBar.ts:67](../src/typescript/lib/component/container/TabBar.ts#L67))
   from "the thickness" to "minimum thickness floor before any tab measures".

4. **Re-sync the bar seed.** `this.setPreferredSize(0, STRIP_THICKNESS)` runs
   once in the `TabBar` constructor ([TabBar.ts:569](../src/typescript/lib/component/container/TabBar.ts#L569))
   and sets the *bar's own* preferred size. Confirm whether that preferred size
   is actually consulted — the owner's `composeSize` and `doLayout` position
   everything from `this._bar.stripThickness()` directly
   ([Tab.ts:1165](../src/typescript/lib/layout/Tab.ts#L1165),
   [1370](../src/typescript/lib/layout/Tab.ts#L1370),
   [1453](../src/typescript/lib/layout/Tab.ts#L1453)), so the seed is likely
   only an initial self-report. If it feeds anything, replace the literal with a
   call into `stripThickness()` (or refresh it in `doLayout`); if it is
   vestigial, leave the literal but note it. — verify: no clipping at large font
   (step 10).

5. **Add `scrollStepExtent()`** — a private method returning
   `this._entries.length > 0 ? this.predictedTabExtent(this._entries[0].button) ||
   SCROLL_ARROW_STEP : SCROLL_ARROW_STEP`. JSDoc: "px per arrow click ≈ one
   tab; falls back to the floor before measurement." — verify: typecheck.

6. **Rewire the arrow handlers** ([TabBar.ts:2461-2462](../src/typescript/lib/component/container/TabBar.ts#L2461))
   to named private handlers that call `this.scrollStrip(-this.scrollStepExtent())`
   / `(this.scrollStepExtent())`, resolving at click time, and register them by
   reference (`lead.on("action", this.scrollLeadClicked)` etc.) per the
   named-function listener rule (see Architecture Decisions). Re-document
   `SCROLL_ARROW_STEP` ([TabBar.ts:90](../src/typescript/lib/component/container/TabBar.ts#L90))
   as the floor. — verify: typecheck; manual arrow click pages ~one tab.

7. **Leave `SCROLL_ARROW_SIZE` and `TabReorderBar.THICKNESS` untouched**
   (per Non-Goals). — verify: `grep -nE "SCROLL_ARROW_SIZE = 24|THICKNESS = 2"
   src/typescript/lib/component/container/TabBar.ts` — expect both still present.

8. **Typecheck.** `npm run typecheck` (or the project's tsc task) — expect 0
   errors.

9. **Manual smoke test** on the Tab demo with the root font scaled up
   (see Verification). Confirm no label clipping on north/south/west/east, and
   that one arrow click advances roughly one tab.

### Phase 2 (deferred — do NOT implement under this plan)

Blocked on a numeric spacing/size theme-token surface (see Architecture
Decisions). When that surface exists: replace `TAB_BUTTON_INSET`/`_COMPACT`,
`CLOSE_BUTTON_SIZE`, `CLOSE_GLYPH_SIZE` reads (in `computeTabButtonInsets`,
`positionCloseButtons`, and the `pinGlyphSize` call) with
`ThemeManager.getTheme()` reads at `doLayout` time, following the
`defer-construction-time-theme-reads` deferral rule, with the owner's
`onThemeChange → scheduleLayout` listener already in place driving
re-resolution.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/component/container/TabBar.ts` (Phase 1: `stripThickness`, `scrollStepExtent`, named arrow handlers, floor-constant JSDoc, bar seed) |
| Modify (Phase 2, deferred) | `src/typescript/lib/core/Theme.ts` (new numeric `tab.spacing` / `tab.close` blocks — out of scope for this plan) |

No files created or deleted. No public API change in Phase 1 → no barrel,
`docs/`, or `XOptions` edits.

---

## Verification

- **Typecheck:** `npm run typecheck` — 0 errors.
- **Floor constants intact:** `grep -nE "STRIP_THICKNESS|SCROLL_ARROW_STEP|SCROLL_ARROW_SIZE = 24|THICKNESS = 2" src/typescript/lib/component/container/TabBar.ts`
  — `STRIP_THICKNESS`/`_COMPACT`/`SCROLL_ARROW_STEP` retained as floors,
  `SCROLL_ARROW_SIZE` and `TabReorderBar.THICKNESS` unchanged.
- **No new magic numbers undocumented:** any new `STRIP_CHROME`-style const
  carries a "what + why" comment.
- **No inline-arrow listener regression:** the rewired arrow handlers reference
  named methods, not inline closures (ARCHITECTURE.md:19-21).
- **Manual smoke test (the load-bearing check):** run the app (`npm run dev`,
  http://localhost:8015), open the **`TabDemoPanel`** screen
  ([src/typescript/TabDemoPanel.ts](../src/typescript/TabDemoPanel.ts)). In
  DevTools set `document.documentElement.style.fontSize` to a large value
  (e.g. `"22px"`) — or switch to a large-font theme if one exists — and confirm:
  the tab strip grows to fit the labels with **no clipping** on north, south,
  west, and east strips, in both normal and `compact` modes; the overflow
  arrows still fill the (now taller) strip; one arrow click advances roughly
  one tab. Scope DevTools queries to `.TabDemoPanel .TabPanel` so you measure
  the visible instance, not a hidden sibling.
- **Docs build:** not required — Phase 1 changes no public API. (If Phase 2 is
  ever folded in, `npm run docs:build` must report 0 errors / 0 link warnings.)

---

## Potential Challenges

- **Chrome delta is empirical.** The fixed band between the button box and the
  strip edge must be measured, not guessed — derive it from a real preferred
  height in the demo, or label clipping just moves to a different font size.
- **Pre-measurement floor.** Before the first layout (and on an empty strip) no
  button has a preferred size; the retained minimum must cover that case so the
  strip never collapses to chrome-only height.
- **Bar seed staleness.** The one-time `setPreferredSize(0, STRIP_THICKNESS)`
  ([TabBar.ts:569](../src/typescript/lib/component/container/TabBar.ts#L569))
  could pin a stale 30px if the bar's preferred size is consulted anywhere;
  confirm its role before deciding to refresh or leave it (step 4).
- **Scroll step before measurement.** `scrollStepExtent()` must fall back to the
  floor when `_entries[0]` has not measured, or the first click scrolls 0px —
  the `|| SCROLL_ARROW_STEP` floor (relying on `buttonMainExtent` returning 0)
  covers this.
- **Cross-class invalidation.** The thickness derivation lives in `TabBar` but
  the theme-switch relayout lives in the owner (`Tab.ts:317-318`) and the
  font-change relayout is bubbled by `Button`. Verify all three drive a fresh
  `stripThickness()` pass; none need new wiring, but the implementer should
  confirm rather than assume.

---

## Critical Files

- [`src/typescript/lib/component/container/TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) —
  the only Phase 1 file. Key symbols: constants
  [STRIP_THICKNESS:64](../src/typescript/lib/component/container/TabBar.ts#L64) /
  [STRIP_THICKNESS_COMPACT:67](../src/typescript/lib/component/container/TabBar.ts#L67) /
  [SCROLL_ARROW_SIZE:84](../src/typescript/lib/component/container/TabBar.ts#L84) /
  [SCROLL_ARROW_STEP:90](../src/typescript/lib/component/container/TabBar.ts#L90);
  methods `stripThickness` ([1881](../src/typescript/lib/component/container/TabBar.ts#L1881)),
  `buttonCrossExtent` ([1859](../src/typescript/lib/component/container/TabBar.ts#L1859)),
  `buttonMainExtent` ([1841](../src/typescript/lib/component/container/TabBar.ts#L1841)),
  `tabModeExtent` ([1918](../src/typescript/lib/component/container/TabBar.ts#L1918)),
  `predictedTabExtent` ([2147](../src/typescript/lib/component/container/TabBar.ts#L2147)),
  `computeArrowReserve` ([2163](../src/typescript/lib/component/container/TabBar.ts#L2163)),
  the arrow handlers ([2461-2462](../src/typescript/lib/component/container/TabBar.ts#L2461)),
  `scrollStrip` ([2612](../src/typescript/lib/component/container/TabBar.ts#L2612)),
  the bar seed ([569](../src/typescript/lib/component/container/TabBar.ts#L569)),
  the `_entries` collection ([466](../src/typescript/lib/component/container/TabBar.ts#L466)).
- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) —
  the owner; consumes the bar thickness in `composeSize`
  ([1155](../src/typescript/lib/layout/Tab.ts#L1155), reading
  `this._bar.stripThickness()` at [1165](../src/typescript/lib/layout/Tab.ts#L1165))
  and in `doLayout` ([1370](../src/typescript/lib/layout/Tab.ts#L1370),
  [1453](../src/typescript/lib/layout/Tab.ts#L1453)); holds the theme-switch
  relayout listener `onThemeChange → scheduleLayout`
  ([317-318](../src/typescript/lib/layout/Tab.ts#L317)). Not edited in Phase 1.
- [`src/typescript/lib/component/button/Button.ts:1258`](../src/typescript/lib/component/button/Button.ts#L1258)
  — `getPreferredSize` (and `recomputePreferredSize`
  [1284](../src/typescript/lib/component/button/Button.ts#L1284)): confirms the
  tab button's height is font-derived and bubbles a relayout on font change.
- [`src/typescript/lib/core/Theme.ts:42`](../src/typescript/lib/core/Theme.ts#L42)
  — the `Theme` interface and `themeToVars`
  ([699](../src/typescript/lib/core/Theme.ts#L699)): the all-strings convention
  Phase 2's numeric surface must extend; read before any Phase 2 work.
- [`src/typescript/TabDemoPanel.ts`](../src/typescript/TabDemoPanel.ts) — the
  smoke-test screen.
- Implemented theming plans to mirror for Phase 2:
  `plans/implemented/theme-tokens-and-thin-gray-borders.md`,
  `structural-base-theme.md`, `defer-construction-time-theme-reads.md`,
  `manrope-default-font.md`.

---

## Non-Goals

- **Do not redesign the theme system.** Phase 2's numeric token surface is
  sketched and deferred to a dedicated plan, not built here.
- **Do not touch non-font constants:** `TAB_FADE_DURATION_MS`
  ([TabBar.ts:40](../src/typescript/lib/component/container/TabBar.ts#L40), timing),
  `TabReorderBar.THICKNESS`
  ([TabBar.ts:331](../src/typescript/lib/component/container/TabBar.ts#L331), 2px
  hairline by design), the `_fixedWidth` default (user-overridable) all stay.
- **Do not implement Phase 2 in this plan.** Insets, close-button, and
  close-glyph sizing stay on their current constants until the token surface
  lands.
- **Do not derive `SCROLL_ARROW_SIZE`** from the thickness in Phase 1 (lower
  value, risks shrinking the compact click target) — revisit only if the smoke
  test shows a wrong gutter.
- **Do not generalize to Menu / Split / Table / Border.** Same pattern, but
  retrofitting them belongs to the Phase 2 theming plan's scope, not here.
