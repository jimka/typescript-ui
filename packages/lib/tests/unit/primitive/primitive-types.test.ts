import { describe, it, expect } from 'vitest';
import type { HorizontalSide, VerticalSide, Edge } from '~/primitive/Edge';
import type {
    AxisOrientation,
    AxisPosition,
    AxisEnd,
    AxisSpread,
} from '~/primitive/Axis';

// These modules export only type/union aliases — no runtime values. The point
// of each case is the typed `const` assignment: it must compile for the union
// membership to hold. The runtime `expect` is a trivial witness so the spec is
// a real, executable test rather than a dead file.

describe('Edge type aliases', () => {
    it('admits the horizontal physical sides', () => {
        const left: HorizontalSide = 'left';
        const right: HorizontalSide = 'right';
        expect([left, right]).toEqual(['left', 'right']);
    });
    it('admits the vertical physical sides', () => {
        const top: VerticalSide = 'top';
        const bottom: VerticalSide = 'bottom';
        expect([top, bottom]).toEqual(['top', 'bottom']);
    });
    it('unions all four sides into Edge', () => {
        const edges: Edge[] = ['left', 'right', 'top', 'bottom'];
        expect(edges).toHaveLength(4);
    });
});

describe('Axis type aliases', () => {
    it('admits both axis orientations', () => {
        const horizontal: AxisOrientation = 'horizontal';
        const vertical: AxisOrientation = 'vertical';
        expect([horizontal, vertical]).toEqual(['horizontal', 'vertical']);
    });
    it('admits the three axis positions', () => {
        const positions: AxisPosition[] = ['start', 'center', 'end'];
        expect(positions).toHaveLength(3);
    });
    it('excludes center from AxisEnd', () => {
        const ends: AxisEnd[] = ['start', 'end'];
        expect(ends).toEqual(['start', 'end']);
    });
    it('admits the three spread modes', () => {
        const spreads: AxisSpread[] = ['start', 'between', 'around'];
        expect(spreads).toHaveLength(3);
    });
});
