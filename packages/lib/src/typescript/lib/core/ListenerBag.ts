// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Diagnostics } from "~/core/Diagnostics.js";

/**
 * Private multi-listener bag owned by an event-emitting host.
 *
 * Each host class instantiates one `ListenerBag` as a private field, then
 * exposes typed `on` / `off` / `emit` forwarders whose bodies call into
 * {@link add}, {@link remove}, and {@link fire}. The host's overload
 * signatures are the compile-time gate on event names and payloads;
 * `ListenerBag` itself stays loose on payload typing because runtime
 * fan-out earns nothing from per-event type parameters.
 *
 * Buckets preserve registration order. {@link fire} walks the bucket in
 * insertion order so consumers can rely on it.
 *
 * @typeParam TEvent - The host's string-literal union of event names.
 *
 * @category Core
 */
export class ListenerBag<TEvent extends string> {

    private _buckets: Map<TEvent, Function[]> = new Map();

    /**
     * Appends `listener` to the bucket for `event`. Creates the bucket on
     * the first registration for that event.
     *
     * @param event - The event name the listener is being registered for.
     * @param listener - The callback to invoke when {@link fire} is called
     *   with the same event.
     */
    add(event: TEvent, listener: Function): void {
        let bucket = this._buckets.get(event);

        if (!bucket) {
            bucket = [];
            this._buckets.set(event, bucket);
        }

        bucket.push(listener);
        Diagnostics.noteBagListenerAdded();
    }

    /**
     * Removes the first occurrence of `listener` from the bucket for
     * `event`. No-op if the listener was never registered for that event.
     *
     * @param event - The event name the listener was registered for.
     * @param listener - The exact callback reference to remove.
     */
    remove(event: TEvent, listener: Function): void {
        const bucket = this._buckets.get(event);

        if (!bucket) {
            return;
        }

        const idx = bucket.indexOf(listener);

        if (idx >= 0) {
            bucket.splice(idx, 1);
            Diagnostics.noteBagListenerRemoved();
        }
    }

    /**
     * Invokes every listener registered for `event` with `payload`, in
     * registration order. No-op if no listener is registered.
     *
     * @param event - The event name to dispatch.
     * @param payload - Positional arguments forwarded to each listener.
     */
    fire(event: TEvent, ...payload: unknown[]): void {
        const bucket = this._buckets.get(event);

        if (!bucket) {
            return;
        }

        for (const listener of bucket) {
            listener(...payload);
        }
    }

    /**
     * Returns a defensive copy of the listeners registered for `event`, in
     * registration order. Returns an empty array if none are registered.
     *
     * @remarks Hosts use this when they need fire semantics beyond plain
     * dispatch — e.g. early-termination when a listener returns `false`.
     * Returning a copy keeps in-flight `add` / `remove` calls from a
     * listener body from mutating the iteration.
     *
     * @param event - The event name to enumerate.
     *
     * @returns A new array of listener references.
     */
    get(event: TEvent): Function[] {
        const bucket = this._buckets.get(event);

        return bucket ? bucket.slice() : [];
    }
}
