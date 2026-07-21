# Image

[`Image`](/api/component/display/classes/Image) is an image component backed by an `<img>` element. Reports its preferred size from the image's natural intrinsic dimensions once loaded.

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
| `setPreferredSize(size)` | Pin a display size (inherited from `Component`). |
| `getPreferredSize()` | Reports the pinned size, or the image's natural dimensions once loaded. |

## Notes

- The image URL is fixed at construction (`Image(src)`); there is no `setSrc` / `setAlt`. Construct a new `Image` to display a different source.
- If you don't call `setPreferredSize`, the component reports the image's natural dimensions once loaded. Layout will run again at that point.
- For a CDN-hosted image, ensure CORS headers permit the request. The framework does not enforce a fetch policy beyond the browser default.

## See also

- [API: Image](/api/component/display/classes/Image)
- [`Glyph`](/components/Glyph) — for vector / icon glyphs
