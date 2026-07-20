import type { MarkdownLinkResolution } from '@jimka/typescript-ui/component/display';

/**
 * Builds the in-app href for a site path.
 *
 * @param path - A leading-slash site path, e.g. `/guide/installation`.
 * @returns The in-app hash href, e.g. `#/guide/installation`.
 */
export function hashHref(path: string): string {
    return '#' + path;
}

/**
 * Maps an authored doc href to its rendered form, by kind: a route (`/…`) is
 * rewritten through {@link hashHref} with any `#fragment` stripped first, an
 * in-page reference (`#…`) passes through unchanged and non-external, and
 * everything else (`http:`, `mailto:`, …) passes through unchanged and
 * external — see "Link resolution in the docs app" in
 * plans/implemented/packages-docs.md.
 *
 * @param href - The authored Markdown link href.
 * @returns The rendered href and whether it is external.
 */
export function resolveDocLink(href: string): MarkdownLinkResolution {
    if (href.startsWith('#')) {
        return { href, external: false };
    }

    if (href.startsWith('/')) {
        return { href: hashHref(href.split('#')[0]), external: false };
    }

    return { href, external: true };
}
