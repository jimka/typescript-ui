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
});
