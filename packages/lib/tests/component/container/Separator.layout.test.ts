import { describe, it, expect, afterEach } from 'vitest';
import { Separator } from '~/component/container/Separator';
import { Panel } from '~/core/Panel';
import { Component } from '~/core/Component';
import { HBox } from '~/layout/HBox';
import { VBox } from '~/layout/VBox';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
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

afterEach(() => DOM.reset());

/** Renders a Panel at a fixed size and runs a synchronous layout pass. */
function renderPanel(panel: Panel, width: number, height: number): void {
    panel.getElement(true);
    panel.setWidth(width);
    panel.setHeight(height);
    panel.doLayout();
}

describe('Separator spans a VBox column via a horizontal fill constraint', () => {
    it('fills the column width and keeps a 1px height', () => {
        installTestDOM(CONFIG);

        const top = new Component({ preferredSize: { width: 50, height: 20 } });
        const separator = new Separator();
        const bottom = new Component({ preferredSize: { width: 50, height: 20 } });

        const panel = new Panel({ layoutManager: new VBox() });
        panel.addComponent(top);
        panel.addComponent(separator);
        panel.addComponent(bottom);

        renderPanel(panel, 300, 200);

        const inner = panel.getInnerSize()!;

        expect(separator.getHeight()).toBe(1);
        expect(separator.getWidth()).toBe(inner.width);
    });
});

describe('Separator spans an HBox row via a vertical fill constraint', () => {
    it('fills the row height when itemAlign is explicitly "stretch"', () => {
        installTestDOM(CONFIG);

        const hbox = new HBox();
        hbox.setItemAlign('stretch');

        const left = new Component({ preferredSize: { width: 20, height: 50 } });
        const separator = new Separator({ orientation: 'vertical' });
        const right = new Component({ preferredSize: { width: 20, height: 50 } });

        const panel = new Panel({ layoutManager: hbox });
        panel.addComponent(left);
        panel.addComponent(separator);
        panel.addComponent(right);

        renderPanel(panel, 200, 200);

        const inner = panel.getInnerSize()!;

        expect(separator.getWidth()).toBe(1);
        expect(separator.getHeight()).toBe(inner.height);
    });

    it('fills the row height at the default "baseline" itemAlign — fill overrides itemAlign', () => {
        installTestDOM(CONFIG);

        const left = new Component({ preferredSize: { width: 20, height: 50 } });
        const separator = new Separator({ orientation: 'vertical' });
        const right = new Component({ preferredSize: { width: 20, height: 50 } });

        const panel = new Panel({ layoutManager: new HBox() });
        panel.addComponent(left);
        panel.addComponent(separator);
        panel.addComponent(right);

        renderPanel(panel, 200, 200);

        const inner = panel.getInnerSize()!;

        expect(separator.getWidth()).toBe(1);
        expect(separator.getHeight()).toBe(inner.height);
    });
});

describe('Separator defers to a caller-supplied fill', () => {
    it('leaves an explicit FillType.NONE untouched, rendering at its preferred extent', () => {
        installTestDOM(CONFIG);

        const separator = new Separator();
        const panel = new Panel({ layoutManager: new VBox() });
        const constraints = new LayoutConstraints();
        constraints.fill = FillType.NONE;

        panel.addComponent(separator, constraints);

        renderPanel(panel, 300, 200);

        const lm = panel.getLayoutManager();

        expect(lm.getLayoutConstraints(separator)!.fill).toBe(FillType.NONE);
        expect(separator.getWidth()).toBe(0);
    });

    it('adds fill to constraints already carrying a weight, leaving the weight untouched', () => {
        installTestDOM(CONFIG);

        const separator = new Separator();
        const panel = new Panel({ layoutManager: new VBox() });
        const constraints = new LayoutConstraints();
        constraints.weight = 1;

        panel.addComponent(separator, constraints);

        renderPanel(panel, 300, 200);

        const lm = panel.getLayoutManager();
        const stored = lm.getLayoutConstraints(separator)!;

        expect(stored.fill).toBe(FillType.HORIZONTAL);
        expect(stored.weight).toBe(1);
    });
});
