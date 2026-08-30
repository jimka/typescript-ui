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
 * @returns A function whose `.prototype` is `Cls.prototype` and whose call
 *   behavior (bare or via `new`) constructs a `Cls` instance.
 *
 * @remarks A plain function, not a `Proxy` — WebKitGTK's JavaScriptCore
 * (Tauri's Linux webview engine) resolves `super.<method>()` to `undefined`
 * whenever a `Proxy` sits anywhere in an `extends` chain, on either its static
 * or its instance side, even with every trap implemented explicitly and even
 * when the `Proxy` is not the immediate `super` target; V8 (Chrome, Node)
 * does not have this bug, which is why it surfaces only in a Tauri desktop
 * build. Assigning `.prototype` directly, instead of forwarding property
 * reads through a `Proxy`, keeps every `extends` link a real prototype-chain
 * edge with no proxy anywhere in it, sidestepping the engine bug entirely.
 * `instance.constructor` still points at the original class (its `.prototype`
 * is shared, not copied), and `instanceof` resolves through the default
 * `Function.prototype[Symbol.hasInstance]`, which walks that same prototype
 * chain.
 *
 * Static properties fall through to `Cls` two ways: `Object.setPrototypeOf`
 * chains inherited statics (a static this class doesn't declare, read via the
 * wrapper) the same way `extends` would; each of `Cls`'s own static
 * properties additionally gets a matching accessor on the wrapper, so a write
 * through the wrapper (a test's `vi.spyOn(Wrapped, "method")`, say) still
 * lands on `Cls` itself — a plain prototype-chain read would see it, but a
 * *write* always creates an own property on the object written to rather
 * than reaching through to the chain, which without this mirroring would
 * leave `Cls`'s own method untouched and silently stop internal code that
 * calls it by the class's own (unwrapped) name from ever seeing the spy.
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
    function Wrapper(...args: unknown[]): unknown {
        return Reflect.construct(Cls, args, (new.target ?? Wrapper) as unknown as new (...args: unknown[]) => unknown);
    }

    Wrapper.prototype = Cls.prototype;
    Object.setPrototypeOf(Wrapper, Cls);

    for (const key of Object.getOwnPropertyNames(Cls)) {
        if (key === "prototype" || key === "name" || key === "length") {
            continue;
        }

        const descriptor = Object.getOwnPropertyDescriptor(Cls, key);

        if (!descriptor?.configurable) {
            continue;
        }

        Object.defineProperty(Wrapper, key, {
            get: () => (Cls as unknown as Record<string, unknown>)[key],
            set: (value: unknown) => { (Cls as unknown as Record<string, unknown>)[key] = value; },
            enumerable: descriptor.enumerable,
            configurable: true,
        });
    }

    Object.defineProperty(Wrapper, "name", { value: Cls.name, configurable: true });

    return Wrapper as unknown as Callable<T>;
}
