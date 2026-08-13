import { describe, it, expect } from 'vitest';
import { temporalDisplayText } from '~/data/temporalText';

const D = new Date(2021, 4, 17, 14, 30, 20);

describe('temporalDisplayText', () => {
    it('27. formats a date as locale-formatted text, not the native toString form', () => {
        const text = temporalDisplayText('date', false, D);

        expect(text).not.toContain('GMT');
        expect(text).not.toContain('(');
    });

    it('28. showSeconds widens the output for time and datetime', () => {
        expect(temporalDisplayText('time', true, D).length)
            .toBeGreaterThan(temporalDisplayText('time', false, D).length);
        expect(temporalDisplayText('datetime', true, D).length)
            .toBeGreaterThan(temporalDisplayText('datetime', false, D).length);
    });

    it('29. showSeconds is ignored for date', () => {
        expect(temporalDisplayText('date', true, D)).toBe(temporalDisplayText('date', false, D));
    });
});
