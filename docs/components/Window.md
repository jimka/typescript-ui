# Window

[`Window`](/api/core/classes/Window) is a floating, draggable, resizable panel with a title bar and a close button. Multiple windows stack with auto-managed `z-index`, and clicks outside the active window deactivate it.

## Usage

```typescript
import { Body, Window } from '@jimka/typescript-ui/core';
import { TablePanel } from '@jimka/typescript-ui/component/table';

// Constructor + options bag: title text, geometry, optional title-icon
// glyph, and any common ComponentOptions field. For expensive content,
// `contentFactory` + `onReady` defer construction behind a spinner.
const win = new Window('Settings', {
    x: 200, y: 100, width: 360, height: 240,
    glyph: 'times',
    contentFactory: () => new TablePanel(store),
    onReady:        () => void store.load()
});

Body.getInstance().addComponent(win);
win.show();
```

## Construction

`new Window(headerText, options?)` — the title text is the first positional argument; `options` is a [`WindowOptions`](/api/core/interfaces/WindowOptions) bag.

| Option | Type | Purpose |
| --- | --- | --- |
| `headerText` | `string` | Overrides the positional `headerText`. Last-write-wins. |
| `glyph`      | `string \| null` | Registry [`Glyph`](/components/Glyph) name shown to the left of the title text. Omit to get the default `window` glyph; pass `null` to render a window with no title icon. |
| `x` / `y`    | `number` | Initial top-left corner in viewport coordinates. Default `50` / `50`. |
| `width` / `height` | `number` | Initial size in pixels. Default `400` / `300`. |
| `contentFactory` | `() => Component` | Deferred content builder. When set, `show()` opens the window immediately with a spinner in the content area and runs the factory after a two-rAF yield via [`Animation.materialize`](/api/core/namespaces/Animation/functions/materialize). |
| `onReady` | `(component) => void` | Optional callback fired after the factory's component has been attached, laid out, and faded in. Use for work that must happen against a rendered subtree (e.g. `store.load()` for a TablePanel's loading overlay). |

Inherits all [`PanelOptions`](/api/core/interfaces/PanelOptions) / [`ComponentOptions`](/api/core/interfaces/ComponentOptions) fields. Geometry defaults mean `new Window(title).show()` produces a 400 × 300 window at `(50, 50)` without further setters.

## Common methods

| Method | Purpose |
| --- | --- |
| `setHeaderText(text)` | Title-bar text. |
| `getHeader()` | The internal [`WindowHeader`](/api/component/container/classes/WindowHeader) — call `setGlyph(name)` on it for the title icon, or listen on its close button. |
| `show()` | Display the window and bring it to the front. |
| `setSize(w, h)` / `setPosition(x, y)` | Initial geometry. |
| `setResizeFps(fps)` | Throttle resize-driven layout (default 30). |
| `addExitActionListener(fn)` | Called when the user clicks the × button. |

The full surface — drag listeners, focus / activation events, viewport-clamping — is in the [API reference](/api/core/classes/Window).

## DOM placement

Windows append themselves to `document.documentElement` (not `<body>`) so they can layer above any backdrop. This is also why theme tokens cascade from `<html>` rather than `<body>` — see [Theming › How it works](/concepts/theming#how-it-works).

## Animation

`show()` fades the window in over 150 ms with a small `scale(0.97 → 1)` lift, matching [`Dialog`](/components/Dialog)'s open transition. `onExitAction()` reverses the same fade-and-shrink before the destructor runs, so the window doesn't pop out from under the cursor. Both transitions honour `prefers-reduced-motion: reduce` and skip the animation when motion is reduced.

## Gotchas

- A `Window` is not added to its parent's layout flow. It floats in absolute coordinates and you control its position via `setPosition` / `setSize`.
- Calling `show()` is what registers it with the active-window tracking. Without `show()`, drag and focus behavior won't activate.
- Use `setResizeFps(0)` to disable throttling during resize if you need every frame.

## See also

- [API: Window](/api/core/classes/Window)
- [Mental model](/guide/mental-model)
- Recipe: [Floating window](/recipes/floating-window)
