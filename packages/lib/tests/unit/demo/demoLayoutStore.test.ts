//
// Coverage for the demo app's pane-size store. `loadPaneSizes` promises to fall
// back when nothing is saved, when the saved text is unparseable, and when it is
// parseable but malformed — three branches the plan's manual gutter-drag step
// cannot reach, since it only exercises the happy round trip.
//
// The store owns *shape* only; whether a well-formed array still fits the live
// panes is the library's call, made by `isRestorableSizes` and covered by its
// own suite. Nothing here restates that split.
//
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { LayoutSize } from '~/layout/LayoutSizes';
import { loadPaneSizes, savePaneSizes } from '../../../src/typescript/demoLayoutStore.js';

// Minimal in-memory Storage stand-in, as tests/unit/data/proxy/WebStorageProxy
// does, so the store can be exercised without a DOM.
function makeStorage(): Storage {
    const map = new Map<string, string>();

    return {
        get length(): number { return map.size; },
        clear: (): void => map.clear(),
        getItem: (k: string): string | null => (map.has(k) ? map.get(k)! : null),
        key: (i: number): string | null => Array.from(map.keys())[i] ?? null,
        removeItem: (k: string): void => { map.delete(k); },
        setItem: (k: string, v: string): void => { map.set(k, v); },
    } as Storage;
}

// A distinct sentinel, so an assertion that the fallback came back cannot be
// satisfied by the store happening to return an equal-looking array.
const FALLBACK: LayoutSize[] = [
    { unit: "px",    value: 220 },
    { unit: "ratio", value: 1   },
];

describe('demoLayoutStore', () => {
    let storage: Storage;

    beforeEach(() => {
        storage = makeStorage();
        vi.stubGlobal('localStorage', storage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('round-trips a saved array', () => {
        const saved: LayoutSize[] = [
            { unit: "px",    value: 300 },
            { unit: "ratio", value: 1   },
        ];

        savePaneSizes(saved);

        expect(loadPaneSizes(FALLBACK)).toEqual(saved);
    });

    it('falls back when nothing is saved', () => {
        expect(loadPaneSizes(FALLBACK)).toBe(FALLBACK);
    });

    it('falls back when the saved text is unparseable', () => {
        storage.setItem('tsui-demo.shell.paneSizes', '{not json');

        expect(loadPaneSizes(FALLBACK)).toBe(FALLBACK);
    });

    it('falls back when the parsed value is not an array', () => {
        storage.setItem('tsui-demo.shell.paneSizes', '{"unit":"px","value":220}');

        expect(loadPaneSizes(FALLBACK)).toBe(FALLBACK);
    });

    // One row per way an entry can be malformed. Dropping the unit test leaves
    // the first two red, dropping the object/null guard leaves `[null]` red
    // (it throws on `.unit`), and dropping the whole `every` guard leaves all
    // six red.
    //
    // The two value clauses — `typeof … === "number"` and `Number.isFinite` —
    // are individually redundant for anything `JSON.parse` can produce, since
    // `Number.isFinite` does not coerce and so rejects `"220"` and `null` on
    // its own, as does `typeof`. These rows therefore pin the *pair*: dropping
    // either one alone leaves all eleven green, dropping both leaves the two
    // value rows red. No row claims per-clause coverage, and none can —
    // JSON has no `NaN` or `Infinity` literal, so a genuinely non-finite
    // number cannot reach the guard at all.
    const malformed: ReadonlyArray<readonly [string, string]> = [
        ["an unknown unit",     '[{"unit":"em","value":220}]'   ],
        ["a missing unit",      '[{"value":220}]'               ],
        ["a string value",      '[{"unit":"px","value":"220"}]' ],
        ["a null value",        '[{"unit":"px","value":null}]'  ],
        ["a null entry",        '[null]'                        ],
        ["a non-object entry",  '[220]'                         ],
    ];

    for (const [what, raw] of malformed) {
        it(`falls back on ${what}`, () => {
            storage.setItem('tsui-demo.shell.paneSizes', raw);

            expect(loadPaneSizes(FALLBACK)).toBe(FALLBACK);
        });
    }

    it('keeps a well-formed array whole, leaving fit to the library', () => {
        // Three entries where the live split has two: still well-formed, so the
        // store returns it and `Split.isRestorableSizes` is what discards it.
        storage.setItem('tsui-demo.shell.paneSizes',
                        '[{"unit":"px","value":220},{"unit":"ratio","value":0.5},{"unit":"ratio","value":0.5}]');

        expect(loadPaneSizes(FALLBACK)).toHaveLength(3);
    });
});
