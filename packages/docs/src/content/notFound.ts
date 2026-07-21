// The not-found view's Markdown source. It lives here rather than in
// `shell/DocsContent.ts` for the reason every other pure source transform in
// this directory does: `shell/` modules construct components at import time and
// need a DOM, so they cannot be unit-tested, while this is plain string work
// with cases worth pinning — see `containers.ts` for the same split.

/**
 * Markdown source for a route that resolves to no page.
 *
 * A path under the generated API reference gets its own message: that surface
 * is owned by a later phase, and until it lands it accounts for the large
 * majority of the corpus's dead links, so the commonest dead end names the
 * published reference instead of reading as a broken app. See "The not-found
 * view names the API reference specially" in
 * plans/implemented/docs-content-migration.md.
 *
 * @param path - The route path that has no matching page.
 * @returns Markdown source for the not-found view.
 */
export function notFoundSource(path: string): string {
    // `/api` as well as `/api/…`: the router's `normalizePath` collapses a
    // trailing slash, so the corpus's `/api/` links (the Guide landing page and
    // the Components catalog among them) arrive here as a bare `/api`.
    if (path === '/api' || path.startsWith('/api/')) {
        return '# API reference\n\n'
            + 'The generated API reference is not part of this preview. '
            + 'See the [published API reference](https://jimka.github.io/typescript-ui/api/).';
    }

    return `# Not found\n\n\`${path}\` has not been migrated to this preview yet.`;
}
