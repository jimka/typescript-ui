import { describe, it, expect } from 'vitest';
import { Router } from '@jimka/typescript-ui/router';
import { resolveDocLink, resolveApiLink } from '../src/content/links.js';
import { getPage } from '../src/content/pages.js';
import { apiFileFor, isApiPath } from '../src/content/api.js';

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

const CORPUS = import.meta.glob(
    '../../lib/docs/{guide,concepts,components,layouts,data,recipes,reference,reference/changelog,reference/migration}/*.md',
    { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

// Copied from content-constructs.test.ts:51-81 rather than imported, matching
// that file's own deliberate duplication of routePathFor and slugify — this
// guard exercises the actual authored corpus independently of any other
// guard's helpers.
function stripCode(source: string): string {
    // The lookarounds are load-bearing: without them a run of N backticks can
    // close against the first N backticks of a *longer* run, and the scan then
    // swallows everything up to the next accidental match. On
    // `components/MarkdownEditor.md:53` — `| Fenced code | ` ``` ` fence |` —
    // the 1-backtick opener closed against the first backtick of the ``` run
    // and ate 12 lines, hiding them from every assertion below. Requiring the
    // closing run to be a whole run (CommonMark's own rule) fixes it.
    return stripFences(source)
        .replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, '');   // inline code spans, any backtick run
}

/**
 * `source` with fenced blocks removed but inline code spans left intact.
 *
 * @param source - A page's raw Markdown source.
 * @returns `source` with fenced code blocks removed.
 */
function stripFences(source: string): string {
    return source.replace(/^([ \t]*)```[\s\S]*?^\1```[ \t]*$/gm, '');   // fenced blocks, incl. indented
}

/** Every `](/…)` target on the page, fragment and trailing slash normalized away. */
function internalLinkPaths(source: string): string[] {
    return [...stripCode(source).matchAll(/\]\((\/[^)\s]*)\)/g)]
        .map((match) => match[1].split('#')[0].replace(/\/$/, '') || '/');
}

function resolves(path: string): boolean {
    return isApiPath(path) ? apiFileFor(path) !== null : getPage(path) !== null;
}

describe('internalLinkPaths', () => {
    it('strips the #fragment from a route link', () => {
        expect(internalLinkPaths('see [x](/concepts/sizing#the-size-invariant)')).toEqual(['/concepts/sizing']);
    });

    it('strips the trailing slash of a directory-index link', () => {
        expect(internalLinkPaths('see [x](/layouts/)')).toEqual(['/layouts']);
    });

    it('strips the trailing slash of the api root link', () => {
        expect(internalLinkPaths('see [x](/api/)')).toEqual(['/api']);
    });

    it('collects only absolute site paths, not external or in-page links', () => {
        expect(internalLinkPaths('see [x](https://example.com)')).toEqual([]);
        expect(internalLinkPaths('see [x](#anchor)')).toEqual([]);
    });

    it('ignores a dangling-looking href inside a fenced block', () => {
        expect(internalLinkPaths('```\n](/nope)\n```')).toEqual([]);
    });

    it('ignores a dangling-looking href inside an inline code span', () => {
        expect(internalLinkPaths('`](/nope)`')).toEqual([]);
    });
});

describe('resolves', () => {
    it('resolves an authored page path via getPage', () => {
        expect(resolves('/concepts/sizing')).toBe(true);
        expect(resolves('/layouts')).toBe(true);
        expect(resolves('/api')).toBe(true);
    });

    it('resolves an /api/… path via apiFileFor', () => {
        expect(resolves('/api/core/namespaces/Animation')).toBe(true);
        expect(resolves('/api/core/classes/Animation')).toBe(false);
    });

    it('fails a path that matches no page', () => {
        expect(resolves('/concepts/architecture')).toBe(false);
        expect(resolves('/nope')).toBe(false);
    });
});

describe('corpus link guard', () => {
    it.each(Object.entries(CORPUS))('%s has no dangling internal link', (path, raw) => {
        const dangling = internalLinkPaths(raw).filter((target) => !resolves(target));

        expect(dangling, `${path} links dangling target(s): ${dangling.join(', ')}`).toHaveLength(0);
    });
});
