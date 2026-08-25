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
import { installTestDOM, RecordingDOMSink, ruleStyleWrites } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { Cell } from '~/component/table/cell/Cell';
import { StringRenderer } from '~/component/table/cell/renderer/String';
import { StringEditor } from '~/component/table/cell/editor/String';
import { _ruleCacheHas } from '~/core/StyleTarget';

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

    it('setBaseBackground(null) restores the theme default', () => {
        const cell = editableCell();

        cell.setBaseBackground('rgb(1,2,3)');
        expect(cell.getBackgroundColor()).toBe('rgb(1,2,3)');

        cell.setBaseBackground(null);
        expect(cell.getBackgroundColor()).toBe('var(--ts-ui-table-cell-bg, transparent)');
    });

    it('setRequiredEmpty is idempotent: re-setting the current value does not re-write the shadow', () => {
        const cell = editableCell();

        cell.setRequiredEmpty(true);

        const spy = vi.spyOn(cell, 'setShadow');
        cell.setRequiredEmpty(true);

        expect(spy).not.toHaveBeenCalled();
    });

    // Stage 5 of plans/layered-style-bag.md decouples setBaseBackground from
    // shadow entirely: shadow is now solely `.requiredEmpty`'s own declared
    // state (see `ownStyleStates`), so setBaseBackground no longer reaches
    // it at all — unlike the pre-migration `_applyStateTint`, which was a
    // single resolver every setter funnelled through. This instead pins
    // setBaseBackground's own idempotence: a redundant call (same resolved
    // value) toggles the shared `.Cell.bg<color>` class token only once.
    it('setBaseBackground called redundantly with the same value toggles the shared value-class token only once', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const cell = editableCell();

        const start = sink.writes.length;
        cell.setBaseBackground('rgb(1,2,3)');
        const firstToggle = sink.writes.slice(start).filter((w) => w.op === 'apply' && (w.args[1] as { addClass?: unknown }).addClass);

        expect(firstToggle).toHaveLength(1);

        const start2 = sink.writes.length;
        cell.setBaseBackground('rgb(1,2,3)'); // redundant: already this value
        const secondToggle = sink.writes.slice(start2).filter((w) => w.op === 'apply' && ((w.args[1] as { addClass?: unknown }).addClass || (w.args[1] as { removeClass?: unknown }).removeClass));

        expect(secondToggle).toHaveLength(0);
    });

    // A pooled cell is rebound on every column-window recycle:
    // Row.setColumnWindow and Header's reconciler call setBaseBackground
    // (and Body.applyReadOnlyState calls setReadOnly) unconditionally, not
    // only on a real change. Routing that through setBackgroundColor
    // re-materialised the cell's own `#id` stylesheet rule every single
    // time — the cost Row.updateVisualState already avoids for rows.
    // setBaseBackground now points this instance at a shared
    // `.Cell.bg<color>` class-tier rule instead (deduped across every cell
    // resolving the same groupColor), and setReadOnly toggles the
    // `.Cell.readOnly` state token declared via `ownStyleStates` — neither
    // ever touches this cell's own `#id` rule. `cacheStyleValue` still
    // keeps getBackgroundColor() answering the resolved value throughout
    // (the precedence block above is that half of the contract).
    it('a rebind toggles shared class tokens, never re-materialising the #id rule', () => {
        const sink         = DOM.sink as RecordingDOMSink;
        const cell         = editableCell();
        const cellSelector = '#' + cell.getId();

        const before = sink.writes.length;

        cell.setBaseBackground('rgb(1,2,3)');
        expect(cell.getBackgroundColor()).toBe('rgb(1,2,3)');

        cell.setBaseBackground('rgb(4,5,6)');
        expect(cell.getBackgroundColor()).toBe('rgb(4,5,6)');

        cell.setReadOnly(true);
        expect(cell.getBackgroundColor()).toBe('var(--ts-ui-table-cell-readonly-bg, rgba(0, 0, 0, 0.04))');

        cell.setReadOnly(false);
        expect(cell.getBackgroundColor()).toBe('rgb(4,5,6)');

        cell.setBaseBackground(null);
        expect(cell.getBackgroundColor()).toBe('var(--ts-ui-table-cell-bg, transparent)');

        const window = sink.writes.slice(before);

        const backgroundRuleWrites = window
            .filter((w) => w.op === 'setRuleStyles' && w.args[0] === cellSelector)
            .flatMap((w) => Object.keys(w.args[1] as Record<string, string | null>))
            .filter((key) => key === 'backgroundColor');

        expect(backgroundRuleWrites).toEqual([]);
        expect(window.some((w) => w.op === 'ensureStyleRule' && w.args[0] === cellSelector)).toBe(false);

        // Positive control: the writes did happen, just as class-token
        // toggles. Without this the absences above would pass vacuously if
        // the rebinds were skipped entirely.
        const toggles = window
            .filter((w) => w.op === 'apply' && w.args[0] === cell.getElement())
            .map((w) => w.args[1] as { addClass?: string[]; removeClass?: string[] })
            .filter((patch) => patch.addClass !== undefined || patch.removeClass !== undefined);

        expect(toggles).toEqual([
            { removeClass: [], addClass: ['bgrgb_1_2_3_'] },                       // setBaseBackground('rgb(1,2,3)')
            { removeClass: ['bgrgb_1_2_3_'], addClass: ['bgrgb_4_5_6_'] },        // setBaseBackground('rgb(4,5,6)')
            { addClass: ['readOnly'] },                                            // setReadOnly(true)
            { removeClass: ['readOnly'] },                                         // setReadOnly(false)
            { removeClass: ['bgrgb_4_5_6_'] },                                    // setBaseBackground(null)
        ]);

        // Guarded: `backgroundColor` is one of `Cell`'s own resting-isolation
        // keys (`ownStyleStates` declares it for `.readOnly`), so the shared
        // rule's selector carries the same `:not(...)` guard the per-instance
        // resting rule uses — otherwise it would tie on specificity with
        // `.Cell.readOnly` and source order would decide which one paints.
        expect(_ruleCacheHas('.Cell.bgrgb_1_2_3_:not(.rangeSelected):not(.readOnly):not(.requiredEmpty)')).toBe(true);
        expect(_ruleCacheHas('.Cell.bgrgb_4_5_6_:not(.rangeSelected):not(.readOnly):not(.requiredEmpty)')).toBe(true);
        expect(_ruleCacheHas('.Cell.bgrgb_1_2_3_')).toBe(false);
        expect(_ruleCacheHas('.Cell.bgrgb_4_5_6_')).toBe(false);
    });

    // Production order (Row/Header): setBaseBackground runs before the cell
    // ever renders. This is the ordering the pre-fix defect actually hit —
    // the pre-existing "rebind" test above renders first, which is why it
    // passed even with the bug (see plan's "Why ordering hides it from the
    // existing test").
    it('a base background set before first render writes no per-instance backgroundColor declaration', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const cell = new Cell<String | null>('td', new StringRenderer(), new StringEditor());

        cell.setBaseBackground('rgb(1,2,3)');
        cell.getElement(true);

        // `startsWith`, not `===`: `Cell` isolates its resting chrome (see
        // `ownStyleStates`), so its own instance-tier rule for
        // `backgroundColor` materialises under the guarded selector
        // (`#<id>:not(.rangeSelected):not(.readOnly):not(.requiredEmpty)`),
        // not the bare `#<id>`.
        const cellSelector = '#' + cell.getId();
        const idBackgroundValues = sink.writes
            .filter((w) => w.op === 'setRuleStyles' && (w.args[0] as string).startsWith(cellSelector))
            .flatMap((w) => Object.entries(w.args[1] as Record<string, string | null>))
            .filter(([key, value]) => key === 'backgroundColor' && value !== null)
            .map(([, value]) => value);

        expect(idBackgroundValues).toEqual([]);
        expect(_ruleCacheHas('.Cell.bgrgb_1_2_3_:not(.rangeSelected):not(.readOnly):not(.requiredEmpty)')).toBe(true);
    });

    it('two cells resolving the same pre-render base background share one shared-rule creation', () => {
        const sink  = DOM.sink as RecordingDOMSink;
        const start = sink.writes.length;

        const a = new Cell<String | null>('td', new StringRenderer(), new StringEditor());
        a.setBaseBackground('rgb(7,8,9)');
        a.getElement(true);

        const b = new Cell<String | null>('td', new StringRenderer(), new StringEditor());
        b.setBaseBackground('rgb(7,8,9)');
        b.getElement(true);

        const guardedSelector = '.Cell.bgrgb_7_8_9_:not(.rangeSelected):not(.readOnly):not(.requiredEmpty)';
        const ensureCalls = sink.writes
            .slice(start)
            .filter((w) => w.op === 'ensureStyleRule' && w.args[0] === guardedSelector);

        expect(ensureCalls).toHaveLength(1);
    });

    // The stale-declaration defect the plan's dedup fix removes at the
    // source: with a base background set BEFORE render, a later rebind and a
    // final clear must never leave (or re-create) a per-instance
    // backgroundColor declaration, and getBackgroundColor() must settle back
    // to the class default once cleared.
    it('a pre-render base background, rebound and then cleared after render, never touches #id and settles back to the class default', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const cell = new Cell<String | null>('td', new StringRenderer(), new StringEditor());

        cell.setBaseBackground('rgb(1,2,3)');
        cell.getElement(true);

        const cellSelector = '#' + cell.getId();
        const before = sink.writes.length;

        cell.setBaseBackground('rgb(4,5,6)');
        expect(cell.getBackgroundColor()).toBe('rgb(4,5,6)');

        cell.setBaseBackground(null);
        expect(cell.getBackgroundColor()).toBe('var(--ts-ui-table-cell-bg, transparent)');

        // Checked across the whole test, not just the post-first-render
        // window, and matched with `startsWith` (see the previous test's
        // comment on the guarded selector): this is what catches the
        // stale-declaration defect, where the first (pre-render)
        // setBaseBackground call writes a real backgroundColor to #id at
        // flush time and nothing afterwards ever rewrites or clears it.
        const idBackgroundValues = ruleStyleWrites(sink)
            .filter((w) => w.selector.startsWith(cellSelector) && w.key === 'backgroundColor')
            .map((w) => w.value);

        expect(idBackgroundValues.every((value) => value === null)).toBe(true);

        const toggles = sink.writes.slice(before)
            .filter((w) => w.op === 'apply' && w.args[0] === cell.getElement())
            .map((w) => w.args[1] as { addClass?: string[]; removeClass?: string[] })
            .filter((patch) => patch.addClass !== undefined || patch.removeClass !== undefined);

        expect(toggles).toEqual([
            { removeClass: ['bgrgb_1_2_3_'], addClass: ['bgrgb_4_5_6_'] },  // setBaseBackground('rgb(4,5,6)')
            { removeClass: ['bgrgb_4_5_6_'] },                              // setBaseBackground(null)
        ]);
    });

    // A genuine per-instance deviation — no value class involved — must
    // still reach #id: widening `layersBelowInstance()` to include the
    // value-class tier must not change `flushStyleBag`'s outcome for a
    // caller that never goes through `setValueStyleState` at all.
    // `setBackgroundColor` directly is exactly what `FilterCell`'s
    // constructor does (Filter.ts) — that class isn't exported, so this
    // pins the same code path through the base `Cell` instead.
    it('a genuine per-instance backgroundColor deviation (no value class involved) still reaches its own #id rule', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const cell = new Cell<String | null>('td', new StringRenderer(), new StringEditor());

        cell.setBackgroundColor('rgb(9,9,9)');
        cell.getElement(true);

        const cellSelector = '#' + cell.getId();
        const idBackgroundValues = ruleStyleWrites(sink)
            .filter((w) => w.selector.startsWith(cellSelector) && w.key === 'backgroundColor')
            .map((w) => w.value);

        expect(idBackgroundValues).toContain('rgb(9,9,9)');
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

    it('a fresh cell writes no backgroundColor or border declaration to its own #id rule', () => {
        const sink         = DOM.sink as RecordingDOMSink;
        const cell         = editableCell();
        const cellSelector = '#' + cell.getId();

        const idRuleKeys = ruleStyleWrites(sink)
            .filter((w) => w.selector === cellSelector)
            .map((w) => w.key);

        expect(idRuleKeys).not.toContain('backgroundColor');
        expect(idRuleKeys).not.toContain('borderTop');
        expect(idRuleKeys).not.toContain('borderRight');
        expect(idRuleKeys).not.toContain('borderBottom');
        expect(idRuleKeys).not.toContain('borderLeft');
    });
});
