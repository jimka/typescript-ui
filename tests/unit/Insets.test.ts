import { describe, it, expect } from 'vitest';
import { Insets } from '~/primitive/Insets';

describe('Insets', () => {
    it('stores the four edges in top/right/bottom/left order', () => {
        const i = new Insets(1, 2, 3, 4);
        expect(i.getTop()).toBe(1);
        expect(i.getRight()).toBe(2);
        expect(i.getBottom()).toBe(3);
        expect(i.getLeft()).toBe(4);
    });
    it('defaults each edge to 0', () => {
        const i = new Insets(0, 0, 0, 0);
        expect(i.getTop()).toBe(0);
        expect(i.getRight()).toBe(0);
        expect(i.getBottom()).toBe(0);
        expect(i.getLeft()).toBe(0);
    });
    it('updates an edge through its setter', () => {
        const i = new Insets(0, 0, 0, 0);
        i.setTop(8);
        expect(i.getTop()).toBe(8);
    });
});
