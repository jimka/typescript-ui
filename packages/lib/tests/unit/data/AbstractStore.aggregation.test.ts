import { describe, it, expect } from 'vitest';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';

// Model carries a numeric `score`, a `team` for collect(), and a `ref` for
// object-identity dedup. Aggregates read the coerced numeric contract of
// numericValues() and operate over the filtered view (this._records).
const MODEL = new Model([{ name: 'id' }, { name: 'team' }, { name: 'score' }, { name: 'ref' }], 'id');

function makeStore(data: any[] = []): MemoryStore {
    const store = new MemoryStore(MODEL, data);
    store.loadData(data);
    return store;
}

const SAMPLE = [
    { id: 1, team: 'red',  score: 80 },
    { id: 2, team: 'blue', score: 60 },
    { id: 3, team: 'red',  score: 90 },
];

describe('AbstractStore aggregation — sum', () => {
    it('sums the numeric values of a field', () => {
        expect(makeStore(SAMPLE).sum('score')).toBe(230);
    });
    it('returns 0 over an empty view', () => {
        expect(makeStore([]).sum('score')).toBe(0);
    });
    it('returns 0 over an all-null field (nulls skipped, never coerced to 0)', () => {
        const store = makeStore([{ id: 1, score: null }, { id: 2, score: null }]);
        expect(store.sum('score')).toBe(0);
    });
});

describe('AbstractStore aggregation — average', () => {
    it('returns the mean of the numeric values', () => {
        expect(makeStore(SAMPLE).average('score')).toBeCloseTo(230 / 3);
    });
    it('returns 0 (not NaN) over an empty view', () => {
        expect(makeStore([]).average('score')).toBe(0);
    });
    it('returns 0 (not NaN) over an all-null field', () => {
        const store = makeStore([{ id: 1, score: null }, { id: 2, score: null }]);
        expect(store.average('score')).toBe(0);
    });
    it('divides by the count of numeric values, not the row count', () => {
        // 3 rows, one null -> mean of the two numeric values, not summed/3.
        const store = makeStore([
            { id: 1, score: 10 },
            { id: 2, score: null },
            { id: 3, score: 20 },
        ]);
        expect(store.average('score')).toBe(15);
    });
});

describe('AbstractStore aggregation — min / max', () => {
    it('return the extreme numeric values', () => {
        const store = makeStore(SAMPLE);
        expect(store.min('score')).toBe(60);
        expect(store.max('score')).toBe(90);
    });
    it('return undefined over an empty view', () => {
        const store = makeStore([]);
        expect(store.min('score')).toBeUndefined();
        expect(store.max('score')).toBeUndefined();
    });
    it('return undefined over an all-null field', () => {
        const store = makeStore([{ id: 1, score: null }]);
        expect(store.min('score')).toBeUndefined();
        expect(store.max('score')).toBeUndefined();
    });
    it('handle negative values correctly', () => {
        const store = makeStore([
            { id: 1, score: -5 },
            { id: 2, score: -20 },
            { id: 3, score: -1 },
        ]);
        expect(store.min('score')).toBe(-20);
        expect(store.max('score')).toBe(-1);
    });
});

describe('AbstractStore aggregation — numeric coercion', () => {
    it('skips non-numeric strings but counts numeric strings (coerced via Number)', () => {
        const store = makeStore([
            { id: 1, score: 10 },
            { id: 2, score: 'abc' }, // non-numeric -> skipped
            { id: 3, score: '5' },   // numeric string -> counted as 5
        ]);
        expect(store.sum('score')).toBe(15);
        expect(store.max('score')).toBe(10);
        expect(store.min('score')).toBe(5);
    });
});

describe('AbstractStore aggregation — filtered view', () => {
    it('reflects only the visible rows after a filter narrows the view', async () => {
        const store = makeStore(SAMPLE);
        await store.filter('team', 'red');
        expect(store.getCount()).toBe(2);
        expect(store.sum('score')).toBe(170);
        expect(store.min('score')).toBe(80);
        expect(store.max('score')).toBe(90);
    });
});

describe('AbstractStore aggregation — collect', () => {
    it('returns distinct values in first-encounter (view) order', () => {
        const store = makeStore([
            { id: 1, team: 'red' },
            { id: 2, team: 'blue' },
            { id: 3, team: 'red' },
            { id: 4, team: 'green' },
        ]);
        expect(store.collect('team')).toEqual(['red', 'blue', 'green']);
    });
    it('removes duplicates by strict === identity', () => {
        const store = makeStore([
            { id: 1, score: 1 },
            { id: 2, score: 1 },
            { id: 3, score: 2 },
        ]);
        expect(store.collect('score')).toEqual([1, 2]);
    });
    it('keeps distinct object references distinct', () => {
        const a = { label: 'a' };
        const b = { label: 'a' }; // equal shape, different reference
        const store = makeStore([
            { id: 1, ref: a },
            { id: 2, ref: a }, // same reference -> deduped
            { id: 3, ref: b }, // different reference -> distinct
        ]);
        expect(store.collect('ref')).toEqual([a, b]);
    });
    it('returns [] over an empty view', () => {
        expect(makeStore([]).collect('team')).toEqual([]);
    });
});
