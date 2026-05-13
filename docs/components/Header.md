# Header

[`Header`](/api/classes/Header) is a title-bar / panel-header component containing left-aligned text. Renders a `<header>` element with a [`Border`](/api/classes/BorderLayout) layout and a bold [`Text`](/components/Text) child anchored to the west side.

This is the standalone header component. The table's column-header strip — also exported as `Header` from `lib/component/table/` — is re-exported as [`TableHeader`](/api/classes/TableHeader) at the package level.

## Usage

```typescript
import { Header, Border, VBox } from '@jimka/typescript-ui';

const panel = new VBox();
panel.addComponent(new Header('Settings'));
panel.addComponent(content);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getText()` | Returns the internal [`Text`](/components/Text) child. Use `header.getText().setText(...)` to update the title. |

## Theming

Header font size is controlled by the `header.font.size` token — see [Theming](/concepts/theming#theme-keys).

## See also

- [API: Header](/api/classes/Header)
- [`WindowHeader`](/api/classes/WindowHeader) — extends `Header` with a close button.
