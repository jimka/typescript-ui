---
touches-shared:
  - src/typescript/lib/core/Window.ts
  - src/typescript/lib/layout/Tab.ts
  - src/typescript/lib/component/container/TabBar.ts
  - src/typescript/lib/layout/LayoutSerialization.ts
---

# Strip-Mode Tear-off Window — AbstractWindow / TabWindow Split — Implementation Plan

## Overview

A strip-mode tear-off window today is a full [`Window`](../src/typescript/lib/core/Window.ts#L138) (a `Border` with a [`WindowHeader`](../src/typescript/lib/component/container/WindowHeader.ts) in NORTH + content in CENTER) whose CENTER holds an *inner* one-tab [`Tab`](../src/typescript/lib/layout/Tab.ts#L255) strip wrapped in a `Panel` — so it shows **two stacked bars**: the window header and, below it, the inner strip's [`TabBar`](../src/typescript/lib/component/container/TabBar.ts). [`fillWindowWithStrip`](../src/typescript/lib/layout/Tab.ts#L1583) builds that nesting.

The chosen design removes the redundancy by making a strip-mode tear-off a window **whose interior IS a `Tab` layout, with no header and no `Border`**. This is realized by splitting `Window` into an abstract base and two concrete subclasses:

- **`AbstractWindow extends Panel<WindowOptions>`** — all header-agnostic window machinery (resize-border overlays, move, state transitions, closeable/min/max state, active-focus state, z-order, show/hide, the title *concept* for serialization, the min-size seed *mechanism*). Defines `protected`/`abstract` hooks for everything that differs per subclass.
- **`Window extends AbstractWindow`** — the existing header world, **behaviour byte-for-byte identical to today**: `Border` layout, a non-nullable `_header: WindowHeader` in NORTH, content in CENTER, and every `_header`-specific method. Implements the base hooks via its header.
- **`TabWindow extends AbstractWindow`** — a `Tab` as its own layout manager (the normal bar + content job), **no header**. Adds the window min/max/close controls as `Tab`/`TabBar` tools, an empty-bar-area move trigger via a new `TabBar.installMoveTrigger` seam, and implements the base hooks via the tab bar. The `Tab` class is **unchanged** — no headless mode, no external-bar injection.

Phase 1 is a pure refactor (extract `AbstractWindow`; `Window` unchanged). Phase 2 adds `TabWindow` + the `TabBar.installMoveTrigger` seam. Phase 3 rewires `fillWindowWithStrip` / `detachTabToWindow` to build a `TabWindow`, collapsing away the inner-Tab-in-a-Panel nesting. New files live in `src/typescript/lib/core/`; edits touch [`Window.ts`](../src/typescript/lib/core/Window.ts), [`Tab.ts`](../src/typescript/lib/layout/Tab.ts), [`TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts), [`LayoutSerialization.ts`](../src/typescript/lib/layout/LayoutSerialization.ts), the `core` barrel, and docs.

### Blast radius (verified against live code)
- **Nothing `extends Window`** — no existing subclasses (grep: only `class Window extends Panel`).
- **Exactly two `instanceof Window` sites**, both in `Tab.ts` `hostWindow()`: [Tab.ts:1618](../src/typescript/lib/layout/Tab.ts#L1618) and [Tab.ts:1622](../src/typescript/lib/layout/Tab.ts#L1622). Both **must become `instanceof AbstractWindow`** so a torn-off `TabWindow` is discoverable for close-when-empty. The walk's **start point** also changes (see `### `hostWindow()` must walk inclusive of its container (B1)`) — `instanceof` retarget alone is not enough.
- **14 `new Window(...)` call sites** in app/demo code (`MiscPanel.ts` ×12, `LayoutSerialization.ts:455`, plus the doc-comment example at `Window.ts:490`); the only library `new Window(...)` is [Tab.ts:1551](../src/typescript/lib/layout/Tab.ts#L1551). The `MiscPanel`/serialization sites **stay `new Window(...)`** (concrete header window) — unaffected. Phase 3 changes only the `Tab.ts` site.
- **`: Window` type references** — `Window.getOpenWindows(): Window[]` ([Window.ts:683](../src/typescript/lib/core/Window.ts#L683)); `windowContentOf(win: Window)` ([LayoutSerialization.ts:218](../src/typescript/lib/layout/LayoutSerialization.ts#L218)); `parkLeaves(..., liveWindows: Window[], ...)` ([LayoutSerialization.ts:303](../src/typescript/lib/layout/LayoutSerialization.ts#L303)); `fillWindowWithStrip(win: Window, ...)` ([Tab.ts:1583](../src/typescript/lib/layout/Tab.ts#L1583)); `hostWindow(): Window | null` ([Tab.ts:1611](../src/typescript/lib/layout/Tab.ts#L1611)). There is **no `WindowManager`** in this codebase (verified). See `### `: Window` type-reference disposition`.

---

## Architecture Decisions

### Why the `AbstractWindow` split beats the prior `WindowChrome` / headless-`Tab` design

The superseded plan kept one `Window` class, decoupled it from its header via a `WindowChrome` interface so a `TabWindowHeader extends TabBar` could be dropped into NORTH, ran the `Tab` in a *headless / external-bar* mode, and gated the default-header build behind an internal `WindowOptions.tabHeader` flag. That carried real cost: a nullable/widened header type with ~15 `instanceof WindowHeader` guards scattered through `Window`, a brand-new second `Tab` code path (skip-bar-create, external-bar binding, zero-thickness layout) that doubled the surface of the most intricate layout manager, and a `setHeaderCollapsed`/construction-seam dance.

The split is simpler and safer:

- **No nullable / widened header.** `Window` keeps `private _header: WindowHeader` non-null and every `_header.*` call exactly as today. No `WindowChrome` interface, no `instanceof` guards in `Window`.
- **Header concerns isolated.** Everything header-specific lives only in `Window`; `TabWindow` never sees it.
- **The `Tab` is untouched.** `TabWindow` uses a normal `Tab` as its layout manager doing its normal bar+content job. No headless mode, no second layout path, no external-bar injection.
- **Two concrete subclasses justify the base.** `Window` and `TabWindow` share a large body of header-agnostic machinery (resize borders, move, state, z-order, show/hide) — exactly the shape an abstract base is for. The base is not speculative: it has two real consumers on day one.
- **Small blast radius.** Two `instanceof` retargets, a handful of `: Window` → `AbstractWindow` type widenings, one library `new Window` → `new TabWindow`. The 14 app `new Window` sites and `Window`'s public surface are untouched.

The prior design's `WindowChrome` interface, `TabWindowHeader extends TabBar` component, headless/external-bar `Tab` mode, `WindowOptions.tabHeader` construction seam, and `setHeaderCollapsed` detach are **all removed** — none are carried forward.

### `AbstractWindow` owns the header-agnostic machinery; hooks cover what differs

`AbstractWindow extends Panel<WindowOptions>` holds everything that does not name a header:

- **Resize borders** — the `_borderComponents` field + its 8-handle build, the `onResize`/`flushResize`/`onResizeEnd` drag flow, the `render()` element append ([Window.ts:1580](../src/typescript/lib/core/Window.ts#L1580)), and the `doLayout()` border positioning ([Window.ts:1497](../src/typescript/lib/core/Window.ts#L1497)). All generic.
- **Move** — `onMouseDown` ([Window.ts:1097](../src/typescript/lib/core/Window.ts#L1097)) split into a new `startMoveFrom(e)` (the body) + the `onMouseDown` shell; `onDrag`/`onMouseUp`/`clampDragDelta`/`viewportPositionBounds`/`clampPositionToViewport`; `bringToFront`/`onZIndexChanged`/`getBand`/`isLayerRoot`/`getLayerElement`/`getDismissMode`. The `_headerDragShift` capture stays with `Window` (it is header-targeted re-dock; see below).
- **State** — `setWindowState`/`getWindowState`/`toggleMinimize`/`toggleMaximize`/`isMaximized`/`isMinimized`/`setMaximizeBounds`/`getMaximizeBounds`, `computeMaximizeRect`/`computeDockRect`/`animateRect`/`currentRect`/`getRect`/`applyRect`/`getRestoreRect`, the minimized-stack statics, the viewport-resize listeners, the snap-resize listeners.
- **Closeable / min / max STATE + `requestClose`/`isCloseable`/`isMinimizable`/`isMaximizable`** — the `_options`-backed predicates and `requestClose`/`onExitAction` teardown. `setCloseable`/`setMinimizable`/`setMaximizable` are **non-virtual on the base**: they store the `_options` state and call the matching `protected reflect*` hook (see `### Closeable / min / max reflection — base stores state, subclass reflects via a hook (B1)`).
- **Active-focus state** — `onActivate(active)` calls the hook (paint), state generic.
- **Title READ CONCEPT** — `getTitle(): string` overridable read hook used by serialization (Window: header text; TabWindow: active-tab label). There is **no** generic title *writer* on the base — a `TabWindow` title is derived, not set (see `### Title is a read-only derived hook; no `setTitle` on the base (B2)`).
- **Show/hide/visibility/`setContain`, window-element + overlay creation, z-order, `_bodyHost`/`findBodyHost`/`setBodyHostDisplayed`, the content-factory machinery, the min-size seed MECHANISM** (`setWidth`/`setHeight` min-clamp).

**Hooks (what differs per subclass)** — `AbstractWindow` declares these `abstract` or `protected` and the constructor / state code calls them:

- `protected abstract wireMoveTrigger(): void` — install the move gesture (Window: header `mousedown` → `startMoveFrom`; TabWindow: `TabBar.installMoveTrigger`).
- `protected abstract reflectCloseable(v): void` / `reflectMinimizable(v): void` / `reflectMaximizable(v): void` — push the state into the subclass UI (Window: header buttons — its *existing* `_header.setCloseable`/`setMinimizable`/`setMaximizable` calls; TabWindow: control tools). Called by the base's non-virtual `setCloseable`/`setMinimizable`/`setMaximizable` after the `_options` write, so there is exactly one state writer and one reflection path per subclass (B1).
- `protected abstract getTitle(): string` — title READ (Window: `_header.getText().getText()`; TabWindow: active-tab label via `Tab.getActiveTabLabel()`). Read-only — there is no `setTitle` hook (B2).
- `protected abstract paintActive(active): void` — active-state paint (Window: header gradient; TabWindow: no-op).
- `protected abstract minContentWidthSeed(): number` — the min-content-width value seeded into `setMinSize` (Window: `_header.getMinContentWidth()`; TabWindow: tab-bar min width).
- `protected chromeHeight(): number` — the height of the window's title chrome, used by the generic viewport-clamp / dock-rect / minimized-stack geometry that today reads `this._header.getHeight() || 26` directly. **Defaulted, not abstract**, so any future header-agnostic geometry has a safe value: the base implementation returns `0`, and the `|| 26` floor (preserving today's "before the chrome has laid out" fallback) is applied at the **call sites** via `this.chromeHeight() || 26`, exactly as the current `this._header.getHeight() || 26` reads. `Window` overrides it to return `this._header.getHeight()`; `TabWindow` overrides it to return its tab-bar height (`this._tab` bar height). Rationale for default-over-abstract: only the three geometry sites + `findBodyHost` need it, the `|| 26` floor lives at the call site (not inside the hook), and a `0` default keeps the floor semantics identical for both subclasses while leaving the base instantiable-shaped without a forced override. Routes the B2 derefs (see `### Chrome-height hook removes the stranded `_header` geometry derefs (B2)`).
- `protected abstract addContent(content: Component): void` — how content is added (Window: CENTER region; TabWindow: make content a child of the window **and** `createTab` it — see `### `addContent` makes content a layout/serialization child (A1)`).
- `protected abstract reflectMaximizeState(state): void` — restore/maximize glyph swap (Window: `_header.setMaximizeButtonGlyph(...)`; TabWindow: no-op). This isolates the three `setMaximizeButtonGlyph` calls in `setWindowState` ([Window.ts:763](../src/typescript/lib/core/Window.ts#L763)/[L775](../src/typescript/lib/core/Window.ts#L775)/[L789](../src/typescript/lib/core/Window.ts#L789)).

(There is **no** `isTrailingControlTarget` hook and **no** `setTitle` hook — see `### Double-click-maximize is OMITTED for `TabWindow` (C)` and `### Title is a read-only derived hook; no `setTitle` on the base (B2)`. The header dblclick path stays entirely on `Window`.)

The constructor of `AbstractWindow` does only the chrome-agnostic, dereference-free setup: builds the borders, sets `setVisible(false)` + `setContain("layout")`, and registers the `bringToFront` subtree listener. The **late state dispatch** (`setCloseable`/`setMinimizable`/`setMaximizable`/`setMaximizeBounds`/`windowState` through the reflect-hooks), the `wireMoveTrigger()` call, and the `setMinSize(this.minContentWidthSeed(), 200)` min-seed (unless `options.minSize` given) all run in **`initChrome()`**, which the subclass constructor calls *after* it has built its chrome — never in the base constructor (those steps deref subclass chrome that does not exist during `super()`; see the late-dispatch ordering caveat below). Layout-manager choice (`Border` vs `Tab`), the header build, and content placement are **not** in the base — each subclass sets its own layout manager and chrome before calling `initChrome()`.

> **Late-dispatch ordering caveat.** Today `Window`'s constructor builds `_header` *before* dispatching `setCloseable`/`windowState`/the min-seed, because those read `_header`. In the base-class form the reflect-hooks and `minContentWidthSeed` are abstract and run against subclass state that must exist first. **Resolution:** the base exposes a `protected initChrome()` the subclass constructor calls **after** it has built its chrome (Window: after `_header` is created/wired; TabWindow: after the `Tab` + control tools exist), and `initChrome()` runs the late state dispatch + `wireMoveTrigger()` + min-seed. The subclass constructor order is: `super(...)` → build chrome → `this.initChrome()`. This keeps the "fields written by setters during construction" trap (MEMORY: class-field super-cascade) from biting — the reflect-hooks only fire once the subclass chrome is in place.
>
> **Generic vs header-specific late dispatch (D).** Today `Window`'s constructor runs two late-dispatch groups after building `_header` ([Window.ts:273-288](../src/typescript/lib/core/Window.ts#L273)): the **generic** `contentFactory` dispatch (`setContentFactory(...)`, no header deref) and the **header-specific** `glyph` dispatch (`_header.setGlyph(...)`). Split them: the **`contentFactory` (+ `onReady`) dispatch moves into the base `initChrome()`** alongside the state flags — it is chrome-agnostic and both subclasses want it. The **`glyph` dispatch stays in `Window`** (it derefs `_header`; a `TabWindow` has no glyph slot) — `Window`'s constructor runs it after `super()`/`_header` build, before or alongside its own `initChrome()` call. So `initChrome()` (base): closeable/min/max/maximizeBounds/windowState via reflect-hooks + contentFactory + wireMoveTrigger + min-seed; `Window` ctor only: the `glyph` line.

### `hostWindow()` must walk inclusive of its container (B1)

`Tab.hostWindow()` ([Tab.ts:1611](../src/typescript/lib/layout/Tab.ts#L1611)) today starts the ancestor walk at `this.getContainer()?.getParentComponent()` ([Tab.ts:1616](../src/typescript/lib/layout/Tab.ts#L1616)) and ascends until it finds an `instanceof Window`. `LayoutManager.getContainer()` ([LayoutManager.ts:84](../src/typescript/lib/layout/LayoutManager.ts#L84)) returns the component the manager is attached to. In the **new topology** a `TabWindow`'s layout manager *is* this `Tab`, so `getContainer()` returns the `TabWindow` **itself** — and `.getParentComponent()` skips straight past it. Windows have no `_parent` (they mount via `document.documentElement.appendChild`, not as a child component), so the walk lands on `null`: `closeHostWindowIfEmpty` ([Tab.ts:1629](../src/typescript/lib/layout/Tab.ts#L1629)) becomes a **permanent no-op** for a torn-off `TabWindow`, and the float never auto-closes when emptied.

**Decision:** make the walk **inclusive of `getContainer()`** — check the container itself for `instanceof AbstractWindow` before ascending:

```typescript
private hostWindow(): AbstractWindow | null {
    if (!this._closeHostWindowWhenEmpty) {
        return null;
    }

    let node: Component | null = this.getContainer();          // START at the container, not its parent

    while (node && !(node instanceof AbstractWindow)) {
        node = node.getParentComponent();
    }

    return node instanceof AbstractWindow ? node : null;
}
```

This resolves **both** topologies: the new one (the container *is* the `TabWindow`) and the legacy nested one (a `Tab`-in-a-`Panel` whose `Window` ancestor sits above the container — though Phase 3 removes that nesting). For any remaining non-tear-off `Tab` usage the walk is gated by `_closeHostWindowWhenEmpty` (only the auto-created strip sets it), so an ordinary `Tab` inside a normal `Window` still resolves its host correctly when that flag is set, and returns `null` otherwise exactly as today. The `instanceof Window` → `instanceof AbstractWindow` retarget is the Phase-1 type widening; the **start-point change pairs with it** but only becomes load-bearing once Phase 3 makes the `TabWindow` the container — so the start-point edit is folded into the same Phase-1 `hostWindow` step, with the close-when-empty behaviour for a torn-off `TabWindow` verified in Phase 3 (Verification adds an explicit check).

### Chrome-height hook removes the stranded `_header` geometry derefs (B2)

Re-enumerating every `this._header` / `win._header` read in geometry/state methods slated for the base (grep verified against live `Window.ts`):

| Site | Line | Read | Method's home in the split |
|---|---|---|---|
| `viewportPositionBounds()` | [1417](../src/typescript/lib/core/Window.ts#L1417) | `this._header.getHeight() \|\| 26` | base (generic move/clamp) |
| `computeDockRect()` | [1648](../src/typescript/lib/core/Window.ts#L1648) | `this._header.getHeight() \|\| 26` | base (generic minimized-dock geometry) |
| `relayoutMinimizedStack()` (static) | [1688](../src/typescript/lib/core/Window.ts#L1688) | `win._header.getHeight() \|\| 26` | base static; iterates `openWindows` which widens to `Set<AbstractWindow>` → would deref a missing `_header` on a `TabWindow` |
| `findBodyHost()` | [1611](../src/typescript/lib/core/Window.ts#L1611) | `child !== this._header` (chrome identity, not height) | base (generic body-host discovery) |

The three height sites are the B2 stranding: each method is header-agnostic geometry that moves to the base, but each derefs `this._header.getHeight()`. The static one is the sharpest — it iterates the `openWindows` set (widened to `Set<AbstractWindow>`) and would deref `win._header` on a `TabWindow` that has none.

**Decision:** route the three height reads through the new `protected chromeHeight(): number` hook (defaulted to `0`; see the hook list). Each call site keeps its own `|| 26` floor, so the semantics are byte-for-byte: `this._header.getHeight() || 26` → `this.chromeHeight() || 26`, and `win._header.getHeight() || 26` → `win.chromeHeight() || 26`. `Window.chromeHeight()` returns `this._header.getHeight()` (identical value); `TabWindow.chromeHeight()` returns its tab-bar height. The `findBodyHost` identity-compare is a **different** concern (it asks "which child is chrome?", not "how tall is chrome?") and is handled by the `isChromeComponent` predicate (see A2) — it is **not** routed through `chromeHeight`. No other `_header` deref is stranded in a base-bound method: every remaining `this._header` read ([241-294](../src/typescript/lib/core/Window.ts#L241), [350](../src/typescript/lib/core/Window.ts#L350), [555](../src/typescript/lib/core/Window.ts#L555), [657-661](../src/typescript/lib/core/Window.ts#L657), [763-789](../src/typescript/lib/core/Window.ts#L763), [877-879](../src/typescript/lib/core/Window.ts#L877), [901-947](../src/typescript/lib/core/Window.ts#L901), [1139-1196](../src/typescript/lib/core/Window.ts#L1139)) sits in a method that **stays on `Window`** (constructor, `setActive`/`onActivate` paint, `setHeaderText`, the `setMaximizeButtonGlyph` calls now behind `reflectMaximizeState`, the button-element getters, the reflect-hook bodies, and the Shift re-dock source) — none of those are base-bound.

### No new `Tab` events — reuse the existing `syncHostWindowCloseable` push; read the title live (B1/B3 — event widening DELETED)

A prior cycle proposed widening `Tab`'s `TabEvent` union (`"tabselect"` / `"tabsetchanged"`) so `TabWindow` could *observe* selection and set changes and re-implement the title + closeable reflection on itself. That re-implementation was **unimplementable as written** (audit B1/B2): the widened payloads carried only an id, the active-tab *label* is not on `Tab`'s public surface (the label can diverge from `component.getName()` via the `constraints.name` override at [Tab.ts:1073](../src/typescript/lib/layout/Tab.ts#L1073)), and there was no per-tab closeable enumeration except through the **private** `Tab._bar`.

**Decision: DELETE the event widening entirely.** Two facts make the new events unnecessary:

1. **Closeable is already pushed, not observed.** `Tab.syncHostWindowCloseable()` ([Tab.ts:1643](../src/typescript/lib/layout/Tab.ts#L1643)) already computes every-tab-closeable from its own `_bar` (`getEntryIds().every(id => _bar.isEntryCloseable(id))`, [Tab.ts:1650](../src/typescript/lib/layout/Tab.ts#L1650)) and calls `hostWindow().setCloseable(...)`, from exactly the set-mutation sites that matter. With B1's inclusive `hostWindow()` walk, `hostWindow()` now returns the owning `TabWindow`. So the closeable contract is delivered by the **existing push** — `TabWindow` needs no subscription. **`syncHostWindowCloseable`'s `win.setCloseable` write is RETAINED**, not removed; only its `hostWindow()`/type is generalized to `AbstractWindow`. This is the single `setCloseable` writer for a `TabWindow` (`Tab` is the source of truth for which tabs are closeable).

2. **Title is read live, never cached.** Both title consumers read on demand: serialization reads `win.getTitle()` at write time (see `### Title is a read-only derived hook`), and there is **no taskbar / minimized-dock title cache** that would go stale — a minimized `Window` keeps painting its own real `WindowHeader` (the static `relayoutMinimizedStack` at [Window.ts:1681](../src/typescript/lib/core/Window.ts#L1681) only re-positions geometry, reading `_header.getHeight()`, never a title), and a minimized `TabWindow` likewise keeps its tab bar. **Verified:** the only `_header.getText().getText()` reads are `buildHeaderDragData` ([Window.ts:1156](../src/typescript/lib/core/Window.ts#L1156), a header-only re-dock payload that stays on `Window`) and serialization ([LayoutSerialization.ts:239](../src/typescript/lib/layout/LayoutSerialization.ts#L239), retargeted to `getTitle()`). Nothing subscribes to "the title changed", so `TabWindow` needs no `"tabselect"` notification — `getTitle()` simply re-reads the active label whenever someone asks.

**Result:** `Tab`'s public event union stays `TabEvent = "tabclose" | "empty"` — unchanged. No `"tabselect"`/`"tabsetchanged"`, no new `on`/`off`/`emit` overloads, no `TabWindow` event subscription, no new reflection code on `TabWindow` beyond the hook bodies. This is a real simplification over the prior cycle: the reflection-into-UI is split into the per-subclass `reflect*` hooks (driven by the existing `setCloseable` push), and the title is a per-subclass `getTitle()` read. `Tab.hostWindow()`/`closeHostWindowIfEmpty`/`syncHostWindowCloseable` all stay on `Tab` (it owns `_closeHostWindowWhenEmpty`, observes its own emptying, and is the closeable source of truth); they are retyped to `AbstractWindow` but otherwise unchanged.

### `addContent` makes content a layout/serialization child (A1)

`Tab.createTab` ([Tab.ts:1071](../src/typescript/lib/layout/Tab.ts#L1071)) does **not** add the content as a child of the container — it only pushes to `_contents` and calls `_bar.createBarEntry`. The existing strip path compensates by doing `strip.moveComponent(content)` **then** `innerTab.createTab(content)` ([Tab.ts:1597-1598](../src/typescript/lib/layout/Tab.ts#L1597)) — content must be a child of the container for layout participation and for serialization's content discovery (`windowContentOf` walks `win.getComponents()`, [LayoutSerialization.ts:219](../src/typescript/lib/layout/LayoutSerialization.ts#L219)).

**Decision:** `TabWindow.addContent(content)` (and its public `createTab(content)`) must do **both**: make `content` a child of the `TabWindow` *and* add the tab entry — `this.moveComponent(content); this._tab.createTab(content);` (the moveComponent-then-createTab order the strip path already uses). Without the `moveComponent`, the content would lay out nowhere and `windowContentOf` would return `null`, dropping the window from serialization.

### `isChromeComponent` content-discovery predicate (A2)

`windowContentOf` finds a window's content as the first child that is not the header: `win.getComponents().find(child => child !== win.getHeader())` ([LayoutSerialization.ts:219](../src/typescript/lib/layout/LayoutSerialization.ts#L219)). A headerless `TabWindow` has no `getHeader()`, and `findBodyHost` ([Window.ts:1606](../src/typescript/lib/core/Window.ts#L1606)) does the identical "first non-header child" walk for the body-hide-on-minimize path.

**Decision:** add a base predicate **`protected isChromeComponent(child: Component): boolean`** — `Window` returns `child === this._header`; `TabWindow` returns `false` (the tab bar belongs to the `Tab` *layout manager*, not to a child component, so every child of a `TabWindow` is content). Both `findBodyHost` (base) and `windowContentOf` (serialization) use it: `child => !win.isChromeComponent(child)`. For a **multi-tab** `TabWindow`, capturing the first content child suffices for serialization given the Non-Goal of restoring `TabWindow`s as `TabWindow`s (restore rebuilds a header `Window`); if a definite-active capture is wanted instead, `win` exposes the active content via the `Tab`'s `getActiveTabIndex()` ([Tab.ts:1437](../src/typescript/lib/layout/Tab.ts#L1437)) — but the first-content-child capture is the minimal, in-scope choice and matches `findBodyHost`'s existing behaviour. `windowContentOf`/`windowNodeFor` retype to `AbstractWindow` and read `win.getTitle()` for the header field.

### `installMoveTrigger` uses an inline closure handler — deliberate named-listener deviation (A3)

`CODE_CONVENTIONS` favours named listener handlers over inline closures. `TabBar.installMoveTrigger`'s `mousedown` handler is an **inline closure** (it captures `onEmptyPress` and the per-call veto set). This is a deliberate, scoped deviation matching the **local precedent** in the same file: the tab-DnD `recordMouseTarget` mousedown closure in `installTabDnD` ([TabBar.ts:2409](../src/typescript/lib/component/container/TabBar.ts#L2409)) is itself an inline closure that captures install-time state and is torn down by a stored teardown. `installMoveTrigger` follows the same shape (closure + stored `_moveTriggerTeardown`). Flagged here per the plan-skill requirement to surface unavoidable convention deviations.

### `setTearOffStripBody` / `isTearOffStripBody` — moved to `TabWindow`, dropped as a generic flag

Today `setTearOffStripBody(true)` ([Window.ts:1208](../src/typescript/lib/core/Window.ts#L1208)) marks a strip-body window so the header's Shift-drag re-dock source stays inert over it ([Window.ts:1176](../src/typescript/lib/core/Window.ts#L1176)). In the new design a `TabWindow` **has no header** and therefore no header re-dock source at all — the whole `_headerDragShift`/`buildHeaderDragData`/`onHeaderDragStart`/`onHeaderDragEnd`/`captureHeaderShift` apparatus lives only on `Window`. So the `isTearOffStripBody` veto becomes **structurally unnecessary**: a `TabWindow` can never run the header re-dock path because it never builds it.

**Decision:** remove `setTearOffStripBody`/`isTearOffStripBody`/`_tearOffStripBody` entirely. The single consumer is the `onHeaderDragStart` veto, which moves to `Window` and no longer needs the flag (a header window built by `new Window` is never a strip body). `LayoutSerialization`/`Tab` set it only via the old `fillWindowWithStrip`, which Phase 3 rewrites. This is a net deletion of dead machinery, not a relocation — flagged in `### CODE_CONVENTIONS deviations` as a public-surface removal (the two methods are public on today's `Window`).

### Title is a read-only derived hook; no `setTitle` on the base (B2)

`LayoutSerialization.windowNodeFor` reads the window title via `win.getHeader().getText().getText()` ([LayoutSerialization.ts:239](../src/typescript/lib/layout/LayoutSerialization.ts#L239)) and identity-compares `child !== win.getHeader()` for content discovery ([LayoutSerialization.ts:219](../src/typescript/lib/layout/LayoutSerialization.ts#L219)). A headerless `TabWindow` has no `getHeader()`.

**Decision:** `AbstractWindow` exposes a `protected abstract getTitle(): string` READ hook. `Window.getTitle()` returns `this._header.getText().getText()` (the existing header-text read path; `setHeaderText` at [Window.ts:656](../src/typescript/lib/core/Window.ts#L656) writes through `_header.getText().setText`, the title-write path that **stays on `Window`** as its existing concrete method). `TabWindow.getTitle()` returns the active tab's label via the single new public `Tab.getActiveTabLabel()` accessor (see below). The serializer reads `win.getTitle()` instead of reaching through `getHeader()`.

**No `setTitle` hook on the base (B2).** A `TabWindow`'s title is *derived* from the active tab — there is no tab-rename API, so any `TabWindow.setTitle` could only be a no-op. Rather than carry an abstract writer that one subclass cannot honour, the base has **no title writer at all**: `getTitle()` is the only title hook. `Window` keeps its concrete `setHeaderText` (unchanged, `Window`-only); `TabWindow` has no title writer. This removes the prior plan's `abstract setTitle(text)` from the hook list entirely.

**`Tab.getActiveTabLabel(): string | null` — the one new public `Tab` accessor.** The active-tab label lives in the private `_bar`, so add one minimal forwarder:

```typescript
getActiveTabLabel(): string | null {
    const id = this._bar.getActiveEntryId();          // TabBar.ts:1059
    return id === null ? null : this._bar.getEntryName(id);   // TabBar.ts:1082
}
```

`TabBar.getActiveEntryId()` returns `string | null` (the active cell id, or `null` when empty); `TabBar.getEntryName(id)` returns the cell's display label (`""` for an unknown id — never reached here since the id comes from `getActiveEntryId`). `TabWindow.getTitle()` returns `this._tab.getActiveTabLabel() ?? ""`. This is the **only** net-new public `Tab` API the design needs (no closeable accessor — closeable is pushed by `syncHostWindowCloseable`; no events). Both `TabBar` methods are verified to exist with these signatures.

For content discovery, `windowContentOf` is retyped to take `AbstractWindow` and uses a base predicate `isChromeComponent(child)` (Window: `child === _header`; TabWindow: the bar belongs to the `Tab`, so the strip content is found the same way `findBodyHost` already works). `Window.getHeader()` stays `WindowHeader`-typed and public — the serialization-facing API that mattered (`getHeader`) is **unchanged on `Window`**; the serializer simply stops depending on it.

### Window controls as `Tab`/`TabBar` tools

`TabWindow` builds three chromeless `Button`s (glyphs `window-minimize` / `window-maximize` / `xmark`, mirroring [WindowHeader.ts:89–91](../src/typescript/lib/component/container/WindowHeader.ts#L89)) wired to the inherited `toggleMinimize()` / `toggleMaximize()` / `requestClose()`, and adds them via `Tab.addTool` ([Tab.ts:687](../src/typescript/lib/layout/Tab.ts#L687) → [TabBar.ts:1014](../src/typescript/lib/component/container/TabBar.ts#L1014)) so they land in the bar's trailing `_toolGroup`. `reflectCloseable` toggles the close tool's enabled state; `reflectMinimizable`/`reflectMaximizable` toggle the matching tools' visibility.

### Closeable / min / max reflection — base stores state, subclass reflects via a hook (B1)

The every-tab-closeable predicate (closeable) must reflect into the window as tabs are added / removed; min/max reflect a static option. The reflection-INTO-UI differs per subclass (header buttons vs control tools), but the *state* and *trigger* are shared. The design splits cleanly:

**`setCloseable`/`setMinimizable`/`setMaximizable` are non-virtual on `AbstractWindow`** — each stores `_options.<flag> = value` and calls a `protected reflect<Flag>(value)` hook the subclass implements:

```typescript
setCloseable(value: boolean): this {
    this._options.closeable = value;
    this.reflectCloseable(value);          // Window: _header.setCloseable; TabWindow: _closeTool.setEnabled
    return this;
}
```

This is byte-for-byte what `Window.setCloseable` does today ([Window.ts:899-904](../src/typescript/lib/core/Window.ts#L899): `this._options.closeable = value; this._header.setCloseable(value);`) — the `_header.setCloseable` line simply moves into `Window.reflectCloseable`. `Window`'s existing behaviour is **preserved exactly** via the hook; `setMinimizable`/`setMaximizable` follow the identical split (Window → header buttons; TabWindow → the matching control tools' visibility). Chosen over "each subclass overrides `setCloseable` calling `super`" because the non-virtual-base + `reflect*`-hook shape keeps the `_options` write in **one** place (the base) and leaves only the UI push to the subclass — there is exactly one state writer and one reflection path, and no risk of a subclass forgetting the `_options` write.

**Who calls `setCloseable` for a `TabWindow`?** The existing **`Tab.syncHostWindowCloseable`** push ([Tab.ts:1643](../src/typescript/lib/layout/Tab.ts#L1643)) — `Tab` is the source of truth for which tabs are closeable, computes `getEntryIds().every(id => _bar.isEntryCloseable(id))`, and calls `hostWindow().setCloseable(...)` from its set-mutation sites. With B1's inclusive `hostWindow()` walk, `hostWindow()` returns the `TabWindow`, and `setCloseable` runs the `reflectCloseable` hook → the close tool greys. **No double write, no `TabWindow` subscription, no reflection re-implementation on `TabWindow`** — exactly one writer (`Tab`), one reflection (`TabWindow.reflectCloseable`).

`Tab.hostWindow()` is **retained** (retyped to `AbstractWindow`, start-point fixed per B1); `closeHostWindowIfEmpty` and `syncHostWindowCloseable` are **retained unchanged** except for the `AbstractWindow` retype — the close-when-empty trigger and the closeable push both belong to `Tab` (it owns `_closeHostWindowWhenEmpty`, observes its own emptying, and enumerates its own bar). This is the reuse the audit's chosen direction calls for: the prior cycle's plan to *remove* `syncHostWindowCloseable`'s write and re-implement it on `TabWindow` via events is **abandoned** — the existing push is correct and sufficient.

**`addLazyTab` is not a closeable set-mutation site.** `syncHostWindowCloseable` runs today from exactly three sites: `createTab` ([Tab.ts:1089](../src/typescript/lib/layout/Tab.ts#L1089)), `_onBarTabClose` ([Tab.ts:851](../src/typescript/lib/layout/Tab.ts#L851)), `removeEntryKeepingContent` ([Tab.ts:1526](../src/typescript/lib/layout/Tab.ts#L1526)). `addLazyTab` ([Tab.ts:1145](../src/typescript/lib/layout/Tab.ts#L1145)) is a **fourth** set-mutation path that calls neither `syncHostWindowCloseable` nor any sync today — a pre-existing gap, not introduced by this plan. Strip tear-offs build their content via `createTab` (through `detachTabToWindow`/`dockComponent`), **never** `addLazyTab`, so the gap is not load-bearing for `TabWindow`. **Decision: lazy tabs are explicitly scoped OUT** — `addLazyTab` is left untouched (adding a `syncHostWindowCloseable` call there is out of scope and would change behaviour for non-tear-off lazy strips). The plan's earlier "three set-mutation points" claim is **correct as stated** (it describes where `syncHostWindowCloseable` runs); `addLazyTab` is a separate, deliberately-unsynced path, noted here and in Non-Goals.

### `protected TabBar.installMoveTrigger(onEmptyPress)` seam + dedicated teardown

The empty-bar-area window-move gesture needs to read `TabBar` internals that are private (entry wrappers, `_toolGroup`, `_tabClip`). Rather than widen four internals, add one `protected installMoveTrigger(onEmptyPress: (e: MouseEvent) => void)` that registers a `mousedown` on the bar's own element, early-returns when `e.shiftKey` or `e.target` is contained by any `entry.wrapper` / the `_toolGroup` element / the `_tabClip` element (the same neighbourhood veto the tab-DnD path uses), and otherwise calls `onEmptyPress(e)`. It is `protected` because only a subclass needs it — but `TabWindow` does **not** subclass `TabBar`. **Resolution:** `TabWindow` does not call it directly; instead it is invoked through the `Tab` (the `Tab` owns the bar). Two clean options:

- **(a)** `installMoveTrigger` is `protected` on `TabBar` and `TabWindow` uses a thin `TabBar` subclass only as the move-trigger host — **rejected**, reintroduces a bar subclass.
- **(b)** Expose a narrow `public installMoveTrigger(onEmptyPress)` on `TabBar` *and* a forwarding `Tab.installBarMoveTrigger(onEmptyPress)` (the `Tab` already wraps the bar's seams like `addTool`). `TabWindow` calls `this._tab.installBarMoveTrigger(e => this.startMoveFrom(e))`. **Chosen.** It matches the existing `Tab`→`TabBar` forwarding idiom and keeps `TabBar`'s internals private behind the one method. (`public` not `protected`, since the caller is the sibling `Tab`, not a subclass.)

**Teardown must NOT live in `_dndTeardowns`.** [`teardownTabDnD`](../src/typescript/lib/component/container/TabBar.ts#L2689) drains the entire `_dndTeardowns` array and runs at the top of `installTabDnD` ([TabBar.ts:2403](../src/typescript/lib/component/container/TabBar.ts#L2403)) — and because `reorderable:true` defers `installTabDnD` to first render ([TabBar.ts:637](../src/typescript/lib/component/container/TabBar.ts#L637)), a move-trigger teardown on `_dndTeardowns` would be swept on first paint, killing the gesture from frame one (also on any `setReorderable` toggle, [TabBar.ts:990/992](../src/typescript/lib/component/container/TabBar.ts#L990)). **Fix:** store it in a dedicated `private _moveTriggerTeardown: (() => void) | null = null`, drained only by `dispose()` ([TabBar.ts:650](../src/typescript/lib/component/container/TabBar.ts#L650)) alongside `teardownTabDnD()`, never by `teardownTabDnD`. `installMoveTrigger` disposes any prior trigger first (idempotency). The `mousedown` listener is on the bar element, which survives renders, so once out of the DnD array the gesture persists.

### Double-click-maximize is OMITTED for `TabWindow` (C)

Today dblclick-maximize is a header-only gesture: `_header.addHeaderDoubleClickListener` → `onHeaderDoubleClick` ([Window.ts:858](../src/typescript/lib/core/Window.ts#L858)), which vetoes clicks on the trailing buttons via `targetIsInTrailingButton` ([Window.ts:875](../src/typescript/lib/core/Window.ts#L875)) and otherwise restores-from-minimized or toggles maximize. `TabBar.installMoveTrigger` wires only a `mousedown` move gesture, not a `dblclick`.

**Decision: dblclick-maximize stays a `Window`-only gesture; it is OMITTED for `TabWindow` (Non-Goal).** `onHeaderDoubleClick` / `targetIsInTrailingButton` stay **on `Window`**, unchanged and unrenamed — they are not lifted to the base, not renamed to `onChromeDoubleClick`, and there is no `isTrailingControlTarget` hook. Rationale: lifting the dblclick path to the base would require extending the `TabBar` move seam with a second (`dblclick`) wire and a tool-group veto on the bar's empty area — net-new surface for a secondary convenience gesture, against the plan's simplicity bias. A `TabWindow` is maximized via its explicit maximize control tool. This **drops** the prior plan's `onChromeDoubleClick` rename and the `isTrailingControlTarget` abstract hook entirely (removed from the hook list, the Public API block, the member table, and the step list). If dblclick-maximize on the empty bar area is wanted later, it is a small follow-up (a `dblclick` companion to `installMoveTrigger`), tracked as a Non-Goal here.

### `startMoveFrom` extracted from `onMouseDown`; `toggleMinimize` / `toggleMaximize` accessible to subclasses

- `AbstractWindow.startMoveFrom(e)` — the body of today's `onMouseDown` ([Window.ts:1097](../src/typescript/lib/core/Window.ts#L1097)) (Shift / `windowState` guards, origin snapshot, `setWillChange`, viewport listener registration); `onMouseDown` delegates. `Window`'s header `mousedown` and `TabWindow`'s bar move trigger both call it. NET-NEW method on the base.
- `toggleMinimize` / `toggleMaximize` — today `private` on `Window` ([Window.ts:824](../src/typescript/lib/core/Window.ts#L824)/[L840](../src/typescript/lib/core/Window.ts#L840)). On the base they must be reachable by `TabWindow`'s control-tool handlers. **Widen to `public`** (no body change; the existing `isMinimizable`/`isMaximizable` guards stay). Public over `protected` because the control-tool action callbacks are arrow closures that read them as `this.toggleMinimize()` — `protected` would suffice for `TabWindow`'s own code, but the prior plan and the symmetry with `requestClose` (already public) favour `public`; either satisfies the design. Flagged in `### CODE_CONVENTIONS deviations`.

### `: Window` type-reference disposition

- `Window.getOpenWindows(): Window[]` — moves to `AbstractWindow` and returns `AbstractWindow[]` (the open-windows set holds any window; `LayoutSerialization` iterates it and must see `TabWindow`s too). The `openWindows` `Set<Window>` field → `Set<AbstractWindow>`.
- `windowContentOf(win: Window)` ([LayoutSerialization.ts:218](../src/typescript/lib/layout/LayoutSerialization.ts#L218)) → `AbstractWindow` (any window's content is serialized).
- `parkLeaves(..., liveWindows: Window[], ...)` ([LayoutSerialization.ts:303](../src/typescript/lib/layout/LayoutSerialization.ts#L303)) → `AbstractWindow[]`.
- `windowNodeFor(win: Window)` ([LayoutSerialization.ts:229](../src/typescript/lib/layout/LayoutSerialization.ts#L229)) → `AbstractWindow` (uses `getTitle()`/`getRect()`/`getWindowState()`/`getRestoreRect()`, all on the base).
- `Tab.fillWindowWithStrip(win: Window, ...)` — Phase 3 retypes the param to `TabWindow` (it builds one).
- `Tab.hostWindow(): Window | null` → `AbstractWindow | null` (a `TabWindow` is the host now), and the two `instanceof Window` → `instanceof AbstractWindow`.
- `MiscPanel.ts` (×12) and `LayoutSerialization.ts:455` (`new Window(node.header)`) — **unchanged** (`Window` stays a concrete header window). Serialization restore rebuilds a header `Window`; round-tripping a strip `TabWindow` back to a header window is acceptable and out of scope (see `## Non-Goals`).

### CODE_CONVENTIONS deviations (flagged)

- **`AbstractWindow` — new exported abstract class.** Added to the `core` barrel ([core/index.ts:21](../src/typescript/lib/core/index.ts#L21)) for the `instanceof` use in `Tab.ts` and the type widenings in `LayoutSerialization.ts`. Abstract, so no `callable()` wrapper (callable is for `new`-able widgets); exported as the plain class. Documented on a docs page (see `## Documentation Impact`).
- **`TabWindow` — new exported concrete class** sibling to `Window`: `extends AbstractWindow`, a `callable()` wrapper + barrel entry (mirroring `Window`'s `WindowCallable` export at [Window.ts:1951](../src/typescript/lib/core/Window.ts#L1951)) + docs page.
- **Public-widening of `toggleMinimize` / `toggleMaximize`** — surface-widening only (no rename, no body change). They appear on the window API page once public.
- **Removal of public `setTearOffStripBody` / `isTearOffStripBody`** — a public-surface removal on `Window` (the only library consumer was `fillWindowWithStrip`, rewritten in Phase 3; no app code uses them — verified by grep). Flagged here and in `## Documentation Impact`.
- **`Window.getHeader()` stays `WindowHeader`** — unchanged signature; serialization stops depending on it (uses `getTitle()`), so the serialization-facing API is stable.
- **`TabBar.installMoveTrigger` + `_moveTriggerTeardown`; `Tab.installBarMoveTrigger`** — a new public method + private field on `TabBar`, and a forwarding method on `Tab`. No setter/option, no DOM property, no `callable()` change. The `installMoveTrigger` `mousedown` handler is an **inline closure** — a deliberate deviation from the named-listener convention, matching the local `recordMouseTarget` precedent in `installTabDnD` ([TabBar.ts:2409](../src/typescript/lib/component/container/TabBar.ts#L2409)) (A3).
- **`Tab.getActiveTabLabel(): string | null`** — one net-new public read accessor on `Tab`, forwarding to `_bar.getActiveEntryId()` / `_bar.getEntryName(id)`. Additive (no rename/removal). The `Tab` event union is **NOT** widened (the prior cycle's `"tabselect"`/`"tabsetchanged"` proposal is dropped — see `### No new `Tab` events …`). Documented (see `## Documentation Impact`).
- **`AbstractWindow.chromeHeight()` / `isChromeComponent()` hooks** — net-new `protected` hooks on the base (defaulted, not abstract): `chromeHeight()` returns `0` with the `|| 26` floor kept at call sites (B2); `isChromeComponent()` returns `false` (A2). Both are internal hooks, not public surface; no docs page change beyond the base-class JSDoc.
- **One element per class** — preserved: `AbstractWindow` owns the window element + border overlays; `Window` owns its `WindowHeader`; `TabWindow` owns its `Tab` (which owns the bar). No class fakes a second DOM role.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/core/AbstractWindow.ts — NEW exported abstract base.
// All header-agnostic window machinery: resize borders, move, state, closeable/
// min/max state, active-focus, z-order, show/hide, title concept, min-size seed.
abstract class AbstractWindow extends Panel<WindowOptions> implements DismissableLayer {
    // ----- generic, shared (moved verbatim from Window) -----
    static getOpenWindows(): AbstractWindow[];
    show(): this;
    bringToFront(): void;
    requestClose(): void;
    onActivate(active: boolean): void;          // -> paintActive hook
    setWindowState(state: WindowState): this;    // -> reflectMaximizeState hook
    getWindowState(): WindowState;
    toggleMinimize(): void;                       // widened private -> public
    toggleMaximize(): void;                       // widened private -> public
    isMaximized(): boolean; isMinimized(): boolean;
    setCloseable(v: boolean): this;              // -> reflectCloseable hook
    isCloseable(): boolean;
    setMinimizable(v: boolean): this;            // -> reflectMinimizable hook
    isMinimizable(): boolean;
    setMaximizable(v: boolean): this;            // -> reflectMaximizable hook
    isMaximizable(): boolean;
    setMaximizeBounds(v: WindowMaximizeBounds): this; getMaximizeBounds(): WindowMaximizeBounds;
    setSnapResizeEnabled / isSnapResizeEnabled / setSnapThreshold / getSnapThreshold /
        setSnapModifier / getSnapModifier / setConstrainToViewport / isConstrainToViewport;
    setWidth(w: number): this; setHeight(h: number): this;  // min-clamp mechanism
    getRect(): WindowRect; applyRect(r: WindowRect): this; getRestoreRect(): WindowRect | null;
    clampPositionToViewport(): this;
    onMouseDown(e: MouseEvent): void;            // delegates to startMoveFrom
    startMoveFrom(e: MouseEvent): void;          // NET-NEW (body of old onMouseDown)
    onResize(border: WindowBorder, e: MouseEvent): void; onDrag(e): void; onMouseUp(): void;
    doLayout(): this; render(): HTMLElement;
    getLayerElement(): HTMLElement | null; getDismissMode(): LayerDismissMode;
    getBand(): number; isLayerRoot(): boolean; onZIndexChanged(z: number): void;

    // ----- generic title concept (serialization) -----
    // (getTitle is abstract; see hooks)

    // ----- protected/abstract hooks (what differs per subclass) -----
    protected initChrome(): void;                 // run late dispatch + wireMoveTrigger + min-seed
    protected abstract wireMoveTrigger(): void;
    protected abstract reflectCloseable(v: boolean): void;
    protected abstract reflectMinimizable(v: boolean): void;
    protected abstract reflectMaximizable(v: boolean): void;
    protected abstract reflectMaximizeState(state: WindowState): void;
    protected abstract paintActive(active: boolean): void;
    protected abstract getTitle(): string;             // READ ONLY — no setTitle hook (B2)
    protected abstract minContentWidthSeed(): number;
    protected chromeHeight(): number;                  // NET-NEW hook; base default 0, floor `|| 26` at call sites (B2)
    protected abstract addContent(content: Component): void;
    protected isChromeComponent(child: Component): boolean;  // NET-NEW; base default false, Window overrides (A2)
    // NO isTrailingControlTarget hook — dblclick-maximize stays Window-only (C)
}
```

```typescript
// src/typescript/lib/core/Window.ts — now extends AbstractWindow. Behaviour identical.
class Window extends AbstractWindow {
    private _header: WindowHeader;                 // non-null, unchanged
    constructor(headerText: string, options?: WindowOptions);
    getHeader(): WindowHeader;                     // UNCHANGED signature
    setHeaderText(text: string): this;
    setGlyph(...) /* via _header */; setMaximizeButtonGlyph mapping; the button-element
        getters; buildHeaderDragData/onHeaderDragStart/onHeaderDragEnd/captureHeaderShift
        (header re-dock drag source) — all stay HERE, non-null.

    // hook implementations
    protected wireMoveTrigger(): void;            // header mousedown -> startMoveFrom + shift capture + drag source
    protected reflectCloseable(v): void;          // _header.setCloseable
    protected reflectMinimizable(v): void;        // _header.setMinimizable
    protected reflectMaximizable(v): void;        // _header.setMaximizable
    protected reflectMaximizeState(s): void;      // _header.setMaximizeButtonGlyph(...)
    protected paintActive(active): void;          // _header.setActive
    protected getTitle(): string;                 // _header.getText().getText  (READ; setHeaderText stays the Window-only writer)
    protected minContentWidthSeed(): number;      // _header.getMinContentWidth()
    protected chromeHeight(): number;             // _header.getHeight()  (B2)
    protected addContent(content): void;          // addComponent(content, CENTER)
    protected isChromeComponent(child): boolean;  // child === this._header  (A2)
    // onHeaderDoubleClick / targetIsInTrailingButton stay PRIVATE on Window (dblclick-maximize, C)
}
```

```typescript
// src/typescript/lib/core/TabWindow.ts — NEW concrete subclass, no header.
class TabWindow extends AbstractWindow {
    private _tab: Tab;
    private _closeTool: Button; private _minTool: Button; private _maxTool: Button;
    // Builds a Tab as this window's layout manager + the control tools. NO Tab-event
    // subscription: closeable is pushed by Tab.syncHostWindowCloseable -> setCloseable
    // -> reflectCloseable; title is read live via getTitle(). createTab adds content.
    constructor(options?: WindowOptions);
    createTab(content: Component): this;           // moveComponent(content) + _tab.createTab

    protected wireMoveTrigger(): void;            // _tab.installBarMoveTrigger(e => startMoveFrom(e))
    protected reflectCloseable(v): void;          // _closeTool.setEnabled(v)  (driven by Tab's existing push)
    protected reflectMinimizable(v): void;        // _minTool.setVisible(v)
    protected reflectMaximizable(v): void;        // _maxTool.setVisible(v)
    protected reflectMaximizeState(s): void;      // no-op
    protected paintActive(active): void;          // no-op (TabBar paints its own bg)
    protected getTitle(): string;                 // this._tab.getActiveTabLabel() ?? ""
    protected minContentWidthSeed(): number;      // tab-bar min width
    protected chromeHeight(): number;             // tab-bar height  (B2)
    protected addContent(content): void;          // this.moveComponent(content); this._tab.createTab(content)  (A1)
    protected isChromeComponent(child): boolean;  // false — bar belongs to the Tab, every child is content  (A2)
    // no isTrailingControlTarget — dblclick-maximize omitted for TabWindow (C)
}
```

```typescript
// src/typescript/lib/component/container/TabBar.ts
class TabBar extends Panel<TabBarOptions> {
    // Empty-bar-area window-move trigger. mousedown on the bar element, vetoing
    // presses inside a tab wrapper / _toolGroup / _tabClip, or with Shift held;
    // otherwise calls onEmptyPress(e). Teardown stored in the DEDICATED
    // _moveTriggerTeardown (NOT _dndTeardowns), drained only by dispose().
    installMoveTrigger(onEmptyPress: (e: MouseEvent) => void): this;
    private _moveTriggerTeardown: (() => void) | null;
}

// src/typescript/lib/layout/Tab.ts — thin forwarder (matches addTool forwarding) + one new read accessor.
// TabEvent is UNCHANGED — no event widening (the prior cycle's "tabselect"/"tabsetchanged" is dropped).
type TabEvent = "tabclose" | "empty";

class Tab extends LayoutManager {
    getActiveTabLabel(): string | null;           // NET-NEW: _bar.getActiveEntryId() -> _bar.getEntryName(id)
    installBarMoveTrigger(onEmptyPress: (e: MouseEvent) => void): this;  // -> this._bar.installMoveTrigger
    hostWindow(): AbstractWindow | null;          // retyped from Window; walk now starts at getContainer() (B1)
    fillWindowWithStrip(win: TabWindow, content: Component): void;       // retyped + rewritten (Phase 3)
    // syncHostWindowCloseable / closeHostWindowIfEmpty — RETAINED, only retyped to AbstractWindow.
    // No new on/off/emit overloads.
}
```

`AbstractWindow` and `TabWindow` are exported from the `core` barrel. `WindowOptions`/`WindowState`/`WindowMaximizeBounds`/`WindowSnapModifier` move to (or are re-exported from) `AbstractWindow.ts` and stay exported. The `Tab` class gains no new *public layout* option — `installBarMoveTrigger` is an imperative seam used only by `TabWindow`.

---

## Internal Structure

**Class hierarchy:**

```
Panel<WindowOptions>
└── AbstractWindow (abstract) ── borders, move, state, closeable/min/max state,
    │                            active state, z-order, show/hide, title concept,
    │                            min-seed mechanism; hooks for the rest
    ├── Window     ── Border layout; _header: WindowHeader (NORTH) + content (CENTER);
    │                 all header-specific methods + the Shift-drag re-dock source
    └── TabWindow  ── Tab layout (its own bar+content); control tools; move trigger
                      via Tab.installBarMoveTrigger; title/closeable from the Tab
```

**`TabWindow` interior (strip-mode tear-off):**

```
┌─ TabWindow element (layout manager = Tab) ─────────────────┐
│  Tab BAR (TabBar):  [ Tab label ][ Tab2 ]   [▁][□][✕]      │ ← drag empty area = move window
│  Tab CONTENT: selected tab's component fills the rest       │
│  8× WindowBorder resize overlays (from AbstractWindow)      │
└────────────────────────────────────────────────────────────┘
```

No inner `Panel`, no inner second `Tab` — the `TabWindow`'s own `Tab` *is* the strip. The bar is the title bar; controls are trailing tools; the empty bar area moves the window.

**Member → class assignment (contentious members):**

| Member (today on `Window`) | Goes to | Reason |
|---|---|---|
| `_borderComponents` + 8-handle build + `onResize`/`flushResize`/`onResizeEnd`; `render()` border append; `doLayout()` border positioning | AbstractWindow | header-agnostic geometry |
| `onMouseDown` → split into `startMoveFrom` (body) + shell; `onDrag`/`onMouseUp`/clamp helpers | AbstractWindow | generic move |
| `setWindowState`/`toggle*`/`isMax/Min`/`computeMaximizeRect`/`computeDockRect`/`animateRect`/restore-rect/min-stack/viewport-resize/snap-* | AbstractWindow | generic state |
| `setCloseable`/`isCloseable`/`setMinimizable`/`setMaximizable` (state) | AbstractWindow | `_options`-backed; reflect via hook |
| the three `setMaximizeButtonGlyph` calls in `setWindowState` | hook `reflectMaximizeState` | header-specific paint, isolated |
| `_header.setCloseable`/`setMinimizable`/`setMaximizable` (paint) | hooks `reflect*` on `Window` | header-specific |
| `onActivate` (state) vs `_header.setActive` (paint) | base / `paintActive` hook | split state from paint |
| the three `this._header.getHeight() \|\| 26` height reads (`viewportPositionBounds` [1417], `computeDockRect` [1648], static `relayoutMinimizedStack` [1688]) | base methods, routed through `chromeHeight()` hook | header-agnostic geometry; height differs per subclass (B2) |
| `findBodyHost`'s `child !== this._header` identity-compare ([1611]) | base method, routed through `isChromeComponent()` hook | "which child is chrome" differs per subclass (A2) |
| `setHeaderText`/`getHeader`/`setGlyph`/button-element getters | Window only | header-specific |
| `_headerDragShift`/`buildHeaderDragData`/`onHeaderDragStart`/`onHeaderDragEnd`/`captureHeaderShift` (Shift re-dock source) | Window only | header-targeted re-dock |
| `setTearOffStripBody`/`isTearOffStripBody`/`_tearOffStripBody` | **deleted** | only consumer was the header re-dock veto, now structurally inert on `TabWindow` |
| `getOpenWindows`/`openWindows` set | AbstractWindow (typed `AbstractWindow`) | both kinds register |
| `requestClose`/`onExitAction`/content-factory/`_bodyHost`/`findBodyHost` | AbstractWindow | generic lifecycle |
| `onHeaderDoubleClick`/`targetIsInTrailingButton` (dblclick-maximize) | Window only | header-only gesture; OMITTED for TabWindow (C) |

**`fillWindowWithStrip` rewrite (Phase 3).** Today ([Tab.ts:1583](../src/typescript/lib/layout/Tab.ts#L1583)): `new Tab({reorderable:true})` → `_closeHostWindowWhenEmpty=true` → wrap in `Panel` → `win.moveComponent(strip)` → `setTearOffStripBody(true)` → `strip.moveComponent(content)` → `innerTab.createTab(content)` → `win.show()`. The `win` is built header-ful one level up in `detachTabToWindow` ([Tab.ts:1551](../src/typescript/lib/layout/Tab.ts#L1551)). Rewritten — the `win` IS the `TabWindow`, so there is no inner nesting:

```
// detachTabToWindow (Tab.ts:1547):
const useStrip = !forceBare && this._detachWindowMode === "strip";
const win = useStrip
    ? new TabWindow({ closeable: this._bar.isEntryCloseable(id) })   // headerless Tab window
    : new Window(this._bar.getEntryName(id), { closeable: this._bar.isEntryCloseable(id) });
// ... position/size/clamp unchanged ...
if (useStrip) {
    win.createTab(content);   // TabWindow builds the bar entry; reflects title+closeable
    win.show();
} else {
    win.moveComponent(content);
    win.show();
}
this.removeEntryKeepingContent(id);
```

`fillWindowWithStrip` collapses into the `useStrip` branch (or stays as a one-liner helper typed `TabWindow`). The `TabWindow`'s constructor sets `_closeHostWindowWhenEmpty` on its own `Tab` so `closeHostWindowIfEmpty` ([Tab.ts:1629](../src/typescript/lib/layout/Tab.ts#L1629)) still closes the window when the last tab leaves — `hostWindow()` finds the `TabWindow` via `instanceof AbstractWindow`. The `"empty"` emit is unchanged.

**`Tab.hostWindow()` inclusive walk (B1).** Start the ancestor walk at `this.getContainer()` itself (not `getContainer()?.getParentComponent()`) and test each node for `instanceof AbstractWindow` before ascending via `getParentComponent()`. For a `TabWindow` the container *is* the window, so the walk returns it on the first check; for the legacy nested topology it ascends as before. Gated by `_closeHostWindowWhenEmpty` exactly as today. (Source in the B1 decision.)

**`TabWindow` closeable + title flow (no events).** `TabWindow` does **not** subscribe to any `Tab` event. Closeable reflects via the existing push: `Tab.syncHostWindowCloseable` (called from `createTab`/`_onBarTabClose`/`removeEntryKeepingContent`) computes `getEntryIds().every(isEntryCloseable)`, walks B1's inclusive `hostWindow()` to the `TabWindow`, and calls `win.setCloseable(...)` → the base stores `_options.closeable` and runs `TabWindow.reflectCloseable` → `_closeTool.setEnabled`. Title is read live: `TabWindow.getTitle()` returns `this._tab.getActiveTabLabel() ?? ""` whenever serialization (or any future reader) asks — there is no cached title to refresh. First paint is covered by `createTab` (which triggers `syncHostWindowCloseable` for closeable; the title needs no eager write since it is read-only).

**`TabBar.installMoveTrigger`.** If `_moveTriggerTeardown` is set, call it first. Register `Event.addListener(this, "mousedown", handler)`; `handler` early-returns on `e.shiftKey`, or when `e.target instanceof Node` and contained by any `entry.wrapper` / `_toolGroup` element / `_tabClip` element; else `onEmptyPress(e)`. Store `_moveTriggerTeardown = () => Event.removeListener(...)`. `dispose()` ([TabBar.ts:650](../src/typescript/lib/component/container/TabBar.ts#L650)) drains it (`this._moveTriggerTeardown?.(); this._moveTriggerTeardown = null;`) next to its `teardownTabDnD()`. Cross-subtree DnD risk is moot — the bar and content are both inside the `TabWindow`'s own `Tab`, one container.

---

## Ordered Implementation Steps

### Phase 1 — Extract `AbstractWindow` (pure refactor; `Window` behaviour byte-for-byte identical)

1. **Create `AbstractWindow.ts`** — `abstract class AbstractWindow extends Panel<WindowOptions> implements DismissableLayer`. Move `WindowState`/`WindowMaximizeBounds`/`WindowSnapModifier`/`WindowOptions`/`_defaultWindowOptions`/`WindowRect` and all header-agnostic members per the assignment table. Make `setCloseable`/`setMinimizable`/`setMaximizable` **non-virtual on the base**: store `_options.<flag>` then call the matching `protected reflect<Flag>(value)` hook (B1). Add the abstract + defaulted hooks (incl. `getTitle()` abstract read-only **with no `setTitle`** — B2; `chromeHeight()` default `0`; `isChromeComponent()` default `false`). Add `initChrome()` (runs the late state dispatch via the `reflect*` hooks + `wireMoveTrigger()` + min-seed; **not** the base constructor — A4). Split `onMouseDown` into `startMoveFrom` + shell. **Leave `onHeaderDoubleClick`/`targetIsInTrailingButton` on `Window`** — not lifted, not renamed (no `onChromeDoubleClick`, no `isTrailingControlTarget` hook; dblclick-maximize is Window-only, C). Route the three height reads through `this.chromeHeight() || 26` (B2) and `findBodyHost`'s identity-compare through `!this.isChromeComponent(child)` (A2). Type `openWindows`/`getOpenWindows` as `AbstractWindow`. → verify: file compiles in isolation (hooks abstract/defaulted, no header refs); `grep -n '_header' AbstractWindow.ts` → 0.
2. **Reduce `Window.ts` to `extends AbstractWindow`** — keep `_header: WindowHeader` (non-null), the constructor (build `_header` + wire, then `this.initChrome()`), and every header-specific method + the Shift-drag re-dock source. Implement the hooks via `_header` (incl. `chromeHeight()` → `this._header.getHeight()`, `isChromeComponent(c)` → `c === this._header`). Re-export `WindowOptions`/`WindowState`/etc. from here (or import-and-re-export) so existing `core` barrel imports keep resolving. `getHeader()` stays `WindowHeader`. **Delete** `setTearOffStripBody`/`isTearOffStripBody`/`_tearOffStripBody`; fold the strip-body veto out of `onHeaderDragStart` (a `new Window` is never a strip body). → verify: `tsc -p tsconfig.lib.json --noEmit` → 0 errors.
3. **`core` barrel** — export `AbstractWindow` from [core/index.ts](../src/typescript/lib/core/index.ts) next to `Window` ([L21](../src/typescript/lib/core/index.ts#L21)); export the option/state types from whichever module now declares them. → verify: barrel resolves.
4. **Retarget `Tab.hostWindow()` (instanceof + start-point, B1) and `: Window` types** — `Tab.ts` `hostWindow()`: both `instanceof Window` → `instanceof AbstractWindow` ([L1618](../src/typescript/lib/layout/Tab.ts#L1618)/[L1622](../src/typescript/lib/layout/Tab.ts#L1622)), return type → `AbstractWindow | null`, **and change the walk start from `this.getContainer()?.getParentComponent()` to `this.getContainer()` (inclusive)** ([L1616](../src/typescript/lib/layout/Tab.ts#L1616)) so the container-IS-the-window topology resolves; import `AbstractWindow`. `LayoutSerialization.ts`: `windowContentOf`/`windowNodeFor`/`parkLeaves` params → `AbstractWindow`; the title read `win.getHeader().getText().getText()` → `win.getTitle()` ([L239](../src/typescript/lib/layout/LayoutSerialization.ts#L239)); the content predicate `child !== win.getHeader()` → `!win.isChromeComponent(child)` (A2). `new Window(node.header)` at [L455](../src/typescript/lib/layout/LayoutSerialization.ts#L455) stays. → verify: `tsc` 0 errors; `grep -rn 'instanceof Window\b' src` → 0; `grep -rn 'getHeader().getText()' src` → 0. (Note: the start-point change only becomes behaviourally load-bearing in Phase 3, when the container becomes a `TabWindow`; it is safe and inert for the legacy topology, so it ships here paired with the `instanceof` retarget.)
5. **Phase-1 regression** — typecheck 0 errors; run the app; confirm every existing `MiscPanel` window (12 sites) still moves, resizes from all 8 borders, minimizes/maximizes/restores, closes, double-click-maximizes, snap-resizes, and Shift-drag re-docks. No visual or behavioural change. → verify: manual smoke (see `## Verification`).

### Phase 2 — Widen `Tab` events; add `TabWindow` + the `TabBar.installMoveTrigger` seam

6. **Add `Tab.getActiveTabLabel(): string | null`** — one new public read accessor forwarding to `_bar.getActiveEntryId()` ([TabBar.ts:1059](../src/typescript/lib/component/container/TabBar.ts#L1059)) → `_bar.getEntryName(id)` ([TabBar.ts:1082](../src/typescript/lib/component/container/TabBar.ts#L1082)); returns `null` when no active tab. **No `TabEvent` widening, no new `on`/`off`/`emit` overloads** (the prior cycle's event proposal is dropped — closeable rides the existing `syncHostWindowCloseable` push, title is read live). → verify: `tsc` 0 errors; `grep -n 'tabselect\|tabsetchanged' src` → 0.
7. **`TabBar.installMoveTrigger(onEmptyPress)` + `_moveTriggerTeardown`** — add the field + `public installMoveTrigger` (Shift/wrapper/`_toolGroup`/`_tabClip` veto, idempotent; inline-closure handler per A3), and drain `_moveTriggerTeardown` in `dispose()` ([TabBar.ts:650](../src/typescript/lib/component/container/TabBar.ts#L650)) — **not** in `teardownTabDnD`. Add forwarding `Tab.installBarMoveTrigger`. → verify: compiles; (gesture verified after step 8).
8. **Create `TabWindow.ts`** — `class TabWindow extends AbstractWindow`: build a `Tab` as its layout manager (set via `setLayoutManager`), set the `Tab`'s `_closeHostWindowWhenEmpty`, build the three control `Button` tools wired to `toggleMinimize`/`toggleMaximize`/`requestClose`, add them via `Tab.addTool` ([Tab.ts:687](../src/typescript/lib/layout/Tab.ts#L687)), then `this.initChrome()`. Implement all hooks (per signature block: `reflectCloseable`→`_closeTool.setEnabled`; `reflect{Min,Max}imizable`→tool `setVisible`; `getTitle`→`this._tab.getActiveTabLabel() ?? ""`; `chromeHeight`; `isChromeComponent`→`false`; `addContent`→`moveComponent`+`createTab`; `paintActive`/`reflectMaximizeState`→no-op). **No `Tab`-event subscription** — closeable arrives via the existing `syncHostWindowCloseable`→`setCloseable`→`reflectCloseable` push (B1), title is read live. Add `createTab(content)`. `callable()` wrapper + barrel export from [core/index.ts](../src/typescript/lib/core/index.ts). JSDoc the class + hooks. → verify: `tsc` 0 errors.
9. **Retype `Tab.syncHostWindowCloseable` / `closeHostWindowIfEmpty` to `AbstractWindow`** — these already came along with the `hostWindow()` retype in step 4; confirm `syncHostWindowCloseable`'s `win.setCloseable(...)` write is **RETAINED** (it is the single `setCloseable` writer for a `TabWindow`). No change to its three call sites (`createTab`/`_onBarTabClose`/`removeEntryKeepingContent`). `addLazyTab` stays unsynced (out of scope, B). → verify: `tsc` 0 errors; `grep -n 'win.setCloseable' src/typescript/lib/layout/Tab.ts` → still present.

### Phase 3 — Rewire `fillWindowWithStrip` / `detachTabToWindow`

10. **`detachTabToWindow` + `fillWindowWithStrip`** ([Tab.ts:1547](../src/typescript/lib/layout/Tab.ts#L1547)/[L1583](../src/typescript/lib/layout/Tab.ts#L1583)) — compute `useStrip` once; build a `TabWindow` on the strip branch (`new Window` on the bare branch), `win.createTab(content)` + `win.show()`; retype/collapse `fillWindowWithStrip` to take `TabWindow`. Import `TabWindow`. Remove the now-dead inner-`Panel`/inner-`Tab`/`setTearOffStripBody` nesting. → verify: a strip tear-off shows ONE bar; bare tear-off + ordinary `new Window` unchanged.
11. **Regression checkpoints** — `grep -rn 'setTearOffStripBody\|isTearOffStripBody\|_tearOffStripBody' src` → 0; `grep -rn 'new Window(' src/typescript/lib` → only `LayoutSerialization.ts:455`; **tear a tab off a strip, drag the last tab back / close it → the emptied `TabWindow` auto-closes** (proves the B1 hostWindow walk resolves the `TabWindow`); smoke on `TabDemoPanel` (see `## Verification`).

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | src/typescript/lib/core/AbstractWindow.ts (abstract base + moved machinery + hooks + `startMoveFrom`; option/state types) |
| Create | src/typescript/lib/core/TabWindow.ts (concrete `Tab`-layout window; control tools; move trigger; title/closeable reflection) |
| Modify | src/typescript/lib/core/Window.ts (now `extends AbstractWindow`; keep `_header`/header methods + Shift re-dock source; implement hooks; delete `setTearOffStripBody`/`isTearOffStripBody`) |
| Modify | src/typescript/lib/core/index.ts (export `AbstractWindow`, `TabWindow`) |
| Modify | src/typescript/lib/component/container/TabBar.ts (`installMoveTrigger` + `_moveTriggerTeardown`; `dispose` drains it) |
| Modify | src/typescript/lib/layout/Tab.ts (new `getActiveTabLabel()` accessor; `installBarMoveTrigger`; `hostWindow` retype + **inclusive walk start** — B1; `syncHostWindowCloseable`/`closeHostWindowIfEmpty` retype to `AbstractWindow` (write RETAINED); `fillWindowWithStrip` retype; `instanceof AbstractWindow`; `detachTabToWindow` builds `TabWindow`. NO `TabEvent` widening) |
| Modify | src/typescript/lib/layout/LayoutSerialization.ts (`: Window` → `AbstractWindow` on 3 sigs; title via `getTitle()`; content predicate via `!win.isChromeComponent(child)` — A2) |
| Create | docs/components/TabWindow.md (+ `docs/components/index.md` entry + `docs/.vitepress/config.mts` sidebar near `Window` [L58](../docs/.vitepress/config.mts#L58)) |
| Create | docs/core/AbstractWindow.md *or* a section on the `Window` page (see Documentation Impact) |
| Modify | docs/components/Window.md (note the `AbstractWindow` base; removal of `setTearOffStripBody`/`isTearOffStripBody`) |
| Modify | docs/layouts/Tab.md (Tear-off & re-dock: strip mode now opens a `TabWindow` whose bar is the title bar) |

(No file is deleted. `setHeaderCollapsed` / `WindowChrome` / `TabWindowHeader` / `WindowOptions.tabHeader` from the prior design were never built and are not introduced.)

---

## Verification

- **Phase-1 regression is critical** — after Phase 1, an ordinary `Window` (all 12 `MiscPanel` sites) must be byte-for-byte behaviourally identical: move (header drag), resize (all 8 borders), minimize/maximize/restore, double-click-maximize, snap-resize (Ctrl), Shift-drag re-dock onto a strip, close, serialization round-trip. Any divergence is a Phase-1 bug.
- **Typecheck** — `tsc -p tsconfig.lib.json --noEmit` → 0 errors after each phase.
- **Grep invariants** — `grep -rn 'instanceof Window\b' src` → 0 (all `AbstractWindow`); `grep -rn 'getHeader().getText()' src` → 0; `grep -rn 'setTearOffStripBody\|isTearOffStripBody' src` → 0; `grep -rn 'new Window(' src/typescript/lib` → only `LayoutSerialization.ts:455`; `grep -n '_header' src/typescript/lib/core/AbstractWindow.ts` → 0 (no stranded header deref in the base — B2); `grep -rn 'tabselect\|tabsetchanged' src` → 0 (no event widening); `grep -n 'win.setCloseable' src/typescript/lib/layout/Tab.ts` → 1 (the push is retained).
- **Close-when-empty for a torn-off `TabWindow` (B1)** — tear a tab into a strip `TabWindow`, then empty it (drag its last tab back to the source strip, or close that tab): the float **auto-closes**. Before the B1 walk fix this is a no-op; confirm it now fires (the `hostWindow()` inclusive walk resolves the `TabWindow` as its own `Tab`'s container).
- **Closeable reflects into the close tool (B1)** — in a strip `TabWindow`, dock a **non-closeable** tab: `Tab.syncHostWindowCloseable` recomputes every-tab-closeable, the B1 walk reaches the `TabWindow`, `setCloseable(false)` runs `reflectCloseable` → the close tool greys **and** window close is disabled, in **one** write; remove the non-closeable tab → close tool re-enables. No double write.
- **Title derives from the active tab** — serialize a strip `TabWindow` (or inspect `win.getTitle()`): it returns the active tab's label (honouring a `constraints.name` override that differs from `getName()`), read live with no cached title. Switching the active tab and re-reading `getTitle()` returns the new active label.
- **Move-gesture-survives-render** — drag the empty bar area of a fresh strip tear-off on the **very first** interaction (proves `_moveTriggerTeardown` is not swept by the deferred first-render `installTabDnD`); then toggle reorder off/on and drag again (proves it survives `teardownTabDnD`).
- **Docs build** — `npm run docs:build` → 0 errors, 0 new link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- **Runtime smoke on `TabDemoPanel`** (its first `TabPanel` is strip-mode, `reorderable:true`; scope DevTools queries to `.TabDemoPanel .TabPanel` per MEMORY):
  1. Tear a tab off → the float (`TabWindow`) shows **one** bar (tab label + min/max/close), no header, no second toolbar, no flash.
  2. Drag the empty bar area → window moves; release inside the viewport keeps it on-screen.
  3. Drag the tab back onto the source strip → re-docks; the emptied float auto-closes.
  4. Min / max / close on the bar → each performs the matching window action; resize from all 8 borders works.
  5. Dock a **second** tab → two-tab strip, controls pinned trailing; the bar shows both tab labels (the "title" is whichever tab is active — there is no separate title strip on a `TabWindow`).
  6. Dock a **non-closeable** tab → close tool greys **and** window close disabled (one write, via the `Tab` push); remove it → re-enables.
  7. Serialize the layout → the saved node's title equals the active tab's label (`win.getTitle()`); restore rebuilds a header `Window` (round-trip is acceptable, see Non-Goals).
  8. The bare-mode tear-off and an ordinary `new Window(...)` are unchanged (full `WindowHeader`, Shift/Ctrl-drag re-dock + dblclick-maximize intact).

---

## Documentation Impact

- **`TabWindow`** is a public exported concrete component (sibling to `Window`): barrel export from [core/index.ts](../src/typescript/lib/core/index.ts); new `docs/components/TabWindow.md` modelled on `docs/components/Window.md`; list it in `docs/components/index.md`; add a sidebar entry in [docs/.vitepress/config.mts](../docs/.vitepress/config.mts) near `Window` ([L58](../docs/.vitepress/config.mts#L58)).
- **`AbstractWindow`** is an exported abstract base. Per the precedent that abstract bases (e.g. `AbstractListComponent`) get API coverage, give it a `docs/core/AbstractWindow.md` *or* a clearly-labelled "Base class" section on the `Window` page; it surfaces on the API site automatically once barrelled. Document that `Window` and `TabWindow` both extend it.
- **`docs/components/Window.md`** — note the new `AbstractWindow` base; document the **removal** of `setTearOffStripBody`/`isTearOffStripBody` (public-surface removal). `getHeader()` is unchanged (still `WindowHeader`).
- **`docs/layouts/Tab.md`** — update the Tear-off & re-dock section: a strip-mode tear-off now opens a `TabWindow` whose tab bar *is* the title bar (no separate header), the title derives from the active tab's label, the empty bar area moves the window, and min/max/close sit as trailing controls honouring the non-closeable contract.
- `startMoveFrom` / `toggleMinimize` / `toggleMaximize` (now public on the base) and `getOpenWindows(): AbstractWindow[]` surface automatically; JSDoc all new/widened methods. `TabBar.installMoveTrigger` and `Tab.installBarMoveTrigger` are imperative seams — JSDoc them; they appear on those API pages.
- **`Tab.getActiveTabLabel(): string | null`** is a net-new public read accessor — JSDoc it; it surfaces on the `Tab` API page automatically. The `Tab` event union is **unchanged** (`"tabclose"`/`"empty"` only) — no new event docs. Note on `docs/layouts/Tab.md` that a strip-mode tear-off `TabWindow` reads its title from `getActiveTabLabel()`.
- Cross-bucket JSDoc references use markdown links, not `{@link}`, per `_shared/docs-conventions.md`.

---

## Potential Challenges

- **Phase 1 must not change `Window` behaviour** — the refactor is the primary risk; mitigation: move members verbatim, keep `_header` non-null, and run the full Phase-1 regression before Phase 2.
- **Late-dispatch ordering** — reflect-hooks and the min-seed run against subclass chrome; mitigation: the `initChrome()` pattern, called by each subclass *after* its chrome exists (avoids the class-field super-cascade trap, MEMORY).
- **State-vs-reflection split for closeable / active** — easy to put the `_options` write and the UI paint in the wrong class; mitigation: the base `setCloseable`/`setMinimizable`/`setMaximizable` own the `_options` write + predicate and call a `reflect*` hook for the paint; `getTitle()` is read-only (no write to misplace), per the assignment table.
- **Move-vs-tab-vs-button press arbitration** — a press on the bar must resolve to exactly one gesture; mitigation: the `installMoveTrigger` veto tests containment against `entry.wrapper`/`_toolGroup`/`_tabClip` (the same neighbourhood the tab-DnD veto uses) and Shift is reserved.
- **Closeable push coverage** — closeable rides the existing `syncHostWindowCloseable` push, which runs from `createTab`/`_onBarTabClose`/`removeEntryKeepingContent` but **not** `addLazyTab`; mitigation: strip tear-offs build content via `createTab`, never `addLazyTab` (B), so the gap is not load-bearing; lazy strips are explicitly out of scope. No emit points to miss since no events are added.
- **`hostWindow()` start-point regression (B1)** — moving the walk start to `getContainer()` must not break the legacy nested topology; mitigation: the walk is still `_closeHostWindowWhenEmpty`-gated and the loop unchanged, so a `Tab`-in-a-`Panel`-in-a-`Window` still ascends to the `Window`; only the first node checked changes (now inclusive), which is strictly more permissive.
- **`Tab.installBarMoveTrigger` is the only `Tab`→bar imperative seam used cross-class** — keep `TabBar`'s internals private behind the one method.

---

## Critical Files

- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — the source of the split: constructor header build/wire ([L240–296](../src/typescript/lib/core/Window.ts#L240)), `_header`/`_borderComponents` fields ([L142](../src/typescript/lib/core/Window.ts#L142)), `render` border append ([L1580](../src/typescript/lib/core/Window.ts#L1580)), `doLayout` border positioning ([L1497](../src/typescript/lib/core/Window.ts#L1497)), `onMouseDown` ([L1097](../src/typescript/lib/core/Window.ts#L1097)), `setWindowState`/`toggle*` ([L743](../src/typescript/lib/core/Window.ts#L743)/[L824](../src/typescript/lib/core/Window.ts#L824)/[L840](../src/typescript/lib/core/Window.ts#L840)), closeable/min/max ([L899](../src/typescript/lib/core/Window.ts#L899)/[L922](../src/typescript/lib/core/Window.ts#L922)/[L945](../src/typescript/lib/core/Window.ts#L945)), `onActivate`/`setActive` ([L554](../src/typescript/lib/core/Window.ts#L554)), `getHeader`/`setHeaderText` ([L349](../src/typescript/lib/core/Window.ts#L349)/[L656](../src/typescript/lib/core/Window.ts#L656)), the Shift re-dock source ([L255–268](../src/typescript/lib/core/Window.ts#L255), [L1149–1199](../src/typescript/lib/core/Window.ts#L1149)), `setTearOffStripBody`/`isTearOffStripBody` ([L1208](../src/typescript/lib/core/Window.ts#L1208)/[L1217](../src/typescript/lib/core/Window.ts#L1217)), `WindowCallable` export ([L1951](../src/typescript/lib/core/Window.ts#L1951)).
- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `hostWindow`/`closeHostWindowIfEmpty`/`syncHostWindowCloseable` ([L1611](../src/typescript/lib/layout/Tab.ts#L1611)/[L1629](../src/typescript/lib/layout/Tab.ts#L1629)/[L1643](../src/typescript/lib/layout/Tab.ts#L1643)), `detachTabToWindow` ([L1547](../src/typescript/lib/layout/Tab.ts#L1547)), `fillWindowWithStrip` ([L1583](../src/typescript/lib/layout/Tab.ts#L1583)), `createTab`/sync ([L1071](../src/typescript/lib/layout/Tab.ts#L1071)/[L1089](../src/typescript/lib/layout/Tab.ts#L1089)), `removeEntryKeepingContent`/sync ([L1512](../src/typescript/lib/layout/Tab.ts#L1512)/[L1526](../src/typescript/lib/layout/Tab.ts#L1526)), `_onBarTabPressed`/`_onBarTabClose`/`_onBarReordered` ([L775](../src/typescript/lib/layout/Tab.ts#L775)/[L822](../src/typescript/lib/layout/Tab.ts#L822)/[L799](../src/typescript/lib/layout/Tab.ts#L799)), `_closeHostWindowWhenEmpty` ([L280](../src/typescript/lib/layout/Tab.ts#L280)), `addTool` forwarding ([L687](../src/typescript/lib/layout/Tab.ts#L687)), `getActiveTabLabel` (NET-NEW; forwards to `_bar.getActiveEntryId`/`getEntryName`).
- [`src/typescript/lib/component/container/TabBar.ts`](../src/typescript/lib/component/container/TabBar.ts) — `addTool` ([L1014](../src/typescript/lib/component/container/TabBar.ts#L1014)), `_toolGroup`/`_tabClip` (private), `_dndTeardowns` ([L463](../src/typescript/lib/component/container/TabBar.ts#L463)), `installTabDnD`/`teardownTabDnD` ([L2403](../src/typescript/lib/component/container/TabBar.ts#L2403)/[L2689](../src/typescript/lib/component/container/TabBar.ts#L2689)), `dispose` ([L650](../src/typescript/lib/component/container/TabBar.ts#L650)), deferred first-render install ([L637](../src/typescript/lib/component/container/TabBar.ts#L637)), `getEntryIds` ([L1050](../src/typescript/lib/component/container/TabBar.ts#L1050)), `getActiveEntryId` ([L1059](../src/typescript/lib/component/container/TabBar.ts#L1059)), `isEntryCloseable` ([L1071](../src/typescript/lib/component/container/TabBar.ts#L1071)), `getEntryName` ([L1082](../src/typescript/lib/component/container/TabBar.ts#L1082)), `toolGroupMainExtent` ([L1819](../src/typescript/lib/component/container/TabBar.ts#L1819)), `callable` export ([L2786](../src/typescript/lib/component/container/TabBar.ts#L2786)).
- [`src/typescript/lib/component/container/WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts) — unchanged; the control-button glyphs/options `TabWindow` mirrors ([L89–91](../src/typescript/lib/component/container/WindowHeader.ts#L89)) and `getMinContentWidth` ([L356](../src/typescript/lib/component/container/WindowHeader.ts#L356)).
- [`src/typescript/lib/layout/LayoutSerialization.ts`](../src/typescript/lib/layout/LayoutSerialization.ts) — `windowContentOf`/`windowNodeFor`/`parkLeaves` ([L218](../src/typescript/lib/layout/LayoutSerialization.ts#L218)/[L229](../src/typescript/lib/layout/LayoutSerialization.ts#L229)/[L303](../src/typescript/lib/layout/LayoutSerialization.ts#L303)), the title read ([L239](../src/typescript/lib/layout/LayoutSerialization.ts#L239)), restore `new Window` ([L455](../src/typescript/lib/layout/LayoutSerialization.ts#L455)).
- [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts) — the `core` barrel ([L21](../src/typescript/lib/core/index.ts#L21)).

---

## Non-Goals

- **Bare mode** (`detachWindowMode:"bare"`) — content fills the body with no inner strip; its full `WindowHeader` and Shift-drag re-dock stay exactly as shipped.
- **Ordinary `Window` styling / behaviour** — non-tear-off windows are untouched; Phase 1 is a behaviour-preserving refactor.
- **Serialization restore of strip `TabWindow`s as `TabWindow`s** — `LayoutSerialization` restore rebuilds a header `Window` ([L455](../src/typescript/lib/layout/LayoutSerialization.ts#L455)); round-tripping a torn-off strip window back to a header window is acceptable. Restoring it as a `TabWindow` is out of scope.
- **A `TabWindowHeader extends TabBar` component / `WindowChrome` interface / headless `Tab` mode / `WindowOptions.tabHeader`** — the prior design; explicitly not built.
- **`Tab` event widening (`"tabselect"`/`"tabsetchanged"`)** — not added; closeable rides the existing `syncHostWindowCloseable` push and title is read live via `getActiveTabLabel()`, so no observation channel is needed (see `### No new `Tab` events …`).
- **Double-click-maximize on a `TabWindow`** — the header dblclick gesture stays `Window`-only; a `TabWindow` maximizes via its maximize control tool (C). A future `dblclick` companion to `installMoveTrigger` could add it.
- **`addLazyTab` closeable sync** — `addLazyTab` is a fourth set-mutation path that calls no closeable sync today; strip tear-offs never use it, so it is left untouched (B). Wiring it is out of scope.
- **New theme tokens** — `TabWindow` reuses the existing tab-toolbar and titlebar-button tokens.
- **`Dock` integration** — out of scope; this plan delivers the merged-bar strip tear-off only.
