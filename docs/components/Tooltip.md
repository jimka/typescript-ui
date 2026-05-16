# Tooltip

[`Tooltip`](/api/core/classes/Tooltip) is a singleton hover hint. Use `Tooltip.attach(component, text)` to wire a 500 ms delay tooltip onto any component, or `Tooltip.show` / `Tooltip.hide` for manual control.

## Attach to a component

```typescript
import { Tooltip } from '@jimka/typescript-ui/core';
import { Button } from '@jimka/typescript-ui/component/button';
const saveButton = Button('Save');
Tooltip.attach(saveButton, 'Save the document (Ctrl+S)');
```

The tooltip appears 500 ms after the pointer enters the component and follows the pointer until it leaves.

## Manual control

```typescript
Tooltip.show('Loading…', 100, 200); // x, y in viewport coordinates
// later…
Tooltip.hide();
```

## Custom colors

Pass [`TooltipColors`](/api/core/interfaces/TooltipColors) to override theme defaults for a single attachment:

```typescript
Tooltip.attach(myButton, 'Danger zone', {
    background: 'rgb(220, 60, 60)',
    color:      'white',
    border:     'rgb(180, 40, 40)',
});
```

## Notes

- Singleton — there is only ever one tooltip on screen.
- Tooltip pixels are not part of the component tree; the tooltip element appends to `document.documentElement` and floats above everything.
- Themed via the `tooltip.*` token group — see [Theming](/concepts/theming#theme-keys).
- Shows and hides with a 100 ms opacity fade via [`Animation`](/api/core/classes/Animation). A fresh `show()` during a fade-out cancels the deferred detach, so rapid hover-then-rehover is seamless. Honours `prefers-reduced-motion: reduce`.

## See also

- [API: Tooltip](/api/core/classes/Tooltip)
- [API: TooltipColors](/api/core/interfaces/TooltipColors)
