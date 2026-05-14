# FieldSet

[`FieldSet`](/api/classes/FieldSet) is a `<fieldset>` container with an embedded [`Legend`](/components/Legend) title. Use it to group related form fields with a visible border and title.

## Usage

```typescript
import { VBox } from '@jimka/typescript-ui/layout';
import { TextField, Label } from '@jimka/typescript-ui/component/input';
import { FieldSet } from '@jimka/typescript-ui/component/container';
const profile = new FieldSet();
profile.setLegendText('Profile');

const nameField  = new TextField();
const emailField = new TextField();

const body = new VBox();
body.addComponent(new Label('Name:',  nameField.getId()));
body.addComponent(nameField);
body.addComponent(new Label('Email:', emailField.getId()));
body.addComponent(emailField);

profile.addComponent(body);
panel.addComponent(profile);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `setLegendText(text)` | Title text shown in the legend. |
| `getLegend()` | Returns the underlying `Legend` component for direct manipulation. |

## See also

- [API: FieldSet](/api/classes/FieldSet)
- [`Legend`](/components/Legend) — the title component used internally.
