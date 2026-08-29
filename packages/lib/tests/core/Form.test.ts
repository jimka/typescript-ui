import { describe, it, expect, vi } from 'vitest';
import { _Form as Form, FormOptions } from '~/core/Form';
import { _Panel as Panel } from '~/core/Panel';
import { Event } from '~/core/Event';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { Insets } from '~/primitive/Insets';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Counts recording-sink writes of `op` whose first recorded arg is `arg0`. */
function countWrites(sink: ReturnType<typeof installTestDOM>, op: string, arg0: unknown): number {
    return sink.writes.filter(w => w.op === op && w.args[0] === arg0).length;
}

/**
 * Every `Form` unconditionally wires a `submit` listener via
 * `Event.addListener` at construction. `Event`'s window-level listener
 * installation is a module-level singleton keyed by event type
 * (`installedListenerTypes`) that outlives any single test's modelled DOM —
 * if left wired, the *next* test's fresh sink (installed by the global
 * `beforeEach`) would never receive the window-level listener a real `submit`
 * dispatch needs, since `Event.addListener` no-ops once a type is marked
 * installed (see `tests/dom/events.test.ts`'s `uniqueType()` comment for the
 * same gotcha — "submit" can't be varied per test the way that helper varies
 * its synthetic type, since it's the fixed type `Form` wires). Removing the
 * listener via the framework's own `Event.removeListener` after each test
 * drops the type back out of the singleton once no component is listening,
 * so every test starts fresh regardless of order.
 */
function disposeForm(form: Form): void {
    Event.removeListener(form, 'submit', (form as unknown as { handleSubmit: Event.Listener }).handleSubmit);
}

describe('Form', () => {
    it('renders a <form> element', () => {
        const sink = installTestDOM(CONFIG);
        const form = new Form();

        form.getElement(true);

        expect(countWrites(sink, 'createElement', 'form')).toBe(1);
        expect(form.getTag()).toBe('form');

        disposeForm(form);
        DOM.reset();
    });

    it('is a Panel', () => {
        installTestDOM(CONFIG);
        const form = new Form();

        expect(form).toBeInstanceOf(Panel);

        disposeForm(form);
        DOM.reset();
    });

    it('fires onSubmit exactly once with preventDefault applied', () => {
        const sink = installTestDOM(CONFIG);
        const onSubmit = vi.fn();
        const form = new Form({ onSubmit });
        const element = form.getElement(true)!;

        const preventDefault = vi.fn();
        const event = makeEvent(element, 'submit');
        (event as unknown as { preventDefault: () => void }).preventDefault = preventDefault;

        sink.dispatchEvent(element, event);

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith(form);
        expect(preventDefault).toHaveBeenCalledTimes(1);

        disposeForm(form);
        DOM.reset();
    });

    it('requestSubmit() records a sink write and triggers the wired onSubmit', () => {
        const sink = installTestDOM(CONFIG);
        const onSubmit = vi.fn();
        const form = new Form({ onSubmit });

        form.getElement(true);
        form.requestSubmit();

        expect(sink.writes.filter(w => w.op === 'requestSubmit').length).toBe(1);
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith(form);

        disposeForm(form);
        DOM.reset();
    });

    it('requestSubmit() on an unrendered form is a no-op', () => {
        const sink = installTestDOM(CONFIG);
        const onSubmit = vi.fn();
        const form = new Form({ onSubmit });

        expect(() => form.requestSubmit()).not.toThrow();
        expect(sink.writes.some(w => w.op === 'requestSubmit')).toBe(false);
        expect(onSubmit).not.toHaveBeenCalled();

        disposeForm(form);
        DOM.reset();
    });

    it('forwards subclassDefaults over Panel\'s own default, while Form\'s own tag default survives', () => {
        installTestDOM(CONFIG);

        class TestForm extends Form {
            constructor(o?: FormOptions) {
                super(o, { insets: new Insets(0, 0, 0, 0) });
            }
        }

        const insetsForm = new TestForm();
        expect(insetsForm.getInsets().getTop()).toBe(0);

        const tagForm = new TestForm();
        expect(tagForm.getTag()).toBe('form');

        disposeForm(insetsForm);
        disposeForm(tagForm);
        DOM.reset();
    });
});
