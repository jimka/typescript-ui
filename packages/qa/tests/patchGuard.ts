// Undoes what an ablation or a counter patched, so one test's patches never
// reach the next. Every ablation patches shared objects — prototypes, the DOM
// seam's sink and source, `Tooltip`'s and `AbstractWindow`'s statics,
// `Date.prototype` — and those outlive the test that patched them, as the
// page-level `Body` singleton does.

import type { AnyObj, HarnessLibrary, HarnessTools } from '../src/harness/types.js';

/** The own property descriptors of each object, as they were when snapshotted. */
export type PatchSnapshot = Array<[object, PropertyDescriptorMap]>;

/**
 * Records every own property descriptor of each object.
 *
 * @param objects - The objects an ablation or a counter may patch.
 * @returns The snapshot, for `restorePatchables`.
 */
export function snapshotPatchables(objects: object[]): PatchSnapshot {
    return [...new Set(objects)].map((obj) => [obj, Object.getOwnPropertyDescriptors(obj)]);
}

/**
 * Puts every snapshotted object back as it was: an own property added since
 * is deleted, and one that changed is redefined from its recorded descriptor.
 *
 * @param snapshot - What `snapshotPatchables` recorded.
 */
export function restorePatchables(snapshot: PatchSnapshot): void {
    for (const [obj, before] of snapshot) {
        for (const key of Reflect.ownKeys(obj)) {
            if (!Object.hasOwn(before, key)) {
                Reflect.deleteProperty(obj, key);
            }
        }

        for (const key of Reflect.ownKeys(before)) {
            const recorded = (before as Record<PropertyKey, PropertyDescriptor>)[key];

            if (!sameDescriptor(Object.getOwnPropertyDescriptor(obj, key), recorded)) {
                Object.defineProperty(obj, key, recorded);
            }
        }
    }
}

/**
 * Whether two property descriptors describe the same property.
 *
 * @param now - The property's descriptor now, or `undefined` when it is gone.
 * @param recorded - Its descriptor when snapshotted.
 * @returns `true` when every field is identical.
 */
function sameDescriptor(now: PropertyDescriptor | undefined, recorded: PropertyDescriptor): boolean {
    return now !== undefined
        && now.value === recorded.value
        && now.get === recorded.get
        && now.set === recorded.set
        && now.writable === recorded.writable
        && now.enumerable === recorded.enumerable
        && now.configurable === recorded.configurable;
}

/**
 * Every prototype along `obj`'s chain, and each prototype's constructor,
 * stopping before `Object.prototype`.
 *
 * @param obj - Any object.
 * @returns The prototypes and constructors, nearest first.
 */
function chainOf(obj: object): object[] {
    const out: object[] = [];

    for (let p = Object.getPrototypeOf(obj); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
        out.push(p);

        if (typeof p.constructor === 'function') {
            out.push(p.constructor);
        }
    }

    return out;
}

/**
 * Every object an ablation or a counter may patch on the mounted page: each
 * prototype, and its constructor, along the chain of every live component and
 * layout manager; `lib.DOM` itself and its sink and source, with their
 * prototypes; `lib.Tooltip`, `lib.AbstractWindow`; and `Date.prototype`.
 *
 * @param tools - The harness tools, for the component-tree walk.
 * @param lib - The library objects the ablations receive.
 * @param extras - Further objects whose prototype chains an ablation patches, such as a Markdown viewer's heading tracker.
 * @returns The objects, for `snapshotPatchables`.
 */
export function patchablesOf(tools: HarnessTools, lib: HarnessLibrary, extras: object[] = []): object[] {
    const out: object[] = [lib.DOM, lib.DOM.sink, lib.DOM.source, Date.prototype];

    out.push(Object.getPrototypeOf(lib.DOM.sink) as object, Object.getPrototypeOf(lib.DOM.source) as object);

    if (lib.Tooltip) {
        out.push(lib.Tooltip);
    }

    if (lib.AbstractWindow) {
        out.push(lib.AbstractWindow);
    }

    for (const component of tools.walkComponents()) {
        out.push(...chainOf(component));

        const getLayoutManager = component.getLayoutManager as (() => AnyObj | null) | undefined;
        const lm = typeof getLayoutManager === 'function' ? getLayoutManager.call(component) : null;

        if (lm) {
            out.push(...chainOf(lm));
        }
    }

    for (const extra of extras) {
        out.push(...chainOf(extra));
    }

    return out;
}
