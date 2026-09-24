// @vitest-environment jsdom
//
// The pointer, theme and typing drivers build real DOM events and read
// stylesheets, which node does not have. jsdom lays nothing out, so every
// rectangle a driver reads is stubbed; the drivers' pure helpers and target
// checks are tested in node, in drivers.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countCssRules, fireMouse } from '../src/harness/dom.js';
import { DRIVERS } from '../src/harness/drivers.js';
import { sampleGeometry, setGeometryTargets, takeGeometry } from '../src/harness/probes.js';
import type { DriveContext, HarnessTools, ThemeTarget } from '../src/harness/types.js';

/** The pointer and mouse event types a recording listener captures. */
const POINTER_TYPES = ['pointerover', 'pointerout', 'pointermove', 'pointerdown', 'pointerup', 'mouseover', 'mouseout', 'mousemove', 'mousedown', 'mouseup', 'click'];

/** Pixels per unit for the hover sweep: large enough that four units cross from A into B. */
const HOVER_STEP_PX = 30;

/**
 * Fake harness tools around the real `fireMouse`: `runFrames` calls `step`
 * for every unit synchronously, `suspendCounting` runs its work and
 * `waitFrames` resolves at once.
 *
 * @returns The tools.
 */
function fakeTools(): HarnessTools {
    const tools = {
        runFrames: async (units: number, step: (index: number) => void): Promise<number[]> => {
            for (let index = 0; index < units; index++) {
                step(index);
            }

            return [];
        },
        suspendCounting: async <T>(work: () => Promise<T>): Promise<T> => work(),
        waitFrames: async (): Promise<void> => {},
        fireMouse,
    };

    return tools as unknown as HarnessTools;
}

/**
 * A driver context over the fake tools.
 *
 * @param target - The driver's target.
 * @param units - How many units to drive.
 * @param stepPx - Pixels per unit.
 * @returns The context.
 */
function context(target: unknown, units: number, stepPx: number = 3): DriveContext {
    return { target, units, stepPx, params: new URLSearchParams(), notes: [], tools: fakeTools() };
}

/**
 * Stubs a jsdom element's rectangle, as the docs site's DocsContent.test.ts does.
 *
 * @param element - The element.
 * @param left - Its left edge.
 * @param top - Its top edge.
 * @param width - Its width.
 * @param height - Its height.
 */
function stubRect(element: Element, left: number, top: number, width: number, height: number): void {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
        toJSON: () => ({}),
    } as DOMRect);
}

/** One recorded event: its type, the names of its target and related target, its buttons and its point. */
interface Seen {
    type: string;
    target: string;
    buttons: number;
    related: string | null;
    x: number;
    y: number;
}

/**
 * A parent P holding A and B side by side: P `{0,0,100,20}`, A `{0,0,50,20}`,
 * B `{50,0,50,20}`. A listener on P records every pointer and mouse event.
 *
 * @returns The three elements and the recorded events.
 */
function stage(): { p: HTMLElement; a: HTMLElement; b: HTMLElement; seen: Seen[] } {
    const p = document.createElement('div');
    const a = document.createElement('div');
    const b = document.createElement('div');
    const names = new Map<EventTarget, string>([[p, 'P'], [a, 'A'], [b, 'B']]);
    const seen: Seen[] = [];

    p.append(a, b);
    document.body.appendChild(p);
    stubRect(p, 0, 0, 100, 20);
    stubRect(a, 0, 0, 50, 20);
    stubRect(b, 50, 0, 50, 20);

    for (const type of POINTER_TYPES) {
        p.addEventListener(type, (event) => {
            const mouse = event as MouseEvent;

            seen.push({
                type,
                target: names.get(event.target!) ?? '?',
                buttons: mouse.buttons,
                related: mouse.relatedTarget ? names.get(mouse.relatedTarget) ?? '?' : null,
                x: mouse.clientX,
                y: mouse.clientY,
            });
        });
    }

    return { p, a, b, seen };
}

afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.head.replaceChildren();
});

describe('E19 pointer event sequences', () => {
    it('hover crosses from A into B and leaves B at the end', async () => {
        const { p, seen } = stage();
        const ctx = context({ element: p, axis: 'x' }, 4, HOVER_STEP_PX);

        await DRIVERS.hover(ctx);

        expect(seen.map((e) => [e.type, e.target, e.related])).toEqual([
            ['pointerover', 'A', null], ['mouseover', 'A', null], ['pointermove', 'A', null], ['mousemove', 'A', null],
            ['pointerout', 'A', 'B'], ['mouseout', 'A', 'B'], ['pointerover', 'B', 'A'], ['mouseover', 'B', 'A'], ['pointermove', 'B', null], ['mousemove', 'B', null],
            ['pointermove', 'B', null], ['mousemove', 'B', null],
            ['pointermove', 'B', null], ['mousemove', 'B', null],
            ['pointerout', 'B', null], ['mouseout', 'B', null],
        ]);
        expect(seen.every((e) => e.buttons === 0)).toBe(true);
        expect(seen.filter((e) => e.type === 'pointermove').map((e) => [e.x, e.y])).toEqual([[31, 10], [61, 10], [91, 10], [77, 10]]);
        expect(ctx.notes).toEqual(['hover: 2 crossings over 4 units among 3 elements']);
    });

    it.each([
        ['pointer-events: none', 'pointerEvents', 'none'],
        ['visibility: hidden', 'visibility', 'hidden'],
    ])('hover skips a descendant with %s, as the engine\'s hit test does', async (_rule, property, value) => {
        const { p, b, seen } = stage();
        const face = document.createElement('span');

        // A label over the whole of B, as a button's content sits over the button.
        (face.style as unknown as Record<string, string>)[property] = value;
        b.appendChild(face);
        stubRect(face, 50, 0, 50, 20);

        const ctx = context({ element: p, axis: 'x' }, 4, HOVER_STEP_PX);

        await DRIVERS.hover(ctx);

        expect(seen.filter((e) => e.type === 'pointermove').map((e) => e.target)).toEqual(['A', 'B', 'B', 'B']);
        expect(ctx.notes).toEqual(['hover: 2 crossings over 4 units among 3 elements']);
    });

    it('click presses and releases at each element\'s centre in turn', async () => {
        const { a, b, seen } = stage();

        await DRIVERS.click(context({ elements: [a, b] }, 3));

        const press = (target: string, x: number): unknown[] => [
            ['pointerdown', target, 1, x], ['mousedown', target, 1, x], ['pointerup', target, 0, x], ['mouseup', target, 0, x], ['click', target, 0, x],
        ];

        expect(seen.map((e) => [e.type, e.target, e.buttons, e.x])).toEqual([...press('A', 25), ...press('B', 75), ...press('A', 25)]);
        expect(seen.every((e) => e.y === 10 && e.related === null)).toBe(true);
    });
});

describe('E20 theme and countCssRules', () => {
    it('counts the rules a stylesheet adds', () => {
        const before = countCssRules();
        const style = document.createElement('style');

        style.textContent = 'a{} b{}';
        document.head.appendChild(style);

        expect(countCssRules()).toBe(before + 2);
    });

    it('cycles once per unit, restores once, and notes the rule totals', async () => {
        const calls: string[] = [];
        const added: HTMLStyleElement[] = [];

        const target: ThemeTarget = {
            cycle(index: number): void {
                const style = document.createElement('style');

                style.textContent = `.theme${index}{}`;
                document.head.appendChild(style);
                added.push(style);
                calls.push(`cycle ${index}`);
            },
            restore(): void {
                added.forEach((style) => style.remove());
                calls.push('restore');
            },
        };

        const before = countCssRules();
        const ctx = context(target, 3);

        await DRIVERS.theme(ctx);

        expect(calls).toEqual(['cycle 0', 'cycle 1', 'cycle 2', 'restore']);
        expect(ctx.notes).toEqual([`theme: CSS rules ${before} → ${before + 3} over 3 switches`]);
        expect(countCssRules()).toBe(before);
    });
});

describe('E21 type', () => {
    it('rejects before dispatching anything when the engine has no execCommand', async () => {
        const input = document.createElement('input');
        const dispatch = vi.spyOn(input, 'dispatchEvent');

        document.body.appendChild(input);

        expect(typeof (document as { execCommand?: unknown }).execCommand).toBe('undefined');
        await expect(DRIVERS.type(context({ element: input, text: 'ab' }, 3))).rejects.toThrow('type: this engine has no document.execCommand; cannot type into input');
        expect(dispatch).not.toHaveBeenCalled();
        expect(document.activeElement).not.toBe(input);
    });

    describe('with a stubbed execCommand', () => {
        afterEach(() => {
            delete (document as { execCommand?: unknown }).execCommand;
        });

        it('rejects an element that does not take focus', async () => {
            const div = document.createElement('div');

            document.body.appendChild(div);
            (document as { execCommand?: unknown }).execCommand = vi.fn(() => true);

            await expect(DRIVERS.type(context({ element: div, text: 'ab' }, 3))).rejects.toThrow('type: div did not take focus');
        });

        it('rejects a unit whose insert fails', async () => {
            const input = document.createElement('input');

            document.body.appendChild(input);
            (document as { execCommand?: unknown }).execCommand = vi.fn(() => false);

            await expect(DRIVERS.type(context({ element: input, text: 'ab' }, 3))).rejects.toThrow('type: document.execCommand("insertText") returned false for input');
        });

        it('inserts one character per unit, cycling the text, then deletes as many and notes them', async () => {
            const input = document.createElement('input');
            const exec = vi.fn(() => true);

            input.value = 'xy';
            document.body.appendChild(input);
            (document as { execCommand?: unknown }).execCommand = exec;

            const ctx = context({ element: input, text: 'ab' }, 3);

            await DRIVERS.type(ctx);

            expect(exec.mock.calls).toEqual([['insertText', false, 'a'], ['insertText', false, 'b'], ['insertText', false, 'a'], ['delete'], ['delete'], ['delete']]);
            expect(document.activeElement).toBe(input);
            expect(input.selectionStart).toBe(2);
            expect(ctx.notes).toEqual(['type: 3 characters into input']);
        });
    });
});

/**
 * Fake tools that log, in order, each counting suspension, each frame wait
 * (and whether it came while counting was suspended), each measured frame
 * loop and each mouse event, the last with its target and point.
 *
 * @returns The tools and the log.
 */
function loggingTools(): { tools: HarnessTools; log: string[] } {
    const log: string[] = [];
    let suspended = false;

    const tools = {
        runFrames: async (units: number, step: (index: number) => void): Promise<number[]> => {
            log.push(`runFrames ${units}`);

            for (let index = 0; index < units; index++) {
                step(index);
            }

            return [];
        },
        suspendCounting: async <T>(work: () => Promise<T>): Promise<T> => {
            suspended = true;

            try {
                return await work();
            } finally {
                suspended = false;
            }
        },
        waitFrames: async (frames: number): Promise<void> => {
            log.push(`waitFrames ${frames}${suspended ? ' suspended' : ''}`);
        },
        fireMouse: (type: string, target: EventTarget, x: number, y: number): void => {
            log.push(`${type} ${target === document ? 'document' : 'element'} ${x},${y}`);
        },
    };

    return { tools: tools as unknown as HarnessTools, log };
}

describe('setup settles before the measured units', () => {
    afterEach(() => {
        delete (document as { execCommand?: unknown }).execCommand;
    });

    it('key focuses its element and waits for the page, counting suspended, before its frames', async () => {
        const input = document.createElement('input');
        const { tools, log } = loggingTools();

        document.body.appendChild(input);
        await DRIVERS.key({ target: { element: input, keys: ['ArrowDown'] }, units: 2, stepPx: 3, params: new URLSearchParams(), notes: [], tools });

        expect(document.activeElement).toBe(input);
        expect(log).toEqual(['waitFrames 3 suspended', 'runFrames 2']);
    });

    it('type places its caret and waits for the page, counting suspended, before its frames', async () => {
        const input = document.createElement('input');
        const { tools, log } = loggingTools();

        document.body.appendChild(input);
        (document as { execCommand?: unknown }).execCommand = vi.fn(() => true);
        await DRIVERS.type({ target: { element: input, text: 'ab' }, units: 2, stepPx: 3, params: new URLSearchParams(), notes: [], tools });

        expect(log).toEqual(['waitFrames 3 suspended', 'runFrames 2', 'waitFrames 3 suspended']);
    });

    describe('settle', () => {
        /** The probed element's id, which the probe's target selects it by. */
        const BOX_ID = 'settle-box';

        /**
         * The frame-by-frame samples of a rectangle that moves twice and then
         * rests, as `[left, top, width, height]`: the worked example in
         * plans/implemented/qa-panel-determinism.md.
         */
        const MOVING: ReadonlyArray<[number, number, number, number]> = [
            [1, 82, 2431, 20],
            [1, 68, 2431, 20],
            [1, 62, 2431, 20],
        ];

        /** A rectangle that never moves at all. */
        const AT_REST: [number, number, number, number] = [1, 62, 2431, 20];

        /**
         * An eased scroll's tail: three sub-pixel steps that all round to the
         * same `top` as the rest they end at, then rest. What the driver must
         * not read as settled on its first comparison.
         */
        const CLOSING: ReadonlyArray<[number, number, number, number]> = [
            [1, 62.4, 2431, 20],
            [1, 62.3, 2431, 20],
            [1, 62.2, 2431, 20],
            [1, 62, 2431, 20],
        ];

        afterEach(() => {
            // The probe is module state in probes.ts, so a target left behind
            // would be sampled by the next file's runs.
            setGeometryTargets(null);
        });

        /**
         * A probed box whose rectangle reads whatever `rectFor` gives for that
         * call. jsdom lays nothing out and reports every rectangle as zero, so
         * the samples the wait watches have to be scripted.
         *
         * @param rectFor - The rectangle for sample number `call`, counted from 0.
         * @returns The spy on the box's `getBoundingClientRect`, for counting the samples taken.
         */
        function probedBox(rectFor: (call: number) => [number, number, number, number]): ReturnType<typeof vi.spyOn> {
            const box = document.createElement('div');

            box.id = BOX_ID;
            document.body.appendChild(box);

            let call = 0;

            const spy = vi.spyOn(box, 'getBoundingClientRect').mockImplementation(() => {
                const [left, top, width, height] = rectFor(call++);

                return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
            });

            setGeometryTargets({ box: `#${BOX_ID}` });

            return spy;
        }

        /**
         * A `settle` context over logging tools; the target is ignored.
         *
         * @param units - How many units to measure.
         * @returns The context and the log.
         */
        function settleContext(units: number): { ctx: DriveContext; log: string[] } {
            const { tools, log } = loggingTools();

            return { ctx: { target: document.body, units, stepPx: 3, params: new URLSearchParams(), notes: [], tools }, log };
        }

        it('waits for the probed rectangle to stop moving, names the frame it rested on, and measures after it', async () => {
            const spy = probedBox((call) => MOVING[Math.min(call, MOVING.length - 1)]);
            const { ctx, log } = settleContext(4);

            await DRIVERS.settle(ctx);

            // Five samples: the one before any wait, the two that moved, and
            // the two equal ones that end the wait — so four one-frame waits,
            // every one of them inside the suspension, and only then the units.
            expect(spy).toHaveBeenCalledTimes(5);
            expect(ctx.notes).toEqual(['settle: stable after 4 frames']);
            expect(log).toEqual(['waitFrames 1 suspended', 'waitFrames 1 suspended', 'waitFrames 1 suspended', 'waitFrames 1 suspended', 'runFrames 4']);
        });

        it('still waits for two equal samples when the page is already at rest', async () => {
            const spy = probedBox(() => AT_REST);
            const { ctx, log } = settleContext(4);

            await DRIVERS.settle(ctx);

            expect(spy).toHaveBeenCalledTimes(3);
            expect(ctx.notes).toEqual(['settle: stable after 2 frames']);
            expect(log).toEqual(['waitFrames 1 suspended', 'waitFrames 1 suspended', 'runFrames 4']);
        });

        it('keeps waiting while a rectangle is still moving by less than a pixel', async () => {
            const spy = probedBox((call) => CLOSING[Math.min(call, CLOSING.length - 1)]);
            const { ctx, log } = settleContext(4);

            await DRIVERS.settle(ctx);

            // Every one of those samples rounds to a `top` of 62, so a wait
            // comparing the rounded samples the probe records would have called
            // the page settled after two frames and left the last whole-pixel
            // step of the ease to land in a measured unit.
            expect(spy).toHaveBeenCalledTimes(6);
            expect(ctx.notes).toEqual(['settle: stable after 5 frames']);
            expect(log[log.length - 1]).toBe('runFrames 4');
        });

        it('records the rounded rectangle even though the wait compares the exact one', () => {
            probedBox(() => CLOSING[0]);
            sampleGeometry();

            // The two readers are deliberately different: a report's series is
            // rounded, because that is the resolution a geometry gate compares
            // at, which is exactly why the wait above cannot round.
            expect(takeGeometry()).toEqual({ box: [[1, 62, 2431, 20]] });
        });

        it('fails the run when the probed rectangle never stops moving', async () => {
            const spy = probedBox((call) => [1, call, 2431, 20]);
            const { ctx, log } = settleContext(4);

            await expect(DRIVERS.settle(ctx)).rejects.toThrow('settle: still moving after 120 frames');

            // The cap's worth of waits and one sample each side of them, and
            // not one measured unit: a page that never rests is not measured.
            expect(spy).toHaveBeenCalledTimes(121);
            expect(log.filter((line) => line.startsWith('runFrames'))).toEqual([]);
            expect(ctx.notes).toEqual([]);
        });
    });
});

describe('park', () => {
    /** Where the gutter starts, parked, and once dragged back past its start: `left,top,width,height`. */
    const START = { left: 100, top: 0, width: 10, height: 200 };
    const PARKED = { left: 40, top: 0, width: 10, height: 200 };

    /**
     * A gutter whose rectangle reads, call by call: its start (the lead-in's
     * press), `lead` (once the lead-in settled), `held` (at the end of the
     * measured units), then the parked place (the restore's press).
     *
     * @param lead - The rectangle after the lead-in.
     * @param held - The rectangle after the measured units.
     * @returns The gutter.
     */
    function gutter(lead: typeof START, held: typeof START): HTMLElement {
        const element = document.createElement('div');
        const spy = vi.spyOn(element, 'getBoundingClientRect');

        for (const r of [START, lead, held, PARKED]) {
            spy.mockReturnValueOnce({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) } as DOMRect);
        }

        document.body.appendChild(element);

        return element;
    }

    /**
     * A `park` context over logging tools: drag left, 50 px of lead, 3 px per unit.
     *
     * @param element - The gutter.
     * @param units - How many units.
     * @returns The context and the log.
     */
    function parkContext(element: Element, units: number): { ctx: DriveContext; log: string[] } {
        const { tools, log } = loggingTools();

        return { ctx: { target: { element, axis: 'x', direction: -1, leadPx: 50 }, units, stepPx: 3, params: new URLSearchParams(), notes: [], tools }, log };
    }

    it('leads in, pushes past the lead, releases and drags back, all but the pushes suspended', async () => {
        const element = gutter(PARKED, PARKED);
        const { ctx, log } = parkContext(element, 4);

        await DRIVERS.park(ctx);

        // Centre (105, 100); ten lead-in moves of 5 px; measured offsets 53, 56, 53, 50.
        const leadIn = Array.from({ length: 10 }, (_, f) => [`mousemove document ${100 - 5 * f},100`, 'waitFrames 1 suspended']).flat();
        // From the parked centre (45, 100) back to the start in ten 6 px moves.
        const dragBack = Array.from({ length: 10 }, (_, f) => [`mousemove document ${51 + 6 * f},100`, 'waitFrames 1 suspended']).flat();

        expect(log).toEqual([
            'mousedown element 105,100',
            ...leadIn,
            'waitFrames 3 suspended',
            'runFrames 4',
            'mousemove document 52,100',
            'mousemove document 49,100',
            'mousemove document 52,100',
            'mousemove document 55,100',
            'mouseup document 55,100',
            'mousedown element 45,100',
            ...dragBack,
            'mouseup document 105,100',
            'waitFrames 3 suspended',
        ]);
        expect(ctx.notes).toEqual(['park: lead 50px, element held at 40,0,10,200 for 4 units']);
    });

    it('fails after restoring when the element moved during the measured units', async () => {
        const element = gutter(PARKED, { ...PARKED, left: 37 });
        const { ctx, log } = parkContext(element, 4);

        await expect(DRIVERS.park(ctx)).rejects.toThrow('park: the element moved during the measured units (40,0,10,200 → 37,0,10,200); leadPx does not reach the clamp');
        expect(log.slice(-2)).toEqual(['mouseup document 105,100', 'waitFrames 3 suspended']);
        expect(ctx.notes).toEqual([]);
    });

    it('needs at least two units, before dispatching anything', async () => {
        const element = gutter(PARKED, PARKED);
        const { ctx, log } = parkContext(element, 1);

        await expect(DRIVERS.park(ctx)).rejects.toThrow('park: needs at least 2 units, got 1');
        expect(log).toEqual([]);
    });
});

describe('E22 pan', () => {
    /** Pixels per unit for the pan: the plan's E22 table. */
    const PAN_STEP_PX = 10;

    it('presses P, moves out and back on P, and releases there, every event on P', async () => {
        const { p, seen } = stage();

        await DRIVERS.pan(context({ element: p, axis: 'x' }, 4, PAN_STEP_PX));

        expect(seen.map((e) => [e.type, e.target, e.x, e.buttons])).toEqual([
            ['pointerdown', 'P', 50, 1], ['mousedown', 'P', 50, 1],
            ['pointermove', 'P', 60, 1], ['mousemove', 'P', 60, 1],
            ['pointermove', 'P', 70, 1], ['mousemove', 'P', 70, 1],
            ['pointermove', 'P', 60, 1], ['mousemove', 'P', 60, 1],
            ['pointermove', 'P', 50, 1], ['mousemove', 'P', 50, 1],
            ['pointerup', 'P', 50, 0], ['mouseup', 'P', 50, 0],
        ]);
        expect(seen.every((e) => e.y === 10 && e.related === null)).toBe(true);
    });

    it('presses before its frames, then releases and settles with counting suspended', async () => {
        const { p } = stage();
        const { tools, log } = loggingTools();

        await DRIVERS.pan({ target: { element: p, axis: 'y' }, units: 2, stepPx: PAN_STEP_PX, params: new URLSearchParams(), notes: [], tools });

        // Along y from the centre (50, 10): one unit out to 20, one back to 10.
        expect(log).toEqual([
            'mousedown element 50,10',
            'runFrames 2',
            'mousemove element 50,20',
            'mousemove element 50,10',
            'mouseup element 50,10',
            'waitFrames 3 suspended',
        ]);
    });
});

describe('E24 hwheel', () => {
    it('sends one horizontal wheel notch per unit at P\'s centre, out and back', async () => {
        const { p } = stage();
        const wheels: WheelEvent[] = [];

        p.addEventListener('wheel', (event) => wheels.push(event as WheelEvent));
        await DRIVERS.hwheel(context(p, 4));

        expect(wheels.map((e) => [e.clientX, e.clientY, e.deltaX, e.deltaY])).toEqual([
            [50, 10, 40, 0], [50, 10, 40, 0], [50, 10, -40, 0], [50, 10, -40, 0],
        ]);
        expect(wheels.every((e) => e.target === p && e.bubbles && e.cancelable && e.deltaMode === WheelEvent.DOM_DELTA_PIXEL)).toBe(true);
    });
});

describe('E26 dragout', () => {
    // `drag`'s own sequence is covered by the panels' runs; `dragout` is
    // asserted here rather than in drivers.test.ts because it reaches
    // `requireElement` and dispatches on `document`, neither of which exists
    // in the node environment that file runs in.

    /**
     * A driver context whose `fireMouse` is a spy, over a stubbed element.
     *
     * @param axis - The target's axis.
     * @param units - How many units to drive.
     * @returns The context and the spy.
     */
    function spied(axis: string, units: number): { ctx: DriveContext; fireMouse: ReturnType<typeof vi.fn> } {
        const element = document.createElement('div');

        stubRect(element, 0, 0, 100, 20);

        const fireMouse = vi.fn();
        const tools = { ...fakeTools(), fireMouse } as unknown as HarnessTools;

        return { ctx: { target: { element, axis }, units, stepPx: 3, params: new URLSearchParams(), notes: [], tools }, fireMouse };
    }

    it.each([
        ['x' as const, [[53, 10], [56, 10], [59, 10]]],
        ['y' as const, [[50, 13], [50, 16], [50, 19]]],
    ])('drags along %s without ever coming back', async (axis, moves) => {
        const { ctx, fireMouse } = spied(axis, 3);

        await DRIVERS.dragout(ctx);

        const last = moves[moves.length - 1];

        expect(fireMouse.mock.calls.map((call) => [call[0], call[1] === document ? 'document' : 'element', call[2], call[3]])).toEqual([
            ['mousedown', 'element', 50, 10],
            ...moves.map(([x, y]) => ['mousemove', 'document', x, y]),
            ['mouseup', 'document', last[0], last[1]],
        ]);
    });

    it('rejects an axis it cannot drag along, before dispatching anything', async () => {
        const { ctx, fireMouse } = spied('z', 3);

        await expect(DRIVERS.dragout(ctx)).rejects.toThrow('dragout: target axis must be "x" or "y"');
        expect(fireMouse).not.toHaveBeenCalled();
    });
});

describe('E25 viewport', () => {
    it('fires the window\'s resize event once per unit', async () => {
        const listener = vi.fn();

        window.addEventListener('resize', listener);

        try {
            await DRIVERS.viewport(context(document.body, 3));
        } finally {
            window.removeEventListener('resize', listener);
        }

        expect(listener).toHaveBeenCalledTimes(3);
    });
});
