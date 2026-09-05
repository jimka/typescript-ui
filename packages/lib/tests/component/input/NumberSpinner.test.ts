//
// Pure value-math coverage for NumberSpinner: clamp / snap / precision and the
// min/max/step bound defaults. NumberSpinner constructs cleanly under bare
// jsdom and exposes its value math without a layout pass, so no TestDOM ritual
// is needed here — every assertion reads a getter immediately after a
// construct or setter call.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NumberSpinner } from '~/component/input/NumberSpinner';
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

describe('NumberSpinner defaults', () => {
    it('defaults value to 0, step to 1, and bounds to ±Infinity', () => {
        const ns = new NumberSpinner();

        expect(ns.getValue()).toBe(0);
        expect(ns.getStep()).toBe(1);
        expect(ns.getMin()).toBe(-Infinity);
        expect(ns.getMax()).toBe(Infinity);
    });

    it('returns null precision when unset (precision is derived from step)', () => {
        expect(new NumberSpinner().getPrecision()).toBe(null);
    });

    it('returns the explicit precision when one was set', () => {
        expect(new NumberSpinner({ precision: 3 }).getPrecision()).toBe(3);
    });
});

describe('NumberSpinner initial value normalisation', () => {
    it('snaps the initial value option to the nearest step multiple', () => {
        // step:2 snaps 7 up to the nearest even multiple, 8.
        expect(new NumberSpinner({ step: 2, value: 7 }).getValue()).toBe(8);
    });

    it('clamps an initial value above max down to max', () => {
        expect(new NumberSpinner({ min: 0, max: 10, value: 100 }).getValue()).toBe(10);
    });

    it('clamps an initial value below min up to min', () => {
        expect(new NumberSpinner({ value: -5, min: 0 }).getValue()).toBe(0);
    });
});

describe('NumberSpinner setValue normalisation', () => {
    it('clamps then snaps to step on setValue', () => {
        const ns = new NumberSpinner({ min: 0, max: 100, step: 10 });
        ns.setValue(23);

        // 23 clamps within [0,100] then snaps to the nearest multiple of 10 → 20.
        expect(ns.getValue()).toBe(20);
    });

    it('clamps a too-large setValue to max', () => {
        const ns = new NumberSpinner({ min: 0, max: 50 });
        ns.setValue(999);

        expect(ns.getValue()).toBe(50);
    });
});

describe('NumberSpinner precision derivation', () => {
    it('derives precision from the step decimal places when precision is unset', () => {
        // step:0.25 → 2 decimal places; setValue(0.1) re-quantises to 0.10.
        const ns = new NumberSpinner({ step: 0.25 });
        ns.setValue(0.13);

        // 0.13 snaps to the nearest 0.25 multiple (0.25) at 2dp precision.
        expect(ns.getValue()).toBe(0.25);
    });

    it('treats an integer step as zero decimal places', () => {
        const ns = new NumberSpinner({ step: 1 });
        ns.setValue(4.9);

        // step:1 → 0dp; 4.9 snaps to 5.
        expect(ns.getValue()).toBe(5);
    });

    it('honours an explicit precision over the step-derived one', () => {
        // precision:1 with a fine step keeps one decimal place after snapping.
        const ns = new NumberSpinner({ step: 0.1, precision: 1 });
        ns.setValue(0.249);

        expect(ns.getValue()).toBe(0.2);
    });
});

describe('NumberSpinner bound setters', () => {
    it('updates the cached min via setMin and clears it with -Infinity', () => {
        const ns = new NumberSpinner();
        ns.setMin(5);
        expect(ns.getMin()).toBe(5);

        ns.setMin(-Infinity);
        expect(ns.getMin()).toBe(-Infinity);
    });

    it('updates the cached max via setMax and clears it with Infinity', () => {
        const ns = new NumberSpinner();
        ns.setMax(20);
        expect(ns.getMax()).toBe(20);

        ns.setMax(Infinity);
        expect(ns.getMax()).toBe(Infinity);
    });

    it('reports an updated step via getStep', () => {
        const ns = new NumberSpinner();
        ns.setStep(4);

        expect(ns.getStep()).toBe(4);
    });
});

// Confirms NumberSpinner needs no code of its own for TextInput.cut() —
// unlike AbstractPickerField/AutoCompleteField, NumberSpinner wires only
// "blur"/"keydown" on `_input` (NumberSpinner.ts:210-211), never "input", so
// cut()'s Event.fireEvent(this, "input") re-fire has no listener to reach
// here; a cut behaves like typing arbitrary uncommitted text already does
// today. No source changes to NumberSpinner.ts back this.
describe('NumberSpinner inner-input cut', () => {
    let sink: RecordingDOMSink;
    let spinner: NumberSpinner | undefined;

    beforeEach(() => { sink = installTestDOM(CONFIG); });
    afterEach(() => { spinner?.dispose(); spinner = undefined; DOM.reset(); });

    it('cutting from the inner _input records a clipboard write and changes its displayed text, leaving the committed value unchanged until blur', () => {
        spinner = new NumberSpinner({ value: 42 });
        const input = (spinner as any)._input;
        const el = input.getElement(true)!;
        const displayed = input.getText();

        DOM.sink.setSelectionRange(el, 0, displayed.length);

        input.cut();

        const writes = sink.writes.filter(w => w.op === 'writeClipboardText');
        expect(writes.length).toBe(1);
        expect(writes[0].args[0]).toBe(displayed);
        expect(input.getText()).toBe('');
        expect(spinner.getValue()).toBe(42);
    });
});
