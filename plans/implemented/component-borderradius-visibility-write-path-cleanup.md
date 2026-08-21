---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
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

This looks like a hoisting gap of the shape `reconciled-write-path-widening.md` already fixed for seven properties, and it is — but `borderRadius`'s runtime setter, [`Component.setBorderRadius()`](packages/lib/src/typescript/lib/core/Component.ts#L2528), writes straight to the element's **inline** style (`this.setElementStyle("borderRadius", borderRadius)`) rather than to the CSS rule the render-phase write above targets, so the two seams disagree about which one owns the property — a gap [`component-chrome-base-tier-hoisting.md`](plans/implemented/component-chrome-base-tier-hoisting.md#L304) explicitly found and deferred: *"`borderRadius`. Its runtime setter writes an inline style while `applyChromeStyles` writes a rule declaration, so the two seams disagree about who owns the property. Hoisting it needs that question settled first, which is a separate decision."* This plan settles it. `Component.applyStyle()` unconditionally wipes the element's whole inline `style` attribute on every render (`DOM.sink.apply(element, { removeAttr: ["style"] })`, before any of its six phase methods run) and nothing replays `border-radius` back onto it afterward, so the inline copy never survives past the render pass that wrote it — the CSS-rule write above is the only one that ever actually renders, not a redundant second copy of an always-correct inline value. See `## Architecture Decisions` for the fix and why it matches `borderRadius`'s three chrome-group siblings (`border`, `shadow`, `backgroundImage`), which already went through the reconciled write path.

**`visibility` (spans `Component`, `BooleanEditor`, `DateRenderer`, `NumberRenderer`, `StringRenderer`, and every other class that ever calls `setVisible`).** Unlike `borderRadius`, `visibility` is already a fully-registered hoistable property — `FRAMEWORK_DECLARATIONS.visibility` and `resolveDeclarations()`'s unconditional `visibility` key already exist in [`ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L84-L100), untouched by this plan. The gap is purely on the `Component.ts` write side, and it is the exact shape `reconciled-write-path-widening.md` already fixed for seven other properties: [`setVisible()`](packages/lib/src/typescript/lib/core/Component.ts#L1843) writes through the raw, unconditional `this.setElementCSSRule("visibility", ruleValue)` instead of the reconciled path, and the two render-phase branches in [`applyBoxAndVisibilityStyles()`](packages/lib/src/typescript/lib/core/Component.ts#L4964-L4974) use the skip-based `writeRuleDeclaration` instead of `reconcileRuleDeclaration`. `setVisible` is dispatched from `applyOptions()` (`if (options.visible !== undefined) this.setVisible(options.visible);`, [Component.ts:615](packages/lib/src/typescript/lib/core/Component.ts#L615)) exactly like the seven properties `reconciled-write-path-widening.md` already migrated, so the same "runtime setter can fire before `_inheritedStyleBag` exists, then the render phase must clear-not-skip" reasoning that plan already established applies here unchanged — `visibility` was simply not in that plan's own property survey.

---

## Architecture Decisions

### `borderRadius`: route it through the reconciled write path, matching its chrome-group siblings

**Revision note.** This plan originally proposed deleting `applyChromeStyles()`'s `borderRadius` block outright, reasoning that `setBorderRadius()`'s inline write already carried the correct value by the time the render phase ran. That premise was found false during implementation: `applyStyle()` unconditionally wipes the inline `style` attribute at the *start* of every render, before `applyChromeStyles()` (or any other phase) runs, and nothing replays `border-radius` back onto the inline style afterward the way `applyMiscInlineStyles()` does for `pointerEvents`/`writingMode`/`touchAction`/`zIndex`/`willChange`/`transition`/`opacity`. Confirmed empirically with a recording-sink probe: after `new Component({ borderRadius: '4px' }).getElement(true)`, the inline `style` carries no `border-radius` at all, while the `#id` CSS rule does — the CSS-rule write is the *only* one that ever renders. Deleting it as originally planned would have silently dropped `border-radius` from every component that sets one, on first render and on every subsequent full re-render (`sync()`/`setId()`) alike. This section replaces the original decision; see `## Implementation Notes` for how the revision was reached.

**The corrected fix: `borderRadius` joins `border`/`shadow`/`backgroundImage` on the reconciled path, exactly as `component-chrome-base-tier-hoisting.md` anticipated.** That plan's own `[^always-dispatch-group]` footnote (`plans/implemented/component-chrome-base-tier-hoisting.md#L320`) names `border`, `borderRadius`, `shadow`, and `backgroundImage` as "the chrome group" — `Component.applyChromeOptions()` folds each one's class default into its construction-time dispatch, and all three of `borderRadius`'s group-mates already write through `setReconciledCSSRules`/`reconcileRuleDeclaration`. `borderRadius` is the one member left on the old inline-setter / unreconciled-rule split, precisely because hoisting it was deferred pending this decision. `getBorderRadius()`'s lack of a class-default fallback (`this._options.borderRadius ?? null`, no `_defaultOptions` fold) is not a `borderRadius`-specific quirk — `getShadow()` has the identical shape, for the identical chrome-group reason (`applyChromeOptions` already dispatches the class default into `_options` at construction, and the getter must let a deeper subclass's `clear*()` suppress it rather than fall back to it). This confirms `borderRadius` belongs with `shadow`/`backgroundImage`, not with `cursor` (whose `getCursor()` *does* fold through to `_defaultOptions`, the same shape `display`/`isDisplayed()` has — see `## Non-Goals`).

The fix: `setBorderRadius()` changes from `this.setElementStyle("borderRadius", borderRadius)` to `this.setReconciledCSSRules({ borderRadius })`; `clearBorderRadius()` changes from an inline removal to `this.setElementCSSRule("borderRadius", null)` — a plain, unconditional `#id` removal, matching `clearOutline()`/`clearForegroundColor()`/`clearUserSelect()`'s shape rather than `clearBackgroundImage()`'s "assert a neutral value" shape, since border-radius has no browser-default-leaks-through hazard the way a UA background image would; and `applyChromeStyles()`'s render-phase write changes from `writeRuleDeclaration` to `reconcileRuleDeclaration`, bringing all four chrome-group properties in that method onto the identical helper. `ClassStyleRules.ts` needs a small, necessary addition: `ClassStyleDefaults.borderRadius?: string | null` and a conditional `if (defaults.borderRadius) declarations.borderRadius = defaults.borderRadius;` in `resolveDeclarations()`, mirroring `outline`/`foregroundColor`'s existing conditional registration — without it, `_inheritedStyleBag` never carries a `borderRadius` key for any class and the reconciled write could never dedupe anything, defeating its own purpose.

**Honest scoping of the byte-savings this delivers.** Unlike the withdrawn "delete" approach (which would have removed the write for all 25+ `setBorderRadius` call sites uniformly, unsafely), reconciliation only dedupes for classes with a **real class-level `borderRadius` default** — i.e. `_defaultOptions.borderRadius` set via a class's own `super(options, {...})` call. `grep -rn 'setBorderRadius(' packages/lib/src` finds the large majority of call sites are imperative, per-instance calls with no class default (`Dialog`, `Notification`, `Menu`, `ProgressBar`, `Slider`, `Toggle`, table cell editors, and more) — these gain the correctness fix (survives re-renders now) but no byte reduction, same conclusion the original Architecture Decision already reached about them. Two classes *do* dedupe under this fix: [`Button`](packages/lib/src/typescript/lib/component/button/Button.ts#L228) (`_defaultButtonOptions.borderRadius = "var(--ts-ui-border-radius, 4px)"`, inherited by ToggleButton/TabButton/SpinButton/IconButton and every other Button subclass — likely the single largest real-world win, larger than the plan's original `CheckboxBox` headline example) and the handful of classes `default-options-fallback.test.ts` already documents as having a `borderRadius` class default (`DiagramNode`, `DiagramGroupNode`, `Popover`, `PopupPanel`). `CheckboxBox`/`RadioButtonRing` — the plan's original 146-instance motivating example — do **not** dedupe under this fix: both set `borderRadius` via an *imperative* `this._box.setBorderRadius(...)` / `this._ring.setBorderRadius(...)` call ([`Checkbox.ts:242`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L242), [`RadioButton.ts:173`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L173)), not a class-level default, so there is nothing in `_inheritedStyleBag` for them to dedupe against. Giving them one — moving the literal into `CheckboxBox`'s/`RadioButtonRing`'s own `super(options, {...})` defaults bag and dropping the imperative call, the exact shape `checkbox-radio-delegate-static-style-defaults.md` already used for their `border`/`backgroundColor` — would close that gap too, and is a natural, low-risk follow-up, but it means editing `Checkbox.ts`/`RadioButton.ts`, which this plan's own scope (a `Component.ts`/`ClassStyleRules.ts` write-path cleanup) does not cover; left as future work rather than folded in here.

### `visibility`: same fix shape as `reconciled-write-path-widening.md`, applied to the one property its survey missed

No new reasoning is needed here — this plan follows that plan's established recipe exactly, substituting `visibility` for one of its seven properties: the runtime setter's raw `setElementCSSRule` call becomes `setReconciledCSSRules`, and the render-phase's `writeRuleDeclaration` calls become `reconcileRuleDeclaration`. `ClassStyleRules.ts` needs no change for `visibility` specifically, matching that plan's own note that its `ClassStyleRules.ts` was already complete for the properties it covered — `visibility` is already unconditionally registered in `FRAMEWORK_DECLARATIONS`/`resolveDeclarations()`. (`ClassStyleRules.ts` *does* change for `borderRadius`, above — the two properties needed different amounts of registration work even though both end up on the identical write-path mechanism.)

`display`/`setDisplayed()` has the same raw-inline-write shape `borderRadius` has (`setElementStyle`, not `setElementCSSRule`) and was not part of this audit finding — left untouched; see `## Non-Goals`.

---

## Ordered Implementation Steps

1. **Write the tests first.** Create `packages/lib/tests/core/ComponentWritePathCleanup.test.ts` covering `## Expected Behaviour` rows 1-6. Follow `ClassChromeRules.test.ts`/`ClassReconciledRules.test.ts`'s conventions: unique probe class names, `declarationsDuring`/`idSelector` copied from those files. This plan depends only on `component-chrome-base-tier-hoisting` (already implemented — it defines `reconcileRuleDeclaration`/`setReconciledCSSRules`), not on any of the not-yet-merged `reconciled-write-path-widening`/`checkbox-radio-delegate-*`/`state-chrome-isolation-generalization` lineage, so this plan does not assume any of their test files exist.
   *Check:* `npx vitest run tests/core/ComponentWritePathCleanup.test.ts` — every case fails for the expected reason (the old behaviour is still in place).

2. **`core/ClassStyleRules.ts` — register `borderRadius` as a conditional class-tier declaration.** Add `borderRadius?: string | null;` to the `ClassStyleDefaults` interface (alongside `shadow`/`backgroundImage`/`border`), and add `if (defaults.borderRadius) declarations.borderRadius = defaults.borderRadius;` to `resolveDeclarations()`, alongside the existing `backgroundColor`/`backgroundImage`/`shadow` conditional block. Mirrors `outline`/`foregroundColor`'s existing conditional-registration shape.
   *Check:* `npm run typecheck`.

3. **`core/Component.ts` — route `setBorderRadius()`/`clearBorderRadius()` through the reconciled path.** Change `setBorderRadius()`'s `this.setElementStyle("borderRadius", borderRadius);` to `this.setReconciledCSSRules({ borderRadius });`. Change `clearBorderRadius()`'s `this.setElementStyle("borderRadius", null);` to `this.setElementCSSRule("borderRadius", null);`. Neither method's idempotency guard or `_options.borderRadius` assignment changes.
   *Check:* `grep -n 'this.setElementStyle("borderRadius"' packages/lib/src/typescript/lib/core/Component.ts` — zero matches.

4. **`core/Component.ts` — route `applyChromeStyles()`'s `borderRadius` write through `reconcileRuleDeclaration`.** Change `this.writeRuleDeclaration("borderRadius", borderRadius);` to `this.reconcileRuleDeclaration("borderRadius", borderRadius);`, same surrounding `if (borderRadius) { ... }` guard, no `else` branch (matching `outline`'s shape in the same method).
   *Check:* `grep -n 'writeRuleDeclaration("borderRadius"' packages/lib/src/typescript/lib/core/Component.ts` — zero matches. `grep -n 'reconcileRuleDeclaration("borderRadius"' packages/lib/src/typescript/lib/core/Component.ts` — one match.

5. **`core/Component.ts` — route `setVisible()` through the reconciled path.** Change [Component.ts:1882](packages/lib/src/typescript/lib/core/Component.ts#L1882) from `this.setElementCSSRule("visibility", ruleValue);` to `this.setReconciledCSSRules({ visibility: ruleValue });`. No other line in the method changes.
   *Check:* `grep -n 'this.setElementCSSRule("visibility"' packages/lib/src/typescript/lib/core/Component.ts` — zero matches.

6. **`core/Component.ts` — route `applyBoxAndVisibilityStyles()`'s two `visibility` writes through `reconcileRuleDeclaration`.** Change both branches at [Component.ts:4971](packages/lib/src/typescript/lib/core/Component.ts#L4971) and [:4973](packages/lib/src/typescript/lib/core/Component.ts#L4973) from `this.writeRuleDeclaration("visibility", ...)` to `this.reconcileRuleDeclaration("visibility", ...)`, same arguments, same surrounding `if`/`else`.
   *Check:* `grep -n 'writeRuleDeclaration("visibility"' packages/lib/src/typescript/lib/core/Component.ts` — zero matches. `grep -n 'reconcileRuleDeclaration("visibility"' packages/lib/src/typescript/lib/core/Component.ts` — two matches.

7. **Run the new test file.** `npx vitest run tests/core/ComponentWritePathCleanup.test.ts` — all green.

8. **Run the full suite and sweep for pre-existing tests pinned to the old behaviour.** `npx vitest run --no-file-parallelism` from `packages/lib`. Per `reconciled-write-path-widening.md`'s own Implementation Notes, expect a small number of pre-existing tests asserting a specific `visibility`/`border-radius` value on a `#id`-scoped rule to need a `toBeUndefined()`/literal-value assertion switched to `toBeNull()`/a removal assertion, once a matching value dedupes instead of writing for real — `grep -rln "visibility\|borderRadius\|border-radius" packages/lib/tests` (listed in `## Critical Files`) is the starting point. Any such change reflects the intended new behaviour, not a regression — confirm each one against `## Expected Behaviour` before editing it.

9. **Add the changelog entry.** See `## Documentation Impact`.

10. **Full verification.** See `## Verification`.

11. **Verify live in a browser.** Non-negotiable — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/core/ComponentWritePathCleanup.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-6 are unit-testable against the recording DOM sink. Row 7 needs a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | A class defaults `borderRadius`; `setBorderRadius()` to a different real value after render, then back to the class-default value | First call writes the new value for real to `#id`; second call writes a `borderRadius` **removal**, not silence — matches `ClassReconciledRules.test.ts`'s row 1 shape (e.g. `foregroundColor`) |
| 2 | A class with **no** `borderRadius` default; `setBorderRadius()` after render | Writes the real value to `#id`, unchanged from today — nothing to dedupe against |
| 3 | A component is constructed with `{ borderRadius: "4px" }` where the class also defaults `borderRadius: "4px"` | `applyOptions` dispatches `setBorderRadius("4px")` during `super()`, before `_inheritedStyleBag` exists, so it queues the value unconditionally; the first render's `applyChromeStyles` phase then re-derives the same declaration through `reconcileRuleDeclaration` and overwrites the queued entry with a removal — the rendered `#id` rule carries no `borderRadius` declaration, not a stale duplicate (mirrors `reconciled-write-path-widening.md`'s row 5 for its own seven properties) |
| 4 | `component.clearBorderRadius()` called after render | Writes a plain, unconditional `borderRadius` removal to `#id`, regardless of whether the class has a default — matches `clearOutline()`/`clearForegroundColor()`'s shape |
| 5 | An already-rendered plain component (no class-level `visible` override, so the framework baseline `visibility: inherit` applies) calls `setVisible(false)`, then `setVisible(true)` | First call writes `visibility: hidden` for real to `#id` (deviates from the framework's `inherit` baseline); second call writes a `visibility` **removal**, not a skipped write — `true` resolves to `inherit`, which matches the baseline again |
| 6 | A component is constructed with `{ visible: false }` where the class also defaults `visible: false` | Same reconcile-after-unconditional-queue shape as row 3, for `visibility` via `applyBoxAndVisibilityStyles` |
| 7 | Manual — live app, `#/style-audit` on a tab with several `Button`/`Checkbox`/`RadioButton` instances and a `Tab`/`Card` panel switch, plus a forced second render pass (e.g. `component.sync()`) on a component with a real, non-defaulted `borderRadius` | `Button`'s duplicate-rule row shrinks or disappears from the Style Audit panel (class-level default now dedupes); `CheckboxBox`/`RadioButtonRing`'s duplicate-rule rows are unchanged (documented follow-up, not covered by this plan); a single-instance `borderRadius` (e.g. `Dialog`) still renders correctly *after* a forced second render pass, proving the CSS-rule copy survives the inline-style wipe; hidden/shown panels render identically; no visual change anywhere else |

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
grep -n 'this.setElementStyle("borderRadius"' packages/lib/src/typescript/lib/core/Component.ts    # zero matches
grep -n 'writeRuleDeclaration("borderRadius"' packages/lib/src/typescript/lib/core/Component.ts     # zero matches
grep -n 'this.setElementCSSRule("visibility"' packages/lib/src/typescript/lib/core/Component.ts     # zero matches
grep -n 'writeRuleDeclaration("visibility"' packages/lib/src/typescript/lib/core/Component.ts       # zero matches
```

**Manual browser verification (row 7) is required.** The offline harness records writes; it does not run a CSS cascade. Start a dev server on a spare port from *this worktree*, not the user's existing one. Exercise `#/inputs` (Checkbox/RadioButton), any `Tab`/`Card`/`AnimatedDropdown` panel-switch flow, `#/style-audit`, and a forced second render pass (`sync()`) on a component with a real `borderRadius`, reading computed styles rather than relying on screenshots.

---

## Documentation Impact

No exported symbol changes — `getBorderRadius`, `setBorderRadius`, `clearBorderRadius`, `setVisible`, and the protected write helpers keep their existing signatures. One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Core`:

> **`border-radius` now dedupes against the class-tier default the same way `foregroundColor`/`outline`/`userSelect`/`minSize`/`maxSize`/`overflowX`/`overflowY` already do, and `visibility` now does too.** `border-radius` also moves from an inline style to the same `#id`/`.ClassName` stylesheet-rule tier its `border`/`shadow`/`background-image` siblings already use — a consumer reading `element.style.borderRadius` directly will no longer find it there, and (as with the earlier hoisting notes) a consumer stylesheet rule targeting a component by class now ties with the generated `.ClassName` rule where the framework's per-instance rule previously always won. No other consumer action is needed; nothing changes visually.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/Component.ts` | Every line this plan touches: `getBorderRadius`/`setBorderRadius`/`clearBorderRadius` (2517, 2528, 2543), `applyChromeStyles` (5082), `setVisible` (1843), `applyBoxAndVisibilityStyles` (4953) |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `ClassStyleDefaults`/`resolveDeclarations` — gains a conditional `borderRadius` entry mirroring `outline`/`foregroundColor`; `visibility` is already fully registered and needs no change |
| `plans/implemented/reconciled-write-path-widening.md` | Direct precedent for the `visibility` fix, and for `borderRadius`'s `setReconciledCSSRules`/`reconcileRuleDeclaration` shape — same recipe, same caveats about pre-existing tests needing a removal-assertion update |
| `plans/implemented/component-chrome-base-tier-hoisting.md` | Its Non-Goal (L304) explicitly deferred `borderRadius` pending "who owns the property" being settled — this plan is that settlement. Its `[^always-dispatch-group]` footnote (L320) is the source for the chrome-group membership reasoning in `## Architecture Decisions` |
| `packages/lib/src/typescript/lib/component/button/Button.ts` | `_defaultButtonOptions.borderRadius` (228) — the largest real-world class-level default this fix now dedupes |
| `packages/lib/src/typescript/lib/component/input/Checkbox.ts`, `.../RadioButton.ts` | `setBorderRadius` called imperatively on an internal delegate (242, 173) — the plan's original 146-instance motivating example, which this fix does **not** dedupe (no class default); see the Architecture Decision's scoping note |
| `packages/lib/tests/core/ClassChromeRules.test.ts`, `ClassReconciledRules.test.ts` | Test conventions this plan's new test file mirrors |
| `packages/lib/tests` (`grep -rln "visibility\|borderRadius\|border-radius" packages/lib/tests`) | Candidate pre-existing tests to sweep in step 8 |

---

## Non-Goals

- **`display`/`setDisplayed()`.** Same originally-inline-runtime-setter shape `borderRadius` had (`setElementStyle`, not `setElementCSSRule`), but `isDisplayed()` — unlike `getBorderRadius()`/`getShadow()` — folds through to a class default (`this._options.displayed ?? this._defaultOptions.displayed`), the same shape `getCursor()` has. Whether its render-phase CSS-rule write needs the `borderRadius` treatment (route the runtime setter through the reconciled path too) or the `willChange`/`touchAction` treatment (an inline replay in `applyMiscInlineStyles`) is a separate decision, needing the same kind of investigation this plan just did for `borderRadius` — out of scope, not part of this audit finding.
- **`CheckboxBox`/`RadioButtonRing` class-level `borderRadius` defaults.** Both delegate classes set `borderRadius` via an imperative per-instance call rather than a class default (see `## Architecture Decisions`), so this plan's fix does not dedupe their ~146 duplicate-rule bytes — the plan's own original motivating example. Closing that gap means editing `Checkbox.ts`/`RadioButton.ts` (giving each delegate its own class default, the shape `checkbox-radio-delegate-static-style-defaults.md` already used for `border`/`backgroundColor`), outside this plan's `Component.ts`/`ClassStyleRules.ts` scope — a natural, low-risk follow-up, not attempted here.
- **`Glyph.setLineHeight()` / `ComboBox.setLineHeight()`.** Same raw `setElementCSSRule` shape as other unmigrated setters, found while investigating a related finding, but independent implementations unrelated to `Component`'s `borderRadius`/`visibility` — tracked separately if ever addressed.
- **Auditing every other `setElementStyle`-based setter for a matching write-path-ownership gap.** `borderRadius` needed genuine investigation (a static read of `getBorderRadius()`'s missing class-default fallback was not enough on its own, and led this plan's first draft to the wrong conclusion); a general sweep of every other `setElementStyle`-based setter for the same "which seam owns this property" question is a separate investigation, not attempted here.
- **Bumping the package version.** Release-time bookkeeping.

---

## Implementation Notes

**The `borderRadius` half of this plan's original Architecture Decision ("delete the render-phase write, don't hoist it") was found to rest on a false premise, and was revised rather than implemented as originally written.** That decision claimed the render-phase CSS-rule write was dead weight because "the inline style is always already present with the same value by the time this render-phase line fires." Tracing `applyStyle()`'s actual execution order — and confirming empirically with a recording-sink probe (`new Component({ borderRadius: '4px' })` then `getElement(true)`, inspecting `sink.writes` directly) — showed the opposite: `applyStyle()`'s first line unconditionally wipes the whole inline `style` attribute before any of its six phase methods run, and none of them replay `border-radius` back onto the inline style the way `applyMiscInlineStyles()` does for `pointerEvents`/`willChange`/`transition`/etc. Implementing the original step 2 (deletion) would have silently dropped `border-radius` from every affected component. Work paused here first: per `worker.md`'s "Codebase drift... stop and ask the user. Do not silently re-plan around it," a broken plan premise is not something the `implement` skill redesigns around unilaterally, so the `visibility` half (unaffected — see below) was implemented and the `borderRadius` half was left undone, with the above reasoning recorded and reported as a blocking finding.

**On review, the investigation was continued rather than closed.** `plans/implemented/component-chrome-base-tier-hoisting.md`'s own Non-Goal (`#L304`) had already flagged this exact "two seams disagree about ownership" question and explicitly deferred it as "a separate decision" — meaning this plan's job was always to settle that question, not merely to decide whether the render-phase write happened to be redundant. Re-reading that plan's `[^always-dispatch-group]` footnote surfaced the actual answer: `border`, `borderRadius`, `shadow`, and `backgroundImage` are named there as one "chrome group," all dispatched through `applyChromeOptions`'s always-fold-in-default mechanism, and three of the four already write through the reconciled path (`setReconciledCSSRules`/`reconcileRuleDeclaration`). `getBorderRadius()`'s getter shape (no `_defaultOptions` fallback) — which the withdrawn Architecture Decision read as `borderRadius`-specific, analogous to `cursor` — turned out to be the identical shape `getShadow()` already has, for the identical chrome-group reason. `borderRadius` was simply the one group member not yet migrated. The corrected Architecture Decision above (routing `borderRadius` through the reconciled path, matching its three siblings, with the small necessary `ClassStyleRules.ts` registration) is the result, implemented and tested per `## Expected Behaviour` rows 1-4.

**This also means the plan's original "outright deletion beats partial class-default registration" reasoning no longer applies, since deletion is no longer a candidate.** The alternative that reasoning was comparing against and rejecting — registering `borderRadius` on `ClassStyleDefaults` — is exactly what the corrected fix does; only the further step of also giving `CheckboxBox`/`RadioButtonRing` their own class-level defaults (which would additionally close the plan's original 146-instance motivating example) remains deferred, now for a scope reason (editing consumer components, outside this plan's `Component.ts`/`ClassStyleRules.ts` footprint) rather than a rejected-alternative reason — see `## Non-Goals`.

**The `visibility` half (Ordered Implementation Steps 5-6) was unaffected by any of the above and was implemented, tested, and verified as specified throughout.** `visibility` is written only through `_styleRule` (the `#id` CSS rule), both before and after this change — never through the inline `_inlineStyle` buffer — so it never goes through the wipe the `borderRadius` finding concerns. `setVisible()` routes through `setReconciledCSSRules`, and `applyBoxAndVisibilityStyles()`'s two branches route through `reconcileRuleDeclaration`, exactly as planned.

**Live browser verification (row 7) performed and recorded here**, since `Component.ts`'s recording-sink test suite logs rule writes but evaluates no CSS cascade. Ran `npx vite --port 8018 --strictPort` from this worktree's `packages/lib` (confirmed via `readlink /proc/<pid>/cwd`), driven with the `chrome-devtools` MCP tools:
- `#/tab`: switching the top strip from "Alpha" to "Beta" flips each panel's `getComputedStyle(...).visibility` correctly (Alpha `visible`→`hidden`, Beta `hidden`→`visible`) with no inline `style` attribute carrying `visibility` on either panel — confirming the class/framework tier supplies the value once the `#id` declaration is gone, and no visual regression (screenshot: "Content: Beta" rendered cleanly, no flash of hidden content, no layout shift).
- `#/misc`'s "Animated dropdowns" `ComboBox`: opening it renders a live `.ComboBoxDropdown` (`AnimatedDropdown` subclass, the one class in the repo defaulting `visible: false`) with `computedVisibility: "visible"` and no inline `visibility`; closing it (Escape) removes the element from the DOM entirely (this component tears down rather than toggling hidden).
- `#/style-audit`: the duplicate-`#id`-rule report shows no `visibility` row at all.
- No console errors or warnings during the session (`list_console_messages` showed one unrelated pre-existing log line).

**A second live-browser pass, after the `borderRadius` revision, verified the actual bug this plan set out to fix.** Same setup as above (fresh `npx vite --port 8018 --strictPort` from this worktree, `readlink /proc/<pid>/cwd` confirmed, `chrome-devtools` MCP tools), navigating `#/misc`, `#/tab`, `#/multiselect`, `#/property-grid`, then `#/style-audit`:
- **The Style Audit panel's own numbers are the clearest evidence.** Before this revision (visibility-only session): the panel listed a `Button, FieldSet, NotificationHistoryButton, PopupButton` row with body `{ border-radius: var(--ts-ui-border-radius, 4px); }` (74 instances, 3.64 KB). After the revision, scanning the full duplicate-rule report (848 total rules, 758 per-instance) for any row whose body contains `border-radius` finds only two: `TextField` (`border-radius: 0px`, bundled into an unrelated compound border-reset declaration, never routed through `setBorderRadius`) and a bare `Component` (`border-radius: 50%`, `Slider`'s thumb — an imperative, no-class-default call site, exactly the "does not dedupe" case `## Architecture Decisions` predicts). **No `Button` row remains** — the class-level default now dedupes as designed.
- **Confirmed the mechanism directly**, not just the panel's summary: `getComputedStyle()` on a live "Show window with image!" button reports `border-radius: 4px`, its inline `style` attribute carries only geometry (`left`/`top`/`width`/`height`, no `border-radius`), and reading the live stylesheet finds `.Button { ... border-radius: var(--ts-ui-border-radius, 4px); ... }` — the rounded corner is supplied entirely by the `.Button` class-tier rule now, not an inline style or a per-instance `#id` rule, and it renders correctly.
- **The re-render-survival case this plan exists to fix** (a `borderRadius` value surviving `applyStyle()`'s inline wipe on a second and later render pass) is the exact mechanism Expected Behaviour row 3's offline test already exercises — `reconcileRuleDeclaration` re-derives and re-queues the correct declaration from `getBorderRadius()` on *every* `applyChromeStyles()` call, not just the first, so there is no render-count-dependent behaviour left to separately probe live; the panel and computed-style checks above confirm the same mechanism holds in a real cascade.
- No console errors or warnings during the session (`list_console_messages` returned none).
