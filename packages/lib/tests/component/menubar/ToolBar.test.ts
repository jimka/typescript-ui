import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolBar } from '~/component/menubar/ToolBar';
import { ToolBarSeparator } from '~/component/menubar/ToolBarSeparator';
import { Button } from '~/component/button/Button';
import { HBox } from '~/layout/HBox';
import { VBox } from '~/layout/VBox';
import { Component } from '~/core/Component';
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

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

function childCount(bar: ToolBar): number {
    return (bar as unknown as Component).getComponents().length;
}

describe('ToolBar orientation', () => {
    it('defaults to horizontal with an HBox layout manager', () => {
        const bar = new ToolBar();

        expect(bar.getOrientation()).toBe('horizontal');
        expect(bar.getLayoutManager()).toBeInstanceOf(HBox);
    });
    it('swaps to a VBox layout manager on setOrientation("vertical")', () => {
        const bar = new ToolBar();

        bar.setOrientation('vertical');

        expect(bar.getOrientation()).toBe('vertical');
        expect(bar.getLayoutManager()).toBeInstanceOf(VBox);
    });
    it('preserves component spacing across the orientation swap', () => {
        const bar = new ToolBar();

        (bar.getLayoutManager() as HBox).setComponentSpacing(7);

        bar.setOrientation('vertical');

        expect((bar.getLayoutManager() as VBox).getComponentSpacing()).toBe(7);
    });
    it('is a no-op on the same orientation (keeps the same manager instance)', () => {
        const bar = new ToolBar();
        const lm = bar.getLayoutManager();

        bar.setOrientation('horizontal');

        expect(bar.getLayoutManager()).toBe(lm);
    });
    it('applies an { orientation: "vertical" } option', () => {
        expect(new ToolBar({ orientation: 'vertical' }).getOrientation()).toBe('vertical');
    });
    it('defaults to a bottom border rule', () => {
        expect(new ToolBar().getBorder()).toEqual({
            borderBottom: '1px solid var(--ts-ui-toolbar-border, rgb(220, 220, 220))',
        });
    });
    it('derives a right border rule for { orientation: "vertical" }', () => {
        expect(new ToolBar({ orientation: 'vertical' }).getBorder()).toEqual({
            borderRight: '1px solid var(--ts-ui-toolbar-border, rgb(220, 220, 220))',
        });
    });
    it('honours a construction-time border override on the default orientation', () => {
        const bar = new ToolBar({ border: { borderBottom: '2px dashed red' } });

        expect(bar.getBorder()).toEqual({ borderBottom: '2px dashed red' });
    });
    it('honours a construction-time border override alongside an explicit orientation', () => {
        const bar = new ToolBar({ orientation: 'vertical', border: { borderLeft: '3px solid blue' } });

        expect(bar.getBorder()).toEqual({ borderLeft: '3px solid blue' });
    });
    it('recomputes the border unconditionally on a runtime setOrientation, dropping a construction-time override', () => {
        const bar = new ToolBar({ border: { borderBottom: '2px dashed red' } });

        bar.setOrientation('vertical');

        expect(bar.getBorder()).toEqual({
            borderRight: '1px solid var(--ts-ui-toolbar-border, rgb(220, 220, 220))',
        });
    });
});

describe('ToolBar compact', () => {
    it('defaults to compact (documented compact: true default)', () => {
        // ToolBar's _defaultOptions set compact: true, and the JSDoc states the
        // bar "defaults to compact mode" — so a bare ToolBar is compact.
        expect(new ToolBar().isCompact()).toBe(true);
    });
    it('round-trips setCompact', () => {
        const bar = new ToolBar();

        bar.setCompact(false);
        expect(bar.isCompact()).toBe(false);

        bar.setCompact(true);
        expect(bar.isCompact()).toBe(true);
    });
    it('applies a { compact: false } option', () => {
        expect(new ToolBar({ compact: false }).isCompact()).toBe(false);
    });
});

describe('ToolBar child registration', () => {
    it('registers added buttons and separators', () => {
        const bar = new ToolBar();

        bar.addComponent(new Button('Cut'));
        bar.addComponent(new Button('Copy'));
        bar.addComponent(new ToolBarSeparator());

        expect(childCount(bar)).toBe(3);
    });
});
