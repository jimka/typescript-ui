import { describe, it, expect } from 'vitest';
import { Placement } from '~/primitive/Placement';

describe('Placement', () => {
    it('maps each member to its lowercase compass-point string', () => {
        expect(Placement.CENTER).toBe('center');
        expect(Placement.NORTH).toBe('north');
        expect(Placement.SOUTH).toBe('south');
        expect(Placement.WEST).toBe('west');
        expect(Placement.EAST).toBe('east');
    });
});
