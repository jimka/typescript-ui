---
touches-shared:
  - packages/lib/src/typescript/lib/component/container/SplitGutter.ts
  - packages/lib/src/typescript/lib/layout/Accordion.ts
  - packages/lib/src/typescript/lib/core/Panel.ts
---

# Split, Accordion, and Panel Resize/Scroll Convergence — Implementation Plan

## Overview

This is the design-decision sibling to [`overlay-positioning-and-window-cleanup.md`](overlay-positioning-and-window-cleanup.md), which extracted a shared viewport-drag-listener helper (`beginViewportDrag`/`endViewportDrag` in [`core/PointerDrag.ts`](packages/lib/src/typescript/lib/core/PointerDrag.ts)) for `WindowBorder` and `SplitGutter`, but explicitly left `Split` and `Accordion`'s own resize/clamp/collapse arithmetic for this plan.

This plan covers six things, verified independently against current source: whether `Split` ([`layout/Split.ts`](packages/lib/src/typescript/lib/layout/Split.ts)) and `Accordion` ([`layout/Accordion.ts`](packages/lib/src/typescript/lib/layout/Accordion.ts)) should converge their drag, clamp, and collapse-animation mechanics beyond the `SplitGutter`/`PointerDrag.ts` plumbing they already share; a real scrollbar-layout duplication between `Panel` ([`core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts)) and `VirtualScroller` ([`component/container/VirtualScroller.ts`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts)); a real cross-axis overrun bug in `HBox`'s item-align branch; a lifecycle-notification question in `Component.ts` that turned out not to be a bug; a missing cancellation handle on `Component.afterNextLayout`; and a StyleAudit sweep across six components that still write per-instance CSS a migrated sibling already shows how to hoist.

Two of these findings, verified against current code, turned out not to be bugs at all (`Component.removeAllComponents`'s "no layout" contract, and `insertComponent`/`removeComponent`'s early-return difference) — both are recorded as investigated-and-rejected rather than silently dropped, per `## Architecture Decisions`.

---

## Architecture Decisions

### Split's and Accordion's live-drag math stay separate — different topologies, not merely style

[`Split.onDrag`](packages/lib/src/typescript/lib/layout/Split.ts#L1015-L1063) moves exactly two adjacent panes per gutter: it clamps `newLhs` against the room the fixed partner pane's own `[min, max]` leaves, computed once from an absolute drag origin (`_dragOriginLhsSize`/`_dragOriginRhsSize`/`_dragOriginPointer`, captured in `onDragStart`). [`Accordion.onGutterDrag`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1828-L1923) must instead fan a drag outward across every open section on either side of the gutter — a maxed-out or minned section passes the remaining travel to the next one, nearest first — which needs a variable-length ordered group, not a fixed pair. `Split` never chains past its two immediate neighbours, even when more panes exist further out. These are genuinely different problems: one is "clamp a pair," the other is "distribute across a run." Keep them separate; unifying them would either strip `Accordion`'s chaining or add unwanted chaining to `Split`.

The two also compute a frame's delta differently, which is a separate axis from the chaining question. `Split` recomputes `newLhs` fresh from the absolute origin every frame; `Accordion` accumulates incremental per-frame deltas via `_dragLastPointer`, advanced only by the amount actually applied. This is what produces the dead zone Accordion's own comment names: "dragging further past the limit accrues a dead zone the pointer must retrace... (Split/Border get this for free from their absolute origin+offset model.)"[^dead-zone-followup] Fixing that is a live-drag behaviour change to `Accordion`, not a duplication cleanup, so it stays out of this plan — see `## Non-Goals`.

### `DragChain` cannot serve `Split` without changing its behaviour

[`core/DragChain.ts`](packages/lib/src/typescript/lib/core/DragChain.ts)'s own module doc names `Accordion` and `Table` as its two consumers — both need the same nearest-first, nothing-scoped-to-a-pair chaining `Split` deliberately doesn't have. Checked: `Split.onDrag` never looks past `lhs`/`rhs`, by design (a gutter only ever moves its two immediate panes). Routing `Split` through `DragChain` would introduce chain-fanning to a manager that has never had it — a behaviour change, not a refactor. Not done.

### Accordion's section-toggle animation stays independent of `CollapseSupport`; only the easing constant converges

[`CollapseSupport.runCollapse`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L438-L485) drives `Split.setPaneCollapsed` and `Border.setRegionCollapsed` with a JS `requestAnimationFrame` loop that interpolates every participant's box and re-runs `doLayout` on each content-bearing pane every frame. That per-frame `doLayout` exists because a pane's children are positioned by the framework's own absolute layout, not CSS: without re-laying-out on every frame, a child would sit at its *final* position while its parent's box is still visually mid-transition, and glitch.

[`Accordion`'s section toggle](packages/lib/src/typescript/lib/layout/Accordion.ts#L2586-L2694) (`primeWrapper`/`setSectionTransitions`) instead installs native CSS `height`/`top` transitions directly on every header, panel wrapper, and content component, and lets the browser animate them — no `requestAnimationFrame`, no per-frame `doLayout`. This works for Accordion specifically because a section toggle only ever changes `top`/`height` on a simple vertical stack; it never needs synchronized multi-pane box interpolation the way an arbitrary two-pane `Split`/`Border` resize does.

These are two different, independently-load-bearing animation techniques, not two implementations of one idea — moving Accordion onto `runCollapse` would replace a simpler, working, native-transition mechanism with a heavier per-frame JS one for no demonstrated benefit, and risks reintroducing exactly the "content vanished mid-transition" class of bug `runCollapse` itself exists to avoid (in the other direction: over-driving a case that doesn't need it). Not merged.

The one piece that genuinely is the same value, declared as intentionally shared and not actually shared: [`CollapseSupport.ts`'s `COLLAPSE_EASING`](packages/lib/src/typescript/lib/layout/CollapseSupport.ts#L25) (`"cubic-bezier(0.4, 0, 0.6, 1)"`) has a comment reading *"Mirrors the Accordion's 200ms default so the two surfaces share one motion personality... Shared with Accordion deliberately for a consistent feel"* — yet [`Accordion.ts`'s `ACCORDION_EASING`](packages/lib/src/typescript/lib/layout/Accordion.ts#L45) is a byte-identical second copy of the same string. `CollapseSupport.ts` exports `COLLAPSE_EASING`; `Accordion.ts` imports it under its existing local name instead of re-declaring it. `COLLAPSE_DURATION`/`_animationDuration` are *not* merged — `Accordion._animationDuration` is a mutable, per-instance, publicly-configurable field (`setAnimationDuration`), while `COLLAPSE_DURATION` is a fixed module constant Split/Border never expose a setter for; they are different kinds of value that happen to default to the same number.

### The weight pin/refill mirror stays a mirror — the original reasoning still holds

[`plans/implemented/accordion-resize-weight.md`](plans/implemented/accordion-resize-weight.md) already investigated sharing `Split.effectiveResizeWeight`'s resolver with `Accordion` and deliberately built `Accordion.effectiveWeight`/`resizePinnedSections` as a parallel implementation instead, for two reasons that are still true today: the two managers read an *unset* weight differently on purpose (`Accordion` reads `?? 0`, matching `HBox`/`VBox`; `Split`'s own JSDoc calls out that it reads the raw constraint instead, so an unset pane falls through to a proportional fallback rather than pinning) — this is a documented, permanent semantic difference, not an artifact of when the plan was written. The two also use different resize models: `Split.recalculateSizes` tracks a delta against `_lastAvailableMain`; `Accordion.distributeWithinConstraints` rescales its full stored-to-budget ratio every layout, an idempotent model the accordion plan chose specifically to keep resize round trips lossless. Both mechanisms have shipped and run in production since; nothing found in this investigation shows drift between them or a case the mirror handles incorrectly. Reaffirmed separate — no code change.

### Accordion's dead `SplitGutter`-workaround is removed now that `dragend` exists

`SplitGutter` gained a `"dragend"` event on 2026-07-17 (commit `40a63f31`), used today at [`Split.ts:1448`](packages/lib/src/typescript/lib/layout/Split.ts#L1448) (`gutter.on("dragend", () => this.onDragEnd());`). [`plans/implemented/accordion-resizable-sections.md`](plans/implemented/accordion-resizable-sections.md) (`## Potential Challenges → Drag-end signal`), written three days *before* that commit, explicitly considered adding a `dragend` event to `SplitGutter` and rejected it — *"Prefer (a) [a viewport `mouseup`/`touchend` listener registered from `onGutterDragStart`] to keep the change inside `Accordion`"* — because at the time, adding the event meant touching a shared component with no consumer yet. That cost has since been paid by someone else for an unrelated reason (`Split`'s own need).

The result today is [`Accordion.onGutterDragStart`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1761-L1804) registering its own `mouseup`/`touchend`/`touchcancel` viewport listeners on the *container* (keyed there, with a comment explaining why, because `Accordion` is a `LayoutManager` and cannot key `Event.addViewportListener` on itself the way a `Component` does), removed again in [`onGutterDragEnd`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1937-L1955), plus the `_boundOnGutterDragEnd` field that exists only to give that registration a stable reference. `SplitGutter.onDragStop` already registers the identical three viewport events on *itself* and already returns `true`, consuming the mouseup — Accordion's copy is now pure overhead. Removed: `gutter.on("dragend", () => this.onGutterDragEnd())` is wired once, in [`getOrCreateResizeGutter`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1710-L1729), next to the gutter's existing `"dragstart"`/`"drag"` listeners — the same three-listener shape `Split.ts:1442-1448` already uses for the same three events on the same component.

The removed mechanism was covered by [`tests/dom/viewport-consume.test.ts`](packages/lib/tests/dom/viewport-consume.test.ts), a dedicated file (its own header comment explains why: `Event`'s viewport-listener map is module-level state that `DOM.reset()` doesn't clear, so a dispatch-level test like this one needs a fresh module registry, which Vitest only gives per file) whose one test pinned a historical bug: a bound wrapper that silently dropped `onGutterDragEnd`'s `true` return (an early, brace-bodied version of `_boundOnGutterDragEnd` before it became a concise-return arrow). That specific regression class cannot recur once the container-viewport mechanism is gone — there is no wrapper left in Accordion's drag-end path to drop a return value from. The test is retargeted, not deleted outright, to keep dispatch-level coverage of the *shared* mechanism every consumer (`Split`, `Border`, `Accordion`) now depends on: `SplitGutter.onDragStop` returning `true` and stopping native propagation.[^viewport-consume-retarget]

### Panel's and VirtualScroller's scrollbar-layout algorithm stays separate; the two genuinely-shared pieces converge

[`plans/implemented/overlay-scrollbar-cross-axis-overlap.md`](plans/implemented/overlay-scrollbar-cross-axis-overlap.md) already states what does and doesn't transfer from `VirtualScroller` to `Panel`: the two-element structure (an inset scroll region plus bars as outer siblings) and trailing-edge bar placement transfer; the scroll mechanism does not. `Panel` scrolls its inner element natively (`overflow: auto`), so [`layoutOverlayScrollbars`](packages/lib/src/typescript/lib/core/Panel.ts#L1229-L1307) reads live browser-computed `scrollHeight`/`clientHeight` and lets the vertical/horizontal mutual dependency converge *across* `doLayout` passes via `scheduleLayout()` (its own single-pass-plus-reconverge). `VirtualScroller` scrolls by moving a CSS `transform` on `rowsContainer`, with "content size" fed in as plain numbers by its owner (`Body.ts`/`Tree.ts`); its [`computeScrollbarVisibility`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L299-L327) converges the same mutual dependency with a 2-iteration in-memory loop, no DOM round trip needed. This is a genuine fork in how each reads "how much room is there," not an oversight — forcing one to call the other would invert whichever one's model lost. Kept separate.

Two pieces underneath that algorithm are not forked, though, and are needlessly duplicated:

- `ScrollShadowEdges` — declared identically in both files (`{ top: number; bottom: number; left: number; right: number }`), pure structure, zero logic. Moves to [`core/ScrollShadow.ts`](packages/lib/src/typescript/lib/core/ScrollShadow.ts), which already owns every other piece of the shared shadow recipe (`scrollShadowRamp`, `scrollShadowBoxShadow`, `scrollShadowEdgeValue`) and already documents itself as the place drift-prone shared maths belongs — this type fits that description exactly, and its module doc's *"each owner keeps its own... per-edge cache"* is unaffected: only the type moves, each owner still holds its own instance of it.
- `setShadowEdge`'s body — identical in both files (`Math.round(strength * 100)`, skip if unchanged, cache the new value) except the final write, which must differ: `Panel` is a `Component` and writes through its typed style-bag path (`this._shadowOverlayStyle.set(...)`); `VirtualScroller` is explicitly documented as a non-`Component` raw-DOM helper (ARCHITECTURE.md's typed-setter rule doesn't apply to it) and writes via `DOM.sink.apply(...)` directly. The quantize-and-dedupe half extracts to `core/ScrollShadow.ts` as `quantizeShadowEdge`; each caller keeps its own one-line final write.

### HBox's item-align branch is fixed to match VBox's (already-correct) behaviour

Confirmed by reading both files' `layoutPreferredMode` in full, not just the reviewer's write-up: `VBox`'s `itemAlign` branch ([VBox.ts:514-517](packages/lib/src/typescript/lib/layout/VBox.ts#L514-L517)) offsets and sizes a child using `naturalWidth`, capped to the *trimmed* `crossExtent` (`containerSize.width` minus left/right insets). `HBox`'s equivalent branch ([HBox.ts:540-543](packages/lib/src/typescript/lib/layout/HBox.ts#L540-L543)) uses `heights[idx]` instead, which was capped only to the *untrimmed* `containerSize.height` — even though `HBox` already computes its own trimmed-and-capped `naturalCross` one branch above ([HBox.ts:528-536](packages/lib/src/typescript/lib/layout/HBox.ts#L528-L536)) and already uses it correctly in the sibling `cross`-truthy branch just before. `VBox` is the correct one: `HBox`'s own `naturalCross` computation matches it exactly, and the bug is that the `itemAlign` branch two lines later reaches for the wrong variable it had already computed correctly nearby. With non-zero top/bottom insets and `itemAlign: "start"|"center"|"end"`, an `HBox` child whose preferred height sits between the trimmed and untrimmed extents overruns the bottom inset; the `VBox` twin does not. Fixed by replacing `heights[idx]` with `naturalCross` at both call sites in that branch — no change to how `naturalCross` itself is computed, and no change to the default/baseline branch just below, which both files deliberately keep on the untrimmed extent (see `HBox.ts`'s and `VBox.ts`'s own comments on that branch — unaffected by this fix).

### `removeAllComponents`'s "no layout" contract is intentional — verified, not a bug

[`Component.removeAllComponents`](packages/lib/src/typescript/lib/core/Component.ts#L6509-L6517) indeed fires neither `scheduleLayout()` nor `_onPreferredSizeChange?.()`, unlike `insertComponent`/`removeComponent`. But its own JSDoc already says *"without triggering layout,"* and this is not incidental: [`plans/implemented/core-component-lifecycle-and-size-fixes.md`](plans/implemented/core-component-lifecycle-and-size-fixes.md) revisited this exact method for an unrelated per-child leak fix and *explicitly declared*, in its own `## Non-Goals`, *"No behavioural change to `removeAllComponents`'s layout scheduling — it stays 'without triggering layout'"* — because every caller (`Button`'s content rebuild, `MenuBar`/`Menu`'s clear-then-rebuild, `Header`'s row rebuild, calendar/picker refills) clears and immediately repopulates, and a scheduleLayout on every intermediate clear would thrash. That plan's own test suite pins zero `scheduleLayout` calls from this method. `disposeAllComponents` ([Component.ts:6533-6539](packages/lib/src/typescript/lib/core/Component.ts#L6533-L6539)) delegates to `removeAllComponents` and [`plans/implemented/dispose-all-components.md`](plans/implemented/dispose-all-components.md) independently pins the same inherited contract with its own test. Overriding either now would silently contradict two already-shipped, already-tested decisions to save one caller from a hypothetical stale-ancestor-size case that no named consumer of either method actually hits (every current call site is a clear-then-rebuild). No code change.

### `insertComponent`/`removeComponent`'s early-return difference is not a bug

[`insertComponent`](packages/lib/src/typescript/lib/core/Component.ts#L6377-L6412) returns early, skipping both notifications, when `this` has no element yet; [`removeComponent`](packages/lib/src/typescript/lib/core/Component.ts#L6483-L6498) notifies unconditionally. `scheduleLayout()` ([Component.ts:6874-6885](packages/lib/src/typescript/lib/core/Component.ts#L6874-L6885)) has no element check at all — it is always safe to call, elementless or not, since `flushPendingLayouts` separately guards on `c.getElement()` before calling `doLayout()`. So `insertComponent`'s early return isn't there to protect the notification calls from an elementless container; it's there because the *DOM attachment* work below it (forcing the new child's element into existence and inserting it into a host that doesn't exist yet) has nothing to do when `this` has no element, and the notification skip rides along with that early return incidentally. `removeComponent` has no equivalent DOM-attachment step to skip, so nothing gates its notification calls — there's no parallel early-return point for it to share. Both are correct as written; no code change.

### `Component.afterNextLayout` gains a cancellation handle

[`Component.afterNextLayout`](packages/lib/src/typescript/lib/core/Component.ts#L6930-L6933) pushes a bare callback onto a module-level array (`afterLayoutCallbacks`) drained, unfiltered, on the next layout flush — there is no way to withdraw a queued callback. Two consumers already hand-roll a workaround because of this: [`packages/docs/src/shell/DocsDemo.ts`](packages/docs/src/shell/DocsDemo.ts#L27-L45) carries a `_disposed` boolean checked inside the queued callback; [`Dialog.ts`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L920) / [`Dialog.ts:930`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L930) register two bare inline arrows with no guard at all — safe today only because `resizeToContent()` and `focusFirst()` both happen to null-check their own element internally, which is incidental, not a contract. `DocsShell.ts`/`DocsContent.ts` name their callbacks with a "stable reference" comment that reads like a guard but isn't one — `afterNextLayout` has no `off()`/removal-by-reference concept for a stable reference to serve, so both are, today, exactly as unguarded as `Dialog.ts`.

Adding a cancel handle to `afterNextLayout` itself, mirroring [`Animation.CancelHandle`](packages/lib/src/typescript/lib/core/Animation.ts#L387-L390)'s shape (`{ cancel(): void }`), is low-risk: every one of the method's current call sites already discards its return value (`void`-returning callers ignoring a new non-`void` return is always legal), and the drain-side change is a few lines mirroring `Animation.play`'s own `cancelled`-flag closure — a pattern already proven in the same `core/` area. `Component.ts` cannot import `Animation.ts`'s type directly (`Animation.ts` imports `Component.ts`, so the reverse import would be circular); the handle is a small inline-typed return instead, not a shared named export.

With the handle available, every named consumer converges onto it rather than hand-rolling its own guard: `Dialog.ts`'s two sites store and cancel their handles in `destructor()`, the same place it already cancels its panel/backdrop animations. `DocsDemo.ts`'s `_disposed` flag is retired in favour of storing and cancelling the one handle its single toggle can have in flight.[^docsdemo-single-handle] `DocsShell.ts`/`DocsContent.ts` gain the same guard for consistency, even though neither is ever actually disposed in the running app today (both are constructed once, at startup, and live for the app's lifetime) — the fix is cheap and completes what the primitive is for, rather than leaving two call sites that look guarded but aren't. `Markdown.ts`'s two `afterNextLayout` call sites are out of scope — see `## Non-Goals`.

### StyleAudit residue: five of six components migrate onto the class tier; Panel's is not a genuine duplicate

Checked all six candidates from the finding against current source (StyleAudit is a separate, fast-moving campaign, so some may already have moved). One (`Panel`) turned out not to be real duplication at all. The other five genuinely are, and each migrates — but for most of them, only *part* of what they write is a confirmed `StyleBag` field; the rest stays a per-instance write, for a reason stated per component below rather than as a blanket exclusion.

- **`Panel.ts`'s two `scrollbar-width:none` writes are not a duplicate.** [`ensureOverlayScrollerClassRule`](packages/lib/src/typescript/lib/core/Panel.ts#L141-L158) is a shared class rule for the *inner scroller* `<div>` `installOverlayScrollbars` creates — a genuinely constant, always-on rule, correctly shared. [`setNativeScrollbarHidden`](packages/lib/src/typescript/lib/core/Panel.ts#L1205-L1208) writes the same two declarations, but on the *Panel's own element*, and only while overlay scrolling is installed — a real per-instance runtime toggle, not a static default. They target different elements for different reasons; forcing the second into a class-tier rule doesn't fit anyway, since `ownStyleStates`' `{selector, extract}` shape builds one rule on the *same* element the toggle class is set on and has no way to also target a `::-webkit-scrollbar` pseudo-element scoped under it. Left as-is — investigated, not a violation.
- **`SplitGutter.ts`'s `.opaque` chrome** ([SplitGutter.ts:329-336](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L329-L336)) is three constant declarations (`backgroundColor`, `backgroundImage`, `border`) written per-instance every time a gutter collapses into its strip state — the same shape [`WindowBorder.ts`'s `.snap-target`](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L85-L90) and [`Scrollbar.ts`'s `ScrollArrowButton.disabled`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L191-L198) already migrate. Migrates via `ownStyleStates`. The gutter's *other* two per-instance writes stay exactly as they are: line 156's `_expandedBackground` is a genuine per-caller value (`Border` passes `"transparent"`, others can override it), and `applyCursor` ([SplitGutter.ts:620-623](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L620-L623)) derives from `this.dragCursor()`, itself derived from the instance's own drag axis — neither is a class-level constant.
- **`Menu.ts`'s persistent/rebuild chrome** ([Menu.ts:863-888](packages/lib/src/typescript/lib/overlay/Menu.ts#L863-L888)) is two mutually-exclusive constant bags, chosen once at construction (`_persistent`, set once, never retoggled) and never touched again. `borderRadius` and `setInsets(new Insets(4, 0, 4, 0))` are identical between the two modes; `backgroundColor`/`border`/`shadow` differ only in which theme token they read; `setVisible(false)` (rebuild-only) and `getAria().setRole("menu")` (persistent-only) aren't style writes at all. Checked against `StyleBag`'s actual field list (`core/ClassStyleRules.ts:44-93`): `borderRadius`, `padding` (the field `setInsets` writes through), `backgroundColor`, `border`, and `shadow` are all present; `contain` is not a `StyleBag` field at all — `Component.setContain` has no class-tier counterpart anywhere in this codebase today. `borderRadius: "var(--ts-ui-border-radius, 4px)"` and `padding: new Insets(4, 0, 4, 0)` hoist to a resting-tier `ownClassStyleDefaults`, following [`PopupPanel.ts`](packages/lib/src/typescript/lib/overlay/PopupPanel.ts#L88)'s exact pattern (`Menu extends Component` directly, not `PopupPanel`/`AnimatedDropdown` — those are cited only as the nearest migrated analogues, not ancestors). `backgroundColor`/`border`/`shadow` migrate via a `.persistent` `ownStyleStates` entry (rebuild mode's values are the resting default; persistent mode's are the state override — set once at construction via `setStyleState(".persistent", true)`, which `ownStyleStates` supports even though this "state" is never toggled again after that). `setContain("layout")` is **not** migrated — there is no field to migrate it to; left as a per-instance write.
- **`CollapseButton.ts`'s `setStripMode`** ([CollapseButton.ts:242](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L242)) writes one constant declaration (`width: COLLAPSE_STRIP_SIZE + "px"` vs. unset) as a two-value boolean toggle — a clean `ownStyleStates` candidate, migrated. The module-level `StyleRule` ([CollapseButton.ts:88-128](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L88-L128)) and `applyRotation` ([CollapseButton.ts:222](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L222)) are **not** touched — see `## Non-Goals`.
- **`ScrollStrip.ts`'s arrow-button chrome** ([ScrollStrip.ts:477-491](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L477-L491)) writes six constant declarations onto two plain `Button` instances (`lead`/`trail`) every time the strip lays out. Unlike the other items here, there is no existing class to hang a static field on — `lead`/`trail` are bare `Button`s. `Scrollbar.ts` solved the identical problem for its own arrows by introducing dedicated subclasses (`ScrollArrowButton`, `ScrollArrowGlyph`) purely to have a class name for the shared chrome to attach to. `ScrollStrip` follows the same shape: a new `ScrollStripArrowButton extends Button` (declared in `ScrollStrip.ts`, not exported) carries four of the six declarations (`backgroundImage`, cleared border, cleared shadow, `borderRadius: "0"`) as `ownClassStyleDefaults` — all four confirmed `StyleBag` fields. The remaining two, `clearInsets()` and `setZIndex(3)`, stay per-instance constructor-body calls on the subclass: `zIndex` has no `StyleBag` field at all, and `clearInsets`'s exact mapping onto `StyleBag.padding` was not verified closely enough to rely on here (see `## Non-Goals`). `_arrowBackground` (genuinely per-instance, set via the public `setArrowBackground`) stays a per-instance setter call, exactly as it is today.
- **`AccordionIndicator.ts`** ([AccordionIndicator.ts:36-64](packages/lib/src/typescript/lib/component/container/AccordionIndicator.ts#L36-L64)): its `.expanded` toggle already uses `ownStyleStates` correctly ([AccordionIndicator.ts:88-93](packages/lib/src/typescript/lib/component/container/AccordionIndicator.ts#L88-L93)) — only the resting tier is still a hand-rolled module `StyleRule`. Of its five resting declarations, three are confirmed `StyleBag` fields: `color` (→ `foregroundColor`), `fontSize` and `textAlign` (both nested under `StyleBag.font`, following the exact `font: { fontSize, lineHeight, textAlign }` shape [`Scrollbar.ts`'s `ScrollArrowGlyph`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts) already uses). These three migrate to `ownClassStyleDefaults`. `pointerEvents` and `transition` are **not** `StyleBag` fields (checked against `core/ClassStyleRules.ts:44-93` — neither appears) — the hand-rolled module rule stays, but shrinks to carry only these two declarations, following the same split `ResizeHandle.ts` uses between its hand-rolled geometry rule and its setter-backed values.

---

## Public API

```typescript
// packages/lib/src/typescript/lib/layout/CollapseSupport.ts
export const COLLAPSE_EASING: string;   // was module-private; now exported
```

```typescript
// packages/lib/src/typescript/lib/core/ScrollShadow.ts — NEW exports

/** Per-edge scroll-shadow strength, quantised to a whole percent (0-100). Shared shape; each owner (Panel, VirtualScroller) keeps its own instance. */
export interface ScrollShadowEdges {
    top:    number;
    bottom: number;
    left:   number;
    right:  number;
}

/**
 * Quantises a 0-1 edge strength to a whole percentage and reports whether it
 * differs from the cached value for that edge, updating the cache in place
 * when it does.
 *
 * @param edges - The owner's own per-edge percentage cache; mutated in place.
 * @param edge - Which edge's cached percentage to check and update.
 * @param strength - The edge's raw 0-1 strength.
 * @returns The new percentage when it changed, or `null` when unchanged (nothing to write).
 */
export function quantizeShadowEdge(edges: ScrollShadowEdges, edge: keyof ScrollShadowEdges, strength: number): number | null;
```

```typescript
// packages/lib/src/typescript/lib/core/Component.ts — signature change

/**
 * Runs a callback once, after the next batched layout flush completes.
 * Returns a handle whose `cancel()` withdraws the callback before it fires;
 * calling `cancel()` after the callback has already run is a no-op.
 */
static afterNextLayout(callback: () => void): { cancel(): void };
```

No other exported signatures change. `HBox`, `SplitGutter`, `Menu`, `CollapseButton`, `AccordionIndicator`, `ScrollStrip`, `Panel`, `VirtualScroller`, `Accordion`, `Split` all keep their current public surfaces — every other change in this plan is internal.

---

## Internal Structure

### `Accordion.ts` — wire `SplitGutter`'s own `dragend`, drop the container-viewport workaround

In [`getOrCreateResizeGutter`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1710-L1729), next to the existing `gutter.on("dragstart", ...)` / `gutter.on("drag", ...)`:

```typescript
gutter.on("dragend", () => this.onGutterDragEnd());
```

Delete, in [`onGutterDragStart`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1761-L1804): the `container` lookup and the three `Event.addViewportListener(container, ...)` calls (lines 1797-1803), and their preceding comment block.

Delete, in [`onGutterDragEnd`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1937-L1955): the `container` lookup and the three `Event.removeViewportListener(container, ...)` calls (the `if (container) { ... }` block).

Delete the `_boundOnGutterDragEnd` field and its comment block ([Accordion.ts:232-238](packages/lib/src/typescript/lib/layout/Accordion.ts#L232-L238)) — it becomes unused once nothing keys a viewport-listener registration on it.

`onGutterDragEnd()`'s own body (the `wasDragging`/`_dragUpper`/`_dragLower`/`sectionresize` logic) and its direct call from `detach()` ([Accordion.ts:1140-1141](packages/lib/src/typescript/lib/layout/Accordion.ts#L1140-L1141)) are unchanged.

### `Accordion.ts` — import the shared easing constant

Delete line 45: `const ACCORDION_EASING: string = "cubic-bezier(0.4, 0, 0.6, 1)";`

Add, near the other `~/layout/` imports:

```typescript
import { COLLAPSE_EASING as ACCORDION_EASING } from "~/layout/CollapseSupport.js";
```

Every existing `ACCORDION_EASING` usage site in `Accordion.ts` is unchanged — the alias keeps the local name.

### `CollapseSupport.ts` — export the constant

```typescript
// was: const COLLAPSE_EASING = "cubic-bezier(0.4, 0, 0.6, 1)";
export const COLLAPSE_EASING = "cubic-bezier(0.4, 0, 0.6, 1)";
```

No other change to the file.

### `packages/lib/tests/dom/viewport-consume.test.ts` — retarget from Accordion to SplitGutter

Replace the file's imports (`Container`, `Component`, `Accordion`, `AccordionConstraints`) and its one `describe` block with a `SplitGutter`-level equivalent, keeping the file's own `installTestDOM`/`makeEvent`/`DOM.reset()` idiom and its header comment's reasoning about why this needs a dedicated file (still accurate — unrelated to this retarget):

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { SplitGutter } from '~/component/container/SplitGutter';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('SplitGutter — drag end consumes its viewport event', () => {
    afterEach(() => DOM.reset());

    it('stops native propagation of the mouseup that ends a drag', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        gutter.getElement(true);

        gutter.onDragStart({ clientX: 10 } as MouseEvent);

        let nativeStops = 0;
        const evt = makeEvent(gutter.getElement()!, 'mouseup');
        (evt as unknown as { stopPropagation: () => void }).stopPropagation = () => { nativeStops += 1; };

        DOM.sink.dispatchEvent(gutter.getElement()!, evt);

        expect(nativeStops).toBe(1);
    });
});
```

Update the file's header comment's specific sentence about which class's bound wrapper the original bug was in (it named Accordion's `_boundOnGutterDragEnd`, which no longer exists) to describe this as covering `SplitGutter.onDragStop`'s direct (non-wrapped) registration — the one mechanism `Split`, `Border`, and `Accordion` all now depend on.

### `core/ScrollShadow.ts` — new type and helper

```typescript
export interface ScrollShadowEdges {
    top:    number;
    bottom: number;
    left:   number;
    right:  number;
}

export function quantizeShadowEdge(edges: ScrollShadowEdges, edge: keyof ScrollShadowEdges, strength: number): number | null {
    const percent = Math.round(strength * 100);

    if (edges[edge] === percent) {
        return null;
    }

    edges[edge] = percent;

    return percent;
}
```

### `Panel.ts` / `VirtualScroller.ts` — use the shared type and helper

Delete each file's own local `ScrollShadowEdges` type declaration; import it from `~/core/ScrollShadow.js` instead (both files already import other symbols from that module).

`Panel.ts`'s `setShadowEdge` ([Panel.ts:1006-1015](packages/lib/src/typescript/lib/core/Panel.ts#L1006-L1015)) becomes:

```typescript
private setShadowEdge(edge: keyof ScrollShadowEdges, property: string, strength: number): void {
    const percent = quantizeShadowEdge(this._shadowEdges, edge, strength);

    if (percent === null) {
        return;
    }

    this._shadowOverlayStyle.set(property, scrollShadowEdgeValue(percent));
}
```

`VirtualScroller.ts`'s `setShadowEdge` ([VirtualScroller.ts:497-506](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L497-L506)) becomes:

```typescript
private setShadowEdge(edge: keyof ScrollShadowEdges, property: string, strength: number): void {
    const percent = quantizeShadowEdge(this._shadowEdges, edge, strength);

    if (percent === null) {
        return;
    }

    DOM.sink.apply(this._shadowOverlay, { style: { [property]: scrollShadowEdgeValue(percent) } });
}
```

Neither file's `layoutOverlayScrollbars`/`computeScrollbarVisibility`/`layoutScrollbars` changes — only the type declaration and `setShadowEdge`'s body.

### `HBox.ts` — the item-align fix

At [HBox.ts:541-543](packages/lib/src/typescript/lib/layout/HBox.ts#L541-L543), inside the `itemAlign === "start"|"center"|"end"` branch:

```typescript
// Before:
const y = crossLead + this.crossItemOffset(heights[idx], crossExtent);
placements.push({ component, ...this.resolveBounds(component, x, y, widths[idx], heights[idx], FillType.BOTH) });

// After:
const y = crossLead + this.crossItemOffset(naturalCross, crossExtent);
placements.push({ component, ...this.resolveBounds(component, x, y, widths[idx], naturalCross, FillType.BOTH) });
```

`naturalCross` (computed at [HBox.ts:528-536](packages/lib/src/typescript/lib/layout/HBox.ts#L528-L536)) is unchanged; only these two usages inside the `itemAlign` branch swap `heights[idx]` for it. No other branch in `layoutPreferredMode` changes.

### `Component.ts` — `afterNextLayout` cancellation

```typescript
static afterNextLayout(callback: () => void): { cancel(): void } {
    let cancelled = false;

    afterLayoutCallbacks.push(() => {
        if (!cancelled) {
            callback();
        }
    });

    ensureFlushScheduled();

    return {
        cancel: (): void => {
            cancelled = true;
        },
    };
}
```

`flushPendingLayouts`'s drain loop (lines 209-210, 239-241) is unchanged — it still snapshots and invokes every entry in `afterLayoutCallbacks`; a cancelled entry's wrapper simply no-ops when invoked, mirroring `Animation.play`'s own `cancelled`-flag closure.

### `Dialog.ts` — guard the two `afterNextLayout` sites

Add two private fields, alongside the existing `_panelInAnimation`/etc.:

```typescript
private _resizeToContentLayout: { cancel(): void } | null = null;
private _focusFirstLayout:      { cancel(): void } | null = null;
```

At [Dialog.ts:920](packages/lib/src/typescript/lib/overlay/Dialog.ts#L920):

```typescript
this._resizeToContentLayout = Component.afterNextLayout(() => this.resizeToContent());
```

At [Dialog.ts:930](packages/lib/src/typescript/lib/overlay/Dialog.ts#L930):

```typescript
this._focusFirstLayout = Component.afterNextLayout(() => this.focusFirst());
```

In [`destructor()`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L1267-L1299), alongside the existing animation-cancel lines at the top:

```typescript
this._resizeToContentLayout?.cancel();
this._resizeToContentLayout = null;
this._focusFirstLayout?.cancel();
this._focusFirstLayout = null;
```

### `DocsDemo.ts` — retire the hand-rolled `_disposed` guard

Replace `_disposed` ([DocsDemo.ts:27-32](packages/docs/src/shell/DocsDemo.ts#L27-L32)) with:

```typescript
// Cancelled on destructor so a queued handleSourceMeasured callback from a
// "Show source" click that landed just before disposal never touches a
// torn-down component. A later toggle's handle replaces an earlier one's —
// there is at most one measurement in flight per toggle click, and the
// newer toggle's measurement is the one that matters.
private _sourceMeasuredLayout: { cancel(): void } | null = null;
```

Simplify `handleSourceMeasured` ([DocsDemo.ts:41-45](packages/docs/src/shell/DocsDemo.ts#L41-L45)) to:

```typescript
private readonly handleSourceMeasured: () => void = () => this.notifyIntrinsicSizeChanged();
```

In `onToggleSource` ([DocsDemo.ts:111](packages/docs/src/shell/DocsDemo.ts#L111)):

```typescript
this._sourceMeasuredLayout = Component.afterNextLayout(this.handleSourceMeasured);
```

In `destructor()` ([DocsDemo.ts:119-124](packages/docs/src/shell/DocsDemo.ts#L119-L124)):

```typescript
protected destructor(): void {
    this._sourceMeasuredLayout?.cancel();
    this._unsubscribeTheme();

    super.destructor();
}
```

### `DocsShell.ts` / `DocsContent.ts` — add the same guard

Both currently have no `destructor()` override. `DocsShell.ts`:

```typescript
private _contentSettledLayout: { cancel(): void } | null = null;
// ...
this._contentSettledLayout = Component.afterNextLayout(this.handleContentSettled);
// ...
protected destructor(): void {
    this._contentSettledLayout?.cancel();

    super.destructor();
}
```

`DocsContent.ts`, same shape, for `handleScrollToFragment`:

```typescript
private _scrollToFragmentLayout: { cancel(): void } | null = null;
// ...
this._scrollToFragmentLayout = Component.afterNextLayout(this.handleScrollToFragment);
// ...
protected destructor(): void {
    this._scrollToFragmentLayout?.cancel();

    super.destructor();
}
```

### `SplitGutter.ts` — `.opaque` chrome via `ownStyleStates`

Following [`WindowBorder.ts:85-90`](packages/lib/src/typescript/lib/component/container/WindowBorder.ts#L85-L90)'s exact shape:

```typescript
protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
    {
        selector: ".opaque",
        extract: (): StyleBag => ({
            backgroundColor: "var(--ts-ui-button-bg, #e8e8e8)",
            backgroundImage: "var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))",
            border:          "1px solid var(--ts-ui-button-border, #c8c8c8)",
        }),
    },
];
```

In `setOpaque`, replace the three `this.setBackgroundColor(...)`/`this.setBackgroundImage(...)`/`this.setBorder(...)` calls in the `true` branch with `this.setStyleState(".opaque", true)`; replace the `false` branch's `this.clearBackgroundImage()`/`this.clearBorder()`/`this.setBackgroundColor(this._expandedBackground)` with `this.setStyleState(".opaque", false)` followed by the existing `this.setBackgroundColor(this._expandedBackground)` (the resting-tier fallback stays a per-instance write, per `## Architecture Decisions`). The `this._collapseButton?.setDirection(...)` line in the `true` branch is untouched — it isn't a style write.

### `Menu.ts` — resting `borderRadius`/`padding` plus `.persistent` chrome

```typescript
const _defaultMenuStyleDefaults: StyleBag = {
    borderRadius: "var(--ts-ui-border-radius, 4px)",
    padding:      new Insets(4, 0, 4, 0),
};

protected static readonly ownClassStyleDefaults: StyleBag = _defaultMenuStyleDefaults;

protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
    {
        selector: ".persistent",
        extract: (): StyleBag => ({
            backgroundColor: "var(--ts-ui-menu-bar-panel-bg, rgb(255, 255, 255))",
            border:          { border: "1px solid var(--ts-ui-menu-bar-panel-border, rgb(200, 200, 200))" },
            shadow:          "var(--ts-ui-menu-bar-panel-shadow, 2px 4px 8px rgba(0, 0, 0, 0.15))",
        }),
    },
];
```

`applyRebuildChrome`'s `setBackgroundColor`/`setBorder`/`setShadow`/`setBorderRadius`/`setInsets` calls are deleted (rebuild's values are now the resting default). `applyPersistentChrome`'s `setBackgroundColor`/`setBorder`/`setShadow`/`setBorderRadius`/`setInsets` calls are replaced with `this.setStyleState(".persistent", true)`, called once (persistent mode is chosen once at construction and never retoggled, exactly as today). `setVisible(false)` (rebuild-only), `getAria().setRole("menu")` (persistent-only), and `setContain("layout")` (both modes, `contain` has no `StyleBag` field) are untouched in both methods.

### `CollapseButton.ts` — `setStripMode`'s toggle

```typescript
protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
    {
        selector: ".strip",
        extract: (): StyleBag => ({ width: `${COLLAPSE_STRIP_SIZE}px` }),
    },
];
```

`setStripMode`'s `this.createStyleRule("").set("width", filled ? ... : null)` call becomes `this.setStyleState(".strip", filled)`. The module-level `StyleRule`/`ensureCollapseButtonClassRule` and `applyRotation` are untouched — see `## Non-Goals`.

### `AccordionIndicator.ts` — split resting tier: three properties to `ownClassStyleDefaults`, two stay hand-rolled

```typescript
const _defaultAccordionIndicatorStyleDefaults: StyleBag = {
    foregroundColor: "var(--ts-ui-accordion-indicator-color, rgb(100,100,100))",
    font: {
        fontSize:  "10px",
        textAlign: "center",
    },
};

protected static readonly ownClassStyleDefaults: StyleBag = _defaultAccordionIndicatorStyleDefaults;
```

Shrink the existing module rule to just the two properties `StyleBag` has no field for — `pointerEvents` and `transition` stay exactly as they are today (both still written by `ensureAccordionIndicatorClassRule`, just with `textAlign`/`fontSize`/`color` deleted from that literal):

```typescript
_classRule = new StyleRule({
    scope:  "class",
    name:   "AccordionIndicator",
    styles: {
        pointerEvents: "none",
        transition:    "transform 200ms ease",
    },
});
```

The existing `.expanded` `ownStyleStates` entry ([AccordionIndicator.ts:88-93](packages/lib/src/typescript/lib/component/container/AccordionIndicator.ts#L88-L93)) is untouched.

### `ScrollStrip.ts` — a dedicated arrow-button subclass

Following [`Scrollbar.ts`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts#L132-L198)'s `ScrollArrowButton` shape exactly, declared in `ScrollStrip.ts` (not exported — internal to the file, the way `ScrollArrowButton` is internal to `Scrollbar.ts`):

```typescript
const _defaultScrollStripArrowButtonStyleDefaults: StyleBag = {
    backgroundImage: "none",
    border:          null,
    shadow:          null,
    borderRadius:    "0",
};

class ScrollStripArrowButton extends Button {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultScrollStripArrowButtonStyleDefaults;

    constructor(options?: ButtonOptions) {
        super(options);

        // Not in StyleBag (checked core/ClassStyleRules.ts:44-93 — neither
        // field exists): clearInsets's exact resolved value against
        // StyleBag.padding's null-vs-value semantics was not verified for
        // this plan, and zIndex has no StyleBag field at all. Both stay
        // per-instance.
        this.clearInsets();
        this.setZIndex(3);
    }
}
```

`border: null`/`shadow: null` reproduce `clearBorder()`/`clearShadow()`'s effect — both are valid `StyleBag` values (`border?: BorderOptions | string | null`, `shadow?: string | null`). `lead`/`trail` at [ScrollStrip.ts:474-475](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L474-L475) become `new ScrollStripArrowButton({ glyph: ... })`. The per-instance loop at [ScrollStrip.ts:477-491](packages/lib/src/typescript/lib/component/container/ScrollStrip.ts#L477-L491) shrinks to just the `_arrowBackground` conditional (`if (this._arrowBackground !== null) { button.setBackgroundColor(this._arrowBackground); }`).

---

## Ordered Implementation Steps

**Phase 1 — Accordion/SplitGutter dead-weight removal (finding #1's mechanical piece)**

1. `packages/lib/src/typescript/lib/layout/CollapseSupport.ts` — export `COLLAPSE_EASING` per `## Internal Structure`. → `npm run typecheck`.
2. `packages/lib/src/typescript/lib/layout/Accordion.ts` — delete the local `ACCORDION_EASING` const; add the aliased import. → `grep -n "ACCORDION_EASING" packages/lib/src/typescript/lib/layout/Accordion.ts` — every remaining hit is a usage, not a declaration.
3. `packages/lib/src/typescript/lib/layout/Accordion.ts` — wire `gutter.on("dragend", ...)` in `getOrCreateResizeGutter`; delete the container-viewport registration in `onGutterDragStart`, the removal in `onGutterDragEnd`, and the `_boundOnGutterDragEnd` field, per `## Internal Structure`. → `npm run typecheck`; `grep -n "_boundOnGutterDragEnd" packages/lib/src/typescript/lib/layout/Accordion.ts` — zero matches.
4. `packages/lib/tests/dom/viewport-consume.test.ts` — retarget to `SplitGutter` per `## Internal Structure`. → `npx vitest run packages/lib/tests/dom/viewport-consume.test.ts`.
5. `npx vitest run packages/lib/tests/component/layout/Accordion.resizable.test.ts packages/lib/tests/component/layout/Accordion.manager.test.ts packages/lib/tests/component/container/AccordionPanel.test.ts` — must still pass unchanged (none of these spy on the viewport-listener mechanism; white-box calls to `onGutterDragStart`/`onGutterDrag`/`onGutterDragEnd` are unaffected).
6. **Manual smoke test** (`npm run dev`, `localhost:8015`): open the Accordion demo panel, enable resizable mode, drag a resize gutter start to finish — the drag must track the cursor and end cleanly on mouseup with no stuck drag state (regression check for the dragend rewiring).

**Phase 2 — Panel/VirtualScroller scrollbar dedup (finding #2)**

7. `packages/lib/src/typescript/lib/core/ScrollShadow.ts` — add `ScrollShadowEdges` and `quantizeShadowEdge` per `## Internal Structure`. → `npm run typecheck`.
8. `packages/lib/src/typescript/lib/core/Panel.ts` — delete the local `ScrollShadowEdges` type, import it from `core/ScrollShadow.js`, rewrite `setShadowEdge` per `## Internal Structure`.
9. `packages/lib/src/typescript/lib/component/container/VirtualScroller.ts` — same three changes.
10. **Checkpoint:** `grep -rn "interface ScrollShadowEdges" packages/lib/src/typescript/lib` — exactly one match, in `core/ScrollShadow.ts`.
11. `npx vitest run packages/lib/tests/core/PanelScrollChaining.test.ts packages/lib/tests/core/PanelGutterSettle.test.ts packages/lib/tests/component/container/VirtualScroller.test.ts` (the three existing suites referencing `ScrollShadow`/`_shadowEdges`) — must pass unchanged; the quantize math and the final write are both byte-identical to before, only relocated.

**Phase 3 — HBox fix (finding #3)**

12. `packages/lib/src/typescript/lib/layout/HBox.ts` — replace `heights[idx]` with `naturalCross` at both usages in the `itemAlign` branch, per `## Internal Structure`. → `npm run typecheck`.
13. `packages/lib/tests/component/layout/HBox.test.ts` (already has 32 `itemAlign` references — this is the right file) — add the regression case from `## Expected Behaviour` §3. → `npx vitest run packages/lib/tests/component/layout/HBox.test.ts`.
14. `packages/lib/docs/reference/changelog/next.md` — add one bullet noting the fix, per `## Documentation Impact`.

**Phase 4 — `Component.afterNextLayout` cancellation (finding #5)**

15. `packages/lib/src/typescript/lib/core/Component.ts` — change `afterNextLayout`'s return type and body per `## Internal Structure`. → `npm run typecheck` (confirms no caller's discarded-return-value assumption breaks; there should be zero errors since every existing caller ignores the return).
16. `packages/lib/tests/core/AfterNextLayout.test.ts` — add the cancellation cases from `## Expected Behaviour` §4.
17. `packages/lib/src/typescript/lib/overlay/Dialog.ts` — add the two fields, store the two handles, cancel both in `destructor()`, per `## Internal Structure`.
18. `packages/lib/tests/overlay/Dialog.test.ts` — add the cancellation case from `## Expected Behaviour` §4.
19. `packages/docs/src/shell/DocsDemo.ts` — replace `_disposed` with `_sourceMeasuredLayout`, simplify `handleSourceMeasured`, update `onToggleSource` and `destructor`, per `## Internal Structure`.
20. `packages/docs/src/shell/DocsShell.ts` and `packages/docs/src/shell/DocsContent.ts` — add the same guard shape, per `## Internal Structure`.
21. **Checkpoint:** `grep -n "_disposed" packages/docs/src/shell/DocsDemo.ts` — zero matches. `npm run typecheck` across `packages/docs`.
22. `npx vitest run packages/lib/tests/core/AfterNextLayout.test.ts packages/lib/tests/overlay/Dialog.test.ts packages/docs/tests/DocsContent.test.ts` — must pass unchanged (`DocsContent.test.ts` is the only existing docs-app test touching any of the three files this step modifies; `DocsDemo`/`DocsShell` have no dedicated test file today).

**Phase 5 — StyleAudit residue (finding #6)**

`SplitGutter.ts`, `Menu.ts`, `CollapseButton.ts`, and `ScrollStrip.ts` don't yet import the class-tier types; each of steps 23, 25, 27, 31 below also adds `import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";` (`AccordionIndicator.ts` already has this import, confirmed).

23. `packages/lib/src/typescript/lib/component/container/SplitGutter.ts` — add the `.opaque` `ownStyleStates` entry, rewrite `setOpaque`'s two branches, per `## Internal Structure`.
24. `packages/lib/tests/component/container/SplitGutter.classStyleHoisting.test.ts` (new file) — following [`AccordionHeader.classStyleHoisting.test.ts`](packages/lib/tests/component/container/AccordionHeader.classStyleHoisting.test.ts)'s exact idiom (`writesDuring`/`declarationsFor`/`idSelector` against a `RecordingDOMSink`): construct two `SplitGutter`s, set both `.opaque`, and assert the second one's `#id.opaque` write set is empty (or the properties are absent from its own `#id` writes) while the shared `.SplitGutter.opaque` class rule carries all three declarations.
25. `packages/lib/src/typescript/lib/overlay/Menu.ts` — add `ownClassStyleDefaults`/`ownStyleStates`, rewrite `applyRebuildChrome`/`applyPersistentChrome`, per `## Internal Structure`.
26. `packages/lib/tests/overlay/Menu.classStyleHoisting.test.ts` (new file) — same idiom, covering both a rebuild-mode and a persistent-mode `Menu` instance each dedupe onto their respective class-tier rule.
27. `packages/lib/src/typescript/lib/component/container/CollapseButton.ts` — add the `.strip` `ownStyleStates` entry, rewrite `setStripMode`, per `## Internal Structure`.
28. `packages/lib/tests/component/container/CollapseButton.classStyleHoisting.test.ts` (new file) — same idiom, covering the `.strip` toggle.
29. `packages/lib/src/typescript/lib/component/container/AccordionIndicator.ts` — add `ownClassStyleDefaults` for `foregroundColor`/`font`, shrink the hand-rolled module rule to `pointerEvents`/`transition`, per `## Internal Structure`.
30. `packages/lib/tests/component/container/AccordionIndicator.classStyleHoisting.test.ts` (new file) — same idiom, covering the resting tier; the existing `AccordionIndicator.test.ts`'s `.expanded` coverage stays as-is.
31. `packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` — add `ScrollStripArrowButton` per `## Internal Structure`; update `lead`/`trail` construction and the per-instance loop.
32. `packages/lib/tests/component/container/ScrollStrip.classStyleHoisting.test.ts` (new file) — same idiom, covering two `ScrollStrip` instances' arrow buttons deduping onto `.ScrollStripArrowButton`.
33. **Checkpoint:** for each of steps 23-32, `npm run typecheck` before moving to the next component — a mistake in one migration's `StyleBag` field names must not compound across five components before being caught.
34. `npx vitest run packages/lib/tests/component/container/SplitGutter.classStyleHoisting.test.ts packages/lib/tests/overlay/Menu.classStyleHoisting.test.ts packages/lib/tests/component/container/CollapseButton.classStyleHoisting.test.ts packages/lib/tests/component/container/AccordionIndicator.classStyleHoisting.test.ts packages/lib/tests/component/container/ScrollStrip.classStyleHoisting.test.ts` plus each component's existing test suite (`packages/lib/tests/component/container/SplitGutter.movable.test.ts`, `packages/lib/tests/overlay/Menu.test.ts`, `packages/lib/tests/component/container/CollapseButton.test.ts`, `packages/lib/tests/component/container/AccordionIndicator.test.ts`, `packages/lib/tests/component/container/ScrollStrip.test.ts`) — all green, unmodified.

**Final checkpoint**

35. `npm run typecheck && npm run lint && npm test` — all green.
36. `npm run docs:api` — zero warnings (no public JSDoc changes touch an excluded symbol; `afterNextLayout`'s doc is on a still-public, still-documented static method).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/layout/CollapseSupport.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` |
| Modify | `packages/lib/tests/dom/viewport-consume.test.ts` |
| Modify | `packages/lib/src/typescript/lib/core/ScrollShadow.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Panel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/VirtualScroller.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/HBox.ts` |
| Modify | `packages/lib/tests/component/layout/HBox.test.ts` |
| Modify | `packages/lib/docs/reference/changelog/next.md` |
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/tests/core/AfterNextLayout.test.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Dialog.ts` |
| Modify | `packages/lib/tests/overlay/Dialog.test.ts` |
| Modify | `packages/docs/src/shell/DocsDemo.ts` |
| Modify | `packages/docs/src/shell/DocsShell.ts` |
| Modify | `packages/docs/src/shell/DocsContent.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/SplitGutter.ts` |
| Create | `packages/lib/tests/component/container/SplitGutter.classStyleHoisting.test.ts` |
| Modify | `packages/lib/src/typescript/lib/overlay/Menu.ts` |
| Create | `packages/lib/tests/overlay/Menu.classStyleHoisting.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/CollapseButton.ts` |
| Create | `packages/lib/tests/component/container/CollapseButton.classStyleHoisting.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/AccordionIndicator.ts` |
| Create | `packages/lib/tests/component/container/AccordionIndicator.classStyleHoisting.test.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/ScrollStrip.ts` |
| Create | `packages/lib/tests/component/container/ScrollStrip.classStyleHoisting.test.ts` |

---

## Expected Behaviour

### §1 Accordion gutter drag end — unit-testable

- Starting a resizable-Accordion gutter drag (`onGutterDragStart`) then ending it (`onGutterDragEnd`, called directly or via the gutter's own `"dragend"` emit) clears `_dragUpper`/`_dragLower` and fires `"sectionresize"` — unchanged from today, per the existing `Accordion.resizable.test.ts` coverage.
- A real `mouseup` dispatched through `DOM.sink` after a `SplitGutter`'s `onDragStart` stops native propagation (`SplitGutter`-level, replacing the retargeted `viewport-consume.test.ts` case).
- `detach()` called mid-drag still ends the drag cleanly (existing coverage, unaffected by the rewiring).

### §2 Panel/VirtualScroller shadow-edge quantization — unit-testable

- `quantizeShadowEdge(edges, "top", 0.755)` returns `76` (rounds `75.5` up) and sets `edges.top = 76`; calling it again with the same strength returns `null` and leaves `edges.top` unchanged.
- `quantizeShadowEdge(edges, "top", 0.001)` returns `0` (below the ramp's effective floor) the first time, `null` on repeat.
- `Panel`'s and `VirtualScroller`'s own existing shadow-edge coverage (`PanelScrollChaining.test.ts`, `PanelGutterSettle.test.ts`, `VirtualScroller.test.ts` — see step 11) must pass unmodified: the visible behaviour (which CSS custom property gets which value, at which scroll position) is unchanged, only the implementation is shared.

### §3 HBox item-align fix — unit-testable

| Case | Insets | `itemAlign` | Child preferred height | Before (bug) | After (fix) |
|---|---|---|---|---|---|
| End-aligned child overruns bottom inset | `top: 10, bottom: 10` | `"end"` | between trimmed and untrimmed cross extent | child's bottom edge exceeds `containerSize.height - insets.bottom` | child's bottom edge is flush with `containerSize.height - insets.bottom` |
| Zero insets | `0` on all sides | `"end"` | any | matches after-fix (trimmed == untrimmed when insets are zero) | unchanged (regression guard) |
| `"center"`/`"start"` | non-zero | `"center"`/`"start"` | between trimmed and untrimmed | same overrun/offset error | corrected, mirroring the `"end"` case |

Build an `HBox` host with non-zero top/bottom insets, a child whose preferred height sits strictly between the trimmed and untrimmed cross extent, and `itemAlign: "end"`; assert the child's bottom edge is `containerSize.height - insets.bottom`, matching a `VBox` twin's equivalent right-edge assertion for the corresponding insets. Unit-testable offline via the existing `installTestDOM` harness.

### §4 `afterNextLayout` cancellation — unit-testable

- `const handle = Component.afterNextLayout(cb); handle.cancel();` followed by flushing the pending layout (however the existing `AfterNextLayout.test.ts` triggers a flush) — `cb` is never called.
- Calling `handle.cancel()` a second time, or after the callback has already fired, is a no-op (no throw, no double-invoke).
- Two callbacks queued in the same frame, one cancelled and one not — only the non-cancelled one fires.
- `Dialog`: construct, then dispose before the queued layout flush — neither `resizeToContent()` nor `focusFirst()` is called after disposal (spy on both, or on the underlying element access, to confirm zero post-dispose calls).
- `DocsDemo`: toggle "Show source" then dispose before the flush — `notifyIntrinsicSizeChanged` is not called after disposal.

All five are unit-testable offline; none needs a real browser.

### §5 StyleAudit migrations — unit-testable

For each of the five migrated components (`SplitGutter`, `Menu`, `CollapseButton`, `AccordionIndicator`, `ScrollStrip`): construct two instances, put both in the same toggled/mode state, and assert (via `RecordingDOMSink`, following `AccordionHeader.classStyleHoisting.test.ts`'s idiom) that the second instance's own `#id`-scoped writes for the migrated declarations are absent, while a shared `.ClassName`-scoped (or `.ClassName.state`-scoped) rule carries them once. Each migrated component's pre-existing behavioural tests (visual state, toggling, per-instance overrides like `SplitGutter`'s `expandedBackground` or `ScrollStrip`'s `_arrowBackground`) must pass unmodified — this is a CSS-authoring-mechanism change, not a rendering-behaviour change.

---

## Verification

1. `npm run typecheck` — clean after every phase checkpoint above.
2. `npm run lint` — clean.
3. `npm test` — full suite green, including every new case in `## Expected Behaviour` and every file named "must pass unchanged" above.
4. `grep -n "_boundOnGutterDragEnd" packages/lib/src/typescript/lib/layout/Accordion.ts` — zero matches (step 3).
5. `grep -rn "interface ScrollShadowEdges" packages/lib/src/typescript/lib` — exactly one match (step 10).
6. `grep -n "_disposed" packages/docs/src/shell/DocsDemo.ts` — zero matches (step 21).
7. `npm run docs:api` — zero warnings.
8. `npm run docs:build` — zero warnings (covers the `next.md` changelog edit).
9. **Manual smoke test** (`npm run dev`, `localhost:8015`): Accordion demo — drag a resize gutter (Phase 1's regression check, restated). HBox/VBox demo (or the Misc panel, whichever hosts an `itemAlign` example) — an end-aligned row item with visible insets sits flush with the inset, not overrunning it. Dialog demo — open and immediately close a dialog before its content settles (fast double-click) with devtools open, confirming no console error from a callback touching a disposed dialog. Docs app itself (`npm run docs:dev`) — open a docs page with an inline demo, toggle "Show source" then immediately navigate away, confirming no console error.

---

## Documentation Impact

- `packages/lib/docs/reference/changelog/next.md` gets one bullet: `HBox`'s `itemAlign: "start"|"center"|"end"` no longer overruns a non-zero cross-axis inset (bug fix; matches documented/`VBox` behaviour, no API change).
- `docs/layouts/HBox.md` needs no edit — its existing prose already describes the *correct* (post-fix) behaviour; the bug was never documented as intended.
- `Component.afterNextLayout`'s JSDoc changes (new return type) — regenerated by `npm run docs:api`; the method is already public and documented, so this is a doc-content update, not a new doc page.
- No other public API surface changes; `SplitGutterOptions`, `MenuOptions`, `CollapseButtonOptions`, `AccordionIndicator`'s (if any) public options, and `ScrollStripOptions` are all unaffected — every StyleAudit migration in this plan is an internal CSS-authoring change with no consumer-visible signature change.

---

## Potential Challenges

- **The five new `*.classStyleHoisting.test.ts` files all depend on `RecordingDOMSink`'s exact op-log shape** (`writesDuring`/`declarationsFor`/`idSelector`, as `AccordionHeader.classStyleHoisting.test.ts` defines them). If that harness has moved to a shared test helper module since, import it from there instead of re-declaring it per file — check before writing step 24.
- **`Menu.ts`'s `.persistent` state and `SplitGutter.ts`'s `.opaque` state are each set once at construction/toggle and never re-evaluated per render** — confirm `setStyleState` behaves correctly (writes the class-tier `:not()`-guarded rule, no runtime re-toggle assumed) for a state used this way; every existing `ownStyleStates` consumer in this codebase does re-toggle at runtime (`.pressed`, `.selected`, `.disabled`), so this plan's two components are the first to set a declared state once and leave it — verify the mechanism has no hidden assumption of repeated toggling before relying on it.

---

## Critical Files

- [`plans/implemented/accordion-resize-weight.md`](plans/implemented/accordion-resize-weight.md) — the precedent for reaffirming the weight pin/refill mirror; read its `## Architecture Decisions` in full before touching anything in that area (this plan touches none of it, but an implementer must understand why not).
- [`plans/implemented/accordion-resizable-sections.md`](plans/implemented/accordion-resizable-sections.md) (`## Potential Challenges → Drag-end signal`) — the original reasoning for Accordion's now-dead viewport-listener workaround.
- [`plans/implemented/overlay-scrollbar-cross-axis-overlap.md`](plans/implemented/overlay-scrollbar-cross-axis-overlap.md) — the precedent for why `Panel`'s and `VirtualScroller`'s scrollbar algorithms stay separate.
- [`plans/implemented/core-component-lifecycle-and-size-fixes.md`](plans/implemented/core-component-lifecycle-and-size-fixes.md) and [`plans/implemented/dispose-all-components.md`](plans/implemented/dispose-all-components.md) — the two prior plans whose Non-Goals/tests this plan's `removeAllComponents` decision defers to.
- [`packages/lib/src/typescript/lib/component/container/WindowBorder.ts`](packages/lib/src/typescript/lib/component/container/WindowBorder.ts) (lines 85-90) and [`Scrollbar.ts`](packages/lib/src/typescript/lib/component/container/Scrollbar.ts) (`ScrollArrowButton`, lines 132-198) — the `ownStyleStates` precedent every migration in Phase 5 follows.
- [`packages/lib/src/typescript/lib/overlay/PopupPanel.ts`](packages/lib/src/typescript/lib/overlay/PopupPanel.ts) (lines 37-42, 88) — the `ownClassStyleDefaults` precedent Phase 5's resting-tier migrations follow.
- [`packages/lib/tests/component/container/AccordionHeader.classStyleHoisting.test.ts`](packages/lib/tests/component/container/AccordionHeader.classStyleHoisting.test.ts) — the test idiom every new `*.classStyleHoisting.test.ts` file in this plan follows exactly.
- [`packages/lib/src/typescript/lib/core/Animation.ts`](packages/lib/src/typescript/lib/core/Animation.ts) (`CancelHandle`, lines 375-393; `play`'s `cancelled`-flag closure) — the pattern `Component.afterNextLayout`'s new cancel handle mirrors.
- [`packages/lib/src/typescript/lib/core/ClassStyleRules.ts`](packages/lib/src/typescript/lib/core/ClassStyleRules.ts) (`StyleBag`, lines 44-onward) — the authoritative field list for what Phase 5's `StyleBag` literals may contain; consult before inventing a field name.

---

## Non-Goals

- **A full shared drag controller for `Split` and `Accordion`.** Investigated and rejected — see `## Architecture Decisions`. The two managers solve genuinely different problems (pairwise clamp vs. nearest-first multi-section chaining); unifying them would degrade one or both.
- **Fixing Accordion's live-drag dead zone** (the divergence the comment at `Accordion.ts:1889` names). This is a real, separate, well-scoped follow-up: switch `onGutterDrag` from incremental frame-deltas to an absolute-origin recompute (snapshot each open section's height/min/max at `onGutterDragStart`, then on each move compute the *total* delta from the drag's origin pointer and call `distributeDragChain` fresh from that snapshot, mirroring how `Split.onDrag` recomputes `newLhs` from `_dragOriginLhsSize` every frame). This is a live-drag *behaviour* change, not a duplication cleanup, and needs its own test plan for the reversal cases the dead zone currently masks — out of scope here.
- **Moving `Accordion`'s section-toggle animation onto `CollapseSupport.runCollapse`.** Investigated and rejected — see `## Architecture Decisions`. Different, both load-bearing, techniques.
- **A shared implementation for `Split.effectiveResizeWeight` / `Accordion.effectiveWeight`.** Reaffirmed separate — see `## Architecture Decisions`; the two read "unset" differently by design.
- **Unifying `Panel`'s and `VirtualScroller`'s scrollbar-layout algorithm itself.** Reaffirmed separate — see `## Architecture Decisions`; only `ScrollShadowEdges` and `setShadowEdge`'s quantize logic converge.
- **`CollapseButton.ts`'s module-level `StyleRule`/`_defaultCollapseButtonOptions` split and `applyRotation`'s 4-way rotation.** The module rule mixes non-setter geometry (which `ResizeHandle.ts` shows is a legitimately separate, sanctioned pattern) with setter-backed properties that could in principle fold into a defaults bag — but doing that split correctly needs its own investigation into exactly which of the module rule's ~15 declarations are setter-backed, which is design work, not mechanical pattern application. `applyRotation`'s value is a 4-way enum, not a boolean, and doesn't fit `ownStyleStates`' toggle shape without a larger change to that mechanism. Left as a named follow-up.
- **`Menu.ts`'s `setContain("layout")`.** `StyleBag` has no `contain` field — confirmed, not merely unconfirmed-hoistable. Stays a per-instance write.
- **`ScrollStripArrowButton`'s `clearInsets()`/`setZIndex(3)`.** `zIndex` has no `StyleBag` field, confirmed. `clearInsets`'s mapping onto `StyleBag.padding` (which does exist) was not verified closely enough for this plan to rely on — a future pass can confirm it and fold `clearInsets` in once it does; `zIndex` will remain a per-instance call regardless.
- **`Markdown.ts`'s two `afterNextLayout` call sites** (`handleViewportPass`, `handleScheduledMeasure`). Found during investigation but never named in the original finding; not inspected for disposal-safety here. A future pass can route them through the new cancel handle the same way this plan routes `Dialog`/`DocsDemo`/`DocsShell`/`DocsContent`.
- **`Component.onFirstLayout`'s internal relay to `afterNextLayout`.** Unaffected by the signature change (it already discards the return value) and not modified to forward the new handle — no named consumer needs it to.

---

## Notes

[^dead-zone-followup]: The comment reads: *"Advance the tracked pointer only by the travel actually applied. When the chain is fully maxed/minned, `delta` is 0 and the pointer stays put, so dragging further past the limit accrues a dead zone the pointer must retrace before the gutter moves again — keeping the cursor glued to the handle on reversal instead of the handle jumping to a far-off cursor. (Split/Border get this for free from their absolute origin+offset model.)"* This is Accordion's own author naming the tradeoff, not a bug report — but it is a real, fixable UX rough edge with a concrete fix path (see `## Non-Goals`), just not one this convergence-focused plan should bundle in, since it changes live-drag behaviour rather than removing duplication.

[^viewport-consume-retarget]: Considered and rejected: deleting `viewport-consume.test.ts` outright with no replacement. The file's own header comment explains it exists specifically to catch a class of bug (dispatch-level event consumption silently failing) that unit-level calls to the handler can't catch — that class of bug is still possible in `SplitGutter.onDragStop` in principle (a future change could wrap it in a lossy closure the same way Accordion's old `_boundOnGutterDragEnd` once was), and no other test in the suite dispatches a real viewport event to check it. Retargeting keeps that coverage pointed at the code that now actually needs it.

[^docsdemo-single-handle]: Considered and rejected: tracking every in-flight `handleSourceMeasured` handle in an array (so a rapid double-toggle-then-dispose sequence cancels all of them, not just the latest). The original `_disposed` boolean guarded every queued callback, so an array would be the literal-fidelity replacement. In practice, two toggles inside one animation frame both queue into the *same* `afterLayoutCallbacks` snapshot (queuing doesn't schedule a second frame — `ensureFlushScheduled` is idempotent), so a single mutable handle loses coverage only in the narrower case of two toggles landing in two *different* frames before either fires, immediately followed by disposal within that same narrow window — a sequence with no realistic trigger (why toggle "Show source" twice and dispose the whole block, all before one repaint) and not exercised by any existing test. The single-handle, cancel-and-replace shape also matches this codebase's established idiom for exactly this situation (`Dialog._panelInAnimation?.cancel()`; `Accordion._wrapperAnimations`'s `inFlight.cancel()` before replacing).
