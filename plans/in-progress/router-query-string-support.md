---
touches-shared: [packages/lib/src/typescript/lib/core/DOM.ts, packages/lib/tests/dom/TestDOM.ts]
---

# Router Query-String Support — Implementation Plan

## Overview

`Router` today throws query strings away. [`normalizePath`](packages/lib/src/typescript/lib/router/RoutePattern.ts#L36) discards everything from the first `"?"`, and nothing in [`Router`](packages/lib/src/typescript/lib/router/Router.ts#L66) can read or write a `key=value` pair. This plan adds query parameters as a first-class part of a navigation, in both router modes.

Query parameters carry **view-mode properties layered on top of a route that already matched** — a diagram's initial traversal depth, whether a table view opens rotated, which record index to focus. Object identity stays in path segments. A query parameter never affects which pattern wins.

Three pieces change. `RoutePattern.ts` gains four pure functions (`splitQuery`, `parseQuery`, `formatQuery`, `sameQuery`) alongside the existing `splitFragment` / `normalizeBase` family. `Router.ts` gains a `RouteQuery` type, a `getQuery(href?)` reader, a fourth handler argument, a `query` field on `RouteMatch`, and query-aware `getHref` / `navigate`. `core/DOM.ts` gains one read seam, `getLocationSearch()`, because History mode's query lives in `location.pathname`'s sibling `location.search` ([DOM.ts:1153](packages/lib/src/typescript/lib/core/DOM.ts#L1153) is the pathname reader it sits beside).

No build-configuration file changes: `@jimka/typescript-ui/router` already exists as a subpath barrel, so the five build files the original router plan had to edit are untouched here.

---

## Architecture Decisions

### Hash mode embeds its query inside the hash; History mode uses `location.search`

In hash mode the query is written and read inside the hash string itself — `#/table/users?rotated=true` — and `location.search` is never touched. In History mode the query is the real `location.search`, read through a new DOM seam method.[^hash-embedded-query]

Concretely, for the route path `/table/users` with query `{rotated: "true"}` and (History mode only) fragment `columns`:

| Mode | Base | URL the router produces |
|---|---|---|
| hash | — | `#/table/users?rotated=true` |
| history | `/` | `/table/users?rotated=true#columns` |
| history | `/sqladmin/` | `/sqladmin/table/users?rotated=true#columns` |

The ordering is the URL's own: path, then `?query`, then `#fragment`. Parsing runs in the mirror order — split the fragment off first, then the query — so a `"?"` inside a fragment stays part of the fragment.

### The query is read with `getQuery(href?)`, mirroring `getFragment(href?)`

`getQuery` takes an optional href and, with no argument, reads the current URL through the DOM seam — the same mode-branch-then-href-branch shape as [`getFragment`](packages/lib/src/typescript/lib/router/Router.ts#L276). It returns a fresh `RouteQuery` (`Record<string, string>`), the exact type shape [`RouteParams`](packages/lib/src/typescript/lib/router/Router.ts#L8) already uses.

Unlike `getFragment`, `getQuery` is **not** hard-wired to `{}` in hash mode — the query is real in both modes.

### The query is written either embedded in the path string or as an explicit record; the record wins

`getHref(path, query?)` and `navigate(path, { query })` both accept a query embedded in `path` (`"/table/users?rotated=true"`) and an explicit `RouteQuery`. When both are present the explicit record replaces the embedded one entirely — it is not merged.[^two-write-forms]

| Call (hash mode) | Result |
|---|---|
| `getHref("/x")` | `#/x` |
| `getHref("/x?a=1")` | `#/x?a=1` |
| `getHref("/x", { b: "2" })` | `#/x?b=2` |
| `getHref("/x?a=1", { b: "2" })` | `#/x?b=2` — the record replaces `a=1` |
| `getHref("/x?a=1", {})` | `#/x` — an explicit empty record is still a replacement |

`getHref` takes `query` as a second positional parameter while `navigate` takes it inside its existing options bag.[^positional-query-on-gethref]

### `RouteHandler` grows a fourth positional argument

`RouteHandler` becomes `(params, path, fragment, query) => void`. Handlers written against the current three-argument form keep working unchanged — an extra argument is ignored.[^append-positional-handler-arg]

`RouteMatch` gains a matching `query` field, exactly as it carries `fragment` today.

### Parsing and formatting are hand-rolled pure functions in `RoutePattern.ts`

`splitQuery`, `parseQuery`, `formatQuery`, and `sameQuery` join `splitFragment` / `normalizeBase` / `stripBase` / `joinBase` in [RoutePattern.ts](packages/lib/src/typescript/lib/router/RoutePattern.ts) — the module's established home for pure, DOM-free URL mechanics that the barrel does not export. `URLSearchParams` is not used.[^hand-rolled-not-urlsearchparams]

These four functions take and return bare `Record<string, string>`, never the `RouteQuery` alias. `RoutePattern.ts` must not import from `Router.ts` — that would close an import cycle, since `Router.ts` imports `RoutePattern.ts`. This mirrors [`matchPattern`](packages/lib/src/typescript/lib/router/RoutePattern.ts#L176), which returns `Record<string, string> | null` rather than naming `RouteParams`.

### Encode/decode rules

`formatQuery` encodes both key and value with `encodeURIComponent` and always emits the `=`. `parseQuery` decodes with `decodeURIComponent` inside a `try` / `catch`, falling back to the raw text — the same treatment [`decodeSegment`](packages/lib/src/typescript/lib/router/RoutePattern.ts#L210) gives a path segment, and that function is reused directly.

| Rule | Input | Result |
|---|---|---|
| Split each pair at its **first** `=` | `"a=1=2"` | `{ a: "1=2" }` |
| A pair with no `=` is a key with an empty value | `"rotated"` | `{ rotated: "" }` |
| Duplicate keys: **last wins** | `"a=1&a=2"` | `{ a: "2" }` |
| Empty pairs are skipped | `"a=1&&b=2"` | `{ a: "1", b: "2" }` |
| A pair with an empty key is skipped | `"=5"` | `{}` |
| `+` is a literal plus, **not** a space | `"q=a+b"` | `{ q: "a+b" }` |

The `+` rule follows from what `formatQuery` emits: a space becomes `%20` and a literal plus becomes `%2B`, so a bare `+` in a query string is never something the router wrote. Reading it as a space would be a guess about someone else's URL.[^plus-not-space]

### `formatQuery` preserves the caller's key order; `sameQuery` compares order-independently

`formatQuery({ b: "2", a: "1" })` is `"b=2&a=1"` — keys come out in `Object.keys` order, not sorted. Because output order therefore carries no meaning, History-mode `navigate`'s "already here, do nothing" check compares queries through `sameQuery`, which ignores order.[^no-key-sort]

### Hash-mode `navigate` routes through `getHref`

Hash-mode `navigate` currently rebuilds the encoded hash inline, duplicating [`getHref`](packages/lib/src/typescript/lib/router/Router.ts#L230)'s hash branch character for character. It now calls `this.getHref(path, query)` instead. History-mode `navigate` already calls `getHref`.[^navigate-through-gethref]

### `normalizePath` keeps stripping the query, and is rewritten onto `splitQuery`

`normalizePath("#/settings?tab=advanced")` stays `/settings` — that is what keeps every existing path-only route resolving exactly as it does today. Its inline "cut at the first `?`" block is replaced by a `splitQuery` call so the cut lives in one place.[^normalize-path-via-splitquery]

---

## Public API

### `packages/lib/src/typescript/lib/router/RoutePattern.ts` — additions

Internal mechanics, not exported from the barrel; imported directly by the tests.

```typescript
/**
 * Splits a URL-ish string at its first `"?"`: the part before, and the query
 * without its `"?"`. Everything after the first `"?"` is the query verbatim —
 * a second `"?"` stays part of it.
 */
export function splitQuery(input: string): { path: string; query: string };

/**
 * Parses a query string into decoded key/value pairs. Tolerates one leading
 * `"?"`. Later duplicates of a key win; pairs that are empty or have an empty
 * key are skipped.
 */
export function parseQuery(query: string): Record<string, string>;

/**
 * Serializes key/value pairs into a query string, without a leading `"?"`.
 * Returns `""` for an empty record. Keys come out in `Object.keys` order —
 * insertion order, except that integer-like keys come first, in ascending order.
 */
export function formatQuery(query: Record<string, string>): string;

/** Whether two query records hold the same keys with the same values, regardless of key order. */
export function sameQuery(a: Record<string, string>, b: Record<string, string>): boolean;
```

### `packages/lib/src/typescript/lib/router/Router.ts` — changes

```typescript
/** Query parameters of a navigation, decoded. Empty when the URL carries none. */
export type RouteQuery = Record<string, string>;

// CHANGED — gains a fourth argument
export type RouteHandler = (params: RouteParams, path: string, fragment: string, query: RouteQuery) => void;

export interface RouteMatch {
    pattern:  string;
    params:   RouteParams;
    path:     string;
    fragment: string;
    /** The query parameters the URL carried, decoded. `{}` when there are none. */
    query:    RouteQuery;                                        // NEW
}

export class Router {
    // CHANGED — options bag gains `query`
    navigate(path: string, options?: { replace?: boolean; query?: RouteQuery }): this;

    // CHANGED — gains an optional second parameter
    getHref(path: string, query?: RouteQuery): string;

    /** The query parameters for `href`, or — with no argument — for the current URL. */
    getQuery(href?: string): RouteQuery;                         // NEW
}
```

`RouterOptions` is unchanged.

### `packages/lib/src/typescript/lib/router/index.ts` — barrel

`RouteQuery` joins the existing `export type { … }` line.

### `packages/lib/src/typescript/lib/core/DOM.ts` — addition

```typescript
// on DOMSource only — no sink counterpart
/**
 * The current `location.search`, boxed so the raw global never escapes the
 * seam.
 *
 * @returns The query string including its leading `"?"`, or `""` when empty.
 */
getLocationSearch(): string;
```

No sink method is added: writing the query happens through the existing `pushHistoryPath` / `replaceHistoryPath` (History mode) and `setLocationHash` / `replaceLocationHash` (hash mode), all of which already take a whole URL string.

---

## Internal Structure

### `RoutePattern.ts`

```typescript
export function splitQuery(input: string): { path: string; query: string } {
    const queryIndex = input.indexOf("?");

    if (queryIndex === -1) {
        return { path: input, query: "" };
    }

    return { path: input.slice(0, queryIndex), query: input.slice(queryIndex + 1) };
}

export function parseQuery(query: string): Record<string, string> {
    const body   = query.startsWith("?") ? query.slice(1) : query;
    const result: Record<string, string> = {};

    for (const pair of body.split("&")) {
        if (pair.length === 0) {
            continue;
        }

        const equalsIndex = pair.indexOf("=");
        const rawKey      = equalsIndex === -1 ? pair : pair.slice(0, equalsIndex);
        const rawValue    = equalsIndex === -1 ? ""   : pair.slice(equalsIndex + 1);
        const key         = decodeSegment(rawKey);

        if (key.length === 0) {
            continue;
        }

        result[key] = decodeSegment(rawValue);
    }

    return result;
}

export function formatQuery(query: Record<string, string>): string {
    return Object.keys(query)
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
        .join("&");
}

export function sameQuery(a: Record<string, string>, b: Record<string, string>): boolean {
    const aKeys = Object.keys(a);

    return aKeys.length === Object.keys(b).length && aKeys.every((key) => a[key] === b[key]);
}
```

`normalizePath`'s body becomes:

```typescript
export function normalizePath(input: string): string {
    const withoutHash = input.startsWith("#") ? input.slice(1) : input;

    return "/" + splitPath(splitQuery(withoutHash).path).join("/");
}
```

`decodeSegment` is reused unchanged; widen its JSDoc summary to "Decodes a captured path segment or query part".

### `Router.ts`

```typescript
getQuery(href?: string): RouteQuery {
    if (this._mode === "hash") {
        return parseQuery(splitQuery(href ?? DOM.source.getLocationHash()).query);
    }

    if (href !== undefined) {
        return parseQuery(splitQuery(splitFragment(href).path).query);
    }

    return parseQuery(DOM.source.getLocationSearch());
}

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
```

`navigate`'s two branches:

```typescript
navigate(path: string, options?: { replace?: boolean; query?: RouteQuery }): this {
    const split        = splitFragment(path);
    const withoutQuery = splitQuery(split.path);
    const query        = options?.query ?? parseQuery(withoutQuery.query);

    if (this._mode === "hash") {
        const hash = this.getHref(path, query);

        if (options?.replace === true) {
            DOM.sink.replaceLocationHash(hash);
        } else {
            DOM.sink.setLocationHash(hash);
        }

        return this;
    }

    const target   = normalizePath(withoutQuery.path);
    const fragment = split.fragment;

    if (target === this.getPath() && fragment === this.getFragment() && sameQuery(query, this.getQuery())) {
        return this;
    }

    const url = this.getHref(fragment === "" ? target : `${target}#${fragment}`, query);

    // … unchanged push/replace + applyCurrentRoute()
}
```

`applyCurrentRoute` reads the query alongside the path and fragment, passes it as the handler's fourth argument, and puts it on the `RouteMatch`:

```typescript
const path     = this.getPath();
const fragment = this.getFragment();
const query    = this.getQuery();
// …
const match: RouteMatch = { pattern: result.compiled.pattern, params: result.params, path, fragment, query };

result.compiled.handler(result.params, path, fragment, query);
this.emit("navigate", match);
```

### `tests/dom/TestDOM.ts`

`TestHandleTable` gains a `_locationSearch` field with a `locationSearch()` / `setLocationSearch()` pair, mirroring the pathname pair at [TestDOM.ts:313-329](packages/lib/tests/dom/TestDOM.ts#L313). It stores the search **including** its leading `"?"`, the way `_locationHash` stores the leading `"#"`.

`writeHistoryPath` ([TestDOM.ts:568](packages/lib/tests/dom/TestDOM.ts#L568)) must split the URL three ways instead of two, so the modelled pathname stops carrying the query:

```typescript
private writeHistoryPath(url: string): void {
    const hashIndex  = url.indexOf('#');
    const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
    const queryIndex = beforeHash.indexOf('?');

    _table.setLocationPathname(queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex));
    _table.setLocationSearch(queryIndex === -1 ? '' : beforeHash.slice(queryIndex));
    _table.setLocationHash(hashIndex === -1 ? '' : url.slice(hashIndex));
}
```

`writeLocationHash` ([TestDOM.ts:541](packages/lib/tests/dom/TestDOM.ts#L541)) is left alone: a real hash write leaves `location.search` untouched, which is exactly what hash mode needs.[^testdom-search-split]

---

## Ordered Implementation Steps

1. **Capture the baseline.** Before touching anything, run `npm run typecheck`, `npm run typecheck:test`, `npm run lint`, and `npx vitest run` in `packages/lib`, plus `npm run typecheck` in `packages/docs`, and record the failures. Some are pre-existing on `master` (see the *Implementation Notes* at the end of [plans/implemented/hash-router.md](plans/implemented/hash-router.md)); the final verification compares against this baseline, not against zero.

2. **`packages/lib/src/typescript/lib/core/DOM.ts`** — add `getLocationSearch(): string` to the `DOMSource` interface immediately after `getLocationPathname()` ([line 1153](packages/lib/src/typescript/lib/core/DOM.ts#L1153)), and implement it on `ProductionDOMSource` immediately after its `getLocationPathname()` ([line 2208](packages/lib/src/typescript/lib/core/DOM.ts#L2208)) as `return location.search;`. Verify: `npm run typecheck` (which covers `src` only) is clean. `npm run typecheck:test` will now fail in `tests/dom/TestDOM.ts`, whose modelled source no longer implements the full `DOMSource` interface — step 3 fixes that.

3. **`packages/lib/tests/dom/TestDOM.ts`** — add the `_locationSearch` field and its `locationSearch()` / `setLocationSearch()` pair to `TestHandleTable` (after [line 329](packages/lib/tests/dom/TestDOM.ts#L329)); rewrite `writeHistoryPath` per `## Internal Structure`; add `getLocationSearch()` to `ModelledDOMSource` after its `getLocationPathname()` ([line 1117](packages/lib/tests/dom/TestDOM.ts#L1117)). Verify: `npm run typecheck:test` clean and `npx vitest run tests/dom` passes.

4. **`packages/lib/tests/unit/router/RoutePattern.test.ts`** — add `describe` blocks for `splitQuery`, `parseQuery`, `formatQuery`, and `sameQuery` covering every row in `## Expected Behaviour` marked *unit*, using the file's existing `it.each` table style. Leave the `normalizePath` table untouched — it is the regression guard for step 5's rewrite. These tests fail until step 5.

5. **`packages/lib/src/typescript/lib/router/RoutePattern.ts`** — add the four functions per `## Internal Structure`, rewrite `normalizePath` onto `splitQuery`, and widen `decodeSegment`'s JSDoc summary. Verify: `npx vitest run tests/unit/router/RoutePattern.test.ts` passes, including the untouched `normalizePath` table.

6. **`packages/lib/tests/unit/router/Router.test.ts`** — two edits. First, add `query: {}` to the four `RouteMatch` object literals asserted with `toEqual`, at [lines 92](packages/lib/tests/unit/router/Router.test.ts#L92), [274](packages/lib/tests/unit/router/Router.test.ts#L274), [542](packages/lib/tests/unit/router/Router.test.ts#L542), and [563](packages/lib/tests/unit/router/Router.test.ts#L563). Second, add a `describe('Router — query parameters')` block covering every Router case in `## Expected Behaviour`. All of these fail until step 7.

7. **`packages/lib/src/typescript/lib/router/Router.ts`** — add the `RouteQuery` type after `RouteParams` ([line 8](packages/lib/src/typescript/lib/router/Router.ts#L8)); extend `RouteHandler` ([line 11](packages/lib/src/typescript/lib/router/Router.ts#L11)) and `RouteMatch` ([line 20](packages/lib/src/typescript/lib/router/Router.ts#L20)); add `getQuery` immediately after `getFragment` ([line 288](packages/lib/src/typescript/lib/router/Router.ts#L288)); rewrite `getHref` ([line 230](packages/lib/src/typescript/lib/router/Router.ts#L230)) and `navigate` ([line 181](packages/lib/src/typescript/lib/router/Router.ts#L181)) per `## Internal Structure`; extend `applyCurrentRoute` ([line 356](packages/lib/src/typescript/lib/router/Router.ts#L356)). Widen the import at [line 5](packages/lib/src/typescript/lib/router/Router.ts#L5) with `splitQuery`, `parseQuery`, `formatQuery`, `sameQuery`. Update the JSDoc on `navigate`, `getHref`, and the class summary to describe query handling. Verify: `npx vitest run tests/unit/router` passes.

8. **Checkpoint** — `grep -rn '\blocation\b' packages/lib/src/typescript/lib/router/` must report **zero** matches. A bare `location` is not in the `local/no-raw-dom` rule's global-identifier set, so lint will not catch a direct read; this grep is the guard.

9. **`packages/lib/src/typescript/lib/router/index.ts`** — add `RouteQuery` to the `export type { … }` list at [line 4](packages/lib/src/typescript/lib/router/index.ts#L4).

10. **`packages/lib/docs/concepts/routing.md`** — see `## Documentation Impact`.

11. **`packages/lib/docs/concepts/dom-seams.md`** — in the `globals` category at [line 63](packages/lib/docs/concepts/dom-seams.md#L63), extend the list to `… / getLocationHash / setLocationHash / replaceLocationHash / getLocationPathname / getLocationSearch / pushHistoryPath / replaceHistoryPath`.[^dom-seams-list-topup]

12. **Final verification** — run everything under `## Verification`.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/src/typescript/lib/router/RoutePattern.ts` |
| Modify | `packages/lib/src/typescript/lib/router/Router.ts` |
| Modify | `packages/lib/src/typescript/lib/router/index.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Modify | `packages/lib/tests/unit/router/RoutePattern.test.ts` |
| Modify | `packages/lib/tests/unit/router/Router.test.ts` |
| Modify | `packages/lib/docs/concepts/routing.md` |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |

---

## Expected Behaviour

### `splitQuery` — *unit*

| Input | `path` | `query` |
|---|---|---|
| `"/guide?a=1"` | `/guide` | `a=1` |
| `"/guide"` | `/guide` | `` |
| `"/guide?"` | `/guide` | `` |
| `"?a=1"` | `` | `a=1` |
| `"/a?b=1?c=2"` | `/a` | `b=1?c=2` |
| `""` | `` | `` |

### `parseQuery` — *unit*

| Input | Result |
|---|---|
| `""` | `{}` |
| `"?"` | `{}` |
| `"a=1&b=2"` | `{ a: "1", b: "2" }` |
| `"?a=1"` | `{ a: "1" }` |
| `"rotated"` | `{ rotated: "" }` |
| `"a="` | `{ a: "" }` |
| `"a=1&a=2"` | `{ a: "2" }` |
| `"a=1&&b=2"` | `{ a: "1", b: "2" }` |
| `"=5"` | `{}` |
| `"a=1=2"` | `{ a: "1=2" }` |
| `"q=a%20b"` | `{ q: "a b" }` |
| `"q=%zz"` | `{ q: "%zz" }` |
| `"q=a+b"` | `{ q: "a+b" }` |
| `"a%20b=1"` | `{ "a b": "1" }` |

### `formatQuery` — *unit*

| Input | Result |
|---|---|
| `{}` | `""` |
| `{ a: "1", b: "2" }` | `"a=1&b=2"` |
| `{ b: "2", a: "1" }` | `"b=2&a=1"` |
| `{ a: "" }` | `"a="` |
| `{ q: "a b" }` | `"q=a%20b"` |
| `{ q: "a+b" }` | `"q=a%2Bb"` |
| `{ "a&b": "c=d" }` | `"a%26b=c%3Dd"` |

`parseQuery(formatQuery(q))` equals `q` for every record above.

### `sameQuery` — *unit*

| `a` | `b` | Result |
|---|---|---|
| `{}` | `{}` | `true` |
| `{ a: "1" }` | `{ a: "1" }` | `true` |
| `{ a: "1", b: "2" }` | `{ b: "2", a: "1" }` | `true` |
| `{ a: "1" }` | `{ a: "2" }` | `false` |
| `{ a: "1" }` | `{ a: "1", b: "2" }` | `false` |
| `{ a: "1" }` | `{ b: "1" }` | `false` |

### `normalizePath` — unchanged, *unit*

The existing table in `RoutePattern.test.ts` must still pass verbatim, including `"#/settings?tab=advanced" → "/settings"` and `"#/?x=1" → "/"`.

### `getQuery` — *unit, via `installTestDOM`*

- Hash mode, hash `#/settings?tab=advanced`: `getQuery()` is `{ tab: "advanced" }`, and `getPath()` is still `/settings`.
- Hash mode, hash `#/settings`: `getQuery()` is `{}`.
- Hash mode, explicit href `"#/x?a=1"`: `getQuery("#/x?a=1")` is `{ a: "1" }`.
- History mode, base `/typescript-ui/`, after `pushHistoryPath('/typescript-ui/x?a=1#frag')`: `getQuery()` is `{ a: "1" }`, `getFragment()` is `"frag"`, `getPath()` is `/x`.
- History mode, explicit href: `getQuery("/typescript-ui/concepts/sizing?depth=2#anchor")` is `{ depth: "2" }`.
- History mode, href with a `?` only inside the fragment: `getQuery("/typescript-ui/x#a?b=1")` is `{}` — the fragment splits off first.
- History mode with no search: `getQuery()` is `{}`.

### `getHref` — *unit, via `installTestDOM`*

- Back-compat, both modes: `getHref("/guide")` is `#/guide` (hash) and `/typescript-ui/guide` (History, base `/typescript-ui/`).
- Hash mode: `getHref("/table/users", { rotated: "true" })` is `#/table/users?rotated=true`.
- Hash mode: `getHref("/table/users?rotated=true")` is `#/table/users?rotated=true`.
- Hash mode: `getHref("/x?a=1", { b: "2" })` is `#/x?b=2`.
- Hash mode: `getHref("/x?a=1", {})` is `#/x`.
- Hash mode: `getHref("/guide?a=1#intro")` is `#/guide?a=1` — the fragment is dropped, the query is not.
- History mode, base `/typescript-ui/`: `getHref("/concepts/sizing#anchor", { depth: "2" })` is `/typescript-ui/concepts/sizing?depth=2#anchor` — query before fragment.
- History mode: `getHref("/concepts/sizing?depth=2#anchor")` is the same string.
- Encoding: `getHref("/a b", { "x y": "p&q" })` is `#/a%20b?x%20y=p%26q` in hash mode.
- Round trip, both modes: `getQuery(getHref(path, q))` equals `q`, and `getPath(getHref(path, q))` equals `normalizePath(path)`, for `path = "/a b"` and `q = { "x y": "p&q" }`.

### `navigate` — *unit, via `installTestDOM`*

- Hash mode: `navigate("/x", { query: { a: "1" } })` records `setLocationHash` with `#/x?a=1`.
- Hash mode: `navigate("/x?a=1", { replace: true })` records `replaceLocationHash` with `#/x?a=1` and no `setLocationHash`.
- Hash mode: after `navigate("/x", { query: { a: "1" } })`, `DOM.source.getLocationSearch()` is still `""` — hash mode never writes the real search.
- Hash mode: `navigate("/guide?a=1#intro")` records `setLocationHash` with `#/guide?a=1`.
- Hash mode back-compat: `navigate("/settings")` records `setLocationHash` with `#/settings` (no trailing `?`).
- History mode, base `/typescript-ui/`: `navigate("/concepts/sizing", { query: { depth: "2" } })` records exactly one `pushHistoryPath` with `/typescript-ui/concepts/sizing?depth=2`, and runs the matching handler once.
- History mode: starting from `/typescript-ui/x?a=1`, `navigate("/x", { query: { a: "1" } })` records **no** write and re-runs no handler.
- History mode: starting from `/typescript-ui/x?a=1&b=2`, `navigate("/x", { query: { b: "2", a: "1" } })` records **no** write — key order does not count as a change.
- History mode: starting from `/typescript-ui/x?a=1`, `navigate("/x", { query: { a: "2" } })` records one `pushHistoryPath` and re-runs the handler.
- History mode: starting from `/typescript-ui/x?a=1`, `navigate("/x")` records one `pushHistoryPath` with `/typescript-ui/x` and re-runs the handler — an omitted query clears it.
- History mode back-compat: `navigate("/settings")` from `/typescript-ui/` records one `pushHistoryPath` with `/typescript-ui/settings`.

### Handler and `RouteMatch` — *unit, via `installTestDOM`*

- Hash mode, hash `#/data/rows/5?depth=3` before `start()`: the `/data/rows/:sel` handler receives `({ sel: "5" }, "/data/rows/5", "", { depth: "3" })`, and the `"navigate"` event's `RouteMatch` is `{ pattern: "/data/rows/:sel", params: { sel: "5" }, path: "/data/rows/5", fragment: "", query: { depth: "3" } }`.
- Hash mode with no query: the handler's fourth argument is `{}` and `RouteMatch.query` is `{}`.
- History mode: after `start()`, `pushHistoryPath('/typescript-ui/data/rows/5?depth=3#detail')` followed by a dispatched `popstate` calls the handler with `({ sel: "5" }, "/data/rows/5", "detail", { depth: "3" })`.
- A handler declared with only three parameters still compiles and runs — `RouteHandler`'s fourth argument is additive.
- The query never affects which pattern wins: with `/x` and `/x/:id` registered, `#/x?id=9` matches `/x` and `params` is `{}`.

### Manual verification

- `npm run dev` in `packages/lib`, open `http://localhost:8015/#/split?depth=2` — the Split tab shows, the hash keeps `?depth=2`, and the console is clean. Clicking another tab replaces the hash with a query-less one (the demo's `syncHashToTab` passes no query), which is correct.
- `npm run dev` in `packages/docs`, click through several sidebar pages and in-page headings — History-mode navigation, fragment anchors, and the browser Back button behave exactly as before. This is the regression check for `navigate` / `getHref`, which the docs app drives at [DocsContent.ts:537](packages/docs/src/shell/DocsContent.ts#L537), [DocsShell.ts:202](packages/docs/src/shell/DocsShell.ts#L202), [DocsSidebar.ts:337](packages/docs/src/shell/DocsSidebar.ts#L337), and [links.ts:23](packages/docs/src/content/links.ts#L23).

---

## Verification

From `packages/lib`:

- `npm run typecheck` and `npm run typecheck:test` — no new failures against the step-1 baseline.
- `npx vitest run tests/unit/router tests/dom` — all pass.
- `npm run test` — no new failures against the step-1 baseline.
- `npm run lint` — no new failures against the step-1 baseline.
- `grep -rn '\blocation\b' packages/lib/src/typescript/lib/router/` — zero matches.
- `grep -n 'RouteQuery' packages/lib/src/typescript/lib/router/index.ts` — one match.
- `npm run docs:api` — finishes with **zero** TypeDoc warnings. This is what catches a public JSDoc `{@link}` pointing at `splitQuery` / `parseQuery` / `formatQuery` / `sameQuery`, none of which render.

From `packages/docs`:

- `npm run typecheck` — no new failures against the step-1 baseline. Confirms the widened `getHref` / `RouteHandler` signatures did not break the one real consumer.

Plus the two manual checks above.

---

## Documentation Impact

- **Barrel**: `RouteQuery` is exported from `packages/lib/src/typescript/lib/router/index.ts`, reachable as `@jimka/typescript-ui/router`. The four `RoutePattern.ts` functions stay internal.
- **API reference**: regenerated by TypeDoc from the existing `router/index.ts` entry point. No `typedoc.json` change.
- **Concept page** — `packages/lib/docs/concepts/routing.md`:
  - Add a `### Query parameters` subsection immediately after `### Fragments` ([line 14](packages/lib/docs/concepts/routing.md#L14)). It must cover: where the query lives in each mode (embedded in the hash vs. the real `location.search`); the `path` → `?query` → `#fragment` ordering; `getQuery(href?)`; the two write forms and the record-wins rule; that keys and values are percent-encoded and duplicates resolve last-wins; and that query parameters are view-mode properties layered on an already-matched route, never part of pattern matching.
  - Update the `navigate` bullet ([line 39](packages/lib/docs/concepts/routing.md#L39)) and the `getHref` bullet ([line 40](packages/lib/docs/concepts/routing.md#L40)) for their new parameters, and add a `getQuery` bullet after `getPath` ([line 41](packages/lib/docs/concepts/routing.md#L41)).
  - Update the handler sentence at [line 46](packages/lib/docs/concepts/routing.md#L46) — it still says a handler "is called with the extracted params and the normalized path"; it now receives params, path, fragment, and query.
  - Extend the `"navigate"` listener example ([line 72](packages/lib/docs/concepts/routing.md#L72)) to read `match.query`.
- **Seam page**: `packages/lib/docs/concepts/dom-seams.md` line 63 (step 11).
- **JSDoc constraint**: per CODE_CONVENTIONS.md, public JSDoc may only `{@link}` symbols that render. `Router`'s and `RouteQuery`'s JSDoc may link `RouteQuery`, `RouteMatch`, and the public methods, but must describe `splitQuery` / `parseQuery` / `formatQuery` / `sameQuery` in prose.
- **Capability manifest**: no change. `scripts/llms/manifest.data.mjs` already carries the `Router` row under `App shell`; no new symbol is exposed as a capability.

---

## Potential Challenges

- **Four existing `toEqual` assertions break the moment `RouteMatch` gains `query`.** They are at `Router.test.ts` lines 92, 274, 542, and 563; step 6 fixes all four. A `toEqual` on an object literal fails on an extra field, so missing one shows up immediately as a red test rather than silently passing.
- **`RoutePattern.ts` must not import `RouteQuery` from `Router.ts`.** `Router.ts` already imports `RoutePattern.ts`, so the reverse import closes a cycle. The four new functions take and return bare `Record<string, string>`.
- **`TestDOM.writeHistoryPath` now removes the query from the modelled pathname.** No existing test reads `getLocationPathname()` on a query-bearing URL, so nothing regresses — but if one appears, the new split is the correct browser behaviour and the test is what needs updating.
- **Order of splitting matters.** Fragment first, then query. Splitting the query first would put a fragment-internal `?` in the wrong half: `"/x#a?b=1"` has fragment `a?b=1` and no query.
- **`getHref`'s `query` is positional; `navigate`'s is in the options bag.** This is deliberate — see the decision above — so don't "harmonise" one into the other.
- **A `?` reaching `normalizePath` must still be discarded.** The rewrite onto `splitQuery` is behaviour-preserving, and the untouched `normalizePath` test table is the proof.
- **History-mode `navigate("/x")` now writes when the current URL carries a query.** The "already here, do nothing" check gained a third term, so navigating to the same path with no query clears an existing one instead of being a no-op. That is the intended semantics — an omitted query means "no query" — and it can only trigger against a query the router did not write itself, since `navigate` without a query never produces one.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/router/Router.ts`](packages/lib/src/typescript/lib/router/Router.ts) | The class being extended. `getFragment` (276) is the precedent `getQuery` mirrors; `getHref` (230), `navigate` (181), and `applyCurrentRoute` (356) are the three methods that change. |
| [`packages/lib/src/typescript/lib/router/RoutePattern.ts`](packages/lib/src/typescript/lib/router/RoutePattern.ts) | `splitFragment` (66) is the shape `splitQuery` copies; `decodeSegment` (210) is the decode-with-fallback helper reused for query parts; `normalizePath` (36) is rewritten. |
| [`plans/implemented/hash-router.md`](plans/implemented/hash-router.md) | The original Router plan — its `## Non-Goals` names query parameters as "a purely additive later change", which is what this plan is. Its *Implementation Notes* list the pre-existing lint/test failures step 1 baselines against. |
| [`packages/lib/tests/unit/router/RoutePattern.test.ts`](packages/lib/tests/unit/router/RoutePattern.test.ts) | The `it.each` table style every new pure-function suite must follow. |
| [`packages/lib/tests/unit/router/Router.test.ts`](packages/lib/tests/unit/router/Router.test.ts) | The `installTestDOM` + `sink.writes` assertion style, and the four `RouteMatch` literals that need `query: {}`. |
| [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) | The offline seam being extended: the pathname accessor pair (313-329), `writeHistoryPath` (568), and `ModelledDOMSource.getLocationPathname` (1117). |
| [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) | Where `getLocationSearch` goes: interface beside `getLocationPathname` (1153), implementation beside its production twin (2208). |
| [`packages/lib/docs/concepts/routing.md`](packages/lib/docs/concepts/routing.md) | The concept page; its `### Fragments` section (14-18) is the shape the new `### Query parameters` section follows. |
| [`packages/docs/src/main.ts`](packages/docs/src/main.ts) | The only real consumer's route registration — the `RouteHandler` arity change must leave its three-parameter handlers compiling. |

---

## Non-Goals

- **Typed or coerced query values.** `RouteQuery` is `Record<string, string>`, exactly like `RouteParams`. A consumer that wants a number parses it; the router never guesses types.
- **Repeated keys as arrays.** `?a=1&a=2` collapses to `{ a: "2" }`. A multi-value shape would make `RouteQuery` a different type from `RouteParams` for no case this feature has.
- **Query parameters in pattern matching or specificity.** Patterns match the path only. A route cannot be selected by, or require, a query parameter.
- **Reading or writing `location.search` in hash mode.** In hash mode `location.search` belongs to the page request, not the route.
- **A `setQuery` / `mergeQuery` mutator.** Changing only the query of the current route already composes: `router.navigate(router.getPath(), { query: { ...router.getQuery(), depth: "3" }, replace: true })`.
- **A `query` field on `RouterOptions`.** There is no construction-time query to seed; the URL is the source of truth.
- **Consumer wiring.** SQLAdmin's deep-linking work and any docs-app use of query parameters are separate plans that consume this API.
- **Build-configuration changes.** `@jimka/typescript-ui/router` is already a published subpath; `tsconfig.json`, `vite.config.ts`, `vite.lib.config.ts`, `package.json`, and `typedoc.json` are untouched.

---

## Notes

[^hash-embedded-query]: Hash mode has no `location.search` of its own to use. In a URL like `https://host/app/?build=42#/table/users`, the real `location.search` is `?build=42` — it belongs to the request the server answered, survives every in-app navigation, and is often set by the host page or a deployment. Writing route state into it would mean hash mode silently mutating something outside the route, and reading from it would mean the router picking up parameters it never wrote. Embedding the query inside the hash keeps the whole route — path and query — in the one place hash mode owns, and it is already the shape `normalizePath` anticipates by stripping from the first `"?"`. It also composes cleanly with hash mode's existing rule that fragments do not exist there: with no second `"#"` to worry about, the hash string is exactly `#/path?query`.

[^two-write-forms]: The read side needs `splitQuery` and `parseQuery` regardless, because that is how a query arrives from the URL — so accepting an embedded `"/x?a=1"` on the write side costs two lines in `getHref` and nothing anywhere else. Rejecting it was considered and dropped: once `getQuery()` exists, `navigate("/x?a=1")` silently dropping `a=1` is a trap, and it is the form a caller reaches for first. The explicit record is what a caller with typed values actually wants, and it gets percent-encoding for free instead of hand-building a string. Merging the two instead of replacing was rejected because merge has no obvious direction — a caller passing `{ b: "2" }` to override a link template's `?a=1` cannot express "and drop `a`", whereas replacement makes both outcomes reachable (`{ b: "2" }` to replace, `{ ...parsed, b: "2" }` to merge).

[^positional-query-on-gethref]: `navigate`'s second parameter is already an options bag carrying `replace`, and it must stay in that position for backward compatibility, so `query` joins the bag there. `getHref` has no options bag and `query` is the only thing it could take, so a bare positional parameter reads better in the link-building loops that call it — `getHref(path, { rotated: "true" })` rather than `getHref(path, { query: { rotated: "true" } })`. Giving `getHref` an options bag purely for symmetry was rejected as ceremony at the call site with no second option to justify it.

[^append-positional-handler-arg]: `RouteHandler` already grew this way once: the original hash-router plan defined it as `(params, path) => void`, and History-mode support appended `fragment` as a third argument. Appending `query` follows that precedent and keeps every existing handler compiling — TypeScript accepts a function of fewer parameters where one of more is expected, which is why `packages/docs/src/main.ts`'s three-parameter handlers need no edit. Replacing the positional list with a single `RouteMatch` argument was considered and rejected: it is cleaner in isolation but breaks every existing handler, and this plan's hard constraint is that a path-only route resolves today exactly as it did before.

[^hand-rolled-not-urlsearchparams]: `URLSearchParams` uses form encoding: it serializes a space as `+` and decodes `+` back to a space. The router encodes path segments and fragments with `encodeURIComponent`, which writes `%20`, so adopting `URLSearchParams` would put two different escaping rules in one URL. It also models a multi-map rather than the `Record<string, string>` that matches `RouteParams`, so every read would need a flattening pass with its own last-wins-or-first-wins decision. And `RoutePattern.ts` today references no platform global at all — it is a pure module of string functions, which is exactly what makes it testable with no environment. The four hand-rolled functions total about thirty lines and sit beside `splitFragment`, `normalizeBase`, `stripBase`, and `joinBase`, which were hand-rolled for the same reasons rather than reaching for `URL`.

[^plus-not-space]: The `+`-means-space convention comes from HTML form submission (`application/x-www-form-urlencoded`), not from the URI grammar, and it describes what a browser sends for a `<form>` — not a query string an application builds. Because `encodeURIComponent` escapes a literal plus to `%2B` and a space to `%20`, the router's own round trip is safe under either reading; what differs is how a hand-written or third-party URL like `?version=1+2` is interpreted. Reading it as a literal plus keeps `parseQuery` a straight `decodeURIComponent` with no format-specific special case, and matches what a query string outside a form post usually means. `URLSearchParams` takes the other reading, which is one of the reasons it is not used here.

[^no-key-sort]: Sorting keys was considered — it would make URLs canonical and let the "already here" check compare formatted strings, deleting `sameQuery`. It was rejected because a URL is something users read and share: a caller writing `{ rotated: "true", depth: "2" }` should see `?rotated=true&depth=2`, not a silently reordered `?depth=2&rotated=true`. Preserving order costs one four-line comparison function that is unit-testable in isolation.

[^navigate-through-gethref]: The alternative is appending the query suffix in two places. `navigate`'s hash branch and `getHref`'s hash branch compute byte-identical strings today — including the `#/` produced for the root path, where both yield `"#/"` — so routing one through the other changes no behaviour while removing the second copy the query suffix would otherwise have to be added to. History-mode `navigate` already builds its URL by calling `getHref`, so this makes both branches consistent.

[^normalize-path-via-splitquery]: `normalizePath` and `splitQuery` would otherwise each carry their own `indexOf("?")` cut, and they must agree — `getHref` feeds `splitQuery`'s `path` half straight into `normalizePath`, so a divergence would silently produce a path with a `?` still in it. The rewrite is behaviour-preserving by construction (same index, same slice) and the existing `normalizePath` test table, left untouched, is what proves it.

[^testdom-search-split]: Today `writeHistoryPath('/base/x?a=1')` leaves the whole string in the modelled `location.pathname`, which no real browser does — a real `pushState` splits the URL across `pathname`, `search`, and `hash`. That mismatch is invisible today only because `normalizePath` strips the query before anything looks at it. Once `getQuery()` reads `getLocationSearch()`, the modelled source has to split the URL the way the browser does or History-mode query tests would read an empty search forever. A grep of `packages/lib/tests` and `packages/docs/src` found no site that pushes a query-bearing URL and then reads the modelled pathname, so the correction regresses nothing.

[^dom-seams-list-topup]: The `globals` list on that line stops at `replaceLocationHash` — it was written when the router was hash-only and never updated for the three History-mode seam methods (`getLocationPathname`, `pushHistoryPath`, `replaceHistoryPath`) that the docs cutover added. Since this plan edits that sentence anyway to add `getLocationSearch`, adding the three omissions in the same edit makes the list correct rather than leaving it three names short.

---

## Implementation Notes

- **Step 8's checkpoint grep is not literally zero, and was never going to be.** `grep -rn '\blocation\b' packages/lib/src/typescript/lib/router/` reports 7 matches after this plan, all inside JSDoc prose describing `location.search` / `location.pathname` / `location.hash` in backticks — never actual code. The same grep against `master`, before this plan touched anything, already reports 4 matches for the same reason (e.g. `Router.ts`'s existing `navigate` and `getPath` doc comments). No line of *code* in `router/` reads the raw global; every read goes through `DOM.source.getLocation*()`, confirmed by grepping for `location.` outside comment lines. The checkpoint's real intent — catch a raw DOM read the lint rule can't — holds; its literal "zero matches" wording does not, and did not before this plan either.
- **The `#/split?depth=2` manual-verification step does not retain the query on initial load, in this demo.** `packages/lib/src/typescript/main.ts`'s `syncHashToTab` (driven by `Tab`'s `"select"` event, which fires identically for a user click and a programmatic `setActiveTabIndex` — see `Tab.ts:1014-1044`/`2074-2088` and `TabBar.ts:1693-1861`) always calls `router.navigate("/" + slug)` with no query. Since `start()` applies the route by calling `showSection` → `setActiveTabIndex`, that same "select" firing overwrites the hash immediately, stripping `?depth=2` before the first paint — not only on a later tab click, as the plan's manual-verification wording implied. Verified live: `location.hash` reads `"#/split"` immediately after navigating to `#/split?depth=2`, the Split tab renders correctly, and the console carries no errors — so the query correctly reaches `getQuery()`/the route handler before being clobbered by the demo's one-way sync. This is pre-existing behaviour of `main.ts`'s tab/hash wiring, not a Router defect, and fixing it is consumer wiring, which this plan's `## Non-Goals` explicitly excludes.
