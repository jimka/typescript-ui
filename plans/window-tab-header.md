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

A strip-mode tear-off window currently shows **two stacked bars of chrome**: the [`WindowHeader`](../src/typescript/lib/component/container/WindowHeader.ts#L43) in the Border NORTH region (title + minimize/maximize/close) and, directly below it in CENTER, the inner [`Tab`](../src/typescript/lib/layout/Tab.ts#L495) strip's toolbar showing the single tab button. The redundancy is produced by [`fillWindowWithStrip`](../src/typescript/lib/layout/Tab.ts#L3050), which builds `new Tab({reorderable:true})`, wraps it in a `Panel` strip, drops the strip into the window body (CENTER), flags the window `setTearOffStripBody(true)`, and re-parents the content into the strip's single tab.

The goal: in **strip mode only**, collapse the `WindowHeader` and **promote the inner Tab strip's toolbar to be the window's title bar** — the tab bar *is* the header, VS-Code / browser-tabs-in-the-titlebar style. The window controls (min/max/close) move into the strip as Tab *tools*, the empty header area still drags the window, dragging a tab still re-docks/reorders, and the window title derives from the tab(s) rather than an independent label. Docking more tabs grows the bar into a genuine multi-tab strip.

This is scoped strictly to windows where [`isTearOffStripBody()`](../src/typescript/lib/core/Window.ts#L1215) is `true`. Bare-mode windows and ordinary `Window`s are untouched. It builds on the strip-mode tear-off shipped in [`window-redock.md`](implemented/window-redock.md) and is a **standalone** prerequisite of `dock-tab-manager.md` #5 — not folded into it.

---

## Architecture Decisions

### Approach (b) — suppress `WindowHeader`, promote the strip toolbar to title bar

Two candidates were weighed:

- **(a) `WindowHeader` hosts the tab buttons.** The header region would re-parent or mirror the inner `Tab` toolbar's tab buttons while keeping its own trailing controls. Rejected: it duplicates the tab DnD surface (the strip's drag sources, the `_clipFrame` drop target, the reorder bar, the selection indicator all live on the toolbar/clip-frame element tree — re-hosting them in the header means re-wiring all of it, or running two parallel toolbars), and it fights the one-element-per-class rule because `WindowHeader` would then own both a title row *and* a foreign component's tab cells.

- **(b) Suppress the `WindowHeader`, promote the strip toolbar (chosen).** The strip's toolbar already *is* a tab bar with working DnD, an indicator, a reorder bar, a tool-group slot, and overflow scrolling. We collapse the NORTH `WindowHeader` to zero and let the strip Panel (CENTER) become the visual top of the window. The window controls become Tab tools via the existing `addTool` slot. Window-move is driven by a drag affordance on the toolbar's empty area. This **reuses every piece of existing tab DnD untouched**, respects one-element-per-class (the toolbar owns tabs, the tool-group owns controls, no class owns two roles), and leaves the window-move + 8-border resize machinery intact (only the move *trigger* element changes).

The decision lives behind one boolean on `Tab` (`_windowTabHeader`, set only on the auto-created inner strip) plus one collapse flag on `Window`, both gated by `isTearOffStripBody()`.

### Collapse the header, don't delete it

`WindowHeader` stays added in NORTH (it owns the min/max/close *listeners* Window wired at construction, the active-state gradient, and the `getMinContentWidth` min-size seed). Rather than removing it — which would strand `addExitButtonListener`/`toggleMinimize`/`toggleMaximize` and the `setActive` focus highlight — we **hide it and zero its region** via a new `Window.setHeaderCollapsed(true)`. The window controls in the promoted bar are *new* Tab-tool buttons whose click handlers call the same `Window` methods (`requestClose`, `toggleMinimize`, `toggleMaximize`), so behaviour is identical without re-plumbing the hidden header.

This keeps `WindowHeader` a single-responsibility title bar (untouched in normal/bare windows) and avoids teaching it a second "I am a tab strip" mode.

### Window controls as Tab tools, pinned trailing

The promoted bar needs min/max/close at the trailing edge. The `Tab` strip already pins tools opposite the tabs via [`addTool`](../src/typescript/lib/layout/Tab.ts#L1411)/`_toolGroup` (a hand-positioned overlay, not a tab cell — so it never collides with the tab cells and the tab/`_tabs` index alignment is preserved). The inner strip is built with `align: "start"` (tabs hug the leading edge) and the three control buttons are added as tools, landing at the trailing edge exactly as the strip's tool group already lays out. Honour the non-closeable contract by routing the close tool's enabled state through the existing [`syncHostWindowCloseable`](../src/typescript/lib/layout/Tab.ts#L3180) path (see below).

### Gesture arbitration — tab-drag vs window-move

There must be exactly one gesture per press. Today:

- The strip toolbar's tab **wrappers** are DragManager drag sources (tab DnD). A press on a tab cell runs tab DnD; the cell consumes the press.
- A press on the **empty toolbar area** (outside any tab cell, outside the tool group) currently does nothing.

`Window`'s move is driven by an `Event.addListener(this._header, "mousedown", onMouseDown)` on the *header*. Since the header is collapsed, that listener never fires in strip mode. We attach an **equivalent move trigger to the strip toolbar's empty area**: a `mousedown` listener on the toolbar element that starts the window move *only when the press did not land on a tab cell, the tool group, or a control button*. The existing tab drag sources own the tab cells (DragManager begins its gesture on `mousemove` after a tab `mousedown`), and `Window.onMouseDown` registers its viewport `mousemove`/`mouseup` move listeners synchronously on the toolbar `mousedown`; the two do not both claim the same press because the toolbar move listener early-returns when `e.target` is inside a tab wrapper / the tool group. Shift is still reserved (early-return) so the Shift-gated re-dock path is unaffected, and Ctrl stays free for snap-resize.

The move trigger is wired from `Tab` (it knows which toolbar element and which window) by calling a small `Window` entry point — `Window.startMoveFrom(e)` — that runs the same body as `onMouseDown`. This avoids exposing the private drag fields and keeps the move logic single-sourced in `Window`.

### Title derivation from the tab(s)

The window title is no longer independent. The inner strip drives the (hidden) `WindowHeader`'s text and the window's identity from the tab labels:

- **One tab** — the bar reads like a titled window: the single tab button shows the label; the hidden header text is synced to that label (so minimized docking and serialization still report a sensible title via `getText`).
- **Multiple tabs** — the bar is a real multi-tab strip; the hidden header text falls back to the active tab's label (used only by the minimized dock strip, which shows just the title bar — i.e. the promoted tab bar — so the visible result is still the tab row).

Syncing is done in the same `syncHostWindowCloseable` neighbourhood (a new sibling `syncHostWindowTitle`) so all host-window reflection happens in one place, called from the same mutation points (`createTab`, dock, close, reorder).

### Scope guard

Every behaviour above is gated. On the `Tab` side a private `_windowTabHeader` boolean is set **only** in `fillWindowWithStrip` (same-class private write, mirroring the existing `_closeHostWindowWhenEmpty` precedent) — never by public option, so no consumer can turn an ordinary strip into a window header. On the `Window` side the header-collapse and `startMoveFrom` wiring run only when `isTearOffStripBody()` is true. Bare windows (`isTearOffStripBody()` false) and normal windows take none of these branches.

### CODE_CONVENTIONS compliance

- **One element per class** — preserved: no class gains a second DOM role. The promoted bar is still the `Tab` toolbar element; controls are ordinary `Button` tools in the existing tool-group overlay; `WindowHeader` keeps its single title-bar element (merely hidden).
- **Typed setters + cached field + XOptions forwarding** — the one new *public* DOM-affecting setter is `Window.setHeaderCollapsed(value: boolean)` backed by `_headerCollapsed: boolean`. It is **not** added to `WindowOptions`: it is an internal mode flipped only by the strip-mode tear-off, never a construction-time consumer option (mirroring `setTearOffStripBody`, which is likewise setter-only with no option field). This is a deliberate, documented deviation from the "every new property gets an XOptions field" guideline — flagged here per the skill. `Tab._windowTabHeader` is a private flag, not a DOM property, so it needs no setter/option.
- **Event class** — all new listeners go through `Event.addListener` / `Event.addSubtreeListener`, matching the existing toolbar mousedown wiring.
- **callable() wrapping** — no new exported class; `WindowHeader`/`Window`/`Tab` keep their existing callable exports.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/core/Window.ts
class Window extends Panel<WindowOptions> {
    // New internal mode: collapse the WindowHeader to zero height and hide it,
    // so a strip-mode tear-off's promoted tab bar is the sole top chrome.
    // Backing field: private _headerCollapsed: boolean = false.
    // Setter-only (no WindowOptions field) — flipped only by strip-mode tear-off.
    setHeaderCollapsed(value: boolean): this;
    isHeaderCollapsed(): boolean;

    // Public move entry point so the promoted tab bar (owned by Tab) can start
    // a window move on an empty-area press. Runs the same body as onMouseDown.
    startMoveFrom(e: MouseEvent): void;
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

`WindowHeader` gains **no new public API** — `setHeaderCollapsed` lives on `Window` and acts on the header via `setVisible(false)`; the existing `getMinimizeButtonElement` etc. are reused by the targetIsInTrailingButton guard only on the non-collapsed path.

---

## Internal Structure

**Promoted bar layout (strip mode, one tab):**

```
┌─ Window element (Border) ──────────────────────────────────┐
│  NORTH: WindowHeader  → collapsed (visible:false, 0px)     │
│  CENTER: strip Panel (Tab layout)                           │
│    ┌─ _toolbar (the promoted title bar) ─────────────────┐ │
│    │ [ Tab label ............ ]      [▁] [□] [✕]  (tools) │ │  ← drag empty area = move window
│    └──────────────────────────────────────────────────────┘ │
│    content area (selected tab's component)                  │
│  8× WindowBorder resize overlays (unchanged)                │
└────────────────────────────────────────────────────────────┘
```

**`fillWindowWithStrip` additions (Tab.ts):** after the existing strip wiring and before `win.show()`:

```
innerTab._windowTabHeader = true;
win.setHeaderCollapsed(true);          // hide the redundant NORTH header
innerTab.installWindowControls(win);   // add min/max/close as trailing tools
innerTab.installWindowMoveTrigger(win);// empty-area toolbar press → win.startMoveFrom
// (existing) strip.moveComponent(content); innerTab.createTab(content);
innerTab.syncHostWindowTitle();        // seed hidden header text from the tab
```

**`installWindowMoveTrigger` (Tab.ts):** one `Event.addListener(this._toolbar, "mousedown", …)` that early-returns when `e.shiftKey`, or when `e.target` is inside any tab wrapper element, the `_toolGroup` element, or `_clipFrame`'s tab cells; otherwise calls `win.startMoveFrom(e)`. Teardown closure pushed onto `_dndTeardowns` so it is removed in `teardownTabDnD`/`detach`.

**`Window.setHeaderCollapsed` (Window.ts):** caches `_headerCollapsed`, calls `this._header.setVisible(value ? false : true)`, and schedules a layout. With the header hidden, Border's NORTH `getPreferredSize` contribution must read 0 — verify the hidden header reports a null/zero preferred size (Component.setVisible(false) → display:none → no box); if Border still reserves the region, collapse it via the existing `setRegionCollapsed(Placement.NORTH, …)` path **or** by leaving the header out of the preferred-height sum while hidden (confirm in `Border.getPreferredSize`/`doLayout` which one is needed during implementation).

---

## Ordered Implementation Steps

1. **`Window.setHeaderCollapsed` / `isHeaderCollapsed`** — add `_headerCollapsed` field, typed setter that hides `this._header` and schedules layout, and the getter. Verify the NORTH region drops to 0px when collapsed (read `Border.getPreferredSize`/`doLayout`; if the hidden component still contributes height, hide it *and* zero the region). → verify: a collapsed-header window shows no title bar; an un-collapsed one is unchanged.

2. **`Window.startMoveFrom(e)`** — extract the body of `onMouseDown` (the Shift/`windowState` guards, origin snapshot, will-change, viewport listener registration) into `startMoveFrom`, and have `onMouseDown` delegate to it. No behaviour change for normal windows. → verify: dragging a normal window header still moves it.

3. **`Tab._windowTabHeader` flag** — add the private field; set it in `fillWindowWithStrip` only.

4. **`Tab.installWindowControls(win)`** — build three chromeless `Button` tools (min/max/close glyphs matching `WindowHeader`'s) and `addTool` them; wire their `action` handlers to `win.toggleMinimize()`, `win.toggleMaximize()`, `win.requestClose()`. → verify: clicking each control in the float performs the matching window action.

5. **`Tab.installWindowMoveTrigger(win)`** — add the empty-area `mousedown` move trigger described above; push its teardown onto `_dndTeardowns`. → verify: dragging the empty bar area moves the window; dragging a tab still runs tab DnD; dragging a control does neither (it clicks).

6. **`Tab.syncHostWindowTitle()`** — set the hidden header text to the active tab's label (single tab → that label; multi → active tab's label). Call it from `fillWindowWithStrip`, and alongside every existing `syncHostWindowCloseable()` call site (`createTab` path, `dockComponent`, `removeEntryKeepingContent`/close, reorder) — gate the body on `_windowTabHeader` so non-window strips are no-ops.

7. **Wire `fillWindowWithStrip`** — set `_windowTabHeader`, call `setHeaderCollapsed(true)`, `installWindowControls`, `installWindowMoveTrigger`, and `syncHostWindowTitle`, all before/around the existing `createTab` + `show()`. → verify: a fresh strip-mode tear-off shows ONE bar (tab + controls), no double chrome.

8. **Non-closeable contract** — confirm `syncHostWindowCloseable` already disables the *window's* close, then make the close **tool** track it too: have `syncHostWindowCloseable` (or `installWindowControls`'s handler) read `win.isCloseable()` and `setEnabled` the close tool button accordingly, so a non-closeable held tab greys the bar's close. → verify: dock a non-closeable tab into the float; the bar's close greys out; remove it; close re-enables.

9. **Regression checkpoints** — `grep -rn 'isTearOffStripBody' src/typescript/lib` to confirm every new branch is gated by it; visually confirm bare-mode (`detachWindowMode:"bare"`) and ordinary `new Window(...)` are unchanged.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | src/typescript/lib/core/Window.ts |
| Modify | src/typescript/lib/layout/Tab.ts |
| Modify | docs/layouts/Tab.md |

(`WindowHeader.ts` is **not** modified — collapse is driven from `Window` via the existing `setVisible`; listed in `touches-shared` only as a precaution for in-flight plans.)

---

## Verification

- **Typecheck**: `tsc -p tsconfig.lib.json --noEmit` → 0 errors.
- **Docs build**: `npm run docs:build` → 0 errors, 0 new link warnings (typedoc's "unsupported TypeScript version" notice is the lone acceptable warning).
- **Grep invariant**: every new mode branch is reachable only behind `isTearOffStripBody()` / `_windowTabHeader` — `grep -rn '_windowTabHeader\|isTearOffStripBody' src/typescript/lib`.
- **Runtime smoke (Tab demo, `TabDemoPanel` — its first `TabPanel` is strip-mode, `reorderable:true`, default `detachWindowMode:"strip"`):**
  1. Tear a tab off the first strip → the float shows **one** merged bar (tab label + min/max/close), no second toolbar below it.
  2. Drag the **empty** bar area → the window moves; release inside viewport keeps it on-screen.
  3. Drag the **tab** out onto the source strip → it re-docks and the emptied float auto-closes.
  4. Min / max / close on the bar → each performs the matching window action; double-click empty bar maximizes (if still wired) — confirm or note as out of scope.
  5. Dock a **second** tab into the float (drag a tab from the strip onto the float's bar) → the bar grows into a two-tab strip; controls stay pinned trailing without colliding.
  6. Dock a **non-closeable** tab → the bar's close greys; remove it → close re-enables.
  7. The **second** `TabPanel` (`detachWindowMode:"bare"`) tear-off and an ordinary `new Window(...)` are visually and behaviourally unchanged (full `WindowHeader`, Shift/Ctrl-drag re-dock intact).

---

## Documentation Impact

Update the **Tear-off & re-dock** section of [`docs/layouts/Tab.md`](../docs/layouts/Tab.md#L188) (the `"strip"` mode bullet under *Re-docking a floating window*, ~L213): note that a strip-mode tear-off window now renders its tab strip *as* the window title bar (merged header), that the window title derives from the tab label(s), and that dragging the empty bar moves the window while min/max/close sit as trailing controls honouring the non-closeable contract. No new exported symbol, so no barrel/`index.md`/sidebar change and no new API page — `setHeaderCollapsed`/`startMoveFrom` are internal-mode methods (document with JSDoc; they appear on the `Window` API page automatically). Confirm no cross-bucket `{@link}` is introduced that needs a markdown link.

---

## Potential Challenges

- **Hidden header still reserving NORTH height** — Border may sum a hidden child's preferred height; mitigation: zero it via `setRegionCollapsed(Placement.NORTH)` or skip hidden children in the height sum (decide by reading `Border.doLayout` at implementation time, step 1).
- **Move-vs-drag press ambiguity** — a press that lands on the toolbar's *under-border* sliver or between tab cells must resolve to exactly one gesture; mitigation: the move trigger's early-return tests `e.target` containment against the tab-wrapper and tool-group elements, and DragManager only escalates a tab press to a drag on `mousemove`, so a click that doesn't move still selects the tab.
- **Title sync timing** — `syncHostWindowTitle` reads the active tab's label; call it after `createTab`/dock/close so the label exists. Mitigation: mirror the exact call sites of `syncHostWindowCloseable`.
- **`getHeader().getText()` consumers** (serialization, minimized dock) — keep the hidden header's text synced so those keep reporting a real title rather than the stale construction label.

---

## Critical Files

- [`src/typescript/lib/layout/Tab.ts`](../src/typescript/lib/layout/Tab.ts) — `fillWindowWithStrip` (L3050), `installTabDnD`/`makeTabDragSource`/`makeTabDropTarget` (L2813+), `addTool`/`_toolGroup` (L1411), `hostWindow`/`closeHostWindowIfEmpty`/`syncHostWindowCloseable` (L3148–3188), `attach` (L1568), `_closeHostWindowWhenEmpty` precedent (L585).
- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — constructor header wiring (L241–268), `onMouseDown` (L1097), `setTearOffStripBody`/`isTearOffStripBody` (L1206–1217), `setCloseable`/`isCloseable` (L899), `requestClose` (L563), `toggleMinimize`/`toggleMaximize`, `findBodyHost` (L1604), `setHeaderText`/`getHeader` (L656/L349).
- [`src/typescript/lib/component/container/WindowHeader.ts`](../src/typescript/lib/component/container/WindowHeader.ts) — title row + trailing min/max/close (L56–110), `setCloseable` (L221), `getText` (inherited from `Header`), `setActive` (L200) — read to confirm collapsing via `setVisible` strands nothing.
- [`src/typescript/lib/layout/Border.ts`](../src/typescript/lib/layout/Border.ts) — NORTH region preferred-height contribution (L494) and `setRegionCollapsed` (L239), to choose the header-zeroing mechanism.
- [`src/typescript/TabDemoPanel.ts`](../src/typescript/TabDemoPanel.ts) — strip-mode first `TabPanel` (L134) and bare-mode second (L168), the smoke-test surface.

---

## Non-Goals

- **Bare mode** (`detachWindowMode:"bare"`) — content fills the window body with no inner strip; its full `WindowHeader` and Shift-drag re-dock stay exactly as shipped. Out of scope by definition.
- **Ordinary `Window` styling** — non-tear-off windows are untouched.
- **`Dock` integration / `dock-tab-manager.md` #5** — #5 builds on this; this plan delivers only the merged header for strip-mode tear-offs.
- **Per-tab close affordance in the bar** vs the window close tool — the existing per-tab close button (when `closeable`) is unchanged; this plan adds the *window* controls only.
- **New theme tokens** — the promoted bar reuses the existing tab-toolbar and titlebar-button tokens; no new CSS custom properties.
