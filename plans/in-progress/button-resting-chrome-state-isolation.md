---
depends-on: [hoist-button-tabbar-state-chrome-rules, component-chrome-base-tier-hoisting]
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
  - packages/lib/src/typescript/lib/component/button/Button.ts
  - packages/lib/tests/core/ClassChromeRules.test.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Button Resting-Chrome State Isolation — Implementation Plan

## Overview

`plans/implemented/hoist-button-tabbar-state-chrome-rules.md` built a shared `.ClassName.pressed` rule, so every Button of a class draws its pressed treatment from one rule instead of one rule per instance. It then had to narrow that rule to a single property, `color`.[^prior-scope] `plans/implemented/component-chrome-base-tier-hoisting.md` has since moved a class's default `background-color`, `background-image` and `box-shadow` onto the shared `.ClassName` rule ([`core/ClassStyleRules.ts:155`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L155)). That removes half the obstacle: a Button holding its class defaults declares none of the three on its own `#id` rule, so `.Button.pressed` `(0,2,0)` would beat `.Button` `(0,1,0)` cleanly.

The other half remains. A Button that *deviates* on resting chrome — a caller-supplied `backgroundColor`, a `flat` button's `transparent`, a `Dialog` close button's cleared shadow — writes its value onto the bare `#id` rule at `(1,0,0)`, and a bare `#id` selector outranks any class-only selector no matter how many classes the latter chains. Widening the shared pressed rule while that is true would silently drop the pressed treatment on exactly those instances.

This plan removes the contest. A deviating resting `background-color` / `background-image` / `box-shadow`, plus the `background` shorthand, go onto a per-instance `#id:not(.pressed)` rule instead of `#id`. `:not(.pressed)` and `.pressed` never match the same element at the same moment, so there is nothing to arbitrate. [`Button.getPressedClassDeclarations()`](packages/lib/src/typescript/lib/component/button/Button.ts#L599) then widens from one property to four, and a default-styled Button stops materialising a `#id.pressed` rule at all.

Two source files change behaviour. [`component/button/Button.ts`](packages/lib/src/typescript/lib/component/button/Button.ts) carries the whole mechanism; [`core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) widens one private predicate to `protected` so Button's routing can reuse the base's class-tier comparison instead of re-deriving it.[^protected-comparison] `core/ClassStyleRules.ts` gets a doc-only correction to one paragraph this change invalidates. `core/StyleTarget.ts`, `ToggleButton.ts` and `TabButton.ts` are not touched at all.[^siblings-unchanged]

---

## Architecture Decisions

Throughout, CSS specificity is written as `(id, class, type)` — the standard three-number comparison, read left to right. `#c17` is `(1,0,0)`; `.Button.pressed` is `(0,2,0)`; `:not(X)` and `:hover` each count in the class column. An id beats any number of classes.

### Isolate deviating resting chrome behind `:not(.pressed)`, mirroring `hoverStyleRule`

Button already owns this pattern: [`hoverStyleRule`](packages/lib/src/typescript/lib/component/button/Button.ts#L556) is built as `createStyleRule(":hover:not(.pressed)")` so hover and pressed are mutually exclusive on the element rather than competing on specificity. This plan applies the same idea one tier down: a new lazy `restingStyleRule = createStyleRule(":not(.pressed)")` carries the resting chrome a `.pressed` declaration has to override.

| | rule holding a deviating resting `background-color` | rule holding pressed `background-color` | winner while pressed |
|---|---|---|---|
| today, if the pressed bag were widened | `#id` `(1,0,0)` | `.Button.pressed` `(0,2,0)` | resting — pressed treatment lost |
| after this plan | `#id:not(.pressed)` `(1,1,0)` — does not match | `.Button.pressed` `(0,2,0)` | pressed |

The full per-state picture for a Button given `{ backgroundColor: "red" }`, with the class rule `.Button` still declaring the default token:

| Element state | Rules that match and declare `background-color` | Winner |
|---|---|---|
| resting | `.Button` `(0,1,0)`, `#id:not(.pressed)` `(1,1,0)` | `red` |
| hovered | the two above, plus `#id:hover:not(.pressed)` `(1,2,0)` | hover value |
| pressed | `.Button` `(0,1,0)`, `.Button.pressed` `(0,2,0)` | pressed value |
| hovered and pressed | `.Button` `(0,1,0)`, `.Button.pressed` `(0,2,0)` | pressed value |

### Isolation keeps the class-tier comparison, so a default Button writes nothing

The routing overrides change *which rule* a declaration lands on. They do not change the base rule that a value matching the class tier is written as a removal rather than as a value.[^keep-class-comparison] A Button holding its class defaults therefore queues only `null`s onto the isolated rule, and `Component`'s `materialiseWhenNeeded` ([Component.ts:5063](packages/lib/src/typescript/lib/core/Component.ts#L5063)) never inserts it.

| Instance | What reaches `#id:not(.pressed)` | Is the rule inserted? |
|---|---|---|
| `new Button('Save')` | a `null` for each of the three reconciled keys | no |
| `new Button('Save', { backgroundColor: 'red' })` | `background-color: red` | yes |
| `new Button('Save', { flat: true })` | `background-color: transparent`, `background-image: none`, `box-shadow: none` | yes |

### The isolated set is the three reconciled chrome keys plus the `background` shorthand

`background-color`, `background-image` and `box-shadow` reach the instance rule through `Component`'s two reconciling helpers; the `background` shorthand still reaches it through the plain single-key setter path. All four are isolated, through two different overrides.

| Property | What `applyStyle` calls | What the runtime setters call | Carried by the class-tier bag? |
|---|---|---|---|
| `background-color` | `reconcileRuleDeclaration` ([Component.ts:4868](packages/lib/src/typescript/lib/core/Component.ts#L4868)) | `setReconciledCSSRules` (`setBackgroundColor` [2148](packages/lib/src/typescript/lib/core/Component.ts#L2148), `clearBackgroundColor` [2167](packages/lib/src/typescript/lib/core/Component.ts#L2167)) | yes, when the class defaults it |
| `background-image` | `reconcileRuleDeclaration` ([4873](packages/lib/src/typescript/lib/core/Component.ts#L4873)) | `setReconciledCSSRules` ([2230](packages/lib/src/typescript/lib/core/Component.ts#L2230) / [2245](packages/lib/src/typescript/lib/core/Component.ts#L2245)) | yes, when the class defaults it |
| `box-shadow` | `reconcileRuleDeclaration` ([4979](packages/lib/src/typescript/lib/core/Component.ts#L4979)) | `setReconciledCSSRules` ([2537](packages/lib/src/typescript/lib/core/Component.ts#L2537) / [2555](packages/lib/src/typescript/lib/core/Component.ts#L2555)) | yes, when the class defaults it |
| `background` | nothing — no phase writes the shorthand | `setElementCSSRule` (`setBackground` [2195](packages/lib/src/typescript/lib/core/Component.ts#L2195), `clearBackground` [2207](packages/lib/src/typescript/lib/core/Component.ts#L2207)) | never |

`Button` therefore overrides three methods: `reconcileRuleDeclaration` and `setReconciledCSSRules` for the three reconciled keys, and `setElementCSSRule` for the shorthand alone.[^shorthand-second-override] `border-radius`, the four `border-*` longhands and `color` are not isolated and keep going to `#id`.[^color-stays] The border longhands share `setReconciledCSSRules` with the isolated keys, so that override splits its bag and passes the rest to `super`.

### The overrides write with `set`, not `queue`

Every write to the isolated rule uses `StyleRule.set` ([StyleTarget.ts:35](packages/lib/src/typescript/lib/core/StyleTarget.ts#L35)), which queues while the rule is unmaterialised and writes through once it exists. `queue` would strand a write made after the first render.[^set-not-queue] A runtime setter additionally nudges the rule onto the stylesheet itself, gated on the element existing — the same gate [`commitCSSRule`](packages/lib/src/typescript/lib/core/Component.ts#L1649) uses for the `#id` rule, so construction stays JS-only as `ARCHITECTURE.md` requires.

### `Component.matchesClassStyle` becomes `protected`

The comparison against the class-tier bag stays defined once, in `Component`. Widening [`matchesClassStyle`](packages/lib/src/typescript/lib/core/Component.ts#L4716) from `private` to `protected` is the whole core change; no body moves and no behaviour changes.[^protected-comparison]

### A chromeless Button keeps its resting chrome on the bare `#id` rule

Isolation applies only to instances that took the chromeful path in [`applyChromeOptions`](packages/lib/src/typescript/lib/component/button/Button.ts#L920). A chromeless Button has no pressed treatment to isolate from, and leaving its resting chrome at `(1,0,0)` is what makes it outrank the shared `.ClassName.pressed` rule — which is `chromeless`'s documented contract. A private `_restingChromeIsolated` flag, defaulting to `true` and set to `false` by the chromeless branch, is the single predicate all three overrides read.[^chromeless-routing]

Three concrete instances:

| Button | isolated | deviating resting `background-color` lands on | shared `.pressed` class rule |
|---|---|---|---|
| `new Button('Save', { backgroundColor: 'red' })` | yes | `#id:not(.pressed)` | `.Button.pressed`, four declarations |
| `new Button({ glyph, chromeless: true })` (window controls) | no | `#id` `(1,0,0)` — outranks the class rule | `.Button.pressed`, pinned per instance |
| `MenuBarButton` (chromeless in its class defaults) | no | `#id` `(1,0,0)` | none — the resolver returns `{}` |

The chromeless branch also clears the four isolated keys off the isolated rule, because `Component.applyOptions` dispatches `setBackgroundColor` and `setBackground` ([Component.ts:611-612](packages/lib/src/typescript/lib/core/Component.ts#L611)) *before* it calls `applyChromeOptions`. Left in place, those writes would sit at `(1,1,0)` and shadow every later `#id` write for the rest of the instance's life.

### A class whose own defaults are chromeless publishes no `.pressed` class rule

[`getPressedClassDeclarations()`](packages/lib/src/typescript/lib/component/button/Button.ts#L599) returns `{}` when `this._defaultOptions.chromeless` is true. `MenuBarButton` and `PickerButton` never dispatch pressed chrome, so a shared `.MenuBarButton.pressed` rule would deliver declarations no instance ever asked for.[^class-default-chromeless]

That check reads a *class-level* default rather than the instance's resolved `isChromeless()`, because `ensureClassStateRule` caches one bag per class: an instance-level answer would make the class's bag depend on which instance happened to be constructed first.

### An instance-level chromeless Button pins the class rule's declarations

`new Button({ chromeless: true })` is a `Button`, so it carries the CSS class `Button` and matches whatever `.Button.pressed` a chromeful sibling materialised — and it dispatches no pressed setter of its own to outrank it. Its resting chrome only reaches `#id` where it *deviates* from the class rule; where the two agree, `#id` declares nothing and the shared pressed rule shows through on press. The chromeless branch therefore writes each declaration the class bag carries onto the instance's own `#id.pressed` rule, at that instance's current resting value, so the guarantee does not depend on which neutrals happen to deviate. This generalises the single `color` pin the prior plan added at [Button.ts:973](packages/lib/src/typescript/lib/component/button/Button.ts#L973), which exists because a chromeless Button's resting `color` is exactly such an agreeing value.

### `clearPressedX()` pins the resting value instead of removing the property

`clearPressedBackgroundColor` / `clearPressedBackgroundImage` / `clearPressedShadow` currently write `null`, a CSSOM `removeProperty`. That relied on the resting `#id` declaration showing through while pressed — which isolation ends, and which the widened class bag would fill with the class default instead. Each of the three now writes the current resting value, falling back to the property's neutral when there is none.[^clear-pins] The hover counterparts are unchanged.[^hover-clears-unchanged]

| Call | writes today | writes after |
|---|---|---|
| `SpinButton`'s `clearPressedShadow()`, after its own `clearShadow()` | `boxShadow: null` | `boxShadow: "none"` |
| `Dialog`'s `clearPressedBackgroundImage()`, after `clearBackgroundImage()` | `backgroundImage: null` | `backgroundImage: "none"` |
| `_applyFlatChrome`'s `clearPressedBackgroundImage()` | `backgroundImage: null` | `backgroundImage: "none"` |

### `_restoreChrome` forces a real write for every restored pressed declaration

[`writeClassStateDeclaration`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L345) skips a write whose value matches the class bag. On the restore path that skip is wrong: the instance rule may still hold a pin from an earlier flat or chromeless pass, and skipping leaves the pin in place forever. [`_restoreChrome`](packages/lib/src/typescript/lib/component/button/Button.ts#L1906) already forces the write for `color`; the same forced write is added for the three widened keys, carrying the class-default *value* rather than a removal.[^restore-writes-values]

### Hover and selected states stay out of the class tier

`getHoverClassDeclarations()` keeps returning `{}` and `ToggleButton.selectedClassBag` keeps returning `null`. Isolation raises a deviating resting rule from `(1,0,0)` to `(1,1,0)`, which is still beaten by `#id:hover:not(.pressed)` `(1,2,0)` and `#id.selected:not(:hover)` `(1,2,0)`, so those two states keep working untouched. A *class*-tier hover or selected rule sits at `(0,3,0)`, which loses to any deviating instance's resting rule at `(1,1,0)` — so neither state can be deduped by this plan.

---

## Public API

No exported symbol is added, removed, or re-signed. Three public setters change documented behaviour:

```typescript
// component/button/Button.ts — same signatures, new semantics.

/** Pins the `.pressed` background-color to this button's current resting
 *  background-color (or `"transparent"`), instead of removing the property. */
clearPressedBackgroundColor(): this;

/** Pins the `.pressed` background-image to this button's current resting
 *  background-image (or `"none"`), instead of removing the property. */
clearPressedBackgroundImage(): this;

/** Pins the `.pressed` box-shadow to this button's current resting box-shadow
 *  (or `"none"`), instead of removing the property. */
clearPressedShadow(): this;
```

One `Component` member changes visibility. TypeDoc runs with `excludeProtected: true`, so the API docs are unaffected:

```typescript
// core/Component.ts — body unchanged, `private` becomes `protected`.
protected matchesClassStyle(key: string, value: string | null): boolean;
```

New non-public members on `Button`:

```typescript
private declare _restingStyleRule?: StyleRule;
private get restingStyleRule(): StyleRule;              // createStyleRule(":not(.pressed)")

private declare _restingChromeIsolated?: boolean;       // defaults to true; false for chromeless
private isRestingChromeIsolated(): boolean;

private materialiseRestingRule(): void;
private pinPressedToResting(): void;

protected override reconcileRuleDeclaration(key: string, value: string | null): void;
protected override setReconciledCSSRules(values: Style): this;
protected override setElementCSSRule(key: string, value: Object | null): this;
```

`getPressedClassDeclarations()` keeps its existing `protected` signature and override contract.

---

## Internal Structure

### The reconciled key set

```typescript
// component/button/Button.ts, module scope.

/**
 * The resting-chrome declarations Button routes onto its own
 * `#id:not(.pressed)` rule rather than the bare `#id` rule, so the shared
 * `.ClassName.pressed` rule is unopposed while the button is pressed. These
 * are the three properties `Component` reconciles against the class-tier bag
 * and the `.pressed` class rule also declares; the `background` shorthand is
 * isolated too, through `setElementCSSRule` below, because its setters still
 * use the plain single-key write path. `border-radius`, the border longhands
 * and `color` are not isolated and stay on `#id`.
 */
const RESTING_RECONCILED_KEYS: ReadonlySet<string> = new Set([
    "backgroundColor",
    "backgroundImage",
    "boxShadow",
]);
```

### The three routed write paths

```typescript
/**
 * Routes the three reconciled resting declarations onto `#id:not(.pressed)`.
 * `applyStyle`'s phases reach the rule through this hook. The class-tier
 * comparison is preserved: a value the class rule already delivers is written
 * as a removal, so a button holding its class defaults leaves the isolated
 * rule empty and it is never inserted.
 */
protected override reconcileRuleDeclaration(key: string, value: string | null): void {
    if (!this.isRestingChromeIsolated() || !RESTING_RECONCILED_KEYS.has(key)) {
        super.reconcileRuleDeclaration(key, value);

        return;
    }

    this.restingStyleRule.set(key, this.matchesClassStyle(key, value) ? null : value);
}

/**
 * Runtime-setter counterpart of the hook above — `setBackgroundColor`,
 * `setBackgroundImage`, `setShadow` and their `clear*` siblings arrive here.
 * `setBorder` / `clearBorder` arrive here too, with a bag of four border
 * longhands that are not isolated and go on to `super`.
 */
protected override setReconciledCSSRules(values: Style): this {
    if (!this.isRestingChromeIsolated()) {
        return super.setReconciledCSSRules(values);
    }

    const rest: Style = {};
    let   isolated    = false;

    for (const key of Object.keys(values)) {
        if (!RESTING_RECONCILED_KEYS.has(key)) {
            rest[key] = values[key];

            continue;
        }

        isolated = true;
        this.restingStyleRule.set(key, this.matchesClassStyle(key, values[key]) ? null : values[key]);
    }

    if (isolated) {
        this.materialiseRestingRule();
    }

    return Object.keys(rest).length > 0 ? super.setReconciledCSSRules(rest) : this;
}

/**
 * Routes the `background` shorthand — the one isolated key whose setters still
 * use Component's plain single-key write path. No class-tier bag ever carries
 * `background`, so there is nothing to compare against and the value is
 * written as given.
 */
protected override setElementCSSRule(key: string, value: Object | null): this {
    if (!this.isRestingChromeIsolated() || key !== "background") {
        return super.setElementCSSRule(key, value);
    }

    this.restingStyleRule.set(key, value ? String(value) : null);
    this.materialiseRestingRule();

    return this;
}

/**
 * Inserts the isolated rule when a setter has queued a real declaration onto
 * it after the element exists. `applyStyle` materialises deferred rules at the
 * end of a render pass; a setter firing later has no such pass behind it, so
 * it nudges the rule itself. A bag holding only `null` removals is left
 * unmaterialised, as `Component` does for every other deferred rule.
 */
private materialiseRestingRule(): void {
    if (this.getElement() && this.restingStyleRule.hasQueuedDeclarations()) {
        this.restingStyleRule.ensure();
    }
}
```

### The pin helper

```typescript
/**
 * Writes every declaration the shared `.ClassName.pressed` rule carries onto
 * this instance's own `#id.pressed` rule, at this instance's resting value.
 * A chromeless button never dispatches pressed chrome, so without this the
 * shared rule — materialised by any chromeful sibling of the same class —
 * would show through on press. Writes straight to the rule rather than
 * through `writeClassStateDeclaration`, because the point is to outrank the
 * class rule even when the two values coincide.
 */
private pinPressedToResting(): void {
    const bag = this.pressedClassBag;

    if (!bag) {
        return;
    }

    const resting: Record<string, string> = {
        color:           this.getForegroundColor() ?? "inherit",
        backgroundColor: this.getBackgroundColor() ?? "transparent",
        backgroundImage: this.getBackgroundImage() ?? "none",
        boxShadow:       this.getShadow()          ?? "none",
    };

    for (const key of Object.keys(bag)) {
        if (resting[key] !== undefined) {
            this.pressedStyleRule.set(key, resting[key]);
        }
    }
}
```

### The widened class-tier resolver

```typescript
protected getPressedClassDeclarations(): Record<string, string | null> {
    const d = this._defaultOptions;

    // A class whose own defaults are chromeless never dispatches pressed
    // chrome, so it must publish no shared rule at all.
    if (d.chromeless) {
        return {};
    }

    const out: Record<string, string | null> = {};

    if (d.pressedForegroundColor !== undefined) out.color           = d.pressedForegroundColor;
    if (d.pressedBackgroundColor !== undefined) out.backgroundColor = d.pressedBackgroundColor;
    if (d.pressedBackgroundImage !== undefined) out.backgroundImage = d.pressedBackgroundImage;
    if (d.pressedShadow          !== undefined) out.boxShadow       = d.pressedShadow;

    return out;
}
```

---

## Ordered Implementation Steps

Run `npm run typecheck` after any step that changes a signature.

1. **Create `packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts`** covering `## Expected Behaviour` rows 1-11. Copy the `idSelector` and `declarationsDuring` helpers from `Button.pressedHoverClassHoisting.test.ts`, which itself copied them from `ClassStyleRules.test.ts`, and reuse that file's warm-up convention for the process-global `.Button.pressed` rule.
   *Check:* `npx vitest run tests/component/button/Button.restingChromeIsolation.test.ts` — every case fails, and for the stated reason (writes land on `#id`, `#id.pressed` still carries the three keys).

2. **`packages/lib/src/typescript/lib/core/Component.ts` — widen the comparison predicate.** Change `matchesClassStyle` (line 4716) from `private` to `protected`. Nothing else in that file changes.
   *Check:* `npm run typecheck`.

3. **`packages/lib/src/typescript/lib/component/button/Button.ts` — add the reconciled key set.** Add the `RESTING_RECONCILED_KEYS` module constant from `## Internal Structure`, next to the existing `BUTTON_RESTING_BACKGROUND` constant (line 214). It holds the three reconciled keys only — the `background` shorthand is matched by name in its own override, so it is deliberately absent.

4. **Button.ts — add the resting rule and the routing flag.** Beside the existing `_hoverStyleRule` getter (line 555) add the `_restingStyleRule` backing slot, the `restingStyleRule` lazy getter calling `this.createStyleRule(":not(.pressed)")`, the `_restingChromeIsolated` slot, and `isRestingChromeIsolated()` returning `this._restingChromeIsolated ?? true`. Both slots use `declare` with no initializer — they are written during the `super()` cascade, per `CODE_CONVENTIONS.md`. Reuse the `_pressedStyleRule` comment's explanation of why the slot is only a cache.

5. **Button.ts — add the three routing overrides and `materialiseRestingRule`,** exactly as given in `## Internal Structure`, placed after the lazy rule getters. `Style` comes from `~/core/Component.js`, which Button already imports from — extend that import rather than adding a second one.
   *Check:* `npm run typecheck` — `setElementCSSRule`'s parameter type is `(key: string, value: Object | null)`, not `string | null`.

6. **Button.ts — widen `getPressedClassDeclarations()`** (line 599). Replace the body with the version in `## Internal Structure` and rewrite its doc comment: it no longer explains why three properties are excluded, it explains that a deviating resting tier is isolated behind `:not(.pressed)` so the class rule is unopposed. Leave `getHoverClassDeclarations()` (line 615) returning `{}`, but reword its doc comment, which currently defers to the pressed resolver's now-deleted explanation: hover is never deduped because a class-tier hover rule sits at `(0,3,0)` and loses to a deviating instance's isolated resting rule at `(1,1,0)`, and because `hoverForegroundColor` carries no class default to begin with.

7. **Button.ts — add `pinPressedToResting()`** as given in `## Internal Structure`, placed next to `_clearChrome` / `_restoreChrome`.

8. **Button.ts — rework the chromeless branch of `applyChromeOptions`** (lines 922-976). At the top of the branch, before the existing `clearBorder()` call, set `this._restingChromeIsolated = false` and — guarded on `this._restingStyleRule !== undefined`, so a button that never allocated the rule does not allocate one here — clear it with `this._restingStyleRule.setMany({ background: null, backgroundColor: null, backgroundImage: null, boxShadow: null })`. Read the backing slot directly, not the lazy getter. At the end of the branch, replace the single `setPressedForegroundColor(...)` pin (line 973) with a call to `this.pinPressedToResting()`, keeping the explanatory comment above it and updating it to cover all four pinned declarations. Leave the rest of the branch untouched.

9. **Button.ts — pin in the three `clearPressedX` setters.** In `clearPressedBackgroundColor` (line 2302), `clearPressedBackgroundImage` (line 2337) and `clearPressedShadow` (line 2485), replace the `null` argument to `writeClassStateDeclaration` with `this.getBackgroundColor() ?? "transparent"`, `this.getBackgroundImage() ?? "none"` and `this.getShadow() ?? "none"` respectively. Keep the `this._options.pressedX = undefined` line in each. Update each doc comment per `## Public API`. Leave `clearPressedForegroundColor` and every `clearHoverX` untouched.

10. **Button.ts — force the restore writes in `_restoreChrome`** (line 1906). The `pressedForegroundColor` block already pairs its setter with `this.pressedStyleRule.set("color", ...)`. Give `pressedBackgroundColor`, `pressedBackgroundImage` and `pressedShadow` the same treatment, each writing `backgroundColor` / `backgroundImage` / `boxShadow` at the class-default value. Reuse the existing block's comment.

11. **`packages/lib/tests/core/ClassChromeRules.test.ts` — retarget the row-14 case** ("setChromeless(false) after setChromeless(true) restores the class-tier chrome via removals", line 352). Its Button is chromeful and therefore isolated, so both the `setChromeless(true)` neutrals and the `setChromeless(false)` removals now land on `#id:not(.pressed)`. Change the selector passed to `declarationsDuring` from `idSelector(btn)` to `idSelector(btn) + ':not(.pressed)'` and add one sentence to the case's comment naming this plan. Leave the row-13 case alone — its Button is chromeless and still writes to `#id`.
    *Check:* `npx vitest run tests/core/ClassChromeRules.test.ts` — green.

12. **`packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts` — update the two cases the widening inverts.** In the first case (line 82), `backgroundColor` / `backgroundImage` / `boxShadow` on the second Button's `#id.pressed` become `toBeUndefined()`, and the case title changes accordingly. In the `SpinButton` case (line 139), `instanceDeclarations.boxShadow` becomes `toBe('none')` instead of `toBeNull()`. Replace the file's `IMPORTANT SCOPE NOTE` header comment (lines 9-21) with a short pointer to this plan. Leave the hover case and the three chromeless cases as they are.

13. **`packages/lib/tests/component/button/TabButton.stateClassHoisting.test.ts` — correct the stale wording.** The first case's title (line 78) says the `.pressed` class rule is `(color only)`; it now carries four declarations. Rewrite the file's `IMPORTANT SCOPE NOTE` header (lines 11-24) too: its claim that TabButton's resting chrome "writes unconditionally onto the instance's base `#id` rule, at specificity (1,0,0)" is no longer true for a class-defaulted or an isolated value, and its `(0,5,0)` figure for `.TabButton:hover:not(.pressed)` is wrong — that selector is `(0,3,0)`. Say instead that hover and selected stay per-instance because a deviating resting rule at `(1,1,0)` outranks any class-tier state rule. The assertions themselves are unchanged.

14. **`packages/lib/src/typescript/lib/core/ClassStyleRules.ts` — refresh one stale doc paragraph.** `writeClassStateDeclaration`'s `@remarks` (lines 337-343) ends by saying the one concrete case the `null`-write hazard surfaces — `Button`'s pressed shadow, cleared by `SpinButton` / `Dialog` / `Notification` — "stays correct today via each call site's paired base-tier `clearShadow()`". After step 9 those setters write a real resting value instead of `null`, so replace that closing sentence with a pointer to `Button.clearPressedShadow` / `clearPressedBackgroundColor` / `clearPressedBackgroundImage` pinning the resting value. The general warning about `null` writes above it stays as it is; no code changes in this file.

15. **`packages/lib/docs/reference/changelog/next.md`** — add the entries described in `## Documentation Impact`, under the existing `## Changed` → `### Components` heading.

16. **Regression checkpoints.**
    - `grep -rn 'styleRules:' packages/lib/src` — expect four hits: `overlay/windowControls.ts:51` and `:66`, `component/menubar/MenuBarButton.ts:95`, and one doc-comment example in `core/Component.ts:100`. Both consumer files pass their bag to a `chromeless: true` Button, which is not isolated. A bag on a chromeful Button whose suffix is one class or fewer would tie with, or lose to, the isolated rule.
    - `grep -rn '\.setBackground(' packages/lib/src` — expect `overlay/windowControls.ts` (chromeless Buttons) and `layout/Accordion.ts` (an `AccordionHeader`, which extends `Component`, not `Button`).
    - `grep -rn 'clearPressedShadow\|clearPressedBackground' packages/lib/src` — every hit must be `Button.ts` itself, `SpinButton.ts`, `Dialog.ts` or `Notification.ts`. Each consumer must already have cleared the matching *resting* property before its `clearPressedX` call, or the pin captures a value the caller did not intend.
    - `npm run typecheck && npm run test`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Create | `packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts` |
| Modify | `packages/lib/tests/core/ClassChromeRules.test.ts` |
| Modify | `packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts` |
| Modify | `packages/lib/tests/component/button/TabButton.stateClassHoisting.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-11 are unit-testable against the recording DOM sink, which records every `setRuleStyles` call with its selector; `_ruleCacheHas(selector)` reports whether a rule was inserted at all. Rows 12-15 are cascade outcomes the sink cannot evaluate and must be checked in a browser.

| # | Case | Expected |
|---|---|---|
| 1 | A default `new Button('Save')` renders | no write to `#id:not(.pressed)` is recorded, and no such rule is inserted |
| 2 | A default Button renders after a first Button has warmed the class rule | no `#id.pressed` rule is inserted at all, and `.Button.pressed` is in the rule cache |
| 3 | `new Button('x', { backgroundColor: 'red' })` renders | `#id:not(.pressed)` receives `backgroundColor: 'red'`; the bare `#id` rule receives no `backgroundColor` |
| 4 | `button.setBackgroundColor('red')` after render, on a chromeful Button | `#id:not(.pressed)` receives `backgroundColor: 'red'` immediately, without a further render; the bare `#id` rule receives no `backgroundColor` |
| 5 | …then `button.setBackgroundColor(<the class default token>)` | `#id:not(.pressed)` receives `backgroundColor: null` — a removal, not a skipped write |
| 6 | `button.setBackground('red')` after render, on a chromeful Button | `#id:not(.pressed)` receives `background: 'red'`; the bare `#id` rule receives no `background` |
| 7 | `new Button({ chromeless: true })` renders | the bare `#id` rule receives `backgroundColor`; `#id.pressed` receives all four keys the class bag carries; no `#id:not(.pressed)` rule is inserted |
| 8 | `new Button('x', { backgroundColor: 'red', chromeless: true })` renders | the bare `#id` rule receives `backgroundColor: 'red'`, and no `#id:not(.pressed)` rule is inserted — the chromeless branch cleared what the earlier `setBackgroundColor` dispatch had queued there |
| 9 | `new MenuBarButton(...)` renders, then `setActive(true)` writes a resting `backgroundColor` that deviates from the class default | no `.MenuBarButton.pressed` rule is inserted, and the deviating value lands on the bare `#id` rule, not on `#id:not(.pressed)` — a chromeless class is not isolated |
| 10 | `SpinButton`'s constructor-time `clearPressedShadow()` | `#id.pressed` receives `boxShadow: 'none'`, never `null` |
| 11 | `button.setFlat(true)` then `setFlat(false)` | `#id.pressed` receives `backgroundColor`, `backgroundImage`, `boxShadow` and `color` at their class-default values on the restore, even though each matches the class bag |
| 12 | Press a default Button in the browser | the background visibly changes from resting to the pressed token, and the computed `background-color` with `.pressed` forced differs from the resting one |
| 13 | Hover a default Button, then press it while still hovering | hover shows the hover fill; pressing shows the pressed fill, not the hover or resting fill |
| 14 | Press a `Dialog` close button, a `Notification` close button, a tab's ✕, a `SpinButton` arrow and a flat toolbar Button | each keeps today's pressed look — no gradient or drop shadow appears on any of them |
| 15 | Blur a window with controls, then focus it again | the controls flatten to transparent on blur and recover their themed fill on focus — `setWindowControlsActive`'s `background` shorthand still wins |

Rows 12-15 are the ones an automated suite cannot catch: the prior plan shipped a passing suite alongside a live regression of exactly this shape, so treat the browser check as mandatory rather than confirmatory.

---

## Verification

1. `npm run typecheck` — zero errors.
2. `npm run test` — the whole suite, not just the button files. `Button.test.ts`, `Button.pressedState.test.ts`, `ToggleButton.selectedClassHoisting.test.ts`, `TabButton.styleRuleDisposal.test.ts` and `tests/core/ClassStateRules.test.ts` must all stay green without further edits; a failure in any of them means the isolation reached further than intended.
3. The three greps in step 16.
4. `npm run docs:api` — zero warnings, since three public setters' JSDoc changed.
5. Browser check for `## Expected Behaviour` rows 12-15, against a dev server started on a spare port from this worktree — not the main tree's server, which serves different source. Exercise: a plain `Button` (press and hover it), the `#/menubar` screen (a `MenuBarButton` must not gain a pressed background), a `Tab` strip (selected tabs must still render distinctly from unselected ones, and the ✕ must not gain a gradient on press), a `Dialog` and a `Notification` (their close buttons must not gain a shadow or gradient on press), a `SpinButton` (no pressed shadow), a flat toolbar button, and a window's control buttons (focus/blur flattening). Compare computed styles with `.pressed` forced on — a static screenshot cannot distinguish a working cascade from a broken one.

---

## Documentation Impact

No export surface changes, so no doc page, catalog entry or barrel is touched. `matchesClassStyle` stays out of the API docs either way, since TypeDoc runs with `excludeProtected: true`. Two updates are needed:

- **JSDoc on `clearPressedBackgroundColor` / `clearPressedBackgroundImage` / `clearPressedShadow`** — each currently says it removes the property from the `.pressed` rule. Each must say it pins the `.pressed` value to the button's current resting value, and name the fallback (`"transparent"` / `"none"` / `"none"`). Per `CODE_CONVENTIONS.md`, these public comments must not `{@link}` the private members introduced here — describe the behaviour in prose.
- **`packages/lib/docs/reference/changelog/next.md`**, under `## Changed` → `### Components`: one entry saying that a Button which customises its resting background or shadow now carries that value on an internal `:not(.pressed)` rule, so the pressed treatment is served by a rule shared across every Button of that class, with no consumer action needed; and one entry recording that `clearPressedBackgroundColor()`, `clearPressedBackgroundImage()` and `clearPressedShadow()` now pin the resting value rather than removing the declaration — the same rendered result, reached differently.

---

## Potential Challenges

- **A consumer style rule at `(1,1,0)` now ties with the isolated rule.** A `styleRules` entry allocates a `#id<suffix>` rule, so a one-class suffix (`":hover"`, `".active"`) sits at `(1,1,0)` — the same specificity as `#id:not(.pressed)`, decided by stylesheet order. Every such entry in this repo is on a chromeless Button, which is not isolated; `MenuBarButton`'s `":hover"` entry is the only single-class one. Step 16's `styleRules` grep plus the `#/menubar` browser check cover it; a consumer outside this repo hitting the tie should lengthen its own suffix, as `hoverStyleRule` does.
- **De-isolation is one-way.** `_restingChromeIsolated` is only ever set to `false`, by the chromeless branch. A button that goes chromeless and is then made chromeful again through `applyOptions({ chromeless: false })` stays un-isolated, keeps the chromeless neutrals on `#id`, and shows no pressed background — matching `ButtonOptions.chromeless`'s documented advice to use `setChromeless` for a runtime flip, which routes through `_restoreChrome` and works correctly. Re-isolating would mean moving live declarations between two rules mid-flight; nothing in this repo needs it.
- **The pin captures the resting value at call time.** `pinPressedToResting()` and the three `clearPressedX` setters read `getBackgroundColor()` / `getBackgroundImage()` / `getShadow()` when they run. A chromeless Button that changes its resting chrome afterwards keeps the older pinned value on its `#id.pressed` rule. Nothing in this repo does that — `MenuBarButton.setActive` is the one runtime resting-chrome change on a chromeless button, and `MenuBarButton` publishes no `.pressed` class rule, so nothing is pinned for it to go stale.
- **`setId()` on an already-rendered Button.** `Component.setId` rebuilds only the bare `#id` rule; deferred rules keep the old id in their selector. This already affects `.pressed` and `:hover:not(.pressed)`, and now affects the isolated resting rule too. A construction-time `{ id }` is safe — `applyOptions` dispatches `setId` before any rule is allocated. No in-repo call site calls `setId` on a rendered Button.
- **`_restingChromeIsolated` is a `declare` field written during the `super()` cascade.** A plain initializer would run after `super()` returns and silently reset a chromeless button back to isolated. `isRestingChromeIsolated()` supplies the `true` default instead.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/button/Button.ts`](packages/lib/src/typescript/lib/component/button/Button.ts) — the mechanism's home. Read `_defaultButtonOptions` (L224), the lazy rule getters and class bags (L535-L617), `applyChromeOptions` (L920), `_clearChrome` (L1867), `_restoreChrome` (L1906), `_applyFlatChrome` (L2059) and the pressed setters (L2274-L2490).
- [`packages/lib/src/typescript/lib/component/button/Button.ts#L556`](packages/lib/src/typescript/lib/component/button/Button.ts#L556) — `hoverStyleRule`, the `:hover:not(.pressed)` precedent this plan mirrors.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `matchesClassStyle` (L4716), `writeRuleDeclaration` (L4736), `reconcileRuleDeclaration` (L4750), `setReconciledCSSRules` (L4760), `setElementCSSRule` (L1628), `commitCSSRule` (L1649), `createStyleRule` (L1009), `applyStyle`'s phases (L4799-L4981), `materialiseWhenNeeded` (L5063) and `materialiseDeferredRules` (L5090).
- [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) — `resolveDeclarations`'s conditional chrome keys (L155-L157), `ensureClassStateRule` (L287) and `writeClassStateDeclaration` (L345), all used unchanged.
- [`packages/lib/src/typescript/lib/core/StyleTarget.ts`](packages/lib/src/typescript/lib/core/StyleTarget.ts) — `set` vs `queue` (L35, L61), `hasQueuedDeclarations` (L108), `ensure` (L307) and `_selectorOf` (L193), which appends the suffix verbatim.
- [`plans/implemented/component-chrome-base-tier-hoisting.md`](plans/implemented/component-chrome-base-tier-hoisting.md) — the clear-on-match rule this plan's overrides inherit, and its `## Implementation Notes` sweep of shared state rules.
- [`plans/implemented/hoist-button-tabbar-state-chrome-rules.md`](plans/implemented/hoist-button-tabbar-state-chrome-rules.md) — its `## Implementation Notes` is the record of why the class tier was narrowed to one property.
- [`packages/lib/src/typescript/lib/overlay/windowControls.ts`](packages/lib/src/typescript/lib/overlay/windowControls.ts), [`component/menubar/MenuBarButton.ts`](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts) — the chromeless Buttons with consumer `styleRules`, and the reason chromeless instances are not isolated.
- [`packages/lib/src/typescript/lib/component/input/SpinButton.ts#L99`](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L99), [`overlay/Dialog.ts#L238`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L238), [`overlay/Notification.ts#L211`](packages/lib/src/typescript/lib/overlay/Notification.ts#L211) — the three `clearPressedX` consumers whose behaviour the pin preserves.
- [`packages/lib/tests/core/ClassChromeRules.test.ts`](packages/lib/tests/core/ClassChromeRules.test.ts) — the base-tier suite whose row-14 case this plan retargets.

---

## Non-Goals

- **Deduping the resting tier further, onto a shared `.ClassName:not(.pressed)` rule.** The base tier already serves a Button that keeps its class defaults; a second class-tier rule would only serve deviating instances, which by definition disagree on the value.
- **Hover or selected class-tier dedup.** See the architecture decision above: a deviating instance's resting rule at `(1,1,0)` still outranks a class-tier hover or selected rule at `(0,3,0)`.
- **Re-isolating a de-isolated Button.** See `## Potential Challenges`; `setChromeless(false)` already restores a working pressed treatment without it.
- **The known `foregroundColor` gap.** A Button given a custom resting `foregroundColor` and a default `pressedForegroundColor` still shows the custom colour while pressed, because `#id { color }` `(1,0,0)` outranks `.Button.pressed` `(0,2,0)`. `color` is not in the isolated set, so this plan neither fixes nor worsens it.
- **Widening the base-tier hoistable set** (`ClassStyleDefaults` in `core/ClassStyleRules.ts`). `component-chrome-base-tier-hoisting` owns that axis and has shipped.
- **`ToggleButton.ts` and `TabButton.ts`.** Their `.selected:not(:hover)` and hover state rules sit at `(1,2,0)` on the instance tier, which still outranks the isolated resting rule at `(1,1,0)`, so neither class needs a source change or a wider exclusion list.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^prior-scope]: The prior plan's `## Implementation Notes` records the finding in full: a first pass deduped `backgroundColor` / `backgroundImage` / `boxShadow` onto `.Button.pressed`, passed the whole automated suite, and shipped a live regression — every default-styled Button's pressed background stopped changing, and every `TabButton`'s selected tab rendered with the unselected gray. The cause was that the automated suite only ever asserted on *what got written*, never on what the browser's cascade resolves. The scope was then cut to `pressedForegroundColor`, leaving the generic mechanism built but almost unused. `TabButton`'s four border longhands were dropped for the same reason; this plan does not restore them, because they would need the pressed bucket to declare a border it has no default for — pressing a `TabButton` would drop its frame to the UA `<button>` border.

[^keep-class-comparison]: Dropping the comparison and always writing the value onto the isolated rule would be simpler by three lines and would undo the base-tier saving `component-chrome-base-tier-hoisting` just shipped for the whole Button family: every Button would again carry three chrome declarations of its own, only on a different selector. Keeping it means the isolated rule exists solely for instances that genuinely deviate, and `Component`'s clear-on-match rule still holds — a value that later returns to the class default is written as a removal, so nothing stale can survive at `(1,1,0)` and outrank the class rule.

[^shorthand-second-override]: Three of the four isolated keys now route through `reconcileRuleDeclaration` / `setReconciledCSSRules`; `setBackground` / `clearBackground` (Component.ts:2195 / 2207) are the sole exception still on the singular `setElementCSSRule` path, because no class-tier bag ever declares the `background` shorthand and there is nothing for them to reconcile against. Two options were weighed. Leaving `background` un-isolated would have cost nothing in this repo — the only Button caller is `windowControls.ts`'s `setWindowControlsActive`, on chromeless buttons — but would split a deviating Button's background declarations across two specificity tiers: the shorthand at `(1,0,0)` would sit *below* the longhands at `(1,1,0)` and silently stop taking effect, where today both live in one block and the last write wins. Isolating it keeps the shorthand and the longhands in the same rule, and keeps the shorthand out of the pressed state's way for the same reason the longhands are moved. A one-key override of `setElementCSSRule` is the complete routing for it, since no `applyStyle` phase writes the shorthand at all.

[^set-not-queue]: `StyleTarget.queue` only fills the dirty bag; the drain happens in `flush`. `Component.materialiseStyleRule` pairs `materialiseWhenNeeded` with an explicit `flush()` for exactly that reason, but `materialiseDeferredRules` calls `materialiseWhenNeeded` alone — and `StyleRule.ensure()` returns an already-materialised rule without draining. A queued write onto an already-materialised isolated rule would therefore sit in the bag indefinitely. `set` has no such failure mode, and it is what every other Button state-rule writer already uses through `writeClassStateDeclaration`.

[^protected-comparison]: Button needs the same answer `Component`'s own reconcile helpers compute: does the class-tier rule already deliver this value for this key. The alternative is for Button to call `ensureClassStyleRule` itself, which `component-chrome-base-tier-hoisting` explicitly ruled out — resolving the class rule from a setter would register it during construction, before the class defaults have finished resolving. Widening the existing predicate keeps one definition of the comparison and one resolution point (`applyStyle`). The change is a keyword: no body moves, no call site changes, and `excludeProtected: true` keeps it out of the API docs.

[^color-stays]: `foregroundColor` is one of the keys `ClassStyleDefaults` hoisted long before the chrome group, so a default-styled Button's resting `color` is served by `.Button` `(0,1,0)` and nothing on `#id` competes for it — which is why `pressedForegroundColor` was the one field the prior plan could keep. Isolating `color` too would close the residual gap listed under `## Non-Goals`, but `color` reaches `#id` through `writeRuleDeclaration`, whose skip-on-match leaves the caller no way to tell a matched value from a deviating one after the fact; routing it would need a fourth override plus its own comparison call, for a gap no in-repo Button hits.

[^chromeless-routing]: Three independent reasons converge on this. First, a chromeless Button dispatches no pressed setters, so with its resting chrome isolated there would be no declaration left to render while pressed and the shared class rule would fill the gap — the precise leak the prior plan's second audit round found for `color`. Second, every consumer-supplied `styleRules` entry on a Button in this repo is on a chromeless Button (`windowControls.ts`'s four entries and `MenuBarButton`'s `":hover"`), and raising a deviating resting declaration to `(1,1,0)` would tie with or sink the single-class ones. Third, the flag is written only in `applyChromeOptions`, never by `setChromeless`, so both runtime toggles stay correct without moving declarations between rules: `setChromeless(true)` leaves an isolated instance isolated and `_clearChrome`'s `clearPressedX` calls pin its pressed rule, and `setChromeless(false)` leaves a non-isolated instance on `#id` while `_restoreChrome`'s forced writes put the pressed values on `#id.pressed` `(1,1,0)`, which outranks `#id` `(1,0,0)`.

[^class-default-chromeless]: `Component.init` adds only `this.constructor.name` as a CSS class, not the ancestor chain, so a `MenuBarButton` element carries `MenuBarButton` and never matches `.Button.pressed`. The only rule that could reach it is `.MenuBarButton.pressed` — which is created by `MenuBarButton`'s own instances, through the pin the prior plan added. Returning `{}` for a chromeless-by-default class stops that rule existing at all, which is both cheaper and closer to `chromeless`'s contract; `pinPressedToResting` then writes nothing for those classes, because it iterates the bag's keys. `new Button({ chromeless: true })` is the different case the guard cannot cover: its concrete class is `Button`, whose defaults are chromeful, so it does share `.Button.pressed` with its chromeful siblings and does need the pin.

[^clear-pins]: All three consumers already clear the matching resting property immediately before the `clearPressedX` call — `SpinButton` calls `clearShadow()` then `clearPressedShadow()`, `Dialog` and `Notification` call `clearBackgroundImage()` / `clearShadow()` before their pressed clears, and `_applyFlatChrome` calls `clearBackgroundImage()` before `clearPressedBackgroundImage()`. So the pinned value is `"none"` in every current case, matching what removing the property produced before. Writing a real value rather than `null` is also what `Component.clearShadow` already does for the resting tier, for the same reason: a removal cannot outrank a lower-tier declaration, and `"none"` is the initial value for both `box-shadow` and `background-image`, so the two are equivalent except against a competing rule.

[^hover-clears-unchanged]: The hover class bag stays empty, so a `clearHoverX` write of `null` still means what it always meant: the hover rule declares nothing for that property and the cascade falls through to the resting declaration, wherever it lives — the isolated rule matches whenever the button is hovered and not pressed, exactly as `#id` did. `_applyFlatChrome`'s `clearHoverBackgroundImage()` / `clearHoverShadow()` and `Dialog`'s `clearHoverShadow()` / `clearHoverBackgroundImage()` therefore behave exactly as before.

[^restore-writes-values]: A removal would be enough for a button whose resting chrome is fully isolated, since nothing else at instance level would compete while pressed. It is not enough for the un-chromeless round trip, which is the path `_restoreChrome` exists for: a chromeless instance is not isolated, so a caller-supplied resting value it still carries sits on `#id` at `(1,0,0)` and would beat the class rule's pressed declaration. Writing the class-default value onto `#id.pressed` `(1,1,0)` covers both cases at the cost of one declaration on an instance that has already left the common path.

[^siblings-unchanged]: `ToggleButton`'s selected rule is `#id.selected:not(:hover)` `(1,2,0)`, which beats the isolated resting rule `(1,1,0)` just as it beat the bare `#id` `(1,0,0)`. `TabButton` adds no state selector of its own — its hover border, selected fill and selected border all ride `ToggleButton`'s and `Button`'s instance rules — and its resting border longhands are not isolated, so they keep painting while the tab is pressed. Both classes therefore need `:not(.pressed)` as their only exclusion and need no source change; a wider exclusion such as `:not(.pressed):not(.selected)` would only be needed to dedupe `.selected` onto the class tier, which `## Non-Goals` rules out.
