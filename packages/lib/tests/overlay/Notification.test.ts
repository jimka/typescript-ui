//
// SCOPE: Notification is largely DOM- / timer- / animation-driven. Its only
// entry point, `Notification.show`, builds Glyph/Button children, appends to
// the document, plays an entrance Animation, and arms a setTimeout. What the
// offline harness genuinely cannot exercise is the entrance animation: rAF is a
// recorded no-op returning 0, so its `from` styles never advance into the
// transition, and that needs a real-DOM (jsdom-event or browser) harness. The
// auto-dismiss timer needs only a clock, not a real DOM, and runs under a fake
// one in `Notification.dismissTimer.test.ts`. Everything else is reachable: the
// static pause/resume refcount API is pure counter logic, the queue
// (`activeNotifications`) is static state the file reaches the way
// `Notification.styleRuleDisposal.test.ts` does, and a toast's stamp and its
// committed x/y are ordinary `Component` getters over modelled state. The
// stack's response to a viewport resize lives in `Notification.resize.test.ts`
// — `Event`'s viewport listener map is module-level and survives
// `DOM.reset()`, so a resize dispatch needs a file that registers the type once
// (see `tests/dom/viewport-consume.test.ts`).
import { describe, it, expect, afterEach } from 'vitest';
import { Notification } from '~/overlay/Notification';
import { DOM } from '~/core/DOM';
import { LayerManager, type DismissableLayer } from '~/core/LayerManager';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Dropdown-band layers to stamp before the toast is shown. Well past the three
// the old fixed 10002 literal survived, and past the 20-odd a busy screen ever
// holds open at once, so the band's own counter is exercised rather than just
// its base.
const DROPDOWN_LAYERS: number = 20;

/**
 * The toast most recently shown. The constructor is private, so the instance is
 * reached through the static active stack the way
 * `Notification.styleRuleDisposal.test.ts` already does.
 */
function liveToast(): Notification {
    const active = (Notification as unknown as { activeNotifications: Notification[] }).activeNotifications;

    return active[active.length - 1];
}

/**
 * Disposes every toast still live and whatever layer is topmost (the detail
 * dialog a case opened). Either one left behind stays known to the layer
 * manager across the DOM reset, and the next modal layer would tell it to go
 * inert through a released handle.
 */
function disposeLeftovers(): void {
    const live = (Notification as unknown as { activeNotifications: Notification[] }).activeNotifications;

    for (const toast of live.slice()) {
        toast.dispose();
    }

    (LayerManager.getTopLayer() as { dispose?(): void } | null)?.dispose?.();
}

/**
 * A minimal registered layer in the Dropdown band, for stamping the band up
 * before a toast is shown. It carries no element and is never dismissed — only
 * its allocated z-index matters here.
 */
function dropdownLayer(): DismissableLayer {
    return {
        getLayerElement: () => null,
        getDismissMode:  () => 'click-outside',
        requestClose:    () => {},
        getBand:         () => LayerManager.Band.Dropdown,
        isLayerRoot:     () => true,
    };
}

describe('Notification (pause/resume refcount, idle)', () => {
    afterEach(() => {
        disposeLeftovers();
        DOM.reset();
    });

    it('pauseAll / resumeAll are balanced no-ops when no toast is live', () => {
        installTestDOM(CONFIG);

        // With an empty active stack these only mutate the static counters and
        // iterate an empty list — they must not throw and must balance.
        expect(() => {
            Notification.pauseAll();
            Notification.resumeAll();
        }).not.toThrow();
    });

    it('resumeAll with no outstanding pause hold is a no-op (early return)', () => {
        installTestDOM(CONFIG);

        // modalCount is 0, so resumeAll returns immediately without underflowing.
        expect(() => Notification.resumeAll()).not.toThrow();
    });

    it('nested pauseAll holds compose and release cleanly', () => {
        installTestDOM(CONFIG);

        expect(() => {
            Notification.pauseAll();
            Notification.pauseAll();
            Notification.resumeAll();
            Notification.resumeAll();
        }).not.toThrow();
    });

    it("makes a toast's message text selectable and copyable", () => {
        installTestDOM(CONFIG);

        // A toast message is content the reader may want to select and copy —
        // the same category as a Dialog's body text, which
        // `tests/overlay/Dialog.test.ts` pins the same way. `_messageText` is a
        // `SelectableText`, so both values fold out of its class defaults
        // rather than a per-instance setter call; this asserts the behaviour
        // the swap to `SelectableText` had to preserve.
        //
        // The constructor is private, so the toast is reached through the
        // static active-stack the way `Notification.styleRuleDisposal.test.ts`
        // already does.
        Notification.show('msg');

        const active = (Notification as unknown as { activeNotifications: unknown[] }).activeNotifications;
        const toast  = active[active.length - 1] as { _messageText: { getUserSelect(): string | null; getCursor(): string | null } };

        expect(toast._messageText.getUserSelect()).toBe('text');
        expect(toast._messageText.getCursor()).toBe('text');
    });

    it("opts a toast's message text into the right-click Copy menu", () => {
        installTestDOM(CONFIG);

        Notification.show('msg');

        const active = (Notification as unknown as { activeNotifications: unknown[] }).activeNotifications;
        const toast  = active[active.length - 1] as { _messageText: { hasCopyMenu(): boolean } };

        expect(toast._messageText.hasCopyMenu()).toBe(true);
    });

    it("opts the detail dialog's full message into the right-click Copy menu", () => {
        installTestDOM(CONFIG);

        Notification.showDetail('msg', 'info');

        const dialog  = LayerManager.getTopLayer() as unknown as { getContentComponent(): { getComponents(): unknown[] } };
        const message = dialog.getContentComponent().getComponents()[0] as { hasCopyMenu(): boolean };

        expect(message.hasCopyMenu()).toBe(true);
    });
});

describe('Notification (stacking band)', () => {
    const layers: DismissableLayer[] = [];

    afterEach(() => {
        for (const layer of layers) {
            LayerManager.unregister(layer);
        }

        layers.length = 0;

        disposeLeftovers();
        DOM.reset();
    });

    it('places the notification band above the dropdown band and below the dialog band', () => {
        installTestDOM(CONFIG);

        // A toast floats over open pickers and menus, yet stays under the modal
        // detail dialog a toast can itself open.
        expect(LayerManager.Band.Notification).toBeGreaterThan(LayerManager.Band.Dropdown);
        expect(LayerManager.Band.Notification).toBeLessThan(LayerManager.Band.Dialog);
    });

    it('stamps a toast with the notification band', () => {
        installTestDOM(CONFIG);

        Notification.show('msg');

        expect(liveToast().getZIndex()).toBe(LayerManager.Band.Notification);
    });

    it('keeps a toast above every dropdown-band layer stamped before it', () => {
        installTestDOM(CONFIG);

        for (let i = 0; i < DROPDOWN_LAYERS; i++) {
            const layer = dropdownLayer();

            LayerManager.register(layer);
            layers.push(layer);
        }

        Notification.show('msg');

        const toastZ = liveToast().getZIndex();

        for (const layer of layers) {
            expect(toastZ).toBeGreaterThan(LayerManager.getZIndex(layer));
        }
    });
});

// modal-dialog-focus-trap plan, cases B3 and B4. A toast is mounted on <html>,
// outside every layer, and its dismiss button is a Tab stop. Only the button
// goes inert: the toast's root is a live region, and an inert root would
// silence the announcement for a screen reader.
describe('Notification (inert behind a modal layer)', () => {
    afterEach(() => {
        disposeLeftovers();
        DOM.reset();
    });

    function modalLayer(): DismissableLayer {
        return { getLayerElement: () => null, getDismissMode: () => 'modal', requestClose: () => {} };
    }

    /** The private dismiss button of `toast`. */
    function closeButtonOf(toast: Notification): { getInertAttribute(): boolean } {
        return (toast as unknown as { _closeButton: { getInertAttribute(): boolean } })._closeButton;
    }

    it('B3: a modal layer makes a toast\'s dismiss button inert, and not the toast', () => {
        installTestDOM(CONFIG);

        const modal = modalLayer();

        Notification.show('msg', 'info', 0);

        const toast = liveToast();

        expect(closeButtonOf(toast).getInertAttribute()).toBe(false);

        LayerManager.register(modal);

        expect(closeButtonOf(toast).getInertAttribute()).toBe(true);
        expect(toast.getInertAttribute()).toBe(false);

        LayerManager.unregister(modal);

        expect(closeButtonOf(toast).getInertAttribute()).toBe(false);

        toast.dispose();
    });

    it('B4: a toast shown while a modal layer is open comes up with an inert dismiss button', () => {
        installTestDOM(CONFIG);

        const modal = modalLayer();

        LayerManager.register(modal);
        Notification.show('msg', 'info', 0);

        const toast = liveToast();

        expect(closeButtonOf(toast).getInertAttribute()).toBe(true);

        // A disposed toast is no longer told, so closing the modal writes
        // through no released handle.
        toast.dispose();

        expect(() => LayerManager.unregister(modal)).not.toThrow();
    });
});
