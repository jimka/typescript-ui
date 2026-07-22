---
touches-shared:
  - packages/lib/src/typescript/lib/core/StyleTarget.ts
  - packages/lib/src/typescript/lib/core/DOM.ts
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/tests/dom/TestDOM.ts
---

# Batched `StyleRule` flush — Implementation Plan

## Overview

`StyleRule` writes one CSS declaration per sink call. Its sibling `InlineStyle` writes a whole bag in one call, and the abstract method's own doc comment records the split: *"the inline-style subclass batches the whole bag into one seam write; the rule subclass writes each property individually"* ([packages/lib/src/typescript/lib/core/StyleTarget.ts:112](packages/lib/src/typescript/lib/core/StyleTarget.ts#L112)). Every write into the framework's shared `<style id="Base">` sheet invalidates style for the whole document, so each of those calls makes the next forced style read re-run over the entire document.[^cost]

This plan makes a rule's declarations reach the stylesheet as **one sheet mutation per bag**. Two changes carry it. First, the seam gets a batched rule write — `DOMSink.setRuleStyles(rule, styles)` replaces the per-property `setRuleStyle`, mirroring how `DOMSink.apply(handle, { style })` already serves both the single and the bulk element-style path. Second, `Component.applyStyle` stops materialising its rule before it writes: it queues all 24 of its declarations into the dirty bag and materialises last, so the render path produces one batched flush instead of 24 write-throughs.[^where-the-calls-are]

The touched files are [core/DOM.ts](packages/lib/src/typescript/lib/core/DOM.ts) (seam), [core/StyleTarget.ts](packages/lib/src/typescript/lib/core/StyleTarget.ts) (both subclasses' terminal write), [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) (the `applyStyle` phases), and the offline test sink. `DOMSink` is exported from the `core` barrel ([packages/lib/src/typescript/lib/core/index.ts:14](packages/lib/src/typescript/lib/core/index.ts#L14)), so replacing a method on it is consumer-visible. **Release target: library 0.3.0** — `packages/lib/package.json` currently reads `0.2.0`; this plan does not bump it.

---

## Architecture Decisions

### One batched seam method replaces `setRuleStyle`

`DOMSink` gains `setRuleStyles(rule, styles)` and loses `setRuleStyle(rule, key, value)`. `StyleRule.writeStyle` wraps its single property as `{ [key]: value }`; `StyleRule.flushDirty` passes the bag straight through. The shape mirrors `InlineStyle`, whose single write is `DOM.sink.apply(target, { style: { [key]: value } })` and whose bag write is `DOM.sink.apply(target, { style: dirty })` ([core/StyleTarget.ts:350](packages/lib/src/typescript/lib/core/StyleTarget.ts#L350)).[^one-method]

### The production sink merges through a detached scratch declaration

`ProductionDOMSink.setRuleStyles` seeds a module-private, never-rendered scratch element's inline style with the rule's current `cssText`, replays each entry onto it with the existing `writeDeclaration` helper, then assigns the result back to the rule in a single `cssText` write. A single-entry bag skips the scratch and writes the declaration directly.[^scratch]

### `applyStyle` queues its declarations and materialises last

[`Component.applyStyle`](packages/lib/src/typescript/lib/core/Component.ts#L4336) currently calls `ensureCSSRule()` first, which materialises the rule and turns all 24 following `_styleRule.set` calls into individual sink writes. The six phase methods switch to `_styleRule.queue` / `queueMany`, and `applyStyle` materialises and flushes once at the end. Nothing observes the rule mid-`applyStyle`: `getCSSRule()` is the only reader and has no call sites in the library.[^reorder-safety]

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
// tests/dom/TestDOM.ts — test-only helper, exported alongside RecordingDOMSink.
export function ruleStyleWrites(
    sink: RecordingDOMSink
): Array<{ selector: string; key: string; value: string | null }>
```

No new options-bag field, no new component setter: `StyleRule` / `InlineStyle` keep their existing `set` / `setMany` / `queue` / `queueMany` / `flush` surface unchanged.

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

`StyleRule`'s two terminal writes collapse onto the one seam method:

```typescript
protected writeStyle(key: string, value: string | null): void {
    DOM.sink.setRuleStyles(this._target!, { [key]: value });
}

protected flushDirty(dirty: Record<string, string | null>): void {
    DOM.sink.setRuleStyles(this._target!, dirty);
}
```

`Component.applyStyle`'s new tail (replacing the `ensureCSSRule()` call at the top):

```typescript
this.applyMiscInlineStyles();

// Materialise last: every phase above queued into the dirty bag, so the whole
// rule body reaches the stylesheet as one write. `ensure()` flushes the bag on
// first materialisation; `flush()` covers the already-materialised re-render.
this.ensureCSSRule();
this._styleRule.flush();

this.materialiseDeferredRules();
```

---

## Ordered Implementation Steps

Test-first: steps 1–2 write failing tests, steps 3–7 make them pass.

1. **Add the test helper.** In [packages/lib/tests/dom/TestDOM.ts](packages/lib/tests/dom/TestDOM.ts), export `ruleStyleWrites(sink)` per `## Public API`. It filters `sink.writes` for `op === 'setRuleStyles'`, and for each expands `args[1]` (the bag) into one row per key, carrying `args[0]` as `selector`. Rows keep bag insertion order; bags keep recording order.

2. **Write the new test file** `packages/lib/tests/core/StyleRuleBatchedFlush.test.ts`, covering every case in `## Expected Behaviour` marked *unit*. Copy the harness preamble (`DOM_CONFIG`, `installTestDOM`, `beforeEach` / `afterEach` with `DOM.reset()`) from [tests/component/Component.test.ts:1-20](packages/lib/tests/component/Component.test.ts#L1-L20). Use a distinct selector name per case that constructs a bare `StyleRule` — `_ruleCache` is module state surviving `DOM.reset()`, so a reused name hides the `ensureStyleRule` op (the same caution [tests/core/StyleTarget.test.ts:31-36](packages/lib/tests/core/StyleTarget.test.ts#L31-L36) documents). Run the suite; every new case must fail.

3. **Swap the seam method.** In [core/DOM.ts](packages/lib/src/typescript/lib/core/DOM.ts): replace the `DOMSink.setRuleStyle` declaration (line 504) with `setRuleStyles`, keeping the doc comment's "a `CSSStyleRule` has no element, so it gets its own method" point and adding that the bag lands as one sheet mutation. Replace `ProductionDOMSink.setRuleStyle` (line 1372) with the body in `## Internal Structure`, and add the `_scratch` / `scratchDeclaration()` module privates next to the existing `writeDeclaration` helper (line 295).

4. **Route `StyleRule` through it.** In [core/StyleTarget.ts](packages/lib/src/typescript/lib/core/StyleTarget.ts), replace `StyleRule.writeStyle` (line 305) and `StyleRule.flushDirty` (line 310) with the two bodies in `## Internal Structure`. Update the abstract `flushDirty` doc comment (line 109-116) — both subclasses now batch the bag into one seam write — and the `writeStyle` doc's `{@link DOMSink.setRuleStyle}` reference (line 101) to `setRuleStyles`.

5. **Update the recording sink.** In [tests/dom/TestDOM.ts:383](packages/lib/tests/dom/TestDOM.ts#L383), replace `setRuleStyle` with:

   ```typescript
   setRuleStyles(rule: CSSStyleRule, styles: Record<string, string | null>): void {
       this.record('setRuleStyles', (rule as { selectorText?: string }).selectorText ?? '', styles);
   }
   ```

6. **Queue the `applyStyle` phases.** In [core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts), inside the six phase methods only, change every `this._styleRule.set(` to `this._styleRule.queue(` and the one `this._styleRule.setMany(` to `queueMany(` — lines 4367, 4370, 4379, 4381, 4386, 4391, 4396, 4401, 4406, 4453, 4454, 4459, 4460, 4472, 4476, 4492 (`setMany`), 4494, 4499, 4504, 4509, 4520, 4552, 4557, 4565. Leave every `this._inlineStyle.set` untouched. Checkpoint: `grep -n '_styleRule\.set' packages/lib/src/typescript/lib/core/Component.ts` — expect zero matches.

7. **Move the materialisation.** In `applyStyle` ([core/Component.ts:4336](packages/lib/src/typescript/lib/core/Component.ts#L4336)), delete the `this.ensureCSSRule();` call and its four-line comment at the top, and insert the tail block from `## Internal Structure` between `applyMiscInlineStyles()` and `materialiseDeferredRules()`. Run the new test file; it must now pass.

8. **Migrate the existing assertions** to `ruleStyleWrites`, at: [tests/component/Component.test.ts:157,158,168,169](packages/lib/tests/component/Component.test.ts#L157), [tests/component/EffectiveVisibility.test.ts:80,115,198,204,238,244](packages/lib/tests/component/EffectiveVisibility.test.ts#L80), [tests/core/PanelOverlayScrollbar.test.ts:104,168,197](packages/lib/tests/core/PanelOverlayScrollbar.test.ts#L104), [tests/component/input/Link.test.ts:80](packages/lib/tests/component/input/Link.test.ts#L80). Each `w.op === 'setRuleStyle' && w.args[0] === K && w.args[1] === V` becomes `w.key === K && w.value === V` over `ruleStyleWrites(sink)`. Checkpoint: `grep -rn "setRuleStyle\b" packages/lib/src packages/lib/tests` — expect zero matches (only `setRuleStyles` survives).

9. **Update the seam doc.** [packages/lib/docs/concepts/dom-seams.md:67](packages/lib/docs/concepts/dom-seams.md#L67) names `setRuleStyle` — rename it to `setRuleStyles` in place; the sentence's point (a `CSSStyleRule` is not an element and carries no handle) still holds.

10. **Run the full verification list** in `## Verification`.

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

---

## Expected Behaviour

The contract is **one seam write per bag** — never a count of declarations. Assert the number of recorded `setRuleStyles` ops and the content of the bag; never assert "24 writes".

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
| 11 | **Shorthand removal in the browser.** A rule carrying `border: 1px solid red`, then a bag containing `border: null` plus another property. | The rendered rule has no border at all — removing a shorthand clears its longhands, exactly as the per-property write did. | manual |
| 12 | **Visual parity.** The app renders identically before and after. | No change to borders, min/max sizing, visibility, padding, or overflow anywhere in the demo app. | manual |

Cases 11 and 12 cannot be automated: the offline `RecordingDOMSink` returns a stub rule whose `style` is a plain object, so no test exercises the real `cssText` merge. Verify both in the browser per `## Verification`.

---

## Verification

From `packages/lib`:

1. `npx vitest run --no-file-parallelism` — `Tests N passed` is **not** sufficient. Check the `Errors` line reads zero and the process exit code is `0`.
2. `npm run typecheck` — must report exactly the 7 known pre-existing errors, no more.
3. `npm run typecheck:test` — clean.
4. `npm run lint` — clean (the `local/no-raw-dom` rule has an empty baseline; the new `document.createElement` lives inside `core/DOM.ts`, the one module allowed to touch raw DOM).
5. `grep -rn "setRuleStyle\b" packages/lib/src packages/lib/tests packages/lib/docs` — zero matches.
6. `grep -n "_styleRule\.set" packages/lib/src/typescript/lib/core/Component.ts` — zero matches.
7. Manual, browser (`npm run dev`, http://localhost:8015): open the wide-table demo panel and the Button/Tab demos. Confirm cases 11 and 12 — components keep their borders, sizes, and visibility, and a `Button` still changes appearance on hover and press. In DevTools, inspect the `<style id="Base">` sheet and confirm a component's `#id` rule carries the same declarations it did before the change.

---

## Documentation Impact

`DOMSink` is exported as a type from the `core` barrel ([core/index.ts:14](packages/lib/src/typescript/lib/core/index.ts#L14)), so replacing `setRuleStyle` with `setRuleStyles` is a breaking change for anyone implementing the interface — it belongs in the 0.3.0 release notes. The only prose page naming the method is [packages/lib/docs/concepts/dom-seams.md:67](packages/lib/docs/concepts/dom-seams.md#L67) (step 9). `ARCHITECTURE.md`'s *CSS writes go through `StyleRule` / `InlineStyle`* section describes the buffers, not the seam method, and needs no edit. Run `npm run docs:build` after the JSDoc edits in steps 3–4; it must finish with zero warnings.

---

## Potential Challenges

- **A subclass `applyStyle` override that reads the rule mid-pass** would now see an unmaterialised rule. None exists: the four overrides ([Legend](packages/lib/src/typescript/lib/component/container/Legend.ts#L52), [Text](packages/lib/src/typescript/lib/component/input/Text.ts#L1247), [TabBar's indicator](packages/lib/src/typescript/lib/component/container/TabBar.ts#L280), [ListItem](packages/lib/src/typescript/lib/component/list/ListItem.ts#L76)) all call `super.applyStyle` first — after which the rule is materialised and flushed — or are a no-op.
- **The scratch element must never be attached.** Appending it to the document would make its style writes cost what the change is removing. It is created detached and only `document.createElement` is called on it; no `appendChild`.
- **A headless environment has no `document`.** `scratchDeclaration()` returns `null` and the per-property fallback runs, matching the guard `ProductionDOMSink.deleteStyleRule` already uses ([core/DOM.ts:1400](packages/lib/src/typescript/lib/core/DOM.ts#L1400)).
- **Two `StyleRule` instances can share one `CSSStyleRule`** through the module cache. The merge reads the live declaration each time rather than a locally-held copy, so the second instance's write never discards the first's declarations.
- **A sibling plan edits `ensureStyleRule` in the same two files.** Coordinate by landing one before the other; the two changes touch different methods (`ensureStyleRule` vs `setRuleStyle`) and do not conflict semantically.

---

## Critical Files

- [packages/lib/src/typescript/lib/core/StyleTarget.ts](packages/lib/src/typescript/lib/core/StyleTarget.ts) — `StyleTarget` (the buffer contract: `set` / `queue` / `flush` / `materialize`), `StyleRule`, and `InlineStyle`, the precedent this change copies.
- [packages/lib/src/typescript/lib/core/DOM.ts](packages/lib/src/typescript/lib/core/DOM.ts) — the `DOMSink` interface, `ProductionDOMSink`, and the `writeDeclaration` helper (line 295) that both the old and new paths use as the terminal declaration write.
- [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) — `applyStyle` and its six phase methods (lines 4336-4581), plus `setElementCSSRule` / `commitCSSRule` / `setAutoCommitStyle` (lines 1399-1482), the existing batching gate.
- [packages/lib/tests/dom/TestDOM.ts](packages/lib/tests/dom/TestDOM.ts) — `RecordingDOMSink`; note `ensureStyleRule` returns a stub `{ selectorText, style: {} }`, so nothing offline exercises the real merge.
- [packages/lib/tests/core/StyleTarget.test.ts](packages/lib/tests/core/StyleTarget.test.ts) — the existing `StyleRule` suite and its module-cache isolation caution.

---

## Non-Goals

- **Hoisting class-uniform declarations into class-scoped rules.** A separate plan owns reducing how many declarations each component writes; this plan only changes how many sink calls a given set of declarations costs.
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

[^setmany]: `StyleTarget.setMany` loops `set` per key, so on a materialised target it still costs one sink call per property. The canonical module-level shared class rule (`new StyleRule({ scope: "class", name: "Foo" })` then `setMany`, per ARCHITECTURE.md) materialises in its constructor and therefore takes that path. Left alone deliberately: it is a bounded one-time cost per class rule, and changing it would also change `InlineStyle.setMany` from N recorded `apply` ops to one, churning unrelated tests for no measured gain.
