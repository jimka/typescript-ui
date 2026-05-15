# Lazy Panel Construction at Demo Startup

## Context

[main.ts](src/typescript/main.ts) constructs all 16 demo panels eagerly at module load. Each `new XPanel()` builds a tree of components, registers theme listeners, and (for `ComplexUIPanel`) loads a table store. Only one panel is visible at a time under the [Tab](src/typescript/lib/layout/Tab.ts) layout, so the cost of building the other 15 is paid up-front for nothing visible.

The goal is to defer panel construction until first activation. First paint shows only the tab strip plus the initially-active panel; other panels are built lazily on first click and cached thereafter. The change is scoped to the demo and to a small additive surface on `Tab` — no library-user behavior shifts.

A relevant constraint exists today: [Tab.createTab:275](src/typescript/lib/layout/Tab.ts#L275) takes a `Component` instance, reads constraints from it, and wires the `tabpanel` ARIA role onto it. The instance is also added to the container via `body.addComponent(panel, { name })`. To go lazy, we need a path that registers the tab button and its name without yet having the component instance.

---

## Decision: Option B — additive `addLazyTab` API on Tab

Rationale: smallest blast radius. Existing `addComponent(component, constraints)` callers continue to work unchanged. No subclass needed (Option C duplicates state). Option A overloads `addComponent` semantics, which forces every layout manager to consider factory inputs — wrong scope.

`addLazyTab(factory, name, constraints?)` lives directly on the [Tab](src/typescript/lib/layout/Tab.ts) layout manager. Internally:

- The wrapper + `ToggleButton` (+ optional `TabCloseButton` from `constraints.closeable`) are created immediately and pushed onto the toolbar, registered with `buttonGroup` and `rovingTabIndex`.
- A `TabEntry` `{ wrapper, button, closeButton?, component: null, factory, constraints }` is stored on `this.tabs`.
- When the user activates the tab (or `getVisibleComponent()` resolves it for layout), if `entry.component === null`, the factory runs; the resulting component is added to the container via `container.addComponent(component, constraints)`. ARIA wiring (`role="tabpanel"`, `aria-labelledby`, `aria-controls`) happens at this moment, mirroring what [Tab.createTab:337-343](src/typescript/lib/layout/Tab.ts#L337-L343) does today.

The materialized `Component` is stored on the entry itself — **not** looked up by index in `container.getComponents()`. Since `Component.addComponent` always appends and lazy tabs can materialize out of order (e.g. user clicks tab 5 before tab 0), index alignment between `tabs[]` and `container.getComponents()[]` is not preserved. The visible-component path therefore reads `entry.component` directly.

---

## Phase 1 — Tab API surface for lazy entries

### [src/typescript/lib/layout/Tab.ts](src/typescript/lib/layout/Tab.ts)

- Extend `TabEntry` ([Tab.ts:32](src/typescript/lib/layout/Tab.ts#L32)) with `component: Component | null` and `factory: (() => Component) | null` and `constraints?: LayoutConstraints`. Eager tabs set `component` immediately and leave `factory: null`.
- Refactor `createTab` ([Tab.ts:275](src/typescript/lib/layout/Tab.ts#L275)) so the toolbar-button setup (wrapper / `ToggleButton` / `TabCloseButton` / `buttonGroup.addButton` / `rovingTabIndex.add` / `toolbar.addComponent`) is shared between the eager and lazy paths. The simplest split:
  - Private `buildTabEntry(name: string, constraints?: LayoutConstraints): TabEntry` — builds wrapper, button, close button if requested, wires `addActionListener`, registers with button group + roving tab index, appends to toolbar, sets `tabButton.getAria().setRole("tab")` and `setSelected`. Returns the entry with `component: null, factory: null` placeholders.
  - `createTab(component)` calls `buildTabEntry(nameFromConstraints, constraints)`, then fills in `entry.component = component; entry.factory = null;` and wires the component-side ARIA (`setControls`, `setRole("tabpanel")`, `setTabIndex(-1)`, `setLabelledBy`). This preserves today's eager behavior.
- Add `addLazyTab(factory: () => Component, name: string, constraints?: LayoutConstraints): void`:
  1. Call `buildTabEntry(name, constraints)` to get a fresh entry with button registered.
  2. Set `entry.factory = factory; entry.component = null; entry.constraints = constraints;`.
  3. Push onto `this.tabs`.
  4. Do NOT call `container.addComponent(...)` — that's the deferred work.
- Add a private `materialize(idx: number): Component | null`:
  1. Look up `entry = this.tabs[idx]`. If missing, return `null`.
  2. If `entry.component`, return it.
  3. Otherwise call `entry.factory!()`, then `container.addComponent(component, entry.constraints)`. Because `tabs.length` already equals or exceeds `components.length` after the lazy registration, the auto-`createTab` loop in `doLayout` will not iterate over this newly-added component (the loop is `for (i = tabs.length; i < componentCount; i++)`, which is a no-op once `tabs.length >= componentCount`).
  4. Wire ARIA: `entry.button.getAria().setControls(component.getId()); component.getAria().setRole("tabpanel"); component.getAria().setTabIndex(-1); component.getAria().setLabelledBy(entry.button.getId());`.
  5. Set `entry.component = component; entry.factory = null;` so the closure (and any modules it captured) can be GC'd.
  6. Return the component.
- Modify [onTabPressed:99-108](src/typescript/lib/layout/Tab.ts#L99-L108) so it just updates `selectedTabIndex` / roving index and schedules layout. Materialization happens lazily when `getVisibleComponent` is consulted during the next layout pass.
- Modify [getVisibleComponent:144-153](src/typescript/lib/layout/Tab.ts#L144-L153): when the selected entry has `component === null` and `factory !== null`, call `materialize(selectedTabIndex)`. Return `entry.component`. (Previously this returned `components[selectedTabIndex]`; now it reads off the entry.)
- The creation loop at [doLayout:366-369](src/typescript/lib/layout/Tab.ts#L366-L369) still serves the eager path: when `body.addComponent(c, {name})` is called without `addLazyTab`, `componentCount > tabs.length` and a new tab entry is built for it. Lazy entries register their tab up-front so this loop skips them.

### Helper on [src/typescript/lib/core/Body.ts](src/typescript/lib/core/Body.ts) — skip

The demo can cast: `(body.getLayoutManager() as Tab).addLazyTab(...)`. Adding a `Body`-side passthrough leaks layout-specific API into `Body`, which is wrong for a generic top-level container. Skip the helper.

---

## Phase 2 — main.ts migration

### [src/typescript/main.ts](src/typescript/main.ts)

Replace each block:

```
let xPanel = new XPanel();
body.addComponent(xPanel, { name: "X" });
```

with:

```
layoutManager.addLazyTab(() => new XPanel(), "X");
```

Keep the per-panel imports at the top of the file — the factory closure references the class, so the imports are required for compilation. Tree-shaking won't drop them. The win is deferring **construction**, not bundle size.

Strategy on the first tab: keep `MiscPanel` lazy too. `getVisibleComponent` materializes index 0 on the first `doLayout()`, so the user still sees `MiscPanel` content on first paint without a special eager case. Symmetric, simpler, same UX.

---

## Critical files to modify

- [src/typescript/lib/layout/Tab.ts](src/typescript/lib/layout/Tab.ts) — extend `TabEntry`, add `addLazyTab` + `materialize`, refactor `createTab` to share `buildTabEntry`, hook materialize into `getVisibleComponent`.
- [src/typescript/main.ts](src/typescript/main.ts) — switch all 16 `new XPanel()` blocks to `addLazyTab(() => new XPanel(), name)`.

---

## Risks

- **Theme listeners registered in panel constructors won't fire until materialized.** When a lazy panel does build, it reads the current theme — correct. No regression unless a test flips themes before clicking every tab and expects all of them to have observed every transition. The demo doesn't do that.
- **`scheduleLayout` / `addComponent` ordering.** `materialize` calls `container.addComponent`, which triggers `scheduleLayout`. Since materialize runs from inside `doLayout`/`getVisibleComponent`, we're inside a layout pass — the new schedule rolls into the next frame. Avoid infinite loops by setting `entry.component` before the recursive layout could re-enter materialize, and by guarding `materialize` on `entry.component !== null`.
- **ARIA wiring split across two phases.** Eager `createTab` wires `aria-controls` immediately; lazy path wires it on materialize. Both end states are identical. Confirm with axe DevTools on a never-clicked tab: button has correct role/name even without `aria-controls`, since the panel doesn't exist yet.
- **Index alignment.** `tabs[i]` no longer corresponds to `container.getComponents()[i]` once tabs materialize out of order. All read paths that previously assumed this alignment must read off the entry. The current Tab uses index alignment only in `getVisibleComponent` and in the `doLayout` creation loop; both are updated.
- **`Benchmark.benchAll()` at [main.ts:101](src/typescript/main.ts#L101)** is currently gated behind `if (false)`. If/when re-enabled, audit whether it iterates panels assuming all are built; either force-materialize or skip lazy entries.
- **Mixing eager and lazy entries within the same `Tab`.** If callers interleave `addLazyTab` and direct `body.addComponent(c, {name})` so that `tabs.length` overtakes `componentCount`, the `doLayout` auto-`createTab` loop becomes a no-op and the eager component won't get a tab button. The demo migrates to all-lazy, so this is not a regression for our consumer; document it as a known constraint of `addLazyTab`.

---

## Verification

1. `npx tsc --noEmit` — no new errors above the existing baseline.
2. `npx vite build` succeeds.
3. `npm run dev`: first paint shows the full tab strip and the `Misc.` panel content. Open DevTools → Performance, record reload: "Scripting" time during init drops noticeably (target: meaningful reduction in synchronous module-evaluation time).
4. Click each unvisited tab in order; verify the panel constructs and renders correctly. Click back to a visited tab; verify it's instant (cached) and that scroll position / form state is preserved (proving we didn't rebuild).
5. Keyboard nav: ArrowRight through the tab strip materializes panels one-by-one (driven by [onToolbarKeyDown:499](src/typescript/lib/layout/Tab.ts#L499), which calls `onTabPressed`).
6. Per [CLAUDE.md](CLAUDE.md): run `graphify update . --directed` after the implementation lands.
