// Component-tree walking and prototype helpers, ported from Loom's
// qa-harness.ts. `Body` is passed in, so this module imports nothing from the
// library; `createTools` binds it into the tools.

import type { AnyObj, HarnessLibrary } from './types.js';

/**
 * Every live component, reached from `Body`'s singleton through
 * `getComponents()`. Each component appears once.
 *
 * @param Body - The page's `Body` class.
 * @returns The components, `Body` itself first.
 */
export function walkComponents(Body: HarnessLibrary['Body']): AnyObj[] {
    const out: AnyObj[] = [];
    const seen = new Set<unknown>();
    const stack: AnyObj[] = [Body.getInstance() as AnyObj];

    while (stack.length) {
        const c = stack.pop() as AnyObj;

        if (!c || seen.has(c)) {
            continue;
        }

        seen.add(c);
        out.push(c);

        const getComponents = c.getComponents as (() => AnyObj[]) | undefined;

        if (typeof getComponents === 'function') {
            for (const child of getComponents.call(c) ?? []) {
                stack.push(child);
            }
        }
    }

    return out;
}

/**
 * The constructor name of `obj`.
 *
 * @param obj - Any object.
 * @returns The name, or `''` when it has none.
 */
export function className(obj: object): string {
    return (obj?.constructor as { name?: string } | undefined)?.name ?? '';
}

/**
 * The constructor names along `obj`'s prototype chain, nearest first,
 * stopping before `Object.prototype`.
 *
 * @param obj - Any object.
 * @returns The names; `?` for a prototype whose constructor has none.
 */
export function protoChainNames(obj: object): string[] {
    const names: string[] = [];
    let p = Object.getPrototypeOf(obj);

    while (p && p !== Object.prototype) {
        names.push((p.constructor as { name?: string })?.name ?? '?');
        p = Object.getPrototypeOf(p);
    }

    return names;
}

/**
 * Whether a class named `name` is in `obj`'s prototype chain.
 *
 * @param obj - Any object.
 * @param name - A class name.
 * @returns `true` when `obj` is an instance of a class of that name.
 */
export function isA(obj: object, name: string): boolean {
    return protoChainNames(obj).includes(name);
}

/**
 * Replaces `method` on the prototype that owns it (walking up from `obj`) with
 * a function that returns `this`, so every instance is affected.
 *
 * @param obj - An instance whose chain declares `method`.
 * @param method - The method to no-op.
 * @returns A note naming the patched prototype, or saying none was found.
 */
export function noopOnOwningProto(obj: object, method: string): string {
    const proto = ownerProto(obj, method);

    if (!proto) {
        return `NOT FOUND ${method} on ${className(obj)}`;
    }

    proto[method] = function (this: unknown): unknown {
        return this;
    };

    return `patched ${(proto.constructor as { name?: string })?.name}.${method}`;
}

/**
 * The nearest prototype in `obj`'s chain that owns `method`.
 *
 * @param obj - Any object.
 * @param method - A method name.
 * @returns The owning prototype, or `null`.
 */
export function ownerProto(obj: object, method: string): AnyObj | null {
    let p = Object.getPrototypeOf(obj);

    while (p && p !== Object.prototype) {
        if (Object.prototype.hasOwnProperty.call(p, method)) {
            return p as AnyObj;
        }

        p = Object.getPrototypeOf(p);
    }

    return null;
}

/**
 * The *furthest* prototype that owns `method` — the base declaration rather
 * than a subclass override. Patching `Component.prototype.doLayout` needs this:
 * walking up from a live component finds whichever subclass overrode it first.
 *
 * @param obj - Any object.
 * @param method - A method name.
 * @returns The furthest owning prototype, or `null`.
 */
export function rootOwnerProto(obj: object, method: string): AnyObj | null {
    let p = Object.getPrototypeOf(obj);
    let found: AnyObj | null = null;

    while (p && p !== Object.prototype) {
        if (Object.prototype.hasOwnProperty.call(p, method)) {
            found = p as AnyObj;
        }

        p = Object.getPrototypeOf(p);
    }

    return found;
}

/**
 * The first live component whose prototype chain includes `name`.
 *
 * @param Body - The page's `Body` class.
 * @param name - A class name.
 * @returns The component, or `null`.
 */
export function findComponent(Body: HarnessLibrary['Body'], name: string): AnyObj | null {
    return walkComponents(Body).find((c) => isA(c, name)) ?? null;
}

/**
 * The first live layout manager whose prototype chain includes `name`.
 *
 * @param Body - The page's `Body` class.
 * @param name - A layout manager class name.
 * @returns The layout manager, or `null`.
 */
export function findLayoutManager(Body: HarnessLibrary['Body'], name: string): AnyObj | null {
    for (const c of walkComponents(Body)) {
        const get = c.getLayoutManager as (() => AnyObj | null) | undefined;
        const lm = typeof get === 'function' ? get.call(c) : null;

        if (lm && isA(lm, name)) {
            return lm;
        }
    }

    return null;
}
