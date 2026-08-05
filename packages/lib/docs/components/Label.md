# Label

[`Label`](/api/component/input/classes/Label) is a text label backed by a `<label>` element, **always associated with a form control** via the HTML `for` attribute. Both the text and the target control's ID are required at construction; passing an empty `forId` throws.

For standalone text without a form-control association, use [`Text`](/components/Text) instead.

<!-- demo: label-basic -->
> **Live demo** — a plain `Label` beside one associated with a `Checkbox`
> via `for`.
> [Open the Label page](https://jimka.github.io/typescript-ui/components/Label)
<!-- /demo -->

## Usage

```typescript
import { Label, TextField } from '@jimka/typescript-ui/component/input';
const field = TextField();
const label = Label('Name:', field.getId());

panel.addComponent(label);
panel.addComponent(field);
```

Clicking the label focuses the associated text field.

## Common methods

| Method | Purpose |
| --- | --- |
| `getText()` / `setText(text)` | Label text. |
| `getForId()` / `setForId(id)` | ID of the form control this label is associated with. `setForId` requires a non-empty value. |
| `setFontSize(size)`, `setFontWeight(weight)`, etc. | Inherited from [`Text`](/api/component/input/classes/Text). |

## Notes

- `Label` extends [`Text`](/api/component/input/classes/Text), so all font / colour controls are inherited.
- The constructor and `setForId` both reject empty strings — Labels are guaranteed to render with a real `for` attribute. If a piece of text has no associated form control, use `Text`.
- The label's preferred size auto-recalculates when the active theme changes — see [Theming](/concepts/theming#theme-change-listeners).

## See also

- [API: Label](/api/component/input/classes/Label)
- [API: Text](/api/component/input/classes/Text) — base class, and the right choice for standalone text
