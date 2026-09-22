# Header

[`Header`](/api/component/display/classes/Header) is a title-bar / panel-header component containing left-aligned text. Renders a `<header>` element with a [`Border`](/api/layout/classes/Border) layout and a bold [`Text`](/components/Text) child anchored to the west side.

This is the standalone header component, exported from `@jimka/typescript-ui/component/display`. The table's column-header strip ([`TableHeader`](/api/component/table/classes/TableHeader) in `@jimka/typescript-ui/component/table`) is a distinct class with a distinct name, so the two can be imported together without aliasing.

<!-- demo: header-basic -->
> **Live demo** — a `Header` bar with a section title.
> [Open the Header page](https://jimka.github.io/typescript-ui/components/Header)
<!-- /demo -->

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

## Notes

- A header whose parent re-commits it at the rectangle it already holds is not re-laid-out (see [the write is diffed](/concepts/layout-system#the-write-is-diffed)), and neither is [`WindowHeader`](/api/component/container/classes/WindowHeader), which inherits the opt-in. `getText().setText(...)`, the font setters, a theme change and `WindowHeader`'s `setGlyph` / `clearGlyph` all still lay it out, and changing insets, padding or a border, swapping a manager, hiding a child with `setDisplayed`, rewriting a child's constraints or re-sorting children — on the header or inside it — marks it owed for the next pass that reaches it. One change does not announce itself: a custom child that changes its intrinsic size without calling `setPreferredSize` or `notifyIntrinsicSizeChanged`, which should be followed by `header.scheduleLayout()`.

## See also

- [API: Header](/api/component/display/classes/Header)
- [`WindowHeader`](/api/component/container/classes/WindowHeader) — extends `Header` with a close button.
