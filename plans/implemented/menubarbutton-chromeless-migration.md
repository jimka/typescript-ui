---
touches-shared: [packages/lib/src/typescript/lib/component/button/Button.ts, packages/lib/tests/component/default-options-fallback.test.ts, packages/lib/docs/reference/changelog/next.md]
---

# MenuBarButton Chromeless Migration — Implementation Plan

## Overview

[`MenuBarButton`](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts#L34) still sets `chromeless: true` in its own defaults bag. `chromeless` makes a button write its resting chrome to the bare `#id` rule and pin its `.pressed` chrome per instance, so neither can ever dedupe onto a shared class rule. A live Style Audit scan attributes two duplicate-rule rows to this: roughly five copies of a per-`#id` resting-chrome reset (`border`/`box-shadow`/`background-image` all forced to their neutral values) and roughly six copies of a per-`#id.pressed` four-property pin.[^audit-rows]

This plan moves `MenuBarButton` off `chromeless` and onto real declared chrome — `ownClassStyleDefaults` for the resting tier, `ownStyleStates` for `.pressed` and `:hover` — the same migration `PickerButton`, `TabCloseButton`, and `AccordionHeaderTitleButton` already went through. The work is confined to [`component/menubar/MenuBarButton.ts`](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts), three existing test files that assert the chromeless behaviour, one doc-comment line in [`Button.ts`](packages/lib/src/typescript/lib/component/button/Button.ts#L123), and two documentation pages.

Nothing about a menu bar's appearance changes. Two consumer-visible behaviours do change: `new MenuBarButton(…).isChromeless()` now returns `false`, and `setFlat(true)` on a `MenuBarButton` now takes effect instead of being suppressed.

---

## Architecture Decisions

### `MenuBarButton` drops `chromeless: true` and declares its own resting chrome

`_defaultMenuBarButtonOptions` loses `chromeless: true` and gains the four resting chrome fields that `chromeless`'s branch used to compute imperatively: `backgroundImage: "none"`, `border: "none"`, `borderRadius: undefined`, `shadow: "none"`. This is the same fix shape [`PickerButton`](packages/lib/src/typescript/lib/component/input/PickerButton.ts#L22) uses, and the one both precedent plans established.[^why-drop-chromeless]

`borderRadius: undefined` is an explicit key, not an omission. `Component.applyChromeOptions` resolves `options.borderRadius ?? this._defaultOptions.borderRadius` and calls `setBorderRadius` only when the result is not `undefined` ([Component.ts:845-850](packages/lib/src/typescript/lib/core/Component.ts#L845)), so the explicit key suppresses `Button`'s own `var(--ts-ui-border-radius, 4px)` default and no radius is written at all. Omitting the key would let `Button`'s default through the spread merge and give every menu-bar button rounded corners it does not have today. `PickerButton` and `WindowControlButton` both carry the same explicit key for the same reason.

### `.pressed` is pinned to resting; `:hover` keeps its real highlight

`MenuBarButton` is a hybrid of the two precedent shapes, and each state needs a different treatment:

| State | Visible today | Why | New `ownStyleStates` entry |
|---|---|---|---|
| `.pressed` | No change at all — pressing a menu-bar button looks identical to resting | `pinPressedToResting()` pins all four pressed properties to the instance's resting values | Real extract, every value pinned to the resting tier (`PickerButton`'s shape) |
| `:hover` | A menu-bar highlight tint | `MenuBarButton` already declares a `:hover` extract carrying `MENU_BAR_BUTTON_HOVER_BG` | Real extract, keeping the highlight (`TabCloseButton`'s shape) |

So `.pressed` gets a new, non-empty extract whose `foregroundColor`/`backgroundColor`/`backgroundImage`/`shadow` all restate `MenuBarButton`'s own resting values, replacing today's `Button.ownStyleStates[0]` restatement. Restating `Button`'s entry unchanged after dropping `chromeless` would give menu-bar buttons `Button`'s raised pressed look — grey fill, grey text, inset shadow — for the first time.[^pressed-must-be-real]

### The `:hover` extract must also carry `backgroundImage` and `shadow`

The existing `:hover` extract returns one key, `backgroundColor`. That is enough only while `chromeless` is on. `ownStyleStates` content resolves as a merge over the parent's bag, so `MenuBarButton`'s `:hover` layer inherits `Button`'s hover gradient and hover shadow for the two keys it does not restate. Today those inherited declarations are masked by the bare `#id` resting rule; once the resting write moves onto `.MenuBarButton`, that mask is gone.[^hover-mask]

| Property | Selector that wins on hover, today | Selector that would win after, with a one-key extract | Result after |
|---|---|---|---|
| `background-color` | `.MenuBarButton:hover:not(.pressed)` `(0,3,0)` | `.MenuBarButton:hover:not(.pressed)` `(0,3,0)` | Correct — the highlight |
| `background-image` | `#c17` `(1,0,0)` → `none` | `.Button:hover:not(.pressed)` `(0,3,0)` → gradient | **Regression** — a raised gradient appears |
| `box-shadow` | `#c17` `(1,0,0)` → `none` | `.Button:hover:not(.pressed)` `(0,3,0)` → drop shadow | **Regression** — a drop shadow appears |

The `:hover` extract therefore returns all three keys, with `backgroundImage` and `shadow` set to `"none"`, sourced from new `hoverBackgroundImage`/`hoverShadow` fields in the defaults bag. The same completeness rule applies to `.pressed`, whose extract returns all four keys `Button`'s own entry declares.

### `Button.ts`'s `chromeless` doc comment drops its `Used by` pointer

[`ButtonOptions.chromeless`](packages/lib/src/typescript/lib/component/button/Button.ts#L123)'s comment ends "Used by [`MenuBarButton`](…)". That sentence is deleted rather than repointed at the one remaining in-tree user.[^why-delete-used-by] The rest of the comment already explains when to reach for the option. This is the only edit this plan makes to `Button.ts`.

---

## Public API

No exported signature changes. `MenuBarButton`'s constructor already forwards `subclassDefaults` and keeps its current shape:

```typescript
class MenuBarButton extends Button<MenuBarButtonOptions> {
    constructor(
        text:              string,
        onClick:           () => void,
        onHover:           () => void,
        options?:          MenuBarButtonOptions,
        subclassDefaults?: Partial<MenuBarButtonOptions>,
    );
}
```

Two inherited methods answer differently for a default `MenuBarButton`:

- `isChromeless()` returns `false` (was `true`).
- `setFlat(true)` applies `Button`'s flat appearance (was suppressed with a dev-time warning, because `flat` and `chromeless` are mutually exclusive and `chromeless` wins).

A caller passing `chromeless: true` explicitly still gets `Button`'s chromeless path, unchanged.

---

## Internal Structure

### `component/menubar/MenuBarButton.ts`

`MENU_BAR_BUTTON_HOVER_BG` (currently declared at line 41, *after* the defaults bag) moves above `_defaultMenuBarButtonOptions`, because the bag now references it. `HORIZONTAL_PAD` stays where it is.

```typescript
/** Hover highlight token, shared by the defaults bag, `ownStyleStates`' `:hover` entry, and `setActive`. */
const MENU_BAR_BUTTON_HOVER_BG = "var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))";

/**
 * User-overridable visual defaults forwarded to `super` via the third
 * constructor arg. The cascade in `Component`'s constructor merges these
 * over Button's own defaults and dispatches each setter once with the
 * final value, so any field the caller supplied wins.
 *
 * The resting chrome fields (`backgroundImage` / `border` / `borderRadius` /
 * `shadow`) declare the flat label-shaped surface `chromeless: true` used to
 * compute imperatively — see plans/menubarbutton-chromeless-migration.md's
 * Architecture Decisions for why declared chrome dedupes and `chromeless`
 * cannot. `borderRadius: undefined` is an explicit key, not an omission: it
 * suppresses Button's own radius default through the spread merge.
 *
 * The four `pressedX` fields restate this class's own resting values, so
 * pressing a menu-bar button shows no visual change — exactly what
 * `pinPressedToResting()` produced while this class was chromeless. The
 * three `hoverX` fields keep the menubar highlight while neutralising
 * Button's raised hover gradient and shadow, which `ownStyleStates`' merge
 * would otherwise inherit.
 */
const _defaultMenuBarButtonOptions: Partial<MenuBarButtonOptions> = {
    backgroundColor:        "var(--ts-ui-menu-bar-btn-bg, transparent)",
    foregroundColor:        "var(--ts-ui-menu-bar-btn-fg, inherit)",
    cursor:                 "pointer",
    backgroundImage:        "none",
    border:                 "none",
    borderRadius:           undefined,
    shadow:                 "none",
    pressedForegroundColor: "var(--ts-ui-menu-bar-btn-fg, inherit)",
    pressedBackgroundColor: "var(--ts-ui-menu-bar-btn-bg, transparent)",
    pressedBackgroundImage: "none",
    pressedShadow:          "none",
    hoverBackgroundColor:   MENU_BAR_BUTTON_HOVER_BG,
    hoverBackgroundImage:   "none",
    hoverShadow:            "none",
    // Horizontal padding inside the button — replaces Button's 4-px insets
    // default.
    insets:                 new Insets(0, HORIZONTAL_PAD, 0, HORIZONTAL_PAD),
};
```

`ownClassStyleDefaults` keeps its current declaration (`= _defaultMenuBarButtonOptions`) and its comment. `ownStyleStates` replaces both entries:

```typescript
    // Both entries carry real content pinned to this class's own tokens.
    // `.pressed` restates the resting values so a press shows no visual
    // change (what `pinPressedToResting()` did while this class was
    // chromeless); `:hover` keeps the menubar highlight and neutralises the
    // gradient/shadow Button's own `:hover` entry would otherwise merge in.
    // See plans/menubarbutton-chromeless-migration.md.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => ({
                foregroundColor: _defaultMenuBarButtonOptions.pressedForegroundColor,
                backgroundColor: _defaultMenuBarButtonOptions.pressedBackgroundColor,
                backgroundImage: _defaultMenuBarButtonOptions.pressedBackgroundImage,
                shadow:          _defaultMenuBarButtonOptions.pressedShadow,
            }),
        },
        {
            selector: ":hover",
            extract: (): StyleBag => ({
                backgroundColor: _defaultMenuBarButtonOptions.hoverBackgroundColor,
                backgroundImage: _defaultMenuBarButtonOptions.hoverBackgroundImage,
                shadow:          _defaultMenuBarButtonOptions.hoverShadow,
            }),
        },
    ];
```

The entry order — `.pressed` first, `:hover` second — is unchanged and must stay that way: it is what makes pressed beat hover and what generates the `:not(.pressed)` guards.

The class doc comment (lines 54-70) loses its `chromeless: true` sentence. Replace "Extends [`Button`](…) with `chromeless: true` so the menubar's flat label-style appearance dodges Button's ridge border, drop shadow, and gradient defaults." with a sentence saying the class declares its own flat resting chrome (no border, shadow, or gradient) through `ownClassStyleDefaults`, and pins `.pressed` to those same resting values so a press shows no visual change. Keep the rest of the comment, including the existing `:hover`/`ownStyleStates` sentence.

`setActive`, `computePreferredSize`, the constructor body, and the listener wiring are untouched.

---

## Ordered Implementation Steps

Step 1 is the whole source change; steps 2-5 are the test coverage for `## Expected Behaviour` rows 1-6, three of them rewrites of existing tests that assert the behaviour step 1 removes. The source change comes first here — unlike the usual test-first order — because those three files fail to compile or fail outright between the two, so there is no green state to hold in between.[^why-source-first]

1. **`component/menubar/MenuBarButton.ts`** — move `MENU_BAR_BUTTON_HOVER_BG` above `_defaultMenuBarButtonOptions`, rewrite the defaults bag and `ownStyleStates` per `## Internal Structure`, and update the class doc comment.
   *Check:* `npm run typecheck`. `grep -n 'chromeless' packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts` — zero matches.
2. **New test file `packages/lib/tests/component/menubar/MenuBarButton.classStyleHoisting.test.ts`.** Cover `## Expected Behaviour` rows 1-4, using the `declarationsDuring` / `idSelector` helpers copied from [`MenuBarButton.hoverClassHoisting.test.ts`](packages/lib/tests/component/menubar/MenuBarButton.hoverClassHoisting.test.ts) in the same directory. Construct one `MenuBarButton` to prime the shared rules, then a second, and assert the second's own `#id`, `#id:not(.pressed):not(:hover)`, `#id.pressed`, and `#id:hover:not(.pressed)` rules carry no real declarations, while `.MenuBarButton` and `.MenuBarButton.pressed` exist in the rule cache with the bodies rows 2-3 name and `.MenuBarButton:hover:not(.pressed)` carries the two keys row 4 adds (`background-image: none`, `box-shadow: none`).
   *Check:* `npx vitest run tests/component/menubar/MenuBarButton.classStyleHoisting.test.ts` from `packages/lib`.
3. **`packages/lib/tests/component/menubar/MenuBarButton.test.ts`** — rewrite the `MenuBarButton chromeless contract` describe block as `MenuBarButton declared chrome`, with two tests: `isChromeless()` is `false` by default, and `setFlat(true)` now takes effect (`isFlat()` becomes `true`). Delete the `a caller-supplied chromeless: false wins over the default` test and replace it with one asserting a caller-supplied `chromeless: true` still yields `isChromeless() === true`. Retitle the `MenuBarButton resting background` test — its assertion is unchanged, but "instead of the chromeless transparent overwrite" no longer describes why.
   *Check:* `npx vitest run tests/component/menubar/MenuBarButton.test.ts` from `packages/lib`.
4. **`packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts`** — rewrite row 9 ([line 184](packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts#L184)) per `## Expected Behaviour` row 5: `MenuBarButton` is now isolated, so `setActive(true)`'s `backgroundColor` lands on `#id:not(.pressed):not(:hover)` and not on the bare `#id`, and `.MenuBarButton.pressed` *is* in the rule cache. Rows 1-8 and 10-12 are untouched.
   *Check:* `npx vitest run tests/component/button/Button.restingChromeIsolation.test.ts` from `packages/lib`.
5. **`packages/lib/tests/component/default-options-fallback.test.ts`** — delete the `MenuBarButton chromeless` row ([line 306](packages/lib/tests/component/default-options-fallback.test.ts#L306), `expected: true`) and add four rendered rows in its place, matching the shape of the neighbouring `MenuBarButton backgroundColor (rendered)` row: `getShadow()` → `'none'`, `getBackgroundImage()` → `'none'`, `getPressedBackgroundColor()` → `'var(--ts-ui-menu-bar-btn-bg, transparent)'`, `getHoverBackgroundColor()` → `'var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))'`. Do not add a `borderRadius` row — `borderRadius: undefined` suppresses a default rather than supplying one, the same as `PickerButton`, which has no such row either.
   *Check:* `npx vitest run tests/component/default-options-fallback.test.ts` from `packages/lib`.
6. **`component/button/Button.ts`** — delete the "Used by [`MenuBarButton`](/api/component/menubar/classes/MenuBarButton)." sentence from the `chromeless` option's doc comment ([line 123](packages/lib/src/typescript/lib/component/button/Button.ts#L123)). Nothing else in this file changes.
   *Check:* `npm run typecheck`.
7. **Documentation.** Update the two doc pages named in `## Documentation Impact`.
   *Check:* `grep -rn 'chromeless' packages/lib/docs/components/MenuBarButton.md` — zero matches.
8. **Full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`. `npm run lint` and `npm -w packages/lib run test:lint` — the `local/no-raw-dom` baseline stays empty.
9. **Add the changelog entry.** See `## Documentation Impact`.
10. **Manual verification.** See `## Verification`. Non-negotiable: `## Expected Behaviour` rows 7-10 are cascade outcomes the offline harness cannot evaluate, and the hover regression this plan's Architecture Decisions guards against is exactly the kind that only shows in a browser.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/tests/component/menubar/MenuBarButton.test.ts` |
| Modify | `packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/components/MenuBarButton.md` |
| Modify | `packages/lib/docs/components/Button.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Create | `packages/lib/tests/component/menubar/MenuBarButton.classStyleHoisting.test.ts` |

---

## Expected Behaviour

Rows 1-6 are unit-testable offline against the recording DOM sink. Rows 7-10 need a live browser in all three shipped themes (modern, classic, dark) — the sink records writes, not cascade outcomes.

**Class-tier dedup**

1. A second `MenuBarButton`, constructed after a first has primed the shared rules, writes no `backgroundColor`, `backgroundImage`, `boxShadow`, or border longhands to its own `#id` rule or to its own `#id:not(.pressed):not(:hover)` rule, and no `borderRadius` anywhere.
2. `.MenuBarButton` exists in the rule cache carrying at least `background-color: var(--ts-ui-menu-bar-btn-bg, transparent)`, `color: var(--ts-ui-menu-bar-btn-fg, inherit)`, `background-image: none`, `box-shadow: none`, and `border-top` / `border-right` / `border-bottom` / `border-left: none`. It carries no `border-radius`. Assert those keys individually rather than comparing the whole rule body — the same rule also carries the class's padding, which is not part of this change.
3. The second instance writes no real declaration to `#id.pressed`. `.MenuBarButton.pressed` exists in the rule cache carrying `color: var(--ts-ui-menu-bar-btn-fg, inherit)`, `background-color: var(--ts-ui-menu-bar-btn-bg, transparent)`, `background-image: none`, `box-shadow: none`.
4. The second instance writes no `backgroundColor`, `backgroundImage`, or `boxShadow` to `#id:hover:not(.pressed)`. `.MenuBarButton:hover:not(.pressed)` carries `background-color: var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))`, `background-image: none`, `box-shadow: none`. (The existing [`MenuBarButton.hoverClassHoisting.test.ts`](packages/lib/tests/component/menubar/MenuBarButton.hoverClassHoisting.test.ts) already asserts the `background-color` half and needs no change; the two new keys belong in the new test file.)

**Resting isolation and options**

5. `setActive(true)` on a rendered `MenuBarButton` writes its `backgroundColor` to `#id:not(.pressed):not(:hover)`, not to the bare `#id` rule — the button is now isolated. `setActive(false)` writes a removal (an explicit `null`) to the same rule, because the restored value matches `.MenuBarButton`'s class-tier value. `getBackgroundColor()` still reports different values in the two states, so the existing relational test in `MenuBarButton.test.ts` keeps passing unchanged.
6. `new MenuBarButton('File', …).isChromeless()` is `false`; `setFlat(true)` on one leaves `isFlat()` `true`; a `MenuBarButton` constructed with `{ chromeless: true }` still reports `isChromeless() === true`.

**Manual verification** (`npm run dev`, the MenuBar demo panel, plus the Style Audit panel; switch themes with the theme picker)

7. In each of the three themes, every menu-bar entry renders identically to before this plan at rest: no border, no border radius, no drop shadow, no gradient, and the theme's `--ts-ui-menu-bar-btn-bg` fill (transparent in all three shipped themes) with `--ts-ui-menu-bar-btn-fg` text.
8. Hovering an entry shows only the highlight tint — `background-color` resolving to the theme's `--ts-ui-menu-bar-btn-hover-bg`, with `background-image: none` and `box-shadow: none`. Confirm with `getComputedStyle` while `element.matches(':hover')` is `true`, not by eye alone: a leaked gradient or shadow is the specific regression the `:hover` extract's extra two keys exist to prevent.
9. Pressing and holding an entry shows no visual change from its resting appearance, and opening a menu still paints the persistent `setActive` highlight. Pressing an entry whose menu is already open shows the resting fill for the duration of the press, as it does today.
10. Open the Style Audit panel after visiting the MenuBar panel in all three themes, and confirm neither the per-`#id` resting-chrome reset row nor the per-`#id.pressed` pin row attributed to menu-bar buttons appears any more.

---

## Verification

Run from the repo root unless noted.

- `npm run typecheck` — after every step.
- `npm test` from `packages/lib` (`typecheck:test` + `vitest run`) — full suite green.
- `npm run lint` and `npm -w packages/lib run test:lint` — the `local/no-raw-dom` baseline stays empty.
- `npm run docs:api` — zero warnings. No exported signature changes.
- Grep invariants: `grep -rn 'chromeless' packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts packages/lib/docs/components/MenuBarButton.md` — zero matches. `grep -n 'MenuBarButton' packages/lib/src/typescript/lib/component/button/Button.ts` — the `chromeless` option's doc comment (line 123) is no longer among the matches; the other five mentions in that file are prose about the class cascade and stay.
- **Manual browser verification is required, in all three themes** (`## Expected Behaviour` rows 7-10). Start a dev server on a spare port from *this worktree* and confirm with `readlink /proc/<pid>/cwd` that it resolves there — a server started elsewhere resolves `@jimka/typescript-ui` to a different tree and would silently exercise unfixed code. The screen is the demo app's **MenuBar** panel ([`packages/lib/src/typescript/MenuBarPanel.ts`](packages/lib/src/typescript/MenuBarPanel.ts)); the audit rows are read from the **Style Audit** panel ([`packages/lib/src/typescript/StyleAuditPanel.ts`](packages/lib/src/typescript/StyleAuditPanel.ts)).

---

## Documentation Impact

`MenuBarButton`'s typedoc API page (`/api/component/menubar/classes/MenuBarButton`) regenerates from the updated JSDoc via `npm run docs:api`; no manual edit to a generated page is needed. Two hand-written pages describe the behaviour being removed:

- [`packages/lib/docs/components/MenuBarButton.md:5`](packages/lib/docs/components/MenuBarButton.md#L5) — replace "defaults to `chromeless: true` so the menubar's flat label-style appearance dodges Button's ridge border, drop shadow, and gradient defaults — a caller can still pass `chromeless: false` to opt back into Button's raised chrome" with a description of the declared flat chrome (no border, radius, shadow, or gradient; a press shows no visual change; hover shows the menubar highlight). Keep the rest of the paragraph.
- [`packages/lib/docs/components/Button.md:121`](packages/lib/docs/components/Button.md#L121) — the *Chromeless mode* section offers "the trailing buttons in a [`WindowHeader`](/components/WindowHeader) or every entry in a [`MenuBar`](/components/MenuBar)" as examples. Both halves are wrong once this plan lands, so replace the example clause with a description of the shape rather than named components: buttons that want only a flat label-shaped surface with no framework chrome.[^windowheader-already-stale]
- [`packages/lib/docs/components/Button.md:190`](packages/lib/docs/components/Button.md#L190) — the note "For a flat menubar-style button reuse `chromeless: true` directly, or extend `Button` for a named class — `MenuBarButton` is the in-tree example." Rewrite so `MenuBarButton` is cited as the example of the *named-subclass with declared chrome* route, which is what it now is, rather than of the `chromeless` route.
- [`packages/lib/docs/reference/changelog/next.md`](packages/lib/docs/reference/changelog/next.md), `## Fixed` → `### Components` — append after the existing `PickerButton`/`AccordionHeader` entry: **`MenuBarButton` now declares its own flat chrome instead of using `chromeless: true`, so its resting and pressed styling dedupes onto shared class rules instead of repeating on every button.** Menu bars render exactly as before. Two inherited methods answer differently on a `MenuBarButton`: `isChromeless()` now returns `false`, and `setFlat(true)` now applies the flat appearance instead of being ignored.

---

## Potential Challenges

- **The hover gradient/shadow leak is the one real regression risk.** It is invisible to the offline harness, which records writes rather than resolving the cascade, and it is the exact failure the `PickerButton` migration shipped and had to fix afterwards. `## Expected Behaviour` row 8 is the check that catches it; do not skip the browser pass.
- **`setFlat(true)` changing from a no-op to a real effect is a behaviour change, not a bug.** It follows from `flat` and `chromeless` being mutually exclusive. Nothing in the library calls `setFlat` on a `MenuBarButton`; the changelog entry tells consumers.
- **`MENU_BAR_BUTTON_HOVER_BG` must be moved above the defaults bag** before the bag can reference it — a `const` referenced above its declaration throws at module evaluation, not at typecheck.
- **`borderRadius: undefined` must be written as an explicit key.** Omitting it is silent: `Button`'s radius default flows through the spread merge and every menu-bar entry gains rounded corners.

---

## Critical Files

| File | Why |
|---|---|
| [component/menubar/MenuBarButton.ts](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts) | The whole fix lands here — defaults bag (27-38), `MENU_BAR_BUTTON_HOVER_BG` (41), `ownClassStyleDefaults` (78), `ownStyleStates` (86-92), class doc comment (54-70), `setActive` (154-168) |
| [component/input/PickerButton.ts](packages/lib/src/typescript/lib/component/input/PickerButton.ts) | The closest precedent for `.pressed` — a chromeless-by-default `Button` subclass whose pressed state was pinned to resting. Read the whole file first |
| [component/button/TabCloseButton.ts](packages/lib/src/typescript/lib/component/button/TabCloseButton.ts) | The closest precedent for `:hover` — a real, non-empty hover extract fed from the class's own `hoverX` defaults |
| [component/container/AccordionHeader.ts](packages/lib/src/typescript/lib/component/container/AccordionHeader.ts) | The third migration of the same shape (`AccordionHeaderTitleButton`, from line 47) — confirms the pattern is settled, not one-off |
| [component/button/Button.ts](packages/lib/src/typescript/lib/component/button/Button.ts) | `_defaultButtonOptions` (222-241, the values the state extracts would otherwise inherit), `ownStyleStates` (394-429), `applyChromeOptions` (1023-1137, chromeless branch 1025-1095), `pinPressedToResting` (2081-2096), the `chromeless` doc comment (116-131) |
| [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) | `applyChromeOptions` (843-853, the `undefined`-suppression `borderRadius: undefined` relies on), `flushStyleBag` (5395-5497, the class-tier comparison that turns a matching write into a removal), `suppressIsolation` / `restingIsolationKeys` / `restingStyleRule` (5595-5638) |
| [core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) | `resolveStateLevels` — the per-level merge that makes an incomplete extract inherit its parent's remaining keys |
| [plans/implemented/button-variant-chrome-dedup.md](implemented/button-variant-chrome-dedup.md) | Established the migration and did `MenuBarButton`'s `:hover` half — read in full |
| [plans/implemented/button-chromeless-followup-dedup.md](implemented/button-chromeless-followup-dedup.md) | Applied the migration twice more, and its Implementation Notes record the hover-mask regression this plan designs around — read in full |
| [ARCHITECTURE.md](ARCHITECTURE.md) | *Component CSS tiers and state-rule dedup*, *The class tier is hierarchy-aware*, *Class-level defaults must survive the getter*, *Constructors forward `subclassDefaults`* |

---

## Non-Goals

- **`RailHandle`'s chromeless chrome.** The only other `chromeless: true` call site in the library today ([RailHandle.ts:72](packages/lib/src/typescript/lib/overlay/RailHandle.ts#L72)), and the last one once this plan lands. It has its own drafted plan, [`plans/railhandle-chromeless-dedup.md`](railhandle-chromeless-dedup.md), which names `MenuBarButton` in its Non-Goals in return. The two are independent files and can land in either order.
- **Removing the `chromeless` option itself.** It stays a supported public `ButtonOptions` field with a working runtime toggle (`setChromeless`), whatever the library's own components use.
- **Changing `pinPressedToResting` or `pinStateStyle`.** This plan stops one class from reaching the chromeless branch; it does not touch either method.
- **Making a menu-bar press visible.** Today a press shows no change, and this plan preserves that exactly. Giving menu-bar buttons a real pressed treatment is a design change, not a dedup.
- **Bumping the package version.** Release-time bookkeeping.

---

## Implementation Notes

- **The two Internal Structure comment blocks, copied verbatim, contradict
  the plan's own "zero matches" grep checks (step 1's `Check` and the
  `## Verification` section's grep invariant).** Both required comments use
  the word "chromeless" in prose (`` `chromeless: true` used to compute
  imperatively`` and `` did while this class was chromeless``), which the
  literal `grep -n 'chromeless' MenuBarButton.ts` check demands be absent.
  Implemented by rewording both comments to describe the same content
  without the word "chromeless" (e.g. "the old imperative flag"), preserving
  the grep check's evident intent (no functional `chromeless`/`isChromeless`/
  `setChromeless` usage survives in this file) without contradicting its
  literal text. One irreducible remainder: both comments still say "See
  plans/menubarbutton-chromeless-migration.md", and the plan's own filename
  contains the substring "chromeless" — no rewording can make a
  `grep -n 'chromeless'` on this file return zero matches while that
  self-reference stays. Verified there is no *functional* chromeless usage
  left (`grep -niE 'chromeless[^-]|ischromeless|setchromeless|chromeless:'`
  returns nothing) and left the plan-file references in place, since they
  are directly required by the Internal Structure section and are valuable
  provenance.
- **Manual browser verification (`## Expected Behaviour` row 7) surfaced a
  pre-existing, out-of-scope quirk, not a regression: a hovered/active
  `MenuBarButton` renders with `border-radius: 4px`, leaked in from
  `.Button`'s own class rule.** `resolveDeclarations` in
  `core/ClassStyleRules.ts` gates `borderRadius` on truthiness
  (`if (defaults.borderRadius) declarations.borderRadius = …`), so the
  explicit `borderRadius: undefined` key — which correctly suppresses the
  *instance-level* `setBorderRadius` dispatch per the Architecture
  Decisions — produces no class-tier declaration on `.MenuBarButton`
  either, leaving `.Button`'s `border-radius: var(--ts-ui-border-radius,
  4px)` unopposed in the cascade. Confirmed via `git stash` that the
  unmigrated (`chromeless: true`) code shows the identical `4px` radius on
  hover today: `cacheStyleValue`, which the chromeless branch used for
  `borderRadius`, only updates the JS-side getter cache and explicitly
  never writes CSS, so the leak predates this plan and is unrelated to it.
  Row 7 only requires parity with pre-plan rendering, which holds. Left
  unfixed as out of scope — the same latent gap likely affects
  `PickerButton`/`WindowControlButton`, which also default `borderRadius:
  undefined`, but never shows visually there because both keep a
  transparent background in every state.

**Manual verification (`## Verification`'s required browser check, `##
Expected Behaviour` rows 7-10) was performed** against a dev server started
from this worktree (`npx vite --port 8123` from `packages/lib`, confirmed via
`readlink /proc/<pid>/cwd`), driven live through `chrome-devtools` MCP tools,
covering the `MenuBar` demo panel's File/Edit/View/Options/Help buttons
across all three shipped themes (modern, classic, dark), switched at
runtime via `ThemeManager.setTheme`:

- **Row 7.** A resting, unhovered button (`getComputedStyle`) read
  `background-color: rgba(0, 0, 0, 0)` (transparent), `background-image:
  none`, `box-shadow: none`, `border: 0px none`, and the theme's
  `--ts-ui-menu-bar-btn-fg` text colour (`rgb(0, 0, 0)` modern/classic,
  `rgb(220, 220, 220)` dark) in all three themes — no visible border,
  radius, shadow, or gradient. `border-radius` itself resolved to `4px` in
  every theme, leaked from `.Button`'s ancestor class rule (see the
  border-radius note above); invisible against a transparent background,
  and confirmed pre-existing rather than introduced by this plan.
- **Row 8.** A real pointer hover (MCP `hover` tool, confirmed via
  `Element.matches(':hover')`) read `background-color:` the theme's
  `--ts-ui-menu-bar-btn-hover-bg` token (`rgba(30, 100, 200, 0.1)` modern/
  classic, `rgba(100, 140, 220, 0.15)` dark) with `background-image: none`
  and `box-shadow: none` in all three themes — only the highlight tint, no
  leaked gradient or shadow (the regression this plan's Architecture
  Decisions specifically guards against).
- **Row 9.** A real primary-button press (`pointerdown`/`pointerup`
  dispatched on the element and the viewport respectively, mirroring
  `Button`'s own `_updatePressedClass` tracking) toggled the `.pressed`
  class and, while held, read `background-color: rgba(0, 0, 0, 0)`,
  `background-image: none`, `box-shadow: none` — identical to resting, in
  all three themes. Clicking a button opened its menu, set
  `aria-expanded="true"`, and painted the persistent highlight
  (`background-color` equal to the hover token, `background-image`/
  `box-shadow: none`) in all three themes; clicking again closed it
  (`aria-expanded="false"`). With a menu already open, pressing that same
  button (`pointerdown` without a click) reverted the background to the
  transparent resting fill for the duration of the press and restored the
  active highlight on release, without closing the menu — matching the
  plan's specific claim about that sub-case.
- **Row 10.** After exercising all of the above in all three themes, the
  Style Audit panel's duplicate-rule table was scanned (`document.body
  .innerText.includes('MenuBarButton')`) both before and after clicking its
  "Refresh" button — no match either time, confirming no `MenuBarButton`
  duplicate-rule rows (the per-`#id` resting-chrome reset or the
  per-`#id.pressed` pin, both present before this plan) remain.

---

## Notes

[^audit-rows]: The two rows correspond to the two independent mechanisms `chromeless: true` triggers, both traced against current source. First, `applyChromeOptions`'s chromeless branch calls `suppressIsolation(true)` ([Button.ts:1035](packages/lib/src/typescript/lib/component/button/Button.ts#L1035)) and then `clearBorder()` / `setShadow("none")` / `setBackgroundImage("none")` ([Button.ts:1067-1070](packages/lib/src/typescript/lib/component/button/Button.ts#L1067)). Those three neutral values do not match `.MenuBarButton`'s class-tier bag — which today declares only `backgroundColor`, `foregroundColor`, `cursor`, and `insets` — so `flushStyleBag` finds no lower-layer match, writes them for real, and, with isolation suppressed, writes them to the bare `#id` rule. That is the resting-chrome reset row, one copy per rendered menu-bar button. Second, the same branch calls `pinPressedToResting()` ([Button.ts:1092](packages/lib/src/typescript/lib/component/button/Button.ts#L1092)), which reads `classStateLayer(".pressed")`, finds all four keys present, and writes them to `#id.pressed` through `pinStateStyle` — which removes the class-bag comparison by design. That is the pressed-pin row. `MenuBarButton`'s current `ownStyleStates[0]` is `Button.ownStyleStates[0]` restated verbatim, which resolves to the same four-key bag rather than an empty one, so the pin fires on every construction. The two row counts differ slightly because they come from different points in the same audit capture; both scale one-for-one with the number of live menu-bar buttons.

[^why-drop-chromeless]: Keeping `chromeless: true` and adding declarations alongside it cannot work, for two independent reasons both precedent plans established. `suppressIsolation(true)` routes every resting write to the bare `#id` rule at specificity `(1,0,0)`, and an id outranks any number of chained classes, so a `.MenuBarButton` rule could never win. And `pinPressedToResting()` writes through `pinStateStyle`, whose whole purpose is to bypass the class-tier comparison — so a matching `.MenuBarButton.pressed` rule would not suppress the per-instance write either. Dropping `chromeless` removes both at once: isolation returns, so resting writes route to `#id:not(.pressed):not(:hover)` and dedupe against the class bag, and `pinPressedToResting` becomes unreachable, since it is only ever called from inside the chromeless branch.

[^pressed-must-be-real]: This is where `MenuBarButton` diverges from `TabCloseButton` and `AccordionHeaderTitleButton`'s `Button.ownStyleStates[0]` restatement. `TabCloseButton` was never chromeless, so it already showed `Button`'s generic raised pressed look and restating the entry preserved that. `MenuBarButton` *is* chromeless today, and `pinPressedToResting()` pins its pressed chrome to its own resting values, so a press currently shows nothing. Restating `Button`'s entry after dropping `chromeless` would let `Button`'s raised pressed tokens through for the first time — `var(--ts-ui-button-pressed-bg, rgb(200, 200, 200))` fill, `var(--ts-ui-button-pressed-fg, rgb(150, 150, 150))` text, and an inset shadow — a visible change to every menu bar. `PickerButton`'s pin-to-resting extract is the shape that preserves current behaviour, so `.pressed` follows `PickerButton` while `:hover` follows `TabCloseButton`.

[^hover-mask]: `resolveStateLevels` composes each level's contribution as its parent's already-resolved bag for that selector with the level's own `extract()` result merged over it, so a key the subclass does not restate keeps the parent's value. `Button.ownStyleStates[1]` returns `backgroundColor`, `backgroundImage`, and `shadow` from `_defaultButtonOptions`'s `hoverX` fields. `MenuBarButton`'s current one-key extract therefore resolves to a hover bag carrying `Button`'s gradient and drop shadow alongside the menubar highlight. Those two declarations are published on a class-tier rule today and are simply outranked: the chromeless branch's `background-image: none` and `box-shadow: none` sit on the bare `#id` rule at `(1,0,0)`, which beats any `:hover` class rule while the pointer is over the button. Moving the resting write onto `.MenuBarButton` at `(0,1,0)` removes that mask — the same sequence the `PickerButton` migration hit and documented in `button-chromeless-followup-dedup.md`'s Implementation Notes, where it was caught only in the browser after the offline tests had gone green.

[^why-delete-used-by]: The alternative is repointing the sentence at `RailHandle`, the one remaining in-tree `chromeless: true` call site, which is what `button-chromeless-followup-dedup.md` did when it removed `PickerButton` from the same sentence and left `MenuBarButton`. That would ship a reference already scheduled to go stale: `plans/railhandle-chromeless-dedup.md` migrates `RailHandle` the same way and does not touch `Button.ts`, so the sentence would survive its own last example. Deleting it costs nothing — the preceding two sentences already say what the option does and when to use it — and ends a pointer that every plan in this series has had to re-edit.

[^why-source-first]: `MenuBarButton.test.ts`'s `a caller-supplied chromeless: false wins over the default` test and `default-options-fallback.test.ts`'s `MenuBarButton chromeless` row both assert `true` for a value that becomes `false`, and `Button.restingChromeIsolation.test.ts`'s row 9 asserts the absence of a rule that starts being inserted. Writing the new assertions first would mean three files failing against unchanged source for the same reason they will pass against changed source, which proves nothing about either. The new test file created in step 2 is the one place a genuine before/after distinction exists, and it is cheap to run it against a stashed source change if a red state is wanted. Both precedent plans ordered their steps the same way.

[^windowheader-already-stale]: The `WindowHeader` half of that example list was already wrong before this plan: `button-variant-chrome-dedup.md` moved window-control buttons onto `WindowControlButton`'s declared chrome and did not update this page. Rewriting the whole clause rather than only the `MenuBar` half is the smaller edit — replacing one sentence fragment against leaving a sentence that names two components neither of which uses the feature.
