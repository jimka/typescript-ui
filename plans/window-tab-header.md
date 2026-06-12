---
depends-on:
  - window-redock.md
touches-shared:
  - src/typescript/lib/layout/Tab.ts
  - src/typescript/lib/core/Window.ts
  - src/typescript/lib/component/container/WindowHeader.ts
---

# Strip-Mode Tear-off Window Tab-Header — Implementation Plan

## Overview

A strip-mode tear-off window currently shows **two stacked bars of chrome**: the [`WindowHeader`](../src/typescript/lib/component/container/WindowHeader.ts#L43) in the Border NORTH region (title + minimize/maximize/close) and, directly below it in CENTER, the inner [`Tab`](../src/typescript/lib/layout/Tab.ts#L502) strip's toolbar showing the single tab button. The redundancy is produced by [`fillWindowWithStrip`](../src/typescript/lib/layout/Tab.ts#L3059), which builds `new Tab({reorderable:true})`, wraps it in a `Panel` strip, drops the strip into the window body (CENTER), flags the window `setTearOffStripBody(true)`, and re-parents the content into the strip's single tab.

The goal: in **strip mode only**, collapse the `WindowHeader` and **promote the inner Tab strip's toolbar to be the window's title bar** — the tab bar *is* the header, VS-Code / browser-tabs-in-the-titlebar style. The window controls (min/max/close) move into the strip as Tab *tools*, the empty header area still drags the window, dragging a tab still re-docks/reorders, and the window title derives from the tab(s) rather than an independent label. Docking more tabs grows the bar into a genuine multi-tab strip.

This is scoped strictly to windows where [`isTearOffStripBody()`](../src/typescript/lib/core/Window.ts#L1217) is `true`. Bare-mode windows and ordinary `Window`s are untouched. It builds on the strip-mode tear-off shipped in [`window-redock.md`](implemented/window-redock.md) and is a **standalone** prerequisite of `dock-tab-manager.md` #5 — not folded into it.

---

## Architecture Decisions

### Approach (b) — suppress `WindowHeader`, promote the strip toolbar to title bar

Two candidates were weighed:

- **(a) `WindowHeader` hosts the tab buttons.** The header region would re-parent or mirror the inner `Tab` toolbar's tab buttons while keeping its own trailing controls. Rejected: it duplicates the tab DnD surface (the strip's drag sources, the `_clipFrame` drop target, the reorder bar, the selection indicator all live on the toolbar/clip-frame element tree — re-hosting them in the header means re-wiring all of it, or running two parallel toolbars), and it fights the one-element-per-class rule because `WindowHeader` would then own both a title row *and* a foreign component's tab cells.

- **(b) Suppress the `WindowHeader`, promote the strip toolbar (chosen).** The strip's toolbar already *is* a tab bar with working DnD, an indicator, a reorder bar, a tool-group slot, and overflow scrolling. We collapse the NORTH `WindowHeader` to zero and let the strip Panel (CENTER) become the visual top of the window. The window controls become Tab tools via the existing `addTool` slot. Window-move is driven by a drag affordance on the toolbar's empty area. This **reuses every piece of existing tab DnD untouched**, respects one-element-per-class (the toolbar owns tabs, the tool-group owns controls, no class owns two roles), and leaves the window-move + 8-border resize machinery intact (only the move *trigger* element changes).

The decision lives behind one boolean on `Tab` (`_windowTabHeader`, set only on the auto-created inner strip) plus one collapse flag on `Window`, both gated by `isTearOffStripBody()`.

### Collapse the header by detaching it from NORTH — not by hiding it (primary decision)

This is the central mechanism, and the obvious lever is wrong. `Component.setVisible(false)` maps to CSS **`visibility:hidden`** ([`Component.setVisible`](../src/typescript/lib/core/Component.ts#L1205): it sets the `visibility` rule to `"hidden"`), which leaves the element's box — and therefore its layout-computed `getPreferredSize()` — entirely intact. Border, the window body's layout manager, reads the NORTH child's size in three places: [`Border.getPreferredSize`](../src/typescript/lib/layout/Border.ts#L494) (`innerHeight += size.height`), [`Border.getMinSize`](../src/typescript/lib/layout/Border.ts#L565), and [`Border.doLayout`](../src/typescript/lib/layout/Border.ts#L782) (which reads `this._northComponent.getPreferredSize().height` to position CENTER below it). None of these consult `visibility`, so a `setVisible(false)` header still reserves its full preferred height in NORTH — leaving exactly the empty double-bar gap this plan exists to remove.

`setDisplayed(false)` (CSS `display:none`) is also insufficient: it removes the rendered box, but Border still reads the header's *layout-computed* `getPreferredSize()`, which is derived from the header's own child layout (title row + trailing button row), not from the rendered box — so NORTH height is unchanged. Zeroing the header via `setPreferredSize(0,0)` + `setMinSize(0,0)` also fails: [`getPreferredSize`](../src/typescript/lib/core/Component.ts#L1965) clamps the explicit preferred up to the *effective* `getMinSize`, and [`getMinSize`](../src/typescript/lib/core/Component.ts#L2054) returns the **max** of the component's own min and its **layout manager's** intrinsic min (the title/button rows) — which `setMinSize` cannot lower. And [`Border.setRegionCollapsed(Placement.NORTH, true)`](../src/typescript/lib/layout/Border.ts#L239) is the wrong tool too: it runs the animated collapse pass that **leaves an opaque `COLLAPSE_STRIP_SIZE` collapse strip** (NORTH contributes `COLLAPSE_STRIP_SIZE` instead of 0 in `getPreferredSize`/`getMinSize`) plus a chevron gutter — visible chrome we are trying to eliminate.

The verified primitive: **remove the header from the NORTH region while keeping the `_header` instance alive.** Border guards every size/layout read on `this._northComponent != null`, and [`Border.delLayoutConstraints`](../src/typescript/lib/layout/Border.ts#L162) nulls `_northComponent` when its component is removed from the container. So `this.removeComponent(this._header)` drops the NORTH region to a true 0 px — confirmed because `getPreferredSize`/`getMinSize`/`computeTotalMinSize`/`doLayout` all skip the `if (this._northComponent)` block entirely, adding nothing to `innerHeight` and laying CENTER out at `y = 0`. `Window.setHeaderCollapsed(true)` performs this detach (and `setHeaderCollapsed(false)` re-adds it via `addComponent(this._header, { placement: Placement.NORTH, ignoreParentInsets: true })`, the exact constraints the constructor used at [Window.ts:242](../src/typescript/lib/core/Window.ts#L242)).

The header **instance must stay alive** because it owns the min/max/close *listeners* Window wired at construction ([Window.ts:246–249](../src/typescript/lib/core/Window.ts#L246)), the active-state gradient (`setActive`), the `getMinContentWidth` min-size seed already consumed once at [Window.ts:294](../src/typescript/lib/core/Window.ts#L294), and the `getText()` the title-reflection path reads. Detaching the component from the container removes its DOM element but preserves the instance and its listeners/text; nothing is stranded. The window controls in the promoted bar are *new* Tab-tool buttons whose handlers call public `Window` methods (`requestClose`, `minimize`/`maximize` — see below), so behaviour is identical without re-rendering the detached header. In strip mode the header is never restored (the window closes when the strip empties — see *Scope guard*), so the detached state is terminal; `setHeaderCollapsed(false)` exists only for symmetry/correctness.

This keeps `WindowHeader` a single-responsibility title bar (untouched in normal/bare windows) and avoids teaching it a second "I am a tab strip" mode.

### Window controls as Tab tools, pinned trailing

The promoted bar needs min/max/close at the trailing edge. The `Tab` strip already pins tools opposite the tabs via [`addTool`](../src/typescript/lib/layout/Tab.ts#L1422)/`_toolGroup` (a hand-positioned overlay, not a tab cell — so it never collides with the tab cells and the tab/`_tabs` index alignment is preserved). The inner strip's tab alignment is already `"start"` (the [`_align` default](../src/typescript/lib/layout/Tab.ts#L539) — *not* an explicit option passed to `new Tab(...)`), so tabs hug the leading edge and the three control buttons added as tools land at the trailing edge exactly as the strip's tool group already lays out. Honour the non-closeable contract by routing the close tool's enabled state through the existing [`syncHostWindowCloseable`](../src/typescript/lib/layout/Tab.ts#L3193) path (see below).

### New public `Window` control surface — `minimize` / `maximize` (added)

The control tools must drive the same window-state transitions the header buttons do, but the header's own handlers wire to [`toggleMinimize`](../src/typescript/lib/core/Window.ts#L824) / [`toggleMaximize`](../src/typescript/lib/core/Window.ts#L840), which are **`private`** — calling them from inside `Tab` would not compile (only [`requestClose`](../src/typescript/lib/core/Window.ts#L563) is public among the three). Decision: **make `toggleMinimize()` and `toggleMaximize()` public** (rename-free; just widen the access modifier). They already carry the `isMinimizable()` / `isMaximizable()` guards and the toggle semantics, so they are the exact behaviour the bar's controls want — wiring the tools to them reproduces the header buttons one-for-one. This adds two methods to `Window`'s public surface (flagged below in *CODE_CONVENTIONS compliance*); `setWindowState` stays the lower-level primitive they delegate to. The close tool keeps calling the already-public `requestClose()`.

### Gesture arbitration — tab-drag vs window-move

There must be exactly one gesture per press. Today:

- The strip toolbar's tab **wrappers** are DragManager drag sources (tab DnD). A press on a tab cell runs tab DnD; the cell consumes the press.
- A press on the **empty toolbar area** (outside any tab cell, outside the tool group) currently does nothing.

`Window`'s move is driven by an `Event.addListener(this._header, "mousedown", onMouseDown)` on the *header* ([Window.ts:255](../src/typescript/lib/core/Window.ts#L255)). Since the header is detached from NORTH, that listener never fires in strip mode. We attach an **equivalent move trigger to the strip toolbar's empty area**: a `mousedown` listener on the toolbar element that starts the window move *only when the press did not land on a tab cell, the tool group, or the clip frame's tab cells*. The early-return target test must mirror the existing [`recordMouseTarget`](../src/typescript/lib/layout/Tab.ts#L2827) veto's neighbourhood — bail when `e.target` is inside any tab wrapper, the `_toolGroup` element, or `_clipFrame` (the same elements the close-button/reorder DnD veto already keys off). The existing tab drag sources own the tab cells (DragManager begins its gesture on `mousemove` after a tab `mousedown`), and `Window.onMouseDown` registers its viewport `mousemove`/`mouseup` move listeners synchronously on the toolbar `mousedown`; the two do not both claim the same press because the toolbar move listener early-returns when `e.target` is inside a tab wrapper / the tool group / the clip frame. Shift is still reserved (early-return) so the Shift-gated re-dock path is unaffected, and Ctrl stays free for snap-resize.

The move trigger is wired from `Tab` (it knows which toolbar element and which window) by calling a small `Window` entry point — `Window.startMoveFrom(e)` — that runs the same body as `onMouseDown`. This avoids exposing the private drag fields and keeps the move logic single-sourced in `Window`.

### Title derivation from the tab(s)

The window title is no longer independent. The inner strip drives the (hidden) `WindowHeader`'s text and the window's identity from the tab labels:

- **One tab** — the bar reads like a titled window: the single tab button shows the label; the detached header's text is synced to that label (so minimized docking and serialization still report a sensible title via `getText`).
- **Multiple tabs** — the bar is a real multi-tab strip; the detached header's text falls back to the active tab's label (used only by the minimized dock strip, which shows just the title bar — i.e. the promoted tab bar — so the visible result is still the tab row).

Syncing is done in the same `syncHostWindowCloseable` neighbourhood (a new sibling `syncHostWindowTitle`) so all host-window reflection happens in one place. The actual `syncHostWindowCloseable` call sites are **only three** — [`createTab`](../src/typescript/lib/layout/Tab.ts#L1924), [`removeEntryKeepingContent`](../src/typescript/lib/layout/Tab.ts#L3145), and [`closeTab`](../src/typescript/lib/layout/Tab.ts#L3442) (`dockComponent` inherits it transitively through its `createTab` call; `reorderTab` does **not** call it). `syncHostWindowTitle` mirrors those three. But unlike closeable, the title also changes when the **active tab changes with no add/remove** — single-tab mode shows the active tab's label, and switching tabs changes which label is "active". So `syncHostWindowTitle` needs **one hook `syncHostWindowCloseable` lacks**: the active-tab funnel [`onTabPressed`](../src/typescript/lib/layout/Tab.ts#L1468), through which every selection change routes (`setActiveTabIndex`, `openTabMenu`, `selectNextTab`, and direct tab-button clicks all call it). `reorderTab` preserves the selected entry, so the active label is unchanged by a reorder and needs no extra hook there.

### Scope guard

Every behaviour above is gated. On the `Tab` side a private `_windowTabHeader` boolean is set **only** in `fillWindowWithStrip` (same-class private write, mirroring the existing [`_closeHostWindowWhenEmpty`](../src/typescript/lib/layout/Tab.ts#L592) precedent) — never by public option, so no consumer can turn an ordinary strip into a window header. On the `Window` side the header-collapse and `startMoveFrom` wiring run only when `isTearOffStripBody()` is true. Bare windows (`isTearOffStripBody()` false) and normal windows take none of these branches.

The control tools never outlive the strip: `removeEntryKeepingContent` and `closeTab` both call [`closeHostWindowIfEmpty`](../src/typescript/lib/layout/Tab.ts#L3179) → `hostWindow().requestClose()` on last-tab removal, and the merged `Tab` `empty` event already closes the host window on the same path — so the promoted bar (and its control tools) is destroyed with the window the moment the strip empties. This is benign: no teardown of the tools or the move trigger is needed beyond pushing the move-trigger listener onto `_dndTeardowns` (which `detach`/`teardownTabDnD` already drain). The [`onHeaderDragStart`](../src/typescript/lib/core/Window.ts#L1170) `isTearOffStripBody()` veto still keeps the detached header's drag source inert in strip mode, so the Shift-drag re-dock claims for the *bare* mode are unaffected (a strip-mode window has no live header drag source to begin with).

### CODE_CONVENTIONS compliance

- **One element per class** — preserved: no class gains a second DOM role. The promoted bar is still the `Tab` toolbar element; controls are ordinary `Button` tools in the existing tool-group overlay; `WindowHeader` keeps its single title-bar element (merely detached from the live tree while the instance lives on).
- **Typed setters + cached field + XOptions forwarding** — the one new *public* DOM-affecting setter is `Window.setHeaderCollapsed(value: boolean)` backed by `_headerCollapsed: boolean`. It is **not** added to `WindowOptions`: it is an internal mode flipped only by the strip-mode tear-off, never a construction-time consumer option (mirroring `setTearOffStripBody`, which is likewise setter-only with no option field). This is a deliberate, documented deviation from the "every new property gets an XOptions field" guideline — flagged here per the skill. `Tab._windowTabHeader` is a private flag, not a DOM property, so it needs no setter/option.
- **Widened access on `toggleMinimize` / `toggleMaximize`** — these two `Window` methods change from `private` to `public` so `Tab` can wire the bar's control tools to them (see *New public `Window` control surface*). No signature or body change; this is a surface-widening only, flagged here per the skill. They are not setters/options, so no field or XOptions entry applies.
- **Event class** — all new listeners go through `Event.addListener` / `Event.addSubtreeListener`, matching the existing toolbar mousedown wiring.
- **callable() wrapping** — no new exported class; `WindowHeader`/`Window`/`Tab` keep their existing callable exports.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/core/Window.ts
class Window extends Panel<WindowOptions> {
    // New internal mode: detach the WindowHeader from the Border NORTH region
    // (instance kept alive) so a strip-mode tear-off's promoted tab bar is the
    // sole top chrome and NORTH reserves a true 0 px.
    // Backing field: private _headerCollapsed: boolean = false.
    // Setter-only (no WindowOptions field) — flipped only by strip-mode tear-off.
    setHeaderCollapsed(value: boolean): this;
    isHeaderCollapsed(): boolean;

    // Public move entry point so the promoted tab bar (owned by Tab) can start
    // a window move on an empty-area press. Runs the same body as onMouseDown.
    startMoveFrom(e: MouseEvent): void;

    // Access widened from private → public so the promoted bar's control tools
    // can drive the same state transitions the header buttons do. Bodies/guards
    // unchanged (isMinimizable/isMaximizable + toggle semantics).
    toggleMinimize(): void;
    toggleMaximize(): void;
}
```

```typescript
// src/typescript/lib/layout/Tab.ts — no new public API.
// Private only:
//   private _windowTabHeader: boolean = false;   // set only in fillWindowWithStrip
//   private installWindowControls(win: Window): void;
//   private syncHostWindowTitle(): void;
//   private installWindowMoveTrigger(win: Window): void;
```

`WindowHeader` gains **no new public API** — `setHeaderCollapsed` lives on `Window` and acts on the header by removing it from / re-adding it to the Border NORTH region (`removeComponent(this._header)` / `addComponent(this._header, { placement: Placement.NORTH, ignoreParentInsets: true })`); the existing `getMinimizeButtonElement` etc. are reused by the `targetIsInTrailingButton` guard only on the non-collapsed (normal/bare) path.

---

## Internal Structure

**Promoted bar layout (strip mode, one tab):**

```
┌─ Window element (Border) ──────────────────────────────────┐
│  NORTH: WindowHeader  → detached from region (0px, no box) │
│  CENTER: strip Panel (Tab layout)                           │
│    ┌─ _toolbar (the promoted title bar) ─────────────────┐ │
│    │ [ Tab label ............ ]      [▁] [□] [✕]  (tools) │ │  ← drag empty area = move window
│    └──────────────────────────────────────────────────────┘ │
│    content area (selected tab's component)                  │
│  8× WindowBorder resize overlays (unchanged)                │
└────────────────────────────────────────────────────────────┘
```

**`fillWindowWithStrip` body order (Tab.ts:3059, current):** `win.moveComponent(strip)` → `win.setTearOffStripBody(true)` → `strip.moveComponent(content)` → `innerTab.createTab(content)` → `win.show()`. The new install steps slot in **after `createTab`** (so the tab exists for title/closeable sync) and **before `win.show()`** (so the collapsed header and the tools are in place at first paint, no flash of the double bar):

```
win.moveComponent(strip);
win.setTearOffStripBody(true);
strip.moveComponent(content);
innerTab.createTab(content);

// --- new strip-mode-header wiring, all before win.show() ---
innerTab._windowTabHeader = true;        // same-class private write, this strip only
win.setHeaderCollapsed(true);            // detach NORTH header → 0 px
innerTab.installWindowControls(win);     // add min/max/close as trailing tools
innerTab.installWindowMoveTrigger(win);  // empty-area toolbar press → win.startMoveFrom
innerTab.syncHostWindowTitle();          // seed detached header text from the tab

win.show();
```

**`installWindowMoveTrigger` (Tab.ts):** one `Event.addListener(this._toolbar, "mousedown", …)` that early-returns when `e.shiftKey`, or when `e.target` is inside any tab wrapper element, the `_toolGroup` element, or `_clipFrame` — the same neighbourhood the existing `recordMouseTarget` veto (Tab.ts:2827) keys off; otherwise calls `win.startMoveFrom(e)`. Teardown closure pushed onto `_dndTeardowns` so it is removed in `teardownTabDnD`/`detach`.

**`Window.setHeaderCollapsed` (Window.ts):** caches `_headerCollapsed` (early-return when unchanged), then `value ? this.removeComponent(this._header) : this.addComponent(this._header, { placement: Placement.NORTH, ignoreParentInsets: true })`, and schedules a layout. Because Border guards every NORTH read on `this._northComponent != null` and `delLayoutConstraints` nulls it on removal, the NORTH contribution becomes a true 0 px (no `COLLAPSE_STRIP_SIZE`, no chevron) — verified against `Border.getPreferredSize`/`getMinSize`/`computeTotalMinSize`/`doLayout`, all of which skip the `if (this._northComponent)` block when it is null. The `_header` instance and its listeners/text survive the detach.

---

## Ordered Implementation Steps

1. **`Window.setHeaderCollapsed` / `isHeaderCollapsed`** — add `_headerCollapsed` field; the typed setter detaches `this._header` from NORTH via `removeComponent` (restores via `addComponent(…, { placement: Placement.NORTH, ignoreParentInsets: true })`) and schedules layout; add the getter. The detach is the verified zero-NORTH primitive — `setVisible`/`setDisplayed`/`setPreferredSize`+`setMinSize`/`setRegionCollapsed` all fail to drop NORTH to 0 (see *Collapse the header by detaching it*). → verify: a collapsed-header window's body has NO reserved NORTH height (CENTER lays out at y=0); an un-collapsed one is unchanged.

2. **`Window.startMoveFrom(e)`** — extract the body of `onMouseDown` (Tab.ts/Window.ts:1097 — the Shift/`windowState` guards, origin snapshot, will-change, viewport listener registration) into `startMoveFrom`, and have `onMouseDown` delegate to it. No behaviour change for normal windows. → verify: dragging a normal window header still moves it.

3. **Make `Window.toggleMinimize` / `toggleMaximize` public** — widen the access modifier on both (Window.ts:824, :840); no body change. The header's own button listeners already call them, so existing behaviour is unaffected.

4. **`Tab._windowTabHeader` flag** — add the private field; set it in `fillWindowWithStrip` only.

5. **`Tab.installWindowControls(win)`** — build three chromeless `Button` tools (min/max/close glyphs matching `WindowHeader`'s — `window-minimize` / `window-maximize` / `xmark`) and `addTool` them; wire their `action` handlers to `win.toggleMinimize()`, `win.toggleMaximize()`, `win.requestClose()` (all now public). → verify: clicking each control in the float performs the matching window action.

6. **`Tab.installWindowMoveTrigger(win)`** — add the empty-area `mousedown` move trigger described above (early-return on `e.shiftKey` / tab-wrapper / `_toolGroup` / `_clipFrame` targets, mirroring `recordMouseTarget`); push its teardown onto `_dndTeardowns`. → verify: dragging the empty bar area moves the window; dragging a tab still runs tab DnD; dragging a control does neither (it clicks).

7. **`Tab.syncHostWindowTitle()`** — set the (detached) header text to the active tab's label (single tab → that label; multi → active tab's label), gated on `_windowTabHeader` so non-window strips are no-ops. Call it from `fillWindowWithStrip` and from the **three** `syncHostWindowCloseable` call sites — `createTab` (Tab.ts:1924), `removeEntryKeepingContent` (Tab.ts:3145), `closeTab` (Tab.ts:3442) — **plus** the active-tab funnel `onTabPressed` (Tab.ts:1468), which `syncHostWindowCloseable` does not need but the title does (selection change re-points "active" with no add/remove). Not from `reorderTab` (preserves the active entry) and not separately from `dockComponent` (covered transitively via `createTab`). → verify: switching the active tab in a multi-tab float updates the title; reordering does not spuriously change it.

8. **Wire `fillWindowWithStrip`** — after the existing `createTab`, set `_windowTabHeader`, call `setHeaderCollapsed(true)`, `installWindowControls`, `installWindowMoveTrigger`, and `syncHostWindowTitle`, all **before** the existing `win.show()`. → verify: a fresh strip-mode tear-off shows ONE bar (tab + controls), no double chrome, no flash of the header at open.

9. **Non-closeable contract** — confirm `syncHostWindowCloseable` already disables the *window's* close (it calls `win.setCloseable(...)` at Tab.ts:3200), then make the close **tool** track it too: have `syncHostWindowCloseable` (or `installWindowControls`'s handler) read `win.isCloseable()` and `setEnabled` the close tool button accordingly, so a non-closeable held tab greys the bar's close. → verify: dock a non-closeable tab into the float; the bar's close greys out; remove it; close re-enables.

10. **Regression checkpoints** — `grep -rn 'isTearOffStripBody' src/typescript/lib` to confirm every new branch is gated by it; visually confirm bare-mode (`detachWindowMode:"bare"`) and ordinary `new Window(...)` are unchanged.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | src/typescript/lib/core/Window.ts |
| Modify | src/typescript/lib/layout/Tab.ts |
| Modify | docs/layouts/Tab.md |

(`WindowHeader.ts` is **not** modified — collapse is driven from `Window` by detaching the existing `_header` from the NORTH region; listed in `touches-shared` only as a precaution for in-flight plans.)

---

## Verification

- **Typecheck**: `tsc -p tsconfig.lib.json --noEmit` → 0 errors.
- **Docs build**: `npm run docs:build` → 0 errors, 0 new link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- **Grep invariant**: every new mode branch is reachable only behind `isTearOffStripBody()` / `_windowTabHeader` — `grep -rn '_windowTabHeader\|isTearOffStripBody' src/typescript/lib`.
- **Runtime smoke (Tab demo, `TabDemoPanel` — its first `TabPanel` is strip-mode, `reorderable:true`, default `detachWindowMode:"strip"`):**
  1. Tear a tab off the first strip → the float shows **one** merged bar (tab label + min/max/close), no second toolbar below it.
  2. Drag the **empty** bar area → the window moves; release inside viewport keeps it on-screen.
  3. Drag the **tab** out onto the source strip → it re-docks and the emptied float auto-closes.
  4. Min / max / close on the bar → each performs the matching window action (`toggleMinimize` / `toggleMaximize` / `requestClose`). Note: the header's `dblclick`-to-maximize is on the *detached* header, so double-clicking the empty bar does not maximize in strip mode — out of scope unless a move-trigger dblclick hook is added.
  5. Dock a **second** tab into the float (drag a tab from the strip onto the float's bar) → the bar grows into a two-tab strip; controls stay pinned trailing without colliding; switching between the two tabs updates the window title to the active tab's label.
  6. Dock a **non-closeable** tab → the bar's close greys; remove it → close re-enables.
  7. The **second** `TabPanel` (`detachWindowMode:"bare"`) tear-off and an ordinary `new Window(...)` are visually and behaviourally unchanged (full `WindowHeader`, Shift/Ctrl-drag re-dock intact).

---

## Documentation Impact

Update the **Tear-off & re-dock** section of [`docs/layouts/Tab.md`](../docs/layouts/Tab.md#L199) (the `"strip"` mode bullet under *Re-docking a floating window*, L224): note that a strip-mode tear-off window now renders its tab strip *as* the window title bar (merged header), that the window title derives from the tab label(s), and that dragging the empty bar moves the window while min/max/close sit as trailing controls honouring the non-closeable contract. No new exported symbol, so no barrel/`index.md`/sidebar change and no new API page — `setHeaderCollapsed`/`startMoveFrom` are internal-mode methods, and `toggleMinimize`/`toggleMaximize` (now public) appear on the `Window` API page automatically (document all with JSDoc). Confirm no cross-bucket `{@link}` is introduced that needs a markdown link.

---

## Potential Challenges

- **Detached header re-render on restore** — `setHeaderCollapsed(false)` re-adds the instance to NORTH; mitigation: re-add with the constructor's exact constraints (`{ placement: Placement.NORTH, ignoreParentInsets: true }`). In strip mode restore never runs (the window closes on empty), so this path is only exercised by the symmetry of the setter.
- **Move-vs-drag press ambiguity** — a press that lands on the toolbar's *under-border* sliver or between tab cells must resolve to exactly one gesture; mitigation: the move trigger's early-return tests `e.target` containment against the tab-wrapper, `_toolGroup`, and `_clipFrame` elements (mirroring `recordMouseTarget`), and DragManager only escalates a tab press to a drag on `mousemove`, so a click that doesn't move still selects the tab.
- **Title sync timing** — `syncHostWindowTitle` reads the active tab's label; call it after `createTab`/dock/close/select so the label exists. Mitigation: the three `syncHostWindowCloseable` call sites plus `onTabPressed` (the active-tab funnel).
- **`getHeader().getText()` consumers** (serialization, minimized dock) — keep the detached header's text synced so those keep reporting a real title rather than the stale construction label.

---

## Critical Files

- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `fillWindowWithStrip` (L3059), `installTabDnD`/`recordMouseTarget`/`makeTabDragSource`/`makeTabDropTarget` (L2820+), `addTool`/`_toolGroup` (L1422/L559), `createTab` (L1910), `onTabPressed` (L1468), `reorderTab` (L3301), `hostWindow`/`closeHostWindowIfEmpty`/`syncHostWindowCloseable` (L3161/L3179/L3193), `_closeHostWindowWhenEmpty` precedent (L592).
- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — constructor header wiring (L234–296), `onMouseDown` (L1097), `setTearOffStripBody`/`isTearOffStripBody` (L1208/L1217), `onHeaderDragStart` veto (L1170), `setCloseable`/`isCloseable` (L899/L911), `requestClose` (L563), `toggleMinimize`/`toggleMaximize` (L824/L840 — make public), `setWindowState` (L743), `findBodyHost` (L1606), `setHeaderText`/`getHeader` (L656/L349).
- [`src/typescript/lib/component/container/WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts) — title row + trailing min/max/close (L56–111), `setCloseable` (L221), `getText` (inherited from `Header`), `setActive` (L200), `getMinContentWidth` (L356) — read to confirm detaching the header from NORTH strands no listener or seed.
- [`src/typescript/lib/layout/Border.ts`](../src/typescript/lib/layout/Border.ts) — NORTH contribution in `getPreferredSize` (L494), `getMinSize` (L565), `computeTotalMinSize` (L689), `doLayout` (L782); `delLayoutConstraints` nulls the region on removal (L162); `setRegionCollapsed` (L239, the *rejected* lever — leaves a collapse strip).
- [`src/typescript/TabDemoPanel.ts`](../src/typescript/TabDemoPanel.ts) — strip-mode first `TabPanel` (L134) and bare-mode second (L168), the smoke-test surface.

---

## Non-Goals

- **Bare mode** (`detachWindowMode:"bare"`) — content fills the window body with no inner strip; its full `WindowHeader` and Shift-drag re-dock stay exactly as shipped. Out of scope by definition.
- **Ordinary `Window` styling** — non-tear-off windows are untouched.
- **`Dock` integration / `dock-tab-manager.md` #5** — #5 builds on this; this plan delivers only the merged header for strip-mode tear-offs.
- **Per-tab close affordance in the bar** vs the window close tool — the existing per-tab close button (when `closeable`) is unchanged; this plan adds the *window* controls only.
- **New theme tokens** — the promoted bar reuses the existing tab-toolbar and titlebar-button tokens; no new CSS custom properties.
