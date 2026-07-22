// The not-found (and fetch-failure) view's Markdown source. Lives here rather
// than in `shell/DocsContent.ts` for the reason every other pure source
// transform in this directory does: `shell/` modules construct components at
// import time and need a DOM, so they cannot be unit-tested, while this is
// plain string work with cases worth pinning — see `containers.ts` for the
// same split.

/**
 * Markdown source for a route that resolves to no page.
 *
 * A path under the generated API reference gets its own message naming the
 * reference specifically, rather than the generic "not migrated" wording:
 * real API pages render in this app now (`DocsContent.showPath` resolves them
 * through `apiFileFor` before ever reaching this function), so this branch
 * only fires for a path with no matching generated file — a removed symbol
 * or a typo — see "Reconciling the /api/ not-found message" in
 * plans/implemented/docs-typedoc-reference.md.
 *
 * @param path - The route path that has no matching page.
 * @returns Markdown source for the not-found view.
 */
export function notFoundSource(path: string): string {
    // `/api` as well as `/api/…`: the router's `normalizePath` collapses a
    // trailing slash, so the corpus's `/api/` links (the Guide landing page and
    // the Components catalog among them) arrive here as a bare `/api`.
    if (path === '/api' || path.startsWith('/api/')) {
        return `# Not found\n\n\`${path}\` does not match a page in the generated API reference.`;
    }

    return `# Not found\n\n\`${path}\` has not been migrated to this preview yet.`;
}

/**
 * Markdown source for an API page whose fetch failed (a network error, a
 * non-OK response) — distinct from {@link notFoundSource} because the page is
 * known to exist; the fetch itself is what failed.
 *
 * @param path - The route path the fetch was for.
 * @returns Markdown source for the error view.
 */
export function fetchErrorSource(path: string): string {
    return `# Failed to load\n\n\`${path}\` could not be fetched from the generated API reference.`;
}
