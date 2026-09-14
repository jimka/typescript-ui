// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for undisplay-inactive-tab-pages.md: `CodeEditor.onEffectiveVisibilityChange`
 * asks CodeMirror for a fresh measurement on the way back to effectively
 * visible, since `ViewState.measure` skips a `display: none` editor and its
 * own `ResizeChovserver` re-show catch-up window is too narrow to trust (see
 * the plan's `[^codemirror-measure]`). `_view` is stubbed directly, mirroring
 * `code-editor.test.ts`'s own offline-only contract (CodeMirror's `EditorView`
 * cannot be modelled offline, so `_view` never mounts for real in this file).
 * Case numbers below refer to the plan's `## Expected Behaviour` list (17-19).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CodeEditor } from '~/component/editor/CodeEditor';
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

describe('CodeEditor.onEffectiveVisibilityChange', () => {
    it('calls EditorView.requestMeasure() exactly once on the stubbed _view when becoming effectively visible (case 17)', () => {
        const editor = new CodeEditor() as any;
        const requestMeasure = vi.fn();
        editor._view = { requestMeasure };

        editor.onEffectiveVisibilityChange(true);

        expect(requestMeasure).toHaveBeenCalledTimes(1);
    });

    it('calls neither requestMeasure nor setHeight when becoming effectively hidden (case 18)', () => {
        const editor = new CodeEditor() as any;
        const requestMeasure = vi.fn();
        editor._view = { requestMeasure };
        const setHeightSpy = vi.spyOn(editor, 'setHeight');

        editor.onEffectiveVisibilityChange(false);

        expect(requestMeasure).not.toHaveBeenCalled();
        expect(setHeightSpy).not.toHaveBeenCalled();
    });

    it('changes no height on re-show when autoHeightMaxRows is unset — syncAutoHeight returns at its own guard (case 19)', () => {
        const editor = new CodeEditor() as any;
        editor._view = {
            requestMeasure: vi.fn(),
            state: { doc: { lines: 5 } },
            documentPadding: { top: 0, bottom: 0 },
        };
        editor._scrollElement = DOM.sink.createElement('div');

        const heightBefore = editor.getHeight();

        editor.onEffectiveVisibilityChange(true);

        expect(editor.getHeight()).toBe(heightBefore);
    });

    it('is a no-op with no live view (the real offline contract)', () => {
        const editor = new CodeEditor() as any;

        expect(() => editor.onEffectiveVisibilityChange(true)).not.toThrow();
    });
});
