// @vitest-environment jsdom
//
// The pointer, theme and typing drivers build real DOM events and read
// stylesheets, which node does not have. jsdom lays nothing out, so every
// rectangle a driver reads is stubbed; the drivers' pure helpers and target
// checks are tested in node, in drivers.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countCssRules, fireMouse } from '../src/harness/dom.js';
import { DRIVERS } from '../src/harness/drivers.js';
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
