# Tooltip

[`Tooltip`](/api/overlay/classes/Tooltip) is a singleton hover hint. Use `Tooltip.attach(component, text)` to wire a 500 ms delay tooltip onto any component, or `Tooltip.show` / `Tooltip.hide` for manual control.

The tooltip appears offset down-right of the cursor, and flips to sit up-left of it near a viewport edge, so it never covers the pointer it's hinting at.

## Attach to a component

```typescript
import { Tooltip } from '@jimka/typescript-ui/overlay';

import { Button } from '@jimka/typescript-ui/component/button';
const saveButton = Button('Save');
Tooltip.attach(saveButton, 'Save the document (Ctrl+S)');
```

The tooltip appears 500 ms after the pointer enters the component and follows the pointer until it leaves.

Tooltip text may contain `\n` newlines to render across multiple lines — the tooltip sizes its height to the line count and its width to the widest line. (This is how a [`Button`](/components/Button) carrying both a title and a description shows them on separate lines.)

## Manual control

```typescript
Tooltip.show('Loading…', 100, 200); // x, y in viewport coordinates
// later…
Tooltip.hide();
```

## Custom colors

Pass [`TooltipColors`](/api/overlay/interfaces/TooltipColors) to override theme defaults for a single attachment:

```typescript
Tooltip.attach(myButton, 'Danger zone', {
    background: 'rgb(220, 60, 60)',
    color:      'white',
    border:     'rgb(180, 40, 40)',
});
```

## Attach to a raw element

Use [`Tooltip.attachToElement`](/api/overlay/classes/Tooltip#attachToElement) when the target is a raw `HTMLElement` whose child nodes would otherwise capture the hover event — the component-keyed `Tooltip.attach` only matches its host's own element id.

```typescript
Tooltip.attachToElement(myHeaderCell.getElement()!, 'Field description');
```

Calling `attachToElement` against an element that already has a binding replaces it: the previous listeners are removed and a fresh set is installed with the new text. When the swap lands on the currently hovered element the visible tooltip repaints immediately at the last known cursor position. Call [`Tooltip.detachElement`](/api/overlay/classes/Tooltip#detachElement) to remove the binding explicitly.

## Notes

- Singleton — there is only ever one tooltip on screen.
- Tooltip pixels are not part of the component tree; the tooltip element appends to `document.documentElement` and floats above everything.
- Themed via the `tooltip.*` token group — see [Theming](/concepts/theming#theme-keys).
- Shows and hides with a 100 ms opacity fade via [`Animation`](/api/core/namespaces/Animation). A fresh `show()` during a fade-out cancels the deferred detach, so rapid hover-then-rehover is seamless. Honours `prefers-reduced-motion: reduce`.

## See also

- [API: Tooltip](/api/overlay/classes/Tooltip)
- [API: TooltipColors](/api/overlay/interfaces/TooltipColors)
