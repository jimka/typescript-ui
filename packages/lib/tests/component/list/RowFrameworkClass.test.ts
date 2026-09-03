import { describe, it, expect, afterEach } from 'vitest';
import { _List } from '~/component/list/List';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas, _ruleCacheKeys } from '~/core/StyleTarget';

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

    public rowHandle(index: number): number {
        return this._rowPool[index].getElement()! as unknown as number;
    }

    public rowCursor(index: number): string | null {
        return this._rowPool[index].getCursor();
    }
}

/** Six-row fixture with rows 1, 2 and 5 disabled — matches List.test.ts's ROWS. */
const DISABLED_ROWS = [
    { key: 'a', label: 'Apple' },
    { key: 'b', label: 'Banana', enabled: false },
    { key: 'c', label: 'Cherry', enabled: false },
    { key: 'd', label: 'Date' },
    { key: 'e', label: 'Elder' },
    { key: 'f', label: 'Fig', enabled: false },
];

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

describe('List row reflects per-row disabled state (row-framework-class)', () => {
    afterEach(() => DOM.reset());

    it('a disabled row carries the disabled class and a default cursor; an enabled row does not', () => {
        installTestDOM(CONFIG);

        const list = new TestList({ items: DISABLED_ROWS });
        list.getElement(true);

        const disabledTokens = lastClassTokens(DOM.sink as RecordingDOMSink, list.rowHandle(1));
        const enabledTokens  = lastClassTokens(DOM.sink as RecordingDOMSink, list.rowHandle(0));

        expect(disabledTokens).toContain('disabled');
        expect(disabledTokens).toContain('SelectableListRow');
        expect(disabledTokens).toContain('ts-ui-component');
        expect(enabledTokens).not.toContain('disabled');

        expect(list.rowCursor(1)).toBe('default');
        expect(list.rowCursor(0)).toBe('pointer');
    });

    it('re-enabling a row repaints its class and cursor', () => {
        installTestDOM(CONFIG);

        const list = new TestList({ items: DISABLED_ROWS });
        list.getElement(true);

        list.setItemEnabled(1, true);

        const tokens = lastClassTokens(DOM.sink as RecordingDOMSink, list.rowHandle(1));
        expect(tokens).not.toContain('disabled');
        expect(list.rowCursor(1)).toBe('pointer');
    });

    // Regression: an earlier version guarded the hover selector itself with
    // `:not(.disabled)`, which raised its specificity from (0,2,0) to (0,3,0)
    // — above `.SelectableListRow.selected`'s (0,2,0) — so hovering a
    // selected, enabled row painted the weaker hover tint over the selection
    // wash instead of the selection wash winning as it always had. The fix
    // keeps the hover selector plain (so it still ties with `.selected` and
    // the tie still resolves by registration order) and cancels the hover
    // background for a disabled row with a separate, narrowly-targeted
    // `.disabled:hover:not(.selected)` rule instead — whose (0,4,0)
    // specificity and `:not(.selected)` guard mean it always wins when it
    // matches and never matches a selected row, so *its* registration order
    // relative to `.selected` carries no information and isn't asserted
    // here. This test pins the exact selector set plus the two orderings
    // that are actually load-bearing: `.selected` must out-tie the plain
    // `:hover` rule for `background-color` (the round-1 regression), and
    // `.disabled` must out-tie `.selected` for `color` (the "selected but
    // disabled still dims" rule the specificity table in
    // plans/in-progress/list-row-enabled-state.md documents) — so a future
    // edit can't reintroduce either bug silently. See that plan's
    // Implementation Notes for the full account.
    it('registers the hover/selected/disabled rules with the selectors and tie-breaking order the fix relies on', () => {
        installTestDOM(CONFIG);

        new TestList({ items: DISABLED_ROWS }).getElement(true);

        // The plain hover selector must exist, and the specificity-raising
        // guarded form it was briefly changed to must not have come back.
        expect(_ruleCacheHas('.SelectableListRow:hover')).toBe(true);
        expect(_ruleCacheHas('.SelectableListRow:not(.disabled):hover')).toBe(false);
        expect(_ruleCacheHas('.SelectableListRow.disabled:hover:not(.selected)')).toBe(true);

        // Both are (0,2,0)/(0,2,0) ties, so which one is registered later —
        // and therefore wins — is the only thing deciding the outcome.
        const keys      = _ruleCacheKeys();
        const hoverIdx    = keys.indexOf('.SelectableListRow:hover');
        const selectedIdx = keys.indexOf('.SelectableListRow.selected');
        const disabledIdx = keys.indexOf('.SelectableListRow.disabled');

        expect(hoverIdx).toBeGreaterThanOrEqual(0);
        expect(selectedIdx).toBeGreaterThan(hoverIdx);
        expect(disabledIdx).toBeGreaterThan(selectedIdx);
    });
});
