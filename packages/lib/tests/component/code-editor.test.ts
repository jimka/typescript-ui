import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CodeEditor } from '~/component/editor/CodeEditor';
import type { CodeEditorChange } from '~/component/editor/CodeEditor';
import { registerLanguage, getLanguage, listLanguages } from '~/component/editor/LanguageRegistry';
import type { Formatter } from '~/component/editor/LanguageRegistry';
import { formatWithSql } from '~/component/editor/formatters/sql';
// Barrel import triggers the five-built-in registration side effect.
import '~/component/editor/index';
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

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

type Recorder = { writes: { op: string; args: unknown[] }[] };

// CodeEditor is live-only: CodeMirror's `EditorView` cannot be modelled offline
// (mirrors Canvas/getContext), so `DOM.sink.mountView` always returns `null`
// under the recording sink and `_view` never leaves `null` in this file. These
// tests pin the offline-observable contract; syntax highlighting, formatting
// output, and live mount behaviour are the plan's manual-verify section.

describe('LanguageRegistry', () => {
    it('round-trips a registered definition', () => {
        const def = {
            id: 'test-registry-lang',
            label: 'Test Lang',
            loadExtension: async () => [] as any,
        };

        registerLanguage(def);

        expect(getLanguage('test-registry-lang')).toBe(def);
    });

    it('returns undefined for an unregistered id', () => {
        expect(getLanguage('nope-not-registered')).toBeUndefined();
    });

    it('lists the five built-in languages after the barrel side-effect import', () => {
        const ids = listLanguages().map((def) => def.id);

        expect(ids).toEqual(expect.arrayContaining(['javascript', 'json', 'html', 'sql', 'markdown']));
    });
});

describe('CodeEditor offline no-op', () => {
    it('getValue reads the positional constructor value', () => {
        const editor = new CodeEditor('const x = 1;');

        expect(editor.getValue()).toBe('const x = 1;');
    });

    it('getValue defaults to "" when unset', () => {
        const editor = new CodeEditor();

        expect(editor.getValue()).toBe('');
    });

    it('setValue caches to _options.value and reads back via getValue', () => {
        const editor = new CodeEditor() as any;

        editor.setValue('hello');

        expect(editor._options.value).toBe('hello');
        expect(editor.getValue()).toBe('hello');
    });

    it('setLanguage / getLanguage round-trip without a live view', () => {
        const editor = new CodeEditor();

        expect(editor.getLanguage()).toBeNull();

        editor.setLanguage('javascript');
        expect(editor.getLanguage()).toBe('javascript');

        editor.setLanguage(null);
        expect(editor.getLanguage()).toBeNull();
    });

    it('setReadOnly / getReadOnly round-trip without a live view', () => {
        const editor = new CodeEditor();

        expect(editor.getReadOnly()).toBe(false);

        editor.setReadOnly(true);
        expect(editor.getReadOnly()).toBe(true);
    });

    it('format() resolves without throwing when no language is set', async () => {
        const editor = new CodeEditor('unformatted');

        await expect(editor.format()).resolves.toBeUndefined();
        expect(editor.getValue()).toBe('unformatted');
    });
});

describe('CodeEditor applyOptions', () => {
    it('forwards value / language / readOnly from the options bag', () => {
        const editor = new CodeEditor(undefined, { value: 'x = 1', language: 'javascript', readOnly: true });

        expect(editor.getValue()).toBe('x = 1');
        expect(editor.getLanguage()).toBe('javascript');
        expect(editor.getReadOnly()).toBe(true);
    });

    it('a positional value is not overridden by an unset options.value', () => {
        const editor = new CodeEditor('positional');

        expect(editor.getValue()).toBe('positional');
    });
});

describe('CodeEditor listeners bag', () => {
    it('wires a constructor listeners.change bag through applyListeners', () => {
        let received: CodeEditorChange | null = null;
        const editor = new CodeEditor(undefined, { listeners: { change: (payload) => { received = payload; } } });

        (editor as any).emit('change', { value: 'new text' });

        expect(received).toEqual({ value: 'new text' });
    });

    it('on() / off() register and remove a change listener', () => {
        const editor = new CodeEditor();
        let fired = 0;
        const listener = (): void => { fired += 1; };

        editor.on('change', listener);
        (editor as any).emit('change', { value: 'a' });
        expect(fired).toBe(1);

        editor.off('change', listener);
        (editor as any).emit('change', { value: 'b' });
        expect(fired).toBe(1);
    });
});

describe('CodeEditor format() dispatch', () => {
    const FORMATTER_LANG = 'test-formatter-lang';
    const THROWING_LANG   = 'test-throwing-formatter-lang';
    const NO_FORMATTER_LANG = 'test-no-formatter-lang';

    it('resolves and applies the result when the formatter succeeds', async () => {
        const formatter: Formatter = async (source) => ({ formatted: source.toUpperCase(), cursorOffset: 0 });

        registerLanguage({
            id: FORMATTER_LANG,
            loadExtension: async () => [] as any,
            loadFormatter: async () => formatter,
        });

        const editor = new CodeEditor('lower', { language: FORMATTER_LANG });

        await editor.format();

        expect(editor.getValue()).toBe('LOWER');
    });

    it('rejects and leaves the document untouched when the formatter throws', async () => {
        registerLanguage({
            id: THROWING_LANG,
            loadExtension: async () => [] as any,
            loadFormatter: async () => (() => { throw new Error('invalid syntax'); }) as unknown as Formatter,
        });

        const editor = new CodeEditor('unchanged', { language: THROWING_LANG });

        await expect(editor.format()).rejects.toThrow('invalid syntax');
        expect(editor.getValue()).toBe('unchanged');
    });

    it('runs the re-indent fallback when the language has no formatter', async () => {
        registerLanguage({
            id: NO_FORMATTER_LANG,
            loadExtension: async () => [] as any,
            // No loadFormatter.
        });

        const editor = new CodeEditor('x', { language: NO_FORMATTER_LANG }) as any;
        const spy = vi.spyOn(editor, 'reindentFallback');

        await editor.format();

        expect(spy).toHaveBeenCalledOnce();
        expect(editor.getValue()).toBe('x'); // unchanged offline: fallback no-ops without a view
    });

    it('runs the re-indent fallback when no language is registered at all', async () => {
        const editor = new CodeEditor('x') as any;
        const spy = vi.spyOn(editor, 'reindentFallback');

        await editor.format();

        expect(spy).toHaveBeenCalledOnce();
    });
});

describe('sql-formatter cursor clamp', () => {
    it('clamps a cursor offset beyond the formatted length', async () => {
        const result = await formatWithSql('select 1', 1000);

        expect(result.cursorOffset).toBe(result.formatted.length);
    });

    it('preserves a cursor offset within the formatted length', async () => {
        const result = await formatWithSql('select 1', 0);

        expect(result.cursorOffset).toBe(0);
    });
});

describe('CodeEditor smooth scrolling', () => {
    // CodeMirror scrolls its own `.cm-scroller`, which the framework only
    // reaches through the `getScrollElement` seam. The eased wheel scroller is
    // gated on the component's own effective overflow (see
    // `Component.applyOverflowStyles` -> `refreshWheelScrolling`), so a
    // scrollable default is what opts the editor into it — exactly as it does
    // for `TextArea`. The editor's own box never actually scrolls (CodeMirror's
    // `.cm-editor` is `height: 100%`), so the value is inert as a style.
    it('defaults to a scrollable overflow on both axes', () => {
        const editor = new CodeEditor();

        expect(editor.getOverflowX()).toBe('auto');
        expect(editor.getOverflowY()).toBe('auto');
    });

    it('attaches the eased wheel scroller once rendered', () => {
        const editor = new CodeEditor();

        editor.getElement(true);

        expect((editor as any)._wheelScroller).not.toBeNull();
    });

    it('getScrollElement falls back to the component element with no live view', () => {
        const editor = new CodeEditor();
        const element = editor.getElement(true);

        // Offline the view never mounts, so there is no `.cm-scroller` to
        // resolve — every scroll read/write must stay on the editor's own box
        // rather than returning undefined and silently no-opping.
        expect((editor as any).getScrollElement()).toBe(element);
    });
});

describe('CodeEditor DOM seam: mountView', () => {
    it('RecordingDOMSink.mountView records the call and returns null without invoking the factory', () => {
        const recorder = DOM.sink as unknown as Recorder;
        const handle = DOM.sink.createElement('div');
        const factory = vi.fn(() => ({ destroyed: false }));

        const result = DOM.sink.mountView(handle, factory);

        expect(result).toBeNull();
        expect(factory).not.toHaveBeenCalled();
        expect(recorder.writes.some((w) => w.op === 'mountView')).toBe(true);
    });
});
