# Model

A [`Model`](/api/data/classes/Model) defines the shape of a record — its field names, types, and defaults. Every store needs a model.

## Define a model

Pass an array of field options to `Model`:

```typescript
import { Model } from '@jimka/typescript-ui/data';
const PersonModel = new Model([
    { name: 'id',   type: 'number' },
    { name: 'name', type: 'string' },
    { name: 'age',  type: 'number', defaultValue: 0 },
]);
```

Or pass a single [`ModelOptions`](/api/data/interfaces/ModelOptions) bag if you want to declare the primary key declaratively:

```typescript
const PersonModel = new Model({
    fields: [
        { name: 'id',   type: 'number' },
        { name: 'name', type: 'string' },
        { name: 'age',  type: 'number', defaultValue: 0 },
    ],
    primaryKey: 'id',
});
```

Or extend [`AbstractModel`](/api/data/classes/AbstractModel) to give the schema a named class — useful when you want to attach domain logic or pair it with a typed store:

```typescript
import { AbstractModel } from '@jimka/typescript-ui/data';
class PersonModel extends AbstractModel {
    readonly fields = [
        { name: 'id',   type: 'number' },
        { name: 'name', type: 'string' },
        { name: 'age',  type: 'number', defaultValue: 0 },
    ];
}

const personModel = new PersonModel();
```

Both forms are accepted everywhere a `Model` is expected.

## Field types

| Type | Notes |
| --- | --- |
| `'string'` | Text value |
| `'number'` | Numeric value; integer or float |
| `'boolean'` | True / false |
| `'date'` | JavaScript `Date` object (date only) |
| `'time'` | Time-of-day value |
| `'datetime'` | Combined date and time |
| `'glyph'` | Registry glyph name |
| `'auto'` | No coercion; stores the raw value (the default) |

The supported set lives in [`FieldType`](/api/data/type-aliases/FieldType).

## Value coercion

A field's `type` is not just metadata — raw values are coerced to it the moment they enter a record, both when a store loads data (`createRecord`) and when you call `record.set(name, value)`. A JSON `"10"` becomes the number `10`, a date string becomes a `Date`, and `"true"` becomes `true`. Because the stored value is already correctly typed, sort and filter compare it directly: numbers compare numerically, dates as `Date` objects.

`null` and `undefined` always pass through unchanged. An empty number value (`''`) and an unparseable date are stored as `undefined` rather than `NaN` or an Invalid Date; an unparseable non-empty `number` value is stored as `NaN`, which the [record's](/data/record#validation) implicit type check flags as invalid. `'auto'` and `'glyph'` fields are never coerced.

Provide a `convert` hook to override the built-in coercion for one field — it wins over the `type` switch and receives the full source record, so it can derive a field from sibling values:

```typescript
{
    name: 'fullName',
    convert: (_raw, src) => `${src?.firstName} ${src?.lastName}`,
}
```

## Validation

Attach `validators` — an array of [`ValidationRule`](/api/validation/type-aliases/ValidationRule) — to a field to declare its constraints. Rules are evaluated on demand by the [record](/data/record), not on every keystroke:

```typescript
import type { ValidationRule } from '@jimka/typescript-ui/validation';

{
    name: 'age',
    type: 'number',
    validators: [{ type: 'required' }, { type: 'min', min: 0 }],
}
```

A field's declared `type` also acts as an implicit type check: a non-null value that fails coercion (a `number` field holding `NaN`, a `date` field holding an Invalid Date) reports an error before the explicit `validators` run. See [Record](/data/record#validation) for how to read the results.

## Field configuration

Each field accepts these options (see [`FieldOptions`](/api/data/interfaces/FieldOptions); the legacy alias `FieldConfig` is kept as a deprecated re-export):

| Option | Purpose |
| --- | --- |
| `name` | Field name as exposed by `record.get(name)` |
| `type` | One of the field types above |
| `defaultValue` | Default for new records |
| `mapping` | Maps an incoming JSON key to a different field name |
| `convert` | Custom raw-to-typed coercion; wins over the built-in `type` conversion |
| `validators` | Field-level validation rules, evaluated by the record (see below) |

## Field mapping

Use `mapping` when the incoming JSON key differs from the field name:

```typescript
{ name: 'firstName', type: 'string', mapping: 'first_name' }
// incoming { first_name: 'Alice' } → record.get('firstName') === 'Alice'
```

This lets a UI use `camelCase` field names while the API uses `snake_case`.

## See also

- [Store](/data/store) — pass your model to a store.
- [Record](/data/record) — read and mutate field values via `get` / `set`.
- [`Field`](/api/data/classes/Field) — the per-field runtime representation.
