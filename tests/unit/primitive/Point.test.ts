import { describe, it, expect } from 'vitest';
import { Point } from '~/primitive/Point';

describe('Point', () => {
    it('exposes the constructor x and y through the getters', () => {
        const p = new Point(3, 4);
        expect(p.getX()).toBe(3);
        expect(p.getY()).toBe(4);
    });
    it('renders as a space-separated "x y" string', () => {
        expect(new Point(3, 4).render()).toBe('3 4');
    });
    it('treats (0, 0) as the origin', () => {
        const p = new Point(0, 0);
        expect(p.getX()).toBe(0);
        expect(p.getY()).toBe(0);
    });
    // Resolved divergence: the field now uses `x ?? 0` (not `x || 0`), so the
    // "default to 0" guard fires only for null/undefined and a genuine NaN
    // coordinate is preserved rather than masquerading as the origin.
    it('preserves a NaN coordinate rather than coalescing it to 0', () => {
        const p = new Point(NaN, 5);
        expect(Number.isNaN(p.getX())).toBe(true);
    });
});
