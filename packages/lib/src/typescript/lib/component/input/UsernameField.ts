// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput, TextInputOptions } from "~/component/input/TextInput.js";
import { Util } from "~/core/Util.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link UsernameField}.
 *
 * @category Components
 */
export interface UsernameFieldOptions extends TextInputOptions {
    /** When true, seed autocomplete="email" instead of "username" (email-based logins). */
    email?: boolean;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins.
 */
const _defaultUsernameFieldOptions: Partial<UsernameFieldOptions> = {
    cursor:          "text",
    padding:         new Insets(3, 3, 3, 3),
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    foregroundColor: "var(--ts-ui-text-color, black)",
};

/**
 * A username / login-identifier field — a `TextField` preset that defaults
 * `autocomplete="username"` and `name="username"` for browser credential
 * managers.
 *
 * Keeps internal text state in sync with the DOM on every input event.
 *
 * @category Components
 */
class UsernameField extends TextInput<UsernameFieldOptions> {

    /**
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: UsernameFieldOptions, subclassDefaults?: Partial<UsernameFieldOptions>) {
        super(options, { ..._defaultUsernameFieldOptions, ...(subclassDefaults ?? {}) });

        this.updateHeight();
        this.subscribeTheme(() => this.updateHeight());

        this.setType("text");

        if (this._options.name === undefined) {
            this.setName("username");
        }

        if (this._options.autoComplete === undefined) {
            this.setAutoComplete(options?.email ? "email" : "username");
        }
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

}

const UsernameFieldCallable = callable(UsernameField);
type UsernameFieldCallable = UsernameField;
export {
    UsernameField         as _UsernameField,
    UsernameFieldCallable as UsernameField
};
