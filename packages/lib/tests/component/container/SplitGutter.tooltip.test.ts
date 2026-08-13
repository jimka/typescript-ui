import { describe, it, expect, afterEach } from 'vitest';
import { SplitGutter } from '~/component/container/SplitGutter';
import { Tooltip } from '~/overlay/Tooltip';
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

// Reads the singleton's private attachment registry — the same `(Tooltip as any)`
// escape hatch the Tooltip suite uses — to assert whether a component currently
// carries a hover hint.
function hasTooltip(id: string): boolean {
    return (Tooltip as any).attachments.has(id);
}

// Reads the attached hint's text via the same private attachment registry.
function tooltipText(id: string): string | undefined {
    return (Tooltip as any).attachments.get(id)?.text;
}

describe('SplitGutter collapse tooltip gating', () => {
    afterEach(() => {
        const timer = (Tooltip as any).showTimer;

        if (timer !== null) {
            clearTimeout(timer);
            (Tooltip as any).showTimer = null;
        }

        (Tooltip as any).instance = null;
        (Tooltip as any).watching = false;
        (Tooltip as any).activeElement = null;

        DOM.reset();
    });

    it('attaches the double-click hint to a collapsible gutter and its chevron', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        const button = (gutter as any)._collapseButton;

        expect(hasTooltip(gutter.getId())).toBe(true);
        expect(hasTooltip(button.getId())).toBe(true);
    });

    it('drops the hint when the gutter is made non-collapsible', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        const button = (gutter as any)._collapseButton;

        gutter.setCollapsible(false);

        expect(hasTooltip(gutter.getId())).toBe(false);
        expect(hasTooltip(button.getId())).toBe(false);
    });

    it('re-attaches the hint when collapsibility is restored', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        const button = (gutter as any)._collapseButton;

        gutter.setCollapsible(false);
        gutter.setCollapsible(true);

        expect(hasTooltip(gutter.getId())).toBe(true);
        expect(hasTooltip(button.getId())).toBe(true);
    });

    it('never attaches a hint to a gutter constructed non-collapsible', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal', { collapsible: false });
        const button = (gutter as any)._collapseButton;

        expect(hasTooltip(gutter.getId())).toBe(false);
        expect(hasTooltip(button.getId())).toBe(false);
    });
});

describe('SplitGutter collapse tooltip text', () => {
    afterEach(() => {
        const timer = (Tooltip as any).showTimer;

        if (timer !== null) {
            clearTimeout(timer);
            (Tooltip as any).showTimer = null;
        }

        (Tooltip as any).instance = null;
        (Tooltip as any).watching = false;
        (Tooltip as any).activeElement = null;

        DOM.reset();
    });

    it('defaults to the double-click hint text', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');

        expect(tooltipText(gutter.getId())).toBe('Double-click to collapse westward');
    });

    it('reads "Click to …" when collapseTrigger is click', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal', { collapseTrigger: 'click' });

        expect(tooltipText(gutter.getId())).toBe('Click to collapse westward');
    });

    it('keeps the "Click" verb when the gutter flips to the expand hint', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal', { collapseTrigger: 'click' });

        gutter.setOpaque(true);

        expect(tooltipText(gutter.getId())).toBe('Click to expand eastward');
    });
});
