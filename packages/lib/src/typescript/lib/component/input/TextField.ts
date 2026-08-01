// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput, TextInputOptions } from "~/component/input/TextInput.js";
import { Util } from "~/core/Util.js";
import { Insets } from "~/primitive/Insets.js";
import { BorderOptions } from "~/primitive/Border.js";
import { isUnbounded } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link TextField}.
 *
 * @category Components
 */
export interface TextFieldOptions extends TextInputOptions {
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins.
 */
const _defaultTextFieldOptions: Partial<TextFieldOptions> = {
    cursor:          "text",
    padding:         new Insets(3, 3, 3, 3),
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    foregroundColor: "var(--ts-ui-text-color, black)",
};

/**
 * A single-line text field component backed by an `<input type="text">` element.
 *
 * Keeps internal text state in sync with the DOM on every input event.
 *
 * @category Components
 */
class TextField extends TextInput<TextFieldOptions> {

    /**
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: TextFieldOptions, subclassDefaults?: Partial<TextFieldOptions>) {
        super(options, { ..._defaultTextFieldOptions, ...(subclassDefaults ?? {}) });

        this.updateHeight();
        this.subscribeTheme(() => this.updateHeight());

        this.setType("text");
    }

    /**
     * Recalculates preferred and maximum height from the unified line box plus
     * this field's own chrome.
     *
     * @remarks Box height is `Util.lineHeightPx()` plus the field's own vertical
     * insets, padding, and border — the same sum `wrapInnerBaseline` re-adds —
     * so the rendered input and its baseline match a sibling `Text`/`ComboBox`.
     * Called at construction time and after each theme change so that font-size
     * adjustments propagate to the layout hint automatically.
     */
    private updateHeight(): void {
        const h = Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize());

        this.setPreferredSize({ width: 200, height: h });
        this.setMaxSize({ width: Number.MAX_SAFE_INTEGER, height: h });
        // Min-height pinned to the single-line box so the field can't be
        // vertically compressed below one line; min-width 0 keeps it
        // horizontally flexible.
        this.setMinSize({ width: 0, height: h });
    }

    /**
     * Re-derives the single-line box after a border change. The cached height
     * includes the field's own border, so a field whose border is added or
     * removed at runtime — as `AutoCompleteField` does to its inner field —
     * would otherwise keep claiming a height for a border it no longer has.
     *
     * @remarks Rewrites heights only, never a width, and leaves an *unbounded*
     * maximum unbounded. `updateHeight` re-pins all three to the one-line box,
     * which is right at construction but wrong here: a caller that deliberately
     * unpinned the field so it can fill a taller container — the string and
     * number cell editors both do, then set a border — would have that undone by
     * a later border change. A bounded maximum still tracks the line box in both
     * directions, which keeps `min ≤ preferred ≤ max` consistent under a thicker
     * border and stops a stale maximum leaking into a composite that mirrors it.
     *
     * @param options - The border spec, forwarded to the inherited setter.
     * @returns This component, for method chaining.
     */
    setBorder(options: BorderOptions | string): this {
        super.setBorder(options);

        const h    = Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize());
        const pref = this.getPreferredSize();
        const min  = this.getMinSize();
        const max  = this.getMaxSize();

        if (pref) {
            this.setPreferredSize({ width: pref.width, height: h });
        }

        if (min) {
            this.setMinSize({ width: min.width, height: h });
        }

        if (max && !isUnbounded(max.height)) {
            this.setMaxSize({ width: max.width, height: h });
        }

        return this;
    }

}

const TextFieldCallable = callable(TextField);
type TextFieldCallable = TextField;
export {
    TextField         as _TextField,
    TextFieldCallable as TextField
};
