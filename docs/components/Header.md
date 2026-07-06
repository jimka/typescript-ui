# Header

[`Header`](/api/component/display/classes/Header) is a title-bar / panel-header component containing left-aligned text. Renders a `<header>` element with a [`Border`](/api/layout/classes/Border) layout and a bold [`Text`](/components/Text) child anchored to the west side.

This is the standalone header component, exported from `@jimka/typescript-ui/component/display`. The table's column-header strip ([`TableHeader`](/api/component/table/classes/TableHeader) in `@jimka/typescript-ui/component/table`) is a distinct class with a distinct name, so the two can be imported together without aliasing.

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { Header } from '@jimka/typescript-ui/component/display';
const panel = Component({
    layoutManager: VBox(),
    components:    [Header('Settings'), content],
});
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getText()` | Returns the internal [`Text`](/components/Text) child. Use `header.getText().setText(...)` to update the title. |

## Theming

Header font size is controlled by the `header.font.size` token — see [Theming](/concepts/theming#theme-keys).

## See also

- [API: Header](/api/component/display/classes/Header)
- [`WindowHeader`](/api/component/container/classes/WindowHeader) — extends `Header` with a close button.
