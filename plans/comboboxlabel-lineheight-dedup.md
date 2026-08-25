---
touches-shared:
  - packages/lib/src/typescript/lib/component/input/ComboBox.ts
  - packages/lib/docs/reference/changelog/next.md
---

# ComboBoxLabel `line-height` Value-Class Dedup — Implementation Plan

## Overview

The in-app Style Audit panel found the same `line-height` declaration repeated across 27 ComboBox instances. [`ComboBoxLabel.setLineHeight()`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L474) writes it with a raw, unconditional `this.setElementCSSRule("lineHeight", …)`, so each label materialises its own `#id` rule carrying a value every other ComboBox on the page has already written.

The value is the same everywhere because it is theme-derived, not caller-supplied. [`ComboBox.doLayout()`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L837) passes the label's own content-box height, and that height comes from [`ComboBox.updateHeight()`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L789), which pins the control to one line box: `Util.singleLineBoxHeight(...)` = [`Util.lineHeightPx()`](packages/lib/src/typescript/lib/core/Util.ts#L174) plus the control's own chrome. Every ComboBox under one theme therefore resolves the identical pixel number.

`Text` had the identical problem and it was fixed by [`plans/implemented/text-lineheight-write-path-and-value-class-sharing.md`](implemented/text-lineheight-write-path-and-value-class-sharing.md), whose `## Non-Goals` named `ComboBox` as out of scope. This plan closes that gap. The mechanism that plan introduced has since been generalised onto `Component` as [`setValueStyleState`](packages/lib/src/typescript/lib/core/Component.ts#L5751) / [`clearValueStyleState`](packages/lib/src/typescript/lib/core/Component.ts#L5788) / [`getValueStyleToken`](packages/lib/src/typescript/lib/core/Component.ts#L5778): a shared `.ClassName.<prefix><value>` class-tier rule that every instance resolving the same value points at through one DOM class token, instead of each writing its own `#id` declaration.

`ComboBoxLabel` extends `Component` directly ([ComboBox.ts:401](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L401)), not `Text`, so it cannot inherit `Text`'s fix — but the mechanism is `protected` on `Component`, so it needs no new machinery, only a rewritten `setLineHeight` body and a small catch-up in the existing `init()` override. All source changes are inside `component/input/ComboBox.ts`.

---

## Architecture Decisions

### Reuse `Component.setValueStyleState` with the same `"lh"` prefix `Text` uses

`ComboBoxLabel.setLineHeight`'s numeric branch points the instance at the shared `.ComboBoxLabel.lh<value>` rule via `this.setValueStyleState("lh", resolved, { font: { lineHeight: resolved } })`, mirroring [`Text.setLineHeight`](packages/lib/src/typescript/lib/component/input/Text.ts#L1197) line for line. The second in-tree adopter, [`Cell.setBaseBackground`](packages/lib/src/typescript/lib/component/table/cell/Cell.ts#L466), uses the same shape with prefix `"bg"`.[^reuse]

Rules are keyed by the concrete constructor ([`ensureClassStateRule`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1045)), so `.Text.lh16px` and `.ComboBoxLabel.lh16px` are separate rules that never collide even when both resolve `16px`. Sharing the `"lh"` prefix across the two classes is therefore free, and keeps one searchable token for "this element's line-height comes from a value class".

Token derivation is `setValueStyleState`'s own, not this plan's — `prefix + cssValue.replace(/[^a-zA-Z0-9]/g, "_")`:

| `setLineHeight` argument | Resolved CSS value | DOM class token | Shared rule |
|---|---|---|---|
| `16` | `"16px"` | `lh16px` | `.ComboBoxLabel.lh16px` |
| `20` | `"20px"` | `lh20px` | `.ComboBoxLabel.lh20px` |
| `"1.4em"` | `"1.4em"` | (none — a string goes down the instance-layer branch instead, below) | (none) |

### `setHeight` is untouched, and the shared rule cannot desync from it

[`ComboBox.doLayout()`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L831-L837) feeds one local, `box.height`, to both `this._label.setHeight(box.height)` and `this._label.setLineHeight(box.height)` — the vertical-centering trick that makes a single line of label text sit centred in the label's box. This plan changes neither that call site nor `setHeight`.[^setheight]

The two writes cannot drift, for three reasons. They are spelled out because an implementer who reads the two calls as a mismatch might try to "fix" one of them:

- **Same source value.** Both arguments are the same `box.height` local in the same `doLayout` pass. This plan adds no second derivation of the height.
- **Different properties, different buffers.** `setHeight` writes the `height` *inline style* ([Component.ts:3864](packages/lib/src/typescript/lib/core/Component.ts#L3864)); `setLineHeight` writes the `line-height` *CSS rule*. The value class changes only which rule carries `line-height`, never the number in it.
- **The number is a whole pixel count.** `setHeight` rounds (`Math.round`), `setLineHeight` does not — but `box.height` is already an integer, so the two agree exactly. `updateHeight` pins min, preferred and max height to the same `Util.singleLineBoxHeight(...)` value, `Util.lineHeightPx()` is itself `Math.round`ed ([Util.ts:185](packages/lib/src/typescript/lib/core/Util.ts#L185)), and [`clampHeight`](packages/lib/src/typescript/lib/core/Component.ts#L3876) clamps the committed height into that equal min/max pair.

So `setLineHeight` keeps its existing un-rounded `value + "px"` formatting. Adding a `Math.round` would be dead code, and a fractional height — if one ever reached this path — still produces a correct token (`lh18_5px`), just a less widely shared one.

### The string branch writes through the style bag; the numeric branch clears that write when it takes over

`setLineHeight` accepts `number | string`. The string branch stops using `setElementCSSRule` and writes `this.writeStyle({ font: { lineHeight: resolved } })` instead — the *instance layer*, the style bag whose declarations end up on this component's own `#id` rule — matching `Text`'s string branch. It clears any active value class first.

Going the other way, the numeric branch must clear that instance-layer declaration before pointing at the shared rule: an `#id` declaration has specificity `(1,0,0)` and always outranks the shared `.ComboBoxLabel.lh16px` rule's `(0,2,0)`, so a leftover string-mode value would silently keep winning.[^clear] The instance tracks which mode its last write used in a new `_lineHeightOnInstanceLayer` boolean, so a numeric-to-numeric value change — the hot path, hit on every layout pass — queues no extra write.

### Unchanged `(value, mode)` returns early

`ComboBox.doLayout()` calls `setLineHeight` on every layout pass with the same number almost every time. Today's body is unconditional; the new body returns early when both the resolved CSS value and the write mode are unchanged, so a repeat pass issues no `DOM.sink.apply` class write and no rule lookup.[^guard] This is the framework's standard "unchanged value → early return" idiom and is also what `Text.setLineHeight`'s own guard does.

### The class token is re-asserted from the existing `init()` override, not a new `render()`

`setValueStyleState` records its token whether or not the element exists, but writes the DOM class only when it does. A token recorded before first render therefore needs a catch-up at render. `Text` does this in its `render()` override; `ComboBoxLabel` already overrides [`init()`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L500) and `Component.render()` calls `init(element)` with the freshly created element, so the two hooks are equivalent here — and `Component.init` is where the framework's own generic state-token catch-up already lives ([Component.ts:6913-6924](packages/lib/src/typescript/lib/core/Component.ts#L6913-L6924)).[^inithook]

### No `cacheStyleValue` call, unlike the `Cell` precedent

`Cell.setBaseBackground` pairs `setValueStyleState` with `cacheStyleValue('backgroundColor', …)` because `Cell.getBackgroundColor()` reads the resolved style bag. `ComboBoxLabel.getLineHeight()` reads its own private `_lineHeight` field ([ComboBox.ts:487](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L487)), which this plan keeps updated, so no bag cache is needed.

---

## Public API

No public signature changes. `ComboBoxLabel` is a module-private class (not exported from `ComboBox.ts` and not re-exported by any barrel), and `setLineHeight` / `getLineHeight` keep their current signatures:

```typescript
setLineHeight(value: number | string): this;
getLineHeight(): string | null;
```

`_lineHeightOnInstanceLayer` is a new `private` field. `setValueStyleState` / `clearValueStyleState` / `getValueStyleToken` are existing `protected` members of `Component`, used unchanged.

---

## Internal Structure

### `component/input/ComboBox.ts` — new private field, beside `_lineHeight`

```typescript
class ComboBoxLabel extends Component {
    private _lineHeight: string | null = null;
    // True when `_lineHeight`'s current value was written through the
    // instance layer (the string branch of setLineHeight). The numeric
    // branch reads it to know whether it must clear a real #id
    // declaration before pointing this instance at the shared
    // `.ComboBoxLabel.lh<value>` rule, whose (0,2,0) specificity an #id
    // declaration would otherwise outrank. False in the numeric-only
    // lifetime every in-library caller actually produces.
    private _lineHeightOnInstanceLayer = false;
```

The field needs no `declare`: `setLineHeight` is never dispatched from the `super()` cascade — `ComboBoxLabel`'s constructor ([ComboBox.ts:410-415](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L410-L415)) never calls it, and the only caller is `ComboBox.doLayout()`, which runs long after construction.

### `component/input/ComboBox.ts` — `setLineHeight`, before → after

```typescript
// Before (ComboBox.ts:474-480):
setLineHeight(value: number | string): this {
    this._lineHeight = typeof value === "number" ? value + "px" : value;

    this.setElementCSSRule("lineHeight", this._lineHeight);

    return this;
}
```

```typescript
// After:
setLineHeight(value: number | string): this {
    const numeric  = typeof value === "number";
    const resolved = numeric ? value + "px" : value;

    if (this._lineHeight === resolved && this._lineHeightOnInstanceLayer === !numeric) {
        return this;
    }

    if (numeric) {
        if (this._lineHeightOnInstanceLayer) {
            this.writeStyle({ font: { lineHeight: null } });
            this._lineHeightOnInstanceLayer = false;
        }

        this.setValueStyleState("lh", resolved, { font: { lineHeight: resolved } });
    } else {
        this.clearValueStyleState("lh");
        this.writeStyle({ font: { lineHeight: resolved } });
        this._lineHeightOnInstanceLayer = true;
    }

    this._lineHeight = resolved;

    return this;
}
```

The guard compares mode as well as value so that `setLineHeight(16)` followed by `setLineHeight("16px")` still switches write path, rather than silently keeping the value class.

The JSDoc above the method keeps its existing first two sentences and gains one: that the numeric form paints through a shared `.ComboBoxLabel.lh<value>` rule rather than this instance's own `#id` rule.

### `component/input/ComboBox.ts` — `init()`, added catch-up

```typescript
protected init(element?: Handle): this {
    super.init(element);

    const el = element || this.getElement();
    if (el) {
        DOM.sink.appendChild(el, this._renderer.getElement(true)!);

        // Re-assert a value-class token recorded by setLineHeight before
        // this element existed — setValueStyleState's own DOM write is
        // gated on getElement(). Mirrors Text.render()'s catch-up and
        // Component.init's own re-apply of declared state tokens.
        const lineHeightToken = this.getValueStyleToken("lh");
        if (lineHeightToken) {
            DOM.sink.apply(el, { addClass: [lineHeightToken] });
        }
    }

    return this;
}
```

No new imports: `DOM` and `Handle` are already imported in `ComboBox.ts`.

---

## Ordered Implementation Steps

1. **Hoist two test helpers in `packages/lib/tests/component/input/ComboBox.test.ts`.** `idSelector` and `declarationsDuring` currently live inside the `describe('ComboBoxCaret static style hoisting')` block ([ComboBox.test.ts:239-269](packages/lib/tests/component/input/ComboBox.test.ts#L239-L269)). Move both, unchanged, to module scope just above that `describe`, so the new block added in step 2 can use them without a second copy. Change nothing else in the file.
   *Check:* `npx vitest run tests/component/input/ComboBox.test.ts` — still all green.

2. **Write the new tests first**, as a new `describe('ComboBoxLabel line-height value-class sharing')` block at the end of `ComboBox.test.ts`, covering `## Expected Behaviour` rows 1-8. Reach the label with `const label = (combo as any)._label`, exactly as the existing caret block reaches `combo._caret`.
   *Check:* `npx vitest run tests/component/input/ComboBox.test.ts` — the new cases fail for the expected reason (the mechanism doesn't exist yet); the pre-existing cases stay green.

3. **`component/input/ComboBox.ts` — add the `_lineHeightOnInstanceLayer` field.** Per `## Internal Structure`.
   *Check:* `npm run typecheck`.

4. **`component/input/ComboBox.ts` — rewrite `setLineHeight`'s body and extend its JSDoc.** Per `## Internal Structure`'s before/after. Leave `getLineHeight` untouched.
   *Check:* `npm run typecheck`. `grep -n 'setElementCSSRule("lineHeight"' packages/lib/src/typescript/lib/component/input/ComboBox.ts` — zero matches.

5. **`component/input/ComboBox.ts` — add the token catch-up to the existing `init()` override.** Per `## Internal Structure`. Do not add a `render()` override.
   *Check:* `npm run typecheck`. `grep -c 'protected render()' packages/lib/src/typescript/lib/component/input/ComboBox.ts` — zero.

6. **Run the new tests.** `npx vitest run tests/component/input/ComboBox.test.ts` — all green.

7. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`. `grep -rln "setLineHeight" packages/lib/tests` first, to spot any other file pinned to the old per-instance write.

8. **Add the changelog entry.** See `## Documentation Impact`.

9. **Full verification, including the live-browser and cross-theme checks.** See `## Verification`. These are not optional — see `## Potential Challenges`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/tests/component/input/ComboBox.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-8 are unit-testable against the recording DOM sink. Rows 9-11 need a live browser.

Rows 1-6 drive `label.setLineHeight(...)` directly for determinism; rows 7-8 go through the real `ComboBox.doLayout()` path and derive the expected token from `label.getLineHeight()` rather than hard-coding a pixel number, because the number depends on the theme's font-size and line-padding tokens.

Rows 1-6 use `31` and `37` deliberately: a value the theme's own line box could also produce would make the new unchanged-value early return swallow the very write the test is asserting, if a layout pass had already set the same value. Any two numbers no theme resolves to work equally well.

| # | Case | Expected |
|---|---|---|
| 1 | Two rendered `ComboBox`es' labels both call `setLineHeight(31)` | Neither label's own `#id` rule carries a `lineHeight` declaration; both label elements gain DOM class `lh31px`; `_ruleCacheHas('.ComboBoxLabel.lh31px')` is `true` |
| 2 | A rendered label calls `setLineHeight(31)` then `setLineHeight(37)` | One `apply` write carrying both `removeClass: ['lh31px']` and `addClass: ['lh37px']`; no `lineHeight` declaration on `#id` at either point; `_ruleCacheHas('.ComboBoxLabel.lh37px')` is `true` |
| 3 | A rendered label calls `setLineHeight(31)` twice | The second call produces no `apply` write and no rule write at all (the unchanged-`(value, mode)` early return) |
| 4 | A rendered label calls `setLineHeight(31)` then `setLineHeight("1.4em")` | `removeClass: ['lh31px']` with no `addClass`; `#id`'s rule now carries a real `lineHeight: 1.4em` declaration; `getLineHeight()` returns `"1.4em"` |
| 5 | A rendered label calls `setLineHeight("1.4em")` then `setLineHeight(31)` | `#id`'s `lineHeight` is written as `null` (an explicit removal, so the string-mode value stops outranking the shared rule); the element gains `lh31px`; `_ruleCacheHas('.ComboBoxLabel.lh31px')` is `true` |
| 6 | `setLineHeight(31)` on a label whose element does not exist yet, then render it | No `apply` write before render; the rendered element carries `lh31px` (via the `init()` catch-up) |
| 7 | Two `ComboBox`es rendered and laid out at their own preferred height under one theme | Both labels report the same `getLineHeight()`; both elements carry the same `lh<n>px` token; exactly one shared rule exists for it |
| 8 | The same laid-out `ComboBox`, with the test DOM configured for `--ts-ui-font-size: '18px'` instead of `'14px'` (`Util.invalidateTextMetricsCache()` between installs) | `getLineHeight()` differs from the 14px case, and the shared rule exists under the correspondingly different token — the value tracks the theme's font size, and one theme's rule is never reused for another |
| 9 | Manual — live app, default (`ModernTheme`) look: open the "Tabs" section (five ComboBoxes), "Misc.", "Binding", "Complex" and "ToolBar", then the "Style Audit" section | The `ComboBoxLabel`-attributed duplicate-body row carrying a `line-height` declaration is gone from the audit's list; every ComboBox still shows its selected label vertically centred, unchanged |
| 10 | Manual — live app: `Misc.` → the theme-cycle button ([MiscPanel.ts:842-853](packages/lib/src/typescript/MiscPanel.ts#L842-L853)), stepping `ModernTheme` → `ClassicTheme` → `DarkTheme` and back | Label text stays vertically centred at every step; each label element carries exactly one `lh*` class throughout (never two, never zero); no console errors |
| 11 | Manual — live app with a font-size override applied (see `## Verification`) | Every ComboBox label swaps to a new `lh*` token matching the new line box, the previous token is removed from the element, and the label text is still centred in the resized control |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariant:

```
grep -n 'setElementCSSRule("lineHeight"' packages/lib/src/typescript/lib/component/input/ComboBox.ts   # zero matches
```

### Cross-theme verification is mandatory, and one shipped-theme check is not enough

The value this plan shares is theme-derived, so it must be checked under more than one font size. The shipped themes do not by themselves provide that: `BaseTheme` declares `font.size: '14px'` and `font.linePadding: '2px'` ([BaseTheme.ts:17-21](packages/lib/src/typescript/lib/core/themes/BaseTheme.ts#L17-L21)), and **`ModernTheme`, `ClassicTheme` and `DarkTheme` are each `defineTheme(BaseTheme, …)` and none of the three overrides either token** — so all three resolve the same line box.[^themes] Both halves below are required:

- **Two named shipped themes, for the theme-change path.** Row 10: cycle `ModernTheme` → `ClassicTheme` → `DarkTheme` with the Misc. section's theme button and confirm no label ends up with a stale or duplicated `lh*` class. This exercises the `subscribeTheme(() => this.updateHeight())` → relayout → `setLineHeight` route ([ComboBox.ts:703-704](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L703-L704)), which fires after `Util.invalidateTextMetricsCache()` ([Theme.ts:1422](packages/lib/src/typescript/lib/core/Theme.ts#L1422)).
- **A genuinely different font size, for the changed-value case.** Offline this is row 8, driving `installTestDOM`'s `themeVars` at `'14px'` and `'18px'`. Live (row 11), apply an 18px override from the browser console on the dev page — `document.documentElement.style.setProperty('--ts-ui-font-size', '18px')` — then force a relayout by resizing the window, and inspect a label element's class list and computed `line-height`.

### Live browser verification is required

Start a dev server on a spare port from *this worktree* (`npm run dev` binds 8015 for the user's own tree — do not reuse it). The offline harness records writes; it does not run a CSS cascade, so the specificity reasoning behind `## Architecture Decisions` can only be confirmed by reading a label's computed `line-height` in the browser. Exercise rows 9-11.

---

## Documentation Impact

No exported symbol changes: `ComboBoxLabel` is module-private, so nothing reaches the generated API docs and no doc page references it. One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under the existing `## Changed` → `### Components` heading:

> **A `ComboBox`'s collapsed label now paints its `line-height` through a CSS rule shared by every ComboBox resolving the same line box, instead of each control writing its own.** The line box is theme-derived, so every ComboBox on a page normally resolves the same value; previously each one repeated that declaration in its own rule. No consumer action needed; nothing changes visually.

---

## Potential Challenges

- **The shared rule is silently skipped on a class-name collision.** `ensureClassStateRule` bails out — creating no rule at all — when another constructor already claimed the name `"ComboBoxLabel"` ([ClassStyleRules.ts:1061-1068](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1061-L1068)). `setValueStyleState` would still add the class token, so the line-height would vanish rather than fall back. The `_ruleCacheHas('.ComboBoxLabel.lh<n>px')` assertions in rows 1, 2, 5, 7 and 8 are what catch this; keep them.
- **A minifier renaming `ComboBoxLabel` breaks the selector.** This exposure is pre-existing and unchanged — the module-level `.ComboBoxLabel` class rule ([ComboBox.ts:368-375](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L368-L375)) already depends on `constructor.name` surviving the build, and `plans/minification-safe-class-names.md` tracks it globally. This plan adds no new dependency on it.
- **A fractional `box.height` would fragment the shared rules.** It cannot occur today (see `## Architecture Decisions`), and the result would be correct-but-unshared rather than wrong, so no defensive rounding is added. If a future change lets ComboBox heights go fractional, that is when rounding gets revisited.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/component/input/ComboBox.ts` | Every line this plan touches: `ComboBoxLabel` (401), `_lineHeight` (402), `setLineHeight` (474), `getLineHeight` (487, untouched), `init` (500), the module-level `.ComboBoxLabel` class rule (368-375, untouched), `ComboBox.doLayout`'s paired `setHeight`/`setLineHeight` calls (834, 837, untouched), `updateHeight` (789, untouched), the theme subscription (703-704, untouched) |
| `plans/implemented/text-lineheight-write-path-and-value-class-sharing.md` | The direct precedent this plan ports. Read its Architecture Decisions for why the state-tier mechanism is reused with a value-derived suffix |
| `packages/lib/src/typescript/lib/component/input/Text.ts` | `setLineHeight` (1159) — the shape this plan mirrors, including the enter-numeric-mode clear at 1187-1195 — and `render` (1507), the token catch-up this plan puts in `init()` instead |
| `packages/lib/src/typescript/lib/component/table/cell/Cell.ts` | `setBaseBackground` (443) — the second adopter, prefix `"bg"`; shows the `cacheStyleValue` pairing this plan deliberately omits |
| `packages/lib/src/typescript/lib/core/Component.ts` | `setValueStyleState` (5751), `getValueStyleToken` (5778), `clearValueStyleState` (5788), `ensureSharedStateRule` (5581), `writeStyle` (5115), `setHeight` (3850), `clampHeight` (3876), `init`'s state-token re-apply (6913-6924) — all reused unchanged |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `ensureClassStateRule` (1045) and its name-collision opt-out (1061-1068); `FONT_WRITERS`' `lineHeight` entry (316), which is what makes `{ font: { lineHeight } }` a valid patch for a plain `Component` |
| `packages/lib/src/typescript/lib/core/themes/BaseTheme.ts` | `font.size` / `font.linePadding` (17-21) — the single source all three shipped themes inherit, and the reason a shipped-theme switch alone does not test a changed value |
| `packages/lib/tests/component/input/ComboBox.test.ts` | The `ComboBoxCaret static style hoisting` block (238-298): the `_ruleCacheHas` / `idSelector` / `declarationsDuring` conventions this plan's new tests follow, and the helpers step 1 hoists |
| `ARCHITECTURE.md` | *Component CSS tiers and state-rule dedup* — the specificity table this plan's `#id`-outranks-`.class.class` reasoning rests on |

---

## Non-Goals

- **`Glyph.setLineHeight()`.** `Glyph` has its own independent implementation ([Glyph.ts:401](packages/lib/src/typescript/lib/component/display/Glyph.ts#L401)); the precedent plan listed it alongside `ComboBox` and it stays out of scope here. Its call sites and duplication profile differ and it deserves its own audit finding.
- **Changing `ComboBox.doLayout()`, `ComboBox.updateHeight()`, or `setHeight`.** The label keeps receiving `box.height` exactly as today — see `## Architecture Decisions`.
- **Making `ComboBoxLabel` extend `Text`.** It would inherit the fix, but it would also inherit `Text`'s measurement registry, truncation, and font-bag surface for a component that only hosts a `ListItemRenderer`. The `protected` mechanism on `Component` gives the same result for a fraction of the change.
- **A generic value-class re-apply in `Component.init`.** Would remove the per-class catch-up from `Text.render()` and this plan's `init()`, but it is a core change affecting every adopter and belongs to its own plan.
- **Removing `ComboBoxLabel.setLineHeight`'s string branch,** or its `getLineHeight` getter. Both are pre-existing and currently unreachable from in-library callers; deleting them is unrelated dead-code removal.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^reuse]: `Component.setValueStyleState` was extracted from `Text`'s original private `applyLineHeightValueClass`/`clearLineHeightValueClass` pair precisely so a second class could adopt it without bespoke machinery — its own doc comment says as much ([Component.ts:5735-5738](packages/lib/src/typescript/lib/core/Component.ts#L5735-L5738)). Two alternatives were considered and rejected. Copying `Text`'s original private pair into `ComboBoxLabel` would duplicate the token derivation and the add/remove bookkeeping that now live in one place. Making `ComboBoxLabel` extend `Text` would inherit the fix but also `Text`'s whole text-measurement and font surface, for a component that renders no text of its own.

[^setheight]: The precedent investigation flagged the paired `setHeight` / `setLineHeight` calls as the thing most likely to be broken by a careless rewrite: the label's height and its line-height are deliberately the same number, and that equality *is* the vertical-centering mechanism. This plan's changes are confined to how the `line-height` declaration is stored, so the equality is preserved by construction. The one place the two genuinely differ — `setHeight` rounds, `setLineHeight` does not — is already unreachable, because `ComboBox.updateHeight` pins min == preferred == max to an integer and `clampHeight` clamps the committed height into that pair.

[^clear]: `Text.setLineHeight` needs the same clear and tracks it in `wasReconciledMode` ([Text.ts:1187](packages/lib/src/typescript/lib/component/input/Text.ts#L1187)). `Text`'s initial state is already "instance layer may carry a value", because `Text`'s class tier declares a `lineHeight` default (`ADDITIVE_LINE_HEIGHT_RULE`) that its constructor writes. `ComboBoxLabel` has no such default — its class rule declares only `overflow` and `textOverflow` — so `_lineHeightOnInstanceLayer` correctly starts `false`, and the very first numeric call queues nothing to `#id`. That is why row 1 expects the key to be absent, where the corresponding `Text` test expects an explicit `null`.

[^guard]: The early return is a behaviour change from today's unconditional write, so it is worth stating what it cannot break. `setLineHeight` has no other side effects — it does not schedule a layout, does not touch measurement state, and does not notify anything — so skipping a repeat call with an identical resolved value and identical mode is unobservable except in the write log. `Text.setLineHeight` needed its own guard for a stronger reason (its unconditional `scheduleLayout()` pinned the CPU in a relayout loop); here the motivation is only to stop a per-layout-pass `apply` write.

[^inithook]: `Text` put its catch-up in `render()` only because `Text` already had a `render()` override (it writes the element's `textContent` there), so the token re-apply was a two-line addition to an existing method rather than a new one. `ComboBoxLabel` is in the mirror-image position: it has an `init()` override and no `render()`, so adding a `render()` override purely to host two lines would leave the class with two render-path hooks where one suffices. The hooks are interchangeable for this purpose because `Component.render()` ([Component.ts:6996-7003](packages/lib/src/typescript/lib/core/Component.ts#L6996-L7003)) is the only thing that creates the element and it calls `init(element)` with it immediately. `init` is not re-run on a later re-bind either — that is what `reattachElementBuffers` exists for — so the catch-up cannot double-apply.

[^themes]: Checked by reading all four theme files. `ClassicTheme` ([ClassicTheme.ts:19](packages/lib/src/typescript/lib/core/themes/ClassicTheme.ts#L19)), `ModernTheme` ([ModernTheme.ts:19](packages/lib/src/typescript/lib/core/themes/ModernTheme.ts#L19)) and `DarkTheme` ([DarkTheme.ts:17](packages/lib/src/typescript/lib/core/themes/DarkTheme.ts#L17)) each call `defineTheme(BaseTheme, …)` with palette-and-scheme overrides only; the sole structural divergence any of them declares is `tab.underBorderFullWidth`. `BaseTheme` is not a usable theme on its own (it carries no palette), so there is no fourth shipped theme to reach for. This is why the plan pins the changed-value case with `themeVars` in a unit test and a console-applied override live, rather than pretending a theme switch covers it.
