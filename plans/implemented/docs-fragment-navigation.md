---
depends-on: [docs-cutover]
touches-shared:
    - packages/lib/src/typescript/lib/router/Router.ts
    - packages/lib/src/typescript/lib/router/RoutePattern.ts
    - packages/lib/docs/concepts/routing.md
    - packages/docs/src/main.ts
    - packages/docs/src/content/links.ts
    - packages/docs/src/shell/DocsContent.ts
    - packages/docs/src/shell/DocsShell.ts
    - packages/docs/src/shell/DocsSidebar.ts
    - packages/docs/tests/links.test.ts
---

# Docs Fragment Navigation — Implementation Plan

## Overview

The authored docs corpus contains **178 links of the form `/path#fragment`** — 89 pointing at authored pages, 89 pointing at the generated API reference under `/api/`. The docs app drops the fragment and lands the reader at the top of the correct page: [`links.ts:30`](packages/docs/src/content/links.ts#L30) strips everything from `#` onward before building the href, and [`DocsContent.showPath`](packages/docs/src/shell/DocsContent.ts#L60) always calls `setScrollTop(0)`. VitePress honours those fragments today, so retiring it turns all 178 into a visible regression against the site being replaced.

This plan makes the fragment part of the route. The library `Router` learns to carry a fragment through `getHref` / `getPath` / `navigate` and to hand it to route handlers; the docs app scrolls the content pane to the matching heading after the page has laid out. Heading `id`s already exist in the rendered DOM — [`Markdown.appendHeading`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L664) writes `setAttr: { id }` from a slugified heading text — and all 89 authored-page fragments already match an `id` the viewer emits.[^fragments-verified]

**Ordering.** This plan needs the History routing mode that [`plans/docs-cutover.md`](plans/docs-cutover.md) adds, and it must land before that plan's **step 21**, the `.github/workflows/docs.yml` rewrite that makes the docs app the live site and stops running VitePress. Implement `docs-cutover` through its step 15 review gate, implement this plan on top, then finish `docs-cutover` from step 16. Merging the cutover's workflow rewrite first ships the regression live.[^why-history-first]

---

## Architecture Decisions

### The fragment lives in the library `Router`, beside the base and the mode

`Router` gains `getFragment(href?)`, carries the fragment through `getHref` and `navigate`, and passes it to every route handler. The docs app never parses a URL itself.[^library-not-app]

This follows the seam `docs-cutover` establishes: "`Router` owns the mode and the base; the app owns neither", with `getHref(path)` and `getPath(href?)` as the only two places URL shape is known. A fragment is URL shape, so it joins them rather than growing a third owner in the app.

### Fragment support is History-mode only; hash mode strips fragments

In hash mode the `#` is already spent on the route, so a route and a fragment cannot both be expressed. `getFragment()` returns `""` in hash mode, and `getHref` / `navigate` discard any fragment in their input. Nothing that uses hash mode changes.[^hash-mode-strips]

### `navigate` compares path **and** fragment; the handler runs on every navigation

`docs-cutover` gives History-mode `navigate` an early return when the target path equals the current one. That guard widens to compare the fragment too, so `/concepts/sizing` → `/concepts/sizing#the-size-invariant` is a real navigation: it writes the URL and calls the handler.[^guard-widened]

The route handler is called on every navigation that gets past the guard, including a fragment-only one. Deciding whether the page actually needs re-rendering is the app's job, not the router's — `DocsContent` skips `setMarkdown` when the path is unchanged.

### The scroll runs after the next layout flush, then forces a synchronous layout

`DocsContent.showPath` queues the scroll with [`Component.afterNextLayout`](packages/lib/src/typescript/lib/core/Component.ts#L5097), and the queued callback calls `this.flushLayout()` before it measures. Both calls are required, and the second is the non-obvious one: without it a cold load scrolls short or not at all.[^two-step-timing]

`Component.afterNextLayout` is the framework's existing answer to "act on geometry I have just invalidated" — [`Dialog.ts:813`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L813) uses it for `resizeToContent`, [`:823`](packages/lib/src/typescript/lib/overlay/Dialog.ts#L823) for `focusFirst`.

### The scroll goes through the framework scroll model, never `scrollIntoView`

`DocsContent.scrollToHeading` already does this: it reads two rects with `DOM.source.getElementRect` and writes the difference through `Component.setScrollTop`. That body is kept.[^no-scroll-into-view]

Native `scrollIntoView` and native `focus()` both scroll `overflow: hidden` ancestors and corrupt this project's custom scroll model, which is why the codebase passes `preventScroll` wherever it must focus.

### The heading is found by `getElementById` plus a containment check, not by a `#id` selector

`scrollToHeading`'s lookup changes from `DOM.source.querySelector(scrollElement, '#' + id)` to `DOM.source.getElementById(id)` followed by `DOM.source.contains(scrollElement, heading)`. A fragment is attacker-controlled text and an `id` may legitimately start with a digit, both of which make `'#' + id` an invalid CSS selector that throws.[^selector-throws]

### A bare `#fragment` link now navigates instead of scrolling directly

`DocsContent.onLinkClick`'s in-page branch routes through `Router.navigate` like every other link, so the URL gains the fragment and the back button returns to the previous anchor. One mechanism serves in-page anchors, cross-page fragment links, and cold loads.[^one-mechanism]

### This plan is independent of `plans/focus-reveal-on-navigation.md`

`FocusReveal` is not depended on and not extended. Its scroll body is the same rect-delta-plus-`setScrollTop` shape used here, but its contract is "bring the target minimally into view" whereas a fragment jump must put the heading at the **top** of the pane.[^focus-reveal-independent]

---

## Public API

### `packages/lib/src/typescript/lib/router/RoutePattern.ts` (internal to `router/`, not exported from the barrel)

```typescript
/** Splits a URL-ish string at its first `"#"`: the part before, and the fragment without its `"#"`. */
export function splitFragment(input: string): { path: string; fragment: string };
```

### `packages/lib/src/typescript/lib/router/Router.ts`

```typescript
/** A registered route's callback: drives whatever it fronts, never builds it. */
export type RouteHandler = (params: RouteParams, path: string, fragment: string) => void;

/** The pattern and params a navigation resolved to. */
export interface RouteMatch {
    pattern:  string;
    params:   RouteParams;
    path:     string;
    /** The URL fragment without its `"#"`, or `""` when there is none. Always `""` in hash mode. */
    fragment: string;
}

class Router {
    /**
     * The fragment for `href`, or — with no argument — for the current URL,
     * without its leading `"#"`. Always `""` in hash mode.
     */
    getFragment(href?: string): string;
}
```

`getHref(path)` and `getPath(href?)` keep the signatures `docs-cutover` gives them; only their bodies learn about fragments. Adding a third parameter to `RouteHandler` is source-compatible — a handler declared with two parameters stays assignable.

No new options-bag field, no new setter, and no new DOM-seam method: in History mode `location.hash` **is** the fragment, so the existing `DOMSource.getLocationHash()` ([`DOM.ts:1069`](packages/lib/src/typescript/lib/core/DOM.ts#L1069)) reads it, and `DOMSink.pushHistoryPath(url)` writes a URL that already carries it.

### `packages/docs/src/shell/DocsContent.ts` and `DocsShell.ts`

```typescript
class DocsContent extends Panel {
    /** Shows `path`, then scrolls to `fragment`'s heading — or to the top when `fragment` is `""`. */
    showPath(path: string, fragment: string): void;
}

class DocsShell extends Panel {
    showPath(path: string, fragment: string): void;
}
```

Both parameters are required. `DocsContent` gains one private field, `_path: string | null`, holding the path currently rendered.

---

## Internal Structure

### `splitFragment`

| input | `path` | `fragment` |
|---|---|---|
| `/concepts/sizing#the-size-invariant` | `/concepts/sizing` | `the-size-invariant` |
| `/concepts/sizing` | `/concepts/sizing` | `` |
| `/concepts/sizing#` | `/concepts/sizing` | `` |
| `#the-size-invariant` | `` | `the-size-invariant` |
| `/a#b#c` | `/a` | `b#c` |
| `` | `` | `` |

Everything after the **first** `#` is the fragment, verbatim. `splitFragment` never normalizes; its `path` output is handed to `normalizePath` by the caller.

### `getHref`, `getPath`, and `getFragment` with fragments

Fixture: History mode, base `/typescript-ui/`.

| call | result |
|---|---|
| `getHref("/concepts/sizing#the-size-invariant")` | `/typescript-ui/concepts/sizing#the-size-invariant` |
| `getHref("/concepts/sizing")` | `/typescript-ui/concepts/sizing` |
| `getHref("/guide/#intro")` | `/typescript-ui/guide#intro` |
| `getPath("/typescript-ui/concepts/sizing#the-size-invariant")` | `/concepts/sizing` |
| `getFragment("/typescript-ui/concepts/sizing#the-size-invariant")` | `the-size-invariant` |
| `getFragment("/typescript-ui/concepts/sizing")` | `` |

In hash mode the same inputs give `#/concepts/sizing`, `/concepts/sizing`, and `""` — the fragment is dropped everywhere.

`getHref` splits the fragment off first, runs the path part through the `normalizePath` → `splitPath` → `encodeURIComponent` chain `docs-cutover` specifies, then re-appends `"#" + fragment` when the fragment is non-empty. The fragment is **not** percent-encoded: it is already an authored slug, and encoding it would stop it matching the `id` in the DOM.

`getPath(href)` and `getFragment(href)` both call `splitFragment(href)` first. With no argument, `getFragment()` reads `DOM.source.getLocationHash()` and returns it without its leading `"#"`; `getPath()` reads the pathname, which never contains a fragment.

### `navigate` in History mode

```typescript
// Replaces the guard docs-cutover installs. Hash mode keeps its own body,
// with any fragment in `path` discarded by getHref.
const split    = splitFragment(path);
const target   = normalizePath(split.path);
const fragment = split.fragment;

if (target === this.getPath() && fragment === this.getFragment()) {
    return this;                       // same path and same fragment: no history entry, no handler
}

const url = this.getHref(fragment === "" ? target : `${target}#${fragment}`);

if (options?.replace === true) {
    DOM.sink.replaceHistoryPath(url);
} else {
    DOM.sink.pushHistoryPath(url);
}

this.applyCurrentRoute();              // pushState fires no event; apply it ourselves
```

`applyCurrentRoute` reads the fragment once, passes it as the handler's third argument, and puts it on the emitted `RouteMatch`:

```typescript
const path     = this.getPath();
const fragment = this.getFragment();
// … selectPattern as today …
result.compiled.handler(result.params, path, fragment);
this.emit("navigate", { pattern: result.compiled.pattern, params: result.params, path, fragment });
```

### Which navigations do what

| from | to | history entry | handler | `DocsContent` re-renders | scroll |
|---|---|---|---|---|---|
| `/guide` | `/concepts/sizing#the-size-invariant` | pushed | yes | yes | to the heading |
| `/concepts/sizing` | `/concepts/sizing#the-size-invariant` | pushed | yes | no | to the heading |
| `/concepts/sizing#the-size-invariant` | `/concepts/sizing#see-also` | pushed | yes | no | to the heading |
| `/concepts/sizing#the-size-invariant` | `/concepts/sizing#the-size-invariant` | none | no | no | none |
| `/concepts/sizing#the-size-invariant` | `/concepts/sizing` | pushed | yes | no | to the top |

### `DocsContent.showPath`

```typescript
showPath(path: string, fragment: string): void {
    if (path !== this._path) {
        this._path = path;

        const page = getPage(path);

        this._markdown.setMarkdown(page ? page.source : notFoundSource(path));
    }

    if (fragment === '') {
        this.setScrollTop(0);

        return;
    }

    // The heading ids exist as soon as setMarkdown returns, but the pane's
    // scrollable extent does not: Markdown.measureContentHeight schedules the
    // parent's layout, and a scroll offset past a stale extent is clamped away.
    this._pendingFragment = fragment;
    Component.afterNextLayout(this.handleScrollToFragment);
}
```

`handleScrollToFragment` is a stable arrow field delegating to a named method, matching the `handleLinkClick` field already in the file:

```typescript
private readonly handleScrollToFragment: () => void = () => this.onScrollToFragment();

private onScrollToFragment(): void {
    const fragment = this._pendingFragment;

    this._pendingFragment = null;

    if (fragment === null) {
        return;
    }

    this.flushLayout();          // fold Markdown's measured height into this pane's scroll extent
    this.scrollToHeading(fragment);
}
```

A second navigation arriving before the callback drains overwrites `_pendingFragment`, so the last target wins and the earlier callback finds `null`.

### `scrollToHeading`'s lookup

Only the two lines that find the element change; the rect arithmetic and the `setScrollTop` write stay exactly as they are.

```typescript
const heading = DOM.source.getElementById(id);

if (!heading || !DOM.source.contains(scrollElement, heading)) {
    return;
}
```

### `DocsSidebar.onSelection` must not clobber the fragment

`DocsShell.showPath` calls `this._sidebar.select(path)`, which selects a tree node, which fires `"selection"`, which calls `Router.navigate(node.data)` — a bare path with no fragment. Under the widened guard that is a *different* target from the URL just navigated to, so it would push a second entry stripping the fragment and reset the scroll to the top.

`onSelection` therefore returns early when the selected node's path already equals the router's current path:

```typescript
if (node.data === this._router.getPath()) {
    return;                    // reflecting the current route, not a user action
}
```

---

## Ordered Implementation Steps

Line numbers below are as of `master`. `docs-cutover` restructures `Router.navigate`, `Router.getPath`, `links.ts`, and `DocsContent.onLinkClick` before this plan starts — locate those symbols by name, not by line.

### Preconditions

1. **Confirm `docs-cutover` has landed through its step 14.** `Router` must have `mode`, `base`, `getHref(path)`, and `getPath(href?)`, and `packages/docs/src/main.ts` must construct the router with `mode: 'history'`. Check: `grep -n "getHref\|RouterMode" packages/lib/src/typescript/lib/router/Router.ts` returns matches. If it does not, stop — nothing below works under hash routing.

### Library: fragment-aware routing

2. **`packages/lib/src/typescript/lib/router/RoutePattern.ts`** — add `splitFragment` per `## Public API`, implementing every row of the *`splitFragment`* table. Keep it unexported from the barrel, like the other helpers in the file.
3. **`packages/lib/tests/unit/router/RoutePattern.test.ts`** — add the six `splitFragment` rows as cases.
4. **`packages/lib/src/typescript/lib/router/Router.ts`** —
   - Add `fragment: string` to `RouteMatch` and a third `fragment: string` parameter to `RouteHandler`, both with JSDoc.
   - Add `getFragment(href?: string): string` per *`getHref`, `getPath`, and `getFragment` with fragments*.
   - Make `getHref(path)` split the fragment off before normalizing and re-append it after encoding, in History mode only.
   - Make `getPath(href)` split the fragment off before normalizing, in History mode only.
   - Widen the History-mode `navigate` guard and rewrite the History branch per *`navigate` in History mode*.
   - Make `applyCurrentRoute` read the fragment and pass it to the handler and the `RouteMatch`.
   - Update the `navigate` and `getPath` docblocks to name the fragment, and state on `getFragment` that hash mode always returns `""`.
   - Check: `npm -w packages/lib run test -- router` — the whole existing suite stays green, because every existing handler ignores a third argument and hash mode strips fragments.
5. **`packages/lib/tests/unit/router/Router.test.ts`** — add fragment cases covering the *Library — unit-testable* list in `## Expected Behaviour`, in both modes.
   - Check: `npm -w packages/lib run typecheck && npm -w packages/lib run test` — green.
6. **`packages/lib/docs/concepts/routing.md`** — add a fragment section to the mode documentation `docs-cutover` step 9 writes: History mode carries a `#fragment` alongside the path, `getFragment()` reads it, `navigate("/a#b")` treats a fragment change as a navigation, the handler receives it as its third argument, and hash mode discards fragments because the `#` is spent on the route.

### Docs app: carrying the fragment

7. **`packages/docs/src/content/links.ts`** — in `resolveDocLink`'s route branch, pass the whole href to `getHref` instead of stripping the fragment: `router.getHref(href)`. This reverses `docs-cutover` step 12's `href.split('#')[0]`; that split existed only because the fragment had nowhere to go.
   - Check: `grep -n "split('#')" packages/docs/src/content/links.ts` — expect zero matches.
8. **`packages/docs/src/shell/DocsContent.ts`** — add the private fields `_path: string | null = null` and `_pendingFragment: string | null = null`, plus the `handleScrollToFragment` arrow field. Rewrite `showPath` and add `onScrollToFragment` per `## Internal Structure`. Import `Component` from `@jimka/typescript-ui/core`.
9. Same file — rewrite `scrollToHeading`'s element lookup per *`scrollToHeading`'s lookup*, and update its docblock to say the id is looked up document-wide and rejected when it is not inside the pane.
10. Same file — in `onLinkClick`, route both link kinds through the router. The route branch becomes:
    ```typescript
    const path     = this._router.getPath(href);
    const fragment = this._router.getFragment(href);

    e.preventDefault();
    this._router.navigate(fragment === '' ? path : `${path}#${fragment}`);
    ```
    and the bare `#…` branch becomes:
    ```typescript
    e.preventDefault();
    this._router.navigate(this._router.getPath() + '#' + href.slice(1));
    ```
    Keep the modifier-key and external-href handling `docs-cutover` step 13 installs, unchanged and still first.
11. **`packages/docs/src/shell/DocsShell.ts`** — widen `showPath(path, fragment)` and forward the fragment to `this._content.showPath(path, fragment)`. The `this._sidebar.select(path)` call is unchanged.
12. **`packages/docs/src/shell/DocsSidebar.ts`** — add the early return to `onSelection` per *`DocsSidebar.onSelection` must not clobber the fragment*, with a comment naming what it prevents.
13. **`packages/docs/src/main.ts`** — give both route handlers the fragment parameter and forward it: `showDefaultPage(_params, _path, fragment)` calls `shell.showPath(DEFAULT_PATH, fragment)`, and `showRoutedPage(_params, path, fragment)` calls `shell.showPath(path, fragment)`.
14. **`packages/docs/tests/links.test.ts`** — add the fragment cases from *Docs app — unit-testable* to the `resolveDocLink` block; the fixture router is the one `docs-cutover` step 14 builds.
    - Check: `npm -w packages/docs run typecheck && npm -w packages/docs run test` — green.

### Corpus guard

15. **`packages/docs/tests/content-constructs.test.ts`** — extend the bare-`#anchor` case `docs-content-migration` step 12 added so it also checks every `/path#fragment` link whose path resolves through `getPage`: the fragment must equal a heading id generated for that page. Report the source file, the link, and the page in the failure message. A link into `/api/…` is skipped when `getPage` returns `null` for it, so the case holds both before and after `docs-typedoc-reference` registers those pages.
    - Check: `npm -w packages/docs run test` — green, and 89 authored-page fragment links are asserted.

### Manifest and verification

16. **Regenerate and commit the manifest** — `npm run docs:api && npm -w packages/lib run docs:llms`, then commit the updated `packages/lib/llms.txt`. Its `Router` row picks up the reworded `navigate` and `getPath` docblocks from step 4.
17. Run everything in `## Verification`, then walk the manual list.

---

## Files to Create / Modify / Delete

| Action | File |
|---|---|
| Modify | `packages/lib/src/typescript/lib/router/RoutePattern.ts` |
| Modify | `packages/lib/src/typescript/lib/router/Router.ts` |
| Modify | `packages/lib/tests/unit/router/RoutePattern.test.ts` |
| Modify | `packages/lib/tests/unit/router/Router.test.ts` |
| Modify | `packages/lib/docs/concepts/routing.md` |
| Modify | `packages/lib/llms.txt` (regenerated) |
| Modify | `packages/docs/src/content/links.ts` |
| Modify | `packages/docs/src/shell/DocsContent.ts` |
| Modify | `packages/docs/src/shell/DocsShell.ts` |
| Modify | `packages/docs/src/shell/DocsSidebar.ts` |
| Modify | `packages/docs/src/main.ts` |
| Modify | `packages/docs/tests/links.test.ts` |
| Modify | `packages/docs/tests/content-constructs.test.ts` |

No file under `packages/lib/src/typescript/lib/component/` appears: the `Markdown` viewer already emits the heading `id`s this plan resolves against.

---

## Expected Behaviour

### Library — unit-testable in `RoutePattern.test.ts`

- `splitFragment` produces every row of the *`splitFragment`* table.

### Library — unit-testable in `Router.test.ts`

Fixture unless stated otherwise: `new Router({ mode: 'history', base: '/typescript-ui/' })`.

- Every existing router case stays green with no edit.
- `getHref` and `getPath` and `getFragment` produce every row of *`getHref`, `getPath`, and `getFragment` with fragments*, in both modes.
- `getHref(getPath(h) + '#' + getFragment(h))` round-trips `h` for `/typescript-ui/concepts/sizing#the-size-invariant`.
- `getFragment()` with no argument returns `the-size-invariant` when the modelled `location.hash` is `#the-size-invariant`, and `""` when it is `""`.
- In hash mode, `getFragment()` returns `""` even when the modelled hash is `#/guide` — the hash is the route, not a fragment.
- `navigate('/concepts/sizing#the-size-invariant')` records one `pushHistoryPath` of `/typescript-ui/concepts/sizing#the-size-invariant` and calls the handler once with `fragment === 'the-size-invariant'`.
- From `/concepts/sizing` with no fragment, `navigate('/concepts/sizing#the-size-invariant')` records one write and calls the handler once — the path is unchanged but the fragment is not.
- From `/concepts/sizing#the-size-invariant`, `navigate('/concepts/sizing#the-size-invariant')` records **no** write and calls **no** handler.
- From `/concepts/sizing#the-size-invariant`, `navigate('/concepts/sizing')` records one write of `/typescript-ui/concepts/sizing` and calls the handler with `fragment === ''`.
- The `"navigate"` event's `RouteMatch` carries the same `fragment` the handler received.
- A `popstate` dispatched after the modelled pathname and hash change calls the handler with both the new path and the new fragment.
- In hash mode, `navigate('/guide#intro')` writes `#/guide` — the fragment is discarded, and the handler's third argument is `''`.

### Docs app — unit-testable in `links.test.ts`

Fixture router: `new Router({ mode: 'history', base: '/typescript-ui/' })`.

- `resolveDocLink('/concepts/sizing#the-size-invariant', router)` returns `{ href: '/typescript-ui/concepts/sizing#the-size-invariant', external: false }`.
- `resolveDocLink('/concepts/theming#theme-keys', router)` returns `{ href: '/typescript-ui/concepts/theming#theme-keys', external: false }` — the corpus's most-linked fragment, 15 occurrences.
- `resolveDocLink('/guide/#intro', router)` returns `{ href: '/typescript-ui/guide#intro', external: false }` — the trailing slash normalizes away, the fragment survives.
- `resolveDocLink('/concepts/sizing', router)` is unchanged from `docs-cutover`: no `#` is added.
- `resolveDocLink('#custom-themes', router)` still returns `{ href: '#custom-themes', external: false }`, not base-prefixed.
- `resolveDocLink('https://example.com#x', router)` passes through unchanged with `external: true`.

### Corpus — unit-testable in `content-constructs.test.ts`

- Every `/path#fragment` link whose path resolves through `getPage` names a fragment equal to a heading id that page generates. 89 links are checked today; the count rises to 178 once `docs-typedoc-reference` registers `/api/`.

### Manual verification (browser required)

Run against `npm -w packages/docs run dev` at `http://localhost:5173/typescript-ui/`.

- **Cold direct load.** Typing `/typescript-ui/concepts/sizing#the-size-invariant` into the address bar renders the Sizing page scrolled so the *The size invariant* heading sits at the top of the pane — not the top of the page, and not a partial scroll.
- **Cross-page.** From `/guide/mental-model`, clicking a link to `/concepts/theming#theme-keys` renders Theming scrolled to *Theme keys*, and the address bar shows the fragment.
- **Same-page from a cross-page link.** On `/concepts/sizing`, clicking a link written as `/concepts/sizing#see-also` scrolls without re-rendering — the page must not flash.
- **Bare anchor.** Clicking a `#…` link scrolls the pane and adds the fragment to the address bar, leaving the path unchanged.
- **Back and forward.** After two fragment jumps on one page, the back button walks back through them, scrolling each time and never re-rendering. Back from a fragment to the bare path scrolls to the top.
- **Sidebar.** Clicking a sidebar entry for the page already shown adds no history entry and does not clear a fragment already in the URL. Clicking a different entry navigates and scrolls to the top.
- **Missing target.** `/typescript-ui/concepts/sizing#no-such-heading` renders the Sizing page at the top with no console error.
- **Digit-leading id.** `/typescript-ui/reference/changelog#0-1-0` scrolls to the `0.1.0` heading. This is the case a `#id` selector would throw on.
- **Ctrl-click.** Ctrl-click (Cmd-click) on a fragment link opens the full URL, fragment included, in a new tab.

---

## Verification

```bash
npm -w packages/lib run typecheck
npm -w packages/lib run lint
npm -w packages/lib run test           # router fragment cases + the whole existing suite
npm run build:lib
npm -w packages/docs run typecheck
npm -w packages/docs run test          # links + corpus fragment guard
npm run build:docs

# The fragment is no longer thrown away anywhere in the app.
grep -rn "split('#')" packages/docs/src/          # expect zero matches
# The scroll never goes native.
grep -rn "scrollIntoView" packages/docs/src/      # expect zero matches
# The heading lookup never builds a selector from a fragment.
grep -rn "'#' + id" packages/docs/src/            # expect zero matches
```

Then `npm -w packages/docs run dev` and walk the *Manual verification* list. Re-run the cold-load and back/forward cases against `npm -w packages/docs run build && npm -w packages/docs run preview`, because the `404.html` fallback path is what a real deep link takes.

---

## Documentation Impact

`Router` is exported from `@jimka/typescript-ui/router` via [`packages/lib/src/typescript/lib/router/index.ts`](packages/lib/src/typescript/lib/router/index.ts); `getFragment`, the widened `RouteHandler`, and `RouteMatch.fragment` all ride that existing export, so no barrel or subpath entry changes. `splitFragment` stays internal to `router/`.

[`packages/lib/docs/concepts/routing.md`](packages/lib/docs/concepts/routing.md) is the consumer-facing page and gains a fragment section in step 6.

`packages/lib/llms.txt` is regenerated because the `Router` docblocks change; the committed copy must be re-committed. No curated symbol is added to `manifest.data.mjs` — `getFragment` is a method on an already-catalogued class.

---

## Potential Challenges

- **The pane's scroll extent is stale on a cold load.** `Markdown.measureContentHeight` schedules the parent's layout from inside the flush, so it lands on the *following* frame; a `setScrollTop` issued before it is clamped to the previous page's extent. The `flushLayout()` call inside the queued callback is what closes this, and the cold-load manual case is the check.
- **The sidebar can strip the fragment it was just given.** Covered by the `onSelection` early return; the sidebar manual case is the check. Removing that guard reintroduces the bug silently, since the URL still ends up on the right page.
- **A fragment edited directly in the address bar fires `hashchange`, not `popstate`.** History mode listens only to `popstate`, so the app does not react until the next navigation or reload. Accepted: readers follow links, and a typed URL is normally submitted as a full load, which the cold-load path handles.
- **Web fonts can shift a heading after the scroll lands.** The pane is scrolled once, on the settled layout; a font arriving later re-flows the prose and the heading drifts. Out of scope, and the same drift already affects the existing bare-`#anchor` scroll.
- **A duplicated slug resolves to the first heading.** `Markdown` suffixes repeats as `-1`, `-2`, so an author linking `#overview` on a page with two *Overview* headings lands on the first. That is the viewer's documented rule, and the corpus guard in step 15 checks the ids as generated, suffixes included.
- **The 89 `/api/…` fragments are not exercised until `docs-typedoc-reference` lands.** They resolve on the same mechanism — TypeDoc emits `### setOverflowY()`, which slugifies to `setoverflowy`, matching the authored `#setoverflowy` — but nothing verifies that until those pages are registered. The step-15 guard picks them up automatically when they are.

---

## Critical Files

- [`plans/docs-cutover.md`](plans/docs-cutover.md) — the History mode, `getHref` / `getPath`, the `navigate` guard, and the `onLinkClick` rewrite this plan extends. Read its *`getHref` and `getPath`* and *Link click interception in `DocsContent`* sections before touching either file.
- [`packages/lib/src/typescript/lib/router/Router.ts`](packages/lib/src/typescript/lib/router/Router.ts) — `navigate` (149), `getPath` (167), `applyCurrentRoute` (217), `RouteHandler` (11), `RouteMatch` (17), all as of `master`.
- [`packages/lib/src/typescript/lib/router/RoutePattern.ts`](packages/lib/src/typescript/lib/router/RoutePattern.ts) — `normalizePath` (36), which strips a leading `#` and a query string but **not** a fragment; that gap is why `splitFragment` must run first.
- [`packages/lib/src/typescript/lib/core/Component.ts`](packages/lib/src/typescript/lib/core/Component.ts) — `afterNextLayout` (5097), `flushLayout` (5108), `setScrollTop` (3320), `getMaxScrollTop` (3382), and the queue drain in `flushPendingLayouts` (165) that explains the two-step timing.
- [`packages/lib/src/typescript/lib/overlay/Dialog.ts`](packages/lib/src/typescript/lib/overlay/Dialog.ts) — lines 813 and 823, the existing `afterNextLayout` call sites this plan mirrors.
- [`packages/lib/src/typescript/lib/component/display/Markdown.ts`](packages/lib/src/typescript/lib/component/display/Markdown.ts) — `slugify` (209), `appendHeading` (664) writing `setAttr: { id }`, `setMarkdown` (426) building synchronously when the element exists, and `measureContentHeight` (528) scheduling the parent's layout. Read only; nothing here changes.
- [`packages/lib/src/typescript/lib/core/DOM.ts`](packages/lib/src/typescript/lib/core/DOM.ts) — `getElementById` (1201), `contains` (1078), `getLocationHash` (1069), `getElementRect`.
- [`packages/docs/src/shell/DocsContent.ts`](packages/docs/src/shell/DocsContent.ts) — `showPath` (60), `onLinkClick` (76), `scrollToHeading` (131), and the `handleLinkClick` stable-arrow field (33) the new field copies.
- [`packages/docs/src/shell/DocsSidebar.ts`](packages/docs/src/shell/DocsSidebar.ts) — `onSelection` (88) and `select` (61), the feedback loop the new guard breaks.
- [`plans/focus-reveal-on-navigation.md`](plans/focus-reveal-on-navigation.md) — its `Panel.revealDescendant` snippet is the same scroll idiom; read it to confirm this plan does not duplicate it. Not a dependency.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — all DOM access through `DOM.sink` / `DOM.source`; listeners are named function references, never inline arrows.

---

## Non-Goals

- **The in-page outline (table of contents).** VitePress rendered one from `outline: { level: [2, 3] }`. Fragment resolution needs only "find the element with this id", which `DOM.source.getElementById` answers, so it produces none of the heading data an outline needs. Building one means a new `Markdown` API exposing an ordered heading list, a new sidebar component in the shell's east region, and scroll-spy to highlight the active section — three pieces of work, none of which this plan would otherwise touch.[^outline-not-small]
- **Smooth or animated scrolling to the fragment.** The jump is instantaneous, matching the existing bare-anchor behaviour.
- **Highlighting the target heading after the jump.** A separate presentation decision with its own theming tokens.
- **Fragment support in hash mode.** The `#` is spent on the route; there is nowhere to put it.
- **Percent-encoding or normalizing fragments.** A fragment is passed through verbatim so it matches the `id` in the DOM exactly.
- **Rewriting authored links.** No `/path#fragment` link in the corpus changes: all 89 authored-page fragments already resolve against the ids the viewer emits. The only authored page edited is `concepts/routing.md`, and only its prose about the router.
- **Query-string support.** `normalizePath` discards everything from the first `?`, and query parameters remain a documented router non-goal.
- **Extending or depending on `FocusReveal`.** See the decision above.

---

## Notes

[^fragments-verified]: Measured rather than assumed. Scanning `packages/lib/docs/{guide,concepts,components,layouts,data,recipes,reference}` for `](/path#fragment)` gives exactly 178 links: 89 into `/api/…` and 89 into authored pages. Re-implementing the viewer's rules — `slugify` from [`Markdown.ts:209`](packages/lib/src/typescript/lib/component/display/Markdown.ts#L209) plus the `-N` repeat suffix from `appendHeading` — over every authored page's headings and resolving all 89 authored-page fragments against the result produced **zero** mismatches. The `/api/` half is not directly verifiable yet because those pages are not registered, but the mechanism is the same: TypeDoc emits `### setOverflowY()`, which slugifies to `setoverflowy`, and `setoverflowy` is exactly the fragment the 172 `Component#setoverflowy` / `#setoverflowx` links use. Separately, `docs-content-migration` found and fixed the one mismatched bare `#anchor` in `DiagramView.md`; this scan confirms no equivalent mismatch exists in the cross-page set.

[^why-history-first]: Under hash routing the URL is `…/#/concepts/sizing`, so the `#` is already carrying the route and a second `#` cannot express a fragment. `docs-cutover` moves the site to History mode, at which point `location.pathname` carries the route and `location.hash` is free to be a real fragment again. The deployment-order constraint is separate from the code dependency: `docs-cutover` step 20 deletes the VitePress config and step 21 rewrites `.github/workflows/docs.yml` to upload `packages/docs/dist` as the Pages artifact. Step 21 is the commit after which the docs app *is* the published site, so it is the last moment at which these 178 links still work under VitePress. `docs-cutover`'s step 15 is a review-gate stop that already pauses the work in exactly the right place, between its app changes and its deployment changes, which makes it the natural slot to insert this plan.

[^library-not-app]: `docs-content-migration`'s `## Non-Goals` framed the choice as "fragment support in the library `Router` or an app-side pending-fragment buffer that still breaks on a direct reload", and the app-side buffer is worse for three separate reasons. First, an app that splices `#fragment` onto an href by hand duplicates the encoding `getHref` owns and must agree exactly with what `getPath` parses back — the drift `docs-cutover` centralized the URL seam to prevent. Second, `navigate`'s early return compares paths, so a link from `/concepts/sizing` to `/concepts/sizing#see-also` is a same-path write and would silently do nothing; the guard lives in the router, so only the router can widen it. Third, the router must *write* the fragment into the URL for a copied link, a reload, or the back button to work at all, and writing the URL is the router's job by construction. The library cost is small: one pure helper, one accessor, a widened guard, and one extra handler argument. The `Router` needs no new DOM-seam method, because in History mode `location.hash` already is the fragment and `getLocationHash()` already reads it.

[^hash-mode-strips]: The alternative — encoding a fragment inside the hash as `#/concepts/sizing#see-also` — was rejected. `normalizePath` would fold the second `#` into a path segment, so route matching would break, and every consumer of hash mode would inherit a URL grammar it never asked for. Hash mode remains the `Router` default, and discarding a fragment there is a documented, tested behaviour rather than an accident.

[^guard-widened]: `history.pushState` fires no event, so History-mode `navigate` calls the route handler itself; `docs-cutover` adds the early return so `DocsSidebar.select` cannot recurse through the selection listener. Widening the comparison to include the fragment keeps that protection intact — a genuinely identical target still returns early — while letting a fragment-only change through, which is the entire point of this plan. The recursion the guard protects against is additionally closed on the app side by the `DocsSidebar.onSelection` early return, so the two changes reinforce rather than replace each other.

[^two-step-timing]: The two calls solve two different problems. `Component.afterNextLayout` solves *the element may not exist yet*: on a cold direct load the route is applied from `router.start()`, and `Markdown.setMarkdown` caches its source when the element is absent, deferring the DOM build to `render()` during the first layout flush. Deferring the scroll past that flush guarantees the heading exists. `flushLayout()` solves *the pane cannot scroll that far yet*: `Markdown.measureContentHeight` folds the measured prose height into `getMinSize`, and it calls `scheduleLayout()` on its parent from inside `doLayout` — but `flushPendingLayouts` snapshots and clears the queue before laying anything out, so that schedule lands on the **following** frame. Until the parent re-lays-out, `Fit.inflateForOverflow` has not grown the pane's content and `getMaxScrollTop()` still reflects the previous page, so `setScrollTop` is clamped short or to zero. Forcing the pane's layout synchronously inside the callback settles the extent before the offset is written. Two alternatives were rejected: nesting a second `afterNextLayout` (works, but makes the reader count frames to understand the code), and polling `requestAnimationFrame` until the rect stabilises (the workaround `onFirstLayout`'s docblock explicitly exists to replace).

[^no-scroll-into-view]: `scrollIntoView` scrolls every `overflow: hidden` ancestor, and this project's components default to `overflow: hidden` while maintaining their own cached scroll offsets in `Component._scrollTop` / `_scrollLeft`. A native scroll moves the element without telling the cache, so the next `setScrollTop` computes from a stale base and the pane jumps. The framework's own reveal paths all avoid it: `Tree._scrollIntoView` works in row indices against the virtual scroller, `plans/focus-reveal-on-navigation.md` specifies `Panel.revealDescendant` in terms of `getElementRect` deltas and `setScrollTop` with a `grep -rn "scrollIntoView"` check to enforce it, and `FocusHistory` focuses with `{ preventScroll: true }` for the same reason. `DocsContent.scrollToHeading` was written to that pattern in Phase 1 and needs no change beyond its element lookup.

[^selector-throws]: `document.querySelector('#0-1-0')` throws `SyntaxError` — a CSS id selector cannot start with a digit without escaping. `packages/lib/docs/reference/changelog.md` has `## 0.1.0`, which the viewer renders with `id="0-1-0"`, so the case is real and reachable today. Building a selector from a URL fragment is also a small injection surface: `#a],[b` is a valid fragment and an attacker-supplied selector. `DOM.source.getElementById` takes the id as data and cannot be confused by either. It searches the whole document rather than the pane's subtree, so the `DOM.source.contains(scrollElement, heading)` check restores the scoping that `querySelector(scrollElement, …)` gave for free — which matters because component elements carry generated `id`s of their own.

[^one-mechanism]: Before this change, a bare `#custom-themes` link scrolled the pane and left the URL untouched, so the reader could not copy a link to the section they were looking at and the back button did not undo the jump. Routing it through `navigate` fixes both and collapses three cases — in-page anchor, cross-page fragment link, cold load — onto one code path ending in `showPath(path, fragment)`. The cost is one history entry per anchor click, which is what every documentation site does and what the back button is for. `docs-cutover`'s manual-verification bullet "An in-page `#anchor` link scrolls the content pane and leaves the path unchanged" stays true: the *path* does not change, only the fragment.

[^focus-reveal-independent]: `plans/focus-reveal-on-navigation.md` builds a `FocusReveal` broker so `FocusHistory` can surface a target hidden inside an unselected `Tab`, a collapsed `Border` region, or a scrolled-out `Panel` before focusing it. Three things make it the wrong dependency here. Its target is a focus `Handle` reached from a history trail, not an id resolved from a URL. Its `Panel` revealer scrolls *minimally* — only far enough for the element to be inside the viewport — whereas a fragment jump must put the heading at the top of the pane, which is a different write. And it is unimplemented, so depending on it would gate a user-visible regression fix on unrelated work. What this plan does take from it is the shape of the scroll: rect deltas through `getElementRect`, written with `setScrollTop`, never `scrollIntoView` — which `DocsContent.scrollToHeading` already implements. If `FocusReveal` later lands, the docs pane gains reveal-on-focus behaviour for free through `Panel`, with no conflict.

[^outline-not-small]: The test was whether fragment resolution produces the heading data an outline needs, and it does not. Resolving `#the-size-invariant` is a single `getElementById` call — it never enumerates headings, never learns their depths, and never learns their text. An outline needs an ordered list of `{ depth, text, id }`, which lives only inside `Markdown`'s render pass: `appendHeading` computes the slug and the `-N` suffix in a `Map` that is deliberately scoped to one render pass and discarded ("Threaded as a parameter (never a field) so it cannot survive past the render pass that created it"). Exposing it means a new public `Markdown` API with its own docs, tests, and lifecycle question about when the list is valid. On top of that sit a new outline component in the shell's east `Border` region, a width and responsive-collapse decision, and scroll-spy — a scroll listener on the content pane mapping offset to the active heading — to make it useful. That is a plan of its own, and `docs-content-migration` already lists the outline as owned by a later phase.

---

## Implementation Notes

Six deviations from the plan text, discovered during implementation, manual verification, and audit. None change the public API or the plan's architecture decisions; each is a correction to an assumption the plan text made about the surrounding codebase or test harness, or (item 6) a bug the audit's own live browser testing found.

**1. The offline `TestDOM` harness didn't model a fragment inside a History-mode `pushHistoryPath` URL.** The plan asserts `DOMSink.pushHistoryPath(url)` "writes a URL that already carries it" needing no new DOM-seam method — true in production, where `history.pushState(null, "", url)` natively splits the URL across `location.pathname` and `location.hash`. The offline `RecordingDOMSink` in `packages/lib/tests/dom/TestDOM.ts` did not reproduce that split: `pushHistoryPath`/`replaceHistoryPath` wrote the whole `url` string (fragment included) verbatim into the modelled `locationPathname`, leaving the modelled `locationHash` untouched. `Router.getFragment()`'s no-argument path reads `DOM.source.getLocationHash()`, so every fragment-carrying History-mode `navigate()` test would have read back `""` regardless of what was pushed. Fixed by giving `pushHistoryPath`/`replaceHistoryPath` a private `writeHistoryPath` helper that splits the URL at its first `"#"` the way a real `pushState` URL does, writing the two modelled fields separately. This file is not in the plan's Files to Create/Modify/Delete table; the fix was necessary for the Router.test.ts fragment cases (added per step 5) to exercise real behaviour rather than a harness artifact.

**2. `resolveApiLink`'s relative-link fragment stripping was left unchanged, so both step 7's own Check line and the broader `Verification` grep line don't come back clean.** Step 7 and the `## Expected Behaviour` bullets scope the fragment-carrying change to `resolveDocLink`'s route branch only; `resolveApiLink`'s relative `.md` link branch (used only when browsing an already-rendered API page) keeps its own `href.split('#')[0]`, and its own pre-existing tests (stripping a fragment from `BaseObject.md#constructor` etc.) were left untouched, per the plan's explicit scope. Both `resolveDocLink` and `resolveApiLink` live in `packages/docs/src/content/links.ts`, so step 7's own file-scoped Check (`grep -n "split('#')" packages/docs/src/content/links.ts`, line 304) does **not** come back with zero matches — it still finds the one call inside `resolveApiLink`, same as the `## Verification` section's broader `grep -rn "split('#')" packages/docs/src/` line. Left as-is rather than changed to satisfy either grep, because the corpus guard in step 15 only validates the authored 7-section glob (which never contains `/api/...`), so a relative in-page-API-doc cross-link's fragment is outside what step 15 (or any other step) verifies; extending `resolveApiLink` would be unreviewed, untested scope creep beyond what the plan specified. Both Check lines are treated as not-fully-satisfied by design, not passed on a technicality.

**3. Step 4's own "Check" line is not independently green** — `npm -w packages/lib run test -- router` does *not* stay fully green immediately after step 4 alone, before step 5's test-file edits land. Adding `fragment: string` to `RouteMatch` means every emitted `RouteMatch` now carries `fragment: ""` even in hash mode; three pre-existing `toEqual` assertions in `Router.test.ts` (asserting a `RouteMatch`/navigate-event object without a `fragment` key) fail under vitest's `toEqual`, which does not ignore an *actual* object's extra defined property just because the *expected* literal omits the key (verified directly: `toEqual({...no fragment})` against an actual value with `fragment: ''` fails). This is a plan-authoring imprecision in the per-step check's ordering, not a design defect — step 5's own check ("the whole existing suite stays green") is unaffected and does hold once its assertions are updated. Implemented steps 4 and 5 as one combined red→green unit instead of treating step 4's check as a standalone gate; the three affected assertions each gained a `fragment: ''` (or the real fragment, for the two new fragment-specific popstate/navigate tests added alongside them) to match the widened `RouteMatch` shape.

**4. `DocsContent.onScrollToFragment` needed an extra `syncScrollOffsets()` call the plan's `## Internal Structure` snippet doesn't show — found by the plan's own "Cold direct load" manual-verification case.** Running that exact case (typing `/typescript-ui/concepts/sizing#the-size-invariant` into the address bar against both `npm run dev` and `build && preview`) landed the pane at the top instead of at the heading. Root-caused via targeted `console.log` instrumentation (removed before commit) plus live DOM inspection through `chrome-devtools` MCP tools: on a *real* page load with a URL fragment, the browser's own fragment-identifier handling scrolls the pane's native scrollable element (`.PanelOverlayScroller`, the raw element `Panel`'s overlay-scrollbar implementation scrolls) as soon as an element with the matching `id` appears in the DOM — entirely outside `Component.setScrollTop`, and therefore invisible to `Component`'s cached `_scrollTop` field, which stays at its construction-time `0`. `scrollToHeading`'s delta-based write (`setScrollTop(getScrollTop() + (headingTop - paneTop))`) then read `headingTop` correctly (already near `paneTop`, because the browser had already all-but-scrolled it into view) but added that near-zero delta to the *stale cached* `getScrollTop()` of `0` — overwriting the browser's own scroll back to the top instead of refining it. The plan's own `Component` reference lists `getMaxScrollTop` and `flushLayout` under Critical Files but not `syncScrollOffsets` (`packages/lib/src/typescript/lib/core/Component.ts`), the method the framework already exposes for exactly this class of problem — its own docblock names a different trigger ("the browser also clamps the native offset on its own when the scrollable range shrinks... bypassing those setters and leaving the cache stale") but the fix is identical: re-read the DOM's real scroll offsets into the cache before computing a delta against it. Fixed by calling `this.syncScrollOffsets()` in `onScrollToFragment`, immediately after `flushLayout()` and before `scrollToHeading()`. A client-side `navigate()` (via `pushState`) never triggers the browser's native fragment-scroll, so the added call is a harmless no-op on every non-cold-load path — confirmed by re-running the full manual-verification list (cross-page, same-page, back/forward under both `dev` and `build`+`preview`, sidebar, missing target, digit-leading id) with the fix in place, all matching the plan's expected outcomes within a fraction of a pixel.

**5. Step 15's "extend the bare-`#anchor` case" was implemented as a new sibling `it.each` test rather than literally growing the same `it` body.** `content-constructs.test.ts`'s existing tests are already one-construct-per-`it.each` (raw HTML, images, containers, frontmatter, bare anchors, each get their own block); a new `it.each(PAGES)('%s resolves every /path#fragment link to a heading on the target page', ...)` follows that established shape rather than folding a second, unrelated assertion into the bare-anchor test's body. Same coverage (every `/path#fragment` link whose path resolves against the corpus is checked against the target page's heading ids, reporting the source file and the dangling `path#fragment`), same file, same section of the plan's step 15 — a test-organisation call, not a scope or behaviour change.

**6. `DocsContent.showPath`/`showSource` threaded `fragment` as a plain parameter through the async API-fetch branch, which the plan's `## Internal Structure` snippet shows but which admits a race: a same-path, different-fragment navigation arriving while an earlier fetch for that path is still in flight clobbers the newer fragment with the stale one closed over by the first call.** Found by the audit's own live reproduction against a running dev server (navigating to an uncached `/api/…` page, then immediately to the same page with a different fragment, before the first `fetchApiPage` promise settled): the URL correctly showed the second fragment, but the pane scrolled to the *first*. Root cause: the `path === this._path` early-return branch (added for the fragment-only-navigation case) does not bump `_requestToken`, so the first fetch's `.then()` callback — still holding the `fragment` parameter value from *its own* call — passes the token check and overwrites `_pendingFragment` with the stale value after the second call had already set it correctly. Fixed by replacing the `fragment` parameter on `showSource` with a `_targetFragment` field that every `showPath` call (both the early-return and the re-render branches) writes unconditionally at the top, before any async work starts; the fetch continuation reads `this._targetFragment` at resolution time instead of closing over the value from when it started, so whichever `showPath` call was most recent always wins regardless of fetch ordering. No unit test covers this — `DocsContent` has no existing unit-test file (it is a `Panel` subclass needing the full component/DOM harness, consistent with the plan's decision to cover this class only through the manual-verification list) — verified instead by live-reproducing the exact race against the running app both before the fix (confirmed broken, matching the audit's report) and after (confirmed fixed: the pane lands on the second-requested heading, off by a fraction of a pixel, and the stale first heading is off-screen).
