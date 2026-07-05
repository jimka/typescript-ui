// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput, TextInputOptions } from "~/component/input/TextInput.js";
import { callable } from "~/core/Callable.js";

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * `cursor: "text"` matches the caret hover on the field root so the inner
 * `<input>` doesn't switch to the default arrow on its own surface.
 *
 * `border: "none"` and `outline: "none"` suppress the inherited TextInput
 * border + the browser-default focus ring; the outer
 * {@link AbstractPickerField} root carries the visible chrome (and its
 * `:focus-within` rule shows the focus indicator) so the two don't draw
 * over each other.
 */
const _defaultPickerInputOptions: Partial<TextInputOptions> = {
    cursor:  "text",
    border:  "none",
    outline: "none",
};

/**
 * Internal `<input>` subclass shared by every {@link AbstractPickerField}
 * concrete subclass (DateField / TimeField / DateTimeField). Inherits the base
 * `TextInput` on-input sync, which pulls the live DOM value into the cached
 * text on every keystroke so callers can read it through `getText()` instead of
 * touching `element.value` directly.
 *
 * @category Components
 */
class PickerInput extends TextInput<TextInputOptions> {

    constructor() {
        super(undefined, _defaultPickerInputOptions);
    }
}

const PickerInputCallable = callable(PickerInput);
type PickerInputCallable = PickerInput;
export {
    PickerInput         as _PickerInput,
    PickerInputCallable as PickerInput,
};
