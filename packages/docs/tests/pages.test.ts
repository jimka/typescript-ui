import { describe, it, expect } from 'vitest';
import { getPage, getNav } from '../src/content/pages.js';

describe('getPage', () => {
    it('returns a page with non-empty source and the title from the first # heading', () => {
        const page = getPage('/guide/installation');

        expect(page).not.toBeNull();
        expect(page!.source.length).toBeGreaterThan(0);
        expect(page!.title).toBe('Installation');
    });

    it('resolves the directory path to its index.md', () => {
        const page = getPage('/guide');

        expect(page).not.toBeNull();
        expect(page!.path).toBe('/guide');
    });

    it('returns null for a path with no matching file', () => {
        expect(getPage('/nope')).toBeNull();
    });
});

describe('getNav', () => {
    const nav = getNav();

    it('returns exactly the Guide and Concepts groups', () => {
        expect(nav.map((group) => group.title)).toEqual(['Guide', 'Concepts']);
    });

    it('every page path resolves through getPage', () => {
        for (const group of nav) {
            for (const page of group.pages) {
                expect(getPage(page.path)).not.toBeNull();
            }
        }
    });

    it('no page path ends in a trailing slash', () => {
        for (const group of nav) {
            for (const page of group.pages) {
                expect(page.path.endsWith('/')).toBe(false);
            }
        }
    });

    it('labels the sidebar with the config.mts titles, not the page h1 headings', () => {
        const labels = nav.flatMap((group) => group.pages.map((page) => page.label));

        // These three diverge from the page's own first `# ` heading
        // ("Getting Started", "Concepts", "DOM seams (`DOMSink` / `DOMSource`)"),
        // so they prove the sidebar uses the hand-authored config.mts title.
        expect(labels).toContain('Introduction');
        expect(labels).toContain('Overview');
        expect(labels).toContain('DOM seams');
        // No sidebar label may leak raw Markdown from a heading.
        expect(labels.some((label) => label.includes('`'))).toBe(false);
    });
});
