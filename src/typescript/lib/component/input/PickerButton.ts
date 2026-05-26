// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Button } from "~/component/button/Button.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";

/**
 * Internal `<button>` Component used by every {@link AbstractPickerField}
 * concrete subclass (DateField / TimeField / DateTimeField) as the
 * glyph-bearing trigger to the right of the input.
 *
 * Extends `Button` with `chromeless: true` (suppresses Button's border /
 * shadow / gradient defaults and the UA `<button>` background). The
 * per-field glyph (calendar / clock / calendar) is set after construction
 * via `setGlyph` — Button's content-row Fit layout centres it within the
 * inner rect automatically.
 *
 * @category Components
 */
class PickerButton extends Button {

    constructor() {
        super({
            chromeless: true,
            insets:     new Insets(0, 4, 0, 4),
        });
    }
}

const PickerButtonCallable = callable(PickerButton);
type PickerButtonCallable = PickerButton;
export {
    PickerButton         as _PickerButton,
    PickerButtonCallable as PickerButton,
};
