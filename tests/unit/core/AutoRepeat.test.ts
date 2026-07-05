// AutoRepeat drives an accelerating press-and-hold repeat via raw setTimeout,
// so its timing is exercised under Vitest fake timers; the state accessor is
// checked directly.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoRepeat } from '~/core/AutoRepeat';

describe('AutoRepeat', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function make(overrides: Partial<{ initialDelay: number; decay: number; floor: number }> = {}) {
        const ticks = { n: 0 };
        const repeat = new AutoRepeat({
            initialDelay: 400,
            decay:        0.75,
            floor:        40,
            onTick:       () => { ticks.n += 1; },
            ...overrides,
        });
        return { repeat, ticks };
    }

    it('fires onTick once synchronously on start()', () => {
        const { repeat, ticks } = make();
        repeat.start();
        expect(ticks.n).toBe(1); // before any timer advance
    });

    it('accelerates the interval by the decay factor each tick', () => {
        const { repeat, ticks } = make();
        repeat.start();                    // tick 1 (immediate)
        vi.advanceTimersByTime(400);       // initialDelay -> tick 2
        expect(ticks.n).toBe(2);
        vi.advanceTimersByTime(300);       // 400 * 0.75 -> tick 3
        expect(ticks.n).toBe(3);
        vi.advanceTimersByTime(225);       // 300 * 0.75 -> tick 4
        expect(ticks.n).toBe(4);
    });

    it('does not tick before the scheduled interval elapses', () => {
        const { repeat, ticks } = make();
        repeat.start();                    // tick 1
        vi.advanceTimersByTime(399);       // just under initialDelay
        expect(ticks.n).toBe(1);
        vi.advanceTimersByTime(1);         // now 400
        expect(ticks.n).toBe(2);
    });

    it('never lets the interval drop below the floor (saturates at floor cadence)', () => {
        const { repeat, ticks } = make();
        repeat.start();
        vi.advanceTimersByTime(5000);      // well past saturation to the floor
        const n0 = ticks.n;
        vi.advanceTimersByTime(40);        // one floor interval
        expect(ticks.n).toBe(n0 + 1);
        vi.advanceTimersByTime(40);
        expect(ticks.n).toBe(n0 + 2);
    });

    it('stop() before the first timeout leaves the immediate tick as the only tick', () => {
        const { repeat, ticks } = make();
        repeat.start();                    // tick 1 (immediate)
        repeat.stop();                     // quick click
        vi.advanceTimersByTime(10_000);
        expect(ticks.n).toBe(1);
    });

    it('stop() cancels all pending ticks', () => {
        const { repeat, ticks } = make();
        repeat.start();
        vi.advanceTimersByTime(400);       // tick 2
        repeat.stop();
        vi.advanceTimersByTime(10_000);
        expect(ticks.n).toBe(2);
    });

    it('stop() resets the delay so a later start() begins again at initialDelay', () => {
        const { repeat, ticks } = make();
        repeat.start();
        vi.advanceTimersByTime(700);       // decayed toward 225 for the next tick
        repeat.stop();

        repeat.start();                    // immediate tick
        const base = ticks.n;
        vi.advanceTimersByTime(399);       // under initialDelay -> no repeat yet
        expect(ticks.n).toBe(base);
        vi.advanceTimersByTime(1);         // reaches initialDelay(400)
        expect(ticks.n).toBe(base + 1);
    });

    it('isRunning() is false before start, true while armed, false after stop', () => {
        const { repeat } = make();
        expect(repeat.isRunning()).toBe(false);
        repeat.start();
        expect(repeat.isRunning()).toBe(true);
        repeat.stop();
        expect(repeat.isRunning()).toBe(false);
    });
});
