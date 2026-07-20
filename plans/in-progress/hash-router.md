---
touches-shared: [packages/lib/src/typescript/lib/core/DOM.ts, packages/lib/package.json, packages/lib/tsconfig.json, packages/lib/vite.config.ts, packages/lib/vite.lib.config.ts, packages/lib/typedoc.json]
---

# Hash Router — Implementation Plan

## Overview

A `Router` that maps the URL hash (`#/settings`) to a single top-level app section. Patterns are registered with `register("/data/rows/:sel", handler)`; the router picks the **most specific** matching pattern, extracts `:param` values, and calls that pattern's handler. The handler drives components that already exist — it never builds them.

The router ships as a new subpath barrel, `@jimka/typescript-ui/router`, holding two source files plus an `index.ts`. It contains no `Component` code and touches no elements. Its only contact with the browser is the URL hash and one `hashchange` listener, both through the existing DOM seam ([packages/lib/src/typescript/lib/core/DOM.ts:2109](packages/lib/src/typescript/lib/core/DOM.ts#L2109)), so the whole feature is testable offline under the `node` test environment.

Applying the first route is explicit: the app calls `router.start()` after it has built its component tree and before the first layout pass runs. Everything else the plan touches is configuration — the five build files a new subpath barrel needs, the docs pages, and the capability manifest.

---

## Architecture Decisions

### The `Router` is a plain class with an options bag, not a `callable()`-wrapped one

`Router` follows [`AbstractStore`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L163): a non-`Component` class with an `XOptions` bag, a `listeners?` map in that bag, a private `ListenerBag`, and typed `on` / `off` / `protected emit` forwarders ([AbstractStore.ts:136](packages/lib/src/typescript/lib/data/AbstractStore.ts#L136), [:178](packages/lib/src/typescript/lib/data/AbstractStore.ts#L178), [:1776](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1776)). Construction is `new Router({ routes: { … } })`.[^no-callable]

### `start()` / `stop()` is the lifecycle pair, and `start()` is what applies the initial route

`start()` reads the current hash, applies the matching route synchronously, then installs the `hashchange` listener. `stop()` removes the listener. The pair mirrors [`AutoRepeat`](packages/lib/src/typescript/lib/core/AutoRepeat.ts#L59).

The app calls `start()` from module scope, after building its tree. That placement is what prevents the flash: layout in this framework is coalesced onto one animation frame — `scheduleLayout()` ([Component.ts:5043](packages/lib/src/typescript/lib/core/Component.ts#L5043)) queues into a module-level set that `flushPendingLayouts` ([Component.ts:165](packages/lib/src/typescript/lib/core/Component.ts#L165)) drains on the next `requestAnimationFrame`. Synchronous module-scope code therefore runs entirely before the first layout pass, so the routed section is already selected when that pass runs.[^start-timing]

### `hashchange` goes through `DOM.sink.addListener`, not the `Event` class

The `Event` class has no window-level surface a non-`Component` can use: `Event.addViewportListener` takes a `Component` as its first argument and keys its bucket by `component.getId()` ([Event.ts:424](packages/lib/src/typescript/lib/core/Event.ts#L424)). `Router` uses `DOM.sink.addListener(DOM.source.getWindow(), "hashchange", …)` — the same call `Event` itself makes at [Event.ts:435](packages/lib/src/typescript/lib/core/Event.ts#L435), and the escape hatch ARCHITECTURE.md sanctions for "primitives that need a native hook the Event API cannot model today".[^event-gap]

### Hash reading and writing become three new DOM-seam methods

`DOMSource` gains `getLocationHash()`; `DOMSink` gains `setLocationHash(hash)` and `replaceLocationHash(hash)`. This mirrors `matchMedia` ([DOM.ts:1029](packages/lib/src/typescript/lib/core/DOM.ts#L1029)), which boxes a browser global into a seam method so the live object never escapes.[^location-in-seam]

### Match resolution ranks by specificity, computed from segment kinds

Patterns are compared segment by segment from the left. Reaching the end of a pattern outranks a static segment, which outranks a `:param`, which outranks a trailing `*`. The first position where two patterns differ decides. Registration order never affects the result.[^specificity]

Ties are impossible at match time because the route table is keyed by the pattern's *normalized* form — static segments by their literal text, `:param` as `:`, `*` as `*`. Two patterns that would rank equally collapse onto the same key, so registering the second one replaces the first and logs a warning.[^ambiguity-key]

### Warnings use bare `console.warn` prefixed with `Router:`

The library's warning convention is a bare `console.warn` whose message starts with the emitting class or function name — [`Grid.ts:1036`](packages/lib/src/typescript/lib/layout/Grid.ts#L1036), [`Popover.ts:751`](packages/lib/src/typescript/lib/overlay/Popover.ts#L751). There is no logging abstraction to route through.

### The demo drives the existing `Tab` layout manager

The demo app already puts a `Tab` on `Body` with 28 lazy sections ([main.ts:44](packages/lib/src/typescript/main.ts#L44)). The worked example routes to that `Tab` via `setActiveTabIndex` ([Tab.ts:1824](packages/lib/src/typescript/lib/layout/Tab.ts#L1824)) and syncs the hash back from its `"activate"` event ([Tab.ts:2135](packages/lib/src/typescript/lib/layout/Tab.ts#L2135)). No `Card` is introduced.[^demo-tab]

---

## Public API

### `packages/lib/src/typescript/lib/router/RoutePattern.ts`

Pure functions and types. Not exported from the barrel — internal mechanics, imported directly by the tests, exactly as `validation/Validator.ts` is ([validation/index.ts](packages/lib/src/typescript/lib/validation/index.ts) omits `applyRule`).

```typescript
export type SegmentKind = "static" | "param" | "catchAll";

export interface RouteSegment {
    kind:  SegmentKind;
    /** Literal text for "static", the parameter name for "param", "" for "catchAll". */
    value: string;
}

export interface CompiledPattern {
    /** The pattern string as registered, after normalization (e.g. "/data/:id"). */
    pattern:  string;
    /** Ambiguity key: static segments by literal, "param" as ":", "catchAll" as "*". */
    key:      string;
    segments: RouteSegment[];
}

/** Normalizes a hash or path to a leading-slash, no-trailing-slash path. */
export function normalizePath(input: string): string;

/** Splits a normalized path into its non-empty segments. */
export function splitPath(path: string): string[];

/** Parses a pattern into segments. Throws on a non-final "*". */
export function compilePattern(pattern: string): CompiledPattern;

/** Returns extracted params when `segments` match `compiled`, else null. */
export function matchPattern(compiled: CompiledPattern, segments: string[]): Record<string, string> | null;

/** Returns the highest-ranked matching pattern, or null when none match. */
export function selectPattern<T extends CompiledPattern>(
    compiled: readonly T[],
    path:     string,
): { compiled: T; params: Record<string, string> } | null;
```

### `packages/lib/src/typescript/lib/router/Router.ts`

```typescript
export type RouteParams  = Record<string, string>;
export type RouteHandler = (params: RouteParams, path: string) => void;
export type RouterEvent  = "navigate" | "nomatch";

export interface RouteMatch {
    /** The pattern that won, as registered. */
    pattern: string;
    params:  RouteParams;
    /** The normalized path that was matched. */
    path:    string;
}

export interface RouterOptions {
    /** Patterns to `register` at construction, keyed by pattern string. */
    routes?:    Record<string, RouteHandler>;
    listeners?: Partial<{
        navigate: (match: RouteMatch) => void;
        nomatch:  (path: string) => void;
    }>;
}

export class Router {
    constructor(options?: RouterOptions);

    register(pattern: string, handler: RouteHandler): this;

    /** Reads the current hash, applies the matching route, installs the listener. */
    start(): this;

    /** Removes the `hashchange` listener. Safe to call when never started. */
    stop(): this;

    navigate(path: string, options?: { replace?: boolean }): this;

    /** The normalized path currently in the hash. */
    getPath(): string;

    on(event: "navigate", listener: (match: RouteMatch) => void): this;
    on(event: "nomatch",  listener: (path: string) => void): this;
    off(event: RouterEvent, listener: Function): this;

    protected emit(event: RouterEvent, payload: unknown): void;
    protected applyOptions(options: RouterOptions): void;
}
```

### `packages/lib/src/typescript/lib/core/DOM.ts` additions

```typescript
// on DOMSource
/** The current `location.hash`, including the leading "#", or "" when empty. */
getLocationHash(): string;

// on DOMSink
/** Assigns `location.hash`, pushing a history entry. */
setLocationHash(hash: string): void;

/** Replaces the current history entry with one carrying `hash`. */
replaceLocationHash(hash: string): void;
```

---

## Internal Structure

### Router state

```typescript
private _routes:    Map<string, CompiledRoute> = new Map();   // keyed by CompiledPattern.key
private _listeners: ListenerBag<RouterEvent>   = new ListenerBag<RouterEvent>();
private _started:   boolean                    = false;

// Stable reference so add/remove pair up; delegates to a named method, per the
// Popover._onScroll pattern (Popover.ts:164 / :201).
private readonly _onHashChange: () => void = () => this.handleHashChange();
```

`CompiledRoute` is `CompiledPattern & { handler: RouteHandler }`.

### Ranking comparator

```typescript
const KIND_RANK: Record<SegmentKind, number> = { static: 2, param: 1, catchAll: 0 };

/** Rank of position `i`. Past the end of the pattern outranks every real kind. */
function rankAt(segments: readonly RouteSegment[], i: number): number {
    return i >= segments.length ? 3 : KIND_RANK[segments[i].kind];
}
```

`selectPattern` filters to the patterns that match, then reduces them by walking `i` from `0` to the longer pattern's length and returning the first pattern whose `rankAt(i)` is higher. Two patterns cannot tie on every position — that would mean identical keys, which the route table forbids.

The past-the-end rank of `3` is what makes `/a/b` beat `/a/b/*` for the exact path `/a/b`: they tie on positions 0 and 1, and at position 2 the shorter pattern has ended (3) while the longer one offers a catch-all (0).

### Normalization rules

`normalizePath` applies, in order: strip a leading `#`; strip everything from the first `?` onward and discard it; split on `/`; drop empty segments; rejoin with a leading `/`. `""`, `"#"`, and `"#/"` all normalize to `"/"`.

Captured `:param` values are passed through `decodeURIComponent` inside a `try` / `catch`; a malformed escape falls back to the raw segment text. `navigate` encodes each segment with `encodeURIComponent` before writing.

---

## Ordered Implementation Steps

1. **`packages/lib/src/typescript/lib/core/DOM.ts`** — add `getLocationHash()` to the `DOMSource` interface (near `getWindow` at [line 1046](packages/lib/src/typescript/lib/core/DOM.ts#L1046)) and `setLocationHash` / `replaceLocationHash` to the `DOMSink` interface (near `addListener` at [line 627](packages/lib/src/typescript/lib/core/DOM.ts#L627)). Implement all three on `ProductionDOMSource` / `ProductionDOMSink`: `location.hash`, `location.hash = hash`, and `location.replace(...)` composed from `location.href` with its hash swapped. Verify: `npm run typecheck` in `packages/lib`.

2. **`packages/lib/tests/dom/TestDOM.ts`** — add the same three methods to the recording sink and modelled source, backed by one private `_locationHash` string on the shared handle table. `setLocationHash` and `replaceLocationHash` both write the field, record the call, and — only when the new value differs from the old — dispatch a modelled `hashchange` at the window handle through the existing `dispatchEvent` path ([TestDOM.ts:470](packages/lib/tests/dom/TestDOM.ts#L470)). Verify: `npx vitest run tests/dom` passes.

3. **Create `packages/lib/src/typescript/lib/router/RoutePattern.ts`** with the signatures under `## Public API`. Pure — no imports from `~/core`.

4. **Create `packages/lib/tests/unit/router/RoutePattern.test.ts`** covering every case in `## Expected Behaviour` marked *unit*. Write these before step 5's logic is finalised. Verify: `npx vitest run tests/unit/router`.

5. **Create `packages/lib/src/typescript/lib/router/Router.ts`** per `## Public API` and `## Internal Structure`. The constructor body calls `this.applyOptions(options)` after all field initializers — never from a field initializer.

6. **Create `packages/lib/tests/unit/router/Router.test.ts`** using `installTestDOM` from `tests/dom/TestDOM.ts` (see [tests/dom/events.test.ts](packages/lib/tests/dom/events.test.ts) for the setup shape), with `afterEach(() => DOM.reset())`.

7. **Create `packages/lib/src/typescript/lib/router/index.ts`** — SPDX header, then `export { Router } from '~/router/Router.js';` and `export type { RouteParams, RouteHandler, RouterEvent, RouteMatch, RouterOptions } from '~/router/Router.js';`. Mirror [validation/index.ts](packages/lib/src/typescript/lib/validation/index.ts).

8. **`packages/lib/tsconfig.json`** — add `"@jimka/typescript-ui/router": ["./src/typescript/lib/router/index.ts"]` to `paths`, alongside the `validation` entry.

9. **`packages/lib/vite.config.ts`** — add `{ find: '@jimka/typescript-ui/router', replacement: sub('router/index.ts') }` to `resolve.alias`, after the `validation` line.

10. **`packages/lib/vite.lib.config.ts`** — add the same alias to `resolve.alias` (after the `validation` line) **and** `'router': r('router/index.ts')` to `build.lib.entry`. Both are required; the alias alone does not produce a bundle.

11. **`packages/lib/package.json`** — add a `"./router"` key to `exports` pointing at `./dist/lib/router.es.js` and `./dist/lib/types/router/index.d.ts`, matching the `"./validation"` entry's shape.

12. **Checkpoint** — `grep -c "router" packages/lib/package.json packages/lib/tsconfig.json packages/lib/vite.config.ts packages/lib/vite.lib.config.ts` must report a non-zero count for **all four** files (a zero anywhere means a config file was missed). Then `npm run typecheck` and `npm run test` in `packages/lib`.

13. **`packages/lib/typedoc.json`** — add `"src/typescript/lib/router/index.ts"` to `entryPoints`. Without this the manifest generator cannot resolve the `Router` symbol and `docs:llms` fails.

14. **Create `packages/lib/docs/concepts/routing.md`** — see `## Documentation Impact`.

15. **`packages/lib/docs/.vitepress/config.mts`** — add `{ text: 'Routing', link: '/concepts/routing' }` to the `'/concepts/'` sidebar array, after the `Data binding` entry ([config.mts:55](packages/lib/docs/.vitepress/config.mts#L55)).

16. **`packages/lib/docs/concepts/index.md`** — add a bullet to the `## Pages` list, after the Data binding line.

17. **`packages/lib/docs/concepts/dom-seams.md`** — extend the category list at [line 63](packages/lib/docs/concepts/dom-seams.md#L63) so `globals` reads `matchMedia / requestAnimationFrame / getActiveElement / getDocumentElement / getLocationHash / setLocationHash / replaceLocationHash`.

18. **`packages/lib/scripts/llms/manifest.data.mjs`** — add a new group after `"Data layer"`:

    ```javascript
    { name: "App shell", entries: [
        { task: "Map the URL hash to a top-level app section", symbol: "Router", doc: "docs/concepts/routing.md" },
    ] },
    ```

    Never edit `packages/lib/llms.txt` — it is generated. Verify: `npm run docs:api && npm run docs:llms` in `packages/lib`, then `grep -n 'Router' packages/lib/llms.txt`.

19. **`packages/lib/src/typescript/main.ts`** — wire the worked example (see `## Worked Example`). Place the `Router` construction and the `router.start()` call after the last section registration ([main.ts:74](packages/lib/src/typescript/main.ts#L74)) and **before** `await store.load()` ([main.ts:93](packages/lib/src/typescript/main.ts#L93)); the `await` yields to the event loop and lets the first layout frame run.

20. **Final verification** — run everything under `## Verification`.

---

## Worked Example

All of this lands in `packages/lib/src/typescript/main.ts`.

Two edits are involved. First, replace each of the 28 `layoutManager.addLazyTab(factory, label)` calls ([main.ts:47-74](packages/lib/src/typescript/main.ts#L47)) with `addSection(factory, label)`, a local helper that records the slug and forwards. Deriving the slug list this way rather than writing it out separately is what keeps the two lists from drifting. Second, add the router wiring below them.

```typescript
import { Component, Body, DOM, FocusHistory } from '@jimka/typescript-ui/core';
import { Router, type RouteParams } from '@jimka/typescript-ui/router';

// Tab labels carry punctuation and spaces ("Misc.", "Layout I/O"); slugify them
// into stable URL segments and index them so a route can select by name.
function slugify(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const slugs: string[] = [];

function addSection(factory: () => Component, label: string): void {
    slugs.push(slugify(label));
    layoutManager.addLazyTab(factory, label);
}

// ... addSection(() => new MiscPanel(), "Misc."); and 28 more ...

function showSection(params: RouteParams): void {
    const index = slugs.indexOf(params.section);

    if (index >= 0) {
        layoutManager.setActiveTabIndex(index);
    }
}

function showDefaultSection(): void {
    layoutManager.setActiveTabIndex(0);
}

function syncHashToTab(_content: Component, index: number): void {
    router.navigate("/" + slugs[index]);
}

const router = new Router({
    routes: {
        "/":         showDefaultSection,
        "/:section": showSection,
    },
});

layoutManager.on("activate", syncHashToTab);
router.start();
```

The two directions do not loop. `start()` applies the route, which calls `setActiveTabIndex`, which fires `"activate"`, which calls `navigate` with the path already in the hash — writing an unchanged hash fires no `hashchange` and adds no history entry, so the cycle stops there.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Create | `packages/lib/src/typescript/lib/router/RoutePattern.ts` |
| Create | `packages/lib/src/typescript/lib/router/Router.ts` |
| Create | `packages/lib/src/typescript/lib/router/index.ts` |
| Create | `packages/lib/tests/unit/router/RoutePattern.test.ts` |
| Create | `packages/lib/tests/unit/router/Router.test.ts` |
| Create | `packages/lib/docs/concepts/routing.md` |
| Modify | `packages/lib/src/typescript/lib/core/DOM.ts` |
| Modify | `packages/lib/tests/dom/TestDOM.ts` |
| Modify | `packages/lib/tsconfig.json` |
| Modify | `packages/lib/vite.config.ts` |
| Modify | `packages/lib/vite.lib.config.ts` |
| Modify | `packages/lib/package.json` |
| Modify | `packages/lib/typedoc.json` |
| Modify | `packages/lib/docs/.vitepress/config.mts` |
| Modify | `packages/lib/docs/concepts/index.md` |
| Modify | `packages/lib/docs/concepts/dom-seams.md` |
| Modify | `packages/lib/scripts/llms/manifest.data.mjs` |
| Modify | `packages/lib/src/typescript/main.ts` |

---

## Expected Behaviour

### Path normalization — *unit*

| Input | `normalizePath` result |
|---|---|
| `""` | `/` |
| `"#"` | `/` |
| `"#/"` | `/` |
| `"#/settings"` | `/settings` |
| `"#/settings/"` | `/settings` |
| `"settings"` | `/settings` |
| `"#/a//b"` | `/a/b` |
| `"#/settings?tab=advanced"` | `/settings` |
| `"#/?x=1"` | `/` |

### Pattern compilation — *unit*

- `compilePattern("/data/rows/:sel")` yields segments `[static "data", static "rows", param "sel"]` and key `data/rows/:`.
- `compilePattern("/users/:id")` and `compilePattern("/users/:name")` produce the **same** key `users/:`.
- `compilePattern("/a/:x")` and `compilePattern("/b/:y")` produce **different** keys.
- `compilePattern("/files/*")` yields a trailing `catchAll` segment and key `files/*`.
- `compilePattern("/*/edit")` throws — `*` is only valid as the final segment.

### Matching and param extraction — *unit*

- `/data/rows/:sel` against `/data/rows/42` yields `{ sel: "42" }`.
- `/data/rows/:sel` against `/data/rows` yields `null` (segment counts differ).
- `/data/rows/:sel` against `/data/rows/42/extra` yields `null`.
- `/` against `/` yields `{}`; `/` against `/settings` yields `null`.
- `/files/*` against `/files`, `/files/a`, and `/files/a/b/c` all match, yielding `{}`.
- `/users/:id` against `/users/a%20b` yields `{ id: "a b" }`.
- `/users/:id` against `/users/%zz` yields `{ id: "%zz" }` — the malformed escape falls back to the raw segment rather than throwing.

### Specificity ranking — *unit*

Each case passes the two compiled patterns to `selectPattern` in **both** array orders and asserts the same winner, which is what pins the order-independence:

- `/data/rows` beats `/data/:id` for path `/data/rows`.
- `/data/:id` wins for `/data/99` (the static pattern does not match).
- `/data/rows/:sel` beats `/data/:id/:sel` for `/data/rows/7`.
- `/data/:id/edit` beats `/data/:id/:action` for `/data/9/edit`.
- `/files/*` beats `/*` for `/files/x`.
- `/data/rows` beats `/*` for `/data/rows`.
- `/a/b/c` beats `/a/b/*` for `/a/b/c`.
- `/a/b` beats `/a/b/*` for `/a/b` — both match, and the pattern that has ended wins over a catch-all.
- `selectPattern([], "/anything")` returns `null`.

### Ambiguity warning — *unit*

- Registering `/users/:id` then `/users/:name` logs exactly one `console.warn` starting with `Router:`, naming both patterns. The second handler wins; the table holds one entry.
- Registering `/users/:id` twice with different handlers logs **no** warning (identical pattern string — a plain replace). The second handler wins.
- Registering `/a/:x` then `/b/:y` logs no warning; both entries survive.

### Router lifecycle and navigation — *unit, via `installTestDOM`*

- Hash `#/settings` present before `start()`: `start()` invokes the `/settings` handler synchronously and emits `"navigate"` with `{ pattern: "/settings", params: {}, path: "/settings" }`.
- Empty hash before `start()`: the `/` handler runs.
- Hash matching no pattern: no handler runs; `"nomatch"` is emitted with the normalized path.
- After `start()`, a modelled `hashchange` to `#/data/rows/5` invokes the `/data/rows/:sel` handler with `{ sel: "5" }`.
- `navigate("/settings")` writes `#/settings` via `setLocationHash`; `navigate("/settings", { replace: true })` routes through `replaceLocationHash` instead.
- `navigate` to the path already in the hash writes the same value, so no `hashchange` fires and no handler re-runs.
- `navigate("/a b")` writes `#/a%20b`.
- `navigate` on a router that was never started still writes the hash; no handler runs.
- `start()` on an already-started router logs one `Router:` warning and does not install a second listener.
- `stop()` removes the `hashchange` listener — a subsequent modelled `hashchange` invokes no handler. Assert against the sink's `removeListener` record.
- `stop()` on a never-started router is a silent no-op.
- `getPath()` returns the normalized current path.
- `on` / `off` with the same function reference registers and removes exactly one listener; listeners fire in registration order.
- The `listeners` bag in `RouterOptions` registers the same way `on` does.

### Manual browser verification

Run `npm run dev` in `packages/lib` and open http://localhost:8015.

- Loading `#/split` shows the Split tab **on the first painted frame** — no visible flash of the default Misc. tab. Watch at normal speed, then confirm with a throttled reload.
- Loading with no hash shows Misc.
- Clicking through several tabs updates the hash each time; the browser Back button walks back through them and the tab strip follows.
- Forward re-advances through the same sequence.
- Loading `#/nonexistent` leaves Misc. selected and produces no console error.
- Editing the hash by hand in the address bar switches tabs.

---

## Verification

Run from `packages/lib`:

- `npm run typecheck` and `npm run typecheck:test` — clean.
- `npm run test` — the new `tests/unit/router/` suites pass; nothing else regresses.
- `npm run lint` — clean. The `local/no-raw-dom` rule exempts only `core/DOM.ts` ([eslint.config.js:88](packages/lib/eslint.config.js#L88)), so a stray `window` or `document` reference inside `router/` fails here.
- `grep -rn '\blocation\b' packages/lib/src/typescript/lib/router/` — expect zero matches. A bare `location` is **not** in the lint rule's global-identifier set, so lint will not catch it; this grep is the guard.
- `npm run build:lib` — emits `dist/lib/router.es.js` and `dist/lib/types/router/index.d.ts`. Confirm both exist.
- `npm run docs:build` — completes with **zero** TypeDoc warnings, and `packages/lib/llms.txt` regenerates with a `Router` row under `### App shell`.
- The manual browser checks above.

---

## Documentation Impact

- **Barrel**: `Router` and its types are exported from `packages/lib/src/typescript/lib/router/index.ts`, reachable as `@jimka/typescript-ui/router`. `RoutePattern.ts` stays internal.
- **API reference**: generated by TypeDoc from the new entry point (step 13). The VitePress API sidebar is read from the generated `docs/api/typedoc-sidebar.json`, so it needs no manual edit.
- **Concept page**: `packages/lib/docs/concepts/routing.md`, sitting alongside [`data-binding.md`](packages/lib/docs/concepts/data-binding.md). It must cover: hash mode and why (no server rewrite needed); the `register` / `start` / `navigate` surface; the specificity rule with the `/data/rows` vs `/data/:id` example; `:param` extraction; why `start()` is explicit and where an app should call it; that handlers drive existing components rather than building them; and `stop()` for teardown.
- **Catalog entries**: the sidebar entry (step 15) and the `docs/concepts/index.md` bullet (step 16).
- **JSDoc constraint**: per CODE_CONVENTIONS.md, public JSDoc may only `{@link}` symbols that appear in the rendered docs. `Router`'s JSDoc must not link `compilePattern`, `selectPattern`, or `ListenerBag` internals — describe them in prose.
- **Capability manifest**: `scripts/llms/manifest.data.mjs` only (step 18). `llms.txt` is generated.

---

## Potential Challenges

- **The subpath barrel needs all five build files edited by hand, not a wildcard.** `tsconfig.json`, `vite.config.ts`, `vite.lib.config.ts` (alias *and* entry — two edits in that one file), `package.json` `exports`, and `typedoc.json` each need an explicit `router` line. Step 12's grep checkpoint catches a miss before it turns into a confusing resolution failure.
- **`start()` placed after a top-level `await` reintroduces the flash.** `await` yields to the event loop, letting the layout frame run with the default section. Keep `router.start()` above `await store.load()` in `main.ts`.
- **A `hashchange` listener added but never removed leaks the `Router` and everything its handlers close over** — the same shape as the `ThemeManager` listener leak. `stop()` is the only release, and the `Router.test.ts` case asserting `removeListener` was recorded is what keeps it honest.
- **The `hashchange` handler must be a stable reference.** A fresh arrow per `addListener` call cannot be removed. Store it in one `readonly` field that delegates to a named method, as `Popover._onScroll` does ([Popover.ts:201](packages/lib/src/typescript/lib/overlay/Popover.ts#L201)).
- **The modelled `hashchange` fires synchronously; the browser's does not.** In `TestDOM` the handler runs inside the `setLocationHash` call, whereas a browser delivers `hashchange` on a later task. Assertions of the form "after `navigate`, the handler has run" hold in both, so no test needs to care — but do not write a test that depends on the handler *not* having run yet.
- **`docs:build` needs headroom.** The script pins `NODE_OPTIONS=--max-old-space-size=12288`; on a memory-constrained machine it can be OOM-killed (exit 137). Free memory rather than raising the limit.

---

## Critical Files

| File | Why |
|---|---|
| [`packages/lib/src/typescript/lib/data/AbstractStore.ts`](packages/lib/src/typescript/lib/data/AbstractStore.ts) | The precedent for the whole class shape — options bag, `listeners` map, `ListenerBag`, `on`/`off`/`emit`, `applyOptions` (lines 136, 147, 178, 245, 1776, 1791, 1803). |
| [`packages/lib/src/typescript/lib/core/AutoRepeat.ts`](packages/lib/src/typescript/lib/core/AutoRepeat.ts) | A non-`Component` plain class with a `start()`/`stop()` pair; its class JSDoc (lines 28-31) states the no-`callable()` rule. |
| [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) | Where the three location methods go; `matchMedia` (line 1029) and `MediaQueryResult` (line 1281) are the boxing precedent. |
| [`packages/lib/src/typescript/lib/core/Event.ts`](packages/lib/src/typescript/lib/core/Event.ts) | Line 424 shows why `Router` cannot use the `Event` class; line 435 is the sanctioned window-listener call to copy. |
| [`packages/lib/src/typescript/lib/core/ListenerBag.ts`](packages/lib/src/typescript/lib/core/ListenerBag.ts) | The `add`/`remove`/`fire` delegate behind `on`/`off`/`emit`. |
| [`packages/lib/src/typescript/lib/validation/index.ts`](packages/lib/src/typescript/lib/validation/index.ts) | The smallest existing barrel — copy its shape for `router/index.ts`. |
| [`packages/lib/tests/dom/TestDOM.ts`](packages/lib/tests/dom/TestDOM.ts) | The offline seam being extended; `addListener` (line 438) and `dispatchEvent` (line 470) are the hooks the modelled `hashchange` rides. |
| [`packages/lib/tests/dom/events.test.ts`](packages/lib/tests/dom/events.test.ts) | The setup/teardown shape for a seam-driven test. |
| [`packages/lib/src/typescript/lib/layout/Tab.ts`](packages/lib/src/typescript/lib/layout/Tab.ts) | `addLazyTab` (1406), `setActiveTabIndex` (1824), `getActiveTabIndex` (1749), `on("activate")` (2135) — the demo's driving surface. |
| [`packages/lib/src/typescript/main.ts`](packages/lib/src/typescript/main.ts) | Where the worked example lands; note the `await` at line 93. |
| [`packages/lib/scripts/llms/manifest.data.mjs`](packages/lib/scripts/llms/manifest.data.mjs) | The only hand-edited manifest file; the entry shape is documented at line 12. |

---

## Non-Goals

- **History / `pushState` mode.** Hash mode needs no server rewrite rules and is effectively required if the Tauri desktop work in `plans/tauri-desktop-*.md` proceeds. Nothing in this design forecloses adding a mode option later: `RoutePattern.ts` is mode-agnostic, and only `Router`'s three seam calls would branch.
- **Nested routes.** Exactly one routable slot. A pattern's full path maps to one top-level section.
- **Bidirectional component binding.** A `bind(component, key)` / `Routable` interface layer buys nothing at one nesting level. The seam if it is ever wanted: a `bind` method that registers a pattern whose handler drives the component, and subscribes to the component's own `on()` event to call `navigate` — the `layoutManager.on("activate", syncHashToTab)` line in the worked example is that pairing written by hand.
- **Query parameters.** `normalizePath` discards everything from the first `?`, so `#/settings?tab=advanced` matches `/settings` today. Parsing and exposing that tail is a purely additive later change.
- **A route-to-component factory.** Rebuilding a component tree per navigation would discard scroll position, focus, and expansion state in a retained-mode framework. Lazy instantiation is already `TabPanel.addLazyTab`'s job ([TabPanel.ts:134](packages/lib/src/typescript/lib/component/container/TabPanel.ts#L134)).
- **Routing overlays, dialogs, and floating windows.** They are transient and layered, not sections.
- **An app-ready / loading gate.** The initial-route application would pair naturally with a "wait for fonts and theme before first paint" gate, but that idea is deferred and this plan does not depend on it. `start()` being app-called means such a gate could later call it at the right moment with no change to `Router`.
- **`unregister`.** No caller needs it.

---

## Notes

[^no-callable]: `callable()` is generic over any constructor, so wrapping `Router` would work — but the library reserves it for `Component` subclasses. ARCHITECTURE.md scopes the rule that way ("Every `Component` subclass must be wrapped"), the whole `data/` barrel exports plain classes, and `AutoRepeat`'s class JSDoc states the reason outright: "It is a plain class (no DOM element, so not `callable()`-wrapped)". The `Router({ … })` call form was considered and dropped for that consistency; `new Router({ … })` keeps the router looking like the `Store` it most resembles. The options-bag half of the idiom is kept in full.

[^start-timing]: Two alternatives were rejected. Applying the route from the constructor runs before the app has registered its sections, so nothing is there to select. Applying it automatically on the first animation frame runs *after* the default section has already been laid out and painted, which is the flash. Explicit `start()` puts control at the one point where the tree exists and no frame has run. Note the interaction with the deferred-setter traps this codebase has a history of: those all concern setters dispatched from `applyOptions` during a `Component`'s `super()` cascade, where DOM access and `setElementAttribute` writes are dropped. `Router` is not a `Component`, does no DOM work in its constructor, and calls `applyOptions` from its own constructor body after every field initializer has run — so none of those traps apply. What survives from that history is the ordering discipline itself: nothing that touches the tree happens at construction; it all happens in `start()`.

[^event-gap]: This is a real gap in the `Event` class, not an oversight in the plan. `Event.addViewportListener(component, type, listener)` is the only window-level surface, and it is `Component`-keyed by design — the bucket is a `Map<id, CompFunc>` and dispatch does `listener.apply(compFunc.component, …)`. It also calls `evnt.stopPropagation()` on every viewport event, which would be wrong for a global `hashchange`. Widening `Event` to accept a non-`Component` host was considered and rejected as far larger than this feature warrants: it would change the shape of `viewportListenerMap`, the dispatch loop, and `reindexComponent`. ARCHITECTURE.md already carves out exactly this case, listing `MediaQueryList` and non-`Component` ancestor elements as precedent for going straight to `DOM.sink.addListener`.

[^location-in-seam]: The alternative — reading `location.hash` directly in `Router.ts` — technically passes the `local/no-raw-dom` rule, because its `GLOBAL_IDENTIFIERS` set is `{"document", "window"}` and a bare `location` is not in it. That is a gap in the lint rule, not permission. `location` is part of the DOM, ARCHITECTURE.md requires every DOM read and write to funnel through the seam, and routing the hash through it is what makes the router testable under the `node` environment with no jsdom. A second, router-private seam interface was also considered and rejected: `DOM.install` already exists as the swap point, and a parallel mechanism would mean two things to stub in tests.

[^specificity]: First-registered-wins was rejected. Once registrations are split across modules, the winner depends on import order — the failure mode React Router is known for. Specificity ranking is a property of the patterns alone, so a route file can move without changing behaviour. Differing segment counts need no separate rule, but they do need the past-the-end rank. Two patterns of different lengths can both match only when the longer one ends in `*`, and the shorter one may have run out of segments before reaching that `*` — `/a/b` versus `/a/b/*` for path `/a/b`. Ranking a position past the end of a pattern *above* every real segment kind is what makes the exact pattern win there. Ranking it below, or breaking the tie by pattern length, would hand `/a/b` to the catch-all, which is the opposite of specificity.

[^ambiguity-key]: Keying the table by normalized pattern makes ambiguity a *registration-time* property rather than a per-navigation one. Two patterns are genuinely ambiguous precisely when they differ only in parameter names, and that is exactly when their keys collide — so detection is exact, not a heuristic, and the warning fires once at registration rather than on every navigation. It also gives `selectPattern` a useful guarantee: no two entries in the table can ever rank equally, so the comparator never needs a tie-break. Warning at match time was rejected — it would fire repeatedly for one authoring mistake and cost work on every navigation.

[^demo-tab]: A `Card` demo was considered and rejected. `main.ts` already has a 28-section `Tab` on `Body` that is exactly the "top-level section switcher" the router targets, so routing it costs one mechanical rename across the registration block plus about twenty new lines, and exercises a real app shell. Building a parallel `Card`-based switcher would add a demo panel, its children, and its own button strip purely to host the example — more code, less realism. (`Card` selects its visible child by id, so nothing about it is unsuited to routing; it is simply not what the demo already has.) `Tab` also gives the round trip for free: it already emits `"activate"`, so hash-to-tab and tab-to-hash both have a seam without touching library code.
