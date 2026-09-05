// Unlike its neighbour buildClipboardMenuItems.test.ts, this helper reads the
// live document selection through the DOM seam, so its tests need a modelled
// DOM: installTestDOM per case, DOM.reset() after, and vi.spyOn on the two
// selection-reading seam members to seed a selection — the idiom
// Body.test.ts:1156 already uses.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildSelectionCopyMenuItems } from '~/component/shared/buildSelectionCopyMenuItems';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

/** Spies both selection-reading seam members as a range fully inside `container`. */
function seedContainedSelection(container: Handle, text: string): void {
    vi.spyOn(DOM.source, 'getDocumentSelection').mockReturnValue({
        startContainer: container,
        startOffset:    0,
        endContainer:   container,
        endOffset:      text.length,
    });
    vi.spyOn(DOM.source, 'getDocumentSelectionText').mockReturnValue(text);
}

describe('buildSelectionCopyMenuItems', () => {
    it('with no selection at all, returns one dimmed Copy row', () => {
        installTestDOM(CONFIG);
        const el = DOM.sink.createElement('div');

        const items = buildSelectionCopyMenuItems(el);

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ text: 'Copy', enabled: false });
    });

    it('with a selection fully inside the element, the Copy row is enabled', () => {
        installTestDOM(CONFIG);
        const el = DOM.sink.createElement('div');
        seedContainedSelection(el, 'hello');

        const items = buildSelectionCopyMenuItems(el);

        expect(items[0]).toMatchObject({ text: 'Copy', enabled: true });
    });

    it('invoking the enabled row\'s action writes the selected text to the clipboard', () => {
        installTestDOM(CONFIG);
        const el = DOM.sink.createElement('div');
        seedContainedSelection(el, 'hello');

        const items = buildSelectionCopyMenuItems(el);
        items[0].action?.();

        const writes = (DOM.sink as RecordingDOMSink).writes.filter(w => w.op === 'writeClipboardText');
        expect(writes).toHaveLength(1);
        expect(writes[0].args[0]).toBe('hello');
    });

    it('dims Copy when the selection start is inside the element but the end is outside', () => {
        installTestDOM(CONFIG);
        const el      = DOM.sink.createElement('div');
        const outside = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getDocumentSelection').mockReturnValue({
            startContainer: el,
            startOffset:    0,
            endContainer:   outside,
            endOffset:      3,
        });
        vi.spyOn(DOM.source, 'getDocumentSelectionText').mockReturnValue('hello');

        const items = buildSelectionCopyMenuItems(el);

        expect(items[0]).toMatchObject({ text: 'Copy', enabled: false });
    });

    it('dims Copy when both selection endpoints are outside the element', () => {
        installTestDOM(CONFIG);
        const el       = DOM.sink.createElement('div');
        const outsideA = DOM.sink.createElement('div');
        const outsideB = DOM.sink.createElement('div');

        vi.spyOn(DOM.source, 'getDocumentSelection').mockReturnValue({
            startContainer: outsideA,
            startOffset:    0,
            endContainer:   outsideB,
            endOffset:      3,
        });
        vi.spyOn(DOM.source, 'getDocumentSelectionText').mockReturnValue('hello');

        const items = buildSelectionCopyMenuItems(el);

        expect(items[0]).toMatchObject({ text: 'Copy', enabled: false });
    });

    it('captures the selected text at build time, not at click time', () => {
        installTestDOM(CONFIG);
        const el = DOM.sink.createElement('div');
        seedContainedSelection(el, 'hello');

        const items = buildSelectionCopyMenuItems(el);

        // The live selection moves on (e.g. the menu click itself collapsed
        // it); the action must still copy what was selected when the menu
        // opened, not whatever getDocumentSelectionText reports now.
        vi.spyOn(DOM.source, 'getDocumentSelectionText').mockReturnValue('other');
        items[0].action?.();

        const writes = (DOM.sink as RecordingDOMSink).writes.filter(w => w.op === 'writeClipboardText');
        expect(writes).toHaveLength(1);
        expect(writes[0].args[0]).toBe('hello');
    });

    it('never returns a Cut or Paste row, selected or not', () => {
        installTestDOM(CONFIG);
        const el = DOM.sink.createElement('div');
        seedContainedSelection(el, 'hello');

        const withSelection = buildSelectionCopyMenuItems(el);
        expect(withSelection.map(i => i.text)).not.toContain('Cut');
        expect(withSelection.map(i => i.text)).not.toContain('Paste');

        vi.restoreAllMocks();
        const withoutSelection = buildSelectionCopyMenuItems(el);
        expect(withoutSelection.map(i => i.text)).not.toContain('Cut');
        expect(withoutSelection.map(i => i.text)).not.toContain('Paste');
    });
});
