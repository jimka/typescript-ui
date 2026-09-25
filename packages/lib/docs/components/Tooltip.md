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

The tooltip appears 500 ms after the pointer enters the component and stays where it appeared until the pointer leaves.

Attaching a tooltip, or attaching a different one over it, while the pointer is already resting on the component starts that same delay — so a tooltip whose text changes under a still pointer appears without having to leave the component and re-enter it. (Re-attaching the *same* text and colors changes nothing at all, and leaves a delay already running or a tooltip already on screen alone.) A press is the exception: pressing dismisses the tooltip and keeps a changed attachment *on that same component* from arming while the press's purpose stands. Three things end that — the next keyboard input, the pointer leaving the component, or a press on another attached component (only the most recently pressed one is ever held back). Keyboard input is what lets a validation error appear after the click that focused its field: click in, type, and the message appears, while a control that flips its own hint from the gesture that pressed it stays quiet.

The pointer is watched from an app's first tooltip attachment onwards, and forgotten again whenever it leaves the window, so an attach made before the pointer has moved or hovered since either of those still waits for it to move. What "resting on the component" means is the element the pointer's last move or hover named — so a component that is *moved* out from under a still pointer by the same change that re-attached its tooltip is not noticed until the pointer moves again.

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
- `detach()` acts only on the detaching component's own tooltip: a tooltip showing for another component, or a hover delay another component is still waiting out, is left alone. Since `attach()` begins by detaching, re-attaching one component's tooltip never disturbs another's either.
- Leaving a component hides the tooltip only when it is that component's — on screen for it, or still waiting out the hover delay it armed. A tooltip another component owns is left alone, by the same rule as `detach()`.
- Calling `attach()` again with the same text and colors changes nothing: a hover delay the component armed keeps running, and its tooltip on screen stays up. Colors are compared by value, so an equal object passed afresh matches. A call that changes the text or a color replaces the attachment, which cancels that component's pending show or hides its tooltip.

## See also

- [API: Tooltip](/api/overlay/classes/Tooltip)
- [API: TooltipColors](/api/overlay/interfaces/TooltipColors)
