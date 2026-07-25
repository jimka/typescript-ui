import { describe, it, expect } from 'vitest';
import { Router } from '@jimka/typescript-ui/router';
import { resolveDocLink, resolveApiLink } from '../src/content/links.js';

// import.meta.env.BASE_URL is '/' under vitest, not the deployed base, so the
// fixture router builds its base explicitly — see "import.meta.env.BASE_URL
// under vitest" in plans/implemented/docs-cutover.md.
const router = new Router({ mode: 'history', base: '/typescript-ui/' });

describe('resolveDocLink', () => {
    it('rewrites a route href through router.getHref, non-external', () => {
        expect(resolveDocLink('/concepts/sizing', router)).toEqual({ href: '/typescript-ui/concepts/sizing', external: false });
    });

    it('normalizes away the trailing slash of a directory-index route href', () => {
        expect(resolveDocLink('/guide/', router)).toEqual({ href: '/typescript-ui/guide', external: false });
    });

    it('carries a #fragment on a route href through router.getHref', () => {
        expect(resolveDocLink('/concepts/sizing#the-size-invariant', router))
            .toEqual({ href: '/typescript-ui/concepts/sizing#the-size-invariant', external: false });
    });

    it('carries the corpus\'s most-linked fragment (15 occurrences) through router.getHref', () => {
        expect(resolveDocLink('/concepts/theming#theme-keys', router))
            .toEqual({ href: '/typescript-ui/concepts/theming#theme-keys', external: false });
    });

    it('normalizes away the trailing slash of a directory-index route href while keeping the fragment', () => {
        expect(resolveDocLink('/guide/#intro', router))
            .toEqual({ href: '/typescript-ui/guide#intro', external: false });
    });

    it('passes an https href with a #fragment through unchanged, external', () => {
        expect(resolveDocLink('https://example.com#x', router)).toEqual({ href: 'https://example.com#x', external: true });
    });

    it('passes an in-page href through unchanged, non-external', () => {
        expect(resolveDocLink('#custom-themes', router)).toEqual({ href: '#custom-themes', external: false });
    });

    it('marks an http(s) href external, unchanged', () => {
        expect(resolveDocLink('https://example.com', router)).toEqual({ href: 'https://example.com', external: true });
    });

    it('marks a mailto href external, unchanged', () => {
        expect(resolveDocLink('mailto:x@example.com', router)).toEqual({ href: 'mailto:x@example.com', external: true });
    });

    it('marks only http(s)/mailto hrefs external', () => {
        expect(resolveDocLink('/guide/installation', router).external).toBe(false);
        expect(resolveDocLink('#anchor', router).external).toBe(false);
        expect(resolveDocLink('https://example.com', router).external).toBe(true);
    });
});

describe('resolveApiLink', () => {
    it('resolves a relative generated link against baseDir, joining .. segments', () => {
        expect(resolveApiLink('../../../core/classes/Component.md', 'component/button/classes', router))
            .toEqual({ href: '/typescript-ui/api/core/classes/Component', external: false });
    });

    it('resolves a same-directory relative link', () => {
        expect(resolveApiLink('classes/Panel.md', 'core', router))
            .toEqual({ href: '/typescript-ui/api/core/classes/Panel', external: false });
    });

    it('resolves a relative link up to the API root index', () => {
        expect(resolveApiLink('../../index.md', 'core/classes', router))
            .toEqual({ href: '/typescript-ui/api', external: false });
    });

    it('resolves an absolute API href unchanged in kind (delegates to resolveDocLink)', () => {
        expect(resolveApiLink('/api/layout/classes/Tab', 'core/classes', router))
            .toEqual({ href: '/typescript-ui/api/layout/classes/Tab', external: false });
    });

    it('keeps an in-page #fragment href unchanged and non-external', () => {
        expect(resolveApiLink('#setscrollleft', 'core/classes', router))
            .toEqual({ href: '#setscrollleft', external: false });
    });

    it('marks an external href unchanged', () => {
        expect(resolveApiLink('https://github.com/x', 'core/classes', router))
            .toEqual({ href: 'https://github.com/x', external: true });
    });

    it('routes an absolute non-API href through the authored-page rule', () => {
        expect(resolveApiLink('/concepts/sizing', 'core/classes', router))
            .toEqual({ href: '/typescript-ui/concepts/sizing', external: false });
    });

    it('does not produce a leading slash when baseDir is empty', () => {
        expect(resolveApiLink('Component.md', '', router))
            .toEqual({ href: '/typescript-ui/api/Component', external: false });
    });

    it('strips a #fragment from a relative generated link before resolving, matching resolveDocLink', () => {
        expect(resolveApiLink('BaseObject.md#constructor', 'core/classes', router))
            .toEqual({ href: '/typescript-ui/api/core/classes/BaseObject', external: false });
    });

    it('strips a #fragment from a dotted relative link, joining .. segments first', () => {
        expect(resolveApiLink('../../../core/classes/Component.md#setscrollleft', 'component/button/classes', router))
            .toEqual({ href: '/typescript-ui/api/core/classes/Component', external: false });
    });
});
