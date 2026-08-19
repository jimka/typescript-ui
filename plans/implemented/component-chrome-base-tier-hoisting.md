---
depends-on: [hoist-button-tabbar-state-chrome-rules]
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
  - packages/lib/src/typescript/lib/component/button/Button.ts
  - packages/lib/docs/reference/changelog/next.md
---

# Component Chrome Base-Tier Hoisting — Implementation Plan

## Overview

The framework already splits a component's CSS across three tiers: a zero-specificity `:where(.ts-ui-component)` framework rule, a shared `.ClassName` rule per concrete component class, and the instance's own `#id` rule. Ten fields are hoisted onto the first two tiers today — `visible`, `displayed`, `minSize`, `maxSize`, `overflow`, `cursor`, `userSelect`, `outline`, `foregroundColor`, `font` — declared in `ClassStyleDefaults` at [packages/lib/src/typescript/lib/core/ClassStyleRules.ts:32](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L32) and compared against by `Component.writeRuleDeclaration` at [packages/lib/src/typescript/lib/core/Component.ts:4720](packages/lib/src/typescript/lib/core/Component.ts#L4720).

Four chrome properties are not hoisted: `backgroundColor`, `backgroundImage`, `shadow` (CSS `box-shadow`), and `border` (four CSS longhands). Every instance of every class that defaults one of them repeats it on its own `#id` rule — input fields, lists, toolbars, menus, buttons, scrollbars, diagram nodes, status bars, badges and more. This plan extends `ClassStyleDefaults`, `resolveDeclarations`, and `classDeviations` to cover those four, so the value is declared once on the shared `.ClassName` rule and no instance repeats it unless it genuinely deviates.

The hard part is not the class rule; it is the write path. Unlike the ten already-hoisted fields, these four are written by *runtime* setters — `setBackgroundColor`, `setBackgroundImage`, `setShadow`, `setBorder` and their `clear*` partners — that can fire at any time, including from inside `super()` before the class rule has been resolved. The plan's central decision is that a hoisted chrome write is never *skipped*: when its value matches the class default it becomes an explicit removal of the `#id` declaration. That one rule covers both directions of a failure the sibling `hoist-button-tabbar-state-chrome-rules` effort hit three times — a write dropped for matching the class default, leaving an older instance value in place underneath it.[^why-clear-not-skip]

---

## Architecture Decisions

### Clear on match, never skip

For each hoisted chrome key, a write goes to the `#id` rule unless the class-tier rule already delivers exactly that value — in which case the `#id` rule is told to **remove** the property. It is never merely skipped.[^why-clear-not-skip]

Writing `null` for a key means "remove this declaration from `#id`", so the `.ClassName` rule — which declares the same value — becomes the winning declaration. The rendered result is identical, one declaration lighter, and no stale earlier value can survive underneath.

| Class default on `.ClassName` | What the instance does | What reaches `#id` |
|---|---|---|
| `background-color: T` | never touched | *(nothing — the rule may not exist at all)* |
| `background-color: T` | `setBackgroundColor("red")` | `background-color: red` |
| `background-color: T` | `setBackgroundColor("red")`, then `setBackgroundColor(T)` | *removal of `background-color`* |
| `background-color: T` | `clearBackgroundColor()` | `background-color: transparent` |
| *(none)* | `setBackgroundColor("red")` | `background-color: red` |
| *(none)* | `clearBackgroundColor()` | *removal of `background-color`* |

### Clearing asserts the CSS initial value when the class defaults the property

`clearBackgroundColor()` and `clearBackgroundImage()` mean "paint nothing here". Today they write `null`, which removes the `#id` declaration. Once the class rule declares the property, a removal no longer means "paint nothing" — it hands the property to the class rule. So when the class defaults the property, these two setters write the property's CSS initial value instead: `transparent` for `background-color`, `none` for `background-image`. When the class does not default it, they keep writing `null` exactly as today.

The codebase already solves this exact problem the same way, one property over: `Text.applyStyle` substitutes `text-overflow`'s initial value `"clip"` for a `null` value rather than passing the `null` through, for precisely this reason — [packages/lib/src/typescript/lib/component/input/Text.ts:1466](packages/lib/src/typescript/lib/component/input/Text.ts#L1466), with the full explanation in the comment above it.

`clearShadow()` and `clearBorder()` need no such substitution — both already write concrete `none` values rather than `null`.[^clears-already-safe]

### The comparison source is `_inheritedStyleBag`, read but never resolved by a setter

A runtime setter compares against `this._inheritedStyleBag` ([packages/lib/src/typescript/lib/core/Component.ts:452](packages/lib/src/typescript/lib/core/Component.ts#L452)), the per-class bag that `applyStyle` resolves once per render. A setter reads that field; it never calls `ensureClassStyleRule` itself.[^never-resolve-in-setter]

Before the first render the field is `null`, so every setter writes unconditionally — the same behaviour as today. The first `applyStyle` then re-derives every hoisted chrome declaration from the getters and reconciles it, replacing whatever construction queued. That render-time reconcile is what makes the dedup work at all for `border`, `shadow`, and `backgroundImage`, whose class defaults are dispatched through their setters during `super()`.[^always-dispatch-group]

### `FRAMEWORK_DECLARATIONS` is not extended

The zero-specificity `:where(.ts-ui-component)` rule gains no new keys. It only needs an entry for a key that a render phase writes *unconditionally*; all four chrome properties are written only when the component actually has a value, so an absent key is the correct "this class declares nothing" signal.[^no-framework-tier]

### `Button`'s chromeless construction branch must assert neutrals

`Button.applyChromeOptions`'s chromeless branch ([packages/lib/src/typescript/lib/component/button/Button.ts:918](packages/lib/src/typescript/lib/component/button/Button.ts#L918)) suppresses the shadow and gradient by writing `this._options.shadow = undefined` and `this._options.backgroundImage = undefined` — option writes with no DOM write behind them, relying on `applyStyle` skipping a property whose getter returns `null`. Once `.Button` carries those declarations, skipping them is no longer enough and every chromeless button regains a drop shadow and a gradient. The branch changes to `this.setShadow("none")` and `this.setBackgroundImage("none")`, matching what the `this.clearBorder()` call on the line above it already does for the border.

This is the only place in the library with that shape.[^only-chromeless]

### Order against the parallel Button chrome plan

This plan and `button-resting-chrome-state-isolation.md` are independent in design — one widens the base tier for every component class, the other isolates Button's resting chrome from its state rules — and either may be implemented first. They must not be implemented *concurrently* in separate worktrees: both edit `component/button/Button.ts`'s chrome region and both add a `next.md` changelog entry.[^parallel-plan]

---

## Internal Structure

### `core/ClassStyleRules.ts`

`ClassStyleDefaults` gains four fields. `BorderOptions` and `borderToStyle` come from `~/primitive/Border.js`, which imports nothing — no cycle forms.

```typescript
import { type BorderOptions, borderToStyle } from "~/primitive/Border.js";

export interface ClassStyleDefaults {
    // ... existing ten fields unchanged ...
    backgroundColor?: string | null;
    backgroundImage?: string | null;
    shadow?:          string | null;
    border?:          BorderOptions | string | null;
}
```

`resolveDeclarations` gains a block directly after the existing `outline` / `foregroundColor` lines and before the `font` lines. Every key stays **conditional** — an absent default must leave the key absent, never present with value `undefined`, exactly as the comment above the `outline` line already requires.

```typescript
if (defaults.backgroundColor) declarations.backgroundColor = defaults.backgroundColor;
if (defaults.backgroundImage) declarations.backgroundImage = defaults.backgroundImage;
if (defaults.shadow)          declarations.boxShadow       = defaults.shadow;

const border = defaults.border;
if (border) {
    // `borderToStyle` always yields all four longhands, resolving each side
    // through `side ?? border ?? "none"` — the same expansion Component's own
    // border writers use, so the two tiers compare key for key.
    Object.assign(declarations, borderToStyle(typeof border === "string" ? { border } : border));
}
```

`classDeviations` and `ensureClassStyleRule` need no edit: they iterate whatever `resolveDeclarations` returns and diff it against `FRAMEWORK_DECLARATIONS`, where the new keys are absent and therefore always count as deviations.

### `core/Component.ts`

One private predicate, extracted from `writeRuleDeclaration`'s existing body, plus two new protected write helpers. `Style` is the existing map type declared at the top of the same file.

```typescript
/** True when the framework or class rule already delivers `value` for `key`. */
private matchesClassStyle(key: string, value: string | null): boolean {
    return this._inheritedStyleBag !== null && this._inheritedStyleBag[key] === value;
}

/** Unchanged behaviour — the body now reads through `matchesClassStyle`. */
protected writeRuleDeclaration(key: string, value: string | null): void {
    if (this.matchesClassStyle(key, value)) {
        return;
    }

    this._styleRule.queue(key, value);
}

/**
 * `writeRuleDeclaration`'s clear-on-match sibling, for the hoisted chrome
 * declarations. A match queues a removal rather than skipping, so a value the
 * instance wrote earlier — during construction, or through a runtime setter —
 * cannot survive on `#id` and outrank the class rule.
 */
protected reconcileRuleDeclaration(key: string, value: string | null): void {
    this._styleRule.queue(key, this.matchesClassStyle(key, value) ? null : value);
}

/**
 * Runtime-setter form of `reconcileRuleDeclaration`. Routes through
 * `setElementCSSRules` so the whole bag commits in one flush and the
 * `autoCommitStyle` batching gate still applies. Inert before the first
 * render, when `_inheritedStyleBag` is still null.
 */
protected setReconciledCSSRules(values: Style): this {
    const resolved: Style = {};

    for (const key of Object.keys(values)) {
        resolved[key] = this.matchesClassStyle(key, values[key]) ? null : values[key];
    }

    return this.setElementCSSRules(resolved);
}
```

---

## Ordered Implementation Steps

1. **Write the tests first.** Create `packages/lib/tests/core/ClassChromeRules.test.ts` covering `## Expected Behaviour` rows 1–14. Follow the conventions the header comment of [packages/lib/tests/core/ClassStyleRules.test.ts](packages/lib/tests/core/ClassStyleRules.test.ts) sets out — in particular, every locally-declared `Component` subclass needs a name unique across the whole file, or it silently takes the name-collision opt-out (a class whose name another constructor already claimed gets no class rule at all, and writes everything to `#id`). Reuse that file's `declarationsDuring(sink, selector, fn)` helper shape, which filters recorded `setRuleStyles` writes by selector.
   *Check:* `npx vitest run tests/core/ClassChromeRules.test.ts` — cases fail for the expected reasons (the class rule carries no chrome, `#id` carries it all).

2. **`core/ClassStyleRules.ts` — widen the defaults interface.** Add `import { type BorderOptions, borderToStyle } from "~/primitive/Border.js";` beside the existing `~/primitive/*` imports, and add the four fields to `ClassStyleDefaults` as shown in `## Internal Structure`.
   *Check:* `npm run typecheck` passes.

3. **`core/ClassStyleRules.ts` — resolve the new declarations.** Add the conditional block from `## Internal Structure` to `resolveDeclarations`. Leave `FRAMEWORK_DECLARATIONS`, `classDeviations`, and `ensureClassStyleRule` untouched.
   *Check:* `npm run typecheck` passes.

4. **`core/ClassStyleRules.ts` — correct the stale counts.** Three comments say "fifteen": the one on `ClassStyleDefaults`, the one above `FRAMEWORK_DECLARATIONS`, and the one above `resolveDeclarations`. `FRAMEWORK_DECLARATIONS` still holds exactly fifteen entries, so its comment stays; the other two now describe a larger, partly conditional set. Reword those two to describe the set rather than count it — do not substitute a new number.
   *Check:* `grep -n 'fifteen' packages/lib/src/typescript/lib/core/ClassStyleRules.ts` — the only surviving match is the one directly above `FRAMEWORK_DECLARATIONS`.

5. **`core/Component.ts` — add the three helpers.** Insert `matchesClassStyle`, `reconcileRuleDeclaration`, and `setReconciledCSSRules` next to `writeRuleDeclaration` (around line 4720), and rewrite `writeRuleDeclaration`'s body to call `matchesClassStyle`. Update `writeRuleDeclaration`'s `@remarks`: its current text says a runtime setter never goes through this helper and therefore always reaches `#id`, which stops being true for the four chrome properties — point it at `setReconciledCSSRules`.
   *Check:* `npm run typecheck` passes; `npm test` no worse than after step 1 (no call site has changed yet).

6. **`core/Component.ts` — reconcile the render phases.** In `applyBoxAndVisibilityStyles` (around line 4824) change the `backgroundColor` and `backgroundImage` writes from `writeRuleDeclaration` to `reconcileRuleDeclaration`. In `applyChromeStyles` (around line 4915) change the `boxShadow` write likewise, and replace the border branch's `this._styleRule.queueMany(borderToStyle(this._border))` with a loop passing each of the four longhands through `reconcileRuleDeclaration`. Leave the `else` branch's `writeRuleDeclaration("border", null)` alone — the `border` *shorthand* is a framework-tier key whose value is `null`; only the four longhands are hoisted.
   *Check:* `npm run typecheck` passes.

7. **`core/Component.ts` — route the runtime setters.** Change the write line in each to `setReconciledCSSRules`:
   - `setBackgroundColor` → `this.setReconciledCSSRules({ backgroundColor });`
   - `setBackgroundImage` → `this.setReconciledCSSRules({ backgroundImage });`
   - `setShadow` → `this.setReconciledCSSRules({ boxShadow: shadow });`
   - `clearShadow` → `this.setReconciledCSSRules({ boxShadow: "none" });`
   - `setBorder` and `clearBorder` → `this.setReconciledCSSRules(borderToStyle(this._border));`

   Leave every early-return guard, `_options` write, `_border` / `_borderWidths` assignment, and the theme subscription in `setBorder` exactly as they are.
   *Check:* `npm run typecheck` passes.

8. **`core/Component.ts` — neutralise the two clears.** In `clearBackgroundColor`, write `this.setReconciledCSSRules({ backgroundColor: this._defaultOptions.backgroundColor ? "transparent" : null });`. In `clearBackgroundImage`, write `this.setReconciledCSSRules({ backgroundImage: this._defaultOptions.backgroundImage ? "none" : null });`. Add a one-line comment at each: a class-tier default would repaint through a bare removal, so a defaulting class gets the CSS initial value asserted instead.
   *Check:* `npm run typecheck` passes.

9. **`component/button/Button.ts` — fix the chromeless construction branch.** In `applyChromeOptions`'s chromeless branch, replace `this._options.shadow = undefined;` with `this.setShadow("none");` and `this._options.backgroundImage = undefined;` with `this.setBackgroundImage("none");`. Update the surrounding comment: the option-only clear worked because `applyStyle` skipped a null-valued getter, and no longer does now that `.Button` carries both declarations. Leave `this.clearBorder()`, the `borderRadius` option write, the `backgroundColor` block, and the `setPressedForegroundColor` pin untouched.
   *Check:* `npm test` — the whole suite green, including every case from step 1.

10. **Sweep the shared class-scoped state rules.** Hoisting a resting chrome value from `#id` to `.ClassName` lowers its specificity, so a module-level shared rule whose selector is a component class plus a state (`.PickerCell:hover`, `.PickerCell.disabled`, and the equivalents in the files listed under `## Potential Challenges`) can now win a property it previously lost. For each such rule that sets one of the four properties, check whether the component class it targets defaults the same property. Write down every pair found — do not change the rule here; confirm the resulting appearance in step 12.
    *Check:* the list of pairs exists, even if empty.

11. **Add the changelog entry.** See `## Documentation Impact`.
    *Check:* `npm run docs:api` finishes with zero warnings.

12. **Verify live in a browser.** Non-negotiable — see `## Verification`. The automated suite asserts what gets *written*, never what the cascade *resolves*, and that blind spot is what let the sibling plan ship an invisible regression.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/tests/core/ClassChromeRules.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/button/Button.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |

---

## Expected Behaviour

Rows 1–14 are unit-testable against the recording DOM sink. Rows 15–18 are manual — the harness records writes, it does not run a CSS cascade.

| # | Case | Expected |
|---|---|---|
| 1 | A class defaulting `backgroundColor` renders its first instance | `.ClassName` declares `background-color`; the instance's `#id` rule declares none |
| 2 | A class defaulting `backgroundImage` / `shadow` renders | `.ClassName` declares `background-image` / `box-shadow`; `#id` declares neither |
| 3 | A class defaulting `border: "1px solid red"` renders | `.ClassName` declares all four `border-*` longhands as `1px solid red`; `#id` declares none |
| 4 | A class defaulting `border: { borderTop: "2px solid red" }` renders | `.ClassName` declares `border-top: 2px solid red` and the other three sides as `none` |
| 5 | A class defaulting none of the four renders | `.ClassName` declares none of them; an instance that sets one writes it to `#id` exactly as before |
| 6 | Rendered instance of a defaulting class calls `setBackgroundColor("red")` | `#id` receives `background-color: red` |
| 7 | …then calls `setBackgroundColor(<class default>)` | `#id` receives a `background-color` **removal** — not nothing |
| 8 | Rendered instance of a defaulting class calls `setBorder(<class default>)` | `#id` receives four `border-*` removals |
| 9 | `clearBackgroundColor()` on a class that defaults `backgroundColor` | `#id` receives `background-color: transparent` |
| 10 | `clearBackgroundColor()` on a class that defaults none | `#id` receives a `background-color` removal (unchanged from today) |
| 11 | `clearBackgroundImage()` on a defaulting / non-defaulting class | `background-image: none` / a removal, respectively |
| 12 | `clearShadow()` and `clearBorder()` | Unchanged in effect: `box-shadow: none`, and four `border-*: none` — except on a class whose default is already that neutral, where a removal is written instead |
| 13 | A fresh `new Button("x", { chromeless: true })` renders | `#id` declares `box-shadow: none` and `background-image: none` |
| 14 | `setChromeless(true)` then `setChromeless(false)` on a rendered `Button` | Chrome returns to the class-tier values with nothing stale left on `#id`; the restore writes removals for properties matching the class default, never skips |
| 15 | Demo app: stock `Button`, `TextField`, `ComboBox`, `StatusBar`, `ToolBar`, `MenuBar`, `Tree`, `Scrollbar`, `DiagramNode` | Computed background, box-shadow and border identical to before the change |
| 16 | Demo app: chromeless `MenuBarButton`, flat `Button`, and the `Dialog` / `Notification` close buttons | No drop shadow, no gradient, no border — identical to before the change |
| 17 | Demo app: `Button` hover and press; `TabButton` selected vs unselected; list row hover and selection | Each state still visibly differs from rest and from the others |
| 18 | Any pair found in step 10 (a shared `.Class:state` rule whose class also defaults the same property) | The state rule now wins where it previously lost; confirm the resulting appearance is the intended one |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

Grep invariants (all expect zero matches):

```
grep -n 'queueMany(borderToStyle'            packages/lib/src/typescript/lib/core/Component.ts
grep -n 'setElementCSSRules(borderToStyle'   packages/lib/src/typescript/lib/core/Component.ts
grep -nE 'setElementCSSRule\("(backgroundColor|backgroundImage|boxShadow)"' packages/lib/src/typescript/lib/core/Component.ts
grep -n '_options.shadow *= *undefined'      packages/lib/src/typescript/lib/component/button/Button.ts
```

**Manual browser verification (rows 15–18) is required and is the step most likely to catch a defect here.** The offline harness records writes; it cannot tell you which declaration the browser's cascade actually resolves, and specificity is the whole subject of this change.

- Start a dev server on a spare port from *this worktree* (`npx vite --port 8023` inside `packages/lib`), not the user's existing server — a server started elsewhere may resolve the library to a different tree and silently exercise unchanged code.
- Exercise `#/buttons`, `#/menubar`, `#/inputs`, `#/tabs`, `#/tables`, and `#/diagram` in the demo app.
- For each row read **computed styles** (forcing the `:hover` / `.pressed` state through DevTools where needed) rather than relying on screenshots — a specificity fault often looks identical in a still image.

---

## Documentation Impact

No new exported symbol: all three new `Component` members are `private` or `protected`, and TypeDoc excludes both. No API page changes, no barrel change, no sidebar entry.

One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Core`, immediately after the existing bullet about `user-select` / `outline` / `color` / `border` joining the hoisted declarations. Mirror that bullet's structure, including its consumer-facing specificity warning:

- `background-color`, `background-image`, `box-shadow` and the four `border-*` longhands now join the hoisted style declarations. A component whose value matches its class's own default no longer writes a per-instance rule for it.
- The same specificity consequence applies as in the neighbouring bullet: a consumer stylesheet targeting a component **by class** now ties with the generated `.ClassName` rule and lands on source order, where the framework's `#id` rule previously always won. Raise the selector's specificity, or target the component's id.
- One further consequence worth naming, because it can change appearance rather than merely change who wins an override: a framework state rule scoped to a class selector (a `:hover` or `.selected` rule) now outranks the resting chrome it previously lost to.

---

## Potential Challenges

- **A shared class-scoped state rule starts winning a property it used to lose.** Hoisting drops the resting value from a `#id` selector to a `.ClassName` one — in CSS specificity terms, written as (ids, classes, elements), from `(1,0,0)` to `(0,1,0)` — so a `.Class:hover` rule at `(0,2,0)` now beats it where it previously lost to any id. Mitigation: step 10 enumerates the candidates; the module-level shared rules to check live in `component/input/PickerColumn.ts`, `component/input/AbstractCalendarDropdown.ts`, `component/list/AbstractSelectableList.ts`, `component/menubar/MenuBarButton.ts`, `component/input/focusRing.ts`, `component/container/CollapseButton.ts`, `component/display/ProgressSpinner.ts`, `component/display/Markdown.ts`, `component/editor/theme.ts`, and `component/editor/editorTheme.ts`. Row 18 confirms each live.
- **A subclass appearing to inherit its parent's chrome.** A subclass cannot actually inherit it: `Component.init` adds only `this.constructor.name` to the element's class list ([packages/lib/src/typescript/lib/core/Component.ts:5899](packages/lib/src/typescript/lib/core/Component.ts#L5899)), so a `TabButton` element never matches `.Button`. A subclass that suppresses an inherited default with an explicit `undefined` key — as `TabButton` does for `shadow` — stays suppressed.
- **`clearBackgroundColor` asserting `transparent` also strips a UA background.** On a `<button>` or `<input>` element, `background-color: transparent` at author level beats the UA face, where a bare removal would not have. No current call site is affected: the three of them (`ProgressSpinner`, `PickerColumn`'s cell, `AbstractCalendarDropdown`'s cell) are on classes that default no `backgroundColor`, so they keep writing `null`. Row 16 confirms it live.
- **Extra removals queued per render.** Each reconciled key that matches now queues a `null` instead of being skipped. A component with no other deviation still materialises no rule at all — `materialiseWhenNeeded` treats a bag of only `null`s as nothing to insert ([packages/lib/src/typescript/lib/core/StyleTarget.ts:108](packages/lib/src/typescript/lib/core/StyleTarget.ts#L108)) — and a component that does have a rule pays the removals inside the single batched flush `applyStyle` already performs.
- **Border width measurement.** Unaffected: `measureBorderWidths` reads computed style through the DOM seam, which resolves the whole cascade, and `_border` still holds the spec regardless of which tier declares it.

---

## Critical Files

| File | Why |
|---|---|
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | The tier machinery being extended: `ClassStyleDefaults`, `FRAMEWORK_DECLARATIONS`, `resolveDeclarations`, `classDeviations`, `ensureClassStyleRule` |
| `packages/lib/src/typescript/lib/core/Component.ts` | `writeRuleDeclaration` (4720), `getClassStyleDefaults` (4736), `applyStyle` and its phases (4757–5005), the four setters and their clears (2131–2550), `setElementCSSRule(s)` (1607–1636), `init`'s `addClass` (5899) |
| `packages/lib/src/typescript/lib/component/input/Text.ts` | The precedent for asserting a CSS initial value instead of passing `null` through — line 1466 and the comment above it |
| `packages/lib/src/typescript/lib/component/button/Button.ts` | `applyChromeOptions` (918) and its chromeless branch; `_clearChrome` (1857), `_restoreChrome` (1896) and `_applyFlatChrome` (2049) are the paths rows 13–14 exercise |
| `packages/lib/src/typescript/lib/primitive/Border.ts` | `borderToStyle` (35) — the four-longhand expansion both tiers must agree on |
| `packages/lib/src/typescript/lib/core/StyleTarget.ts` | `queue` (61) and `hasQueuedDeclarations` (108) — why a bag of only removals inserts no rule |
| `packages/lib/tests/core/ClassStyleRules.test.ts` | Test conventions for this subsystem, including the unique-class-name rule and `declarationsDuring` |
| `packages/lib/docs/reference/changelog/next.md` | The neighbouring hoisting entry this one mirrors |
| `plans/implemented/hoist-button-tabbar-state-chrome-rules.md` | Its `## Implementation Notes` document the three skip-versus-clear failures this design is shaped to avoid |

---

## Non-Goals

- **`borderRadius`.** Its runtime setter writes an *inline* style while `applyChromeStyles` writes a *rule* declaration, so the two seams disagree about who owns the property. Hoisting it needs that question settled first, which is a separate decision.
- **The `background` shorthand.** No class defaults it, and it resets both hoisted background longhands, so hoisting it would drag in shorthand-versus-longhand cascade reasoning for no saving.
- **Re-widening the `Button` / `ToggleButton` / `TabButton` state-rule resolvers.** The sibling plan narrowed `getPressedClassDeclarations` and its siblings to `color` because the base `#id` rule was competing for the rest. This plan removes that competition, which makes re-widening possible — but re-widening is a change to those three components' resolvers, with its own audit, and is not attempted here.
- **New entries in `FRAMEWORK_DECLARATIONS`.** Declaring `background-color: transparent` framework-wide would strip the UA background from every `<button>` and `<input>` element in the library.
- **Giving `clearShadow` / `clearBorder` an initial-value substitution.** Both already write concrete `none` values, so there is nothing to substitute; they are routed through the reconcile helper in step 7 only so a class whose default is already that neutral dedupes.

---

## Notes

[^why-clear-not-skip]: The alternative is to skip the write when it matches the class default — what `writeRuleDeclaration` does for the ten already-hoisted fields, and what `writeClassStateDeclaration` does for the state rules. Skipping is only safe when nothing can already be sitting on `#id` for that key, and for these four properties something can: the runtime setters are public, and the `border` / `shadow` / `backgroundImage` defaults are dispatched through their setters during construction. `plans/implemented/hoist-button-tabbar-state-chrome-rules.md`'s Implementation Notes record three separate regressions from exactly this, most directly its "Round 3" finding, where `setChromeless(false)`'s restore path wrote a value matching the class bag, was silently skipped, and left a stale pin on `#id` for good. Clearing on match makes that failure unreachable by construction rather than asking each call site to remember to force a write: the match branch always emits a removal, so whatever was there goes away. It also makes `Button._restoreChrome` correct with no special-casing — its `setShadow(<class default>)` now emits a removal that wipes the chromeless `"none"`, instead of being dropped and leaving it.

[^clears-already-safe]: `clearShadow()` writes `box-shadow: none` — its JSDoc calls out that it deliberately preserves the legacy `setShadow(null)` semantic rather than removing the property — and `clearBorder()` sets `_border = { border: "none" }`, which `borderToStyle` expands to four `none` longhands. A concrete value at `#id` outranks the class rule, so both already mean "paint nothing" under the new tiering.

[^never-resolve-in-setter]: `ensureClassStyleRule` caches its result per constructor in a module-level map that is never invalidated, so resolving the bag once with wrong inputs poisons that class for the whole process. A setter can run inside `super()`, before a subclass's own fields exist — and `getClassStyleDefaults` is overridable, with `Text`'s override reading derived state. Reading `_inheritedStyleBag` and accepting that it is `null` before the first render costs nothing, because the render-time reconcile corrects whatever construction queued, and it removes that risk entirely.

[^always-dispatch-group]: `border`, `borderRadius`, `shadow` and `backgroundImage` are the "chrome group": `Component.applyChromeOptions` folds `this._defaultOptions.X` into the dispatch, so the class default reaches the setter at construction rather than being resolved lazily by the getter (ARCHITECTURE.md, *Class-level defaults must survive the getter*, explains why). Their `#id` declarations are therefore queued by the setter during `super()`, long before `applyStyle` runs. A render phase that merely *skipped* the matching write would leave those construction-time entries sitting in the dirty bag untouched, and the class rule would save nothing; `queue(key, null)` overwrites the entry in the same bag, which is what makes the plan pay off for these three. `backgroundColor` is not in that group — its folding getter resolves the default at render — so for it the reconcile matters only when a caller passed a value equal to the class default.

[^no-framework-tier]: `FRAMEWORK_DECLARATIONS` exists so a key that a phase writes on *every* component has a value to compare against; `border: null` is in it for exactly that reason, since `applyChromeStyles` writes `border: null` unconditionally when no border is set. Each of the four chrome properties is written only inside a truthiness guard, so a class with no default produces no key, `matchesClassStyle` never matches, and the write reaches `#id` exactly as it does today. Adding neutral entries would let the two `clear*` setters drop their `_defaultOptions` check, but the `background-color` neutral is unsafe (see the Non-Goal), and adding neutrals for only `background-image` and `box-shadow` would leave two mechanisms in play for three near-identical properties.

[^only-chromeless]: The shape to look for is a code path that suppresses a chrome property by writing `undefined` into `_options` with no matching DOM write, relying on `applyStyle` skipping a `null`-valued getter. A grep across the library for direct `_options.{shadow,backgroundImage,backgroundColor,border}` and `_border` assignments outside `core/Component.ts` finds only Button's chromeless construction branch and `Cell.ts`'s background cache — the latter a write of a real value, on a class with no chrome defaults. Button's other two chrome-suppressing paths, `_clearChrome` (the `setChromeless(true)` runtime toggle) and `_applyFlatChrome`, both go through the `clear*` setters and are therefore covered by the `clear*` change alone. The sibling plan flagged this general shape — a per-instance opt-out competing with a per-class shared default — as the first thing to interrogate when widening the mechanism; this is that sweep, at the base tier.

[^parallel-plan]: `button-resting-chrome-state-isolation.md` is a Button-family plan about how resting chrome and the pressed/hover state rules relate; this one is a Component-wide plan about which tier a resting declaration lives on. Neither needs the other's outcome, and neither's decisions constrain the other's, so no `depends-on` relationship exists between them. The conflict is purely textual, which is what the `touches-shared` frontmatter above records. `hoist-button-tabbar-state-chrome-rules` *is* declared as a dependency — not because this plan needs its mechanism, but because this plan is written against the tree that contains it: the line numbers cited throughout, `Button`'s chromeless `setPressedForegroundColor` pin, and the `writeClassStateDeclaration` remarks that motivate the clear-on-match decision all come from that branch.

---

## Implementation Notes

**Step 10 sweep result: no colliding pairs found.** For each file `## Potential Challenges` names, every shared state rule that sets one of the four hoisted properties is safe for one of two reasons: either the rule's target component class does not itself default that property through the options-defaults route (`_defaultXOptions` / a constructor's `subclassDefaults` argument), so no new class-tier declaration appears for it to collide with; or the rule paints a separate pseudo-element box (`::after`) that never competes with the host element's own declaration regardless of which tier it lives on:

| File | Shared rule(s) checked | Target class | Property | Defaults it? | Verdict |
|---|---|---|---|---|---|
| `component/input/PickerColumn.ts` | `.PickerCell:hover`, `.PickerCell.disabled` | `PickerCell` (extends `Text`) | `backgroundColor` | No — constructor passes only `textAlign`/`preferredSize` to `super()`, no `subclassDefaults`; `Text`'s own `_defaultTextOptions` has no chrome fields | Safe |
| `component/input/AbstractCalendarDropdown.ts` | `.PickerDay:hover`, `.PickerDay.disabled`, `.PickerNavButton:hover` | `PickerDay` (extends `Text`), `PickerNavButton` (extends `Component`) | `backgroundColor` | No — neither constructor passes a chrome default | Safe |
| `component/list/AbstractSelectableList.ts` | `.SelectableListRow:hover`, `.SelectableListRow.selected` | `SelectableListRow` (extends `Component`) | `backgroundColor` | No — constructor calls `super({ tag: "div" })` only | Safe |
| `component/list/AbstractSelectableList.ts` | `.List:focus::after, .MultiSelectList:focus::after` | `List` / `MultiSelectList` (via `AbstractSelectableList`) | `border` | Yes (`_defaultAbstractSelectableListOptions.border`) — but same reasoning as the `focusRing.ts` row: the declaration paints the `::after` pseudo-element's own box, a different box entirely from the host `.List`/`.MultiSelectList` element's own `border`, so hoisting the host's border onto the class tier does not touch it | Safe (no shared property) |
| `component/menubar/MenuBarButton.ts` | `:hover` (via `styleRules` option) | `MenuBarButton` | `backgroundColor` | Yes (`_defaultMenuBarButtonOptions.backgroundColor`) — but the rule is **not** class-scoped: `styleRules` routes through `Component.createStyleRule`, which allocates a `scope: "component"` (`#id<suffix>`) rule, specificity `(1,1,0)`, always above `.MenuBarButton`'s `(0,1,0)` class tier regardless of this plan | Safe (different tier than the plan touches) |
| `component/input/focusRing.ts` | `:focus-within::after` | every composite input using it | `border` (among others) | N/A — the rule paints a decorative pseudo-element's own box, a different selector/box entirely from the host element's own `border` | Safe (no shared property) |
| `component/container/CollapseButton.ts` | `.CollapseButton` (base rule, no state suffix) | `CollapseButton` | `border`, `boxShadow`, `background` | No — the only chrome-adjacent option forwarded to `super()` is `cursor`, passed as a literal instance option, not a default; `resolveDeclarations`/`ensureClassStyleRule` therefore has nothing to contribute for this class, so the hand-rolled `.CollapseButton` `StyleRule` (a pre-existing, unrelated mechanism sharing the same selector text) is unaffected | Safe |
| `component/display/ProgressSpinner.ts` | none (a per-instance `setBorder()` call on an anonymous, undefaulted `Component`) | `Component` (bare) | `border` | No | Safe |
| `component/display/Markdown.ts` | multiple `scope: "class"` rules (`CODE_CLASS`, `PRE_CLASS`, `QUOTE_CLASS`, `TH_CLASS`, `TD_CLASS`, …) | none — these are literal CSS classes stamped on raw generated HTML output (`<code>`, `<pre>`, `<th>`, …), not any `Component` subclass's constructor-derived class name | — | N/A | Safe (mechanism doesn't apply) |
| `component/editor/theme.ts` | CodeMirror's own `EditorView.theme()` | none — entirely independent of the framework's `StyleRule`/`Component` machinery | — | N/A | Safe (mechanism doesn't apply) |
| `component/editor/editorTheme.ts` | multiple `scope: "class"` rules, including `TABLE_CELL_SELECTED_CLASS` (`backgroundColor`) | none — these are Lexical's own generated DOM class names, not a `Component` subclass | — | N/A | Safe (mechanism doesn't apply) |

Row 18 of `## Expected Behaviour` is therefore vacuous: the list of pairs to confirm live is empty, so the manual browser pass (step 12) had nothing further to check beyond rows 15-17.
