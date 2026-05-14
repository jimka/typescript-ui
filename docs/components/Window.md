# Window

[`Window`](/api/classes/Window) is a floating, draggable, resizable panel with a title bar and a close button. Multiple windows stack with auto-managed `z-index`, and clicks outside the active window deactivate it.

## Usage

```typescript
import { Body, Window } from '@jimka/typescript-ui/core';
import { Text } from '@jimka/typescript-ui/component/input';
const win = new Window();
win.setHeaderText('Settings');
win.setSize(360, 240);
win.setPosition(200, 100);

const message = new Text('Welcome to Settings');
win.addComponent(message);

Body.getInstance().addComponent(win);
win.show();
```

## Common methods

| Method | Purpose |
| --- | --- |
| `setHeaderText(text)` | Title-bar text. |
| `show()` | Display the window and bring it to the front. |
| `setSize(w, h)` / `setPosition(x, y)` | Initial geometry. |
| `setResizeFps(fps)` | Throttle resize-driven layout (default 30). |
| `addExitActionListener(fn)` | Called when the user clicks the × button. |

The full surface — drag listeners, focus / activation events, viewport-clamping — is in the [API reference](/api/classes/Window).

## DOM placement

Windows append themselves to `document.documentElement` (not `<body>`) so they can layer above any backdrop. This is also why theme tokens cascade from `<html>` rather than `<body>` — see [Theming › How it works](/concepts/theming#how-it-works).

## Gotchas

- A `Window` is not added to its parent's layout flow. It floats in absolute coordinates and you control its position via `setPosition` / `setSize`.
- Calling `show()` is what registers it with the active-window tracking. Without `show()`, drag and focus behavior won't activate.
- Use `setResizeFps(0)` to disable throttling during resize if you need every frame.

## See also

- [API: Window](/api/classes/Window)
- [Mental model](/guide/mental-model)
- Recipe: floating window with custom content (forthcoming).
