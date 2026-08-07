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
import { Body } from '@jimka/typescript-ui/core';
import { Fit } from '@jimka/typescript-ui/layout';
import { Router } from '@jimka/typescript-ui/router';
import type { MarkdownHeading } from '@jimka/typescript-ui/component/display';
import { DocsContent } from '../src/shell/DocsContent.js';
import { getPage } from '../src/content/pages.js';
import type { DocPage } from '../src/content/pages.js';
import { apiFileFor, fetchApiPage } from '../src/content/api.js';
import { loadShowInheritedMembers } from '../src/content/apiPreferences.js';

vi.mock('../src/content/pages.js', () => ({ getPage: vi.fn() }));

// Real `apiDirOf`/`apiRouteFor` (and everything else the module exports) pass
// through unmocked — only the two functions an API-page fixture needs to
// control are replaced, mirroring the `getPage` mock above.
vi.mock('../src/content/api.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/content/api.js')>();

    return { ...actual, apiFileFor: vi.fn(), fetchApiPage: vi.fn() };
});

function mockPage(path: string, source: string): void {
    vi.mocked(getPage).mockImplementation((p) =>
        p === path ? ({ path, title: 'Test', source } as DocPage) : null);
}

function mockApiPage(path: string, file: string, source: string): void {
    vi.mocked(apiFileFor).mockImplementation((p) => (p === path ? file : null));
    vi.mocked(fetchApiPage).mockImplementation((f) =>
        f === file ? Promise.resolve(source) : Promise.reject(new Error(`unexpected file: ${f}`)));
}

// This jsdom build's own `window.localStorage` has no working Storage
// prototype in this environment (every method reads back `undefined`), so
// `apiPreferences.ts`'s real getItem/setItem calls need a working stand-in
// to exercise the round-trip the tests below assert on. A fresh in-memory
// store per test keeps them isolated with no explicit clearing step.
function stubMemoryStorage(): void {
    const store = new Map<string, string>();

    vi.stubGlobal('localStorage', {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
    });
}

let router: Router;
let content: DocsContent;

// Set by mountAndFindScrollPane when a test mounts `content` into the Body
// singleton — Body outlives every test, so afterEach must explicitly detach
// `content` from it (removeComponent never disposes) before disposing, or a
// later test's Body.init call finds this test's now-destroyed content still
// sitting in Body's children alongside the new one.
let mountedBody: Body | null = null;

beforeEach(() => {
    router = new Router();
    stubMemoryStorage();
    // Isolates each test's fetchApiPage call-count assertions from every
    // other test sharing the same vi.mock'd module-level mock functions.
    vi.clearAllMocks();
});

afterEach(() => {
    mountedBody?.removeComponent(content);
    mountedBody = null;
    content.dispose();
    vi.unstubAllGlobals();
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

/**
 * Mounts `content` into a real, connected DOM (mirroring `DocsSidebar.test.ts`'s
 * own `Body.init` + `flushLayout` idiom) and resolves the raw element that
 * `getScrollElement()` reads native `"scroll"` events from: the id-less
 * overlay-scroller div Panel's default `scrollbarStyle: "overlay"` wraps
 * content in, found via its shared `PanelOverlayScroller` class (see
 * `core/Panel.ts`), falling back to the panel's own element if overlay mode
 * never installed (e.g. no measured overflow in jsdom's layout-free DOM).
 */
function mountAndFindScrollPane(): Element {
    const body = Body.init({ layoutManager: Fit(), components: [content] });

    mountedBody = body;
    body.flushLayout();

    const root = document.getElementById(content.getId())!;

    return root.querySelector('.PanelOverlayScroller') ?? root;
}

/** Stubs a real jsdom element's `getBoundingClientRect().top` (jsdom never lays out for real). */
function stubTop(element: Element, top: number): void {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        top, left: 0, right: 0, bottom: top, width: 0, height: 0, x: 0, y: top,
        toJSON: () => ({}),
    } as DOMRect);
}

describe('DocsContent.getTextColumnReference', () => {
    it('returns null before any page has rendered', () => {
        content = new DocsContent(router);

        expect(content.getTextColumnReference()).toBeNull();
    });

    it('returns the page\'s first block once a page has rendered', () => {
        mockPage('/text-column', '# A\n\ntext\n');
        content = new DocsContent(router);

        content.showPath('/text-column', '');

        expect(content.getTextColumnReference()).not.toBeNull();
    });

    it('re-reads live rather than returning a cached reference, so it points at the new first block after navigating to a different page', () => {
        vi.mocked(getPage).mockImplementation((p) => {
            if (p === '/first')  return { path: p, title: 'Test', source: '# A\n\ntext\n' } as DocPage;
            if (p === '/second') return { path: p, title: 'Test', source: '# B\n\ntext\n' } as DocPage;
            return null;
        });
        content = new DocsContent(router);

        content.showPath('/first', '');
        const first = content.getTextColumnReference();

        content.showPath('/second', '');
        const second = content.getTextColumnReference();

        expect(second).not.toBeNull();
        expect(second).not.toBe(first);
    });
});

describe('DocsContent prose left margin', () => {
    it('gives a markdown block a left margin, so prose reads like a page rather than sitting flush against the pane edge', () => {
        mockPage('/prose-margin', '# A\n\ntext\n');
        content = new DocsContent(router);

        content.showPath('/prose-margin', '');

        expect(content.getTextColumnReference()?.getPadding()?.getLeft()).toBe(32);
    });
});

describe('DocsContent activeheadingchange', () => {
    // The pane's own viewport rect stays fixed (its frame doesn't move as its
    // content scrolls); a heading counts as "scrolled past" — and therefore a
    // candidate for active — only once its own top has dropped to at or below
    // the pane's fixed top. Scrolling down further is modelled by moving more
    // headings' stubbed tops at-or-below that fixed pane top, not by moving
    // the pane.
    it('fires with the topmost visible heading id as the pane scrolls', () => {
        mockPage('/scroll-headings', '# Introduction\n\n## Getting Started\n\n### Install\n');
        content = new DocsContent(router);
        content.showPath('/scroll-headings', '');

        const pane = mountAndFindScrollPane();
        const listener = vi.fn();

        content.on('activeheadingchange', listener);

        stubTop(pane, 0);
        // Introduction has scrolled past the pane's top; the other two are
        // still below it (not yet reached).
        stubTop(document.getElementById('introduction')!, -10);
        stubTop(document.getElementById('getting-started')!, 500);
        stubTop(document.getElementById('install')!, 900);

        pane.dispatchEvent(new Event('scroll'));

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith('introduction');

        // Scrolling further: Getting Started has now scrolled past too, so it
        // becomes the new (later, in document order) active heading.
        stubTop(document.getElementById('getting-started')!, -5);
        pane.dispatchEvent(new Event('scroll'));

        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenLastCalledWith('getting-started');
    });

    it('does not re-fire when the computed id is unchanged', () => {
        mockPage('/scroll-stable', '# Introduction\n\n## Getting Started\n');
        content = new DocsContent(router);
        content.showPath('/scroll-stable', '');

        const pane = mountAndFindScrollPane();
        const listener = vi.fn();

        content.on('activeheadingchange', listener);

        stubTop(pane, 0);
        stubTop(document.getElementById('introduction')!, -10);
        stubTop(document.getElementById('getting-started')!, 500);

        pane.dispatchEvent(new Event('scroll'));
        pane.dispatchEvent(new Event('scroll'));
        pane.dispatchEvent(new Event('scroll'));

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('keeps the clicked heading active through the native scroll event it triggers, even when a later heading ties it for the top-crossing position', () => {
        mockPage('/scroll-pin', '# Introduction\n\n## Getting Started\n\n### Install\n');
        content = new DocsContent(router);
        content.showPath('/scroll-pin', '');

        const pane = mountAndFindScrollPane();
        const listener = vi.fn();

        content.on('activeheadingchange', listener);

        stubTop(pane, 0);
        stubTop(document.getElementById('introduction')!, 0);
        // Getting Started and Install sit at the exact same top — two
        // adjacent headings with no content between them, a layout a real
        // clamped scroll-to-end can also produce (see findActiveHeading's
        // own doc comment). Pure top-crossing alone would resolve to
        // whichever of the two comes last in document order, regardless of
        // which one was actually clicked.
        stubTop(document.getElementById('getting-started')!, 200);
        stubTop(document.getElementById('install')!, 200);

        (content as unknown as { scrollToHeading(id: string): void }).scrollToHeading('getting-started');

        expect((pane as HTMLElement).scrollTop).toBe(200);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith('getting-started');

        // The resulting native scroll event fires with scrollTop unchanged.
        // findActiveHeading alone would resolve to "install" here (both tie
        // for "last crossed") — the pin from the click keeps "getting
        // started", the one actually clicked, active instead.
        pane.dispatchEvent(new Event('scroll'));

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith('getting-started');

        // A genuine further scroll clears the pin and resumes geometry-driven
        // tracking: both later headings have now scrolled past the pane's
        // top, so "install" (the later of the two, in document order) is
        // correctly resolved as active.
        stubTop(document.getElementById('getting-started')!, -10);
        stubTop(document.getElementById('install')!, -5);
        (pane as HTMLElement).scrollTop = 205;
        pane.dispatchEvent(new Event('scroll'));

        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenLastCalledWith('install');
    });
});

// Two own methods and one inherited method, so a heading-list assertion can
// tell "hidden" (ownMethod only) from "shown" (both) apart.
const API_SOURCE_WITH_INHERITED = [
    '# Class: Foo',
    '',
    '## Methods',
    '',
    '### ownMethod()',
    '',
    'Declared by Foo.',
    '',
    '### inheritedMethod()',
    '',
    'Body text.',
    '',
    '#### Inherited from',
    '',
    '[`Base`](../Base.md).[`inheritedMethod`](../Base.md#inheritedmethod)',
].join('\n');

/** The text of every heading `outlinechange` most recently fired with. */
function lastHeadingTexts(listener: ReturnType<typeof vi.fn>): string[] {
    const headings = listener.mock.calls.at(-1)?.[0] as MarkdownHeading[];

    return headings.map((h) => h.text);
}

describe('DocsContent.isApiPage', () => {
    it('is false before any page has rendered', () => {
        content = new DocsContent(router);

        expect(content.isApiPage()).toBe(false);
    });

    it('is false while an authored page is shown', () => {
        mockPage('/authored', '# A\n\ntext\n');
        content = new DocsContent(router);

        content.showPath('/authored', '');

        expect(content.isApiPage()).toBe(false);
    });

    it('is false while the not-found view is shown', () => {
        vi.mocked(apiFileFor).mockReturnValue(null);
        content = new DocsContent(router);

        content.showPath('/nowhere', '');

        expect(content.isApiPage()).toBe(false);
    });

    it('is false while the fetch-error view is shown', async () => {
        vi.mocked(apiFileFor).mockReturnValue('core/classes/Broken.md');
        vi.mocked(fetchApiPage).mockRejectedValue(new Error('network error'));
        content = new DocsContent(router);

        content.showPath('/api/core/classes/Broken', '');
        await Promise.resolve();

        expect(content.isApiPage()).toBe(false);
    });

    it('is true once a freshly fetched API page has resolved', async () => {
        mockApiPage('/api/core/classes/Foo', 'core/classes/Foo.md', API_SOURCE_WITH_INHERITED);
        content = new DocsContent(router);

        content.showPath('/api/core/classes/Foo', '');
        expect(content.isApiPage()).toBe(false);

        await Promise.resolve();

        expect(content.isApiPage()).toBe(true);
    });

    it('is true synchronously for a cached repeat visit to the same API page', async () => {
        mockApiPage('/api/core/classes/Foo', 'core/classes/Foo.md', API_SOURCE_WITH_INHERITED);
        mockPage('/authored', '# A\n');
        content = new DocsContent(router);

        content.showPath('/api/core/classes/Foo', '');
        await Promise.resolve();
        content.showPath('/authored', '');
        expect(content.isApiPage()).toBe(false);

        content.showPath('/api/core/classes/Foo', '');

        expect(content.isApiPage()).toBe(true);
    });
});

describe('DocsContent.setShowInheritedMembers', () => {
    it('hides inherited members by default (no preference set)', async () => {
        mockApiPage('/api/core/classes/Foo', 'core/classes/Foo.md', API_SOURCE_WITH_INHERITED);
        content = new DocsContent(router);
        const listener = vi.fn();
        content.on('outlinechange', listener);

        content.showPath('/api/core/classes/Foo', '');
        await Promise.resolve();

        expect(lastHeadingTexts(listener)).toContain('ownMethod()');
        expect(lastHeadingTexts(listener)).not.toContain('inheritedMethod()');
    });

    it('restores inherited members on setShowInheritedMembers(true), without a second fetch', async () => {
        mockApiPage('/api/core/classes/Foo', 'core/classes/Foo.md', API_SOURCE_WITH_INHERITED);
        content = new DocsContent(router);
        const listener = vi.fn();
        content.on('outlinechange', listener);

        content.showPath('/api/core/classes/Foo', '');
        await Promise.resolve();

        content.setShowInheritedMembers(true);

        expect(lastHeadingTexts(listener)).toContain('inheritedMethod()');
        expect(vi.mocked(fetchApiPage)).toHaveBeenCalledTimes(1);
    });

    it('re-hides inherited members on a following setShowInheritedMembers(false)', async () => {
        mockApiPage('/api/core/classes/Foo', 'core/classes/Foo.md', API_SOURCE_WITH_INHERITED);
        content = new DocsContent(router);
        const listener = vi.fn();
        content.on('outlinechange', listener);

        content.showPath('/api/core/classes/Foo', '');
        await Promise.resolve();
        content.setShowInheritedMembers(true);

        content.setShowInheritedMembers(false);

        expect(lastHeadingTexts(listener)).not.toContain('inheritedMethod()');
    });

    it('persists the preference so a later load reads it back', async () => {
        mockApiPage('/api/core/classes/Foo', 'core/classes/Foo.md', API_SOURCE_WITH_INHERITED);
        content = new DocsContent(router);

        content.showPath('/api/core/classes/Foo', '');
        await Promise.resolve();
        content.setShowInheritedMembers(true);

        expect(loadShowInheritedMembers()).toBe(true);
    });

    it('on an authored page, persists the preference but does not touch the rendered content', () => {
        mockPage('/authored', '# A\n\n## B\n');
        content = new DocsContent(router);
        content.showPath('/authored', '');
        const listener = vi.fn();
        content.on('outlinechange', listener);

        content.setShowInheritedMembers(true);

        expect(loadShowInheritedMembers()).toBe(true);
        expect(listener).not.toHaveBeenCalled();
    });

    it('does not re-render a prior API page after navigating to one whose fetch fails', async () => {
        // Regression: showPath's fetch-error branch must clear _rawApiSource
        // alongside _linkBaseDir, or a toggle click after landing on the
        // error view re-renders the *previous* API page's stale source over
        // the fetch-error message instead of leaving it untouched.
        mockApiPage('/api/core/classes/Foo', 'core/classes/Foo.md', API_SOURCE_WITH_INHERITED);
        content = new DocsContent(router);
        content.showPath('/api/core/classes/Foo', '');
        await Promise.resolve();

        vi.mocked(apiFileFor).mockReturnValue('core/classes/Broken.md');
        vi.mocked(fetchApiPage).mockRejectedValue(new Error('network error'));
        content.showPath('/api/core/classes/Broken', '');
        await Promise.resolve();

        const listener = vi.fn();
        content.on('outlinechange', listener);

        content.setShowInheritedMembers(true);

        expect(listener).not.toHaveBeenCalled();
    });
});
