---
depends-on: [per-class-component-defaults]
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
---

# Class-Scoped Style Rules — Implementation Plan

## Overview

Every `Component` owns a per-instance `#uuid` CSS rule on the framework's shared `<style id="Base">` sheet, and [`Component.applyStyle`](packages/lib/src/typescript/lib/core/Component.ts#L4336) writes roughly two dozen declarations into it on every render. For the classes that dominate a large table window, those declarations are byte-identical across every instance: 1,186 `Text` instances wrote 15 declaration keys with **zero** distinct values between them, and five cell classes did the same over 20 keys.[^measurement]

This plan moves the declarations that come from a class's defaults out of the per-instance rule and into **three tiers**: one framework-wide rule every component matches, one `.ClassName` rule per concrete component class holding only what that class differs on, and the existing `#uuid` rule holding per-instance deviations. An instance whose value for a declaration already reaches it from a lower tier skips the write entirely; an instance that deviates writes to `#uuid` as it does today, and wins on specificity. The inline geometry channel (`width` / `top` / `left` / `height` / `transform`) genuinely varies per instance and is untouched.

The work adds one internal module, `packages/lib/src/typescript/lib/core/ClassStyleRules.ts`, adds one CSS class to every rendered element from [`Component.init`](packages/lib/src/typescript/lib/core/Component.ts#L5354), and changes the six `applyStyle` phase methods in [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) to route their rule writes through one new private helper. No exported symbol changes.

Release target: **library 0.3.0** (`packages/lib/package.json` currently reads `0.2.0`; this plan does not bump it).

This plan **depends on** [`plans/per-class-component-defaults.md`](per-class-component-defaults.md), which makes `Component._defaultOptions` a frozen bag shared by every instance of a class. That shared bag is what makes a class rule derivable: the rule's body is computed from it, so it is class-uniform by construction rather than by observation.

---

## Architecture Decisions

### Three tiers, ordered by specificity

A declaration lands on the lowest tier that can carry it. The framework rule holds the value `Component`'s own defaults resolve to; a class rule holds only the keys where that class's defaults resolve to something else; `#uuid` holds what an individual instance changed.

| Tier | Selector | Specificity | Holds |
|---|---|---|---|
| Framework | `:where(.ts-ui-component)` | (0,0,0,0) | the thirteen hoistable keys at `Component`'s own default value |
| Class | `.TextArea` | (0,0,1,0) | only the keys where this class's defaults differ from the framework value |
| Instance | `#c-17` | (1,0,0,0) | everything an instance deviates on, plus the nine conditional keys |

`:where()` zeroes the specificity of what it wraps, so a class rule and an `#uuid` rule both beat the framework rule unconditionally, with no dependence on which rule was inserted first.[^selector-choice] The framework writes no `!important` anywhere (`grep -rn '!important' packages/lib/src` is empty), so nothing disturbs that ordering.

### Every rendered element carries `ts-ui-component`

[`Component.init`](packages/lib/src/typescript/lib/core/Component.ts#L5354) already applies `this.constructor.name` as a CSS class. It applies `ts-ui-component` in the same `DOM.sink.apply` call, so the framework rule has something to match.[^extra-class] The name is exported as `COMPONENT_CLASS` from `core/ClassStyleRules.ts` and imported by `core/Component.ts`, so the class and the selector cannot drift apart.

### The class rule is a module-level `StyleRule` with `scope: "class"`, keyed on the class constructor

`core/ClassStyleRules.ts` holds a `Map<Function, Entry>` from the concrete class constructor to its inherited declarations, and creates the rule with `new StyleRule({ scope: "class", name, styles })` — the shipped pattern for a module-level shared class rule, used by [`SortPriorityBadge`](packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts#L34) and [`ResizeHandle`](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts#L56), both of which already name their rule after their component class.[^precedent] The framework rule uses the same class with `scope: "selector"`, the escape hatch `StyleRuleScope` documents for selector shapes outside `.Class` and `#id`. The key is the constructor, not the class name, for the same reasons the defaults cache uses one.[^ctor-key]

### Both rules' bodies are computed from the class defaults, never observed from an instance

`ensureClassStyleRule(ctor, defaults)` builds from the shared frozen defaults bag alone. It never reads an instance's `_options`, so a body cannot be skewed by whichever instance happened to render first.[^derive-not-observe]

### Only declarations that every instance writes on every render may be hoisted

A closed list of thirteen keys is hoistable. A key qualifies only when `applyStyle` writes it for **every** component on **every** render — otherwise a lower tier could hold a declaration that an instance never counteracts, and the instance would silently inherit it.[^unconditional-rule]

Six of the thirteen resolve to one value for every component class in the library; the other seven are overridden by a handful of classes through their defaults bag, and those classes are what the class tier exists for.[^derived-set]

| Hoisted key | Framework value | Classes whose defaults differ | Phase that writes it |
|---|---|---|---|
| `boxSizing` | `"border-box"` | — | `applyBoxAndVisibilityStyles` |
| `position` | `"absolute"` (`Position.ABSOLUTE`) | — | `applyBoxAndVisibilityStyles` |
| `display` | `"block"` | — | `applyBoxAndVisibilityStyles` |
| `whiteSpace` | `"nowrap"` | — | `applyMiscInlineStyles` |
| `userSelect` | `"none"` | — | `applyMiscInlineStyles` |
| `margin` | `"0px 0px 0px 0px"` | — | `applyMiscInlineStyles` |
| `visibility` | `"inherit"` | `AnimatedDropdown` and its subclasses (`visible: false`) | `applyBoxAndVisibilityStyles` |
| `minWidth` / `minHeight` | `"0px"` | `TextArea`, `FieldSet` (`100px`); `LabeledFieldSet` (`auto`) | `applySizeConstraintStyles` |
| `maxWidth` / `maxHeight` | `"none"` | — | `applySizeConstraintStyles` |
| `overflowX` / `overflowY` | `"hidden"` | `TextArea`, `Drawer` (`auto`); `ToolBar` (`clip`) | `applyOverflowStyles` |

Everything else `applyStyle` writes into a rule — `cursor`, `color`, `backgroundColor`, `backgroundImage`, `border`, `outline`, `borderRadius`, `boxShadow`, `padding` — is written behind an `if`, so it stays on `#uuid` unconditionally.

### A class rule with an empty body is not created

When a class's defaults resolve to the framework value for all thirteen keys, there is nothing for `.ClassName` to declare and no rule is inserted. The class still **claims** its selector in the registry, so a second class sharing its name takes the opt-out branch below.[^empty-rule]

### The per-declaration decision is a value comparison against one merged bag

Each of the six phase methods stops calling `this._styleRule` directly and calls a new private `Component.writeRuleDeclaration(key, value)`. `ensureClassStyleRule` returns the **inherited bag** — the framework declarations with the class's deviations merged over them, which is exactly what the cascade delivers to an element of that class from the two lower tiers. The helper drops the write when the inherited bag already carries that exact key/value pair, and otherwise writes to `#uuid` as today.

Comparing against the merged bag rather than against either tier separately is what keeps a class override honest: an instance that sets a value back to the *framework* value must still write it, because its class rule outranks the framework rule.

| Class / instance | `applyStyle` produces | Inherited bag says | Result |
|---|---|---|---|
| `Panel` (no options) | `margin: "0px 0px 0px 0px"` | framework: same | skipped — the framework rule serves it |
| `Panel` (no options) | `overflowX: "hidden"` | framework: `"hidden"` | skipped |
| `TextArea` (no options) | `overflowX: "auto"` | class `.TextArea`: `"auto"` | skipped — the class rule serves it |
| `TextArea({ overflow: "hidden" })` | `overflowX: "hidden"` | class `.TextArea`: `"auto"` | written to `#uuid` — it must beat `.TextArea` |
| `Dialog` (constructor sets `Position.FIXED`) | `position: "fixed"` | framework: `"absolute"` | written to `#uuid` |
| `Text` after `setMinSize({width:180,height:0})` | `minWidth: "180px"` | framework: `"0px"` | written to `#uuid` |
| any component | `cursor: "default"` | absent from the bag | written to `#uuid` (conditional key, never hoisted) |

### `#uuid` outranks both lower tiers, so a deviation and every runtime setter still win

An id selector scores (1,0,0,0) against a class selector's (0,0,1,0) and the framework rule's (0,0,0,0), so the per-instance rule wins every hoisted key it carries. Runtime setters are unchanged: `setOverflowY("auto")` after render still routes through `setElementCSSRule` into `this._styleRule`, and lands on `#uuid`.

### The framework rule and a class rule are never torn down

`ensureClassStyleRule` deliberately does **not** call `Component.trackSelector`, for either rule it creates. The two teardown paths — the eager `destructor()` at [Component.ts:789](packages/lib/src/typescript/lib/core/Component.ts#L789) and the GC finalizer at [Component.ts:296](packages/lib/src/typescript/lib/core/Component.ts#L296) — only dispose tracked, component-scoped selectors, so the last instance of a class dying leaves both `.ClassName` and `:where(.ts-ui-component)` on the sheet. A later instance of that class finds the registry entry already present and renders against the same rules.[^lifecycle]

### Two classes with the same name: the first to render claims the selector, the second opts out of both tiers

`.ClassName` is derived from `ctor.name`, and two component classes in this tree share a name.[^duplicate-names] The registry keeps a second map from selector to owning constructor. A class that finds its selector already claimed by a *different* constructor is recorded with a `null` bag and skips nothing — every one of its thirteen declarations goes to `#uuid`, exactly as today. It must bypass the framework tier too, not just the class tier: its elements carry the claiming class's selector, so the claiming class's rule applies to them and only an `#uuid` declaration reliably beats it.[^optout-bypasses-both] An anonymous class (empty `ctor.name`) takes the same opt-out branch.

---

## Public API

No exported symbol is added, removed, or changed. `core/ClassStyleRules.ts` is internal and **must not** be added to [`core/index.ts`](packages/lib/src/typescript/lib/core/index.ts).

Internal signatures the implementer writes:

```typescript
// core/ClassStyleRules.ts
export const COMPONENT_CLASS = "ts-ui-component";

export function ensureClassStyleRule(
    ctor:     Function,
    defaults: ClassStyleDefaults,
): Readonly<Record<string, string>> | null;
```

```typescript
// core/Component.ts — new private member and field
private writeRuleDeclaration(key: string, value: string | null): void;
private _inheritedStyleBag: Readonly<Record<string, string>> | null = null;
```

`_inheritedStyleBag` is a render-time cache, not consumer configuration, so per ARCHITECTURE.md it stays off the options bag. It is written only from `applyStyle`, which never runs during the `super()` cascade (it requires a rendered element), so a plain field initializer is correct and `declare` is not needed.

---

## Internal Structure

### `core/ClassStyleRules.ts`

The defaults are typed structurally rather than as `ComponentOptions`, so this module does not import from `core/Component.ts` and no import cycle appears.

```typescript
import { StyleRule }  from "~/core/StyleTarget.js";
import { Position }   from "~/primitive/Position.js";
import { isUnbounded } from "~/primitive/Size.js";

/** The CSS class every rendered component element carries. */
export const COMPONENT_CLASS = "ts-ui-component";

// `:where()` computes to zero specificity, so both `.ClassName` and `#id`
// outrank this rule whatever order the sheet ends up in.
const FRAMEWORK_SELECTOR = ":where(." + COMPONENT_CLASS + ")";

/** The class-default fields a rule body is derived from. */
interface ClassStyleDefaults {
    visible?:   boolean | null;
    displayed?: boolean;
    minSize?:   { width: number; height: number } | null;
    maxSize?:   { width: number; height: number } | null;
    overflow?:  string | null;
}

type ClassStyleBag = Readonly<Record<string, string>>;

// The thirteen hoistable keys at the value Component's own defaults resolve to.
const FRAMEWORK_DECLARATIONS: ClassStyleBag = Object.freeze({
    boxSizing:  "border-box",
    position:   Position.ABSOLUTE,
    display:    "block",
    visibility: "inherit",
    whiteSpace: "nowrap",
    userSelect: "none",
    margin:     "0px 0px 0px 0px",
    minWidth:   "0px",
    minHeight:  "0px",
    maxWidth:   "none",
    maxHeight:  "none",
    overflowX:  "hidden",
    overflowY:  "hidden",
});

// Per-class inherited declarations: the framework body with this class's
// deviations merged over it. A `null` entry means the class opted out (its
// selector is owned by a different constructor, or it is anonymous).
const _bags: Map<Function, ClassStyleBag | null> = new Map();

// Selector owner, so a name shared by two classes is detected.
const _owners: Map<string, Function> = new Map();

let _frameworkRuleCreated = false;

function ensureFrameworkStyleRule(): void {
    if (_frameworkRuleCreated) {
        return;
    }

    _frameworkRuleCreated = true;

    new StyleRule({ scope: "selector", name: FRAMEWORK_SELECTOR, styles: { ...FRAMEWORK_DECLARATIONS } });
}

/**
 * The thirteen declarations an instance of this class produces from defaults
 * alone. A key the phase would *not* write gets the value that reproduces "no
 * declaration", so the framework rule's value is undone rather than inherited.
 */
function resolveDeclarations(defaults: ClassStyleDefaults): Record<string, string> {
    const minSize  = defaults.minSize  ?? null;
    const maxSize  = defaults.maxSize  ?? null;
    const overflow = defaults.overflow ?? null;

    return {
        boxSizing:  "border-box",
        position:   Position.ABSOLUTE,
        display:    (defaults.displayed ?? true) ? "block" : "none",
        visibility: (defaults.visible ?? null) === false ? "hidden" : "inherit",
        whiteSpace: "nowrap",
        userSelect: "none",
        margin:     "0px 0px 0px 0px",
        minWidth:   minSize ? minSize.width  + "px" : "auto",
        minHeight:  minSize ? minSize.height + "px" : "auto",
        maxWidth:   maxSize ? (isUnbounded(maxSize.width)  ? "none" : maxSize.width  + "px") : "none",
        maxHeight:  maxSize ? (isUnbounded(maxSize.height) ? "none" : maxSize.height + "px") : "none",
        overflowX:  overflow ?? "visible",
        overflowY:  overflow ?? "visible",
    };
}

/** The subset of `resolveDeclarations` that differs from the framework rule. */
function classDeviations(defaults: ClassStyleDefaults): Record<string, string> {
    const resolved = resolveDeclarations(defaults);
    const out: Record<string, string> = {};

    for (const key of Object.keys(resolved)) {
        if (resolved[key] !== FRAMEWORK_DECLARATIONS[key]) {
            out[key] = resolved[key];
        }
    }

    return out;
}

export function ensureClassStyleRule(
    ctor: Function,
    defaults: ClassStyleDefaults,
): ClassStyleBag | null {
    const existing = _bags.get(ctor);

    if (existing !== undefined) {
        return existing;
    }

    ensureFrameworkStyleRule();

    const name  = ctor.name;
    const owner = _owners.get(name);

    if (!name || (owner !== undefined && owner !== ctor)) {
        _bags.set(ctor, null);

        return null;
    }

    const deviations = classDeviations(defaults);

    // Claim the selector whether or not a rule is inserted, so a second class
    // of the same name still opts out. An empty body would insert a rule that
    // declares nothing, so skip it.
    _owners.set(name, ctor);

    if (Object.keys(deviations).length > 0) {
        new StyleRule({ scope: "class", name, styles: deviations });
    }

    const inherited = Object.freeze({ ...FRAMEWORK_DECLARATIONS, ...deviations });

    _bags.set(ctor, inherited);

    return inherited;
}
```

The `new StyleRule(...)` return values are intentionally unused: the constructor materialises the rule and flushes `styles` onto it, and nothing ever writes to either rule again. This mirrors the module-level shared class rules in `Glyph.ts` and `Markdown.ts`, which also discard the instance.

### `Component.writeRuleDeclaration`

```typescript
/**
 * Routes one `applyStyle` rule declaration to the rule that should carry it:
 * dropped when the framework or class rule already delivers the same
 * key/value, written to the per-component `#id` rule otherwise.
 */
private writeRuleDeclaration(key: string, value: string | null): void {
    if (this._inheritedStyleBag !== null && this._inheritedStyleBag[key] === value) {
        return;
    }

    this._styleRule.set(key, value);
}
```

`StyleTarget.set` queues while the rule is unmaterialised and writes through once it is, so this one call is correct whether `applyStyle` materialises the rule before the phases (today) or after them (once the batched-flush plan lands).

### `Component.applyStyle`'s new first line

```typescript
// Resolve the declarations this class inherits from the framework and class
// rules before the phases run, so each phase can skip one it already gets.
this._inheritedStyleBag = ensureClassStyleRule(this.constructor, this._defaultOptions);
```

`this.constructor` is the concrete class even through the `callable()` Proxy, and `ctor.name` is the same string [`init`](packages/lib/src/typescript/lib/core/Component.ts#L5354) applies to the element as a CSS class — the two must stay identical or the class rule never matches.

---

## Ordered Implementation Steps

Test-first: step 1 writes the failing tests, steps 2–5 make them pass.

1. **Write `packages/lib/tests/core/ClassStyleRules.test.ts`** covering every *unit* case in `## Expected Behaviour`. Copy the harness preamble (`DOM_CONFIG`, `installTestDOM`, `beforeEach` / `afterEach` with `DOM.reset()`) from [tests/component/Component.test.ts:1-20](packages/lib/tests/component/Component.test.ts#L1-L20). Three rules the file must follow, all explained in `## Expected Behaviour`: **every test declares its own uniquely-named local `Component` subclass**, **measurements are taken on the second instance of a class**, and **the framework rule is asserted through `_ruleCacheHas`, never through a recorded op**. Run the file; the hoisting cases must fail.

2. **Create `packages/lib/src/typescript/lib/core/ClassStyleRules.ts`** exactly as in `## Internal Structure`, with full JSDoc on the module, on `COMPONENT_CLASS`, on `ClassStyleDefaults`, and on `ensureClassStyleRule`. Do **not** add it to `core/index.ts`. Check: `grep -n 'ClassStyleRules' packages/lib/src/typescript/lib/core/index.ts` → expect zero matches.

3. **`core/Component.ts` — add the import, the field, and the helper.** Add `import { COMPONENT_CLASS, ensureClassStyleRule } from "~/core/ClassStyleRules.js";` beside the existing `StyleTarget` import (line 18). Add `private _inheritedStyleBag: Readonly<Record<string, string>> | null = null;` immediately after the `_styleRule` / `_inlineStyle` declarations (lines 405-406), with a comment saying it is the per-render cache of what the framework and class rules already deliver. Add the `writeRuleDeclaration` method from `## Internal Structure` directly above `applyStyle` (line 4336).

4. **`core/Component.ts` — apply the framework class.** At [line 5354](packages/lib/src/typescript/lib/core/Component.ts#L5354), change `DOM.sink.apply(element, { addClass: [this.constructor.name] });` to `DOM.sink.apply(element, { addClass: [COMPONENT_CLASS, this.constructor.name] });`. Keep it as one `apply` call — [tests/core/ElementAttributeReplay.test.ts:156](packages/lib/tests/core/ElementAttributeReplay.test.ts#L156) finds the first `apply` carrying an `addClass` payload and asserts it comes after the `setAttr` one, so splitting it into two calls would change what that test measures.

5. **`core/Component.ts` — route the phases.** Insert the `ensureClassStyleRule` line from `## Internal Structure` as the first statement of `applyStyle`'s body (after the `DOM.sink.apply(element, { removeAttr: ["style"] })` call at line 4337). Then, **inside the six phase methods only** (`applyBoxAndVisibilityStyles` 4361, `replayGeometryStyles` 4414, `applySizeConstraintStyles` 4446, `applyOverflowStyles` 4469, `applyChromeStyles` 4490, `applyMiscInlineStyles` 4518), replace every single-property `this._styleRule.set(` — or `this._styleRule.queue(`, if the batched-flush plan has already landed — with `this.writeRuleDeclaration(`. Leave three things alone: every `this._inlineStyle.set(` call, the bulk `this._styleRule.setMany(borderToStyle(this._border))` at line 4492, and `materialiseDeferredRules`. Check: `grep -n '_styleRule\.\(set\|queue\)(' packages/lib/src/typescript/lib/core/Component.ts` → exactly one surviving match, inside `setElementCSSRule` (line 1450). The bulk forms (`setMany` at 4492, `queueMany` at 1432) do not match this pattern and are deliberately left in place.

6. **Run the new test file.** `cd packages/lib && npx vitest run tests/core/ClassStyleRules.test.ts` — all unit cases pass.

7. **Run the whole suite** and fix any assertion that counted a *render-time* write of a hoisted key, or that asserted an exact element class list. A survey of the current tests found none of either: the four `setRuleStyle` assertions in [tests/component/Component.test.ts:157-169](packages/lib/tests/component/Component.test.ts#L157) fire after `getElement(true)` from `setMinSize` / `setMaxSize`, the `visibility` assertions in [tests/component/EffectiveVisibility.test.ts:198-244](packages/lib/tests/component/EffectiveVisibility.test.ts#L198) are before/after deltas around `setVisible` calls, and every `addClass` assertion in the suite uses `includes` or targets an inner, non-`Component` element. If one does fail, the fix is to assert on the delta or on the tier, never to widen the hoist list.

8. **Update the JSDoc** on `applyStyle` (line 4327-4334) and on `getCSSRule` (line 866): both currently imply a component's declarations live in one rule. Say instead that class-uniform declarations live on a framework-wide rule and a shared `.ClassName` rule, and `#id` carries the per-instance deviations. Per CODE_CONVENTIONS.md, describe the mechanism in prose — do not `{@link}` `ensureClassStyleRule`, `COMPONENT_CLASS`, or `ClassStyleRules`, which are not in the rendered docs.

9. **Run the full verification list** in `## Verification`, including the manual browser checks.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Create | `packages/lib/tests/core/ClassStyleRules.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |

---

## Expected Behaviour

**Three constraints on how these cases are tested.** First, the registry and the `_ruleCache` in `core/StyleTarget.ts` are module state that survives `DOM.reset()`, so a class name reused across two tests emits its `ensureStyleRule` op only in the first — **every test declares its own uniquely-named local `Component` subclass**. Second, the recording sink's `setRuleStyle` op does not carry the rule's selector, so a render that also creates a shared rule mixes both rules' writes together; **measure on the second instance of a class**, by which point the shared rules exist and every recorded rule write belongs to that instance's `#id` rule. Third, the framework rule is created once per *process*, not once per test, so no test after the first can observe its `ensureStyleRule` op — assert it through `_ruleCacheHas(':where(.ts-ui-component)')` from `~/core/StyleTarget` instead. A local helper in the test file captures the measurement window:

```typescript
/** Rule declarations written while `fn()` ran. Valid only once the shared rules exist. */
function declarationsDuring(sink: RecordingDOMSink, fn: () => void): Record<string, string | null> {
    const start = sink.writes.length;
    fn();

    const out: Record<string, string | null> = {};

    for (const w of sink.writes.slice(start)) {
        if (w.op === 'setRuleStyle') {
            out[w.args[0] as string] = w.args[1] as string | null;
        }
    }

    return out;
}
```

`Probe` below means a test-local `class Probe extends Component` with no `subclassDefaults` — its defaults resolve to the framework value for all thirteen keys.

| # | Case | Expected | How |
|---|---|---|---|
| 1 | **A default-valued declaration lands on no per-component rule.** Render one `Probe`, then measure a second `Probe`'s render. | The captured declarations contain **none** of `position`, `visibility`, `display`, `boxSizing`, `whiteSpace`, `userSelect`, `margin`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `overflowX`, `overflowY`. | unit |
| 2 | **A universal declaration lands on the framework rule and on neither other tier.** Render two `Probe`s. | `_ruleCacheHas(':where(.ts-ui-component)')` is `true`; no `ensureStyleRule` op is recorded for `.Probe`; the `setRuleStyle` writes during the *first* render contain no `position` and no `margin`. | unit |
| 3 | **A class differing in nothing produces no class rule.** Render two `Probe`s. | `_ruleCacheHas('.Probe')` is `false` and no `ensureStyleRule` op for `.Probe` is recorded — yet case 1 still holds, so the framework rule is what serves those declarations. | unit |
| 4 | **A class that overrides a universal value gets it on its class rule.** `class WideProbe extends Component` whose `subclassDefaults` are `{ minSize: { width: 100, height: 0 }, overflow: 'auto' }`. Render two `WideProbe`s. | `ensureStyleRule` is recorded for `.WideProbe` exactly once, and the `setRuleStyle` writes during the *first* render carry `minWidth` → `"100px"`, `overflowX` → `"auto"`, `overflowY` → `"auto"` — and **not** `minHeight` (`0px` matches the framework value), `position`, or `margin`. The second render writes none of the thirteen. | unit |
| 5 | **An instance override beats both lower tiers.** After case 4, measure `new WideProbe({ overflow: 'hidden' }).getElement(true)`. | The captured declarations contain `overflowX` → `"hidden"` and `overflowY` → `"hidden"` — matching the *framework* value is not enough to skip, because `.WideProbe` outranks the framework rule. | unit |
| 6 | **An explicitly-set value lands on `#uuid`.** Render one `Probe`, then measure `new Probe({ overflow: 'auto' }).getElement(true)`. | The captured declarations contain `overflowX` → `"auto"` and `overflowY` → `"auto"`; they still contain no `position` and no `margin`. | unit |
| 7 | **The framework class is present on a rendered element.** Render a `Probe`. | An `apply` op is recorded whose patch's `addClass` array contains both `'ts-ui-component'` and `'Probe'`, and it is one op, not two. | unit |
| 8 | **A runtime setter after render writes `#uuid`.** Render two `Probe`s, then measure `b.setMinSize({ width: 180, height: 0 })`. | The captured declarations contain `minWidth` → `"180px"` and `minHeight` → `"0px"`. | unit |
| 9 | **A runtime setter that restores a framework value still writes `#uuid`.** After case 8, measure `b.setOverflowY('hidden')` on a `Probe`. | The captured declarations contain `overflowY` → `"hidden"` — the helper only skips writes issued from `applyStyle`, never from a setter. | unit |
| 10 | **Instances of one class share one set of rules.** Render three `Probe`s. | No `ensureStyleRule` op for `.Probe` at all; the second and third renders each write no `position`. | unit |
| 11 | **A class with no min-size default undoes the framework value.** `class BareProbe extends Component` whose `subclassDefaults` are `{ minSize: undefined }`. Render two `BareProbe`s. | The writes during the first render carry `minWidth` → `"auto"` and `minHeight` → `"auto"` (the `.BareProbe` body), so the framework rule's `0px` is not inherited. The second instance writes neither key. | unit |
| 12 | **A subclass gets its own rule and inherits the rest.** `class SubProbe extends WideProbe` passing `{ overflow: 'clip' }` as its `subclassDefaults`. Render two `SubProbe`s and two `WideProbe`s. | `ensureStyleRule` recorded for both `.WideProbe` and `.SubProbe`. The `.SubProbe` body carries `overflowX` / `overflowY` → `"clip"` **and** `minWidth` → `"100px"` (inherited from `WideProbe`'s defaults, still a deviation from the framework value). The second `WideProbe` still writes no `overflowX` — the two class rules are independent. | unit |
| 13 | **Destroying an instance leaves the shared rules intact.** Render two `WideProbe`s, call `destructor()` on both. | No `deleteStyleRule` op is recorded for `.WideProbe` or for `:where(.ts-ui-component)`; `_ruleCacheHas('.WideProbe')` and `_ruleCacheHas(':where(.ts-ui-component)')` are both `true`. | unit |
| 14 | **A new instance after that still renders styled.** After case 13, render a third `WideProbe` and measure it. | No new `ensureStyleRule` for `.WideProbe`; the captured declarations still contain no `position` and no `overflowX` — the surviving rules serve them. | unit |
| 15 | **Two classes with the same name — the second opts out of both tiers.** Two local classes both named `Twin`, the first with `subclassDefaults` `{ overflow: 'auto' }`, each rendered twice. | `ensureStyleRule` recorded for `.Twin` exactly once. The second instance of the *claiming* class writes no `overflowX`. The second instance of the *other* class writes **all thirteen** hoistable keys to its `#id` rule, including `position` → `"absolute"` and `margin` → `"0px 0px 0px 0px"` that the framework rule would otherwise have served. | unit |
| 16 | **Conditional declarations are never hoisted.** Render two `Probe`s, the second with `{ cursor: 'pointer', backgroundColor: '#fff' }`. | The captured declarations contain `cursor` → `"pointer"`, `backgroundColor` → `"#fff"`, and `border` → `null` (written unconditionally by the else-branch of `applyChromeStyles`); none of these three keys is in the hoist table, so none can appear in either shared rule body. | unit |
| 17 | **No rule for a component that never renders.** Construct a `Probe` without calling `getElement(true)`. | No `ensureStyleRule` op for `.Probe` is recorded — the rules are created at render time, per ARCHITECTURE.md's *Defer DOM work to render time*. | unit |
| 18 | **Real cascade resolution.** In the browser, a `TextArea` scrolls while a plain `Panel` clips, and a `TextArea({ overflow: 'hidden' })` clips. | `#uuid` beats `.TextArea` beats `:where(.ts-ui-component)`; no component picks up a sibling's deviation. | manual |
| 19 | **Visual parity.** The demo app renders identically before and after. | No change to sizing, visibility, overflow, or spacing anywhere — in particular for `ResizeHandle`, `SortPriorityBadge`, `ComboBox`, and `SelectableListRow`, whose existing module class rules now share a `CSSStyleRule` object with a generated one. | manual |

---

## Verification

Run from `packages/lib` unless noted:

1. `npx vitest run --no-file-parallelism` — **`Tests N passed` is not sufficient**. The `Errors` line must read zero and the process exit code must be `0`.
2. `npm run typecheck` — exactly the **7** known pre-existing errors, no more.
3. `npm run typecheck:test`.
4. `npm run lint` — clean. `core/ClassStyleRules.ts` touches no raw DOM (it goes through `StyleRule`), so the `local/no-raw-dom` rule's empty baseline must hold.
5. `grep -n 'ClassStyleRules' packages/lib/src/typescript/lib/core/index.ts` — zero matches.
6. `grep -n '_styleRule\.\(set\|queue\)(' packages/lib/src/typescript/lib/core/Component.ts` — matches only inside `setElementCSSRule` and `setElementCSSRules`.
7. `grep -rn 'trackSelector' packages/lib/src/typescript/lib/core/ClassStyleRules.ts` — zero matches (neither shared rule may be tracked for teardown).
8. `grep -rn '"ts-ui-component"' packages/lib/src` — exactly one match, the `COMPONENT_CLASS` definition in `core/ClassStyleRules.ts`.
9. `npm run docs:build` from the repo root — zero warnings (step 8 edits rendered JSDoc). The build needs several GB of heap; the script pins `NODE_OPTIONS`, but on a memory-starved machine it can be OOM-killed (exit 137) — free memory rather than raising the limit.
10. **Manual, browser** (`npm run dev`, http://localhost:8015). Confirm cases 18 and 19:
    - Open the wide-table demo, a `Tab` demo, and a `Button` demo. Everything must be positioned, sized, clipped, and hidden/shown exactly as before.
    - In DevTools, inspect a rendered element and confirm its `class` attribute carries both `ts-ui-component` and its component class name.
    - Inspect `<style id="Base">` and confirm a `:where(.ts-ui-component)` rule exists carrying `position`, `visibility`, `display`, `margin`, min/max and overflow; that no `.Text` rule exists (its defaults deviate in nothing); and that a `#uuid` rule for a `Text` no longer repeats those declarations.
    - Open a `TextArea` demo and a `ToolBar`, and confirm `.TextArea` / `.ToolBar` rules exist carrying only their overflow and min-size deviations.
    - Open a `ComboBox` and confirm its dropdown still starts hidden — `AnimatedDropdown`'s `visibility: hidden` must reach the dropdown class's rule.
    - Select a table header cell and confirm its `ResizeHandle` still sits at the right edge at full height, and that a multi-sorted column still shows its priority badge in the top-right corner.
    - Switch a `Panel` demo with `autoScroll` on and confirm it still scrolls (its `overflow` deviation must reach `#uuid`).
    - Close and reopen a floating window and confirm the reopened one is styled — the shared rules must have survived the first window's teardown.

---

## Documentation Impact

No exported symbol is added, removed, or renamed, so no doc page, catalog entry, or sidebar entry changes.

- Step 8 edits the JSDoc of `Component.applyStyle` (public) and `Component.getCSSRule` (protected, not rendered). Run `npm run docs:build` and confirm zero warnings.
- Two lines for the 0.3.0 release notes. First: every rendered component element now carries an extra `ts-ui-component` CSS class alongside its class-name class. Second: a component's CSS declarations are now spread across a zero-specificity framework rule, a shared `.ClassName` rule, and its `#id` rule — a consumer stylesheet that targets a component by class (`.Button { … }`) beats the framework rule but ties on specificity with a generated class rule, where before the framework's `#id` rule always won.
- [`ARCHITECTURE.md`](ARCHITECTURE.md)'s *CSS writes go through `StyleRule` / `InlineStyle`* section already lists "shared class rules" as a `StyleRule` target and needs no edit.
- [`packages/lib/docs/recipes/local-development.md:35`](packages/lib/docs/recipes/local-development.md#L35) explains that CSS classes derive from `constructor.name` and that the minifier must keep names. That stays true — the framework class is a string literal, and the class tier still depends on `constructor.name`. No edit.

---

## Potential Challenges

- **This changes what CSS every component emits and adds a class to every element — the widest blast radius of the four sibling plans.** Every rendered component takes the new path. Mitigation: the hoist list is closed and small, the fallback for any mismatch is the current behaviour, and the manual browser pass in `## Verification` covers table, tab, button, combo-dropdown, panel-scroll, and window-reopen paths. Land it as its own commit so a bisect isolates it.
- **The offline harness cannot prove the cascade.** `RecordingDOMSink` records sink calls; it never resolves CSS. So the tests prove *which tier a declaration was written to*, not that `#uuid` actually beats `.ClassName` beats `:where(.ts-ui-component)` in a browser, and not that the rendered result is unchanged. Cases 18 and 19 are the substitute and must actually be performed.
- **An author-origin type selector beats the framework rule.** `:where(…)` scores (0,0,0,0), below a bare element selector's (0,0,0,1), so a consumer rule like `div { margin: 8px }` would now override the framework `margin` where previously the `#id` rule won. The library itself ships no rule whose subject is a bare element selector — every module rule is keyed on a class or an id (`grep -rn 'scope: *"selector"' packages/lib/src`; the one rule naming an element type, `.ts-ui-mde-table-cell > p`, targets markdown content, not a component) — and browser default styles are a lower cascade origin, so they are unaffected either way. Recorded for the release notes rather than mitigated; the alternative selector shapes are worse.[^selector-choice]
- **The recording sink does not carry the rule selector.** `RecordingDOMSink.setRuleStyle` records only key and value ([tests/dom/TestDOM.ts:383](packages/lib/tests/dom/TestDOM.ts#L383)), which is why the tests measure the *second* instance of a class. If [`plans/stylerule-batched-flush.md`](stylerule-batched-flush.md) lands first, the recorded op becomes `setRuleStyles(selector, bag)` — then only the `declarationsDuring` helper in the new test file changes, to flatten `args[1]` and filter on `args[0]`. Nothing else in this plan depends on the op shape.
- **Four component classes already own a rule with a selector this plan generates.** `ResizeHandle`, `SortPriorityBadge`, `ComboBox`, and `SelectableListRow` each register a module-level `.ClassName` rule. All go through the same `_ruleCache` in `core/StyleTarget.ts`, so a hand-written body and a generated one merge into one `CSSStyleRule`, last write per property winning. The keys they share with the hoist table — `position` on the first two, `whiteSpace` and `userSelect` on `.ComboBox`, `whiteSpace` and `overflow` on `.SelectableListRow` — carry the framework value in every case, so the merge is a no-op today. A future module-level class rule named after a component class that set one of the thirteen keys to a *different* value would silently fight the tiering. Mitigation: `grep -rn 'scope: *"class"' packages/lib/src` before adding one, and check the name against the hoist table above. `Glyph` and `Markdown` are not affected — their class rules use the `ts-ui-glyph-` / `ts-ui-md-` prefixes, so they never collide with `.Glyph` / `.Markdown`.
- **`Text.clearLineClamp` writes `overflow: null` to `#uuid`.** Removing the `overflow` shorthand clears its longhands from that rule, so afterwards the component's overflow comes from the framework or class rule (`hidden`) rather than from nothing until the next `applyStyle`. `hidden` is what the next `applyStyle` writes anyway, so the visible result is the same or more correct; no action needed.
- **`getCSSRule()` no longer returns a component's full effective style.** It returns the `#id` rule, which now holds only the deviations. It is `protected` and has no call site in the library (`grep -rn 'getCSSRule' packages/lib/src` finds only the definition), so nothing breaks; step 8's JSDoc edit is what keeps a future caller honest.
- **`clearWhiteSpace()` or `clearUserSelect()` would strand the framework value.** Both phases guard on truthiness of the private field, so a cleared field skips the write and leaves the framework rule's `nowrap` / `none` in force — where today the element would fall back to the CSS initial. Neither method has a call site (`grep -rn 'clearWhiteSpace(\|clearUserSelect(' packages/lib/src` finds only the definitions), and `setWhiteSpace` / `setUserSelect` are typed `string`. Recorded so that if either is ever wired up, it is given a real reset value (`"normal"` / `"auto"`) rather than left to fall through.
- **A class whose defaults vary per instance.** The four classes whose `subclassDefaults` depend on constructor arguments — `Panel` (`flush`), `Glyph` (`tag`), `SpinButton` (`glyph`), `AbstractMarkerList` (`itemStyle`) — vary in **no** hoisted key, so whichever variant renders first produces the same body. Any future instance-varying default touching `minSize`, `maxSize`, `overflow`, `visible`, or `displayed` would make the class rule reflect one variant; the other variant's instances would write those keys to `#uuid`, so correctness holds and only the saving is lost.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — `_styleRule` / `_inlineStyle` (405-406), `_defaultOptions` (452) and the base defaults bag (498-517), `destructor` (726-800) and `trackSelector` (828), `getCSSRule` (866), `setElementCSSRule` / `commitCSSRule` (1447-1482), `setId`'s rule re-point (1505), `getMinSizeConstraint` / `getMaxSizeConstraint` (2697-2712), `applyStyle` and its six phases (4336-4581), and `init`'s `addClass: [this.constructor.name]` (5354).
- [packages/lib/src/typescript/lib/core/StyleTarget.ts](packages/lib/src/typescript/lib/core/StyleTarget.ts) — `StyleTarget.set` (the queue-vs-write-through branch this plan relies on), `StyleRuleScope` (the `"class"` and `"selector"` shapes, both used here), the `StyleRule` constructor's `materialize` handling, `_ruleCache` / `_ruleFor` / `disposeStyleRule`, and the `@internal` `_ruleCacheHas` the tests use.
- [packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts:29-48](packages/lib/src/typescript/lib/component/table/cell/SortPriorityBadge.ts#L29) and [component/table/cell/ResizeHandle.ts:51-69](packages/lib/src/typescript/lib/component/table/cell/ResizeHandle.ts#L51) — **the precedent**: a module-level `StyleRule` scoped to the component's own class name, holding the declarations that never vary per instance. Read both before writing `ClassStyleRules.ts`.
- [packages/lib/src/typescript/lib/component/input/TextArea.ts:32-44](packages/lib/src/typescript/lib/component/input/TextArea.ts#L32), [component/container/LabeledFieldSet.ts:26-29](packages/lib/src/typescript/lib/component/container/LabeledFieldSet.ts#L26), and [core/AnimatedDropdown.ts:65](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts#L65) — the three shapes of class-tier deviation: an overridden constraint, a *cleared* constraint (`minSize: undefined`), and an overridden `visible`.
- [packages/lib/src/typescript/lib/component/input/ComboBox.ts:328-338](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L328) and [component/list/AbstractSelectableList.ts:212-224](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts#L212) — two more hand-written `.ClassName` rules a generated rule would share a `CSSStyleRule` with.
- [plans/per-class-component-defaults.md](per-class-component-defaults.md) — the prerequisite. Its `core/ComponentDefaults.ts` is what makes `_defaultOptions` a shared frozen per-class bag, and its constructor-keyed `Map` is the pattern `ClassStyleRules.ts` copies.
- [packages/lib/tests/dom/TestDOM.ts:383-395](packages/lib/tests/dom/TestDOM.ts#L383) — `RecordingDOMSink`'s `setRuleStyle` / `ensureStyleRule` / `deleteStyleRule` recording shapes, which the new tests read.
- [packages/lib/tests/component/Component.test.ts:1-20](packages/lib/tests/component/Component.test.ts#L1) — the harness preamble to copy.

---

## Non-Goals

- **The inline geometry channel.** `width` / `top` / `left` / `height` / `transform` are written through `_inlineStyle` and genuinely vary per instance; the existing geometry-inline / appearance-rule split is correct and stays.
- **Hoisting the conditional declarations** (`cursor`, `color`, `backgroundColor`, `backgroundImage`, `border`, `outline`, `borderRadius`, `boxShadow`, `padding`). A shared rule may only hold a key every instance writes on every render; these are all behind an `if`, and hoisting one would need a neutral reset value per property.
- **Batching the `StyleRule` flush** and **making `ensureStyleRule` O(1)**. Sibling plans own `core/StyleTarget.ts` and `core/DOM.ts`; this plan touches neither.
- **Making `_defaultOptions` per-class.** The prerequisite plan owns it.
- **Removing the per-instance `#uuid` rule for components that deviate in nothing.** [`plans/stylerule-batched-flush.md`](stylerule-batched-flush.md) owns that: it materialises the instance rule lazily, only when the dirty bag is non-empty, so a component with no deviations never inserts one. This plan is what makes that case common, but it allocates and tracks the `#uuid` selector exactly as today.
- **Bumping the package version.** The 0.3.0 target is recorded here; the bump happens at release.

---

## Notes

[^measurement]: From a profiling run of a 45-column × 400-row table demo, instrumented to record how many *distinct values* each declaration key took across all instances of a class in one window open. `Text`: 1,186 instances, 15 keys, 0 keys with more than one distinct value, 17,790 writes. `StringCell`: 384 / 20 / 0 / 7,680. `StringRenderer`: 474 / 15 / 0 / 7,110. `NumberCell`, `DateCell`, `BooleanCell`: 352 / 20 / 0 / 7,040 each. `Glyph`: 364 / 16 / 4 varying (`minWidth`, `minHeight`, `maxWidth`, `maxHeight`) / 5,812. `Component`: 719 / 21 / 11 varying / 12,903. The whole window issued 113,016 `StyleTarget.set` calls. The inline geometry channel took 14,651 writes over 16 keys of which 10 varied — correctly per-instance. Every write into the shared `<style id="Base">` sheet invalidates style for the whole document, so the build's next forced read pays a full-document recalc over ~7,000 elements and ~7,000 rules. These are ratios from a timing-inflated environment; no wall-clock speedup is promised.

[^selector-choice]: Three selector shapes were considered for the framework tier. `:where(.ts-ui-component)` was chosen because `:where()` forces the specificity of everything inside it to zero, so `.ClassName` (0,0,1,0) and `#id` (1,0,0,0) beat it by construction — the cascade result cannot change if rule insertion order changes. A plain `.ts-ui-component` was rejected: it ties with `.ClassName` at (0,0,1,0), so which one wins depends on document order in the sheet, and insertion order here is *render* order, which varies between apps and between runs. Ordering it deliberately — inserting the framework rule first, at module load — would work today but is a silent trap: `_ruleFor` appends through `DOM.sink.ensureStyleRule`, nothing enforces the position, and a later change to insertion would flip the result with no offline test able to see it. A compound `.ClassName.ts-ui-component` for the class tier (0,0,2,0) was rejected for the same reason in reverse: it fixes the tie only for the class tier, still leaves the framework rule tied with any consumer class rule, and doubles the selector text on every generated rule. Browser support is not a constraint — `:where()` shipped in Chrome 88, Firefox 78, and Safari 14, all older than the `:focus-visible` the library already depends on in [component/input/Link.ts:49](packages/lib/src/typescript/lib/component/input/Link.ts#L49) (Safari 15.4). The accepted cost is that a bare element selector in consumer CSS now outranks the framework rule; that is recorded in `## Potential Challenges`.

[^extra-class]: `ts-ui-component` is free: the library's own CSS class literals are the `ts-ui-glyph-*`, `ts-ui-md-*`, and `ts-ui-mde-*` families plus a handful of unprefixed state classes (`selected`, `focused`, `disabled`, `expanded`, `PickerDay`, `PickerNavButton`, `HeaderCellGlyph`), and `grep -rn 'ts-ui-component'` across the repo finds nothing. The `ts-ui-` prefix is the established convention for a library-owned class, so a consumer collision is as unlikely as for the existing families. Nothing in the library or its tests asserts an exact `className` string for a component's root element: the `addClass` assertions in the suite ([tests/component/display/Markdown.test.ts:57](packages/lib/tests/component/display/Markdown.test.ts#L57), [tests/component/container/AccordionIndicator.test.ts:92](packages/lib/tests/component/container/AccordionIndicator.test.ts#L92), [tests/dom/handle-registry.test.ts:46](packages/lib/tests/dom/handle-registry.test.ts#L46)) all use `includes` or target inner, non-`Component` elements. The one assertion sensitive to *op shape* rather than content is [tests/core/ElementAttributeReplay.test.ts:156](packages/lib/tests/core/ElementAttributeReplay.test.ts#L156), which finds the first `apply` carrying `addClass` — hence the instruction in step 4 to keep it a single call.

[^precedent]: Both files register their rule from an idempotent module-local `ensureXClassRule()` guarded by a module variable, exactly the shape ARCHITECTURE.md prescribes for a module-level shared class rule. This plan generalises that from two hand-written rules to one framework rule plus one rule per deviating component class, and keeps the same three properties: created once, module-scoped, never disposed. The alternative — giving each `Component` an extra per-instance `StyleRule` with a class selector — was rejected: it would allocate one buffer per component to write a body that is by definition identical, which is the cost the plan exists to remove.

[^ctor-key]: `ctor.name` is not unique in this tree, so a name-keyed registry would hand one class another's body. The constructor object is unique regardless of name, survives minification, and is the same key `core/ComponentDefaults.ts` uses in the prerequisite plan. `core/Callable.ts` forwards `[[Construct]]` through `Reflect.construct(target, args)`, so `instance.constructor` is the original class object for both `new Text(…)` and `Text(…)`. The *selector* still has to come from `ctor.name` — it must match the CSS class `init` applies — which is why the name collision is handled separately, by the opt-out branch.

[^derive-not-observe]: Deciding uniformity by observation — watch the values instances produce and hoist once they agree — was rejected. It is order-dependent in a way that affects correctness, not just savings: a rule seeded from an atypical first instance would hold a declaration that later instances must *remove* rather than override, and CSS has no per-property "unset back to absent" that reproduces the declaration never having been written. Deriving from the shared defaults bag sidesteps that entirely: both bodies are a pure function of state that is already class-scoped, and an instance that deviates only ever *adds* a higher-specificity declaration.

[^unconditional-rule]: The soundness argument for the thirteen keys, one branch at a time. `position` and `margin` are written unconditionally. `visibility` is written on both branches of its `if`. `display` is gated on `isDisplayed() != null`, and [`isDisplayed`](packages/lib/src/typescript/lib/core/Component.ts#L1758) returns a `boolean` sourced from `_options.displayed ?? _defaultOptions.displayed`, which the base defaults always populate and no subclass overrides. `boxSizing`, `whiteSpace`, and `userSelect` are gated on truthiness of private fields the constructor seeds to `"border-box"` / `"nowrap"` / `"none"`, and their setters are typed `string`. `minWidth` / `minHeight` and `maxWidth` / `maxHeight` are gated on `getMinSizeConstraint()` / `getMaxSizeConstraint()`, which read `_options.X ?? _defaultOptions.X`; the base defaults populate both, so clearing the option re-resolves the class default — **except** where a subclass default deliberately sets the key to `undefined`, which [`LabeledFieldSet`](packages/lib/src/typescript/lib/component/container/LabeledFieldSet.ts#L26) does for `minSize`. That is the one case where the phase writes nothing at all, and it is why `resolveDeclarations` maps an absent constraint to the value that reproduces "no declaration" (`auto` for min, `none` for max) instead of omitting the key. `overflowX` / `overflowY` are gated on non-null, and `getOverflowX` / `getOverflowY` fall back to `_defaultOptions.overflow`, which the base defaults set to `"hidden"`; the same absent-value mapping (`visible`) covers a future subclass that nulls it. Every other rule declaration in `applyStyle` is gated on a value that can legitimately be absent, which is why the list stops at thirteen.

[^derived-set]: The split was derived by reading every `_default…Options` bag in the library for the five fields a hoisted key depends on (`visible`, `displayed`, `minSize`, `maxSize`, `overflow`), plus the three constructor-seeded constants. `displayed` is set only in `Component`'s own base bag. `visible` only in `AnimatedDropdown`'s, and so in every dropdown that extends it. `minSize` in `TextArea`, `FieldSet`, and `LabeledFieldSet`. `maxSize` only in `AbstractSelectableList`, at `Number.MAX_SAFE_INTEGER` — which *is* `UNBOUNDED` ([primitive/Size.ts:18](packages/lib/src/typescript/lib/primitive/Size.ts#L18)) and therefore renders `none`, the same value the base bag produces, so it is not a deviation. `overflow` in `TextArea`, `Drawer`, and `ToolBar` only — the `overflow: "auto"` in `Markdown.ts` and the ones in `ComboBox.ts` / `AbstractSelectableList.ts` sit inside module-level `StyleRule` bodies, not defaults bags. `boxSizing`, `whiteSpace`, and `userSelect` appear in no defaults bag at all — every occurrence outside `Component`'s constructor is either a module-level `StyleRule` body or a per-instance setter call, and both of those land at or above the class tier. `position` likewise: `Component` seeds `Position.ABSOLUTE` for every class, and the classes that change it (`Legend` to `STATIC`; `Dialog`, `Popover`, `Drawer`, `Notification`, `Rail`, `DragGhost`, `DialogBackdrop`, and `AnimatedDropdown` to `FIXED`) all do so from the constructor *body*, which is a per-instance write and reaches `#uuid`. The consequence for the framework tier is the point: because those deviations are per-instance rather than per-class, they outrank a framework declaration exactly as they outrank nothing today, so putting `position` on the framework rule costs nothing and saves a repeat in every generated class rule.

[^empty-rule]: Skipping the empty rule is what makes the tiering pay: with the framework rule carrying `Component`'s own resolved defaults, the great majority of classes — including every one in the measurement above except `Glyph` — deviate in nothing and get no `.ClassName` rule, so the sheet gains one rule rather than one per class. It also mirrors what [`plans/stylerule-batched-flush.md`](stylerule-batched-flush.md) does one tier up, where an instance with an empty dirty bag never materialises its `#uuid` rule. Claiming the selector in `_owners` even when no rule is inserted is not optional: without it, a second class of the same name would not detect the collision, would insert its *own* `.Name` rule, and that rule would then apply to the first class's elements — which carry the same CSS class — with nothing on their `#uuid` rules to counteract it.

[^optout-bypasses-both]: This is the one place the third tier changes the opt-out's meaning. In a two-tier design an opted-out class could have skipped on the class bag and still been correct, because it had no class bag. With a framework tier, skipping on the framework value would be wrong: suppose class `A` claims `.Twin` with `min-width: 100px`, and class `B` — also named `Twin` — resolves the framework value `0px`. `B`'s elements carry the CSS class `Twin`, so `A`'s rule applies to them; if `B` skipped the write because `0px` matches the framework rule, `B` would render at `100px`. Returning `null` for the whole bag makes `writeRuleDeclaration` write all thirteen keys to `#uuid`, which outranks `.Twin`, so `B` renders correctly at the cost of the saving.

[^lifecycle]: Three teardown paths could reach a rule, and none reaches the framework rule or a class rule. `Component.destructor` calls `this._styleRule.dispose()` and disposes each entry of `_deferredStyleRules` — both are per-instance `StyleRule` objects this plan never touches. The `FinalizationRegistry` at [Component.ts:296](packages/lib/src/typescript/lib/core/Component.ts#L296) calls `disposeStyleRule(selector)` for each entry of `_ownedSelectors`, which is populated only by the private `trackSelector`, called from the `#id` rule creation sites (484, 1506) and `createStyleRule` (914). `StyleRule.dispose()` is a method on the instance, and the only `StyleRule`s bound to the framework selector or a class selector are the ones `ensureClassStyleRule` constructs and immediately drops — no reference survives for anything to call `dispose()` on. So both shared rules outlive every instance, which is what makes cases 13 and 14 in `## Expected Behaviour` pass: a new instance finds the registry entry, gets the same bag back, and skips the same declarations. Had a rule been torn down with the last instance, the next instance would still skip those declarations (the registry entry would be intact) and would render with none of them — an unstyled, statically-positioned component. The framework rule is more exposed to that failure than a class rule, because *every* component depends on it, which is why `_frameworkRuleCreated` is a plain module flag with no reset path.

[^duplicate-names]: `grep -rhoP '^(export )?(abstract )?class \K\w+'` over the library and `uniq -d` reports exactly two duplicated class names: `Body` and `Table`. Both `Body` declarations are `Component` subclasses — [core/Body.ts:21](packages/lib/src/typescript/lib/core/Body.ts#L21) (the page root) and [component/table/Body.ts:111](packages/lib/src/typescript/lib/component/table/Body.ts#L111) (the table's row host) — so they genuinely contend for `.Body`. `Table` is declared at `layout/Table.ts:40` (a `LayoutManager`, which owns no CSS class) and `component/table/Table.ts:74` (a `Component`), so only one of the two ever reaches `ensureClassStyleRule` and there is no contention. Note that the two `Body` classes already share the CSS class `Body` today — `init` applies `this.constructor.name` unconditionally — so the collision is pre-existing; this plan only has to avoid *acting* on it. Minification does not add a new failure mode for the same reason: the CSS class already comes from `constructor.name`, so the class tier inherits whatever guarantees `vite.config.ts`'s `keepNames` settings and `plans/minification-safe-class-names.md` provide, and the opt-out branch fails safe if two classes ever collapse onto one name. The framework tier is immune either way — `COMPONENT_CLASS` is a string literal.

---

## Implementation Notes

- **`writeRuleDeclaration` uses `this._styleRule.queue(`, not `.set(`.** The `## Internal Structure` code block predates knowing whether `stylerule-batched-flush` would land first; it had. Step 5 already anticipated this ("or `this._styleRule.queue(`, if the batched-flush plan has already landed") — `queue` is what every surrounding phase call already used, and it is the correct choice: `.set()` would write through immediately whenever `_styleRule` was already materialised from an earlier render, breaking the "one batched flush per `applyStyle` pass" invariant `StyleRuleBatchedFlush.test.ts` cases 6-7 depend on. Verified by the full suite passing, including those cases.

- **The new test file's `declarationsDuring` helper takes a `selector` parameter and filters `setRuleStyles` ops by `args[0]`,** rather than the plan's original signature (`declarationsDuring(sink, fn)`, no selector) that assumed an unbatched, selector-less op. This is exactly the adaptation `## Potential Challenges` calls for ("the recorded op becomes `setRuleStyles(selector, bag)` — then only the `declarationsDuring` helper ... changes, to flatten `args[1]` and filter on `args[0]`"), which had already landed by the time this plan was implemented. Filtering by selector is also load-bearing for case 2's assertion ("the setRuleStyle writes during the first render contain no position and no margin"): during a class's first render, the *framework* rule's own creation writes a batched op that legitimately does carry `position`/`margin` to `:where(.ts-ui-component)`; only filtering to the instance's own `#id` selector isolates what that render contributed to `#id` specifically.

- **Every test-local `Component` subclass in `ClassStyleRules.test.ts` has a name unique across the whole file** (`ProbeCase1`, `ProbeCase2`, …), not just unique per `it()` block. `core/ClassStyleRules.ts`'s `_owners` registry is keyed by `ctor.name` (a plain string) and, like `_ruleCache`, is module state that survives `DOM.reset()` and persists across every `it()`/`describe()` in one test *file* (Vitest isolates modules per file, not per test). Two `it()` blocks each declaring their own `class Probe extends Component {}` are two distinct constructors sharing the string `"Probe"` — the second one's `ensureClassStyleRule` call finds `"Probe"` already claimed by a different constructor and silently takes the name-collision opt-out branch (case 15's intentional behaviour), which is a real bug in a test, not in the implementation, but a subtle one worth flagging: the plan's own constraint ("every test declares its own uniquely-named local `Component` subclass") already says this, but "unique" means unique across the file, not merely a fresh class expression with a name reused from an earlier test.

- **Four pre-existing tests outside the plan's step-7 survey needed updates.** Step 7 predicted no failures in the "counted a render-time write of a hoisted key" or "asserted an exact element class list" categories, and none occurred there. A third, unanticipated category did: `tests/core/ComponentDispose.test.ts`, `tests/core/TextDispose.test.ts`, and `tests/overlay/AbstractWindow.styleRuleDisposal.test.ts` each assert "zero new `_ruleCacheKeys()` entries after dispose" as a leak regression guard. The new framework-wide rule is permanent, module-scoped state (by design — see `[^lifecycle]`), so whichever of these tests happens to run first in the whole suite legitimately observes `:where(.ts-ui-component)` appear as a "new" key relative to its `before` snapshot. Fixed by excluding that one selector from what each test counts as leaked, with a comment explaining why — the per-instance teardown guarantee these tests exist to enforce is otherwise untouched (confirmed: the only leaked key in every failure was the framework selector, never a `#uuid` rule). `tests/core/StyleRuleBatchedFlush.test.ts` case 6 needed the kind of fix step 7 did anticipate: it asserted `position`/`margin` on a bare `Component`'s own `#id` rule, now hoisted away; reassigned to `cursor`/`border`, which stay conditional and still land on `#id` for every component.

- **Typecheck baseline is 0 errors, not the plan's stated 7.** `## Verification` step 2 says "exactly the **7** known pre-existing errors, no more" — stale relative to this branch's actual base (`feature/per-class-component-defaults`), which typechecks clean. `npm run typecheck` and `npm run typecheck:test` both pass with 0 errors after this plan's changes, same as before them.
