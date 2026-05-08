# Label

[`Label`](/api/classes/Label) is a text label backed by a `<label>` element. Supports the HTML `for` attribute to associate the label with a form control by ID.

## Usage

```typescript
import { Label, TextField } from '@jika/typescript-ui';

const field = new TextField();
const label = new Label('Name:', field.getId());

panel.addComponent(label);
panel.addComponent(field);
```

Clicking the label focuses the associated text field.

## Common methods

| Method | Purpose |
| --- | --- |
| `getText()` / `setText(text)` | Label text. |
| `getForId()` / `setForId(id)` | Component ID this label is associated with. |
| `setFontSize(size)`, `setFontWeight(weight)`, etc. | Inherited from [`Text`](/api/classes/Text). |

## Notes

- A `Label` extends [`Text`](/api/classes/Text), so all font / colour controls are inherited.
- For a label without form association, omit the second constructor argument.
- The label's preferred size auto-recalculates when the active theme changes — see [Theming](/concepts/theming#theme-change-listeners).

## See also

- [API: Label](/api/classes/Label)
- [API: Text](/api/classes/Text) — base class
