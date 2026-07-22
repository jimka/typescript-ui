import { describe, it, expect } from 'vitest';
import { hashHref, resolveDocLink, resolveApiLink } from '../src/content/links.js';

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

describe('resolveApiLink', () => {
    it('resolves a relative generated link against baseDir, joining .. segments', () => {
        expect(resolveApiLink('../../../core/classes/Component.md', 'component/button/classes'))
            .toEqual({ href: '#/api/core/classes/Component', external: false });
    });

    it('resolves a same-directory relative link', () => {
        expect(resolveApiLink('classes/Panel.md', 'core'))
            .toEqual({ href: '#/api/core/classes/Panel', external: false });
    });

    it('resolves a relative link up to the API root index', () => {
        expect(resolveApiLink('../../index.md', 'core/classes'))
            .toEqual({ href: '#/api', external: false });
    });

    it('resolves an absolute API href unchanged in kind (delegates to resolveDocLink)', () => {
        expect(resolveApiLink('/api/layout/classes/Tab', 'core/classes'))
            .toEqual({ href: '#/api/layout/classes/Tab', external: false });
    });

    it('keeps an in-page #fragment href unchanged and non-external', () => {
        expect(resolveApiLink('#setscrollleft', 'core/classes'))
            .toEqual({ href: '#setscrollleft', external: false });
    });

    it('marks an external href unchanged', () => {
        expect(resolveApiLink('https://github.com/x', 'core/classes'))
            .toEqual({ href: 'https://github.com/x', external: true });
    });

    it('routes an absolute non-API href through the authored-page rule', () => {
        expect(resolveApiLink('/concepts/sizing', 'core/classes'))
            .toEqual({ href: '#/concepts/sizing', external: false });
    });

    it('does not produce a leading slash when baseDir is empty', () => {
        expect(resolveApiLink('Component.md', ''))
            .toEqual({ href: '#/api/Component', external: false });
    });

    it('strips a #fragment from a relative generated link before resolving, matching resolveDocLink', () => {
        expect(resolveApiLink('BaseObject.md#constructor', 'core/classes'))
            .toEqual({ href: '#/api/core/classes/BaseObject', external: false });
    });

    it('strips a #fragment from a dotted relative link, joining .. segments first', () => {
        expect(resolveApiLink('../../../core/classes/Component.md#setscrollleft', 'component/button/classes'))
            .toEqual({ href: '#/api/core/classes/Component', external: false });
    });
});
