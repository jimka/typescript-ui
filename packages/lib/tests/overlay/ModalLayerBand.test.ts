// Covers the modal-layer stacking guarantee on the real overlay classes: a
// modal Dialog's backdrop has a strictly higher z-index than every non-modal
// surface, whatever the dialog was opened from, and a Drawer stamps in the new
// Drawer band (non-modal) or the Dialog band (modal). Every cross-surface
// comparison is strict, because several open orders produced an exact tie
// before the fix and a tie resolves only by DOM insertion order. See the plan's
// Expected Behaviour cases INT-1 to INT-9.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { _Dialog as Dialog } from '~/overlay/Dialog';
import { _Window as Window } from '~/overlay/Window';
import { Drawer } from '~/overlay/Drawer';
import { Rail } from '~/overlay/Rail';
import { LayerManager, type DismissableLayer, type LayerDismissMode } from '~/core/LayerManager';
import { DOM, type Handle } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Every surface opened by a case, so the draining afterEach can unregister
// them — LayerManager is a module singleton and leaks state between tests
// otherwise. Mirrors LayerManager.test.ts's own drain.
const live: DismissableLayer[] = [];

/** Opens a drawer of the given modality and tracks it for the drain. */
function openDrawer(modal: boolean): Drawer {
    const drawer = new Drawer({ modal });

    drawer.open();
    live.push(drawer);

    return drawer;
}

/** Shows a window and tracks it for the drain. */
function openWindow(): Window {
    const win = new Window('w');

    win.show();
    live.push(win);

    return win;
}

/** Shows a dialog and tracks it for the drain; its promise is never awaited. */
function openDialog(): Dialog {
    const dialog = new Dialog({ title: 'T', message: 'M' });

    void dialog.show();
    live.push(dialog);

    return dialog;
}

/**
 * The z-index of a modal surface's scrim — a dialog's backdrop or a modal
 * drawer's. White-box: no public accessor exposes the scrim (same read as
 * `Dialog.test.ts`'s backdrop-handle case).
 */
function scrimZ(surface: Dialog | Drawer): number {
    return ((surface as unknown as { _backdrop: { getZIndex(): number } })._backdrop).getZIndex();
}

/** Dispatches a `pointerdown` at `target` the way LayerManager receives one. */
function pressOn(target: Handle): void {
    DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(target, 'pointerdown') as unknown as Event);
}

describe('modal layer band integrity', () => {
    afterEach(() => {
        // Drain in reverse open order; unregister is idempotent.
        for (let i = live.length - 1; i >= 0; i--) {
            LayerManager.unregister(live[i]);
        }

        live.length = 0;

        vi.restoreAllMocks();
        DOM.reset();
    });

    it('INT-1. a dialog opened over a drawer and a window backdrops above both', () => {
        installTestDOM(CONFIG);

        const drawer = openDrawer(false);
        const win    = openWindow();
        const dialog = openDialog();

        const backdropZ = scrimZ(dialog);

        expect(backdropZ).toBeGreaterThan(drawer.getZIndex());
        expect(backdropZ).toBeGreaterThan(win.getZIndex());
        expect(dialog.getZIndex()).toBeGreaterThan(backdropZ);
    });

    it('INT-2. a dialog opened over a drawer backdrops above it', () => {
        installTestDOM(CONFIG);

        const drawer = openDrawer(false);
        const dialog = openDialog();

        const backdropZ = scrimZ(dialog);

        expect(backdropZ).toBeGreaterThan(drawer.getZIndex());
        expect(dialog.getZIndex()).toBeGreaterThan(backdropZ);
    });

    it('INT-3. a drawer opened while a dialog is up stays under the backdrop', () => {
        installTestDOM(CONFIG);

        const dialog = openDialog();
        const drawer = openDrawer(false);

        expect(scrimZ(dialog)).toBeGreaterThan(drawer.getZIndex());
    });

    it('INT-4. a dialog opened over a window and a drawer backdrops above both', () => {
        installTestDOM(CONFIG);

        const win    = openWindow();
        const drawer = openDrawer(false);
        const dialog = openDialog();

        const backdropZ = scrimZ(dialog);

        expect(backdropZ).toBeGreaterThan(win.getZIndex());
        expect(backdropZ).toBeGreaterThan(drawer.getZIndex());
    });

    it('INT-5. a dialog opened from a window backdrops above it and above toasts', () => {
        installTestDOM(CONFIG);

        const win    = openWindow();
        const dialog = openDialog();

        const backdropZ = scrimZ(dialog);

        expect(backdropZ).toBeGreaterThan(win.getZIndex());
        expect(backdropZ).toBeGreaterThan(LayerManager.Band.Notification);
    });

    it('INT-6. a dialog opened alone backdrops above toasts and under its own panel', () => {
        installTestDOM(CONFIG);

        const dialog = openDialog();

        const backdropZ = scrimZ(dialog);

        expect(dialog.getZIndex()).toBeGreaterThan(backdropZ);
        expect(backdropZ).toBeGreaterThan(LayerManager.Band.Notification);
    });

    it('INT-7. a non-modal drawer stacks under a window and over the rail', () => {
        installTestDOM(CONFIG);

        const win    = openWindow();
        const drawer = openDrawer(false);
        const rail   = new Rail();

        expect(drawer.getZIndex()).toBeLessThan(win.getZIndex());
        expect(drawer.getZIndex()).toBeGreaterThan(rail.getZIndex());
    });

    it('INT-8. a modal drawer scrims above a window opened after it', () => {
        installTestDOM(CONFIG);

        const drawer = openDrawer(true);
        const win    = openWindow();

        const scrim = scrimZ(drawer);

        expect(scrim).toBeGreaterThan(win.getZIndex());
        expect(drawer.getZIndex()).toBeGreaterThan(scrim);
    });

    it('INT-8. a modal drawer opened over a window scrims above it', () => {
        installTestDOM(CONFIG);

        const win    = openWindow();
        const drawer = openDrawer(true);

        const scrim = scrimZ(drawer);

        expect(scrim).toBeGreaterThan(win.getZIndex());
        expect(drawer.getZIndex()).toBeGreaterThan(scrim);
    });

    describe('INT-9. the opener edge still carries activation', () => {
        /**
         * A Window-band root that reports activation, standing in for the
         * window a dialog is opened from. A fake rather than a real `Window`
         * so the activation calls are directly observable.
         */
        function fakeWindowRoot(): DismissableLayer & { onActivate: ReturnType<typeof vi.fn> } {
            const el = DOM.sink.createElement('div');

            return {
                getLayerElement: (): Handle => el,
                getDismissMode:  (): LayerDismissMode => 'manual',
                requestClose:    vi.fn<() => void>(),
                onActivate:      vi.fn<(active: boolean) => void>(),
                getBand:         (): number => LayerManager.Band.Window,
                isLayerRoot:     (): boolean => true,
            };
        }

        it('leaves the opener window active when the press lands in the dialog', () => {
            installTestDOM(CONFIG);

            const win = fakeWindowRoot();

            LayerManager.register(win);
            live.push(win);
            LayerManager.bringToFront(win);

            // Harness control: a press outside every layer deactivates the
            // window. Without it, the final assertion could pass because
            // nothing was ever dispatched.
            pressOn(DOM.sink.createElement('div'));
            expect(win.onActivate).toHaveBeenLastCalledWith(false);

            LayerManager.bringToFront(win);
            expect(win.onActivate).toHaveBeenLastCalledWith(true);

            const dialog = openDialog();
            const probe  = DOM.sink.createElement('div');
            DOM.sink.appendChild(dialog.getLayerElement()!, probe);

            // The dialog keeps its own band but still links under the window,
            // so the press resolves to the window as the activatable ancestor
            // and the title bar stays lit. With the parent severed, the manager
            // would mark the dialog active and deactivate the window.
            pressOn(probe);
            expect(win.onActivate).toHaveBeenLastCalledWith(true);
        });

        it('re-activates the opener window when the press lands in the dialog', () => {
            installTestDOM(CONFIG);

            const win = fakeWindowRoot();

            LayerManager.register(win);
            live.push(win);
            LayerManager.bringToFront(win);

            // Start from a deactivated window — a press outside every layer,
            // which also proves presses reach the manager — so the press inside
            // the dialog has to produce a fresh activation rather than leaving
            // an earlier `true` standing.
            pressOn(DOM.sink.createElement('div'));
            expect(win.onActivate).toHaveBeenLastCalledWith(false);

            const dialog = openDialog();
            const probe  = DOM.sink.createElement('div');
            DOM.sink.appendChild(dialog.getLayerElement()!, probe);

            win.onActivate.mockClear();

            pressOn(probe);
            expect(win.onActivate).toHaveBeenCalledWith(true);
        });
    });
});
