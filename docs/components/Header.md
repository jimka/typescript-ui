# Header

[`Header`](/api/classes/Header) is a title-bar / panel-header component containing a left-aligned text label. Renders a `<header>` element with a [`Border`](/api/classes/BorderLayout) layout and a bold label anchored to the west side.

This is the standalone header component. The table's column-header strip — also exported as `Header` from `Base/component/table/` — is re-exported as [`TableHeader`](/api/classes/TableHeader) at the package level.

## Usage

```typescript
import { Header, Border, VBox } from '@jika/typescript-ui';

const panel = new VBox();
panel.addComponent(new Header('Settings'));
panel.addComponent(content);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `setHeaderText(text)` | Title text. |
| `setLabelComponent(component)` | Replace the default label with a custom component (e.g. an icon + text). |

## Theming

Header font size is controlled by the `header.font.size` token — see [Theming](/concepts/theming#theme-keys).

## See also

- [API: Header](/api/classes/Header)
- [`WindowHeader`](/api/classes/WindowHeader) — extends `Header` with a close button.
