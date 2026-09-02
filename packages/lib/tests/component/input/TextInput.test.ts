import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TextArea } from '~/component/input/TextArea';
import { TextField } from '~/component/input/TextField';
import { PasswordField } from '~/component/input/PasswordField';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;

beforeEach(() => {
    sink = installTestDOM(CONFIG);
});

afterEach(() => DOM.reset());

/** Counts recording-sink writes of `op` whose first recorded arg is `type`. */
function countWrites(op: string, type: string): number {
    return sink.writes.filter(w => w.op === op && w.args[0] === type).length;
}

describe('TextInput unified input sync (bug 1 / consolidation item 6)', () => {
    // Consolidation: the base TextInput now owns the sole native "input"
    // listener (sync-then-notify), so each subclass wires exactly one — down
    // from the previous two (base fan-out + subclass DOM-sync hook). The
    // recording sink's window-level base listener installs once per DOM event
    // type, so countWrites can't distinguish 1 vs 2 registrations; spy on the
    // Event.addListener source call instead.
    for (const [name, make] of [
        ['TextField',     (): unknown => new TextField()],
        ['TextArea',      (): unknown => new TextArea()],
        ['PasswordField', (): unknown => new PasswordField()],
    ] as const) {
        it(`${name} wires exactly one native "input" listener`, () => {
            const spy = vi.spyOn(Event, 'addListener');

            make();

            const inputRegs = spy.mock.calls.filter(c => c[1] === 'input').length;

            spy.mockRestore();

            expect(inputRegs).toBe(1);
        });
    }

    // Bug 1: a stale-cache read fired the change fan-out one keystroke behind.
    // The unified onInput must sync _options.text from the live DOM *before*
    // notifying, so on("change") sees the just-typed value.
    for (const [name, make] of [
        ['TextField',     (): any => new TextField()],
        ['TextArea',      (): any => new TextArea()],
        ['PasswordField', (): any => new PasswordField()],
    ] as const) {
        it(`${name}.onInput syncs the cached text from the live DOM before notifying change`, () => {
            const field = make();
            const el    = field.getElement(true)!;

            // Simulate a keystroke: the DOM value diverges from the cached text.
            DOM.sink.setValue(el, 'hello');

            let captured: string | undefined;
            field.on('change', (v: string) => { captured = v; });

            field.onInput();

            expect(field.getText()).toBe('hello');
            expect(captured).toBe('hello');
        });
    }
});

describe('TextField dirty state', () => {
    it('a freshly constructed field with an initial value is not dirty', () => {
        const field = new TextField({ text: 'hello' });

        expect(field.isDirty()).toBe(false);
    });

    it('typing a different value makes it dirty', () => {
        const field = new TextField({ text: 'hello' }) as any;
        const el = field.getElement(true)!;

        DOM.sink.setValue(el, 'hello world');
        field.onInput();

        expect(field.isDirty()).toBe(true);
    });

    it('typing back to the original text clears the dirty flag', () => {
        const field = new TextField({ text: 'hello' }) as any;
        const el = field.getElement(true)!;

        DOM.sink.setValue(el, 'hello world');
        field.onInput();

        DOM.sink.setValue(el, 'hello');
        field.onInput();

        expect(field.isDirty()).toBe(false);
    });
});

describe('TextInput keydown shorthand', () => {
    // The recording sink does not deliver DOM events to listeners, so the
    // contract verified here is the *wiring*: on("keydown") routes to the native
    // keydown DOM event via Event.addListener(this, ...) (the same shorthand the
    // existing "action" event uses for "input"), and off removes it. Actual key
    // delivery (Ctrl/Cmd+Enter handling) is exercised live by consumers.
    it('on/off("keydown") route to the native keydown DOM event and are chainable', () => {
        const input = new TextArea();
        const listener = (): void => {};

        const addsBefore = countWrites('addListener', 'keydown');
        const chainOn    = input.on('keydown', listener);
        const installed  = countWrites('addListener', 'keydown') - addsBefore;

        const removesBefore = countWrites('removeListener', 'keydown');
        const chainOff      = input.off('keydown', listener);
        const removed       = countWrites('removeListener', 'keydown') - removesBefore;

        expect(chainOn).toBe(input);
        expect(chainOff).toBe(input);
        // First on() installs the single window-level keydown base listener;
        // off() removes it once the last keydown listener is gone.
        expect(installed).toBe(1);
        expect(removed).toBe(1);
    });
});
