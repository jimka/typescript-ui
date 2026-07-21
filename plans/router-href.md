---
depends-on: [hash-router, packages-docs]
---

# Router.getHref — Implementation Plan

## Overview

`Router` reads, writes, and normalizes the URL hash, but offers no way to ask "what href should an `<a>` pointing at this route carry?" Every consuming app therefore rebuilds the encoding itself. The docs app does it in one line — `hashHref` at [packages/docs/src/content/links.ts:9](packages/docs/src/content/links.ts#L9) returns `'#' + path`.

This plan adds `Router.getHref(path)`, which returns the exact hash string `navigate(path)` would write, and rewires [`navigate`](packages/lib/src/typescript/lib/router/Router.ts#L149) to build on it so one method owns the encoding. The docs app's `hashHref` is deleted; [`resolveDocLink`](packages/docs/src/content/links.ts#L24) takes a `Router` and calls `getHref` instead.

Three files carry logic changes: [Router.ts](packages/lib/src/typescript/lib/router/Router.ts), [links.ts](packages/docs/src/content/links.ts), and [DocsContent.ts](packages/docs/src/shell/DocsContent.ts). Two test files and one docs page follow.

**Preconditions.** This work sits on top of the unmerged three-branch stack `master → feature/markdown-tables → feature/hash-router → feature/packages-docs`. `Router` exists only on `feature/hash-router` and `links.ts` only on `feature/packages-docs`, so implementation must be based on `master` **after that stack merges**, not before.

---

## Architecture Decisions

### `getHref` is an instance method on `Router`, not a standalone exported function

`getHref(path: string): string` lives on the `Router` class in [Router.ts](packages/lib/src/typescript/lib/router/Router.ts). The router barrel gains no new export; the method rides the already-exported `Router`.[^instance-not-function]

The precedent is the router package's own split. [RoutePattern.ts:3-6](packages/lib/src/typescript/lib/router/RoutePattern.ts#L3) states that its pure functions are "internal to `router/`, not exported from the barrel", and [router/index.ts](packages/lib/src/typescript/lib/router/index.ts) exports only `Router` and its types. Adding a second exported function would break that split for a value the class can carry.

### The name is `getHref`, matching the library's parameterised-accessor convention

Public string-deriving methods in this library are named `getX(arg)` even when they take an argument and compute rather than read: [`TabBar.getEntryButtonId(id)`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1443), [`TabBar.getEntryName(id)`](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1408), [`AbstractStore.getGroupString(record)`](packages/lib/src/typescript/lib/data/AbstractStore.ts#L1730), [`DOMSource.getThemeVar(name)`](packages/lib/src/typescript/lib/core/DOM.ts#L1789). `getHref` also pairs as the inverse of the existing [`getPath()`](packages/lib/src/typescript/lib/router/Router.ts#L167).[^name]

### `getHref` normalizes and percent-encodes exactly as `navigate` does today

`getHref` runs its input through the same `normalizePath` → `splitPath` → `encodeURIComponent` chain that [Router.ts:150-151](packages/lib/src/typescript/lib/router/Router.ts#L150) runs. Anything else would mean an href and the path you land on after clicking it could differ.[^normalize]

| `getHref` input | Normalized path | Result |
|---|---|---|
| `"/guide"` | `/guide` | `#/guide` |
| `"/guide/"` | `/guide` | `#/guide` |
| `"guide"` | `/guide` | `#/guide` |
| `"#/guide"` | `/guide` | `#/guide` |
| `"/a//b"` | `/a/b` | `#/a/b` |
| `"/"` | `/` | `#/` |
| `""` | `/` | `#/` |
| `"/a b"` | `/a b` | `#/a%20b` |
| `"/settings?tab=x"` | `/settings` | `#/settings` |
| `"/a%20b"` | `/a%20b` | `#/a%2520b` |

The last two rows are the ones that surprise. A query string is discarded, because `normalizePath` discards it — query parameters are a documented non-goal of the router ([hash-router.md:476](plans/implemented/hash-router.md#L476)). An already-encoded input is encoded again, because `getHref` takes a *decoded* path. Both match `navigate` today, and matching is the contract.

### `navigate` is refactored to call `getHref`

[`navigate`](packages/lib/src/typescript/lib/router/Router.ts#L149) drops its own two-line hash construction and calls `this.getHref(path)`. One method then knows the encoding, so a future History mode changes one place.[^navigate-refactor]

### The docs app deletes `hashHref` and passes its `Router` into `resolveDocLink`

`hashHref` is removed from [links.ts](packages/docs/src/content/links.ts). `resolveDocLink` gains a second parameter, `router: Router`, and calls `router.getHref(...)` on its route branch. [DocsContent.ts:48](packages/docs/src/shell/DocsContent.ts#L48) wires it with an arrow that closes over the router it already receives.[^delete-alias]

`resolveDocLink` itself stays in the docs app. Deciding what counts as a route in that app is app policy, not library behaviour.

---

## Public API

### `packages/lib/src/typescript/lib/router/Router.ts`

```typescript
export class Router {
    /** The hash href for `path` — exactly what `navigate(path)` would write. */
    getHref(path: string): string;
}
```

No new type, no new barrel export, no options-bag field — `getHref` derives its result from its argument and holds no state.

### `packages/docs/src/content/links.ts`

```typescript
// hashHref is deleted.

export function resolveDocLink(href: string, router: Router): MarkdownLinkResolution;
```

---

## Implementation

`getHref` in `Router.ts`, placed directly above `navigate` so the two read together:

```typescript
getHref(path: string): string {
    const segments = splitPath(normalizePath(path));

    return "#/" + segments.map((segment) => encodeURIComponent(segment)).join("/");
}
```

`navigate`'s body then opens with `const hash = this.getHref(path);` and keeps its existing `replace` branch unchanged.

`resolveDocLink`'s route branch becomes `return { href: router.getHref(href.split('#')[0]), external: false };`. Its other two branches are untouched.

---

## Ordered Implementation Steps

1. **`packages/lib/tests/unit/router/Router.test.ts`** — add a `describe('Router — getHref')` block covering every row of the table in `## Expected Behaviour`, plus the `navigate` agreement cases. Run `npm test` from `packages/lib`; the new block fails.
2. **`packages/lib/src/typescript/lib/router/Router.ts`** — add `getHref` immediately above `navigate`, with the body shown in `## Implementation`. Write its JSDoc in the file's existing style (`@param` then `@returns`, no blank line between). Describe normalization and encoding **in prose** — do not `{@link normalizePath}`, which is not in the public API docs and would fail the zero-warning doc build (see [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md), *Don't `{@link}` internal symbols from public JSDoc*).
3. **`packages/lib/src/typescript/lib/router/Router.ts`** — replace `navigate`'s hash construction with `const hash = this.getHref(path);`. Check: `grep -n 'encodeURIComponent' packages/lib/src/typescript/lib/router/Router.ts` — expect exactly one match, inside `getHref`.
4. Run `npm test` and `npm run typecheck` from `packages/lib`. All router tests pass, including the pre-existing `navigate("/a b")` → `#/a%20b` case.
5. **`packages/lib/docs/concepts/routing.md`** — add a `getHref(path)` bullet to *The surface*, and a short *Building links* section showing `<a href={router.getHref('/settings')}>`-style usage in the plain-TypeScript form the page already uses. State that `getHref` returns what `navigate` writes, so a rendered link and a programmatic navigation always agree.
6. **`packages/docs/src/content/links.ts`** — delete `hashHref`; add `import { Router } from '@jimka/typescript-ui/router';`; give `resolveDocLink` its `router` parameter, a `@param router` JSDoc line, and the `router.getHref(...)` call. Update the function's JSDoc prose, which currently names `hashHref`.
7. **`packages/docs/src/shell/DocsContent.ts`** — change line 48 to `new Markdown(undefined, { linkResolver: (href) => resolveDocLink(href, router) })`. Check: `grep -rn 'hashHref' packages/docs/src/` — expect zero matches.
8. **`packages/docs/tests/links.test.ts`** — delete the `describe('hashHref')` block; construct one `const router = new Router();` at module scope and pass it in every `resolveDocLink` call; rewrite the trailing-slash case per `## Expected Behaviour`.
9. From the repo root run `npm run build:lib`, then `npm -w packages/docs run typecheck` and `npm -w packages/docs run test`. The lib build must come first — `packages/docs` resolves `@jimka/typescript-ui/router` through the package's `exports` map to `packages/lib/dist`, which is gitignored.
10. From `packages/lib` run `npm run lint` and `npm run docs:build`. The doc build must finish with **zero** TypeDoc warnings.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/router/Router.ts` |
| Modify | `packages/lib/tests/unit/router/Router.test.ts` |
| Modify | `packages/lib/docs/concepts/routing.md` |
| Modify | `packages/docs/src/content/links.ts` |
| Modify | `packages/docs/src/shell/DocsContent.ts` |
| Modify | `packages/docs/tests/links.test.ts` |

No file is created or deleted. `packages/lib/src/typescript/lib/router/index.ts` is **not** touched — `getHref` rides the already-exported `Router`.

---

## Expected Behaviour

### `Router.getHref` — *unit, `packages/lib/tests/unit/router/Router.test.ts`*

`getHref` touches no DOM, so these cases need no `installTestDOM` call. Assert every row of the table in `## Architecture Decisions`:

| Call | Result |
|---|---|
| `getHref('/guide')` | `'#/guide'` |
| `getHref('/guide/')` | `'#/guide'` |
| `getHref('guide')` | `'#/guide'` |
| `getHref('#/guide')` | `'#/guide'` |
| `getHref('/a//b')` | `'#/a/b'` |
| `getHref('/')` | `'#/'` |
| `getHref('')` | `'#/'` |
| `getHref('/a b')` | `'#/a%20b'` |
| `getHref('/settings?tab=x')` | `'#/settings'` |
| `getHref('/a%20b')` | `'#/a%2520b'` |

Plus:

- `getHref` on a router that was never started returns the same string as on a started one — it reads no hash and installs no listener.
- `getHref('/users/:id')` returns `'#/users/%3Aid'`. Passing a *pattern* rather than a concrete path is a caller error; pin the escaping so the behaviour is not accidental.

### `getHref` and `navigate` agree — *unit, via `installTestDOM`*

For each of `'/settings'`, `'/a b'`, `'/guide/'`, and `'/'`:

- `navigate(path)` writes exactly `getHref(path)` through `DOM.sink.setLocationHash`. Assert the recorded sink value equals the `getHref` return value, computed in the test rather than hardcoded.
- `navigate(path, { replace: true })` passes the same string to `replaceLocationHash`.

Round trip: after `navigate('/data/rows/5')`, `getPath()` returns `'/data/rows/5'`, and a router registered on `/data/rows/:sel` receives `{ sel: '5' }`. After `navigate('/users/a b')`, a router registered on `/users/:id` receives `{ id: 'a b' }` — the encode on the way out and the per-param decode on the way in cancel.

### `resolveDocLink` — *unit, `packages/docs/tests/links.test.ts`*

| Call | Result |
|---|---|
| `resolveDocLink('/concepts/sizing', router)` | `{ href: '#/concepts/sizing', external: false }` |
| `resolveDocLink('/guide/', router)` | `{ href: '#/guide', external: false }` |
| `resolveDocLink('/guide/mental-model#jsx-shaped-without-jsx', router)` | `{ href: '#/guide/mental-model', external: false }` |
| `resolveDocLink('#custom-themes', router)` | `{ href: '#custom-themes', external: false }` |
| `resolveDocLink('https://example.com', router)` | `{ href: 'https://example.com', external: true }` |
| `resolveDocLink('mailto:x@example.com', router)` | `{ href: 'mailto:x@example.com', external: true }` |

The trailing-slash row is the one behaviour change. The current test at [links.test.ts:15](packages/docs/tests/links.test.ts#L15) asserts `'/guide/'` → `'#/guide/'` and is titled "does not strip the trailing slash of a directory-index route href". Replace it, title and assertion: the trailing slash is now normalized away. The in-page branch (`#…`) still returns before `getHref` is reached, so a bare fragment is never re-encoded.

### Manual browser verification

Run `npm -w packages/docs run dev` and open the served URL.

- Navigate to the Introduction page (`#/guide`). Its "Concepts" link is authored as `/concepts/` ([packages/lib/docs/guide/index.md:31](packages/lib/docs/guide/index.md#L31)). Hovering it must show `#/concepts` in the status bar — no trailing slash — and clicking it must land on the Concepts overview page.
- Middle-click that same link: it opens the Concepts page in a new tab.
- An in-page heading link still scrolls within the pane and does not change the hash.
- An external link still opens in a new tab.

---

## Verification

From `packages/lib`:

- `npm run typecheck`
- `npm test` — the `Router — getHref` block and the agreement cases pass.
- `npm run lint`
- `npm run docs:build` — finishes with **zero** TypeDoc warnings.

From the repo root:

- `npm run build:lib`, then `npm -w packages/docs run typecheck` and `npm -w packages/docs run test`.
- `grep -rn 'hashHref' packages/` — zero matches.
- `grep -n 'encodeURIComponent' packages/lib/src/typescript/lib/router/Router.ts` — one match, inside `getHref`.

---

## Documentation Impact

- **API reference** is generated by TypeDoc from the JSDoc on `getHref`; no page is hand-edited. The `{@link}` restriction in step 2 is what keeps that build at zero warnings.
- **[packages/lib/docs/concepts/routing.md](packages/lib/docs/concepts/routing.md)** gains a `getHref(path)` bullet in *The surface* and a *Building links* section (step 5).
- **`packages/lib/llms.txt`** needs no change. It is generated from [scripts/llms/manifest.data.mjs](packages/lib/scripts/llms/manifest.data.mjs), whose router entry is capability-level ("Map the URL hash to a top-level app section") and lists no individual methods.
- **[plans/implemented/packages-docs.md](plans/implemented/packages-docs.md)** is a historical record and is not edited. Its `[^no-local-router]` footnote calls the href "one line" of app code; this plan supersedes that, and saying so belongs here rather than in the old plan.

---

## Potential Challenges

- **The docs test gains a runtime dependency on the built library.** `links.test.ts` currently imports only a *type* from `@jimka/typescript-ui`, which erases at compile time; importing `Router` makes it need `packages/lib/dist`. CI already runs `npm run build:lib` before `npm -w packages/docs run test` ([.github/workflows/docs.yml:41](.github/workflows/docs.yml#L41)), so only local runs are affected — step 9 states the order.
- **`new Router()` runs in the `node` test environment with no DOM installed.** The constructor only calls `applyOptions`, and `getHref` reads nothing, so no seam call happens. If the import itself ever fails under `node`, that is a module-level problem in `DOM.ts`, not in this change.
- **Authored doc hrefs are assumed to be decoded paths.** An authored link containing a literal `%` or a space would now be percent-encoded where `'#' + path` passed it through. Every Phase-1 doc path is a plain ASCII slug, so no current link changes; the manual check on `/concepts/` confirms the one path that does normalize differently.

---

## Critical Files

- [packages/lib/src/typescript/lib/router/Router.ts](packages/lib/src/typescript/lib/router/Router.ts) — `navigate` (line 149) and `getPath` (line 167) set the encoding and the naming this method must match.
- [packages/lib/src/typescript/lib/router/RoutePattern.ts](packages/lib/src/typescript/lib/router/RoutePattern.ts) — `normalizePath` (line 36) and `splitPath` (line 53); its header comment states why these stay out of the barrel.
- [packages/lib/src/typescript/lib/router/index.ts](packages/lib/src/typescript/lib/router/index.ts) — the barrel that stays unchanged.
- [packages/lib/src/typescript/lib/component/container/TabBar.ts:1443](packages/lib/src/typescript/lib/component/container/TabBar.ts#L1443) — `getEntryButtonId`, the naming precedent for a parameterised string-deriving accessor.
- [packages/lib/tests/unit/router/Router.test.ts](packages/lib/tests/unit/router/Router.test.ts) — the `installTestDOM` harness shape the new agreement tests reuse.
- [packages/docs/src/content/links.ts](packages/docs/src/content/links.ts), [packages/docs/src/shell/DocsContent.ts](packages/docs/src/shell/DocsContent.ts), [packages/docs/tests/links.test.ts](packages/docs/tests/links.test.ts) — the three consumer-side edits.
- [CODE_CONVENTIONS.md](CODE_CONVENTIONS.md) — the `{@link}` rule that governs the new JSDoc.

---

## Non-Goals

- **History / `pushState` mode.** Still a non-goal ([hash-router.md:473](plans/implemented/hash-router.md#L473)). `getHref` is the seam that would make adding it cheap later; this plan does not add it, and introduces no mode option or flag.
- **Moving `resolveDocLink` into the library.** Classifying an authored href as route / in-page / external is docs-app policy.
- **Query-string support.** `getHref` discards a query because `normalizePath` does. Teaching the router about query parameters is a separate, additive change.
- **A `getHref` overload taking params for a pattern** (e.g. `getHref('/users/:id', { id: '7' })`). No caller needs it, and it would make `getHref` and `navigate` diverge in shape.
- **Changing `getPath`'s decoding.** `getPath` returns the raw normalized path; only `:param` captures are decoded. That asymmetry predates this plan and is untouched.

---

## Notes

[^instance-not-function]: A standalone `hashHref(path)` exported from the router barrel was rejected on two grounds. First, precedent: the router package deliberately keeps its pure functions unexported, and `router/index.ts` currently exports one class plus its types — a lone free function would be the only exception. Second, direction of travel: a History mode would be per-`Router` configuration, so the encoding has to read instance state the moment that mode exists, and a free function would then need either a `Router` argument or a duplicate mode flag. The "no `Router` in hand" case that argues for a free function is real but cheap to solve — the one live example, `resolveDocLink`, is called from `DocsContent`, which already holds the router and just passes it down.

[^name]: `href(path)` reads slightly better at a call site, but the library has no public method named as a bare noun; every parameterised string-deriving method uses the `getX(arg)` form. `toHref` was also considered and dropped — there is no `toX` method anywhere in the library's public surface. Consistency with the four cited `getX(arg)` methods beats the marginal gain in call-site prose.

[^normalize]: The alternative — a raw `"#" + path` that neither normalizes nor encodes — was rejected because it makes an href and its own navigation disagree. Under it, an `<a href="#/a b">` clicked in the docs app would hand `Router.navigate` the path `/a b`, which writes `#/a%20b`, so the hash after the click differs from the href before it, and browser history records two entries for one destination. Encoding also protects the segment separator: an unencoded `/` inside a path segment would silently split into two segments. The double-encoding of an already-encoded input (`/a%20b` → `#/a%2520b`) is the price of taking decoded input, and it is exactly what `navigate` does today, so no caller's behaviour changes.

[^navigate-refactor]: `navigate` and `getHref` must produce byte-identical strings, and the cheapest way to guarantee that is to have one produce the other. Leaving `navigate`'s two lines in place would leave two copies of the encoding that a future History mode has to change in lockstep — the precise failure this plan exists to remove. The refactor is behaviour-preserving: `navigate`'s existing tests, including `navigate("/a b")` → `#/a%20b`, pass unchanged.

[^delete-alias]: Keeping `hashHref` as a thin local alias (`const hashHref = (path) => router.getHref(path)`) was rejected. It has exactly two call sites — `resolveDocLink` and its own test — so the alias would save nothing, and it cannot be a module-level function any more once it needs a `Router`, which is the whole point of the move. A local name that shadows a library method is also the thing the next reader would have to check for drift. Deleting it leaves one obvious path from an authored href to a rendered one.
