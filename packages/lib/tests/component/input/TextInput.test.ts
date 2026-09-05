import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TextArea } from '~/component/input/TextArea';
import { TextField } from '~/component/input/TextField';
import { PasswordField } from '~/component/input/PasswordField';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { Menu } from '~/overlay/Menu';
import { installTestDOM, makeEvent, RecordingDOMSink } from '../../dom/TestDOM';
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

type Field = TextField | TextArea | PasswordField;

/**
 * Every field a `TextInput`-family test exercises, factored so behaviours
 * that are shared across the concrete subclasses run once per class rather
 * than being triplicated by hand.
 */
const MAKERS: readonly [string, (opts?: any) => Field][] = [
    ['TextField',     (opts?: any): Field => new TextField(opts)],
    // TextArea's constructor takes the initial text as a leading positional
    // argument, not an options-bag field (TextArea.ts:82) — split it out so
    // this factory's `{ text, ... }` bag shape stays uniform across all three
    // makers for the call sites below.
    ['TextArea',      (opts?: any): Field => {
        const { text, ...rest } = (opts ?? {}) as Record<string, unknown>;

        return new TextArea((text as string | undefined) ?? '', rest);
    }],
    ['PasswordField', (opts?: any): Field => new PasswordField(opts)],
];

// MUST be the first two describe blocks in this file (see
// tests/component/input/SelectableText.test.ts's file-level note, which
// documents the same constraint): `TextInput`'s constructor now registers a
// "contextmenu" listener unconditionally, and its cut()/paste() re-fire a
// real "input" event — Event's window-level base listener for a type is
// armed once per event type for the lifetime of this module and is not
// re-armed by a later installTestDOM() call unless every component holding
// it is disposed first. Every field constructed below is tracked in `field`
// and disposed in `afterEach` (not a manual end-of-test call), so cleanup
// still runs when an assertion throws mid-test — a manual call skipped by a
// thrown exception would leak the listener registration and silently break
// every later real-dispatch test in this file. Every field constructed by
// the describe blocks further down this file is never disposed, but nothing
// later fires a real "input"/"contextmenu" event, so it is unaffected by
// whichever sink last owned the registration.
describe('TextInput copy/cut/paste', () => {
    for (const [name, make] of MAKERS) {
        describe(name, () => {
            let field: Field | undefined;

            afterEach(() => { field?.dispose(); field = undefined; });

            it('copy() with a selection records exactly one writeClipboardText write carrying the selected text', () => {
                field = make({ text: 'hello world' });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 0, 5);

                field.copy();

                const writes = sink.writes.filter(w => w.op === 'writeClipboardText');
                expect(writes.length).toBe(1);
                expect(writes[0].args[0]).toBe('hello');
            });

            it('copy() with a collapsed caret records no write', () => {
                field = make({ text: 'hello world' });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 3, 3);

                field.copy();

                expect(sink.writes.filter(w => w.op === 'writeClipboardText').length).toBe(0);
            });

            it('cut() with a selection records the write, removes it from the text, and collapses the caret at the cut point', () => {
                field = make({ text: 'hello world' });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 6, 11);

                field.cut();

                const writes = sink.writes.filter(w => w.op === 'writeClipboardText');
                expect(writes.length).toBe(1);
                expect(writes[0].args[0]).toBe('world');
                expect(field.getText()).toBe('hello ');
                expect(DOM.source.getSelectionRange(el)).toEqual({ start: 6, end: 6 });
            });

            it('cut() with a collapsed caret records no write and leaves the text unchanged', () => {
                field = make({ text: 'hello world' });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 4, 4);

                field.cut();

                expect(sink.writes.filter(w => w.op === 'writeClipboardText').length).toBe(0);
                expect(field.getText()).toBe('hello world');
            });

            it('cut() on a disabled field records no write and leaves the text unchanged', () => {
                field = make({ text: 'hello world', enabled: false });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 0, 5);

                field.cut();

                expect(sink.writes.filter(w => w.op === 'writeClipboardText').length).toBe(0);
                expect(field.getText()).toBe('hello world');
            });

            it('cut() on a read-only field records no write and leaves the text unchanged', () => {
                field = make({ text: 'hello world', readOnly: true });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 0, 5);

                field.cut();

                expect(sink.writes.filter(w => w.op === 'writeClipboardText').length).toBe(0);
                expect(field.getText()).toBe('hello world');
            });

            it('cut() fires the field\'s own on("change", fn) with the post-cut text', () => {
                field = make({ text: 'hello world' });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 6, 11);

                let captured: string | undefined;
                field.on('change', (v: string) => { captured = v; });

                field.cut();

                expect(captured).toBe('hello ');
            });

            it('paste() with the read stubbed to "X" and a collapsed caret inserts it at the caret and resolves true', async () => {
                field = make({ text: 'hello' });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 2, 2);
                vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

                const result = await field.paste();

                expect(result).toBe(true);
                expect(field.getText()).toBe('heXllo');
                expect(DOM.source.getSelectionRange(el)).toEqual({ start: 3, end: 3 });
            });

            it('paste() with the read stubbed to "X" and a selection replaces it and resolves true', async () => {
                field = make({ text: 'hello world' });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 0, 5);
                vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

                const result = await field.paste();

                expect(result).toBe(true);
                expect(field.getText()).toBe('X world');
            });

            it('paste() with the read stubbed to null resolves false and leaves the text unchanged', async () => {
                field = make({ text: 'hello' });
                field.getElement(true);
                vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue(null);

                const result = await field.paste();

                expect(result).toBe(false);
                expect(field.getText()).toBe('hello');
            });

            it('paste() with the read stubbed to "" resolves true and leaves the text unchanged', async () => {
                field = make({ text: 'hello' });
                field.getElement(true);
                vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('');

                const result = await field.paste();

                expect(result).toBe(true);
                expect(field.getText()).toBe('hello');
            });

            it('paste() on a disabled field resolves false without reading the clipboard', async () => {
                field = make({ text: 'hello', enabled: false });
                field.getElement(true);
                const readSpy = vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

                const result = await field.paste();

                expect(result).toBe(false);
                expect(readSpy).not.toHaveBeenCalled();
            });

            it('paste() on a read-only field resolves false without reading the clipboard', async () => {
                field = make({ text: 'hello', readOnly: true });
                field.getElement(true);
                const readSpy = vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

                const result = await field.paste();

                expect(result).toBe(false);
                expect(readSpy).not.toHaveBeenCalled();
            });

            it('paste() fires the field\'s own on("change", fn) with the post-paste text', async () => {
                field = make({ text: 'hello' });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 5, 5);
                vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue(' world');

                let captured: string | undefined;
                field.on('change', (v: string) => { captured = v; });

                await field.paste();

                expect(captured).toBe('hello world');
            });

            it('paste() truncates the combined text to maxLength', async () => {
                field = make({ text: '12345', maxLength: 5 });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 5, 5);
                vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('67');

                const result = await field.paste();

                expect(result).toBe(true);
                expect(field.getText()).toBe('12345');
                expect(DOM.source.getSelectionRange(el)).toEqual({ start: 5, end: 5 });
            });

            it('paste() does not throw when the field is destroyed while the clipboard read is pending, and still resolves true', async () => {
                field = make({ text: 'hello' });
                field.getElement(true);

                let resolveRead: (value: string | null) => void = () => {};
                const pending = new Promise<string | null>(resolve => { resolveRead = resolve; });
                vi.spyOn(DOM.source, 'readClipboardText').mockReturnValue(pending);

                const result = field.paste();
                field.dispose();
                resolveRead('X');

                await expect(result).resolves.toBe(true);
            });

            // Clicking a row in the context menu blurs the field via the
            // browser's default mousedown-elsewhere behaviour (PickerColumn.ts's
            // handlePointerDown documents the same class of problem for a picker
            // cell); each command restores focus afterward so the field doesn't
            // appear to have lost it once the menu closes.
            it('copy() with a selection restores focus to the field', () => {
                field = make({ text: 'hello world' });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 0, 5);

                field.copy();

                expect(sink.writes.filter(w => w.op === 'focus').length).toBe(1);
            });

            it('cut() with a selection restores focus to the field', () => {
                field = make({ text: 'hello world' });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 6, 11);

                field.cut();

                expect(sink.writes.filter(w => w.op === 'focus').length).toBe(1);
            });

            it('paste() with clipboard content restores focus to the field', async () => {
                field = make({ text: 'hello' });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 2, 2);
                vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

                await field.paste();

                expect(sink.writes.filter(w => w.op === 'focus').length).toBe(1);
            });

            it('paste() with an empty clipboard still restores focus to the field', async () => {
                field = make({ text: 'hello' });
                field.getElement(true);
                vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('');

                await field.paste();

                expect(sink.writes.filter(w => w.op === 'focus').length).toBe(1);
            });

            it('paste() with a denied read still restores focus to the field', async () => {
                field = make({ text: 'hello' });
                field.getElement(true);
                vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue(null);

                await field.paste();

                expect(sink.writes.filter(w => w.op === 'focus').length).toBe(1);
            });
        });
    }
});

describe('TextInput right-click Cut/Copy/Paste menu', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    for (const [name, make] of MAKERS) {
        describe(name, () => {
            let field: Field | undefined;

            afterEach(() => { field?.dispose(); field = undefined; });

            it('with text selected, opens the menu with Cut/Copy/Paste all enabled', () => {
                const showSpy = vi.spyOn(Menu.prototype, 'show');
                field = make({ text: 'hello world' });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 0, 5);

                Event.fireEvent(field, makeEvent(el, 'contextmenu', { clientX: 10, clientY: 20 }));

                expect(showSpy).toHaveBeenCalledTimes(1);
                expect(showSpy.mock.calls[0][0]).toBe(10);
                expect(showSpy.mock.calls[0][1]).toBe(20);
                const items = showSpy.mock.calls[0][2] as { text?: string; enabled?: boolean }[];
                expect(items.map(i => i.text)).toEqual(['Cut', 'Copy', 'Paste']);
                expect(items[0].enabled).toBe(true);
                expect(items[1].enabled).toBe(true);
            });

            it('with a collapsed caret, opens the menu with Cut/Copy disabled and Paste enabled', () => {
                const showSpy = vi.spyOn(Menu.prototype, 'show');
                field = make({ text: 'hello world' });
                const el = field.getElement(true)!;
                DOM.sink.setSelectionRange(el, 3, 3);

                Event.fireEvent(field, makeEvent(el, 'contextmenu', { clientX: 1, clientY: 1 }));

                const items = showSpy.mock.calls[0][2] as { text?: string; enabled?: boolean }[];
                expect(items.map(i => i.text)).toEqual(['Cut', 'Copy', 'Paste']);
                expect(items[0].enabled).toBe(false);
                expect(items[1].enabled).toBe(false);
            });

            it('on a read-only field, opens a Copy-only menu', () => {
                const showSpy = vi.spyOn(Menu.prototype, 'show');
                field = make({ text: 'hello world', readOnly: true });
                const el = field.getElement(true)!;

                Event.fireEvent(field, makeEvent(el, 'contextmenu', { clientX: 1, clientY: 1 }));

                const items = showSpy.mock.calls[0][2] as { text?: string }[];
                expect(items.map(i => i.text)).toEqual(['Copy']);
            });

            it('on a disabled field, opens a Copy-only menu', () => {
                const showSpy = vi.spyOn(Menu.prototype, 'show');
                field = make({ text: 'hello world', enabled: false });
                const el = field.getElement(true)!;

                Event.fireEvent(field, makeEvent(el, 'contextmenu', { clientX: 1, clientY: 1 }));

                const items = showSpy.mock.calls[0][2] as { text?: string }[];
                expect(items.map(i => i.text)).toEqual(['Copy']);
            });
        });
    }
});

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
