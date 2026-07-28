---
depends-on: [docs-component-demo-set]
touches-shared: [packages/lib/src/typescript/lib/layout/Accordion.ts]
---

# Scrollbar Leak and Layout Guards — Implementation Plan

## Overview

Two unrelated library bugs, both found while building the docs component demo set and both left unfixed there because that plan put `packages/lib/src` out of scope.

**Bug 1 — stylesheet rules leak when a raw-appended child component is torn down.** A component that is held in a private field and attached with a raw `DOM.sink.appendChild` never enters its owner's `_components` array, so the child recursion in [`Component.destructor()`](packages/lib/src/typescript/lib/core/Component.ts#L745) never reaches it. Its per-instance `#uuid` stylesheet rules are therefore never deleted. Five owners have this shape and leak today: [`Panel`](packages/lib/src/typescript/lib/core/Panel.ts#L1141) and [`VirtualScroller`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L127) (a pair of overlay `Scrollbar`s each), and the [`Border`](packages/lib/src/typescript/lib/layout/Border.ts#L1185), [`Split`](packages/lib/src/typescript/lib/layout/Split.ts#L1065) and [`Accordion`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1178) layout managers (gutters, section headers and panel wrappers).

**Bug 2 — `Border` and `Accordion` fail when laid out before the container has a DOM element.** [`Border.doLayout`](packages/lib/src/typescript/lib/layout/Border.ts#L872) throws `"Unable to determine component size."`; [`Accordion.doLayout`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1498) calls `createSection`, which dereferences a null container element inside the DOM sink. Every other layout manager returns quietly instead. This plan makes both match, and removes the wrapper `Panel`s that two docs demos carry only to dodge the failure.

Both fixes land in `packages/lib/src`; the demo cleanup lands in `packages/docs/src/demos/`.

---

## Architecture Decisions

### Branch from `feature/docs-component-demo-set`, not from `master`

This plan is implemented on a branch cut from `feature/docs-component-demo-set`, and merges after it. The two demo files it edits do not exist on `master`.[^branch-point]

### A layout pass before the container has an element is a silent no-op

`Border` and `Accordion` return from `doLayout` when the container has no element, exactly as `HBox`, `VBox`, `Grid`, `Split` and `Tab` already do. The premature pass is a normal transient state, not a caller error.[^premature-is-normal]

The five managers that already guard, and the two that do not:

| Manager | Line | Shape today |
|---|---|---|
| `HBox` | [HBox.ts:272](packages/lib/src/typescript/lib/layout/HBox.ts#L272) | `const innerSize = container.getInnerSize(); if (!innerSize) { return; }` |
| `VBox` | [VBox.ts:271](packages/lib/src/typescript/lib/layout/VBox.ts#L271) | same |
| `Grid` | [Grid.ts:669](packages/lib/src/typescript/lib/layout/Grid.ts#L669) | same |
| `Split` | [Split.ts:1162](packages/lib/src/typescript/lib/layout/Split.ts#L1162) | same |
| `Tab` | [Tab.ts:1720](packages/lib/src/typescript/lib/layout/Tab.ts#L1720) | reads the size and tolerates `null` downstream |
| `Border` | [Border.ts:880](packages/lib/src/typescript/lib/layout/Border.ts#L880) | **throws** |
| `Accordion` | [Accordion.ts:1507](packages/lib/src/typescript/lib/layout/Accordion.ts#L1507) | **calls `createSection`, which dereferences a null element** |

### `Border`'s second throw is deleted as unreachable

The `"Unable to determine component insets."` throw at [Border.ts:885](packages/lib/src/typescript/lib/layout/Border.ts#L885) goes away with the size throw above it. [`Component.getContentInsets()`](packages/lib/src/typescript/lib/core/Component.ts#L2004) is typed `Insets` and every return path builds one, so the branch can never run.[^dead-insets]

### `Accordion`'s guard tests the element, not the inner size

`Accordion.doLayout` gets `if (!container.getElement()) { return; }` at the top, and every existing line below it stays where it is — including the `containerSize ? containerSize.width : 0` fallback at [Accordion.ts:1517](packages/lib/src/typescript/lib/layout/Accordion.ts#L1517). Hoisting the existing `getInnerSize()` read to the top instead would move it above `applyContainerTheming()`, which sets the container's themed border and so changes what that read returns.[^accordion-guard]

### Teardown of a raw-appended child goes through `dispose()`

Every owner in Bug 1 calls `dispose()` on the child it raw-appended, from its own `destructor()` (a component) or `detach()` (a layout manager). This mirrors [`VirtualRowView.destructor()`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L131), which already does exactly this for its raw-appended pool rows, and [`AbstractWindow`](packages/lib/src/typescript/lib/overlay/AbstractWindow.ts#L1925), which does it for its eight resize-border strips.[^dispose-precedent]

### `SplitGutter.destroy()` and `CollapseButton.destroy()` become `destructor()` overrides

Both classes today expose a public `destroy()` that unhooks listeners and stops — it never reaches `Component.destructor()`, so the rules survive. Each becomes a `protected destructor()` override ending in `super.destructor()`, and the three managers that called `gutter.destroy()` call `gutter.dispose()` instead. This is the teardown seam the codebase settled on, and it removes two public methods.[^destroy-to-destructor]

### The sweep stops at owners that raw-append **and** leak today

Five owners are fixed. Three shapes that look similar were checked and are not leaks: `Panel`'s scroll-shadow overlay and its inner overlay-scroll element are raw `Handle`s, not components, and both are already untracked and released ([Panel.ts:888-891](packages/lib/src/typescript/lib/core/Panel.ts#L888), [Panel.ts:1169-1171](packages/lib/src/typescript/lib/core/Panel.ts#L1169)); `Tab`, `TabBar`, `ScrollStrip`, `Popover` and `AbstractWindow` already dispose their raw-appended pieces; `DialogBackdrop.destroy()` already ends in `this.destructor()`. Per-row and per-cell renderers are excluded — see `## Non-Goals`.[^sweep-bound]

---

## Public API

```typescript
// packages/lib/src/typescript/lib/component/container/VirtualScroller.ts
class VirtualScroller {
    /** Disposes the two Scrollbar overlays this scroller owns. */
    dispose(): void;
}
```

```typescript
// packages/lib/src/typescript/lib/component/container/SplitGutter.ts
// REMOVED:  destroy(): void
// ADDED:    protected destructor(): void      // consumers call the inherited dispose()

// packages/lib/src/typescript/lib/component/container/CollapseButton.ts
// REMOVED:  destroy(): void
// ADDED:    protected destructor(): void      // consumers call the inherited dispose()
```

No other signature changes. `VirtualScroller` is a plain class, not a `Component`, so its `dispose()` is a new method rather than an override.

---

## Ordered Implementation Steps

Work test-first: for each fix, write the test named in the step, watch it fail, then make the change.

**Bug 2 — the layout guards (do these first; they are the smallest and the demo cleanup depends on them).**

1. Create `packages/lib/tests/component/layout/PrematureLayout.test.ts` covering cases B2-1 … B2-4 in `## Expected Behaviour`. Run it: B2-1 fails with `Error: Unable to determine component size.`, B2-2 fails reporting 2 bad `appendChild` writes, B2-4 fails on the `Border` row. B2-3 fails as a consequence of B2-1/B2-2.

2. In [`packages/lib/src/typescript/lib/layout/Border.ts`](packages/lib/src/typescript/lib/layout/Border.ts#L872), inside `doLayout`:
   - Replace the `throw new Error("Unable to determine component size.");` at line 880 with `return;`, and put a comment above the `if (!containerSize)` guard saying the container has no element yet and the next pass will lay out — mirroring `HBox.doLayout`.
   - Delete the whole `if (!containerInsets) { throw new Error("Unable to determine component insets."); }` block at lines 884-886. Keep the `let containerInsets = container.getContentInsets();` line above it.
   - Leave the unrelated `"Unable to determine preferred size for …"` throws further down the method alone; they fire on a real misconfiguration, not on a premature pass.

3. In [`packages/lib/src/typescript/lib/layout/Accordion.ts`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1498), inside `doLayout`, insert immediately after the existing `if (!container) { return; }` block:

   ```typescript
   // Nothing to build until the container has an element: `createSection`
   // below appends each header and wrapper straight onto it, so a premature
   // pass would dereference a null element. Such a pass is normal — see
   // `HBox.doLayout` — so return and let the next pass build the sections.
   if (!container.getElement()) {
       return;
   }
   ```

   Change nothing else in the method. `PrematureLayout.test.ts` now passes.

4. Regression checkpoint: `grep -n 'Unable to determine component' packages/lib/src/typescript/lib/layout/Border.ts` — expect zero matches. (The `"Unable to determine preferred size for …"` throws stay, so grepping for `throw new Error` alone would still hit.)

**Bug 1 — the leak.**

5. Create `packages/lib/tests/core/Panel.styleRuleDisposal.test.ts` covering cases B1-1 and B1-2. Run it: B1-1 fails, reporting leaked `#uuid` keys.

6. In [`packages/lib/src/typescript/lib/core/Panel.ts`](packages/lib/src/typescript/lib/core/Panel.ts#L1141), inside `removeOverlayScrollbars`, change `this._scrollbarV.removeElement();` (line 1149) to `this._scrollbarV.dispose();` and `this._scrollbarH.removeElement();` (line 1155) to `this._scrollbarH.dispose();`. Update the method's JSDoc: it now *disposes* both bars rather than detaching them. `Panel.styleRuleDisposal.test.ts` passes.

7. Create `packages/lib/tests/component/container/VirtualScroller.styleRuleDisposal.test.ts` covering case B1-3. Run it: it fails, reporting two leaked keys.

8. In [`packages/lib/src/typescript/lib/component/container/VirtualScroller.ts`](packages/lib/src/typescript/lib/component/container/VirtualScroller.ts#L165), add a `dispose()` method immediately above `ownedHandles()`:

   ```typescript
   /**
    * Disposes the two `Scrollbar` overlays this scroller owns. They are
    * appended straight onto the owner's element rather than registered as its
    * children, so the owner's `destructor()` recursion cannot reach them and
    * their per-instance stylesheet rules would otherwise survive teardown.
    * Called from `VirtualRowView.destructor()`.
    */
   dispose(): void {
       this._scrollbarV.dispose();
       this._scrollbarH.dispose();
   }
   ```

9. In [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L131), add `this._scroller?.dispose();` inside `destructor()`, after the `_rowPool` loop and before `super.destructor()`. Extend the method's JSDoc to name the scroller's bars alongside the pooled rows. `VirtualScroller.styleRuleDisposal.test.ts` passes.

10. Create `packages/lib/tests/component/layout/ManagerChrome.styleRuleDisposal.test.ts` covering cases B1-4, B1-5, B1-6 and B1-7. Run it: B1-4, B1-5 and B1-6 fail with leaked keys.

11. In [`packages/lib/src/typescript/lib/component/container/CollapseButton.ts`](packages/lib/src/typescript/lib/component/container/CollapseButton.ts#L310), replace `destroy(): void {` with `protected destructor(): void {` and add `super.destructor();` as the last statement. Update its JSDoc to say it removes the listeners and then runs the inherited teardown.

12. In [`packages/lib/src/typescript/lib/component/container/SplitGutter.ts`](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L477), replace `destroy() {` with `protected destructor(): void {`, change `this._collapseButton?.destroy();` to `this._collapseButton?.dispose();`, and add `super.destructor();` as the last statement. The explicit `_collapseButton` call is required, not redundant: the button is raw-appended at [SplitGutter.ts:193](packages/lib/src/typescript/lib/component/container/SplitGutter.ts#L193) and is not a registered child, so `super.destructor()` cannot reach it.

13. Change the three call sites from `gutter.destroy();` to `gutter.dispose();`: [Border.ts:1185](packages/lib/src/typescript/lib/layout/Border.ts#L1185), [Split.ts:1065](packages/lib/src/typescript/lib/layout/Split.ts#L1065), [Accordion.ts:1180](packages/lib/src/typescript/lib/layout/Accordion.ts#L1180).

14. In [`packages/lib/src/typescript/lib/layout/Accordion.ts`](packages/lib/src/typescript/lib/layout/Accordion.ts#L1170), inside `detach()`, replace the two lines

    ```typescript
    DOM.sink.removeElement(this._headers[i].getElement()!);
    DOM.sink.removeElement(this._panelWrappers[i].getElement()!);
    ```

    with

    ```typescript
    this._headers[i].dispose();
    this._panelWrappers[i].dispose();
    ```

    Leave the reparenting `if (component && container)` block above them exactly as it is — it must still run first, so the section's content element moves back onto the container before the wrapper is destroyed. Update `detach()`'s JSDoc: it now disposes the headers and wrappers rather than only removing their elements. `ManagerChrome.styleRuleDisposal.test.ts` passes.

15. Regression checkpoint: `grep -rn '\.destroy()' packages/lib/src/typescript/lib` — no surviving hit may name a `gutter` or `_collapseButton`. The hits that remain belong to unrelated non-`Component` lifecycles (`DockRegion`, `PlaybackEngine`, CodeMirror's `EditorView`) and to `DialogBackdrop`, whose `destroy()` already ends in `this.destructor()`.

**Stale comments in existing tests.**

16. In [`packages/lib/tests/component/dispose-full-teardown.test.ts`](packages/lib/tests/component/dispose-full-teardown.test.ts), the `ownIds` block comment (around lines 70-83) names `Panel`'s `_scrollbarV` / `_scrollbarH` and `Border`'s resize gutters as a pre-existing out-of-scope leak. Drop that claim and say instead that both are fixed by this plan. **Keep every `ownIds` narrowing in place, including `VideoPlayer`'s** — its residual two rules come from neither of those two sources (its `Border` manager creates no gutters at all), so removing the narrowing turns the row red for a reason this plan does not address.

17. In [`packages/lib/tests/component/shared/VirtualRowView.poolDisposal.test.ts`](packages/lib/tests/component/shared/VirtualRowView.poolDisposal.test.ts), the `survivingRulesFor` doc comment lists "the scrollbar overlays" among the rules a destroyed view still leaves behind. Remove that phrase; the header cells remain accurate. Leave the function's scoping behaviour unchanged.

**Consumer cleanup.**

18. In `packages/docs/src/demos/border-regions.ts`, change the final line from `return Panel({ layoutManager: Grid({ columns: 1, rows: 1 }), components: [region] });` to `return region;`, and narrow the layout import to `import { Border } from '@jimka/typescript-ui/layout';`.

19. In `packages/docs/src/demos/accordion-sections.ts`, change the final line from `return Panel({ layoutManager: Grid({ columns: 1, rows: 1 }), components: [accordion] });` to `return accordion;`, and narrow the layout import to `import { Accordion, AccordionConstraints } from '@jimka/typescript-ui/layout';`. Keep `fillHeight: true` on the `Accordion` — the stage's `Fit` still stretches the demo root, so the open section must still absorb the extra height.

20. Regression checkpoint: `grep -rn 'Grid' packages/docs/src/demos/border-regions.ts packages/docs/src/demos/accordion-sections.ts` — expect zero matches.

**Documentation.**

21. Add the changelog entries listed in `## Documentation Impact` to `packages/lib/docs/reference/changelog.md`.

22. Run the full `## Verification` list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/Panel.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/VirtualScroller.ts` |
| Modify | `packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/SplitGutter.ts` |
| Modify | `packages/lib/src/typescript/lib/component/container/CollapseButton.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Border.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Split.ts` |
| Modify | `packages/lib/src/typescript/lib/layout/Accordion.ts` |
| Create | `packages/lib/tests/component/layout/PrematureLayout.test.ts` |
| Create | `packages/lib/tests/core/Panel.styleRuleDisposal.test.ts` |
| Create | `packages/lib/tests/component/container/VirtualScroller.styleRuleDisposal.test.ts` |
| Create | `packages/lib/tests/component/layout/ManagerChrome.styleRuleDisposal.test.ts` |
| Modify | `packages/lib/tests/component/dispose-full-teardown.test.ts` (comment only) |
| Modify | `packages/lib/tests/component/shared/VirtualRowView.poolDisposal.test.ts` (comment only) |
| Modify | `packages/lib/docs/reference/changelog.md` |
| Modify | `packages/docs/src/demos/border-regions.ts` |
| Modify | `packages/docs/src/demos/accordion-sections.ts` |

---

## Expected Behaviour

### How the leak is observed offline

The offline harness can see rule creation and rule deletion. [`StyleTarget.ts`](packages/lib/src/typescript/lib/core/StyleTarget.ts#L209) keeps a module-level selector cache; `_ruleCacheKeys()` returns its keys and `disposeStyleRule` removes one. Every leak case below follows the shape already used by [`AbstractWindow.styleRuleDisposal.test.ts`](packages/lib/tests/overlay/AbstractWindow.styleRuleDisposal.test.ts):

1. Build, render and dispose one throwaway instance — a warm-up pass, so process-global rules a class materialises on first use stay out of the diff.
2. `const before = new Set(_ruleCacheKeys());`
3. Build a second instance, `getElement(true)`, `doLayout()`.
4. Tear it down by calling the protected `destructor()` through a local `destroy()` helper, as the owning window does.
5. `expect(_ruleCacheKeys().filter((k) => !before.has(k))).toEqual([]);`

**Assert on emptiness, never on a rule count.** The numbers quoted below are the measurements that proved each test red before the fix; they are not values to write into an assertion.

| Case | Setup | Contract | Measured on master |
|---|---|---|---|
| B1-1 | `new Panel({ autoScroll: 'both' })`, rendered, laid out, destroyed | no new rule-cache keys | 12 leaked |
| B1-3 | `new Tree()`, rendered, laid out, destroyed | no surviving key contains either `VirtualScroller` scrollbar's id | 2 leaked |
| B1-4 | `Panel` with `Split`, two panes, rendered, laid out, destroyed | no new rule-cache keys | 2 leaked |
| B1-5 | `Panel` with `Border`, one region carrying `collapsible: true`, rendered, laid out, destroyed | no new rule-cache keys | 2 leaked |
| B1-6 | `Panel` with `Accordion`, two sections, rendered, laid out, destroyed | no new rule-cache keys | 18 leaked |

Two further cases guard the paths where `dispose()` now runs on a component that is **not** being torn down:

- **B1-2 (unit).** On a rendered, laid-out `Panel` with `autoScroll: 'both'`, call `setScrollbarStyle('native')`, then `setScrollbarStyle('overlay')`. The two bars' original rule keys must be gone after the first call, and the panel must still be usable after the second — a fresh pair of `Scrollbar`s is built and its rules materialise.
- **B1-7 (unit).** On a rendered, laid-out `Panel` with an `Accordion` manager and two content children, call `setLayoutManager(Fit())`. The headers' and wrappers' rule keys must be gone, and **both content components must survive** — each still resolves through `getElement()` and each still owns its `#uuid` rule. The content is a registered child of the panel, not of the wrapper, and `detach()` reparents it back onto the container before disposing the wrapper.

- **B1-8 (manual, browser).** With the docs app running (`npm run docs:dev`), open a page carrying a live demo — `/layouts/Border` or `/components/Button` — and in DevTools:

  ```js
  const snap = () => [
      document.querySelectorAll('*').length,
      [...document.styleSheets].reduce((n, s) => n + s.cssRules.length, 0),
  ];
  ```

  Record `snap()`, navigate away and back ten times through the sidebar, record `snap()` again. Before the fix the rule count climbs by roughly 34-38 per cycle on a demo page against roughly 4 per cycle on a demo-less page (`/components/MenuButton` ↔ `/components/SpinButton`), while the element count stays flat. After the fix the demo page's per-cycle growth must drop to the demo-less baseline. The residual ~4 per cycle is a separate, still-open leak; it is not this plan's bar.

### Bug 2

- **B2-1 (unit).** `new Panel({ layoutManager: Fit(), autoScroll: 'both', components: [borderPanel] })`, where `borderPanel` is an unrendered `Panel` with a `Border` manager and a north plus a center child, must not throw. On master it throws `Error: Unable to determine component size.` during construction. This is the exact docs-app crash: `autoScroll` drives `LayoutManager.setOverflowing`, which synchronously lays the stage out while the demo root is still element-less.

- **B2-2 (unit).** The same construction with an `Accordion`-managed panel must record **no** `appendChild` write whose parent handle is falsy:

  ```typescript
  expect(sink.writes.filter((w) => w.op === 'appendChild' && !w.args[0])).toEqual([]);
  ```

  On master this reports 2 such writes. It must be asserted this way and **not** as `expect(...).not.toThrow()`: the offline `RecordingDOMSink` only records the call, so nothing throws offline even though the production sink throws `DOM handle undefined is not registered` on the same input.

- **B2-3 (unit).** A `Border`-managed panel and an `Accordion`-managed panel each laid out once while element-less, then `getElement(true)` and laid out again, must end up correctly laid out: `Border` places all its regions, and `Accordion` has built one header and one wrapper per child (read `_headers` / `_panelWrappers` through a narrow cast, as `PanelGutterSettle.test.ts` reaches private state). The guard defers work; it never skips it permanently.

- **B2-4 (unit).** Table-driven row per manager — `HBox`, `VBox`, `Grid`, `Split`, `Tab`, `Border`, `Accordion` — each attached to an element-less `Panel` holding one child: calling `doLayout()` must not throw and must record no `appendChild` with a falsy parent. On master only the `Border` row fails.

- **B2-5 (manual, browser).** With `npm run docs:dev`, `/layouts/Border` shows five labelled regions and its north, south and west gutters still collapse on double-click; `/layouts/Accordion` shows three sections that still animate open and closed one at a time. Both must look the same as before the wrapper `Panel` was removed. Open "Show source" on each and confirm the displayed source no longer contains the `Grid` wrapper.

---

## Verification

```bash
cd packages/lib
npm run typecheck            # tsc -p tsconfig.lib.json --noEmit
npm run typecheck:test
npx vitest run               # whole suite must be green, not just the four new files
npm run lint                 # one pre-existing error in component/table/cell/renderer/Link.ts; no new ones
npm run docs:api             # must finish with zero warnings after the two destroy() removals
```

```bash
# Regression greps
grep -n 'throw new Error' packages/lib/src/typescript/lib/layout/Border.ts        # expect zero
grep -rn 'gutter.destroy()' packages/lib/src/typescript/lib                       # expect zero
grep -rn 'Grid' packages/docs/src/demos/border-regions.ts \
                packages/docs/src/demos/accordion-sections.ts                     # expect zero
```

Then the manual checks: **B1-8** (rule-count flatness on a demo page) and **B2-5** (`/layouts/Border` and `/layouts/Accordion` render and still behave).

---

## Documentation Impact

Both removed methods are exported public API — `SplitGutter` and `CollapseButton` are re-exported from [`component/container/index.ts:25,35`](packages/lib/src/typescript/lib/component/container/index.ts#L25) — so `packages/lib/docs/reference/changelog.md` gains entries under the existing `## 0.3.0` section (`0.3.0` matches `packages/lib/package.json`'s `version`, so it is the in-development section):

- Under **`### Breaking changes`**: `SplitGutter.destroy()` and `CollapseButton.destroy()` are removed. Both only unhooked listeners and left the component's per-instance stylesheet rules on the sheet. Call the inherited `dispose()` instead, which does the listener cleanup *and* the full teardown.
- Under **`### Added`**: `VirtualScroller.dispose()`, disposing the scroller's two overlay `Scrollbar`s. `VirtualRowView` calls it on teardown, so an owner of a `Table`, `TreeTable` or `Tree` needs no change.
- Under **`### Fixed`**: overlay scrollbars, split/border/accordion gutters, and accordion section headers and wrappers no longer leak their stylesheet rules on teardown; `Border.doLayout()` and `Accordion.doLayout()` no longer fail when they run before the container has a DOM element.

No prose doc page names either `destroy()` — `grep -rn 'destroy()' packages/lib/docs` returns only `layouts/DockRegion.md`, which documents `DockRegion.destroy()`, an unrelated method this plan does not touch. `packages/lib/llms.txt` mentions neither method.

---

## Potential Challenges

- **A leak test that passes for the wrong reason.** The rule cache is module state that outlives `DOM.reset()`, so a test that forgets the warm-up pass or the `before` snapshot can go green on rules an earlier test left behind. Every case diffs against a `before` set taken after a warm-up instance, as `AbstractWindow.styleRuleDisposal.test.ts` does.
- **Writing a measured count into an assertion.** The per-case numbers in `## Expected Behaviour` are evidence the test was red, not a contract; a component gaining one state rule would break a literal. Assert the leaked array is empty.
- **`expect(...).not.toThrow()` passes vacuously offline.** `RecordingDOMSink.release()` never evicts the stub, so writes through released handles do not throw under the test harness. Case B2-2 asserts on `sink.writes` for exactly this reason.
- **Disposing an `Accordion` wrapper could take the consumer's content with it.** It cannot, because the content is a registered child of the panel and `detach()` reparents its element back onto the container first — but the order in step 14 is load-bearing, and case B1-7 pins it.
- **`Panel.removeOverlayScrollbars` runs on live panels, not just on teardown.** `setScrollbarStyle` and `setAutoScroll('none')` both reach it. Disposing is still right — the install path always constructs fresh `Scrollbar`s ([Panel.ts:1103-1112](packages/lib/src/typescript/lib/core/Panel.ts#L1103)) — and case B1-2 pins the round trip.
- **Concurrent edits to `layout/Accordion.ts`.** `feature/table-chained-column-resize` also changes that file, around its drag-chain code (line ~1859). This plan touches `detach()` (~1170) and `doLayout()` (~1500), so a textual conflict is unlikely but possible; the branch that merges second re-runs the full suite.

---

## Critical Files

- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts#L728) — `dispose()` at 728, `destructor()` at 745 (read the child-recursion and rule-disposal blocks), `removeElement()` at 1004, `getContentInsets()` at 2004, `getInnerSize()` at 2921, and the `flushPendingLayouts` loop at 202-215.
- [`packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts`](packages/lib/src/typescript/lib/component/shared/VirtualRowView.ts#L131) — the precedent this plan's teardown mirrors: a `destructor()` override disposing raw-appended children before `super.destructor()`.
- [`packages/lib/tests/overlay/AbstractWindow.styleRuleDisposal.test.ts`](packages/lib/tests/overlay/AbstractWindow.styleRuleDisposal.test.ts) — the leak-test shape every new leak test copies.
- [`packages/lib/tests/component/dispose-full-teardown.test.ts`](packages/lib/tests/component/dispose-full-teardown.test.ts) — the registry whose block comment this plan corrects; read it before editing.
- [`packages/lib/src/typescript/lib/layout/HBox.ts`](packages/lib/src/typescript/lib/layout/HBox.ts#L266) — the `doLayout` guard shape `Border` and `Accordion` are being brought into line with.
- [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) — `installTestDOM` and `RecordingDOMSink.writes`, which case B2-2 asserts on.
- `plans/implemented/component-teardown-seam.md` — establishes `dispose()` as the teardown verb and `protected destructor()` as the override hook, and records why a separate `destroy()` method was rejected.

---

## Non-Goals

- **Per-row and per-cell renderers.** `component/table/cell/Header.ts`, `component/tree/TreeRow.ts`, the `list/renderer/*` and `tree/renderer/*` families, `ComboBox`, `AbstractSelectableList`, `FieldSet`'s legend and `TabButton`'s close button all raw-append field-held children and leak the same way. They belong to the table-performance workstream, which already tracks them as the residual after the row-pool fix, and folding them in here would turn a two-bug fix into a library-wide audit.
- **Redesigning the overlay scrollbar.** No change to how the bars are built, positioned or synced.
- **Wide-table open performance and column virtualization.** Separate plans.
- **Making `Component.destructor()` reach raw-appended children automatically.** That would need an ownership registry parallel to `_components`; each owner disposing what it created is the pattern the codebase already uses.
- **The residual ~4 rules per navigation cycle on a demo-less docs page.** A separate leak with a different owner; B1-8's bar is that a demo page matches the demo-less baseline, not that the baseline is zero.

---

## Notes

[^branch-point]: `packages/docs/src/demos/border-regions.ts` and `packages/docs/src/demos/accordion-sections.ts` exist only on `feature/docs-component-demo-set`, which is unmerged and sits below `feature/table-chained-column-resize` in a two-branch stack off `master`. Branch this work from `feature/docs-component-demo-set` — not from the stack tip, whose table changes are unrelated and would be dragged along — so it becomes a sibling of `feature/table-chained-column-resize`. Merge order: `docs-component-demo-set`, then either sibling. Splitting the plan in two, so the library half could land on `master` alone, was considered and rejected: the demo half would be blocked on the library half anyway, so splitting buys one earlier merge at the cost of two plans, two branches and a cross-plan dependency to track.

[^premature-is-normal]: Three independent pieces of evidence. First, `Component.getInnerSize()` returns `null` in exactly one situation — the component has no element ([Component.ts:2921-2925](packages/lib/src/typescript/lib/core/Component.ts#L2921)) — so the five existing guards are all guards against that one state. Second, `flushPendingLayouts` calls `c.doLayout()` on every queued component with no element check ([Component.ts:202-215](packages/lib/src/typescript/lib/core/Component.ts#L202)), and `scheduleLayout()` queues unconditionally ([Component.ts:5300](packages/lib/src/typescript/lib/core/Component.ts#L5300)) — so any component configured before it is mounted gets exactly this pass. Third, `Component.onFirstLayout`'s own documentation states the case as normal: *"A component's content is built before its host attaches it (a dock tab's panel, an accordion section's body), so on the tick that builds it the element may not exist yet and its geometry is unknown."* Against that, `Border`'s throw is the outlier, not the five silent returns.

[^dead-insets]: `getContentInsets()` is declared `(): Insets` and both of its return statements construct an `Insets`. TypeScript already treats the `if (!containerInsets)` branch as unreachable, and no caller can make it fire. It is deleted rather than converted to a `return`, because leaving a second guard beside the one that now returns would suggest a null-insets state exists.

[^accordion-guard]: `applyContainerTheming()` calls `container.setBorder(...)` or `container.clearBorder()` ([Accordion.ts:658-670](packages/lib/src/typescript/lib/layout/Accordion.ts#L658)), and `getInnerSize()` subtracts `getPerimeterSize()`, which includes border widths. So a `getInnerSize()` read hoisted above that call can return a different width than the existing read below it does. Guarding on `container.getElement()` sidesteps the question entirely and is the exact precondition `createSection` needs, since `createSection` dereferences `container.getElement()!` at [Accordion.ts:1384-1385](packages/lib/src/typescript/lib/layout/Accordion.ts#L1384). The surviving `containerSize ? containerSize.width : 0` fallback below is left untouched rather than simplified — it is not this change's mess to clean up.

[^dispose-precedent]: `VirtualRowView.destructor()` was added by the row-pool leak fix for precisely this shape: rows built in `growRowPool`, appended with a raw `DOM.sink.appendChild`, held only in a private `_rowPool` array. Its fix is `for (const row of this._rowPool) { row.dispose(); }` followed by `super.destructor()`. `AbstractWindow` does the same for its eight resize-border strips, and `tests/overlay/AbstractWindow.styleRuleDisposal.test.ts` documents that leak's measured cost (+19 rules per open/close cycle). Both fixes were reviewed and shipped; this plan applies the identical shape to the five owners that still have it.

[^destroy-to-destructor]: `plans/implemented/component-teardown-seam.md` explicitly considered and rejected a separately-named public `destroy()` method, on the grounds that a consumer calling the documented `dispose()` would still leak while a second, differently-named method quietly did the real work. `SplitGutter.destroy()` and `CollapseButton.destroy()` are survivors of that shape — they predate the seam plan and were not in its scope. Converting them costs two removed public methods and gains the whole `Component` teardown for free. The alternative, keeping `destroy()` as a public wrapper that calls `this.dispose()`, was rejected for the same reason the seam plan gave: it leaves two teardown verbs on the same class. `DialogBackdrop.destroy()` also survives, but it already ends in `this.destructor()`, so it is not a leak and is not touched.

[^sweep-bound]: The sweep was a search for the shape rather than a check of the places already named. `grep -rn 'getElement(true)' packages/lib/src/typescript/lib | grep -E 'appendChild|insertBefore'` returns every site that appends a component's element raw; each owner was then read for whether it disposes that field. Owners that already do: `Tab` (via `Tab.detach()`), `TabBar`, `ScrollStrip`, `Popover`, `AbstractWindow`, `DialogBackdrop`. Owners that leak and are fixed here: `Panel`, `VirtualScroller`, `Border`, `Split`, `Accordion`. Owners that leak and are deferred: the per-row and per-cell renderer family in `## Non-Goals`. Not leaks at all: `Panel`'s `_shadowOverlay` and `_overlayScrollElement`, which are raw `Handle`s rather than components and are already untracked and released on teardown. `VideoPlayer`'s two residual rules were traced during this sweep and belong to none of these — its `Border` manager creates no gutters — which is why step 16 keeps its `ownIds` narrowing.
