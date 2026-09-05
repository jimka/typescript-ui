import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CodeEditor } from '~/component/editor/CodeEditor';
import type { CodeEditorChange } from '~/component/editor/CodeEditor';
import { registerLanguage, getLanguage, listLanguages } from '~/component/editor/LanguageRegistry';
import type { Formatter } from '~/component/editor/LanguageRegistry';
import { formatWithSql } from '~/component/editor/formatters/sql';
import { formatWithPrettier } from '~/component/editor/formatters/prettier';
import { mapFormatOptions } from '~/component/editor/formatters/options';
import type { FormatOptionNames } from '~/component/editor/formatters/options';
import type { FormatOptions } from '~/component/editor/LanguageRegistry';
// Barrel import triggers the five-built-in registration side effect.
import '~/component/editor/index';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM, setQuerySelectorResult } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { EditorState } from '@codemirror/state';
import { codeFolding, foldEffect } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { collectSyntaxErrors } from '~/component/editor/syntaxDiagnostics';

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

    it('round-trips a registered loadLintSource intact', () => {
        const source = async () => [];
        const def = {
            id: 'test-registry-lang-with-lint',
            loadExtension: async () => [] as any,
            loadLintSource: async () => source,
        };

        registerLanguage(def);

        expect(getLanguage('test-registry-lang-with-lint')?.loadLintSource).toBe(def.loadLintSource);
    });

    it('leaves loadLintSource undefined for a definition registered without one', () => {
        registerLanguage({
            id: 'test-registry-lang-no-lint',
            loadExtension: async () => [] as any,
        });

        expect(getLanguage('test-registry-lang-no-lint')?.loadLintSource).toBeUndefined();
    });

    it('lists the seven built-in languages after the barrel side-effect import', () => {
        const ids = listLanguages().map((def) => def.id);

        expect(ids).toEqual(expect.arrayContaining(
            ['javascript', 'json', 'html', 'sql', 'markdown', 'css', 'python']));
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

    it('on() / off() register and remove a heightchange listener', () => {
        const editor = new CodeEditor();
        let received: { height: number } | null = null;
        const listener = (payload: { height: number }): void => { received = payload; };

        editor.on('heightchange', listener);
        (editor as any).emit('heightchange', { height: 240 });
        expect(received).toEqual({ height: 240 });

        received = null;
        editor.off('heightchange', listener);
        (editor as any).emit('heightchange', { height: 300 });
        expect(received).toBeNull();
    });
});

describe('CodeEditor dirty state', () => {
    it('a freshly built editor is clean', () => {
        const editor = new CodeEditor('const x = 1;');

        expect(editor.isDirty()).toBe(false);
    });

    it('onDocChange marks the editor dirty and updates the value', () => {
        const editor = new CodeEditor() as any;

        editor.onDocChange('typed');

        expect(editor.isDirty()).toBe(true);
        expect(editor.getValue()).toBe('typed');
    });

    it('onDocChange still emits "change" exactly once', () => {
        const editor = new CodeEditor() as any;
        let received: CodeEditorChange | null = null;
        let fired = 0;
        editor.on('change', (payload: CodeEditorChange) => { received = payload; fired += 1; });

        editor.onDocChange('typed');

        expect(fired).toBe(1);
        expect(received).toEqual({ value: 'typed' });
    });

    it('a "change" listener sees isDirty() already true', () => {
        const editor = new CodeEditor() as any;
        let dirtyDuringChange: boolean | null = null;
        editor.on('change', () => { dirtyDuringChange = editor.isDirty(); });

        editor.onDocChange('typed');

        expect(dirtyDuringChange).toBe(true);
    });

    it('onDirtyChange fires once per real transition', () => {
        const editor = new CodeEditor() as any;
        let fired = 0;
        let received: boolean | null = null;
        editor.onDirtyChange((dirty: boolean) => { fired += 1; received = dirty; });

        editor.onDocChange('a');
        editor.onDocChange('b');

        expect(fired).toBe(1);
        expect(received).toBe(true);
    });

    it('markClean clears the flag, fires once, and is chainable', () => {
        const editor = new CodeEditor() as any;
        (editor as any).onDocChange('typed');
        let fired = 0;
        let received: boolean | null = null;
        editor.onDirtyChange((dirty: boolean) => { fired += 1; received = dirty; });

        const returned = editor.markClean();

        expect(editor.isDirty()).toBe(false);
        expect(fired).toBe(1);
        expect(received).toBe(false);
        expect(returned).toBe(editor);

        editor.markClean();
        expect(fired).toBe(1);
    });

    it('relays dirty state to a real parent', () => {
        const editor = new CodeEditor() as any;
        const parent = new Component();
        parent.addComponent(editor);
        let fired = 0;
        let received: boolean | null = null;
        parent.onDirtyChange((dirty: boolean) => { fired += 1; received = dirty; });

        editor.onDocChange('x');

        expect(parent.isDirty()).toBe(true);
        expect(fired).toBe(1);
        expect(received).toBe(true);

        editor.markClean();

        expect(parent.isDirty()).toBe(false);
        expect(fired).toBe(2);
        expect(received).toBe(false);
    });

    it('offline setValue leaves isDirty() unchanged', () => {
        const editor = new CodeEditor();

        editor.setValue('hello');

        expect(editor.isDirty()).toBe(false);
    });

    it('undo back to the constructed text clears the flag', () => {
        const editor = new CodeEditor('a') as any;

        editor.onDocChange('ab');
        expect(editor.isDirty()).toBe(true);

        editor.onDocChange('a');
        expect(editor.isDirty()).toBe(false);
    });

    it('both transitions of an undo round-trip fire onDirtyChange', () => {
        const editor = new CodeEditor('a') as any;
        const received: boolean[] = [];
        editor.onDirtyChange((dirty: boolean) => { received.push(dirty); });

        editor.onDocChange('ab');
        editor.onDocChange('a');

        expect(received).toEqual([true, false]);
    });

    it('"change" still fires on the change that returns to clean', () => {
        const editor = new CodeEditor('a') as any;
        const values: string[] = [];
        const dirtyAtChange: boolean[] = [];
        editor.on('change', (payload: CodeEditorChange) => {
            values.push(payload.value);
            dirtyAtChange.push(editor.isDirty());
        });

        editor.onDocChange('ab');
        editor.onDocChange('a');

        expect(values).toEqual(['ab', 'a']);
        expect(dirtyAtChange).toEqual([true, false]);
    });

    it('markClean() moves the clean text', () => {
        const editor = new CodeEditor('a') as any;

        editor.onDocChange('ab');
        editor.markClean();

        editor.onDocChange('a');
        expect(editor.isDirty()).toBe(true);

        editor.onDocChange('ab');
        expect(editor.isDirty()).toBe(false);
    });

    it('the relay follows both ways through an undo round-trip', () => {
        const editor = new CodeEditor('a') as any;
        const parent = new Component();
        parent.addComponent(editor);
        let fired = 0;
        parent.onDirtyChange(() => { fired += 1; });

        editor.onDocChange('ab');
        expect(parent.isDirty()).toBe(true);

        editor.onDocChange('a');
        expect(parent.isDirty()).toBe(false);

        expect(fired).toBe(2);
    });

    it('a setValue() load followed by markClean() makes the loaded text the clean text', () => {
        const editor = new CodeEditor('a') as any;

        editor.setValue('b');
        editor.markClean();

        editor.onDocChange('bc');
        expect(editor.isDirty()).toBe(true);

        editor.onDocChange('b');
        expect(editor.isDirty()).toBe(false);
    });

    it('an editor built with no text has "" as its clean text', () => {
        const editor = new CodeEditor() as any;

        editor.onDocChange('x');
        expect(editor.isDirty()).toBe(true);

        editor.onDocChange('');
        expect(editor.isDirty()).toBe(false);
    });
});

describe('CodeEditor autoHeightMaxRows', () => {
    it('getAutoHeightMaxRows defaults to null', () => {
        const editor = new CodeEditor();

        expect(editor.getAutoHeightMaxRows()).toBeNull();
    });

    it('round-trips through the constructor options bag', () => {
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 });

        expect(editor.getAutoHeightMaxRows()).toBe(20);
    });

    it('syncAutoHeight is a no-op with no live view (the real offline contract)', () => {
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        let fired = false;
        editor.on('heightchange', () => { fired = true; });

        const heightBefore = editor.getHeight();
        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(heightBefore);
        expect(fired).toBe(false);
    });

    it('syncAutoHeight is a no-op with a view but autoHeightMaxRows unset', () => {
        const editor = new CodeEditor() as any;
        editor._view = { contentHeight: 100, defaultLineHeight: 20, documentPadding: { top: 0, bottom: 0 } };
        let fired = false;
        editor.on('heightchange', () => { fired = true; });

        const heightBefore = editor.getHeight();
        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(heightBefore);
        expect(fired).toBe(false);
    });

    it('syncAutoHeight is a no-op with a view but no resolved scroll element', () => {
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = { state: { doc: { lines: 5 } }, documentPadding: { top: 0, bottom: 0 } };
        let fired = false;
        editor.on('heightchange', () => { fired = true; });

        const heightBefore = editor.getHeight();
        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(heightBefore);
        expect(fired).toBe(false);
    });

    it('sets the content height when it is below the row cap', () => {
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 5 } },
            documentPadding: { top: 4, bottom: 4 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight: 100,
            clientWidth: 500, clientHeight: 100,
        });

        let received: { height: number } | null = null;
        editor.on('heightchange', (payload: { height: number }) => { received = payload; });

        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(100);
        expect(received).toEqual({ height: 100 });
    });

    it('clamps to the row cap when content height exceeds it', () => {
        // 250 lines at an even 20px/line + 8px padding = 5008px of real
        // content; capPx = 20 (perLineHeight) * 20 (maxRows) + 8 (padding) = 408.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 250 } },
            documentPadding: { top: 4, bottom: 4 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight: 5008,
            clientWidth: 500, clientHeight: 100,
        });

        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(408);
    });

    it('reserves the horizontal scrollbar width before applying the cap', () => {
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 5 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 600, scrollHeight: 100,
            clientWidth: 500, clientHeight: 100,
        });
        // A real, already-rendered horizontal scrollbar: offsetHeight (115)
        // exceeds clientHeight (100, from getScrollMetrics above) by its
        // thickness (15).
        vi.spyOn(DOM.source, 'getOffsetSize').mockReturnValue({ offsetTop: 0, offsetHeight: 115 });

        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(115);
    });

    it('still reserves the horizontal scrollbar width when the row cap, not real content, is the binding constraint', () => {
        // A document that genuinely exceeds autoHeightMaxRows (30 lines
        // against a 10-row cap) forces the row cap to be the binding
        // constraint regardless of the scrollbar reserve. Live-reproduced:
        // reserving only on the pre-clamp content height let Math.min
        // silently discard it whenever the cap won, so the horizontal
        // scrollbar rendered inside the capped box and overlapped the last
        // visible row instead of getting room of its own. The reserve must
        // still apply on top of the cap, not just on top of real content.
        // capPx = 10 (perLineHeight = 300 / 30 lines) * 10 (maxRows) + 0
        // (padding) = 100; plus the 15px scrollbar reserve = 115.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 10 }) as any;
        editor._view = {
            state: { doc: { lines: 30 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 600, scrollHeight: 300,
            clientWidth: 500, clientHeight: 100,
        });
        vi.spyOn(DOM.source, 'getOffsetSize').mockReturnValue({ offsetTop: 0, offsetHeight: 115 });

        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(115);
    });

    it('does not reserve any height when scrollWidth exceeds clientWidth but no real horizontal scrollbar is currently rendering', () => {
        // `.cm-scroller`'s one-time `scrollbar-gutter: stable` (see mount())
        // reserves a vertical scrollbar's worth of width unconditionally,
        // narrowing clientWidth regardless of whether a vertical scrollbar
        // ever actually renders — so `scrollWidth > clientWidth` alone does
        // NOT reliably predict a real, space-consuming horizontal scrollbar.
        // Live measurement found two docs blocks both with scrollWidth over
        // clientWidth (7px and 15px) where only one actually rendered a
        // scrollbar; a scrollWidth/clientWidth-based threshold (with or
        // without a scrollbar-width fudge factor) cannot tell them apart.
        // This reproduces the block with no real scrollbar: offsetHeight
        // equals clientHeight (nothing rendered is consuming extra space),
        // so no reserve should be added despite the scrollWidth overflow.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 5 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 507, scrollHeight: 100,
            clientWidth: 500, clientHeight: 100,
        });
        vi.spyOn(DOM.source, 'getOffsetSize').mockReturnValue({ offsetTop: 0, offsetHeight: 100 });

        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(100);
    });

    it('measures the horizontal-scrollbar reserve against a content-sized box, not whatever height the box had before this call', () => {
        // Live-reproduced: the free first commit for a new shape read
        // offsetHeight/clientHeight against `.cm-scroller`'s height as it was
        // BEFORE this call — this component's own pre-sync default on the
        // very first call ever. A block that correctly shows no scrollbar
        // once content-sized measured a false 15px reserve against that
        // stale, far-too-short box, and since no growth against an unchanged
        // shape is ever trusted, the wrong reading then locked in
        // permanently — every later call reused it, and nothing ever
        // re-measured. `getScrollMetrics` here returns a short clientHeight
        // (20) on the first read (matching the pre-sync default) and the
        // content-accurate one (100, matching contentDesired) on the second,
        // taken after this method commits the content-only height first;
        // `getOffsetSize` reflects no real scrollbar once content-sized. Had
        // the reserve been computed against the stale first reading instead,
        // it would have come out to 80 (100 - 20), not 0.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 5 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics')
            .mockReturnValueOnce({
                scrollTop: 0, scrollLeft: 0,
                scrollWidth: 507, scrollHeight: 100,
                clientWidth: 500, clientHeight: 20,
            })
            .mockReturnValueOnce({
                scrollTop: 0, scrollLeft: 0,
                scrollWidth: 507, scrollHeight: 100,
                clientWidth: 500, clientHeight: 100,
            });
        vi.spyOn(DOM.source, 'getOffsetSize').mockReturnValue({ offsetTop: 0, offsetHeight: 100 });

        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(100);
    });

    it('reconciles the intermediate probe commit when the scrollbar reserve makes the final height equal the height the call started at', () => {
        // Live repro from Markdown's fenced-code upgrade (Markdown.ts:1060,
        // 1081): the wrapper and the editor are both pinned to the
        // placeholder <pre>'s scrollHeight (115) before the first sync. That
        // call measures 100px of real content, commits it as the intermediate
        // probe (so the scrollbar reserve is read against a content-sized
        // box), measures a real 15px horizontal scrollbar, and lands on
        // desired = 115 — exactly the height it started at. The equal-height
        // early return is right about the height but leaves the box at the
        // 100px probe, showing a 15px gap under the block; and because the
        // next call sees an unchanged shape, the growth guard then refuses to
        // correct it, ever.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 5, length: 80 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        // Markdown's mount-time guess, from the placeholder <pre>.
        editor.setHeight(115);

        vi.spyOn(DOM.source, 'getScrollMetrics')
            .mockReturnValueOnce({
                scrollTop: 0, scrollLeft: 0,
                scrollWidth: 600, scrollHeight: 100,
                clientWidth: 500, clientHeight: 115,
            })
            .mockReturnValue({
                scrollTop: 0, scrollLeft: 0,
                scrollWidth: 600, scrollHeight: 100,
                clientWidth: 500, clientHeight: 100,
            });
        // A real, rendered horizontal scrollbar: 15px thick against the
        // content-sized (100px) box.
        vi.spyOn(DOM.source, 'getOffsetSize').mockReturnValue({ offsetTop: 0, offsetHeight: 115 });

        let fireCount = 0;
        editor.on('heightchange', () => { fireCount += 1; });

        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(115);
        // The height never moved from what the call started at, so there is
        // nothing for a consumer to re-pin.
        expect(fireCount).toBe(0);

        // The echo call CodeMirror's own measure pass fires right after: the
        // shape is unchanged, so the growth guard is armed. The height must
        // already be right rather than needing a growth that guard refuses.
        editor.syncAutoHeight();
        expect(editor.getHeight()).toBe(115);
        expect(fireCount).toBe(0);
    });

    it('re-measures the horizontal-scrollbar reserve on a later call against the same shape, picking up a scrollbar that resolved on its own', () => {
        // Live-reproduced: a language grammar loads asynchronously
        // (setLanguage's loadExtension().then(...), well after mount's
        // synchronous initial measurement) — a real, visible horizontal
        // scrollbar present at that initial measurement can resolve once
        // highlighting settles and re-flows the text, without the document's
        // line count, length, or container width ever changing. A reserve
        // trusted only once, on the shape change, would never notice and
        // would leave the dead space it originally added forever.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 5 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 600, scrollHeight: 100,
            clientWidth: 500, clientHeight: 100,
        });
        const getOffsetSize = vi.spyOn(DOM.source, 'getOffsetSize')
            .mockReturnValue({ offsetTop: 0, offsetHeight: 115 });

        editor.syncAutoHeight();
        expect(editor.getHeight()).toBe(115);
        expect(getOffsetSize).toHaveBeenCalledTimes(1);

        // The scrollbar resolved: offsetHeight now matches clientHeight.
        getOffsetSize.mockReturnValue({ offsetTop: 0, offsetHeight: 100 });

        editor.syncAutoHeight();
        expect(editor.getHeight()).toBe(100);
        expect(getOffsetSize).toHaveBeenCalledTimes(2);
    });

    it('corrects a fractional-pixel undershoot invisible to integer scrollHeight/clientHeight, once, on the shape-change commit', () => {
        // Live-reproduced via a raw DOM snapshot: CodeMirror's own gutter
        // carried an inline `min-height: 223.504px` (its internal,
        // full-precision content measurement) while the committed height was
        // 224px, yet the block still showed a hair of real, non-zero scroll
        // range. `scrollHeight`/`clientHeight` are integer DOM properties —
        // rounding can hide this kind of shortfall from them entirely (both
        // can read back the same rounded value even when a real gap exists),
        // so the correction reads `.cm-content`'s fractional
        // getBoundingClientRect-based rect directly instead. Reproduced here
        // as a content rect of 101.5 against a scroller rect of 101 (content
        // box, after the 1px padding-bottom, of 100) — a genuine 1.5px
        // shortfall that must be folded in, not left as dead scroll range.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 5 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement  = DOM.sink.createElement('div');
        editor._contentElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight: 100,
            clientWidth: 500, clientHeight: 100,
        });
        vi.spyOn(DOM.source, 'getOffsetSize').mockReturnValue({ offsetTop: 0, offsetHeight: 100 });
        vi.spyOn(DOM.source, 'getElementRect').mockImplementation((handle: unknown) => {
            const height = handle === editor._contentElement ? 101.5 : 101;

            return { x: 0, y: 0, width: 0, height, top: 0, left: 0, right: 0, bottom: height };
        });

        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(101.5);
    });

    it('does not let a later call against the same shape revert the fractional-undershoot correction as a false shrink', () => {
        // Live-reproduced: after the fractional correction above commits
        // (e.g. 224.5), CodeMirror's own settling fires another
        // geometryChanged almost immediately, with the shape genuinely
        // unchanged. That later call recomputes contentDesired from the
        // same plain integer scrollHeight (224, not 224.5) — since it's
        // less than the fractionally-corrected height this method itself
        // just committed, and shrinks are otherwise always trusted, it read
        // straight through as a "genuine" shrink, silently reverting the
        // correction on every subsequent geometryChanged event — the
        // correction never held past its own first call.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 5 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement  = DOM.sink.createElement('div');
        editor._contentElement = DOM.sink.createElement('div');

        // Fixed across every call, matching a real .cm-scroller: its
        // integer scrollHeight/clientHeight never change on their own —
        // only this method's own fractional correction (not reflected in
        // these mocked integer properties) does.
        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight: 224,
            clientWidth: 500, clientHeight: 224,
        });
        vi.spyOn(DOM.source, 'getOffsetSize').mockReturnValue({ offsetTop: 0, offsetHeight: 224 });
        vi.spyOn(DOM.source, 'getElementRect').mockImplementation((handle: unknown) => {
            const height = handle === editor._contentElement ? 223.5 : 224;

            return { x: 0, y: 0, width: 0, height, top: 0, left: 0, right: 0, bottom: height };
        });

        editor.syncAutoHeight();
        expect(editor.getHeight()).toBe(224.5);

        editor.syncAutoHeight();
        expect(editor.getHeight()).toBe(224.5);
    });

    it('does not apply the fractional-undershoot correction when the row cap, not real content, produced this height', () => {
        // A capped block is EXPECTED to keep overflowing past its committed
        // height — that overflow is what drives its own intentional
        // internal vertical scroll — so the correction above must not fire
        // just because the content rect still shows more than the scroller's
        // content box in that case.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 10 }) as any;
        editor._view = {
            state: { doc: { lines: 30 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement  = DOM.sink.createElement('div');
        editor._contentElement = DOM.sink.createElement('div');

        // capPx = 10 (perLineHeight = 300 / 30 lines) * 10 (maxRows) = 100;
        // content (300) exceeds it, so the cap is the binding constraint.
        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight: 300,
            clientWidth: 500, clientHeight: 100,
        });
        vi.spyOn(DOM.source, 'getOffsetSize').mockReturnValue({ offsetTop: 0, offsetHeight: 100 });
        // A large content rect that WOULD add a big residual if the row-cap
        // exclusion weren't applied.
        vi.spyOn(DOM.source, 'getElementRect').mockImplementation((handle: unknown) => {
            const height = handle === editor._contentElement ? 500 : 100;

            return { x: 0, y: 0, width: 0, height, top: 0, left: 0, right: 0, bottom: height };
        });

        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(100);
    });

    it('is idempotent: a second call with unchanged inputs makes no further setHeight/emit calls', () => {
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 5 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight: 100,
            clientWidth: 500, clientHeight: 100,
        });

        let fireCount = 0;
        editor.on('heightchange', () => { fireCount += 1; });

        editor.syncAutoHeight();
        expect(fireCount).toBe(1);
        expect(editor.getHeight()).toBe(100);

        editor.syncAutoHeight();
        expect(fireCount).toBe(1);
        expect(editor.getHeight()).toBe(100);
    });

    it('reads the real DOM scroll metrics for content height, not the CodeMirror view\'s own possibly-stale estimate', () => {
        // contentHeight/defaultLineHeight stand in for CodeMirror's stale,
        // pre-measurement defaults (see the syncAutoHeight doc comment) — set
        // to deliberately wrong values to prove the method no longer reads
        // them; only the DOM.source.getScrollMetrics mock below should win.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            contentHeight: 9999,
            defaultLineHeight: 9999,
            state: { doc: { lines: 5 } },
            documentPadding: { top: 4, bottom: 4 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight: 100,
            clientWidth: 500, clientHeight: 100,
        });

        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(100);
    });

    it('does not ratchet the height upward when a later call observes its own previously-committed height reflected back as scrollHeight', () => {
        // A real `.cm-scroller` can never report a `scrollHeight` smaller than
        // its own `clientHeight` — once the editor's committed height exceeds
        // its true content extent (e.g. from the mount-time sub-pixel slop
        // padding, or any other cause), `.cm-content`'s `min-height: 100%`
        // makes the "content" grow to fill that height, so the *next*
        // `getScrollMetrics` call reports the box's own last-committed height
        // back as if it were fresh content. This mock reproduces exactly that:
        // `scrollHeight` is `max(trueContent, editor.getHeight())`. If
        // `syncAutoHeight` ever added anything to the height it commits, this
        // would climb by that amount on every call, forever; committing the
        // measured extent verbatim (with no in-method slop) converges instead.
        const trueContent = 100;
        let lastCommitted = 0;
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 5 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');
        editor.on('heightchange', (payload: { height: number }) => { lastCommitted = payload.height; });

        vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation(() => ({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight: Math.max(trueContent, lastCommitted),
            clientWidth: 500, clientHeight: Math.max(trueContent, lastCommitted),
        }));

        for (let i = 0; i < 5; i++) {
            editor.syncAutoHeight();
        }

        expect(editor.getHeight()).toBe(trueContent);
    });

    it('caps consecutive height growths for an unchanged document and width, breaking CodeMirror\'s own geometry-echo loop', () => {
        // `syncAutoHeight`'s own `setHeight()` commit changes `.cm-scroller`'s
        // real `clientHeight`. CodeMirror's internal `ViewState.measure()`
        // (@codemirror/view, runs on its own schedule, independent of any
        // user interaction) compares that live value against its own cached
        // copy on every pass and reports a fresh `geometryChanged` update
        // when they differ — which they always do, right after we commit.
        // That re-invokes this method with no genuine content or width
        // change. On a real (non-integer) device-pixel ratio the re-measure
        // does not reliably read back the exact value just committed (unlike
        // the mount-time case the previous test models, which converges) —
        // it can read fractionally MORE, live-observed climbing by tens of
        // pixels every ~100ms, forever, with the editor merely visible and
        // no further interaction. This mock reproduces the worst case: raw
        // `scrollHeight` grows on literally every call, unconditionally,
        // with lines/width held constant — the exact signature observed
        // live. `syncAutoHeight` must still stop growing well short of
        // following it, since nothing about the document has changed.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 4, length: 80 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        let scrollHeight = 100;
        vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation(() => {
            scrollHeight += 50;
            return {
                scrollTop: 0, scrollLeft: 0,
                scrollWidth: 500, scrollHeight,
                clientWidth: 500, clientHeight: scrollHeight,
            };
        });

        for (let i = 0; i < 20; i++) {
            editor.syncAutoHeight();
        }

        // 20 unbounded steps at +50px each would reach 1100px; the cap must
        // stop it far short of that.
        expect(editor.getHeight()).toBeLessThan(500);
    });

    it('resumes growing after a genuine document change, even once growth against the old shape has been locked out', () => {
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 4, length: 80 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        let scrollHeight = 100;
        vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation(() => {
            scrollHeight += 50;
            return {
                scrollTop: 0, scrollLeft: 0,
                scrollWidth: 500, scrollHeight,
                clientWidth: 500, clientHeight: scrollHeight,
            };
        });

        for (let i = 0; i < 10; i++) {
            editor.syncAutoHeight();
        }
        const heightAfterLockOut = editor.getHeight();

        // A real edit: line count changes, so this is a genuinely new shape.
        editor._view.state.doc.lines = 6;
        editor._view.state.doc.length = 120;
        editor.syncAutoHeight();

        expect(editor.getHeight()).toBeGreaterThan(heightAfterLockOut);
    });

    it('rejects any growth against an unchanged shape, even a single plausible-looking follow-up correction', () => {
        // An earlier version trusted exactly one follow-up growth per shape,
        // on the theory that an initial pre-layout guess might need one
        // accurate correction once CodeMirror's real layout became
        // available (e.g. settling 100 -> 150 here). Live testing across
        // several unrelated docs blocks (Dialog, Drawer, LineChart, Button)
        // refuted that: that "follow-up" fired on essentially every
        // multi-line editor regardless of whether real settling was needed,
        // each time adding a line or two of dead space with nothing behind
        // it — the same self-referential echo the unbounded case shows, just
        // bounded to a single step. No growth against an unchanged shape is
        // trusted now, however plausible it looks; only the always-free
        // first commit for a shape, or a later genuine shape change, grows
        // the editor.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 4, length: 80 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        let scrollHeight = 100;
        vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation(() => ({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight,
            clientWidth: 500, clientHeight: scrollHeight,
        }));

        editor.syncAutoHeight(); // free first commit
        expect(editor.getHeight()).toBe(100);

        scrollHeight = 150; // a plausible-looking settling correction
        editor.syncAutoHeight();
        expect(editor.getHeight()).toBe(100);

        // A later, unrelated trigger (focus/scroll), still the same document
        // and width, reads taller still — also rejected.
        scrollHeight = 300;
        editor.syncAutoHeight();
        expect(editor.getHeight()).toBe(100);
    });

    it('rejects a growth attempt flagged as a pure selection change, even with budget available', () => {
        // Live-confirmed via direct mutation-log comparison: a click that
        // moves the cursor to a DIFFERENT line reassigns cm-activeLine /
        // cm-activeLineGutter and rewrites .cm-content's own style —
        // CodeMirror's heavier internal refresh — while a same-line
        // reposition (or a single-line document, structurally incapable of
        // having a different line to click) never does. A cursor move alone
        // can never legitimately need more vertical space (a monospace grid
        // layout has no reflow to trigger), so any growth surfacing during
        // one is the same .cm-content self-reference the rest of this
        // method's guards target — reject it outright rather than spending
        // budget on it.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 4, length: 80 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        let scrollHeight = 160;
        vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation(() => ({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight,
            clientWidth: 500, clientHeight: scrollHeight,
        }));

        editor.syncAutoHeight(); // free first commit
        expect(editor.getHeight()).toBe(160);

        scrollHeight = 184; // budget would normally allow this once
        editor.syncAutoHeight(true); // ...but this call is a pure selection change
        expect(editor.getHeight()).toBe(160);
    });

    it('rejects a content shrink flagged as a pure selection change against an unchanged shape', () => {
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 4, length: 80 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        let scrollHeight = 160;
        vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation(() => ({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight,
            clientWidth: 500, clientHeight: scrollHeight,
        }));

        editor.syncAutoHeight();
        expect(editor.getHeight()).toBe(160);

        // Mirrors its sibling growth-rejection test above: a cursor move
        // triggers no reflow, so any reported shrink it carries against an
        // unchanged shape is the same spurious geometry echo, not real
        // content -- reject it.
        scrollHeight = 120;
        editor.syncAutoHeight(true);
        expect(editor.getHeight()).toBe(160);
    });

    it('does not collapse the height when several re-entrant calls each shrink an unchanged shape by more than a pixel', () => {
        // Mirrors 'caps consecutive height growths...' above, but for a
        // shrink. Live-reproduced via a consumer app (SQLAdmin): a 4-line,
        // 87.375px editor shrinks back to its original 3-line, 68px
        // document, and its committed height collapses to 0px even though
        // the document is correct -- CodeMirror's own geometryChanged echo
        // (see the comment above the growth check below) can report a
        // scrollHeight more than a pixel below what this method already
        // committed, on a call no genuine edit caused; unlike growth,
        // nothing stopped a chain of these from walking the height to zero.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 4, length: 80 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        let scrollHeight = 160;
        vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation(() => ({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight,
            clientWidth: 500, clientHeight: scrollHeight,
        }));

        editor.syncAutoHeight(); // establishes the grown, 4-line state
        expect(editor.getHeight()).toBe(160);

        // A genuine edit shrinks the document back to 3 lines...
        editor._view.state.doc.lines = 3;
        editor._view.state.doc.length = 40;

        // ...followed by repeated re-entrant echoes against the now-
        // unchanged shape, each still reading a lower scrollHeight than
        // the last.
        for (let i = 0; i < 10; i++) {
            scrollHeight = Math.max(0, scrollHeight - 20);
            editor.syncAutoHeight();
        }

        // The first, shape-earned reading (140) is trusted and held; none
        // of the nine unshaped echoes after it are.
        expect(editor.getHeight()).toBe(140);
    });
});

describe('CodeEditor autoHeightMinRows', () => {
    it('getAutoHeightMinRows defaults to null', () => {
        const editor = new CodeEditor();

        expect(editor.getAutoHeightMinRows()).toBeNull();
    });

    it('round-trips through the constructor options bag', () => {
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20, autoHeightMinRows: 3 });

        expect(editor.getAutoHeightMinRows()).toBe(3);
    });

    it('floors the content height to the min-rows count when real content is shorter', () => {
        // 1 line at 20px/line + 8px padding = 28px real content; the 3-row
        // floor is 20 (perLineHeight) * 3 (minRows) + 8 (padding) = 68.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20, autoHeightMinRows: 3 }) as any;
        editor._view = {
            state: { doc: { lines: 1 } },
            documentPadding: { top: 4, bottom: 4 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 300, scrollHeight: 28,
            clientWidth: 300, clientHeight: 28,
        });

        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(68);
    });

    it('does not raise the height above real content once it already exceeds the floor', () => {
        // 5 lines at 20px/line + 8px padding = 108px, comfortably past the
        // 3-row (68px) floor -- the floor must not override real content.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20, autoHeightMinRows: 3 }) as any;
        editor._view = {
            state: { doc: { lines: 5 } },
            documentPadding: { top: 4, bottom: 4 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 300, scrollHeight: 108,
            clientWidth: 300, clientHeight: 108,
        });

        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(108);
    });

    it('is inert (no floor) when unset, matching pre-existing content-only behaviour', () => {
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 1 } },
            documentPadding: { top: 4, bottom: 4 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 300, scrollHeight: 28,
            clientWidth: 300, clientHeight: 28,
        });

        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(28);
    });
});

describe('CodeEditor syncAutoHeight per-line measurement', () => {
    it("derives per-line height, and overall content height, from a rendered .cm-line — not scrollHeight / doc.lines — so a scrollHeight already inflated by an earlier commit doesn't keep the box pinned there", () => {
        // A previous commit already stretched `.cm-content` to 500px
        // (`min-height: 100%` pinning its rendered height to whatever the box
        // was last committed to) even though the document is down to 1 real
        // line. Reading `scrollHeight` directly for either the per-line ratio
        // or the overall content height — as the pre-fix formula did for
        // both — would either read a wildly inflated ~492px "per-line
        // height" (dividing 500px by 1 line) or simply never see a number
        // smaller than 500px to settle toward. A real `.cm-line`'s own
        // rendered height (20px, seeded below) and the line count it's
        // multiplied by are both untouched by that stretch, so the box
        // correctly settles to the genuine 1-line content height instead.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 1 } },
            documentPadding: { top: 4, bottom: 4 },
        };
        editor._scrollElement  = DOM.sink.createElement('div');
        editor._contentElement = DOM.sink.createElement('div');

        const line = DOM.sink.createElement('div');
        setQuerySelectorResult('.cm-line', line);

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 300, scrollHeight: 500,
            clientWidth: 300, clientHeight: 500,
        });
        // Neutralises the (separate, unrelated) fractional sub-pixel-undershoot
        // correction and the horizontal-scrollbar reserve, so this assertion
        // isolates the per-line / content-height fix alone.
        vi.spyOn(DOM.source, 'getOffsetSize').mockReturnValue({ offsetTop: 0, offsetHeight: 0 });
        vi.spyOn(DOM.source, 'getElementRect').mockImplementation((handle: unknown) => {
            const height = handle === line ? 20 : (handle === editor._contentElement ? 0 : 1000);

            return { x: 0, y: 0, width: 0, height, top: 0, left: 0, right: 0, bottom: height };
        });

        editor.syncAutoHeight();

        // 1 line * 20px/line + 8px padding = 28px, not the stale 500px a
        // scrollHeight-derived reading would have kept the box pinned at.
        expect(editor.getHeight()).toBe(28);
    });

    it("shrinks back down when lines are removed, even though .cm-scroller's scrollHeight (mocked to stay pinned, matching min-height: 100%) still reports the box's previous, taller committed height", () => {
        // Live-reproduced: typing several extra lines into a SqlPreviewDialog
        // editor grew the box correctly, but deleting them back down never
        // shrank it — the box stayed stuck at its tallest-ever size. Root
        // cause: `.cm-content`'s `min-height: 100%` means `.cm-scroller`'s
        // `scrollHeight` can never report less than the box's own
        // last-committed height, so a later call reporting fewer lines still
        // read the OLD, taller scrollHeight as "real content" and had nothing
        // smaller to shrink toward — even though the shape genuinely changed
        // (fewer lines), which is exactly when a shrink IS trusted. Deriving
        // content height from `perLineHeight * doc.lines` instead of
        // `scrollHeight` fixes this: it recomputes from the current line
        // count every time, with no memory of the box's own prior height.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._scrollElement  = DOM.sink.createElement('div');
        editor._contentElement = DOM.sink.createElement('div');

        const line = DOM.sink.createElement('div');
        setQuerySelectorResult('.cm-line', line);

        // Fixed across both calls below, matching a real `.cm-scroller`
        // pinned by `min-height: 100%` at the box's first (taller) commit.
        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 300, scrollHeight: 100,
            clientWidth: 300, clientHeight: 100,
        });
        vi.spyOn(DOM.source, 'getOffsetSize').mockReturnValue({ offsetTop: 0, offsetHeight: 0 });
        vi.spyOn(DOM.source, 'getElementRect').mockImplementation((handle: unknown) => {
            const height = handle === line ? 20 : (handle === editor._contentElement ? 0 : 1000);

            return { x: 0, y: 0, width: 0, height, top: 0, left: 0, right: 0, bottom: height };
        });

        // First call: 5 real lines -- genuinely tall content, grows the box.
        editor._view = { state: { doc: { lines: 5 } }, documentPadding: { top: 0, bottom: 0 } };
        editor.syncAutoHeight();
        expect(editor.getHeight()).toBe(100);

        // Second call: 4 lines were deleted, leaving 1 -- `.cm-scroller`'s
        // (mocked, statically-returned) scrollHeight still reads 100, exactly
        // as a real min-height: 100%-pinned scroller would before settling.
        editor._view = { state: { doc: { lines: 1 } }, documentPadding: { top: 0, bottom: 0 } };
        editor.syncAutoHeight();

        // 1 line * 20px/line + 0px padding = 20px -- the box must shrink to
        // the genuine 1-line content, not stay pinned at the stale 100px.
        expect(editor.getHeight()).toBe(20);
    });

    it('falls back to scrollHeight / doc.lines when no .cm-line is resolvable (no _contentElement)', () => {
        // Matches the pre-fix formula exactly when there's nothing better to
        // measure — a defensive floor, not an expected path once mounted.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 3 }) as any;
        editor._view = {
            state: { doc: { lines: 1 } },
            documentPadding: { top: 4, bottom: 4 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 300, scrollHeight: 28,
            clientWidth: 300, clientHeight: 28,
        });

        editor.syncAutoHeight();

        // perLineHeight = (28 - 8) / 1 = 20; cap = 20 * 3 + 8 = 68, matching
        // the real content height, so the cap never binds here.
        expect(editor.getHeight()).toBe(28);
    });
});

describe('CodeEditor lineWrap', () => {
    it('getLineWrap defaults to false', () => {
        const editor = new CodeEditor();

        expect(editor.getLineWrap()).toBe(false);
    });

    it('round-trips through the constructor options bag', () => {
        const editor = new CodeEditor(undefined, { lineWrap: true });

        expect(editor.getLineWrap()).toBe(true);
    });

    it('setLineWrap round-trips without a live view, with no throw', () => {
        const editor = new CodeEditor();

        expect(() => editor.setLineWrap(true)).not.toThrow();
        expect(editor.getLineWrap()).toBe(true);
    });
});

describe('CodeEditor placeholder', () => {
    it('getPlaceholder defaults to null', () => {
        const editor = new CodeEditor();

        expect(editor.getPlaceholder()).toBeNull();
    });

    it('round-trips through the constructor options bag', () => {
        const editor = new CodeEditor(undefined, { placeholder: 'Type…' });

        expect(editor.getPlaceholder()).toBe('Type…');
    });

    it('setPlaceholder(null) clears a previously set placeholder', () => {
        const editor = new CodeEditor();

        editor.setPlaceholder('x');
        expect(editor.getPlaceholder()).toBe('x');

        editor.setPlaceholder(null);
        expect(editor.getPlaceholder()).toBeNull();
    });
});

describe('CodeEditor highlightWhitespace', () => {
    it('getHighlightWhitespace defaults to false', () => {
        const editor = new CodeEditor();

        expect(editor.getHighlightWhitespace()).toBe(false);
    });

    it('round-trips through the constructor options bag', () => {
        const editor = new CodeEditor(undefined, { highlightWhitespace: true });

        expect(editor.getHighlightWhitespace()).toBe(true);
    });

    it('setHighlightWhitespace round-trips without a live view, with no throw', () => {
        const editor = new CodeEditor();

        expect(() => editor.setHighlightWhitespace(true)).not.toThrow();
        expect(editor.getHighlightWhitespace()).toBe(true);
    });
});

describe('CodeEditor lint', () => {
    it('getLint defaults to false', () => {
        const editor = new CodeEditor();

        expect(editor.getLint()).toBe(false);
    });

    it('round-trips through the constructor options bag', () => {
        const editor = new CodeEditor(undefined, { lint: true });

        expect(editor.getLint()).toBe(true);
    });

    it('setLint round-trips without a live view, with no throw', () => {
        const editor = new CodeEditor();

        expect(() => editor.setLint(true)).not.toThrow();
        expect(editor.getLint()).toBe(true);
    });

    it('setLint(true) for a language with no loadLintSource clears the compartment synchronously (no linter installed)', () => {
        registerLanguage({
            id: 'test-lint-no-source-lang',
            loadExtension: async () => [] as any,
        });
        const editor = new CodeEditor(undefined, { language: 'test-lint-no-source-lang' }) as any;
        const dispatch = vi.fn();
        editor._view = { dispatch };

        editor.setLint(true);

        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it('setLint(true) for a language with a loadLintSource asynchronously installs the linter', async () => {
        const source = async () => [];

        registerLanguage({
            id: 'test-lint-with-source-lang',
            loadExtension: async () => [] as any,
            loadLintSource: async () => source,
        });
        const editor = new CodeEditor(undefined, { language: 'test-lint-with-source-lang' }) as any;
        const dispatch = vi.fn();
        editor._view = { dispatch };

        editor.setLint(true);
        expect(dispatch).not.toHaveBeenCalled();

        await Promise.resolve();
        await Promise.resolve();

        expect(dispatch).toHaveBeenCalledTimes(1);
    });
});

describe('CodeEditor countFoldedLines', () => {
    function buildState(lineCount: number): EditorState {
        const doc = Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join('\n');

        return EditorState.create({ doc, extensions: [codeFolding()] });
    }

    it('returns 0 with no folds', () => {
        const editor = new CodeEditor() as any;
        const state = buildState(10);

        expect(editor.countFoldedLines(state)).toBe(0);
    });

    it('counts a single fold spanning lines 3-8 as 5', () => {
        const editor = new CodeEditor() as any;
        const initial = buildState(10);
        const from = initial.doc.line(3).from;
        const to   = initial.doc.line(8).to;
        const state = initial.update({ effects: foldEffect.of({ from, to }) }).state;

        expect(editor.countFoldedLines(state)).toBe(5);
    });

    it('sums two disjoint folds spanning 5 and 2 lines as 7', () => {
        const editor = new CodeEditor() as any;
        const initial = buildState(15);
        const foldA = { from: initial.doc.line(2).from, to: initial.doc.line(7).to };
        const foldB = { from: initial.doc.line(9).from, to: initial.doc.line(11).to };
        const state = initial.update({ effects: [foldEffect.of(foldA), foldEffect.of(foldB)] }).state;

        expect(editor.countFoldedLines(state)).toBe(7);
    });
});

describe('collectSyntaxErrors', () => {
    function buildJsonState(doc: string): EditorState {
        return EditorState.create({ doc, extensions: [json()] });
    }

    it('returns [] for valid JSON', () => {
        const state = buildJsonState('{"a": 1}');

        expect(collectSyntaxErrors(state)).toEqual([]);
    });

    it('reports at least one "error"-severity diagnostic for invalid JSON', () => {
        const state = buildJsonState('{"a": }');
        const diagnostics = collectSyntaxErrors(state);

        expect(diagnostics.length).toBeGreaterThanOrEqual(1);
        expect(diagnostics.every((d) => d.severity === 'error')).toBe(true);
    });

    it('reports a single diagnostic for an empty document, not []', () => {
        // Deviates from the plan's original expectation (`""` -> `[]`):
        // `@codemirror/lang-json`'s grammar treats an empty document as a
        // missing top-level value -- a genuine parse error, matching
        // collectSyntaxErrors's own contract of reporting wherever the
        // grammar fails. See the plan's Implementation Notes.
        const state = buildJsonState('');
        const diagnostics = collectSyntaxErrors(state);

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatchObject({ from: 0, to: 0, severity: 'error' });
    });

    it('merges adjacent error nodes into one diagnostic', () => {
        // Ten consecutive, individually-invalid `]` tokens with no JSON value
        // ever opened -- each is its own zero-width-adjacent error node
        // (from[n] === to[n-1]), so they must merge into a single diagnostic
        // spanning the whole run rather than staying ten separate ones.
        const state = buildJsonState(']]]]]]]]]]');
        const diagnostics = collectSyntaxErrors(state);

        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].from).toBe(0);
        expect(diagnostics[0].to).toBe(10);
    });

    it('caps output at 100 diagnostics for a document producing more error nodes', () => {
        // 250 single-character error tokens, each separated by a space so
        // none are adjacent (no merging) -- this exercises the cap itself,
        // not the merge logic above.
        const doc = Array.from({ length: 250 }, () => ']').join(' ');
        const state = buildJsonState(doc);
        const diagnostics = collectSyntaxErrors(state);

        expect(diagnostics).toHaveLength(100);
    });
});

describe('CodeEditor measureContentExtent (via syncAutoHeight)', () => {
    it('commits the measured content extent from the last rendered block, regardless of doc.lines', () => {
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 40 } },
            documentPadding: { top: 0, bottom: 4 },
        };
        editor._scrollElement  = DOM.sink.createElement('div');
        editor._contentElement = DOM.sink.createElement('div');

        const lastBlock = DOM.sink.createElement('div');
        setQuerySelectorResult(':scope > :last-child', lastBlock);

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight: 5000,
            clientWidth: 500, clientHeight: 5000,
        });
        // Neutralises the horizontal-scrollbar reserve and the
        // fractional-undershoot correction, so this assertion isolates
        // measureContentExtent's own contribution.
        vi.spyOn(DOM.source, 'getOffsetSize').mockReturnValue({ offsetTop: 0, offsetHeight: 0 });
        vi.spyOn(DOM.source, 'getElementRect').mockImplementation((handle: unknown) => {
            if (handle === lastBlock) {
                return { x: 0, y: 0, width: 0, height: 100, top: 0, left: 0, right: 0, bottom: 100 };
            }
            if (handle === editor._contentElement) {
                return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
            }
            return { x: 0, y: 0, width: 0, height: 1000, top: 0, left: 0, right: 0, bottom: 1000 };
        });

        editor.syncAutoHeight();

        // 100 (last block's bottom) - 0 (content top) + 4 (documentPadding.bottom)
        // = 104, independent of the 40-line document a scrollHeight-derived
        // reading would report.
        expect(editor.getHeight()).toBe(104);
    });

    it('falls back to the per-row formula when no :scope > :last-child result is seeded, even with a resolved _contentElement', () => {
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 5 } },
            documentPadding: { top: 4, bottom: 4 },
        };
        editor._scrollElement  = DOM.sink.createElement('div');
        editor._contentElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight: 100,
            clientWidth: 500, clientHeight: 100,
        });
        // Neutralises the (separate, unrelated) fractional-undershoot
        // correction, so this assertion isolates the fallback alone: the
        // content rect matches the scroller's content box exactly (100 =
        // 101 - SUBPIXEL_HEIGHT_SLOP_PX).
        vi.spyOn(DOM.source, 'getElementRect').mockImplementation((handle: unknown) => {
            const height = handle === editor._contentElement ? 100 : 101;

            return { x: 0, y: 0, width: 0, height, top: 0, left: 0, right: 0, bottom: height };
        });

        editor.syncAutoHeight();

        // measureContentExtent() resolves _contentElement but DOM.source.querySelector
        // returns null offline unless a result was seeded for the exact selector, so
        // it returns null here and this reproduces today's exact per-row numbers.
        expect(editor.getHeight()).toBe(100);
    });
});

describe('CodeEditor syncAutoHeight shape tuple (fold count / wrap flag)', () => {
    it('trusts a content shrink when only _foldedLines changed between calls (fold shrinks the box)', () => {
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 10, length: 200 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        let scrollHeight = 200;
        vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation(() => ({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight,
            clientWidth: 500, clientHeight: scrollHeight,
        }));

        editor.syncAutoHeight(); // free first commit
        expect(editor.getHeight()).toBe(200);

        // Fold 6 lines: the rendered content genuinely shrinks, but the line
        // count, doc length and width (the old three-element tuple) are all
        // unchanged -- only the fold count (the new fourth component) moved.
        editor._foldedLines = 6;
        scrollHeight = 80;
        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(80);
    });

    it('trusts a content growth when only lineWrap changed between calls', () => {
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 4, length: 80 } },
            documentPadding: { top: 0, bottom: 0 },
            defaultLineHeight: 40,
        };
        editor._scrollElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight: 100,
            clientWidth: 500, clientHeight: 100,
        });

        editor.syncAutoHeight(); // free first commit, wrap off
        expect(editor.getHeight()).toBe(100);

        // Toggle wrap on: line count, doc length and width (the old
        // three-element tuple) are all unchanged, but the wrap-aware
        // perRowHeight now reads CodeMirror's own defaultLineHeight (40)
        // instead of the scrollHeight-derived estimate, genuinely growing
        // the content height to 160.
        editor._options.lineWrap = true;
        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(160);
    });

    it('still rejects a growth when all five shape components are held constant (echo guard unchanged)', () => {
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor._view = {
            state: { doc: { lines: 4, length: 80 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        let scrollHeight = 100;
        vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation(() => ({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 500, scrollHeight,
            clientWidth: 500, clientHeight: scrollHeight,
        }));

        editor.syncAutoHeight(); // free first commit
        expect(editor.getHeight()).toBe(100);

        // Nothing in the five-element shape changed (lines, docLength,
        // clientWidth, foldedLines, wrapFlag all identical) -- only
        // scrollHeight moved, CodeMirror's own geometry-echo signature.
        scrollHeight = 150;
        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(100);
    });
});

describe('CodeEditor syncAutoHeight preferred-size propagation', () => {
    it("updates getPreferredSize() to mirror each committed auto-height, so an ancestor computing its own preferred size (e.g. Dialog.resizeToContent via a VBox sum) sees the current height instead of always reading null", () => {
        // Component.getPreferredSize()'s "leaf with no layout manager" fallback
        // to getSize() is unreachable in practice: getLayoutManager() never
        // returns null (it defaults to an empty Absolute), and that default's
        // own getPreferredSize() answers null for a foreign-DOM leaf like
        // CodeEditor with no framework-tracked children. Confirmed live: a
        // SqlPreviewDialog's content Panel kept computing a stale preferred
        // height no matter how tall the editor's own box actually grew, so
        // Dialog.resizeToContent() never resized the dialog for multi-line SQL.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20, autoHeightMinRows: 3 }) as any;
        editor._view = {
            state: { doc: { lines: 1 } },
            documentPadding: { top: 4, bottom: 4 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
            scrollTop: 0, scrollLeft: 0,
            scrollWidth: 300, scrollHeight: 28,
            clientWidth: 300, clientHeight: 28,
        });

        expect((editor as CodeEditor).getPreferredSize()).toBeNull();

        editor.syncAutoHeight();

        expect(editor.getHeight()).toBe(68);
        expect((editor as CodeEditor).getPreferredSize()).toEqual({ width: editor.getWidth(), height: 68 });
    });
});

describe('CodeEditor mount() initial height-sync scheduling', () => {
    it('defers the first syncAutoHeight() call to Component.afterNextLayout instead of running it synchronously', () => {
        // Live-reproduced via a consumer app (SQLAdmin): a CodeEditor
        // constructed already holding real content (SqlPreviewDialog seeds
        // it via setValue() before its host Dialog is shown) can have
        // mount()'s own first syncAutoHeight() call read `.cm-scroller`
        // metrics before CodeMirror has finished its initial paint inside
        // the freshly-opened Dialog, committing a near-zero height that then
        // locks in permanently -- only a later genuine document-shape change
        // (see the describe block above) ever re-earns trust for a
        // correction, and nothing about a Dialog settling its own open
        // animation naturally causes one. Deferring past mount() itself,
        // mirroring Dialog.open()'s own identical-purpose post-open
        // resizeToContent re-fit, gives CodeMirror's construction a full
        // frame to settle before the first number gets committed.
        const editor = new CodeEditor(undefined, { autoHeightMaxRows: 20 }) as any;
        editor.getElement(true);

        const afterNextLayoutSpy = vi.spyOn(Component, 'afterNextLayout');
        const syncSpy = vi.spyOn(editor, 'syncAutoHeight');

        editor.mount();

        expect(syncSpy).not.toHaveBeenCalled();
        expect(afterNextLayoutSpy).toHaveBeenCalledTimes(1);

        afterNextLayoutSpy.mock.calls[0][0]();
        expect(syncSpy).toHaveBeenCalledTimes(1);
    });
});

describe('CodeEditor format() dispatch', () => {
    const FORMATTER_LANG = 'test-formatter-lang';
    const THROWING_LANG   = 'test-throwing-formatter-lang';
    const NO_FORMATTER_LANG = 'test-no-formatter-lang';
    const NOOP_FORMATTER_LANG = 'test-noop-formatter-lang';
    const CHANGE_FORMATTER_LANG = 'test-change-formatter-lang';
    const OPTIONS_FORMATTER_LANG = 'test-options-formatter-lang';

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

    it('skips the apply when the formatter returns the document unchanged', async () => {
        const source = 'already formatted';
        const formatter: Formatter = async (text) => ({ formatted: text, cursorOffset: 0 });

        registerLanguage({
            id: NOOP_FORMATTER_LANG,
            loadExtension: async () => [] as any,
            loadFormatter: async () => formatter,
        });

        const editor = new CodeEditor(source, { language: NOOP_FORMATTER_LANG }) as any;
        const dispatchSpy = vi.fn();

        editor._view = {
            state: {
                doc:       { length: source.length, toString: () => source },
                selection: { main: { head: 0 } },
            },
            dispatch:       dispatchSpy,
            scrollSnapshot: () => ({}),
        };

        const applySpy = vi.spyOn(editor, 'applyFormatted');

        await editor.format();

        expect(applySpy).toHaveBeenCalledOnce();
        expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('dispatches a whole-document replace when the formatter changes the text', async () => {
        const source = 'lower';
        const formatter: Formatter = async (text) => ({ formatted: text.toUpperCase(), cursorOffset: 3 });

        registerLanguage({
            id: CHANGE_FORMATTER_LANG,
            loadExtension: async () => [] as any,
            loadFormatter: async () => formatter,
        });

        const editor = new CodeEditor(source, { language: CHANGE_FORMATTER_LANG }) as any;
        const dispatchSpy = vi.fn();

        editor._view = {
            state: {
                doc:       { length: source.length, toString: () => source },
                selection: { main: { head: 0 } },
            },
            dispatch:       dispatchSpy,
            scrollSnapshot: () => ({}),
        };

        await editor.format();

        expect(dispatchSpy).toHaveBeenCalledOnce();
        expect(dispatchSpy.mock.calls[0][0]).toMatchObject({
            changes:   { from: 0, to: source.length, insert: 'LOWER' },
            selection: { anchor: 3 },
        });
    });

    it('carries a scroll snapshot on the replace', async () => {
        const SNAPSHOT = { isSnapshot: true };
        const source    = 'lower';
        const formatter: Formatter = async (text) => ({ formatted: text.toUpperCase(), cursorOffset: 0 });

        registerLanguage({
            id: CHANGE_FORMATTER_LANG,
            loadExtension: async () => [] as any,
            loadFormatter: async () => formatter,
        });

        const editor = new CodeEditor(source, { language: CHANGE_FORMATTER_LANG }) as any;
        const dispatchSpy = vi.fn();

        editor._view = {
            state: {
                doc:       { length: source.length, toString: () => source },
                selection: { main: { head: 0 } },
            },
            dispatch:       dispatchSpy,
            scrollSnapshot: () => SNAPSHOT,
        };

        await editor.format();

        expect(dispatchSpy.mock.calls[0][0].effects).toBe(SNAPSHOT);
    });

    it('passes format() options through to the formatter as its third argument', async () => {
        const received: (FormatOptions | undefined)[] = [];
        const formatter: Formatter = async (source, _cursorOffset, options) => {
            received.push(options);

            return { formatted: source, cursorOffset: 0 };
        };

        registerLanguage({
            id: OPTIONS_FORMATTER_LANG,
            loadExtension: async () => [] as any,
            loadFormatter: async () => formatter,
        });

        const editor  = new CodeEditor('x', { language: OPTIONS_FORMATTER_LANG });
        const options: FormatOptions = { indentWidth: 4 };

        await editor.format();
        await editor.format(options);
        await editor.format({});

        expect(received[0]).toBeUndefined();
        expect(received[1]).toBe(options); // forwarded by identity, not copied
        expect(received[2]).toEqual({});
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

describe('mapFormatOptions', () => {
    // Exercises every FormatOptions field since FormatOptionNames is a
    // Record over all of them; only indentWidth maps to a real target here.
    const NAMES: FormatOptionNames = {
        indentWidth:               'tabWidth',
        useTabs:                   null,
        lineWidth:                 null,
        singleQuote:               null,
        semicolons:                null,
        trailingComma:             null,
        arrowParens:               null,
        bracketSpacing:            null,
        proseWrap:                 null,
        htmlWhitespaceSensitivity: null,
        keywordCase:               null,
    };

    it('returns an empty object for undefined options', () => {
        expect(mapFormatOptions(undefined, NAMES)).toEqual({});
    });

    it('returns an empty object for an empty options bag', () => {
        expect(mapFormatOptions({}, NAMES)).toEqual({});
    });

    it('renames a field onto its mapped target name', () => {
        expect(mapFormatOptions({ indentWidth: 4 }, NAMES)).toEqual({ tabWidth: 4 });
    });

    it('drops a field whose target is null', () => {
        expect(mapFormatOptions({ useTabs: true }, NAMES)).toEqual({});
    });

    it('omits an explicitly-undefined field rather than forwarding it', () => {
        const result = mapFormatOptions({ indentWidth: undefined }, NAMES);

        expect(result).toEqual({});
        expect('tabWidth' in result).toBe(false);
    });

    it('maps only the fields present, ignoring the rest', () => {
        expect(mapFormatOptions({ indentWidth: 4, useTabs: true }, NAMES)).toEqual({ tabWidth: 4 });
    });
});

describe('formatWithPrettier options', () => {
    const jsFormatter = formatWithPrettier('babel-ts', async () => [
        await import('prettier/plugins/babel'),
        await import('prettier/plugins/estree'),
    ]);
    const SOURCE = 'const a = {foo: "bar"}\nconst f = x => x\n';

    it('formats with Prettier defaults when no options are given', async () => {
        const result = await jsFormatter(SOURCE, 0);

        expect(result.formatted).toBe('const a = { foo: "bar" };\nconst f = (x) => x;\n');
    });

    it('applies singleQuote', async () => {
        const result = await jsFormatter(SOURCE, 0, { singleQuote: true });

        expect(result.formatted).toBe("const a = { foo: 'bar' };\nconst f = (x) => x;\n");
    });

    it('applies semicolons: false', async () => {
        const result = await jsFormatter(SOURCE, 0, { semicolons: false });

        expect(result.formatted).toBe('const a = { foo: "bar" }\nconst f = (x) => x\n');
    });

    it('applies arrowParens: avoid', async () => {
        const result = await jsFormatter(SOURCE, 0, { arrowParens: 'avoid' });

        expect(result.formatted).toBe('const a = { foo: "bar" };\nconst f = x => x;\n');
    });

    it('applies indentWidth and lineWidth together', async () => {
        const result = await jsFormatter(SOURCE, 0, { indentWidth: 8, lineWidth: 20 });

        expect(result.formatted).toBe('const a = {\n        foo: "bar",\n};\nconst f = (x) => x;\n');
    });

    it('ignores a SQL-only field', async () => {
        const result = await jsFormatter(SOURCE, 0, { keywordCase: 'upper' });

        expect(result.formatted).toBe('const a = { foo: "bar" };\nconst f = (x) => x;\n');
    });

    it('rejects on a value Prettier refuses', async () => {
        await expect(jsFormatter(SOURCE, 0, { indentWidth: 2.5 })).rejects.toThrow();
    });
});

describe('formatWithSql options', () => {
    const SOURCE = 'select a from b;';

    it('formats with sql-formatter defaults when no options are given', async () => {
        const result = await formatWithSql(SOURCE, 0);

        expect(result.formatted).toBe('select\n  a\nfrom\n  b;');
    });

    it('applies keywordCase', async () => {
        const result = await formatWithSql(SOURCE, 0, { keywordCase: 'upper' });

        expect(result.formatted).toBe('SELECT\n  a\nFROM\n  b;');
    });

    it('applies indentWidth', async () => {
        const result = await formatWithSql(SOURCE, 0, { indentWidth: 4 });

        expect(result.formatted).toBe('select\n    a\nfrom\n    b;');
    });

    it('applies useTabs', async () => {
        const result = await formatWithSql(SOURCE, 0, { useTabs: true });

        expect(result.formatted).toBe('select\n\ta\nfrom\n\tb;');
    });

    it('ignores Prettier-only fields', async () => {
        const result = await formatWithSql(SOURCE, 0, {
            lineWidth:   120,
            singleQuote: true,
            proseWrap:   'always',
        });

        expect(result.formatted).toBe('select\n  a\nfrom\n  b;');
    });

    it('omits explicitly-undefined fields rather than forwarding them', async () => {
        const result = await formatWithSql(SOURCE, 0, { indentWidth: undefined, keywordCase: undefined });

        expect(result.formatted).toBe('select\n  a\nfrom\n  b;');
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
