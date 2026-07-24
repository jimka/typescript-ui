import { describe, it, expect, afterEach } from 'vitest';
import { _List } from '~/component/list/List';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const FRUITS = ['Apple', 'Banana', 'Cherry', 'Date'];

/** Widens the protected row pool so a row's element handle is reachable. */
class TestList extends _List {
    public firstRowHandle(): number {
        return this._rowPool[0].getElement()! as unknown as number;
    }
}

/**
 * The last `class` attribute written to `handle` via the recording sink, split
 * into its class tokens. Empty when no class write was recorded.
 */
function lastClassTokens(sink: RecordingDOMSink, handle: number): string[] {
    const writes = sink.writes.filter(
        w => w.op === 'apply'
          && w.args[0] === handle
          && (w.args[1] as { setAttr?: Record<string, string> })?.setAttr?.class !== undefined,
    );

    const last = writes.at(-1);
    if (!last) {
        return [];
    }

    return (last.args[1] as { setAttr: Record<string, string> }).setAttr.class.split(' ');
}

describe('List row carries the framework class after a state change (row-framework-class)', () => {
    afterEach(() => DOM.reset());

    // Regression: applyRowClass rewrites the whole `class` attribute from the
    // row's selected/focused state. Since `position: absolute` was hoisted onto
    // the `:where(.ts-ui-component)` framework rule, a class write that omits
    // `ts-ui-component` drops the row's positioning and every row collapses to
    // top:auto, stacking on top of each other. Any class the row writes must
    // keep the framework class token.
    it('keeps `ts-ui-component` when a selection change rewrites the row class', () => {
        installTestDOM(CONFIG);

        const list = new TestList({ items: FRUITS });
        list.getElement(true);

        // Drives refreshRowVisualState → row.setSelected/setFocused →
        // applyRowClass, a post-render class rewrite (the path that clobbered).
        list.setSelectedIndex(0, false);

        const tokens = lastClassTokens(DOM.sink as RecordingDOMSink, list.firstRowHandle());

        expect(tokens).toContain('ts-ui-component');
        // The selected state still lands, so the fix adds to the class set
        // rather than replacing the modifier tokens.
        expect(tokens).toContain('selected');
    });
});
