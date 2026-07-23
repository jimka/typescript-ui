---
touches-shared:
  - packages/lib/src/typescript/lib/core/DOM.ts
---

# Stylesheet Rule Lookup Map — Implementation Plan

## Overview

`ProductionDOMSink.ensureStyleRule` ([packages/lib/src/typescript/lib/core/DOM.ts:1377](packages/lib/src/typescript/lib/core/DOM.ts#L1377)) finds-or-inserts a rule on the framework's shared `<style id="Base">` sheet by walking `sheet.cssRules` from the start and comparing `selectorText`. `deleteStyleRule` ([DOM.ts:1394](packages/lib/src/typescript/lib/core/DOM.ts#L1394)) walks the same list to find the position to pass to `deleteRule`.

The framework allocates one `#uuid` rule per component, so each walk costs one step per rule already on the sheet, and the sheet grows by one per component. A 45-column × 400-row table demo made 5,904 `ensureStyleRule` calls against a sheet that reached 6,768 rules; the walks accounted for roughly 9% of the measured content build, and that share rises as the sheet grows.[^measurement]

This plan adds a selector → rule map inside `ProductionDOMSink` so `ensureStyleRule` never walks. `deleteStyleRule` gets an O(1) answer to "is this selector on the sheet at all", and keeps a positional walk only when the answer is yes.[^delete-scan] Nothing outside `core/DOM.ts` changes: the two methods keep their signatures and their observable behaviour, and the module-level `_ruleCache` in [core/StyleTarget.ts:161](packages/lib/src/typescript/lib/core/StyleTarget.ts#L161) is left exactly as it is.[^complements-rulecache]

Release target: library **0.3.0** (`packages/lib/package.json` currently reads `0.2.0`).

---

## Architecture Decisions

### The index is a private field on `ProductionDOMSink`

The map and the sheet it was built against are private instance fields of `ProductionDOMSink`. `DOM.reset()` ([DOM.ts:2165](packages/lib/src/typescript/lib/core/DOM.ts#L2165)) constructs a brand-new `ProductionDOMSink`, so the index is discarded with the sink it belonged to and `DOM.reset()` needs no edit.[^instance-not-module]

The nearest precedent is the handle registry in the same file — `_registry` at [DOM.ts:282](packages/lib/src/typescript/lib/core/DOM.ts#L282), a lookup map that `DOM.reset()` rebuilds in the same breath as the seams. The rule index follows it in kind (a map that makes a repeated DOM lookup cheap, torn down with the seam) and diverges in one respect: `_registry` is module-level because the sink *and* the source both read it, whereas only the sink touches style rules.

### The index is built lazily from the live sheet, and rebuilt when the sheet changes

A fresh sink starts with no index. The first `ensureStyleRule` or `deleteStyleRule` call walks `sheet.cssRules` once and records every `CSSStyleRule` it finds, then stores the sheet object alongside the map. Later calls reuse the map while `mainSheet()` keeps returning that same sheet object, and rebuild when it returns a different one.

Building from the live sheet — rather than starting empty — is what keeps a new sink honest about rules the previous sink left behind. In a browser, `DOM.reset()` replaces the sink but not the `<style id="Base">` element, so the sheet arrives already populated.[^lazy-build-load-bearing]

### The map stores rule objects, not positions

The map's value is the `CSSStyleRule` itself. `deleteRule(idx)` renumbers every rule after `idx`, so a map of positions would be wrong the moment anything is deleted; a map of objects is unaffected by renumbering, and is also unaffected by `ensureKeyframes` inserting a non-style rule.

The cost of that choice is that `deleteStyleRule` still has to find a position to pass to `deleteRule`. It does so by walking `cssRules` comparing object identity against the rule the map returned.[^delete-scan]

| Call | Before | After |
|---|---|---|
| `ensureStyleRule("#a")`, `#a` absent | walk all N, then `insertRule` | one `Map.get` miss, then `insertRule` |
| `ensureStyleRule("#a")`, `#a` present | walk until found | one `Map.get` hit |
| `deleteStyleRule("#a")`, `#a` absent | walk all N, find nothing | one `Map.get` miss |
| `deleteStyleRule("#a")`, `#a` present | walk until found, `deleteRule` | one `Map.get` hit, then walk for the position, `deleteRule` |

### `ensureKeyframes` and the headless guard are unchanged

`ensureKeyframes` ([DOM.ts:1417](packages/lib/src/typescript/lib/core/DOM.ts#L1417)) keeps its own walk. It is called five times in the whole library, all at module-import time against a near-empty sheet, and it inserts a `CSSKeyframesRule` — which the selector index neither holds nor is disturbed by.[^keyframes-untouched]

`deleteStyleRule`'s `typeof document === "undefined"` early return stays the **first statement in the method**, ahead of every new line. It is reachable from a `FinalizationRegistry` callback that fires at arbitrary GC time, including under the node test environment where there is no `document` at all; anything placed before it — including the index build, which calls `mainSheet()` — would throw there.

### The recording sink needs no change

`RecordingDOMSink.ensureStyleRule` ([packages/lib/tests/dom/TestDOM.ts:387](packages/lib/tests/dom/TestDOM.ts#L387)) records the op and returns a fresh literal; it never walks anything, so it is already O(1). It is also already at parity with the new production behaviour on rule identity.[^recorder-parity]

---

## Internal Structure

New private state and helper on `ProductionDOMSink` ([DOM.ts:1337](packages/lib/src/typescript/lib/core/DOM.ts#L1337)):

```typescript
/** Selector → rule for the sheet in `_indexedSheet`. Empty until first use. */
private _ruleIndex: Map<string, CSSStyleRule> = new Map();

/** The sheet `_ruleIndex` describes; `null` before the first build. */
private _indexedSheet: CSSStyleSheet | null = null;

private ruleIndex(sheet: CSSStyleSheet): Map<string, CSSStyleRule> {
    if (this._indexedSheet === sheet) {
        return this._ruleIndex;
    }

    const index = new Map<string, CSSStyleRule>();

    for (let idx = 0; idx < sheet.cssRules.length; idx += 1) {
        const rule = sheet.cssRules[idx];

        if (rule.type === CSSRule.STYLE_RULE) {
            index.set((rule as CSSStyleRule).selectorText, rule as CSSStyleRule);
        }
    }

    this._ruleIndex    = index;
    this._indexedSheet = sheet;

    return index;
}
```

The two rewritten methods:

```typescript
ensureStyleRule(selector: string): CSSStyleRule {
    const sheet  = this.mainSheet();
    const index  = this.ruleIndex(sheet);
    const cached = index.get(selector);

    if (cached) {
        return cached;
    }

    const insertedAt = sheet.insertRule(selector + "{}", sheet.cssRules.length);
    const rule       = sheet.cssRules[insertedAt] as CSSStyleRule;

    index.set(selector, rule);

    return rule;
}

deleteStyleRule(selector: string): void {
    if (typeof document === "undefined") {
        return;
    }

    const sheet = this.mainSheet();
    const index = this.ruleIndex(sheet);
    const rule  = index.get(selector);

    if (!rule) {
        return;
    }

    index.delete(selector);

    for (let idx = 0; idx < sheet.cssRules.length; idx += 1) {
        if (sheet.cssRules[idx] === rule) {
            sheet.deleteRule(idx);
            return;
        }
    }
}
```

Two details in `ruleIndex` that are easy to get wrong:

- The `rule.type === CSSRule.STYLE_RULE` guard is required. A `CSSKeyframesRule` has no `selectorText`, so without the guard a sheet containing keyframes puts an `undefined` key in the map. `CSSRule` is already used as a global in this file at [DOM.ts:1423](packages/lib/src/typescript/lib/core/DOM.ts#L1423).
- If a sheet somehow holds two rules with the same selector, the later one wins the map entry. That matches CSS cascade order (the later rule is the one that paints) and matches nothing the framework itself produces.

---

## Ordered Implementation Steps

Work test-first: step 1 writes the failing/passing behaviour file, step 2 makes the production change, steps 3-5 verify.

1. **Add `packages/lib/tests/dom/style-rule-index.test.ts`.** Start the file with the `// @vitest-environment jsdom` pragma on line 1, mirroring [tests/dom/handle-registry.test.ts:1](packages/lib/tests/dom/handle-registry.test.ts#L1) — that pragma is what makes `node-setup.ts` self-guard to a no-op so the *production* sink is exercised against a real `document`. Cover every case in `## Expected Behaviour`. Use `new ProductionDOMSink()` directly and read the sheet back through `document.getElementById('Base')`. In `afterEach`, remove the `<style id="Base">` element from the document **and** call `DOM.reset()`, so each test starts on an empty sheet with a fresh sink. Check: `npx vitest run tests/dom/style-rule-index.test.ts` — the "no duplicate rule after `DOM.reset()`" case and the "delete the middle rule of three" case must pass against the current code (they pin behaviour the walk already has); the rest pass too, since this step changes no behaviour.

2. **Rewrite the two methods in `packages/lib/src/typescript/lib/core/DOM.ts`.** Add `_ruleIndex`, `_indexedSheet`, and `ruleIndex()` to `ProductionDOMSink`; replace the bodies of `ensureStyleRule` (line 1377) and `deleteStyleRule` (line 1394) with the versions in `## Internal Structure`. Place `ruleIndex()` immediately above `mainSheet()` (line 1437), which it calls into. Leave `ensureKeyframes` and `mainSheet` untouched. Check: `grep -n 'cssRules' packages/lib/src/typescript/lib/core/DOM.ts` — expect matches only inside `ruleIndex`, `ensureStyleRule`, `deleteStyleRule`, and `ensureKeyframes`, and no other method in the file.

3. **Update the `DOMSink` interface JSDoc** at [DOM.ts:506-524](packages/lib/src/typescript/lib/core/DOM.ts#L506). Both comments currently promise a `cssRules` scan (`"Encapsulates the cssRules scan and insertRule"`, `"scans cssRules for the matching selectorText"`). Reword to describe find-or-insert / remove-if-present without naming a scan, keeping every `@param` and `@returns` tag. Do not add `{@link}` references to the new private members — per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), public JSDoc may only link symbols that appear in the rendered docs.

4. **Run the full suite and the typecheck.** See `## Verification`.

5. **Optional, for a number rather than a claim:** add `packages/lib/tests/dom/style-rule-index.bench.ts` per `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Create | `packages/lib/tests/dom/style-rule-index.test.ts` |
| Create (optional) | `packages/lib/tests/dom/style-rule-index.bench.ts` |

---

## Expected Behaviour

All cases below are unit-testable offline under the `jsdom` pragma against a real `ProductionDOMSink` and a real `CSSStyleSheet`; none needs manual verification. `sheet` means the `<style id="Base">` sheet the sink creates.

| # | Case | Expected |
|---|---|---|
| 1 | First lookup: `ensureStyleRule("#alpha")` on an empty sheet | `sheet.cssRules.length === 1`; the returned rule's `selectorText === "#alpha"` |
| 2 | Repeat lookup: call 1, then `ensureStyleRule("#alpha")` again | Returns the **same object** (`toBe`) as call 1; `sheet.cssRules.length` is still `1` |
| 3 | Lookup after deletion: case 1, then `deleteStyleRule("#alpha")`, then `ensureStyleRule("#alpha")` | After the delete, `sheet.cssRules.length === 0`; after the re-ensure, length is `1` again and the returned rule is a **different object** from case 1 |
| 4 | Delete a selector never inserted: `deleteStyleRule("#never")` on a sheet holding `#alpha` | No throw; `sheet.cssRules.length` unchanged at `1`; `ensureStyleRule("#alpha")` still returns the original object |
| 5 | Delete from the middle: ensure `#a`, `#b`, `#c`, then `deleteStyleRule("#b")` | `sheet.cssRules.length === 2`; the remaining `selectorText`s are `["#a", "#c"]` in that order; `ensureStyleRule("#a")` and `ensureStyleRule("#c")` each return the object they returned before the delete, and the sheet does not grow |
| 6 | After `DOM.reset()`, an existing rule is adopted, not duplicated: ensure `#alpha` on sink A, `DOM.reset()`, then `ensureStyleRule("#alpha")` on a new sink B | `sheet.cssRules.length` is still `1`; sink B returns the same rule object sink A created |
| 7 | After `DOM.reset()`, an existing rule is still deletable: as case 6, then `deleteStyleRule("#alpha")` on sink B | `sheet.cssRules.length === 0` |
| 8 | Keyframes do not corrupt the index: ensure `#alpha`, `ensureKeyframes("k", "from{opacity:0}to{opacity:1}")`, ensure `#beta`, then `deleteStyleRule("#alpha")` | `ensureStyleRule("#alpha")` between the keyframes call and the delete returns the original object; after the delete the sheet holds exactly the keyframes rule and `#beta`, and `#beta`'s rule object is unchanged |
| 9 | Keyframes present at index-build time: insert a keyframes rule, `DOM.reset()`, then `ensureStyleRule("#alpha")` on the new sink | No throw; `#alpha` is inserted; the rebuilt index contains no `undefined` key (assert by ensuring `#alpha` twice and getting the same object) |
| 10 | Headless: `new ProductionDOMSink().deleteStyleRule("#anything")` under the node environment | Returns without throwing — the existing assertion at [tests/core/StyleTarget.test.ts:96](packages/lib/tests/core/StyleTarget.test.ts#L96) must keep passing unchanged |

Case 10 lives in its existing node-environment file; do not move it into the new jsdom file, where `document` exists and the guard would not be exercised.

---

## Verification

Run from `packages/lib`:

1. `npx vitest run --no-file-parallelism`
   **`Tests N passed` alone does not mean green.** Read the `Errors` line and the process exit code as well: an unhandled async or GC-time exception fails the run without failing any single test. Exit code must be `0` and the `Errors` count `0`.
2. `npx tsc --noEmit -p tsconfig.json` — must report **exactly the 7 pre-existing errors** (`AccordionDemoPanel.ts:302`, `StatusBar.ts:258`, `AbstractCalendarDropdown.ts:1462`, `DiagramView.test.ts:174`, `DiagramView.test.ts:523`, `OnFirstLayout.test.ts:13`, `Dock.lifecycle.test.ts:53`) and nothing else.
3. `npm run lint` — `core/DOM.ts` is the sole file exempt from the `local/no-raw-dom` rule (`eslint.config.js:88`), so the new `CSSStyleSheet` / `CSSRule` references are allowed there; the lint run confirms nothing leaked outside it.
4. `npx vitest run tests/core/StyleTarget.test.ts tests/component/Component.test.ts tests/component/input/focusRing.test.ts tests/component/input/Link.test.ts` — the four suites that assert on recorded `ensureStyleRule` / `deleteStyleRule` ops. Their counts must be unchanged; the recording sink is untouched, so a change here means the production edit leaked into shared code.
5. Manual smoke, browser: `npm run dev`, open the app at `http://localhost:8015`, open the table demo with the wide table, and confirm rules still apply — components render styled, and closing the window/tab still shrinks the sheet (`document.getElementById('Base').sheet.cssRules.length` in the console, before and after).

**Optional benchmark.** For a measured number rather than an argument, add `packages/lib/tests/dom/style-rule-index.bench.ts` following the shape of [tests/dom/handle-seam.bench.ts](packages/lib/tests/dom/handle-seam.bench.ts) — same `// @vitest-environment jsdom` pragma, same `describe`/`bench` structure. Benchmark `ensureStyleRule` with a fresh unique selector against a sheet pre-loaded with 5,000 rules, and run it on the base commit and again after the change: `npx vitest bench tests/dom/style-rule-index.bench.ts`. Report the two ops/s figures. Do not turn the result into a promised percentage — the 9% figure in `## Overview` is a ratio from a timing-inflated profiling run, not a wall-clock prediction.

---

## Documentation Impact

No exported symbol is added, removed, or renamed, so no doc page, catalog entry, or sidebar entry changes. Two things still need doing:

- Step 3 edits the JSDoc of `DOMSink.ensureStyleRule` / `DOMSink.deleteStyleRule`, which is a public, rendered interface. Per [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), run `npm run docs:build` from `packages/lib` afterwards and confirm it finishes with **zero warnings**. The build needs several GB of heap; the script already pins `NODE_OPTIONS`, but on a memory-starved machine it can be OOM-killed (exit 137) — free memory rather than raising the limit.
- [packages/lib/docs/concepts/dom-seams.md:67](packages/lib/docs/concepts/dom-seams.md#L67) is the only prose mention of `ensureStyleRule`. It says the rule-style path carries no handle, which stays true. **No edit needed** — listed so the implementer does not go looking.

---

## Potential Challenges

- **A second live `ProductionDOMSink` writing the same sheet.** Two sinks keep two indices and would not see each other's inserts, which could duplicate a rule. In production `DOM.sink` is a singleton and `DOM.reset()` replaces it wholesale, so this only arises if a test constructs a second sink and writes style rules through it. Mitigation: note the single-writer assumption in the `ruleIndex` JSDoc; no test currently does this.
- **`selectorText` normalisation by the CSSOM.** The map is keyed by the caller's selector string on insert, but by `rule.selectorText` when the index is rebuilt from an existing sheet. If a browser rewrote a selector on insert, a rebuilt index would miss it and a duplicate rule would be inserted. This is not a new assumption — the current walk already compares `rule.selectorText === selector` — and a jsdom probe confirms verbatim round-tripping for `#id`, `.Class:focus-within::after`, and escaped `#a\:b` forms. Mitigation: none needed; case 6 pins the round-trip.
- **jsdom sheet state leaks between tests in one file.** The jsdom `document` persists across tests within a file, so a rule left behind by one test changes the next test's sheet length. Mitigation: the `afterEach` in step 1 removes the `<style id="Base">` element as well as calling `DOM.reset()`.

---

## Critical Files

| File | Why |
|---|---|
| [packages/lib/src/typescript/lib/core/DOM.ts](packages/lib/src/typescript/lib/core/DOM.ts) | The only file changed. Read `ProductionDOMSink` (1337), `ensureStyleRule` (1377), `deleteStyleRule` (1394), `ensureKeyframes` (1417), `mainSheet` (1437), and `DOM.reset` (2165). |
| [packages/lib/src/typescript/lib/core/DOM.ts:282](packages/lib/src/typescript/lib/core/DOM.ts#L282) | `_registry` — the precedent this design mirrors: a lookup map in this file, torn down with the seams. |
| [packages/lib/src/typescript/lib/core/StyleTarget.ts:161-207](packages/lib/src/typescript/lib/core/StyleTarget.ts#L161) | `_ruleCache`, `_ruleFor`, `disposeStyleRule` — the only callers of the two sink methods. Read to see why the sink sees each selector once, and why nothing here changes. |
| [packages/lib/tests/dom/handle-registry.test.ts](packages/lib/tests/dom/handle-registry.test.ts) | The pattern for a jsdom-pragma suite that tests the production seam. Copy its pragma, its imports, and its `afterEach(DOM.reset())`. |
| [packages/lib/tests/setup/node-setup.ts](packages/lib/tests/setup/node-setup.ts) | Explains the self-guard that makes the jsdom pragma work — required reading before writing the new test file. |
| [packages/lib/tests/dom/TestDOM.ts:387-399](packages/lib/tests/dom/TestDOM.ts#L387) | `RecordingDOMSink`'s three style-rule methods. Confirm they are unchanged. |
| [packages/lib/tests/core/StyleTarget.test.ts:91-101](packages/lib/tests/core/StyleTarget.test.ts#L91) | The headless-resilience test that pins the `typeof document` guard. |

---

## Non-Goals

- **Hoisting class-uniform declarations into class-scoped rules.** A sibling plan from the same investigation. It reduces how many rules exist; this plan makes finding one cheap. They are independent.
- **Batching `StyleRule.flushDirty`'s per-property writes.** A sibling plan. It touches `core/StyleTarget.ts`, which this plan does not.
- **Making `_defaultOptions` per-class.** A sibling plan, unrelated to the stylesheet.
- **Making `ensureKeyframes` O(1).** Five call sites, all at import time against a near-empty sheet. Adding a second index for it is cost with no measured benefit.
- **Changing `RecordingDOMSink`.** Already O(1) and already at parity.
- **Touching `_ruleCache` in `core/StyleTarget.ts`.** It solves a different half of the problem and is correct as-is.
- **Shrinking or reusing rule slots.** Neither pooling deleted rules nor rewriting `selectorText` for reuse is in scope; both change rule-object identity, which callers rely on.

---

## Notes

[^measurement]: From a performance investigation of a 45-column × 400-row table demo: 5,904 `ensureStyleRule` calls, the sheet reaching 6,768 rules, and roughly 22,400 ms attributed to the walks — about 9% of the run's content build. That run was profiled with instrumentation that inflates absolute timings, so treat 9% as a share of a distorted total, not a wall-clock saving. The shape of the cost is the reliable part: work proportional to rules-already-present, paid once per component, on a sheet that grows once per component.

[^delete-scan]: `CSSStyleSheet.deleteRule` takes a position, and the CSSOM offers no way to ask a rule where it sits. So the position has to come from somewhere, and every option has a cost. Storing positions in the map makes deletion O(N) in map writes instead, because `deleteRule(p)` decrements the position of every rule after `p`. Keeping positions correct with a Fenwick tree of deletions would give O(log N) on both paths, at a complexity no UI framework's stylesheet needs. Recording a "drift since insert" and scanning downward from the stored position is O(1) when rules are deleted back-to-front and O(N) when they are deleted front-to-back — order-dependent in the wrong direction, because a teardown drains the sheet from the front. The identity walk chosen here has the opposite order-dependence: deleting front-to-back finds the rule at position 0 immediately, which is the realistic teardown shape. It is also the only option that adds no state to maintain, which matters for a change meant to land independently and carry near-zero risk. A third option — never calling `deleteRule` at all, instead blanking the rule and recycling its object for the next selector — was rejected outright: recycling a rule object that a stale `StyleRule._target` still points at would silently write one component's styles onto another's selector.

[^complements-rulecache]: `_ruleCache` in `core/StyleTarget.ts` memoises by selector, so the sink is asked about a given selector at most once per materialisation. That makes it exactly the wrong tool for this cost: the expensive call is the *first* lookup for each of thousands of distinct `#uuid` selectors, and `_ruleCache` has nothing cached for those. The two layers are complementary — `_ruleCache` stops repeat calls from reaching the seam at all, and the index inside the sink makes the calls that do reach it cheap. Neither replaces the other, and this plan changes only the sink half.

[^instance-not-module]: A module-level map cleared inside `DOM.reset()` would work equally well in the reset path, and would match `_registry` more literally. The instance field is preferred because it cannot be forgotten: a future code path that swaps the sink without going through `DOM.reset()` — `DOM.install({ sink })` is exactly such a path — gets a correct empty index for free, whereas a module-level map would silently survive the swap.

[^lazy-build-load-bearing]: Without the build-from-live-sheet step, a sink created after `DOM.reset()` in a browser would start with an empty index over a populated sheet. `ensureStyleRule` would then insert a second rule for a selector already present, and — worse — `deleteStyleRule` would find nothing in its index and return early, leaving the rule on the sheet forever. That would turn the O(1) early-out into a silent regression of the stylesheet-rule leak fix. The one-time walk at first use is what makes the early-out safe to trust.

[^keyframes-untouched]: The five calls are in `component/display/Glyph.ts` (three), `component/display/ProgressSpinner.ts`, and `component/display/ProgressBar.ts`, all at module scope. A `CSSKeyframesRule` is not selector-keyed, so it never enters the index; and because the index holds rule objects rather than positions, a keyframes rule appearing anywhere in the sheet leaves every existing index entry valid. The one place keyframes do matter is the index build, which must skip them — see the `CSSRule.STYLE_RULE` guard in `## Internal Structure`.

[^recorder-parity]: Production now guarantees that two `ensureStyleRule` calls for one selector return the same object; the recorder returns a fresh literal each time. That difference is unobservable, because `_ruleCache` in `core/StyleTarget.ts` prevents a second call for a live selector from reaching the sink at all. The only way a selector reaches the sink twice is after `disposeStyleRule` evicted it — and at that point production has deleted its rule and inserts a new object too, so both sinks return something new. Adding a dedupe map to the recorder would therefore change nothing except to risk the op-count assertions in `tests/core/StyleTarget.test.ts`.
