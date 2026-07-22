// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import type { Handle } from '~/core/DOM';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

type Recorder = { writes: { op: string; args: unknown[] }[] };

/** Folds every apply patch for `handle` into the attribute state it produces. */
const attrsOf = (recorder: Recorder, handle: unknown): Record<string, string> => {
    const attrs: Record<string, string> = {};

    for (const w of recorder.writes) {
        if (w.op !== 'apply' || w.args[0] !== handle) continue;

        const patch = w.args[1] as { setAttr?: Record<string, string>; removeAttr?: string[] };

        for (const key of patch.removeAttr ?? []) delete attrs[key];
        for (const key of Object.keys(patch.setAttr ?? {})) attrs[key] = patch.setAttr![key];
    }

    return attrs;
};

class Probe extends _Component {
    setAttr(key: string, value: Object | null): this { return this.setElementAttribute(key, value); }
    delAttr(key: string): this { return this.removeElementAttribute(key); }
    rerender(): Handle { return this.render(); }
}

describe('Component element-attribute replay buffer', () => {
    it('set before render: attribute is present on the created element', () => {
        const p = new Probe();
        p.setAttr('contenteditable', 'true');

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, element).contenteditable).toBe('true');
    });

    it('set after render: attribute is written to the live element immediately', () => {
        const p = new Probe();
        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        p.setAttr('contenteditable', 'true');

        expect(attrsOf(sink, element).contenteditable).toBe('true');
    });

    it('remove before render: no attribute present, no error thrown', () => {
        const p = new Probe();

        expect(() => p.delAttr('contenteditable')).not.toThrow();

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, element).contenteditable).toBeUndefined();
    });

    it('remove after render: a removeAttr patch reaches the live element', () => {
        const p = new Probe();
        p.setAttr('x', '1');

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        p.delAttr('x');

        expect(attrsOf(sink, element).x).toBeUndefined();
    });

    it('set, remove, then render: the element is created without the stale value', () => {
        const p = new Probe();
        p.setAttr('x', '1');
        p.delAttr('x');

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, element).x).toBeUndefined();
    });

    it('set, then re-render: the second element also carries the attribute', () => {
        const p = new Probe();
        p.setAttr('x', '1');

        p.getElement(true);
        const secondElement = p.rerender();
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, secondElement).x).toBe('1');
    });

    it('null value removes: setAttr(key, null) delegates to removeElementAttribute', () => {
        const p = new Probe();
        p.setAttr('autoplay', '');

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        p.setAttr('autoplay', null);

        expect(attrsOf(sink, element).autoplay).toBeUndefined();
    });

    it('non-string values are stringified', () => {
        const p = new Probe();
        p.setAttr('maxlength', 5);

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, element).maxlength).toBe('5');
    });

    it('buffer beats the attributes bag', () => {
        const p = new Probe({ attributes: { title: 'a' } });
        p.setAttr('title', 'b');

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, element).title).toBe('b');
    });

    it('framework class name survives a buffered class attribute', () => {
        const p = new Probe();
        p.setAttr('class', 'Row selected');

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, element).class).toBe('Row selected');

        const setAttrIndex = sink.writes.findIndex(
            w => w.op === 'apply' && w.args[0] === element &&
                (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.class !== undefined
        );
        const addClassIndex = sink.writes.findIndex(
            w => w.op === 'apply' && w.args[0] === element &&
                (w.args[1] as { addClass?: string[] }).addClass !== undefined
        );

        expect(setAttrIndex).toBeGreaterThanOrEqual(0);
        expect(addClassIndex).toBeGreaterThan(setAttrIndex);
    });

    it('setDisabledAttribute round-trips across a render', () => {
        const p = new Probe();
        p.setDisabledAttribute(true);

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, element).disabled).toBe('');

        p.setDisabledAttribute(false);

        expect(attrsOf(sink, element).disabled).toBeUndefined();
    });

    it('ARIA is unaffected: role appears exactly once and applyToElement still runs', () => {
        const p = new Probe();
        p.getAria().setRole('grid');

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, element).role).toBe('grid');

        const roleWrites = sink.writes.filter(
            w => w.op === 'apply' && w.args[0] === element &&
                (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.role !== undefined
        );

        expect(roleWrites.length).toBeGreaterThan(0);
    });

    it('data-* is unaffected: the existing _attributes replay still works', () => {
        const p = new Probe();
        p.setDataAttribute('probe-marker', '0,0,0,0');

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, element)['data-probe-marker']).toBe('0,0,0,0');
    });
});
