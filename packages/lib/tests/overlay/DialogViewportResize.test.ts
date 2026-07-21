//
// Coverage for a Dialog re-fitting when the viewport is resized while it is
// open: it grows back toward its content when the viewport gains room and caps
// (so the content scrolls) when the viewport shrinks below the content, instead
// of keeping its opened height and overflowing the viewport.
//
// Own file so the module-level layout queue starts clean (see
// DialogWrappingRefit.test.ts for why the offline rAF makes that necessary).
//
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { _Dialog as Dialog } from '~/overlay/Dialog';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

// Mirrored from Dialog's private layout constants.
const TITLE_HEIGHT           = 36;
const BUTTON_HEIGHT          = 52;
const DIALOG_VIEWPORT_MARGIN = 24;

const CONTENT_HEIGHT = 500;
const TALL_VIEWPORT  = 800;
const SHORT_VIEWPORT = 300;

// The height a dialog with CONTENT_HEIGHT content wants when uncapped, and the
// height it settles at once a short viewport caps it.
const FULL_HEIGHT   = TITLE_HEIGHT + CONTENT_HEIGHT + BUTTON_HEIGHT;
const CAPPED_HEIGHT = SHORT_VIEWPORT - DIALOG_VIEWPORT_MARGIN * 2;

describe('Dialog re-fits to a viewport resized while open', () => {
    // A mutable config: `getViewportSize()` reads it by reference, so changing
    // `config.viewport` and invoking the resize handler models a live resize.
    let config: ReturnType<typeof makeConfig>;
    let frames: Array<FrameRequestCallback>;

    function makeConfig(height: number) {
        return {
            rootMountOffset: { x: 0, y: 0 },
            viewport:        { width: 1280, height },
            scrollBarWidth:  15,
            fontMetrics,
            themeVars:       {},
        };
    }

    beforeEach(() => {
        config = makeConfig(TALL_VIEWPORT);
        installTestDOM(config);
        frames = [];
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            frames.push(cb);

            return frames.length;
        });
    });

    afterEach(() => { flushFrame(); vi.restoreAllMocks(); DOM.reset(); });

    function flushFrame(): void {
        // Drain to a fixpoint: a flushed layout pass can schedule a follow-up
        // frame (reserving a scrollbar gutter reschedules so children re-flow),
        // and running only the first batch would leave the module-level rAF
        // handle set — leaking into the next test, which then can't schedule its
        // own flush. Mirrors the real rAF loop, which runs every pending frame.
        let guard = 0;
        while (frames.length > 0 && guard++ < 50) {
            const pending = frames;
            frames = [];
            for (const cb of pending) {
                cb(0);
            }
        }
    }

    function tallContentDialog(): Dialog {
        const content = new Component();
        content.setPreferredSize({ width: 200, height: CONTENT_HEIGHT });
        content.setMinSize({ width: 200, height: CONTENT_HEIGHT });

        return new Dialog({ title: 'T', contentComponent: content, width: 360 });
    }

    /** Models a live viewport resize: change the size, then run the resize handler. */
    function resizeViewport(dialog: Dialog, height: number): void {
        config.viewport.height = height;
        (dialog as unknown as { onViewportResize(): void }).onViewportResize();
    }

    it('caps to the viewport when it shrinks below the content', () => {
        const dialog = tallContentDialog();
        void dialog.show();
        flushFrame();

        // Opened on a tall viewport: grows to its full content, no cap.
        expect(dialog.getHeight()).toBe(FULL_HEIGHT);

        resizeViewport(dialog, SHORT_VIEWPORT);

        // Shrinking the viewport caps the dialog to the viewport allowance so it
        // scrolls, rather than keeping FULL_HEIGHT and overflowing.
        expect(dialog.getHeight()).toBe(CAPPED_HEIGHT);
        expect(dialog.getHeight()).toBeLessThan(FULL_HEIGHT);
    });

    it('grows back toward the content when the viewport regains room', () => {
        // Open on a short viewport (mutate before show; re-installing here would
        // drop the rAF spy the flush relies on).
        config.viewport.height = SHORT_VIEWPORT;

        const dialog = tallContentDialog();
        void dialog.show();
        flushFrame();

        // Opened on a short viewport: capped.
        expect(dialog.getHeight()).toBe(CAPPED_HEIGHT);

        resizeViewport(dialog, TALL_VIEWPORT);

        // Regained room: grows back to its full content height.
        expect(dialog.getHeight()).toBe(FULL_HEIGHT);
    });
});
