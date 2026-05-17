# Window Maximize / Minimize & Ctrl-Snap Resize — Implementation Plan

## Overview

Two related enhancements bundled in one plan because both touch
[src/typescript/lib/core/Window.ts](../src/typescript/lib/core/Window.ts) and the surrounding
[WindowHeader](../src/typescript/lib/component/container/WindowHeader.ts) /
[WindowBorder](../src/typescript/lib/component/container/WindowBorder.ts) trio.

**Part 1** adds *minimize* and *maximize / restore* buttons to the right side of every
`WindowHeader` (left of the existing close button at
[WindowHeader.ts:65](../src/typescript/lib/component/container/WindowHeader.ts#L65)) and
introduces a `WindowState` machine on `Window` itself
([Window.ts:63](../src/typescript/lib/core/Window.ts#L63)). Double-click on the header bar also
toggles maximize.

**Part 2** layers a Ctrl-modifier "snap-to-edge" affordance over the existing eight
[WindowBorder](../src/typescript/lib/component/container/WindowBorder.ts) strips. While Ctrl
(or Cmd on macOS) is held the cursor's nearest border within a 12 px threshold is highlighted
and treated as if the user had clicked the strip directly — making the 4 px-wide grab areas
easier to land on.

Both features are opt-in via existing `WindowOptions` extension points
([Window.ts:24-33](../src/typescript/lib/core/Window.ts#L24-L33)) and default to enabled so the
demo panels in [src/typescript/MiscPanel.ts](../src/typescript/MiscPanel.ts) pick them up
without changes.

---

## Architecture Decisions

### Single state field, not three booleans — Part 1

`WindowState = "normal" | "minimized" | "maximized"` lives on the instance as `_windowState`.
A union beats three booleans because the states are mutually exclusive — the type system makes
"minimized AND maximized" impossible. A single `_restoreRect: { x, y, width, height } | null`
caches the pre-toggle geometry, captured the moment we leave `"normal"`, cleared on the way
back. Mirrors how `setTranslate`'s field-DOM invariant cache works at
[Component.ts:1855-1869](../src/typescript/lib/core/Component.ts#L1855-L1869).

### Buttons added to WindowHeader, not Window — Part 1

The existing close button is built and owned by `WindowHeader`
([WindowHeader.ts:65-69](../src/typescript/lib/component/container/WindowHeader.ts#L65-L69)),
not by `Window`. Following that precedent, `WindowHeader` mounts up to three Buttons in an
HBox to the east. `Window` registers click listeners through new
`addMinimizeButtonListener` / `addMaximizeButtonListener` accessors that mirror the existing
`addExitButtonListener` at
[WindowHeader.ts:175-179](../src/typescript/lib/component/container/WindowHeader.ts#L175-L179).
`Window.ts` stays the orchestrator; `WindowHeader.ts` stays the chrome.

### Header double-click → maximize toggle — Part 1

A `dblclick` listener attached via `Event.addListener` on the header — the same channel used
for the existing `mousedown` registration at
[Window.ts:158](../src/typescript/lib/core/Window.ts#L158). When the event target is one of
the three header buttons (`mindown` short-circuits inside the listener) we no-op so the
buttons keep their click semantics.

### Maximize bounds — viewport by default, parent opt-in — Part 1

`Window` is appended directly to `document.documentElement` at
[Window.ts:231](../src/typescript/lib/core/Window.ts#L231), so the natural "fill"
target is the viewport (`window.innerWidth` / `window.innerHeight`). For embedded uses —
when a caller has reparented the Window into a regular Panel — `setMaximizeBounds("parent")`
fills `this.getElement()!.parentElement!.getBoundingClientRect()` instead. Default `"viewport"`
keeps the floating case lossless.

### Minimize as a docked header strip, body hidden — Part 1

Minimize drops the Window to header height, fixed `--ts-ui-window-min-dock-width` width
(default `200px`), positioned at viewport `bottom-left` and adjacent to any other minimized
windows tracked by `Window.openWindows` ([Window.ts:67](../src/typescript/lib/core/Window.ts#L67)).
The body content is hidden by toggling the inner `contentFactory` host (or, if eager content
exists, the first non-header child) via `setDisplayed(false)`
([Component.ts:805](../src/typescript/lib/core/Component.ts#L805)). The DOM stays mounted so
restore is instant.

The minimized stack is computed each time any window minimizes or restores by walking
`Window.openWindows` in insertion order and placing each minimized window at
`x = i * (dockWidth + gap)` along the bottom edge, where `gap = 4 px`. No new tracker —
reuse the existing `Set` that `bringToFront` already maintains.

### Border-handle drag is disabled while minimized or maximized — Part 1

`onResize` ([Window.ts:418-428](../src/typescript/lib/core/Window.ts#L418-L428)) early-returns
when `_windowState !== "normal"`. The eight `WindowBorder` strips remain in the DOM but their
drag listeners no-op, so the cursor still hits them but nothing moves. Cheaper than detaching
and re-attaching the listeners every transition.

### Animation via rect tween, honours reduced motion — Part 1

Each state transition tweens `x`, `y`, `width`, `height` on a single
`requestAnimationFrame` loop over `WINDOW_ANIM_DURATION_MS` (already declared at
[Window.ts:17](../src/typescript/lib/core/Window.ts#L17)) using a cubic ease. When
`Animation.isReducedMotion()` ([Animation.ts:70-72](../src/typescript/lib/core/Animation.ts#L70-L72))
is true, snap to the final rect in one frame. The body component is hidden *after*
the minimize tween finishes and shown *before* the restore tween starts, so the user sees
the rect motion against the body content.

### Snap modifier listened at window level, drag still goes through WindowBorder — Part 2

Ctrl can be held *before* the cursor reaches a border, so the snap detection lives on `Window`
and listens at `document` level via `Event.addViewportListener`. When the modifier is held
and the cursor is within `_snapThreshold` of one of the eight strip rectangles, that strip is
flagged as the "snap target". On `mousedown` while flagged, `Window` forwards the event
directly into the target `WindowBorder.onDragStart` via a small re-entry helper. The existing
drag flow at [WindowBorder.ts:137-145](../src/typescript/lib/component/container/WindowBorder.ts#L137-L145)
takes over from there — no changes to `WindowBorder`'s state machine.

### Snap visual feedback via CSS class on the target border — Part 2

The flagged `WindowBorder` instance gets the class `ts-ui-window-border-snap-target` via
`setClass` (already part of `Component`). A single CSS rule keyed off that class applies
`box-shadow: var(--ts-ui-window-snap-glow)`. Only one border carries the class at a time —
swapping is a `clearClass` / `setClass` pair driven by the mousemove handler.

### Snap detection runs only while Ctrl is held — Part 2

`_snapEnabled` flips on `keydown` (when the modifier key is pressed and no other modifier is
chorded) and flips back on `keyup` or `blur`. While `_snapEnabled` is true a `mousemove`
listener is attached at viewport level; while false the listener is detached. Avoids the
common mistake of running snap math on every cursor movement system-wide.

### One pointer-events overlay during snap drag — Part 2

The existing `WindowBorder.onDragStart` already sets `body.style.pointerEvents = "none"`
([WindowBorder.ts:144](../src/typescript/lib/component/container/WindowBorder.ts#L144)) so
text selection and panel hover effects are already suppressed. The snap path piggybacks on
that — no second overlay needed. The class is cleared in `onDragStop`.

---

## Public API (TypeScript Signatures)

### `WindowState` type — new export from `Window.ts`

```ts
export type WindowState = "normal" | "minimized" | "maximized";
```

### `WindowOptions` additions — extend interface at [Window.ts:24-33](../src/typescript/lib/core/Window.ts#L24-L33)

```ts
export interface WindowOptions extends PanelOptions {
    // existing fields unchanged …
    minimizable?:        boolean;                          // default true
    maximizable?:        boolean;                          // default true
    maximizeBounds?:     "viewport" | "parent";            // default "viewport"
    snapResizeEnabled?:  boolean;                          // default true
    snapThreshold?:      number;                           // default 12
    snapModifier?:       "ctrl" | "meta" | "alt" | "shift"; // default "ctrl"
    windowState?:        WindowState;                      // default "normal"
}
```

### `Window` instance methods — add alongside the existing setters

```ts
// Part 1 — state machine
setWindowState(state: WindowState):    this;
getWindowState():                      WindowState;
isMaximized():                         boolean;
isMinimized():                         boolean;
setMinimizable(value: boolean):        this;
isMinimizable():                       boolean;
setMaximizable(value: boolean):        this;
isMaximizable():                       boolean;
setMaximizeBounds(value: "viewport" | "parent"): this;
getMaximizeBounds():                   "viewport" | "parent";

// Part 2 — snap-resize
setSnapResizeEnabled(value: boolean):  this;
isSnapResizeEnabled():                 boolean;
setSnapThreshold(px: number):          this;
getSnapThreshold():                    number;
setSnapModifier(key: "ctrl" | "meta" | "alt" | "shift"): this;
getSnapModifier():                     "ctrl" | "meta" | "alt" | "shift";
```

Each setter follows the three-rule contract enforced by `/implement`: cached backing field
(`_windowState`, `_minimizable`, `_maximizable`, `_maximizeBounds`, `_snapEnabled`,
`_snapThreshold`, `_snapModifier`), typed setter, and matching `WindowOptions` entry
forwarded by `applyOptions`.

### `WindowHeaderOptions` additions — extend interface at [WindowHeader.ts:19-22](../src/typescript/lib/component/container/WindowHeader.ts#L19-L22)

```ts
export interface WindowHeaderOptions extends HeaderOptions {
    closeable?:    boolean;
    minimizable?:  boolean;   // new
    maximizable?:  boolean;   // new
    glyph?:        string;
}
```

### `WindowHeader` new public methods — add next to `addExitButtonListener`

```ts
setMinimizable(value: boolean):                     this;
setMaximizable(value: boolean):                     this;
setMaximizeButtonGlyph(name: "window-maximize" | "window-restore"): this;
addMinimizeButtonListener(listener: Function):      this;
addMaximizeButtonListener(listener: Function):      this;
addHeaderDoubleClickListener(listener: Function):   this;
```

`setMaximizeButtonGlyph` is the swap path Window calls when transitioning between `"normal"`
and `"maximized"` so the icon flips from "maximize" to "restore".

---

## Theme Tokens

Add to the `Theme` interface at [Theme.ts:90-92](../src/typescript/lib/core/Theme.ts#L90-L92):

```ts
window: {
    shadow:        string;
    snapGlow:      string;   // new
    minDockWidth:  string;   // new
};
```

| CSS Custom Property              | Light Default                                                      | Dark Default                                                       | Purpose                                              |
| -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------- |
| `--ts-ui-window-snap-glow`       | `0 0 0 2px rgba(30, 100, 200, 0.7)`                                | `0 0 0 2px rgba(80, 150, 240, 0.8)`                                | Box-shadow on the snap-target WindowBorder strip.    |
| `--ts-ui-window-min-dock-width`  | `200px`                                                            | `200px`                                                            | Fixed width of a minimized (docked) window.          |

Edit blocks: `Theme` interface ([Theme.ts:90](../src/typescript/lib/core/Theme.ts#L90)),
`DefaultTheme` ([Theme.ts:303](../src/typescript/lib/core/Theme.ts#L303)), `DarkTheme`
([Theme.ts:457](../src/typescript/lib/core/Theme.ts#L457)), and `themeToVars`
([Theme.ts:597](../src/typescript/lib/core/Theme.ts#L597)).

---

## Internal Structure

### Private state shape on `Window` (additions)

```ts
private _windowState:       WindowState = "normal";
private _restoreRect:       { x: number; y: number; width: number; height: number } | null = null;
private _minimizable:       boolean = true;
private _maximizable:       boolean = true;
private _maximizeBounds:    "viewport" | "parent" = "viewport";
private _bodyHost:          Component | null = null;   // first non-header child for setDisplayed toggle

private _snapEnabled:       boolean = false;
private _snapResizeEnabled: boolean = true;
private _snapThreshold:     number  = 12;
private _snapModifier:      "ctrl" | "meta" | "alt" | "shift" = "ctrl";
private _snapTargetBorder:  WindowBorder | null = null;

private readonly boundOnSnapKeyDown:   (e: KeyboardEvent) => void = (e) => this.onSnapKeyDown(e);
private readonly boundOnSnapKeyUp:     (e: KeyboardEvent) => void = (e) => this.onSnapKeyUp(e);
private readonly boundOnSnapMouseMove: (e: MouseEvent)    => void = (e) => this.onSnapMouseMove(e);
```

### Header DOM after Part 1

```
WindowHeader (HBox/Border layout)
  WEST  → _titleRow (glyph + text)
  EAST  → _trailingRow (HBox, spacing: 2)
            ├── minimizeButton  (glyph "window-minimize")
            ├── maximizeButton  (glyph "window-maximize" or "window-restore")
            └── exitButton      (glyph "times", existing)
```

Move the existing `this.exitButton` mount into the new `_trailingRow` HBox so all three
buttons sit under one EAST slot. Visibility of each button is gated by `_minimizable` /
`_maximizable` / `closeable`.

### State transition matrix — Part 1

| from \\ to    | normal                      | minimized                          | maximized                          |
| ------------- | --------------------------- | ---------------------------------- | ---------------------------------- |
| **normal**    | —                           | save `_restoreRect`, tween to dock | save `_restoreRect`, tween to fill |
| **minimized** | tween to `_restoreRect`     | re-dock (z-reshuffle only)         | tween to fill                       |
| **maximized** | tween to `_restoreRect`     | tween to dock                      | re-fill (on viewport resize)        |

Body component `setDisplayed(false)` after entering `"minimized"`; `setDisplayed(true)`
before leaving it.

### Snap hit-detection — Part 2

For each `WindowBorder` in `this.borderComponents`, compute its rect via
`getBoundingClientRect()` once per mousemove tick (eight rectangles — cheap). The "snap zone"
is the rect inflated by `_snapThreshold` on each side. The cursor's nearest zone (Manhattan
distance to the strip's inner edge) wins; ties go to corners over edges. When the winner
changes, swap the `ts-ui-window-border-snap-target` class.

---

## Ordered Implementation Steps

### Part 1 — Maximize / Minimize

1. **Add glyphs.** In [Glyphs.ts:53](../src/typescript/lib/component/display/Glyphs.ts#L53)
   register `window-minimize`, `window-maximize`, `window-restore` as SVG entries. Use FA Free
   `window-minimize`, `window-maximize` (already noted at
   [Glyphs.ts:26](../src/typescript/lib/component/display/Glyphs.ts#L26)), and `window-restore`
   path data. Update the source comment at
   [Glyphs.ts:7-26](../src/typescript/lib/component/display/Glyphs.ts#L7-L26).
   Verify with a one-off `new Glyph("window-minimize")` in `MiscPanel` and check the sprite.

2. **Extend `WindowHeader`.** In
   [WindowHeader.ts](../src/typescript/lib/component/container/WindowHeader.ts):
   - Add private fields `minimizeButton`, `maximizeButton`, `_trailingRow`.
   - Add `_minimizable`, `_maximizable` backing fields.
   - In the constructor, build the `_trailingRow` HBox and move the existing `addComponent(this.exitButton, { placement: Placement.EAST })`
     into it; mount the row to EAST instead.
   - Wire `setMinimizable`, `setMaximizable`, `setMaximizeButtonGlyph`,
     `addMinimizeButtonListener`, `addMaximizeButtonListener`,
     `addHeaderDoubleClickListener` (the last one calls `Event.addListener(this, "dblclick", listener)`).
   - Forward `options.minimizable` / `options.maximizable` in `applyOptions`
     ([WindowHeader.ts:88-100](../src/typescript/lib/component/container/WindowHeader.ts#L88-L100)).
   - Verify: run typecheck (`npx tsc --noEmit`); open `MiscPanel`'s "Show window with image"
     button, three buttons appear; close still works.

3. **Add `WindowState` machinery to `Window`.** In
   [Window.ts](../src/typescript/lib/core/Window.ts):
   - Export `WindowState` union just above the `WindowOptions` interface.
   - Add the private fields listed in *Internal Structure*.
   - In the constructor (after `this.header = new WindowHeader(...)` at
     [Window.ts:147](../src/typescript/lib/core/Window.ts#L147)) wire
     `this.header.addMinimizeButtonListener(...)`, `addMaximizeButtonListener(...)`, and
     `addHeaderDoubleClickListener(...)` to toggle through `setWindowState`.
   - Capture the "body host" reference: when `contentFactory` resolves in `show()` at
     [Window.ts:255-260](../src/typescript/lib/core/Window.ts#L255-L260) and for any pre-existing
     child, store the first non-header child component as `this._bodyHost`.
   - Verify: typecheck; clicking minimize logs `getWindowState() === "minimized"`.

4. **Implement `setWindowState`.** Pure switch on (`from`, `to`):
   - Entering `"normal"` from anywhere: read `_restoreRect`, tween (see step 6) to it, clear
     `_restoreRect`, swap maximize glyph back to `"window-maximize"`, `setDisplayed(true)` on
     `_bodyHost`, re-enable resize via gating in `onResize` (see step 7).
   - Entering `"minimized"`: cache `_restoreRect` from current `getX/Y/Width/Height`, compute
     dock target rect (helper `computeDockRect()` walks `Window.openWindows` for the slot
     index), tween, then `setDisplayed(false)` on `_bodyHost`.
   - Entering `"maximized"`: cache `_restoreRect`, compute fill rect (helper
     `computeMaximizeRect()` honours `_maximizeBounds`), tween, swap maximize glyph to
     `"window-restore"`.

5. **Wire viewport-resize handler.** Add a `window`-level `resize` listener while
   `_windowState === "maximized"`. On fire, snap (no tween) to `computeMaximizeRect()`. Detach
   when leaving `"maximized"`. Register only once per Window via a `boundOnViewportResize` field.

6. **Rect tween helper.** Add `private animateRect(target: Rect, onDone?: () => void): void` —
   single `requestAnimationFrame` loop interpolating `x/y/width/height` over
   `WINDOW_ANIM_DURATION_MS`. Uses the same `setAutoCommitStyle(false)` / `doLayout()` /
   `setAutoCommitStyle(true)` envelope as `flushResize`
   ([Window.ts:462-510](../src/typescript/lib/core/Window.ts#L462-L510)). Short-circuit to
   the final rect when `Animation.isReducedMotion()` is true.

7. **Gate `onResize` and drag.** At the top of `onResize`
   ([Window.ts:418-428](../src/typescript/lib/core/Window.ts#L418-L428)) and `onMouseDown`
   ([Window.ts:392-410](../src/typescript/lib/core/Window.ts#L392-L410)) early-return when
   `_windowState !== "normal"`. Verify: maximize a window, dragging the title bar does
   nothing; restore, dragging works again.

8. **Forward new options in `applyOptions`.** Extend
   [Window.ts:183-197](../src/typescript/lib/core/Window.ts#L183-L197) with `minimizable`,
   `maximizable`, `maximizeBounds`, and `windowState`. Apply order: `minimizable`,
   `maximizable`, `maximizeBounds` first (they only mutate flags/header visibility), then
   `windowState` last (it triggers a tween).

9. **Verify Part 1.** Manual smoke test (see *Verification*).

### Part 2 — Ctrl-Snap Resize

10. **Add snap state fields.** Add the `_snap*` fields and bound listeners listed in
    *Internal Structure*.

11. **Forward snap options in `applyOptions`.** Add `snapResizeEnabled`, `snapThreshold`,
    `snapModifier` to `applyOptions`. Setters use equality short-circuits; `setSnapModifier`
    just rewrites `_snapModifier` (no listener swap — the keydown handler reads it each tick).

12. **Wire keyboard listeners.** In `show()`
    ([Window.ts:219-264](../src/typescript/lib/core/Window.ts#L219-L264)), if
    `_snapResizeEnabled`, attach `boundOnSnapKeyDown` / `boundOnSnapKeyUp` via
    `Event.addViewportListener(this, 'keydown', ...)` / `'keyup'`. Detach in `onExitAction`
    ([Window.ts:333-372](../src/typescript/lib/core/Window.ts#L333-L372)) alongside the existing
    cleanup.

13. **Implement snap mousemove.** `onSnapKeyDown` flips `_snapEnabled = true` (when the
    modifier matches `_snapModifier`) and adds `boundOnSnapMouseMove` viewport listener.
    `onSnapKeyUp` flips it back, detaches the listener, clears the current
    `_snapTargetBorder` class. `onSnapMouseMove` runs the hit-detection from *Internal
    Structure* and toggles `ts-ui-window-border-snap-target` on the winning border (or none).

14. **Add stylesheet rule.** Once per Window class — or, better, via `createClassRule` in
    the `WindowBorder` static init — register:
    ```css
    .ts-ui-window-border-snap-target { box-shadow: var(--ts-ui-window-snap-glow); }
    ```
    `createClassRule` already exists per the graph report; mirror an existing static block
    such as the one in `WindowBorder` or `Tooltip`. Verify by inspecting the document's
    `<style>` tags after window open.

15. **Forward snap mousedown to the target border.** On a viewport `mousedown` while
    `_snapEnabled && _snapTargetBorder !== null`, call
    `this._snapTargetBorder.onDragStart()` (rename `onDragStart` to accept no args — it
    already does, see
    [WindowBorder.ts:137](../src/typescript/lib/component/container/WindowBorder.ts#L137)).
    The browser's native mousemove flow then drives `fireDragListeners` as usual. Class is
    cleared in the matching `onDragStop`
    ([WindowBorder.ts:150](../src/typescript/lib/component/container/WindowBorder.ts#L150))
    via a small hook the Window registers.

16. **Add theme tokens.** Edit [Theme.ts](../src/typescript/lib/core/Theme.ts) per the
    *Theme Tokens* table.

17. **Verify Part 2.** Manual smoke test (see *Verification*).

18. **Doc-update sweep.** Run `npm run docs:build`, expect 0 errors and 0 link warnings
    (typedoc's "unsupported TypeScript version" warning is the lone acceptable one).

19. **Graph refresh.** Run `graphify update . --directed` (per
    [CLAUDE.md](../CLAUDE.md) and memory).

---

## Files to Create / Modify

| Action | File                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| Modify | [src/typescript/lib/core/Window.ts](../src/typescript/lib/core/Window.ts)                                  |
| Modify | [src/typescript/lib/component/container/WindowHeader.ts](../src/typescript/lib/component/container/WindowHeader.ts) |
| Modify | [src/typescript/lib/component/container/WindowBorder.ts](../src/typescript/lib/component/container/WindowBorder.ts) (CSS class rule + class-clear on `onDragStop`) |
| Modify | [src/typescript/lib/component/display/Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts)        |
| Modify | [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts)                                    |

No new files. No deletions.

---

## Verification

1. **Typecheck.** `npx tsc --noEmit` — zero new errors vs. baseline.
2. **Build.** `npx vite build` succeeds.
3. **Manual smoke at <http://localhost:8015>** (`npm run dev`). In `MiscPanel`:
   - Click **"Show window with image!"**. Three header-right buttons visible.
   - Click **minimize** → window tweens to bottom-left strip; only the header is visible.
   - Click **maximize** (on the docked strip) → window fills viewport.
   - Click **restore** (maximize icon now shows restore glyph) → original rect returns.
   - **Double-click** on the header bar (not on a button) → toggles maximize.
   - Open a **second window** and minimize both → they dock side-by-side at the bottom.
   - **Resize the browser viewport** while a window is maximized → window re-fills.
4. **Snap-resize check.**
   - With a window open, hold **Ctrl** and move the cursor near (within 12 px of) any edge.
     The border under the cursor glows.
   - Release Ctrl → glow disappears.
   - Hold Ctrl, click 8 px outside an edge, drag → the window resizes via that edge.
   - On macOS, repeat with `setSnapModifier("meta")` set on the Window.
5. **Theme-toggle.** Use the "Toggle theme" button in `MiscPanel`. Snap glow colour
   shifts between light and dark variants; minimize dock width stays at 200 px.
6. **Reduced motion.** In Chrome DevTools, set *Rendering → Emulate CSS prefers-reduced-motion: reduce*.
   Minimize / maximize transitions snap instantly with no tween.
7. **Docs build.** `npm run docs:build` reports 0 errors and 0 link warnings (typedoc's
   "unsupported TypeScript version" notice is the lone acceptable warning).
8. **Graph refresh.** `graphify update . --directed`.

---

## Documentation Impact

- `WindowState` type is exported alongside `WindowOptions` from
  [src/typescript/lib/core/index.ts:20-21](../src/typescript/lib/core/index.ts#L20-L21).
  Add a line for the new type next to those.
- No new symbols in `container/index.ts` — `WindowHeader`'s new methods don't change its
  export name ([container/index.ts:19-20](../src/typescript/lib/component/container/index.ts#L19-L20)).
- The curated `Window` doc page under `docs/core/` should grow two sections:
  *"Maximize / minimize"* and *"Snap-resize modifier"*. Cross-bucket links to
  `[\`WindowBorder\`](/api/component/container/classes/WindowBorder)` and
  `[\`WindowHeader\`](/api/component/container/classes/WindowHeader)` follow the markdown-link
  convention from [CLAUDE.md](../CLAUDE.md).
- JSDoc on new setters: same-bucket references to fields stay as `{@link}`; cross-bucket
  references to `WindowHeader` / `WindowBorder` must use the markdown-link form.

---

## Potential Challenges

- **Dock-slot collisions when a third window minimizes.** Mitigation: recompute every
  minimized window's slot index on each transition; cheap because `openWindows` is bounded
  by user behaviour (handful at most).
- **`Event.addViewportListener` stops mouseup propagation** when any viewport listener for
  the type exists (per the comment at
  [Window.ts:404-407](../src/typescript/lib/core/Window.ts#L404-L407)). Snap's mousemove and
  keydown listeners don't overlap with drag's mouseup, so the existing comment's guidance
  still holds. Sanity-check by re-reading `Event.baseViewportListener` before wiring.
- **Snap `getBoundingClientRect()` on eight borders per mousemove** could allocate. Mitigation:
  detection only runs while Ctrl is held and a Window is on screen — bounded by user
  attention, not by frame rate.
- **`window-restore` SVG path** isn't in the existing FA Free import list; the
  parallel `fontawesome-free-registry-import` plan may land it first. If it hasn't, ship a
  hand-traced two-square-overlap path (Material Symbols also has a permissive equivalent).
- **Reduced-motion edge case.** When the tween is skipped, the `setDisplayed(false)` on the
  body must still happen *after* the rect is committed, not before — otherwise the layout
  pass mid-transition will shrink to header height while still tweening, which double-flashes.
  Order: commit rect first, then toggle display, in the same `requestAnimationFrame`.
- **Maximize during drag.** If the user holds the drag and the maximize button somehow
  receives a click (unlikely but possible via keyboard), the drag's `onMouseUp` would commit
  the maximize-time translate back into `x/y` and corrupt `_restoreRect`. Mitigation: the
  `setWindowState` entry path should call `onMouseUp` first if `animationFrameId !== null`.

---

## Critical Files

- [src/typescript/lib/core/Window.ts](../src/typescript/lib/core/Window.ts) — primary edit
  target; understand the drag/resize lifecycle at lines 392-541 before touching `setWindowState`.
- [src/typescript/lib/component/container/WindowHeader.ts](../src/typescript/lib/component/container/WindowHeader.ts) —
  mimic the existing close-button mount pattern at lines 65-69 and 175-179.
- [src/typescript/lib/component/container/WindowBorder.ts](../src/typescript/lib/component/container/WindowBorder.ts) —
  drag lifecycle hooks `onDragStart` / `onDragStop` are the integration point for snap mousedown forwarding.
- [src/typescript/lib/component/display/Glyphs.ts](../src/typescript/lib/component/display/Glyphs.ts) —
  registry add pattern (lines 53-151); update source-attribution comment at lines 7-26.
- [src/typescript/lib/core/Theme.ts](../src/typescript/lib/core/Theme.ts) — four blocks to
  edit per token: interface (line 90), `DefaultTheme` (line 303), `DarkTheme` (line 457),
  `themeToVars` (line 597).
- [src/typescript/lib/core/Animation.ts](../src/typescript/lib/core/Animation.ts) — call
  `Animation.isReducedMotion()` at line 70 for the no-tween branch.
- [src/typescript/lib/core/Component.ts](../src/typescript/lib/core/Component.ts) —
  `setDisplayed` (line 805), `setVisible` (line 742), three-rule setter contract.
- [src/typescript/MiscPanel.ts](../src/typescript/MiscPanel.ts) — demo screen used in
  verification at lines 87-99 (`Show window with image`).

---

## Non-Goals

- **No drag-to-edge "Aero snap" half-screen behaviour.** Out of scope. The Ctrl-snap here
  only helps grab the existing 4 px border strips; it doesn't reshape the window when dropped
  near a viewport edge.
- **No restore-from-taskbar UI.** Minimized windows are clickable on the docked strip itself
  (clicking the restore button restores). A separate "taskbar" component is a different
  feature.
- **No persistence of window state across reloads.** The state machine lives on the instance.
- **No multi-monitor awareness.** `setMaximizeBounds("viewport")` fills the browser viewport,
  not the OS screen.
- **No animation customization API.** Tween duration stays at the file-level
  `WINDOW_ANIM_DURATION_MS` constant — changing it for one Window would diverge from the
  open/close animation duration and look broken.
