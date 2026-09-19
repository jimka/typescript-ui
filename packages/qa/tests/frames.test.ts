import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentFrame, runFrames, runPasses, summarize, waitFrames } from '../src/harness/frames.js';

/** Delay of the stubbed frame callback: any timer tick will do, the loop only needs it asynchronous. */
const STUB_FRAME_DELAY_MS = 1;

/** Frame delays to wait for a stray frame after the loop settles: a stray request would fire within one, so ten is ample. */
const STRAY_FRAME_WAIT = 10;

/**
 * Stubs `requestAnimationFrame` so each request calls its callback on a timer,
 * the way a browser calls it on the next frame.
 *
 * @returns The stub, for counting requests.
 */
function stubFrames(): ReturnType<typeof vi.fn> {
    const raf = vi.fn((callback: (now: number) => void): number => {
        setTimeout(() => callback(performance.now()), STUB_FRAME_DELAY_MS);

        return 0;
    });

    vi.stubGlobal('requestAnimationFrame', raf);

    return raf;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('E1 summarize', () => {
    it('summarises four samples', () => {
        expect(summarize([10, 20, 30, 40])).toEqual({ n: 4, avgMs: 25, p50Ms: 30, p90Ms: 40, maxMs: 40, over16: 3 });
    });

    it('summarises no samples as zeros', () => {
        expect(summarize([])).toEqual({ n: 0, avgMs: 0, p50Ms: 0, p90Ms: 0, maxMs: 0, over16: 0 });
    });
});

describe('E5 frame loop', () => {
    it('rejects on a throw and requests no frame after it', async () => {
        const raf = stubFrames();
        const boom = new Error('boom');

        const run = runFrames(5, (i) => {
            if (i === 2) {
                throw boom;
            }
        });

        await expect(run).rejects.toBe(boom);
        // Give a stray frame request the chance to fire before counting.
        await new Promise((resolve) => setTimeout(resolve, STUB_FRAME_DELAY_MS * STRAY_FRAME_WAIT));

        expect(raf).toHaveBeenCalledTimes(3);
    });

    it('resolves with one gap fewer than frames', async () => {
        stubFrames();

        const gaps = await runFrames(4, () => {});

        expect(gaps).toHaveLength(3);
    });

    it('runPasses rejects on a throw', async () => {
        const boom = new Error('boom');

        await expect(runPasses(3, (i) => {
            if (i === 1) {
                throw boom;
            }
        })).rejects.toBe(boom);
    });
});

describe('waitFrames', () => {
    it('waits the given frames without counting one', async () => {
        const raf = stubFrames();
        const before = currentFrame();

        await waitFrames(3);

        expect(raf).toHaveBeenCalledTimes(3);
        expect(currentFrame()).toBe(before);
    });
});
