# Suppress Empty Style Rules — Implementation Plan

## Overview

A live-browser audit of a running demo app (`http://localhost:8015`) found the shared `<style id="Base">` stylesheet carrying a large number of fully empty component rules — `#id { }`, zero declarations — plus a smaller set of `#id::-webkit-scrollbar { }` rules. A repeat measurement in this session, on the same page, found 178 empty plain rules and 6 empty scrollbar rules; the exact count is page/session-dependent (it scales with how many components are on screen), but the cause is stable.[^measurement]

Both shapes come from the same class of bug: a `StyleRule` gets materialised — inserted into the CSSOM via `ensure()` — at a point where nothing queued for it would ever produce a real declaration. Three places in [`Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) call `ensure()` on a `StyleRule`, and none of them correctly distinguishes "nothing queued" or "only `null` removals queued" from "a real declaration is waiting": `commitCSSRule()` ([Component.ts:1647](packages/lib/src/typescript/lib/core/Component.ts#L1647)), `materialiseStyleRule()` ([Component.ts:5018](packages/lib/src/typescript/lib/core/Component.ts#L5018)), and `materialiseDeferredRules()` ([Component.ts:5031](packages/lib/src/typescript/lib/core/Component.ts#L5031)).

Stack-trace instrumentation of the live app (monkey-patching `CSSStyleSheet.prototype.insertRule` to capture the call path for every rule insertion, then cross-referencing against which inserted rules end up empty) attributes the two shapes precisely:[^measurement]

- **100% of the empty plain rules (178/178 sampled) go through `commitCSSRule()`**, called from `setAutoCommitStyle(true)` ([Component.ts:1545](packages/lib/src/typescript/lib/core/Component.ts#L1545)), called from `LayoutManager.commitBounds()` ([packages/lib/src/typescript/lib/layout/LayoutManager.ts:509](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L509)) on essentially every layout commit. `commitCSSRule()` has **no guard at all** — not even a check that the dirty bag is non-empty — so a component with zero per-instance CSS-rule deviations still gets an `ensure()` call the first time any ancestor lays it out.[^missed-by-precedent]
- **100% of the empty scrollbar rules (6/6 sampled) go through `materialiseDeferredRules()`**, reached from `Panel.init()` → `Panel.applyStyle()`. `Panel.setNativeScrollbarHidden(false)` ([packages/lib/src/typescript/lib/core/Panel.ts:1205-1208](packages/lib/src/typescript/lib/core/Panel.ts#L1205-L1208)) calls `this.createStyleRule("::-webkit-scrollbar").set("display", null)` — a real `null` removal, queued as the *only* entry in that deferred rule's dirty bag. It runs from `removeOverlayScrollbars()` ([Panel.ts:1146](packages/lib/src/typescript/lib/core/Panel.ts#L1146)), a defensive teardown the class's own doc comment says is "safe to call before the overlay was ever created (e.g. during the construction cascade)" — so it fires for every Panel that never installs an overlay scrollbar at all, not only ones tearing a real one down.

`materialiseStyleRule()` already has a guard, `hasQueuedWrites()` ([StyleTarget.ts:96](packages/lib/src/typescript/lib/core/StyleTarget.ts#L96)) — added by [`plans/implemented/stylerule-batched-flush.md`](implemented/stylerule-batched-flush.md) — but it only checks whether the dirty bag is non-empty, not whether it holds a real declaration. It attributed 0 of the sampled 184 empty rules on this page, but shares the identical bug shape and can still misfire: `writeRuleDeclaration()` ([Component.ts:4720](packages/lib/src/typescript/lib/core/Component.ts#L4720)) skips queuing a value that matches the class's inherited baseline, *unless* `ensureClassStyleRule()` ([ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts)) opted the class out (an anonymous or name-colliding constructor) — in which case every phase queues its value unfiltered, `null`s included. This plan fixes all three sites with one shared mechanism, so the class of bug is closed everywhere it can occur, not just where it was observed today.

---

## Architecture Decisions

### One new `StyleTarget` predicate distinguishes a real declaration from a no-op removal

`StyleTarget` gains `hasQueuedDeclarations()`, a public predicate beside `hasQueuedWrites()` / `isMaterialized()`: true only when the dirty bag holds at least one entry whose value isn't `null`. `hasQueuedWrites()` stays exactly as it is — it is still a correct answer to its own question ("is the bag non-empty"), just not the question the three materialisation sites need answered.[^keep-hasqueuedwrites]

### A shared private helper closes the gap at all three sites

`Component` gains one private method, `materialiseWhenNeeded(rule: StyleRule): void`, and `commitCSSRule()`, `materialiseStyleRule()`, and `materialiseDeferredRules()` all call it instead of calling `ensure()` themselves. All three do the same thing — materialise a `StyleRule` only when it's worth it, then let the caller flush — so one guard, not three copies of it, is the shape that mirrors how `writeRuleDeclaration()` centralises the "is this value worth queuing" comparison for the phases above it.[^dry]

### Skip only before first materialisation; an already-live rule always flushes

The skip condition is `!rule.isMaterialized() && !rule.hasQueuedDeclarations()`. Once a rule already exists in the CSSOM, *any* queued write — including a `null` — is a real change to live state (it clears a previously-set declaration), not a no-op, so it must still flush. `materialiseWhenNeeded()` expresses this as `rule.isMaterialized() || rule.hasQueuedDeclarations()` before calling `ensure()`.

| Rule state | Dirty bag | Materialise? | Why |
|---|---|---|---|
| Not yet materialised | `{}` (empty) | No | Nothing queued at all — the `commitCSSRule()` dominant case |
| Not yet materialised | `{ display: null }` | No | Only a no-op removal — the scrollbar-rule case |
| Not yet materialised | `{ color: "red" }` | Yes | A real declaration |
| Already materialised | `{ border: null }` | Yes (already live; skip doesn't apply) | Clears a real, previously-set declaration |

### Disposal and the rule cache need no change

Skipping `ensure()` means `_ruleFor()` never runs for that selector, so it never enters the module-level `_ruleCache` ([StyleTarget.ts:168](packages/lib/src/typescript/lib/core/StyleTarget.ts#L168)). `disposeStyleRule()` ([StyleTarget.ts:209-214](packages/lib/src/typescript/lib/core/StyleTarget.ts#L209-L214)) already returns before touching the sink when the selector isn't cached — the exact guard the batched-flush plan's teardown argument relies on for the same reason.[^teardown-noop] Both teardown paths — `Component.destructor()`'s direct `rule.dispose()` calls ([Component.ts:875-879](packages/lib/src/typescript/lib/core/Component.ts#L875-L879)) and the `FinalizationRegistry` callback for a garbage-collected, never-destructed component ([Component.ts:322-330](packages/lib/src/typescript/lib/core/Component.ts#L322-L330)) — route through `disposeStyleRule()`, so both are already safe. `ClassStyleRules.ts`'s `_bags` / `_owners` module state is untouched by this plan; it governs the framework/class tier, a separate mechanism from the per-component `_styleRule` / `_deferredStyleRules` this plan changes.

### Scope: `Component.ts` and `StyleTarget.ts` only

`Button.ts` / `TabBar.ts` / `ClassStyleRules.ts` are out of scope — a larger, separate effort (a sibling plan) will hoist more of those classes' state-chrome rules onto shared class rules, which will produce more instances of this exact empty-deferred-rule shape as a side effect. This fix is a superset benefit worth landing on its own first, since it closes the underlying gap in `materialiseDeferredRules()` rather than papering over today's known instances.

---

## Public API

```typescript
// core/StyleTarget.ts — StyleTarget. New public predicate, beside hasQueuedWrites() / isMaterialized().
hasQueuedDeclarations(): boolean;
```

No other signature changes. `commitCSSRule()`, `materialiseStyleRule()`, `materialiseDeferredRules()`, and the new `materialiseWhenNeeded()` stay `protected`/`private`; no options-bag field, no new setter.

---

## Internal Structure

`StyleTarget`'s new predicate, immediately after `hasQueuedWrites()`:

```typescript
/**
 * Returns whether the dirty bag holds at least one entry that would produce
 * a real CSS declaration if flushed — a queued value that isn't a no-op
 * `null` removal. Distinct from {@link StyleTarget.hasQueuedWrites}, which
 * only asks whether the bag is non-empty and can't tell a real declaration
 * from a bag holding only `null` entries queued before the target ever
 * existed.
 */
hasQueuedDeclarations(): boolean {
    for (const key of Object.keys(this._dirty)) {
        if (this._dirty[key] !== null) {
            return true;
        }
    }

    return false;
}
```

`Component`'s new shared helper, placed directly above `materialiseStyleRule()`:

```typescript
/**
 * Materialises `rule` only when doing so is worth it: the rule already
 * exists — so any queued write, including a `null` removal, is a real
 * change to live state — or the dirty bag holds at least one real
 * declaration. Skips a rule that would otherwise insert empty, with every
 * currently-queued entry a no-op `null` removal of a property that was
 * never set.
 *
 * @param rule - The component-scoped or deferred `StyleRule` to
 *   conditionally materialise.
 */
private materialiseWhenNeeded(rule: StyleRule): void {
    if (rule.isMaterialized() || rule.hasQueuedDeclarations()) {
        rule.ensure();
    }
}
```

The three call sites, each reduced to a call through the helper:

```typescript
protected commitCSSRule(): this {
    if (!this.getElement()) {
        return this;
    }

    this.materialiseWhenNeeded(this._styleRule);
    this._styleRule.flush();

    return this;
}
```

```typescript
protected materialiseStyleRule(): void {
    this.materialiseWhenNeeded(this._styleRule);
    this._styleRule.flush();
}
```

```typescript
private materialiseDeferredRules(): void {
    for (const deferredRule of this._deferredStyleRules.values()) {
        this.materialiseWhenNeeded(deferredRule);
    }
}
```

`commitCSSRule()` and `materialiseStyleRule()` now have the same body shape (`materialiseWhenNeeded` then `flush()`); `flush()` is already safe to call unconditionally — `StyleTarget.flush()` returns immediately when the target is still unmaterialised, and `StyleRule.flushDirty()` returns immediately on an empty bag ([StyleTarget.ts:317-323](packages/lib/src/typescript/lib/core/StyleTarget.ts#L317-L323)) — so no behaviour changes for the cases that already worked.

---

## Ordered Implementation Steps

1. **`core/StyleTarget.ts`** — add `hasQueuedDeclarations()` to `StyleTarget`, immediately after `hasQueuedWrites()` (line 96-98), using the body in [Internal Structure](#internal-structure).
   Check: `npm run typecheck` from `packages/lib` — clean (matches the pre-change baseline of 0 errors).

2. **`core/Component.ts`** — add the private `materialiseWhenNeeded(rule: StyleRule): void` helper directly above `materialiseStyleRule()` (currently line 5018), using the body in [Internal Structure](#internal-structure).

3. **`core/Component.ts`** — rewrite `commitCSSRule()` (line 1647-1661) to call `this.materialiseWhenNeeded(this._styleRule);` in place of `this._styleRule.ensure();`, keeping the existing `if (!this.getElement())` guard and the trailing `this._styleRule.flush();` unchanged. Update its `@remarks` to add: "Once attached, also skips inserting the rule when nothing queued would produce a real declaration — see `materialiseWhenNeeded`." Do not remove the existing remark about skipping while unattached.

4. **`core/Component.ts`** — rewrite `materialiseStyleRule()` (line 5018-5025) to the body in [Internal Structure](#internal-structure), replacing the `if (!this._styleRule.hasQueuedWrites()) { return; } this.ensureCSSRule();` shape. Update its `@remarks`: change "Skipped entirely when the phases queued nothing" to "Skipped entirely when the phases queued nothing worth a real declaration" so the wording covers the null-only case, not just the empty-bag case.

5. **`core/Component.ts`** — rewrite `materialiseDeferredRules()` (line 5031-5040) to loop `this.materialiseWhenNeeded(deferredRule);` instead of `deferredRule.ensure();`. Update its comment: the current text says each deferred rule's writes "flush onto the live `CSSStyleRule` inside `ensure()`" without qualification — add a sentence noting a deferred rule allocated via `createStyleRule()` but never given a real declaration (e.g. `Panel`'s `::-webkit-scrollbar` rule when the native bar is never hidden) is now correctly skipped rather than inserted empty.
   Check: `grep -n "\.ensure()" packages/lib/src/typescript/lib/core/Component.ts` — expect exactly two matches: inside `materialiseWhenNeeded()`, and inside `ensureCSSRule()` (which still backs the unguarded, on-demand `getCSSRule()` accessor — see [Non-Goals](#non-goals)). Before this step, the same grep matches three: `ensureCSSRule()`, `commitCSSRule()`, and `materialiseDeferredRules()`.

6. **`ARCHITECTURE.md`** — in the *Defer DOM work to render time* section's **Component CSS rule** bullet, change "`applyStyle` flushes at render, and inserts the rule only when something was queued" to "`applyStyle` flushes at render, and inserts the rule only when a real declaration is queued — not for a bag holding only no-op `null` removals." Leave the rest of the bullet (including "Never call `ensureCSSRule()` from a setter") unchanged.

7. **`tests/core/StyleRuleBatchedFlush.test.ts`** — add the test-local probe class and the nine new cases (16-24) from [Expected Behaviour](#expected-behaviour), continuing the file's existing `case N:` numbering and reusing its existing `RuleProbe`, `RecordingDOMSink`, and `_ruleCacheHas` helpers. Add `NullOnlyDeferredRuleProbe` next to the existing `DeferredRuleProbe`, following the same shape.
   Check: `npx vitest run tests/core/StyleRuleBatchedFlush.test.ts` from `packages/lib` — every new case passes; run it against the pre-fix code first (steps 1-6 not yet applied) to confirm cases 16, 18, and 20 fail there, proving they exercise the bug.

8. **Run the full verification pass** in [Verification](#verification).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/StyleTarget.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/tests/core/StyleRuleBatchedFlush.test.ts` |
| Modify | `ARCHITECTURE.md` |

---

## Expected Behaviour

All cases continue the numbering already in `packages/lib/tests/core/StyleRuleBatchedFlush.test.ts` (cases 1-15 exist today; this plan adds 16-24). Cases 16-19 exercise `commitCSSRule()` via `setAutoCommitStyle`; cases 20-21 exercise `materialiseDeferredRules()`; cases 22-24 unit-test the new predicate directly on a bare `StyleRule`. A new probe class, `NullOnlyDeferredRuleProbe`, sits beside the existing `DeferredRuleProbe`:

```typescript
/** A component whose deferred rule is queued with only a no-op null removal. */
class NullOnlyDeferredRuleProbe extends _Component {
    constructor() {
        super();
        this.createStyleRule('.probe').set('display', null);
    }
}
```

| # | Case | Expected | How |
|---|---|---|---|
| 16 | **An empty `autoCommitStyle` window inserts no rule.** `new Component({})`, `getElement(true)` (no deviation, per case 15), then `setAutoCommitStyle(false)` immediately followed by `setAutoCommitStyle(true)` with nothing queued in between. | No `ensureStyleRule` op for `#<id>` — same as before the toggle. This is the dominant bug: `commitCSSRule()` fires on every `setAutoCommitStyle(true)`, including one with nothing queued. | unit |
| 17 | **A real declaration queued inside the window still materialises exactly once.** A `RuleProbe`, rendered empty (case 11's setup), then `setAutoCommitStyle(false)`, `probe.rule('color', 'red')`, `setAutoCommitStyle(true)`. | Exactly one `ensureStyleRule` and one `setRuleStyles` op for `#<id>`, bag `{ color: 'red' }`. | unit |
| 18 | **A `null` removal on an already-materialised rule still flushes.** A `RuleProbe` with `probe.rule('color', 'red')` queued before `getElement(true)` (materialises with `{ color: 'red' }`, per case 12's shape), then `setAutoCommitStyle(false)`, `probe.rule('color', null)`, `setAutoCommitStyle(true)`. | One further `setRuleStyles` op for `#<id>`, bag `{ color: null }` — the removal reaches the sink because the rule already exists. Pins the already-materialised constraint. | unit |
| 19 | **Teardown after a skipped window is a clean no-op.** Case 16's component, then `dispose()`. | No `deleteStyleRule` op for `#<id>`, no throw, `_ruleCacheHas('#' + id)` stays `false`. | unit |
| 20 | **A deferred rule queued with only a null removal materialises nothing.** `new NullOnlyDeferredRuleProbe()`, `getElement(true)`. | No `ensureStyleRule` op and no `setRuleStyles` op for `#<id>.probe`; `_ruleCacheHas('#' + id + '.probe')` is `false`. Reproduces the scrollbar-rule bug shape offline. | unit |
| 21 | **Teardown of a skipped deferred rule is a clean no-op.** Case 20's component, then `dispose()`. | No `deleteStyleRule` op for `#<id>.probe`, no throw, `_ruleCacheHas` stays `false`. | unit |
| 22 | **An empty dirty bag has no queued declarations.** A bare `StyleRule({ materialize: false })`, nothing queued. | `hasQueuedDeclarations()` returns `false`. | unit |
| 23 | **A bag of only null removals has no queued declarations.** Same rule, `set('border', null)`, `set('color', null)`. | `hasQueuedDeclarations()` returns `false`. | unit |
| 24 | **One real value among null removals counts.** Same rule, `set('border', null)`, `set('color', 'red')`. | `hasQueuedDeclarations()` returns `true`. | unit |
| 25 | **The demo page's empty-rule count drops to (near) zero.** Re-run the audit script from [^measurement] against `http://localhost:8015/#/misc` before and after the fix. | The count of zero-declaration `#id { }` and `#id::-webkit-scrollbar { }` rules on `<style id="Base">` drops from 178/6 to a number attributable only to rules genuinely still mid-construction at measurement time (ideally 0/0 on a settled page), with no visual change anywhere in the demo app. | manual |

---

## Verification

From `packages/lib`:

1. `npx vitest run tests/core/StyleRuleBatchedFlush.test.ts` — all cases (1-24) pass. Baseline before this change: 15 cases, all passing.
2. `npm run typecheck` — clean (baseline: 0 errors on this branch point).
3. `npm run typecheck:test` — clean.
4. `npm run lint` — clean (baseline: 0 errors on this branch point).
5. `npm run docs:api` — zero warnings; the new public `hasQueuedDeclarations()` method needs full JSDoc (see [Documentation Impact](#documentation-impact)).
6. `npm run test` (full suite) — no regressions elsewhere; `commitCSSRule()` and `materialiseDeferredRules()` are exercised broadly across the component tests, so a wrong guard would show up as missing CSS rather than only in the new file.
7. Case 25, manually, per [Expected Behaviour](#expected-behaviour) — confirm no visual change: borders, backgrounds, scrollbars, and hover/pressed chrome across the demo app's Button, Panel, and overlay-scrollbar showcases still render identically before and after.

---

## Documentation Impact

`StyleTarget` is exported as a value from the `core` barrel ([core/index.ts:43](packages/lib/src/typescript/lib/core/index.ts#L43)), so `hasQueuedDeclarations()` is a rendered, additive public member — it needs the full JSDoc shown in [Internal Structure](#internal-structure) and no doc *page* change (mirrors how the batched-flush plan treated `hasQueuedWrites()`). `commitCSSRule()`, `materialiseStyleRule()`, `materialiseDeferredRules()`, and `materialiseWhenNeeded()` are all `protected`/`private` and excluded from the rendered docs. `ARCHITECTURE.md`'s one-clause wording tweak (step 6) is the only prose page this plan touches.

---

## Potential Challenges

- **A subclass reads its own rule mid-`applyStyle`, before `materialiseStyleRule()` runs.** Unaffected: `getCSSRule()` still force-materialises unconditionally (see [Non-Goals](#non-goals)), so any such reader already gets a live rule regardless of this guard.
- **A component queues a real declaration, then clears it back to matching the baseline, all before first render.** The dirty bag is keyed by property name, so the second `.set(key, null)` simply overwrites the first entry — `hasQueuedDeclarations()` correctly sees only the final `null` and skips. No stale "was once real" state survives in the bag.
- **`commitCSSRule()` runs on every layout commit, not just the first.** For an already-materialised rule, `isMaterialized()` alone already passes the guard, so behaviour is unchanged from today: `ensure()` (a no-op once materialised) then `flush()` (a no-op on an empty bag) every time, same as before this fix.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/StyleTarget.ts](packages/lib/src/typescript/lib/core/StyleTarget.ts) — `StyleTarget` (`hasQueuedWrites`/`isMaterialized`, the pair this plan extends), `StyleRule.ensure`/`dispose`, and `disposeStyleRule`/`_ruleCache` (the disposal-safety guard this plan relies on, unchanged).
- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — `commitCSSRule` (1647), `setAutoCommitStyle` (1545), `materialiseStyleRule` (5018), `materialiseDeferredRules` (5031), `createStyleRule` (1009), and `destructor`'s rule-disposal block (871-879) — every site this plan touches or whose behaviour it must preserve.
- [packages/lib/src/typescript/lib/layout/LayoutManager.ts:509-533](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L509-L533) — `commitBounds`, read-only context for why `commitCSSRule()` fires on nearly every component; not modified.
- [packages/lib/src/typescript/lib/core/Panel.ts:1146-1208](packages/lib/src/typescript/lib/core/Panel.ts#L1146-L1208) — `removeOverlayScrollbars`/`setNativeScrollbarHidden`, read-only context for the scrollbar-rule repro shape `NullOnlyDeferredRuleProbe` mirrors; not modified.
- [plans/implemented/stylerule-batched-flush.md](implemented/stylerule-batched-flush.md) — the precedent this plan extends: introduced `hasQueuedWrites()`/`isMaterialized()`, `materialiseStyleRule()`, the `RuleProbe`/`DeferredRuleProbe` test harness, and the disposal-safety argument this plan reuses (its `[^teardown-noop]` footnote).
- [packages/lib/tests/core/StyleRuleBatchedFlush.test.ts](packages/lib/tests/core/StyleRuleBatchedFlush.test.ts) — the existing test file and conventions (`case N:` numbering, `RuleProbe`/`DeferredRuleProbe`, `RecordingDOMSink`, `_ruleCacheHas`) this plan's new cases extend.

---

## Non-Goals

- **`Button.ts` / `TabBar.ts` / `ClassStyleRules.ts`.** A separate, larger effort covers hoisting those classes' state-chrome rules onto shared class rules; see [Architecture Decisions](#architecture-decisions).
- **Simplifying `Panel`'s defensive `removeOverlayScrollbars()`-at-construction call.** It is what produces the null-only scrollbar deferred rule, but it is otherwise correct (idempotent, safe to call before anything exists) — this plan's guard makes the resulting empty rule never materialise, which removes the cost without needing to touch `Panel.ts`.
- **Tearing down a rule that *becomes* empty after carrying real content.** Out of scope, for the same reason the batched-flush plan gave: it needs a CSSOM read after every flush to detect, and would add a second removal path alongside `disposeStyleRule`. This plan only stops a rule from being inserted empty in the first place.
- **`getCSSRule()`'s always-materialise behaviour.** It is an explicit "give me the live rule now" accessor with no call sites in the library today; its contract is unrelated to the three implicit flush paths this plan gates.
- **Removing `hasQueuedWrites()`.** It has no remaining caller after this plan, but it is a public, documented, still-correct predicate on an exported class — kept as-is (see [Architecture Decisions](#architecture-decisions)).

---

## Notes

[^measurement]: Measured against the running dev server at `http://localhost:8015/#/misc` (serving the main tree; confirmed via `readlink /proc/<pid>/cwd`). Method: `navigate_page` with an `initScript` that wraps `CSSStyleSheet.prototype.insertRule` to record `{ rule, stack }` for every call, then a page script that scans `document.getElementById('Base').sheet.cssRules` for rules whose `style.length === 0`, matches each empty rule's selector back to its recorded insertion stack, and tallies which function name each stack passes through. Result: 178 empty plain rules, all via `commitCSSRule`; 6 empty `::-webkit-scrollbar` rules, all via `materialiseDeferredRules`; 0 via `materialiseStyleRule`. The original report (147 plain, 6 scrollbar) came from an earlier session on the same page — component count on this demo view depends on what's expanded/scrolled into existence, so the plain-rule count differs; the scrollbar count and the 100%/100%/0% call-site attribution were stable across both measurements.

[^keep-hasqueuedwrites]: `hasQueuedWrites()`'s only call site before this plan is `materialiseStyleRule()` ([Component.ts:5019](packages/lib/src/typescript/lib/core/Component.ts#L5019)), which this plan rewrites to use `materialiseWhenNeeded()` instead. That leaves `hasQueuedWrites()` with no caller in `packages/lib/src`, but it is exported (via `StyleTarget`) and documented as answering a real, distinct question — "is the bag non-empty" is a legitimate thing to ask independent of whether the entries are null. Deleting it would be removing working, public, correctly-documented API surface to chase a coverage number, not a change this plan's request calls for.

[^dry]: The alternative was inlining `rule.isMaterialized() || rule.hasQueuedDeclarations()` at each of the three call sites separately. Rejected because `commitCSSRule()` and `materialiseStyleRule()` end up with textually identical bodies (`materialiseWhenNeeded` then `flush()`) once written this way, and `materialiseDeferredRules()`'s loop body is the single-line guarded `ensure()` call — three copies of the same two-line condition is exactly the kind of duplication a one-line private helper removes without inventing a new abstraction layer over it.

[^teardown-noop]: `plans/implemented/stylerule-batched-flush.md`'s own `[^teardown-noop]` footnote traced this for the plain `_styleRule` case: `trackSelector()` runs at construction, `setId()`, and `createStyleRule()` — never from a materialisation path — so `_ownedSelectors` can hold a selector whose rule was never inserted, and both teardown routes (`destructor()`'s direct `dispose()` calls and the `FinalizationRegistry` callback) funnel into `disposeStyleRule()`, whose first line, `if (!_ruleCache.has(selector)) return;`, already handles a never-materialised selector safely. That argument covers `_deferredStyleRules` equally — `createStyleRule()` is the same `trackSelector()` call site for a deferred rule as for the main one — so this plan's new skip path (a deferred rule left unmaterialised because it only ever held a null-only bag) needs no new disposal logic, only this plan's cases 19 and 21 to confirm it offline.

[^missed-by-precedent]: `plans/implemented/stylerule-batched-flush.md`'s `## Potential Challenges` reasoned about `commitCSSRule()` already: "a call after render is a genuine per-instance deviation and *should* insert the rule" — reasoning about a setter firing after render, where a queued real value justifies the rule. It did not account for `setAutoCommitStyle(true)` firing on its own, with nothing queued, every time a layout manager commits a child's bounds (`LayoutManager.commitBounds()` wraps every child placement in `setAutoCommitStyle(false)` / `setAutoCommitStyle(true)`, regardless of whether anything was queued in between) — which is what this plan's measurement shows actually dominates the count.
