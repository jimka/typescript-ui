# NumberSpinner SpinButton Chrome Dedup — Implementation Plan

## Overview

A live Style Audit capture found two duplicate-body `#id`-scoped rules, both exactly `18×11px` with matching `min`/`max` width and height, differing only in `border-top` color. Both trace to [`NumberSpinner.ts:124-129`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L124), which constructs `this._upBtn = new SpinButton("▲")` / `this._downBtn = new SpinButton("▼")` and then calls `setBorder({ borderTop: ... })` imperatively on each — a fixed, role-determined value repeated on every `NumberSpinner` instance, with no class-tier home. This is the same shape [`plans/implemented/button-variant-chrome-dedup.md`](implemented/button-variant-chrome-dedup.md) already fixed for window-control buttons, `MenuBarButton`, and `TabCloseButton`: **a per-instance write with no class-tier home for a value that never varies per instance.**

This plan gives `borderTop` a class-tier home via two new subclasses, `SpinButtonUp` and `SpinButtonDown` (both `extends` [`SpinButton`](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L64)), declared in `NumberSpinner.ts` next to the existing [`NumberSpinnerField`](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L78) — the file's own precedent for a module-private, `NumberSpinner`-specific subclass of an imported base component. `NumberSpinner`'s constructor swaps its two `new SpinButton(...)` + `setBorder(...)` call pairs for `new SpinButtonUp()` / `new SpinButtonDown()`.

The `minSize`/`maxSize` half of the duplicate rows (the `18×11px` sizing) is investigated in `## Architecture Decisions` and **left on its current per-instance path**.

---

## Architecture Decisions

### Two dedicated subclasses, not an instance-varying option on one class

`SpinButtonUp` and `SpinButtonDown` each declare their own `ownClassStyleDefaults` carrying only `border`, and a zero-argument constructor that calls `super("▲"|"▼", undefined, _defaultSpinButtonUpOptions|_defaultSpinButtonDownOptions)`. This mirrors [`WindowControlButton`](packages/lib/src/typescript/lib/overlay/windowControls.ts)/`WindowLeadGlyphButton`'s shape in `button-variant-chrome-dedup.md` exactly: a subclass with its own declared class-tier chrome, not an option threaded through one shared class.

A single `SpinButton` class cannot carry an instance-varying `borderTop` through its options bag. `core/ClassStyleRules.ts`'s class-tier registry (`_bags`/`_levels`, [ClassStyleRules.ts:138](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L138), [:445](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L445)) is a `Map` keyed on constructor, populated by whichever instance of that constructor renders first (`ensureClassStyleRule`'s early-return-on-cache-hit at [:896](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L896)) and never invalidated afterward. If `SpinButton` itself picked `borderTop` via a ternary inside its own defaults, the first instance built on a given page load — up or down, non-deterministic — would freeze `.SpinButton`'s shared class rule at its own value forever; the other role would then diverge from that shared rule on every one of its own instances, permanently, for the lifetime of the page. Two distinct constructors sidestep this because each gets its own entry in the same `Map`, keyed on its own (distinct) constructor function.

### `minSize`/`maxSize` stay on the per-instance imperative path — not promoted to the class tier

`SpinButton.updateSize()` ([SpinButton.ts:141-164](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L141)) sets `preferredSize`/`minSize`/`maxSize` to `{ width: 18, height: halfHeight }`, where `halfHeight` is derived from `Util.lineHeightPx()` — a value read from the DOM/theme (cached, invalidated only by an explicit `invalidateTextMetricsCache()` call after a theme change[^linheight-runtime]) — and re-run on every `subscribeTheme` firing. Promoting `minSize`/`maxSize` into `SpinButtonUp`/`SpinButtonDown`'s `ownClassStyleDefaults` would fully close the audit's duplicate rows (`borderTop` alone still leaves matching `min-width`/`min-height`/`max-width`/`max-height` in both instances' own `#id` rules), but this plan does not make that change.

`ClassStyleRules.ts`'s class-tier caches are provably never invalidated on theme change: nothing in the module clears `_bags`/`_levels`/`_resolvedStates`, and `ThemeManager` ([core/Theme.ts](packages/lib/src/typescript/lib/core/Theme.ts)) never imports or calls into `core/ClassStyleRules.ts` at all[^cache-never-cleared]. A class default seeded from `halfHeight` would therefore freeze at whichever theme's line-height was in effect when the first `SpinButtonUp`/`SpinButtonDown` instance ever rendered in the process, for the rest of that page's lifetime. Visual correctness would not break: `Component.flushStyleBag()` ([Component.ts:5284](packages/lib/src/typescript/lib/core/Component.ts#L5284)) compares each instance's own current `_instanceStyle` value against the (possibly stale) class-tier value at every render and writes the instance's real, current value for real whenever the two no longer match[^flush-fallback]. But the dedup benefit — the entire reason for this plan — would silently degrade the first time any theme switch moves `Util.lineHeightPx()`'s result: every `SpinButtonUp`/`SpinButtonDown` instance from that point on falls back to a real, per-instance `#id` write for `minSize`/`maxSize`, indistinguishable from the pre-fix state except by re-running the Style Audit.

No existing `ownClassStyleDefaults` in this codebase is seeded from a runtime-measured value. Every `minSize`/`maxSize` class default found in the codebase is a static literal — `AbstractChart` (`{width: 80, height: 60}`), `TextArea` (`{width: 100, height: 100}`), `AbstractSelectableList`'s `maxSize` (`Number.MAX_SAFE_INTEGER`), `ScrollArrowGlyph`'s `TRACK_WIDTH` (`= 12`, [Scrollbar.ts:38](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L38)) — and every other hoisted chrome value that references a theme token does so via a CSS `var(...)` reference the browser itself re-resolves live on theme change, not a JS-measured pixel number baked into a JS object at whichever moment the class rule first materializes. `SpinButton`'s own `halfHeight` is neither: it is a plain number, computed once in JS from a cacheable-but-invalidatable measurement, with no mechanism in `ClassStyleRules.ts` to re-trigger that computation once cached. Promoting it would be the first class-tier default of its kind in the codebase, with a known, unaddressed staleness gap and no established pattern to follow. `minSize`/`maxSize` therefore stay exactly where they are today — `SpinButton.updateSize()`'s imperative `setMinSize`/`setMaxSize` calls, unchanged by this plan.

---

## Public API

No public API changes. `SpinButtonUp` and `SpinButtonDown` are module-private classes declared in `NumberSpinner.ts` — not exported, not wrapped in `callable()` — matching `NumberSpinnerField`'s existing treatment in the same file.

---

## Internal Structure

### `component/input/NumberSpinner.ts` — two new module-private classes

Add after the existing `NumberSpinnerField` class ([NumberSpinner.ts:78-82](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L78)):

```typescript
/**
 * Resting border for a NumberSpinner's up-arrow SpinButton: a transparent
 * top border reserves the same border-box height a real divider would take,
 * so the up/down pair line up pixel-for-pixel with the down button's real
 * divider below.
 */
const _defaultSpinButtonUpOptions: Partial<SpinButtonOptions> = {
    border: { borderTop: "1px solid transparent" },
};

/**
 * The up-arrow half of a NumberSpinner's spin-button pair. Every instance
 * gets the same transparent top border, so it is a class-tier default rather
 * than a per-instance `setBorder` call — see
 * plans/numberspinner-spinbutton-dedup.md's Architecture Decisions for why
 * this needs its own constructor rather than an instance-varying option on
 * `SpinButton` itself.
 */
class SpinButtonUp extends SpinButton {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultSpinButtonUpOptions;

    constructor() {
        super("▲", undefined, _defaultSpinButtonUpOptions);
    }
}

/**
 * Resting border for a NumberSpinner's down-arrow SpinButton: the visible
 * divider line between the two stacked buttons.
 */
const _defaultSpinButtonDownOptions: Partial<SpinButtonOptions> = {
    border: { borderTop: "1px solid var(--ts-ui-spinner-divider, rgb(180, 180, 180))" },
};

/**
 * The down-arrow half of a NumberSpinner's spin-button pair. Same shape as
 * {@link SpinButtonUp} — see its doc comment.
 */
class SpinButtonDown extends SpinButton {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultSpinButtonDownOptions;

    constructor() {
        super("▼", undefined, _defaultSpinButtonDownOptions);
    }
}
```

Both constructors take no parameters and pass their module-level defaults constant straight to `super()` — the `local/require-subclass-defaults` ESLint rule ([scripts/eslint/require-subclass-defaults.js:181](packages/lib/scripts/eslint/require-subclass-defaults.js#L181)) explicitly exempts a zero-parameter constructor ("a fixed-configuration leaf... has no options bag to widen"), the same shape `PickerInput`'s constructor already uses ([PickerInput.ts:46](packages/lib/src/typescript/lib/component/input/PickerInput.ts#L46)). Neither class needs a `subclassDefaults` passthrough parameter because neither is constructed with per-instance options anywhere in the codebase today, and neither is subclassed.

`ownClassStyleDefaults` on each class carries only `border` — not `borderRadius` or `insets` — because `mergeClassStyleDefaults` ([ClassStyleRules.ts:465](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L465)) merges a subclass's own bag over its parent's, so `SpinButton`'s own `borderRadius: "0"` / `insets` defaults ([SpinButton.ts:49-53](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L49)) keep flowing through unchanged; only `border` is a genuine deviation.

### `component/input/NumberSpinner.ts` — import and call-site changes

Widen the existing `SpinButton` import to also bring in the `SpinButtonOptions` type:

```typescript
import { SpinButton, SpinButtonOptions } from "~/component/input/SpinButton.js";
```

Replace the six-line construction block ([NumberSpinner.ts:124-129](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L124)):

```typescript
this._upBtn   = new SpinButton("▲");
this._downBtn = new SpinButton("▼");
this._upBtn.setBorder({ borderTop: "1px solid transparent" });
this._upBtn.setBorderRadius("0");
this._downBtn.setBorder({ borderTop: "1px solid var(--ts-ui-spinner-divider, rgb(180, 180, 180))" });
this._downBtn.setBorderRadius("0");
```

with:

```typescript
this._upBtn   = new SpinButtonUp();
this._downBtn = new SpinButtonDown();
```

The two `setBorderRadius("0")` calls are deleted along with `setBorder` — they were already fully redundant with `SpinButton`'s own `ownClassStyleDefaults.borderRadius = "0"` before this plan (a same-value no-op re-assertion, unrelated to the border-top duplication this plan fixes) and `SpinButtonUp`/`SpinButtonDown` continue to inherit that same class default unchanged. Do not add a `borderRadius` field to either new class's own defaults bag — it would be a no-op restatement of what the parent already provides.

`this._upBtn`/`this._downBtn`'s declared field type stays `SpinButton` ([NumberSpinner.ts:98-99](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts#L98)) — `SpinButtonUp`/`SpinButtonDown` are assignable to it since both extend it, and nothing downstream needs the narrower type.

---

## Ordered Implementation Steps

1. **`component/input/NumberSpinner.ts`** — widen the `SpinButton` import to include `SpinButtonOptions`; add `_defaultSpinButtonUpOptions`/`SpinButtonUp` and `_defaultSpinButtonDownOptions`/`SpinButtonDown` after `NumberSpinnerField`, per `## Internal Structure`.
   *Check:* `npm run typecheck` from `packages/lib`.
2. **`component/input/NumberSpinner.ts`** — replace the six-line `_upBtn`/`_downBtn` construction block with `new SpinButtonUp()` / `new SpinButtonDown()`, per `## Internal Structure`.
   *Check:* `npm run typecheck`. `grep -n 'setBorder({ borderTop' packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` — zero matches.
3. **New test file `packages/lib/tests/component/input/NumberSpinner.spinButtonClassStyleHoisting.test.ts`.** Cover `## Expected Behaviour` rows 1-4, using the `declarationsDuring`/`_ruleCacheHas` helpers already established in `tests/component/input/SpinButton.test.ts` (copy the local `declarationsDuring` helper — it is file-local there, not exported) and `RecordingDOMSink`/`installTestDOM` from `tests/dom/TestDOM`. Construct two `NumberSpinner`s so the second instance's writes are the ones checked against the (by-then-cached) class rule.
   *Check:* `npx vitest run tests/component/input/NumberSpinner.spinButtonClassStyleHoisting.test.ts` from `packages/lib`.
4. **Add two rows to the default-resolution registry** in [`tests/component/default-options-fallback.test.ts`](packages/lib/tests/component/default-options-fallback.test.ts), next to the existing `NumberSpinner _input textAlign` row (line 276), per `ARCHITECTURE.md`'s *Class-level defaults must survive the getter*:
   ```typescript
   { label: 'NumberSpinner _upBtn border',   resolve: () => (new NumberSpinner() as any)._upBtn.getBorder(),   expected: { borderTop: '1px solid transparent' } },
   { label: 'NumberSpinner _downBtn border', resolve: () => (new NumberSpinner() as any)._downBtn.getBorder(), expected: { borderTop: '1px solid var(--ts-ui-spinner-divider, rgb(180, 180, 180))' } },
   ```
   *Check:* `npx vitest run tests/component/default-options-fallback.test.ts` — green.
5. **Full suite.** `npx vitest run --no-file-parallelism` from `packages/lib` — confirms `tests/component/input/SpinButton.test.ts` and `tests/component/button/Button.pressedHoverClassHoisting.test.ts` (both construct plain `SpinButton` directly, unaffected by this plan) stay green. `npm run lint` and `npm -w packages/lib run test:lint` — the `local/no-raw-dom` and `local/require-subclass-defaults` baselines stay empty.
6. **Add the changelog entry.** See `## Documentation Impact`.
7. **Manual verification.** See `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` |
| Modify | `packages/lib/tests/component/default-options-fallback.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Create | `packages/lib/tests/component/input/NumberSpinner.spinButtonClassStyleHoisting.test.ts` |

---

## Expected Behaviour

Rows 1-4 are unit-testable offline (recording DOM sink, no real browser). Row 5 needs a live browser.

1. A second `NumberSpinner`'s up button, rendered after a first `NumberSpinner` has primed the shared rules, writes no `border`-longhand declarations to its own `#id` rule.
2. `.SpinButtonUp` exists in the rule cache carrying `border-top: 1px solid transparent`, `border-right: none`, `border-bottom: none`, `border-left: none` (the full four-longhand expansion `borderToStyle` always produces for a partial `BorderOptions`, per `ClassStyleRules.ts`'s `resolveDeclarations`/`STYLE_WRITERS` comments).
3. A second `NumberSpinner`'s down button writes no `border`-longhand declarations to its own `#id` rule; `.SpinButtonDown` exists in the rule cache carrying `border-top: 1px solid var(--ts-ui-spinner-divider, rgb(180, 180, 180))`, `border-right: none`, `border-bottom: none`, `border-left: none`.
4. Neither `.SpinButtonUp` nor `.SpinButtonDown` gets its own `.pressed`/`:hover` class rule — both resolve entirely through `Button`'s inherited `.pressed`/`:hover` states, exactly as plain `SpinButton` already does today (`tests/component/button/Button.pressedHoverClassHoisting.test.ts`'s existing `.SpinButton.pressed` assertion is unaffected by this plan and needs no change).

**Manual verification** (`npm run dev`, http://localhost:8015, the NumberSpinner demo panel; Style Audit panel)

5. A `NumberSpinner`'s up and down buttons render identically to before this plan in all three shipped themes (modern, classic, dark): up button's top edge shows no visible border (transparent), down button's top edge shows the themed divider line, both at the same computed height as before. Open the Style Audit panel after visiting enough `NumberSpinner`s to populate it and confirm the two `18×11px` duplicate-body rows this plan's `## Overview` describes no longer appear for `border-top` (the `min`/`max`-size portion of those rows is expected to remain — see `## Non-Goals`).

---

## Verification

Run from `packages/lib` unless noted.

- `npm run typecheck` — after every step.
- `npm test` (`typecheck:test` + `vitest run`) — full suite green.
- `npm run lint` and `npm -w packages/lib run test:lint` — `local/no-raw-dom` and `local/require-subclass-defaults` baselines stay empty.
- `npm run docs:api` — zero warnings (no public API surface changes).
- Grep invariant: `grep -n 'setBorder({ borderTop' packages/lib/src/typescript/lib/component/input/NumberSpinner.ts` — zero matches.
- **Manual browser verification** (`## Expected Behaviour` row 5) in all three shipped themes. Start a dev server from *this worktree* (or wherever this plan is implemented), confirming with `readlink /proc/<pid>/cwd` that it resolves there.

---

## Documentation Impact

No exported symbol added, removed, or changed in signature — `SpinButtonUp`/`SpinButtonDown` are module-private, mirroring `NumberSpinnerField`. `typedoc.json`, the barrels, and `packages/lib/llms.txt` are unaffected.

- `packages/lib/docs/reference/changelog/next.md`, `## Fixed` → `### Components`, appended after the existing `button-variant-chrome-dedup` entry (the one ending "...dedupe onto shared class rules instead of repeating on every instance."): **`NumberSpinner`'s up/down spin buttons now dedupe their border onto shared class rules instead of repeating it on every instance.** No consumer action is needed; nothing renders differently.

---

## Potential Challenges

- **Confirm `.SpinButtonUp`/`.SpinButtonDown`'s full four-longhand rule body before trusting the audit is closed.** `borderToStyle` always emits all four `border-*` longhands, defaulting unset sides to `"none"` (`ClassStyleRules.ts`'s `resolveDeclarations` comment) — a test or manual check that only looks at `border-top` could miss a case where `border-right`/`border-bottom`/`border-left` diverge from the class rule for an unrelated reason. `## Expected Behaviour` rows 2-3 pin all four.
- **The `min`/`max`-size half of the original duplicate rows is expected to remain after this plan** — `## Architecture Decisions` explains why and scopes it out. Don't treat its continued presence in a post-implementation Style Audit re-run as a regression.

---

## Critical Files

| File | Why |
|---|---|
| [component/input/NumberSpinner.ts](packages/lib/src/typescript/lib/component/input/NumberSpinner.ts) | The whole fix lands here; `NumberSpinnerField` (78-82) is the precedent this plan's two new classes mirror exactly |
| [component/input/SpinButton.ts](packages/lib/src/typescript/lib/component/input/SpinButton.ts) | `_defaultSpinButtonOptions`/`ownClassStyleDefaults` (49-71) — the parent class-tier default `SpinButtonUp`/`SpinButtonDown` deviate from; `updateSize()` (141-164) — the `minSize`/`maxSize` mechanism this plan leaves untouched |
| [core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) | `ensureClassStyleRule`/`resolveClassLevel`/`mergeClassStyleDefaults` — the per-constructor cache and hierarchy-merge mechanics both Architecture Decisions rest on |
| [core/Util.ts](packages/lib/src/typescript/lib/core/Util.ts) | `lineHeightPx()` (174-186) — confirms `halfHeight`'s runtime-measured, cache-but-not-auto-invalidated nature |
| [plans/implemented/button-variant-chrome-dedup.md](implemented/button-variant-chrome-dedup.md) | The direct precedent for this plan's whole approach (dedicated subclass per fixed-role chrome variant) — read in full first |
| [scripts/eslint/require-subclass-defaults.js](packages/lib/scripts/eslint/require-subclass-defaults.js) | Confirms the zero-parameter-constructor exemption `SpinButtonUp`/`SpinButtonDown`'s constructors rely on |
| [ARCHITECTURE.md](ARCHITECTURE.md) | *Component CSS tiers and state-rule dedup* and *The class tier is hierarchy-aware* — the specificity/caching rules this plan's design rests on |

---

## Non-Goals

- **Promoting `minSize`/`maxSize` to the class tier.** Investigated and explicitly rejected in `## Architecture Decisions` — the theme-measured `halfHeight` value has no precedent as a class-tier default and no cache-invalidation path in `ClassStyleRules.ts`.
- **Fixing `SpinButton.updateSize()`'s theme-change staleness in general**, or adding theme-change invalidation to `ClassStyleRules.ts`'s class-tier caches. Out of scope for this plan; would be a cross-cutting change affecting every participating class, not just `SpinButton`.
- **Bumping the package version.** Release-time bookkeeping.

---

## Implementation Notes

Step 3's test file (`NumberSpinner.spinButtonClassStyleHoisting.test.ts`)
needed two adjustments beyond what `## Ordered Implementation Steps` /
`## Expected Behaviour` literally describe, both because the actual
hierarchy-aware class-tier mechanism (`ClassStyleRules.ts`'s
`deviationsFrom`, cited in `## Architecture Decisions`) behaves more
precisely than a first read of Expected Behaviour rows 1-3 suggests — the
code matches the plan's design exactly; only the *test's* verification
technique had to account for the mechanism's actual write pattern:

- **`.SpinButtonUp`/`.SpinButtonDown`'s own class rule carries only
  `border-top`, not the full four-longhand body.** `borderRight`/
  `borderBottom`/`borderLeft` resolve to `"none"` at both `.SpinButton`'s
  level and `.SpinButtonUp`/`.SpinButtonDown`'s level, so
  `deviationsFrom` correctly omits them from the subclass's own rule —
  they're supplied by ordinary CSS inheritance from `.SpinButton`'s
  already-published rule instead. The *effective*, fully-resolved
  four-longhand value (`## Expected Behaviour` rows 2/3) is real and
  correct, but only observable by reading `.SpinButton`'s rule and each
  subclass's own rule together, not `.SpinButtonUp`/`.SpinButtonDown`
  alone. The test captures both in one pass to verify this.
- **A second instance's own `#id` rule writes an explicit `null` per
  border longhand, not an omitted key.** `border` is part of `Button`'s
  always-dispatched chrome group (`Component.applyChromeOptions`), so
  every `SpinButtonUp`/`SpinButtonDown` instance calls `setBorder(...)`
  during construction regardless of whether the value matches the class
  default. `Component.flushStyleBag()` (footnote `[^flush-fallback]`)
  therefore queues a `null` per longhand when the instance's declared
  value matches the resolved class-tier value, rather than skipping the
  key outright. This is still "no real declaration" — a no-op removal,
  not a duplicated string — matching `## Expected Behaviour` row 1's
  intent; the test asserts each key is `null` (or absent), not strictly
  absent.

**Manual verification (`## Verification`'s required browser check) was
performed** against a dev server started from this worktree (`npx vite
--port 8017` from `packages/lib`, confirmed via `readlink
/proc/<pid>/cwd`), driven live through `chrome-devtools` MCP tools, covering
`## Expected Behaviour` row 5 across all three shipped themes (modern,
classic, dark) via the `packages/lib` demo app's Misc panel (three
`NumberSpinner` instances):

- In each theme, `getComputedStyle` on `.SpinButtonUp`/`.SpinButtonDown`
  confirmed `border-top: 1px solid rgba(0, 0, 0, 0)` (up, transparent) and
  `border-top: 1px solid <themed divider>` (down) for all three instances —
  modern/classic both resolve the divider to the `rgb(180, 180, 180)`
  fallback (neither theme defines `--ts-ui-spinner-divider`), and dark
  resolves it to that theme's own override, `rgb(80, 80, 80)`.
  `border-right`/`border-bottom`/`border-left` were confirmed `none` in all
  cases.
- The Style Audit panel, re-opened after visiting the Misc panel in all
  three themes, confirmed the fix directly: the pre-existing two
  duplicate-body rows for the spin buttons (`min`/`max` 18×11px *plus*
  `border-top`, one per role) are now a single merged row — `component:
  Button`, body `{ min-width: 18px; min-height: 11px; max-width: 18px;
  max-height: 11px; }`, count 6 (3 spinners × 2 buttons) — with no
  `border-top` in the body. Collapsing from two rows to one (rather than
  just losing `border-top` from each) is a direct consequence of `up` and
  `down`'s `#id` bodies no longer differing at all once `border-top` moved
  to the class tier; the min/max-size portion remains, exactly as
  `## Non-Goals` anticipates.

---

## Notes

[^linheight-runtime]: `Util.lineHeightPx()` ([Util.ts:174](packages/lib/src/typescript/lib/core/Util.ts#L174)) reads the document root font size (`rootFontSizePx()`) plus the theme's `--ts-ui-line-padding` custom property, both cached and explicitly documented as requiring `invalidateTextMetricsCache()` after a theme change to force a re-read ("The padding and root font size are cached; call `invalidateTextMetricsCache` after a theme change to force a re-read"). This is a JS-side cache with an explicit invalidation hook wired to `subscribeTheme` elsewhere in the codebase — a different, narrower cache than `ClassStyleRules.ts`'s own class-tier `Map`s, which have no invalidation hook at all. `SpinButton.updateSize()` re-reads `Util.lineHeightPx()` on every theme change (it is itself a `subscribeTheme` callback), so the *instance*'s own `minSize`/`maxSize` always reflects the current theme; it is only a *class-tier* default seeded from this value that would go stale, since nothing re-triggers `ensureClassStyleRule`'s cached-Map lookup on a theme change.

[^cache-never-cleared]: Verified directly: `grep -rn '_bags.clear\|_levels.clear\|_resolvedStates.clear' packages/lib/src` returns nothing, and `core/Theme.ts` (`ThemeManager`) contains no reference to `ClassStyleRules` at all — `ThemeManager.setTheme` writes CSS custom properties and inline styles onto `document.documentElement`/`document.body` and fires `themeListeners`, with no call into `core/ClassStyleRules.ts`. The class-tier `Map`s (`_bags`, `_levels`, `_resolvedStates`, `_stateLevelLayers`) are populated once per constructor for the lifetime of the process and never touched again.

[^flush-fallback]: `Component.flushStyleBag()` ([Component.ts:5284](packages/lib/src/typescript/lib/core/Component.ts#L5284)) resolves each pending style key by comparing the instance's own declared value (`instanceDeclared`) against the resolved value from `layersBelowInstance()` (the class/group tier); when they match, it queues a `null` (a no-op removal); when they don't, it writes the instance's own value for real (`toWrite = matchesLower ? null : value`, line 5357). This is the general mechanism that would keep a `SpinButtonUp`/`SpinButtonDown` instance rendering correctly even if `minSize`/`maxSize` were promoted to a since-gone-stale class default — it is also exactly why the resulting staleness would be invisible without an audit re-run: every affected instance silently falls back to a real per-instance write, which is visually correct but no longer deduplicated.
