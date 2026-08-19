---
depends-on:
  - hoist-button-tabbar-state-chrome-rules
  - button-resting-chrome-state-isolation
touches-shared:
  - ARCHITECTURE.md
---

# State-Rule Class-Tier Dedup by Default — Implementation Plan

## Overview

[`plans/implemented/hoist-button-tabbar-state-chrome-rules.md`](implemented/hoist-button-tabbar-state-chrome-rules.md) gave `Button` a way to share its `.pressed` CSS declarations across every default-styled instance of a class, through two free functions in [`ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts): `ensureClassStateRule` (computes and caches a shared `.ClassName<suffix>` rule) and `writeClassStateDeclaration` / `writeManyClassStateDeclarations` (skip an instance-rule write that already matches it). That plan's own audit found the mechanism unsafe for most of the fields it was built to save, and narrowed `Button.getPressedClassDeclarations()` to `color` alone. It found the same conflict for `ToggleButton`'s `.selected` state and disabled dedup there outright: `ToggleButton.selectedClassBag` is hardcoded to return `null` today ([`ToggleButton.ts`, around L72](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L72)), and the `getSelectedClassDeclarations()` resolver it would have called no longer exists anywhere in the codebase. `TabButton`'s equivalent `getHoverClassDeclarations()` / `getSelectedClassDeclarations()` overrides were deleted the same way.

[`plans/implemented/button-resting-chrome-state-isolation.md`](implemented/button-resting-chrome-state-isolation.md) restored the other three pressed properties for `Button` alone, by moving its deviating resting `background-color` / `background-image` / `box-shadow` off the bare `#id` rule onto a `#id:not(.pressed)` rule, so `.pressed` and the resting tier never compete on specificity. It left `ToggleButton.ts` / `TabButton.ts` untouched — they still write their resting chrome unconditionally onto the bare `#id` rule, so `.selected` dedup stays unsafe for them. Getting `Button`'s own dedup correct also took that plan's implementation two attempts: a fully default-styled Button's four pressed setters all match the class bag and are skipped, so nothing queues a real declaration at first render and the underlying rule never materialises — a later runtime `setPressedX` / `clearPressedX` call on such a button then only queues onto an already-skipped rule and never reaches the stylesheet. A first fix nudged the rule from two orchestration methods and still missed a direct runtime setter call, the ordinary documented way to customise a rendered button. The fix that shipped is two private wrapper methods, `writePressedDeclaration` / `writePressedDeclarations` ([`Button.ts`, around L701-721](packages/lib/src/typescript/lib/component/button/Button.ts#L701-L721)), that pair every dedup write with a `materialisePressedRule()` nudge — the actual choke point every pressed-tier write funnels through. All twelve `setPressedX` / `clearPressedX` methods call one of these two wrappers instead of the shared comparison helper directly.

This plan adds a `Component` primitive, `createStateStyleRule(suffix, resolveDefaults)`, that returns a small wrapper object, `StateStyleRule`, whose own `set()` / `setMany()` perform both the class-tier comparison *and* the materialisation nudge — folding `writePressedDeclaration` / `writePressedDeclarations` / `materialisePressedRule`'s combined job into the primitive itself, so a future caller gets it by construction instead of having to reinvent it the way `Button` twice had to. It refactors `Button.pressedStyleRule` / `Button.hoverStyleRule` onto the new primitive, deleting those three methods along with the `pressedClassBag` / `hoverClassBag` getters. It touches [`ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) (one new class), [`Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) (one new protected method), `Button.ts`, and `ARCHITECTURE.md`. `ToggleButton.ts` and `TabButton.ts` are **not** touched — see `## Architecture Decisions` for why their disabled `.selected` dedup is genuinely out of this plan's scope, not merely unrefactored.

---

## Architecture Decisions

### `Component.createStateStyleRule(suffix, resolveDefaults)` is a new sibling of `createStyleRule`, not a replacement

[`createStyleRule(selectorSuffix)`](packages/lib/src/typescript/lib/core/Component.ts#L1009) stays exactly as it is — the right choice for a state rule with no meaningful class-level default (an instance-only affordance). `createStateStyleRule` is for the common case where a state rule *does* have class-level defaults: it builds the same underlying per-instance `StyleRule` (by calling `createStyleRule` internally, so render-time materialisation, selector tracking, and disposal are unchanged) and wraps it in a `StateStyleRule` object carrying the resolved class-tier comparison bag.

### The wrapper's own `set()` / `setMany()` do the comparison *and* the materialisation nudge — not something a caller must remember to call

The base tier's "hard to avoid" property comes from a single choke point: every `applyStyle` phase writes through [`writeRuleDeclaration`](packages/lib/src/typescript/lib/core/Component.ts#L4736), which reads a per-render cache (`_inheritedStyleBag`) computed once at the top of [`applyStyle`](packages/lib/src/typescript/lib/core/Component.ts#L4799). State rules have no equivalent single point — their setters fire from construction, a runtime call, or a chrome-mode toggle, not from one recompute pass[^no-render-pass] — so `writeClassStateDeclaration` takes the rule and comparison bag as explicit parameters instead. `StateStyleRule` keeps that shape internally but moves the parameter-passing off the call site: `set(key, value)` already knows its own rule and bag, so a setter body reads `this.pressedStyleRule.set(key, value)` — indistinguishable from a bare, non-deduping `rule.set(key, value)` call.

`set()` / `setMany()` go one step further than comparison alone: after writing (or skipping) the declaration, each checks whether the underlying rule now has a real, unmaterialised declaration queued — and if the component is already rendered, materialises it immediately. This exists because the dedup comparison itself creates the failure mode it closes: the more properties a state rule dedupes, the more likely a freshly-constructed, default-styled instance queues nothing but removals at first render, leaving its rule unmaterialised until some later write proves it needs to exist. `Button`'s own history shows this is not hypothetical — it is the exact bug `writePressedDeclaration` / `writePressedDeclarations` / `materialisePressedRule` were built to fix, and it took two attempts to fix completely.[^materialise-in-primitive] Folding the nudge into `set()` / `setMany()` means every future write path — construction, a runtime setter, a chrome-mode toggle — gets it automatically, with nothing extra to opt into.

### `resolveDefaults` is a plain callback, not a suffix-keyed override method

[`Component.getClassStyleDefaults()`](packages/lib/src/typescript/lib/core/Component.ts#L4778) solves the equivalent problem for the base tier with one `protected`, subclass-overridable method — because there is exactly one base `#id` rule per component. A component can have several state rules (`Button` has two: pressed and hover), each needing its own defaults, and TypeScript has no type-safe way to dispatch to a differently-named override method by a runtime suffix string. So `createStateStyleRule` takes the resolver as a parameter instead of looking it up itself. Subclass overridability is preserved as a convention layered on top, not built into the primitive: `Button` defines its own `protected getPressedClassDeclarations()` / `getHoverClassDeclarations()` methods and passes a thunk that calls it — `() => this.getPressedClassDeclarations()` — to `createStateStyleRule`. Because the override still lives on a normal method reached through `this`, a subclass that later adds its own override needs no change to the `createStateStyleRule` call site — the same virtual-dispatch guarantee `hoist-button-tabbar-state-chrome-rules` already relied on. `TabButton` does not currently have such an override (see the ToggleButton/TabButton scope decision below); the guarantee matters for any future subclass, not for a case this plan changes.

### `StateStyleRule` delegates to the existing `writeClassStateDeclaration` / `writeManyClassStateDeclarations`, it doesn't reimplement them

`StateStyleRule.set()` calls `writeClassStateDeclaration(rule, bag, key, value)` internally; `setMany()` calls `writeManyClassStateDeclarations`. This keeps the comparison logic in one place and keeps the two free functions independently usable — `hoist-button-tabbar-state-chrome-rules`'s own `## Non-Goals` explicitly keeps them exported "so a follow-up plan can reuse them without inventing anything new."

### `StyleTarget.ts` is not touched

`createStateStyleRule` needs no new selector shape: the instance-tier rule is `createStyleRule`'s existing `"component"` scope, and the class-tier rule is built inside `ensureClassStateRule`, which already routes through the suffix-aware `"class"` scope. This plan only adds new code in `ClassStyleRules.ts` and `Component.ts`.

### Only `Button` is refactored onto the new primitive; `ToggleButton` and `TabButton` are out of scope

`ToggleButton.selectedStyleRule` has nothing to refactor onto the new primitive: `selectedClassBag` is hardcoded `null`, not derived from `ensureClassStateRule`, and the resolver it would have called, `getSelectedClassDeclarations()`, no longer exists.[^toggle-selected-disabled] This is a deliberate, documented safety measure, not leftover scaffolding — `ToggleButton` and `TabButton` write their resting `background-color` / `background-image` / `box-shadow` unconditionally onto the bare `#id` rule, the same way `Button` did before `button-resting-chrome-state-isolation` isolated it, and that plan left `ToggleButton.ts` / `TabButton.ts` untouched.

Routing `ToggleButton.selectedStyleRule` onto `createStateStyleRule(".selected:not(:hover)", () => ({}))` would reproduce today's always-write behaviour exactly — an empty resolver produces an empty class bag, and `writeClassStateDeclaration` never skips against an empty bag, exactly like the current `null` bypass — so it buys nothing functionally. It would trade the current, loudly-commented `return null;` for a resolver that looks like an ordinary, safe-to-fill-in extension point: a future author who later replaces `() => ({})` with a real declaration bag (the natural-looking next step once the class visibly has a `createStateStyleRule` call) would silently reintroduce the exact specificity bug `hoist-button-tabbar-state-chrome-rules`'s audit found and fixed. Leaving `ToggleButton.ts` / `TabButton.ts` untouched keeps that risk exactly where it already sits: an explicit `null` with the reasoning written next to it. Making `.selected` dedup safe needs the same resting-chrome isolation `button-resting-chrome-state-isolation` built for `Button` — a component-specific, non-trivial change of its own, out of scope here.

`TabButton` has no `getPressedClassDeclarations()`, `getHoverClassDeclarations()`, or `getSelectedClassDeclarations()` override of its own — the latter two existed briefly under `hoist-button-tabbar-state-chrome-rules`'s first implementation pass and were deleted by that plan's own audit. `TabButton` paints its hover/selected chrome directly through instance setter calls in `applyTabStyling()` (`setHoverBorder`, `setSelectedBackgroundColor`, etc.), inheriting `Button`'s `pressedStyleRule` / `hoverStyleRule` getters and `ToggleButton`'s `selectedStyleRule` getter unchanged. This plan's rewrite of `Button`'s two getters is invisible to `TabButton` either way, since `TabButton` never overrides the resolvers those getters call and never calls `pressedStyleRule` / `hoverStyleRule` / `selectedStyleRule` directly.

### Every dedup this plan performs must satisfy a class-tier safety invariant

A property is only safe to dedupe against a class-tier rule at a given suffix tier if every other tier the same component participates in — including its base `#id` resting tier — also writes that property in a comparison-gated way, never unconditionally. An unconditional write anywhere always wins the cascade over a class-only selector, no matter how many classes the deduped tier's selector chains, so one ungated writer defeats the dedup for every tier that declares the same property. `createStateStyleRule` does not verify this on a caller's behalf — it is a rule a component author must satisfy by construction before wrapping any given property in a state rule.

Button's own history, and ToggleButton's, are the worked example:[^invariant-grounding]

| Property | Resting-tier write | Safe to dedupe? |
|---|---|---|
| `color` (Button `.pressed`) | comparison-gated — hoisted onto the class tier by the base-tier `ClassStyleDefaults` mechanism, so nothing on `#id` competes | yes — shipped as `pressedForegroundColor` |
| `backgroundColor`/`backgroundImage`/`boxShadow` (Button `.pressed`), before `button-resting-chrome-state-isolation` | unconditional, on the bare `#id` rule `(1,0,0)` | no — narrowed out of `getPressedClassDeclarations()` |
| `backgroundColor`/`backgroundImage`/`boxShadow` (Button `.pressed`), after `button-resting-chrome-state-isolation` | comparison-gated by construction — moved to `#id:not(.pressed)`, which never matches while `.pressed` does | yes — restored to `getPressedClassDeclarations()`; this plan carries the wiring forward unchanged |
| `backgroundColor`/`backgroundImage`/`boxShadow` (ToggleButton/TabButton `.selected`) | unconditional, on the bare `#id` rule `(1,0,0)` — never isolated | no — this is why `selectedClassBag` stays `null`; see the scope decision above |

### `createStateStyleRule` does not gain a resting-tier mode

`createStateStyleRule(suffix, resolveDefaults)` stays scoped to suffixes that get both an instance-tier rule and a class-tier dedup rule — pressed/hover/selected-style suffixes. It does not grow a special case for a mutual-exclusion "resting" suffix such as `:not(.pressed)`. The resting tier needs the opposite shape: an instance-only rule with no class-tier counterpart at all, plus a redirect at the component's own base-tier write choke points for a hand-picked set of properties. Folding that into `createStateStyleRule` would mean either giving the resting tier the class-tier rule it must not have, or bolting an unrelated write-interception mechanism onto a primitive whose entire job is wrapping an already-called setter. It stays a manual, per-component technique, built directly in the component's own source file the way `Button.ts`'s `restingStyleRule` / `reconcileRuleDeclaration` / `setReconciledCSSRules` / `setElementCSSRule` already do it.[^resting-tier-manual] This plan does not touch any of that mechanism.

### Forced writes on `pressedStyleRule` must keep reaching the raw `StyleRule`, not the new wrapper

`Button` has five call sites today that must keep writing unconditionally to `.pressed`, bypassing whatever comparison `pressedStyleRule` performs: `_restoreChrome`'s four forced writes (`color`, `backgroundColor`, `backgroundImage`, `boxShadow` — [Button.ts:2119-2131](packages/lib/src/typescript/lib/component/button/Button.ts#L2119-L2131)) and `pinPressedToResting`'s loop ([Button.ts:2171](packages/lib/src/typescript/lib/component/button/Button.ts#L2171)). Both exist because a value that already matches the class bag must still be written for real when the instance rule may hold a stale pin from an earlier chromeless or flat pass.[^forced-write-hazard] Once `pressedStyleRule` returns a `StateStyleRule`, its `.set()` *is* the comparison-gated write, so all five call sites would silently start skipping whenever the restored value matches the class default — reintroducing the exact regression they exist to prevent. The fix needs no new API: [`createStyleRule(selectorSuffix)`](packages/lib/src/typescript/lib/core/Component.ts#L1009) already caches its return value per suffix and returns the identical `StyleRule` object on every call — the same guarantee `createStateStyleRule` itself relies on internally. Each of the five reroutes to `this.createStyleRule(".pressed").set(key, value)`, reaching the same underlying rule directly instead of through the wrapper.

`pinPressedToResting` also needs the class bag's own keys to iterate — something `.set()` / `.setMany()` deliberately don't expose, since exposing a write bypass would defeat the comparison they exist to perform. `StateStyleRule` gets one read-only accessor for this, `classBag`, returning the same resolved bag `set()` / `setMany()` already compare against internally (`null` when the class opted out of dedup). `pinPressedToResting` reads `this.pressedStyleRule.classBag` instead of a separate `pressedClassBag` getter — which this plan therefore deletes outright, along with `hoverClassBag` (`hoverStyleRule.set()` now performs that comparison internally, and nothing else reads `hoverClassBag`).[^classbag-accessor]

### `depends-on` requires both `hoist-button-tabbar-state-chrome-rules` and `button-resting-chrome-state-isolation`

This plan calls `ensureClassStateRule` (only exists once the first plan lands) and rewrites the exact `Button` call sites `button-resting-chrome-state-isolation` shipped: the twelve `writePressedDeclaration`-routed setter/clearer pairs, the five forced writes on `pressedStyleRule`, and the `pressedClassBag` getter `pinPressedToResting` reads. All of these exist only once that plan has landed — this plan is not executable against the pre-isolation `Button.ts` either way.[^ordering-not-symmetric] `ToggleButton.ts` / `TabButton.ts` need no such ordering, since this plan does not touch them.

`touches-shared` does **not** additionally list `ClassStyleRules.ts`, `Component.ts`, or `Button.ts`: `depends-on` already serialises this plan strictly after both dependencies, so there is no concurrent-edit window on those files. `ARCHITECTURE.md` is listed under `touches-shared` instead, because a different, unordered sibling plan — `plans/implemented/suppress-empty-style-rules.md` — edits the same *Defer DOM work to render time* section this plan edits (a different bullet, but frontmatter flags at file granularity).

---

## Public API

```typescript
// core/ClassStyleRules.ts — new export. Not added to core/index.ts (module stays internal,
// matching ensureClassStyleRule / ensureClassStateRule's existing treatment).

/**
 * Wraps a per-instance state `StyleRule` together with the class-tier
 * comparison bag `ensureClassStateRule` resolves for it. `set()` / `setMany()`
 * skip a write that already matches the class rule and materialise the
 * underlying rule when a real write just queued on an already-rendered
 * component — exactly like `writeClassStateDeclaration` /
 * `writeManyClassStateDeclarations` plus a materialisation nudge — so a
 * caller gets both by calling the object's own write methods, with nothing
 * else to opt into.
 *
 * Constructed via `Component.createStateStyleRule`; not intended for direct
 * construction elsewhere.
 */
export class StateStyleRule {
    constructor(
        ctor: Function,
        suffix: string,
        rule: StyleRule,
        resolveDefaults: () => Record<string, string | null>,
        hasElement: () => boolean,
    );

    /**
     * The resolved class-tier bag `set()` / `setMany()` compare against;
     * `null` when this class opted out of dedup (see `ensureClassStateRule`).
     * Read-only — a caller that needs the bag's own keys (`Button.pinPressedToResting`
     * is the one in-repo example) reads this instead of bypassing the
     * comparison `set()` / `setMany()` perform.
     */
    get classBag(): Readonly<Record<string, string | null>> | null;

    set(key: string, value: string | null): void;
    setMany(values: Record<string, string | null>): void;
}
```

```typescript
// core/Component.ts — new protected method, sibling to createStyleRule.
protected createStateStyleRule(
    selectorSuffix: string,
    resolveDefaults: () => Record<string, string | null>,
): StateStyleRule;
```

```typescript
// component/button/Button.ts — getters now return StateStyleRule instead of StyleRule.
private get pressedStyleRule(): StateStyleRule;
private get hoverStyleRule():   StateStyleRule;
// REMOVED: the `pressedClassBag` / `hoverClassBag` getters and their
// `_pressedClassBag` / `_hoverClassBag` backing fields — `pinPressedToResting`
// now reads `pressedStyleRule.classBag`.
// REMOVED: `writePressedDeclaration` / `writePressedDeclarations` /
// `materialisePressedRule` — `StateStyleRule.set()` / `setMany()` now do both
// jobs (the comparison and the materialisation nudge) internally.
```

`ToggleButton.ts` and `TabButton.ts` have no signature changes — see Architecture Decisions.

No consumer-facing signature changes anywhere: every new, changed, or removed member is `protected` or `private`.

---

## Internal Structure

### `core/ClassStyleRules.ts` — `StateStyleRule`

Placed after `writeManyClassStateDeclarations` (the end of the file):

```typescript
export class StateStyleRule {
    private readonly _rule:       StyleRule;
    private readonly _bag:        ClassStyleBag | null;
    private readonly _hasElement: () => boolean;

    constructor(
        ctor: Function,
        suffix: string,
        rule: StyleRule,
        resolveDefaults: () => Record<string, string | null>,
        hasElement: () => boolean,
    ) {
        this._rule       = rule;
        this._bag        = ensureClassStateRule(ctor, suffix, resolveDefaults());
        this._hasElement = hasElement;
    }

    get classBag(): ClassStyleBag | null {
        return this._bag;
    }

    set(key: string, value: string | null): void {
        writeClassStateDeclaration(this._rule, this._bag, key, value);
        this._materialise();
    }

    setMany(values: Record<string, string | null>): void {
        writeManyClassStateDeclarations(this._rule, this._bag, values);
        this._materialise();
    }

    /**
     * Inserts the rule when a write just queued a real declaration and the
     * component is already rendered — the choke point `Button`'s
     * `materialisePressedRule` used to be, generalised so no future caller
     * can forget it. A rule that never queued anything real (every write so
     * far matched the class bag) is left unmaterialised, same as any other
     * deferred rule.
     */
    private _materialise(): void {
        if (this._hasElement() && this._rule.hasQueuedDeclarations()) {
            this._rule.ensure();
        }
    }
}
```

Extend the top-of-file module comment to add one clause: this module also exposes `StateStyleRule`, the wrapper `Component.createStateStyleRule` returns.

### `core/Component.ts` — `createStateStyleRule`

Placed directly below the existing `createStyleRule` ([Component.ts:1009-1018](packages/lib/src/typescript/lib/core/Component.ts#L1009-L1018)):

```typescript
/**
 * Sibling of {@link createStyleRule} for a per-instance state rule that has
 * class-level defaults to dedupe against. `resolveDefaults` is called once,
 * eagerly, at this call site — matching how `applyStyle` eagerly calls
 * `getClassStyleDefaults()` on every render regardless of whether the class
 * rule already exists. Cache the returned wrapper in a private `??=` getter,
 * the same idiom `createStyleRule` callers already use (see `Button.pressedStyleRule`),
 * so `resolveDefaults` runs at most once per instance.
 */
protected createStateStyleRule(
    selectorSuffix: string,
    resolveDefaults: () => Record<string, string | null>,
): StateStyleRule {
    return new StateStyleRule(
        this.constructor,
        selectorSuffix,
        this.createStyleRule(selectorSuffix),
        resolveDefaults,
        () => !!this.getElement(),
    );
}
```

Extend the existing `~/core/ClassStyleRules.js` import ([Component.ts:24](packages/lib/src/typescript/lib/core/Component.ts#L24)) to add `StateStyleRule`.

### `component/button/Button.ts` — the getters, before → after

```typescript
// Before (current code, Button.ts:558-574, 695-731):
private declare _pressedStyleRule?: StyleRule;
private get pressedStyleRule(): StyleRule {
    return this._pressedStyleRule ??= this.createStyleRule(".pressed");
}
// ...
private declare _hoverStyleRule?: StyleRule;
private get hoverStyleRule(): StyleRule {
    return this._hoverStyleRule ??= this.createStyleRule(":hover:not(.pressed)");
}
// ...
private materialisePressedRule(): void {
    if (this.getElement() && this.pressedStyleRule.hasQueuedDeclarations()) {
        this.pressedStyleRule.ensure();
    }
}

private writePressedDeclaration(key: string, value: string | null): void {
    writeClassStateDeclaration(this.pressedStyleRule, this.pressedClassBag, key, value);
    this.materialisePressedRule();
}

private writePressedDeclarations(values: Record<string, string | null>): void {
    writeManyClassStateDeclarations(this.pressedStyleRule, this.pressedClassBag, values);
    this.materialisePressedRule();
}

private declare _pressedClassBag?: Readonly<Record<string, string | null>> | null;
private get pressedClassBag(): Readonly<Record<string, string | null>> | null {
    return this._pressedClassBag ??= ensureClassStateRule(this.constructor, ".pressed", this.getPressedClassDeclarations());
}

private declare _hoverClassBag?: Readonly<Record<string, string | null>> | null;
private get hoverClassBag(): Readonly<Record<string, string | null>> | null {
    return this._hoverClassBag ??= ensureClassStateRule(this.constructor, ":hover:not(.pressed)", this.getHoverClassDeclarations());
}

setPressedBackgroundColor(backgroundColor: string): this {
    this._options.pressedBackgroundColor = backgroundColor;
    this.writePressedDeclaration("backgroundColor", backgroundColor);

    return this;
}

setHoverBackgroundColor(backgroundColor: string): this {
    this._options.hoverBackgroundColor = backgroundColor;
    writeClassStateDeclaration(this.hoverStyleRule, this.hoverClassBag, "backgroundColor", backgroundColor);

    return this;
}
```

```typescript
// After:
private declare _pressedStyleRule?: StateStyleRule;
private get pressedStyleRule(): StateStyleRule {
    return this._pressedStyleRule ??= this.createStateStyleRule(".pressed", () => this.getPressedClassDeclarations());
}

private declare _hoverStyleRule?: StateStyleRule;
private get hoverStyleRule(): StateStyleRule {
    return this._hoverStyleRule ??= this.createStateStyleRule(":hover:not(.pressed)", () => this.getHoverClassDeclarations());
}

setPressedBackgroundColor(backgroundColor: string): this {
    this._options.pressedBackgroundColor = backgroundColor;
    this.pressedStyleRule.set("backgroundColor", backgroundColor);

    return this;
}

setHoverBackgroundColor(backgroundColor: string): this {
    this._options.hoverBackgroundColor = backgroundColor;
    this.hoverStyleRule.set("backgroundColor", backgroundColor);

    return this;
}
```

`materialisePressedRule`, `writePressedDeclaration`, `writePressedDeclarations`, `pressedClassBag` (`_pressedClassBag`), and `hoverClassBag` (`_hoverClassBag`) are deleted outright — everything they did now lives inside `StateStyleRule`, except `pinPressedToResting`'s need for the bag's own keys, covered by `classBag` below. `getPressedClassDeclarations()` / `getHoverClassDeclarations()` are untouched. Every other pressed setter/clearer (twelve methods total) and hover setter/clearer (twelve methods total) in `Button.ts` follows the identical transformation shown for `backgroundColor` above.

### `component/button/Button.ts` — the five forced writes and `pinPressedToResting`, before → after

```typescript
// Before (current code, Button.ts:2104-2132, 2155-2174):
if (d.pressedForegroundColor !== undefined) {
    this.setPressedForegroundColor(d.pressedForegroundColor);
    this.pressedStyleRule.set("color", d.pressedForegroundColor);
}
if (d.pressedBackgroundColor !== undefined) {
    this.setPressedBackgroundColor(d.pressedBackgroundColor);
    this.pressedStyleRule.set("backgroundColor", d.pressedBackgroundColor);
}
// ...backgroundImage, boxShadow follow the same shape

private pinPressedToResting(): void {
    const bag = this.pressedClassBag;

    if (!bag) {
        return;
    }

    const resting: Record<string, string> = { /* unchanged */ };

    for (const key of Object.keys(bag)) {
        if (resting[key] !== undefined) {
            this.pressedStyleRule.set(key, resting[key]);
        }
    }
}
```

```typescript
// After:
if (d.pressedForegroundColor !== undefined) {
    this.setPressedForegroundColor(d.pressedForegroundColor);
    this.createStyleRule(".pressed").set("color", d.pressedForegroundColor);
}
if (d.pressedBackgroundColor !== undefined) {
    this.setPressedBackgroundColor(d.pressedBackgroundColor);
    this.createStyleRule(".pressed").set("backgroundColor", d.pressedBackgroundColor);
}
// ...backgroundImage, boxShadow follow the same shape

private pinPressedToResting(): void {
    const bag = this.pressedStyleRule.classBag;

    if (!bag) {
        return;
    }

    const resting: Record<string, string> = { /* unchanged */ };

    for (const key of Object.keys(bag)) {
        if (resting[key] !== undefined) {
            this.createStyleRule(".pressed").set(key, resting[key]);
        }
    }
}
```

Only the rule each forced write targets changes (`pressedStyleRule` → `createStyleRule(".pressed")`), and only the bag source in `pinPressedToResting` changes (`pressedClassBag` → `pressedStyleRule.classBag`). No other line in either method moves.

### `component/button/Button.ts` — import

```typescript
// Before (Button.ts:15):
import { ensureClassStateRule, writeClassStateDeclaration, writeManyClassStateDeclarations } from "~/core/ClassStyleRules.js";
```

```typescript
// After:
import type { StateStyleRule } from "~/core/ClassStyleRules.js";
```

Nothing else in `Button.ts` calls `ensureClassStateRule`, `writeClassStateDeclaration`, or `writeManyClassStateDeclarations` directly once the rewrite above is complete — both are reached only through `StateStyleRule` from this point on.

### `component/button/ToggleButton.ts`, `component/button/TabButton.ts` — no change

See Architecture Decisions. `ToggleButton.selectedStyleRule` stays a plain `StyleRule`, `selectedClassBag` stays hardcoded `null`, and neither file is edited by this plan.

---

## Ordered Implementation Steps

1. **`core/ClassStyleRules.ts`** — add the `StateStyleRule` class per Internal Structure, including the `classBag` accessor and the `hasElement`-gated `_materialise()`. Extend the module comment to mention `StateStyleRule`.
   Check: `npm run typecheck` from `packages/lib` — clean.

2. **`core/Component.ts`** — add `createStateStyleRule` directly below `createStyleRule` ([Component.ts:1009-1018](packages/lib/src/typescript/lib/core/Component.ts#L1009-L1018)) per Internal Structure, passing `() => !!this.getElement()` as `hasElement`. Extend the `~/core/ClassStyleRules.js` import ([Component.ts:24](packages/lib/src/typescript/lib/core/Component.ts#L24)) to add `StateStyleRule`.
   Check: `npm run typecheck` — clean.

3. **`component/button/Button.ts`** — rewrite `pressedStyleRule` / `hoverStyleRule` per Internal Structure. Delete `materialisePressedRule`, `writePressedDeclaration`, `writePressedDeclarations`, `pressedClassBag` (`_pressedClassBag`), and `hoverClassBag` (`_hoverClassBag`) outright. Change the `~/core/ClassStyleRules.js` import ([Button.ts:15](packages/lib/src/typescript/lib/component/button/Button.ts#L15)) to `import type { StateStyleRule } from "~/core/ClassStyleRules.js";`. Route all twelve `setPressedX`/`clearPressedX` methods from `this.writePressedDeclaration(...)` / `this.writePressedDeclarations(...)` to `this.pressedStyleRule.set(...)` / `.setMany(...)`, and all twelve `setHoverX`/`clearHoverX` methods from `writeClassStateDeclaration(this.hoverStyleRule, this.hoverClassBag, ...)` / `writeManyClassStateDeclarations(this.hoverStyleRule, this.hoverClassBag, ...)` to `this.hoverStyleRule.set(...)` / `.setMany(...)`. Do not change `_pressedBorder`/`_hoverBorder` field writes, `_options.X` writes, method signatures, or `getPressedClassDeclarations()`/`getHoverClassDeclarations()`.

   Before touching those twenty-four methods, find and reroute the five forced-write call sites separately, per Internal Structure's second subsection — `_restoreChrome`'s four ([Button.ts:2119-2131](packages/lib/src/typescript/lib/component/button/Button.ts#L2119-L2131)) and `pinPressedToResting`'s loop ([Button.ts:2171](packages/lib/src/typescript/lib/component/button/Button.ts#L2171)) — from `this.pressedStyleRule.set(...)` to `this.createStyleRule(".pressed").set(...)`, and change `pinPressedToResting`'s bag source from `this.pressedClassBag` to `this.pressedStyleRule.classBag`. Do **not** apply the mechanical twenty-four-method transformation to these five — they already call `.set(...)` today, so the ordinary transformation would be a syntactic no-op that silently changes what the call does once `pressedStyleRule` returns a `StateStyleRule`.

   Check: `grep -n 'writePressedDeclaration\|materialisePressedRule\|pressedClassBag\|hoverClassBag' packages/lib/src/typescript/lib/component/button/Button.ts` — zero matches. `grep -c '\.pressedStyleRule\.set(\|\.pressedStyleRule\.setMany(' packages/lib/src/typescript/lib/component/button/Button.ts` — exactly 12 (the twelve pressed setter/clearer methods), none inside `_restoreChrome` or `pinPressedToResting`. `grep -c '\.hoverStyleRule\.set(\|\.hoverStyleRule\.setMany(' packages/lib/src/typescript/lib/component/button/Button.ts` — exactly 12. `grep -c 'createStyleRule(".pressed").set(' packages/lib/src/typescript/lib/component/button/Button.ts` — exactly 5, all inside `_restoreChrome` or `pinPressedToResting` — read both methods directly to confirm.

4. **`ToggleButton.ts`, `TabButton.ts`** — no edit. Confirm: `git status --porcelain packages/lib/src/typescript/lib/component/button/ToggleButton.ts packages/lib/src/typescript/lib/component/button/TabButton.ts` — empty output.

5. **`ARCHITECTURE.md`** — in the *Defer DOM work to render time* section, extend the "Per-component state rules" bullet to mention `createStateStyleRule` as the preferred builder when the state has class-level defaults, alongside the unchanged `createStyleRule` for the no-default case. Both dedupe by suffix and register for render-time materialisation; only which one also dedupes at the class tier differs.

6. **`packages/lib/tests/core/ClassStateRules.test.ts`** — append the six new cases from Expected Behaviour, reusing the file's `declarationsDuring` / `idSelector` / `_ruleCacheHas` helpers and its `ProbeState<N>`-per-case naming convention. The file already has six cases (its own `case 1` through `case 6`, testing `ensureClassStateRule` / `writeClassStateDeclaration` directly, up to `ProbeState6`) — continue the numbering and pick the next unused `ProbeState<N>` name for each new class; do not reuse a number already claimed. Do not create a new test file.

7. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`. `Button.pressedHoverClassHoisting.test.ts`, `TabButton.stateClassHoisting.test.ts`, `ToggleButton.selectedClassHoisting.test.ts`, and `Button.restingChromeIsolation.test.ts` must all pass unmodified — they are this refactor's regression check, in particular `Button.restingChromeIsolation.test.ts`'s "a runtime setPressedBackgroundColor call on an already-rendered, previously-default Button reaches the stylesheet" case (around L217), which is the exact scenario `StateStyleRule`'s materialisation nudge must keep passing.

8. **Run the full verification list** in Verification.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/tests/core/ClassStateRules.test.ts` |

---

## Expected Behaviour

`declarationsDuring(sink, selector, fn)` / `idSelector(component)` / `_ruleCacheHas` are the existing helpers already present in `tests/core/ClassStateRules.test.ts`. The rows below are numbered for this plan's own reference, not the file's `it()` numbering — the file already has six cases of its own (testing `ensureClassStateRule` / `writeClassStateDeclaration` directly), and these six append after them. Rows 1-5 cover `createStateStyleRule`'s class-tier comparison; the class-collision and disposal semantics of the underlying `ensureClassStateRule` are unchanged and already covered by the file's existing cases, not retested here. Row 6 is new: it covers the materialisation nudge — behaviour `StateStyleRule` now owns generically, not previously tested at the primitive level. Row 7 covers the forced-write hazard and is verified by re-running existing tests unmodified, not by writing a new one.

| # | Case | Expected | How |
|---|---|---|---|
| 1 | **`createStateStyleRule` wires `resolveDefaults` into the class bag automatically.** A local `Probe` class (next unused `ProbeState<N>` name) extends `Component`; its constructor calls `this.createStateStyleRule(".on", () => ({ color: "red" })).set("color", "red")` unconditionally. Render two instances. | The second instance's `#id.on` rule captures no `color` — `declarationsDuring(sink, idSelector(second) + '.on', () => second.getElement(true))` is `{}`. `_ruleCacheHas('.<ProbeClassName>.on')` is `true` (the shared class rule was created). | unit |
| 2 | **A deviating `.set()` call still writes the instance rule.** A third instance (same class) calling `.set("color", "blue")` instead. | The captured declarations for that instance's `#id.on` contain `color: "blue"`. | unit |
| 3 | **`.setMany()` writes only the keys that deviate.** An instance whose class bag (from `resolveDefaults`) is `{ color: "red" }`, calling `.setMany({ color: "red", backgroundColor: "blue" })`. | Captured declarations for `#id.on` contain `backgroundColor: "blue"` but not `color`. | unit |
| 4 | **`createStateStyleRule` shares the same underlying rule `createStyleRule` would return, not a second one.** An instance whose constructor calls both `this.createStyleRule(".on")` and `this.createStateStyleRule(".on", () => ({}))`. Render it. | Exactly one `#id.on` rule materialises — one `ensureStyleRule` op for that selector, not two. | unit |
| 5 | **Two suffixes on one class produce two independent class rules.** An instance whose constructor calls `createStateStyleRule(".on", () => ({ color: "red" }))` and `createStateStyleRule(".off", () => ({ color: "blue" }))`. Render two instances. | `.ClassName.on` and `.ClassName.off` are both cached (`_ruleCacheHas` true for each); the second instance's `#id.on` carries no `color` and its `#id.off` carries no `color` either — each suffix dedupes against its own class bag only. | unit |
| 6 | **A `.set()` call that matches the class default leaves the underlying rule unmaterialised at first render; a later `.set()` call on the same wrapper, after the element exists, with a deviating value, reaches the stylesheet immediately — without a further render pass.** An instance (next unused `ProbeState<N>` name) whose constructor calls `this.createStateStyleRule(".on", () => ({ color: "red" })).set("color", "red")` and keeps the returned `StateStyleRule` on an instance field. Render it (`probe.getElement(true)`) — confirm no `#id.on` write is recorded. Then call the stored wrapper's `.set("color", "blue")`. | That single call's declaration appears on `#id.on` immediately — captured via `declarationsDuring(sink, idSelector(probe) + '.on', () => probe.rule.set('color', 'blue'))` — proving the rule materialised on this call rather than only queuing. | unit |
| 7 | **`_restoreChrome`'s and `pinPressedToResting`'s forced writes stay unconditional after the refactor.** `setChromeless(true)` then `setChromeless(false)` on a `Button`, so `_restoreChrome` runs while the instance's own `#id.pressed` rule still holds a stale pin, and `setFlat(true)` then `setFlat(false)`, so `_restoreChrome` restores all four pressed keys at values that match the shared class bag. | Every restored value reaches the instance's `#id.pressed` rule for real — none are silently skipped because they happen to match the class bag. | unit — already exercised by `Button.pressedHoverClassHoisting.test.ts`'s `setChromeless` cases and `Button.restingChromeIsolation.test.ts`'s `setFlat` case (row 11) and its runtime-setter-after-render case; re-run all unmodified as this refactor's regression check. |
| 8 | **Visual parity.** The demo app's Button showcase renders identically to how it rendered once the dependency plans alone had landed — resting, hover, and pressed chrome for default-styled and explicitly-customized instances alike. | No visible change anywhere; this plan changes wiring only. | manual |

---

## Verification

From `packages/lib`:

1. `npx vitest run --no-file-parallelism` — all cases pass, including `Button.pressedHoverClassHoisting.test.ts` / `TabButton.stateClassHoisting.test.ts` / `ToggleButton.selectedClassHoisting.test.ts` / `Button.restingChromeIsolation.test.ts` unmodified. `Errors: 0`, exit code `0`.
2. `npm run typecheck` — clean.
3. `npm run typecheck:test`.
4. `npm run lint` — clean.
5. `npm run docs:api` — zero warnings (every new/changed member is `protected`/`private`/internal-module).
6. `grep -n 'writePressedDeclaration\|materialisePressedRule\|pressedClassBag\|hoverClassBag' packages/lib/src/typescript/lib/component/button/Button.ts` — zero matches.
7. `grep -c '\.pressedStyleRule\.set(\|\.pressedStyleRule\.setMany(' packages/lib/src/typescript/lib/component/button/Button.ts` — 12.
8. `grep -c '\.hoverStyleRule\.set(\|\.hoverStyleRule\.setMany(' packages/lib/src/typescript/lib/component/button/Button.ts` — 12.
9. `grep -c 'createStyleRule(".pressed").set(' packages/lib/src/typescript/lib/component/button/Button.ts` — 5.
10. `git status --porcelain packages/lib/src/typescript/lib/component/button/ToggleButton.ts packages/lib/src/typescript/lib/component/button/TabButton.ts` — empty output (no working-tree changes to either file from this plan's steps).
11. Manual, browser (`npm run dev`, http://localhost:8015): a Button demo — resting/hover/pressed for a default instance and a `pressedBackgroundColor`-customized instance. Confirm `.Button.pressed` and `.Button:hover:not(.pressed)` still exist in `<style id="Base">` and still render identically to before this plan.

---

## Documentation Impact

None. Every new, changed, or removed member is `protected` or `private`; `core/ClassStyleRules.ts` stays out of `core/index.ts`. No doc page, catalog entry, or sidebar entry changes.

---

## Potential Challenges

- **A caller that doesn't cache `createStateStyleRule`'s return value behind a private `??=` getter re-runs `resolveDefaults()` on every call.** Not a correctness bug — `ensureClassStateRule`'s own cache means only the first call's result is ever used for the class rule — but it wastes the resolver's cost repeatedly. Mitigation is the documented idiom (Internal Structure), matching the base tier's own acceptance of this cost (`getClassStyleDefaults()` runs on every `applyStyle` regardless of cache state).
- **The mechanical setter rewrite touches twenty-four call sites in `Button.ts`** (twelve pressed setter/clearer methods, twelve hover setter/clearer methods) with an identical, easy-to-get-subtly-wrong transformation. The greps in Ordered Implementation Steps 3 catch a missed site; the unmodified regression tests catch a wrong one.
- **Five call sites are not setter/clearer methods and must be excluded from the mechanical rewrite, not just found by it.** `_restoreChrome`'s four forced writes and `pinPressedToResting`'s loop already call `.set(...)` directly today, deliberately bypassing the class-bag comparison. Applying the ordinary transformation to them would be a no-op syntactically (they already read `.set(...)`) while silently changing what that call does. Step 3 requires enumerating these sites before the rewrite, not relying on the same grep that catches the ordinary sites.
- **`ClassStateRules.test.ts`'s per-case uniquely-named `ProbeState<N>` convention must be followed for all six of this plan's new cases**, continuing the numbering after the file's existing six, or a new probe collides with a class name an earlier case already registered, silently taking the name-collision opt-out branch instead of the path the case means to test.
- **A future author extending `StateStyleRule` to `ToggleButton`/`TabButton` without first isolating their resting chrome would reintroduce the specificity bug this plan's scope decision avoids.** Flagged explicitly in `## Non-Goals` so it is not attempted by accident.

---

## Critical Files

- [plans/implemented/hoist-button-tabbar-state-chrome-rules.md](implemented/hoist-button-tabbar-state-chrome-rules.md) — first dependency. Its `## Implementation Notes` records why `Button.getPressedClassDeclarations()` was narrowed to `color` alone, and why `ToggleButton.selectedClassBag` was hardcoded `null` and `TabButton`'s hover/selected overrides deleted — the source for this plan's ToggleButton/TabButton scope decision.
- [plans/implemented/button-resting-chrome-state-isolation.md](implemented/button-resting-chrome-state-isolation.md) — second dependency. Its `## Internal Structure` is this plan's "before" state for `Button.ts`'s pressed/hover mechanism; its `## Implementation Notes` records the materialisation-nudge bug and fix (`writePressedDeclaration` / `writePressedDeclarations` / `materialisePressedRule`) this plan folds into `StateStyleRule`. Read both sections before Ordered Implementation Steps 3.
- [packages/lib/src/typescript/lib/component/button/Button.ts](packages/lib/src/typescript/lib/component/button/Button.ts) — read `pressedStyleRule` / `hoverStyleRule` / `restingStyleRule` (L558-L597), `materialisePressedRule` / `writePressedDeclaration` / `writePressedDeclarations` / `pressedClassBag` / `hoverClassBag` (L679-L731), `getPressedClassDeclarations` / `getHoverClassDeclarations` (L751-L780), `applyChromeOptions`'s chromeless branch (L1083-L1157), `_restoreChrome` (L2085-L2144), `pinPressedToResting` (L2155-L2174), and the pressed/hover setters (L2493-L2929). Line numbers verified at time of writing; they will shift once edits land — locate members by name.
- [packages/lib/src/typescript/lib/component/button/ToggleButton.ts](packages/lib/src/typescript/lib/component/button/ToggleButton.ts) — read `selectedClassBag` (around L72) and its doc comment in full; it is this plan's primary evidence for why `.selected` dedup stays disabled.
- [packages/lib/src/typescript/lib/core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) — `ensureClassStateRule` (L287), `writeClassStateDeclaration` (L347), `writeManyClassStateDeclarations` (L361) — the functions `StateStyleRule` wraps.
- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — `createStyleRule` (L1009), `getElement` (L1027), `matchesClassStyle` (L4716), `writeRuleDeclaration` (L4736), `getClassStyleDefaults` (L4778), `applyStyle` (L4799), `materialiseWhenNeeded` (L5063) — the base-tier precedent this plan's design decisions cite, the `getElement`/materialise idiom `StateStyleRule` reuses, and the existing per-instance builder `createStateStyleRule` wraps unchanged.
- [packages/lib/src/typescript/lib/core/StyleTarget.ts](packages/lib/src/typescript/lib/core/StyleTarget.ts) — `StyleRule.set` / `queue` (L35, L61), `hasQueuedDeclarations` (L108), `ensure` (L307) — the methods `StateStyleRule.set()` / `setMany()` / `_materialise()` call directly.
- [packages/lib/tests/core/ClassStateRules.test.ts](packages/lib/tests/core/ClassStateRules.test.ts) — the file this plan's six new cases are appended to; read its existing six cases for the `ProbeState<N>` naming and helper conventions.
- [packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts](packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts) — its "a runtime setPressedBackgroundColor call on an already-rendered, previously-default Button reaches the stylesheet" case (around L217) is this plan's regression check that folding the nudge into `StateStyleRule` doesn't reintroduce the bug `writePressedDeclaration` was built to fix; read it before Ordered Implementation Steps 3 rather than writing a new test.
- [packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts](packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts) — its `setChromeless` round-trip cases are the other half of this plan's forced-write regression check.

---

## Non-Goals

- **Converting any other `createStyleRule` caller** (`AccordionIndicator`, `CollapseButton`, `DiagramNode`, `WindowBorder`, `Header`, …) onto `createStateStyleRule`. Structurally the same opportunity, but out of scope — a future plan can reuse `createStateStyleRule` directly, the same way `hoist-button-tabbar-state-chrome-rules` left `ensureClassStateRule` / `writeClassStateDeclaration` exported for reuse.
- **Deprecating or removing `Component.createStyleRule`.** It remains the correct primitive for a per-instance state rule with no class-level default to dedupe against.
- **Changing the signatures of `ensureClassStateRule`, `writeClassStateDeclaration`, or `writeManyClassStateDeclarations`.** This plan reuses them exactly as they exist today.
- **Giving `createStateStyleRule` a resting-tier / mutual-exclusion mode.** See Architecture Decisions — that pattern stays manual and per-component.
- **Adding a forced-write / bypass-comparison *setter* to `StateStyleRule`'s public surface** (e.g. a `setForced`). Unnecessary: `createStyleRule(suffix)`'s existing per-suffix cache already gives any call site that needs an unconditional write a way to reach the same underlying `StyleRule` without going through the wrapper. `classBag` is a read accessor to the same bag `set()` / `setMany()` already compare against — it exposes no new way to skip the comparison, so it does not reopen this.
- **`ToggleButton.ts` and `TabButton.ts`.** Their `.selected` class-tier dedup stays disabled, exactly as it is today — see Architecture Decisions. Re-enabling it needs the same resting-chrome isolation `button-resting-chrome-state-isolation` built for `Button`, which is out of scope here; a future plan that does that work can then route `ToggleButton.selectedStyleRule` onto `createStateStyleRule` unchanged.
- **Editing `plans/implemented/button-resting-chrome-state-isolation.md` or `plans/implemented/hoist-button-tabbar-state-chrome-rules.md`.** Historical record of what shipped; not edited by this plan.
- **`plans/implemented/suppress-empty-style-rules.md`.** Unrelated empty-CSS-rule fix; only relevant here as the reason `ARCHITECTURE.md` is listed under `touches-shared`.
- **Bumping the package version.** Recorded for release time, not this plan.

---

## Notes

[^no-render-pass]: Unlike the base `#id` rule, which is fully re-derived from getters on every `applyStyle` call (so a stale imperative write is never observed), a state rule's declarations are whatever the setter last wrote, from whichever call site last ran. There is no single pass that re-derives all of them together, so there is nowhere to cache "what this render already delivers" the way `_inheritedStyleBag` does for the base tier. This is `writeClassStateDeclaration`'s own reason for its explicit-parameter shape, carried over unchanged into why `StateStyleRule` binds the rule and bag to the object instead.

[^materialise-in-primitive]: `button-resting-chrome-state-isolation`'s own `## Implementation Notes` (`plans/implemented/button-resting-chrome-state-isolation.md`) records this in full. A first fix attempt added `materialisePressedRule()` and called it explicitly from two orchestration methods, `_clearChrome()` and `_applyFlatChrome()`. The audit round found this placement too narrow: a direct runtime call to `setPressedX` / `clearPressedX` — the ordinary way to customise an already-rendered button — bypasses both of those methods and still silently drops its write, reproduced concretely as `new Button('X'); btn.getElement(true); btn.setPressedBackgroundColor('purple')` recording zero stylesheet writes. The fix that shipped moved the nudge to the actual choke point every pressed-tier write funnels through — the two wrapper methods `writePressedDeclaration` / `writePressedDeclarations`, which every one of the twelve `setPressedX` / `clearPressedX` methods now calls instead of the shared comparison helper directly. `StateStyleRule.set()` / `.setMany()` are that same choke point, generalised: any caller's write path — construction, a runtime setter, a chrome-mode toggle — funnels through one of these two methods with no way to add a new pressed/hover-tier write that skips the nudge.

[^toggle-selected-disabled]: `ToggleButton.ts`'s `selectedClassBag` getter reads `return null;` with an inline comment explaining why: `.selected:not(:hover)`'s three fields are not safe to dedupe against a shared class rule, because `ToggleButton` / `TabButton`'s resting chrome writes the same three properties unconditionally onto the bare `#id` rule, and `button-resting-chrome-state-isolation` — which fixed the equivalent problem for `Button`'s `.pressed` — did not touch these two classes. `hoist-button-tabbar-state-chrome-rules`'s own `## Implementation Notes` records the original finding: `ToggleButton.getSelectedClassDeclarations()` was removed entirely as a dedup source, because none of `.selected`'s three fields are safe and `ToggleButton` has no `color`-equivalent to fall back on — unlike Button's resting `color`, already hoisted onto the class tier, leaving nothing on `#id` for `pressedForegroundColor` to compete with. `TabButton.getHoverClassDeclarations()` / `getSelectedClassDeclarations()` were deleted for the same reason: every field either override would have contributed was unsafe.

[^invariant-grounding]: The safety invariant rests on Button's own history. `hoist-button-tabbar-state-chrome-rules`'s audit found `backgroundColor` / `backgroundImage` / `boxShadow` unsafe to dedupe at Button's `.pressed` tier, because Button's resting chrome wrote them unconditionally onto the bare `#id` rule `(1,0,0)`, which always outranks `.Button.pressed` `(0,2,0)` regardless of state — the fix was to narrow `getPressedClassDeclarations()` down to `pressedForegroundColor`, the one property whose resting write was *already* comparison-gated. `button-resting-chrome-state-isolation` restored the invariant for the three narrowed-out properties not by adding a value comparison, but by removing the competition entirely: it moved Button's resting `background-color` / `background-image` / `box-shadow` off the bare `#id` rule onto a `#id:not(.pressed)` rule, which structurally cannot match the same element `.pressed` matches. The identical conflict blocks `ToggleButton` / `TabButton`'s `.selected` state today, for the same reason — see the ToggleButton/TabButton scope decision above — because neither ever got the analogous resting-tier isolation.

[^resting-tier-manual]: `button-resting-chrome-state-isolation`'s own `## Non-Goals` rejects deduping the resting tier onto a shared class rule: a component's `clear*()` setters remove a property by writing `null` to the instance rule, and once a class-tier resting rule exists, that removal lets the class rule's value show through instead of truly clearing — fixing that needs a per-property neutral-value convention across every `Component` clear setter, a `Component`-wide change that plan explicitly scoped out. `createStateStyleRule` always builds both an instance rule and a class-tier dedup rule together; there is no way to ask it for the instance-only half without either introducing the class-tier rule the resting tier must not have, or adding a second code path that defeats the point of one primitive with one contract.

[^classbag-accessor]: `classBag` returns the identical value a caller could already get by calling `ensureClassStateRule(ctor, suffix, resolveDefaults())` a second time — `StateStyleRule` just avoids the redundant call and the extra `resolveDefaults()` invocation that would otherwise cost. It is a read accessor, not a write bypass: reading `classBag` cannot skip a comparison or write a declaration, so it does not reopen the "no forced-write method on `StateStyleRule`'s public surface" Non-Goal, which is about *writing* around the comparison, not about *reading* the bag the comparison itself already computed.

[^forced-write-hazard]: Confirmed by reading the current, already-implemented `Button.ts` on this branch: `grep -n '\.pressedStyleRule\.set(\|\.pressedStyleRule\.setMany(' packages/lib/src/typescript/lib/component/button/Button.ts` returns exactly five lines before this plan runs — `_restoreChrome`'s four forced writes for `color` / `backgroundColor` / `backgroundImage` / `boxShadow` ([Button.ts:2119-2131](packages/lib/src/typescript/lib/component/button/Button.ts#L2119-L2131)) and `pinPressedToResting`'s loop ([Button.ts:2171](packages/lib/src/typescript/lib/component/button/Button.ts#L2171)). `button-resting-chrome-state-isolation`'s `## Internal Structure` widened `_restoreChrome` to force `backgroundColor` / `backgroundImage` / `boxShadow` the same way its inherited `color` write already did, and added `pinPressedToResting()`, which loops over the pressed class bag's keys for the same reason — "outrank the class rule even when the two values coincide," per that plan's own comment. None of these five are `writeClassStateDeclaration(this...)` / `writePressedDeclaration(...)` calls, so none would be touched by this plan's mechanical setter-rewrite or caught by its regression grep for those two names — they must be found and rerouted separately, per Ordered Implementation Steps 3.

[^ordering-not-symmetric]: The dependency is one-directional because only one of the two plans can be edited here. `plans/implemented/button-resting-chrome-state-isolation.md` is read as fixed, already-implemented content for this amendment — its Internal Structure literally writes `this.pressedStyleRule.set(...)` in `pinPressedToResting()` and in `_restoreChrome`'s widened block, correct only when `pressedStyleRule` was still the plain `StyleRule` it was before this plan. Requiring `button-resting-chrome-state-isolation` to land first, and having this plan's own Ordered Implementation Steps enumerate and reroute the resulting forced-write call sites (Architecture Decisions, "Forced writes on `pressedStyleRule`..."), keeps both plans correct as written without editing the earlier one.
