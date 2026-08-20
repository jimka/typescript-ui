---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Component `borderRadius` / `visibility` Write-Path Cleanup — Implementation Plan

## Overview

The in-app Style Audit panel (`#/style-audit`) found two unrelated `Component.ts` writes that cost real stylesheet bytes on every render, discovered in the same sweep that produced [`reconciled-write-path-widening.md`](plans/implemented/reconciled-write-path-widening.md) but missed by it. Both are fixed here because each is small (a handful of lines in one file) and neither depends on the other — bundling them avoids two near-empty plans for the same audit sweep, matching how `reconciled-write-path-widening.md` itself bundled seven unrelated properties into one plan.

**`borderRadius` (~7.5 KB, 146 duplicate instances, mostly `CheckboxBox`).** [`Component.applyChromeStyles()`](packages/lib/src/typescript/lib/core/Component.ts#L5082) writes `border-radius` to the component's own `#id` CSS rule on every render:

```typescript
const borderRadius = this.getBorderRadius();
if (borderRadius) {
    this.writeRuleDeclaration("borderRadius", borderRadius);
}
```

This write is dead weight, not a hoisting gap. [`Component.setBorderRadius()`](packages/lib/src/typescript/lib/core/Component.ts#L2528) writes the identical value straight to the element's **inline** style (`this.setElementStyle("borderRadius", borderRadius)`), and [`getBorderRadius()`](packages/lib/src/typescript/lib/core/Component.ts#L2517) has no class-default fallback (`return this._options.borderRadius ?? null;` only) — so `getBorderRadius()` can only be non-null after `setBorderRadius()` already ran, which means the inline style is always already present with the same value by the time this render-phase line fires. An inline style always outranks any CSS rule regardless of specificity, so the CSS-rule declaration this line queues can never be the one that actually renders — it is a second, byte-costly copy of a value the inline style already carries. See `## Architecture Decisions` for why this differs from `borderRadius`'s three chrome-group siblings (`border`, `shadow`, `backgroundImage`), which do **not** have this problem.

**`visibility` (spans `Component`, `BooleanEditor`, `DateRenderer`, `NumberRenderer`, `StringRenderer`, and every other class that ever calls `setVisible`).** Unlike `borderRadius`, `visibility` is already a fully-registered hoistable property — `FRAMEWORK_DECLARATIONS.visibility` and `resolveDeclarations()`'s unconditional `visibility` key already exist in [`ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L84-L100), untouched by this plan. The gap is purely on the `Component.ts` write side, and it is the exact shape `reconciled-write-path-widening.md` already fixed for seven other properties: [`setVisible()`](packages/lib/src/typescript/lib/core/Component.ts#L1843) writes through the raw, unconditional `this.setElementCSSRule("visibility", ruleValue)` instead of the reconciled path, and the two render-phase branches in [`applyBoxAndVisibilityStyles()`](packages/lib/src/typescript/lib/core/Component.ts#L4964-L4974) use the skip-based `writeRuleDeclaration` instead of `reconcileRuleDeclaration`. `setVisible` is dispatched from `applyOptions()` (`if (options.visible !== undefined) this.setVisible(options.visible);`, [Component.ts:615](packages/lib/src/typescript/lib/core/Component.ts#L615)) exactly like the seven properties `reconciled-write-path-widening.md` already migrated, so the same "runtime setter can fire before `_inheritedStyleBag` exists, then the render phase must clear-not-skip" reasoning that plan already established applies here unchanged — `visibility` was simply not in that plan's own property survey.

---

## Architecture Decisions

### `borderRadius`: delete the render-phase write, don't hoist it

`reconciled-write-path-widening.md`'s own scope note explains why `cursor` was excluded from that plan: `setCursor()` writes inline, so there is no lower-specificity CSS-rule tier a matching value could ever need to defer to, and "hoisting" doesn't apply. `borderRadius`'s runtime setter is inline for the identical reason — but unlike `cursor`, `borderRadius`'s render-phase write targets the CSS-rule buffer, not another inline write, so the two copies never come from the same buffer and can't accidentally race. Once the inline copy is confirmed always-present and always-correct (see `## Overview`), the CSS-rule copy has no job left: it is not read by anything else in the codebase[^no-rule-consumer], and deleting it removes the byte cost outright — for **every** component that sets a border-radius, not just the ones sharing a class (`Dialog`, `Notification`, `Menu`, `ProgressBar`, `Slider`, `Toggle`, and the rest of the 25+ call sites found via `grep -rn 'setBorderRadius(' packages/lib/src` typically construct only one or two instances each, so class-tier hoisting would not have deduped them even if `borderRadius` were added to `ClassStyleDefaults`).

This is a different fix shape from `visibility`'s (below) even though both were found in the same audit pass: `visibility` needs its existing hoisting machinery *reconciled against*; `borderRadius` needs a redundant write *removed*. Investigated and rejected: registering `borderRadius` on `ClassStyleDefaults` the way `outline`/`foregroundColor` are conditionally registered in `resolveDeclarations()`, then giving `CheckboxBox`/`RadioButtonRing` a class default and deleting their imperative `setBorderRadius` calls (the shape `checkbox-radio-delegate-static-style-defaults.md` used for `border`/`backgroundColor`). Rejected because it only dedupes for classes with two or more instances of the identical literal — it would fix `CheckboxBox` but leave every single-or-few-instance call site (the majority of the 25+ sites) writing its own now-still-redundant `#id` rule, where outright deletion fixes all of them at once with less code.

### `visibility`: same fix shape as `reconciled-write-path-widening.md`, applied to the one property its survey missed

No new reasoning is needed here — this plan follows that plan's established recipe exactly, substituting `visibility` for one of its seven properties: the runtime setter's raw `setElementCSSRule` call becomes `setReconciledCSSRules`, and the render-phase's `writeRuleDeclaration` calls become `reconcileRuleDeclaration`. `ClassStyleRules.ts` needs no change, matching that plan's own note that its `ClassStyleRules.ts` was already complete for the properties it covered.

`display`/`setDisplayed()` has the same raw-inline-write shape `borderRadius` has (`setElementStyle`, not `setElementCSSRule`) and was not part of this audit finding — left untouched; see `## Non-Goals`.

---

## Ordered Implementation Steps

1. **Write the tests first.** Create `packages/lib/tests/core/ComponentWritePathCleanup.test.ts` covering `## Expected Behaviour` rows 1-4. Follow `ClassChromeRules.test.ts`'s conventions: unique probe class names, `declarationsDuring`/`idSelector` copied from that file. This plan depends only on `component-chrome-base-tier-hoisting` (already implemented — it defines `reconcileRuleDeclaration`/`setReconciledCSSRules`), not on any of the not-yet-merged `reconciled-write-path-widening`/`checkbox-radio-delegate-*`/`state-chrome-isolation-generalization` lineage, so this plan does not assume any of their test files exist.
   *Check:* `npx vitest run tests/core/ComponentWritePathCleanup.test.ts` — every case fails for the expected reason (the old behaviour is still in place).

2. **`core/Component.ts` — delete `applyChromeStyles()`'s `borderRadius` block.** Remove the three lines at [Component.ts:5097-5100](packages/lib/src/typescript/lib/core/Component.ts#L5097-L5100):
   ```typescript
   const borderRadius = this.getBorderRadius();
   if (borderRadius) {
       this.writeRuleDeclaration("borderRadius", borderRadius);
   }
   ```
   Leave `getBorderRadius()` itself untouched (it stays a public getter, used elsewhere — confirmed via `grep -rn 'getBorderRadius(' packages/lib/tests`, which finds it exercised directly in `default-options-fallback.test.ts` and `TabButton.test.ts`, unrelated to this render-phase call).
   *Check:* `grep -n 'getBorderRadius()' packages/lib/src/typescript/lib/core/Component.ts` — one match only (the getter's own definition; the `applyChromeStyles` call site is gone). `npm run typecheck`.

3. **`core/Component.ts` — route `setVisible()` through the reconciled path.** Change [Component.ts:1882](packages/lib/src/typescript/lib/core/Component.ts#L1882) from `this.setElementCSSRule("visibility", ruleValue);` to `this.setReconciledCSSRules({ visibility: ruleValue });`. No other line in the method changes.
   *Check:* `grep -n 'this.setElementCSSRule("visibility"' packages/lib/src/typescript/lib/core/Component.ts` — zero matches.

4. **`core/Component.ts` — route `applyBoxAndVisibilityStyles()`'s two `visibility` writes through `reconcileRuleDeclaration`.** Change both branches at [Component.ts:4971](packages/lib/src/typescript/lib/core/Component.ts#L4971) and [:4973](packages/lib/src/typescript/lib/core/Component.ts#L4973) from `this.writeRuleDeclaration("visibility", ...)` to `this.reconcileRuleDeclaration("visibility", ...)`, same arguments, same surrounding `if`/`else`.
   *Check:* `grep -n 'writeRuleDeclaration("visibility"' packages/lib/src/typescript/lib/core/Component.ts` — zero matches. `grep -n 'reconcileRuleDeclaration("visibility"' packages/lib/src/typescript/lib/core/Component.ts` — two matches.

5. **Run the new test file.** `npx vitest run tests/core/ComponentWritePathCleanup.test.ts` — all green.

6. **Run the full suite and sweep for pre-existing tests pinned to the old behaviour.** `npx vitest run --no-file-parallelism` from `packages/lib`. Per `reconciled-write-path-widening.md`'s own Implementation Notes, expect a small number of pre-existing tests asserting a specific `visibility` value on a `#id`-scoped rule to need a `toBeUndefined()`/literal-value assertion switched to `toBeNull()`/a removal assertion, once a matching value dedupes instead of writing for real — `grep -rln "visibility" packages/lib/tests` (listed in `## Critical Files`) is the starting point. Any such change reflects the intended new behaviour, not a regression — confirm each one against `## Expected Behaviour` before editing it.

7. **Add the changelog entry.** See `## Documentation Impact`.

8. **Full verification.** See `## Verification`.

9. **Verify live in a browser.** Non-negotiable — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/core/ComponentWritePathCleanup.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-4 are unit-testable against the recording DOM sink. Row 5 needs a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | `new Component({ borderRadius: "4px" })`, rendered | The element's inline style carries `border-radius: 4px` (unchanged); the component's own `#id` CSS rule carries **no** `border-radius` declaration at all |
| 2 | `component.setBorderRadius("8px")` called after render, then `component.clearBorderRadius()` | Inline style goes `8px` → removed, exactly as today; at no point does the `#id` CSS rule carry a `border-radius` declaration |
| 3 | An already-rendered plain component (no class-level `visible` override, so the framework baseline `visibility: inherit` applies) calls `setVisible(false)`, then `setVisible(true)` | First call writes `visibility: hidden` for real to `#id` (deviates from the framework's `inherit` baseline); second call writes a `visibility` **removal**, not a skipped write — `true` resolves to `inherit`, which matches the baseline again |
| 4 | A component is constructed with `{ visible: false }` where the class also defaults `visible: false` | `applyOptions` dispatches `setVisible(false)` during `super()`, before `_inheritedStyleBag` exists, so it queues the value unconditionally; the first render's `applyBoxAndVisibilityStyles` phase then re-derives the same declaration through `reconcileRuleDeclaration` and overwrites the queued entry with a removal — the rendered `#id` rule carries no `visibility` declaration, not a stale duplicate (mirrors `reconciled-write-path-widening.md`'s row 5 for its own seven properties) |
| 5 | Manual — live app, `#/style-audit` on a tab with several `Checkbox`/`RadioButton` instances (for `borderRadius`) and a `Tab`/`Card` panel switch (for `visibility`) | The `CheckboxBox`/`RadioButtonRing` duplicate-rule rows no longer include a `border-radius` line; hidden/shown panels render identically; no visual change anywhere |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants:

```
grep -n 'this.getBorderRadius()' packages/lib/src/typescript/lib/core/Component.ts          # zero matches outside the getter's own body
grep -n 'this.setElementCSSRule("visibility"' packages/lib/src/typescript/lib/core/Component.ts   # zero matches
grep -n 'writeRuleDeclaration("visibility"' packages/lib/src/typescript/lib/core/Component.ts     # zero matches
```

**Manual browser verification (row 5) is required.** The offline harness records writes; it does not run a CSS cascade. Start a dev server on a spare port from *this worktree*, not the user's existing one. Exercise `#/inputs` (Checkbox/RadioButton), any `Tab`/`Card`/`AnimatedDropdown` panel-switch flow, and `#/style-audit`, reading computed styles rather than relying on screenshots.

---

## Documentation Impact

No exported symbol changes — `getBorderRadius`, `setVisible`, and the two protected write helpers keep their existing signatures. One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Core`:

> **`border-radius` no longer writes a redundant per-instance CSS rule declaration alongside its inline style, and `visibility` now dedupes against the class-tier default the same way `foregroundColor`/`outline`/`userSelect`/`minSize`/`maxSize`/`overflowX`/`overflowY` already do.** No consumer action needed; nothing changes visually.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/Component.ts` | Every line this plan touches: `getBorderRadius`/`setBorderRadius` (2517, 2528), `applyChromeStyles` (5082), `setVisible` (1843), `applyBoxAndVisibilityStyles` (4953) |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `FRAMEWORK_DECLARATIONS`/`resolveDeclarations` (84, 127) — confirms `visibility` is already fully registered and needs no change here |
| `plans/implemented/reconciled-write-path-widening.md` | Direct precedent for the `visibility` fix — same recipe, same caveats about pre-existing tests needing a removal-assertion update |
| `packages/lib/tests/core/ClassChromeRules.test.ts` | Test conventions this plan's new test file mirrors |
| `packages/lib/tests` (`grep -rln "visibility" packages/lib/tests`) | Candidate pre-existing tests to sweep in step 6: `Component.test.ts`, `EffectiveVisibility.test.ts`, `ClassStyleRules.test.ts`, `Card.test.ts`, `content-box-containment.test.ts`, and others the grep finds |

---

## Non-Goals

- **`display`/`setDisplayed()`.** Same inline-runtime-setter shape as `borderRadius` (`setElementStyle`, not `setElementCSSRule`), but `isDisplayed()` — unlike `getBorderRadius()` — folds through to a class default (`this._options.displayed ?? this._defaultOptions.displayed`), so its render-phase CSS-rule write is not provably dead: it is the only path that applies a class-level `displayed: false` default when no setter was ever called. Fixing it needs the same kind of care `visibility`'s own class-default-fallback getter already gets, not the `borderRadius` deletion — out of scope, not part of this audit finding.
- **`Glyph.setLineHeight()` / `ComboBox.setLineHeight()`.** Same raw `setElementCSSRule` shape as other unmigrated setters, found while investigating a related finding, but independent implementations unrelated to `Component`'s `borderRadius`/`visibility` — tracked separately if ever addressed.
- **Auditing every other `setElementStyle`-based setter for a matching dead render-phase rule write.** `borderRadius` was confirmed dead via its specific getter's lack of a class-default fallback; a general sweep for the same pattern elsewhere is a separate investigation, not attempted here.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^no-rule-consumer]: Confirmed via `grep -rln "borderRadius\|border-radius" packages/lib/tests`, excluding `Checkbox`/`RadioButton`/`TabButton` test files (which assert on the inline-style-backed `getBorderRadius()` getter, untouched by this plan) — no test anywhere asserts on a `border-radius` CSS-rule declaration, and no other source file reads `_styleRule`'s `border-radius` entry.
