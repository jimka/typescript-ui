import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CodeEditor, setRevealHighlight, revealHighlightField, codeEditorKeymap, buildReadOnlyExtension } from '~/component/editor/CodeEditor';
import type { CodeEditorChange, CodeEditorCursorPosition, CodeEditorSelection } from '~/component/editor/CodeEditor';
import { registerLanguage, getLanguage, listLanguages } from '~/component/editor/LanguageRegistry';
import type { Formatter } from '~/component/editor/LanguageRegistry';
import { formatWithSql } from '~/component/editor/formatters/sql';
import { formatWithPrettier } from '~/component/editor/formatters/prettier';
import { mapFormatOptions } from '~/component/editor/formatters/options';
import type { FormatOptionNames } from '~/component/editor/formatters/options';
import type { FormatOptions } from '~/component/editor/LanguageRegistry';
// Barrel import triggers the seven-built-in registration side effect.
import '~/component/editor/index';
import { Component } from '~/core/Component';
import { Anchor } from '~/layout/Anchor';
import { DOM } from '~/core/DOM';
import { Animation } from '~/core/Animation';
import { installTestDOM, setQuerySelectorResult, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { EditorState, EditorSelection, Prec, StateEffect, Transaction } from '@codemirror/state';
import type { Extension, TransactionSpec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { codeFolding, foldable, foldEffect, foldedRanges, ensureSyntaxTree, syntaxTree, indentOnInput, indentUnit, language as languageFacet } from '@codemirror/language';
import { SearchQuery, getSearchQuery, setSearchQuery } from '@codemirror/search';
import { CompletionContext, closeBrackets, completionKeymap, deleteBracketPair } from '@codemirror/autocomplete';
import { deleteCharBackward, history, indentWithTab, undo, undoDepth } from '@codemirror/commands';
import { lintKeymap } from '@codemirror/lint';
import { basicSetup } from 'codemirror';
import type { CompletionSource } from '@codemirror/autocomplete';
import { json } from '@codemirror/lang-json';
import { commonmarkLanguage, deleteMarkupBackward } from '@codemirror/lang-markdown';
import { collectSyntaxErrors } from '~/component/editor/syntaxDiagnostics';
import { tabDocuments } from './markdown-roundtrip/tabDocuments';
import { viewerModel } from './markdown-roundtrip/viewModel';
import { expandPrefixTabs } from '~/component/display/markdownTabs';
import type { SqlLanguageOptions } from '~/component/editor/languages';
import type { MenuItemConfig } from '~/component/container/MenuItem';
import { Notification } from '~/overlay/Notification';
import type { RecordingDOMSink } from '../dom/TestDOM';

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

describe('CodeEditor tabSize', () => {
    it('getTabSize defaults to null', () => {
        const editor = new CodeEditor();

        expect(editor.getTabSize()).toBeNull();
    });

    it('round-trips through the constructor options bag', () => {
        const editor = new CodeEditor(undefined, { tabSize: 4 });

        expect(editor.getTabSize()).toBe(4);
    });

    it('setTabSize(null) clears a previously set tabSize', () => {
        const editor = new CodeEditor();

        editor.setTabSize(2);
        expect(editor.getTabSize()).toBe(2);

        editor.setTabSize(null);
        expect(editor.getTabSize()).toBeNull();
    });
});

describe('CodeEditor lineNumbers', () => {
    it('getLineNumbers defaults to true', () => {
        const editor = new CodeEditor();

        expect(editor.getLineNumbers()).toBe(true);
    });

    it('round-trips through the constructor options bag', () => {
        const editor = new CodeEditor(undefined, { lineNumbers: false });

        expect(editor.getLineNumbers()).toBe(false);
    });

    it('setLineNumbers round-trips without a live view, with no throw', () => {
        const editor = new CodeEditor();

        expect(() => editor.setLineNumbers(false)).not.toThrow();
        expect(editor.getLineNumbers()).toBe(false);
    });
});

describe('CodeEditor spellcheck', () => {
    it('getSpellcheck defaults to false', () => {
        const editor = new CodeEditor();

        expect(editor.getSpellcheck()).toBe(false);
    });

    it('round-trips through the constructor options bag', () => {
        const editor = new CodeEditor(undefined, { spellcheck: true });

        expect(editor.getSpellcheck()).toBe(true);
    });

    it('setSpellcheck round-trips without a live view, with no throw', () => {
        const editor = new CodeEditor();

        expect(() => editor.setSpellcheck(true)).not.toThrow();
        expect(editor.getSpellcheck()).toBe(true);
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

describe('CodeEditor cursor position', () => {
    it('returns the document start before the view is mounted', () => {
        const editor = new CodeEditor();

        expect(editor.getCursorPosition()).toEqual({ line: 1, column: 1, offset: 0 });
    });

    it('exposes offset from the getter for a duck-typed mounted view', () => {
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'ab\ncd', selection: { anchor: 4 } }) };

        expect(editor.getCursorPosition()).toEqual({ line: 2, column: 2, offset: 4 });
    });

    it('returns the document start when constructed with content but still unmounted', () => {
        const editor = new CodeEditor('several\nlines\nhere');

        expect(editor.getCursorPosition()).toEqual({ line: 1, column: 1, offset: 0 });
    });

    it('derives line 1, column 1 for the caret before the first character', () => {
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'ab\ncd', selection: { anchor: 0 } }) };

        expect(editor.getCursorPosition()).toEqual({ line: 1, column: 1, offset: 0 });
    });

    it('derives line 1, column 3 for the caret at the end of the first line', () => {
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'ab\ncd', selection: { anchor: 2 } }) };

        expect(editor.getCursorPosition()).toEqual({ line: 1, column: 3, offset: 2 });
    });

    it('derives line 2, column 1 for the caret at the start of the second line', () => {
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'ab\ncd', selection: { anchor: 3 } }) };

        expect(editor.getCursorPosition()).toEqual({ line: 2, column: 1, offset: 3 });
    });

    it('derives line 2, column 3 for the caret after the last character', () => {
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'ab\ncd', selection: { anchor: 5 } }) };

        expect(editor.getCursorPosition()).toEqual({ line: 2, column: 3, offset: 5 });
    });

    it('counts a literal tab as one column regardless of its rendered width', () => {
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: '\tx', selection: { anchor: 1 } }) };

        expect(editor.getCursorPosition()).toEqual({ line: 1, column: 2, offset: 1 });
    });

    it('counts a character outside the Basic Multilingual Plane as two columns', () => {
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: '😀x', selection: { anchor: 2 } }) };

        expect(editor.getCursorPosition()).toEqual({ line: 1, column: 3, offset: 2 });
    });

    it('reports the selection head, not the anchor', () => {
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'ab\ncd', selection: { anchor: 0, head: 5 } }) };

        expect(editor.getCursorPosition()).toEqual({ line: 2, column: 3, offset: 5 });
    });

    it('reports the range named by mainIndex, not the first range, with multiple selections', () => {
        const editor = new CodeEditor() as any;
        editor._view = {
            state: EditorState.create({
                doc: 'ab\ncd',
                selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(4)], 1),
                extensions: [EditorState.allowMultipleSelections.of(true)],
            }),
        };

        expect(editor.getCursorPosition()).toEqual({ line: 2, column: 2, offset: 4 });
    });

    it('emits nothing when the caret is still at the seeded document start', () => {
        const editor = new CodeEditor() as any;
        const payloads: CodeEditorCursorPosition[] = [];
        editor.on('cursorchange', (payload: CodeEditorCursorPosition) => payloads.push(payload));

        editor.onCursorChange(EditorState.create({ doc: 'ab\ncd', selection: { anchor: 0 } }));

        expect(payloads).toEqual([]);
    });

    it('emits once when the caret moves to a new position', () => {
        const editor = new CodeEditor() as any;
        const payloads: CodeEditorCursorPosition[] = [];
        editor.on('cursorchange', (payload: CodeEditorCursorPosition) => payloads.push(payload));

        editor.onCursorChange(EditorState.create({ doc: 'ab\ncd', selection: { anchor: 4 } }));

        expect(payloads).toEqual([{ line: 2, column: 2, offset: 4 }]);
    });

    it('does not emit again when called twice with the same position', () => {
        const editor = new CodeEditor() as any;
        const payloads: CodeEditorCursorPosition[] = [];
        editor.on('cursorchange', (payload: CodeEditorCursorPosition) => payloads.push(payload));

        const state = EditorState.create({ doc: 'ab\ncd', selection: { anchor: 4 } });
        editor.onCursorChange(state);
        editor.onCursorChange(state);

        expect(payloads).toEqual([{ line: 2, column: 2, offset: 4 }]);
    });

    it('emits once per distinct move across two different positions', () => {
        const editor = new CodeEditor() as any;
        const payloads: CodeEditorCursorPosition[] = [];
        editor.on('cursorchange', (payload: CodeEditorCursorPosition) => payloads.push(payload));

        editor.onCursorChange(EditorState.create({ doc: 'ab\ncd', selection: { anchor: 4 } }));
        editor.onCursorChange(EditorState.create({ doc: 'ab\ncd', selection: { anchor: 1 } }));

        expect(payloads).toEqual([{ line: 2, column: 2, offset: 4 }, { line: 1, column: 2, offset: 1 }]);
    });

    it('emits again when offset drifts while line and column hold', () => {
        const editor = new CodeEditor() as any;
        const payloads: CodeEditorCursorPosition[] = [];
        editor.on('cursorchange', (payload: CodeEditorCursorPosition) => payloads.push(payload));

        editor.onCursorChange(EditorState.create({ doc: 'ab\ncd', selection: { anchor: 3 } }));
        editor.onCursorChange(EditorState.create({ doc: 'xab\ncd', selection: { anchor: 4 } }));

        expect(payloads).toEqual([{ line: 2, column: 1, offset: 3 }, { line: 2, column: 1, offset: 4 }]);
    });

    it('on() / off() register and remove a cursorchange listener', () => {
        const editor = new CodeEditor();
        let fired = 0;
        const listener = (): void => { fired += 1; };

        editor.on('cursorchange', listener);
        (editor as any).emit('cursorchange', { line: 1, column: 1, offset: 0 });
        expect(fired).toBe(1);

        editor.off('cursorchange', listener);
        (editor as any).emit('cursorchange', { line: 2, column: 2, offset: 4 });
        expect(fired).toBe(1);
    });

    it('wires a constructor listeners.cursorchange bag through applyListeners', () => {
        let received: CodeEditorCursorPosition | null = null;
        const editor = new CodeEditor(undefined,
            { listeners: { cursorchange: (payload) => { received = payload; } } });

        (editor as any).emit('cursorchange', { line: 3, column: 4, offset: 30 });

        expect(received).toEqual({ line: 3, column: 4, offset: 30 });
    });
});

describe('CodeEditor selection', () => {
    it('reports a collapsed selection as zero characters across one line', () => {
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'ab\ncd', selection: { anchor: 0, head: 0 } }) };

        expect(editor.getSelection()).toEqual({ characterCount: 0, lineCount: 1, from: 0, to: 0 });
    });

    it('reports the character count for a single-line forward selection', () => {
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'abcdef', selection: { anchor: 1, head: 4 } }) };

        expect(editor.getSelection()).toEqual({ characterCount: 3, lineCount: 1, from: 1, to: 4 });
    });

    it('reports the same character count for a selection dragged backward', () => {
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'abcdef', selection: { anchor: 4, head: 1 } }) };

        expect(editor.getSelection()).toEqual({ characterCount: 3, lineCount: 1, from: 1, to: 4 });
    });

    it('reports the line count for a selection spanning multiple lines', () => {
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'ab\ncd\nef', selection: { anchor: 1, head: 7 } }) };

        expect(editor.getSelection()).toEqual({ characterCount: 6, lineCount: 3, from: 1, to: 7 });
    });

    it('reports the whole document for a select-all', () => {
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'ab\ncd\nef', selection: { anchor: 0, head: 8 } }) };

        expect(editor.getSelection()).toEqual({ characterCount: 8, lineCount: 3, from: 0, to: 8 });
    });

    it('returns a collapsed selection at the document start before the view is mounted', () => {
        const editor = new CodeEditor();

        expect(editor.getSelection()).toEqual({ characterCount: 0, lineCount: 1, from: 0, to: 0 });
    });

    it('returns a collapsed selection at the document start when constructed with content but still unmounted', () => {
        const editor = new CodeEditor('several\nlines\nhere');

        expect(editor.getSelection()).toEqual({ characterCount: 0, lineCount: 1, from: 0, to: 0 });
    });

    it('reports the range named by mainIndex, not the first range, with multiple selections', () => {
        const editor = new CodeEditor() as any;
        editor._view = {
            state: EditorState.create({
                doc: 'ab\ncd',
                selection: EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(3, 5)], 1),
                extensions: [EditorState.allowMultipleSelections.of(true)],
            }),
        };

        expect(editor.getSelection()).toEqual({ characterCount: 2, lineCount: 1, from: 3, to: 5 });
    });

    it('reports the normalised bounds from a duck-typed view', () => {
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'abcdef', selection: { anchor: 5, head: 2 } }) };

        expect(editor.getSelection()).toEqual({ characterCount: 3, lineCount: 1, from: 2, to: 5 });
    });

    it('emits nothing when the selection is still the seeded collapsed selection', () => {
        const editor = new CodeEditor() as any;
        const payloads: CodeEditorSelection[] = [];
        editor.on('selectionchange', (payload: CodeEditorSelection) => payloads.push(payload));

        editor.onSelectionChange(EditorState.create({ doc: 'ab\ncd', selection: { anchor: 0, head: 0 } }));

        expect(payloads).toEqual([]);
    });

    it('emits once when the selection changes', () => {
        const editor = new CodeEditor() as any;
        const payloads: CodeEditorSelection[] = [];
        editor.on('selectionchange', (payload: CodeEditorSelection) => payloads.push(payload));

        editor.onSelectionChange(EditorState.create({ doc: 'ab\ncd', selection: { anchor: 0, head: 4 } }));

        expect(payloads).toEqual([{ characterCount: 4, lineCount: 2, from: 0, to: 4 }]);
    });

    it('does not emit again when called twice with the same selection', () => {
        const editor = new CodeEditor() as any;
        const payloads: CodeEditorSelection[] = [];
        editor.on('selectionchange', (payload: CodeEditorSelection) => payloads.push(payload));

        const state = EditorState.create({ doc: 'ab\ncd', selection: { anchor: 0, head: 4 } });
        editor.onSelectionChange(state);
        editor.onSelectionChange(state);

        expect(payloads).toEqual([{ characterCount: 4, lineCount: 2, from: 0, to: 4 }]);
    });

    it('emits again when the selection shrinks back toward the start', () => {
        const editor = new CodeEditor() as any;
        const payloads: CodeEditorSelection[] = [];
        editor.on('selectionchange', (payload: CodeEditorSelection) => payloads.push(payload));

        editor.onSelectionChange(EditorState.create({ doc: 'ab\ncd', selection: { anchor: 0, head: 4 } }));
        editor.onSelectionChange(EditorState.create({ doc: 'ab\ncd', selection: { anchor: 1, head: 0 } }));

        expect(payloads).toEqual([
            { characterCount: 4, lineCount: 2, from: 0, to: 4 },
            { characterCount: 1, lineCount: 1, from: 0, to: 1 },
        ]);
    });

    it('emits again when the line count changes even though the character count ties', () => {
        const editor = new CodeEditor() as any;
        const payloads: CodeEditorSelection[] = [];
        editor.on('selectionchange', (payload: CodeEditorSelection) => payloads.push(payload));

        editor.onSelectionChange(EditorState.create({ doc: 'ab\ncd\nef', selection: { anchor: 1, head: 3 } }));
        editor.onSelectionChange(EditorState.create({ doc: 'ab\ncd\nef', selection: { anchor: 3, head: 5 } }));

        expect(payloads).toEqual([
            { characterCount: 2, lineCount: 2, from: 1, to: 3 },
            { characterCount: 2, lineCount: 1, from: 3, to: 5 },
        ]);
    });

    it('emits again for a same-size selection moved elsewhere, which the pre-widening dedup missed', () => {
        const editor = new CodeEditor() as any;
        const payloads: CodeEditorSelection[] = [];
        editor.on('selectionchange', (payload: CodeEditorSelection) => payloads.push(payload));

        editor.onSelectionChange(EditorState.create({ doc: 'abcdef', selection: { anchor: 0, head: 2 } }));
        editor.onSelectionChange(EditorState.create({ doc: 'abcdef', selection: { anchor: 3, head: 5 } }));

        expect(payloads).toEqual([
            { characterCount: 2, lineCount: 1, from: 0, to: 2 },
            { characterCount: 2, lineCount: 1, from: 3, to: 5 },
        ]);
    });

    it('emits selectionchange but not cursorchange for a select-all that leaves the caret in place', () => {
        const editor = new CodeEditor() as any;
        const cursorPayloads: CodeEditorCursorPosition[] = [];
        const selectionPayloads: CodeEditorSelection[] = [];
        editor.on('cursorchange', (payload: CodeEditorCursorPosition) => cursorPayloads.push(payload));
        editor.on('selectionchange', (payload: CodeEditorSelection) => selectionPayloads.push(payload));

        // Prime both dedup fields to "caret at the document's last position,
        // nothing selected" before observing the regression this plan exists
        // to fix.
        const atEnd = EditorState.create({ doc: 'ab\ncd', selection: { anchor: 5 } });
        editor.onCursorChange(atEnd);
        editor.onSelectionChange(atEnd);
        cursorPayloads.length = 0;
        selectionPayloads.length = 0;

        // Ctrl/Cmd+A: selects the whole document but leaves the head at the
        // same offset, so onCursorChange's own dedup suppresses it while the
        // selection's extent still changed.
        const selectAll = EditorState.create({ doc: 'ab\ncd', selection: { anchor: 0, head: 5 } });
        editor.onCursorChange(selectAll);
        editor.onSelectionChange(selectAll);

        expect(cursorPayloads).toEqual([]);
        expect(selectionPayloads).toEqual([{ characterCount: 5, lineCount: 2, from: 0, to: 5 }]);
    });

    it('on() / off() register and remove a selectionchange listener', () => {
        const editor = new CodeEditor();
        let fired = 0;
        const listener = (): void => { fired += 1; };

        editor.on('selectionchange', listener);
        (editor as any).emit('selectionchange', { characterCount: 4, lineCount: 2, from: 0, to: 4 });
        expect(fired).toBe(1);

        editor.off('selectionchange', listener);
        (editor as any).emit('selectionchange', { characterCount: 1, lineCount: 1, from: 0, to: 1 });
        expect(fired).toBe(1);
    });

    it('wires a constructor listeners.selectionchange bag through applyListeners', () => {
        let received: CodeEditorSelection | null = null;
        const editor = new CodeEditor(undefined,
            { listeners: { selectionchange: (payload) => { received = payload; } } });

        (editor as any).emit('selectionchange', { characterCount: 5, lineCount: 2, from: 0, to: 5 });

        expect(received).toEqual({ characterCount: 5, lineCount: 2, from: 0, to: 5 });
    });
});

describe('CodeEditor replaceRange', () => {
    it('dispatches one transaction carrying both the change and the selection', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'abcdef' }), dispatch };

        editor.replaceRange(1, 3, 'XY', { from: 1, to: 3 });

        expect(dispatch).toHaveBeenCalledTimes(1);
        const spec = dispatch.mock.calls[0][0];
        expect(spec.changes).toEqual({ from: 1, to: 3, insert: 'XY' });
        expect(spec.selection).toEqual({ anchor: 1, head: 3 });
    });

    it('omitting selection dispatches no selection', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'abcdef' }), dispatch };

        editor.replaceRange(1, 3, 'XY');

        expect(dispatch.mock.calls[0][0].selection).toBeUndefined();
    });

    it('clamps offsets that run outside the document', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'abcdef' }), dispatch };

        editor.replaceRange(-5, 99, 'Z');

        expect(dispatch.mock.calls[0][0].changes).toEqual({ from: 0, to: 6, insert: 'Z' });
    });

    it('clamps a selection beyond the post-edit length to it', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'abcdef' }), dispatch };

        editor.replaceRange(0, 6, 'Z', { from: 9, to: 9 });

        expect(dispatch.mock.calls[0][0].selection).toEqual({ anchor: 1, head: 1 });
    });

    it('normalises an inverted range, raising to rather than lowering from', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = { state: EditorState.create({ doc: 'abcdef' }), dispatch };

        editor.replaceRange(4, 1, 'Z');

        expect(dispatch.mock.calls[0][0].changes).toEqual({ from: 4, to: 4, insert: 'Z' });
    });

    it('refuses while read-only, leaving the value unchanged and signalling the rejection', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor('abcdef', { readOnly: true }) as any;
        editor._view = { state: EditorState.create({ doc: 'abcdef' }), dispatch };
        let readonlyEdits = 0;
        editor.on('readonlyedit', () => { readonlyEdits += 1; });

        editor.replaceRange(1, 3, 'XY');

        expect(dispatch).not.toHaveBeenCalled();
        expect(editor.getValue()).toBe('abcdef');
        expect(readonlyEdits).toBe(1);
    });

    it('updates the cached value offline, with no view and no change event', () => {
        const editor = new CodeEditor('abcdef');
        let fired = 0;
        editor.on('change', () => { fired += 1; });

        editor.replaceRange(1, 3, 'XY');

        expect(editor.getValue()).toBe('aXYdef');
        expect(fired).toBe(0);
    });
});

/**
 * Calls `mount()` offline and captures the state it builds. No view is
 * mounted there, so the state is read off a spy on `EditorState.create`. A
 * `describe` that calls this restores the spy in an `afterEach`, which runs
 * even when `mount()` throws.
 *
 * @param value - The editor's document.
 * @param readOnly - Whether the editor is read-only.
 * @returns The editor and the state its `mount()` built.
 */
function mountOffline(value?: string, readOnly: boolean = false): { editor: any; state: EditorState } {
    const editor = new CodeEditor(value, { readOnly }) as any;

    editor.getElement(true);

    const createSpy = vi.spyOn(EditorState, 'create');

    editor.mount();

    return { editor, state: createSpy.mock.results[0].value as EditorState };
}

describe('CodeEditor read-only extension', () => {
    afterEach(() => vi.restoreAllMocks());

    /**
     * Builds a read-only state holding "abc", the way the editor makes a
     * state read-only.
     *
     * @returns The state.
     */
    function readOnlyState(): EditorState {
        return EditorState.create({ doc: 'abc', extensions: buildReadOnlyExtension(true) });
    }

    it('RO7: refuses a document change, and moves no caret with it', () => {
        const transaction = readOnlyState().update({ changes: { from: 0, insert: 'x' }, selection: { anchor: 2 } });

        expect(transaction.docChanged).toBe(false);
        expect(transaction.state.doc.toString()).toBe('abc');
        expect(transaction.state.selection.main.head).toBe(0);
    });

    it('RO8: lets a transaction that changes no text through', () => {
        const state = EditorState.create({ doc: 'abc', extensions: [buildReadOnlyExtension(true), revealHighlightField] });
        const moved = state.update({ selection: { anchor: 2 } });
        const shown = state.update({ effects: setRevealHighlight.of({ from: 0, to: 1, flash: false }) });

        expect(moved.state.selection.main.head).toBe(2);
        expect(shown.state.field(revealHighlightField).size).toBe(1);
    });

    it('RO9: sets the read-only flag only when read-only', () => {
        expect(readOnlyState().readOnly).toBe(true);
        expect(EditorState.create({ extensions: buildReadOnlyExtension(false) }).readOnly).toBe(false);
    });

    it('RO10: when not read-only, lets a document change through', () => {
        const state = EditorState.create({ doc: 'abc', extensions: buildReadOnlyExtension(false) });

        expect(state.update({ changes: { from: 0, insert: 'x' } }).state.doc.toString()).toBe('xabc');
    });

    it('RO11: the state mount() builds for a read-only editor refuses a document change', () => {
        const { editor, state } = mountOffline('abc', true);
        const writable          = state.update({ effects: editor._readOnlyCompartment.reconfigure(buildReadOnlyExtension(false)) }).state;

        expect(state.update({ changes: { from: 0, insert: 'x' } }).docChanged).toBe(false);
        expect(writable.update({ changes: { from: 0, insert: 'x' } }).docChanged).toBe(true);
    });

    it('RO12: setValue loads a document into a read-only editor, and signals nothing', () => {
        const state  = readOnlyState();
        const editor = new CodeEditor('abc', { readOnly: true }) as any;
        const loaded: Transaction[] = [];
        let refusals = 0;

        editor.on('readonlyedit', () => { refusals += 1; });
        editor._view = { state, dispatch: (spec: TransactionSpec) => { loaded.push(state.update(spec)); } };

        editor.setValue('new');
        editor.signalRefusedEdit(loaded);

        expect(loaded[0].state.doc.toString()).toBe('new');
        expect(refusals).toBe(0);
    });

    it('RO13: a refused transaction signals the rejected edit once, and any other signals nothing', () => {
        const state  = readOnlyState();
        const editor = new CodeEditor('abc', { readOnly: true }) as any;
        let refusals = 0;

        editor.on('readonlyedit', () => { refusals += 1; });

        editor.signalRefusedEdit([state.update({ selection: { anchor: 1 } })]);
        expect(refusals).toBe(0);

        editor.signalRefusedEdit([state.update({ changes: { from: 0, insert: 'x' } }), state.update({ changes: { from: 1, insert: 'y' } })]);
        expect(refusals).toBe(1);
    });

    it('RO14: a filter of a higher precedence cannot put a change back', () => {
        // CodeMirror runs transaction filters from the lowest precedence to
        // the highest, and the last one decides. This one stands for a
        // language's own, loaded where `CodeEditor` loads a language.
        const { editor, state: built } = mountOffline('abc', true);

        const addsText = EditorState.transactionFilter.of((transaction) => (
            transaction.docChanged ? transaction : [transaction, { changes: { from: 0, insert: 'x' } }]
        ));

        for (const filter of [addsText, Prec.high(addsText), Prec.highest(addsText)]) {
            const state = built.update({ effects: editor._langCompartment.reconfigure(filter) }).state;
            const moved = state.update({ selection: { anchor: 2 } });

            expect(moved.state.doc.toString()).toBe('abc');
            expect(moved.docChanged).toBe(false);
        }
    });

    it('RO15: the transactions the editor itself dispatches while read-only pass', () => {
        const { editor, state } = mountOffline('abc', true);
        const language          = state.update({ effects: editor._langCompartment.reconfigure(json()) });
        const folded    = state.update({ effects: foldEffect.of({ from: 1, to: 2 }) });
        const searching = state.update({ effects: setSearchQuery.of(new SearchQuery({ search: 'b' })) });
        const tabSize   = state.update({ effects: editor._tabSizeCompartment.reconfigure(EditorState.tabSize.of(2)) });

        expect(language.state.facet(languageFacet)).not.toBeNull();
        expect(foldedRanges(folded.state).size).toBe(1);
        expect(getSearchQuery(searching.state).search).toBe('b');
        expect(tabSize.state.tabSize).toBe(2);

        for (const transaction of [language, folded, searching, tabSize]) {
            expect(transaction.state.readOnly).toBe(true);
            expect(transaction.state.doc.toString()).toBe('abc');
        }
    });

    it('RO16: the read-only extension binds a refusal to each deletion key the editor\'s keymap stops the default of', () => {
        const bound    = EditorState.create({ extensions: buildReadOnlyExtension(true) }).facet(keymap).flat();
        const writable = EditorState.create({ extensions: buildReadOnlyExtension(false) }).facet(keymap).flat();

        // CodeMirror's six deletion bindings, as `standardKeymap` lists them.
        expect(bound.map(({ key, mac, shift }) => ({ key, mac, shift: shift !== undefined }))).toEqual([
            { key: 'Backspace', mac: undefined, shift: true },
            { key: 'Delete', mac: undefined, shift: false },
            { key: 'Mod-Backspace', mac: 'Alt-Backspace', shift: false },
            { key: 'Mod-Delete', mac: 'Alt-Delete', shift: false },
            { key: undefined, mac: 'Mod-Backspace', shift: false },
            { key: undefined, mac: 'Mod-Delete', shift: false },
        ]);
        expect(bound.every((binding) => binding.any === undefined)).toBe(true);
        expect(writable).toEqual([]);
    });
});

describe('CodeEditor revealRange', () => {
    /**
     * A duck-typed `EditorView` carrying a **real** `EditorState`, so
     * `doc.line()` and `doc.lines` behave exactly as they do live.
     */
    function fakeView(doc: string, dispatch = vi.fn(), focus = vi.fn()) {
        return { state: EditorState.create({ doc }), dispatch, focus };
    }

    it('returns the editor itself and does nothing before the view is mounted', () => {
        const editor = new CodeEditor();
        let result: CodeEditor | undefined;

        expect(() => { result = editor.revealRange({ line: 1, column: 1, length: 1 }); }).not.toThrow();
        expect(result).toBe(editor);
    });

    it('returns the editor itself for chaining once a view is mounted', () => {
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd');

        expect(editor.revealRange({ line: 1, column: 1, length: 1 })).toBe(editor);
    });

    it('clamp: column 1 is the line\'s first character (doc "ab\\ncd")', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', dispatch);

        editor.revealRange({ line: 1, column: 1, length: 2 });

        expect(dispatch).toHaveBeenCalledTimes(1);
        const spec = dispatch.mock.calls[0][0];
        expect(spec.selection).toEqual({ anchor: 0, head: 2 });
        expect(spec.scrollIntoView).toBe(true);
    });

    it('clamp: line 2 starts at offset 3, so column 2 is offset 4', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', dispatch);

        editor.revealRange({ line: 2, column: 2, length: 1 });

        expect(dispatch.mock.calls[0][0].selection).toEqual({ anchor: 4, head: 5 });
    });

    it('clamp: an out-of-range line clamps to the last line', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', dispatch);

        editor.revealRange({ line: 7, column: 1, length: 1 });

        expect(dispatch.mock.calls[0][0].selection).toEqual({ anchor: 3, head: 4 });
    });

    it('clamp: a column past the line\'s end clamps to the end, collapsing the range', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', dispatch);

        editor.revealRange({ line: 1, column: 7, length: 2 });

        expect(dispatch.mock.calls[0][0].selection).toEqual({ anchor: 2, head: 2 });
    });

    it('clamp: a length running past the line\'s end clamps to the end', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', dispatch);

        editor.revealRange({ line: 1, column: 2, length: 9 });

        expect(dispatch.mock.calls[0][0].selection).toEqual({ anchor: 1, head: 2 });
    });

    it('clamp: line and column below 1 are floored to 1', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', dispatch);

        editor.revealRange({ line: 0, column: 0, length: 1 });

        expect(dispatch.mock.calls[0][0].selection).toEqual({ anchor: 0, head: 1 });
    });

    it('focuses the view by default', () => {
        const focus = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', vi.fn(), focus);

        editor.revealRange({ line: 1, column: 1, length: 1 });

        expect(focus).toHaveBeenCalledOnce();
    });

    it('focuses the view when options.focus is true', () => {
        const focus = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', vi.fn(), focus);

        editor.revealRange({ line: 1, column: 1, length: 1 }, { focus: true });

        expect(focus).toHaveBeenCalledOnce();
    });

    it('does not focus the view when options.focus is false', () => {
        const focus = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', vi.fn(), focus);

        editor.revealRange({ line: 1, column: 1, length: 1 }, { focus: false });

        expect(focus).not.toHaveBeenCalled();
    });

    it('the highlight effect carries the clamped range with flash: true', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', dispatch);

        editor.revealRange({ line: 1, column: 1, length: 2 });

        const effect = dispatch.mock.calls[0][0].effects;
        expect(effect.is(setRevealHighlight)).toBe(true);
        expect(effect.value).toEqual({ from: 0, to: 2, flash: true });
    });

    it('the highlight effect is null when options.highlight is false', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', dispatch);

        editor.revealRange({ line: 1, column: 1, length: 2 }, { highlight: false });

        expect(dispatch.mock.calls[0][0].effects.value).toBeNull();
    });

    it('the highlight effect is null for a zero-length range', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', dispatch);

        editor.revealRange({ line: 1, column: 1, length: 0 });

        expect(dispatch.mock.calls[0][0].effects.value).toBeNull();
    });

    it('the highlight effect is null when the range clamps down to empty', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', dispatch);

        editor.revealRange({ line: 1, column: 7, length: 2 });

        expect(dispatch.mock.calls[0][0].effects.value).toBeNull();
    });

    it('the highlight effect carries flash: false under prefers-reduced-motion', () => {
        vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} });

        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', dispatch);

        editor.revealRange({ line: 1, column: 1, length: 2 });

        expect(dispatch.mock.calls[0][0].effects.value).toEqual({ from: 0, to: 2, flash: false });
    });

    it('keeps the plain scrollIntoView flag, with a single effect, when scrollAlign is "nearest" (the default)', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', dispatch);

        editor.revealRange({ line: 1, column: 1, length: 2 }, { scrollAlign: 'nearest' });

        const spec = dispatch.mock.calls[0][0];
        expect(spec.scrollIntoView).toBe(true);
        expect(spec.effects.is(setRevealHighlight)).toBe(true);
    });

    it('dispatches an explicit scrollIntoView effect, centered on both axes, when scrollAlign is "center"', () => {
        const dispatch = vi.fn();
        const editor = new CodeEditor() as any;
        editor._view = fakeView('ab\ncd', dispatch);

        editor.revealRange({ line: 1, column: 1, length: 2 }, { scrollAlign: 'center' });

        const spec = dispatch.mock.calls[0][0];
        expect(spec.scrollIntoView).toBeUndefined();
        expect(Array.isArray(spec.effects)).toBe(true);
        expect(spec.effects).toHaveLength(2);
        expect(spec.effects[0].is(setRevealHighlight)).toBe(true);
        expect(spec.effects[1].value).toMatchObject({ y: 'center', x: 'center', range: EditorSelection.range(0, 2) });
    });
});

describe('CodeEditor reveal highlight field', () => {
    function freshState(): EditorState {
        return EditorState.create({ doc: 'ab\ncd', extensions: [revealHighlightField] });
    }

    function stateHoldingRange(): EditorState {
        return freshState().update({ effects: setRevealHighlight.of({ from: 0, to: 2, flash: true }) }).state;
    }

    function fieldOf(state: EditorState) {
        return state.field(revealHighlightField);
    }

    it('starts empty', () => {
        expect(fieldOf(freshState()).size).toBe(0);
    });

    it('holds the range set by setRevealHighlight, with the flash class', () => {
        const state = freshState().update({ effects: setRevealHighlight.of({ from: 0, to: 2, flash: true }) }).state;
        const field = fieldOf(state);

        expect(field.size).toBe(1);
        const cursor = field.iter();
        expect(cursor.from).toBe(0);
        expect(cursor.to).toBe(2);
        expect(cursor.value?.spec.class).toBe('ts-ui-cm-reveal ts-ui-cm-reveal-flash');
    });

    it('holds the range without the flash class when flash is false', () => {
        const state = freshState().update({ effects: setRevealHighlight.of({ from: 0, to: 2, flash: false }) }).state;

        expect(fieldOf(state).iter().value?.spec.class).toBe('ts-ui-cm-reveal');
    });

    it('replaces rather than stacks on a second setRevealHighlight', () => {
        const state = stateHoldingRange().update({ effects: setRevealHighlight.of({ from: 3, to: 5, flash: true }) }).state;
        const field = fieldOf(state);

        expect(field.size).toBe(1);
        const cursor = field.iter();
        expect(cursor.from).toBe(3);
        expect(cursor.to).toBe(5);
    });

    it('clears on setRevealHighlight(null)', () => {
        const state = stateHoldingRange().update({ effects: setRevealHighlight.of(null) }).state;

        expect(fieldOf(state).size).toBe(0);
    });

    it('clears on a user-driven selection change', () => {
        const state = stateHoldingRange().update({ selection: { anchor: 4 }, userEvent: 'select' }).state;

        expect(fieldOf(state).size).toBe(0);
    });

    it('clears on a document change', () => {
        const state = stateHoldingRange().update({ changes: { from: 0, insert: 'x' } }).state;

        expect(fieldOf(state).size).toBe(0);
    });

    it('survives a selection change with no user-event annotation', () => {
        const state = stateHoldingRange().update({ selection: { anchor: 4 } }).state;

        expect(fieldOf(state).size).toBe(1);
    });

    it('survives an unrelated empty transaction', () => {
        const state = stateHoldingRange().update({}).state;

        expect(fieldOf(state).size).toBe(1);
    });

    it('the effect wins over a simultaneous user-driven selection change', () => {
        const state = stateHoldingRange().update({
            selection: { anchor: 4 },
            userEvent:  'select',
            effects:    setRevealHighlight.of({ from: 3, to: 5, flash: true }),
        }).state;
        const field = fieldOf(state);

        expect(field.size).toBe(1);
        const cursor = field.iter();
        expect(cursor.from).toBe(3);
        expect(cursor.to).toBe(5);
    });
});

describe('collectSyntaxErrors', () => {
    afterEach(() => vi.restoreAllMocks());

    // How far each Date.now() read lands past the previous one in the
    // slow-clock case. Anything above the 20 ms budget CodeMirror gives a new
    // EditorState's first parse works; 25 clears it by a margin, so that
    // budget expires at its very first check.
    const CLOCK_STEP_MS = 25;

    /**
     * Builds a JSON editor state whose syntax tree is complete.
     * `EditorState.create` parses for at most 20 ms and keeps whatever tree it
     * has by then, so on a busy machine a longer document comes back
     * half-parsed and yields fewer diagnostics. Parsing on with no time limit
     * and applying one empty transaction publishes the finished tree: the two
     * moves CodeMirror's own `forceParsing` makes for a view.
     *
     * @param doc - The document text.
     * @returns A state whose `syntaxTree` covers the whole document.
     */
    function buildJsonState(doc: string): EditorState {
        const state = EditorState.create({ doc, extensions: [json()] });

        ensureSyntaxTree(state, state.doc.length, Infinity);

        return state.update({}).state;
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

    it('caps at 100 even when every parse budget expires at its first check', () => {
        let now = 0;

        vi.spyOn(Date, 'now').mockImplementation(() => (now += CLOCK_STEP_MS));

        const doc = Array.from({ length: 250 }, () => ']').join(' ');

        expect(collectSyntaxErrors(buildJsonState(doc))).toHaveLength(100);
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
    const READ_ONLY_FORMATTER_LANG = 'test-read-only-formatter-lang';
    const LATE_READ_ONLY_FORMATTER_LANG = 'test-late-read-only-formatter-lang';

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

    it('format() on a read-only editor runs no formatter, changes nothing, and signals the rejected edit', async () => {
        const formatter = vi.fn(async (source: string) => ({ formatted: source.toUpperCase(), cursorOffset: 0 }));

        registerLanguage({
            id: READ_ONLY_FORMATTER_LANG,
            loadExtension: async () => [] as any,
            loadFormatter: async () => formatter as Formatter,
        });

        const editor = new CodeEditor('lower', { language: READ_ONLY_FORMATTER_LANG, readOnly: true });
        const rejected = vi.fn();

        editor.on('readonlyedit', rejected);

        await editor.format();

        expect(formatter).not.toHaveBeenCalled();
        expect(editor.getValue()).toBe('lower');
        expect(rejected).toHaveBeenCalledOnce();
    });

    it('format() that resolves after the editor became read-only changes nothing and signals the rejected edit', async () => {
        const editor = new CodeEditor('lower', { language: LATE_READ_ONLY_FORMATTER_LANG });
        const rejected = vi.fn();

        registerLanguage({
            id: LATE_READ_ONLY_FORMATTER_LANG,
            loadExtension: async () => [] as any,
            loadFormatter: async () => async (source: string) => {
                // The host makes the editor read-only while the formatter runs.
                editor.setReadOnly(true);

                return { formatted: source.toUpperCase(), cursorOffset: 0 };
            },
        });

        editor.on('readonlyedit', rejected);

        await editor.format();

        expect(editor.getValue()).toBe('lower');
        expect(rejected).toHaveBeenCalledOnce();
    });

    it('format() on a read-only editor does not run the re-indent fallback either', async () => {
        const editor = new CodeEditor('x', { readOnly: true }) as any;
        const spy = vi.spyOn(editor, 'reindentFallback');
        const rejected = vi.fn();

        editor.on('readonlyedit', rejected);

        await editor.format();

        expect(spy).not.toHaveBeenCalled();
        expect(rejected).toHaveBeenCalledOnce();
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

describe('CodeEditor format() indentWidth default from tabSize', () => {
    const TAB_SIZE_DEFAULT_LANG = 'test-tabsize-default-lang';

    function registerRecordingFormatter(received: (FormatOptions | undefined)[]): void {
        const formatter: Formatter = async (source, _cursorOffset, options) => {
            received.push(options);

            return { formatted: source, cursorOffset: 0 };
        };

        registerLanguage({
            id: TAB_SIZE_DEFAULT_LANG,
            loadExtension: async () => [] as any,
            loadFormatter: async () => formatter,
        });
    }

    it('leaves options.indentWidth undefined when both options and tabSize are unset, unchanged from today', async () => {
        const received: (FormatOptions | undefined)[] = [];
        registerRecordingFormatter(received);

        const editor = new CodeEditor('x', { language: TAB_SIZE_DEFAULT_LANG });

        await editor.format();

        expect(received[0]).toBeUndefined();
    });

    it('an explicit options.indentWidth wins over tabSize, forwarded unchanged', async () => {
        const received: (FormatOptions | undefined)[] = [];
        registerRecordingFormatter(received);

        const editor  = new CodeEditor('x', { language: TAB_SIZE_DEFAULT_LANG, tabSize: 8 });
        const options: FormatOptions = { indentWidth: 2 };

        await editor.format(options);

        expect(received[0]).toEqual({ indentWidth: 2 });
        expect(received[0]).toBe(options);
    });

    it('defaults indentWidth from tabSize when format() is called with no options at all', async () => {
        const received: (FormatOptions | undefined)[] = [];
        registerRecordingFormatter(received);

        const editor = new CodeEditor('x', { language: TAB_SIZE_DEFAULT_LANG, tabSize: 4 });

        await editor.format();

        expect(received[0]).toEqual({ indentWidth: 4 });
    });

    it('preserves the rest of a partial options object alongside the injected default', async () => {
        const received: (FormatOptions | undefined)[] = [];
        registerRecordingFormatter(received);

        const editor  = new CodeEditor('x', { language: TAB_SIZE_DEFAULT_LANG, tabSize: 4 });
        const options: FormatOptions = { lineWidth: 100 };

        await editor.format(options);

        expect(received[0]).toEqual({ lineWidth: 100, indentWidth: 4 });
        expect(received[0]).not.toBe(options);
        expect(options).toEqual({ lineWidth: 100 }); // caller's object is not mutated
    });

    it('forwards an empty options object unchanged when tabSize is unset', async () => {
        const received: (FormatOptions | undefined)[] = [];
        registerRecordingFormatter(received);

        const editor  = new CodeEditor('x', { language: TAB_SIZE_DEFAULT_LANG });
        const options: FormatOptions = {};

        await editor.format(options);

        expect(received[0]).toBe(options);
    });
});

describe('sql-formatter cursor clamp', () => {
    it('clamps a cursor offset beyond the formatted length', async () => {
        const result = await formatWithSql('sql')('select 1', 1000);

        expect(result.cursorOffset).toBe(result.formatted.length);
    });

    it('preserves a cursor offset within the formatted length', async () => {
        const result = await formatWithSql('sql')('select 1', 0);

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
        const result = await formatWithSql('sql')(SOURCE, 0);

        expect(result.formatted).toBe('select\n  a\nfrom\n  b;');
    });

    it('applies keywordCase', async () => {
        const result = await formatWithSql('sql')(SOURCE, 0, { keywordCase: 'upper' });

        expect(result.formatted).toBe('SELECT\n  a\nFROM\n  b;');
    });

    it('applies indentWidth', async () => {
        const result = await formatWithSql('sql')(SOURCE, 0, { indentWidth: 4 });

        expect(result.formatted).toBe('select\n    a\nfrom\n    b;');
    });

    it('applies useTabs', async () => {
        const result = await formatWithSql('sql')(SOURCE, 0, { useTabs: true });

        expect(result.formatted).toBe('select\n\ta\nfrom\n\tb;');
    });

    it('ignores Prettier-only fields', async () => {
        const result = await formatWithSql('sql')(SOURCE, 0, {
            lineWidth:   120,
            singleQuote: true,
            proseWrap:   'always',
        });

        expect(result.formatted).toBe('select\n  a\nfrom\n  b;');
    });

    it('omits explicitly-undefined fields rather than forwarding them', async () => {
        const result = await formatWithSql('sql')(SOURCE, 0, { indentWidth: undefined, keywordCase: undefined });

        expect(result.formatted).toBe('select\n  a\nfrom\n  b;');
    });
});

/**
 * Collects every completion label the state's `autocomplete` language
 * data offers at the end of the document.
 *
 * @param state - The state to complete in.
 * @returns The labels from every completion source.
 */
async function completionLabels(state: EditorState): Promise<string[]> {
    const pos     = state.doc.length;
    const context = new CompletionContext(state, pos, true);
    const sources = state.languageDataAt<CompletionSource>('autocomplete', pos);
    const labels: string[] = [];

    for (const source of sources) {
        const result = await source(context);

        labels.push(...(result?.options.map((option) => option.label) ?? []));
    }

    return labels;
}

describe('built-in sql language options', () => {
    const PG_CONTAINS  = "SELECT * FROM t WHERE c @> '{}'::jsonb;";
    const PG_CONTAINED = "SELECT * FROM t WHERE c <@ '{}'::jsonb;";
    const PG_DOLLAR    = 'CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;';
    const PG_TAGGED    = 'CREATE OR REPLACE FUNCTION f() RETURNS int AS $function$ SELECT 1 $function$;';
    const PLAIN        = 'SELECT a, b FROM t WHERE a = 1;';
    const PG_SAMPLES   = [PG_CONTAINS, PG_CONTAINED, PG_DOLLAR, PG_TAGGED];

    /**
     * Builds a state on the built-in `"sql"` grammar loaded with `options`,
     * with its syntax tree fully parsed (see `buildJsonState`).
     *
     * @param doc - The document text.
     * @param options - The options passed to the `"sql"` `loadExtension`.
     * @returns A state whose `syntaxTree` covers the whole document.
     */
    async function buildSqlState(doc: string, options?: Record<string, unknown>): Promise<EditorState> {
        const extension = await getLanguage('sql')!.loadExtension(options);
        const state     = EditorState.create({ doc, extensions: [extension] });

        ensureSyntaxTree(state, state.doc.length, Infinity);

        return state.update({}).state;
    }

    it('reports no diagnostics for the PostgreSQL constructs under { dialect: "postgresql" }', async () => {
        for (const doc of PG_SAMPLES) {
            expect(collectSyntaxErrors(await buildSqlState(doc, { dialect: 'postgresql' }))).toEqual([]);
        }
    });

    it('reports diagnostics for the PostgreSQL constructs with no, empty or standard options', async () => {
        for (const options of [undefined, {}, { dialect: 'standard' }]) {
            for (const doc of PG_SAMPLES) {
                expect(collectSyntaxErrors(await buildSqlState(doc, options)).length).toBeGreaterThan(0);
            }
        }
    });

    it('reports no diagnostics for plain SQL under either dialect', async () => {
        expect(collectSyntaxErrors(await buildSqlState(PLAIN, { dialect: 'standard' }))).toEqual([]);
        expect(collectSyntaxErrors(await buildSqlState(PLAIN, { dialect: 'postgresql' }))).toEqual([]);
    });

    it('highlights a dollar-quoted body as a string only under postgresql', async () => {
        const doc = 'SELECT $$ BEGIN RETURN 1; END; $$;';
        // Offset 12 sits on "BEGIN", inside the $$ … $$ body.
        const pos = 12;

        const pg       = await buildSqlState(doc, { dialect: 'postgresql' });
        const standard = await buildSqlState(doc);

        expect(syntaxTree(pg).resolveInner(pos, 1).name).toBe('String');
        expect(syntaxTree(standard).resolveInner(pos, 1).name).not.toBe('String');
    });

    it('completes PostgreSQL type keywords only under postgresql', async () => {
        const pgLabels       = await completionLabels(await buildSqlState('SELECT jso', { dialect: 'postgresql' }));
        const standardLabels = await completionLabels(await buildSqlState('SELECT jso'));

        expect(pgLabels).toContain('jsonb');
        expect(standardLabels).not.toContain('jsonb');
    });

    it('loads a dialect-aware formatter', async () => {
        const pgFormatter       = await getLanguage('sql')!.loadFormatter!({ dialect: 'postgresql' });
        const standardFormatter = await getLanguage('sql')!.loadFormatter!();

        const result = await pgFormatter(PG_CONTAINS, 0);

        expect(result.formatted).toContain('@>');
        await expect(Promise.resolve().then(() => standardFormatter(PG_CONTAINS, 0))).rejects.toThrow();
    });

    it('falls back to standard for an unrecognised dialect, and ignores unknown keys', async () => {
        for (const options of [{ dialect: 'postgres' }, { dialect: 42 }, { dialect: 'toString' }]) {
            expect(collectSyntaxErrors(await buildSqlState(PG_CONTAINS, options)).length).toBeGreaterThan(0);
        }

        expect(collectSyntaxErrors(await buildSqlState(PG_CONTAINS, { dialect: 'postgresql', other: 1 }))).toEqual([]);
    });

    it('formatWithSql takes the sql-formatter language', async () => {
        await expect(formatWithSql('sql')(PG_CONTAINS, 0)).rejects.toThrow();
        await expect(formatWithSql('postgresql')(PG_DOLLAR, 0)).resolves.toBeDefined();

        const result = await formatWithSql('sql')('select a from b;', 0);

        expect(result.formatted).toBe('select\n  a\nfrom\n  b;');
    });
});

describe('CodeEditor keymap order', () => {
    afterEach(() => vi.restoreAllMocks());

    /**
     * Lists the commands bound to `key` in the order CodeMirror tries them,
     * with `language` loaded the way `CodeEditor` loads a language's
     * extension: into its language compartment.
     *
     * @param mounted - What `mountOffline` returned.
     * @param language - The stand-in language extension.
     * @param key - The key whose bindings are listed.
     * @returns The commands, first tried first.
     */
    function commandsFor(mounted: { editor: any; state: EditorState }, language: Extension, key: string): unknown[] {
        const loaded = mounted.state.update({ effects: mounted.editor._langCompartment.reconfigure(language) }).state;

        return loaded.facet(keymap).flat().filter((binding) => binding.key === key).map((binding) => binding.run);
    }

    it('K1: mount() installs codeEditorKeymap, and Backspace reaches deleteBracketPair first', () => {
        const { state } = mountOffline();
        const groups    = state.facet(keymap);
        const backspace = groups.flat().filter((binding) => binding.key === 'Backspace').map((binding) => binding.run);

        expect(groups).toContain(codeEditorKeymap);
        expect(backspace).toEqual([deleteBracketPair, deleteCharBackward]);
    });

    it('K2: every binding but indentWithTab comes from CodeMirror basicSetup, in its order', () => {
        const reference = EditorState.create({ extensions: basicSetup }).facet(keymap).flat();
        const shared    = codeEditorKeymap.filter((binding) => reference.includes(binding));

        expect(codeEditorKeymap.filter((binding) => !reference.includes(binding))).toEqual([indentWithTab]);
        expect(shared).toEqual(reference.filter((binding) => codeEditorKeymap.includes(binding)));
    });

    it('K3: the only basicSetup bindings the list leaves out are the completion and lint ones', () => {
        const reference = EditorState.create({ extensions: basicSetup }).facet(keymap).flat();
        const leftOut   = reference.filter((binding) => !codeEditorKeymap.includes(binding));

        expect(new Set(leftOut)).toEqual(new Set([...completionKeymap, ...lintKeymap]));
    });

    it('K4: a language keymap is tried after the editor\'s, ahead of it at Prec.high, and never ahead of the editor\'s own Mod-f and Escape', () => {
        const mounted     = mountOffline();
        const languageRun = (): boolean => false;

        const languageKeymap = keymap.of([
            { key: 'Backspace', run: languageRun },
            { key: 'Mod-f',     run: languageRun },
            { key: 'Escape',    run: languageRun },
        ]);

        expect(commandsFor(mounted, languageKeymap, 'Backspace')).toEqual([deleteBracketPair, deleteCharBackward, languageRun]);
        expect(commandsFor(mounted, Prec.high(languageKeymap), 'Backspace')).toEqual([languageRun, deleteBracketPair, deleteCharBackward]);

        // One command stays ahead: the editor's own Mod-f, itself at Prec.high.
        expect(commandsFor(mounted, Prec.high(languageKeymap), 'Mod-f').indexOf(languageRun)).toBe(1);
        // Two stay ahead: the completion list's Escape (Prec.highest), then the editor's own.
        expect(commandsFor(mounted, Prec.high(languageKeymap), 'Escape').indexOf(languageRun)).toBe(2);
    });
});

describe('built-in markdown language typing', () => {
    /**
     * The extensions from `CodeEditor`'s `mount()` that take part in typing,
     * in `mount()`'s order: the keymap (Enter, Backspace), `indentOnInput()`
     * (re-indents a line as it is typed) and `closeBrackets()`. The keymap is
     * `codeEditorKeymap`, the list `mount()` itself installs, so a change to
     * its order shows up in these rows. The language's own extension follows
     * them, as in `mount()`; `buildTypingState` adds it per state.
     * `autocompletion()` is left out: completion needs a mounted view, and no
     * row presses Enter while a popup would be open.
     */
    const TYPING_EXTENSIONS: Extension[] = [
        keymap.of(codeEditorKeymap),
        indentOnInput(),
        closeBrackets(),
    ];

    /**
     * Builds a state on a built-in language plus the typing extensions.
     *
     * @param languageId - The built-in language id to load.
     * @param doc - The document text. A `|` marks the caret and is not part of the text; with none, the caret is at the end.
     * @param tabSize - The editor's `tabSize`, set the way `CodeEditor` sets it; CodeMirror's defaults when omitted.
     * @returns A state ready to be typed into with `typeText`.
     */
    async function buildTypingState(languageId: string, doc: string, tabSize?: number): Promise<EditorState> {
        const extension = await getLanguage(languageId)!.loadExtension();
        const marker    = doc.indexOf('|');
        const text      = marker < 0 ? doc : doc.slice(0, marker) + doc.slice(marker + 1);
        const tabs      = tabSize === undefined ? [] : [EditorState.tabSize.of(tabSize), indentUnit.of(' '.repeat(tabSize))];

        return EditorState.create({
            doc:        text,
            selection:  EditorSelection.cursor(marker < 0 ? text.length : marker),
            extensions: [...TYPING_EXTENSIONS, ...tabs, extension],
        });
    }

    /**
     * Parses the whole document, so the input handlers and indentation rules
     * that read the syntax tree see a complete one (see `buildSqlState`).
     *
     * @param state - The state to parse.
     * @returns A state whose `syntaxTree` covers the whole document.
     */
    function settle(state: EditorState): EditorState {
        ensureSyntaxTree(state, state.doc.length, Infinity);

        return state.update({}).state;
    }

    /**
     * Presses a key the way CodeMirror's keymap handling does: walks the
     * `keymap` facet's binding groups, highest precedence first, and runs each
     * binding for the key until one handles it.
     *
     * @param state - The state the key is pressed in.
     * @param key - The key to press.
     * @returns The state the handling command dispatched, or `state` when no binding handled the key.
     */
    function pressKey(state: EditorState, key: 'Enter' | 'Backspace'): EditorState {
        let next: EditorState = state;

        const view = {
            state,
            dispatch: (transaction: Transaction): void => {
                next = transaction.state;
            },
        } as unknown as EditorView;

        for (const bindings of state.facet(keymap)) {
            for (const binding of bindings) {
                if (binding.key !== key || !binding.run) {
                    continue;
                }

                const handled = binding.run(view);

                if (handled) {
                    return next;
                }
            }
        }

        return next;
    }

    /**
     * Types one character the way CodeMirror's input handling does: offers it
     * to each `EditorView.inputHandler` in turn, and inserts it plainly when
     * none takes it. The handlers involved (`autoCloseTags`, `closeBrackets`)
     * read only the stubbed view fields.
     *
     * @param state - The state the character is typed in.
     * @param char - The character to type.
     * @returns The state after the character.
     */
    function typeCharacter(state: EditorState, char: string): EditorState {
        const { from, to } = state.selection.main;
        let next: EditorState = state;

        const insert = (): Transaction => state.update({
            changes:   { from, to, insert: char },
            selection: EditorSelection.cursor(from + 1),
            userEvent: 'input.type',
        });

        const view = {
            state,
            composing:          false,
            compositionStarted: false,
            // `autoCloseTags` dispatches its two transactions as one array;
            // the last one carries the resulting state.
            dispatch: (...transactions: (Transaction | readonly Transaction[])[]): void => {
                const flattened = transactions.flat();

                next = flattened[flattened.length - 1].state;
            },
        } as unknown as EditorView;

        for (const handler of state.facet(EditorView.inputHandler)) {
            const handled = handler(view, from, to, char, insert);

            if (handled) {
                return next;
            }
        }

        return insert().state;
    }

    /**
     * Types `text` one character at a time, settling the syntax tree before
     * each. `"\n"` presses Enter and `"\b"` presses Backspace.
     *
     * @param state - The state to type in.
     * @param text - The keys to type.
     * @returns The state after the last key.
     */
    function typeText(state: EditorState, text: string): EditorState {
        let current = state;

        for (const char of text) {
            current = settle(current);

            if (char === '\n') {
                current = pressKey(current, 'Enter');
            } else if (char === '\b') {
                current = pressKey(current, 'Backspace');
            } else {
                current = typeCharacter(current, char);
            }
        }

        return current;
    }

    /**
     * Renders a state as its document with `|` at the main caret.
     *
     * @param state - The state to render.
     * @returns The document text with the caret marked.
     */
    function show(state: EditorState): string {
        const caret = state.selection.main.head;
        const doc   = state.doc.toString();

        return doc.slice(0, caret) + '|' + doc.slice(caret);
    }

    /**
     * Types `keys` at the caret of `startDoc` on a built-in language.
     *
     * @param languageId - The built-in language id to type in.
     * @param startDoc - The document before typing, with the caret as `buildTypingState` reads it.
     * @param keys - The keys to type (see `typeText`).
     * @param tabSize - The editor's `tabSize` (see `buildTypingState`).
     * @returns The resulting document with `|` at the caret.
     */
    async function typed(languageId: string, startDoc: string, keys: string, tabSize?: number): Promise<string> {
        const state = await buildTypingState(languageId, startDoc, tabSize);

        return show(typeText(state, keys));
    }

    it('M1: types an HTML block around a ::: line exactly as written', async () => {
        expect(await typed('markdown', '', '<div>\n:::\n</div>')).toBe('<div>\n:::\n</div>|');
    });

    it('M2: types a <details> block with blank lines exactly as written', async () => {
        const keys = '<details>\n<summary>S</summary>\n\nBody\n\n</details>';

        expect(await typed('markdown', '', keys)).toBe(keys + '|');
    });

    it('M3: does not complete a close tag when "</" is typed in an open element', async () => {
        expect(await typed('markdown', '<div>\nfoo\n', '</')).toBe('<div>\nfoo\n</|');
    });

    it('M4: types a close tag for an open element exactly as written', async () => {
        expect(await typed('markdown', '<div>\nfoo\n', '</div>')).toBe('<div>\nfoo\n</div>|');
    });

    it('M5: Enter after an open tag does not indent the next line', async () => {
        expect(await typed('markdown', '<div>', '\n')).toBe('<div>\n|');
    });

    it('M6: Enter on an indented line keeps its indentation, and a typed close tag stays there', async () => {
        expect(await typed('markdown', '<div>\n  foo', '\n</div>')).toBe('<div>\n  foo\n  </div>|');
    });

    it('M7: types "</" in a paragraph exactly as written', async () => {
        expect(await typed('markdown', '', 'text </')).toBe('text </|');
    });

    it('M8: Enter continues a bullet list', async () => {
        expect(await typed('markdown', '', '- item\n')).toBe('- item\n- |');
    });

    it('M9: Enter continues an ordered list', async () => {
        expect(await typed('markdown', '', '1. one\n')).toBe('1. one\n2. |');
    });

    it('M10: Enter continues a blockquote', async () => {
        expect(await typed('markdown', '', '> quote\n')).toBe('> quote\n> |');
    });

    it('M11: Enter in a fenced code block keeps the line indentation', async () => {
        expect(await typed('markdown', '```\n  code', '\n')).toBe('```\n  code\n  |');
    });

    it('M12: Enter after an open tag on a list item first line continues the list', async () => {
        expect(await typed('markdown', '', '- <div>\n')).toBe('- <div>\n- |');
    });

    it('M13: Enter after an open tag on a list item continuation line keeps the item indentation', async () => {
        expect(await typed('markdown', '- a\n  <div>', '\n')).toBe('- a\n  <div>\n  |');
    });

    it('M14: Backspace turns the continued marker into indentation, keeping an HTML block in the item', async () => {
        expect(await typed('markdown', '', '- <div>\n\b:::\n</div>')).toBe('- <div>\n  :::\n  </div>|');
    });

    it('M15: still parses HTML inside Markdown, so it is still highlighted', async () => {
        const state = settle(await buildTypingState('markdown', '<div>\n:::\n</div>'));

        // Offset 2 sits on the "div" of the opening tag.
        expect(syntaxTree(state).resolveInner(2, 1).name).toBe('TagName');
    });

    it('M16: still offers HTML tag completion', async () => {
        const labels = await completionLabels(settle(await buildTypingState('markdown', '<di')));

        expect(labels).toContain('<div');
    });

    it('M17: Enter after an open tag in a blockquote continues the quote', async () => {
        expect(await typed('markdown', '> <div>', '\n:::')).toBe('> <div>\n> :::|');
    });

    it('M18: still offers the HTML language completion inside an HTML block', async () => {
        const labels = await completionLabels(settle(await buildTypingState('markdown', '<div>\n<sp')));

        expect(labels).toContain('span');
    });

    it('M19: Enter between an adjacent open and close tag puts the close tag on its own line, unindented', async () => {
        expect(await typed('markdown', '<div>|</div>', '\n')).toBe('<div>\n|\n</div>');
    });

    it('M20: Enter after an open tag on a bullet item marker line indents to the item content', async () => {
        expect(await typed('markdown', '- <div>|\n  x\n  </div>', '\n')).toBe('- <div>\n  |\n  x\n  </div>');
    });

    it('M21: Enter after an open tag on an ordered item marker line indents to the item content', async () => {
        expect(await typed('markdown', '1. <div>|\n   x\n   </div>', '\n')).toBe('1. <div>\n   |\n   x\n   </div>');
    });

    it('M22: Enter after an open tag on a nested item marker line indents to the nested item content', async () => {
        const start = '- a\n  - <div>|\n    x\n    </div>';

        expect(await typed('markdown', start, '\n')).toBe('- a\n  - <div>\n    |\n    x\n    </div>');
    });

    it('M23: Enter inside an HTML block on an item continuation line keeps the line indentation', async () => {
        expect(await typed('markdown', '- a\n  <div>|\n  x\n  </div>', '\n')).toBe('- a\n  <div>\n  |\n  x\n  </div>');
    });

    it('M24: Enter inside a top-level HTML block does not indent the next line', async () => {
        expect(await typed('markdown', '<div>|\nx\n</div>', '\n')).toBe('<div>\n|\nx\n</div>');
    });

    it('M25: a close tag typed on a deeper-indented line in a list item stays there', async () => {
        const start = '- <div>\n      foo\n      |\n  x';

        expect(await typed('markdown', start, '</div>')).toBe('- <div>\n      foo\n      </div>|\n  x');
    });

    it('M26: Enter on an item marker line inside a blockquote keeps the quote and indents to the item content', async () => {
        expect(await typed('markdown', '> - <div>|\n>   x\n>   </div>', '\n')).toBe('> - <div>\n>   |\n>   x\n>   </div>');
    });

    it('M27: JavaScript inside <script> keeps its own indentation', async () => {
        expect(await typed('markdown', '<script>\nfunction f() {', '\n')).toBe('<script>\nfunction f() {\n  |');
    });

    it('M28: a close tag with no open tag is still an ordinary close tag, not a mismatched one', async () => {
        const state = settle(await buildTypingState('markdown', 'foo </span> bar'));

        // Offset 6 sits on the "span" of the close tag. markdown() parses each
        // inline tag on its own, so tag matching is off (the "noMatch" dialect).
        expect(syntaxTree(state).resolveInner(6, 1).parent?.name).toBe('CloseTag');
    });

    // M29–M31 start on an indented line: at column 0 they could not tell
    // "keep the line's indentation" from "indent to column 0".
    it('M29: Enter inside an open tag keeps the line indentation', async () => {
        expect(await typed('markdown', '  <div class="a"', '\n')).toBe('  <div class="a"\n  |');
    });

    it('M30: Enter inside a close tag keeps the line indentation', async () => {
        expect(await typed('markdown', '  <div>\n  x\n  </div', '\n')).toBe('  <div>\n  x\n  </div\n  |');
    });

    it('M31: Enter inside a self-closing tag keeps the line indentation', async () => {
        expect(await typed('markdown', '  <img src="a"|/>', '\n')).toBe('  <img src="a"\n  |/>');
    });

    it('M32: Enter between adjacent tags on an item marker line keeps the close tag in the item', async () => {
        expect(await typed('markdown', '- <div>|</div>', '\n')).toBe('- <div>\n  |\n  </div>');
    });

    it('M33: Enter inside an HTML block in a blockquote continues the quote marker', async () => {
        expect(await typed('markdown', '> <div>|\n> x', '\n')).toBe('> <div>\n> |\n> x');
    });

    // Markdown reads a tab as a stop at every fourth column, whatever the
    // editor shows it as: the nested item's content is at column 6 here. With
    // HTML below the caret the new line copies the marker line's own start,
    // the tab and two spaces for the marker, which is that column at any
    // tabSize.
    for (const tabSize of [2, 4, 8]) {
        it(`M34: Enter on a tab-indented nested item marker line indents to the item content with tabSize ${tabSize}`, async () => {
            const start = '- a\n\t- <div>|\n      x\n      </div>';

            expect(await typed('markdown', start, '\n', tabSize)).toBe('- a\n\t- <div>\n\t  |\n      x\n      </div>');
        });
    }

    // A tab reaches the next stop from wherever it starts, so one that starts off a stop is narrower
    // than four columns: after one space it is three wide, and after a marker at column 0 too. M36
    // copies its tab with the rest of the line's start. M37 has no HTML below the caret, so Markdown's
    // own Enter continues the list, the new marker's spaces reaching the column the tab reaches; it
    // alone tells that from a tab counted as four columns wherever it stands.
    for (const tabSize of [2, 4, 8]) {
        it(`M36: Enter on a marker line indented by a space and a tab indents to the item content with tabSize ${tabSize}`, async () => {
            // The space is column 0, the tab runs to column 4, the marker and its space to column 6.
            const start = '- a\n \t- <div>|\n      x\n      </div>';

            expect(await typed('markdown', start, '\n', tabSize)).toBe('- a\n \t- <div>\n \t  |\n      x\n      </div>');
        });

        it(`M37: Enter on a marker line whose marker is followed by a tab continues the list with tabSize ${tabSize}`, async () => {
            // The marker is column 0 and the tab runs from column 1 to column 4, where the content starts.
            expect(await typed('markdown', '-\t<div>|', '\n', tabSize)).toBe('-\t<div>\n-   |');
        });
    }

    /** A syntax tree node, as far as an outline reads it. */
    interface OutlineNode { readonly name: string; readonly firstChild: OutlineNode | null; readonly nextSibling: OutlineNode | null }

    /** The Markdown block nodes an outline names, and the name it gives each. Headings are matched apart. */
    const BLOCK_NAMES: Readonly<Record<string, string>> = {
        Paragraph: 'p', Blockquote: 'quote', BulletList: 'ul', OrderedList: 'ol', ListItem: 'li',
        CodeBlock: 'code', FencedCode: 'code', HTMLBlock: 'raw', HorizontalRule: 'raw',
    };

    /** The outline names that hold no blocks. */
    const LEAF_NAMES: ReadonlySet<string> = new Set(['p', 'code', 'raw']);

    /**
     * Writes the Markdown blocks under a syntax node as one line, in the round-trip harness's outline form without
     * text: `ul[li[p ul[li[p]]]]`.
     *
     * @param node - The document node, or a block that holds blocks.
     * @returns The outline of its blocks.
     */
    function treeOutline(node: OutlineNode): string {
        const parts: string[] = [];

        for (let child = node.firstChild; child !== null; child = child.nextSibling) {
            const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(child.name);
            const name = heading === null ? BLOCK_NAMES[child.name] : `h${heading[1]}`;

            if (name === undefined) {
                continue;
            }

            const isLeaf = heading !== null || LEAF_NAMES.has(name);

            parts.push(isLeaf ? name : `${name}[${treeOutline(child)}]`);
        }

        return parts.join(' ');
    }

    /**
     * Reads the block outline the built-in `"markdown"` language gives a document.
     *
     * @param doc - The document.
     * @returns The outline of its syntax tree.
     */
    async function languageOutline(doc: string): Promise<string> {
        const state = settle(await buildTypingState('markdown', doc));

        return treeOutline(syntaxTree(state).topNode as unknown as OutlineNode);
    }

    /**
     * Lists the syntax nodes the built-in `"markdown"` language gives a document, as `Name[from,to]`.
     *
     * @param doc - The document.
     * @returns Every node, in tree order, joined by spaces.
     */
    async function syntaxNodes(doc: string): Promise<string> {
        const state = settle(await buildTypingState('markdown', doc));
        const nodes: string[] = [];

        syntaxTree(state).iterate({ enter: (node) => { nodes.push(`${node.name}[${node.from},${node.to}]`); } });

        return nodes.join(' ');
    }

    /**
     * Lists the lines of a document that the built-in `"markdown"` language can fold, and what each folds.
     *
     * @param doc - The document.
     * @returns One `line:from-to` entry per foldable line.
     */
    async function foldableLines(doc: string): Promise<string[]> {
        const state = settle(await buildTypingState('markdown', doc));
        const folds: string[] = [];

        for (let number = 1; number <= state.doc.lines; number++) {
            const line = state.doc.line(number);
            const range = foldable(state, line.from, line.to);

            if (range !== null) {
                folds.push(`${number}:${range.from}-${range.to}`);
            }
        }

        return folds;
    }

    /** Markdown's tab stop, in columns (CommonMark §2.2), as `MARKDOWN_TAB_STOP` in `markdownTabs.ts`. */
    const MARKDOWN_TAB_STOP = 4;

    /**
     * Writes every tab of a document as the spaces that reach its tab stop, counted from its line's start.
     *
     * @param doc - The document.
     * @returns The document without tabs.
     */
    function withTabsAsSpaces(doc: string): string {
        return doc.split('\n').map((line) => {
            let spaced = '';

            for (const char of line) {
                spaced += char === '\t' ? ' '.repeat(MARKDOWN_TAB_STOP - (spaced.length % MARKDOWN_TAB_STOP)) : char;
            }

            return spaced;
        }).join('\n');
    }

    it('TAB1: a tab after two spaces continues an item as a paragraph', async () => {
        expect(await languageOutline('- a\n\n  \tb')).toBe('ul[li[p p]]');
    });

    it('TAB2: a nested item after a space and a tab holds a six-space line', async () => {
        expect(await languageOutline('- a\n \t- b\n\n      x')).toBe('ul[li[p ul[li[p p]]]]');
    });

    it('TAB3: a tab after a nested marker counts from the line start', async () => {
        expect(await languageOutline('- a\n  -\tb\n\n\tx')).toBe('ul[li[p ul[li[p p]]]]');
    });

    it('TAB4: three levels of items written with tabs', async () => {
        expect(await languageOutline('-\ta\n\t-\tb\n\t\t-\tc')).toBe('ul[li[p ul[li[p ul[li[p]]]]]]');
    });

    it('TAB5: a tab after a quote marker and a space is not code', async () => {
        expect(await languageOutline('> \tfoo')).toBe('quote[p]');
    });

    it('TAB6: two tabs after a quote marker are code', async () => {
        expect(await languageOutline('>\t\tfoo')).toBe('quote[code]');
    });

    it('TAB7: a tab after one space indents a code line', async () => {
        expect(await languageOutline(' \tfoo')).toBe('code');
    });

    // TAB8–TAB34: a tab after a heading's # run, or after a quote's >, reads as the viewer reads it (markdown-source-mode-tab-highlighting).
    it('TAB8: a tab after the # run makes a heading', async () => {
        expect(await languageOutline('#\tFoo')).toBe('h1');
    });

    it('TAB9: a tab after a later quote marker nests an item under the item above', async () => {
        expect(await languageOutline('> - a\n>\t- b')).toBe('quote[ul[li[p ul[li[p]]]]]');
    });

    it('TAB10: a tab after a later quote marker continues the item above', async () => {
        expect(await languageOutline('> - a\n>\n>\tb')).toBe('quote[ul[li[p p]]]');
    });

    it('TAB11: a line after a blank quoted line stays in an ordered item', async () => {
        expect(await languageOutline('>\t1. a\n>\n>\t   b')).toBe('quote[ol[li[p p]]]');
    });

    it('TAB12: a heading after a tab ends a paragraph', async () => {
        expect(await languageOutline('a\n#\tb\nc')).toBe('p h1 p');
    });

    it('TAB13: a heading after a tab in a list item', async () => {
        expect(await languageOutline('- #\th')).toBe('ul[li[h1]]');
    });

    it('TAB14: a heading after a tab in a quote', async () => {
        expect(await languageOutline('> #\th')).toBe('quote[h1]');
    });

    it('TAB15: a heading after two tabs, with a closing run', async () => {
        expect(await languageOutline('##\t\tFoo ##')).toBe('h2');
    });

    it('TAB16: an empty heading after a tab', async () => {
        expect(await languageOutline('#\t')).toBe('h1');
    });

    it('TAB17: seven # and a tab are text', async () => {
        expect(await languageOutline('#######\tx')).toBe('p');
    });

    it('TAB18: a heading after a tab indented by four spaces is code', async () => {
        expect(await languageOutline('    #\tx')).toBe('code');
    });

    it("TAB19: a tab after the first quote marker leaves the item's content at column 6", async () => {
        expect(await languageOutline('>\t- a\n>\n>     b')).toBe('quote[ul[li[p p]]]');
    });

    it('TAB20: a tab after a later quote marker and two spaces start code', async () => {
        expect(await languageOutline('> x\n>\n>\t  code')).toBe('quote[p code]');
    });

    it('TAB21: a one-column tab after a quote marker is its space', async () => {
        expect(await languageOutline('  >\t- a\n  >\t  b')).toBe('quote[ul[li[p]]]');
    });

    it('HR1: a thematic break is a HorizontalRule node, which the editor theme mutes', async () => {
        expect(await syntaxNodes('a\n\n---\n\nb')).toContain('HorizontalRule[3,6]');
    });

    // A task item's marker is tagged as list markup, which the editor theme mutes as it does `-`; the leaf test is
    // `marked`'s, which wants a non-blank character after the blanks (lezer's own wants any blank).
    it('TM1: task markers that open a task item are TaskMarker nodes, and other brackets are not', async () => {
        const nodes = await syntaxNodes('- [ ] a\n- [x] b\n- [ ]\n- [ ]\tc\n- \\[ ] d');

        expect(nodes).toContain('TaskMarker[2,5]');
        expect(nodes).toContain('TaskMarker[10,13]');
        expect(nodes).toContain('TaskMarker[24,27]');
        expect(nodes.match(/Task\[/g)).toHaveLength(3);
        expect(nodes).not.toContain('TaskMarker[16,19]');
    });

    it('TM3: a marker at the start of a later paragraph of an item is no task marker, as the viewer reads it', async () => {
        expect(await syntaxNodes('- a\n\n  [ ] b')).not.toContain('Task');
        expect(await syntaxNodes('- a\n\n  [ ] b')).not.toContain('TaskMarker');
    });

    it.each([
        ['a second paragraph after a task item\'s first', '- [ ] a\n\n  [x] b', 'TaskMarker[2,5]'],
        ['a nested item', '- a\n  - [ ] b', 'TaskMarker[8,11]'],
        ['a quote', '> - [ ] q', 'TaskMarker[4,7]'],
        ['an ordered item', '1. [x] a', 'TaskMarker[3,6]'],
    ])('TM4: the first block of an item still takes its marker: %s', async (_name, doc, node) => {
        expect(await syntaxNodes(doc)).toContain(node);
    });

    it('TM5: only the first block of a task item takes a marker', async () => {
        expect(await syntaxNodes('- [ ] a\n\n  [x] b')).not.toContain('TaskMarker[11,14]');
    });

    it('TM2: brackets in a paragraph are no task marker', async () => {
        expect(await syntaxNodes('a [ ] b')).not.toContain('Task');
    });

    it('TAB22: a heading after a tab has the nodes of a heading after a space', async () => {
        expect(await syntaxNodes('#\tFoo *b* #')).toBe(await syntaxNodes('# Foo *b* #'));
    });

    it('TAB23: a heading after a tab folds its section', async () => {
        expect(await foldableLines('#\tA\ntext\n#\tB\nmore')).toEqual(['1:3-8', '3:12-17']);
    });

    // A leading `|` in a FOLD document marks the caret for `buildTypingState` and is not part of the text.
    it('FOLD1: a fence folds from its opening line to the line before its closing line', async () => {
        expect(await foldableLines('::: x\na\nb\n:::')).toEqual(['1:5-9', '2:7-9']);
    });

    it('FOLD2: a fence whose sections start with tables folds the fence and each table', async () => {
        expect(await foldableLines('|::: columns\n| a |\n| - |\n| 1 |\n|||\n| b |\n| - |\n:::')).toEqual(['1:11-45', '2:17-29', '6:39-45']);
    });

    it('FOLD3: a nested fence folds on its own and the outer fence folds past it', async () => {
        expect(await foldableLines('::: a\n::: b\nx\ny\n:::\n:::')).toEqual(['1:5-19', '2:11-15', '3:13-15']);
    });

    it('FOLD4: a fence in a quote folds inside the quote', async () => {
        expect(await foldableLines('> ::: x\n> a\n> b\n> :::')).toEqual(['1:7-15', '2:11-15']);
    });

    it('FOLD5: a fence in a list item folds inside the item', async () => {
        expect(await foldableLines('- ::: x\n  a\n  b\n  :::')).toEqual(['1:7-15', '2:11-15']);
    });

    it('FOLD6: a fence with no closing line folds to the end of its container', async () => {
        expect(await foldableLines('::: x\na\nb')).toEqual(['1:5-9', '2:7-9']);
        expect(await foldableLines('> ::: x\n> a\n> b\n\nc')).toEqual(['1:7-15', '2:11-15']);
    });

    it('FOLD7: a closing line and an empty fence fold nothing', async () => {
        expect(await foldableLines(':::\n::: x\n:::')).toEqual([]);
    });

    it('FOLD8: a table folds below its first line', async () => {
        expect(await foldableLines('|| a | b |\n| - | - |\n| 1 | 2 |')).toEqual(['1:9-29']);
    });

    it('TAB24: Enter after an item in a quote opened by a tab starts the next item', async () => {
        expect(await typed('markdown', '>\t- a|', '\n')).toBe('>\t- a\n>   - |');
    });

    it('TAB25: Enter after an ordered item in a quote opened by a tab numbers the next', async () => {
        expect(await typed('markdown', '>\t1. a|', '\n')).toBe('>\t1. a\n>   2. |');
    });

    it("TAB26: Enter on an item's later paragraph in a quote keeps the item's column", async () => {
        expect(await typed('markdown', '>\t1. a\n>\n>\t   b|', '\n')).toBe('>\t1. a\n>\n>\t   b\n>      |');
    });

    it('TAB27: Enter on a quoted code line opened by a tab copies its prefix', async () => {
        expect(await typed('markdown', '> x\n>\n>\t  code|', '\n')).toBe('> x\n>\n>\t  code\n>\t  |');
    });

    it('TAB28: Enter after a nested item in a quote starts a nested item', async () => {
        expect(await typed('markdown', '> - a\n>\t- b|', '\n')).toBe('> - a\n>\t- b\n>   - |');
    });

    it("TAB29: Backspace after an empty item's marker in a quote removes the marker", async () => {
        expect(await typed('markdown', '>\t- |', '\b')).toBe('> |');
    });

    it("TAB30: Backspace after an empty nested item's marker in a quote removes the marker", async () => {
        expect(await typed('markdown', '> - a\n>\t- |', '\b')).toBe('> - a\n>\t|');
    });

    it("TAB31: Enter on an item's later paragraph after a tab stays in the quote and the item", async () => {
        expect(await typed('markdown', '> - a\n>\n>\tb|', '\n')).toBe('> - a\n>\n>\tb\n>   |');
    });

    it('TAB32: Enter on an empty nested item after a tab lifts it to the outer list', async () => {
        expect(await typed('markdown', '> - a\n>\t- |', '\n')).toBe('> - a\n> - |');
    });

    // TAB35 and TAB36: @codemirror/lang-markdown's Enter declines on both, as it does on the same documents written
    // with spaces, so the editor's plain Enter keeps the line's indentation.
    it("TAB35: Enter on a line of text under an item opened after a quote's tab keeps the line's indentation", async () => {
        expect(await typed('markdown', '   >\t-\tx\n\t---|', '\n')).toBe('   >\t-\tx\n\t---\n    |');
    });

    it("TAB36: Enter after a task item under a quote opened by a tab keeps the line's indentation", async () => {
        expect(await typed('markdown', '   >\t- x\n    1. [ ] |', '\n')).toBe('   >\t- x\n    1. [ ] \n    |');
    });

    // Green on the base and after this plan. It checks that this language's parser changes no other: the stock
    // commonmarkLanguage still reads both documents its own way. Red means @lezer/markdown changed that reading:
    // markdownTabStops.ts may then be partly or wholly unneeded.
    it('TAB33: the stock commonmarkLanguage keeps its own readings', async () => {
        await getLanguage('markdown')!.loadExtension();

        const outline = (doc: string): string => treeOutline(commonmarkLanguage.parser.parse(doc).topNode as unknown as OutlineNode);

        expect(outline('> - a\n>\t- b')).toBe('quote[ul[li[p] li[p]]]');
        expect(outline('#\tFoo')).toBe('p');
    });

    it('TAB34: every drawn tab document reads as the same document with its tabs written as spaces', async () => {
        const differing: string[] = [];

        for (const doc of tabDocuments(3_000)) {
            const reading = await languageOutline(doc);
            const spacedReading = await languageOutline(withTabsAsSpaces(doc));

            if (reading !== spacedReading) {
                differing.push(JSON.stringify(doc));
            }
        }

        expect(differing).toEqual([]);
    });

    it('M35: Enter between two tags on an item marker line indents the rest of the line to the item content', async () => {
        expect(await typed('markdown', '- <div>|<p>x</p>', '\n')).toBe('- <div>\n  |<p>x</p>');
    });

    // Rows C1–C42: Enter inside HTML that sits in a blockquote or list item.
    // The new line starts with the caret line's own prefix (its `>` markers
    // and its indentation, a list marker replaced by spaces), so it stays in
    // the same containers. M26, M32 and M33 above belong to the same set.
    it('C1: text typed after Enter inside an HTML block in a blockquote lands in the quote', async () => {
        expect(await typed('markdown', '> <div>|\n> x', '\n:::')).toBe('> <div>\n> :::|\n> x');
    });

    it('C2: Enter in the middle of a quoted HTML line drops the spaces after the caret', async () => {
        expect(await typed('markdown', '> <div>foo| bar\n> x', '\n')).toBe('> <div>foo\n> |bar\n> x');
    });

    it('C3: Enter on a deeper-indented quoted HTML line keeps that indentation after the marker', async () => {
        const start = '>   <div>\n>     foo|\n>   </div>';

        expect(await typed('markdown', start, '\n')).toBe('>   <div>\n>     foo\n>     |\n>   </div>');
    });

    it('C4: Enter copies a quote marker with no space after it as written', async () => {
        expect(await typed('markdown', '><div>|\n>x', '\n')).toBe('><div>\n>|\n>x');
    });

    it('C5: Enter inside an HTML block in a nested blockquote keeps both markers', async () => {
        expect(await typed('markdown', '> > <div>|\n> > x', '\n')).toBe('> > <div>\n> > |\n> > x');
    });

    it('C6: Enter after a close tag keeps the quote while the block continues below', async () => {
        const start = '> <div>\n> x\n> </div>|\n> after';

        expect(await typed('markdown', start, '\n')).toBe('> <div>\n> x\n> </div>\n> |\n> after');
    });

    it('C7: Enter on the marker line of an item holding a blockquote blanks the list marker and keeps the quote marker', async () => {
        expect(await typed('markdown', '- > <div>|\n  > x', '\n')).toBe('- > <div>\n  > |\n  > x');
    });

    it('C8: Enter on a continuation line of an item inside a blockquote copies the line prefix', async () => {
        const start = '> - <div>\n>   x|\n>   </div>';

        expect(await typed('markdown', start, '\n')).toBe('> - <div>\n>   x\n>   |\n>   </div>');
    });

    it('C9: Enter on an ordered item marker line inside a blockquote blanks the whole marker', async () => {
        expect(await typed('markdown', '> 1. <div>|\n>    x', '\n')).toBe('> 1. <div>\n>    |\n>    x');
    });

    it('C10: Enter keeps three levels of containers', async () => {
        expect(await typed('markdown', '> - > <div>|\n>   > x', '\n')).toBe('> - > <div>\n>   > |\n>   > x');
    });

    it('C11: Enter between adjacent tags in a blockquote gives both new lines the quote marker', async () => {
        expect(await typed('markdown', '> <div>|</div>', '\n')).toBe('> <div>\n> |\n> </div>');
    });

    it('C12: Enter between adjacent tags on an item marker line inside a blockquote keeps both new lines in the item', async () => {
        expect(await typed('markdown', '> - <div>|</div>', '\n')).toBe('> - <div>\n>   |\n>   </div>');
    });

    it('C13: Enter between adjacent tags on a nested item marker line keeps the close tag in the nested item', async () => {
        expect(await typed('markdown', '- a\n  - <div>|</div>', '\n')).toBe('- a\n  - <div>\n    |\n    </div>');
    });

    it('C14: Enter on a tab-indented nested item marker line copies the tab', async () => {
        expect(await typed('markdown', '- a\n\t- <div>|\n\t  x', '\n')).toBe('- a\n\t- <div>\n\t  |\n\t  x');
    });

    it('C15: Enter on a tab-indented nested item marker line gives the same text at tab size 8', async () => {
        expect(await typed('markdown', '- a\n\t- <div>|\n\t  x', '\n', 8)).toBe('- a\n\t- <div>\n\t  |\n\t  x');
    });

    it('C16: Enter on an item marker line with a tab after the marker keeps the tab', async () => {
        expect(await typed('markdown', '-\t<div>|\n\tx', '\n')).toBe('-\t<div>\n \t|\n\tx');
    });

    it('C17: Enter on a tab-indented item continuation line copies the tab at tab size 2', async () => {
        const start = '1. a\n\t<div>|\n\tx\n\t</div>';

        expect(await typed('markdown', start, '\n', 2)).toBe('1. a\n\t<div>\n\t|\n\tx\n\t</div>');
    });

    it('C18: Enter inside an HTML block in a blockquote copies a tab after the quote marker', async () => {
        expect(await typed('markdown', '>\t<div>|\n>\tx', '\n')).toBe('>\t<div>\n>\t|\n>\tx');
    });

    it('C19: text that only looks like a marker inside an HTML block is not copied', async () => {
        const start = '- <pre>\n  > not a quote|\n  - not a list\n  </pre>';

        expect(await typed('markdown', start, '\n')).toBe('- <pre>\n  > not a quote\n  |\n  - not a list\n  </pre>');
    });

    it('C20: Enter in the indentation of an item continuation line keeps the line indented', async () => {
        expect(await typed('markdown', '- <div>\n|  x\n  </div>', '\n')).toBe('- <div>\n\n  |x\n  </div>');
    });

    it('C21: Enter between a quote marker and deeper-indented HTML keeps the indentation on the new line', async () => {
        expect(await typed('markdown', '> <div>\n> |  x', '\n')).toBe('> <div>\n> \n>   |x');
    });

    it('C22: Enter in front of a quote marker on its line leaves the line as it is', async () => {
        expect(await typed('markdown', '- > <div>\n|  > x\n  > </div>', '\n')).toBe('- > <div>\n\n  |> x\n  > </div>');
    });

    it('C23: repeated Enter inside an open HTML block in a blockquote never drops the quote marker', async () => {
        expect(await typed('markdown', '> <pre>|\n> x\n> </pre>', '\n\n\n')).toBe('> <pre>\n> \n> \n> |\n> x\n> </pre>');
    });

    it('C24: repeated Enter inside an open HTML block in a list item never drops the indentation', async () => {
        expect(await typed('markdown', '- <pre>|\n  x\n  </pre>', '\n\n')).toBe('- <pre>\n\n  |\n  x\n  </pre>');
    });

    it('C25: at the end of an HTML block, repeated Enter leaves the blockquote as after plain quoted text', async () => {
        expect(await typed('markdown', '> <div>', '\n\n\n')).toBe('> <div>\n\n|');
        expect(await typed('markdown', '> quote', '\n\n\n')).toBe('> quote\n\n|');
    });

    it('C26: Enter on the blank line that ended an HTML block in a list item behaves as in a plain item', async () => {
        expect(await typed('markdown', '- <div>|\n  x\n  </div>', '\n\n')).toBe('- <div>\n|\n  x\n  </div>');
        expect(await typed('markdown', '- a\n  b|\n  c', '\n\n')).toBe('- a\n  b\n|\n  c');
    });

    it('C27: Enter on the last line of an HTML block at the end of the document continues the quote', async () => {
        expect(await typed('markdown', '> <div>\n> x', '\n')).toBe('> <div>\n> x\n> |');
    });

    it('C28: Enter inside an inline tag in a blockquote keeps the quote marker', async () => {
        const start = '> text <a href="x"| title="y"> more\n> next';

        expect(await typed('markdown', start, '\n')).toBe('> text <a href="x"\n> |title="y"> more\n> next');
    });

    it('C29: Enter between two inline tags in a blockquote keeps the quote marker and adds one line', async () => {
        expect(await typed('markdown', '> a <b>|</b> c\n> d', '\n')).toBe('> a <b>\n> |</b> c\n> d');
    });

    it('C30: Enter inside an inline tag on a line with no quote marker adds none', async () => {
        expect(await typed('markdown', '> text\n<a hr|ef="x"> more', '\n')).toBe('> text\n<a hr\n|ef="x"> more');
    });

    it('C31: Enter inside an HTML comment in a blockquote keeps the quote marker', async () => {
        expect(await typed('markdown', '> <!-- a|\n> b -->', '\n')).toBe('> <!-- a\n> |\n> b -->');
    });

    it('C32: Enter inside <script> in a blockquote keeps the quote marker', async () => {
        const start = '> <script>\n> function f() {|\n> }\n> </script>';

        expect(await typed('markdown', start, '\n')).toBe('> <script>\n> function f() {\n> |\n> }\n> </script>');
    });

    it('C33: Enter inside <script> in a list item copies the line indentation', async () => {
        const start = '- a\n  <script>\n  if (x) {|\n  }\n  </script>';

        expect(await typed('markdown', start, '\n')).toBe('- a\n  <script>\n  if (x) {\n  |\n  }\n  </script>');
    });

    it('C34: JavaScript inside a top-level <script> that continues below keeps its own indentation', async () => {
        const start = '<script>\nfunction f() {|\n}\n</script>';

        expect(await typed('markdown', start, '\n')).toBe('<script>\nfunction f() {\n  |\n}\n</script>');
    });

    it('C35: Enter in a fenced code block in a blockquote keeps the quote marker', async () => {
        expect(await typed('markdown', '> ```\n> code|\n> ```', '\n')).toBe('> ```\n> code\n> |\n> ```');
    });

    it('C36: Enter over a selection on an item marker line still indents to the item content', async () => {
        const state = settle(await buildTypingState('markdown', '- <div>x\n  y\n  </div>'));

        // Offsets 7 to 8 select the "x" after the open tag.
        const selected = state.update({ selection: EditorSelection.range(7, 8) }).state;

        expect(show(typeText(selected, '\n'))).toBe('- <div>\n  |\n  y\n  </div>');
    });

    it('C37: Enter with two carets inside an HTML block in a blockquote continues the quote at both', async () => {
        const start = await buildTypingState('markdown', '> <div>\n> x\n> </div>');
        const state = start.update({ effects: StateEffect.appendConfig.of(EditorState.allowMultipleSelections.of(true)) }).state;

        // Offset 7 is the end of the first line, 11 the end of the second.
        const carets = EditorSelection.create([EditorSelection.cursor(7), EditorSelection.cursor(11)]);
        const after  = typeText(state.update({ selection: carets }).state, '\n');

        expect(after.doc.toString()).toBe('> <div>\n> \n> x\n> \n> </div>');
    });

    it('C38: Enter inside an HTML block in a blockquote does nothing in a read-only editor', async () => {
        const start = await buildTypingState('markdown', '> <div>|\n> x');
        const state = start.update({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) }).state;

        expect(show(typeText(state, '\n'))).toBe('> <div>|\n> x');
    });

    it('C39: Backspace deletes the continued quote prefix one character at a time', async () => {
        expect(await typed('markdown', '> <div>|\n> x', '\n\b')).toBe('> <div>\n>|\n> x');
        expect(await typed('markdown', '> <div>|\n> x', '\n\b\b')).toBe('> <div>\n|\n> x');
    });

    it('C40: Backspace deletes the continued item indentation in one press', async () => {
        expect(await typed('markdown', '- <div>|\n  x\n  </div>', '\n\b')).toBe('- <div>\n|\n  x\n  </div>');
        expect(await typed('markdown', '1. <div>|\n   x', '\n\b')).toBe('1. <div>\n|\n   x');
    });

    it('C41: Backspace on the continued prefix of an item in a blockquote deletes the indentation first', async () => {
        expect(await typed('markdown', '> - <div>|\n>   x', '\n\b\b')).toBe('> - <div>\n> |\n>   x');
    });

    it('C42: Enter between a bracket pair inside <script> or <style> in a blockquote or list item splits the pair and gives both new lines the prefix', async () => {
        // The closing bracket moves to its own line, as with the editor's
        // plain Enter, which still splits the pair at the top level and
        // indents by JavaScript's own rules there.
        expect(await typed('markdown', '> <script>\n> f(|)\n> </script>', '\n')).toBe('> <script>\n> f(\n> |\n> )\n> </script>');
        expect(await typed('markdown', '- a\n  <script>\n  f(|)\n  </script>', '\n')).toBe('- a\n  <script>\n  f(\n  |\n  )\n  </script>');
        expect(await typed('markdown', '- a\n  <style>\n  a {|}\n  </style>', '\n')).toBe('- a\n  <style>\n  a {\n  |\n  }\n  </style>');
        expect(await typed('markdown', '<script>\nf(|)\n</script>', '\n')).toBe('<script>\nf(\n  |\n)\n</script>');
    });

    it('H1: the standalone html language still auto-closes a tag', async () => {
        expect(await typed('html', '', '<div>')).toBe('<div>|</div>');
    });

    it('H2: the standalone html language still indents between tags on Enter', async () => {
        expect(await typed('html', '', '<div>\n')).toBe('<div>\n  |\n</div>');
    });

    it('B1: Backspace right after a typed ( deletes the pair', async () => {
        expect(await typed('javascript', '', '(\b')).toBe('|');
    });

    it('B2: Backspace right after a typed [ deletes the pair', async () => {
        expect(await typed('javascript', '', '[\b')).toBe('|');
    });

    it('B3: Backspace right after a typed { deletes the pair', async () => {
        expect(await typed('javascript', '', '{\b')).toBe('|');
    });

    it('B4: Backspace right after a typed " deletes the pair', async () => {
        expect(await typed('javascript', '', '"\b')).toBe('|');
    });

    it("B5: Backspace right after a typed ' deletes the pair", async () => {
        expect(await typed('javascript', '', "'\b")).toBe('|');
    });

    it('B6: Backspace right after a typed backtick deletes the pair', async () => {
        expect(await typed('javascript', '', '`\b')).toBe('|');
    });

    it('B7: json: Backspace right after a typed { deletes the pair', async () => {
        expect(await typed('json', '', '{\b')).toBe('|');
    });

    it('B8: json does not close (, and Backspace deletes it alone', async () => {
        expect(await typed('json', '', '(')).toBe('(|');
        expect(await typed('json', '', '(\b')).toBe('|');
    });

    it('B9: with no language, Backspace right after a typed ( deletes the pair', () => {
        const state = EditorState.create({ doc: '', extensions: TYPING_EXTENSIONS });

        expect(show(typeText(state, '(\b'))).toBe('|');
    });

    it('B10: Backspace with text between the pair deletes one character', async () => {
        expect(await typed('javascript', '', '(a\b')).toBe('(|)');
    });

    it('B11: a second Backspace, once the pair is empty, deletes the pair', async () => {
        expect(await typed('javascript', '', '(a\b\b')).toBe('|');
    });

    it('B12: Backspace between a pair already in the document deletes the pair', async () => {
        expect(await typed('javascript', 'f(|);', '\b')).toBe('f|;');
    });

    it('B13: Backspace between mismatched brackets deletes one character', async () => {
        expect(await typed('javascript', '(|]', '\b')).toBe('|]');
    });

    it('B14: Backspace in a nested pair deletes the inner pair only', async () => {
        expect(await typed('javascript', '', '([\b')).toBe('(|)');
    });

    it('B15: Backspace away from any pair deletes one character', async () => {
        expect(await typed('javascript', 'ab|c', '\b')).toBe('a|c');
    });

    it('B16: markdown: Backspace right after a typed ( in a list item deletes the pair', async () => {
        expect(await typed('markdown', '- |', '(\b')).toBe('- |');
    });

    it('B17: markdown: Backspace after a fresh list marker still turns it into indentation', async () => {
        expect(await typed('markdown', '- a\n- |', '\b')).toBe('- a\n  |');
    });

    // B1-B17 name three languages. This row runs the same key on every
    // built-in one; `[` is the one bracket all seven close.
    for (const languageId of ['javascript', 'json', 'html', 'sql', 'markdown', 'css', 'python']) {
        it(`B18: ${languageId}: Backspace right after a typed [ deletes the pair`, async () => {
            expect(await typed(languageId, '', '[\b')).toBe('|');
        });
    }

    it('B19: Backspace between a pair changes nothing in a read-only editor', () => {
        const state = EditorState.create({
            doc:        '()',
            selection:  EditorSelection.cursor(1),
            extensions: [...TYPING_EXTENSIONS, EditorState.readOnly.of(true)],
        });

        expect(show(typeText(state, '\b'))).toBe('(|)');
    });

    it('B20: with a caret in each of two empty pairs, Backspace deletes both pairs', () => {
        const state = EditorState.create({
            doc:        'a()b[]c',
            selection:  EditorSelection.create([EditorSelection.cursor(2), EditorSelection.cursor(5)]),
            extensions: [...TYPING_EXTENSIONS, EditorState.allowMultipleSelections.of(true)],
        });

        const after = typeText(state, '\b');

        expect(after.doc.toString()).toBe('abc');
        expect(after.selection.ranges.map((range) => range.head)).toEqual([1, 2]);
    });

    it('B21: with one caret in an empty pair and one outside any, Backspace deletes one character at each', () => {
        // CodeMirror's command deletes pairs only when every caret is in
        // one; otherwise the plain Backspace runs at all of them, as before.
        // Its docs do not promise this. If a CodeMirror upgrade fails this
        // row, read `deleteBracketPair` again, then bring the row and the
        // "several carets" sentences of CodeEditor.md and the changelog in
        // line with what it does.
        const state = EditorState.create({
            doc:        '()ab',
            selection:  EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(4)]),
            extensions: [...TYPING_EXTENSIONS, EditorState.allowMultipleSelections.of(true)],
        });

        const after = typeText(state, '\b');

        expect(after.doc.toString()).toBe(')a');
        expect(after.selection.ranges.map((range) => range.head)).toEqual([0, 2]);
    });

    it('B22: Backspace with text selected inside a pair deletes the selection only', () => {
        const state = EditorState.create({
            doc:        '(a)',
            selection:  EditorSelection.range(1, 2),
            extensions: TYPING_EXTENSIONS,
        });

        expect(show(typeText(state, '\b'))).toBe('(|)');
    });

    it('B23: json: Backspace between a pair json does not close deletes one character', async () => {
        expect(await typed('json', '(|)', '\b')).toBe('|)');
        expect(await typed('json', "'|'", '\b')).toBe("|'");
    });

    it('B24: python: each Backspace inside a typed triple-quoted pair deletes one quote on each side', async () => {
        expect(await typed('python', '', '"""')).toBe('"""|"""');
        expect(await typed('python', '', '"""\b')).toBe('""|""');
        expect(await typed('python', '', '"""\b\b\b')).toBe('|');
    });

    // Rows F1–F42 and S1–S9: Enter in a code block, at the end of an HTML
    // block in a blockquote or list item, and on a blank indented line. The
    // new line starts with the caret line's own prefix, as in rows C1–C42.
    it('F1: text typed after Enter in a fenced code block in a blockquote lands in the block', async () => {
        expect(await typed('markdown', '> ```\n> code|\n> ```', '\nmore')).toBe('> ```\n> code\n> more|\n> ```');
    });

    it('F2: a fenced code block typed in a blockquote stays in the quote', async () => {
        expect(await typed('markdown', '> ```js', '\ncode\n```\n')).toBe('> ```js\n> code\n> ```\n> |');
    });

    it('F3: Enter after the closing fence keeps the quote marker', async () => {
        expect(await typed('markdown', '> ```\n> code\n> ```|\n> after', '\n')).toBe('> ```\n> code\n> ```\n> |\n> after');
    });

    it('F4: Enter in a fenced code block in a nested blockquote keeps both markers', async () => {
        expect(await typed('markdown', '> > ```\n> > code|\n> > ```', '\n')).toBe('> > ```\n> > code\n> > |\n> > ```');
    });

    it('F5: Enter on a deeper-indented code line in a blockquote keeps that indentation', async () => {
        expect(await typed('markdown', '> ```\n>     deep|\n> ```', '\n')).toBe('> ```\n>     deep\n>     |\n> ```');
    });

    it('F6: Enter in the middle of a quoted code line keeps the quote marker', async () => {
        expect(await typed('markdown', '> ```\n> co|de\n> ```', '\n')).toBe('> ```\n> co\n> |de\n> ```');
    });

    it('F7: repeated Enter in a fenced code block in a blockquote never drops the quote marker', async () => {
        expect(await typed('markdown', '> ```\n> code|\n> ```', '\n\n')).toBe('> ```\n> code\n> \n> |\n> ```');
        expect(await typed('markdown', '> ```\n> code', '\n\n\n')).toBe('> ```\n> code\n> \n> \n> |');
    });

    it('F8: Enter in front of the quote marker of a code line leaves the line as it is', async () => {
        expect(await typed('markdown', '> ```\n|> code\n> ```', '\n')).toBe('> ```\n\n|> code\n> ```');
    });

    it('F9: Enter after a fence opened on an item marker line indents to the item content', async () => {
        expect(await typed('markdown', '- ```js|\n  code\n  ```', '\n')).toBe('- ```js\n  |\n  code\n  ```');
    });

    it('F10: Enter after a fence opened on an ordered item marker line blanks the whole marker', async () => {
        expect(await typed('markdown', '1. ```|\n   code\n   ```', '\n')).toBe('1. ```\n   |\n   code\n   ```');
    });

    it('F11: a fenced code block typed on an item marker line stays in the item', async () => {
        expect(await typed('markdown', '- ```', '\ncode\n```\n')).toBe('- ```\n  code\n  ```\n  |');
    });

    it('F12: Enter on a code line of an item continuation keeps the line indentation', async () => {
        expect(await typed('markdown', '- ```\n  code|\n  ```', '\n')).toBe('- ```\n  code\n  |\n  ```');
    });

    it('F13: Enter in a fenced code block in an item inside a blockquote copies the line prefix', async () => {
        expect(await typed('markdown', '> - ```\n>   code|\n>   ```', '\n')).toBe('> - ```\n>   code\n>   |\n>   ```');
    });

    it('F14: Enter in a fenced code block in a blockquote inside an item keeps the quote marker', async () => {
        expect(await typed('markdown', '- > ```\n  > code|\n  > ```', '\n')).toBe('- > ```\n  > code\n  > |\n  > ```');
    });

    it('F15: Enter after a fence opened on an item marker line inside a blockquote keeps the quote and the item', async () => {
        expect(await typed('markdown', '> - ```|\n>   code', '\n')).toBe('> - ```\n>   |\n>   code');
    });

    for (const tabSize of [2, 8]) {
        it(`F16: Enter on a tab-indented code line in a nested item copies the tab with tabSize ${tabSize}`, async () => {
            expect(await typed('markdown', '- a\n  - b\n\t```\n\tcode|\n\t```', '\n', tabSize)).toBe('- a\n  - b\n\t```\n\tcode\n\t|\n\t```');
        });
    }

    for (const tabSize of [2, 8]) {
        it(`F17: Enter on a tab-indented line of a top-level fenced code block copies the tab with tabSize ${tabSize}`, async () => {
            expect(await typed('markdown', '```\n\tcode|\n```', '\n', tabSize)).toBe('```\n\tcode\n\t|\n```');
        });
    }

    for (const tabSize of [2, 8]) {
        it(`F18: text typed after Enter in a tab-indented code block stays in the code block with tabSize ${tabSize}`, async () => {
            expect(await typed('markdown', 'p\n\n\tcode', '\nmore', tabSize)).toBe('p\n\n\tcode\n\tmore|');
        });
    }

    it('F19: Enter in an indented code block in a blockquote keeps the code indentation', async () => {
        expect(await typed('markdown', '>     code|\n>     more', '\n')).toBe('>     code\n>     |\n>     more');
    });

    it('F20: Enter in an indented code block in a list item keeps the code indentation', async () => {
        expect(await typed('markdown', '- a\n\n      code|\n      more', '\n')).toBe('- a\n\n      code\n      |\n      more');
    });

    it('F21: Enter in a top-level indented code block keeps the code indentation', async () => {
        expect(await typed('markdown', 'p\n\n    code', '\n')).toBe('p\n\n    code\n    |');
    });

    it('F22: three Enters leave a blockquote from an indented code block', async () => {
        expect(await typed('markdown', '>     code', '\n\n\n')).toBe('>     code\n\n|');
    });

    it('F23: Enter in front of the first character of an indented code block in an item keeps the line in the code block', async () => {
        expect(await typed('markdown', '- a\n\n      |code', '\n')).toBe('- a\n\n      \n      |code');
    });

    // Enter in the indentation of an indented code block's first line moves the whole line down, as on the block's
    // later lines, so the line stays code with the same text. The block's syntax node starts after the indentation,
    // or after a tab that crosses the code's column, so the caret is in front of the node.

    it('Enter in front of the text of a tab-indented code line in an item keeps the line in the code block', async () => {
        expect(await typed('markdown', '- a\n\n\t\t|x', '\n')).toBe('- a\n\n\t\t\n\t\t|x');
    });

    it('Enter in front of the text of a tab-indented code line in a quote keeps the line in the code block', async () => {
        expect(await typed('markdown', '> \t\t|x', '\n')).toBe('> \t\t\n> \t\t|x');
    });

    it('Enter between the tabs of a code line in an item keeps the code\'s text', async () => {
        expect(await typed('markdown', '- a\n\n\t|\tx', '\n')).toBe('- a\n\n\t\n\t\t|x');
    });

    it('Enter between the tabs of a top-level code line keeps the tab in the code\'s text', async () => {
        expect(await typed('markdown', '\t|\tx', '\n')).toBe('\t\n\t\t|x');
    });

    it('Enter in the item indentation of a code line keeps the line in the code block', async () => {
        expect(await typed('markdown', '- a\n\n   |   code', '\n')).toBe('- a\n\n   \n      |code');
    });

    it('Enter after the list marker of an item that opens with a code block keeps the code in the item', async () => {
        expect(await typed('markdown', '-     |x', '\n')).toBe('-     \n      |x');
    });

    it('Enter after the quote marker of a quoted code line keeps the code\'s indentation', async () => {
        expect(await typed('markdown', '>|      x', '\n')).toBe('>\n>      |x');
    });

    it('Enter in front of the text of a top-level code line keeps its indentation on both lines', async () => {
        expect(await typed('markdown', '    |x', '\n')).toBe('    \n    |x');
    });

    it('Enter in front of the quote marker of a quoted code line leaves the line as it is', async () => {
        expect(await typed('markdown', '|>      x', '\n')).toBe('\n|>      x');
    });

    it('Enter in the indentation of a fence line in an item is not the code block\'s', async () => {
        expect(await typed('markdown', '- a\n\n  |```\n  x\n  ```', '\n')).toBe('- a\n\n\n  |```\n  x\n  ```');
    });

    it('Enter in the indentation of a paragraph line in an item is Markdown\'s own', async () => {
        expect(await typed('markdown', '- a\n\n  |b', '\n')).toBe('- a\n\n\n  |b');
    });

    it('F24: Enter between brackets in a fenced code block in a blockquote gives both new lines the quote marker', async () => {
        expect(await typed('markdown', '> ```\n> f(|)\n> ```', '\n')).toBe('> ```\n> f(\n> |\n> )\n> ```');
    });

    it('F25: Enter between brackets in a fenced code block in a list item still splits them', async () => {
        expect(await typed('markdown', '- ```\n  f(|)\n  ```', '\n')).toBe('- ```\n  f(\n  |\n  )\n  ```');
    });

    it('F26: Enter between brackets in a top-level fenced code block still splits them', async () => {
        expect(await typed('markdown', '```\nf(|)\n```', '\n')).toBe('```\nf(\n|\n)\n```');
    });

    it('F27: Enter between braces inside <script> in a blockquote splits them and keeps the quote marker', async () => {
        expect(await typed('markdown', '> <script>\n> f() {|}\n> </script>', '\n')).toBe('> <script>\n> f() {\n> |\n> }\n> </script>');
    });

    it('F28: Enter between brackets in quoted text is Markdown\'s own and does not split them', async () => {
        expect(await typed('markdown', '> f(|)', '\n')).toBe('> f(\n> |)');
    });

    it('F29: Enter on a blank indented line of a top-level fenced code block empties that line', async () => {
        expect(await typed('markdown', '```\n  code', '\n\n')).toBe('```\n  code\n\n  |');
    });

    it('F30: Enter on a blank indented line of a fenced code block in an item empties that line', async () => {
        expect(await typed('markdown', '- ```\n  code|\n  ```', '\n\n')).toBe('- ```\n  code\n\n  |\n  ```');
    });

    it('F31: Enter on a blank indented line after a list keeps the indentation', async () => {
        expect(await typed('markdown', '- a\n  |', '\n')).toBe('- a\n\n  |');
    });

    for (const tabSize of [2, 8]) {
        it(`F32: Enter on a blank tab-indented line at the end of the document copies the tab with tabSize ${tabSize}`, async () => {
            expect(await typed('markdown', '- a\n  - b\n\t<div>\n\t|', '\n', tabSize)).toBe('- a\n  - b\n\t<div>\n\n\t|');
        });
    }

    it('F33: Enter on a blank indented line inside a top-level HTML block is the editor\'s own', async () => {
        expect(await typed('markdown', '<pre>\n  |\n</pre>', '\n')).toBe('<pre>\n\n  |\n</pre>');
    });

    // Not in the plan: F33's text is the same from either command. A tab
    // tells them apart, since the editor's plain Enter measures it.
    for (const [tabSize, indentation] of [[2, '  '], [8, '        ']] as const) {
        it(`F42: Enter on a blank tab-indented line inside a top-level HTML block writes spaces with tabSize ${tabSize}`, async () => {
            expect(await typed('markdown', '<pre>\n\t|\n</pre>', '\n', tabSize)).toBe(`<pre>\n\n${indentation}|\n</pre>`);
        });
    }

    for (const tabSize of [2, 4, 8]) {
        it(`F34: Enter at the end of an HTML block on a tab-indented line of a nested item copies the tab with tabSize ${tabSize}`, async () => {
            expect(await typed('markdown', '- a\n  - b\n\t<div>', '\n', tabSize)).toBe('- a\n  - b\n\t<div>\n\t|');
        });
    }

    it('F35: text typed after Enter at the end of a tab-indented HTML block stays in the item', async () => {
        expect(await typed('markdown', '1. a\n\t<div>', '\nx')).toBe('1. a\n\t<div>\n\tx|');
    });

    it('F36: Enter after a close tag on a tab-indented line copies the tab', async () => {
        expect(await typed('markdown', '- a\n  - b\n\t<div>\n\tx\n\t</div>', '\n')).toBe('- a\n  - b\n\t<div>\n\tx\n\t</div>\n\t|');
    });

    it('F37: Enter at the end of an HTML block copies indentation deeper than the item content', async () => {
        expect(await typed('markdown', '- a\n   <div>', '\n')).toBe('- a\n   <div>\n   |');
    });

    it('F38: Enter after an inline tag at the end of a quoted paragraph is Markdown\'s own', async () => {
        expect(await typed('markdown', '> a\nb <i>x</i>', '\n')).toBe('> a\nb <i>x</i>\n> |');
    });

    it('F39: Enter in front of a tag on an item marker line is Markdown\'s own', async () => {
        expect(await typed('markdown', '- a |<b>x</b>', '\n')).toBe('- a\n- |<b>x</b>');
    });

    /**
     * Presses Enter at the end of a Markdown document.
     *
     * @param doc - The document, without a caret marker; text holding `|` is fine.
     * @returns The resulting document with `|` at the caret.
     */
    async function enterAtEnd(doc: string): Promise<string> {
        // The leading `|` marks the caret at the start and is dropped; the caret then moves to the end.
        const state = settle(await buildTypingState('markdown', '|' + doc));
        const atEnd = state.update({ selection: EditorSelection.cursor(state.doc.length) }).state;

        return show(typeText(atEnd, '\n'));
    }

    it('F42: Enter at the end of a column separator line that lazily continues a quote is Markdown\'s own', async () => {
        expect(await enterAtEnd('> a\n|||')).toBe('> a\n|||\n> |');
    });

    it('F43: Enter at the end of a fence line that lazily continues a list item is Markdown\'s own', async () => {
        expect(await enterAtEnd('- a\n:::')).toBe('- a\n:::\n|');
    });

    it('F44: Enter at the end of a fence opening line in a quote continues the quote', async () => {
        expect(await enterAtEnd('> ::: x')).toBe('> ::: x\n> |');
    });

    it('F40: Backspace deletes the quote prefix of a new code line one character at a time', async () => {
        expect(await typed('markdown', '> ```\n> code|\n> ```', '\n\b')).toBe('> ```\n> code\n>|\n> ```');
        expect(await typed('markdown', '> ```\n> code|\n> ```', '\n\b\b')).toBe('> ```\n> code\n|\n> ```');
    });

    it('F41: Backspace deletes the item indentation of a new code line in one press', async () => {
        expect(await typed('markdown', '- ```js|\n  code\n  ```', '\n\b')).toBe('- ```js\n|\n  code\n  ```');
    });

    /**
     * Types `keys` over a selection in a Markdown document.
     *
     * @param doc - The document text.
     * @param from - The offset the selection starts at.
     * @param to - The offset the selection ends at.
     * @param keys - The keys to type (see `typeText`).
     * @returns The resulting document with `|` at the caret.
     */
    async function typedOver(doc: string, from: number, to: number, keys: string): Promise<string> {
        const state = await buildTypingState('markdown', doc);

        return show(typeText(state.update({ selection: EditorSelection.range(from, to) }).state, keys));
    }

    /**
     * Presses Enter with two carets in a Markdown document.
     *
     * @param doc - The document text.
     * @param first - The offset of the first caret.
     * @param second - The offset of the second caret.
     * @returns The resulting document text.
     */
    async function enterAtTwoCarets(doc: string, first: number, second: number): Promise<string> {
        const start  = await buildTypingState('markdown', doc);
        const state  = start.update({ effects: StateEffect.appendConfig.of(EditorState.allowMultipleSelections.of(true)) }).state;
        const carets = EditorSelection.create([EditorSelection.cursor(first), EditorSelection.cursor(second)]);

        return typeText(state.update({ selection: carets }).state, '\n').doc.toString();
    }

    it('S1: Enter over a selection in a fenced code block in a blockquote keeps the quote marker', async () => {
        // Offsets 10 to 12 select the "de" of "code".
        expect(await typedOver('> ```\n> code\n> ```', 10, 12, '\n')).toBe('> ```\n> co\n> |\n> ```');
    });

    it('S2: Enter over a selection inside an HTML block in a blockquote keeps the quote marker', async () => {
        // Offsets 11 to 12 select the "b" of "abc".
        expect(await typedOver('> <div>\n> abc\n> </div>', 11, 12, '\n')).toBe('> <div>\n> a\n> |c\n> </div>');
    });

    it('S3: Enter over a selection across two code lines in a blockquote leaves one quoted line break', async () => {
        // Offsets 9 to 14 select from after "a" to after "c".
        expect(await typedOver('> ```\n> ab\n> cd\n> ```', 9, 14, '\n')).toBe('> ```\n> a\n> |d\n> ```');
    });

    it('S4: Enter over a selection in quoted text adds no quote marker', async () => {
        // Offsets 3 to 4 select the "b" of "abc". Markdown's own command passes a selection on.
        expect(await typedOver('> abc', 3, 4, '\n')).toBe('> a\n|c');
    });

    it('S5: Enter with two carets in a fenced code block in a blockquote keeps the quote marker at both', async () => {
        // Offset 9 is the end of "> a", 13 the end of "> b".
        expect(await enterAtTwoCarets('> ```\n> a\n> b\n> ```', 9, 13)).toBe('> ```\n> a\n> \n> b\n> \n> ```');
    });

    it('S6: Enter with one caret in a code block and one in a paragraph gives neither a quote marker', async () => {
        // Offset 9 is the end of "> a", 21 the end of "text".
        expect(await enterAtTwoCarets('> ```\n> a\n> ```\n\ntext', 9, 21)).toBe('> ```\n> a\n\n> ```\n\ntext\n');
    });

    it('S7: Enter over a selection that starts between a bracket pair adds one line', async () => {
        // Offsets 10 to 12 select the ")a" after "f(". The closing bracket is replaced, so nothing is left to move down.
        expect(await typedOver('> ```\n> f()ab\n> ```', 10, 12, '\n')).toBe('> ```\n> f(\n> |b\n> ```');
    });

    it('S8: Enter over the text between two inline tags in a blockquote keeps the quote marker', async () => {
        // Offsets 7 to 8 select the "x". Markdown is beside the start of the selection and HTML beside its end.
        expect(await typedOver('> a <b>x</b> c\n> d', 7, 8, '\n')).toBe('> a <b>\n> |</b> c\n> d');
    });

    it('S9: Enter over a selection that starts in front of the quote marker is not this command\'s', async () => {
        // Offsets 6 to 12 select the whole line "> code", from the margin. As for a caret there (row F8), the
        // editor's plain Enter replaces it, and the new line has no ">".
        expect(await typedOver('> ```\n> code\n> ```', 6, 12, '\n')).toBe('> ```\n\n|\n> ```');
    });

    /**
     * Types `keys` like `typed`, in a state made read-only the way
     * `CodeEditor` makes it.
     *
     * @param languageId - The built-in language id to type in.
     * @param startDoc - The document before typing, with the caret as `buildTypingState` reads it.
     * @param keys - The keys to type (see `typeText`).
     * @returns The resulting document with `|` at the caret.
     */
    async function typedReadOnly(languageId: string, startDoc: string, keys: string): Promise<string> {
        const state = await buildTypingState(languageId, startDoc);

        return show(typeText(state.update({ effects: StateEffect.appendConfig.of(buildReadOnlyExtension(true)) }).state, keys));
    }

    it('RO1: Enter on a markdown list line changes nothing in a read-only editor', async () => {
        expect(await typedReadOnly('markdown', '- item', '\n')).toBe('- item|');
    });

    it('RO2: Backspace after a markdown list marker changes nothing in a read-only editor', async () => {
        expect(await typedReadOnly('markdown', '- a\n- |', '\b')).toBe('- a\n- |');
    });

    it('RO3: Enter on a markdown blockquote line changes nothing in a read-only editor', async () => {
        expect(await typedReadOnly('markdown', '> quote', '\n')).toBe('> quote|');
    });

    it('RO4: a typed character changes nothing in a read-only editor', async () => {
        // A mounted view drops typed text before it becomes a transaction;
        // the harness builds the transaction, and the editor's filter refuses it.
        expect(await typedReadOnly('markdown', 'ab|', 'x')).toBe('ab|');
    });

    it('RO5: Enter in a fenced code block in a blockquote changes nothing in a read-only editor', async () => {
        expect(await typedReadOnly('markdown', '> ```\n> code|\n> ```', '\n')).toBe('> ```\n> code|\n> ```');
    });

    it('RO6: Enter and Backspace between brackets change nothing in a read-only javascript editor', async () => {
        expect(await typedReadOnly('javascript', 'a(|)', '\n')).toBe('a(|)');
        expect(await typedReadOnly('javascript', 'a(|)', '\b')).toBe('a(|)');
    });

    // TS1–TS19: Markdown's own Enter and Backspace read a tab in a line's container prefix as the spaces to its
    // stop, so they do what they do on the same document written with spaces (markdown-source-mode-enter-after-quote-tab).

    /**
     * Writes each line's container prefix as the viewer reads it: every tab as the spaces to its stop.
     *
     * @param doc - The document.
     * @returns The document with tab-free container prefixes.
     */
    function prefixSpacesForm(doc: string): string {
        return expandPrefixTabs(doc).text;
    }

    for (const tabSize of [2, 4, 8]) {
        it(`TS1: Enter after an item whose marker a tab follows starts the next item with tabSize ${tabSize}`, async () => {
            expect(await typed('markdown', '-\ta|', '\n', tabSize)).toBe('-\ta\n-   |');
        });
    }

    it('TS2: Enter after an ordered item whose number a tab follows numbers the next', async () => {
        expect(await typed('markdown', '1.\ta|', '\n')).toBe('1.\ta\n2.  |');
    });

    it('TS3: Enter inside the text of an item whose marker a tab follows starts the next item', async () => {
        expect(await typed('markdown', '-\ta|b', '\n')).toBe('-\ta\n-   |b');
    });

    it('TS4: Enter after a task item whose checkbox a tab follows starts the next task', async () => {
        expect(await typed('markdown', '- [ ]\ttask|', '\n')).toBe('- [ ]\ttask\n- [ ]   |');
    });

    it('TS5: Enter renumbers the items below and keeps their tabs', async () => {
        expect(await typed('markdown', '1.\ta|\n2.\tb', '\n')).toBe('1.\ta\n2.  |\n3.\tb');
    });

    it('TS6: Enter after a loose item whose marker a tab follows keeps the list loose', async () => {
        expect(await typed('markdown', '-\ta\n\n-\tb|', '\n')).toBe('-\ta\n\n-\tb\n\n-   |');
    });

    it('TS7: Enter on an empty second item after a tab loosens the list, and a second Enter leaves it', async () => {
        expect(await typed('markdown', '-\ta\n-\t|', '\n')).toBe('-\ta\n\n-\t|');
        expect(await typed('markdown', '-\ta\n-\t|', '\n\n')).toBe('-\ta\n\n|');
    });

    it('TS8: Enter in a quote inside an item whose marker a tab follows stays in the item', async () => {
        expect(await typed('markdown', '-\t> a|', '\n')).toBe('-\t> a\n    > |');
    });

    it('TS9: Enter after an item in a quote, with a tab after the quote marker and after the item marker', async () => {
        expect(await typed('markdown', '>\t-\ta|', '\n')).toBe('>\t-\ta\n>   -   |');
    });

    it('TS10: Enter after an item in a quote whose marker a space and a tab follow', async () => {
        expect(await typed('markdown', '> \t- a|', '\n')).toBe('> \t- a\n>   - |');
    });

    it("TS11: Enter on a tab-indented paragraph of an item starts the new line at the item's content", async () => {
        expect(await typed('markdown', '- a\n\n\tb|', '\n')).toBe('- a\n\n\tb\n  |');
    });

    it('TS12: Backspace after a marker that a tab follows removes the marker', async () => {
        expect(await typed('markdown', '-\t|', '\b')).toBe('|');
        expect(await typed('markdown', '1.\t|', '\b')).toBe('|');
    });

    it("TS13: Backspace after a second item's marker that a tab follows turns the marker into indentation", async () => {
        expect(await typed('markdown', '- a\n-\t|', '\b')).toBe('- a\n  |');
    });

    it('TS14: Backspace after a quote marker that a tab follows removes the marker', async () => {
        expect(await typed('markdown', '>\t|', '\b')).toBe('|');
    });

    it('TS15: Backspace after an item marker and a tab in a quote opened by a tab removes the item marker', async () => {
        expect(await typed('markdown', '>\t-\t|', '\b')).toBe('> |');
    });

    it('TS16: Enter with a caret after each of two items whose markers tabs follow starts two items', async () => {
        expect(await enterAtTwoCarets('-\ta\n-\tb', 3, 7)).toBe('-\ta\n-   \n-\tb\n-   ');
    });

    it('TS17: Enter after an item whose marker a tab follows changes nothing in a read-only editor', async () => {
        expect(await typedReadOnly('markdown', '-\ta|', '\n')).toBe('-\ta|');
    });

    it('TS18: Enter and Backspace in a quoted list without a tab are unchanged', async () => {
        expect(await typed('markdown', '> - a|', '\n')).toBe('> - a\n> - |');
        expect(await typed('markdown', '> - |', '\b')).toBe('> |');
    });

    // TS19 and TS20 each type into thousands of drawn documents. They take under 2 s alone but up to 10 s
    // when `npm test` runs every test file at once on a many-core machine, past Vitest's 5 s default;
    // 60 s, the other sweeps' timeout, leaves room for a slower machine under that load.
    const TAB_SWEEP_TIMEOUT_MS = 60_000;

    // 3,000 draws give 2,932 documents and 9,285 presses. On the base, 1,329 of them end otherwise.
    it('TS19: on every drawn tab document, Enter and Backspace do what they do with its container prefixes written as spaces', async () => {
        const differing: string[] = [];

        for (const doc of tabDocuments(3_000)) {
            const lines = doc.split('\n');
            const spacedLines = prefixSpacesForm(doc).split('\n');

            for (let index = 0; index < lines.length; index++) {
                const line = lines[index]!;
                const isEnterLine = line !== '' && !/[ \t]$/.test(line);
                const isBackspaceLine = /[-*+>.)] $/.test(line);
                const keys = isEnterLine ? '\nx' : isBackspaceLine ? '\bx' : null;

                if (keys === null) {
                    continue;
                }

                const withCaret = (all: string[]): string => all.map((text, at) => (at === index ? text + '|' : text)).join('\n');
                const result = await typed('markdown', withCaret(lines), keys);
                const spacedResult = await typed('markdown', withCaret(spacedLines), keys);
                const same = prefixSpacesForm(result.replace('|', '')) === spacedResult.replace('|', '');

                if (!same) {
                    differing.push(JSON.stringify([doc, index, keys]));
                }
            }
        }

        expect(differing).toEqual([]);
    }, TAB_SWEEP_TIMEOUT_MS);

    // 150 draws, the caret at every position of every line that does not end in whitespace, Enter and Backspace.
    // One kind of press is left out, because the two forms differ there whatever this module does: Backspace where
    // Markdown's own Backspace declines on the spaces form (the editor's plain one then deletes a tab as one
    // character).

    // A tab whose column an edit moved is written as spaces, so the result keeps the blocks the spaces form has.
    it('TS20: with the caret at any position of a drawn tab document, Enter and Backspace give the blocks of the spaces form', async () => {
        const differing: string[] = [];

        for (const doc of tabDocuments(150)) {
            const lines = doc.split('\n');
            const expansion = expandPrefixTabs(doc);
            let lineStart = 0;

            for (const line of lines) {
                for (let column = 0; column <= line.length && !/[ \t]$/.test(line); column++) {
                    const spacedCaret = expansion.offsets.indexOf(lineStart + column);

                    for (const key of ['\n', '\b']) {
                        const spacedStart = expansion.text.slice(0, spacedCaret) + '|' + expansion.text.slice(spacedCaret);
                        const spacedState = settle(await buildTypingState('markdown', spacedStart));
                        const markdownBackspaceDeclines = key === '\b' && !deleteMarkupBackward({ state: spacedState, dispatch: () => undefined });

                        if (markdownBackspaceDeclines) {
                            continue;
                        }

                        const result = await typed('markdown', doc.slice(0, lineStart + column) + '|' + doc.slice(lineStart + column), key);
                        const spacedResult = await typed('markdown', spacedStart, key);
                        const same = await languageOutline(result.replace('|', '')) === await languageOutline(spacedResult.replace('|', ''));

                        if (!same) {
                            differing.push(JSON.stringify([doc, lineStart + column, key]));
                        }
                    }
                }

                lineStart += line.length + 1;
            }
        }

        expect(differing).toEqual([]);
    }, TAB_SWEEP_TIMEOUT_MS);

    it('TS21: Enter after an item whose marker a tab follows is one undo step', async () => {
        const start = (await buildTypingState('markdown', '-\ta|')).update({ effects: StateEffect.appendConfig.of(history()) }).state;
        const pressed = pressKey(settle(start), 'Enter');
        let undone = pressed;

        undo({ state: pressed, dispatch: (transaction) => { undone = transaction.state; } });

        expect(undoDepth(pressed)).toBe(1);
        expect(undone.doc.toString()).toBe('-\ta');
    });

    it('TS22: Enter after an item whose marker a tab follows keeps the key press as the user event', async () => {
        const events: (string | undefined)[] = [];
        const record = EditorState.transactionFilter.of((transaction) => {
            events.push(transaction.annotation(Transaction.userEvent));

            return transaction;
        });
        const start = (await buildTypingState('markdown', '-\ta|')).update({ effects: StateEffect.appendConfig.of(record) }).state;

        const settled = settle(start);

        events.length = 0;
        pressKey(settled, 'Enter');

        expect(events).toEqual(['input']);
    });

    it('TS23: Backspace after a marker that a tab follows changes nothing in a read-only editor', async () => {
        expect(await typedReadOnly('markdown', '-\t|', '\b')).toBe('-\t|');
    });

    it('TS24: Enter after the second quote marker, before a tab and a heading, keeps the heading', async () => {
        expect(await typed('markdown', '> >|\t# h', '\n')).toBe('> >\n> > | # h');
    });

    it('TS25: Enter in front of whitespace that ends a line writes that whitespace as one space', async () => {
        expect(await typed('markdown', ' >|\t', '\n')).toBe(' >\n> | ');
    });

    it('TS26: Enter keeps the whitespace that ends a line only where it stood', async () => {
        const start = '\n\t>\t</pre>\n 1. [ ]\t\n\n>\t#\th\n';

        expect(await typed('markdown', start.slice(0, 14) + '|' + start.slice(14), '\n')).toBe('\n\t>\t</pre>\n 1.\n 2. | [ ] \n\n>\t#\th\n');
    });

    /**
     * Types `keys` in a Markdown document whose state carries one more extension.
     *
     * @param startDoc - The document before typing, with the caret as `buildTypingState` reads it.
     * @param extension - The extension to add.
     * @param keys - The keys to type (see `typeText`).
     * @returns The resulting document with `|` at the caret.
     */
    async function typedWith(startDoc: string, extension: Extension, keys: string): Promise<string> {
        const state = (await buildTypingState('markdown', startDoc)).update({ effects: StateEffect.appendConfig.of(extension) }).state;

        return show(typeText(state, keys));
    }

    it('TS27: Enter after an item whose marker a tab follows works under a change filter that refuses unannotated changes', async () => {
        const refusing = EditorState.changeFilter.of((transaction) => transaction.annotation(Transaction.userEvent) !== undefined);

        expect(await typedWith('-\ta|', refusing, '\n')).toBe('-\ta\n-   |');
    });

    it('TS28: a transaction filter of the consumer runs once on Enter after an item whose marker a tab follows', async () => {
        const bang = EditorState.transactionFilter.of((transaction): Transaction | TransactionSpec[] => {
            const isInput = transaction.docChanged && transaction.isUserEvent('input');

            return isInput ? [transaction, { changes: { from: transaction.newDoc.length, insert: '!' }, sequential: true }] : transaction;
        });

        expect(await typedWith('-\ta|', bang, '\n')).toBe('-\ta\n-   |!');
        expect(await typedWith('- a|', bang, '\n')).toBe('- a\n- |!');
    });

    // Enter that renumbers the items below it, from 9 to 10, moves each renumbered item's later lines with its content
    // column, so they stay in the item.

    it('Enter that renumbers an item from 9 to 10 moves its later paragraph with its content', async () => {
        expect(await typed('markdown', '8. a|\n9. i\n\n   j', '\n')).toBe('8. a\n9. |\n10. i\n\n    j');
    });

    it('Enter that renumbers an item written with two spaces after its marker keeps its later paragraph a paragraph', async () => {
        expect(await typed('markdown', '8. a|\n9.  i\n\n    j', '\n')).toBe('8. a\n9. |\n10.  i\n\n     j');
    });

    it('Enter that renumbers an item whose marker a tab follows leaves its later lines where they are', async () => {
        expect(await typed('markdown', '8. a|\n9.\ti\n\n    j', '\n')).toBe('8. a\n9. |\n10.\ti\n\n    j');
    });

    it('Enter that renumbers an item from 99 to 100 moves its later paragraph with its content', async () => {
        expect(await typed('markdown', '98. a|\n99. i\n\n    j', '\n')).toBe('98. a\n99. |\n100. i\n\n     j');
    });

    it('Enter that renumbers an item from 99 to 100 whose marker a tab follows moves its later lines to the tab\'s new stop', async () => {
        expect(await typed('markdown', '98. a|\n99.\ti\n\n    j', '\n')).toBe('98. a\n99. |\n100.\ti\n\n        j');
    });

    it('Enter that renumbers an item with a parenthesis delimiter moves its later paragraph with its content', async () => {
        expect(await typed('markdown', '8) a|\n9) i\n\n   j', '\n')).toBe('8) a\n9) |\n10) i\n\n    j');
    });

    it('Enter that renumbers an item in a quote moves its later paragraph after the quote marker', async () => {
        expect(await typed('markdown', '> 8. a|\n> 9. i\n>\n>    j', '\n')).toBe('> 8. a\n> 9. |\n> 10. i\n>\n>     j');
    });

    it('Enter that renumbers an item of a list nested in an item moves its later paragraph with its content', async () => {
        expect(await typed('markdown', '- x\n\n  8. a|\n  9. i\n\n     j', '\n')).toBe('- x\n\n  8. a\n  9. |\n  10. i\n\n      j');
    });

    it('Enter that renumbers an item moves the list nested in it', async () => {
        expect(await typed('markdown', '8. a|\n9. i\n   - n\n   - m', '\n')).toBe('8. a\n9. |\n10. i\n    - n\n    - m');
    });

    it('Enter that renumbers an item moves its fenced code block and keeps the code\'s text', async () => {
        expect(await typed('markdown', '8. a|\n9. i\n\n   ```\n   code\n     more\n   ```', '\n'))
            .toBe('8. a\n9. |\n10. i\n\n    ```\n    code\n      more\n    ```');
    });

    it('Enter that renumbers an item keeps its indented code block code', async () => {
        expect(await typed('markdown', '8. a|\n9. i\n\n       code', '\n')).toBe('8. a\n9. |\n10. i\n\n        code');
    });

    it('Enter that renumbers an item leaves a lazy continuation line where it is', async () => {
        expect(await typed('markdown', '8. a|\n9. i\nlazy', '\n')).toBe('8. a\n9. |\n10. i\nlazy');
    });

    it('Enter that renumbers an empty item leaves the paragraph after its blank line outside the item, as the viewer reads it', async () => {
        const start = '8. a\n9.\n\n   j';
        const result = (await typed('markdown', start.replace('8. a', '8. a|'), '\n')).replace('|', '');

        expect(result).toBe('8. a\n9. \n10.\n\n   j');
        expect(JSON.stringify(viewerModel(start).blocks)).not.toContain('"code"');
        expect(JSON.stringify(viewerModel(result).blocks)).not.toContain('"code"');
    });

    it('Enter in a bullet list never renumbers, so the paragraph after an empty item\'s blank line stays outside it (guard)', async () => {
        const result = (await typed('markdown', '- a|\n-\n\n  j', '\n')).replace('|', '');

        expect(result).toBe('- a\n- \n-\n\n  j');
        expect(JSON.stringify(viewerModel(result).blocks)).not.toContain('"code"');
    });

    /**
     * Presses Enter at the caret marked in `start` and reports whether the viewer reads the result as it read
     * `start`, with one empty item added after the first item of its list.
     *
     * @param start - A document with a caret in the first item of an ordered list.
     * @returns `true` when only that empty item differs.
     */
    async function renumberingKeepsReading(start: string): Promise<boolean> {
        const plain = start.replace('|', '');
        const after = viewerModel((await typed('markdown', start, '\n')).replace('|', '')).blocks as unknown as Array<{ kind: string; items: unknown[]; blocks: Array<{ kind: string; items: unknown[] }> }>;
        const list = after[0]?.kind === 'quote' ? after[0].blocks[0] : after[0];

        if (list?.kind !== 'list') {
            return false;
        }

        const removed = list.items.splice(1, 1)[0] as unknown[] | undefined;
        const withoutLooseness = (blocks: unknown): string => JSON.stringify(blocks, (key, value) => (key === 'loose' ? undefined : value));

        return removed !== undefined && removed.length === 0 && withoutLooseness(after) === withoutLooseness(viewerModel(plain).blocks);
    }

    it('Enter that renumbers an item whose first line is empty keeps the content after its first paragraph, blank lines included', async () => {
        expect(await typed('markdown', '8. a|\n9.\n   x\n\n   y', '\n')).toBe('8. a\n9. |\n10.\n    x\n\n    y');
        expect(await renumberingKeepsReading('8. a|\n9.\n   x\n\n   y')).toBe(true);
    });

    it('Enter that renumbers an item whose first line is empty keeps a quote the item holds whole', async () => {
        expect(await renumberingKeepsReading('8. a|\n9.\n   > q\n   >\n   > r')).toBe(true);
    });

    it('Enter that renumbers an item whose first line is empty keeps a fence with a blank line inside it whole', async () => {
        expect(await renumberingKeepsReading('8. a|\n9.\n   ```\n   x\n\n   y\n   ```')).toBe(true);
    });

    it('Enter that renumbers an item in a quote, whose first line is empty, leaves the paragraph after a blank quote line outside it', async () => {
        expect(await renumberingKeepsReading('> 8. a|\n> 9.\n>\n>    j')).toBe(true);
    });

    it('Enter that renumbers an item in a quote, whose first line is empty, keeps a quote line the item itself holds', async () => {
        expect(await renumberingKeepsReading('> 8. a|\n> 9.\n>    > q\n>    >\n>    > r')).toBe(true);
    });

    describe('Enter that renumbers an item keeps the viewer\'s reading', () => {
        // 10,648 documents take about 5 s alone; the named timeout holds under the load of a full run.
        const RENUMBER_SWEEP_TIMEOUT_MS = 60_000;

        it('whatever follows the item, in the shapes of a list item', async () => {
            const firsts = ['', '  i', '\ti', 'i'];
            const laters = ['', 'j', '> q', '>', '- n', '```', 'p', '    code', '  m', '\tt', '    \tt'];
            const failures: string[] = [];

            for (const [left, right] of [['8', '9'], ['98', '99']]) {
                for (const first of firsts) {
                    const markEnd = right.length + 1;
                    const head = `${right}.${first === '' || first.startsWith('\t') || first.startsWith(' ') ? first : ' ' + first}`;
                    const column = first.startsWith('  ') ? markEnd + 2 : first.startsWith('\t') ? 4 * Math.ceil((markEnd + 1) / 4) : markEnd + 1;
                    const pad = ' '.repeat(column);

                    for (let mask = 0; mask < laters.length ** 3; mask++) {
                        const picks = [mask % laters.length, Math.floor(mask / laters.length) % laters.length, Math.floor(mask / laters.length ** 2)];
                        const lines = picks.map((pick) => (laters[pick] === '' ? '' : pad + laters[pick]));
                        const start = `${left}. a|\n${head}\n${lines.join('\n')}`;

                        if (!await renumberingKeepsReading(start)) {
                            failures.push(JSON.stringify(start));
                        }
                    }
                }
            }

            expect(failures).toEqual([]);
        }, RENUMBER_SWEEP_TIMEOUT_MS);
    });

    it('Enter that renumbers an empty item moves the indented line right after it, which CommonMark keeps in the item', async () => {
        const start = '8. a\n9.\n   j';
        const result = (await typed('markdown', start.replace('8. a', '8. a|'), '\n')).replace('|', '');

        expect(result).toBe('8. a\n9. \n10.\n    j');
        expect(JSON.stringify(viewerModel(result).blocks)).not.toContain('"code"');
        expect(JSON.stringify(viewerModel(result).blocks)).toContain('"j"');
    });

    it('Enter that renumbers an item adds a column after a tab that crosses its content column', async () => {
        expect(await typed('markdown', '8. a|\n9. i\n\n\tj', '\n')).toBe('8. a\n9. |\n10. i\n\n\t j');
    });

    it('Enter that renumbers an item keeps a tab in a fenced code line a tab', async () => {
        expect(await typed('markdown', '8. a|\n9. i\n\n   ```\n   \tt\n   ```', '\n')).toBe('8. a\n9. |\n10. i\n\n    ```\n    \tt\n    ```');
        expect(await renumberingKeepsReading('8. a|\n9. i\n\n   ```\n   \tt\n   ```')).toBe(true);
    });

    it('Enter that renumbers an item keeps a tab in an indented code line a tab', async () => {
        expect(await typed('markdown', '8. a|\n9. i\n\n       \tt', '\n')).toBe('8. a\n9. |\n10. i\n\n        \tt');
        expect(await renumberingKeepsReading('8. a|\n9. i\n\n       \tt')).toBe(true);
    });

    it('Enter that renumbers an item in a quote keeps a tab in its fenced code line a tab', async () => {
        expect(await typed('markdown', '> 8. a|\n> 9. i\n>\n>    ```\n>    \tt\n>    ```', '\n')).toBe('> 8. a\n> 9. |\n> 10. i\n>\n>     ```\n>     \tt\n>     ```');
        expect(await renumberingKeepsReading('> 8. a|\n> 9. i\n>\n>    ```\n>    \tt\n>    ```')).toBe(true);
    });

    it('Enter that lifts an empty item and renumbers the next from 10 to 9 keeps a tab in its fenced code line a tab', async () => {
        expect(await typed('markdown', '7. x\n8. y\n9. |\n10. b\n\n    ```\n    \tt\n    ```', '\n')).toBe('7. x\n8. y\n|\n9. b\n\n   ```\n   \tt\n   ```');
    });

    it('Enter that lifts an empty item and renumbers the next from 10 to 9 keeps a tab in its indented code line a tab', async () => {
        expect(await typed('markdown', '7. x\n8. y\n9. |\n10. b\n\n        \tt', '\n')).toBe('7. x\n8. y\n|\n9. b\n\n       \tt');
    });

    it('Enter that renumbers an item with a fence indented in the item moves the fence\'s indentation and keeps a tab after it', async () => {
        expect(await typed('markdown', '8. a|\n9. i\n\n     ```\n     \t\tt\n     ```', '\n')).toBe('8. a\n9. |\n10. i\n\n      ```\n      \t\tt\n      ```');
    });

    it('Enter that renumbers an item writes a tab past its content column as spaces when its width would change', async () => {
        expect(await typed('markdown', '8. a|\n9. i\n\n   \t    x', '\n')).toBe('8. a\n9. |\n10. i\n\n         x');
    });

    it('Enter that lifts an empty item out of its list moves the later lines of the item it renumbers from 10 to 9', async () => {
        expect(await typed('markdown', '7. x\n8. y\n9. |\n10. b\n\n        c', '\n')).toBe('7. x\n8. y\n|\n9. b\n\n       c');
    });

    it('Enter that lifts an empty nested item into an ordered list moves the later lines of the outer item it renumbers', async () => {
        expect(await typed('markdown', '8. a\n   - b\n   - c\n   - |\n9. d\n\n   e', '\n')).toBe('8. a\n   - b\n   - c\n9. |\n10. d\n\n    e');
    });

    it('Enter that renumbers an item and moves its later lines is one undo step', async () => {
        const start = (await buildTypingState('markdown', '8. a|\n9. i\n\n   j')).update({ effects: StateEffect.appendConfig.of(history()) }).state;
        const pressed = pressKey(settle(start), 'Enter');
        let undone = pressed;

        undo({ state: pressed, dispatch: (transaction) => { undone = transaction.state; } });

        expect(undoDepth(pressed)).toBe(1);
        expect(undone.doc.toString()).toBe('8. a\n9. i\n\n   j');
    });

    it('Enter that renumbers an item and moves its later lines keeps the key press as the user event', async () => {
        const events: (string | undefined)[] = [];
        const record = EditorState.transactionFilter.of((transaction) => {
            events.push(transaction.annotation(Transaction.userEvent));

            return transaction;
        });
        const settled = settle((await buildTypingState('markdown', '8. a|\n9. i\n\n   j')).update({ effects: StateEffect.appendConfig.of(record) }).state);

        events.length = 0;
        pressKey(settled, 'Enter');

        expect(events).toEqual(['input']);
    });

    it('Enter that renumbers an item keeps the blocks the list read before, with the new item', async () => {
        for (const [start, outline] of [
            ['8. a|\n9. i\n\n   j', 'ol[li[p] li[] li[p p]]'],
            ['8. a|\n9.  i\n\n    j', 'ol[li[p] li[] li[p p]]'],
            ['> 8. a|\n> 9. i\n>\n>    j', 'quote[ol[li[p] li[] li[p p]]]'],
            ['8. a|\n9. i\n\n       code', 'ol[li[p] li[] li[p code]]'],
        ]) {
            const result = await typed('markdown', start, '\n');

            expect(await languageOutline(result.replace('|', ''))).toBe(outline);
        }
    });
});

describe('CodeEditor languageOptions', () => {
    /** One deferred `loadExtension` result, resolved by the test. */
    type DeferredLoad = { options: unknown; resolve: (extension: unknown) => void };

    /**
     * Registers a test language whose three loaders record the options they
     * receive.
     *
     * @param id - The language id to register.
     * @returns The recorded arguments, one array per loader.
     */
    function registerRecordingLanguage(id: string): { extension: unknown[]; formatter: unknown[]; lint: unknown[] } {
        const calls = { extension: [] as unknown[], formatter: [] as unknown[], lint: [] as unknown[] };

        registerLanguage({
            id,
            loadExtension: async (options) => {
                calls.extension.push(options);

                return [] as any;
            },
            loadFormatter: async (options) => {
                calls.formatter.push(options);

                return async (source: string) => ({ formatted: source, cursorOffset: 0 });
            },
            loadLintSource: async (options) => {
                calls.lint.push(options);

                return () => [];
            },
        });

        return calls;
    }

    /**
     * Returns the extensions the editor's fake `dispatch` installed into its
     * grammar compartment, in dispatch order.
     *
     * @param editor - The editor (accessed through `any`).
     * @param dispatch - The fake view's `dispatch` mock.
     * @returns Each grammar reconfigure's extension.
     */
    function grammarReconfigures(editor: any, dispatch: ReturnType<typeof vi.fn>): unknown[] {
        return dispatch.mock.calls
            .map(([spec]) => spec.effects)
            .filter((effect) => effect?.value?.compartment === editor._langCompartment)
            .map((effect) => effect.value.extension);
    }

    /**
     * Lets every pending loader `.then` run: a macrotask runs only once the
     * microtask queue has drained, however many promise hops a load takes.
     */
    function flushLoads(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }

    it('defaults to {} and round-trips the construction option as a copy', () => {
        expect(new CodeEditor().getLanguageOptions()).toEqual({});

        const passed = { dialect: 'postgresql' };
        const editor = new CodeEditor(undefined, { language: 'sql', languageOptions: passed });

        passed.dialect = 'standard';

        expect(editor.getLanguageOptions()).toEqual({ dialect: 'postgresql' });

        const read = editor.getLanguageOptions();

        read.dialect = 'mutated';

        expect(editor.getLanguageOptions()).toEqual({ dialect: 'postgresql' });
    });

    it('setLanguage replaces both id and options offline; omitted options reset to {}', () => {
        const editor = new CodeEditor();
        const passed = { dialect: 'postgresql' };

        editor.setLanguage('sql', passed);
        passed.dialect = 'standard';
        expect(editor.getLanguageOptions()).toEqual({ dialect: 'postgresql' });

        editor.setLanguage('json');
        expect(editor.getLanguage()).toBe('json');
        expect(editor.getLanguageOptions()).toEqual({});

        editor.setLanguage('sql');
        expect(editor.getLanguageOptions()).toEqual({});

        editor.setLanguage('sql', { dialect: 'postgresql' });
        editor.setLanguage(null);
        expect(editor.getLanguage()).toBeNull();
        expect(editor.getLanguageOptions()).toEqual({});
    });

    it('passes a copy of the options to loadExtension when mounted, and {} when omitted', async () => {
        const calls  = registerRecordingLanguage('test-langopts-extension');
        const editor = new CodeEditor() as any;
        editor._view = { dispatch: vi.fn() };
        const passed = { dialect: 'postgresql' };

        editor.setLanguage('test-langopts-extension', passed);
        editor.setLanguage('test-langopts-extension');

        expect(calls.extension[0]).toEqual({ dialect: 'postgresql' });
        expect(calls.extension[0]).not.toBe(passed);
        expect(calls.extension[1]).toEqual({});
    });

    it('passes the options to loadLintSource', () => {
        const calls  = registerRecordingLanguage('test-langopts-lint');
        const editor = new CodeEditor(undefined, { lint: true }) as any;
        editor._view = { dispatch: vi.fn() };

        editor.setLanguage('test-langopts-lint', { a: 1 });

        expect(calls.lint).toEqual([{ a: 1 }]);
    });

    it('passes the options to loadFormatter', async () => {
        const calls  = registerRecordingLanguage('test-langopts-format');
        const editor = new CodeEditor('x', { language: 'test-langopts-format', languageOptions: { a: 1 } });

        await editor.format();

        expect(calls.formatter).toEqual([{ a: 1 }]);
    });

    it('reloads grammar and lint on a same-id re-call, applying only the latest', async () => {
        const calls    = registerRecordingLanguage('test-langopts-reload');
        const editor   = new CodeEditor(undefined, { lint: true }) as any;
        const dispatch = vi.fn();
        editor._view = { dispatch };

        editor.setLanguage('test-langopts-reload', { a: 1 });
        editor.setLanguage('test-langopts-reload', { a: 2 });
        await flushLoads();

        expect(calls.extension).toEqual([{ a: 1 }, { a: 2 }]);
        expect(calls.lint).toEqual([{ a: 1 }, { a: 2 }]);
        expect(grammarReconfigures(editor, dispatch)).toHaveLength(1);

        const lintReconfigures = dispatch.mock.calls
            .filter(([spec]) => spec.effects?.value?.compartment === editor._lintCompartment);

        expect(lintReconfigures).toHaveLength(1);
    });

    it('drops a stale grammar load that resolves after a newer one', async () => {
        const loads: DeferredLoad[] = [];

        registerLanguage({
            id: 'test-langopts-stale',
            loadExtension: (options) => new Promise((resolve) => loads.push({ options, resolve: resolve as DeferredLoad['resolve'] })),
        });

        const editor   = new CodeEditor() as any;
        const dispatch = vi.fn();
        editor._view = { dispatch };
        const pgExtension       = ['postgresql'];
        const standardExtension = ['standard'];

        editor.setLanguage('test-langopts-stale', { dialect: 'postgresql' });
        editor.setLanguage('test-langopts-stale', { dialect: 'standard' });

        loads[1].resolve(standardExtension);
        await flushLoads();
        loads[0].resolve(pgExtension);
        await flushLoads();

        expect(grammarReconfigures(editor, dispatch)).toEqual([standardExtension]);
    });

    it('keeps the construction options on the mount path', () => {
        const calls  = registerRecordingLanguage('test-langopts-mount');
        const editor = new CodeEditor(undefined, { language: 'test-langopts-mount', languageOptions: { a: 1 } }) as any;
        editor._view = { dispatch: vi.fn() };

        editor.loadActiveLanguage();

        expect(calls.extension).toEqual([{ a: 1 }]);
        expect(editor.getLanguageOptions()).toEqual({ a: 1 });
    });

    it('mount() loads the active language without resetting the construction options', () => {
        registerRecordingLanguage('test-langopts-mount-real');
        const editor = new CodeEditor(undefined, {
            language:        'test-langopts-mount-real',
            languageOptions: { a: 1 },
        }) as any;
        editor.getElement(true);

        const loadSpy        = vi.spyOn(editor, 'loadActiveLanguage');
        const setLanguageSpy = vi.spyOn(editor, 'setLanguage');

        editor.mount();

        expect(loadSpy).toHaveBeenCalledTimes(1);
        expect(setLanguageSpy).not.toHaveBeenCalled();
        expect(editor.getLanguageOptions()).toEqual({ a: 1 });
    });

    it('accepts SqlLanguageOptions as a typed variable and with satisfies', () => {
        const editor = new CodeEditor();
        const sqlOptions: SqlLanguageOptions = { dialect: 'postgresql' };

        editor.setLanguage('sql', sqlOptions);
        expect(editor.getLanguageOptions()).toEqual({ dialect: 'postgresql' });

        editor.setLanguage('sql', { dialect: 'postgresql' } satisfies SqlLanguageOptions);
        expect(editor.getLanguageOptions()).toEqual({ dialect: 'postgresql' });
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

    // isForeignWheelTarget is the carve-out CodeEditor.onWheelScroll's inherited
    // guard must consult before claiming a wheel: CodeMirror parents its own
    // tooltips (the completion list, hover/lint tooltips) inside `.cm-editor`
    // with no `parent` configured, so they sit inside this component's subtree
    // and would otherwise be claimed by the framework's eased wheel scroller —
    // stranding the list's own native scroll. TestDOM has no selector engine
    // (DOM.source.matches is an unconditional `false` stub), so the
    // `.cm-tooltip`-class match a real browser performs is mocked here,
    // mirroring how Scrollbar.test.ts's isScrollbarTarget suite mocks
    // DOM.source reads; the ancestor walk itself (getParentElement) runs
    // against the harness's real modelled parent/child structure, unmocked.
    describe('isForeignWheelTarget', () => {
        it('recognises a target under a .cm-tooltip ancestor with scroll room left (a completion list row)', () => {
            const editor = new CodeEditor();
            const editorElement = editor.getElement(true)!;

            const tooltip = DOM.sink.createElement('div');
            const list = DOM.sink.createElement('ul');
            const row = DOM.sink.createElement('li');
            DOM.sink.appendChild(editorElement, tooltip);
            DOM.sink.appendChild(tooltip, list);
            DOM.sink.appendChild(list, row);

            vi.spyOn(DOM.source, 'matches').mockImplementation(
                (h: unknown, selector: string) => selector === '.cm-tooltip' && h === tooltip
            );
            // `list` is the completion list's own scrollable `ul` — the only
            // handle in this chain that is both `overflow-y: auto` and has
            // anything left to scroll.
            vi.spyOn(DOM.source, 'getComputedOverflow').mockImplementation((h: unknown) =>
                h === list
                    ? { overflow: 'hidden auto', overflowX: 'hidden', overflowY: 'auto' }
                    : { overflow: 'visible', overflowX: 'visible', overflowY: 'visible' }
            );
            vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation((h: unknown) =>
                h === list
                    ? { scrollTop: 0, scrollLeft: 0, scrollWidth: 100, scrollHeight: 300, clientWidth: 100, clientHeight: 100 }
                    : { scrollTop: 0, scrollLeft: 0, scrollWidth: 100, scrollHeight: 100, clientWidth: 100, clientHeight: 100 }
            );

            expect((editor as any).isForeignWheelTarget(makeEvent(row, 'wheel', { deltaY: 120 }))).toBe(true);
        });

        it('returns false for a .cm-tooltip ancestor with no scrollable descendant at all', () => {
            const editor = new CodeEditor();
            const editorElement = editor.getElement(true)!;

            // A hover/lint tooltip: plain text with no `overflow: auto`
            // anywhere. The default (unmocked) getComputedOverflow reports
            // 'visible' and the default getScrollMetrics reports no extent,
            // so this is exactly the fixture that shape needs.
            const tooltip = DOM.sink.createElement('div');
            const message = DOM.sink.createElement('div');
            DOM.sink.appendChild(editorElement, tooltip);
            DOM.sink.appendChild(tooltip, message);

            vi.spyOn(DOM.source, 'matches').mockImplementation(
                (h: unknown, selector: string) => selector === '.cm-tooltip' && h === tooltip
            );

            expect((editor as any).isForeignWheelTarget(makeEvent(message, 'wheel', { deltaY: 120 }))).toBe(false);
        });

        it('at the bottom bound: a further downward wheel has no room, but an upward one does', () => {
            const editor = new CodeEditor();
            const editorElement = editor.getElement(true)!;

            const tooltip = DOM.sink.createElement('div');
            const list = DOM.sink.createElement('ul');
            const row = DOM.sink.createElement('li');
            DOM.sink.appendChild(editorElement, tooltip);
            DOM.sink.appendChild(tooltip, list);
            DOM.sink.appendChild(list, row);

            vi.spyOn(DOM.source, 'matches').mockImplementation(
                (h: unknown, selector: string) => selector === '.cm-tooltip' && h === tooltip
            );
            vi.spyOn(DOM.source, 'getComputedOverflow').mockImplementation((h: unknown) =>
                h === list
                    ? { overflow: 'hidden auto', overflowX: 'hidden', overflowY: 'auto' }
                    : { overflow: 'visible', overflowX: 'visible', overflowY: 'visible' }
            );
            // scrollTop + clientHeight === scrollHeight: already at the bottom,
            // so a further downward wheel (deltaY > 0) has nowhere to go, but
            // scrollTop > 0 means an upward one (deltaY < 0) does.
            vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation((h: unknown) =>
                h === list
                    ? { scrollTop: 200, scrollLeft: 0, scrollWidth: 100, scrollHeight: 300, clientWidth: 100, clientHeight: 100 }
                    : { scrollTop: 0, scrollLeft: 0, scrollWidth: 100, scrollHeight: 100, clientWidth: 100, clientHeight: 100 }
            );

            expect((editor as any).isForeignWheelTarget(makeEvent(row, 'wheel', { deltaY: 120 }))).toBe(false);
            expect((editor as any).isForeignWheelTarget(makeEvent(row, 'wheel', { deltaY: -120 }))).toBe(true);
        });

        it('at the top bound: a further upward wheel has no room, but a downward one does', () => {
            const editor = new CodeEditor();
            const editorElement = editor.getElement(true)!;

            const tooltip = DOM.sink.createElement('div');
            const list = DOM.sink.createElement('ul');
            const row = DOM.sink.createElement('li');
            DOM.sink.appendChild(editorElement, tooltip);
            DOM.sink.appendChild(tooltip, list);
            DOM.sink.appendChild(list, row);

            vi.spyOn(DOM.source, 'matches').mockImplementation(
                (h: unknown, selector: string) => selector === '.cm-tooltip' && h === tooltip
            );
            vi.spyOn(DOM.source, 'getComputedOverflow').mockImplementation((h: unknown) =>
                h === list
                    ? { overflow: 'hidden auto', overflowX: 'hidden', overflowY: 'auto' }
                    : { overflow: 'visible', overflowX: 'visible', overflowY: 'visible' }
            );
            // Scrolled all the way to the top: room to go down, none to go up.
            vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation((h: unknown) =>
                h === list
                    ? { scrollTop: 0, scrollLeft: 0, scrollWidth: 100, scrollHeight: 300, clientWidth: 100, clientHeight: 100 }
                    : { scrollTop: 0, scrollLeft: 0, scrollWidth: 100, scrollHeight: 100, clientWidth: 100, clientHeight: 100 }
            );

            expect((editor as any).isForeignWheelTarget(makeEvent(row, 'wheel', { deltaY: 120 }))).toBe(true);
            expect((editor as any).isForeignWheelTarget(makeEvent(row, 'wheel', { deltaY: -120 }))).toBe(false);
        });

        it('is direction-aware horizontally too: room to scroll right does not imply room to scroll left', () => {
            const editor = new CodeEditor();
            const editorElement = editor.getElement(true)!;

            const tooltip = DOM.sink.createElement('div');
            const list = DOM.sink.createElement('ul');
            const row = DOM.sink.createElement('li');
            DOM.sink.appendChild(editorElement, tooltip);
            DOM.sink.appendChild(tooltip, list);
            DOM.sink.appendChild(list, row);

            vi.spyOn(DOM.source, 'matches').mockImplementation(
                (h: unknown, selector: string) => selector === '.cm-tooltip' && h === tooltip
            );
            vi.spyOn(DOM.source, 'getComputedOverflow').mockImplementation((h: unknown) =>
                h === list
                    ? { overflow: 'auto', overflowX: 'auto', overflowY: 'visible' }
                    : { overflow: 'visible', overflowX: 'visible', overflowY: 'visible' }
            );

            const metrics = vi.spyOn(DOM.source, 'getScrollMetrics');

            // Scrolled all the way to the left: room to go right, none left.
            metrics.mockImplementation((h: unknown) =>
                h === list
                    ? { scrollTop: 0, scrollLeft: 0, scrollWidth: 300, scrollHeight: 100, clientWidth: 100, clientHeight: 100 }
                    : { scrollTop: 0, scrollLeft: 0, scrollWidth: 100, scrollHeight: 100, clientWidth: 100, clientHeight: 100 }
            );
            expect((editor as any).isForeignWheelTarget(makeEvent(row, 'wheel', { deltaX: 60 }))).toBe(true);
            expect((editor as any).isForeignWheelTarget(makeEvent(row, 'wheel', { deltaX: -60 }))).toBe(false);

            // Scrolled all the way to the right: room to go left, none right.
            metrics.mockImplementation((h: unknown) =>
                h === list
                    ? { scrollTop: 0, scrollLeft: 200, scrollWidth: 300, scrollHeight: 100, clientWidth: 100, clientHeight: 100 }
                    : { scrollTop: 0, scrollLeft: 0, scrollWidth: 100, scrollHeight: 100, clientWidth: 100, clientHeight: 100 }
            );
            expect((editor as any).isForeignWheelTarget(makeEvent(row, 'wheel', { deltaX: 60 }))).toBe(false);
            expect((editor as any).isForeignWheelTarget(makeEvent(row, 'wheel', { deltaX: -60 }))).toBe(true);
        });

        // The concrete leak a second audit round found in a first pass at this
        // fix, which checked extent alone: CodeMirror's own theme gives a
        // completion row `overflow-x: hidden; text-overflow: ellipsis`, so a
        // long label reports `scrollWidth > clientWidth` while being no more
        // scrollable than plain clipped text. Extent without a matching
        // `overflow: auto`/`scroll` must not count as room.
        it('returns false for overflowing content that is not actually scrollable (an ellipsised row)', () => {
            const editor = new CodeEditor();
            const editorElement = editor.getElement(true)!;

            const tooltip = DOM.sink.createElement('div');
            const list = DOM.sink.createElement('ul');
            const row = DOM.sink.createElement('li');
            DOM.sink.appendChild(editorElement, tooltip);
            DOM.sink.appendChild(tooltip, list);
            DOM.sink.appendChild(list, row);

            vi.spyOn(DOM.source, 'matches').mockImplementation(
                (h: unknown, selector: string) => selector === '.cm-tooltip' && h === tooltip
            );
            // `row` is `overflow-x: hidden` (CodeMirror's own ellipsis theme)
            // yet reports horizontal overflow — hidden, not scrollable.
            vi.spyOn(DOM.source, 'getComputedOverflow').mockImplementation((h: unknown) =>
                h === row
                    ? { overflow: 'hidden', overflowX: 'hidden', overflowY: 'visible' }
                    : { overflow: 'visible', overflowX: 'visible', overflowY: 'visible' }
            );
            vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation((h: unknown) =>
                h === row
                    ? { scrollTop: 0, scrollLeft: 0, scrollWidth: 300, scrollHeight: 100, clientWidth: 100, clientHeight: 100 }
                    : { scrollTop: 0, scrollLeft: 0, scrollWidth: 100, scrollHeight: 100, clientWidth: 100, clientHeight: 100 }
            );

            expect((editor as any).isForeignWheelTarget(makeEvent(row, 'wheel', { deltaX: 60 }))).toBe(false);
        });

        // The vertical analogue of the ellipsised-row case above: extent
        // without a matching overflow-y value must not count as room either.
        it('returns false for vertically overflowing content that is not actually scrollable (overflow-y hidden)', () => {
            const editor = new CodeEditor();
            const editorElement = editor.getElement(true)!;

            const tooltip = DOM.sink.createElement('div');
            const list = DOM.sink.createElement('ul');
            const row = DOM.sink.createElement('li');
            DOM.sink.appendChild(editorElement, tooltip);
            DOM.sink.appendChild(tooltip, list);
            DOM.sink.appendChild(list, row);

            vi.spyOn(DOM.source, 'matches').mockImplementation(
                (h: unknown, selector: string) => selector === '.cm-tooltip' && h === tooltip
            );
            // `list` reports vertical extent (scrollHeight > clientHeight) but
            // its computed overflow-y is `hidden`, not `auto`/`scroll`.
            vi.spyOn(DOM.source, 'getComputedOverflow').mockImplementation((h: unknown) =>
                h === list
                    ? { overflow: 'hidden', overflowX: 'visible', overflowY: 'hidden' }
                    : { overflow: 'visible', overflowX: 'visible', overflowY: 'visible' }
            );
            vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation((h: unknown) =>
                h === list
                    ? { scrollTop: 0, scrollLeft: 0, scrollWidth: 100, scrollHeight: 300, clientWidth: 100, clientHeight: 100 }
                    : { scrollTop: 0, scrollLeft: 0, scrollWidth: 100, scrollHeight: 100, clientWidth: 100, clientHeight: 100 }
            );

            expect((editor as any).isForeignWheelTarget(makeEvent(row, 'wheel', { deltaY: 120 }))).toBe(false);
        });

        it('returns false for ordinary editor content', () => {
            const editor = new CodeEditor();
            const editorElement = editor.getElement(true)!;

            const line = DOM.sink.createElement('div');
            DOM.sink.appendChild(editorElement, line);

            vi.spyOn(DOM.source, 'matches').mockReturnValue(false);

            expect((editor as any).isForeignWheelTarget(makeEvent(line, 'wheel', { deltaY: 120 }))).toBe(false);
        });

        it('returns false for a non-node target, without throwing', () => {
            const editor = new CodeEditor();
            editor.getElement(true);

            expect((editor as any).isForeignWheelTarget({ target: null })).toBe(false);
        });

        it("stops the climb at the editor's own element", () => {
            const editor = new CodeEditor();
            const editorElement = editor.getElement(true)!;

            const outer = DOM.sink.createElement('div');
            const child = DOM.sink.createElement('div');
            DOM.sink.appendChild(outer, editorElement);
            DOM.sink.appendChild(editorElement, child);

            // Matches `.cm-tooltip` only for `outer` — reachable only if the
            // walk kept going past the editor's own element. `outer` is also
            // given real scroll room: if the `handle === root` stop were ever
            // removed, the climb would reach `outer`, match it, and
            // `hasWheelExtent` would report `true` there, flipping this
            // test's expectation instead of silently agreeing with it.
            vi.spyOn(DOM.source, 'matches').mockImplementation(
                (h: unknown, selector: string) => selector === '.cm-tooltip' && h === outer
            );
            vi.spyOn(DOM.source, 'getComputedOverflow').mockImplementation((h: unknown) =>
                h === outer
                    ? { overflow: 'hidden auto', overflowX: 'hidden', overflowY: 'auto' }
                    : { overflow: 'visible', overflowX: 'visible', overflowY: 'visible' }
            );
            vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation((h: unknown) =>
                h === outer
                    ? { scrollTop: 0, scrollLeft: 0, scrollWidth: 100, scrollHeight: 300, clientWidth: 100, clientHeight: 100 }
                    : { scrollTop: 0, scrollLeft: 0, scrollWidth: 100, scrollHeight: 100, clientWidth: 100, clientHeight: 100 }
            );

            expect((editor as any).isForeignWheelTarget(makeEvent(child, 'wheel', { deltaY: 120 }))).toBe(false);
        });
    });

    describe('onWheelScroll and isForeignWheelTarget', () => {
        it('claims a foreign-target wheel without preventing it', () => {
            const editor = new CodeEditor();
            const editorElement = editor.getElement(true)!;

            const tooltip = DOM.sink.createElement('div');
            const list = DOM.sink.createElement('ul');
            const row = DOM.sink.createElement('li');
            DOM.sink.appendChild(editorElement, tooltip);
            DOM.sink.appendChild(tooltip, list);
            DOM.sink.appendChild(list, row);

            vi.spyOn(DOM.source, 'matches').mockImplementation(
                (h: unknown, selector: string) => selector === '.cm-tooltip' && h === tooltip
            );
            vi.spyOn(DOM.source, 'getComputedOverflow').mockImplementation((h: unknown) =>
                h === list
                    ? { overflow: 'hidden auto', overflowX: 'hidden', overflowY: 'auto' }
                    : { overflow: 'visible', overflowX: 'visible', overflowY: 'visible' }
            );
            vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation((h: unknown) =>
                h === list
                    ? { scrollTop: 0, scrollLeft: 0, scrollWidth: 100, scrollHeight: 300, clientWidth: 100, clientHeight: 100 }
                    : { scrollTop: 0, scrollLeft: 0, scrollWidth: 100, scrollHeight: 100, clientWidth: 100, clientHeight: 100 }
            );

            const e = makeEvent(row, 'wheel', { deltaY: 120 });
            const result = (editor as any).onWheelScroll(e);

            expect(result).toBeUndefined();
            expect((e as any)._tsScrollConsumed).toBe(true);
        });

        // The audit-driven fix behind `hasWheelExtent`: a tooltip with nothing
        // left to scroll must not disarm an enclosing overlay's WheelTrap
        // (core/WheelTrap.ts) by claiming a wheel it cannot itself absorb — see
        // that helper's doc for the failure this closes (a wheel chaining past
        // a modal's trap to the page behind it). Falling through to the normal
        // claim-and-prevent path, exercised here, is the safe alternative: the
        // editor's own eased scroller absorbs it instead.
        it('falls through to claim-and-prevent when the matched tooltip has no scroll room', () => {
            const editor = new CodeEditor();
            const editorElement = editor.getElement(true)!;

            const tooltip = DOM.sink.createElement('div');
            const message = DOM.sink.createElement('div');
            DOM.sink.appendChild(editorElement, tooltip);
            DOM.sink.appendChild(tooltip, message);

            vi.spyOn(DOM.source, 'matches').mockImplementation(
                (h: unknown, selector: string) => selector === '.cm-tooltip' && h === tooltip
            );
            vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation((h: unknown) =>
                h === editorElement
                    ? { scrollTop: 0, scrollLeft: 0, scrollWidth: 400, scrollHeight: 900, clientWidth: 400, clientHeight: 300 }
                    : { scrollTop: 0, scrollLeft: 0, scrollWidth: 100, scrollHeight: 100, clientWidth: 100, clientHeight: 100 }
            );

            const e = makeEvent(message, 'wheel', { deltaY: 120 });
            const result = (editor as any).onWheelScroll(e);

            expect(result).toEqual({ prevent: true });
            expect((e as any)._tsScrollConsumed).toBe(true);
        });

        it('still claims and prevents an ordinary wheel over a scrollable axis', () => {
            const editor = new CodeEditor();
            const editorElement = editor.getElement(true)!;

            vi.spyOn(DOM.source, 'matches').mockReturnValue(false);
            vi.spyOn(DOM.source, 'getScrollMetrics').mockReturnValue({
                scrollTop: 0, scrollLeft: 0,
                scrollWidth: 400, scrollHeight: 900,
                clientWidth: 400, clientHeight: 300,
            });

            const e = makeEvent(editorElement, 'wheel', { deltaY: 120 });
            const result = (editor as any).onWheelScroll(e);

            expect(result).toEqual({ prevent: true });
            expect((e as any)._tsScrollConsumed).toBe(true);
        });
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

describe('CodeEditor clipboard commands', () => {
    /** A minimal duck-typed `EditorView`, matching this file's `_view` convention (see `'CodeEditor format() dispatch'`). */
    function fakeView(text: string, from: number, to: number, dispatch: (spec: unknown) => void = vi.fn()) {
        return {
            state: {
                sliceDoc:  (f: number, t: number) => text.slice(f, t),
                selection: { main: { from, to, empty: from === to } },
            },
            dispatch,
            focus: vi.fn(),
        };
    }

    /** The clipboard-write args recorded by `copy()`/`cut()`, in call order. */
    function clipboardWrites(): unknown[] {
        return (DOM.sink as RecordingDOMSink).writes
            .filter((w) => w.op === 'writeClipboardText')
            .map((w) => w.args[0]);
    }

    it('copy() records a write carrying the primary selection\'s text when it is non-empty', () => {
        const editor = new CodeEditor() as any;
        editor._view = fakeView('hello world', 0, 5);

        editor.copy();

        expect(clipboardWrites()).toEqual(['hello']);
    });

    it('copy() records no write when the primary selection is collapsed', () => {
        const editor = new CodeEditor() as any;
        editor._view = fakeView('hello world', 3, 3);

        editor.copy();

        expect(clipboardWrites()).toHaveLength(0);
    });

    it('copy() is a no-op when _view is null', () => {
        const editor = new CodeEditor() as any;

        expect(() => editor.copy()).not.toThrow();
        expect(clipboardWrites()).toHaveLength(0);
    });

    it('cut() records the write and dispatches a delete of the primary selection when it is non-empty', () => {
        const editor = new CodeEditor() as any;
        const dispatchSpy = vi.fn();
        editor._view = fakeView('hello world', 0, 5, dispatchSpy);

        editor.cut();

        expect(clipboardWrites()).toEqual(['hello']);
        expect(dispatchSpy).toHaveBeenCalledOnce();

        const spec = dispatchSpy.mock.calls[0][0] as { changes: { from: number; to: number; insert?: string } };

        expect(spec.changes).toEqual({ from: 0, to: 5 });
        expect(spec.changes.insert).toBeUndefined();
    });

    it('cut() records no write and dispatches nothing when the primary selection is collapsed', () => {
        const editor = new CodeEditor() as any;
        const dispatchSpy = vi.fn();
        editor._view = fakeView('hello world', 3, 3, dispatchSpy);

        editor.cut();

        expect(clipboardWrites()).toHaveLength(0);
        expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('cut() is a no-op when _view is null', () => {
        const editor = new CodeEditor() as any;

        expect(() => editor.cut()).not.toThrow();
        expect(clipboardWrites()).toHaveLength(0);
    });

    it('cut() on a read-only editor copies nothing and removes nothing, and signals the rejected edit', () => {
        const editor = new CodeEditor('hello world', { readOnly: true }) as any;
        const dispatchSpy = vi.fn();
        const rejected = vi.fn();

        editor._view = fakeView('hello world', 0, 5, dispatchSpy);
        editor.on('readonlyedit', rejected);

        editor.cut();

        expect(clipboardWrites()).toHaveLength(0);
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(rejected).toHaveBeenCalledOnce();
    });

    it('copy() on a read-only editor still copies, and signals nothing', () => {
        const editor = new CodeEditor('hello world', { readOnly: true }) as any;
        const rejected = vi.fn();

        editor._view = fakeView('hello world', 0, 5);
        editor.on('readonlyedit', rejected);

        editor.copy();

        expect(clipboardWrites()).toEqual(['hello']);
        expect(rejected).not.toHaveBeenCalled();
    });

    it('paste() on a read-only editor resolves false without reading the clipboard, inserts nothing, and signals the rejected edit', async () => {
        const editor = new CodeEditor('hello world', { readOnly: true }) as any;
        const dispatchSpy = vi.fn();
        const rejected = vi.fn();
        const readSpy = vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

        editor._view = fakeView('hello world', 3, 3, dispatchSpy);
        editor.on('readonlyedit', rejected);

        expect(await editor.paste()).toBe(false);
        expect(readSpy).not.toHaveBeenCalled();
        expect(dispatchSpy).not.toHaveBeenCalled();
        expect(rejected).toHaveBeenCalledOnce();
    });

    it('paste() resolves false and never calls readClipboardText when _view is null', async () => {
        const editor = new CodeEditor() as any;
        const readSpy = vi.spyOn(DOM.source, 'readClipboardText');

        const result = await editor.paste();

        expect(result).toBe(false);
        expect(readSpy).not.toHaveBeenCalled();
    });

    it('paste() resolves false and dispatches nothing when the clipboard read resolves null', async () => {
        const editor = new CodeEditor() as any;
        const dispatchSpy = vi.fn();
        editor._view = fakeView('hello world', 3, 3, dispatchSpy);
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue(null);

        const result = await editor.paste();

        expect(result).toBe(false);
        expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('paste() resolves true and dispatches nothing when the clipboard read resolves ""', async () => {
        const editor = new CodeEditor() as any;
        const dispatchSpy = vi.fn();
        editor._view = fakeView('hello world', 3, 3, dispatchSpy);
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('');

        const result = await editor.paste();

        expect(result).toBe(true);
        expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('paste() dispatches an insert at a collapsed caret, with the anchor after the inserted text', async () => {
        const editor = new CodeEditor() as any;
        const dispatchSpy = vi.fn();
        editor._view = fakeView('hello world', 5, 5, dispatchSpy);
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('XY');

        const result = await editor.paste();

        expect(result).toBe(true);
        expect(dispatchSpy).toHaveBeenCalledOnce();
        expect(dispatchSpy.mock.calls[0][0]).toMatchObject({
            changes:   { from: 5, to: 5, insert: 'XY' },
            selection: { anchor: 7 },
        });
    });

    it('paste() dispatches a replace of a non-empty selection, with the same anchor formula', async () => {
        const editor = new CodeEditor() as any;
        const dispatchSpy = vi.fn();
        editor._view = fakeView('hello world', 0, 5, dispatchSpy);
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('XY');

        const result = await editor.paste();

        expect(result).toBe(true);
        expect(dispatchSpy.mock.calls[0][0]).toMatchObject({
            changes:   { from: 0, to: 5, insert: 'XY' },
            selection: { anchor: 2 },
        });
    });

    it('dispatches a clipboard read containing a newline verbatim, with no splitting', async () => {
        const editor = new CodeEditor() as any;
        const dispatchSpy = vi.fn();
        editor._view = fakeView('hello world', 0, 0, dispatchSpy);
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('a\nb');

        await editor.paste();

        expect(dispatchSpy.mock.calls[0][0]).toMatchObject({ changes: { from: 0, to: 0, insert: 'a\nb' } });
    });

    // Clicking a context-menu row blurs the view via the browser's default
    // mousedown-elsewhere behaviour (the same class of problem PickerColumn.ts's
    // handlePointerDown prevents for a picker cell, and TextInput.copy/cut/paste
    // now guard against too); each command restores focus afterward so the
    // editor doesn't appear to have lost it once the menu closes.
    it('copy() with a selection restores focus to the view', () => {
        const editor = new CodeEditor() as any;
        editor._view = fakeView('hello world', 0, 5);

        editor.copy();

        expect(editor._view.focus).toHaveBeenCalledOnce();
    });

    it('cut() with a selection restores focus to the view', () => {
        const editor = new CodeEditor() as any;
        editor._view = fakeView('hello world', 0, 5);

        editor.cut();

        expect(editor._view.focus).toHaveBeenCalledOnce();
    });

    it('paste() with clipboard content restores focus to the view', async () => {
        const editor = new CodeEditor() as any;
        editor._view = fakeView('hello world', 5, 5);
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('XY');

        await editor.paste();

        expect(editor._view.focus).toHaveBeenCalledOnce();
    });

    it('paste() with an empty clipboard still restores focus to the view', async () => {
        const editor = new CodeEditor() as any;
        editor._view = fakeView('hello world', 3, 3);
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('');

        await editor.paste();

        expect(editor._view.focus).toHaveBeenCalledOnce();
    });

    it('paste() with a denied read still restores focus to the view', async () => {
        const editor = new CodeEditor() as any;
        editor._view = fakeView('hello world', 3, 3);
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue(null);

        await editor.paste();

        expect(editor._view.focus).toHaveBeenCalledOnce();
    });
});

describe('CodeEditor context menu', () => {
    /** Reaches CodeEditor's private context-menu builder/handler methods for white-box assertions. */
    function contextMenuMethodsOf(editor: CodeEditor): {
        buildContextMenuItems(hasSelectedText: boolean): MenuItemConfig[];
        handleContextMenu(event: MouseEvent, view: EditorView): void;
        pasteFromContextMenu(): Promise<void>;
        _contextMenu: { show: (...args: unknown[]) => void };
    } {
        return editor as unknown as {
            buildContextMenuItems(hasSelectedText: boolean): MenuItemConfig[];
            handleContextMenu(event: MouseEvent, view: EditorView): void;
            pasteFromContextMenu(): Promise<void>;
            _contextMenu: { show: (...args: unknown[]) => void };
        };
    }

    /** Strips each item's `action` closure so two separately-built item arrays compare structurally equal. */
    function withoutActions(items: MenuItemConfig[]): unknown[] {
        return items.map(({ action, ...rest }) => rest);
    }

    // Notification's history and live-toast queue are private static state that
    // persist across tests; clear both so each case starts clean, matching
    // markdown-editor.test.ts's 'MarkdownEditor context-menu paste target' setup.
    function clearNotificationStatics(): void {
        (Notification as unknown as { history: unknown[]; activeNotifications: unknown[] }).history = [];
        (Notification as unknown as { history: unknown[]; activeNotifications: unknown[] }).activeNotifications = [];
    }

    beforeEach(clearNotificationStatics);
    afterEach(clearNotificationStatics);

    it('buildContextMenuItems(true) on a non-read-only editor returns Cut/Copy (enabled) and Paste, in order', () => {
        const editor = new CodeEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems(true);

        expect(items.map((item) => item.text)).toEqual(['Cut', 'Copy', 'Paste']);
        expect(items[0].enabled).toBe(true);
        expect(items[1].enabled).toBe(true);
        expect(items[2].enabled).toBeUndefined();
    });

    it('buildContextMenuItems(false) on a non-read-only editor dims Cut and Copy', () => {
        const editor = new CodeEditor();
        const items = contextMenuMethodsOf(editor).buildContextMenuItems(false);

        expect(items.map((item) => item.text)).toEqual(['Cut', 'Copy', 'Paste']);
        expect(items[0].enabled).toBe(false);
        expect(items[1].enabled).toBe(false);
    });

    it('buildContextMenuItems(true) on a read-only editor returns exactly one row: Copy, enabled', () => {
        const editor = new CodeEditor();
        editor.setReadOnly(true);

        const items = contextMenuMethodsOf(editor).buildContextMenuItems(true);

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ text: 'Copy', enabled: true });
    });

    it('buildContextMenuItems(false) on a read-only editor returns exactly one row: Copy, dimmed', () => {
        const editor = new CodeEditor();
        editor.setReadOnly(true);

        const items = contextMenuMethodsOf(editor).buildContextMenuItems(false);

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ text: 'Copy', enabled: false });
    });

    it('each row\'s action reaches the matching command exactly once', () => {
        const editor = new CodeEditor() as any;
        const cutSpy = vi.spyOn(editor, 'cut').mockImplementation(() => editor);
        const copySpy = vi.spyOn(editor, 'copy').mockImplementation(() => editor);
        const pasteSpy = vi.spyOn(editor, 'pasteFromContextMenu').mockResolvedValue(undefined);

        const items = contextMenuMethodsOf(editor).buildContextMenuItems(true);

        items.find((item) => item.text === 'Cut')?.action?.();
        items.find((item) => item.text === 'Copy')?.action?.();
        items.find((item) => item.text === 'Paste')?.action?.();

        expect(cutSpy).toHaveBeenCalledOnce();
        expect(copySpy).toHaveBeenCalledOnce();
        expect(pasteSpy).toHaveBeenCalledOnce();
    });

    it('handleContextMenu forwards clientX/clientY and the built items to _contextMenu.show', () => {
        const editor = new CodeEditor() as any;
        const showSpy = vi.spyOn(contextMenuMethodsOf(editor)._contextMenu, 'show').mockImplementation(() => {});

        for (const empty of [true, false]) {
            showSpy.mockClear();

            const event = { clientX: 42, clientY: 99 } as MouseEvent;
            const view = { state: { selection: { main: { empty } } } } as EditorView;

            contextMenuMethodsOf(editor).handleContextMenu(event, view);

            const expectedItems = contextMenuMethodsOf(editor).buildContextMenuItems(!empty);

            expect(showSpy).toHaveBeenCalledOnce();

            const [x, y, items] = showSpy.mock.calls[0];

            expect(x).toBe(42);
            expect(y).toBe(99);
            expect(withoutActions(items as MenuItemConfig[])).toEqual(withoutActions(expectedItems));
        }
    });

    it('pasteFromContextMenu shows a "warning" toast when paste() resolves false, and none when it resolves true', async () => {
        const editor = new CodeEditor() as any;

        // _view stays null, so paste() resolves false without reading the clipboard.
        await contextMenuMethodsOf(editor).pasteFromContextMenu();

        let history = Notification.getHistory();
        expect(history).toHaveLength(1);
        expect(history[0].type).toBe('warning');
        // Mirrors CodeEditor.ts's private CLIPBOARD_READ_DENIED_MESSAGE constant.
        expect(history[0].message).toBe('Clipboard read blocked by the browser — press Ctrl/Cmd+V to paste.');

        editor._view = { state: { sliceDoc: () => '', selection: { main: { from: 0, to: 0, empty: true } } }, dispatch: vi.fn(), focus: vi.fn() };
        vi.spyOn(DOM.source, 'readClipboardText').mockResolvedValue('X');

        await contextMenuMethodsOf(editor).pasteFromContextMenu();

        history = Notification.getHistory();
        expect(history).toHaveLength(1);   // unchanged: a successful paste appends nothing
    });
});

describe('CodeEditor floating search panel', () => {
    it('registers exactly one child, undisplayed, with no controls built yet', () => {
        const editor = new CodeEditor() as any;

        expect(editor.getComponents().length).toBe(1);
        expect(editor.getComponents()[0]).toBe(editor._searchPanel);
        expect(editor._searchPanel.isDisplayed()).toBe(false);
        expect(editor._searchPanel.isBuilt()).toBe(false);
    });

    it('uses a per-instance Anchor layout manager', () => {
        const a = new CodeEditor();
        const b = new CodeEditor();

        expect(a.getLayoutManager()).toBeInstanceOf(Anchor);
        expect(b.getLayoutManager()).toBeInstanceOf(Anchor);
        expect(a.getLayoutManager()).not.toBe(b.getLayoutManager());
    });

    it('setSearchPanelOpen(true) builds controls and displays the panel; setSearchPanelOpen(false) hides it', () => {
        const editor = new CodeEditor() as any;

        editor.setSearchPanelOpen(true);
        expect(editor._searchPanel.isBuilt()).toBe(true);
        expect(editor._searchPanel.isDisplayed()).toBe(true);

        const childCountAfterFirstOpen = editor._searchPanel.getComponents().length;

        editor.setSearchPanelOpen(false);
        expect(editor._searchPanel.isDisplayed()).toBe(false);

        // A second open does not rebuild the already-built controls — the
        // panel's own buildControls() no-ops past the first call (see
        // code-editor-search-panel.test.ts), so the child count is unchanged.
        editor.setSearchPanelOpen(true);
        expect(editor._searchPanel.isDisplayed()).toBe(true);
        expect(editor._searchPanel.getComponents().length).toBe(childCountAfterFirstOpen);
    });

    it('buildSearchQuery maps every field, leaving literal at its default of false', () => {
        const editor = new CodeEditor() as any;

        const query = editor.buildSearchQuery({
            search: 'ab', replace: 'cd', caseSensitive: true, wholeWord: false, regexp: true,
        });

        expect(query.search).toBe('ab');
        expect(query.replace).toBe('cd');
        expect(query.caseSensitive).toBe(true);
        expect(query.wholeWord).toBe(false);
        expect(query.regexp).toBe(true);
        expect(query.literal).toBe(false);
    });

    it('runSearchCommand and applySearchQuery are no-ops with no mounted view', () => {
        const editor = new CodeEditor() as any;

        expect(editor._view).toBeNull();

        expect(() => editor.runSearchCommand('findnext')).not.toThrow();
        expect(() => editor.applySearchQuery({
            search: 'x', replace: '', caseSensitive: false, wholeWord: false, regexp: false,
        })).not.toThrow();
    });

    // Regression, found live: the find field's own uncommitted-edit tracking
    // (it's a real TextField/AbstractInput child) folds up through
    // Component.wireChild with no opt-out, so typing a search query used to
    // flip this editor's own document-dirty isDirty() true — see
    // CodeEditorSearchPanel.notifyQueryChange's markClean() calls.
    it('typing into the search panel\'s find field does not mark the editor dirty', () => {
        const editor = new CodeEditor() as any;

        expect(editor.isDirty()).toBe(false);

        editor.setSearchPanelOpen(true);
        editor._searchPanel._findField.setText('needle');
        editor._searchPanel._findField.notifyChange('needle');
        editor._searchPanel.handleFindFieldChange();

        expect(editor.isDirty()).toBe(false);
    });
});

// The read-only flash is a pulse on an overlay whose element handle the editor's
// teardown releases. A format that resumes after a dispose still asks for
// the flash, which must find nothing to play on. The unit tests never build a live
// view, so the overlay is mounted by hand.
describe('CodeEditor — read-only flash after dispose', () => {
    const FLASH_AFTER_DISPOSE_LANG = 'test-flash-after-dispose-lang';

    afterEach(() => vi.restoreAllMocks());

    it('flashReadOnly() after dispose() plays nothing and forgets the overlay', () => {
        const editor = new CodeEditor('x', { readOnly: true }) as any;

        editor.mountFlashOverlay(editor.getElement(true));
        editor.dispose();

        const play = vi.spyOn(Animation, 'play');

        editor.flashReadOnly();

        expect(play).not.toHaveBeenCalled();
        expect(editor._flash._overlay).toBeNull();
    });

    it('format() whose editor became read-only and was disposed meanwhile still resolves', async () => {
        const editor = new CodeEditor('lower', { language: FLASH_AFTER_DISPOSE_LANG }) as any;
        let resolveFormatter!: (formatter: Formatter) => void;

        registerLanguage({
            id: FLASH_AFTER_DISPOSE_LANG,
            loadExtension: async () => [] as any,
            loadFormatter: () => new Promise<Formatter>(resolve => { resolveFormatter = resolve; }),
        });

        editor.mountFlashOverlay(editor.getElement(true));

        const formatting = editor.format();

        editor.setReadOnly(true);
        editor.dispose();
        resolveFormatter(async (source: string) => ({ formatted: source.toUpperCase(), cursorOffset: 0 }));

        await expect(formatting).resolves.toBeUndefined();
    });
});
