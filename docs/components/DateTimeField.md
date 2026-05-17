# DateTimeField

[`DateTimeField`](/api/component/input/classes/DateTimeField) is a combined date + time picker backed by a focusable text input plus a framework-built [`DateTimePickerDropdown`](/api/component/input/classes/DateTimePickerDropdown) that fades in via the shared [`AnimatedDropdown`](/api/core/classes/AnimatedDropdown) lifecycle.

It implements [`Bindable<Date | null>`](/api/core/interfaces/Bindable).

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { DateTimeField } from '@jimka/typescript-ui/component/input';
const startsAt = DateTimeField();

Event.addListener(startsAt, 'input', () => {
    const value = startsAt.getValue();
    console.log('starts:', value?.toISOString());
});

panel.addComponent(startsAt);
```

## Common methods

| Method | Purpose |
| --- | --- |
| `getValue()` | Returns the entered date+time, or `null` when empty. |
| `setValue(date \| null)` | Programmatically set the value. |
| `addBindingListener(fn)` | Subscribe to user-driven changes. |
| `setDropdownAnimated(boolean)` | Toggle the fade animation on the dropdown. |

## Notes

- The dropdown stacks a month-view calendar over an hour/minute selector. Updates fire incrementally — every day/hour/minute click fires `input` with the latest aggregate value.
- The dropdown is intentionally minimal — extend [`DateTimePickerDropdown`](/api/component/input/classes/DateTimePickerDropdown) for navigation, locale-aware grouping, or seconds support.

## See also

- [API: DateTimeField](/api/component/input/classes/DateTimeField)
- [`DateField`](/components/DateField), [`TimeField`](/components/TimeField)
- [`AnimatedDropdown`](/components/AnimatedDropdown) — shared fade lifecycle
- [Data binding](/data/binding)
