import { describe, it, expect } from 'vitest';
import { positionAnchored, positionAligned, positionFlexibleAnchored } from '~/core/OverlayPosition';
import type { Rect } from '~/core/DOM';
import type { Size } from '~/primitive/Size';

/** Builds a full Rect from its four edges (width/height derived). */
function rect(left: number, top: number, right: number, bottom: number): Rect {
    return {
        x:      left,
        y:      top,
        left,
        top,
        right,
        bottom,
        width:  right - left,
        height: bottom - top,
    };
}

const size = (width: number, height: number): Size => ({ width, height });

describe('positionAnchored — vertical axis', () => {
    it('grows below the anchor when there is room, placing the top at anchor.bottom + gap', () => {
        const vp     = size(1000, 800);
        const anchor = rect(100, 100, 300, 130); // bottom = 130
        const el     = size(150, 200);

        const p = positionAnchored(anchor, el, vp, { axis: 'vertical', gap: 4 });

        // Fits below: top = bottom + gap.
        expect(p.y).toBe(130 + 4);
        // Cross axis aligns to the anchor's left edge (fits, so unclamped).
        expect(p.x).toBe(100);
    });

    it('flips above the anchor when the far side lacks room but the near side has it', () => {
        const vp     = size(1000, 800);
        // Anchor near the bottom: room below = 800 - 790 = 10; room above = 100.
        const anchor = rect(100, 100, 300, 790);
        const el     = size(150, 60);

        const p = positionAnchored(anchor, el, vp, { axis: 'vertical', gap: 4 });

        // Does not fit below (60 > 800-790-4=6) but fits above: top = anchor.top - height - gap.
        expect(p.y).toBe(100 - 60 - 4);
    });

    it('saturates on-screen when neither side fits and below has more room', () => {
        const vp     = size(1000, 400);
        // anchor.top = 180, anchor.bottom = 220. spaceFar = 400-220 = 180; spaceNear = 180. tie -> far wins.
        const anchor = rect(100, 180, 300, 220);
        const el     = size(150, 500); // taller than viewport

        const p = positionAnchored(anchor, el, vp, { axis: 'vertical' });

        // Pinned to the bottom, never negative overflow.
        expect(p.y).toBe(Math.max(0, 400 - 500));
        expect(p.y).toBe(0);
    });

    it('pins to the top when neither side fits and above has more room', () => {
        const vp     = size(1000, 400);
        // anchor.bottom = 380 => spaceFar = 20; anchor.top = 300 => spaceNear = 300. near has more.
        const anchor = rect(100, 300, 300, 380);
        const el     = size(150, 500);

        const p = positionAnchored(anchor, el, vp, { axis: 'vertical' });

        expect(p.y).toBe(0);
    });

    it('right-aligns the cross axis to the anchor when the near alignment overflows', () => {
        const vp     = size(1000, 800);
        // anchor.left = 960 would push a 150-wide element past the right edge.
        const anchor = rect(960, 100, 990, 130);
        const el     = size(150, 100);

        const p = positionAnchored(anchor, el, vp, { axis: 'vertical', margin: 8 });

        // x right-aligns to the anchor's right edge (990 − 150 = 840), rather
        // than being pushed to the margin bound at 842.
        expect(p.x).toBe(840);
    });
});

describe('positionAnchored — horizontal axis', () => {
    it('grows right of the anchor when there is room, placing the left at anchor.right + gap', () => {
        const vp     = size(1000, 800);
        const anchor = rect(100, 100, 300, 130); // right = 300
        const el     = size(200, 150);

        const p = positionAnchored(anchor, el, vp, { axis: 'horizontal', gap: 6 });

        expect(p.x).toBe(300 + 6);
        // Cross axis aligns to the anchor's top edge.
        expect(p.y).toBe(100);
    });

    it('flips left when the right side lacks room but the left side has it', () => {
        const vp     = size(1000, 800);
        // anchor.right = 980; room right = 20; room left = 800.
        const anchor = rect(800, 100, 980, 130);
        const el     = size(200, 150);

        const p = positionAnchored(anchor, el, vp, { axis: 'horizontal', gap: 6 });

        // left = anchor.left - width - gap.
        expect(p.x).toBe(800 - 200 - 6);
    });

    it('clamps the cross axis into the viewport', () => {
        const vp     = size(1000, 400);
        const anchor = rect(100, 380, 300, 400); // top near bottom
        const el     = size(200, 150);

        const p = positionAnchored(anchor, el, vp, { axis: 'horizontal', margin: 4 });

        // y clamped to viewport.height - size.height - margin = 400 - 150 - 4 = 246.
        expect(p.y).toBe(246);
    });

    it('pins the cross axis to margin when the element is wider than the viewport', () => {
        const vp     = size(300, 800);
        const anchor = rect(100, 100, 260, 130);
        const el     = size(400, 100); // wider than the viewport

        const p = positionAnchored(anchor, el, vp, { axis: 'vertical', margin: 4 });

        // Cross-axis upper bound is below the margin; pin to margin, not negative.
        expect(p.x).toBe(4);
    });
});

describe('positionAligned', () => {
    const viewportExtent = 1280;
    const extent          = 120;

    it('fits-far: the near alignment fits, so the near edges align', () => {
        const p = positionAligned(200, 300, extent, viewportExtent, 4);

        expect(p).toBe(200);
    });

    it('flips: the near alignment overflows but the far alignment fits, so the far edges align', () => {
        // Right edges flush at 1270 — report 1's fix.
        const p = positionAligned(1200, 1270, extent, viewportExtent, 4);

        expect(p).toBe(1150);
    });

    it('fits-neither: the anchor\'s far edge is off-viewport, so it clamps at viewport - extent - margin', () => {
        const p = positionAligned(1270, 1290, extent, viewportExtent, 4);

        expect(p).toBe(1156);
    });

    it('fits-neither: the near alignment violates the margin guard, so it clamps to the margin', () => {
        const p = positionAligned(0, 100, extent, viewportExtent, 4);

        expect(p).toBe(4);
    });

    it('fits-neither: the element is wider than the viewport, so it clamps to the margin', () => {
        const p = positionAligned(200, 300, 1400, viewportExtent, 4);

        expect(p).toBe(4);
    });

    it('zero-size anchor with room to the right: grows right from the point', () => {
        const p = positionAligned(500, 500, extent, viewportExtent, 4);

        expect(p).toBe(500);
    });

    it('zero-size anchor at the right edge: the far edge lands on the cursor (report 3)', () => {
        const p = positionAligned(1270, 1270, extent, viewportExtent, 4);

        expect(p).toBe(1150);
    });

    it('the flip is margin-independent', () => {
        const p = positionAligned(1200, 1270, extent, viewportExtent, 0);

        expect(p).toBe(1150);
    });

    it('always lands within [margin, viewportExtent - extent - margin] for an in-viewport anchor', () => {
        const margin = 4;

        for (const near of [0, 100, 500, 1000, 1200, 1279]) {
            const far = Math.min(viewportExtent, near + 30);
            const p   = positionAligned(near, far, extent, viewportExtent, margin);

            expect(p).toBeGreaterThanOrEqual(margin);
            expect(p).toBeLessThanOrEqual(Math.max(margin, viewportExtent - extent - margin));
        }
    });
});

describe('positionAnchored — placeAnchored regression', () => {
    // The pre-refactor AnimatedDropdown.placeAnchored vertical formula, inlined so
    // the shared primitive is pinned against the exact geometry it replaced.
    function legacyPlaceAnchored(anchor: Rect, w: number, h: number, vpW: number, vpH: number): { x: number; y: number } {
        let y: number;
        const spaceBelow = vpH - anchor.bottom;
        const spaceAbove = anchor.top;

        if (h <= spaceBelow) {
            y = anchor.bottom;
        } else if (h <= spaceAbove) {
            y = anchor.top - h;
        } else if (spaceBelow >= spaceAbove) {
            y = Math.max(0, vpH - h);
        } else {
            y = 0;
        }

        const x = Math.max(0, Math.min(anchor.left, vpW - w));

        return { x, y };
    }

    it('matches the legacy formula for a representative below-fitting anchor', () => {
        const vp     = size(1280, 800);
        const anchor = rect(200, 150, 360, 180);
        const el     = size(180, 240);

        const shared = positionAnchored(anchor, el, vp, { axis: 'vertical' });
        const legacy = legacyPlaceAnchored(anchor, el.width, el.height, vp.width, vp.height);

        expect(shared).toEqual(legacy);
    });

    it('matches the legacy formula for a flip-above anchor', () => {
        const vp     = size(1280, 800);
        const anchor = rect(200, 600, 360, 770);
        const el     = size(180, 300);

        const shared = positionAnchored(anchor, el, vp, { axis: 'vertical' });
        const legacy = legacyPlaceAnchored(anchor, el.width, el.height, vp.width, vp.height);

        expect(shared).toEqual(legacy);
    });
});

describe('positionFlexibleAnchored', () => {
    const viewportExtent = 800;
    const viewportMargin = 4;

    it('fits below: grows from farEdge with the room below as available', () => {
        // roomFar = 800 - 100 - 4 = 696.
        const p = positionFlexibleAnchored(90, 100, 200, viewportExtent, viewportMargin);

        expect(p).toEqual({ start: 100, available: 696 });
    });

    it('overflows below, above roomier, and fits above: flips so the bottom meets nearEdge', () => {
        // roomFar = 800 - 760 - 4 = 36; roomNear = 700 - 4 = 696. 300 > 36, roomFar < roomNear => flips.
        const p = positionFlexibleAnchored(700, 760, 300, viewportExtent, viewportMargin);

        expect(p).toEqual({ start: 400, available: 696 });
    });

    it('overflows both sides, above roomier: flips and clamps to the margin', () => {
        // roomFar = 36; roomNear = 696. 900 > both => flips, clamps to the margin.
        const p = positionFlexibleAnchored(700, 760, 900, viewportExtent, viewportMargin);

        expect(p).toEqual({ start: 4, available: 696 });
    });

    it('tie (roomFar >= roomNear) with overflow: stays below despite overflowing', () => {
        // roomFar = 800 - 400 - 4 = 396; roomNear = 400 - 4 = 396. Tie => stays below.
        const p = positionFlexibleAnchored(400, 400, 1000, viewportExtent, viewportMargin);

        expect(p).toEqual({ start: 400, available: 396 });
    });

    it('never flips off-screen when the anchor sits at the viewport top (roomNear negative)', () => {
        // roomFar = 800 - 30 - 4 = 766; fits => stays below regardless of roomNear.
        const p = positionFlexibleAnchored(0, 30, 200, viewportExtent, viewportMargin);

        expect(p).toEqual({ start: 30, available: 766 });
    });

    it('handles the same near/far edge (submenu case)', () => {
        // roomFar = 800 - 500 - 4 = 296; fits => stays below.
        const p = positionFlexibleAnchored(500, 500, 100, viewportExtent, viewportMargin);

        expect(p).toEqual({ start: 500, available: 296 });
    });

    it('the flip branch never returns a start below viewportMargin', () => {
        // roomFar = 800 - 780 - 4 = 16; roomNear = 760 - 4 = 756. extent (900)
        // overflows roomFar and roomFar < roomNear => flips; even though extent
        // vastly exceeds roomNear too, start clamps to nearEdge - roomNear = margin.
        const p = positionFlexibleAnchored(760, 780, 900, viewportExtent, viewportMargin);

        expect(p.start).toBeGreaterThanOrEqual(viewportMargin);
        expect(p).toEqual({ start: viewportMargin, available: 756 });
    });
});
