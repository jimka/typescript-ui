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
| `addChangeListener(fn)` | Inherited from [`AbstractInput`](/api/component/input/classes/AbstractInput); the callback receives the parsed `Date \| null`. Replaces the prior `addActionListener` shim whose callback received the raw DOM event. |
| `addBindingListener(fn)` | Subscribe to user-driven changes (used by `Binding`). |
| `setEnabled(boolean)` / `setReadOnly(boolean)` | Inherited from [`AbstractInput`](/api/component/input/classes/AbstractInput); both forward to the inner [`PickerInput`](/api/component/input/classes/PickerInput). |
| `setDropdownAnimated(boolean)` | Toggle the fade animation on the calendar dropdown. |

## Construction-time options

| Option | Type | Purpose |
| --- | --- | --- |
| `minDate` | `Date \| null` | Earliest date the picker will allow selection of. Years outside the bound are hidden from the year scroller and out-of-range days render dim and ignore clicks. Optional. |
| `maxDate` | `Date \| null` | Latest date the picker will allow selection of. Same semantics as `minDate`. Optional. |

## Navigation

The dropdown header carries three navigation affordances:

- **Month chevrons** `<` and `>` step `±1` month at a time.
- **Header label** ("May 2026") is a button: click it to swap the day grid for an in-place year-scroller. Click a year cell to return to the day grid for that year; press `Escape` to return without changing the year.
- **Type-ahead** inside the year scroller: typing four digits (e.g. `1985`) jumps to that year. The buffer resets after a brief idle pause.

Keyboard inside the day grid: arrow keys move the highlight (`±1` day / `±7` days), `PageUp`/`PageDown` advance by month, `Home`/`End` jump to the first / last in-range day, `Enter` or `Space` commits the highlighted day. Inside the year scroller the same arrow / Page / Home / End semantics walk the year list (`PageUp`/`PageDown` step `±10` years).

## Notes

- The Date returned uses local-time semantics — interpret it accordingly when formatting for backend APIs.
- Cell editors in tables (`Date` / `DateTime` editor) pick up navigation automatically because they spawn the same dropdown.

## Theming

The field's thin gray border (and its calendar dropdown's matching border) is driven by the `input.border` token — see [Theming › Theme keys](/concepts/theming#theme-keys).

## See also

- [API: DateField](/api/component/input/classes/DateField)
- [`TimeField`](/components/TimeField) — time-of-day variant
- [`DateTimeField`](/components/DateTimeField) — combined date + time variant
- [`AnimatedDropdown`](/components/AnimatedDropdown) — shared fade lifecycle
- [Data binding](/data/binding)
