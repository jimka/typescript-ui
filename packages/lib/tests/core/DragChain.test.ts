import { describe, it, expect } from 'vitest';
import { chainRoom, distributeDragChain } from '~/core/DragChain';

// Behaviour cases 14a-14c from plans/table-chained-column-resize.md — the pure
// chain arithmetic Accordion and Table both drive a drag through.
describe('DragChain', () => {
    describe('chainRoom', () => {
        it('sums room to grow toward max', () => {
            expect(chainRoom([0, 1], [50, 50], 1, [0, 0], [80, 60])).toBe(40);
        });

        it('sums room to shrink toward min', () => {
            expect(chainRoom([0, 1], [50, 50], -1, [30, 45], [80, 60])).toBe(25);
        });

        it('floors an out-of-bounds entry at 0, never negative', () => {
            expect(chainRoom([0], [10], -1, [30], [Number.POSITIVE_INFINITY])).toBe(0);
        });
    });

    describe('distributeDragChain', () => {
        it('fills nearest-first and stops once delta runs out', () => {
            const out = [50, 50, 50];

            distributeDragChain([0, 1, 2], [50, 50, 50], 30, -1, [40, 30, 40], [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY], out);

            expect(out).toEqual([40, 30, 50]);
        });
    });
});
