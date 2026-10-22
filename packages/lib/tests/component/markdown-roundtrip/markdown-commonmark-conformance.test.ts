import { describe, it, expect } from 'vitest';
import { COMMONMARK_CONFORMANCE } from './commonmarkConformance';
import { viewerModel } from './viewModel';

describe('the viewer reads the CommonMark link, link reference definition and image examples as CommonMark does', () => {
    for (const row of COMMONMARK_CONFORMANCE) {
        it(row.name, () => {
            expect(viewerModel(row.markdown).blocks).toEqual(row.blocks);
        });
    }
});
