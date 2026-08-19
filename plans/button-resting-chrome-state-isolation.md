---
depends-on: [hoist-button-tabbar-state-chrome-rules]
touches-shared:
  - packages/lib/docs/reference/changelog/next.md
---

# Button Resting-Chrome State Isolation — Implementation Plan

## Overview

`plans/implemented/hoist-button-tabbar-state-chrome-rules.md` built a class-tier dedup mechanism for Button's `.pressed` state rule, then had to narrow it to a single property. The reason is a cascade conflict: `Button` writes its *resting* `background-color`, `background-image` and `box-shadow` onto the instance's bare `#id` rule, and a bare `#id` selector outranks any class-only selector no matter how many classes the latter chains. So the shared `.Button.pressed` rule's value for those three properties can never win, and deduping them silently removed the pressed treatment. Only `color` survived that audit.[^prior-scope]

This plan removes the conflict at its root. Button's resting `background-color` / `background-image` / `box-shadow` (plus the `background` shorthand) move off the bare `#id` rule onto a per-instance `#id:not(.pressed)` rule. `:not(.pressed)` and `.pressed` never match the same element at the same moment, so there is no cascade contest between them and no specificity arbitration to lose. With the contest gone, [`Button.getPressedClassDeclarations()`](packages/lib/src/typescript/lib/component/button/Button.ts#L597) widens from one property to four and the shared `.Button.pressed` rule finally carries the declarations the prior plan measured as the dominant duplicate.

The only source file changed is [`component/button/Button.ts`](packages/lib/src/typescript/lib/component/button/Button.ts). It reuses [`ensureClassStateRule`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L268) and [`writeClassStateDeclaration`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L326) exactly as the prior plan built them — neither `core/ClassStyleRules.ts` nor `core/StyleTarget.ts` nor `core/Component.ts` is modified.[^suffix-confirmed] `ToggleButton.ts` and `TabButton.ts` are not modified either.[^siblings-unchanged]

---

## Architecture Decisions

Throughout, CSS specificity is written as `(id, class, type)` — the standard three-number comparison, compared left to right. `#c17` is `(1,0,0)`; `.Button.pressed` is `(0,2,0)`; an id beats any number of classes.

### Isolate resting chrome behind `:not(.pressed)`, mirroring `hoverStyleRule`

Button already owns this pattern: [`hoverStyleRule`](packages/lib/src/typescript/lib/component/button/Button.ts#L556) is built as `createStyleRule(":hover:not(.pressed)")` so that hover and pressed are mutually exclusive on the element rather than competing on specificity. This plan applies the same idea one tier down: a new lazy `restingStyleRule = createStyleRule(":not(.pressed)")` carries the resting chrome that the pressed state overrides.

Once the resting declarations sit behind `:not(.pressed)`, they stop matching the moment the `pressed` class lands, so the shared class rule is unopposed:

| | rule holding resting `background-color` | rule holding pressed `background-color` | winner while pressed |
|---|---|---|---|
| today, if `backgroundColor` were deduped | `#id` `(1,0,0)` | `.Button.pressed` `(0,2,0)` | resting — pressed treatment lost |
| after this plan | `#id:not(.pressed)` `(1,1,0)` — does not match | `.Button.pressed` `(0,2,0)` | pressed |

The full per-state picture for a default `Button`, with the resting value on `#id:not(.pressed)`, the hover value on `#id:hover:not(.pressed)`, and the pressed value on `.Button.pressed`:

| Element state | Rules that match and declare `background-color` | Winner |
|---|---|---|
| resting | `#id:not(.pressed)` `(1,1,0)` | resting value |
| hovered | `#id:not(.pressed)` `(1,1,0)`, `#id:hover:not(.pressed)` `(1,3,0)` | hover value |
| pressed | `.Button.pressed` `(0,2,0)` | pressed value |
| hovered and pressed | `.Button.pressed` `(0,2,0)` | pressed value |

### The isolated set is exactly the four background/shadow properties

`background-color`, `background-image`, `box-shadow` and the `background` shorthand move; nothing else does. These are the properties Button's resting chrome and its `.pressed` class rule both declare.[^isolated-set] `border-radius`, the four `border-*` longhands and `color` stay on the bare `#id` rule.

`color` stays because it already works: Button's resting foreground is served by the base class rule `.Button` `(0,1,0)`, which `.Button.pressed` `(0,2,0)` beats.[^color-stays]

### Two write paths, both overridden in `Button`

Resting chrome reaches the `#id` rule two ways, and both must be routed:

| Path | Entry point | Example |
|---|---|---|
| render-time replay | [`Component.writeRuleDeclaration`](packages/lib/src/typescript/lib/core/Component.ts#L4720), called from `applyStyle`'s phases | a default Button's `backgroundColor` from `_defaultButtonOptions` |
| runtime setter | [`Component.setElementCSSRule`](packages/lib/src/typescript/lib/core/Component.ts#L1628), called from `setBackgroundColor` / `setShadow` / `clearBackgroundImage` / … | `_applyFlatChrome`'s `setBackgroundColor("transparent")` |

`Button` overrides both and redirects the four isolated keys to `restingStyleRule`. Neither override compares against a class bag: the base class tier carries none of these four properties, so `super.writeRuleDeclaration` would write them unconditionally anyway.[^no-resting-dedup]

### A chromeless Button keeps its resting chrome on the bare `#id` rule

Isolation applies only to instances that took the chromeful path in [`applyChromeOptions`](packages/lib/src/typescript/lib/component/button/Button.ts#L918). A chromeless Button has no pressed treatment to isolate from, and leaving its resting chrome at `(1,0,0)` is what makes it outrank the shared `.Button.pressed` rule — which is exactly `chromeless`'s documented contract. A private `_restingChromeIsolated` flag, defaulting to `true` and set to `false` by the chromeless branch, is the single predicate both overrides read.[^chromeless-routing]

Three concrete instances:

| Button | isolated | resting `background-color` lands on | shared `.pressed` class rule |
|---|---|---|---|
| `new Button('Save')` | yes | `#id:not(.pressed)` | `.Button.pressed`, four declarations |
| `new Button({ glyph, chromeless: true })` (window controls) | no | `#id` `(1,0,0)` — outranks the class rule | `.Button.pressed`, pinned per instance |
| `MenuBarButton` (chromeless in its class defaults) | no | `#id` `(1,0,0)` | none — the resolver returns `{}` |

### A class whose own defaults are chromeless publishes no `.pressed` class rule

[`getPressedClassDeclarations()`](packages/lib/src/typescript/lib/component/button/Button.ts#L597) returns `{}` when `this._defaultOptions.chromeless` is true. `MenuBarButton` and `PickerButton` never dispatch pressed chrome, so a shared `.MenuBarButton.pressed` rule would deliver declarations no instance ever asked for.[^class-default-chromeless]

That check reads a *class-level* default rather than the instance's resolved `isChromeless()`, because `ensureClassStateRule` caches one bag per class: an instance-level answer would make the class's bag depend on which instance happened to be constructed first.

### An instance-level chromeless Button pins the class rule's declarations

`new Button({ chromeless: true })` is a `Button`, so it carries the CSS class `Button` and matches whatever `.Button.pressed` a chromeful sibling materialised. Its resting `background-color` sits on `#id` and outranks that rule, but `background-image` and `box-shadow` have no resting declaration at all for a chromeless button, so the class rule would show through on press. The chromeless branch therefore writes each declaration the class bag carries onto the instance's own `#id.pressed` rule, at that instance's current resting value. This generalises the single `color` pin the prior plan added at [Button.ts:963](packages/lib/src/typescript/lib/component/button/Button.ts#L963).

### `clearPressedX()` pins the resting value instead of removing the property

`clearPressedBackgroundColor` / `clearPressedBackgroundImage` / `clearPressedShadow` currently write `null`, a CSSOM `removeProperty`. That relied on the resting `#id` declaration showing through while pressed — which isolation ends, and which the widened class bag would fill with the theme default instead. Each of the three now writes the current resting value (`"transparent"` / `"none"` / `"none"` when there is none), which is what those callers visually mean.[^clear-pins] The hover counterparts are unchanged.[^hover-clears-unchanged]

| Call | writes today | writes after |
|---|---|---|
| `SpinButton`'s `clearPressedShadow()`, after its own `clearShadow()` | `boxShadow: null` | `boxShadow: "none"` |
| `Dialog`'s `clearPressedBackgroundImage()`, after `clearBackgroundImage()` | `backgroundImage: null` | `backgroundImage: "none"` |
| `_applyFlatChrome`'s `clearPressedBackgroundImage()` | `backgroundImage: null` | `backgroundImage: "none"` |

### `_restoreChrome` forces a real write for every restored pressed declaration

[`writeClassStateDeclaration`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L326) skips a write whose value matches the class bag. On the restore path that skip is wrong: the instance rule may still hold a pin from an earlier flat or chromeless pass, and skipping leaves the pin in place forever. [`_restoreChrome`](packages/lib/src/typescript/lib/component/button/Button.ts#L1896) already forces the write for `color`; the same forced write is added for the three widened keys.

### Hover and selected states stay out of the class tier

`getHoverClassDeclarations()` keeps returning `{}` and `ToggleButton.selectedClassBag` keeps returning `null`. Isolating resting chrome raises the resting instance rule from `(1,0,0)` to `(1,1,0)`, which is still beaten by `#id:hover:not(.pressed)` `(1,3,0)` and `#id.selected:not(:hover)` `(1,2,0)` — so those two states keep working untouched. A *class*-tier hover or selected rule, at `(0,4,0)` / `(0,3,0)`, would still lose to a customised instance's resting rule at `(1,1,0)`, so neither state can be deduped by this plan.

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

New non-public members on `Button`:

```typescript
private declare _restingStyleRule?: StyleRule;
private get restingStyleRule(): StyleRule;              // createStyleRule(":not(.pressed)")

private declare _restingChromeIsolated?: boolean;       // defaults to true; false for chromeless
private isRestingChromeIsolated(): boolean;

private pinPressedToResting(): void;

protected override writeRuleDeclaration(key: string, value: string | null): void;
protected override setElementCSSRule(key: string, value: Object | null): this;
```

`getPressedClassDeclarations()` keeps its existing `protected` signature and override contract.

---

## Internal Structure

### The isolated key set

```typescript
// component/button/Button.ts, module scope.

/**
 * The resting-chrome declarations Button routes onto its own
 * `#id:not(.pressed)` rule rather than the bare `#id` rule, so the shared
 * `.ClassName.pressed` rule is unopposed while the button is pressed. These
 * are exactly the properties both the resting chrome and the `.pressed`
 * class rule declare; `border-radius`, the border longhands and `color` are
 * not among them and stay on `#id`.
 */
const RESTING_ISOLATED_KEYS: ReadonlySet<string> = new Set([
    "background",
    "backgroundColor",
    "backgroundImage",
    "boxShadow",
]);
```

### The two routed write paths

```typescript
/**
 * Routes the four isolated resting declarations onto `#id:not(.pressed)`.
 * `applyStyle`'s phases reach the rule through this hook.
 */
protected override writeRuleDeclaration(key: string, value: string | null): void {
    if (this.isRestingChromeIsolated() && RESTING_ISOLATED_KEYS.has(key)) {
        this.restingStyleRule.set(key, value);

        return;
    }

    super.writeRuleDeclaration(key, value);
}

/**
 * Runtime-setter counterpart of the hook above — `setBackgroundColor`,
 * `setShadow`, `clearBackgroundImage` and friends all funnel through here.
 */
protected override setElementCSSRule(key: string, value: Object | null): this {
    if (!this.isRestingChromeIsolated() || !RESTING_ISOLATED_KEYS.has(key)) {
        return super.setElementCSSRule(key, value);
    }

    this.restingStyleRule.set(key, value ? String(value) : null);

    // Mirror `commitCSSRule`'s gate: once the element exists a setter must
    // reach the stylesheet now, not at the next `applyStyle`. A bag holding
    // only `null` removals is left unmaterialised, as `materialiseWhenNeeded`
    // does for every other deferred rule.
    if (this.getElement() && this.restingStyleRule.hasQueuedDeclarations()) {
        this.restingStyleRule.ensure();
    }

    return this;
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

Each step names the file and the change. Run `npm run typecheck` after any step that changes a signature.

1. **`packages/lib/src/typescript/lib/component/button/Button.ts` — add the isolated key set.** Add the `RESTING_ISOLATED_KEYS` module constant from _Internal Structure_, next to the existing `BUTTON_RESTING_BACKGROUND` constant (around line 214).

2. **Button.ts — add the resting rule and the routing flag.** Beside the existing `_hoverStyleRule` getter (around line 555) add the `_restingStyleRule` backing slot, the `restingStyleRule` lazy getter calling `this.createStyleRule(":not(.pressed)")`, the `_restingChromeIsolated` slot, and `isRestingChromeIsolated()` returning `this._restingChromeIsolated ?? true`. Both slots use `declare` with no initializer — they are written during the `super()` cascade, per `CODE_CONVENTIONS.md`. Copy the `_pressedStyleRule` comment's explanation of why the slot is only a cache.

3. **Button.ts — add the two routing overrides.** Add `writeRuleDeclaration` and `setElementCSSRule` exactly as given in _Internal Structure_, placed after the lazy rule getters. Check: `npm run typecheck` — `setElementCSSRule`'s parameter type is `(key: string, value: Object | null)`, not `string | null`.

4. **Button.ts — widen `getPressedClassDeclarations()`.** Replace the body with the version in _Internal Structure_ and rewrite its doc comment: it no longer explains why three properties are excluded, it explains that the resting tier is isolated behind `:not(.pressed)` so the class rule is unopposed. Leave `getHoverClassDeclarations()` returning `{}` and leave its doc comment's statement that hover is never deduped.

5. **Button.ts — add `pinPressedToResting()`** as given in _Internal Structure_, placed next to `_clearChrome` / `_restoreChrome`.

6. **Button.ts — rework the chromeless branch of `applyChromeOptions`** (around line 920). After the existing `_options.backgroundColor` handling, set `this._restingChromeIsolated = false`; then, guarded on `this._restingStyleRule !== undefined`, clear the isolated rule with `setMany({ background: null, backgroundColor: null, backgroundImage: null, boxShadow: null })`; then replace the single `setPressedForegroundColor(...)` pin line with a call to `this.pinPressedToResting()`. Keep the branch's explanatory comment, updating it to cover all four pinned declarations. The clear step matters because `Component.applyOptions` dispatches `setBackgroundColor(options.backgroundColor)` *before* `applyChromeOptions` runs, so a caller-supplied colour may already have landed on the isolated rule.

7. **Button.ts — pin in the three `clearPressedX` setters.** In `clearPressedBackgroundColor` (line 2292), `clearPressedBackgroundImage` (line 2327) and `clearPressedShadow` (line 2475), replace the `null` argument to `writeClassStateDeclaration` with `this.getBackgroundColor() ?? "transparent"`, `this.getBackgroundImage() ?? "none"` and `this.getShadow() ?? "none"` respectively. Keep the `this._options.pressedX = undefined` line in each. Update each doc comment per _Public API_. Leave `clearPressedForegroundColor` and every `clearHoverX` untouched.

8. **Button.ts — force the restore writes in `_restoreChrome`** (line 1896). The `pressedForegroundColor` block already pairs its setter with `this.pressedStyleRule.set("color", ...)`. Give `pressedBackgroundColor`, `pressedBackgroundImage` and `pressedShadow` the same treatment, each writing `backgroundColor` / `backgroundImage` / `boxShadow`. Reuse the existing block's comment.

9. **`packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts` — update the two rows the widening inverts.** In the first case, `backgroundColor` / `backgroundImage` / `boxShadow` on the second Button's `#id.pressed` become `toBeUndefined()` (deduped) and the case title changes accordingly. In the `SpinButton` case, `instanceDeclarations.boxShadow` becomes `toBe('none')` instead of `toBeNull()`. Replace the file's `IMPORTANT SCOPE NOTE` header comment with a short pointer to this plan. Leave the hover case and the three chromeless cases as they are.

10. **`packages/lib/tests/component/button/TabButton.stateClassHoisting.test.ts` — correct the stale wording.** The first case's title says `.pressed` class rule `(color only)`; it now carries four declarations. The assertions themselves are unchanged.

11. **Add `packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts`** covering `## Expected Behaviour` rows 1-8. Copy the `idSelector` and `declarationsDuring` helpers from `Button.pressedHoverClassHoisting.test.ts`, as that file itself copied them from `ClassStyleRules.test.ts`.

12. **`packages/lib/docs/reference/changelog/next.md`** — add the entries described in `## Documentation Impact` under the existing `## Changed` → `### Components` heading.

13. **Regression checkpoints.**
    - `grep -rn 'suffix:' packages/lib/src` — expect exactly three consumer entries on Buttons: two `suffix: ""` bags in `overlay/windowControls.ts` and one `suffix: ":hover"` in `component/menubar/MenuBarButton.ts`, all three on `chromeless: true` Buttons and therefore not isolated. A hit on a chromeful Button with a suffix of one class or fewer means that rule now ties with or loses to the isolated rule.
    - `grep -rn '\.setBackground(' packages/lib/src` — expect `overlay/windowControls.ts` (chromeless Buttons) and `layout/Accordion.ts` (not a Button).
    - `grep -rn 'clearPressedShadow\|clearPressedBackground' packages/lib/src` — every hit must be one of: `Button.ts` itself, `SpinButton.ts`, `Dialog.ts`, `Notification.ts`. Each of the three consumers must already have cleared the matching *resting* property before the `clearPressedX` call, or the pin captures a value the caller did not intend.
    - `npm run typecheck && npm run test`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts` |
| Modify | `packages/lib/tests/component/button/TabButton.stateClassHoisting.test.ts` |
| Create | `packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-8 are unit-testable against the recording DOM sink, which records every `setRuleStyles` call with its selector. Rows 9-11 are cascade outcomes the sink cannot evaluate and must be checked in a browser.

| # | Case | Expected |
|---|---|---|
| 1 | A default `new Button('Save')` renders | `#id:not(.pressed)` receives `backgroundColor`, `backgroundImage` and `boxShadow`; the bare `#id` rule receives none of the three |
| 2 | A default Button renders after a first Button has warmed the class rule | its `#id.pressed` receives no `color`, `backgroundColor`, `backgroundImage` or `boxShadow`, and `.Button.pressed` exists in the rule cache |
| 3 | `button.setBackgroundColor('red')` after render, on a chromeful Button | `#id:not(.pressed)` receives `backgroundColor: 'red'`; the bare `#id` rule receives no `backgroundColor` |
| 4 | `new Button({ chromeless: true })` renders | the bare `#id` rule receives `backgroundColor`; no write to `#id:not(.pressed)` is recorded at all; `#id.pressed` receives all four keys the class bag carries |
| 5 | `new MenuBarButton(...)` renders | no `.MenuBarButton.pressed` rule is created, and its resting `backgroundColor` lands on the bare `#id` rule |
| 6 | `SpinButton`'s constructor-time `clearPressedShadow()` | `#id.pressed` receives `boxShadow: 'none'`, never `null` |
| 7 | `button.setFlat(true)` then `setFlat(false)` | `#id.pressed` receives `backgroundColor`, `backgroundImage`, `boxShadow` and `color` at their class-default values on the restore, even though each matches the class bag |
| 8 | `new Button('x', { backgroundColor: 'red', chromeless: true })` renders | the bare `#id` rule receives `backgroundColor: 'red'`, and the last `backgroundColor` write to `#id:not(.pressed)` is `null` — the chromeless branch cleared what the earlier `setBackgroundColor` dispatch had put there |
| 9 | Press a default Button in the browser | the background visibly changes from resting to the pressed token, and the computed `background-color` while `.pressed` is forced differs from the resting one |
| 10 | Hover a default Button, then press it while still hovering | hover shows the hover fill; pressing shows the pressed fill, not the hover or resting fill |
| 11 | Blur a window with controls, then focus it again | the controls flatten to transparent on blur and recover their themed fill on focus — `setWindowControlsActive`'s `background` shorthand still wins |

Rows 9-11 are the ones an automated suite cannot catch: the prior plan shipped a passing suite alongside a live regression of exactly this shape, so treat the browser check as mandatory rather than confirmatory.

---

## Verification

1. `npm run typecheck` — zero errors.
2. `npm run test` — the whole suite, not just the button files. `Button.test.ts`, `Button.pressedState.test.ts`, `ToggleButton.selectedClassHoisting.test.ts`, `TabButton.stateClassHoisting.test.ts` and `TabButton.styleRuleDisposal.test.ts` must all stay green without further edits; a failure in any of them means the isolation reached further than intended.
3. The three greps in step 13.
4. `npm run docs:api` — zero warnings, since three public setters' JSDoc changed.
5. Browser check for `## Expected Behaviour` rows 9-11, against a dev server started on a spare port from this worktree — not the main tree's server, which serves different source. Exercise: a plain `Button` (press and hover it), the `#/menubar` screen (a `MenuBarButton` must not gain a pressed background), a `Tab` strip (selected tabs must still render distinctly from unselected ones), a `Dialog` and a `Notification` (their close buttons must not gain a shadow or gradient on press), a `SpinButton` (no pressed shadow), and a window's control buttons (focus/blur flattening). Compare computed styles with `.pressed` forced on — a static screenshot cannot distinguish a working cascade from a broken one.

---

## Documentation Impact

No export surface changes, so no doc page, catalog entry or barrel is touched. Two updates are needed:

- **JSDoc on `clearPressedBackgroundColor` / `clearPressedBackgroundImage` / `clearPressedShadow`** — each currently says it removes the property from the `.pressed` rule. Each must say it pins the `.pressed` value to the button's current resting value, and name the fallback (`"transparent"` / `"none"` / `"none"`). Per `CODE_CONVENTIONS.md`, these public comments must not `{@link}` the private members introduced here — describe the behaviour in prose.
- **`packages/lib/docs/reference/changelog/next.md`**, under `## Changed` → `### Components`: one entry saying a Button's resting background and shadow now live on an internal `:not(.pressed)` rule so the pressed treatment is served by a rule shared across every default-styled Button of that class, with no consumer action needed; and one entry recording that `clearPressedBackgroundColor()`, `clearPressedBackgroundImage()` and `clearPressedShadow()` now pin the resting value rather than removing the declaration — the same rendered result, reached differently.

---

## Potential Challenges

- **A consumer style rule at `(1,1,0)` now ties with the resting rule.** Isolation raises the resting tier from `(1,0,0)` to `(1,1,0)`, so a consumer `styleRules` entry with a one-class suffix (`":hover"`, `".active"`) that used to win outright now ties and is decided by stylesheet order. Every such entry in this repo is on a chromeless Button, which is not isolated — `MenuBarButton`'s `":hover"` entry is the only one. Step 13's `suffix:` grep plus the `#/menubar` browser check cover it; a consumer outside this repo hitting the tie should lengthen its own suffix, as `hoverStyleRule` does.
- **The pin captures the resting value at call time.** `pinPressedToResting()` and the three `clearPressedX` setters read `getBackgroundColor()` / `getBackgroundImage()` / `getShadow()` when they run. A chromeless Button that changes its resting chrome afterwards keeps the older pinned value on its `#id.pressed` rule. Nothing in this repo does that — `MenuBarButton.setActive` is the one runtime resting-chrome change on a chromeless button, and `MenuBarButton` publishes no `.pressed` class rule, so nothing is pinned for it to go stale.
- **`setId()` on an already-rendered Button.** `Component.setId` rebuilds only the bare `#id` rule; deferred rules keep the old id in their selector. This already affects `.pressed` and `:hover:not(.pressed)`, and now affects the resting chrome too. A construction-time `{ id }` is safe — `applyOptions` dispatches `setId` before any rule is allocated. No in-repo call site calls `setId` on a rendered Button.
- **`_restingChromeIsolated` is a `declare` field written during the `super()` cascade.** A plain initializer would run after `super()` returns and silently reset a chromeless button back to isolated. `isRestingChromeIsolated()` supplies the `true` default instead.

---

## Critical Files

- [`packages/lib/src/typescript/lib/component/button/Button.ts`](packages/lib/src/typescript/lib/component/button/Button.ts) — the only source file changed. Read `applyChromeOptions` (L918), `_clearChrome` (L1857), `_restoreChrome` (L1896), `_applyFlatChrome` (L2049), the lazy rule getters (L542-L568) and the pressed setters (L2280-L2480).
- [`packages/lib/src/typescript/lib/component/button/Button.ts#L556`](packages/lib/src/typescript/lib/component/button/Button.ts#L556) — `hoverStyleRule`, the `:hover:not(.pressed)` precedent this plan mirrors.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `createStyleRule` (L1009), `setElementCSSRule` (L1628), `writeRuleDeclaration` (L4720), `applyStyle` and its phases (L4757-L4936), `materialiseWhenNeeded` (L5018), and the `addClass` at L5899 that puts only the *concrete* class name on the element.
- [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) — `ensureClassStateRule` (L268) and `writeClassStateDeclaration` (L326), used unchanged.
- [`plans/implemented/hoist-button-tabbar-state-chrome-rules.md`](plans/implemented/hoist-button-tabbar-state-chrome-rules.md) — its `## Implementation Notes` is the record of why the class tier was narrowed to one property.
- [`packages/lib/src/typescript/lib/overlay/windowControls.ts`](packages/lib/src/typescript/lib/overlay/windowControls.ts), [`component/menubar/MenuBarButton.ts`](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts) — the chromeless Buttons with consumer `styleRules`, and the reason chromeless instances are not isolated.
- [`packages/lib/src/typescript/lib/component/input/SpinButton.ts#L98`](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L98), [`overlay/Dialog.ts#L238`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L238), [`overlay/Notification.ts#L211`](packages/lib/src/typescript/lib/overlay/Notification.ts#L211) — the three `clearPressedX` consumers whose behaviour the pin preserves.

---

## Non-Goals

- **Deduping the resting tier itself onto a shared `.ClassName:not(.pressed)` rule.** That dedup would roughly double the byte saving, but a class-tier resting rule breaks every `clear*()` that writes `null`: `Dialog`'s `clearBackgroundImage()` removes the property from the instance rule and the class rule's gradient would take over. Fixing that needs a per-property neutral-value convention across `Component`'s clear setters — a `Component`-wide change, not a Button one. This plan's isolation is the prerequisite either way.
- **Hover or selected class-tier dedup.** See the architecture decision above: a customised instance's resting rule at `(1,1,0)` still outranks a class-tier hover `(0,4,0)` or selected `(0,3,0)` rule.
- **The known `foregroundColor` gap.** A Button given a custom resting `foregroundColor` and a default `pressedForegroundColor` still shows the custom colour while pressed, because `#id { color }` `(1,0,0)` outranks `.Button.pressed` `(0,2,0)`. `color` is not in the isolated set, so this plan neither fixes nor worsens it.
- **Widening the base-tier hoistable set** (`ClassStyleDefaults` in `core/ClassStyleRules.ts`). A separate `Component`-wide plan owns that axis.
- **`ToggleButton.ts` and `TabButton.ts`.** Their `.selected:not(:hover)` and hover/border state rules sit at `(1,2,0)` and `(1,3,0)` on the instance tier, which still outrank the isolated resting rule at `(1,1,0)`, so neither class needs a source change or a wider exclusion list.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^prior-scope]: The prior plan's `## Implementation Notes` records the finding in full: a first pass deduped `backgroundColor` / `backgroundImage` / `boxShadow` onto `.Button.pressed`, passed the whole automated suite, and shipped a live regression — every default-styled Button's pressed background stopped changing, and every `TabButton`'s selected tab rendered with the unselected gray. The cause was that the automated suite only ever asserted on *what got written*, never on what the browser's cascade resolves. The scope was then cut to `pressedForegroundColor`, leaving the generic mechanism built but almost unused. `TabButton`'s four border longhands were dropped for the same reason; this plan does not restore them, because they would need the pressed bucket to declare a border it has no default for — pressing a `TabButton` would drop its frame to the UA `<button>` border. `TabButton`'s selected and hover borders keep working through the instance tier, which outranks the resting rule on specificity.

[^suffix-confirmed]: Confirmed by reading the current code on this branch rather than trusting the prior plan's description. [`StyleTarget.ts:193-199`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L193)'s `_selectorOf` appends `spec.suffix ?? ""` verbatim for both the `"class"` and `"component"` cases, so `createStyleRule(":not(.pressed)")` yields `#<escaped-id>:not(.pressed)` and `{ scope: "class", name, suffix }` yields `.ClassName<suffix>`. `ensureClassStateRule` (`ClassStyleRules.ts:268`) accepts an arbitrary suffix string, caches per `(ctor, suffix)`, creates no rule for an empty declarations bag, and returns the frozen bag. No change to either module is needed.

[^isolated-set]: `background`, the shorthand, is included even though nothing in this repo calls `setBackground()` on a chromeful Button. Leaving it on the bare `#id` rule would put a shorthand at `(1,0,0)` under longhands at `(1,1,0)`, so the longhands would win and the shorthand would stop taking effect. Keeping all four in one rule preserves today's within-block ordering exactly. `overlay/windowControls.ts`'s `setWindowControlsActive` is the one real `setBackground` caller and operates on chromeless Buttons, which are not isolated at all.

[^color-stays]: `foregroundColor` is one of the fifteen keys `ClassStyleDefaults` already hoists, so a default-styled Button's resting `color` is served by `.Button` `(0,1,0)` and nothing on `#id` competes for it — which is exactly why `pressedForegroundColor` was the one field the prior plan could keep. Isolating `color` too would close the residual gap listed under `## Non-Goals`, but only by routing it through `Component`'s private `_inheritedStyleBag` comparison, which `Button` cannot read; redirecting it without that comparison would lose the base-tier saving that already works.

[^no-resting-dedup]: `FRAMEWORK_DECLARATIONS` and `resolveDeclarations` in `core/ClassStyleRules.ts` cover `boxSizing`, `position`, `display`, `visibility`, `whiteSpace`, `userSelect`, `cursor`, `border`, `margin`, min/max width and height, the two overflow axes, and conditionally `outline`, `color` and the `Text` font keys. None of the four isolated keys appears, so `writeRuleDeclaration`'s skip-on-match can never fire for them and the overrides lose nothing by not consulting the bag.

[^chromeless-routing]: Three independent reasons converge on this. First, a chromeless Button dispatches no pressed setters, so with its resting chrome isolated there would be no declaration left to render while pressed and the shared class rule would fill the gap — the precise leak the prior plan's second audit round found for `color`. Second, every consumer-supplied `styleRules` entry on a Button in this repo is on a chromeless Button (`windowControls.ts`'s two `suffix: ""` bags and `MenuBarButton`'s `":hover"`), and raising the resting tier to `(1,1,0)` would sink or tie all three. Third, the flag is written only in `applyChromeOptions`, never by `setChromeless`, so both runtime toggles stay correct without moving declarations between rules: `setChromeless(true)` leaves an isolated instance isolated and `_clearChrome`'s `clearPressedX` calls pin its pressed rule, and `setChromeless(false)` leaves a non-isolated instance on `#id` while `_restoreChrome`'s forced writes put the pressed values on `#id.pressed` `(1,1,0)`, which outranks `#id` `(1,0,0)`.

[^class-default-chromeless]: `Component.init` adds only `this.constructor.name` as a CSS class, not the ancestor chain, so a `MenuBarButton` element carries `MenuBarButton` and never matches `.Button.pressed`. The only rule that could reach it is `.MenuBarButton.pressed` — which is created by `MenuBarButton`'s own instances, through the pin the prior plan added. Returning `{}` for a chromeless-by-default class stops that rule existing at all, which is both cheaper and closer to `chromeless`'s contract; `pinPressedToResting` then writes nothing for those classes, because it iterates the bag's keys. `new Button({ chromeless: true })` is the different case the guard cannot cover: its concrete class is `Button`, whose defaults are chromeful, so it does share `.Button.pressed` with its chromeful siblings and does need the pin.

[^clear-pins]: All three consumers already clear the matching resting property immediately before the `clearPressedX` call — `SpinButton` calls `clearShadow()` then `clearPressedShadow()`, `Dialog` and `Notification` call `clearBackgroundImage()` / `clearShadow()` before their pressed clears, and `_applyFlatChrome` calls `clearBackgroundImage()` before `clearPressedBackgroundImage()`. So the pinned value is `"none"` in every current case, matching what removing the property produced before. Writing a real value rather than `null` is also what `Component.clearShadow` already does for the resting tier, for the same reason: a removal cannot outrank a lower-tier declaration, and `"none"` is the initial value for both `box-shadow` and `background-image`, so the two are equivalent except against a competing rule.

[^hover-clears-unchanged]: The hover class bag stays empty, so a `clearHoverX` write of `null` still means what it always meant: the hover rule declares nothing for that property and the cascade falls through to the resting rule, which matches whenever the button is hovered and not pressed. `_applyFlatChrome`'s `clearHoverBackgroundImage()` / `clearHoverShadow()` and `Dialog`'s `clearHoverShadow()` / `clearHoverBackgroundImage()` therefore behave exactly as before.

[^siblings-unchanged]: `ToggleButton`'s `.selected:not(:hover)` rule is `#id.selected:not(:hover)` `(1,2,0)`, which beats the isolated resting rule `(1,1,0)` just as it beat the bare `#id` `(1,0,0)`. `TabButton` adds no state selector of its own — its hover border, selected fill and selected border all ride `ToggleButton`'s and `Button`'s instance rules — and its resting border longhands stay on the bare `#id` rule, so they keep painting while the tab is pressed. Both classes therefore need `:not(.pressed)` as their only exclusion and need no source change; a wider exclusion list such as `:not(.pressed):not(.selected)` would only be needed to dedupe `.selected` onto the class tier, which `## Non-Goals` rules out.
