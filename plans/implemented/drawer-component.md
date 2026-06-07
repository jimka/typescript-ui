# Drawer — Implementation Plan

## Overview

A `Drawer` is a panel that rests off-screen against one viewport edge and slides into view when opened, overlaying the rest of the UI. It is the framework's first *edge-anchored, persistently-mounted, public-API-driven* overlay — distinct from `Dialog` (centred, promise-driven, always modal) and `Notification` (auto-dismissing toast stack). It reuses the framework's existing floating-layer infrastructure wholesale: it mounts on `document.documentElement` like every other portaled surface, registers with [`LayerManager`](../src/typescript/lib/core/LayerManager.ts#L135) as a [`DismissableLayer`](../src/typescript/lib/core/LayerManager.ts#L39) so Esc / outside-click / z-stacking all "just work", animates via [`Animation.play`](../src/typescript/lib/core/Animation.ts#L91), and (when modal) draws the existing [`DialogBackdrop`](../src/typescript/lib/component/container/DialogBackdrop.ts#L28) as its scrim.

The drawer is a content host: callers add their own children via the inherited `addComponent`. It lives in `src/typescript/lib/core/Drawer.ts` (peer of `Dialog`, `Window`, `Notification`), exported from the `core` barrel at [`src/typescript/lib/core/index.ts`](../src/typescript/lib/core/index.ts#L34).

The two locked behavioural axes are `edge` (`'left' | 'right' | 'top' | 'bottom'`, derived from the existing [`Placement`](../src/typescript/lib/primitive/Placement.ts#L9) enum — see _Architecture Decisions_) and `modal` (boolean, selecting the [`DialogBackdrop`](../src/typescript/lib/component/container/DialogBackdrop.ts#L28) + `"modal"` dismiss mode vs. a transparent, non-blocking `"manual"` layer).

---

## Architecture Decisions

### Reuse `Placement` for the edge axis, not a new string union

The brief asks to reuse an existing edge/side type if one exists. [`Placement`](../src/typescript/lib/primitive/Placement.ts#L9) already enumerates `NORTH | SOUTH | WEST | EAST | CENTER` and is the framework's compass primitive (used by `Border` layout and `Dialog`). The drawer's four edges map cleanly onto `WEST | EAST | NORTH | SOUTH`. The `edge` option's type is `Exclude<Placement, Placement.CENTER>` — `CENTER` is meaningless for an edge-anchored panel, so excluding it makes illegal states unrepresentable at compile time. No new string-union type is introduced. Internally the drawer switches on the four compass values to pick its resting position and slide axis.

Rejected: a fresh `type DrawerEdge = 'left' | 'right' | 'top' | 'bottom'`. It would duplicate a concept the codebase already owns and force a translation layer at the `Border`/`Placement` boundary.

### Mount through the existing layer infrastructure — no parallel overlay system

`Dialog`, `Window`, `Popover`, `AnimatedDropdown`, and `Notification` all follow one pattern: subclass `Component` (or `Panel`), call `setPosition(Position.FIXED)`, append the element to `document.documentElement`, take a z-index from a [`LayerManager.Band`](../src/typescript/lib/core/LayerManager.ts#L175), and implement [`DismissableLayer`](../src/typescript/lib/core/LayerManager.ts#L39). `Drawer` copies this verbatim. It implements `DismissableLayer` so the manager's single document-level `pointerdown` / `focusin` / `keydown` handlers ([`LayerManager.ts:487-514`](../src/typescript/lib/core/LayerManager.ts#L487)) drive its dismissal. Nothing new is added to the overlay layer — the drawer is one more participant.

Z-index band: the drawer is a peer surface opened independently (not "opened from" a topmost layer), so it returns `isLayerRoot(): true` like [`Window`](../src/typescript/lib/core/Window.ts#L557). It uses `LayerManager.Band.Dropdown` (the omitted-`getBand` default — see [`register`](../src/typescript/lib/core/LayerManager.ts#L203)) so a drawer stacks above windows/popovers but below dialogs. The modal scrim is stamped one below the panel, mirroring [`Dialog.open`](../src/typescript/lib/core/Dialog.ts#L636).

### Dismiss mode is `modal` when modal, `manual` when not

[`LayerDismissMode`](../src/typescript/lib/core/LayerManager.ts#L21) has exactly the two semantics we need:

- **Modal drawer** → `getDismissMode(): "modal"`. The manager's Esc handler closes the topmost non-manual layer (so Esc closes it — [`onKeyDown`](../src/typescript/lib/core/LayerManager.ts#L498)), and `"modal"` *captures* outside pointer interaction so clicks don't fall through to layers beneath ([`handleOutside`](../src/typescript/lib/core/LayerManager.ts#L461)). The scrim itself carries an explicit click→close listener (like [`Dialog`'s `closeOnBackdrop`](../src/typescript/lib/core/Dialog.ts#L627)), giving click-scrim-to-close.
- **Non-modal drawer** → `getDismissMode(): "manual"`. The manager never auto-dismisses a `"manual"` layer on outside click *or* Esc ([`onKeyDown`](../src/typescript/lib/core/LayerManager.ts#L506) skips `"manual"`; [`handleOutside`](../src/typescript/lib/core/LayerManager.ts#L461) treats `"manual"` as non-dismissable). The surrounding UI stays fully interactive. Closing happens only via the public `close()` / `toggle()` API or a caller-wired control. This is the documented, deliberate close-affordance split.

`"click-outside"` is deliberately *not* used for the non-modal case: a non-modal drawer that vanished the moment the user clicked the app behind it would be hostile for a persistent side panel (filters, navigation). Callers who want click-outside-to-close on a non-modal drawer can wire it themselves against the public API; the default is sticky.

### Persistent mount, animate by sliding `transform` — never re-parent

The element is created once and appended to `document.documentElement` on first `open()`. `close()` slides it out and (by default) detaches it via `removeElement()` after the exit transition, but the **component instance and its child subtree are retained** so re-opening is cheap and—critically—does not re-parent descendant DOM. Per the auto-memory note *Content-frame re-parent snaps transitions*, re-parenting a node cancels descendant CSS transitions; the drawer therefore never moves its children between hosts. The slide uses `transform: translate(...)` (compositor-friendly) via [`Animation.play`](../src/typescript/lib/core/Animation.ts#L91), matching how `Dialog` animates (`Animation.play` with `from`/`to` + `properties`) and honouring `prefers-reduced-motion` for free.

### Mirror the `Component` option/setter conventions exactly, and avoid the documented super-cascade traps

`Drawer extends Component<DrawerOptions>`. `DrawerOptions extends ComponentOptions` ([`Component.ts:105`](../src/typescript/lib/core/Component.ts#L105)). Each new option gets a typed setter + cached backing field, dispatched from an `applyOptions` override that calls `super.applyOptions(options)` first ([`Component.ts:383`](../src/typescript/lib/core/Component.ts#L383)), exactly like [`FieldSet`](../src/typescript/lib/component/container/FieldSet.ts#L67) and [`AnimatedDropdown`](../src/typescript/lib/core/AnimatedDropdown.ts#L134).

Trap avoidance, per auto-memory:
- **Class-field super-cascade trap:** fields written by setters that run *during* `super()` (via `applyOptions`) must be declared with `declare`, not an initializer and not `!`, or the field initializer runs *after* `super()` and clobbers the value. `_edge`, `_modal`, `_size`, `_durationMs`, `_open` are written by their setters from `applyOptions`, so they are declared `declare private _edge: ...` etc. Fields *not* touched by `applyOptions` (the lazily-created `_backdrop`, the bound handlers, `_open` if we choose to gate it outside applyOptions) use normal initializers.
- **Setters must defer DOM work:** setters invoked from `applyOptions` run before `init()`/first render, so they must **not** call `getElement(true)` or otherwise touch the DOM. `setEdge`/`setModal`/`setSize` only cache into backing fields; the off-screen resting geometry and edge CSS are applied in `open()` (when the element provably exists), not in the setter.
- **`options.listeners` super-trap:** if the drawer accepts a `listeners` bag in options, the dispatch that calls `this.on(...)` must live in the *constructor body* after `super()`, not in `applyOptions` — `_listeners` is undefined during `super()`. (Follow `ButtonGroup`'s constructor, which calls `this.on(...)` post-super at [`ButtonGroup.ts:60`](../src/typescript/lib/core/ButtonGroup.ts#L60).)

### Construction via the options bag

Per [`CODE_CONVENTIONS.md`](../CODE_CONVENTIONS.md) (construction idiom): callers configure `edge`, `modal`, `size`, `durationMs`, and `listeners` through the options bag (`new Drawer({ edge: Placement.EAST, modal: true })`), not post-construction setters. The setters exist for runtime mutation and for `applyOptions` routing; they are not the primary configuration path.

### Typed events via `ListenerBag`, not raw DOM events

State changes are surfaced with the framework's typed `on`/`off`/`emit` triad backed by a private [`ListenerBag<DrawerEvent>`](../src/typescript/lib/core/ListenerBag.ts#L20), copying [`ButtonGroup`](../src/typescript/lib/core/ButtonGroup.ts#L92) verbatim (overloaded `on`, `off`, `protected emit`). Events: `"open"`, `"close"`, `"beforeclose"`. `"beforeclose"` is cancelable — its listener receives a controller whose `preventDefault()` aborts the close (lets a host veto, e.g. unsaved-changes guard). This is *not* a DOM event; `Event.fireEvent` is reserved for real DOM dispatch and the drawer has no need of it.

---

## Public API (TypeScript Signatures)

```typescript
/** Edge a Drawer anchors to. Reuses the compass primitive minus CENTER. */
export type DrawerEdge = Exclude<Placement, Placement.CENTER>; // WEST | EAST | NORTH | SOUTH

export type DrawerEvent = "open" | "close" | "beforeclose";

/** Controller passed to a "beforeclose" listener; preventDefault() aborts the close. */
export interface DrawerCloseController {
    preventDefault(): void;
}

export interface DrawerOptions extends ComponentOptions {
    /** Viewport edge the drawer rests against and slides in from. @defaultValue Placement.WEST */
    edge?: DrawerEdge;
    /** When true, render a blocking scrim and close on scrim-click / Esc. @defaultValue false */
    modal?: boolean;
    /** Drawer extent along its slide axis (px): width for left/right, height for top/bottom. @defaultValue 320 */
    size?: number;
    /** Slide duration in ms. @defaultValue 220 */
    durationMs?: number;
    /** Construction-time event listeners. */
    listeners?: {
        open?:        () => void;
        close?:       () => void;
        beforeclose?: (controller: DrawerCloseController) => void;
    };
}

class Drawer extends Component<DrawerOptions> implements DismissableLayer {
    constructor(options?: DrawerOptions);

    // --- typed setters (cached backing field; NO DOM work — applied in open()) ---
    setEdge(edge: DrawerEdge): this;          // _edge
    getEdge(): DrawerEdge;
    setModal(value: boolean): this;           // _modal
    isModal(): boolean;
    setSize(value: number): this;             // _size  (overrides Component.setSize semantics? see note)
    getSize(): number;
    setDurationMs(ms: number): this;          // _durationMs
    getDurationMs(): number;

    // --- public open/close API ---
    open():   this;
    close():  this;   // fires "beforeclose" (cancelable) then "close"
    toggle(): this;
    isOpen(): boolean;                        // _open

    // --- typed events ---
    on(event: "open"  | "close", listener: () => void): this;
    on(event: "beforeclose",     listener: (controller: DrawerCloseController) => void): this;
    off(event: DrawerEvent, listener: Function): this;
    protected emit(event: "open" | "close"): void;
    protected emit(event: "beforeclose", controller: DrawerCloseController): void;

    // --- DismissableLayer ---
    getLayerElement():  HTMLElement | null;
    getDismissMode():   LayerDismissMode;     // "modal" when modal, else "manual"
    requestClose():     void;                 // → this.close()
    isLayerRoot():      boolean;              // true
    onZIndexChanged(z: number): void;         // mirror to setZIndex; scrim to z-1
}

const DrawerCallable = callable(Drawer);
type DrawerCallable = Drawer;
export {
    Drawer         as _Drawer,
    DrawerCallable as Drawer,
};
```

**Backing fields (declare for applyOptions-written ones):**
`declare private _edge: DrawerEdge;`, `declare private _modal: boolean;`, `declare private _size: number;`, `declare private _durationMs: number;`. Runtime-only fields with initializers: `private _open: boolean = false;`, `private _backdrop: DialogBackdrop | null = null;`, `private _listeners = new ListenerBag<DrawerEvent>();`, bound viewport-resize handler.

> **`setSize` name collision:** `Component` exposes `setSize(size: Size)` (width+height). The drawer's single-axis extent must NOT shadow that with an incompatible signature. **Decision:** name the drawer option `size` but the setter `setDrawerSize(value: number)` / `getDrawerSize()` to avoid overriding the inherited `setSize`. The `size` option field routes to `setDrawerSize` in `applyOptions`. (Implementer: confirm `Component.setSize`'s signature at build time; if it is in fact `setSize(width, height)` the rename still stands — a single-number overload would be a foot-gun.)

---

## Theme Tokens

The modal scrim reuses the existing `--ts-ui-dialog-backdrop-bg` token (already defined, light + dark) by instantiating `DialogBackdrop` — no new scrim token. New tokens cover the drawer panel surface, shadow, default size, and slide duration. Add a `drawer` block to the `Theme` interface ([`Theme.ts:363`](../src/typescript/lib/core/Theme.ts#L363) is the sibling `dialog` block to model it on), to all three theme objects (`ModernTheme`, `ClassicTheme`, `DarkTheme`), and to [`themeToVars`](../src/typescript/lib/core/Theme.ts#L566).

| CSS Custom Property | Light Default | Dark Default | Purpose |
|---|---|---|---|
| `--ts-ui-drawer-bg` | `var(--ts-ui-body-bg)` | `var(--ts-ui-body-bg)` | Drawer panel background |
| `--ts-ui-drawer-shadow` | `4px 0 24px rgba(0,0,0,0.25)` | `4px 0 24px rgba(0,0,0,0.55)` | Panel drop shadow (edge-agnostic blur; direction set inline per edge) |
| `--ts-ui-drawer-border` | `rgb(220,220,220)` | `rgb(70,70,70)` | 1px divider on the panel's inner edge |

Theme-object source values to add (mirroring the `dialog` block):
- `ModernTheme`/`ClassicTheme`: `drawer: { background: 'var(--ts-ui-body-bg)', shadow: '4px 0 24px rgba(0,0,0,0.25)', border: 'rgb(220, 220, 220)' }` (Classic uses its own border greys — match its existing `dialog.border`).
- `DarkTheme`: `drawer: { background: 'var(--ts-ui-body-bg)', shadow: '4px 0 24px rgba(0,0,0,0.55)', border: 'rgb(70, 70, 70)' }`.

`Theme` interface block:
```typescript
drawer: {
    background: string;
    shadow:     string;
    border:     string;
};
```
`themeToVars` entries (add beside the `dialog` lines ~[`Theme.ts:740`](../src/typescript/lib/core/Theme.ts#L740)):
```typescript
'--ts-ui-drawer-bg'     : theme.drawer.background,
'--ts-ui-drawer-shadow' : theme.drawer.shadow,
'--ts-ui-drawer-border' : theme.drawer.border,
```

Default `size` (320) and `durationMs` (220) are component-level constants (numeric, layout-affecting), not themed — consistent with `Notification`'s `WIDTH`/`HEIGHT` static constants and `Dialog`'s `MIN_*` constants, which are not in `Theme.ts`.

---

## Internal Structure

**Edge → geometry map.** `open()` computes the on-screen and off-screen rect from `_edge`, `_size`, and the viewport ([`Util.getViewportSize`](../src/typescript/lib/core/Util.ts#L426)):

| edge (`Placement`) | panel fixed rect | slide-axis off-screen `transform` |
|---|---|---|
| `WEST`  (left)   | `x:0, y:0, w:size, h:vh` | `translateX(-size)` → `translateX(0)` |
| `EAST`  (right)  | `x:vw-size, y:0, w:size, h:vh` | `translateX(size)` → `translateX(0)` |
| `NORTH` (top)    | `x:0, y:0, w:vw, h:size` | `translateY(-size)` → `translateY(0)` |
| `SOUTH` (bottom) | `x:0, y:vh-size, w:vw, h:size` | `translateY(size)` → `translateY(0)` |

**open() flow** (modelled on [`Dialog.open`](../src/typescript/lib/core/Dialog.ts#L624)):
1. Guard: if `_open`, return.
2. `LayerManager.register(this)`; read `LayerManager.getZIndex(this)`; `setZIndex(panelZ)`.
3. If `_modal`: lazily create `_backdrop = new DialogBackdrop()`, `setZIndex(panelZ - 1)`, wire `addClickListener(() => this.close())`, append `_backdrop.getElement(true)` to `document.documentElement`, fade it in via `Animation.play({ from:{opacity:"0"}, to:{opacity:"1"}, ... })`.
4. Apply the fixed rect (setX/setY/setWidth/setHeight per the table), panel CSS (bg/shadow/border var tokens), `setOverflow("auto")`.
5. Append `getElement(true)` to `document.documentElement`.
6. `Animation.play` the slide: `from: { transform: <off> }, to: { transform: "translate(0,0)" }, durationMs: _durationMs, properties: ["transform"]`.
7. Register viewport `resize` listener (re-derive rect; resize scrim) via `Event.addViewportListener`.
8. Set `_open = true`; `emit("open")`.

**close() flow** (modelled on [`Dialog.hide`](../src/typescript/lib/core/Dialog.ts#L780)):
1. Guard: if `!_open`, return.
2. `emit("beforeclose", controller)`; if `controller` was prevented, abort.
3. Remove the viewport resize listener.
4. `Animation.play` the reverse slide (`to: { transform: <off> }`), with `onComplete` finalize: `removeElement()`; if modal, `_backdrop.destroy()` (its own [`destroy`](../src/typescript/lib/component/container/DialogBackdrop.ts#L67) removes + destructs) and `_backdrop = null`; `LayerManager.unregister(this)`; `_open = false`; `emit("close")`. Fade the scrim out concurrently.
5. Reduced-motion: `Animation.play` already collapses to a synchronous `to` + immediate `onComplete`, so finalize runs on the same tick — no special-casing needed.

**Esc / outside-click:** entirely delegated to `LayerManager` via `getDismissMode()` (see _Architecture Decisions_). The drawer wires **no** keydown listener of its own and no subtree/window click listener — sidestepping the auto-memory cautions about subtree listeners and non-bubbling events, because the manager owns the single document-level `pointerdown`/`keydown`/`focusin` handlers and calls back through `requestClose()`.

---

## Ordered Implementation Steps

1. **`src/typescript/lib/core/Theme.ts`** — add the `drawer` block to the `Theme` interface (after the `dialog` block, ~line 393); add the three `themeToVars` entries (~line 742). → verify: `grep -n 'ts-ui-drawer' src/typescript/lib/core/Theme.ts` shows 3 lines.
2. **`src/typescript/lib/core/themes/ModernTheme.ts`, `ClassicTheme.ts`, `DarkTheme.ts`** — add the `drawer: { background, shadow, border }` object to each (beside `dialog`). → verify: typecheck passes (the `Theme` interface forces all three).
3. **`src/typescript/lib/core/Drawer.ts`** — new file. Define `DrawerEdge`, `DrawerEvent`, `DrawerCloseController`, `DrawerOptions`, the `Drawer` class implementing `DismissableLayer`, and the `callable` export pair. Follow `Dialog.ts` import set (`Component`, `Animation`, `Event`, `LayerManager`/`DismissableLayer`/`LayerDismissMode`, `Position`, `Util`, `DialogBackdrop`, `Placement`, `callable`) plus `ListenerBag`. Implement per _Internal Structure_.
4. **`src/typescript/lib/core/index.ts`** — add `export { Drawer } from '~/core/Drawer.js';` and `export type { DrawerOptions, DrawerEdge, DrawerEvent, DrawerCloseController } from '~/core/Drawer.js';` beside the `Dialog` export (line 34). → verify: `grep -n Drawer src/typescript/lib/core/index.ts`.
5. **Typecheck + lint** the whole package. → verify: `npm run build` (or the project's tsc task) — 0 errors.
6. **Demo wiring** — add a Drawer trigger to the demo screen used for overlays (the screen that exercises `Dialog`/`Window`; locate via `grep -rln 'new Dialog\|Dialog(' src/typescript/*.ts`). Open one modal and one non-modal drawer per edge to eyeball the four geometries. (Demo wiring is throwaway; do not ship it in the library.)
7. **Docs** — see _Documentation Impact_.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `src/typescript/lib/core/Drawer.ts` |
| Create | `docs/components/Drawer.md` |
| Modify | `src/typescript/lib/core/Theme.ts` (interface block + `themeToVars`) |
| Modify | `src/typescript/lib/core/themes/ModernTheme.ts` |
| Modify | `src/typescript/lib/core/themes/ClassicTheme.ts` |
| Modify | `src/typescript/lib/core/themes/DarkTheme.ts` |
| Modify | `src/typescript/lib/core/index.ts` (barrel export) |
| Modify | `docs/.vitepress/config.mts` (sidebar entry) |
| Modify | `docs/components/index.md` (catalog entry) |

---

## Verification

- **Typecheck:** package build is 0 errors. The `Theme` interface change forces all three theme files to define `drawer`; a miss is a compile error.
- **Token grep:** `grep -rn 'ts-ui-drawer' src/typescript/lib/core` → exactly the interface-driven `themeToVars` lines; `grep -rn 'drawer:' src/typescript/lib/core/themes` → 3 matches.
- **Barrel:** `grep -n Drawer src/typescript/lib/core/index.ts` → value + type exports present.
- **Manual smoke (demo screen):** for each of the four edges, open a **modal** drawer — confirm it slides in from the correct edge, the scrim dims the app and blocks clicks, clicking the scrim closes it, Esc closes it. Then a **non-modal** drawer — confirm the app stays interactive behind it, an outside click does *not* close it, Esc does *not* close it, and `close()`/`toggle()` from a control closes it. Re-open a closed drawer and confirm its children's state/transitions survived (persistent mount).
- **Reduced motion:** with `prefers-reduced-motion: reduce`, drawers appear/disappear instantly with no slide and `open`/`close` events still fire.
- **Theme toggle:** switch Modern ↔ Dark with a drawer open; panel bg/shadow/border and scrim opacity update live.
- **Docs:** `npm run docs:build` → 0 errors, 0 link warnings (typedoc's "unsupported TypeScript version" notice excepted). Confirm `Drawer` lands under `docs/api/core/classes/Drawer` (the `callable` plugin promotes it from `variables/`).

---

## Documentation Impact

- **Barrel:** exported from `src/typescript/lib/core/index.ts` (the `core` subpath barrel — there is no root barrel). `@category Core` on the class and `DrawerOptions`.
- **`callable` promotion:** the `export { DrawerCallable as Drawer }` + `const DrawerCallable = callable(Drawer)` form is auto-promoted from `variables/` to `classes/` by `typedoc-callable-plugin.mjs` — verify after build per `_shared/docs-conventions.md`.
- **Curated page:** add `docs/components/Drawer.md` (model on `docs/components/Dialog.md`), link it in the `Core` group of the sidebar in `docs/.vitepress/config.mts` (beside the `Dialog` / `Notification` entries at ~line 59), and add it to the `docs/components/index.md` catalog.
- **Cross-bucket JSDoc:** `DrawerEdge` references `Placement` (a `primitive`-bucket enum) — use a markdown link `[\`Placement\`](/api/primitive/enumerations/Placement)`, not `{@link}`. Same for any `DialogBackdrop` / `LayerManager` references that cross buckets.

---

## Potential Challenges

- **`setSize` name clash with `Component.setSize`.** Resolved by naming the drawer setter `setDrawerSize`/`getDrawerSize` while keeping the `size` *option* — implementer must route `opts.size → setDrawerSize` in `applyOptions` and not shadow the inherited geometry setter.
- **Class-field super-cascade.** `_edge`/`_modal`/`_size`/`_durationMs` are written by setters during `super()`→`applyOptions`; declaring them with an initializer would silently wipe the applied value post-super. Use `declare`.
- **Setter DOM access before render.** `setEdge`/`setModal`/`setDrawerSize` must only cache; all geometry/CSS is applied in `open()` where the element exists. A `getElement(true)` in a setter would throw or no-op pre-render.
- **Transition-cancelling re-parent.** Never move the drawer's children to another host; keep the instance persistent across open/close so descendant CSS transitions survive (auto-memory: content-frame re-parent snaps transitions).
- **Scrim resize on viewport change.** The modal scrim is a fixed full-viewport element; on `resize` call `_backdrop.resize()` and re-derive the panel rect, exactly as [`Dialog.onViewportResize`](../src/typescript/lib/core/Dialog.ts#L766) does.
- **Double open/close.** Guard both with the `_open` flag (and ignore `open()` while an exit animation is mid-flight, or cancel it) so rapid toggles don't stack listeners or leak a backdrop.

---

## Critical Files

- [`src/typescript/lib/core/Dialog.ts`](../src/typescript/lib/core/Dialog.ts) — the closest analog: backdrop wiring, `LayerManager.register`/`getZIndex`/`unregister`, `Animation.play` entrance/exit, `DismissableLayer` impl, viewport-resize handling.
- [`src/typescript/lib/core/LayerManager.ts`](../src/typescript/lib/core/LayerManager.ts) — `DismissableLayer` interface (lines 39-92), `LayerDismissMode` (21), `Band` (175), `register`/`unregister`/`getZIndex`, and the Esc/outside-click handlers (487-514) the drawer delegates to.
- [`src/typescript/lib/component/container/DialogBackdrop.ts`](../src/typescript/lib/component/container/DialogBackdrop.ts) — the reused scrim: constructor, `addClickListener`, `resize`, `destroy`.
- [`src/typescript/lib/core/Animation.ts`](../src/typescript/lib/core/Animation.ts) — `play(el, config)` (91) and `isReducedMotion` (71); the slide mechanism.
- [`src/typescript/lib/core/Component.ts`](../src/typescript/lib/core/Component.ts) — base class, `ComponentOptions` (105), `applyOptions` (383), `setPosition` (2639), `setZIndex` (1199), `removeElement` (579).
- [`src/typescript/lib/core/ButtonGroup.ts`](../src/typescript/lib/core/ButtonGroup.ts) — the typed `on`/`off`/`emit` + `ListenerBag` + `options.listeners`-in-constructor pattern to copy (lines 60, 92-123).
- [`src/typescript/lib/primitive/Placement.ts`](../src/typescript/lib/primitive/Placement.ts) — the `Placement` enum the `edge` type derives from.
- [`src/typescript/lib/core/Theme.ts`](../src/typescript/lib/core/Theme.ts) + `themes/{Modern,Classic,Dark}Theme.ts` — token plumbing.

---

## Non-Goals

- **Resizable / draggable edge.** The drawer has a fixed `size`; no resize gutter. (A resizable drawer would compose `Split`, per the auto-memory "Grid won't get split gutters" single-responsibility principle — out of scope here.)
- **Swipe / touch-drag-to-open gestures.** Open/close is API- and control-driven only.
- **Multiple simultaneous drawers on the same edge / a drawer stack manager.** Each `Drawer` is independent; coordinating several is the caller's concern.
- **Built-in header / close-button chrome.** The drawer is a bare content host; callers add their own header and dismiss control. (A modal drawer gets scrim-click + Esc for free.)
- **`"click-outside"` default for non-modal drawers.** Deliberately sticky; callers can opt into outside-close against the public API.
