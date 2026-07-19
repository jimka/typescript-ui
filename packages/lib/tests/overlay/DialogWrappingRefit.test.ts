//
// End-to-end coverage for a Dialog sizing to wrapping content.
//
// A Dialog's height is derived at construction, before its content is laid out,
// so wrapping Text reports a single-line height then. Once the first layout
// sizes the content at the dialog width the Text re-measures to its wrapped
// height (intrinsic sizing), and the Dialog's afterNextLayout re-fit grows the
// box to match. This drives the layout flush to prove the box actually grows —
// the check the height-only assertion of the earlier approach missed.
//
// Lives in its own file so the module-level layout queue starts clean: the
// offline requestAnimationFrame returns 0, so a sibling test that scheduled a
// layout without flushing would leave rafHandle stuck and starve this flush.
//
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Dialog } from '~/overlay/Dialog';
import { DOM } from '~/core/DOM';
import { Container } from '~/core/Container';
import { VBox } from '~/layout/VBox';
import { Text } from '~/component/input/Text';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Mirrored from Dialog's private layout constants.
const TITLE_HEIGHT  = 36;
const BUTTON_HEIGHT = 52;

describe('Dialog re-fits to wrapping content', () => {
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

    it('grows the dialog height once its wrapping content settles at the dialog width', () => {
        // A run far wider than the dialog, so it wraps to several lines once laid
        // out at the dialog width.
        const content = new Container({ layoutManager: new VBox({ stretching: true, spacing: 0 }) });
        const line    = new Text('word '.repeat(120).trim());
        line.setWhiteSpace('normal');
        content.addComponent(line);

        const dialog = new Dialog({ title: 'T', contentComponent: content, width: 360 });

        void dialog.show();
        const openedHeight = dialog.getHeight();   // sized from single-line content

        // Drive the flush: the content lays out at the dialog width (the Text
        // re-measures to its wrapped height), then the Dialog's afterNextLayout
        // re-fit reads the settled height and grows the box.
        flushFrame();

        expect(dialog.getHeight()).toBeGreaterThan(openedHeight);
        expect(dialog.getHeight()).toBe(TITLE_HEIGHT + content.getPreferredSize()!.height + BUTTON_HEIGHT);
    });
});
