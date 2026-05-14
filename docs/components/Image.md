# Image

[`Image`](/api/component/display/classes/Image) is an image component backed by an `<img>` element. Reports its preferred size from the image's natural intrinsic dimensions once loaded.

## Usage

```typescript
import { Image } from '@jimka/typescript-ui/component/display';
const logo = new Image();
logo.setSrc('/assets/logo.png');
logo.setPreferredSize(120, 40);

panel.addComponent(logo);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getSrc()` / `setSrc(url)` | Image URL. |
| `setAlt(text)` | Accessible alt text. |

## Notes

- If you don't call `setPreferredSize`, the component reports the image's natural dimensions once loaded. Layout will run again at that point.
- For a CDN-hosted image, ensure CORS headers permit the request. The framework does not enforce a fetch policy beyond the browser default.

## See also

- [API: Image](/api/component/display/classes/Image)
- [`FontAwesomeIcon`](/components/FontAwesomeIcon) — for vector glyphs
