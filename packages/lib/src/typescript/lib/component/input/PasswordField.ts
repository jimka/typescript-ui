// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextInput, TextInputOptions } from "~/component/input/TextInput.js";
import { Util } from "~/core/Util.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link PasswordField}.
 *
 * @category Components
 */
export interface PasswordFieldOptions extends TextInputOptions {
    /**
     * false (default) → autocomplete="current-password" (login);
     * true            → autocomplete="new-password" (signup / change-password).
     */
    newPassword?: boolean;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins.
 */
const _defaultPasswordFieldOptions: Partial<PasswordFieldOptions> = {
    padding:         new Insets(3, 3, 3, 3),
    cursor:          "text",
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    foregroundColor: "var(--ts-ui-text-color, black)",
};

/**
 * A password input component that renders an `<input type="password">`
 * element, defaulting `autocomplete="current-password"` and `name="password"`
 * for browser credential managers.
 *
 * @category Components
 */
class PasswordField extends TextInput<PasswordFieldOptions> {

    /**
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: PasswordFieldOptions, subclassDefaults?: Partial<PasswordFieldOptions>) {
        super(options, { ..._defaultPasswordFieldOptions, ...(subclassDefaults ?? {}) });

        this.updateHeight();
        this.subscribeTheme(() => this.updateHeight());

        this.setType("password");

        if (this._options.name === undefined) {
            this.setName("password");
        }

        if (this._options.autoComplete === undefined) {
            this.setAutoComplete(options?.newPassword ? "new-password" : "current-password");
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
     * adjustments propagate to the layout hint automatically. Width is read back
     * from the already-resolved constraint — a caller override, or the class
     * default on the very first call — so only the height component changes on
     * a theme change, mirroring `TextField.setBorder`'s own read-back technique.
     */
    private updateHeight(): void {
        const h = Util.singleLineBoxHeight(this.getInsets(), this.getPadding(), this.getBorderSize());

        const width = this.getPreferredSizeConstraint()?.width ?? 200;
        this.setPreferredSize({ width, height: h });

        const maxWidth = this.getMaxSizeConstraint()?.width ?? Number.MAX_SAFE_INTEGER;
        this.setMaxSize({ width: maxWidth, height: h });

        // Min-height pinned to the single-line box so the field can't be
        // vertically compressed below one line; min-width preserves whatever
        // was already resolved (a caller override, or 0 by default) instead of
        // re-asserting a literal on every call.
        const minWidth = this.getMinSizeConstraint()?.width ?? 0;
        this.setMinSize({ width: minWidth, height: h });
    }
}

const PasswordFieldCallable = callable(PasswordField);
type PasswordFieldCallable = PasswordField;
export {
    PasswordField         as _PasswordField,
    PasswordFieldCallable as PasswordField
};
