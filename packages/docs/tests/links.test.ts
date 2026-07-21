import { describe, it, expect } from 'vitest';
import { hashHref, resolveDocLink } from '../src/content/links.js';

describe('hashHref', () => {
    it('prefixes the path with #', () => {
        expect(hashHref('/guide/installation')).toBe('#/guide/installation');
    });
});

describe('resolveDocLink', () => {
    it('rewrites a route href through hashHref, non-external', () => {
        expect(resolveDocLink('/concepts/sizing')).toEqual({ href: '#/concepts/sizing', external: false });
    });

    it('does not strip the trailing slash of a directory-index route href', () => {
        expect(resolveDocLink('/guide/')).toEqual({ href: '#/guide/', external: false });
    });

    it('strips a #fragment from a route href before hashHref', () => {
        expect(resolveDocLink('/guide/mental-model#jsx-shaped-without-jsx'))
            .toEqual({ href: '#/guide/mental-model', external: false });
    });

    it('passes an in-page href through unchanged, non-external', () => {
        expect(resolveDocLink('#custom-themes')).toEqual({ href: '#custom-themes', external: false });
    });

    it('marks an http(s) href external, unchanged', () => {
        expect(resolveDocLink('https://example.com')).toEqual({ href: 'https://example.com', external: true });
    });

    it('marks a mailto href external, unchanged', () => {
        expect(resolveDocLink('mailto:x@example.com')).toEqual({ href: 'mailto:x@example.com', external: true });
    });

    it('marks only http(s)/mailto hrefs external', () => {
        expect(resolveDocLink('/guide/installation').external).toBe(false);
        expect(resolveDocLink('#anchor').external).toBe(false);
        expect(resolveDocLink('https://example.com').external).toBe(true);
    });
});
