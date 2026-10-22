// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect } from 'vitest';
import { expandPrefixTabs, prefixTabEdits } from '~/component/display/markdownTabs';

describe('prefixTabEdits', () => {
    it('CP1: gives each tab of the prefix the spaces to its stop', () => {
        expect(prefixTabEdits('>\t\ta')).toEqual([{ from: 1, to: 2, insert: '   ' }, { from: 2, to: 3, insert: '    ' }]);
    });

    it('CP2: writes a tabbed line end after a marker as one space', () => {
        expect(prefixTabEdits('-\t')).toEqual([{ from: 1, to: 2, insert: ' ' }]);
        expect(prefixTabEdits('> - \t ')).toEqual([{ from: 3, to: 6, insert: ' ' }]);
    });

    it('CP3: counts every tab of a line of whitespace only', () => {
        expect(prefixTabEdits(' \t')).toEqual([{ from: 1, to: 2, insert: '   ' }]);
    });

    it('CP4: leaves a tab after the prefix alone', () => {
        expect(prefixTabEdits('- a\tb')).toEqual([]);
        expect(prefixTabEdits('a\tb')).toEqual([]);
    });

    it('CP5: expandPrefixTabs applies the edits', () => {
        expect(expandPrefixTabs('>\t-\ta\tb').text).toBe('>   -   a\tb');
        expect(expandPrefixTabs('-\t').text).toBe('- ');
    });
});
