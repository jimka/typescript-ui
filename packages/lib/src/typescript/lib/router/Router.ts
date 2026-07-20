// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from '~/core/DOM.js';
import { ListenerBag } from '~/core/ListenerBag.js';
import { compilePattern, normalizePath, splitPath, selectPattern, type CompiledPattern } from '~/router/RoutePattern.js';

/** Params extracted from a matched pattern's `:name` segments. */
export type RouteParams = Record<string, string>;

/** A registered route's callback: drives whatever it fronts, never builds it. */
export type RouteHandler = (params: RouteParams, path: string) => void;

/** The events a {@link Router} emits. */
export type RouterEvent = "navigate" | "nomatch";

/** The pattern and params a navigation resolved to. */
export interface RouteMatch {
    /** The pattern that won, as registered. */
    pattern: string;
    params:  RouteParams;
    /** The normalized path that was matched. */
    path:    string;
}

/** Construction options for {@link Router}. */
export interface RouterOptions {
    /** Patterns to `register` at construction, keyed by pattern string. */
    routes?:    Record<string, RouteHandler>;
    listeners?: Partial<{
        navigate: (match: RouteMatch) => void;
        nomatch:  (path: string) => void;
    }>;
}

/** A registered route: its compiled pattern plus the handler it drives. */
type CompiledRoute = CompiledPattern & { handler: RouteHandler };

/**
 * Maps the URL hash to a single top-level app section. Patterns are
 * registered with {@link register} (e.g. `"/data/rows/:sel"`); on a
 * navigation, the router selects the most specific matching pattern, extracts
 * its `:param` values, and calls that pattern's handler — the handler drives
 * components that already exist, it never builds them.
 *
 * {@link start} reads the current hash, applies the matching route
 * synchronously, then installs the `hashchange` listener; call it once the
 * app has built its component tree and before the first layout pass runs, so
 * the routed section is already selected when that pass runs. {@link stop}
 * removes the listener.
 *
 * It is a plain class (no DOM element, so not `callable()`-wrapped) — it
 * follows the shape of a data store: an options bag, a private listener bag,
 * and typed `on` / `off` / `emit` forwarders.
 *
 * @category Core
 */
export class Router {

    private _routes:    Map<string, CompiledRoute> = new Map();
    private _listeners: ListenerBag<RouterEvent>   = new ListenerBag<RouterEvent>();
    private _started:   boolean                    = false;

    // Stable reference so add/remove pair up; delegates to a named method.
    private readonly _onHashChange: () => void = () => this.handleHashChange();

    /**
     * @param options - Routes and listeners to register at construction.
     */
    constructor(options?: RouterOptions) {
        this.applyOptions(options ?? {});
    }

    /**
     * Registers a pattern's handler. Re-registering the exact same pattern
     * string replaces its handler silently. Registering a *different*
     * pattern string that collides with an already-registered one on
     * specificity (e.g. `"/users/:id"` and `"/users/:name"`) replaces it too,
     * but logs a warning naming both patterns — that collision usually
     * signals an authoring mistake.
     *
     * @param pattern - The route pattern, e.g. `"/data/rows/:sel"`.
     * @param handler - Called with the extracted params and the normalized
     * path when this pattern wins a navigation.
     * @returns This router, for chaining.
     */
    register(pattern: string, handler: RouteHandler): this {
        const compiled = compilePattern(pattern);
        const existing  = this._routes.get(compiled.key);

        if (existing !== undefined && existing.pattern !== compiled.pattern) {
            console.warn(`Router: "${existing.pattern}" and "${compiled.pattern}" have the same specificity; "${compiled.pattern}" replaces it.`);
        }

        this._routes.set(compiled.key, { ...compiled, handler });

        return this;
    }

    /**
     * Reads the current hash, applies the matching route synchronously, then
     * installs the `hashchange` listener. Calling `start()` again on an
     * already-started router logs a warning and is otherwise a no-op — it
     * does not install a second listener.
     *
     * @returns This router, for chaining.
     */
    start(): this {
        if (this._started) {
            console.warn(`Router: start() called on an already-started router; ignoring.`);

            return this;
        }

        this._started = true;
        this.applyCurrentRoute();
        DOM.sink.addListener(DOM.source.getWindow(), "hashchange", this._onHashChange);

        return this;
    }

    /**
     * Removes the `hashchange` listener. Safe to call when never started, or
     * more than once.
     *
     * @returns This router, for chaining.
     */
    stop(): this {
        if (!this._started) {
            return this;
        }

        DOM.sink.removeListener(DOM.source.getWindow(), "hashchange", this._onHashChange);
        this._started = false;

        return this;
    }

    /**
     * Writes `path` into the hash — pushing a history entry, or replacing the
     * current one when `options.replace` is `true`. Each segment is
     * percent-encoded. Writing the path already in the hash is a same-value
     * write: it fires no `hashchange` and re-runs no handler.
     *
     * @param path - The path to navigate to, e.g. `"/settings"`.
     * @param options - `replace` to replace the current history entry instead
     * of pushing a new one.
     * @returns This router, for chaining.
     */
    navigate(path: string, options?: { replace?: boolean }): this {
        const segments = splitPath(normalizePath(path));
        const hash = "#/" + segments.map((segment) => encodeURIComponent(segment)).join("/");

        if (options?.replace === true) {
            DOM.sink.replaceLocationHash(hash);
        } else {
            DOM.sink.setLocationHash(hash);
        }

        return this;
    }

    /**
     * The normalized path currently in the hash.
     *
     * @returns The current path.
     */
    getPath(): string {
        return normalizePath(DOM.source.getLocationHash());
    }

    on(event: "navigate", listener: (match: RouteMatch) => void): this;
    on(event: "nomatch",  listener: (path: string) => void): this;

    /**
     * Subscribes a listener to a router event. Listeners fire in
     * registration order.
     *
     * @param event - The event to listen for.
     * @param listener - The callback to invoke.
     * @returns This router, for chaining.
     */
    on(event: RouterEvent, listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. No-op if it was never
     * registered for that event.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The exact callback reference to remove.
     * @returns This router, for chaining.
     */
    off(event: RouterEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Notifies all listeners registered for an event, in registration order.
     *
     * @param event - The event to emit.
     * @param payload - The value passed to each listener.
     */
    protected emit(event: RouterEvent, payload: unknown): void {
        this._listeners.fire(event, payload);
    }

    /**
     * Reads the current hash and calls the most specific matching pattern's
     * handler, emitting `"navigate"` — or emits `"nomatch"` when nothing
     * matches. Shared by {@link start} and the `hashchange` listener.
     */
    private applyCurrentRoute(): void {
        const path   = this.getPath();
        const result = selectPattern(Array.from(this._routes.values()), path);

        if (result === null) {
            this.emit("nomatch", path);

            return;
        }

        const match: RouteMatch = { pattern: result.compiled.pattern, params: result.params, path };

        result.compiled.handler(result.params, path);
        this.emit("navigate", match);
    }

    /**
     * Applies an {@link RouterOptions} bag: registers `routes`, then wires
     * `listeners`. Called from the constructor body, after every field
     * initializer has run.
     *
     * @param options - The options bag to apply.
     */
    protected applyOptions(options: RouterOptions): void {
        if (options.routes !== undefined) {
            for (const pattern of Object.keys(options.routes)) {
                this.register(pattern, options.routes[pattern]);
            }
        }

        if (options.listeners !== undefined) {
            for (const event of Object.keys(options.listeners) as RouterEvent[]) {
                const listener = options.listeners[event];

                if (listener !== undefined) {
                    this._listeners.add(event, listener);
                }
            }
        }
    }

    private handleHashChange(): void {
        this.applyCurrentRoute();
    }
}
