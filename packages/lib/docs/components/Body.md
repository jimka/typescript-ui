# Body

[`Body`](/api/core/classes/Body) is a singleton [`Component`](/api/core/classes/Component) that wraps the page's `<body>` element. It bootstraps the framework when the module is first imported and listens for viewport resize events to re-run layout from the root.

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

`Body.init(options)` is the canonical way to mount a top-level layout — one call that applies a [`BodyOptions`](/api/core/interfaces/BodyOptions) bag to the singleton and returns it:

```typescript
import { Body } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';

Body.init({ layoutManager: Fit(), components: [appShell] });
```

Here `appShell` is your own top-level component — the single child [`Fit`](/layouts/Fit) stretches to fill the viewport.

Only the fields you supply are dispatched, so the body's viewport-size tracking and default theme survive. `components` **appends** — calling `init` twice adds both sets of children rather than replacing the first.

`Body.getInstance()` is the accessor for everything after the mount: adding a further child, reading the layout manager, attaching a listener. Reach for `init` when you are putting the page's top-level content on screen, and `getInstance()` when you are working with a body that is already there.

## Favicon

`Body.init` also gives the page a browser-tab icon. With no `favicon` field it installs the library's built-in mark — an inline SVG of the framework's [`Border`](/layouts/Border) layout, carrying its own `prefers-color-scheme` rule so it suits light and dark browser chrome:

```typescript
Body.init({ layoutManager: Fit(), components: [appShell] });   // built-in mark
```

Point it at your own file, or turn injection off entirely:

```typescript
Body.init({ favicon: '/brand.svg' });   // your icon
Body.init({ favicon: false });          // no icon
```

**An icon your page already declares always wins.** If `index.html` contains a `<link rel="icon">`, nothing is injected — not the built-in mark, and not a `favicon` you passed. That covers `rel="shortcut icon"` too, but not `apple-touch-icon` or `mask-icon`, since neither sets the tab icon:

```html
<head>
  <link rel="icon" href="/favicon.svg" />   <!-- wins over anything Body.init would install -->
</head>
```

`favicon: false` means "do not install one"; it does not remove an icon that is already there. To install the icon from an app that mounts without `Body.init`, call [`Favicon.install()`](/api/core/classes/Favicon) directly.

## Notes

- **Singleton** — constructed when the `Body` module is first imported, not on first call. `Body.init()` and `Body.getInstance()` both hand back that same existing instance. Do not `Body()` yourself.
- **Resize listener** — `Body` listens for `window.resize` and re-runs layout from itself. Adding a top-level component to `Body` is what wires it into the responsive layout pass.
- **Theme bootstrap** — call `ThemeManager.setTheme(ClassicTheme)` (or any theme) before adding components, so style rules pick up the right CSS variables.

## See also

- [API: Body](/api/core/classes/Body)
- [API: Favicon](/api/core/classes/Favicon)
- [Mental model](/guide/mental-model) — explains how `Body` fits into the component tree.
- [Theming](/concepts/theming) — what `setTheme` does at startup.
