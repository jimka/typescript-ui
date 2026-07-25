import type { MarkdownLinkResolution } from '@jimka/typescript-ui/component/display';
import type { Router } from '@jimka/typescript-ui/router';
import { apiRouteFor } from './api.js';

/**
 * Maps an authored doc href to its rendered form, by kind: a route (`/…`,
 * with any `#fragment` carried through) is rewritten through
 * `router.getHref`, an in-page reference (`#…`) passes through unchanged and
 * non-external, and everything else (`http:`, `mailto:`, …) passes through
 * unchanged and external — see "Link resolution in the docs app" in
 * plans/implemented/packages-docs.md.
 *
 * @param href - The authored Markdown link href.
 * @param router - The app's router; owns the href encoding for its mode and base.
 * @returns The rendered href and whether it is external.
 */
export function resolveDocLink(href: string, router: Router): MarkdownLinkResolution {
    if (href.startsWith('#')) {
        return { href, external: false };
    }

    if (href.startsWith('/')) {
        return { href: router.getHref(href), external: false };
    }

    return { href, external: true };
}

/**
 * Joins a generated page's relative `href` (e.g. `../../../core/classes/
 * Component.md`) onto `baseDir` (the directory of the page currently
 * rendered), resolving `.` and `..` segments, and returns the joined file
 * path relative to `packages/lib/docs/api`.
 *
 * @param baseDir - The directory of the page being rendered, `''` at the tree root.
 * @param href - The relative `.md` link authored in the generated page.
 * @returns The joined file path.
 */
function joinApiPath(baseDir: string, href: string): string {
    const segments = baseDir === '' ? [] : baseDir.split('/');

    for (const part of href.split('/')) {
        if (part === '.') continue;
        if (part === '..') segments.pop();
        else segments.push(part);
    }

    return segments.join('/');
}

/**
 * Resolves a link authored inside a generated API page. `baseDir` is the
 * directory of the page being rendered, e.g. `component/button/classes`. The
 * first matching branch wins: an in-page `#fragment` passes through
 * unchanged; an absolute site path (`/…`) delegates to {@link resolveDocLink};
 * a relative `.md` link — with any `#fragment` stripped first, the same rule
 * {@link resolveDocLink} applies to a route href, since a member cross-link
 * like `BaseObject.md#constructor` is a link to another *page*, not an
 * in-page reference — is joined onto `baseDir` and mapped to its route
 * through {@link apiRouteFor}. Anything else is external, unchanged — see
 * "Links inside API pages resolve against the current page's directory" in
 * plans/implemented/docs-typedoc-reference.md.
 *
 * @param href - The authored href, as it appears in the generated Markdown.
 * @param baseDir - The directory of the page being rendered, e.g. "component/button/classes".
 * @param router - The app's router; owns the href encoding for its mode and base.
 * @returns The rendered href and whether it is external.
 */
export function resolveApiLink(href: string, baseDir: string, router: Router): MarkdownLinkResolution {
    if (href.startsWith('#')) {
        return { href, external: false };
    }

    if (href.startsWith('/')) {
        return resolveDocLink(href, router);
    }

    const withoutFragment = href.split('#')[0];

    if (withoutFragment.endsWith('.md')) {
        return { href: router.getHref(apiRouteFor(joinApiPath(baseDir, withoutFragment))), external: false };
    }

    return { href, external: true };
}
