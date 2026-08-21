---
touches-shared:
  - packages/lib/src/typescript/lib/component/input/Checkbox.ts
---

# CheckboxBox Border-Radius Class-Default Hoist — Implementation Plan

## Overview

The in-app Style Audit panel (`#/style-audit`) reports a `CheckboxBox` duplicate-rule row whose body is `{ border-radius: var(--ts-ui-checkbox-radius, 3px); }` — the same declaration, byte-for-byte, on every rendered `Checkbox`'s own `#id` stylesheet rule. The original bug report measured 114 instances / 5.85 KB on a table with a boolean column; re-running the live Style Audit panel on this branch today (a different demo scene — a "Show window with table" scenario on `#/misc`) shows the identical row shape at 32 instances / 1.60 KB.[^live-verify] The count is demo-data-dependent, not a fixed number — what matters is the row exists at all, and it does.

The cause is in [`Checkbox.ts`](packages/lib/src/typescript/lib/component/input/Checkbox.ts): `CheckboxBox` — the module-private `Component` subclass backing the checkbox's outer box — declares its static geometry, cursor, resting background, and resting border as class defaults in `_defaultCheckboxBoxOptions` ([Checkbox.ts:20-27](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L20-L27)), so every instance shares one `.CheckboxBox` CSS rule for those. `border-radius` never joined that bag. Instead, `Checkbox`'s own constructor sets it imperatively on the already-constructed box: `this._box.setBorderRadius("var(--ts-ui-checkbox-radius, 3px)");` ([Checkbox.ts:242](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L242)) — a literal, identical on every instance, that never varies. Because `CheckboxBox`'s own class-default bag has no `borderRadius` entry, the framework's class-tier dedup mechanism has nothing to compare the write against, and writes the real value to the instance's own `#id` rule every time.

The fix is exactly the move [`checkbox-radio-delegate-static-style-defaults.md`](plans/implemented/checkbox-radio-delegate-static-style-defaults.md) already made for `backgroundColor`/`border`/`cursor`/size on this same class: add `borderRadius` to `_defaultCheckboxBoxOptions`, delete the now-redundant imperative call. Investigation (below) found this needs **no other code change** — the write path, the class-tier registration, and the dedup mechanism were all already generalised by [`component-borderradius-visibility-write-path-cleanup.md`](plans/implemented/component-borderradius-visibility-write-path-cleanup.md), which explicitly named this exact follow-up in its own Non-Goals and left it undone only because it required editing `Checkbox.ts`, outside that plan's `Component.ts`/`ClassStyleRules.ts` scope. One consequence did surface during investigation that neither precedent anticipated: fixing this also stops `_box`'s `#id` rule from being created at all (not just this one declaration), which changes the literal writes two pre-existing tests assert — see `## Architecture Decisions` and `## Addendum`.

---

## Architecture Decisions

### Move the literal into `_defaultCheckboxBoxOptions`; delete the imperative call

Add `borderRadius: "var(--ts-ui-checkbox-radius, 3px)"` to `_defaultCheckboxBoxOptions` ([Checkbox.ts:20-27](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L20-L27)), placed immediately after `border:` — the same adjacency [`Button.ts`](packages/lib/src/typescript/lib/component/button/Button.ts)'s own `_defaultButtonOptions` uses ([Button.ts:227-228](packages/lib/src/typescript/lib/component/button/Button.ts#L227-L228)), which is the existing proof this exact mechanism already dedupes a class-defaulted `borderRadius` correctly for a live class. Delete `this._box.setBorderRadius("var(--ts-ui-checkbox-radius, 3px)");` at [Checkbox.ts:242](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L242).

This is the same move `checkbox-radio-delegate-static-style-defaults.md` already made on this exact class for `backgroundColor`, `border`, `cursor`, and size — that plan's own Non-Goals named `borderRadius` as the one property it could not yet move, because at the time its write path was still inline-style-only and unregistered.[^why-not-then] `component-borderradius-visibility-write-path-cleanup.md` closed that gap for the write path in general and named this exact class-level follow-up in its own Non-Goals, deferred only for being out of its `Component.ts`/`ClassStyleRules.ts` scope. This plan is that follow-up.

### No change needed in `ClassStyleRules.ts` or `Component.ts`

`CheckboxBox` declares no `ownClassStyleDefaults` static field, and neither does any class between it and `Component` in its prototype chain (it `extends Component` directly). `chainParticipates()` ([ClassStyleRules.ts:342-364](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L342-L364)) walks that chain looking for one and finds none, so `ensureClassStyleRule()` ([ClassStyleRules.ts:589-635](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L589-L635)) takes its flat, pre-hierarchy branch ([:611-628](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L611-L628)): it diffs whatever `getClassStyleDefaults()` returns against `FRAMEWORK_DECLARATIONS` directly. `Component`'s base `getClassStyleDefaults()` ([Component.ts:4992-4994](packages/lib/src/typescript/lib/core/Component.ts#L4992-L4994)) returns `this._defaultOptions` verbatim, and `CheckboxBox` never overrides it. `borderRadius` is already a registered `ClassStyleDefaults` key ([ClassStyleRules.ts:52](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L52), conditionally folded into the resolved bag at [:207](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L207)). So adding the field to `_defaultCheckboxBoxOptions` is picked up automatically, with zero further code.

The render-time write is likewise already migrated: `setBorderRadius()`/`clearBorderRadius()` already route through `setReconciledCSSRules()`/a plain removal ([Component.ts:2613-2636](packages/lib/src/typescript/lib/core/Component.ts#L2613-L2636)), and `applyChromeStyles()`'s own `borderRadius` write already uses `reconcileRuleDeclaration()` ([Component.ts:5191-5194](packages/lib/src/typescript/lib/core/Component.ts#L5191-L5194)) — both shipped by `component-borderradius-visibility-write-path-cleanup.md`, confirmed unchanged on this branch by direct reading, not assumed from that plan's own account.

### Deleting the imperative call is safe: `applyChromeOptions`'s always-dispatch reproduces it

`border`, `borderRadius`, `shadow`, and `backgroundImage` are Component's "chrome group": `applyChromeOptions()` ([Component.ts:733-743](packages/lib/src/typescript/lib/core/Component.ts#L733-L743)) folds `options.borderRadius ?? this._defaultOptions.borderRadius` and, whenever the result isn't `undefined`, calls `this.setBorderRadius(...)` unconditionally — from inside `applyOptions()`, which runs during `super()`. Once `_defaultCheckboxBoxOptions.borderRadius` is set, this fires on every `CheckboxBox`'s own construction, setting `_options.borderRadius` and queuing the value exactly as the deleted call used to. `getBorderRadius()` ([Component.ts:2602-2604](packages/lib/src/typescript/lib/core/Component.ts#L2602-L2604)) returns `this._options.borderRadius ?? null` — unfolded, but populated regardless, because the always-dispatch already wrote it into `_options`. Nothing reads a different value, and nothing reads it at a different time: this is the identical mechanism `border` and `backgroundColor` already rely on for their own class defaults on this same `CheckboxBox`.

### Deleting the call also stops `_box`'s `#id` rule from materialising at all — two existing tests assert the old shape

Once `borderRadius` also matches the class default, **every** declaration `_box` would otherwise queue onto its own `#id` rule during a first render is a `null` removal — border-radius joins the size/background/border declarations that already dedupe. A `StyleRule` only materialises when it already exists or its dirty bag holds at least one non-null entry ([`hasQueuedDeclarations`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L108), consulted by [`materialiseWhenNeeded`](packages/lib/src/typescript/lib/core/Component.ts#L5282-L5286)) — an all-null bag is skipped outright, per that method's own doc comment. Confirmed with a throwaway, reverted probe test against this branch's *current* (unfixed) code: a fresh `Checkbox`'s first render today queues exactly this to `_box`'s `#id` rule —

```
borderTop: null, borderRight: null, borderBottom: null, borderLeft: null,
borderRadius: "var(--ts-ui-checkbox-radius, 3px)",   // the only non-null entry
visibility: null, minWidth: null, minHeight: null, maxWidth: null, maxHeight: null,
overflowX: null, overflowY: null, whiteSpace: null, userSelect: null
```

`borderRadius` is the *only* real value in that bag — everything else already dedupes. Once it also resolves to `null`, the bag holds nothing but removals, `hasQueuedDeclarations()` returns `false`, and `_box`'s `#id` rule is never created at all — not "created with an empty body," genuinely never written. Full trace and the exact test fallout are in `## Addendum`.

---

## Internal Structure

`Checkbox.ts`, `_defaultCheckboxBoxOptions` — before → after:

```typescript
// Before
const _defaultCheckboxBoxOptions: Partial<ComponentOptions> = {
    preferredSize:   { width: 16, height: 16 },
    minSize:         { width: 16, height: 16 },
    maxSize:         { width: 16, height: 16 },
    cursor:          "pointer",
    backgroundColor: "var(--ts-ui-checkbox-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))",
    border:          "1px solid var(--ts-ui-form-border, rgb(160, 160, 160))",
};
```

```typescript
// After
const _defaultCheckboxBoxOptions: Partial<ComponentOptions> = {
    preferredSize:   { width: 16, height: 16 },
    minSize:         { width: 16, height: 16 },
    maxSize:         { width: 16, height: 16 },
    cursor:          "pointer",
    backgroundColor: "var(--ts-ui-checkbox-bg, var(--ts-ui-form-bg, rgb(255, 255, 255)))",
    border:          "1px solid var(--ts-ui-form-border, rgb(160, 160, 160))",
    borderRadius:    "var(--ts-ui-checkbox-radius, 3px)",
};
```

Constructor — before → after (only the marked line is removed; every other line is untouched):

```typescript
        this._box = new CheckboxBox();
        // Min = preferred = max so the outer HBox shrink-on-overallocation
        // can't collapse the box graphic when the checkbox sits next to
        // flexible siblings.
        this._box.setSize({ width: 16, height: 16 });
        this._box.setBorderRadius("var(--ts-ui-checkbox-radius, 3px)");   // ← delete

        this._check = new CheckboxCheckGlyph();
```

---

## Ordered Implementation Steps

1. **Update `Checkbox.test.ts`'s "row 1" to the post-fix shape.** In the `describe('Checkbox delegate static style hoisting', ...)` block ([Checkbox.test.ts:202-223](packages/lib/tests/component/input/Checkbox.test.ts#L202-L223)), change the four `expect(declarations.minWidth/minHeight/maxWidth/maxHeight).toBeNull()` assertions to `.toBeUndefined()`, matching the existing `cursor` assertion's shape. Replace the comment above them (lines 209-215) — it currently explains why these surface as explicit `null` removals "because backgroundColor/border/borderRadius force #id to materialise regardless"; once `borderRadius` also matches the class default, nothing forces materialisation, so `#id` is never written at all and every key here is simply absent. Word the new comment as: `_box`'s `backgroundColor`/`border`/`borderRadius` are now all class defaults, so nothing on a default-styled `_box` deviates from `.CheckboxBox` at all — `#id` never materialises, and every key here (including size) is an absent write, not an explicit removal.
   *Check:* `npx vitest run tests/component/input/Checkbox.test.ts` — the four updated assertions fail against the current, unfixed source (`declarations` still holds real writes because `borderRadius` still forces `#id` to materialise).

2. **Update `Checkbox.stateClassHoisting.test.ts`'s "row 3" resting section to the post-fix shape.** In `it('row 3: border writes nothing at resting, ...')` ([Checkbox.stateClassHoisting.test.ts:101-138](packages/lib/tests/component/input/Checkbox.stateClassHoisting.test.ts#L101-L138)), change the four `expect(restingDeclarations.borderTop/Right/Bottom/Left).toBeNull()` assertions (lines 114-117) to `.toBeUndefined()`. Replace the comment above them (lines 106-112) — it currently explains the `null` result as border's removal "riding along" with borderRadius's real per-instance write forcing the same flush; once borderRadius no longer forces that flush, border comes back as an absent key. Word the new comment as: resting relies entirely on the `.CheckboxBox` class rule; `borderRadius` is a class default too now, so nothing on a default-styled `_box` deviates from `.CheckboxBox` at all — `#id` never materialises, and border comes back as an absent key, not a `null` removal. Leave the "Checked/indeterminate" section (lines 119-137) untouched — it asserts a different selector (`.selected`/`.indeterminate`), unaffected by this change.
   *Check:* `npx vitest run tests/component/input/Checkbox.stateClassHoisting.test.ts` — the four updated assertions fail against the current, unfixed source.

3. **Add a registry row to `default-options-fallback.test.ts`.** Immediately after the existing `'Checkbox _box border'` row ([default-options-fallback.test.ts:411](packages/lib/tests/component/default-options-fallback.test.ts#L411)), add:
   ```typescript
   { label: 'Checkbox _box borderRadius', resolve: () => (new Checkbox() as any)._box.getBorderRadius(), expected: 'var(--ts-ui-checkbox-radius, 3px)' },
   ```
   This mirrors the three existing `_box` rows immediately above it. Unlike steps 1-2, this row is expected to **pass both before and after** this plan's source change — `getBorderRadius()` already returns the right value today, via the (about-to-be-deleted) imperative call; the row exists to guard the *getter*, per [ARCHITECTURE.md](ARCHITECTURE.md)'s "Class-level defaults must survive the getter" registry mandate, not to prove the dedup itself.
   *Check:* `npx vitest run tests/component/default-options-fallback.test.ts` — passes immediately (before the source change too).

4. **Apply the source fix in `Checkbox.ts`.** Add `borderRadius: "var(--ts-ui-checkbox-radius, 3px)",` to `_defaultCheckboxBoxOptions` (placed after `border:`, per `## Internal Structure`). Delete the `this._box.setBorderRadius("var(--ts-ui-checkbox-radius, 3px)");` line from the constructor. Update `CheckboxBox`'s class doc comment ([Checkbox.ts:41-49](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L41-L49)): change "Static geometry and cursor are class defaults" to "Static geometry, cursor, and border-radius are class defaults" (reflowing the sentence as needed).
   *Check:* `npm run typecheck`. `grep -n 'this._box.setBorderRadius' packages/lib/src/typescript/lib/component/input/Checkbox.ts` — zero matches.

5. **Re-run the three test files touched in steps 1-3.** `npx vitest run tests/component/input/Checkbox.test.ts tests/component/input/Checkbox.stateClassHoisting.test.ts tests/component/default-options-fallback.test.ts` — all green now.

6. **Run the full suite for regressions elsewhere.** `npm test` from `packages/lib`. No other file references `CheckboxBox` or `checkbox-radius` (confirmed via `grep -rln "CheckboxBox\|checkbox-radius" packages/lib/tests`), so no further test files are expected to need changes — treat any other new failure as a genuine regression to investigate, not something to paper over.

7. **Add the changelog entry.** See `## Documentation Impact`.

8. **Full verification.** See `## Verification`.

9. **Verify live in a browser.** Non-negotiable — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `packages/lib/tests/component/input/Checkbox.test.ts` |
| Modify | `packages/lib/tests/component/input/Checkbox.stateClassHoisting.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

| # | Case | Expected | Testable |
|---|---|---|---|
| 1 | A default-styled `Checkbox`'s `_box` renders for the first time | No `setRuleStyles` write reaches `_box`'s own `#id` rule at all — `minWidth`/`minHeight`/`maxWidth`/`maxHeight`/`cursor` are all absent keys, not explicit `null` removals | Unit (`Checkbox.test.ts` row 1) |
| 2 | Same `_box`, resting (unchecked, non-indeterminate) state | `borderTop`/`borderRight`/`borderBottom`/`borderLeft` are absent keys on `#id`, not `null` removals — same reasoning as row 1 | Unit (`Checkbox.stateClassHoisting.test.ts` row 3, resting section only) |
| 3 | `(new Checkbox() as any)._box.getBorderRadius()` on a bare, unrendered instance | `'var(--ts-ui-checkbox-radius, 3px)'` — unchanged before and after this plan | Unit (registry row) |
| 4 | Checked/indeterminate `_box` transitions (`.selected`/`.indeterminate` suffix rules) | Unaffected — untouched by this plan, still passes as today | Unit (pre-existing, unmodified assertions) |
| 5 | `.CheckboxBox` shared class rule, after any `Checkbox` has rendered | Its body now includes `border-radius: var(--ts-ui-checkbox-radius, 3px);` alongside its existing size/cursor/background/border declarations | Manual (Style Audit panel body column, or `getComputedStyle` on a live checkbox) |
| 6 | Style Audit panel (`#/style-audit`), after visiting a screen with several checkboxes | The `CheckboxBox` duplicate-rule row (body `{ border-radius: var(--ts-ui-checkbox-radius, 3px); }`) is gone entirely | Manual |
| 7 | Same panel, `RadioButtonRing`'s row (body `{ border-radius: 50%; }`) | Unchanged — still present, confirming this plan did not accidentally widen scope to `RadioButton` | Manual |
| 8 | Any rendered checkbox, any state, any theme | Visually identical corner radius before and after — the value written never changes, only which rule carries it | Manual |

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
grep -n 'this._box.setBorderRadius' packages/lib/src/typescript/lib/component/input/Checkbox.ts   # zero matches
grep -n 'borderRadius' packages/lib/src/typescript/lib/component/input/Checkbox.ts                  # exactly one match: the _defaultCheckboxBoxOptions entry
```

**Manual browser verification (rows 5-8) is required.** The offline harness records writes; it does not run a CSS cascade or reproduce the Style Audit panel's stylesheet scan. Start a dev server on a spare port from *this worktree*, not the user's existing one (`npx vite --port <spare> --strictPort` from `packages/lib`; confirm with `readlink /proc/<pid>/cwd` that it resolves to this worktree, and check `pgrep -af "vite --port <spare>"` first in case the port is already in use by an unrelated session). Navigate to a screen with several rendered checkboxes (`#/misc`'s "Show window with table (slow)!" button reproduces the original bug report's scenario), then `#/style-audit`, and click "Refresh". Confirm the `CheckboxBox` row (body `{ border-radius: var(--ts-ui-checkbox-radius, 3px); }`) is gone, the `RadioButtonRing` row (body `{ border-radius: 50%; }`) is still present and unchanged, and every checkbox's corner radius looks identical to before.

---

## Documentation Impact

No exported symbol changes — `CheckboxBox` is module-private, and `Checkbox`'s own public surface is untouched. One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Components`, added as a new bullet near the existing `Checkbox`/`RadioButton` dedup entry (around [next.md:167-175](packages/lib/docs/reference/changelog/next.md#L167-L175)):

> **`Checkbox`'s box graphic (`CheckboxBox`) no longer duplicates its border-radius on every instance's own CSS rule**, the same way its fixed size, cursor, resting background, and resting border already were deduped. Nothing changes visually; no consumer action needed.

---

## Potential Challenges

- **Two pre-existing tests encode the current (buggy) write shape as their expected behaviour.** Mitigated by `## Ordered Implementation Steps` 1-2, which update both to the corrected shape before the source fix lands, and by `## Addendum` below, which traces the exact mechanism so the new assertions aren't a guess.
- **Style Audit byte/count figures are demo-data-dependent**, not a fixed number (see `## Notes`, `[^live-verify]`) — `## Expected Behaviour` and `## Verification` check that the `CheckboxBox` row disappears, never a specific count.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/input/Checkbox.ts` | The file being changed: `_defaultCheckboxBoxOptions` (20-27), `CheckboxBox` doc comment (41-49), the imperative call to delete (242) |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | Read, not modified — confirms the flat/pre-hierarchy fallback path (`chainParticipates` 342-364, `ensureClassStyleRule` 589-635) is what applies to `CheckboxBox`, and that `borderRadius` is already a registered `ClassStyleDefaults` key (52, 207) |
| `packages/lib/src/typescript/lib/core/Component.ts` | Read, not modified — `applyChromeOptions`'s always-dispatch (733-743), `getBorderRadius`/`setBorderRadius`/`clearBorderRadius` (2602-2636), `getClassStyleDefaults` base (4992-4994), `applyChromeStyles`'s reconciled write (5191-5194), `materialiseWhenNeeded`/`materialiseStyleRule` (5271-5303) |
| `packages/lib/src/typescript/lib/core/StyleTarget.ts` | Read, not modified — `hasQueuedDeclarations` (100-116), the exact rule that makes `#id` skip materialising when every queued entry is `null` |
| `packages/lib/src/typescript/lib/component/button/Button.ts` | `_defaultButtonOptions.borderRadius` (228) — proof this exact class-default shape already dedupes `borderRadius` correctly for a live, shipped class |
| `plans/implemented/checkbox-radio-delegate-static-style-defaults.md` | Direct precedent: the same "move an imperative literal into `_default<Name>Options`, delete the call" fix, already applied to this exact class's other static properties |
| `plans/implemented/component-borderradius-visibility-write-path-cleanup.md` | Established the reconciled write path and `ClassStyleDefaults.borderRadius` registration this plan depends on, and explicitly named this exact follow-up (moving `CheckboxBox`'s `borderRadius` into a class default) in its own Non-Goals |
| `packages/lib/tests/component/input/Checkbox.test.ts` | Row 1 (199-273) — assertions and comment to update |
| `packages/lib/tests/component/input/Checkbox.stateClassHoisting.test.ts` | Row 3 (101-138) — assertions and comment to update |
| `packages/lib/tests/component/default-options-fallback.test.ts` | Registry to extend (408-412 shows the existing `Checkbox _box *` row shape) |

---

## Non-Goals

- **`RadioButton`'s `_ring` (`RadioButtonRing`).** Has the identical shape — `this._ring.setBorderRadius("50%");` ([RadioButton.ts:173](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L173)), no `borderRadius` entry in `_defaultRadioButtonRingOptions` ([RadioButton.ts:19-26](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L19-L26)) — confirmed live today via the Style Audit panel (a `RadioButtonRing` row, body `{ border-radius: 50%; }`). The bug report and this plan's scope are `CheckboxBox` specifically; the identical one-line move would fix `RadioButtonRing` too, as a follow-up.
- **`CheckboxCheckGlyph`'s `minSize`/`maxSize`.** A different, harder problem on the same file: `Glyph.applyOptions` unconditionally re-pins `minSize`/`maxSize` via a real setter call whenever a preferred size resolves — including from a class default — and a setter call always writes straight to the instance's own `#id` rule, bypassing class-tier dedup entirely. This is already documented in `CheckboxCheckGlyph`'s own doc comment ([Checkbox.ts:143-159](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L143-L159)) and in `checkbox-radio-delegate-static-style-defaults.md`'s Implementation Notes. It needs a `Glyph`-level write-path fix, tracked separately (`glyph-preferredsize-reconciled-write-path.md`) — not investigated or touched here.
- **`Toggle`'s `_track`/`_thumb`.** Same imperative-literal shape (`setBorderRadius("999px")` at [Toggle.ts:61](packages/lib/src/typescript/lib/component/input/Toggle.ts#L61) and [:76](packages/lib/src/typescript/lib/component/input/Toggle.ts#L76)), but `_track`/`_thumb` are still bare `Component` instances — they never got the module-private-subclass treatment `checkbox-radio-delegate-static-style-defaults.md` gave `Checkbox`/`RadioButton`'s delegates (already flagged as a separate follow-up in that plan's own Non-Goals). Fixing `borderRadius` here needs that larger refactor first; out of scope.
- **Bumping the package version.** Release-time bookkeeping.

---

## Addendum: why `_box`'s `#id` rule stops materialising entirely, and what that changes in the existing tests

`Component.applyStyle()`'s six write phases each queue declarations into `_styleRule`'s dirty bag via `writeRuleDeclaration`/`reconcileRuleDeclaration` (deferred writes — see [ARCHITECTURE.md](ARCHITECTURE.md), *Defer DOM work to render time*). `StyleTarget.hasQueuedDeclarations()` ([StyleTarget.ts:100-116](packages/lib/src/typescript/lib/core/StyleTarget.ts#L100-L116)) returns `true` only when at least one queued entry is non-`null` — its own doc comment: "a queued value that isn't a no-op `null` removal." `Component.materialiseWhenNeeded()` ([Component.ts:5271-5286](packages/lib/src/typescript/lib/core/Component.ts#L5271-L5286)) only calls `rule.ensure()` (the call that actually creates the CSS rule and flushes the bag to the DOM) when the rule already exists or `hasQueuedDeclarations()` is true; its own doc comment states this plainly: "Skips a rule that would otherwise insert empty, with every currently-queued entry a no-op `null` removal of a property that was never set."

A throwaway test file was added to this worktree, run once against the current (unfixed) source, and deleted before drafting this plan — it recorded every `setRuleStyles` write to a fresh `Checkbox`'s `_box`'s own `#id` selector during first render:

```json
{
  "borderTop": null, "borderRight": null, "borderBottom": null, "borderLeft": null,
  "borderRadius": "var(--ts-ui-checkbox-radius, 3px)",
  "visibility": null,
  "minWidth": null, "minHeight": null, "maxWidth": null, "maxHeight": null,
  "overflowX": null, "overflowY": null,
  "whiteSpace": null, "userSelect": null
}
```

Every key already resolves to `null` — a removal that matches the (already-registered) class default — except `borderRadius`, the only key still resolving to a real, non-null value, because no class default exists for it yet. That single real entry is what makes `hasQueuedDeclarations()` return `true` today, which is *why* `#id` materialises with all these `null` removals visible in the recorded write at all — matching the pre-existing `Checkbox.test.ts` row 1 / `Checkbox.stateClassHoisting.test.ts` row 3 comments' own (correct, for the current code) explanation that backgroundColor/border/borderRadius "force `#id` to materialise regardless."

Once `borderRadius` also resolves to `null` (matching the new class default), every entry in that same bag is `null`. `hasQueuedDeclarations()` returns `false`. No `setRuleStyles` write happens for `_box`'s `#id` rule at all, for a default-styled `Checkbox`. This is strictly *fewer* bytes than a rule that materialises with an all-`null` body — not just this one declaration removed, but the whole per-instance rule skipped — which is why `## Ordered Implementation Steps` 1-2 change the corresponding assertions from `.toBeNull()` (an explicit removal was recorded) to `.toBeUndefined()` (nothing was recorded at all), and rewrite the two comments that narrated the old mechanism.

This also means row 1's test title ("a rendered `_box` carries no static size/cursor declaration on its own `#id` rule") and row 3's title ("border writes nothing at resting...") both remain accurate without change — only the *shape* of "nothing" changes, from an explicit removal to a fully absent write.

---

## Notes

[^live-verify]: Live-verified via `chrome-devtools` MCP tools against `npx vite --port 8041 --strictPort` started from this worktree's `packages/lib` (confirmed via `readlink /proc/<pid>/cwd`). Navigating `#/misc`, clicking "Show window with table (slow)!" (a table with a boolean column, matching the original bug report's scenario), then `#/style-audit` and "Refresh" shows a `CheckboxBox` / `plain` / `{ border-radius: var(--ts-ui-checkbox-radius, 3px); }` row at count 32, 1.60 KB — and, separately, a `RadioButtonRing` / `plain` / `{ border-radius: 50%; }` row at count 4, 0.07 KB (see `## Non-Goals`). The original bug report's 114-instance / 5.85 KB figure was from a different demo scene with more boolean rows rendered; the row's existence and body are what this plan fixes, not a specific count, which is why `## Expected Behaviour` and `## Verification` check for the row's absence rather than pinning a byte figure.

[^why-not-then]: `checkbox-radio-delegate-static-style-defaults.md`'s own Non-Goals (at the time) stated: *"`borderRadius`. Writes an inline style, not a CSS rule; not part of the class-tier hoisting mechanism... No byte savings available."* That was accurate when written — `setBorderRadius()` still wrote to the element's inline style then. `component-borderradius-visibility-write-path-cleanup.md` (implemented afterward) moved `setBorderRadius()`/`clearBorderRadius()`/`applyChromeStyles()`'s `borderRadius` write onto the reconciled CSS-rule path and registered `borderRadius` on `ClassStyleDefaults`, which is what makes the one-line move in this plan effective now.
