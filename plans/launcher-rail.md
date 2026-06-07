# Rail — Implementation Plan

## Overview

A `Rail` is an edge-anchored rail that sits along one viewport edge and holds a
strip of collapsed handles. Each handle is a button that toggles an associated
panel open/closed. It is the persistent "launcher strip" counterpart to the
overlay [`Drawer`](../src/typescript/lib/core/Drawer.ts) just shipped — but
unlike a Drawer it does not slide off-screen and is never auto-dismissed; it is
always present.

The Rail lives in `src/typescript/lib/core/Rail.ts` (core band, alongside
`Drawer.ts`, `Window.ts`, `LayerManager.ts`). It supports two mutually exclusive
layout modes selected by an option: **overlay** (`Position.FIXED`, floats over
app content, mirrors Drawer's portaled-surface pattern) and **reserve-space**
(claims an edge strip; app content is inset around it, like an OS taskbar). It
hosts caller-created `Drawer` instances (composition — `registerDrawer` /
`unregisterDrawer`), rendering one handle per drawer and reflecting each drawer's
open/closed state on its handle by subscribing through the drawer's public
typed `on` ([`Drawer.on`](../src/typescript/lib/core/Drawer.ts#L670)). It also
accepts a `Window`'s minimize affordance: a window can minimize *into the rail*
as a rail item that restores the window on click.

The rail's internal layout is an [`HBox`](../src/typescript/lib/layout/HBox.ts)
(for NORTH/SOUTH edges) or [`VBox`](../src/typescript/lib/layout/VBox.ts) (for
WEST/EAST edges) of handle buttons. The edge model reuses the same
`Exclude<Placement, Placement.CENTER>` axis Drawer uses, cross-referenced as
[`DrawerEdge`](../src/typescript/lib/core/Drawer.ts#L23).

---

## Architecture Decisions

### Two layout modes, one component — but reserve-space is an opt-in contract

`Rail` exposes a `mode: "overlay" | "reserve-space"` option. The two modes share
all rail-rendering code (the handle HBox/VBox, the drawer/window registries, the
edge geometry) and differ only in **how the rail's root element is mounted and
how it claims its strip**:

- **Overlay mode** mirrors Drawer exactly. The Rail sets `Position.FIXED` in its
  constructor body (the documented FIXED carve-out applied after `super()`, like
  Drawer at [Drawer.ts:193](../src/typescript/lib/core/Drawer.ts#L193)), mounts
  on `document.documentElement`, and stamps a viewport-edge resting rect from the
  current edge + thickness + viewport (identical shape to Drawer's
  `restingRect` / `applyRestingGeometry`). App content renders *under* it.

- **Reserve-space mode** mounts the Rail as an **absolutely-positioned child of
  the host container** (default `Body.getInstance()`, overridable via a `host`
  option) and reserves its strip by writing the host's `setInsets()` along the
  docked edge. Because `Body`'s layout manager lays its content out within
  `getInnerSize()` (inset-reduced), the host's content (the `Tab` in
  [main.ts:31](../src/typescript/main.ts#L31)) is squeezed off the reserved edge
  automatically — no Border-region plumbing required. The Rail element itself is
  `Position.ABSOLUTE` and parked in the reserved strip by `doLayout` math (x/y/
  width/height derived from the edge and the host's *outer* size), so the
  "positioning is always absolute" rule holds (FIXED is reserved for the overlay
  carve-out; reserve-space is plain ABSOLUTE inside Body).

  **Honest-API flag.** A single `Rail` *can* do both modes, because reserving
  space is "set the host's edge inset + park an absolute child in that inset" —
  it does **not** require the host to place the Rail in a Border region. The one
  caller obligation in reserve-space mode is that the **host must own a layout
  manager that honours `getInnerSize()`** (every framework `LayoutManager` does:
  `Tab`, `Border`, `HBox`, `VBox`, `Fit`). `Body` qualifies out of the box. This
  is stated in JSDoc and demoed against `Body`. We deliberately do **not** add a
  Border-region integration mode — that would be a second, redundant mechanism;
  the inset approach composes with any host layout, including a `Border` whose
  center is the app.

  **Rule tension (flagged):** reserve-space mode mutates a *foreign* component's
  insets (`host.setInsets`). This is the one place the Rail reaches outside its
  own subtree. It is mitigated by (a) only ever writing the single docked-edge
  inset, caching the host's prior inset on that edge and restoring it on
  `unmount()` / mode-flip, and (b) routing through the host's public typed
  `setInsets` setter — no DOM poke. It is the minimal mechanism that satisfies
  "content inset around an edge strip" without inventing a root-panel region API.

### Not a `DismissableLayer` — and not in the layer tree at all

A persistent rail is never dismissed by an outside click, never Escape-closes,
and is not raised/re-stamped on activation. Registering it with `LayerManager`
(as Drawer/Window do) would only buy z-band allocation and dismissal — both
unwanted. So `Rail` does **not** implement `DismissableLayer` and does **not**
call `LayerManager.register`. In overlay mode it carries a fixed z-index just
below the Window band (a plain module constant, `RAIL_Z_INDEX = 8900`, mirroring
how `LayerManager`'s bands are plain constants because z-index is unthemed) so
windows, popovers, and dialogs still stack above the rail. In reserve-space mode
z-index is irrelevant (the strip is carved out, nothing overlaps it) but the
same stamp is harmless.

The hosted `Drawer`s keep their own `LayerManager` registration (they register
on `open()` as today) — the Rail does not interfere with that.

### Rail ↔ Drawer composition contract

The caller constructs `Drawer`s and calls `rail.registerDrawer(drawer, { glyph?, text? })`.
For each registered drawer the Rail:

1. Creates a `RailHandle` (its own `Button` subclass — see one-element-per-class
   below) and adds it to the rail's HBox/VBox.
2. Subscribes to the drawer's open/close via the drawer's **public typed `on`**
   (`drawer.on("open", …)` / `drawer.on("close", …)`) — never the raw `Event`
   API, never the drawer's internals. The handler flips the handle's selected
   state (`handle.setSelected(true/false)`), so the rail always reflects live
   drawer state even when the drawer is toggled from elsewhere.
3. Wires the handle's `"action"` to `drawer.toggle()`.
4. **Aligns the drawer's edge to the Rail's edge by default** (calls
   `drawer.setEdge(this.getEdge())`), so a registered drawer slides out from the
   rail it lives on — the intuitive default for a launcher strip. This is
   overridable per-registration via `alignEdge: false` in the register options
   for callers who want a drawer that opens from a different edge than its
   handle. Default `true` is chosen because a rail handle visually *is* the
   drawer's tab; a drawer flying in from the opposite edge would read as
   disconnected.

`unregisterDrawer(drawer)` removes the handle, `off()`s both subscriptions
(exact references held per-registration so the `ListenerBag.remove` matches), and
does **not** close or destroy the drawer (the caller owns the drawer's
lifecycle).

### Minimal additive Drawer change: expose `getEdge` is already public — none needed

`Drawer` already exposes `getEdge()` ([Drawer.ts:276](../src/typescript/lib/core/Drawer.ts#L276)),
`setEdge()`, the typed `on`/`off`, and the `"open"`/`"close"` events the Rail
needs. **No Drawer change is required** for the composition. (Edge alignment uses
the existing public `setEdge`; state sync uses the existing public `on`.) This is
called out explicitly so the implementer does not add a speculative affordance.

### Window-minimize ↔ Rail contract

`Window` today already has a built-in "minimize into a bottom-of-viewport rail"
behaviour: `WindowState = "minimized"`, `setWindowState("minimized")`, the
`computeDockRect` / `relayoutMinimizedStack` static stack, and the header
minimize button wired to `toggleMinimize`
([Window.ts:743](../src/typescript/lib/core/Window.ts#L743)). That is a
*self-docking* mechanism with no `Rail` component. We do **not** rip it out
(surgical-changes rule); instead we add an **opt-in** path: a window can be told
to minimize into a specific `Rail` instead of the bottom-edge stack.

New additive `Window` API:

- `setRail(rail: Rail | null): this` / `getRail(): Rail | null` — when a rail is
  attached, `setWindowState("minimized")` routes to the rail instead of the
  bottom strip.
- A new typed-event surface on `Window`. Window today has **no** `ListenerBag`
  (it uses the DOM-`Event`-based `on` inherited via Panel/Component for header
  buttons). To let the Rail react to minimize/restore without polling, Window
  gains a small `ListenerBag<WindowEvent>` where `WindowEvent = "minimize" | "restore" | "close"`,
  with protected `emit` and public `on`/`off` overloads — mirroring Drawer's
  event surface exactly (constructor-body listener dispatch, `declare`-free
  private field, protected `emit`). `setWindowState` fires `"minimize"` when
  entering `"minimized"` and `"restore"` when leaving it; `onExitAction` fires
  `"close"`.

Division of ownership:

- **Window owns**: the minimize button (already present), the `minimize()` /
  `restore()` convenience methods (thin wrappers over `setWindowState`), the
  `windowState` machine, the `"minimize"`/`"restore"`/`"close"` events, and
  hiding its body while minimized (already done via `setBodyHostDisplayed`).
- **Rail owns**: rendering a `RailHandle` for a minimized window, and on handle
  click calling `window.restore()`. When a docked window minimizes, the Rail
  creates a handle bearing the window's header text/glyph; when it restores or
  closes (via the new events), the Rail removes the handle. The Rail subscribes
  via `window.on("minimize"|"restore"|"close", …)` — the typed surface, not raw
  `Event`.

When a `Rail` is attached, `Window.setWindowState("minimized")` skips
`computeDockRect`/`relayoutMinimizedStack` (those drive the built-in bottom
strip) and instead hides the whole window element (`setVisible(false)` after the
collapse, or simply `setDisplayed(false)`) and emits `"minimize"`; the visible
representation becomes the Rail handle. Restore re-shows the window at
`_restoreRect` and emits `"restore"`. The built-in bottom-strip path is
unchanged when no rail is attached.

### Edge model

`type RailEdge = Exclude<Placement, Placement.CENTER>` — identical to
`DrawerEdge`. Re-export `DrawerEdge` rather than minting a second alias? No: a
distinct `RailEdge` name reads better at Rail call sites and the type is
structurally identical, so assignment between them is free. The default edge is
`Placement.WEST` (matches Drawer). WEST/EAST rails lay handles vertically
(`VBox`) at a fixed *width* (the rail thickness); NORTH/SOUTH rails lay handles
horizontally (`HBox`) at a fixed *height*.

### Handle is its own Component subclass (`RailHandle`)

One-DOM-element-per-class: a handle carries its own selected/active state and a
distinct themed treatment (hover/selected background), so it is a `Button`
subclass `RailHandle` in `src/typescript/lib/core/RailHandle.ts`, not a bare
`Button` configured at the call site. It adds a `setSelected(boolean)` /
`isSelected()` pair backed by `_selected` + a `selected?: boolean` option, which
toggles a selected-state style (using Button's existing `pressedStyleRule`-style
machinery is overkill; `RailHandle` applies the selected background through a
dedicated lazy `StyleRule` or a class toggle — implementer picks the lighter
path). `RailHandle` is internal to the Rail subsystem; it is exported from the
core barrel for typing the register-options return but is not a headline API.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/core/Rail.ts

/** Viewport edge a Rail rail anchors to. Structurally identical to DrawerEdge. */
export type RailEdge = Exclude<Placement, Placement.CENTER>;

/** Layout mode: float over content, or reserve an inset edge strip. */
export type RailMode = "overlay" | "reserve-space";

/** Events emitted by a Rail. */
export type RailEvent = "register" | "unregister";

/** Per-drawer registration options. */
export interface RailDrawerRegistration {
    /** Handle glyph (forwarded to the RailHandle's Button glyph). */
    glyph?: string;
    /** Handle label text. */
    text?: string;
    /**
     * When true (default), the Rail sets the drawer's edge to its own edge so
     * the drawer slides out from the rail. Pass false to leave the drawer's
     * edge untouched.
     * @defaultValue true
     */
    alignEdge?: boolean;
}

export interface RailOptions extends ComponentOptions {
    /** @defaultValue Placement.WEST */
    edge?: RailEdge;
    /** @defaultValue "overlay" */
    mode?: RailMode;
    /**
     * Rail thickness in px (width for WEST/EAST, height for NORTH/SOUTH).
     * @defaultValue 48
     */
    thickness?: number;
    /**
     * Host whose insets are written in reserve-space mode and into which the
     * rail mounts. Ignored in overlay mode (the rail mounts on documentElement).
     * @defaultValue Body.getInstance()
     */
    host?: Component;
    listeners?: {
        register?:   (drawer: Drawer | Window) => void;
        unregister?: (drawer: Drawer | Window) => void;
    };
}

class Rail extends Component<RailOptions> {
    constructor(options?: RailOptions, subclassDefaults?: Partial<RailOptions>);

    // typed setters (cache-only where geometry is derived in doLayout/mount)
    setEdge(edge: RailEdge): this;            // backing: _options.edge
    getEdge(): RailEdge;
    setRailMode(mode: RailMode): this;        // backing: _options.mode (named setRailMode, not setMode, to avoid clashing with any inherited concept)
    getRailMode(): RailMode;
    setThickness(px: number): this;           // backing: _options.thickness
    getThickness(): number;

    /** Mounts the rail (overlay: documentElement; reserve-space: host + inset). */
    mount(): this;
    /** Unmounts the rail and restores the host's prior edge inset. */
    unmount(): this;

    registerDrawer(drawer: Drawer, reg?: RailDrawerRegistration): this;
    unregisterDrawer(drawer: Drawer): this;

    /** Adds a handle for a minimized window; called by Window via its events. */
    registerWindow(window: Window): this;
    unregisterWindow(window: Window): this;

    on(event: RailEvent, listener: (target: Drawer | Window) => void): this;
    off(event: RailEvent, listener: (target: Drawer | Window) => void): this;
    protected emit(event: RailEvent, target: Drawer | Window): void;
}
```

```typescript
// src/typescript/lib/core/RailHandle.ts
export interface RailHandleOptions extends ButtonOptions {
    /** @defaultValue false */
    selected?: boolean;
}

class RailHandle extends Button<RailHandleOptions> {
    setSelected(value: boolean): this;   // backing: _options.selected (+ _selected style application)
    isSelected(): boolean;
}
```

```typescript
// Additive Window API (src/typescript/lib/core/Window.ts)
export type WindowEvent = "minimize" | "restore" | "close";

class Window /* ... */ {
    setRail(rail: Rail | null): this;    // backing: _rail field (not an option — runtime wiring)
    getRail(): Rail | null;
    minimize(): this;                    // sugar: setWindowState("minimized")
    restore(): this;                     // sugar: setWindowState(this._preMinimizeState)

    on(event: WindowEvent, listener: () => void): this;
    off(event: WindowEvent, listener: () => void): this;
    protected emit(event: WindowEvent): void;   // fired from setWindowState / onExitAction
}
```

No `Drawer` signature change.

---

## Theme Tokens

New `rail` block, mirroring how the `drawer` block was added (interface in
[Theme.ts:425](../src/typescript/lib/core/Theme.ts#L425), one block per theme in
`ModernTheme.ts` / `ClassicTheme.ts` / `DarkTheme.ts`, var emission in
[`themeToVars`](../src/typescript/lib/core/Theme.ts#L857)).

| CSS Custom Property              | Modern (light) Default                  | Dark Default                          | Purpose                              |
|---------------------------------|-----------------------------------------|---------------------------------------|--------------------------------------|
| `--ts-ui-rail-bg`               | `var(--ts-ui-body-bg)`                  | (dark surface)                        | Rail background                      |
| `--ts-ui-rail-border`           | `rgb(220, 220, 220)`                    | (dark divider)                        | Rail divider on its content-facing edge |
| `--ts-ui-rail-shadow`           | `2px 0 12px rgba(0,0,0,0.18)`           | (deeper)                              | Rail drop shadow (overlay mode only) |
| `--ts-ui-rail-handle-hover-bg`  | `rgba(30,100,200,0.08)`                 | (dark hover)                          | Handle hover wash                    |
| `--ts-ui-rail-handle-selected-bg` | `rgba(30,100,200,0.16)`               | (dark selected)                       | Handle selected wash (drawer open)   |

The `rail` interface block: `{ background: string; border: string; shadow: string; handle: { hoverBackground: string; selectedBackground: string; } }`.
Fill Classic with its grey palette equivalents and Dark with the dark palette,
matching the existing drawer/window entries in each theme file.

---

## Internal Structure

- Rail root: a `Component` (the `Rail` itself) with an `HBox`/`VBox` layout
  manager chosen by edge at mount time. Handles are added via the inherited
  `addComponent`.
- Per-registration bookkeeping: `Map<Drawer, { handle: RailHandle; onOpen: () => void; onClose: () => void; onAction: ClickListener }>` and a parallel `Map<Window, { handle; onMinimize; onRestore; onClose }>`. The stored closures are the exact references passed to `on`, so `off` matches.
- Reserve-space inset: cache `_priorHostInset: number` for the docked edge before writing `host.setInsets(...)`; restore it in `unmount`.
- Geometry (`doLayout` override for reserve-space; `applyRestingGeometry`-style for overlay): WEST → `{x:0, y:0, width:thickness, height:hostInnerHeight}`; EAST mirrored; NORTH/SOUTH span full width at `thickness` height. Re-derive on viewport resize via an `Event.addViewportListener(this, "resize", …)` (overlay) — reserve-space re-derives through the host's own resize-driven relayout.

---

## Ordered Implementation Steps

1. **Theme tokens.** Add the `rail` block to the `Theme` interface
   ([Theme.ts:425](../src/typescript/lib/core/Theme.ts#L425) area), to all three
   theme files (`ModernTheme.ts`, `ClassicTheme.ts`, `DarkTheme.ts`) beside their
   `drawer` blocks, and emit the five vars in `themeToVars`
   ([Theme.ts:857](../src/typescript/lib/core/Theme.ts#L857) area). Verify:
   `grep -rn 'ts-ui-rail' src/typescript/lib/core/Theme.ts` — expect the five
   var names; `npm run typecheck`.
2. **`RailHandle`** (`src/typescript/lib/core/RailHandle.ts`). `Button` subclass
   with `selected` option + `setSelected`/`isSelected`, applying
   `--ts-ui-rail-handle-selected-bg` / hover wash. Callable export pattern
   (`callable(RailHandle)` + `_RailHandle`/`RailHandle` exports), matching Drawer.
3. **`Rail`** (`src/typescript/lib/core/Rail.ts`). Options-bag-as-cache,
   `applyOptions` after `super`, constructor-body listener dispatch (the
   `_listeners` ListenerBag is undefined during the super cascade — the documented
   trap). Implement `mount`/`unmount`, edge geometry, both modes,
   `registerDrawer`/`unregisterDrawer` (subscribe via `drawer.on`), `registerWindow`/`unregisterWindow`,
   typed `on`/`off`/`emit`. Callable export.
4. **Window additive API.** Add `WindowEvent`, a `ListenerBag<WindowEvent>` field
   (`_windowListeners`), `on`/`off`/`emit` overloads, `setRail`/`getRail`,
   `minimize`/`restore`. In `setWindowState`, fire `"minimize"`/`"restore"`; when
   `_rail` is set, branch the `"minimized"` path to hide the window + emit instead
   of `computeDockRect`/`relayoutMinimizedStack`. Fire `"close"` in `onExitAction`.
   Dispatch any `options.listeners` for window events from the constructor body
   (Window has no `listeners` option today; add one to `WindowOptions` only if
   trivially additive — otherwise expose events via `on` only and skip the option,
   keeping the change minimal).
5. **Barrel exports.** Export `Rail`, `RailOptions`, `RailEdge`, `RailMode`,
   `RailEvent`, `RailDrawerRegistration`, `RailHandle`, `WindowEvent` from
   `src/typescript/lib/core/index.ts` (beside the Drawer/Window entries at
   [index.ts:21,36](../src/typescript/lib/core/index.ts#L21)).
6. **Demo wiring** in `MiscPanel.ts` beside the existing Drawer block
   ([MiscPanel.ts:580](../src/typescript/MiscPanel.ts#L580)): create a Rail,
   register two Drawers, attach a Window via `setRail`, and add buttons to flip
   `mode` between overlay and reserve-space.
7. **Docs** (see Documentation Impact).

---

## Files to Create / Modify / Delete

| Action | File |
|--------|------|
| Create | `src/typescript/lib/core/Rail.ts` |
| Create | `src/typescript/lib/core/RailHandle.ts` |
| Modify | `src/typescript/lib/core/Window.ts` (additive events + `setRail`/`minimize`/`restore`) |
| Modify | `src/typescript/lib/core/Theme.ts` (rail interface block + themeToVars) |
| Modify | `src/typescript/lib/core/themes/ModernTheme.ts` (rail block) |
| Modify | `src/typescript/lib/core/themes/ClassicTheme.ts` (rail block) |
| Modify | `src/typescript/lib/core/themes/DarkTheme.ts` (rail block) |
| Modify | `src/typescript/lib/core/index.ts` (barrel exports) |
| Modify | `src/typescript/MiscPanel.ts` (demo) |
| Create | `docs/core/rail.md` + sidebar/catalog entries (see Documentation Impact) |

No deletions — the built-in Window bottom-strip rail stays.

---

## Verification

- `npm run typecheck` — clean.
- `grep -rn 'ts-ui-rail' src/typescript/lib/core/Theme.ts` — five var names emitted; `grep -rn 'rail' src/typescript/lib/core/themes/*.ts` — block present in all three.
- `npm run docs:build` — 0 errors, 0 link warnings (the typedoc "unsupported TypeScript version" notice is the only acceptable warning).
- Manual smoke on the **Misc.** demo screen (`npm run dev`, http://localhost:8015):
  1. **Overlay mode:** rail floats over content; registered-drawer handles toggle their drawers; a drawer opened from elsewhere flips its handle's selected state (state sync).
  2. **Reserve-space mode:** flip the mode; app content (the Tab) insets away from the rail's edge; rail sits flush in the reserved strip; flipping back restores the host's inset (no leftover gap).
  3. **Window-minimize/restore:** a window with `setRail(rail)` minimizes into a Rail handle (window hidden, handle appears); clicking the handle restores the window to its prior rect; closing a minimized window removes its handle.
  4. **Drawer-handle state sync:** open/close a hosted drawer via its own Close button and confirm the rail handle's selected wash follows.
  5. **Theme toggle:** switch Modern/Classic/Dark; rail bg/border/shadow and handle hover/selected washes re-skin from the tokens.

---

## Documentation Impact

- `Rail`, `RailHandle`, and the new `Window` symbols are exported from the
  per-subpath barrel `src/typescript/lib/core/index.ts` (there is no root barrel).
- Add a curated page `docs/core/rail.md` covering both modes, the Drawer
  composition, and the Window-minimize integration; add it to the `docs/core/`
  catalog `index.md` and the sidebar in `docs/.vitepress/config.mts`.
- Update the existing `Drawer` and `Window` curated pages with a cross-reference
  to `Rail` (markdown links across buckets, not `{@link}` — per
  `_shared/docs-conventions.md`).
- JSDoc on every new public symbol (options, setters, register API, events) per
  the callable-export + JSDoc conventions.

---

## Potential Challenges

- **Foreign-inset mutation in reserve-space mode** is the riskiest piece — cache and restore the host's prior docked-edge inset precisely, and re-resolve geometry on host resize. Mitigation: write only the single edge inset, restore on `unmount`/mode-flip.
- **Window's `"minimized"` branch is dense** (`_restoreRect`, `_preMinimizeState`, `setBodyHostDisplayed`, the static stack). Add the rail branch as an early fork that bypasses `computeDockRect`/`relayoutMinimizedStack` without disturbing the no-rail path. Mitigation: gate the entire new behaviour on `this._rail !== null`.
- **Listener-reference symmetry** — store the exact `on` closures per registration so `off`/`ListenerBag.remove` match (the framework's `ListenerBag.add` appends; mismatched refs leak). Mitigation: the per-registration bookkeeping maps above.
- **Mode flip while mounted** must tear down the previous mount cleanly (overlay element on `documentElement` vs. child-of-host + host inset). Mitigation: `setRailMode` calls `unmount()` then `mount()` when already mounted.
- **Super-cascade traps** — the `_listeners` ListenerBag, any `declare`-needed fields, and setters that must defer DOM work (mirror Drawer's notes at [Drawer.ts:195](../src/typescript/lib/core/Drawer.ts#L195)). Mitigation: dispatch `options.listeners` from the constructor body; cache geometry in setters and apply in `mount`/`doLayout`.

---

## Critical Files

- [`src/typescript/lib/core/Drawer.ts`](../src/typescript/lib/core/Drawer.ts) — the overlay pattern to mirror (options-bag-as-cache, `applyOptions`, constructor-body listener dispatch, typed `on`/`off`/`emit`, `restingRect`/`applyRestingGeometry`/`offscreenTransform`, callable export, `DrawerEdge`).
- [`src/typescript/lib/core/Window.ts`](../src/typescript/lib/core/Window.ts) — `WindowState` machine, `setWindowState`, `computeDockRect`/`relayoutMinimizedStack`, `onExitAction`, header minimize wiring; the additive-events surface lands here.
- [`src/typescript/lib/core/LayerManager.ts`](../src/typescript/lib/core/LayerManager.ts) — bands and the `DismissableLayer` contract the Rail deliberately does *not* implement.
- [`src/typescript/lib/core/Body.ts`](../src/typescript/lib/core/Body.ts) + [`src/typescript/main.ts`](../src/typescript/main.ts) — the host whose insets reserve-space mode writes; confirms Body sizes from viewport and clears insets, and lays out via a `Tab`.
- [`src/typescript/lib/layout/Border.ts`](../src/typescript/lib/layout/Border.ts), `HBox.ts`/`VBox.ts` — the rail's internal layout and the `getInnerSize`-honouring contract reserve-space relies on.
- [`src/typescript/lib/component/button/Button.ts`](../src/typescript/lib/component/button/Button.ts) — `RailHandle`'s superclass.
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) + the three theme files — the `drawer` block is the template for the new `rail` block.
- [`src/typescript/MiscPanel.ts`](../src/typescript/MiscPanel.ts) — demo home, beside the Drawer block at line 580.

---

## Non-Goals

- **Not removing or replacing** Window's built-in bottom-of-viewport minimize stack — the Rail path is opt-in via `setRail`; the default self-docking behaviour is untouched (surgical-changes rule).
- **No Border-region integration mode.** Reserve-space is done via host insets, which composes with any host layout; a second region-based mechanism would be redundant.
- **No drag-to-reorder of handles, no overflow/scroll for an over-full rail, no collapse/expand of the rail itself** — out of scope for the first cut.
- **No multi-edge single Rail** — one Rail anchors one edge; a caller wanting rails on two edges constructs two Rails.
- **No dependence on `plans/size-constraint-invariant.md`** — the Rail uses a fixed `thickness` and full cross-axis span, so the unimplemented min ≤ preferred ≤ max fix does not gate it.
