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
| `addChangeListener(fn)` | Inherited from [`AbstractInput`](/api/component/input/classes/AbstractInput); the callback receives the parsed `Date \| null`. Replaces the prior `addActionListener` shim whose callback received the raw DOM event. |
| `addBindingListener(fn)` | Subscribe to user-driven changes (used by `Binding`). |
| `setEnabled(boolean)` / `setReadOnly(boolean)` | Inherited from [`AbstractInput`](/api/component/input/classes/AbstractInput); both forward to the inner [`PickerInput`](/api/component/input/classes/PickerInput). |
| `setDropdownAnimated(boolean)` | Toggle the fade animation on the dropdown. |

## Construction-time options

| Option | Type | Purpose |
| --- | --- | --- |
| `showSeconds` | `boolean` | When `true`, the field formats and the picker exposes seconds. Default: `false`. |
| `minDate` | `Date \| null` | Earliest date the picker will allow selection of. Years outside the bound are hidden from the year scroller and out-of-range days render dim and ignore clicks. Optional. |
| `maxDate` | `Date \| null` | Latest date the picker will allow selection of. Same semantics as `minDate`. Optional. |

## Navigation

The dropdown header carries three navigation affordances:

- **Month chevrons** `<` and `>` step `±1` month at a time.
- **Header label** ("May 2026") is a button: click it to swap the day grid for an in-place year scroller. The time row stays visible the entire time. Click a year to return; press `Escape` to return without changing the year.
- **Type-ahead** inside the year scroller: typing four digits jumps to that year. The buffer resets after a brief idle pause.

Keyboard inside the day grid: arrow keys move the highlight (`±1` day / `±7` days), `PageUp`/`PageDown` advance by month, `Home`/`End` jump to the first / last in-range day, `Enter` or `Space` commits the highlighted day. Inside the year scroller the same arrow / Page / Home / End semantics walk the year list (`PageUp`/`PageDown` step `±10` years).

## Notes

- The dropdown stacks a month-view calendar over an hour/minute selector. Updates fire incrementally — every day/hour/minute click fires `input` with the latest aggregate value.

## See also

- [API: DateTimeField](/api/component/input/classes/DateTimeField)
- [`DateField`](/components/DateField), [`TimeField`](/components/TimeField)
- [`AnimatedDropdown`](/components/AnimatedDropdown) — shared fade lifecycle
- [Data binding](/data/binding)
