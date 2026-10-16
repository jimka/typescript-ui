//
// What a Dialog tells assistive technology: its role, the name it takes from
// its title (or from `ariaLabel`), the description it takes from its message,
// the name of its title-bar close button, and the role each static shortcut
// asks for. A dialog never carries `aria-modal` — the `inert` attribute
// LayerManager puts on everything outside it is what makes it modal.
//
import { describe, it, expect, afterEach, vi } from 'vitest';
import { _Dialog as Dialog, DialogButtons } from '~/overlay/Dialog';
import type { DialogConfig } from '~/overlay/Dialog';
import { Component } from '~/core/Component';
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

/** The rendered value of `name` on the dialog's own element, or null when absent. */
function attribute(dialog: Dialog, name: string): string | null {
    return DOM.source.getAttribute(dialog.getElement(true)!, name);
}

/** The id of the component that shows the dialog's title. */
function titleId(dialog: Dialog): string {
    return dialog.getTitleBar().getTitleText().getId();
}

/** The id of the component that shows the dialog's message. */
function messageId(dialog: Dialog): string {
    return dialog.getContentComponent().getComponents()[0].getId();
}

describe('Dialog — role', () => {
    afterEach(() => DOM.reset());

    // D1
    it('is a dialog by default', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M' });

        expect(attribute(dialog, 'role')).toBe('dialog');
        expect(dialog.getAria().getRole()).toBe('dialog');

        dialog.dispose();
    });

    // D2
    it('is an alert dialog when the config asks for one', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M', role: 'alertdialog' });

        expect(attribute(dialog, 'role')).toBe('alertdialog');

        dialog.dispose();
    });

    it('does not derive the role from the severity', () => {
        installTestDOM(CONFIG);

        // A tinted form is not an alert: only an explicit role makes one.
        const dialog = new Dialog({ title: 'T', contentComponent: new Component(), severity: 'error' });

        expect(attribute(dialog, 'role')).toBe('dialog');

        dialog.dispose();
    });

    // D9
    it('never carries aria-modal, before or after it is shown', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M' });

        expect(attribute(dialog, 'aria-modal')).toBeNull();

        void dialog.show();

        expect(attribute(dialog, 'aria-modal')).toBeNull();

        dialog.dispose();
    });
});

describe('Dialog — accessible name', () => {
    afterEach(() => DOM.reset());

    // D3
    it('is named by reference to its title text', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M' });

        expect(attribute(dialog, 'aria-labelledby')).toBe(titleId(dialog));
        expect(attribute(dialog, 'aria-label')).toBeNull();

        // The reference resolves: once the dialog is in the document, the
        // element with that id is the one showing the title.
        void dialog.show();

        const titleEl = dialog.getTitleBar().getTitleText().getElement();

        expect(titleEl).toBeDefined();
        expect(DOM.source.getElementById(titleId(dialog))).toBe(titleEl);

        dialog.dispose();
    });

    // D4
    it('takes ariaLabel as its name in place of the title', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M', ariaLabel: 'Delete record 42' });

        expect(attribute(dialog, 'aria-label')).toBe('Delete record 42');
        expect(attribute(dialog, 'aria-labelledby')).toBeNull();

        dialog.dispose();
    });

    // D5
    it('treats an empty ariaLabel as not set', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M', ariaLabel: '' });

        expect(attribute(dialog, 'aria-labelledby')).toBe(titleId(dialog));
        expect(attribute(dialog, 'aria-label')).toBeNull();

        dialog.dispose();
    });

    // D10
    it('keeps pointing at the title text when the title changes', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M' });
        const id     = titleId(dialog);

        dialog.getTitleBar().getTitleText().setText('New');

        expect(attribute(dialog, 'aria-labelledby')).toBe(id);
        expect(dialog.getTitleBar().getTitleText().getText()).toBe('New');

        dialog.dispose();
    });
});

describe('Dialog — description', () => {
    afterEach(() => DOM.reset());

    // D6
    it('is described by its message', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M' });

        expect(attribute(dialog, 'aria-describedby')).toBe(messageId(dialog));

        // The reference resolves to the element showing the message.
        void dialog.show();

        const messageEl = dialog.getContentComponent().getComponents()[0].getElement();

        expect(messageEl).toBeDefined();
        expect(DOM.source.getElementById(messageId(dialog))).toBe(messageEl);

        dialog.dispose();
    });

    // D7
    it('has no description when it is built from a content component', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', contentComponent: new Component() });

        expect(attribute(dialog, 'aria-describedby')).toBeNull();

        dialog.dispose();
    });

    it('ignores the message, as a description too, when a content component is given', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M', contentComponent: new Component() });

        expect(attribute(dialog, 'aria-describedby')).toBeNull();

        dialog.dispose();
    });

    // D8
    it('has no description when the message is omitted or empty', () => {
        installTestDOM(CONFIG);

        const omitted = new Dialog({ title: 'T' });
        const empty   = new Dialog({ title: 'T', message: '' });

        expect(attribute(omitted, 'aria-describedby')).toBeNull();
        expect(attribute(empty, 'aria-describedby')).toBeNull();

        omitted.dispose();
        empty.dispose();
    });
});

describe('Dialog — title-bar close button', () => {
    afterEach(() => DOM.reset());

    // D11
    it('is named "Close", with the name kept off its face', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M' });
        const close  = dialog.getTitleBar().getCloseButton()!;

        expect(close.getAria().getLabel()).toBe('Close');
        expect(close.isShowText()).toBe(false);

        dialog.dispose();
    });

    it('can be renamed through setText', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M' });
        const close  = dialog.getTitleBar().getCloseButton()!;

        close.setText('Stäng');

        expect(close.getAria().getLabel()).toBe('Stäng');

        dialog.dispose();
    });

    // D12
    it('is absent from a non-dismissable dialog, which keeps its role and name', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M', dismissable: false });

        expect(dialog.getTitleBar().getCloseButton()).toBeNull();
        expect(attribute(dialog, 'role')).toBe('dialog');
        expect(attribute(dialog, 'aria-labelledby')).toBe(titleId(dialog));

        dialog.dispose();
    });
});

describe('Dialog — the role each shortcut asks for', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        DOM.reset();
    });

    /**
     * Runs `call` with `Dialog.show` stubbed out and returns the config it was
     * handed.
     */
    async function configOf(call: () => Promise<unknown>): Promise<DialogConfig> {
        const show = vi.spyOn(Dialog, 'show').mockResolvedValue('confirm');

        await call();

        expect(show).toHaveBeenCalledTimes(1);

        const config = show.mock.calls[0][0];

        show.mockRestore();

        return config;
    }

    // S1
    it('Dialog.confirm is an alert dialog and keeps its buttons', async () => {
        installTestDOM(CONFIG);

        const config = await configOf(() => Dialog.confirm('T', 'M'));

        expect(config.role).toBe('alertdialog');
        expect(config.buttons).toEqual([
            { ...DialogButtons.Cancel, primary: true },
            DialogButtons.Confirm,
        ]);
    });

    // S2
    it('Dialog.warning and Dialog.error are alert dialogs', async () => {
        installTestDOM(CONFIG);

        const warning = await configOf(() => Dialog.warning('T', 'M'));
        const error   = await configOf(() => Dialog.error('T', 'M'));

        expect(warning.role).toBe('alertdialog');
        expect(error.role).toBe('alertdialog');
    });

    // S3
    it('Dialog.info and Dialog.success are plain dialogs', async () => {
        installTestDOM(CONFIG);

        const info    = await configOf(() => Dialog.info('T', 'M'));
        const success = await configOf(() => Dialog.success('T', 'M'));

        expect(info.role).toBe('dialog');
        expect(success.role).toBe('dialog');
    });
});
