---
touches-shared: [packages/lib/src/typescript/lib/component/button/Button.ts]
---

# Button Chromeless Follow-Up Dedup — Implementation Plan

## Overview

[`plans/implemented/button-variant-chrome-dedup.md`](implemented/button-variant-chrome-dedup.md) fixed window-control buttons, `MenuBarButton`, and `TabCloseButton` by replacing `chromeless: true` with a real, declared-chrome `Button` subclass (`ownClassStyleDefaults` + `ownStyleStates`). Two more live `chromeless: true` call sites still duplicate rules in the Style Audit panel: [`PickerButton`](packages/lib/src/typescript/lib/component/input/PickerButton.ts) (the calendar/clock trigger button on every `AbstractPickerField`) and the inline title `Button` built by [`AccordionHeader`](packages/lib/src/typescript/lib/component/container/AccordionHeader.ts#L100).

Both get the same fix shape: drop `chromeless: true`, declare real resting chrome, and pin the `.pressed` state to that same resting chrome. This plan also confirms — and rejects — an alternative fix hypothesis (an "empty" `ownStyleStates` extract while staying chromeless), and records why `MenuBarButton` is still affected by one of the two mechanisms this plan fixes, deferring that fix to a separate plan.

---

## Architecture Decisions

### `PickerButton` drops `chromeless: true` and declares real resting + pressed chrome

[`PickerButton`](packages/lib/src/typescript/lib/component/input/PickerButton.ts#L20) gains its own `ownClassStyleDefaults` (transparent background, no border, no shadow) and an `ownStyleStates` entry pinning `.pressed` to those same values, mirroring `WindowControlButton`'s shape exactly.[^picker-mirrors-windowcontrol] `chromeless: true` is removed from its constructor call. This is the only way to fix the **resting-chrome duplicate**: `chromeless`'s `suppressIsolation(true)` (`Button.ts`'s `applyChromeOptions`, [Button.ts:988](packages/lib/src/typescript/lib/component/button/Button.ts#L988)) routes every resting write to the bare `#id` rule, which always outranks a `.PickerButton` class rule regardless of content — the same reasoning `button-variant-chrome-dedup.md` already established for window-control buttons.

Dropping `chromeless` also, as a side effect, fixes the **`.pressed`-pin duplicate** (`pinPressedToResting()`, [Button.ts:2027](packages/lib/src/typescript/lib/component/button/Button.ts#L2027)): that method is called only from inside the `chromeless` branch of `applyChromeOptions` ([Button.ts:1045](packages/lib/src/typescript/lib/component/button/Button.ts#L1045)), so once `PickerButton` no longer passes `chromeless: true`, it is never invoked for a `PickerButton` instance again. No separate mechanism is needed to address it.[^empty-extract-investigated]

`PickerButton`'s `.pressed` chrome must be pinned to its resting values (not left to Button's generic raised look), because `pinPressedToResting()` currently does exactly that — pins every declaration the shared `.pressed` bag carries to the instance's *current resting* values ([Button.ts:2036-2039](packages/lib/src/typescript/lib/component/button/Button.ts#L2036)) — so `PickerButton` shows no visual change on press today. `PickerButton` never calls `setPressedX`/`setHoverX`/`setForegroundColor` anywhere in `AbstractPickerField.ts`, confirming it has no per-instance customization to preserve beyond this.

`:hover` needs no override. `pinPressedToResting()` only ever pins `.pressed` — chromeless has no matching hover pin — so a chromeless `PickerButton`'s hover state already falls through, unguarded, to the shared `.Button:hover:not(.pressed)` class rule (published unconditionally at the base `Button` level; see `## Architecture Decisions` in `button-variant-chrome-dedup.md` for why every Button-family element carries the `"Button"` DOM class regardless of chromeless). That is true both before and after this change, so `PickerButton`'s own `ownStyleStates` restates `Button.ownStyleStates[1]` (the `:hover` entry) unchanged, matching `MenuBarButton`'s established "restate `.pressed` unchanged" pattern but for the opposite selector.

### `AccordionHeader`'s inline title button gets the same treatment, hoisted into a new subclass

The title button is built inline, once per section, with no per-instance style customization anywhere in `AccordionHeader.ts` or `Accordion.ts` — `_title` is only ever touched via `setCompact`, `getAria().setExpanded`, and `getTitleButton()`. This is the exact shape `PickerButton` has (bare `chromeless: true`, no customization), so it needs the exact same fix. Because it is built inline rather than being its own named class, it needs a new module-private subclass first — `AccordionHeaderTitleButton`, declared in `AccordionHeader.ts` — matching how `windowControls.ts` introduced `WindowControlButton` for an inline factory call.

`Accordion.applySectionTheming()` calls `header.setForegroundColor(...)`/`header.clearForegroundColor()` on the *header component*, not on `_title` directly ([Accordion.ts:691](packages/lib/src/typescript/lib/layout/Accordion.ts#L691)). The title button's own text colour is unaffected by this either way, both before and after this plan: it is not set via that call, and this plan does not touch it. `## Verification`'s manual pass includes a themed/un-themed accordion check to confirm nothing about that call's actual visual effect regresses.

### `MenuBarButton` is still affected by `pinPressedToResting`, but is not fixed here

`MenuBarButton` stays `chromeless: true` — `button-variant-chrome-dedup.md` deliberately kept it that way and fixed only its `:hover` duplicate (a *different*, `styleRules`-based bypass). Its `ownStyleStates[0]` restates `Button.ownStyleStates[0]` (`.pressed`) unchanged ([MenuBarButton.ts:87](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts#L87)) — restating unchanged means no genuine deviation, so `classStateLayer(".pressed")` still resolves to a non-empty, 4-key bag. `pinPressedToResting()` is still called unconditionally from `chromeless`'s branch, still finds that non-empty bag, and still pins all four properties to the instance's current resting values on every `MenuBarButton` construction — an unconditional, real per-instance write, every time.[^menubarbutton-verified] This duplicate is real and unfixed.

It is not fixed in this plan. Fixing it the same way (drop `chromeless`) requires `MenuBarButton` to additionally declare `border`/`borderRadius`/`shadow`/`backgroundImage` resting overrides it does not have today — its `_defaultMenuBarButtonOptions` only carries `backgroundColor`/`foregroundColor`/`cursor`/`insets` — since those four fields are otherwise dispatched from Button's own raised-button defaults once `chromeless` no longer suppresses `super.applyChromeOptions`. That is a materially larger, cross-theme-risk change than `PickerButton`'s (which never had to add those fields, because `chromeless`'s existing clears already computed the same "none/transparent" values this plan gives it explicitly). It is also not one of the two call sites this plan's originating Style Audit capture evidenced as a live duplicate — unlike `PickerButton` and `AccordionHeader`. `button-variant-chrome-dedup.md` already flagged and deferred this exact case (its `[^pin-out-of-scope]` footnote lists "`MenuBarButton`'s own `.pressed` state" by name). This plan reconfirms the finding and leaves the deferral in place — see `## Non-Goals`.

### `Button.ts`'s `chromeless` doc comment loses its stale `PickerButton` reference

[`ButtonOptions.chromeless`](packages/lib/src/typescript/lib/component/button/Button.ts#L122)'s doc comment reads "Used by [`PickerButton`]... and [`MenuBarButton`]..." across [Button.ts:122-123](packages/lib/src/typescript/lib/component/button/Button.ts#L122). Once `PickerButton` no longer sets it, this must become "Used by [`MenuBarButton`]...". This is a one-line documentation edit, not a functional change, and is the only touch this plan makes to `Button.ts`.

### `touches-shared`: no functional overlap with `button-flat-chrome-dedup`

The sibling `button-flat-chrome-dedup` plan (drafted concurrently, in its own worktree — no draft file existed yet to read at investigation time) touches `Button.ts`'s flat-appearance path (`setFlat`/`clearFlat`/`_applyFlatChrome`, `Button.ts:2058-2200`) and `clearBackgroundImage`. This plan's only `Button.ts` edit is the one-line doc-comment change above (`Button.ts:122-123`), nowhere near that region, and this plan makes no edit to the chromeless branch of `applyChromeOptions` (976-1050) or to `pinPressedToResting` (2027-2042) themselves — it only stops *calling into* the chromeless branch for two call sites, from two other files. `flat` and `chromeless` are already mutually exclusive by Button's own contract (`setFlat` no-ops with a warning when chromeless), so the two plans' subject matter doesn't overlap either. `Button.ts` is listed in this plan's frontmatter only because both plans touch the file at all — a same-file, different-region edit, low conflict risk, not a same-code conflict.

---

## Public API

`PickerButton`'s constructor gains an additive, optional third parameter, per `ARCHITECTURE.md`'s *Constructors forward `subclassDefaults`* (required so a future subclass can seed its own defaults, and mechanically enforced by the `local/require-subclass-defaults` ESLint rule for any class declaring `ownClassStyleDefaults`):

```typescript
class PickerButton extends Button {
    constructor(subclassDefaults?: Partial<ButtonOptions>);
}
```

No other exported signature changes. `AccordionHeaderTitleButton` is module-private (not exported); `AccordionHeader`'s own public API (`getTitleButton(): Button`, `AccordionHeaderOptions`) is unchanged — `AccordionHeaderTitleButton extends Button`, so the existing `Button` return type still holds.

---

## Internal Structure

### `component/input/PickerButton.ts` — full rewrite

```typescript
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button, ButtonOptions } from "~/component/button/Button.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";

/**
 * Resting + pressed defaults for {@link PickerButton} — transparent
 * background, no border, no shadow, matching what `chromeless: true` used to
 * compute imperatively (`Button.applyChromeOptions`'s chromeless branch).
 * `pressedForegroundColor` restates the same literal token Button's own
 * resting default uses (`_defaultButtonOptions.foregroundColor` in
 * Button.ts — module-private, not importable, so restated here); the other
 * three `pressedX` fields match the resting tier. `PickerButton` has no
 * visual press distinction, so its `.pressed` state must be pinned to the
 * *same* values as resting, not left to Button's generic raised look — see
 * plans/button-chromeless-followup-dedup.md's Architecture Decisions.
 */
const _defaultPickerButtonOptions: Partial<ButtonOptions> = {
    backgroundColor:        "transparent",
    backgroundImage:        "none",
    border:                 "none",
    borderRadius:           undefined,
    shadow:                 "none",
    pressedForegroundColor: "var(--ts-ui-text-color, black)",
    pressedBackgroundColor: "transparent",
    pressedBackgroundImage: "none",
    pressedShadow:          "none",
};

/**
 * Internal `<button>` Component used by every {@link AbstractPickerField}
 * concrete subclass (DateField / TimeField / DateTimeField) as the
 * glyph-bearing trigger to the right of the input.
 *
 * Declares its own resting chrome (transparent, no border/shadow) instead of
 * `chromeless: true` — see plans/button-chromeless-followup-dedup.md's
 * Architecture Decisions for why `chromeless` could never dedupe (its bare
 * `#id` resting write, and `pinPressedToResting`'s unconditional per-instance
 * `.pressed` pin). The `.pressed` state is pinned to the same resting values
 * via `ownStyleStates`, so pressing shows no visual change — identical to
 * its previous chromeless behaviour. `:hover` is unaffected and untouched
 * (see that plan section for why). The per-field glyph (calendar / clock /
 * calendar) is set after construction via `setGlyph` — Button's content-row
 * Fit layout centres it within the inner rect automatically.
 *
 * @category Components
 */
class PickerButton extends Button {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultPickerButtonOptions;

    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => ({
                foregroundColor: _defaultPickerButtonOptions.pressedForegroundColor,
                backgroundColor: _defaultPickerButtonOptions.pressedBackgroundColor,
                backgroundImage: _defaultPickerButtonOptions.pressedBackgroundImage,
                shadow:          _defaultPickerButtonOptions.pressedShadow,
            }),
        },
        Button.ownStyleStates[1],   // :hover, restated unchanged — see Architecture Decisions
    ];

    constructor(subclassDefaults?: Partial<ButtonOptions>) {
        super(
            undefined,
            { insets: new Insets(0, 4, 0, 4) },
            { ..._defaultPickerButtonOptions, ...(subclassDefaults ?? {}) },
        );
    }
}

const PickerButtonCallable = callable(PickerButton);
type PickerButtonCallable = PickerButton;
export {
    PickerButton         as _PickerButton,
    PickerButtonCallable as PickerButton,
};
```

`borderRadius: undefined` is an explicit key, not an omission — the same idiom `WindowControlButton` uses (`windowControls.ts`'s `_defaultWindowControlOptions` comment, per `button-variant-chrome-dedup.md`'s Internal Structure) so it wins over Button's own non-empty `borderRadius` default in the `subclassDefaults` spread merge. Do not omit the key.

### `component/container/AccordionHeader.ts`

Add near the top, after the existing constants (after line 41), and widen the `ClassStyleRules.js` type import:

```typescript
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";

/**
 * Resting + pressed defaults for {@link AccordionHeaderTitleButton} —
 * transparent background, no border, no shadow, matching what
 * `chromeless: true` used to compute imperatively. Same shape as
 * `PickerButton`'s own defaults (`component/input/PickerButton.ts`) — see
 * plans/button-chromeless-followup-dedup.md's Architecture Decisions.
 */
const _defaultAccordionHeaderTitleButtonOptions: Partial<ButtonOptions> = {
    backgroundColor:        "transparent",
    backgroundImage:        "none",
    border:                 "none",
    borderRadius:           undefined,
    shadow:                 "none",
    pressedForegroundColor: "var(--ts-ui-text-color, black)",
    pressedBackgroundColor: "transparent",
    pressedBackgroundImage: "none",
    pressedShadow:          "none",
};

/**
 * The section-label title button built inline by every {@link AccordionHeader}
 * — the clickable toggle target and focusable element. Declares its own
 * resting chrome instead of `chromeless: true`, for the same reason and in
 * the same shape as `PickerButton` (see
 * plans/button-chromeless-followup-dedup.md). Module-private: built only by
 * `AccordionHeader`'s own constructor.
 */
class AccordionHeaderTitleButton extends Button {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultAccordionHeaderTitleButtonOptions;

    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => ({
                foregroundColor: _defaultAccordionHeaderTitleButtonOptions.pressedForegroundColor,
                backgroundColor: _defaultAccordionHeaderTitleButtonOptions.pressedBackgroundColor,
                backgroundImage: _defaultAccordionHeaderTitleButtonOptions.pressedBackgroundImage,
                shadow:          _defaultAccordionHeaderTitleButtonOptions.pressedShadow,
            }),
        },
        Button.ownStyleStates[1],   // :hover, restated unchanged
    ];

    constructor(label: string, glyph?: string, subclassDefaults?: Partial<ButtonOptions>) {
        super(
            label,
            { anchor: AnchorType.WEST, glyph },
            { ..._defaultAccordionHeaderTitleButtonOptions, ...(subclassDefaults ?? {}) },
        );
    }
}
```

`Button` must also be imported as a *type* target for `ButtonOptions` — widen the existing `import { Button } from "~/component/button/Button.js";` to `import { Button, ButtonOptions } from "~/component/button/Button.js";`.

Change the constructor's title-button line (currently line 100):

```typescript
this._title     = new AccordionHeaderTitleButton(label, options?.glyph);
```

Update the class doc comment's list item 2 (currently "a `chromeless` title {@link Button} (the section label, …)", around line 69): replace "a `chromeless` title" with "the title" — it is no longer chromeless, though its rendered appearance is unchanged, and the parenthetical already says "the section label".

---

## Ordered Implementation Steps

1. **`component/input/PickerButton.ts`** — full rewrite per `## Internal Structure`.
   *Check:* `npm run typecheck`. `grep -n 'chromeless' packages/lib/src/typescript/lib/component/input/PickerButton.ts` — zero matches.
2. **`component/container/AccordionHeader.ts`** — add `_defaultAccordionHeaderTitleButtonOptions` + `AccordionHeaderTitleButton`, widen the `Button.js` and `ClassStyleRules.js` imports, change the `_title` construction line, update the class doc comment's list item.
   *Check:* `npm run typecheck`. `grep -n 'chromeless' packages/lib/src/typescript/lib/component/container/AccordionHeader.ts` — zero matches.
3. **`component/button/Button.ts`** — change the `chromeless` option's doc comment ([Button.ts:122-123](packages/lib/src/typescript/lib/component/button/Button.ts#L122)) from "Used by [`PickerButton`]... and [`MenuBarButton`]..." to "Used by [`MenuBarButton`]...".
   *Check:* `npm run typecheck`.
4. **New test file `packages/lib/tests/component/input/PickerButton.classStyleHoisting.test.ts`.** Cover `## Expected Behaviour` rows 1-3, using the `declarationsDuring`/`idSelector`-style helpers from `tests/core/ClassHierarchyCascade.test.ts` (recreate locally — they are module-private there) — two `new PickerButton()` instances (second primed against the first), asserting the second's `#id`/`#id.pressed` rules carry no real declarations and `.PickerButton`/`.PickerButton.pressed` exist in the rule cache with the right bodies.
   *Check:* `npx vitest run tests/component/input/PickerButton.classStyleHoisting.test.ts` from `packages/lib`.
5. **New test file `packages/lib/tests/component/container/AccordionHeader.classStyleHoisting.test.ts`.** Two `new AccordionHeader("Section")` instances, reaching the title button via `getTitleButton()`; assert the second's `#id`/`#id.pressed` rules carry no real declarations and `.AccordionHeaderTitleButton`/`.AccordionHeaderTitleButton.pressed` exist in the rule cache.
   *Check:* `npx vitest run tests/component/container/AccordionHeader.classStyleHoisting.test.ts` from `packages/lib`.
6. **Add rows to the default-resolution registry** in [`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts), per `ARCHITECTURE.md`'s *Class-level defaults must survive the getter* — mirror `TabCloseButton`'s existing rows' shape (`const b = new X(); b.getElement(true); return b.getY();`): `PickerButton getBackgroundColor()` → `"transparent"`, `PickerButton getShadow()` → `"none"`.
   *Check:* `npx vitest run tests/component/default-options-fallback.test.ts` — green.
7. **Full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`. `npm run lint` and `npm -w packages/lib run test:lint` — the `local/no-raw-dom` baseline stays empty.
8. **Add the changelog entry.** See `## Documentation Impact`.
9. **Manual verification.** See `## Verification` — non-negotiable given the cross-theme risk and the residual `AccordionHeader` theming question flagged in `## Architecture Decisions`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/PickerButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/AccordionHeader.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Create | `packages/lib/tests/component/input/PickerButton.classStyleHoisting.test.ts` |
| Create | `packages/lib/tests/component/container/AccordionHeader.classStyleHoisting.test.ts` |

---

## Expected Behaviour

Rows 1-2 are unit-testable offline (recording DOM sink, no real cascade). Rows 3-6 need a live browser — see `## Potential Challenges`.

**`PickerButton`**

1. A second `new PickerButton()`, constructed after a first has primed the shared rules, writes no `backgroundColor`/`backgroundImage`/border-longhands/`boxShadow` to its own `#id` rule. `.PickerButton` exists in the rule cache carrying `background-color: transparent`, `background-image: none`, `border-top`/`border-right`/`border-bottom`/`border-left: none`, `box-shadow: none`.
2. The second instance writes no real declaration to `#id.pressed`. `.PickerButton.pressed` carries `color: var(--ts-ui-text-color, black)`, `background-color: transparent`, `background-image: none`, `box-shadow: none`.
3. `:hover` is unaffected: a `PickerButton`'s hover background still comes from the shared `.Button:hover:not(.pressed)` rule (unchanged before/after this plan) — no `.PickerButton:hover` rule exists.

**`AccordionHeader`'s title button**

4. A second `AccordionHeader`'s title button, reached via `getTitleButton()`, writes no real declaration to its own `#id`/`#id.pressed` rules; `.AccordionHeaderTitleButton` and `.AccordionHeaderTitleButton.pressed` carry the same shape as rows 1-2.

**Manual verification** (`npm run dev`, http://localhost:8015, Style Audit panel; switch themes via the theme picker)

5. In each of the three themes, a `DateField`/`TimeField`/`DateTimeField`'s trigger button renders identically to before this plan: invisible chrome at rest, the standard light hover tint, and no visible change while pressed.
6. In each of the three themes, and in both `Accordion`'s themed and un-themed states (`setThemed(true/false)` if exposed, or whichever section/demo panel exercises both), an accordion section's title button renders identically to before this plan — no border/shadow/background ever, text colour unaffected by the header's own `setForegroundColor`/`clearForegroundColor` calls (confirms the Architecture Decisions' "orthogonal" claim about `Accordion.applySectionTheming`).
7. Open the Style Audit panel after visiting picker fields and accordion sections, and confirm the duplicate-rule rows this plan targets no longer appear.

---

## Verification

Run from the repo root unless noted.

- `npm run typecheck` — after every step.
- `npm test` from `packages/lib` (`typecheck:test` + `vitest run`) — full suite green.
- `npm run lint` and `npm -w packages/lib run test:lint` — `local/no-raw-dom` baseline stays empty.
- `npm run docs:api` — zero warnings (no exported API shape changes beyond `PickerButton`'s additive optional constructor parameter).
- Grep invariants: `grep -n 'chromeless' packages/lib/src/typescript/lib/component/input/PickerButton.ts packages/lib/src/typescript/lib/component/container/AccordionHeader.ts` — zero matches.
- **Manual browser verification is required, in all three themes** (`## Expected Behaviour` rows 5-7). Start a dev server on a spare port from *this worktree*, confirming with `readlink /proc/<pid>/cwd` that it resolves there.

---

## Documentation Impact

`PickerButton`'s constructor gains an additive, optional third parameter (`subclassDefaults`) — its typedoc-generated API page (`/api/component/input/classes/PickerButton`) regenerates automatically from the updated JSDoc comment via `npm run docs:api`; no manual doc page edit is needed. The components table entry in [`docs/components/index.md:54`](packages/lib/docs/components/index.md#L54) ("Internal glyph button used to the right of a picker field's input") stays accurate — its rendered behaviour is unchanged. `AccordionHeaderTitleButton` is module-private; nothing to document.

- `packages/lib/docs/reference/changelog/next.md`, `## Fixed` → `### Components` (append after the existing `button-variant-chrome-dedup` entry, [next.md:91-94](packages/lib/docs/reference/changelog/next.md#L91)): **`PickerButton` and `AccordionHeader`'s section title button now dedupe their resting and pressed chrome onto shared class rules instead of repeating on every instance.** No consumer action is needed; nothing renders differently.

---

## Potential Challenges

- **`AccordionHeader`'s theming interaction is not fully re-derived, only checked for regression.** `Accordion.applySectionTheming()` calls `setForegroundColor`/`clearForegroundColor` on the header component, not the title button, and this plan's own investigation concluded the title's text colour is governed independently by the shared `.Button`/`.AccordionHeaderTitleButton` class rule either way. `## Expected Behaviour` row 6 is the safety net if that conclusion is wrong.
- **`borderRadius: undefined` must be an explicit key in both new defaults bags**, not an omission — omitting it silently falls back to Button's own non-empty default in the `subclassDefaults` spread merge. `## Internal Structure` flags this at both call sites.
- **Landing the two files independently is safe** — `PickerButton.ts` and `AccordionHeader.ts` share no code path, only the same fix shape. Either can land first.

---

## Critical Files

| File | Why |
|---|---|
| [component/input/PickerButton.ts](packages/lib/src/typescript/lib/component/input/PickerButton.ts) | The whole `PickerButton` fix lands here |
| [component/container/AccordionHeader.ts](packages/lib/src/typescript/lib/component/container/AccordionHeader.ts) | `AccordionHeaderTitleButton` and the `_title` construction site (currently line 100) |
| [component/button/Button.ts](packages/lib/src/typescript/lib/component/button/Button.ts) | `applyChromeOptions` (976-1090, chromeless branch 978-1047) and `pinPressedToResting` (2027-2042) — read in full before touching anything chromeless-adjacent; `ownStyleStates` (347-380) is what both new subclasses restate for `:hover`; the `chromeless` doc comment (122-123) is this plan's one edit here |
| [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) | `classStateLayer` (4932), `writeStateStyle` (5157) vs. `pinStateStyle` (5189) — the comparison-bypass distinction this plan's whole investigation turns on |
| [core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) | `resolveStateLevels` (681-744, the per-level merge-over-parent that makes an "empty extract" not erase inherited content — see `[^empty-extract-investigated]`), `resolveStyleStates` (781-807), `resolveClassLevel` (522-572, the resting-tier twin) |
| [plans/implemented/button-variant-chrome-dedup.md](implemented/button-variant-chrome-dedup.md) | The direct precedent this plan mirrors in full — read before drafting or implementing anything here |
| [layout/Accordion.ts](packages/lib/src/typescript/lib/layout/Accordion.ts) | `applySectionTheming` (673-694) and `createSection` (1348+) — confirms the title button has no per-instance style customization and how `getTitleButton()` is used |
| [ARCHITECTURE.md](ARCHITECTURE.md) | *Component CSS tiers and state-rule dedup*, *The class tier is hierarchy-aware*, *Constructors forward `subclassDefaults`*, *Class-level defaults must survive the getter* |

---

## Non-Goals

- **`MenuBarButton`'s own `.pressed`-pin duplicate.** Confirmed still present (see `## Architecture Decisions`), but requires a materially larger change (adding `border`/`borderRadius`/`shadow`/`backgroundImage` resting overrides it doesn't have today) than either target in this plan, isn't independently audit-evidenced the way `PickerButton`/`AccordionHeader` are, and was already deliberately deferred by `button-variant-chrome-dedup.md`'s `[^pin-out-of-scope]` footnote. Left for a future plan.
- **Changing `pinStateStyle`/`pinPressedToResting` themselves.** Both are cross-cutting, heavily-documented mechanisms every chromeless Button-family instance depends on. This plan only stops two call sites from reaching the chromeless branch at all; it does not touch either method's body.
- **`RailHandle`'s chromeless resting chrome**, also named in `button-variant-chrome-dedup.md`'s own Non-Goals as unaudited. Out of scope here too — this plan's brief named only `PickerButton` and `AccordionHeader`.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^picker-mirrors-windowcontrol]: `WindowControlButton` (`overlay/windowControls.ts`, per `button-variant-chrome-dedup.md`'s Internal Structure) is the nearest precedent: a `Button` subclass declaring `ownClassStyleDefaults` for its resting chrome and an `ownStyleStates` `.pressed`/`:hover` entry pinning every key Button's generic entry would otherwise supply. `PickerButton` differs only in not needing a `:hover` entry (see the body) and in every pinned value being "no visible chrome" rather than a themed fill, since `PickerButton` (unlike window controls) never had visible chrome to begin with.

[^empty-extract-investigated]: The task that produced this plan asked whether giving `PickerButton` an `ownStyleStates` entry with an *empty* `.pressed` extract (`() => ({})`), while *keeping* `chromeless: true`, would make `pinPressedToResting()`'s computed patch resolve to `{}` and eliminate the write. Traced against `resolveStateLevels` (`ClassStyleRules.ts:681-744`), this does not hold as stated: a level's own contribution is `{...parentLayer.authored, ...spec.extract(...)}` (`ClassStyleRules.ts:729`) — a spread *merge over* the parent's content, not a replacement. An empty extract for a selector that is still present in the subclass's own declared `ownStyleStates` list contributes nothing new, but does not erase the inherited keys already present from `Button`'s own `.pressed` extract (which unconditionally returns all four keys — the `if (d.chromeless) return {}` guard inside it reads `_defaultButtonOptions`, Button's own base module constant, which is never itself chromeless, so that guard never fires for a subclass). `classStateLayer(".pressed")` would still return a 4-key bag, and `pinPressedToResting()` would still write for real. A stronger variant — omitting `.pressed` from the subclass's own `ownStyleStates` list entirely (so `resolveStyleStates` never finds a `.pressed` entry at all) — does make `classStateLayer(".pressed")` return `null`, which does make `pinPressedToResting()` return early with no write (`Button.ts:2030-2032`). This is real, but moot for `PickerButton`: dropping `chromeless` (required anyway to fix the resting-chrome duplicate) already makes `pinPressedToResting()` unreachable, since it is only ever called from inside the `chromeless` branch of `applyChromeOptions`. No `ownStyleStates`-omission trick is needed on top of that, and keeping `chromeless` while only adding the omission would leave the resting-chrome duplicate (the larger of the two problems) unfixed. This is why the plan's chosen fix (drop `chromeless`, pin `.pressed` via a real, non-empty `ownStyleStates` entry) differs from the hypothesis as originally framed.

[^menubarbutton-verified]: Verified directly against current source, not inferred from `button-variant-chrome-dedup.md`'s own footnote alone: `MenuBarButton.ts:86-92` declares `ownStyleStates = [Button.ownStyleStates[0], {selector: ":hover", ...}]` — the first entry is the *same function reference* as `Button.ownStyleStates[0]`, restated verbatim. Per `resolveStateLevels`'s delta check (`ClassStyleRules.ts:731-736`), a level whose resolved content is byte-identical to its parent's publishes no new rule — but the *layer itself* (`{authored, resolved}`) is still recorded and returned by `classStateLayer`, populated with Button's own four-key content. `pinPressedToResting()` (`Button.ts:2027-2042`) checks `"color" in bag` etc. against that layer, finds all four keys present, and writes a real per-instance pin from `MenuBarButton`'s own current resting getters every time — unconditionally, on every construction.
