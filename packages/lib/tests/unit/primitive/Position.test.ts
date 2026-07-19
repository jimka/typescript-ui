import { describe, it, expect } from 'vitest';
import { Position } from '~/primitive/Position';

describe('Position', () => {
    it('maps each member to its CSS position keyword', () => {
        expect(Position.STATIC).toBe('static');
        expect(Position.FIXED).toBe('fixed');
        expect(Position.ABSOLUTE).toBe('absolute');
    });
});
