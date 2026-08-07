// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// `truncate`/`textOverflow` are tracked in `_options` (via `isTruncate`/
// `getTextOverflow`), the same pattern as every other Text option (e.g.
// `getTextAlign`) — not dedicated fields. An earlier version of this file
// covered a construction-order clobber from a pair of such fields; that
// hazard no longer applies now that neither is a field at all.
import { describe, it, expect } from 'vitest';
import { Text } from '~/component/input/Text';

describe('Text truncate option', () => {
    it('applies the ellipsis/overflow/white-space CSS when constructed with truncate: true', () => {
        const text = new Text(undefined, { truncate: true });

        expect(text.getOverflow()).toBe('hidden');
        expect(text.getTextOverflow()).toBe('ellipsis');
        expect(text.getWhiteSpace()).toBe('nowrap');
        expect(text.isTruncate()).toBe(true);
    });

    it('defaults to truncate: true (the class default) with no options passed at all', () => {
        const text = new Text();

        expect(text.getTextOverflow()).toBe('ellipsis');
        expect(text.isTruncate()).toBe(true);
    });

    it('honours an explicit truncate: false, clearing the CSS rather than leaving a stale default standing', () => {
        const text = new Text(undefined, { truncate: false });

        expect(text.isTruncate()).toBe(false);
        expect(text.getTextOverflow()).toBeNull();
    });

    it('lets truncate: true win over an explicit textOverflow option passed alongside it', () => {
        // applyOptions dispatches `textOverflow` before `truncate`; `truncate`
        // always wins when both are given, since it re-derives all three of
        // its CSS properties unconditionally.
        const text = new Text(undefined, { textOverflow: 'clip', truncate: true });

        expect(text.getTextOverflow()).toBe('ellipsis');
    });

    it('lets a later imperative setTextOverflow override an earlier setTruncate, and a later setTruncate override that in turn', () => {
        const text = new Text();

        text.setTextOverflow('clip');
        expect(text.getTextOverflow()).toBe('clip');

        text.setTruncate(true);
        expect(text.getTextOverflow()).toBe('ellipsis');
    });
});
