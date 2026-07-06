import { describe, it, expect } from 'vitest';
import { positionAnchored, clampIntoViewport } from '~/core/OverlayPosition';
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

    it('clamps the cross axis into [margin, viewport - size - margin]', () => {
        const vp     = size(1000, 800);
        // anchor.left = 960 would push a 150-wide element past the right edge.
        const anchor = rect(960, 100, 990, 130);
        const el     = size(150, 100);

        const p = positionAnchored(anchor, el, vp, { axis: 'vertical', margin: 8 });

        // x clamped to viewport.width - size.width - margin = 1000 - 150 - 8 = 842.
        expect(p.x).toBe(842);
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

describe('clampIntoViewport', () => {
    it('returns a point already inside unchanged', () => {
        const vp = size(1000, 800);
        const p  = clampIntoViewport(120, 240, size(100, 50), vp);

        expect(p).toEqual({ x: 120, y: 240 });
    });

    it('never returns a coordinate below margin', () => {
        const vp = size(1000, 800);
        const p  = clampIntoViewport(-50, -20, size(100, 50), vp, 8);

        expect(p.x).toBe(8);
        expect(p.y).toBe(8);
    });

    it('never returns a coordinate past extent - size - margin', () => {
        const vp = size(1000, 800);
        const p  = clampIntoViewport(2000, 2000, size(100, 50), vp, 8);

        expect(p.x).toBe(1000 - 100 - 8);
        expect(p.y).toBe(800 - 50 - 8);
    });

    it('pins the top-left to margin when the element is larger than the viewport', () => {
        const vp = size(1000, 800);
        // Element taller than the viewport minus margins: the naive upper bound
        // (viewport - size - margin) falls below the margin. A raw clamp whose
        // min > max would return that negative bound and push the element
        // off-screen; the primitive must instead pin the top-left at the margin
        // (top-aligned) and let the caller's height-cap / scroll carry the
        // overflow — matching the bespoke Menu.show clamp it replaced.
        const p = clampIntoViewport(200, 500, size(100, 968), vp, 4);

        expect(p.y).toBe(4);
        expect(p.x).toBe(200);
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
