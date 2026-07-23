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
    commitAttrs(): this { return this.commitElementAttributes(); }
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

    it('ARIA is unaffected: role appears exactly once', () => {
        const p = new Probe();
        p.getAria().setRole('grid');

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, element).role).toBe('grid');

        const roleWrites = sink.writes.filter(
            w => w.op === 'apply' && w.args[0] === element &&
                (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.role !== undefined
        );

        expect(roleWrites.length).toBe(1);
    });

    it('data-* is unaffected: setDataAttribute still replays onto a freshly created element', () => {
        const p = new Probe();
        p.setDataAttribute('probe-marker', '0,0,0,0');

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, element)['data-probe-marker']).toBe('0,0,0,0');
    });
});

describe('Component element-attribute commit channel', () => {
    it('write while detached, then render: the attach patch carries the value', () => {
        const p = new Probe();
        p.setAttr('contenteditable', 'true');

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        const attrApplies = sink.writes.filter(
            w => w.op === 'apply' && w.args[0] === element &&
                (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.contenteditable !== undefined
        );

        expect(attrApplies.length).toBe(1);
        expect(attrsOf(sink, element).contenteditable).toBe('true');
    });

    it('write while live: one immediate apply carries the value', () => {
        const p = new Probe();
        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        p.setAttr('x', '1');

        const xApplies = sink.writes.filter(
            w => w.op === 'apply' && w.args[0] === element &&
                (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.x !== undefined
        );

        expect(xApplies.length).toBe(1);
        expect(attrsOf(sink, element).x).toBe('1');
    });

    it('remove while detached: created without the key, and no removeAttr patch is ever emitted', () => {
        const p = new Probe();
        p.setAttr('x', '1');
        p.delAttr('x');

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, element).x).toBeUndefined();

        const removeApplies = sink.writes.filter(
            w => w.op === 'apply' &&
                (w.args[1] as { removeAttr?: string[] }).removeAttr?.includes('x')
        );

        expect(removeApplies.length).toBe(0);
    });

    it('batching window collapses writes: nothing touching a, b, or c reaches the handle while open', () => {
        const p = new Probe();
        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        p.setAutoCommitAttributes(false);
        p.setAttr('a', '1');
        p.setAttr('b', '2');
        p.delAttr('c');

        const touching = sink.writes.filter(
            w => w.op === 'apply' && w.args[0] === element &&
                ((w.args[1] as { setAttr?: Record<string, string>; removeAttr?: string[] }).setAttr?.a !== undefined ||
                 (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.b !== undefined ||
                 (w.args[1] as { removeAttr?: string[] }).removeAttr?.includes('c'))
        );

        expect(touching.length).toBe(0);
    });

    it('closing the window flushes once: a single apply sets a and b and removes c', () => {
        const p = new Probe();
        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        p.setAutoCommitAttributes(false);
        p.setAttr('a', '1');
        p.setAttr('b', '2');
        p.delAttr('c');

        const before = sink.writes.length;
        p.setAutoCommitAttributes(true);
        const flushApplies = sink.writes.slice(before).filter(w => w.op === 'apply' && w.args[0] === element);

        expect(flushApplies.length).toBe(1);

        const patch = flushApplies[0].args[1] as { setAttr?: Record<string, string>; removeAttr?: string[] };
        expect(patch.setAttr).toEqual({ a: '1', b: '2' });
        expect(patch.removeAttr).toEqual(['c']);

        expect(attrsOf(sink, element)).toMatchObject({ a: '1', b: '2' });
        expect(attrsOf(sink, element).c).toBeUndefined();
    });

    it('batched writes survive a render: attach writes the retained state regardless of the open window', () => {
        const p = new Probe();
        p.setAutoCommitAttributes(false);
        p.setAttr('a', '1');

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, element).a).toBe('1');
    });

    it('double flush is a no-op: no additional apply once the pending set is empty', () => {
        const p = new Probe();
        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        p.setAutoCommitAttributes(false);
        p.setAttr('a', '1');
        p.setAutoCommitAttributes(true);

        const before = sink.writes.length;
        p.commitAttrs();
        p.commitAttrs();

        const additional = sink.writes.slice(before).filter(w => w.op === 'apply' && w.args[0] === element);

        expect(additional.length).toBe(0);
    });

    it('re-attach to a fresh handle rebuilds everything in one attach patch', () => {
        const p = new Probe();
        p.setAttr('x', '1');
        p.getAria().setRole('grid');
        p.getAria().setTabIndex(0);
        p.getAria().setSelected(true);
        p.setDisabledAttribute(true);

        p.getElement(true);
        const secondElement = p.rerender();
        const sink = DOM.sink as unknown as Recorder;

        // `applyStyle` re-asserts unrelated constraint attributes
        // (`data-maxSize`, `data-insets`) on every render, so the attach
        // patch is identified by carrying `x` rather than by being the only
        // `setAttr`-bearing apply on the handle.
        const attachApplies = sink.writes.filter(
            w => w.op === 'apply' && w.args[0] === secondElement &&
                (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.x !== undefined
        );

        expect(attachApplies.length).toBe(1);
        expect(attachApplies[0].args[1]).toMatchObject({
            setAttr: {
                x: '1',
                role: 'grid',
                tabindex: '0',
                'aria-selected': 'true',
                disabled: '',
            },
        });
    });

    it('data-* write while detached, then render: the created element carries the normalised key', () => {
        const p = new Probe();
        p.setDataAttribute('marker', '1');

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, element)['data-marker']).toBe('1');
    });

    it('getDataAttribute reads back before and after render, both key forms', () => {
        const p = new Probe();
        p.setDataAttribute('marker', '1');

        expect(p.getDataAttribute('marker')).toBe('1');
        expect(p.getDataAttribute('data-marker')).toBe('1');
        expect(p.getDataAttribute('absent')).toBeUndefined();

        p.getElement(true);

        expect(p.getDataAttribute('marker')).toBe('1');
        expect(p.getDataAttribute('data-marker')).toBe('1');
        expect(p.getDataAttribute('absent')).toBeUndefined();
    });

    it('getDataAttribute sees an options-bag data-* key', () => {
        const p = new Probe({ attributes: { 'data-marker': '1' } });

        expect(p.getDataAttribute('marker')).toBe('1');
    });

    it('a later write beats the options-bag seed, and the win survives a re-render', () => {
        const p = new Probe({ attributes: { title: 'a' } });
        p.setAttr('title', 'b');

        const firstElement = p.getElement(true)!;
        const secondElement = p.rerender();
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, firstElement).title).toBe('b');
        expect(attrsOf(sink, secondElement).title).toBe('b');

        const secondTitleWrites = sink.writes.filter(
            w => w.op === 'apply' && w.args[0] === secondElement &&
                (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.title !== undefined
        );

        expect(secondTitleWrites.map(w => (w.args[1] as { setAttr: Record<string, string> }).setAttr.title)).toEqual(['b']);
    });

    it('removing an options-bag-seeded key sticks across a re-render', () => {
        const p = new Probe({ attributes: { title: 'a' } });
        const firstElement = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, firstElement).title).toBe('a');

        p.delAttr('title');
        expect(attrsOf(sink, firstElement).title).toBeUndefined();

        const secondElement = p.rerender();
        expect(attrsOf(sink, secondElement).title).toBeUndefined();

        const secondTitleWrites = sink.writes.filter(
            w => w.op === 'apply' && w.args[0] === secondElement &&
                (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.title !== undefined
        );

        expect(secondTitleWrites.length).toBe(0);
    });

    it('delDataAttribute while detached: no trace on the created element, no removeAttr patch', () => {
        const p = new Probe();
        p.setDataAttribute('marker', '1');
        p.delDataAttribute('marker');

        expect(p.getDataAttribute('marker')).toBeUndefined();

        const element = p.getElement(true)!;
        const sink = DOM.sink as unknown as Recorder;

        expect(attrsOf(sink, element)['data-marker']).toBeUndefined();

        const removeApplies = sink.writes.filter(
            w => w.op === 'apply' &&
                (w.args[1] as { removeAttr?: string[] }).removeAttr?.includes('data-marker')
        );

        expect(removeApplies.length).toBe(0);
    });
});
