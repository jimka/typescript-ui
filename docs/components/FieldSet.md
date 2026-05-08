# FieldSet

[`FieldSet`](/api/classes/FieldSet) is a `<fieldset>` container with an embedded [`Legend`](/components/Legend) title. Use it to group related form fields with a visible border and title.

## Usage

```typescript
import { FieldSet, VBox, TextField, Label } from '@jika/typescript-ui';

const profile = new FieldSet();
profile.setLegendText('Profile');

const body = new VBox();
body.addComponent(new Label('Name:'));
body.addComponent(new TextField());
body.addComponent(new Label('Email:'));
body.addComponent(new TextField());

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
