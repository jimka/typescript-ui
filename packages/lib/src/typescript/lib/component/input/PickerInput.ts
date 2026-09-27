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

    /**
     * Opts into the unchanged-geometry layout skip: a picker's inner input
     * re-committed at the rectangle it already holds, with no pass owed, is not
     * re-laid-out.
     *
     * A `PickerInput` is an `<input>` leaf with no registered children, so its
     * own pass places nothing — its default absolute manager runs over an empty
     * child list, the same argument that made a plain `Text` safe. Every input
     * announces itself:
     *
     * - The text, value, placeholder, read-only and enabled state are attribute
     *   writes on an already-placed element; none is a layout input, and the
     *   inherited on-input sync only refreshes the cached text.
     * - Its rectangle is written by {@link AbstractPickerField}'s own pass,
     *   which commits it through `applyBounds` — so the field's content box
     *   moving, on a resize or a chrome change, lays this input out.
     * - `setInsets` / `clearInsets`, `setLayoutManager`, padding and border —
     *   each marks the layout owed here, like any `invalidateLayout`.
     * - A theme switch or web-font swap — re-measured through the text-metrics
     *   condition the skip's own gate applies.
     *
     * Not covered, and so not re-flowed until this component's rectangle next
     * moves or something schedules it: a consumer child that changes its own
     * intrinsic size without calling `setPreferredSize` or
     * `notifyIntrinsicSizeChanged`. It should follow its change with
     * `scheduleLayout()`.
     *
     * @returns `true`.
     */
    protected canSkipUnchangedLayout(): boolean {
        return true;
    }
}

const PickerInputCallable = callable(PickerInput);
type PickerInputCallable = PickerInput;
export {
    PickerInput         as _PickerInput,
    PickerInputCallable as PickerInput,
};
