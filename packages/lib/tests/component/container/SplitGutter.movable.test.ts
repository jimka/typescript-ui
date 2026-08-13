import { describe, it, expect, afterEach, vi } from 'vitest';
import { SplitGutter } from '~/component/container/SplitGutter';
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

describe('SplitGutter live movable flag', () => {
    afterEach(() => DOM.reset());

    it('is movable by default and fires dragstart on mousedown', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        const onDragStart = vi.fn();

        gutter.on('dragstart', onDragStart);

        expect(gutter.isMovable()).toBe(true);

        gutter.onDragStart({ clientX: 10 } as MouseEvent);

        expect(onDragStart).toHaveBeenCalledWith(10);

        gutter.onDragStop();
    });

    it('fires no dragstart once locked via setMovable(false)', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        const onDragStart = vi.fn();

        gutter.on('dragstart', onDragStart);
        gutter.setMovable(false);

        gutter.onDragStart({ clientX: 10 } as MouseEvent);

        expect(onDragStart).not.toHaveBeenCalled();
    });

    it('resumes firing dragstart once unlocked via setMovable(true)', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        const onDragStart = vi.fn();

        gutter.on('dragstart', onDragStart);
        gutter.setMovable(false);
        gutter.setMovable(true);

        gutter.onDragStart({ clientX: 10 } as MouseEvent);

        expect(onDragStart).toHaveBeenCalledWith(10);

        gutter.onDragStop();
    });

    it('sets the default cursor when locked and restores the axis resize cursor when unlocked', () => {
        installTestDOM(CONFIG);

        const horizontal = new SplitGutter('horizontal');
        horizontal.getElement(true);

        horizontal.setMovable(false);
        expect(horizontal.getCursor()).toBe('default');

        horizontal.setMovable(true);
        expect(horizontal.getCursor()).toBe('ew-resize');

        const vertical = new SplitGutter('vertical');
        vertical.getElement(true);

        vertical.setMovable(false);
        expect(vertical.getCursor()).toBe('default');

        vertical.setMovable(true);
        expect(vertical.getCursor()).toBe('ns-resize');
    });

    it('still refuses the drag while opaque, regardless of movable', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        const onDragStart = vi.fn();

        gutter.on('dragstart', onDragStart);
        gutter.setOpaque(true);

        gutter.onDragStart({ clientX: 10 } as MouseEvent);

        expect(onDragStart).not.toHaveBeenCalled();
    });

    it('leaves the tooltip text unchanged by setMovable in either direction', () => {
        installTestDOM(CONFIG);

        const gutter = new SplitGutter('horizontal');
        const textBefore = (gutter as any)._tooltipText;

        gutter.setMovable(false);
        expect((gutter as any)._tooltipText).toBe(textBefore);

        gutter.setMovable(true);
        expect((gutter as any)._tooltipText).toBe(textBefore);
    });
});
