// @vitest-environment jsdom
//
// Coverage for `DOMSource.readDocumentSelection()` — the read-side named
// escape that hands the live document selection to a foreign widget's
// reader — against the REAL production source (the `jsdom` pragma keeps
// `tests/setup/node-setup.ts` from installing the modelled DOM, mirroring
// `tests/dom/selection-range.test.ts`), and against the modelled source via
// `installTestDOM`.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOM, ProductionDOMSource } from '~/core/DOM';
import { installTestDOM } from './TestDOM';
import fontMetrics from './font-metrics.test-font.json';

afterEach(() => {
    DOM.reset();
    document.body.replaceChildren();
});

describe('ProductionDOMSource.readDocumentSelection', () => {
    const source = new ProductionDOMSource();

    it('hands the reader the live selection, a collapsed caret included, and returns what the reader makes of it', () => {
        const text = document.createTextNode('hello');

        document.body.append(text);
        window.getSelection()?.setBaseAndExtent(text, 2, text, 2);

        const read = source.readDocumentSelection((selection) => [selection?.anchorNode === text, selection?.anchorOffset, selection?.isCollapsed]);

        expect(read).toEqual([true, 2, true]);
    });

    it('returns the reader\'s own null', () => {
        expect(source.readDocumentSelection(() => null)).toBeNull();
    });
});

describe('ModelledDOMSource.readDocumentSelection', () => {
    it('returns null without calling the reader: the modelled document holds no selection', () => {
        installTestDOM({
            rootMountOffset: { x: 0, y: 0 }, viewport: { width: 1280, height: 800 }, scrollBarWidth: 15, fontMetrics, themeVars: {},
        });

        const reader = vi.fn(() => 'read');

        expect(DOM.source.readDocumentSelection(reader)).toBeNull();
        expect(reader).not.toHaveBeenCalled();
    });
});
