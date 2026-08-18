---
touches-shared:
  - packages/lib/src/typescript/lib/core/StyleTarget.ts
  - ARCHITECTURE.md
---

# Hoist Button/TabButton State-Chrome Rules onto Shared Class Rules — Implementation Plan

## Overview

A live-browser audit (CDP-attached to a running app built on this library, reproduced independently against a separate production app consuming the library from npm) found that most of the framework's per-component CSS in the shared `<style id="Base">` sheet is duplicate content. On one demo page, 776 of 833 rules are per-instance (`#id`-scoped) but collapse to only 69 unique bodies — deduping would save roughly 162KB of a 217KB sheet. The dominant contributor, roughly 322 of the 776 per-instance rules, is [`Button`](packages/lib/src/typescript/lib/component/button/Button.ts)'s `.pressed` / `:hover:not(.pressed)` state rules and [`TabButton`](packages/lib/src/typescript/lib/component/button/TabButton.ts)'s per-tab hover/selected state rules — identical bodies repeated across every default-styled instance.[^measurement]

The library already fixed this exact problem for a component's *base* `#id` rule: [`ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) computes a per-concrete-class shared `.ClassName` rule from that class's frozen defaults, and [`Component.writeRuleDeclaration`](packages/lib/src/typescript/lib/core/Component.ts#L4720) skips writing a value into `#id` whenever the shared class rule already delivers it. `Button`'s `.pressed` / `:hover:not(.pressed)` rules and [`ToggleButton`](packages/lib/src/typescript/lib/component/button/ToggleButton.ts)'s `.selected:not(:hover)` rule never got this treatment: they are built via [`Component.createStyleRule`](packages/lib/src/typescript/lib/core/Component.ts#L1009), a *per-instance* suffixed rule, and every setter that writes to them (`setPressedBackgroundColor`, `setHoverShadow`, `setSelectedBackgroundColor`, …) writes straight into that instance's own rule with no comparison against anything shared — so every default-styled instance repeats the identical theme-token declarations into its own `#id.pressed` / `#id:hover:not(.pressed)` / `#id.selected:not(:hover)` rule.

This plan extends the class tier to a second axis — state-suffixed selectors (`.Button.pressed`, `.Button:hover:not(.pressed)`, `.ToggleButton.selected:not(:hover)`, and their per-subclass equivalents) — and routes the `Button` / `ToggleButton` state setters through a comparison against that class's shared bag, exactly mirroring how `writeRuleDeclaration` already does it for the base rule. It touches [`StyleTarget.ts`](packages/lib/src/typescript/lib/core/StyleTarget.ts) (one new optional field on `StyleRuleScope`), [`ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) (a new sibling mechanism to `ensureClassStyleRule`), and three component files: `Button.ts`, `ToggleButton.ts`, and `TabButton.ts`. `Component.ts` is not modified.

---

## Architecture Decisions

### Extend `StyleRuleScope`'s `"class"` case with an optional `suffix`, mirroring `"component"`

[`StyleRuleScope`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L140) already lets `"component"` carry an optional `suffix` (`"#id" + suffix`, e.g. `"#id.pressed"`) but `"class"` only ever produces a bare `".ClassName"`. Add the same `suffix?: string` field to the `"class"` case, so `{ scope: "class", name: "Button", suffix: ".pressed" }` selects `.Button.pressed`. `_selectorOf`'s `"class"` branch becomes `"." + spec.name + (spec.suffix ?? "")` — the identical pattern the `"component"` branch already uses one line below it.

### A new class-tier primitive, `ensureClassStateRule`, sits beside `ensureClassStyleRule`

[`ensureClassStyleRule`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L196) solves one axis: a class's deviation from the framework's *base* `#id` declarations. It cannot be reused as-is for state rules, because there is no framework-level `.pressed` rule to diff against — a state rule's class-tier body is simply "the declarations this concrete class's setters would write when nothing overrides them," with no lower tier to undo. `ensureClassStateRule(ctor, suffix, declarations)` is the two-tier sibling: given an already-resolved declarations bag, it creates (once per `(ctor, suffix)` pair, cached) a `{ scope: "class", name: ctor.name, suffix }` `StyleRule` carrying it, and returns the frozen bag so the caller's setters can skip a matching write. It reuses `ClassStyleRules.ts`'s existing `_owners: Map<string, Function>` name-collision registry unchanged: `.ClassName` and `.ClassName.pressed` both apply to any element carrying CSS class `ClassName`, so a name already claimed by a different constructor must be opted out of *every* suffix, not just the base tier. `_owners` is order-agnostic (first constructor to claim a name wins, regardless of which tier claims it first), so `ensureClassStateRule` firing before `ensureClassStyleRule` ever runs for the same class — which happens routinely, since state setters can fire during construction while `ensureClassStyleRule` only runs at first render — is safe.[^owners-order]

### The class-tier body is derived from `_defaultOptions`, wherever the field lives there — and is override-able per subclass

For the four `Button` fields that are both defaulted (in [`_defaultButtonOptions`](packages/lib/src/typescript/lib/component/button/Button.ts#L223)) and unconditionally dispatched (in [`applyChromeOptions`](packages/lib/src/typescript/lib/component/button/Button.ts#L861)), a new protected `getPressedClassDeclarations()` / `getHoverClassDeclarations()` pair on `Button` reads `this._defaultOptions` — the same frozen, per-concrete-class bag `ensureClassStyleRule` already reads for the base tier — and returns the CSS-keyed bag. `ToggleButton`'s three selected-state fields are never threaded through the options bag at all (they are hardcoded theme-token literals in its constructor), so its `getSelectedClassDeclarations()` returns a new named module constant instead. Both resolvers are `protected`, mirroring [`Component.getClassStyleDefaults()`](packages/lib/src/typescript/lib/core/Component.ts#L4736)'s existing override contract, so `TabButton` — whose own hover/selected treatment differs from both its parents' — can override them.

### `TabButton` overrides the resolvers rather than getting its own mechanism

`TabButton.applyTabStyling()` ([TabButton.ts:227](packages/lib/src/typescript/lib/component/button/TabButton.ts#L227)) unconditionally writes tab-specific hover border and selected fill+border onto every instance — the second big contributor the audit found. Because `ensureClassStateRule` keys on the *concrete* constructor (`ctor.name`, same as the base tier), `TabButton`'s state rules are already independent of `Button`'s (`.TabButton.pressed` vs `.Button.pressed`) with no extra work. `TabButton` only needs to override `getHoverClassDeclarations()` (merging in its four hover-border keys on top of `super()`'s result, since its hover *fill* already resolves correctly through `_defaultOptions`) and fully replace `getSelectedClassDeclarations()` (its selected fill+border share nothing with `ToggleButton`'s base tokens). No new mechanism, no changes to `applyTabStyling()`'s call sequence — only which literals it reads and two new overrides.

### Every setter that writes to a state rule routes through the same comparison, not just the "defaulted" ones

`writeClassStateDeclaration(rule, bag, key, value)` — the state-tier sibling of `writeRuleDeclaration` — skips the write only when `bag !== null && bag[key] === value`; otherwise it writes to the instance rule exactly as today. All twelve `Button` pressed/hover setters and their `clear*` counterparts (not just the four/three that are class-defaulted) route through it, via `writeManyClassStateDeclarations` for the border setters' four-key bulk writes. This costs nothing for a key the class bag doesn't carry (`bag[key]` is `undefined`, never equal to a real value, so it always falls through to a write — identical to today's behaviour) and is what lets `TabButton`'s override of `getHoverClassDeclarations()` retroactively make the *inherited* `setHoverBorder` setter start deduping, with no change to `Button`'s own setter bodies beyond the initial routing.[^hard-constraint]

### No `:where()` on the new class-tier rules

The framework tier uses `:where()` to force zero specificity so it always loses to both the class and instance tiers regardless of insertion order. The new state-tier rules have no lower tier beneath them to protect — the only relationship that matters is class-tier vs. instance-tier, and an id selector (`#c17.pressed`, specificity `(1,0,1,0)`) already beats any all-class selector (`.Button.pressed`, `(0,0,2,0)`) regardless of class count or insertion order. A plain `.ClassName<suffix>` selector is correct, matching the existing (non-`:where()`) `.ClassName` base-tier rule.

| Selector | Specificity | Wins when |
|---|---|---|
| `#c17.pressed` (instance) | `(1,0,1,0)` | This instance called `setPressedBackgroundColor(...)` with a non-default value |
| `.Button.pressed` (class) | `(0,0,2,0)` | Every other default-styled `Button` |

### Relationship to `plans/suppress-empty-style-rules.md`

That sibling plan (drafted separately; its plan document is complete but, like this one, not yet implemented) fixes `Component.commitCSSRule()` / `materialiseDeferredRules()` inserting an empty `#id { }` / `#id.pressed { }` rule when nothing real is queued. Once this plan lands, most `Button` / `ToggleButton` / `TabButton` instances will queue *nothing* into their per-instance `.pressed` / `:hover:not(.pressed)` / `.selected:not(:hover)` rule (every value matches the class rule), which is exactly the shape that sibling plan's `materialiseWhenNeeded()` guard exists to skip. No `depends-on` is declared: this plan's own byte savings (the duplicate rule *bodies* disappearing) land regardless of implementation order, since the savings are in what gets queued, not in whether an empty rule shell gets inserted afterward — and the sibling plan's `Non-Goals` already anticipated Button/TabBar landing as a follow-up either way. `touches-shared` is declared for `StyleTarget.ts` (the sibling plan adds `hasQueuedDeclarations()` to the `StyleTarget` class body; this plan edits the unrelated `StyleRuleScope` type and `_selectorOf` function in the same file) and `ARCHITECTURE.md` (the sibling plan edits the *Defer DOM work to render time* section; this plan edits the *CSS writes go through `StyleRule` / `InlineStyle`* section) — different regions of both files, flagged only because a worktree-merge on the same file is where a conflict could occur.

### `ToggleButton`'s `.selected` state is in scope

Structurally identical bug, identical fix shape, and required for the audit's own claimed savings: two of the "TabButton" duplicate-rule groups the audit found *are* `TabButton`'s override of `ToggleButton`'s `.selected:not(:hover)` rule (fill and border). Building the generic mechanism for `Button` alone and leaving `ToggleButton` out would leave that part of the reported saving unrealized for a marginal cost (one more resolver + one more lazy getter, reusing the same primitives).

---

## Public API

```typescript
// core/StyleTarget.ts — StyleRuleScope. "class" gains the suffix "component" already has.
export type StyleRuleScope =
    | { scope: "class";     name: string; suffix?: string }
    | { scope: "component"; name: string; suffix?: string }
    | { scope: "selector";  name: string };
```

```typescript
// core/ClassStyleRules.ts — new exports, not added to core/index.ts (module stays internal).

/** Ensures a shared `.ClassName<suffix>` rule exists for `declarations`, cached per (ctor, suffix). */
export function ensureClassStateRule(
    ctor:         Function,
    suffix:       string,
    declarations: Record<string, string | null>,
): Readonly<Record<string, string | null>> | null;

/** Skips writing `key`/`value` into `rule` when `bag` already delivers that exact pair. */
export function writeClassStateDeclaration(
    rule:  StyleRule,
    bag:   Readonly<Record<string, string | null>> | null,
    key:   string,
    value: string | null,
): void;

/** Bulk form of {@link writeClassStateDeclaration}, one call per key of `values`. */
export function writeManyClassStateDeclarations(
    rule:   StyleRule,
    bag:    Readonly<Record<string, string | null>> | null,
    values: Record<string, string | null>,
): void;
```

```typescript
// component/button/Button.ts — new protected, override-able resolvers + private lazy caches.
protected getPressedClassDeclarations(): Record<string, string | null>;
protected getHoverClassDeclarations():   Record<string, string | null>;

private declare _pressedClassBag?: Readonly<Record<string, string | null>> | null;
private declare _hoverClassBag?:   Readonly<Record<string, string | null>> | null;
private get pressedClassBag(): Readonly<Record<string, string | null>> | null;
private get hoverClassBag():   Readonly<Record<string, string | null>> | null;
```

```typescript
// component/button/ToggleButton.ts — new protected resolver + private lazy cache.
protected getSelectedClassDeclarations(): Record<string, string | null>;

private declare _selectedClassBag?: Readonly<Record<string, string | null>> | null;
private get selectedClassBag(): Readonly<Record<string, string | null>> | null;
```

```typescript
// component/button/TabButton.ts — overrides, no new public surface.
protected override getHoverClassDeclarations():    Record<string, string | null>;
protected override getSelectedClassDeclarations(): Record<string, string | null>;
```

No consumer-facing signature changes anywhere: every new/changed member is `protected` or `private`, so nothing in `docs/` or `core/index.ts`/the package barrel changes.

---

## Internal Structure

### `core/StyleTarget.ts` — `_selectorOf`

```typescript
function _selectorOf(spec: StyleRuleScope): string {
    switch (spec.scope) {
        case "class":     return "." + spec.name + (spec.suffix ?? "");
        case "component": return "#" + DOM.source.escapeSelector(spec.name) + (spec.suffix ?? "");
        case "selector":  return spec.name;
    }
}
```

### `core/ClassStyleRules.ts` — the new state-tier primitives

Placed after the existing `ensureClassStyleRule`, reusing the module's existing `_owners` map and the already-defined `ClassStyleBag` type (`Readonly<Record<string, string | null>>`) as the return type — no new type is introduced.

```typescript
// (ctor -> (suffix -> bag)). Parallel to `_bags`, but keyed on suffix too, since
// one class can own several state rules (Button: .pressed, :hover:not(.pressed)).
const _stateBags: Map<Function, Map<string, ClassStyleBag | null>> = new Map();

/**
 * State-rule sibling of {@link ensureClassStyleRule}. Ensures a shared
 * `.ClassName<suffix>` rule exists carrying `declarations` and returns the
 * bag, so the caller's setters can skip a write that already matches it.
 * Cached per `(ctor, suffix)` — the first call for a given class+suffix
 * computes and registers the rule; every later call (any instance, any
 * suffix already seen for that class) returns the cached result.
 *
 * Unlike `ensureClassStyleRule`, there is no framework-level tier beneath a
 * state rule to diff against — `declarations` is the caller's own fully
 * resolved bag, not a set of deviations from a lower tier.
 *
 * @param ctor - The concrete component class constructor.
 * @param suffix - The selector suffix, verbatim (e.g. `".pressed"`,
 *   `":hover:not(.pressed)"`), matching whatever the instance rule's own
 *   `createStyleRule(suffix)` call uses.
 * @param declarations - This class's resolved declarations for the
 *   suffixed state.
 *
 * @returns The declarations bag, or `null` when `ctor`'s name is empty or
 *   already claimed by a different constructor (the same name-collision
 *   opt-out `ensureClassStyleRule` uses) — the caller must then write every
 *   declaration to its own instance rule.
 */
export function ensureClassStateRule(
    ctor: Function,
    suffix: string,
    declarations: Record<string, string | null>,
): ClassStyleBag | null {
    let bySuffix = _stateBags.get(ctor);
    if (!bySuffix) {
        bySuffix = new Map();
        _stateBags.set(ctor, bySuffix);
    }

    const existing = bySuffix.get(suffix);
    if (existing !== undefined) {
        return existing;
    }

    const name  = ctor.name;
    const owner = _owners.get(name);

    if (!name || (owner !== undefined && owner !== ctor)) {
        bySuffix.set(suffix, null);

        return null;
    }

    _owners.set(name, ctor);

    if (Object.keys(declarations).length > 0) {
        new StyleRule({ scope: "class", name, suffix, styles: declarations });
    }

    const bag = Object.freeze({ ...declarations });
    bySuffix.set(suffix, bag);

    return bag;
}

/**
 * Routes one state-rule declaration to the rule that should carry it:
 * dropped when `bag` already delivers the same key/value, written to `rule`
 * otherwise. `writeRuleDeclaration`'s shape, generalised to take the target
 * rule and comparison bag as parameters instead of reading `this._styleRule`
 * / `this._inheritedStyleBag` — a state-rule setter can fire from many call
 * sites (construction, a runtime setter, a chrome-mode toggle), not from one
 * `applyStyle` pass, so there is no single per-render cache to read from.
 */
export function writeClassStateDeclaration(
    rule: StyleRule,
    bag: ClassStyleBag | null,
    key: string,
    value: string | null,
): void {
    if (bag !== null && bag[key] === value) {
        return;
    }

    rule.set(key, value);
}

/** Bulk form of {@link writeClassStateDeclaration}, one call per key of `values`. */
export function writeManyClassStateDeclarations(
    rule: StyleRule,
    bag: ClassStyleBag | null,
    values: Record<string, string | null>,
): void {
    for (const key of Object.keys(values)) {
        writeClassStateDeclaration(rule, bag, key, values[key]);
    }
}
```

### `component/button/Button.ts` — resolvers and lazy bags

Placed directly below the existing `pressedStyleRule` / `hoverStyleRule` lazy getters ([Button.ts:541-558](packages/lib/src/typescript/lib/component/button/Button.ts#L541-L558)):

```typescript
private declare _pressedClassBag?: Readonly<Record<string, string | null>> | null;
private get pressedClassBag(): Readonly<Record<string, string | null>> | null {
    return this._pressedClassBag ??= ensureClassStateRule(this.constructor, ".pressed", this.getPressedClassDeclarations());
}

private declare _hoverClassBag?: Readonly<Record<string, string | null>> | null;
private get hoverClassBag(): Readonly<Record<string, string | null>> | null {
    return this._hoverClassBag ??= ensureClassStateRule(this.constructor, ":hover:not(.pressed)", this.getHoverClassDeclarations());
}

/**
 * This class's resolved `.pressed`-state declarations, derived from
 * `_defaultOptions` — the same frozen, per-concrete-class bag the base `#id`
 * tier reads. Only the four fields Button both defaults and dispatches
 * unconditionally (see `applyChromeOptions`) are included; `pressedBorder`
 * and `pressedBorderRadius` have no Button-level default and stay
 * caller-only, so they are absent here (a subclass may still add them by
 * overriding this method — see `TabButton`).
 */
protected getPressedClassDeclarations(): Record<string, string | null> {
    const d = this._defaultOptions;
    const out: Record<string, string | null> = {};

    if (d.pressedBackgroundColor !== undefined) out.backgroundColor = d.pressedBackgroundColor;
    if (d.pressedBackgroundImage !== undefined) out.backgroundImage = d.pressedBackgroundImage;
    if (d.pressedForegroundColor !== undefined) out.color           = d.pressedForegroundColor;
    if (d.pressedShadow          !== undefined) out.boxShadow       = d.pressedShadow;

    return out;
}

/** Hover-state counterpart of {@link getPressedClassDeclarations}. */
protected getHoverClassDeclarations(): Record<string, string | null> {
    const d = this._defaultOptions;
    const out: Record<string, string | null> = {};

    if (d.hoverBackgroundColor !== undefined) out.backgroundColor = d.hoverBackgroundColor;
    if (d.hoverBackgroundImage !== undefined) out.backgroundImage = d.hoverBackgroundImage;
    if (d.hoverShadow          !== undefined) out.boxShadow       = d.hoverShadow;

    return out;
}
```

Every pressed/hover setter and clearer swaps its direct `.set(...)` / `.setMany(...)` call for the routed form. Two representative examples (the other ten follow identically — see the worked table in Ordered Implementation Steps):

```typescript
setPressedBackgroundColor(backgroundColor: string): this {
    this._options.pressedBackgroundColor = backgroundColor;
    writeClassStateDeclaration(this.pressedStyleRule, this.pressedClassBag, "backgroundColor", backgroundColor);

    return this;
}

setHoverBorder(options?: BorderOptions | string): this {
    this._hoverBorder = typeof options === "string" ? { border: options } : (options ?? {});
    writeManyClassStateDeclarations(this.hoverStyleRule, this.hoverClassBag, borderToStyle(this._hoverBorder));

    return this;
}
```

### `component/button/ToggleButton.ts` — the selected-state resolver

```typescript
/**
 * `ToggleButton`'s own default `.selected:not(:hover)` declarations. Unlike
 * Button's pressed/hover fields, these are never threaded through the
 * options bag — the constructor writes them as literal theme tokens — so
 * this is a plain module constant rather than an `_defaultOptions` read.
 */
const TOGGLE_SELECTED_DECLARATIONS: Readonly<Record<string, string | null>> = Object.freeze({
    boxShadow:       "var(--ts-ui-toggle-selected-shadow, 2px 2px 1px inset grey)",
    backgroundColor: "var(--ts-ui-toggle-selected-bg, rgb(200, 200, 200))",
    backgroundImage: "var(--ts-ui-toggle-selected-bg, none)",
});

private declare _selectedClassBag?: Readonly<Record<string, string | null>> | null;
private get selectedClassBag(): Readonly<Record<string, string | null>> | null {
    return this._selectedClassBag ??= ensureClassStateRule(this.constructor, ".selected:not(:hover)", this.getSelectedClassDeclarations());
}

/** This class's resolved `.selected:not(:hover)` declarations. Override for a subclass whose selected treatment differs (see `TabButton`). */
protected getSelectedClassDeclarations(): Record<string, string | null> {
    return TOGGLE_SELECTED_DECLARATIONS;
}
```

The constructor's three raw writes become calls to the (now-routed) setters, so construction-time state goes through the same comparison as every other call site:

```typescript
this.setSelectedShadow(TOGGLE_SELECTED_DECLARATIONS.boxShadow!);
this.setSelectedBackgroundColor(TOGGLE_SELECTED_DECLARATIONS.backgroundColor!);
this.setSelectedBackgroundImage(TOGGLE_SELECTED_DECLARATIONS.backgroundImage!);
```

### `component/button/TabButton.ts` — the two overrides

Named constants replace the literals currently inline in `applyTabStyling()`, so the setter calls and the new resolvers share one source of truth:

```typescript
import { BorderOptions, borderToStyle } from "~/primitive/Border.js";

const TAB_BUTTON_HOVER_BORDER: BorderOptions = {
    borderTop:    "var(--ts-ui-tab-button-hover-border-top,    var(--ts-ui-tab-button-hover-border, none))",
    borderRight:  "var(--ts-ui-tab-button-hover-border-right,  var(--ts-ui-tab-button-hover-border, none))",
    borderBottom: "var(--ts-ui-tab-button-hover-border-bottom, var(--ts-ui-tab-button-hover-border, none))",
    borderLeft:   "var(--ts-ui-tab-button-hover-border-left,   var(--ts-ui-tab-button-hover-border, none))",
};

const TAB_BUTTON_SELECTED_BORDER: BorderOptions = {
    borderTop:    "var(--ts-ui-tab-button-selected-border-top,    var(--ts-ui-tab-button-selected-border, none))",
    borderRight:  "var(--ts-ui-tab-button-selected-border-right,  var(--ts-ui-tab-button-selected-border, none))",
    borderBottom: "var(--ts-ui-tab-button-selected-border-bottom, var(--ts-ui-tab-button-selected-border, none))",
    borderLeft:   "var(--ts-ui-tab-button-selected-border-left,   var(--ts-ui-tab-button-selected-border, none))",
};

const TAB_BUTTON_SELECTED_FILL = {
    backgroundColor: "var(--ts-ui-tab-button-selected-bg, rgb(255, 255, 255))",
    backgroundImage: "var(--ts-ui-tab-button-selected-bg, rgb(255, 255, 255))",
    boxShadow:       "none",
} as const;
```

```typescript
private applyTabStyling(options?: TabButtonOptions): void {
    this.setHoverBorder(options?.hoverBorder ?? TAB_BUTTON_HOVER_BORDER);

    this.setSelectedBackgroundColor(TAB_BUTTON_SELECTED_FILL.backgroundColor);
    this.setSelectedBackgroundImage(TAB_BUTTON_SELECTED_FILL.backgroundImage);
    this.setSelectedShadow(TAB_BUTTON_SELECTED_FILL.boxShadow);
    this.setSelectedBorder(TAB_BUTTON_SELECTED_BORDER);
}

/** Adds TabButton's hover-border longhands on top of Button's own hover-fill resolution (which already picks up `_defaultTabButtonOptions.hoverX` via `_defaultOptions`). */
protected override getHoverClassDeclarations(): Record<string, string | null> {
    return { ...super.getHoverClassDeclarations(), ...borderToStyle(TAB_BUTTON_HOVER_BORDER) };
}

/** Fully replaces ToggleButton's base selected declarations — TabButton's tokens share nothing with them. */
protected override getSelectedClassDeclarations(): Record<string, string | null> {
    return { ...TAB_BUTTON_SELECTED_FILL, ...borderToStyle(TAB_BUTTON_SELECTED_BORDER) };
}
```

`options?.hoverBorder` (a genuine per-instance override) still bypasses the class default entirely, exactly as it does today — only the fallback literal moved into a named constant the resolver also reads.

---

## Ordered Implementation Steps

1. **`core/StyleTarget.ts`** — add `suffix?: string` to the `"class"` arm of `StyleRuleScope` ([line 140-143](packages/lib/src/typescript/lib/core/StyleTarget.ts#L140-L143)) and update `_selectorOf`'s `"class"` case ([line 173-179](packages/lib/src/typescript/lib/core/StyleTarget.ts#L173-L179)) per Internal Structure. Extend the `StyleRuleScope` JSDoc's `class` bullet ([line 129](packages/lib/src/typescript/lib/core/StyleTarget.ts#L129)) to mention the suffix, mirroring the existing `component` bullet's wording.
   Check: `npm run typecheck` from `packages/lib` — clean.

2. **`core/ClassStyleRules.ts`** — add `_stateBags`, `ensureClassStateRule`, `writeClassStateDeclaration`, `writeManyClassStateDeclarations` after the existing `ensureClassStyleRule` (end of file), per Internal Structure. The three new exports use the module's existing (unexported) `ClassStyleBag` type only as an inferred return/parameter type — no new `export` keyword is needed on the type itself. Extend the top-of-file comment ([line 3-8](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L3-L8)) to say the module now also backs `Button` / `ToggleButton`'s state-rule dedup, alongside the base tier.
   Check: `grep -n 'ClassStyleRules' packages/lib/src/typescript/lib/core/index.ts` — zero matches (stays internal, matching `ensureClassStyleRule`).

3. **`component/button/Button.ts`** — add the import `import { ensureClassStateRule, writeClassStateDeclaration, writeManyClassStateDeclarations } from "~/core/ClassStyleRules.js";` beside the existing `StyleRule` import ([line 14](packages/lib/src/typescript/lib/component/button/Button.ts#L14)). Add `getPressedClassDeclarations` / `getHoverClassDeclarations` and the two lazy `*ClassBag` getters directly below `hoverStyleRule` ([line 541-558](packages/lib/src/typescript/lib/component/button/Button.ts#L541-L558)), per Internal Structure.

4. **`component/button/Button.ts`** — route all twelve pressed/hover setters and their twelve `clear*` counterparts through the new helpers. Single-key setters/clearers call `writeClassStateDeclaration(rule, bag, key, value)` in place of `rule.set(key, value)`; the two border setters/clearers call `writeManyClassStateDeclarations(rule, bag, values)` in place of `rule.setMany(values)`.

   | Method | Rule / bag | CSS key(s) | In `Button`'s base resolver? |
   |---|---|---|---|
   | `setPressedBackgroundColor` / `clearPressedBackgroundColor` ([2184](packages/lib/src/typescript/lib/component/button/Button.ts#L2184), [2196](packages/lib/src/typescript/lib/component/button/Button.ts#L2196)) | pressed | `backgroundColor` | Yes — `_defaultButtonOptions.pressedBackgroundColor` |
   | `setPressedBackgroundImage` / `clearPressedBackgroundImage` ([2219](packages/lib/src/typescript/lib/component/button/Button.ts#L2219), [2231](packages/lib/src/typescript/lib/component/button/Button.ts#L2231)) | pressed | `backgroundImage` | Yes — `_defaultButtonOptions.pressedBackgroundImage` |
   | `setPressedForegroundColor` / `clearPressedForegroundColor` ([2254](packages/lib/src/typescript/lib/component/button/Button.ts#L2254), [2266](packages/lib/src/typescript/lib/component/button/Button.ts#L2266)) | pressed | `color` | Yes — `_defaultButtonOptions.pressedForegroundColor` |
   | `setPressedBorder` / `clearPressedBorder` ([2290](packages/lib/src/typescript/lib/component/button/Button.ts#L2290), [2304](packages/lib/src/typescript/lib/component/button/Button.ts#L2304)) | pressed | `borderTop`/`Right`/`Bottom`/`Left` (via `writeManyClassStateDeclarations`) | No — no `_defaultButtonOptions` entry, caller-gated |
   | `setPressedBorderRadius` / `clearPressedBorderRadius` ([2332](packages/lib/src/typescript/lib/component/button/Button.ts#L2332), [2344](packages/lib/src/typescript/lib/component/button/Button.ts#L2344)) | pressed | `borderRadius` | No — no default, caller-gated |
   | `setPressedShadow` / `clearPressedShadow` ([2367](packages/lib/src/typescript/lib/component/button/Button.ts#L2367), [2379](packages/lib/src/typescript/lib/component/button/Button.ts#L2379)) | pressed | `boxShadow` | Yes — `_defaultButtonOptions.pressedShadow` |
   | `setHoverBackgroundColor` / `clearHoverBackgroundColor` ([2402](packages/lib/src/typescript/lib/component/button/Button.ts#L2402), [2414](packages/lib/src/typescript/lib/component/button/Button.ts#L2414)) | hover | `backgroundColor` | Yes — `_defaultButtonOptions.hoverBackgroundColor` |
   | `setHoverBackgroundImage` / `clearHoverBackgroundImage` ([2437](packages/lib/src/typescript/lib/component/button/Button.ts#L2437), [2449](packages/lib/src/typescript/lib/component/button/Button.ts#L2449)) | hover | `backgroundImage` | Yes — `_defaultButtonOptions.hoverBackgroundImage` |
   | `setHoverForegroundColor` / `clearHoverForegroundColor` ([2472](packages/lib/src/typescript/lib/component/button/Button.ts#L2472), [2484](packages/lib/src/typescript/lib/component/button/Button.ts#L2484)) | hover | `color` | No — no default at all, caller-gated |
   | `setHoverBorder` / `clearHoverBorder` ([2510](packages/lib/src/typescript/lib/component/button/Button.ts#L2510), [2524](packages/lib/src/typescript/lib/component/button/Button.ts#L2524)) | hover | `borderTop`/`Right`/`Bottom`/`Left` (via `writeManyClassStateDeclarations`) | No at `Button` — **yes at `TabButton`**, via its resolver override |
   | `setHoverBorderRadius` / `clearHoverBorderRadius` ([2552](packages/lib/src/typescript/lib/component/button/Button.ts#L2552), [2564](packages/lib/src/typescript/lib/component/button/Button.ts#L2564)) | hover | `borderRadius` | No — no default, caller-gated |
   | `setHoverShadow` / `clearHoverShadow` ([2587](packages/lib/src/typescript/lib/component/button/Button.ts#L2587), [2599](packages/lib/src/typescript/lib/component/button/Button.ts#L2599)) | hover | `boxShadow` | Yes — `_defaultButtonOptions.hoverShadow` |

   Every row's *routing* (which helper the setter calls) is identical regardless of the last column — only whether the class bag actually carries that key differs, per Architecture Decisions' "Every setter... routes through the same comparison" decision.

   Do not change `_pressedBorder` / `_hoverBorder` field writes, `_options.X` writes, or any method's signature — only the final `rule.set(...)` / `rule.setMany(...)` line inside each.
   Check: `grep -n 'pressedStyleRule\.\(set\|setMany\)(\|hoverStyleRule\.\(set\|setMany\)(' packages/lib/src/typescript/lib/component/button/Button.ts` — zero matches (every write now goes through the routed helpers).

5. **`component/button/ToggleButton.ts`** — add the same `ClassStyleRules.ts` import. Add `TOGGLE_SELECTED_DECLARATIONS`, `getSelectedClassDeclarations`, and the `selectedClassBag` lazy getter per Internal Structure, placed beside the existing `selectedStyleRule` getter ([line 29-36](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L29-L36)). Replace the constructor's three raw `this.selectedStyleRule.set(...)` calls ([line 50-52](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L50-L52)) with calls to `setSelectedShadow` / `setSelectedBackgroundColor` / `setSelectedBackgroundImage`, reading from `TOGGLE_SELECTED_DECLARATIONS`. Route `setSelectedBackgroundColor` ([160](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L160)), `setSelectedBackgroundImage` ([176](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L176)), `setSelectedShadow` ([190](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L190)) through `writeClassStateDeclaration`, and `setSelectedBorder` ([206](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L206)) through `writeManyClassStateDeclarations`. Leave `setFlat`'s two literal `setSelectedShadow(...)` / `setSelectedBackgroundColor(...)` calls ([230-235](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L230-L235)) untouched — they are a genuine runtime mode switch, not part of this plan's scope, and the setters they call are already routed.
   Check: `grep -n 'selectedStyleRule\.\(set\|setMany\)(' packages/lib/src/typescript/lib/component/button/ToggleButton.ts` — zero matches.

6. **`component/button/TabButton.ts`** — add `import { BorderOptions, borderToStyle } from "~/primitive/Border.js";`. Add the three named constants (`TAB_BUTTON_HOVER_BORDER`, `TAB_BUTTON_SELECTED_BORDER`, `TAB_BUTTON_SELECTED_FILL`) near `_defaultTabButtonOptions` ([line 84](packages/lib/src/typescript/lib/component/button/TabButton.ts#L84)). Rewrite `applyTabStyling()` ([line 227-245](packages/lib/src/typescript/lib/component/button/TabButton.ts#L227-L245)) to read the constants instead of inline literals — same five setter calls, same values, only the literals move. Add the two `getHoverClassDeclarations()` / `getSelectedClassDeclarations()` overrides per Internal Structure.
   Check: `grep -c 'var(--ts-ui-tab-button-hover-border-top' packages/lib/src/typescript/lib/component/button/TabButton.ts` — exactly `1` (the token now lives only in `TAB_BUTTON_HOVER_BORDER`, read from both the setter call and the resolver override). Manual read-through confirms `applyTabStyling()`'s five setter calls produce byte-identical values to today's inline literals.

7. **`ARCHITECTURE.md`** — in the *CSS writes go through `StyleRule` / `InlineStyle`* section, extend the `StyleRuleScope` bullet ("`class` — leading `.` is prepended...") to note it now also accepts an optional suffix, matching `component`'s existing wording for the same feature.

8. **New test file `packages/lib/tests/core/ClassStateRules.test.ts`** — unit tests for `ensureClassStateRule` / `writeClassStateDeclaration` / `writeManyClassStateDeclarations` against local `Component` probes, following `ClassStyleRules.test.ts`'s conventions (uniquely-named local subclasses per test, `declarationsDuring`/`idSelector`/`_ruleCacheHas` helpers copied from that file). Cases 1-6 from Expected Behaviour.

9. **New test file `packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts`** — Button-specific cases 7-10 from Expected Behaviour, using the real `Button` class and `RecordingDOMSink`.

10. **New test file `packages/lib/tests/component/button/ToggleButton.selectedClassHoisting.test.ts`** — ToggleButton-specific case 11.

11. **New test file `packages/lib/tests/component/button/TabButton.stateClassHoisting.test.ts`** — TabButton-specific cases 12-13, mirroring the naming convention of the existing `TabButton.styleRuleDisposal.test.ts`.

12. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`. A pre-existing "no new `_ruleCacheKeys()` entries after dispose" test that happens to run before any other Button-family test in the whole process may observe the new class-tier rules as "leaked." `grep -rln '_ruleCacheKeys\|_ruleCacheHas' packages/lib/tests/` lists every candidate file to check on a failure; `TabButton.styleRuleDisposal.test.ts` is already immune (it warms up with a throwaway instance before capturing its `before` snapshot). If another test fails this way, fix it the same way `plans/implemented/class-scoped-style-rules.md` fixed the equivalent framework-rule collision: add a throwaway warm-up construct+dispose before the `before` snapshot, or exclude the specific permanent selector from what counts as leaked. Never widen the hoist list or skip the assertion.

13. **Run the full verification list** in Verification.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/StyleTarget.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/ToggleButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `ARCHITECTURE.md` |
| Create | `packages/lib/tests/core/ClassStateRules.test.ts` |
| Create | `packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts` |
| Create | `packages/lib/tests/component/button/ToggleButton.selectedClassHoisting.test.ts` |
| Create | `packages/lib/tests/component/button/TabButton.stateClassHoisting.test.ts` |

---

## Expected Behaviour

`declarationsDuring(sink, selector, fn)` / `idSelector(component)` / `_ruleCacheHas` are the existing helpers from `tests/core/ClassStyleRules.test.ts`, copied into the new files per the Ordered Implementation Steps.

| # | Case | Expected | How |
|---|---|---|---|
| 1 | **A default-styled instance's state rule carries no declarations of its own.** A local `class Probe extends Component` that calls `this.createStyleRule(".on").set("color", "red")` unconditionally in its constructor, using `ensureClassStateRule(this.constructor, ".on", { color: "red" })` as the comparison bag. Render two `Probe`s. | The second instance's `#id.on` rule captures **no** `color` declaration — `declarationsDuring(sink, idSelector(second) + '.on', () => second.getElement(true))` is `{}`. | unit |
| 2 | **The class rule exists and carries the declaration.** Same setup as case 1. | `_ruleCacheHas('.Probe.on')` is `true`, and the writes during the *first* instance's render to selector `.Probe.on` contain `color: "red"`. | unit |
| 3 | **A deviating instance still writes its own rule.** A third `Probe` whose constructor additionally calls `writeClassStateDeclaration(this.createStyleRule(".on"), ensureClassStateRule(Probe, ".on", { color: "red" }), "color", "blue")`. | The captured declarations for that instance's `#id.on` contain `color: "blue"` — the id rule beats `.Probe.on` on specificity, so it must actually differ. | unit |
| 4 | **A key absent from the class bag always writes.** A `Probe` variant whose class bag is `{}` (empty declarations). | Any write via `writeClassStateDeclaration` for any key always reaches the instance rule — `bag[key]` is `undefined`, never equal to a real value. | unit |
| 5 | **Two classes sharing a name — the second opts out, same as the base tier.** Two separately-declared local classes both named `Twin`, each calling `ensureClassStateRule(this.constructor, ".on", { color: "red" })` from their own constructor. | `ensureStyleRule` recorded for `.Twin.on` exactly once (the first class); the second class's `ensureClassStateRule` call returns `null`, so its instances write `color` to their own `#id.on` unconditionally. | unit |
| 6 | **Disposing an instance leaves the class-tier state rule intact.** Two `Probe`s from case 1, `destructor()` on both. | No `deleteStyleRule` op for `.Probe.on`; `_ruleCacheHas('.Probe.on')` stays `true`; a third `Probe` constructed afterward still writes no `color` to its own rule. | unit |
| 7 | **A default `Button`'s `.pressed`/`:hover:not(.pressed)` rule carries no declarations.** Render two plain `Button`s. | The second `Button`'s `#id.pressed` and `#id:hover:not(.pressed)` rules capture none of `backgroundColor`/`backgroundImage`/`color`/`boxShadow` (pressed) or `backgroundColor`/`backgroundImage`/`boxShadow` (hover); `_ruleCacheHas('.Button.pressed')` and `_ruleCacheHas('.Button:hover:not(.pressed)')` are both `true`. | unit |
| 8 | **`setPressedBackgroundColor("red")` on one instance still writes `#id.pressed`.** After case 7, call it on the second `Button`. | The captured declarations for that instance's `#id.pressed` contain `backgroundColor: "red"` — `.Button.pressed`'s own `backgroundColor` (the theme-token default) is untouched. | unit |
| 9 | **A caller-gated field (never defaulted) always writes.** `setHoverForegroundColor("red")` on any `Button`. | The captured declarations for `#id:hover:not(.pressed)` contain `color: "red"` — `hoverForegroundColor` is not in `getHoverClassDeclarations()`'s output, so the comparison always falls through, matching today's behaviour exactly. | unit |
| 10 | **`SpinButton`'s constructor-time `clearPressedShadow()` still deviates correctly even though the class rule carries a non-null default.** Construct a `SpinButton` with no `pressedShadow` option. | `.SpinButton.pressed`'s class rule carries `boxShadow` at Button's base token value (inherited via `_defaultOptions`, since `SpinButton` doesn't override `pressedShadow`) — a "dead" declaration no `SpinButton` instance actually uses. Every `SpinButton`'s own `#id.pressed` nonetheless carries `boxShadow: null`, because `clearPressedShadow()`'s `null` never equals the class bag's token string. Rendered result (no shadow) is correct; only the class rule carries one wasted declaration. | unit |
| 11 | **A default `ToggleButton`'s `.selected:not(:hover)` rule carries no declarations.** Render two plain `ToggleButton`s. | The second instance's `#id.selected:not(:hover)` rule captures none of `boxShadow`/`backgroundColor`/`backgroundImage`; `_ruleCacheHas('.ToggleButton.selected:not(:hover)')` is `true`. | unit |
| 12 | **`TabButton` gets its own, independent class-tier rules.** Render one plain `Button`, one plain `ToggleButton`, and two `TabButton`s. | `.TabButton.pressed`, `.TabButton:hover:not(.pressed)`, and `.TabButton.selected:not(:hover)` are all distinct cached selectors from `.Button.pressed` / `.Button:hover:not(.pressed)` / `.ToggleButton.selected:not(:hover)`. The second `TabButton`'s `#id.selected:not(:hover)` rule captures none of `backgroundColor`/`backgroundImage`/`boxShadow`/the four border longhands. | unit |
| 13 | **`TabButton`'s hover-border merge is correct.** After case 12, inspect the first `TabButton`'s contribution to `.TabButton:hover:not(.pressed)`. | It carries `backgroundColor`/`backgroundImage`/`boxShadow` (from `_defaultTabButtonOptions`, via `super.getHoverClassDeclarations()`) **and** all four `borderTop`/`Right`/`Bottom`/`Left` keys (from the override) — proving the merge, not a full replace. | unit |
| 14 | **Visual parity.** The demo app's Button, ToggleButton, and Tab showcases render identically before and after — resting, hover, pressed, and selected chrome for default-styled and explicitly-customized instances alike. | No visible change anywhere. | manual |

---

## Verification

From `packages/lib`:

1. `npx vitest run --no-file-parallelism` — all cases pass, `Errors: 0`, exit code `0`.
2. `npm run typecheck` — clean (matches this branch point's baseline).
3. `npm run typecheck:test`.
4. `npm run lint` — clean.
5. `npm run docs:api` — zero warnings (every new/changed member is `protected`/`private`/internal-module, so nothing new should render — this is a regression check, not an expectation of new doc output).
6. `grep -n 'pressedStyleRule\.\(set\|setMany\)(\|hoverStyleRule\.\(set\|setMany\)(' packages/lib/src/typescript/lib/component/button/Button.ts` — zero matches.
7. `grep -n 'selectedStyleRule\.\(set\|setMany\)(' packages/lib/src/typescript/lib/component/button/ToggleButton.ts` — zero matches.
8. Manual, browser (`npm run dev`, http://localhost:8015): open a Button demo (resting/hover/pressed for both a default and a `pressedBackgroundColor`-customized instance), a ToggleButton demo (selected on/off), and a Tab demo (hover a tab, select a tab, confirm the close-✕ affordance still shows its own hover). Inspect `<style id="Base">` and confirm `.Button.pressed`, `.Button:hover:not(.pressed)`, `.ToggleButton.selected:not(:hover)`, `.TabButton.pressed`, `.TabButton:hover:not(.pressed)`, and `.TabButton.selected:not(:hover)` rules exist, and that a plain default `#id.pressed` rule for an unmodified Button is now empty or absent.

---

## Documentation Impact

None. Every new or changed member is `protected` or `private`; `core/ClassStyleRules.ts` stays out of `core/index.ts`, matching `ensureClassStyleRule`'s existing treatment. No doc page, catalog entry, or sidebar entry changes.

---

## Potential Challenges

- **A class rule can carry a "dead" declaration no instance of that class actually uses**, when a subclass's constructor unconditionally clears a field the class-tier resolver still sees as defaulted (see `SpinButton`, Expected Behaviour case 10). Not a correctness bug — every instance's own `#id` rule still overrides it — only a missed byte saving for that one field. This is the exact same limitation the base tier already accepted for an instance-varying default (`plans/implemented/class-scoped-style-rules.md`'s "A class whose defaults vary per instance" challenge); no new mitigation needed here.
- **Leak-diff tests that don't warm up before capturing their `before` snapshot** may observe a new class-tier state rule as "newly leaked" if they happen to run before any other Button-family test in the process. Mitigation and precedent are in Ordered Implementation Steps 12.
- **`writeManyClassStateDeclarations` calling `writeClassStateDeclaration` once per key** means a border write that is a mix of matching and deviating sides (e.g. top/bottom match the class default, left/right don't) queues only the deviating two — correct (per-property comparison, same as the base tier's per-declaration `writeRuleDeclaration`), but worth stating explicitly since `setMany`'s prior all-or-nothing framing might read as implying all four always travel together.
- **A lazy `*ClassBag` getter's `??=` doesn't "stick" on the name-collision opt-out.** `ensureClassStateRule` can return `null` (a different constructor already owns this class name), and `this._pressedClassBag ??= ensureClassStateRule(...)` re-evaluates the right-hand side on every access when the cached value is `null` (`??=` only skips re-evaluation for a non-nullish cached value). This is harmless, not a bug to fix: `ensureClassStateRule`'s own `_stateBags` cache already answers a repeat call in one `Map.get`, and the collision this depends on has no live occurrence in this codebase today (only `Body` and `Table` share a class name, per `plans/implemented/class-scoped-style-rules.md`'s `[^duplicate-names]` footnote, and neither is a `Button` subclass).

---

## Critical Files

- [packages/lib/src/typescript/lib/core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) — `ensureClassStyleRule` (196), `_bags`/`_owners` (91-94) — the precedent this plan's `ensureClassStateRule` mirrors and the registry it shares.
- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — `writeRuleDeclaration` (4720), `_inheritedStyleBag` (452), `createStyleRule` (1009) — the base-tier precedent `writeClassStateDeclaration` generalises, and the instance-rule builder this plan's setters keep calling unchanged.
- [packages/lib/src/typescript/lib/core/StyleTarget.ts](packages/lib/src/typescript/lib/core/StyleTarget.ts) — `StyleRuleScope`/`_selectorOf` (140-179), the `"component"` suffix shape this plan copies onto `"class"`.
- [packages/lib/src/typescript/lib/component/button/Button.ts](packages/lib/src/typescript/lib/component/button/Button.ts) — `_defaultButtonOptions` (223), `pressedStyleRule`/`hoverStyleRule` (541-558), `applyChromeOptions` (861-935), every pressed/hover setter (2168-2604).
- [packages/lib/src/typescript/lib/component/button/ToggleButton.ts](packages/lib/src/typescript/lib/component/button/ToggleButton.ts) — `selectedStyleRule` (33-36), the constructor's three literal writes (50-52), `setFlat` (224-239, untouched).
- [packages/lib/src/typescript/lib/component/button/TabButton.ts](packages/lib/src/typescript/lib/component/button/TabButton.ts) — `_defaultTabButtonOptions` (84-104), `applyTabStyling` (227-245).
- [packages/lib/src/typescript/lib/component/input/SpinButton.ts:73-100](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L73-L100) — the real existing subclass behind Expected Behaviour case 10; read before writing that test.
- [packages/lib/tests/core/ClassStyleRules.test.ts](packages/lib/tests/core/ClassStyleRules.test.ts) — the test-harness conventions (`declarationsDuring`, `idSelector`, uniquely-named local subclasses, `_ruleCacheHas`) the new test files copy.
- [plans/implemented/class-scoped-style-rules.md](implemented/class-scoped-style-rules.md) — the precedent for the whole mechanism, including its own retrospective "Implementation Notes" on the leak-diff test collateral this plan is likely to hit the same way.
- [plans/suppress-empty-style-rules.md](suppress-empty-style-rules.md) — the sibling plan; see Architecture Decisions for the relationship.

---

## Non-Goals

- **`DiagramNode`'s `.selected`, `AccordionIndicator`'s `.expanded`, `WindowBorder`'s `.snapTarget`, `Header`'s `:active` glyph rule.** Structurally the same bug shape (a per-instance `createStyleRule` state rule with no class-tier comparison), but outside the audit's named scope for this plan. `ensureClassStateRule`/`writeClassStateDeclaration`/`writeManyClassStateDeclarations` are generic and exported from `ClassStyleRules.ts` specifically so a follow-up plan can reuse them without inventing anything new.
- **Hoisting `Button`'s `pressedBorder` / `pressedBorderRadius` / `hoverBorder` / `hoverBorderRadius` / `hoverForegroundColor` at the base `Button` class.** Their setters still route through `writeClassStateDeclaration` / `writeManyClassStateDeclarations` uniformly, per Architecture Decisions — but `Button`'s own `getPressedClassDeclarations()` / `getHoverClassDeclarations()` never populate these keys (no `_defaultButtonOptions` entry to read), so the comparison always falls through and a plain `Button` writes them exactly as it does today. `TabButton`'s override is what turns this into an actual saving, for its own two fields only.
- **The base `#id` rule's own conditional declarations** (`cursor`, `color`, `backgroundColor`, `backgroundImage`, `border`, `outline`, `borderRadius`, `boxShadow`, `padding`, per `plans/implemented/class-scoped-style-rules.md`'s own Non-Goals). Unrelated axis, already decided, not reopened here.
- **Bumping the package version.** Recorded for release time, not this plan.

---

## Notes

[^measurement]: Figures as reported in this plan's brief, from a live-browser audit (CDP-attached to a running app built on this library, independently reproduced against a separate production app consuming the library from npm): 776 of 833 rules on the demo page's shared stylesheet are `#id`-scoped, collapsing to 69 unique bodies; deduping saves roughly 162KB of a 217KB sheet. The dominant contributor — roughly 322 of the 776 per-instance rules and the majority of the wasted bytes — is Button's `.pressed`/`:hover` state rules and TabButton's hover/selected state rules, with identical bodies repeated ×95, ×70, ×64, and ×31×3 respectively. This plan does not re-run that measurement; it verifies the underlying mechanism by tracing the actual code (Architecture Decisions, Internal Structure) and designs the fix to close the root cause the trace found, independent of the exact per-page counts.

[^owners-order]: `ensureClassStyleRule` (base tier) only ever runs from `Component.applyStyle`, which requires a rendered element. `ensureClassStateRule` (state tier) can run from a `Button`/`ToggleButton` setter fired during construction — e.g. `applyChromeOptions` unconditionally calls `setPressedBackgroundColor` before the instance has ever rendered. So for a freshly-loaded process, the *first* claim on `_owners.set("Button", ButtonCtor)` may come from the state tier rather than the base tier. This is safe because `_owners` only cares about "is the current claimant the same constructor as before" — it has no concept of tier or ordering. The one existing precedent for a class-scoped rule materialising from inside a constructor (before `super()`, even) is `TabButton.ts`'s `TabBusyIndicator`, which calls `ensureBusyIndicatorClassRule()` — a `new StyleRule({ scope: "class", ... })` with default eager materialisation — from its own constructor body. ARCHITECTURE.md's *Defer DOM work to render time* section's "module-level shared class rules" bullet documents this as its own discipline, separate from the per-instance "queue until render" discipline `createStyleRule` follows — the module-level rule is a one-time, idempotent, shared insertion, not a per-instance write, so *when* it first fires relative to a specific instance's render is immaterial.

[^hard-constraint]: An instance that calls a pressed/hover/selected setter with a value that differs from the class default always gets `bag[key] !== value`, so `writeClassStateDeclaration` always falls through to `rule.set(key, value)` — writing to the instance's own `#id<suffix>` rule, which beats `.ClassName<suffix>` on specificity regardless of suffix shape (see the specificity table in Architecture Decisions). This is what guarantees a customized instance is never silently served the class default: routing every setter through the same helper only changes whether the *common*, matching case now gets skipped — a call with a differing value always still writes.

---

## Implementation Notes

### The headline finding: the plan's core mechanism is unsafe for the fields it was written to save — `backgroundColor`, `backgroundImage`, `boxShadow`, and TabButton's four border longhands

**This is the dominant deviation and it substantially reduces what this plan actually achieves.** It was found only by performing Expected Behaviour row 14's manual-verify step (live in the demo app, via chrome-devtools) — a first implementation pass had this plan passing its own automated test suite while silently shipping a real, user-visible regression, which is exactly the scenario that manual-verify step exists to catch.

**The bug.** Every class-tier state rule this plan creates (`.Button.pressed`, `.Button:hover:not(.pressed)`, `.ToggleButton.selected:not(:hover)`, `.TabButton.*`) is a class-only selector, specificity `(0, n, 0)` for `n` classes/pseudo-classes chained. A bare `#id` selector is `(1, 0, 0)` — and in CSS specificity comparison an ID always outranks any number of classes; `.Button.pressed.pressed.pressed` still loses to `#id`. Separately, `Button`'s (and `TabButton`'s) own *resting* chrome writes `backgroundColor`, `backgroundImage`, and `boxShadow` (and, for `TabButton`, all four `border-top`/`-right`/`-bottom`/`-left` longhands) straight onto the instance's base `#id` rule, unconditionally, via `Component.setBackgroundColor`/`setBackgroundImage`/`setShadow` (and `Border`'s longhand writer) — none of which are part of the base-tier hoistable set (`core/ClassStyleRules.ts`'s `ClassStyleDefaults` interface only covers `visible`/`displayed`/`minSize`/`maxSize`/`overflow`/`cursor`/`userSelect`/`outline`/`foregroundColor`/`font`), a deliberate exclusion this plan's own Non-Goals reaffirms ("The base `#id` rule's own conditional declarations… Unrelated axis, already decided, not reopened here").

Put those two facts together: for a default-styled instance, this plan's dedup skips the instance-level `.pressed`/`.hover`/`.selected` write for a key that matches the class default — but if that key is `backgroundColor`, `backgroundImage`, `boxShadow`, or a border longhand, the base `#id` rule (1,0,0) is *also* declaring it, unconditionally, with no pseudo-class gating, so it wins the cascade regardless of state. The class-tier rule's value never has a chance. The result, verified live: **every default-styled `Button`'s pressed/hover background stopped changing at all**, and **every `TabButton`'s selected tab rendered with the same gray fill as an unselected one** — both silent, both would have shipped invisibly past the automated suite (which only ever asserted on *what got written*, never on what the browser's cascade actually resolves — the same blind spot that let this through).

**What's provably safe, and why.** `color` (`pressedForegroundColor`) is the one field spared: Button's *resting* foreground color is already hoisted onto the class tier by the pre-existing `class-scoped-style-rules.md` mechanism (`foregroundColor` *is* in `ClassStyleDefaults`), so for a default-styled instance nothing on `#id` competes for `color` at all, and `.Button.pressed`'s two-class selector is free to win it outright. (One narrow residual gap: an instance with a *customized resting* foreground color — `new Button({ foregroundColor: 'purple' })` — but a *default* pressed color would have `#id { color: purple }` at (1,0,0) beating `.Button.pressed`'s color too, since that `#id` declaration has no pseudo-class gating either. This exists only when a caller sets a custom resting color and *not* a custom pressed color — not exercised by any current call site — recorded here rather than silently left for the next person to rediscover.)

**The fix — reduce scope, not paper over the bug.** `Button.getPressedClassDeclarations()` now returns only `color`; `getHoverClassDeclarations()` returns `{}` unconditionally (Button has no hover field that's both defaulted *and* safe — `hoverForegroundColor` was already excluded, having no class default at all). `ToggleButton.getSelectedClassDeclarations()` was removed as a dedup source entirely — `selectedClassBag` is now hardcoded `null` (documented inline) rather than derived from anything, since none of `.selected`'s three fields are safe and ToggleButton has no `color`-equivalent to fall back on. `TabButton`'s `getHoverClassDeclarations()` / `getSelectedClassDeclarations()` overrides were deleted outright — every field either override would have contributed (background/image/shadow/all four border longhands) is unsafe, so the overrides had nothing left to add beyond what the (now-empty) inherited resolvers already return. The `ensureClassStateRule` / `writeClassStateDeclaration` / `writeManyClassStateDeclarations` primitives in `core/ClassStyleRules.ts` are unchanged from the plan's Public API and Internal Structure — the fix is entirely in *which declarations each resolver feeds them*, confined to the same three component files the plan already owns.

**What this plan now actually achieves.** Only `Button.pressedForegroundColor` dedupes — one field, versus the ~322 duplicate rules (dominated by background/shadow) the plan's own measurement named as the target. `ToggleButton`'s `.selected` and `TabButton`'s `.hover`/`.selected` states achieve **zero** byte savings and behave exactly as they did before this plan; only `Button`/`TabButton`'s shared `.pressed` class rule (carrying `color` alone) and the reusable generic mechanism exist as tangible output. The generic primitives remain correctly implemented and tested (`tests/core/ClassStateRules.test.ts`'s six cases exercise `ensureClassStateRule`/`writeClassStateDeclaration` directly against local probes with no base-`#id` conflict, and stay valid) — a future plan that first extends the base-tier hoistable set (`ClassStyleDefaults`) to cover `backgroundColor`/`backgroundImage`/`boxShadow`/border-longhands could then safely re-widen these same resolvers to realise the rest of the originally-claimed savings, without touching this plan's mechanism again.

**Verified fix, live.** Reloaded the demo app after narrowing the resolvers: a plain `Button`'s pressed background now differs from resting again (`rgba(0,0,0,0)` / gradient vs. `rgb(243,244,246)` / none); the Tab panel's selected tabs (`Alpha`, `Delta`) render white (`rgb(255,255,255)`) distinctly from unselected gray (`rgb(226,229,233)`), matching the pre-plan/expected appearance. This closes Expected Behaviour row 14 (visual parity), performed via a locally-started `vite --port 8023` dev server (not the already-running main-tree server on 8015) against this worktree's own source, plus direct CSSOM/computed-style inspection through chrome-devtools MCP tools — screenshots alone would not have caught the cascade-priority bug, since the broken and fixed states look identical in a static screenshot without forcing `.pressed`/comparing computed styles.

### A second, related regression: chromeless Buttons leaking the shared `.Button.pressed` class rule's color

Found by this plan's own audit's second round, independently verified before fixing. Even after narrowing `getPressedClassDeclarations()` to only `color`, a `chromeless` Button (`applyChromeOptions`'s early-return branch, `Button.ts` — used by `PickerButton`/`MenuBarButton`) never calls *any* pressed setter, so it never writes anything to its own `#id.pressed` rule. But its element still carries the plain CSS class `Button` (from `Component.init`'s `addClass`) and still gets `.pressed` toggled unconditionally by `_updatePressedClass()` regardless of chromeless state — so once *any other*, chromeful `Button` in the same process has materialised the shared `.Button.pressed { color: <pressed-fg token> }` rule, that rule's selector matches the chromeless instance too, and with no instance-level declaration to outrank it (via `#id.pressed`'s higher specificity), the shared gray pressed-fg token silently leaks onto a chromeless button's text on press — directly contradicting `chromeless`'s own documented contract ("suppresses… the twelve pressedX/hoverX fields"). Confirmed empirically both against a synthetic probe and live against `MenuBarButton` in the demo app (`#/menubar`): before the fix, a chromeless button's forced-`.pressed` computed `color` read the shared class rule's gray; after, it correctly matches its own resting color, unchanged. Fix: `applyChromeOptions`'s chromeless branch now explicitly calls `this.setPressedForegroundColor(this.getForegroundColor() ?? "inherit")` — pinning the pressed color to the current resting color, which is always a different `var()` expression than the class bag's pressed-fg token, so it always writes for real and reliably wins via `#id.pressed`'s specificity. This doesn't regress `chromeless`'s pre-existing (and unrelated) behaviour of ignoring a caller-supplied `pressedForegroundColor` option — chromeless never dispatched that option even before this plan, since the early return skips the whole caller-value block below it. Covered by a new case in `Button.pressedHoverClassHoisting.test.ts`.

This — plus the base-`#id`-rule conflict above — means any future attempt to widen this mechanism's scope (e.g. after a base-tier hoisting extension makes `backgroundColor`/`backgroundImage`/`boxShadow` safe) must also audit every conditional branch that can skip a state setter's dispatch for *some* instances while a *different* instance of the same concrete class still materialises the shared rule — `chromeless` is the one found here, but it is a general shape (a per-instance opt-out competing with a per-class shared default), not necessarily the only one.

### A third and fourth regression: the same leak reachable via the public `setChromeless()` runtime toggle, in both directions

Found by this plan's own audit's third (final, capped) round. The chromeless fix above covers construction-time `{ chromeless: true }`, but `setChromeless(true)` — the public, documented runtime toggle, used by any consumer flipping an existing button chromeless after the fact — is a *second*, independent code path into the identical leak: `_clearChrome()` (`Button.ts`) called `clearPressedForegroundColor()`, a `null` write that, for the same reason as the construction-time case, can never win the cascade against `.Button.pressed`'s shared non-null token. Fix: mirrors the construction-time fix exactly — `_clearChrome()` now calls `this.setPressedForegroundColor(this.getForegroundColor() ?? "inherit")` instead of clearing.

The *inverse* direction has a related but distinct bug: `setChromeless(false)` calls `_restoreChrome()`, which writes `d.pressedForegroundColor` (the class default) back via `setPressedForegroundColor()` — but that value *matches* the class bag exactly, so `writeClassStateDeclaration` correctly-by-its-own-contract skips the write. The problem is that skip check only compares the requested value against the shared class bag; it has no way to know the instance's own `#id.pressed` rule may already carry a *different*, previously-pinned value (from the chromeless-branch pin, either at construction or via `setChromeless(true)`). Skipping the write leaves that stale pin in place — permanently, since nothing else will ever touch it again — so a button restored to chromeful keeps showing its old (pinned, resting-color) pressed text forever instead of the theme's pressed-fg token. This is a general limitation of `writeClassStateDeclaration`'s skip-on-match design (it compares only the requested value to the class bag, never to what the instance rule currently holds), not something specific to chromeless — but chromeless's pin/restore round-trip is the one concrete path that exercises it today. Fix, confined to the one call site that needs it: `_restoreChrome()` now follows `setPressedForegroundColor(d.pressedForegroundColor)` with a direct `this.pressedStyleRule.set("color", d.pressedForegroundColor)`, forcing a real write regardless of whether it would have matched the class bag — `_restoreChrome` is specifically the "undo a prior pin" path, not the common fresh-default path the skip optimisation is meant for, so it deliberately opts out of the optimisation for this one property. (`_restoreChrome` is also `setFlat(false)`'s restore path; flat mode never pins `pressedForegroundColor`, so the forced write there is a harmless no-op-content-wise extra write, not a fix for anything flat-specific.)

Both confirmed via the test harness (`Button.pressedHoverClassHoisting.test.ts`'s two new cases) mirroring the same write-recording approach already cross-validated against real CSSOM/computed-style behaviour earlier in this Implementation Notes section (the `.Button.pressed` background-color and `MenuBarButton` chromeless-pin checks) — the underlying mechanism (`writeClassStateDeclaration` → `StyleRule.set()` → `DOM.sink.setRuleStyles`) is identical, so a live re-check was not repeated for these two.

**On the audit cap.** This plan's audit loop ran all three rounds the `audit` skill permits, and every round found a genuine, previously-unknown regression — a pattern, not a coincidence: `writeClassStateDeclaration`'s skip-on-match optimisation is easy to reason about in isolation (does this exact write match the class default?) but easy to get wrong in aggregate, because "matching the class default" and "therefore safe to skip" both implicitly assume nothing *else* — a base-`#id` rule, a differently-gated sibling instance, a stale prior pin — is also competing for the same CSS property. Round three closed with these two findings fixed and verified via the test harness; per the audit skill's cap, no fourth round was spawned. Anyone extending this mechanism (state suffixes beyond `.pressed`, properties beyond `color`, or subclasses beyond Button/ToggleButton/TabButton) should treat that assumption as the one to interrogate first, not assume the pattern is now exhausted.

### Two earlier fix attempts, superseded by the scope reduction above

Two deviations recorded during a first pass at fixing Expected Behaviour case 10 (`SpinButton`'s `clearPressedShadow()`) turned out to be solving a problem that the scope reduction above eliminates at the root, and were reverted:

- An eager-materialise / deferred-`markNeedsMaterialize()` mechanism in `writeClassStateDeclaration`/`StyleTarget.hasQueuedDeclarations()`, meant to make a `null`-clearing instance write against a non-null class default actually reach the stylesheet. Once `boxShadow` was removed from `getPressedClassDeclarations()` entirely (see above), there is no class-tier `boxShadow` value left to clash with, so `clearPressedShadow()` goes back to being an ordinary always-write (`bag['boxShadow']` is `undefined`, never matches) — the mechanism was reverted in full (`StyleTarget.ts` is byte-for-byte the sibling plan's version plus only the `suffix` addition).
- `ToggleButton`'s constructor reading through the (overridable) `getSelectedClassDeclarations()` resolver instead of the literal `TOGGLE_SELECTED_DECLARATIONS` constant, to stop a subclass's later write from being silently skipped as a cascade-matching duplicate. Once `.selected` dedup was removed entirely (`selectedClassBag` is now always `null`), every `.selected` write is unconditional again, so the *last* writer always wins regardless of literal-value provenance — the original bug this fix addressed can no longer occur, and the constructor reverted to the plan's literal `TOGGLE_SELECTED_DECLARATIONS` reads.

Both are recorded here rather than silently dropped from history, since they reflect real (if superseded) debugging work and explain artifacts a reader diffing intermediate states might otherwise find puzzling.
