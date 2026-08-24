---
touches-shared:
  - packages/lib/src/typescript/lib/component/button/Button.ts
  - packages/lib/src/typescript/lib/core/Component.ts
---

# Button Flat Chrome Dedup — Implementation Plan

## Overview

A live Style Audit capture found that the plain, resting-state `Button` class still duplicates real CSS across instances, despite [`plans/implemented/button-meta-class-dedup.md`](implemented/button-meta-class-dedup.md) (hoisted `.pressed`/`:hover`/`.selected` state chrome) and [`plans/implemented/button-variant-chrome-dedup.md`](implemented/button-variant-chrome-dedup.md) (turned four bypass-styled leaves into real declared-chrome subclasses) both landing. Fresh investigation — reading every method involved and empirically probing both the offline test harness and a live browser — found three distinct, sequential fixes, all inside `Button.ts`'s `flat: true` chrome path.

1. **`flat: true`'s resting chrome has no class-tier home.** [`Button._applyFlatChrome()`](packages/lib/src/typescript/lib/component/button/Button.ts#L2145) (lines 2145-2200) writes `border`, `borderRadius`, `shadow`, `backgroundImage`, and (conditionally) `backgroundColor` through per-instance setters every time a `Button`-family instance goes flat — `flat` is a runtime option on the base class, not a subclass, so there was never a natural class-tier bag to diff against. This is the largest single duplicate-rule group in the audit (~47 instances): `ToolBar`'s per-child buttons, `TableHeader`'s column-menu button, `Filter.ts`'s inline operator button, and `TabBar`'s descriptor tools all pay this cost independently.
2. **`Component.clearBackgroundImage()`'s second write bypasses resting-chrome isolation.** [`Component.clearBackgroundImage()`](packages/lib/src/typescript/lib/core/Component.ts#L2396) (lines 2396-2406) correctly caches the getter-facing clear through `writeStyle`, then asserts the CSS-facing neutral through the raw `setElementCSSRule` primitive instead of the isolation-aware `writeGuardedCSSRule` its sibling [`clearShadow()`](packages/lib/src/typescript/lib/core/Component.ts#L2709) already uses. On an isolated (chromeful) Button this lands the assertion on the bare `#id` rule, which always outranks the shared `.ClassName.pressed`/`:hover` rules — a resting write silently overpowering the pressed/hover cascade for that one property.
3. **`TableHeader`'s own column-menu button has unique chrome with nowhere class-tier to live.** [`Header.ts`](packages/lib/src/typescript/lib/component/table/Header.ts#L222) builds a bare `new Button({flat: true, compact: true, ...})` and then paints eight more properties on it imperatively (background, hover/pressed background, border, a divider shadow) — chrome specific to this one button, not shared with any other flat `Button`.

The three are ordered as separate, independently-revertable phases: fix 2 first (it changes behaviour wherever `clearBackgroundImage()` is already called, including inside fix 1's own target method), then fix 1 (the general flat-resting hoist), then fix 3 (the one-off subclass, which — as `## Architecture Decisions` explains — ends up *leaving* the `.flat` mechanism entirely rather than depending on fix 1's new rule).

---

## Architecture Decisions

### `clearBackgroundImage()` keeps its existing gate, only its write primitive changes

[`clearBackgroundImage()`](packages/lib/src/typescript/lib/core/Component.ts#L2396)'s `if (this._defaultOptions.backgroundImage) { this.setElementCSSRule("backgroundImage", "none"); }` becomes `if (this._defaultOptions.backgroundImage) { this.writeGuardedCSSRule("backgroundImage", "none"); }` — the *only* change is which primitive performs the write.[^why-not-full-mirror] `writeGuardedCSSRule` ([Component.ts:5608](packages/lib/src/typescript/lib/core/Component.ts#L5608)) falls back to `setElementCSSRule` when the instance isn't isolated (`isRestingChromeIsolated()` false — true for every non-Button-family `Component`, since isolation requires a non-empty `ownStyleStates`), so this is a no-op change for every caller outside the Button family. For an isolated, chromeful Button it now writes to the guarded `restingStyleRule` (`#id:not(.pressed)` or wider) instead of the bare `#id` rule, matching `clearShadow()`'s own routing.

### `Notification`'s close button needs the hover/pressed background-image clears `Dialog`'s already has

Fixing `clearBackgroundImage()` changes real behaviour for exactly one already-shipped, non-flat caller: a plain `new Button({glyph: "xmark"})` — used by both [`Dialog`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L232)'s and [`Notification`](packages/lib/src/typescript/lib/overlay/Notification.ts#L205)'s close buttons — is chromeful (not chromeless, not flat) and therefore isolated. Once its resting `clearBackgroundImage()` call lands on the guarded rule instead of the bare `#id` rule, that rule stops matching while `.pressed`/`:hover` are active, and the cascade falls through to `.Button.pressed`/`.Button:hover:not(.pressed)`'s own `backgroundImage` — a real gradient in the classic theme (`theme.button.pressed.background` / `theme.button.hover.background` in [`ClassicTheme.ts:31-39`](packages/lib/src/typescript/lib/core/themes/ClassicTheme.ts#L31)).

`Dialog`'s close button already guards against exactly this: it calls `clearHoverBackgroundImage()` and `clearPressedBackgroundImage()` ([Dialog.ts:247-248](packages/lib/src/typescript/lib/overlay/Dialog.ts#L247)) — the state-tier clears, a different, already-isolation-correct mechanism (`pinStateStyle`/`writeStateStyle`, unaffected by this plan). `Notification`'s close button does not call either ([Notification.ts:205-215](packages/lib/src/typescript/lib/overlay/Notification.ts#L205)) — it only clears the resting image and shadow. Today that gap is invisible only because `clearBackgroundImage()`'s bug happens to mask it (the bare `#id` write always wins, hiding the pressed/hover gradient regardless). Fixing the bug without also closing this gap would make `Notification`'s ✕ start showing a raised gray gradient on hover/press. `Notification.ts` therefore gains the same two calls `Dialog.ts` already has, added as part of this same step (not a separate phase — it exists only to keep step 1's fix regression-free).[^clearbackgroundcolor-same-shape]

### Flat's resting chrome gets a shared `.ClassName.flat` rule, the resting-tier twin of the already-shipped `.flat.pressed`/`.flat:hover` mechanism

`button-meta-class-dedup.md` already solved this exact problem for flat's *pressed*/*hover* chrome: since `flat` is a per-instance flag on the base class rather than its own subclass, `.pressed`/`:hover`'s per-concrete-class `ownStyleStates` bag can't carry two different contents for one class. Its fix was a second, always-chained DOM class token (`.flat`) plus `ensureSharedStateRule(".flat.pressed", …)` / `ensureSharedStateRule(".flat:hover:not(.pressed)", …)`, published once per concrete class and never written per-instance again. This plan applies the identical mechanism one tier down, to the *resting* declarations: a new `ensureSharedStateRule(".flat", BUTTON_FLAT_RESTING_DECLARATIONS)` call, and the five setter/clear calls in `_applyFlatChrome()` that currently write these values per-instance are deleted.

`.Button.flat` sits at specificity `(0,2,0)` — one chained class more than `.Button` `(0,1,0)`, so it always overrides the raised default regardless of insertion order, the same strictly-higher-specificity argument the pressed/hover fix already established.[^specificity-not-order-reuse] `ensureSharedStateRule`/`ensureClassStateRule` publishes once per `(concrete class, suffix)` pair with no comparison against any lower tier ([`ClassStyleRules.ts:1028`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1028) — "there is no framework-level tier beneath a state rule to diff against"), so `ToggleButton`/`TabButton`/`SpinButton`/every other flat instance in the codebase gets this fix automatically through inheritance — no change needed to any file but `Button.ts`.

The five declarations, verified against the current literal values in `_applyFlatChrome()`:

| Key | Value | Source in current `_applyFlatChrome()` |
|---|---|---|
| `border` | `"1px solid transparent"` | `this.setBorder("1px solid transparent")` |
| `shadow` | `"none"` | `this.clearShadow()` |
| `backgroundImage` | `"none"` | `this.clearBackgroundImage()` |
| `backgroundColor` | `"transparent"` | the conditional `this.setBackgroundColor("transparent")` |
| `borderRadius` | *(omitted — see next decision)* | `this.clearBorderRadius()` |

The conditional guard around today's `setBackgroundColor("transparent")` call (`if (restingBackground === null || restingBackground === classDefault)`) is dropped, not ported: a caller who set a genuine custom resting `backgroundColor` before flat runs has that value isolated on `#id:not(.pressed)` `(1,1,0)`, which still outranks `.Button.flat` `(0,2,0)` regardless — the cascade already produces the same "caller's colour wins, default flattens to transparent" outcome without the runtime branch.

### `borderRadius` is deliberately excluded from the shared `.flat` rule

`clearBorderRadius()`'s current effect on a flat `Button` was checked directly — both by tracing `flushStyleBag`'s per-key comparison and by reading the actual queued declarations in the offline test harness — and confirmed live in a running browser: `getComputedStyle(flatButton).borderRadius` reports `"4px"`, `.Button`'s own raised default, not `"0"`. `clearBorderRadius()` writes a plain `null` removal (no "assert the neutral" second write, unlike `clearBackgroundColor`/`clearBackgroundImage`/`clearShadow`), and a removal on `#id` simply leaves nothing there for that property, so `.Button`'s own class-tier `border-radius: var(--ts-ui-border-radius, 4px)` shows through uncontested. This is a pre-existing, unrelated quirk in already-shipped code — not something this plan's brief asks it to fix, and fixing it would be a real, unplanned visual change (flat buttons gaining square corners) on top of a dedup change. The shared `.flat` rule simply omits `borderRadius` (an omitted key on a class-tier rule and a `null` removal on a per-instance rule produce the identical cascade outcome), and the `clearBorderRadius()` call in `_applyFlatChrome()` is deleted outright rather than replaced — deleting a call whose effect is already a no-op costs nothing.[^borderradius-live-proof]

### Accepted consequence: flat buttons' pressed/hover border colour swap, previously masked, now shows

`border` is not part of `restingIsolationKeys()` (`Button.ownStyleStates`' `.pressed`/`:hover` extracts never declare `border`), so today's `_applyFlatChrome()` writes `"1px solid transparent"` straight to the bare, unguarded `#id` rule. An unguarded `#id` rule always matches, at every state, and always outranks any number of chained classes — so it has been permanently overriding `.Button.flat.pressed`/`.Button.flat:hover:not(.pressed)`'s own border-colour declarations (`BUTTON_FLAT_PRESSED_DECLARATIONS.border` / `BUTTON_FLAT_HOVER_DECLARATIONS.border`, [Button.ts:251-264](packages/lib/src/typescript/lib/component/button/Button.ts#L251)) since the day those rules shipped — confirmed live: forcing `.pressed` on a flat `Button` today shows the flat sunken background/shadow but `border-top-color` stays `rgba(0,0,0,0)`, unchanged from rest.

Once the resting border write moves to `.Button.flat` (0,2,0, unguarded — matches at every state exactly like the bare `#id` rule did) and the per-instance write is deleted, `.Button.flat.pressed`/`.Button.flat:hover:not(.pressed)` (0,3,0 / 0,4,0 respectively) are the only remaining higher-specificity declarations for that property, so their border colour finally applies. This matches `_applyFlatChrome()`'s own existing code comment ("the hover/pressed rules below only swap the border colour") — realising an already-documented intent, not introducing a new one — but it is still a real, live-visible change and needs a manual before/after check (`## Expected Behaviour`, manual row).

### Accepted consequence: five resting getters on a flat Button stop reporting the flat token

`getBorder()` / `getBorderRadius()` / `getShadow()` / `getBackgroundImage()` / `getBackgroundColor()` read `resolveStyleValue(key)`, which walks the instance and class layers — never a shared state-suffix rule like `.Button.flat`. Once these five values live only on `.Button.flat` and nothing is written to the instance layer any more, these getters on a flat instance fall through to `.Button`'s own (non-flat) class default. This is the identical, already-accepted tradeoff `button-meta-class-dedup.md` documented for the five pressed/hover getters when flat's *pressed*/*hover* chrome made the same move — same cause, same shape, extended to the resting tier. The rendered CSS is unaffected either way; only these getters' return value on a flat instance changes.

### `TableHeader`'s column-menu button becomes a real declared-chrome subclass, and drops `flat: true`

`Header.ts` builds its column-menu button with `flat: true` and then immediately overrides nearly everything flat chrome would otherwise supply: its own opaque `TABLE_HEADER_BG` background (not flat's transparent), its own hover/pressed backgrounds, a full `clearBorder()`/`clearHoverBorder()`/`clearPressedBorder()` (not flat's transparent frame), and its own permanent inset-shadow divider (not flat's hover/pressed shadow swap). `compact: true` is also set, and `Button._resolveInsets()`'s own branch order (`compact && glyphOnly` is checked before `flat && glyphOnly`) means compact alone already drives this button's insets — `flat` contributes nothing to its sizing. `flat` is therefore vestigial on this specific button: every cosmetic effect it would produce is immediately painted over, and its one non-cosmetic effect (sizing) never fires. This mirrors exactly why `button-variant-chrome-dedup.md` dropped `chromeless: true` from the window-control buttons rather than keep it alongside a real subclass: a bare `#id`-level bypass (`chromeless`'s isolation-suppressed writes, or here `flat`'s own shared-but-still-per-instance-overridden chrome) can never be the class-tier home a dedup fix needs, so the button becomes a plain, declared-chrome `TableHeaderMenuButton extends Button` — no `flat`, no `chromeless` — with its own `ownClassStyleDefaults` (resting) and `ownStyleStates` (`.pressed`/`:hover`), module-private inside `Header.ts` (mirroring `WindowControlButton`'s placement inside `windowControls.ts`).

`border` needs no entry in `TableHeaderMenuButton.ownStyleStates`: neither Button's own `.pressed`/`:hover` extract nor this subclass's extract declares it, so the class's single, unguarded resting `border: "none"` (from `ownClassStyleDefaults`) is the only declaration for that property at any state — it already matches every one of the current `clearBorder()`/`clearHoverBorder()`/`clearPressedBorder()` calls, which all clear to the same value today.

### The new subclass's hover/pressed background finally shows the colours `Header.ts` already intended

`Header.ts` explicitly calls `setPressedBackgroundColor(pressedBg)`/`setHoverBackgroundColor(hoverBg)` where `pressedBg`/`hoverBg` are the literal strings `"var(--ts-ui-button-pressed-bg, rgb(200, 200, 200))"` / `"var(--ts-ui-button-hover-bg, rgb(252, 252, 252))"` — which are byte-identical to `_defaultButtonOptions.pressedBackgroundColor`/`.hoverBackgroundColor`, Button's own generic raised defaults. Because the value matches the class default, the per-instance write is deduped to a removal, and — since this button still carries `flat`'s own more specific `.Button.flat.pressed`/`.Button.flat:hover:not(.pressed)` rules — those win instead. Confirmed live: forcing `.pressed` on this button today shows `background-color: rgba(0, 0, 0, 0.1)` (flat's own translucent token), not `rgb(200, 200, 200)` (`pressedBg`). `Header.ts`'s own comment states the intent plainly ("swap in the *non-flat* hover/pressed tokens for the usual darker-on-press look") — this button's whole reason for existing as a bespoke instance was to reject flat's translucent overlay in favour of the opaque `pressedBg`/`hoverBg` tokens, and today it silently fails to. Declaring `pressedBg`/`hoverBg` directly in the new subclass's `ownStyleStates` — with no competing `.flat` rule anywhere in the picture, since the subclass carries no `flat` state at all — makes that intent finally hold. This is a real, live-visible colour change (from a faint dark overlay to a light gray tint) and is called out for manual verification rather than folded silently into "just a dedup."

`shadow` is pinned to the same divider constant in both `.pressed` and `:hover`, for the identical "don't leak Button's generic entry"reason `button-variant-chrome-dedup.md`'s `WindowControlButton` pins `pressedForegroundColor`/`pressedShadow`: without an explicit override, `ownStyleStates`' merge (`ARCHITECTURE.md`, *Component CSS tiers and state-rule dedup*, "Content... is a per-level merge") would let Button's raised `pressedShadow`/`hoverShadow` leak in unopposed, replacing the divider on every press/hover — confirmed live as today's actual (flat-driven) behaviour. Pinning the divider's own shadow keeps it a *permanent* visual feature. `foregroundColor` is left undeclared, on purpose: today's button never customizes it at any state (flat doesn't touch foreground colour), so it already inherits Button's generic raised `pressedForegroundColor` at rest-to-pressed and nothing at rest-to-hover — the new subclass reproduces that by omission, matching today exactly.

---

## Public API

No exported symbol changes. `TableHeaderMenuButton` is module-private (not exported, not wrapped in `callable()`), mirroring `WindowControlButton`. `TableHeader.getMenuButton()` keeps its existing `Button` return type.

```typescript
// component/table/Header.ts — new module-private class, not exported.
class TableHeaderMenuButton extends Button {
    protected static readonly ownClassStyleDefaults: StyleBag;
    protected static readonly ownStyleStates: readonly StyleStateSpec[];

    constructor(onAction: () => void, subclassDefaults?: Partial<ButtonOptions>);
}
```

---

## Internal Structure

### `core/Component.ts` — `clearBackgroundImage()`'s one-line fix

```typescript
clearBackgroundImage(): this {
    // Same reasoning as `clearBackgroundColor`: a defaulting class would
    // repaint through a bare removal, so assert the CSS initial value —
    // routed through the resting-isolation-aware escape hatch (not the raw
    // `setElementCSSRule` bypass) so an isolated Button-family instance gets
    // the assertion on its guarded rule, not the bare `#id` rule. See
    // plans/button-flat-chrome-dedup.md.
    this.writeStyle({ backgroundImage: null });

    if (this._defaultOptions.backgroundImage) {
        this.writeGuardedCSSRule("backgroundImage", "none");
    }

    return this;
}
```

### `overlay/Notification.ts` — the two added clears

Insert immediately after the existing `this._closeButton.clearBackgroundImage();` call ([Notification.ts:208](packages/lib/src/typescript/lib/overlay/Notification.ts#L208)):

```typescript
this._closeButton.clearHoverBackgroundImage();
this._closeButton.clearPressedBackgroundImage();
```

### `component/button/Button.ts` — the shared flat-resting declarations

Placed near `BUTTON_FLAT_PRESSED_DECLARATIONS`/`BUTTON_FLAT_HOVER_DECLARATIONS` ([Button.ts:251](packages/lib/src/typescript/lib/component/button/Button.ts#L251)):

```typescript
/**
 * Shared `.flat` resting declarations, published once via `ensureSharedStateRule`
 * from `_applyFlatChrome` — the resting-tier twin of
 * `BUTTON_FLAT_PRESSED_DECLARATIONS`/`BUTTON_FLAT_HOVER_DECLARATIONS` above.
 * `borderRadius` is deliberately absent — see
 * plans/button-flat-chrome-dedup.md's Architecture Decisions for why.
 */
const BUTTON_FLAT_RESTING_DECLARATIONS: StyleBag = {
    border:          "1px solid transparent",
    shadow:          "none",
    backgroundImage: "none",
    backgroundColor: "transparent",
};
```

### `component/button/Button.ts` — `_applyFlatChrome()`'s new body

Replaces the whole method body from the `this.setBorder(...)` call through the conditional `setBackgroundColor` block (current lines 2154-2182), keeping the `.flat` toggle and the two existing `ensureSharedStateRule` calls unchanged:

```typescript
private _applyFlatChrome(): void {
    // Flat's resting chrome never varies per instance, so — like its
    // pressed/hover chrome above — it is published once as a shared
    // `.flat` class rule instead of five per-instance setter/clear calls.
    // See `## Architecture Decisions` in plans/button-flat-chrome-dedup.md.
    this.setStyleState(".flat", true);
    this.ensureSharedStateRule(".flat", resolvePartialDeclarations(BUTTON_FLAT_RESTING_DECLARATIONS));
    this.ensureSharedStateRule(".flat.pressed",             resolvePartialDeclarations(BUTTON_FLAT_PRESSED_DECLARATIONS));
    this.ensureSharedStateRule(".flat:hover:not(.pressed)", resolvePartialDeclarations(BUTTON_FLAT_HOVER_DECLARATIONS));

    this._resolveInsets();
}
```

Everything else in the method (the doc comment above it, `_resolveInsets()`'s own call) is otherwise unchanged; only the doc comment's description of what the method does needs updating to describe the new shared-rule mechanism instead of per-instance writes.

### `component/table/Header.ts` — `TableHeaderMenuButton`

Placed after the existing module-level constants (`MENU_BUTTON_GLYPH`, `MENU_BUTTON_LABEL`, `MENU_BUTTON_CHROME_PX`, `MENU_BUTTON_Z_INDEX`, `TABLE_HEADER_BG`), which stay where they are:

```typescript
/** Left-edge divider — an inset shadow rather than a border, since flat
 *  chrome's own 1px transparent border reservation was removed along with
 *  the rest of flat mode; see the class's own doc comment. */
const MENU_BUTTON_DIVIDER_SHADOW = "inset 1px 0 0 0 var(--ts-ui-table-resize-handle-color, rgba(0, 0, 0, 0.2))";

/** Non-flat hover/pressed background tokens — see the class's own doc
 *  comment for why these, not flat's generic translucent overlay, are
 *  the intended look. */
const MENU_BUTTON_HOVER_BG   = "var(--ts-ui-button-hover-bg, rgb(252, 252, 252))";
const MENU_BUTTON_PRESSED_BG = "var(--ts-ui-button-pressed-bg, rgb(200, 200, 200))";

const _defaultTableHeaderMenuButtonOptions: Partial<ButtonOptions> = {
    border:          "none",
    borderRadius:    undefined,   // explicit key wins over Button's own default in the subclassDefaults spread merge — mirrors WindowControlButton's/TabCloseButton's identical trick.
    backgroundColor: TABLE_HEADER_BG,
    backgroundImage: TABLE_HEADER_BG,
    shadow:          MENU_BUTTON_DIVIDER_SHADOW,
};

/**
 * The table header's column-options menu trigger. A real declared-chrome
 * subclass rather than a bare `Button({flat: true, ...})` with imperative
 * overrides — see plans/button-flat-chrome-dedup.md's Architecture
 * Decisions for why `flat` was dropped, and why the hover/pressed
 * backgrounds below are the tokens `Header.ts` always intended (previously
 * masked by flat's own more-specific state rules). Module-private, not
 * exported, not wrapped in `callable()` — same treatment as
 * `WindowControlButton` in `windowControls.ts`.
 */
class TableHeaderMenuButton extends Button {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultTableHeaderMenuButtonOptions;

    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => ({
                backgroundColor: MENU_BUTTON_PRESSED_BG,
                backgroundImage: MENU_BUTTON_PRESSED_BG,
                shadow:          MENU_BUTTON_DIVIDER_SHADOW,
            }),
        },
        {
            selector: ":hover",
            extract: (): StyleBag => ({
                backgroundColor: MENU_BUTTON_HOVER_BG,
                backgroundImage: MENU_BUTTON_HOVER_BG,
                shadow:          MENU_BUTTON_DIVIDER_SHADOW,
            }),
        },
    ];

    constructor(onAction: () => void, subclassDefaults?: Partial<ButtonOptions>) {
        super(
            undefined,
            {
                glyph:     MENU_BUTTON_GLYPH,
                text:      MENU_BUTTON_LABEL,
                showText:  false,
                compact:   true,
                zIndex:    MENU_BUTTON_Z_INDEX,
                listeners: { action: onAction },
            },
            { ..._defaultTableHeaderMenuButtonOptions, ...(subclassDefaults ?? {}) },
        );
        this.pinGlyphSize(Math.max(1, TRACK_WIDTH - MENU_BUTTON_CHROME_PX));
        this.getAria().setHasPopup("menu");
    }
}
```

### `component/table/Header.ts` — the constructor site shrinks

Replaces the whole block from `const glyphPx = ...` through `super.addComponent(this._menuButton);` ([Header.ts:220-273](packages/lib/src/typescript/lib/component/table/Header.ts#L220)):

```typescript
this._menuButton = new TableHeaderMenuButton(this._boundOnMenuButtonAction);
super.addComponent(this._menuButton);
```

`getMenuButton()` ([Header.ts:618](packages/lib/src/typescript/lib/component/table/Header.ts#L618)) and `onMenuButtonAction()` ([Header.ts:631](packages/lib/src/typescript/lib/component/table/Header.ts#L631)) are untouched.

---

## Ordered Implementation Steps

**Phase 1 — `clearBackgroundImage()`'s isolation bypass (issue 2)**

1. **`core/Component.ts` — fix `clearBackgroundImage()`.** Replace the `setElementCSSRule` call with `writeGuardedCSSRule`, per `## Internal Structure`. Do not touch the surrounding `if` condition or the preceding `writeStyle` call.
   *Check:* `npm run typecheck`.
2. **`overlay/Notification.ts` — add the two missing state clears.** Insert `clearHoverBackgroundImage()`/`clearPressedBackgroundImage()` right after the existing `clearBackgroundImage()` call, per `## Internal Structure`.
   *Check:* `npm run typecheck`.
3. **New test case in `packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts`.** Add a case mirroring the file's own existing "row 3" shape ("a deviating resting backgroundColor lands on `#id:not(.pressed):not(:hover)`, not the bare `#id` rule"): construct a chromeful `Button`, call `setBackgroundImage("red")` then `clearBackgroundImage()` after render, and assert the `"none"` assertion is recorded on `idSelector(button) + ':not(.pressed):not(:hover)'` (or whatever `restingGuardSuffix` currently resolves to for `Button` — read it fresh, don't assume the suffix string), and that no `backgroundImage` write reaches the bare `idSelector(button)` rule.
   *Check:* `npx vitest run tests/component/button/Button.restingChromeIsolation.test.ts` from `packages/lib`.
4. **Regression checkpoint — existing tests must pass unchanged.** `npx vitest run tests/core/ClassChromeRules.test.ts` — rows 9-12 (`clearBackgroundColor`/`clearBackgroundImage`/`clearShadow`/`clearBorder`, all on plain, non-isolated `Component` subclasses) must all still pass with zero edits to that file; they exercise the `writeGuardedCSSRule` → `setElementCSSRule` fallback path, which is unchanged for a non-isolated instance. If any of them fail, the fix has drifted from the minimal, gate-preserving shape in `## Internal Structure` — do not "fix" the test to match a wider change.

**Phase 2 — flat's resting chrome hoist (issue 1)**

5. **`component/button/Button.ts` — add `BUTTON_FLAT_RESTING_DECLARATIONS`.** Per `## Internal Structure`, placed near the two existing flat-state constants.
6. **`component/button/Button.ts` — rewrite `_applyFlatChrome()`.** Delete the current body from `this.setBorder("1px solid transparent")` through the conditional `setBackgroundColor("transparent")` block ([Button.ts:2154-2182](packages/lib/src/typescript/lib/component/button/Button.ts#L2154)); replace with the three-line block in `## Internal Structure` (the `.flat` toggle, the new resting `ensureSharedStateRule` call, then the two existing pressed/hover calls). Update the method's own doc comment to describe the shared-rule mechanism.
   *Check:* `npm run typecheck`. `grep -n 'this\.setBorder\|this\.clearBorderRadius\|this\.clearShadow\|this\.clearBackgroundImage' packages/lib/src/typescript/lib/component/button/Button.ts` — none of these appear inside `_applyFlatChrome` any more (they still appear in `applyChromeOptions`, `_clearChrome`, `_restoreChrome`, and the setter bodies themselves — unaffected).
7. **Extend `packages/lib/tests/component/button/Button.flatStateClassHoisting.test.ts`** with the resting-tier cases from `## Expected Behaviour` (rows 4-8 below). Reuse the file's existing `declarationsDuring`/`idSelector` helpers and warm-up convention.
   *Check:* `npx vitest run tests/component/button/Button.flatStateClassHoisting.test.ts` from `packages/lib`.
8. **`packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts` row 11 — re-verify, don't rewrite.** Row 11 ("`setFlat(true)` writes no per-instance pressed declarations…") already exercises the pressed/hover half of flat chrome and should be unaffected by this phase; run it to confirm, and only edit it if it fails — it does not test the resting tier this phase changes.
   *Check:* `npx vitest run tests/component/button/Button.restingChromeIsolation.test.ts` from `packages/lib`.
9. **Full button suite.** `npx vitest run tests/component/button` from `packages/lib` — `ToggleButton`/`TabButton`/`SpinButton`'s own flat-mode tests (if any construct a flat instance) must stay green with no source change in those three files, confirming the fix is inherited automatically.

**Phase 3 — `TableHeaderMenuButton` (issue 3)**

10. **`component/table/Header.ts` — imports.** Widen the existing `Button` import to `import { Button, ButtonOptions } from "~/component/button/Button.js";`. Add `import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";`.
11. **`component/table/Header.ts` — add the three new module-level constants and `TableHeaderMenuButton`.** Per `## Internal Structure`, placed after the existing `TABLE_HEADER_BG` constant.
    *Check:* `npm run typecheck`.
12. **`component/table/Header.ts` — shrink the constructor site.** Replace the block from `const glyphPx = ...` through `super.addComponent(this._menuButton);` with the two-line replacement in `## Internal Structure`. Leave `getMenuButton()` and `onMenuButtonAction()` untouched.
    *Check:* `npm run typecheck`.
13. **Regression checkpoint — the existing menu-button test file must pass unchanged.** `npx vitest run tests/component/table/HeaderMenuButton.test.ts` from `packages/lib` — every existing case (child indices, geometry, `getBorder()`/`getHoverBorder()`/`getPressedBorder()`, aria label/popup, the click-dispatch case) should pass with **zero edits to that file** — this is the concrete evidence the redesign is behaviour-preserving at the public-API level. If any case fails, the subclass's chrome doesn't match today's values — re-derive from `## Architecture Decisions`' tables rather than adjusting the test.
14. **New test file `packages/lib/tests/component/table/HeaderMenuButtonChromeHoisting.test.ts`.** Covers `## Expected Behaviour` row 9 below (the new subclass's own class-tier dedup and its corrected hover/pressed background). Copy the `installTestDOM`/`Table`/`MemoryStore` preamble from `HeaderMenuButton.test.ts`.
    *Check:* `npx vitest run tests/component/table/HeaderMenuButtonChromeHoisting.test.ts` from `packages/lib`.
15. **Full table suite.** `npx vitest run tests/component/table` from `packages/lib`.

**Phase 4 — whole-suite verification and documentation**

16. **`packages/lib/docs/reference/changelog/next.md`** — add the entries described in `## Documentation Impact`.
17. **Full suite.** `npm test` from `packages/lib`. `npm run lint` and `npm -w packages/lib run test:lint` — the `local/no-raw-dom` and `local/require-subclass-defaults` baselines stay empty (this plan adds no raw DOM access and `TableHeaderMenuButton`'s constructor already forwards `subclassDefaults`).
18. **Manual verification.** See `## Verification` — non-negotiable given the live-visible changes this plan documents in `## Architecture Decisions`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Notification.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Header.ts` |
| Modify | `packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts` |
| Modify | `packages/lib/tests/component/button/Button.flatStateClassHoisting.test.ts` |
| Create | `packages/lib/tests/component/table/HeaderMenuButtonChromeHoisting.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-9 are unit-testable offline (`RecordingDOMSink`, `declarationsDuring`/`idSelector` helpers already present in the relevant test files). Rows 10-13 need a live browser.

**Issue 2 — `clearBackgroundImage()` isolation**

1. A chromeful `Button` with a deviating resting `backgroundImage`, cleared after render, writes the `"none"` assertion to its guarded resting rule (`#id:not(.pressed)` or wider), never to the bare `#id` rule.
2. A plain (non-Button-family) `Component` subclass — no `ownStyleStates` — is unaffected: `clearBackgroundImage()` still writes to the bare `#id` rule exactly as before, in both the "class defaults a real value" and "class defaults nothing" cases (`ClassChromeRules.test.ts` rows 9-12, unmodified, must still pass).
3. `Notification`'s close button, hovered or pressed, shows no background-image gradient — matching `Dialog`'s close button and matching today's (bug-masked) appearance.

**Issue 1 — flat resting chrome**

4. A default flat `Button`, rendered after a first flat `Button` has warmed the shared rule, writes no `border`/`backgroundColor`/`backgroundImage`/`boxShadow` declarations of its own to its `#id` (bare) or isolated resting rule; `.Button.flat` exists in the rule cache carrying `border-*: "1px solid transparent"`, `background-color: "transparent"`, `background-image: "none"`, `box-shadow: "none"` — and no `border-radius` key.
5. A second flat `Button` writes nothing further to `.Button.flat` (dedup, mirroring `Button.flatStateClassHoisting.test.ts`'s existing "row 6" assertion shape for `.flat.pressed`).
6. `getBorder()` / `getBorderRadius()` / `getShadow()` / `getBackgroundImage()` / `getBackgroundColor()` on a flat `Button` report `.Button`'s own (non-flat) class default, not the flat token — pin this as a regression guard, per the documented accepted consequence.
7. A caller who calls `setBorder(...)`/`setBackgroundColor(...)` explicitly on an already-flat `Button` still writes for real (a genuine per-instance deviation from both the class default and `.flat`'s shared value).
8. A flat `ToggleButton` and a flat `TabButton` each get their own separate `.ToggleButton.flat` / `.TabButton.flat` rule (per-concrete-class keying, same pattern the existing `.flat.pressed`/`.flat.selected` tests already pin for those two classes).

**Issue 3 — `TableHeaderMenuButton`**

9. A second `TableHeader`'s menu button (constructed after a first `TableHeader` has warmed the class rule) writes no real declaration of its own to its `#id` rule; `.TableHeaderMenuButton` exists in the rule cache carrying `border: "none"`, `background-color`/`background-image` resolving to `TABLE_HEADER_BG`, `box-shadow` resolving to the divider shadow. `.TableHeaderMenuButton.pressed` carries `background-color`/`background-image` resolving to `MENU_BUTTON_PRESSED_BG` and `box-shadow` resolving to the same divider shadow (not Button's generic raised pressed shadow); `.TableHeaderMenuButton:hover:not(.pressed)` carries the hover-token equivalents.

**Manual verification** (`npm run dev`, http://localhost:8015; a Table demo window — "Show window with table (slow)!" on the Misc panel — for issue 3; the Buttons/ToolBar/Tab demo sections for issue 1)

10. A flat `ToolBar` button, a flat `TabBar` descriptor tool, and any other flat button in the demo app render identically to before this plan at rest, on hover, and pressed — background/shadow unchanged — **except** the border colour, which now visibly (if subtly) shifts between the flat resting/hover/pressed tokens where it previously stayed transparent throughout. Confirm this reads as a minor, acceptable refinement, not a visual defect.
11. The table's column-menu button (the small trigger above the vertical scrollbar) renders with the same size, position, glyph, and left divider as before. Its hover and pressed backgrounds now show as a light gray tint (`rgb(252, 252, 252)` / `rgb(200, 200, 200)`) instead of today's faint dark translucent overlay — confirm this reads as an improvement consistent with the surrounding header chrome, not a regression.
12. Clicking the column-menu button still opens the column menu in the same place; hovering still shows the "Column options" tooltip.
13. Open the Style Audit panel after visiting the Buttons/ToolBar/Tab/Table sections, and confirm the flat-resting duplicate-rule group from this plan's `## Overview` no longer appears (or appears with much lower "wasted KB").

---

## Verification

Run from the repo root unless noted.

- `npm run typecheck` — after every step.
- `npm test` from `packages/lib` (`typecheck:test` + `vitest run`) — full suite green.
- `npm run lint` and `npm -w packages/lib run test:lint` — `local/no-raw-dom` and `local/require-subclass-defaults` baselines stay empty.
- `npm run docs:api` — zero warnings (no public API surface changes, but comment edits could accidentally introduce a broken `{@link}`).
- Grep invariant: `grep -n 'this\.setBorder\|this\.clearBorderRadius\|this\.clearShadow\|this\.clearBackgroundImage' packages/lib/src/typescript/lib/component/button/Button.ts` — zero matches inside `_applyFlatChrome`'s body.
- Grep invariant: `grep -n 'flat' packages/lib/src/typescript/lib/component/table/Header.ts` — no `flat: true`/`setFlat` call remains (the constant names `MENU_BUTTON_*` are fine; only an actual flat dispatch is disallowed).
- **Manual browser verification is required** (`## Expected Behaviour` rows 10-13). Start a dev server on a spare port from *this worktree*, confirmed via `readlink /proc/<pid>/cwd` — not the main tree's server, which serves different source.

---

## Documentation Impact

No exported symbol added, removed, or changed in signature. `TableHeaderMenuButton` is module-private. `typedoc.json`, the barrels, and `packages/lib/llms.txt` are unaffected.

- `packages/lib/docs/reference/changelog/next.md`, `## Fixed` → `### Core`: `Component.clearBackgroundImage()` now respects a Button-family instance's resting-chrome isolation instead of writing straight to the bare instance rule — fixes a latent bug where a Button's pressed/hover background-image could be silently overridden by its own resting clear (visible today on `Notification`'s close button once this fix lands; masked before it).
- `## Fixed` → `### Components`: the shared stylesheet now dedupes flat Buttons' resting chrome (border, shadow, background) onto one rule per class, matching the pressed/hover dedup already shipped; a flat Button's border colour now correctly changes on hover/press (previously always transparent, regardless of state); the table header's column-menu button's hover/pressed background now shows the intended light-gray tint instead of a translucent overlay.
- `## Changed` → `### Components`: `getBorder()` / `getBorderRadius()` / `getShadow()` / `getBackgroundImage()` / `getBackgroundColor()` on a flat `Button` now report the non-flat class default rather than the flat token — the actual rendered chrome is unaffected, only what these getters report.

---

## Potential Challenges

- **Landing phase 1 after phase 2 would silently undo part of the fix.** If `_applyFlatChrome()`'s rewrite (phase 2) landed first, its own `clearBackgroundImage()` call would already be deleted by the time phase 1's fix arrives — harmless for flat buttons specifically, but it would mean phase 1 was never exercised by the method this plan's own investigation used to find it. Landing phase 1 first, as ordered, means its regression test (step 3) actually exercises live code, and phase 2's rewrite then deletes that exercised call site as an unrelated simplification.
- **The `Notification` fix is easy to skip because nothing currently fails without it.** Today's bug masks the exact gap phase 1 exposes. Step 2 must land in the same phase as step 1, not be deferred — `## Architecture Decisions`' reasoning only makes sense read together with the fix it's patching.
- **`TableHeaderMenuButton`'s hover/pressed background is a genuine, if minor, visual change**, not a pure refactor — `## Expected Behaviour` row 11 is the gate; if the new light-gray tint reads wrong against the surrounding header chrome in a shipped theme, that is a real finding to report, not a test to loosen.
- **A `TableHeaderMenuButton` accidentally left `flat: true`** would immediately reintroduce the exact background-masking bug this plan documents living, since `.flat.pressed`/`.flat:hover` are more specific than any subclass's own two-class state rules. The grep invariant in `## Verification` guards against this landing silently.

---

## Critical Files

| File | Why |
|---|---|
| [component/button/Button.ts](packages/lib/src/typescript/lib/component/button/Button.ts) | `_applyFlatChrome` (2145-2200), `setFlat`/`isFlat` (2051-2100), `ownStyleStates` (347-382), `_defaultButtonOptions` (220-242), the two existing flat-state constants (251-264) — every issue-1 edit lands here |
| [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) | `clearBackgroundImage` (2396-2406), `clearShadow` (2709-2731, the reference pattern), `writeGuardedCSSRule` (5608-5617), `matchesLowerTier` (4967-4975), `isRestingChromeIsolated`/`restingIsolationKeys` (5497-5518) — read all of these before touching `clearBackgroundImage`, since the fix's correctness depends on understanding exactly which existing tests already pin the "class default absent" edge case |
| [overlay/Dialog.ts](packages/lib/src/typescript/lib/overlay/Dialog.ts) | Its close button (232-253) is the working reference `Notification.ts`'s companion fix mirrors |
| [component/table/Header.ts](packages/lib/src/typescript/lib/component/table/Header.ts) | The whole issue-3 fix lands here; read the current constructor block (178-276) in full before rewriting it |
| [tests/core/ClassChromeRules.test.ts](packages/lib/tests/core/ClassChromeRules.test.ts) | Rows 9-12 are the existing tests that pin `clearBackgroundColor`/`clearBackgroundImage`/`clearShadow`/`clearBorder`'s exact conditional shape on a non-isolated `Component` — the reason this plan's fix keeps the original `if` gate instead of mirroring `clearShadow`'s `matchesLowerTier` logic wholesale |
| [tests/component/table/HeaderMenuButton.test.ts](packages/lib/tests/component/table/HeaderMenuButton.test.ts) | The existing coverage `TableHeaderMenuButton` must keep passing unmodified — the concrete evidence the redesign is behaviour-preserving |
| [plans/implemented/button-meta-class-dedup.md](implemented/button-meta-class-dedup.md) | The direct precedent for `.flat`'s shared-rule mechanism (pressed/hover half) and for the "getters stop reporting the flat token" accepted consequence |
| [plans/implemented/button-variant-chrome-dedup.md](implemented/button-variant-chrome-dedup.md) | The direct precedent for turning a bypass-styled bespoke instance into a real declared-chrome subclass (`WindowControlButton`) — read its Architecture Decisions in full, cited throughout this plan |
| [core/themes/ClassicTheme.ts](packages/lib/src/typescript/lib/core/themes/ClassicTheme.ts) | `button.pressed.background`/`button.hover.background` (31-39) — confirms the gradient that makes `Notification`'s companion fix necessary, not merely theoretical |

---

## Non-Goals

- **`Component.clearBackgroundColor()`'s identical bypass.** Investigated directly: it has the exact same shape as `clearBackgroundImage()`'s bug (`if (this._defaultOptions.backgroundColor) { this.setElementCSSRule(...) }`, same raw-bypass primitive). Not in this plan's brief, and no live call site was found where it currently causes a masked regression the way `Notification`'s did — left for a future, separately-scoped audit of every `Component.clear*` chrome method.
- **The `borderRadius` leak-through on flat buttons.** Confirmed live (`getComputedStyle` reports `"4px"`, not `"0"`, on a flat button today). Pre-existing, unrelated to this plan's dedup goal, and fixing it is a real visual change this plan's brief never asked for — see `## Architecture Decisions`.
- **`Filter.ts`'s clause-popover operator button.** `component/table/cell/Filter.ts`'s `buildClauseRow`'s `opButton` is explicitly documented and coded as **not** flat ("this row sits beside the popover's non-flat 'Add condition' Button... doesn't read as clickable next to it"). It is unrelated to this plan; only `component/table/cell/renderer/Filter.ts`'s `FilterOperatorButton` (the inline filter-row operator button, `setFlat(true)` at line 76) is an actual flat call site, and it needs no source change of its own — it inherits phase 2's fix automatically.
- **`pinPressedToResting()`'s per-instance pin, and `PickerButton`/`AccordionHeader`'s own chromeless resting-chrome duplication.** Explicitly flagged as deferred in `button-variant-chrome-dedup.md`'s own Non-Goals; this is `plans/button-chromeless-followup-dedup.md`'s territory (drafted in parallel, landed on disk during this plan's own drafting) — see the note below on why the two plans' edits don't collide.
- **Bumping the package version.** Release-time bookkeeping.

**On the `touches-shared` overlap with `button-chromeless-followup-dedup`:** confirmed directly by reading that plan (it had finished drafting by the time this one did): its only `Button.ts` edit is a one-line doc-comment change at [Button.ts:122-123](packages/lib/src/typescript/lib/component/button/Button.ts#L122) (`ButtonOptions.chromeless`'s doc comment, dropping a stale `PickerButton` mention) — it explicitly does not touch `applyChromeOptions`'s chromeless branch (976-1048) or `pinPressedToResting()` (2027-2042) themselves, only stops two other files (`PickerButton.ts`, `AccordionHeader.ts`) from calling into them. This plan's own edits are `_applyFlatChrome()` (2145-2200) and the module-level flat-declaration constants near it (251-264) — a third, non-overlapping region. `flat` and `chromeless` are also mutually exclusive by Button's own contract (`setFlat` no-ops when chromeless), so the two plans' subject matter doesn't overlap either. `Button.ts` stays listed in this plan's frontmatter because both plans touch the file at all — a same-file, far-apart-region edit, low conflict risk, not a same-code conflict; whoever merges should rebase one onto the other rather than assume independence at the file level.

---

## Notes

[^why-not-full-mirror]: A fuller mirror of `clearShadow()`'s exact shape — `this.writeGuardedCSSRule("backgroundImage", this.matchesLowerTier("backgroundImage", "none") ? null : "none")`, unconditional, no `_defaultOptions` gate — was drafted first and rejected after checking it against `tests/core/ClassChromeRules.test.ts` row 11's second case ("`clearBackgroundImage` on a class that defaults none still writes a plain removal"). `matchesLowerTier` treats "no lower layer declares this key at all" the same as "a lower layer declares a different value" — both return `false`, both would make the fuller mirror assert a real `"none"`. But `NoneProbeRow11` (a `Component` subclass that never defaults `backgroundImage`) expects a plain `null` removal, not a real assertion — an existing, passing, unrelated-to-this-plan test that the fuller mirror would break. The original `if (this._defaultOptions.backgroundImage)` gate already draws exactly the right line (assert only when the class genuinely has something to override) and needs no replacement, only a different write primitive underneath it.

[^clearbackgroundcolor-same-shape]: `clearBackgroundColor()` ([Component.ts:2313](packages/lib/src/typescript/lib/core/Component.ts#L2313)) has the identical two-write shape and the identical raw-bypass second write (`this.setElementCSSRule("backgroundColor", "transparent")`) as `clearBackgroundImage()` did — confirmed by reading it directly. It is not fixed here: the task brief scoped this plan to `clearBackgroundImage()` specifically, and no live call site was found where `clearBackgroundColor()`'s version of the bug currently produces a masked regression the way `Notification`'s did (its own resting `backgroundColor` clears are all on non-isolated or already-otherwise-guarded instances in the current codebase). See `## Non-Goals`.

[^specificity-not-order-reuse]: The reasoning is identical to `button-meta-class-dedup.md`'s own `[^specificity-not-order]` footnote: `_applyFlatChrome` runs during construction, before `.Button` itself is necessarily materialised (that only happens at some instance's first *render*), so a `.Button.flat` rule could in principle be inserted into the stylesheet before `.Button`'s own rule exists. Relying on one more chained class instead of insertion order sidesteps the question entirely — `(0,2,0)` beats `(0,1,0)` unconditionally.

[^borderradius-live-proof]: Verified two ways: (1) tracing `Component.flushStyleBag`'s per-key comparison shows `clearBorderRadius()` writes a plain `null` (unlike `clearBackgroundColor`/`clearBackgroundImage`/`clearShadow`, none of which have a second "assert the real neutral" write for border-radius), and a `null` write is a CSS property removal with nothing to reintroduce the value elsewhere on the bare `#id` rule; (2) confirmed live in a running instance of the app (`npm run dev`, a flat `ToolBar` button, `getComputedStyle(el).borderRadius`) — the result is `"4px"`, `.Button`'s own raised default token, not `"0"`. Both independently point to the same conclusion.
