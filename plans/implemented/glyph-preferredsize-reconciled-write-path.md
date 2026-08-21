---
touches-shared:
  - packages/lib/src/typescript/lib/component/input/Checkbox.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Glyph Fixed-Size Class-Default Registration — Implementation Plan

## Overview

The Style Audit panel (`#/style-audit`) reports a live duplicate-rule group for `component: CheckboxCheckGlyph`, body `{ min-width: 12px; min-height: 12px; max-width: 12px; max-height: 12px; }` — one copy of that same four-declaration body per checkbox on screen. [`CheckboxCheckGlyph`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L160) is a small `Glyph` subclass — the check-mark inside a `Checkbox`'s box — and its own defaults bag, [`_defaultCheckboxCheckGlyphOptions`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L139), sets only `foregroundColor`. A code comment directly above the class ([lines 143-159](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L143)) claims adding a matching size default would not help, because `Glyph`'s runtime size setters allegedly bypass the framework's class-tier CSS dedup entirely.

This plan finds that comment **stale**: the write path it describes was fully migrated onto the class-tier-aware reconciled path by [`reconciled-write-path-widening`](plans/implemented/reconciled-write-path-widening.md), which already shipped on this branch. `Component.setMinSize`/`setMaxSize` ([core/Component.ts:3101](packages/lib/src/typescript/lib/core/Component.ts#L3101), [:3142](packages/lib/src/typescript/lib/core/Component.ts#L3142)) call `setReconciledCSSRules`, and `applySizeConstraintStyles` ([core/Component.ts:5132](packages/lib/src/typescript/lib/core/Component.ts#L5132)) calls `reconcileRuleDeclaration` for all four size keys. The real duplicate is a pure **registration gap**: `CheckboxCheckGlyph` has no class-tier size default for the render-time reconciliation to match against. The same gap, with the same stale reasoning copied into its own doc comment, exists in [`RadioButtonDot`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L101) (`RadioButton`'s selected-dot glyph), and — for the common case of an unmodified 16×16 `Glyph` — in `Glyph` itself. All three get the identical shape of fix: declare a `minSize`/`maxSize` class default that matches what is actually constructed. `core/Component.ts` and `component/display/Glyph.ts`'s write-path methods are untouched.

---

## Architecture Decisions

### The write path is already reconciled; the code comment is stale

[`Component.setMinSize`](packages/lib/src/typescript/lib/core/Component.ts#L3101) and [`setMaxSize`](packages/lib/src/typescript/lib/core/Component.ts#L3142) both call `this.setReconciledCSSRules({...})`, not the raw `setElementCSSRules`. [`applySizeConstraintStyles`](packages/lib/src/typescript/lib/core/Component.ts#L5132) — one of `Component.applyStyle`'s phases, run on every render — calls `this.reconcileRuleDeclaration("minWidth", ...)` etc. for all four keys. `Glyph` never overrides `applyStyle`, so there is no second, later flush the way `Text` had for `textOverflow` (see [`applystyle-flush-order-empty-rule-fix.md`](plans/implemented/applystyle-flush-order-empty-rule-fix.md), already on this branch) — one render pass, one flush, and that flush already reconciles size. The claim in `CheckboxCheckGlyph`'s doc comment — that a setter "always writes straight to this instance's own `#id` rule, bypassing the class-tier dedup entirely" — describes the pre-`reconciled-write-path-widening` behaviour and is no longer true.[^probe]

### The duplicate is a registration gap, not a write-path gap

`Glyph.applyOptions` ([display/Glyph.ts:626](packages/lib/src/typescript/lib/component/display/Glyph.ts#L626)) unconditionally re-pins `minSize`/`maxSize` to the resolved preferred size via a real `this.setMinSize(...)`/`this.setMaxSize(...)` call whenever `getPreferredSizeConstraint()` is non-null — which is every `Glyph`, since the base class always has a preferred-size fallback. This runs inside the `super()` constructor cascade, before `_inheritedStyleBag` — the per-instance bag of "what does this instance's class already supply for free" values that `Component.applyStyle` resolves once per render, and that every reconciliation call compares against — exists, so `matchesClassStyle` ([core/Component.ts:4840](packages/lib/src/typescript/lib/core/Component.ts#L4840)) returns `false` unconditionally and the call queues a **real** declaration.[^matches-class-style-null] For a bare `Glyph` that value is 16×16 (its own base default) and nothing overrides it further. For `CheckboxCheckGlyph`, `Checkbox`'s own constructor ([Checkbox.ts:245-246](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L245)) immediately calls `this._check.setPreferredSize({width:12,height:12})`/`setMaxSize({width:12,height:12})` — another real, pre-render setter call that overwrites the queued 16×16 with 12×12. Either way, by the time `applySizeConstraintStyles` runs at first render, a real value is sitting in the dirty bag and `_inheritedStyleBag` is checked against it. Today `_inheritedStyleBag.minWidth` resolves to `"auto"` (no class declares a `minSize`) — never equal to `"12px"` — so the reconciliation never matches and the real declaration survives to the flushed rule. Registering the matching class default is the entire fix: once `_inheritedStyleBag.minWidth` is `"12px"`, the exact same reconciliation call turns the real declaration into a removal.

### The 12×12 / 8×8 values come from `Checkbox`/`RadioButton`, not from a "`Glyph` preset"

`GlyphDef` ([display/Glyphs.ts:17](packages/lib/src/typescript/lib/component/display/Glyphs.ts#L17)) carries no size field — a registered glyph (`check.ts`, `circle.ts`, …) is pure path/character data. There is no per-glyph-name size resolution anywhere in `Glyph`. The 12×12 the Style Audit reports is `Checkbox`'s own layout geometry — the check glyph fitted inside the box's 14×14 padding box (16×16 box, 1px border), stated explicitly in the comment above [`this._check.setX(1)`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L247). `RadioButton`'s 8×8 dot is the same shape, one file over. So the class default that fixes each duplicate is not a shared "Glyph preset" value — it is each *consuming* component's own fitted size, and belongs in that component's own defaults bag.[^twelve-confirmed]

### Three independent registrations, one mechanism each

| Class | File | Real value written | New class default |
|---|---|---|---|
| `Glyph` (base, unmodified size) | `display/Glyph.ts` | 16×16, from `_defaultGlyphOptions.preferredSize` re-pinned by its own `applyOptions` | `minSize`/`maxSize`: 16×16 |
| `CheckboxCheckGlyph` | `input/Checkbox.ts` | 12×12, from `Checkbox`'s constructor | `minSize`/`maxSize`: 12×12 |
| `RadioButtonDot` | `input/RadioButton.ts` | 8×8, from `RadioButton`'s constructor | `minSize`/`maxSize`: 8×8 |

Each is fixed by adding `minSize`/`maxSize` fields to that class's own `_default<Name>Options` bag — the exact mechanism [`CheckboxBox`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L20)/[`CheckboxDash`](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L166)/[`RadioButtonRing`](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L19) already use for their own static geometry, one file over — no new code, no `Component.ts`/`Glyph.ts` write-path change.[^why-not-hierarchy]

### Named constants prevent the class default and the constructor drifting apart

`CheckboxCheckGlyph`'s 12×12 and `RadioButtonDot`'s 8×8 each need to agree in two places: the new class default, and the pre-existing imperative `setPreferredSize`/`setMaxSize` calls in `Checkbox`'s/`RadioButton`'s own constructor. A hardcoded `{ width: 12, height: 12 }` literal in both places is exactly the kind of duplication that could silently drift apart later (one site's size changes, the other doesn't, and the duplicate-rule bug this plan fixes comes back). Each pair is declared from one local constant instead: `CHECKBOX_CHECK_SIZE` in `Checkbox.ts`, `RADIO_DOT_SIZE` in `RadioButton.ts`. `Glyph.ts`'s three fields (`preferredSize`/`minSize`/`maxSize`, all 16×16) get the same treatment with `GLYPH_DEFAULT_SIZE`, declared once and referenced three times in the same object literal.

### Scope: exactly the two existing `Glyph` subclasses, plus `Glyph` itself

`grep -rn "extends Glyph"` across `packages/lib/src` returns exactly two matches: `CheckboxCheckGlyph` and `RadioButtonDot`. No other dedicated `Glyph` subclass exists to register a size default on. The Style Audit also shows several duplicate-rule groups for **bare** `Glyph` instances at other fixed sizes (14×14, and a char-mode 12×12 with `font-size: 10px`) — these come from call sites like `Header.ts`, `AbstractCalendarDropdown.ts`, or `Dialog.ts` constructing a plain `new Glyph(name)` and resizing it imperatively. A bare `Glyph`'s class-tier rule (`this.constructor === Glyph`) is shared by every unrelated `Glyph` use in the whole app, so registering any one consumer's size on `Glyph` itself would either do nothing for a different consumer's size or, worse, leak one consumer's size onto every other bare-`Glyph` icon. Fixing those groups needs a dedicated subclass per call site (mirroring `CheckboxCheckGlyph`) — a separate, larger change; see `## Non-Goals`.

---

## Internal Structure

`display/Glyph.ts`, replacing the `_defaultGlyphOptions` declaration ([lines 171-179](packages/lib/src/typescript/lib/component/display/Glyph.ts#L171)):

```typescript
// The size Glyph.applyOptions's re-pin always lands on when nothing
// overrides preferredSize. Declared once and reused for minSize/maxSize
// too, so the three fields below can never drift apart.
const GLYPH_DEFAULT_SIZE = { width: 16, height: 16 };

const _defaultGlyphOptions: Partial<GlyphOptions> = {
    preferredSize: GLYPH_DEFAULT_SIZE as GlyphOptions["preferredSize"],
    minSize:       GLYPH_DEFAULT_SIZE as GlyphOptions["minSize"],
    maxSize:       GLYPH_DEFAULT_SIZE as GlyphOptions["maxSize"],

    // Always an HTML element, both kinds. ...
    tag: "span",
};
```

`input/Checkbox.ts`, replacing `_defaultCheckboxCheckGlyphOptions` and its doc comment ([lines 139-159](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L139)):

```typescript
// The check glyph's fitted size inside the box (14×14 padding box, 1px
// border): shared with Checkbox's own constructor below so the class
// default and the imperative override can never drift apart.
const CHECKBOX_CHECK_SIZE = { width: 12, height: 12 };

const _defaultCheckboxCheckGlyphOptions: Partial<GlyphOptions> = {
    foregroundColor: "var(--ts-ui-checkbox-check-color, rgb(255, 255, 255))",
    minSize:         CHECKBOX_CHECK_SIZE,
    maxSize:         CHECKBOX_CHECK_SIZE,
};

/**
 * The check-mark glyph inside a {@link Checkbox}'s box. `foregroundColor`
 * and `minSize`/`maxSize` are class defaults, so every instance shares one
 * `.CheckboxCheckGlyph` CSS rule instead of repeating them. `Checkbox`'s own
 * constructor still calls `setPreferredSize`/`setMaxSize` imperatively (a
 * `Glyph`'s construction-time size pin cannot itself be deferred to a
 * defaults bag — see `Glyph.applyOptions`), but that call now resolves to
 * the same value this class already defaults, so `Component.applyStyle`'s
 * render-time reconciliation (`reconcileRuleDeclaration`, since
 * `plans/implemented/reconciled-write-path-widening.md`) turns it into a
 * removal instead of a redundant per-instance declaration. Opacity (which of
 * unchecked/checked/indeterminate is showing) stays a per-instance runtime
 * write in `Checkbox.applySelected` — it is not a class constant.
 */
class CheckboxCheckGlyph extends Glyph {
    constructor() {
        super("check", undefined, _defaultCheckboxCheckGlyphOptions);
    }
}
```

Constructor call site ([Checkbox.ts:244-246](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L244)) — only the two literals change to the named constant:

```typescript
this._check = new CheckboxCheckGlyph();
this._check.setPreferredSize(CHECKBOX_CHECK_SIZE);
this._check.setMaxSize(CHECKBOX_CHECK_SIZE);
```

`input/RadioButton.ts` mirrors the same three edits with `RADIO_DOT_SIZE = { width: 8, height: 8 }` in place of `CHECKBOX_CHECK_SIZE`, `RadioButtonDot`'s doc comment ([lines 92-100](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L92)) rewritten the same way (referencing `RadioButtonDot` instead of `CheckboxCheckGlyph`), and the constructor call site ([lines 175-177](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L175)) updated the same way.

---

## Ordered Implementation Steps

1. **`packages/lib/tests/component/input/Checkbox.test.ts` — update "row 2" to the corrected expectation.** The test at [lines 225-247](packages/lib/tests/component/input/Checkbox.test.ts#L225) has this shape: a comment explaining size is "deliberately not asserted" (226-230), construction and the `declarationsDuring` call (231-236, unchanged), a second comment explaining why `color` alone dedupes (237-245), and the assertion (246) `expect(declarations.color).toBeNull();`. Replace both comments with one short note that this plan closes the size gap too, so `_check`'s `#id` rule now carries nothing at all — `color` and every size key reconcile to removals in the same batch, and a rule with no real declaration never materialises (mirrors `plans/implemented/text-truncate-write-path-cleanup.md`'s `## Expected Behaviour` row 1). Replace line 246 with `expect(declarations).toEqual({});`. Retitle the test to `'row 2: a rendered _check writes nothing to its own #id rule'`.
   *Check:* `npx vitest run tests/component/input/Checkbox.test.ts` from `packages/lib` — this one case fails (source not yet changed).

2. **`packages/lib/tests/component/input/RadioButton.test.ts` — the same update for "row 8"** ([lines 177-198](packages/lib/tests/component/input/RadioButton.test.ts#L177), same shape: comment 178-182, construction/`declarationsDuring` 183-187 unchanged, comment 189-196, assertion 197), mirroring step 1 exactly (`_dot` instead of `_check`, `RadioButtonDot` instead of `CheckboxCheckGlyph`).
   *Check:* `npx vitest run tests/component/input/RadioButton.test.ts` — this one case fails.

3. **`packages/lib/tests/component/display/Glyph.test.ts` — add a case to the `'Glyph size lock'` describe block** ([line 114](packages/lib/tests/component/display/Glyph.test.ts#L114)), after the existing `'defaults the preferred size to 16x16'` case:
   ```typescript
   it('a fresh Glyph at the default 16x16 size writes no min/max declarations to its own #id rule', () => {
       const glyph = new Glyph('unicode-arrow-up');
       glyph.getElement(true);

       const sizeRows = ruleStyleWrites(sink).filter(r =>
           r.selector === '#' + glyph.getId()
           && ['minWidth', 'minHeight', 'maxWidth', 'maxHeight'].includes(r.key));

       expect(sizeRows).toEqual([]);
   });
   ```
   `ruleStyleWrites` and `sink` are already imported/set up in this file ([line 7](packages/lib/tests/component/display/Glyph.test.ts#L7), [line 24](packages/lib/tests/component/display/Glyph.test.ts#L24)) — no new imports needed.
   *Check:* `npx vitest run tests/component/display/Glyph.test.ts` — this one case fails.

4. **`packages/lib/tests/component/default-options-fallback.test.ts` — add one registry row**, immediately after the `'Glyph tag (svg entry)'` row ([line 332](packages/lib/tests/component/default-options-fallback.test.ts#L332)):
   ```typescript
   { label: 'Glyph minSize', resolve: () => new Glyph('unicode-arrow-up').getMinSizeConstraint(), expected: { width: 16, height: 16 } },
   ```
   *Check:* `npx vitest run tests/component/default-options-fallback.test.ts` — new row passes immediately (this getter already folds `_defaultOptions` correctly; this step only records the new default in the registry per `CODE_CONVENTIONS.md`'s "every class that defaults a field has a row").

5. **`packages/lib/src/typescript/lib/component/display/Glyph.ts` — add the class default.** Replace `_defaultGlyphOptions` ([lines 171-179](packages/lib/src/typescript/lib/component/display/Glyph.ts#L171)) exactly as shown in `## Internal Structure`. Leave every other line of the file untouched — no changes to `applyOptions`, `setPreferredSize`, or any write-path method.
   *Check:* `grep -n "GLYPH_DEFAULT_SIZE" packages/lib/src/typescript/lib/component/display/Glyph.ts` — four matches (the declaration plus the three field references).

6. **`packages/lib/src/typescript/lib/component/input/Checkbox.ts` — add the class default, rewrite the doc comment, update the constructor.** Replace `_defaultCheckboxCheckGlyphOptions` and the class's doc comment ([lines 139-159](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L139)) exactly as shown in `## Internal Structure`. Change the two lines at [245-246](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L245) from the inline `{ width: 12, height: 12 }` literals to `CHECKBOX_CHECK_SIZE`. Do not touch anything else in this file — in particular, leave `_defaultCheckboxBoxOptions`, `CheckboxBox`, and the `this._box.setBorderRadius(...)` line untouched; that region belongs to the sibling `checkboxbox-borderradius-hoist.md` plan (see `## Non-Goals`).
   *Check:* `grep -n "CHECKBOX_CHECK_SIZE" packages/lib/src/typescript/lib/component/input/Checkbox.ts` — five matches (the declaration, the two defaults-bag fields, and the two constructor call sites).

7. **`packages/lib/src/typescript/lib/component/input/RadioButton.ts` — the same three edits**, mirroring step 6 (`RADIO_DOT_SIZE`, `_defaultRadioButtonDotOptions` at [lines 88-105](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L88), constructor lines [176-177](packages/lib/src/typescript/lib/component/input/RadioButton.ts#L176)).
   *Check:* `grep -n "RADIO_DOT_SIZE" packages/lib/src/typescript/lib/component/input/RadioButton.ts` — five matches, same reasoning as step 6.

8. **Run the four touched/added test files.** `npx vitest run tests/component/input/Checkbox.test.ts tests/component/input/RadioButton.test.ts tests/component/display/Glyph.test.ts tests/component/default-options-fallback.test.ts` from `packages/lib` — all green.

9. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib` — all green. No other test file references `CheckboxCheckGlyph`, `RadioButtonDot`, or a bare `Glyph`'s size in a way this plan's own dry run didn't already cover.[^full-suite-clean]

10. **Amend the changelog.** See `## Documentation Impact`.

11. **Full verification.** See `## Verification`.

12. **Verify live in a browser, and record the Style Audit before/after.** Non-negotiable — see `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/display/Glyph.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/Checkbox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/RadioButton.ts` |
| Modify | `packages/lib/tests/component/input/Checkbox.test.ts` |
| Modify | `packages/lib/tests/component/input/RadioButton.test.ts` |
| Modify | `packages/lib/tests/component/display/Glyph.test.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-6 are unit-testable against the recording DOM sink (exactly the cases steps 1-4 add or rewrite). Rows 7-8 need a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | `new Glyph('unicode-arrow-up')` renders, no size override | No `minWidth`/`minHeight`/`maxWidth`/`maxHeight` write is recorded for its `#id` rule at all |
| 2 | A `Checkbox`'s `_check` (a `CheckboxCheckGlyph`) renders | `#id` carries no declaration at all — `color` and all four size keys reconcile to removals, matching what `.CheckboxCheckGlyph` now supplies |
| 3 | A `RadioButton`'s `_dot` (a `RadioButtonDot`) renders | Same as row 2, for `.RadioButtonDot` |
| 4 | `new Glyph('unicode-arrow-up').getMinSizeConstraint()` / `getMaxSizeConstraint()` / `getPreferredSizeConstraint()` | All three still return `{width:16,height:16}` — unchanged from before this plan; only what gets *written to the stylesheet* changes, not what the getters report |
| 5 | `(new Checkbox() as any)._check.getMinSizeConstraint()` / `(new RadioButton() as any)._dot.getMinSizeConstraint()` | `{width:12,height:12}` / `{width:8,height:8}` respectively — unchanged from before this plan |
| 6 | `new Glyph('unicode-arrow-up', { minSize: { width: 30, height: 30 } })` renders | `#id` carries a real `minWidth:30px`/`minHeight:30px` — an explicit caller override still deviates from the class default and is written for real, exactly as before this plan |
| 7 | Manual — live app, `#/style-audit`, after opening a table window with a boolean (checkbox) column (`#/misc` → "Show window with table (slow)!") | The `CheckboxCheckGlyph` duplicate-rule row is gone entirely. The `RadioButtonDot` contribution to any `{min-width:8px;...}` group is gone (a "Glyph, RadioButtonDot" combined row, if present before, no longer includes `RadioButtonDot`) |
| 8 | Manual — live app, `#/style-audit`, same screen | A `{min-width:16px;min-height:16px;max-width:16px;max-height:16px;}` bare-`Glyph` duplicate-rule row, if present before, is gone. The `CheckboxBox` `border-radius` row (a different, pre-existing duplicate — the sibling plan's target) is present and unaffected either way |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants (reproduced from the per-step checks):

```
grep -c "GLYPH_DEFAULT_SIZE"   packages/lib/src/typescript/lib/component/display/Glyph.ts        # 4
grep -c "CHECKBOX_CHECK_SIZE"  packages/lib/src/typescript/lib/component/input/Checkbox.ts        # 5
grep -c "RADIO_DOT_SIZE"       packages/lib/src/typescript/lib/component/input/RadioButton.ts     # 5
```

**Manual browser verification (rows 7-8) is required.** The offline harness records writes; it does not run a CSS cascade or reflect the Style Audit panel's own dedup grouping.

- Start a dev server on a spare port from *this worktree* (symlink `node_modules` to the repo root first — `ln -s <repo-root>/node_modules node_modules` — if this worktree doesn't already have one), and confirm what it serves with `readlink /proc/<pid>/cwd` before trusting anything the browser shows.
- Reproduce this plan's own before-measurement first, against the unmodified code: navigate to `#/misc`, click "Show window with table (slow)!" (its boolean column renders `Checkbox` cells), then the "Style Audit" tab, then "Refresh". This plan's own run (before the fix) found rows `32 | 2.21 KB | CheckboxCheckGlyph | plain | { min-width: 12px; min-height: 12px; max-width: 12px; max-height: 12px; }` and `12 | 0.74 KB | Glyph, RadioButtonDot | plain | { min-width: 8px; min-height: 8px; max-width: 8px; max-height: 8px; }`, out of a 896-rule / 810-per-instance-rule total.
- Apply the fix, restart the dev server, repeat the identical navigation, and re-check the panel. This plan's own run (after the fix) found: the `CheckboxCheckGlyph` row absent entirely; the `8px` group reduced to `8 | ... | Glyph | plain | {...}` (no more `RadioButtonDot` in its component list); a separate `{min-width:16px;...}` bare-`Glyph` row (11-24 instances in earlier runs) also absent; total rules 850 / per-instance 763 (both down from the before-run, though exact counts will differ run to run since the panel accumulates whichever tabs and windows were visited — the qualitative disappearance of the `CheckboxCheckGlyph` row, and of `RadioButtonDot` from any group it appeared in, is what to confirm, not an exact byte count).
- Confirm the `CheckboxBox` `{border-radius:...}` row (32 instances / 1.60 KB in this plan's own runs) is present and numerically unchanged before and after — it is the sibling `checkboxbox-borderradius-hoist.md` plan's target, not this plan's.
- Read **computed styles** on a `Checkbox` and a `RadioButton`, not just the audit panel, confirming the check-mark and dot still render at 12×12 / 8×8, centred exactly as before.

---

## Documentation Impact

No exported symbol changes: `CheckboxCheckGlyph`/`RadioButtonDot` are module-private; `Glyph`'s public constructor, `GlyphOptions`, and every public getter/setter keep their existing signatures. `Glyph`'s own class doc comment is untouched (it already states "The default preferred size is 16×16," which stays true). No API page, barrel, or sidebar entry changes.

One amendment to `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Components`. The existing bullet at [lines 167-175](packages/lib/docs/reference/changelog/next.md#L167) — from `checkbox-radio-delegate-static-style-defaults.md` — currently ends:

> The check-mark and dot glyphs' size still writes per-instance, as it always has — a `Glyph`'s own construction-time size pinning cannot be deduped onto a shared class rule.

That sentence is now false. Replace it with:

> The check-mark and dot glyphs' fixed size now also dedupes the same way, so `_check`/`_dot` write no per-instance CSS rule at all.

The rest of the bullet (box/ring size+cursor, glyph colour, "Nothing changes visually; no consumer action needed") is unchanged and still applies.

---

## Potential Challenges

- **The stale doc comments actively argued against this fix.** Both `CheckboxCheckGlyph`'s and `RadioButtonDot`'s comments assert the class-tier dedup cannot work for a `Glyph` delegate's size. This plan's `## Architecture Decisions` — backed by a recording-sink probe and a live Style Audit before/after — establishes that the underlying claim was true only before `reconciled-write-path-widening.md` landed, and is false on this branch today.
- **Three separate files change for what is conceptually one fix.** Each of `Glyph`/`CheckboxCheckGlyph`/`RadioButtonDot` needs its own class default because each writes a genuinely different fixed size; there is no single shared constant across files that would not risk one component silently inheriting another's size. Mitigated by keeping each file's own constant colocated with both its use sites (the defaults bag and the constructor).

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/display/Glyph.ts` | `_defaultGlyphOptions` (171), `applyOptions`'s unconditional re-pin (626-666), `setPreferredSize` (292) — confirms `Glyph` never overrides `applyStyle` |
| `packages/lib/src/typescript/lib/component/input/Checkbox.ts` | `_defaultCheckboxCheckGlyphOptions` and `CheckboxCheckGlyph`'s stale doc comment (139-164), `Checkbox`'s constructor (244-246) — the actual source of the 12×12 value; `CheckboxBox`'s own already-working class-default pattern (20-27, 41-49) — the precedent this plan's mechanism mirrors |
| `packages/lib/src/typescript/lib/component/input/RadioButton.ts` | The identical structure and stale comment, one file over (88-105, 175-177) |
| `packages/lib/src/typescript/lib/core/Component.ts` | `setMinSize`/`setMaxSize` (3101, 3142), `matchesClassStyle` (4840), `reconcileRuleDeclaration`/`setReconciledCSSRules` (4945, 4961), `applySizeConstraintStyles` (5132) — the already-reconciled write path this plan's registration now actually reaches |
| `plans/implemented/reconciled-write-path-widening.md` | The plan that migrated `setMinSize`/`setMaxSize` onto the reconciled path — the reason the stale comment in `Checkbox.ts`/`RadioButton.ts` is now wrong |
| `plans/implemented/applystyle-flush-order-empty-rule-fix.md` | Confirms why `Glyph` needs no equivalent fix: it never overrides `applyStyle`, so there is only one flush per render, unlike `Text`'s pre-fix two-flush case this plan cites for contrast |
| `plans/checkboxbox-borderradius-hoist.md` | Sibling plan, drafted in parallel against the same base branch, fixing a different duplicate-rule row (`CheckboxBox`'s `border-radius`) in the same `Checkbox.ts` constructor — disjoint region (its own `CheckboxBox`/`this._box.setBorderRadius(...)` code around line 242, not touched here) |
| `packages/lib/tests/component/input/Checkbox.test.ts` | Row 2 (225-247) — the pre-existing test that documents (and must be updated past) today's "size cannot dedupe" behaviour |
| `packages/lib/tests/component/input/RadioButton.test.ts` | Row 8 (177-198) — the same, for `RadioButtonDot` |

---

## Non-Goals

- **The `CheckboxBox` `border-radius` duplicate.** Owned by the sibling `checkboxbox-borderradius-hoist.md` plan; this plan's steps do not touch `CheckboxBox`, `_defaultCheckboxBoxOptions`, or the `this._box.setBorderRadius(...)` call.
- **The other bare-`Glyph` duplicate-rule groups the live audit shows (14×14; a char-mode 12×12 with `font-size:10px`).** Each comes from a plain `new Glyph(name)` call resized imperatively by its owning component (e.g. a dialog title glyph, a header sort-indicator glyph), with no dedicated subclass to hang a class default on. Registering any one of these sizes on `Glyph` itself would incorrectly apply to every unrelated bare-`Glyph` use in the app. Fixing them needs a dedicated subclass per call site, mirroring `CheckboxCheckGlyph` — a separate, larger change, out of scope here.
- **Any call site with a genuinely per-instance, non-constant size** (a button's icon sized off its own font metrics, a window-header title glyph sized off measured text height, `ComboBox`'s chevron sized off a configurable `_size` field). These can never be hoisted to a static class default regardless of subclassing, because the value legitimately varies per instance.
- **`Component.ts`/`Glyph.ts` write-path changes.** Confirmed unnecessary — see `## Architecture Decisions`. `setMinSize`/`setMaxSize`/`applySizeConstraintStyles` are read, not modified.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^probe]: Verified directly against the current code with a recording-sink probe (constructing a real `Checkbox`/`RadioButton`, rendering, and inspecting exactly what `setRuleStyles` calls are recorded for `_check`'s/`_dot`'s own `#id` selector). Before this plan's fix: `{minWidth:"12px", minHeight:"12px", maxWidth:"12px", maxHeight:"12px", color:null, ...}` (nine other keys already `null`) — confirming `color` already dedupes correctly today (contradicting the doc comment's blanket claim) while size does not, purely because no class default exists for size to match against. After temporarily adding the class default described in this plan (and reverting once confirmed): `{}` — no `#id` rule content at all, `getMinSizeConstraint()`/`getMaxSizeConstraint()`/`getPreferredSizeConstraint()` unchanged. The full existing test suite (5122 tests) was also run with the fix applied: only the two pre-existing tests this plan's steps 1-2 rewrite failed; everything else, including `default-options-fallback.test.ts`'s existing `Checkbox _check minSize`/`RadioButton _dot minSize` rows, passed unchanged.

[^matches-class-style-null]: `Component.matchesClassStyle` ([core/Component.ts:4840](packages/lib/src/typescript/lib/core/Component.ts#L4840)): `return this._inheritedStyleBag !== null && this._inheritedStyleBag[key] === value;`. `_inheritedStyleBag` is assigned only inside `Component.applyStyle` ([core/Component.ts:5019](packages/lib/src/typescript/lib/core/Component.ts#L5019)), which has not run yet during the `super()` constructor cascade — so every setter call made from `applyOptions` (base `Component`'s own, or `Glyph`'s override) sees a `null` bag and always queues its value for real. `setReconciledCSSRules`'s own doc comment states this plainly: "Inert before the first render, when `_inheritedStyleBag` is still null."

[^twelve-confirmed]: Confirmed by reading `Checkbox`'s constructor directly ([Checkbox.ts:237-251](packages/lib/src/typescript/lib/component/input/Checkbox.ts#L237)): `_box` is sized 16×16 with a 1px border (14×14 padding box), and the comment above `this._check.setX(1)` states the 12×12 glyph is centred as `(14−12)/2 = 1`. `RadioButton`'s constructor is the same shape at 8×8 inside the same 16×16/14×14 ring. Neither value appears anywhere in `Glyph.ts` or in any `GlyphDef`.

[^why-not-hierarchy]: An alternative considered: opt `Glyph` into the newer class-hierarchy-cascade mechanism (`protected static readonly ownClassStyleDefaults`, used by ~20 other classes, e.g. `Button.ts:269`) instead of relying on the plain `getClassStyleDefaults()` → `_defaultOptions` fallback `CheckboxBox` already uses. Rejected: `ensureClassStyleRule` ([core/ClassStyleRules.ts:589](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L589)) switches a class onto the hierarchy-walk branch (`resolveClassLevel`, ignoring `getClassStyleDefaults()`'s return value entirely) the moment *any* ancestor declares `ownClassStyleDefaults` — including an ancestor two levels up. Adding `ownClassStyleDefaults` to `Glyph` alone, without also adding it to `CheckboxCheckGlyph` and `RadioButtonDot`, would silently make both subclasses resolve to `Glyph`'s own level (16×16, no `foregroundColor`) instead of their own `_defaultOptions` — regressing the `color` dedup this plan's own probe confirmed already works today, and leaving size unfixed too (their real 12×12/8×8 would never match `Glyph`'s 16×16 comparison value). Achieving the same correctness under the hierarchy mechanism would require adding `ownClassStyleDefaults` to all three classes at once — strictly more surface for an identical outcome to the plain fallback path, which is already what `CheckboxBox`/`CheckboxDash`/`RadioButtonRing` use successfully today for the same kind of static default.

[^full-suite-clean]: Verified directly: with all three source edits applied, `npx vitest run --no-file-parallelism` from `packages/lib` reports 5122 total tests, exactly 2 failing (the two this plan's steps 1-2 rewrite), 5120 passing — including every other `Checkbox`/`RadioButton`/`Glyph` test file (`Checkbox.stateClassHoisting.test.ts`, `RadioButton.stateClassHoisting.test.ts`, `Glyph.test.ts`'s other cases, `default-options-fallback.test.ts`'s other rows).

---

## Implementation Notes

**Step 3's test assertion (`Glyph.test.ts`) needed correcting; the literal code in `## Internal Structure`/`## Ordered Implementation Steps` step 3 does not hold for the chosen test subject.** The step's `expect(sizeRows).toEqual([])` — and `## Expected Behaviour` row 1's claim of "no write is recorded for its `#id` rule at all" — predicted that a `new Glyph('unicode-arrow-up')` would produce zero `setRuleStyles` calls for its four size keys once `GLYPH_DEFAULT_SIZE` matches. In practice, with the source fix applied, `ruleStyleWrites(sink)` for that instance's `#id` rule still contains four entries for `minWidth`/`minHeight`/`maxWidth`/`maxHeight` — each with `value: null` (an explicit removal), not a real value, and not absent. Root cause, confirmed with a recording-sink probe: `unicode-arrow-up` is a **char-mode** glyph, and char-mode's `lineHeight`/`textAlign` defaults are applied imperatively from the constructor body (per `_defaultGlyphOptions`'s own doc comment — they depend on `def.kind` and so cannot live in the shared defaults bag). No class default exists for `lineHeight`/`textAlign` at all, so those two declarations are always real and always force `#id` to materialise, regardless of this plan's fix. Once `#id` materialises for any reason, the now-matching size keys ride along in the same `applySizeConstraintStyles` batch as explicit `null` removals — precisely the same "forced materialisation + null removal" pattern the pre-existing `CheckboxBox` row 1 test (`Checkbox.test.ts`) already documents for a rule kept alive by its own unrelated `border-radius` declaration. A probe against an SVG-mode glyph (`xmark`, which sets neither `lineHeight` nor `textAlign`) confirmed the literal `[]` the plan predicted *is* reachable — just not for a char-mode instance.

The test was corrected in place (same subject, `unicode-arrow-up`, no new imports) to assert the true post-fix signal — the four size keys are present but every one is an explicit `null` removal, never a real `12`/`16`px value — rather than asserting zero writes outright. This keeps faith with row 1's actual intent (this `Glyph`'s size no longer writes a *real* per-instance declaration) without overclaiming that `#id` stops materialising entirely, which was never true for a char-mode glyph and is unrelated to this plan's fix. `## Expected Behaviour` row 1 and step 3's code sample are both stale in the plan text as written; no other plan claim was affected — rows 2-3 (`Checkbox`/`RadioButton`'s delegate glyphs, both SVG-mode via `check`/`circle`) behaved exactly as predicted, confirmed by the passing `declarations` `{}` assertions in `Checkbox.test.ts`/`RadioButton.test.ts`.

**Live browser verification (`## Ordered Implementation Steps` step 12 / `## Verification`'s manual rows 7-8) was performed and passed.** A dev server was started from this worktree on a spare port (8025), confirmed via `readlink /proc/<pid>/cwd` to be serving `packages/lib` inside this worktree. Navigated to `#/misc` → "Show window with table (slow)!" → "Style Audit" → "Refresh". Result: `CheckboxCheckGlyph` does not appear anywhere in the audit table (the duplicate-rule row is gone entirely); the `{min-width:8px;...}` group lists only `Glyph` (`RadioButtonDot` no longer contributes to it); no `{min-width:16px;...}` bare-`Glyph` group remains; `CheckboxBox`'s `{border-radius:...}` row is present and unchanged at 32 instances / 1.60 KB, confirming the sibling `checkboxbox-borderradius-hoist.md` plan's target is unaffected. Totals: 850 rules / 763 per-instance — matching the plan's own recorded after-numbers. Computed styles were also read directly on a rendered `Checkbox` and `RadioButton`: `CheckboxCheckGlyph` renders 12×12 inside the 16×16 `.CheckboxBox` (border-radius 3px, unaffected), and `RadioButtonDot` renders 8×8 inside the 16×16 `.RadioButtonRing` (border-radius 50%) — both centred exactly as before. The dev server was stopped after verification.
