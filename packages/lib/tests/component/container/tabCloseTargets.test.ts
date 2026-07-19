import { describe, it, expect } from 'vitest';
import { computeBulkCloseIds } from '~/component/container/tabCloseTargets';

describe('computeBulkCloseIds', () => {
    // Fixture: five tabs, the right-clicked one is "c" (index 2), and every tab
    // is closeable except the pinned first tab "a".
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const clicked = 2;
    const closeable = (id: string): boolean => id !== 'a';

    it('"all" returns every closeable id including the clicked tab', () => {
        expect(computeBulkCloseIds(ids, clicked, closeable, 'all')).toEqual(['b', 'c', 'd', 'e']);
    });

    it('"others" returns every closeable id except the clicked tab', () => {
        expect(computeBulkCloseIds(ids, clicked, closeable, 'others')).toEqual(['b', 'd', 'e']);
    });

    it('"right" returns closeable ids after the clicked index', () => {
        expect(computeBulkCloseIds(ids, clicked, closeable, 'right')).toEqual(['d', 'e']);
    });

    it('"left" returns closeable ids before the clicked index, filtering non-closeable', () => {
        expect(computeBulkCloseIds(ids, clicked, closeable, 'left')).toEqual(['b']);
    });

    it('"left" is empty when the clicked tab is first', () => {
        expect(computeBulkCloseIds(ids, 0, closeable, 'left')).toEqual([]);
    });

    it('"right" is empty when the clicked tab is last', () => {
        expect(computeBulkCloseIds(ids, ids.length - 1, closeable, 'right')).toEqual([]);
    });

    it('every scope is empty when no tab is closeable', () => {
        const none = (): boolean => false;

        expect(computeBulkCloseIds(ids, clicked, none, 'all')).toEqual([]);
        expect(computeBulkCloseIds(ids, clicked, none, 'others')).toEqual([]);
        expect(computeBulkCloseIds(ids, clicked, none, 'right')).toEqual([]);
        expect(computeBulkCloseIds(ids, clicked, none, 'left')).toEqual([]);
    });

    it('a lone clicked tab yields no "others" and one "all" when closeable', () => {
        const single = ['solo'];
        const all = (): boolean => true;

        expect(computeBulkCloseIds(single, 0, all, 'others')).toEqual([]);
        expect(computeBulkCloseIds(single, 0, all, 'all')).toEqual(['solo']);
        expect(computeBulkCloseIds(single, 0, () => false, 'all')).toEqual([]);
    });
});
