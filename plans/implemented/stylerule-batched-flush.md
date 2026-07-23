---
touches-shared:
  - packages/lib/src/typescript/lib/core/StyleTarget.ts
  - packages/lib/src/typescript/lib/core/DOM.ts
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/tests/dom/TestDOM.ts
  - ARCHITECTURE.md
---

# Batched `StyleRule` flush — Implementation Plan

## Overview

`StyleRule` writes one CSS declaration per sink call. Its sibling `InlineStyle` writes a whole bag in one call, and the abstract method's own doc comment records the split: *"the inline-style subclass batches the whole bag into one seam write; the rule subclass writes each property individually"* ([packages/lib/src/typescript/lib/core/StyleTarget.ts:112](packages/lib/src/typescript/lib/core/StyleTarget.ts#L112)). Every write into the framework's shared `<style id="Base">` sheet invalidates style for the whole document, so each of those calls makes the next forced style read re-run over the entire document.[^cost]

This plan makes a rule's declarations reach the stylesheet as **one sheet mutation per bag**. Three changes carry it. First, the seam gets a batched rule write — `DOMSink.setRuleStyles(rule, styles)` replaces the per-property `setRuleStyle`, mirroring how `DOMSink.apply(handle, { style })` already serves both the single and the bulk element-style path. Second, `Component.applyStyle` stops materialising its rule before it writes: it queues all 24 of its declarations into the dirty bag and materialises last, so the render path produces one batched flush instead of 24 write-throughs.[^where-the-calls-are]

Third, once the declarations are queued rather than written through, `applyStyle` can decide whether the rule is needed at all. It materialises the `#uuid` rule **only when the queued bag is non-empty**, so a component that contributes no declaration inserts no rule on the shared sheet. That attacks rule *count*, not just write count: the same wide-table window open that issued 138,004 declaration writes also grew the sheet to 6,768 rules from 5,904 components, and every rule on the sheet is work for each style recalc and for the `cssRules` walk a sibling plan is removing.[^rule-count]

The touched files are [core/DOM.ts](packages/lib/src/typescript/lib/core/DOM.ts) (seam), [core/StyleTarget.ts](packages/lib/src/typescript/lib/core/StyleTarget.ts) (both subclasses' terminal write, plus one new predicate), [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) (the `applyStyle` phases and its materialisation gate), and the offline test sink. `DOMSink` is exported from the `core` barrel ([packages/lib/src/typescript/lib/core/index.ts:14](packages/lib/src/typescript/lib/core/index.ts#L14)), so replacing a method on it is consumer-visible. **Release target: library 0.3.0** — `packages/lib/package.json` currently reads `0.2.0`; this plan does not bump it.

---

## Architecture Decisions

### One batched seam method replaces `setRuleStyle`

`DOMSink` gains `setRuleStyles(rule, styles)` and loses `setRuleStyle(rule, key, value)`. `StyleRule.writeStyle` wraps its single property as `{ [key]: value }`; `StyleRule.flushDirty` passes the bag straight through. The shape mirrors `InlineStyle`, whose single write is `DOM.sink.apply(target, { style: { [key]: value } })` and whose bag write is `DOM.sink.apply(target, { style: dirty })` ([core/StyleTarget.ts:350](packages/lib/src/typescript/lib/core/StyleTarget.ts#L350)).[^one-method]

### The production sink merges through a detached scratch declaration

`ProductionDOMSink.setRuleStyles` seeds a module-private, never-rendered scratch element's inline style with the rule's current `cssText`, replays each entry onto it with the existing `writeDeclaration` helper, then assigns the result back to the rule in a single `cssText` write. A single-entry bag skips the scratch and writes the declaration directly.[^scratch]

### `applyStyle` queues its declarations and materialises last

[`Component.applyStyle`](packages/lib/src/typescript/lib/core/Component.ts#L4336) currently calls `ensureCSSRule()` first, which materialises the rule and turns all 24 following `_styleRule.set` calls into individual sink writes. The six phase methods switch to `_styleRule.queue` / `queueMany`, and `applyStyle` materialises and flushes once at the end. Nothing observes the rule mid-`applyStyle`: `getCSSRule()` is the only reader and has no call sites in the library.[^reorder-safety]

### The rule is materialised only when a declaration was queued

`applyStyle`'s tail is a new `protected materialiseStyleRule()` on `Component`. It returns without touching the stylesheet when the dirty bag is empty, so a component that queued nothing gets no `#uuid` rule.[^gate-placement] `StyleTarget` gains a public `hasQueuedWrites()` predicate, sitting beside the existing `isMaterialized()`. It is how `Component` reads the bag, whose backing field is `protected` on `StyleTarget`.

| At the end of `applyStyle` | Bag | Result |
|---|---|---|
| Any component today | `position`, `margin`, … (24 keys) | rule inserted, one `setRuleStyles` carrying the 24 |
| Already-rendered component, re-render | same 24 keys, re-queued | no new rule, one `setRuleStyles` |
| A component whose phases all skip | empty | **no `insertRule`, no `setRuleStyles`** |

The empty row is unreachable for a stock `Component` today — `position` and `margin` are written unconditionally. It becomes the common case once [`plans/class-scoped-style-rules.md`](class-scoped-style-rules.md) hoists the thirteen always-written declarations onto per-class rules; that plan hands the rule-removal half to this one. The two plans are independent and land in either order.[^composes-with-hoist]

A component that writes a declaration *after* an empty render still gets its rule, through machinery that already exists and needs no edit: `setElementCSSRule` calls `StyleTarget.queue`, which always writes to the bag, and `commitCSSRule` then calls `ensure()` + `flush()`, materialising on that first later write.[^deferred-materialisation]

Three things could have been broken by making materialisation conditional, and none is. `ensureCSSRule()`'s only other caller is `getCSSRule()`, which hands a caller the live rule object and must therefore keep materialising on demand.[^ensure-callers] Teardown is safe: a component tracks its rule selector at construction whether or not the rule ever exists, and `disposeStyleRule` returns before reaching the seam when the selector is not in the module rule cache — which is exactly the never-materialised case.[^teardown-noop] The deferred state rules (`:hover`, `:active`, `.selected`) are a **separate path** and are deliberately untouched: `materialiseDeferredRules` keeps calling `ensure()` on every entry of `_deferredStyleRules`, because a deferred rule exists only when a subclass asked for one through `createStyleRule` and wrote a body into it.[^deferred-rules-untouched]

### A flush with nothing queued reaches no seam

`StyleRule.flushDirty` returns early on an empty bag. Without that guard, `materialiseStyleRule`'s `ensure()` (which flushes) followed by `flush()` (which finds the bag already drained) would record a second, empty `setRuleStyles` op, and `## Expected Behaviour` cases 6 and 10 would be unassertable. Production behaviour is identical either way — `ProductionDOMSink.setRuleStyles` already returns on a zero-key bag — so only the recorded op stream changes.

### Rule-write assertions read through one test helper

`RecordingDOMSink` records `setRuleStyles` with the rule's selector and the bag. The existing thirteen assertion sites that scan for `op === 'setRuleStyle'` route through a new exported helper `ruleStyleWrites(sink)`, which flattens every recorded bag into one `{ selector, key, value }` row per declaration. Assertions keep their current key/value shape and stop depending on how many declarations share a write.

---

## Public API

```typescript
// core/DOM.ts — DOMSink. Replaces `setRuleStyle(rule, key, value)`.
setRuleStyles(rule: CSSStyleRule, styles: Record<string, string | null>): void;
```

```typescript
// core/DOM.ts — ProductionDOMSink implements the above.
setRuleStyles(rule: CSSStyleRule, styles: Record<string, string | null>): void
```

```typescript
// core/StyleTarget.ts — StyleTarget. New public predicate, beside isMaterialized().
hasQueuedWrites(): boolean;
```

```typescript
// core/Component.ts — new protected member, the last applyStyle phase.
protected materialiseStyleRule(): void;
```

```typescript
// tests/dom/TestDOM.ts — test-only helper, exported alongside RecordingDOMSink.
export function ruleStyleWrites(
    sink: RecordingDOMSink
): Array<{ selector: string; key: string; value: string | null }>
```

No new options-bag field, no new component setter: `StyleRule` / `InlineStyle` keep their existing `set` / `setMany` / `queue` / `queueMany` / `flush` surface unchanged, and `hasQueuedWrites()` only reads.

---

## Internal Structure

`ProductionDOMSink.setRuleStyles`, and the module-private scratch declaration it borrows:

```typescript
// Module-private, never appended to the document: a detached element whose
// inline style is a real CSSStyleDeclaration. Writing to it costs nothing at
// the document level, so a bag can be merged property-by-property here and
// land on the shared sheet as one mutation.
let _scratch: CSSStyleDeclaration | null = null;

function scratchDeclaration(): CSSStyleDeclaration | null {
    if (typeof document === "undefined") {
        return null;
    }

    return _scratch ??= document.createElement("div").style;
}
```

```typescript
setRuleStyles(rule: CSSStyleRule, styles: Record<string, string | null>): void {
    const keys = Object.keys(styles);

    if (keys.length === 0) {
        return;
    }

    const scratch = keys.length === 1 ? null : scratchDeclaration();

    // One declaration is already one mutation, and the headless path (no
    // document, so no scratch element) falls back to the same direct writes.
    if (!scratch) {
        for (const key of keys) {
            writeDeclaration(rule.style, key, styles[key]);
        }

        return;
    }

    scratch.cssText = rule.style.cssText;

    for (const key of keys) {
        writeDeclaration(scratch, key, styles[key]);
    }

    rule.style.cssText = scratch.cssText;
}
```

`StyleRule`'s two terminal writes collapse onto the one seam method, and an empty bag stops before the seam:

```typescript
protected writeStyle(key: string, value: string | null): void {
    DOM.sink.setRuleStyles(this._target!, { [key]: value });
}

protected flushDirty(dirty: Record<string, string | null>): void {
    if (Object.keys(dirty).length === 0) {
        return;
    }

    DOM.sink.setRuleStyles(this._target!, dirty);
}
```

`StyleTarget`'s new predicate, next to `isMaterialized()`:

```typescript
/**
 * Returns whether any write is waiting in the dirty bag. Owners that decide
 * whether the target is worth materialising at all read this first.
 */
hasQueuedWrites(): boolean {
    return Object.keys(this._dirty).length > 0;
}
```

`Component.materialiseStyleRule`, the new last phase of `applyStyle`:

```typescript
/**
 * Materialises this component's `#id` stylesheet rule and drains the queued
 * declarations into it — the final `applyStyle` phase before the deferred
 * state rules.
 *
 * @remarks Skipped entirely when the phases queued nothing: a component that
 * contributes no declaration gets no rule on the shared stylesheet, and none
 * is needed until a later setter writes one. `ensure()` flushes the bag on
 * first materialisation; the `flush()` after it covers the re-render case,
 * where the rule already exists and `ensure()` returns it without draining.
 */
protected materialiseStyleRule(): void {
    if (!this._styleRule.hasQueuedWrites()) {
        return;
    }

    this.ensureCSSRule();
    this._styleRule.flush();
}
```

`Component.applyStyle`'s new tail (replacing the `ensureCSSRule()` call at the top):

```typescript
this.applyMiscInlineStyles();

// Materialise last: every phase above queued into the dirty bag, so the whole
// rule body reaches the stylesheet as one write — or none, if the bag is empty.
this.materialiseStyleRule();

this.materialiseDeferredRules();
```

---

## Ordered Implementation Steps

Test-first: steps 1–2 write failing tests, steps 3–7 make them pass.

1. **Add the test helper.** In [packages/lib/tests/dom/TestDOM.ts](packages/lib/tests/dom/TestDOM.ts), export `ruleStyleWrites(sink)` per `## Public API`. It filters `sink.writes` for `op === 'setRuleStyles'`, and for each expands `args[1]` (the bag) into one row per key, carrying `args[0]` as `selector`. Rows keep bag insertion order; bags keep recording order.

2. **Write the new test file** `packages/lib/tests/core/StyleRuleBatchedFlush.test.ts`, covering every case in `## Expected Behaviour` marked *unit*, including the `RuleProbe` subclass defined there. Copy the harness preamble (`DOM_CONFIG`, `installTestDOM`, `beforeEach` / `afterEach` with `DOM.reset()`) from [tests/component/Component.test.ts:1-20](packages/lib/tests/component/Component.test.ts#L1-L20). Use a distinct selector name per case that constructs a bare `StyleRule` — `_ruleCache` is module state surviving `DOM.reset()`, so a reused name hides the `ensureStyleRule` op (the same caution [tests/core/StyleTarget.test.ts:31-36](packages/lib/tests/core/StyleTarget.test.ts#L31-L36) documents); component `#uuid` selectors are unique per instance and need no such care. Run the suite; every new case must fail.

3. **Swap the seam method.** In [core/DOM.ts](packages/lib/src/typescript/lib/core/DOM.ts): replace the `DOMSink.setRuleStyle` declaration (line 504) with `setRuleStyles`, keeping the doc comment's "a `CSSStyleRule` has no element, so it gets its own method" point and adding that the bag lands as one sheet mutation. Replace `ProductionDOMSink.setRuleStyle` (line 1372) with the body in `## Internal Structure`, and add the `_scratch` / `scratchDeclaration()` module privates next to the existing `writeDeclaration` helper (line 295).

4. **Route `StyleRule` through it, and add the predicate.** In [core/StyleTarget.ts](packages/lib/src/typescript/lib/core/StyleTarget.ts), replace `StyleRule.writeStyle` (line 305) and `StyleRule.flushDirty` (line 310) with the two bodies in `## Internal Structure` — `flushDirty` includes the empty-bag early return. Add `hasQueuedWrites()` from `## Internal Structure` to `StyleTarget`, immediately after `isMaterialized()` (lines 88-90). Update the abstract `flushDirty` doc comment (line 109-116) — both subclasses now batch the bag into one seam write — and the `writeStyle` doc's `{@link DOMSink.setRuleStyle}` reference (line 101) to `setRuleStyles`.

5. **Update the recording sink.** In [tests/dom/TestDOM.ts:383](packages/lib/tests/dom/TestDOM.ts#L383), replace `setRuleStyle` with:

   ```typescript
   setRuleStyles(rule: CSSStyleRule, styles: Record<string, string | null>): void {
       this.record('setRuleStyles', (rule as { selectorText?: string }).selectorText ?? '', styles);
   }
   ```

6. **Queue the `applyStyle` phases.** In [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts), inside the six phase methods only, change every `this._styleRule.set(` to `this._styleRule.queue(` and the one `this._styleRule.setMany(` to `queueMany(` — lines 4367, 4370, 4379, 4381, 4386, 4391, 4396, 4401, 4406, 4453, 4454, 4459, 4460, 4472, 4476, 4492 (`setMany`), 4494, 4499, 4504, 4509, 4520, 4552, 4557, 4565. Leave every `this._inlineStyle.set` untouched. Checkpoint: `grep -n '_styleRule\.set' packages/lib/src/typescript/lib/core/Component.ts` — expect zero matches.

7. **Move the materialisation behind the gate.** In [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts), add `materialiseStyleRule()` from `## Internal Structure` directly above `materialiseDeferredRules` (line 4572), with the JSDoc shown there. Then in `applyStyle` ([core/Component.ts:4336](packages/lib/src/typescript/lib/core/Component.ts#L4336)) delete the `this.ensureCSSRule();` call and its four-line comment at the top, and insert `this.materialiseStyleRule();` between `applyMiscInlineStyles()` and `materialiseDeferredRules()`. Leave `materialiseDeferredRules` itself alone — the deferred state rules are a separate path and keep materialising unconditionally. Run the new test file; it must now pass.

8. **Migrate the existing assertions** to `ruleStyleWrites`, at: [tests/component/Component.test.ts:157,158,168,169](packages/lib/tests/component/Component.test.ts#L157), [tests/component/EffectiveVisibility.test.ts:80,115,198,204,238,244](packages/lib/tests/component/EffectiveVisibility.test.ts#L80), [tests/core/PanelOverlayScrollbar.test.ts:104,168,197](packages/lib/tests/core/PanelOverlayScrollbar.test.ts#L104), [tests/component/input/Link.test.ts:80](packages/lib/tests/component/input/Link.test.ts#L80). Each `w.op === 'setRuleStyle' && w.args[0] === K && w.args[1] === V` becomes `w.key === K && w.value === V` over `ruleStyleWrites(sink)`. Checkpoint: `grep -rn "setRuleStyle\b" packages/lib/src packages/lib/tests` — expect zero matches (only `setRuleStyles` survives).

9. **Update the seam doc.** [packages/lib/docs/concepts/dom-seams.md:67](packages/lib/docs/concepts/dom-seams.md#L67) names `setRuleStyle` — rename it to `setRuleStyles` in place; the sentence's point (a `CSSStyleRule` is not an element and carries no handle) still holds.

10. **Update the two prose statements the gate makes stale.** In `applyStyle`'s own JSDoc ([core/Component.ts:4327-4334](packages/lib/src/typescript/lib/core/Component.ts#L4327)), say that the component's rule is inserted only when a declaration was queued — in prose, with no `{@link}` to the new protected method. In [ARCHITECTURE.md](ARCHITECTURE.md)'s *Defer DOM work to render time* section, extend the *Component CSS rule* bullet the same way. Leave its "Never call `ensureCSSRule()` from a setter" sentence as it stands; it is still the rule.

11. **Run the full verification list** in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/core/StyleTarget.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Create | `packages/lib/tests/core/StyleRuleBatchedFlush.test.ts` |
| Modify | `packages/lib/tests/component/Component.test.ts` |
| Modify | `packages/lib/tests/component/EffectiveVisibility.test.ts` |
| Modify | `packages/lib/tests/core/PanelOverlayScrollbar.test.ts` |
| Modify | `packages/lib/tests/component/input/Link.test.ts` |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |
| Modify | `ARCHITECTURE.md` |

---

## Expected Behaviour

Two contracts, both asserted as recorded-op counts rather than declaration counts. **One seam write per bag**: assert the number of recorded `setRuleStyles` ops and the content of the bag; never assert "24 writes". **No rule without a declaration**: assert the presence or absence of an `ensureStyleRule` op carrying the component's `#<id>` selector, which `RecordingDOMSink` records verbatim ([tests/dom/TestDOM.ts:387](packages/lib/tests/dom/TestDOM.ts#L387)); never assert a total rule count.

Cases 11-15 need a component whose `applyStyle` queues nothing, which no stock `Component` produces (`position` and `margin` are unconditional). The test file declares one, following the `class Probe extends _Component` pattern at [tests/core/ElementAttributeReplay.test.ts:39](packages/lib/tests/core/ElementAttributeReplay.test.ts#L39) — a subclass that overrides the public `applyStyle` to run the materialisation gate and nothing else, plus a passthrough to the protected setter:

```typescript
/** Renders with an empty rule bag: `applyStyle` runs only the materialisation gate. */
class RuleProbe extends _Component {
    override applyStyle(element: Handle): this {
        DOM.sink.apply(element, { removeAttr: ['style'] });
        this.materialiseStyleRule();

        return this;
    }

    rule(key: string, value: string | null): this { return this.setElementCSSRule(key, value); }
}
```

| # | Case | Expected | How |
|---|---|---|---|
| 1 | **Queue then materialise.** New `StyleRule({ materialize: false })`, `set('color','red')`, `set('display','block')`, `set('margin','0px')`, then `ensure()`. | Exactly one `setRuleStyles` op for that selector, bag `{ color: 'red', display: 'block', margin: '0px' }`. | unit |
| 2 | **Write-through after materialise.** Same rule, after `ensure()`, `set('color','blue')`. | One further `setRuleStyles` op, bag `{ color: 'blue' }` — a post-materialise write still reaches the sink immediately, in order. | unit |
| 3 | **Later write overrides an earlier key.** Before `ensure()`: `set('color','red')` then `set('color','blue')`. | One op whose bag is exactly `{ color: 'blue' }` — one entry, not two. | unit |
| 4 | **`null` removes.** Before `ensure()`: `set('border','1px solid red')` then `set('border', null)`. | One op, bag `{ border: null }`. The removal is not dropped and does not become a second op. | unit |
| 5 | **`autoCommitStyle` window.** Rendered component; `setAutoCommitStyle(false)`, three `setElementCSSRule` calls, `setAutoCommitStyle(true)`. | Exactly one `setRuleStyles` op for `#<id>` across the window, carrying all three declarations. | unit |
| 6 | **First render.** `component.getElement(true)` on a fresh `Component`. | Exactly one `setRuleStyles` op for `#<id>` — the whole `applyStyle` body arrives as one bag. It contains `position` and `margin` (written unconditionally by the phases). | unit |
| 7 | **Re-render.** Call `sync()` on an already-rendered component. | One further `setRuleStyles` op for `#<id>`, not one per declaration — the batching does not depend on the rule being fresh. | unit |
| 8 | **Deferred state rules.** A test-local `Component` subclass whose constructor calls `this.createStyleRule('.probe').setMany({ color: 'red', display: 'block' })`, then `getElement(true)`. | Exactly one `setRuleStyles` op for `#<id>.probe`, carrying both declarations — the deferred rule materialises at the end of `applyStyle` and flushes as one bag. | unit |
| 9 | **Ordering across a flush boundary.** Queue `color: red`, `ensure()`, then `set('color','blue')`. | Two ops in that order: `{ color: 'red' }` then `{ color: 'blue' }`. The queued value never re-applies after the later write. | unit |
| 10 | **Empty bag.** `flush()` on a materialised rule with nothing dirty. | No `setRuleStyles` op recorded. | unit |
| 11 | **An empty bag inserts no rule.** `new RuleProbe().getElement(true)`. | **No** `ensureStyleRule` op whose selector is `#<id>`, and no `setRuleStyles` op for it. `_ruleCacheHas('#' + probe.getId())` from `~/core/StyleTarget` is `false` — the auto-generated id needs no CSS escaping, so the selector is the plain concatenation. | unit |
| 12 | **One declaration inserts exactly one rule with exactly one declaration.** `const p = new RuleProbe(); p.rule('color', 'red'); p.getElement(true)`. | Exactly one `ensureStyleRule` op for `#<id>`, and exactly one `setRuleStyles` op for it, bag `{ color: 'red' }`. | unit |
| 13 | **A setter after an empty render materialises then.** Case 11, then `probe.rule('color', 'blue')`. | Before the setter: no `ensureStyleRule` for `#<id>`. After it: exactly one `ensureStyleRule` for `#<id>` and one `setRuleStyles`, bag `{ color: 'blue' }`. | unit |
| 14 | **Teardown of an unmaterialised rule is a clean no-op.** Case 11, then `probe.destructor()`. | No `deleteStyleRule` op for `#<id>` is recorded, and no throw. `_ruleCacheHas('#' + id)` stays `false`. | unit |
| 15 | **The gate does not mis-fire on a stock component.** `new Component({}).getElement(true)`. | Exactly one `ensureStyleRule` op for `#<id>` — an ordinary component still gets its rule, because its phases always queue `position` and `margin`. | unit |
| 16 | **Shorthand removal in the browser.** A rule carrying `border: 1px solid red`, then a bag containing `border: null` plus another property. | The rendered rule has no border at all — removing a shorthand clears its longhands, exactly as the per-property write did. | manual |
| 17 | **Visual parity.** The app renders identically before and after. | No change to borders, min/max sizing, visibility, padding, or overflow anywhere in the demo app. | manual |

Cases 16 and 17 cannot be automated: the offline `RecordingDOMSink` returns a stub rule whose `style` is a plain object, so no test exercises the real `cssText` merge. Verify both in the browser per `## Verification`.

---

## Verification

From `packages/lib`:

1. `npx vitest run --no-file-parallelism` — `Tests N passed` is **not** sufficient. Check the `Errors` line reads zero and the process exit code is `0`.
2. `npm run typecheck` — must report exactly the 7 known pre-existing errors, no more.
3. `npm run typecheck:test` — clean.
4. `npm run lint` — clean (the `local/no-raw-dom` rule has an empty baseline; the new `document.createElement` lives inside `core/DOM.ts`, the one module allowed to touch raw DOM).
5. `grep -rn "setRuleStyle\b" packages/lib/src packages/lib/tests packages/lib/docs` — zero matches.
6. `grep -n "_styleRule\.set" packages/lib/src/typescript/lib/core/Component.ts` — zero matches.
7. `grep -n "ensureCSSRule()" packages/lib/src/typescript/lib/core/Component.ts` — matches only in `getCSSRule`, in `materialiseStyleRule`, and in the method's own definition. No call remains at the top of `applyStyle`.
8. Manual, browser (`npm run dev`, http://localhost:8015): open the wide-table demo panel and the Button/Tab demos. Confirm cases 16 and 17 — components keep their borders, sizes, and visibility, and a `Button` still changes appearance on hover and press. In DevTools, inspect the `<style id="Base">` sheet and confirm a component's `#id` rule carries the same declarations it did before the change. Also read `document.getElementById('Base').sheet.cssRules.length` after opening the wide-table demo and confirm it has not *grown* — the gate never fires for a stock component, so the count should match the pre-change build.

---

## Documentation Impact

`DOMSink` is exported as a type from the `core` barrel ([core/index.ts:14](packages/lib/src/typescript/lib/core/index.ts#L14)), so replacing `setRuleStyle` with `setRuleStyles` is a breaking change for anyone implementing the interface — it belongs in the 0.3.0 release notes. The only prose page naming the method is [packages/lib/docs/concepts/dom-seams.md:67](packages/lib/docs/concepts/dom-seams.md#L67) (step 9).

Two further notes for the same release:

- `StyleTarget` is exported from the `core` barrel ([core/index.ts:39](packages/lib/src/typescript/lib/core/index.ts#L39)), so `hasQueuedWrites()` is a rendered, additive public member. It needs full JSDoc and no doc page changes.
- `Component.materialiseStyleRule` is `protected` and therefore excluded from the rendered docs. Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), the public `applyStyle` JSDoc must describe the conditional materialisation **in prose** and must not `{@link}` the new method.

[`ARCHITECTURE.md`](ARCHITECTURE.md)'s *CSS writes go through `StyleRule` / `InlineStyle`* section describes the buffers, not the seam method, and needs no edit. Its *Defer DOM work to render time* bullet does (step 10): "`applyStyle` flushes at render" becomes "`applyStyle` flushes at render, and inserts the rule only when something was queued". Run `npm run docs:build` after the JSDoc edits in steps 3–4 and 7; it must finish with zero warnings.

---

## Potential Challenges

- **A subclass `applyStyle` override that reads the rule mid-pass** would now see an unmaterialised rule. None exists: the four overrides ([Legend](packages/lib/src/typescript/lib/component/container/Legend.ts#L52), [Text](packages/lib/src/typescript/lib/component/input/Text.ts#L1247), [TabBar's indicator](packages/lib/src/typescript/lib/component/container/TabBar.ts#L280), [ListItem](packages/lib/src/typescript/lib/component/list/ListItem.ts#L76)) all call `super.applyStyle` first — after which the rule is materialised and flushed, or (empty bag) absent — or are a no-op. A subclass that writes after `super.applyStyle` goes through `setElementCSSRule`, which materialises the rule if the gate declined to.
- **The scratch element must never be attached.** Appending it to the document would make its style writes cost what the change is removing. It is created detached and only `document.createElement` is called on it; no `appendChild`.
- **A headless environment has no `document`.** `scratchDeclaration()` returns `null` and the per-property fallback runs, matching the guard `ProductionDOMSink.deleteStyleRule` already uses ([core/DOM.ts:1400](packages/lib/src/typescript/lib/core/DOM.ts#L1400)).
- **Two `StyleRule` instances can share one `CSSStyleRule`** through the module cache. The merge reads the live declaration each time rather than a locally-held copy, so the second instance's write never discards the first's declarations.
- **A sibling plan edits `ensureStyleRule` in the same two files.** Coordinate by landing one before the other; the two changes touch different methods (`ensureStyleRule` vs `setRuleStyle`) and do not conflict semantically.
- **`getCSSRule()` still materialises, so an external caller can defeat the gate.** That is correct — it returns the live `CSSStyleRule`, which has to exist. It is `protected` with no call site in the library, so nothing defeats the gate today.
- **A setter that fires after render materialises the rule anyway.** Roughly 94 `setElementCSSRule` / `setElementCSSRules` call sites exist across the library; most run during construction, where `commitCSSRule` returns early because there is no element yet. A call after render is a genuine per-instance deviation and *should* insert the rule. So the rule-count saving is bounded by how many components write nothing after render, not by the gate itself.
- **The gate cannot be exercised by a stock component.** No `Component` produces an empty bag today, which is why `## Expected Behaviour` cases 11-15 use a `RuleProbe` subclass that overrides `applyStyle`. That subclass is the only offline proof of the empty branch; do not replace it with an assertion on a real component's rule count.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/StyleTarget.ts](packages/lib/src/typescript/lib/core/StyleTarget.ts) — `StyleTarget` (the buffer contract: `set` / `queue` / `flush` / `materialize`), `StyleRule`, and `InlineStyle`, the precedent this change copies.
- [packages/lib/src/typescript/lib/core/DOM.ts](packages/lib/src/typescript/lib/core/DOM.ts) — the `DOMSink` interface, `ProductionDOMSink`, and the `writeDeclaration` helper (line 295) that both the old and new paths use as the terminal declaration write.
- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — `applyStyle` and its six phase methods (lines 4336-4581), plus `setElementCSSRule` / `commitCSSRule` / `setAutoCommitStyle` (lines 1399-1482), the existing batching gate.
- [packages/lib/tests/dom/TestDOM.ts](packages/lib/tests/dom/TestDOM.ts) — `RecordingDOMSink`; note `ensureStyleRule` returns a stub `{ selectorText, style: {} }`, so nothing offline exercises the real merge.
- [packages/lib/src/typescript/lib/core/StyleTarget.ts:161-207](packages/lib/src/typescript/lib/core/StyleTarget.ts#L161) — `_ruleCache` (161), `_ruleFor`, `disposeStyleRule` (202), and the `@internal` `_ruleCacheHas` the new tests read. This is where the never-materialised selector becomes a safe no-op on teardown.
- [packages/lib/tests/core/StyleTarget.test.ts](packages/lib/tests/core/StyleTarget.test.ts) — the existing `StyleRule` suite and its module-cache isolation caution.
- [packages/lib/tests/core/ElementAttributeReplay.test.ts:39-43](packages/lib/tests/core/ElementAttributeReplay.test.ts#L39) — the `class Probe extends _Component` pattern the new `RuleProbe` copies: a test-local subclass of the raw class alias exposing protected methods as public passthroughs.

---

## Non-Goals

- **Tearing a rule down when it becomes empty.** A rule that never receives a declaration is already handled — the gate never inserts it. A rule that *becomes* empty after carrying declarations is a different case, and removing it automatically is a bad trade. A component toggling one conditional declaration would insert and delete a sheet rule on every toggle, and every insert or delete invalidates style for the whole document — the exact cost this workstream exists to remove. Detecting emptiness needs a CSSOM read after each flush, which is the read-after-write pattern that forces the recalc. Deletion is not free even with the sibling plan's index, because `deleteRule` takes a position and the position still needs an identity walk. And it would add a second removal path that has to stay consistent with `disposeStyleRule`, the module `_ruleCache`, and the GC finalizer. Worth revisiting only if profiling shows a large population of rules that go empty and stay empty — and then as a periodic sweep, not an eager per-flush check.
- **Hoisting class-uniform declarations into class-scoped rules.** [`plans/class-scoped-style-rules.md`](class-scoped-style-rules.md) owns reducing how many declarations each component writes. This plan owns how many sink calls a given set of declarations costs, and whether a rule is inserted for an empty set — including the case that plan hands over, a component that deviates from its class defaults in nothing.
- **The `O(N²)` `ensureStyleRule` selector scan.** A sibling plan owns it. Leave `ensureStyleRule` untouched beyond the doc rename.
- **Making `_defaultOptions` per-class.** Out of scope entirely.
- **Batching `StyleTarget.setMany` when the target is already materialised.** It would help module-level shared class rules, but those are a one-time cost per class and it would change `InlineStyle`'s recorded write shape for no measured gain.[^setmany]
- **Batching the `_inlineStyle` writes in `applyStyle`.** Inline styles are element-scoped and do not invalidate the whole document, so they are not part of the measured problem.
- **Bumping the package version.** The 0.3.0 target is recorded here; the bump happens at release.

---

## Notes

[^cost]: Measured on the built 45-column × 400-row table demo (~7,000 elements, ~7,000 rules). Isolated cost of a text-measurement probe read after different write shapes: probe alone 0.10 ms; a new `#id` rule plus 24 separate declaration writes 139.5 ms; one `insertRule` carrying the same 24 declarations 5.8 ms. That build issued 138,004 `setRuleStyle` calls. The numbers come from an environment with inflated timings, so treat them as a ratio — roughly 24× of the mutation cost recovered by collapsing 24 mutations into one — not as a wall-clock prediction.

[^where-the-calls-are]: The 138,004 figure is dominated by the write-through path, not the queued-flush path. `applyStyle` calls `ensureCSSRule()` on its first line ([core/Component.ts:4344](packages/lib/src/typescript/lib/core/Component.ts#L4344)), so the rule is materialised before any of the 24 phase writes run — every one of them takes `StyleTarget.set`'s write-through branch and becomes its own sink call. The queued-flush path carries only what a component queued during construction, before its first render. This is why batching `flushDirty` alone would recover little: without the reorder in `applyStyle`, the render path never uses the bag.

[^one-method]: The rejected alternative was keeping `setRuleStyle` and adding `setRuleStyles` beside it. `DOMSink.apply`'s own doc records the house style — it "replaces the ten per-write data setters" for elements — so a seam with both a single-property and a bulk rule write would reintroduce exactly the split this change removes, and would leave two recorded op shapes for tests to handle. The single-property cost is unchanged either way, because `setRuleStyles` short-circuits a one-key bag to a direct `writeDeclaration`.

[^scratch]: The rejected alternative was merging by hand: read the live declaration into a `Map` via `decl.item(i)` / `getPropertyValue`, apply the bag, and re-serialise. It breaks on shorthand removal, which the framework does on every render — `applyChromeStyles` writes `border: null` when a component has no border ([core/Component.ts:4494](packages/lib/src/typescript/lib/core/Component.ts#L4494)). A declaration block enumerates a set `border` as its longhands, so `merged.delete("border")` would delete nothing and the longhands would survive. Seeding a real `CSSStyleDeclaration` and replaying through `writeDeclaration` inherits the browser's own shorthand, custom-property, `!important`, and empty-string-removal semantics for free, and keeps exactly one mutation on the shared sheet. A third option — `deleteRule` plus `insertRule` with the full body, which is what the measurement used — was rejected because it mints a new `CSSStyleRule` object, and `_ruleCache` in `core/StyleTarget.ts` holds the old one; every `StyleRule` sharing that selector would then write to a rule no longer on the sheet.

[^reorder-safety]: Three things could have made the reorder unsafe, and none applies. (1) A reader of the live rule during `applyStyle`: `getCSSRule()` is the only accessor and `grep -rn "getCSSRule()"` finds no call site outside its own definition. (2) Ordering between a queued and a written-through value for the same key: `_dirty[key] = value` is last-write-wins in write order, which is the same result the sequential write-throughs produced. (3) A subclass writing rule styles after `super.applyStyle`: those go through `setElementCSSRule`, which queues and then commits — landing after the base flush, in the same order as today.

[^rule-count]: From the same profiling run as the write-count figure: 5,904 `ensureStyleRule` calls during one wide-table window open, against a sheet that reached 6,768 rules. Rule count and write count are separate costs. A write dirties the document's style; a *rule* is permanent work — every style recalc resolves it against the elements it might match, and the `cssRules` walk that [`plans/stylesheet-rule-lookup-map.md`](stylesheet-rule-lookup-map.md) removes is linear in it. The two plans attack the same growth from opposite ends: that one makes finding a rule cheap, this one stops some rules from being created. Both figures come from a timing-inflated environment, so no wall-clock speedup is promised.

[^gate-placement]: Three placements were considered. Inside `StyleRule.ensure()` — rejected, because `ensure()`'s contract is to return a `CSSStyleRule` and it has nothing to return when it declines. Inline in `applyStyle` — rejected only for testability: no stock `Component` produces an empty bag (`position` and `margin` are unconditional), so the empty branch would be unreachable from any offline test, and the plan would ship an untested branch that the class-hoist plan then turns into the common path. A `protected` method is the smallest seam that lets a test-local subclass override `applyStyle` and run the gate with nothing queued, and it costs no public API — the docs build excludes `protected` members. It also matches the shape of the phase it sits beside, the private `materialiseDeferredRules`.

[^composes-with-hoist]: After the class-hoist lands, the thirteen always-written declarations move to a `.ClassName` rule and an instance only writes what it deviates in. A component with no deviation then reaches `materialiseStyleRule` with an empty bag and inserts nothing — which is why that plan lists "removing the per-instance rule for components that deviate in nothing" as out of its scope and hands it here. Order does not matter: with the hoist first, the gate starts firing the moment it lands; with this plan first, the gate is inert until the hoist lands. Neither plan needs the other to be correct.

[^deferred-materialisation]: Traced through the live code. `setElementCSSRule` ([core/Component.ts:1450](packages/lib/src/typescript/lib/core/Component.ts#L1450)) calls `this._styleRule.queue(key, value)`, and `queue` writes `_dirty[key]` unconditionally — it never consults `_target`, so it cannot be lost by the rule being absent. `setElementCSSRules` does the same through `queueMany`. Both then call `commitCSSRule` when auto-commit is on; `commitCSSRule` returns early when the component has no element, and otherwise calls `this._styleRule.ensure()` followed by `this._styleRule.flush()` ([core/Component.ts:1468-1483](packages/lib/src/typescript/lib/core/Component.ts#L1468)). `ensure()` materialises through `_ruleFor` and flushes the bag in the same call; the following `flush()` finds it drained and, with the new empty-bag guard, reaches no seam. So the first post-render write materialises the rule and lands in it, with no edit to any of those three methods. The same holds for the deliberately-batched window: `setAutoCommitStyle(false)` … `setAutoCommitStyle(true)` ends in `commitCSSRule`, which takes the identical path.

[^ensure-callers]: `grep -n "ensureCSSRule()"` over `packages/lib/src` returns three lines in one file: the definition ([core/Component.ts:881](packages/lib/src/typescript/lib/core/Component.ts#L881)), the call in `getCSSRule` (867), and the call at the top of `applyStyle` (4344) that this plan removes. `getCSSRule` is `protected` and has no call site anywhere in the library or the tests, so no code path depends on `applyStyle` having materialised the rule eagerly. `commitCSSRule` and `materialiseDeferredRules` do not go through `ensureCSSRule` at all — they call `StyleRule.ensure()` on their own rule objects.

[^teardown-noop]: `trackSelector` is called from the constructor ([core/Component.ts:484](packages/lib/src/typescript/lib/core/Component.ts#L484)), from `setId` (1506), and from `createStyleRule` (914) — never from a materialisation path. So `_ownedSelectors` can and will hold a selector whose rule was never inserted. Both teardown paths funnel into the same function: the eager `destructor` calls `this._styleRule.dispose()` (789), which calls `disposeStyleRule(this._selector)`; the `FinalizationRegistry` (296) calls `disposeStyleRule(selector)` for each tracked selector. `disposeStyleRule`'s first line is `if (!_ruleCache.has(selector)) return;` ([core/StyleTarget.ts:203](packages/lib/src/typescript/lib/core/StyleTarget.ts#L203)). `_ruleCache` is written in exactly one place, `_ruleFor`, which is reached only through a `StyleRule`'s factory inside `ensure()`. A never-materialised selector is therefore never a `_ruleCache` key, and the dispose returns before `DOM.sink.deleteStyleRule` — no sink op, no `cssRules` walk, no throw. The guard already covers this case; it needs no change. One shared-selector caveat, unchanged by this plan: `_ruleCache` is keyed by selector text, so if a *different* `StyleRule` had materialised the same selector, dispose would delete that rule. Component `#uuid` selectors are unique per instance, so this does not arise for the rule the gate governs.

[^deferred-rules-untouched]: Every `createStyleRule` call site in the library either writes a body immediately (`Header`, `Panel`, `CollapseButton`, `AccordionIndicator`, and the `styleRules` option relay at [core/Component.ts:612](packages/lib/src/typescript/lib/core/Component.ts#L612)) or is a lazy getter whose callers write through it (`Button`'s `:active` / `:hover`, `ToggleButton`'s `.selected`, `DiagramNode`, `WindowBorder`, `RailHandle`). A deferred rule with an empty body is therefore not a shape the library produces, and gating `materialiseDeferredRules` the same way would add a branch with nothing to skip. Leaving it alone also keeps the change to `applyStyle`'s tail one decision rather than two.

[^setmany]: `StyleTarget.setMany` loops `set` per key, so on a materialised target it still costs one sink call per property. The canonical module-level shared class rule (`new StyleRule({ scope: "class", name: "Foo" })` then `setMany`, per ARCHITECTURE.md) materialises in its constructor and therefore takes that path. Left alone deliberately: it is a bounded one-time cost per class rule, and changing it would also change `InlineStyle.setMany` from N recorded `apply` ops to one, churning unrelated tests for no measured gain.

---

## Implementation Notes

- **Case 14's teardown call.** The `## Expected Behaviour` table's case 14 says "Case 11, then `probe.destructor()`." `Component.destructor()` is `protected`, so it cannot be called directly from an external test file — only `dispose()` (the public entry point documented at `core/Component.ts` around line 709, which defers its whole body to `destructor()`) is reachable. The test calls `probe.dispose()`; the assertions (no `deleteStyleRule` op, no throw, `_ruleCacheHas` stays false) are unchanged and exercise the same code path the case describes.
- **Typecheck / lint baselines.** The plan's `## Verification` step 2 expects "exactly the 7 known pre-existing errors" from `npm run typecheck`, and step 4 expects `npm run lint` clean. On this branch point (`feature/stylerule-batched-flush` off `feature/table-rotated-record-view`, itself off `feature/stylesheet-rule-lookup-map`), `typecheck` and `typecheck:test` both report 0 errors, and `lint` reports 5 pre-existing errors confined to two files this plan never touches (`component/editor/CodeEditor.ts`, `component/table/cell/renderer/Link.ts` — confirmed via `git diff feature/table-rotated-record-view` showing no change to either). Both counts are branch drift from whatever baseline the plan was written against, not something introduced by this implementation.
