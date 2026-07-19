# Form

[`Form`](/api/core/classes/Form) is a [`Panel`](/api/core/classes/Panel) that bakes the semantic `<form>` tag and wires the native `submit` event to a single `onSubmit` callback. It inherits `Panel`'s 4-pixel insets and `autoScroll` stack, so a tall form in a short area scrolls rather than inflating to content size.

Submission is triggered the normal way — a `<button type="submit">` inside the form, or Enter in a text field — or from outside the form via [`requestSubmit()`](/api/core/classes/Form#requestsubmit), which reaches the browser's native `HTMLFormElement.requestSubmit()`. That runs the browser's constraint validation and fires the cancelable `submit` event (unlike `.submit()`, which skips both), so an external footer button can drive the same validated submission path as a native submit button.

## Usage

```typescript
import { Form } from '@jimka/typescript-ui/core';
import { TextField } from '@jimka/typescript-ui/component/input';
import { Button } from '@jimka/typescript-ui/component/button';
import { VBox } from '@jimka/typescript-ui/layout';

const nameField = TextField();

const form = new Form({
    layoutManager: new VBox(),
    components:    [nameField],
    onSubmit:      (f) => console.log('submitted'),
});

// A button outside the form triggers the same validated submission path
// as a native submit button.
const submitButton = new Button('Submit');
submitButton.on('action', () => form.requestSubmit());
```

The framework has already called `preventDefault()` on the `submit` event by the time `onSubmit` runs, so the page never navigates — the handler owns what submission means (e.g. sending the field values to a store).

## Notes

- `onSubmit` is wired once at construction via the framework's `Event` API, matching a real DOM `submit` event; there is no `setOnSubmit` for runtime rewiring.
- `requestSubmit()` is a no-op before the form has been rendered.
- Because `Form` is a `Panel`, every `Panel` option (`autoScroll`, `insets`, `layoutManager`, `components`, …) applies.

## See also

- [API: Form](/api/core/classes/Form)
- [`Panel`](/api/core/classes/Panel) — the base class.
