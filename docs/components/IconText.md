# IconText

[`IconText`](/api/component/display/classes/IconText) is a small composite that pairs a [`Glyph`](/api/component/display/classes/Glyph) on the left with a [`Text`](/api/component/input/classes/Text) label on the right, laid out horizontally with a configurable gap (default 0).

Use this when you need an icon next to free-floating text (a status line, a toolbar caption, a button-like row that isn't a button). For an icon paired with a **form-control label**, use [`IconLabel`](/api/component/display/classes/IconLabel) instead — its trailing text is a real `<label for="…">`.

## Usage

```typescript
import { IconText } from '@jimka/typescript-ui/component/display';

panel.addComponent(IconText('times', 'Close'));
panel.addComponent(IconText('arrow-right', 'Next', { gap: 12 }));
```

## Construction

`IconText(glyph, text, options?)` — both `glyph` and `text` are required positional arguments. The `glyph` name must exist in the [`Glyphs`](/components/Glyph#registry) registry.

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `glyph` | `string` | — | Override of the constructor `glyph` argument. |
| `text`  | `string` | — | Override of the constructor `text` argument. |
| `gap`   | `number` | `2` | Pixels between the glyph and the text. |

Inherits the common [`ComponentOptions`](/api/core/interfaces/ComponentOptions) fields (preferred size, background, foreground, etc.).

## Common methods

| Method | Purpose |
| --- | --- |
| `setGlyph(name)` | Replace the leading glyph with a fresh instance for the given registry name. |
| `setText(text)` | Update the trailing label text. |
| `setGap(px)` | Change the pixel gap between the glyph and the text. |
| `getGlyphComponent()` | Access the inner [`Glyph`](/api/component/display/classes/Glyph). |
| `getTextComponent()` | Access the inner [`Text`](/api/component/input/classes/Text). |

## See also

- [API: IconText](/api/component/display/classes/IconText)
- [`Glyph`](/components/Glyph)
- [`IconLabel`](/api/component/display/classes/IconLabel) — sibling composite for form-control labels.
