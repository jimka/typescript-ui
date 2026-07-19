// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Runtime type-checking and assertion utilities.
 * Each type provides `is*`, `if*`, and `require*` variants.
 */
export namespace Type {
    /**
     * Throws if obj is null or undefined, using the provided message as the error text.
     *
     * @param obj - The value to test for nullability.
     * @param msg - The error message to use if the check fails. Defaults to "Argument cannot be null."
     */
    export function requireNonNull(obj: object, msg: string) {
        if (obj !== null && obj !== undefined) {
            return;
        }

        if (!msg) {
            msg = "Argument cannot be null.";
        }

        throw new Error(msg)
    }

    /**
     * Returns true if value is a Boolean object or primitive.
     *
     * @param value - The value to test.
     *
     * @returns `true` if `value` is a boolean, `false` otherwise.
     */
    export function isBoolean(value: object) {
        return toString.call(value) === '[object Boolean]';
    }

    /**
     * Throws if value is not a boolean.
     *
     * @param value - The value to test.
     * @param msg - The error message to use if the check fails. Defaults to "Argument must be a boolean."
     */
    export function requireBoolean(value: object, msg: string) {
        if (Type.isBoolean(value)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be a boolean.";
        }

        throw new Error(msg);
    }

    /**
     * Returns true if value is an array.
     *
     * @param value - The value to test.
     *
     * @returns `true` if `value` is an array, `false` otherwise.
     */
    export function isArray(value: object) {
        return value && Array.isArray(value);
    }

    /**
     * Throws if value is not an array.
     *
     * @param value - The value to test.
     * @param msg - The error message to use if the check fails. Defaults to "Argument must be an array."
     */
    export function requireArray(value: object, msg: string) {
        if (Type.isArray(value)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be an array.";
        }

        throw new Error(msg);
    }

    /**
     * Returns true if value is a non-array, non-null Object instance.
     *
     * @param value - The value to test.
     *
     * @returns `true` if `value` is a plain object (not an array and not null), `false` otherwise.
     */
    export function isObject(value: object) {
        return value && !Type.isArray(value) && value instanceof Object;
    }

    /**
     * Throws if value is not an object.
     *
     * @param value - The value to test.
     * @param msg - The error message to use if the check fails. Defaults to "Argument must be an object."
     */
    export function requireObject(value: object, msg: string) {
        if (Type.isObject(value)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be an object.";
        }

        throw new Error(msg);
    }

    /**
     * Returns true if value is a function.
     *
     * @param value - The value to test.
     *
     * @returns `true` if `value` is a function, `false` otherwise.
     */
    export function isFunction(value: object) {
        return value && {}.toString.call(value) === '[object Function]';
    }

    /**
     * Throws if value is not a function.
     *
     * @param value - The value to test.
     * @param msg - The error message to use if the check fails. Defaults to "Argument must be a function."
     */
    export function requireFunction(value: object, msg: string) {
        if (Type.isFunction(value)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be a function.";
        }

        throw new Error(msg);
    }

    /**
     * Returns true if value is a string; also accepts null when allowNull is true.
     *
     * @param value - The value to test.
     * @param allowNull - Optional. When `true`, a `null` or `undefined` value is also considered valid.
     *
     * @returns `true` if `value` is a string (or null/undefined when `allowNull` is set), `false` otherwise.
     */
    export function isString(value: object, allowNull: boolean = false) {
        if (allowNull && value == null) {
            return true;
        }

        return typeof value === "string";
    }

    /**
     * Throws if value is not a string (or not null when allowNull is true).
     *
     * @param value - The value to test.
     * @param allowNull - Optional. When `true`, null/undefined passes the check.
     * @param msg - The error message to use if the check fails. Defaults to "Argument must be a string."
     */
    export function requireString(value: object, allowNull: boolean = false, msg: string, ) {
        if (Type.isString(value, allowNull)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be a string.";
        }

        throw new Error(msg);
    }

    /**
     * Returns true if value is a floating-point number (not an integer).
     *
     * @param value - The value to test.
     *
     * @returns `true` if `value` is a finite non-integer number, `false` otherwise.
     */
    export function isFloat(value: object) {
        if (!Type.isNumber(value)) {
            return false;
        }

        let n: number = (value as Number).valueOf();
        return n === +n && n !== (n | 0);
    }

    /**
     * Returns true if value is a whole-number integer; also accepts null/0 when allowNull is true.
     *
     * @param value - The value to test.
     * @param allowNull - Optional. When `true`, a falsy value (null, 0, undefined) is also considered valid.
     *
     * @returns `true` if `value` is an integer (or falsy when `allowNull` is set), `false` otherwise.
     */
    export function isInteger(value: object, allowNull: boolean = false) {
        if (allowNull && !value) {
            return true;
        }

        if (!Type.isNumber(value)) {
            return false;
        }

        let n: number = (value as Number).valueOf();
        return n === +n && n === (n | 0);
    }

    /**
     * Throws if value is not an integer (or not null when allowNull is true).
     *
     * @param value - The value to test.
     * @param allowNull - Optional. When `true`, null/undefined/0 passes the check.
     * @param msg - The error message to use if the check fails. Defaults to "Argument must be an integer."
     */
    export function requireInteger(value: object, allowNull: boolean = false, msg: string) {
        if (Type.isInteger(value, allowNull)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be an integer.";
        }

        throw new Error(msg);
    }

    /**
     * Returns true if value is of type number (including NaN and Infinity).
     *
     * @param value - The value to test.
     *
     * @returns `true` if `typeof value === 'number'`, `false` otherwise.
     */
    export function isNumber(value: object) {
        return typeof value == 'number';
    }

    /**
     * Throws if value is not a number.
     *
     * @param value - The value to test.
     * @param msg - The error message to use if the check fails. Defaults to "Argument must be a number."
     */
    export function requireNumber(value: object, msg: string) {
        if (Type.isNumber(value)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be a number.";
        }

        throw new Error(msg);
    }
}
