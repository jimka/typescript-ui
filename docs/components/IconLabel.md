# IconLabel

[`IconLabel`](/api/component/display/classes/IconLabel) is a small composite that pairs a [`Glyph`](/api/component/display/classes/Glyph) on the left with a [`Label`](/api/component/input/classes/Label) on the right, laid out horizontally with a configurable gap (default 0).

Use this when the icon belongs to a **form control**: the trailing element is a real `<label for="…">`, so the browser still focuses the associated input when the user clicks the label text. For an icon paired with free-floating text, use [`IconText`](/api/component/display/classes/IconText) instead.

## Usage

```typescript
import { IconLabel } from '@jimka/typescript-ui/component/display';
import { TextField } from '@jimka/typescript-ui/component/input';

const field = new TextField();

panel.addComponent(new IconLabel('times', 'Email:', field.getId()));
panel.addComponent(field);
```

Clicking either the glyph area or the label text focuses the field, because the trailing element is a real `<label for="…">` and the browser handles the focus association.

## Construction

`new IconLabel(glyph, text, forId, options?)` — `glyph`, `text`, and `forId` are required positional arguments. `forId` mirrors [`Label`](/api/component/input/classes/Label)'s constructor contract: it must be non-empty and should match the `id` of the form control this label is associated with.

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `glyph` | `string` | — | Override of the constructor `glyph` argument. |
| `text`  | `string` | — | Override of the constructor `text` argument. |
| `forId` | `string` | — | Override of the constructor `forId` argument. |
| `gap`   | `number` | `0` | Pixels between the glyph and the label. |

Inherits the common [`ComponentOptions`](/api/core/interfaces/ComponentOptions) fields.

## Common methods

| Method | Purpose |
| --- | --- |
| `setGlyph(name)` | Replace the leading glyph with a fresh instance for the given registry name. |
| `setText(text)` | Update the trailing label text. |
| `setForId(id)` | Update the `for` association on the trailing `<label>`. |
| `setGap(px)` | Change the pixel gap between the glyph and the label. |
| `getGlyphComponent()` | Access the inner [`Glyph`](/api/component/display/classes/Glyph). |
| `getLabelComponent()` | Access the inner [`Label`](/api/component/input/classes/Label). |

## See also

- [API: IconLabel](/api/component/display/classes/IconLabel)
- [`Glyph`](/components/Glyph)
- [`IconText`](/api/component/display/classes/IconText) — sibling composite for non-form-control icon-with-text.
