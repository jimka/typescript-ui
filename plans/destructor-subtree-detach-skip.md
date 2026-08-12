# Skip Redundant Native Removal During Subtree Teardown — Implementation Plan

## Overview

Destroying a component subtree with many descendants (a large `Table` with thousands of cells) is slow because [`Component.destructor()`](packages/lib/src/typescript/lib/core/Component.ts#L762) tears down bottom-up: it recurses into every child's `destructor()` *before* removing its own element, so the deepest node in the tree calls native `DOM.sink.removeElement()` first, and every ancestor above it repeats the same call on the way back up. Removing an ancestor's element already takes every DOM descendant out of the document in one native operation, so all of those descendant calls are wasted work.

This plan reorders `destructor()` so a component removes its own element *before* recursing into its children, and gates that removal on `DOM.source.isConnected()` (already implemented for [production](packages/lib/src/typescript/lib/core/DOM.ts#L2156) and the [offline test harness](packages/lib/tests/dom/TestDOM.ts#L1078)). A connected root removes itself once; every descendant reached afterward — through the normal `_components` recursion, or through any component-owned disposal loop elsewhere in the codebase — finds its own element already disconnected and skips the native call, while still running every other piece of teardown bookkeeping.

The change is confined to `Component.ts`. No public API changes.

---

## Architecture Decisions

### Move the component's own teardown before the child recursion

[`clearClipFrame()`](packages/lib/src/typescript/lib/core/Component.ts#L1160), [`clearContentFrame()`](packages/lib/src/typescript/lib/core/Component.ts#L1291), and the own-element `DOM.sink.removeElement()` call move from their current position (after the `_components` loop, after layout-manager detach, after theme cleanup) to immediately after `Event.purgeComponent()`, before the `for (const child of this._components)` loop.[^why-reorder] The `_components` recursion, layout-manager detach, theme cleanup, style-rule disposal, and handle release all keep their current relative order and stay where they are today — only the component's *own* frame/element teardown moves earlier.

### Gate the native removal on `DOM.source.isConnected()`, not a threaded flag

`if (element && DOM.source.isConnected(element)) { DOM.sink.removeElement(element); }` replaces the unconditional call. `isConnected` is already used for exactly this question three times in this same file — [`getBorderSize`](packages/lib/src/typescript/lib/core/Component.ts#L3082), [`onFirstLayout`](packages/lib/src/typescript/lib/core/Component.ts#L5442), [`runFirstLayoutCallbacks`](packages/lib/src/typescript/lib/core/Component.ts#L5470) — so this follows established precedent rather than introducing a new primitive.[^flag-rejected]

### Leave `clearClipFrame()` / `clearContentFrame()`'s own frame-element removal unconditional

`disposeFrame()` (called by both) still calls `DOM.sink.removeElement(frame)` unconditionally. Clip/content frames are wrapper `<div>`s used only by [`Border`](packages/lib/src/typescript/lib/layout/Border.ts#L963), [`Grid`](packages/lib/src/typescript/lib/layout/Grid.ts#L1007), and the generic auto-scroll overflow path in [`LayoutManager.ts`](packages/lib/src/typescript/lib/layout/LayoutManager.ts#L294) — never by table `Row`/`Cell`, which is the motivating "thousands of descendants" case. Gating this second, much rarer removal would add a second connectivity check for no measurable benefit on the case this plan targets, so it stays as-is.

### Leave the standalone `removeElement()` and `release()` methods untouched

[`removeElement()`](packages/lib/src/typescript/lib/core/Component.ts#L1028) and [`release()`](packages/lib/src/typescript/lib/core/Component.ts#L1055) each detach a single component, not a recursive subtree — there is no ancestor-already-removed-me redundancy for them to skip. Every other `removeElement()` call site (`DialogBackdrop.ts`, `AnimatedDropdown.ts`, `Tooltip.ts`, `Panel.ts`'s scroll-shadow overlay, `DragGhost.ts`, and the rest of the 21 call sites) is likewise a single-component detach, not a bulk-teardown recursion, so none of them need this change.

---

## Internal Structure

Current [`destructor()`](packages/lib/src/typescript/lib/core/Component.ts#L762) (abbreviated, comments omitted — see the file for the full text):

```typescript
protected destructor() {
    pendingLayouts.delete(this);
    Event.purgeComponent(this.getId());

    for (const child of this._components) {
        child.destructor();
    }
    this._components = [];

    const layoutManager = (this._options.layoutManager as LayoutManager | undefined)
        ?? (this._defaultLayoutManager ??= new Absolute());
    if (layoutManager && layoutManager.getContainer() === this) {
        layoutManager.detach();
    }

    for (const dispose of this._themeCleanups) {
        dispose();
    }
    this._themeCleanups.length = 0;

    this.clearClipFrame();
    this.clearContentFrame();

    let element = this.getElement();
    if (element) {
        DOM.sink.removeElement(element);
    }

    this._styleRule.dispose();
    for (const rule of this._deferredStyleRules.values()) {
        rule.dispose();
    }

    _componentFinalizer.unregister(this);
    for (const handle of this._ownedHandles) {
        cancelTransitions(handle);
    }
    for (const handle of this._ownedHandles) {
        DOM.sink.release(handle);
    }
    this._ownedHandles.length = 0;
    this._element = undefined;
}
```

New order — only the position of the clip/content-frame teardown and the own-element removal changes, plus the `isConnected` guard:

```typescript
protected destructor() {
    pendingLayouts.delete(this);
    Event.purgeComponent(this.getId());

    this.clearClipFrame();
    this.clearContentFrame();

    let element = this.getElement();
    if (element && DOM.source.isConnected(element)) {
        DOM.sink.removeElement(element);
    }

    for (const child of this._components) {
        child.destructor();
    }
    this._components = [];

    const layoutManager = (this._options.layoutManager as LayoutManager | undefined)
        ?? (this._defaultLayoutManager ??= new Absolute());
    if (layoutManager && layoutManager.getContainer() === this) {
        layoutManager.detach();
    }

    for (const dispose of this._themeCleanups) {
        dispose();
    }
    this._themeCleanups.length = 0;

    this._styleRule.dispose();
    for (const rule of this._deferredStyleRules.values()) {
        rule.dispose();
    }

    _componentFinalizer.unregister(this);
    for (const handle of this._ownedHandles) {
        cancelTransitions(handle);
    }
    for (const handle of this._ownedHandles) {
        DOM.sink.release(handle);
    }
    this._ownedHandles.length = 0;
    this._element = undefined;
}
```

---

## Ordered Implementation Steps

1. **Edit [`Component.ts:762-870`](packages/lib/src/typescript/lib/core/Component.ts#L762).** Reorder the method body to match the "New order" block above:
   - Keep `pendingLayouts.delete(this)` and `Event.purgeComponent(this.getId())` as the first two lines, unchanged.
   - Move the `this.clearClipFrame(); this.clearContentFrame();` pair, and the `let element = this.getElement(); if (element) { DOM.sink.removeElement(element); }` block, to run immediately after `Event.purgeComponent(...)` — before the `for (const child of this._components)` loop.
   - Change the removal condition from `if (element)` to `if (element && DOM.source.isConnected(element))`.
   - Move the existing comment above the clip/content-frame calls ("Tear any active clip / content frame down first...") along with the code, and extend it with one sentence explaining *why* this now runs before the child recursion: a connected element's removal here detaches the whole subtree in one native call, so each descendant's own removal (reached below, or via any other component-owned disposal loop) finds itself already disconnected and skips.
   - Rewrite the large comment currently at lines 790-815 (above `const layoutManager = ...`). It documents *why* layout-manager detach ran *before* element removal; that relationship is now inverted (detach runs *after*, since removal moved earlier). Keep the Accordion/Split/Tab factual content (they cache `_element` via `getElement(true)` and never hit the `getElementById` fallback) but restate the conclusion: detach running after removal was already exercised by a prior investigation into this exact ordering question and left the suite green, so no override is known to require a connected element at detach time.
   - Do not otherwise touch the layout-manager detach, theme-cleanup, style-rule-disposal, or handle-release blocks — they keep their current code and relative order, just now positioned after the relocated block instead of before it.
   - Verify: `grep -n "DOM.sink.removeElement(element)" packages/lib/src/typescript/lib/core/Component.ts` still shows exactly one occurrence inside `destructor()`, now guarded by `DOM.source.isConnected(element)`.

2. **Add a new test file** `packages/lib/tests/component/destructor-subtree-detach-skip.test.ts`, following the structure of the sibling [`element-release.test.ts`](packages/lib/tests/component/element-release.test.ts) (same `DOM_CONFIG`, same `installTestDOM`/`DOM.reset()` `beforeEach`/`afterEach`, same `Recorder` type-alias-and-cast pattern for reading `DOM.sink.writes`). Import `setConnected` from `'../dom/TestDOM'` alongside `installTestDOM`. Cover the cases in `## Expected Behaviour` below.

3. **Typecheck and run the full test suite.** This reorders a foundational method that 40+ subclasses override (each calling `super.destructor()` as its last statement, so none of them run code after the reordered section — verified during planning, not something to re-derive). Run the project's full `npm test`/`vitest run` (whichever the repo's `package.json` defines) and `tsc`/typecheck script, not just the new file — the reorder inverts one previously-untested ordering assumption (layout-manager detach relative to element removal) across every component that has an active `LayoutManager` at teardown time.

4. **Re-read the diff end to end** against `Component.ts:762-870` before considering this done: confirm the moved block's comments were updated (not just the code), confirm no other line in `destructor()` changed, and confirm the `isConnected` guard is the only new runtime check introduced.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Component.ts` |
| Create | `packages/lib/tests/component/destructor-subtree-detach-skip.test.ts` |

---

## Expected Behaviour

All cases are unit-testable offline via `installTestDOM` + `setConnected` + `DOM.sink.writes` (no manual/browser verification needed — this is pure teardown-sequencing logic, not layout or visual behaviour).

| Case | Setup | Expected `removeElement` count |
|---|---|---|
| Connected subtree | `root → child → grandchild`, only `root`'s handle seeded `setConnected(..., true)` (descendants left at their default `false`) | 1 (root only) |
| Never-connected subtree | Same tree, no handle seeded connected | 0 |
| Reused/"portaled" element still reports connected | Same tree, `root` **and** `child` seeded connected `true`, `grandchild` left unseeded | 2 (root and child; grandchild still skipped) |
| Bookkeeping survives a skip | Same tree as the first case | `DOM.sink.release` is still called once per handle owned by `child` and `grandchild`, even though their own `removeElement` call was skipped |

The third case is the regression guard for the portaled-component concern: `DialogBackdrop` and `AnimatedDropdown`-based dropdowns are constructed as private fields and never passed through `addComponent`[^portaled-evidence], so they are never reached by the `_components` recursion this plan changes — but the test proves the mechanism itself is safe even if that convention were ever violated, because the skip is driven by each element's own live connectivity, not by its position in the component tree.

The fourth case guards against a regression that would silently leak handles: skipping the native `removeElement` call must never skip `cancelTransitions` / `DOM.sink.release` / style-rule disposal for the same component.

---

## Verification

- `npx tsc --noEmit` (or the project's configured typecheck script) — zero errors.
- Full test suite (`vitest run` or the project's `npm test`) — zero regressions, with particular attention to any test that asserts `removeElement` call counts during `dispose()`/`destructor()` (e.g. [`Markdown.test.ts`](packages/lib/tests/component/display/Markdown.test.ts#L769), [`element-release.test.ts`](packages/lib/tests/component/element-release.test.ts)) and any layout-manager teardown test (`Accordion`, `Split`, `Tab`/`TabBar`, `Dock`).
- New file `destructor-subtree-detach-skip.test.ts` passes, covering all four `## Expected Behaviour` rows.
- `grep -n "DOM.sink.removeElement(element)" packages/lib/src/typescript/lib/core/Component.ts` — three occurrences today (`destructor()`, `removeElement()`, `release()`); after the edit, only the `destructor()` occurrence is preceded by an `isConnected` check on the same `if` — the other two are unchanged.

---

## Potential Challenges

- **The layout-manager-detach reorder is the one behavior inversion introduced here** — detach now runs after the component's own element is gone (or already found disconnected) instead of before. This was investigated during planning and is backed by the codebase's own prior experiment (documented in the comment being rewritten), but a full test-suite run is the actual gate, not the reasoning alone. Mitigation: step 3.
- **`VirtualRowView`'s pooled rows and `Panel`'s scroll-shadow overlay are raw-appended outside `_components`** and are not touched by this change, yet they still benefit automatically whenever an ancestor further up the tree (e.g. the owning `Table`) is disposed as a whole — because the skip check reads live connectivity, not `_components` membership. Confirmed during planning: `Table` registers both `_header` and `_body` via `addComponent`[^rowpool-evidence], so a `table.dispose()` call removes `Table`'s own element once and every `Row`/`Cell` beneath it (reached through `Body`'s row-pool loop, which itself is unmodified) finds its own element already disconnected. No mitigation needed — this is a property of the design, not a gap, but it is worth the implementer understanding why no change to `VirtualRowView.ts` is required.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `destructor()` (L762), `removeElement()` (L1028), `release()` (L1055), `clearClipFrame()` (L1160), `clearContentFrame()` (L1291): the file being changed.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — `ProductionDOMSource.isConnected()` (L2156), `contains()` (L2213): the seam primitive being called and the rejected alternative.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `ModelledDOMSource.isConnected()` (L1078), `setConnected()` (L1488), `RecordingDOMSink.removeElement()` (L490): the offline seam the new test relies on.
- [`packages/lib/tests/component/element-release.test.ts`](packages/lib/tests/component/element-release.test.ts) — sibling test file to mirror for structure and idiom.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts) — `destructor()` (L125): read to understand why the row pool needs no direct change (see Potential Challenges).

---

## Non-Goals

- **Chunking JS-side teardown across frames** (`requestIdleCallback`-style incremental cleanup for pathologically large subtrees, applied after a synchronous visual detach) is not designed or implemented here. It was raised as a possible follow-on but is a separate concern from the single-native-removal optimization this plan delivers; the two would compose cleanly (chunking would operate on the same now-flag-free walk this plan produces), but chunking's own scheduling, cancellation, and partial-teardown-visibility questions are out of scope.
- **Extending the `isConnected` guard into `disposeFrame()`'s own `removeElement()` call** is intentionally left out — see Architecture Decisions.
- **Touching `VirtualRowView.ts`, `Panel.ts`, `TabBar.ts`, or any other raw-appended-child disposal site** is intentionally left out — see Potential Challenges for why they need no change to benefit from this fix.

---

## Notes

[^why-reorder]: `destructor()`'s current shape recurses into every child *before* doing its own removal (post-order), which means the deepest node in the tree always reaches its own `DOM.sink.removeElement()` call first — while every ancestor above it is still connected, since nothing has been removed yet. By the time an ancestor's own removal runs, its entire subtree has already individually removed itself, so the ancestor's call is the only one that was ever redundant, and it runs last. Reversing that — own removal before recursing into children — means the topmost connected node in any given `dispose()` call removes itself exactly once, and every node below it (reached via `_components`, or via any other disposal path that eventually calls into this same method) finds its own element already disconnected and skips.

[^flag-rejected]: A boolean threaded through the recursive `destructor()` call (set once the parent's own removal has run, read by children instead of querying the DOM) was considered and rejected. Two reasons: first, `destructor()` is the documented public override hook every subclass extends with its own no-argument signature — threading a parameter through it would require touching all 40+ overrides, or silently failing to propagate past any override that doesn't forward it. Second, and decisively: `DialogBackdrop` and `AnimatedDropdown`-based dropdowns are owned as private fields, never registered via `addComponent` (confirmed by grep — see `[^portaled-evidence]`), so today's convention already keeps portaled components out of the `_components` recursion this plan touches. But a hand-set flag would only be as safe as that convention; a live `isConnected` read is correct by construction regardless of it, and — as `[^rowpool-evidence]` shows — it also generalizes for free to disposal code this plan never touches (`VirtualRowView`'s row pool), which a flag would not, since a flag has to be explicitly threaded through every such ad-hoc loop individually.

[^portaled-evidence]: Verified by reading both construction sites: [`Dialog.ts:641`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L641) assigns `this._backdrop = new DialogBackdrop()` with no `addComponent` call anywhere near it; [`AutoCompleteField.ts:124`](packages/lib/src/typescript/lib/component/input/AutoCompleteField.ts#L124) assigns `this._dropdown = new AutoCompleteDropdown(...)`, again never passed to `addComponent`. Both are `Position.FIXED` components mounted via [`LayerManager.mount()`](packages/lib/src/typescript/lib/core/LayerManager.ts#L245), which physically reparents the element to `DOM.source.getDocumentElement()` — a real DOM move, not just a CSS positioning trick — so their elements are genuinely outside the DOM subtree of whatever component owns them.

[^rowpool-evidence]: [`VirtualRowView.destructor()`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L125) disposes `_rowPool` in a manual loop because pooled rows are raw-appended to the scroller's rows container and never registered via `addComponent`, so the base recursion cannot reach them — its own doc comment says so. In isolation (calling `body.dispose()` directly) this loop would still perform one real removal per pooled row, since nothing has removed `Body`'s own element yet at that point. But [`Table.ts:243` and `:248`](packages/lib/src/typescript/lib/component/table/Table.ts#L243) register both `_header` and `_body` via `addComponent`, so `table.dispose()` reaches `Body` through the normal `_components` recursion — by which point `Table`'s own element (if connected) has already been removed as a single native call, taking `Body`'s element, its rows container, and every pooled row with it. Each pooled row's own `destructor()` (via `Row`, which has no `destructor()` override and so runs the base class's own `isConnected` check directly) then finds itself already disconnected and skips.
