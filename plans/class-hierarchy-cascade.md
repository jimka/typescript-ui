---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
  - ARCHITECTURE.md
  - packages/lib/docs/reference/changelog/next.md
---

# Class-Hierarchy CSS Cascade — Implementation Plan

## Overview

The class-tier CSS mechanism ([`ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts)) gives every concrete component class one shared `.ClassName` rule, computed once and reused by every instance of that exact class. It is flat: [`ensureClassStyleRule`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L222) keys its cache by the *concrete* constructor only, and [`classDeviations`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L187) diffs a class's resolved declarations against the single global `FRAMEWORK_DECLARATIONS` baseline — never against an ancestor class's own rule. [`Component.init()`](packages/lib/src/typescript/lib/core/Component.ts#L6069) matches this: `DOM.sink.apply(element, { addClass: [COMPONENT_CLASS, this.constructor.name] })` puts only the leaf class name on the rendered element, never an ancestor's.

The result: a class hierarchy with a shared ancestor gets no CSS sharing at all. A live-code survey of the whole `component/`, `overlay/`, and `container/` trees found nine hierarchies where a middle class declares hoistable defaults (`ClassStyleDefaults` fields — `backgroundColor`, `border`, `cursor`, `foregroundColor`, `outline`, `userSelect`, `shadow`, `minSize`, `maxSize`, `overflow`, or `Text`'s `font` group) that two or more concrete subclasses inherit unchanged and each re-declare on its own independent `.ClassName` rule. The two largest: [`Cell`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L30) (`foregroundColor`/`backgroundColor`/`border`), inherited untouched by 14 concrete cell classes across two hierarchy levels — 10 direct leaf subclasses (`StringCell`, `NumberCell`, `BooleanCell`, `DateCell`, `TimeCell`, `DateTimeCell`, `ComboCell`, `GlyphCell`, `DynamicCell`, `FilterCell`), an 11th direct subclass (`DefaultCell`) that is itself both concrete and a further middle class, and 3 more leaves through `DefaultCell` (`HeaderCell`, `ParentHeaderCell`, `GroupSeparatorCell`); and [`Text`](packages/lib/src/typescript/lib/component/input/Text.ts#L62) (`fontFamily`/`fontSize`/`fontStyle`/`fontWeight`/`textAlign`/`truncate`, plus the whole `font` sub-bag `Text.getClassStyleDefaults()` computes), inherited untouched by `Label` and `Legend` and touched only partially by `SelectableText`/`Link` (which each add their own `cursor`/`userSelect`, but keep every font field). Right now `.StringCell`, `.NumberCell`, `.BooleanCell`, …, and `.Label`, `.Legend`, `.SelectableText`, `.Link` each independently repeat their shared ancestor's declarations verbatim — the exact `.Button`/`.TabButton`/`.SpinButton` `cursor`/`color` duplication already found live, at hierarchy scale.

This plan makes the class tier hierarchy-aware: a class's `.ClassName` rule becomes a delta against its **immediate parent's** resolved declarations, not the framework tier directly, and the DOM element carries every ancestor's class name so the cascade can actually find those ancestor rules. It covers every hierarchy the survey found **except** `Button`/`ToggleButton`/`TabButton`/`SpinButton` — that chain also uses the state-tier mechanism (`.pressed`, `.selected`), and widening its DOM classes without also making the state tier hierarchy-aware creates a real cascade-ordering hazard (`## Architecture Decisions` covers why). That chain is `button-family-hierarchy-cascade.md`, a dependent follow-on plan.[^why-split]

---

## Architecture Decisions

### A class's own contribution is exposed via an own-property static field, not derived from a live instance

Computing "Button's declarations, independent of whatever ToggleButton/TabButton add" cannot be done by reading `this._defaultOptions` off a live instance: that field is the *fully merged* bag (`{...parent's _default*Options, ...subclassDefaults}`, forwarded positionally through `super()` at construction — see [`Component.ts:534-537`](packages/lib/src/typescript/lib/core/Component.ts#L534) and the `Cell` constructor's `{ ..._defaultCellOptions, ...(subclassDefaults ?? {}) }` at [`Cell.ts:67`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L67)), and a subclass instance's `_defaultOptions` reports the subclass's overridden value for any field the subclass changed — there is no way to ask a `TabButton` instance "what would `Button` alone have declared for this field."

Each opting-in class instead declares a `protected static readonly ownClassStyleDefaults: ClassStyleDefaults` field — the same object already sitting in the file as `_default<Name>Options`, exposed at the class level:

```typescript
class Cell<T> extends Component {
    protected static readonly ownClassStyleDefaults: ClassStyleDefaults = _defaultCellOptions;
    ...
}
```

`Component` declares no such field. The hierarchy walk reads it via `Object.prototype.hasOwnProperty.call(ctor, "ownClassStyleDefaults")` — an **own-property** check, not a plain `ctor.ownClassStyleDefaults` read. A plain read would silently return the *nearest ancestor's* field once any ancestor defines one (normal JS static-member inheritance), making every subclass that doesn't override it look like it declares its parent's fields all over again — exactly wrong for a delta computation. The own-property check is what lets "this class adds nothing new" mean `null`, not "same as parent."

This mirrors an already-accepted (drafted, not yet implemented) precedent in this exact codebase: [`minification-safe-class-names.md`](minification-safe-class-names.md) gives every component class a `static readonly className` field and reads it through the identical `hasOwnProperty` own-vs-inherited check, for the identical reason (a subclass that omits its own field must not silently report its parent's). That plan is unrelated in motivation (it exists to survive minification) and this plan does not depend on it, but its `getClassName()` design is direct, current-codebase evidence that "own-property-checked static field" is an accepted shape here, not a novel one invented for this plan alone.[^no-getprototypeof-precedent]

### `ensureClassStyleRule` becomes a recursive, memoized walk of `Object.getPrototypeOf`

A new function, `resolveClassLevel(ctor)`, replaces the flat body of `ensureClassStyleRule` for classes that participate.[^callable-preserves-chain] For `ctor`:

1. If already cached (`_levels: Map<Function, ResolvedClassLevel>`), return the cached result.
2. Resolve the parent level first: `Object.getPrototypeOf(ctor)`. If that is a function with a name, recurse into `resolveClassLevel` on it. Otherwise (reached past the top of the chain), the parent level is `{ defaults: {}, resolved: FRAMEWORK_DECLARATIONS }` — today's existing base case, untouched.
3. Read `ctor`'s own contribution via the own-property check above. If none, this level's `defaults`/`resolved` are identical to the parent's — no new rule, no new cache work beyond memoizing the pass-through.
4. If `ctor` has its own contribution, merge it onto the parent's `defaults` (`{ ...parent.defaults, ...own }` — a shallow merge, matching how `_default<Name>Options` bags already merge through `subclassDefaults` forwarding; a subclass that changes `border` or `font` replaces the whole sub-value, not a deep field-by-field merge), resolve it via the existing `resolveDeclarations`, and diff the result against the **parent's** resolved bag (not `FRAMEWORK_DECLARATIONS`) — the same `!==`-per-key diff `classDeviations` already does, parameterised on what to diff against instead of hardcoded to the framework bag.
5. If the diff is non-empty, create the `.ClassName` rule (unchanged `StyleRule({ scope: "class", name, styles: deviations })` shape) and cache/return the new resolved level.

Because the recursion always resolves (and therefore inserts) an ancestor's rule before a descendant's, **insertion order is ancestor-first for every class, regardless of which concrete class is constructed first in a running app** — even if the app never constructs a plain `Cell`, the first `StringCell` construction still resolves `Cell`'s level (and, if `Cell` has a deviation, inserts `.Cell`'s rule) before `StringCell`'s own rule, because step 2 always runs before step 4/5.

### Plain, unweighted class selectors are correct — no `:where()` between hierarchy levels

`.Cell`, `.DefaultCell`, `.HeaderCell` are all single-class selectors, specificity `(0,1,0)` each. Two facts make this the right shape, both already-established precedent rather than new reasoning:

- **Against `#id`**: any single id `(1,0,0)` outranks any number of chained classes, so a true per-instance override still always wins regardless of how many ancestor classes an element carries.
- **Against each other**: an ancestor's rule and a descendant's rule for the *same property* only compete when the descendant's own `ownClassStyleDefaults` genuinely overrides that property (the diff in step 4 above only emits a key when it differs) — and the recursive walk's ancestor-first insertion order (previous decision) resolves that tie deterministically in the descendant's favour, with no specificity trick needed.

This is the exact reasoning [`hoist-button-tabbar-state-chrome-rules.md`](plans/implemented/hoist-button-tabbar-state-chrome-rules.md)'s "No `:where()` on the new class-tier rules" decision already used for the *state* tier (`.Button.pressed` vs `.Button`): "The new state-tier rules have no lower tier beneath them to protect — the only relationship that matters is class-tier vs. instance-tier... A plain `.ClassName<suffix>` selector is correct." The framework tier's own `:where()` wrap is a different case — it protects against a consumer's *own* stylesheet needing zero effort to override framework defaults, not against ordering between two framework-internal tiers — and this plan does not touch it.

Worked case, for a `StringCell` (deviates from `Cell` on nothing) and a `HeaderCell` (deviates from `Cell` via `DefaultCell`, which itself deviates on nothing):

| Rules that match a rendered `HeaderCell` element and declare `background-color` | Specificity | Insertion order | Winner |
|---|---|---|---|
| `:where(.ts-ui-component)` (framework) | `(0,0,0)` | always first | — |
| `.Cell` | `(0,1,0)` | before `.DefaultCell`/`.HeaderCell`, regardless of which `Cell` subclass renders first | wins over the framework tier |
| `.DefaultCell` | *(no rule — `DefaultCell` adds no deviation of its own)* | — | — |
| `.HeaderCell` | *(no rule, if `HeaderCell` also adds none — the survey confirms it doesn't)* | — | `.Cell` supplies the value |
| `#c17` (this instance's own id) | `(1,0,0)` | whenever this instance renders | wins over everything above, only if this instance's own `backgroundColor` deviates |

### The DOM class list widens to every ancestor's own name, computed once per constructor

`Component.init()`'s `addClass` call changes from `[COMPONENT_CLASS, this.constructor.name]` to `[COMPONENT_CLASS, ...getStyleClassChain(this.constructor)]`, where `getStyleClassChain` walks the same `Object.getPrototypeOf` chain `resolveClassLevel` does, collecting every level's `ctor.name` in ancestor-to-descendant order, memoized in a `Map<Function, readonly string[]>` (computed once per constructor, not per instance). A rendered `StringCell` element carries `ts-ui-component Cell StringCell`; a rendered `HeaderCell` carries `ts-ui-component Cell DefaultCell HeaderCell`.

This widening is **unconditional** — every component gets its full ancestor chain on the element, whether or not any ancestor in that chain has an `ownClassStyleDefaults` registration. A class with no registered ancestor still gets today's exact behaviour (no rule exists for the added ancestor classes to match, so they are inert), but the class list itself is uniform and simple to reason about rather than conditional on which classes happen to have opted in.

### This is a breaking change for consumer CSS that targets a framework class name expecting only that literal class

A third-party stylesheet rule like `.Button { border: 2px solid blue; }`, written to target *literal* `Button` instances, will — once `Button` participates in a future phase (`button-family-hierarchy-cascade.md`) — also match every `ToggleButton`/`TabButton`/`SpinButton`, which did not carry the `Button` class before. This plan's own chains (`Cell`, `Text`, `TextInput`, …) carry the identical risk for any consumer selector targeting `.Cell`, `.Text`, etc. This is real and must be called out prominently in the changelog as a breaking behavioural change to selector matching, not just a specificity note like the prior hoisting plans' changelog entries — see `## Documentation Impact`.[^breaking-change-precedent]

### Rollout is scoped to the confirmed-safe chains; `Button`/`ToggleButton`/`TabButton`/`SpinButton` is a separate, dependent plan

Every chain in `## Files to Create / Modify / Delete` below has **no state-tier (`createStateStyleRule`/`ensureClassStateRule`) rule anywhere in its hierarchy**. `Button`/`ToggleButton`/`TabButton` does: `.Button.pressed`, `.ToggleButton.selected:not(:hover)`, and (potentially) `.TabButton`-specific overrides are each independently keyed by the *leaf* constructor via [`ensureClassStateRule`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L289) — unrelated to each other today, because a `TabButton` element carries no `Button`/`ToggleButton` class for `.Button.pressed` to match. Once this plan's DOM-widening lands for that chain, a `TabButton` element would carry `Button` *and* `ToggleButton` *and* `TabButton`, so **all three independently-created `.pressed`-family rules would start matching the same element simultaneously**, with the winner decided by insertion order between two rules whose relationship the state tier does not currently reason about at all (`ensureClassStateRule` has no concept of "delta versus parent," unlike this plan's `resolveClassLevel`). That is a real correctness hazard, not merely a missed optimisation, so `Button`/`ToggleButton`/`TabButton`/`SpinButton` is deliberately excluded from this plan's DOM-widening and left to `button-family-hierarchy-cascade.md`, which extends both tiers together.[^why-split]

---

## Public API

Every new/changed member is `protected`, `private`, or module-internal (`ClassStyleRules.ts` stays out of `core/index.ts`, matching every existing member in that file). `excludeProtected: true` keeps all of it out of the generated API docs.

```typescript
// core/ClassStyleRules.ts

/**
 * A class's own, subclass-independent contribution to the hoistable style
 * defaults — the same shape as `ClassStyleDefaults`, but declared once per
 * class (not resolved per instance). A class that adds no hoistable default
 * of its own declares no field at all; `Component` declares none.
 *
 * Read only via an own-property check (`Object.prototype.hasOwnProperty`) —
 * never via a plain property read, which would report an inherited value
 * from whichever ancestor last declared the field. See
 * `class-hierarchy-cascade.md`'s Architecture Decisions.
 */
// (declared per-class as `protected static readonly ownClassStyleDefaults: ClassStyleDefaults`,
//  not itself an exported symbol — this is a field-shape convention, not a type export.)
```

```typescript
// core/Component.ts — no new public/protected instance members. `getClassStyleDefaults()`,
// `matchesClassStyle`, `reconcileRuleDeclaration`, `setReconciledCSSRules`, `_inheritedStyleBag`
// are all unchanged — they still compare an instance's runtime writes against ITS OWN class's
// fully-resolved bag, which resolveClassLevel's accumulated `defaults`/`resolved` at the leaf
// level continues to supply via the existing `ensureClassStyleRule(this.constructor, ...)` call
// site, now delegating to the hierarchy-aware resolution.
```

No consumer-facing signature changes anywhere.

---

## Internal Structure

### `core/ClassStyleRules.ts` — the hierarchy-aware resolver

Replaces `ensureClassStyleRule`'s body; the exported signature is unchanged, so `Component.applyStyle`'s call site (`ensureClassStyleRule(this.constructor, this.getClassStyleDefaults())`) needs no edit.

```typescript
interface ResolvedClassLevel {
    /** This class's fully-merged `ClassStyleDefaults` — its own contribution
     *  layered onto every ancestor's, in the same shape `resolveDeclarations`
     *  consumes. */
    defaults: ClassStyleDefaults;
    /** `resolveDeclarations(defaults)` — this class's full resolved CSS bag,
     *  used both to diff the next level down and, at the leaf, as the
     *  instance-comparison bag `_inheritedStyleBag` needs. */
    resolved: ClassStyleBag;
}

const _levels: Map<Function, ResolvedClassLevel> = new Map();

/** Own-property read of a class's `ownClassStyleDefaults` field — `null` when
 *  this exact class doesn't declare one, regardless of what an ancestor
 *  declares. See Architecture Decisions for why a plain property read is
 *  wrong here. */
function ownDefaultsOf(ctor: Function): ClassStyleDefaults | null {
    return Object.prototype.hasOwnProperty.call(ctor, "ownClassStyleDefaults")
        ? (ctor as unknown as { ownClassStyleDefaults: ClassStyleDefaults }).ownClassStyleDefaults
        : null;
}

/** Shallow merge — a subclass that redeclares `border` or `font` replaces
 *  the whole sub-value, matching how `_default<Name>Options` bags already
 *  merge through `subclassDefaults` object-spread forwarding. */
function mergeClassStyleDefaults(parent: ClassStyleDefaults, child: ClassStyleDefaults): ClassStyleDefaults {
    return { ...parent, ...child };
}

/** The subset of `resolved` that differs from `against` — `classDeviations`,
 *  generalised to diff against any resolved bag, not only the framework one. */
function deviationsFrom(resolved: ClassStyleBag, against: ClassStyleBag): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const key of Object.keys(resolved)) {
        if (resolved[key] !== against[key]) {
            out[key] = resolved[key];
        }
    }
    return out;
}

/**
 * Hierarchy-aware replacement for the old flat body of `ensureClassStyleRule`.
 * Walks `Object.getPrototypeOf(ctor)` upward, resolving (and, for a class
 * that owns a genuine deviation, inserting) each ancestor's `.ClassName`
 * rule before this class's own — see Architecture Decisions for why that
 * ordering is what makes plain, unweighted class selectors correct with no
 * `:where()` needed between levels.
 */
function resolveClassLevel(ctor: Function): ResolvedClassLevel {
    const cached = _levels.get(ctor);
    if (cached) {
        return cached;
    }

    const parentCtor = Object.getPrototypeOf(ctor) as Function | null;
    const parent = (typeof parentCtor === "function" && parentCtor.name)
        ? resolveClassLevel(parentCtor)
        : { defaults: {} as ClassStyleDefaults, resolved: FRAMEWORK_DECLARATIONS };

    const own = ownDefaultsOf(ctor);
    if (!own) {
        const level = { defaults: parent.defaults, resolved: parent.resolved };
        _levels.set(ctor, level);
        return level;
    }

    ensureFrameworkStyleRule();

    const name  = ctor.name;
    const owner = _owners.get(name);
    if (!name || (owner !== undefined && owner !== ctor)) {
        const level = { defaults: parent.defaults, resolved: parent.resolved };
        _levels.set(ctor, level);
        return level;
    }

    const defaults   = mergeClassStyleDefaults(parent.defaults, own);
    const resolved   = resolveDeclarations(defaults);
    const deviations = deviationsFrom(resolved, parent.resolved);

    _owners.set(name, ctor);
    if (Object.keys(deviations).length > 0) {
        new StyleRule({ scope: "class", name, styles: deviations });
    }

    const level = Object.freeze({ defaults, resolved: Object.freeze(resolved) });
    _levels.set(ctor, level);
    return level;
}

export function ensureClassStyleRule(
    ctor: Function,
    defaults: ClassStyleDefaults,
): ClassStyleBag | null {
    // `defaults` here is the caller's own fully-merged `getClassStyleDefaults()`
    // result (unchanged contract — see Component.ts). The leaf's own resolved
    // bag comes from resolveClassLevel(ctor) when ctor participates (has an
    // ownClassStyleDefaults chain); a class with no participation anywhere in
    // its chain falls through to today's flat framework-diff behaviour using
    // the caller-supplied `defaults` directly, so a class that opts nothing
    // in still gets exactly today's rule.
    ...
}
```

The final `ensureClassStyleRule` body has one more piece of nuance the snippet above elides: `getClassStyleDefaults()` (the *instance*-derived, fully-merged bag `Component.applyStyle` already passes in) and `resolveClassLevel(ctor).defaults` (the *class*-derived, ancestor-accumulated bag) must agree for a participating class, or the leaf-level rule and the instance's own runtime-write comparisons (`matchesClassStyle`, reading `_inheritedStyleBag`) would disagree about what the class "really" declares. They agree by construction for every field currently registered via `_default<Name>Options`/`subclassDefaults`, because that is the same data both paths read — `getClassStyleDefaults()`'s default body is `return this._defaultOptions;` ([`Component.ts:4903-4905`](packages/lib/src/typescript/lib/core/Component.ts#L4903)), which is the same merged bag `resolveClassLevel`'s accumulation reproduces one level at a time. `ensureClassStyleRule`'s final `_inheritedStyleBag` return value should therefore be `resolveClassLevel(ctor).resolved` when `ctor` participates (verified equal to `resolveDeclarations(defaults)` on the caller-supplied bag by the invariant above), falling back to today's flat `classDeviations(defaults)`-against-`FRAMEWORK_DECLARATIONS` computation when it doesn't. **Confirming this equivalence for every already-registered field, and writing the exact final merge logic, is the one piece of this plan's Internal Structure to treat as a sketch, not a final body** — `/implement` must derive the precise final function from this description and verify it against `## Expected Behaviour`'s cases, because this is a genuinely new mechanism with no mechanical precedent to copy verbatim, unlike the nine prior plans in this lineage.

### `core/ClassStyleRules.ts` — the widened DOM class chain

```typescript
const _classChains: Map<Function, readonly string[]> = new Map();

/**
 * Every ancestor's own class name, from the topmost participating-or-not
 * ancestor down to `ctor` itself — the full list `Component.init()` adds to
 * the element. Memoized per constructor; independent of `ownClassStyleDefaults`
 * registration, so every component gets its full chain regardless of which
 * ancestors, if any, have opted into hierarchy-aware hoisting.
 */
export function getStyleClassChain(ctor: Function): readonly string[] {
    const cached = _classChains.get(ctor);
    if (cached) {
        return cached;
    }

    const parentCtor = Object.getPrototypeOf(ctor) as Function | null;
    const parentChain = (typeof parentCtor === "function" && parentCtor.name)
        ? getStyleClassChain(parentCtor)
        : [];

    const chain = ctor.name ? Object.freeze([...parentChain, ctor.name]) : parentChain;
    _classChains.set(ctor, chain);
    return chain;
}
```

### `core/Component.ts` — `init()`'s `addClass` call

```typescript
// Before:
DOM.sink.apply(element, { addClass: [COMPONENT_CLASS, this.constructor.name] });

// After:
DOM.sink.apply(element, { addClass: [COMPONENT_CLASS, ...getStyleClassChain(this.constructor)] });
```

### Opting in each confirmed-safe chain

Each class below gains one field, placed beside its existing `_default<Name>Options` constant, assigning that same constant (or the `ClassStyleDefaults`-relevant subset of it, when the class's options bag carries fields outside `ClassStyleDefaults` too — passing the whole bag is fine, since `resolveDeclarations` only reads keys it recognises). No behavioural change to the constant itself.

| Class | File | Own field value |
|---|---|---|
| `Cell` | [`component/table/cell/Cell.ts`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts) | `_defaultCellOptions` |
| `Text` | [`component/input/Text.ts`](packages/lib/src/typescript/lib/component/input/Text.ts) | `_defaultTextOptions` |
| `TextInput` | [`component/input/TextInput.ts`](packages/lib/src/typescript/lib/component/input/TextInput.ts) | `_defaultTextInputOptions` |
| `AbstractPickerField` | [`component/input/AbstractPickerField.ts`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts) | `_defaultPickerFieldOptions` |
| `AbstractSelectableList` | [`component/list/AbstractSelectableList.ts`](packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts) | its existing defaults bag |
| `AbstractWindow` | [`overlay/AbstractWindow.ts`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts) | `_defaultWindowOptions` |
| `AbstractChart` | [`component/chart/AbstractChart.ts`](packages/lib/src/typescript/lib/component/chart/AbstractChart.ts) | its existing defaults bag |
| `AnimatedDropdown` | [`core/AnimatedDropdown.ts`](packages/lib/src/typescript/lib/core/AnimatedDropdown.ts) | its existing defaults bag |

`Text.getClassStyleDefaults()`'s override (the `font` sub-bag, [`Text.ts:1391`](packages/lib/src/typescript/lib/component/input/Text.ts#L1391)) is a *second*, independent contribution mechanism from the flat, always-called instance override — it is unaffected by this plan and keeps working exactly as it does today (`super.getClassStyleDefaults()` still resolves to `Component`'s base body, `this._defaultOptions`, unchanged); the new `ownClassStyleDefaults` field only needs to carry `Text`'s *non-font* hoistable fields (`cursor`, `userSelect`, `foregroundColor`, if any — confirm against `_defaultTextOptions`'s actual contents at implementation time), since the font group already flows correctly through the untouched instance-level path.

`DefaultCell` needs its own empty-or-absent field (it adds nothing beyond `Cell`, confirmed by the survey), so it needs **no** field at all — the own-property check naturally treats it as "contributes nothing new," and `HeaderCell`/`ParentHeaderCell`/`GroupSeparatorCell` (which extend `DefaultCell`) correctly walk past it to `Cell`'s level.

---

## Ordered Implementation Steps

1. **Write the mechanism tests first.** Create `packages/lib/tests/core/ClassHierarchyCascade.test.ts` covering `## Expected Behaviour` rows 1-9, using locally-declared `Component` subclasses forming a real multi-level chain (e.g. `class ProbeBase extends Component`, `class ProbeMid extends ProbeBase`, `class ProbeLeaf extends ProbeMid`), each uniquely named across the whole test suite (per `ClassStyleRules.test.ts`'s existing convention). Copy `declarationsDuring`/`idSelector`/`_ruleCacheHas` from that file.
   *Check:* `npx vitest run tests/core/ClassHierarchyCascade.test.ts` — every case fails for the expected reason (no hierarchy awareness exists yet).

2. **`core/ClassStyleRules.ts` — add `resolveClassLevel`, `ownDefaultsOf`, `mergeClassStyleDefaults`, `deviationsFrom`, `_levels`.** Per `## Internal Structure`. Do not yet change `ensureClassStyleRule`'s exported body.
   *Check:* `npm run typecheck`.

3. **`core/ClassStyleRules.ts` — rewrite `ensureClassStyleRule` to delegate to `resolveClassLevel`.** Resolve the exact final shape per the "one more piece of nuance" paragraph in `## Internal Structure` — the leaf's returned bag must equal `resolveClassLevel(ctor).resolved` for a participating class and today's flat `classDeviations`-against-framework result for a non-participating one. Keep `classDeviations` itself (still used by any caller that needs a framework-only diff, if one exists after the search in this step) or delete it if `resolveClassLevel`'s `deviationsFrom` fully supersedes it — confirm via `grep -rn 'classDeviations' packages/lib/src` before deleting.
   *Check:* `npm run typecheck`; `npx vitest run tests/core/ClassHierarchyCascade.test.ts` — green; `npx vitest run tests/core/ClassStyleRules.test.ts` — still green, unmodified (no probe in that file declares an `ownClassStyleDefaults` field, so every case behaves exactly as before).

4. **`core/ClassStyleRules.ts` — add `getStyleClassChain` and `_classChains`.** Per `## Internal Structure`.
   *Check:* `npm run typecheck`.

5. **`core/Component.ts` — widen `init()`'s `addClass` call.** Change the line at [`Component.ts:6069`](packages/lib/src/typescript/lib/core/Component.ts#L6069) per `## Internal Structure`. Add `getStyleClassChain` to the existing `~/core/ClassStyleRules.js` import.
   *Check:* `npm run typecheck`; `npx vitest run tests/core/ClassHierarchyCascade.test.ts` — the DOM-class-chain rows now pass too.

6. **Opt in each class in the `## Internal Structure` table**, one file at a time, adding the `protected static readonly ownClassStyleDefaults: ClassStyleDefaults = _default<Name>Options;` field beside the existing constant. Import `ClassStyleDefaults` (type-only) from `~/core/ClassStyleRules.js` in each file that doesn't already import it.
   *Check after each file:* `npm run typecheck`; `npx vitest run` the file's own existing test file — unmodified, still green (this step changes only which tier a declaration lives on, never a resolved value).

7. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`. Any pre-existing test asserting on a specific `#id`-scoped declaration for one of `## Internal Structure`'s eight classes (or their concrete subclasses) that now dedupes onto an ancestor's shared rule needs the same kind of update `reconciled-write-path-widening.md`'s Implementation Notes catalogued for its own migration (`toBeUndefined()`/literal-value assertions become `toBeNull()`/removal assertions, or move to asserting on the ancestor's `.ClassName` selector instead of the leaf's). `grep -rln "backgroundColor\|foregroundColor\|border" packages/lib/tests/component/table/cell/ packages/lib/tests/component/input/Text.test.ts packages/lib/tests/component/input/Link.test.ts packages/lib/tests/component/input/Label.test.ts` is a starting point for which files to check first.

8. **`ARCHITECTURE.md`.** Extend the *Component CSS tiers and state-rule dedup* section (added by [`state-chrome-isolation-generalization.md`](plans/implemented/state-chrome-isolation-generalization.md)) per `## Documentation Impact`'s first bullet.
   *Check:* none beyond a read-through — this file has no build step of its own.

9. **Add the changelog entry.** See `## Documentation Impact`'s second bullet — this one names the breaking selector-matching change explicitly, not just a specificity caveat.

10. **Verify live in a browser.** Non-negotiable — see `## Verification`. Every plan in the sibling lineage this plan extends shipped at least one regression the offline suite missed; this plan introduces a wholly new mechanism with no mechanical precedent, so the risk is at least as high.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/core/ClassHierarchyCascade.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TextInput.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/list/AbstractSelectableList.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/AbstractWindow.ts` |
| Modify | `packages/lib/src/typescript/lib/component/chart/AbstractChart.ts` |
| Modify | `packages/lib/src/typescript/lib/core/AnimatedDropdown.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-9 are unit-testable against a synthetic multi-level `Component` chain (the recording sink records every `setRuleStyles`/`addClass` call). Rows 10-12 are cascade/appearance outcomes that need a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | `ProbeBase` declares `ownClassStyleDefaults = { cursor: "pointer" }`; `ProbeMid`/`ProbeLeaf` declare none | `.ProbeBase` carries `cursor: pointer`; no `.ProbeMid`/`.ProbeLeaf` rule is inserted at all (nothing to add beyond the parent) |
| 2 | Same chain, a rendered `ProbeLeaf` element | Carries classes `ts-ui-component ProbeBase ProbeLeaf` — `ProbeMid`'s own name is still present too (`ts-ui-component ProbeBase ProbeMid ProbeLeaf`), since the DOM widening is unconditional regardless of registration |
| 3 | `ProbeMid` additionally declares `ownClassStyleDefaults = { cursor: "text" }` | `.ProbeMid` is inserted, carrying only `cursor: text` (the deviation from `ProbeBase`'s `pointer`) — not `foregroundColor` or any other field `ProbeBase` might also declare unchanged |
| 4 | Same setup as row 3 (`ProbeMid` also declares its own `ownClassStyleDefaults`); insertion order inspected via the recording sink's op sequence | `.ProbeBase`'s `ensureStyleRule` op is recorded before `.ProbeMid`'s, regardless of whether a `ProbeBase` instance is ever separately constructed |
| 5 | A class with no `ownClassStyleDefaults` anywhere in its chain (e.g. a bare `class Probe extends Component {}`) | Behaves identically to today: a flat `.Probe` rule diffed against `FRAMEWORK_DECLARATIONS` only |
| 6 | A rendered `ProbeLeaf` instance's runtime `setCursor("default")` call, where `default` matches `FRAMEWORK_DECLARATIONS.cursor` but *not* `ProbeMid`'s `"text"` | Writes a real (non-removed) `cursor: default` to `#id` — the instance-level comparison (`matchesClassStyle`, `_inheritedStyleBag`) still compares against the leaf's own fully-resolved value, unaffected by which tier declares which piece of it |
| 7 | Two classes named identically (the existing `_owners` name-collision opt-out) where the second is a hierarchy participant | The second's `ownClassStyleDefaults` contribution is never applied to any shared rule — its instances write every hoistable declaration to their own `#id`, exactly like today's flat name-collision behaviour |
| 8 | A three-level chain `A → B → C` where only `A` and `C` register `ownClassStyleDefaults` (`B` registers none) | `.A` and `.C` both exist; `.C`'s deviation is computed against `A`'s resolved bag (not `B`'s, since `B` contributes nothing) |
| 9 | `getStyleClassChain` called twice for the same constructor | Second call returns the identical cached array reference (no repeated `Object.getPrototypeOf` walk) |
| 10 | Demo app: `#/tables`, a `StringCell`/`NumberCell`/`HeaderCell` mix | Each cell's resting background/border/text colour is visually identical to before this plan |
| 11 | Demo app: `#/inputs`, a `Label`, `Legend`, `Link`, and `SelectableText` in the same view | Font family/size/weight/alignment identical to before; `Link`'s custom cursor/colour and `SelectableText`'s custom cursor/select-ability still differ correctly from plain `Label`/`Legend` |
| 12 | DevTools Style Audit panel (`#/style-audit`) on a table-containing tab, and on `#/inputs` | Total stylesheet size drops; `.Cell`/`.Text` (or their concrete equivalents) show up as shared rules matching multiple elements when inspected via `document.getElementById('Base').sheet.cssRules` |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

**Manual browser verification (rows 10-12) is required.** The offline harness records writes; it does not run a CSS cascade, and this plan is a wholly new mechanism with no mechanical precedent in this lineage to lean on.

- Start a dev server on a spare port from *this worktree*, not the user's existing server.
- Exercise `#/tables`, `#/inputs`, and `#/style-audit`.
- Read **computed styles**, not screenshots, for every class in `## Internal Structure`'s opt-in table and at least two of its concrete subclasses each.

---

## Documentation Impact

No exported symbol changes. One `ARCHITECTURE.md` addition and one changelog entry:

- Extend the *Component CSS tiers and state-rule dedup* section (added by [`state-chrome-isolation-generalization.md`](plans/implemented/state-chrome-isolation-generalization.md)) with a short paragraph: the class tier is hierarchy-aware — a subclass's `.ClassName` rule declares only its own deviation from its nearest ancestor's rule, and the rendered element carries every ancestor's class name so the cascade can find them, in ancestor-inserted-first order.
- `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Core`, a **prominent, separately-worded** entry (not folded into the existing hoisting bullets, because the consequence is different in kind): rendered elements for `Cell` and its built-in subclasses, `Text` and its built-in subclasses (`Label`, `Legend`, `Link`, `SelectableText`), `TextInput` and its subclasses, `AbstractPickerField`'s date/time field subclasses, `List`/`MultiSelectList`, `Window`/`TabWindow`, chart components, and the `AnimatedDropdown` family now additionally carry every ancestor class's name (e.g. a `StringCell` carries `Cell` too). **A consumer stylesheet selector that targets one of these ancestor class names (`.Cell { ... }`, `.Text { ... }`) — previously matching nothing, since no framework element ever carried a bare ancestor's class name — now matches every concrete subclass instance too.** Audit any such selector before upgrading.

---

## Potential Challenges

- **A pre-existing test asserts on a specific `#id`-scoped declaration that now dedupes onto an ancestor's shared rule.** Mitigated by step 7's sweep; the failure mode and fix shape are identical to `reconciled-write-path-widening.md`'s own migration.
- **A class's `_default<Name>Options` bag carries a field this plan's `ownClassStyleDefaults` typing doesn't structurally accept** (a field absent from `ClassStyleDefaults`, e.g. `TextInputOptions`-specific fields not in the hoistable set). Not a defect: `resolveDeclarations` already ignores any key it doesn't recognise, and TypeScript's structural typing already allows a `Partial<XOptions>` value with extra fields to satisfy a `ClassStyleDefaults`-typed field (the exact same tolerance `getClassStyleDefaults()`'s existing `return this._defaultOptions;` body already relies on).
- **`AnimatedDropdown`'s hierarchy is shared with `AbstractCalendarDropdown → DatePickerDropdown`/`DateTimePickerDropdown` — a four-level chain.** `resolveClassLevel`'s recursion is depth-general (no hardcoded level count), so this needs no special handling, but it is the deepest chain this plan exercises and is worth exercising explicitly in row 8's style test shape (three-plus levels, not just two).
- **A class opted in here is later subclassed by application code outside this repo**, inheriting the ancestor's shared rule automatically via the same mechanism, with no consumer action needed — this is a feature, not a risk, but worth confirming in the browser pass (row 10/11) with at least one deeply-nested built-in subclass, since it is the scenario the whole mechanism exists to serve.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | The mechanism being rewritten: `ensureClassStyleRule` (222), `classDeviations` (187), `resolveDeclarations` (127), `FRAMEWORK_DECLARATIONS` (84), `_bags`/`_owners` (105/108) |
| `packages/lib/src/typescript/lib/core/Component.ts` | `init()`'s `addClass` (6069), `getClassStyleDefaults()` (4903), `applyStyle`'s `ensureClassStyleRule` call (4930), `matchesClassStyle`/`_inheritedStyleBag` (4754, 459) — confirms the instance-comparison path is unaffected |
| `packages/lib/src/typescript/lib/component/input/Text.ts` | `getClassStyleDefaults()` override (1391) — the one existing precedent for a class contributing beyond `_defaultOptions`, and the class this plan's opt-in table must not disturb |
| `minification-safe-class-names.md` | The direct, current-codebase precedent for an own-property-checked `static readonly` identity field — cited in Architecture Decisions; not a dependency, but read it before designing `ownClassStyleDefaults`'s exact shape |
| `plans/implemented/hoist-button-tabbar-state-chrome-rules.md` | Its "No `:where()` on the new class-tier rules" decision is the precedent this plan's own equivalent decision cites |
| `plans/implemented/component-chrome-base-tier-hoisting.md`, `plans/implemented/reconciled-write-path-widening.md` | The flat mechanism this plan generalizes, and the precedent for how a pre-existing test needs updating once a value moves tiers |
| `button-family-hierarchy-cascade.md` | The dependent follow-on plan that finishes the survey's highest-value chain, deferred here specifically because of the state-tier collision hazard `## Architecture Decisions` documents |
| `packages/lib/tests/core/ClassStyleRules.test.ts` | Test conventions this plan's new test file mirrors, and the regression file that must stay green unmodified |

---

## Non-Goals

- **`Button`/`ToggleButton`/`TabButton`/`SpinButton`.** Needs the state tier made hierarchy-aware too; see `button-family-hierarchy-cascade.md`.
- **The two "inverse gap" cases the survey found** (`CellRenderer`'s seven leaves independently declaring identical `cursor`/`userSelect`; `AbstractBooleanInput`'s three leaves independently declaring identical `outline`) — these need a *new* class-level default added to a class that currently has none, which is a data decision about what that class should declare, not a mechanism gap this plan closes. Once this plan's mechanism ships, giving `CellRenderer`/`AbstractBooleanInput` their own `ownClassStyleDefaults` is a small, independent follow-up with no new mechanism required.
- **`Container`, `Panel`, `FieldSet`, `MenuRow`, and the other chains the survey found with no middle-class hoistable default.** The mechanism applies to them automatically the moment any of them (or a future new class) registers one; nothing in this plan needs to change for that to work.
- **Deep-merging `font` or `border` across levels.** A subclass's own field replaces its parent's whole sub-value, matching existing `subclassDefaults` merge semantics; no chain in this plan's scope needs a deeper merge.
- **`minification-safe-class-names.md`.** Cited as design precedent only; not implemented or depended on by this plan. If it lands later, `ensureClassStyleRule`/`getStyleClassChain`'s `ctor.name` reads would need the same follow-up migration to `getClassName()` that every other `ctor.name` site in the library would need — tracked there, not here.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^why-split]: The split mirrors this codebase's own precedent for the *original* (non-hierarchy) resting/state tier work: `component-chrome-base-tier-hoisting` built the general base-tier mechanism first; `hoist-button-tabbar-state-chrome-rules`, `button-resting-chrome-state-isolation`, and `state-chrome-isolation-generalization` then did the harder, Button-family-specific state/resting interaction as later, dependent plans — precisely because Button-family is where the state tier's specificity hazards live, and getting that right needed the general mechanism to exist first. This plan is that same "general mechanism first" step, one level up (hierarchy instead of state); `button-family-hierarchy-cascade.md` is the dependent, harder-case follow-on, matching that established shape rather than inventing a new one.

[^no-getprototypeof-precedent]: A codebase-wide search for `Object.getPrototypeOf` (`grep -rn "getPrototypeOf" packages/lib/src/typescript/lib`) found four hits, none in `core/Component.ts` or `core/ClassStyleRules.ts`: one unrelated plain-object check in `data/ModelRecord.ts`, and three identical-shaped `Object.getPrototypeOf(this) === X.prototype` leaf-identity guards (`Button.ts`, `MenuButton.ts`, `PopupButton.ts`) that answer "is this instance exactly class X," not "walk my ancestors." There is no existing ancestor-chain-walking precedent in the style system; this plan's `resolveClassLevel`/`getStyleClassChain` are the first. The `static readonly className` + `hasOwnProperty` shape from `minification-safe-class-names.md` is the closest available precedent for the *static-field* half of the design, even though that plan never walks the chain itself (each class's `className` is read directly off its own constructor, never off an ancestor's).

[^callable-preserves-chain]: `Object.getPrototypeOf` on a `callable()`-wrapped constructor correctly reflects the real `extends` chain — ARCHITECTURE.md's *Components are exported through `callable()`* section states this directly: "the callable preserves the prototype chain, so `class Foo extends Panel` works correctly." This plan's hierarchy walk relies on exactly that guarantee and needs no special-casing for the callable wrapper.

[^breaking-change-precedent]: Every prior plan in this lineage (`component-chrome-base-tier-hoisting`, `hoist-button-tabbar-state-chrome-rules`, `button-resting-chrome-state-isolation`, `state-chrome-isolation-generalization`) already documents a "consumer stylesheet targeting a component by class now ties with the generated rule" caveat in its changelog entry. This plan's version of that caveat is qualitatively larger: those prior entries describe a *specificity tie* a consumer selector might now lose where it previously always won; this plan's DOM-class widening describes a consumer selector that previously **matched nothing on this element** now matching it, which can silently apply styling a consumer never intended for a class they didn't know an element carried. The changelog entry in `## Documentation Impact` is written as its own, separately-worded bullet for this reason, not folded into the existing hoisting-bullet pattern.
