// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// `AbstractWindow.doLayout` placed the trailing resize strips from the wrong
// inset side: the east band's x folded in `insets.getLeft()` and the south
// band's y `insets.getTop()`, while the south strip took its height from
// `insets.getRight()`. All three agree with the correct value whenever the
// opposing insets happen to match, which every default window's uniform 4px
// inset does — so the defect is invisible until a window sets asymmetric
// insets, and then the eastern strips start past the padding box's right edge
// and `overflow: hidden` clips the grab band they were widened to provide.
//
// The asymmetric case below is what pins the placement; the uniform case is
// the no-op proof that the correction changes nothing for a default window.
//
// Both cases hardcode `Window`'s defaults — 400 x 300 with a 1px border on
// every side — because the expected rectangles are derived from them: the
// padding box a strip is positioned against is 398 x 298, so the far edge
// sits `border.left + border.right` in from the outer edge and the trailing
// band starts its own inset before that. A change to either default moves the
// whole table.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { Insets } from '~/primitive/Insets';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

type Rect = { x: number; y: number; width: number; height: number };

/** White-box access to the eight private border strips, keyed by compass name. */
function strips(win: Window): Record<string, { getX(): number; getY(): number; getWidth(): number; getHeight(): number }> {
    return (win as unknown as {
        _borderComponents: Record<string, { getX(): number; getY(): number; getWidth(): number; getHeight(): number }>;
    })._borderComponents;
}

/** Every strip's committed rectangle, in the order the expectation tables list them. */
function stripRects(win: Window): Record<string, Rect> {
    const all    = strips(win);
    const result: Record<string, Rect> = {};

    for (const name of ['northwest', 'north', 'northeast', 'west', 'east', 'southwest', 'south', 'southeast']) {
        const strip = all[name];

        result[name] = { x: strip.getX(), y: strip.getY(), width: strip.getWidth(), height: strip.getHeight() };
    }

    return result;
}

describe('AbstractWindow resize-strip placement', () => {
    beforeEach(() => {
        installTestDOM(CONFIG);

        // `show()` starts the scale-in animation; offline there is no driven
        // frame loop to advance or retire it. Mirrors the convention in
        // AbstractWindow.maximizeRestoreViewportClamp.test.ts.
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation(() => 0);
        vi.spyOn(globalThis, 'setTimeout').mockImplementation(((): number => 0) as typeof setTimeout);
        vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} });
    });

    afterEach(() => {
        (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
        vi.restoreAllMocks();
        DOM.reset();
    });

    it('takes each trailing band from its own inset when the insets are asymmetric', () => {
        // CSS order: top 2, right 8, bottom 6, left 4.
        const win = new Window('W', { insets: new Insets(2, 8, 6, 4) });

        win.show();

        expect(win.getBorderSize()).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });
        expect(stripRects(win)).toEqual({
            northwest: { x:   0, y:   0, width:   4, height:   2 },
            north:     { x:   4, y:   0, width: 386, height:   2 },
            northeast: { x: 390, y:   0, width:   8, height:   2 },
            west:      { x:   0, y:   2, width:   4, height: 290 },
            east:      { x: 390, y:   2, width:   8, height: 290 },
            southwest: { x:   0, y: 292, width:   4, height:   6 },
            south:     { x:   4, y: 292, width: 386, height:   6 },
            southeast: { x: 390, y: 292, width:   8, height:   6 },
        });
    });

    it('leaves a window with the default uniform insets exactly where it was', () => {
        const win = new Window('W');

        win.show();

        const insets = win.getInsets();

        expect([insets.getTop(), insets.getRight(), insets.getBottom(), insets.getLeft()]).toEqual([4, 4, 4, 4]);
        expect(stripRects(win)).toEqual({
            northwest: { x:   0, y:   0, width:   4, height:   4 },
            north:     { x:   4, y:   0, width: 390, height:   4 },
            northeast: { x: 394, y:   0, width:   4, height:   4 },
            west:      { x:   0, y:   4, width:   4, height: 290 },
            east:      { x: 394, y:   4, width:   4, height: 290 },
            southwest: { x:   0, y: 294, width:   4, height:   4 },
            south:     { x:   4, y: 294, width: 390, height:   4 },
            southeast: { x: 394, y: 294, width:   4, height:   4 },
        });
    });
});
