import { describe, it, expect, afterEach } from 'vitest';
import { Dialog } from '~/overlay/Dialog';
import { LayerManager } from '~/core/LayerManager';
import { DOM } from '~/core/DOM';
import { Component } from '~/core/Component';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

// Mirrored from Dialog's private layout constants — the fixed title/button rows
// framing the content area, and the margin a content-resized dialog keeps from
// the viewport edges.
const TITLE_HEIGHT           = 36;
const BUTTON_HEIGHT          = 52;
const DIALOG_VIEWPORT_MARGIN = 24;

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('Dialog (LayerManager integration getters)', () => {
    afterEach(() => DOM.reset());

    it('getDismissMode() is "modal"', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M' });

        expect(dialog.getDismissMode()).toBe('modal');
    });

    it('getBand() is the Dialog band', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M' });

        expect(dialog.getBand()).toBe(LayerManager.Band.Dialog);
    });

    it('getLayerElement() is null before the dialog is shown', () => {
        installTestDOM(CONFIG);

        // Construction does not render the root element (no getElement(true)).
        const dialog = new Dialog({ title: 'T', message: 'M' });

        expect(dialog.getLayerElement()).toBeNull();
    });

    it('exposes the content container and title bar', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'Hello', message: 'M' });

        expect(dialog.getContentComponent()).toBeDefined();
        expect(dialog.getTitleBar()).toBeDefined();
    });
});

describe('Dialog — resizeToContent', () => {
    afterEach(() => DOM.reset());

    /** A rendered dialog over a preferred-sized content component. */
    function renderedDialog(content: Component): Dialog {
        const dialog = new Dialog({ title: 'T', contentComponent: content });

        // Force-render so resizeToContent has an element to re-fit and centre.
        dialog.getElement(true);

        return dialog;
    }

    it('is a no-op before the dialog is shown (no element)', () => {
        installTestDOM(CONFIG);

        const content = new Component();
        content.setPreferredSize(400, 200);
        const dialog = new Dialog({ title: 'T', contentComponent: content });
        const before = dialog.getHeight();

        content.setPreferredSize(400, 600);
        dialog.resizeToContent();

        expect(dialog.getHeight()).toBe(before);
    });

    it('grows the dialog height to match taller content', () => {
        installTestDOM(CONFIG);

        const content = new Component();
        content.setPreferredSize(400, 200);
        const dialog = renderedDialog(content);

        content.setPreferredSize(400, 500);
        dialog.resizeToContent();

        expect(dialog.getHeight()).toBe(TITLE_HEIGHT + 500 + BUTTON_HEIGHT);
    });

    it('shrinks the dialog height to match smaller content', () => {
        installTestDOM(CONFIG);

        const content = new Component();
        content.setPreferredSize(400, 500);
        const dialog = renderedDialog(content);

        content.setPreferredSize(400, 120);
        dialog.resizeToContent();

        expect(dialog.getHeight()).toBe(TITLE_HEIGHT + 120 + BUTTON_HEIGHT);
    });

    it('caps the height so the dialog keeps a margin from the viewport edges', () => {
        installTestDOM(CONFIG);

        const content = new Component();
        content.setPreferredSize(400, 200);
        const dialog = renderedDialog(content);

        content.setPreferredSize(400, 5000);
        dialog.resizeToContent();

        // Viewport 800 tall, minus a margin top and bottom.
        expect(dialog.getHeight()).toBe(CONFIG.viewport.height - DIALOG_VIEWPORT_MARGIN * 2);
    });
});
