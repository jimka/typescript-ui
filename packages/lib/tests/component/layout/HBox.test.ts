import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { HBox } from '~/layout/HBox';
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

/**
 * Builds a Container hosting an HBox, sized and inset-cleared so cell origins
 * start at (0,0). The host MUST be a Container (clampsToContentSize() === false)
 * and have a materialised element, or doLayout() early-returns / collapses.
 */
function hostHBox(width: number, height: number, hbox: HBox): Container {
    const host = new Container({ layoutManager: hbox });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('HBox', () => {
    it('defaults component spacing to 5', () => {
        expect(new HBox().getComponentSpacing()).toBe(5);
    });
    it('updates component spacing', () => {
        const hbox = new HBox();
        hbox.setComponentSpacing(10);
        expect(hbox.getComponentSpacing()).toBe(10);
    });
    it('defaults stretching to false', () => {
        expect(new HBox().isStretching()).toBe(false);
    });
    it('toggles stretching', () => {
        const hbox = new HBox();
        hbox.setStretching(true);
        expect(hbox.isStretching()).toBe(true);
    });
    it('doLayout() does not throw without a container', () => {
        expect(() => new HBox().doLayout()).not.toThrow();
    });
});

describe('HBox resolveChildWidth clamp ordering', () => {
    afterEach(() => DOM.reset());

    it('honours the minimum over a smaller maximum, so a later sibling does not overlap (degenerate min > max)', () => {
        installTestDOM(CONFIG);

        const hbox = new HBox();
        const host = hostHBox(800, 200, hbox);
        const stage = new Component({ preferredSize: { width: 120, height: 50 } });
        stage.setMinSize({ width: 120, height: 50 });
        stage.setMaxSize({ width: 47, height: 50 });
        const toggle = new Component({ preferredSize: { width: 30, height: 50 } });

        host.addComponent(stage);
        host.addComponent(toggle);
        host.doLayout();

        // The stage's own committed width always lands on its min (120) once
        // Component.setWidth's clampWidth reasserts it — that step alone
        // doesn't distinguish the bug from the fix.
        expect(stage.getWidth()).toBe(120);

        // What DOES distinguish them: the row must reserve the stage's full
        // min width before advancing to the next child, not the smaller
        // (wrong) max it clamps to internally. Before the fix, the toggle
        // lands at 47 + spacing, overlapping the stage's last 73px.
        expect(toggle.getX()).toBe(120 + hbox.getComponentSpacing());
    });
});
