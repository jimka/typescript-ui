# Body

[`Body`](/api/core/classes/Body) is a singleton [`Component`](/api/core/classes/Component) that wraps the page's `<body>` element. It bootstraps the framework on first access and listens for viewport resize events to re-run layout from the root.

You don't usually instantiate components directly into `Body`; instead you attach top-level layout containers to it.

## Usage

```typescript
import { Body, ThemeManager, ClassicTheme } from '@jimka/typescript-ui/core';
import { Window } from '@jimka/typescript-ui/overlay';

ThemeManager.setTheme(ClassicTheme);

const win = Window('Hello');

Body.init({ components: [win] });
win.show();
```

## Mounting

`Body.init(options)` is the canonical way to mount a top-level layout — one call that applies a [`ComponentOptions`](/api/core/interfaces/ComponentOptions) bag to the singleton and returns it:

```typescript
Body.init({ layoutManager: Fit(), components: [appShell] });
```

Only the fields you supply are dispatched, so the body's viewport-size tracking and default theme survive. `components` **appends** — calling `init` twice adds both sets of children rather than replacing the first.

`Body.getInstance()` is the accessor for everything after the mount: adding a further child, reading the layout manager, attaching a listener. Reach for `init` when you are putting the page's top-level content on screen, and `getInstance()` when you are working with a body that is already there.

## Notes

- **Singleton** — constructed when the `Body` module is first imported, not on first call. `Body.init()` and `Body.getInstance()` both hand back that same existing instance. Do not `Body()` yourself.
- **Resize listener** — `Body` listens for `window.resize` and re-runs layout from itself. Adding a top-level component to `Body` is what wires it into the responsive layout pass.
- **Theme bootstrap** — call `ThemeManager.setTheme(ClassicTheme)` (or any theme) before adding components, so style rules pick up the right CSS variables.

## See also

- [API: Body](/api/core/classes/Body)
- [Mental model](/guide/mental-model) — explains how `Body` fits into the component tree.
- [Theming](/concepts/theming) — what `setTheme` does at startup.
