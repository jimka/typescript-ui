// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pins that TabBar's tool-group and lead-group visibility, and every ARIA
// attribute a repeated layout pass touches, are idempotent: a pass that
// changes nothing writes nothing. Component.setVisible's own guard already
// makes a repeated positionToolGroup/positionLeadGroup setVisible(...) call
// a no-op; this file is the regression pin for that (see the plan's
// footnote on the class-toggle counters that never reproduced offline).
import { describe, it, expect, afterEach } from 'vitest';
import { TabBar } from '~/component/container/TabBar';
import { Button } from '~/component/button/Button';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

/** Reaches TabBar's private tool/lead group Panels. */
function chromeGroups(bar: TabBar): { toolGroup: { isVisible(): boolean }; leadGroup: { isVisible(): boolean } } {
    return {
        toolGroup: (bar as unknown as { _toolGroup: { isVisible(): boolean } })._toolGroup,
        leadGroup: (bar as unknown as { _leadGroup: { isVisible(): boolean } })._leadGroup,
    };
}

/** Runs one prepareStrip/placeStrip pass — the sequence Tab.doLayout uses. */
function layoutPass(bar: TabBar): void {
    bar.prepareStrip();
    bar.placeStrip(0, 0, 400, 32);
}

/** Every recorded write that toggles a class or writes an ARIA attribute. */
function classOrAriaWrites(sink: { writes: Array<{ op: string; args: unknown[] }> }): Array<{ op: string; args: unknown[] }> {
    return sink.writes.filter(w => {
        if (w.op !== 'apply') {
            return false;
        }

        const patch = w.args[1] as { addClass?: string[]; removeClass?: string[]; setAttr?: Record<string, string> };

        return patch.addClass !== undefined
            || patch.removeClass !== undefined
            || Object.keys(patch.setAttr ?? {}).some(key => key.startsWith('aria-'));
    });
}

describe('TabBar chrome idempotency', () => {
    it('does not re-hide or re-show the tool/lead groups on an unchanged pass', () => {
        const sink = installTestDOM(CONFIG);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha');
        bar.createBarEntry('b', 'Bravo');
        bar.addTool(new Button({ text: 'T' }));
        bar.setLeadingWidget(new Button({ text: 'L' }));

        bar.getElement(true);
        layoutPass(bar);
        layoutPass(bar);

        const { toolGroup, leadGroup } = chromeGroups(bar);

        expect(toolGroup.isVisible()).toBe(true);
        expect(leadGroup.isVisible()).toBe(true);

        sink.writes.length = 0;
        layoutPass(bar);

        expect(classOrAriaWrites(sink)).toHaveLength(0);
        expect(toolGroup.isVisible()).toBe(true);
        expect(leadGroup.isVisible()).toBe(true);

        bar.dispose();
    });

    it('does not re-hide or re-show the tool/lead groups when both are absent', () => {
        const sink = installTestDOM(CONFIG);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha');
        bar.createBarEntry('b', 'Bravo');

        bar.getElement(true);
        layoutPass(bar);
        layoutPass(bar);

        const { toolGroup, leadGroup } = chromeGroups(bar);

        expect(toolGroup.isVisible()).toBe(false);
        expect(leadGroup.isVisible()).toBe(false);

        sink.writes.length = 0;
        layoutPass(bar);

        expect(classOrAriaWrites(sink)).toHaveLength(0);
        expect(toolGroup.isVisible()).toBe(false);
        expect(leadGroup.isVisible()).toBe(false);

        bar.dispose();
    });
});
