# FieldSet

[`FieldSet`](/api/component/container/classes/FieldSet) is a `<fieldset>` container with an embedded [`Legend`](/components/Legend) title. Use it to group related form fields with a visible border and title.

<!-- demo: fieldset-basic -->
> **Live demo** — a bordered `FieldSet` with a legend title, wrapping two
> `Checkbox`es.
> [Open the FieldSet page](https://jimka.github.io/typescript-ui/components/FieldSet)
<!-- /demo -->

## Usage

```typescript
import { Component } from '@jimka/typescript-ui/core';
import { VBox } from '@jimka/typescript-ui/layout';
import { TextField, Label } from '@jimka/typescript-ui/component/input';
import { FieldSet } from '@jimka/typescript-ui/component/container';
const profile = FieldSet();
profile.setTitle('Profile');

const nameField  = TextField();
const emailField = TextField();

const body = Component({
    layoutManager: VBox(),
    components: [
        Label('Name:',  nameField.getId()),
        nameField,
        Label('Email:', emailField.getId()),
        emailField,
    ],
});

profile.addComponent(body);
panel.addComponent(profile);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `setTitle(text)` | Title text shown in the legend. |
| `getTitle()` | Returns the current legend title text. |

## See also

- [API: FieldSet](/api/component/container/classes/FieldSet)
- [`Legend`](/components/Legend) — the title component used internally.
