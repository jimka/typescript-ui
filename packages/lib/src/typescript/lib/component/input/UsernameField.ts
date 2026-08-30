// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { TextField, TextFieldOptions } from "~/component/input/TextField.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link UsernameField}.
 *
 * @category Components
 */
export interface UsernameFieldOptions extends TextFieldOptions {
    /** When true, seed autocomplete="email" instead of "username" (email-based logins). */
    email?: boolean;
}

/**
 * A username / login-identifier field — a `TextField` preset that defaults
 * `autocomplete="username"` and `name="username"` for browser credential
 * managers.
 *
 * @category Components
 */
class UsernameField extends TextField<UsernameFieldOptions> {

    /**
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: UsernameFieldOptions, subclassDefaults?: Partial<UsernameFieldOptions>) {
        super(options, subclassDefaults);

        this.setType("text");

        if (this._options.name === undefined) {
            this.setName("username");
        }

        if (this._options.autoComplete === undefined) {
            this.setAutoComplete(options?.email ? "email" : "username");
        }
    }

}

const UsernameFieldCallable = callable(UsernameField);
type UsernameFieldCallable = UsernameField;
export {
    UsernameField         as _UsernameField,
    UsernameFieldCallable as UsernameField
};
