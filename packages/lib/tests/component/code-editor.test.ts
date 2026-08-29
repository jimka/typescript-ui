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
