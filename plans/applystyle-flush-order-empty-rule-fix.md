---
depends-on:
  - text-truncate-write-path-cleanup
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/component/input/Text.ts
  - packages/lib/docs/reference/changelog/next.md
---

# `Component.applyStyle` flush-order empty-rule fix — Implementation Plan

## Overview

Nearly every `Text` instance materialises an empty `#id { }` stylesheet rule instead of no rule at all. Live-measured on this worktree's dev server (one table window, one dialog opened and closed, on the default `#/misc` screen): the Style Audit panel (`#/style-audit`) reports a `Text`/`plain` duplicate-rule group of **134 instances, 0.39 KB, body `{ }`** — out of 641 total per-instance rules. The count scales with how many `Text`-bearing components are on screen; the reported production case saw roughly 1006.

The cause is a flush-order gap between two methods. [`Component.applyStyle`](packages/lib/src/typescript/lib/core/Component.ts#L5013) runs six private phases, then calls [`materialiseStyleRule()`](packages/lib/src/typescript/lib/core/Component.ts#L5300) — the **only** point that decides whether the component's `#id` rule gets inserted, via [`materialiseWhenNeeded`](packages/lib/src/typescript/lib/core/Component.ts#L5282), which inserts the rule when it is already materialised (see `isMaterialized()`) **or** when the dirty bag holds at least one real (non-null) declaration (`hasQueuedDeclarations()`). [`Text.applyStyle`](packages/lib/src/typescript/lib/component/input/Text.ts#L1516) overrides this: it calls `super.applyStyle(element)` first — which runs `Component`'s six phases *and* that first flush — then queues twelve more font/text declarations of its own, then calls `this.materialiseStyleRule()` a second time to flush those.

Separately, [`Text.applyOptions`](packages/lib/src/typescript/lib/component/input/Text.ts#L300) dispatches `this.setTruncate(options.truncate ?? this._defaultOptions.truncate!)` **unconditionally** on every construction (it cannot be gated on `options.truncate !== undefined`, because `whiteSpace`/`overflow` have no other render-time fallback — see that plan's `[^gating-rejected]` footnote). `setTruncate(true)`, the default, calls `setTextOverflow("ellipsis")`, which queues `"ellipsis"` into `_styleRule`'s dirty bag. This happens inside the `super()` constructor cascade, before `_inheritedStyleBag` (the class-tier comparison bag `applyStyle` builds) exists — so the queued value is a genuine, real `"ellipsis"`, not yet comparable to anything.

Putting the two together: `Component.applyStyle`'s own first flush runs while that stale `"ellipsis"` is still sitting in the dirty bag as real content, so `hasQueuedDeclarations()` is true and the rule is inserted. Only afterward does `Text.applyStyle`'s own phase run [`reconcileRuleDeclaration("textOverflow", ...)`](packages/lib/src/typescript/lib/component/input/Text.ts#L1564), which correctly resolves `textOverflow` (and `whiteSpace`, from `Component`'s own phase) to `null` — but the rule is already live, and nothing un-inserts it once inserted. This plan closes the gap by changing when `Text` gets to contribute its declarations, not by cleaning up after the fact.

Two files change: `core/Component.ts` (a new pre-flush extension point) and `component/input/Text.ts` (moves onto it). Four existing test files pin the current, buggy empty-materialisation behaviour and are updated to the corrected one. One changelog bullet is amended.

---

## Architecture Decisions

### Give `Component.applyStyle` a pre-flush subclass hook, and move `Text`'s declarations onto it

`Component` gains a new `protected applySubclassStyles(): void` method — a no-op by default — called as the seventh and final phase inside `Component.applyStyle`, immediately before `materialiseStyleRule()`'s one flush. `Text` deletes its `applyStyle` override entirely and moves its twelve declaration writes into an override of this new hook. `Text` no longer overrides `applyStyle` at all; calling `applyStyle` on any `Text` instance now runs `Component.applyStyle` directly, which reaches every phase — including `Text`'s own font/text declarations — before its single flush ever runs.[^why-hook-not-cleanup]

This mirrors an existing, actively-used pattern in the same class: [`getRestingExclusionSuffixes()`](packages/lib/src/typescript/lib/core/Component.ts#L4863) is a `protected` hook with an empty-array no-op default, called from `Component`'s own internal machinery (`restingIsolationSuffix`), and overridden by six subclasses (`Button`, `ToggleButton`, `Checkbox`, `RadioButton`, `Scrollbar`, `Header`) each via `return [...super.getRestingExclusionSuffixes(), ".newSuffix"];` — the exact chain-forward shape this plan's new hook uses. [`getClassStyleDefaults()`](packages/lib/src/typescript/lib/core/Component.ts#L4992) is the second instance of the same shape, overridden by `Text` alone today. A pre-flush contribution hook is the same idea applied to the one gap in `applyStyle` that has no such hook yet.

| Timeline | Current (`Text.applyStyle` overrides `applyStyle`) | After this plan (`Text` overrides `applySubclassStyles`) |
|---|---|---|
| `super()` cascade, inside `Text.applyOptions` | `setTruncate(true)` queues `textOverflow: "ellipsis"` (real) | same |
| `Component.applyStyle`'s 6 base phases | queue `whiteSpace` as a reconciled removal | same |
| `Component.applyStyle`'s **one** flush | sees `textOverflow: "ellipsis"` still real → inserts `#id { }` | `Text`'s hook has already run (see next row) → sees `textOverflow: null` → **no insert** |
| `Text`'s font/text declarations | queued **after** the flush above, in `Text.applyStyle`'s own body — `reconcileRuleDeclaration("textOverflow", "ellipsis")` correctly overwrites the dirty-bag entry to `null` | queued **before** the flush above, inside `applySubclassStyles` |
| `Text.applyStyle`'s second flush | drains the now-`null` `textOverflow` onto the *already-inserted, now-empty* rule | *(does not exist — there is only ever one flush)* |

### Only `Text` needs the hook — `TabIndicator`, `Markdown`, and `Legend` keep their current shape

These are the only other three `applyStyle` overrides in the library (confirmed by an exhaustive `grep -rn "applyStyle(element" packages/lib/src`). Each calls `super.applyStyle(element)` first and adds work after, same as `Text` did — but none shares `Text`'s actual precondition (a value that can be corrected down to a class-tier-matching removal), so none is migrated:

| Class | Post-`super()` write | Can it degrade to a stale removal? |
|---|---|---|
| [`TabIndicator`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L279) (`TabBar.ts`) | `setElementStyles({...})` — inline styles only, plus a tracked `setTranslate` | No `_styleRule`/`#id` write of any kind after `super()` — nothing to reconcile |
| [`Markdown`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L748) | `setElementCSSRule("maxWidth", this._maxMeasure ?? "var(--ts-ui-md-max-measure, 70ch)")` | No — the fallback branch is a real, non-null string; this write is never a match-and-remove |
| [`Legend`](packages/lib/src/typescript/lib/component/container/Legend.ts#L52) | `setElementCSSRule("marginLeft", "10px")` | No — `10px` is a fixed constant, always real |

`Legend extends Text`, so it inherits `Text`'s bug today and is fixed by fixing `Text`; its own `marginLeft` addition is untouched and keeps working exactly as before, because `setElementCSSRule` always self-materialises correctly through `commitCSSRule()` regardless of which phase runs first.[^markdown-legend-detail]

### Reject a cleanup-based fix (`dispose()` when a flush leaves a rule empty)

The obvious alternative — call [`StyleRule.dispose()`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L325) whenever a flush leaves a rule with no real declarations — is rejected. `dispose()` calls [`DOM.ts`'s `deleteStyleRule`](packages/lib/src/typescript/lib/core/DOM.ts#L1597), which does a **linear scan of the entire live stylesheet's `cssRules`** to find the rule's current index (the module's `_ruleIndex` maps selector → `CSSStyleRule` object, but `CSSStyleSheet.deleteRule()` takes an index, which is never tracked). `applyStyle` runs once per `Text` instance in exactly the workload this project has repeatedly optimised for — opening a big table constructs hundreds of `Text` instances in a tight loop (`init()` → `applyStyle()`, confirmed the only realistic call site: `Component.sync()` has zero application call sites, and `setId()` only re-fires `applyStyle` when a caller passes an explicit `id` option). Calling `dispose()` from inside that loop, every time a `Text` fully reconciles to empty, would pay an O(current stylesheet rule count) scan per instance while the stylesheet is *actively growing* from the same loop — a quadratic-shaped cost across the same "open a big table" workload this fix is meant to help. The hook-based fix needs no rule deletion for this case at all: the rule is simply never inserted in the first place.[^perf-detail]

---

## Internal Structure

New hook on `Component`, inserted immediately after `applyMiscInlineStyles()`'s closing brace (packages/lib/src/typescript/lib/core/Component.ts#L5269) and before the `materialiseWhenNeeded` doc comment:

```typescript
/**
 * Extension point for a subclass that needs to queue more `#id` rule
 * declarations — through `writeRuleDeclaration` / `reconcileRuleDeclaration`
 * / `setReconciledCSSRules`, so they still compare against the class tier —
 * before `applyStyle`'s one materialising flush runs. A no-op by default.
 *
 * A subclass overrides this, chaining onto `super()`'s call rather than
 * replacing it, so a grandchild class's own contribution runs too. Only
 * needed by a subclass whose extra declaration can itself resolve to a
 * class-tier-matching removal (see this plan's Architecture Decisions) — a
 * subclass that only ever writes a real, always-present value (`Legend`'s
 * `marginLeft`, `Markdown`'s `maxWidth`) has no need of this hook and can
 * keep overriding `applyStyle` directly, calling `super.applyStyle()` first.
 */
protected applySubclassStyles(): void {
    // No-op by default.
}
```

Call site, inside `Component.applyStyle` (packages/lib/src/typescript/lib/core/Component.ts#L5026-5036), added as the seventh phase:

```typescript
this.applyOverflowStyles();
this.applyChromeStyles();
this.applyMiscInlineStyles();
this.applySubclassStyles();          // new

// Materialise last: every phase above queued into the dirty bag, so the
// whole rule body reaches the stylesheet as one write — or none, if the
// bag is empty.
this.materialiseStyleRule();
```

`Text.ts`'s override (replaces the current `applyStyle` override, packages/lib/src/typescript/lib/component/input/Text.ts#L1511-1574):

```typescript
protected applySubclassStyles(): void {
    super.applySubclassStyles();

    const fontSize = this.getFontSize();

    this.writeFontDeclaration("fontFamily",     this.getFontFamily());
    this.writeFontDeclaration("textAlign",      this.getTextAlign());
    this.writeFontDeclaration("textShadow",     this.getTextShadow());
    this.writeFontDeclaration("fontKerning",    this.getFontKerning());
    this.writeFontDeclaration("fontSize",       this._fontSizeCSSRule   ?? (fontSize !== null ? `${fontSize}px` : null));
    this.writeFontDeclaration("fontSizeAdjust", this.getFontSizeAdjust());
    this.writeFontDeclaration("fontStretch",    this.getFontStretch());
    this.writeFontDeclaration("fontStyle",      this.getFontStyle());
    this.writeFontDeclaration("fontVariant",    this.getFontVariant());
    this.writeFontDeclaration("fontWeight",     this.getFontWeight());
    if (this._lineHeightCSSRule) {
        this.reconcileRuleDeclaration("lineHeight", this._lineHeightCSSRule);
    }
    const textOverflow = this.getTextOverflow();
    this.reconcileRuleDeclaration("textOverflow", textOverflow ?? "clip");
}
```

Every line of the body is moved verbatim from the current `applyStyle` override (packages/lib/src/typescript/lib/component/input/Text.ts#L1519-1564) — same calls, same order, same comments above each block (the long comment explaining the `"clip"` substitution above the `textOverflow` line carries over unchanged). Only `super.applyStyle(element)` and the trailing `this.materialiseStyleRule()` are dropped, and the method's own JSDoc (currently `@param element` / "Applies all text-specific style properties...") is replaced with one describing the hook (see `## Ordered Implementation Steps`).

---

## Ordered Implementation Steps

1. **Update the four pre-existing test files to the corrected expectations first**, so they fail red against the current (unfixed) code before any source change — each currently pins the empty-materialisation bug as if it were the intended behaviour.

   - **`packages/lib/tests/component/input/TextTruncateWritePath.test.ts`**: rewrite the test at [lines 78-107](packages/lib/tests/component/input/TextTruncateWritePath.test.ts#L78). Replace the comment (lines 78-97) with a short note that this plan closes the ordering gap it described, and the `#id` rule is now never materialised for a plain `Text`. Replace the body:
     ```typescript
     it('a fresh Text with no font override never materialises its own #id rule', () => {
         const sink = DOM.sink as RecordingDOMSink;
         const t = new Text('x');

         const declarations = declarationsDuring(sink, idSelector(t), () => t.getElement(true));

         expect(declarations).toEqual({});
     });
     ```
     *Check:* `npx vitest run tests/component/input/TextTruncateWritePath.test.ts` from `packages/lib` — this one case fails (current code still inserts the empty rule).

   - **`packages/lib/tests/component/input/TextClassStyleHoisting.test.ts`**: four cases change (the file header, lines 18-24, needs no change — its general rule about materialised-vs-not still holds).
     - [Lines 124-144](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L124): replace the comment (124-132) with a note that `textOverflow` now reconciles before the one render-time flush, so `#id` is never forced into existence. Replace the test body's final three lines (139-143) with a single `expect(declarations).toEqual({});` and drop the now-redundant `SKIPPABLE_FONT_KEYS` loop above it (subsumed). Retitle to `'a fresh Text with no font/text setter called writes nothing to its own #id rule — no rule materialises at all'`.
     - [Lines 235-250](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L235): update the comment at 242-246 (drop "reconciling it away... not a real value, and not merely absent"; state that `#id` never materialises since no other real deviation exists). Change lines 247-248 from `expect(declarations.lineHeight).toBeNull(); expect(declarations.textOverflow).toBeNull();` to `expect(declarations).toEqual({});`. `_ruleCacheHas('.Text.lh30px')` stays `toBe(true)` — that is the separate, unaffected class-tier value-class rule.
     - [Lines 280-310](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L280): for both `cellText1`'s block (286-297) and `cellText2`'s block (302-309), replace the `lineHeight`/`textOverflow`/`SKIPPABLE_FONT_KEYS`-loop assertions with `expect(Object.keys(decl1)).toEqual([]);` and `expect(Object.keys(decl2)).toEqual([]);` respectively (matching the idiom already used in `CellTextSelection.test.ts:225`). The `_ruleCacheHas` assertions are unchanged.
     - [Lines 324-360](packages/lib/tests/component/input/TextClassStyleHoisting.test.ts#L324): only the **first** block changes. Replace lines 335-340 (`expect(decl1.lineHeight).toBeNull(); expect(decl1.textOverflow).toBeNull();` plus the `SKIPPABLE_FONT_KEYS` loop) with `expect(Object.keys(decl1)).toEqual([]);`. Leave the `_ruleCacheHas('.Text.lh40px')` line and the entire second block (342-359, the `setLineHeight(46)` + second `applyStyle()` call) untouched — its assertions check only `decl2.lineHeight` and `SKIPPABLE_FONT_KEYS`, both still `undefined` either way, so it needs no edit and continues to pass.
     *Check:* `npx vitest run tests/component/input/TextClassStyleHoisting.test.ts` from `packages/lib` — the four updated cases fail; the rest (the `Legend` case at line 262 and the custom-`fontSize` case at line 362, both of which keep a real deviating declaration and so keep materialising for real reasons) still pass unchanged.

   - **`packages/lib/tests/component/input/TextLineHeightValueClassSharing.test.ts`**: rewrite [row 5](packages/lib/tests/component/input/TextLineHeightValueClassSharing.test.ts#L210) (lines 210-224). Retitle to `'row 5: a fresh Text, never touching lineHeight, writes nothing to its own #id rule at all'`. Replace the comment (217-223) — drop "materialised only because textOverflow forces #id to exist" — and replace the two assertions with `expect(declarations).toEqual({});`.
     *Check:* `npx vitest run tests/component/input/TextLineHeightValueClassSharing.test.ts` from `packages/lib` — row 5 fails; rows 1-4, 6-7 are unaffected (none rests on a bare, no-other-deviation `Text`).

   - **`packages/lib/tests/component/table/CellTextSelection.test.ts`**: rewrite the `SelectableText` case at [lines 229-261](packages/lib/tests/component/table/CellTextSelection.test.ts#L229). Retitle to `"the renderer's SelectableText child writes no per-instance declarations at all"`. Replace the comment (239-255) with a short note referencing this plan, and replace the final assertions (256, 258-259) with `expect(Object.keys(declarations)).toEqual([]);` (mirroring the `StringRenderer` case immediately above it, line 225). `_ruleCacheHas('.SelectableText')` stays `toBe(true)`.
     *Check:* `npx vitest run tests/component/table/CellTextSelection.test.ts` from `packages/lib` — this one case fails.

2. **`core/Component.ts` — add the `applySubclassStyles` hook.** Insert the method shown in `## Internal Structure` immediately after `applyMiscInlineStyles()`'s closing brace ([line 5269](packages/lib/src/typescript/lib/core/Component.ts#L5269)), before the `materialiseWhenNeeded` doc comment. Add the call site `this.applySubclassStyles();` in `applyStyle` right after `this.applyMiscInlineStyles();` ([line 5031](packages/lib/src/typescript/lib/core/Component.ts#L5031)) and before the blank line + "Materialise last" comment.
   *Check:* `grep -n "applySubclassStyles" packages/lib/src/typescript/lib/core/Component.ts` — two matches (definition + call site).

3. **`component/input/Text.ts` — move the font/text declarations onto the hook.** Delete the `applyStyle` override in full, including its JSDoc ([lines 1511-1574](packages/lib/src/typescript/lib/component/input/Text.ts#L1511)). Add the `applySubclassStyles` override shown in `## Internal Structure` in the same location, with this JSDoc:
   ```typescript
   /**
    * Queues Text's twelve font/text declarations, routed through the class-rule
    * compare-and-skip/reconcile machinery so a Text with no per-instance font
    * override contributes none of them for real.
    *
    * @remarks Runs as `Component.applyStyle`'s pre-flush hook — before its one
    * materialising flush, not after a second one of Text's own — so a
    * construction-time value later corrected to a class-tier-matching removal
    * (`textOverflow`, from `setTruncate`'s unconditional dispatch in
    * `applyOptions`) is already corrected by the time that flush inspects the
    * dirty bag. See plans/applystyle-flush-order-empty-rule-fix.md.
    */
   ```
   *Check:* `grep -n "^\s*applyStyle(element" packages/lib/src/typescript/lib/component/input/Text.ts` — zero matches. `grep -n "applySubclassStyles" packages/lib/src/typescript/lib/component/input/Text.ts` — one match.

4. **Run the four updated test files.** `npx vitest run tests/component/input/TextTruncateWritePath.test.ts tests/component/input/TextClassStyleHoisting.test.ts tests/component/input/TextLineHeightValueClassSharing.test.ts tests/component/table/CellTextSelection.test.ts` from `packages/lib` — all green.

5. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib` — all green. `Legend`'s own applyStyle override (untouched) and `TabIndicator`/`Markdown` (untouched) need no test changes; confirm no other test broke by checking the run's failure count is zero.

6. **Amend the changelog.** See `## Documentation Impact`.

7. **Full verification.** See `## Verification`.

8. **Verify live in a browser, and record the Style Audit before/after numbers.** Non-negotiable — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Text.ts` |
| Modify | `packages/lib/tests/component/input/TextTruncateWritePath.test.ts` |
| Modify | `packages/lib/tests/component/input/TextClassStyleHoisting.test.ts` |
| Modify | `packages/lib/tests/component/input/TextLineHeightValueClassSharing.test.ts` |
| Modify | `packages/lib/tests/component/table/CellTextSelection.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-6 are unit-testable against the recording DOM sink (all six are exactly the cases step 1 rewrites). Rows 7-8 need a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | `new Text('x')` renders | `#id` rule never materialises — no `setRuleStyles` write recorded for that selector at all |
| 2 | `new Text('x', { fontWeight: 'bold' })` renders | `#id` materialises (real `fontWeight`), with `whiteSpace`/`textOverflow` recorded as `null` removals — unchanged from today |
| 3 | `new Text('x', { truncate: false })` renders | `#id` carries a real `textOverflow: 'clip'` — unchanged from today |
| 4 | `new Text('x', { lineHeight: 30 })` renders | `#id` never materialises (the numeric-mode `lineHeight` queue is already a `null` removal, and `textOverflow` now reconciles before the flush too); `.Text.lh30px` class-tier rule still materialises |
| 5 | A `Legend` (no font override) renders | `#id` still materialises, carrying real `marginLeft: '10px'`, with the ten skippable keys absent and `lineHeight`/`textOverflow` as `null` removals — unchanged from today |
| 6 | A rendered `Text` gets a direct second `applyStyle(element)` call after `setLineHeight` changed value | Same declarations as before this plan (`lineHeight` and the ten skippable keys stay `undefined`) — this call path is unaffected because it was never asserting the fixed thing |
| 7 | Manual — live app, `#/style-audit`, after opening at least one table window and one dialog | The `Text`/`plain`/`{ }` duplicate-rule group seen before this fix (134 instances in this plan's own live measurement) is gone entirely — either absent, or replaced by a much smaller group of genuinely-deviating instances only |
| 8 | Manual — live app, computed styles on a plain `Text`, a `Button` label, a table cell renderer, a `MenuItem` title, a `Dialog` title, a `Tooltip`, and a `Legend` | `white-space`/`text-overflow` resolve to the same values as before this fix; `Legend`'s `margin-left: 10px` is unaffected |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings (Text.applyStyle simply disappears from Text's own docs page, inherited from Component instead — expected, not a regression)
```

Grep invariants:

```
grep -n "applySubclassStyles" packages/lib/src/typescript/lib/core/Component.ts        # two matches: definition + call site
grep -n "applySubclassStyles" packages/lib/src/typescript/lib/component/input/Text.ts  # one match: the override
grep -n "^\s*applyStyle(element" packages/lib/src/typescript/lib/component/input/Text.ts  # zero matches
```

**Manual browser verification (rows 7-8) is required.** The offline harness records writes; it does not run a CSS cascade or let a rule's materialised-vs-not state be inspected after the fact the way the Style Audit panel can.

- Start a dev server on a spare port from *this worktree*, not the user's existing server (symlink `node_modules` to the repo root first if this worktree doesn't already have one — `ln -s <repo-root>/node_modules node_modules`), and confirm what it serves with `readlink /proc/<pid>/cwd` before trusting anything the browser shows.
- Reproduce this plan's own before-measurement first, against the unmodified code, to confirm the starting point still matches: open a table window (`#/misc` → "Show window with table (slow)!"), open and close a `Dialog — confirm/cancel`, then go to the "Style Audit" tab. Expect a `Text`/`plain` group with an empty `{ }` body — this plan's own run found 134 instances / 0.39 KB, out of 641 total per-instance rules.
- Apply the fix, restart the dev server, repeat the identical navigation, and re-check the Style Audit panel. The `Text`/`plain`/`{ }` group must be gone. Record the new total-rules / per-instance-rules / dedupeable-size figures alongside the before numbers.
- Read **computed styles**, not screenshots, for row 8.

---

## Documentation Impact

No exported/public API surface changes in the way a consumer calls things: `Text.applyStyle(element)` remains callable with the same signature and the same rendered result, now inherited from `Component` instead of overridden. `applySubclassStyles` is `protected`, so it does not appear in generated docs (TypeDoc excludes `private`/`protected` members). One expected, cosmetic side effect: `Text`'s TypeDoc page currently shows its own `applyStyle` entry with Text-specific `@remarks`; after this plan it shows `applyStyle` as inherited from `Component` instead, since `Text` no longer overrides it. This is not a broken or degraded doc — `Component.applyStyle`'s own JSDoc already describes the general hoisting/dedup behaviour that still applies to `Text`. No barrel or sidebar entry changes.

One amendment to `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Core`. The bullet beginning "**`white-space` and `text-overflow` now dedupe against the shared tier too...**" currently ends: "a `Text` with no per-instance font override no longer writes either declaration for real; both now resolve to an explicit removal instead." That is no longer the full picture — the previous plan closed the *value* gap but left an empty rule behind; this plan closes that too. Replace that clause with: "a `Text` with no per-instance font override no longer gets a `#id` rule inserted for either declaration at all." The rest of the bullet (the specificity-tie consequence, the raise-selector-specificity mitigation) is unchanged and still applies.

---

## Potential Challenges

- **Four pre-existing test files pin the current buggy behaviour as if it were intended** — each was written against the state the depended-on plan's own Implementation Notes documented as a known, unresolved gap. Step 1 enumerates every case precisely so none is missed or mis-updated.
- **`Text`'s own `applyStyle` JSDoc disappears from its docs page** (see `## Documentation Impact`) — expected, not a regression; `npm run docs:api`'s zero-warnings check is the mechanical guard that nothing else broke.
- **A future subclass with `Text`'s same shape (a construction-time-real, later-reconcilable value) must remember to use the new hook, not override `applyStyle` directly** — nothing enforces this mechanically; the hook's own doc comment states the rule and the precedent (`getRestingExclusionSuffixes`) makes the pattern discoverable.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/Component.ts` | `applyStyle` (5013), the six existing phases (5047-5269), `materialiseWhenNeeded` (5282) and `materialiseStyleRule` (5300) — the flush mechanism this plan reorders around; `getRestingExclusionSuffixes` (4863) — the precedent this plan's new hook mirrors |
| `packages/lib/src/typescript/lib/component/input/Text.ts` | `applyOptions`'s unconditional `setTruncate` dispatch (300) — the source of the stale construction-time value; `applyStyle` (1516, deleted by this plan) and its replacement `applySubclassStyles` |
| `packages/lib/src/typescript/lib/core/StyleTarget.ts` | `StyleRule.dispose` (325), `hasQueuedDeclarations`/`isMaterialized` (88-116) — the mechanism the rejected cleanup-based alternative would have used, and why it wasn't |
| `packages/lib/src/typescript/lib/core/DOM.ts` | `deleteStyleRule` (1597) — the O(N) linear scan that makes the cleanup-based alternative a measured perf hazard, not a hypothetical one |
| `plans/implemented/text-truncate-write-path-cleanup.md` | The depended-on plan; its own `## Implementation Notes` section first documented this exact gap and is this plan's starting point |
| `packages/lib/src/typescript/lib/component/container/TabBar.ts` | `TabIndicator.applyStyle` (279) — one of the three other `applyStyle` overrides confirmed unaffected |
| `packages/lib/src/typescript/lib/component/display/Markdown.ts` | `Markdown.applyStyle` (748) — confirmed unaffected |
| `packages/lib/src/typescript/lib/component/container/Legend.ts` | `Legend.applyStyle` (52) — confirmed unaffected; also a `Text` subclass, so it inherits this plan's fix without any change of its own |

---

## Non-Goals

- **Migrating `TabIndicator`, `Markdown`, or `Legend` onto the new `applySubclassStyles` hook.** None has the precondition this plan fixes (see `## Architecture Decisions`); moving them would be unjustified churn on working code.
- **Disposing a `#id` rule that was legitimately materialised (a real per-instance deviation existed) and later loses that deviation at runtime**, leaving it empty until the component tears down. This is pre-existing, accepted framework-wide behaviour — `_styleRule.dispose()` has exactly one call site, in `destructor()`, for every hoisted property (`backgroundColor`, `border`, `visibility`, …), not something introduced or worsened by this plan. Out of scope; this plan only fixes *premature* first-materialisation, not the separate question of whether a later-emptied rule should ever be reclaimed before teardown.
- **`setLineClamp`/`clearLineClamp`'s raw, unreconciled `textOverflow` write** ([Text.ts, per the depended-on plan's own Non-Goals](plans/implemented/text-truncate-write-path-cleanup.md)). Still out of scope — this plan only reorders already-reconciled writes; it does not reconcile a new one.
- **Speeding up `DOM.ts`'s `deleteStyleRule`.** This plan avoids ever needing it for the case it fixes, so there is no remaining motivation here to also make it faster.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^why-hook-not-cleanup]: The alternative of exposing `_inheritedStyleBag` to a subclass so `Text.applyStyle` could reconcile *before* calling `super.applyStyle()` was also considered and rejected: `_inheritedStyleBag` is only resolved *inside* `Component.applyStyle`'s own body (`ensureClassStyleRule(this.constructor, this.getClassStyleDefaults())`, packages/lib/src/typescript/lib/core/Component.ts#L5019), so a subclass would have to duplicate that resolution before calling `super()` — doubling the work and creating two potentially-divergent copies of the bag for one render pass. Running the subclass's contribution *inside* `Component.applyStyle`, after that resolution already happened once, is strictly simpler and is what the new hook does.

[^markdown-legend-detail]: Confirmed by reading `setElementCSSRule` (packages/lib/src/typescript/lib/core/Component.ts#L1714): every call queues into `_styleRule` and then, when `autoCommitStyle` is true (the default), immediately calls `commitCSSRule()` — which runs the identical `materialiseWhenNeeded` + `flush()` pair `materialiseStyleRule()` does. Because `Markdown`'s and `Legend`'s post-`super()` values are always real, this self-materialising call is always a legitimate insert (or addition to an already-real rule), never one based on a value that will later be corrected away.

[^perf-detail]: `applyStyle`'s three call sites are `Component.init()` (called once from `render()`, itself called once per element the component creates — the path hundreds of `Text` instances take when a table window opens), `Component.setId(id)` (only re-invokes `applyStyle` when the element already exists *and* a caller passes an explicit `id`, which none of the Text-heavy bulk-construction paths do), and `Component.sync()` (grepped across the library source: zero non-test, non-`Component.ts` call sites — effectively dead in application code today). So the dispose-based alternative's cost would land almost entirely on the first-render path, once per `Text` instance, during precisely the loop that constructs many `Text` instances back-to-back — each instance's `dispose()` call scanning a stylesheet whose rule count is growing from the very same loop.
