# TimeField

[`TimeField`](/api/component/input/classes/TimeField) is a time picker backed by a focusable text input plus a framework-built [`TimePickerDropdown`](/api/component/input/classes/TimePickerDropdown) that fades in via the shared [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown) lifecycle. Returns `null` from `getValue` when the field is empty.

The Date returned uses the local date for its date portion; only hours and minutes are meaningful.

It implements [`Bindable<Date | null>`](/api/core/interfaces/Bindable).

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { TimeField } from '@jimka/typescript-ui/component/input';
const startTime = TimeField();
const morning = new Date();
morning.setHours(9, 0, 0, 0);
startTime.setValue(morning);

Event.addListener(startTime, 'input', () => {
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
| `setDropdownAnimated(boolean)` | Toggle the fade animation on the time dropdown. |

## Notes

- Only hours and minutes are part of the user-facing input. Seconds default to `0` and the date portion comes from the local clock at the moment of the most recent input event.
- The dropdown is intentionally minimal — extend [`TimePickerDropdown`](/api/component/input/classes/TimePickerDropdown) to add 12-hour formatting or seconds.

## See also

- [API: TimeField](/api/component/input/classes/TimeField)
- [`DateField`](/components/DateField)
- [`DateTimeField`](/components/DateTimeField) — combined date + time variant
- [`AnimatedDropdown`](/components/AnimatedDropdown) — shared fade lifecycle
- [Data binding](/data/binding)
