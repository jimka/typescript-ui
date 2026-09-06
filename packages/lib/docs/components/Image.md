# Image

[`Image`](/api/component/display/classes/Image) is an image component backed by an `<img>` element. Reports its preferred size from the image's natural intrinsic dimensions once loaded.

<!-- demo: image-basic -->
> **Live demo** — an `Image` rendering a small inline SVG `data:` URI, no
> external asset.
> [Open the Image page](https://jimka.github.io/typescript-ui/components/Image)
<!-- /demo -->

## Usage

```typescript
import { Image } from '@jimka/typescript-ui/component/display';
const logo = Image('/assets/logo.png');
logo.setPreferredSize({ width: 120, height: 40 });

panel.addComponent(logo);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `setPreferredSize(size)` | Pin a preferred display size (inherited from `Component`) — see the note below on its interaction with the auto-derived minimum. |
| `getPreferredSize()` | Reports the pinned size, or the image's natural dimensions once loaded. |
| `on(event, fn)` / `off(event, fn)` | Subscribe to re-emitted image events. |

## Events

`load` and `error` do not bubble, so they cannot route through the framework's
window-level `Event` layer. `Image` wires them natively at render time and
re-emits them through its own `on` / `off` surface: `load`, `error`.

<!-- demo: image-auto-fit -->
> **Live demo** — an `Image` with no `preferredSize`: it reports no size
> until the real `load` event fires, at which point it auto-fits to its
> natural dimensions and an `on('load', ...)` listener reports them.
> [Open the Image page](https://jimka.github.io/typescript-ui/components/Image)
<!-- /demo -->

## Notes

- The image URL is fixed at construction (`Image(src)`); there is no `setSrc` / `setAlt`. Construct a new `Image` to display a different source.
- If you don't call `setPreferredSize`, the component reports the image's natural dimensions once loaded. Layout will run again at that point.
- Before the image has loaded (and with no explicit `preferredSize`), `getPreferredSize()` returns `null` — no placeholder size is reported.
- An explicit `preferredSize` pins the *preferred* size, but not necessarily the rendered one: `getMinSize()` still auto-derives a floor from the natural size once loaded (capped at 100px per axis), independently of `preferredSize`, so a parent layout can still floor the committed size above a smaller pinned value. Call `setMinSize()` explicitly if a smaller pinned size must render exactly as given.
- For a CDN-hosted image, ensure CORS headers permit the request. The framework does not enforce a fetch policy beyond the browser default.

## See also

- [API: Image](/api/component/display/classes/Image)
- [`Glyph`](/components/Glyph) — for vector / icon glyphs
