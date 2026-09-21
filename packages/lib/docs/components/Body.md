# Body

[`Body`](/api/core/classes/Body) is a singleton [`Component`](/api/core/classes/Component) that wraps the page's `<body>` element. `Body.init` is the awaited startup bootstrap: it applies the theme, starts the web font loading, and resolves once that font is active (or a bounded deadline expires) — so the tree you build afterward is measured against the face it keeps.

You don't usually instantiate components directly into `Body`; instead you attach top-level layout containers to it.

## Usage

```typescript
import { Body, ThemeManager, ClassicTheme } from '@jimka/typescript-ui/core';
import { Window } from '@jimka/typescript-ui/overlay';

ThemeManager.setTheme(ClassicTheme);

const body = await Body.init();
const win  = Window('Hello');

body.addComponent(win);
win.show();
```

## Mounting

`Body.init(options)` is the canonical way to mount a top-level layout — one call that applies a [`BodyOptions`](/api/core/interfaces/BodyOptions) bag to the singleton and returns a promise for it:

```typescript
import { Body } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';

const body = await Body.init({ layoutManager: Fit() });

body.addComponent(appShell);
```

Here `appShell` is your own top-level component — the single child [`Fit`](/layouts/Fit) stretches to fill the viewport. Build and add it only after `init` resolves, so its text is measured against the theme's web font rather than the browser's fallback face.

Only the fields you supply are dispatched, so the body's viewport-size tracking and default theme survive. A later `init` call applies whatever further options you pass and resolves immediately — the font wait only ever runs once.

`Body.getInstance()` is the accessor for everything after the mount: adding a further child, reading the layout manager, attaching a listener. It never waits for the font, so build components only after `init` has resolved; reach for `getInstance()` when you are working with a body that is already there.

## Favicon

`Body.init` also gives the page a browser-tab icon. With no `favicon` field it installs the library's built-in mark — an inline SVG of the framework's [`Border`](/layouts/Border) layout, carrying its own `prefers-color-scheme` rule so it suits light and dark browser chrome:

```typescript
await Body.init({ layoutManager: Fit() });   // built-in mark
```

Point it at your own file, or turn injection off entirely:

```typescript
await Body.init({ favicon: '/brand.svg' });   // your icon
await Body.init({ favicon: false });          // no icon
```

**An icon your page already declares always wins.** If `index.html` contains a `<link rel="icon">`, nothing is injected — not the built-in mark, and not a `favicon` you passed. That covers `rel="shortcut icon"` too, but not `apple-touch-icon` or `mask-icon`, since neither sets the tab icon:

```html
<head>
  <link rel="icon" href="/favicon.svg" />   <!-- wins over anything Body.init would install -->
</head>
```

`favicon: false` means "do not install one"; it does not remove an icon that is already there. To install the icon from an app that mounts without `Body.init`, call [`Favicon.install()`](/api/core/classes/Favicon) directly.

## Context menu

`Body.init` also suppresses the browser's own right-click menu, page-wide:

```typescript
await Body.init({ layoutManager: Fit() });   // native menu suppressed
```

That includes a `TextField`'s native editing menu — right-clicking one no longer offers cut / copy / paste / spellcheck. Pass `nativeContextMenu: true` to restore the browser's menu everywhere instead:

```typescript
await Body.init({ layoutManager: Fit(), nativeContextMenu: true });   // native menu restored
```

A menu the library or your app opens on `contextmenu` — `Tree`, `DiagramView`, a `Split` gutter's chevron, your own `Event.addListener(comp, 'contextmenu', …)` handler — keeps working unchanged either way. To suppress the native menu from an app that mounts without `Body.init`, call `Body.getInstance().setNativeContextMenu(false)` directly.

## Notes

- **Singleton** — constructed on the first `Body.init()` or `Body.getInstance()` call, not when the `Body` module is imported. Both hand back that same instance for the rest of the page's life. Do not `Body()` yourself. `Body.init` resolves once the theme's web font is active or a 50 ms deadline expires, so text built after it is measured against the face the page keeps.
- **Resize listener** — `Body` listens for `window.resize` and re-runs layout from itself. Adding a top-level component to `Body` is what wires it into the responsive layout pass.
- **Theme bootstrap** — call `ThemeManager.setTheme(ClassicTheme)` (or any theme) before adding components, so style rules pick up the right CSS variables. A theme chosen before the body is first reached is kept — `Body` applies `ModernTheme` only when no theme has been set.
- **Context menu** — the browser's native right-click menu is suppressed page-wide by default; pass `nativeContextMenu: true` to restore it, including on text inputs.

## See also

- [API: Body](/api/core/classes/Body)
- [API: Favicon](/api/core/classes/Favicon)
- [Mental model](/guide/mental-model) — explains how `Body` fits into the component tree.
- [Theming](/concepts/theming) — what `setTheme` does at startup.
