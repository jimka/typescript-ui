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
    // DIVERGENCE (surface-it): the field uses `x || 0`, not `x ?? 0`, so a NaN
    // coordinate silently coalesces to 0. A "two-dimensional point" arguably
    // should preserve NaN (or reject it) rather than masquerade it as the
    // origin. Pinned here as a deliberate failure for the user to adjudicate:
    // contract reading says NaN should not become 0; current code makes it 0.
    it.fails('preserves a NaN coordinate rather than coalescing it to 0', () => {
        const p = new Point(NaN, 5);
        expect(Number.isNaN(p.getX())).toBe(true);
    });
});
