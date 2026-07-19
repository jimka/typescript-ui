//
// SpinButton tick-listener coverage. emit is protected and the
// non-DOM `tick` event routes through the framework ListenerBag (no event
// loop), so it can be exercised on a bare (unmounted) button via an `any` cast
// confined to this file. Hold-repeat setTimeout cadence is a Non-Goal.
import { describe, it, expect } from 'vitest';
import { SpinButton } from '~/component/input/SpinButton';

describe('SpinButton tick listeners', () => {
    it('fires a registered tick listener on emit and stops after off', () => {
        const btn = new SpinButton('▲');

        let ticks = 0;
        const listener = (): void => {
            ticks += 1;
        };

        btn.on('tick', listener);
        // emit is protected; cast to drive the same fan-out the hold-repeat
        // schedule uses.
        (btn as any).emit('tick');
        expect(ticks).toBe(1);

        btn.off('tick', listener);
        (btn as any).emit('tick');
        expect(ticks).toBe(1);
    });
});

describe('SpinButton glyph-by-symbol sizing', () => {
    it('computes a stable half-height preferred size for both arrow symbols', () => {
        const up   = new SpinButton('▲');
        const down = new SpinButton('▼');

        const upSize   = up.getPreferredSize();
        const downSize = down.getPreferredSize();

        expect(upSize).not.toBe(null);
        expect(downSize).not.toBe(null);

        // updateSize fixes the width at 18 and derives a positive half-height
        // from the line box; both symbols share the same computed size.
        expect(upSize!.width).toBe(18);
        expect(upSize!.height).toBeGreaterThan(0);
        expect(downSize!.width).toBe(upSize!.width);
        expect(downSize!.height).toBe(upSize!.height);
    });
});
