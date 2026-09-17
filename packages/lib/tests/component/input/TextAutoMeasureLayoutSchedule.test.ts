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

// The same-string early return — see
// plans/implemented/component-setter-guards.md. `Text.setText` is the
// library's most-called API: every pooled table / list / tree row rebinds
// through it, and a rebind that lands the value the row already shows used to
// pay a full DOM write, a measurement invalidation and (with auto-measure on)
// a parent layout pass for nothing.
describe('Text.setText — same-string guard', () => {
    it('writes nothing and schedules nothing for a byte-identical string', () => {
        const { host, text } = hostedText();
        const scheduled = vi.spyOn(host, 'scheduleLayout');
        const sink      = DOM.sink as unknown as { writes: Array<{ op: string }> };

        sink.writes.length = 0;

        text.setText('start');

        expect(sink.writes).toHaveLength(0);
        expect(scheduled).not.toHaveBeenCalled();
    });

    it('leaves the measurement fresh for a byte-identical string', () => {
        const { text } = hostedText();

        text.measure();

        const measured = text.getPreferredSize()?.width;

        text.setText('start');

        // Unchanged text cannot move the measured extent, so the guard must
        // leave the cached one in place rather than re-deriving it.
        expect((text as unknown as { _measurementDirty: boolean })._measurementDirty).toBe(false);
        expect(text.getPreferredSize()?.width).toBe(measured);
    });

    it('still writes, marks stale and schedules for a changed string', () => {
        const { host, text } = hostedText();
        const scheduled = vi.spyOn(host, 'scheduleLayout');
        const sink      = DOM.sink as unknown as { writes: Array<{ op: string }> };

        text.measure();
        sink.writes.length = 0;

        text.setText('a wider replacement string');

        expect(text.getText()).toBe('a wider replacement string');
        expect(sink.writes.length).toBeGreaterThan(0);
        expect((text as unknown as { _measurementDirty: boolean })._measurementDirty).toBe(true);
        expect(scheduled).toHaveBeenCalled();
    });
});
