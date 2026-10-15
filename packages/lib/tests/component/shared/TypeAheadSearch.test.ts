// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The shared type-ahead helper. Cases follow the `TypeAheadSearch` table of
// plans/in-progress/collection-widget-keyboard-gaps.md (S1-S10). No DOM is
// needed: the helper reads `Date.now()`, which each case sets itself.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { TypeAheadSearch, isTypeAheadKey } from '~/component/shared/TypeAheadSearch';
import type { TypeAheadRows } from '~/component/shared/TypeAheadSearch';

/** Labels `R5` of the plan, in display order. */
const R5 = ['Apple', 'Apricot', 'Banana', 'Blueberry', 'Cherry'];

/** A moment inside no earlier search window. */
const T0 = 1000;
/** Exactly the end of the 700 ms window that opened at {@link T0}. */
const T0_PLUS_WINDOW = 1700;

/**
 * Rows over `labels`, every row eligible unless `skip` names it.
 *
 * @param labels - The row labels.
 * @param current - Index of the current row, -1 for none.
 * @param skip - Index of a row the search may not land on.
 * @returns The rows.
 */
function rowsOf(labels: string[], current: number, skip: number = -1): TypeAheadRows {
    return {
        count:      labels.length,
        current,
        labelAt:    (i: number): string => labels[i],
        isEligible: (i: number): boolean => i !== skip,
    };
}

/**
 * Sets the clock the helper reads.
 *
 * @param ms - The value `Date.now()` returns from now on.
 */
function at(ms: number): void {
    vi.spyOn(Date, 'now').mockReturnValue(ms);
}

afterEach(() => vi.restoreAllMocks());

describe('TypeAheadSearch', () => {
    it('S1: finds the row by the one-letter and prefix rules', () => {
        const cases: Array<{ buffer: string, current: number, lands: number }> = [
            { buffer: 'b',  current: -1, lands: 2 },
            { buffer: 'b',  current: 2,  lands: 3 },
            { buffer: 'bb', current: 3,  lands: 2 },
            { buffer: 'bl', current: 2,  lands: 3 },
            { buffer: 'bl', current: 3,  lands: 3 },
            { buffer: 'ap', current: 4,  lands: 0 },
            { buffer: 'aa', current: 0,  lands: 1 },
            { buffer: 'x',  current: 2,  lands: -1 },
        ];

        for (const { buffer, current, lands } of cases) {
            const search = new TypeAheadSearch();
            let result   = -2;

            at(T0);

            for (const ch of buffer) {
                result = search.type(ch, rowsOf(R5, current));
            }

            expect(result, `buffer ${buffer} from ${current}`).toBe(lands);
        }
    });

    it('S2: a pause of exactly the window keeps the buffer', () => {
        const search = new TypeAheadSearch();

        at(T0);

        expect(search.type('b', rowsOf(R5, -1))).toBe(2);

        at(T0_PLUS_WINDOW);

        expect(search.type('c', rowsOf(R5, 2))).toBe(-1);
    });

    it('S3: a longer pause starts a new search', () => {
        const search = new TypeAheadSearch();

        at(T0);

        expect(search.type('b', rowsOf(R5, -1))).toBe(2);

        at(T0_PLUS_WINDOW + 1);

        expect(search.type('c', rowsOf(R5, 2))).toBe(4);
    });

    it('S4: a buffer with no match finds nothing and keeps growing', () => {
        const search = new TypeAheadSearch();

        at(T0);

        expect(search.type('z', rowsOf(R5, -1))).toBe(-1);

        at(T0 + 100);

        expect(search.type('a', rowsOf(R5, -1))).toBe(-1);
    });

    it('S5: a row that is not eligible is skipped', () => {
        const search = new TypeAheadSearch();

        at(T0);

        expect(search.type('b', rowsOf(R5, -1, 2))).toBe(3);
    });

    it('S6: no rows finds nothing', () => {
        const search = new TypeAheadSearch();

        at(T0);

        expect(search.type('a', rowsOf([], -1))).toBe(-1);
    });

    it('S7: clear starts a new search', () => {
        const labels = ['Apple', 'Banana', 'Blueberry', 'Lemon'];
        const search = new TypeAheadSearch();

        at(T0);

        expect(search.type('b', rowsOf(labels, -1))).toBe(1);

        search.clear();
        at(T0 + 100);

        expect(search.type('l', rowsOf(labels, 1))).toBe(3);
    });

    it('S8: matching ignores case in the key and in the label', () => {
        at(T0);

        expect(new TypeAheadSearch().type('B', rowsOf(R5, -1))).toBe(2);
        expect(new TypeAheadSearch().type('b', rowsOf(['BANANA'], -1))).toBe(0);
    });

    it('S9: a single row that matches is returned even when it is current', () => {
        at(T0);

        expect(new TypeAheadSearch().type('a', rowsOf(['Apple'], 0))).toBe(0);
    });

    it('S10: isTypeAheadKey accepts one printable character and nothing else', () => {
        const accepted = [{ key: 'a' }, { key: 'A', shiftKey: true }, { key: '*' }, { key: '?' }];
        const refused  = [
            { key: ' ' }, { key: 'Enter' }, { key: 'ArrowDown' }, { key: 'Dead' },
            { key: 'a', ctrlKey: true }, { key: 'a', metaKey: true }, { key: 'a', altKey: true },
        ];

        for (const init of accepted) {
            expect(isTypeAheadKey(init as unknown as KeyboardEvent), init.key).toBe(true);
        }

        for (const init of refused) {
            expect(isTypeAheadKey(init as unknown as KeyboardEvent), init.key).toBe(false);
        }
    });
});
