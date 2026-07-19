import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Border } from '~/layout/Border';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Placement } from '~/primitive/Placement';
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

function placement(p: Placement): LayoutConstraints {
    return Object.assign(new LayoutConstraints(), { placement: p });
}

function hostBorder(width: number, height: number, border: Border): Container {
    const host = new Container({ layoutManager: border });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('Border setters/getters and collapse state', () => {
    it('round-trips componentSpacing', () => {
        const border = new Border();

        border.setComponentSpacing(12);

        expect(border.getComponentSpacing()).toBe(12);
    });

    it('CENTER is never collapsible and rejects a collapse request', () => {
        const border = new Border();

        expect(border.isRegionCollapsible(Placement.CENTER)).toBe(false);

        border.setRegionCollapsed(Placement.CENTER, true);

        expect(border.isRegionCollapsed(Placement.CENTER)).toBe(false);
    });

    it('a non-collapsible edge region rejects a collapse request', () => {
        const border = new Border();
        const north = new Component({ preferredSize: { width: 10, height: 20 } });

        // Add as NORTH without collapsible:true => non-collapsible by default.
        new Container({ layoutManager: border }).addComponent(north, placement(Placement.NORTH));

        expect(border.isRegionCollapsible(Placement.NORTH)).toBe(false);

        border.setRegionCollapsed(Placement.NORTH, true);

        expect(border.isRegionCollapsed(Placement.NORTH)).toBe(false);
    });

    it('defaults an unplaced/blank-placement child to CENTER', () => {
        const border = new Border();
        const host = new Container({ layoutManager: border });
        const child = new Component({ preferredSize: { width: 10, height: 10 } });

        host.addComponent(child); // no constraints

        // Resolved to CENTER (never collapsible).
        expect(border.isRegionCollapsible(Placement.CENTER)).toBe(false);
    });
});

describe('Border docking geometry (cross-axis span + edge reservation)', () => {
    afterEach(() => DOM.reset());

    it('NORTH spans the full content width at its preferred height', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host = hostBorder(400, 300, border);
        const north = new Component({ preferredSize: { width: 50, height: 30 } });

        host.addComponent(north, placement(Placement.NORTH));

        const inner = host.getInnerSize()!;

        host.doLayout();

        // Full-span cross axis is the contract that survives the stubbed zeros.
        expect(north.getWidth()).toBe(inner.width);
        expect(north.getHeight()).toBe(30); // preferred height reserved
    });

    it('WEST spans the full content height at its preferred width', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host = hostBorder(400, 300, border);
        const west = new Component({ preferredSize: { width: 40, height: 20 } });

        host.addComponent(west, placement(Placement.WEST));

        const inner = host.getInnerSize()!;

        host.doLayout();

        expect(west.getWidth()).toBe(40); // preferred width reserved
        expect(west.getHeight()).toBe(inner.height); // full content height
    });

    it('CENTER fills the residual rectangle between the docked NORTH band and the edges', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host = hostBorder(400, 300, border);
        const north = new Component({ preferredSize: { width: 50, height: 30 } });
        const center = new Component({ preferredSize: { width: 10, height: 10 } });

        host.addComponent(north, placement(Placement.NORTH));
        host.addComponent(center, placement(Placement.CENTER));

        const inner = host.getInnerSize()!;
        const spacing = border.getComponentSpacing();

        host.doLayout();

        // Center keeps full width and gets the height below the north band+spacing.
        expect(center.getWidth()).toBe(inner.width);
        expect(center.getHeight()).toBe(inner.height - 30 - spacing);
    });
});

describe('Border overflow inflation', () => {
    afterEach(() => DOM.reset());

    // North spans the full row and carries a wide min, driving
    // computeTotalMinSize's width (which honours the wider of north/south)
    // past the narrow host; center carries a small min so the observed width
    // reflects the manager's inflation, not a self-clamp.
    function hostWithWideNorth(): { border: Border; center: Component } {
        installTestDOM(CONFIG);
        const border = new Border();
        const host = hostBorder(100, 300, border); // narrow host
        const north = new Component({ preferredSize: { width: 50, height: 30 } });
        north.setMinSize(300, 30); // drives totalMin width
        const center = new Component({ preferredSize: { width: 50, height: 50 } });
        center.setMinSize(50, 10);
        host.addComponent(north, placement(Placement.NORTH));
        host.addComponent(center, placement(Placement.CENTER));
        return { border, center };
    }

    it('inflates the working width to the total min width when the host marks X overflowing', () => {
        const { border, center } = hostWithWideNorth();
        border.setOverflowing(true, false);
        border.getContainer()!.doLayout();
        expect(center.getWidth()).toBe(300); // inflated to totalMin width (from the wide north)
    });

    it('does not inflate — center fills the container width — when X overflow is off', () => {
        const { border, center } = hostWithWideNorth();
        border.setOverflowing(false, false);
        border.getContainer()!.doLayout();
        expect(center.getWidth()).toBe(100); // container width, not the 300 totalMin
    });
});
