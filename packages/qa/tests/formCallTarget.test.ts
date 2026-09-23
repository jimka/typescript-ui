// @vitest-environment jsdom
//
// C21's witness: `form-flat`'s `call` target types past both decorated
// fields' limit, hovers the first, and once its error tooltip is up deletes
// one character from the second, which clears its error. The panel mounts
// through the real `mountPanel` into the page body, as in mount.test.ts, so
// this file needs a real DOM.
//
// The fields measure their baselines through the canvas 2D context, which
// jsdom does not implement, so every test here stubs it, as mount.test.ts's
// `canvas-idle hidden group` does. These tests live in their own file because
// the stub outlives them: the library keeps the first 2D context it is given
// for font metrics as long as its module lives, so in mount.test.ts every later
// form or table mount would succeed, and its `JSDOM_GAPS` tests would stop
// throwing. Each test file gets its own modules.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Body, Component, DOM } from '@jimka/typescript-ui/core';
import { Tooltip } from '@jimka/typescript-ui/overlay';
import { createTools } from '../src/harness/run.js';
import type { CallTarget, HarnessTools } from '../src/harness/types.js';
import { mountPanel } from '../src/mount.js';
import type { MountedPanel, MountWaits } from '../src/mount.js';

/**
 * The harness tools, with `isPainted` standing in for layout, as in
 * mount.test.ts: jsdom gives every element an empty rectangle, so a
 * connected element counts as painted.
 */
const tools: HarnessTools = { ...createTools({ Body, DOM }), isPainted: (el: Element): boolean => el.isConnected };

/** The paint wait: lays the page out once, so `afterMount` finds the fields' elements. */
async function flushOnPaint(): Promise<void> {
    Body.getInstance().flushLayout();
}

/** The settle wait: nothing to wait for without a frame loop. */
async function settleAtOnce(): Promise<void> {}

const WAITS: MountWaits = { painted: flushOnPaint, settled: settleAtOnce };

/** One 60 Hz frame: the pace a `call` phase runs its units at. */
const FRAME_MS = 16;

/** Units that stay inside the tooltip's 500 ms hover delay: 30 frames are 480 ms. */
const HOVER_DELAY_UNITS = 30;

/** Units C21's sequence is read over: 60 frames are 960 ms, past the hover delay and a 100 ms fade after the keystroke. */
const C21_UNITS = 60;

/** How long `afterEach` lets a hidden tooltip settle: past its 100 ms fade and the fade's 40 ms fallback timer. */
const FADE_SETTLE_MS = 500;

/** Text one character past the decorated fields' limit: `builders/form.ts` allows 20 characters. */
const OVER = 'x'.repeat(21);

/**
 * Runs units `from`…`to − 1` of a `call` target as a frame loop would: one
 * frame's time passes before each unit.
 *
 * @param call - The target.
 * @param from - The first unit's index.
 * @param to - One past the last unit's index.
 */
function runUnits(call: CallTarget, from: number, to: number): void {
    for (let i = from; i < to; i++) {
        vi.advanceTimersByTime(FRAME_MS);
        call(i);
    }
}

/**
 * The text of every decorated field on the page, sorted: the component walk
 * does not follow form order, so a test compares the sorted list.
 *
 * @returns Each `FieldDecorator`'s field's text.
 */
function decoratedTexts(): string[] {
    return tools.walkComponents()
        .filter((c) => tools.isA(c, 'FieldDecorator'))
        .map((c) => ((c as unknown as Component).getComponents()[0] as unknown as { getText(): string }).getText())
        .sort();
}

/**
 * The tooltip's element, found through the panel's `tooltip` geometry label,
 * so the tests pin that label as well.
 *
 * @param mounted - The mounted panel.
 * @returns The element, or `null` while no tooltip is up or fading out.
 */
function tooltipElement(mounted: MountedPanel): Element | null {
    return document.querySelector(mounted.build.geometry!.tooltip as string);
}

// Mounting awaits real frames and timers, so fake timers start only once the
// panel is mounted.
describe('form-flat call target (C21)', () => {
    beforeEach(() => {
        vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext')
            .mockImplementation(((id: string) => (id === '2d'
                ? { font: '', clearRect() {}, save() {}, restore() {}, setTransform() {}, measureText: () => ({ width: 0 }) }
                : null) as unknown as RenderingContext) as typeof window.HTMLCanvasElement.prototype.getContext);
    });

    afterEach(() => {
        // A tooltip left up would fade out on a real timer once the test ends,
        // and the next test would start with its element still in the page.
        if (vi.isFakeTimers()) {
            Tooltip.hide();
            vi.advanceTimersByTime(FADE_SETTLE_MS);
            vi.useRealTimers();
        }

        vi.restoreAllMocks();

        // Body is a page-level singleton that outlives each test; the root
        // Body.init appended must be detached before dispose, or the next
        // mount finds two children under a Fit() that accepts one.
        for (const root of [...Body.getInstance().getComponents()]) {
            Body.getInstance().removeComponent(root);
            root.dispose();
        }
    });

    it('offers no call target to a form with one decorated field', async () => {
        const mounted = await mountPanel('form-flat', new URLSearchParams('n=8'), tools, WAITS);

        expect(mounted.targets).not.toHaveProperty('call');
    });

    it('types once, after the hover delay, and the tooltip stays up', async () => {
        const mounted = await mountPanel('form-flat', new URLSearchParams('n=9'), tools, WAITS);
        const call = mounted.targets.call as CallTarget;

        vi.useFakeTimers();
        call(0);

        expect(decoratedTexts(), 'both fields past their limit').toEqual([OVER, OVER]);
        expect(tooltipElement(mounted), 'no tooltip before the hover delay').toBeNull();

        runUnits(call, 1, HOVER_DELAY_UNITS + 1);

        expect(tooltipElement(mounted), 'still inside the hover delay').toBeNull();
        expect(decoratedTexts(), 'nothing typed while the tooltip is not up').toEqual([OVER, OVER]);

        runUnits(call, HOVER_DELAY_UNITS + 1, C21_UNITS);

        expect(tooltipElement(mounted)?.isConnected, 'the tooltip survives the second field\'s cleared error').toBe(true);
        expect(decoratedTexts(), 'exactly one keystroke').toEqual([OVER.slice(0, -1), OVER]);
    });

    it('reads null once the keystroke hides the tooltip, as before C21\'s fix', async () => {
        const mounted = await mountPanel('form-flat', new URLSearchParams('n=9'), tools, WAITS);
        const call = mounted.targets.call as CallTarget;
        const detach = Tooltip.detach.bind(Tooltip);

        // `detach` before C21's fix: it ended by hiding the tooltip whoever
        // owned it. `clearError` calls `Tooltip.detach` by name, so the spy is
        // the one it reaches.
        vi.spyOn(Tooltip, 'detach').mockImplementation(function detachThenHide(component: Component): void {
            detach(component);
            Tooltip.hide();
        });

        vi.useFakeTimers();
        runUnits(call, 0, C21_UNITS);

        expect(decoratedTexts(), 'exactly one keystroke').toEqual([OVER.slice(0, -1), OVER]);
        expect(tooltipElement(mounted), 'hidden by the second field\'s detach').toBeNull();
    });
});
