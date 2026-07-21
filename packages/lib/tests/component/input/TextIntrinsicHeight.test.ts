//
// Coverage for a wrapping Text's intrinsic height: its height follows the width
// it is laid out at, so once a box is narrower than the natural single-line run
// the text flows onto more lines and the box grows to fit — no clipping.
//
// The preferred-size protocol resolves heights bottom-up before widths are
// assigned top-down, so a wrapping Text can only know its height once it has a
// width. setWidth re-measures at the new width and updates the preferred height
// (which also raises the box's own minimum, so the layout reserves the room);
// the offline DOM models a char-proportional soft-wrap when given a maxWidth.
//
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Text } from '~/component/input/Text';
import { Container } from '~/core/Container';
import { VBox } from '~/layout/VBox';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const LONG = 'word '.repeat(40).trim();

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

/** A Text that soft-wraps — whiteSpace set after construction so the truncate
 *  default (nowrap in the constructor) does not clobber it. */
function wrapping(text: string): Text {
    const t = new Text(text);
    t.setWhiteSpace('normal');
    t.getElement(true);

    return t;
}

describe('Text intrinsic height', () => {
    it('reports its single-line height before it has a width', () => {
        const t       = wrapping(LONG);
        const natural = t.getPreferredSize()!;

        // One line: measured height equals the line box, natural width is wide.
        expect(natural.width).toBeGreaterThan(0);
        expect(natural.height).toBeGreaterThan(0);
    });

    it('grows its preferred height once laid out narrower than its natural width', () => {
        const t       = wrapping(LONG);
        const natural = t.getPreferredSize()!;

        t.setWidth(Math.ceil(natural.width / 3));

        expect(t.getPreferredSize()!.height).toBeGreaterThan(natural.height);
    });

    it('returns to single-line height when widened past its natural width', () => {
        const t       = wrapping(LONG);
        const natural = t.getPreferredSize()!;

        t.setWidth(Math.ceil(natural.width / 3));
        expect(t.getPreferredSize()!.height).toBeGreaterThan(natural.height);

        t.setWidth(natural.width + 50);
        expect(t.getPreferredSize()!.height).toBe(natural.height);
    });

    it('keeps a nowrap label at single-line height at any width', () => {
        const t      = new Text(LONG);
        t.getElement(true);
        const single = t.getPreferredSize()!.height;

        t.setWidth(10);

        expect(t.getPreferredSize()!.height).toBe(single);
    });
});

describe('VBox lays out a wrapping child tall enough not to clip', () => {
    it('sizes the Text box to its wrapped height after layout, not single-line', () => {
        const host = new Container({ layoutManager: new VBox({ stretching: true, spacing: 0 }) });
        host.getElement(true);
        const t = new Text(LONG);
        t.setWhiteSpace('normal');
        host.addComponent(t);

        const natural = t.getPreferredSize()!;
        const narrow  = Math.ceil(natural.width / 3);

        host.setWidth(narrow);
        host.setHeight(1000);   // plenty of room; the child must not be squeezed
        host.doLayout();

        // The child re-measured to a taller wrapped height, and its laid-out box
        // is at least that tall — so every wrapped line is inside the box.
        const wrapped = t.getPreferredSize()!.height;
        expect(wrapped).toBeGreaterThan(natural.height);
        expect(t.getHeight()).toBeGreaterThanOrEqual(wrapped);
    });
});

// Regression: setLineHeight unconditionally set `_measurementDirty` and called
// `(parent ?? this).scheduleLayout()`, so a caller that re-applies the SAME
// numeric line-height every layout pass — CellRenderer.doLayout does exactly
// this to vertically centre cell text — re-armed the layout flush forever,
// spinning a silent relayout loop (StringRenderer laid out ~90×/frame). A no-op
// re-apply of an unchanged numeric line-height must schedule no layout.
describe('Text.setLineHeight — idempotent re-apply (relayout-loop guard)', () => {
    it('re-applying the same numeric line-height schedules no layout', () => {
        const t = new Text('x');
        t.getElement(true);
        t.setLineHeight(20);   // first apply: leaves the additive-rule default

        const spy = vi.spyOn(t, 'scheduleLayout');

        t.setLineHeight(20);   // unchanged → must be a no-op
        expect(spy).not.toHaveBeenCalled();
    });

    it('a changed numeric line-height still schedules layout', () => {
        const t = new Text('x');
        t.getElement(true);
        t.setLineHeight(20);

        const spy = vi.spyOn(t, 'scheduleLayout');

        t.setLineHeight(28);   // genuine change → still relayouts
        expect(spy).toHaveBeenCalled();
    });
});

describe('Text explicit preferred size (size-setter-interface plan, case 10)', () => {
    it('suppresses auto-measure so a later measurement does not overwrite the explicit size', () => {
        // setPreferredSize flips _hasExplicitPreferredSize, which makes
        // setCalculatedSize no-op. measure() forces a re-measure, so it is the
        // public trigger that would clobber the explicit value if the guard broke.
        const t = new Text(LONG);
        t.getElement(true);

        t.setPreferredSize({ width: 80, height: 20 });
        t.measure();

        expect(t.getPreferredSize()).toEqual({ width: 80, height: 20 });
    });
});
