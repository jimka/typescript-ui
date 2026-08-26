# Window

[`Window`](/api/overlay/classes/Window) is a floating, draggable, resizable panel with a title bar and a close button. Multiple windows stack with auto-managed `z-index`, and clicks outside the active window deactivate it.

`Window` extends [`AbstractWindow`](/components/AbstractWindow), the abstract base that holds the header-agnostic window machinery (resize borders, move, window-state lifecycle, z-order, show/hide). `Window` is the concrete subclass that adds a [`WindowHeader`](/api/component/container/classes/WindowHeader) title bar; its headerless sibling is [`TabWindow`](/components/TabWindow). `getHeader()` still returns the `WindowHeader` exactly as before.

## Usage

```typescript
import { Body } from '@jimka/typescript-ui/core';
import { Window } from '@jimka/typescript-ui/overlay';

import { TablePanel } from '@jimka/typescript-ui/component/table';

// Constructor + options bag: title text, geometry, optional title-icon
// glyph, and any common ComponentOptions field. For expensive content,
// `contentFactory` + `onReady` defer construction behind a spinner.
const win = Window('Settings', {
    x: 200, y: 100, width: 360, height: 240,
    glyph: 'times',
    contentFactory: () => TablePanel(store),
    onReady:        () => void store.load()
});

Body.init({ components: [win] });
win.show();
```

## Construction

`Window(headerText, options?)` — the title text is the first positional argument; `options` is a [`WindowOptions`](/api/overlay/interfaces/WindowOptions) bag.

| Option | Type | Purpose |
| --- | --- | --- |
| `headerText` | `string` | Overrides the positional `headerText`. Last-write-wins. |
| `glyph`      | `string \| null` | Registry [`Glyph`](/components/Glyph) name shown to the left of the title text. Omit to get the default `window` glyph; pass `null` to render a window with no title icon. |
| `x` / `y`    | `number` | Initial top-left corner in viewport coordinates. Default `50` / `50`. |
| `width` / `height` | `number` | Initial size in pixels. Default `400` / `300`. |
| `contentFactory` | `() => Component` | Deferred content builder. When set, `show()` opens the window immediately with a spinner in the content area and runs the factory after a two-rAF yield via [`Animation.materialize`](/api/core/namespaces/Animation/functions/materialize). |
| `onReady` | `(component) => void` | Optional callback fired after the factory's component has been attached, laid out, and faded in. Use for work that must happen against a rendered subtree (e.g. `store.load()` for a TablePanel's loading overlay). |
| `minimizable`    | `boolean` | Show the title-bar minimize button. Default `true`. |
| `maximizable`    | `boolean` | Show the title-bar maximize button. Default `true`. |
| `resizable`      | `boolean` | Enable the drag-to-resize border strips. Default `true`. |
| `maximizeBounds` | `"viewport" \| "parent"` | Where to fill on maximize. Default `"viewport"`. |
| `windowState`    | `"normal" \| "minimized" \| "maximized"` | Initial lifecycle state. Default `"normal"`. |
| `snapResizeEnabled` | `boolean` | Enable Ctrl-snap resize detection. Default `true`. |
| `snapThreshold`     | `number` | Cursor-to-edge distance (pixels) under which a border becomes the snap target. Default `12`. |
| `snapModifier`      | `"ctrl" \| "meta" \| "alt" \| "shift"` | Modifier key that activates snap-resize detection. Default `"ctrl"`. |
| `constrainToViewport` | `boolean` | Keep the whole window inside the viewport while dragging — every border stops at the edge. When `false`, the window may travel off-screen but its header stays grabbable. Default `true`. |

Inherits all [`PanelOptions`](/api/core/interfaces/PanelOptions) / [`ComponentOptions`](/api/core/interfaces/ComponentOptions) fields. Geometry defaults mean `Window(title).show()` produces a 400 × 300 window at `(50, 50)` without further setters.

## Common methods

| Method | Purpose |
| --- | --- |
| `setHeaderText(text)` | Title-bar text. |
| `getHeader()` | The internal [`WindowHeader`](/api/component/container/classes/WindowHeader) — call `setGlyph(name)` on it for the title icon, or listen on its close button. |
| `show()` | Display the window and bring it to the front. |
| `setSize(w, h)` / `setPosition(x, y)` | Initial geometry. |
| `setResizeFps(fps)` | Throttle resize-driven layout (default 30). |
| `on("close", fn)` | Called when the user clicks the × button. |

The full surface — drag listeners, focus / activation events, viewport-clamping — is in the [API reference](/api/overlay/classes/Window).

## DOM placement

Windows append themselves to `document.documentElement` (not `<body>`) so they can layer above any backdrop. This is also why theme tokens cascade from `<html>` rather than `<body>` — see [Theming › How it works](/concepts/theming#how-it-works).

## Animation

`show()` fades the window in over 150 ms with a small `scale(0.97 → 1)` lift, matching [`Dialog`](/components/Dialog)'s open transition. `onExitAction()` reverses the same fade-and-shrink before the destructor runs, so the window doesn't pop out from under the cursor. Both transitions honour `prefers-reduced-motion: reduce` and skip the animation when motion is reduced.

## Maximize / minimize

The title bar carries three trailing buttons — minimize, maximize, close — built and owned by [`WindowHeader`](/api/component/container/classes/WindowHeader). The owning `Window` registers click listeners that route through a single `setWindowState(state)` setter:

```typescript
win.setWindowState('maximized');  // fills viewport
win.setWindowState('normal');     // back to the cached rect
win.setWindowState('minimized');  // docked at bottom-left, header only
```

Double-clicking the header bar (anywhere that isn't one of the three trailing buttons) toggles maximize from `normal` and `maximized`; on a `minimized` window it restores to the state the window held before being minimized (`normal` or `maximized`). Each state transition tweens `x` / `y` / `width` / `height` over 150 ms; `prefers-reduced-motion: reduce` collapses the tween to a single synchronous commit so the layout settles in one frame.

While `maximized`, the window registers a viewport `resize` listener and re-fills on every tick. Switch the fill target with `setMaximizeBounds("parent")` if the window has been re-parented out of `document.documentElement` and should fill its parent rect instead.

While `minimized`, the body content (the first non-header child) is hidden via `setDisplayed(false)` and the window collapses to a fixed 200 px-wide strip docked along the viewport bottom. Multiple minimized windows lay out side-by-side in insertion order with a 4 px gap.

Drag and border-resize are gated to the `normal` state — a maximized or minimized window stays where it is until you call `setWindowState('normal')` (which also restores the pre-transition rect from the cache).

## Snap-resize modifier

The eight border strips around a window are 4 px wide; precise enough for a desktop pointer, fiddly on a touchpad. While `snapResizeEnabled` is true, holding the configured modifier (`Ctrl` by default) and moving the cursor within `snapThreshold` pixels of any border highlights the nearest [`WindowBorder`](/api/component/container/classes/WindowBorder) with the `--ts-ui-window-snap-glow` box-shadow. A `mousedown` while the highlight is active forwards the click into the strip's own drag flow — making the grab affordance effectively as wide as the threshold.

```typescript
win.setSnapModifier('meta');   // Cmd on macOS
win.setSnapThreshold(20);      // 20 px instead of the default 12
win.setSnapResizeEnabled(false); // opt out
```

## Gotchas

- A `Window` is not added to its parent's layout flow. It floats in absolute coordinates and you control its position via `setPosition` / `setSize`.
- Calling `show()` is what registers it with the active-window tracking. Without `show()`, drag and focus behavior won't activate.
- Use `setResizeFps(0)` to disable throttling during resize if you need every frame.
- **Removed:** `setTearOffStripBody` / `isTearOffStripBody` no longer exist. They marked a window as a strip-mode tear-off body so the header re-dock gesture stayed inert over it; that role is now handled structurally by the headerless [`TabWindow`](/components/TabWindow) (it has no header re-dock path at all), so the flag was deleted from the public surface.

## See also

- [API: Window](/api/overlay/classes/Window)
- [`AbstractWindow`](/components/AbstractWindow) — the shared window base class
- [`TabWindow`](/components/TabWindow) — the headerless tab-bar window sibling
- [Rail](/components/Rail) — minimize a window into an edge launcher strip via `setRail`
- [Mental model](/guide/mental-model)
- Recipe: [Floating window](/recipes/floating-window)
