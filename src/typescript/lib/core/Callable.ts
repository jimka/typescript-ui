// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Class type intersected with a call signature whose arguments and return type
 * mirror its constructor. Allows callers to invoke a wrapped class without the
 * `new` keyword while preserving `new`, `instanceof`, and `extends` semantics.
 *
 * @category Util
 */
export type Callable<T extends new (...args: any[]) => any> =
    T & ((...args: ConstructorParameters<T>) => InstanceType<T>);

/**
 * Wraps a class so it can be invoked without `new`. The returned value still
 * works with `new`, with `instanceof`, and as the right-hand side of `extends`.
 *
 * @param Cls - The class constructor to wrap.
 *
 * @returns A Proxy that forwards both `[[Call]]` and `[[Construct]]` to `Cls`.
 *
 * @remarks `instance.constructor` continues to point at the original class
 * because the Proxy forwards `[[Construct]]` via `Reflect.construct`, and
 * `instanceof` resolves through the default
 * `Function.prototype[Symbol.hasInstance]` which walks the prototype chain.
 *
 * @example
 * ```typescript
 * class Foo { constructor(public x: number) {} }
 * const FooCallable = callable(Foo);
 * const a = FooCallable(1);     // no `new`
 * const b = new FooCallable(2); // still works
 * a instanceof FooCallable;     // true
 * ```
 *
 * @category Util
 */
export function callable<T extends new (...args: any[]) => any>(Cls: T): Callable<T> {
    return new Proxy(Cls, {
        apply: (target, _thisArg, args) => Reflect.construct(target, args),
    }) as Callable<T>;
}
