---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
  - ARCHITECTURE.md
  - packages/lib/docs/reference/changelog/next.md
---

# State-Tier Full Unification — Implementation Plan

## Overview

[`plans/implemented/layered-style-bag.md`](implemented/layered-style-bag.md) made a
component's style a stack of layers, and made toggle states (`.pressed`,
`.selected`, `:hover`, …) declarative through `ownStyleStates`. It did not
retire the older mechanism that does the same job: `Component.createStateStyleRule`
([core/Component.ts:1141](packages/lib/src/typescript/lib/core/Component.ts#L1141))
still hands out a `StateStyleRule`
([core/ClassStyleRules.ts:1273](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1273))
whose `.set()` / `.setMany()` write straight to a per-instance suffixed rule,
bypassing `writeStyle` / `_instanceStyle` / `resolveStyleValue` entirely.
Thirteen call sites still use it — twelve in components, plus
`Component.setValueStyleState` — and two of its consequences are visible today:
the shared `.Button.pressed` rule is written twice per process, and a selected
`TabButton` paints white from CSS while `getBackgroundColor()` reports
`ToggleButton`'s grey.[^two-symptoms]

This plan retires that second mechanism. `ownStyleStates` becomes
hierarchy-aware — a class's state rule is a delta against its nearest
ancestor's, the same shape `resolveClassLevel`
([core/ClassStyleRules.ts:519](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L519))
already gives the resting tier — which is the one thing `createStateStyleRule`
could do that `ownStyleStates` could not. A new per-instance **state layer**
gives `Button`'s `setPressedX` / `setHoverX` family and `ToggleButton`'s
`setSelectedX` family a real place in the layer stack, so a per-instance
pressed override resolves through `resolveStyleValue` like every other
property.

It also finishes a job an earlier plan left half-done.
[`plans/implemented/button-family-hierarchy-cascade.md`](implemented/button-family-hierarchy-cascade.md)
already made the Button family's class tier hierarchy-aware, but two leaf
classes — `MenuBarButton` and `TabCloseButton` — forward hoistable defaults
through `subclassDefaults` without declaring `ownClassStyleDefaults`, so their
own colours are silently replaced by `Button`'s.[^leaf-loss] `ARCHITECTURE.md`
and `getStyleClassChain`'s doc comment still describe that family as deferred,
which is no longer true.

The work lands in four stages: the leaf fix and doc correction first (it is
independent), then the hierarchy-aware state tier, then the instance state
layer, then the call-site migration that deletes the old API.

---

## Architecture Decisions

### The Button family's class tier is already hierarchy-aware — only two leaves and the docs are outstanding

`Button`, `TabButton` and `SpinButton` each declare `ownClassStyleDefaults`,
so `chainParticipates` returns true for the whole family and
`getStyleClassChain` already widens it.[^gap-b-shipped] The remaining work is
two `ownClassStyleDefaults` declarations (`MenuBarButton`, `TabCloseButton`)
and correcting two stale prose claims.

### `ownStyleStates` gains the per-level walk `ownClassStyleDefaults` already has

`resolveStyleStates` ([core/ClassStyleRules.ts:791](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L791))
today resolves to the nearest ancestor that declares a list and stops. It gains
a second walk, for content only: for each selector in the resolved order, every
level from the top of the chain down to `ctor` contributes
`extract(ownDefaultsOf(level))` merged over its parent's bag, and emits
`.LevelName<guardedSuffix>` carrying only its own delta.[^why-per-level]

Declared **order** still comes from one place — the nearest class in the chain
that declares a list, which is the resolving class itself when it declares one —
so the generated `:not(...)` guards cannot drift. Content now comes from every
level:

| Class | Own `ownStyleStates` | `.selected` rules emitted | `getBackgroundColor()` while `.selected` is active |
|---|---|---|---|
| `Button` | `.pressed`, `:hover` | none — no `.selected` entry | n/a: `Button` has no `.selected` state |
| `ToggleButton` | restates `Button`'s two, adds `.selected` | `.ToggleButton.selected:not(.pressed):not(:hover)` → the grey token | the grey token |
| `TabButton` | restates `ToggleButton`'s three, own `.selected` | `.TabButton.selected:not(.pressed):not(:hover)` → the white delta only | the white token |

The third row is what closes today's divergence: the CSS already paints white,
and the layer stack now agrees.

`resolveClassStateLevel`, `_stateLevels`, `StaticExtractor`,
`ResolvedClassStateLevel` and `ensureClassStateRule`'s `extractorMethodName`
parameter are deleted, along with the four
`extract…ClassDeclarations` / `get…ClassDeclarations` method pairs that fed
them — two on `Button` (pressed, hover), one on `ToggleButton`, one on
`TabButton`.

### A per-instance state override is a layer, written through `writeStateStyle`

`Component` gains `_instanceStateStyle` — one authored `StyleBag` per state
selector — plus `writeStateStyle(selector, patch)`, the state-tier twin of
`writeStyle`. It writes unconditionally; dedup against the class-tier state
layer happens at flush, exactly as `flushStyleBag`
([core/Component.ts:5166](packages/lib/src/typescript/lib/core/Component.ts#L5166))
does for the resting tier.[^flush-symmetry]

`styleLayers()` ([core/Component.ts:4891](packages/lib/src/typescript/lib/core/Component.ts#L4891))
pushes, for each active declared state in declared order, that state's
*instance* layer (when the instance has one) above its *class* layer:

| Button state | `_instanceStateStyle[".pressed"]` | `.pressed` class layer | `getBackgroundColor()` |
|---|---|---|---|
| not pressed | `{}` | (inactive) | resting value |
| pressed, no override | `{}` | `backgroundColor: var(--ts-ui-button-pressed-bg, …)` | the pressed token |
| pressed, `setPressedBackgroundColor("red")` | `backgroundColor: red` | `backgroundColor: var(…)` | `red` |

### The state accessors stay layer-specific, and keep their class-default fold

`getPressedBackgroundColor()` and its eleven siblings keep meaning "what does
this instance's pressed override declare" — not the effective painted value.
Each body becomes one `resolveStateStyleValue(selector, key)` call plus the
`?? this._defaultOptions.<prefixedField> ?? null` fold ARCHITECTURE.md's
*Class-level defaults must survive the getter* prescribes.[^why-fold] The
`_options.pressedX = value` write in each setter goes away — the instance state
layer is the single cache, mirroring how `layered-style-bag` moved
`backgroundColor` off `_options`.

### `pinStateStyle` is the named escape hatch for a write that must not dedupe

`Button.pinPressedToResting` ([component/button/Button.ts:2098](packages/lib/src/typescript/lib/component/button/Button.ts#L2098))
must write even when its value equals the class rule's, because its whole
purpose is to outrank that rule. It calls `pinStateStyle(selector, patch)`,
which caches into the same bag but queues the declarations verbatim — the same
split `cacheStyleValue` ([core/Component.ts:5021](packages/lib/src/typescript/lib/core/Component.ts#L5021))
already makes against `writeStyle`.[^pin-precedent]

### `ensureClassStateRule` survives as the shared-rule builder, reached through one protected wrapper

Three call sites use `createStateStyleRule` only to publish a shared
`.ClassName<suffix>` rule and never write per-instance: `Cell.focusedStyleRule`,
`TreeRow.focusedStyleRule`, and `Component.setValueStyleState`. They move to a
new `Component.ensureSharedStateRule(suffix, declarations)`, a one-line
forwarder to the existing `ensureClassStateRule`
([core/ClassStyleRules.ts:1059](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1059)).
That keeps the class-tier building block and removes the wrapper object, the
per-instance rule allocation, and the resolver thunk those sites never
used.[^focused-stays-out]

### `TabButton`'s selected border stays a per-instance write

`TabButton`'s own `.selected` entry carries `backgroundColor`,
`backgroundImage` and `shadow` only — the same three keys `ToggleButton`'s
entry carries. `TAB_BUTTON_SELECTED_BORDER` keeps going through
`setSelectedBorder`, so `restingIsolationKeys()`
([core/Component.ts:5339](packages/lib/src/typescript/lib/core/Component.ts#L5339))
does not grow border longhands and no resting `setBorder` on a tab changes
which rule it lands on.[^border-isolation]

---

## Public API

No consumer-facing signature changes. Every `Button` / `ToggleButton`
accessor keeps its exact signature; only the bodies change.

```typescript
// core/ClassStyleRules.ts

// Unchanged shapes, hierarchy-aware body:
export function resolveStyleStates(ctor: Function): readonly ResolvedStyleState[];

// `extractorMethodName` parameter removed:
export function ensureClassStateRule(
    ctor: Function,
    suffix: string,
    declarations: Record<string, string | null>,
): ResolvedStyleBag | null;

// Deleted: StateStyleRule, writeClassStateDeclaration,
// writeManyClassStateDeclarations, resolveClassStateLevel, StaticExtractor,
// ResolvedClassStateLevel, the module map `_stateLevels`.
```

```typescript
// core/Component.ts

/** This instance's own override bag for one declared state, and the CSS it resolves to. */
protected instanceStateLayer(selector: string): StyleLayer | null;

/** The class-tier layer `ownStyleStates` resolves for one declared state. */
protected classStateLayer(selector: string): StyleLayer | null;

/** Writes `patch` into this instance's own layer for `selector`; dedup happens at flush. */
protected writeStateStyle(selector: string, patch: StyleBag): void;

/** Like `writeStateStyle`, but queues every declaration verbatim — never deduped
 *  against the class-tier state layer. For a write whose purpose is to outrank it. */
protected pinStateStyle(selector: string, patch: StyleBag): void;

/** The first of [instance state layer, class state layer] whose authored bag
 *  contains `key`. Never falls through to the resting tiers. */
protected resolveStateStyleValue<K extends keyof StyleBag>(
    selector: string,
    key: K,
): NonNullable<StyleBag[K]> | null;

/** Drains the pending per-state CSS keys onto `#id<guardedSuffix>`. */
protected flushStateStyleBag(): void;

/** Ensures a shared `.ClassName<suffix>` rule carrying `declarations`. */
protected ensureSharedStateRule(selectorSuffix: string, declarations: Record<string, string | null>): void;

// Deleted: createStateStyleRule.
```

```typescript
// component/menubar/MenuBarButton.ts, component/button/TabCloseButton.ts
protected static readonly ownClassStyleDefaults: StyleBag;   // = the file's own _default*Options

// component/button/TabButton.ts
protected static readonly ownStyleStates: readonly StyleStateSpec[];
```

---

## Internal Structure

### `core/ClassStyleRules.ts` — the per-level state walk

`resolveStyleStates(ctor)` keeps its two-phase shape: first find the ordered
spec list (nearest ancestor declaring `ownStyleStates`, unchanged), then
resolve content per level.

```typescript
/** Per-selector resolved layers for one class level, keyed by the resolving
 *  class's own order signature (the selectors, joined) so two subclasses whose
 *  lists differ never share a cache entry — their guard suffixes differ too. */
const _stateLevelLayers: Map<Function, Map<string, ReadonlyMap<string, StyleLayer>>> = new Map();

function resolveStateLevels(
    rawCtor:   Function,
    order:     readonly StyleStateSpec[],
    signature: string,
): ReadonlyMap<string, StyleLayer> {
    // 1. Memo hit on (canonicalCtor(rawCtor), signature) -> return.
    // 2. Recurse into the canonicalized prototype parent (stop at `_rootCtor`)
    //    for the parent's map; `new Map()` at the top.
    // 3. own = ownStyleStatesOf(ctor); when absent or the name collides in
    //    `_owners`, memoize the parent's map unchanged and return it.
    // 4. For each spec in `own`:
    //      const index    = order.findIndex((s) => s.selector === spec.selector);
    //      if (index < 0) continue;                      // not in the resolving order
    //      const guarded  = guardedSuffixFor(spec.selector, order, index);
    //      const parentLayer = parentLayers.get(spec.selector);
    //      const authored = { ...parentLayer?.authored, ...spec.extract(ownDefaultsOf(ctor) ?? {}) };
    //      const resolved = resolvePartialDeclarations(authored);
    //      const delta    = deviationsFrom(resolved, parentLayer?.resolved ?? {});
    //      if (Object.keys(delta).length > 0) {
    //          _owners.set(ctor.name, ctor);
    //          new StyleRule({ scope: "class", name: ctor.name, suffix: guarded, styles: delta });
    //      }
    //      layers.set(spec.selector, { authored, resolved });
    // 5. Memoize and return.
}
```

`buildResolvedStates` ([core/ClassStyleRules.ts:816](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L816))
becomes a thin assembler over that map: for each spec in the resolving order it
returns `{ selector, guardedSuffix, layer }`, taking `layer` from
`resolveStateLevels(ctor, order, signature).get(selector) ?? { authored: {}, resolved: {} }`.
The name-collision opt-out keeps returning empty layers, unchanged.

Because the recursion resolves — and inserts — an ancestor's rule before a
descendant's, `.ToggleButton.selected:not(.pressed):not(:hover)` is always in
the stylesheet before `.TabButton.selected:not(.pressed):not(:hover)`, whichever
class renders first. That is the same guarantee `resolveClassLevel` gives the
resting tier.

### `core/Component.ts` — the instance state layer

```typescript
// state selector -> this instance's own authored overrides for that state.
private _instanceStateStyle : Map<string, StyleBag>   | null = null;
// state selector -> CSS keys `flushStateStyleBag` still owes a write.
private _pendingStateKeys   : Map<string, Set<string>> | null = null;
```

`writeStateStyle(selector, patch)`:

1. Merge `patch` into `_instanceStateStyle.get(selector)` (shallow, one level
   deep for `font`, matching `writeStyle`).
2. `this._resolvedCache = null;`
3. Add `Object.keys(resolvePartialDeclarations(patch))` to
   `_pendingStateKeys.get(selector)`.
4. When `getElement()` is truthy, call `flushStateStyleBag()`.

`flushStateStyleBag()`, for each pending `(selector, keys)` pair:

```typescript
const state = resolveStyleStates(this.constructor).find((s) => s.selector === selector);
if (!state) continue;                        // not a declared state — nothing to write

const rule       = this.createStyleRule(state.guardedSuffix);
const declared   = resolvePartialDeclarations(this._instanceStateStyle!.get(selector)!);
const classBag   = state.layer.resolved;
const queued: Record<string, string | null> = {};

for (const key of keys) {
    const value = declared[key] ?? null;
    queued[key] = (key in classBag && classBag[key] === value) ? null : value;
}

rule.setMany(queued);

if (this.getElement() && rule.hasQueuedDeclarations()) {
    rule.ensure();
}
```

The `null`-on-match branch is the behavioural difference from
`writeClassStateDeclaration`, which *skipped* on a match: a matching write now
clears whatever stale value the instance rule was holding, which is what lets
`Button._restoreChrome`'s four forced re-writes go.[^restore-chrome]

`pinStateStyle(selector, patch)` is the same body with the `classBag`
comparison removed — every key queues its real value.

`applyStyle` ([core/Component.ts:5551](packages/lib/src/typescript/lib/core/Component.ts#L5551))
seeds `_pendingStateKeys` with every key each instance state bag declares
(alongside its existing `_pendingStyleKeys` seeding) and calls
`flushStateStyleBag()` immediately after `flushStyleBag()`. The end-of-pass
`materialiseDeferredRules()` covers materialisation for a render pass.

`styleLayers()` gains one line inside its existing loop:

```typescript
for (const state of resolveStyleStates(this.constructor)) {
    if (this._activeStates.has(state.selector)) {
        const own = this.instanceStateLayer(state.selector);
        if (own) layers.push(own);
        layers.push(state.layer);
    }
}
```

`resolveStateStyleValue(selector, key)` walks only
`[instanceStateLayer(selector), classStateLayer(selector)]`, first bag
*containing* the key wins (presence, not truthiness — so a `clearX()` that
writes `null` suppresses the class token), memoized under the
`"state." + selector + "." + key` cache key in the existing `_resolvedCache`.

### `component/button/Button.ts` — the accessor shape

Every one of the twelve `pressed*` / `hover*` get/set/clear triples takes this
form. Only the selector, the `StyleBag` key, and the options field change:

```typescript
getPressedBackgroundColor(): string | null {
    return this.resolveStateStyleValue(".pressed", "backgroundColor")
        ?? this._defaultOptions.pressedBackgroundColor ?? null;
}

setPressedBackgroundColor(backgroundColor: string): this {
    this.writeStateStyle(".pressed", { backgroundColor });

    return this;
}

clearPressedBackgroundColor(): this {
    this.writeStateStyle(".pressed", { backgroundColor: this.getBackgroundColor() ?? "transparent" });

    return this;
}
```

`":hover"` is the selector for the hover family — the `:not(.pressed)` guard is
derived from `ownStyleStates`, never written by hand. The private
`_pressedBorder` / `_hoverBorder` fields are deleted; `getPressedBorder()`
returns `this.resolveStateStyleValue(".pressed", "border") as BorderOptions | null`.

---

## Ordered Implementation Steps

### Stage 1 — finish the Button family's resting tier

1. **`component/menubar/MenuBarButton.ts`** — add
   `protected static readonly ownClassStyleDefaults: StyleBag = _defaultMenuBarButtonOptions;`
   ([:26](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts#L26) is the constant;
   the class starts at [:66](packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts#L66)).
   Import the `StyleBag` type from `~/core/ClassStyleRules.js`.
2. **`component/button/TabCloseButton.ts`** — same, assigning
   `_defaultTabCloseButtonOptions` ([:25](packages/lib/src/typescript/lib/component/button/TabCloseButton.ts#L25)).
   The constructor's extra `glyph: "xmark"` key is not hoistable and is
   correctly absent from the static field.
3. **New test file** `packages/lib/tests/component/button/ButtonFamilyLeafDefaults.test.ts`
   covering Expected Behaviour rows 1–3.
   *Check:* `npx vitest run tests/component/button tests/component/menubar` from `packages/lib`.
4. **Add four rows to the default-resolution registry**
   ([tests/component/default-options-fallback.test.ts](packages/lib/tests/component/default-options-fallback.test.ts)),
   as ARCHITECTURE.md's *Class-level defaults must survive the getter*
   requires: `MenuBarButton backgroundColor`, `MenuBarButton foregroundColor`,
   `MenuBarButton cursor`, `TabCloseButton foregroundColor`. Each `resolve`
   must **render before reading** — `const b = new MenuBarButton('File', NOOP, NOOP); b.getElement(true); return b.getBackgroundColor();`
   — following the existing rendering rows in that file
   ([:196](packages/lib/tests/component/default-options-fallback.test.ts#L196)).
   A row that reads the getter without rendering passes even against the
   current defect: before first render the class tier falls back to a layer
   built straight from the class's own merged defaults, which still carries the
   right value.[^leaf-loss] The three colour rows fail before steps 1–2 and
   pass after; the `cursor` row is hygiene only, since `Button`'s own default
   happens to be `"pointer"` too.
5. **Correct the stale prose about the Button family.** In `ARCHITECTURE.md`,
   *The class tier is hierarchy-aware*: the sentence naming
   `Button`/`ToggleButton`/`TabButton`/`SpinButton`/`MenuButton`/`PopupButton`
   as keeping "their own independent flat `.ClassName` rule" and deferred to a
   follow-on plan is wrong — replace it with the current state (the family
   participates; a chain with no `ownClassStyleDefaults` anywhere still does not
   widen). Make the matching edit to `getStyleClassChain`'s doc comment
   ([core/ClassStyleRules.ts:978](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L978)),
   which repeats the same claim. The rest of `## Documentation Impact` waits
   for step 21.

### Stage 2 — hierarchy-aware `ownStyleStates`

6. **`core/ClassStyleRules.ts`** — add `_stateLevelLayers` and
   `resolveStateLevels` per `## Internal Structure`; rewrite
   `buildResolvedStates` ([:816](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L816))
   to assemble from it. Key `_resolvedStates` ([:753](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L753))
   by the **concrete** constructor rather than the declaring one, since two
   subclasses of one declaring class can now resolve different content.
   *Check:* `npm run typecheck`; `npx vitest run tests/core/StyleStates.test.ts` — green, unmodified.
7. **`component/button/TabButton.ts`** — declare
   `protected static readonly ownStyleStates: readonly StyleStateSpec[]`
   restating `ToggleButton.ownStyleStates`' first two entries and replacing
   `.selected` with an entry whose `extract` returns
   `{ backgroundColor: TAB_BUTTON_SELECTED_FILL.backgroundColor, backgroundImage: TAB_BUTTON_SELECTED_FILL.backgroundImage, shadow: TAB_BUTTON_SELECTED_FILL.boxShadow }`.
   Keep the selector order identical to `ToggleButton`'s.
8. **Delete the extractor plumbing.** Remove
   `extractPressedClassDeclarations` / `getPressedClassDeclarations`
   ([button/Button.ts:693](packages/lib/src/typescript/lib/component/button/Button.ts#L693), [:706](packages/lib/src/typescript/lib/component/button/Button.ts#L706)),
   `extractHoverClassDeclarations` / `getHoverClassDeclarations`
   ([:720](packages/lib/src/typescript/lib/component/button/Button.ts#L720), [:725](packages/lib/src/typescript/lib/component/button/Button.ts#L725)),
   `ToggleButton.extractSelectedClassDeclarations` / `getSelectedClassDeclarations`
   ([button/ToggleButton.ts:84](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L84), [:95](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L95)),
   and `TabButton`'s overrides of the last pair
   ([button/TabButton.ts:288](packages/lib/src/typescript/lib/component/button/TabButton.ts#L288), [:297](packages/lib/src/typescript/lib/component/button/TabButton.ts#L297)).
   Drop the third argument from the three `createStateStyleRule` calls that pass
   an extractor name ([Button.ts:631](packages/lib/src/typescript/lib/component/button/Button.ts#L631),
   [Button.ts:644](packages/lib/src/typescript/lib/component/button/Button.ts#L644),
   [ToggleButton.ts:70](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L70)),
   replacing each `resolveDefaults` thunk with `() => ({})` for now — steps 13
   and 15 delete the calls entirely.
9. **`core/ClassStyleRules.ts`** — delete `ResolvedClassStateLevel`
   ([:573](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L573)),
   `StaticExtractor` ([:582](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L582)),
   `_stateLevels` ([:588](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L588)),
   `resolveClassStateLevel` ([:617](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L617)),
   and `ensureClassStateRule`'s `extractorMethodName` parameter and its
   delegation branch ([:1065](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1065)).
   Drop the parameter from `StateStyleRule`'s constructor and from
   `Component.createStateStyleRule` too.
   *Check:* `grep -rn 'resolveClassStateLevel\|extractorMethodName\|ClassDeclarations' packages/lib/src` — zero.
10. **Rewrite** `packages/lib/tests/core/ClassStateHierarchyCascade.test.ts`
    against `ownStyleStates` instead of `createStateStyleRule` + extractor
    names, preserving its seven cases (they map one-for-one onto Expected
    Behaviour rows 4–6 and their siblings). Add Expected Behaviour rows 7–9
    to it.
    *Check:* `npx vitest run --no-file-parallelism` from `packages/lib`. Expect
    failures only in `tests/component/table/cell/Header.test.ts` (row 9 moves
    three rules from `.HeaderCell…` to `.Cell…`) and
    `tests/component/button/TabButton.stateClassHoisting.test.ts`; update those
    assertions to the new selectors.

### Stage 3 — the per-instance state layer

11. **`core/Component.ts`** — add `_instanceStateStyle`, `_pendingStateKeys`,
    `instanceStateLayer`, `classStateLayer`, `writeStateStyle`, `pinStateStyle`,
    `resolveStateStyleValue`, `flushStateStyleBag`, and `ensureSharedStateRule`
    per `## Internal Structure` and `## Public API`; extend `styleLayers()`
    ([:4891](packages/lib/src/typescript/lib/core/Component.ts#L4891))
    and `applyStyle` ([:5551](packages/lib/src/typescript/lib/core/Component.ts#L5551)).
    `setStyleState` ([:5395](packages/lib/src/typescript/lib/core/Component.ts#L5395))
    already clears `_resolvedCache`; no change there. `createStateStyleRule`
    stays for now — step 19 removes it, once no caller is left.
12. **New test file** `packages/lib/tests/core/InstanceStateLayer.test.ts`
    covering Expected Behaviour rows 10–16.
    *Check:* `npx vitest run tests/core/InstanceStateLayer.test.ts`.
13. **Migrate `Button`'s twelve accessor triples**
    ([:2441](packages/lib/src/typescript/lib/component/button/Button.ts#L2441)–[:2879](packages/lib/src/typescript/lib/component/button/Button.ts#L2879))
    to the shape in `## Internal Structure`. Delete `_pressedStyleRule` /
    `pressedStyleRule` / `_pressedBorder` ([:629](packages/lib/src/typescript/lib/component/button/Button.ts#L629)–[:633](packages/lib/src/typescript/lib/component/button/Button.ts#L633))
    and `_hoverStyleRule` / `hoverStyleRule` / `_hoverBorder`
    ([:642](packages/lib/src/typescript/lib/component/button/Button.ts#L642)–[:646](packages/lib/src/typescript/lib/component/button/Button.ts#L646)).
    Selector strings: `".pressed"` and `":hover"` — never a hand-written guard.
14. **Migrate `Button`'s four internal chrome paths.**
    `_clearChrome` ([:1991](packages/lib/src/typescript/lib/component/button/Button.ts#L1991)):
    replace the `this._pressedStyleRule !== undefined` /
    `this._hoverStyleRule !== undefined` guards with
    `this.instanceStateLayer(".pressed") !== null` / `(":hover") !== null`.
    `_restoreChrome` ([:2028](packages/lib/src/typescript/lib/component/button/Button.ts#L2028)):
    delete the four `this.createStyleRule(".pressed").set(…)` lines and the
    comment above them.[^restore-chrome]
    `pinPressedToResting` ([:2098](packages/lib/src/typescript/lib/component/button/Button.ts#L2098)):
    read `this.classStateLayer(".pressed")?.resolved`, build one `StyleBag`
    gated on each CSS key's presence in it (`color` → `foregroundColor`,
    `backgroundColor`, `backgroundImage`, `boxShadow` → `shadow`), and pass it
    to `pinStateStyle(".pressed", patch)`.
    `_applyFlatChrome` ([:2221](packages/lib/src/typescript/lib/component/button/Button.ts#L2221)):
    no edit — it calls the migrated setters.
    *Check:* `npx vitest run tests/component/button` — `Button.pressedState.test.ts`,
    `Button.restingChromeIsolation.test.ts` and `Button.pressedHoverClassHoisting.test.ts`
    are the three that pin these paths.
15. **Migrate `ToggleButton` and `TabButton`.** `ToggleButton`'s four
    `setSelectedX` setters ([:235](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L235), [:251](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L251), [:265](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L265), [:281](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L281))
    become `writeStateStyle(".selected", { … })`; delete `_selectedStyleRule`,
    `selectedStyleRule`, `selectedGuardedSuffix`
    ([:68](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L68)–[:75](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L75))
    and the `void this.selectedStyleRule;` warm line in the constructor.
    In `TabButton.applyTabStyling` ([:270](packages/lib/src/typescript/lib/component/button/TabButton.ts#L270)),
    delete the three `setSelectedBackgroundColor` / `setSelectedBackgroundImage` /
    `setSelectedShadow` calls — step 7's class-tier entry now supplies them —
    and keep `setHoverBorder` and `setSelectedBorder`.
    *Check:* `npx vitest run tests/component/button` and `npm run typecheck`.

### Stage 4 — the remaining call sites

16. **Delete the seven redundant re-writes** — each writes the exact bag its own
    `ownStyleStates` entry already publishes on the shared class rule, so the
    write is a no-op after `StateStyleRule`'s dedup and nothing replaces it.
    Delete the state-rule getter, its backing slot, and the matching
    `get…ClassDeclarations` resolver at each site:

    | File | Delete |
    |---|---|
    | [`component/input/Checkbox.ts`](packages/lib/src/typescript/lib/component/input/Checkbox.ts) | `selectedStyleRule` / `indeterminateStyleRule` / `guardedSuffixFor` ([:74](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L74)–[:87](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L87)), both resolvers ([:92](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L92), [:99](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L99)), and `applyState`'s two `setMany` branches ([:139](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L139)) |
    | [`component/input/RadioButton.ts`](packages/lib/src/typescript/lib/component/input/RadioButton.ts) | `selectedStyleRule` ([:58](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L58)), `getSelectedClassDeclarations` ([:67](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L67)), `applyState`'s `setMany` ([:85](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L85)) |
    | [`component/container/Scrollbar.ts`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts) | `disabledStyleRule` ([:192](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L192)) + `getDisabledClassDeclarations` ([:200](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L200)) + the `set` in `setDisabledState` ([:347](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L347)); `hoverStyleRule` ([:442](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L442)) + `getHoverClassDeclarations` ([:454](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L454)) + the `set` in `applyHoverState` ([:467](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L467)) |
    | [`component/container/WindowBorder.ts`](packages/lib/src/typescript/lib/component/container/WindowBorder.ts) | `snapTargetStyleRule` ([:106](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L106)) and the constructor's `set` ([:142](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L142)) |
    | [`component/table/cell/Header.ts`](packages/lib/src/typescript/lib/component/table/cell/Header.ts) | `activeStyleRule` / `activeGuardedSuffix` ([:202](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L202)–[:212](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L212)) and the constructor's `set` ([:241](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L241)) |
    | [`component/diagram/DiagramNode.ts`](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts) | only the `backgroundColor` line of the constructor's pair ([:112](packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts#L112)); keep `selectedStyleRule` and its `borderColor` write — `borderColor` has no `StyleBag` key |
    | [`overlay/RailHandle.ts`](packages/lib/src/typescript/lib/overlay/RailHandle.ts) | `_selectedRule` / `selectedRule` ([:61](packages/lib/src/typescript/lib/overlay/RailHandle.ts#L61)) and the constructor's `selectedRule.set` ([:83](packages/lib/src/typescript/lib/overlay/RailHandle.ts#L83)); keep `railHoverRule` untouched |

    Nothing needs to warm the shared rules these deletions drop: `applyStyle`
    calls `styleLayers()` and `restingIsolationKeys()`, both of which run
    `resolveStyleStates` and therefore register every declared state's rule at
    first render.
    *Check after each file:* `npm run typecheck` and that file's own tests.
17. **Update the six state-hoisting test files** whose assertions name a
    deleted getter or a `.set()` call: `Checkbox.stateClassHoisting.test.ts`,
    `RadioButton.stateClassHoisting.test.ts`,
    `WindowBorder.classStateHoisting.test.ts`, `Scrollbar.test.ts`,
    `ScrollbarArrow.test.ts`, and `Header.test.ts`. The class-rule assertions
    stay; only the ones reaching for the retired per-instance wrapper go.
18. **Re-point the three shared-rule-only sites** onto `ensureSharedStateRule`:
    `Cell.focusedStyleRule` ([component/table/cell/Cell.ts:105](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L105)) and its
    `void this.focusedStyleRule;` warm ([:156](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L156)) collapse into one
    `this.ensureSharedStateRule(".focused", { outline: …, outlineOffset: "-1px" });`
    constructor call; the same for `TreeRow`
    ([component/tree/TreeRow.ts:71](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L71), [:94](packages/lib/src/typescript/lib/component/tree/TreeRow.ts#L94));
    and `Component.setValueStyleState`
    ([core/Component.ts:5475](packages/lib/src/typescript/lib/core/Component.ts#L5475))
    replaces its `createStateStyleRule(…).setMany(declarations)` with
    `this.ensureSharedStateRule("." + token, declarations)`.
19. **Delete the old API, now that no caller is left.**
    `core/Component.ts`: `createStateStyleRule`
    ([:1141](packages/lib/src/typescript/lib/core/Component.ts#L1141)) and its
    `StateStyleRule` import.
    `core/ClassStyleRules.ts`: `StateStyleRule`
    ([:1273](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1273)),
    `writeClassStateDeclaration` ([:1236](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1236)),
    `writeManyClassStateDeclarations` ([:1250](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1250)).
    *Check:* `grep -rn 'createStateStyleRule\|StateStyleRule\|writeClassStateDeclaration\|writeManyClassStateDeclarations' packages/lib/src` — zero.
20. **Prune the dead core tests.** In
    `packages/lib/tests/core/ClassStateRules.test.ts`, cases 7–12 exercise
    `createStateStyleRule` / `StateStyleRule` directly and are deleted; cases
    1–6 exercise `ensureClassStateRule`'s shared-rule path and are re-pointed
    at `ensureSharedStateRule`. Do the same for the three `Button` /
    `TabButton` hoisting test files
    (`Button.pressedHoverClassHoisting.test.ts`,
    `TabButton.stateClassHoisting.test.ts`,
    `TextLineHeightValueClassSharing.test.ts`).
    *Check:* `npx vitest run --no-file-parallelism` from `packages/lib` — the
    whole suite green.
21. **Docs.** Apply the remaining `## Documentation Impact` items — step 5
    already did the first `ARCHITECTURE.md` bullet.
    *Check:* `npm run docs:api` — zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/ToggleButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabCloseButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/menubar/MenuBarButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/RadioButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/WindowBorder.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/TreeRow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/RailHandle.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/tests/core/ClassStateHierarchyCascade.test.ts` |
| Modify | `packages/lib/tests/core/ClassStateRules.test.ts` |
| Modify | `packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts` |
| Modify | `packages/lib/tests/component/button/TabButton.stateClassHoisting.test.ts` |
| Modify | `packages/lib/tests/component/input/Checkbox.stateClassHoisting.test.ts` |
| Modify | `packages/lib/tests/component/input/RadioButton.stateClassHoisting.test.ts` |
| Modify | `packages/lib/tests/component/container/WindowBorder.classStateHoisting.test.ts` |
| Modify | `packages/lib/tests/component/container/Scrollbar.test.ts` |
| Modify | `packages/lib/tests/component/container/ScrollbarArrow.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/Header.test.ts` |
| Modify | `packages/lib/tests/component/input/TextLineHeightValueClassSharing.test.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Create | `packages/lib/tests/component/button/ButtonFamilyLeafDefaults.test.ts` |
| Create | `packages/lib/tests/core/InstanceStateLayer.test.ts` |

---

## Expected Behaviour

Rows 1–20 are unit-testable with the `installTestDOM` / `RecordingDOMSink`
harness and the `declarationsDuring` helper in `tests/core/ClassStyleRules.test.ts`.
Row 21 is manual-verify.

**Stage 1 — the Button family's leaves**

1. A `MenuBarButton` reports `getBackgroundColor()` as
   `var(--ts-ui-menu-bar-btn-bg, transparent)` and `getForegroundColor()` as
   `var(--ts-ui-menu-bar-btn-fg, inherit)` **both before and after** its first
   render. (Today the post-render answers are `var(--ts-ui-button-bg, transparent)`
   and `var(--ts-ui-text-color, black)`.)
2. A `TabCloseButton` reports `getForegroundColor()` as
   `var(--ts-ui-close-button-fg, #555)` after its first render.
3. `getStyleClassChain(TabButton)` is `["Button", "ToggleButton", "TabButton"]`
   and `getStyleClassChain(MenuBarButton)` is `["Button", "MenuBarButton"]`.

**Stage 2 — hierarchy-aware `ownStyleStates`**

4. Probe chain `A → B → C`, all three declaring `ownClassStyleDefaults`, only
   `A` declaring `ownStyleStates` with an `.on` entry: `.A.on` is created; no
   `.B.on` or `.C.on` rule exists, and a rendered `C` writes nothing to
   `#id.on`.
5. `C` additionally declares its own list (same order) whose `.on` extract
   deviates from `A`'s on one key: `.C.on` is created carrying **only** that
   key, and `.A.on`'s `ensureStyleRule` op is recorded before `.C.on`'s
   regardless of which class renders first.
6. `C`'s `.on` extract returning `A`'s exact bag: no `.C.on` rule is created.
7. A selected `TabButton` reports `getBackgroundColor()` as
   `var(--ts-ui-tab-button-selected-bg, rgb(255, 255, 255))`. (Today it reports
   `var(--ts-ui-toggle-selected-bg, rgb(200, 200, 200))` while the CSS paints
   white.)
8. Constructing and rendering one `Button` produces exactly **one**
   `setRuleStyles` op for `.Button.pressed`. (Today it produces two identical
   ops.)
9. A rendered `HeaderCell` has no `.HeaderCell.rangeSelected…`,
   `.HeaderCell.readOnly…` or `.HeaderCell.requiredEmpty…` rule — the matching
   `.Cell…` rules supply them — while
   `.HeaderCell:active:not(.rangeSelected):not(.readOnly):not(.requiredEmpty)`
   still exists and carries `boxShadow`.

**Stage 3 — the instance state layer**

10. `setPressedBackgroundColor("red")` on a default `Button` writes
    `backgroundColor: "red"` to `#id.pressed`, and
    `getPressedBackgroundColor()` returns `"red"`.
11. `setPressedBackgroundColor(<the class token>)` on a default `Button` writes
    `backgroundColor: null` to `#id.pressed`. (Today it writes nothing, leaving
    any earlier value on that rule in place.)
12. A `Button` with `setPressedBackgroundColor("red")` reports
    `getBackgroundColor()` as `"red"` while `.pressed` is active, and as its
    resting value otherwise.
13. `clearPressedBackgroundColor()` writes the instance's current resting
    background to `#id.pressed`, and `getPressedBackgroundColor()` then reports
    that same pinned value.
14. A `new Button({ chromeless: true })` has an `#id.pressed` rule carrying
    real values for every CSS key `.Button.pressed` declares — `color`,
    `backgroundColor`, `backgroundImage`, `boxShadow` — each equal to this
    instance's resting value.
15. `getHoverShadow()` on a freshly constructed default `Button` returns
    `var(--ts-ui-button-hover-shadow, 1px 3px 6px 0 rgba(0, 0, 0, 0.25))`, and
    `getHoverBackgroundColor()` on a `TabButton` returns
    `var(--ts-ui-tab-button-hover-bg, #c4c4cf)`.
16. `setPressedBorder("1px solid red")` writes the four border longhands to
    `#id.pressed`; `getPressedBorder()` returns `{ border: "1px solid red" }`;
    `clearPressedBorder()` writes four `null` longhands and `getPressedBorder()`
    returns `null`.

**Stage 4 — the migrated call sites**

17. `CheckboxBox.applyState(true, false)` adds the `selected` DOM token and
    writes **nothing** to any `#id` rule; the declarations live only on
    `.CheckboxBox.selected:not(.indeterminate)`.
18. Rendering a `Cell` records one `ensureStyleRule` op for `.Cell.focused`
    carrying `outline` and `outline-offset`, and no `ensureStyleRule` op for
    any `#<id>.focused` selector. The same holds for `TreeRow`.
19. Two `Text` instances of one concrete class set to the same numeric
    line-height still share one `.ClassName.lh<value>` rule and carry the token
    on their elements.
20. Both grep invariants in `## Verification` return nothing:
    `resolveClassStateLevel\|extractorMethodName\|ClassDeclarations` and
    `createStateStyleRule\|StateStyleRule\|writeClassStateDeclaration\|writeManyClassStateDeclarations`,
    each over `packages/lib/src`.

**Manual verification** (`npm run dev` from this worktree on a spare port)

21. The demo app's routes are `slugify()`'d tab labels
    ([src/typescript/main.ts:54](packages/lib/src/typescript/main.ts#L54)), so the
    ones to exercise are: `#/misc` (plain `Button`, `SpinButton`, `Checkbox`,
    `RadioButton`, and the `Table` / `Tree` demos — read-only, required,
    range-selected and keyboard-focused cells), `#/tab` (select a tab, press it
    while selected, hover it, hover an unselected one, and its close ✕),
    `#/menubar` (a `MenuBarButton`'s resting and hover fill), `#/diagram` (a
    selected node's border and fill), and `#/style-audit`. Every state must
    paint as before, `MenuBarButton` and `TabCloseButton` must regain their own
    colours, and the total stylesheet size must not grow.

---

## Verification

Run from the repo root unless noted.

- `npm run typecheck` — after every step.
- `npm test` from `packages/lib` (`typecheck:test` + `vitest run`). Baseline at
  the time of writing: **334 files, 5204 tests, all green**. This suite is the
  primary regression net — `Button` and its family are among the most
  instantiated classes in the library.
- `npm run lint` and `npm -w packages/lib run test:lint` — the
  `local/no-raw-dom` baseline is empty and must stay so.
- `npx vitest run tests/component/default-options-fallback.test.ts` from
  `packages/lib` — the mechanical class-default registry, which step 4 widens
  by four rows. It covers `MenuBarButton`'s `chromeless` / `insets` and
  `TabCloseButton`'s `glyph` / `preferredSize` today, and none of the four
  colour fields this plan repairs.
- Grep invariants, in order:
  - after step 9: `grep -rn 'resolveClassStateLevel\|extractorMethodName\|ClassDeclarations' packages/lib/src` — zero.
  - after step 15: `grep -n '_options.pressed\|_options.hover' packages/lib/src/typescript/lib/component/button/Button.ts` — matches only `applyChromeOptions`' dispatch reads, never a setter's cache write.
  - after step 19: `grep -rn 'createStateStyleRule\|StateStyleRule\|writeClassStateDeclaration\|writeManyClassStateDeclarations' packages/lib/src` — zero.
- `npm run docs:api` — must finish with zero warnings.
- **Manual browser verification is required** (row 21). The offline harness
  records writes; it does not run a CSS cascade, and this plan's whole subject
  is which rule wins. Start a second dev server from *this worktree* on a spare
  port — never reuse the user's — and symlink `node_modules` first so the app
  resolves this tree's `packages/lib`, not the main tree's. Read computed
  styles, forcing `:hover` / `.pressed` through DevTools; screenshots cannot
  distinguish a working cascade from a broken one.

---

## Documentation Impact

No exported symbol is added or removed — every new member is `protected` or
module-internal, and `excludeProtected: true` keeps them out of the generated
API docs. `typedoc.json`, the barrels and `packages/lib/llms.txt` are unaffected.

- **`ARCHITECTURE.md`**, three edits:
  - *The class tier is hierarchy-aware*: replace the stale claim that
    `Button`/`ToggleButton`/`TabButton`/`SpinButton`/`MenuButton`/`PopupButton`
    keep independent flat rules and are deferred to a follow-on plan (step 5).
    State instead that the family participates, and that the gate
    (`chainParticipates`) exists for chains that opt in nowhere.
  - Same section: `ownStyleStates` is now a per-level merge for *content* while
    staying a whole-list declaration for *order*; a subclass that changes one
    state restates the list and overrides that entry, and gets a delta rule.
  - *Component CSS tiers and state-rule dedup*: delete the paragraph describing
    `createStateStyleRule` as the mechanism for per-instance state overrides,
    and describe `writeStateStyle` / `resolveStateStyleValue` in its place.
    Keep the `Cell` / `TreeRow` `.focused` carve-out paragraph, re-pointed at
    `ensureSharedStateRule`.
- **`packages/lib/docs/reference/changelog/next.md`** — under `## Fixed` →
  `### Components`: `MenuBarButton` and `TabCloseButton` regain their own
  background / foreground tokens (Expected Behaviour rows 1–2), and a selected
  `TabButton` now reports its own fill from `getBackgroundColor()` (row 7).
  Under `## Changed` → `### Core`: a per-instance state override
  (`setPressedX` / `setHoverX` / `setSelectedX`) now resolves through the layer
  stack, so `getBackgroundColor()` on a pressed button reports the override
  (row 12); a state override written at the class-tier value now emits a
  removal rather than nothing (row 11); and `getPressedBackgroundColor()` after
  `clearPressedBackgroundColor()` reports the pinned resting value rather than
  the class default (row 13).
- No `packages/lib/docs/concepts/` page documents the tier mechanism
  (`grep -rln 'ownStyleStates\|StateStyleRule' packages/lib/docs` matches only
  changelog entries), so none needs editing.

---

## Potential Challenges

- **Deleting a redundant write can silently delete the rule with it.** Seven of
  the Stage 4 deletions relied on the deleted getter to *allocate* the shared
  class rule. `applyStyle` re-registers every declared state through
  `resolveStyleStates`, but confirm per file that the class rule still appears
  in the sink before moving on — that is what Expected Behaviour row 17 pins.
- **`_resolvedStates` re-keying changes memory behaviour.** Keying by concrete
  constructor instead of declaring class means one array per component class
  rather than one per declaring class. That is the same shape `_levels` and
  `_classChains` already have, so the ceiling is unchanged, but the cache key
  must be canonicalized (`canonicalCtor`) or a `callable()` wrapper and its raw
  class split into two entries — the defect
  `class-hierarchy-cascade.md`'s Implementation Note 3 records.
- **`HeaderCell`'s three state rules move to `.Cell`.** Two assertions in
  `tests/component/table/cell/Header.test.ts` name `.HeaderCell`-scoped
  selectors and must be re-pointed. Verify a read-only header cell still tints
  in the browser, since the rules now match through the widened DOM class
  chain rather than the leaf's own name.
- **`Button` is instantiated everywhere.** Do steps 13–15 as three separate
  commits and run the full suite between them; a wrong selector string in one
  accessor is invisible to the typechecker.
- **The `applyChromeOptions` dispatch reads a getter it is about to write.**
  `setPressedForegroundColor(options.X ?? this.getPressedForegroundColor()!)`
  ([Button.ts:1117](packages/lib/src/typescript/lib/component/button/Button.ts#L1117))
  runs before the instance layer holds anything, so the getter's
  `?? this._defaultOptions.pressedForegroundColor` fold is load-bearing, not
  belt-and-braces. Do not simplify it away.

---

## Critical Files

| File | Why |
|---|---|
| [`plans/implemented/layered-style-bag.md`](implemented/layered-style-bag.md) | The mechanism this plan extends. Its `## Architecture Decisions` (unconditional write, dedup at flush, key-presence resolution) are the contract every new member here must match; its `## Non-Goals` list the ~20 properties that stay off the layer stack. |
| [`plans/implemented/class-hierarchy-cascade.md`](implemented/class-hierarchy-cascade.md) | The per-level walk Stage 2 mirrors. Its Implementation Notes 3 and 5 are the two traps (callable-vs-raw constructor keys; a leaf that forwards `subclassDefaults` without registering a static field) that Stage 1 and Stage 2 both re-encounter. |
| [`plans/implemented/button-family-hierarchy-cascade.md`](implemented/button-family-hierarchy-cascade.md) | What already shipped for the Button family, and the `resolveClassStateLevel` design Stage 2 replaces. |
| [core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) | `resolveClassLevel` ([:519](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L519)) is the shape to mirror; `resolveStyleStates` ([:791](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L791)) / `buildResolvedStates` ([:816](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L816)) are what changes; `guardedSuffixFor` ([:739](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L739)) and `canonicalCtor` ([:409](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L409)) are reused verbatim. |
| [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) | `writeStyle` ([:4986](packages/lib/src/typescript/lib/core/Component.ts#L4986)), `flushStyleBag` ([:5166](packages/lib/src/typescript/lib/core/Component.ts#L5166)) and `cacheStyleValue` ([:5021](packages/lib/src/typescript/lib/core/Component.ts#L5021)) are the three bodies the new state-tier members are modelled on, line for line. |
| [component/button/Button.ts](packages/lib/src/typescript/lib/component/button/Button.ts) | The largest migration, and the source of every chrome-mode interaction (`applyChromeOptions` [:1026](packages/lib/src/typescript/lib/component/button/Button.ts#L1026), `_clearChrome` [:1991](packages/lib/src/typescript/lib/component/button/Button.ts#L1991), `_restoreChrome` [:2028](packages/lib/src/typescript/lib/component/button/Button.ts#L2028), `pinPressedToResting` [:2098](packages/lib/src/typescript/lib/component/button/Button.ts#L2098), `_applyFlatChrome` [:2221](packages/lib/src/typescript/lib/component/button/Button.ts#L2221)). |
| [tests/core/ClassStyleRules.test.ts](packages/lib/tests/core/ClassStyleRules.test.ts) | The `declarationsDuring` helper and the unique-probe-class-name discipline every new test must follow. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | *Component CSS tiers and state-rule dedup*, *The class tier is hierarchy-aware*, *Three non-negotiable rules for every DOM write*, *Class-level defaults must survive the getter*. |

---

## Non-Goals

- **The ~20 properties `layered-style-bag.md`'s own `## Non-Goals` exclude**
  (`transform`, `opacity`, `zIndex`, `transition`, `willChange`,
  `pointerEvents`, `writingMode`, `touchAction`, `contain`, `animation`,
  `appearance`, `borderImage`, `clipPath`, `colorScheme`, the `background`
  shorthand, `verticalAlign`, `insets`, the geometry fields) stay off the layer
  stack. This plan neither adds nor moves any of them.
- **`Component.createStyleRule` stays.** It is the documented low-level
  allocator for a suffixed per-instance rule whose property no `StyleBag` key
  covers — `AccordionIndicator`'s `.expanded` `transform`, `DiagramNode`'s
  `.selected` `borderColor`, `RailHandle`'s `:hover:not(.selected)`,
  `CollapseButton`, `Panel`'s webkit-scrollbar rule. Only `createStateStyleRule`
  and its wrapper are retired.
- **Hoisting `Button`'s hover chrome onto a shared class rule.** The `:hover`
  entry in `Button.ownStyleStates` keeps declaring nothing, so every hover
  declaration stays on the instance's own `#id:hover:not(.pressed)` rule. A
  chromeless button's resting background reaches the bare `#id` rule through
  `cacheStyleValue` — which writes no CSS at all — so a class-tier hover rule
  at `(0,3,0)` would newly paint under it.[^no-hover-hoist]
- **`Cell` / `TreeRow`'s `.focused` joining `ownStyleStates`.** It shares no
  property with the other declared states, and `guardedSuffixFor` guards
  unconditionally — folding it in would suppress a read-only cell's tint, the
  defect `layered-style-bag.md`'s Implementation Notes already record. It keeps
  its own unguarded shared rule.
- **Widening `restingIsolationKeys` with `TabButton`'s selected border.** See
  the matching Architecture Decision.
- **`Component.setStyleGroup` / the group tier.** Untouched.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^two-symptoms]: Both confirmed against the live tree with the recording sink.
    **One:** constructing and rendering a single `Button`-family instance
    produces two identical
    `setRuleStyles` ops for `.Button.pressed` — one from `buildResolvedStates`
    (via `ownStyleStates`) and one from `resolveClassStateLevel` (via
    `createStateStyleRule`'s `extractorMethodName` path). Both write the same
    four declarations to the same `StyleRule` object, which `StyleTarget`'s
    selector cache dedupes into one rule, so the cost is wasted work rather
    than a wrong rule. **Two:** a `TabButton` with `setSelected(true)` emits
    `.TabButton.selected:not(.pressed):not(:hover)` carrying
    `var(--ts-ui-tab-button-selected-bg, rgb(255, 255, 255))` (from
    `resolveClassStateLevel`, which walks the hierarchy) while
    `getBackgroundColor()` returns
    `var(--ts-ui-toggle-selected-bg, rgb(200, 200, 200))` (from
    `resolveStyleStates`, which stops at the nearest declaring ancestor,
    `ToggleButton`). The CSS is right and the JS is wrong, and the two cannot
    be reconciled without giving one mechanism the other's hierarchy walk.

[^leaf-loss]: Confirmed against the live tree. A rendered `MenuBarButton`
    reports `getBackgroundColor()` as `var(--ts-ui-button-bg, transparent)` and
    `getForegroundColor()` as `var(--ts-ui-text-color, black)` — `Button`'s
    tokens — where before its first render (when `styleLayers()` still uses the
    `getClassStyleDefaults()` virtual layer) it correctly reports
    `var(--ts-ui-menu-bar-btn-bg, transparent)` and
    `var(--ts-ui-menu-bar-btn-fg, inherit)`. No `.MenuBarButton` rule is
    inserted at all, and its `#id` rule carries no `backgroundColor` or `color`,
    so `.Button`'s class rule paints it. `TabCloseButton` loses
    `foregroundColor: var(--ts-ui-close-button-fg, #555)` the same way. The
    cause is `resolveClassLevel`'s pass-through for a class with no own
    `ownClassStyleDefaults`: it reports the parent's level, and unlike the
    non-participating path it never reads the caller-supplied (instance-derived)
    `defaults` where a `subclassDefaults`-forwarded value actually lives —
    exactly the failure mode `class-hierarchy-cascade.md`'s Implementation
    Note 5 documents and swept for its own eight chains. A static sweep of
    every `_default*Options` constant carrying a hoistable key, in a class whose
    chain participates and which declares no `ownClassStyleDefaults`, found
    these two and no others.

[^gap-b-shipped]: `plans/implemented/button-family-hierarchy-cascade.md` is in
    `plans/implemented/`, `Button.ownClassStyleDefaults` is declared at
    [Button.ts:306](packages/lib/src/typescript/lib/component/button/Button.ts#L306),
    `TabButton`'s at [:166](packages/lib/src/typescript/lib/component/button/TabButton.ts#L166),
    `SpinButton`'s at [:71](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L71),
    and `getStyleClassChain` returns `["Button", "ToggleButton", "TabButton"]`
    for a live `TabButton` and `["Button", "MenuButton"]` for a `MenuButton`
    (both verified). `MenuButton` and `PopupButton` do extend `Button`
    (`component/button/MenuButton.ts:50`, `component/button/PopupButton.ts:52`)
    and inherit the widening with no field of their own, which is correct —
    neither forwards a hoistable `subclassDefaults`. `ToggleButton`
    deliberately declares no `ownClassStyleDefaults`: it adds nothing to the
    resting tier.

[^why-per-level]: The alternative was to leave `ownStyleStates` flat and keep
    `resolveClassStateLevel` for the hierarchy. Rejected because that is the
    status quo, and it is what produces both symptoms in [^two-symptoms]: two
    resolvers over the same declaration, one of which the JS layer stack cannot
    see. A second alternative — deleting `resolveClassStateLevel` and letting
    each subclass emit a *full* state rule from its own restated list — was
    rejected because two full rules at equal `(0,2,0)` specificity would then
    match one element (`.ToggleButton.selected…` and `.TabButton.selected…`),
    with the winner decided by whichever class rendered first. That is the
    exact hazard `class-hierarchy-cascade.md` deferred the Button family over;
    a delta plus ancestor-first insertion is what removes it, and it is already
    proven in `resolveClassLevel`.

[^flush-symmetry]: The state flush is a separate method rather than an
    extension of `flushStyleBag` because the two differ in three ways that
    would each need a branch: the target rule (`#id<guardedSuffix>` vs `#id`
    plus the resting-isolation rule), the comparison bag (one state's class
    layer vs the group-then-class scan of `layersBelowInstance`), and the
    class-default-only sweep (`FRAMEWORK_BASELINE_KEYS` and
    `SKIP_ON_MATCH_KEYS` have no state-tier meaning — a state layer carries
    only the keys it declares). Sharing one body would be three conditionals
    around a five-line loop.

[^why-fold]: `getPressedBackgroundColor()` must answer "what does this
    instance's pressed override declare", not "what colour is painted while
    pressed" — the latter is `getBackgroundColor()`'s job once `.pressed` is
    active, which this plan makes correct for the first time (Expected
    Behaviour row 12). The `?? this._defaultOptions.pressedX` tail is required,
    not decorative: `Button`'s `:hover` entry declares nothing on the class
    tier (see the Non-Goal), so `resolveStateStyleValue(":hover", …)` returns
    `null` for a freshly constructed button, and `applyChromeOptions` reads
    `getHoverBackgroundColor()` *before* dispatching it. Applying the same tail
    to the pressed family too keeps all twelve getter bodies identical; for
    pressed it is dead weight, since the class-state layer already carries
    those values.

[^pin-precedent]: `pinPressedToResting`'s own comment states the requirement:
    "Writes straight to the rule rather than through `writeClassStateDeclaration`,
    because the point is to outrank the class rule even when the two values
    coincide." A chromeless `Button` never dispatches pressed chrome, so
    without the pin the shared `.Button.pressed` rule — materialised by any
    chromeful sibling of the same class — paints on press. Routing it through
    the ordinary deduping `writeStateStyle` would silently reintroduce that
    leak the moment a resting value happened to equal a pressed token.

[^focused-stays-out]: `Cell.focusedStyleRule` and `TreeRow.focusedStyleRule`
    are allocated and immediately discarded (`void this.focusedStyleRule;`) —
    neither ever calls `.set()` or `.setMany()`. Their only effect is the
    `ensureClassStateRule` call inside `StateStyleRule`'s constructor, which
    publishes `.Cell.focused` / `.TreeRow.focused`. `Component.setValueStyleState`
    calls `.setMany(declarations)` with the identical bag it just seeded the
    class rule from, so every key dedupes away and the per-instance rule stays
    empty — also a shared-rule publication and nothing more. One direct
    forwarder covers all three and drops the wrapper object, the thunk, and the
    unused `#id<suffix>` rule allocation (which `createStyleRule` also
    registers in `trackSelector`).

[^border-isolation]: `restingIsolationKeys()` is the union of the CSS keys
    every declared state carries, and it decides whether a resting write lands
    on `#id` or on `#id<restingGuardSuffix>`. Today `resolveStyleStates(TabButton)`
    resolves `ToggleButton`'s list, whose `.selected` entry carries three keys
    and no border, so a resting `setBorder` on a tab lands on the bare `#id`
    rule. Putting `TAB_BUTTON_SELECTED_BORDER` into `TabButton`'s own
    `.selected` entry would add four longhands to that union and silently move
    every tab's resting border onto the guarded rule — a behavioural change
    with no bug behind it, in a component (`TabBar`) that writes tab borders
    per layout. Keeping the border on the per-instance write preserves today's
    isolation set exactly; the cost is four longhands per tab instead of four
    per class, which the Style Audit pass in row 21 will show.

[^no-hover-hoist]: `Button.extractHoverClassDeclarations`'s own comment gives a
    specificity reason that is now stale — the resting guard was widened to
    `:not(.pressed):not(:hover)` by `layered-style-bag.md`, so an isolated
    resting rule can no longer compete during hover. The live reason to keep
    hover off the class tier is different: `applyChromeOptions`' chromeless
    branch calls `cacheStyleValue("backgroundColor", "transparent")`, which
    updates the layer cache and writes **no** CSS at all, so a chromeless
    button has no `#id` background declaration to outrank a class-tier hover
    rule at `(0,3,0)`. Hoisting hover would give every chromeless button a
    hover background it does not have today, contradicting `chromeless`'s
    documented contract. Fixing that is a separate change to the chromeless
    path, not a state-tier change.

[^restore-chrome]: `_restoreChrome` currently calls each `setPressedX` setter
    and then re-writes the same key through `this.createStyleRule(".pressed").set(…)`,
    because `writeClassStateDeclaration` *skips* a write whose value matches
    the class bag — leaving a stale pin (written earlier by `_clearChrome` or
    the chromeless branch) in sole possession of `#id.pressed`. `flushStateStyleBag`
    queues an explicit `null` on a match instead, which removes the stale pin
    and hands the property back to `.Button.pressed`. That is the same
    write-null-on-match rule `flushStyleBag` already applies to the resting
    tier, so the forced re-write and its eleven-line comment become dead.

---

## Implementation Notes

- **Step 10's Check understated the intermediate-state test failures.**
  After steps 6-9 (before Stage 3 replaced `pressedStyleRule`/`hoverStyleRule`
  with the instance state layer), the plan's Check predicted failures only in
  `Header.test.ts` and `TabButton.stateClassHoisting.test.ts`. In practice
  `Button.pressedHoverClassHoisting.test.ts` and
  `Button.restingChromeIsolation.test.ts` also went red for that same window:
  step 8's `() => ({})` placeholder `resolveDefaults` made every
  `pressedStyleRule`/`hoverStyleRule` write skip its class-bag comparison
  entirely, so writes that used to dedupe away now went through. This is the
  expected, self-correcting cost of the intermediate state the plan itself
  calls for — Stage 3 (steps 13-15) restores real dedup via
  `resolveStateStyleValue`/`flushStateStyleBag`, and both files are green
  again once Stage 3 lands. `Button.restingChromeIsolation.test.ts` was
  updated but was never listed in the plan's `## Files to Create / Modify /
  Delete` table; its row 11 and the "setChromeless(false) overwrites a stale
  pinned pressed color" case in `Button.pressedHoverClassHoisting.test.ts`
  both asserted the *old* forced-literal-rewrite behaviour `_restoreChrome`
  used before `[^restore-chrome]`'s write-null-on-match fix, so both were
  updated to assert `null` (a removal) instead of the literal class token —
  the documented, intended post-fix contract, not a new assertion invented
  to match the code.
- **`ClassStateRules.test.ts`'s cases 1-6 collapsed to four cases, not six,
  when re-pointed at `ensureSharedStateRule`.** The old cases 3 ("a deviating
  instance still writes its own rule") and 4 ("a key absent from the class
  bag always writes") exercised `writeClassStateDeclaration`'s per-write
  class-bag comparison — a concern that doesn't exist in
  `ensureSharedStateRule`'s reduced surface, which only ever ensures a shared
  rule and never writes per-instance. The four surviving cases (rule
  creation with declarations, idempotent re-ensure, name-collision opt-out,
  disposal leaving the class rule intact) cover everything
  `ensureClassStateRule`'s shared-rule path still does; `InstanceStateLayer.test.ts`
  covers the per-instance write-and-dedupe behaviour the old cases 3/4 stood
  in for, through the real `writeStateStyle`/`flushStateStyleBag` mechanism.
- **Steps 11 and 13–15 landed as one commit** (`65fbb4ef`, "Make
  `ownStyleStates` hierarchy-aware and give it a real instance layer"),
  not the three separate, independently-verified commits `## Potential
  Challenges` called for across 13–15. Stage 2's hierarchy-aware
  `resolveStyleStates` and Stage 3's instance state layer fix the same two
  live bugs together — the duplicated `.Button.pressed` write and a
  selected `TabButton` reporting `ToggleButton`'s grey while painting
  white — and `Button`/`ToggleButton`/`TabButton`'s setter migrations are
  what exercises `resolveStyleStates`'s new hierarchy walk end-to-end, so
  there was no independently-green intermediate point between introducing
  the walk and updating its callers to prove it worked. The full suite was
  still run green before this commit landed, and again before every commit
  after it — this note records the commit-count deviation, not a gap in
  verification.
