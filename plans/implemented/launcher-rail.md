# Rail — Implementation Plan

## Overview

A `Rail` is an edge-anchored rail that sits along one viewport edge and holds a
strip of collapsed handles. Each handle is a button that toggles an associated
panel open/closed. It is the persistent "launcher strip" counterpart to the
overlay [`Drawer`](../src/typescript/lib/core/Drawer.ts) just shipped — but
unlike a Drawer it does not slide off-screen and is never auto-dismissed; it is
always present.

The Rail lives in `src/typescript/lib/core/Rail.ts` (core band, alongside
`Drawer.ts`, `Window.ts`, `LayerManager.ts`). It is an **overlay** strip
(`Position.FIXED`, floats over app content, mirrors Drawer's portaled-surface
pattern). It
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

### Overlay-only, mirroring Drawer's mount

`Rail` is an overlay strip. It sets `Position.FIXED` in its constructor body
(the documented FIXED carve-out applied after `super()`, like Drawer at
[Drawer.ts:193](../src/typescript/lib/core/Drawer.ts#L193)), attaches to
`document.documentElement`, and stamps a viewport-edge resting rect from the
current edge + thickness + viewport (identical shape to Drawer's
`restingRect` / `applyRestingGeometry`). App content renders *under* it.

The DOM-attach *mechanism* mirrors Drawer (FIXED carve-out + documentElement
portal + resting-rect geometry), but the *lifecycle* differs: Drawer attaches
inside `open()` and detaches in `close()` ([Drawer.ts:379](../src/typescript/lib/core/Drawer.ts#L379)),
because a drawer slides on and off screen. A Rail is always present, so it
exposes explicit `mount()` / `unmount()` methods instead — there is no
open/close cycle to fold the attach into.

A reserve-space mode (claim an edge strip and inset app content around it) was
considered and **explicitly dropped** — see `## Non-Goals`. A child component
cannot position itself via its own `doLayout` (a component's x/y/width/height is
set by its *parent's* layout manager, not its own `doLayout`, which lays out the
component's *children* — [Component.ts:4290](../src/typescript/lib/core/Component.ts#L4290)),
and the default `Body` host lays out via a `Tab` layout manager
([main.ts:33](../src/typescript/main.ts#L33)) that would turn an added child into
a hidden phantom tab ([Tab.ts:1420](../src/typescript/lib/layout/Tab.ts#L1420)).
Reserving space correctly would require a real layout region, which is out of
scope for this cut. The Rail therefore never mutates a foreign component's
insets — it stays entirely within its own portaled subtree.

### Not a `DismissableLayer` — and not in the layer tree at all

A persistent rail is never dismissed by an outside click, never Escape-closes,
and is not raised/re-stamped on activation. Registering it with `LayerManager`
(as Drawer/Window do) would only buy z-band allocation and dismissal — both
unwanted. So `Rail` does **not** implement `DismissableLayer` and does **not**
call `LayerManager.register`. In overlay mode it carries a fixed z-index just
below the Window band (a plain module constant, `RAIL_Z_INDEX = 8900`, mirroring
how `LayerManager`'s bands are plain constants because z-index is unthemed) so
windows, popovers, and dialogs still stack above the rail.

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

**Listener-rule note (flagged).** ARCHITECTURE.md requires listeners reference a
named function. These per-registration subscriptions are stored *arrow*
references (one closure set per registered drawer/window, kept in the bookkeeping
maps) because the captured handle differs per registration and the references
must be removable on `unregisterDrawer`/`unregisterWindow`. This satisfies the
rule's intent — every reference is retained so `ListenerBag.remove` matches and
nothing leaks — and matches existing core precedent for `.on(...)` arrows (e.g.
`TabWindow.ts`, `Dock.ts`, `Window.ts:81-84`). It is called out here as a
deliberate, bounded exception rather than left implicit.

### Minimal additive Drawer change: expose `getEdge` is already public — none needed

`Drawer` already exposes `getEdge()` ([Drawer.ts:276](../src/typescript/lib/core/Drawer.ts#L276)),
`setEdge()`, the typed `on`/`off`, and the `"open"`/`"close"` events the Rail
needs. **No Drawer change is required** for the composition. (Edge alignment uses
the existing public `setEdge`; state sync uses the existing public `on`.) This is
called out explicitly so the implementer does not add a speculative affordance.

### Window-minimize ↔ Rail contract

The minimize machinery lives entirely on `AbstractWindow` (the shared base
`Window` extends), **not** on `Window` itself: `WindowState = "minimized"`,
`setWindowState` ([AbstractWindow.ts:888](../src/typescript/lib/core/AbstractWindow.ts#L888)),
the `computeDockRect` / `relayoutMinimizedStack` static stack, `_restoreRect`,
`_preMinimizeState`, `setBodyHostDisplayed`, and `toggleMinimize`
([AbstractWindow.ts:969](../src/typescript/lib/core/AbstractWindow.ts#L969)) are
all defined there; `Window.ts` only wires its header minimize button to that
inherited `toggleMinimize` ([Window.ts:82](../src/typescript/lib/core/Window.ts#L82)).
That is a *self-docking* mechanism with no `Rail` component. We do **not** rip it
out (surgical-changes rule); instead we add an **opt-in** path on
`AbstractWindow`: a window can be told to minimize into a specific `Rail` instead
of the bottom-edge stack. Because the API lands on the base, every
`AbstractWindow` subclass (including `Window`) inherits it.

New additive `AbstractWindow` API:

- `setRail(rail: Rail | null): this` / `getRail(): Rail | null` — when a rail is
  attached, `setWindowState("minimized")` routes to the rail instead of the
  bottom strip.
- A new typed-event surface on `AbstractWindow`. `AbstractWindow` today has **no**
  `ListenerBag`, and its hierarchy is `AbstractWindow → Container → Component`
  ([Window.ts:41](../src/typescript/lib/core/Window.ts#L41)) — it does **not**
  extend `Panel`, and neither `Container` nor `Component` exposes an `on`/`off`
  surface; the header buttons are wired with inline arrow callbacks
  ([Window.ts:81-84](../src/typescript/lib/core/Window.ts#L81-L84)). To let the
  Rail react to minimize/restore without polling, `AbstractWindow`
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

When a `Rail` is attached, `AbstractWindow.setWindowState("minimized")` skips
`computeDockRect`/`relayoutMinimizedStack` (those drive the built-in bottom
strip) and instead hides the whole window element (`setVisible(false)` after the
collapse, or simply `setDisplayed(false)`) and emits `"minimize"`; the visible
representation becomes the Rail handle. Restore re-shows the window at
`_restoreRect` and emits `"restore"`. The built-in bottom-strip path is
unchanged when no rail is attached.

**Restore-rect capture (implementer must preserve).** Today the no-rail
`"minimized"` branch captures `_restoreRect = this.currentRect()` and records
`_preMinimizeState` *inside* that branch ([AbstractWindow.ts:888](../src/typescript/lib/core/AbstractWindow.ts#L888)).
Because the rail path is an **early fork** that bypasses that block, the fork
must itself capture `_restoreRect` and set `_preMinimizeState` before hiding the
window — otherwise `restore()` (= `setWindowState(this._preMinimizeState)`)
reads a stale or null rect. Equivalently, capture both *above* the fork so both
paths share it. This is the one correctness-critical detail of the fork.

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
path). `RailHandle` is internal to the Rail subsystem; the register methods
return `this` (the Rail), so no public signature surfaces a handle — but it is
still exported from the core barrel so callers can type or subclass it. It is
not a headline API.

---

## Public API (TypeScript Signatures)

```typescript
// src/typescript/lib/core/Rail.ts

/** Viewport edge a Rail rail anchors to. Structurally identical to DrawerEdge. */
export type RailEdge = Exclude<Placement, Placement.CENTER>;

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
    /**
     * Rail thickness in px (width for WEST/EAST, height for NORTH/SOUTH).
     * @defaultValue 48
     */
    thickness?: number;
    listeners?: {
        register?:   (drawer: Drawer | AbstractWindow) => void;
        unregister?: (drawer: Drawer | AbstractWindow) => void;
    };
}

class Rail extends Component<RailOptions> {
    constructor(options?: RailOptions, subclassDefaults?: Partial<RailOptions>);

    // typed setters (cache-only where geometry is derived in doLayout/mount)
    setEdge(edge: RailEdge): this;            // backing: _options.edge
    getEdge(): RailEdge;
    setThickness(px: number): this;           // backing: _options.thickness
    getThickness(): number;

    /** Mounts the rail on documentElement (FIXED overlay). */
    mount(): this;
    /** Unmounts the rail. */
    unmount(): this;

    registerDrawer(drawer: Drawer, reg?: RailDrawerRegistration): this;
    unregisterDrawer(drawer: Drawer): this;

    /** Adds a handle for a minimized window; called by AbstractWindow via its events. */
    registerWindow(window: AbstractWindow): this;
    unregisterWindow(window: AbstractWindow): this;

    on(event: RailEvent, listener: (target: Drawer | AbstractWindow) => void): this;
    off(event: RailEvent, listener: (target: Drawer | AbstractWindow) => void): this;
    protected emit(event: RailEvent, target: Drawer | AbstractWindow): void;
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
// Additive AbstractWindow API (src/typescript/lib/core/AbstractWindow.ts)
export type WindowEvent = "minimize" | "restore" | "close";

class AbstractWindow /* ... */ {
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
[Theme.ts:492](../src/typescript/lib/core/Theme.ts#L492), one block per theme in
`ModernTheme.ts` / `ClassicTheme.ts` / `DarkTheme.ts`, var emission in
[`themeToVars`](../src/typescript/lib/core/Theme.ts#L869)).

| CSS Custom Property              | Modern (light) Default                  | Dark Default                          | Purpose                              |
|---------------------------------|-----------------------------------------|---------------------------------------|--------------------------------------|
| `--ts-ui-rail-bg`               | `var(--ts-ui-body-bg)`                  | (dark surface)                        | Rail background                      |
| `--ts-ui-rail-border`           | `rgb(220, 220, 220)`                    | (dark divider)                        | Rail divider on its content-facing edge |
| `--ts-ui-rail-shadow`           | `2px 0 12px rgba(0,0,0,0.18)`           | (deeper)                              | Rail drop shadow                     |
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
- Per-registration bookkeeping: `Map<Drawer, { handle: RailHandle; onOpen: () => void; onClose: () => void; onAction: ClickListener }>` and a parallel `Map<AbstractWindow, { handle; onMinimize; onRestore; onClose }>`. The stored closures are the exact references passed to `on`, so `off` matches.
- Geometry (`applyRestingGeometry`-style, mirroring Drawer): WEST → `{x:0, y:0, width:thickness, height:viewportHeight}`; EAST mirrored; NORTH/SOUTH span full viewport width at `thickness` height. Re-derive on viewport resize via an `Event.addViewportListener(this, "resize", …)`.

---

## Ordered Implementation Steps

1. **Theme tokens.** Add the `rail` block to the `Theme` interface
   ([Theme.ts:492](../src/typescript/lib/core/Theme.ts#L492) area), to all three
   theme files (`ModernTheme.ts`, `ClassicTheme.ts`, `DarkTheme.ts`) beside their
   `drawer` blocks, and emit the five vars in `themeToVars`
   ([Theme.ts:869](../src/typescript/lib/core/Theme.ts#L869) area). Verify:
   `grep -rn 'ts-ui-rail' src/typescript/lib/core/Theme.ts` — expect the five
   var names; `npm run typecheck`.
2. **`RailHandle`** (`src/typescript/lib/core/RailHandle.ts`). `Button` subclass
   with `selected` option + `setSelected`/`isSelected`, applying
   `--ts-ui-rail-handle-selected-bg` / hover wash. Callable export pattern
   (`callable(RailHandle)` + `_RailHandle`/`RailHandle` exports), matching Drawer.
3. **`Rail`** (`src/typescript/lib/core/Rail.ts`). Options-bag-as-cache,
   `applyOptions` after `super`, constructor-body listener dispatch (the
   `_listeners` ListenerBag is undefined during the super cascade — the documented
   trap). Implement `mount`/`unmount`, edge geometry,
   `registerDrawer`/`unregisterDrawer` (subscribe via `drawer.on`), `registerWindow`/`unregisterWindow`,
   typed `on`/`off`/`emit`. Callable export.
4. **AbstractWindow additive API** (`src/typescript/lib/core/AbstractWindow.ts` —
   where the minimize machinery lives). Add `WindowEvent`, a `ListenerBag<WindowEvent>`
   field (`_windowListeners`), `on`/`off`/`emit` overloads, `setRail`/`getRail`,
   `minimize`/`restore`. In `setWindowState` ([AbstractWindow.ts:888](../src/typescript/lib/core/AbstractWindow.ts#L888)),
   fire `"minimize"`/`"restore"`; when
   `_rail` is set, branch the `"minimized"` path to hide the window + emit instead
   of `computeDockRect`/`relayoutMinimizedStack`. Fire `"close"` in `onExitAction`.
   Dispatch any `options.listeners` for window events from the constructor body
   (`WindowOptions` has no `listeners` option today; add one only if
   trivially additive — otherwise expose events via `on` only and skip the option,
   keeping the change minimal).
5. **Barrel exports.** Export `Rail`, `RailOptions`, `RailEdge`, `RailEvent`,
   `RailDrawerRegistration`, `RailHandle` from
   `src/typescript/lib/core/index.ts` (beside the Drawer entry at
   [index.ts:42-43](../src/typescript/lib/core/index.ts#L42)), and add the new
   `WindowEvent` type beside the existing `AbstractWindow` type exports
   ([index.ts:28](../src/typescript/lib/core/index.ts#L28)).
6. **Demo wiring** in `MiscPanel.ts` beside the existing Drawer block
   ([MiscPanel.ts:636](../src/typescript/MiscPanel.ts#L636)): create a Rail,
   register two Drawers, and attach a Window via `setRail`.
7. **Docs** (see Documentation Impact).

---

## Files to Create / Modify / Delete

| Action | File |
|--------|------|
| Create | `src/typescript/lib/core/Rail.ts` |
| Create | `src/typescript/lib/core/RailHandle.ts` |
| Modify | `src/typescript/lib/core/AbstractWindow.ts` (additive events + `setRail`/`minimize`/`restore`; the minimize machinery lives here, not in `Window.ts`) |
| Modify | `src/typescript/lib/core/Theme.ts` (rail interface block + themeToVars) |
| Modify | `src/typescript/lib/core/themes/ModernTheme.ts` (rail block) |
| Modify | `src/typescript/lib/core/themes/ClassicTheme.ts` (rail block) |
| Modify | `src/typescript/lib/core/themes/DarkTheme.ts` (rail block) |
| Modify | `src/typescript/lib/core/index.ts` (barrel exports) |
| Modify | `src/typescript/MiscPanel.ts` (demo) |
| Create | `docs/components/Rail.md` + sidebar/catalog entries (see Documentation Impact) |

No deletions — the built-in Window bottom-strip rail stays.

---

## Verification

- `npm run typecheck` — clean.
- `grep -rn 'ts-ui-rail' src/typescript/lib/core/Theme.ts` — five var names emitted; `grep -rn 'rail' src/typescript/lib/core/themes/*.ts` — block present in all three.
- `npm run docs:build` — 0 errors, 0 link warnings (the typedoc "unsupported TypeScript version" notice is the only acceptable warning).
- Manual smoke on the **Misc.** demo screen (`npm run dev`, http://localhost:8015):
  1. **Overlay:** rail floats over content; registered-drawer handles toggle their drawers; a drawer opened from elsewhere flips its handle's selected state (state sync).
  2. **Window-minimize/restore:** a window with `setRail(rail)` minimizes into a Rail handle (window hidden, handle appears); clicking the handle restores the window to its prior rect; closing a minimized window removes its handle.
  3. **Drawer-handle state sync:** open/close a hosted drawer via its own Close button and confirm the rail handle's selected wash follows.
  4. **Theme toggle:** switch Modern/Classic/Dark; rail bg/border/shadow and handle hover/selected washes re-skin from the tokens.

---

## Documentation Impact

- `Rail`, `RailHandle`, and the new `AbstractWindow` symbol (`WindowEvent`) are
  exported from the per-subpath barrel `src/typescript/lib/core/index.ts` (there
  is no root barrel).
- Add a curated page `docs/components/Rail.md` covering the overlay strip, the
  Drawer composition, and the Window-minimize integration; add it to the
  `docs/components/index.md` catalog and the `/components/` sidebar group in
  `docs/.vitepress/config.mts` (beside the `Drawer`/`Window` entries at
  config.mts:58-62).
- Update the existing `docs/components/Drawer.md` and `docs/components/Window.md`
  curated pages with a cross-reference to `Rail` (markdown links across buckets,
  not `{@link}` — per `_shared/docs-conventions.md`).
- JSDoc on every new public symbol (options, setters, register API, events) per
  the callable-export + JSDoc conventions, including `@category Core` on each
  (matching Drawer at [Drawer.ts:21](../src/typescript/lib/core/Drawer.ts#L21)).

---

## Potential Challenges

- **`AbstractWindow`'s `"minimized"` branch is dense** (`_restoreRect`, `_preMinimizeState`, `setBodyHostDisplayed`, the static stack). Add the rail branch as an early fork that bypasses `computeDockRect`/`relayoutMinimizedStack` without disturbing the no-rail path. Mitigation: gate the entire new behaviour on `this._rail !== null`.
- **Listener-reference symmetry** — store the exact `on` closures per registration so `off`/`ListenerBag.remove` match (the framework's `ListenerBag.add` appends; mismatched refs leak). Mitigation: the per-registration bookkeeping maps above.
- **Super-cascade traps** — the `_listeners` ListenerBag, any `declare`-needed fields, and setters that must defer DOM work (mirror Drawer's notes at [Drawer.ts:195](../src/typescript/lib/core/Drawer.ts#L195)). Mitigation: dispatch `options.listeners` from the constructor body; cache geometry in setters and apply in `mount`.

---

## Critical Files

- [`src/typescript/lib/core/Drawer.ts`](../src/typescript/lib/core/Drawer.ts) — the overlay pattern to mirror (options-bag-as-cache, `applyOptions`, constructor-body listener dispatch, typed `on`/`off`/`emit`, `restingRect`/`applyRestingGeometry`/`offscreenTransform`, callable export, `DrawerEdge`).
- [`src/typescript/lib/core/AbstractWindow.ts`](../src/typescript/lib/core/AbstractWindow.ts) — `WindowState` machine, `setWindowState` (:888), `computeDockRect`/`relayoutMinimizedStack`, `onExitAction`, `toggleMinimize` (:969); the additive-events + `setRail` surface lands here. (`Window.ts` only wires its header button to `toggleMinimize` at :82.)
- [`src/typescript/lib/core/LayerManager.ts`](../src/typescript/lib/core/LayerManager.ts) — bands and the `DismissableLayer` contract the Rail deliberately does *not* implement.
- [`src/typescript/lib/layout/HBox.ts`](../src/typescript/lib/layout/HBox.ts) / [`VBox.ts`](../src/typescript/lib/layout/VBox.ts) — the rail's internal handle layout.
- [`src/typescript/lib/component/button/Button.ts`](../src/typescript/lib/component/button/Button.ts) — `RailHandle`'s superclass.
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) + the three theme files — the `drawer` block is the template for the new `rail` block.
- [`src/typescript/MiscPanel.ts`](../src/typescript/MiscPanel.ts) — demo home, beside the Drawer block at line 636.

---

## Non-Goals

- **Not removing or replacing** the built-in bottom-of-viewport minimize stack on `AbstractWindow` — the Rail path is opt-in via `setRail`; the default self-docking behaviour is untouched (surgical-changes rule).
- **No reserve-space mode.** A mode that claims an edge strip and insets app content around it was considered and dropped: a child cannot position itself via its own `doLayout`, and the default `Body` host's `Tab` layout manager would turn an added child into a hidden tab (see `## Architecture Decisions`). Correctly reserving space needs a real layout region, which is out of scope for this cut. The Rail floats as a FIXED overlay only.
- **No drag-to-reorder of handles, no overflow/scroll for an over-full rail, no collapse/expand of the rail itself** — out of scope for the first cut.
- **No multi-edge single Rail** — one Rail anchors one edge; a caller wanting rails on two edges constructs two Rails.
- **No dependence on `plans/size-constraint-invariant.md`** — the Rail uses a fixed `thickness` and full cross-axis span, so the unimplemented min ≤ preferred ≤ max fix does not gate it.
