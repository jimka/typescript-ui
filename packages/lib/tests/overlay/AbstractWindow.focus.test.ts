// window-focus-on-show plan, cases O, T, F, R and C. A shown window takes
// keyboard focus once it has laid out (unless built with `autoFocus: false`),
// `bringToFront()` takes focus even on the already-active window, and closing
// a window that holds focus returns it to where it came from. Driven in the
// modelled test DOM: `Component.afterNextLayout` is collected, not scheduled,
// so a case decides when the next layout flush happens.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Window } from '~/overlay/Window';
import { _TabWindow as TabWindow } from '~/overlay/TabWindow';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { LayerManager } from '~/core/LayerManager';
import { Component } from '~/core/Component';
import { _Button as Button } from '~/component/button/Button';
import { Tooltip } from '~/overlay/Tooltip';
import { DOM, type Handle } from '~/core/DOM';
import { installTestDOM, setConnected } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Collects `Component.afterNextLayout` callbacks instead of scheduling them. */
function collectLayoutCallbacks(): { run(): void; cancel: ReturnType<typeof vi.fn> } {
    const scheduled: Array<() => void> = [];
    const cancel = vi.fn();

    vi.spyOn(Component, 'afterNextLayout').mockImplementation((cb: () => void) => {
        scheduled.push(cb);

        return { cancel };
    });

    return {
        run: (): void => {
            const batch = scheduled.splice(0);

            batch.forEach(cb => cb());
        },
        cancel,
    };
}

/** Makes every animation complete synchronously, as reduced motion does. */
function reduceMotion(): void {
    vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} });
}

/** A connected, focused button standing in for whatever opened the window. */
function focusedOpener(): { opener: Button; openerEl: Handle } {
    const opener   = new Button({ text: 'Open' });
    const openerEl = opener.getElement(true)!;

    setConnected(openerEl, true);
    DOM.sink.focus(openerEl);

    return { opener, openerEl };
}

/** A connected page element, focusable, that is not the opener. */
function pageElement(): Handle {
    const other = new Button({ text: 'Other' }).getElement(true)!;

    setConnected(other, true);

    return other;
}

/** A button appended inside the window and focused. */
function focusChildOf(win: AbstractWindow): Handle {
    const child = DOM.sink.createElement('button');

    DOM.sink.appendChild(win.getElement()!, child);
    DOM.sink.focus(child);

    return child;
}

const active = (): Handle | null => DOM.source.getActiveElement();

describe('AbstractWindow focus on show', () => {
    // Every window a case shows, disposed by the teardown: LayerManager is a
    // module singleton, and a window left registered is written through a
    // released handle by the next case.
    const windows: AbstractWindow[] = [];

    function track<T extends AbstractWindow>(win: T): T {
        windows.push(win);

        return win;
    }

    afterEach(() => {
        for (const win of windows) {
            win.dispose();
        }

        windows.length = 0;

        Tooltip._stopPointerWatch();
        vi.restoreAllMocks();
        DOM.reset();
    });

    describe('the option', () => {
        it('O1: autoFocus defaults to true on a Window and a TabWindow', () => {
            installTestDOM(CONFIG);

            expect(track(new Window('W')).isAutoFocus()).toBe(true);
            expect(track(new TabWindow()).isAutoFocus()).toBe(true);
        });

        it('O2: autoFocus: false round-trips from the options bag', () => {
            installTestDOM(CONFIG);

            expect(track(new Window('W', { autoFocus: false })).isAutoFocus()).toBe(false);
        });

        it('O3: setAutoFocus round-trips', () => {
            installTestDOM(CONFIG);

            const win = track(new Window('W'));

            win.setAutoFocus(false);
            expect(win.isAutoFocus()).toBe(false);

            win.setAutoFocus(true);
            expect(win.isAutoFocus()).toBe(true);
        });
    });

    describe('takeFocus through activation', () => {
        it('T1: activating moves focus to the window element, preventing scroll', () => {
            installTestDOM(CONFIG);

            const { openerEl } = focusedOpener();
            const win   = track(new Window('W'));
            const winEl = win.getElement(true)!;
            const focus = vi.spyOn(DOM.sink, 'focus');

            expect(active()).toBe(openerEl);

            win.onActivate(true);

            expect(focus).toHaveBeenCalledTimes(1);
            expect(focus).toHaveBeenCalledWith(winEl, { preventScroll: true });
            expect(active()).toBe(winEl);
        });

        it('T2: activating leaves focus alone when it is already inside the window', () => {
            installTestDOM(CONFIG);

            const win = track(new Window('W'));

            win.getElement(true);
            focusChildOf(win);

            const focus = vi.spyOn(DOM.sink, 'focus');

            win.onActivate(true);

            expect(focus).not.toHaveBeenCalled();
        });

        it('T3: an inert window takes no focus but still fires "activate"', () => {
            installTestDOM(CONFIG);

            focusedOpener();

            const win   = track(new Window('W'));
            const spy   = vi.fn();
            win.getElement(true);
            win.on('activate', spy);
            win.onInertChanged(true);

            const focus = vi.spyOn(DOM.sink, 'focus');

            win.onActivate(true);

            expect(focus).not.toHaveBeenCalled();
            expect(spy).toHaveBeenCalledTimes(1);
        });

        it('T4: a window never rendered takes no focus and does not throw', () => {
            installTestDOM(CONFIG);

            const win   = track(new Window('W'));
            const focus = vi.spyOn(DOM.sink, 'focus');

            expect(() => win.onActivate(true)).not.toThrow();
            expect(focus).not.toHaveBeenCalled();
        });

        it('T5: the accessible name is current when focus lands', () => {
            installTestDOM(CONFIG);

            focusedOpener();

            const win = track(new TabWindow());

            win.getElement(true);
            vi.spyOn(win, 'getTitle').mockReturnValue('B');

            let label: string | null | undefined;

            vi.spyOn(DOM.sink, 'focus').mockImplementation(() => {
                label = win.getAria().getLabel();
            });

            win.onActivate(true);

            expect(label).toBe('B');
        });
    });

    describe('show()', () => {
        it('F1: focus moves into the window only after the next layout', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();
            const { openerEl } = focusedOpener();
            const win   = track(new Window('W'));
            const focus = vi.spyOn(DOM.sink, 'focus');

            win.show();

            expect(focus).not.toHaveBeenCalled();
            expect(active()).toBe(openerEl);

            layout.run();

            expect(focus).toHaveBeenCalledTimes(1);
            expect(focus).toHaveBeenCalledWith(win.getElement()!, { preventScroll: true });
            expect(active()).toBe(win.getElement());
        });

        it('F2: a TabWindow is named by its title when focus lands', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            focusedOpener();

            const win = track(new TabWindow());

            win.createTab(new Component({}));
            vi.spyOn(win, 'getTitle').mockReturnValue('B');
            win.show();

            let label: string | null | undefined;

            const focus = vi.spyOn(DOM.sink, 'focus').mockImplementation(() => {
                label = win.getAria().getLabel();
            });

            layout.run();

            expect(focus).toHaveBeenCalledTimes(1);
            expect(focus).toHaveBeenCalledWith(win.getElement()!, { preventScroll: true });
            expect(label).toBe('B');
        });

        it('F3: autoFocus false leaves focus where it was', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();
            const { openerEl } = focusedOpener();
            const win   = track(new Window('W', { autoFocus: false }));
            const focus = vi.spyOn(DOM.sink, 'focus');

            win.show();
            layout.run();

            expect(focus).not.toHaveBeenCalled();
            expect(active()).toBe(openerEl);
        });

        it('F4: a field the application focused after show() keeps focus', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            focusedOpener();

            const win = track(new Window('W'));

            win.show();

            const child = focusChildOf(win);
            const focus = vi.spyOn(DOM.sink, 'focus');

            layout.run();

            expect(focus).not.toHaveBeenCalled();
            expect(active()).toBe(child);
        });

        it('F5: a window shown while inert never takes focus', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            focusedOpener();

            const win   = track(new Window('W'));
            const focus = vi.spyOn(DOM.sink, 'focus');

            win.show();
            win.onInertChanged(true);
            layout.run();
            win.onInertChanged(false);

            expect(focus).not.toHaveBeenCalled();
        });

        it('F6: a window shown minimized takes no focus', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            focusedOpener();

            const win   = track(new Window('W', { windowState: 'minimized' }));
            const focus = vi.spyOn(DOM.sink, 'focus');

            win.show();
            layout.run();

            expect(focus).not.toHaveBeenCalled();
        });

        it('F7: closing or disposing before the layout cancels the queued move', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            // No reduceMotion(): the close fade is still running when the
            // queued move would fire, so the cancel that onExitAction makes is
            // the one under test, not the destructor's at the end of the fade.
            focusedOpener();

            const closed = track(new Window('W'));

            closed.show();
            closed.requestClose();

            expect(layout.cancel).toHaveBeenCalledTimes(1);

            layout.cancel.mockClear();

            const disposed = track(new Window('W'));

            disposed.show();
            disposed.dispose();

            expect(layout.cancel).toHaveBeenCalledTimes(1);
        });

        it('F8: stacked windows take focus in order and give it back in reverse', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            reduceMotion();

            const { openerEl } = focusedOpener();
            const a = track(new Window('A'));
            const b = track(new Window('B'));

            a.show();
            b.show();
            // The modelled DOM does not report a mounted window as connected.
            setConnected(a.getElement()!, true);
            layout.run();

            expect(active()).toBe(b.getElement());

            b.requestClose();
            expect(active()).toBe(a.getElement());

            a.requestClose();
            expect(active()).toBe(openerEl);
        });
    });

    describe('bringToFront(), a press and restore()', () => {
        /** Shows `win` and runs the layout flush the show queued. */
        function shown<T extends AbstractWindow>(win: T, layout: { run(): void }): T {
            track(win).show();
            layout.run();

            return win;
        }

        it('R1: bringToFront moves focus to a window that is already active', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            focusedOpener();

            const win = shown(new Window('W'), layout);

            DOM.sink.focus(pageElement());
            win.bringToFront();

            expect(active()).toBe(win.getElement());
        });

        it('R2: bringToFront on an inactive window focuses it exactly once', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            focusedOpener();

            const a = shown(new Window('A'), layout);
            const b = shown(new Window('B'), layout);

            expect(b.getElement()).not.toBeNull();

            DOM.sink.focus(pageElement());

            const focus = vi.spyOn(DOM.sink, 'focus');

            a.bringToFront();

            expect(focus).toHaveBeenCalledTimes(1);
            expect(active()).toBe(a.getElement());
        });

        it('R3: autoFocus false raises and activates without moving focus', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            focusedOpener();

            const a = shown(new Window('A', { autoFocus: false }), layout);

            shown(new Window('B'), layout);

            const other = pageElement();

            DOM.sink.focus(other);

            const spy   = vi.fn();
            const focus = vi.spyOn(DOM.sink, 'focus');

            a.on('activate', spy);
            a.bringToFront();

            expect(focus).not.toHaveBeenCalled();
            expect(spy).toHaveBeenCalledTimes(1);
        });

        it('R4: a window that was never shown takes no focus', () => {
            installTestDOM(CONFIG);

            focusedOpener();

            const win = track(new Window('W'));

            win.getElement(true);

            const focus = vi.spyOn(DOM.sink, 'focus');

            win.bringToFront();

            expect(focus).not.toHaveBeenCalled();
        });

        it('R5: focus already inside the window stays', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            focusedOpener();

            const win = shown(new Window('W'), layout);

            focusChildOf(win);

            const focus = vi.spyOn(DOM.sink, 'focus');

            win.bringToFront();

            expect(focus).not.toHaveBeenCalled();
        });

        it('R6: a press on the active window moves no focus', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            focusedOpener();

            const win = shown(new Window('W'), layout);

            DOM.sink.focus(pageElement());

            const focus = vi.spyOn(DOM.sink, 'focus');

            (win as any)._boundOnPressRaise();

            expect(focus).not.toHaveBeenCalled();
        });

        it('R6b: a press on an inactive window focuses it, also with autoFocus false', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            focusedOpener();

            const win = shown(new Window('W', { autoFocus: false }), layout);

            shown(new Window('B'), layout);
            DOM.sink.focus(pageElement());

            const focus = vi.spyOn(DOM.sink, 'focus');

            (win as any)._boundOnPressRaise();

            expect(focus).toHaveBeenCalledTimes(1);
            expect(active()).toBe(win.getElement());
        });

        it('R8: the name is refreshed when a raise of the active window takes focus', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            focusedOpener();

            const win = track(new TabWindow());
            const title = vi.spyOn(win, 'getTitle').mockReturnValue('A');

            win.createTab(new Component({}));
            win.show();
            layout.run();
            DOM.sink.focus(pageElement());

            // The window is already active, so onActivate does not run again:
            // only takeFocus can bring the name up to date.
            title.mockReturnValue('B');

            let label: string | null | undefined;

            vi.spyOn(DOM.sink, 'focus').mockImplementation(() => {
                label = win.getAria().getLabel();
            });

            win.bringToFront();

            expect(label).toBe('B');
        });

        it('R9: a later activation still takes focus after a raise that did not', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            focusedOpener();

            const a = shown(new Window('A', { autoFocus: false }), layout);

            shown(new Window('B'), layout);
            DOM.sink.focus(pageElement());

            // Activates `a` through the layer manager directly, as a pointer
            // or focus interaction does; the raise that showed `a` without
            // focus must have put the activation flag back.
            LayerManager.bringToFront(a);

            expect(active()).toBe(a.getElement());
        });

        it('R10: a throwing "activate" listener still restores the activation flag', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            focusedOpener();

            const a = shown(new Window('A', { autoFocus: false }), layout);
            const b = shown(new Window('B'), layout);
            const boom = (): void => { throw new Error('boom'); };

            a.on('activate', boom);

            expect(() => a.bringToFront()).toThrow('boom');

            a.off('activate', boom);
            b.bringToFront();
            DOM.sink.focus(pageElement());
            LayerManager.bringToFront(a);

            expect(active()).toBe(a.getElement());
        });

        describe('across layers', () => {
            const layers: Array<{ getLayerElement(): Handle }> = [];

            afterEach(() => {
                for (const layer of layers) {
                    LayerManager.unregister(layer as never);
                }

                layers.length = 0;
            });

            /** Registers a layer opened from `win` (the last registered), with a focused button. */
            function focusedChildLayer(): Handle {
                const el    = DOM.sink.createElement('div');
                const field = DOM.sink.createElement('button');
                const layer = {
                    getLayerElement: (): Handle => el,
                    getDismissMode:  () => 'click-outside' as const,
                    requestClose:    (): void => {},
                    onActivate:      (): void => {},
                    onZIndexChanged: (): void => {},
                };

                DOM.sink.appendChild(el, field);
                LayerManager.register(layer);
                layers.push(layer);
                DOM.sink.focus(field);

                return field;
            }

            it('X1: focus in a layer opened from the window counts as inside on a raise', () => {
                installTestDOM(CONFIG);

                const layout = collectLayoutCallbacks();

                focusedOpener();

                const win   = shown(new Window('W'), layout);
                const field = focusedChildLayer();
                const focus = vi.spyOn(DOM.sink, 'focus');

                win.bringToFront();

                expect(focus).not.toHaveBeenCalled();
                expect(active()).toBe(field);
            });

            it('X2: focus in a layer opened from the window returns to the opener on close', () => {
                installTestDOM(CONFIG);

                const layout = collectLayoutCallbacks();

                reduceMotion();

                const { openerEl } = focusedOpener();
                const win = track(new Window('W'));

                win.show();
                layout.run();
                focusedChildLayer();
                win.requestClose();

                expect(active()).toBe(openerEl);
            });
        });

        it('R7: restore() focuses a minimized window, and closing returns focus', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            reduceMotion();

            const { openerEl } = focusedOpener();
            const win = shown(new Window('W', { autoFocus: false }), layout);

            win.setWindowState('minimized');
            win.restore();

            expect(active()).toBe(win.getElement());

            win.requestClose();

            expect(active()).toBe(openerEl);
        });
    });

    describe('closing', () => {
        function openedWindow(layout: { run(): void }, options: { autoFocus?: boolean } = {}): { win: Window; opener: Button; openerEl: Handle } {
            const { opener, openerEl } = focusedOpener();
            const win = track(new Window('W', options));

            win.show();
            layout.run();

            return { win, opener, openerEl };
        }

        it('C1: focus returns to the opener after the window has left the layer tree', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            reduceMotion();

            const { win, openerEl } = openedWindow(layout);
            const unregister = vi.spyOn(LayerManager, 'unregister');
            const focus      = vi.spyOn(DOM.sink, 'focus');

            win.requestClose();

            expect(active()).toBe(openerEl);
            expect(focus).toHaveBeenCalledWith(openerEl, { preventScroll: true });
            expect(unregister.mock.invocationCallOrder[0])
                .toBeLessThan(focus.mock.invocationCallOrder[0]);
        });

        it('C2: focus that moved to the page is left alone', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            reduceMotion();

            const { win } = openedWindow(layout);
            const other   = pageElement();

            DOM.sink.focus(other);

            const focus = vi.spyOn(DOM.sink, 'focus');

            win.requestClose();

            expect(focus).not.toHaveBeenCalled();
            expect(active()).toBe(other);
        });

        it('C3: an opener that left the page is skipped without throwing', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            reduceMotion();

            const { win, openerEl } = openedWindow(layout);

            setConnected(openerEl, false);

            const focus = vi.spyOn(DOM.sink, 'focus');

            expect(() => win.requestClose()).not.toThrow();
            expect(focus).not.toHaveBeenCalledWith(openerEl, expect.anything());
        });

        it('C3b: an opener that was disposed is skipped without touching its handle', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            reduceMotion();

            const { win, opener, openerEl } = openedWindow(layout);

            // Models production's failure for a released handle: the modelled
            // focus never resolves the handle, so without this the unguarded
            // code would not throw here.
            const focus = vi.spyOn(DOM.sink, 'focus').mockImplementation((handle) => {
                const registered = DOM.source.isRegistered(handle);

                if (!registered) {
                    throw new Error(`DOM handle ${handle} is not registered`);
                }
            });

            opener.dispose();

            expect(() => win.requestClose()).not.toThrow();
            expect(focus).not.toHaveBeenCalledWith(openerEl, expect.anything());
        });

        it('C8: a "close" listener that moves focus has the last word', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            reduceMotion();

            const { win } = openedWindow(layout);
            const other   = pageElement();

            win.on('close', () => DOM.sink.focus(other));
            win.requestClose();

            expect(active()).toBe(other);
        });

        it('C4: disposing is not a close and returns no focus', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            const { win, openerEl } = openedWindow(layout);
            const focus = vi.spyOn(DOM.sink, 'focus');

            win.dispose();

            expect(focus).not.toHaveBeenCalledWith(openerEl, expect.anything());
        });

        it('C5: a vetoed close keeps focus and the stored opener', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            reduceMotion();

            const { win, openerEl } = openedWindow(layout);
            const veto = (controller: { preventDefault(): void }): void => controller.preventDefault();

            win.on('beforeclose', veto);

            const focus = vi.spyOn(DOM.sink, 'focus');

            win.requestClose();

            expect(focus).not.toHaveBeenCalled();
            expect(active()).toBe(win.getElement());

            win.off('beforeclose', veto);
            win.requestClose();

            expect(active()).toBe(openerEl);
        });

        it('C6: a window that never took focus returns none', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            reduceMotion();

            const { win } = openedWindow(layout, { autoFocus: false });
            const focus   = vi.spyOn(DOM.sink, 'focus');

            win.requestClose();

            expect(focus).not.toHaveBeenCalled();
        });

        it('C7: a raise refreshes the place to return to', () => {
            installTestDOM(CONFIG);

            const layout = collectLayoutCallbacks();

            reduceMotion();

            const { win } = openedWindow(layout);
            const other   = pageElement();

            DOM.sink.focus(other);
            win.bringToFront();
            win.requestClose();

            expect(active()).toBe(other);
        });
    });
});
