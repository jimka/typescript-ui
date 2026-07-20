# Routing

[`Router`](/api/router/classes/Router) maps the URL hash (`#/settings`) to a single top-level app section — the tab a `Tab` layout manager shows, the region a `Card` reveals, whichever one slot your app switches between. It ships as its own subpath, `@jimka/typescript-ui/router`.

## Why hash mode

The router reads and writes only `location.hash`. That needs no server-side rewrite rule — a hash change never triggers a navigation request, so a plain static host works — and it is effectively required if the app might ever run outside a browser tab with a real address bar (an embedded/desktop shell, for instance). There is no `pushState` mode; see the plan's non-goals if you need one later.

## The surface

```typescript
import { Router } from '@jimka/typescript-ui/router';

const router = new Router({
    routes: {
        '/':         () => showDefaultSection(),
        '/:section': (params) => showSection(params.section),
    },
});

router.start();
```

- **`register(pattern, handler)`** — adds a route. The `routes` construction option calls this for you, keyed by pattern string.
- **`start()`** — reads the current hash, applies the matching route **synchronously**, then installs the `hashchange` listener. Call it once your app has built its component tree and *before* the first layout pass runs — layout in this framework is coalesced onto the next animation frame, so synchronous code at module scope always runs before that frame. Calling `start()` this late, rather than automatically, is what avoids a flash of the wrong section on load: applying the route any earlier finds nothing built yet to select, and applying it any later (e.g. on the first frame) means the default section has already painted.
- **`navigate(path, options?)`** — writes `path` into the hash. Pass `{ replace: true }` to replace the current history entry instead of pushing a new one.
- **`getPath()`** — the normalized path currently in the hash.
- **`stop()`** — removes the `hashchange` listener. Call it when the router itself is being torn down; an installed listener that is never removed leaks the router and everything its handlers close over.

## Handlers drive components — they don't build them

A route's handler is called with the extracted params and the normalized path. It should call into components your app already built — `setActiveTabIndex`, showing a `Card` child, and the like — never construct a fresh component tree per navigation. Rebuilding on every navigation would discard scroll position, focus, and expansion state; this is a retained-mode framework, so the tree a route "shows" should already exist and simply become visible.

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
router.on('navigate', (match) => console.log(match.pattern, match.params, match.path));
router.on('nomatch',  (path)  => console.warn('No route for', path));
```
