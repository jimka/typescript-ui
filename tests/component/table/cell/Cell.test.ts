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

// Background/cursor precedence: readOnly ▸ base. The required-empty state is
// a separate outline overlay (not a background contender) that only shows
// while NOT read-only. `setReadOnly` and `setRequiredEmpty` share one
// resolver (`_applyStateTint`) so the two states compose instead of fighting
// over either write.
describe('Cell background/cursor/outline state precedence', () => {
    const BASE_TOKEN     = 'var(--ts-ui-table-cell-bg, transparent)';
    const READONLY_TOKEN = 'var(--ts-ui-table-cell-readonly-bg, rgba(0, 0, 0, 0.04))';
    const REQUIRED_OUTLINE = 'inset 0 0 0 1px var(--ts-ui-table-cell-required-outline, rgba(220, 60, 60, 0.6))';

    it('starts on the base background token with no outline', () => {
        const cell = editableCell();

        expect(cell.getBackgroundColor()).toBe(BASE_TOKEN);
        expect(cell.getShadow()).toBeNull();
    });

    it('requiredEmpty shows the outline without touching the background', () => {
        const cell = editableCell();

        cell.setRequiredEmpty(true);
        expect(cell.getBackgroundColor()).toBe(BASE_TOKEN);
        expect(cell.getShadow()).toBe(REQUIRED_OUTLINE);

        cell.setRequiredEmpty(false);
        expect(cell.getShadow()).toBeNull();
    });

    it('readOnly wins over the requiredEmpty outline: hides the outline and paints the readonly background', () => {
        const cell = editableCell();

        cell.setRequiredEmpty(true);
        cell.setReadOnly(true);
        expect(cell.getBackgroundColor()).toBe(READONLY_TOKEN);
        expect(cell.getShadow()).toBeNull();

        // Outline returns once readOnly clears, requiredEmpty still set.
        cell.setReadOnly(false);
        expect(cell.getBackgroundColor()).toBe(BASE_TOKEN);
        expect(cell.getShadow()).toBe(REQUIRED_OUTLINE);
    });

    it('setBaseBackground changes the fallback (e.g. a groupColor tint); the requiredEmpty outline layers on top without altering it', () => {
        const cell = editableCell();

        cell.setBaseBackground('rgb(1,2,3)');
        expect(cell.getBackgroundColor()).toBe('rgb(1,2,3)');

        cell.setRequiredEmpty(true);
        expect(cell.getBackgroundColor()).toBe('rgb(1,2,3)');
        expect(cell.getShadow()).toBe(REQUIRED_OUTLINE);

        cell.setRequiredEmpty(false);
        expect(cell.getBackgroundColor()).toBe('rgb(1,2,3)');
        expect(cell.getShadow()).toBeNull();
    });

    it('setRequiredEmpty is idempotent: re-setting the current value does not re-write the shadow', () => {
        const cell = editableCell();

        cell.setRequiredEmpty(true);

        const spy = vi.spyOn(cell, 'setShadow');
        cell.setRequiredEmpty(true);

        expect(spy).not.toHaveBeenCalled();
    });

    it('a read-only cell shows the default cursor; requiredEmpty and base both clear the cursor', () => {
        const cell = editableCell();

        cell.setRequiredEmpty(true);
        expect(cell.getCursor()).toBeNull();

        cell.setReadOnly(true);
        expect(cell.getCursor()).toBe('default');

        cell.setReadOnly(false);
        expect(cell.getCursor()).toBeNull();
    });
});
