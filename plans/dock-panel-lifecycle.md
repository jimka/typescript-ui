# Dock Panel Lifecycle — Implementation Plan

## Overview

`Dock` ([overlay/Dock.ts:94](../src/typescript/lib/overlay/Dock.ts#L94)) registers panels via `addPanel(spec)` ([Dock.ts:184](../src/typescript/lib/overlay/Dock.ts#L184)) and serialises/restores arrangements via `getLayoutState`/`setLayoutState` ([Dock.ts:214](../src/typescript/lib/overlay/Dock.ts#L214), [Dock.ts:227](../src/typescript/lib/overlay/Dock.ts#L227)), but offers **no** app-facing hook for the panel *lifecycle*. A consumer cannot learn when a panel is closed (to dispose resources), torn off, re-docked, or focused; cannot programmatically focus an open panel; and cannot programmatically remove one. This plan adds a full, four-event panel lifecycle plus two control methods, additively, and makes the lifecycle correct across **all three** ways a Dock hosts a panel: tiled `Tab` regions, structural `Split` containers, and floating `Window`s.

A panel is always in one of three states:

- **docked** — a tab in the in-dock tiled `Split`/`Tab` tree (`getRootRegion`);
- **floating** — in a tear-off `Window`: either a self-contained [`TabWindow`](../src/typescript/lib/overlay/TabWindow.ts#L60) (the default strip-mode tear-off, *not* adopted by the sweep — [Dock.ts:485-492](../src/typescript/lib/overlay/Dock.ts#L485)), or a Shift-torn bare [`Window`](../src/typescript/lib/overlay/Window.ts#L42) the sweep adopts into a mini-dock ([Dock.ts:540](../src/typescript/lib/overlay/Dock.ts#L540));
- **gone** — destroyed.

The four events name the transitions between these states:

1. **`attach`** (`{ id, content }`) — a panel enters the in-dock tiled tree (`addPanel`, or re-dock from a float).
2. **`detach`** (`{ id, content }`) — a panel leaves the tiled tree but stays alive (tear-off to a float).
3. **`focus`** (`{ id, content } | null`) — the dock-wide active panel changes, across tiled tabs **and** floats; `null` when nothing is focused (e.g. the last panel closed).
4. **`close`** (`{ id, content }`) — a panel is genuinely destroyed (tiled tab ✕, `removePanel`, or a host float window's chrome ✕).

Plus two control methods — **`focusPanel(id): boolean`** (activates the host tab / raises the host float; a success naturally produces a `focus`) and **`removePanel(id): boolean`** (programmatic close → `close`).

The motivating consumer is the planned SQLAdmin app ([plans/tsui-sql-admin.md](../plans/tsui-sql-admin.md)): `SqlAdminController` must dispose a table's store on `close`, and `if (dock.focusPanel(id)) return;` to dedup re-opens. `Dock` and `Tab` are both public API ([overlay/index.ts:24](../src/typescript/lib/overlay/index.ts#L24), [layout/index.ts:18](../src/typescript/lib/layout/index.ts#L18)), so the new types are re-exported and the curated docs are updated.

The event-typing follows the project's `ListenerBag` + overloaded `on`/`off`/`emit` shape used by [`Tab`](../src/typescript/lib/layout/Tab.ts#L1892) and [`AbstractWindow`](../src/typescript/lib/overlay/AbstractWindow.ts#L1162). `Dock` does not yet own a `ListenerBag` — this plan adds its first one.

---

## Architecture Decisions

### A four-event lifecycle, sourced from the existing structural events plus two minimal new ones

The lifecycle is `attach` / `detach` / `focus` / `close`. Three of the four transitions already have a structural event the dock can hook; the rest need new, minimal emits:

| Dock event | Source | New? |
|---|---|---|
| `attach` | `Dock.addPanel` (existing) + re-dock detection in the sweep | new dock-side derivation |
| `detach` | each tiled `Tab` region's existing `"detached"` ([Tab.ts:1757](../src/typescript/lib/layout/Tab.ts#L1757), already wired [Dock.ts:588](../src/typescript/lib/overlay/Dock.ts#L588)) | reuses existing Tab event |
| `focus` (tiled) | a **new** `Tab` `"activated"` event emitted in `_onBarTabPressed` ([Tab.ts:873](../src/typescript/lib/layout/Tab.ts#L873)) | **new Tab event** |
| `focus` (float) | a **new** `AbstractWindow` `"activate"` event emitted in `onActivate(true)` ([AbstractWindow.ts:750](../src/typescript/lib/overlay/AbstractWindow.ts#L750)) | **new Window event** |
| `close` (tiled) | each `Tab` region's existing `"tabclose"` ([Tab.ts:944](../src/typescript/lib/layout/Tab.ts#L944)) | reuses existing Tab event |
| `close` (float chrome ✕) | each owned float `Window`'s existing `"close"` event ([AbstractWindow.ts:822](../src/typescript/lib/overlay/AbstractWindow.ts#L822)) | reuses existing Window event |

`removePanel` reuses the tiled close path through a new public `Tab.closeTab`, so it produces `close` through the same `"tabclose"` subscription as a user ✕ (no second emit).

### `attach` — entering the tiled tree, and only that

`attach` fires when a panel becomes a leaf of the in-dock tiled tree (`getRootRegion`):

- **`addPanel(spec)`** — after the existing `activeTabRegion().moveComponent(content, …)` ([Dock.ts:190](../src/typescript/lib/overlay/Dock.ts#L190)). Direct, synchronous; emitted at the call site, not derived.
- **Re-dock from a float back into the tiled tree** — a panel dragged from a float mini-dock / `TabWindow` onto an in-dock strip. There is no single event for this; the dock derives it in the sweep by diffing which registered frames are reachable from `getRootRegion` versus were last seen in a float. The sweep already walks both trees (`runSweep` / `teardownVanished` — [Dock.ts:451](../src/typescript/lib/overlay/Dock.ts#L451), [Dock.ts:693](../src/typescript/lib/overlay/Dock.ts#L693)); this plan adds a small per-frame location ledger (`_panelLocation: Map<string, "docked" | "floating">`) updated each sweep, emitting `attach` on a `floating → docked` transition.

`attach` does **NOT** fire for internal moves *within* the tiled tree — dragging a panel between `Split` panes or between two in-dock `Tab` regions. The panel never left the tiled tree, so its location ledger stays `"docked"` and the diff is silent. This is the central reason `attach` is sourced from the *location diff*, not from `moveComponent` or the regions' drop callbacks (which fire for every internal move too).

### `detach` — leaving the tiled tree but staying alive

`detach` fires on tear-off: a panel leaves the tiled tree into a float `Window`. The hook is each tiled `Tab` region's existing `"detached"` event, already subscribed in `wireRegion`'s `tabWired` guard ([Dock.ts:588](../src/typescript/lib/overlay/Dock.ts#L588)) — currently only scheduling a sweep. The handler additionally resolves the torn-off frame, flips its location ledger to `"floating"`, and emits `detach` with `{ id, content }`.

`Tab` emits `"detached"` from the tear-off path only ([Tab.ts:1757](../src/typescript/lib/layout/Tab.ts#L1757)), after `removeEntryKeepingContent` ([Tab.ts:1677](../src/typescript/lib/layout/Tab.ts#L1677)) — which deliberately omits the `"tabclose"` emit ("the tab is relocated, not closed" — [Tab.ts:1671-1673](../src/typescript/lib/layout/Tab.ts#L1671)). So `detach` and `close` are mutually exclusive: a tear-off fires `detach`, never `close`. The `"detached"` payload is the new float `Window`, which holds the torn-off frame; the handler reads the frame's id from that subtree (or, more simply, resolves it from the just-detached cell — see Internal Structure).

Tearing a tab out of an *existing* float (a `TabWindow` or an adopted mini-dock) into another float keeps the panel in the **floating** state: the `_panelLocation` flip to `"floating"` is idempotent and harmless (it was already `"floating"`), and no spurious `attach`/`detach` results because the panel never reached the tiled tree. `detach`'s primary contract is the tiled-tree → float transition; float-to-float re-tears are simply re-entrant on an already-floating panel.

### `focus` — one nullable event, no `blur`

`focus` is the single source of truth for "which panel is active dock-wide", spanning tiled tabs and both float kinds. Its payload is `{ id, content } | null`. There is deliberately **no** `blur` event: a consumer derives blur from the transition (the previously-focused panel is whatever the last non-null `focus` named), and the nullable payload covers "nothing focused now" (last panel closed, all panels torn into background floats deactivated, etc.). A second event would be redundant state the consumer must reconcile.

`focus` is sourced from **two new structural events** plus the dock's own close handling:

- **Tiled tab switch** → a **new `Tab` `"activated"` event**. `Tab` has no active-tab-change event today; `setActiveTabIndex` ([Tab.ts:1616](../src/typescript/lib/layout/Tab.ts#L1616)) drives selection through `TabBar.setActiveEntry`, which already emits the bar's `"tabpressed"`, handled by the private `_onBarTabPressed` ([Tab.ts:873](../src/typescript/lib/layout/Tab.ts#L873)). This plan emits the new `Tab` `"activated"` event from the **end of `_onBarTabPressed`**, so it fires for **both** a user tab-click (bar `"tabpressed"` → `_onBarTabPressed`) and a programmatic `setActiveTabIndex` (→ `setActiveEntry` → `"tabpressed"` → `_onBarTabPressed`). One emit site covers both. (Note: `selectNextContent`'s post-close re-selection uses `TabBar.setActiveVisual` ([TabBar.ts:1567](../src/typescript/lib/component/container/TabBar.ts#L1567)), which intentionally does **not** emit `"tabpressed"`; the dock handles the post-close focus shift itself — see `close` below — so this is correct, not a gap.)
- **Float raise/activation** → a **new `AbstractWindow` `"activate"` event**, emitted from `onActivate(true)` ([AbstractWindow.ts:750](../src/typescript/lib/overlay/AbstractWindow.ts#L750)) — the manager-driven hook called when a window becomes the active layer ([LayerManager.ts:385-386](../src/typescript/lib/core/LayerManager.ts#L385)). The dock subscribes to each owned float's `"activate"` and emits `focus` with that float's active panel. For an adopted bare-`Window` mini-dock the active panel is its inner `Tab`'s active tab; for a `TabWindow` it is the window's active tab (read via the window's `Tab`). The dock resolves "which registered frame is active in this float" from the float's content region.

The dock keeps a single `_focusedPanelId: string | null` and emits `focus` only on a genuine change, so re-activating the already-focused panel is silent and there is no thrash.

Because the new `"activated"` event fires from `_onBarTabPressed`, it also fires for the two other callers of `setActiveTabIndex` that route through `_onBarTabPressed`: `dockComponent` ([Tab.ts:1665](../src/typescript/lib/layout/Tab.ts#L1665)), called on a drag/re-dock, and `restoreLayout`, called on `setLayoutState`. So a re-dock from a float and a layout restore both produce a `focus` for the now-active panel **in addition** to whatever `attach` the re-dock derives. This is **intentional**: re-docking and restoring genuinely change the active panel, and the `_focusedPanelId` guard still suppresses a redundant emit when the restored/re-docked panel was already the focused one.

### `close` — terminal, across tiled tabs and both float kinds

`close` fires when a registered panel is genuinely destroyed. It is **terminal** and never also fires `detach`. Three sources:

- **Tiled tab ✕** — each tiled `Tab` region's existing `"tabclose"` ([Tab.ts:944](../src/typescript/lib/layout/Tab.ts#L944)), wired in the `tabWired` guard. `Tab` emits it only from the genuine close path (`_onBarTabClose` does `container.removeComponent`).
- **`removePanel(id)`** — routes through the new public `Tab.closeTab` so it lands on the same `"tabclose"` subscription (one emit).
- **Float window chrome ✕** — each owned float `Window`'s existing `"close"` event ([AbstractWindow.ts:822](../src/typescript/lib/overlay/AbstractWindow.ts#L822), emitted in `onExitAction`). When a float that hosts registered frames is closed by its window ✕, the dock emits `close` for **each** registered frame in that float (a bare-`Window` mini-dock can hold several). This covers both float kinds: the sweep subscribes the `"close"` event of every owned float (`ownedFloatWindows` — the adopted bare `Window`s) **and** of every open `TabWindow` holding one of this dock's frames.

  *Re-evaluation of the original plan's punt:* the original plan listed float-window chrome-close as a Non-Goal because it "routes through window teardown, not the tab-close path". That reasoning stands for the *tab* path, but `AbstractWindow` already fires a `"close"` event the dock can subscribe to — so covering it is cheap and the user explicitly wants the lifecycle to span Windows. **Float-window close is now covered**, not deferred.

A panel torn off then closed fires **`detach`** (at tear-off) then **`close`** (when the float closes) — two real transitions, as intended.

When `close` removes the dock-wide focused panel, the dock recomputes focus and emits `focus` for the new active panel, or `focus(null)` when none remains (e.g. the last panel closed). Mechanism: after a `"tabclose"`, the source `Tab` re-selects a sibling through `setActiveVisual` (which emits nothing — [TabBar.ts:1567](../src/typescript/lib/component/container/TabBar.ts#L1567)), so the dock derives the new focused panel itself by reading the host region's now-active tab — `Tab.getActiveTabIndex()` ([Tab.ts:1589](../src/typescript/lib/layout/Tab.ts#L1589)) → its content component → that frame's id — and emits `focus` with the matching `DockPanelEvent`, or `focus(null)` when the region is drained and no panel remains. This is why the post-close `setActiveVisual` re-selection is handled dock-side rather than via the new `"activated"` event.

### `Split` is structural — it generates no panel events

`Split` ([layout/Split.ts:38](../src/typescript/lib/layout/Split.ts#L38)) only ever contains regions (`Tab` stacks or nested `Split`s), never a panel/frame directly — `Dock`'s compiler always wraps a leaf in a `Tab` stack (`compileRegion` / `compileTabs` — [Dock.ts:397](../src/typescript/lib/overlay/Dock.ts#L397), [Dock.ts:413](../src/typescript/lib/overlay/Dock.ts#L413)), and `DockRegion` mints `Tab` stacks for dropped panels. `Split` emits no events and is given none here. Moving a panel across `Split` panes is an internal tiled move and is silent (covered by the `attach` location-diff rule above).

### Two float kinds, one consistent rule

- **Adopted bare `Window` mini-dock** — wrapped by `adoptFloat` ([Dock.ts:540](../src/typescript/lib/overlay/Dock.ts#L540)) into a `Tab` region inside the window. Its panels are **floating** (location ledger `"floating"`): they are in a float, not the primary tiled tree. Closing one of its tabs (it is a wired float region — the sweep's float-wiring loop runs `wireRegion` on each adopted float region, [Dock.ts:464-466](../src/typescript/lib/overlay/Dock.ts#L464); `wireRegion` itself is at [Dock.ts:569](../src/typescript/lib/overlay/Dock.ts#L569)) fires `close` via `"tabclose"`. Closing the window itself fires `close` for each held frame via the window `"close"` subscription. Switching its inner tabs fires `focus` via the new `Tab` `"activated"` event (its inner `Tab` is wired). Raising the window fires `focus` via the new window `"activate"` event.
- **Self-contained `TabWindow`** — the default strip-mode tear-off, *excluded* from sweep adoption ([Dock.ts:489](../src/typescript/lib/overlay/Dock.ts#L489)). Its internal `Tab` is **not** wired by the dock, so the dock must subscribe its events explicitly to keep the lifecycle complete: on adoption-skip the sweep still tracks open `TabWindow`s holding this dock's frames and reaches the inner `Tab` via `tabWindow.getLayoutManager() as Tab` (the `TabWindow` installs it with `setLayoutManager(this._tab)` — [TabWindow.ts:85](../src/typescript/lib/overlay/TabWindow.ts#L85) — exactly the `getLayoutManager() as Tab` idiom `wireRegion` already uses, [Dock.ts:580](../src/typescript/lib/overlay/Dock.ts#L580)), then subscribes that `Tab`'s `"activated"`/`"tabclose"`/`"detached"` and the window's `"activate"`/`"close"`. Its panels are **floating**. This keeps `focus`/`close`/`detach`/`attach` consistent across both kinds.

  *Chosen rule, stated:* panels inside **any** float (either kind) count as `"floating"`; only `getRootRegion`'s tiled tree is `"docked"`. Re-docking from either float kind back into the tiled tree fires `attach`.

### `removePanel` routes through `Tab`'s close path via a new public `Tab.closeTab`

`Tab` has no public programmatic close — only the private `_onBarTabClose` ([Tab.ts:920](../src/typescript/lib/layout/Tab.ts#L920)). To make `removePanel` fire `close` **exactly once** and run identical teardown, this plan adds a thin public **`Tab.closeTab(content: Component): boolean`** that resolves the cell id for `content` and runs the same body `_onBarTabClose` runs (extracted to a private `closeEntry(id)` both call), so there is one teardown implementation and the dock's `"tabclose"` subscription fires for it naturally. `removePanel(id)` resolves the frame, finds its host `Tab` region (tiled or float), calls `region.getLayoutManager().closeTab(frame)`, returns `true`; `false` for an unknown id or a frame in no wired region.

### `focusPanel` builds on `Tab.setActiveTabIndex` + `AbstractWindow.bringToFront`

`focusPanel(id)` resolves the frame, finds its host `Tab` region and the frame's index, and calls `setActiveTabIndex(index)` ([Tab.ts:1616](../src/typescript/lib/layout/Tab.ts#L1616)) — which drives the full selection sync and (via the new `"activated"` event) produces a `focus`. When the frame lives in a float, it additionally calls the host float's `bringToFront()` ([AbstractWindow.ts:710](../src/typescript/lib/overlay/AbstractWindow.ts#L710)) so a buried float surfaces (mirroring `_onBarDockRequested`'s `hostWindow()?.bringToFront()` — [Tab.ts:973](../src/typescript/lib/layout/Tab.ts#L973)); the raise drives `onActivate(true)` → the new `"activate"` event → `focus`. Returns `true` when found and activated, `false` for an unknown id or one in no `Tab` region (registered but never docked).

### `ListenerBag` wiring obeys the `super()`-cascade rule

`Dock` gains `private _listeners: ListenerBag<DockEvent> = new ListenerBag<DockEvent>();`. Per [ARCHITECTURE.md](../ARCHITECTURE.md) (Event handling) and [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md) (super()-cascade fields), a `ListenerBag` needs a real instance and is **not** dispatched from `applyOptions`. `Dock` exposes no construction-time `listeners` option (no `DockEvent` is a build-time primary gesture; `addPanel`/`compileLayout` run after `super()`), so no `applyListeners` call is added — consumers wire post-construction with `dock.on(...)`. The field initialiser is safe because no cascade-dispatched setter touches it. The new `Tab` `"activated"` and `AbstractWindow` `"activate"` events reuse those classes' **existing** `ListenerBag`s ([Tab.ts:259](../src/typescript/lib/layout/Tab.ts#L259), [AbstractWindow.ts:236](../src/typescript/lib/overlay/AbstractWindow.ts#L236)) — only their `TabEvent`/`WindowEvent` unions and `on`/`emit` overloads grow.

### Region/float resolution helpers

`focusPanel`/`removePanel`/the float subscriptions all need *the `Tab` region (and host float, if any) currently hosting a given frame* — lookups `Dock` lacks (`firstTabRegion` finds the first `Tab`, not one holding a specific frame). This plan adds private helpers that walk the combined live set the sweep already derives (`getRootRegion` + `ownedFloatWindows`/`adoptFloat`, plus tracked `TabWindow`s): `regionForFrame(frame): Component | null` and `floatForFrame(frame): AbstractWindow | null`.

---

## Public API (TypeScript Signatures)

```typescript
// overlay/Dock.ts

/**
 * String-literal union of the events a {@link Dock} emits across a panel's
 * lifecycle. See {@link DockPanelEvent} for the payload shape.
 *
 * @category Core
 */
export type DockEvent = "attach" | "detach" | "focus" | "close";

/**
 * Payload for a {@link Dock} lifecycle event, identifying the panel by its
 * stable {@link DockPanelSpec.id} and carrying its Dock-owned identity frame.
 *
 * @category Core
 */
export interface DockPanelEvent {
    /** The stable id of the panel (its {@link DockPanelSpec.id}). */
    id:      string;
    /** The panel's Dock-owned identity frame. */
    content: Component;
}

class Dock extends Container<DockOptions> {
    // — attach / detach / close: always carry a panel —
    on(event: "attach" | "detach" | "close", listener: (event: DockPanelEvent) => void): this;
    off(event: "attach" | "detach" | "close", listener: (event: DockPanelEvent) => void): this;
    // — focus: nullable payload (null when nothing is focused) —
    on(event: "focus", listener: (event: DockPanelEvent | null) => void): this;
    off(event: "focus", listener: (event: DockPanelEvent | null) => void): this;

    protected emit(event: "attach" | "detach" | "close", payload: DockPanelEvent): void;
    protected emit(event: "focus", payload: DockPanelEvent | null): void;

    /** Activates the tab/raises the float hosting `id`; returns whether found. */
    focusPanel(id: string): boolean;
    /** Closes the panel `id` through the user-close path (fires `close`). */
    removePanel(id: string): boolean;

    // — new private helpers —
    private regionForFrame(frame: Component): Component | null;
    private floatForFrame(frame: Component): AbstractWindow | null;
}
```

```typescript
// layout/Tab.ts — grows the existing union + overloads

export type TabEvent = "tabclose" | "empty" | "detached" | "activated";

class Tab extends LayoutManager<TabOptions> {
    /**
     * Closes the tab hosting `content` through the same teardown a user ✕ click
     * performs (removes cell + content, emits `"tabclose"`, selects next, emits
     * `"empty"` when drained).
     *
     * @returns `true` when a matching tab was closed, `false` when none matched.
     */
    closeTab(content: Component): boolean;

    // "activated" fires when the active tab changes via click or setActiveTabIndex,
    // carrying the now-active content and its index. Does NOT fire on the
    // post-close re-selection (which uses setActiveVisual).
    on(event: "activated", listener: (content: Component, index: number) => void): this;
    protected emit(event: "activated", content: Component, index: number): void;
}
```

```typescript
// overlay/AbstractWindow.ts — grows the existing union + overloads

export type WindowEvent = "minimize" | "restore" | "close" | "activate";

// "activate" fires from onActivate(true) when the window becomes the active
// layer (raise / focus). Zero-payload, matching the existing WindowEvent shape.
on(event: WindowEvent, listener: () => void): this;     // unchanged signature
protected emit(event: WindowEvent): void;               // unchanged signature
```

`Tab.closeTab` and the private `closeEntry(id)` add no event beyond the new `"activated"`. `DockEvent`/`DockPanelEvent` are re-exported from [overlay/index.ts](../src/typescript/lib/overlay/index.ts); the grown `TabEvent`/`WindowEvent` are already re-exported.

---

## Internal Structure

**Dock state additions:**

```typescript
private _listeners:      ListenerBag<DockEvent> = new ListenerBag<DockEvent>();
private _focusedPanelId: string | null = null;
// panelId -> last-observed location; the source of the attach/detach diff.
private _panelLocation:  Map<string, "docked" | "floating"> = new Map();
```

**`Tab` close-path extraction (one teardown, two entry points):**

```typescript
private _onBarTabClose = (id: string): void => { this.closeEntry(id); };

closeTab(content: Component): boolean {
    const entry = this._contents.find(e => e.component === content);
    if (!entry) { return false; }
    this.closeEntry(entry.id);
    return true;
}
// closeEntry holds the former _onBarTabClose body verbatim (idx → wasSelected/content →
// removeBarEntry → splice → removeComponent → emit("tabclose") → selectNextContent →
// scheduleLayout → syncHostWindowCloseable → closeHostWindowIfEmpty → emit("empty")).
```

**`Tab` activation emit (new), at the end of `_onBarTabPressed`:**

```typescript
private _onBarTabPressed = (id: string): void => {
    const idx = this._contents.findIndex(entry => entry.id === id);
    if (idx >= 0) {
        this._selectedTabIndex = idx;
        const entry = this._contents[idx];
        if (entry.state === "lazy") { this.materializeAsync(idx); }
        this.emit("activated", entry.component, idx);   // NEW
    }
    this.getContainer()?.scheduleLayout();
};
```

**`AbstractWindow` activation emit (new), in `onActivate`:**

```typescript
onActivate(active: boolean): void {
    this.paintActive(active);
    if (active) {
        this.focusSelf();
        this.emit("activate");   // NEW
    }
}
```

**Dock wiring** — each region's `"activated"`/`"tabclose"` joined to the existing `"empty"`/`"detached"` subscriptions in the `tabWired` guard ([Dock.ts:580-590](../src/typescript/lib/overlay/Dock.ts#L580)); each owned float's `"activate"`/`"close"` subscribed in the sweep (tracked so re-sweeps don't re-subscribe — same one-shot discipline as `tabWired`, per the "Re-wiring stacks duplicate listeners" memory note). `attach`/re-dock derived from `_panelLocation` diff after wiring, inside `runSweep`. `removePanel`/`close` evict the cached frame from `_frames` (so a re-`addPanel` rebuilds via the lazy factory) while keeping the `_panels` registration.

---

## Ordered Implementation Steps

1. **`Tab.closeTab` + `closeEntry` extraction** ([layout/Tab.ts:920-955](../src/typescript/lib/layout/Tab.ts#L920)): extract `_onBarTabClose`'s body into private `closeEntry(id)`; make `_onBarTabClose` delegate; add public `closeTab(content): boolean`. → verify: existing Tab tests + a `closeTab` unit test pass; `_onBarTabClose` behaviour byte-identical.
2. **`Tab` `"activated"` event** ([Tab.ts:34](../src/typescript/lib/layout/Tab.ts#L34), [Tab.ts:1867-1925](../src/typescript/lib/layout/Tab.ts#L1867)): add `"activated"` to `TabEvent`; add `on`/`emit` overloads with JSDoc; emit at the end of `_onBarTabPressed` ([Tab.ts:873](../src/typescript/lib/layout/Tab.ts#L873)). → verify: switching/`setActiveTabIndex` fires once; `setActiveVisual` (post-close) does not.
3. **`AbstractWindow` `"activate"` event** ([AbstractWindow.ts:67](../src/typescript/lib/overlay/AbstractWindow.ts#L67), [AbstractWindow.ts:750](../src/typescript/lib/overlay/AbstractWindow.ts#L750), [AbstractWindow.ts:1162](../src/typescript/lib/overlay/AbstractWindow.ts#L1162)): add `"activate"` to `WindowEvent`; emit in `onActivate(true)` after `focusSelf()`; extend the `on`/`off` JSDoc to mention it. → verify: a `bringToFront` fires `"activate"` once.
4. **`DockEvent` + `DockPanelEvent` types** ([overlay/Dock.ts](../src/typescript/lib/overlay/Dock.ts)): add union + payload interface, `@category Core`, near `DockOptions`.
5. **`Dock` `ListenerBag` + `_focusedPanelId` + `_panelLocation` + `on`/`off`/`emit`** ([Dock.ts](../src/typescript/lib/overlay/Dock.ts)): import `ListenerBag`; add the three fields and the overloaded forwarders mirroring `Tab`/`AbstractWindow`. → verify: typecheck.
6. **Wire tiled `"activated"`/`"tabclose"`** ([Dock.ts:580-590](../src/typescript/lib/overlay/Dock.ts#L580)): inside the `tabWired` guard add `"tabclose"` → `onPanelClosed` and `"activated"` → `onPanelFocused`. Per [ARCHITECTURE.md](../ARCHITECTURE.md) (no inline-arrow listeners), all new subscriptions reference **named handler methods** (`onPanelClosed`/`onPanelFocused`, and below `onPanelDetached`), never arrows. Convert the two pre-existing inline arrows in this guard in passing — `.on("empty", () => this.pruneRegion(region))` ([Dock.ts:582](../src/typescript/lib/overlay/Dock.ts#L582)) and `.on("detached", () => this.scheduleSweep())` ([Dock.ts:588](../src/typescript/lib/overlay/Dock.ts#L588)) — to named handlers (in-scope since this line is already being edited).
7. **`detach` on `"detached"`** ([Dock.ts:588](../src/typescript/lib/overlay/Dock.ts#L588)): replace the inline `() => this.scheduleSweep()` arrow with a named `onPanelDetached` handler that resolves the torn-off frame, flips its `_panelLocation` to `"floating"`, emits `detach`, and still schedules the sweep.
8. **Float subscriptions in the sweep** ([Dock.ts:451-469](../src/typescript/lib/overlay/Dock.ts#L451)): for each owned bare-`Window` float and each open `TabWindow` holding a frame, idempotently subscribe the window's `"activate"`/`"close"` and (for `TabWindow`) its inner `Tab` (`getLayoutManager() as Tab`) `"activated"`/`"tabclose"`/`"detached"` — all to the **named** `onPanel*` handlers, never arrows ([ARCHITECTURE.md](../ARCHITECTURE.md)); track subscribed windows to avoid re-stacking.
9. **`attach` / re-dock diff** ([Dock.ts:451-469](../src/typescript/lib/overlay/Dock.ts#L451)): after wiring, recompute each registered frame's location (`docked` if under `getRootRegion`, else `floating`); emit `attach` on `floating → docked`. Seed the ledger in `addPanel`/`compileTabs` so the first dock counts as `attach`.
10. **`focus` recompute on close** ([Dock.ts](../src/typescript/lib/overlay/Dock.ts)): in `onPanelClosed`/the float-`close` handler, if the closed panel was `_focusedPanelId`, recompute the new dock-wide focused panel by reading the host region's now-active tab — `Tab.getActiveTabIndex()` ([Tab.ts:1589](../src/typescript/lib/layout/Tab.ts#L1589)) → its content → that frame's id — and emit `focus` with that `DockPanelEvent`, or `focus(null)` when the region drained. Guard `onPanelFocused` to emit only on a genuine `_focusedPanelId` change.
11. **`regionForFrame` / `floatForFrame` helpers** ([Dock.ts](../src/typescript/lib/overlay/Dock.ts)): walk root + adopted floats + tracked `TabWindow`s.
12. **`focusPanel(id)`** ([Dock.ts](../src/typescript/lib/overlay/Dock.ts)): resolve frame; `regionForFrame`; `setActiveTabIndex(index)`; `floatForFrame(frame)?.bringToFront()`; return boolean.
13. **`removePanel(id)`** ([Dock.ts](../src/typescript/lib/overlay/Dock.ts)): resolve frame; `regionForFrame`; `(region.getLayoutManager() as Tab).closeTab(frame)`; return boolean. (`close`/frame-eviction via step 6; prune/sweep via existing `"empty"`.)
14. **Barrel re-export** ([overlay/index.ts:25](../src/typescript/lib/overlay/index.ts#L25)): add `DockEvent, DockPanelEvent` to the `export type { … } from '~/overlay/Dock.js';` line. (`TabEvent`/`WindowEvent` already exported — [layout/index.ts:19](../src/typescript/lib/layout/index.ts#L19), [overlay/index.ts:8](../src/typescript/lib/overlay/index.ts#L8).)
15. **JSDoc** on every new method/type/overload per [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md). → verify: `npm run docs:build` (0 errors, 0 link warnings).
16. **Docs pages** ([docs/components/Dock.md](../docs/components/Dock.md)): add a "Panel lifecycle" + "Programmatic control" section. → verify: renders; links resolve.

Regression checkpoints: `grep -n 'emit("tabclose"' src/typescript/lib/layout/Tab.ts` → exactly one (in `closeEntry`); `grep -n 'emit("activated"' src/typescript/lib/layout/Tab.ts` → exactly one (in `_onBarTabPressed`); `grep -n 'emit("activate"' src/typescript/lib/overlay/AbstractWindow.ts` → exactly one (in `onActivate`); `grep -rn 'onClose' src/typescript/lib/overlay/Dock.ts` → zero.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | [src/typescript/lib/overlay/Dock.ts](../src/typescript/lib/overlay/Dock.ts) — `DockEvent`/`DockPanelEvent`, `ListenerBag`/`_focusedPanelId`/`_panelLocation`, `on`/`off`/`emit`, tiled + float wiring, `onPanelClosed`/`onPanelFocused`/`onPanelDetached`, attach diff, `regionForFrame`/`floatForFrame`, `focusPanel`, `removePanel` |
| Modify | [src/typescript/lib/layout/Tab.ts](../src/typescript/lib/layout/Tab.ts) — `closeEntry` extraction + public `closeTab`; `"activated"` event (union, overloads, emit in `_onBarTabPressed`) |
| Modify | [src/typescript/lib/overlay/AbstractWindow.ts](../src/typescript/lib/overlay/AbstractWindow.ts) — `"activate"` event (union, emit in `onActivate`, JSDoc) |
| Modify | [src/typescript/lib/overlay/index.ts](../src/typescript/lib/overlay/index.ts) — re-export `DockEvent`, `DockPanelEvent` |
| Modify | [docs/components/Dock.md](../docs/components/Dock.md) — "Panel lifecycle" + "Programmatic control" sections |
| Create | A Dock unit test under the overlay test tree (offline cases below) |

No deletions. `DockPanelSpec`, `addPanel`'s docking behaviour, layout/tear-off mechanics, serialization, and the demo are unchanged (additive only). `Split.ts` and `TabWindow.ts`/`Window.ts` need no edits — `TabWindow`/`Window` inherit the new `AbstractWindow` `"activate"` event, and the dock reaches a `TabWindow`'s inner `Tab` through the already-public `getLayoutManager()` (set via `setLayoutManager(this._tab)`, [TabWindow.ts:85](../src/typescript/lib/overlay/TabWindow.ts#L85)), so no accessor needs adding there.

---

## Expected Behaviour

Offline-unit-testable (exercise via the Tab/region/window model and `ListenerBag.fire`; no live paint/drag):

1. **`attach` on `addPanel`.** `addPanel(spec)` emits one `attach` `{ id, content }` for the docked frame.
2. **`attach` on re-dock from a float.** Moving a floating frame into the tiled tree and running the sweep emits one `attach` (the ledger flips `floating → docked`) **and** a following `focus` for the re-docked panel — `dockComponent`'s `setActiveTabIndex` ([Tab.ts:1665](../src/typescript/lib/layout/Tab.ts#L1665)) routes through `_onBarTabPressed` → the new `"activated"` → dock `focus` (intentional, see the `focus` decision).
3. **`attach` is silent for an internal tiled move.** Moving a frame between two in-dock `Tab` regions (or `Split` panes) and sweeping emits no `attach` (ledger stays `docked`).
4. **`detach` on tear-off.** Driving a tiled region's `"detached"` for a registered frame emits one `detach` `{ id, content }` and flips the ledger to `floating`; no `close`.
5. **`detach` does not fire on close.** A `"tabclose"` sequence emits `close`, never `detach`.
6. **`focus` on tiled tab switch.** `Tab.setActiveTabIndex` on a wired tiled region emits one `focus` for the now-active panel; re-selecting the same panel is silent.
7. **`focus` on float activation.** A wired float window's `"activate"` emits `focus` for that float's active panel.
8. **`close` on tiled ✕ and on `removePanel`.** A region `"tabclose"` and `removePanel(knownId)` each emit exactly one `close`; `removePanel` returns `true`; the cached frame is evicted from `_frames` (re-`addPanel` rebuilds) while `_panels` is retained.
9. **`close` on float-window chrome ✕.** A subscribed owned float's `"close"` emits one `close` per registered frame it held.
10. **`focus(null)` on last-panel close.** Closing the dock-wide focused last panel emits `focus(null)`.
11. **`focus` shift on closing the focused panel (others remain).** Closing the focused tab emits `focus` for the newly-active sibling.
12. **`removePanel(unknownId)` / `focusPanel(unknownId)` return `false`, emit nothing.**
13. **`focusPanel(knownId)` activates + returns `true`.** Host region's active index becomes the panel's index (assert via `Tab.getActiveTabIndex`); a `focus` is emitted.
14. **`focusPanel` of a registered-but-never-docked id returns `false`** (no region hosts the frame).
15. **`off(...)` unsubscribes** for each of the four events.
16. **`Tab.closeTab(content)`** returns `true` and tears down (cell + content removed, `"tabclose"` emitted) for present content; `false` otherwise.
17. **`Tab` `"activated"`** fires once on `setActiveTabIndex`/click, carries `(content, index)`; does **not** fire on the post-close `setActiveVisual` re-selection.
18. **`AbstractWindow` `"activate"`** fires once from `onActivate(true)`, not on `onActivate(false)`.

Needs live DOM / drag / focus verification (offline harness can't paint focus or run real DnD):

19. **Tiled tab switch in the running dock fires `focus`** (click a background tab → one `focus` log).
20. **Tear-off fires `detach` not `close`**; a subsequent ✕ on that float's mini-dock tab fires `close`; closing the float window via its chrome ✕ fires `close`.
21. **Re-dock from a float into a tiled strip fires `attach`** (drag a float tab back onto an in-dock strip), followed by a `focus` for the re-docked panel (the `dockComponent` → `setActiveTabIndex` route).
22. **`focusPanel` raises a buried float** and moves keyboard focus, firing `focus` (roving focus is a live effect).
23. **A default `TabWindow` tear-off** participates: switching its tabs fires `focus`, ✕-closing its tab fires `close`, closing the window fires `close` (verifies the explicit `TabWindow` subscription).
24. **Internal `Split`-pane move is silent** for `attach`/`detach` in the running app (panel never left the tiled tree).
25. **Layout restore fires `focus`.** `setLayoutState` → `restoreLayout` → `setActiveTabIndex` routes through `_onBarTabPressed` → the new `"activated"`, so a restore emits a `focus` for each restored region's active panel (intentional, see the `focus` decision).

---

## Verification

- **Typecheck:** `npm run check` — clean.
- **Unit tests:** the new Dock test (behaviours 1–18) plus existing Tab/overlay suites green. Mirror the overlay tests' style (`plans/implemented/tests-overlay.md` and the overlay test tree).
- **Grep invariants:** `emit("tabclose"` → one; `emit("activated"` → one; `emit("activate"` → one; `grep -rn 'onClose' src/typescript/lib/overlay/Dock.ts` → zero.
- **Docs build:** `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning); confirm `DockEvent`/`DockPanelEvent` land under `docs/api/overlay/`, the grown `TabEvent`/`WindowEvent` render, and the Dock page's new sections render.
- **Manual smoke (demo screen — MiscPanel "Dockable layout (Dock)" button, [MiscPanel.ts:841](../src/typescript/MiscPanel.ts#L841)):** temporarily `dock.on("attach"|"detach"|"focus"|"close", e => console.log(...))`; switch tabs → `focus`; tear off → `detach`; drag back → `attach`; ✕ a tiled tab → `close`; close a float window → `close`; close the last panel → `focus(null)`; `dock.focusPanel("search")` from the console → activates + surfaces; `dock.removePanel("editor")` → `close`, region pruned.
- **Theme toggle:** no visual surface added; a quick toggle confirms no regression.

---

## Documentation Impact

- **Barrels:** `DockEvent`/`DockPanelEvent` are new — add to the `export type { … } from '~/overlay/Dock.js';` line in [overlay/index.ts:25](../src/typescript/lib/overlay/index.ts#L25). `TabEvent` ([layout/index.ts:19](../src/typescript/lib/layout/index.ts#L19)) and `WindowEvent` ([overlay/index.ts:8](../src/typescript/lib/overlay/index.ts#L8)) are already exported — the grown unions surface automatically. `Dock`/`Tab`/`AbstractWindow` are already exported.
- **`@category`:** tag `DockEvent`/`DockPanelEvent` `@category Core` (matching `DockOptions`/`DockPanelSpec`); the new `Tab`/`Window` overloads inherit their classes' categories.
- **Curated pages:** [docs/components/Dock.md](../docs/components/Dock.md) — add "## Panel lifecycle" (the four events, payloads, the docked/floating/gone state model, the detach-vs-close and silent-internal-move rules, the no-`blur` rationale) and "## Programmatic control" (`focusPanel`/`removePanel`). The page is already in the sidebar ([docs/.vitepress/config.mts:72](../docs/.vitepress/config.mts#L72)) and catalog ([docs/components/index.md:21](../docs/components/index.md#L21)); no new entry needed. The generated `Tab`/`AbstractWindow` API pages pick up the new events/methods automatically — no curated edit there.
- **JSDoc cross-bucket links:** Dock JSDoc referencing `Tab`/`AbstractWindow` uses the markdown-link form (e.g. `[\`Tab\`](/api/layout/classes/Tab)`); keep it. Do **not** `{@link}` private `closeEntry`/`regionForFrame`/`floatForFrame`/`onPanel*` or the protected `emit` from public JSDoc (CODE_CONVENTIONS *"Don't {@link} internal symbols"*) — describe in prose.

---

## Potential Challenges

- **Frame-id vs content-id.** The `"tabclose"`/`"activated"` payloads are the dock *frame* (whose `getId()` is the panel id), not the user's inner content. Handlers read `frame.getId()` and guard on `_frames`/`_panels`, or a foreign Tab event would mis-fire.
- **`attach` over-firing on the location diff.** The diff must compare against the *previous* sweep's ledger and only emit on `floating → docked`, or every sweep would re-emit `attach` for already-docked panels. Seed the ledger at first dock in `addPanel`/`compileTabs`.
- **`focus` thrash / double-fire.** `bringToFront` (focus path) and the new `"activate"` event can both observe one raise; gate all `focus` emits behind a genuine `_focusedPanelId` change so a re-activation of the same panel is silent.
- **Re-subscription stacking.** Tiled `"activated"`/`"tabclose"` go inside the `tabWired` one-shot guard; float `"activate"`/`"close"` (and `TabWindow` internal-Tab subscriptions) need their own tracked-set guard so re-sweeps don't stack duplicate listeners (the "Re-wiring stacks duplicate listeners" memory note).
- **`TabWindow` is not adopted.** The sweep excludes `TabWindow` from `ownedFloatWindows` ([Dock.ts:489](../src/typescript/lib/overlay/Dock.ts#L489)); its internal `Tab` is therefore never wired by `wireRegion`. The float-subscription step must track open `TabWindow`s holding this dock's frames separately and subscribe their internal `Tab` explicitly, or `focus`/`close`/`detach` would be missing for the default tear-off kind.
- **Float `"close"` fires before teardown.** `onExitAction` emits `"close"` *before* destroying the window ([AbstractWindow.ts:822](../src/typescript/lib/overlay/AbstractWindow.ts#L822)), so the dock can still read the float's held frames at emit time to fan out one `close` per frame.
- **Brief stale-focus window at tear-off (accepted).** At tear-off, `bringToFront()` runs ([Tab.ts:1751](../src/typescript/lib/layout/Tab.ts#L1751)) *before* `emit("detached")` ([Tab.ts:1757](../src/typescript/lib/layout/Tab.ts#L1757)), and the new float's `"activate"` subscription is only wired by the rAF-deferred sweep that the `"detached"` handler schedules — so the float's first activation (the tear-off raise) fires *before* the dock is listening, and `_focusedPanelId` does **not** update for that initial raise. This is a live-only effect that self-corrects on the next interaction with the float, and is consistent with Expected Behaviour (which deliberately does **not** assert a `focus` at the tear-off instant). Known, accepted limitation.

---

## Critical Files

- [src/typescript/lib/overlay/Dock.ts](../src/typescript/lib/overlay/Dock.ts) — the target: `addPanel`, `_panels`/`_frames`/`_wiring`, `resolvePanel`, `runSweep`/`wireRegion`/`teardownVanished`, `ownedFloatWindows`/`adoptFloat`, `pruneRegion`, `firstTabRegion`.
- [src/typescript/lib/layout/Tab.ts](../src/typescript/lib/layout/Tab.ts) — `_onBarTabClose`/`_onBarTabPressed` (extraction + activation emit), `removeEntryKeepingContent`/`"detached"` (the tear-off path), `setActiveTabIndex`, `selectNextContent`/`setActiveVisual`, the `on`/`off`/`emit`/`ListenerBag` shape.
- [src/typescript/lib/overlay/AbstractWindow.ts](../src/typescript/lib/overlay/AbstractWindow.ts) — `WindowEvent`, `onActivate` (the new `"activate"` emit site), `onExitAction`/`"close"`, `bringToFront`, the `on`/`off`/`emit` shape.
- [src/typescript/lib/overlay/TabWindow.ts](../src/typescript/lib/overlay/TabWindow.ts) — the self-contained float kind whose internal `Tab` the dock must subscribe explicitly, reached via `getLayoutManager() as Tab` (set with `setLayoutManager(this._tab)` — [TabWindow.ts:85](../src/typescript/lib/overlay/TabWindow.ts#L85); the private `_tab` field at `:62` is *not* accessible from the dock). `TabWindow.ts` needs **no** edits precisely because `getLayoutManager()` already exposes that `Tab`.
- [src/typescript/lib/component/container/TabBar.ts](../src/typescript/lib/component/container/TabBar.ts) — `setActiveEntry` (emits `"tabpressed"`) vs `setActiveVisual` (does not), the reason the new `Tab` `"activated"` event covers click + programmatic but not post-close re-selection.
- [src/typescript/lib/core/LayerManager.ts](../src/typescript/lib/core/LayerManager.ts) — `onActivate(true)`/`onActivate(false)` dispatch ([LayerManager.ts:385-393](../src/typescript/lib/core/LayerManager.ts#L385)), the manager-driven source of window activation.
- [src/typescript/lib/core/ListenerBag.ts](../src/typescript/lib/core/ListenerBag.ts) — `add`/`remove`/`fire`.
- [ARCHITECTURE.md](../ARCHITECTURE.md) / [CODE_CONVENTIONS.md](../CODE_CONVENTIONS.md) — the `ListenerBag`/`emit`-protected and super()-cascade rules.
- [plans/tsui-sql-admin.md](../plans/tsui-sql-admin.md) — the motivating consumer.

---

## Non-Goals

- **A `blur` event.** Deliberately omitted; the nullable `focus` payload + the consumer's own last-focused state cover it.
- **A per-`DockPanelSpec` `onClose`/`onFocus` callback.** Superseded by the Dock-level events.
- **Lifecycle events on `Split`.** `Split` is structural (regions only, never panels); it generates none.
- **Any event beyond `attach`/`detach`/`focus`/`close` + the one new `Tab` `"activated"` + the one new `AbstractWindow` `"activate"`.** No speculative lifecycle hooks.
- **Changing `addPanel`/serialization/tear-off mechanics.** Purely additive.
