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
const logo = Image('/assets/logo.png', { alt: 'Company logo' });
logo.setPreferredSize({ width: 120, height: 40 });

panel.addComponent(logo);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getSrc()` / `setSrc(url)` | Read / write the image source (`src` attribute); swaps the displayed image and re-measures on the next load. |
| `getAlt()` / `setAlt(text)` | Accessible text alternative (`alt` attribute) — pass `""` for a decorative image. |
| `getLoading()` / `setLoading('lazy' \| 'eager')` | Native lazy-loading hint. |
| `getDecoding()` / `setDecoding('sync' \| 'async' \| 'auto')` | Native decode hint. |
| `getFetchPriority()` / `setFetchPriority('high' \| 'low' \| 'auto')` | Native fetch-priority hint. |
| `getCrossOrigin()` / `setCrossOrigin('anonymous' \| 'use-credentials')` | CORS mode for the image request. |
| `getReferrerPolicy()` / `setReferrerPolicy(policy)` | Referrer policy for the image request. |
| `getObjectFit()` / `setObjectFit('fill' \| 'contain' \| 'cover' \| 'none' \| 'scale-down')` | CSS `object-fit` — how the image content fits its box. |
| `getObjectPosition()` / `setObjectPosition(value)` | CSS `object-position` — alignment of the image content within its box. |
| `getPreserveAspectRatio()` / `setPreserveAspectRatio(value)` | Keeps width and height proportional to the natural aspect ratio as the box is resized. |
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

## Object fit and aspect ratio

`objectFit` / `objectPosition` set the standard CSS properties directly — use `objectFit: 'contain'` (or `'cover'`) so a mismatched box letterboxes (or crops) instead of stretching the image.

<!-- demo: image-object-fit -->
> **Live demo** — an `Image` pinned to a box that doesn't match its natural
> aspect ratio; cycle `objectFit` to compare `fill`, `contain`, `cover`,
> `none`, and `scale-down`.
> [Open the Image page](https://jimka.github.io/typescript-ui/components/Image)
<!-- /demo -->

`preserveAspectRatio: true` keeps width and height proportional as the box is resized, overriding the CSS default no-op that `aspect-ratio` alone would have here (this framework always assigns both width and height explicitly, and CSS `aspect-ratio` has no effect once both axes are non-auto).

<!-- demo: image-preserve-aspect-ratio -->
> **Live demo** — an `Image` with `preserveAspectRatio: true` as one pane of
> a resizable `Split`; drag the gutter and its box stays locked to the
> image's aspect ratio instead of stretching.
> [Open the Image page](https://jimka.github.io/typescript-ui/components/Image)
<!-- /demo -->

## Notes

- `setSrc(url)` swaps the displayed image and re-measures on the next load, unless an explicit `preferredSize` is set (which survives a source change). Pass `alt` — an empty string for a purely decorative image — so screen readers get a label instead of the raw URL.
- If you don't call `setPreferredSize`, the component reports the image's natural dimensions once loaded. Layout will run again at that point.
- Before the image has loaded (and with no explicit `preferredSize`), `getPreferredSize()` returns `null` — no placeholder size is reported.
- An `Image` with no explicit `setMinSize` reports `{0, 0}` as its minimum (no automatic floor), so a parent layout can shrink it freely; use `preserveAspectRatio` or an explicit `setMinSize` if a floor is wanted.
- For a CDN-hosted image, ensure CORS headers permit the request. The framework does not enforce a fetch policy beyond the browser default; set `crossOrigin` when the CORS response needs it.

## See also

- [API: Image](/api/component/display/classes/Image)
- [`Glyph`](/components/Glyph) — for vector / icon glyphs
