// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput, TextInputOptions } from "~/component/input/TextInput.js";
import { Util } from "~/core/Util.js";
import { Insets } from "~/primitive/Insets.js";
import { BorderOptions } from "~/primitive/Border.js";
import { isUnbounded } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";

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

// Preferred width on the very first call, before any caller constraint has
// been resolved.
const TEXT_FIELD_DEFAULT_WIDTH = 200;

/**
 * A single-line text field component backed by an `<input type="text">` element.
 *
 * Keeps internal text state in sync with the DOM on every input event.
 *
 * @category Components
 */
class TextField<TOptions extends TextFieldOptions = TextFieldOptions> extends TextInput<TOptions> {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. `TextField` deviates
    // from `TextInput` on `cursor`/`foregroundColor` (`TextInput` itself
    // declares neither), so it needs its own registration or the hierarchy
    // walk would silently pass through to `TextInput`'s shared rule and
    // lose them.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultTextFieldOptions;

    /**
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(options, { ..._defaultTextFieldOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>);

        this.updateHeight();
        this.subscribeTheme(() => this.updateHeight());

        this.setType("text");
    }

    /**
     * Recalculates preferred and maximum height from the unified line box plus
     * this field's own chrome.
     *
     * @remarks `setBorder` below uses the same read-back technique for a
     * border change.
     */
    private updateHeight(): void {
        this.applySingleLineBox(
            Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize()),
            TEXT_FIELD_DEFAULT_WIDTH,
        );
    }

    /**
     * Re-derives the single-line box after a border change. The cached height
     * includes the field's own border, so a field whose border is added or
     * removed at runtime — as `AutoCompleteField` does to its inner field —
     * would otherwise keep claiming a height for a border it no longer has.
     *
     * @remarks Rewrites heights only, never a width, and leaves an *unbounded*
     * maximum unbounded. All three writes now share one gate: before this
     * field's own `updateHeight` has ever run (the one automatic call during
     * construction, dispatched by `Component.applyChromeOptions` before the
     * constructor body runs), `pref` is still `null` and the whole recompute
     * is skipped, so this field's first-ever size write always comes from
     * `updateHeight` itself — in the same order every sibling class already
     * uses. `updateHeight` re-pins all three to the one-line box,
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

            if (max && !isUnbounded(max.height)) {
                this.setMaxSize({ width: max.width, height: h });
            }

            if (min) {
                this.setMinSize({ width: min.width, height: h });
            }
        }

        return this;
    }

}

const TextFieldCallable = callable(TextField);
type TextFieldCallable<TOptions extends TextFieldOptions = TextFieldOptions> = TextField<TOptions>;
export {
    TextField         as _TextField,
    TextFieldCallable as TextField
};
