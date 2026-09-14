---
touches-shared:
  - packages/lib/src/typescript/lib/core/Component.ts
  - packages/lib/src/typescript/lib/core/Panel.ts
---

# Undisplay Inactive Tab / Card Pages — Implementation Plan

## Overview

`Tab` and `Card` hide the pages they are not showing with `setVisible(false)` — CSS `visibility: hidden`. A hidden page keeps its box, so the browser still computes style, layout and overflow for its whole subtree on every resize of the window around it. [`layout/Tab.ts:2085`](packages/lib/src/typescript/lib/layout/Tab.ts#L2085) does this to every child on every layout pass; [`layout/Card.ts:213`](packages/lib/src/typescript/lib/layout/Card.ts#L213) does it to the child it is switching away from.

This plan moves both to `setDisplayed(false)` — CSS `display: none`, the `.undisplayed` state `Component` already declares at [`core/Component.ts:433`](packages/lib/src/typescript/lib/core/Component.ts#L433) — so an inactive page leaves the render tree entirely. `display: none` costs an engine nothing per frame; `visibility: hidden` costs it a full subtree relayout.[^why-display]

Three things stop working on their own once a subtree's boxes are destroyed, and each gets an explicit fix here: a `display: none` subtree's native scroll offsets are dropped by the engine, CodeMirror stops measuring itself while it has no box, and a `Panel` that lays itself out while hidden measures every scroll metric as zero. `Dock` needs no change of its own — its frames are `Container`s driven by a `Tab` or a `Fit` layout manager, so it inherits the behaviour from `Tab`.[^dock-inherits]

---

## Architecture Decisions

### Inactive pages are undisplayed, not unmounted

`Tab` and `Card` hide an inactive page with `Component.setDisplayed(false)`, mirroring [`layout/Accordion.ts:1669`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1669), where a layout manager already drops a non-displayed section's header and wrapper out of the stack with the same call, and [`component/shared/VirtualRowView.ts:563`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L563), where pooled rows outside the scroll window are parked the same way and re-displayed at [`VirtualRowView.ts:547`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L547). Pages are not removed from the component tree and their elements are not released.[^why-display]

### `Tab` and `Card` own the displayed state and never touch `visible`

Both managers stop calling `setVisible` on their pages entirely. `visible` becomes the consumer's channel and `displayed` the manager's, so the two never fight.[^no-visible-writes]

The two states are independent, and `.undisplayed` is declared ahead of `.invisible` in `Component.ownStyleStates` so `display: none` wins whenever both are active:

| `setVisible` called with | `setDisplayed` called with | DOM class tokens | Renders as | `isVisible()` | `isDisplayed()` |
|---|---|---|---|---|---|
| never called | `false` | `undisplayed` | `display: none` | `null` | `false` |
| never called | `true` (after a `false`) | none | normally | `null` | `true` |
| `false` | `false` | `invisible undisplayed` | `display: none` | `false` | `false` |
| `false` | `true` | `invisible` | `visibility: hidden` | `false` | `true` |

### The page a pass is about to show is never undisplayed inside that pass

`Tab.doLayout` today hides every child and then re-shows the selected one. After this change it resolves the selected child **first** and skips it in the hide loop, so that child's box is never destroyed and recreated within one pass.[^skip-selected] `Card` never had the problem: it hides the outgoing child and shows the incoming one, which are always different components.

### Native scroll offsets are captured before the hide and re-applied at placement

Two new `Component` methods walk a subtree: `captureSubtreeScroll()` reads each scrolling node's live offset into the cache that already backs `getScrollLeft` / `getScrollTop`, and `restoreSubtreeScroll()` writes each cached offset back onto the element. `Tab` and `Card` call the capture immediately before undisplaying a page and the restore immediately after `placeComponent` has re-laid the shown page out.[^scroll-cache]

The walk visits only nodes that actually own a native scroll offset — a node whose `getScrollElement()` resolves to something other than its own element, or whose own `overflowX` / `overflowY` is `auto` or `scroll`. Both tests read cached state, so a page full of ordinary components costs no DOM reads at all:

| Node in a hidden page | `getScrollElement()` | Own overflow | Walked? |
|---|---|---|---|
| the page `Container` itself | its own element | `hidden` | no |
| `Panel({ autoScroll: "auto" })`, `scrollbarStyle: "native"` | its own element | `auto` / `auto` | yes |
| `Panel({ autoScroll: "auto" })`, `scrollbarStyle: "overlay"` | the inner scroller | `auto` / `auto` | yes |
| `CodeEditor` | `.cm-scroller` | not scrollable | yes |
| a `Button` in the page's toolbar | its own element | not scrollable | no |

### The size reports that read a hidden page stay exactly as they are

`Tab.computeTotalMinSize`, `Tab.getPreferredSize` / `getMinSize` / `getMaxSize`, and `Card.computeSize` each ask a page for a size. None of them is changed and none gains a guard: every size a `Component` reports comes from cached state or arithmetic over cached state, never from a live DOM read, so a `display: none` page reports the same numbers it did while it was showing.[^sizing-safe]

### Focus and ARIA need no change either

`FocusTraversal`'s tab-stop filter already rejects a `display: none` subtree for the same reason it rejects a `visibility: hidden` one, and `Tab.revealDescendant` already forces a synchronous layout before its caller focuses the revealed element, so the page is displayed by the time focus lands. `Tab` keeps writing `aria-hidden` on its pages exactly as it does today.[^focus-unchanged]

### `CodeEditor` asks CodeMirror for a fresh measurement when it becomes visible again

`CodeEditor` overrides `onEffectiveVisibilityChange` and calls `EditorView.requestMeasure()` on the way back to visible, following [`component/display/Markdown.ts:1463`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L1463) and [`component/display/AbstractCanvasSurface.ts:452`](packages/lib/src/typescript/lib/component/display/AbstractCanvasSurface.ts#L452), which already use that hook to flush work they withheld while off-screen.[^codemirror-measure]

### A `Panel` withholds its live scroll-metric read while it is not effectively visible

`Panel.remeasureScrollMetrics` returns early when `isEffectivelyVisible()` is false, and `Panel.onEffectiveVisibilityChange` schedules a layout when the panel comes back, so the withheld read happens then. This is the same withhold-and-flush shape `Markdown` uses for its own deferred measurement.[^panel-zero-metrics]

---

## Public API

Both new methods are `@internal`: a layout manager, not a subclass, invokes them on arbitrary instances, which is exactly why `Component.propagateEffectiveVisibility` ([`core/Component.ts:2412`](packages/lib/src/typescript/lib/core/Component.ts#L2412)) is `public` + `@internal` too.

```typescript
// core/Component.ts — class Component
/** @internal */ public captureSubtreeScroll(): void;
/** @internal */ public restoreSubtreeScroll(): void;

private ownsNativeScroll(): boolean;
private reapplyCachedScroll(): void;
```

```typescript
// core/Panel.ts — class Panel
protected onEffectiveVisibilityChange(effective: boolean): void;
```

```typescript
// component/editor/CodeEditor.ts — class CodeEditor
protected onEffectiveVisibilityChange(effective: boolean): void;
```

```typescript
// layout/Card.ts — class Card
private _pendingScrollRestore: Component | null;

private undisplayChild(component: Component): void;
```

No options-bag field accompanies `_pendingScrollRestore`: it is framework bookkeeping, not consumer configuration, so per ARCHITECTURE.md's third DOM-write rule it stays off `CardOptions`.

---

## Internal Structure

### `Component` — the subtree scroll walk

```typescript
private ownsNativeScroll(): boolean {
    const element = this.getElement();

    if (!element) {
        return false;
    }

    // A subclass that points getScrollElement() at an inner element (Panel's
    // overlay scroller, CodeEditor's `.cm-scroller`) always scrolls there.
    if (this.getScrollElement() !== element) {
        return true;
    }

    return this.isOverflowScrollable(this.getOverflowX())
        || this.isOverflowScrollable(this.getOverflowY());
}

public captureSubtreeScroll(): void {
    if (this.ownsNativeScroll()) {
        this.syncScrollOffsets();
    }

    for (const child of this.getComponents()) {
        child.captureSubtreeScroll();
    }
}

public restoreSubtreeScroll(): void {
    if (this.ownsNativeScroll()) {
        this.reapplyCachedScroll();
    }

    for (const child of this.getComponents()) {
        child.restoreSubtreeScroll();
    }
}
```

`reapplyCachedScroll` is the per-node write, lifted out of the first block of the existing `restoreReleasedState` ([`core/Component.ts:4392`](packages/lib/src/typescript/lib/core/Component.ts#L4392)) so both callers share one body:

```typescript
private reapplyCachedScroll(): void {
    const scrollElement = this.getScrollElement();

    if (scrollElement && (this._scrollLeft !== 0 || this._scrollTop !== 0)) {
        DOM.sink.apply(scrollElement, { scrollLeft: this._scrollLeft, scrollTop: this._scrollTop });
    }
}
```

### `Tab.doLayout` — the reordered hide/show

Replacing the loop at [`layout/Tab.ts:2085`](packages/lib/src/typescript/lib/layout/Tab.ts#L2085):

```typescript
let component = this.getVisibleComponent();

if (!component && components.length > 0) {
    component = components[0];
}

for (const child of components) {
    if (child === component) {
        continue;
    }

    if (child.isDisplayed()) {
        child.captureSubtreeScroll();
    }

    child.setDisplayed(false);
    child.getAria().setHidden(true);
}
```

At [`layout/Tab.ts:2205`](packages/lib/src/typescript/lib/layout/Tab.ts#L2205), replacing `component.setVisible(true)`:

```typescript
const wasUndisplayed = !component.isDisplayed();

component.setDisplayed(true);
component.getAria().setHidden(false);
```

And immediately after the existing `this.placeComponent(...)` call, before the existing `_lastFadedTabIndex` fade block:

```typescript
// Safe here rather than a frame later: placeComponent -> commitBounds runs
// the page's own doLayout() synchronously, so the whole re-shown subtree
// already carries its final geometry and the browser clamps nothing away.
if (wasUndisplayed) {
    component.restoreSubtreeScroll();
}
```

### `Card` — deferring the restore to the next placement

`Card` flips the display in `syncVisible`, which is reachable without a layout pass (from `setVisibleComponentId`), so the component owed a restore is parked on a field and consumed in `doLayout` after `placeComponent`. That mirrors `Tab._pendingActiveContent`, the deferred-until-next-layout field already used in this area.

```typescript
private _pendingScrollRestore: Component | null = null;

private undisplayChild(component: Component): void {
    if (component.isDisplayed()) {
        component.captureSubtreeScroll();
    }

    component.setDisplayed(false);
}
```

In `doLayout`, after the existing `this.placeComponent(...)` call:

```typescript
const restore = this._pendingScrollRestore;

this._pendingScrollRestore = null;

if (restore === this._currentVisible) {
    restore.restoreSubtreeScroll();
}
```

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/core/Component.ts`** — add the private `reapplyCachedScroll()` shown above, next to `restoreReleasedState` (around line 4392), and rewrite `restoreReleasedState`'s scroll block to call it. The focus block in `restoreReleasedState` is untouched.
   *Check:* `npm run typecheck` passes.

2. **`core/Component.ts`** — add the private `ownsNativeScroll()` and the public `@internal` `captureSubtreeScroll()` / `restoreSubtreeScroll()` from `## Internal Structure`, immediately after `syncScrollOffsets` (around line 4430). Document each with the JSDoc shape the surrounding methods use, including a `@remarks` on `captureSubtreeScroll` stating it must be called **before** the subtree loses its boxes.

3. **`core/Component.ts`** — fix the now-wrong sentence in `isEffectivelyVisible`'s JSDoc at line 2362: `Tab` / `Card` hide an inactive panel with `setDisplayed(false)` (CSS `display: none`), which drops it out of layout, not with `setVisible(false)`.

4. **`packages/lib/src/typescript/lib/layout/Tab.ts`** — apply the `doLayout` restructure from `## Internal Structure`: resolve `component` before the hide loop, skip it there, capture-then-undisplay every other child, and replace `component.setVisible(true)` with the `wasUndisplayed` + `setDisplayed(true)` pair.
   *Check:* `grep -n 'setVisible(' packages/lib/src/typescript/lib/layout/Tab.ts` — exactly one match, `this._bar.setVisible(this._barVisible)`, which is out of scope.

5. **`layout/Tab.ts`** — add the `wasUndisplayed`-guarded `component.restoreSubtreeScroll()` call immediately after `placeComponent`, before the `_lastFadedTabIndex` fade block. The fade block itself is unchanged.

6. **`layout/Tab.ts`** — update two JSDoc blocks: `doLayout`'s summary and `@remarks` (lines 2046–2052) to say inactive children are undisplayed rather than hidden, and `revealDescendant` (line 2293) to say the forced synchronous layout clears the newly-active content's `display: none` rather than its `visibility: hidden`.

7. **`packages/lib/src/typescript/lib/layout/Card.ts`** — add the `_pendingScrollRestore` field and the `undisplayChild` helper; in `syncVisible`, route both hide branches through `undisplayChild`, replace `resolved.setVisible(true)` with a `setDisplayed(true)` preceded by recording `resolved` in `_pendingScrollRestore` when it was undisplayed, and update the first-sync comment (line 207) — a sibling that is not the resolved child is dropped out of layout, not merely painted out.

8. **`layout/Card.ts`** — consume `_pendingScrollRestore` in `doLayout` after `placeComponent`, exactly as shown in `## Internal Structure`. Update the class JSDoc (line 21) and `setVisibleComponentId`'s JSDoc (lines 130–133) to describe display writes rather than visibility writes.
   *Check:* `grep -n 'setVisible(' packages/lib/src/typescript/lib/layout/Card.ts` — zero matches (`setVisibleComponentId(` does not match this pattern).

9. **`packages/lib/src/typescript/lib/component/editor/CodeEditor.ts`** — add the `onEffectiveVisibilityChange` override next to `getScrollElement` (line 1923). It calls `super`, returns when `effective` is false or `this._view` is null, then calls `this._view.requestMeasure()` followed by `this.syncAutoHeight()`.

10. **`packages/lib/src/typescript/lib/core/Panel.ts`** — add `if (!this.isEffectivelyVisible()) { return; }` to `remeasureScrollMetrics` (line 1082), directly after the existing `this._autoScroll === "none"` guard, with a comment naming the zero-metric failure it prevents.

11. **`core/Panel.ts`** — add the `onEffectiveVisibilityChange` override: call `super`, then `this.scheduleLayout()` when `effective` is true and `this._autoScroll !== "none"`.

12. **`packages/lib/tests/component/layout/Card.test.ts`** — switch the five `isVisible()` assertions (lines 62, 63, 80, 81, 126) to `isDisplayed()`. The animation-pause test at lines 134–159 needs no change: effective visibility means the same thing either way.

13. **`packages/lib/tests/unit/core/FocusReveal.test.ts`** — switch the `b.isVisible()` assertion at line 210 to `b.isDisplayed()`, and reword the comment above it to say the display flip, not the visibility flip.

14. **`packages/lib/tests/component/layout/Tab.lifecycle.test.ts`** — update the stale comment at line 143 (`hides it via setVisible(false)` → `setDisplayed(false)`). Assertions are unchanged.

15. Add the five new test files listed in `## Files to Create / Modify / Delete`, covering the cases in `## Expected Behaviour`. Each one copies the `installTestDOM(CONFIG)` / `DOM.reset()` setup from its nearest sibling (`tests/core/PanelOverlayScrollbar.test.ts`, `tests/component/layout/Card.test.ts`, `tests/component/code-editor.test.ts`).

16. **Docs** — add the notes described in `## Documentation Impact`.
    *Check:* `npm run docs:api` finishes with zero warnings.

17. Run the full verification list in `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Modify | `packages/lib/src/typescript/lib/core/Panel.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Tab.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Card.ts` |
| Modify | `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` |
| Modify | `packages/lib/tests/component/layout/Card.test.ts` |
| Modify | `packages/lib/tests/component/layout/Tab.lifecycle.test.ts` |
| Modify | `packages/lib/tests/unit/core/FocusReveal.test.ts` |
| Create | `packages/lib/tests/core/ComponentSubtreeScroll.test.ts` |
| Create | `packages/lib/tests/core/PanelHiddenRemeasure.test.ts` |
| Create | `packages/lib/tests/component/layout/Tab.undisplay.test.ts` |
| Create | `packages/lib/tests/component/layout/Card.undisplay.test.ts` |
| Create | `packages/lib/tests/component/code-editor-reshow-measure.test.ts` |
| Modify | `packages/lib/docs/layouts/Tab.md` |
| Modify | `packages/lib/docs/layouts/Card.md` |
| Modify | `packages/lib/docs/concepts/performance.md` |

---

## Expected Behaviour

All cases below are unit-testable against the modelled test DOM unless marked **manual**.

### `Tab`

1. After the first `host.doLayout()` with three eager tabs, the selected page reports `isDisplayed() === true` and the other two `isDisplayed() === false`. All three report `isVisible() === null` — `Tab` writes no visibility at all.
2. `setActiveTabIndex(1)` followed by `host.doLayout()` records an `addClass: ['undisplayed']` sink write against tab 0's element and a `removeClass: ['undisplayed']` write against tab 1's.
3. Across one `host.doLayout()` pass, the element of the page that pass selects receives no `addClass: ['undisplayed']` write — the selected page is skipped by the hide loop rather than hidden and re-shown.
4. A page holding a `Panel({ autoScroll: 'auto' })` scrolled to `scrollTop: 40` keeps that offset across a switch away and back: after the engine's reset is simulated (`DOM.sink.apply(panelScrollElement, { scrollTop: 0 })` while the page is hidden), selecting the page again and laying out restores `panel.getScrollTop() === 40` and records the matching sink write.
5. The capture skips non-scrolling nodes: with `syncScrollOffsets` spied on a plain `Component` child of a page, switching away from that page does not call it, while the same spy on a sibling `Panel({ autoScroll: 'auto' })` is called once.
6. ARIA is unchanged: after a pass, every unselected page's element carries `aria-hidden="true"` and the selected page's carries `aria-hidden="false"`.
7. `getPreferredSize()` / `getMinSize()` / `getMaxSize()` report the selected page's size plus the strip thickness and container perimeter, unchanged by any sibling being undisplayed.
8. `revealDescendant(target)`, where `target` sits inside a non-selected page, selects that page and leaves it `isDisplayed() === true` synchronously, before `revealDescendant` returns.
9. **Manual** — switching tabs still fades the incoming page in over 120 ms with no flash of the outgoing one.
10. **Manual** — a lazy tab still shows its spinner and then its built panel. The built panel arrives up to one fade-duration-plus-40 ms later than before.[^materialize-fallback]

### `Card`

11. `setVisibleComponentId(b)` leaves `a.isDisplayed() === false` and `b.isDisplayed() === true`, with `isVisible()` null on both.
12. The first `syncVisible` undisplays every child that is not the resolved one, including when no `visibleComponentId` was set and the resolution falls through to the first child.
13. A child holding a scrolled `Panel({ autoScroll: 'auto' })` has its offset restored on the layout pass that follows switching back to it, in the same shape as case 4.
14. Switching twice before any layout (`a` → `b` → `a`) restores only `a` on the next `doLayout`, and clears the pending record so a second `doLayout` restores nothing.
15. `getPreferredSize()` / `getMinSize()` / `getMaxSize()` still report the visible child's size plus the container perimeter after a switch.
16. **Manual** — in SQLAdmin's activity bar, switching between two sidebar views and back leaves each view's tree scrolled where it was.

### `CodeEditor`

17. `onEffectiveVisibilityChange(true)` calls `EditorView.requestMeasure()` exactly once on the stubbed `_view`.
18. `onEffectiveVisibilityChange(false)` calls neither `requestMeasure` nor `setHeight`.
19. With `autoHeightMaxRows` unset, a re-show changes no height — `syncAutoHeight` returns at its own guard.
20. **Manual** — open a file in Loom, switch to another tab and back: the editor renders at the right size with the caret and gutter aligned, and the document is still scrolled where it was.

### `Panel`

21. `doLayout()` on a `Panel({ autoScroll: 'auto' })` whose ancestor is undisplayed leaves the reserved scrollbar gutter at its pre-hide value instead of clearing it to zero.
22. `onEffectiveVisibilityChange(true)` on the same panel schedules a layout; `onEffectiveVisibilityChange(false)` does not.
23. A panel with `autoScroll: 'none'` schedules nothing in either direction.

### `Component`

24. `captureSubtreeScroll()` visits a node whose `getScrollElement()` differs from its own element even when that node's own overflow is not scrollable.
25. `restoreSubtreeScroll()` writes nothing for a node whose cached offsets are both zero.
26. Both walks are safe on a subtree whose components have never rendered — no throw, no writes.

---

## Verification

1. `npm run typecheck`
2. `npm run lint` — in particular the `local/no-raw-dom` rule, since the new scroll walk adds `DOM.sink` / `DOM.source` calls.
3. `npm run test`, with attention to:
   - `packages/lib/tests/core/ComponentSubtreeScroll.test.ts` (cases 24–26)
   - `packages/lib/tests/core/PanelHiddenRemeasure.test.ts` (cases 21–23)
   - `packages/lib/tests/component/layout/Tab.undisplay.test.ts` (cases 1–8)
   - `packages/lib/tests/component/layout/Card.undisplay.test.ts` (cases 11–15)
   - `packages/lib/tests/component/code-editor-reshow-measure.test.ts` (cases 17–19)
   - the pre-existing `packages/lib/tests/component/EffectiveVisibility.test.ts`, `tests/component/layout/Tab.lifecycle.test.ts`, `tests/component/layout/Tab.lazy.test.ts`, `tests/component/layout/Card.test.ts`, `tests/component/table/cell/DynamicCell.test.ts` and `tests/unit/core/FocusReveal.test.ts`, all of which exercise the changed paths.
4. `grep -rn 'setVisible(' packages/lib/src/typescript/lib/layout/Tab.ts packages/lib/src/typescript/lib/layout/Card.ts` — the only match is `Tab`'s `this._bar.setVisible(this._barVisible)`.
5. `npm run docs:api` — zero warnings.
6. `npm run build:lib`.
7. **WebKitGTK drag harness.** Run `npm run build:lib` in this worktree, then drive the QA harness at `/tmp/claude-1000/-home-jika-typescript-loom/830a3250-2ae3-4aa7-9de8-6a3af9d923eb/scratchpad/qa-harness.ts` against the real Loom shell in MiniBrowser with `?qa=<name>&mode=filetree&tabs=10`, passing `lib=` pointed at this worktree's `packages/lib/dist/lib` (and repointing Loom's `node_modules/@jimka/typescript-ui` symlink to match, as the harness's own header comment requires). Compare the reported `drag.avgMs` against the recorded baselines: 170.3 ms for ten tabs today, 81.6 ms for one tab. The target is 82–92 ms for ten tabs. Re-run with `tabs=1` to confirm the one-tab figure did not move.
8. **Manual smoke tests** — the cases marked **manual** in `## Expected Behaviour`, plus one more that this change reaches indirectly: in the docs app's table demo, double-click a cell to open its editor. `Cell` uses `Card` to swap renderer and editor, so the editor is now undisplayed until the edit starts; confirm it appears and takes keyboard focus on the first double-click.[^cell-focus]

---

## Documentation Impact

No public API changes: both new `Component` methods are `@internal`, and the three `onEffectiveVisibilityChange` overrides are `protected`. TypeDoc excludes all five, so no API page, catalog entry or sidebar entry moves, and `llms.txt` is unaffected.

Three prose additions:

- `packages/lib/docs/layouts/Tab.md` — a short paragraph under the existing selection/fade material: an inactive tab's content is removed from the render tree with `display: none`, so it costs nothing to lay out while another tab is showing; its scroll positions are preserved and restored when it is shown again.
- `packages/lib/docs/layouts/Card.md` — the same paragraph, adjusted for a card deck, replacing the current "all others are hidden" phrasing in the opening line.
- `packages/lib/docs/concepts/performance.md` — a new `## Inactive tab and card pages leave the render tree` section between `## Virtual scrolling` and `## Compositor-layer hints`, stating the rule and its consequence for consumers: code that needs a page's live geometry must select the page first, because a `display: none` subtree measures as zero.

---

## Potential Challenges

- **A page removed from its `Tab` or `Card` and reused elsewhere stays undisplayed.** The same is true today for `visibility: hidden`, so this is not a regression; a consumer that re-homes a page calls `setDisplayed(true)` itself.
- **A consumer who called `setVisible(false)` on a page now keeps it invisible when it is selected.** Previously `Tab` overrode that on every pass. This is the deliberate ownership split; call it out in the changelog entry for the release.
- **The lazy-tab fade completes on a fallback timer rather than `transitionend`.** `Animation.play` arms that timer unconditionally, so nothing hangs; the built panel lands up to 40 ms later than today.[^materialize-fallback]
- **`Cell` inherits the change through `Card`.** Its editor is now undisplayed rather than painted out until an edit starts.[^cell-focus]
- **One extra forced layout per tab or card switch**, from the capture walk's first DOM read. It is bounded by the number of scrolling nodes in the outgoing page and happens once per switch, never per frame — the opposite of the per-frame cost this change removes.

---

## Critical Files

| File | Why the implementer must read it |
|---|---|
| `packages/lib/src/typescript/lib/layout/Accordion.ts` (lines 1660–1680) | The precedent: a layout manager already dropping non-displayed children out of its stack with `setDisplayed`. |
| `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` (lines 520–570) | The second precedent: pooled rows parked with `setDisplayed(false)` and revived with `setDisplayed(true)`. |
| `packages/lib/src/typescript/lib/core/Component.ts` (lines 2290–2440, 4310–4430) | `setDisplayed` / `isDisplayed`, the effective-visibility reconcile, and the scroll cache the walk is built on. |
| `packages/lib/src/typescript/lib/layout/LayoutManager.ts` (lines 547–572) | `commitBounds` calls `component.doLayout()` synchronously — the reason the scroll restore can run right after `placeComponent`. |
| `packages/lib/src/typescript/lib/layout/Tab.ts` (lines 2024–2250, 2285–2315) | The layout pass being restructured, plus `computeTotalMinSize` and `revealDescendant`. |
| `packages/lib/src/typescript/lib/layout/Card.ts` (whole file, 290 lines) | Small enough to read entire; every method is touched or reasoned about. |
| `packages/lib/src/typescript/lib/core/Panel.ts` (lines 555–570, 650–706, 1082–1130) | `getScrollElement`, `doLayout`'s measurement call, and `remeasureScrollMetrics`. |
| `packages/lib/src/typescript/lib/component/display/Markdown.ts` (lines 1451–1485) | The re-show flush shape the `CodeEditor` and `Panel` overrides copy. |
| `packages/lib/src/typescript/lib/component/editor/CodeEditor.ts` (lines 1915–1930, 2255–2320) | `getScrollElement` and `syncAutoHeight`'s guards. |
| `packages/lib/tests/dom/TestDOM.ts` (lines 450–500, 1180–1210) | The recording sink reflects `scrollLeft` / `scrollTop` writes back through the modelled source, which is how the scroll-restore tests assert. |
| `ARCHITECTURE.md` | Typed setters, the DOM seam, and the `XOptions` rule that keeps `_pendingScrollRestore` off `CardOptions`. |

---

## Non-Goals

- **Unmounting inactive pages.** Pages stay in the component tree with live elements; only their boxes go.[^why-display]
- **Extending the capture/restore to `Accordion`, `Rail`, `ToolBar` or `AbstractWindow`.** They already call `setDisplayed` and already lose scroll offsets; giving them the walk is a separate, independently verifiable change.
- **Making the lazy-tab fade visible.** The panel built by `Animation.materialize` is hidden by `Tab.doLayout` for the whole fade today as well; fixing that is unrelated to this plan's problem.
- **The WebKit stylesheet-rule restyle hazard.** Measured, but shown not to be the cause of the per-tab cost, and untouched here.
- **Changing `Tab`'s strip visibility.** `this._bar.setVisible(this._barVisible)` stays exactly as it is.

---

## Notes

[^why-display]: Three options were measured in WebKitGTK on the real Loom shell, ten editor tabs open and one visible, averaging milliseconds per Split-gutter-drag frame. Baseline: one tab 81.6 ms, ten tabs 170.3 ms — about 9 ms per inactive tab per frame, of which roughly 7 ms is the hidden CodeMirror DOM (measured at 106.2 ms with only `.cm-editor` inside hidden pages set to `display: none`) and 1.5 ms the page's other components. Injecting `.ts-ui-component.invisible { display: none !important }` brought ten tabs to 92.1 ms, essentially the one-tab figure. `content-visibility: hidden` reached only 126.1 ms. A long list of ablations moved nothing at all — dropping every stylesheet-rule write, no-op'ing `Component.setVisible`, dropping `aria-hidden` writes, un-sticking CodeMirror's sticky gutters, stripping `will-change`, and no-op'ing `Tab.doLayout` entirely, the last of which write counters proved touched nothing in the hidden tabs while the cost persisted. So the cost is the hidden subtrees existing in the render tree during a resize, not anything the library does to them per frame, and `display: none` is the only one of the three that removes it. Unmounting (detaching the elements and rebuilding them on selection) would also remove it, but it costs a full re-render per tab switch, it drops focus, selection and every piece of live third-party state inside a page, and `Component.release` / `restoreReleasedState` exist precisely because that path is expensive enough to need a dedicated opt-in gate. `display: none` gets the same per-frame result for one class-token write.

[^no-visible-writes]: Today `Tab.doLayout` writes `setVisible(false)` on every child and `setVisible(true)` on the selected one on each pass, so a consumer who deliberately hid a page has that decision overwritten the next time the tab is selected. Keeping the `setVisible(true)` call alongside the new `setDisplayed(true)` would preserve that quirk byte-for-byte, at the cost of a `visibility: visible` declaration on every page's `#id` rule and of two mechanisms driving the same concept. Splitting the ownership is both smaller and more defensible: `Tab` and `Card` decide which page takes the slot, the consumer decides whether their page is painted. The visible consequence is narrow — a page a consumer explicitly hid now stays hidden when its tab is selected.

[^skip-selected]: The hide loop and the re-show are separated by the strip preparation and measurement — `this._bar.prepareStrip()` and `this._bar.stripThickness()` — which read live geometry and therefore force the browser to flush pending style and layout. With `visibility: hidden` that flush is harmless. With `display: none` it destroys the selected page's boxes mid-pass, which drops every native scroll offset in its subtree before the pass has even placed it. Resolving the selected child first and skipping it in the loop removes the window entirely, and also removes one redundant class-token add/remove pair per pass.

[^scroll-cache]: `Component.getScrollLeft` / `getScrollTop` read a cache that, as their own JSDoc says, is authoritative only while the scroll is driven through `setScrollLeft` / `setScrollTop`. A user scrolling a `Panel` with the wheel or a keyboard moves the native offset without going through either, so the cache goes stale — which is why `syncScrollOffsets` exists. That is the reason the capture has to run rather than the restore simply reading the cache. The capture must precede the display flip because a `display: none` element reports `scrollTop` as 0; the restore must follow `placeComponent` because a scroll offset written against a subtree that has not been re-laid-out yet is clamped to the stale, smaller scroll range. `LayoutManager.commitBounds` calls `component.doLayout()` unconditionally, which recurses through the whole page, so by the time `placeComponent` returns the final geometry is committed and a synchronous restore is correct — no `afterNextLayout` deferral needed, and no frame of wrong scroll position. The capture/restore pairing itself follows `Component.setContentFrame`, `clearContentFrame` and `reparentContent`, which each already read a native scroll offset before a DOM operation that would destroy it and write it back afterwards.

[^sizing-safe]: Checked end to end. `Component.getPreferredSize` / `getMinSize` / `getMaxSize` merge the component's own constraint fields with the layout manager's report; every container manager aggregates its children's reports the same way, so the recursion bottoms out at leaf components. Of the five leaves in the library that override `getPreferredSize`, `Button` derives from a text measurement, `Text` and every other text-bearing component measure through `DOM.source.measureText`, which uses an off-screen probe and a canvas metrics context in `core/DOM.ts` — neither is the component's own element, so neither cares whether that element has a box; `Tree` returns row count times row height; `MarkdownMinimap` takes the max of its parent's report and a constant; and `Markdown` returns a cached `_measuredHeight` field whose own measurement paths are already guarded on `isEffectivelyVisible()` — meaning `Markdown` is already in the "hidden, do not measure" regime today, because `Tab`'s existing `setVisible(false)` already makes that query false. Nothing in the chain reaches for `getElementRect` or `getScrollMetrics`. The one component that *does* read live geometry from inside a layout pass is `Panel`, and its own decision above covers it.

[^focus-unchanged]: `FocusTraversal` builds its tab-stop list through `visibleFocusable` (`core/Focusable.ts:108`), which filters on `DOM.source.isRenderedVisible`. That predicate walks the ancestor chain rejecting anything whose computed `display` is `none` **or** whose computed `visibility` is `hidden` (`core/DOM.ts:2612`), so the set of reachable stops is identical under either mechanism. Losing focus is likewise unchanged: a browser blurs a focused element when it becomes `visibility: hidden` just as it does when it becomes `display: none`, and a tab click has already moved focus to the tab button before the page is hidden. `aria-hidden` on a `display: none` page is redundant but harmless, and removing it would be an unrelated change, so the two `getAria().setHidden(...)` calls in `Tab.doLayout` stay.

[^codemirror-measure]: CodeMirror's `ViewState.measure` returns early when the editor is neither in view nor in the window (`@codemirror/view`'s `inWindow` check against `getBoundingClientRect`), which a `display: none` editor always fails. CodeMirror does install a `ResizeObserver` on its scroller that would normally catch the re-show, but it only forwards the event when the view's last update is more than 75 ms old, so a re-show close behind an edit is swallowed. `requestMeasure()` is CodeMirror's own public way to force the pass and is safe to call unconditionally — it schedules, it does not measure inline. `syncAutoHeight` is called straight after because a re-measured view can report a different content height, and it already returns at its own guard when `autoHeightMaxRows` is unset, which is the common case.

[^panel-zero-metrics]: `Panel.doLayout` calls `remeasureScrollMetrics`, which reads `DOM.source.getScrollMetrics` live. A panel inside a `display: none` page measures every metric as zero, so the pass clears the reserved scrollbar gutter, zeroes both shadow edges and pushes zeroed metrics into the overlay scrollbars. That happens only when something schedules the hidden page's layout — a background content change — but when it does, the page re-shows with a frame of wrong child widths before the next pass corrects it. Withholding the read while the panel has no boxes, and scheduling a catch-up layout when it comes back, removes the window. `Markdown` already guards four of its own measurement paths on `isEffectivelyVisible()` and flushes from `onEffectiveVisibilityChange`; this is the same shape. The guard also fires for a panel hidden with `setVisible(false)`, where the measurement would still have been valid — that is accepted for consistency, and the scheduled catch-up makes it harmless.

[^dock-inherits]: `Dock` builds each panel frame as a `Container` with either a `Tab` layout manager (the lazy path, `overlay/Dock.ts:644`) or a `Fit` one (the eager path, `overlay/Dock.ts:673`), and never calls `setVisible` or `setDisplayed` itself — `grep -n 'setVisible' packages/lib/src/typescript/lib/overlay/Dock.ts` returns nothing. Frames live inside region containers whose manager is `Tab`, so undisplaying an inactive frame is `Tab`'s doing. A `Fit` frame's single child is never hidden by anything, and `DockRegion`'s drop-zone arithmetic reads the region's own viewport rect (`layout/DockRegion.ts:239`), never a hidden frame's geometry. `Split` panes are regions, which are never undisplayed, and `Split` already copes with a non-displayed pane in any case.

[^materialize-fallback]: `Animation.materialize` adds the built panel to the host and fades it in over the spinner, but `Tab.doLayout` runs between the two and hides the panel, because `getVisibleComponent()` returns the spinner for as long as the entry's state is `"building"`. That is true today as well — the fade already runs on a `visibility: hidden` element and is not seen. The one real difference is that a CSS transition does not run at all on a `display: none` element, so `transitionend` never fires; `Animation.play` arms a `durationMs + 40 ms` fallback timer at the same moment it writes the `to` styles, and that timer runs `finish`, so `onReady` still fires, the spinner is still dropped and the panel still lands at opacity 1. The net effect is the built panel appearing up to 40 ms later than today.

[^cell-focus]: `component/table/cell/Cell.ts:137` gives every table cell a `Card` to swap its renderer and editor, so this change makes an idle cell's editor `display: none` rather than `visibility: hidden` — a small win for a large table, since the hidden editors leave the render tree. `Cell.startEdit` flips the card, calls `this.doLayout()` synchronously and then focuses the editor in the same task. Focusing an element whose `display: none` was removed earlier in the same task works because both Chromium and WebKit flush pending style from inside `Element::focus()` before testing focusability. It is still the one behaviour in this change that no offline test can confirm, which is why `## Verification` carries an explicit manual step for it.
