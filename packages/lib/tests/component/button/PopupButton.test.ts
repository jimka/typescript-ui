// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, afterEach, vi } from 'vitest';
import { PopupButton } from '~/component/button/PopupButton';
import { PopupPanel } from '~/overlay/PopupPanel';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { LayerManager } from '~/core/LayerManager';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Every button and panel a test constructs is disposed in afterEach: dispose()
// runs Component.destructor(), which unregisters an open panel from the
// LayerManager module singleton AND cancels any still-running Animation.play
// fade via the pending-transition registry — an un-disposed dropdown otherwise
// leaves its fallback setTimeout armed to fire after DOM.reset() has released
// the handle it targets, corrupting a later, unrelated test file.
const created: Array<{ dispose(): void }> = [];

afterEach(() => {
    for (let i = created.length - 1; i >= 0; i--) {
        created[i].dispose();
    }

    created.length = 0;
    DOM.reset();
});

/** A panel with a trivial content child, tracked for disposal. */
function panel(): PopupPanel {
    const p = new PopupPanel({ preferredSize: { width: 100, height: 50 }, components: [new Component()] });

    created.push(p);

    return p;
}

// MUST be the first describe block in this file, and its one test the only
// place `.click()` is used — see tests/component/MenuButton.test.ts's
// file-level comment for why (Event's window-level base listener is
// installed once per event type for the module's lifetime and never re-armed
// by a later installTestDOM()). Every other test below drives the toggle
// through the private togglePopup() path directly.
describe('PopupButton listeners bag (native click dispatch)', () => {
    afterEach(() => DOM.reset());

    it('a consumer listeners.action fires on click even when no panel is configured', () => {
        installTestDOM(CONFIG);

        const actionSpy = vi.fn();
        const btn       = new PopupButton({ listeners: { action: actionSpy } });

        btn.getElement(true);
        btn.click();

        expect(actionSpy).toHaveBeenCalledOnce();
    });
});

describe('PopupButton toggle', () => {
    it('opens the configured panel instance on first toggle, closes it on second', () => {
        installTestDOM(CONFIG);

        const p   = panel();
        const btn = new PopupButton({ panel: p });
        created.push(btn);
        btn.getElement(true);

        (btn as any).togglePopup();
        expect(p.isOpen()).toBe(true);

        (btn as any).togglePopup();
        expect(p.isOpen()).toBe(false);
    });

    it('calls a factory once on first open and reuses the result on later toggles', () => {
        installTestDOM(CONFIG);

        const p       = panel();
        const factory = vi.fn(() => p);
        const btn     = new PopupButton({ panel: factory });
        created.push(btn);
        btn.getElement(true);

        (btn as any).togglePopup();
        expect(factory).toHaveBeenCalledOnce();
        expect(p.isOpen()).toBe(true);

        (btn as any).togglePopup();
        expect(factory).toHaveBeenCalledOnce();
        expect(p.isOpen()).toBe(false);
    });

    it('is a no-op when no panel is configured, without throwing', () => {
        installTestDOM(CONFIG);

        const btn = new PopupButton({});
        created.push(btn);
        btn.getElement(true);

        expect(() => (btn as any).togglePopup()).not.toThrow();
        expect(LayerManager.getTopLayer()).toBeNull();
    });

    it('toggling an unattached button is a no-op: no panel constructed, no LayerManager registration', () => {
        installTestDOM(CONFIG);

        const factory = vi.fn(() => panel());
        const btn     = new PopupButton({ panel: factory });
        created.push(btn);

        expect(btn.getElement()).toBeFalsy();
        expect(() => (btn as any).togglePopup()).not.toThrow();
        expect(factory).not.toHaveBeenCalled();
        expect(LayerManager.getTopLayer()).toBeNull();
    });
});

describe('PopupButton aria', () => {
    it('reports aria-haspopup="dialog" from construction and aria-expanded="false", flipping on open/close', () => {
        installTestDOM(CONFIG);

        const p   = panel();
        const btn = new PopupButton({ panel: p });
        created.push(btn);

        expect(btn.getAria().getHasPopup()).toBe('dialog');
        expect(btn.getAria().getExpanded()).toBe(false);

        btn.getElement(true);
        (btn as any).togglePopup();
        expect(btn.getAria().getExpanded()).toBe(true);

        (btn as any).togglePopup();
        expect(btn.getAria().getExpanded()).toBe(false);
    });

    it('sets aria-controls to the panel id once the panel is first resolved', () => {
        installTestDOM(CONFIG);

        const p   = panel();
        const btn = new PopupButton({ panel: p });
        created.push(btn);
        btn.getElement(true);

        expect(btn.getAria().getControls()).toBeNull();

        (btn as any).togglePopup();

        expect(btn.getAria().getControls()).toBe(p.getId());
    });

    it('an outside dismissal via panel.requestClose() closes the panel and clears aria-expanded', () => {
        installTestDOM(CONFIG);

        const p   = panel();
        const btn = new PopupButton({ panel: p });
        created.push(btn);
        btn.getElement(true);

        (btn as any).togglePopup();
        expect(btn.getAria().getExpanded()).toBe(true);

        p.requestClose();

        expect(p.isOpen()).toBe(false);
        expect(btn.getAria().getExpanded()).toBe(false);
    });
});

describe('PopupButton panel ownership', () => {
    it('setPanel disposes the previously resolved panel; getPanel returns the configured value or null', () => {
        installTestDOM(CONFIG);

        const first  = panel();
        const second = panel();
        const btn    = new PopupButton({ panel: first });
        created.push(btn);
        btn.getElement(true);

        (btn as any).togglePopup();

        const disposeSpy = vi.spyOn(first, 'dispose');
        btn.setPanel(second);

        expect(disposeSpy).toHaveBeenCalledOnce();
        expect(btn.getPanel()).toBe(second);
        expect(new PopupButton({}).getPanel()).toBeNull();
    });

    it('disposing the button disposes the resolved panel', () => {
        installTestDOM(CONFIG);

        const p   = panel();
        const btn = new PopupButton({ panel: p });
        btn.getElement(true);

        (btn as any).togglePopup();

        const disposeSpy = vi.spyOn(p, 'dispose');
        btn.dispose();

        expect(disposeSpy).toHaveBeenCalledOnce();
    });
});
