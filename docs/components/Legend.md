# Legend

[`Legend`](/api/component/container/classes/Legend) is the title component embedded inside a [`FieldSet`](/components/FieldSet). It uses a `<legend>` element and static CSS positioning so the browser can render the title text inside the fieldset border.

## Usage

You don't construct a `Legend` directly — `FieldSet` creates and manages one internally. Set its text via `fieldSet.setTitle(...)`; the legend is not exposed as a separately addressable component, and its appearance follows the active theme.

```typescript
const fieldSet = FieldSet();
fieldSet.setTitle('Profile');
```

## Common methods

`Legend` extends [`Text`](/components/Text), so it inherits the full font / colour / alignment surface.

## See also

- [API: Legend](/api/component/container/classes/Legend)
- [`FieldSet`](/components/FieldSet) — primary consumer
- [`Text`](/components/Text) — base class
