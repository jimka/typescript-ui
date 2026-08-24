---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/ClassStyleRules.ts
  - packages/lib/src/typescript/lib/component/container/Scrollbar.ts
  - ARCHITECTURE.md
---

# Component `setVisible` / Scrollbar `setDisplayed` State-Tier Dedup — Implementation Plan

## Overview

The in-app Style Audit ([`packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts`](packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts)) finds the single biggest duplicate-body row in the shared stylesheet is `{ visibility: hidden; }`, written as a per-instance `#id { visibility: hidden; }` rule by every hidden component. The cause is generic: [`Component.setVisible`](packages/lib/src/typescript/lib/core/Component.ts#L1972) writes through `this.writeStyle({ visible: authored })`, which always lands on the resting (per-instance) CSS tier — never the state tier `Scrollbar`'s own arrow/thumb delegates already use for this exact shape of problem (a property that's genuinely different on roughly half of all live instances at any moment, so no static class default could ever collapse it).

This plan reroutes `setVisible`'s CSS write through the **state tier** — the same mechanism [`ScrollArrowButton`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L178) (`.disabled`) and [`ScrollbarThumb`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L411) (`.hover`) already use — by declaring a `.invisible` state directly on `Component`. Declaring a state on the root class is new: no class does this today, and it requires one small fix to `core/ClassStyleRules.ts` (below) that no existing consumer needed. A second step applies the identical technique to `Scrollbar.setMetrics`'s `setDisplayed(overflow)` call ([Scrollbar.ts:778](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L778)), scoped to `Scrollbar` alone — it shares one small dependency with the first step (see `## Architecture Decisions`, "Order") but touches no other file.

Every claim below was re-verified against the current worktree source (not against the originating investigation, and not against `plans/implemented/state-tier-rule-dedup-followups.md`, whose own code snippets reference a since-retired mechanism — see [^stale-plan]). Counts and line numbers in this plan are current as of this draft.

---

## Architecture Decisions

### `setVisible` routes through `Component.ownStyleStates`, mirroring `ScrollArrowButton`/`ScrollbarThumb`

`Component` declares one state, `.invisible`, whose `extract` returns `{ visible: false }`. `setVisible(false)` calls `this.setStyleState(".invisible", true)` instead of `this.writeStyle({ visible: false })`; `setVisible(true | null)` clears the state and keeps writing through `writeStyle` as today (that branch was already dedup-neutral — see the next decision). This is the established pattern per [ARCHITECTURE.md](ARCHITECTURE.md)'s *Component CSS tiers and state-rule dedup* section — no new pattern is introduced, only a new *declaring class* (the root instead of a leaf).[^resolveStyleStates-walk]

### The state-tier rule for a root-declared state must be named after `COMPONENT_CLASS`, not `ctor.name`

`resolveStateLevels` and `buildResolvedStates` ([ClassStyleRules.ts:709](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L709), [:812](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L812)) both key the generated `.ClassName<suffix>` rule on `ctor.name`. For every existing consumer `ctor.name` is a real concrete class name that the element's own DOM classList carries (`Button`, `ScrollArrowButton`, …). `Component`'s own name is not: `getStyleClassChain` ([ClassStyleRules.ts:961](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L961)) deliberately never adds `Component`'s name to any element's classList (`ctor === _rootCtor` returns `[]`), so a rule named `.Component.invisible` would never match anything — silently rendering every "hidden" component still visible. The fix is a three-line helper, `stateRuleName(ctor)`, that returns `COMPONENT_CLASS` (`"ts-ui-component"`, exported from the same file and already added to every element in `init()`) when `ctor === _rootCtor`, else `ctor.name` unchanged — used at both name-computation sites in place of the bare `.name` read.[^why-not-getStyleClassChain]

### `isVisible()` reads `_activeStates` directly, not through `resolveStyleValue`

`styleLayers()` ([Component.ts:4890](packages/lib/src/typescript/lib/core/Component.ts#L4890)) only pushes a declared state's layer when that state appears in `resolveStyleStates(this.constructor)` — and `ownStyleStates` is a **whole-list, own-property override**: a class that declares its own list (`Button`, `ToggleButton`, and 16 others — see the compatibility table below) does not inherit `Component`'s `.invisible` entry into it unless it explicitly restates it. None of them do, and none should have to: the shared `.ts-ui-component.invisible` CSS rule matches **any** element carrying both `ts-ui-component` (every element, always) and `invisible` (added by `setStyleState` regardless of which class calls it), so the *visual* behaviour is correct and deduped for every class uniformly, with no restatement. The one place this matters is the **getter**: `resolveStyleValue("visible")`'s layer walk would miss `.invisible`'s authored value for a class like `Button` (since its layer is never pushed), reporting `null` instead of `false`. `isVisible()` is written to check `this._activeStates.has(".invisible")` first — a per-instance field every `Component` carries regardless of its class's own `ownStyleStates` list — before falling back to `resolveStyleValue("visible")`. This makes the 18-class compatibility table below a non-issue by construction rather than a per-class audit.[^why-not-generic-flush]

### Compatibility table: the 18 classes with their own `ownStyleStates`

Every class in the current source declaring its own `ownStyleStates` (`grep -rln 'static readonly ownStyleStates' packages/lib/src/typescript`, then matched to its enclosing class — re-verified current, not taken from the originating investigation, which additionally listed `Body` and `Tree` as declaring `ownStyleStates`; neither does today, confirmed via `grep -n ownStyleStates` on both files, which only shows comments referencing `TreeRow.ownStyleStates`/`Row.ownStyleStates`). For each, whether it calls `setVisible(false)` on itself, and whether it needs to restate `.invisible`:

| Class | File | Calls `setVisible(false)` on itself? | Restatement needed? |
|---|---|---|---|
| `Button` | `component/button/Button.ts` | No | No — see below |
| `ToggleButton` | `component/button/ToggleButton.ts` | No | No |
| `TabCloseButton` | `component/button/TabCloseButton.ts` | No | No |
| `TabButton` | `component/button/TabButton.ts` | No (calls it on a child `TabBusyIndicator`, not itself — see `## Non-Goals`) | No |
| `MenuBarButton` | `component/menubar/MenuBarButton.ts` | No | No |
| `RailHandle` | `overlay/RailHandle.ts` | No | No |
| `WindowControlButton` | `overlay/windowControls.ts` | No | No |
| `ScrollArrowButton` | `component/container/Scrollbar.ts` | No | No |
| `ScrollbarThumb` | `component/container/Scrollbar.ts` | No | No |
| `WindowBorder` | `component/container/WindowBorder.ts` | No | No |
| `AccordionIndicator` | `component/container/AccordionIndicator.ts` | No | No |
| `DiagramNode` | `component/diagram/DiagramNode.ts` | No | No |
| `Checkbox` (`CheckboxBox`) | `component/input/Checkbox.ts` | No | No |
| `RadioButton` (`RadioButtonRing`) | `component/input/RadioButton.ts` | No | No |
| `Row` | `component/table/Row.ts` | No | No |
| `Cell` | `component/table/cell/Cell.ts` | No | No |
| `HeaderCell` | `component/table/cell/Header.ts` | No | No |
| `TreeRow` | `component/tree/TreeRow.ts` | No | No |

**"Restatement needed?" is "No" for every row, unconditionally** — not because none of them happens to call `setVisible(false)` today (though none do), but because the design in the previous two decisions makes restatement unnecessary even for a class that *does* call it in the future: `isVisible()` reads `_activeStates` directly (correct regardless of the calling class's own `ownStyleStates` list), and the shared `.ts-ui-component.invisible` rule matches on the universal `ts-ui-component` token rather than a concrete class name (correct visually regardless too). This is the opposite of `Button`'s `.pressed`/`ToggleButton`'s `.selected`, where restatement genuinely matters — those rules are scoped to the concrete class name (`.Button.pressed`), so a subclass that doesn't restate them truly loses both the dedup *and* the rule match. `.invisible` avoids that failure mode structurally, by being declared at the root with a root-scoped rule name, not by requiring every subclass to cooperate. A future class *is* still free to restate `.invisible` explicitly if it wants (e.g. to add its own guard ordering against a state it declares); it just isn't required to.

### `_instanceStyle` is never written for the `visible: false` case

`writeStyle`'s idempotency dedup only ever compares the instance layer against `layersBelowInstance()` (group + class tiers) — never the active state layer ([`layersBelowInstance`](packages/lib/src/typescript/lib/core/Component.ts#L4943)'s own comment is explicit about this). If `setVisible(false)` still cached `visible: false` into `_instanceStyle`, a *later* full-sweep re-render (`applyStyle`, e.g. after `setId()` or a released/rematerialized component) would see the instance layer declare `visibility: hidden` while the class tier resolves `"inherit"`, and re-queue a real per-instance declaration — reproducing the exact duplicate row this plan removes, just delayed to the next re-render. `setVisible(false)` therefore skips `writeStyle` entirely and calls only `setStyleState`; `setVisible(true | null)` is unaffected (already harmless — see `## Notes`) and keeps calling `writeStyle` unchanged.

### The DOM class token needs a render-time catch-up, added once to `Component.init()`

`setStyleState`'s own DOM write is gated on `this.getElement()` ([Component.ts:5577](packages/lib/src/typescript/lib/core/Component.ts#L5577)); a state toggled before the element exists (e.g. `new Component({ visible: false })`, dispatched by `applyOptions` before any render) only updates `_activeStates` until something re-applies the class at render time. Every existing `ownStyleStates` consumer handles this itself by overriding `render()` (`ToggleButton.render()`, `ScrollArrowButton.render()`, `ScrollbarThumb.render()` all do this — [Component.ts:5659](packages/lib/src/typescript/lib/core/Component.ts#L5659)'s comment on `getValueStyleToken` names this as `setStyleState`'s "own render-time catch-up need"). `.invisible` is reachable from **every** concrete class, so requiring each one to add its own override does not scale. This plan adds one generic sweep to `Component.init()` instead — the single place every concrete class's `render()` chain already passes through — extending the existing `addClass` call with every currently-active, non-pseudo-class state token. It is additive and idempotent for classes that already do their own catch-up (ToggleButton, the Scrollbar delegates): the same class gets added twice, which is a no-op.

### `scheduleEffectiveVisibilityReconcile` becomes `protected`

Scrollbar's `setDisplayed` override (below) must trigger the same effective-visibility reconcile `Component.setVisible`/`setDisplayed` do, without going through `writeStyle`/`super.setDisplayed` (see the next decision for why). `scheduleEffectiveVisibilityReconcile` ([Component.ts:2152](packages/lib/src/typescript/lib/core/Component.ts#L2152)) is currently `private`, unreachable from a subclass. Every other internal setter helper on this class (`writeStyle`, `cacheStyleValue`, `setStyleState`, `isStyleState`) is already `protected` for exactly this reason; widening this one method's modifier is a one-word, low-risk change consistent with that existing convention.

### `Scrollbar.setDisplayed`/`isDisplayed` do not call `super.setDisplayed`

A naive override — toggle `.undisplayed` via `setStyleState`, then call `super.setDisplayed(value)` for bookkeeping — has a real bug: `Component.setDisplayed`'s own idempotency check compares against `_instanceStyle.displayed`, which (per the decision above) is deliberately **not** updated while `.undisplayed` is active. On a hide→show→hide→show sequence, `_instanceStyle.displayed` gets stuck at a stale `true` from the *first* show, so the *second* `super.setDisplayed(true)` silently no-ops — including skipping the reconcile scheduling — even though the scrollbar was genuinely hidden and shown again in between.[^stale-idempotency-trace] `Scrollbar.setDisplayed` therefore owns its own idempotency check (via the overridden `isDisplayed()`) and calls `this.writeStyle({ displayed: true })` / `this.scheduleEffectiveVisibilityReconcile()` directly, mirroring `Component.setVisible`'s own shape rather than delegating to `super`.

### Order: the `ClassStyleRules.ts` fix must land before `Component.ownStyleStates` is declared, and `Scrollbar`'s step depends on the `protected` widening

The two scope items are not fully independent, so "prove it small on Scrollbar first" does not apply as cleanly as the investigation brief hoped: `Scrollbar.setDisplayed`'s design (previous decision) needs `scheduleEffectiveVisibilityReconcile` to already be `protected`, which is part of the `Component.ts` step. Within the `Component.ts` step itself, the `ClassStyleRules.ts` rule-naming fix must land *before* (or atomically with) `Component.ownStyleStates`'s declaration — declaring the state first, with the old `ctor.name` naming still in place, would generate an inert `.Component.invisible` rule and silently make every `setVisible(false)` call stop hiding anything visually while `isVisible()` still (correctly, per the getter design above) reports `false`. `## Ordered Implementation Steps` sequences this explicitly and adds a rule-selector assertion immediately after the state is declared, so this exact failure mode is caught mechanically rather than relying on a later visual check.

---

## Internal Structure

### `core/ClassStyleRules.ts` — root-scoped rule naming

```typescript
/** The `scope:"class"` rule-name a state-tier level resolves under —
 *  `ctor.name` for a normal class, but the universal `COMPONENT_CLASS`
 *  token for `_rootCtor` itself. `getStyleClassChain` never adds
 *  `_rootCtor`'s own name to any element's DOM classList, so a state
 *  `Component` declares directly needs a rule anchored to the one class
 *  token every rendered element actually carries — `ts-ui-component` — or
 *  the generated `.Component.<suffix>` selector would never match anything. */
function stateRuleName(ctor: Function): string {
    return ctor === _rootCtor ? COMPONENT_CLASS : ctor.name;
}
```

Used in place of the bare `.name` read in two spots:

- `resolveStateLevels` ([ClassStyleRules.ts:709](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L709)): `const name = stateRuleName(ctor);`
- `buildResolvedStates` ([ClassStyleRules.ts:812](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L812)): `const name = stateRuleName(declaringCtor);`

No other function in this file needs to change. `resolveStyleStates`'s own walk ([ClassStyleRules.ts:781-807](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L781-L807)) already checks `_rootCtor` for `ownStyleStates` before stopping (the loop's `while` condition tests `cur` *before* advancing past `_rootCtor`), so no change is needed there — confirmed by reading the loop, not assumed.

### `core/Component.ts` — the declared state, the getter, `setVisible`, and the render catch-up

```typescript
class Component<TOptions extends ComponentOptions = ComponentOptions> extends BaseObject {

    // The one state Component itself declares — see ARCHITECTURE.md's
    // "Component CSS tiers and state-rule dedup". setVisible(false) toggles
    // it instead of writing a per-instance `visibility: hidden` declaration.
    // Declared on the root class, not a concrete leaf — see the
    // `stateRuleName` fix in ClassStyleRules.ts this relies on.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".invisible",
            extract: (): StyleBag => ({ visible: false }),
        },
    ];

    // ...existing instance fields unchanged...
```

`isVisible()` ([Component.ts:1961](packages/lib/src/typescript/lib/core/Component.ts#L1961)):

```typescript
isVisible(): boolean | null {
    // `.invisible` is read from `_activeStates` directly rather than through
    // `resolveStyleValue`'s layer walk: a subclass that declares its own
    // `ownStyleStates` (Button, ToggleButton, ...) does not inherit
    // Component's `.invisible` entry into its own resolved list, so
    // `styleLayers()` never pushes that layer for such an instance. The
    // shared CSS rule still applies regardless (it matches on the universal
    // `ts-ui-component` token, not the concrete class name) — this check
    // only keeps the *getter* correct uniformly across every subclass.
    if (this._activeStates.has(".invisible")) {
        return false;
    }

    return this.resolveStyleValue("visible");
}
```

`setVisible()` ([Component.ts:1972-2003](packages/lib/src/typescript/lib/core/Component.ts#L1972-L2003)) — normalization unchanged, only the write path changes:

```typescript
setVisible(value: boolean | null): this {
    let normalized: boolean | undefined;
    if (Type.isBoolean(value as unknown as object)) {
        normalized = value as boolean;
    } else if (!value) {
        normalized = undefined;
    } else {
        throw new Error("Argument is not a boolean.");
    }

    const authored = normalized ?? null;

    if (this.isVisible() === authored && this.getElement()) {
        return this;
    }

    // Route the CSS side through the shared `.ts-ui-component.invisible`
    // class-tier rule instead of a per-instance `#id` declaration.
    // `_instanceStyle` is deliberately left untouched on the `false` branch
    // — caching it there would make a later full-sweep re-render treat it
    // as a genuine per-instance override again, reproducing the exact
    // duplicate rule this change removes. See `## Architecture Decisions`.
    this.setStyleState(".invisible", authored === false);

    if (authored !== false) {
        this.writeStyle({ visible: authored });
    }

    if (this.getElement()) {
        this.scheduleEffectiveVisibilityReconcile();
    }

    return this;
}
```

`scheduleEffectiveVisibilityReconcile` ([Component.ts:2152](packages/lib/src/typescript/lib/core/Component.ts#L2152)): change `private` to `protected`, no other change.

`_activeStates` field comment ([Component.ts:567-574](packages/lib/src/typescript/lib/core/Component.ts#L567-L574)) — the existing comment's closing clause ("`setStyleState` is never called before `super()` returns") becomes wrong once `setVisible` is dispatched by `applyOptions`, which *can* run mid-`super()`-cascade for a subclass. Replace it with:

```typescript
// Currently-active declared states (`.pressed`, `:hover`, `.selected`,
// `.invisible`, ...) — the selectors from this class's own `ownStyleStates`
// this instance has toggled on via `setStyleState`. Scanned by
// `styleLayers()` ahead of the instance layer, in declared order, so the
// first active entry wins. Plain initializer is safe even though
// `setVisible` (dispatched by `applyOptions`, itself called from
// Component's own constructor body, after `super()`) can reach
// `setStyleState` mid-cascade for any subclass under construction:
// `_activeStates` is one of Component's own fields, so it is already
// initialized by the time Component's constructor makes that call,
// regardless of which subclass is being built.
private _activeStates         : Set<string> = new Set();
```

`init()`'s classlist write ([Component.ts:6802](packages/lib/src/typescript/lib/core/Component.ts#L6802)):

```typescript
// Before:
DOM.sink.apply(element, { addClass: [COMPONENT_CLASS, ...getStyleClassChain(this.constructor), ...groupClass] });
```

```typescript
// After:
// Re-applies any declared state's DOM class token recorded before this
// element existed (e.g. setVisible(false) via the construction-time
// `visible` option) — setStyleState's own DOM write is gated on
// getElement(), so a state toggled during construction only updates
// `_activeStates` until this first render catches it up. Mirrors the
// per-class render() catch-up ToggleButton/ScrollArrowButton/ScrollbarThumb
// already do for their own states, generalised once here since `.invisible`
// is reachable from every concrete class.
const activeStateTokens = Array.from(this._activeStates)
    .filter((selector) => selector.startsWith("."))
    .map((selector) => selector.slice(1));
DOM.sink.apply(element, { addClass: [COMPONENT_CLASS, ...getStyleClassChain(this.constructor), ...groupClass, ...activeStateTokens] });
```

Import line ([Component.ts:25](packages/lib/src/typescript/lib/core/Component.ts#L25)) gains `type StyleStateSpec` alongside the existing `ClassStyleRules.js` imports.

### `component/container/Scrollbar.ts` — `Scrollbar.setDisplayed`

Added to `class Scrollbar` ([Scrollbar.ts:506](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L506)), mirroring where `ScrollArrowButton`/`ScrollbarThumb` place their own `ownStyleStates` in the same file:

```typescript
protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
    {
        selector: ".undisplayed",
        extract: (): StyleBag => ({ displayed: false }),
    },
];
```

```typescript
/**
 * Returns whether the scrollbar currently participates in layout — `false`
 * while `setMetrics` has hidden it because the content fits in the
 * viewport. Reads the `.undisplayed` state directly for the same reason
 * `Component.isVisible` reads `.invisible` directly — see
 * ARCHITECTURE.md's state-tier section.
 */
isDisplayed(): boolean {
    if (this.isStyleState(".undisplayed")) {
        return false;
    }

    return super.isDisplayed();
}

/**
 * Shows or hides the scrollbar using CSS display, routed through the shared
 * `.Scrollbar.undisplayed` class-tier rule instead of a per-instance `#id`
 * declaration — `setMetrics` calls this on every metrics update, and about
 * half of live scrollbars are undisplayed at any moment. Does not delegate
 * to `super.setDisplayed` — see `## Architecture Decisions` for the stale
 * idempotency-check bug that would otherwise introduce.
 */
setDisplayed(value: boolean): this {
    const v = !!value;

    if (this.isDisplayed() === v && this.getElement()) {
        return this;
    }

    this.setStyleState(".undisplayed", v === false);

    if (v) {
        this.writeStyle({ displayed: true });
    }

    if (this.getElement()) {
        this.scheduleEffectiveVisibilityReconcile();
    }

    return this;
}
```

No `render()` override is added to `Scrollbar` — every current call site of `setMetrics` (`Panel.ts`, `VirtualScroller.ts`, `ContentBoxPanel.ts`'s demo) calls it only after layout, which requires the tree to already be rendered, and `Component.init()`'s generic catch-up (above) covers the case defensively regardless. No new imports are needed — `StyleBag`/`StyleStateSpec` are already imported in this file ([Scrollbar.ts:5](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L5)).

### `ARCHITECTURE.md` — the state-declaring-class enumeration

The *Component CSS tiers and state-rule dedup* section names every class that currently declares `ownStyleStates` in one sentence: "`Button` (`.pressed`, `:hover`), `ToggleButton` (`.selected`), ... `Scrollbar`'s arrow/thumb delegates (`.disabled`, `.hover`), `HeaderCell` (`:active`), and `Row` / `Cell` / `TreeRow`'s pooled per-record tints ... are the components that declare states today." Append `, `Component` itself (`.invisible`)` and `, `Scrollbar` (`.undisplayed`)` to that list so it stays accurate.

---

## Ordered Implementation Steps

1. **`core/ClassStyleRules.ts`: add `stateRuleName` and use it in `resolveStateLevels` and `buildResolvedStates`.** Per `## Internal Structure`.
   *Check:* `npm run typecheck` (from `packages/lib`).

2. **`core/Component.ts`: widen `scheduleEffectiveVisibilityReconcile` to `protected`.**
   *Check:* `grep -n "scheduleEffectiveVisibilityReconcile" packages/lib/src/typescript/lib/core/Component.ts` — confirm the single declaration now reads `protected`.

3. **`core/Component.ts`: add `type StyleStateSpec` to the `ClassStyleRules.js` import, then declare `ownStyleStates = [{ selector: ".invisible", extract: () => ({ visible: false }) }]` at the top of the class body.** Per `## Internal Structure`.
   *Check:* write a throwaway script or a quick test (folded into step 8) asserting `resolveStyleStates(Component)` — or, simpler, that constructing any two `Component`s, hiding both, produces the selector `.ts-ui-component.invisible` in the shared rule cache (`_ruleCacheHas` from `core/StyleTarget.ts`) — **do this check before moving on**, since a naming mistake here silently makes every hidden component render visible (see `## Architecture Decisions`, "Order").

4. **`core/Component.ts`: rewrite `isVisible()` and `setVisible()`.** Per `## Internal Structure`. Update the `_activeStates` field comment in the same edit (it directly documents the invariant this step changes).
   *Check:* `npm run typecheck`.

5. **`core/Component.ts`: extend `init()`'s `addClass` call with the active-state token sweep.** Per `## Internal Structure`.
   *Check:* `npm run typecheck`.

6. **`component/container/Scrollbar.ts`: declare `Scrollbar.ownStyleStates = [.undisplayed]` and add the `isDisplayed`/`setDisplayed` overrides.** Per `## Internal Structure`.
   *Check:* `npm run typecheck`. `grep -n "setDisplayed\|isDisplayed" packages/lib/src/typescript/lib/component/container/Scrollbar.ts` — confirm both overrides are present and `setMetrics` (line ~778) is unchanged (still calls `this.setDisplayed(overflow)`).

7. **`ARCHITECTURE.md`: append `Component` and `Scrollbar` to the state-declaring-class enumeration.** Per `## Internal Structure`.
   *Check:* `grep -n "declare states today" ARCHITECTURE.md` — confirm the sentence now names both.

8. **Add/extend tests.** See `## Expected Behaviour` and `## Verification` for the specific cases and files.
   *Check:* `npx vitest run` on each touched/new test file.

9. **Full verification.** See `## Verification`.

10. **Manual browser check.** Non-negotiable per this codebase's own convention for state-tier changes (`state-tier-rule-dedup-followups.md`'s step 9) — the offline harness cannot see a real cascade collision. See `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/ClassStyleRules.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/Scrollbar.ts` |
| Modify | `ARCHITECTURE.md` |
| Modify | `packages/lib/tests/component/EffectiveVisibility.test.ts` |
| Modify | `packages/lib/tests/core/StyleStates.test.ts` |
| Modify | `packages/lib/tests/component/container/Scrollbar.test.ts` |

---

## Expected Behaviour

All rows are unit-testable against the recording DOM sink (`installTestDOM`/`RecordingDOMSink`, `packages/lib/tests/dom/TestDOM.ts`) except row 10, which needs a live browser.

| # | Case | Expected |
|---|---|---|
| 1 | `new Component({ visible: false })`, never rendered | `isVisible()` returns `false` |
| 2 | Same, then `getElement(true)` (first render) | Element's classList contains `invisible`; `isVisible()` still `false` (this is the render-time catch-up in `init()`) |
| 3 | A rendered, initially-visible `Component`, then `setVisible(false)` | Element gains the `invisible` class; **no** write lands on this instance's own `#id`/`#id:not(...)` rule for `visibility` (assert via `declarationsDuring`, mirroring `StyleStates.test.ts`'s existing helper) |
| 4 | Two separate `Component` instances (or two different concrete subclasses, e.g. a bare `Component` and a `Panel`), both hidden | Both share one rule: `_ruleCacheHas('.ts-ui-component.invisible')` is `true`; neither instance's own `#id` rule carries a `visibility` declaration |
| 5 | `setVisible(true)` after `setVisible(false)` | `invisible` class removed; `isVisible()` returns `true`; no real `visibility` declaration written anywhere (the `writeStyle({visible:true})` branch only ever produces a harmless matching removal) |
| 6 | `setVisible(null)` | `isVisible()` returns `null`; same no-real-declaration behavior as case 5 |
| 7 | A class that declares its own `ownStyleStates` without restating `.invisible` (use `Button`, per the compatibility table) — `new Button("x", { visible: false })` | `isVisible()` returns `false` (via the `_activeStates` direct check, not `resolveStyleStates(Button)`); once rendered, the element still carries the `invisible` class and the shared `.ts-ui-component.invisible` rule still applies — hidden both at the JS-getter level and visually, with no restatement needed |
| 8 | `isEffectivelyVisible()` / `onEffectiveVisibilityChange` (the existing `EffectiveVisibility.test.ts` suite, cases 1-2 in that file) | All existing assertions keep passing unmodified — `isEffectivelyVisible()` calls `isVisible()` polymorphically, so it picks up the new getter automatically with no test change needed; add one new case confirming this explicitly for a component hidden via the new path |
| 9 | `Scrollbar.setMetrics` transitioning overflow `true → false → true → false` (four calls) | Each transition's `isDisplayed()` matches the call; the scrollbar's own `#id` rule never carries a `display` declaration at any point; the reconcile fires on every real transition (spy on `onEffectiveVisibilityChange` via the same `hookTarget` pattern `EffectiveVisibility.test.ts` uses) — this is the case that would fail under the rejected `super.setDisplayed`-delegating design (see `## Architecture Decisions`) |
| 10 | Manual: dev server, open a `Table`/`Tree`/scrolling `Panel` with a visible scrollbar, resize to trigger overflow on/off repeatedly; open the Style Audit panel | No `{ visibility: hidden; }` or `{ display: none; }` duplicate row for `Scrollbar`/general components remains; scrollbar and hidden content behave identically to before, visually |

---

## Verification

```
npm run typecheck       # packages/lib
npm run typecheck:test
npm test                # vitest run, includes typecheck:test
npm run lint
```

New/extended unit tests (row numbers refer to `## Expected Behaviour`):

- `packages/lib/tests/component/EffectiveVisibility.test.ts` — rows 1, 2, 5, 6, 8.
- `packages/lib/tests/core/StyleStates.test.ts` — rows 3, 4, 7 (this file already has the `declarationsDuring`/`_ruleCacheHas`/`touchesToken` helpers this plan's cases need — extend rather than duplicate).
- `packages/lib/tests/component/container/Scrollbar.test.ts` — row 9.

**Manual browser verification (row 10) is required.** Per this codebase's own convention for state-tier changes — start a dev server on a spare port from *this worktree* (see `feedback_dev_server_may_serve_a_worktree` / `feedback_worktree_browser_checks_load_main_tree_lib` class of gotcha: symlink `node_modules` or otherwise confirm the server is serving *this* worktree's `packages/lib`, not the main tree's). Open the Style Audit panel (`packages/lib/src/typescript/StyleAuditPanel.ts`, wired into the demo app) before and after exercising hide/show and scrollbar overflow toggling; confirm the `{ visibility: hidden; }` / `{ display: none; }` duplicate rows are gone or substantially reduced, and that nothing renders incorrectly.

---

## Documentation Impact

None. `setVisible`/`isVisible`/`setDisplayed`/`isDisplayed`'s public signatures and documented behavior are unchanged — this is an internal CSS-writing mechanism change only. No `docs:api` re-run is required beyond the standard `npm test`/`typecheck` gate, since no JSDoc on an exported symbol changes.

---

## Potential Challenges

- **`isRestingChromeIsolated()` flips to `true` for nearly every component class**, since `.invisible` now appears in `resolveStyleStates()` for any class that doesn't override `ownStyleStates`. `flushStyleBag`'s isolation branch (`this.restingStyleRule.set(...)`) lazily allocates a second `StyleRule`-plus-`Map`-entry per instance on first flush, previously only paid by Button/Scrollbar-family instances. This is *not* a correctness issue (every allocation ever produces only a harmless `null` write, per the "never cache `visible: false`" decision), but it is a real, universal per-instance allocation increase worth benchmarking on a large table before considering this done — no fix is proposed here; see `## Non-Goals`. Note this does **not** apply to Scrollbar's `.undisplayed`/`display`: `display` is already in `Component.ts`'s `SKIP_ON_MATCH_KEYS` set ([Component.ts:385-392](packages/lib/src/typescript/lib/core/Component.ts#L385-L392)), so the no-instance-override case for `display` short-circuits before ever reaching the isolation branch — an existing, unrelated optimization that happens to make the Scrollbar half of this plan strictly cheaper than the Component half.
- **The `stateRuleName` fix is easy to get subtly wrong** (e.g. applying it only in one of the two call sites) and the failure mode is silent — a hidden component keeps reporting `isVisible() === false` from `_activeStates` while remaining visually on-screen, since nothing but the CSS rule's selector match determines what's painted. Step 3's mid-implementation rule-cache check exists specifically to catch this immediately rather than at manual QA.
- **A future class that declares its own `ownStyleStates` and separately wants a per-instance `visibility` override** (no such class exists today) would need to reason about interaction with `.invisible` fresh, since this plan does not add `.invisible` to any exclusion-suffix list. Not a problem today (grepped: no class calls a hypothetical per-instance visibility setter — none exists), but worth a comment at the `ownStyleStates` declaration site for the next person, already included in `## Internal Structure`'s snippet.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) | `setVisible`/`isVisible` (1961-2003), `styleLayers`/`resolveStyleValue` (4890-5072), `writeStyle` (5004-5024), `flushStyleBag` (5284-5386), `isRestingChromeIsolated`/`restingIsolationKeys` (5497-5518), `setStyleState`/`isStyleState` (5564-5594), `init` (6781-6852) — every symbol this plan touches or reasons about |
| [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) | `resolveStateLevels`/`resolveStyleStates`/`buildResolvedStates` (681-838) — the mechanism being extended to a root-declared state, and the exact two call sites `stateRuleName` must patch |
| [`packages/lib/src/typescript/lib/component/container/Scrollbar.ts`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts) | `ScrollArrowButton.ownStyleStates`/`setDisabledState`/`render` (178-339) and `ScrollbarThumb.ownStyleStates`/`applyHoverState`/`render` (401-439) — the direct, current precedent both halves of this plan mirror; `Scrollbar.setMetrics` (772-778) is what this plan's second half changes |
| [ARCHITECTURE.md](ARCHITECTURE.md), *Component CSS tiers and state-rule dedup* | The governing rule this plan must conform to — specificity table, `ownStyleStates`/`resolveStyleStates` contract, hierarchy-aware resolution; also the file this plan's step 7 updates |
| [`plans/implemented/state-tier-full-unification.md`](plans/implemented/state-tier-full-unification.md) | The plan that produced the *current* `ownStyleStates`/`writeStateStyle`/`isRestingChromeIsolated` mechanism this plan builds on — read this, not `state-tier-rule-dedup-followups.md` (superseded, see `## Notes`) |
| [`packages/lib/tests/core/StyleStates.test.ts`](packages/lib/tests/core/StyleStates.test.ts) | The test-helper conventions (`declarationsDuring`, `_ruleCacheHas`, `touchesToken`, `idSelector`) this plan's new tests reuse |
| [`packages/lib/tests/component/EffectiveVisibility.test.ts`](packages/lib/tests/component/EffectiveVisibility.test.ts) | Existing `isVisible`/`isEffectivelyVisible`/reconcile coverage this plan must not regress |
| [`packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts`](packages/lib/src/typescript/lib/diagnostics/StyleAudit.ts) | The tool that found this duplication and the one to re-run for manual verification |

---

## Non-Goals

- **No change to any of the 17 files calling `.setVisible(false)`** (`Tab.ts`, `Card.ts`, `Border.ts`, `Accordion.ts`, `Split.ts`, `TabBar.ts`, `TabButton.ts`, `ScrollStrip.ts`, `AbstractChart.ts`, `DiagramView.ts`, `Tooltip.ts`, `Popover.ts`, `OverlayFade.ts`, `AnimatedDropdown.ts`, `Menu.ts`, `DropZoneOverlay.ts`, `AbstractWindow.ts` — re-verified current via grep). They call the same public `setVisible(false)`; nothing about their own code changes.
- **No restatement of `.invisible` in any of the 18 classes that declare their own `ownStyleStates`** (see `## Architecture Decisions`' compatibility table) — proven unnecessary by the `_activeStates`-direct-read getter design and the universal `ts-ui-component`-scoped rule.
- **No optimization of the `isRestingChromeIsolated()` per-instance allocation cost** flagged in `## Potential Challenges` — a real but separate concern; fixing it would mean touching `flushStyleBag`'s isolation-routing logic, a materially larger and riskier change than this plan's scope. Left for a follow-up if benchmarking shows it matters.
- **No change to `flushStyleBag`, `restingIsolationKeys`, or `isRestingChromeIsolated` themselves** — the design deliberately avoids needing to (see the "`_instanceStyle` is never written" decision).
- **No change to `getStyleClassChain`** — `.invisible`'s DOM token is applied entirely through `setStyleState`, independent of the class-name-chain mechanism `getStyleClassChain` owns.

---

## Notes

[^stale-plan]: `plans/implemented/state-tier-rule-dedup-followups.md` (an earlier, already-merged plan covering `WindowBorder`/`HeaderCell`/`ScrollArrowButton`/`ScrollbarThumb`) references `Component.createStateStyleRule`, `StateStyleRule`, and `getRestingExclusionSuffixes()` — none of which exist in the current source. `plans/implemented/state-tier-full-unification.md` retired that mechanism in favor of the current `ownStyleStates`/`writeStateStyle`/`isRestingChromeIsolated`/`restingIsolationKeys` shape this plan reads and extends. Confirmed by reading both plans and the current source directly; every citation in this plan is to current source or to `state-tier-full-unification.md`, never to the superseded plan's own code snippets.

[^resolveStyleStates-walk]: Confirmed by reading `resolveStyleStates` ([ClassStyleRules.ts:781-807](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L781-L807)) directly: its `while` loop checks `ownStyleStatesOf(cur)` for `cur = concreteCtor`, then walks `Object.getPrototypeOf` upward: `cur = cur === _rootCtor ? null : canonicalCtor(Object.getPrototypeOf(cur))`. Because the check happens *before* this advance, `cur === _rootCtor` (i.e. `Component`) is itself checked on the final loop iteration before the walk terminates — so a class with no `ownStyleStates` anywhere in its own chain correctly resolves `Component`'s declared list with zero changes to this function. `resolveStateLevels`'s own recursive walk ([:681-744](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L681-L744)) has the identical property for content resolution. Both were traced by hand against `Component` declaring `ownStyleStates` to confirm this before relying on it.

[^why-not-getStyleClassChain]: An alternative considered: widen `getStyleClassChain` to include `Component`'s own name after all, so `.Component.invisible` would match. Rejected — `getStyleClassChain`'s exclusion of `Component`'s name is a deliberate, documented invariant ([ClassStyleRules.ts:143-152](packages/lib/src/typescript/lib/core/ClassStyleRules.ts#L143-L152): "Component was never a meaningful CSS-styling target before this plan... this mechanism preserves that") serving the *resting*-tier class-chain mechanism, unrelated to state rules; changing it would add a literal `Component` class to every element's DOM classList, a much larger and unrelated blast-radius change for no benefit over the three-line `stateRuleName` helper.

[^why-not-generic-flush]: An alternative considered: instead of special-casing `isVisible()`, make `flushStyleBag`'s dedup comparison (`layersBelowInstance`) also consult the active state layer, so `resolveStyleValue` would work generically for any class regardless of its own `ownStyleStates` list. Rejected — `layersBelowInstance`'s exclusion of the state layer is itself a deliberate, documented contract (its own comment: callers need "does a tier *other than this instance's own* already supply this value", explicitly not a meta-class layer's) that other call sites (`matchesLowerTier`, `Button`'s pinned-pressed-chrome writes) rely on for correctness reasons unrelated to this plan. Changing it is a much higher-blast-radius edit to core dedup logic than the two-line `isVisible()` special-case, for a codebase-wide semantic change this plan does not need.

[^stale-idempotency-trace]: Traced by hand: instance starts with `_instanceStyle.displayed` unset. Call 1 (`overflow=false`, hide): `.undisplayed` activated, `_instanceStyle.displayed` left unset (per design). Call 2 (`overflow=true`, show): a naive `super.setDisplayed(true)` finds `_instanceStyle.displayed !== true` (unset), so it proceeds normally — `_instanceStyle.displayed` becomes `true`. Call 3 (`overflow=false`, hide again): `.undisplayed` activated again, `_instanceStyle.displayed` still `true` (stale, untouched). Call 4 (`overflow=true`, show again): a naive `super.setDisplayed(true)` now finds `_instanceStyle.displayed === true` *already* — its own idempotency guard short-circuits, skipping both the `writeStyle` call and the reconcile scheduling, even though the scrollbar was genuinely hidden in call 3 and needs to be shown and reconciled again.
