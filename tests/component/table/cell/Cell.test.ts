//
// startEdit scroll-into-view ordering. The host Body injects a scroll-into-view
// handler that startEdit must run BEFORE it opens and focuses the editor —
// otherwise a picker dropdown the editor anchors opens at the cell's pre-scroll
// position and sits offset once the column scrolls in (the regression behind
// "the dropdown is opened at the cell's original x"). The ordering is pure
// control flow, so it is offline-faithful: a spy on the editor's focus and a
// recording handler pin the sequence without needing real focus or scroll.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { Cell } from '~/component/table/cell/Cell';
import { StringRenderer } from '~/component/table/cell/renderer/String';
import { StringEditor } from '~/component/table/cell/editor/String';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** A materialised cell carrying a per-cell renderer + editor. */
function editableCell(): Cell<String | null> {
    const cell = new Cell<String | null>('td', new StringRenderer(), new StringEditor());
    cell.getElement(true);

    return cell;
}

describe('Cell.startEdit scroll-into-view ordering', () => {
    it('runs the scroll-into-view handler before focusing the editor', () => {
        const cell   = editableCell();
        const editor = (cell as any)._editor as StringEditor;
        const order: string[] = [];

        vi.spyOn(editor, 'focus').mockImplementation(() => { order.push('focus'); return editor; });
        cell.setScrollIntoViewHandler(() => order.push('scroll'));

        cell.startEdit();

        expect(order).toEqual(['scroll', 'focus']);
    });

    it('does not run the handler on a read-only cell', () => {
        const cell    = editableCell();
        const handler = vi.fn();

        cell.setReadOnly(true);
        cell.setScrollIntoViewHandler(handler);
        cell.startEdit();

        expect(handler).not.toHaveBeenCalled();
    });

    it('does not run the handler again while already editing', () => {
        const cell    = editableCell();
        const editor  = (cell as any)._editor as StringEditor;
        const handler = vi.fn();

        vi.spyOn(editor, 'focus').mockReturnValue(editor);
        cell.setScrollIntoViewHandler(handler);

        cell.startEdit();   // opens the editor, handler fires once
        cell.startEdit();   // isEditing() guard short-circuits

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('clearing the handler with null leaves startEdit a no-op for scrolling', () => {
        const cell   = editableCell();
        const editor = (cell as any)._editor as StringEditor;

        vi.spyOn(editor, 'focus').mockReturnValue(editor);
        cell.setScrollIntoViewHandler(() => { throw new Error('handler should not run'); });
        cell.setScrollIntoViewHandler(null);

        expect(() => cell.startEdit()).not.toThrow();
    });
});
