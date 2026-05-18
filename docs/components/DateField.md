# DateField

[`DateField`](/api/component/input/classes/DateField) is a date picker backed by a focusable text input plus a framework-built [`DatePickerDropdown`](/api/component/input/classes/DatePickerDropdown) that fades in via the shared [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown) lifecycle. Returns `null` from `getValue` when the field is empty.

It implements [`Bindable<Date | null>`](/api/core/interfaces/Bindable), so it can participate in a [`Binding`](/data/binding) directly.

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { DateField } from '@jimka/typescript-ui/component/input';
const dueDate = DateField();
dueDate.setValue(new Date('2026-12-31'));

Event.addListener(dueDate, 'input', () => {
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
| `setDropdownAnimated(boolean)` | Toggle the fade animation on the calendar dropdown. |

## Notes

- The calendar dropdown is intentionally minimal (single month, no navigation) — extend [`DatePickerDropdown`](/api/component/input/classes/DatePickerDropdown) to add navigation, week numbers, or locale-aware behaviour.
- The Date returned uses local-time semantics — interpret it accordingly when formatting for backend APIs.

## See also

- [API: DateField](/api/component/input/classes/DateField)
- [`TimeField`](/components/TimeField) — time-of-day variant
- [`DateTimeField`](/components/DateTimeField) — combined date + time variant
- [`AnimatedDropdown`](/components/AnimatedDropdown) — shared fade lifecycle
- [Data binding](/data/binding)
