# Model

A [`Model`](/api/classes/Model) defines the shape of a record — its field names, types, and defaults. Every store needs a model.

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

Or pass a single [`ModelOptions`](/api/interfaces/ModelOptions) bag if you want to declare the primary key declaratively:

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

Or extend [`AbstractModel`](/api/classes/AbstractModel) to give the schema a named class — useful when you want to attach domain logic or pair it with a typed store:

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
| `'string'` | Default for text fields |
| `'number'` | Numeric value; integer or float |
| `'boolean'` | True / false |
| `'date'` | JavaScript `Date` object |

The supported set lives in [`FieldType`](/api/type-aliases/FieldType).

## Field configuration

Each field accepts these options (see [`FieldOptions`](/api/interfaces/FieldOptions); the legacy alias `FieldConfig` is kept as a deprecated re-export):

| Option | Purpose |
| --- | --- |
| `name` | Field name as exposed by `record.get(name)` |
| `type` | One of the field types above |
| `defaultValue` | Default for new records |
| `mapping` | Maps an incoming JSON key to a different field name |
| `primaryKey` | Marks the field as the record's primary key |

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
- [`Field`](/api/classes/Field) — the per-field runtime representation.
