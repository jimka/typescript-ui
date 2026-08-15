# Scrollbar Width Unification — Implementation Plan

## Overview

This codebase has two independent, never-reconciled numbers for "how wide is
a vertical scrollbar":

- `DOM.source.getScrollBarWidth()` ([DOM.ts:2110](packages/lib/src/typescript/lib/core/DOM.ts#L2110))
  probes the real OS/browser scrollbar at runtime and memoizes the result —
  typically 15–17px, depending on platform, browser, and zoom.
- `TRACK_WIDTH` ([Scrollbar.ts:29](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L29))
  is a fixed `12`, module-private to `Scrollbar.ts`. This is what the
  framework's own themed `Scrollbar` component actually renders at, confirmed
  live in Chrome/Linux this session: a real `Scrollbar` measures exactly
  `12px` regardless of the native probe.

Three sites in the table subsystem reserve space for the framework's own
`Scrollbar` but measure that space with the native probe instead of
`TRACK_WIDTH`, so they silently disagree with what actually renders:
[`Table.getAvailableColumnWidth()`](packages/lib/src/typescript/lib/component/table/Table.ts#L773)
(sizes every column), [`layout/Table.ts`'s header block](packages/lib/src/typescript/lib/layout/Table.ts#L278)
(positions the column-menu button over the reservation band), and that
button's glyph-sizing math in
[`Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts#L203).
The button-positioning mismatch was confirmed live this session (native probe
`15px`): the column-menu button's divider sits `3px` left of where the real
`12px`-wide `Scrollbar` begins. It was invisible before this session because
the reserved band used to be filled by a plain, non-interactive cover `<div>`
— replaced by an interactive button with a crisp divider line in
[`plans/implemented/table-header-menu-button.md`](plans/implemented/table-header-menu-button.md),
which is what made the seam visible for the first time. This plan is scoped
to the width-source mismatch, not a repeat of that feature.

Every other call site of `getScrollBarWidth()` was audited (see
`## Architecture Decisions`) and either already reserves space correctly for
a *native* scrollbar (legitimate) or already reads the custom `Scrollbar`'s
own `getTrackWidth()` instance method (already correct). Only the three table
sites above are fixed.

---

## Architecture Decisions

### Unify on the custom `Scrollbar`'s fixed `TRACK_WIDTH`, not the native probe

The three broken call sites move to `TRACK_WIDTH`. The reverse direction —
making `Scrollbar` render at a variable, native-probe-derived width — is
rejected.[^why-fixed-width]

### `TRACK_WIDTH` is exported as a plain module constant from `Scrollbar.ts`

`Scrollbar.ts` already exposes `TRACK_WIDTH` to callers that hold a
`Scrollbar` instance, via the instance method `getTrackWidth()`
([Scrollbar.ts:715](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L715)).
The three broken sites don't hold an instance — they need the number before
any `Scrollbar` exists. The fix is `export const TRACK_WIDTH = 12;`, imported
directly by name, mirroring the codebase's existing pattern for exactly this
situation: `COLLAPSE_STRIP_SIZE` is exported from
[`CollapseSupport.ts:13`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L13)
and imported directly into `CollapseButton.ts`, `Split.ts`, and `Border.ts` —
three unrelated modules that need the same layout constant `CollapseSupport`
owns.[^precedent-search] `getTrackWidth()` itself is untouched and keeps
serving the call sites that already hold an instance (see below).

### Only three call sites are wrong; every other call site is already correct

Every call site of `DOM.source.getScrollBarWidth()` in `packages/lib/src`,
and every internal use of `TRACK_WIDTH`, was traced to classify each one:

| Site | Reserves space for | Verdict |
|---|---|---|
| [`Table.getAvailableColumnWidth()`](packages/lib/src/typescript/lib/component/table/Table.ts#L776) | The table's own custom `Scrollbar`, owned by `Body`'s `VirtualScroller` | **Wrong — fixed by this plan** |
| [`layout/Table.ts` header block](packages/lib/src/typescript/lib/layout/Table.ts#L278) | Same reservation band, for the column-menu button | **Wrong — fixed by this plan** |
| [`Header.ts` glyph pin](packages/lib/src/typescript/lib/component/table/Header.ts#L203) | The menu button's glyph, sized to fill the same band | **Wrong — fixed by this plan** |
| [`Panel.ts:750`](packages/lib/src/typescript/lib/core/Panel.ts#L750) | A `Panel`'s native scrollbar, when `scrollbarStyle: "native"` | Correct — genuinely native. Gated behind an early return at [Panel.ts:739](packages/lib/src/typescript/lib/core/Panel.ts#L739) that only reaches this line when `_scrollbarStyle !== "overlay"`. `Panel`'s own overlay path ([Panel.ts:1236](packages/lib/src/typescript/lib/core/Panel.ts#L1236)) already reads `this._scrollbarV.getTrackWidth()`, never the native probe |
| [`Menu.ts:334`](packages/lib/src/typescript/lib/overlay/Menu.ts#L334) | A `Menu`'s own `overflow-y: auto` when its content overflows | Correct — genuinely native. `Menu.ts` never imports `Scrollbar`; the scrolling menu list uses the browser's own bar, not the framework's | 
| [`main.ts:41`](packages/lib/src/typescript/main.ts#L41) | Nothing — pre-warms the memoization cache at app start | Not a reservation site; out of scope. Also demo-app code, not library source |
| `VirtualScroller.ts` (both `getTrackWidth()` calls, [:312](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L312), [:422](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L422)) | The `Table` body's and `Tree`'s own custom `Scrollbar`s | Already correct — reads the instance method | 

`Table`'s body scroll (via `Body extends VirtualRowView`) and `Tree`'s own
scroll both delegate to the shared `VirtualScroller` helper, which already
sources every reservation from `this._scrollbarV.getTrackWidth()`. `Tree.ts`
and `Panel.ts` (overlay mode) have no reservation logic of their own outside
that shared helper. So the mismatch is confined to the table subsystem's
column-width and menu-button code, which sits *outside* `VirtualScroller` and
duplicates the wrong source independently.

Two commented-out, pre-existing dead methods in
[`Component.ts:3293-3317`](packages/lib/src/typescript/lib/core/Component.ts#L3293)
also reference the native probe; they are unrelated (never called, predate
this investigation) and are left alone.

### Bundle the `MENU_BUTTON_CHROME_PX` fix into this same change

`Header.ts`'s glyph-sizing constant
([Header.ts:43](packages/lib/src/typescript/lib/component/table/Header.ts#L43))
is `6`, documented as "2px of compact insets plus a 1px transparent
flat-chrome frame on each side." A same-session commit
(`f6fa9a83`, "Clear the column-menu button's border so its divider reaches
every edge") added `this._menuButton.clearBorder()` and its hover/pressed
twins right after construction
([Header.ts:249-251](packages/lib/src/typescript/lib/component/table/Header.ts#L249)),
which sets the border to `none` (zero width) and overrides the `1px
transparent` border `flat: true` reserves during `super()`. The border no
longer contributes any width, so the constant's comment is stale and its
value is wrong: it should be `4` (compact insets only), not
`6`.[^chrome-px-bundling]

### The column-width shift is a real, changelog-worthy behaviour change

`Table.getAvailableColumnWidth()` currently subtracts the native probe
(15–17px on common platforms) from the table's inner width. After this
plan, it subtracts the fixed `12`. **On any platform where the native probe
isn't exactly `12`, every table's available column width changes** — it
grows by `nativeProbeWidth - 12`, typically 3–5px. This is not an invisible
implementation detail: columns get measurably wider on most platforms. It is
recorded as an explicit, intentional entry in the changelog (see
`## Documentation Impact`), not folded silently into the bug-fix entry for
the button seam.

---

## Public API

No exported symbol changes signature. `Scrollbar.ts` gains one new named
export:

```typescript
export const TRACK_WIDTH: number;   // = 12
```

This is **not** re-exported through `component/container/index.ts` — the
barrel exports `Scrollbar` and its option/event types by name only
([container/index.ts:20-21](packages/lib/src/typescript/lib/component/container/index.ts#L20)),
the same shape `CollapseSupport.ts` uses for `COLLAPSE_STRIP_SIZE` (never
re-exported through `layout/index.ts`). `TRACK_WIDTH` is importable directly
from `~/component/container/Scrollbar.js` by any module inside the library,
but it does not appear in the public API docs and needs no `{@link}` —
per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md)'s rule against linking
symbols TypeDoc excludes, describe it in prose in any JSDoc that mentions it.

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/container/Scrollbar.ts`** —
   export the constant. Change:
   ```typescript
   const TRACK_WIDTH    = 12;
   ```
   to
   ```typescript
   // Fixed cross-axis (track) width of the custom Scrollbar, in pixels —
   // independent of the OS/browser's native scrollbar width, which
   // `DOM.source.getScrollBarWidth()` measures separately for genuinely
   // native scroll paths. Exported so a caller that needs to reserve space
   // for a Scrollbar it doesn't hold an instance of yet (e.g. Table's
   // column-width and header-button layout math) can read the value
   // directly — the same shape `CollapseSupport.ts` uses for
   // `COLLAPSE_STRIP_SIZE`.
   export const TRACK_WIDTH = 12;
   ```
   Leave `THUMB_INSET` / `THUMB_MIN_SIZE` and every internal use of
   `TRACK_WIDTH` (arrow-button sizing, thumb inset, `endPos`, the arrows'
   hit-test) untouched — same identifier, now exported.
   Check: `npm run typecheck` passes.

2. **`packages/lib/src/typescript/lib/component/table/Table.ts`** — fix
   `getAvailableColumnWidth()`.
   - Add `import { TRACK_WIDTH } from "~/component/container/Scrollbar.js";`
     near the existing `~/component/container/CheckboxMenuRow.js` import.
   - Change the method body
     ([Table.ts:773-777](packages/lib/src/typescript/lib/component/table/Table.ts#L773)):
     ```typescript
     getAvailableColumnWidth(): number {
         const innerSize = this.getInnerSize();

         return innerSize ? innerSize.width - TRACK_WIDTH : 0;
     }
     ```
   - In its JSDoc, change the phrase "less the reserved vertical-scrollbar
     track" to "less the custom vertical `Scrollbar`'s fixed track width" —
     no `{@link}`.
   - Remove the now-unused `import { DOM } from "~/core/DOM.js";`
     ([Table.ts:40](packages/lib/src/typescript/lib/component/table/Table.ts#L40))
     — line 776 was the file's only `DOM.source`/`DOM.sink` call.
   Check: `grep -n "DOM\.\(source\|sink\)\." packages/lib/src/typescript/lib/component/table/Table.ts`
   returns zero matches; `npm run typecheck` passes (`noUnusedLocals` is
   `true` in `packages/lib/tsconfig.json`, so a leftover unused `DOM` import
   fails the build, not just lint).

3. **`packages/lib/src/typescript/lib/layout/Table.ts`** — fix the
   menu-button's `trackW`.
   - Replace `import { DOM } from "~/core/DOM.js";`
     ([layout/Table.ts:9](packages/lib/src/typescript/lib/layout/Table.ts#L9))
     with `import { TRACK_WIDTH } from "~/component/container/Scrollbar.js";`
     — this file's only `DOM.` call is the one being replaced below.
   - Change
     [layout/Table.ts:278](packages/lib/src/typescript/lib/layout/Table.ts#L278):
     ```typescript
     const trackW      = DOM.source.getScrollBarWidth();
     ```
     to
     ```typescript
     const trackW      = TRACK_WIDTH;
     ```
   - Append one clause to the comment immediately above (the one explaining
     `setPreferredSize`,
     [layout/Table.ts:271-277](packages/lib/src/typescript/lib/layout/Table.ts#L271)):
     add a short paragraph noting `trackW` is the custom `Scrollbar`'s fixed
     track width, not the native probe, because the band must match what
     `Body`'s `VirtualScroller` actually renders.
   Check: same `grep`/`typecheck` pattern as step 2, against
   `packages/lib/src/typescript/lib/layout/Table.ts`.

4. **`packages/lib/src/typescript/lib/component/table/Header.ts`** — fix the
   glyph pin and the stale chrome constant.
   - Add `import { TRACK_WIDTH } from "~/component/container/Scrollbar.js";`
     near the existing `Button` / `Glyph` imports. The existing
     `import { DOM } from "~/core/DOM.js";`
     ([Header.ts:4](packages/lib/src/typescript/lib/component/table/Header.ts#L4))
     stays — `DOM.source.getViewportRect(this._menuButton)`
     ([Header.ts:613](packages/lib/src/typescript/lib/component/table/Header.ts#L613))
     is unrelated and unaffected.
   - Change the constant and its comment
     ([Header.ts:37-43](packages/lib/src/typescript/lib/component/table/Header.ts#L37)):
     ```typescript
     // A flat, compact, glyph-only `Button` reserves `glyph + MENU_BUTTON_CHROME_PX`
     // per axis around the glyph — 2px of compact insets on each side. The
     // button's own border is cleared in the constructor (`clearBorder()`
     // and its hover/pressed twins), so it contributes no width here. The
     // button fills the vertical-scrollbar reservation band exactly (see
     // the constructor, which pins the glyph to `TRACK_WIDTH -
     // MENU_BUTTON_CHROME_PX`), so this is the fixed per-side overhead
     // subtracted from that fixed track width.
     const MENU_BUTTON_CHROME_PX = 4;
     ```
   - Change the glyph-pin computation and its comment
     ([Header.ts:196-203](packages/lib/src/typescript/lib/component/table/Header.ts#L196)):
     replace the sentence "`getScrollBarWidth()` is memoized after its first
     call, so this read is cheap on every subsequent `TableHeader`" with
     "`TRACK_WIDTH` is a fixed compile-time constant, so this costs nothing
     at runtime," and change the computation itself:
     ```typescript
     const glyphPx = Math.max(1, TRACK_WIDTH - MENU_BUTTON_CHROME_PX);
     ```
   Check: `npm run typecheck` passes.

5. **`packages/lib/tests/component/container/Scrollbar.test.ts`** — stop
   hand-mirroring `TRACK_WIDTH`. This file already carries a comment
   ([Scrollbar.test.ts:17-20](packages/lib/tests/component/container/Scrollbar.test.ts#L17))
   acknowledging `TRACK_WIDTH` is duplicated from the (until now)
   module-private value in `Scrollbar.ts`. Now that it is exported:
   - Add `TRACK_WIDTH` to the existing
     `import { Scrollbar, isScrollbarTarget } from '~/component/container/Scrollbar';`
     line.
   - Remove the local `const TRACK_WIDTH = 12;`
     ([Scrollbar.test.ts:22](packages/lib/tests/component/container/Scrollbar.test.ts#L22)),
     keeping `THUMB_MIN_SIZE` (still module-private, so still mirrored) and
     trimming the comment above to describe only `THUMB_MIN_SIZE`.
   - The existing test `'exposes TRACK_WIDTH via getTrackWidth'`
     ([Scrollbar.test.ts:32-36](packages/lib/tests/component/container/Scrollbar.test.ts#L32))
     needs no logic change — it now compares the real export against
     `getTrackWidth()` instead of a hand-copied literal against it, which is
     a strictly stronger regression guard for exactly the drift this plan
     fixes.
   Leave `content-box-containment.test.ts`, `Tree.test.ts`, and
   `VirtualScroller.test.ts` untouched — each already derives its local
   `TRACK_WIDTH` from a live `new Scrollbar(...).getTrackWidth()` call rather
   than a hard-coded literal, so none of them duplicate the value or need
   the new export.

6. **`packages/lib/tests/component/table/HeaderMenuButton.test.ts`** —
   update geometry assertions and add two regression tests.
   - Add `import { TRACK_WIDTH } from '~/component/container/Scrollbar';`.
   - In the three tests that read `const trackW = DOM.source.getScrollBarWidth();`
     ([:96](packages/lib/tests/component/table/HeaderMenuButton.test.ts#L96),
     [:106](packages/lib/tests/component/table/HeaderMenuButton.test.ts#L106),
     [:126](packages/lib/tests/component/table/HeaderMenuButton.test.ts#L126)),
     replace the right-hand side with `TRACK_WIDTH`. These three tests
     currently pass only because the test harness's configured
     `scrollBarWidth: 15` happens to be read back by the same
     `getScrollBarWidth()` call the production code (pre-fix) also used; once
     step 3 lands, production code reports `12` while these tests still
     compare against `15`, so leaving them unchanged would fail them, not
     just leave them stale.
   - Add the two new cases from `## Expected Behaviour` below (the
     probe-independence test and the glyph-pin-value test), in the existing
     `'TableHeader menu button'` describe block.
   Check: `npm run test -- HeaderMenuButton` passes.

7. **`packages/lib/tests/component/table/Table.test.ts`** — add the
   `getAvailableColumnWidth` probe-independence case from
   `## Expected Behaviour` below, as a new `describe` block. Import
   `TRACK_WIDTH` the same way as step 6.
   Check: `npm run test -- Table.test` passes.

8. **`packages/lib/docs/reference/changelog/next.md`** — add the two entries
   from `## Documentation Impact` below.

9. **Full verification.** Run everything in `## Verification`, including the
   browser check.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Table.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/tests/component/container/Scrollbar.test.ts` |
| Modify | `packages/lib/tests/component/table/HeaderMenuButton.test.ts` |
| Modify | `packages/lib/tests/component/table/Table.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Unit-testable offline (the harness models `getScrollBarWidth` via a
configurable `scrollBarWidth`, so a test can set it to something other than
`12` to prove a call site no longer tracks it):

1. **`Table.getAvailableColumnWidth()` no longer tracks the native probe.**
   Building the same table under two different `TestDOM` configs —
   `scrollBarWidth: 15` and `scrollBarWidth: 40` — must yield the *same*
   `getAvailableColumnWidth()` result both times, and that result must equal
   `table.getInnerSize()!.width - TRACK_WIDTH` exactly. Sketch, for
   `Table.test.ts`:
   ```typescript
   it('getAvailableColumnWidth uses the fixed Scrollbar track width, not the native scrollbar probe', () => {
       installTestDOM({ ...CONFIG, scrollBarWidth: 15 });
       const store = new MemoryStore(MODEL, []);
       const tableA = new Table(store);
       tableA.getElement(true);
       tableA.setWidth(400);
       tableA.setHeight(300);
       tableA.doLayout();
       const innerWidth = tableA.getInnerSize()!.width;
       expect(tableA.getAvailableColumnWidth()).toBe(innerWidth - TRACK_WIDTH);
       DOM.reset();

       installTestDOM({ ...CONFIG, scrollBarWidth: 40 });
       const tableB = new Table(new MemoryStore(MODEL, []));
       tableB.getElement(true);
       tableB.setWidth(400);
       tableB.setHeight(300);
       tableB.doLayout();
       expect(tableB.getAvailableColumnWidth()).toBe(innerWidth - TRACK_WIDTH);
   });
   ```
2. **The column-menu button's reservation band tracks the same fixed
   constant.** With `TestDOM`'s `scrollBarWidth` set to `40` (not `12`),
   `header.getMenuButton().getWidth()` must still be `TRACK_WIDTH` (`12`),
   not `40` — the current (pre-fix) behaviour it regresses against.
3. **The glyph pin no longer depends on the native probe either.**
   `header.getMenuButton().getGlyph()!.getPreferredSize()!.width` must equal
   `8` (`TRACK_WIDTH` `12` minus the corrected `MENU_BUTTON_CHROME_PX` `4`),
   under any configured `scrollBarWidth`.
4. **`Scrollbar.TRACK_WIDTH` and `Scrollbar.getTrackWidth()` agree by
   construction.** `new Scrollbar('vertical').getTrackWidth() === TRACK_WIDTH`
   — already covered by the updated `Scrollbar.test.ts` case in step 5.

Not retested (regression only, no behaviour change — confirm these still
pass unmodified): `PanelOverlayScrollbar.test.ts`'s native-mode gutter
assertions, and `Menu.test.ts`'s three scrollbar-gutter assertions
([:752](packages/lib/tests/overlay/Menu.test.ts#L752),
[:783](packages/lib/tests/overlay/Menu.test.ts#L783),
[:863](packages/lib/tests/overlay/Menu.test.ts#L863)) — both still read
`DOM.source.getScrollBarWidth()` directly, untouched by this plan.

Manual verification only (needs a real browser):

5. Open a table in the Misc panel and compare the column-menu button's left
   edge against the vertical scrollbar's own left edge at 100% zoom — they
   must be flush, closing the 3px seam this session found. Compare against
   the pre-fix screenshot if one was captured.
6. The column-menu button and its glyph both read visibly narrower than
   before on a platform whose native scrollbar is wider than 12px (most
   Windows/Linux browsers) — expected, not a regression.
7. Table columns are a few pixels wider than before on the same platforms —
   expected per `## Architecture Decisions`, not a regression.

---

## Verification

- `npm run typecheck` — also the mechanical check that both now-unused `DOM`
  imports were removed (`noUnusedLocals: true`).
- `npm run test` — includes the updated/added cases in
  `Scrollbar.test.ts`, `HeaderMenuButton.test.ts`, and `Table.test.ts`.
- `npm run lint`
- `npm run docs:api` — must finish with zero warnings (JSDoc changed on
  `getAvailableColumnWidth`; confirms no accidental `{@link}` to the
  non-public `TRACK_WIDTH`).
- **Browser check — required.** `npm run dev` (http://localhost:8015), open
  **Misc.**, inspect a table with enough rows to show a vertical scrollbar.
  Confirm behaviours 5–7 above.

---

## Documentation Impact

No public API surface changes (`TRACK_WIDTH` is not re-exported through any
barrel; see `## Public API`). Two changelog entries in
[`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md),
matching that file's existing per-section style:

- Under `## Fixed` → `### Table` (paragraph style, matching the existing
  entries at [next.md:259-265](packages/lib/docs/reference/changelog/next.md#L259)):
  a bullet stating the column-menu button no longer sits shifted from the
  vertical scrollbar it caps, explaining the native-probe-vs-fixed-`12px`
  mismatch and that both are now sized from the same fixed track width.
- Under `## Changed` → `### Table` (bulleted-list style, matching the
  existing entries at [next.md:76-119](packages/lib/docs/reference/changelog/next.md#L76)):
  a bullet stating that a table's available column width is now computed
  from the custom `Scrollbar`'s fixed 12px track rather than the browser's
  native scrollbar probe, that most platforms gain a few extra pixels of
  column width as a result, and that no consumer action is needed.

Two separate entries, not one, because they answer different questions a
reader of the changelog might have: "was the button seam a bug" (yes — the
`Fixed` entry) and "will my columns look different" (yes, slightly, on most
platforms — the `Changed` entry).

---

## Potential Challenges

- **The offline harness's default `scrollBarWidth: 15` can hide the fix.**
  A test that asserts `trackW === DOM.source.getScrollBarWidth()` still
  passes after the fix if `getScrollBarWidth()` happens to also be pinned to
  `12` in that file's `CONFIG` — it wouldn't be (`15` is the default), but
  the failure mode is silent, not loud, if a future edit ever changes the
  default. `## Expected Behaviour` cases 1–2 guard against this by explicitly
  using a *different* `scrollBarWidth` and asserting the result does NOT
  track it.
- **Every table's columns get a few pixels wider on most platforms.** This
  is intentional (see `## Architecture Decisions`) but will shift pixel-exact
  screenshots or golden layouts anywhere outside this repo's own test suite
  that pinned a table's column widths against the old, native-probe-derived
  number.
- **The button and glyph read visibly smaller in the browser check** — a
  12px band instead of 15–17px is a real, if small, visual shrink. This is
  the fix, not a regression; `## Expected Behaviour` case 6 names it
  explicitly so it isn't second-guessed during the manual check.

---

## Critical Files

Read before implementing:

- [`packages/lib/src/typescript/lib/component/container/Scrollbar.ts`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts) —
  `TRACK_WIDTH` (L29) and every internal use (thumb inset, arrow squares,
  `endPos`, hit-test), and `getTrackWidth()` (L715), which stays unchanged.
- [`packages/lib/src/typescript/lib/layout/CollapseSupport.ts`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts) —
  **the precedent this plan mirrors** for exposing a cross-module layout
  constant: `COLLAPSE_STRIP_SIZE` (L13), imported directly by
  `CollapseButton.ts`, `Split.ts`, and `Border.ts`.
- [`packages/lib/src/typescript/lib/component/table/Table.ts`](packages/lib/src/typescript/lib/component/table/Table.ts) —
  `getAvailableColumnWidth()` (L773) and its caller `onColumnResize` (L2082),
  which inherits the fix without its own change.
- [`packages/lib/src/typescript/lib/layout/Table.ts`](packages/lib/src/typescript/lib/layout/Table.ts) —
  the header block (L153-299): `availableWidth` (L127), the menu-button
  placement (L261-298) this plan edits.
- [`packages/lib/src/typescript/lib/component/table/Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts) —
  `MENU_BUTTON_CHROME_PX` (L43) and the constructor's glyph pin (L203) and
  border-clearing calls (L249-251), which is why the constant's old value
  (`6`) is now wrong.
- [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts) —
  read-only, for contrast: `ScrollbarStyle` (L58), the native-mode gate at
  `measureScrollbarGutter` (L734-776, `getScrollBarWidth()` at L750), and the
  overlay-mode `layoutOverlayScrollbars` (L1229, `getTrackWidth()` at L1236)
  — proof this file already gets the native-vs-custom split right and needs
  no change.
- [`packages/lib/src/typescript/lib/component/container/VirtualScroller.ts`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts) —
  read-only: `computeScrollbarVisibility` (L300) and `layoutScrollbars`
  (L415) already source every reservation from `getTrackWidth()`. Shared by
  `Table`'s `Body` and `Tree`, so both are already correct outside the three
  sites this plan fixes.
- [`plans/implemented/table-header-menu-button.md`](plans/implemented/table-header-menu-button.md) —
  background on why the reservation band and the column-menu button exist;
  not re-implemented here.

---

## Non-Goals

- **No change to `Scrollbar`'s own rendered width.** It stays a fixed `12px`
  everywhere; this plan does not make it track the native probe (rejected
  direction, see `## Architecture Decisions`).
- **No change to `Panel.ts`, `VirtualScroller.ts`, `Tree.ts`, or `Menu.ts`.**
  Each was audited and is already correct — native-mode `Panel` and `Menu`
  genuinely need the native probe; `VirtualScroller` (and therefore `Tree`
  and the table body) already reads `getTrackWidth()`.
- **No consolidation of `getTrackWidth()` into the new `TRACK_WIDTH`
  export at its existing call sites.** `Panel.ts:1236` and
  `VirtualScroller.ts:312,422` already hold a live `Scrollbar` instance and
  are already correct; swapping them to the module constant would be an
  unrelated, unrequested refactor of working code.
- **No change to `content-box-containment.test.ts`, `Tree.test.ts`, or
  `VirtualScroller.test.ts`.** Each already derives its local `TRACK_WIDTH`
  from a live `Scrollbar` instance rather than a hard-coded literal, so none
  of them carries the duplication risk `Scrollbar.test.ts` did.
- **No change to the two commented-out dead methods in `Component.ts`**
  (`getHorizontalScrollBarSize` / `getVerticalScrollBarSize`, L3293-3317).
  Pre-existing, unrelated, never called.
- **No change to whether `getAvailableColumnWidth()` reserves space
  unconditionally versus only when the vertical scrollbar is actually
  visible.** It already reserves unconditionally, regardless of overflow —
  a separate design question from which *number* it reserves, and out of
  scope here.
- **No fix to the pre-existing, unrelated duplication of `TOGGLE_WIDTH`**
  between `TreeRow.ts` and `TreeCell.ts` (same literal `20`, defined
  independently in both, not imported). Noted as an observed anti-pattern
  during the precedent search, not touched — different subsystem, different
  bug class, not requested.

---

## Notes

[^why-fixed-width]: `Scrollbar.ts`'s internal layout is built around the
    fixed `12px` throughout, not just at the outer edge: `THUMB_INSET` math
    (`TRACK_WIDTH - 2 * THUMB_INSET` for the thumb's cross-axis size,
    [Scrollbar.ts:455](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L455)),
    the arrow buttons (rigid `TRACK_WIDTH × TRACK_WIDTH` squares,
    [Scrollbar.ts:137-138](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L137)),
    the end-arrow's `endPos` offset
    ([Scrollbar.ts:680](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L680)),
    and the arrow hit-test
    ([Scrollbar.ts:1022](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L1022)).
    Making the track width vary with the native probe would require
    reworking every one of these into proportional math, for a component
    that currently has none — a materially larger, riskier change than
    fixing three call sites to read the value that already exists. It would
    also make the rendered scrollbar's width vary by OS/browser/zoom again,
    which is the opposite of what a themed, cross-platform-consistent custom
    widget is for.

[^precedent-search]: Other exported cross-module numeric constants were
    checked for the same shape: `STATUS_BAR_HEIGHT`
    ([StatusBar.ts:17](packages/lib/src/typescript/lib/component/container/StatusBar.ts#L17))
    is exported and re-exported through `container/index.ts`, but nothing
    inside `packages/lib/src` actually imports it — it exists for external
    consumers sizing layout around a `StatusBar`, not for cross-module
    internal math, so it's a weaker match than `COLLAPSE_STRIP_SIZE`.
    `TOGGLE_WIDTH` is defined independently (same literal `20`, no import)
    in both `TreeRow.ts` and `TreeCell.ts` — this is the anti-pattern this
    plan avoids repeating, not a precedent to follow (see `## Non-Goals`).
    `COLLAPSE_STRIP_SIZE` was the only exact match: a plain, non-barrel
    numeric export, imported by name into multiple unrelated modules for
    shared layout math — the same shape `TRACK_WIDTH` needs.

[^chrome-px-bundling]: Fixing the stale comment/constant was considered as a
    separate one-line follow-up instead of folding it into this plan, since
    it is not, strictly, part of the width-source mismatch. It's bundled
    here instead because step 4 already rewrites every line around it (the
    glyph-pin computation moves from `getScrollBarWidth()` to `TRACK_WIDTH`
    in the same statement `MENU_BUTTON_CHROME_PX` feeds), and because
    leaving a known-wrong magic number sitting one line away from a change
    that touches its neighbour, unfixed, would be a worse outcome than
    fixing it in the same pass — a future reader would have no way to tell
    the leftover `6` was known-stale rather than freshly wrong.
