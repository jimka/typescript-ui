// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// `Text.setText` schedules its parent's layout so the parent can re-fit against
// the new preferred size — but a Text with `setAutoMeasure(false)` never gets a
// new preferred size: `calculateSize` returns before touching the preferred
// size, the minimum size, or the baseline in that mode. Scheduling anyway made
// every pooled-row rebind (cell / list / tree renderers all opt out of
// auto-measure) queue a next-frame layout pass per renderer that recomputed an
// identical rectangle — the redundant half of a table's vertical-scroll cost.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Component } from '~/core/Component';
import { Text } from '~/component/input/Text';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** A realized host holding one child `Text`, the shape every renderer uses. */
function hostedText(): { host: Component, text: Text } {
    const host = new Component();
    const text = new Text('start');

    host.addComponent(text);
    host.getElement(true);
    host.setWidth(120);
    host.setHeight(20);
    host.doLayout();

    return { host, text };
}

describe('Text.setText — parent layout schedule', () => {
    it('schedules the parent while auto-measure is on', () => {
        const { host, text } = hostedText();
        const scheduled = vi.spyOn(host, 'scheduleLayout');

        text.setText('a wider replacement string');

        expect(scheduled).toHaveBeenCalled();
    });

    it('does not schedule the parent while auto-measure is off', () => {
        const { host, text } = hostedText();

        text.setAutoMeasure(false);

        const scheduled = vi.spyOn(host, 'scheduleLayout');

        text.setText('a wider replacement string');

        expect(scheduled).not.toHaveBeenCalled();
    });

    it('still writes the text and still marks the measurement stale', () => {
        const { text } = hostedText();

        text.setAutoMeasure(false);
        text.setText('rebound value');

        expect(text.getText()).toBe('rebound value');

        // `measure()` is the documented escape hatch for an opted-out Text
        // (tree / list label renderers use it): it must still see the change,
        // which it only does if `setText` kept marking the measurement dirty.
        text.measure();

        expect(text.getPreferredSize()?.width).toBeGreaterThan(0);
    });
});
