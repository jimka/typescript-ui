# Button Meta-Class Dedup — Implementation Plan

## Overview

The framework's Style Audit panel ([packages/lib/src/typescript/StyleAuditPanel.ts](packages/lib/src/typescript/StyleAuditPanel.ts)) found four separate causes of duplicate per-instance CSS in the Button family's toggle-state rules (`.pressed`, `:hover`, `.selected`) — 122 `Button` `:hover` rules (24.34 KB), 39 inherited `TabButton` `:hover` rules (20.52 KB), 39 `TabButton` `.selected` rules with an identical border (16.22 KB), and 78 flat-mode pressed/hover rules (34.88 KB). All four share one root: a per-instance state write is only skipped when it matches content the class-tier `.pressed`/`:hover`/`.selected` rule already carries (`flushStateStyleBag`, [core/Component.ts:5407](packages/lib/src/typescript/lib/core/Component.ts#L5407)) — a property with no class-tier representation for that state can never dedupe, no matter how identical it is across instances.

This plan closes all four gaps:

1. **`Button`'s `:hover` extractor is a stub.** It returns `{}` while `.pressed`'s sibling entry, right above it, reads real values from `_defaultButtonOptions`. Populating it the same way lets `ToggleButton`, `SpinButton`, `MenuButton`, and `PopupButton` — none of which declare their own hover content — dedupe for free, since they all inherit `Button`'s entry unchanged. (`TabButton` *does* declare its own hover fill, tab-specific and different from `Button`'s — it needs its own fix, item 3.)
2. **Flat mode's pressed/hover colors have no class-tier home at all.** `flat` is a per-instance boolean, not a subclass, so the one-class-tier-per-constructor cache can't carry two different `.pressed` contents for one class. This plan gives flat buttons a second DOM class token and a state-tier rule scoped to it.
3. **`TabButton`'s `.hover` has no `ownStyleStates` entry of its own at all, so none of its hover chrome dedupes — not just its border — and `.selected`'s border is excluded on purpose.** Both are a deliberate, but now unnecessary, scope cut made by [`plans/implemented/state-tier-full-unification.md`](implemented/state-tier-full-unification.md). Every affected value — `.hover`'s fill and border, `.selected`'s border — is a fixed constant with no per-instance variance; declaring them is safe.
4. **`ToggleButton`'s flat-mode `.selected` colors have the same gap as (2)** — found during this plan's audit, not previously identified. It reuses (2)'s new mechanism.

`SpinButton`, `MenuButton`, and `PopupButton` were audited and declare no `ownStyleStates` or chrome overrides of their own — they inherit fixes (1) and (2) automatically and need no changes.

All four fixes live in [component/button/Button.ts](packages/lib/src/typescript/lib/component/button/Button.ts), [component/button/ToggleButton.ts](packages/lib/src/typescript/lib/component/button/ToggleButton.ts), and [component/button/TabButton.ts](packages/lib/src/typescript/lib/component/button/TabButton.ts). No changes are needed in `core/Component.ts` or `core/ClassStyleRules.ts` — every fix reuses existing, shipped primitives (`ownStyleStates`, `setStyleState`, `ensureSharedStateRule`).

---

## Architecture Decisions

### `:hover`'s extract mirrors `.pressed`'s shape exactly

`Button.ownStyleStates`' `.pressed` entry ([component/button/Button.ts:326-343](packages/lib/src/typescript/lib/component/button/Button.ts#L326-L343)) reads `_defaultButtonOptions.pressedForegroundColor` / `.pressedBackgroundColor` / `.pressedBackgroundImage` / `.pressedShadow` and returns them as a `StyleBag`, gated on `!d.chromeless`. The `:hover` entry becomes the same shape, reading `hoverForegroundColor` / `hoverBackgroundColor` / `hoverBackgroundImage` / `hoverShadow` from the same constant. `hoverForegroundColor` has no entry in `_defaultButtonOptions`, so — exactly like `pressedForegroundColor` would if it were also undefined — it's never added to the returned bag, leaving it caller-gated (unaffected; already covered by an existing test).

The comment above the current stub ([:308-325](packages/lib/src/typescript/lib/component/button/Button.ts#L308-L325)) argues a class-tier hover rule can never win the cascade against a deviating instance's own resting rule. That reasoning predates the current flush mechanism and no longer holds.[^stale-comment] Replace the misleading paragraph (the `:hover` stays empty… sentence and its specificity argument) with a short note that `:hover` now mirrors `.pressed`.

### Flat mode gets a second DOM class token, `.flat`, and its own state-tier rules chained onto it

`flat` is a per-instance option on any `Button`-family instance, not a distinct class, so it can't be encoded in `ownStyleStates` (memoized per concrete constructor). Instead, a flat instance carries an extra `.flat` DOM class alongside its existing `.Button`/`.pressed`/`:hover` classes, and the flat-specific chrome lives on `.Button.flat.pressed` and `.Button.flat:hover:not(.pressed)` — rules published once via `Component.ensureSharedStateRule` ([:5449](packages/lib/src/typescript/lib/core/Component.ts#L5449)), the same primitive `Cell`/`TreeRow`'s `.focused` rule and `Text`'s line-height value-classes already use for "shared class-tier rule, never a per-instance one."[^shared-vs-group]

`.flat`'s specificity contribution (one more chained class) makes `.Button.flat.pressed` `(0,3,0)` versus `.Button.pressed`'s `(0,2,0)` — strictly higher, so it always wins regardless of which rule was inserted into the stylesheet first.[^specificity-not-order] This is what lets the flat rule be published eagerly, from the constructor, rather than deferred to first render.

`Button` toggles the `.flat` token with the existing `setStyleState(".flat", value)` — it works for any string, not only a name declared in `ownStyleStates` (verified by reading its body: it only touches `_activeStates` and the DOM class list, gated on `getElement()`).[^setstylestate-generic] Because that DOM write is skipped before first render, `Button` gains a `render()` override that replays it, mirroring `ToggleButton.render()`'s own replay of `.selected` and the documented general pattern at [core/Component.ts:5638-5642](packages/lib/src/typescript/lib/core/Component.ts#L5638-L5642).

### `_applyFlatChrome` stops writing flat's colors through the public pressed/hover setters

Today `_applyFlatChrome` ([:2108-2166](packages/lib/src/typescript/lib/component/button/Button.ts#L2108-L2166)) calls `setHoverBackgroundColor`, `setHoverBorder`, `setPressedBackgroundColor`, `setPressedShadow`, `setPressedBorder`, `clearPressedBackgroundImage`, `clearHoverBackgroundImage`, and `clearHoverShadow` — each one an unconditional per-instance write to `#id.pressed` / `#id:hover:not(.pressed)`, always the same literal value, because flat mode never merges with a caller's own pressed/hover options. These eight calls are removed; the same declarations are asserted once, in two `ensureSharedStateRule` calls, using the exact literal values already in the code today (`var(--ts-ui-button-flat-hover-bg, …)`, etc.), plus explicit `backgroundImage: "none"` / `shadow: "none"` in place of the two clears.[^clear-must-be-real] `_restoreChrome` and `_clearChrome` are untouched except for adding `setStyleState(".flat", false)`, since they still own the chromeless round-trip.

### Accepted consequence: the four flat-affected getters stop reporting the flat token

`getPressedBackgroundColor()` / `getPressedShadow()` / `getPressedBorder()` / `getHoverBackgroundColor()` / `getHoverBorder()` read `resolveStateStyleValue(selector, key)` — the per-instance override bag `writeStateStyle` populates, per `state-tier-full-unification.md`'s own documented contract ("what does this instance's own override declare," not "the effective painted value"). Today, `_applyFlatChrome` happens to populate that bag with the flat token (since it currently calls the public setters), so these getters currently answer with it. After this plan, flat's declarations live only in the `.flat.pressed`/`.flat:hover` shared CSS rule — a tier `resolveStateStyleValue` doesn't consult — so on a flat button these getters fall through to `_defaultOptions.pressedBackgroundColor` etc., the non-flat class default.[^getter-tradeoff] The CSS painted on screen is unaffected either way (the shared rule wins the cascade); only these five getters' *return value* on a flat instance changes. `ToggleButton`'s `getSelectedBackgroundColor()`/`getSelectedShadow()` on a flat, selected instance have the identical consequence, for the identical reason.

### `TabButton` declares its own `.hover` entry (fill and border), and `.selected` gains its border

`.selected`'s extract already carries `TAB_BUTTON_SELECTED_FILL`'s three fill keys ([component/button/TabButton.ts:178-184](packages/lib/src/typescript/lib/component/button/TabButton.ts#L178-L184)) — only `TAB_BUTTON_SELECTED_BORDER` is missing, so `.selected` gains one `border` key.

`.hover` is a bigger gap: `TabButton.ownStyleStates` doesn't declare its own `:hover` entry at all today — it restates `ToggleButton`'s (in turn `Button`'s) unchanged, so *none* of `TabButton`'s hover chrome has ever deduped, not just its border. `_defaultTabButtonOptions.hoverBackgroundColor` / `.hoverBackgroundImage` / `.hoverShadow` ([:116-118](packages/lib/src/typescript/lib/component/button/TabButton.ts#L116-L118)) are fixed per-class tokens, the same shape as `.selected`'s fill — nothing stops them from also being declared. `TabButton` gains its own `:hover` entry contributing all four properties (three fill keys plus `border: TAB_BUTTON_HOVER_BORDER`), closing the fill portion of the "39 more inherited by `TabButton`" gap named in the task brief alongside the border portion this plan found during its own audit.[^hover-fill-included]

`applyTabStyling`'s existing `setHoverBorder(options?.hoverBorder ?? TAB_BUTTON_HOVER_BORDER)` and `setSelectedBorder(TAB_BUTTON_SELECTED_BORDER)` calls, and the regular per-instance `hoverBackgroundColor`/`hoverBackgroundImage`/`hoverShadow` dispatch in `applyChromeOptions`, are all untouched — a caller-supplied override still writes for real; a default-styled instance's call now dedupes against the widened class bag, exactly like `.pressed`'s fields already do.

Widening `.selected`'s border, and `.hover` at all, is a deliberate scope cut in `state-tier-full-unification.md` completed here, made to avoid also re-verifying `restingIsolationKeys()`'s interaction with a per-instance resting `border` while landing a much larger piece of work — not a claim that adding border is unsafe.[^border-isolation-safe] `restingIsolationKeys()` is a derived union ([:5487](packages/lib/src/typescript/lib/core/Component.ts#L5487)), so widening it here needs no code change beyond the two `extract` bodies.

### `ToggleButton`'s flat-selected colors reuse `.flat` and `ensureSharedStateRule`, the same way

`ToggleButton.applyOptions`'s flat branch ([component/button/ToggleButton.ts:102-105](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L102-L105)) and `setFlat`'s true-branch ([:253-255](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L253-L255)) each call `setSelectedShadow`/`setSelectedBackgroundColor` with the same two literal flat tokens Button's own flat-pressed chrome uses. `.flat`'s DOM token is already present on the element (inherited from `Button`), so `ToggleButton` only needs one more `ensureSharedStateRule` call, publishing `.ToggleButton.flat.selected:not(.pressed):not(:hover)` — one class more than the base `.ToggleButton.selected:not(.pressed):not(:hover)`, so the same strict-specificity argument applies. The false-branch calls (restoring the non-flat tokens) are untouched — they're not the source of duplication and stay as a defensive re-assert, matching `Button._restoreChrome`'s own choice to leave its now-redundant restores in place.

---

## Internal Structure

### `Button.ts` — the two flat declaration constants

Placed near `_defaultButtonOptions`, reusing every literal string `_applyFlatChrome` writes today:

```typescript
const BUTTON_FLAT_PRESSED_DECLARATIONS: StyleBag = {
    backgroundColor: "var(--ts-ui-button-flat-pressed-bg, rgba(0, 0, 0, 0.10))",
    backgroundImage: "none",
    shadow:          "var(--ts-ui-button-flat-pressed-shadow, inset 1px 1px 3px rgba(0, 0, 0, 0.25))",
    border:          "var(--ts-ui-button-flat-pressed-border, 1px solid rgb(180, 180, 180))",
};

const BUTTON_FLAT_HOVER_DECLARATIONS: StyleBag = {
    backgroundColor: "var(--ts-ui-button-flat-hover-bg, rgba(0, 0, 0, 0.06))",
    backgroundImage: "none",
    shadow:          "none",
    border:          "var(--ts-ui-button-flat-hover-border, 1px solid rgb(200, 200, 200))",
};
```

`resolvePartialDeclarations` (already exported from `core/ClassStyleRules.js`, used throughout `Component.ts`) expands `border` into the four longhands the same way every other `ownStyleStates` extract's border key does.

### `Button.ts` — `_applyFlatChrome`'s new tail

Replaces the block from `this.clearPressedBackgroundImage();` (current line 2150) through the five `setHoverX`/`setPressedX` calls (through current line 2159):

```typescript
this.setStyleState(".flat", true);
this.ensureSharedStateRule(".flat.pressed",              resolvePartialDeclarations(BUTTON_FLAT_PRESSED_DECLARATIONS));
this.ensureSharedStateRule(".flat:hover:not(.pressed)",  resolvePartialDeclarations(BUTTON_FLAT_HOVER_DECLARATIONS));
```

Everything above this block in `_applyFlatChrome` (the resting-tier border/radius/shadow/backgroundImage/backgroundColor handling) is untouched.

### `Button.ts` — the `.flat` render-time catch-up

New method, following `ToggleButton.render()`'s exact shape:

```typescript
protected override render(): Handle {
    const element = super.render();
    DOM.sink.apply(element, { toggleClass: { flat: this.isFlat() } });
    return element;
}
```

`Handle` needs importing from `~/core/DOM.js` (`DOM` itself is already imported).

### `Button.ts` — clearing `.flat` on the chromeless path

One line each in `_clearChrome()` and `_restoreChrome()`:

```typescript
this.setStyleState(".flat", false);
```

`_clearChrome()` handles `setChromeless(true)` (which force-clears flat); `_restoreChrome()` handles both `setChromeless(false)` and `setFlat(false)`. Calling `setStyleState(".flat", false)` when `.flat` is already inactive is a no-op (the method's own unchanged-value guard).

### `TabButton.ts` — the widened `ownStyleStates`

```typescript
protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
    ToggleButton.ownStyleStates[0],   // .pressed, restated unchanged
    {
        selector: ":hover",
        extract: (): StyleBag => ({
            backgroundColor: _defaultTabButtonOptions.hoverBackgroundColor,
            backgroundImage: _defaultTabButtonOptions.hoverBackgroundImage,
            shadow:          _defaultTabButtonOptions.hoverShadow,
            border:          TAB_BUTTON_HOVER_BORDER,
        }),
    },
    {
        selector: ".selected",
        extract: (): StyleBag => ({
            backgroundColor: TAB_BUTTON_SELECTED_FILL.backgroundColor,
            backgroundImage: TAB_BUTTON_SELECTED_FILL.backgroundImage,
            shadow:          TAB_BUTTON_SELECTED_FILL.boxShadow,
            border:          TAB_BUTTON_SELECTED_BORDER,
        }),
    },
];
```

`_defaultTabButtonOptions` is read directly (module-level, same file), mirroring how `Button`'s own `.pressed`/`:hover` extracts close over `_defaultButtonOptions` directly rather than the `defaults` parameter — see that constant's own comment for why. No new module constant is introduced for the hover fill; the existing `_defaultTabButtonOptions.hoverX` fields are the single source of truth, avoiding a second, driftable copy of the same literal tokens.

(`ToggleButton.ownStyleStates.slice(0, 2)` becomes `[ToggleButton.ownStyleStates[0]]` plus this file's own `:hover` entry, since `:hover` is no longer a blind restatement.)

### `ToggleButton.ts` — the flat-selected constant and its one new call

Placed near `TOGGLE_SELECTED_DECLARATIONS`:

```typescript
const TOGGLE_FLAT_SELECTED_DECLARATIONS: Readonly<Record<string, string | null>> = Object.freeze({
    boxShadow:       "var(--ts-ui-button-flat-pressed-shadow, inset 1px 1px 3px rgba(0, 0, 0, 0.25))",
    backgroundColor: "var(--ts-ui-button-flat-pressed-bg, rgba(0, 0, 0, 0.10))",
});
```

Both flat-true call sites (`applyOptions`'s flat branch, `setFlat`'s true branch) replace their `setSelectedShadow`/`setSelectedBackgroundColor` pair with:

```typescript
this.ensureSharedStateRule(".flat.selected:not(.pressed):not(:hover)", TOGGLE_FLAT_SELECTED_DECLARATIONS);
```

This is already CSS-keyed (matching `TOGGLE_SELECTED_DECLARATIONS`'s own shape), so no `resolvePartialDeclarations` call is needed.

---

## Ordered Implementation Steps

1. **`Button.ts` — populate `:hover`'s extract.** Per `## Architecture Decisions`, mirror `.pressed`'s shape reading `hoverForegroundColor`/`hoverBackgroundColor`/`hoverBackgroundImage`/`hoverShadow`. Replace the stale reasoning in the comment block above `ownStyleStates` ([:308-325](packages/lib/src/typescript/lib/component/button/Button.ts#L308-L325)) — keep the "pressed beats hover" ordering note and the chromeless-guard note; replace only the paragraph arguing hover can never dedupe.
   *Check:* `npm run typecheck`.

2. **`Button.pressedHoverClassHoisting.test.ts` — flip the hover test.** The test `"a default Button's hover state is never deduped…"` ([:104-115](packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts#L104-L115)) now expects the opposite of what it currently asserts: `hoverDeclarations.backgroundColor`/`.backgroundImage`/`.boxShadow` become `toBeUndefined()` (deduped) and `_ruleCacheHas('.Button:hover:not(.pressed)')` becomes `toBe(true)`. Rename the test and update the file's header comment (lines 18-21) to match `.pressed`'s own description above it. Leave the `hoverForegroundColor` test (caller-gated, unaffected) and the `setPressedForegroundColor` test alone.
   *Check:* `npx vitest run tests/component/button/Button.pressedHoverClassHoisting.test.ts` from `packages/lib`.

3. **`Button.ts` — add the two flat declaration constants.** Per `## Internal Structure`, near `_defaultButtonOptions`.

4. **`Button.ts` — add `.flat`'s render-time catch-up.** New `protected override render(): Handle` method per `## Internal Structure`. Add `Handle` to the existing `~/core/DOM.js` import.
   *Check:* `npm run typecheck`.

5. **`Button.ts` — rewrite `_applyFlatChrome`'s tail.** Delete the five `setHoverX`/`setPressedX` calls and the two clears (`clearPressedBackgroundImage`, `clearHoverBackgroundImage`, `clearHoverShadow`) at the end of `_applyFlatChrome` ([:2150-2159](packages/lib/src/typescript/lib/component/button/Button.ts#L2150-L2159)); replace with the `setStyleState`/`ensureSharedStateRule` block from `## Internal Structure`. Everything above that block in the method is untouched. Add `resolvePartialDeclarations` to the existing `~/core/ClassStyleRules.js` import.
   *Check:* `grep -n 'setHoverBackgroundColor\|setHoverBorder\|setPressedBackgroundColor\|setPressedShadow\|setPressedBorder\|clearPressedBackgroundImage\|clearHoverBackgroundImage\|clearHoverShadow' packages/lib/src/typescript/lib/component/button/Button.ts` — none of these appear inside `_applyFlatChrome` any more (they still appear in `applyChromeOptions`, `_clearChrome`, `_restoreChrome`, and the setter bodies themselves — unaffected).

6. **`Button.ts` — clear `.flat` on the chromeless path.** Add `this.setStyleState(".flat", false);` to `_clearChrome()` ([:1905-1936](packages/lib/src/typescript/lib/component/button/Button.ts#L1905-L1936)) and `_restoreChrome()` ([:1944-1978](packages/lib/src/typescript/lib/component/button/Button.ts#L1944-L1978)).
   *Check:* `npm run typecheck`.

7. **`Button.restingChromeIsolation.test.ts` — rewrite row 11.** The current test ([:202-220](packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts#L202-L220)) exercises the old per-instance flat pin/unpin, which no longer happens. Replace it with a case asserting the new mechanism: after `setFlat(true)`, `#id.pressed` receives no new declarations for `color`/`backgroundColor`/`backgroundImage`/`boxShadow` (nothing written there any more — the earlier construction-time dispatch already deduped these against `.Button.pressed`'s class bag before flat ran), `_ruleCacheHas('.Button.flat.pressed')` is `true`, and the rendered element's class list contains `flat`. After `setFlat(false)`, `_ruleCacheHas` for the flat rule stays `true` (rules are never removed) but the element's class list no longer contains `flat`.
   *Check:* `npx vitest run tests/component/button/Button.restingChromeIsolation.test.ts` from `packages/lib`.

8. **New test file `Button.flatStateClassHoisting.test.ts`.** Covers Expected Behaviour rows 6-10 below: two flat `Button`s share one `.Button.flat.pressed` rule with no per-instance pressed/hover declarations for the flat-affected keys; a non-flat sibling's `.pressed`/`:hover` rules are unaffected; `getPressedBackgroundColor()`/`getHoverBackgroundColor()` on a flat button now report the non-flat class default (the accepted getter-behavior change from `## Architecture Decisions`), pinning the new answer so a future change can't drift it silently.
   *Check:* `npx vitest run tests/component/button/Button.flatStateClassHoisting.test.ts` from `packages/lib`.

9. **`TabButton.ts` — widen `ownStyleStates`.** Per `## Internal Structure`. Update the comment above the field ([:167-174](packages/lib/src/typescript/lib/component/button/TabButton.ts#L167-L174)), which currently states `.hover` is fully inherited and `.selected`'s border is deliberately excluded — both claims become false.
   *Check:* `npm run typecheck`.

10. **`TabButton.stateClassHoisting.test.ts` — flip the `.hover` test entirely and the `.selected` test's border assertions.** The `.hover` test ([:96-109](packages/lib/tests/component/button/TabButton.stateClassHoisting.test.ts#L96-L109)): all seven assertions (`hoverDeclarations.backgroundColor`/`.backgroundImage`/`.boxShadow`/`.borderTop`/`.borderRight`/`.borderBottom`/`.borderLeft`) flip from `toBeDefined()` to `toBeUndefined()`; `_ruleCacheHas('.TabButton:hover:not(.pressed)')` flips from `toBe(false)` to `toBe(true)`. The `.selected` test ([:119-134](packages/lib/tests/component/button/TabButton.stateClassHoisting.test.ts#L119-L134)): only the four border assertions flip to `toBeUndefined()` (fill was already deduped). Update the file's header comment (lines 14-23) to match — it currently claims `.hover` is fully inherited with no class rule ever created and `.selected`'s border is a deliberate exclusion; both become false.
    *Check:* `npx vitest run tests/component/button/TabButton.stateClassHoisting.test.ts` from `packages/lib`.

11. **`ToggleButton.ts` — add the flat-selected constant and its one call, at both sites.** Per `## Internal Structure`: `applyOptions`'s flat branch ([:102-105](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L102-L105)) and `setFlat`'s true branch ([:253-255](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L253-L255)).
    *Check:* `npm run typecheck`.

12. **Extend `Button.flatStateClassHoisting.test.ts` with the `ToggleButton` case**, rather than a new file — it already sets up the flat-rule assertions this case reuses. Two flat, selected `ToggleButton`s share one `.ToggleButton.flat.selected:not(.pressed):not(:hover)` rule; a `TabButton` in the same state shares its own separate `.TabButton.flat.selected…` rule (different concrete class, per `ensureClassStateRule`'s existing per-constructor keying).
    *Check:* `npx vitest run tests/component/button` from `packages/lib`.

13. **`packages/lib/docs/reference/changelog/next.md` — add both entries from `## Documentation Impact`.**

14. **Full suite.** `npm test` from `packages/lib`. `npm run lint` and `npm -w packages/lib run test:lint` — the `local/no-raw-dom` baseline is empty and must stay so (this plan adds no raw DOM access; every write goes through `DOM.sink.apply`, `setStyleState`, or `ensureSharedStateRule`). `npm run docs:api` — zero warnings.

15. **Manual verification.** See `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/ToggleButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts` |
| Modify | `packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts` |
| Modify | `packages/lib/tests/component/button/TabButton.stateClassHoisting.test.ts` |
| Create | `packages/lib/tests/component/button/Button.flatStateClassHoisting.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-12 are unit-testable with the `installTestDOM`/`RecordingDOMSink` harness and the `declarationsDuring` helper already present in the button test files. Row 13 needs a live browser.

**Root cause 1 — `Button`'s `:hover`**

1. Rendering a second default `Button`, after a first has warmed the class rules, writes no `backgroundColor`/`backgroundImage`/`boxShadow` to its own `#id:hover:not(.pressed)` rule; `.Button:hover:not(.pressed)` exists in the rule cache carrying all three.
2. `setHoverBackgroundColor("red")` on any `Button` still writes `backgroundColor: "red"` to `#id:hover:not(.pressed)` (a genuine deviation is never suppressed).
3. `setHoverForegroundColor("red")` still always writes for real (caller-gated field, no class default either before or after this change).
4. `SpinButton`, `MenuButton`, `PopupButton`, and `ToggleButton` — none of which declare their own `:hover` content — each also skip their per-instance hover fill write, resolving to `.Button:hover:not(.pressed)` directly with no separate class rule of their own. (`TabButton`'s hover is handled separately, by root cause 3's own fix — see row 11 — since its fill genuinely differs from `Button`'s generic hover fill and dedupes against its own class rule instead.)

**Root cause 2 — flat pressed/hover**

5. A flat `Button`'s rendered element carries the `flat` DOM class token, and `.Button.flat.pressed` / `.Button.flat:hover:not(.pressed)` exist in the rule cache, each carrying `background-color`, `background-image: none`, the border longhands, and (pressed only) `box-shadow`.
6. Two flat `Button`s write no `background-color`/`background-image`/border/`box-shadow` declarations of their own to their `#id.pressed` or `#id:hover:not(.pressed)` rules for the flat-affected keys.
7. A non-flat `Button` constructed after a flat one is unaffected: its `#id.pressed`/`#id:hover:not(.pressed)` behavior matches row 1/2 exactly, and its rendered element carries no `flat` class.
8. `getPressedBackgroundColor()` / `getPressedShadow()` / `getPressedBorder()` / `getHoverBackgroundColor()` / `getHoverBorder()` on a flat `Button` now report the *non-flat* class default, not the flat token — an accepted, documented consequence (see `## Architecture Decisions`), not a bug to fix. The actual painted CSS is unaffected.
9. `setFlat(true)` on an already-rendered `Button` adds the `flat` class live (not only at construction); `setFlat(false)` removes it, and the button's pressed/hover chrome reverts to its non-flat values (verified live, since the offline harness can't evaluate the cascade).
10. `new Button({ flat: true })` (construction-time flat, before any render) still carries the `flat` class after first render — the `render()` catch-up fires.

**Root cause 3 — `TabButton` borders**

11. A default `TabButton` writes no `backgroundColor`/`backgroundImage`/`boxShadow`/border-longhand declarations of its own for `.hover`, and no border longhands for `.selected` (its fill already deduped before this plan); `.TabButton:hover:not(.pressed)` exists carrying all four properties, and `.TabButton.selected:not(.pressed):not(:hover)` exists carrying its (widened) four properties too. A caller-supplied `hoverBorder`/`hoverBackgroundColor`/etc. still writes for real on that instance.

**Root cause 4 — `ToggleButton` flat-selected**

12. A flat, selected `ToggleButton` writes no `background-color`/`box-shadow` to its own `#id.selected:not(.pressed):not(:hover)` rule; `.ToggleButton.flat.selected:not(.pressed):not(:hover)` exists carrying both. A flat, selected `TabButton` shares a separate `.TabButton.flat.selected…` rule, not `ToggleButton`'s.

**Manual verification** (`npm run dev`, http://localhost:8015, Style Audit panel)

13. Visit the Buttons, Toggle Buttons, and Tab demo sections (enough instances to populate the audit meaningfully), open the Style Audit panel, and confirm: resting/hover/pressed/selected/flat chrome all render identically to before this plan (no visual change anywhere), and the four duplicate-rule groups this plan targets — `Button :hover`, `TabButton :hover` (inherited), `TabButton .selected` border, and flat pressed/hover — no longer appear in the audit's duplicate table (or appear with a much lower "wasted KB" figure, for any remaining un-deduped keys like fill).

---

## Verification

Run from the repo root unless noted.

- `npm run typecheck` — after every step.
- `npm test` from `packages/lib` (`typecheck:test` + `vitest run`) — full suite green.
- `npm run lint` and `npm -w packages/lib run test:lint` — `local/no-raw-dom` baseline stays empty.
- Grep invariant: `grep -n 'setHoverBackgroundColor\|setHoverBorder\|setPressedBackgroundColor\|setPressedShadow\|setPressedBorder' packages/lib/src/typescript/lib/component/button/Button.ts` — no occurrence inside `_applyFlatChrome`'s body (still present elsewhere, e.g. `applyChromeOptions`).
- `npm run docs:api` — zero warnings (no public API surface changes; confirms no accidental `{@link}` breakage from comment edits).
- **Manual browser verification is required** (Expected Behaviour row 13). Start a dev server on a spare port from *this worktree*, symlinking `node_modules` first so the app resolves this tree's `packages/lib`. Drive the Buttons/Toggle Buttons/Tab demo sections and the Style Audit panel via `chrome-devtools`, confirming appearance is unchanged and the targeted duplicate groups shrink or disappear.

---

## Documentation Impact

No exported symbol is added, removed, or its signature changed — `ownStyleStates`/`_applyFlatChrome`/`render()` are `protected`/private, and no `ComponentOptions`/`ButtonOptions` field changes. `typedoc.json`, the barrels, and `packages/lib/llms.txt` are unaffected. One public getter *return value* changes for a specific case, per the entry below.

- `packages/lib/docs/reference/changelog/next.md`, two entries:
  - `## Changed` → `### Components`: on a flat `Button` (or a flat, selected `ToggleButton`), `getPressedBackgroundColor()` / `getPressedShadow()` / `getPressedBorder()` / `getHoverBackgroundColor()` / `getHoverBorder()` / `getSelectedBackgroundColor()` / `getSelectedShadow()` now report the class default rather than the flat token — the actual rendered chrome is unchanged, only what these getters report on a flat instance.
  - `## Changed` → `### Core` (or a stylesheet-size note alongside it): the shared `<style id="Base">` stylesheet now dedupes `Button`'s hover chrome, flat-mode pressed/hover chrome, and `TabButton`'s hover/selected borders, matching how `.pressed` already deduped.

---

## Potential Challenges

- **Landing root cause 1 and root cause 2 out of order reintroduces a regression.** Once `:hover`'s extract is populated (root cause 1), `.Button:hover:not(.pressed)` declares a real `background-image`. `_applyFlatChrome`'s old `clearHoverBackgroundImage()` writes a `null` (a CSSOM removal), which — unlike the flat-mode rewrite in this plan — can never defeat a real class-tier declaration.[^clear-must-be-real] Land steps 1 and 5 together (same PR/commit), not as independently-mergeable increments.
- **`_applyFlatChrome` runs during construction, before any element exists.** `ensureSharedStateRule`'s underlying `StyleRule` construction is safe pre-render (confirmed by the existing `Cell`/`TreeRow` constructor-time callers), so this is not a deferral violation — but it does mean the flat rule can be created before `.Button.pressed` itself has ever been created (that only happens at some instance's first *render*). This plan avoids relying on insertion order for correctness by using strictly higher specificity (`.flat` adds a chained class) instead.[^specificity-not-order]
- **`Button.restingChromeIsolation.test.ts` row 11's existing narrative ("clearing the flat pin") no longer describes what happens.** Step 7 rewrites it rather than patching the assertions in place — the old test's premise (a per-instance flat override gets nulled back) doesn't exist under the new mechanism.

---

## Critical Files

| File | Why |
|---|---|
| [component/button/Button.ts](packages/lib/src/typescript/lib/component/button/Button.ts) | `ownStyleStates` (326-348), `_applyFlatChrome` (2108-2166), `_clearChrome`/`_restoreChrome` (1905-1978) — every root-cause-1/2 edit lands here |
| [component/button/ToggleButton.ts](packages/lib/src/typescript/lib/component/button/ToggleButton.ts) | `ownStyleStates` (50-60), `applyOptions`'s flat branch (91-108), `setFlat` (247-262) — precedent for a `.selected` extract, and root-cause-4's edit site |
| [component/button/TabButton.ts](packages/lib/src/typescript/lib/component/button/TabButton.ts) | `ownStyleStates` (158-185), `applyTabStyling` (289-296), `_defaultTabButtonOptions` (99-119), the border/fill constants (121-139) — root-cause-3's edit site |
| [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) | `setStyleState` (5543-5563), `ensureSharedStateRule` (5449-5451), `flushStateStyleBag` (5407-5437), `restingIsolationKeys` (5487-5497) — the existing primitives this plan reuses, unmodified; read before writing any new call site |
| [core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) | `resolveStateLevels` (679-742), `guardedSuffixFor` (623-631) — how a per-level `ownStyleStates` merge and its `:not(...)` guard are actually computed; needed to confirm `TabButton`'s widened extracts merge correctly against `ToggleButton`'s |
| [plans/implemented/state-tier-full-unification.md](implemented/state-tier-full-unification.md) | The mechanism every fix in this plan reuses (`writeStateStyle`, `flushStateStyleBag`, `ensureSharedStateRule`) and the origin of `TabButton`'s deliberate `.hover`/border scope cut this plan completes |
| [plans/implemented/shared-instance-style-groups.md](implemented/shared-instance-style-groups.md) | The resting-tier `styleGroup` precedent investigated for root cause 2 and found not to fit (construction-time-only, resting-tier-only, public option) — read to understand why this plan uses `.flat` + `ensureSharedStateRule` instead of extending `styleGroup` |
| [packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts](packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts) | The `.pressed` dedup test shape every rewritten/new test in this plan mirrors |

---

## Non-Goals

- **A general-purpose "state-tier style group" public API.** This plan gives `Button`/`ToggleButton` an internal `.flat` token and two `ensureSharedStateRule` calls, not a caller-facing mechanism like `ComponentOptions.styleGroup`. `flat`'s content never varies per instance, so there's nothing for a caller to configure.
- **Deduping `TabButton`'s hover/selected fill against `Button`'s own `.pressed`/`:hover`/`.selected` rules.** Not attempted, and not possible: `TabButton`'s fill is tab-specific and genuinely differs from `Button`'s generic values, so it can only ever dedupe against `TabButton`'s *own* class rule (which this plan builds), never against `Button`'s.
- **`Checkbox`/`RadioButton`/`Scrollbar`/`Header`/other `ownStyleStates` users.** The task's audit scope is the Button family; these were not investigated and showed no symptom in the live audit.
- **`TableHeader`/`FooterRow` duplication** and **generic cross-component utility rules** (glyph sizes, `display:none` sharing) — explicitly out of scope per the task brief; separate, later planning rounds.
- **`TextInput`/`AbstractInput`-family style bypasses** — covered by `plans/text-input-class-tier-migration.md`; not touched here.

---

## Notes

[^stale-comment]: The comment's claim is that a class-tier `.Button:hover:not(.pressed)` rule at specificity `(0,3,0)` "loses to a deviating instance's isolated resting rule at `(1,1,0)`." Tracing the actual mechanism shows this doesn't apply: `flushStateStyleBag` ([core/Component.ts:5407](packages/lib/src/typescript/lib/core/Component.ts#L5407)) queues an explicit `null` — a CSSOM removal, not merely a lower-priority value — whenever a per-instance write matches the class-tier bag. Once the id-scoped rule no longer declares a property at all, there is nothing left for the class-tier rule to lose a specificity contest against; only rules that both declare the *same* property for the *same* element are compared. This is exactly how `.pressed` already works (proven by the currently-passing `Button.pressedHoverClassHoisting.test.ts` test right above the stub). Separately, the comment's own cited specificity numbers are internally inconsistent with its own closing sentence: `restingGuardSuffix` (confirmed by reading `core/ClassStyleRules.ts:845-847`) always includes `:not(:hover)` for `Button` regardless of whether `:hover`'s extract is empty, so the isolated resting rule is `#id:not(.pressed):not(:hover)` — specificity `(1,2,0)`, not the `(1,1,0)` the comment names. The reasoning most likely predates `state-tier-full-unification.md`'s flush-time null-on-match rewrite (its predecessor, `writeClassStateDeclaration`, *skipped* a matching write rather than nulling it, which could leave a stale real value in place) and was never revisited once the mechanism changed underneath it.

[^shared-vs-group]: A caller-facing, per-instance grouping mechanism already exists for the *resting* tier — `styleGroup`/`ensureStyleGroupRule` ([plans/implemented/shared-instance-style-groups.md](implemented/shared-instance-style-groups.md)) — but it's explicitly scoped to resting properties only, and it's a caller-supplied token compared against the *first* instance's own resolved value (built for "these callers coincidentally want the same non-default look"). Flat's pressed/hover colors are a framework-internal fact with zero per-instance variance, never caller-configurable — closer to `.focused`'s "shared-only, no per-instance dedup needed" shape (`ensureSharedStateRule`) than to `styleGroup`'s "compare and dedupe" shape. Reusing `styleGroup` itself was considered and rejected: `Button` calling `this.setStyleGroup("flat")` internally would silently overwrite a caller's own `styleGroup` choice, since it's one public string field — a real behavioral collision, not just an API smell, given `styleGroup` is documented as caller-facing.

[^specificity-not-order]: The resting-tier `styleGroup` mechanism relies on insertion order (`ensureStyleGroupRule` is always called after `ensureClassStyleRule`, within the same `applyStyle` render pass) to win cascade ties at equal specificity. That guarantee doesn't hold here: `_applyFlatChrome` runs during construction, while `.Button.pressed` isn't created until some instance's first *render* — so the first-ever flat `Button` in a process could have its `.flat.pressed` rule inserted before `.Button.pressed` exists, inverting the order a same-specificity tie-break would need. Using one more chained class (`.flat`) instead of relying on order sidesteps this: `(0,3,0)` beats `(0,2,0)` unconditionally, so no ordering guarantee is needed at all.

[^clear-must-be-real]: `clearPressedBackgroundImage()` ([component/button/Button.ts:2387-2390](packages/lib/src/typescript/lib/component/button/Button.ts#L2387-L2390)) already writes a real value (`this.getBackgroundImage() ?? "none"`), not `null` — its own neighboring comment (lines 1914-1916) explains why: a `null` write is a CSSOM removal and "can never win the cascade against `.Button.pressed`'s shared, non-null `color` token." `clearHoverBackgroundImage()`/`clearHoverShadow()` do write `null` today, which is harmless only because `:hover`'s class-tier bag is currently empty (nothing to lose a cascade contest against). Once root cause 1 populates it, those two calls would start leaking the raised hover gradient/shadow onto flat buttons. This plan's rewrite of `_applyFlatChrome` removes both calls entirely, replacing them with real `"none"` literals in the shared flat rule's own declarations — avoiding the regression rather than papering over it.

[^border-isolation-safe]: `restingIsolationKeys()` growing to include border longhands means a `TabButton`'s own *resting* border write (default or caller-supplied) now routes to the guarded `#id:not(.pressed):not(:hover):not(.selected)` rule instead of the bare `#id` rule — the same fix `button-resting-chrome-state-isolation.md` already made for `backgroundColor`/`backgroundImage`/`boxShadow`, now extended to border. This closes a latent (never-triggered, since nothing competed for it before) instance of the same id-vs-class specificity bug the isolation mechanism exists to prevent, rather than introducing a new risk.

[^hover-fill-included]: The task brief's own live-audit numbers attribute `TabButton`'s 39-instance, 20.52 KB `:hover` duplicate group to inheriting `Button`'s (then-empty) `:hover` entry — accurate as a description of *why the group exists*, but incomplete as a description of the fix: `Button`'s own `:hover` fix (root cause 1) only removes duplication for a class that shares `Button`'s hover *values*. `TabButton` never has — its hover fill has always been tab-specific — so even after root cause 1 lands, every default `TabButton` would still write its own real per-instance `backgroundColor`/`backgroundImage`/`boxShadow` to `#id:hover:not(.pressed)`, un-deduped, because nothing in `resolveStyleStates(TabButton)`'s bag would match it. Declaring `TabButton`'s own `:hover` entry — fill and border together — is what actually closes the full 20.52 KB, not just the border portion this plan additionally found.

[^setstylestate-generic]: `setStyleState`'s doc comment describes it as toggling "one of this class's declared states," but its body ([core/Component.ts:5543-5563](packages/lib/src/typescript/lib/core/Component.ts#L5543-L5563)) has no dependency on `ownStyleStates` membership — it only updates `_activeStates` (consumed elsewhere only by `styleLayers()`, which filters through `resolveStyleStates(ctor)` and simply ignores an unlisted name) and toggles a DOM class token. `.flat` deliberately stays out of `ownStyleStates` — it isn't mutually exclusive with `.pressed`/`.selected` the way that list's guarded chain assumes, and its content varies by which class is flat (`Button` vs `ToggleButton`), not by a single shared priority order.

[^getter-tradeoff]: `resolveStateStyleValue` ([core/Component.ts:5204](packages/lib/src/typescript/lib/core/Component.ts#L5204)) walks `[instanceStateLayer(selector), classStateLayer(selector)]` — the per-instance state bag and `resolveStyleStates(ctor)`'s resolved bag. Neither one is touched by `ensureSharedStateRule`, which publishes a CSS rule outside that lookup entirely, so there is no way for these five (seven, counting `ToggleButton`'s two) getters to keep reporting the flat token without either (a) also writing it into the per-instance state bag — which reintroduces the exact per-instance CSS declaration this plan removes to get the byte savings, since `writeStateStyle` is the single mechanism for both the JS cache and the CSS write — or (b) building a parallel "flat" layer into `resolveStateStyleValue`/`flushStateStyleBag` themselves, mirroring how the resting tier's `styleGroup` is a real layer `styleLayers()` includes. Option (b) would keep every getter's answer exactly as today, but requires extending the shared `Component.ts` state-tier flush/resolve machinery — a second, more invasive change with a much larger blast radius (every `ownStyleStates` user) for a getter with only one internal caller pattern in this codebase: `applyChromeOptions` itself reads `getPressedBackgroundColor()` / `getPressedShadow()` / `getHoverBackgroundColor()` ([component/button/Button.ts:1034,1036,1041](packages/lib/src/typescript/lib/component/button/Button.ts#L1034)) to seed the *raised* defaults, strictly *before* the method's own later `_applyFlatChrome()` call — so this read never observes a flat value, before or after this plan, and stays unaffected either way. No other internal call site in `packages/lib/src` reads any of the seven affected getters (`grep -rn` over `packages/lib/src/typescript/lib/component` finds only that trio, plus the getter/setter definitions themselves). This plan takes (a)'s cost only for the byte savings, accepts the getter change for external callers, and documents it rather than building (b).
