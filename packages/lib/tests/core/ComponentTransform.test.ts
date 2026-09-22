// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Pins where `Component.setTransform` / `clearTransform` write, and how they
 * share the element's one inline `transform` declaration with `setTranslate`.
 * A stylesheet-rule write restyles the whole document in WebKitGTK, so a
 * transform the library changes per frame or per event (a `DiagramView` pan, a
 * `Toggle` flip, a caret turning) must write the element's inline style. Both
 * setters then own the same declaration, which is composed from the cached
 * translate and transform — the translate first — so neither erases the
 * other, and `applyStyle`'s render-time replay writes the same composed value.
 *
 * See plans/implemented/motion-transform-inline.md, *Expected Behaviour*.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { Toggle } from '~/component/input/Toggle';
import { installTestDOM, RecordingDOMSink, ruleStyleWrites } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

/**
 * Every inline `transform` value (including a `null` removal) recorded on an
 * `apply` op, in order.
 *
 * @param sink - The recording sink to read.
 * @param handle - When given, only writes to this element are read.
 * @returns The recorded values, oldest first.
 */
function inlineTransformWrites(sink: RecordingDOMSink, handle?: Handle): Array<string | null> {
    return sink.writes
        .filter(w => w.op === 'apply' && (handle === undefined || w.args[0] === handle))
        .map(w => (w.args[1] as { style?: Record<string, string | null> }).style)
        .filter((style): style is Record<string, string | null> => style !== undefined && 'transform' in style)
        .map(style => style.transform);
}

/** Every recorded stylesheet-rule declaration whose key is `transform`. */
function ruleTransformWrites(sink: RecordingDOMSink): Array<{ selector: string; key: string; value: string | null }> {
    return ruleStyleWrites(sink).filter(r => r.key === 'transform');
}

/**
 * Drops every recorded write up to and including the last `apply` that
 * removed the element's `style` attribute — `applyStyle`'s leading wipe — so
 * what remains is the render's replay.
 *
 * @param sink - The recording sink to trim in place.
 */
function keepWritesAfterStyleWipe(sink: RecordingDOMSink): void {
    let wipe = -1;

    sink.writes.forEach((w, i) => {
        const patch = w.args[1] as { removeAttr?: string[] } | undefined;

        if (w.op === 'apply' && patch?.removeAttr?.includes('style')) {
            wipe = i;
        }
    });

    expect(wipe).toBeGreaterThanOrEqual(0);

    sink.writes.splice(0, wipe + 1);
}

/** The last recorded inline `transform` value; fails when none was written. */
function lastInlineTransform(sink: RecordingDOMSink): string | null {
    const writes = inlineTransformWrites(sink);

    expect(writes.length).toBeGreaterThan(0);

    return writes[writes.length - 1];
}

/** A plain component rendered with `getElement(true)`, its recorded writes then cleared. */
function rendered(): { sink: RecordingDOMSink; component: Component } {
    const sink      = installTestDOM(CONFIG);
    const component = new Component({});

    component.getElement(true);
    sink.writes.length = 0;

    return { sink, component };
}

describe('Component.setTransform — writes the element inline', () => {
    it('T1: writes the transform inline, not to the rule, and reports it', () => {
        const { sink, component } = rendered();

        component.setTransform('rotate(180deg)');

        expect(inlineTransformWrites(sink)).toEqual(['rotate(180deg)']);
        expect(ruleTransformWrites(sink)).toEqual([]);
        expect(component.getTransform()).toBe('rotate(180deg)');
    });

    it('T2: writes nothing on a repeat of the transform it already holds', () => {
        const { sink, component } = rendered();

        component.setTransform('rotate(180deg)');
        sink.writes.length = 0;

        component.setTransform('rotate(180deg)');

        expect(sink.writes).toEqual([]);
    });
});

describe('Component transform composition — the translate first, then the transform', () => {
    it('T3: a transform set after a translate follows it', () => {
        const { sink, component } = rendered();

        component.setTranslate(3, 4);
        component.setTransform('rotate(180deg)');

        expect(lastInlineTransform(sink)).toBe('translate3d(3px,4px,0) rotate(180deg)');
    });

    it('T4: a translate set after a transform goes before it', () => {
        const { sink, component } = rendered();

        component.setTransform('rotate(180deg)');
        component.setTranslate(3, 4);

        expect(lastInlineTransform(sink)).toBe('translate3d(3px,4px,0) rotate(180deg)');
    });

    it('T5: releasing the translate leaves the transform in place', () => {
        const { sink, component } = rendered();

        component.setTransform('rotate(180deg)');
        component.setTranslate(3, 4);
        component.setTranslate(0, 0);

        expect(lastInlineTransform(sink)).toBe('rotate(180deg)');
    });

    it('T6: clearTransform keeps a live translate and never touches the rule', () => {
        const { sink, component } = rendered();

        component.setTranslate(3, 4);
        component.setTransform('rotate(1deg)');
        component.clearTransform();

        expect(lastInlineTransform(sink)).toBe('translate3d(3px,4px,0)');
        expect(ruleTransformWrites(sink)).toEqual([]);
        expect(component.getTransform()).toBeNull();
        expect(component.getTranslateX()).toBe(3);
    });

    it('T7: clearTransform with no translate removes the declaration', () => {
        const { sink, component } = rendered();

        component.setTransform('scale(2)');
        component.clearTransform();

        expect(lastInlineTransform(sink)).toBeNull();
    });

    it('T8: clearTransform with no transform set writes nothing', () => {
        const { sink, component } = rendered();

        component.clearTransform();

        expect(sink.writes).toEqual([]);
    });

    it('T9: a translate-only sequence writes exactly what it did before composition', () => {
        const { sink, component } = rendered();

        component.setTranslate(3, 4);
        component.setTranslate(0, 0);

        expect(inlineTransformWrites(sink)).toEqual(['translate3d(3px,4px,0)', null]);
    });

    it('T12: an empty transform contributes nothing after the translate', () => {
        const { sink, component } = rendered();

        component.setTranslate(3, 4);
        component.setTransform('');

        expect(lastInlineTransform(sink)).toBe('translate3d(3px,4px,0)');
        expect(component.getTransform()).toBe('');
    });

    it('T13: a refused non-finite translate writes nothing over the transform', () => {
        const { sink, component } = rendered();

        component.setTransform('rotate(1deg)');

        const afterFirst = sink.writes.length;

        component.setTranslate(NaN, 4);

        expect(sink.writes.slice(afterFirst)).toEqual([]);
        expect(component.getTranslateX()).toBe(0);
    });
});

describe('Component transform composition — a keyword that is not a transform list', () => {
    it('T16: `none` with no translate is written as given', () => {
        const { sink, component } = rendered();

        component.setTransform('none');

        expect(inlineTransformWrites(sink)).toEqual(['none']);
        expect(component.getTransform()).toBe('none');
    });

    it('T17: `none` adds nothing while a translate is set, and returns once the translate is released', () => {
        const { sink, component } = rendered();

        component.setTranslate(3, 4);
        component.setTransform('none');

        expect(lastInlineTransform(sink)).toBe('translate3d(3px,4px,0)');
        expect(component.getTransform()).toBe('none');

        component.setTranslate(0, 0);

        expect(lastInlineTransform(sink)).toBe('none');
    });

    it('T18: a CSS-wide keyword, in any case and with surrounding space, adds nothing to a translate', () => {
        const { sink, component } = rendered();

        component.setTransform(' Inherit ');
        component.setTranslate(3, 4);

        expect(lastInlineTransform(sink)).toBe('translate3d(3px,4px,0)');
        expect(component.getTransform()).toBe(' Inherit ');
    });

    it('T19: a CSS-wide keyword with no translate is written as given', () => {
        const { sink, component } = rendered();

        component.setTransform('UNSET');

        expect(inlineTransformWrites(sink)).toEqual(['UNSET']);
    });

    it('T20: `revert-layer` is a keyword too, not a transform function', () => {
        const { sink, component } = rendered();

        component.setTranslate(3, 4);
        component.setTransform('revert-layer');

        expect(lastInlineTransform(sink)).toBe('translate3d(3px,4px,0)');
    });
});

describe('Component transform replay — the render writes the composed value', () => {
    it('T10: a construction-time transform is replayed inline after the render wipe', () => {
        const sink      = installTestDOM(CONFIG);
        const component = new Component({ transform: 'rotate(45deg)' });

        component.getElement(true);

        expect(ruleTransformWrites(sink)).toEqual([]);

        keepWritesAfterStyleWipe(sink);

        expect(inlineTransformWrites(sink)).toContain('rotate(45deg)');
    });

    it('T11: a re-render replays the rounded translate followed by the transform', () => {
        const { sink, component } = rendered();

        component.setTranslate(2.6, 0);
        component.setTransform('translate(10px, 20px) scale(1.5)');
        sink.writes.length = 0;

        component.setId('g28-probe');

        keepWritesAfterStyleWipe(sink);

        expect(lastInlineTransform(sink)).toBe('translate3d(3px,0px,0) translate(10px, 20px) scale(1.5)');
    });
});

describe('Component transform — a mounted Toggle flip', () => {
    it('T14: setValue(true) writes the thumb transform inline, never to its #id rule', () => {
        const sink   = installTestDOM(CONFIG);
        const toggle = new Toggle();

        toggle.getElement(true);

        const thumb         = (toggle as any)._thumb as Component;
        const thumbSelector = '#' + DOM.source.escapeSelector(thumb.getId());

        const thumbHandle = thumb.getElement(true);

        sink.writes.length = 0;

        toggle.setValue(true);

        expect(ruleStyleWrites(sink).filter(r => r.selector === thumbSelector)).toEqual([]);
        expect(inlineTransformWrites(sink, thumbHandle)).toContain('translateX(16px)');
    });
});
