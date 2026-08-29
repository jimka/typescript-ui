// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from '~/core/DOM.js';
import { ListenerBag } from '~/core/ListenerBag.js';
import { compilePattern, normalizePath, splitPath, splitFragment, splitQuery, parseQuery, formatQuery, sameQuery, selectPattern, normalizeBase, stripBase, joinBase, type CompiledPattern } from '~/router/RoutePattern.js';

/** Params extracted from a matched pattern's `:name` segments. */
export type RouteParams = Record<string, string>;

/** Query parameters of a navigation, decoded. Empty when the URL carries none. */
export type RouteQuery = Record<string, string>;

/** A registered route's callback: drives whatever it fronts, never builds it. */
export type RouteHandler = (params: RouteParams, path: string, fragment: string, query: RouteQuery) => void;

/** The events a {@link Router} emits. */
export type RouterEvent = "navigate" | "nomatch";

/** Where a {@link Router} reads and writes the route: the URL hash, or the path. */
export type RouterMode = "hash" | "history";

/** The pattern and params a navigation resolved to. */
export interface RouteMatch {
    /** The pattern that won, as registered. */
    pattern: string;
    params:  RouteParams;
    /** The normalized path that was matched. */
    path:    string;
    /** The URL fragment without its `"#"`, or `""` when there is none. Always `""` in hash mode. */
    fragment: string;
    /** The query parameters the URL carried, decoded. `{}` when there are none. */
    query:    RouteQuery;
}

/** Construction options for {@link Router}. */
export interface RouterOptions {
    /** Defaults to `"hash"`. */
    mode?:      RouterMode;
    /** Path prefix the site is served under, e.g. `"/typescript-ui/"`. History mode only; defaults to `"/"`. */
    base?:      string;
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
 * Maps the URL hash or path to a single top-level app section. Patterns are
 * registered with {@link register} (e.g. `"/data/rows/:sel"`); on a
 * navigation, the router selects the most specific matching pattern, extracts
 * its `:param` values, and calls that pattern's handler — the handler drives
 * components that already exist, it never builds them.
 *
 * {@link start} reads the current hash or path, applies the matching route
 * synchronously, then installs the `hashchange` (or, in History mode,
 * `popstate`) listener; call it once the app has built its component tree
 * and before the first layout pass runs, so the routed section is already
 * selected when that pass runs. {@link stop} removes the listener.
 *
 * A navigation may also carry query parameters — view-mode properties
 * layered on top of a route that already matched, never part of pattern
 * matching. In hash mode the query is embedded in the hash; in History mode
 * it is the real `location.search`. `getQuery` reads it, `getHref` and
 * `navigate` write it, and each matched route's handler receives it as a
 * fourth argument alongside {@link RouteMatch}'s `query` field.
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
    // Set once in applyOptions and never reassigned after — construction-only,
    // like the compiled route table. Not `readonly`: strictPropertyInitialization
    // rejects a readonly field assigned from a method the constructor merely calls.
    private _mode!: RouterMode;
    private _base!: string;

    // Stable references so add/remove pair up; each delegates to a named method.
    private readonly _onHashChange: () => void = () => this.handleHashChange();
    private readonly _onPopState:   () => void = () => this.handlePopState();

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
     * Reads the current hash or path, applies the matching route
     * synchronously, then installs the `hashchange` (hash mode) or
     * `popstate` (History mode) listener. Calling `start()` again on an
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

        if (this._mode === "history") {
            DOM.sink.addListener(DOM.source.getWindow(), "popstate", this._onPopState);
        } else {
            DOM.sink.addListener(DOM.source.getWindow(), "hashchange", this._onHashChange);
        }

        return this;
    }

    /**
     * Removes the `hashchange` (hash mode) or `popstate` (History mode)
     * listener. Safe to call when never started, or more than once.
     *
     * `stop()` is the router's whole teardown surface. The window-level
     * listener it removes is the only thing that holds a router once the app
     * drops it; the private listener bag is a plain field collected with the
     * instance, so there is nothing further to release.
     *
     * @returns This router, for chaining.
     */
    stop(): this {
        if (!this._started) {
            return this;
        }

        if (this._mode === "history") {
            DOM.sink.removeListener(DOM.source.getWindow(), "popstate", this._onPopState);
        } else {
            DOM.sink.removeListener(DOM.source.getWindow(), "hashchange", this._onHashChange);
        }

        this._started = false;

        return this;
    }

    /**
     * Navigates to `path` — pushing a history entry, or replacing the
     * current one when `options.replace` is `true`. In hash mode this writes
     * the hash, discarding any `#fragment` in `path` (the `#` is already
     * spent on the route); in History mode this writes `location.pathname`
     * and `location.hash` via `pushState` / `replaceState` and — since
     * neither fires an event — applies the matching route itself. Either
     * way, navigating to the path (and, in History mode, fragment and query)
     * already current is a same-value write: no history entry is written and
     * no handler re-runs.
     *
     * `options.query` sets the query explicitly, replacing (never merging)
     * any query embedded in `path`; an omitted query falls back to whatever
     * `path` embeds, and both default to no query at all.
     *
     * @param path - The path to navigate to, e.g. `"/settings"` or, in
     * History mode, `"/settings#section"`. May embed a `?query`.
     * @param options - `replace` to replace the current history entry instead
     * of pushing a new one; `query` to set the query explicitly.
     * @returns This router, for chaining.
     */
    navigate(path: string, options?: { replace?: boolean; query?: RouteQuery }): this {
        if (this._mode === "hash") {
            // `getHref` derives the query from `path` itself when `options.query`
            // is absent, so this branch needs no parse of its own.
            const hash = this.getHref(path, options?.query);

            if (options?.replace === true) {
                DOM.sink.replaceLocationHash(hash);
            } else {
                DOM.sink.setLocationHash(hash);
            }

            return this;
        }

        const split        = splitFragment(path);
        const withoutQuery = splitQuery(split.path);
        const query        = options?.query ?? parseQuery(withoutQuery.query);
        const target       = normalizePath(withoutQuery.path);
        const fragment     = split.fragment;

        if (target === this.getPath() && fragment === this.getFragment() && sameQuery(query, this.getQuery())) {
            return this;
        }

        const url = this.getHref(fragment === "" ? target : `${target}#${fragment}`, query);

        if (options?.replace === true) {
            DOM.sink.replaceHistoryPath(url);
        } else {
            DOM.sink.pushHistoryPath(url);
        }

        this.applyCurrentRoute(); // pushState/replaceState fire no event; apply it ourselves

        return this;
    }

    /**
     * The href an `<a>` for `path` should carry, in this router's mode and
     * base: a `"#/…"` fragment in hash mode, a base-joined path in History
     * mode. Each segment is percent-encoded. A `#fragment` in `path` is
     * dropped first and, in History mode only, re-appended verbatim
     * (unencoded, so it keeps matching a heading `id`) after the encoded
     * path and query — hash mode has nowhere to put it, since its own `#`
     * is already spent on the route.
     *
     * `path` may embed a `?query`; `query` sets it explicitly instead,
     * replacing (never merging) whatever `path` embeds. The result is
     * ordered path, then `?query`, then `#fragment`.
     *
     * @param path - The route path to format, e.g. `"/guide/installation"`
     * or, in History mode, `"/guide/installation#section"`. May embed a
     * `?query`.
     * @param query - The query to use instead of whatever `path` embeds.
     * @returns The formatted href.
     */
    getHref(path: string, query?: RouteQuery): string {
        const split        = splitFragment(path);
        const withoutQuery = splitQuery(split.path);
        const effective    = query ?? parseQuery(withoutQuery.query);
        const segments     = splitPath(normalizePath(withoutQuery.path)).map((segment) => encodeURIComponent(segment));
        const encodedPath  = "/" + segments.join("/");
        const queryString  = formatQuery(effective);
        const suffix       = queryString === "" ? "" : "?" + queryString;

        if (this._mode === "hash") {
            return "#" + encodedPath + suffix;
        }

        const href = joinBase(this._base, encodedPath) + suffix;

        return split.fragment === "" ? href : `${href}#${split.fragment}`;
    }

    /**
     * The route path for `href`, or — with no argument — for the current
     * URL. The inverse of {@link getHref}: percent-encoded segments are
     * decoded, and in History mode the base is stripped first and any
     * `#fragment` is split off before normalizing (see {@link getFragment}
     * to read it).
     *
     * @param href - The href to parse; defaults to the current hash (hash
     * mode) or `location.pathname` (History mode), read through the DOM seam.
     * @returns The normalized, decoded path, without a fragment.
     */
    getPath(href?: string): string {
        if (this._mode === "hash") {
            const raw = href ?? DOM.source.getLocationHash();

            return this.decodePath(normalizePath(raw));
        }

        const raw = href ?? DOM.source.getLocationPathname();

        return this.decodePath(stripBase(this._base, splitFragment(raw).path));
    }

    /**
     * The fragment for `href`, or — with no argument — for the current URL,
     * without its leading `"#"`. Always `""` in hash mode, since the `#`
     * there is already spent on the route.
     *
     * @param href - The href to parse; defaults to the current
     * `location.hash`, read through the DOM seam.
     * @returns The fragment, or `""` when there is none.
     */
    getFragment(href?: string): string {
        if (this._mode === "hash") {
            return "";
        }

        if (href !== undefined) {
            return splitFragment(href).fragment;
        }

        const hash = DOM.source.getLocationHash();

        return hash.startsWith("#") ? hash.slice(1) : hash;
    }

    /**
     * The query parameters for `href`, or — with no argument — for the
     * current URL, decoded. In hash mode the query is embedded in the hash;
     * in History mode it is the real `location.search`, read through the DOM
     * seam. Unlike {@link getFragment}, this is never hard-wired to `{}` in
     * hash mode — the query is real in both modes.
     *
     * @param href - The href to parse; defaults to the current hash (hash
     * mode) or `location.search` (History mode), read through the DOM seam.
     * @returns The decoded query parameters, or `{}` when there are none.
     */
    getQuery(href?: string): RouteQuery {
        if (this._mode === "hash") {
            return parseQuery(splitQuery(href ?? DOM.source.getLocationHash()).query);
        }

        if (href !== undefined) {
            return parseQuery(splitQuery(splitFragment(href).path).query);
        }

        return parseQuery(DOM.source.getLocationSearch());
    }

    /**
     * Decodes each percent-encoded segment of an already-normalized path,
     * falling back to the raw segment text on a malformed escape.
     *
     * @param path - The normalized path to decode.
     * @returns The decoded path.
     */
    private decodePath(path: string): string {
        const segments = splitPath(path).map((segment) => {
            try {
                return decodeURIComponent(segment);
            } catch {
                return segment;
            }
        });

        return "/" + segments.join("/");
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
     * Reads the current hash or path and calls the most specific matching
     * pattern's handler, emitting `"navigate"` — or emits `"nomatch"` when
     * nothing matches. Shared by {@link start}, the `hashchange` listener,
     * the `popstate` listener, and History-mode {@link navigate}.
     */
    private applyCurrentRoute(): void {
        const path     = this.getPath();
        const fragment = this.getFragment();
        const query    = this.getQuery();
        const result   = selectPattern(Array.from(this._routes.values()), path);

        if (result === null) {
            this.emit("nomatch", path);

            return;
        }

        const match: RouteMatch = { pattern: result.compiled.pattern, params: result.params, path, fragment, query };

        result.compiled.handler(result.params, path, fragment, query);
        this.emit("navigate", match);
    }

    /**
     * Applies an {@link RouterOptions} bag: sets `mode` and `base`, registers
     * `routes`, then wires `listeners`. Called from the constructor body,
     * after every field initializer has run.
     *
     * @param options - The options bag to apply.
     */
    protected applyOptions(options: RouterOptions): void {
        this._mode = options.mode ?? "hash";
        this._base = normalizeBase(options.base ?? "/");

        if (options.routes !== undefined) {
            for (const pattern of Object.keys(options.routes)) {
                this.register(pattern, options.routes[pattern]);
            }
        }

        if (options.listeners !== undefined) {
            const { navigate, nomatch } = options.listeners;

            if (navigate !== undefined) {
                this.on("navigate", navigate);
            }

            if (nomatch !== undefined) {
                this.on("nomatch", nomatch);
            }
        }
    }

    private handleHashChange(): void {
        this.applyCurrentRoute();
    }

    private handlePopState(): void {
        this.applyCurrentRoute();
    }
}
