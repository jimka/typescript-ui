---
touches-shared:
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/docs/reference/changelog/next.md
  - ARCHITECTURE.md
---

# Cross-Class Style Traits — Implementation Plan

## Overview

Adds a fifth CSS tier to [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts): a **trait** — a named, hand-authored bag of style declarations (a `StyleTrait`) that any number of unrelated component classes, or a single component instance, can opt into. Every opt-in for the same trait shares exactly one generated CSS rule, no matter how many classes or instances use it. This replaces two earlier, unimplemented drafts — `plans/cross-class-style-traits.md` (class-level opt-in only, rule ranked below the class tier) and `plans/cross-class-shared-style-groups.md` (instance-level opt-in only, content harvested from whichever instance rendered first) — with one mechanism that has **both** opt-in surfaces and takes its content from a **declared** constant, never harvested from a live instance.

A trait's content is a plain object literal, fixed at the point it is written in source. Because there is exactly one place the content comes from, there is nothing to compare two callers' content against and no fingerprint to compute — the safety machinery both earlier drafts needed (an agreement check, or a content-hash suffix) simply has no problem to solve here.

The two opt-in surfaces are:

- **Class-level**: `protected static readonly ownStyleTraits: readonly StyleTrait[]` on a `Component` subclass. Every instance of that class, and every subclass beneath it, gets the trait.
- **Instance-level**: `setStyleTrait(trait)` / the `styleTrait` construction option. Only that one instance gets it, regardless of its class.

Both surfaces resolve through the same function, `ensureTraitStyleRule(trait)`, keyed by the trait's own identity — never by a constructor — so two classes with nothing in common, or one class and one unrelated instance, share a rule for free.

The proof case for the class-level surface is real, duplicated CSS: [`TextInput.ts:73-74`](packages/lib/src/typescript/lib/component/input/TextInput.ts#L73-L74), [`AbstractPickerField.ts:48-49`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L48-L49), [`ComboBox.ts:86-87`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L86-L87), and [`FieldSet.ts:27-28`](packages/lib/src/typescript/lib/component/container/FieldSet.ts#L27-L28) each declare the byte-identical pair `border: "var(--ts-ui-input-border)"` / `borderRadius: "var(--ts-ui-border-radius, 4px)"`, with no useful common ancestor.[^first-consumer-reverified] This plan moves that pair into one trait and migrates all four classes onto it, using the class-level surface only. The instance-level surface ships with no consumer — it is exercised by its own tests only, exactly as the deleted shared-group draft's new tier did.

The change touches `ClassStyleRules.ts` (the mechanism), `Component.ts` (the layer stack, the DOM class token, the chrome-default dispatch), a new one-constant module `core/StyleTraits.ts`, the four consumer classes, and one pre-existing helper on `AbstractPickerField` this plan's own re-verification found still reads the migrated constant directly.

---

## Architecture Decisions

### One declared bag, two opt-in surfaces, one shared rule

`ensureTraitStyleRule(trait: StyleTrait)` is the single function both opt-in surfaces call. It mirrors the cache-and-insert shape of the existing, shipped, same-class group tier — [`ensureStyleGroupRule`, ClassStyleRules.ts:1176](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1176) — but is keyed on the trait's own name, never on a constructor, so cross-class sharing is automatic rather than special-cased.[^why-declared-not-harvested]

**This plan's mechanism is unrelated to `styleGroup`/`ensureStyleGroupRule` and does not touch it.** That existing tier solves a different problem: many instances of *one* class whose *computed* values happen to coincide at runtime (`SpinButton`/`TabButton`/`TableHeader`'s icon sizing — see [`plans/implemented/glyph-icon-size-dedup.md`](implemented/glyph-icon-size-dedup.md)) — harvested content, keyed on `(ctor, group)`, self-correcting via `flushStyleBag`'s per-key diff. This plan's trait content is authored once, in source, independent of any instance's runtime state. Every new identifier below says "trait", never "group", so the two are never confused: the exported type is `StyleTrait`, the functions are `ensureTraitStyleRule` / `resolveStyleTraits` / `resolveTraitStyleDefaults` / `traitClassName`, the class-level field is `ownStyleTraits`, and the instance-level option is `styleTrait`.

### A trait's rule sits above the class tier, at `(0,2,0)`

The deleted `cross-class-style-traits.md` placed its rule at `:where(.ts-ui-trait-<name>)`, specificity `(0,0,0)` — *below* the class tier — so a class's own declarations always won. This plan places it *above* the class tier instead: attaching a trait (at either scope) is an authoritative choice ("this property comes from the trait"), not a fallback a class can silently outrank. The selector is `.ts-ui-component.ts-ui-trait-<name>` — the universal `ts-ui-component` token (carried by every rendered element) paired with the trait's own token — giving `(0,2,0)`, genuinely above the class tier's `(0,1,0)` by specificity, never by stylesheet insertion order.[^why-pair-not-where]

| Tier | Selector shape | Specificity |
|---|---|---|
| Framework | `:where(.ts-ui-component)` | `(0,0,0)` |
| Class | `.ClassName` | `(0,1,0)` |
| Same-class group (`styleGroup`, unchanged) | `.ClassName--group` | `(0,1,0)` |
| **Trait (this plan)** | `.ts-ui-component.ts-ui-trait-<name>` | `(0,2,0)` |
| Declared toggle state, guarded | `.ClassName.state:not(.other)` | `(0,3,0)` or higher |
| Declared toggle state, **top-priority, unguarded** | `.ClassName.state` | `(0,2,0)` |
| Instance | `#c17` | `(1,0,0)` |

### Flipping the precedence changes how a subclass overrides an inherited trait

Under the deleted `cross-class-style-traits.md` draft's below-class placement, a subclass could override an inherited trait with a plain class default: `PickerInput` (a `TextInput` subclass with no trait opt-in of its own — it inherits `TextInput`'s) sets `border: "none"` in its own `_defaultPickerInputOptions` ([`PickerInput.ts:18-21`](packages/lib/src/typescript/lib/component/input/PickerInput.ts#L18-L21)), and under the old, below-class precedence that value would win outright: `.PickerInput` real `(0,1,0)` beats a `:where()` trait's `(0,0,0)`.

Under this plan's above-class placement, `.PickerInput`'s own class rule (`(0,1,0)`) can never beat the trait rule (`(0,2,0)`) in real CSS — a plain class-tier override is no longer strong enough. The override still works correctly, but for a different reason: `PickerInput`'s border is not just a class default, it is *dispatched* to `setBorder()` by [`applyChromeOptions` (Component.ts:856)](packages/lib/src/typescript/lib/core/Component.ts#L856), which makes it an **authored instance value** (`_instanceStyle.border = "none"`). `flushStyleBag`'s existing per-key diff ([Component.ts:5483](packages/lib/src/typescript/lib/core/Component.ts#L5483)) compares an authored key against `layersBelowInstance()` — and once the trait layer is inserted into that array *above* the class layer (this plan's own change, described below), the diff finds "none" differs from the trait's real border value and writes a genuine declaration onto `PickerInput`'s own `#id` rule, at `(1,0,0)`, which unconditionally wins. No change to `PickerInput.ts` is needed — the existing dispatch and the existing generic diff already produce the correct result once the trait layer sits at the right place in the array.[^picker-input-worked-example]

### The trait layer joins `styleLayers()` / `layersBelowInstance()` above the class layer

[`_groupLayer` already sits above `_classLayer`](packages/lib/src/typescript/lib/core/Component.ts#L5095) in both arrays, even though its real CSS specificity only ties with class (both `(0,1,0)`) — a pre-existing, accepted ambiguity that is safe only because `styleGroup` is keyed per class, so two members of one group always share the same class defaults to begin with. A trait has no such per-class guarantee (that is the entire point), so placing its layer above `_classLayer` is not merely consistent with the existing array shape — it is the *first* tier placement in this array that is unconditionally, provably correct, because a trait's real specificity genuinely and always beats class.

Two new per-instance fields carry this: `_instanceTraitLayer` (the instance-level opt-in, dynamic — set, read, and possibly cleared over an instance's lifetime) and `_classTraitLayers` (the class-level opt-in, fixed for the life of the instance). Both are pushed into `styleLayers()` and `layersBelowInstance()` immediately before the `_groupLayer` push, instance-level first (matching the general "instance beats class" precedent already used everywhere else in the layer stack).

### The state tier can tie with a trait, and the tie is refused, not resolved by order

A declared toggle state's selector is `.ClassName<guardedSuffix>`, built by [`resolveStateLevels`/`guardedSuffixFor` (ClassStyleRules.ts:676, 743)](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L676). `guardedSuffixFor` guards a state against every *higher-priority* entry declared before it — so the first (highest-priority) entry in a class's `ownStyleStates` list gets **no guard at all**: `Button`'s `.pressed` ([`Button.ts:394-396`](packages/lib/src/typescript/lib/component/button/Button.ts#L394-L396)) is index `0`, so its real selector is the bare `.Button.pressed` — `(0,2,0)`, identical to a trait's specificity. Every other entry in any class's list carries at least one `:not(...)` guard, each of which is itself a class selector contributing `(0,1,0)`, so every non-top-priority state is reliably `(0,3,0)` or higher — safely above a trait. **Only a class's single top-priority state can ever tie with a trait; every other declared state cannot.**[^state-specificity-proof]

There is no CSS selector with specificity strictly between `(0,1,0)` and `(0,2,0)` — specificity components are integers, so no amount of `:where()`/attribute-selector engineering can carve out a gap. Rather than leave this one narrow case to unpredictable stylesheet insertion order, this plan detects it and refuses it outright: `traitTopStateConflictKeys(ctor, trait)` computes the real CSS property keys a trait's rule would actually paint (the deviation set — the same computation `ensureTraitStyleRule` itself does) and intersects them with the real CSS property keys the class's own top-priority state declares. **The guarantee this plan actually ships: if a class's unguarded top-priority state and a trait it uses would ever declare the same CSS property, resolving that trait for that class throws immediately, at first render — it never ships as a silent, order-dependent visual bug.** This never fires for the shipped consumer: none of `TextInput`, `AbstractPickerField`, `ComboBox`, or `FieldSet` declares `ownStyleStates` at all.[^no-ownstylestates-on-consumers]

This check does not, and cannot cheaply, extend to `.focused` / value-class-token rules (`ensureSharedStateRule`, `Component.setValueStyleState`) — those are dynamically keyed per call site, not resolvable from a constructor alone the way `ownStyleStates` is. They are also bare, unguarded `(0,2,0)` selectors and could in principle tie with a trait the same way. No shipped consumer combines the two; `## Non-Goals` records this as an unchecked boundary, the same way the deleted drafts left "no overlapping traits" and "no per-key agreement" unchecked.

### `applyChromeOptions` needs a trait-aware fallback, re-verified against current code

[`applyChromeOptions` (Component.ts:856)](packages/lib/src/typescript/lib/core/Component.ts#L856) resolves `border` / `borderRadius` / `shadow` / `backgroundImage` as `options.X ?? this._defaultOptions.X` and *dispatches* the result — because `setBorder`'s parsed `_border` cache is what [`getBorderSize` (Component.ts:3458)](packages/lib/src/typescript/lib/core/Component.ts#L3458) reads for layout, this fold must still happen even when a class's own `_defaultOptions.border` is now `undefined` (because the value moved into a trait). Re-verified unchanged from the deleted `cross-class-style-traits.md` draft's finding: without a third fallback, a migrated class's own default-constructed instance would paint its border via the trait's CSS rule but measure a zero-width border for layout. The fix is the same one line: `options.X ?? this._defaultOptions.X ?? classTraitDefaults.X ?? undefined`, where `classTraitDefaults` is `resolveTraitStyleDefaults(this.constructor)` — the merged, declared bag of every trait the class opts into. This fallback covers the class-level surface only; the instance-level surface has no consumer needing it (`## Non-Goals`).

### First consumer re-verified, plus one fix the deleted draft missed

The four consumers and their byte-identical `border`/`borderRadius` pair were re-read from current source and confirmed unchanged (line numbers above). One thing the deleted `cross-class-style-traits.md` draft did not find: [`AbstractPickerField.getDefaultBorder()` (AbstractPickerField.ts:200-202)](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L200-L202) reads `_defaultPickerFieldOptions.border` **directly**, bypassing the options-merge pipeline entirely, to restore the border once the invalid-input state clears ([`AbstractPickerField.ts:449`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L449)). Once `border` is deleted from `_defaultPickerFieldOptions`, this method would return `undefined`. It must instead read the trait constant directly: `INPUT_CHROME_TRAIT.declarations.border as string`.

---

## Public API

Nothing in `core/ClassStyleRules.ts` or the new `core/StyleTraits.ts` is re-exported from `core/index.ts`, so none of it reaches the generated API docs. The three `Component` additions (`ComponentOptions.styleTrait`, `getStyleTrait`, `setStyleTrait`) are public and do.

### `core/ClassStyleRules.ts`

```typescript
/** A named bag of declarations any class or instance can opt into. */
export interface StyleTrait {
    /** Kebab-case, no whitespace; becomes the `ts-ui-trait-<name>` DOM class. */
    readonly name: string;
    readonly declarations: StyleBag;
}

/** Prefix of every trait DOM class token and selector. */
export const TRAIT_CLASS_PREFIX = "ts-ui-trait-";

/** `TRAIT_CLASS_PREFIX + trait.name`. */
export function traitClassName(trait: StyleTrait): string;

/** Every trait `ctor` declares through `ownStyleTraits`, ancestor-most first, deduped by name. Memoized. No CSS side effect. */
export function resolveStyleTraits(ctor: Function): readonly StyleTrait[];

/** Every declared class-level trait's `declarations`, merged nearest-class-last. Memoized. No CSS side effect. */
export function resolveTraitStyleDefaults(ctor: Function): StyleBag;

/** Ensures the shared `.ts-ui-component.ts-ui-trait-<name>` rule and returns
 *  its layer; `null` on a name already owned by a different trait object. */
export function ensureTraitStyleRule(trait: StyleTrait): StyleLayer | null;

/** The real CSS property keys `trait`'s rule would paint that also appear in
 *  `ctor`'s own top-priority (unguarded) declared state, if it has one.
 *  Empty when there is no conflict. Pure — never throws, never inserts CSS. */
export function traitTopStateConflictKeys(ctor: Function, trait: StyleTrait): readonly string[];
```

### `core/StyleTraits.ts` (new)

```typescript
export const INPUT_CHROME_TRAIT: StyleTrait;
```

| Trait `name` | DOM class token | CSS selector |
|---|---|---|
| `input-chrome` | `ts-ui-trait-input-chrome` | `.ts-ui-component.ts-ui-trait-input-chrome` |

### The class-level opt-in

```typescript
protected static readonly ownStyleTraits: readonly StyleTrait[] = [INPUT_CHROME_TRAIT];
```

Read through an own-property check per level (mirroring [`ownDefaultsOf`, ClassStyleRules.ts:507](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L507)), then unioned down the chain: a subclass inherits its ancestors' traits with no ability to opt back out, and adds its own by declaring only its own. There is no "remove an inherited trait" mechanism, matching how a class cannot remove an inherited `ownClassStyleDefaults` value either — an override property (border: none, etc.) is a per-property class or instance default, not a trait unopt.

### `core/Component.ts`

```typescript
export interface ComponentOptions {
    // …
    /** Attaches this single instance to a shared, declared `StyleTrait`
     *  regardless of its class. `null` clears it. See `setStyleTrait`. */
    styleTrait?: StyleTrait | null;
}

/** This instance's own `styleTrait`, or `null` when unset. */
getStyleTrait(): StyleTrait | null;

/**
 * Attaches (or clears) this instance's own trait, independent of its class.
 * A plain assignment — like `setStyleGroup`, it does not itself validate or
 * touch CSS. If `trait`'s declared properties collide with this instance's
 * class's own top-priority declared state, the *next render* throws instead
 * of resolving the tie by stylesheet order — see the plan's Architecture
 * Decisions on the state-tier specificity tie.
 */
setStyleTrait(trait: StyleTrait | null): this;
```

Backing store is `this._options.styleTrait` (no private field), matching `styleGroup`'s shape. Two new **private** fields back the resolved layers: `_instanceTraitLayer: StyleLayer | null` and `_classTraitLayers: readonly StyleLayer[] | null`.

---

## Internal Structure

### `ensureTraitStyleRule` — `core/ClassStyleRules.ts`, appended after `ensureStyleGroupRule`

```typescript
const _traitBags: Map<string, StyleLayer | null> = new Map();

export function ensureTraitStyleRule(trait: StyleTrait): StyleLayer | null {
    const className = traitClassName(trait);
    const existing  = _traitBags.get(className);

    if (existing !== undefined) {
        return existing;
    }

    const owner = _owners.get(className);
    if (owner !== undefined && owner !== trait) {
        _traitBags.set(className, null);
        return null;
    }
    _owners.set(className, trait);

    const resolved   = resolveDeclarations({ ...FRAMEWORK_DEFAULTS, ...trait.declarations });
    const deviations = deviationsFrom(resolved, FRAMEWORK_DECLARATIONS);

    if (Object.keys(deviations).length > 0) {
        new StyleRule({
            scope:  "selector",
            name:   "." + COMPONENT_CLASS + "." + DOM.source.escapeSelector(className),
            styles: deviations,
        });
    }

    const layer = Object.freeze({ authored: trait.declarations, resolved: Object.freeze(deviations) });
    _traitBags.set(className, layer);

    return layer;
}
```

`FRAMEWORK_DEFAULTS` seeding is required for the same reason `resolveClassLevel` needs it: an absent `minSize`/`overflow` in `trait.declarations` would otherwise resolve against `resolveDeclarations`'s own fallbacks (`"auto"`/`"visible"`), which diverge from the framework baseline (`"0px"`/`"hidden"`), producing four spurious deviations that would reset every opted-in element's minimum size and overflow.[^framework-defaults-seed-reverified] `_owners`'s value type widens from `Map<string, Function>` to `Map<string, object>` to hold a `StyleTrait` — every existing use is an identity comparison or a `set`, so no other call site changes.

Unlike the deleted `cross-class-style-traits.md` draft, this function does **not** call `ensureFrameworkStyleRule()` first: that ordering trick existed only to fix a same-specificity tie between two `:where()` rules (both `(0,0,0)`). This trait rule's `(0,2,0)` can never tie with the framework's `(0,0,0)`, so no ordering is needed.

### `traitTopStateConflictKeys` — `core/ClassStyleRules.ts`

```typescript
export function traitTopStateConflictKeys(ctor: Function, trait: StyleTrait): readonly string[] {
    const bare = resolveStyleStates(ctor).find((s) => !s.guardedSuffix.includes(":not("));
    if (!bare) {
        return [];
    }

    const resolved   = resolveDeclarations({ ...FRAMEWORK_DEFAULTS, ...trait.declarations });
    const deviations = deviationsFrom(resolved, FRAMEWORK_DECLARATIONS);

    return Object.keys(bare.layer.resolved).filter((key) => key in deviations);
}
```

At most one entry in `resolveStyleStates(ctor)` can lack a `:not(...)` guard — the proof is `guardedSuffixFor`'s own loop, which only skips entirely for index `0` (see the Architecture Decisions section above) — so `.find` never needs to consider more than the one real candidate.

### `Component.ts` — the throwing wrapper

```typescript
/** Resolves `trait` for `ctor`, or throws if `trait`'s declared properties
 *  would tie in real CSS specificity with `ctor`'s own top-priority declared
 *  state (see the plan's Architecture Decisions). Called by both opt-in
 *  surfaces so neither can bypass the check. */
private ensureTraitLayer(ctor: Function, trait: StyleTrait): StyleLayer | null {
    const conflicts = traitTopStateConflictKeys(ctor, trait);

    if (conflicts.length > 0) {
        throw new Error(
            `${ctor.name} cannot use trait "${trait.name}": its own top-priority declared ` +
            `state already sets ${conflicts.join(", ")}, which would tie in CSS specificity ` +
            `with the trait's shared rule. Remove the overlapping property from one side.`
        );
    }

    return ensureTraitStyleRule(trait);
}
```

### `Component.ts` — `init()`, class-level tokens (appended to the existing `addClass` array, Component.ts:7065)

```typescript
const classTraits      = resolveStyleTraits(this.constructor);
const classTraitTokens = classTraits
    .filter((trait) => this.ensureTraitLayer(this.constructor, trait) !== null)
    .map(traitClassName);
// … addClass: [COMPONENT_CLASS, ...getStyleClassChain(...), ...groupClass,
//              ...activeStateTokens, ...valueClassTokens, ...classTraitTokens]
```

A name collision (a different `StyleTrait` object claiming the same `name`) still returns `null` from `ensureTraitLayer` and is filtered out silently, exactly like every other tier's name-collision fallback — only a *state* conflict throws.

### `Component.ts` — `applyStyle`, seeding both layers (inserted immediately after the existing `_groupLayer` block, before `this._resolvedCache = null`)

```typescript
// Class-level: recomputed every render (both calls are memoized, so this is
// cheap), kept in lockstep with the tokens `init()` already wrote once.
this._classTraitLayers = resolveStyleTraits(this.constructor)
    .map((trait) => this.ensureTraitLayer(this.constructor, trait))
    .filter((layer): layer is StyleLayer => layer !== null);

// Instance-level: dynamic, so token and layer are decided together here,
// the same way `_groupLayer`'s own token is — an element carries the token
// exactly when the layer is non-null.
const instanceTrait = this.getStyleTrait();
this._instanceTraitLayer = instanceTrait ? this.ensureTraitLayer(this.constructor, instanceTrait) : null;

if (instanceTrait) {
    const token = traitClassName(instanceTrait);
    DOM.sink.apply(element, this._instanceTraitLayer ? { addClass: [token] } : { removeClass: [token] });
}
```

### `Component.ts` — `styleLayers()` / `layersBelowInstance()`

Both arrays gain, immediately before the existing `if (this._groupLayer) layers.push(this._groupLayer);` line:

```typescript
if (this._instanceTraitLayer) layers.push(this._instanceTraitLayer);
layers.push(...(this._classTraitLayers ?? []));
```

### `Component.ts` — `applyChromeOptions` (Component.ts:856)

```typescript
const classTraits = resolveTraitStyleDefaults(this.constructor);

const border          = options.border          ?? this._defaultOptions.border          ?? classTraits.border          ?? undefined;
const borderRadius    = options.borderRadius    ?? this._defaultOptions.borderRadius    ?? classTraits.borderRadius    ?? undefined;
const shadow          = options.shadow          ?? this._defaultOptions.shadow          ?? classTraits.shadow          ?? undefined;
const backgroundImage = options.backgroundImage ?? this._defaultOptions.backgroundImage ?? classTraits.backgroundImage ?? undefined;
```

The four `!== undefined` dispatch guards below this block are unchanged. `resolveTraitStyleDefaults` returns a shared frozen `{}` for a class with no traits, so this is a no-op for every other component in the framework.

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`** — widen `_owners` (line 164) to `Map<string, object>`. Check: `npm run typecheck` passes with no other edit.
2. **Same file** — add `StyleTrait`, `TRAIT_CLASS_PREFIX`, `traitClassName`, the `_traitBags` cache, `resolveStyleTraits`, `resolveTraitStyleDefaults`, `ensureTraitStyleRule`, and `traitTopStateConflictKeys`, placed after `ensureStyleGroupRule` at the end of the module (mirroring its cache/insert shape, per `## Internal Structure`). `resolveStyleTraits` walks `canonicalCtor(ctor)` upward exactly as `resolveClassLevel` does, collecting each level's own-property `ownStyleTraits` entries, ancestor-most first, deduped by `.name`, memoized. `resolveTraitStyleDefaults` merges every resolved trait's `declarations`, nearest-class-last. Extend the module's header comment with one sentence naming the trait tier and this plan.
3. **`packages/lib/src/typescript/lib/core/StyleTraits.ts`** — new file. SPDX header, `import type { StyleTrait } from "~/core/ClassStyleRules.js"`, and `INPUT_CHROME_TRAIT` with a doc comment naming its four consumers and why they have no useful common ancestor.
4. **`packages/lib/src/typescript/lib/core/Component.ts`** — extend the `~/core/ClassStyleRules.js` import (line 26) with `resolveStyleTraits`, `resolveTraitStyleDefaults`, `ensureTraitStyleRule`, `traitClassName`, `traitTopStateConflictKeys`, and `type StyleTrait`.
5. **Same file** — add `styleTrait?: StyleTrait | null;` to `ComponentOptions`, directly after `styleGroup` (line 168), with the JSDoc from `## Public API`.
6. **Same file** — add `_instanceTraitLayer` and `_classTraitLayers` fields beside `_groupLayer` (line 572), and the private `ensureTraitLayer` method, per `## Internal Structure`.
7. **Same file** — add `getStyleTrait` / `setStyleTrait` immediately after `getStyleGroup`/`setStyleGroup` (line ~1951), and add `if (options.styleTrait !== undefined) this.setStyleTrait(options.styleTrait);` beside the `styleGroup` dispatch (line ~801).
8. **Same file** — in `init()` (line 7028), compute `classTraitTokens` per `## Internal Structure` and append it as the final segment of the existing `addClass` array (after `valueClassTokens`).
9. **Same file** — in `applyStyle` (around line 5988, immediately after the existing `_groupLayer` seeding), add the `_classTraitLayers` / `_instanceTraitLayer` seeding block from `## Internal Structure`, including the instance token add/remove.
10. **Same file** — in `styleLayers()` (line 5082) and `layersBelowInstance()` (line 5138), push the two new layers immediately before the existing `_groupLayer` push, per `## Internal Structure`. Update both methods' doc comments to name the trait tier between the instance/value-class layers and the group layer.
11. **Same file** — in `applyChromeOptions` (line 856), add the `classTraits` fallback to all four chrome fields, per `## Internal Structure`. Extend the method's `@param` remark with one sentence on the trait fallback.
12. **`packages/lib/src/typescript/lib/component/input/TextInput.ts`** — delete `border` and `borderRadius` from `_defaultTextInputOptions` (lines 73-74). Add `protected static readonly ownStyleTraits: readonly StyleTrait[] = [INPUT_CHROME_TRAIT];` beside `ownClassStyleDefaults` (line 114). Widen the existing `import type { StyleBag, TextStyleBag } from "~/core/ClassStyleRules.js"` (line 5) to include `type StyleTrait`, and add `import { INPUT_CHROME_TRAIT } from "~/core/StyleTraits.js";`.
13. **`packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts`** — delete `border`/`borderRadius` from `_defaultPickerFieldOptions` (lines 48-49). Add `ownStyleTraits` beside `ownClassStyleDefaults` (line 78). Widen the existing `StyleBag` import (line 5) and add the `INPUT_CHROME_TRAIT` import. **Fix `getDefaultBorder()` (lines 200-202)** to `return INPUT_CHROME_TRAIT.declarations.border as string;` instead of reading `_defaultPickerFieldOptions.border`.
14. **`packages/lib/src/typescript/lib/component/input/ComboBox.ts`** — delete `border`/`borderRadius` from `_defaultComboBoxOptions` (lines 86-87; **do not** touch the unrelated `_defaultComboBoxDropdownOptions` pair at lines 125-126). Declare `ownStyleTraits` as the first member of `class ComboBox` (line 673) — do **not** add `ownClassStyleDefaults`, since `ComboBox` has none today and declaring `ownStyleTraits` alone does not make its chain participate in the hierarchy cascade (`chainParticipates` only reads `ownClassStyleDefaults`). Widen the existing `StyleBag` import (line 22) and add the `INPUT_CHROME_TRAIT` import.
15. **`packages/lib/src/typescript/lib/component/container/FieldSet.ts`** — delete `border`/`borderRadius` from `_defaultFieldSetOptions` (lines 27-28). Declare `ownStyleTraits` as the first member of `class FieldSet` (line ~46) — same "no `ownClassStyleDefaults`" note as step 14. Add a new `import type { StyleTrait } from "~/core/ClassStyleRules.js";` and the `INPUT_CHROME_TRAIT` import (`FieldSet.ts` has no existing `ClassStyleRules` import).
16. **Regression checkpoint** — `grep -n 'ts-ui-input-border' packages/lib/src/typescript/lib/component/input/TextInput.ts packages/lib/src/typescript/lib/component/container/FieldSet.ts` — expect zero matches. Same grep on `AbstractPickerField.ts` — expect zero matches (the `getDefaultBorder` fix removed the last one). Same grep on `ComboBox.ts` — expect exactly one, line 125 (`_defaultComboBoxDropdownOptions`, out of scope).
17. **`packages/lib/tests/core/StyleTraitRules.test.ts`** — new file, modelled on `packages/lib/tests/core/StyleGroupRules.test.ts`'s harness (`installTestDOM`, `declarationsDuring`, `idSelector`, `ensureStyleRuleOpsFor`, and its file-wide "every locally-declared class needs a unique name, module state survives `DOM.reset()`" caveat). Covers `## Expected Behaviour` rows 1-11.
18. **`packages/lib/tests/component/input/TextInputClassTier.test.ts`** — move the two chrome assertions at lines 107-108 out of the `.TextInput`-selector block into a new assertion against `.ts-ui-component.ts-ui-trait-input-chrome`, and add an assertion that `.TextInput`'s own declarations no longer include `borderTop`/`borderRadius`.
19. **Docs** — `ARCHITECTURE.md` and `packages/lib/docs/reference/changelog/next.md`, per `## Documentation Impact`.
20. **Verify** — run everything in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Create | `packages/lib/src/typescript/lib/core/StyleTraits.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TextInput.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/FieldSet.ts` |
| Create | `packages/lib/tests/core/StyleTraitRules.test.ts` |
| Modify | `packages/lib/tests/component/input/TextInputClassTier.test.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

`packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts` is deliberately **not** in this table — see `## Non-Goals`.

---

## Expected Behaviour

Rows 1-11 are unit-testable against the recording DOM sink. Rows 12-13 need a browser.

1. **Cross-class sharing, class-level.** Rendering the first instance of a class declaring `ownStyleTraits: [INPUT_CHROME_TRAIT]` inserts exactly one `.ts-ui-component.ts-ui-trait-input-chrome` rule. Rendering an instance of a *second*, unrelated class declaring the same trait writes no further declarations to that selector.
2. **Deviations only.** That rule's body is the four `border-*` longhands plus `border-radius`, and nothing else — no `boxSizing`, `position`, `display`, `cursor`, `minWidth`/`minHeight`, `overflowX`/`overflowY`, etc.
3. **DOM token, class-level.** A rendered `TextField` carries `ts-ui-trait-input-chrome` in its class list, after its class chain and after any group/state/value-class token.
4. **Class rule shrinks.** `.TextInput`, `.AbstractPickerField` (or whichever level in that chain still owns a rule), `.ComboBox`, and `.FieldSet` declare their other own properties but no `border-top`/`border-right`/`border-bottom`/`border-left`/`border-radius`.
5. **Trait beats class in real CSS, and a `#id` override still wins.** A rendered `PickerInput` (which inherits `INPUT_CHROME_TRAIT` from `TextInput` with no opt-in of its own) writes a real `border-top: none` (and the other three sides) on its own `#id` rule — not a no-op removal — because its authored `"none"` now differs from what `layersBelowInstance()`'s trait layer resolves. `getBorder()` reports `{ border: "none" }`.
6. **Getters resolve through the trait, before and after render.** `new TextField().getBorder()` returns `{ border: "var(--ts-ui-input-border)" }` and `getBorderRadius()` returns `"var(--ts-ui-border-radius, 4px)"`, both before first render and after `getElement(true)`. Same for `ComboBox`, `FieldSet`, and `DateField`.
7. **Layout still measures the border.** With a theme supplying `--ts-ui-input-border: 1px solid rgb(200,200,200)`, a rendered `TextField`'s `getBorderSize()` reports `1` on all four sides (the `applyChromeOptions` trait fallback keeps `setBorder` dispatched).
8. **`AbstractPickerField`'s invalid-border restore still works.** Setting the invalid state and then clearing it restores `border: var(--ts-ui-input-border)` via the fixed `getDefaultBorder()`.
9. **Instance-level opt-in, cross-class, non-chrome property.** A `Component` subclass and an unrelated second `Component` subclass, neither declaring `ownStyleTraits`, both call `setStyleTrait(someTrait)` where `someTrait.declarations = { cursor: "pointer" }`. Both share one `.ts-ui-component.ts-ui-trait-<name>` rule; both elements' class lists carry the token; neither's own `#id` rule declares `cursor`.
10. **Instance-level opt-in is dynamic.** Calling `setStyleTrait(null)` on the instance from row 9 and re-rendering removes the token from its class list; `getCursor()` now resolves to the framework default (`"default"`) instead of the trait's `"pointer"`, since no other tier on that instance declares `cursor`.
11. **Name collision self-corrects; state collision throws.** Two distinct `StyleTrait` objects sharing one `.name` — `ensureTraitStyleRule` returns `null` for the second; its class/instance gets no token and (per `## Non-Goals`) is responsible for its own declaration. Separately, a class declaring both `ownStyleTraits: [T]` and an `ownStyleStates` list whose top-priority (index 0) entry shares a CSS property with `T` — rendering *any* instance of that class throws, with a message naming the class, the trait, and the conflicting property.
12. **Manual — visual parity.** In the demo app (`npm run dev`, `localhost:8015`), a `TextField`, a `DateField`, a `ComboBox`, and a `FieldSet` render with the same visible border and corner radius as before the change, in both light and dark themes. A `PickerInput` inside a `DateField` still shows no inner border.
13. **Manual — audit.** The Style Audit view (`#/style-audit`) reports a lower total stylesheet size than before the change, and every duplicate-row entry still names a real component class, never a `ts-ui-trait-…` token — confirming `buildComponentIndex` needs no change (see `## Non-Goals`).

---

## Verification

- `npm run typecheck`
- `npm run test` — includes `typecheck:test`; the new `StyleTraitRules.test.ts` and the amended `TextInputClassTier.test.ts` must pass, and these existing suites must stay green without edits: `tests/component/default-options-fallback.test.ts` (the `PopupPanel border` row is unaffected — `PopupPanel` is not a trait consumer), `tests/component/content-box-containment.test.ts` (proves the border-width measurement path still works through the trait fold), `tests/core/StyleLayers.test.ts`, `tests/core/StyleGroupRules.test.ts`, `tests/core/ClassHierarchyCascade.test.ts`, `tests/core/ClassStateRules.test.ts`, `tests/core/RestingChromeIsolation.test.ts`, `tests/diagnostics/StyleAudit.test.ts`.
- `npm run lint`
- `grep -rn 'ts-ui-input-border' packages/lib/src/typescript/lib/component/` — expect matches only in `ComboBox.ts:125` (`_defaultComboBoxDropdownOptions`, out of scope), `AutoCompleteDropdown.ts`, `TimePickerDropdown.ts`, `AbstractCalendarDropdown.ts`, `AutoCompleteField.ts`, and `StyleTraits.ts`'s new `INPUT_CHROME_TRAIT` declaration.
- `npm run docs:api` — must finish with zero warnings.
- Manual, per `## Expected Behaviour` rows 12-13: `npm run dev`, then a text field screen, a date-picker screen, a combo-box screen, a fieldset screen, and `#/style-audit`.

---

## Documentation Impact

`core/ClassStyleRules.ts` and `core/StyleTraits.ts` are not re-exported from `core/index.ts`, so no TypeDoc page, catalog entry, or sidebar entry changes for them. `ComponentOptions.styleTrait`, `getStyleTrait`, and `setStyleTrait` **are** public: TypeDoc picks them up from `Component`'s existing page automatically — no page/catalog/sidebar file is edited, but their JSDoc (step 5 and step 7) is the documentation and must be written carefully.

- **`ARCHITECTURE.md`, *Component CSS tiers and state-rule dedup*** — the tier table currently lists Framework/Class/Instance. Add a **Trait** row: selector `.ts-ui-component.ts-ui-trait-<name>`, specificity `(0,2,0)`, written by `ClassStyleRules.ts`'s `ensureTraitStyleRule`, once per trait name per process, ranked above Class and below a guarded declared state. Add one short paragraph: a class opts in with `ownStyleTraits` (inherited down the chain, no opt-out); an instance opts in with `setStyleTrait`/`styleTrait`; a trait outranks the class tier by specificity, so a class that needs a different value for a trait's property must deliver it as an authored instance value (a real setter call, not a plain class default) so it lands on `#id`; a class whose own top-priority declared state would tie with a trait it uses throws at first render instead of resolving by stylesheet order.
- **`packages/lib/docs/reference/changelog/next.md`**, under `## Added` → `### Core` — a bullet: components can now share a declared style bag across unrelated classes via `ownStyleTraits` (class-level) or the new `styleTrait` option (instance-level); the shared rule outranks a plain class default, so overriding one of its properties on a specific class or instance requires an explicit setter call, not just a class-tier default.
- **Same file, under `### Components`** (or folded into the same bullet) — `TextInput` (and `TextField`/`TextArea`/`PasswordField`/`UsernameField`/`PickerInput`), `AbstractPickerField` (and `DateField`/`TimeField`/`DateTimeField`), `ComboBox`, and `FieldSet` now additionally carry a `ts-ui-trait-input-chrome` class on their rendered element; their border and border-radius declarations move from each class's own rule onto one shared rule. **Call out the consumer-visible break precisely, and note it inverts the previous drafts' framing:** a consumer stylesheet rule of the form `.TextInput { border: … }` — previously a toss-up decided by stylesheet load order, since both the framework's and a consumer's own `.TextInput` rule sat at the same `(0,1,0)` — now **reliably loses** to the framework's own `(0,2,0)` trait rule. A consumer relying on overriding this border via a plain class selector must raise its own selector's specificity (e.g. two classes, or an id) to keep winning.

---

## Potential Challenges

- **Sheet order is runtime order, not source order** — every rule is appended at `sheet.cssRules.length` on first `ensure()`. Mitigation: this tier's selector shape makes trait-versus-class and trait-versus-framework pure specificity comparisons; the one genuine tie (trait versus a class's unguarded top-priority state) is refused outright rather than left to order (`traitTopStateConflictKeys`).
- **A missing `applyChromeOptions` fold would paint a correct border that measures as zero.** Mitigation: `## Expected Behaviour` row 7 and the existing `tests/component/content-box-containment.test.ts` both pin the measured width.
- **`AbstractPickerField.getDefaultBorder()` reads the migrated constant directly** — an easy thing to miss because it bypasses the options-merge pipeline entirely. Mitigation: step 13's explicit fix, and `## Expected Behaviour` row 8.
- **Trait rules are process-global and never disposed per instance** — created through the module-level `new StyleRule(...)` path, never through `createStyleRule`/`trackSelector`. Mitigation: do not call `this.trackSelector(...)` for a trait selector; this mirrors every other shared tier.
- **Module state survives `DOM.reset()`.** `_traitBags` and `_owners` outlive a test's DOM teardown. Mitigation: the new test file uses one uniquely-named local subclass and one uniquely-named `StyleTrait` per case, as `StyleGroupRules.test.ts` already documents for the same reason.
- **The state-conflict check only covers `ownStyleStates`, not `.focused`/value-class tokens.** Mitigation: documented as an explicit, unchecked boundary in `## Non-Goals`; no shipped consumer combines the two.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) | The tier mechanism. `ensureStyleGroupRule` (:1176) is the cache/insert shape to mirror; `resolveClassLevel` (:573), `resolveDeclarations` (:223), `deviationsFrom` (:522), `FRAMEWORK_DECLARATIONS` (:123), `FRAMEWORK_DEFAULTS` (:153) are reused verbatim; `resolveStateLevels`/`guardedSuffixFor` (:743, :676) are what `traitTopStateConflictKeys` reads to prove which state entries can tie. |
| [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) | `styleLayers` (:5082), `layersBelowInstance` (:5138), `flushStyleBag` (:5483), `applyStyle` (:5967), `init` (:7028), `applyChromeOptions` (:856), `setBorder`/`getBorderSize` (:2700/:3458), `getStyleGroup`/`setStyleGroup` (:1951/:1975) as the API shape to mirror for `styleTrait`. |
| [`packages/lib/src/typescript/lib/core/StyleTarget.ts`](packages/lib/src/typescript/lib/core/StyleTarget.ts) | `_selectorOf`/`StyleRuleScope` — `scope: "selector"` is the verbatim-selector construct the trait rule's compound selector needs. |
| [`packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts) | `getDefaultBorder` (:200-202) — the fix this plan's own re-verification found that the deleted `cross-class-style-traits.md` draft missed. |
| [`packages/lib/tests/core/StyleGroupRules.test.ts`](packages/lib/tests/core/StyleGroupRules.test.ts) | The test harness and module-state caveats the new suite copies. |
| [`plans/implemented/glyph-icon-size-dedup.md`](implemented/glyph-icon-size-dedup.md) | The existing, shipped, same-class group tier in production use — read to confirm it is a genuinely different mechanism this plan does not touch. |
| [`plans/implemented/class-hierarchy-cascade.md`](implemented/class-hierarchy-cascade.md) | The own-property / delta-against-parent discipline `resolveStyleTraits` mirrors for its chain walk. |
| [`plans/implemented/layered-style-bag.md`](implemented/layered-style-bag.md) | The layer-stack contract (`styleLayers`/`layersBelowInstance`/`flushStyleBag`) the trait layer joins. |

---

## Non-Goals

- **No opt-out for a subclass that inherits a class-level trait.** `PickerInput` inheriting `TextInput`'s `INPUT_CHROME_TRAIT` and needing to override one property is handled by the existing authored-instance-value path (see the worked example in `## Architecture Decisions`), not by a "remove this trait" declaration.
- **No `applyChromeOptions` fallback for the instance-level surface.** The class-level fallback (`resolveTraitStyleDefaults(this.constructor)`) is enough for this plan's only consumer. An instance-level trait carrying `border`/`borderRadius`/`shadow`/`backgroundImage` would paint correctly but not measure correctly for layout — the instance-level surface's own tests (`## Expected Behaviour` rows 9-10) deliberately use a non-chrome property to stay inside what is actually built.
- **No check against `.focused` / value-class-token rules.** These are dynamically keyed, not resolvable from a constructor the way `ownStyleStates` is; a future trait combined with one of these could still tie by stylesheet order. No shipped consumer does this.
- **No `StyleAudit.ts` change.** [`buildComponentIndex` (StyleAudit.ts:36)](packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts#L36) picks the first non-`ts-ui-component` class token as a component's name. `getStyleClassChain` always contributes at least the concrete class's own name and is always written before any trait token in `init()`'s single `addClass` call (and the instance-level token, written later still via a separate call in `applyStyle`, is later yet) — so a trait token can never be mistaken for a class name and no guard is needed. This is a deliberate simplification versus the deleted `cross-class-style-traits.md` draft, which added an unnecessary exclusion.
- **No migration of the `AnimatedDropdown` descendants** (`AutoCompleteDropdown`, `TimePickerDropdown`, `ComboBoxDropdown`, `AbstractCalendarDropdown`, `PopupPanel`) — they share a byte-identical four-key chrome bag, but already dedupe it through `AnimatedDropdown.ownClassStyleDefaults`'s existing class-tier hierarchy. Different fix, different tier.
- **No change to `Cell` or `AutoCompleteField`.** `Cell` uses a different border token (`--ts-ui-table-cell-border`); `AutoCompleteField` sets its border imperatively at runtime.
- **No change to `styleGroup`/`ensureStyleGroupRule`.** Confirmed unrelated and untouched throughout this plan.
- **No per-property trait sharing.** A class or instance either takes the whole trait or none of it — matching the "declared, not harvested" design's all-or-nothing simplicity.
- **No rule disposal for traits.** Like the framework, class, state, and group rules, a trait rule lives for the process.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^first-consumer-reverified]: Re-read from current source, not assumed from the deleted `cross-class-style-traits.md` draft: `border: "var(--ts-ui-input-border)"` and `borderRadius: "var(--ts-ui-border-radius, 4px)"` appear verbatim in `_defaultTextInputOptions` (TextInput.ts:73-74), `_defaultPickerFieldOptions` (AbstractPickerField.ts:48-49), `_defaultComboBoxOptions` (ComboBox.ts:86-87), and `_defaultFieldSetOptions` (FieldSet.ts:27-28) — unchanged from the deleted draft's own citations, confirming no drift since it was written. `Cell.ts:33` still declares a different token (`var(--ts-ui-table-cell-border, none)`) and stays excluded. Three of the four descend from `AbstractInput`, but `AbstractInput`'s other descendants (`Slider`, `NumberSpinner`, the boolean-input family, `FileField`, `FileDropZone`, `AutoCompleteField`, `AbstractSelectableList`) must not inherit the chrome, so hoisting into `AbstractInput.ownClassStyleDefaults` is not an option even though a common ancestor technically exists; `FieldSet` extends `Component` directly and has no shared ancestor with the other three at all. This is exactly the shape a trait is for.

[^why-declared-not-harvested]: The deleted `cross-class-shared-style-groups.md` harvested its content from whichever instance rendered first, and needed either a content-fingprinted DOM token or an explicit per-key "agreement check" against later callers to stay safe — because a runtime-computed value has no single source of truth to check against. A `StyleTrait`'s `declarations` is a plain object literal an author writes once; every caller passing the *same* `StyleTrait` object is trivially guaranteed to agree, because they are reading the same constant, not resolving independently at runtime. This removes the entire safety-machinery axis both prior drafts spent real design effort on.

[^why-pair-not-where]: A bare `.ts-ui-trait-<name>` at `(0,1,0)` would tie with `.ClassName`, decided by whichever class happens to render first in a given process — a screen that renders a `ComboBox` before a `TextField` would order the rules differently than one that renders them the other way round, so a class could unpredictably lose the ability to override its own trait depending on navigation history. Pairing with the universal `ts-ui-component` token (which the deleted shared-group draft used for exactly this reason) costs nothing — every rendered element already carries it — and removes the order-dependence entirely: `(0,2,0)` beats `(0,1,0)` regardless of stylesheet order.

[^picker-input-worked-example]: Traced against current code, not assumed. `PickerInput`'s constructor (`PickerInput.ts:46`) forwards `_defaultPickerInputOptions` as `subclassDefaults`, which reaches `applyOptions` → `applyChromeOptions`, where `options.border ?? this._defaultOptions.border` resolves to `"none"` (PickerInput's own default, untouched by this plan) and is dispatched to `setBorder("none")`, writing `_instanceStyle.border = "none"`. At flush time, `flushStyleBag` (Component.ts:5483) finds `border` is `declaredByInstance`, walks `layersBelowInstance()`, and — once this plan's `_classTraitLayers` seeding puts `TextInput`'s inherited `INPUT_CHROME_TRAIT` layer ahead of `_classLayer` in that array — finds the trait layer's resolved `border-top` (`var(--ts-ui-input-border)`) first, which differs from `"none"`, so `matchesLower` is `false` and a real declaration is queued for `#id`. No edit to `PickerInput.ts` is required.

[^state-specificity-proof]: `guardedSuffixFor(selector, specs, index)` (ClassStyleRules.ts:676) loops `for (let i = 0; i < index; i++)`, which runs zero times exactly when `index === 0` — the first (highest-priority) entry in a class's resolved `ownStyleStates` order. Confirmed against a real declaration: `Button.ownStyleStates` (Button.ts:394) declares `.pressed` first, so its real selector is the bare `.Button.pressed`, `(0,2,0)`. Every other index gets at least one `:not(...)` guard, and a `:not()` pseudo-class's specificity equals that of its argument — a class selector, `(0,1,0)` — so index `1` is at least `(0,3,0)`, index `2` at least `(0,4,0)`, and so on. No class can have two entries at index `0`, so at most one state per class can ever tie with a trait.

[^no-ownstylestates-on-consumers]: Confirmed by grep: none of `TextInput.ts`, `AbstractPickerField.ts`, `ComboBox.ts`, or `FieldSet.ts` declares `ownStyleStates`. The eighteen classes across the codebase that do declare it (`Button`, `ToggleButton`, `Checkbox`, `RadioButton`, `Toggle`, `SpinButton`, `TabButton`, `MenuBarButton`, `TabCloseButton`, `PickerButton`, `Scrollbar`, `AccordionHeader`, `AccordionIndicator`, `WindowBorder`, `DiagramNode`, `Tree`, `TreeRow`, `Body`, `Row`, `Cell`, `Header`) are unrelated to this plan's consumer set, so `traitTopStateConflictKeys` never returns a non-empty result for anything this plan ships.

[^framework-defaults-seed-reverified]: Same hazard the deleted draft identified, re-confirmed against current `resolveDeclarations`/`FRAMEWORK_DEFAULTS`/`FRAMEWORK_DECLARATIONS` (ClassStyleRules.ts:223, 153, 123): `resolveDeclarations`'s absent-key fallbacks coincide with `FRAMEWORK_DECLARATIONS` except `minSize` (fallback `"auto"` vs. framework's `"0px"`) and `overflow` (`"visible"` vs. `"hidden"`). Seeding with `FRAMEWORK_DEFAULTS` before resolving a trait's declarations is what keeps a trait that says nothing about either from "deviating" on four keys it has no opinion about.
