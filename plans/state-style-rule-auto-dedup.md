---
depends-on:
  - hoist-button-tabbar-state-chrome-rules
  - button-resting-chrome-state-isolation
touches-shared:
  - ARCHITECTURE.md
---

# State-Rule Class-Tier Dedup by Default — Implementation Plan

## Overview

[`plans/hoist-button-tabbar-state-chrome-rules.md`](hoist-button-tabbar-state-chrome-rules.md) (depended on by this plan) gives `Button`, `ToggleButton`, and `TabButton` a way to share their `.pressed` / `:hover:not(.pressed)` / `.selected:not(:hover)` CSS declarations across every default-styled instance, through two new free functions in [`ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts): `ensureClassStateRule` (computes and caches a shared `.ClassName<suffix>` rule) and `writeClassStateDeclaration` / `writeManyClassStateDeclarations` (skip an instance-rule write that already matches it). Each of the three components gets its own hand-written `getXClassDeclarations()` resolver and every one of its pressed/hover/selected setters is individually rerouted to call the comparison helper instead of writing to its rule directly.

The dependency plan's mechanism is a manual opt-in: a future component author who wants a state rule reaches for [`Component.createStyleRule(suffix)`](packages/lib/src/typescript/lib/core/Component.ts#L1009) — the only primitive `Component` currently exposes for one — and gets a bare per-instance rule with no dedup, unless they separately discover `ensureClassStateRule` / `writeClassStateDeclaration`, write their own resolver, and reroute their own setters by hand. That is exactly the shape `Button` had before the dependency plan fixed it.

This plan adds a second `Component` primitive, `createStateStyleRule(suffix, resolveDefaults)`, that returns a small wrapper object whose own `set()` / `setMany()` already perform the class-tier comparison — so a caller gets the dedup automatically just by calling the object's normal write methods, without knowing `ensureClassStateRule` or `writeClassStateDeclaration` exist. It then refactors `Button`, `ToggleButton`, and `TabButton` onto the new primitive, removing their hand-rolled resolvers and per-setter routing. It touches [`ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) (one new class), [`Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) (one new protected method), `Button.ts`, `ToggleButton.ts`, and `ARCHITECTURE.md`. `StyleTarget.ts` is not touched — the suffix-aware `"class"` scope the dependency plan adds there is all this plan needs.

The dependency plan's own implementation found that this dedup mechanism is only safe for a property when nothing else competing for that property writes it unconditionally onto a higher-specificity rule — the reason `Button`'s pressed/hover dedup shipped covering only `pressedForegroundColor` instead of the four properties it was designed for. A second plan, [`plans/button-resting-chrome-state-isolation.md`](button-resting-chrome-state-isolation.md), restores the other three properties by isolating Button's resting chrome behind a `:not(.pressed)` selector, and adds two call sites of its own that deliberately write around this comparison. This plan depends on both, and its refactor of `Button.ts` must preserve that safety property rather than silently break it — see `## Architecture Decisions`.

---

## Architecture Decisions

### `Component.createStateStyleRule(suffix, resolveDefaults)` is a new sibling of `createStyleRule`, not a replacement

[`createStyleRule(selectorSuffix)`](packages/lib/src/typescript/lib/core/Component.ts#L1009) stays exactly as it is — the right choice for a state rule with no meaningful class-level default (an instance-only affordance). `createStateStyleRule` is for the common case where a state rule *does* have class-level defaults: it builds the same underlying per-instance `StyleRule` (by calling `createStyleRule` internally, so render-time materialisation, selector tracking, and disposal are unchanged) and wraps it in a `StateStyleRule` object carrying the resolved class-tier comparison bag.

### The wrapper's own `set()` / `setMany()` do the comparison — not a helper the caller must remember to call

The base tier's "hard to avoid" property comes from a single choke point: every `applyStyle` phase writes through [`writeRuleDeclaration`](packages/lib/src/typescript/lib/core/Component.ts#L4720), which reads a per-render cache (`_inheritedStyleBag`) computed once at the top of [`applyStyle`](packages/lib/src/typescript/lib/core/Component.ts#L4757). State rules have no equivalent single point — their setters fire from construction, a runtime call, or a chrome-mode toggle, not from one recompute pass[^no-render-pass] — so the dependency plan's `writeClassStateDeclaration` takes the rule and comparison bag as explicit parameters instead. This plan keeps that shape internally but moves the parameter-passing off the call site: `StateStyleRule.set(key, value)` already knows its own rule and bag, so a setter body reads `this.pressedStyleRule.set(key, value)` — indistinguishable from a bare, non-deduping `rule.set(key, value)` call. There is nothing extra to opt into.

### `resolveDefaults` is a plain callback, not a suffix-keyed override method

[`Component.getClassStyleDefaults()`](packages/lib/src/typescript/lib/core/Component.ts#L4736) solves the equivalent problem for the base tier with one `protected`, subclass-overridable method — because there is exactly one base `#id` rule per component. A component can have several state rules (`Button` has two, `ToggleButton` adds a third), each needing its own defaults, and TypeScript has no type-safe way to dispatch to a differently-named override method by a runtime suffix string. So `createStateStyleRule` takes the resolver as a parameter instead of looking it up itself. Subclass overridability is preserved as a convention layered on top, not built into the primitive: a component author still defines their own `protected getXClassDeclarations()` method (exactly as `Button` / `ToggleButton` already do) and passes a thunk that calls it — `() => this.getPressedClassDeclarations()` — to `createStateStyleRule`. Because the override still lives on a normal method reached through `this`, a subclass overriding just that method needs no other change: `TabButton`'s existing `getHoverClassDeclarations()` / `getSelectedClassDeclarations()` overrides keep working with zero edits to `TabButton.ts` once `Button` / `ToggleButton`'s getters route through the new primitive (see Ordered Implementation Steps).

### `StateStyleRule` delegates to the existing `writeClassStateDeclaration` / `writeManyClassStateDeclarations`, it doesn't reimplement them

`StateStyleRule.set()` calls `writeClassStateDeclaration(rule, bag, key, value)` internally; `setMany()` calls `writeManyClassStateDeclarations`. This keeps the comparison logic in one place and keeps the two free functions independently usable — the dependency plan's own `## Non-Goals` explicitly keeps them exported "so a follow-up plan can reuse them without inventing anything new," for a future non-`Component` caller or one that already has its own resolved bag. Refactoring `Button` / `ToggleButton` off calling them directly (this plan) does not make them dead code.

### `Button` and `ToggleButton` are refactored onto the new primitive in this same plan

Leaving the dependency plan's hand-rolled mechanism in place while adding a separate automatic one would mean the codebase's only worked example of a state rule with class defaults still teaches the manual pattern — exactly what this plan exists to stop happening again. The refactor is mechanical and net code-shrinking: each of `Button`'s twelve pressed/hover setter-clearer pairs and `ToggleButton`'s four selected setters changes only its rule's final call (`writeClassStateDeclaration(rule, bag, key, value)` → `rule.set(key, value)`, `writeManyClassStateDeclarations(rule, bag, values)` → `rule.setMany(values)`); the `pressedClassBag` / `hoverClassBag` / `selectedClassBag` getters and their backing fields are deleted outright, since the bag now lives inside `StateStyleRule`. `getPressedClassDeclarations()` / `getHoverClassDeclarations()` / `getSelectedClassDeclarations()` are untouched — only how they're invoked changes. A small number of call sites in `Button.ts` are not setter-clearer pairs and do not follow this transformation; see "Forced writes on `pressedStyleRule` must keep reaching the raw `StyleRule`" below. The dependency plans' own Button/ToggleButton/TabButton test files (created by the first, some further updated by the second) pin the exact observable CSS output and are not modified by this plan; they are the regression check that this refactor changes wiring, not behaviour.[^tabbutton-untouched]

### `StyleTarget.ts` is not touched

`createStateStyleRule` needs no new selector shape: the instance-tier rule is `createStyleRule`'s existing `"component"` scope (already suffix-aware before the dependency plan), and the class-tier rule is built inside `ensureClassStateRule`, which the dependency plan already routes through the new suffix-aware `"class"` scope. This plan only adds new code in `ClassStyleRules.ts` and `Component.ts`.

### Every dedup this plan performs must satisfy a class-tier safety invariant

A property is only safe to dedupe against a class-tier rule at a given suffix tier if every other tier the same component participates in — including its base `#id` resting tier — also writes that property in a comparison-gated way, never unconditionally. An unconditional write anywhere always wins the cascade over a class-only selector, no matter how many classes the deduped tier's selector chains, so one ungated writer defeats the dedup for every tier that declares the same property. `createStateStyleRule` does not verify this on a caller's behalf — it is a rule a component author (or a future extension of the primitive itself) must satisfy by construction before wrapping any given property in a state rule.

Button's own history is the worked example:[^invariant-grounding]

| Property | Resting-tier write | Safe to dedupe at `.pressed`? |
|---|---|---|
| `color` | comparison-gated — hoisted onto the class tier by the base-tier `ClassStyleDefaults` mechanism, so nothing on `#id` competes | yes — shipped as `pressedForegroundColor` |
| `backgroundColor`, before `button-resting-chrome-state-isolation` | unconditional, on the bare `#id` rule `(1,0,0)` | no — narrowed out of `getPressedClassDeclarations()` |
| `backgroundColor`, after `button-resting-chrome-state-isolation` | comparison-gated by construction — moved to `#id:not(.pressed)`, which never matches while `.pressed` does | yes — restored to `getPressedClassDeclarations()` |

### `createStateStyleRule` does not gain a resting-tier mode

`createStateStyleRule(suffix, resolveDefaults)` stays scoped to suffixes that get both an instance-tier rule and a class-tier dedup rule — pressed/hover/selected-style suffixes. It does not grow a special case for a mutual-exclusion "resting" suffix such as `:not(.pressed)`. The resting tier needs the opposite shape: an instance-only rule with no class-tier counterpart at all, plus a redirect at the component's own base-tier write choke points for a hand-picked set of properties. Folding that into `createStateStyleRule` would mean either giving the resting tier the class-tier rule it must not have, or bolting an unrelated write-interception mechanism onto a primitive whose entire job is wrapping an already-called setter. It stays a manual, per-component technique, built directly in the component's own source file the way `Button.ts` does it.[^resting-tier-manual]

### Forced writes on `pressedStyleRule` must keep reaching the raw `StyleRule`, not the new wrapper

`Button._restoreChrome` already makes one deliberate unconditional write today — [`this.pressedStyleRule.set("color", d.pressedForegroundColor)`](packages/lib/src/typescript/lib/component/button/Button.ts#L1929) — bypassing the class-bag comparison on purpose, to overwrite a stale pin left by a prior chromeless or flat pass. Once `pressedStyleRule` returns a `StateStyleRule`, its `.set()` *is* the comparison-gated write, so this exact call would silently start skipping whenever the restored value matches the class default — reintroducing the stale-pin regression the forced write exists to prevent. The fix needs no new API: [`createStyleRule(selectorSuffix)`](packages/lib/src/typescript/lib/core/Component.ts#L1009) already caches its return value per suffix and returns the identical `StyleRule` object on every call — the same guarantee `createStateStyleRule` itself relies on internally. Every call site that must bypass the class-bag comparison calls `this.createStyleRule(".pressed").set(key, value)` directly instead of going through `pressedStyleRule`, reaching the same underlying rule without the wrapper's comparison.[^forced-write-hazard]

### `depends-on` requires both `hoist-button-tabbar-state-chrome-rules` and `button-resting-chrome-state-isolation`

This plan calls `ensureClassStateRule` (only exists once the first plan lands), requires the suffix-aware `"class"` `StyleRuleScope` case it adds to `StyleTarget.ts`, and rewrites the exact `Button` / `ToggleButton` call sites it introduces. It also rewrites `Button.pressedStyleRule` into a type that changes what a raw `.set()` call on it means — which is only safe if every existing raw call site on that getter has already been enumerated and accounted for, per the decision above. `button-resting-chrome-state-isolation.md` adds two more such call sites (`_restoreChrome`'s three widened writes and `pinPressedToResting()`), written correctly against `Button.ts`'s current (pre-this-plan) `pressedStyleRule` shape. Ordering this plan strictly after both — rather than leaving it order-independent of the second — is what keeps those call sites correct without editing that plan's own text.[^ordering-not-symmetric] None of this plan's steps are executable against the current, un-hoisted `Button.ts` / `ToggleButton.ts` either way.

`touches-shared` does **not** additionally list `ClassStyleRules.ts`, `Component.ts`, `Button.ts`, or `ToggleButton.ts`: `depends-on` already serialises this plan strictly after both dependencies, so there is no concurrent-edit window on those files. `ARCHITECTURE.md` is listed under `touches-shared` instead, because a different, unordered sibling plan drafted the same session — `plans/suppress-empty-style-rules.md` — edits the same *Defer DOM work to render time* section this plan edits (a different bullet, but the dependency plan's own precedent for this frontmatter field flags at file granularity, not line granularity, since that's the level a worktree merge conflicts at).

---

## Public API

```typescript
// core/ClassStyleRules.ts — new export. Not added to core/index.ts (module stays internal,
// matching ensureClassStyleRule / ensureClassStateRule's existing treatment).

/**
 * Wraps a per-instance state `StyleRule` together with the class-tier
 * comparison bag `ensureClassStateRule` resolves for it. `set()` / `setMany()`
 * skip a write that already matches the class rule, exactly like
 * `writeClassStateDeclaration` / `writeManyClassStateDeclarations` — this
 * class exists so a caller gets that comparison by calling the object's own
 * write methods, with nothing else to opt into.
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
    );

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
// `_pressedClassBag` / `_hoverClassBag` backing fields — superseded by the
// bag StateStyleRule now carries internally.
```

```typescript
// component/button/ToggleButton.ts — same treatment.
private get selectedStyleRule(): StateStyleRule;
// REMOVED: `selectedClassBag` getter and `_selectedClassBag` backing field.
```

`TabButton.ts` has no signature changes — see Architecture Decisions.

No consumer-facing signature changes anywhere: every new, changed, or removed member is `protected` or `private`.

---

## Internal Structure

### `core/ClassStyleRules.ts` — `StateStyleRule`

Placed after `writeManyClassStateDeclarations` (the dependency plan's last addition, at the end of the file):

```typescript
export class StateStyleRule {
    private readonly _rule: StyleRule;
    private readonly _bag:  ClassStyleBag | null;

    constructor(
        ctor: Function,
        suffix: string,
        rule: StyleRule,
        resolveDefaults: () => Record<string, string | null>,
    ) {
        this._rule = rule;
        this._bag  = ensureClassStateRule(ctor, suffix, resolveDefaults());
    }

    set(key: string, value: string | null): void {
        writeClassStateDeclaration(this._rule, this._bag, key, value);
    }

    setMany(values: Record<string, string | null>): void {
        writeManyClassStateDeclarations(this._rule, this._bag, values);
    }
}
```

### `core/Component.ts` — `createStateStyleRule`

Placed directly below the existing `createStyleRule` ([line 1009-1018](packages/lib/src/typescript/lib/core/Component.ts#L1009-L1018)):

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
    return new StateStyleRule(this.constructor, selectorSuffix, this.createStyleRule(selectorSuffix), resolveDefaults);
}
```

Extend the existing `~/core/ClassStyleRules.js` import ([line 24](packages/lib/src/typescript/lib/core/Component.ts#L24)) to add `StateStyleRule`.

### `component/button/Button.ts` — the getter and one representative setter, before → after

Only the getters' return expression and each setter's final line change; nothing else in a setter's body moves. `getPressedClassDeclarations()` / `getHoverClassDeclarations()` are untouched.

```typescript
// Before (per plans/hoist-button-tabbar-state-chrome-rules.md):
private declare _pressedClassBag?: Readonly<Record<string, string | null>> | null;
private get pressedClassBag(): Readonly<Record<string, string | null>> | null {
    return this._pressedClassBag ??= ensureClassStateRule(this.constructor, ".pressed", this.getPressedClassDeclarations());
}

private declare _pressedStyleRule?: StyleRule;
private get pressedStyleRule(): StyleRule {
    return this._pressedStyleRule ??= this.createStyleRule(".pressed");
}

setPressedBackgroundColor(backgroundColor: string): this {
    this._options.pressedBackgroundColor = backgroundColor;
    writeClassStateDeclaration(this.pressedStyleRule, this.pressedClassBag, "backgroundColor", backgroundColor);
    return this;
}
```

```typescript
// After:
private declare _pressedStyleRule?: StateStyleRule;
private get pressedStyleRule(): StateStyleRule {
    return this._pressedStyleRule ??= this.createStateStyleRule(".pressed", () => this.getPressedClassDeclarations());
}

setPressedBackgroundColor(backgroundColor: string): this {
    this._options.pressedBackgroundColor = backgroundColor;
    this.pressedStyleRule.set("backgroundColor", backgroundColor);
    return this;
}
```

Every other pressed/hover setter and clearer in `Button.ts` — all twelve pairs — follows the identical transformation: `writeClassStateDeclaration(<rule>, <bag>, key, value)` → `<rule>.set(key, value)`; `writeManyClassStateDeclarations(<rule>, <bag>, values)` → `<rule>.setMany(values)`. `hoverStyleRule` gets the same getter rewrite, reading `() => this.getHoverClassDeclarations()`.

### `component/button/Button.ts` — `_restoreChrome`'s forced write, before → after

This call site does **not** follow the transformation above. It already calls `.set()` directly today — not through `writeClassStateDeclaration` — because it deliberately needs an unconditional write. Reroute it to the raw rule instead of the new wrapper, per Architecture Decisions.

```typescript
// Before (current code, Button.ts:1929):
this.pressedStyleRule.set("color", d.pressedForegroundColor);
```

```typescript
// After:
this.createStyleRule(".pressed").set("color", d.pressedForegroundColor);
```

Because `button-resting-chrome-state-isolation` is required by `depends-on` and lands first, `_restoreChrome` also forces three more writes the same way by this point (`backgroundColor`, `backgroundImage`, `boxShadow`), and a second method, `pinPressedToResting()`, forces writes in a loop over the pressed class bag's keys. Apply the identical rewrite — `this.pressedStyleRule.set(...)` → `this.createStyleRule(".pressed").set(...)` — to every one of them. None of these are setter-clearer pairs and none should be touched by the mechanical `writeClassStateDeclaration(...)` → `<rule>.set(...)` transformation; they already call `.set()` today and must keep doing so, just on the raw rule instead of the getter.

### `component/button/ToggleButton.ts` — the getter and the border setter

```typescript
// Before:
private declare _selectedClassBag?: Readonly<Record<string, string | null>> | null;
private get selectedClassBag(): Readonly<Record<string, string | null>> | null {
    return this._selectedClassBag ??= ensureClassStateRule(this.constructor, ".selected:not(:hover)", this.getSelectedClassDeclarations());
}
private declare _selectedStyleRule?: StyleRule;
private get selectedStyleRule(): StyleRule {
    return this._selectedStyleRule ??= this.createStyleRule(".selected:not(:hover)");
}

setSelectedBorder(options?: BorderOptions | string): this {
    this._selectedBorder = typeof options === "string" ? { border: options } : (options ?? {});
    writeManyClassStateDeclarations(this.selectedStyleRule, this.selectedClassBag, borderToStyle(this._selectedBorder));
    return this;
}
```

```typescript
// After:
private declare _selectedStyleRule?: StateStyleRule;
private get selectedStyleRule(): StateStyleRule {
    return this._selectedStyleRule ??= this.createStateStyleRule(".selected:not(:hover)", () => this.getSelectedClassDeclarations());
}

setSelectedBorder(options?: BorderOptions | string): this {
    this._selectedBorder = typeof options === "string" ? { border: options } : (options ?? {});
    this.selectedStyleRule.setMany(borderToStyle(this._selectedBorder));
    return this;
}
```

The constructor's three calls to `setSelectedShadow` / `setSelectedBackgroundColor` / `setSelectedBackgroundImage` (already routed setters as of the dependency plan) are untouched — they call the setters above, which now dedupe through the rewritten getter automatically.

### `component/button/TabButton.ts` — no change

`TabButton` never had its own `pressedStyleRule` / `hoverStyleRule` / `selectedStyleRule` getter — it inherits `Button`'s and `ToggleButton`'s. Its two overrides, `getHoverClassDeclarations()` and `getSelectedClassDeclarations()`, are called polymorphically through `this` from inside the thunks the rewritten getters above pass to `createStateStyleRule` — the same virtual dispatch that already made them work under the dependency plan's hand-rolled `pressedClassBag`-style getters. No line in `TabButton.ts` changes.

---

## Ordered Implementation Steps

1. **`core/ClassStyleRules.ts`** — add the `StateStyleRule` class per Internal Structure, placed after `writeManyClassStateDeclarations`. Extend the top-of-file module comment (already updated once by the dependency plan) to add one clause: this module also exposes `StateStyleRule`, the wrapper `Component.createStateStyleRule` returns.
   Check: `npm run typecheck` from `packages/lib` — clean.

2. **`core/Component.ts`** — add `createStateStyleRule` directly below `createStyleRule` ([line 1009-1018](packages/lib/src/typescript/lib/core/Component.ts#L1009-L1018)) per Internal Structure. Extend the existing `~/core/ClassStyleRules.js` import ([line 24](packages/lib/src/typescript/lib/core/Component.ts#L24)) to add `StateStyleRule`.
   Check: `npm run typecheck` — clean.

3. **`component/button/Button.ts`** — rewrite the `pressedStyleRule` / `hoverStyleRule` getters and delete the `pressedClassBag` / `hoverClassBag` getters and their backing fields, per Internal Structure. Change the import from `~/core/ClassStyleRules.js` from `{ ensureClassStateRule, writeClassStateDeclaration, writeManyClassStateDeclarations }` to `type { StateStyleRule }` (no longer called directly). Route all twelve pressed/hover setter/clearer pairs through the mechanical transformation in Internal Structure — the final `writeClassStateDeclaration(...)` / `writeManyClassStateDeclarations(...)` line in each becomes `<rule>.set(...)` / `<rule>.setMany(...)`. Do not change `_pressedBorder` / `_hoverBorder` field writes, `_options.X` writes, method signatures, or `getPressedClassDeclarations()` / `getHoverClassDeclarations()`.

   Before touching any of these twelve pairs, find every call site that already calls `.set(`/`.setMany(` directly on `pressedStyleRule` or `hoverStyleRule` — a deliberate forced write that bypasses `writeClassStateDeclaration` on purpose (see "Forced writes on `pressedStyleRule`..." in Architecture Decisions and the matching Internal Structure subsection). As of this plan (with `button-resting-chrome-state-isolation` landed), that is `_restoreChrome`'s forced pressed writes and `pinPressedToResting()`. Do **not** apply the mechanical transformation to these — reroute each to `this.createStyleRule(<same suffix>).set(...)` / `.setMany(...)` instead of the getter, so it keeps writing unconditionally.

   Check: `grep -n 'writeClassStateDeclaration(this\.\|writeManyClassStateDeclarations(this\.' packages/lib/src/typescript/lib/component/button/Button.ts` — zero matches. `grep -n '\.pressedStyleRule\.set(\|\.pressedStyleRule\.setMany(\|\.hoverStyleRule\.set(\|\.hoverStyleRule\.setMany(' packages/lib/src/typescript/lib/component/button/Button.ts` — exactly 24 matches (the twelve setter/clearer pairs, six for `.pressed` and six for `:hover:not(.pressed)`), and every one of them sits inside a `set*`/`clear*` pressed or hover method — none inside `_restoreChrome` or `pinPressedToResting`. `grep -n 'createStyleRule(".pressed").set(' packages/lib/src/typescript/lib/component/button/Button.ts` — one match per forced write identified above, confirming each reaches the raw rule instead of the wrapper.

4. **`component/button/ToggleButton.ts`** — same treatment for `selectedStyleRule` / `selectedClassBag`, per Internal Structure. Leave the constructor's three setter calls and `setFlat`'s two literal setter calls untouched — they already call routed setters.
   Check: `grep -n 'writeClassStateDeclaration(this\.\|writeManyClassStateDeclarations(this\.' packages/lib/src/typescript/lib/component/button/ToggleButton.ts` — zero matches.

5. **`component/button/TabButton.ts`** — no edit. Confirm: `git status --porcelain packages/lib/src/typescript/lib/component/button/TabButton.ts` — empty output.

6. **`ARCHITECTURE.md`** — in the *Defer DOM work to render time* section, extend the "Per-component state rules" bullet to mention `createStateStyleRule` as the preferred builder when the state has class-level defaults, alongside the unchanged `createStyleRule` for the no-default case. See Internal Structure's Architecture Decisions for the exact relationship to preserve (both dedupe by suffix and register for render-time materialisation; only which one also dedupes at the class tier differs).

7. **`packages/lib/tests/core/ClassStateRules.test.ts`** (created by the dependency plan) — append the five new cases from Expected Behaviour, reusing the file's existing `declarationsDuring` / `idSelector` / `_ruleCacheHas` helpers and its uniquely-named-local-`Probe`-per-test convention. Do not create a new test file.

8. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`. The dependency plans' own `Button.pressedHoverClassHoisting.test.ts`, `ToggleButton.selectedClassHoisting.test.ts`, `TabButton.stateClassHoisting.test.ts`, and `Button.restingChromeIsolation.test.ts` must pass unmodified — they are this refactor's regression check. If the same pre-existing leak-diff ordering issue the first dependency plan's own step 12 anticipates recurs, apply the same fix (a throwaway warm-up construct+dispose before the `before` snapshot); never widen the hoist list or skip the assertion.

9. **Run the full verification list** in Verification.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/ToggleButton.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/tests/core/ClassStateRules.test.ts` |

---

## Expected Behaviour

`declarationsDuring(sink, selector, fn)` / `idSelector(component)` / `_ruleCacheHas` are the existing helpers already present in `tests/core/ClassStateRules.test.ts` (created by the dependency plan), copied there from `tests/core/ClassStyleRules.test.ts`. Cases 1-5 cover only what's new — the class-collision and disposal semantics of the underlying `ensureClassStateRule` are unchanged and already covered by that file's own cases; they are not retested here. Case 6 covers the forced-write hazard from Architecture Decisions and is verified by re-running an existing test unmodified, not by writing a new one.

| # | Case | Expected | How |
|---|---|---|---|
| 1 | **`createStateStyleRule` wires `resolveDefaults` into the class bag automatically.** A local `class Probe extends Component` whose constructor calls `this.createStateStyleRule(".on", () => ({ color: "red" })).set("color", "red")` unconditionally. Render two `Probe`s. | The second instance's `#id.on` rule captures no `color` — `declarationsDuring(sink, idSelector(second) + '.on', () => second.getElement(true))` is `{}`. `_ruleCacheHas('.Probe.on')` is `true`. | unit |
| 2 | **A deviating `.set()` call still writes the instance rule.** A third `Probe` (same setup) additionally calls `.set("color", "blue")`. | The captured declarations for that instance's `#id.on` contain `color: "blue"`. | unit |
| 3 | **`.setMany()` writes only the keys that deviate.** A `Probe` whose class bag (from `resolveDefaults`) is `{ color: "red" }`, calling `.setMany({ color: "red", backgroundColor: "blue" })`. | Captured declarations for `#id.on` contain `backgroundColor: "blue"` but not `color`. | unit |
| 4 | **`createStateStyleRule` shares the same underlying rule `createStyleRule` would return, not a second one.** A `Probe` whose constructor calls both `this.createStyleRule(".on")` and `this.createStateStyleRule(".on", () => ({}))`. Render it. | Exactly one `#id.on` rule materialises — one `ensureStyleRule` op for that selector, not two. | unit |
| 5 | **Two suffixes on one class produce two independent class rules.** A `Probe` whose constructor calls `createStateStyleRule(".on", () => ({ color: "red" }))` and `createStateStyleRule(".off", () => ({ color: "blue" }))`. Render two instances. | `.Probe.on` and `.Probe.off` are both cached (`_ruleCacheHas` true for each); the second instance's `#id.on` carries no `color` and its `#id.off` carries no `color` either — each suffix dedupes against its own class bag only. | unit |
| 6 | **`_restoreChrome`'s forced writes stay unconditional after the refactor.** `setChromeless(true)` then `setChromeless(false)` on a `Button`, so `_restoreChrome` runs while the instance's own `#id.pressed` rule still holds a stale pin, and `setFlat(true)` then `setFlat(false)`, so `_restoreChrome` restores `backgroundColor` / `backgroundImage` / `boxShadow` / `color` at values that match the shared class bag. | Every restored value reaches the instance's `#id.pressed` rule for real — none are silently skipped because they happen to match the class bag. | unit — already exercised by the dependency plans' `Button.pressedHoverClassHoisting.test.ts` (the `setChromeless` case, `color` only) and `Button.restingChromeIsolation.test.ts` (the `setFlat` case, all four keys); re-run both unmodified as this refactor's regression check for this case. |
| 7 | **Visual parity.** The demo app's Button, ToggleButton, and Tab showcases render identically to how they rendered once the dependency plans alone had landed — resting, hover, pressed, and selected chrome for default-styled and explicitly-customized instances alike. | No visible change anywhere; this plan changes wiring only. | manual |

---

## Verification

From `packages/lib`:

1. `npx vitest run --no-file-parallelism` — all cases pass, including the dependency plans' `Button.pressedHoverClassHoisting.test.ts` / `ToggleButton.selectedClassHoisting.test.ts` / `TabButton.stateClassHoisting.test.ts` / `Button.restingChromeIsolation.test.ts` unmodified. `Errors: 0`, exit code `0`.
2. `npm run typecheck` — clean.
3. `npm run typecheck:test`.
4. `npm run lint` — clean.
5. `npm run docs:api` — zero warnings (every new/changed member is `protected`/`private`/internal-module).
6. `grep -n 'writeClassStateDeclaration(this\.\|writeManyClassStateDeclarations(this\.' packages/lib/src/typescript/lib/component/button/Button.ts packages/lib/src/typescript/lib/component/button/ToggleButton.ts` — zero matches.
7. `grep -c 'pressedClassBag\|hoverClassBag' packages/lib/src/typescript/lib/component/button/Button.ts` — zero.
8. `grep -c 'selectedClassBag' packages/lib/src/typescript/lib/component/button/ToggleButton.ts` — zero.
9. `git status --porcelain packages/lib/src/typescript/lib/component/button/TabButton.ts` — empty output (no working-tree changes to this file from this plan's steps).
10. `grep -n '\.pressedStyleRule\.set(\|\.pressedStyleRule\.setMany(' packages/lib/src/typescript/lib/component/button/Button.ts` — every match is inside a `set*`/`clear*` pressed method; none inside `_restoreChrome` or `pinPressedToResting`. Read those two methods directly and confirm they instead call `this.createStyleRule(".pressed").set(...)` / `.setMany(...)` — the forced-write fix from Architecture Decisions.
11. Manual, browser (`npm run dev`, http://localhost:8015): same screens as the dependency plans' own manual checks — a Button demo (resting/hover/pressed for a default and a `pressedBackgroundColor`-customized instance), a ToggleButton demo (selected on/off), a Tab demo (hover, select, close-✕ hover). Confirm `.Button.pressed`, `.Button:hover:not(.pressed)`, `.ToggleButton.selected:not(:hover)`, `.TabButton.pressed`, `.TabButton:hover:not(.pressed)`, `.TabButton.selected:not(:hover)` still exist in `<style id="Base">` and still render identically to before this plan.

---

## Documentation Impact

None. Every new, changed, or removed member is `protected` or `private`; `core/ClassStyleRules.ts` stays out of `core/index.ts`. No doc page, catalog entry, or sidebar entry changes.

---

## Potential Challenges

- **A caller that doesn't cache `createStateStyleRule`'s return value behind a private `??=` getter re-runs `resolveDefaults()` on every call.** Not a correctness bug — `ensureClassStateRule`'s own cache means only the first call's result is ever used for the class rule — but it wastes the resolver's cost repeatedly. Mitigation is the documented idiom (Internal Structure), matching the base tier's own acceptance of this cost (`getClassStyleDefaults()` runs on every `applyStyle` regardless of cache state).
- **The mechanical setter rewrite touches twenty-eight call sites** — `Button.ts`'s twelve setter/clearer pairs (six for `.pressed`, six for `:hover:not(.pressed)`, twenty-four methods) plus `ToggleButton.ts`'s four `.selected` setters — **with an identical, easy-to-get-subtly-wrong transformation** (dropping the `bag` argument and moving the method call onto the rule). The two `grep` checks in Ordered Implementation Steps 3-4 catch a missed site; the unmodified dependency-plan test files catch a wrong one.
- **A handful of call sites are not setter/clearer pairs and must be excluded from the mechanical rewrite, not just found by it.** `_restoreChrome` and `pinPressedToResting` already call `.set()` directly on `pressedStyleRule` today, deliberately bypassing the class-bag comparison. Applying the same twenty-eight-site transformation to them would be a no-op syntactically (they already read `.set(...)`) while silently changing what that call does, once `pressedStyleRule` returns a `StateStyleRule`. This is why Ordered Implementation Steps 3 requires enumerating these sites *before* the rewrite, not relying on the same grep that catches the ordinary sites.
- **`ClassStateRules.test.ts`'s per-test uniquely-named-local-class convention must be followed for the five new cases** (Expected Behaviour), or a new `Probe` collides with a class name an earlier case in that file already registered, silently taking the name-collision opt-out branch instead of the path the case means to test.

---

## Critical Files

- [plans/hoist-button-tabbar-state-chrome-rules.md](hoist-button-tabbar-state-chrome-rules.md) — the first dependency; its Internal Structure section is this plan's "before" state for `Button.ts` / `ToggleButton.ts` / `TabButton.ts` and for `ensureClassStateRule` / `writeClassStateDeclaration` / `writeManyClassStateDeclarations`. Its `## Implementation Notes` records the base-`#id`-rule specificity conflict that motivates the safety invariant in Architecture Decisions and why `getPressedClassDeclarations()` originally narrowed to `pressedForegroundColor` alone.
- [plans/button-resting-chrome-state-isolation.md](button-resting-chrome-state-isolation.md) — the second dependency; widens `getPressedClassDeclarations()` back to four properties and adds the `_restoreChrome` / `pinPressedToResting` forced-write call sites this plan's Ordered Implementation Steps 3 must reroute. Read its Internal Structure for their exact shape.
- [packages/lib/src/typescript/lib/core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) — `ensureClassStyleRule` (196) and (once the dependency lands) `ensureClassStateRule` / `writeClassStateDeclaration` / `writeManyClassStateDeclarations` — the functions `StateStyleRule` wraps.
- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — `createStyleRule` (1009), `writeRuleDeclaration` (4720), `getClassStyleDefaults` (4736), `applyStyle` (4757) — the base-tier precedent this plan's design decisions cite, and the existing per-instance builder `createStateStyleRule` wraps unchanged.
- [packages/lib/src/typescript/lib/core/StyleTarget.ts](packages/lib/src/typescript/lib/core/StyleTarget.ts) — `StyleTarget.set` / `setMany` (35-50) — the semantics `StateStyleRule.set` / `setMany` delegate through, via `writeClassStateDeclaration`.
- [packages/lib/tests/core/ClassStyleRules.test.ts](packages/lib/tests/core/ClassStyleRules.test.ts) — the test-harness conventions (`declarationsDuring`, `idSelector`, uniquely-named local subclasses, `_ruleCacheHas`) the new cases in `ClassStateRules.test.ts` follow.
- `packages/lib/tests/core/ClassStateRules.test.ts` (created by the dependency plan) — the file this plan's five new cases are appended to.
- `packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts` (created by the first dependency, extended by the second) — its `setChromeless` round-trip case is this plan's regression check for `_restoreChrome`'s original `color` forced write (Expected Behaviour case 6); read it before Ordered Implementation Steps 3 rather than writing a new test.
- `packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts` (created by the second dependency) — its `setFlat` round-trip case is this plan's regression check for `_restoreChrome`'s three widened forced writes (Expected Behaviour case 6); read it alongside the file above.
- [packages/lib/src/typescript/lib/component/button/Button.ts](packages/lib/src/typescript/lib/component/button/Button.ts) and [ToggleButton.ts](packages/lib/src/typescript/lib/component/button/ToggleButton.ts) — read both dependency plans' Internal Structure for their exact post-dependency shape; this plan's line-number references (1009-1018, 24, 4720, 4736, 4757 in `Component.ts`) are only for `Component.ts`, which neither dependency modifies. `Button.ts` / `ToggleButton.ts` line numbers will differ once both dependencies land — locate `pressedStyleRule` / `hoverStyleRule` / `selectedStyleRule`, `_restoreChrome`, `pinPressedToResting`, and the pressed/hover/selected setters by name.

---

## Non-Goals

- **Converting any other `createStyleRule` caller** (`AccordionIndicator`, `CollapseButton`, `DiagramNode`, `WindowBorder`, `Header`, …) onto `createStateStyleRule`. Structurally the same opportunity, but out of scope — a future plan can reuse `createStateStyleRule` directly, the same way the dependency plan left `ensureClassStateRule` / `writeClassStateDeclaration` exported for reuse.
- **Deprecating or removing `Component.createStyleRule`.** It remains the correct primitive for a per-instance state rule with no class-level default to dedupe against.
- **Changing the signatures of `ensureClassStateRule`, `writeClassStateDeclaration`, or `writeManyClassStateDeclarations`.** This plan reuses them exactly as the dependency plan defines them.
- **Giving `createStateStyleRule` a resting-tier / mutual-exclusion mode.** See Architecture Decisions — that pattern stays manual and per-component.
- **Adding a forced-write / bypass-comparison method to `StateStyleRule`'s public surface** (e.g. a `setForced`). Unnecessary: `createStyleRule(suffix)`'s existing per-suffix cache already gives any call site that needs an unconditional write a way to reach the same underlying `StyleRule` without going through the wrapper.
- **Editing `plans/button-resting-chrome-state-isolation.md`.** Its `_restoreChrome` / `pinPressedToResting` call sites are written correctly against `Button.ts`'s current, pre-this-plan `pressedStyleRule` shape; adding it to `depends-on` is what keeps them correct, so no edit to that plan is needed.
- **`plans/suppress-empty-style-rules.md`.** Unrelated empty-CSS-rule fix; only relevant here as the reason `ARCHITECTURE.md` is listed under `touches-shared`.
- **Bumping the package version.** Recorded for release time, not this plan.

---

## Notes

[^no-render-pass]: Unlike the base `#id` rule, which is fully re-derived from getters on every `applyStyle` call (so a stale imperative write is never observed — see `Component.ts`'s `applyBoxAndVisibilityStyles` and siblings), a state rule's declarations are whatever the setter last wrote, from whichever call site last ran. There is no single pass that re-derives all of them together, so there is nowhere to cache "what this render already delivers" the way `_inheritedStyleBag` does for the base tier. This is the dependency plan's own stated reason for `writeClassStateDeclaration`'s explicit-parameter shape (its Internal Structure section, on `writeClassStateDeclaration`), carried over unchanged into why `StateStyleRule` binds the rule and bag to the object instead.

[^tabbutton-untouched]: `TabButton` inherits `Button`'s `pressedStyleRule` / `hoverStyleRule` getters and `ToggleButton`'s `selectedStyleRule` getter; it only overrides `getHoverClassDeclarations()` and `getSelectedClassDeclarations()`, which those getters call polymorphically through `this`. Rewriting the getters in `Button.ts` / `ToggleButton.ts` to route through `createStateStyleRule` doesn't change which method gets called on a `TabButton` instance — `this.getHoverClassDeclarations()` still resolves to `TabButton`'s override at runtime regardless of which class's getter contains that call. This is the same virtual-dispatch guarantee the dependency plan already relied on for its own hand-rolled getters; this plan doesn't introduce a new dependency on it, just carries it forward.

[^invariant-grounding]: The safety invariant above rests on two precedents. First, `hoist-button-tabbar-state-chrome-rules`'s own audit (its `## Implementation Notes`) found `backgroundColor` / `backgroundImage` / `boxShadow` unsafe to dedupe at Button's `.pressed` tier, because Button's resting chrome wrote them unconditionally onto the bare `#id` rule `(1,0,0)`, which always outranks `.Button.pressed` `(0,2,0)` regardless of state — the fix was to narrow `getPressedClassDeclarations()` down to `pressedForegroundColor`, the one property whose resting write was *already* comparison-gated: `foregroundColor` is hoisted onto the class tier by the pre-existing base-tier `ClassStyleDefaults` mechanism, so nothing on `#id` competed for `color` at all. Second, `button-resting-chrome-state-isolation.md` restores the invariant for the three narrowed-out properties not by adding a value comparison, but by removing the competition entirely: it moves Button's resting `background-color` / `background-image` / `box-shadow` off the bare `#id` rule onto a `#id:not(.pressed)` rule, which structurally cannot match the same element `.pressed` matches — so the two rules are never simultaneously in the cascade and there is nothing left to compare. Either mechanism — an explicit value comparison, or a selector that makes two tiers mutually exclusive — satisfies the invariant; a bare, ungated write on a higher-specificity selector satisfies neither.

[^resting-tier-manual]: `button-resting-chrome-state-isolation.md`'s own `## Non-Goals` rejects deduping the resting tier onto a shared class rule: a component's `clear*()` setters remove a property by writing `null` to the instance rule, and once a class-tier resting rule exists, that removal lets the class rule's value show through instead of truly clearing — fixing that needs a per-property neutral-value convention across every `Component` clear setter, a `Component`-wide change that plan explicitly scopes out. `createStateStyleRule` always builds both an instance rule and a class-tier dedup rule together (Architecture Decisions, `Component.createStateStyleRule` is a new sibling of `createStyleRule`); there is no way to ask it for the instance-only half without either introducing the class-tier rule the resting tier must not have, or adding a second code path that defeats the point of one primitive with one contract. Which base-tier properties need isolating is also component-specific — Button's set is `background` / `backgroundColor` / `backgroundImage` / `boxShadow`, derived by inspecting what that component's resting chrome writes unconditionally, not from a formula a shared primitive could apply generically. `button-resting-chrome-state-isolation.md`'s own solution is a per-component `RESTING_ISOLATED_KEYS` set plus overrides of `writeRuleDeclaration` / `setElementCSSRule`, built directly in `Button.ts`, not in `ClassStyleRules.ts`, `StyleTarget.ts`, or `Component.ts`.

[^forced-write-hazard]: Confirmed by reading the current, already-implemented `Button.ts` on this branch: exactly one call site does this today — `_restoreChrome`'s `this.pressedStyleRule.set("color", d.pressedForegroundColor)` at [Button.ts:1929](packages/lib/src/typescript/lib/component/button/Button.ts#L1929) (`grep -n '\.pressedStyleRule\.set(\|\.hoverStyleRule\.set(\|\.pressedStyleRule\.setMany(\|\.hoverStyleRule\.setMany(' packages/lib/src/typescript/lib/component/button/Button.ts` returns exactly this one line before this plan runs). `button-resting-chrome-state-isolation.md`'s `## Internal Structure` widens `_restoreChrome` to force `backgroundColor` / `backgroundImage` / `boxShadow` the same way, and adds `pinPressedToResting()`, which loops over the pressed class bag's keys calling `this.pressedStyleRule.set(key, resting[key])` for the same reason — "outrank the class rule even when the two values coincide," per that plan's own comment. Neither call site is a `writeClassStateDeclaration(this...)` call, so neither would be touched by this plan's own mechanical transformation or caught by its original regression grep, which only searched for `writeClassStateDeclaration(this.` / `writeManyClassStateDeclarations(this.` — a pattern these sites never matched, before or after.

[^ordering-not-symmetric]: The dependency is one-directional because only one of the two plans can be edited here. `button-resting-chrome-state-isolation.md` is drafted and read as fixed content for this amendment — its Internal Structure literally writes `this.pressedStyleRule.set(...)` in `pinPressedToResting()` and in `_restoreChrome`'s widened block, correct only when `pressedStyleRule` is still the plain `StyleRule` it is today. If this plan's `createStateStyleRule` refactor landed first, that text would need to say `this.createStyleRule(".pressed").set(...)` instead — but this plan cannot rewrite another plan's file. Requiring `button-resting-chrome-state-isolation` to land first, and having this plan's own Ordered Implementation Steps enumerate and reroute the resulting forced-write call sites (Architecture Decisions, "Forced writes on `pressedStyleRule`..."), keeps both plans correct as written.
