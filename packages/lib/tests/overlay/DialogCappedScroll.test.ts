//
// Coverage for a Dialog whose content is taller than the viewport allows.
//
// `resizeToContent` caps the dialog at `viewport - 2*margin`. For that cap to
// take, the dialog must not floor itself to its content's min-size
// (`clampsToContentSize` is overridden to false), and the content area must be a
// scroll region that shrinks to the capped budget — a Panel with
// `autoScroll: "y"`, whose `clampsToContentSize` is already false — rather than a
// bare Component that floors to its content height and lets the clip frame clip
// the overflow.
//
// Own file so the module-level layout queue starts clean (see
// DialogWrappingRefit.test.ts for why the offline rAF makes that necessary).
//
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Dialog } from '~/overlay/Dialog';
import { _Panel as Panel } from '~/core/Panel';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

// Mirrored from Dialog's private layout constants.
const DIALOG_VIEWPORT_MARGIN = 24;

// A short viewport so a tall dialog is forced to cap. Content height (500) far
// exceeds the room a 300px-tall viewport leaves (TITLE + 500 + BUTTON = 588).
const VIEWPORT_HEIGHT = 300;
const CONTENT_HEIGHT  = 500;

// The height a capped dialog settles at: the viewport minus its top and bottom
// margins.
const CAPPED_HEIGHT = VIEWPORT_HEIGHT - DIALOG_VIEWPORT_MARGIN * 2;

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: VIEWPORT_HEIGHT },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('Dialog scrolls content capped by a short viewport', () => {
    let frames: Array<FrameRequestCallback>;

    beforeEach(() => {
        installTestDOM(CONFIG);
        frames = [];
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            frames.push(cb);

            return frames.length;
        });
    });

    afterEach(() => { flushFrame(); vi.restoreAllMocks(); DOM.reset(); });

    /** Runs every captured frame callback (a layout flush + its post-layout hooks). */
    function flushFrame(): void {
        const pending = frames;
        frames = [];
        for (const cb of pending) {
            cb(0);
        }
    }

    /** Content taller than the capped dialog can show, so the dialog must scroll it. */
    function tallDialog(): Dialog {
        const content = new Component();
        content.setPreferredSize({ width: 200, height: CONTENT_HEIGHT });
        content.setMinSize({ width: 200, height: CONTENT_HEIGHT });

        return new Dialog({ title: 'T', contentComponent: content, width: 360 });
    }

    it('caps to the viewport instead of flooring to its content height', () => {
        const dialog = tallDialog();

        void dialog.show();
        flushFrame();

        // A bare-Component dialog floored to its content min (CONTENT_HEIGHT) and
        // could not shrink; the capped dialog fits the viewport allowance.
        expect(dialog.getHeight()).toBe(CAPPED_HEIGHT);
        expect(dialog.getHeight()).toBeLessThan(CONTENT_HEIGHT);
    });

    it('makes the content container a vertical auto-scroll Panel', () => {
        const dialog = tallDialog();

        void dialog.show();
        flushFrame();

        const container = dialog.getContentComponent();

        expect(container).toBeInstanceOf(Panel);
        expect((container as Panel).getAutoScroll()).toBe('y');
    });
});
