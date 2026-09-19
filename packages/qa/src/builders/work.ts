// Per-instance work counters. The harness's `countMethod` counts a method on
// its prototype, for every instance of a class; a panel whose figure names one
// component, such as the sidebar pane's `doLayout`, counts that instance alone.

import type { HarnessTools } from '../harness/types.js';

/**
 * Wraps one instance's method so every call is tallied under `label` in the
 * work counters, then delegates to the original. Mirrors Loom's `countMethod`,
 * but on the instance, under a fixed label.
 *
 * @param tools - The harness tools.
 * @param component - The instance to count.
 * @param method - The method's name.
 * @param label - The counter's key, e.g. `sidebar.doLayout`.
 * @returns `counting <label>`, or `NOT FOUND <method> on <class>` when the instance has no such method.
 */
export function countInstance(tools: HarnessTools, component: object, method: string, label: string): string {
    const host = component as Record<string, unknown>;
    const original = host[method];

    if (typeof original !== 'function') {
        return `NOT FOUND ${method} on ${tools.className(component)}`;
    }

    host[method] = function countedInstanceCall(this: unknown, ...args: unknown[]): unknown {
        tools.bumpWork(label);

        return (original as (...a: unknown[]) => unknown).apply(this, args);
    };

    return `counting ${label}`;
}
