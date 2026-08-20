---
depends-on: [class-hierarchy-cascade]
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Button-Family Hierarchy Cascade — Implementation Plan

## Overview

[`class-hierarchy-cascade.md`](class-hierarchy-cascade.md) makes the class-tier CSS mechanism hierarchy-aware — a subclass's `.ClassName` rule becomes a delta against its immediate parent's rule, and the rendered element carries every ancestor's class name — and rolls it out to every hierarchy the codebase survey found *except* `Button → ToggleButton → TabButton`/`SpinButton`. That chain is the single largest opportunity in the survey (`Button`'s own `_defaultButtonOptions` bag is the widest hoistable set in the library — `backgroundColor`, `backgroundImage`, `border`, `cursor`, `foregroundColor`, `shadow` — inherited untouched by eight direct subclasses), and it was deliberately deferred: it is the one hierarchy in the codebase where the class tier and the *state* tier (`.pressed`, `.selected`) both exist for the same classes, and widening the DOM class list without also making the state tier hierarchy-aware creates a real correctness hazard, not just a missed saving.

**The hazard, concretely.** [`ensureClassStateRule`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L289) keys its cache by the *concrete* constructor, exactly like the (pre-hierarchy) resting tier did. Today a `TabButton` element carries only the `TabButton` class, so `.Button.pressed` (created the first time any plain `Button` renders, if one ever does) never matches it. The moment `class-hierarchy-cascade.md`'s DOM widening is applied to this chain, a `TabButton` element would carry `Button`, `ToggleButton`, and `TabButton` all at once — and `.Button.pressed`, `.ToggleButton.selected:not(:hover)`, and any `TabButton`-specific override would all independently match the same element, each an unrelated, full-content rule at equal specificity `(0,2,0)`, with the winner decided by whichever happened to be inserted into the stylesheet last — an accident of which concrete class rendered first in the running app, not a principled "more specific override wins" relationship.

| Order components happen to render in | `.Button.pressed`'s `backgroundColor` | `.TabButton`'s hypothetical own `.pressed` copy | Which one wins on a pressed `TabButton`, if both exist unrelated |
|---|---|---|---|
| A plain `Button` renders first, a `TabButton` renders later | inserted first | inserted second | `.TabButton`'s copy (last in source order) — accidentally correct |
| A `TabButton` renders first; a plain `Button` is constructed later elsewhere in the app | inserted second | inserted first | `.Button`'s generic token (last in source order) — **wrong**, a tab shows the plain-button pressed colour instead of its own |

This plan's fix makes `.TabButton.pressed` never exist at all when `TabButton` contributes nothing of its own (the common case today), so there is no second rule left to race — see `## Architecture Decisions`.

This plan closes that hazard by extending the *same* hierarchy-aware delta computation `class-hierarchy-cascade.md` built for the resting tier to the state tier, and only then widens the DOM class list and opts `Button` in.

---

## Architecture Decisions

### The state tier needs its own "own contribution, independent of an instance" source — and it isn't the same shape as the resting tier's

`class-hierarchy-cascade.md`'s `ownClassStyleDefaults` static field works because every field it carries maps directly onto a `ClassStyleDefaults` key. A state resolver like [`Button.getPressedClassDeclarations()`](packages/lib/src/typescript/lib/component/button/Button.ts#L609) is different in shape: it reads *prefixed* fields off `this._defaultOptions` (`pressedBackgroundColor` → `backgroundColor`, `pressedForegroundColor` → `color`, …) and is an **instance** method, resolved once per instance via `createStateStyleRule`'s eager `resolveDefaults()` call. Reusing it directly against an ancestor's own static bag needs the extraction logic separated from the instance read.

Each resolver splits into a `protected static` extraction function taking a plain options bag, plus a thin instance method that calls it with `this._defaultOptions` — unchanged in effect, since `this._defaultOptions` is still what a live instance reads:

```typescript
// component/button/Button.ts
protected static extractPressedClassDeclarations(defaults: Partial<ButtonOptions>): Record<string, string | null> {
    if (defaults.chromeless) {
        return {};
    }

    const out: Record<string, string | null> = {};
    if (defaults.pressedForegroundColor !== undefined) out.color           = defaults.pressedForegroundColor;
    if (defaults.pressedBackgroundColor !== undefined) out.backgroundColor = defaults.pressedBackgroundColor;
    if (defaults.pressedBackgroundImage !== undefined) out.backgroundImage = defaults.pressedBackgroundImage;
    if (defaults.pressedShadow          !== undefined) out.boxShadow       = defaults.pressedShadow;

    return out;
}

protected getPressedClassDeclarations(): Record<string, string | null> {
    return (this.constructor as typeof Button).extractPressedClassDeclarations(this._defaultOptions);
}
```

The static extraction function, called with `Button.ownClassStyleDefaults` (the same field `class-hierarchy-cascade.md` gives `Button`) instead of a live instance's `_defaultOptions`, is "Button's own pressed contribution, independent of any subclass" — the missing piece the resting tier's `resolveClassLevel` already has and the state tier needs an equivalent of.

### `resolveClassStateLevel` looks up *each level's own* extraction method by name — a single shared callback would misattribute a state to the wrong ancestor

A first version of this design passed one `extractOwn` callback into the recursive walk, reused at every level. That is wrong: `Button` has no concept of a "selected" state at all, but `extractSelectedClassDeclarations` (defined only on `ToggleButton`) barely reads its `defaults` argument — it mostly returns the fixed `TOGGLE_SELECTED_DECLARATIONS` constant regardless of input. Calling it against *Button's* own bag (`ownDefaultsOf(Button)`) during the walk would still return those three keys, wrongly crediting `.Button` with a `.selected` contribution `Button` never declares.

`resolveClassStateLevel(ctor, suffix, extractorMethodName)` takes the **name** of the static extraction method (e.g. `"extractPressedClassDeclarations"`, `"extractSelectedClassDeclarations"`) instead of a bound function, and at every level of the walk looks up *that level's own* method the same own-property-checked way `ownDefaultsOf` looks up `ownClassStyleDefaults`:

```typescript
const hasOwnExtractor = Object.prototype.hasOwnProperty.call(ctor, extractorMethodName);
const ownBag          = ownDefaultsOf(ctor);
const own             = (hasOwnExtractor && ownBag)
    ? (ctor as unknown as Record<string, (defaults: ClassStyleDefaults) => Record<string, string | null>>)[extractorMethodName](ownBag)
    : {};
```

`Button.hasOwnProperty("extractSelectedClassDeclarations")` is `false` (`Button` never declares that method), so `Button`'s own contribution for suffix `.selected:not(:hover)` is correctly `{}` — the walk only credits a level with a state's declarations when that exact class declared the matching extractor itself, mirroring `getPressedClassDeclarations()`/`getSelectedClassDeclarations()`'s own existing "only the classes that override it get their own answer" virtual-dispatch contract, just re-expressed as an own-property lookup instead of prototype-chain method resolution (for the same reason `ownDefaultsOf` needs the own-property form: plain method access would report the nearest ancestor's version, not "none").

The walk otherwise mirrors `resolveClassLevel` exactly: recurse into the parent first, merge this level's own contribution onto the parent's resolved state bag, diff, and create `.ClassName<suffix>` only when the diff is non-empty. Ancestor-first insertion order (the same guarantee `resolveClassLevel` provides) means `.ToggleButton.selected:not(:hover)` — the first level in the chain that actually declares anything for that suffix — is always inserted before `.TabButton.selected:not(:hover)`, closing the ordering hazard by construction rather than by convention.

Because `TabButton` today contributes nothing of its own to the pressed state (`getPressedClassDeclarations()` is inherited, unmodified, from `Button`), `resolveClassStateLevel(TabButton, ".pressed", extractPressedClassDeclarations)`'s diff against `Button`'s resolved pressed bag is empty — **no `.TabButton.pressed` rule is created at all**, and `TabButton` instances are served entirely by `.Button.pressed` once the DOM widening below applies. This is a real saving on top of closing the hazard: today, before this plan, `TabButton` would (if it ever independently triggered `ensureClassStateRule`) get its own full, redundant copy.

### `createStateStyleRule` gains one new optional parameter — the static extractor's name — so `ensureClassStateRule` knows what to look up per ancestor

[`Component.createStateStyleRule(selectorSuffix, resolveDefaults)`](packages/lib/src/typescript/lib/core/Component.ts#L1046) and [`StateStyleRule`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L386) both gain a third, optional parameter, `extractorMethodName?: string`, forwarded straight through to `ensureClassStateRule`. `resolveDefaults` itself is unchanged — still an instance-bound thunk (`() => this.getPressedClassDeclarations()`) called once, eagerly, to seed the non-hierarchy-aware fallback bag — but the hierarchy walk needs the *name* of the static extractor to look up at each ancestor level (per the previous decision), and `resolveDefaults` alone cannot supply that: it is a closure, not something `ensureClassStateRule` can introspect for a method name. Every existing call site that wants hierarchy-aware dedup adds this one argument:

```typescript
// Before:
this.createStateStyleRule(".pressed", () => this.getPressedClassDeclarations());

// After:
this.createStateStyleRule(".pressed", () => this.getPressedClassDeclarations(), "extractPressedClassDeclarations");
```

A caller that omits the third argument keeps today's exact flat, non-hierarchy-aware behaviour — `ensureClassStateRule` falls back to its existing per-`(ctor, suffix)` cache when no extractor name is supplied, so every `createStateStyleRule` call anywhere else in the library (any future one this plan doesn't touch) needs no change at all.

### `ToggleButton`'s `.selected:not(:hover)` and `TabButton`'s override follow the identical split

`ToggleButton.getSelectedClassDeclarations()` ([`ToggleButton.ts:55`](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L55)) reads the module constant `TOGGLE_SELECTED_DECLARATIONS` directly (not `this._defaultOptions` — these fields were never threaded through the options bag, per that method's own doc comment) plus a `this._defaultOptions.chromeless` guard. Its static extraction form takes the same `Partial<ButtonOptions>`-shaped `defaults` parameter (for the `chromeless` check) and otherwise ignores it, always returning the same three keys from the constant:

```typescript
protected static extractSelectedClassDeclarations(defaults: Partial<ButtonOptions>): Record<string, string | null> {
    if (defaults.chromeless) {
        return {};
    }
    return { boxShadow: TOGGLE_SELECTED_DECLARATIONS.boxShadow!, backgroundColor: TOGGLE_SELECTED_DECLARATIONS.backgroundColor!, backgroundImage: TOGGLE_SELECTED_DECLARATIONS.backgroundImage! };
}
```

`TabButton.getSelectedClassDeclarations()` ([`TabButton.ts:266`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L266)) reads `TAB_BUTTON_SELECTED_FILL`, an unconditional module constant with no `this._defaultOptions` dependency at all — its static extraction form ignores its `defaults` parameter entirely and always returns the same three keys. Because every key in `TAB_BUTTON_SELECTED_FILL` differs from `TOGGLE_SELECTED_DECLARATIONS`, the diff at `TabButton`'s level is non-empty for all three keys — `.TabButton.selected:not(:hover)` continues to exist and carry `backgroundColor`/`backgroundImage`/`boxShadow`, same as it effectively does today, just now correctly positioned *after* `.ToggleButton.selected:not(:hover)` in the stylesheet by construction rather than by accident of which class happens to render first.

### `getRestingExclusionSuffixes()`'s existing chaining already produces the right isolation suffixes for this chain — untouched

[`Button.getRestingExclusionSuffixes()`](packages/lib/src/typescript/lib/component/button/Button.ts#L570) returns `[".pressed"]`; [`ToggleButton`](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L73) returns `[...super.getRestingExclusionSuffixes(), ".selected"]`. `TabButton` inherits `[".pressed", ".selected"]` with no override of its own. Nothing about this plan changes that mechanism — a deviating *instance's* resting `backgroundColor`/`backgroundImage`/`boxShadow` already lands on `#id:not(.pressed):not(.selected)`, specificity `(1,2,0)`, which already outranks *any* number of plain ancestor classes chained (per `class-hierarchy-cascade.md`'s own reasoning) and any state-tier rule up to two chained classes at equal-or-lower specificity. The only new risk this plan addresses is the *class*-tier collision between two independently-created state rules for the same suffix, not the instance-vs-class relationship, which `button-resting-chrome-state-isolation`/`state-chrome-isolation-generalization` already solved correctly and generally.

### `Button` opts into the resting tier the same way `class-hierarchy-cascade.md`'s other eight classes do

`Button` gains `protected static readonly ownClassStyleDefaults: ClassStyleDefaults = _defaultButtonOptions;`, exactly matching that plan's pattern (`## Internal Structure`'s opt-in table). `ToggleButton` and `SpinButton`/`MenuButton`/`PopupButton`/`PickerButton`/`RailHandle` contribute nothing new to the *resting* tier (survey-confirmed: none declares its own hoistable `ClassStyleDefaults` field beyond what `Button` already sets), so none needs the field. `TabButton` does — its own `_defaultTabButtonOptions` sets `backgroundColor`/`backgroundImage`/`border`/`shadow` to the tab-specific (unselected) look, genuinely different from `Button`'s. `SpinButton`'s own `_defaultSpinButtonOptions` sets `border` (survey-confirmed) and also opts in.

### Only the DOM widening for *this* chain is new; the mechanism itself is not duplicated

`getStyleClassChain` (built by `class-hierarchy-cascade.md`) already walks any constructor's ancestor chain generically — nothing about it is Button-specific. This plan's only DOM-widening work is removing whatever exclusion `class-hierarchy-cascade.md` used to keep this chain out of scope (that plan's own text frames the exclusion as "deliberately excluded... left to `button-family-hierarchy-cascade.md`," which in practice means: `class-hierarchy-cascade.md` does not special-case any chain by name — it only widens `init()`'s call site once, unconditionally, for every component — so this plan's real dependency is that `class-hierarchy-cascade.md`'s `init()` change and `getStyleClassChain` must already exist; there is no separate flag to flip for this chain specifically, only the state-tier fix that makes it *safe* for this chain to receive the same unconditional widening).

---

## Public API

Every new/changed member is `protected` or `private`; `excludeProtected: true` keeps all of it out of generated docs.

```typescript
// core/Component.ts — one new optional parameter.
protected createStateStyleRule(
    selectorSuffix: string,
    resolveDefaults: () => Record<string, string | null>,
    extractorMethodName?: string,
): StateStyleRule;
```

```typescript
// core/ClassStyleRules.ts — StateStyleRule's constructor, one new optional parameter forwarded to ensureClassStateRule.
export class StateStyleRule {
    constructor(
        ctor: Function,
        suffix: string,
        rule: StyleRule,
        resolveDefaults: () => Record<string, string | null>,
        hasElement: () => boolean,
        extractorMethodName?: string,
    );
    // classBag, set(), setMany(): unchanged.
}
```

```typescript
// component/button/Button.ts
protected static extractPressedClassDeclarations(defaults: Partial<ButtonOptions>): Record<string, string | null>;
protected static extractHoverClassDeclarations(defaults: Partial<ButtonOptions>):   Record<string, string | null>;
protected static readonly ownClassStyleDefaults: ClassStyleDefaults; // = _defaultButtonOptions

// pressedStyleRule / hoverStyleRule getters: same shape, each createStateStyleRule call gains the matching extractor name.
// getPressedClassDeclarations() / getHoverClassDeclarations(): unchanged signatures, bodies now delegate to the static functions above.
```

```typescript
// component/button/ToggleButton.ts
protected static extractSelectedClassDeclarations(defaults: Partial<ButtonOptions>): Record<string, string | null>;
// selectedStyleRule getter: same shape, createStateStyleRule call gains "extractSelectedClassDeclarations".
// getSelectedClassDeclarations(): unchanged signature, body now delegates.
```

```typescript
// component/button/TabButton.ts
protected static override extractSelectedClassDeclarations(defaults: Partial<ButtonOptions>): Record<string, string | null>;
protected static readonly ownClassStyleDefaults: ClassStyleDefaults; // = _defaultTabButtonOptions
// getSelectedClassDeclarations(): unchanged signature.
```

```typescript
// component/input/SpinButton.ts
protected static readonly ownClassStyleDefaults: ClassStyleDefaults; // = _defaultSpinButtonOptions
```

```typescript
// core/ClassStyleRules.ts — new internal function, not exported beyond the module (mirrors resolveClassLevel's visibility).
function resolveClassStateLevel(
    ctor: Function,
    suffix: string,
    extractorMethodName: string,
): ResolvedClassStateLevel;
```

No consumer-facing signature changes anywhere.

---

## Internal Structure

### `core/ClassStyleRules.ts` — `resolveClassStateLevel`

Placed beside `resolveClassLevel` (added by `class-hierarchy-cascade.md`), reusing its `_owners` collision registry and mirroring its shape exactly, parameterised on `suffix` and an extraction callback instead of reading a fixed `ownClassStyleDefaults` field directly:

```typescript
interface ResolvedClassStateLevel {
    resolved: ClassStyleBag;
}

type StaticExtractor = (defaults: ClassStyleDefaults) => Record<string, string | null>;

const _stateLevels: Map<Function, Map<string, ResolvedClassStateLevel>> = new Map();

function resolveClassStateLevel(
    ctor: Function,
    suffix: string,
    extractorMethodName: string,
): ResolvedClassStateLevel {
    let bySuffix = _stateLevels.get(ctor);
    if (!bySuffix) {
        bySuffix = new Map();
        _stateLevels.set(ctor, bySuffix);
    }

    const cached = bySuffix.get(suffix);
    if (cached) {
        return cached;
    }

    const parentCtor = Object.getPrototypeOf(ctor) as Function | null;
    const parent = (typeof parentCtor === "function" && parentCtor.name)
        ? resolveClassStateLevel(parentCtor, suffix, extractorMethodName)
        : { resolved: Object.freeze({}) as ClassStyleBag };

    // Own-property checked, exactly like `ownDefaultsOf` — a level that
    // doesn't declare `extractorMethodName` itself contributes nothing for
    // this suffix, regardless of what an ancestor or a same-named method
    // inherited from further up the static prototype chain would answer.
    const hasOwnExtractor = Object.prototype.hasOwnProperty.call(ctor, extractorMethodName);
    const ownBag          = ownDefaultsOf(ctor);
    const own: Record<string, string | null> = (hasOwnExtractor && ownBag)
        ? (ctor as unknown as Record<string, StaticExtractor>)[extractorMethodName](ownBag)
        : {};

    const name  = ctor.name;
    const owner = _owners.get(name);
    if (!name || (owner !== undefined && owner !== ctor) || Object.keys(own).length === 0) {
        const level = { resolved: parent.resolved };
        bySuffix.set(suffix, level);
        return level;
    }

    const resolved   = { ...parent.resolved, ...own };
    const deviations = deviationsFrom(resolved, parent.resolved);

    _owners.set(name, ctor);
    if (Object.keys(deviations).length > 0) {
        new StyleRule({ scope: "class", name, suffix, styles: deviations });
    }

    const level = Object.freeze({ resolved: Object.freeze(resolved) });
    bySuffix.set(suffix, level);
    return level;
}
```

`ensureClassStateRule`'s exported body changes to delegate to `resolveClassStateLevel(ctor, suffix, extractorMethodName)` when a caller supplies a method name and `ctor` participates in the hierarchy walk, falling back to today's flat per-`(ctor, suffix)` behaviour otherwise. This changes `ensureClassStateRule`'s own signature (it needs the extractor method name as a new parameter, alongside the resolved `declarations` bag today's callers already pass for the non-participating fallback) — the exact final signature and fallback path are a sketch, not a final body: **`/implement` must derive and verify the precise wiring against `## Expected Behaviour`**, for the same reason `class-hierarchy-cascade.md`'s equivalent caveat gives — no mechanical precedent exists yet for this exact merge.

### `component/button/Button.ts`, `ToggleButton.ts`, `TabButton.ts`, `SpinButton.ts` — the opt-ins and resolver splits

Per `## Architecture Decisions`, each resolver method (`Button.getPressedClassDeclarations`/`getHoverClassDeclarations`, `ToggleButton.getSelectedClassDeclarations`, `TabButton.getSelectedClassDeclarations`) splits into a `protected static` extraction function plus an unchanged-signature instance method delegating to it with `this._defaultOptions`. `Button`, `TabButton`, and `SpinButton` each add `protected static readonly ownClassStyleDefaults: ClassStyleDefaults`, per `class-hierarchy-cascade.md`'s established shape. `Button.pressedStyleRule`/`hoverStyleRule` and `ToggleButton.selectedStyleRule`'s lazy getters each add the matching extractor method name as `createStateStyleRule`'s third argument:

```typescript
// component/button/Button.ts, before → after (hoverStyleRule follows identically with "extractHoverClassDeclarations"):
private get pressedStyleRule(): StateStyleRule {
    return this._pressedStyleRule ??= this.createStateStyleRule(".pressed", () => this.getPressedClassDeclarations());               // before
    return this._pressedStyleRule ??= this.createStateStyleRule(".pressed", () => this.getPressedClassDeclarations(), "extractPressedClassDeclarations"); // after
}
```

```typescript
// component/button/ToggleButton.ts, before → after:
private get selectedStyleRule(): StateStyleRule {
    return this._selectedStyleRule ??= this.createStateStyleRule(".selected:not(:hover)", () => this.getSelectedClassDeclarations());               // before
    return this._selectedStyleRule ??= this.createStateStyleRule(".selected:not(:hover)", () => this.getSelectedClassDeclarations(), "extractSelectedClassDeclarations"); // after
}
```

`TabButton` has no `pressedStyleRule`/`hoverStyleRule`/`selectedStyleRule` getter of its own — it inherits `Button`'s and `ToggleButton`'s unchanged, so its own static `extractSelectedClassDeclarations` override is picked up automatically the moment `ensureClassStateRule` walks `TabButton`'s own-property chain; no getter in `TabButton.ts` needs editing.

---

## Ordered Implementation Steps

1. **Confirm `class-hierarchy-cascade.md` has landed.** `grep -n 'resolveClassLevel\|getStyleClassChain\|ownDefaultsOf' packages/lib/src/typescript/lib/core/ClassStyleRules.ts` — all three must exist. Do not proceed otherwise.

2. **Write the mechanism tests first.** Create `packages/lib/tests/core/ClassStateHierarchyCascade.test.ts` covering `## Expected Behaviour` rows 1-7, using a synthetic multi-level `Component` chain with `createStateStyleRule` calls (mirroring `tests/core/ClassStateRules.test.ts`'s `ProbeState<N>` naming and helper conventions), not the real `Button` family, so the generic mechanism is proven independent of Button-specific plumbing.
   *Check:* `npx vitest run tests/core/ClassStateHierarchyCascade.test.ts` — every case fails for the expected reason.

3. **`core/ClassStyleRules.ts` — add `resolveClassStateLevel`, `_stateLevels`.** Per `## Internal Structure`.
   *Check:* `npm run typecheck`.

4. **`core/ClassStyleRules.ts` — rewrite `ensureClassStateRule` to accept the optional extractor method name and delegate to `resolveClassStateLevel` when the constructor participates.** **`core/Component.ts` — add the matching optional third parameter to `createStateStyleRule` and forward it into `StateStyleRule`'s constructor** (per `## Public API`), which forwards it into its own `ensureClassStateRule` call. Neither `createStateStyleRule` nor `StateStyleRule` gains any other change.
   *Check:* `npm run typecheck`; `npx vitest run tests/core/ClassStateHierarchyCascade.test.ts` — green; `npx vitest run tests/core/ClassStateRules.test.ts` — still green, unmodified (no probe in that file passes a third argument, so every case falls back to today's exact behaviour).

5. **`component/button/Button.ts` — split `getPressedClassDeclarations`/`getHoverClassDeclarations`, add `ownClassStyleDefaults`, and add the third argument to `pressedStyleRule`/`hoverStyleRule`'s `createStateStyleRule` calls.** Per `## Internal Structure`. Do not change either resolver method's public signature, or any *other* call site.
   *Check:* `npm run typecheck`; `npx vitest run tests/component/button/Button.pressedHoverClassHoisting.test.ts tests/component/button/Button.restingChromeIsolation.test.ts` — unmodified, still green (proves the split preserves per-instance behaviour).

6. **`component/button/ToggleButton.ts` — split `getSelectedClassDeclarations`, add the third argument to `selectedStyleRule`'s `createStateStyleRule` call.** Same shape as step 5.
   *Check:* `npm run typecheck`; `npx vitest run tests/component/button/ToggleButton.selectedClassHoisting.test.ts` — unmodified, still green.

7. **`component/button/TabButton.ts` — split `getSelectedClassDeclarations`, add `ownClassStyleDefaults`.** No `createStateStyleRule` call in this file to update — `TabButton` inherits `ToggleButton`'s `selectedStyleRule` getter unchanged; only the static override matters here.
   *Check:* `npm run typecheck`; `npx vitest run tests/component/button/TabButton.stateClassHoisting.test.ts` — unmodified, still green.

8. **`component/input/SpinButton.ts` — add `ownClassStyleDefaults`.**
   *Check:* `npm run typecheck`; `npx vitest run tests/component/input/SpinButton.test.ts` — unmodified, still green.

9. **Confirm the DOM widening from `class-hierarchy-cascade.md` already applies to this chain unconditionally** (no per-chain flag exists to flip — see `## Architecture Decisions`). `grep -n 'getStyleClassChain' packages/lib/src/typescript/lib/core/Component.ts` — the `init()` call site already includes every constructor, this chain included.

10. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`. Any test asserting on a `.Button.pressed`/`.ToggleButton.selected:not(:hover)`/`.TabButton.*` rule's exact content, or on `_ruleCacheHas` for one of those selectors, may need updating the same way `class-hierarchy-cascade.md`'s own step 7 describes — in particular, confirm `Button.pressedHoverClassHoisting.test.ts`'s and `TabButton.stateClassHoisting.test.ts`'s "the class rule exists" assertions still pass now that a `TabButton`'s `.pressed` state may be served entirely by `.Button.pressed` with no `.TabButton.pressed` rule inserted at all.

11. **Add the changelog entry.** See `## Documentation Impact`.

12. **Run the full verification list.** See `## Verification`.

13. **Verify live in a browser.** Non-negotiable — see `## Verification`. Every plan in this mechanism's lineage has shipped at least one regression the offline harness missed, and this plan is the one place two independently-evolved mechanisms (class hierarchy, state tier) are combined for the first time.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/core/ClassStateHierarchyCascade.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/ToggleButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/SpinButton.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-7 are unit-testable against a synthetic multi-level chain with state rules. Rows 8-11 are the Button-family migration outcomes, unit-testable in existing test files. Rows 12-14 need a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | `ProbeBase`/`ProbeMid`/`ProbeLeaf` chain (all `Component` subclasses, all registering `ownClassStyleDefaults`); only `ProbeBase` declares its own static `extractOn(defaults)` method, returning a non-empty bag for suffix `.on` | `.ProbeBase.on` is created; a rendered `ProbeLeaf` (widened to carry `ProbeBase ProbeMid ProbeLeaf`) writes nothing of its own to `#id.on` |
| 2 | Same chain, `ProbeMid` *also* declares its own `extractOn`, returning a bag differing in one key from `ProbeBase`'s | `.ProbeMid.on` is created, carrying only that one deviating key; `.ProbeBase.on` is inserted first |
| 3 | `ProbeLeaf` *also* declares its own `extractOn`, returning the *same* bag `ProbeMid`'s produces (no new deviation) | No `.ProbeLeaf.on` rule is created; `ProbeLeaf` instances are served by `.ProbeMid.on` |
| 4 | Same three-level chain, but `ProbeMid` does **not** declare its own `extractOn` (only `ProbeBase` and `ProbeLeaf` do) | `ProbeMid`'s own contribution for suffix `.on` is `{}` — `Object.prototype.hasOwnProperty.call(ProbeMid, "extractOn")` is `false` — so `ProbeLeaf`'s diff is computed against `ProbeBase`'s resolved bag, not `ProbeMid`'s; this is the case that would fail under a design that passed one shared callback down the whole walk instead of an own-property-checked per-level lookup |
| 5 | A rendered `ProbeLeaf` element (row 2's setup), `.ProbeBase.on` and `.ProbeMid.on` both matching it | The recording sink's insertion order has `.ProbeBase.on` before `.ProbeMid.on`, regardless of which concrete class rendered first |
| 6 | An instance-level `StateStyleRule.set()` call with a value differing from every tier's resolved bag | Writes to `#id.on`, unaffected by hierarchy — the instance-vs-class relationship is untouched by this plan |
| 7 | A class in the chain with no state-tier participation anywhere (no `class-hierarchy-cascade.md` opt-in, no `extractOn` override) | Behaves identically to today's flat `ensureClassStateRule` |
| 8 | A default-styled `TabButton` pressed, after a default-styled plain `Button` has already been pressed once elsewhere in the same test run | The `TabButton`'s own `#id.pressed` rule carries nothing; `_ruleCacheHas('.TabButton.pressed')` is `false`; `_ruleCacheHas('.Button.pressed')` is `true` |
| 9 | A default-styled `TabButton` selected | `#id.selected:not(:hover)` carries nothing; `_ruleCacheHas('.TabButton.selected:not(:hover)')` is `true`, carrying `backgroundColor`/`backgroundImage`/`boxShadow` at `TAB_BUTTON_SELECTED_FILL`'s values, inserted after `.ToggleButton.selected:not(:hover)` |
| 10 | A `TabButton` rendered element | Carries `ts-ui-component Button ToggleButton TabButton` |
| 11 | A `SpinButton` rendered element, and its resting `border` | Carries `ts-ui-component Button SpinButton`; `.SpinButton`'s own class rule carries the deviating `border`, not repeating `Button`'s `backgroundColor`/`cursor`/`foregroundColor`/`shadow` |
| 12 | Demo app: `#/buttons` (plain `Button`, hover/press), `#/tabs` (select a tab, press it while selected, hover it), `#/inputs` (a `SpinButton`) | Every state visually identical to before this plan |
| 13 | DevTools, `.Button.pressed`/`.ToggleButton.selected:not(:hover)`/`.TabButton.selected:not(:hover)` inspected via `document.getElementById('Base').sheet.cssRules` | No `.TabButton.pressed` rule exists; `.TabButton.selected:not(:hover)` exists and carries only the tab-specific tokens |
| 14 | Style Audit panel (`#/style-audit`) on `#/buttons` and `#/tabs` together | Total stylesheet size drops relative to before this plan |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

**Manual browser verification (rows 12-14) is required.** Start a dev server on a spare port from *this worktree*, not the user's existing server. Exercise `#/buttons`, `#/tabs`, `#/inputs`, `#/menubar`, and `#/style-audit`. Read computed styles (forcing `.pressed`/`.selected` through DevTools) rather than screenshots — this plan's whole subject is cascade ordering between two independently-evolved mechanisms, and a broken cascade can look identical to a working one in a static image, as every prior plan in this lineage's own retrospective notes record.

---

## Documentation Impact

No exported symbol changes. One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Components`, following `class-hierarchy-cascade.md`'s entry:

> **`Button`, `ToggleButton`, `TabButton`, and `SpinButton` elements now additionally carry their ancestor classes** (`Button`, and for `TabButton` also `ToggleButton`) — the same consumer-facing selector-matching change `class-hierarchy-cascade.md` documents for its own chains applies here too. `TabButton`'s pressed-state rule now shares `Button`'s `.pressed` class rule instead of carrying its own copy. Nothing changes visually; no consumer action needed unless a consumer stylesheet targets `.Button`/`.ToggleButton` expecting to match only literal instances of those classes.

---

## Potential Challenges

- **The resolver-splitting refactor touches four methods across four files with an identical, easy-to-get-subtly-wrong transformation.** The typecheck and the unmodified regression tests (steps 5-8) catch a missed or wrong split.
- **A future `Button` subclass that overrides `getPressedClassDeclarations()` without also providing the matching static extraction function** would have its instance-level resolver diverge from what the hierarchy walk sees for that class — the hierarchy walk would compute a stale or empty contribution for that subclass while the instance method reports something different. No such subclass exists in the tree today beyond what this plan already migrates (`ToggleButton`/`TabButton` for `selected`); flagged here because it is the shape a future author could get wrong.
- **This plan is where two independently-evolved mechanisms first combine** (`class-hierarchy-cascade.md`'s resting-tier walk and this plan's state-tier walk, both reading the same `ownClassStyleDefaults` field for different purposes). Treat the mandatory browser verification as the primary defect-finding step, not the automated suite — matching every retrospective note in this mechanism's lineage.

---

## Critical Files

| File | Why |
|---|---|
| `class-hierarchy-cascade.md` | Hard dependency — `resolveClassLevel`, `ownDefaultsOf`, `getStyleClassChain`, and the opt-in pattern this plan reuses for the state tier |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `ensureClassStateRule` (289), `writeClassStateDeclaration` (349), `StateStyleRule` (386) — the mechanism being made hierarchy-aware, and the parts (the two write helpers, `StateStyleRule`'s own comparison) left untouched |
| `packages/lib/src/typescript/lib/core/Component.ts` | `createStateStyleRule` (1046) — gains the new optional `extractorMethodName` parameter |
| `packages/lib/src/typescript/lib/component/button/Button.ts` | `_defaultButtonOptions` (223), `getPressedClassDeclarations`/`getHoverClassDeclarations` (609, 636), `getRestingExclusionSuffixes` (570) — untouched but load-bearing context |
| `packages/lib/src/typescript/lib/component/button/ToggleButton.ts` | `getSelectedClassDeclarations` (55), `getRestingExclusionSuffixes` (73) |
| `packages/lib/src/typescript/lib/component/button/TabButton.ts` | `_defaultTabButtonOptions` (85), `TAB_BUTTON_SELECTED_FILL` (121), `getSelectedClassDeclarations` (266) |
| `plans/implemented/state-chrome-isolation-generalization.md` | The precedent for `getRestingExclusionSuffixes()`'s chaining shape, and its own Non-Goals naming `Checkbox`/`RadioButton` as a structurally similar deferred case — read for how it reasoned about a chain combining both tiers |
| `plans/implemented/hoist-button-tabbar-state-chrome-rules.md` | Its Implementation Notes record the original, non-hierarchy version of a base-`#id`-rule-vs-state-rule specificity bug this plan's collision hazard is a hierarchy-scale analogue of — read before trusting any specificity reasoning in this plan without re-deriving it |
| `packages/lib/tests/core/ClassStateRules.test.ts` | Test conventions this plan's new test file mirrors; must stay green unmodified |

---

## Non-Goals

- **`MenuButton`, `PopupButton`, `PickerButton`, `RailHandle`.** Direct `Button` subclasses with no state-tier rule of their own and no resting-tier deviation the survey found; they participate in the DOM widening automatically (via `class-hierarchy-cascade.md`'s unconditional `init()` change) with zero additional work once `Button` itself opts in.
- **`NotificationHistoryButton`, `FilterOperatorButton`** (both extend `MenuButton`). Same reasoning; no change needed beyond what lands automatically.
- **Changing `getRestingExclusionSuffixes()`'s isolation mechanism.** Untouched — see `## Architecture Decisions`.
- **`Checkbox`/`RadioButton`'s `CheckboxBox`/`RadioButtonRing`/`CheckboxCheckGlyph`/`RadioButtonDot`.** These are anonymous, module-private delegate classes with no subclass of their own — nothing about this plan's hierarchy mechanism applies to them, and `state-chrome-isolation-generalization.md`'s own Non-Goals already named them as a structurally different, separately-solved case.
- **Bumping the package version.** Release-time bookkeeping.
