import { describe, it, expect, afterEach } from 'vitest';
import { Dialog } from '~/overlay/Dialog';
import { LayerManager } from '~/core/LayerManager';
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
