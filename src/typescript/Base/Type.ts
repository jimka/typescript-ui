export namespace Type {
    export function requireNonNull(obj: object, msg: string) {
        if (obj) {
            return;
        }

        if (!msg) {
            msg = "Argument cannot be null.";
        }

        throw new Error(msg)
    }

    export function isElement(value: object) {
        return value instanceof Element;
    }

    export function ifElement(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isElement(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
    }

    export function requireElement(value: object, msg: string) {
        if (Type.isElement(value)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be a DOM element.";
        }

        throw new Error(msg);
    }

    export function isBoolean(value: object) {
        return toString.call(value) === '[object Boolean]';
    }

    export function ifBoolean(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isBoolean(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
    }

    export function requireBoolean(value: object, msg: string) {
        if (Type.isBoolean(value)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be a boolean.";
        }

        throw new Error(msg);
    }

    export function isArguments(value: object) {
        return value && value.toString() === "[object Arguments]";
    }


    export function ifArguments(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isArguments(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
    }

    export function requireArguments(value: object, msg: string) {
        if (Type.isArguments(value)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be an arguments-object.";
        }

        throw new Error(msg);
    }

    export function isArray(value: object) {
        return value && Array.isArray(value);
    }

    export function ifArray(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isArray(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
    }

    export function requireArray(value: object, msg: string) {
        if (Type.isArray(value)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be an array.";
        }

        throw new Error(msg);
    }

    export function isObject(value: object) {
        return value && !Type.isArray(value) && value instanceof Object;
    }

    export function ifObject(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isObject(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
    }

    export function requireObject(value: object, msg: string) {
        if (Type.isObject(value)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be an object.";
        }

        throw new Error(msg);
    }

    export function isFunction(value: object) {
        return value && {}.toString.call(value) === '[object Function]';
    }

    export function ifFunction(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isFunction(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
    }

    export function requireFunction(value: object, msg: string) {
        if (Type.isFunction(value)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be a function.";
        }

        throw new Error(msg);
    }

    export function isString(value: object, allowNull: boolean = false) {
        if (allowNull && value == null) {
            return true;
        }

        return typeof value === "string";
    }

    export function ifString(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isString(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
    }

    export function requireString(value: object, allowNull: boolean = false, msg: string, ) {
        if (Type.isString(value, allowNull)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be a string.";
        }

        throw new Error(msg);
    }

    export function isFloat(value: object) {
        if (!Type.isNumber(value)) {
            return false;
        }

        let n: number = (value as Number).valueOf();
        return n === +n && n !== (n | 0);
    }

    export function ifFloat(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isFloat(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
    }

    export function requireFloat(value: object, msg: string) {
        if (Type.isFloat(value)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be a float.";
        }

        throw new Error(msg);
    }

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

    export function ifInteger(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isInteger(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
    }

    export function requireInteger(value: object, allowNull: boolean = false, msg: string) {
        if (Type.isInteger(value, allowNull)) {
            return;
        }

        if (!msg) {
            msg = "Argument must be an integer.";
        }

        throw new Error(msg);
    }

    export function isNumber(value: object) {
        return typeof value == 'number';
    }

    export function ifNumber(value: object, trueFunc: Function, falseFunc: Function) {
        if (Type.isNumber(value) && Type.isFunction(trueFunc)) {
            trueFunc();
        } else if (Type.isFunction(falseFunc)) {
            falseFunc();
        }
    }

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