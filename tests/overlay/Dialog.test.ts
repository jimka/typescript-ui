import { describe, it, expect, afterEach, vi } from 'vitest';
import { _Dialog as Dialog, DialogButtons } from '~/overlay/Dialog';
import { LayerManager } from '~/core/LayerManager';
import { DOM } from '~/core/DOM';
import { Component } from '~/core/Component';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

// White-box seam: widen the private Enter-confirm helpers so the primary-result
// decision and the focus-guard can be exercised without a rendered DOM (the
// end-to-end focus / keydown path needs querySelectorAll, which the offline DOM
// stubs to []).
class TestDialog extends Dialog {
    public primary(): string | null {
        return (this as any).primaryResult();
    }

    public enter(e: KeyboardEvent): void {
        (this as any).onEnter(e);
    }
}

function enterEvent(): { event: KeyboardEvent; prevented: () => boolean } {
    let defaultPrevented = false;
    const event = { key: 'Enter', preventDefault: () => { defaultPrevented = true; } } as unknown as KeyboardEvent;

    return { event, prevented: () => defaultPrevented };
}

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

describe('Dialog — Enter confirms the primary button', () => {
    afterEach(() => DOM.reset());

    it('primaryResult() resolves the primary button (default Ok → confirm)', () => {
        installTestDOM(CONFIG);

        const dialog = new TestDialog({ title: 'T', message: 'M' });

        expect(dialog.primary()).toBe('confirm');
    });

    it('primaryResult() follows which button is marked primary', () => {
        installTestDOM(CONFIG);

        const dialog = new TestDialog({
            title:   'T',
            message: 'M',
            buttons: [{ ...DialogButtons.Cancel, primary: true }, DialogButtons.Confirm],
        });

        expect(dialog.primary()).toBe('cancel');
    });

    it('primaryResult() is null when no button is primary', () => {
        installTestDOM(CONFIG);

        const dialog = new TestDialog({
            title:   'T',
            message: 'M',
            buttons: [DialogButtons.Cancel, DialogButtons.Confirm],
        });

        expect(dialog.primary()).toBeNull();
    });

    it('Enter hides with the primary result when focus is not on a button/field', () => {
        installTestDOM(CONFIG);

        const dialog = new TestDialog({ title: 'T', message: 'M' });
        const hide = vi.spyOn(dialog, 'hide').mockReturnValue(dialog);
        const { event, prevented } = enterEvent();

        dialog.enter(event);

        expect(prevented()).toBe(true);
        expect(hide).toHaveBeenCalledWith('confirm');
    });

    it('Enter is inert when no button is primary (no blind submit)', () => {
        installTestDOM(CONFIG);

        const dialog = new TestDialog({
            title:   'T',
            message: 'M',
            buttons: [DialogButtons.Cancel, DialogButtons.Confirm],
        });
        const hide = vi.spyOn(dialog, 'hide').mockReturnValue(dialog);
        const { event, prevented } = enterEvent();

        dialog.enter(event);

        expect(prevented()).toBe(false);
        expect(hide).not.toHaveBeenCalled();
    });

    it('Enter is inert while a button is focused (the button activates itself)', () => {
        installTestDOM(CONFIG);

        const dialog = new TestDialog({ title: 'T', message: 'M' });
        const hide = vi.spyOn(dialog, 'hide').mockReturnValue(dialog);

        const button = DOM.sink.createElement('button');
        DOM.sink.focus(button);

        const { event, prevented } = enterEvent();
        dialog.enter(event);

        expect(prevented()).toBe(false);
        expect(hide).not.toHaveBeenCalled();
    });
});
