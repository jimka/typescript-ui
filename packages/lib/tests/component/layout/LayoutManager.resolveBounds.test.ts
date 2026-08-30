// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * `LayoutManager.resolveBounds`'s clamp-precedence bug: the two `if / else if`
 * ladders that clamp a child's requested extent to `[minSize, maxSize]` skip
 * the minimum branch whenever the maximum branch fires, so a child whose
 * minimum exceeds its maximum (a contradictory constraint pair) is placed at
 * its maximum instead of its minimum — the opposite of every other clamp in
 * the codebase (`HBox.resolveChildWidth`, `VBox.resolveChildHeight`,
 * `FlowLayout.clampedPreferredSize`, `Component.clampWidth`), which all cap
 * to the maximum first and then floor to the minimum.
 *
 * Modelled on `LayoutManager.commitBounds.test.ts`'s `CONFIG` bag and
 * `Container` host helper.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Fit } from '~/layout/Fit';
import { HFlow } from '~/layout/HFlow';
import { FillType } from '~/layout/FillType';
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

function hostFit(width: number, height: number, fit: Fit): Container {
    const host = new Container({ layoutManager: fit });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

function hostHFlow(width: number, height: number, flow: HFlow): Container {
    const host = new Container({ layoutManager: flow });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('LayoutManager.resolveBounds clamp precedence', () => {
    afterEach(() => DOM.reset());

    it('C1: a child whose minimum exceeds its maximum is placed at its minimum', () => {
        installTestDOM(CONFIG);

        const fit = new Fit({ fill: FillType.NONE });
        const host = hostFit(400, 200, fit);
        const child = new Component({
            preferredSize: { width: 100, height: 30 },
            minSize:       { width: 120, height: 120 },
            maxSize:       { width: 47, height: 47 },
        });

        host.addComponent(child);
        host.doLayout();

        // getWidth()/getHeight() read 120 either way (clampWidth/clampHeight
        // already floor to the minimum) and are not a valid assertion here —
        // it is the child's *position* the clamp bug moves, because the
        // anchor displacement is computed from the wrong width.
        expect(child.getX()).toBe(140);
        expect(child.getY()).toBe(40);
    });

    it('C2: an ordinary child is untouched (control)', () => {
        installTestDOM(CONFIG);

        const fit = new Fit({ fill: FillType.NONE });
        const host = hostFit(400, 200, fit);
        const child = new Component({
            preferredSize: { width: 100, height: 30 },
            minSize:       { width: 40, height: 20 },
            maxSize:       { width: 200, height: 60 },
        });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(150);
        expect(child.getY()).toBe(85);
        expect(child.getWidth()).toBe(100);
        expect(child.getHeight()).toBe(30);
    });

    it('C3: the same fix reaches a flow cell', () => {
        installTestDOM(CONFIG);

        const flow = new HFlow({ spacing: 0 });
        const host = hostHFlow(400, 200, flow);
        const degenerate = new Component({
            preferredSize: { width: 100, height: 30 },
            minSize:       { width: 120, height: 120 },
            maxSize:       { width: 47, height: 47 },
        });
        const sibling = new Component({ preferredSize: { width: 50, height: 16 } });

        host.addComponent(degenerate);
        host.addComponent(sibling);
        host.doLayout();

        // The degenerate child's 120x120 cell exactly fits it; today it is
        // offset by 36.5px and overflows its own cell.
        expect(degenerate.getX()).toBe(0);
        expect(degenerate.getY()).toBe(0);
        expect(sibling.getX()).toBe(120);
    });
});
