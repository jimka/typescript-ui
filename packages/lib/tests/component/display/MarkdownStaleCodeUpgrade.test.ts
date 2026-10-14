// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Coverage for a fenced block's deferred CodeEditor kickoff outliving the
// render that queued it (plans/markdown-viewer-stale-code-upgrade-kickoff.md,
// cases K1-K9).
//
// The offline sink's `requestAnimationFrame` is a no-op recorder, so these
// spy on it to drive the layout flush — the same shim `AfterNextLayout.test.ts`
// and `LayoutFlushIsolation.test.ts` use. `loadCodeEditorUpgrade` is stubbed,
// so no test loads CodeMirror: a started import is one recorded call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Markdown } from '~/component/display/Markdown';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { Diagnostics } from '~/core/Diagnostics';
import { DOM } from '~/core/DOM';
import { Fit } from '~/layout/Fit';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const FENCE_A = 'para\n\n```js\nlet a = 1;\n```\n';
const FENCE_B = 'para\n\n```js\nlet b = 2;\n```\n';

describe('Markdown fenced code block — a kickoff that outlived its render', () => {
    let frames: Array<FrameRequestCallback>;
    let connected: boolean;
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let loadSpy: ReturnType<typeof vi.spyOn>;
    let layoutErrorsBefore: number;

    beforeEach(() => {
        installTestDOM(CONFIG);
        frames = [];
        connected = true;
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            frames.push(cb);

            return frames.length;
        });
        vi.spyOn(DOM.source, 'isConnected').mockImplementation(() => connected);
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        loadSpy = vi.spyOn(Markdown.prototype as any, 'loadCodeEditorUpgrade').mockImplementation(() => Promise.resolve());
        layoutErrorsBefore = Diagnostics.counters().layoutErrors;
    });

    afterEach(() => {
        settle();
        vi.restoreAllMocks();
        DOM.reset();
    });

    /** Invokes every animation-frame callback captured since the last flush. */
    function flushFrame(): void {
        const pending = frames;
        frames = [];

        for (const cb of pending) {
            cb(0);
        }
    }

    /** Flushes until no frame is pending, so the next test starts with an idle queue. */
    function settle(): void {
        while (frames.length > 0) {
            flushFrame();
        }
    }

    /** A viewer inside a sized host, laid out once while connected. */
    function mounted(source: string, options?: { displayed?: boolean }): Markdown {
        const host = new Container({ layoutManager: new Fit() });
        const md = new Markdown(source, options);

        host.addComponent(md);
        host.getElement(true);
        host.setWidth(600).setHeight(400);
        host.scheduleLayout();
        settle();
        loadSpy.mockClear();

        return md;
    }

    /** The fenced block text of every started import, in call order. */
    function loadedTexts(): string[] {
        return loadSpy.mock.calls.map((call: unknown[]) => call[3] as string);
    }

    /** Asserts the batched flush reported no failure, on the console or on Diagnostics. */
    function expectNoFlushFailure(): void {
        expect(errorSpy).not.toHaveBeenCalled();
        expect(Diagnostics.counters().layoutErrors).toBe(layoutErrorsBefore);
    }

    it('K1: one render before the flush starts its block', () => {
        const md = mounted('hello');

        md.setMarkdown(FENCE_A);
        flushFrame();

        expect(loadedTexts()).toEqual(['let a = 1;']);
        expectNoFlushFailure();
    });

    it('K2: two renders before one flush start only the second render\'s block', () => {
        const md = mounted('hello');

        md.setMarkdown(FENCE_A);
        md.setMarkdown(FENCE_B);
        flushFrame();

        expect(loadedTexts()).toEqual(['let b = 2;']);
        expectNoFlushFailure();
    });

    it('K3: two renders of two blocks start only the second render\'s blocks', () => {
        const md = mounted('hello');

        md.setMarkdown(FENCE_A + FENCE_B);
        md.setMarkdown(FENCE_B + FENCE_A);
        flushFrame();

        expect(loadedTexts()).toEqual(['let b = 2;', 'let a = 1;']);
        expectNoFlushFailure();
    });

    it('K4: a render replaced by plain text starts nothing', () => {
        const md = mounted('hello');

        md.setMarkdown(FENCE_A);
        md.setMarkdown('plain');
        flushFrame();

        expect(loadedTexts()).toEqual([]);
        expectNoFlushFailure();
    });

    it('K5: a viewer disposed right after setMarkdown starts nothing', () => {
        const md = mounted('hello');

        md.setMarkdown(FENCE_A);
        md.dispose();
        flushFrame();

        expect(loadedTexts()).toEqual([]);
        expectNoFlushFailure();
    });

    it('K6: a hidden viewer rendered twice keeps one waiting block and starts it when shown', () => {
        const md = mounted('hello', { displayed: false });
        const anyMd = md as any;
        const measureSpy = vi.spyOn(anyMd, 'scheduleContentMeasure');

        md.setMarkdown(FENCE_A);
        md.setMarkdown(FENCE_B);
        flushFrame();

        expect(anyMd._awaitingVisibilityKickoffs.map((entry: { text: string }) => entry.text)).toEqual(['let b = 2;']);
        expect(loadedTexts()).toEqual([]);

        measureSpy.mockClear();
        md.setDisplayed(true);

        expect(() => Component.flushEffectiveVisibility()).not.toThrow();
        expect(loadedTexts()).toEqual(['let b = 2;']);
        expect(anyMd._awaitingVisibilityKickoffs).toHaveLength(0);
        expect(measureSpy).toHaveBeenCalled();
        expectNoFlushFailure();
    });

    it('K7: a viewer rendered twice before it is connected starts only the second render\'s block', () => {
        connected = false;

        const host = new Container({ layoutManager: new Fit() });
        const md = new Markdown(FENCE_A);

        host.addComponent(md);
        host.getElement(true);
        md.setMarkdown(FENCE_B);
        settle();

        expect(loadedTexts()).toEqual([]);

        connected = true;
        host.setWidth(600).setHeight(400);
        host.scheduleLayout();
        settle();

        expect(loadedTexts()).toEqual(['let b = 2;']);
        expectNoFlushFailure();
    });

    it('K8: a stale entry handed to startCodeEditorImport reads no handle and queues nothing', () => {
        const md = mounted('hello');
        const anyMd = md as any;
        const startSpy = vi.spyOn(anyMd, 'startCodeEditorImport');

        md.setMarkdown(FENCE_A);
        flushFrame();

        const staleEntry = startSpy.mock.calls[0]![0];

        md.setMarkdown('plain');
        loadSpy.mockClear();

        const rectSpy = vi.spyOn(DOM.source, 'getElementRect');

        expect(() => anyMd.startCodeEditorImport(staleEntry)).not.toThrow();
        expect(rectSpy).not.toHaveBeenCalled();
        expect(loadedTexts()).toEqual([]);
        expect(anyMd._awaitingVisibilityKickoffs).toHaveLength(0);
        expect(anyMd._awaitingViewportKickoffs).toHaveLength(0);
    });

    it('K9: a stale entry handed to startCodeEditorImport while hidden is not queued', () => {
        const md = mounted('hello');
        const anyMd = md as any;
        const startSpy = vi.spyOn(anyMd, 'startCodeEditorImport');

        md.setMarkdown(FENCE_A);
        flushFrame();

        const staleEntry = startSpy.mock.calls[0]![0];

        md.setMarkdown('plain');
        md.setDisplayed(false);
        Component.flushEffectiveVisibility();

        anyMd.startCodeEditorImport(staleEntry);

        expect(anyMd._awaitingVisibilityKickoffs).toHaveLength(0);
    });
});
