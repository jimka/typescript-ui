// @vitest-environment jsdom
//
// Performance benchmark against the REAL production seam. Quantifies the
// walk-vs-index cost `ensureStyleRule` pays on a sheet that already carries
// many rules — the shape described in the plan's Overview: the framework
// allocates one `#uuid` rule per component, so the sheet grows by one rule
// per `ensureStyleRule` miss. Run on the base commit and again after the
// change to compare ops/s:
//
//     npx vitest bench tests/dom/style-rule-index.bench.ts
import { describe, bench } from 'vitest';
import { ProductionDOMSink } from '~/core/DOM';

const sink = new ProductionDOMSink();

// Pre-load the sheet with 5,000 rules so a fresh-selector miss has to walk
// (or, after the change, index-miss) past a realistic backlog before
// inserting — mirroring the wide-table demo's thousands of `#uuid` selectors.
for (let idx = 0; idx < 5_000; idx += 1) {
    sink.ensureStyleRule('.pre-existing-' + idx);
}

// A monotonically-increasing counter so every call is a genuine miss — each
// iteration both walks/indexes the current sheet AND grows it by one rule,
// matching the real "sheet grows once per component" cost shape.
let nextSelector = 0;

describe('ensureStyleRule — fresh-selector miss against a large, growing sheet', () => {
    bench('ensureStyleRule(new selector)', () => {
        sink.ensureStyleRule('.fresh-' + nextSelector);
        nextSelector += 1;
    });
});
