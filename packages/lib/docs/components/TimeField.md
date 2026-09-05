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
| `on("change", fn)` | Inherited from [`AbstractInput`](/api/component/input/classes/AbstractInput); the callback receives the parsed `Date \| null`. Replaces the prior `addActionListener` shim whose callback received the raw DOM event. |
| `on("binding", fn)` | Subscribe to user-driven changes (used by `Binding`). |
| `setEnabled(boolean)` / `setReadOnly(boolean)` | Inherited from [`AbstractInput`](/api/component/input/classes/AbstractInput); both forward to the inner [`PickerInput`](/api/component/input/classes/PickerInput). |
| `setDropdownAnimated(boolean)` | Toggle the fade animation on the time dropdown. |

## Relative shorthand

The text input also accepts a relative shorthand instead of an absolute `HH:MM[:SS]` string — one or more signed `<number><unit>` terms, resolved against the moment the text is parsed. Accepted units are `h` (hour), `mi` (minute), and `s` (second); a missing sign means `+`, and each term keeps its own sign.

| Input | Meaning |
| --- | --- |
| `+30mi` | Thirty minutes from now |
| `+1h30mi` | One hour thirty minutes from now |

The typed shorthand stays on screen while typing; it resolves to the absolute time only when the field loses focus or Enter is pressed. Unlike the absolute format, the resolved value carries whatever second the clock reads at that moment rather than defaulting it to `0` — typing `+30mi` twice a second apart can produce values a second apart even though both display the same `HH:MM`.

## Notes

- For the absolute format, an omitted `:SS` segment defaults seconds to `0`; typing one sets it explicitly, independent of the `showSeconds` display option. The date portion comes from the local clock at the moment of the most recent input event.
- The dropdown is intentionally minimal — extend [`TimePickerDropdown`](/api/component/input/classes/TimePickerDropdown) to add 12-hour formatting or seconds.
- Right-clicking the inner text input opens a Cut/Copy/Paste menu; Cut/Paste re-parse the field the same way typing does.

## See also

- [API: TimeField](/api/component/input/classes/TimeField)
- [`DateField`](/components/DateField)
- [`DateTimeField`](/components/DateTimeField) — combined date + time variant
- [`AnimatedDropdown`](/components/AnimatedDropdown) — shared fade lifecycle
- [Data binding](/data/binding)
