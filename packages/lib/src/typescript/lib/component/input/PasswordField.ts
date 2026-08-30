// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextField, TextFieldOptions } from "~/component/input/TextField.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link PasswordField}.
 *
 * @category Components
 */
export interface PasswordFieldOptions extends TextFieldOptions {
    /**
     * false (default) → autocomplete="current-password" (login);
     * true            → autocomplete="new-password" (signup / change-password).
     */
    newPassword?: boolean;
}

/**
 * A `TextField` preset that renders an `<input type="password">` element,
 * defaulting `autocomplete="current-password"` and `name="password"` for
 * browser credential managers.
 *
 * @category Components
 */
class PasswordField extends TextField<PasswordFieldOptions> {

    /**
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: PasswordFieldOptions, subclassDefaults?: Partial<PasswordFieldOptions>) {
        super(options, subclassDefaults);

        this.setType("password");

        if (this._options.name === undefined) {
            this.setName("password");
        }

        if (this._options.autoComplete === undefined) {
            this.setAutoComplete(options?.newPassword ? "new-password" : "current-password");
        }
    }
}

const PasswordFieldCallable = callable(PasswordField);
type PasswordFieldCallable = PasswordField;
export {
    PasswordField         as _PasswordField,
    PasswordFieldCallable as PasswordField
};
