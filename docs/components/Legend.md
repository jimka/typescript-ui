# Legend

[`Legend`](/api/classes/Legend) is the title component embedded inside a [`FieldSet`](/components/FieldSet). It uses a `<legend>` element and static CSS positioning so the browser can render the title text inside the fieldset border.

## Usage

You usually don't construct a `Legend` directly — `FieldSet` creates and manages one for you. Reach for it via `fieldSet.getLegend()` if you need to customise the title beyond what `setLegendText` exposes.

```typescript
const fieldSet = new FieldSet();
fieldSet.setLegendText('Profile');

const legend = fieldSet.getLegend();
legend.setForegroundColor('rgb(60, 80, 120)');
legend.setFontWeight('bold');
```

## Common methods

`Legend` extends [`Text`](/components/Text), so it inherits the full font / colour / alignment surface.

## See also

- [API: Legend](/api/classes/Legend)
- [`FieldSet`](/components/FieldSet) — primary consumer
- [`Text`](/components/Text) — base class
