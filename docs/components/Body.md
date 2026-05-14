# Body

[`Body`](/api/classes/Body) is a singleton [`Component`](/api/classes/Component) that wraps the page's `<body>` element. It bootstraps the framework on first access and listens for viewport resize events to re-run layout from the root.

You don't usually instantiate components directly into `Body`; instead you attach top-level layout containers to it.

## Usage

```typescript
import { Body, Window, ThemeManager, DefaultTheme } from '@jimka/typescript-ui/core';
ThemeManager.setTheme(DefaultTheme);

const body = Body.getInstance();
const win  = new Window();
win.setHeaderText('Hello');
body.addComponent(win);
win.show();
```

## Notes

- **Singleton** — created automatically on first `Body.getInstance()`. Do not `new Body()` yourself.
- **Resize listener** — `Body` listens for `window.resize` and re-runs layout from itself. Adding a top-level component to `Body` is what wires it into the responsive layout pass.
- **Theme bootstrap** — call `ThemeManager.setTheme(DefaultTheme)` (or any theme) before adding components, so style rules pick up the right CSS variables.

## See also

- [API: Body](/api/classes/Body)
- [Mental model](/guide/mental-model) — explains how `Body` fits into the component tree.
- [Theming](/concepts/theming) — what `setTheme` does at startup.
