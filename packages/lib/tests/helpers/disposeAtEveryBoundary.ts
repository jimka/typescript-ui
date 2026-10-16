// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Disposes a component at every point where work it deferred is still pending,
// and reports what went wrong afterwards. See
// plans/implemented/deferred-work-after-dispose.md.
//
// A *boundary* is one step of deferred work: one promise the scenario handed
// out settling, one animation frame, or one timer firing. A scenario with N
// boundaries is run N + 1 times; run k walks k boundaries, disposes, and then
// gives everything still scheduled one round to run. After a dispose that
// round must throw nothing, log nothing through `console.error`, reject no
// promise the scenario returned, and leave no frame and no timer scheduled.
import { vi } from 'vitest';
import type { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** One 60 fps frame: what the fake clock advances by before each frame runs. */
const FRAME_MS = 16;

/**
 * Most boundaries walked for one scenario. A press-and-hold repeat never goes
 * idle on its own, so the walk needs a bound; 40 covers the longest finite
 * scenario in the registry (a wheel ease settles in about 25 frames).
 */
const MAX_BOUNDARIES = 40;

/** What a scenario uses to hand the component a promise the helper settles. */
export interface ScenarioControl {
    /**
     * Returns a promise that stays pending until the helper reaches it as a
     * boundary, then resolves with `value`.
     *
     * @param value - What the promise resolves with.
     */
    defer<T>(value: T): Promise<T>;
}

/** One component and one way to make it defer work. */
export interface DeferredWorkScenario<S = unknown> {
    /** Builds and renders the component. Frames and timers it leaves are run before `arm`. */
    make(control: ScenarioControl): Component | Promise<Component>;
    /** Starts the deferred work. A returned promise is watched for a rejection. */
    arm(component: Component, control: ScenarioControl): void | Promise<unknown>;
    /** Records what must not change after the dispose, read just before it. */
    snapshot?(component: Component): S;
    /** Asserts against the snapshot once the post-dispose round has run. */
    after?(component: Component, snapshot: S): void;
}

/** What went wrong after disposing at one boundary. */
export interface BoundaryFailure {
    /** How many boundaries had been walked when the component was disposed. */
    disposedAfter: number;
    /** One line per problem seen after the dispose. */
    problems: string[];
}

interface Deferred {
    settled: boolean;
    settle(): void;
}

/** The fake frame queue, timer clock and promise list one run uses. */
class BoundaryClock {
    readonly frames: Map<number, FrameRequestCallback> = new Map();
    readonly deferreds: Deferred[] = [];
    readonly problems: string[] = [];
    private _nextHandle: number = 0;
    private _restores: Array<() => void> = [];

    install(): void {
        installTestDOM(CONFIG);
        vi.useFakeTimers();

        const request = vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
            const handle = ++this._nextHandle;

            this.frames.set(handle, callback);

            return handle;
        });
        const cancel = vi.spyOn(DOM.sink, 'cancelAnimationFrame').mockImplementation((handle: number) => {
            this.frames.delete(handle);
        });
        const error = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            this.problems.push('console.error: ' + args.map(describe).join(' '));
        });

        this._restores = [() => request.mockRestore(), () => cancel.mockRestore(), () => error.mockRestore()];
    }

    uninstall(): void {
        for (const restore of this._restores) {
            restore();
        }

        vi.useRealTimers();
        DOM.reset();
    }

    control(): ScenarioControl {
        return {
            defer: <T>(value: T): Promise<T> => new Promise<T>((resolve) => {
                const deferred: Deferred = {
                    settled: false,
                    settle: (): void => {
                        deferred.settled = true;
                        resolve(value);
                    },
                };

                this.deferreds.push(deferred);
            }),
        };
    }

    /** Whether a frame or a timer is scheduled. */
    hasScheduledWork(): boolean {
        return this.frames.size > 0 || vi.getTimerCount() > 0;
    }

    /** Whether nothing is scheduled and every promise handed out has settled. */
    isIdle(): boolean {
        return !this.hasScheduledWork() && this.deferreds.every(d => d.settled);
    }

    /** Runs the frames pending now; a frame one of them requests waits for the next call. */
    runFrames(): void {
        vi.advanceTimersByTime(FRAME_MS);

        for (const [handle, callback] of Array.from(this.frames.entries())) {
            const pending = this.frames.delete(handle);

            if (!pending) {
                continue;
            }

            try {
                callback(performance.now());
            } catch (thrown) {
                this.problems.push('a frame threw: ' + describe(thrown));
            }
        }
    }

    /** Runs the timers pending now; a timer one of them arms waits for the next call. */
    runTimers(): void {
        try {
            vi.runOnlyPendingTimers();
        } catch (thrown) {
            this.problems.push('a timer threw: ' + describe(thrown));
        }
    }

    /** Walks one boundary: the oldest open promise, else a frame, else the next timer. */
    step(): void {
        const open = this.deferreds.find(d => !d.settled);

        if (open) {
            open.settle();

            return;
        }

        if (this.frames.size > 0) {
            this.runFrames();

            return;
        }

        try {
            vi.advanceTimersToNextTimer();
        } catch (thrown) {
            this.problems.push('a timer threw: ' + describe(thrown));
        }
    }
}

/** A thrown value as one line of text. */
function describe(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
}

/**
 * Waits one real macrotask, by which time every microtask queued so far has
 * run. `MessageChannel` is used because fake timers do not replace it, and
 * because it is typed without Node's own type package.
 */
function settleMicrotasks(): Promise<void> {
    return new Promise<void>((resolve) => {
        const channel = new MessageChannel();

        channel.port1.onmessage = (): void => {
            channel.port1.close();
            resolve();
        };
        channel.port2.postMessage(null);
    });
}

/** One run: build, arm, walk `boundaries` boundaries, dispose, run one more round. */
async function runOnce<S>(scenario: DeferredWorkScenario<S>, boundaries: number): Promise<{ problems: string[]; walked: number; idle: boolean }> {
    const clock = new BoundaryClock();

    clock.install();

    try {
        const control = clock.control();
        const component = await scenario.make(control);

        // Whatever building the component scheduled is not the work under test.
        for (let round = 0; round < MAX_BOUNDARIES; round++) {
            const scheduled = clock.hasScheduledWork();

            if (!scheduled) {
                break;
            }

            clock.runFrames();
            clock.runTimers();
        }

        const armed = scenario.arm(component, control);

        if (armed) {
            armed.catch((reason: unknown) => {
                clock.problems.push('the returned promise rejected: ' + describe(reason));
            });
        }

        await settleMicrotasks();

        let walked = 0;
        let idle = clock.isIdle();

        while (walked < boundaries && !idle) {
            clock.step();
            await settleMicrotasks();
            walked++;
            idle = clock.isIdle();
        }

        const snapshot = scenario.snapshot?.(component) as S;

        // Only what happens from the dispose on is a finding.
        clock.problems.length = 0;

        try {
            component.dispose();
        } catch (thrown) {
            clock.problems.push('dispose threw: ' + describe(thrown));
        }

        for (const deferred of clock.deferreds) {
            if (!deferred.settled) {
                deferred.settle();
            }
        }

        await settleMicrotasks();
        clock.runFrames();
        clock.runTimers();
        await settleMicrotasks();

        if (clock.frames.size > 0) {
            clock.problems.push(`${clock.frames.size} frame(s) still scheduled`);
        }

        const timers = vi.getTimerCount();

        if (timers > 0) {
            clock.problems.push(`${timers} timer(s) still scheduled`);
        }

        try {
            scenario.after?.(component, snapshot);
        } catch (thrown) {
            clock.problems.push('after: ' + describe(thrown));
        }

        return { problems: clock.problems.slice(), walked, idle };
    } finally {
        clock.uninstall();
    }
}

/**
 * Runs `scenario` once per boundary of its deferred work, disposing one
 * boundary later each time, and collects what went wrong after each dispose.
 *
 * @param scenario - The component and the way to make it defer work.
 * @returns How many boundaries the work has, and one entry per disposal point
 *   that left a problem behind. An empty `failures` list is a pass.
 */
export async function disposeAtEveryBoundary<S>(scenario: DeferredWorkScenario<S>): Promise<{ boundaries: number; failures: BoundaryFailure[] }> {
    const failures: BoundaryFailure[] = [];
    let boundaries = MAX_BOUNDARIES;

    for (let disposedAfter = 0; disposedAfter <= boundaries; disposedAfter++) {
        const run = await runOnce(scenario, disposedAfter);

        if (run.problems.length > 0) {
            failures.push({ disposedAfter, problems: run.problems });
        }

        if (run.idle) {
            boundaries = run.walked;
        }
    }

    return { boundaries, failures };
}
