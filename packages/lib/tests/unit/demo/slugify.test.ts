//
// Coverage for the demo app's label-to-URL transform. Two regexes decide all 32
// of the app's routes, so each row below is a live bookmark: `slugify` is the
// only thing keeping a section's label and its URL from drifting.
//
// `demoSlug.ts` imports nothing, which is what lets this file pin the transform
// without loading the 32 panel modules (and CodeMirror, Lexical and elkjs
// behind them) that `demoSections.ts` pulls in.
//
import { describe, it, expect } from 'vitest';
import { slugify } from '../../../src/typescript/demoSlug.js';

describe('slugify', () => {
    // Table-driven so every row is one live route. The first five are labels the
    // app actually ships; the last is the leading/trailing case no real label
    // exercises, and the only row that can catch a dropped leading-dash strip.
    const cases: ReadonlyArray<readonly [string, string]> = [
        ["Misc.",                   "misc"            ],
        ["Layout I/O",              "layout-i-o"      ],
        ["Property Grid",           "property-grid"   ],
        ["MD Editor",               "md-editor"       ],
        ["HBox",                    "hbox"            ],
        ["  Leading & trailing  ",  "leading-trailing"],
    ];

    for (const [label, expected] of cases) {
        it(`maps ${JSON.stringify(label)} to ${JSON.stringify(expected)}`, () => {
            expect(slugify(label)).toBe(expected);
        });
    }
});
