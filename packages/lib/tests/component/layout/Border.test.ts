import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Border } from '~/layout/Border';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Placement } from '~/primitive/Placement';
import { Size } from '~/primitive/Size';
import { COLLAPSE_STRIP_SIZE } from '~/layout/CollapseSupport';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

/**
 * A region whose preferred main-axis extent sits *below* its own merged min,
 * modelling a content-derived min the reported preferred is not clamped up to
 * (an explicit `setMinSize` would clamp the reported preferred, masking the
 * bug). Border only calls getPreferredSize / getMinSize / isDisplayed on a
 * region; the overrides cover those.
 */
class SubMinRegion extends Component {
    constructor(private readonly pref: Size, private readonly min: Size) {
        super({});
    }

    getPreferredSize(): Size { return this.pref; }
    getMinSize(): Size { return this.min; }
}

/** A `placement` constraint that also marks the region collapsible. */
function collapsiblePlacement(p: Placement): LayoutConstraints {
    return Object.assign(new LayoutConstraints(), { placement: p, collapsible: true });
}

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

describe('Border region min-floor (sub-minimum preferred)', () => {
    afterEach(() => DOM.reset());

    // The reserved band, not the region's own committed height, is the
    // observable: commitBounds -> clampHeight/Width already lifts the region's
    // own size to its min in both builds, so asserting on the region's height
    // is vacuous. CENTER's residual size shifts by the floor delta.

    it('NORTH reserves its min height when preferred is below min', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host = hostBorder(400, 300, border);
        const north = new SubMinRegion({ width: 50, height: 28 }, { width: 50, height: 30 });
        const center = new Component({ preferredSize: { width: 10, height: 10 } });

        host.addComponent(north, placement(Placement.NORTH));
        host.addComponent(center, placement(Placement.CENTER));

        const inner = host.getInnerSize()!;
        const spacing = border.getComponentSpacing();

        host.doLayout();

        // 30 (min) reserved, not 28 (raw preferred).
        expect(center.getHeight()).toBe(inner.height - 30 - spacing);
    });

    it('SOUTH reserves its min height when preferred is below min', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host = hostBorder(400, 300, border);
        const south = new SubMinRegion({ width: 50, height: 28 }, { width: 50, height: 30 });
        const center = new Component({ preferredSize: { width: 10, height: 10 } });

        host.addComponent(south, placement(Placement.SOUTH));
        host.addComponent(center, placement(Placement.CENTER));

        const inner = host.getInnerSize()!;
        const spacing = border.getComponentSpacing();

        host.doLayout();

        expect(center.getHeight()).toBe(inner.height - 30 - spacing);
    });

    it('WEST reserves its min width when preferred is below min', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host = hostBorder(400, 300, border);
        const west = new SubMinRegion({ width: 28, height: 50 }, { width: 30, height: 50 });
        const center = new Component({ preferredSize: { width: 10, height: 10 } });

        host.addComponent(west, placement(Placement.WEST));
        host.addComponent(center, placement(Placement.CENTER));

        const inner = host.getInnerSize()!;
        const spacing = border.getComponentSpacing();

        host.doLayout();

        expect(center.getWidth()).toBe(inner.width - 30 - spacing);
    });

    it('EAST reserves its min width when preferred is below min', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host = hostBorder(400, 300, border);
        const east = new SubMinRegion({ width: 28, height: 50 }, { width: 30, height: 50 });
        const center = new Component({ preferredSize: { width: 10, height: 10 } });

        host.addComponent(east, placement(Placement.EAST));
        host.addComponent(center, placement(Placement.CENTER));

        const inner = host.getInnerSize()!;
        const spacing = border.getComponentSpacing();

        host.doLayout();

        expect(center.getWidth()).toBe(inner.width - 30 - spacing);
    });

    it('leaves a region whose preferred already exceeds its min unchanged (floor is a no-op)', () => {
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

        expect(center.getHeight()).toBe(inner.height - 30 - spacing);
    });

    it('reports getPreferredSize floored so Border does not itself violate min <= preferred', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host = hostBorder(400, 300, border);
        const north = new SubMinRegion({ width: 50, height: 28 }, { width: 50, height: 30 });

        host.addComponent(north, placement(Placement.NORTH));

        // clearInsets => zero perimeter, so the region's own extent is the total.
        expect(border.getPreferredSize()!.height).toBe(30);
        expect(border.getPreferredSize()!.height).toBeGreaterThanOrEqual(border.getMinSize()!.height);
    });

    it('keeps a collapsed region at the collapse strip regardless of its min', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host = hostBorder(400, 300, border);
        const north = new SubMinRegion({ width: 50, height: 28 }, { width: 50, height: 30 });

        host.addComponent(north, collapsiblePlacement(Placement.NORTH));
        border.setRegionCollapsed(Placement.NORTH, true);

        expect(border.isRegionCollapsed(Placement.NORTH)).toBe(true);
        // The floor must not leak into the collapsed branch.
        expect(border.getPreferredSize()!.height).toBe(COLLAPSE_STRIP_SIZE);
    });
});

describe('Border middle-row height aggregation', () => {
    afterEach(() => DOM.reset());

    // WEST | CENTER | EAST sit side by side sharing one height band, so the
    // middle row's height contribution is the *tallest* region, not the sum —
    // matching getMaxSize's "the row height is the tallest region" and its
    // docstring. A `+=` of a Math.max over-reports the container height.

    it('reports the middle row preferred height as the tallest region, not the sum', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host = hostBorder(400, 300, border);
        const west = new Component({ preferredSize: { width: 40, height: 20 } });
        const center = new Component({ preferredSize: { width: 100, height: 50 } });

        host.addComponent(west, placement(Placement.WEST));
        host.addComponent(center, placement(Placement.CENTER));

        // max(20, 50) = 50, not 20 + 50 = 70. (clearInsets => zero perimeter.)
        expect(border.getPreferredSize()!.height).toBe(50);
    });

    it('reports the middle row min height as the tallest region min, not the sum', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host = hostBorder(400, 300, border);
        const west = new Component({ preferredSize: { width: 40, height: 20 } });
        west.setMinSize({ width: 40, height: 20 });
        const center = new Component({ preferredSize: { width: 100, height: 50 } });
        center.setMinSize({ width: 100, height: 50 });

        host.addComponent(west, placement(Placement.WEST));
        host.addComponent(center, placement(Placement.CENTER));

        expect(border.getMinSize()!.height).toBe(50);
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
        north.setMinSize({ width: 300, height: 30 }); // drives totalMin width
        const center = new Component({ preferredSize: { width: 50, height: 50 } });
        center.setMinSize({ width: 50, height: 10 });
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
