import { describe, it, expect, afterEach, vi } from 'vitest';
import { FloatingPanel } from '~/component/container/FloatingPanel';
import { Component } from '~/core/Component';
import { Anchor } from '~/layout/Anchor';
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

describe('FloatingPanel corner -> AnchorConstraints mapping', () => {
    afterEach(() => DOM.reset());

    it('defaults to top-right with a 12px margin', () => {
        installTestDOM(CONFIG);

        const panel = new FloatingPanel({});

        expect(panel.getCorner()).toBe('top-right');
        expect(panel.getMargin()).toBe(12);

        const constraints = panel.getAnchorConstraints();

        expect(constraints.top).toBe(12);
        expect(constraints.right).toBe(12);
        expect(constraints.left).toBeUndefined();
        expect(constraints.bottom).toBeUndefined();
    });

    it('maps top-left to { top, left }', () => {
        installTestDOM(CONFIG);

        const constraints = new FloatingPanel({ corner: 'top-left', margin: 8 }).getAnchorConstraints();

        expect(constraints.top).toBe(8);
        expect(constraints.left).toBe(8);
        expect(constraints.right).toBeUndefined();
        expect(constraints.bottom).toBeUndefined();
    });

    it('maps bottom-left to { bottom, left }', () => {
        installTestDOM(CONFIG);

        const constraints = new FloatingPanel({ corner: 'bottom-left', margin: 8 }).getAnchorConstraints();

        expect(constraints.bottom).toBe(8);
        expect(constraints.left).toBe(8);
        expect(constraints.top).toBeUndefined();
        expect(constraints.right).toBeUndefined();
    });

    it('maps bottom-right to { bottom, right }', () => {
        installTestDOM(CONFIG);

        const constraints = new FloatingPanel({ corner: 'bottom-right', margin: 8 }).getAnchorConstraints();

        expect(constraints.bottom).toBe(8);
        expect(constraints.right).toBe(8);
        expect(constraints.top).toBeUndefined();
        expect(constraints.left).toBeUndefined();
    });

    it('default insets are zero', () => {
        installTestDOM(CONFIG);

        const insets = new FloatingPanel({}).getInsets();

        expect([insets.getTop(), insets.getRight(), insets.getBottom(), insets.getLeft()]).toEqual([0, 0, 0, 0]);
    });
});

describe('FloatingPanel.setCorner / setMargin', () => {
    afterEach(() => DOM.reset());

    it('setCorner mutates the same AnchorConstraints instance in place', () => {
        installTestDOM(CONFIG);

        const panel = new FloatingPanel({});
        const constraints = panel.getAnchorConstraints();

        panel.setCorner('bottom-left');

        expect(panel.getAnchorConstraints()).toBe(constraints);
        expect(constraints.bottom).toBe(12);
        expect(constraints.left).toBe(12);
        expect(constraints.top).toBeUndefined();
        expect(constraints.right).toBeUndefined();
    });

    it('setMargin mutates the same AnchorConstraints instance in place', () => {
        installTestDOM(CONFIG);

        const panel = new FloatingPanel({});
        const constraints = panel.getAnchorConstraints();

        panel.setMargin(20);

        expect(panel.getAnchorConstraints()).toBe(constraints);
        expect(constraints.top).toBe(20);
        expect(constraints.right).toBe(20);
    });

    it('setCorner only schedules the parent\'s layout when the value actually changes', () => {
        installTestDOM(CONFIG);

        const parent = new Component({ layoutManager: new Anchor() });
        const panel = new FloatingPanel({});

        parent.addComponent(panel, panel.getAnchorConstraints());

        const scheduleLayoutSpy = vi.spyOn(parent, 'scheduleLayout');

        panel.setCorner('top-right'); // unchanged (the default)
        expect(scheduleLayoutSpy).not.toHaveBeenCalled();

        panel.setCorner('bottom-left');
        expect(scheduleLayoutSpy).toHaveBeenCalledTimes(1);
    });

    it('setMargin only schedules the parent\'s layout when the value actually changes', () => {
        installTestDOM(CONFIG);

        const parent = new Component({ layoutManager: new Anchor() });
        const panel = new FloatingPanel({});

        parent.addComponent(panel, panel.getAnchorConstraints());

        const scheduleLayoutSpy = vi.spyOn(parent, 'scheduleLayout');

        panel.setMargin(12); // unchanged (the default)
        expect(scheduleLayoutSpy).not.toHaveBeenCalled();

        panel.setMargin(20);
        expect(scheduleLayoutSpy).toHaveBeenCalledTimes(1);
    });
});
