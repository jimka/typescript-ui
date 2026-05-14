# DateField

[`DateField`](/api/component/input/classes/DateField) is a date picker backed by an `<input type="date">` element. Returns `null` from `getValue` when the field is empty.

It implements [`Bindable<Date | null>`](/api/core/interfaces/Bindable), so it can participate in a [`Binding`](/data/binding) directly.

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { DateField } from '@jimka/typescript-ui/component/input';
const dueDate = new DateField();
dueDate.setValue(new Date('2026-12-31'));

Event.addListener(dueDate, 'change', () => {
    const value = dueDate.getValue();
    console.log('due:', value?.toISOString().slice(0, 10));
});

panel.addComponent(dueDate);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` | Returns the selected date, or `null` when empty. |
| `setValue(date \| null)` | Programmatically set the date. |
| `addBindingListener(fn)` | Subscribe to user-driven changes. |

## Notes

- The browser provides the actual picker UI, so appearance and behavior follow OS conventions.
- The Date returned uses local-time semantics — interpret it accordingly when formatting for backend APIs.

## See also

- [API: DateField](/api/component/input/classes/DateField)
- [`TimeField`](/components/TimeField) — time-of-day variant
- [Data binding](/data/binding)
