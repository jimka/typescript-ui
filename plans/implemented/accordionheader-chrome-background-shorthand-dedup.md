---
touches-shared:
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
  - packages/lib/src/typescript/lib/core/Component.ts
  - ARCHITECTURE.md
  - packages/lib/docs/reference/changelog/next.md
---

# AccordionHeader Themed-Chrome Dedup via a `background` Style-Bag Key — Implementation Plan

## Overview

A live Style Audit capture flags every `AccordionHeader`'s own `#id` CSS rule as a duplicate body: each header in every accordion repeats the same six declarations. The writes come from one place, [`Accordion.applySectionTheming`](packages/lib/src/typescript/lib/layout/Accordion.ts#L673): `setBackground(THEMED_HEADER_BG)`, `setForegroundColor(THEMED_HEADER_COLOR)`, and `setBorder({ border: "none", borderBottom: THEMED_HEADER_BORDER })`. Themed mode is the default ([`Accordion.ts:184`](packages/lib/src/typescript/lib/layout/Accordion.ts#L184)), so every header pays this.

Two of those three writes could be hoisted onto the shared class-tier rule today. The `background` one cannot, and it is what blocks the hoist being worth doing: `background` is not a member of [`StyleBag`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L40) — the interface lists `backgroundColor` and `backgroundImage` but no shorthand — so [`Component.setBackground`](packages/lib/src/typescript/lib/core/Component.ts#L2388) bypasses the layered style bag entirely and writes straight to the instance rule with `setElementCSSRule("background", value)`. The framework already names this as an open gap: [`writeGuardedCSSRule`](packages/lib/src/typescript/lib/core/Component.ts#L5672)'s own doc comment calls it "the escape hatch for a shorthand no `StyleBag` key covers (e.g. Button's `background`), which therefore has no class tier to compare against and nothing for `flushStyleBag` to resolve."

This plan closes that gap and then uses it. Part one adds `background` to `StyleBag`, routes `Component`'s three `background` accessors through the layered write path, teaches the resting-isolation key set that the shorthand covers the two background longhands, and deletes [`Button`](packages/lib/src/typescript/lib/component/button/Button.ts#L707)'s two now-redundant overrides. Part two moves `AccordionHeader`'s themed chrome onto a class-tier default so all three values are declared once per process instead of once per header.

---

## Architecture Decisions

### `background` becomes a real `StyleBag` key

`StyleBag` gains `background?: string | null`, with a `STYLE_WRITERS` entry and a line in `resolveDeclarations`. The alternative — leaving `StyleBag` alone and painting the token as `backgroundColor` *and* `backgroundImage` at once, the way `FooterRow` and `TableHeader` already do — is rejected because it silently drops any multi-part value of the documented `--ts-ui-accordion-header-bg` token.[^dual-longhand]

`StyleBag` already carries shorthand keys that reach CSS unexpanded: `margin` and `padding` each resolve to a single shorthand declaration ([`ClassStyleRules.ts:302-303`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L302)). `background` follows those two, not `overflow`/`border`, which expand into longhands instead.[^why-not-expand]

### `background` is an alternative to the two background longhands, never a co-declaration

One bag — a class's `ownClassStyleDefaults`, a state's `extract()` result, or an instance's own writes — declares *either* `background` *or* `backgroundColor`/`backgroundImage`, never both. `StyleBag`'s doc comment states this; `resolveDeclarations` emits `background` ahead of the two longhands so the class tier stays well-defined even if some future class breaks the rule.[^no-intra-bag-ordering]

### `restingIsolationKeys()` treats `background` as covering both background longhands

[`restingIsolationKeys()`](packages/lib/src/typescript/lib/core/Component.ts#L5572) adds `"background"` to its returned set whenever that set already contains `"backgroundColor"` or `"backgroundImage"`. With that, `Button`'s two `setBackground`/`clearBackground` overrides become exactly what the base class now does, and both are deleted.[^button-override]

The rule, for the three shapes that exist after this change:

| Class | Keys its declared states resolve | `restingIsolationKeys()` | Where `setBackground("red")` lands |
|---|---|---|---|
| `Button` (`.pressed`, `:hover` declare `backgroundColor`) | `color`, `backgroundColor`, `backgroundImage`, `boxShadow` | those four **plus** `background` | `#id:not(.pressed):not(:hover)` |
| `AccordionHeader` (declares no states) | — | empty | `#id` |
| A class whose only state declares `outline` | `outline` | `outline` (no `background` added) | `#id` |

### `clearBackground()` and `clearForegroundColor()` assert a reset when a lower tier declares the property

Both gain the guard [`clearBackgroundColor`](packages/lib/src/typescript/lib/core/Component.ts#L2355) and [`clearBackgroundImage`](packages/lib/src/typescript/lib/core/Component.ts#L2438) already carry: after writing the getter-facing `null` through the layer, assert the CSS reset directly when `_defaultOptions` declares the property, because a bare removal would hand it back to the class rule. `clearBackground` asserts `background: transparent`; `clearForegroundColor` asserts `color: inherit`. Both route through `writeGuardedCSSRule`, not `setElementCSSRule`.[^guarded-not-raw]

Without the `clearForegroundColor` half, turning themed mode off would leave the header painting the class tier's `color` — the hoist would introduce a bug rather than just moving a declaration.

### `AccordionHeader`'s themed chrome is a class-tier default, not a declared style state

The three themed values go on `protected static readonly ownClassStyleDefaults`, mirroring [`FooterRow`](packages/lib/src/typescript/lib/component/table/Footer.ts) and [`TableHeader`](packages/lib/src/typescript/lib/component/table/Header.ts). Declaring them as an `ownStyleStates` `.themed` entry instead was considered and rejected: it would switch on resting-chrome isolation for the class and silently swallow a consumer's own chrome writes on a themed header.[^why-not-state]

`applySectionTheming` keeps all three setter calls unchanged. The class tier only enables dedup; it does not replace the write — the same rule `class-tier-default-hoists-batch.md` established.

### One constant feeds both `ownClassStyleDefaults` and `_defaultOptions`, and the constructor gains a `subclassDefaults` parameter

`AccordionHeader` declares `_defaultAccordionHeaderOptions` once and passes it to both the static field and `super()`'s second argument, mirroring `Cell` and `PickerInput`. `_defaultOptions` has to carry `background` for `clearBackground`'s guard to fire, and passing a bare `_default<Name>Options` constant to `super()` from a constructor that takes parameters trips the `local/require-subclass-defaults` ESLint rule — so the constructor also takes an optional third `subclassDefaults` parameter and spreads it, exactly as the file's own `AccordionHeaderTitleButton` does at [`AccordionHeader.ts:102-107`](packages/lib/src/typescript/lib/component/container/AccordionHeader.ts#L102).

`AccordionHeader` is the first class in its chain to declare `ownClassStyleDefaults`, which switches its class rule from the flat `_defaultOptions` path to the hierarchy-aware walk. That walk stops consulting `_defaultOptions`, so any hoistable field living only there would be lost — the regression [`class-tier-default-hoists-batch.md`](plans/implemented/class-tier-default-hoists-batch.md) records for `ToolBar`. Checked and confirmed safe here: `AccordionHeader` passes no `subclassDefaults` today, so its `_defaultOptions` is exactly `BASE_DEFAULTS` ([`core/ComponentDefaults.ts:16`](packages/lib/src/typescript/lib/core/ComponentDefaults.ts#L16)), every hoistable member of which the hierarchy walk's own base case already reproduces.[^base-defaults-roundtrip]

---

## Public API

No signature changes. Three `Component` methods change what they resolve against:

```typescript
// core/Component.ts
getBackground(): string | null;      // now resolveStyleValue("background") — folds the group and class tiers
setBackground(value: string): this;  // now writeStyle({ background: value }) — deduped at flush
clearBackground(): this;             // now asserts `background: transparent` when _defaultOptions declares one
clearForegroundColor(): this;        // now asserts `color: inherit` when _defaultOptions declares one
```

```typescript
// component/button/Button.ts — both overrides deleted; Button inherits Component's
// (setBackground / clearBackground)
```

```typescript
// component/container/AccordionHeader.ts
class AccordionHeader extends Component<AccordionHeaderOptions> {
    protected static readonly ownClassStyleDefaults: StyleBag;

    constructor(
        label:             string,
        options?:          AccordionHeaderOptions,
        subclassDefaults?: Partial<AccordionHeaderOptions>,   // new, optional, additive
    );
}

// Module-level, moved here from layout/Accordion.ts. Exported for Accordion's own
// use; deliberately NOT added to component/container/index.ts, so they stay out of
// the generated API docs.
export const THEMED_HEADER_BG:     string;
export const THEMED_HEADER_BORDER: string;
export const THEMED_HEADER_COLOR:  string;
```

```typescript
// core/ClassStyleRules.ts — internal module, not exported from core/index.ts
export interface StyleBag {
    // …
    /** CSS `background` shorthand. An alternative to `backgroundColor` /
     *  `backgroundImage`: one bag declares the shorthand or the longhands,
     *  never both. */
    background?: string | null;
    // …
}
```

---

## Internal Structure

### `core/ClassStyleRules.ts`

`StyleBag` gains `background` next to `backgroundColor` ([line 53](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L53)). `STYLE_WRITERS` gains the matching entry — required, not optional: the table is typed `{ [K in keyof StyleBag]-?: … }`, so a missing entry fails `npm run typecheck`.

```typescript
// STYLE_WRITERS, beside the two background longhands (line 292)
background:      (v) => ({ background: v ?? null }),
```

```typescript
// resolveDeclarations, replacing lines 234-235. `background` is emitted first:
// the shorthand resets both longhands it covers, so a bag that declared both
// (none does — see StyleBag's own comment) would want the longhands as the
// refinement, not wiped by declaration order.
if (defaults.background)      declarations.background      = defaults.background;
if (defaults.backgroundColor) declarations.backgroundColor = defaults.backgroundColor;
if (defaults.backgroundImage) declarations.backgroundImage = defaults.backgroundImage;
```

Nothing else in this file changes. `background` belongs in neither `SKIP_ON_MATCH_KEYS` nor `FRAMEWORK_BASELINE_KEYS` ([`Component.ts:385`](packages/lib/src/typescript/lib/core/Component.ts#L385), [`:406`](packages/lib/src/typescript/lib/core/Component.ts#L406)): like `backgroundColor` and `shadow`, it appears in a class's resolved bag only when that class explicitly declares one, which is exactly the condition those two sets exclude.

### `core/Component.ts` — the three background accessors

```typescript
getBackground(): string | null {
    return this.resolveStyleValue("background");
}

setBackground(value: string): this {
    if (this._instanceStyle.background === value) {
        return this;
    }

    this.writeStyle({ background: value });

    return this;
}

clearBackground(): this {
    // Same reasoning as `clearBackgroundColor`: the layer write is what makes
    // `getBackground()` report the clear, but a bare CSS removal would hand
    // the property straight back to the class rule when the class defaults it.
    // Routed through the resting-isolation-aware escape hatch so an isolated
    // Button-family instance gets the assertion on its guarded rule.
    this.writeStyle({ background: null });

    if (this._defaultOptions.background) {
        this.writeGuardedCSSRule("background", "transparent");
    }

    return this;
}
```

`this._options.background` is no longer read or written by any of the three — the instance layer is the cache now, per [ARCHITECTURE.md](ARCHITECTURE.md)'s *Always cache in memory* rule. `ComponentOptions.background` and its `applyOptions` dispatch ([`Component.ts:760`](packages/lib/src/typescript/lib/core/Component.ts#L760)) stay exactly as they are.

### `core/Component.ts` — `clearForegroundColor` and `restingIsolationKeys`

```typescript
clearForegroundColor(): this {
    this.writeStyle({ foregroundColor: null });

    if (this._defaultOptions.foregroundColor) {
        this.writeGuardedCSSRule("color", "inherit");
    }

    return this;
}
```

```typescript
protected restingIsolationKeys(): ReadonlySet<string> {
    const keys = new Set<string>();

    for (const state of resolveStyleStates(this.constructor)) {
        for (const key of Object.keys(state.layer.resolved)) {
            keys.add(key);
        }
    }

    // `background` is a shorthand covering both background longhands, so a
    // bare `#id { background: … }` would outrank a state rule declaring
    // either of them. Isolate it whenever a declared state touches one.
    if (keys.has("backgroundColor") || keys.has("backgroundImage")) {
        keys.add("background");
    }

    return keys;
}
```

### `component/container/AccordionHeader.ts`

The three header constants move here verbatim from `Accordion.ts` (lines 62-72, comment block included), and the class gains its own defaults bag:

```typescript
const _defaultAccordionHeaderOptions: Partial<AccordionHeaderOptions> = {
    background:      THEMED_HEADER_BG,
    foregroundColor: THEMED_HEADER_COLOR,
    border:          { border: "none", borderBottom: THEMED_HEADER_BORDER },
};

class AccordionHeader extends Component<AccordionHeaderOptions> {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. Mirrors what the owning
    // Accordion's applySectionTheming writes imperatively on every themed
    // header; a non-themed accordion clears all three per instance.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultAccordionHeaderOptions;

    // … existing fields unchanged …

    constructor(
        label:             string,
        options?:          AccordionHeaderOptions,
        subclassDefaults?: Partial<AccordionHeaderOptions>,
    ) {
        super(
            { tag: "div", ...options },
            { ..._defaultAccordionHeaderOptions, ...(subclassDefaults ?? {}) },
        );
        // … body unchanged …
```

The resulting `.AccordionHeader` rule carries exactly six declarations: `background`, `color`, and the four border longhands `borderToStyle` always expands to (`borderTop`/`borderRight`/`borderLeft` = `none`, `borderBottom` = `THEMED_HEADER_BORDER`).

`border` is the one field of the three that `applyChromeOptions` auto-dispatches from `_defaultOptions` ([`Component.ts:835`](packages/lib/src/typescript/lib/core/Component.ts#L835)), so a header now calls `setBorder` once during `super()` with the same value `applySectionTheming` writes later. Both writes dedupe against the identical class-tier value; the earlier one additionally makes `getBorder()` correct from construction. `background` and `foregroundColor` are dispatched from caller options only, so neither fires from the defaults bag.

### `layout/Accordion.ts`

The three `THEMED_HEADER_*` constants are deleted and imported from `~/component/container/AccordionHeader.js` instead (`THEMED_BORDER`, the container's own all-around border, stays local). `applySectionTheming`'s body is unchanged — both branches keep every setter and clear call exactly as they are.

---

## Ordered Implementation Steps

1. **Write the mechanism tests first.** Create `packages/lib/tests/core/BackgroundStyleBag.test.ts` covering `## Expected Behaviour` rows 1-6, using locally-declared, uniquely-named `Component` subclasses (the convention in `tests/core/ClassStyleRules.test.ts`). Copy `installTestDOM` / `declarationsDuring` / `idSelector` from `tests/component/table/Table.classStyleDefaults.test.ts`.
   *Check:* `npx vitest run tests/core/BackgroundStyleBag.test.ts` from `packages/lib` — every case fails, and row 1 fails because `background` is not a `StyleBag` key.

2. **`core/ClassStyleRules.ts`** — add `background` to `StyleBag` (with the doc comment from `## Public API`), add the `STYLE_WRITERS` entry, and add the `resolveDeclarations` line ahead of the two longhand lines. Per `## Internal Structure`.
   *Check:* `npm run typecheck`.

3. **`core/Component.ts`** — rewrite `getBackground` / `setBackground` / `clearBackground` per `## Internal Structure`.
   *Check:* `npm run typecheck`; `npx vitest run tests/core/BackgroundStyleBag.test.ts` — rows 1-5 green, row 6 (isolation) still red.

4. **`core/Component.ts`** — add the `background` shadowing branch to `restingIsolationKeys()`.
   *Check:* `npx vitest run tests/core/BackgroundStyleBag.test.ts tests/component/button/Button.restingChromeIsolation.test.ts` — all green, `Button.restingChromeIsolation.test.ts` unmodified (its row 6 already pins `setBackground`'s isolation behaviour).

5. **`component/button/Button.ts`** — delete the `setBackground` and `clearBackground` overrides and the JSDoc block above them (lines 700-723).
   *Check:* `npm run typecheck`; `grep -n 'setBackground\|clearBackground' packages/lib/src/typescript/lib/component/button/Button.ts` — zero matches; `npx vitest run tests/component/button/` — green.

6. **`core/Component.ts`** — add the `_defaultOptions.foregroundColor` assertion to `clearForegroundColor`.
   *Check:* `npm run typecheck`; `npx vitest run tests/component/input/Link.test.ts` — green unmodified (its assertion reads the getter, which is unaffected).

7. **`component/container/AccordionHeader.ts`** — move the three `THEMED_HEADER_*` constants in from `Accordion.ts`, add `_defaultAccordionHeaderOptions`, add the `ownClassStyleDefaults` field as the class body's first member, and add the `subclassDefaults` constructor parameter. Per `## Internal Structure`.
   *Check:* `npm run typecheck`; `npm run lint` — `local/require-subclass-defaults` must not fire.

8. **`layout/Accordion.ts`** — delete the three `THEMED_HEADER_*` constants and import them from `~/component/container/AccordionHeader.js`. Leave `applySectionTheming` and `THEMED_BORDER` untouched.
   *Check:* `npm run typecheck`; `grep -n 'const THEMED_HEADER' packages/lib/src/typescript/lib/layout/Accordion.ts` — zero matches.

9. **New file `packages/lib/tests/component/container/AccordionHeader.themedChromeDedup.test.ts`** covering `## Expected Behaviour` rows 7-10. Construct headers through a real `Accordion` (`new Component({ layoutManager: new Accordion() })` plus sections) so `applySectionTheming` runs, matching `tests/component/layout/Accordion.manager.test.ts`'s construction pattern.
   *Check:* `npx vitest run tests/component/container/AccordionHeader.themedChromeDedup.test.ts` — green.

10. **Full suite.** `npx vitest run --no-file-parallelism` from `packages/lib`. A pre-existing test asserting a real `background`/`color` declaration on an `AccordionHeader`'s or a `Button`'s own `#id` rule needs the `.toBeNull()` / `.toBeUndefined()` migration `class-tier-default-hoists-batch.md`'s Implementation Notes describes.

11. **`ARCHITECTURE.md`** — extend the layering-property list at line 154 and the *Component CSS tiers and state-rule dedup* section per `## Documentation Impact`.

12. **Changelog entry** in `packages/lib/docs/reference/changelog/next.md`. Per `## Documentation Impact`.
    *Check:* `npm run docs:api` — zero warnings.

13. **Verify live in a browser.** See `## Verification`. Non-negotiable: the offline harness records writes, it does not run a cascade, and this change moves a gradient-or-flat-colour token between tiers.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/AccordionHeader.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Create | `packages/lib/tests/core/BackgroundStyleBag.test.ts` |
| Create | `packages/lib/tests/component/container/AccordionHeader.themedChromeDedup.test.ts` |

---

## Expected Behaviour

Rows 1-10 are unit-testable with the existing `installTestDOM` / `RecordingDOMSink` harness. Rows 11-12 need a browser.

| # | Case | Expected |
|---|---|---|
| 1 | A locally-declared class whose `ownClassStyleDefaults` is `{ background: "red" }`; two instances rendered | `.ClassName` carries `background: red`; the second instance's own `#id` rule carries no `background` declaration |
| 2 | An instance of that class calls `setBackground("blue")` after render | Its `#id` rule carries `background: blue` (a real deviation, not a removal) |
| 3 | `getBackground()` on an un-customised instance of that class | Returns `"red"` — the class-tier value (before this plan it returned `null`) |
| 4 | `clearBackground()` on an instance of that class, whose `_defaultOptions.background` is also `"red"` | Its `#id` rule carries `background: transparent`; `getBackground()` returns `null` |
| 5 | `clearBackground()` on a plain `Component` (no class default anywhere) | The only queued declaration is the `background` removal; no `transparent` assertion is written |
| 6 | A rendered, chromeful `Button` calls `setBackground("red")` | Lands on `#id:not(.pressed):not(:hover)`, never the bare `#id` rule — identical to today (`Button.restingChromeIsolation.test.ts` row 6, unmodified) |
| 7 | `clearForegroundColor()` on a class whose `_defaultOptions.foregroundColor` is set | Writes `color: inherit`; `getForegroundColor()` returns `null` |
| 8 | `clearForegroundColor()` on a class with no such default | Writes only the `color` removal; no `inherit` assertion |
| 9 | Two headers of a themed (default) `Accordion`, rendered | `.AccordionHeader` carries `background`, `color`, and the four border longhands; neither header's own `#id` rule carries a real value for any of the six |
| 10 | A header of an `Accordion` constructed with `themed: false` | Its `#id` rule carries `background: transparent`, `color: inherit`, and `border{Top,Right,Bottom,Left}: none`; `getBackground()` and `getForegroundColor()` both return `null` |
| 11 | Docs app `#/layouts/Accordion` under Classic, Modern, and Dark themes | Header background is pixel-identical to before: the gradient paints under Classic/Dark, the flat colour under Modern; the bottom divider and text colour are unchanged |
| 12 | `#/components/StyleAuditOverlay` after visiting the accordion page | No ranked duplicate-body row names `AccordionHeader` |

Row 9's `.AccordionHeader` rule content, exactly:

| Declaration | Value |
|---|---|
| `background` | `var(--ts-ui-accordion-header-bg, rgb(243,244,246))` |
| `color` | `var(--ts-ui-accordion-header-color, inherit)` |
| `borderTop` / `borderRight` / `borderLeft` | `none` |
| `borderBottom` | `var(--ts-ui-accordion-header-border, 1px solid rgb(214,217,222))` |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants:

- `grep -n 'const THEMED_HEADER' packages/lib/src/typescript/lib/layout/Accordion.ts` — zero matches.
- `grep -n 'setBackground\|clearBackground' packages/lib/src/typescript/lib/component/button/Button.ts` — zero matches.
- `grep -n '_options.background' packages/lib/src/typescript/lib/core/Component.ts` — one match only, the `applyOptions` dispatch at line 760.

**Manual browser verification (rows 11-12) is required.** Start a docs dev server from *this worktree* on a spare port (`npm run docs:dev`), not the user's existing one. Exercise `/layouts/Accordion` and `/components/AccordionPanel` under all three themes, reading **computed styles** rather than screenshots, then `/components/StyleAuditOverlay`.

---

## Documentation Impact

No exported symbol is added, removed, or renamed: `ownClassStyleDefaults` is `protected`, `StyleBag` lives in a module that `core/index.ts` does not re-export, the three `THEMED_HEADER_*` constants are deliberately kept out of `component/container/index.ts`, and `AccordionHeader`'s new third constructor parameter is optional and additive.

- **`ARCHITECTURE.md` line 154** — add `background` to the parenthesised list of layering properties cached in `_instanceStyle`.
- **`ARCHITECTURE.md`, *Component CSS tiers and state-rule dedup*** — one sentence after the `restingIsolationKeys` description: the `background` shorthand joins the isolation set whenever a declared state touches either background longhand, since a bare `#id` shorthand would otherwise outrank that state's rule.
- **`packages/lib/docs/reference/changelog/next.md`, `## Changed` → `### Core`** — the `background` shorthand now participates in the layered style bag: `getBackground()` folds the class and group tiers instead of reporting only what this instance set, `setBackground()` dedupes against a class-level default, and `clearBackground()` asserts `background: transparent` when the class declares one. A consumer that called `getBackground()` on an instance of a class with a class-level `background` and relied on the `null` return is affected.
- **`next.md`, `## Fixed`** — `clearForegroundColor()` now clears the colour instead of handing it back to the class rule on a class that defaults `foregroundColor`.
- **`next.md`, `## Changed` → `### Components`** — every `AccordionHeader` in a themed accordion shares one CSS rule for its background, text colour, and border instead of repeating them per instance. Nothing changes visually; no consumer action needed.

---

## Potential Challenges

- **A pre-existing test asserts a real `background` or `color` declaration on an `AccordionHeader`'s own `#id` rule.** Step 10's full-suite sweep catches it; the fix shape is the `.toBeNull()` / `.toBeUndefined()` migration `class-tier-default-hoists-batch.md`'s Implementation Notes document.
- **A single bag declaring both `background` and a background longhand.** No site does today, and `StyleBag`'s doc comment forbids it, but nothing enforces it — the instance tier's flush drains a key *set*, so it cannot guarantee shorthand-before-longhand order the way `resolveDeclarations` does.
- **`clearForegroundColor`'s new assertion changes behaviour for every class with a `_defaultOptions.foregroundColor`** — `Link`, `Button`, `TextField`, `ComboBox`, `StatusBar` and others. Nothing in the library calls it on any of them (`grep` confirms only `Accordion.ts` and one `Link` test), and the new behaviour is what the method's own doc comment already promises, so the risk is confined to consumer code that was relying on the broken form.
- **`borderSideWidth` returns `0` for a `var(...)` value**, so a themed header's pre-render `getBorderSize().bottom` estimate is `0`. Unchanged by this plan — the same `var()` value reached the same parser before — so no assertion should be written against it.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `StyleBag` (40), `resolveDeclarations` (204), `STYLE_WRITERS` (276), `resolvePartialDeclarations` (353), `resolveClassLevel` (526), `chainParticipates` (495), `ensureClassStyleRule` (906) |
| `packages/lib/src/typescript/lib/core/Component.ts` | `SKIP_ON_MATCH_KEYS` (385), `FRAMEWORK_BASELINE_KEYS` (406), `clearBackgroundColor` (2355) and `clearBackgroundImage` (2438) — the two guards this plan copies, the three background accessors (2376-2409), `clearForegroundColor` (2504), `writeStyle` (5068), `flushStyleBag` (5348), `restingIsolationKeys` (5572), `writeGuardedCSSRule` (5672) |
| `packages/lib/src/typescript/lib/component/button/Button.ts` | The two overrides being deleted (707, 718) and their JSDoc, which states the exact gap this plan closes |
| `packages/lib/src/typescript/lib/component/table/Footer.ts`, `.../table/Header.ts` | The shipped `ownClassStyleDefaults` + `subclassDefaults` shape `AccordionHeader` mirrors, including why both tiers read one constant |
| `packages/lib/src/typescript/lib/core/ComponentDefaults.ts` | `BASE_DEFAULTS` (16) — the bag whose round-trip through the hierarchy walk makes `AccordionHeader`'s first `ownClassStyleDefaults` declaration safe |
| `plans/implemented/class-tier-default-hoists-batch.md` | Its Implementation Notes record both traps this plan navigates: the lost-`_defaultOptions` regression and the broken-`clearX` regression |
| `plans/implemented/class-hierarchy-cascade.md` | The `ownClassStyleDefaults` / `resolveClassLevel` mechanism `AccordionHeader` registers into |
| `packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts` | Row 6 already pins `setBackground`'s isolation behaviour and must stay green unmodified — the regression anchor for deleting `Button`'s overrides |
| `packages/lib/scripts/eslint/require-subclass-defaults.js` | Why `AccordionHeader`'s constructor needs a third parameter |

---

## Non-Goals

- **Adding `background` to `resolveInstanceStyleDeclarations`** ([`Component.ts:316`](packages/lib/src/typescript/lib/core/Component.ts#L316), the `styleGroup` sharing bag). That bag is already a fixed subset that omits `backgroundImage`, `borderRadius`, and `padding`; widening it is a separate decision about style-group scope.
- **Switching `clearBackgroundColor` from `setElementCSSRule` to `writeGuardedCSSRule`.** It is inconsistent with its `clearBackgroundImage` sibling, but changing it affects every Button-family instance and is unrelated to this plan's finding.
- **Any other Style Audit duplicate.** Out of scope for this round.
- **`AccordionIndicator`'s chrome.** The chevron paints from its own token and was not part of the audit finding.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^dual-longhand]: `FooterRow` and `TableHeader` both paint one theme token as `backgroundColor` *and* `backgroundImage` at once (`FOOTER_BG` / `TABLE_HEADER_BG`), relying on the browser dropping whichever declaration the value is invalid for — a flat colour is invalid as a `background-image`, a gradient is invalid as a `background-color`. That would work for the three themes shipped today (`ClassicTheme` and `DarkTheme` set `accordion.header.background` to a `linear-gradient(...)`, `ModernTheme` to `rgb(243, 244, 246)`), and it needs no `StyleBag` change at all. It is rejected on two counts. First, `--ts-ui-accordion-header-bg` is documented as "Header background" in `packages/lib/docs/layouts/Accordion.md` with the full shorthand contract; a consumer theme setting a genuine multi-part value (`#fff url(x.png)`) would have *both* longhands dropped and paint nothing, where the shorthand paints correctly. Second, it leaves `setBackground` permanently outside the layered style bag, so the next component to use the shorthand reproduces this same audit finding. `Accordion.ts`'s own comment at line 688 already records why the shorthand was chosen over `background-color` here.

[^why-not-expand]: `overflow` and `border` are the two `StyleBag` shorthands that never reach CSS as shorthands: `STYLE_WRITERS.overflow` expands to `overflowX`/`overflowY`, and `border` expands through `borderToStyle` to all four side longhands. Expanding is possible for those because the mapping is total and value-independent. `background` cannot be expanded without parsing the value — a flat colour must become `background-color` and a gradient must become `background-image`, and a CSS custom property's value is not knowable at write time. `margin` and `padding` are the precedent it follows instead: both are `StyleBag` keys that resolve to a single shorthand declaration.

[^no-intra-bag-ordering]: Declaration order inside one rule decides the winner when a shorthand and one of its longhands are both present, and the two resolvers differ in how much order they can promise. `resolveDeclarations` builds one object per class in a fixed statement order, so placing the `background` line first is a real guarantee. `flushStyleBag` drains a `Set` of pending CSS keys whose iteration order follows whichever write touched each key first, so it can make no such promise for the instance tier. Rather than add ordering machinery for a case no code exercises, the constraint is stated where a future author would read it — on the `StyleBag` field itself.

[^button-override]: `Button.setBackground`/`clearBackground` exist only to route the shorthand through `writeGuardedCSSRule` instead of the bare `#id` rule, because `.Button.pressed` and `.Button:hover:not(.pressed)` both declare `backgroundColor` and a bare `#id { background: … }` — specificity `(1,0,0)` — would outrank them permanently. Once `restingIsolationKeys()` reports `background` for exactly the classes that condition describes, `flushStyleBag` routes the write to `restingStyleRule` on its own and the overrides do nothing the base class does not. Keeping them would be worse than redundant: they write `this._options.background` and never touch `_instanceStyle`, so a `Button`'s `getBackground()` would report `null` after a successful `setBackground`.

[^guarded-not-raw]: `clearBackgroundColor` asserts through the raw `setElementCSSRule`; `clearBackgroundImage` asserts through `writeGuardedCSSRule`, with its own comment explaining the difference — "so an isolated Button-family instance gets the assertion on its guarded rule, not the bare `#id` rule." The guarded form is the corrected one, and both new assertions are for properties (`background`, `color`) that a `Button`'s declared states genuinely carry, so both follow `clearBackgroundImage`. For a component with no declared states — `AccordionHeader` included — `writeGuardedCSSRule` falls straight through to `setElementCSSRule`, so the two forms are identical there.

[^why-not-state]: Declaring the themed chrome as an `ownStyleStates` entry (`{ selector: ".themed", extract: … }`) is attractive: an un-themed header would carry no token and therefore no declarations at all, with no `clearX` assertions needed on either side. It is rejected because declaring any state makes `restingGuardSuffix(AccordionHeader)` non-empty, which makes `isRestingChromeIsolated()` true for every header, which sends every subsequent instance write of an isolation key — `background`, `color`, and the four border longhands, i.e. the entire state bag — onto a `#id:not(.themed)` rule. That selector never matches a themed header, and themed is the default, so a consumer calling `header.setBorder(...)` on a stock accordion would silently see nothing happen. Resting-chrome isolation is built for transient states like `.pressed` and `:hover`, where the guarded rule is the one that applies almost all the time; a semi-permanent mode inverts that assumption.

[^base-defaults-roundtrip]: `resolveClassLevel`'s base case seeds `FRAMEWORK_DEFAULTS` (`{ minSize: {0,0}, overflow: "hidden" }`), and `resolveDeclarations`'s own absent-key fallbacks supply the rest. Compared field by field against `BASE_DEFAULTS`, the bag `AccordionHeader`'s `_defaultOptions` holds today: `cursor: "default"` matches the fallback, `userSelect: "none"` matches, `minSize {0,0}` and `overflow: "hidden"` are the two `FRAMEWORK_DEFAULTS` restates, `maxSize: UNBOUNDED` resolves to `maxWidth`/`maxHeight: "none"` exactly as the absent-key fallback does, and `displayed: true` resolves to `display: "block"` either way. `insets` and `zIndex` are not `StyleBag` keys and `resolveDeclarations` never reads them. So the switch from the flat path to the hierarchy walk drops nothing — the failure mode `ToolBar` hit, where a `subclassDefaults`-supplied `backgroundColor` and `overflow` vanished from the class rule, has no counterpart here.

## Implementation Notes

Footnote [^guarded-not-raw] is factually wrong, and the code it justified had to change after an independent audit caught the resulting regression.

**What the footnote claimed:** "For a component with no declared states — `AccordionHeader` included — `writeGuardedCSSRule` falls straight through to `setElementCSSRule`, so the two forms are identical there." On that premise, `clearBackground()`/`clearForegroundColor()` were written to always call `writeGuardedCSSRule`, on the assumption it was a no-op distinction for `AccordionHeader`.

**What's actually true:** every `Component` — `AccordionHeader` included — inherits the root class's own `.invisible` declared state (`plans/implemented/component-setvisible-state-tier-dedup.md`), so `isRestingChromeIsolated()` is `true` for it, and `writeGuardedCSSRule` unconditionally asserts onto the guarded `#id:not(.invisible)` rule whenever an instance is isolated — it does not check whether the specific key being written is one of the instance's own `restingIsolationKeys()` (confirmed by reading its implementation directly, not assumed). Neither `background` nor `color` is in `AccordionHeader`'s `restingIsolationKeys()` (only `visibility` is, from `.invisible`), while `setBackground`/`setForegroundColor` (via `flushStyleBag`) route based on that per-key set and land on the bare `#id` rule. The result: `Accordion.setThemed(false)` (`clearBackground`/`clearForegroundColor`) asserted `background: transparent` / `color: inherit` onto the higher-specificity guarded rule, and `Accordion.setThemed(true)` (`setBackground`/`setForegroundColor`) could only ever write to the lower-specificity bare rule — the stale clear values won the cascade permanently, leaving a re-themed header transparent and colourless. Confirmed live via a throwaway `RecordingDOMSink` probe before fixing, and via a new automated round-trip test after.

**The fix:** `writeGuardedCSSRule` itself was left unchanged — `Text`'s `textOverflow` and `Button`'s `boxShadow` call sites use it symmetrically for both the set and clear direction, so it's already correct for them, and widening the shared helper to gate on `restingIsolationKeys().has(key)` broke those (confirmed by trying it first: it failed 9 tests in `TextClassStyleHoisting.test.ts`/`TextTruncateWritePath.test.ts`, whose own comments document the current behaviour as intentional). Instead, `clearBackground()`/`clearForegroundColor()` (`packages/lib/src/typescript/lib/core/Component.ts`) now each check `this.isRestingChromeIsolated() && this.restingIsolationKeys().has(key)` before choosing `writeGuardedCSSRule` over the plain `setElementCSSRule` — the same per-key test `valueClassGuardSuffix` already uses for the value-class tier. This keeps `Button`'s existing correct behaviour (`color`/`background` genuinely are in its isolation keys, so it still asserts on the guarded rule) and fixes `AccordionHeader`'s.

**Tests updated:** `tests/core/BackgroundStyleBag.test.ts` row 4 and `tests/component/container/AccordionHeader.themedChromeDedup.test.ts` rows 7 and 10 asserted the guarded `:not(.invisible)` selector per the footnote's now-corrected claim; updated to assert the bare `#id` selector instead. A new test, `AccordionHeader.themedChromeDedup.test.ts`'s `'a themed → unthemed → themed round trip repaints the themed tokens instead of sticking on the clear'`, exercises the exact regression `Accordion.setThemed` round-trips through and would have failed against the pre-fix code.
