# AnimatedDropdown

[`AnimatedDropdown`](/api/core/classes/AnimatedDropdown) is a base class for floating panels that fade in on `showAnimated()` and fade out + detach on `hideAnimated()`. It owns the open/close lifecycle, the `opacity + translateY` transition, the dismissing-flag re-entrancy guard, and the `will-change` pre-promotion.

Positioning math (anchor rect, viewport clamping, flip-above-anchor) stays in the host component or in a subclass — `AnimatedDropdown` does not presume anything about where it should appear.

Reaching for `AnimatedDropdown` directly to build a custom popup is usually unnecessary: [`PopupPanel`](/components/PopupPanel) already supplies content measurement, anchored placement, and a height cap on top of this base class, so most "button that opens a custom panel" needs are a `PopupPanel` (or a [`PopupButton`](/components/PopupButton)) away rather than a new subclass.

The following framework components use this base class:

- `AutoCompleteDropdown` (typeahead panel)
- [`ComboBox`](/components/ComboBox)'s internal option-list dropdown
- [`DatePickerDropdown`](/api/component/input/classes/DatePickerDropdown) ([`DateField`](/components/DateField), `DateEditor`)
- [`TimePickerDropdown`](/api/component/input/classes/TimePickerDropdown) ([`TimeField`](/components/TimeField), `TimeEditor`)
- [`DateTimePickerDropdown`](/api/component/input/classes/DateTimePickerDropdown) ([`DateTimeField`](/components/DateTimeField), `DateTimeEditor`)

[`Menu`](/components/Menu) routes its entrance/exit through the [`fadeShow`](/api/core/functions/fadeShow) / [`fadeHideAndDetach`](/api/core/functions/fadeHideAndDetach) free-function form because it already extends `Component`.

## Usage

```typescript
import { AnimatedDropdown } from '@jimka/typescript-ui/core';

class MyDropdown extends AnimatedDropdown {
    constructor() {
        super();
        this.setBackgroundColor('white');
        this.setBorder({ width: 1, color: '#ccc' });
    }
}

const dropdown = new MyDropdown();
dropdown.showAnimated(); // mounts on document.documentElement, fades in
// ...later
dropdown.hideAnimated(); // fades out, removes from DOM on transition end
```

## Common methods

| Method | Purpose |
| --- | --- |
| `showAnimated()` | Mount the panel and play the entrance fade. |
| `hideAnimated()` | Play the exit fade and detach when complete. |
| `isOpen()` | Returns whether the dropdown is open or fading in. |
| `setAnimated(boolean)` | Skip the transition when `false` — show/hide is instant. |
| `setDurationMs(ms)` | Fade duration in milliseconds (default 120). |
| `setTranslatePx(px)` | Vertical offset of the entrance translation (default 4). |

## Pointer-down contract

Hosts that compose this dropdown alongside a focusable element whose `blur` commits state (for example the
[`CellEditorPool`](/api/component/table/classes/CellEditorPool)'s pooled editors) must call `event.preventDefault()` on `pointerdown` inside the dropdown so the host element keeps focus while the dropdown's selection callback runs. The callback then explicitly drives commit. If the dropdown does not suppress the blur, the editor's blur listener fires first, commits the stale value, and the dropdown's later write goes to a no-longer-active editor.

## Theme tokens

| CSS Custom Property              | Default | Purpose                                       |
| -------------------------------- | ------- | --------------------------------------------- |
| `--ts-ui-dropdown-fade-duration` | `120ms` | Fade-in / fade-out duration.                  |
| `--ts-ui-dropdown-fade-translate`| `4px`   | Vertical offset for the entrance translation. |

## See also

- [API: AnimatedDropdown](/api/core/classes/AnimatedDropdown)
- [`Menu`](/components/Menu) — uses the free-function form
- [`AutoCompleteField`](/components/AutoCompleteField) — typeahead built on `AnimatedDropdown`
- [`ComboBox`](/components/ComboBox), [`DateField`](/components/DateField), [`TimeField`](/components/TimeField), [`DateTimeField`](/components/DateTimeField)
- [`PopupPanel`](/components/PopupPanel) — ready-made content-sized popup built on this base class
