import { describe, expect, it, vi } from 'vitest';
import { DRIVERS, hitIndex, makeCallDriver, parkOffset, sweepOffset } from '../src/harness/drivers.js';
import type { DriveContext, HarnessTools } from '../src/harness/types.js';

/** What the fake `runFrames` resolves to, so a test can tell the driver passed it through. */
const FAKE_SAMPLES = [1, 2, 3];

/**
 * Fake harness tools: `runFrames` calls `step` for every unit synchronously
 * and resolves to `FAKE_SAMPLES`, `suspendCounting` runs its work, and
 * `waitFrames` resolves at once. Nothing here needs a DOM.
 *
 * @returns The tools, with `runFrames` and `fireMouse` as spies.
 */
function fakeTools(): HarnessTools & { runFrames: ReturnType<typeof vi.fn>; fireMouse: ReturnType<typeof vi.fn> } {
    const tools = {
        runFrames: vi.fn(async (units: number, step: (index: number) => void): Promise<number[]> => {
            for (let index = 0; index < units; index++) {
                step(index);
            }

            return FAKE_SAMPLES;
        }),
        suspendCounting: async <T>(work: () => Promise<T>): Promise<T> => work(),
        waitFrames: async (): Promise<void> => {},
        fireMouse: vi.fn(),
    };

    return tools as unknown as HarnessTools & { runFrames: ReturnType<typeof vi.fn>; fireMouse: ReturnType<typeof vi.fn> };
}

/**
 * A driver context over the fake tools.
 *
 * @param target - The driver's target.
 * @param units - How many units to drive.
 * @param tools - The tools; fresh fakes by default.
 * @returns The context.
 */
function context(target: unknown, units: number, tools: HarnessTools = fakeTools()): DriveContext {
    return { target, units, stepPx: 3, params: new URLSearchParams(), notes: [], tools };
}

/**
 * A stand-in element: the two functions that make a value an element to the
 * drivers, and `focus`. `dispatchEvent` is a spy, so a test can check that
 * nothing was dispatched.
 *
 * @param width - The width its rectangle reports.
 * @param height - The height its rectangle reports.
 * @returns The fake element.
 */
function fakeElement(width: number = 100, height: number = 20): { getBoundingClientRect(): object; dispatchEvent: ReturnType<typeof vi.fn>; focus(): void } {
    return {
        getBoundingClientRect: (): object => ({ left: 0, top: 0, width, height, right: width, bottom: height }),
        dispatchEvent: vi.fn(() => true),
        focus: (): void => {},
    };
}

describe('E13 sweepOffset', () => {
    it.each([
        [0, 3],
        [2, 9],
        [3, 8],
        [6, 1],
        [9, 10],
    ])('index %i with step 3 and span 10 is %i', (index, offset) => {
        expect(sweepOffset(index, 3, 10)).toBe(offset);
    });
});

describe('E14 hitIndex', () => {
    const rects = [
        { left: 0, top: 0, width: 100, height: 20 },
        { left: 10, top: 0, width: 30, height: 20 },
        { left: 50, top: 0, width: 30, height: 20 },
    ];

    it.each([
        [15, 5, 1],
        [60, 5, 2],
        [45, 5, 0],
        [100, 5, -1],
        [0, 0, 0],
    ])('(%i, %i) hits %i', (x, y, hit) => {
        expect(hitIndex(rects, x, y)).toBe(hit);
    });

    it('skips an index that is not usable', () => {
        expect(hitIndex(rects, 15, 5, (index) => index !== 1)).toBe(0);
    });
});

describe('E15 parkOffset', () => {
    it.each([
        [0, 103],
        [1, 106],
        [2, 103],
        [3, 100],
    ])('index %i of 4 units is %i', (index, offset) => {
        expect(parkOffset(index, 4, 3, 100)).toBe(offset);
    });

    it.each([
        [0, 103],
        [1, 106],
        [2, 100],
    ])('index %i of 3 units is %i', (index, offset) => {
        expect(parkOffset(index, 3, 3, 100)).toBe(offset);
    });

    it('never returns closer than the lead', () => {
        const offsets = Array.from({ length: 150 }, (_, index) => parkOffset(index, 150, 3, 160));

        expect(Math.min(...offsets)).toBe(160);
    });
});

describe('E16 call and idle', () => {
    it('calls the target once per unit, in order, and resolves to the frame samples', async () => {
        const calls: number[] = [];
        const samples = await makeCallDriver('update')(context((index: number) => calls.push(index), 3));

        expect(calls).toEqual([0, 1, 2]);
        expect(samples).toEqual(FAKE_SAMPLES);
    });

    it('rejects a target that is not a function', async () => {
        await expect(makeCallDriver('update')(context(42, 3))).rejects.toThrow('update: target must be a function (index) => void');
    });

    it.each(['call', 'update', 'toggle'])('%s is in the table and names itself in its errors', async (name) => {
        await expect(DRIVERS[name](context({}, 3))).rejects.toThrow(`${name}: target must be a function (index) => void`);
    });

    it('idle runs the frames and nothing else', async () => {
        const tools = fakeTools();

        await DRIVERS.idle(context({}, 5, tools));

        expect(tools.runFrames).toHaveBeenCalledTimes(1);
        expect(tools.runFrames.mock.calls[0][0]).toBe(5);
    });
});

describe('E17 target validation', () => {
    const HOVER_SHAPE = 'hover: target must be { element, axis: "x" | "y" }';
    const PARK_SHAPE = 'park: target must be { element, axis: "x" | "y", direction: 1 | -1, leadPx > 0 }';
    const CLICK_SHAPE = 'click: target must be { elements: [Element, …] } with at least one element';
    const KEY_SHAPE = 'key: target must be { element, keys: [string, …] } with at least one key';
    const TYPE_SHAPE = 'type: target must be { element, text } with a non-empty text';
    const THEME_SHAPE = 'theme: target must be { cycle(index), restore() }';

    it.each([
        ['hover', { axis: 'x' }, HOVER_SHAPE],
        ['hover', { element: fakeElement(), axis: 'z' }, HOVER_SHAPE],
        ['park', { element: fakeElement(), axis: 'x', direction: -1, leadPx: 0 }, PARK_SHAPE],
        ['park', { element: fakeElement(), axis: 'x', direction: 2, leadPx: 100 }, PARK_SHAPE],
        ['park', { element: fakeElement(), axis: 'z', direction: 1, leadPx: 100 }, PARK_SHAPE],
        ['park', { axis: 'x', direction: 1, leadPx: 100 }, PARK_SHAPE],
        ['click', {}, CLICK_SHAPE],
        ['click', { elements: [] }, CLICK_SHAPE],
        ['click', { elements: [fakeElement(), {}] }, CLICK_SHAPE],
        ['key', { element: fakeElement(), keys: [] }, KEY_SHAPE],
        ['key', { element: fakeElement(), keys: ['ArrowDown', 1] }, KEY_SHAPE],
        ['key', { keys: ['ArrowDown'] }, KEY_SHAPE],
        ['type', { element: fakeElement(), text: '' }, TYPE_SHAPE],
        ['type', { element: fakeElement(), text: 7 }, TYPE_SHAPE],
        ['type', { element: { ...fakeElement(), focus: undefined }, text: 'ab' }, TYPE_SHAPE],
        ['theme', { cycle(): void {} }, THEME_SHAPE],
        ['theme', null, THEME_SHAPE],
    ])('%s rejects %j', async (driver, target, message) => {
        await expect(DRIVERS[driver](context(target, 3))).rejects.toThrow(message);
    });

    it('hover rejects an element with no room to sweep, before dispatching anything', async () => {
        const element = fakeElement(2, 20);

        await expect(DRIVERS.hover(context({ element, axis: 'x' }, 3))).rejects.toThrow('hover: element has no extent along x');
        expect(element.dispatchEvent).not.toHaveBeenCalled();
    });

    it('rejects before dispatching anything', async () => {
        const element = fakeElement();
        const tools = fakeTools();

        await expect(DRIVERS.key(context({ element, keys: [] }, 3, tools))).rejects.toThrow(KEY_SHAPE);
        await expect(DRIVERS.park(context({ element, axis: 'x', direction: 1, leadPx: -5 }, 3, tools))).rejects.toThrow(PARK_SHAPE);
        expect(element.dispatchEvent).not.toHaveBeenCalled();
        expect(tools.fireMouse).not.toHaveBeenCalled();
        expect(tools.runFrames).not.toHaveBeenCalled();
    });
});
