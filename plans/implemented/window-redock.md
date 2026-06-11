---
depends-on:
  - tab-detach-redock.md
touches-shared:
  - src/typescript/lib/layout/Tab.ts
  - src/typescript/lib/core/DragManager.ts
  - src/typescript/lib/core/Window.ts
  - src/typescript/lib/component/container/TabPanel.ts
---

# Torn-off Window Re-dock & Detach Modes — Implementation Plan

## Overview

Two complementary capabilities on top of the shipped tab tear-off ([`tab-detach-redock.md`](implemented/tab-detach-redock.md)):

1. **Re-dock a *bare* floating window by Ctrl-dragging its header.** Holding `Ctrl` while dragging a floating [`Window`](../src/typescript/lib/core/Window.ts#L135) by its header re-docks the window's live body content onto whatever reorderable [`Tab`](../src/typescript/lib/layout/Tab.ts#L506) strip the drag is released over — as a new tab at the insertion slot — then closes the now-empty window. A plain (no-`Ctrl`) header drag still **moves** the window exactly as today; a `Ctrl`-drag released over empty space is a **no-op**.

2. **A configurable tear-off mode.** A new [`Tab`](../src/typescript/lib/layout/Tab.ts#L506) option, `detachWindowMode?: "bare" | "strip"` (default `"strip"`), selects how a torn-off tab's window hosts its content. **This flips the shipped default** — torn-off tabs now show a one-tab strip by default; the original bare float becomes opt-in via `detachWindowMode: "bare"`.
   - **`"strip"`** (default): `detachTabToWindow` builds a one-tab reorderable [`Tab`](../src/typescript/lib/layout/Tab.ts#L506) strip inside the window hosting the content, so the float shows a one-tab strip. Re-dock needs **no new gesture** — the user drags that inner tab onto another strip through the **existing** cross-strip dock wiring ([`makeTabDragSource`](../src/typescript/lib/layout/Tab.ts#L2807) → [`dropTabHeader`](../src/typescript/lib/layout/Tab.ts#L2893) → [`dockComponent`](../src/typescript/lib/layout/Tab.ts#L3002)), and the emptied window **auto-closes**.
   - **`"bare"`** (opt-in, the previously-shipped behaviour): [`detachTabToWindow`](../src/typescript/lib/layout/Tab.ts#L2971) puts the live content directly in the window's [`Border`](../src/typescript/lib/layout/Border.ts) CENTER. Re-dock is the **Ctrl-drag-the-window** gesture from (1).

The two modes are complementary and both ship: bare windows re-dock via Ctrl-drag, strip windows re-dock via drag-the-inner-tab and self-close. Tab→tab dock and same-strip reorder are unchanged.

The work touches: a layering move of the `TabDragData` contract + `tabDragRegistry` runtime singleton from [`Tab.ts`](../src/typescript/lib/layout/Tab.ts) down into [`DragManager.ts`](../src/typescript/lib/core/DragManager.ts) (so both `Tab` and `Window` share them without a `Window`↔`Tab` cycle); a `Ctrl`-gated `DragManager` drag source on the `Window` header; the new `detachWindowMode` option on `Tab` (mirrored on [`TabPanel`](../src/typescript/lib/component/container/TabPanel.ts#L69)); a strip-mode branch in `detachTabToWindow`; and an auto-close hook on the inner tear-off strip.

---

## Architecture Decisions

### Move `TabDragData` + `tabDragRegistry` down into `core/DragManager.ts`

The Ctrl-drag-window gesture originates in [`Window.ts`](../src/typescript/lib/core/Window.ts) (**core**). The contract it must emit — `TabDragData` — and the runtime singleton that resolves a dragged component — `tabDragRegistry` (module-level `Map<string, Component>`, [`Tab.ts:74`](../src/typescript/lib/layout/Tab.ts#L74)) — currently live in `Tab.ts` (**layout**). `Window` **cannot reach them where they are**: `Tab.ts` already imports `Window` ([`Tab.ts:9`](../src/typescript/lib/layout/Tab.ts#L9) `import { Window } from "~/core/Window.js"`), so a `Window` → `Tab` import to grab the contract would form a `Window`↔`Tab` **import cycle**. (`Window` already imports other *layout* modules — `~/layout/Border.js`, `~/layout/Fit.js` — so the constraint is not "core may never import layout"; it is specifically that `Window`↔`Tab` is circular.)

**Decision: relocate both symbols into [`DragManager.ts`](../src/typescript/lib/core/DragManager.ts).** It already owns [`DragData`](../src/typescript/lib/core/DragManager.ts#L15), [`DragEventDetail`](../src/typescript/lib/core/DragManager.ts#L24), [`DragSourceOptions`](../src/typescript/lib/core/DragManager.ts#L40), [`makeDragSource`](../src/typescript/lib/core/DragManager.ts#L179)/[`makeDropTarget`](../src/typescript/lib/core/DragManager.ts#L196), and the drag-session lifecycle. `TabDragData` is a drag payload and `tabDragRegistry` is the live-reference channel for one — both are drag concepts. **No cycle is introduced:** `DragManager.ts` imports only `Component`, `DragFeedback`, `DragGhost`, `Event`, and `ReorderIndicator` ([`DragManager.ts:3-7`](../src/typescript/lib/core/DragManager.ts#L3)) — none reach back to `Window` or `Tab`. After the move: `Tab.ts` imports `TabDragData`/`tabDragRegistry` from `~/core/DragManager.js` (it already imports `DragManager`, `DragEventDetail`, `DragData` from there at [`Tab.ts:32`](../src/typescript/lib/layout/Tab.ts#L32)); `Window.ts` imports them from `~/core/DragManager.js` too.

The **registry move is the load-bearing one** — it is a runtime singleton that `Tab` and `Window` must share **the same `Map` instance** of. Re-declaring it in two modules would silently break dock (the `Window` source would write to one map and the `Tab` target would read an empty other). One module-level declaration in `DragManager.ts`, imported by both, guarantees the shared instance. A pre-move grep confirms `TabDragData`/`tabDragRegistry` have **no consumer outside `Tab.ts` today** (the layout barrel re-export of the type is the only other mention), so the move is purely additive on the consumer side.

### Canonical export location, and downstream-plan reconciliation

`TabDragData` is currently re-exported `export type` from the **layout barrel** ([`src/typescript/lib/layout/index.ts:16`](../src/typescript/lib/layout/index.ts#L16)). After the move the **canonical declaration site is `core/DragManager.ts`**, so the type is exported from the **core barrel** [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts#L50) alongside `DragData`/`DragEventDetail`/`DragSourceOptions`. `tabDragRegistry` stays an **internal, unexported** module constant of `DragManager.ts` — shared by *file import*, not public surface.

**Keep the layout-barrel `TabDragData` re-export for back-compat** by re-sourcing it from core: change `layout/index.ts:16` so `TabDragData` comes from `~/core/DragManager.js` rather than `~/layout/Tab.js`. This keeps `import { TabDragData } from "<layout barrel>"` working while making core canonical.

**Downstream reconciliation** — [`edge-drop-to-split.md`](edge-drop-to-split.md) (#3) and [`dock-tab-manager.md`](dock-tab-manager.md) (#5) name [`tab-detach-redock.md`](implemented/tab-detach-redock.md) (#2) as the `TabDragData`/`tabDragRegistry` owner and only ever **test the field shape** (`detail.dragData.tabDrag === true`, resolve via `tabDragRegistry.get(componentId)`). This plan changes **only the bucket**, not the field shape: `TabDragData` keeps `{ tabDrag, sourceTabId, componentId, label }` verbatim and `tabDragRegistry` keeps `Map<string, Component>` keyed by `componentId`. #3/#5 import `TabDragData` from the core barrel and `tabDragRegistry` from `~/core/DragManager.js` when implemented.

### `detachWindowMode` is a typed `Tab` option, cached and forwarded like `reorderable`

The mode selector lives on [`Tab`](../src/typescript/lib/layout/Tab.ts#L506), the layout manager, mirroring exactly how `reorderable` is declared and forwarded:

- **Option field**: `detachWindowMode?: "bare" | "strip"` on [`TabOptions`](../src/typescript/lib/layout/Tab.ts#L207), beside `reorderable` ([`Tab.ts:255`](../src/typescript/lib/layout/Tab.ts#L255)).
- **Cached backing field**: `private _detachWindowMode: TabDetachWindowMode = "strip";` beside `_reorderable` ([`Tab.ts:579`](../src/typescript/lib/layout/Tab.ts#L579)). The option **is** the cache — read and written through the setter.
- **Typed setter/getter**: `setDetachWindowMode(mode): this` / `getDetachWindowMode(): TabDetachWindowMode`, mirroring [`setReorderable`](../src/typescript/lib/layout/Tab.ts#L1345)/[`isReorderable`](../src/typescript/lib/layout/Tab.ts#L1370). The setter just stores the field — no layout work needed, because the mode is only consulted at the next tear-off, so it does **not** call `scheduleLayout()` (unlike `setReorderable`, which re-wires DnD). Default `"strip"`; the previously-shipped bare float is reachable via `setDetachWindowMode("bare")`.
- **Forwarded in `applyOptions`**: `if (options.detachWindowMode !== undefined) this.setDetachWindowMode(options.detachWindowMode);` beside the `reorderable` forward ([`Tab.ts:714`](../src/typescript/lib/layout/Tab.ts#L714)).

A small string-literal alias `export type TabDetachWindowMode = "bare" | "strip";` declared near the other Tab unions (e.g. by [`TabEvent`](../src/typescript/lib/layout/Tab.ts#L44)) keeps the setter/getter/option signatures consistent and matches the existing `TabWidthMode`/`TabSide` idiom.

### `TabPanel` mirrors the option two ways — constructor pass-through *and* a forwarding setter/getter

[`TabPanel`](../src/typescript/lib/component/container/TabPanel.ts#L69) wraps a `Tab` manager and forwards each Tab option both through a `tabOptions?: TabOptions` bag passed straight to the manager constructor ([`TabPanel.ts:84`](../src/typescript/lib/component/container/TabPanel.ts#L84) `new Tab(options?.tabOptions)`) **and** through per-option forwarding methods ([`setTabReorderable`](../src/typescript/lib/component/container/TabPanel.ts#L410)/[`isTabReorderable`](../src/typescript/lib/component/container/TabPanel.ts#L421)). The new option therefore already flows in via `tabOptions: { detachWindowMode: "strip" }` **with no TabPanel change** — but for parity with every other Tab option, add a forwarding pair `setTabDetachWindowMode(mode): this` / `getTabDetachWindowMode(): TabDetachWindowMode` delegating to `getTabManager().setDetachWindowMode(...)`/`getDetachWindowMode()`, modelled on `setTabReorderable`/`isTabReorderable`. Import `TabDetachWindowMode` alongside the other Tab type imports ([`TabPanel.ts:6`](../src/typescript/lib/component/container/TabPanel.ts#L6)). `TabPanelOptions` does **not** gain its own `detachWindowMode` field — TabPanel mirrors Tab options *only* via `tabOptions` + forwarding methods, never by re-declaring the option (matching `reorderable`, which has no `TabPanelOptions` field either).

### `detachTabToWindow` branches on the mode

The shipped [`detachTabToWindow`](../src/typescript/lib/layout/Tab.ts#L2971) re-parents `entry.component` straight into the window body (`win.moveComponent(content)`). The branch:

- **`"bare"`** (opt-in): unchanged — `win.moveComponent(content)`. Re-dock is the Ctrl-drag-window gesture.
- **`"strip"` (default)**: build, inside the window's CENTER, a `Panel` laid out by a fresh `new Tab({ reorderable: true })` (same module — no new import), set the inner Tab's internal `_closeHostWindowWhenEmpty` flag, `moveComponent` the strip `Panel` into the window, then `innerTab.createTab(content)` after re-parenting the content into the strip's container. A `Panel` + `Tab` manager renders a one-tab strip (the canonical `new Panel({ layoutManager: new Tab() })` shape TabPanel itself uses), and because the inner Tab is `reorderable: true` **and attached**, `buildTabEntry` registers a drag source on the tab automatically ([`Tab.ts:1798`](../src/typescript/lib/layout/Tab.ts#L1798) per #2) — so the inner tab is immediately draggable out onto another strip with no extra wiring.

Both branches share the post-detach teardown ([`removeEntryKeepingContent`](../src/typescript/lib/layout/Tab.ts#L3037)) and the `setX`/`setY`/`setSize`-before-`show()` placement; only the body-construction differs. `Panel` is `core` and `Tab.ts` imports both `Panel` ([`Tab.ts:8`](../src/typescript/lib/layout/Tab.ts#L8)) and `Window` ([`Tab.ts:9`](../src/typescript/lib/layout/Tab.ts#L9)) already.

### Strip-mode auto-close via an internal opt-in flag, hooked at the single empty-check point

A strip-mode window must close when its inner Tab empties — whether the last tab was **dragged out** (cross-strip dock) or **closed** via its close button. But a *general* `Tab` that merely happens to sit in a window must **not** close it. So the inner tear-off Tab carries an **internal, non-public** opt-in flag:

```typescript
private _closeHostWindowWhenEmpty: boolean = false;   // set ONLY by detachTabToWindow's strip branch
```

It is **not** a `TabOptions` field and **not** publicly settable — only `detachTabToWindow` writes it on the strip it creates. The two entry-removal paths that can empty a strip are [`removeEntryKeepingContent`](../src/typescript/lib/layout/Tab.ts#L3037) (the dragged-out / re-docked path, reached from [`onTabDragEnd`](../src/typescript/lib/layout/Tab.ts#L2934)) and [`closeTab`](../src/typescript/lib/layout/Tab.ts#L3250) (the closed-the-last-tab path). Both already splice `_tabs` and then call `selectNextTab`/`scheduleLayout`. **Add a single private `closeHostWindowIfEmpty()` and call it at the tail of each** — after the splice, when `this._tabs.length === 0`:

```typescript
private closeHostWindowIfEmpty(): void {
    if (this._tabs.length > 0 || !this._closeHostWindowWhenEmpty) {
        return;
    }
    let p = this.getContainer()?.getParentComponent() ?? null;   // walk up from the strip Panel
    while (p && !(p instanceof Window)) {
        p = p.getParentComponent();
    }
    p?.requestClose();
}
```

`Tab.ts` already imports `Window` ([`Tab.ts:9`](../src/typescript/lib/layout/Tab.ts#L9)), so the `instanceof Window` walk and `requestClose()` ([`Window.ts:534`](../src/typescript/lib/core/Window.ts#L534)) are in-bucket. `getParentComponent()` is the standard parent accessor ([`Component`](../src/typescript/lib/core/Component.ts) — used at [`Tab.ts:161`](../src/typescript/lib/layout/Tab.ts#L161)). Placing the hook in both removal methods (rather than only in `onTabDragEnd`) covers the dragged-out **and** the closed-last-tab cases with one shared helper and no duplicated walk-up logic.

### The Ctrl-drag-window source must stay inert for strip-mode windows

A strip-mode window's body is the auto-created `Panel`/`Tab` wrapper, **not** a dockable content panel — Ctrl-dragging it must not dock the wrapper. The bare-mode window is the only one the Ctrl-drag source should act on. **Decision: the Ctrl-drag header source is registered on *every* `Window` unconditionally, but `detachTabToWindow`'s strip branch marks the window so the source's `onDragStart` veto skips it.** The cleanest grounding: the strip-mode `Window` is flagged via a `Window`-level marker the header source reads, e.g. `Window` exposes whether its body is a managed tear-off strip:

```typescript
// Window.ts — set by Tab.detachTabToWindow's strip branch after building the strip body.
private _tearOffStripBody: boolean = false;
setTearOffStripBody(value: boolean): void { this._tearOffStripBody = value; }
isTearOffStripBody(): boolean { return this._tearOffStripBody; }
```

The header drag source's `onDragStart` then vetoes (`return false`) when `this.isTearOffStripBody()` is true — alongside its existing `!ctrl || !content` veto. So a strip-mode window's header **moves** normally (plain drag) and its **Ctrl**-drag is a no-op (vetoed), while its inner tab carries the real re-dock gesture. Bare windows leave the flag `false` and the Ctrl-source acts. This keeps one registration path and a one-bit gate, rather than conditionally skipping source registration. (Alternative considered and rejected: not registering the source for strip windows — but the strip flag is set *inside* `detachTabToWindow`, after the `Window` constructor has already wired the source, so a read-at-`onDragStart` flag is cleaner than ordering the registration around the body build.)

### `Ctrl`-gated arbitration between window-move and dock-drag (bare windows)

The same header `mousedown` feeds **two** competing mechanisms; exactly one must win per gesture.

- **Window move** is *not* a `DragManager` session — it is raw `Event` viewport listeners: [`Event.addListener(this._header, "mousedown", e => this.onMouseDown(e))`](../src/typescript/lib/core/Window.ts#L240) → [`onMouseDown`](../src/typescript/lib/core/Window.ts#L1042) snapshots the origin and adds viewport `mousemove`/`mouseup` → `onDrag`/`onMouseUp` commit the translate.
- **Dock drag** is a new `DragManager.makeDragSource(this._header, …)` session.

The gate:

- **`onMouseDown` (move) early-returns when `Ctrl` was held at press** — a guard `if (e.ctrlKey) return;` at the top of [`onMouseDown`](../src/typescript/lib/core/Window.ts#L1042). A `Ctrl`+drag does not move the window.
- **The `DragManager` source vetoes unless `Ctrl` was held AND the window has body content AND it is not a tear-off strip.** `DragEventDetail` carries **no modifier-key state** ([`DragEventDetail`](../src/typescript/lib/core/DragManager.ts#L24) is `{ dragData, sourceId, clientX, clientY }`) and `onDragStart` runs on the first threshold-crossing `mousemove` ([`DragManager.ts:446`](../src/typescript/lib/core/DragManager.ts#L446)), by which time `ctrlKey` is gone. So **capture `ctrlKey` at mousedown into a field** and read+clear it in `onDragStart` — mirroring [`Tab._dragMouseTarget`](../src/typescript/lib/layout/Tab.ts#L582): a named mousedown listener stores the flag; `onDragStart` reads + nulls it.

Why airtight (verified against the session lifecycle):

- **`Ctrl` held (bare window):** `onMouseDown` (move) early-returns → no viewport move listeners. The source commits: first `mousemove` past threshold calls `onDragStart` which (Ctrl set + body present + not a strip) does not return `false`, so [`commitSession`](../src/typescript/lib/core/DragManager.ts#L310) runs. **Exactly one path active.**
- **No `Ctrl`:** `onMouseDown` (move) runs normally. The source's `onDragStart` sees the Ctrl flag **unset** and **returns `false`**, calling `endSession(false, …)` on a **not-yet-committed** session → no ghost, and `onDragEnd` does not fire (gated on `session.committed`, [`DragManager.ts:578`](../src/typescript/lib/core/DragManager.ts#L578)). The window move runs unobstructed. **Exactly one path active.**

### The bare window closes itself on dock — symmetric with `Tab.onTabDragEnd`

The shipped [`dockComponent(content, slot)`](../src/typescript/lib/layout/Tab.ts#L3002) takes **no source-window argument** and never closes anything. The source side owns its own teardown: [`Tab.onTabDragEnd`](../src/typescript/lib/layout/Tab.ts#L2934) checks whether the content left this container and, if so, removes the orphaned entry. The bare `Window` mirrors this: register the body content in `tabDragRegistry` at drag start (gated on body present), and in the source's `onDragEnd(detail, dropped)` — **delete the registry entry; then if `dropped` AND the body content has left this window** → `this.requestClose()`. The destination `dockComponent` already `moveComponent`-ed the content out; the source window observes the now-empty body and closes. This keeps `dockComponent` source-agnostic.

### Bare content in the float, not a tab-strip wrapper (for `"bare"` mode)

In `"bare"` mode the floating window hosts the live content **directly** in its `Border` CENTER, exactly as the originally-shipped tear-off produced it. Re-dock simply moves that bare content back into a strip via the Ctrl-drag gesture. `"strip"` is now the default; `"bare"` is the opt-in alternative that drops the one-tab wrapper.

### Gesture matrix (reconciled)

| Source | Re-dock gesture | Window lifecycle |
|---|---|---|
| **Bare** window (`detachWindowMode:"bare"`) | Hold `Ctrl`, drag the window header onto a reorderable strip | Window closes on successful dock; plain drag still moves; Ctrl-drag over empty space is a no-op |
| **Strip** window (`detachWindowMode:"strip"`) | Drag the inner tab out onto another strip (existing cross-strip dock) | Window auto-closes when its inner strip empties; Ctrl-drag of the strip window header is vetoed (no-op); plain drag still moves |
| Tab → another strip | Existing cross-strip dock | unchanged |
| Same-strip reorder | Existing reorder | unchanged |

### Zero changes to Tab's drop side

The destination is already complete. [`isTabHeaderDrag`](../src/typescript/lib/layout/Tab.ts#L2882) accepts any `tabDrag === true`; [`dropTabHeader`](../src/typescript/lib/layout/Tab.ts#L2893) compares `dragData.sourceTabId` to `this.stripId()` and, on a **non-match**, resolves the content via `tabDragRegistry.get(componentId)` and calls `dockComponent(content, this._dragInsertIndex)`. The bare-window Ctrl-drag payload stamps `sourceTabId` with **the window's own id** (never equal to any strip's `stripId()`), so the drop is a **foreign dock**. The strip-window inner tab already produces a valid `TabDragData` from its own `makeTabDragSource`, so its dock needs no new producer at all.

---

## Public API (TypeScript Signatures)

### `Tab.detachWindowMode` — new typed option + setter/getter

```typescript
/** How a torn-off tab's floating window hosts its content. */
export type TabDetachWindowMode = "bare" | "strip";

interface TabOptions extends LayoutManagerOptions {
    // ...existing fields unchanged...
    /**
     * How a torn-off tab's floating window hosts its content. `"strip"` (default)
     * wraps it in a one-tab reorderable strip whose inner tab re-docks onto
     * another strip and closes the emptied window; `"bare"` puts the live content
     * directly in the window body and re-docks via Ctrl-dragging the window
     * header. Defaults to `"strip"`.
     */
    detachWindowMode?: TabDetachWindowMode;
}

class Tab extends LayoutManager<TabOptions> {
    setDetachWindowMode(mode: TabDetachWindowMode): this;   // caches _detachWindowMode; no layout
    getDetachWindowMode(): TabDetachWindowMode;
}
```

Backing field: `private _detachWindowMode: TabDetachWindowMode = "strip";`

### `TabPanel` forwarding pair

```typescript
class TabPanel extends Panel<TabPanelOptions> {
    setTabDetachWindowMode(mode: TabDetachWindowMode): this;   // → getTabManager().setDetachWindowMode
    getTabDetachWindowMode(): TabDetachWindowMode;             // → getTabManager().getDetachWindowMode
}
```

`TabPanelOptions` gains **no** new field — the option reaches the manager via `tabOptions: { detachWindowMode }` (mirroring `reorderable`).

### `TabDragData` — moved to the core bucket (shape unchanged)

```typescript
// now declared in src/typescript/lib/core/DragManager.ts, exported from the core barrel.
export interface TabDragData {
    tabDrag:     true;
    sourceTabId: string;
    componentId: string;
    label:       string;
}
```

`tabDragRegistry` stays an internal (unexported) `Map<string, Component>` module constant of `DragManager.ts`, shared by file import.

### `Window` — tear-off-strip marker (internal helper surface)

```typescript
class Window extends Panel<WindowOptions> {
    /** Whether this window's body is a managed tear-off strip (set by Tab's strip-mode detach). */
    setTearOffStripBody(value: boolean): void;
    isTearOffStripBody(): boolean;
}
```

The body content for the bare-mode dock payload / emptiness check is read via the existing private [`findBodyHost()`](../src/typescript/lib/core/Window.ts#L1432) from the header drag-source closures (which are `Window` methods) — **no new public body accessor required**.

### `DragSourceOptions.onDragEnd?` — already present

```typescript
interface DragSourceOptions {
    onDragEnd?: (detail: DragEventDetail, dropped: boolean) => void;   // shipped by #2 — no change
}
```

---

## Internal Structure

### `Tab.detachTabToWindow` — mode branch (grounded in the shipped method)

```text
detachTabToWindow(entry, clientX, clientY) {
    if (entry.state !== "ready" || !entry.component) return;
    const content = entry.component;

    const win = new Window(entry.name);
    win.setX(clientX); win.setY(clientY);
    win.setSize({ width: DETACH_WINDOW_WIDTH, height: DETACH_WINDOW_HEIGHT });

    if (this._detachWindowMode === "strip") {
        const strip = new Panel({ layoutManager: new Tab({ reorderable: true }) });
        (strip.getLayoutManager() as Tab)._closeHostWindowWhenEmpty = true;   // internal flag, same module
        win.moveComponent(strip);                       // strip Panel fills the window body
        win.setTearOffStripBody(true);                  // Ctrl-source veto reads this
        win.show();
        (strip.getLayoutManager() as Tab).createTab(content);   // re-parents content into strip + builds the one tab
    } else {
        win.moveComponent(content);                     // bare: live content into Border CENTER
        win.show();
    }

    this.removeEntryKeepingContent(entry);              // shared teardown, both modes
}
```

> The exact `createTab`-vs-`moveComponent` ordering for the strip body is an implementation detail to settle: `createTab(content)` calls `container.addComponent`/reads constraints on the inner strip's container, so the content must be parented into the strip's `Panel` first. `Tab.createTab` ([`Tab.ts:1867`](../src/typescript/lib/layout/Tab.ts#L1867)) expects the component to already be (or become) a child of the manager's container; follow `dockComponent`'s pattern ([`Tab.ts:3002`](../src/typescript/lib/layout/Tab.ts#L3002) — `container.moveComponent(content, slot)` then `this.createTab(content)`) by moving the content into the strip `Panel` (`strip.moveComponent(content)`) before `innerTab.createTab(content)`.

### `Tab.closeHostWindowIfEmpty` — auto-close hook (strip mode only)

```text
private closeHostWindowIfEmpty() {
    if (this._tabs.length > 0 || !this._closeHostWindowWhenEmpty) return;
    let p = this.getContainer()?.getParentComponent() ?? null;
    while (p && !(p instanceof Window)) p = p.getParentComponent();
    p?.requestClose();
}
```

Called at the tail of `removeEntryKeepingContent` ([`Tab.ts:3037`](../src/typescript/lib/layout/Tab.ts#L3037), after `selectNextTab`/`scheduleLayout`) and `closeTab` ([`Tab.ts:3250`](../src/typescript/lib/layout/Tab.ts#L3250), after `selectNextTab`/`scheduleLayout`). On a general (non-tear-off) strip the flag is `false`, so the helper is a cheap early-return.

### `Window` header drag source (new), grounded in real fields/methods

A field captures the modifier at press, mirroring `_dragMouseTarget`:

```typescript
private _headerDragCtrl: boolean = false;
private _headerDragComponentId: string = "";          // registered content id, for onDragEnd cleanup
private _tearOffStripBody: boolean = false;            // set by Tab strip-mode detach
```

`onMouseDown` (move) gains a Ctrl early-return at the very top ([`Window.ts:1042`](../src/typescript/lib/core/Window.ts#L1042)):

```text
onMouseDown(e: MouseEvent) {
    if (e.ctrlKey) return;                              // Ctrl+drag is a dock gesture, not a move
    if (this.getWindowState() !== "normal") return;    // unchanged
    ... existing snapshot + viewport-listener wiring unchanged ...
}
```

The Ctrl capture + drag source (named bound listener per CODE_CONVENTIONS, not an inline arrow):

```text
private readonly _boundCaptureHeaderCtrl = (e: MouseEvent) => { this._headerDragCtrl = e.ctrlKey; };

// constructor, near Window.ts:240
Event.addListener(this._header, "mousedown", this._boundCaptureHeaderCtrl);
DragManager.makeDragSource(this._header, {
    dragData: (): DragData => {
        const content = this.findBodyHost();
        const data: TabDragData = {
            tabDrag:     true,
            sourceTabId: this.getId(),                 // window's own id → FOREIGN dock, never a same-strip reorder
            componentId: content ? content.getId() : "",
            label:       this._header.getText(),       // real header text accessor
        };
        return { ...data };
    },
    onDragStart: (): boolean | void => {
        const ctrl = this._headerDragCtrl;
        this._headerDragCtrl = false;                  // read + clear, mirroring Tab._dragMouseTarget
        const content = this.findBodyHost();
        if (!ctrl || !content || this.isTearOffStripBody()) {
            return false;                              // veto: plain drag, empty window, OR strip-mode window
        }
        this._headerDragComponentId = content.getId();
        tabDragRegistry.set(content.getId(), content);
    },
    onDragEnd: (detail: DragEventDetail, dropped: boolean): void => {
        tabDragRegistry.delete(this._headerDragComponentId);   // unconditional, by the stashed id
        this._headerDragComponentId = "";
        if (dropped && this.findBodyHost() === null) {
            this.requestClose();                       // window emptied by the dock → close
        }
    },
});
```

> **Registry-delete subtlety:** after a successful dock the body content has already been `moveComponent`-ed out, so `findBodyHost()` is `null` in `onDragEnd`. Stash the registered id at `onDragStart` (`_headerDragComponentId`) and delete by it unconditionally (matching `Tab.onTabDragEnd`'s unconditional delete). The `dropped && emptied` check then drives `requestClose()`.

No manual content re-parenting on the window side: the **destination** `dockComponent` does the `moveComponent`; the window only reads its body and closes.

---

## Ordered Implementation Steps

1. **Pre-move grep (confirm safe).** `grep -rn 'TabDragData\|tabDragRegistry' src/ --include='*.ts'` — expect matches only in `layout/Tab.ts` and the `layout/index.ts:16` re-export. **File:** none (check).
2. **Move `TabDragData` + `tabDragRegistry` into `DragManager.ts`.** Cut the `TabDragData` interface ([`Tab.ts:57-66`](../src/typescript/lib/layout/Tab.ts#L57)) and the `tabDragRegistry` constant ([`Tab.ts:74`](../src/typescript/lib/layout/Tab.ts#L74)) into `core/DragManager.ts` (declare `tabDragRegistry` near the other module-level state; place `TabDragData` near `DragData`/`DragEventDetail`). Keep `@category` on the exported type. **File:** `src/typescript/lib/core/DragManager.ts`.
3. **Switch `Tab.ts` to import them from core.** Add `TabDragData` and `tabDragRegistry` to the existing `import … from "~/core/DragManager.js"` at [`Tab.ts:32`](../src/typescript/lib/layout/Tab.ts#L32). All tab-drag code unchanged. **File:** `src/typescript/lib/layout/Tab.ts`.
4. **Re-home the exports.** Add `TabDragData` to the core barrel `export type { … }` at [`core/index.ts:50`](../src/typescript/lib/core/index.ts#L50). On the layout barrel [`index.ts:16`](../src/typescript/lib/layout/index.ts#L16), source `TabDragData` from `~/core/DragManager.js` (back-compat re-export). **Files:** `src/typescript/lib/core/index.ts`, `src/typescript/lib/layout/index.ts`.
5. **Typecheck checkpoint.** `npx tsc --noEmit` — zero errors. `grep -rn "interface TabDragData" src/typescript/lib/layout/Tab.ts` — none. `grep -rn "tabDragRegistry" src/typescript/lib/core/DragManager.ts` — declared once.
6. **Add the `detachWindowMode` option to `Tab`.** Declare `TabDetachWindowMode` (near [`TabEvent`](../src/typescript/lib/layout/Tab.ts#L44)); add `detachWindowMode?` to [`TabOptions`](../src/typescript/lib/layout/Tab.ts#L207); add `_detachWindowMode` field ([near Tab.ts:579](../src/typescript/lib/layout/Tab.ts#L579)); add `setDetachWindowMode`/`getDetachWindowMode` (model on [`setReorderable`/`isReorderable`](../src/typescript/lib/layout/Tab.ts#L1345)); forward in `applyOptions` ([beside Tab.ts:714](../src/typescript/lib/layout/Tab.ts#L714)). **File:** `src/typescript/lib/layout/Tab.ts`.
7. **Mirror on `TabPanel`.** Import `TabDetachWindowMode` ([`TabPanel.ts:6`](../src/typescript/lib/component/container/TabPanel.ts#L6)); add `setTabDetachWindowMode`/`getTabDetachWindowMode` forwarding pair (model on [`setTabReorderable`/`isTabReorderable`](../src/typescript/lib/component/container/TabPanel.ts#L410)). **File:** `src/typescript/lib/component/container/TabPanel.ts`.
8. **Add the strip-mode branch to `detachTabToWindow`** ([`Tab.ts:2971`](../src/typescript/lib/layout/Tab.ts#L2971)): branch on `this._detachWindowMode`; build `new Panel({ layoutManager: new Tab({ reorderable: true }) })`, set the inner Tab's `_closeHostWindowWhenEmpty`, `win.moveComponent(strip)`, `win.setTearOffStripBody(true)`, `win.show()`, then `strip.moveComponent(content)` + `innerTab.createTab(content)`. Add the `_closeHostWindowWhenEmpty` field. **File:** `src/typescript/lib/layout/Tab.ts`.
9. **Add the auto-close hook.** Implement `closeHostWindowIfEmpty()`; call it at the tail of [`removeEntryKeepingContent`](../src/typescript/lib/layout/Tab.ts#L3037) and [`closeTab`](../src/typescript/lib/layout/Tab.ts#L3250). **File:** `src/typescript/lib/layout/Tab.ts`.
10. **Add the `Ctrl` early-return to `Window.onMouseDown`** ([`Window.ts:1042`](../src/typescript/lib/core/Window.ts#L1042)): `if (e.ctrlKey) return;`. **File:** `src/typescript/lib/core/Window.ts`.
11. **Add the header drag source + Ctrl-capture + tear-off-strip marker** to `Window`: `_headerDragCtrl`, `_headerDragComponentId`, `_tearOffStripBody` fields; `setTearOffStripBody`/`isTearOffStripBody`; `_boundCaptureHeaderCtrl` listener wired at [`Window.ts:240`](../src/typescript/lib/core/Window.ts#L240); `DragManager.makeDragSource(this._header, { dragData, onDragStart (veto unless Ctrl + content + !strip), onDragEnd (delete registry id; close if dropped && emptied) })`. Import `DragManager`, `DragData`, `TabDragData`, `tabDragRegistry`, `DragEventDetail` from `~/core/DragManager.js`. **File:** `src/typescript/lib/core/Window.ts`.
12. **Typecheck + cycle check.** `npx tsc --noEmit` — zero errors (a `Window`↔`Tab` cycle surfaces here). **No-manual-reparent checkpoint:** `grep -n "moveComponent\|addComponent\|removeComponent" src/typescript/lib/core/Window.ts` — the new code adds **no** content re-parent on the window side.
13. **Demo touch.** Both demo strips default to `"strip"` tear-off now; set the **second** demo `TabPanel`'s `tabOptions.detachWindowMode: "bare"` so the Ctrl-drag re-dock path is exercisable alongside the default strip path. The demo already builds two `reorderable: true` strips ([`TabDemoPanel.ts:140`](../src/typescript/TabDemoPanel.ts#L140), [`:169`](../src/typescript/TabDemoPanel.ts#L169)). **File:** `src/typescript/TabDemoPanel.ts`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `src/typescript/lib/core/DragManager.ts` — receive the moved `TabDragData` interface (exported) + `tabDragRegistry` module constant (internal) |
| Modify | `src/typescript/lib/core/Window.ts` — `Ctrl` early-return in `onMouseDown`; `_headerDragCtrl`/`_headerDragComponentId`/`_tearOffStripBody` fields, `setTearOffStripBody`/`isTearOffStripBody`, `_boundCaptureHeaderCtrl` listener, `DragManager.makeDragSource(this._header, …)` with Ctrl+content+!strip veto and dock-close `onDragEnd`; imports from `~/core/DragManager.js` |
| Modify | `src/typescript/lib/layout/Tab.ts` — move out `TabDragData`/`tabDragRegistry` (import from core); add `TabDetachWindowMode`, `TabOptions.detachWindowMode`, `_detachWindowMode`, `setDetachWindowMode`/`getDetachWindowMode`, `applyOptions` forward; strip-mode branch in `detachTabToWindow` + `_closeHostWindowWhenEmpty`; `closeHostWindowIfEmpty` hook in `removeEntryKeepingContent` and `closeTab` |
| Modify | `src/typescript/lib/component/container/TabPanel.ts` — import `TabDetachWindowMode`; add `setTabDetachWindowMode`/`getTabDetachWindowMode` forwarding pair |
| Modify | `src/typescript/lib/core/index.ts` — export `TabDragData` from the core barrel |
| Modify | `src/typescript/lib/layout/index.ts` — re-export `TabDragData` from `~/core/DragManager.js` (back-compat) |
| Modify | `docs/layouts/Tab.md` — document `detachWindowMode` and both re-dock gestures; re-point the `TabDragData` API link if the typedoc page moves buckets |
| Modify | `src/typescript/TabDemoPanel.ts` — set the second strip's `tabOptions.detachWindowMode: "bare"` to exercise both modes (strip is the default) |
| Modify (maybe) | `docs/core/Window.md` — a one-line note on the `Ctrl`-header-drag re-dock |

---

## Verification

- **Typecheck:** `npx tsc --noEmit` — zero errors. A reintroduced `Window`↔`Tab` cycle would fail here.
- **No-cycle / build:** `npm run build` — links with no circular-import load-order error.
- **Docs build:** `npm run docs:build` — **0 errors, 0 link warnings** (the pre-existing typedoc "unsupported TypeScript version" notice excepted). Confirm `TabDragData`'s generated page resolves and the `docs/layouts/Tab.md` link target points where typedoc emits it.
- **Marker/import checkpoints:** `grep -rn "interface TabDragData" src/typescript/lib/layout/Tab.ts` — none. `grep -rn "tabDragRegistry" src/typescript/lib/core/DragManager.ts` — declared once. `grep -rn "_closeHostWindowWhenEmpty" src/typescript/lib/layout/Tab.ts` — set only in `detachTabToWindow`, read only in `closeHostWindowIfEmpty`.
- **Runtime demo** ([`TabDemoPanel`](../src/typescript/TabDemoPanel.ts) at http://localhost:8015, `npm run dev`). Scope DevTools queries to `.TabDemoPanel .TabPanel`:
  - **`"strip"` mode tear-off (default):** with the default `detachWindowMode:"strip"`, tear a tab off → a floating window shows a **one-tab strip** hosting the live content.
  - **`"strip"` re-dock + self-close:** drag that inner tab out onto another reorderable strip → it docks as a new tab and the now-empty window **closes**. Closing the inner tab via its close button (if closeable) also closes the window.
  - **`"bare"` mode Ctrl-drag re-dock:** with the opt-in `detachWindowMode:"bare"`, tear a tab off, then hold `Ctrl` and drag the window header onto a strip → a new tab appears hosting the same live content and the emptied window closes.
  - **`"bare"` plain drag still moves:** drag the bare window header **without** `Ctrl` → it moves; no tab created; window stays open.
  - **Strip-window Ctrl-drag is inert:** Ctrl-dragging a `"strip"`-mode window's header is a no-op (vetoed); plain drag still moves it.
  - **Both modes leave reorder/dock intact:** same-strip reorder and cross-strip tab dock still work.
  - **Default unchanged:** a `Tab`/`TabPanel` without `detachWindowMode` tears off **bare** exactly as before.

---

## Documentation Impact

- **New `Tab.detachWindowMode` option + `TabDetachWindowMode` type** — surfaced on the layout barrel (Tab is already exported). Document in [`docs/layouts/Tab.md`](../docs/layouts/Tab.md#L188)'s **Tear-off & re-dock** section: the option selects bare vs. strip tear-off; document **both re-dock gestures** (bare → Ctrl-drag the window header; strip → drag the inner tab out, window self-closes). Note the `TabPanel` forwarding pair (`setTabDetachWindowMode`/`getTabDetachWindowMode`) and the `tabOptions.detachWindowMode` construction path.
- **`docs/layouts/Tab.md` — Tear-off & re-dock section:** rewrite the closing "Re-docking … is not part of this capability" paragraph ([:215-217](../docs/layouts/Tab.md#L215)) to describe both gestures and the mode option.
- **`TabDragData` changes buckets** (layout → core canonical). It is now exported from the core barrel [`core/index.ts`](../src/typescript/lib/core/index.ts#L50) (still re-exported from layout for back-compat). After `npm run docs:build`, the typedoc page may move from `api/layout/interfaces/TabDragData` to `api/core/interfaces/TabDragData`; **re-point doc links** (`grep -rln "interfaces/TabDragData" docs/`, currently [`docs/layouts/Tab.md`](../docs/layouts/Tab.md#L209)). Verify against built output — if typedoc still emits under `api/layout` due to the re-export, keep the existing target.
- **`docs/core/Window.md`** (optional): one line that a `Ctrl`-header-drag re-docks a bare window's content into a reorderable [`Tab`](/api/layout/classes/Tab) strip.
- **Cross-bucket JSDoc** — the new option's, `TabDragData`'s, and the `Window` drag-source JSDoc reference [`Tab`](/api/layout/classes/Tab), [`Window`](/api/core/classes/Window), [`DragManager`](/api/core/classes/DragManager), and [`Component.moveComponent`](/api/core/classes/Component#movecomponent) across buckets; use **markdown links, not `{@link}`**, per [`_shared/docs-conventions.md`](../.claude/skills/_shared/docs-conventions.md).
- No renames of public *symbols* (`TabDragData` keeps its name and shape; only its declaring module changes).

---

## Potential Challenges

- **Auto-close coupling `Tab` → `Window`** — a general `Tab` in a window must not close it. Mitigation: the close path is gated on the **internal** `_closeHostWindowWhenEmpty` flag, set **only** by `detachTabToWindow`'s strip branch, never a public option; `closeHostWindowIfEmpty` early-returns when it is `false`.
- **Ctrl-source firing on strip windows** — a strip window's body is the wrapper `Panel`, not a dockable panel. Mitigation: `detachTabToWindow`'s strip branch calls `win.setTearOffStripBody(true)`; the header source's `onDragStart` vetoes (`return false`) when `isTearOffStripBody()`.
- **Option propagation through `TabPanel`** — the option must reach the inner manager. Mitigation: it already flows via `tabOptions: { detachWindowMode }` (constructor pass-through); the forwarding setter/getter add runtime parity. `TabPanelOptions` deliberately re-declares **nothing** (matches `reorderable`).
- **Strip-body construction order** — `innerTab.createTab(content)` needs the content parented into the strip `Panel` first. Mitigation: follow `dockComponent`'s `moveComponent`-then-`createTab` order (`strip.moveComponent(content)` before `innerTab.createTab(content)`); settle the exact ordering at implementation against `createTab`'s constraint read.
- **Modifier key absent from `DragEventDetail`** — `onDragStart` cannot see `ctrlKey`. Mitigation: capture at header `mousedown` into `_headerDragCtrl`, read+clear in `onDragStart`, mirroring `Tab._dragMouseTarget`.
- **Gesture double-fire (bare)** — both the inline header `mousedown` (move) and the `DragManager` source fire on one press. Mitigation: the Ctrl gate makes them mutually exclusive; a vetoed not-yet-committed session fires no `onDragEnd` ([gated on `session.committed`](../src/typescript/lib/core/DragManager.ts#L578)).
- **Import cycle from the registry move** — leaving the symbols in `Tab.ts` and importing `Tab` from `Window` forms `Window`↔`Tab`. Mitigation: the symbols move to `DragManager.ts`, which imports neither. Verify at typecheck/build.
- **Registry cleanup after the content moved out (bare)** — post-dock `findBodyHost()` is `null`. Mitigation: stash the registered id at `onDragStart` (`_headerDragComponentId`) and delete by it unconditionally.
- **Window-close timing vs. `dockComponent`** — `dockComponent` runs synchronously in the target's `onDrop` (inside `DragManager.onMouseUp`) *before* the source's `onDragEnd` fires in `endSession`, so by the time `onDragEnd` checks emptiness the content is already moved out. No deferral race.
- **Existing inline-arrow `onMouseDown` wiring** — [`Window.ts:240`](../src/typescript/lib/core/Window.ts#L240) wires the move listener with an inline arrow, against the bound-field convention. The **new** Ctrl-capture listener uses the bound-field convention; do **not** refactor the pre-existing inline arrow (surgical-change rule).
- **`sourceTabId` collision (bare)** — a strip-shaped id would mis-route the drop as a same-strip reorder. Mitigation: stamp `this.getId()` (the window's id), never a strip toolbar id.

---

## Critical Files

- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `TabOptions` (207, `reorderable` 255 — mirror site for `detachWindowMode`); `applyOptions` (671, `reorderable` forward 714); `_reorderable` field (579 — beside `_detachWindowMode`); `setReorderable`/`isReorderable` (1345/1370 — setter/getter template); `createTab` (1867); `detachTabToWindow` (2971, branch site); `dockComponent` (3002, `moveComponent`-then-`createTab` template); `removeEntryKeepingContent` (3037, auto-close hook site + dragged-out path); `onTabDragEnd` (2934); `closeTab` (3250, auto-close hook site + close-last-tab path); `selectNextTab` (3298); `TabDragData` (57-66, to move out), `tabDragRegistry` (74, to move out); `getParentComponent` usage (161, the walk-up idiom); `Window` import (9), `Panel` import (8).
- [`src/typescript/lib/component/container/TabPanel.ts`](../src/typescript/lib/component/container/TabPanel.ts) — Tab-type imports (6); `TabPanelOptions` (30, `tabOptions` 43 — no new field); `new Tab(options?.tabOptions)` (84); `setTabReorderable`/`isTabReorderable` (410/421, forwarding template).
- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — `Window` (135); `Border` layout; `_header` NORTH; header `mousedown` move-listener (240, inline arrow); `onMouseDown` (1042, Ctrl early-return); `findBodyHost()` (1432, **private** — body content / emptiness); `requestClose()` (534).
- [`src/typescript/lib/core/DragManager.ts`](../src/typescript/lib/core/DragManager.ts) — `DragData` (15), `DragEventDetail` (24, **no** modifier field), `DragSourceOptions.onDragEnd?` (62, present); module state (135-137, where `tabDragRegistry` lands); `makeDragSource` (179); `onSourceMouseDown` (264); `onDragStart` veto + `commitSession` (446/452); `onMouseUp` then `endSession` (`onDragEnd` gated on `committed` 578).
- [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts#L50) — the core barrel `export type { … }` line that gains `TabDragData`.
- [`src/typescript/lib/layout/index.ts`](../src/typescript/lib/layout/index.ts#L16) — the layout barrel re-export line to re-source from core.
- [`docs/layouts/Tab.md`](../docs/layouts/Tab.md#L188) — the Tear-off & re-dock section.
- [`src/typescript/TabDemoPanel.ts`](../src/typescript/TabDemoPanel.ts#L134) — the two `reorderable: true` strips (140, 169); `tabOptions` block at 136/166.

---

## Non-Goals

- **A third tear-off layout** — only `"bare"` and `"strip"` are offered; no nested-split or multi-tab tear-off.
- **Edge-drop-to-split** — dropping on a panel edge to create a split is plan #3 ([`edge-drop-to-split.md`](edge-drop-to-split.md)); this plan docks whole content onto a tab strip only.
- **A general dock/tab manager** — persisted layouts, multi-region docking, the region-wiring sweep are plan #5 ([`dock-tab-manager.md`](dock-tab-manager.md)).
- **Public control of the auto-close flag** — `_closeHostWindowWhenEmpty` is internal, set only by strip-mode detach; it is not a `TabOptions` field and a general `Tab` never closes its host window.
- **Non-`Ctrl` modifiers / touch / keyboard re-dock** — only `Ctrl`+mouse-drag of a bare window header is wired.
- **New theme tokens** — reuses the existing `--ts-ui-drag-*` family and `Window` theming.
