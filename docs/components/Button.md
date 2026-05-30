# Button

[`Button`](/api/component/button/classes/Button) is a push button with a text label and configurable pressed- and hover-state appearance. Maintains separate CSS rules for the normal, `:hover:not(:active)`, and `:active` states so border, shadow, background, and foreground colour are independently controllable when the pointer is over the button and when it is pressed.

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { Button } from '@jimka/typescript-ui/component/button';
const saveButton = Button('Save');
Event.addListener(saveButton, 'click', () => save());

panel.addComponent(saveButton);
```

## Theming

Buttons are themed via the `button.*` token group — see [Theming › Theme keys](/concepts/theming#theme-keys). Pressed state is controlled by `button.pressed.*` tokens; hover state by `button.hover.*` tokens.

For one-off styling, every pressed-state property has a per-instance setter:

```typescript
button.setPressedBackgroundColor('rgb(60, 120, 200)');
button.setPressedForegroundColor('white');
button.setPressedBorderRadius('8px');
```

## Hover state

The hover treatment uses a `:hover:not(:active)` rule so the pressed treatment always wins on click, regardless of stylesheet insertion order. Disabled buttons (`button.setEnabled(false)`) receive no hover treatment because the browser suppresses `:hover` on `<button disabled>`.

Every hover-state property has a matching per-instance setter:

```typescript
button.setHoverBackgroundColor('rgb(245, 245, 255)');
button.setHoverShadow('0 4px 10px rgba(0, 0, 0, 0.3)');
```

Construction-time hover overrides go through the options bag:

```typescript
Button('Save', {
    hoverBackgroundColor: 'rgb(245, 245, 255)',
    hoverShadow         : '0 4px 10px rgba(0, 0, 0, 0.3)',
});
```

The full setter / getter list is in the [API reference](/api/component/button/classes/Button).

## Chromeless mode

`chromeless: true` suppresses the framework's visual-chrome defaults — border, border radius, shadow, gradient background, and the twelve pressed/hover treatments — and also neutralises the UA `<button>` background and ridge border, without disabling the rest of `Button`'s contract (cursor, colour, insets, content row, named listeners). Use it for buttons that want a flat label-shaped surface, like the trailing buttons in a [`WindowHeader`](/components/WindowHeader) or every entry in a [`MenuBar`](/components/MenuBar).

```typescript
Button('Save', { chromeless: true });
```

Runtime toggle via `setChromeless(value)`; read with `isChromeless()`. Toggling back to chromeful restores chrome from `_defaultOptions`, so subclass chrome layered in at construction round-trips losslessly — only consumer-supplied chrome (passed through the caller's `options` bag) is not recovered.

## Content anchor

By default the content row (`glyph` + `text`) is centred within the button. Pass `anchor` (and optionally `fill`) to override:

```typescript
Button('Save', { anchor: AnchorType.WEST });
```

This only renders differently when the button has been stretched past its auto-sized preferred width — for a button at its natural size the content fills the inner rect exactly, so anchor and fill have no visible effect.

## Auto-sizing

Every `Button` derives its preferred size from the content row (`glyph` + `text`) plus the perimeter insets. Construction, `setGlyph` / `clearGlyph` / `setInsets`, and theme changes all re-fire the auto-compute, so a button declared without an explicit `preferredSize` reports a natural content-fit size to its parent layout. Consumer-supplied `preferredSize` (positional or via the options bag) wins permanently for the lifetime of the instance — once set, future auto-fires no-op.

Subclasses customise the size by overriding the protected `computePreferredSize(): { width, height }` method. The canonical pattern is to take Button's derived width and replace the height (or vice versa) — for example, `MenuBarButton` pins the height to its 28-px row token while inheriting the content-derived width.

## Event handlers

Register click handlers via `on("click", fn)` and pointer-down handlers via `addPointerDownListener(fn)`. Both are framework-routed through `Event.addListener`, so the named-listener guarantee from [ARCHITECTURE.md](/concepts/architecture) applies — never reach for `Event.addListener(button, …)` from external code; every event a consumer wants to listen to is the button's responsibility to expose via a named method. The listener argument should be a named method on the host component (or a module-level function) rather than an inline arrow, so it's removable, identifiable in stack traces, and grep-able.

```typescript
class Editor {
    constructor() {
        const save = new Button('Save');
        save.on("click", this.handleSave);
        save.addPointerDownListener(this.handleSavePointerDown);
    }

    private handleSave            = ()                 => this.save();
    private handleSavePointerDown = (e: PointerEvent)  => this.suppressFocusLoss(e);
}
```

## Notes

- The label is a child [`Label`](/api/component/input/classes/Label); it inherits the button's foreground colour and theme font size.
- `setText(text)` updates the label.
- For toggle behavior (selected / unselected) use [`ToggleButton`](/components/ToggleButton).
- For radio-group behavior use [`RadioButton`](/components/RadioButton) plus [`ButtonGroup`](/components/ButtonGroup).
- For a flat menubar-style button reuse `chromeless: true` directly, or extend `Button` for a named class — `MenuBarButton` is the in-tree example.

## See also

- [API: Button](/api/component/button/classes/Button)
- [`ToggleButton`](/components/ToggleButton)
- [`SpinButton`](/components/SpinButton)
- [`TabCloseButton`](/components/TabCloseButton)
