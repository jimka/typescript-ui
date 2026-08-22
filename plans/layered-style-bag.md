---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
---

# Layered Style Bag — Implementation Plan

## Overview

A component's style state is stored in nine different shapes today. The same
property can live in `_options`, in `_defaultOptions`, in a raw private field,
in a raw field with a `_defaultOptions` fallback under a *different* key, in a
parsed-and-normalised field, in a module-level class-tier `Map`, in a
`styleGroup` bag, in a `StateStyleRule`, or as a raw inline DOM write that
deliberately bypasses every setter.[^shape-inventory] The three shared tiers
(framework, class, group) are compared through one two-entry check —
`Component.matchesClassStyle` ([core/Component.ts:4840](packages/lib/src/typescript/lib/core/Component.ts#L4840))
— while the state tier is a wholly parallel mechanism that check never sees.

This plan replaces those shapes with **one ordered stack of style layers**.
Each layer holds an authored bag (`backgroundColor`, `minSize`, `border`, …)
and the CSS declarations that bag resolves to. A component's own setters write
into its instance layer unconditionally, the moment the setter fires. Deciding
whether a value can be dropped from the emitted CSS — because a lower layer
already supplies it — moves to a flush step that runs only once every layer is
resolved. That ordering change is the structural fix for two shipped bugs whose
root cause is the same: a comparison made against a class-tier bag that does not
exist yet.[^two-bugs]

The work lands in five stages. Stage 1 introduces the layer primitive with no
behaviour change. Stage 2 adds the instance layer and moves dedup to flush time.
Stage 3 makes toggle states (`.pressed`, `:hover`, `.selected`, …) real layers
with a declared priority order. Stage 4 migrates `Text`'s font group. Stage 5
converts Table's and Tree's four hand-rolled per-record tint implementations
into declared, shared meta-class layers. The mechanism lives in
[core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts)
and [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts); the
component-level migrations touch 16 further source files.[^supersedes-v070]

---

## Architecture Decisions

### A layer is an authored bag plus its resolved CSS — the shape `resolveClassLevel` already returns

`ClassStyleRules.ts`'s `ResolvedClassLevel` ([:291](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L291))
already pairs a class's merged authored bag with the CSS it produces, and
`resolveClassLevel` ([:381](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L381))
already memoizes that pair per constructor. Promote that pair to a named
`StyleLayer` type and give every tier — instance, meta-class, group, class —
the same shape.[^layer-precedent]

### The stack is ordered highest-priority first, with active meta-classes above the instance layer

`matchesClassStyle` checks `_styleGroupBag` then `_inheritedStyleBag` — a
priority-ordered scan, hardcoded to two fields. It becomes a scan over
`styleLayers()`, an ordered `ReadonlyArray<StyleLayer>`.

The order, highest first: **active meta-class layers (in declared order) →
instance → group → class**. The framework tier stays merged into the class
layer's resolved bag, exactly as `ensureClassStyleRule` returns it today.

An active meta-class sits *above* the instance layer, not below it, because
that is what the browser paints and what `getComputedStyle()` would
report.[^metaclass-above-instance] The scan is per key, so a meta-class that
declares only `boxShadow` leaves every other key to the instance layer:

| Button state | Instance layer | `.pressed` layer | `getBackgroundColor()` | `getOutline()` |
|---|---|---|---|---|
| resting, nothing set | — | (inactive) | class default | class default |
| resting, `setBackgroundColor("red")` | `backgroundColor: red` | (inactive) | `red` | class default |
| pressed, `setBackgroundColor("red")` | `backgroundColor: red` | `backgroundColor: var(--ts-ui-button-pressed-bg, …)` | `var(--ts-ui-button-pressed-bg, …)` | class default |
| pressed, `setOutline("2px solid blue")` | `outline: 2px solid blue` | declares no `outline` | pressed background | `2px solid blue` |

### A setter's write into the instance layer is unconditional; dedup happens at flush

`writeStyle(patch)` merges the patch into `_instanceStyle` and marks the
affected CSS keys pending. It never compares against anything. `flushStyleBag()`
does the comparing: for each pending key it resolves the value, checks the
layers below the instance layer, and queues a removal on a match or the real
value otherwise — today's `reconcileRuleDeclaration` semantics, moved to a
point where every layer is guaranteed resolved.

`flushStyleBag()` runs from `applyStyle` ([core/Component.ts:5013](packages/lib/src/typescript/lib/core/Component.ts#L5013))
and, for a component that already has an element, at the end of the setter.
Before first render there is no element, so the keys stay pending and the
render pass drains them. This is what removes both shipped
bugs.[^two-bugs]

### `ownClassStyleDefaults` stays a separate resolution feeding one class-tier layer

The static hierarchy walk keeps its own module-level caches (`_levels`,
`_bags`, `_stateLevels`, `_stateBags`, `_groupBags`) and keeps collapsing an
ancestor chain into a single merged pair. A component's stack therefore holds
exactly one class layer regardless of hierarchy depth.[^collapse-class-chain]

### Toggle states are declared per class as an ordered list, and their selectors are generated from it

A class declares its own states through a `protected static readonly
ownStyleStates` field, own-property-checked exactly like `ownClassStyleDefaults`
([core/ClassStyleRules.ts:315](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L315)).
Array order *is* priority — first entry wins. Both the CSS selector suffixes
and the JS resolver order come from that one declaration, so they cannot
drift.[^generated-suffixes]

Each entry's selector is guarded with `:not(...)` against every
higher-priority entry; the resting rule is guarded against all of them:

| Class | Declared order | Generated suffixes |
|---|---|---|
| `Button` | `.pressed`, `:hover` | `.pressed` · `:hover:not(.pressed)` · resting `:not(.pressed):not(:hover)` |
| `ToggleButton` | `.pressed`, `:hover`, `.selected` | `.pressed` · `:hover:not(.pressed)` · `.selected:not(.pressed):not(:hover)` · resting `:not(.pressed):not(:hover):not(.selected)` |
| `Row` (Stage 5) | `.selected`, `.new`, `.dirty`, `.stripe` | `.selected` · `.new:not(.selected)` · `.dirty:not(.selected):not(.new)` · `.stripe:not(.selected):not(.new):not(.dirty)` |

A total order replaces today's per-pair accident, and today's accident is
cyclic, so at least one visible outcome must change: a `ToggleButton` that is
both selected and pressed paints `.pressed` after this plan, where it paints
`.selected` today.[^toggle-cycle]

### The resting-isolation key set is derived from the declared states, replacing `RESTING_ISOLATION_KEYS`

`RESTING_ISOLATION_KEYS` ([core/Component.ts:368](packages/lib/src/typescript/lib/core/Component.ts#L368))
is a fixed three-property set, and `getRestingExclusionSuffixes()`
([:4863](packages/lib/src/typescript/lib/core/Component.ts#L4863)) is a
hand-maintained list overridden by six classes. Both are computed from
`ownStyleStates` instead: the isolation key set is the union of the CSS keys
every declared state layer carries, and the resting suffix is the generated
`:not(...)` chain above. The constant, the base method and all six overrides
are deleted.[^derived-isolation]

### Typed accessors stay; they become thin wrappers over one generic resolver

`getBackgroundColor(): string | null` and every sibling keep their exact
signature. Each body becomes a single call to a typed internal resolver keyed
on the authored property name, so no consumer sees a
`Record<string, string | null>`.[^typed-resolver]

### `_instanceStyle` replaces `_options` as the cache for layering properties

For a property that participates in layering, the instance layer is the single
cache; `_options` no longer holds a copy. The property keeps its
`ComponentOptions` field and its `applyOptions` dispatch — the consumer surface
is unchanged. This deviates from ARCHITECTURE.md's *Always cache in memory*
default ("the options bag is the default cache"), so ARCHITECTURE.md is updated
in the same change.[^options-deviation]

### Layer lookup is cached per instance and invalidated on layer change

A resolved-value cache keyed by authored property name is cleared whenever the
instance layer is written, a meta-class is toggled, or `setStyleGroup` runs.
Class and framework layers are immutable per process, so nothing else can
change an answer.[^resolution-cache]

The pooled Table/Tree recycle paths keep writing directly: `setStyleState(name,
active)` is a `classList` toggle plus a cache clear, with no rule
materialisation and no resolver walk.

### `overflow` gains explicit `overflowX` / `overflowY` authored keys

`getOverflowX()` ([core/Component.ts:4117](packages/lib/src/typescript/lib/core/Component.ts#L4117))
and `getOverflowY()` ([:4162](packages/lib/src/typescript/lib/core/Component.ts#L4162))
read a raw field and fall back to a differently-named `_defaultOptions.overflow`
key. `getOutline()` ([:2691](packages/lib/src/typescript/lib/core/Component.ts#L2691))
uses the same raw-field-plus-fallback shape under a matching key
name.[^outline-name-correction] All three raw fields are deleted. `StyleBag`
gains `overflowX` / `overflowY` alongside `overflow`, and the per-axis fallback
moves into the shared serializer as `overflowX ?? overflow ?? "visible"` — so
the fallback is declared once, in the one place that turns authored values into
CSS, instead of hidden inside two getters.

### Pooled per-record tints become declared meta-class layers, following `SelectableListRow`

`AbstractSelectableList` already solves this exact problem for its own pooled,
recycled rows: `.SelectableListRow.selected` / `.SelectableListRow.focused`
module-level rules ([component/list/AbstractSelectableList.ts:238](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L238),
[:253](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L253))
toggled by a class-list write ([:576](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L576)).
Table's and Tree's four sites hand-roll raw inline writes instead. They adopt
the declared-state mechanism, which is the same idea backed by the shared
class-rule machinery.[^tint-precedent]

### Non-CSS side effects stay in the setter body; layer-driven effects get an explicit hook

`writeStyle` replaces only the CSS-write line of a setter. Every other line —
`scheduleLayout()`, `setDataAttribute(...)`, `_onConstraintSizeChange?.()`,
`_measurementDirty = true`, `_borderWidths = null`, the border theme
subscription, `scheduleEffectiveVisibilityReconcile()`,
`recomputePreferredSize()` (which calls `Button._syncGlyphSize()`), the
child-colour delegations — is untouched.[^side-effects]

An effect that must also fire when a *lower* layer supplies the value gets a
new hook: `protected onStyleResolved(keys: ReadonlySet<string>)`, called by
`flushStyleBag()` after the writes. `Component` overrides it to call
`refreshWheelScrolling()` when `overflowX` or `overflowY` is in the set — the
job `applyOverflowStyles` does today ([core/Component.ts:5170](packages/lib/src/typescript/lib/core/Component.ts#L5170)).

---

## Public API

No exported signature changes. The new surface is internal:

```typescript
// core/ClassStyleRules.ts

/** Authored per-layer style values. Renamed from `ClassStyleDefaults`. */
export interface StyleBag {
    visible?:         boolean | null;
    displayed?:       boolean;
    minSize?:         { width: number; height: number } | null;
    maxSize?:         { width: number; height: number } | null;
    overflow?:        string | null;
    overflowX?:       string | null;   // new
    overflowY?:       string | null;   // new
    cursor?:          string | null;
    userSelect?:      string | null;
    outline?:         string | null;
    foregroundColor?: string | null;
    font?:            TextStyleBag | null;
    backgroundColor?: string | null;
    backgroundImage?: string | null;
    shadow?:          string | null;
    borderRadius?:    string | null;
    border?:          BorderOptions | string | null;
    // New authored keys for the five properties `applyStyle` writes today
    // outside the authored-bag path — from a raw field (`boxSizing`,
    // `position`, `whiteSpace`), a hardcoded literal (`margin`), or its own
    // options getter (`padding`). `resolveDeclarations` already emits a CSS
    // counterpart for the first four; `padding` gains a writer.
    // `Insets` imports only `BaseObject`, so no import cycle forms.
    boxSizing?:       string | null;
    position?:        Position;
    whiteSpace?:      string | null;
    margin?:          string | null;
    padding?:         Insets | null;
}

/** CSS-ready declarations. Renamed from the unexported `ClassStyleBag`. */
export type ResolvedStyleBag = Readonly<Record<string, string | null>>;

export interface StyleLayer {
    readonly authored: StyleBag;
    readonly resolved: ResolvedStyleBag;
}

/** One declared toggle state. Array order is priority, first entry highest. */
export interface StyleStateSpec {
    /** Selector fragment the state activates on, e.g. `".pressed"`, `":hover"`. */
    readonly selector: string;
    /** This level's own contribution, read from its `ownClassStyleDefaults`. */
    readonly extract: (defaults: StyleBag) => StyleBag;
}

export interface ResolvedStyleState {
    readonly selector:      string;   // ".pressed"
    readonly guardedSuffix: string;   // ":hover:not(.pressed)"
    readonly layer:         StyleLayer;
}

export function resolvePartialDeclarations(bag: StyleBag): Record<string, string | null>;
export function resolveStyleStates(ctor: Function): readonly ResolvedStyleState[];
export function restingGuardSuffix(ctor: Function): string;
export function ensureClassStyleRule(ctor: Function, defaults: StyleBag): StyleLayer | null;
export function ensureStyleGroupRule(ctor: Function, group: string, authored: StyleBag): StyleLayer | null;
```

```typescript
// core/Component.ts

protected styleLayers(): ReadonlyArray<StyleLayer>;
protected instanceLayer(): StyleLayer;
protected writeStyle(patch: StyleBag): void;
protected resolveStyleValue<K extends keyof StyleBag>(key: K): StyleBag[K] | null;
protected resolveFontValue<K extends keyof TextStyleBag>(key: K): TextStyleBag[K] | null;
protected flushStyleBag(): void;
protected onStyleResolved(keys: ReadonlySet<string>): void;

/** Writes one key onto the resting-guarded rule. The escape hatch for a
 *  shorthand no `StyleBag` key covers — `Button`'s `background`. */
protected writeGuardedCSSRule(key: string, value: string | null): void;

/** Value-keyed meta-class: `Text`'s `.lh18px` mechanism, hoisted. */
protected setValueStyleState(prefix: string, cssValue: string, patch: StyleBag): void;
protected clearValueStyleState(prefix: string): void;

/** Public: toggles a declared meta-class on this instance. */
setStyleState(name: string, active: boolean): this;
isStyleState(name: string): boolean;
```

Removed: `Component.matchesClassStyle`, `writeRuleDeclaration`,
`reconcileRuleDeclaration`, `setReconciledCSSRules`, `getRestingExclusionSuffixes`,
`restingIsolationSuffix`, `restingStyleRule`, `materialiseRestingRule`,
`isRestingChromeIsolated`, `isChromeIsolationEnabled`,
`setChromeIsolationEnabled`, `applyBoxAndVisibilityStyles`,
`applySizeConstraintStyles`, `applyOverflowStyles`, `applyChromeStyles`, the
module constant `RESTING_ISOLATION_KEYS`, and the private fields
`_inheritedStyleBag`, `_styleGroupBag`, `_outline`, `_overflowX`, `_overflowY`,
`_boxSizing`, `_whiteSpace`, `_position`.

`setDisplayed` moves `display` from the inline-style channel to the `#id` rule
channel. The rule was already the durable channel — `applyStyle` wipes inline
styles on every pass and re-writes `display` from the rule side — so this
removes the second writer rather than changing which one wins.

---

## Internal Structure

### One writer table drives both serializers

`resolveDeclarations` ([core/ClassStyleRules.ts:174](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L174))
currently hardcodes both the per-key CSS mapping and the absent-key fallbacks
in one function body. Split it so the mapping exists once:

```typescript
// authored key -> the CSS declarations it produces
const STYLE_WRITERS: { [K in keyof StyleBag]-?: (v: NonNullable<StyleBag[K]>) => Record<string, string | null> } = {
    backgroundColor: (v) => ({ backgroundColor: v }),
    shadow:          (v) => ({ boxShadow: v }),
    foregroundColor: (v) => ({ color: v }),
    minSize:         (v) => ({ minWidth: v.width + "px", minHeight: v.height + "px" }),
    border:          (v) => borderToStyle(typeof v === "string" ? { border: v } : v),
    // ... one entry per StyleBag key
};

/** Only the keys `bag` actually declares. Used by the instance and state layers. */
export function resolvePartialDeclarations(bag: StyleBag): Record<string, string | null> { /* ... */ }

/** Today's full body: the absent-key fallbacks, then the declared keys over them. */
export function resolveDeclarations(bag: StyleBag): Record<string, string | null> { /* ... */ }
```

`resolveDeclarations`'s output must stay byte-identical — it is what every
`.ClassName` rule body is built from.

### The layer stack

```typescript
// core/Component.ts
private _instanceStyle : StyleBag = {};
private _classLayer    : StyleLayer | null = null;   // resolved in applyStyle
private _groupLayer    : StyleLayer | null = null;   // resolved in applyStyle
private _activeStates  : Set<string> = new Set();    // declared state selectors
private _resolvedCache : Map<string, unknown> | null = null;

protected styleLayers(): ReadonlyArray<StyleLayer> {
    const layers: StyleLayer[] = [];

    for (const state of resolveStyleStates(this.constructor)) {
        if (this._activeStates.has(state.selector)) {
            layers.push(state.layer);
        }
    }

    layers.push(this.instanceLayer());
    if (this._groupLayer) layers.push(this._groupLayer);
    if (this._classLayer) layers.push(this._classLayer);

    return layers;
}
```

`resolveStyleStates` returns entries in declared order, so the active ones are
pushed highest-first with no extra sorting.

### Key presence decides, so `clearX()` suppresses lower layers

`resolveStyleValue` returns at the first layer whose authored bag *contains*
the key, even when the stored value is `null`. `clearX()` writes the key with
`null`; a never-set property has no key at all.

| Call sequence on a class defaulting `cursor: "pointer"` | `_instanceStyle` | `getCursor()` |
|---|---|---|
| (none) | `{}` | `"pointer"` (class layer) |
| `setCursor("text")` | `{ cursor: "text" }` | `"text"` |
| `setCursor("text")`, `clearCursor()` | `{ cursor: null }` | `null` |

This is the shape `getBackgroundColor` / `getCursor` / `getPadding` already use
and that ARCHITECTURE.md's *Class-level defaults must survive the getter*
prescribes. It changes the answer for the three raw-field getters being
migrated — `getOutline` / `getOverflowX` / `getOverflowY` re-resolve the class
default after a `clear*()` today.

### Toggling a state

```typescript
setStyleState(name: string, active: boolean): this {
    if (active === this._activeStates.has(name)) return this;

    active ? this._activeStates.add(name) : this._activeStates.delete(name);
    this._resolvedCache = null;

    const element = this.getElement();
    if (element && !name.startsWith(":")) {
        const token = name.slice(1);   // ".selected" -> "selected"
        DOM.sink.apply(element, active ? { addClass: [token] } : { removeClass: [token] });
    }

    return this;
}
```

Pseudo-class states (`:hover`, `:active`) carry no DOM token — the browser
activates them — but still join `_activeStates` when the component tracks them
itself, exactly as `Button` tracks its own pressed state today.

`addClass` / `removeClass` is used rather than a whole-`class`-attribute
rewrite: a full write must re-state `COMPONENT_CLASS` or the element loses
`position: absolute` and every pooled row stacks.[^class-write-trap]

---

## Ordered Implementation Steps

### Stage 1 — the layer primitive (no behaviour change)

1. **Rename the type.** In `core/ClassStyleRules.ts`, rename `ClassStyleDefaults`
   to `StyleBag` and `TextClassStyleDefaults` to `TextStyleBag` (export the
   latter). Update every importer. The static field name
   `ownClassStyleDefaults` does **not** change.
   Check: `grep -rn 'ClassStyleDefaults' packages/lib/src packages/lib/tests`
   — expect zero matches outside the string `ownClassStyleDefaults`; then
   `npm run typecheck`.
2. **Export `ResolvedStyleBag`.** Rename the unexported `ClassStyleBag` alias
   ([:83](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L83)) to
   `ResolvedStyleBag` and export it.
3. **Split the serializer.** Introduce `STYLE_WRITERS` and
   `resolvePartialDeclarations`, and rewrite `resolveDeclarations`
   ([:174](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L174)) on
   top of them, preserving its exact output.
   Check: `npx vitest run tests/core/ClassStyleRules.test.ts tests/core/ClassHierarchyCascade.test.ts`
   from `packages/lib` — all green, no test edits.
4. **Add `StyleLayer`.** Define the interface; rename `ResolvedClassLevel`'s
   fields `defaults`/`resolved` to `authored`/`resolved` so it *is* a
   `StyleLayer`. Change `ensureClassStyleRule`
   ([:589](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L589)) and
   `ensureStyleGroupRule` ([:841](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L841))
   to return `StyleLayer | null`. `ensureStyleGroupRule`'s third parameter
   changes from a resolved CSS record to an authored `StyleBag`, so it can fill
   both halves of the layer; its body runs the bag through
   `resolveDeclarations` before building the rule, exactly as its one caller
   does today.
5. **Return an authored bag from the group seed.**
   `resolveInstanceStyleDeclarations` ([core/Component.ts:307](packages/lib/src/typescript/lib/core/Component.ts#L307))
   currently reads ten getters and passes the result through
   `resolveDeclarations`. Drop that call so the helper returns the authored
   `StyleBag` `ensureStyleGroupRule` now takes — the same ten getters, the same
   ten keys.
6. **Hold layers on `Component`.** Replace `_inheritedStyleBag`
   ([core/Component.ts:494](packages/lib/src/typescript/lib/core/Component.ts#L494))
   and `_styleGroupBag` ([:499](packages/lib/src/typescript/lib/core/Component.ts#L499))
   with `_classLayer` / `_groupLayer`, assigned at the same point in
   `applyStyle` ([:5019](packages/lib/src/typescript/lib/core/Component.ts#L5019)).
   Add `styleLayers()` returning `[group, class]` and reimplement
   `matchesClassStyle` ([:4840](packages/lib/src/typescript/lib/core/Component.ts#L4840))
   as a scan over it.
7. **New test file** `packages/lib/tests/core/StyleLayers.test.ts` covering
   Expected Behaviour rows 1–3.
   Check: `npm test` from `packages/lib` — full suite green with no edits to
   existing tests.

### Stage 2 — the instance layer

8. **Add the instance layer.** In `core/Component.ts`: `_instanceStyle`,
   `_resolvedCache`, `writeStyle(patch)` (shallow merge, one level deep for
   `font`; clears `_resolvedCache`; adds `resolvePartialDeclarations(patch)`'s
   keys to a pending set), `instanceLayer()`, `resolveStyleValue`,
   `resolveFontValue`, `flushStyleBag()`, and the no-op `onStyleResolved`.
   Push the instance layer into `styleLayers()` above the group layer.
9. **Add the new `StyleBag` keys**: `overflowX`, `overflowY`, `boxSizing`,
   `position`, `whiteSpace`, `margin`, `padding`, each with its
   `STYLE_WRITERS` entry. `overflowX`/`overflowY` resolve as
   `overflowX ?? overflow ?? "visible"`, which is where the per-axis fallback
   now lives.
10. **Migrate the layering setters in `core/Component.ts`** — for each, replace
    only the `setReconciledCSSRules(...)` / `setElementCSSRule(...)` /
    `setElementCSSRules(...)` line with a `writeStyle({ … })` call, and delete
    the `_options.X = …` / raw-field assignment. Delete `_outline`
    ([:469](packages/lib/src/typescript/lib/core/Component.ts#L469)),
    `_overflowX` and `_overflowY` ([:450](packages/lib/src/typescript/lib/core/Component.ts#L450)).
    The set: `setVisible`/`setDisplayed`, `setMinSize`/`setMaxSize`,
    `setOverflow`/`setOverflowX`/`setOverflowY` + clears, `setCursor`/`clearCursor`,
    `setUserSelect`/`clearUserSelect`, `setOutline`/`clearOutline`,
    `setForegroundColor`/`clearForegroundColor`,
    `setBackgroundColor`/`clearBackgroundColor`,
    `setBackgroundImage`/`clearBackgroundImage`, `setShadow`/`clearShadow`,
    `setBorderRadius`/`clearBorderRadius`, `setBorder`/`clearBorder`,
    `setPadding`/`clearPadding`, `setWhiteSpace`/`clearWhiteSpace`, and
    `setPosition`/`clearPosition`. Delete the constructor's `_boxSizing` /
    `_whiteSpace` constant assignments — the framework tier already emits
    `border-box` / `nowrap`.
    **Every other line in each body stays**, including
    `refreshWheelScrolling()`, `setDataAttribute`, `_onConstraintSizeChange?.()`,
    `scheduleEffectiveVisibilityReconcile()`, `_borderWidths = null`, and the
    border theme subscription ([:2504](packages/lib/src/typescript/lib/core/Component.ts#L2504)).
11. **Route the matching getters through the resolver.** `isVisible`,
    `isDisplayed`, `getMinSizeConstraint`, `getMaxSizeConstraint`,
    `getOverflowX`, `getOverflowY`, `getCursor`, `getUserSelect`, `getOutline`,
    `getForegroundColor`, `getBackgroundColor`, `getBackgroundImage`,
    `getShadow`, `getBorderRadius`, `getBorder`, `getPadding`, `getWhiteSpace`,
    `getPosition`. Each body becomes one `resolveStyleValue(...)` call; the
    signatures do not change.
12. **Collapse the render phases.** Delete `applyBoxAndVisibilityStyles`
    ([:5048](packages/lib/src/typescript/lib/core/Component.ts#L5048)),
    `applySizeConstraintStyles` ([:5133](packages/lib/src/typescript/lib/core/Component.ts#L5133)),
    `applyOverflowStyles` ([:5156](packages/lib/src/typescript/lib/core/Component.ts#L5156))
    and `applyChromeStyles` ([:5177](packages/lib/src/typescript/lib/core/Component.ts#L5177)),
    and call `flushStyleBag()` from `applyStyle` in their place, after the
    layers are assigned. Keep `replayGeometryStyles`, `applySubclassStyles` and
    the two materialise steps unchanged. Reduce `applyMiscInlineStyles`
    ([:5208](packages/lib/src/typescript/lib/core/Component.ts#L5208)) to its
    inline-only writes (`pointerEvents`, `writingMode`, `touchAction`,
    `zIndex`, `willChange`, `transition`, `opacity`) plus the `data-insets`
    attribute; its `whiteSpace`, `userSelect`, `padding` and `margin` lines are
    now covered by the flush. Move `refreshWheelScrolling()` and the
    `data-minSize` / `data-maxSize` writes into `onStyleResolved`.
    Check: `npm run typecheck` — the four deleted methods have no remaining
    callers.
13. **Delete the private fields** `_inheritedStyleBag`, `_styleGroupBag`,
    `_outline`, `_overflowX`, `_overflowY`, `_boxSizing`, `_whiteSpace` and
    `_position`. The reconcile API (`matchesClassStyle`, `writeRuleDeclaration`,
    `reconcileRuleDeclaration`, `setReconciledCSSRules`) stays for now — `Text`,
    `ButtonLabelText` and `HeaderCellText` still call it, and step 24 removes it
    once they no longer do.
14. **New test file** `packages/lib/tests/core/InstanceStyleLayer.test.ts`
    covering Expected Behaviour rows 4–8.
    Check: `npm test` from `packages/lib`. Expect edits only in
    `tests/core/ClassReconciledRules.test.ts` and
    `tests/core/ClassChromeRules.test.ts`, which name the removed fields.

### Stage 3 — meta-class layers

15. **Add the state machinery to `core/ClassStyleRules.ts`**: `StyleStateSpec`,
    `ResolvedStyleState`, `resolveStyleStates(ctor)` (own-property walk over
    `ownStyleStates`, mirroring `resolveClassStateLevel`
    ([:479](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L479)) and
    reusing `_stateLevels` / `_owners`), and `restingGuardSuffix(ctor)`.
    `resolveStyleStates` builds each state's `.ClassName<guardedSuffix>` rule
    through the existing `new StyleRule({ scope: "class", … })` path.
16. **Wire `Component`**: `_activeStates`, `setStyleState` / `isStyleState`,
    push active state layers onto the front of `styleLayers()`, and route
    `flushStyleBag`'s isolated keys onto `createStyleRule(restingGuardSuffix(...))`.
17. **Delete the hand-maintained isolation surface**: `RESTING_ISOLATION_KEYS`
    ([core/Component.ts:368](packages/lib/src/typescript/lib/core/Component.ts#L368)),
    `getRestingExclusionSuffixes` and its six overrides
    ([button/Button.ts:626](packages/lib/src/typescript/lib/component/button/Button.ts#L626),
    [button/ToggleButton.ts:77](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L77),
    [input/Checkbox.ts:87](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L87),
    [input/RadioButton.ts:60](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L60),
    [container/Scrollbar.ts:443](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L443),
    [table/cell/Header.ts:199](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L199)),
    and the chrome-isolation opt-out trio.
    Check: `grep -rn 'getRestingExclusionSuffixes\|RESTING_ISOLATION_KEYS\|ChromeIsolationEnabled' packages/lib/src`
    — expect zero.
18. **Migrate `Button`** ([:603](packages/lib/src/typescript/lib/component/button/Button.ts#L603),
    [:616](packages/lib/src/typescript/lib/component/button/Button.ts#L616)) to
    `static readonly ownStyleStates = [{ selector: ".pressed", extract }, { selector: ":hover", extract }]`,
    with each `extract` returning a `StyleBag` (`shadow`, not `boxShadow`;
    `foregroundColor`, not `color`). Replace `_updatePressedClass`'s DOM write
    with `setStyleState(".pressed", …)`. Replace `Button.setElementCSSRule`'s
    override ([button/Button.ts:636](packages/lib/src/typescript/lib/component/button/Button.ts#L636)),
    which routes the `background` shorthand onto the old `restingStyleRule`,
    with a single `writeGuardedCSSRule("background", …)` call — `background` is
    a shorthand no `StyleBag` key covers, so it needs the escape hatch rather
    than a layer.
    Check: `npx vitest run tests/component/button/Button.pressedHoverClassHoisting.test.ts`.
19. **Migrate the remaining state users**, one per commit, each against its own
    existing test file: `ToggleButton` (`.selected`), `Checkbox` (`.selected`,
    `.indeterminate`), `RadioButton` (`.selected`), `Scrollbar` (`.disabled`,
    `.hover`), `HeaderCell` (`:active`), `RailHandle` (`.selected`, `:hover`),
    `WindowBorder`, `AccordionIndicator`, `DiagramNode`.
20. **New test file** `packages/lib/tests/core/StyleStates.test.ts` covering
    Expected Behaviour rows 9–13.

### Stage 4 — `Text`'s font group

21. **Migrate `Text`'s twelve font setters** ([component/input/Text.ts](packages/lib/src/typescript/lib/component/input/Text.ts))
    to `writeStyle({ font: { … } })` and their getters to `resolveFontValue`.
    Keep every `_measurementDirty = true` and `scheduleLayout()` line.
22. **Retire `writeFontDeclaration`** ([:1505](packages/lib/src/typescript/lib/component/input/Text.ts#L1505))
    and the eleven calls in `applySubclassStyles`
    ([:1523](packages/lib/src/typescript/lib/component/input/Text.ts#L1523));
    `flushStyleBag` covers them. Keep `Text.getClassStyleDefaults`
    ([:1495](packages/lib/src/typescript/lib/component/input/Text.ts#L1495)).
23. **Generalise the value-keyed class.** `applyLineHeightValueClass`
    ([:1155](packages/lib/src/typescript/lib/component/input/Text.ts#L1155))
    becomes a call to the new `Component.setValueStyleState(prefix, cssValue,
    patch)`, which derives the token, ensures the shared `.ClassName.<token>`
    rule, and toggles it — the same mechanism, hoisted out of `Text`.
    `clearLineHeightValueClass` ([:1177](packages/lib/src/typescript/lib/component/input/Text.ts#L1177))
    becomes `clearValueStyleState(prefix)`. Keep the idempotency guard at
    [:1211](packages/lib/src/typescript/lib/component/input/Text.ts#L1211).
    Check: `npx vitest run tests/component/input/TextLineHeightValueClassSharing.test.ts tests/component/input/TextClassStyleHoisting.test.ts`.
24. **Delete the reconcile API and the two workaround overrides it exists for.**
    `ButtonLabelText.applySubclassStyles` ([button/Button.ts:289](packages/lib/src/typescript/lib/component/button/Button.ts#L289))
    and `HeaderCellText.applySubclassStyles` ([table/cell/Header.ts:129](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L129))
    exist only to re-assert a `fontSize` the class tier already supplies — the
    workaround the null-bag comparison forced; both go. Then delete
    `matchesClassStyle`, `writeRuleDeclaration`, `reconcileRuleDeclaration` and
    `setReconciledCSSRules`.
    Check: `grep -rn 'writeRuleDeclaration\|reconcileRuleDeclaration\|setReconciledCSSRules\|matchesClassStyle' packages/lib/src`
    — expect zero outside comments.
25. **Add Expected Behaviour rows 14–15** to
    `packages/lib/tests/component/input/TextClassStyleHoisting.test.ts`.

### Stage 5 — pooled per-record tints

26. **`Row`** ([component/table/Row.ts:288](packages/lib/src/typescript/lib/component/table/Row.ts#L288)):
    declare `ownStyleStates` for `.selected`, `.new`, `.dirty`, `.stripe` in
    that order, with the four theme-token values moved out of
    `updateVisualState`'s inline writes and into the `extract` functions.
    `updateVisualState` becomes four `setStyleState` calls.
27. **`Body`** ([component/table/Body.ts:2126](packages/lib/src/typescript/lib/component/table/Body.ts#L2126),
    [:2185](packages/lib/src/typescript/lib/component/table/Body.ts#L2185)):
    `updateRowVisualState` drives `row.setStyleState(".selected", …)`;
    `_updateFocusStyle` drives `cell.setStyleState(".focused", …)`, and the
    per-tick clear sweep becomes a `setStyleState(".focused", false)` on the
    previously-focused cell only, falling back to the full sweep when that cell
    is no longer in the pool.
28. **`Cell`** ([component/table/cell/Cell.ts:406](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L406)):
    declare `.focused`, `.rangeSelected`, `.readOnly`, `.requiredEmpty` in that
    order — `.focused` carries the `outline` step 27 toggles, the other three
    carry the background/cursor/shadow tints;
    `_applyStateTint` becomes three `setStyleState` calls plus, for a
    consumer-supplied `ColumnConfig.groupColor`, one
    `setValueStyleState("bg", color, { backgroundColor: color })`. Delete the
    `this._options.backgroundColor` poke at
    [:422](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L422).
29. **`TreeRow`** (`packages/lib/src/typescript/lib/component/tree/TreeRow.ts`):
    declare `ownStyleStates` for `.selected` and `.focused`, carrying the
    `SELECTED_BG` token ([tree/Tree.ts:53](packages/lib/src/typescript/lib/component/tree/Tree.ts#L53))
    and the focus outline. `Tree._updateSelectionStyle`
    ([tree/Tree.ts:1266](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1266))
    becomes two `setStyleState` calls per pooled row.
30. **New test file** `packages/lib/tests/component/table/PooledTintMetaClasses.test.ts`
    covering Expected Behaviour rows 16–19.
31. **Update the docs** listed in `## Documentation Impact`: the three
    `ARCHITECTURE.md` sections and the three `next.md` changelog entries.
    Check: `npm run docs:api` — zero warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/ToggleButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/RadioButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/WindowBorder.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/AccordionIndicator.ts` |
| Modify | `packages/lib/src/typescript/lib/component/diagram/DiagramNode.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/RailHandle.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Row.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/Body.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/Tree.ts` |
| Modify | `packages/lib/src/typescript/lib/component/tree/TreeRow.ts` |
| Modify | every remaining file importing the `ClassStyleDefaults` *type* (step 1; 32 files total, rename only) |
| Modify | `packages/lib/tests/core/ClassReconciledRules.test.ts` |
| Modify | `packages/lib/tests/core/ClassChromeRules.test.ts` |
| Modify | `packages/lib/tests/component/input/TextClassStyleHoisting.test.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Create | `packages/lib/tests/core/StyleLayers.test.ts` |
| Create | `packages/lib/tests/core/InstanceStyleLayer.test.ts` |
| Create | `packages/lib/tests/core/StyleStates.test.ts` |
| Create | `packages/lib/tests/component/table/PooledTintMetaClasses.test.ts` |

---

## Expected Behaviour

Rows 1–19 are unit-testable with the existing `installTestDOM` /
`RecordingDOMSink` harness and the `declarationsDuring` helper in
`tests/core/ClassStyleRules.test.ts`. Rows 20–22 are manual-verify.

**Stage 1 — layer stack**

1. A component whose class layer supplies `cursor: "pointer"` and whose group
   layer supplies `cursor: "text"` resolves `"text"`: the group layer is
   scanned first.
2. A key declared by no layer resolves to `null`.
3. `styleLayers()` on a component with no `styleGroup` returns exactly one
   entry (the class layer) before Stage 2.

**Stage 2 — instance layer and deferred dedup**

4. `new Foo({ backgroundColor: "red" })`, where `Foo`'s class default is also
   `"red"`, renders **no** `backgroundColor` declaration on its `#id` rule —
   neither a real value nor a `null` removal appears in the emitted rule body.
   (Today the construction-time setter queues a real, redundant value.)
5. `setBackgroundColor("blue")` *after* first render, on a class defaulting
   `"red"`, writes a real `backgroundColor: blue` to `#id`.
6. `setBackgroundColor("red")` after first render, on a class defaulting
   `"red"`, writes `backgroundColor: null` to `#id`.
7. On a class defaulting `overflow: "auto"`: `getOverflowX()` returns `"auto"`;
   after `setOverflowX("hidden")` it returns `"hidden"`; after
   `clearOverflowX()` it returns `null`, **not** `"auto"`. The same holds for
   `getOverflowY` and for `getOutline` / `clearOutline`.
8. `setOverflowY("auto")` attaches the wheel scroller; a class that only
   *defaults* `overflow: "auto"` also has it attached after first render —
   `onStyleResolved` fires for a value supplied by a lower layer.

**Stage 3 — meta-class layers**

9. `Button` with `ownStyleStates = [".pressed", ":hover"]` emits class rules
   for `.Button.pressed` and `.Button:hover:not(.pressed)`, and its resting
   chrome writes land on `#id:not(.pressed):not(:hover)`.
10. `setStyleState(".pressed", true)` adds the `pressed` token to the element's
    class list; `false` removes it. A `:`-prefixed state adds no token.
11. On a pressed `Button` whose `.pressed` layer declares `backgroundColor`,
    `getBackgroundColor()` returns the pressed value even when
    `setBackgroundColor` set a different resting value; `getOutline()` still
    returns the instance/class value, because `.pressed` declares no `outline`.
12. A `Button` with a per-instance resting `backgroundColor` still paints its
    class-tier hover background while hovered: the resting declaration lands on
    a rule guarded by `:not(:hover)`, so the two selectors are mutually
    exclusive.
13. A `ToggleButton` that is both selected and pressed resolves the `.pressed`
    layer, not `.selected`.

**Stage 4 — `Text`**

14. A `Text` subclass whose class default supplies `fontSize` and whose
    constructor also calls `setFontSize` with that same value emits **no**
    `fontSize` declaration on its `#id` rule, with no `applySubclassStyles`
    override present anywhere in its chain.
15. Two `Text` instances of one concrete class set to the same numeric
    line-height still share one `.ClassName.lh<value>` rule and carry the token
    on their elements; switching one to a CSS-var line-height removes only that
    instance's token.

**Stage 5 — pooled tints**

16. `Row.updateVisualState()` on a dirty row adds the `dirty` class token and
    writes **no** inline style; the tint value lives only on the shared
    `.Row.dirty:not(.selected):not(.new)` class rule.
17. Rebinding a pooled `Row` from a dirty record to a clean one removes the
    `dirty` token, and no residue of the previous record's tint survives —
    neither an inline style nor an `#id` declaration.
18. Two `Row` instances showing the same tint share one class rule: the number
    of `ensureStyleRule` calls for `.Row.dirty…` across the pair is one.
19. `Cell` with `readOnly = true` reports `getBackgroundColor()` as the
    read-only token without any code writing `_options.backgroundColor`.

**Manual verification** (`npm run dev`, http://localhost:8015)

20. **Style Audit** section: total stylesheet byte count and duplicate-rule
    count do not regress at any stage, and drop at Stages 3 and 5.
21. **Table** section: scroll a wide table with F12 open — row striping,
    dirty/new tints, selection wash, range selection, read-only shading,
    required-empty ring and the keyboard focus outline all behave as before,
    with no tint bleeding onto a recycled row or cell.
22. **Buttons** / **Toggle Buttons** sections: resting, hover, pressed and
    selected chrome each paint as before, except the pressed-and-selected
    toggle case named in row 13.

---

## Verification

Run from the repo root unless noted.

- `npm run typecheck` — after every step.
- `npm test` (`packages/lib`: `typecheck:test` + `vitest run`) — after every
  step. The suite is ~5100 tests and is the primary regression net for a
  change this wide.
- `npm run lint` and `npm -w packages/lib run test:lint` — the `local/no-raw-dom`
  rule has an empty baseline, so Stage 5's removal of `DOM.sink.apply(..., {
  style })` calls must not introduce a new one.
- `npx vitest run tests/component/default-options-fallback.test.ts` from
  `packages/lib` — the mechanical class-default registry. Every row must stay
  green through Stage 2, which is what proves defaults still reach the DOM.
- Grep invariants, in order:
  - after step 1: `grep -rn 'ClassStyleDefaults' packages/lib/src packages/lib/tests` — only `ownClassStyleDefaults` matches.
  - after step 13: `grep -n '_inheritedStyleBag\|_styleGroupBag\|_overflowX\|_overflowY' packages/lib/src/typescript/lib/core/Component.ts` — zero.
  - after step 17: `grep -rn 'getRestingExclusionSuffixes\|RESTING_ISOLATION_KEYS\|ChromeIsolationEnabled' packages/lib/src` — zero.
  - after step 24: `grep -rn 'writeRuleDeclaration\|reconcileRuleDeclaration\|setReconciledCSSRules\|matchesClassStyle' packages/lib/src` — zero outside comments.
  - after step 29: `grep -rn 'DOM.sink.apply(.*{ *style' packages/lib/src/typescript/lib/component/table packages/lib/src/typescript/lib/component/tree` — zero (the four tint sites are the only inline-style writers in those two trees today).
- `npm run docs:api` — must finish with zero warnings.
- Manual: `npm run dev`, then the **Style Audit**, **Table**, **Tree**,
  **Buttons** and **Toggle Buttons** sections, per Expected Behaviour rows
  20–22.

---

## Documentation Impact

- **ARCHITECTURE.md** — three sections change:
  - *All attributes and styles go through typed setters* → *Always cache in
    memory*: name `_instanceStyle` as the cache for layering properties and
    keep the options bag as the cache for everything else.
  - *Component CSS tiers and state-rule dedup*: replace the manual
    `createStateStyleRule` + `getRestingExclusionSuffixes` recipe with the
    `ownStyleStates` declaration, and state that the `:not(...)` guards and the
    isolation key set are generated.
  - *The class tier is hierarchy-aware*: note that the state tier now shares the
    same declaration and ordering.
- **`packages/lib/docs/reference/changelog/next.md`** — consumer-visible
  entries for: `clearOutline` / `clearOverflowX` / `clearOverflowY` now
  suppressing a class default instead of re-resolving it (row 7); the
  pressed-and-selected `ToggleButton` precedence change (row 13); and the
  stylesheet-size reduction from Stages 3 and 5.
- No `packages/lib/docs/concepts/` page documents the tier mechanism today
  (`grep -rln 'styleGroup\|ownClassStyleDefaults\|StateStyleRule' packages/lib/docs`
  matches only the 0.7.0 changelog), so none needs editing.
- No exported symbol is added or removed, so `typedoc.json`, the barrels and
  `packages/lib/llms.txt` are unaffected. `npm run docs:api` still runs, to
  catch a broken `{@link}` in the rewritten JSDoc.

---

## Potential Challenges

- **The `ClassStyleDefaults` rename touches 152 sites in 32 files.** It is a
  pure type-identifier rename with a compiler backstop; run `npm run typecheck`
  before anything else in Stage 1 and do not mix it with step 3.
- **`resolveDeclarations`'s output must stay byte-identical after the
  `STYLE_WRITERS` split.** Every `.ClassName` rule body is built from it. Run
  `tests/core/ClassStyleRules.test.ts` and `ClassHierarchyCascade.test.ts`
  before continuing.
- **Deriving the resting guard from `ownStyleStates` widens `Button`'s resting
  suffix from `:not(.pressed)` to `:not(.pressed):not(:hover)`.** That closes a
  latent gap where a per-instance resting background outranked the class-tier
  hover rule, but it does change emitted CSS — Expected Behaviour row 12 pins
  it, and row 22 checks it live.
- **Pseudo-class states carry no DOM token,** so `_activeStates` and the
  browser can disagree about `:hover`. Only components that already track their
  own hover state may call `setStyleState(":hover", …)`; everything else leaves
  `:hover` untracked and accepts that `getX()` reports the resting value while
  hovered. Note it in `setStyleState`'s JSDoc.
- **Stage 5 changes the hot pooled paths.** `setStyleState` must stay a class
  toggle plus a cache clear — no rule materialisation, no resolver walk — or
  the per-scroll-tick cost the four bypass comments exist to avoid comes back.
  Check the Style Audit panel and a scroll trace before merging Stage 5.
- **`Body._updateFocusStyle` currently clears every cell of every pooled row on
  every render pass.** Step 27 narrows that to the previously-focused cell;
  keep the full sweep as a fallback when the previous cell is no longer in the
  pool.
- **`setId` re-runs `applyStyle` and rebuilds `_styleRule`** ([core/Component.ts:1754](packages/lib/src/typescript/lib/core/Component.ts#L1754)).
  `_instanceStyle` must survive that rebuild — it is the cache, not the rule.

---

## Critical Files

| File | Why |
|---|---|
| [core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) | The mechanism. `ResolvedClassLevel` ([:291](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L291)) is the precedent the whole plan generalises; `resolveClassLevel` ([:381](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L381)) and `resolveClassStateLevel` ([:479](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L479)) are the two walks to mirror. |
| [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) | `matchesClassStyle` ([:4840](packages/lib/src/typescript/lib/core/Component.ts#L4840)), `applyStyle` ([:5013](packages/lib/src/typescript/lib/core/Component.ts#L5013)) and the six phase methods below it. |
| [core/StyleTarget.ts](packages/lib/src/typescript/lib/core/StyleTarget.ts) | The dirty-bag/flush buffer every layer writes through; `hasQueuedDeclarations` ([:108](packages/lib/src/typescript/lib/core/StyleTarget.ts#L108)) is the "is this rule worth inserting" gate. |
| [component/list/AbstractSelectableList.ts](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts) | The precedent for Stage 5: a pooled row whose per-record state is a shared class rule ([:238](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L238)) toggled by a class-list write ([:576](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L576)). |
| [component/input/Text.ts](packages/lib/src/typescript/lib/component/input/Text.ts) | `applyLineHeightValueClass` ([:1155](packages/lib/src/typescript/lib/component/input/Text.ts#L1155)) is the value-keyed shared-class precedent Stage 4 hoists onto `Component`. |
| [component/button/Button.ts](packages/lib/src/typescript/lib/component/button/Button.ts) | The state-tier reference implementation, and the source of the non-CSS side effects the new write path must preserve (`_syncGlyphSize` [:1667](packages/lib/src/typescript/lib/component/button/Button.ts#L1667), reached from `recomputePreferredSize` [:2369](packages/lib/src/typescript/lib/component/button/Button.ts#L2369)). |
| [tests/core/ClassStyleRules.test.ts](packages/lib/tests/core/ClassStyleRules.test.ts) | The `declarationsDuring` helper and the per-file unique-class-name discipline every new test must follow. |
| [tests/component/default-options-fallback.test.ts](packages/lib/tests/component/default-options-fallback.test.ts) | The mechanical class-default registry; add no rows, break no rows. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | *Three non-negotiable rules for every DOM write*, *Component CSS tiers and state-rule dedup*, *Defer DOM work to render time*. |

---

## Non-Goals

- **Non-layering style properties stay where they are.** `transform`,
  `transformOrigin`, `opacity`, `zIndex`, `transition`, `willChange`,
  `pointerEvents`, `writingMode`, `touchAction`, `contain`, `animation`,
  `animationPlayState`, `appearance`, `borderImage`, `clipPath`, `colorScheme`,
  `background` (the shorthand), `verticalAlign`, `insets` and the geometry
  fields are written as inline styles or as unconditional `#id` declarations
  that no shared tier ever supplies. Layering them buys nothing and would
  double the blast radius.
- **`_options` is not removed.** It remains the cache for every non-layering
  option-backed field.
- **No new theme tier.** Theming resolves underneath every layer through
  `var(--token, fallback)` and is untouched.
- **No change to how `ownClassStyleDefaults` is authored.** The static field
  name and its own-property read are unchanged; the 27 declarations change only
  their type annotation, from `ClassStyleDefaults` to `StyleBag`.
- **`Text` is not the pilot.** The mechanism lands in `core/`, where the whole
  suite exercises it; `Text` is migrated in Stage 4, after Stages 1–3 have
  proven the mechanism, because it is the most entangled base
  class.[^why-not-text]
- **No performance work beyond not regressing.** The resolution cache exists to
  hold the line in the pooled Table/Tree paths, not to make them faster.

---

## Notes

[^shape-inventory]: Verified by reading `core/Component.ts` end to end. The nine
    shapes: (1) key-presence folding getter over `_options` + `_defaultOptions`
    — `getBackgroundColor` ([:2255](packages/lib/src/typescript/lib/core/Component.ts#L2255)),
    `getForegroundColor`, `getCursor`, `getUserSelect`, `isVisible`,
    `getPadding`, `getTouchAction`; (2) nullish-coalescing folding getter, which
    cannot tell *cleared* from *never-set* — `getPointerEvents`,
    `getWritingMode`, `getZIndex`, `getInsets`, `isDisplayed`,
    `getMinSizeConstraint` ([:3031](packages/lib/src/typescript/lib/core/Component.ts#L3031)),
    `getMaxSizeConstraint`; (3) options-only getter with the default kept on the
    dispatch path via `applyChromeOptions` ([:733](packages/lib/src/typescript/lib/core/Component.ts#L733))
    — `getBackgroundImage`, `getBorderRadius`, `getShadow`; (4) raw private
    field with no options entry — `_appearance`, `_contain`, `_animation`,
    `_whiteSpace`, `_verticalAlign`, `_boxSizing`, `_position`; (5) raw private
    field *shadowing* an existing `ComponentOptions` field, so the class default
    never folds — `_transform`, `_transformOrigin`, `_transition`,
    `_willChange`, `_opacity`; (6) raw field with a `_defaultOptions` fallback,
    under a different key for two of the three — `_outline`
    ([:469](packages/lib/src/typescript/lib/core/Component.ts#L469)),
    `_overflowX`/`_overflowY` ([:450](packages/lib/src/typescript/lib/core/Component.ts#L450));
    (7) parsed/normalised field — `_border` plus the `_borderWidths`
    measurement cache; (8) the shared class/group tiers, five module-level
    `Map`s in `core/ClassStyleRules.ts`; (9) `StateStyleRule`
    ([core/ClassStyleRules.ts:957](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L957)),
    a parallel mechanism writing a different selector that `matchesClassStyle`
    never consults. Table and Tree add a tenth by bypassing all nine.

[^two-bugs]: Both are documented in shipped plans and both were fixed with a
    per-class workaround rather than a structural change. **One:**
    `plans/implemented/glyph-preferredsize-reconciled-write-path.md` records
    that `Glyph.applyOptions` re-pins `minSize`/`maxSize` from inside the
    `super()` cascade, when `_inheritedStyleBag` is still `null`, so
    `matchesClassStyle` returns `false` unconditionally and a real declaration
    is queued. Its `matches-class-style-null` footnote quotes
    `setReconciledCSSRules`'s own doc comment: "Inert before the first render,
    when `_inheritedStyleBag` is still null." **Two:**
    `plans/implemented/label-text-class-defaults-followups.md` records the same
    null-bag gap for a construction-time `Text.setFontSize` call, compounded by
    `writeFontDeclaration` routing through `writeRuleDeclaration`, which *skips*
    on a match rather than queuing a removal — so the stale construction-time
    value survives to `#id`. The fix shipped there is a per-subclass
    `applySubclassStyles` override calling `reconcileRuleDeclaration` by hand.
    Under this plan the instance layer holds the value and the flush compares
    once, after every layer exists, so neither workaround is needed.

[^supersedes-v070]: 22 of the 33 plans landed for v0.7.0 (`git log
    v0.6.0..v0.7.0`) are instances of the pattern this plan generalises —
    either a manual clear-on-match migration for one more property, a
    hand-rolled state-tier dedup for one more component, or a bug-fix for the
    same null-bag-comparison root cause as [^two-bugs]. Concretely deleted by
    name: `plans/implemented/button-resting-chrome-state-isolation.md` and
    `plans/implemented/state-chrome-isolation-generalization.md` built
    `RESTING_ISOLATION_KEYS` and `getRestingExclusionSuffixes()`'s six
    overrides, both removed at step 17; `plans/implemented/state-style-rule-auto-dedup.md`
    built the `writePressedDeclaration`/`writePressedDeclarations`/
    `materialisePressedRule` wrapper trio that plan's own Overview says "took
    two attempts" because of the same never-materialises-until-a-later-write
    gap, replaced by `ownStyleStates` at step 18;
    `plans/implemented/text-applystyle-class-hoisting.md`'s
    `writeFontDeclaration` and its eleven `applySubclassStyles` calls are
    retired at step 22; `plans/implemented/text-lineheight-write-path-and-value-class-sharing.md`'s
    value-keyed class mechanism is hoisted onto `Component.setValueStyleState`
    at step 23; `plans/implemented/suppress-empty-style-rules.md` patched
    three separate `ensure()` guard sites for the same
    nothing-real-queued-yet bug this plan closes with one flush point.
    `plans/implemented/reconciled-write-path-widening.md`,
    `component-borderradius-visibility-write-path-cleanup.md`,
    `checkbox-radio-delegate-state-style-defaults.md`,
    `state-tier-rule-dedup-followups.md`, `delegate-class-style-defaults-followups.md`,
    `hoist-button-tabbar-state-chrome-rules.md`, `table-cell-class-style-defaults.md`,
    `number-renderer-align-stylegroup.md` and `checkboxbox-borderradius-hoist.md`
    are each a single-property or single-component instance of the same
    recipe this plan makes declarative — not deleted (the property or
    component each touches still needs an `ownClassStyleDefaults`/
    `ownStyleStates` entry), but the recipe becomes a declaration instead of
    its own plan. **Not** superseded:
    `plans/implemented/class-hierarchy-cascade.md` and
    `plans/implemented/shared-instance-style-groups.md` built the class-tier
    and group-tier mechanisms [^layer-precedent] promotes into `StyleLayer` —
    they are the foundation this plan builds on, not prior art it replaces.

[^layer-precedent]: The alternative was a fresh abstraction with its own cache
    keying. Rejected: `resolveClassLevel` already memoizes `{ defaults,
    resolved }` per constructor in `_levels`
    ([core/ClassStyleRules.ts:304](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L304)),
    `resolveClassStateLevel` does the same per `(ctor, suffix)` in
    `_stateLevels`, and `ensureStyleGroupRule` per `(ctor, group)` in
    `_groupBags`. Naming the existing pair keeps all five module caches intact,
    which the brief requires, and makes the diff a rename plus a return-type
    widening rather than a rewrite.

[^metaclass-above-instance]: Putting the instance layer above active
    meta-classes would make `getBackgroundColor()` on a pressed button report
    the resting value while the browser paints the pressed one. It would also
    contradict the existing resting-isolation mechanism, whose entire purpose
    ([core/Component.ts:4945](packages/lib/src/typescript/lib/core/Component.ts#L4945))
    is to stop a bare `#id` resting declaration from outranking a class-tier
    state rule. Because the scan is per key and a layer only "declares" keys it
    carries, a meta-class that declares three properties leaves every other
    property to the instance layer, which is exactly what the `:not(...)`-guarded
    resting rule produces in CSS.

[^collapse-class-chain]: The alternative was to give each ancestor class its own
    live layer. Rejected on two grounds. Cost: `resolveStyleValue` would become
    O(hierarchy depth) on a path called from pooled Table/Tree recycling, where
    `Cell` sits four levels deep. Benefit: none — the CSS side already gets a
    real cascade from the separate `.ClassName` rules `resolveClassLevel`
    inserts, and the JS side only ever needs the merged answer. The merged pair
    is computed once per constructor and shared by every instance, which is what
    the brief's "must be preserved, not regressed" caching requirement means.

[^generated-suffixes]: Today the guards are hand-written strings —
    `":hover:not(.pressed)"` in `Button`
    ([:616](packages/lib/src/typescript/lib/component/button/Button.ts#L616)),
    `".selected:not(:hover)"` in `ToggleButton`
    ([:45](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L45)),
    `":hover:not(.selected)"` in `RailHandle` — and each encodes a pairwise
    precedence decision nowhere else recorded. Generating them from one ordered
    declaration means the JS resolver and the CSS cascade cannot disagree, which
    they otherwise would the moment someone edits one and not the other.

[^toggle-cycle]: Today's arbitration is genuinely cyclic on `ToggleButton`.
    `.ToggleButton.selected:not(:hover)` has specificity `(0,3,0)` and
    `.ToggleButton.pressed` has `(0,2,0)`, so **selected beats pressed**.
    `.selected:not(:hover)` cannot match while hovered, so **hover beats
    selected**. `:hover:not(.pressed)` cannot match while pressed, so **pressed
    beats hover**. No total order reproduces all three, so any explicit ordering
    changes at least one case. `pressed > hover > selected` is chosen because a
    press is the most transient and most direct feedback, and because it
    preserves the two cases a user sees constantly (hover on a selected toggle,
    press on an unselected one) while changing only the rare
    pressed-and-selected frame. `.selected` and `.pressed` declare the same
    three properties (`boxShadow`, `backgroundColor`, `backgroundImage` —
    [ToggleButton.ts:54](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L54)),
    so the change is visible rather than inert.

[^derived-isolation]: `RESTING_ISOLATION_KEYS` is a fixed set of three
    properties chosen because they were the ones `Button` deviated on. Any class
    whose state layer declares a fourth property is silently unprotected today —
    the `Button` hover gap in `## Potential Challenges` is one instance. Deriving
    the set from the declarations makes it correct by construction and deletes
    two members plus six overrides.

[^typed-resolver]: A raw `Record<string, string | null>` on the public surface
    would lose `getMinSizeConstraint(): Size | null`,
    `getBorder(): BorderOptions | null` and `getLineHeight(): number`, all of
    which return non-string authored types. Storing authored values (not CSS
    strings) in the layer and serialising through `STYLE_WRITERS` is what keeps
    the round trip lossless; it is also what `resolveClassLevel` already does by
    carrying `defaults` alongside `resolved`.

[^options-deviation]: ARCHITECTURE.md's rule exists to guarantee that reads come
    from memory rather than the DOM and that one channel owns each value. Both
    guarantees hold with `_instanceStyle` as the cache — it is more strictly one
    channel than today, where a layering property can be cached in `_options`,
    in a raw field, or in both. The `ComponentOptions` field and the
    `applyOptions` dispatch are unchanged, so the construction-time and
    post-construction APIs stay in lockstep, which is what the rule's third
    clause requires.

[^resolution-cache]: Without a cache, `resolveStyleValue` walks up to six layers
    per call. That is cheap in isolation but sits on paths the project has
    already measured and tuned: `Cell._applyStateTint`'s own comment
    ([table/cell/Cell.ts:413](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L413))
    names re-materialising a pooled cell's `#id` rule "on every recycle pass" as
    the cost it exists to avoid, and `Body.bindAndPositionRows` /
    `Row.setColumnWindow` call the tint updaters per row and per cell per scroll
    tick. Class and framework layers are frozen per process, so only three
    events can change an answer: an instance-layer write, a meta-class toggle,
    and `setStyleGroup`.

[^outline-name-correction]: The scoping brief listed all three getters as
    falling back to a *differently-named* `_defaultOptions` key. Reading them
    confirms that only two do: `getOverflowX` and `getOverflowY` fall back to
    `_defaultOptions.overflow`, but `getOutline` falls back to
    `_defaultOptions.outline` — a matching name. `getOutline` is still in scope,
    for the other half of the inconsistency all three share: none uses the
    key-presence test the neighbouring getters use, so `clearOutline()` /
    `clearOverflowX()` / `clearOverflowY()` re-resolve the class default instead
    of suppressing it, contrary to ARCHITECTURE.md's *Class-level defaults must
    survive the getter*.

[^class-write-trap]: `SelectableListRow.applyRowClass`
    ([component/list/AbstractSelectableList.ts:576](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L576))
    rewrites the whole `class` attribute and carries a comment explaining that
    it must re-state `COMPONENT_CLASS`, because `position: absolute` lives on
    `:where(.ts-ui-component)` and dropping it collapses every row to `top:
    auto`. `Text.applyLineHeightValueClass`
    ([input/Text.ts:1155](packages/lib/src/typescript/lib/component/input/Text.ts#L1155))
    uses `addClass`/`removeClass` instead and has no such hazard. The new
    mechanism follows `Text`.

[^tint-precedent]: All four sites carry near-identical comments naming the same
    cause — routing through a cached `Component` setter would persist the tint
    into `_options` and replay it onto the next record bound to the reused DOM
    slot — plus, for `Cell`, the cost of re-materialising the `#id` rule on
    every recycle pass. A DOM class token has neither problem: it is not cached
    in `_options`, removing it is exact, and the declaration lives on a shared
    class rule that is written once per class per process. The four sites are
    `Cell._applyStateTint` ([table/cell/Cell.ts:406](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L406)),
    `Row.updateVisualState` ([table/Row.ts:288](packages/lib/src/typescript/lib/component/table/Row.ts#L288)),
    `Body.updateRowVisualState` ([table/Body.ts:2126](packages/lib/src/typescript/lib/component/table/Body.ts#L2126))
    with `Body._updateFocusStyle` ([:2185](packages/lib/src/typescript/lib/component/table/Body.ts#L2185)),
    and `Tree._updateSelectionStyle` ([tree/Tree.ts:1266](packages/lib/src/typescript/lib/component/tree/Tree.ts#L1266)).

[^side-effects]: Enumerated by reading `Button.ts`, `Text.ts` and
    `Component.ts`. Layout invalidation: `setMinSize`/`setMaxSize` call
    `_onConstraintSizeChange?.()` ([core/Component.ts:3117](packages/lib/src/typescript/lib/core/Component.ts#L3117));
    `Text`'s `setFontFamily`/`setFontSize`/`setFontWeight`/`setLineHeight`/
    `setTruncate` set `_measurementDirty` and call
    `(getParentComponent() ?? this).scheduleLayout()`. Dependent-child resync:
    `Button._syncGlyphSize` ([:1667](packages/lib/src/typescript/lib/component/button/Button.ts#L1667))
    is reached only through `recomputePreferredSize`
    ([:2369](packages/lib/src/typescript/lib/component/button/Button.ts#L2369)),
    which sixteen `Button` setters call. Colour propagation:
    `setGlyphColor`/`setDescriptionColor` write no CSS on the button and
    delegate to a child's `setForegroundColor`. Attribute writes:
    `setMinSize`/`setMaxSize` write `data-minSize`/`data-maxSize`;
    `Button.setEnabled` writes the `disabled` attribute alongside its opacity
    and cursor writes. Effective visibility: `setVisible`/`setDisplayed` call
    `scheduleEffectiveVisibilityReconcile()`. Measurement caches: `setBorder`
    nulls `_borderWidths` and registers a one-time theme subscription
    ([core/Component.ts:2504](packages/lib/src/typescript/lib/core/Component.ts#L2504)),
    which `clearBorder` does not — an existing asymmetry this plan preserves
    rather than fixes. Overflow: all four overflow setters call
    `refreshWheelScrolling()`; this is the one effect that must also fire for a
    lower-layer value, which is why `onStyleResolved` exists.

[^why-not-text]: `Text` was floated as the pilot. Investigation says no. It
    exercises four of the nine storage shapes at once (folding getters for
    `fontWeight`/`textAlign`, raw derived fields for `_fontSizeCSSRule` and
    `_lineHeightCSSRule`, a value-keyed shared class for numeric line-height,
    and a `getClassStyleDefaults` override feeding a nested `font` sub-bag); it
    has twelve subclasses, five of which declare their own
    `ownClassStyleDefaults` (`SelectableText`, `Link`, `ButtonLabelText`,
    `HeaderCellText`, `NumberRendererText`); its `applySubclassStyles` mixes
    skip-on-match and clear-on-match writers for reasons documented at
    [Text.ts:1538](packages/lib/src/typescript/lib/component/input/Text.ts#L1538);
    and nearly every one of its setters carries a measurement side effect. It is
    the worst available first subject. It is also not needed as one: Stages 1–3
    change `core/` only, so the entire ~5100-test suite exercises the mechanism
    against every component at once, which is a far stronger check than one
    hand-picked pilot.
