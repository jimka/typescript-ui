# Window

[`Window`](/api/overlay/classes/Window) is a floating, draggable, resizable panel with a title bar and a close button. Multiple windows stack with auto-managed `z-index`, and clicks outside the active window deactivate it.

`Window` extends [`AbstractWindow`](/components/AbstractWindow), the abstract base that holds the header-agnostic window machinery (resize borders, move, window-state lifecycle, z-order, show/hide). `Window` is the concrete subclass that adds a [`WindowHeader`](/api/component/container/classes/WindowHeader) title bar; its headerless sibling is [`TabWindow`](/components/TabWindow). `getHeader()` still returns the `WindowHeader` exactly as before.

## Usage

```typescript
import { Body } from '@jimka/typescript-ui/core';
import { Window } from '@jimka/typescript-ui/overlay';

import { TablePanel } from '@jimka/typescript-ui/component/table';

const body = await Body.init();

// Constructor + options bag: title text, geometry, optional title-icon
// glyph, and any common ComponentOptions field. For expensive content,
// `contentFactory` + `onReady` defer construction behind a spinner.
const win = Window('Settings', {
    x: 200, y: 100, width: 360, height: 240,
    glyph: 'times',
    contentFactory: () => TablePanel(store),
    onReady:        () => void store.load()
});

body.addComponent(win);
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
| `minimizable`    | `boolean` | Show the title-bar minimize button. Default `true`. Hidden whenever `resizable` is `false`, regardless of this flag. |
| `maximizable`    | `boolean` | Show the title-bar maximize button. Default `true`. Hidden whenever `resizable` is `false`, regardless of this flag. |
| `resizable`      | `boolean` | Enable the drag-to-resize border strips. Default `true`. Also the master switch for `minimizable` / `maximizable` — setting it `false` hides and disables both, and setting it back to `true` restores whatever they were set to. |
| `alwaysOnTop`    | `boolean` | Keep the window above every unpinned window. Default `false`. Also toggleable from the title-icon menu's "Always on top" row. |
| `locked`         | `boolean` | Freeze the window: no drag-to-move and no drag-to-resize, and the resize-border strips are hidden. Also disables (never hides) the maximize button, the header double-click, and the menu's Maximize/Restore row — maximizing is itself a resize — but leaves minimize and close alone. Default `false`. Also toggleable from the title-icon menu's "Lock position" row. |
| `maximizeBounds` | `"viewport" \| "parent"` | Where to fill on maximize. Default `"viewport"`. |
| `windowState`    | `"normal" \| "minimized" \| "maximized"` | Initial lifecycle state. Default `"normal"`. |
| `snapResizeEnabled` | `boolean` | Enable Ctrl-snap resize detection. Default `true`. |
| `snapThreshold`     | `number` | Cursor-to-edge distance (pixels) under which a border becomes the snap target. Default `12`. |
| `snapModifier`      | `"ctrl" \| "meta" \| "alt" \| "shift"` | Modifier key that activates snap-resize detection. Default `"ctrl"`. |
| `constrainToViewport` | `boolean` | Keep the whole window inside the viewport while dragging — every border stops at the edge. When `false`, the window may travel off-screen but its header stays grabbable. Default `true`. |
| `autoFocus` | `boolean` | Take keyboard focus when code shows or raises the window. Default `true`. Pass `false` for a window opened in the background. |

Inherits all [`PanelOptions`](/api/core/interfaces/PanelOptions) / [`ComponentOptions`](/api/core/interfaces/ComponentOptions) fields. Geometry defaults mean `Window(title).show()` produces a 400 × 300 window at `(50, 50)` without further setters.

## Common methods

| Method | Purpose |
| --- | --- |
| `setHeaderText(text)` | Title-bar text. |
| `getHeader()` | The internal [`WindowHeader`](/api/component/container/classes/WindowHeader) — call `setGlyph(name)` on it for the title icon, or listen on its close button. |
| `show()` | Display the window, bring it to the front and move focus into it. |
| `setSize(w, h)` / `setPosition(x, y)` | Initial geometry. |
| `setResizeFps(fps)` | Throttle resize-driven layout (default 60). |
| `setResizeMode(mode)` | `'outline'` moves a frame during an edge drag and lays the window out once on release. |
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

Double-clicking the header bar (anywhere that isn't one of the three trailing buttons) toggles maximize from `normal` and `maximized` — a no-op while `locked` is `true`, same as the maximize button. On a `minimized` window it instead restores to the state the window held before being minimized (`normal` or `maximized`), regardless of `locked` — the same carve-out `Minimize` gets, since it returns the window to a rect it already held rather than letting the user pick a new one. Each state transition tweens `x` / `y` / `width` / `height` over 150 ms — unless it changes the window's width or height by more than 960 px, in which case the body content fades out first, the window glides to its new rect while that content stays hidden, and the content fades back in once it lands, so a wide or tall body is laid out once rather than on every animation frame. `prefers-reduced-motion: reduce` collapses either path to a single synchronous commit.

While `maximized`, the window registers a viewport `resize` listener and re-fills on every tick. Switch the fill target with `setMaximizeBounds("parent")` if the window has been re-parented out of `document.documentElement` and should fill its parent rect instead.

While `minimized`, the body content (the first non-header child) is hidden via `setDisplayed(false)` and the window collapses to a fixed 200 px-wide strip docked along the viewport bottom. Multiple minimized windows lay out side-by-side in insertion order with a 4 px gap. A window with a [`Rail`](/components/Rail) attached minimizes into that rail instead and takes no slot in the strip.

Drag and border-resize are gated to the `normal` state — a maximized or minimized window stays where it is until you call `setWindowState('normal')` (which also restores the pre-transition rect from the cache).

## Title-icon menu

Clicking the title-bar icon opens a system menu anchored under it: Minimize, Maximize, a separator, checkable "Always on top" and "Lock position" rows, another separator, and Close. Clicking the icon again (or elsewhere) closes it. The list is rebuilt on every open, so it always reflects live state:

- Minimize and Maximize read "Restore" while the window is `"minimized"` / `"maximized"`, and are omitted entirely when `minimizable` / `maximizable` (or the `resizable` master switch) hide the matching header button. Each carries the same glyph its header button shows in that state (e.g. Maximize swaps to the restore glyph alongside the "Restore" label).
- Maximize/Restore is additionally disabled (never omitted) while `locked` is `true`, mirroring the header button — locking blocks the action, not just its current label.
- The two checkable rows track `isAlwaysOnTop()` / `isLocked()` and toggle `setAlwaysOnTop` / `setLocked` on activation, leaving the menu open so both can be flipped in one visit. Neither carries a glyph.
- Close is always present; it disables (rather than disappearing) when `closeable` is `false`, matching the header's close button. It carries the same `xmark` glyph as the header's close button.

## Snap-resize modifier

The eight border strips around a window are 4 px wide; precise enough for a desktop pointer, fiddly on a touchpad. While `snapResizeEnabled` is true, holding the configured modifier (`Ctrl` by default) and moving the cursor within `snapThreshold` pixels of any border highlights the nearest [`WindowBorder`](/api/component/container/classes/WindowBorder) with the `--ts-ui-window-snap-glow` box-shadow. A `mousedown` while the highlight is active forwards the click into the strip's own drag flow — making the grab affordance effectively as wide as the threshold.

```typescript
win.setSnapModifier('meta');   // Cmd on macOS
win.setSnapThreshold(20);      // 20 px instead of the default 12
win.setSnapResizeEnabled(false); // opt out
```

## Outline resizing

With `resizeMode: 'outline'` an edge or corner drag leaves the window where it is and moves a 2 px frame on the box the window will take — clamped exactly as the resize itself is, by the chrome's own minimum and by the viewport edge — and the window and its content are laid out once, on release. Press Escape before releasing to cancel: the frame disappears and the window keeps the geometry it had.

```typescript
const win = Window('Report', { resizeMode: 'outline' });
```

A window with no `resizeMode` of its own follows the app-wide default set through [`Body.init`](/components/Body#resize-mode). `setResizeFps` caps live frames only — an outline frame runs no layout, so capping it would just make the frame lag the pointer. Moving a window by its header is unaffected: it already only translates.

## Focus

A window takes keyboard focus when code shows it, so a screen reader announces it and a keyboard user lands in it. The window's own element takes focus, and `Tab` then moves to its first control; the library focuses no control inside it.

### `autoFocus` — an option at construction, default `true`

| How the window comes forward | `autoFocus: true` (default) | `autoFocus: false` |
| --- | --- | --- |
| `show()` | takes focus after the next layout | focus stays where it is |
| `bringToFront()` | takes focus at once, also when the window is already the active one | focus stays where it is |
| a pointer press inside it | focus moves to the window when the press activates it | the same |
| `restore()` from minimized | takes focus | takes focus |
| focus moves in by `Tab` or by the application's own `focus()` call | nothing more happens | the same |

Focus arrives after the window's first layout, so a field the application focuses right after `show()` keeps focus. Pass `autoFocus: false` to a window opened in the background, such as a tool palette, a log window or one opened from a timer, so that it does not take the caret from what the user is typing in. `setAutoFocus` / `isAutoFocus` change and read it later.

A single `bringToFront` call can override `autoFocus` with its own `focus` option — see [`WindowRaiseOptions`](/api/overlay/interfaces/WindowRaiseOptions):

| Call | Result |
| --- | --- |
| `bringToFront()` or `bringToFront({})` | `autoFocus` decides |
| `bringToFront({ focus: false })` | raises and activates the window without moving focus |
| `bringToFront({ focus: true })` | takes focus also with `autoFocus: false` |

### Focus returns to where it came from when the window closes

The window remembers the element focus was on when it last took focus. When it closes with focus inside it, focus goes back there.

| As the window closes | Focus afterwards |
| --- | --- |
| focus inside the window; it took focus from button `X`, which is still on the page | `X` |
| focus inside the window; `X` was disposed or removed | where the browser puts it (`<body>`) |
| focus is on the page (the user moved on, or code closed a background window) | unchanged |
| the window never took focus (`autoFocus: false`, and no press or `restore()` activated it) | unchanged |
| a `"close"` listener moves focus itself | that move wins: focus returns first, then the event fires |
| a `"beforeclose"` listener vetoes the close | unchanged |
| the window is disposed without being closed | unchanged |

A window that does not take focus is not announced. An application that wants one announced shows a [`Notification`](/components/Notification) or writes to its [`StatusBar`](/components/StatusBar).

## Screen readers

A window is announced as a dialog, as it opens, because it takes focus. It is not modal: the page behind it stays usable, and the window carries no `aria-modal`.

- **Name.** The window is named by its header text. The name is a reference to the header's title, so `setHeaderText` renames the window with no further call. Because the name is a reference, `getAria().setLabel(…)` alone does not change it: a browser prefers the reference. Remove it first with `win.getAria().clearLabelledBy().setLabel('Storage inspector')`.
- **Header buttons.** The three buttons are named "Minimize", "Maximize" and "Close", and each shows its name as a tooltip. The minimize button reads "Restore" while the window is minimized, and the maximize button reads "Restore" while it is maximized, including on a window constructed in that state. These are the words the [title-icon menu](#title-icon-menu) uses for the same actions.
- **Other names.** `win.getHeader().getMinimizeButton()`, `getMaximizeButton()` and `getCloseButton()` return the buttons. Call `setText` on one to rename it, for another language for example. A button you rename keeps your one name in every window state: the window replaces only a name it gave, and a renamed button no longer reads "Restore". The minimize button can be kept in step from the window's `"minimize"` and `"restore"` events; no event reports a maximize, so a renamed maximize button has a single name.

The title icon opens the window menu on a click but is not a button, so the keyboard cannot reach it. On a [`TabWindow`](/components/TabWindow) the same icon is a button named "Window menu".

## Gotchas

- A `Window` is not added to its parent's layout flow. It floats in absolute coordinates and you control its position via `setPosition` / `setSize`.
- Calling `show()` is what registers it with the active-window tracking. Without `show()`, drag and focus behavior won't activate.
- Use `setResizeFps(0)` to disable throttling during resize if you need every frame.
- A window is non-modal and does not trap focus: `Tab` from its last control moves on to the page. While a modal [`Dialog`](/components/Dialog) or modal [`Drawer`](/components/Drawer) is open, every window is inert, and a window shown meanwhile appears behind the backdrop, inert until the modal closes. It does not take focus when the modal closes: the modal returns focus to its own opener.
- **Removed:** `setTearOffStripBody` / `isTearOffStripBody` no longer exist. They marked a window as a strip-mode tear-off body so the header re-dock gesture stayed inert over it; that role is now handled structurally by the headerless [`TabWindow`](/components/TabWindow) (it has no header re-dock path at all), so the flag was deleted from the public surface.

## See also

- [API: Window](/api/overlay/classes/Window)
- [`AbstractWindow`](/components/AbstractWindow) — the shared window base class
- [`TabWindow`](/components/TabWindow) — the headerless tab-bar window sibling
- [Rail](/components/Rail) — minimize a window into an edge launcher strip via `setRail`
- [Mental model](/guide/mental-model)
- Recipe: [Floating window](/recipes/floating-window)
