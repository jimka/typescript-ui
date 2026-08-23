// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput, TextInputOptions } from "~/component/input/TextInput.js";
import { callable } from "~/core/Callable.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";

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

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. `PickerInput` deviates
    // from `TextInput` on `cursor`/`border`/`outline` (`TextInput` itself
    // declares neither `cursor` nor `outline`, and a different `border`), so
    // it needs its own registration or the hierarchy walk would silently
    // pass through to `TextInput`'s shared rule and lose them — the
    // `border`/`outline: "none"` pair in particular is what suppresses
    // `TextInput`'s visible border and the browser focus ring so
    // `AbstractPickerField`'s outer chrome doesn't double up.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultPickerInputOptions;

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
