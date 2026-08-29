import { describe, it, expect, afterEach, vi } from 'vitest';
import { _Dialog as Dialog, DialogButtons } from '~/overlay/Dialog';
import type { DialogButtonConfig } from '~/overlay/Dialog';
import { LayerManager } from '~/core/LayerManager';
import { DOM, type Handle } from '~/core/DOM';
import { Component } from '~/core/Component';
import { _Button as Button } from '~/component/button/Button';
import { _DialogBackdrop as DialogBackdrop } from '~/component/container/DialogBackdrop';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

// Mirrors core/Event.ts's applyDisposition: onEnter/onKeyDown no longer call
// preventDefault()/stopPropagation() themselves, they return a disposition the
// real dispatcher applies. These white-box wrappers call the handlers directly
// (bypassing the dispatcher), so they must apply the returned disposition the
// same way the dispatcher would for the prevented()/stopped() spies below to
// observe anything.
function applyDisposition(e: KeyboardEvent, result: unknown): void {
    if (result === true) {
        e.stopPropagation();
    } else if (result && typeof result === 'object') {
        const disposition = result as { stop?: boolean; prevent?: boolean };

        if (disposition.prevent) {
            e.preventDefault();
        }

        if (disposition.stop) {
            e.stopPropagation();
        }
    }
}

// White-box seam: widen the private Enter-confirm helpers so the primary-result
// decision and the focus-guard can be exercised without a rendered DOM (the
// end-to-end focus / keydown path needs querySelectorAll, which the offline DOM
// stubs to []).
class TestDialog extends Dialog {
    public primary(): string | null {
        return (this as any).primaryResult();
    }

    public enter(e: KeyboardEvent): void {
        applyDisposition(e, (this as any).onEnter(e));
    }

    public keyDown(e: KeyboardEvent): void {
        applyDisposition(e, (this as any).onKeyDown(e));
    }

    public requestFocusEl(): Handle | null {
        return (this as any).requestedFocusElement();
    }

    /** White-box seam onto the private footer row's buttons, by config order. */
    public button(index: number): Button {
        return (this as any)._buttonRow._buttons[index];
    }

    /**
     * Drives the footer row's private handleClick() directly, for `cfg` (a
     * config object also passed into this dialog's own `buttons` array) —
     * bypassing native `Button.click()` DOM dispatch, which requires the
     * button to already be mounted and (per PopupButton.test.ts's file-level
     * comment) is flaky across more than one test per file, since Event's
     * window-level click listener installs once per event type for the whole
     * test module's lifetime. handleClick() is the actual code under test in
     * the veto describe block below, so going through the DOM would only add
     * a fragile mounting step around it, not additional coverage.
     */
    public clickButton(cfg: DialogButtonConfig): Promise<void> {
        return (this as any)._buttonRow.handleClick(cfg, cfg.result ?? 'cancel');
    }
}

function enterEvent(): { event: KeyboardEvent; prevented: () => boolean; stopped: () => boolean } {
    let defaultPrevented = false;
    let propagationStopped = false;
    const event = {
        key: 'Enter',
        preventDefault: () => { defaultPrevented = true; },
        stopPropagation: () => { propagationStopped = true; },
    } as unknown as KeyboardEvent;

    return { event, prevented: () => defaultPrevented, stopped: () => propagationStopped };
}

function keyDownEvent(key: string, shiftKey = false): { event: KeyboardEvent; stopped: () => boolean } {
    let propagationStopped = false;
    const event = {
        key,
        shiftKey,
        preventDefault: () => {},
        stopPropagation: () => { propagationStopped = true; },
    } as unknown as KeyboardEvent;

    return { event, stopped: () => propagationStopped };
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

    it('makes a message dialog\'s body text selectable and copyable', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M' });

        expect(dialog.getContentComponent().getComponents()[0].getUserSelect()).toBe('text');
        expect(dialog.getContentComponent().getComponents()[0].getCursor()).toBe('text');
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
        content.setPreferredSize({ width: 400, height: 200 });
        const dialog = new Dialog({ title: 'T', contentComponent: content });
        const before = dialog.getHeight();

        content.setPreferredSize({ width: 400, height: 600 });
        dialog.resizeToContent();

        expect(dialog.getHeight()).toBe(before);
    });

    it('grows the dialog height to match taller content', () => {
        installTestDOM(CONFIG);

        const content = new Component();
        content.setPreferredSize({ width: 400, height: 200 });
        const dialog = renderedDialog(content);

        content.setPreferredSize({ width: 400, height: 500 });
        dialog.resizeToContent();

        expect(dialog.getHeight()).toBe(TITLE_HEIGHT + 500 + BUTTON_HEIGHT);
    });

    it('shrinks the dialog height to match smaller content', () => {
        installTestDOM(CONFIG);

        const content = new Component();
        content.setPreferredSize({ width: 400, height: 500 });
        const dialog = renderedDialog(content);

        content.setPreferredSize({ width: 400, height: 120 });
        dialog.resizeToContent();

        expect(dialog.getHeight()).toBe(TITLE_HEIGHT + 120 + BUTTON_HEIGHT);
    });

    it('caps the height so the dialog keeps a margin from the viewport edges', () => {
        installTestDOM(CONFIG);

        const content = new Component();
        content.setPreferredSize({ width: 400, height: 200 });
        const dialog = renderedDialog(content);

        content.setPreferredSize({ width: 400, height: 5000 });
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
        const { event, prevented, stopped } = enterEvent();

        dialog.enter(event);

        expect(prevented()).toBe(true);
        expect(stopped()).toBe(true);
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
        const { event, prevented, stopped } = enterEvent();

        dialog.enter(event);

        expect(prevented()).toBe(false);
        expect(stopped()).toBe(false);
        expect(hide).not.toHaveBeenCalled();
    });

    it('Enter is inert while a button is focused (the button activates itself)', () => {
        installTestDOM(CONFIG);

        const dialog = new TestDialog({ title: 'T', message: 'M' });
        const hide = vi.spyOn(dialog, 'hide').mockReturnValue(dialog);

        const button = DOM.sink.createElement('button');
        DOM.sink.focus(button);

        const { event, prevented, stopped } = enterEvent();
        dialog.enter(event);

        expect(prevented()).toBe(false);
        expect(stopped()).toBe(false);
        expect(hide).not.toHaveBeenCalled();
    });
});

describe('Dialog — Tab focus trap', () => {
    afterEach(() => DOM.reset());

    // Registrar regression (viewport-event-propagation): Dialog must consume
    // only the Tab it actually traps, not every keydown — otherwise a shown
    // Dialog would silence keydown app-wide. getFocusable() reads via
    // querySelectorAll, which the offline DOM stubs to [] (see the TestDialog
    // comment above), so offline the dialog always finds zero focusable
    // elements and takes the "trap the whole dialog" branch of onKeyDown's Tab
    // case — still a genuine consume (Tab must not leave an empty dialog),
    // exercised here the same way onEnter's regression cases are.
    it('consumes a trapped Tab', () => {
        installTestDOM(CONFIG);

        const dialog = new TestDialog({ title: 'T', message: 'M' });
        LayerManager.register(dialog);
        const { event, stopped } = keyDownEvent('Tab');

        dialog.keyDown(event);

        expect(stopped()).toBe(true);

        LayerManager.unregister(dialog);
    });

    it('does not consume an unrelated key', () => {
        installTestDOM(CONFIG);

        const dialog = new TestDialog({ title: 'T', message: 'M' });
        LayerManager.register(dialog);
        const { event, stopped } = keyDownEvent('a');

        dialog.keyDown(event);

        expect(stopped()).toBe(false);

        LayerManager.unregister(dialog);
    });
});

describe('Dialog — keydown scoped to the topmost layer', () => {
    afterEach(() => DOM.reset());

    // A Dialog's own keydown handling reacts on every keydown broadcast (the
    // dispatcher does not filter by target), so a backgrounded Dialog stacked
    // under another open layer must ignore keys that were meant for whichever
    // layer is actually on top — otherwise a "save preset" name prompt opened
    // from inside a login dialog would also confirm the login dialog
    // underneath when Enter is pressed in its own field.
    it('Enter confirms while the dialog is the topmost layer', () => {
        installTestDOM(CONFIG);

        const dialog = new TestDialog({ title: 'T', message: 'M' });
        LayerManager.register(dialog);
        const hide = vi.spyOn(dialog, 'hide').mockReturnValue(dialog);
        const { event, stopped } = enterEvent();

        dialog.keyDown(event);

        expect(stopped()).toBe(true);
        expect(hide).toHaveBeenCalledWith('confirm');

        LayerManager.unregister(dialog);
    });

    it('Enter is inert while another layer is stacked on top of the dialog', () => {
        installTestDOM(CONFIG);

        const dialog = new TestDialog({ title: 'T', message: 'M' });
        LayerManager.register(dialog);
        const onTop = { getLayerElement: () => null, getDismissMode: () => 'modal' as const, requestClose: () => {} };
        LayerManager.register(onTop);
        const hide = vi.spyOn(dialog, 'hide').mockReturnValue(dialog);
        const { event, stopped } = enterEvent();

        dialog.keyDown(event);

        expect(stopped()).toBe(false);
        expect(hide).not.toHaveBeenCalled();

        LayerManager.unregister(onTop);
        LayerManager.unregister(dialog);
    });

    it('a trapped Tab is inert while another layer is stacked on top of the dialog', () => {
        installTestDOM(CONFIG);

        const dialog = new TestDialog({ title: 'T', message: 'M' });
        LayerManager.register(dialog);
        const onTop = { getLayerElement: () => null, getDismissMode: () => 'modal' as const, requestClose: () => {} };
        LayerManager.register(onTop);
        const { event, stopped } = keyDownEvent('Tab');

        dialog.keyDown(event);

        expect(stopped()).toBe(false);

        LayerManager.unregister(onTop);
        LayerManager.unregister(dialog);
    });
});

describe('Dialog — dismissable', () => {
    afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

    it('default (dismissable omitted): close button is built and getDismissMode() is "modal"', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M' });

        expect(dialog.getTitleBar().getCloseButton()).toBeInstanceOf(Button);
        expect(dialog.getDismissMode()).toBe('modal');
    });

    it('default (dismissable omitted): requestClose() closes the dialog', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M' });
        const hide = vi.spyOn(dialog, 'hide').mockReturnValue(dialog);

        dialog.requestClose();

        expect(hide).toHaveBeenCalledWith('close');
    });

    it('default (dismissable omitted): closeOnBackdrop still wires the backdrop click', () => {
        installTestDOM(CONFIG);

        const addClickListener = vi.spyOn(DialogBackdrop.prototype, 'addClickListener');
        const dialog = new Dialog({ title: 'T', message: 'M', closeOnBackdrop: true });

        void dialog.show();

        expect(addClickListener).toHaveBeenCalled();
    });

    it('dismissable: false suppresses the title-bar close button', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M', dismissable: false });

        expect(dialog.getTitleBar().getCloseButton()).toBeNull();
    });

    it('dismissable: false makes requestClose() a no-op', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M', dismissable: false });
        const hide = vi.spyOn(dialog, 'hide').mockReturnValue(dialog);

        dialog.requestClose();

        expect(hide).not.toHaveBeenCalled();
    });

    it('dismissable: false does not wire the backdrop even with closeOnBackdrop: true', () => {
        installTestDOM(CONFIG);

        const addClickListener = vi.spyOn(DialogBackdrop.prototype, 'addClickListener');
        const dialog = new Dialog({ title: 'T', message: 'M', closeOnBackdrop: true, dismissable: false });

        void dialog.show();

        expect(addClickListener).not.toHaveBeenCalled();
    });

    it('dismissable: false keeps getDismissMode() at "modal" (Escape is swallowed, not delegated)', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'T', message: 'M', dismissable: false });

        expect(dialog.getDismissMode()).toBe('modal');
    });
});

describe('Dialog — initial focus', () => {
    afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

    it('open() defers focusFirst past the first layout instead of focusing synchronously', () => {
        installTestDOM(CONFIG);

        // The regression this guards: open() called focusFirst() inline, one line
        // after scheduling the layout. The first layout wraps the content in its
        // frame and re-parents the subtree, which blurs whatever was focused — so
        // focusing synchronously here lands on an element that is torn out a frame
        // later. Focus must be deferred to after that layout.
        const scheduled: Array<() => void> = [];
        vi.spyOn(Component, 'afterNextLayout').mockImplementation((cb: () => void) => { scheduled.push(cb); });

        const dialog = new TestDialog({ title: 'T', message: 'M' });
        const focusFirst = vi.spyOn(dialog as any, 'focusFirst');

        void dialog.show();

        // Not focused inline during open()...
        expect(focusFirst).not.toHaveBeenCalled();

        // ...but scheduled to run once the layout has settled.
        scheduled.forEach(cb => cb());

        expect(focusFirst).toHaveBeenCalledTimes(1);
    });

    it('requestedFocusElement() is null when no initialFocus is configured', () => {
        installTestDOM(CONFIG);

        const dialog = new TestDialog({ title: 'T', message: 'M' });

        expect(dialog.requestFocusEl()).toBeNull();
    });

    it('requestedFocusElement() is null when initialFocus has no element yet', () => {
        installTestDOM(CONFIG);

        // Configured, but never rendered — getElement() is undefined, so it falls
        // through to the default order rather than focusing nothing.
        const field = new Component();
        const dialog = new TestDialog({ title: 'T', contentComponent: field, initialFocus: field });

        expect(dialog.requestFocusEl()).toBeNull();
    });

    it('requestedFocusElement() returns the component root when it is itself focusable', () => {
        installTestDOM(CONFIG);

        // A TextField renders as the <input> itself, so its own root matches the
        // focusable selector — the case DOM.source.matches exists to catch. A
        // descendant-only query would miss it.
        const field  = new Component();
        const dialog = new TestDialog({ title: 'T', contentComponent: field, initialFocus: field });
        const el     = field.getElement(true);
        vi.spyOn(DOM.source, 'matches').mockReturnValue(true);

        expect(dialog.requestFocusEl()).toBe(el);
    });

    it('requestedFocusElement() falls back to the first focusable descendant', () => {
        installTestDOM(CONFIG);

        // A Panel wrapping a field: the root is not focusable, but a descendant is.
        const wrapper    = new Component();
        const dialog     = new TestDialog({ title: 'T', contentComponent: wrapper, initialFocus: wrapper });
        wrapper.getElement(true);
        const descendant = DOM.sink.createElement('input');
        vi.spyOn(DOM.source, 'matches').mockReturnValue(false);
        vi.spyOn(DOM.source, 'querySelector').mockReturnValue(descendant);

        expect(dialog.requestFocusEl()).toBe(descendant);
    });

    it('requestedFocusElement() is null when the component offers nothing focusable', () => {
        installTestDOM(CONFIG);

        const wrapper = new Component();
        const dialog  = new TestDialog({ title: 'T', contentComponent: wrapper, initialFocus: wrapper });
        wrapper.getElement(true);
        vi.spyOn(DOM.source, 'matches').mockReturnValue(false);
        vi.spyOn(DOM.source, 'querySelector').mockReturnValue(null);

        expect(dialog.requestFocusEl()).toBeNull();
    });
});

describe('Dialog — button onClick veto', () => {
    afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

    it('a button with no onClick still closes immediately (unchanged default)', () => {
        installTestDOM(CONFIG);

        const cfg    = DialogButtons.Confirm;
        const dialog = new TestDialog({ title: 'T', message: 'M', buttons: [cfg] });
        const hide   = vi.spyOn(dialog, 'hide').mockReturnValue(dialog);

        void dialog.clickButton(cfg);

        expect(hide).toHaveBeenCalledWith('confirm');
    });

    it('onClick resolving true closes with the button\'s own result', async () => {
        installTestDOM(CONFIG);

        const cfg: DialogButtonConfig = { text: 'Import', result: 'confirm', onClick: () => Promise.resolve(true) };
        const dialog = new TestDialog({ title: 'T', message: 'M', buttons: [cfg] });
        const hide   = vi.spyOn(dialog, 'hide').mockReturnValue(dialog);

        await dialog.clickButton(cfg);

        expect(hide).toHaveBeenCalledWith('confirm');
    });

    it('onClick returning false (sync) vetoes the close', async () => {
        installTestDOM(CONFIG);

        const cfg: DialogButtonConfig = { text: 'Import', result: 'confirm', onClick: () => false };
        const dialog = new TestDialog({ title: 'T', message: 'M', buttons: [cfg] });
        const hide   = vi.spyOn(dialog, 'hide').mockReturnValue(dialog);

        await dialog.clickButton(cfg);

        expect(hide).not.toHaveBeenCalled();
    });

    it('onClick resolving false (async) vetoes the close', async () => {
        installTestDOM(CONFIG);

        const cfg: DialogButtonConfig = { text: 'Import', result: 'confirm', onClick: () => Promise.resolve(false) };
        const dialog = new TestDialog({ title: 'T', message: 'M', buttons: [cfg] });
        const hide   = vi.spyOn(dialog, 'hide').mockReturnValue(dialog);

        await dialog.clickButton(cfg);

        expect(hide).not.toHaveBeenCalled();
    });

    it('disables every button while one\'s onClick is pending, and re-enables them after a veto', async () => {
        installTestDOM(CONFIG);

        let resolveGuard!: (v: boolean) => void;
        const guard = new Promise<boolean>((resolve) => { resolveGuard = resolve; });

        const cancelCfg: DialogButtonConfig = { text: 'Cancel', result: 'close' };
        const importCfg: DialogButtonConfig = { text: 'Import', result: 'confirm', onClick: () => guard };
        const dialog = new TestDialog({ title: 'T', message: 'M', buttons: [cancelCfg, importCfg] });
        vi.spyOn(dialog, 'hide').mockReturnValue(dialog);

        const pending = dialog.clickButton(importCfg);

        expect(dialog.button(0).isEnabled()).toBe(false);
        expect(dialog.button(1).isEnabled()).toBe(false);

        resolveGuard(false);
        await pending;

        expect(dialog.button(0).isEnabled()).toBe(true);
        expect(dialog.button(1).isEnabled()).toBe(true);
    });
});
