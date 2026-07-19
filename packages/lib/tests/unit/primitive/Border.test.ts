import { describe, it, expect } from 'vitest';
import { borderToStyle, borderSideWidth } from '~/primitive/Border';

describe('borderToStyle', () => {
    it('resolves every side to "none" for an empty spec', () => {
        expect(borderToStyle({})).toEqual({
            borderTop: 'none',
            borderRight: 'none',
            borderBottom: 'none',
            borderLeft: 'none',
        });
    });
    it('applies the border shorthand to all four sides', () => {
        expect(borderToStyle({ border: '1px solid red' })).toEqual({
            borderTop: '1px solid red',
            borderRight: '1px solid red',
            borderBottom: '1px solid red',
            borderLeft: '1px solid red',
        });
    });
    it('lets a per-side value override the border fallback for that side only', () => {
        expect(borderToStyle({ border: 'none', borderTop: '2px dashed blue' })).toEqual({
            borderTop: '2px dashed blue',
            borderRight: 'none',
            borderBottom: 'none',
            borderLeft: 'none',
        });
    });
    it('falls back the unspecified sides to "none" when no border shorthand is given', () => {
        expect(borderToStyle({ borderLeft: '1px' })).toEqual({
            borderTop: 'none',
            borderRight: 'none',
            borderBottom: 'none',
            borderLeft: '1px',
        });
    });
});

describe('borderSideWidth', () => {
    it('returns 0 for undefined / empty / "none" / "0" / var()', () => {
        expect(borderSideWidth(undefined)).toBe(0);
        expect(borderSideWidth('')).toBe(0);
        expect(borderSideWidth('none')).toBe(0);
        expect(borderSideWidth('0')).toBe(0);
        expect(borderSideWidth('var(--x)')).toBe(0);
    });
    it('parses the leading px width of a full border value', () => {
        expect(borderSideWidth('1px solid red')).toBe(1);
    });
    it('parses a decimal px width', () => {
        expect(borderSideWidth('2.5px')).toBe(2.5);
    });
    it('tolerates surrounding whitespace', () => {
        expect(borderSideWidth('  3px solid')).toBe(3);
    });
    it('is case-insensitive about the px unit', () => {
        expect(borderSideWidth('4PX')).toBe(4);
    });
    it('returns 0 for any non-px unit', () => {
        expect(borderSideWidth('1em')).toBe(0);
        expect(borderSideWidth('1rem')).toBe(0);
        expect(borderSideWidth('10%')).toBe(0);
    });
    it('returns 0 for "0px"', () => {
        expect(borderSideWidth('0px')).toBe(0);
    });
});
