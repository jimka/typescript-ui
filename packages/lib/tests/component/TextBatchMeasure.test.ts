// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for plans/implemented/text-measurement-batching.md —
// Expected Behaviour rows 1-11 (rows 12-14 are manual-verify, browser-only,
// per the plan's own `## Verification` probe-counter/parity/trace steps: the
// offline model derives `measureTexts` from `measureText`, so an offline
// parity assertion would be true by construction and prove nothing).
//
// A counting source wraps both `measureText` and `measureTexts` — still
// delegating to the real (modelled) implementation — so a test can assert how
// many DOM probes of each kind a batch actually issued, and inspect exactly
// which requests a `measureTexts` call carried. Mirrors `BorderWidths.test.ts`'s
// `installCountingBorderSource`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Text } from '~/component/input/Text';
import { Container } from '~/core/Container';
import { DOM } from '~/core/DOM';
import { Util } from '~/core/Util';
import type { TextMeasureOptions, TextMeasureRequest, TextMetrics } from '~/core/Util';
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

/**
 * Wraps the installed source with call-counting `measureText`/`measureTexts`
 * that still delegate to the real (modelled) implementation, so a test can
 * assert which of the two paths — and how many times, and with what requests
 * — a measurement took.
 *
 * @returns A counter whose `textCalls` field increments on each solo
 * `measureText` call and whose `batchCalls` field records every `measureTexts`
 * call's request list, in call order.
 */
function installCountingMeasureSource(): {
    textCalls: number;
    batchCalls: TextMeasureRequest[][];
} {
    const original = DOM.source;
    const counter  = { textCalls: 0, batchCalls: [] as TextMeasureRequest[][] };

    const wrapped = Object.create(original, {
        measureText: {
            value: (text: string, options?: TextMeasureOptions): TextMetrics => {
                counter.textCalls += 1;

                return original.measureText(text, options);
            },
        },
        measureTexts: {
            value: (requests: TextMeasureRequest[]): TextMetrics[] => {
                counter.batchCalls.push(requests);

                return original.measureTexts(requests);
            },
        },
    });

    DOM.install({ source: wrapped });

    return counter;
}

describe('Text — batched measurement', () => {
    it('case 1: two stale auto-measuring Texts batch into one measureTexts call, both sized correctly', () => {
        const a = new Text('alpha');
        const b = new Text('beta wide label');
        const counter = installCountingMeasureSource();

        const sizeA = a.getPreferredSize();

        expect(counter.batchCalls).toHaveLength(1);
        expect(counter.batchCalls[0]).toHaveLength(2);
        expect(counter.textCalls).toBe(0);

        const sizeB = b.getPreferredSize();
        const [reqA, reqB] = counter.batchCalls[0];
        const expectedA = DOM.source.measureText(reqA.text, reqA.options);
        const expectedB = DOM.source.measureText(reqB.text, reqB.options);

        expect(sizeA).toEqual({ width: expectedA.width, height: expectedA.height });
        expect(sizeB).toEqual({ width: expectedB.width, height: expectedB.height });
    });

    it('case 2: a lone stale Text takes the solo measureText path', () => {
        const a = new Text('solo');
        const counter = installCountingMeasureSource();

        a.getPreferredSize();

        expect(counter.batchCalls).toHaveLength(0);
        expect(counter.textCalls).toBe(1);
    });

    it('case 3: a Text with setAutoMeasure(false) never joins a batch', () => {
        const a = new Text('alpha');
        const b = new Text('beta wide label');
        const off = new Text('opts out').setAutoMeasure(false);
        const counter = installCountingMeasureSource();

        a.getPreferredSize();

        expect(counter.batchCalls).toHaveLength(1);
        expect(counter.batchCalls[0]).toHaveLength(2);
        expect(counter.batchCalls[0].map(r => r.text)).not.toContain('opts out');

        expect(off.getPreferredSize()).toBeNull();

        expect(counter.batchCalls).toHaveLength(1);
        expect(counter.textCalls).toBe(0);
    });

    it('case 4: an empty-text Text never joins a batch and stays 0x0', () => {
        const a = new Text('alpha');
        const b = new Text('beta wide label');
        const empty = new Text('');
        const counter = installCountingMeasureSource();

        a.getPreferredSize();

        expect(counter.batchCalls[0].map(r => r.text)).not.toContain('');
        expect(empty.getPreferredSize()).toEqual({ width: 0, height: 0 });
    });

    it('case 5: no participant probes again after the batch that measured it', () => {
        const a = new Text('alpha');
        const b = new Text('beta wide label');
        const c = new Text('gamma tall label');
        const counter = installCountingMeasureSource();

        a.getPreferredSize();
        expect(counter.batchCalls).toHaveLength(1);

        b.getPreferredSize();
        c.getPreferredSize();
        a.getPreferredSize();

        expect(counter.batchCalls).toHaveLength(1);
        expect(counter.textCalls).toBe(0);
    });

    it('case 6: invalidateTextMetricsCache re-stales every live Text into one batch (theme-reflow group)', () => {
        const a = new Text('alpha');
        const b = new Text('beta wide label');
        const c = new Text('gamma tall label');

        // Establish an initial measurement for all three so they start clean.
        a.getPreferredSize();
        b.getPreferredSize();
        c.getPreferredSize();

        const counter = installCountingMeasureSource();
        Util.invalidateTextMetricsCache();

        a.getPreferredSize();

        expect(counter.batchCalls).toHaveLength(1);
        expect(counter.batchCalls[0]).toHaveLength(3);
    });

    it('case 7: each request carries its own participant\'s font options', () => {
        const a = new Text('alpha').setFontWeight('400');
        const b = new Text('beta wide label').setFontWeight('600');
        const c = new Text('gamma tall label').setFontWeight('700');
        const counter = installCountingMeasureSource();

        a.getPreferredSize();

        expect(counter.batchCalls).toHaveLength(1);
        expect(counter.batchCalls[0].map(r => r.options?.fontWeight)).toEqual(['400', '600', '700']);
    });

    it('case 8: getBaseline() and getMinSize() trigger a batch on the same terms as getPreferredSize()', () => {
        const a1 = new Text('alpha');
        const b1 = new Text('beta wide label');
        const counter = installCountingMeasureSource();

        a1.getBaseline();

        expect(counter.batchCalls).toHaveLength(1);
        expect(counter.batchCalls[0].map(r => r.text)).toEqual(['alpha', 'beta wide label']);

        const a2 = new Text('alpha2');
        const b2 = new Text('beta wide label 2');

        a2.getMinSize();

        expect(counter.batchCalls).toHaveLength(2);
        expect(counter.batchCalls[1].map(r => r.text)).toEqual(['alpha2', 'beta wide label 2']);
    });

    it('case 9: a disposed Text is pruned from the registry and never joins a later batch', () => {
        const a = new Text('alpha');
        const b = new Text('beta wide label');
        const gone = new Text('disposed label');
        gone.dispose();

        const counter = installCountingMeasureSource();

        a.getPreferredSize();

        expect(counter.batchCalls).toHaveLength(1);
        expect(counter.batchCalls[0]).toHaveLength(2);
        expect(counter.batchCalls[0].map(r => r.text)).not.toContain('disposed label');
    });

    it('case 10: DOM.source.measureTexts([]) returns [] and touches the DOM not at all', () => {
        const counter = installCountingMeasureSource();

        expect(DOM.source.measureTexts([])).toEqual([]);
        expect(counter.textCalls).toBe(0);
    });

    it('case 11: a wrapping participant still re-measures its wrapped height after a batch', () => {
        const wrapping = new Text(
            'a fairly long line of wrapping text that needs multiple lines',
            { truncate: false, whiteSpace: 'normal' },
        );
        const other = new Text('short');
        const counter = installCountingMeasureSource();

        const naturalSize = wrapping.getPreferredSize()!;
        expect(counter.batchCalls).toHaveLength(1);
        expect(counter.batchCalls[0]).toHaveLength(2);

        // Narrow enough that the wrapping run can no longer fit on one line.
        wrapping.setWidth(40);

        // `other` is already clean by this point, so this re-measure is solo —
        // not batched — and, per the plan's Potential Challenges, still pays two
        // probes (the natural re-measure, then the wrap-specific one inside
        // `measuredHeight`), same as before this plan.
        expect(counter.batchCalls).toHaveLength(1);
        expect(counter.textCalls).toBe(2);

        const wrappedSize = wrapping.getPreferredSize()!;
        expect(wrappedSize.height).toBeGreaterThan(naturalSize.height);
    });
});

// Behavioural coverage for plans/in-progress/tab-label-styling.md — Expected
// Behaviour rows 1-3: `Text.setFontStyle` gains the same measurement
// invalidation its sibling font setters (`setFontWeight`, `setFontFamily`)
// already have.
describe('Text — font-style re-measure', () => {
    it('a: setFontStyle re-stales an already-measured Text, so the next probe carries the new fontStyle', () => {
        const a = new Text('alpha');
        const b = new Text('beta wide label');

        // Measure both once so they start clean.
        a.getPreferredSize();
        b.getPreferredSize();

        const counter = installCountingMeasureSource();

        a.setFontStyle('italic');
        b.setFontStyle('oblique');

        a.getPreferredSize();

        expect(counter.batchCalls).toHaveLength(1);
        expect(counter.batchCalls[0].map(r => r.options?.fontStyle)).toEqual(['italic', 'oblique']);
    });

    it('b: setFontStyle schedules a layout on the parent, matching setFontWeight', () => {
        const container = new Container({});
        const text = new Text('alpha');

        container.addComponent(text);
        container.getElement(true);
        container.setWidth(200);
        container.setHeight(50);
        container.doLayout();
        // A second pass settles the child's just-measured preferred size (its
        // first-ever measurement fires an onPreferredSizeChange relay that
        // re-schedules the parent once), reaching a genuinely clean state.
        container.doLayout();

        expect(container.isLayoutDirty()).toBe(false);

        text.setFontStyle('italic');

        expect(container.isLayoutDirty()).toBe(true);
    });

    it('c: getFontStyle reports the written value', () => {
        const text = new Text('alpha');

        expect(text.getFontStyle()).toBe('normal');

        text.setFontStyle('italic');

        expect(text.getFontStyle()).toBe('italic');
    });
});
