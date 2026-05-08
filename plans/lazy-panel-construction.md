# Lazy Panel Construction at Demo Startup

## Context

[main.ts](src/typescript/main.ts) constructs all 16 demo panels eagerly at module load. Each `new XPanel()` builds a tree of components, registers theme listeners, and (for `ComplexUIPanel`) loads a table store. Only one panel is visible at a time under the [Tab](src/typescript/Base/layout/Tab.ts) layout, so the cost of building the other 15 is paid up-front for nothing visible.

The goal is to defer panel construction until first activation. First paint shows only the tab strip plus the initially-active panel; other panels are built lazily on first click and cached thereafter. The change is scoped to the demo and to a small additive surface on `Tab` — no library-user behavior shifts.

A relevant constraint exists today: [Tab.createTab:237](src/typescript/Base/layout/Tab.ts#L237) takes a `Component` instance, reads constraints from it, and wires the `tabpanel` ARIA role onto it. The instance is also added to the container via `body.addComponent(panel, { name })`. To go lazy, we need a path that registers the tab button and its name without yet having the component instance.

---

## Decision: Option B — additive `addLazyTab` API on Tab

Rationale: smallest blast radius. Existing `addComponent(component, constraints)` callers continue to work unchanged. No subclass needed (Option C duplicates state). Option A overloads `addComponent` semantics, which forces every layout manager to consider factory inputs — wrong scope.

`addLazyTab(factory, name)` lives on the [Body](src/typescript/Base/Body.ts) container (or directly on the `Tab` layout manager via a small forwarder). Internally:

- A button is created immediately with `name`, added to the toolbar, registered with `buttonGroup` and `rovingTabIndex`.
- A deferred entry `{ button, factory, built: false, component: null }` is stored in a parallel `lazyEntries` array indexed alongside `tabs`.
- When the user clicks the tab (or `selectTab` runs), if `entry.built === false`, the factory runs; the resulting component is added to the container via `container.addComponent(component, { name })` and marked built. ARIA wiring (`role="tabpanel"`, `aria-labelledby`) happens at this moment, mirroring what [Tab.createTab:299-305](src/typescript/Base/layout/Tab.ts#L299-L305) does today.

---

## Phase 1 — Tab API surface for lazy entries

### [src/typescript/Base/layout/Tab.ts](src/typescript/Base/layout/Tab.ts)

- Extend `TabEntry` ([Tab.ts:18](src/typescript/Base/layout/Tab.ts#L18)) with `factory: (() => Component) | null` and `built: boolean`. Eager tabs set `built: true, factory: null`.
- Add `addLazyTab(factory: () => Component, name: string, constraints?: object): void`:
  1. Build the toolbar wrapper + `ToggleButton` exactly as [createTab:237-297](src/typescript/Base/layout/Tab.ts#L237-L297) does today, but skip the ARIA `setControls`/component-side wiring (no component yet).
  2. Push `{ wrapper, button, closeButton, factory, built: false }` onto `tabs`.
  3. Do NOT call `container.addComponent(...)` for the panel — that's the deferred work.
- Refactor the toolbar-button setup out of `createTab` into a private `buildTabButton(name, constraints)` so both the eager path (existing `createTab`) and the lazy path reuse it.
- Add a private `materialize(idx: number): Component`:
  1. Look up `entry = this.tabs[idx]`.
  2. If `entry.built`, return the existing component at `container.getComponents()[idx]`.
  3. Otherwise call `entry.factory!()`, then `container.addComponent(component, { name })` at position `idx`. The container's existing `addComponent` triggers `doLayout()`, which calls `createTab` for new components — guard against re-creating the toolbar entry by checking `idx < tabs.length` already (see [doLayout:328](src/typescript/Base/layout/Tab.ts#L328)).
  4. Wire ARIA: `tabButton.getAria().setControls(component.getId()); component.getAria().setRole("tabpanel"); component.getAria().setLabelledBy(tabButton.getId());`.
  5. Mark `entry.built = true; entry.factory = null;` so the closure (and any modules it captured) can be GC'd.
- Modify [onTabPressed:65-74](src/typescript/Base/layout/Tab.ts#L65-L74) to call `materialize(idx)` before `scheduleLayout()`.
- Modify [doLayout:316](src/typescript/Base/layout/Tab.ts#L316): the existing creation-loop assumption (`for (let i = this.tabs.length; i < componentCount; i++)`) is fine — it now never runs because lazy panels register their button up-front and eager panels still go through the today-path.
- Critical: [getVisibleComponent:106-115](src/typescript/Base/layout/Tab.ts#L106-L115) reads `container.getComponents()[selectedTabIndex]`. When the visible tab is unbuilt this returns `undefined`. Make `getVisibleComponent` call `materialize(selectedTabIndex)` first so the rest of the layout pass sees a real component.
- Initial-selection edge case: if `selectedTabIndex === 0` and the first tab is lazy, the very first `doLayout()` triggered by `Body` mount must materialize it. Since `getVisibleComponent` is called by `doLayout` ([Tab.ts:343](src/typescript/Base/layout/Tab.ts#L343)) and by the size queries ([Tab.ts:133](src/typescript/Base/layout/Tab.ts#L133)), placing the materialize call there covers both.

### Helper on [src/typescript/Base/Body.ts](src/typescript/Base/Body.ts) (optional)

If the demo prefers `body.addLazyTab(...)` to `(body.getLayoutManager() as Tab).addLazyTab(...)`, add a thin pass-through. Otherwise the demo just casts. Pick whichever is one line.

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

Drop the per-panel imports for the body of the file — but keep them at the top because the factory closure references the class. (Tree-shaking won't help: the imports are needed for the factory to compile. The win is deferring construction, not bundle size.)

Strategy on the first tab: keep `MiscPanel` lazy too. `getVisibleComponent` materializes index 0 on the first `doLayout()`, so the user still sees `MiscPanel` content on first paint without a special eager case. Symmetric, simpler, same UX.

---

## Critical files to modify

- [src/typescript/Base/layout/Tab.ts](src/typescript/Base/layout/Tab.ts) — extend `TabEntry`, add `addLazyTab` + `materialize`, refactor `createTab` to share `buildTabButton`, hook materialize into `getVisibleComponent` and `onTabPressed`.
- [src/typescript/main.ts](src/typescript/main.ts) — switch all 16 `new XPanel()` blocks to `addLazyTab(() => new XPanel(), name)`.

---

## Risks

- **Theme listeners registered in panel constructors won't fire until materialized.** When a lazy panel does build, it reads the current theme — correct. No regression unless a test flips themes before clicking every tab and expects all of them to have observed every transition. The demo doesn't do that.
- **`scheduleLayout` / `addComponent` ordering.** `materialize` calls `container.addComponent`, which triggers `scheduleLayout`. Since materialize runs from inside `doLayout`/`getVisibleComponent`, we're inside a layout pass — the new schedule rolls into the next frame. Verify no infinite loop by confirming `entry.built` is set before the recursive layout could re-enter materialize.
- **ARIA wiring split across two phases.** Eager `createTab` wires `aria-controls` immediately; lazy path wires it on materialize. Both end states are identical. Confirm with axe DevTools on a never-clicked tab: button has correct role/name even without `aria-controls`, since the panel doesn't exist yet.
- **`Benchmark.benchAll()` at [main.ts:98](src/typescript/main.ts#L98)** may iterate panels assuming all are built. Audit Benchmark; if it touches panel state, decide per-bench whether to force-materialize or skip.

---

## Verification

1. `npx tsc --noEmit` — no new errors above the existing 9-error baseline.
2. `npx vite build` succeeds.
3. `npm run dev`: first paint shows the full tab strip and the `Misc.` panel content. Open DevTools → Performance, record reload: "Scripting" time during init drops noticeably (target: 50%+ reduction in synchronous module-evaluation time).
4. Click each unvisited tab in order; verify the panel constructs and renders correctly. Click back to a visited tab; verify it's instant (cached) and that scroll position / form state is preserved (proving we didn't rebuild).
5. Keyboard nav: ArrowRight through the tab strip materializes panels one-by-one (driven by [onToolbarKeyDown:444](src/typescript/Base/layout/Tab.ts#L444), which calls `onTabPressed`).
6. Extend [perf/Benchmark.ts](src/typescript/perf/Benchmark.ts) with `benchStartup()` if not present: measure `performance.now()` from script start to `Body.doLayout()` return on first frame. Report before/after delta.
7. Per [CLAUDE.md](CLAUDE.md): run `graphify update .` after the implementation lands.
