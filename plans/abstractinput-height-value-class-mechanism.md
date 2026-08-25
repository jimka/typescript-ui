---
depends-on: [cell-base-background-value-class-dedup]
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
---

# AbstractInput Single-Line Height Value-Class Sharing — Implementation Plan

## Overview

A live Style Audit scan reports the framework's largest remaining duplicate-CSS bucket: roughly 96-102 per-instance rules across the `AbstractInput` family whose whole body is the same two declarations, `{ max-height: 24px; min-height: 24px; }` (plus a smaller 22px group). Every single-line input pins its own height: [`TextField.updateHeight`](packages/lib/src/typescript/lib/component/input/TextField.ts#L77), [`ComboBox.updateHeight`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L789) and [`NumberSpinner.updateHeight`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L278) each call [`Util.singleLineBoxHeight`](packages/lib/src/typescript/lib/core/Util.ts#L238) and feed the result to `setPreferredSize` / `setMaxSize` / `setMinSize`. Those size writes land on the instance layer, and `flushStyleBag` writes `min-height` / `max-height` to that instance's own `#id` rule because no lower tier supplies them.

The height is not a class constant. `Util.singleLineBoxHeight` returns `Util.lineHeightPx() + insets + padding + border`, and `lineHeightPx` reads the live theme variables `--ts-ui-font-size` and `--ts-ui-line-padding` ([`Util.ts:174`](packages/lib/src/typescript/lib/core/Util.ts#L174)). Each of the three classes re-runs `updateHeight` on every theme change, through its own `subscribeTheme` call ([`TextField.ts:58`](packages/lib/src/typescript/lib/component/input/TextField.ts#L58), [`ComboBox.ts:704`](packages/lib/src/typescript/lib/component/input/ComboBox.ts#L704), [`NumberSpinner.ts:211`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L211)). So the shared value is a runtime number, not something a class-tier `StyleBag` default could ever express — which is exactly why [`plans/implemented/abstractinput-height-dedup.md`](plans/implemented/abstractinput-height-dedup.md) left it alone. That plan's `## Non-Goals` names this residual verbatim:

> **The 24px/22px height *values* stay per-instance**, not hoisted to a static class default. `Util.singleLineBoxHeight` reads live theme font metrics, so the number is theme-dependent, not a static literal a class-tier `StyleBag` default could express. A real fix needs a "value-keyed shared rule" mechanism — computed once per distinct resolved value, shared across every instance that resolves to it — which doesn't exist in this codebase yet.

That mechanism exists now. `Component.setValueStyleState` ([`Component.ts:5751`](packages/lib/src/typescript/lib/core/Component.ts#L5751)) publishes a shared `.ClassName.<prefix><value>` rule keyed by a resolved runtime value and points an instance at it with a DOM class token; `Text`'s numeric line-height is its one current caller ([`Text.ts:1197`](packages/lib/src/typescript/lib/component/input/Text.ts#L1197)). The sibling plan [`cell-base-background-value-class-dedup.md`](cell-base-background-value-class-dedup.md) completes it by recording the shared rule as a `StyleLayer` inside `layersBelowInstance()`, so `flushStyleBag` recognises the value as already delivered and queues a removal instead of a per-instance declaration.

This plan opts the three height owners into that finished mechanism. It adds one protected helper on [`AbstractInput`](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L51), one line in [`Component.init`](packages/lib/src/typescript/lib/core/Component.ts#L6892), and one call in each of the three `updateHeight` bodies. No layout behaviour changes: `setPreferredSize` / `setMaxSize` / `setMinSize` keep running exactly as today, so every size getter answers the same number it does now.

---

## Architecture Decisions

### This is one plan, not a mechanism plan plus an application plan

Everything in the mechanism half is already built or already planned, so the work that remains here is one protected helper and four call sites — too small to stand alone, and unverifiable without a caller.[^one-plan]

### The shared rule pins its widths to the framework baseline, not to the instance

`setValueStyleState` takes a `StyleBag` patch, and `minSize` / `maxSize` are whole-`Size` keys that always expand to a width declaration as well as a height one. The patch this plan passes therefore uses the framework's own baseline widths (`0` and `UNBOUNDED`) rather than this instance's real widths, so the shared rule's two width declarations are inert and identical for every instance:

```typescript
{ minSize: { width: 0, height: h }, maxSize: { width: UNBOUNDED, height: h } }
```

`resolvePartialDeclarations` turns that into `{ minWidth: "0px", minHeight: "24px", maxWidth: "none", maxHeight: "24px" }`, and `minWidth: "0px"` / `maxWidth: "none"` are byte-identical to `FRAMEWORK_DECLARATIONS`' own values ([`ClassStyleRules.ts:114-117`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L114)). Passing the instance's real widths instead would let whichever instance minted the rule first bake its own width into it, and every later instance with a different width would then write a width declaration to `#id` that it does not write today.[^normalised-widths]

### The value class is published before the size writes, in the same `updateHeight` call

`writeStyle` flushes immediately when the component already has an element ([`Component.ts:5115`](packages/lib/src/typescript/lib/core/Component.ts#L5115)), so `setMinSize` / `setMaxSize` compare against whatever `layersBelowInstance()` holds at that moment. Publishing the new value class first means the flush sees a match and queues a removal; publishing it afterwards would let the flush write the new height to `#id` for real, where it outranks the shared rule permanently.[^ordering]

### A token recorded before first render is re-applied by `Component.init`, not by three `render()` overrides

All three `updateHeight` calls run from a constructor, before any element exists, so `setValueStyleState`'s DOM write is skipped and only the token is recorded. `Component.init` already re-applies deferred DOM class tokens for active style states ([`Component.ts:6921-6924`](packages/lib/src/typescript/lib/core/Component.ts#L6921)); this plan extends that same `addClass` call with the recorded value-class tokens.[^init-catchup]

### The rule pool stays keyed on the concrete class — no cross-class sharing

`ensureClassStateRule` caches by constructor ([`ClassStyleRules.ts:1045`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1045)), so a 24px `TextField`, `ComboBox` and `NumberSpinner` get three separate rules with identical bodies. That stays as it is.

Sharing one rule across the three classes would be *safe* — a value-keyed pool is self-correcting, because an instance only ever joins the pool whose key equals its own freshly computed number — but it is not *justified*, on two counts. The three classes do not actually run the same computation: they pass different arguments to `Util.singleLineBoxHeight`, and `NumberSpinner` passes its inner field's padding rather than its own ([`NumberSpinner.ts:281`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L281)). Only one addend, `Util.lineHeightPx()`, is genuinely shared; the chrome terms agree by coincidence. And the payoff is negligible: per-class pooling already takes this bucket from ~100 rules to about six, and cross-class pooling would take six to two.[^cross-class]

### A theme change needs no cache invalidation

Nothing has to be invalidated when the theme changes, because the pool is keyed by the value itself: a new theme yields a new number, hence a new key, hence a new rule. The three `updateHeight` subscribers run in one synchronous sweep after `Util.invalidateTextMetricsCache()` ([`Theme.ts:1421-1424`](packages/lib/src/typescript/lib/core/Theme.ts#L1421)), and no class reads another class's pool, so their relative order cannot matter.[^theme-invalidation]

---

## Public API

No public signature changes. The new helper is `protected` on `AbstractInput`, so `excludeProtected` keeps it out of the generated docs:

```typescript
protected pinSingleLineBoxHeight(h: number): void;
```

---

## Internal Structure

### Token derivation and rule selectors

`setValueStyleState` builds the token as `prefix + cssValue.replace(/[^a-zA-Z0-9]/g, "_")` and the shared rule's selector as `.ClassName.<token>`. With prefix `"h"` and `cssValue` `h + "px"`:

| Class | Resolved `h` | `cssValue` | DOM class token | Shared rule selector |
|---|---|---|---|---|
| `TextField` | 24 | `"24px"` | `h24px` | `.TextField.h24px` |
| `ComboBox` | 24 | `"24px"` | `h24px` | `.ComboBox.h24px` |
| `NumberSpinner` | 24 | `"24px"` | `h24px` | `.NumberSpinner.h24px` |
| `TextField` (larger theme font) | 30 | `"30px"` | `h30px` | `.TextField.h30px` |

The token is the same string across classes; the *rule* differs, because the selector is anchored on each concrete class name.

### Where each declaration comes from after this change

| Selector | Specificity | Carries |
|---|---|---|
| `#tf7` (this instance's own rule) | `(1,0,0)` | only a genuine per-instance deviation — after this change, no height |
| `.TextField.h24px` | `(0,2,0)` | `min-height: 24px`, `max-height: 24px`, plus the inert `min-width: 0px` / `max-width: none` |
| `.TextField` | `(0,1,0)` | `cursor`, `padding`, background and foreground colour |
| `:where(.ts-ui-component)` | `(0,0,0)` | the framework baseline |

The value rule outranks every class-tier rule on specificity alone, so its position in the stylesheet does not matter — unlike the class tier itself, whose ancestor-before-descendant insertion order is load-bearing.

### `component/input/AbstractInput.ts` — the new helper

Add `import { UNBOUNDED } from "~/primitive/Size.js";` to the import block (lines 3-5), then insert this method immediately before `applyOptions` ([`AbstractInput.ts:233`](packages/lib/src/typescript/lib/component/input/AbstractInput.ts#L233)):

```typescript
/**
 * Points this instance at the shared `.ClassName.h<px>` rule for a
 * single-line box height, so every instance of this concrete class that
 * resolves the same height shares one CSS rule instead of each writing its
 * own `min-height`/`max-height` pair. Call this *before* the matching
 * `setPreferredSize`/`setMaxSize`/`setMinSize` writes: on an
 * already-rendered component those setters flush immediately, and a flush
 * that runs against the previous height's value class writes the new height
 * to this instance's own rule, where it outranks the shared one for good.
 *
 * @param h - The single-line box height in pixels, as
 *   {@link Util.singleLineBoxHeight} computed it.
 *
 * @remarks The widths in the patch are pinned to the framework baseline
 * (`0` / `UNBOUNDED`) rather than read back from this instance, so the
 * shared rule's `min-width`/`max-width` declarations are the same inert
 * pair for every instance. Reading this instance's real widths instead
 * would bake whichever instance minted the rule first into every later
 * instance's comparison, and a field with a different width would then
 * write a width declaration to its own rule that it does not write today.
 */
protected pinSingleLineBoxHeight(h: number): void {
    this.setValueStyleState("h", h + "px", {
        minSize: { width: 0,         height: h },
        maxSize: { width: UNBOUNDED, height: h },
    });
}
```

### `core/Component.ts` — `init`'s deferred-token catch-up

`init` currently builds `activeStateTokens` and passes it to one `addClass` call ([`Component.ts:6921-6924`](packages/lib/src/typescript/lib/core/Component.ts#L6921)). Add the value-class tokens beside it. After the sibling plan lands, each `_valueStyleTokens` entry is `{ token, layer }`, so the token is read off `entry.token`:

```typescript
const activeStateTokens = Array.from(this._activeStates)
    .filter((selector) => selector.startsWith("."))
    .map((selector) => selector.slice(1));
// Re-applies any value-class token recorded before this element existed
// (see `setValueStyleState`, whose own DOM write is gated on
// `getElement()`) — the same first-render catch-up `activeStateTokens`
// above performs for a declared state.
const valueClassTokens = Array.from(this._valueStyleTokens.values(), (entry) => entry.token);
DOM.sink.apply(element, { addClass: [COMPONENT_CLASS, ...getStyleClassChain(this.constructor), ...groupClass, ...activeStateTokens, ...valueClassTokens] });
```

### The three `updateHeight` call sites

Each gains one line directly after its existing `const h = ...` line and before the first size write. Nothing else in any of the three methods changes.

```typescript
// component/input/TextField.ts:78, ComboBox.ts:790, NumberSpinner.ts:281
const h = Util.singleLineBoxHeight(/* each class's own arguments, unchanged */);

this.pinSingleLineBoxHeight(h);      // <- new

const width = this.getPreferredSizeConstraint()?.width ?? /* 200 / 200 / 120 */;
// ... the rest of the method, unchanged
```

---

## Ordered Implementation Steps

1. **Confirm the dependency has landed.** `ls plans/implemented/cell-base-background-value-class-dedup.md` must exist, and `grep -n 'entry.layer' packages/lib/src/typescript/lib/core/Component.ts` must find the `layersBelowInstance` push. If either check fails, stop and report — without the value layer in `layersBelowInstance()`, this plan's shared rules are created but never dedupe anything, reproducing the exact defect that sibling plan fixes.

2. **Write the tests first**, in a new file `packages/lib/tests/component/input/SingleLineHeightValueClassSharing.test.ts`, covering `## Expected Behaviour` rows 1-9. Follow `TextLineHeightValueClassSharing.test.ts`'s conventions: locally-defined `idSelector` / `declarationsIn` helpers, `installTestDOM` in `beforeEach` and `DOM.reset()` in `afterEach`, and `_ruleCacheHas` imported from `~/core/StyleTarget`.
   *Check:* `npx vitest run tests/component/input/SingleLineHeightValueClassSharing.test.ts` from `packages/lib` — every row fails, because no `.TextField.h*` rule exists yet.

3. **`packages/lib/src/typescript/lib/component/input/AbstractInput.ts`** — add the `UNBOUNDED` import and the `pinSingleLineBoxHeight` method, per `## Internal Structure`.
   *Check:* `npm run typecheck`.

4. **`packages/lib/src/typescript/lib/core/Component.ts`** — add `valueClassTokens` to `init`'s `addClass` call, per `## Internal Structure`.
   *Check:* `npm run typecheck`.

5. **`packages/lib/src/typescript/lib/component/input/TextField.ts`** — insert `this.pinSingleLineBoxHeight(h);` into `updateHeight` (line 78-80), between the `h` computation and the `width` read. Do not touch `setBorder`, which computes its own `h` for a different purpose.
   *Check:* `npm run typecheck`.

6. **`packages/lib/src/typescript/lib/component/input/ComboBox.ts`** — same insertion in `updateHeight` (line 790-792).
   *Check:* `npm run typecheck`.

7. **`packages/lib/src/typescript/lib/component/input/NumberSpinner.ts`** — same insertion in `updateHeight` (line 281-283).
   *Check:* `npm run typecheck`.

8. **Re-run step 2's tests** — all rows green.

9. **Run the full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`. Pay particular attention to `tests/component/input/single-line-min-height.test.ts` and `single-line-width-preservation.test.ts`, which pin the size getters this plan must leave untouched, and to `tests/component/input/TextLineHeightValueClassSharing.test.ts`, the other `setValueStyleState` caller.

10. **Add the changelog entry** — see `## Documentation Impact`.

11. **Verify live in a browser** — see `## Verification`. The Style Audit's byte counts cannot be observed offline.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/component/input/SingleLineHeightValueClassSharing.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/AbstractInput.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/TextField.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/ComboBox.ts` |
| Modify | `packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1-9 are unit-testable against the recording DOM sink. Row 10 needs a live browser. Throughout, `h` is whatever `Util.singleLineBoxHeight` resolves under the test DOM's metrics — read it from `input.getPreferredSize()!.height` rather than hard-coding a pixel number, so the tests survive a font-metric fixture change.

| # | Case | Expected |
|---|---|---|
| 1 | A `TextField` is constructed and rendered | Its own `#id` rule carries no real `minHeight` or `maxHeight` declaration (either the key is absent, or its value is `null`); `_ruleCacheHas('.TextField.h<h>px')` is `true`; the element's `addClass` writes include `h<h>px` |
| 2 | Two `TextField`s are constructed and rendered | Exactly one `ensureStyleRule` is recorded for `.TextField.h<h>px` across both; neither instance's own rule carries a real height declaration |
| 3 | A `ComboBox` and a `NumberSpinner` are rendered alongside a `TextField`, all resolving the same `h` | Three distinct selectors exist — `.TextField.h<h>px`, `.ComboBox.h<h>px`, `.NumberSpinner.h<h>px` — and none of the three instances writes a real height declaration to its own rule |
| 4 | The `.TextField.h<h>px` rule's declarations | Exactly `{ minWidth: "0px", minHeight: "<h>px", maxWidth: "none", maxHeight: "<h>px" }` — no border, and no width read back from the minting instance |
| 5 | A rendered `TextField`, then `themeVars['--ts-ui-font-size'] = '20px'` followed by `ThemeManager.setTheme(DarkTheme)` | One `apply` write carries both `removeClass: ['h<old>px']` and `addClass: ['h<new>px']`; `_ruleCacheHas('.TextField.h<new>px')` is `true`; the instance's own rule still carries no real height declaration |
| 6 | A `TextField` constructed but never rendered, then `getElement(true)` | No `apply` write happens before the element exists; the first render's `addClass` includes `h<h>px` (the `Component.init` catch-up) |
| 7 | A rendered `TextField`, then `setMinSize({ width: 50, height: h })` | The instance's own rule carries a real `minWidth: "50px"`; `minHeight` is still deduped away — a width deviation reaches `#id`, a matching height does not |
| 8 | `getPreferredSize()`, `getMinSize()`, `getMaxSize()` on each of `TextField`, `PasswordField`, `UsernameField`, `ComboBox`, `NumberSpinner`, `DateField`, `AutoCompleteField` | Every height is exactly what it is today — this plan changes which CSS rule paints the constraint, never the constraint itself. The existing `single-line-min-height.test.ts` must pass unmodified |
| 9 | The `data-minSize` / `data-maxSize` attributes on a rendered `TextField` | Still written, with the same values as today — `onStyleResolved` fires off the resolved key set, not off whether a real declaration was queued |
| 10 | Manual — visit `#/baseline` and `#/inputs`, then `#/style-audit` → Refresh | The `{ max-height; min-height }` duplicate-body rows for `AbstractInput` / `ComboBox` / `NumberSpinner` are gone from the audit's list; every affected control renders at the same height, with the same border and focus chrome, as before |

Row 5 needs a theme change that actually moves the line box, which `ThemeManager.setTheme(DarkTheme)` alone does not do — `DarkTheme` changes colours, not font size. The test DOM holds the config object passed to `installTestDOM` by reference and reads `--ts-ui-font-size` off `config.themeVars` on every call ([`packages/lib/tests/dom/TestDOM.ts:1051`](packages/lib/tests/dom/TestDOM.ts#L1051)), so the row is driven by keeping a reference to that `themeVars` object, mutating `themeVars['--ts-ui-font-size'] = '20px'`, and then calling `ThemeManager.setTheme(DarkTheme)` to fire the metrics invalidation and the listener sweep.

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
grep -n 'pinSingleLineBoxHeight' packages/lib/src/typescript/lib/component/input/TextField.ts      # exactly one match
grep -n 'pinSingleLineBoxHeight' packages/lib/src/typescript/lib/component/input/ComboBox.ts       # exactly one match
grep -n 'pinSingleLineBoxHeight' packages/lib/src/typescript/lib/component/input/NumberSpinner.ts  # exactly one match
```

In each of the three files, confirm by eye that the `pinSingleLineBoxHeight` line sits **above** the first `setPreferredSize` / `setMaxSize` / `setMinSize` call in that method — the ordering rule from `## Architecture Decisions`, which no automated check covers.

**Manual browser verification (row 10) is required.** Start a dev server on a spare port from *this worktree* and confirm with `readlink /proc/<pid>/cwd` that it resolves here, not the main tree or another worktree. Visit `#/baseline` and `#/inputs` so a `TextField`, `PasswordField`, `UsernameField`, `ComboBox`, `NumberSpinner`, a picker field and an `AutoCompleteField` have all rendered, then open `#/style-audit` and click Refresh. Read the affected elements' computed `min-height` / `max-height` with `getComputedStyle` rather than trusting a screenshot, and confirm each resolves through a `.ClassName.h*` rule rather than the element's own `#id` rule.

---

## Documentation Impact

No exported symbol changes: `pinSingleLineBoxHeight` is `protected`, the `Component.init` edit is internal, and the three `updateHeight` methods are `private` or `protected`. Nothing for `npm run docs:api` to pick up.

One changelog entry in `packages/lib/docs/reference/changelog/next.md`, appended under the existing `## Changed` → `### Components` list:

> **Single-line inputs no longer repeat their `min-height`/`max-height` pair on every instance's own CSS rule.** `TextField`, `ComboBox` and `NumberSpinner` (and every class built on them) now share one rule per concrete class per resolved height, re-derived automatically when a theme change moves the line box. Nothing changes visually or in any size getter; only which CSS rule supplies the declaration. No consumer action is needed.

---

## Potential Challenges

- **The dependency must land first.** Without `cell-base-background-value-class-dedup.md`'s `layersBelowInstance()` change, the shared rules are created and the DOM tokens applied, but every instance still writes its own height declaration to `#id`, which outranks the shared rule at `(1,0,0)` — the change would look inert. Step 1 checks for this explicitly.
- **A future class-tier `minSize`/`maxSize` default in one of these chains would be shadowed.** The value rule's `(0,2,0)` selector outranks any `.ClassName` rule at `(0,1,0)`. No class in the `AbstractInput` → `TextInput` → `TextField` / `ComboBox` / `NumberSpinner` chains declares a size key in its own class-tier defaults today (verified), and row 4 fails loudly if the value rule's declaration set ever grows beyond the four keys it names.
- **Stale rules accumulate across repeated theme changes.** A height the app has visited before keeps its rule in the stylesheet forever, since `ensureClassStateRule` never disposes one. The count is bounded by (distinct heights visited) × (three classes), which is a handful; this matches how the state and line-height tiers already behave.
- **A second value-class prefix on the same component declaring a size key** would collide with `"h"` in `flushStyleBag`'s per-key comparison, where whichever prefix was recorded first wins. No component does this; the sibling plan flags the same hazard for its own `"bg"` prefix.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/Component.ts` | `setValueStyleState` (5751), `getValueStyleToken` (5778), `clearValueStyleState` (5788), `_valueStyleTokens` (607), `layersBelowInstance` (5054), `flushStyleBag` (5395), `writeStyle` (5115, why the ordering rule exists), `init` (6892, the one line this plan edits) |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `ensureClassStateRule` (1045, the per-constructor rule pool), `resolvePartialDeclarations` (353), `FRAMEWORK_DECLARATIONS` (104, the baseline the patch's widths must match) |
| `packages/lib/src/typescript/lib/core/Util.ts` | `singleLineBoxHeight` (238) and `lineHeightPx` (174) — why the height is a runtime value, not a class constant |
| `packages/lib/src/typescript/lib/core/Theme.ts` | `reflowText` (1421) — the metrics invalidation and the synchronous listener sweep that follow a theme change |
| `packages/lib/src/typescript/lib/component/input/AbstractInput.ts` | Where the new helper goes, and the common ancestor of all three call sites |
| `packages/lib/src/typescript/lib/component/input/TextField.ts` | `updateHeight` (77) and `setBorder` (118) — only the first is edited |
| `packages/lib/src/typescript/lib/component/input/ComboBox.ts` | `updateHeight` (789) |
| `packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` | `updateHeight` (278) — note it passes the *inner* field's padding, the evidence behind the no-cross-class-sharing decision |
| `packages/lib/src/typescript/lib/component/input/Text.ts` | `setLineHeight` (1197) and the `render()` token catch-up (1512) — the mechanism's only current caller |
| `plans/cell-base-background-value-class-dedup.md` | The dependency: the value layer in `layersBelowInstance()`, the resting-guard rule, and the `_valueStyleTokens` shape this plan reads |
| `plans/implemented/abstractinput-height-dedup.md` | The precedent plan that fixed the declaration-order half of this bucket and named this residual as future work |
| `plans/implemented/text-lineheight-write-path-and-value-class-sharing.md` | Where the value-class mechanism came from, including its own per-class-scoping decision |
| `packages/lib/tests/component/input/single-line-min-height.test.ts` | The size-getter contract this plan must leave untouched (row 8) |
| `packages/lib/tests/component/input/TextLineHeightValueClassSharing.test.ts` | Test conventions for the new file, and the other `setValueStyleState` caller's coverage |
| `packages/lib/tests/component/input/TextThemeReflow.test.ts` | The offline theme-change idiom row 5 needs |

---

## Non-Goals

- **`PasswordField`, `UsernameField` and `AbstractPickerField`.** Each has its own `updateHeight` with the identical shape ([`PasswordField.ts:87`](packages/lib/src/typescript/lib/component/input/PasswordField.ts#L87), [`UsernameField.ts:87`](packages/lib/src/typescript/lib/component/input/UsernameField.ts#L87), [`AbstractPickerField.ts:276`](packages/lib/src/typescript/lib/component/input/AbstractPickerField.ts#L276)) and would each need the same one-line call. They are held back to keep the first use of a value class for a *layout* constraint down to three call sites; the helper on `AbstractInput` is their common ancestor, so opting them in later is one line each with no further design work.
- **The 4 border longhands the audit sometimes finds bundled with these heights.** A border is a static per-class value, so it belongs on the class tier, not in a value-keyed pool — `abstractinput-height-dedup.md` already hoisted the cases it could, and the rest are separate findings.
- **`preferredSize`.** `setPreferredSize` writes a `data-*` attribute, not a CSS declaration ([`Component.ts:3140`](packages/lib/src/typescript/lib/core/Component.ts#L3140)), so it contributes nothing to this bucket.
- **A cross-class or framework-wide value-rule pool.** Argued and rejected in `## Architecture Decisions`.
- **Any change to `styleLayers()`, `resolveStyleValue`, or the typed getters.** The sibling plan deliberately confines the value tier to `layersBelowInstance()`; this plan inherits that boundary.
- **`Text`'s own `render()` token catch-up.** The `Component.init` catch-up this plan adds makes that override redundant, but adding a class twice is a no-op and removing it is unrelated cleanup.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^one-plan]: The mechanism this finding needs is already three-quarters built. `setValueStyleState` / `ensureClassStateRule` shipped with `text-lineheight-write-path-and-value-class-sharing.md` and were generalised out of `Text` at that time — the `prefix` parameter and the `StyleBag` patch parameter both exist precisely so a second property could reuse them. The one missing piece, making the shared rule a `StyleLayer` that `flushStyleBag` dedupes against, is the whole subject of `cell-base-background-value-class-dedup.md`, already drafted. What is genuinely new here is one protected helper and one line in `Component.init`. Splitting that across two plans would leave a "mechanism" plan whose only content is a token catch-up with no caller to exercise it, and whose central claim — that the audit's largest bucket collapses — could not be checked at all, since the Style Audit only reports on rules real components actually create.

    The multi-property question turned out not to need new machinery either. `setValueStyleState`'s third parameter is already a whole `StyleBag` run through `resolvePartialDeclarations`, so a coordinated set of properties resolved as one unit is supported as-is; the single scalar in the signature (`cssValue`) is only the key seed, and for this case the two properties share one number, so `h + "px"` keys the whole set. A case whose properties carried genuinely independent values would need a composed key seed, and would then have to watch the sanitizer: `cssValue.replace(/[^a-zA-Z0-9]/g, "_")` maps every non-alphanumeric character to `_`, so `"1-2"` and `"1_2"` would collide on one rule. That case does not arise here.

[^normalised-widths]: Both directions were checked against `flushStyleBag`'s per-key comparison. With the widths normalised, a default instance's `minWidth: "0px"` matches the value layer's `"0px"` and queues a removal — the same outcome it gets today from `FRAMEWORK_DECLARATIONS`. An instance with a caller-set min width mismatches and writes for real — again the same outcome as today. So the width half of the comparison is behaviour-neutral in every case, which is what makes the extra two declarations on the shared rule acceptable (about 26 bytes, on a handful of rules).

    With the instance's real widths passed instead, the *first* instance to mint `.TextField.h24px` fixes the rule's width declarations for every later one. If that instance happened to carry a caller-set `min-width: 50px`, every ordinary `TextField` at 24px would then mismatch on `minWidth` and write `min-width: 0px` to its own rule — trading one duplicate-declaration bucket for another, with which bucket you get depending on render order.

    A third option was to widen the core API with a raw-declarations variant of `setValueStyleState`, so the shared rule could carry the two height keys and nothing else. It produces the tidiest rule, but it adds a second public shape to a mechanism that has one caller today, to save two inert declarations.

[^ordering]: The failure mode is the same one `cell-base-background-value-class-dedup.md` documents as its stale-declaration defect: once a real declaration exists on the `(1,0,0)` `#id` rule, nothing on the `(0,2,0)` shared rule can outrank it, and no later value-class swap rewrites it. Here it would be reached on the second and every subsequent theme change, not the first — at construction there is no element, so `writeStyle` defers the flush to the first render, by which point the value class is long since published.

[^init-catchup]: `Text` solves the same problem with a re-apply inside its own `render()` override ([`Text.ts:1512`](packages/lib/src/typescript/lib/component/input/Text.ts#L1512)), which is where the need was first found. Doing that three more times would put the same four lines in `TextField`, `ComboBox` and `NumberSpinner`, and would silently omit any future caller that forgot. `Component.init` already performs exactly this catch-up for style-state tokens, in a single `addClass` call, and every value-class user reaches it — including `Cell`, which sets its base background before render and has no `render()` override of its own. Adding a class token twice (once from `Text.render`, once from `init`) is a no-op on `classList`.

[^cross-class]: Three shapes were considered. A shared-ancestor rule is technically available: `chainParticipates` is true for all three chains, so every one of these elements already carries `AbstractInput` as a DOM class ([`ClassStyleRules.ts:978`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L978)), and `.AbstractInput.h24px` would sit at the same `(0,2,0)` specificity as the per-class form. A framework-wide `.ts-ui-component.h24px` would work the same way. Both would need a new "anchor class" parameter threaded through `setValueStyleState` and `ensureClassStateRule`, whose cache and selector are keyed on one constructor today, and both would break the property that every generated rule names the class that owns it — which is also what the Style Audit reports against.

    The prompt for this design asked whether "same formula" makes cross-class sharing safer here than in the coincidental case. It does make it *safe*: nothing is inherited and nothing is baked, so two classes sharing a value-keyed rule cannot affect each other, and they stop sharing automatically the moment their numbers diverge. But the premise does not hold as stated. `Util.singleLineBoxHeight(insets, padding, border)` is a sum, and the three classes pass different arguments to it — `TextField` and `ComboBox` each pass their own insets, padding and border; `NumberSpinner` passes its own insets and border but its *inner field's* padding. Only `Util.lineHeightPx()`, one addend, is causally shared. The totals agree today because the chrome terms happen to be equal under the one shipped theme, which is the same coincidence any other value-keyed pool rests on.

    The arithmetic settles it either way. The audit's bucket is ~100 per-instance rules; per-class pooling replaces them with one rule per (class, distinct height) — two heights across three classes, so about six rules of roughly 60 bytes each. Cross-class pooling would take six to two, saving a few hundred bytes in exchange for a new class-independent tier.

[^theme-invalidation]: Traced end to end. `ThemeManager.setTheme` and the font-load reflow both route through `reflowText`, which calls `Util.invalidateTextMetricsCache()` and only then walks `themeListeners` ([`Theme.ts:1421-1424`](packages/lib/src/typescript/lib/core/Theme.ts#L1421)), so every `updateHeight` in the sweep reads fresh metrics. Each of the three classes subscribes independently from its own constructor, so a page holding all three has one listener per instance, all in one synchronous batch.

    Nothing in that batch shares mutable state. `ensureClassStateRule`'s cache is a `Map` keyed by `(constructor, suffix)`, and the suffix contains the resolved value, so a `TextField` moving from 24px to 30px looks up a different entry rather than mutating the 24px one. A `ComboBox` still on 24px in the same tick — which cannot happen for a font-size change, but could for a theme that alters only one family's border width — keeps its own rule untouched. Returning to a previously-visited height re-uses the cached entry and its still-present rule; `disposeStyleRule` is only ever called for a component-scoped `#id` rule ([`Component.ts:371`](packages/lib/src/typescript/lib/core/Component.ts#L371)) and by `StyleRule.dispose`, neither of which touches a class-scoped rule.

    The one real ordering constraint is inside a single `updateHeight` body, not between classes — see the ordering decision in `## Architecture Decisions`.
