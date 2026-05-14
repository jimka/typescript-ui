# FontAwesomeIcon

[`FontAwesomeIcon`](/api/classes/FontAwesomeIcon) is a Font Awesome glyph rendered as an `<i>` element. Applies the given icon-type prefix (e.g. `"fas"`) and icon name (e.g. `"times"`) as CSS classes so the Font Awesome library can resolve the correct glyph.

::: warning Font Awesome must be loaded
The Font Awesome script must be included separately in the host page or installed via the `@fortawesome/fontawesome-free` peer dependency. The framework does not bundle it.
:::

## Usage

```typescript
import { Button } from '@jimka/typescript-ui/component/button';
import { FontAwesomeIcon } from '@jimka/typescript-ui/component/display';
const closeIcon = new FontAwesomeIcon('fas', 'times');
closeIcon.setPreferredSize(16, 16);

const closeButton = new Button();
closeButton.addComponent(closeIcon);

panel.addComponent(closeButton);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `setType(prefix)` | Icon-style prefix — `"fas"` (solid), `"far"` (regular), `"fab"` (brands), etc. |
| `setName(name)` | Glyph name — `"times"`, `"check"`, `"folder-open"`, etc. (without the `fa-` prefix). |

## Notes

- Sizing follows the framework conventions — call `setPreferredSize` to reserve space for layout.
- Colour is inherited from the parent's foreground colour by default.

## See also

- [API: FontAwesomeIcon](/api/classes/FontAwesomeIcon)
- [Font Awesome icon catalog](https://fontawesome.com/icons) (external)
