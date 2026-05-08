# TimeField

[`TimeField`](/api/classes/TimeField) is a time picker backed by an `<input type="time">` element. Returns `null` from `getValue` when the field is empty.

The Date returned uses the local date for its date portion; only hours and minutes are meaningful.

It implements [`Bindable<Date | null>`](/api/interfaces/Bindable).

## Usage

```typescript
import { TimeField, Event } from '@jika/typescript-ui';

const startTime = new TimeField();
const morning = new Date();
morning.setHours(9, 0, 0, 0);
startTime.setValue(morning);

Event.addListener(startTime, 'change', () => {
    const value = startTime.getValue();
    console.log('hour:', value?.getHours(), 'minute:', value?.getMinutes());
});

panel.addComponent(startTime);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` | Returns the entered time as a Date, or `null` when empty. |
| `setValue(date \| null)` | Programmatically set the time. |
| `addBindingListener(fn)` | Subscribe to user-driven changes. |

## Notes

- Only hours and minutes are part of the user-facing input. Seconds default to `0` and the date portion comes from the local clock at the moment of the most recent input event.
- For seconds support, use the table column's `showSeconds` option (see [`ColumnConfig`](/api/interfaces/ColumnConfig)) or wrap a custom editor.

## See also

- [API: TimeField](/api/classes/TimeField)
- [`DateField`](/components/DateField)
- [Data binding](/data/binding)
