import { describe, it, expect, afterEach, vi } from 'vitest';
import { CollapseButton } from '~/component/container/CollapseButton';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { installTestDOM, makeEvent, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map. Copied from `ParentHeader.classStyleDefaults.test.ts`.
 */
function declarationsDuring(
    sink: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    const start = sink.writes.length;
    fn();

    const out: Record<string, string | null> = {};
    for (const w of sink.writes.slice(start)) {
        if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
            continue;
        }

        const styles = w.args[1] as Record<string, string | null>;
        for (const key of Object.keys(styles)) {
            out[key] = styles[key];
        }
    }

    return out;
}

// MUST be the first describe block in this file, and its one test the only
// place a real dispatched click/dblclick DOM event is used. `Event`'s
// window-level base listener is armed once per event TYPE for the lifetime of
// this module and is not re-armed by a later `installTestDOM()` call unless
// the component holding it is disposed first (see the file-level note in
// tests/component/input/Link.test.ts, which documents the same constraint) —
// every other CollapseButton constructed later in this file never dispatches
// a real event, so it's unaffected by whichever sink last owned the
// registration; each button below is disposed immediately after use so the
// type is cleanly released regardless.
describe('CollapseButton activation (real DOM dispatch)', () => {
    afterEach(() => DOM.reset());

    it('fires collapse on the configured trigger only, and not on the other gesture', () => {
        installTestDOM(CONFIG);

        const dblclickButton = new CollapseButton();
        const dblclickHandle = dblclickButton.getElement(true)!;
        const dblclickFn = vi.fn();

        dblclickButton.on('collapse', dblclickFn);

        Event.fireEvent(dblclickButton, makeEvent(dblclickHandle, 'click') as any);
        expect(dblclickFn).not.toHaveBeenCalled();

        Event.fireEvent(dblclickButton, makeEvent(dblclickHandle, 'dblclick') as any);
        expect(dblclickFn).toHaveBeenCalledTimes(1);

        dblclickButton.dispose();

        const clickButton = new CollapseButton({ trigger: 'click' });
        const clickHandle = clickButton.getElement(true)!;
        const clickFn = vi.fn();

        clickButton.on('collapse', clickFn);

        Event.fireEvent(clickButton, makeEvent(clickHandle, 'dblclick') as any);
        expect(clickFn).not.toHaveBeenCalled();

        Event.fireEvent(clickButton, makeEvent(clickHandle, 'click') as any);
        expect(clickFn).toHaveBeenCalledTimes(1);

        clickButton.dispose();
    });
});

describe('CollapseButton direction', () => {
    afterEach(() => DOM.reset());

    it('defaults the direction to east', () => {
        installTestDOM(CONFIG);

        expect(new CollapseButton().getDirection()).toBe('east');
    });

    it('round-trips the direction option', () => {
        installTestDOM(CONFIG);

        expect(new CollapseButton({ direction: 'north' }).getDirection()).toBe('north');
    });

    it('round-trips setDirection and stays chainable', () => {
        installTestDOM(CONFIG);

        const button = new CollapseButton();

        expect(button.setDirection('south')).toBe(button);
        expect(button.getDirection()).toBe('south');
    });
});

describe('CollapseButton trigger', () => {
    afterEach(() => DOM.reset());

    it('defaults the trigger to dblclick', () => {
        installTestDOM(CONFIG);

        expect(new CollapseButton().getTrigger()).toBe('dblclick');
    });

    it('round-trips the trigger option', () => {
        installTestDOM(CONFIG);

        expect(new CollapseButton({ trigger: 'click' }).getTrigger()).toBe('click');
    });
});

describe('CollapseButton stripMode', () => {
    afterEach(() => DOM.reset());

    it('toggles stripMode without throwing and stays chainable', () => {
        installTestDOM(CONFIG);

        const button = new CollapseButton();

        // This button is never rendered here, so there's no sink to observe
        // the write on; the declaration-level contract is pinned by the next
        // test instead, against a rendered button. This one is chainability
        // only.
        expect(button.setStripMode(true)).toBe(button);
        expect(button.setStripMode(false)).toBe(button);
    });

    it('writes the strip width when filled and removes its own width entry when not', () => {
        const sink   = installTestDOM(CONFIG);
        const button = new CollapseButton();
        button.getElement(true);

        expect(declarationsDuring(sink, idSelector(button), () => { button.setStripMode(true); }).width)
            .toBe('18px');   // COLLAPSE_STRIP_SIZE
        expect(declarationsDuring(sink, idSelector(button), () => { button.setStripMode(false); }).width)
            .toBeNull();
    });
});

describe('CollapseButton collapse listener', () => {
    afterEach(() => DOM.reset());

    it('registers a collapse listener chainably', () => {
        installTestDOM(CONFIG);

        const button = new CollapseButton();

        // The real dblclick/click dispatch path is covered by the
        // 'CollapseButton activation (real DOM dispatch)' block above; this
        // test only asserts the listener API is chainable and accepts both
        // the `on` registration and the constructor `listeners` bag without
        // throwing.
        expect(button.on('collapse', () => {})).toBe(button);

        expect(() => new CollapseButton({ listeners: { collapse: () => {} } })).not.toThrow();
    });
});
