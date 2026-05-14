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
        if (obj) {
            return;
        }

        if (!msg) {
            msg = "Argument cannot be null.";
        }

        throw new Error(msg)
    }

    /**
     * Returns true if value is a DOM Element instance.
     *
     * @param value - The value to test.
     *
     * @returns `true` if `value` is an instance of `Element`, `false` otherwise.
     */
    export function isElement(value: object) {
        return value instanceof Element;
    }

    /**
     * Calls trueFunc if value is a DOM Element, otherwise calls falseFunc.
     *
     * @param value - The value to test.
     * @param trueFunc - The function to call when `value` is a DOM Element.
     * @param falseFunc - The function to call when `value` is not a DOM Element.
     */
    export function ifElement(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isElement(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
    }

    /**
     * Throws if value is not a DOM Element.
     *
     * @param value - The value to test.
     * @param msg - The error message to use if the check fails. Defaults to "Argument must be a DOM element."
     */
    export function requireElement(value: object, msg: string) {
        if (Type.isElement(value)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be a DOM element.";
        }

        throw new Error(msg);
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
     * Calls trueFunc if value is a boolean, otherwise calls falseFunc.
     *
     * @param value - The value to test.
     * @param trueFunc - The function to call when `value` is a boolean.
     * @param falseFunc - The function to call when `value` is not a boolean.
     */
    export function ifBoolean(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isBoolean(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
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
     * Returns true if value is an arguments object.
     *
     * @param value - The value to test.
     *
     * @returns `true` if `value` is an `arguments` object, `false` otherwise.
     */
    export function isArguments(value: object) {
        return value && value.toString() === "[object Arguments]";
    }

    /**
     * Calls trueFunc if value is an arguments object, otherwise calls falseFunc.
     *
     * @param value - The value to test.
     * @param trueFunc - The function to call when `value` is an arguments object.
     * @param falseFunc - The function to call when `value` is not an arguments object.
     */
    export function ifArguments(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isArguments(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
    }

    /**
     * Throws if value is not an arguments object.
     *
     * @param value - The value to test.
     * @param msg - The error message to use if the check fails. Defaults to "Argument must be an arguments-object."
     */
    export function requireArguments(value: object, msg: string) {
        if (Type.isArguments(value)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be an arguments-object.";
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
     * Calls trueFunc if value is an array, otherwise calls falseFunc.
     *
     * @param value - The value to test.
     * @param trueFunc - The function to call when `value` is an array.
     * @param falseFunc - The function to call when `value` is not an array.
     */
    export function ifArray(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isArray(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
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
     * Calls trueFunc if value is an object, otherwise calls falseFunc.
     *
     * @param value - The value to test.
     * @param trueFunc - The function to call when `value` is an object.
     * @param falseFunc - The function to call when `value` is not an object.
     */
    export function ifObject(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isObject(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
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
     * Calls trueFunc if value is a function, otherwise calls falseFunc.
     *
     * @param value - The value to test.
     * @param trueFunc - The function to call when `value` is a function.
     * @param falseFunc - The function to call when `value` is not a function.
     */
    export function ifFunction(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isFunction(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
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
     * Calls trueFunc if value is a string, otherwise calls falseFunc.
     *
     * @param value - The value to test.
     * @param trueFunc - The function to call when `value` is a string.
     * @param falseFunc - The function to call when `value` is not a string.
     */
    export function ifString(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isString(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
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
     * Calls trueFunc if value is a float, otherwise calls falseFunc.
     *
     * @param value - The value to test.
     * @param trueFunc - The function to call when `value` is a float.
     * @param falseFunc - The function to call when `value` is not a float.
     */
    export function ifFloat(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isFloat(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
    }

    /**
     * Throws if value is not a float.
     *
     * @param value - The value to test.
     * @param msg - The error message to use if the check fails. Defaults to "Argument must be a float."
     */
    export function requireFloat(value: object, msg: string) {
        if (Type.isFloat(value)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be a float.";
        }

        throw new Error(msg);
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
     * Calls trueFunc if value is an integer, otherwise calls falseFunc.
     *
     * @param value - The value to test.
     * @param trueFunc - The function to call when `value` is an integer.
     * @param falseFunc - The function to call when `value` is not an integer.
     */
    export function ifInteger(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isInteger(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
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
     * Calls trueFunc if value is a number, otherwise calls falseFunc.
     *
     * @param value - The value to test.
     * @param trueFunc - The function to call when `value` is a number.
     * @param falseFunc - The function to call when `value` is not a number.
     */
    export function ifNumber(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isNumber(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
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
