---
depends-on: [delegate-class-style-defaults-followups, state-chrome-isolation-generalization]
---

# State-Tier Rule Dedup Follow-ups — Implementation Plan

## Overview

`Button`'s `.pressed` state and (once merged) `Checkbox`/`RadioButton`'s `.selected`/`.indeterminate` states share one `StateStyleRule` per `(class, suffix)` pair across every instance, via `Component.createStateStyleRule` ([Component.ts:1037](packages/lib/src/typescript/lib/core/Component.ts#L1037)) and `ensureClassStateRule` ([ClassStyleRules.ts:289](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L289)). A second pass of the in-app Style Audit panel found four more components with a state-dependent CSS declaration that never reaches this mechanism: [`WindowBorder`](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L76)'s `.snap-target` box-shadow and [`HeaderCell`](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L83)'s `:active` box-shadow both use the older, per-instance-only `createStyleRule` builder that predates the state-tier dedup mechanism; [`ScrollArrowButton`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L129)'s enabled/disabled colour swap and the `Scrollbar` thumb's hover-fill swap ([`delegate-class-style-defaults-followups.md`](delegate-class-style-defaults-followups.md)'s new `ScrollbarThumb`) call a plain colour setter directly, with no toggle class or state rule at all. Combined, these four account for roughly 8 KB of the audit's reported duplication.

This plan gives each a proper state-tier rule. `WindowBorder` and `HeaderCell` need only the state rule itself — neither declares a competing *resting* value for the same property, so there is nothing for the resting-chrome isolation mechanism to protect (see `## Architecture Decisions`). `ScrollArrowButton` and the `Scrollbar` thumb do have a competing resting value (both properties are now registered class defaults, from the prerequisite plan), so both need `getRestingExclusionSuffixes()` — merged into `master` by [`state-chrome-isolation-generalization.md`](state-chrome-isolation-generalization.md), not yet available — plus a new toggle class neither has today.

This plan depends on [`delegate-class-style-defaults-followups.md`](delegate-class-style-defaults-followups.md) (which creates `ScrollbarThumb` and registers `ScrollArrowButton`'s resting `backgroundColor`) and on `state-chrome-isolation-generalization.md` (`getRestingExclusionSuffixes()`, `RESTING_ISOLATION_KEYS`). Both must land first.

---

## Architecture Decisions

### `WindowBorder` and `HeaderCell` need `createStateStyleRule` only — no isolation override

`getRestingExclusionSuffixes()` exists to stop a per-instance resting write from silently outranking a class-tier state rule on the *same property* — ARCHITECTURE.md's *Component CSS tiers and state-rule dedup* section. That hazard needs a resting-tier declaration for the property to exist in the first place. `WindowBorder`'s `_defaultWindowBorderOptions` ([WindowBorder.ts:63-65](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L63-L65)) declares no `shadow`; `HeaderCell`'s own defaults declare no `shadow` either (confirmed: `grep -n 'shadow' packages/lib/src/typescript/lib/component/table/cell/Header.ts packages/lib/src/typescript/lib/component/table/cell/Cell.ts` finds none). Neither class's resting tier ever writes `box-shadow` at all, so there is no competing declaration for `.snap-target`/`:active` to be isolated from — adding an exclusion-suffix override for either would be a real line of code with no effect. Both fixes are a direct swap of `createStyleRule` for `createStateStyleRule`, nothing more.

### `ScrollArrowButton` and `ScrollbarThumb` need a toggle class plus isolation — the competing resting value is real

Both properties this plan touches on these two classes (`ScrollArrowButton`'s `color`, `ScrollbarThumb`'s `backgroundColor`) are registered class defaults as of the prerequisite plan, and both are members of `RESTING_ISOLATION_KEYS` (`backgroundColor`/`backgroundImage`/`boxShadow` — `color` maps to the `foregroundColor` slot the same set covers). Skipping isolation here would reproduce the exact hazard ARCHITECTURE.md documents: a resting `#id` write (however unlikely today — see the footnote on this exact question in `checkbox-radio-delegate-state-style-defaults.md`) could silently and permanently outrank the class-tier state rule. This plan follows that plan's own conclusion: include the override anyway, for consistency with every other state-rule addition in this codebase, at the cost of one method each.[^isolation-included-both]

### Neither toggle is driven by CSS `:hover` directly

`Button`'s existing hover state uses the native `:hover` pseudo-class as its suffix (`:hover:not(.pressed)`) because plain pointer-over-element is exactly what it needs to express. `ScrollbarThumb`'s hover-look is not that: `Scrollbar.updateThumbFill()` ([Scrollbar.ts:593-597](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L593-L597)) shows the hover fill whenever the pointer is over the thumb **or** a drag is in progress, so the highlight survives the pointer straying outside the thumb mid-drag — a condition CSS `:hover` cannot express. This plan gives it an explicit `.hover` toggle class, driven by the same `this._thumbHovered || this._thumbDragging` computation the code already has, moved onto the delegate itself. `ScrollArrowButton`'s `.disabled` is likewise a JS-computed state (at-scroll-edge), not a pointer state, so it also needs an explicit class.

### The state-to-visual mapping moves onto each delegate — mirroring `CheckboxBox.applyState`

`ScrollArrowButton.setDisabledState` and `Scrollbar.updateThumbFill` currently compute a literal colour and call a plain setter directly. Both move to a named `apply*State` method on the delegate itself, exactly like `CheckboxBox.applyState`/`RadioButtonRing.applyState` ([`checkbox-radio-delegate-state-style-defaults.md`](checkbox-radio-delegate-state-style-defaults.md)): the method toggles the CSS class and, for the non-resting branch only, writes through the state-tier rule. The resting branch writes nothing — once the resting value is a registered class default, the base rule is populated once at construction and never touched again, so there is nothing to restore when the toggle class comes off (the same reasoning `checkbox-radio-delegate-state-style-defaults.md`'s own "why no resting write" footnote gives in full).

---

## Public API

No exported symbol or public/consumer-facing member changes anywhere. `WindowBorder`'s private `snapTargetStyleRule` getter changes its return type from `StyleRule` to `StateStyleRule`; `HeaderCell` gains an equivalent private getter. Both are implementation detail. `ScrollArrowButton` and `ScrollbarThumb` (module-private, never exported) each gain the `protected` members below:

```typescript
// component/container/Scrollbar.ts
class ScrollArrowButton {
    protected getDisabledClassDeclarations(): Record<string, string | null>;
    protected override getRestingExclusionSuffixes(): readonly string[]; // [".disabled"]
    protected override render(): Handle;
}

class ScrollbarThumb {
    /** Applies the hover/drag highlight. Called by `Scrollbar.updateThumbFill`. */
    applyHoverState(hovered: boolean): void;

    protected getHoverClassDeclarations(): Record<string, string | null>;
    protected override getRestingExclusionSuffixes(): readonly string[]; // [".hover"]
    protected override render(): Handle;
}
```

---

## Internal Structure

### `component/container/WindowBorder.ts` — `snapTargetStyleRule` becomes a `StateStyleRule`

```typescript
// Before:
private declare _snapTargetStyleRule?: StyleRule;
private get snapTargetStyleRule(): StyleRule {
    return this._snapTargetStyleRule ??= this.createStyleRule("." + SNAP_TARGET_CLASS);
}
```

```typescript
// After:
const WINDOW_BORDER_SNAP_TARGET_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    boxShadow: "var(--ts-ui-window-snap-glow, 0 0 0 2px rgba(30, 100, 200, 0.7))",
});

// Inside WindowBorder:
private declare _snapTargetStyleRule?: StateStyleRule;
private get snapTargetStyleRule(): StateStyleRule {
    return this._snapTargetStyleRule ??= this.createStateStyleRule(
        "." + SNAP_TARGET_CLASS,
        () => ({ boxShadow: WINDOW_BORDER_SNAP_TARGET_DECLARATIONS.boxShadow }),
    );
}
```

The constructor's existing call — `this.snapTargetStyleRule.set("boxShadow", "var(--ts-ui-window-snap-glow, 0 0 0 2px rgba(30, 100, 200, 0.7))");` ([WindowBorder.ts:122](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L122)) — becomes `this.snapTargetStyleRule.set("boxShadow", WINDOW_BORDER_SNAP_TARGET_DECLARATIONS.boxShadow);`, reading the same module constant the resolver closure reads, so the literal is written once. Import swaps from `import { StyleRule } from "~/core/StyleTarget.js";` to `import type { StateStyleRule } from "~/core/ClassStyleRules.js";` — `StyleRule` has no other use in this file ([confirmed](packages/lib/src/typescript/lib/component/container/WindowBorder.ts): its only appearance is this field).

### `component/table/cell/Header.ts` — the `:active` rule gains a cached `StateStyleRule` getter

```typescript
const HEADER_CELL_ACTIVE_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    boxShadow: "var(--ts-ui-button-pressed-shadow, 1px 2px 5px 0 rgba(0,0,0,0.2) inset)",
});

// Inside HeaderCell, alongside its other private fields:
private declare _activeStyleRule?: StateStyleRule;
private get activeStyleRule(): StateStyleRule {
    return this._activeStyleRule ??= this.createStateStyleRule(
        ":active",
        () => ({ boxShadow: HEADER_CELL_ACTIVE_DECLARATIONS.boxShadow }),
    );
}
```

Constructor, before → after ([Header.ts:130-140](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L130-L140)):

```typescript
// Before:
this.createStyleRule(":active").set(
    "boxShadow",
    "var(--ts-ui-button-pressed-shadow, 1px 2px 5px 0 rgba(0,0,0,0.2) inset)",
);
```

```typescript
// After:
this.activeStyleRule.set("boxShadow", HEADER_CELL_ACTIVE_DECLARATIONS.boxShadow);
```

Add `type { StateStyleRule }` to the existing `~/core/ClassStyleRules.js` import site (new — `Header.ts` does not import from that module today); `StyleRule` stays imported (still used by `_glyphClassRule`, [Header.ts:44-68](packages/lib/src/typescript/lib/component/table/cell/Header.ts#L44-L68)).

### `component/container/Scrollbar.ts` — `ScrollArrowButton`'s `.disabled` state

Extend the prerequisite plan's `_defaultScrollArrowButtonOptions` with the resting colour, and add the disabled-state declarations and machinery:

```typescript
const _defaultScrollArrowButtonOptions: Partial<ComponentOptions> = {
    backgroundColor: "var(--ts-ui-scrollbar-arrow-bg, transparent)",
    foregroundColor: "var(--ts-ui-scrollbar-arrow-color, rgba(0, 0, 0, 0.55))",
};

const SCROLL_ARROW_DISABLED_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    color: "var(--ts-ui-scrollbar-arrow-disabled-color, rgba(0, 0, 0, 0.18))",
});

class ScrollArrowButton extends Component {
    private _disabled: boolean = false;
    // ... existing fields unchanged

    private declare _disabledStyleRule?: StateStyleRule;
    private get disabledStyleRule(): StateStyleRule {
        return this._disabledStyleRule ??= this.createStateStyleRule(
            ".disabled",
            () => this.getDisabledClassDeclarations(),
        );
    }

    protected getDisabledClassDeclarations(): Record<string, string | null> {
        return { color: SCROLL_ARROW_DISABLED_DECLARATIONS.color };
    }

    /** `_arrow`'s own resting colour must stay isolated from `.disabled` — see this plan's Architecture Decisions. */
    protected override getRestingExclusionSuffixes(): readonly string[] {
        return [...super.getRestingExclusionSuffixes(), ".disabled"];
    }

    setDisabledState(disabled: boolean): void {
        if (this._disabled === disabled) {
            return;
        }

        this._disabled = disabled;

        if (disabled) {
            this._repeat.stop();
        }

        const element = this.getElement();
        if (element) {
            DOM.sink.apply(element, { toggleClass: { disabled } });
        }

        if (disabled) {
            this.disabledStyleRule.set("color", SCROLL_ARROW_DISABLED_DECLARATIONS.color);
        }
    }

    /** Re-applies the cached disabled state at render, for a state set before mount. */
    protected render(): Handle {
        const element = super.render();
        DOM.sink.apply(element, { toggleClass: { disabled: this._disabled } });
        return element;
    }
}
```

`setForegroundColor(...)` is deleted from the constructor ([Scrollbar.ts:149](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L149) — the resting value is now a registered default) and from `setDisabledState`'s `else` branch ([Scrollbar.ts:261](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L261) — the resting rule is never touched after construction, so nothing needs restoring; see `## Architecture Decisions`). The `render()` override is needed because `Scrollbar.buildArrows()` calls `this._arrowStart.setDisabledState(true)` synchronously in `Scrollbar`'s own constructor ([Scrollbar.ts:515](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L515)), before `_arrowStart`'s own element exists — `setDisabledState`'s `DOM.sink.apply` call is then a no-op (`getElement()` returns nothing), so the class must be re-asserted once the element renders, exactly like `CheckboxBox.render()`.

### `component/container/Scrollbar.ts` — `ScrollbarThumb`'s `.hover` state

```typescript
const SCROLLBAR_THUMB_HOVER_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    backgroundColor: "var(--ts-ui-scrollbar-thumb-hover, rgba(0, 0, 0, 0.55))",
});

class ScrollbarThumb extends Component {
    private _hovered: boolean = false;

    private declare _hoverStyleRule?: StateStyleRule;
    private get hoverStyleRule(): StateStyleRule {
        return this._hoverStyleRule ??= this.createStateStyleRule(
            ".hover",
            () => this.getHoverClassDeclarations(),
        );
    }

    constructor() {
        super(undefined, _defaultScrollbarThumbOptions);
    }

    protected getHoverClassDeclarations(): Record<string, string | null> {
        return { backgroundColor: SCROLLBAR_THUMB_HOVER_DECLARATIONS.backgroundColor };
    }

    protected override getRestingExclusionSuffixes(): readonly string[] {
        return [...super.getRestingExclusionSuffixes(), ".hover"];
    }

    /** Applies the hover/drag highlight. Called by `Scrollbar.updateThumbFill`. */
    applyHoverState(hovered: boolean): void {
        this._hovered = hovered;

        const element = this.getElement();
        if (element) {
            DOM.sink.apply(element, { toggleClass: { hover: hovered } });
        }

        if (hovered) {
            this.hoverStyleRule.set("backgroundColor", SCROLLBAR_THUMB_HOVER_DECLARATIONS.backgroundColor);
        }
    }

    protected render(): Handle {
        const element = super.render();
        DOM.sink.apply(element, { toggleClass: { hover: this._hovered } });
        return element;
    }
}
```

`Scrollbar.updateThumbFill`, before → after ([Scrollbar.ts:593-597](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L593-L597)):

```typescript
// Before:
private updateThumbFill(): void {
    this._thumb.setBackgroundColor(this._thumbHovered || this._thumbDragging
        ? "var(--ts-ui-scrollbar-thumb-hover, rgba(0, 0, 0, 0.55))"
        : "var(--ts-ui-scrollbar-thumb, rgba(0, 0, 0, 0.35))");
}
```

```typescript
// After:
private updateThumbFill(): void {
    this._thumb.applyHoverState(this._thumbHovered || this._thumbDragging);
}
```

Add `type { StateStyleRule }` to `Scrollbar.ts`'s existing imports (new — this file does not import from `~/core/ClassStyleRules.js` today).

---

## Ordered Implementation Steps

1. **Confirm dependencies are in place.** `grep -n 'getRestingExclusionSuffixes\|createStateStyleRule' packages/lib/src/typescript/lib/core/Component.ts` — both must exist (the second is already on `master`; the first comes from `state-chrome-isolation-generalization`). `grep -n 'class ScrollbarThumb\|_defaultScrollArrowButtonOptions' packages/lib/src/typescript/lib/component/container/Scrollbar.ts` — both must exist (from `delegate-class-style-defaults-followups`). Do not proceed if either is missing.

2. **`WindowBorder.ts` — swap `snapTargetStyleRule` to a `StateStyleRule`.** Per `## Internal Structure`. Swap the import.
   *Check:* `npm run typecheck`.

3. **`Header.ts` — add `HEADER_CELL_ACTIVE_DECLARATIONS` and `activeStyleRule`; rewrite the constructor's `:active` call.** Per `## Internal Structure`. Add the new type-only import.
   *Check:* `npm run typecheck`.

4. **`Scrollbar.ts` — extend `_defaultScrollArrowButtonOptions`; add `.disabled` machinery to `ScrollArrowButton`.** Per `## Internal Structure`. Delete the constructor's `setForegroundColor` call and the `else` branch's `setForegroundColor` call in `setDisabledState`. Add the type-only `StateStyleRule` import.
   *Check:* `npm run typecheck`. `grep -n 'this.setForegroundColor' packages/lib/src/typescript/lib/component/container/Scrollbar.ts` — zero matches inside `ScrollArrowButton`.

5. **`Scrollbar.ts` — add `.hover` machinery to `ScrollbarThumb`; rewrite `updateThumbFill`.** Per `## Internal Structure`.
   *Check:* `npm run typecheck`. `grep -n 'this._thumb.setBackgroundColor' packages/lib/src/typescript/lib/component/container/Scrollbar.ts` — zero matches.

6. **Add tests covering `## Expected Behaviour` rows 1-6**, following `Button.pressedHoverClassHoisting.test.ts`'s conventions (`_ruleCacheHas`, `declarationsDuring`/`idSelector`, both already on `master`):
   - Row 1 (`WindowBorder`): new file `packages/lib/tests/component/container/WindowBorder.classStateHoisting.test.ts` — no dedicated test file for this class exists today (confirmed via `grep -rl 'WindowBorder' packages/lib/tests`).
   - Row 2 (`HeaderCell`): new `describe` block in `packages/lib/tests/component/table/cell/Header.test.ts` (the same file `delegate-class-style-defaults-followups.md` already extends for `HeaderCellRenderer`).
   - Rows 3-5 (`ScrollArrowButton`): new `describe` block in `packages/lib/tests/component/container/ScrollbarArrow.test.ts`.
   - Row 6 (`ScrollbarThumb`): new `describe` block in `packages/lib/tests/component/container/Scrollbar.test.ts`.
   *Check:* `npx vitest run` on each file above — new cases pass, nothing else regresses.

7. **`next.md` — add the changelog bullet.** See `## Documentation Impact`.
   *Check:* `npm run docs:api` finishes with zero warnings.

8. **Full verification.** See `## Verification`.

9. **Verify live in a browser.** Non-negotiable — every plan in this mechanism's lineage shipped at least one regression the offline harness missed.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/component/container/WindowBorder.ts` |
| Modify | `packages/lib/src/typescript/lib/component/table/cell/Header.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Create | `packages/lib/tests/component/container/WindowBorder.classStateHoisting.test.ts` |
| Modify | `packages/lib/tests/component/table/cell/Header.test.ts` |
| Modify | `packages/lib/tests/component/container/ScrollbarArrow.test.ts` |
| Modify | `packages/lib/tests/component/container/Scrollbar.test.ts` |

---

## Expected Behaviour

Rows 1-6 are unit-testable against the recording DOM sink. Rows 7-8 need a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | Two `Window`s snap-dragged in the same test (warming the class rule) | No `boxShadow` write on the second instance's own `#id.snap-target` rule; `_ruleCacheHas('.WindowBorder.snap-target')` is `true` |
| 2 | Two `HeaderCell`s, both pressed | No `boxShadow` write on the second instance's own `#id:active`; `_ruleCacheHas('.HeaderCell:active')` is `true` |
| 3 | Two `Scrollbar`s, both with an arrow disabled (warming the class rule) | No `color` write on the second instance's own `#id.disabled`; `_ruleCacheHas('.ScrollArrowButton.disabled')` is `true` |
| 4 | A `ScrollArrowButton` disabled then re-enabled | Across the whole sequence, the base rule (`#id`/`#id:not(.disabled)`) receives zero `color` writes after construction — the disabled-state write only ever touched `#id.disabled` |
| 5 | `Scrollbar.buildArrows()`'s pre-set disabled start arrow, before first render | The arrow's element carries the `.disabled` class once rendered (the `render()` re-assert) |
| 6 | Two `Scrollbar`s, both thumb-hovered (warming the class rule) | No `backgroundColor` write on the second instance's own `#id.hover`; `_ruleCacheHas('.ScrollbarThumb.hover')` is `true`; the base rule receives zero `backgroundColor` writes across a hover-in/hover-out cycle |
| 7 | Demo app: drag a `Window` near a snap zone; press a `HeaderCell` (mousedown); disable/enable a `Scrollbar` arrow by scrolling to an edge; hover and drag a `Scrollbar` thumb | Each state's visual is correct with no flash of a stale colour |
| 8 | Style Audit panel, on a tab exercising all four, before/after | The four rows this plan targets are gone |

---

## Verification

```
npm run typecheck
npm test
npm run lint
npm run docs:api        # must finish with zero warnings
```

**Manual browser verification (rows 7-8) is required.** Start a dev server on a spare port from *this worktree*. Drag a `Window` to a screen edge to trigger the snap glow; click and hold a `HeaderCell` to trigger `:active`; scroll an `autoScroll` panel with a visible `Scrollbar` to both edges to exercise arrow disable/enable and hover/drag the thumb. Then open `#/style-audit` and refresh.

---

## Documentation Impact

No exported symbol changes — every touched method is `protected`/`private`, and every new class field is module-private. One changelog entry in `packages/lib/docs/reference/changelog/next.md`, under `## Changed` → `### Components`, directly after the entry `delegate-class-style-defaults-followups.md` adds:

> **`WindowBorder`'s snap-target glow, `HeaderCell`'s pressed shadow, `Scrollbar`'s disabled-arrow colour, and its thumb's hover fill now dedupe across instances of the same class, the same way `Button`'s `.pressed` chrome already does.** No consumer action needed; nothing changes visually.

---

## Potential Challenges

- **Forgetting the `render()` re-assert on `ScrollArrowButton`.** Without it, the pre-set start arrow (`Scrollbar.buildArrows()`) shows no `.disabled` class until some other code path calls `setDisabledState` again post-mount — row 5 exists specifically to catch this.
- **A future edit adding a second write path to either base rule** (a hypothetical per-instance override setter for the arrow's or thumb's resting colour) would reintroduce the "clear on match, never skip" hazard `applyHoverState`/`setDisabledState`'s resting branches currently avoid by never writing at all — the same caveat `checkbox-radio-delegate-state-style-defaults.md`'s own Potential Challenges names for `CheckboxBox`/`RadioButtonRing`.

---

## Critical Files

| File | Why |
|---|---|
| `plans/implemented/checkbox-radio-delegate-state-style-defaults.md` | The direct precedent this plan mirrors — `applyState`'s shape, the resting-branch-writes-nothing reasoning, the `render()` re-assert |
| `plans/state-chrome-isolation-generalization.md` | Prerequisite — `getRestingExclusionSuffixes()`, `RESTING_ISOLATION_KEYS` |
| `plans/delegate-class-style-defaults-followups.md` | Prerequisite — creates `ScrollbarThumb` and registers `ScrollArrowButton`'s resting `backgroundColor`, both of which this plan extends |
| `packages/lib/src/typescript/lib/core/Component.ts` | `createStateStyleRule` (1037) — already on `master`; `createStyleRule` (1009) — what this plan replaces for `WindowBorder`/`HeaderCell` |
| `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` | `StateStyleRule` (386), `ensureClassStateRule` (289) |
| `packages/lib/src/typescript/lib/component/button/Button.ts` | The live precedent for a `:hover`-suffixed state rule, cited in `## Architecture Decisions` to explain why `ScrollbarThumb` needs an explicit class instead |
| `packages/lib/tests/component/button/Button.pressedHoverClassHoisting.test.ts` | Test conventions step 6's new cases copy — `_ruleCacheHas`, `declarationsDuring`, `idSelector`, all already on `master` |

---

## Non-Goals

- **`ScrollArrowButton`'s `:hover` background swap.** Not observed as a live duplicate in this audit pass — see `delegate-class-style-defaults-followups.md`'s own `## Non-Goals`.
- **Changes to `core/ClassStyleRules.ts` or `core/Component.ts`.** The state-tier mechanism already shipped (`state-style-rule-auto-dedup`) or is landing via the prerequisite plan (`state-chrome-isolation-generalization`); this plan only supplies data to it.
- **Any change to rendered appearance.** Every value written is identical before and after; only which CSS rule carries it changes.
- **Bumping the package version.** Release-time bookkeeping.

---

## Implementation Notes

**Full dedup (not just second-instance-onward) meant several pre-existing tests lost their only per-instance-rule proxy — fixed in the same commit, not deferred.** For all four pieces this plan touches, the state value is a fixed, non-parameterized constant with zero instance-level variation — `WINDOW_BORDER_SNAP_TARGET_DECLARATIONS`, `HEADER_CELL_ACTIVE_DECLARATIONS`, `SCROLL_ARROW_DISABLED_DECLARATIONS`, `SCROLLBAR_THUMB_HOVER_DECLARATIONS` are each read by both the class-tier `resolveDefaults()` callback and the constructor's own `.set()` call. Since `ensureClassStateRule` seeds the class-tier comparison bag from that *same* resolved value, `bag[key] === value` holds even for the very first instance ever constructed in the process — so, verified empirically (not just for the second-instance-onward case the plan's own Expected Behaviour rows describe), **no per-instance rule for these four properties ever materializes at all**, not even once. This is the intended, maximal form of the dedup this plan sets out to do, but it silently broke four pre-existing tests elsewhere in the suite that relied on one of these four exact properties as their "guaranteed to produce a real per-instance stylesheet rule" proxy for verifying an unrelated disposal/leak regression:

- `packages/lib/tests/core/Panel.styleRuleDisposal.test.ts` (B1-2) and `packages/lib/tests/component/container/VirtualScroller.styleRuleDisposal.test.ts` (B1-3) both had an explicit doc comment (written for `delegate-class-style-defaults-followups.md`) stating that `ScrollArrowButton`'s `foregroundColor` was deliberately left un-hoisted specifically *because* it "guarantees it a rule" reachable only through the scrollbar's own destructor recursion — the exact thing those tests guard (a historical bug where Panel/VirtualScroller raw-`appendChild`ed their overlay Scrollbars, so the base destructor's `_components` recursion never reached them). This plan's own Architecture Decision explicitly hoists that same `foregroundColor`, invalidating that documented invariant. Fixed by switching the proxy one level deeper, to the arrow's `Glyph` child's id — `Glyph.setFontSize` always writes its own `#id` rule directly (no class-default dedup for that property) and the glyph is only reachable through the same destructor recursion (`Scrollbar` → `ScrollArrowButton` → `Glyph`), so the regression coverage is preserved, arguably more thoroughly (one level deeper) than before.
- `packages/lib/tests/component/table/HeaderColumnWindow.test.ts` (test 26, "a cell the reconciler drops is disposed") relied on `HeaderCell`'s own `:active` rule (the exact one this plan hoists) as its "the dropped cell had a real per-instance rule" proxy, with no explicit comment predicting the risk. Fixed the same way: switched the proxy to the cell's side-loaded `_priorityBadge` (`SortPriorityBadge`) child's id — its constructor's initial `setVisible(false)` always writes a real `visibility: hidden` rule, untouched by this plan, and the badge is only disposed when `HeaderCell.destructor()` (already correctly implemented) is reached.
- `packages/lib/tests/overlay/AbstractWindow.styleRuleDisposal.test.ts` ("deletes both rules each resize border owns") asserted exactly 8 per-instance `#uuid.snap-target` rules exist before a window with 8 `WindowBorder` strips is destroyed. `WindowBorder` has no child components to substitute as a deeper proxy (unlike the arrow/glyph case above), so the specific leak vector this test guarded (a teardown that disposes only `#uuid`, leaving a `.snap-target` residue) is now structurally impossible — there is no per-instance `.snap-target` rule left to ever leak. First fixed by rewriting the test to assert that absence stays stable across the window's lifecycle instead of the old materialised-per-instance count — the audit's re-audit round correctly called that a tautology (an assertion that is empty both before and after can never fail, even if disposal broke entirely) rather than "honest but weaker" coverage, so it was removed instead; the sibling test above it in the same file already covers the total per-instance-rule-leak contract and was never weakened.

All four fixes were verified against the actual failure (ran the full suite, confirmed each failure's cause via direct empirical probing of `_ruleCacheKeys()`/`getComputedStyle` before writing the fix, not by assumption) and are folded into this plan's own code commit, since the fix exists only because this plan's change needs it. Flagging this prominently here — rather than treating it as a routine "adjust a stale assertion" — because it is a genuine, demonstrated conflict between this plan's own explicit Architecture Decision (hoist `ScrollArrowButton.foregroundColor`) and a documented design invariant a *different*, already-merged plan deliberately established for its own test coverage. A future plan that hoists another property should grep the test suite for `getId()`-based rule-cache proxies before assuming an un-hoisted property is safe to hoist.

**The plan's `color`/`foregroundColor` isolation claim for `ScrollArrowButton` was wrong — caught by audit, fixed by removing the override rather than by expanding `RESTING_ISOLATION_KEYS`.** `## Architecture Decisions` (line 25) asserts "`color` maps to the `foregroundColor` slot the same set covers" — i.e. that `RESTING_ISOLATION_KEYS` (`packages/lib/src/typescript/lib/core/Component.ts:335-339`) protects `color` the same way it protects `backgroundColor`/`backgroundImage`/`boxShadow`. It doesn't: the set is exactly `{backgroundColor, backgroundImage, boxShadow}`, and `setReconciledCSSRules` (`Component.ts:4871-4890`) only routes a key through the isolated `restingStyleRule` when `RESTING_ISOLATION_KEYS.has(key)` — `"color"` fails that check unconditionally, so a resting `color` write always lands on the bare `#id` rule no matter what `getRestingExclusionSuffixes()` returns. The `.disabled` override this plan added to `ScrollArrowButton` therefore isolated nothing real: it doesn't protect `color` (not a member) and there is nothing live to protect for `backgroundColor` either (`.disabled` never declares it). Confirmed this is not a gap unique to this plan: `Button` never calls `this.setForegroundColor(...)` on itself either (only on child components with their own ids), so it never needed to isolate its own resting `color` from `.pressed` in the first place — the same reason this plan's `WindowBorder`/`HeaderCell` pieces need no override, just reached through a different property. Expanding `RESTING_ISOLATION_KEYS` to cover `color` is out of scope — `## Non-Goals` explicitly rules out touching `core/Component.ts`/`core/ClassStyleRules.ts` — so the fix removes `ScrollArrowButton`'s `getRestingExclusionSuffixes()` override entirely rather than widen the shared mechanism; see `Scrollbar.ts`'s comment at the old override's site for the reasoning kept in place of the code. `packages/lib/tests/component/container/ScrollbarArrow.test.ts`'s row-4 test moved from watching `#id:not(.disabled)` (a selector `color` can never reach) to bare `#id` (the one it does), and `packages/lib/tests/component/default-options-fallback.test.ts` gained the `ScrollArrowButton foregroundColor` registry row `ARCHITECTURE.md`'s class-default-fallback rule requires and the plan's own Files table omitted.

**`HeaderCell` needed the isolation override the plan said it didn't — `setColumnFocused` is a live resting `boxShadow` writer the plan's grep missed.** `## Architecture Decisions` (line 21) claims "confirmed: `grep -n 'shadow' … Header.ts Cell.ts` finds none" — that grep pattern is case-sensitive and missed `setShadow`/`clearShadow` (capital S), which `HeaderCell.setColumnFocused` (`Header.ts:610-620`, unchanged by this plan) calls on every focused-column change (driven by `TableHeader.applyFocusedColumn` on every render). Both route through `setReconciledCSSRules({ boxShadow: … })`, which — with no isolation override — lands on bare `#id`, `(1,0,0)` specificity, permanently outranking `.HeaderCell:active`'s `(0,2,0)`. This was a live, verified regression (confirmed against the recording sink) that would have shipped: a column-focused header cell showed no press feedback, and losing focus (`clearShadow` → `box-shadow: none`) killed it permanently on a pooled/recycled cell. Fixed by adding `protected override getRestingExclusionSuffixes(): readonly string[] { return [...super.getRestingExclusionSuffixes(), ":active"]; }` to `HeaderCell`, exactly the pattern `ARCHITECTURE.md`'s state-rule-dedup section prescribes and the one property this plan's `WindowBorder` piece genuinely doesn't need (no analogous live resting-`boxShadow` writer exists there).

**Manual browser verification (plan step 9 / Expected Behaviour rows 7-8) was performed but not originally recorded — recorded here.** Ran a second dev server (`vite --port 8021`) from this worktree against the demo app (`#/misc`), independent of the main tree's own server on 8015, and drove it via `mcp__chrome-devtools__*`. Observed directly: (1) a table window's vertical scrollbar's pre-set-disabled start arrow renders `color: rgba(0, 0, 0, 0.18)` with the `.disabled` class present immediately on open (confirming the `render()` re-assert), the end arrow renders the enabled `rgba(0, 0, 0, 0.55)`; (2) dispatching a real `mouseover`/`mouseout` on the thumb toggles the `.hover` class and its `background-color` between `rgba(0,0,0,0.55)` and `rgba(0,0,0,0.35)` correctly, reverting cleanly; (3) `document.styleSheets` confirmed `.WindowBorder.snap-target` and `.HeaderCell:active` class-tier rules exist with the correct `box-shadow` declarations, and toggling `.snap-target` on a live `WindowBorder` element paints the expected glow; clicking a header cell produced no console errors. Row 8: the Style Audit panel's duplication table, inspected live, lists no row for `WindowBorder`, `HeaderCell`, `ScrollArrowButton`, or `Scrollbar`/`ScrollbarThumb`. No console errors were observed at any point in the session. This check surfaced the `HeaderCell` regression above only indirectly (the CSS-rule inspection, not a live press, is what would have caught the specificity collision — a live mousedown/mouseup held long enough to screenshot mid-press was not achievable with the available tooling); the audit's own review caught it directly by reading the code.

## Notes

[^isolation-included-both]: `checkbox-radio-delegate-state-style-defaults.md`'s own "isolation arguably unneeded" footnote makes the identical observation for `CheckboxBox`/`RadioButtonRing` — neither exposes a public API for a consumer to customize an individual instance's resting colour, so the specific hazard isolation guards against needs a deviation that cannot occur today — and still includes the override, reasoning that every state-rule addition in this codebase so far pairs a state rule with resting isolation, so skipping it here would be a novel, unproven partial pattern for a saving of one method. `ScrollArrowButton` and `ScrollbarThumb` are in the identical position (fully internal, non-configurable pieces with no public colour-override API), so this plan reaches the same conclusion for the same reason.
