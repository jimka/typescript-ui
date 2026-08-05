// @vitest-environment jsdom
//
// DocsContent constructs library components (Panel, Markdown), whose bundled
// module evaluates a top-level `Body` singleton that reads `document` at
// import time — same reason demos.test.ts needs a real DOM (see its own top
// comment). This package has no access to packages/lib's modelled DOM test
// harness (installTestDOM), which is test-only and not published, so this
// exercises the real thing through jsdom instead. `getPage` is mocked so
// each test controls its own page source rather than depending on real
// authored content.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Router } from '@jimka/typescript-ui/router';
import type { MarkdownHeading } from '@jimka/typescript-ui/component/display';
import { DocsContent } from '../src/shell/DocsContent.js';
import { getPage } from '../src/content/pages.js';
import type { DocPage } from '../src/content/pages.js';

vi.mock('../src/content/pages.js', () => ({ getPage: vi.fn() }));

function mockPage(path: string, source: string): void {
    vi.mocked(getPage).mockImplementation((p) =>
        p === path ? ({ path, title: 'Test', source } as DocPage) : null);
}

let router: Router;
let content: DocsContent;

beforeEach(() => {
    router = new Router();
});

afterEach(() => {
    content.dispose();
});

describe('DocsContent outlinechange', () => {
    it('fires once with both headings, in document order, for a page with two headings', () => {
        mockPage('/two-headings', '# A\n\ntext\n\n## B\n');
        content = new DocsContent(router);
        const listener = vi.fn();
        content.on('outlinechange', listener);

        content.showPath('/two-headings', '');

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith([
            { id: 'a', text: 'A', depth: 1 },
            { id: 'b', text: 'B', depth: 2 },
        ] satisfies MarkdownHeading[]);
    });

    it('fires with [] for a page with no headings, rather than skipping the event', () => {
        mockPage('/no-headings', 'Just prose, no headings at all.\n');
        content = new DocsContent(router);
        const listener = vi.fn();
        content.on('outlinechange', listener);

        content.showPath('/no-headings', '');

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith([]);
    });

    it('concatenates only the markdown blocks\' headings, skipping a demo block, in document order', () => {
        mockPage('/with-demo', [
            '# Intro',
            '',
            '<!-- demo: some-demo -->',
            '> fallback, dropped',
            '<!-- /demo -->',
            '',
            '## Outro',
            '',
        ].join('\n'));
        content = new DocsContent(router);
        const listener = vi.fn();
        content.on('outlinechange', listener);

        content.showPath('/with-demo', '');

        expect(listener).toHaveBeenCalledWith([
            { id: 'intro', text: 'Intro', depth: 1 },
            { id: 'outro', text: 'Outro', depth: 2 },
        ] satisfies MarkdownHeading[]);
    });

    it('does not re-fire on a fragment-only navigation to the same path', () => {
        mockPage('/same-page', '# A\n\n## B\n');
        content = new DocsContent(router);
        const listener = vi.fn();
        content.on('outlinechange', listener);

        content.showPath('/same-page', '');
        content.showPath('/same-page', 'b');

        expect(listener).toHaveBeenCalledTimes(1);
    });
});
