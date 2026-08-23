---
depends-on: [button-meta-class-dedup]
---

# Button Variant Chrome Dedup — Implementation Plan

## Overview

After [`plans/implemented/button-meta-class-dedup.md`](implemented/button-meta-class-dedup.md) closed the Button family's generic `.pressed`/`:hover`/`.selected`/`.flat` duplication[^base-branch], a re-run of the Style Audit panel ([`packages/lib/src/typescript/StyleAuditPanel.ts`](packages/lib/src/typescript/StyleAuditPanel.ts)) still shows six duplicate-rule groups, all tagged component `"Button"`.[^audit-tag-is-generic] Three independent, unrelated code paths explain all six:

1. **The shared window-control button factory** — [`overlay/windowControls.ts`](packages/lib/src/typescript/lib/overlay/windowControls.ts)`createWindowControlButton`/`createWindowLeadGlyphButton`, used by [`WindowHeader`](packages/lib/src/typescript/lib/component/container/WindowHeader.ts#L129) (minimize/maximize/close) and [`TabWindow`](packages/lib/src/typescript/lib/overlay/TabWindow.ts#L93) (its own trailing tools + leading glyph) — builds a plain `Button({chromeless: true, styleRules: [...]})` per call. `styleRules` ([`core/Component.ts:109-112`](packages/lib/src/typescript/lib/core/Component.ts#L109), dispatched at [:758-768](packages/lib/src/typescript/lib/core/Component.ts#L758)) always writes a per-instance `#id<suffix>` rule with no class-tier comparison, so every control button repeats the same three declarations. This is the **resting border/shadow**, **hover background**, and **pressed background** rows.
2. **`MenuBarButton`'s `:hover` highlight** — [`component/menubar/MenuBarButton.ts:99-111`](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts#L99), same `styleRules` bypass, one property.
3. **`TabCloseButton`'s manually-painted resting and hover chrome** — [`component/button/TabButton.ts:318-333`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L318)`buildCloseButton()` calls eight setters on a freshly-built `TabCloseButton` with the same literal values every time, because [`TabCloseButton`](packages/lib/src/typescript/lib/component/button/TabCloseButton.ts)'s own `ownClassStyleDefaults` (line 45) doesn't carry them and it declares no `ownStyleStates` at all.

All three are the same shape button-meta-class-dedup already established: **a per-instance write with no class-tier home for a value that never varies per instance.** The fix in every case is to give the value that home — `ownClassStyleDefaults` for resting properties, `ownStyleStates` for `.pressed`/`:hover` — exactly as that plan did for `TabButton`'s hover/selected border. No new mechanism is introduced.

One further duplicate source was found and is **out of scope** — see `## Non-Goals`.

---

## Architecture Decisions

### Window-control buttons become real subclasses, and drop `chromeless: true`

`createWindowControlButton`/`createWindowLeadGlyphButton` become two module-private classes, `WindowControlButton` and `WindowLeadGlyphButton` (both `extends Button`, in `windowControls.ts`), each declaring its own `ownClassStyleDefaults` (resting `backgroundColor`/`backgroundImage`/`border`/`borderRadius`/`shadow`) and — `WindowControlButton` only — its own `ownStyleStates` for `.pressed`/`:hover`. This mirrors `TabButton`'s shape exactly: a subclass with real, declared chrome, not `chromeless: true`.

`chromeless: true` must be dropped, not merely kept alongside the new declarations. `chromeless` routes every resting write to the bare, un-isolated `#id` rule (`Button.applyChromeOptions`'s chromeless branch, [Button.ts:942-1048](packages/lib/src/typescript/lib/component/button/Button.ts#L942), via `suppressIsolation(true)`) — and a bare `#id` declaration always outranks any class-tier rule, regardless of state, per `ARCHITECTURE.md`'s *Component CSS tiers and state-rule dedup*. A `.WindowControlButton.pressed` class rule could never win against that. `chromeless` also runs `pinPressedToResting()`, which writes the `.pressed` state's four properties straight from the instance's live values, bypassing class-tier comparison entirely — a second, independent reason a chromeless button's `.pressed` chrome can never dedupe.[^why-not-flat-shape] Dropping `chromeless` restores the normal, isolated resting-tier write path, where a value matching `ownClassStyleDefaults` genuinely dedupes.

### `background` shorthand becomes `backgroundColor` + `backgroundImage`, matching Button's own resting-fill pattern

`WINDOW_CONTROL_STYLE_RULES` today paints with the CSS `background` shorthand (not `backgroundColor`), because the classic theme's token is a gradient. `StyleBag` has no `background` key — `Button`'s own `setBackground` override's doc comment states plainly that "no class-tier bag ever carries `background`" ([Button.ts:619-624](packages/lib/src/typescript/lib/component/button/Button.ts#L619)) — so a `background`-shorthand value can never dedupe through `ownClassStyleDefaults`/`ownStyleStates`. `Button` itself already solves the identical problem (a token that's a flat colour in one theme and a gradient in another) by writing the same token to *both* `backgroundColor` and `backgroundImage` — CSS silently drops whichever channel doesn't parse ([Button.ts:1050-1063](packages/lib/src/typescript/lib/component/button/Button.ts#L1050)). Window-control buttons adopt the same two-channel pattern instead of the shorthand.

`setWindowControlsActive` (the focus/blur toggle) moves from one `setBackground(...)` call to a `setBackgroundColor(...)` + `setBackgroundImage(...)` pair, for the same reason.

### Every `.pressed`/`:hover` key Button's generic entry would otherwise supply must be pinned to its resting value

`ownStyleStates`' content resolution is a **merge**, not a replacement: `resolveStateLevels` layers each level's own `extract()` result over its parent's already-resolved bag for that selector (`ARCHITECTURE.md`, *Component CSS tiers and state-rule dedup*, "Content... is a per-level merge"). `Button.ownStyleStates[0]` (`.pressed`) already declares `foregroundColor`/`backgroundColor`/`backgroundImage`/`shadow`; a `WindowControlButton.ownStyleStates` entry that only overrides `backgroundColor`/`backgroundImage` would still inherit Button's generic raised `foregroundColor`/`shadow` for the other two keys — a real, new visual regression (window-control buttons today never change colour or shadow on press/hover, only background). `WindowControlButton`'s `.pressed`/`:hover` extracts therefore supply all four (`.pressed`) / three (`:hover`, no `foregroundColor` — Button's own `hoverForegroundColor` has no default to inherit either) keys explicitly, each pinned to the *same* value the resting tier already uses for `foregroundColor`/`shadow` — so nothing actually changes those two properties, only `backgroundColor`/`backgroundImage` move.

### `MenuBarButton` gets its own `:hover` entry, mirroring `TabButton`'s established fix

`MenuBarButton` is chromeless too, but its `:hover` background is delivered through the `styleRules` option, not through `chromeless`'s own suppressed pressed/hover dispatch — chromeless returns before ever reaching that dispatch ([Button.ts:1031-1048](packages/lib/src/typescript/lib/component/button/Button.ts#L1031)), so nothing here competes with a bare-`#id` write the way window-control's did. `MenuBarButton` already declares `ownClassStyleDefaults` (line 74); it gains an `ownStyleStates` array — `[Button.ownStyleStates[0], { selector: ":hover", extract: ... }]` — restating `.pressed` unchanged and supplying real `:hover` content, the exact shape `button-meta-class-dedup.md` used for `TabButton`'s own hover fix. The `styleRules` `:hover` entry is deleted.

### `TabCloseButton` gets the same treatment: hoist resting values, add `:hover`, delete the imperative calls

`TabCloseButton` is **not** chromeless — `buildCloseButton()` paints its flattened look by calling `setBackgroundColor`/`setBackgroundImage`/`setBorderRadius`/`clearBorder`/`clearShadow` (resting) and `setHoverBackgroundColor`/`setHoverBackgroundImage`/`setHoverShadow` (state) directly on every instance. Because none of these values live in `_defaultTabCloseButtonOptions`, each call is a genuine deviation from the inherited `.Button`/`.TabCloseButton` class rules and writes for real every time. Moving the five resting values into `_defaultTabCloseButtonOptions` (already `ownClassStyleDefaults`, [TabCloseButton.ts:45](packages/lib/src/typescript/lib/component/button/TabCloseButton.ts#L45)) and the three hover values into a new `ownStyleStates` `:hover` entry lets the *existing* construction-time options cascade apply them automatically — `Component.applyChromeOptions`'s base handler always-dispatches `border`/`borderRadius`/`shadow`/`backgroundImage` from `_defaultOptions` ([Component.ts:775-799](packages/lib/src/typescript/lib/core/Component.ts#L775)), and `Button.applyChromeOptions`'s chromeful branch always-dispatches `hoverBackgroundColor`/`hoverBackgroundImage`/`hoverShadow` the same way ([Button.ts:1064-1079](packages/lib/src/typescript/lib/component/button/Button.ts#L1064)) — so `buildCloseButton()`'s eight imperative calls become redundant and are deleted outright, not merely left as a defensive re-assert.[^why-delete-not-keep]

---

## Internal Structure

### `overlay/windowControls.ts` — full rewrite

```typescript
import { Button, ButtonOptions } from "~/component/button/Button.js";
import { Insets } from "~/primitive/Insets.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";

/**
 * Resting + pressed/hover defaults for a window control button (minimize /
 * maximize / close), painted from the theme's `window.control` tokens.
 * `backgroundColor` and `backgroundImage` both carry the same token —
 * flat-colour themes (modern/dark) resolve it as a colour, the classic
 * theme's gradient resolves it as an image; CSS silently drops whichever
 * channel doesn't parse, the same two-channel pattern Button's own resting
 * fill uses (see Button.ts's chromeful `applyChromeOptions` branch).
 * `pressedForegroundColor`/`pressedShadow`/`hoverShadow` are pinned to the
 * same value as the resting tier — window-control buttons never change
 * colour or shadow on press/hover, only background — so the `ownStyleStates`
 * merge below doesn't leak Button's generic raised pressed/hover chrome onto
 * these two properties. `borderRadius: undefined` is an explicit key (not an
 * omission) so it wins over Button's own non-empty default in the
 * subclassDefaults spread merge, mirroring TabButton's identical trick.
 */
const _defaultWindowControlOptions: Partial<ButtonOptions> = {
    backgroundColor:        "var(--ts-ui-window-control-bg)",
    backgroundImage:        "var(--ts-ui-window-control-bg)",
    border:                 "var(--ts-ui-window-control-border)",
    borderRadius:           undefined,
    shadow:                 "var(--ts-ui-window-control-shadow)",
    pressedForegroundColor: "var(--ts-ui-text-color, black)",
    pressedBackgroundColor: "var(--ts-ui-window-control-active-bg)",
    pressedBackgroundImage: "var(--ts-ui-window-control-active-bg)",
    pressedShadow:          "var(--ts-ui-window-control-shadow)",
    hoverBackgroundColor:   "var(--ts-ui-window-control-hover-bg)",
    hoverBackgroundImage:   "var(--ts-ui-window-control-hover-bg)",
    hoverShadow:            "var(--ts-ui-window-control-shadow)",
};

/**
 * A single window control button (minimize / maximize / close), shared by
 * `TabWindow`'s trailing tools and `WindowHeader`'s trailing buttons. Real,
 * declared chrome instead of `chromeless: true` — see
 * plans/button-variant-chrome-dedup.md's Architecture Decisions for why
 * chromeless's bare-`#id` resting write can never lose to a shared class
 * rule. Module-private: not exported, not wrapped in `callable()` (same
 * treatment as `NumberSpinnerField`/`TabCloseButton`).
 */
class WindowControlButton extends Button {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultWindowControlOptions;

    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => ({
                foregroundColor: _defaultWindowControlOptions.pressedForegroundColor,
                backgroundColor: _defaultWindowControlOptions.pressedBackgroundColor,
                backgroundImage: _defaultWindowControlOptions.pressedBackgroundImage,
                shadow:          _defaultWindowControlOptions.pressedShadow,
            }),
        },
        {
            selector: ":hover",
            extract: (): StyleBag => ({
                backgroundColor: _defaultWindowControlOptions.hoverBackgroundColor,
                backgroundImage: _defaultWindowControlOptions.hoverBackgroundImage,
                shadow:          _defaultWindowControlOptions.hoverShadow,
            }),
        },
    ];

    constructor(glyph: string) {
        super(undefined, { glyph, insets: new Insets(2, 2, 2, 2) }, _defaultWindowControlOptions);
    }
}

/**
 * Resting-only defaults for the decorative leading window glyph (title
 * icon) — transparent, so the bar/header surface shows through, with a
 * `1px solid transparent` border reserving the same border box the real
 * controls' themed border occupies (keeps it a size/inset peer).
 */
const _defaultWindowLeadGlyphOptions: Partial<ButtonOptions> = {
    backgroundColor: "transparent",
    backgroundImage: "none",
    border:          "1px solid transparent",
    borderRadius:    undefined,
    shadow:          "none",
};

/**
 * The decorative leading window glyph (title icon), pointer-events-disabled
 * so a press falls through to the window-move gesture — it never reaches
 * `.pressed`/`:hover`, so unlike `WindowControlButton` it needs no
 * `ownStyleStates` of its own.
 */
class WindowLeadGlyphButton extends Button {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultWindowLeadGlyphOptions;

    constructor(glyph: string) {
        super(undefined, { glyph, insets: new Insets(2, 2, 2, 2) }, _defaultWindowLeadGlyphOptions);
    }
}

/**
 * Builds a window control button (minimize / maximize / close) shared by
 * `TabWindow` and `WindowHeader`. Callers wire the `"action"` listener and
 * may override the insets to match their container's box (a `TabWindow`'s
 * bar re-sets them to the compact tool inset).
 *
 * @param glyph - The registry glyph name to show.
 *
 * @returns The configured control button.
 */
export function createWindowControlButton(glyph: string): Button {
    return new WindowControlButton(glyph);
}

/**
 * Builds the decorative leading window glyph (title icon) shared by
 * `TabWindow` and `WindowHeader`. Same chromeless-looking control box as
 * {@link createWindowControlButton} so it is a size/inset peer, made
 * pointer-transparent so a press falls through to the window-move gesture.
 *
 * @param glyph - The registry glyph name to show.
 *
 * @returns The configured decorative leading glyph button.
 */
export function createWindowLeadGlyphButton(glyph: string): Button {
    const button = new WindowLeadGlyphButton(glyph);
    button.setPointerEvents("none");

    return button;
}

/**
 * Toggles a set of window control buttons between their opaque themed fill
 * (focused) and `"transparent"` (blurred). Two channels (`backgroundColor` +
 * `backgroundImage`), not the `background` shorthand — see this file's
 * `_defaultWindowControlOptions` comment for why. Shared by `TabWindow`'s
 * and `WindowHeader`'s focus hooks.
 *
 * @param buttons - The control buttons to flatten or restore.
 * @param active - True to restore the control fill, false to flatten it.
 */
export function setWindowControlsActive(buttons: Button[], active: boolean): void {
    const backgroundColor = active ? "var(--ts-ui-window-control-bg)" : "transparent";
    const backgroundImage = active ? "var(--ts-ui-window-control-bg)" : "none";

    for (const button of buttons) {
        button.setBackgroundColor(backgroundColor);
        button.setBackgroundImage(backgroundImage);
    }
}
```

`ComponentStyleRuleSpec` import and the two `WINDOW_CONTROL_STYLE_RULES`/`WINDOW_LEAD_GLYPH_STYLE_RULES` constants are deleted — nothing references them any more.

### `component/menubar/MenuBarButton.ts`

Add near `_defaultMenuBarButtonOptions` (after line 38):

```typescript
const MENU_BAR_BUTTON_HOVER_BG = "var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))";
```

Add the field, after `ownClassStyleDefaults` (after line 74):

```typescript
protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
    Button.ownStyleStates[0],   // .pressed, restated unchanged
    {
        selector: ":hover",
        extract: (): StyleBag => ({ backgroundColor: MENU_BAR_BUTTON_HOVER_BG }),
    },
];
```

Add `StyleStateSpec` to the existing `import type { StyleBag } from "~/core/ClassStyleRules.js";` line.

Remove the `styleRules: [...]` key and its comment (lines 99-111) from the options object passed as the constructor's second `super()` argument (the object spans lines 97-112), leaving:

```typescript
super(
    text,
    { ...options },
    { ..._defaultMenuBarButtonOptions, ...(subclassDefaults ?? {}) },
);
```

Replace the class doc comment's `"The :hover rule rides Button's styleRules bag."` (line 60) — it no longer does; say it comes from `MenuBarButton`'s own `ownStyleStates`, matching `TabButton`'s pattern. Update `setActive`'s two literal `"var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))"` strings (lines 154, 155) to reference `MENU_BAR_BUTTON_HOVER_BG`/`_defaultMenuBarButtonOptions.backgroundColor` instead of repeating the literals — same values, single source.

### `component/button/TabCloseButton.ts`

Replace `_defaultTabCloseButtonOptions` (lines 26-30):

```typescript
const _defaultTabCloseButtonOptions: Partial<TabCloseButtonOptions> = {
    preferredSize:        { width: 16, height: 16 },
    insets:               new Insets(0, 0, 0, 0),
    foregroundColor:      "var(--ts-ui-close-button-fg, #555)",
    backgroundColor:      "transparent",
    backgroundImage:      "none",
    borderRadius:         "3px",
    border:               "none",
    shadow:               "none",
    hoverBackgroundColor: "var(--ts-ui-tab-close-hover-bg, rgba(0, 0, 0, 0.12))",
    hoverBackgroundImage: "none",
    hoverShadow:          "none",
};
```

Add, after `ownClassStyleDefaults` (after line 45):

```typescript
protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
    Button.ownStyleStates[0],   // .pressed, restated unchanged
    {
        selector: ":hover",
        extract: (): StyleBag => ({
            backgroundColor: _defaultTabCloseButtonOptions.hoverBackgroundColor,
            backgroundImage: _defaultTabCloseButtonOptions.hoverBackgroundImage,
            shadow:          _defaultTabCloseButtonOptions.hoverShadow,
        }),
    },
];
```

Widen the existing `import type { StyleBag } from "~/core/ClassStyleRules.js";` to include `StyleStateSpec`.

### `component/button/TabButton.ts` — `buildCloseButton()`'s deletion

Delete the eight-call block ([TabButton.ts:325-332](packages/lib/src/typescript/lib/component/button/TabButton.ts#L325)):

```typescript
closeButton.setBackgroundColor("transparent");
closeButton.setBackgroundImage("none");
closeButton.setHoverBackgroundColor("var(--ts-ui-tab-close-hover-bg, rgba(0, 0, 0, 0.12))");
closeButton.setHoverBackgroundImage("none");
closeButton.setHoverShadow("none");
closeButton.setBorderRadius("3px");
closeButton.clearBorder();
closeButton.clearShadow();
```

`closeButton.setZIndex(1);` (line 333) and everything below it (glyph sizing, `setWidth`/`setHeight`/`pinGlyphSize`, the raw-append) stays untouched. Update the comment above the block (lines 321-324, "Transparent so the tab's own background shows through...") — move its substance to `TabCloseButton.ts`'s new defaults bag, since that's now where the values live; a short note here that the close button's flattened chrome comes from `TabCloseButton`'s own class defaults is enough.

---

## Ordered Implementation Steps

1. **`overlay/windowControls.ts`** — full rewrite per `## Internal Structure`. Delete `ComponentStyleRuleSpec` import and both `WINDOW_CONTROL_STYLE_RULES`/`WINDOW_LEAD_GLYPH_STYLE_RULES` constants.
   *Check:* `npm run typecheck`.
2. **`component/menubar/MenuBarButton.ts`** — add `MENU_BAR_BUTTON_HOVER_BG`, add `ownStyleStates`, remove the `styleRules` array, update `setActive`'s two literals to reference the constant, update the class doc comment.
   *Check:* `npm run typecheck`. `grep -n 'styleRules' packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts` — zero matches.
3. **`component/button/TabCloseButton.ts`** — widen `_defaultTabCloseButtonOptions`, add `ownStyleStates`, widen the `ClassStyleRules.js` type import.
   *Check:* `npm run typecheck`.
4. **`component/button/TabButton.ts`** — delete `buildCloseButton()`'s eight-call block per `## Internal Structure`.
   *Check:* `npm run typecheck`. `grep -n 'closeButton\.\(setBackgroundColor\|setBackgroundImage\|setHoverBackgroundColor\|setHoverBackgroundImage\|setHoverShadow\|setBorderRadius\|clearBorder\|clearShadow\)' packages/lib/src/typescript/lib/component/button/TabButton.ts` — zero matches.
5. **New test file `packages/lib/tests/component/button/WindowControlButton.classStyleHoisting.test.ts`.** Cover `## Expected Behaviour` rows 1-6 using the `declarationsDuring`/`idSelector` helpers from `tests/core/ClassHierarchyCascade.test.ts` — two `createWindowControlButton("xmark")` instances (second one primed against the first), asserting the second's `#id`/`#id.pressed`/`#id:hover:not(.pressed)` rules carry no real declarations and `.WindowControlButton`/`.WindowControlButton.pressed`/`.WindowControlButton:hover:not(.pressed)` exist in the rule cache with the right bodies.
   *Check:* `npx vitest run tests/component/button/WindowControlButton.classStyleHoisting.test.ts` from `packages/lib`.
6. **New test file `packages/lib/tests/component/menubar/MenuBarButton.hoverClassHoisting.test.ts`.** Two `MenuBarButton`s; assert the second writes no `backgroundColor` to `#id:hover:not(.pressed)` and `.MenuBarButton:hover:not(.pressed)` exists carrying `MENU_BAR_BUTTON_HOVER_BG`'s value.
   *Check:* `npx vitest run tests/component/menubar/MenuBarButton.hoverClassHoisting.test.ts` from `packages/lib`.
7. **New test file `packages/lib/tests/component/button/TabCloseButton.classStyleHoisting.test.ts`.** Two `TabButton`s built `closeable: true`; assert the second's close button writes no `backgroundColor`/`backgroundImage`/`borderRadius`/border-longhands/`boxShadow` to its `#id` rule and no `backgroundColor`/`backgroundImage`/`boxShadow` to `#id:hover:not(.pressed)`; `.TabCloseButton` and `.TabCloseButton:hover:not(.pressed)` exist in the rule cache carrying the values from `## Internal Structure`'s defaults bag.
   *Check:* `npx vitest run tests/component/button/TabCloseButton.classStyleHoisting.test.ts` from `packages/lib`.
8. **Add three rows to the default-resolution registry** in [`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts), per `ARCHITECTURE.md`'s *Class-level defaults must survive the getter* (every class that defaults a field needs a row): `TabCloseButton getBackgroundColor()` → `"transparent"`, `TabCloseButton getBorderRadius()` → `"3px"`, `MenuBarButton getBackgroundColor()` → `_defaultMenuBarButtonOptions.backgroundColor`'s value (already covered if a row exists — add only if absent; check the file first).
   *Check:* `npx vitest run tests/component/default-options-fallback.test.ts` — green.
9. **Full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`. `npm run lint` and `npm -w packages/lib run test:lint` — the `local/no-raw-dom` baseline stays empty (no raw DOM access added; every write goes through typed setters or `ownClassStyleDefaults`/`ownStyleStates`).
10. **Add the changelog entry.** See `## Documentation Impact`.
11. **Manual verification.** See `## Verification` — non-negotiable for this plan given the theme-token risk in `## Potential Challenges`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/overlay/windowControls.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabCloseButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Create | `packages/lib/tests/component/button/WindowControlButton.classStyleHoisting.test.ts` |
| Create | `packages/lib/tests/component/menubar/MenuBarButton.hoverClassHoisting.test.ts` |
| Create | `packages/lib/tests/component/button/TabCloseButton.classStyleHoisting.test.ts` |

---

## Expected Behaviour

Rows 1-8 are unit-testable offline (recording DOM sink, no real cascade). Rows 9-12 need a live browser, in **all three shipped themes** (modern, classic, dark) — see `## Potential Challenges`.

**Window-control buttons**

1. A second `createWindowControlButton("xmark")`, rendered after a first has primed the shared rules, writes no `backgroundColor`/`backgroundImage`/`border`-longhands/`boxShadow` to its own `#id` rule.
2. `.WindowControlButton` exists in the rule cache carrying `background-color`/`background-image` both resolving to `var(--ts-ui-window-control-bg)`, `border` resolving to `var(--ts-ui-window-control-border)`, `box-shadow` resolving to `var(--ts-ui-window-control-shadow)`.
3. The second instance writes no real declaration to `#id.pressed` or `#id:hover:not(.pressed)`; `.WindowControlButton.pressed` carries `background-color`/`background-image` → `var(--ts-ui-window-control-active-bg)`, `color` → `var(--ts-ui-text-color, black)`, `box-shadow` → `var(--ts-ui-window-control-shadow)`; `.WindowControlButton:hover:not(.pressed)` carries the same three keys with the hover token in place of the active one.
4. `createWindowLeadGlyphButton("window-maximize")`'s second instance writes no real declaration to its own `#id` rule; `.WindowLeadGlyphButton` carries `background-color: transparent`, `background-image: none`, `border: 1px solid transparent`, `box-shadow: none`.
5. `setWindowControlsActive([button], false)` writes `background-color: transparent`, `background-image: none` for real to that instance's own (isolated) resting rule — a genuine per-instance deviation, never deduped, since it's a runtime state change. `setWindowControlsActive([button], true)` reverts to the two class-tier token values, and — since they now match the class default again — writes nothing further (the isolated rule's earlier "blurred" declaration is nulled out by the flush-time comparison).
6. Two `WindowControlButton`s in different states (one pressed, one not) don't interfere — the pressed one's element carries the `pressed` DOM class, the other doesn't, and each resolves independently through the cascade.

**`MenuBarButton`**

7. A second `MenuBarButton`, rendered after a first, writes no `backgroundColor` to its own `#id:hover:not(.pressed)` rule; `.MenuBarButton:hover:not(.pressed)` exists carrying `background-color: var(--ts-ui-menu-bar-btn-hover-bg, rgba(30, 100, 200, 0.10))`.

**`TabCloseButton`**

8. A second `TabButton({closeable: true})`'s close button writes no real declaration to its own `#id` rule (resting) or `#id:hover:not(.pressed)` rule; `.TabCloseButton` carries `background-color: transparent`, `background-image: none`, `border-radius: 3px`, `border: none` (all four longhands), `box-shadow: none`; `.TabCloseButton:hover:not(.pressed)` carries `background-color: var(--ts-ui-tab-close-hover-bg, rgba(0, 0, 0, 0.12))`, `background-image: none`, `box-shadow: none`. A close button's `.pressed` chrome is unaffected (still Button's inherited generic raised look — unchanged before and after this plan, not part of its scope).

**Manual verification** (`npm run dev`, http://localhost:8015, Style Audit panel; switch themes via the theme picker)

9. In each of the three themes, a `Window` (via `WindowHeader`) and a `TabWindow` render their minimize/maximize/close controls identically to before this plan: resting fill/border/shadow, hover tint, pressed tint, and the classic theme's gradient specifically (the two-channel `backgroundColor`+`backgroundImage` swap is the one change with real cross-theme risk — see `## Potential Challenges`).
10. Blurring and refocusing a `Window`/`TabWindow` still flattens/restores its controls' fill exactly as before.
11. A `TabWindow`'s leading title glyph still renders transparent with no border artefact in all three themes, and a press on it still falls through to the window-move gesture (drag the window by its icon).
12. A closeable tab's ✕ still shows the flattened resting/hover look (transparent at rest, faint rounded tint on hover) exactly as before.
13. Open the Style Audit panel after visiting enough windows/tabs/menu bars to populate it meaningfully, and confirm the six duplicate-rule groups from this plan's `## Overview` no longer appear (or appear with much lower "wasted KB", for any residual un-deduped key).

---

## Verification

Run from the repo root unless noted.

- `npm run typecheck` — after every step.
- `npm test` from `packages/lib` (`typecheck:test` + `vitest run`) — full suite green.
- `npm run lint` and `npm -w packages/lib run test:lint` — `local/no-raw-dom` baseline stays empty.
- `npm run docs:api` — zero warnings (no public API surface changes).
- Grep invariants: `grep -n 'styleRules' packages/lib/src/typescript/lib/overlay/windowControls.ts packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts` — zero matches. `grep -n 'chromeless' packages/lib/src/typescript/lib/overlay/windowControls.ts` — zero matches.
- **Manual browser verification is required, in all three themes** (`## Expected Behaviour` rows 9-13). Start a dev server on a spare port from *this worktree* (or wherever this plan is implemented), confirming with `readlink /proc/<pid>/cwd` that it resolves there — not the main tree or another worktree.

---

## Documentation Impact

No exported symbol added, removed, or changed in signature — `createWindowControlButton`/`createWindowLeadGlyphButton`/`setWindowControlsActive` keep their existing signatures; `WindowControlButton`/`WindowLeadGlyphButton` are module-private. `typedoc.json`, the barrels, and `packages/lib/llms.txt` are unaffected.

- `packages/lib/docs/reference/changelog/next.md`, `## Fixed` → `### Components` (append after the existing `MenuBarButton`/`TabCloseButton` entry if `button-meta-class-dedup.md` has landed by the time this is implemented, otherwise start the list): **the shared window-control button factory, `MenuBarButton`'s hover highlight, and `TabCloseButton`'s resting/hover chrome now dedupe onto shared class rules instead of repeating on every instance.** No consumer action is needed; nothing renders differently.

---

## Potential Challenges

- **The classic theme's gradient is the one real cross-theme risk.** `WindowControlButton`'s two-channel `backgroundColor`+`backgroundImage` swap (replacing the `background` shorthand) relies on CSS silently dropping an invalid value per channel — verified against `ClassicTheme.ts`/`ModernTheme.ts`/`DarkTheme.ts`'s actual token values during this plan's own investigation, but not run in a browser. Manually confirm the classic theme's gradient still renders (not a solid colour, not blank) before treating this plan as done.
- **`WindowControlButton`'s `.pressed`/`:hover` extracts must supply all of Button's inherited keys, not just the ones being changed.** Omitting `foregroundColor`/`shadow` would silently blend in Button's generic raised pressed/hover look. `## Expected Behaviour` row 3 pins the full four-key/three-key content so a mistake here fails a test instead of only showing up as a live visual glitch.
- **Landing `TabCloseButton`'s change without `TabButton.ts`'s deletion (or vice versa) is safe but pointless** — the two are independent files, so either order works, but the duplication isn't fixed until both land (`_defaultTabCloseButtonOptions` gaining the values is inert while `buildCloseButton()` still overwrites them with identical literals; deleting the calls without widening the defaults bag would fall back to Button's generic chrome instead of `TabCloseButton`'s flattened one — land them together).

---

## Critical Files

| File | Why |
|---|---|
| [overlay/windowControls.ts](packages/lib/src/typescript/lib/overlay/windowControls.ts) | The whole window-control fix lands here |
| [component/menubar/MenuBarButton.ts](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts) | `ownClassStyleDefaults` (74) — precedent already in place; the `:hover` fix's edit site |
| [component/button/TabCloseButton.ts](packages/lib/src/typescript/lib/component/button/TabCloseButton.ts) | `_defaultTabCloseButtonOptions` (26-30), `ownClassStyleDefaults` (45) — the resting+hover fix's edit site |
| [component/button/TabButton.ts](packages/lib/src/typescript/lib/component/button/TabButton.ts) | `buildCloseButton` (318-358) — the deletion site is lines 325-332 within it; also `ownStyleStates` (177-197) and `applyTabStyling` (301-309) as the precedent this plan's TabCloseButton fix mirrors |
| [component/button/Button.ts](packages/lib/src/typescript/lib/component/button/Button.ts) | `applyChromeOptions` (942-1090, especially the chromeless branch 942-1048 and `pinPressedToResting` 2027-2041) — read in full before touching anything chromeless-adjacent; `ownStyleStates` (347-380) and `ownClassStyleDefaults` (328) as the base every fix here restates or extends; `setBackground`/`clearBackground` (619-642, confirms `background` shorthand can never be class-tier) |
| [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) | `applyOptions`/`applyChromeOptions` (696-799, the always-dispatch chrome-group mechanics this plan's TabCloseButton fix relies on), `styleRules` dispatch (758-768, the bypass being removed) — `Button.ts`'s own `setBackground`/`clearBackground` override (619-642, why `background` shorthand can't be class-tier) is listed on the `Button.ts` row above |
| [core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) | `resolveStateLevels` (per-level merge semantics `ownStyleStates` content resolution depends on) — confirms why `WindowControlButton`'s extracts must be complete, not partial |
| [plans/implemented/button-meta-class-dedup.md](implemented/button-meta-class-dedup.md) | The direct precedent for every mechanism this plan reuses (`ownStyleStates` widening, `TabButton`'s hover fix shape) — read in full first |
| [ARCHITECTURE.md](ARCHITECTURE.md) | *Component CSS tiers and state-rule dedup* and *The class tier is hierarchy-aware* — the specificity rules this plan's window-control redesign is built on |
| [core/themes/ClassicTheme.ts](packages/lib/src/typescript/lib/core/themes/ClassicTheme.ts), [ModernTheme.ts](packages/lib/src/typescript/lib/core/themes/ModernTheme.ts), [DarkTheme.ts](packages/lib/src/typescript/lib/core/themes/DarkTheme.ts) | `window.control` token values (confirms the gradient-vs-flat-colour split the two-channel background pattern depends on) |

---

## Non-Goals

- **`Button.pinPressedToResting()`'s per-instance `.pressed` pin for chromeless buttons that never customize their resting chrome** (`PickerButton`, `RailHandle`, `AccordionHeader`'s bare `chromeless: true` title button, and — separately from the `:hover` fix this plan makes — `MenuBarButton`'s own `.pressed` state). Investigated in depth; not fixed here.[^pin-out-of-scope]
- **`RailHandle`'s and `AccordionHeader`'s resting chrome duplication generally.** Both construct a bare `Button({chromeless: true, ...})` with no per-instance customization, the same shape `TabCloseButton` had — but neither was clearly evidenced in the live audit's six rows (unlike `TabCloseButton`, whose five-property resting combination is distinctive enough to be confidently attributed), and fixing them means the same "drop chromeless, declare real chrome" redesign this plan already does once for window-control buttons. A follow-up plan can extend the same pattern once live-audited.
- **Generic cross-component utility classes** (glyph icon sizes, `display:none`/`visibility:hidden`/`background-color:transparent` sharing across unrelated component types) — a separate, later planning round, per the task that produced this plan.
- **Anything `button-meta-class-dedup.md` already covers** — Button/ToggleButton/TabButton's own generic `.pressed`/`:hover`/`.selected`/`.flat` chrome.
- **Bumping the package version.** Release-time bookkeeping.

---

## Implementation Notes

`WindowControlButton`/`WindowLeadGlyphButton`'s constructors gained a
`subclassDefaults?: Partial<ButtonOptions>` parameter, spread over
`_defaultWindowControlOptions`/`_defaultWindowLeadGlyphOptions` before being
forwarded to `super()` — this plan's own `## Internal Structure` code sample
passed the module constant straight through instead. `local/no-raw-dom`'s
sibling lint rule `local/require-subclass-defaults` (ARCHITECTURE.md,
*Constructors forward `subclassDefaults`*) mechanically forbids a constructor
handing its `_default<Name>Options` constant straight to `super()`, since
that leaves no seam for a further subclass to layer its own default —
exactly the shape both new classes' constructors used. Neither class is
subclassed today, but the rule fires on the shape regardless of whether a
subclass currently exists, and carries no module-private exemption. Adding
the parameter is purely additive (both constructors are only ever called
with one argument today) and matches the same pattern `TabCloseButton`/
`MenuBarButton` already use, so this is a mechanical conformance fix, not a
design change.

**Manual verification (`## Verification`'s non-negotiable browser check) was performed** against a dev server started from this worktree (`npx vite --port 8016` from `packages/lib`, confirmed via `readlink /proc/<pid>/cwd`), driven live through `chrome-devtools` MCP tools, covering `## Expected Behaviour` rows 9-13 across all three shipped themes (modern, classic, dark) via the `packages/lib` demo app's Misc/MenuBar/Tab panels:

- A `Window`'s minimize/maximize/close controls (`WindowHeader`, via "Show window with image!") render correctly at rest, on hover, and pressed in all three themes; computed styles were read directly (`getComputedStyle`) to confirm resolved values, not just visual inspection. The classic theme's gradient — this plan's one flagged real cross-theme risk — was confirmed rendering as `linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200))` via `background-image` (not blank, not a solid colour), with `background-color` correctly falling back to transparent since a gradient function is not a valid `<color>`; the classic theme's hover (`linear-gradient(rgb(252, 252, 252), rgb(220, 220, 220))`) and pressed (`linear-gradient(rgb(200, 200, 200), rgb(214, 214, 214))`, `color: rgb(0, 0, 0)`) tokens were confirmed the same way. The modern theme's flat-colour token correctly resolves via `background-color` alone (`background-image: none`), and the dark theme likewise.
- Blurring a window (moving focus elsewhere) and refocusing it (`setWindowControlsActive`) was confirmed live: blur flattened the resting rule to `background-color: transparent; background-image: none` as a genuine per-instance deviation, and refocusing reverted it.
- `MenuBarButton`'s hover highlight (MenuBar panel, "File" menu item) was confirmed live via `getComputedStyle`/`:hover` matching.
- A closeable tab's ✕ (Tab panel, "Beta"/"Gamma" tabs) was confirmed at rest (`transparent`, `none`, `3px` radius, no border/shadow) and on hover (`rgba(0, 0, 0, 0.12)` tint) via `getComputedStyle`.
- `WindowLeadGlyphButton` (row 11, `TabWindow`'s leading title glyph) was **not** live-verified — no demo panel constructs a `TabWindow` (it is only ever created via a strip-mode tab tear-off drag gesture, per `layout/Tab.ts`'s `detachTabToWindow`), and reproducing that gesture through the MCP browser tools was judged disproportionate to the risk: unlike the window-control buttons, `_defaultWindowLeadGlyphOptions` (`windowControls.ts`) carries no theme token at all — every value (`"transparent"`, `"none"`, `"1px solid transparent"`) is a theme-independent literal, so there is no cross-theme rendering question to answer live that the unit test (`## Expected Behaviour` row 4, `WindowControlButton.classStyleHoisting.test.ts`) does not already settle offline.

---

## Notes

[^base-branch]: `button-meta-class-dedup.md` is fully implemented, but only on its own unmerged branch `feature/button-meta-class-dedup` — not yet on `master`. This plan's line numbers and code shapes are cited from that branch (verified identical to `master` for every file this plan itself touches — `windowControls.ts`, `WindowHeader.ts`, `MenuBarButton.ts`, `TabCloseButton.ts` — via `diff`; only `Button.ts`/`TabButton.ts`/`ToggleButton.ts` differ, and this plan's citations into those three come from the `feature/button-meta-class-dedup` branch specifically). The `depends-on` frontmatter reflects this: implement `button-meta-class-dedup` first (or merge it to whatever base this plan lands on), then this plan.

[^audit-tag-is-generic]: `StyleAuditPanel.componentClassName()` ([StyleAuditPanel.ts:52-54](packages/lib/src/typescript/StyleAuditPanel.ts#L52)) takes `Array.from(element.classList).find(cls => cls !== "ts-ui-component")` — the *first* non-marker class in DOM order, which for the whole `Button` family chain is always `"Button"` itself (the base class name), regardless of which concrete subclass actually built the element. The audit's `"component"` column is therefore uninformative about which subclass is responsible; it only confirms "some Button-family instance." This was verified by reading the function directly, not assumed — it is why this plan's own investigation had to trace root causes from source rather than trusting the audit's per-row component label.

[^why-not-flat-shape]: `.flat` (from `button-meta-class-dedup.md`) and `chromeless` are mutually exclusive by Button's own contract (`setFlat` warns and no-ops when the button is chromeless) — `.flat` buttons therefore never call `pinPressedToResting()` and never suppress isolation, so `.flat`'s `ensureSharedStateRule`-published class rule cleanly outranks nothing-competing. A chromeless button's bare-`#id` resting write and `pinPressedToResting()`'s bypass-comparison `.pressed` pin both target the exact same id-scoped rule a `.flat`-style shared class rule would need to outrank, and an id selector always outranks any number of chained classes — so the `.flat` mechanism cannot be reused as-is for a chromeless class. This was checked by reading `Button.applyChromeOptions`'s chromeless branch and `pinStateStyle` directly, not assumed from the `.flat` precedent's shape.

[^why-delete-not-keep]: `TabButton`'s own hover fix (`button-meta-class-dedup.md`) *keeps* `applyTabStyling`'s `setHoverBorder`/`setSelectedBorder` calls as a live caller-override seam, because `hoverBorder` has no `_defaultOptions` fold (`getHoverBorder()` returns a private field, not a folding getter) and so needs an explicit re-assert even for the default case. `TabCloseButton`'s eight calls have no such gap: every property they touch (`backgroundColor`, `backgroundImage`, `borderRadius`, `border`, `shadow`, `hoverBackgroundColor`, `hoverBackgroundImage`, `hoverShadow`) already always-dispatches from `_defaultOptions` through `Component.applyChromeOptions`'s base handler or `Button.applyChromeOptions`'s chromeful branch, so once those values live in `_defaultTabCloseButtonOptions`, the construction-time cascade applies them with no imperative call needed at all — keeping the calls would only reintroduce the exact per-instance duplication this plan removes, since a redundant `setHoverBackgroundColor(sameLiteral)` call still goes through the normal (deduping) `writeStateStyle` path and would correctly no-op, but the call itself is now dead code with no caller-override purpose (`TabCloseButton()` is always constructed with no options in `buildCloseButton()`, so there's no live "caller passed something different" case to preserve).

[^pin-out-of-scope]: `pinPressedToResting()` ([Button.ts:2027](packages/lib/src/typescript/lib/component/button/Button.ts#L2027)) deliberately writes via `pinStateStyle`, which bypasses the class-tier comparison entirely ("the point is to outrank the class rule even when the two values happen to coincide" — `Component.ts:5158-5163`). For a chromeless subclass whose resting chrome never varies per instance (`PickerButton`, `RailHandle`, a bare `AccordionHeader` title button), the pinned `.pressed` content — `foregroundColor`/`backgroundColor`/`backgroundImage`/`shadow`, all resolved from the instance's own resting getters — ends up byte-identical across instances, but `pinStateStyle`'s unconditional write means giving each such subclass its own matching `ownStyleStates` entry would not fix the duplication: the pin would still fire and write for real regardless, since it never compares against anything. Actually deduping this would mean changing `pinPressedToResting()` itself to use the normal, comparison-based `writeStateStyle` — safe in principle (a real per-instance deviation still fails the string-match check and writes for real either way; a matching value correctly resolves through the cascade either way, since the hierarchy-aware class tier guarantees a subclass's own rule is inserted after, and at equal specificity to, any ancestor's), but it is a change to a single, heavily-documented, cross-cutting method every chromeless `Button`-family instance in the codebase depends on for correctness — including subclasses not audited by this plan. The combined saving across the affected rows is the smallest of the ones this plan's own investigation found (well under half of the smallest row this plan does fix), so the risk of a shared-mechanism regression outweighs the benefit. Left as a candidate for a future plan that audits every chromeless call site first, rather than folded into this one on the strength of the four sites this plan happened to enumerate.
