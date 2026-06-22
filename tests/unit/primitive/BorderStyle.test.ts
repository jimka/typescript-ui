import { describe, it, expect } from 'vitest';
import { BorderStyle } from '~/primitive/BorderStyle';

describe('BorderStyle', () => {
    it('numbers its members from 0 in declaration order', () => {
        expect(BorderStyle.NONE).toBe(0);
        expect(BorderStyle.HIDDEN).toBe(9);
    });
    it('is a numeric enum carrying a reverse name mapping', () => {
        expect(BorderStyle[0]).toBe('NONE');
        expect(BorderStyle[9]).toBe('HIDDEN');
    });
    // DIVERGENCE (surface-it): the module JSDoc calls these "the standard CSS
    // border-style keyword values", yet the enum is numeric (NONE === 0, …), so
    // a member can never be emitted as a CSS keyword string ('none', 'dotted',
    // …) without a separate ordinal->keyword conversion. A repo grep finds NO
    // consumer of BorderStyle at all (only the barrel re-export), so no such
    // conversion exists. If the documented contract is "these are CSS keyword
    // strings", the enum should be a string enum. Pinned as a deliberate failure
    // for the user to adjudicate (fix the JSDoc, or make it a string enum).
    it.fails('exposes CSS border-style keyword strings, as its JSDoc promises', () => {
        expect(BorderStyle.NONE).toBe('none');
        expect(BorderStyle.DOTTED).toBe('dotted');
    });
});
