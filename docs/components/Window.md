# Window

[`Window`](/api/core/classes/Window) is a floating, draggable, resizable panel with a title bar and a close button. Multiple windows stack with auto-managed `z-index`, and clicks outside the active window deactivate it.

## Usage

```typescript
import { Body, Window } from '@jimka/typescript-ui/core';
import { Text } from '@jimka/typescript-ui/component/input';

// Constructor + options bag: title text, optional title-icon glyph,
// and any common ComponentOptions field.
const win = new Window('Settings', { glyph: 'times' });
win.setSize(360, 240);
win.setPosition(200, 100);

const message = new Text('Welcome to Settings');
win.addComponent(message);

Body.getInstance().addComponent(win);
win.show();
```

## Construction

`new Window(headerText, options?)` — the title text is the first positional argument; `options` is a [`WindowOptions`](/api/core/interfaces/WindowOptions) bag.

| Option | Type | Purpose |
| --- | --- | --- |
| `headerText` | `string` | Overrides the positional `headerText`. Last-write-wins. |
| `glyph`      | `string \| null` | Registry [`Glyph`](/components/Glyph) name shown to the left of the title text. `null` clears an existing title icon. |

Inherits all [`PanelOptions`](/api/core/interfaces/PanelOptions) / [`ComponentOptions`](/api/core/interfaces/ComponentOptions) fields.

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

## Gotchas

- A `Window` is not added to its parent's layout flow. It floats in absolute coordinates and you control its position via `setPosition` / `setSize`.
- Calling `show()` is what registers it with the active-window tracking. Without `show()`, drag and focus behavior won't activate.
- Use `setResizeFps(0)` to disable throttling during resize if you need every frame.

## See also

- [API: Window](/api/core/classes/Window)
- [Mental model](/guide/mental-model)
- Recipe: [Floating window](/recipes/floating-window)
