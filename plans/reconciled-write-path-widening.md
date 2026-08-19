---
depends-on: [component-chrome-base-tier-hoisting]
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
---

# Reconciled Write-Path Widening — Implementation Plan

## Overview

`component-chrome-base-tier-hoisting` gave four chrome properties (`backgroundColor`, `backgroundImage`, `boxShadow`, `border`) a clear-on-match runtime write path: `Component.matchesClassStyle()` ([core/Component.ts:4746](packages/lib/src/typescript/lib/core/Component.ts#L4746)) compares a value against the class's own shared CSS, and `reconcileRuleDeclaration()` / `setReconciledCSSRules()` ([core/Component.ts:4780](packages/lib/src/typescript/lib/core/Component.ts#L4780), [:4790](packages/lib/src/typescript/lib/core/Component.ts#L4790)) write a **removal** instead of a redundant real value when it matches, so the shared `.ClassName` (or framework) rule supplies it instead. `ClassStyleRules.ts`'s `resolveDeclarations()` ([core/ClassStyleRules.ts:127](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L127)) already computes this comparison value for a much wider set of properties — `foregroundColor`, `outline`, `userSelect`, `minSize`/`maxSize`, `overflow`, `cursor`, plus the four already-migrated chrome keys and a `font` group for `Text`. Six of those properties have **runtime setters** that never adopted the clear-on-match path — seven setters in total, since `overflow` splits into an X and a Y axis: `setForegroundColor()` ([:2315](packages/lib/src/typescript/lib/core/Component.ts#L2315)), `setOutline()` ([:2607](packages/lib/src/typescript/lib/core/Component.ts#L2607)), `setUserSelect()` ([:4679](packages/lib/src/typescript/lib/core/Component.ts#L4679)), `setMinSize()` ([:3007](packages/lib/src/typescript/lib/core/Component.ts#L3007)), `setMaxSize()` ([:3048](packages/lib/src/typescript/lib/core/Component.ts#L3048)), `setOverflowX()` ([:4033](packages/lib/src/typescript/lib/core/Component.ts#L4033)), and `setOverflowY()` ([:4078](packages/lib/src/typescript/lib/core/Component.ts#L4078)) all still call the old, unconditional `setElementCSSRule(s)` primitive.

This plan routes those seven setters through `setReconciledCSSRules()`, exactly mirroring how the four chrome setters already do it. It also migrates the nine matching render-phase writes — inside `applyBoxAndVisibilityStyles()`, `applySizeConstraintStyles()`, `applyOverflowStyles()`, `applyChromeStyles()`, and `applyMiscInlineStyles()` ([core/Component.ts:4858](packages/lib/src/typescript/lib/core/Component.ts#L4858)-[5080](packages/lib/src/typescript/lib/core/Component.ts#L5080)) — from the skip-based `writeRuleDeclaration()` to the clear-on-match `reconcileRuleDeclaration()`, for the same reason `component-chrome-base-tier-hoisting` migrated the chrome group's render phases: a value queued by a setter before the class-tier bag exists must be corrected, not left stale, once the bag resolves. `ClassStyleRules.ts` is untouched — every comparison value this plan needs already exists there.

---

## Architecture Decisions

### `reconcileRuleDeclaration` / `setReconciledCSSRules` need no widening — only their caller set does

Both methods already take an arbitrary `key` (or a `Style` bag of keys) with no hardcoded list of "chrome" properties — `matchesClassStyle(key, value)` looks `key` up in `this._inheritedStyleBag`, which `resolveDeclarations()` already populates for all six properties this plan covers. The four-property "chrome group" was never a constraint built into these two methods; it was simply the complete set of *callers* that routed through them. Widening the covered properties is entirely a change to *which setters and render-phase lines call these methods* — their own bodies do not change.[^precedent-generic]

### Route the seven setters through `setReconciledCSSRules`

Each setter's write line changes from the unconditional primitive to the reconciled one, one key (or two, for the batched pair) at a time:

| Setter | Old write | New write |
|---|---|---|
| `setForegroundColor` | `this.setElementCSSRule("color", foregroundColor)` | `this.setReconciledCSSRules({ color: foregroundColor })` |
| `setOutline` | `this.setElementCSSRule("outline", outline)` | `this.setReconciledCSSRules({ outline })` |
| `setUserSelect` | `this.setElementCSSRule("userSelect", value)` | `this.setReconciledCSSRules({ userSelect: value })` |
| `setOverflowX` | `this.setElementCSSRule("overflowX", value)` | `this.setReconciledCSSRules({ overflowX: value })` |
| `setOverflowY` | `this.setElementCSSRule("overflowY", value)` | `this.setReconciledCSSRules({ overflowY: value })` |
| `setMinSize` | `this.setElementCSSRules({ minWidth, minHeight })` | `this.setReconciledCSSRules({ minWidth, minHeight })` |
| `setMaxSize` | `this.setElementCSSRules({ maxWidth, maxHeight })` | `this.setReconciledCSSRules({ maxWidth, maxHeight })` |

No subclass overrides any of these seven methods anywhere in the library — `Component` is their sole definition — so no second call site needs the same change.[^no-overrides]

### `setMinSize` / `setMaxSize`'s two-key batch needs no special handling

`setBorder` / `clearBorder` already pass a four-key bag (`borderToStyle(this._border)`) straight to `setReconciledCSSRules` ([core/Component.ts:2390](packages/lib/src/typescript/lib/core/Component.ts#L2390), [:2415](packages/lib/src/typescript/lib/core/Component.ts#L2415)), and `setReconciledCSSRules`'s own body resolves each key of its input bag independently before flushing the whole resolved bag in one `setElementCSSRules` call. `minWidth`/`minHeight` and `maxWidth`/`maxHeight` follow the identical shape, one tier down in key count. A worked case, for a class whose `_defaultOptions.minSize` is `{ width: 0, height: 10 }`:

| `setMinSize` call | `minWidth` resolves to | `minHeight` resolves to | What reaches `#id` |
|---|---|---|---|
| `{ width: 0, height: 10 }` | `"0px"` (matches class default) | `"10px"` (matches class default) | Both keys **removed** |
| `{ width: 0, height: 20 }` | `"0px"` (matches) | `"20px"` (does not match) | `minWidth` removed, `minHeight: 20px` written for real |

### The motivating example fully collapses for `maxSize`, only partly for `minSize`

`TabBar.clampWrapperMain()` ([component/container/TabBar.ts:1941](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1941), called from e.g. [:2151](packages/lib/src/typescript/lib/component/container/TabBar.ts#L2151)) calls `setMinSize({width:0,height:0})` / `setMaxSize({width:Number.MAX_VALUE,height:Number.MAX_VALUE})` on every `TabButton` at runtime. This is the live case the in-app Style Audit Panel (`#/style-audit`) shows as 32 duplicate `TabButton` `#id` rules, each with an identical `{ min-width: 0px; min-height: 0px; max-width: none; max-height: none; }` body. Neither `Button` nor `TabButton` defaults `minSize` or `maxSize` in its own `_defaultOptions` (confirmed: `grep -rn "minSize\|maxSize"` across `component/button/*.ts` finds nothing). For `maxSize` that doesn't matter: `isUnbounded(Number.MAX_VALUE)` is `true`, so the resolved CSS value is `"none"` — the *framework* tier's own baseline for `maxWidth`/`maxHeight` (`FRAMEWORK_DECLARATIONS.maxWidth`, [core/ClassStyleRules.ts:96](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L96)), which `_inheritedStyleBag` always carries regardless of any class-level deviation. The runtime call's value matches, so `setMaxSize` (once migrated) writes a removal. `minSize` has no equivalent framework fallback to land on: an undefaulted class's `minWidth`/`minHeight` resolves to `"auto"`, not the framework tier's `"0px"`, so `TabButton`'s `_inheritedStyleBag.minWidth` is `"auto"` — which never matches the `"0px"` `clampWrapperMain` writes. The `minSize` half of the duplicate row therefore persists after this plan; closing it needs `Button` or `TabButton` to gain a class-level `minSize` default of `{width:0,height:0}`, a component-specific change this plan does not make — see `## Non-Goals`.[^resolveDeclarations-asymmetry]

### Nine matching render-phase writes must also switch to `reconcileRuleDeclaration`

Skipping (the `writeRuleDeclaration` behaviour) is only safe when nothing can already be queued for that key from an earlier write in the same dirty bag. That assumption breaks the moment a setter for the same property can run *before* `applyStyle`'s first pass — and for all six properties here, one can: `Component.applyOptions()` dispatches `setForegroundColor` ([core/Component.ts:613](packages/lib/src/typescript/lib/core/Component.ts#L613)), `setOutline` ([:616](packages/lib/src/typescript/lib/core/Component.ts#L616)), `setUserSelect` ([:618](packages/lib/src/typescript/lib/core/Component.ts#L618)), `setMinSize` ([:620](packages/lib/src/typescript/lib/core/Component.ts#L620)), `setMaxSize` ([:621](packages/lib/src/typescript/lib/core/Component.ts#L621)), and `setOverflow` — which calls `setOverflowX`/`setOverflowY` — ([:627](packages/lib/src/typescript/lib/core/Component.ts#L627)) whenever a caller passes that option at construction, all from inside `super()`, before `_inheritedStyleBag` is resolved. Once these setters are reconciled (previous decision), a pre-render call whose value happens to equal the class default queues that value unconditionally (`_inheritedStyleBag` is still `null` at that point). If the render phase merely *skipped* a matching write, that queued value would survive untouched into the flush — a real, redundant `#id` declaration exactly like the ones this plan exists to remove. Only a render-phase write that also clears on match can correct it.[^backgroundColor-precedent]

The nine lines move from `writeRuleDeclaration` to `reconcileRuleDeclaration`, no other change to the surrounding phase methods:

| Phase method | Property | Line |
|---|---|---|
| `applyBoxAndVisibilityStyles` | `color` | [4893](packages/lib/src/typescript/lib/core/Component.ts#L4893) |
| `applySizeConstraintStyles` | `minWidth`, `minHeight` | [4950](packages/lib/src/typescript/lib/core/Component.ts#L4950)-[4951](packages/lib/src/typescript/lib/core/Component.ts#L4951) |
| `applySizeConstraintStyles` | `maxWidth`, `maxHeight` | [4956](packages/lib/src/typescript/lib/core/Component.ts#L4956)-[4957](packages/lib/src/typescript/lib/core/Component.ts#L4957) |
| `applyOverflowStyles` | `overflowX`, `overflowY` | [4969](packages/lib/src/typescript/lib/core/Component.ts#L4969), [4973](packages/lib/src/typescript/lib/core/Component.ts#L4973) |
| `applyChromeStyles` | `outline` | [4999](packages/lib/src/typescript/lib/core/Component.ts#L4999) |
| `applyMiscInlineStyles` | `userSelect` | [5066](packages/lib/src/typescript/lib/core/Component.ts#L5066) |

### `cursor` stays out of scope: it is an inline style, not a rule declaration

`resolveDeclarations()` computes a `cursor` comparison value (`defaults.cursor ?? "default"`), and it is genuinely consumed: `applyBoxAndVisibilityStyles()`'s `this.writeRuleDeclaration("cursor", cursor)` ([core/Component.ts:4888](packages/lib/src/typescript/lib/core/Component.ts#L4888)) still compares against it on every render, so the class-tier `cursor` value is not dead. But `Component.setCursor()` ([:2436](packages/lib/src/typescript/lib/core/Component.ts#L2436)) writes through `this.setElementStyle("cursor", cursor)` — the `InlineStyle` buffer over `HTMLElement.style`, not the `StyleRule` buffer `reconcileRuleDeclaration`/`setReconciledCSSRules` write to. An inline declaration always wins the cascade over any rule regardless of specificity, so there is no lower-specificity tier for a matching inline value to defer to — "hoisting" is not a concept that applies to cursor. Fixing this would mean moving `setCursor` off `InlineStyle` onto the `StyleRule` buffer entirely, a materially different, larger change than this plan's actual scope (rerouting a setter that already writes to a `StyleRule` through the comparison helper); out of scope here.

### The five `clear*` counterparts stay out of scope

Only five of the six properties have one (`clearForegroundColor`, `clearOutline`, `clearUserSelect`, `clearOverflowX`, `clearOverflowY` — `minSize`/`maxSize` have none). Each currently writes an unconditional removal (`this.setElementCSSRule("<key>", null)`). Because `outline`/`foregroundColor`/`userSelect`/`overflow` were *already* hoisted onto the class tier by an earlier plan (the render-phase `writeRuleDeclaration` skip-based hoisting `component-chrome-base-tier-hoisting`'s Overview calls "the original ten fields"), a class that already defaults one of these has *already* been publishing a `.ClassName` declaration for it before this plan starts. A bare removal on `#id` today already falls through to that `.ClassName` value rather than "clearing" — the same failure mode `component-chrome-base-tier-hoisting` fixed for `clearBackgroundColor`/`clearBackgroundImage` by substituting a CSS initial value. That gap pre-dates this plan, is not introduced or worsened by it (this plan does not touch any `clear*` method), and fixing it needs a per-property "what is the neutral value" decision — for `outline`/`foregroundColor` specifically that is CSS `inherit`, not the property's plain initial value, unlike the `transparent`/`none` substitutions the precedent used. That is a new design question, not "call the helper this setter should already call," so it is left for a future, focused plan.[^clear-gap-scope]

### No `depends-on` for `state-chrome-isolation-generalization`; `touches-shared` instead

`state-chrome-isolation-generalization.md` (drafted, not yet implemented) adds an isolation branch to `reconcileRuleDeclaration`/`setReconciledCSSRules` gated on `RESTING_ISOLATION_KEYS`, a fixed three-member set (`backgroundColor`, `backgroundImage`, `boxShadow`). None of this plan's six properties are members, so every write this plan adds always falls through to that sibling plan's unchanged `else` branch, regardless of which plan lands first — there is no functional ordering dependency. Both plans edit the same ~50-line region of `Component.ts` around these two methods, though: this plan's steps land at the render-phase call sites and the doc comments immediately around `reconcileRuleDeclaration`/`setReconciledCSSRules`, while the sibling plan rewrites those two methods' bodies. Implementing both in separate worktrees at once risks a textual merge conflict even though neither plan's design depends on the other's outcome — hence `touches-shared`, not `depends-on`, on `core/Component.ts`.[^isolation-keys-disjoint]

### `ClassStyleRules.ts` is untouched

Every comparison value this plan's setters and render-phase lines need — `color`, `outline`, `userSelect`, `minWidth`/`minHeight`, `maxWidth`/`maxHeight`, `overflowX`/`overflowY` — is already computed by `resolveDeclarations()` ([core/ClassStyleRules.ts:127](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L127)-[184](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L184)) and already flows into `_inheritedStyleBag` via `ensureClassStyleRule()`. This plan changes no file under `core/ClassStyleRules.ts`.

### Doc comments describing the mechanism as chrome-specific are corrected

`writeRuleDeclaration`'s `@remarks` currently says "the hoisted chrome properties are the exception" when describing which runtime setters route through `setReconciledCSSRules` instead of it ([core/Component.ts:4761](packages/lib/src/typescript/lib/core/Component.ts#L4761)); `reconcileRuleDeclaration`'s own doc comment calls itself the sibling "for the hoisted chrome declarations" ([:4775](packages/lib/src/typescript/lib/core/Component.ts#L4775)). Both become inaccurate once seven more, non-chrome setters route through the same path. Both are reworded to describe the mechanism generically (any hoisted property whose value can also be written by a runtime setter) rather than naming "chrome" — avoiding the same kind of stale, property-counting comment `component-chrome-base-tier-hoisting`'s own step 4 had to correct for `ClassStyleRules.ts`'s "fifteen" comments.

---

## Internal Structure

Representative before/after for one single-key setter and the batched pair; every other single-key setter (`setOutline`, `setUserSelect`, `setOverflowX`, `setOverflowY`) follows `setForegroundColor`'s shape exactly, changing only the CSS key and the local variable name.

```typescript
// core/Component.ts — setForegroundColor, before → after (only the write line changes):
setForegroundColor(foregroundColor: string): this {
    if (this._options.foregroundColor === foregroundColor) {
        return this;
    }

    this._options.foregroundColor = foregroundColor;
    this.setReconciledCSSRules({ color: foregroundColor });   // was: this.setElementCSSRule("color", foregroundColor);

    return this;
}
```

```typescript
// core/Component.ts — setMinSize, before → after (only the write line changes):
setMinSize(size: Size): this {
    const current = this._options.minSize;
    if (current && current.width === size.width && current.height === size.height) {
        return this;
    }

    const next: Size = { width: size.width, height: size.height };
    this._options.minSize = next;

    this.setReconciledCSSRules({
        minWidth:  next.width  + "px",
        minHeight: next.height + "px"
    });                                    // was: this.setElementCSSRules({ ... })

    this.setDataAttribute("minSize", formatSizeAttr(next.width, next.height));
    this._onConstraintSizeChange?.();

    return this;
}
```

`setMaxSize` follows identically, keeping its existing `isUnbounded(...)` ternaries inside the bag passed to `setReconciledCSSRules`.

```typescript
// core/Component.ts — applyBoxAndVisibilityStyles, the color line (one of nine identical renames):
const foregroundColor = this.getForegroundColor();
if (foregroundColor) {
    this.reconcileRuleDeclaration("color", foregroundColor);   // was: this.writeRuleDeclaration(...)
}
```

Doc comment rewording (`writeRuleDeclaration`'s `@remarks`, [core/Component.ts:4758](packages/lib/src/typescript/lib/core/Component.ts#L4758)-[4764](packages/lib/src/typescript/lib/core/Component.ts#L4764)):

```typescript
/**
 * ...
 * @remarks Only skips a write issued from `applyStyle` itself — a runtime
 * setter calling `setElementCSSRule` never goes through this helper, so
 * it always reaches `#id` and wins on specificity regardless of what the
 * framework or class rule already holds. A hoisted property whose runtime
 * setter also needs this treatment routes through
 * {@link setReconciledCSSRules} instead, which still writes on a match —
 * as a removal — rather than skipping.
 */
```

`reconcileRuleDeclaration`'s doc comment ([:4774](packages/lib/src/typescript/lib/core/Component.ts#L4774)-[4779](packages/lib/src/typescript/lib/core/Component.ts#L4779)) drops "for the hoisted chrome declarations", keeping the rest of the sentence unchanged: `"writeRuleDeclaration`'s clear-on-match sibling. A match queues a removal rather than skipping, ..."`.

---

## Ordered Implementation Steps

1. **Write the tests first.** Create `packages/lib/tests/core/ClassReconciledRules.test.ts` covering `## Expected Behaviour` rows 1-6. Follow `ClassChromeRules.test.ts`'s conventions: unique probe class names per test (this module's `_owners`/`_bags` registries are process-wide, module-scoped state), the `declarationsDuring(sink, selector, fn)` / `idSelector(component)` helpers copied verbatim from that file, and `super(options, { <field>: <value> })` as the per-class default seed.
   *Check:* `npx vitest run tests/core/ClassReconciledRules.test.ts` — every case fails for the expected reason (the setters still write unconditionally).

2. **`core/Component.ts` — route the five single-key setters.** Change the write line inside each to `this.setReconciledCSSRules({ <key>: <value> })`, per the table in `## Architecture Decisions`: `setForegroundColor` ([2321](packages/lib/src/typescript/lib/core/Component.ts#L2321)), `setOutline` ([2610](packages/lib/src/typescript/lib/core/Component.ts#L2610)), `setUserSelect` ([4684](packages/lib/src/typescript/lib/core/Component.ts#L4684)), `setOverflowX` ([4039](packages/lib/src/typescript/lib/core/Component.ts#L4039)), `setOverflowY` ([4084](packages/lib/src/typescript/lib/core/Component.ts#L4084)). Leave every early-return guard, `_options`/field write, and (for the overflow pair) the trailing `refreshWheelScrolling()` call untouched — only the one write line inside each.
   *Check:*
   ```
   grep -nE 'this\.setElementCSSRule\("color", foregroundColor\)'   packages/lib/src/typescript/lib/core/Component.ts
   grep -nE 'this\.setElementCSSRule\("outline", outline\)'         packages/lib/src/typescript/lib/core/Component.ts
   grep -nE 'this\.setElementCSSRule\("userSelect", value\)'        packages/lib/src/typescript/lib/core/Component.ts
   grep -nE 'this\.setElementCSSRule\("overflowX", value\)'         packages/lib/src/typescript/lib/core/Component.ts
   grep -nE 'this\.setElementCSSRule\("overflowY", value\)'         packages/lib/src/typescript/lib/core/Component.ts
   ```
   All five expect **zero matches** (each was exactly one match before this step). `clearForegroundColor`/`clearOutline`/`clearUserSelect`/`clearOverflowX`/`clearOverflowY`'s own `setElementCSSRule("<key>", null)` calls are untouched and do not match these patterns (they pass literal `null`, not the variable name).

3. **`core/Component.ts` — route `setMinSize` / `setMaxSize`.** Change the `this.setElementCSSRules({ ... })` call in each ([3016](packages/lib/src/typescript/lib/core/Component.ts#L3016)-[3019](packages/lib/src/typescript/lib/core/Component.ts#L3019), [3057](packages/lib/src/typescript/lib/core/Component.ts#L3057)-[3060](packages/lib/src/typescript/lib/core/Component.ts#L3060)) to `this.setReconciledCSSRules({ ... })`, keeping the inner object literal — including `setMaxSize`'s `isUnbounded(...)` ternaries — byte-for-byte identical. Leave the early-return guard, `_options.minSize`/`_options.maxSize` write, the `setDataAttribute` call, and `_onConstraintSizeChange?.()` untouched.
   *Check:* manual read-through confirms both write lines now begin `this.setReconciledCSSRules({`. `grep -c 'setReconciledCSSRules(' packages/lib/src/typescript/lib/core/Component.ts` — **11** (was 9 before this step: 8 existing calls + the method's own definition; this step adds 2).

4. **`core/Component.ts` — route the nine matching render-phase writes.** Change each line in the `## Architecture Decisions` table from `writeRuleDeclaration` to `reconcileRuleDeclaration`, same arguments, same surrounding `if` guards.
   *Check:*
   ```
   grep -nE 'this\.writeRuleDeclaration\("(color|minWidth|minHeight|maxWidth|maxHeight|overflowX|overflowY|outline|userSelect)"' packages/lib/src/typescript/lib/core/Component.ts
   ```
   Expects **zero matches** (all nine were exactly one match each before this step). `grep -c 'writeRuleDeclaration(' packages/lib/src/typescript/lib/core/Component.ts` — **12** (was 21). `grep -c 'reconcileRuleDeclaration(' packages/lib/src/typescript/lib/core/Component.ts` — **14** (was 5).

5. **`core/Component.ts` — reword the two doc comments.** Update `writeRuleDeclaration`'s `@remarks` ([4758](packages/lib/src/typescript/lib/core/Component.ts#L4758)-[4764](packages/lib/src/typescript/lib/core/Component.ts#L4764)) and `reconcileRuleDeclaration`'s doc comment ([4774](packages/lib/src/typescript/lib/core/Component.ts#L4774)-[4779](packages/lib/src/typescript/lib/core/Component.ts#L4779)) per `## Internal Structure`, dropping the "chrome" framing. `setReconciledCSSRules`'s own doc comment ([4784](packages/lib/src/typescript/lib/core/Component.ts#L4784)-[4789](packages/lib/src/typescript/lib/core/Component.ts#L4789)) already describes itself generically ("Runtime-setter form of `reconcileRuleDeclaration`") and needs no change.
   *Check:* `grep -n 'hoisted chrome' packages/lib/src/typescript/lib/core/Component.ts` — zero matches.

6. **Run the new test file.** `npx vitest run tests/core/ClassReconciledRules.test.ts` — all green.

7. **Add the changelog entry.** See `## Documentation Impact`.

8. **Run the full verification list.** See `## Verification`.

9. **Verify live in a browser.** Non-negotiable — see `## Verification`. The offline suite asserts what gets *written*, not what the CSS cascade *resolves*.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/core/ClassReconciledRules.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-6 are unit-testable against the recording DOM sink, mirroring `ClassChromeRules.test.ts`'s pattern (`materialiseWhenNeeded` only inserts `#id` once something real is already queued for it, so a "removal is written" assertion needs an earlier real, deviating write on the same rule first — see that file's header comment). Rows 7-8 are manual, browser-only verification.

| # | Case | Expected |
|---|---|---|
| 1 | An already-rendered instance of a class that defaults `foregroundColor` calls `setForegroundColor(<a different color>)`, then `setForegroundColor(<the class default>)` | First call writes `color: <different color>` to `#id`; second call writes a `color` **removal**, not a skipped write |
| 2 | Same pattern, independently, for `setOutline` / `setUserSelect` / `setOverflowX` / `setOverflowY` on classes that default `outline` / `userSelect` / `overflow` respectively | Each: the matching call writes a removal for its own CSS key (`outline` / `userSelect` / `overflowX` or `overflowY`) |
| 3 | `setMinSize({ width: 0, height: 20 })` on an instance whose class defaults `minSize` to `{ width: 0, height: 10 }` (already-rendered, with an earlier deviating call so `#id` is materialised) | `minWidth` is removed (matches); `minHeight: 20px` is written for real (does not match) — the batch's two keys resolve independently, per the worked table in `## Architecture Decisions` |
| 4 | `setMaxSize({ width: Number.MAX_VALUE, height: Number.MAX_VALUE })` on an instance of a class with no `maxSize` default (already-rendered, with an earlier deviating call) | Both `maxWidth` and `maxHeight` resolve to `"none"` and are removed — this matches the *framework* tier's own `"none"` baseline, with no class-level `maxSize` default needed |
| 5 | A component is constructed with an explicit option equal to its class's own default, for one of the six properties (e.g. `new Foo({ minSize: { width: 0, height: 10 } })` on a class defaulting `minSize` to exactly that) | `applyOptions` dispatches the setter during `super()`, before `_inheritedStyleBag` exists, so it queues the value unconditionally; the first render's phase then re-derives the same declaration through `reconcileRuleDeclaration` and overwrites the queued entry with a removal — the rendered `#id` rule carries no declaration for that property, not a stale duplicate |
| 6 | A setter call whose value does not match the class or framework tier (any of the seven) | Writes the real value to `#id`, unchanged from today |
| 7 | Manual — live app, `#/tabs` (resize so `TabBar.clampWrapperMain` fires), DevTools Style Audit Panel (`#/style-audit`) | The `TabButton` duplicate-rule row's body no longer includes `max-width`/`max-height`; `min-width`/`min-height` still appear per-instance. Expected, not a defect — see the dedicated Architecture Decision |
| 8 | Manual — live app, any component whose class defaults one of the six properties (e.g. `Button`'s `foregroundColor`), read via DevTools computed style | Text colour, outline, user-select, overflow, and min/max-size behaviour is visually identical to before the change |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants — see the per-step counts in `## Ordered Implementation Steps` (steps 2-5); reproduced together here:

```
grep -nE 'this\.setElementCSSRule\("(color|outline|userSelect|overflowX|overflowY)", (foregroundColor|outline|value)\)' packages/lib/src/typescript/lib/core/Component.ts   # zero matches
grep -nE 'this\.writeRuleDeclaration\("(color|minWidth|minHeight|maxWidth|maxHeight|overflowX|overflowY|outline|userSelect)"' packages/lib/src/typescript/lib/core/Component.ts   # zero matches
grep -c 'writeRuleDeclaration(' packages/lib/src/typescript/lib/core/Component.ts        # 12
grep -c 'reconcileRuleDeclaration(' packages/lib/src/typescript/lib/core/Component.ts    # 14
grep -c 'setReconciledCSSRules(' packages/lib/src/typescript/lib/core/Component.ts       # 11
grep -n 'hoisted chrome' packages/lib/src/typescript/lib/core/Component.ts               # zero matches
```

**Manual browser verification (rows 7-8) is required.** The offline harness records writes; it does not run a CSS cascade.

- Start a dev server on a spare port from *this worktree* (`npx vite --port 8025` inside `packages/lib`), not the user's existing server.
- Exercise `#/tabs` (resize the window/split so `TabBar.clampWrapperMain` fires) and `#/style-audit`.
- Exercise `#/buttons`, `#/inputs`, and any screen with `overflow: auto` content, reading **computed styles** rather than relying on screenshots.

---

## Documentation Impact

No exported symbol changes — the seven setters' public signatures are unchanged, and `matchesClassStyle`/`reconcileRuleDeclaration`/`setReconciledCSSRules` are already `protected`. No API page, barrel, or sidebar entry changes.

One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Core`, immediately after the existing `background-color`/`background-image`/`box-shadow`/border-longhands bullet:

- `setForegroundColor`, `setOutline`, `setUserSelect`, `setMinSize`, `setMaxSize`, `setOverflowX`, and `setOverflowY` now dedupe against the class-tier default too, not only the value resolved at render. These properties already skipped a redundant per-instance declaration when their *render-time* value matched the class default; calling the setter directly with a value that happens to equal that default previously still wrote a real, redundant `#id` declaration — it now writes a removal instead, so the shared `.ClassName` rule (or the framework rule) supplies the value. No consumer action is needed; the rendered result is unchanged.

---

## Potential Challenges

- **The motivating `TabButton` example only half-collapses** (see the dedicated Architecture Decision and `## Expected Behaviour` row 7). No mitigation needed for this plan; `## Non-Goals` covers the follow-up.
- **`clear*` counterparts of five of these setters keep a pre-existing, unrelated gap** (see the `clear*` Architecture Decision). Not worsened by this plan; mentioned so a future reader doesn't mistake it for a regression introduced here.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/Component.ts` | Every setter and render-phase line this plan touches; `matchesClassStyle` (4746), `writeRuleDeclaration` (4766), `reconcileRuleDeclaration` (4780), `setReconciledCSSRules` (4790), `applyOptions` (598) |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `resolveDeclarations` (127) — the already-complete comparison-value source this plan routes seven more setters against, unchanged |
| `plans/implemented/component-chrome-base-tier-hoisting.md` | The precedent this plan extends — its Internal Structure defines `matchesClassStyle`/`reconcileRuleDeclaration`/`setReconciledCSSRules`, and its `[^why-clear-not-skip]` footnote is why the render-phase migration (not just the setter migration) is required |
| `plans/state-chrome-isolation-generalization.md` | Drafted, not yet implemented, sibling plan touching the same two methods — read to confirm the disjoint-key-set independence this plan's `touches-shared` decision relies on |
| `packages/lib/tests/core/ClassChromeRules.test.ts` | Test conventions this plan's new test file mirrors (`declarationsDuring`, `idSelector`, unique-per-file probe class names, the "needs an earlier deviating write to observe a removal" note) |
| `packages/lib/src/typescript/lib/component/container/TabBar.ts` | `clampWrapperMain` (1941) — the concrete, live motivating call site for `setMinSize`/`setMaxSize`, called from e.g. line 2151 |

---

## Non-Goals

- **The `clear*` counterparts** of `setForegroundColor`, `setOutline`, `setUserSelect`, `setOverflowX`, `setOverflowY`. See the dedicated Architecture Decision — the gap they have is pre-existing and needs a per-property neutral-value design, not a mechanical routing change.
- **`cursor`.** Written through the `InlineStyle` buffer, not a `StyleRule` — a different, larger change (moving cursor off inline styles) than this plan's scope. See the dedicated Architecture Decision.
- **Giving `Button`/`TabButton` a class-level `minSize` default** matching what `TabBar.clampWrapperMain` asserts, to fully collapse the `minSize` half of the motivating example (see the dedicated Architecture Decision). That is a component-specific option-defaults change; this plan widens the write path, which already benefits every class that defaults these properties today (confirmed: `Button` defaults `foregroundColor`; several list/input classes default `outline`/`userSelect`/`overflow`) independent of whether `TabButton` additionally gains a `minSize` default.
- **`ClassStyleRules.ts` / `resolveDeclarations`.** Already computes every comparison value this plan needs; no change required.
- **`state-chrome-isolation-generalization`'s resting-isolation mechanism.** Independent sibling plan; see the dedicated Architecture Decision for why no `depends-on` applies.

---

## Notes

[^precedent-generic]: `component-chrome-base-tier-hoisting`'s own Internal Structure ([plans/implemented/component-chrome-base-tier-hoisting.md](plans/implemented/component-chrome-base-tier-hoisting.md), "`core/Component.ts`" subsection) defines `matchesClassStyle(key, value)`, `reconcileRuleDeclaration(key, value)`, and `setReconciledCSSRules(values: Style)` with plain `string`/`Style` parameters — nothing in any of the three signatures or bodies references a fixed property list. The four-chrome-property scope of that plan was a statement about which *setters* it migrated, not a constraint the methods enforce.

[^no-overrides]: Confirmed by `grep -rn 'setForegroundColor(\|setOutline(\|setUserSelect(\|setMinSize(\|setMaxSize(\|setOverflowX(\|setOverflowY('` across `packages/lib/src/typescript/lib/component/` — every match is a *call* to the base method, none is a redefinition. `Component.ts` is the only file defining any of the seven.

[^backgroundColor-precedent]: `component-chrome-base-tier-hoisting`'s own footnote `[^always-dispatch-group]` establishes the identical reasoning for `backgroundColor`, which — like this plan's six properties, and unlike the "always-dispatch" `border`/`shadow`/`backgroundImage` group — is only dispatched from `applyOptions` when the caller explicitly passes the option (`if (options.backgroundColor !== undefined) this.setBackgroundColor(...)`), the same conditional-dispatch shape confirmed above for all six of this plan's properties. That footnote's conclusion — "the reconcile matters only when a caller passed a value equal to the class default" — is exactly the case this plan's render-phase migration closes for `color`/`outline`/`userSelect`/`minWidth`/`minHeight`/`maxWidth`/`maxHeight`/`overflowX`/`overflowY`.

[^resolveDeclarations-asymmetry]: The asymmetry lives entirely in the pre-existing, unmodified `resolveDeclarations()` ([core/ClassStyleRules.ts:127](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L127)-[148](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L148)): `minWidth: minSize ? minSize.width + "px" : "auto"` falls back to `"auto"` when the class has no `minSize` default, while `maxWidth: maxSize ? ... : "none"` falls back to `"none"` — which happens to equal `FRAMEWORK_DECLARATIONS.maxWidth`. This plan does not change or question that asymmetry; it is cited here only to explain why the same mechanism produces a different outcome for the two axes of one motivating example.

[^clear-gap-scope]: Concretely: if a class defaults `outline` (e.g. `Link`'s focus outline, `component/input/Link.ts:51`), calling `clearOutline()` today writes an unconditional `outline` removal on `#id`; because `.Link`'s class-tier rule already declares `outline` (via the pre-existing, already-implemented render-phase hoisting), the removal on `#id` falls through to that class value rather than clearing the outline. This is true today, before this plan changes anything, and stays true after — `clearOutline`'s write line is untouched by every step in `## Ordered Implementation Steps`. The correct fix (asserting `outline: inherit` — or another per-property neutral — when the class defaults the property, mirroring `component-chrome-base-tier-hoisting`'s `transparent`/`none` substitutions for `clearBackgroundColor`/`clearBackgroundImage`) is a legitimate follow-up but a distinct design decision per property, made deliberately out of scope here.

[^isolation-keys-disjoint]: `state-chrome-isolation-generalization.md`'s Internal Structure defines `RESTING_ISOLATION_KEYS` as `new Set(["backgroundColor", "backgroundImage", "boxShadow"])` — moved verbatim from `Button`'s existing `RESTING_RECONCILED_KEYS` constant, unchanged in content. Its proposed `reconcileRuleDeclaration`/`setReconciledCSSRules` bodies check `RESTING_ISOLATION_KEYS.has(key)` before doing anything different from today's behaviour; for any key outside that three-member set — every key this plan adds — the isolation branch's condition is false and execution falls through to the plain `matchesClassStyle`-and-queue path this plan already relies on. This holds regardless of implementation order.
