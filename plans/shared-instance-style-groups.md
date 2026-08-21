---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Shared Instance Style Groups — Implementation Plan

## Overview

The class-tier mechanism ([`ensureClassStyleRule`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L222)) shares a CSS rule across every instance of a concrete class that keeps the class's *default* style. There is no mechanism today for many instances of the *same* class, all constructed with the *same explicit, non-default* style, to share a rule with each other — each writes its own `#id` rule, even when a caller creates fifty `Button`s with `{ backgroundColor: "var(--brand-warning)" }` at fifty different call sites. The only existing way to share a non-default style across instances is a dedicated subclass — the shape [`checkbox-radio-delegate-static-style-defaults.md`](plans/implemented/checkbox-radio-delegate-static-style-defaults.md) and [`checkbox-radio-delegate-state-style-defaults.md`](plans/implemented/checkbox-radio-delegate-state-style-defaults.md) used for `CheckboxBox`/`RadioButtonRing` — which is the right tool when the styling is a genuine, permanent identity for that shape of component, but is disproportionate for a caller who just wants several *plain* `Button`s in one screen to look the same without hand-writing a subclass for it.

This plan adds an explicit, opt-in `styleGroup` option. Instances of the same concrete class constructed with the same `styleGroup` token share one generated `.ClassName--<token>` rule, computed once from the first instance's resolved style and compared against by every later instance in the same group — mirroring how the state tier already shares one rule per `(class, suffix)` pair, except keyed by `(class, caller-supplied token)` instead of a suffix the framework itself defines.

This plan is independent of [`class-hierarchy-cascade.md`](class-hierarchy-cascade.md) and [`button-family-hierarchy-cascade.md`](button-family-hierarchy-cascade.md) — it shares no design dependency with either (it never walks a prototype chain; it keys purely on the concrete class plus a caller-supplied string) — but touches the same two core files, so implementing it concurrently with either in a separate worktree risks a textual merge conflict.

---

## Architecture Decisions

### Open question, flagged rather than silently decided: an explicit token, not a content-addressed cache

Two shapes were investigated for "identically-configured instances share a rule automatically":

- **A content-addressed cache**, keyed by a canonicalized serialization of each instance's resolved hoistable declarations. A caller writes nothing extra — `new Button({ backgroundColor: "red" })` at fifty call sites would, on its own, produce one shared rule, with zero new option to learn.
- **An explicit `styleGroup` token**, a caller-supplied string. Two instances share a rule only when they are both the same concrete class *and* were given the same token — the caller states the intent to share, rather than the framework inferring it from coincidentally-equal values.

**No precedent in this codebase points to either shape specifically** — this investigation found no existing hashing/canonicalization utility, and no existing "declare a token, share a resource keyed on it" convention, to follow either way. This plan recommends the token, for four concrete reasons, but the choice is deliberately surfaced here rather than treated as settled, because it changes the public option surface every component gets and is worth confirming before implementation starts:

1. **Debuggability.** A content-addressed rule's selector is necessarily a hash or a serialized-value fragment — meaningless in DevTools and in the Style Audit panel's `component` column. A token-keyed rule's selector is `.Button--warning`, immediately legible.
2. **No silent cross-call-site coupling.** Under content-addressing, two call sites that happen to pass the identical options bag *by coincidence* (not by design) start sharing a rule — a later, unrelated edit to one call site's colour literal silently detaches it from the other's rule with no signal anywhere. Under the token, sharing is a decision the caller made explicitly and can see by reading either call site's options bag.
3. **Canonicalization is not free and this codebase's chrome fields are not all primitives.** `border` accepts `BorderOptions | string`; `minSize`/`maxSize` are `{width, height}` objects. A stable content-addressed key needs a canonical serialization of all of these (property order, `BorderOptions` normalization to `borderToStyle`'s four-longhand form before hashing, or after) — solvable, but it is new machinery this plan would have to build and get right, for a benefit (zero-syntax sharing) the token gives up but the canonicalization risk does not.
4. **Matches this codebase's own construction convention.** `CODE_CONVENTIONS.md`'s *Construction* rule and the `Construct via options bag` precedent both favour explicit, typed configuration over inference; `getRestingExclusionSuffixes()`, `ownClassStyleDefaults` (this plan's sibling plans), and every state-tier suffix in the codebase are all caller/author-declared strings, never derived from content.

If the content-addressed shape is preferred instead, `## Internal Structure` below still mostly applies — `ensureStyleGroupRule` would be keyed by a computed hash instead of a literal token, and `styleGroup` would become internal (auto-computed at first render) rather than a public option — but the hashing/canonicalization design is not attempted here and would need its own investigation.[^content-addressed-not-attempted]

### `styleGroup` is a new optional field on `ComponentOptions`, alongside every other typed option

```typescript
export interface ComponentOptions {
    ...
    styleGroup?: string;
}
```

Per `CODE_CONVENTIONS.md`'s *All attributes and styles go through typed setters* rules, it gets `setStyleGroup(group: string | null): this` / `getStyleGroup(): string | null`, dispatched from `applyOptions` like every other option. `styleGroup` is set-once-effective-at-render in practice (see the next decision) but still needs the typed setter/getter pair and `XOptions` field for construction-time configuration, matching every other Component option.

### The group's shared declarations are the first group member's own *resolved* hoistable style — computed once, at that instance's first render

`ensureStyleGroupRule(ctor, group, declarations)` is a new sibling of [`ensureClassStateRule`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L289), reusing its exact shape: keyed by `(ctor, group)` in a `Map<Function, Map<string, ClassStyleBag | null>>`, cached on first call. `declarations` is the caller's own `resolveDeclarations(this.getClassStyleDefaults-shaped instance bag)` result — computed from **`this._options` folded over `this._defaultOptions`**, restricted to the same `ClassStyleDefaults`-eligible keys the class tier already resolves (`backgroundColor`, `border`, `cursor`, `foregroundColor`, `outline`, `userSelect`, `shadow`, `minSize`, `maxSize`, `overflow`, and `Text`'s `font` group where applicable) — i.e. what this *specific instance* would render, not the class's plain default. The first `Button` constructed with `{ backgroundColor: "warning-token", styleGroup: "warning" }` in a given process determines `.Button--warning`'s content; every later `Button` with the same `styleGroup` compares its own resolved values against that cached bag.

A second instance in the same group whose *other* options genuinely differ (e.g. a different `border`) still writes that deviation to its own `#id` rule — the group only removes the properties that actually match, exactly like every other tier in this codebase's three-tier system.

### `matchesClassStyle` gains a group-tier check, layered above the class tier

`Component` gains a parallel field, `_styleGroupBag: ClassStyleBag | null`, resolved at the same point in `applyStyle` that resolves `_inheritedStyleBag` — immediately after it, only when `getStyleGroup()` returns non-null:

```typescript
// Before:
protected matchesClassStyle(key: string, value: string | null): boolean {
    return this._inheritedStyleBag !== null && this._inheritedStyleBag[key] === value;
}

// After:
protected matchesClassStyle(key: string, value: string | null): boolean {
    if (this._styleGroupBag !== null && this._styleGroupBag[key] === value) {
        return true;
    }
    return this._inheritedStyleBag !== null && this._inheritedStyleBag[key] === value;
}
```

Every existing caller of `matchesClassStyle`/`reconcileRuleDeclaration`/`setReconciledCSSRules`/`writeRuleDeclaration` needs no change — the group check is transparent, additive, and `_styleGroupBag` is `null` (short-circuiting to today's exact behaviour) for every instance that never sets `styleGroup`.

### The group rule's selector is a second, additional DOM class — `ClassName--<group>` — not a compound `.ClassName.group`

Using a *second class token* (`Button--warning`) rather than chaining `.Button.warning` keeps the group's specificity identical to the plain class tier's `(0,1,0)` — a single class selector — so ordering between `.Button` and `.Button--warning` is decided by insertion order alone, and `ensureStyleGroupRule` is always called *after* `ensureClassStyleRule` within the same `applyStyle` pass, guaranteeing `.Button--warning` inserts after `.Button` and therefore wins ties correctly. A compound `.Button.warning` selector would work too (higher specificity, `(0,2,0)`, unconditionally beating `.Button`) but was rejected: `.warning` alone, as a bare class token, risks colliding with an unrelated framework or consumer class of the same literal name, where `Button--warning` — the double-dash BEM-style separator — is distinctive and namespaced to the group's owning class by construction.[^bem-separator] The token is sanitized to a safe CSS class fragment the same way a component id already is — via `DOM.source.escapeSelector` at the selector-construction site, not at storage.

| Rules that match a grouped `Button` instance and declare `background-color` | Specificity | Insertion order (within one `applyStyle` pass) | Winner |
|---|---|---|---|
| `.Button` (class tier) | `(0,1,0)` | resolved first, since `ensureClassStyleRule` runs before `ensureStyleGroupRule` in `applyStyle` | loses the tie |
| `.Button--warning` (group tier) | `(0,1,0)` | resolved second | wins the tie |
| `#c17` (this instance's own id, only if it deviates from the group) | `(1,0,0)` | whenever this instance renders | wins over both, when present |

### Group membership is orthogonal to, and layered below, `#id` instance specialization

A real per-instance deviation still belongs on `#id`, and nothing here changes that: an instance whose own value differs from its group's cached bag writes to `#id` exactly as it would with no group at all, at specificity `(1,0,0)`, unconditionally outranking the group's `(0,1,0)`.

### Out of scope: state-tier groups, and hierarchy interaction

A `styleGroup` customizes only the *resting* tier (the same properties `ensureClassStyleRule` already hoists) — not `.pressed`/`.selected`/any `createStateStyleRule` suffix. This mirrors how the resting-tier mechanism itself shipped first, with state-tier dedup following as later, separate plans (`component-chrome-base-tier-hoisting` before `hoist-button-tabbar-state-chrome-rules`) — the same phasing precedent, applied here as an explicit initial scope boundary rather than a discovered gap. If `class-hierarchy-cascade.md` has also landed, a class that already carries ancestor classes via `getStyleClassChain` gains no special interaction with its own group: the group's rule is still keyed by the concrete class alone (never an ancestor), so `.TabButton--warning` and a hypothetical `.Button--warning` are unrelated rules, exactly as `.TabButton` and `.Button` are unrelated to a `styleGroup` neither uses.

---

## Public API

```typescript
// core/Component.ts
export interface ComponentOptions {
    ...
    styleGroup?: string;
}

setStyleGroup(group: string | null): this;
getStyleGroup(): string | null;
```

```typescript
// core/ClassStyleRules.ts — new export, not added to core/index.ts (module stays internal,
// matching every other export in this file).

/**
 * Ensures a shared `.ClassName--<group>` rule exists carrying `declarations`
 * — the first instance in this `(ctor, group)` pair to call this function
 * determines the shared content; every later instance compares against it.
 * Mirrors `ensureClassStateRule`'s cache shape, keyed by a caller-supplied
 * token instead of a framework-defined state suffix.
 */
export function ensureStyleGroupRule(
    ctor: Function,
    group: string,
    declarations: Record<string, string | null>,
): ClassStyleBag | null;
```

---

## Internal Structure

### `core/ClassStyleRules.ts` — `ensureStyleGroupRule`

Placed after `ensureClassStateRule`, reusing the module's `_owners` registry — a group's selector (`ClassName--group`) is a distinct string from the plain class name, so it needs its **own** collision entry in `_owners`, not the bare class name's:

```typescript
const _groupBags: Map<Function, Map<string, ClassStyleBag | null>> = new Map();

export function ensureStyleGroupRule(
    ctor: Function,
    group: string,
    declarations: Record<string, string | null>,
): ClassStyleBag | null {
    let byGroup = _groupBags.get(ctor);
    if (!byGroup) {
        byGroup = new Map();
        _groupBags.set(ctor, byGroup);
    }

    const existing = byGroup.get(group);
    if (existing !== undefined) {
        return existing;
    }

    const className = ctor.name;
    if (!className) {
        byGroup.set(group, null);
        return null;
    }

    const selectorName = className + "--" + group;
    const owner = _owners.get(selectorName);
    if (owner !== undefined && owner !== ctor) {
        byGroup.set(group, null);
        return null;
    }

    _owners.set(selectorName, ctor);
    if (Object.keys(declarations).length > 0) {
        new StyleRule({ scope: "class", name: selectorName, styles: declarations });
    }

    const bag = Object.freeze({ ...declarations });
    byGroup.set(group, bag);
    return bag;
}
```

### `core/Component.ts` — resolving `_styleGroupBag` in `applyStyle`

```typescript
// Immediately after the existing `_inheritedStyleBag = ensureClassStyleRule(...)` line:
const group = this.getStyleGroup();
this._styleGroupBag = group
    ? ensureStyleGroupRule(this.constructor, group, resolveInstanceStyleDeclarations(this))
    : null;
```

`resolveInstanceStyleDeclarations(component)` is a small new helper reusing [`resolveDeclarations`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L127) with an instance-derived `ClassStyleDefaults`-shaped bag (`this._options` folded over `this._defaultOptions` for each hoistable key — the same fold every individual getter, e.g. `getBackgroundColor()`, already performs one field at a time) rather than the class-only `getClassStyleDefaults()` bag. The exact field-by-field fold is a small, mechanical assembly from the existing per-field getters (`getBackgroundColor()`, `getBorder()`, `getCursor()`, `getForegroundColor()`, `getOutline()`, `getUserSelect()`, `getShadow()`, `getMinSizeConstraint()`, `getMaxSizeConstraint()`, `getOverflow()`) — `/implement` should build it from those getters directly rather than duplicating their fold logic.

### `core/Component.ts` — `init()`'s `addClass`, extended

```typescript
const groupClass = this.getStyleGroup() ? [this.constructor.name + "--" + this.getStyleGroup()] : [];
DOM.sink.apply(element, { addClass: [COMPONENT_CLASS, this.constructor.name, ...groupClass] });
```

(If `class-hierarchy-cascade.md` has landed first, this becomes `[COMPONENT_CLASS, ...getStyleClassChain(this.constructor), ...groupClass]` — the two changes are additive and don't conflict; `## Ordered Implementation Steps` below assumes `class-hierarchy-cascade.md` has not necessarily landed, and calls out the merge point explicitly.)

---

## Ordered Implementation Steps

1. **Confirm the token-vs-content-addressed decision** (see `## Architecture Decisions`) before starting — this plan implements the token shape throughout; if the content-addressed shape is chosen instead, stop and re-scope rather than mixing the two.

2. **Write the tests first.** Create `packages/lib/tests/core/StyleGroupRules.test.ts` covering `## Expected Behaviour` rows 1-7, following `ClassStateRules.test.ts`'s conventions (unique probe class names, `declarationsDuring`/`idSelector`/`_ruleCacheHas` copied from `ClassChromeRules.test.ts`).
   *Check:* `npx vitest run tests/core/StyleGroupRules.test.ts` — every case fails for the expected reason.

3. **`core/Component.ts` — add the `styleGroup` option, setter, getter.** Add `styleGroup?: string;` to `ComponentOptions` (near the end of the interface, [`Component.ts:123`](packages/lib/src/typescript/lib/core/Component.ts#L123) onward). Add `setStyleGroup`/`getStyleGroup` beside the other simple string setters, and dispatch `setStyleGroup` from `applyOptions` when `options.styleGroup !== undefined`. The backing field needs `declare` per `CODE_CONVENTIONS.md`'s *Fields written during the `super()` cascade* rule, since `applyOptions` runs inside `super()`.
   *Check:* `npm run typecheck`.

4. **`core/ClassStyleRules.ts` — add `ensureStyleGroupRule` and `_groupBags`.** Per `## Internal Structure`.
   *Check:* `npm run typecheck`.

5. **`core/Component.ts` — add `_styleGroupBag`, resolve it in `applyStyle`, extend `matchesClassStyle`.** Per `## Internal Structure`. Add `resolveInstanceStyleDeclarations` as a private helper reading the per-field getters listed in `## Internal Structure`.
   *Check:* `npm run typecheck`; `npx vitest run tests/core/StyleGroupRules.test.ts` — green; `npx vitest run tests/core/ClassStyleRules.test.ts tests/core/ClassChromeRules.test.ts` — still green, unmodified (every case in those files leaves `styleGroup` unset, so `_styleGroupBag` stays `null` and `matchesClassStyle` falls through to its existing check).

6. **`core/Component.ts` — extend `init()`'s `addClass` call.** Per `## Internal Structure`'s merge-point note — if `class-hierarchy-cascade.md` has already landed on this branch, add the group class onto its widened call; otherwise add it onto the pre-widening call and let a future rebase reconcile the two.
   *Check:* `npm run typecheck`.

7. **Add the changelog entry.** See `## Documentation Impact`.

8. **Full verification.** See `## Verification`.

9. **Verify live in a browser.** Non-negotiable — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/core/StyleGroupRules.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-7 are unit-testable against the recording DOM sink. Rows 8-9 need a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | `new Button({ backgroundColor: 'red', styleGroup: 'warning' })`, then a second identical construction | The second instance's `#id` rule carries no `backgroundColor`; `.Button--warning` exists carrying `backgroundColor: 'red'` |
| 2 | A third instance, same group, `{ backgroundColor: 'blue', styleGroup: 'warning' }` (a genuine deviation from the group) | `blue` is written to that instance's own `#id` rule, not `.Button--warning`, which still carries `red` |
| 3 | Two `Button`s, same `styleGroup` token, but one additionally sets `border` while the other doesn't | The `border` deviation is written to the deviating instance's own `#id`; the shared group rule carries only the properties both instances agree on (in practice, whatever the *first* instance resolved to, per the group's own comparison semantics — the second instance's `border` never matched the group in the first place, since the group was seeded before it existed) |
| 4 | Two different concrete classes (`Button`, `TextField`) using the identical `styleGroup` token `'warning'` | Two independent rules, `.Button--warning` and `.TextField--warning` — no collision, since the group key is `(ctor, group)`, not `group` alone |
| 5 | An instance with no `styleGroup` set | Behaves identically to today — no `_styleGroupBag`, no extra DOM class, `matchesClassStyle` falls through to the class-tier check only |
| 6 | An instance's `styleGroup` value collides with an unrelated class's own concrete name plus `"--" + group` (contrived, e.g. a class literally named `"Button--warning"`) | The name-collision opt-out applies exactly as it does for the base and state tiers — the second claimant writes every declaration to its own `#id` |
| 7 | `#id`-level runtime `setBackgroundColor('red')` on an instance whose group already delivers `red` for that key, called *after* first render | Writes a removal (via the existing `reconcileRuleDeclaration`/`setReconciledCSSRules` clear-on-match path — unaffected by this plan except that `matchesClassStyle` now also checks the group bag first) |
| 8 | Demo app: several `Button`s sharing one `styleGroup`, several not | Grouped buttons render identically to their explicit options; ungrouped buttons unaffected |
| 9 | Style Audit panel, before/after grouping several previously-ungrouped, identically-styled instances | Reported duplicate-body bytes for that group drop |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

**Manual browser verification (rows 8-9) is required.** Start a dev server on a spare port from *this worktree*. Exercise a screen with several manually-grouped instances and confirm appearance and the Style Audit panel's reported savings.

---

## Documentation Impact

`styleGroup`/`setStyleGroup`/`getStyleGroup` are new public API — `ComponentOptions` is exported and every `Component` gains these members, so:

- `packages/lib/docs/reference/changelog/next.md`, under `## Added` (a new option, not a behavioural change to an existing one): a `styleGroup` option lets several instances of the same concrete class share one generated CSS rule instead of each carrying its own — for callers who want many identically-configured instances to share bytes without writing a dedicated subclass. Instances with different `styleGroup` values, or none, are unaffected.
- Check whether `docs/concepts/` has a page covering the existing hoisting mechanism (per `state-chrome-isolation-generalization.md`'s `ARCHITECTURE.md` section) and add a short cross-reference if so; this plan does not itself add a new `docs/concepts/` page, since the mechanism is small enough to cover in the `ComponentOptions.styleGroup` JSDoc alone.
- Run `npm run docs:api` — zero warnings.

---

## Potential Challenges

- **A caller reuses a `styleGroup` token across genuinely different intended styles by mistake.** The group's content is whatever the *first* instance resolved to; a later instance with a different intent but the same token silently gets treated as a deviation from that first instance's values, writing its own `#id` override rather than raising any error. This is not a new failure mode this codebase doesn't already have elsewhere (a typo in `getRestingExclusionSuffixes()`'s chained suffix list has the same class of silent-cascade-mismatch risk) but is worth a clear JSDoc warning on `styleGroup` itself.
- **Group rule content depends on construction order, which can vary between app runs** (module load order, conditional rendering) if two call sites pass *different* option values under the same token. If both call sites are meant to be identical, this is harmless (either resolves the same content); if they are not, this is case 2/3's "the deviating instance's own value always wins on `#id`" behaviour, which is correct but means the *shared* group rule's exact content is not something a reader can predict from source alone without knowing render order. Document this in the `styleGroup` JSDoc.
- **The new group check inside `matchesClassStyle` runs on every hoisted-property write, for every component, including the vast majority that never set `styleGroup`.** The added cost is one extra `!== null` check before the existing comparison — negligible, and `_styleGroupBag` is `null` for every non-grouped instance, so the branch never reaches the group bag lookup in the common case.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `ensureClassStateRule` (289) — the direct structural precedent `ensureStyleGroupRule` mirrors; `resolveDeclarations` (127) — reused unchanged for the group's own declaration resolution |
| `packages/lib/src/typescript/lib/core/Component.ts` | `matchesClassStyle` (4754), `applyStyle`'s `_inheritedStyleBag` resolution (4930), `init()`'s `addClass` (6069), `ComponentOptions` (123) — every site this plan extends |
| `plans/implemented/checkbox-radio-delegate-static-style-defaults.md` | The precedent for "many instances share a non-default style" via a dedicated subclass — read to understand why this plan's token mechanism is for the *non-subclass* case specifically, not a replacement for that pattern |
| `plans/implemented/hoist-button-tabbar-state-chrome-rules.md` | `ensureClassStateRule`'s own design (caller-supplied suffix, `Map<Function, Map<string, Bag|null>>` cache shape) — the closest existing precedent this plan's `ensureStyleGroupRule` copies structurally |
| `CODE_CONVENTIONS.md` | *Construction* rule and the *Construct via options bag* convention — cited in `## Architecture Decisions`' recommendation for the token shape over content-addressing |

---

## Non-Goals

- **The content-addressed alternative.** Investigated and documented as the rejected-for-now default in `## Architecture Decisions`; not built here. A future plan could add it as an *additional*, internal-only mode (auto-deriving a group key when `styleGroup` is omitted) without disturbing this plan's explicit-token mechanism, if the canonicalization design is worked out separately.
- **State-tier groups** (a `styleGroup` affecting `.pressed`/`.selected`). Scoped out — see `## Architecture Decisions`.
- **Any interaction with `class-hierarchy-cascade.md`/`button-family-hierarchy-cascade.md` beyond the additive `addClass` merge point noted in `## Internal Structure`.** The group mechanism is keyed purely on the concrete class, never an ancestor; nothing about hierarchy-aware hoisting changes what a group rule contains.
- **Validating or restricting the `styleGroup` string's characters.** Treated the same way a component id already is — escaped at the selector-construction site (`DOM.source.escapeSelector`), not restricted at the API surface.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^content-addressed-not-attempted]: The four reasons in `## Architecture Decisions` are why this plan recommends the token, not a claim that content-addressing is unworkable — `SortPriorityBadge`'s and `ResizeHandle`'s hand-rolled `ensureXClassRule()` module-singleton pattern (cited in `checkbox-radio-delegate-static-style-defaults.md`'s own `[^option-b-rejected]` footnote) shows this codebase is comfortable with one-off module-level shared-rule builders when a case specifically calls for it; a future content-addressed mode could follow that same shape, keyed by a canonicalized hash instead of a literal string, as an additive mode alongside (not replacing) the token this plan ships.

[^bem-separator]: No existing generated class name in this codebase uses `--` today (`ctor.name` is always a bare identifier; state suffixes are always dot- or colon-prefixed pseudo-class-shaped strings, never a second bare class token) — the separator is new to this plan, chosen for readability and collision-avoidance, not copied from an existing in-repo convention. `_owners`' collision check (`## Internal Structure`) is what actually prevents a same-named clash regardless of separator choice; the separator is a legibility decision, not the safety mechanism.
