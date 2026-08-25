---
touches-shared:
  - ARCHITECTURE.md
  - packages/lib/docs/reference/changelog/next.md
---

# SpinButton Pressed Box-Shadow State-Tier Dedup — Implementation Plan

## Overview

Every `SpinButton` writes `box-shadow: none` into its own per-instance `#id.pressed` CSS rule. The write comes from the constructor's [`clearPressedShadow()`](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L107) call, which resolves to `writeStateStyle(".pressed", { shadow: this.getShadow() ?? "none" })` ([Button.ts:2584](packages/lib/src/typescript/lib/component/button/Button.ts#L2584)). The value is `"none"` for every default-constructed spin button, so a live Style Audit sees the same one-declaration rule repeated once per instance. Two existing tests pin exactly this: [`Button.pressedHoverClassHoisting.test.ts:151`](packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts#L151) and [`Button.restingChromeIsolation.test.ts:195`](packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts#L195).

The fix is one declaration on `SpinButton`: a `protected static readonly ownStyleStates` list that restates `Button`'s two states in `Button`'s own order and overrides only `.pressed`'s shadow with `"none"`. That publishes one shared `.SpinButton.pressed { box-shadow: none }` class rule, and `flushStateStyleBag`'s existing dedup ([Component.ts:5492](packages/lib/src/typescript/lib/core/Component.ts#L5492)) then turns every instance's `clearPressedShadow()` write into a no-op removal instead of a real declaration.

`SpinButton` does **not** declare `ownStyleStates` today — it inherits `Button`'s. So this plan adds a first declaration on `SpinButton` rather than extending one, but it must still restate `Button`'s entries: the declared list governs state *order* as a whole, so a list that named only `.pressed` would drop `:hover` from `SpinButton`'s resolution and silently change the resting tier's `:not(...)` guard.[^order-is-whole-list]

The change is one source file plus documentation and tests. `NumberSpinner`'s `SpinButtonUp`/`SpinButtonDown` subclasses are unaffected in their own source — they inherit the new declaration and keep sharing `.SpinButton.pressed`.

---

## Architecture Decisions

### `SpinButton` restates `Button`'s state list and overrides only `.pressed`'s shadow

`SpinButton.ownStyleStates` is `[{ selector: ".pressed", extract: () => ({ shadow: "none" }) }, Button.ownStyleStates[1]]` — its own `.pressed` entry first, then `Button`'s `:hover` entry restated by index. This mirrors [`TabButton.ownStyleStates`](packages/lib/src/typescript/lib/component/button/TabButton.ts#L177), which restates `ToggleButton.ownStyleStates[0]` by index and supplies its own `:hover`/`.selected` entries. The shape of a single declared state — `protected static readonly ownStyleStates: readonly StyleStateSpec[]` holding `{ selector, extract }` pairs — matches the codebase's two other current uses in [`ScrollArrowButton`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L180) (`.disabled`) and [`ScrollbarThumb`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L412) (`.hover`).[^precedent-search]

The `.pressed` extract returns only `{ shadow: "none" }`. State *content* is merged per level: `resolveStateLevels` builds this level's authored bag as `{ ...parentLayer.authored, ...spec.extract(...) }` and inserts a rule only for the delta against the parent's resolved bag ([ClassStyleRules.ts:696-762](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L696-L762)). `.pressed`'s other three keys keep coming from `.Button.pressed`.

| Class | `.pressed` authored bag | Rule inserted |
|---|---|---|
| `Button` | `color`, `backgroundColor`, `backgroundImage`, `shadow` (the pressed-shadow token) | `.Button.pressed` with all four |
| `SpinButton` | same four, with `shadow` replaced by `"none"` | `.SpinButton.pressed { box-shadow: none }` — the delta only |
| `SpinButtonUp` / `SpinButtonDown` | inherited from `SpinButton`, no own declaration | none — both share `.SpinButton.pressed` |

### The constructor's `clearPressedShadow()` call stays

`SpinButton`'s constructor keeps calling `clearPressedShadow()` under its existing `options?.pressedShadow === undefined` guard. The call is not redundant: `clearPressedShadow()` pins the *resting* shadow, not a constant, so a caller-supplied `shadow` must still reach the pressed rule per-instance.[^keep-the-clear-call]

| Construction | `clearPressedShadow()` writes | Class bag holds | Instance `#id.pressed` result |
|---|---|---|---|
| `new SpinButton("▲")` | `"none"` | `"none"` | no declaration — deduped to a removal |
| `new SpinButton("▲", { shadow: "0 0 2px red" })` | `"0 0 2px red"` | `"none"` | real `box-shadow: 0 0 2px red` |
| `new SpinButton("▲", { pressedShadow: "x" })` | not called (guarded) | `"none"` | real `box-shadow: x`, from `setPressedShadow` |

### No construction-ordering hazard exists here

`resolveStyleStates(SpinButton)` — and therefore the insertion of `.SpinButton.pressed` — first runs during `Button`'s own constructor, when `applyChromeOptions` calls `setPressedShadow(options.pressedShadow ?? this.getPressedShadow()!)` ([Button.ts:1117](packages/lib/src/typescript/lib/component/button/Button.ts#L1117)). Publishing a shared class-tier rule at construction time is the mechanism's existing behaviour, not something this plan introduces: `.Button.pressed` already materializes at exactly that moment for every button.[^no-ordering-hazard]

### `.SpinButton.pressed` and `.Button.pressed` have equal specificity, and source order decides correctly

Both selectors score `(0, 2, 0)`, so the later rule in the stylesheet wins. `resolveStateLevels` recurses to the parent level before inserting its own rule, so `.Button.pressed` is always in the sheet before `.SpinButton.pressed`. This is the same ordering guarantee the resting tier documents and relies on ([ARCHITECTURE.md](ARCHITECTURE.md), *The class tier is hierarchy-aware*), and the same one `TabButton`'s `:hover` deviation from `.Button:hover:not(.pressed)` already depends on.

---

## Internal Structure

### `component/input/SpinButton.ts` — the declaration

Widen the existing type-only import ([SpinButton.ts:13](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L13)):

```typescript
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";
```

Add to the class body immediately after `ownClassStyleDefaults` ([SpinButton.ts:71](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L71)):

```typescript
    // Restates Button's state list in Button's own order — the declared list
    // governs order as a whole (see `resolveStyleStates`'s own comment), so
    // naming only `.pressed` here would drop `:hover` from SpinButton's
    // resolution and narrow the resting tier's `:not(...)` guard. Only
    // `.pressed`'s shadow deviates: a spin button sits flush in its
    // NumberSpinner cell with no resting shadow, so it has no pressed shadow
    // either. Content merges per level, so `.pressed`'s colour and background
    // keys still resolve from `.Button.pressed` and are not repeated here.
    // The constructor's `clearPressedShadow()` call below now dedupes against
    // this shared value instead of writing `box-shadow: none` on every
    // instance's own `#id.pressed` rule.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".pressed",
            extract: (): StyleBag => ({ shadow: "none" }),
        },
        Button.ownStyleStates[1],   // :hover, restated unchanged
    ];
```

`Button.ownStyleStates` is `protected static`; a subclass class body may read it, which is how `ToggleButton` ([ToggleButton.ts:63-64](packages/lib/src/typescript/lib/component/button/ToggleButton.ts#L63)) and `TabButton` ([TabButton.ts:177-178](packages/lib/src/typescript/lib/component/button/TabButton.ts#L177)) already build their own lists. `Button.ownStyleStates[1]` is the `:hover` entry ([Button.ts:412-428](packages/lib/src/typescript/lib/component/button/Button.ts#L412-L428)); index `0` is `.pressed`.

No other change to `SpinButton.ts`. The constructor's `clearShadow()` / `clearPressedShadow()` block ([SpinButton.ts:103-108](packages/lib/src/typescript/lib/component/input/SpinButton.ts#L103-L108)) stays exactly as it is.

### `ARCHITECTURE.md` — two stale statements

Both live in the state-tier prose and become wrong once `SpinButton` declares its own list.

- Line 292, the enumeration ending "…are the components that declare states today": add `SpinButton` (`.pressed`, restated with its own `shadow`) to the list, after `` `Button` (`.pressed`, `:hover`) ``.
- Line 300, the whole-list-order example currently reading "(`TabButton`/`SpinButton` resolve `.pressed` to `Button.ownStyleStates`'s order, not a list of their own)": replace the two class names with `` `MenuButton`/`PopupButton` ``, which declare no `ownStyleStates` of their own and so are correct examples of the rule being illustrated.

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/component/input/SpinButton.ts`** — widen the `ClassStyleRules.js` type import to include `StyleStateSpec`, then add the `ownStyleStates` declaration per `## Internal Structure`. Leave the constructor untouched.
   *Check:* `npm run typecheck` from `packages/lib`.

2. **Update the two tests that pin the old per-instance write.** Both assertions are correct statements of today's behaviour and become wrong; rewrite them to the new expectations rather than deleting them.
   - [`packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts`](packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts): the test at line 144 asserts `_ruleCacheHas('.SpinButton.pressed')` is `false` — it is now `true`. The test at line 151 asserts a second `SpinButton`'s own `#id.pressed` rule carries `boxShadow: 'none'` — it now carries no `boxShadow` at all. Update both titles and bodies, and the file-header comment at lines 31-36 which states the same stale claim in prose.
   - [`packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts`](packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts): "row 10" at line 195 asserts the same `#id.pressed` `boxShadow: 'none'` write. Update it to assert no per-instance `boxShadow` declaration.
   *Check:* `npx vitest run tests/component/button/Button.pressedHoverClassHoisting.test.ts tests/component/button/Button.restingChromeIsolation.test.ts`.

3. **New test file `packages/lib/tests/component/input/SpinButton.pressedShadowClassHoisting.test.ts`** covering `## Expected Behaviour` rows 1-5. A separate file is required, not an addition to an existing one: `.SpinButton.pressed`'s content is written once per test *file* (module state surviving `DOM.reset()`), so the row-1 capture window must be the first `SpinButton` construction in its file.[^new-file-needed] Copy the `DOM_CONFIG` block and the `idSelector` / `declarationsDuring` helpers from [`Button.pressedHoverClassHoisting.test.ts:45-88`](packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts#L45-L88) — they are file-local there, not exported.
   *Check:* `npx vitest run tests/component/input/SpinButton.pressedShadowClassHoisting.test.ts`.

4. **`ARCHITECTURE.md`** — make the two edits in `## Internal Structure`.
   *Check:* `grep -n 'declare states today' ARCHITECTURE.md` names `SpinButton`; `grep -n 'not a list of their own' ARCHITECTURE.md` no longer names `SpinButton`.

5. **`packages/lib/docs/reference/changelog/next.md`** — add the entry described in `## Documentation Impact`.
   *Check:* `grep -n 'spin button' packages/lib/docs/reference/changelog/next.md` finds the new bullet.

6. **Full verification.** See `## Verification`.

7. **Manual browser check.** See `## Verification` — required, as for every state-tier change in this batch.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/input/SpinButton.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts` |
| Modify | `packages/lib/tests/component/button/Button.restingChromeIsolation.test.ts` |
| Create | `packages/lib/tests/component/input/SpinButton.pressedShadowClassHoisting.test.ts` |

---

## Expected Behaviour

Rows 1-6 are unit-testable against the recording DOM sink (`installTestDOM` / `RecordingDOMSink`, `packages/lib/tests/dom/TestDOM.ts`). Row 7 needs a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | The first `SpinButton` in a fresh test file renders | `.SpinButton.pressed` is inserted carrying exactly `box-shadow: none`, and no `color` / `background-color` / `background-image` declaration (those stay on `.Button.pressed`) |
| 2 | A second `SpinButton` renders | Its own `#id.pressed` rule carries no `boxShadow` declaration |
| 3 | `_ruleCacheHas` after any `SpinButton` renders | `.Button.pressed` is `true` **and** `.SpinButton.pressed` is `true` |
| 4 | `new SpinButton("▲", { shadow: "0 0 2px red" })` renders | Its own `#id.pressed` rule carries a real `box-shadow: 0 0 2px red` — the caller's resting shadow still reaches the pressed state per-instance |
| 5 | A `NumberSpinner` renders (its `SpinButtonUp` / `SpinButtonDown`) | Neither `.SpinButtonUp.pressed` nor `.SpinButtonDown.pressed` is ever created; both buttons resolve `.pressed` to `.SpinButton.pressed` |
| 6 | `new SpinButton("▲").getPressedShadow()` | `"none"`, unchanged from today |
| 7 | Manual: dev server, the `NumberSpinner` demo, all three shipped themes | Pressing either spin button looks identical to before (no shadow appears on press); the Style Audit panel no longer lists a duplicated `{ box-shadow: none; }` row for the spin buttons |

---

## Verification

Run from `packages/lib` unless noted.

```
npm run typecheck
npm run typecheck:test
npm test
npm run lint
npm run docs:api
```

- `npx vitest run --no-file-parallelism` — confirms the whole suite, in particular the other four files that construct `SpinButton`: `tests/component/input/SpinButton.test.ts`, `tests/component/input/NumberSpinner.spinButtonClassStyleHoisting.test.ts`, `tests/component/input/single-line-min-height.test.ts`, `tests/component/button/WindowControlButton.classStyleHoisting.test.ts`. None of the four asserts on `.pressed`; all four are expected to stay green unmodified.
- **Manual browser verification (`## Expected Behaviour` row 7) is required.** Start a dev server on a spare port from *this worktree* and confirm with `readlink /proc/<pid>/cwd` that it resolves to this worktree's `packages/lib` — a server started elsewhere silently serves the main tree's unfixed library. Open the `NumberSpinner` demo, press both spin buttons in each of the three shipped themes (modern, classic, dark), then open the Style Audit panel (`packages/lib/src/typescript/StyleAuditPanel.ts`, over `packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts`) and confirm the duplicated pressed box-shadow row is gone.

---

## Documentation Impact

No exported symbol changes: `ownStyleStates` is `protected static`, and `SpinButton`'s public surface, JSDoc, and `packages/lib/docs/components/SpinButton.md` are untouched. No barrel, `typedoc.json`, or `packages/lib/llms.txt` change.

Add one bullet to `packages/lib/docs/reference/changelog/next.md`, in the `## Fixed` → `### Components` list, immediately after the existing `NumberSpinner`-border entry ("…dedupe their border onto shared class rules…"), matching that entry's phrasing:

> - **`NumberSpinner`'s spin buttons now dedupe their pressed box-shadow onto a shared class rule instead of repeating it on every instance.** No consumer action is needed; nothing renders differently.

Every other purely-internal CSS dedup in this Style-Audit batch adds such an entry despite nothing rendering differently, so omitting one here would break with the batch's own precedent.

---

## Potential Challenges

- **Declaring only `.pressed` would silently break hover.** The list governs order as a whole, so a one-entry list drops `:hover` from `SpinButton`'s resolved states — narrowing the resting guard from `:not(.pressed):not(:hover)` to `:not(.pressed)` and losing the hover dedup. The declaration must include `Button.ownStyleStates[1]`. Row 3's `_ruleCacheHas` check plus `npm test` catch this.
- **Restating `:hover` by value instead of by index would create a redundant rule.** Reuse the exact `Button.ownStyleStates[1]` object rather than writing a fresh `{ selector: ":hover", extract: … }`; an extract that returns an equal-but-recomputed bag still resolves to the same declarations and inserts no rule, but copying `Button`'s extract body would duplicate a reference to `Button`'s module-private `_defaultButtonOptions`, which `SpinButton.ts` cannot see.
- **The two updated tests must be re-derived, not silenced.** Both currently assert real, correct behaviour; each needs its title and comment rewritten to describe the class-tier outcome, not just its `expect` flipped.

---

## Critical Files

| File | Why |
|---|---|
| [packages/lib/src/typescript/lib/component/input/SpinButton.ts](packages/lib/src/typescript/lib/component/input/SpinButton.ts) | The only source file this plan changes; `ownClassStyleDefaults` (71) and the constructor's `clearShadow`/`clearPressedShadow` block (99-108) |
| [packages/lib/src/typescript/lib/component/button/Button.ts](packages/lib/src/typescript/lib/component/button/Button.ts) | `ownStyleStates` (394-429) — the list being restated; `pressedShadow`'s default (237); `clearPressedShadow` (2584); `applyChromeOptions`'s pressed dispatch (1117) |
| [packages/lib/src/typescript/lib/component/button/TabButton.ts](packages/lib/src/typescript/lib/component/button/TabButton.ts) | `ownStyleStates` (177-197) — the exact precedent: restate one inherited entry by index, override another's content |
| [packages/lib/src/typescript/lib/component/container/Scrollbar.ts](packages/lib/src/typescript/lib/component/container/Scrollbar.ts) | `ScrollArrowButton.ownStyleStates` (180-185) and `ScrollbarThumb.ownStyleStates` (412-417) — the mechanism's two other current uses, and the shape of a single `{ selector, extract }` entry |
| [packages/lib/src/typescript/lib/component/button/ToggleButton.ts](packages/lib/src/typescript/lib/component/button/ToggleButton.ts) | `ownStyleStates` (63-73) — the spread form of the same restatement, and proof a subclass may read `Button.ownStyleStates` |
| [packages/lib/src/typescript/lib/core/ClassStyleRules.ts](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) | `resolveStateLevels` (696-762), `resolveStyleStates` (798), `buildResolvedStates` (828), `restingGuardSuffix` (864) — order-vs-content semantics and the parent-first rule insertion this plan rests on |
| [packages/lib/src/typescript/lib/core/Component.ts](packages/lib/src/typescript/lib/core/Component.ts) | `writeStateStyle` (5221), `flushStateStyleBag` (5492), `restingIsolationKeys` (5572) — the dedup comparison that turns the constructor's write into a removal |
| [ARCHITECTURE.md](ARCHITECTURE.md) | *Component CSS tiers and state-rule dedup* (284-294) and *The class tier is hierarchy-aware* (296-300) — the governing rules, and the two lines step 4 edits |
| [plans/implemented/state-tier-full-unification.md](plans/implemented/state-tier-full-unification.md) | The plan that produced the current `ownStyleStates` mechanism |
| [plans/implemented/numberspinner-spinbutton-dedup.md](plans/implemented/numberspinner-spinbutton-dedup.md) | The prior `SpinButton` dedup; introduced `SpinButtonUp`/`SpinButtonDown`, whose inheritance row 5 pins |
| [packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts](packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts) | The two stale assertions (144, 151), the stale header prose (31-36), and the `declarationsDuring`/`idSelector` helpers step 3 copies |

---

## Non-Goals

- **Hoisting `SpinButton`'s *resting* `box-shadow: none` to the class tier.** `clearShadow()` has no representable option value — it writes `box-shadow: none` *and* sets `_options.shadow = undefined`, unlike `setShadow("none")` — so it cannot ride in `_defaultSpinButtonOptions`, as that constant's own doc comment already records. A separate problem with a different fix.
- **Removing the constructor's `clearPressedShadow()` call.** Deleting it would make `new SpinButton("▲", { shadow: … })` lose its pressed shadow — see `## Architecture Decisions`.
- **The `min`/`max`-size duplicate rows** `numberspinner-spinbutton-dedup.md` investigated and deliberately left per-instance. Unchanged here.
- **Touching `NumberSpinner.ts`.** `SpinButtonUp`/`SpinButtonDown` inherit the new declaration with no source change; row 5 verifies that.
- **Bumping the package version.** Release-time bookkeeping.

---

## Notes

[^order-is-whole-list]: `ownStyleStates` splits into two different rules for order and for content, and only the content half is inherited. `resolveStyleStates` ([ClassStyleRules.ts:798](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L798)) walks up the prototype chain to the *nearest* class with an own-property `ownStyleStates` and takes that class's entire list as the order for the whole subtree — it never merges lists. `guardedSuffixFor` ([:629](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L629)) then derives each entry's `:not(...)` chain from its index in that one list, and `restingGuardSuffix` ([:864](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L864)) joins every entry into the resting tier's own guard. A `SpinButton` list holding only `.pressed` would therefore resolve `SpinButton`'s states as `[.pressed]`, drop `:hover`'s class-tier layer and its dedup, and shrink the resting guard to `:not(.pressed)` — letting a per-instance resting write outrank `.Button:hover:not(.pressed)` again. Content, by contrast, *is* per-level: `resolveStateLevels` ([:696](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L696)) recurses to the parent, overlays this level's `extract` result on the parent's authored bag, and inserts a rule only for the delta — which is why the `.pressed` entry needs to name `shadow` alone.

[^precedent-search]: The search covered every current `ownStyleStates` declaration (`grep -rln 'static readonly ownStyleStates' packages/lib/src/typescript` — 22 files) and read the ones in the `Button` family plus `Scrollbar`'s two delegates. Three shapes exist: a new state declared on a class whose ancestors declare none (`ScrollArrowButton`'s `.disabled`, `ScrollbarThumb`'s `.hover`); an inherited list spread and appended to (`ToggleButton` = `[...Button.ownStyleStates, .selected]`); and an inherited list restated entry-by-entry with one or more entries' content replaced (`TabButton` = `[ToggleButton.ownStyleStates[0], own :hover, own .selected]`). This plan needs the third — an override of an inherited entry's content, not a new state — so it follows `TabButton`. No new pattern is introduced.

[^keep-the-clear-call]: `clearPressedShadow()` is not "clear the pressed shadow"; it pins the pressed shadow to the button's *current resting* shadow, falling back to `"none"` ([Button.ts:2584](packages/lib/src/typescript/lib/component/button/Button.ts#L2584): `writeStateStyle(".pressed", { shadow: this.getShadow() ?? "none" })`). For a default `SpinButton` the preceding `clearShadow()` leaves no resting shadow, so it resolves to `"none"` — which is why a class-tier `"none"` dedupes it away. But `SpinButton`'s constructor skips `clearShadow()` when the caller passed `options.shadow`, and in that case `clearPressedShadow()` pins the caller's value instead. Deleting the call would leave such an instance resolving its pressed shadow from the shared `"none"` class rule, a silent behaviour change. Keeping the call costs nothing: `flushStateStyleBag` compares each pending key against the class-tier bag and queues `null` on a match, and a rule holding only `null` removals is never inserted (`ARCHITECTURE.md`, *Defer DOM work to render time*).

[^no-ordering-hazard]: The concern worth ruling out is a rule being published mid-`super()`-cascade, before the declaring class's own statics are usable. It does not arise. Static class fields are initialized when the class is *defined*, long before any instance is constructed, so `SpinButton.ownStyleStates` is readable from the first `resolveStyleStates(SpinButton)` call regardless of where in the constructor cascade that call lands. That call happens inside `Button`'s constructor, via `applyChromeOptions` → `setPressedShadow(… ?? this.getPressedShadow()!)` → `resolveStateStyleValue` → `classStateLayer` → `resolveStyleStates(this.constructor)`; `Button.pressedHoverClassHoisting.test.ts`'s own comment at line 154 records that `.Button.pressed` already materializes at exactly that point today. The one visible consequence is benign: `getPressedShadow()` on a mid-construction `SpinButton` now resolves `"none"` from the class layer rather than `Button`'s token, so `applyChromeOptions` writes `"none"` — the same value `clearPressedShadow()` writes moments later, and the same value `getPressedShadow()` returns today once the constructor finishes (row 6).

[^new-file-needed]: Class-tier rules are process-module state: they are created once, on the first render that resolves them, and survive `DOM.reset()` between tests within a file — `ClassStyleRules.test.ts`, `SpinButton.test.ts`, and `Button.pressedHoverClassHoisting.test.ts` all carry a header comment about this. A `declarationsDuring` capture of `.SpinButton.pressed`'s body therefore only records anything if it wraps the very first `SpinButton` construction in its file. `Button.pressedHoverClassHoisting.test.ts` already constructs `SpinButton`s in two tests, so row 1 cannot be added there without reordering that file's existing cases.
