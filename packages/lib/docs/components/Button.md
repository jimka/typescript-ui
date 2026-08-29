# Button

[`Button`](/api/component/button/classes/Button) is a push button with a text label and configurable pressed- and hover-state appearance. Maintains separate CSS rules for the normal, `:hover:not(.pressed)`, and `.pressed` states so border, shadow, background, and foreground colour are independently controllable when the pointer is over the button and when it is pressed. The pressed state is driven by a JS-managed `.pressed` class rather than the native `:active` pseudo-class, so it is scoped to a primary-button press or a held Space key — a right- or middle-click never shows it.

<!-- demo: button-basic -->
> **Live demo** — two `Button`s side by side, interactive in the documentation app.
> [Open the Button page](https://jimka.github.io/typescript-ui/components/Button)
<!-- /demo -->

## Usage

```typescript
import { Event } from '@jimka/typescript-ui/core';
import { Button } from '@jimka/typescript-ui/component/button';
const saveButton = Button('Save');
Event.addListener(saveButton, 'click', () => save());

panel.addComponent(saveButton);
```

## Description / subtitle

Pass a `description` to render a second line below the title, in a smaller, dimmer subtitle style:

```typescript
Button({ text: 'Save document', description: 'Persist your changes to disk' });
```

The subtitle stacks below the title inside the content row. Add or update it at runtime with `setDescription(text)`, read the subtitle [`Text`](/api/component/input/classes/Text) child with `getDescription()` (or `null` when none is set), and remove it with `clearDescription()`. Each re-syncs the button's auto-sized preferred size.

### Alignment relative to the glyph

When the button has both a leading `glyph` and a description, `descriptionUnderGlyph` controls where the description aligns:

- **`true` (default)** — the description spans the full content-row width *below* the glyph+title row, its left edge under the glyph.
- **`false`** — the description indents under the title text, beside the glyph.

```typescript
// Description full-width under the glyph (default):
Button({ text: 'Save document', description: 'Persist your changes to disk', glyph: 'floppy-disk' });

// Description indented under the title, beside the glyph:
Button({ text: 'Cancel', description: 'Discard your changes', glyph: 'xmark', descriptionUnderGlyph: false });
```

Flip it at runtime with `setDescriptionUnderGlyph(value)` / read it with `isDescriptionUnderGlyph()`. The option has no visible effect without both a glyph and a visible description.

### Showing the description in the tooltip only

`showDescription: false` hides the description on the button face — the button shows only its glyph and title — while still surfacing it in the hover tooltip:

```typescript
Button({ text: 'Delete', description: 'This action cannot be undone', showDescription: false });
```

The button renders compact (glyph + title), but hovering shows `Delete` / `This action cannot be undone`. Toggle at runtime with `setShowDescription(value)` / `isShowDescription()`. When `false`, the `descriptionUnderGlyph` alignment has no visible effect.

### Showing the title in the tooltip only

`showText: false` hides the title on the button face — the button shows only its glyph — while still driving the hover tooltip *and* the accessible name. It is the title-side twin of `showDescription`, ideal for an icon-only toolbar button that still needs a label for hover and screen readers:

```typescript
Button({ glyph: 'play', text: 'Run', showText: false });
```

The button renders glyph-only, but hovering shows `Run` and assistive tech reads `Run` from the reflected `aria-label`. Toggle at runtime with `setShowText(value)` / `isShowText()`. Pair it with `description` + `showDescription: false` for a second tooltip line — e.g. a keyboard-shortcut hint — without putting any text on the face:

```typescript
Button({ glyph: 'play', text: 'Run', description: 'Ctrl+Enter', showText: false, showDescription: false });
```

### Tooltip

Setting a title and/or description also auto-attaches a hover [`Tooltip`](/components/Tooltip): the title alone when there is no description, or the title and description on separate lines when both are present. The tooltip stays in sync as `setText` / `setDescription` / `clearDescription` change the text — and reflects the title even when `showText` is `false` and the description even when `showDescription` is `false`. When the title is hidden (`showText: false`) it is also reflected into the button's `aria-label`, so a glyph-only button keeps an accessible name; the label is removed again when the title becomes visible.

The subtitle's size, colour, and weight come from the `button.description.*` theme tokens — see [Theming](#theming). A leading glyph is auto-sized so its box height matches the title's line height; override it by sizing the glyph explicitly via `getGlyph().setPreferredSize(...)`.

<!-- demo: button-glyph-description -->
> **Live demo** — three buttons: glyph plus title, glyph plus title plus
> description, and a `showText: false` icon-only button whose title survives
> in the hover tooltip.
> [Open the Button page](https://jimka.github.io/typescript-ui/components/Button)
<!-- /demo -->

## Theming

Buttons are themed via the `button.*` token group — see [Theming › Theme keys](/concepts/theming#theme-keys). Pressed state is controlled by `button.pressed.*` tokens; hover state by `button.hover.*` tokens; the optional subtitle by `button.description.*` tokens (`fontSize`, `foreground`, `weight`).

For one-off styling, every pressed-state property has a per-instance setter:

```typescript
button.setPressedBackgroundColor('rgb(60, 120, 200)');
button.setPressedForegroundColor('white');
button.setPressedBorderRadius('8px');
```

## Hover state

The hover treatment uses a `:hover:not(.pressed)` rule so the pressed treatment always wins on click, regardless of stylesheet insertion order. Disabled buttons (`button.setEnabled(false)`) receive no hover treatment because the browser suppresses `:hover` on `<button disabled>`.

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

`chromeless: true` suppresses the framework's visual-chrome defaults — border, border radius, shadow, gradient background, and the twelve pressed/hover treatments — and also neutralises the UA `<button>` background and ridge border, without disabling the rest of `Button`'s contract (cursor, colour, insets, content row, named listeners). Use it for buttons that want only a flat label-shaped surface with no framework chrome.

```typescript
Button('Save', { chromeless: true });
```

Runtime toggle via `setChromeless(value)`; read with `isChromeless()`. Toggling back to chromeful restores chrome from `_defaultOptions`, so subclass chrome layered in at construction round-trips losslessly — only consumer-supplied chrome (passed through the caller's `options` bag) is not recovered.

## Flat appearance

`flat: true` gives the classical Office/Windows toolbar look: no resting border, shadow, or gradient, but a light frame plus subtle fill on `:hover:not(.pressed)` and a sunken inset frame on `.pressed`. Unlike `chromeless` — which strips the hover and pressed treatments entirely — `flat` keeps the interaction framing; it only suppresses the resting chrome. The hover and pressed colours come from the `--ts-ui-button-flat-*` theme tokens (see [Theming](/concepts/theming)), so the appearance tracks the active theme.

```typescript
Button({ glyph: 'check', flat: true });
```

A glyph-only flat button (a glyph with an empty label) tightens to a compact square so it reads as a toolbar icon button. Buttons with text keep their default insets.

Runtime toggle via `setFlat(value)`; read with `isFlat()`. Toggling back restores the raised chrome from `_defaultOptions` (the same loss tradeoff as `setChromeless(false)` — only defaults round-trip, not consumer-supplied chrome). `flat` and `chromeless` are mutually exclusive and `chromeless` wins: `setFlat(true)` is ignored with a dev-time warning while the button is chromeless. A flat [`ToggleButton`](/components/ToggleButton) renders its selected state with the same sunken treatment, so a toggled-on toolbar button reads as depressed.

## Compact rendering

`compact: true` tightens the button's inset perimeter so it reads denser — text buttons go from the default `(5, 10, 5, 10)` to `(2, 6, 2, 6)`, and glyph-only buttons collapse to a `(2, 2, 2, 2)` square. Defaults to `false`.

```typescript
Button({ text: 'Save', compact: true });
```

Compact is orthogonal to `flat` — a button can be compact, flat, both, or neither — and compact insets win when both apply (a compact flat icon is the tight `(2, 2, 2, 2)` square rather than the non-compact flat `(4, 4, 4, 4)`). Runtime toggle via `setCompact(value)`; read with `isCompact()`. A [`ToolBar`](/components/ToolBar) defaults to `compact: true` and drives it onto its button children, so buttons packed into a toolbar render compact without setting the flag yourself.

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

Register click (action) handlers via `on("action", fn)` and pointer-down handlers via `addPointerDownListener(fn)`. Both are framework-routed through `Event.addListener`, so the named-listener guarantee from [ARCHITECTURE.md](https://github.com/jimka/typescript-ui/blob/master/ARCHITECTURE.md) applies — never reach for `Event.addListener(button, …)` from external code; every event a consumer wants to listen to is the button's responsibility to expose via a named method. The listener argument should be a named method on the host component (or a module-level function) rather than an inline arrow, so it's removable, identifiable in stack traces, and grep-able.

```typescript
class Editor {
    constructor() {
        const save = new Button('Save');
        save.on("action", this.handleSave);
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
- For a flat menubar-style button reuse `chromeless: true` directly, or extend `Button` for a named class with its own declared chrome — `MenuBarButton` is the in-tree example.

## See also

- [API: Button](/api/component/button/classes/Button)
- [`ToggleButton`](/components/ToggleButton)
- [`SpinButton`](/components/SpinButton)
- [`TabCloseButton`](/components/TabCloseButton)
