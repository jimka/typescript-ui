---
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
---

# Glyph Size Registration Gap Followups — Implementation Plan

## Overview

[`glyph-preferredsize-reconciled-write-path.md`](plans/implemented/glyph-preferredsize-reconciled-write-path.md) fixed three duplicate `Glyph` size rows the Style Audit panel (`#/style-audit`) reported — bare `Glyph` (16×16), `CheckboxCheckGlyph` (12×12), `RadioButtonDot` (8×8) — by registering a matching `minSize`/`maxSize` class default on each, so the already-reconciled `Component.setMinSize`/`setMaxSize` write path (`reconcileRuleDeclaration`) turns the pre-existing imperative size pin into a removal instead of a real per-instance declaration. That plan's own `## Non-Goals` flagged two more duplicate-rule groups it deliberately left open: a bare-`Glyph` 14×14 group and a char-mode 12×12 group carrying `font-size: 10px; line-height: 1; text-align: center`.

This plan locates both. The 12×12 group traces to exactly one call site: [`ScrollArrowButton`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L140), the press-and-hold arrow button at each end of a [`Scrollbar`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L500)'s track. It fits the shipped fix shape exactly — a fixed compile-time constant, a dedicated subclass, one registration — and this plan applies that fix. The 14×14 group does not fit the shape at all: live-DOM inspection (below) traces it to three unrelated components whose glyph size is genuinely computed per instance from the active theme's font metrics, not a class constant. This plan documents that finding and defers it; see `## Non-Goals`.

---

## Architecture Decisions

### The 12×12 duplicate is a registration gap, matching the shipped fix's precondition exactly

[`TRACK_WIDTH`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L38) (`12`) and [`ARROW_GLYPH_FONT_SIZE`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L50) (`10`) are plain module-level `const` numbers — never theme- or instance-derived. `ScrollArrowButton`'s constructor ([Scrollbar.ts:206-208](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L206)) builds a bare `new Glyph("unicode-arrow-" + direction)` and immediately pins it with `setPreferredSize({width:TRACK_WIDTH,height:TRACK_WIDTH})` + `setFontSize(ARROW_GLYPH_FONT_SIZE)` — the identical shape as `Checkbox`'s constructor sizing `CheckboxCheckGlyph`, just with an extra `setFontSize` call. `Glyph`'s registry ([Glyphs.ts:43-46](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L43)) defines exactly four `kind: "char"` entries — `unicode-arrow-up/down/left/right` — and `grep -rn '"unicode-arrow-'` across `packages/lib/src` finds exactly one construction site: `ScrollArrowButton`. So, like the three already-fixed cases, one component, one call site, one fixed size — confirmed live: a dev server driven via `chrome-devtools` (see `## Verification`) showed every `#id` rule matching the 12×12 body has `parentElement.className` = `"ScrollArrowButton"` and `grandParentElement.className` = `"Scrollbar"`, with textContent one of `▲▼◀▶`.[^live-probe]

### No new named constant is needed — `TRACK_WIDTH` already fills that role

The shipped plan had to introduce `CHECKBOX_CHECK_SIZE`/`RADIO_DOT_SIZE`/`GLYPH_DEFAULT_SIZE` because no shared constant existed between each class default and its constructor call. Here, `TRACK_WIDTH` is already exported and already backs the imperative `setPreferredSize` call — the class default in `## Internal Structure` below references it directly, so the two can never drift apart without a second new constant.

### The fix closes only the size portion; `font-size`/`line-height`/`text-align` stay real

`Glyph.setFontSize`/`setLineHeight`/`setTextAlign` ([Glyph.ts:356-361](packages/lib/src/typescript/lib/component/display/Glyph.ts#L356), [:401-406](packages/lib/src/typescript/lib/component/display/Glyph.ts#L401), [:432-437](packages/lib/src/typescript/lib/component/display/Glyph.ts#L432)) all write through the raw `this.setElementCSSRule(...)` — never `setReconciledCSSRules`/`reconcileRuleDeclaration`. `Component.ts`'s only `reconcileRuleDeclaration` call sites cover `visibility`, `color`, `backgroundColor`, `backgroundImage`, the four min/max size keys, `overflowX`/`overflowY`, the border keys, `outline`, `borderRadius`, `boxShadow`, `whiteSpace`, and `userSelect` — `fontSize`/`lineHeight`/`textAlign` are not among them anywhere in the file. A class default for these three keys would therefore be inert: nothing ever compares an instance's real `fontSize`/`lineHeight`/`textAlign` write against a class-tier value, so they always materialise as real per-instance declarations regardless of what any defaults bag says. This plan's class default therefore carries only `minSize`/`maxSize` — the two keys the reconciled path actually reads, matching the shipped plan's own fix shape of "a pre-existing imperative constructor call's literal size," not font metrics. Widening `fontSize`/`lineHeight`/`textAlign` onto the reconciled path is a `Glyph.ts` write-path change, which the shipped plan already ruled unnecessary for its three cases and this plan does not reopen; see `## Non-Goals`.

One consequence worth stating plainly: because `unicode-arrow-*` is char-mode, `Glyph`'s own constructor ([Glyph.ts:277-284](packages/lib/src/typescript/lib/component/display/Glyph.ts#L277)) always calls `setLineHeight("1")`/`setTextAlign("center")` imperatively (guarded only by `_options.lineHeight`/`_options.textAlign` being unset, which they always are here), and `ScrollArrowButton` always calls `setFontSize(10)`. All three are real, non-reconciled writes, so the glyph's `#id` rule still materialises after this fix — it never reaches the empty `{}` `CheckboxCheckGlyph` reached (that glyph is SVG-mode, so it carries no char-mode lineHeight/textAlign, and its one non-size field, `foregroundColor`, is on the reconciled `color` path). The Style Audit's reported byte count for this row drops (four of seven declarations become one shared class rule instead of forty-plus per-instance copies) but the row does not disappear the way `CheckboxCheckGlyph`'s did.[^null-not-skip]

### The 14×14 duplicate does not fit this fix shape — three unrelated, theme-derived mechanisms converge on the same value today

Live-DOM inspection (dev server, `chrome-devtools`, `#/misc` with several windows open, `#/style-audit` → Refresh) found 30 live `#id` rules matching `{min-width:14px;min-height:14px;max-width:14px;max-height:14px;}` with no `font-size`/`line-height`/`text-align` (confirming SVG-mode glyphs, not a char-mode case). Tracing each rule's element up the DOM tree found three structurally distinct owners, none a fixed literal:

| Owner | Mechanism | Where |
|---|---|---|
| `Button` (plain, `MenuButton`, `PickerButton`, `NotificationHistoryButton`) — 24 of 30 | `_syncGlyphSize()` rounds the button title's *rendered line-box height* (`Math.round(this._text.getLineHeight())`) and pins the leading glyph to that square | [Button.ts:1621-1646](packages/lib/src/typescript/lib/component/button/Button.ts#L1621) |
| `ComboBoxCaret` — 2 of 30 | Sizes its chevron glyph to `Util.lineHeightPx({linePadding:false})` — explicitly, per its own comment, "so the chevron matches the trigger icons of sibling fields" (the `Button`-hosted ones above) | [ComboBox.ts:546-568](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L546) |
| `WindowHeader`'s title glyph — 3 of 30 | Sizes to `ThemeManager.getResolvedScale().titleGlyph`, itself the theme's `scale.base` (`14` in every shipped theme today) times a `{scale:1}` token, re-resolved on every theme change | [WindowHeader.ts:173-202](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L173) |

All three resolve to `14` today only because every shipped theme's base font size is `14` and none of these three call sites overrides it. None is a per-class literal the way `TRACK_WIDTH`/`CHECKBOX_CHECK_SIZE` are: a theme with a different `scale.base`, or a `Button` with a custom `fontSize`, changes the resolved value. `Button`'s own doc comment for `_syncGlyphSize` and `pinGlyphSize` already states this is deliberate per-instance behaviour, and the shipped sibling plan's `## Non-Goals` pre-emptively excluded exactly this case ("a button's icon sized off its own font metrics… `ComboBox`'s chevron sized off a configurable `_size` field"). A class default cannot express "whatever the currently active theme's base font size resolves to" — it would go stale the moment a consumer's theme differs. This plan does not attempt a fix here; see `## Non-Goals` for the recommended direction.

---

## Internal Structure

`component/container/Scrollbar.ts` — add `GlyphOptions` to the existing `Glyph` import:

```typescript
import { Glyph, GlyphOptions } from "~/component/display/Glyph.js";
```

Add a new file-local class immediately before `class ScrollArrowButton` ([Scrollbar.ts:140](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L140)), mirroring `CheckboxCheckGlyph`'s exact shape ([Checkbox.ts:139-164](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L139)):

```typescript
const _defaultScrollArrowGlyphOptions: Partial<GlyphOptions> = {
    minSize: { width: TRACK_WIDTH, height: TRACK_WIDTH },
    maxSize: { width: TRACK_WIDTH, height: TRACK_WIDTH },
};

/**
 * The Unicode-triangle glyph inside a {@link ScrollArrowButton}. `minSize`/
 * `maxSize` are a class default (TRACK_WIDTH square), so every arrow across
 * every Scrollbar shares one `.ScrollArrowGlyph` CSS rule instead of each
 * repeating the same four declarations. `ScrollArrowButton`'s own constructor
 * still calls `setPreferredSize`/`setFontSize` imperatively (a `Glyph`'s
 * construction-time size pin cannot itself be deferred to a defaults bag —
 * see `Glyph.applyOptions`), but the size call now resolves to the same
 * TRACK_WIDTH value this class already defaults, so `Component.applyStyle`'s
 * render-time reconciliation (`reconcileRuleDeclaration`) turns it into a
 * removal instead of a redundant per-instance declaration. `fontSize`/
 * `lineHeight`/`textAlign` are NOT defaulted here: `Glyph`'s setters for
 * those three write through the raw, non-reconciled `setElementCSSRule`
 * path, so a class default for them would never be compared against and
 * would do nothing — they stay real per-instance declarations regardless.
 */
class ScrollArrowGlyph extends Glyph {
    constructor(direction: ArrowDirection) {
        super("unicode-arrow-" + direction, undefined, _defaultScrollArrowGlyphOptions);
    }
}
```

`ScrollArrowButton`'s constructor ([Scrollbar.ts:206-208](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L206)) — only the constructor call changes, the two follow-up calls are untouched:

```typescript
this._glyph = new ScrollArrowGlyph(direction);
this._glyph.setPreferredSize({ width: TRACK_WIDTH, height: TRACK_WIDTH });
this._glyph.setFontSize(ARROW_GLYPH_FONT_SIZE);
```

`private _glyph: Glyph;` ([Scrollbar.ts:142](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L142)) keeps its existing `Glyph` type — `CheckboxCheckGlyph`/`RadioButtonDot` left `_check`/`_dot` typed `Glyph` too, not narrowed to the subclass.

---

## Ordered Implementation Steps

1. **Write the test first.** `packages/lib/tests/component/container/ScrollbarArrow.test.ts` — add a new case to the existing `'ScrollArrowButton static style hoisting'` describe block ([line 157](packages/lib/tests/component/container/ScrollbarArrow.test.ts#L157)), immediately after `'row 1'` ([line 192](packages/lib/tests/component/container/ScrollbarArrow.test.ts#L192)), reusing that block's own `idSelector`/`declarationsDuring` helpers:
   ```typescript
   it('row 2: a rendered arrow glyph writes no min/max declaration to its own #id rule, but keeps its real font-size/line-height/text-align', () => {
       const sink = installTestDOM(CONFIG);

       const bar = new Scrollbar('vertical', { arrowsEnabled: true });
       const [, arrowStart] = bar.getComponents();
       const glyph = arrowStart.getComponents()[0];

       const declarations = declarationsDuring(sink, idSelector(glyph), () => bar.getElement(true));

       // The four size keys are present but every one is an explicit null
       // removal — the rule still materialises because fontSize/lineHeight/
       // textAlign (below) are always real, non-reconciled writes that force
       // it; the size keys ride along in the same flush. Mirrors the
       // corrected `unicode-arrow-up` case in
       // plans/implemented/glyph-preferredsize-reconciled-write-path.md's
       // Implementation Notes.
       expect(declarations.minWidth).toBeNull();
       expect(declarations.minHeight).toBeNull();
       expect(declarations.maxWidth).toBeNull();
       expect(declarations.maxHeight).toBeNull();
       expect(declarations.fontSize).toBe('10px');
       expect(declarations.lineHeight).toBe('1');
       expect(declarations.textAlign).toBe('center');
       expect(_ruleCacheHas('.ScrollArrowGlyph')).toBe(true);
   });
   ```
   *Check:* `npx vitest run tests/component/container/ScrollbarArrow.test.ts` from `packages/lib` — this one case fails (source not yet changed; today it writes real `12px`/`12px`/`12px`/`12px` values, not nulls, and no `.ScrollArrowGlyph` rule exists).

2. **`packages/lib/src/typescript/lib/component/container/Scrollbar.ts` — add the class default and swap the constructor call.** Per `## Internal Structure`: widen the `Glyph` import to include `GlyphOptions`; add `_defaultScrollArrowGlyphOptions` and `class ScrollArrowGlyph extends Glyph` immediately before `class ScrollArrowButton`; change [Scrollbar.ts:206](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L206) from `new Glyph(...)` to `new ScrollArrowGlyph(direction)`. Leave every other line of the file untouched — no changes to `ScrollArrowButton`'s chrome (`_defaultScrollArrowButtonOptions`), its disabled-state handling, or `Scrollbar` itself.
   *Check:* `grep -n "class ScrollArrowGlyph" packages/lib/src/typescript/lib/component/container/Scrollbar.ts` — 1 match (the class declaration); `grep -c "new ScrollArrowGlyph("  packages/lib/src/typescript/lib/component/container/Scrollbar.ts` — 1 match (the one construction call site, replacing the old `new Glyph(...)`).

3. **Run the updated test.** `npx vitest run tests/component/container/ScrollbarArrow.test.ts` from `packages/lib` — green.

4. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib` — all green. No other test file references `ScrollArrowButton`'s glyph field or size.

5. **Amend the changelog.** See `## Documentation Impact`.

6. **Full verification.** See `## Verification`.

7. **Verify live in a browser, and record the Style Audit before/after.** Non-negotiable — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `packages/lib/tests/component/container/ScrollbarArrow.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Row 1 is unit-testable against the recording DOM sink (the case step 1 adds). Row 2 needs a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | A `Scrollbar` with `arrowsEnabled: true` renders | Each arrow's glyph `#id` rule carries `minWidth`/`minHeight`/`maxWidth`/`maxHeight` as explicit `null` removals and real `fontSize: "10px"`/`lineHeight: "1"`/`textAlign: "center"`; `.ScrollArrowGlyph` materialises once, carrying the four size declarations |
| 2 | Manual — live app, `#/style-audit`, after opening several table/tree/scrolling demo windows (any window with a scrollable panel or table) | The `{min-width:12px;min-height:12px;max-width:12px;max-height:12px;line-height:1;text-align:center;font-size:10px}` duplicate-rule row's per-instance byte count drops (the four size declarations move to `.ScrollArrowGlyph`); the row does not disappear — `line-height`/`text-align`/`font-size` remain on every instance's own `#id` rule, per `## Architecture Decisions` |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariant:
```
grep -c "class ScrollArrowGlyph" packages/lib/src/typescript/lib/component/container/Scrollbar.ts   # 1
```

**Manual browser verification (row 2) is required.** The offline harness records writes; it does not run a CSS cascade or reflect the Style Audit panel's own dedup grouping.

- Start a dev server on a spare port from *this worktree* (symlink `node_modules` to the repo root first if this worktree doesn't already have one), and confirm what it serves with `readlink /proc/<pid>/cwd` before trusting anything the browser shows.
- Reproduce this plan's own before-measurement first, against the unmodified code: navigate to `#/misc`, open several windows containing scrollable content (e.g. "Show window with table (slow)!", "Show window with wide table…", "Show window with tree table!"), then the "Style Audit" tab, then "Refresh". This plan's own investigation run (before the fix, with 7-8 demo windows open) found 16 live `#id` rules matching `{min-width:12px;min-height:12px;max-width:12px;max-height:12px;line-height:1;text-align:center;font-size:10px}`, confirmed via `getElementById` + DOM ancestry to all be `ScrollArrowButton`'s glyph inside a `Scrollbar` (`▲▼◀▶` text content) — this count grows with more windows open (a heavier session, per the originating report, found 44).
- Apply the fix, restart the dev server, repeat the identical navigation, and re-check the panel. Confirm: the same duplicate-rule row is still present (font-size/line-height/text-align keep it alive) but its declared body is now only `{line-height:1;text-align:center;font-size:10px}` — four fewer declarations per instance — and a new `.ScrollArrowGlyph` class-tier row's computed styles carry the `12px` min/max values.
- Read **computed styles** on a rendered scrollbar arrow, confirming the glyph still renders at 12×12 with the 10px font, unchanged visually from before the fix.

---

## Documentation Impact

No exported symbol changes: `ScrollArrowGlyph` is module-private (file-local to `Scrollbar.ts`, not exported from the container barrel), matching `CheckboxCheckGlyph`/`RadioButtonDot`. `Scrollbar`'s and `ScrollbarOptions`'s public surface is unchanged.

One amendment to `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Components`, appended as a new bullet at the end of that section's existing list (just before `### Table`), so it inserts cleanly alongside two other in-flight, independent plans against the same base branch — [`number-renderer-align-stylegroup.md`](plans/number-renderer-align-stylegroup.md) and [`label-text-class-defaults-followups.md`](plans/label-text-class-defaults-followups.md) — which also each add one bullet to this file. Do not edit any existing bullet in this section; append only:

> **`ScrollArrowButton`'s arrow glyph no longer duplicates its fixed size on every instance's own CSS rule.** Each `Scrollbar` arrow's Unicode-triangle glyph now shares one `.ScrollArrowGlyph` CSS rule for its 12×12 min/max size across every arrow in the app; its font-size, line-height, and text-align stay per-instance (unaffected by this change — they never participated in the framework's CSS dedup mechanism). Nothing changes visually; no consumer action needed.

---

## Potential Challenges

- **The fix looks incomplete next to `CheckboxCheckGlyph`'s full `{}` result.** `## Architecture Decisions` and the changelog bullet both say plainly that `font-size`/`line-height`/`text-align` remain real declarations — a reviewer comparing Style Audit before/after screenshots should expect a smaller, not absent, duplicate row.
- **The 14×14 group looks superficially similar and might tempt a "just add it too" scope creep during implementation.** It is a coincidental convergence of three unrelated, theme-derived mechanisms (see `## Architecture Decisions`), not a registration gap — `/implement` should not attempt it; see `## Non-Goals`.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` | `TRACK_WIDTH`/`ARROW_GLYPH_FONT_SIZE` (38, 50), `ScrollArrowButton`'s constructor (182-230) — the actual source of the 12×12+10px value; `_defaultScrollArrowButtonOptions` (119-122) — the class's own existing class-default pattern this plan's new bag sits beside |
| `packages/lib/src/typescript/lib/component/display/Glyph.ts` | `setFontSize`/`setLineHeight`/`setTextAlign` (356, 401, 432) — confirms these three write through the raw, non-reconciled path; the char-mode constructor guard (277-284) — confirms `lineHeight`/`textAlign` are always real for a char-mode glyph regardless of any class default |
| `packages/lib/src/typescript/lib/component/display/Glyphs.ts` | The glyph registry (43-46) — confirms `unicode-arrow-up/down/left/right` are the only four `kind:"char"` entries, and (by the codebase-wide grep in `## Architecture Decisions`) `ScrollArrowButton` is their only constructor |
| `packages/lib/src/typescript/lib/core/Component.ts` | `matchesClassStyle` (4840), `reconcileRuleDeclaration`/`setReconciledCSSRules` (4945, 4961), and `applySizeConstraintStyles` (5133-5150) — the already-reconciled write path this plan's registration now reaches; confirms the complete list of keys that ever participate (fontSize/lineHeight/textAlign are not among them) |
| `packages/lib/src/typescript/lib/component/input/Checkbox.ts` | `CheckboxCheckGlyph` (139-164) — the precedent this plan's `ScrollArrowGlyph` mirrors exactly |
| `plans/implemented/glyph-preferredsize-reconciled-write-path.md` | The shipped plan this one follows up on: its fix shape, its `## Non-Goals` (which first flagged both duplicate groups this plan investigates), and its Implementation Notes (the char-mode "nulls ride along, not absent" finding this plan's own test predicts from the start) |
| `plans/implemented/shared-instance-style-groups.md` | The `styleGroup` mechanism recommended (not implemented) in `## Non-Goals` for the 14×14 group — read to understand why it fits that case (many instances of the same concrete class, `Glyph`, converging on a caller-resolved rather than class-constant value) better than a class default would |
| `packages/lib/tests/component/container/ScrollbarArrow.test.ts` | `'ScrollArrowButton static style hoisting'` (157-214) — the existing describe block this plan's new case joins, including its `idSelector`/`declarationsDuring` helpers and `'row 1'`'s own precedent for what a matching-but-still-forced-to-materialise rule looks like |

---

## Non-Goals

- **The bare-`Glyph` 14×14 duplicate-rule group.** Traced live to three unrelated, theme/font-metric-derived mechanisms — `Button._syncGlyphSize` (24 of 30 instances observed), `ComboBoxCaret` (2 of 30), `WindowHeader`'s title glyph (3 of 30) — that only coincide on `14` because every shipped theme's base font size is `14` today. None is a per-class literal; a class default would silently go stale the instant a consumer's theme, or a `Button`'s own `fontSize`, differs. `Component`'s `styleGroup` option (`plans/implemented/shared-instance-style-groups.md`) is the better-fitting mechanism — it dedupes many instances of the same concrete class (`Glyph`, here) sharing a caller-resolved, non-constant value — but wiring it through three unrelated owning classes, choosing a stable group-key scheme, and confirming its behaviour across a live theme change is a distinct, larger cross-cutting change, out of scope here.
- **Closing the residual `font-size`/`line-height`/`text-align` portion of the 12×12 duplicate.** Would require widening `Glyph`'s write path for those three properties onto `setReconciledCSSRules`, which the shipped sibling plan already confirmed unnecessary for its three cases and did not do; this plan does not reopen `Glyph.ts`'s write-path methods either.
- **`Component.ts`/`Glyph.ts` write-path changes of any kind.** `setMinSize`/`setMaxSize`/`applySizeConstraintStyles`/`reconcileRuleDeclaration` are read, not modified.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^live-probe]: Verified via a `chrome-devtools`-driven dev server (this worktree's base commit, `6578d5e9`, already running on `localhost:8015` from a sibling worktree — confirmed identical via `git rev-parse HEAD` in both). Opened `#/misc`, clicked eight "Show window…" triggers (image, table (slow), wide table, grouped wide table, paginated table, table (column spec), tree table, title-glyph), then queried `document.styleSheets` directly for every rule whose `style.minWidth/minHeight/maxWidth/maxHeight` were exactly `12px` and `style.fontSize` was `10px`: 16 matches. For each, `document.getElementById(id)` resolved to a `<span class="ts-ui-component Glyph">` with `data-minsize="12px 12px"`, parent `class="ts-ui-component ScrollArrowButton"` (or `"... disabled"`), grandparent `class="ts-ui-component Scrollbar"`, and `textContent` one of `▲▼◀▶`. The same session's 14×14 query (below) returned 30 matches spanning three different owning classes, confirming that group's non-uniformity by contrast.

[^null-not-skip]: Per `reconcileRuleDeclaration`'s own doc comment, a match "queues a removal rather than skipping" — but a queued removal only ever reaches the sink if the rule materialises at all, and `ARCHITECTURE.md`'s *Defer DOM work to render time* section states the flush "inserts the rule only when a real declaration is queued — not for a bag holding only no-op null removals." That is why `ScrollArrowButton`'s *own* `#id` rule (row 1, unaffected by this plan) never appears in `declarationsDuring`'s capture at all: every one of its chrome properties matches its class default, so its whole dirty bag is null removals and the rule never materialises. The glyph is different: `fontSize`/`lineHeight`/`textAlign` are always genuinely real, non-reconciled writes (never null, per this plan's own fix), so they alone satisfy the "at least one real declaration" gate and force the glyph's `#id` rule to materialise — and once it materialises, the *same* flush carries every other queued key in its dirty bag, including the four size keys' explicit `null` removals. This is the exact mechanism the shipped sibling plan's own Implementation Notes documents correcting its `Glyph.test.ts` prediction against (a bare `unicode-arrow-up` `Glyph`, also char-mode, also produces four `null` entries, not zero, for the identical reason), which is why this plan's step 1 test asserts `null`, not `undefined`, from the start rather than repeating that correction cycle.
