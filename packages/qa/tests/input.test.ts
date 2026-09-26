// @vitest-environment jsdom
//
// The guard adds listeners to `window` and reads `event.isTrusted`, and node
// has neither. `isTrusted` is unforgeable by specification — an own,
// non-configurable accessor on every event, in jsdom as in a browser — so a
// trusted event is staged by setting the flag on jsdom's implementation object
// behind that accessor. Staged trust is all an offline test can have; that a
// real hand on the machine is dropped is checked in engine (README,
// `## Measurement rules`).
import { afterEach, describe, expect, it } from 'vitest';
import { droppedInputNote, installInputGuard, removeInputGuard } from '../src/harness/input.js';

/** Device-input types the guard drops: the pointer, mouse, wheel and key families. */
const GUARDED_TYPE_COUNT = 22;

/** Trusted `mousemove`s the tally test drops, enough that one type outweighs another. */
const MOVES = 3;

/** The capture listeners added after the guard, removed after every test. */
const watchers: Array<{ type: string; listener: EventListener }> = [];

/** The symbol jsdom keeps an event's implementation object under; its `isTrusted` is what the wrapper's accessor reads. */
const IMPL = Object.getOwnPropertySymbols(new Event('probe')).find((symbol) => symbol.description === 'impl')!;

/**
 * Stages `event` as the engine's own: a getter that always answers `true`,
 * with a setter that swallows writes, because `dispatchEvent`'s first step is
 * to set the flag false — a plain assignment before the dispatch would not
 * survive it.
 *
 * @param event - The event to stage.
 */
function stageTrust(event: Event): void {
    const impl = (event as unknown as Record<symbol, object>)[IMPL];

    Object.defineProperty(impl, 'isTrusted', { get: () => true, set: () => {}, configurable: true });
}

/**
 * Dispatches `type` on `document`, staged as the engine's own when `trusted`.
 *
 * @param type - The event type.
 * @param trusted - Whether the event presents itself as the engine's.
 * @returns The dispatched event, for reading `defaultPrevented`.
 */
function dispatch(type: string, trusted: boolean): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });

    if (trusted) {
        stageTrust(event);
    }

    document.dispatchEvent(event);

    return event;
}

/**
 * A `window` capture listener registered after the guard — where the library's
 * own listeners sit — recording every event that reaches it.
 *
 * @param type - The event type watched.
 * @returns The types seen, in order.
 */
function watchAfterGuard(type: string): string[] {
    const seen: string[] = [];
    const listener = (event: Event): void => {
        seen.push(event.type);
    };

    window.addEventListener(type, listener, { capture: true });
    watchers.push({ type, listener });

    return seen;
}

afterEach(() => {
    removeInputGuard();

    for (const { type, listener } of watchers.splice(0)) {
        window.removeEventListener(type, listener, { capture: true });
    }
});

describe('the device-input guard', () => {
    it('names what it installed', () => {
        expect(installInputGuard()).toBe(`input guard: ${GUARDED_TYPE_COUNT} device-input types dropped at window capture`);
    });

    it('drops a trusted device event before the page sees it, and tallies it', () => {
        installInputGuard();

        const seen = watchAfterGuard('mousemove');
        const event = dispatch('mousemove', true);

        expect(seen).toEqual([]);
        expect(event.defaultPrevented).toBe(true);
        expect(droppedInputNote()).toBe('input guard: dropped mousemove×1');
    });

    it('passes a script-made device event, which is what every driver dispatches', () => {
        installInputGuard();

        const seen = watchAfterGuard('mousemove');
        const event = dispatch('mousemove', false);

        expect(seen).toEqual(['mousemove']);
        expect(event.defaultPrevented).toBe(false);
        expect(droppedInputNote()).toBe('input guard: nothing reached the page');
    });

    it('passes a trusted event outside the device families, which a driver depends on', () => {
        installInputGuard();

        const seen = watchAfterGuard('scroll');

        dispatch('scroll', true);

        expect(seen).toEqual(['scroll']);
        expect(droppedInputNote()).toBe('input guard: nothing reached the page');
    });

    it('reads as nothing dropped both before the guard exists and while it has dropped nothing', () => {
        expect(droppedInputNote()).toBe('input guard: nothing reached the page');
        installInputGuard();
        expect(droppedInputNote()).toBe('input guard: nothing reached the page');
    });

    it('names every dropped type in the tally, largest count first', () => {
        installInputGuard();

        for (let move = 0; move < MOVES; move++) {
            dispatch('mousemove', true);
        }

        dispatch('keydown', true);

        expect(droppedInputNote()).toBe(`input guard: dropped mousemove×${MOVES}, keydown×1`);
    });

    it('lets a trusted event through again once removed', () => {
        installInputGuard();
        removeInputGuard();

        const seen = watchAfterGuard('mousemove');

        dispatch('mousemove', true);

        expect(seen).toEqual(['mousemove']);
        expect(droppedInputNote()).toBe('input guard: nothing reached the page');
    });
});
