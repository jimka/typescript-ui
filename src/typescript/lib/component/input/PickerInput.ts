// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput, TextInputOptions } from "~/component/input/TextInput.js";
import { Event } from "~/core/Event.js";
import { DOM } from "~/core/DOM.js";
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
 * concrete subclass (DateField / TimeField / DateTimeField). Mirrors
 * `TextField`'s on-input sync hook — pulls the live DOM value into the
 * inherited cached text on every keystroke so callers can read it through
 * `getText()` instead of touching `element.value` directly.
 *
 * @category Components
 */
class PickerInput extends TextInput<TextInputOptions> {

    constructor() {
        super(undefined, _defaultPickerInputOptions);

        Event.addListener(this, "input", () => this.syncTextFromDom());
    }

    /**
     * Pulls the live DOM value into the inherited cached text on every
     * keystroke so callers can read it through `getText()` instead of
     * `element.value`.
     */
    private syncTextFromDom(): void {
        const el = this.getElement();
        this.setText(el ? DOM.source.getValue(el) : "");
    }
}

const PickerInputCallable = callable(PickerInput);
type PickerInputCallable = PickerInput;
export {
    PickerInput         as _PickerInput,
    PickerInputCallable as PickerInput,
};
