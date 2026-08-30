// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * `Component`'s geometry rounding: `setX`/`setY`/`setWidth`/`setHeight` used to
 * round their own value independently, so at fractional coordinates a
 * component's painted right edge and its neighbour's painted left edge could
 * land 1px apart — a visible seam between two boxes the layout placed flush.
 * The fix derives each extent from `round(origin + extent) - round(origin)`,
 * so a box's far edge always lands exactly where the next box's rounded
 * origin lands.
 *
 * Reads recorded inline styles the way `Component.test.ts`'s "will-change
 * survives applyStyle" tests do: filter `sink.writes` for `w.op === 'apply'
 * && w.args[0] === handle` and read the `.style` object — merged across every
 * matching write, since `setX` and `setWidth` each write both `left` and
 * `width`, so the same key can legitimately be recorded more than once in one
 * sequence.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { HBox } from '~/layout/HBox';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

function hostHBox(width: number, height: number, hbox: HBox): Container {
    const host = new Container({ layoutManager: hbox });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

/** Merges every recorded inline-style write for `handle` into one style object, later writes winning — the same precedence the live DOM applies. */
function mergedStyle(sink: RecordingDOMSink, handle: unknown): Record<string, string> {
    let merged: Record<string, string> = {};

    for (const write of sink.writes) {
        if (write.op !== 'apply' || write.args[0] !== handle) {
            continue;
        }

        const style = (write.args[1] as { style?: Record<string, string> }).style;
        if (style) {
            merged = { ...merged, ...style };
        }
    }

    return merged;
}

describe('Component geometry edge rounding', () => {
    afterEach(() => DOM.reset());

    it('R1: two adjacent boxes at fractional coordinates paint edge to edge', () => {
        const sink = installTestDOM(CONFIG) as RecordingDOMSink;

        const a = new Component({});
        const b = new Component({});
        const handleA = a.getElement(true)!;
        const handleB = b.getElement(true)!;

        a.setX(0.4);
        a.setWidth(10.4);
        b.setX(10.8);
        b.setWidth(10.4);

        expect(mergedStyle(sink, handleA)).toMatchObject({ left: '0px', width: '11px' });
        expect(mergedStyle(sink, handleB)).toMatchObject({ left: '11px', width: '10px' });
    });

    it('R2: a real layout pass keeps a weighted row seam-free', () => {
        const sink = installTestDOM(CONFIG) as RecordingDOMSink;

        const hbox = new HBox({ spacing: 0 });
        const host = hostHBox(400, 40, hbox);
        const a = new Component({});
        const b = new Component({});
        const c = new Component({});

        host.addComponent(a, { weight: 1 });
        host.addComponent(b, { weight: 1 });
        host.addComponent(c, { weight: 1 });
        host.doLayout();

        expect(mergedStyle(sink, a.getElement()!)).toMatchObject({ left: '0px', width: '133px' });
        expect(mergedStyle(sink, b.getElement()!)).toMatchObject({ left: '133px', width: '134px' });
        expect(mergedStyle(sink, c.getElement()!)).toMatchObject({ left: '267px', width: '133px' });
    });

    it('R3: a position-only move re-derives the width', () => {
        const sink = installTestDOM(CONFIG) as RecordingDOMSink;

        const a = new Component({});
        const handle = a.getElement(true)!;

        a.setX(0.6);
        a.setWidth(10.4);
        expect(mergedStyle(sink, handle)).toMatchObject({ left: '1px', width: '10px' });

        // A move with no size change must still re-emit width: the rounded
        // extent depends on the origin as well as the extent.
        a.setX(0.4);
        expect(mergedStyle(sink, handle)).toMatchObject({ left: '0px', width: '11px' });
    });

    it('R4: the render replay agrees with the setter', () => {
        const sink = installTestDOM(CONFIG) as RecordingDOMSink;

        const a = new Component({});
        a.setX(0.4);
        a.setWidth(10.4);

        // Both setters ran before the element existed, so neither wrote to
        // the DOM; the first materialisation must replay the same derivation.
        const handle = a.getElement(true)!;

        expect(mergedStyle(sink, handle)).toMatchObject({ left: '0px', width: '11px' });
    });
});
