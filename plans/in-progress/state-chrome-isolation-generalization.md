---
depends-on: [component-chrome-base-tier-hoisting, button-resting-chrome-state-isolation, state-style-rule-auto-dedup]
---

# State-Chrome Isolation Generalization — Implementation Plan

## Overview

Three prior plans built the machinery that lets a component share its state-tier CSS (`.pressed`, `.selected`, …) across every instance of a class instead of duplicating it per instance. `component-chrome-base-tier-hoisting` gave every component automatic class-tier hoisting for `backgroundColor` / `backgroundImage` / `boxShadow` / border, via `ClassStyleDefaults` and `Component.reconcileRuleDeclaration` / `setReconciledCSSRules` ([packages/lib/src/typescript/lib/core/Component.ts:4780](packages/lib/src/typescript/lib/core/Component.ts#L4780), [:4790](packages/lib/src/typescript/lib/core/Component.ts#L4790)). `button-resting-chrome-state-isolation` then fixed the one gap that mechanism left open for `Button`: a bare `#id` selector `(1,0,0)` always outranks a class-tier state selector like `.Button.pressed` `(0,2,0)`, so any instance that customizes its resting `backgroundColor` while its class also declares a shared `.pressed` rule silently defeats that rule. The fix — routing the three deviating properties onto an instance rule scoped `#id:not(.pressed)` instead of bare `#id` — was built entirely inside `Button.ts`: a hardcoded key set, a boolean flag, and three method overrides ([packages/lib/src/typescript/lib/component/button/Button.ts:226](packages/lib/src/typescript/lib/component/button/Button.ts#L226)-[681](packages/lib/src/typescript/lib/component/button/Button.ts#L681)). `state-style-rule-auto-dedup` generalized the *state-rule* half into a reusable `Component.createStateStyleRule` primitive, but left the *resting-isolation* half exactly where `button-resting-chrome-state-isolation` put it: inside `Button`, unavailable to any other class.

That leftover is why `ToggleButton.ts`'s `.selected:not(:hover)` state — structurally the same problem as `Button.pressed` — is dedup-disabled today: `selectedClassBag` is hardcoded to return `null` ([packages/lib/src/typescript/lib/component/button/ToggleButton.ts:72](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L72)), because `ToggleButton` never got its own copy of Button's isolation trick. This plan moves that trick out of `Button.ts` and into `Component.ts`, driven by one new overridable method, so any component gets it by declaring which toggle classes its resting chrome must stay isolated from — with no per-property code at the write site. It then migrates `ToggleButton` and `TabButton` onto the generalized mechanism, and documents the whole tier system in `ARCHITECTURE.md`, which today never explains any of this.

Four source files change: `packages/lib/src/typescript/lib/core/Component.ts` (the generalized mechanism), `packages/lib/src/typescript/lib/component/button/Button.ts` (migrated onto it, net simpler), `packages/lib/src/typescript/lib/component/button/ToggleButton.ts` (`.selected` dedup restored), and `packages/lib/src/typescript/lib/component/button/TabButton.ts` (one resolver override). A fifth file, `ARCHITECTURE.md`, gains the missing documentation.

---

## Architecture Decisions

### Generalize Button's three-method override into one overridable method on `Component`

`Button` currently answers two questions with hand-rolled, Button-only state: *which toggle class(es) does my resting chrome need excluding from* (`":not(.pressed)"`, hardcoded into `restingStyleRule`'s suffix), and *is isolation active for this instance* (`isRestingChromeIsolated()`, a private boolean). Both answers are computed once per write inside three method overrides (`reconcileRuleDeclaration`, `setReconciledCSSRules`, `setElementCSSRule`) that duplicate `Component`'s own bodies almost verbatim, just redirecting the write.

This plan deletes that duplication by asking the first question through one new protected, overridable method, `Component.getRestingExclusionSuffixes(): readonly string[]`, defaulting to `[]`. `Component`'s own `reconcileRuleDeclaration` / `setReconciledCSSRules` become exclusion-aware directly: when the list is non-empty (and isolation isn't instance-disabled — see below), the three chrome-hoisted properties route onto a lazily-built instance rule at `#id` + one `:not(suffix)` clause per registered suffix, computed automatically. `Button` overrides the method to return `[".pressed"]`; `ToggleButton` overrides it to add `".selected"`. Neither needs to touch `reconcileRuleDeclaration`, `setReconciledCSSRules`, or any per-property logic at all — the isolation is automatic the moment the suffix list is non-empty, which is the "zero per-property boilerplate at each call site" the mechanism is for.

A component that never overrides `getRestingExclusionSuffixes()` gets the exact behaviour it has today: the suffix list is empty, so every isolation check short-circuits and the write goes straight to the bare `#id` rule, unchanged.[^precedent]

### `getRestingExclusionSuffixes()` is a plain virtual method, not a runtime registration call

An earlier shape considered for this plan had a component call something like `this.registerRestingExclusion(".pressed")` once, imperatively, from its constructor body. That shape has a timing gap: `Component`'s "chrome group" properties (`shadow`, `backgroundImage`, `border`, `borderRadius`) are dispatched through their setters *during* `super()`'s construction cascade, before any subclass's own constructor body runs — `TabButton`'s `backgroundImage` default is a concrete, exercised example, since it reaches `Button`'s constructor through `subclassDefaults` and fires before `ToggleButton`'s or `TabButton`'s own constructor bodies exist to make the registration call.[^cascade-timing] A method resolved through the prototype chain has no such gap: `this.getRestingExclusionSuffixes()` returns the correct, fully-overridden answer from the first possible call, including one made from inside `Component`'s own constructor — the same guarantee `Component.getClassStyleDefaults()` already relies on. `createStateStyleRule`'s own design rejected a suffix-keyed override method for a different reason (one component can have several *state* resolvers, needing a callback per state); this case has exactly one combined list per component, which is what a single overridable method is for.

The list is expected to be fixed for a given class — resolved once, the same way `getClassStyleDefaults()` is expected to be. A subclass extends it by chaining `super()`'s list rather than replacing it: `return [...super.getRestingExclusionSuffixes(), ".selected"];`. This is what lets `TabButton`, which adds no exclusion of its own, inherit `[".pressed", ".selected"]` from `ToggleButton` with no override at all.

### The isolated key set stays a fixed three properties, not per-component configurable

`RESTING_ISOLATION_KEYS` (`backgroundColor`, `backgroundImage`, `boxShadow`) moves from a `Button`-local constant to a `Component.ts`-local one, unchanged in content. It is not made overridable per component. Every concrete need identified so far — `Button.pressed` and `ToggleButton.selected` — isolates exactly these three properties; a component-configurable key set would be speculative flexibility with no current caller.[^fixed-keys]

### The `background` shorthand isolation stays a `Button`-local override

`setElementCSSRule` is `Component`'s lowest-level, highest-traffic CSS write primitive — used by nearly every typed setter in the framework, not just chrome ones. Only `Button.setBackground` / `clearBackground` ever call it for an isolated property, and only because that one shorthand has no class-tier bag to compare against (no `applyStyle` phase writes it, so `reconcileRuleDeclaration` never sees it either). Folding a chrome-specific branch into `Component.setElementCSSRule` for this single caller would put narrow logic in the framework's most general write path for no other component's benefit. `Button` keeps a small override, unchanged in shape, but rewritten to call the now-shared `restingStyleRule` / `isRestingChromeIsolated` / `materialiseRestingRule` instead of its own private copies.

### The instance-level isolation-disable flag generalizes, becomes `protected`

`Button`'s chromeless branch needs to *turn off* isolation for an instance whose class publishes no state-tier chrome to isolate from — isolating a chromeless button's resting chrome would just move its declarations to a different selector for no benefit, and would break the specificity relationship a couple of consumer `styleRules` entries on chromeless buttons rely on.[^chromeless-recap] This is a general need (any future isolating component could have an equivalent "this instance opts out" case), so the flag moves to `Component` as `protected isChromeIsolationEnabled()` / `protected setChromeIsolationEnabled(enabled: boolean)`, backed by a `declare`d field for the same cascade-safety reason `Button`'s original flag needed one. `Component.isRestingChromeIsolated()` combines both questions — a non-empty suffix list *and* the flag — into the one predicate `reconcileRuleDeclaration`, `setReconciledCSSRules`, and `Button`'s `setElementCSSRule` override all read.

The backing field for the rule itself, `_restingStyleRule`, and its lazy getter `restingStyleRule`, move to `Component` as `protected` rather than `private` — the same visibility change `button-resting-chrome-state-isolation` already made to `matchesClassStyle` for the identical reason: a subclass (`Button`) needs to read the inherited member directly.[^protected-precedent] This keeps `Button`'s existing `if (this._restingStyleRule !== undefined) { … }` line in its chromeless branch working with no rewrite.

### Migrating `ToggleButton` requires a new `getSelectedClassDeclarations()` resolver — and `TabButton` must override it, not just inherit it

Restoring `.selected` dedup means giving `ToggleButton.selectedStyleRule` a real resolver, mirroring exactly how `Button.pressedStyleRule` is built: `this.createStateStyleRule(".selected:not(:hover)", () => this.getSelectedClassDeclarations())`. `ToggleButton.getSelectedClassDeclarations()` returns the three `TOGGLE_SELECTED_DECLARATIONS` tokens ([packages/lib/src/typescript/lib/component/button/ToggleButton.ts:26](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L26)).

`TabButton` paints different `.selected` colours (`TAB_BUTTON_SELECTED_FILL`, [packages/lib/src/typescript/lib/component/button/TabButton.ts:121](packages/lib/src/typescript/lib/component/button/TabButton.ts#L121)) than the base `ToggleButton` tokens. `createStateStyleRule`'s `resolveDefaults` callback runs once, eagerly, at first access — for a `TabButton` instance, that first access happens inside `ToggleButton`'s own constructor body (`this.setSelectedShadow(TOGGLE_SELECTED_DECLARATIONS.boxShadow!)`, before `TabButton`'s constructor body has run its own `applyTabStyling()`). Virtual dispatch means `this.getSelectedClassDeclarations()` already resolves to whatever the *most-derived* class overrides — so if `TabButton` provides its own override, the class-tier `.TabButton.selected:not(:hover)` rule is built with the correct tab tokens from that very first call, even though the call happens while `ToggleButton`'s constructor is still running. If `TabButton` does *not* override it, the class rule is built with the wrong (base `ToggleButton`) tokens, and `applyTabStyling()`'s later, correct writes never match that wrong bag — so they always deviate, materializing a stale, unused class rule and a per-instance rule doing all the real work: no visible bug, but no dedup either, and dead weight on every render. `TabButton` therefore gets one new method, `getSelectedClassDeclarations()`, returning `TAB_BUTTON_SELECTED_FILL`'s three fields — the exact same per-class resolver pattern `Button.getPressedClassDeclarations()` already establishes for classes whose defaults differ (`MenuBarButton`, `PickerButton`).

### Border longhands and `color` stay un-deduped for `.selected`, exactly as for `.pressed`

`getSelectedClassDeclarations()` covers only `boxShadow` / `backgroundColor` / `backgroundImage` — the three properties `RESTING_ISOLATION_KEYS` isolates. `TabButton`'s `.selected` border longhands are not isolated (border is not in `RESTING_ISOLATION_KEYS`) and keep writing straight to `#id`, so deduping them at the `.selected` tier would reproduce the exact specificity trap this plan closes for the other three properties.[^border-precedent] `setSelectedBorder` keeps writing through `StateStyleRule.setMany`, but since the resolved bag never declares border keys, every border write is unconditional (never skipped) — the same behaviour `Button.pressedStyleRule.setMany(borderToStyle(...))` already has for `.pressed`.

### `ToggleButton.getSelectedClassDeclarations()` mirrors Button's chromeless guard

`ToggleButton` inherits `Button`'s `chromeless` option. No in-repo caller constructs a chromeless `ToggleButton` or `TabButton`, but the migration introduces a real, non-empty `.selected` class rule for the first time — so `getSelectedClassDeclarations()` returns `{}` when `this._defaultOptions.chromeless` is true, the same one-line guard `Button.getPressedClassDeclarations()` already uses ([packages/lib/src/typescript/lib/component/button/Button.ts:704](packages/lib/src/typescript/lib/component/button/Button.ts#L704)). This prevents a hypothetical chromeless `ToggleButton` from publishing a shared class rule its own instance never backs with a resting declaration.[^chromeless-toggle-scope]

### Document the tier system in `ARCHITECTURE.md`

`ARCHITECTURE.md` currently mentions `createStyleRule` / `createStateStyleRule` in one bullet under *Defer DOM work to render time*, but never explains the three-tier specificity model, the `#id` vs `.Class.state` conflict, the `:not()` trick, or `ClassStyleDefaults` / `ensureClassStyleRule` at all — that knowledge lives only in source comments and in the three prior plans. A new section documents it with a worked specificity table and the two-step recipe (`createStateStyleRule` for the state rule, `getRestingExclusionSuffixes()` when the state competes with resting chrome), so a future component author reaches for the automatic path without first rediscovering the specificity bug.

---

## Public API

Every new or changed member below is `protected`; TypeDoc runs with `excludeProtected: true` (per `button-resting-chrome-state-isolation`'s established precedent), so none of this reaches the generated API docs. Listed here because subclass authors read the source directly.

```typescript
// core/Component.ts — new protected members, subclass extension points.

/**
 * Selector suffixes (e.g. ".pressed", ".selected") whose class-tier state
 * rule this component's resting chrome must stay isolated from. Empty by
 * default. A subclass overrides this to add its own suffix, chaining onto
 * `super()`'s list rather than replacing it.
 */
protected getRestingExclusionSuffixes(): readonly string[];

/** Instance-level escape hatch: true unless disabled via `setChromeIsolationEnabled(false)`. */
protected isChromeIsolationEnabled(): boolean;
protected setChromeIsolationEnabled(enabled: boolean): void;

/** Combines both questions: a non-empty exclusion list AND isolation enabled. */
protected isRestingChromeIsolated(): boolean;

/** Lazy instance rule at `#id` + one `:not(suffix)` per registered exclusion. */
protected get restingStyleRule(): StyleRule;

/** Materialises `restingStyleRule` when a real declaration just queued on an already-rendered instance. */
protected materialiseRestingRule(): void;

// Existing signatures, bodies extended to route the three isolated
// properties through `restingStyleRule` when `isRestingChromeIsolated()`.
protected reconcileRuleDeclaration(key: string, value: string | null): void;
protected setReconciledCSSRules(values: Style): this;
```

```typescript
// component/button/Button.ts
protected override getRestingExclusionSuffixes(): readonly string[]; // returns [".pressed"]
protected override setElementCSSRule(key: string, value: Object | null): this; // unchanged shape, rewritten body
// REMOVED: RESTING_RECONCILED_KEYS, _restingStyleRule/restingStyleRule,
// _restingChromeIsolated/isRestingChromeIsolated, the reconcileRuleDeclaration
// and setReconciledCSSRules overrides, materialiseRestingRule — all now
// inherited from Component.
```

```typescript
// component/button/ToggleButton.ts
protected getSelectedClassDeclarations(): Record<string, string | null>; // new
protected override getRestingExclusionSuffixes(): readonly string[];    // new — [...super, ".selected"]
private get selectedStyleRule(): StateStyleRule; // was StyleRule
// REMOVED: selectedClassBag.
```

```typescript
// component/button/TabButton.ts
protected override getSelectedClassDeclarations(): Record<string, string | null>; // new
```

No consumer-facing (public) signature changes anywhere.

---

## Internal Structure

### `core/Component.ts` — the generalized mechanism

Placed next to the existing `matchesClassStyle` / `reconcileRuleDeclaration` / `setReconciledCSSRules` (around [Component.ts:4746](packages/lib/src/typescript/lib/core/Component.ts#L4746)):

```typescript
// The chrome properties the resting-isolation mechanism intercepts. Fixed —
// see Architecture Decisions for why this isn't per-component configurable.
// Moved here from Button.ts's RESTING_RECONCILED_KEYS, unchanged in content.
const RESTING_ISOLATION_KEYS: ReadonlySet<string> = new Set([
    "backgroundColor",
    "backgroundImage",
    "boxShadow",
]);

/**
 * Selector suffixes (e.g. `.pressed`, `.selected`) whose class-tier state
 * rule this component's resting chrome must stay isolated from — see
 * `reconcileRuleDeclaration` / `setReconciledCSSRules`. Empty by default: a
 * component with no mutually-exclusive toggle-state class needs no
 * isolation, and its resting chrome writes straight to `#id`, exactly as
 * before this mechanism existed.
 *
 * A subclass overrides this to add its own suffix, chaining onto `super()`'s
 * list rather than replacing it, so a grandchild class inherits every
 * ancestor's exclusion automatically. Expected to return a fixed,
 * construction-time-stable list per class — the same expectation
 * `getClassStyleDefaults()` already carries — because it is read from as
 * early as the `super()` construction cascade.
 */
protected getRestingExclusionSuffixes(): readonly string[] {
    return [];
}

private get restingIsolationSuffix(): string {
    return this.getRestingExclusionSuffixes().map((suffix) => ":not(" + suffix + ")").join("");
}

// Generalizes Button's original `_restingChromeIsolated` flag: an
// instance-level opt-out for a class whose own defaults publish no
// state-tier chrome to isolate from (e.g. a chromeless Button). `declare`
// because a subclass may write it during the `super()` cascade (Button's
// chromeless branch runs inside `applyChromeOptions`, itself dispatched from
// `super()`); a plain initializer would run afterward and revert the write.
private declare _chromeIsolationEnabled?: boolean;

protected isChromeIsolationEnabled(): boolean {
    return this._chromeIsolationEnabled ?? true;
}

protected setChromeIsolationEnabled(enabled: boolean): void {
    this._chromeIsolationEnabled = enabled;
}

/** True when this instance currently isolates its resting chrome from at
 *  least one registered state class. */
protected isRestingChromeIsolated(): boolean {
    return this.isChromeIsolationEnabled() && this.restingIsolationSuffix !== "";
}

// Lazy resting-isolation rule. Never allocated unless isRestingChromeIsolated()
// is true somewhere on a write path — see the guard in
// reconcileRuleDeclaration / setReconciledCSSRules below, which never calls
// this getter with an empty restingIsolationSuffix.
protected declare _restingStyleRule?: StyleRule;
protected get restingStyleRule(): StyleRule {
    return this._restingStyleRule ??= this.createStyleRule(this.restingIsolationSuffix);
}

/**
 * Inserts `restingStyleRule` when a write just queued a real declaration on
 * an already-rendered instance — `applyStyle` materialises deferred rules at
 * the end of a render pass; a runtime setter firing later has no such pass
 * behind it. A rule holding only `null` removals is left unmaterialised, as
 * `Component` does for every other deferred rule.
 */
protected materialiseRestingRule(): void {
    if (this.getElement() && this.restingStyleRule.hasQueuedDeclarations()) {
        this.restingStyleRule.ensure();
    }
}
```

`reconcileRuleDeclaration` and `setReconciledCSSRules` bodies (same location, [Component.ts:4780](packages/lib/src/typescript/lib/core/Component.ts#L4780)-[4798](packages/lib/src/typescript/lib/core/Component.ts#L4798)) — before → after:

```typescript
// Before:
protected reconcileRuleDeclaration(key: string, value: string | null): void {
    this._styleRule.queue(key, this.matchesClassStyle(key, value) ? null : value);
}

protected setReconciledCSSRules(values: Style): this {
    const resolved: Style = {};

    for (const key of Object.keys(values)) {
        resolved[key] = this.matchesClassStyle(key, values[key]) ? null : values[key];
    }

    return this.setElementCSSRules(resolved);
}
```

```typescript
// After:
protected reconcileRuleDeclaration(key: string, value: string | null): void {
    if (this.isRestingChromeIsolated() && RESTING_ISOLATION_KEYS.has(key)) {
        this.restingStyleRule.set(key, this.matchesClassStyle(key, value) ? null : value);

        return;
    }

    this._styleRule.queue(key, this.matchesClassStyle(key, value) ? null : value);
}

protected setReconciledCSSRules(values: Style): this {
    const isolated = this.isRestingChromeIsolated();
    const resolved: Style = {};
    let   wroteIsolated = false;

    for (const key of Object.keys(values)) {
        if (isolated && RESTING_ISOLATION_KEYS.has(key)) {
            wroteIsolated = true;
            this.restingStyleRule.set(key, this.matchesClassStyle(key, values[key]) ? null : values[key]);

            continue;
        }

        resolved[key] = this.matchesClassStyle(key, values[key]) ? null : values[key];
    }

    if (wroteIsolated) {
        this.materialiseRestingRule();
    }

    return Object.keys(resolved).length > 0 ? this.setElementCSSRules(resolved) : this;
}
```

The `Object.keys(resolved).length > 0` guard is new relative to the pre-Button-override `Component` body (which called `setElementCSSRules` unconditionally); it matches exactly what `Button`'s own override already does today, already covered by `Button.restingChromeIsolation.test.ts`.

### `component/button/Button.ts` — deletions and the new override

Delete outright (all superseded by the inherited `Component` members): the `RESTING_RECONCILED_KEYS` module constant ([Button.ts:226](packages/lib/src/typescript/lib/component/button/Button.ts#L226)-230), the `_restingStyleRule` field and `restingStyleRule` getter ([:587](packages/lib/src/typescript/lib/component/button/Button.ts#L587)-590), the `_restingChromeIsolated` field and `isRestingChromeIsolated()` ([:599](packages/lib/src/typescript/lib/component/button/Button.ts#L599)-602), the `reconcileRuleDeclaration` override ([:611](packages/lib/src/typescript/lib/component/button/Button.ts#L611)-619), the `setReconciledCSSRules` override ([:627](packages/lib/src/typescript/lib/component/button/Button.ts#L627)-651), and `materialiseRestingRule` ([:677](packages/lib/src/typescript/lib/component/button/Button.ts#L677)-681).

Add, in their place:

```typescript
/**
 * `Button`'s resting chrome (a deviating `backgroundColor` /
 * `backgroundImage` / `boxShadow`, plus the `background` shorthand below)
 * stays isolated from `.pressed`, so the shared `.ClassName.pressed` class
 * rule is never undercut by a bare, higher-specificity `#id` declaration.
 */
protected override getRestingExclusionSuffixes(): readonly string[] {
    return [".pressed"];
}
```

Rewrite the `setElementCSSRule` override ([:659](packages/lib/src/typescript/lib/component/button/Button.ts#L659)-668) to use the inherited members instead of its own deleted copies — only the three identifiers change (`isRestingChromeIsolated`, `restingStyleRule`, `materialiseRestingRule` are now inherited, not locally defined; body and control flow are otherwise identical):

```typescript
protected override setElementCSSRule(key: string, value: Object | null): this {
    if (!this.isRestingChromeIsolated() || key !== "background") {
        return super.setElementCSSRule(key, value);
    }

    this.restingStyleRule.set(key, value ? String(value) : null);
    this.materialiseRestingRule();

    return this;
}
```

The chromeless branch of `applyChromeOptions` ([:1045](packages/lib/src/typescript/lib/component/button/Button.ts#L1045)-1049) changes one line:

```typescript
// Before:
this._restingChromeIsolated = false;

if (this._restingStyleRule !== undefined) {
    this._restingStyleRule.setMany({ background: null, backgroundColor: null, backgroundImage: null, boxShadow: null });
}
```

```typescript
// After:
this.setChromeIsolationEnabled(false);

if (this._restingStyleRule !== undefined) {
    this._restingStyleRule.setMany({ background: null, backgroundColor: null, backgroundImage: null, boxShadow: null });
}
```

The second block is unchanged — `_restingStyleRule` is now a `protected` field inherited from `Component`, so the direct-field read (avoiding an allocation for a button that never touched the getter) still compiles and behaves identically.

### `component/button/ToggleButton.ts` — before → after

```typescript
// Before (current code):
private declare _selectedStyleRule?: StyleRule;
private get selectedStyleRule(): StyleRule {
    return this._selectedStyleRule ??= this.createStyleRule(".selected:not(:hover)");
}

private get selectedClassBag(): Readonly<Record<string, string | null>> | null {
    return null;
}

setSelectedBackgroundColor(backgroundColor: string): this {
    writeClassStateDeclaration(this.selectedStyleRule, this.selectedClassBag, "backgroundColor", backgroundColor);

    return this;
}
// setSelectedBackgroundImage / setSelectedShadow follow the identical shape.

setSelectedBorder(options: BorderOptions | string): this {
    const border = typeof options === "string" ? { border: options } : options;
    writeManyClassStateDeclarations(this.selectedStyleRule, this.selectedClassBag, borderToStyle(border));

    return this;
}
```

```typescript
// After:
private declare _selectedStyleRule?: StateStyleRule;
private get selectedStyleRule(): StateStyleRule {
    return this._selectedStyleRule ??= this.createStateStyleRule(".selected:not(:hover)", () => this.getSelectedClassDeclarations());
}

/**
 * This class's resolved `.selected:not(:hover)` declarations. Safe to
 * dedupe now that `getRestingExclusionSuffixes()` (below) isolates the same
 * three properties from `.selected` the same way `Button` isolates them
 * from `.pressed` — see `plans/state-chrome-isolation-generalization.md`.
 */
protected getSelectedClassDeclarations(): Record<string, string | null> {
    if (this._defaultOptions.chromeless) {
        return {};
    }

    return {
        boxShadow:       TOGGLE_SELECTED_DECLARATIONS.boxShadow!,
        backgroundColor: TOGGLE_SELECTED_DECLARATIONS.backgroundColor!,
        backgroundImage: TOGGLE_SELECTED_DECLARATIONS.backgroundImage!,
    };
}

/**
 * `.selected`'s resting chrome must stay isolated too, the same way
 * `Button`'s own `.pressed` does — a `ToggleButton`'s resting
 * `backgroundColor` / `backgroundImage` / `boxShadow` must not undercut the
 * shared `.ClassName.selected:not(:hover)` rule above.
 */
protected override getRestingExclusionSuffixes(): readonly string[] {
    return [...super.getRestingExclusionSuffixes(), ".selected"];
}

setSelectedBackgroundColor(backgroundColor: string): this {
    this.selectedStyleRule.set("backgroundColor", backgroundColor);

    return this;
}
// setSelectedBackgroundImage / setSelectedShadow follow the identical shape.

setSelectedBorder(options: BorderOptions | string): this {
    const border = typeof options === "string" ? { border: options } : options;
    this.selectedStyleRule.setMany(borderToStyle(border));

    return this;
}
```

Import changes: drop `writeClassStateDeclaration, writeManyClassStateDeclarations` and `StyleRule` (from `~/core/StyleTarget.js` — no longer referenced anywhere in the file once `selectedStyleRule`'s type changes); add `import type { StateStyleRule } from "~/core/ClassStyleRules.js";`.

### `component/button/TabButton.ts` — one addition

Placed near `applyTabStyling` ([TabButton.ts:248](packages/lib/src/typescript/lib/component/button/TabButton.ts#L248)):

```typescript
/**
 * `TabButton`'s own `.selected:not(:hover)` declarations — the tab-specific
 * tokens `applyTabStyling` also writes per instance below. Overriding this
 * (rather than inheriting `ToggleButton`'s base tokens) is what lets the
 * shared `.TabButton.selected:not(:hover)` class rule cache the correct
 * per-class bag, so `applyTabStyling`'s writes dedupe against it instead of
 * always deviating from a mismatched shared rule.
 */
protected override getSelectedClassDeclarations(): Record<string, string | null> {
    return {
        backgroundColor: TAB_BUTTON_SELECTED_FILL.backgroundColor,
        backgroundImage: TAB_BUTTON_SELECTED_FILL.backgroundImage,
        boxShadow:       TAB_BUTTON_SELECTED_FILL.boxShadow,
    };
}
```

No import changes — `TAB_BUTTON_SELECTED_FILL` is an existing module-level constant in this file ([TabButton.ts:121](packages/lib/src/typescript/lib/component/button/TabButton.ts#L121)).

### `ARCHITECTURE.md` — new section

Insert after *CSS writes go through `StyleRule` / `InlineStyle`* and before *Defer DOM work to render time*:

```markdown
## Component CSS tiers and state-rule dedup

Every rendered element can be styled from three CSS rules, ranked by specificity — written `(id, class, type)`, the standard three-number comparison:

| Tier | Selector shape | Specificity | Who writes it |
|---|---|---|---|
| Framework | `:where(.ts-ui-component)` | `(0,0,0)` | `core/ClassStyleRules.ts`, once per process |
| Class | `.ButtonName`, `.ButtonName.pressed`, `.ButtonName.selected`, … | `(0,1,0)` per class chained | `ClassStyleDefaults` / `ensureClassStyleRule` / `ensureClassStateRule`, once per concrete component class |
| Instance | `#c17`, `#c17.pressed`, `#c17:not(.pressed)`, … | `(1,0,0)` regardless of how many classes are chained | Each `Component`'s own setters |

An id always outranks any number of chained classes. That makes a bare `#id` declaration beat a class-tier state rule like `.ButtonName.pressed` even though the latter chains two classes — so an instance that customizes a resting property (a caller-supplied `backgroundColor`, say) while its class also shares a `.pressed` rule for that property silently defeats `.pressed` for that one instance, permanently.

| Selectors compared | Specificity | Winner |
|---|---|---|
| `#c17` vs `.Button.pressed` | `(1,0,0)` vs `(0,2,0)` | `#c17` — the id wins regardless of pressed state |
| `#c17:not(.pressed)` vs `.Button.pressed` | `(1,1,0)` vs `(0,2,0)` | Neither: `:not(.pressed)` never matches while `.pressed` does, so only one selector applies at a time |

The fix is `:not()`: give the resting-tier write its own instance rule that excludes the toggle class, e.g. `#c17:not(.pressed)`. Because the two selectors can never match the same element at the same moment, there's nothing left to arbitrate.

`Component` automates this for the properties most often deviated per instance while a toggle state is active — `backgroundColor`, `backgroundImage`, `boxShadow`, written through `reconcileRuleDeclaration` / `setReconciledCSSRules`. Adding a new toggle-class state:

1. Build the state rule with `this.createStateStyleRule(suffix, resolveDefaults)` (see *Defer DOM work to render time* below) — this dedupes the state rule itself onto a shared `.ClassName<suffix>` rule.
2. If that state's class-tier rule declares `backgroundColor` / `backgroundImage` / `boxShadow`, override `getRestingExclusionSuffixes()` to add the toggle class: `return [...super.getRestingExclusionSuffixes(), ".selected"];`. `reconcileRuleDeclaration` / `setReconciledCSSRules` isolate those three properties onto the computed `:not(...)` rule automatically — no other code needed.

`Button` (`.pressed`) and `ToggleButton` (`.selected`) are the two components that need step 2 today.
```

Also extend the existing *Defer DOM work to render time* bullet on "Per-component state rules" ([ARCHITECTURE.md](ARCHITECTURE.md), the paragraph ending "...so a caller gets both by calling the returned wrapper's own `set()` / `setMany()`.") with one sentence: "When that state also competes with the resting tier for the same property (a shared `.selected` background, say), override `getRestingExclusionSuffixes()` too — see *Component CSS tiers and state-rule dedup* above."

---

## Ordered Implementation Steps

1. **Write the new generic-mechanism test file first.** Create `packages/lib/tests/core/RestingChromeIsolation.test.ts` covering `## Expected Behaviour` rows 1-7 below, using locally-declared `Component` subclasses named uniquely across the file (`RestingProbeRow<N>`, mirroring `ClassChromeRules.test.ts`'s `<Descriptive>ProbeRow<N>` convention). Copy `idSelector` / `declarationsDuring` from `ClassChromeRules.test.ts`.
   *Check:* `npx vitest run tests/core/RestingChromeIsolation.test.ts` — every case fails for the expected reason (no isolation exists yet).

2. **`core/Component.ts` — add the generalized mechanism.** Add `RESTING_ISOLATION_KEYS`, `getRestingExclusionSuffixes`, `restingIsolationSuffix`, `_chromeIsolationEnabled` / `isChromeIsolationEnabled` / `setChromeIsolationEnabled`, `isRestingChromeIsolated`, `_restingStyleRule` / `restingStyleRule`, and `materialiseRestingRule`, exactly as given in `## Internal Structure`, placed beside `matchesClassStyle` (around [Component.ts:4746](packages/lib/src/typescript/lib/core/Component.ts#L4746)).
   *Check:* `npm run typecheck`.

3. **`core/Component.ts` — route `reconcileRuleDeclaration` / `setReconciledCSSRules` through it.** Replace both bodies with the "After" versions in `## Internal Structure`.
   *Check:* `npm run typecheck`; `npx vitest run tests/core/RestingChromeIsolation.test.ts` — green. `npx vitest run tests/core/ClassChromeRules.test.ts` — still green, unmodified (no probe in that file overrides `getRestingExclusionSuffixes()`, so every case behaves exactly as before).

4. **`component/button/Button.ts` — migrate onto the generalized mechanism in one pass.** Delete `RESTING_RECONCILED_KEYS`, `_restingStyleRule` / `restingStyleRule`, `_restingChromeIsolated` / `isRestingChromeIsolated`, the `reconcileRuleDeclaration` override, and the `setReconciledCSSRules` override. Add `getRestingExclusionSuffixes()` returning `[".pressed"]`, placed where `isRestingChromeIsolated()` used to be. Rewrite the `setElementCSSRule` override and the chromeless branch of `applyChromeOptions`, per the two before → after blocks in `## Internal Structure`. Doing all of this in one pass avoids an intermediate state where `setElementCSSRule` or the chromeless branch reference a member this same step deletes.
   *Check:* `npm run typecheck` — clean. `grep -n 'RESTING_RECONCILED_KEYS\|_restingChromeIsolated' packages/lib/src/typescript/lib/component/button/Button.ts` — zero matches.

5. **Run Button's existing regression suite unmodified.** `npx vitest run tests/component/button/Button.restingChromeIsolation.test.ts tests/component/button/Button.pressedHoverClassHoisting.test.ts tests/core/ClassChromeRules.test.ts` — all green with no edits to any of the three files. This is the proof that generalizing the mechanism didn't change Button's own observable behaviour.

6. **`component/button/ToggleButton.ts` — migrate onto the generalized mechanism.** Apply the before → after block in `## Internal Structure`: change `selectedStyleRule`'s type and construction, delete `selectedClassBag`, add `getSelectedClassDeclarations()` (with the chromeless guard) and `getRestingExclusionSuffixes()`, and rewrite the four `setSelectedX` setters to call `this.selectedStyleRule.set(...)` / `.setMany(...)`. Update the two imports as described in `## Internal Structure`.
   *Check:* `npm run typecheck`.

7. **`component/button/TabButton.ts` — add `getSelectedClassDeclarations()`.** As given in `## Internal Structure`.
   *Check:* `npm run typecheck`.

8. **Update `ToggleButton.selectedClassHoisting.test.ts`.** Replace the file's header comment (it currently documents `.selected` as permanently disabled — see `## Expected Behaviour` row 8 for the corrected assertions) and rewrite its one test case to assert dedup now happens: a second, default `ToggleButton` writes nothing to its own `#id.selected:not(:hover)` rule, and `_ruleCacheHas('.ToggleButton.selected:not(:hover)')` is `true`.
   *Check:* `npx vitest run tests/component/button/ToggleButton.selectedClassHoisting.test.ts` — green.

9. **Update `TabButton.stateClassHoisting.test.ts`.** Update the header comment (the `.selected` half of its current claim is no longer true). Split the second test case in two: the hover half keeps its exact current assertions (hover is still never deduped); the selected half changes to assert a default `TabButton`'s `backgroundColor` / `backgroundImage` / `boxShadow` are absent from its own instance rule while its four border longhands are still present (border stays undeduped), and `_ruleCacheHas('.TabButton.selected:not(:hover)')` is `true`. The first test case (the `.pressed` class rule) is unchanged.
    *Check:* `npx vitest run tests/component/button/TabButton.stateClassHoisting.test.ts` — green.

10. **`ARCHITECTURE.md`.** Insert the new section and extend the existing bullet, exactly as given in `## Internal Structure`.
    *Check:* none beyond a read-through — this file has no build step of its own.

11. **Add the changelog entry.** See `## Documentation Impact`.

12. **Run the full verification list.** See `## Verification`.

13. **Verify live in a browser.** Non-negotiable — the automated suite asserts what gets *written*, not what the CSS cascade *resolves*, and every prior plan in this chain shipped at least one regression that only a live check caught. See `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/core/RestingChromeIsolation.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/ToggleButton.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/TabButton.ts` |
| Modify | `packages/lib/tests/component/button/ToggleButton.selectedClassHoisting.test.ts` |
| Modify | `packages/lib/tests/component/button/TabButton.stateClassHoisting.test.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-7 are unit-testable against the recording DOM sink, in the new `RestingChromeIsolation.test.ts`, using a plain `Component` subclass (not `Button`) so the generic mechanism is proven independent of any Button-specific plumbing. Rows 8-9 are the `ToggleButton` / `TabButton` migration outcomes, unit-testable in their existing test files. Rows 10-12 are cascade outcomes the sink cannot evaluate and need a live browser check.

| # | Case | Expected |
|---|---|---|
| 1 | A `Component` subclass that never overrides `getRestingExclusionSuffixes()` calls `reconcileRuleDeclaration("backgroundColor", "red")` | Writes straight to the bare `#id` rule — no isolated rule is created, identical to today's behaviour |
| 2 | A probe subclass overriding `getRestingExclusionSuffixes()` to return `['.on']` calls `setReconciledCSSRules({ backgroundColor: 'red' })` after render | `#id:not(.on)` receives `backgroundColor: 'red'`; the bare `#id` rule receives no `backgroundColor` |
| 3 | Same probe: the write's value matches what the class-tier bag already delivers | `#id:not(.on)` receives a `backgroundColor` **removal**, not a skipped write |
| 4 | A probe overriding it to return `['.on', '.off']` | The isolated rule's selector is `#id:not(.on):not(.off)`; a write matching neither the `.on` nor the `.off` class-tier default still isolates correctly |
| 5 | The same `['.on']` probe calls `reconcileRuleDeclaration("borderTop", "1px solid red")` (a key outside `RESTING_ISOLATION_KEYS`) | Writes straight to the bare `#id` rule — border is never isolated regardless of registration |
| 6 | The `['.on']` probe calls `setChromeIsolationEnabled(false)`, then writes a deviating `backgroundColor` | Writes straight to the bare `#id` rule — isolation is suppressed for this instance even though the suffix list is non-empty |
| 7 | A probe subclass of the `['.on']` probe overrides `getRestingExclusionSuffixes()` to `[...super.getRestingExclusionSuffixes(), '.extra']` | The isolated rule's selector is `#id:not(.on):not(.extra)` — the child's addition chains onto the parent's list |
| 8 | A second, default-styled `ToggleButton` renders after a first has warmed the class rule | No write to its own `#id.selected:not(:hover)` rule; `_ruleCacheHas('.ToggleButton.selected:not(:hover)')` is `true` |
| 9 | A second, default-styled `TabButton` renders after a first has warmed the class rule | `backgroundColor` / `backgroundImage` / `boxShadow` are absent from its own `#id.selected:not(:hover)` rule; the four border longhands are still present on it (border stays undeduped); `_ruleCacheHas('.TabButton.selected:not(:hover)')` is `true` |
| 10 | Toggle a default `ToggleButton` selected, in the browser | The background visibly changes from resting to the selected token; forcing `.selected` via DevTools shows a different computed `background-color` than resting |
| 11 | Toggle a `TabButton` selected while also pressing it | The selected fill shows through — pressing a selected tab does not revert it to the unselected background |
| 12 | A `ToggleButton` given a custom resting `backgroundColor`, then toggled selected | The custom resting colour shows while unselected; the selected token shows while selected — the custom value never leaks into the selected state |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants (all expect zero matches):

```
grep -n 'RESTING_RECONCILED_KEYS' packages/lib/src/typescript/lib/component/button/Button.ts
grep -n 'selectedClassBag' packages/lib/src/typescript/lib/component/button/ToggleButton.ts
grep -n 'writeClassStateDeclaration\|writeManyClassStateDeclarations' packages/lib/src/typescript/lib/component/button/ToggleButton.ts
```

**Manual browser verification (rows 10-12) is required.** The offline harness records writes, not what the browser's cascade resolves, and specificity is the whole subject of this change — every plan in this chain has shipped at least one regression the automated suite missed.

- Start a dev server on a spare port from *this worktree* (`npx vite --port 8024` inside `packages/lib`), not the user's existing server.
- Exercise `#/tabs` (a `TabBar`'s `TabButton`s — select one, press it while selected, hover it) and any screen using a plain `ToggleButton`.
- Read **computed styles** (forcing `.selected` / `.pressed` through DevTools where needed) rather than relying on screenshots.

---

## Documentation Impact

No new exported symbol — every new or changed `Component` / `Button` / `ToggleButton` / `TabButton` member is `protected` or `private`, and TypeDoc excludes both. No API page, barrel, or sidebar entry changes.

One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Components`, following the existing entries for the two prior plans in this chain:

- `ToggleButton`'s `.selected` background, background-image, and box-shadow now dedupe across instances of the same class, the same way `Button`'s `.pressed` chrome already does — no consumer action needed, and `TabButton` inherits the same behaviour for its own selected fill.

---

## Potential Challenges

- **A future consumer `styleRules` entry on a `ToggleButton` / `TabButton` at a single-class suffix could tie with the isolated rule**, the same concern `button-resting-chrome-state-isolation` flagged for `Button`. No in-repo caller does this today (confirmed: no `styleRules:` entry targets either class); a future one hitting the tie should lengthen its own suffix, as `Button.hoverStyleRule` already does.
- **A hypothetical chromeless `ToggleButton` instance** (`new ToggleButton(text, { chromeless: true })`) is covered by the class-default guard in `getSelectedClassDeclarations()`, but not by an instance-level pin equivalent to `Button.pinPressedToResting()` — no in-repo call site constructs one. If a future caller does, it needs a `pinSelectedToResting()` mirroring Button's, which this plan does not build.
- **The mechanical setter rewrite in `ToggleButton.ts` touches four call sites** with an identical transformation (`writeClassStateDeclaration(...)` → `this.selectedStyleRule.set(...)`). The typecheck and the existing regression tests catch a missed or wrong one.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/Component.ts` | `matchesClassStyle` (L4746), `reconcileRuleDeclaration` (L4780), `setReconciledCSSRules` (L4790), `createStyleRule` (L1009), `createStateStyleRule` (L1037), `setElementCSSRule(s)` (L1637-1666) — the mechanism being extended |
| `packages/lib/src/typescript/lib/component/button/Button.ts` | The mechanism's current, Button-only home being generalized: `RESTING_RECONCILED_KEYS` (L226), the rule/flag/overrides (L551-681), `getPressedClassDeclarations` (L701) — the per-class resolver pattern `ToggleButton`/`TabButton` mirror, `applyChromeOptions`'s chromeless branch (L1033) |
| `packages/lib/src/typescript/lib/component/button/ToggleButton.ts` | `selectedStyleRule` / `selectedClassBag` (L46-74) and its doc comment in full — the code and reasoning this plan replaces |
| `packages/lib/src/typescript/lib/component/button/TabButton.ts` | `TAB_BUTTON_SELECTED_FILL` (L121), `applyTabStyling` (L248) — what the new resolver must match |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `ensureClassStateRule` (L289), `writeClassStateDeclaration` (L349), `StateStyleRule` (L386) — unchanged, reused via `createStateStyleRule` |
| `plans/implemented/button-resting-chrome-state-isolation.md` | The precedent this plan generalizes — its Architecture Decisions are the source of the specificity tables and the `:not()` rationale reused in the new `ARCHITECTURE.md` section |
| `plans/implemented/state-style-rule-auto-dedup.md` | The sibling generalization this plan completes — its own Architecture Decisions explain why `ToggleButton` / `TabButton` were left out at the time, and its Non-Goals name this exact follow-up |
| `packages/lib/tests/core/ClassChromeRules.test.ts` | Test conventions this plan's new test file mirrors (`declarationsDuring`, `idSelector`, unique-per-file probe class names) |
| `packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts` | Must keep passing unmodified — proof that generalizing the mechanism preserves Button's exact behaviour |

---

## Non-Goals

- **`DiagramNode.ts`, `container/WindowBorder.ts`, `container/AccordionIndicator.ts`, `table/cell/Header.ts`.** Each writes a state-conditional class rule via raw `createStyleRule(...)` with no class-tier dedup attempt, but none currently has a competing resting write on the same property — today it's bloat, not a correctness bug. Migrating them onto `getRestingExclusionSuffixes()` / `createStateStyleRule` is straightforward, low-risk follow-up once this plan's mechanism exists, deliberately left out to keep this diff focused.
- **`MenuBarButton.setActive()`.** Writes `backgroundColor` through a plain JS ternary with no CSS class marker at all. It would need a toggle class introduced before any hoisting or isolation could apply — a different shape of change than migrating an existing state rule, left for a future plan.
- **`Checkbox.ts` / `RadioButton.ts`.** Their checked/unchecked/indeterminate state is three-way, not a boolean toggle, and it's applied to a child delegate sub-component (`_box` / `_ring`) rather than the host component — `getRestingExclusionSuffixes()` is read on `this`, and an anonymous delegate `Component` gets no class-tier rule at all under `ensureClassStyleRule`'s name-collision opt-out. Both are structural complications beyond this plan's scope.
- **A lint rule or regression guardrail** that would catch a future component author bypassing this mechanism. No such rule exists in `packages/lib/scripts/eslint/`'s five custom rules today. Valuable, but a separable follow-up plan once this plan's mechanism shape has shipped and proven stable.
- **Re-isolating `Button`'s known `foregroundColor` gap** (a custom resting `foregroundColor` still shows through `.pressed`). Unrelated to this plan's scope — `color` is not in `RESTING_ISOLATION_KEYS` today and this plan doesn't add it.
- **An instance-level `pinSelectedToResting()` for `ToggleButton`,** mirroring `Button.pinPressedToResting()`. See `## Potential Challenges` — no in-repo caller needs it.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^precedent]: `button-resting-chrome-state-isolation`'s own Architecture Decisions establish the `:not()` isolation trick and the clear-on-match comparison this plan generalizes without changing either. This plan's job is purely to relocate *where* the exclusion-suffix answer comes from — from a hardcoded Button constant to an overridable method — not to redesign the write-routing logic itself, which is already correct and already covered by `Button.restingChromeIsolation.test.ts`.

[^cascade-timing]: `component-chrome-base-tier-hoisting`'s own footnote `[^always-dispatch-group]` documents that `border`, `borderRadius`, `shadow`, and `backgroundImage` are dispatched through their setters during `Component.applyChromeOptions`, itself called from `super()`'s construction cascade — before any subclass constructor body has run. `TabButton._defaultTabButtonOptions.backgroundImage` reaches `Button`'s constructor through the `subclassDefaults` parameter `TabButton` forwards via `ToggleButton`, so `setBackgroundImage` — and therefore `setReconciledCSSRules` — fires while `Button`'s own constructor is still executing, well before `ToggleButton`'s or `TabButton`'s constructor bodies exist to make an imperative registration call. A virtual method has no such gap: `this.getRestingExclusionSuffixes()` resolves through the prototype chain to the most-derived override from the very first call, regardless of which ancestor's code is currently running.

[^fixed-keys]: Both properties this plan's concrete callers need (`Button.pressed`, `ToggleButton.selected`) isolate the exact same three keys. A per-component configurable key set would need its own design (where does the list come from, does it interact with `getRestingExclusionSuffixes()`'s per-suffix chaining) for zero current callers — speculative flexibility CODE_CONVENTIONS explicitly rules out ("No 'flexibility' or 'configurability' that wasn't requested").

[^chromeless-recap]: `button-resting-chrome-state-isolation`'s Potential Challenges documents this concretely: a consumer `styleRules` entry with a single-class suffix (`MenuBarButton`'s `":hover"` entry) sits at `(1,1,0)`, the same specificity the isolated rule would occupy — isolating a chromeless button's resting chrome would tie with it, decided only by stylesheet order.

[^protected-precedent]: `button-resting-chrome-state-isolation`'s Architecture Decision "`Component.matchesClassStyle` becomes `protected`" is the exact precedent: widen visibility only for the one predicate a subclass needs to reuse, change nothing else about it. This plan applies the identical reasoning to `_restingStyleRule` / `restingStyleRule`.

[^border-precedent]: `state-style-rule-auto-dedup`'s Architecture Decision "Every dedup this plan performs must satisfy a class-tier safety invariant" states the general rule this follows: a property is only safe to dedupe against a class-tier rule if every other tier — including the base resting tier — also writes it in a comparison-gated way. Border longhands fail that test (they are not in `RESTING_ISOLATION_KEYS`, so a deviating write still lands on bare `#id`), exactly as they did when `Button.getPressedClassDeclarations()` was narrowed away from including them.

[^chromeless-toggle-scope]: Mirrors `button-resting-chrome-state-isolation`'s own Architecture Decision "A class whose own defaults are chromeless publishes no `.pressed` class rule" — the identical guard, one property (`chromeless`) already inherited from `ButtonOptions`, applied to the new `.selected` resolver. Unlike `Button`, no in-repo class defaults `ToggleButton`/`TabButton` to chromeless, so this guard currently never triggers; it is included because the migration is what makes `getSelectedClassDeclarations()` return real declarations for the first time, and an unguarded resolver would be a live gap the moment a chromeless `ToggleButton` is ever constructed.

---

## Implementation Notes

**`ToggleButton`'s constructor needed one line changed beyond the plan's stated diff.** The plan's `ToggleButton.ts` before → after block left the constructor's three imperative seed calls untouched:

```typescript
this.setSelectedShadow(TOGGLE_SELECTED_DECLARATIONS.boxShadow!);
this.setSelectedBackgroundColor(TOGGLE_SELECTED_DECLARATIONS.backgroundColor!);
this.setSelectedBackgroundImage(TOGGLE_SELECTED_DECLARATIONS.backgroundImage!);
```

Implementing the plan exactly as written and then writing the test-first coverage for `TabButton` (Expected Behaviour row 9) surfaced a real, empirically-confirmed regression: a fresh `TabButton`'s own `#id.selected:not(:hover)` instance rule rendered `backgroundColor`/`backgroundImage`/`boxShadow` from `ToggleButton`'s base tokens (`var(--ts-ui-toggle-selected-bg, rgb(200, 200, 200))`, …) instead of `TAB_BUTTON_SELECTED_FILL`'s tab tokens — for *every* `TabButton` instance, not just a race on the first one. Root cause: these three constructor calls always run first (`ToggleButton`'s own constructor body, before `TabButton`'s `applyTabStyling()` gets a chance to run), and since they write literal base-class token values, they queue a *real* deviation into the per-instance dirty bag whenever `getSelectedClassDeclarations()` is overridden to something else (as `TabButton`'s now is). `StateStyleRule.set()` — via `writeClassStateDeclaration` — uses skip-on-match semantics (dedupe = *don't write*, not *write a removal*), so `applyTabStyling()`'s later, correctly-tokened write matches the (correctly `TabButton`-scoped) class bag and is *skipped* rather than clearing the stale base value already sitting in the dirty bag. The stale value then materializes on the higher-specificity instance rule and permanently outranks the correct class-tier rule. This is invisible before this plan (`selectedClassBag` was hardcoded `null`, so every write — including the later, correct one — was unconditionally real, and last-write-wins self-corrected it); introducing skip-on-match dedup is what exposes it.

Deviation made: the three constructor calls above are replaced with a single value-less access, `void this.selectedStyleRule;`, which still triggers `createStateStyleRule`'s eager `resolveDefaults()` call (so the class-tier rule is seeded from *this instance's own*, virtually-dispatched `getSelectedClassDeclarations()` — `TAB_BUTTON_SELECTED_FILL` for `TabButton`, `TOGGLE_SELECTED_DECLARATIONS`-derived for a plain `ToggleButton`) without queuing any per-instance value, real or stale. `TOGGLE_SELECTED_DECLARATIONS` itself is unchanged and stays referenced from `getSelectedClassDeclarations()` and from `setFlat()`'s un-flatten branch. Verified via a full `npm test` run (5007 tests, all green) plus the new `TabButton.stateClassHoisting.test.ts` row 9 case, which now correctly asserts `TAB_BUTTON_SELECTED_FILL`'s tokens dedupe onto the class rule instead of `ToggleButton`'s base tokens leaking through.
