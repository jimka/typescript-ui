# Routing

[`Router`](/api/router/classes/Router) maps the URL hash or path to a single top-level app section — the tab a `Tab` layout manager shows, the region a `Card` reveals, whichever one slot your app switches between. It ships as its own subpath, `@jimka/typescript-ui/router`.

## Routing modes

`Router` has two modes, set once at construction via `RouterOptions.mode` and never changed afterward:

- **`"hash"`** (the default) — reads and writes only `location.hash` (`#/settings`). A hash change never triggers a navigation request, so this needs no server-side rewrite rule and works on any static host. It is effectively required if the app might ever run outside a browser tab with a real address bar (an embedded/desktop shell, for instance).
- **`"history"`** — reads and writes `location.pathname` via `pushState` / `replaceState`, so URLs are ordinary paths (`/settings`) instead of hash fragments. This needs the host to serve the app for every path, including ones with no file behind them, or a deep link 404s. On GitHub Pages that means installing a `404.html` that is a copy of `index.html`: Pages serves it for any unmatched path, the app boots, and it reads the real path itself. `RouterOptions.base` names the path prefix the site is served under (e.g. `"/typescript-ui/"`) so hrefs and parsed paths agree with where the app is actually deployed; it is ignored in hash mode.

`pushState` and `replaceState` fire no event — unlike a hash write, which fires `hashchange` for free. So in History mode, `navigate` applies the matching route itself immediately after writing the URL, rather than relying on a browser event to do it.

### Fragments

In History mode, `location.hash` is free to carry a real URL fragment alongside the path — the `#` isn't spent on the route the way it is in hash mode. `getFragment(href?)` reads it, without its leading `"#"`; called with no argument it reads the current URL. `getHref(path)` and `getPath(href?)` both understand a `#fragment` suffix on their input, splitting it off before working with the path and, for `getHref`, re-appending it (unencoded) to the built href. `navigate("/a#b")` treats a change in the fragment as a real navigation even when the path is unchanged — it writes the URL and calls the handler — and every route handler receives the fragment as its third argument, alongside `params` and `path`.

Hash mode discards fragments everywhere: the `#` is already the route, so there's nowhere to put a second one. `getFragment()` always returns `""` in hash mode, and any `#fragment` passed into `getHref` or `navigate` is silently dropped.

### Query parameters

A query parameter is a view-mode property layered on top of a route that already matched — a diagram's initial traversal depth, whether a table view opens rotated, which record index to focus. It never affects which pattern wins; patterns match the path only.

Where the query lives depends on the mode. In hash mode it is written and read inside the hash string itself — `#/table/users?rotated=true` — and `location.search` is never touched. In History mode the query is the real `location.search`, read through the DOM seam. Either way, the URL orders path, then `?query`, then `#fragment`.

`getQuery(href?)` reads it, decoded, with no argument reading the current URL — unlike `getFragment`, it is never hard-wired to `{}` in hash mode, since the query is real in both modes. `getHref(path, query?)` and `navigate(path, { query })` both accept a query embedded in `path` (`"/table/users?rotated=true"`) and an explicit record; when both are present, the explicit record **replaces** the embedded one entirely rather than merging with it — an explicit `{}` still clears whatever `path` embedded.

Keys and values are percent-encoded on write and percent-decoded on read; a duplicate key resolves to its last occurrence.

```typescript
router.getHref('/table/users', { rotated: 'true' }); // "#/table/users?rotated=true"
router.navigate('/concepts/sizing', { query: { depth: '2' } });
router.getQuery(); // { depth: '2' }
```

## The surface

```typescript
import { Router } from '@jimka/typescript-ui/router';

const router = new Router({
    mode: 'history',
    base: '/typescript-ui/',
    routes: {
        '/':         () => showDefaultSection(),
        '/:section': (params) => showSection(params.section),
    },
});

router.start();
```

- **`register(pattern, handler)`** — adds a route. The `routes` construction option calls this for you, keyed by pattern string.
- **`start()`** — reads the current hash or path, applies the matching route **synchronously**, then installs the `hashchange` (hash mode) or `popstate` (History mode) listener. Call it once your app has built its component tree and *before* the first layout pass runs — layout in this framework is coalesced onto the next animation frame, so synchronous code at module scope always runs before that frame. Calling `start()` this late, rather than automatically, is what avoids a flash of the wrong section on load: applying the route any earlier finds nothing built yet to select, and applying it any later (e.g. on the first frame) means the default section has already painted.
- **`navigate(path, options?)`** — writes `path` into the hash or, in History mode, into `location.pathname`. Pass `{ replace: true }` to replace the current history entry instead of pushing a new one, and `{ query }` to set the query explicitly (see [Query parameters](#query-parameters)). Navigating to the path (and, in History mode, fragment and query) already current is a same-value write: no history entry is written and no handler re-runs.
- **`getHref(path, query?)`** — the href an `<a>` for `path` should carry, in this router's mode and base: a `"#/…"` fragment in hash mode, a base-joined path in History mode. Build every link through this method rather than concatenating the mode's URL shape by hand, so a mode change never needs a second place fixed.
- **`getPath(href?)`** — the route path for `href`, or — with no argument — for the current URL, read through the DOM seam. The inverse of `getHref`.
- **`getQuery(href?)`** — the query parameters for `href`, or — with no argument — for the current URL, decoded (see [Query parameters](#query-parameters)).
- **`stop()`** — removes the `hashchange` / `popstate` listener. Call it when the router itself is being torn down; an installed listener that is never removed leaks the router and everything its handlers close over.

## Handlers drive components — they don't build them

A route's handler is called with the extracted params, the normalized path, the fragment, and the query. It should call into components your app already built — `setActiveTabIndex`, showing a `Card` child, and the like — never construct a fresh component tree per navigation. Rebuilding on every navigation would discard scroll position, focus, and expansion state; this is a retained-mode framework, so the tree a route "shows" should already exist and simply become visible.

## Pattern specificity

Patterns are matched by segment, left to right, and the router always picks the **most specific** match — never the first-registered one, so import order can't change which handler wins. A static segment beats a `:param` at the same position, which beats a trailing `*`:

```typescript
router.register('/data/rows',      showRowsOverview);
router.register('/data/:id',       showRecord);
```

Both patterns match `#/data/rows`, but `/data/rows` is more specific and wins; `#/data/42` matches only `/data/:id`. Two patterns that would rank equally (e.g. `/users/:id` and `/users/:name` — same shape, different param name) collapse onto the same registration slot: the second one replaces the first and logs a `Router:`-prefixed warning, since that collision is almost always a typo rather than an intentional override.

## Extracting params

A `:name` segment captures that path segment under `name` in the handler's `params` argument, percent-decoded:

```typescript
router.register('/data/rows/:sel', (params) => {
    console.log(params.sel); // "5" for "#/data/rows/5"
});
```

## Listening for navigation

```typescript
router.on('navigate', (match) => console.log(match.pattern, match.params, match.path, match.query));
router.on('nomatch',  (path)  => console.warn('No route for', path));
```
