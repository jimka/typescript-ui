// @vitest-environment jsdom
//
// Two `Markdown` instances rendering documents that share a heading name land
// two elements with the same id in the one document-wide id space, and both
// heading readers have to resolve each one inside the pane it belongs to.
//
// Against the REAL production DOM source (the `jsdom` pragma keeps
// `tests/setup/node-setup.ts` from installing the modelled DOM, mirroring
// `tests/core/FocusTraversalCompositeWidgets.test.ts`): the modelled
// `ModelledDOMSource` ignores `querySelector`'s `root` argument entirely and
// answers from one global selector→handle map, so two panes can never resolve
// to two different elements there — seeding the second overwrites the first,
// and a test written offline would pass against the broken code either way.
//
// jsdom performs no layout, so every rect reads zero: every heading satisfies
// `findActiveHeading`'s top-crossing rule and the last one that resolves wins,
// which is exactly what makes the collision visible.
import { describe, it, expect, afterEach } from 'vitest';
import { Markdown, extractMarkdownHeadings, findActiveHeading } from '~/component/display/Markdown';
import { HeadingScrollTracker } from '~/component/display/HeadingScrollTracker';
import type { HeadingScrollHost } from '~/component/display/HeadingScrollTracker';
import type { MarkdownHeading } from '~/component/display/Markdown';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';

/** A rendered pane: its root element (standing in as the scroll element) and its own headings. */
interface Pane {
    root:     Handle;
    headings: MarkdownHeading[];
}

const panes: Markdown[] = [];

/** Renders a `Markdown` and mounts its element into the real document, so its headings are queryable. */
function renderPane(source: string): Pane {
    const md   = new Markdown(source);
    const root = md.getElement(true)!;

    panes.push(md);
    DOM.sink.appendChild(DOM.source.getBody(), root);

    return { root, headings: extractMarkdownHeadings(source) };
}

/** A minimal `HeadingScrollHost` standing in for the pane's scrolling owner. */
function stubHost(): HeadingScrollHost {
    let scrollTop = 0;

    return {
        getScrollTop: (): number => scrollTop,
        setScrollTop: (value: number): unknown => (scrollTop = value),
    };
}

afterEach(() => {
    for (const md of panes.splice(0)) {
        md.dispose();
    }

    document.body.innerHTML = '';
});

describe('Two Markdown panes sharing a heading name (Expected Behaviour: J1-J4)', () => {
    it('J1: each pane resolves its own heading element, not the other pane\'s', () => {
        const a = renderPane('# Alpha\n\n# Shared');
        const b = renderPane('# Beta\n\n# Shared');

        // Both panes render an element with id "shared"; only the first one
        // is what a document-wide `getElementById` can ever return.
        expect(a.headings.map((h) => h.id)).toEqual(['alpha', 'shared']);
        expect(b.headings.map((h) => h.id)).toEqual(['beta', 'shared']);

        expect(findActiveHeading(a.root, a.headings)).toBe('shared');
        expect(findActiveHeading(b.root, b.headings)).toBe('shared');
    });

    it('J2: a minimap click in the second pane scrolls it and marks the clicked heading active', () => {
        renderPane('# Alpha\n\n# Shared');
        const b = renderPane('# Beta\n\n# Shared');

        const active: Array<string | null> = [];
        const tracker = new HeadingScrollTracker(stubHost(), (id) => active.push(id));

        tracker.setHeadings(b.headings);
        tracker.scrollToHeading(b.root, 'shared');

        expect(active).toEqual(['shared']);
    });

    it('J3: scoping does not widen — a heading that exists only in the other pane stays unresolved', () => {
        renderPane('# Alpha\n\n# Shared');
        const b = renderPane('# Beta\n\n# Shared');

        // "alpha" is in the document, but not inside pane B's subtree.
        expect(document.getElementById('alpha')).not.toBeNull();
        expect(findActiveHeading(b.root, [{ id: 'alpha', text: 'Alpha', depth: 1 }])).toBeNull();
    });

    it('J4: a heading id that starts with a digit resolves instead of throwing', () => {
        const pane = renderPane('# 2026 Roadmap');

        expect(pane.headings.map((h) => h.id)).toEqual(['2026-roadmap']);
        // jsdom ships no `CSS` object, so `DOM.source.escapeSelector` takes its
        // regex fallback and leaves the leading digit unescaped — a selector
        // built as `#2026-roadmap` would throw a SyntaxError here.
        expect(() => findActiveHeading(pane.root, pane.headings)).not.toThrow();
        expect(findActiveHeading(pane.root, pane.headings)).toBe('2026-roadmap');
    });
});
