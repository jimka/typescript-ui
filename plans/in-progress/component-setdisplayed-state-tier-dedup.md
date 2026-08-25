---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/component/container/Scrollbar.ts
  - ARCHITECTURE.md
  - packages/lib/docs/reference/changelog/next.md
---

# Component `setDisplayed` State-Tier Dedup — Implementation Plan

## Overview

[`Component.setDisplayed`](packages/lib/src/typescript/lib/core/Component.ts#L2140) unconditionally calls `this.writeStyle({ displayed: v })`, so every undisplayed component writes its own per-instance `#id { display: none; }` rule. A live Style Audit scan ([`packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts`](packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts)) counted 19 instances repeating that one declaration body at the time of the scan — `Legend` and `ListItemMarkerText` (both `Text` subclasses, hidden by [FieldSet.ts:60](packages/lib/src/typescript/lib/component/container/FieldSet.ts#L60) and [ListItem.ts:194](packages/lib/src/typescript/lib/component/list/ListItem.ts#L194) when their text is empty), `ToolBar`'s overflow-trigger `Button` ([ToolBar.ts:388](packages/lib/src/typescript/lib/component/menubar/ToolBar.ts#L388)), and `Filter`'s operator `MenuButton` ([Filter.ts:272](packages/lib/src/typescript/lib/component/table/cell/Filter.ts#L272)).

This plan gives `Component` a second root-declared state, `.undisplayed`, and reroutes the base `setDisplayed`/`isDisplayed` through it — the same move [`component-setvisible-state-tier-dedup.md`](plans/implemented/component-setvisible-state-tier-dedup.md) already made for `setVisible`/`isVisible` and `.invisible` ([Component.ts:423-428](packages/lib/src/typescript/lib/core/Component.ts#L423-L428), [:2027-2092](packages/lib/src/typescript/lib/core/Component.ts#L2027-L2092)). `Scrollbar` already runs exactly this design class-scoped ([Scrollbar.ts:508-513](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L508-L513), [:768-809](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L768-L809)); hoisting it to the root makes `Scrollbar`'s copy redundant, so this plan deletes it.

Four non-test files change: `core/Component.ts` (the declaration plus the two accessors), `component/container/Scrollbar.ts` (deletions only), `ARCHITECTURE.md`, and the changelog. No new mechanism is introduced — the `stateRuleName` root-naming fix the `.invisible` work added to `core/ClassStyleRules.ts` ([:654-663](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L654-L663)) already covers a second root-declared state with no edit.

---

## Architecture Decisions

### `setDisplayed` routes through a root-declared `.undisplayed` state

`Component.ownStyleStates` gains a `.undisplayed` entry whose `extract` returns `{ displayed: false }`. `setDisplayed(false)` calls `this.setStyleState(".undisplayed", true)` instead of `this.writeStyle({ displayed: false })`; `setDisplayed(true)` clears the state and keeps writing through `writeStyle`. This mirrors `Component`'s own `.invisible` entry and `Scrollbar`'s existing class-scoped `.undisplayed`, both cited above — no new pattern.[^root-naming-already-fixed]

### `.undisplayed` is declared **before** `.invisible`

The two entries are declared in the order `[.undisplayed, .invisible]`. `guardedSuffixFor` ([ClassStyleRules.ts:629](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L629)) guards each entry against every entry ahead of it, so declaration order decides which rule applies when a component is hidden *and* undisplayed at once.[^order-choice]

| Active tokens | `.ts-ui-component.undisplayed` | `.ts-ui-component.invisible:not(.undisplayed)` | Painted result |
|---|---|---|---|
| `undisplayed` only | matches | — | `display: none` |
| `invisible` only | — | matches | `visibility: hidden` |
| both | matches | does not match | `display: none` |

`display: none` already removes the element entirely, so the both-active row loses nothing by suppressing `visibility: hidden`. Declared the other way round, the both-active row would apply `visibility: hidden` **without** `display: none`, leaving the element in the DOM box tree and still contributing to an ancestor's scroll extents.

The three selectors this ordering produces. The latter two are named verbatim in existing test assertions, which step 4 updates:

| Selector | Before this plan | After |
|---|---|---|
| The shared undisplayed rule | *(did not exist at the root)* | `.ts-ui-component.undisplayed` |
| The shared invisible rule | `.ts-ui-component.invisible` | `.ts-ui-component.invisible:not(.undisplayed)` |
| A non-state-declaring class's resting-isolated rule | `#id:not(.invisible)` | `#id:not(.undisplayed):not(.invisible)` |

### `isDisplayed()` reads `_activeStates` directly

`isDisplayed()` checks `this._activeStates.has(".undisplayed")` first and only then falls back to its current `resolveStyleValue("displayed") ?? this._defaultOptions.displayed` expression. This is the same direct read `isVisible()` uses for `.invisible`, and for the same reason: `ownStyleStates` is a whole-list override, so a class declaring its own list (`Button`, `Row`, `TreeRow`, and every other class with a `static readonly ownStyleStates` of its own) never resolves `Component`'s entries and `styleLayers()` never pushes the `.undisplayed` layer for it.[^direct-read-is-mandatory] No instance-level cache field is added.

### The hide leg never writes `_instanceStyle.displayed`, so the idempotency check moves to `isDisplayed()`

`setDisplayed(false)` calls only `setStyleState`; it does not call `writeStyle`. The existing guard `this._instanceStyle.displayed === v` therefore becomes stale and is replaced by `this.isDisplayed() === v`, matching `Scrollbar`'s current override and `Component.setVisible`'s own shape.[^stale-idempotency-trace]

### `display` is already in `SKIP_ON_MATCH_KEYS`, so this hoist costs nothing new

`SKIP_ON_MATCH_KEYS` ([Component.ts:386-393](packages/lib/src/typescript/lib/core/Component.ts#L386-L393)) contains `"display"`. Confirmed by reading the set, not assumed. In `flushStyleBag` ([Component.ts:5412](packages/lib/src/typescript/lib/core/Component.ts#L5412)) a pending key that the instance never authored **and** that is in `SKIP_ON_MATCH_KEYS` is skipped with `continue` — before the resting-isolation branch at [:5470](packages/lib/src/typescript/lib/core/Component.ts#L5470) that allocates `restingStyleRule`.

Concretely, three things follow, and the implementer should not add work for any of them:

- A component that never calls `setDisplayed` emits no per-instance `display` declaration and allocates no `restingStyleRule` on `display`'s account, on any render pass. `visibility` is not in `SKIP_ON_MATCH_KEYS`, which is why the `.invisible` hoist carried a universal per-instance allocation cost and this one does not.
- `isRestingChromeIsolated()` is *already* `true` for every class because of `.invisible`, so adding a second state flips nothing. Only the guard suffix gets longer.
- Adding `display` to `restingIsolationKeys()` ([Component.ts:5619](packages/lib/src/typescript/lib/core/Component.ts#L5619)) is what keeps a genuine `display` override off the bare `#id` rule, where an id selector would outrank the shared `.ts-ui-component.undisplayed` rule. That protection is free and needs no code.[^no-class-outranks-the-shared-rule]

### `Scrollbar`'s own `.undisplayed` declaration and both overrides are deleted

`Scrollbar.ownStyleStates`, `Scrollbar.isDisplayed`, and `Scrollbar.setDisplayed` are removed. `Scrollbar` declares no state other than `.undisplayed`, so the whole-list-override concern does not apply to it, and once the base class carries the identical implementation the three members are code this change itself orphans.[^scrollbar-delete] `ScrollArrowButton` and `ScrollbarThumb` in the same file keep their own declarations, untouched.

### Folding a property-disjoint state into `ownStyleStates` is a deliberate, documented exception

[ARCHITECTURE.md](ARCHITECTURE.md)'s state-tier section says a state sharing no CSS property with the class's other declared states should stay out of `ownStyleStates` and take an unguarded shared rule via `ensureSharedStateRule` instead, because `guardedSuffixFor` would otherwise suppress an unrelated state's whole rule whenever both are active. `.undisplayed` (`display`) and `.invisible` (`visibility`) are property-disjoint, so this plan is an exception to that guidance and says so in `ARCHITECTURE.md` itself. The suppression is harmless here — `display: none` strictly dominates the effect of the `visibility: hidden` it suppresses — and `ensureSharedStateRule` cannot produce one shared rule for all classes, because `ensureClassStateRule` ([ClassStyleRules.ts:1045-1080](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L1045-L1080)) keys its rule on `ctor.name`.[^why-not-shared-state-rule]

---

## Internal Structure

### `core/Component.ts` — the declaration

Replace the existing single-entry `ownStyleStates` array ([Component.ts:423-428](packages/lib/src/typescript/lib/core/Component.ts#L423-L428)) with a two-entry array. Keep the existing comment block above it and extend it; `.undisplayed` goes **first**.

```typescript
    // The two states Component itself declares — see ARCHITECTURE.md's
    // "Component CSS tiers and state-rule dedup". setDisplayed(false) and
    // setVisible(false) toggle these instead of writing a per-instance
    // `display: none` / `visibility: hidden` declaration. Declared on the
    // root class, not a concrete leaf — see the `stateRuleName` fix in
    // ClassStyleRules.ts this relies on. A subclass that declares its own
    // `ownStyleStates` (a whole-list override, see ARCHITECTURE.md) does not
    // inherit these entries and is not required to restate them — see the
    // `_activeStates` direct-reads in `isDisplayed()` / `isVisible()` below.
    //
    // `.undisplayed` is first deliberately: `guardedSuffixFor` guards every
    // entry against the ones ahead of it, so a component that is both
    // undisplayed and invisible resolves `display: none` (which subsumes
    // `visibility: hidden`) rather than the other way round.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".undisplayed",
            extract: (): StyleBag => ({ displayed: false }),
        },
        {
            selector: ".invisible",
            extract: (): StyleBag => ({ visible: false }),
        },
    ];
```

### `core/Component.ts` — `setDisplayed` and `isDisplayed`

`setDisplayed` ([Component.ts:2140-2153](packages/lib/src/typescript/lib/core/Component.ts#L2140-L2153)) — JSDoc above it is unchanged; only the body changes:

```typescript
    setDisplayed(value: boolean): this {
        const v = !!value;

        // Compares against `isDisplayed()`, not `_instanceStyle.displayed`:
        // the `false` leg below deliberately never caches into
        // `_instanceStyle`, so that field goes stale after the first
        // hide→show→hide sequence and would make a later show silently
        // no-op. See `## Architecture Decisions`.
        if (this.isDisplayed() === v && this.getElement()) {
            return this;
        }

        // Route the CSS side through the shared
        // `.ts-ui-component.undisplayed` class-tier rule instead of a
        // per-instance `#id` declaration. `_instanceStyle` is deliberately
        // left untouched on the `false` branch — caching it there would make
        // a later full-sweep re-render treat it as a genuine per-instance
        // override again, reproducing the exact duplicate rule this change
        // removes.
        this.setStyleState(".undisplayed", !v);

        if (v) {
            this.writeStyle({ displayed: true });
        }

        if (this.getElement()) {
            this.scheduleEffectiveVisibilityReconcile();
        }

        return this;
    }
```

`isDisplayed` ([Component.ts:2164-2166](packages/lib/src/typescript/lib/core/Component.ts#L2164-L2166)) — JSDoc unchanged, one branch added:

```typescript
    isDisplayed(): boolean {
        // `.undisplayed` is read from `_activeStates` directly rather than
        // through `resolveStyleValue`'s layer walk: a subclass that declares
        // its own `ownStyleStates` (Button, Row, TreeRow, ...) does not
        // inherit Component's `.undisplayed` entry into its own resolved
        // list, so `styleLayers()` never pushes that layer for such an
        // instance. The shared CSS rule still applies regardless (it matches
        // on the universal `ts-ui-component` token, not the concrete class
        // name) — this check only keeps the *getter* correct uniformly
        // across every subclass.
        if (this._activeStates.has(".undisplayed")) {
            return false;
        }

        return (this.resolveStyleValue("displayed") ?? this._defaultOptions.displayed) as boolean;
    }
```

Nothing else in `Component.ts` changes. `init()`'s render-time class-token catch-up ([Component.ts:6921-6924](packages/lib/src/typescript/lib/core/Component.ts#L6921-L6924)) already sweeps every entry in `_activeStates`, so a `.undisplayed` toggled before first render (`new Component({ displayed: false })`, `HiddenFileInput`'s constructor, `ToolBar`'s overflow trigger) is caught up with no edit.

### `component/container/Scrollbar.ts` — deletions

Delete three members and nothing else:

- `Scrollbar.ownStyleStates` ([Scrollbar.ts:508-513](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L508-L513)).
- `Scrollbar.isDisplayed` ([Scrollbar.ts:768-781](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L768-L781)), JSDoc included.
- `Scrollbar.setDisplayed` ([Scrollbar.ts:783-809](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L783-L809)), JSDoc included.

`setMetrics`'s `this.setDisplayed(overflow)` call ([Scrollbar.ts:828](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L828)) stays. The `StyleBag` / `StyleStateSpec` imports stay — `ScrollArrowButton` ([:180](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L180)) and `ScrollbarThumb` ([:412](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L412)) still use both.

### `ARCHITECTURE.md` — two sentences

In the *Component CSS tiers and state-rule dedup* section:

- Line 292's enumeration of state-declaring classes reads ``…`Component` itself (`.invisible`), and `Scrollbar` (`.undisplayed`) are the components that declare states today.`` Change it to ``…and `Component` itself (`.undisplayed`, `.invisible`) are the components that declare states today.`` — `Scrollbar` no longer declares any.
- Line 294 states the property-disjoint carve-out. Append a sentence recording the exception: `Component`'s own `.undisplayed` and `.invisible` are property-disjoint yet share one `ownStyleStates` list, because `.undisplayed` is declared first and `display: none` subsumes the `visibility: hidden` its guard suppresses — and because `ensureSharedStateRule` keys its rule on `ctor.name`, which cannot produce one rule shared by every class.

### `packages/lib/docs/reference/changelog/next.md` — amend the existing entry

The second `## Changed` → `### Core` list already carries the `setVisible`/`Scrollbar` dedup bullet (lines 308-315), which names `Scrollbar`'s overflow-driven `setDisplayed` as the scope of the `.undisplayed` half. Widen that bullet rather than adding a second one: `setDisplayed(false)` now shares the class-tier rule for **every** component, not only `Scrollbar`. Keep the bullet's existing "The rendered result is unchanged. No consumer action is needed." closing.

---

## Ordered Implementation Steps

1. **`core/Component.ts`: add the `.undisplayed` entry, first, to `ownStyleStates`.** Per `## Internal Structure`.
   *Check:* `npm run typecheck` from `packages/lib`.

2. **`core/Component.ts`: rewrite `isDisplayed()` and `setDisplayed()`.** Per `## Internal Structure`. `isDisplayed` first, since `setDisplayed`'s new guard calls it.
   *Check:* `npm run typecheck`.

3. **`component/container/Scrollbar.ts`: delete `Scrollbar.ownStyleStates`, `Scrollbar.isDisplayed`, and `Scrollbar.setDisplayed`.** Per `## Internal Structure`.
   *Check:* `grep -n "^    \(set\|is\)Displayed" packages/lib/src/typescript/lib/component/container/Scrollbar.ts` — expect zero matches (both overrides gone). `grep -n "static readonly ownStyleStates" packages/lib/src/typescript/lib/component/container/Scrollbar.ts` — expect exactly two, `ScrollArrowButton`'s and `ScrollbarThumb`'s. `grep -n "setDisplayed(overflow)" packages/lib/src/typescript/lib/component/container/Scrollbar.ts` — expect one. Then `npm run typecheck`.

4. **Update the six existing test files whose assertions name a selector this change moves.** Mechanical; the new selectors are in `## Architecture Decisions`' second table. Paths below are relative to `packages/lib`.
   - `tests/core/StyleStates.test.ts:241` and `:263` — `_ruleCacheHas('.ts-ui-component.invisible')` → `_ruleCacheHas('.ts-ui-component.invisible:not(.undisplayed)')`.
   - `tests/core/ComponentDispose.test.ts:67` — `INVISIBLE_STATE_SELECTOR` → `'.ts-ui-component.invisible:not(.undisplayed)'`; add a sibling `UNDISPLAYED_STATE_SELECTOR = '.ts-ui-component.undisplayed'` and include it in `leakedKeys`' exclusion list, with the same comment rationale the existing constant carries.
   - `tests/core/TextDispose.test.ts:73` — same two selectors in that file's inline exclusion filter; update the comment at `:66` too.
   - `tests/component/input/TextClassStyleHoisting.test.ts:175` and `:193`, `tests/component/input/TextTruncateWritePath.test.ts:118` and `:131`, `tests/core/ClassChromeRules.test.ts:262` and `:296` — `idSelector(x) + ':not(.invisible)'` → `idSelector(x) + ':not(.undisplayed):not(.invisible)'`. Update the neighbouring comments that spell the old selector out.
   *Check:* from `packages/lib`, `npx vitest run tests/core/StyleStates.test.ts tests/core/ComponentDispose.test.ts tests/core/TextDispose.test.ts tests/component/input/TextClassStyleHoisting.test.ts tests/component/input/TextTruncateWritePath.test.ts tests/core/ClassChromeRules.test.ts`.

5. **Add the new tests.** See `## Expected Behaviour` and `## Verification` for the cases and target files.
   *Check:* `npx vitest run` on each touched file.

6. **`ARCHITECTURE.md`: update the state-declaring-class enumeration and record the property-disjoint exception.** Per `## Internal Structure`.
   *Check:* `grep -n "declare states today" ARCHITECTURE.md` — confirm `Scrollbar` no longer appears as a declaring class and `Component` names both states.

7. **`packages/lib/docs/reference/changelog/next.md`: widen the existing dedup bullet.** Per `## Internal Structure`.
   *Check:* `grep -n "undisplayed" packages/lib/docs/reference/changelog/next.md` — confirm the bullet no longer scopes the `display` half to `Scrollbar` alone.

8. **Full verification, then the manual browser check.** See `## Verification`. Running the whole suite is where any remaining rule-cache-diffing test that now sees `.ts-ui-component.undisplayed` as a false-positive leak will surface; fix each by adding the selector to that file's own exclusion list, the same way `.invisible` is already excluded — never by loosening the leak assertion itself.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/tests/core/StyleStates.test.ts` |
| Modify | `packages/lib/tests/core/ComponentDispose.test.ts` |
| Modify | `packages/lib/tests/core/TextDispose.test.ts` |
| Modify | `packages/lib/tests/core/ClassChromeRules.test.ts` |
| Modify | `packages/lib/tests/component/input/TextClassStyleHoisting.test.ts` |
| Modify | `packages/lib/tests/component/input/TextTruncateWritePath.test.ts` |
| Modify | `packages/lib/tests/component/container/Scrollbar.test.ts` |
| Modify | `packages/lib/tests/component/EffectiveVisibility.test.ts` |

---

## Expected Behaviour

Rows 1-9 are unit-testable against the recording DOM sink (`installTestDOM` / `RecordingDOMSink`, `packages/lib/tests/dom/TestDOM.ts`). Row 10 needs a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | A rendered, displayed `Component`, then `setDisplayed(false)` | Element gains the `undisplayed` class; **no** `display` declaration lands on this instance's own `#id` rule (assert with `declarationsDuring` + `idSelector`, as `StyleStates.test.ts` rows 3-4 do for `visibility`) |
| 2 | Two separate `Component` instances, both undisplayed | `_ruleCacheHas('.ts-ui-component.undisplayed')` is `true`; neither instance's `#id` rule carries a `display` declaration |
| 3 | `new Component({ displayed: false })`, never rendered | `isDisplayed()` returns `false` |
| 4 | Same, then `getElement(true)` | Element's classList contains `undisplayed`; `isDisplayed()` still `false` (this is `init()`'s existing catch-up sweep) |
| 5 | `setDisplayed(true)` after `setDisplayed(false)` | `undisplayed` class removed; `isDisplayed()` returns `true`; no real `display` declaration written to the bare `#id` rule |
| 6 | A class declaring its own `ownStyleStates` without restating `.undisplayed` — `new Button('x', { displayed: false })` | `isDisplayed()` returns `false`; once rendered the element carries the `undisplayed` class and `_ruleCacheHas('.ts-ui-component.undisplayed')` is `true` — hidden at both the getter and the CSS level, with no restatement |
| 7 | A component that is both undisplayed and invisible — `setDisplayed(false)` then `setVisible(false)` | `isDisplayed()` is `false` and `isVisible()` is `false`; both class tokens are on the element; `_ruleCacheHas('.ts-ui-component.undisplayed')` and `_ruleCacheHas('.ts-ui-component.invisible:not(.undisplayed)')` are both `true` (pins the declaration order from `## Architecture Decisions`) |
| 8 | Same component, then `setDisplayed(true)` while still invisible | `isDisplayed()` is `true`, `isVisible()` stays `false`, the `undisplayed` token is removed and the `invisible` token remains — so the invisible rule starts matching again |
| 9 | `Scrollbar.setMetrics` overflow `true → false → true → false` (the existing row-9 test in `Scrollbar.test.ts`) | Unchanged assertions all still pass against the inherited base implementation: each transition flips `isDisplayed()`, no `display` declaration reaches the scrollbar's bare `#id` rule, and `onEffectiveVisibilityChange` fires once per real transition |
| 10 | Manual: dev server, open a `Table` / `Tree` / scrolling `Panel`, a `FieldSet` with and without a title, and a `ToolBar` narrow enough to overflow; open the Style Audit panel | No `{ display: none; }` duplicate row remains; the scrollbar, legend, and overflow trigger appear and disappear exactly as before |

Row 9 is a regression check on an existing test, not a new one — keep the test, and update its header comment to say it now exercises the base `Component` implementation that `Scrollbar` inherits.

---

## Verification

```
npm run typecheck       # packages/lib
npm run typecheck:test
npm test                # vitest run, includes typecheck:test
npm run lint
```

New unit tests (row numbers refer to `## Expected Behaviour`):

- `packages/lib/tests/core/StyleStates.test.ts` — rows 1, 2, 6, 7, 8. This file already has the `idSelector` / `declarationsDuring` / `touchesToken` helpers and a `Component.setVisible routes through the shared .invisible class-tier rule` describe block to sit beside; extend rather than duplicate.
- `packages/lib/tests/component/EffectiveVisibility.test.ts` — rows 3, 4, 5, plus one case confirming `isEffectivelyVisible()` still returns `false` for a component undisplayed through the new path.
- `packages/lib/tests/component/container/Scrollbar.test.ts` — row 9, existing test retained with an updated comment.

Also assert once, anywhere in `StyleStates.test.ts`, that a plain `Component` that never calls `setDisplayed` queues no `display` declaration on its own `#id` rule across a first render — the concrete consequence of `display` being in `SKIP_ON_MATCH_KEYS`, and the check that would catch a regression if that set ever changed.

**Manual browser verification (row 10) is required**, per this codebase's convention for state-tier changes — the offline harness has no cascade. Start a dev server on a spare port *from this worktree* and confirm with `readlink /proc/<pid>/cwd` that it serves this worktree's `packages/lib`, not the main tree's. Exercise the Style Audit panel (`packages/lib/src/typescript/StyleAuditPanel.ts`, wired into the demo app) before and after toggling scrollbar overflow, a `FieldSet` title, and `ToolBar` overflow.

---

## Documentation Impact

`setDisplayed`/`isDisplayed`'s public signatures and documented behaviour are unchanged, so no `docs:api` re-run beyond the standard `npm test` / `typecheck` gate is needed. The only documentation edits are `ARCHITECTURE.md` and the changelog widening, both specified in `## Internal Structure`.

---

## Potential Challenges

- **A silent failure mode if the declaration order is reversed.** With `.invisible` first, everything still typechecks and every single-state test still passes; only the both-active case (row 7) misbehaves, and only visually. Row 7's `_ruleCacheHas('.ts-ui-component.invisible:not(.undisplayed)')` assertion is what pins the order mechanically — write it before the source change.
- **Rule-cache leak-detection tests across the suite.** `.ts-ui-component.undisplayed` is created eagerly on the first render of any component, like every other class-tier rule, so a test that diffs the rule cache around a dispose can read it as a leak. Two files already exclude `.invisible` this way and are named in step 4; step 8's full-suite run is what finds any others.
- **A future class that defaults `displayed: false` *and* declares its own `ownStyleStates`.** Such a class would write a real `display: block` on `setDisplayed(true)`, onto a bare `#id` rule that outranks the shared `.ts-ui-component.undisplayed` rule — leaving it stuck visible. `HiddenFileInput` ([FileField.ts:44](packages/lib/src/typescript/lib/component/input/FileField.ts#L44)) is the only class defaulting `displayed: false` today and it declares no states, so the combination does not exist.[^no-class-outranks-the-shared-rule] The `ownStyleStates` declaration site comment is where to warn the next person; that comment is in `## Internal Structure`'s snippet.

---

## Critical Files

| File | Why |
|---|---|
| [`plans/implemented/component-setvisible-state-tier-dedup.md`](plans/implemented/component-setvisible-state-tier-dedup.md) | The direct precedent — same move, same file, for `setVisible`/`.invisible`. Read its Architecture Decisions before starting |
| [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) | `SKIP_ON_MATCH_KEYS` (386-393), `ownStyleStates` (423-428), `isVisible`/`setVisible` (2027-2092), `setDisplayed`/`isDisplayed` (2140-2166), `styleLayers` (5001-5019), `flushStyleBag` (5395-5490), `isRestingChromeIsolated`/`restingIsolationKeys` (5605-5629), `setStyleState`/`isStyleState` (5653-5705), `init`'s catch-up sweep (6913-6924) |
| [`packages/lib/src/typescript/lib/component/container/Scrollbar.ts`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts) | The class-scoped `.undisplayed` this plan hoists and then deletes (508-513, 768-809); `ScrollArrowButton`/`ScrollbarThumb`'s declarations (178-200, 411-420) stay |
| [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) | `guardedSuffixFor` (629-637), `stateRuleName` (654-663), `resolveStateLevels` (696-761), `resolveStyleStates` (798-824), `restingGuardSuffix` (864-866), `ensureClassStateRule` (1045-1080), and the `displayed` → `display` extractor (278). Read-only for this plan — no edit is needed here |
| [ARCHITECTURE.md](ARCHITECTURE.md), *Component CSS tiers and state-rule dedup* | The governing rule, including the property-disjoint carve-out this plan takes an exception to; also the file step 6 edits |
| [`packages/lib/tests/core/StyleStates.test.ts`](packages/lib/tests/core/StyleStates.test.ts) | The helper conventions (`idSelector`, `declarationsDuring`, `touchesToken`) and the `.invisible` describe block the new cases sit beside |
| [`packages/lib/tests/component/container/Scrollbar.test.ts`](packages/lib/tests/component/container/Scrollbar.test.ts) | The existing row-9 hide→show→hide→show regression test (605-676) that must keep passing against the inherited implementation |

---

## Non-Goals

- **No change to any `setDisplayed` call site** — they live in `FileField`, `Accordion`, `ListItem`, `AccordionHeader`, `FieldSet`, `VirtualRowView`, `Filter`, `ToolBar`, `Rail`, `AbstractWindow`, and `Scrollbar.setMetrics` (`grep -rn "setDisplayed(" packages/lib/src/typescript/lib/`). They call the same public method; nothing about their own code changes.
- **No restatement of `.undisplayed` in any class that declares its own `ownStyleStates`** — unnecessary by construction, for the same two structural reasons the `.invisible` work established: the getter reads `_activeStates`, and the shared rule matches on the universal `ts-ui-component` token.
- **No change to `core/ClassStyleRules.ts`.** `stateRuleName` already handles a root-declared state, and `resolveStyleStates`' walk already checks `_rootCtor` before terminating.
- **No revert of `scheduleEffectiveVisibilityReconcile` to `private`.** It was widened to `protected` for `Scrollbar`'s override, which this plan deletes, but narrowing it back is an unrelated edit to a method `Component`'s own setters use.
- **No change to `flushStyleBag`, `SKIP_ON_MATCH_KEYS`, `restingIsolationKeys`, or `isRestingChromeIsolated`** — the design works with all four exactly as they are.

---

## Implementation Notes

**Two test files outside the plan's "Files to Create/Modify/Delete" table needed updates: `tests/core/InstanceStyleLayer.test.ts` and `tests/component/table/Body.test.ts`.** Both pinned `setDisplayed`'s *old* `writeStyle`-based hide path, which wrote a real per-instance `display: none` onto the bare `#id` rule and required an explicit `null` removal to clear it on show — the exact bug `ece94bac` ("Fix pooled rows getting stuck display:none after a scroll recycle") fixed and both tests were written to pin.

Under this plan's design, `setDisplayed(false)` never writes `_instanceStyle` at all (only `setStyleState(".undisplayed", true)`), so the later `setDisplayed(true)`'s `writeStyle({ displayed: true })` call is the *first* time `display` is ever queued for that instance. Since the queued value matches the class default, it resolves to a `null`-only batch onto a rule (`restingStyleRule` for a plain `Component`, whose `restingIsolationKeys()` now includes `display`; the bare `#id` rule otherwise, e.g. `Row`) that was never previously materialised — and `StyleTarget`'s "an all-null batch never materialises a rule" behaviour means **no CSS write happens for `display` at all**, on any selector. Both tests' original assertion (`declarations.display` equals `null` on the bare `#id` selector) therefore fails: not because the underlying bug reappeared, but because the class of bug is now structurally impossible — there is no per-instance `display` declaration left to go stale in the first place, so there is nothing to explicitly clear.

Both tests were updated in place (same file, same describe block, comments rewritten to explain the new mechanism) to assert the new observable instead: the `undisplayed` DOM class token is removed on show, `isDisplayed()`/`row.isDisplayed()` returns `true` afterward, and — for `InstanceStyleLayer.test.ts`, which has direct access to the write log — that no `setRuleStyles` write touching `display` happens at all. This preserves each test's original regression-guard intent (a pooled row hidden then re-shown must actually become visible) while asserting the mechanism this plan actually produces.

**Live browser verification (`## Ordered Implementation Steps` step 8 / `## Expected Behaviour` row 10 / `## Verification`'s manual row) was performed.** A dev server was started from `packages/lib` in this worktree on a spare port (8091), confirmed via `readlink /proc/<pid>/cwd` to resolve to this worktree's `packages/lib`. Navigated to `#/toolbar`, resized the page to 500px wide to force `ToolBar`'s overflow-trigger `Button` to appear, clicked it to confirm the overflow menu opens correctly, then resized back to 1400px to confirm the trigger button disappears again — exercising `setDisplayed(true)`/`setDisplayed(false)` live. Opened `#/misc`'s "Show window with table (slow)!" window and confirmed its vertical `Scrollbar` renders and scrolls correctly (the inherited base `setDisplayed`/`isDisplayed` `Scrollbar` now uses). Visited `#/marker-lists` and confirmed the "none" `NumberedListItemStyle` column renders with no visible marker glyph — the `ListItemMarkerText` undisplayed-on-empty path. Finally opened the Style Audit panel (clicking between tabs in-page, not via direct hash navigation, so components stayed mounted) and clicked Refresh: the resulting 379-rule scan (up from the panel's own 149-rule cold-load baseline) contains no `{ display: none; }` duplicate-body row anywhere in the dedup table, confirming rows 1/2/6's no-per-instance-duplicate claim live, not only under the offline harness.

A second dev-server pass (port 8092, `readlink` again confirmed against this worktree) covered the one remaining case: `FieldSet`'s empty-title `Legend`. `#/binding` (`BindingPanel.ts`'s "Empty-title notch collapse demo", an untitled `LabeledFieldSet` around the `Note` field) was screenshotted at both default and a tall/narrow viewport — its top border renders continuous, with no title-shaped notch, unlike the titled `Information`/`Address`/`File inputs` fieldsets above it in the same screenshot. `document.querySelectorAll('*')` filtered for any element whose `className` contains `"undisplayed"` found `<legend class="ts-ui-component Text Legend undisplayed">` for this fieldset's `Legend`, alongside the two `HiddenFileInput`s and both `Scrollbar`s on the page — confirming the token reaches the DOM for the `Legend` case specifically, not just inferred from the border rendering. The Style Audit panel, refreshed on this same page load (116 total rules), again showed no `{ display: none; }` duplicate-body row. Both dev servers were stopped after verification.

---

## Notes

[^root-naming-already-fixed]: The one thing that makes a root-declared state work at all is `stateRuleName` ([ClassStyleRules.ts:661-663](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L661-L663)), which returns `COMPONENT_CLASS` (`"ts-ui-component"`) instead of `ctor.name` when the declaring class is `_rootCtor`. Without it the generated rule would be `.Component.undisplayed`, and `getStyleClassChain` never puts `Component`'s own name on any element, so the rule would match nothing. That helper shipped with the `.invisible` work and is used at both name-computation sites (`resolveStateLevels` [:726](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L726) and `buildResolvedStates` [:829](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L829)), so a second root-declared entry needs no change there. Verified by reading both call sites in the current source.

[^order-choice]: The alternative — `.invisible` first, preserving the `.ts-ui-component.invisible` selector and sparing two `_ruleCacheHas` assertions in `StyleStates.test.ts` — was rejected. With `.invisible` first, an element carrying both tokens matches `.ts-ui-component.invisible` but not `.ts-ui-component.undisplayed:not(.invisible)`, so it gets `visibility: hidden` and no `display: none`. Framework components are absolutely positioned, so nothing reflows, but the element stays in the box tree: it still contributes to an ancestor's `scrollWidth`/`scrollHeight`, and a descendant can escape it with `visibility: visible`, neither of which is possible under `display: none`. That is a behaviour change from today, where `setDisplayed(false)` writes a real `display: none`. The chosen order has no such gap in either direction, including the un-hide path: removing `.undisplayed` while `.invisible` is still active makes `.ts-ui-component.invisible:not(.undisplayed)` start matching again, restoring `visibility: hidden` with no extra write. The cost is a mechanical, fully enumerated selector update in six test files, listed in step 4.

[^direct-read-is-mandatory]: The direct read is not defensive here, it is load-bearing, and for a sharper reason than in `isVisible()`. `setDisplayed(true)` caches `displayed: true` into `_instanceStyle`, and the later `setDisplayed(false)` deliberately does not clear it. For a class that *does* resolve `.undisplayed` (any class with no `ownStyleStates` of its own), `styleLayers()` pushes the state layer ahead of the instance layer, so `resolveStyleValue("displayed")` answers `false` correctly. For a class that declares its own list — `Button`, `Row`, `TreeRow` — that layer is never pushed, so `resolveStyleValue("displayed")` reads the stale `true` off the instance layer and `isDisplayed()` would report a hidden row as displayed. `VirtualRowView`'s row pool ([VirtualRowView.ts:423](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L423), [:439](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L439)) drives exactly that show-then-hide sequence on `Row`/`TreeRow` every scroll tick, and `getLaidOutComponents` ([Component.ts:6412](packages/lib/src/typescript/lib/core/Component.ts#L6412)) filters on `isDisplayed()`.

[^stale-idempotency-trace]: Traced by hand against the new write path. Start: `_instanceStyle.displayed` unset. Call 1 (`false`): `.undisplayed` activated, `_instanceStyle` untouched. Call 2 (`true`): state cleared, `_instanceStyle.displayed` becomes `true`. Call 3 (`false`): state activated again, `_instanceStyle.displayed` still `true`, now stale. Call 4 (`true`): the old guard `_instanceStyle.displayed === v` would find `true === true` and return early, skipping both the state clear and the reconcile scheduling — leaving the component permanently undisplayed. Reading `isDisplayed()` instead answers `false` at call 4 (from `_activeStates`), so the call proceeds. `Scrollbar`'s shipped override already uses this shape for this reason; the base class now inherits it.

[^no-class-outranks-the-shared-rule]: A per-instance `#id { display: block }` rule (specificity 1-0-0) would outrank the shared `.ts-ui-component.undisplayed` rule (0-2-0), so it matters that no class produces one. It does not, for two independent reasons. First, `flushStyleBag` only writes a real value when the instance's own resolved value differs from the class tier's; `ensureClassStyleRule` returns the *full* inherited bag (`{ ...FRAMEWORK_DECLARATIONS, ...deviations }`, [ClassStyleRules.ts:940](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L940)), which always carries `display`, and `resolveDeclarations` ([:212](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L212)) makes that `"block"` for every class that does not default `displayed: false`. So `setDisplayed(true)` queues a `null` removal, never a real declaration. Second, for the one class that *does* default `displayed: false` — `HiddenFileInput` — a real `display: block` write would be routed onto the resting-isolated rule `#id:not(.undisplayed):not(.invisible)`, because `display` is in `restingIsolationKeys()` for any class that resolves `Component`'s states; that selector does not match an undisplayed element, so it cannot compete. The gap left open is a class that has both a non-`block` class-tier `display` **and** its own `ownStyleStates` list (which would drop `display` from its isolation keys and drop `:not(.undisplayed)` from its resting suffix). No such class exists today: `grep -rn "displayed: false" packages/lib/src/typescript/lib/` returns two hits — `HiddenFileInput`'s class defaults, which declares no states, and `Scrollbar`'s `.undisplayed` extractor, which this plan deletes.

[^scrollbar-delete]: Checked member by member against the base implementations this plan writes. `Scrollbar.setDisplayed`'s body is identical to the new base body. `Scrollbar.isDisplayed` differs only in reading the state through the `isStyleState(".undisplayed")` accessor rather than `_activeStates` directly — the same value, via a `protected` wrapper a subclass needs and the root class does not. `Scrollbar.ownStyleStates` declares `.undisplayed` and nothing else, so deleting it costs `Scrollbar` no other state and *gains* it `.invisible`, which its own whole-list override previously shadowed. Keeping the declaration instead would not have produced a duplicate CSS rule — `resolveStateLevels` inserts a level's rule only when it deviates from its parent's, and a verbatim restatement has an empty delta — but it would leave three members that do nothing the base class does not, and would keep `Scrollbar`'s resting guard suffix and isolation-key set narrower than every other class's for no reason.

[^why-not-shared-state-rule]: `ensureSharedStateRule` ([Component.ts:5581](packages/lib/src/typescript/lib/core/Component.ts#L5581)) forwards to `ensureClassStateRule(this.constructor, suffix, declarations)`, which builds its selector from `ctor.name` and has no `stateRuleName` equivalent. Called from a component, it would produce `.Button.undisplayed`, `.Legend.undisplayed`, `.Panel.undisplayed`, one per concrete class — moving the duplication from the `#id` tier to the class tier rather than removing it. Getting a single shared rule out of that path would mean either patching `ensureClassStateRule` with the root-name special case as well, or hardcoding a `Component` constructor argument at a call site where every existing caller passes `this.constructor` — a new pattern, for a mechanism that also skips the guard-suffix and isolation-key bookkeeping `ownStyleStates` provides for free. The `ownStyleStates` route reuses the machinery `.invisible` already proved at the root and needs no edit to `ClassStyleRules.ts` at all.
