// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// modal-dialog-focus-trap plan, Expected Behaviour "Scope and inert",
// "containTab" and "Layers". LayerManager owns modality: it decides which
// layer is the topmost modal, tells every other surface to go inert, and wraps
// Tab at the edges of the modal's scope. The modelled test DOM does not make
// an inert element refuse focus, so what is pinned here is who is told what;
// the browser's own refusal is in the plan's manual cases.
import { describe, it, expect, afterEach, vi, type Mock } from 'vitest';
import { LayerManager, type BackgroundSurface, type DismissableLayer, type LayerDismissMode } from '~/core/LayerManager';
import { DOM, type Handle } from '~/core/DOM';
import { FOCUSABLE_SELECTOR } from '~/core/Focusable';
import { _Dialog as Dialog } from '~/overlay/Dialog';
import { Drawer } from '~/overlay/Drawer';
import { _Menu as Menu } from '~/overlay/Menu';
import { _Window as Window } from '~/overlay/Window';
import { Popover } from '~/overlay/Popover';
import { PopupPanel } from '~/overlay/PopupPanel';
import { Tooltip } from '~/overlay/Tooltip';
import { makeEvent, setQuerySelectorAllResult, setRenderedVisible, type RecordingDOMSink } from '../dom/TestDOM';

interface FakeLayer extends DismissableLayer {
    onInertChanged: Mock<(inert: boolean) => void>;
    requestClose:   Mock<() => boolean | void>;
    element:        Handle | null;
}

interface FakeLayerOpts {
    dismissMode?: LayerDismissMode;
    isRoot?:      boolean;
    withElement?: boolean;
    anchor?:      Handle | null;
}

// Tracks every layer registered and surface added, so the draining afterEach
// can remove them — LayerManager is a module singleton and leaks state between
// tests otherwise.
const registered: DismissableLayer[]  = [];
const surfaces:   BackgroundSurface[] = [];

function fakeLayer(opts: FakeLayerOpts = {}): FakeLayer {
    const element: Handle | null = opts.withElement === false
        ? null
        : DOM.sink.createElement('div');

    const layer: FakeLayer = {
        element,
        getLayerElement: () => element,
        getDismissMode:  () => opts.dismissMode ?? 'click-outside',
        requestClose:    vi.fn<() => boolean | void>(),
        onInertChanged:  vi.fn<(inert: boolean) => void>(),
    };

    if (opts.isRoot !== undefined) {
        layer.isLayerRoot = () => opts.isRoot!;
    }

    if (opts.anchor !== undefined) {
        layer.getAnchorElement = () => opts.anchor!;
    }

    return layer;
}

/** A modal fake layer. */
function modalLayer(): FakeLayer {
    return fakeLayer({ dismissMode: 'modal' });
}

function register<T extends DismissableLayer>(layer: T): T {
    LayerManager.register(layer);
    registered.push(layer);

    return layer;
}

function unregister(layer: DismissableLayer): void {
    LayerManager.unregister(layer);
}

/** A background surface whose hook is a spy, tracked for the drain. */
function addSurface(): { onInertChanged: Mock<(inert: boolean) => void> } {
    const surface = { onInertChanged: vi.fn<(inert: boolean) => void>() };

    LayerManager.addBackgroundSurface(surface);
    surfaces.push(surface);

    return surface;
}

/** The value the hook was last called with. */
function last(layer: { onInertChanged: Mock<(inert: boolean) => void> }): boolean | undefined {
    return layer.onInertChanged.mock.lastCall?.[0];
}

/** Appends a fresh element to `parent` and returns it. */
function child(parent: Handle, tag: string = 'button'): Handle {
    const handle = DOM.sink.createElement(tag);

    DOM.sink.appendChild(parent, handle);

    return handle;
}

/** Seeds `layer`'s FOCUSABLE_SELECTOR matches with `count` fresh buttons, in order. */
function seedStops(layer: FakeLayer, count: number): Handle[] {
    const stops = Array.from({ length: count }, () => child(layer.element!));

    setQuerySelectorAllResult(layer.element!, FOCUSABLE_SELECTOR, stops);

    return stops;
}

function tabEvent(shiftKey: boolean = false, defaultPrevented: boolean = false): KeyboardEvent {
    return { key: 'Tab', shiftKey, defaultPrevented } as unknown as KeyboardEvent;
}

const CONSUMED = { stop: true, prevent: true };

/** Every element an `inert` attribute was written to, in order. */
function inertWrites(): Handle[] {
    const sink = DOM.sink as unknown as RecordingDOMSink;

    return sink.writes
        .filter(write => write.op === 'apply'
            && (write.args[1] as { setAttr?: Record<string, string> }).setAttr?.inert !== undefined)
        .map(write => write.args[0] as Handle);
}

afterEach(() => {
    // Drain in reverse registration order; unregister is idempotent.
    for (let i = registered.length - 1; i >= 0; i--) {
        LayerManager.unregister(registered[i]);
    }

    registered.length = 0;

    for (const surface of surfaces) {
        LayerManager.removeBackgroundSurface(surface);
    }

    surfaces.length = 0;

    // A Window attaches a tooltip, whose static pointer watch pins a viewport
    // listener across the DOM reset.
    Tooltip._stopPointerWatch();
    Menu._stopInputWatch();
    vi.restoreAllMocks();
});

describe('LayerManager — modal scope and inert', () => {
    it('I1: a modal makes an earlier root layer and the page inert, and stays live itself', () => {
        const page = addSurface();
        const a    = register(fakeLayer({ isRoot: true }));
        const m    = register(modalLayer());

        expect(last(page)).toBe(true);
        expect(last(a)).toBe(true);
        expect(last(m)).toBe(false);
    });

    it('I2: a layer opened from the modal is in its scope', () => {
        const m = register(modalLayer());
        const c = register(fakeLayer());

        expect(last(c)).toBe(false);
        expect(last(m)).toBe(false);
    });

    it('I3: closing the modal makes everything live again', () => {
        const page = addSurface();
        const a    = register(fakeLayer({ isRoot: true }));
        const m    = register(modalLayer());

        unregister(m);

        expect(last(page)).toBe(false);
        expect(last(a)).toBe(false);
    });

    it('I4: the topmost of two modals owns the scope, and hands it back when it closes', () => {
        const page = addSurface();
        const m1   = register(modalLayer());
        const m2   = register(modalLayer());

        expect(last(m1)).toBe(true);
        expect(last(m2)).toBe(false);

        unregister(m2);

        expect(last(m1)).toBe(false);
        expect(last(page)).toBe(true);

        unregister(m1);

        expect(last(page)).toBe(false);
    });

    it('I5: a root layer shown while a modal is open comes up inert', () => {
        register(modalLayer());

        const w = register(fakeLayer({ isRoot: true, dismissMode: 'manual' }));

        expect(w.onInertChanged).toHaveBeenCalledTimes(1);
        expect(last(w)).toBe(true);
    });

    it('I6: non-modal layers never make anything inert', () => {
        const page = addSurface();
        const a    = register(fakeLayer({ isRoot: true }));
        const b    = register(fakeLayer());

        unregister(b);
        unregister(a);

        const calls = [...page.onInertChanged.mock.calls, ...a.onInertChanged.mock.calls, ...b.onInertChanged.mock.calls];

        expect(calls.length).toBeGreaterThan(0);
        expect(calls.every(([inert]) => inert === false)).toBe(true);
    });

    it('I7: a background surface follows the modal state, from the moment it is added', () => {
        const surface = addSurface();

        expect(surface.onInertChanged.mock.calls).toEqual([[false]]);

        const m = register(modalLayer());

        expect(last(surface)).toBe(true);

        unregister(m);

        expect(last(surface)).toBe(false);

        const callsBeforeRemoval = surface.onInertChanged.mock.calls.length;

        LayerManager.removeBackgroundSurface(surface);
        register(modalLayer());

        expect(surface.onInertChanged).toHaveBeenCalledTimes(callsBeforeRemoval);

        // Added while a modal is registered: told at once.
        const late = addSurface();

        expect(late.onInertChanged.mock.calls).toEqual([[true]]);
    });

    it('I8: isBehindModal and hasModalLayer read the same scope', () => {
        const a = register(fakeLayer({ isRoot: true }));

        expect(LayerManager.hasModalLayer()).toBe(false);
        expect(LayerManager.isBehindModal(child(a.element!))).toBe(false);

        const m = register(modalLayer());
        const c = register(fakeLayer());

        expect(LayerManager.hasModalLayer()).toBe(true);
        expect(LayerManager.isBehindModal(child(m.element!))).toBe(false);
        expect(LayerManager.isBehindModal(child(c.element!))).toBe(false);
        expect(LayerManager.isBehindModal(child(a.element!))).toBe(true);
        expect(LayerManager.isBehindModal(null)).toBe(false);
    });

    it('I9: a layer without the hook is tolerated', () => {
        const page   = addSurface();
        const modal: DismissableLayer = {
            getLayerElement: () => null,
            getDismissMode:  () => 'modal',
            requestClose:    () => undefined,
        };
        const plain: DismissableLayer = {
            getLayerElement: () => null,
            getDismissMode:  () => 'click-outside',
            requestClose:    () => undefined,
        };

        expect(() => {
            register(modal);
            register(plain);
        }).not.toThrow();
        expect(last(page)).toBe(true);
    });

    it('never writes inert itself: fake layers that write nothing leave no inert in the document', () => {
        addSurface();
        register(fakeLayer({ isRoot: true }));
        register(modalLayer());

        // The manager decides and each surface writes its own element. In
        // particular nothing is written to <body> or <html>, so whatever a
        // browser extension injects beside the library's containers stays live.
        expect(inertWrites()).toEqual([]);
    });

    it('does not call the hook of the layer being unregistered', () => {
        const m = register(modalLayer());

        m.onInertChanged.mockClear();
        unregister(m);

        expect(m.onInertChanged).not.toHaveBeenCalled();
    });

    // A context menu shown at pointer coordinates names no anchor. With a
    // window shown after the dialog it used to link under that window — the
    // last-registered layer — and so come up inert inside the dialog it was
    // opened in. Everything outside the scope is inert, so a layer that opens
    // now was opened from inside it.
    it('a layer with no anchor opened while a later root layer is behind the modal links into the scope', () => {
        const m = register(modalLayer());
        const w = register(fakeLayer({ isRoot: true, dismissMode: 'manual' }));
        const c = register(fakeLayer());

        expect(last(w)).toBe(true);
        expect(last(c)).toBe(false);
        expect(LayerManager.isBehindModal(child(c.element!))).toBe(false);

        // ...and it is the modal it hangs under: closing the window behind
        // does not take it along, and it joins the modal's Tab ring.
        const [a]  = seedStops(m, 1);
        const [x]  = seedStops(c, 1);

        DOM.sink.focus(a);

        expect(LayerManager.containTab(tabEvent())).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(x);
    });

    it('with no modal open a layer with no anchor still links under the last-registered layer', () => {
        const a = register(fakeLayer({ isRoot: true }));
        const b = register(fakeLayer());

        expect(LayerManager.containsAcrossLayers(a, child(b.element!))).toBe(true);
    });

    it('a dropdown anchored inside a modal that is not the last-registered layer is still in scope', () => {
        const m      = register(modalLayer());
        const anchor = child(m.element!);
        const w      = register(fakeLayer({ isRoot: true, dismissMode: 'manual' }));
        const c      = register(fakeLayer({ anchor }));

        expect(last(w)).toBe(true);
        expect(last(c)).toBe(false);
    });
});

describe('LayerManager.containTab', () => {
    it('T1: does nothing when no modal is registered', () => {
        const a      = register(fakeLayer({ isRoot: true }));
        const [x, y] = seedStops(a, 2);

        DOM.sink.focus(y);

        expect(LayerManager.containTab(tabEvent())).toBeUndefined();
        expect(DOM.source.getActiveElement()).toBe(y);
        expect(x).not.toBe(y);
    });

    it('T2: Tab on the last stop wraps to the first', () => {
        const m         = register(modalLayer());
        const [a, , c]  = seedStops(m, 3);

        DOM.sink.focus(c);

        expect(LayerManager.containTab(tabEvent())).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(a);
    });

    it('T3: Shift+Tab on the first stop wraps to the last', () => {
        const m         = register(modalLayer());
        const [a, , c]  = seedStops(m, 3);

        DOM.sink.focus(a);

        expect(LayerManager.containTab(tabEvent(true))).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(c);
    });

    it('T4: a middle stop is left to the browser', () => {
        const m      = register(modalLayer());
        const [, b]  = seedStops(m, 3);

        DOM.sink.focus(b);

        expect(LayerManager.containTab(tabEvent())).toBeUndefined();
        expect(LayerManager.containTab(tabEvent(true))).toBeUndefined();
        expect(DOM.source.getActiveElement()).toBe(b);
    });

    it('T5: a scope with no stop consumes the key and moves nothing', () => {
        const m = register(modalLayer());

        DOM.sink.focus(m.element!);

        expect(LayerManager.containTab(tabEvent())).toEqual(CONSUMED);
        expect(LayerManager.containTab(tabEvent(true))).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(m.element);
    });

    // The page is inert, but an element that is not the library's stays live:
    // a browser extension's menu. Holding its Tab would strand the keyboard
    // there, with nothing in the dialog to move to either.
    it('T5b: a scope with no stop leaves a Tab pressed on an element outside it alone', () => {
        register(modalLayer());

        const body    = DOM.source.getBody();
        const foreign = DOM.sink.createElement('button');

        vi.spyOn(DOM.source, 'getBody').mockReturnValue(body);
        DOM.sink.appendChild(body, foreign);
        DOM.sink.focus(foreign);

        expect(LayerManager.containTab(tabEvent())).toBeUndefined();
        expect(DOM.source.getActiveElement()).toBe(foreign);

        // With nothing focused the browser reports <body>: still held.
        DOM.sink.focus(body);

        expect(LayerManager.containTab(tabEvent())).toEqual(CONSUMED);
    });

    it('T6: focus on <body>, or on an element outside the modal, is left to the browser', () => {
        const m       = register(modalLayer());
        const body    = DOM.source.getBody();
        const outside = DOM.sink.createElement('button');

        seedStops(m, 3);

        DOM.sink.focus(body);

        expect(LayerManager.containTab(tabEvent())).toBeUndefined();
        expect(DOM.source.getActiveElement()).toBe(body);

        DOM.sink.focus(outside);

        expect(LayerManager.containTab(tabEvent())).toBeUndefined();
        expect(DOM.source.getActiveElement()).toBe(outside);
    });

    it('T7: a hidden last match is not a stop', () => {
        const m         = register(modalLayer());
        const [a, b, h] = seedStops(m, 3);

        setRenderedVisible(h, false);
        DOM.sink.focus(b);

        expect(LayerManager.containTab(tabEvent())).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(a);
    });

    it('T8: a disabled last match is not a stop', () => {
        const m         = register(modalLayer());
        const [a, b, c] = seedStops(m, 3);

        DOM.sink.edit(c).attr('disabled', '').commit();
        DOM.sink.focus(b);

        expect(LayerManager.containTab(tabEvent())).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(a);
    });

    it('T9: a layer opened from the modal joins the ring after it', () => {
        const m      = register(modalLayer());
        const [a, b] = seedStops(m, 2);
        const c      = register(fakeLayer());
        const [x, y] = seedStops(c, 2);

        DOM.sink.focus(b);
        expect(LayerManager.containTab(tabEvent())).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(x);

        DOM.sink.focus(y);
        expect(LayerManager.containTab(tabEvent())).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(a);

        DOM.sink.focus(a);
        expect(LayerManager.containTab(tabEvent(true))).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(y);

        DOM.sink.focus(x);
        expect(LayerManager.containTab(tabEvent(true))).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(b);

        // Inside one layer the browser's own order is used.
        DOM.sink.focus(x);
        expect(LayerManager.containTab(tabEvent())).toBeUndefined();
        expect(DOM.source.getActiveElement()).toBe(x);
    });

    it('T10: a child layer with no stop is skipped', () => {
        const m      = register(modalLayer());
        const [a, b] = seedStops(m, 2);

        register(fakeLayer());

        DOM.sink.focus(b);

        expect(LayerManager.containTab(tabEvent())).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(a);
    });

    // A dropdown stays registered while it fades out, so it keeps its place in
    // the stack. Its controls are about to leave the document: focus moved
    // onto one would be dropped on <body> when the fade ends.
    it('T10b: a layer that has begun closing is left out of the ring', () => {
        const m      = register(modalLayer());
        const [a, b] = seedStops(m, 2);
        const c      = register(fakeLayer());
        const [x]    = seedStops(c, 1);

        let closing = false;

        c.isLayerClosing = () => closing;

        DOM.sink.focus(b);
        expect(LayerManager.containTab(tabEvent())).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(x);

        closing = true;

        DOM.sink.focus(b);
        expect(LayerManager.containTab(tabEvent())).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(a);

        DOM.sink.focus(a);
        expect(LayerManager.containTab(tabEvent(true))).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(b);

        // It still counts as inside the modal for everything else.
        expect(LayerManager.isBehindModal(x)).toBe(false);
        expect(last(c)).toBe(false);
    });

    it('T11: a Tab-key owner inside the modal keeps its Tab; the modal\'s own mark does not count', () => {
        const m     = register(modalLayer());
        const first = child(m.element!);
        const owner = child(m.element!, 'div');
        const inner = child(owner, 'div');
        const plain = child(m.element!);

        DOM.sink.edit(m.element!).attr('data-ts-ui-tab-key-owner', 'true').commit();
        DOM.sink.edit(owner).attr('data-ts-ui-tab-key-owner', 'true').commit();

        setQuerySelectorAllResult(m.element!, FOCUSABLE_SELECTOR, [first, plain, inner]);
        DOM.sink.focus(inner);

        expect(LayerManager.containTab(tabEvent())).toBeUndefined();
        expect(DOM.source.getActiveElement()).toBe(inner);

        setQuerySelectorAllResult(m.element!, FOCUSABLE_SELECTOR, [first, inner, plain]);
        DOM.sink.focus(plain);

        expect(LayerManager.containTab(tabEvent())).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(first);
    });

    it('T12: a key an earlier listener already handled is left alone', () => {
        const m        = register(modalLayer());
        const [, , c]  = seedStops(m, 3);

        DOM.sink.focus(c);

        expect(LayerManager.containTab(tabEvent(false, true))).toBeUndefined();
        expect(DOM.source.getActiveElement()).toBe(c);
    });

    // Ctrl+Tab, Alt+Tab and Cmd+Tab switch tabs, windows and applications.
    // They are not focus traversal, so where one does reach the page — a
    // webview shell — the wrap must not take it.
    it('T12b: a Tab pressed with Control, Alt or Meta is left alone', () => {
        const m       = register(modalLayer());
        const [, , c] = seedStops(m, 3);

        DOM.sink.focus(c);

        for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
            const chord = { key: 'Tab', shiftKey: false, defaultPrevented: false, [modifier]: true } as unknown as KeyboardEvent;

            expect(LayerManager.containTab(chord)).toBeUndefined();
        }

        expect(DOM.source.getActiveElement()).toBe(c);
    });

    it('T13: a single stop holds focus', () => {
        const m   = register(modalLayer());
        const [a] = seedStops(m, 1);

        DOM.sink.focus(a);

        expect(LayerManager.containTab(tabEvent())).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(a);
    });

    it('T14: with two modals the ring is the topmost one\'s', () => {
        const m1 = register(modalLayer());

        seedStops(m1, 2);

        const m2     = register(modalLayer());
        const [p, q] = seedStops(m2, 2);

        DOM.sink.focus(q);

        expect(LayerManager.containTab(tabEvent())).toEqual(CONSUMED);
        expect(DOM.source.getActiveElement()).toBe(p);
    });

    it('T15: the manager\'s own keydown listener wraps a real Tab', () => {
        const m        = register(modalLayer());
        const [a, , c] = seedStops(m, 3);

        DOM.sink.focus(c);

        const event = makeEvent(c, 'keydown', { key: 'Tab' });
        const prevent = vi.spyOn(event, 'preventDefault');

        DOM.sink.dispatchEvent(DOM.source.getWindow(), event);

        expect(DOM.source.getActiveElement()).toBe(a);
        expect(prevent).toHaveBeenCalledTimes(1);
    });

    it('T16: focus on the modal\'s own element, which is not a stop, is left to the browser', () => {
        const m = register(modalLayer());

        seedStops(m, 3);
        DOM.sink.focus(m.element!);

        expect(LayerManager.containTab(tabEvent())).toBeUndefined();
        expect(DOM.source.getActiveElement()).toBe(m.element);
    });

    it('still routes Escape to the topmost layer', () => {
        const m = register(modalLayer());

        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(m.element!, 'keydown', { key: 'Escape' }));

        expect(m.requestClose).toHaveBeenCalledTimes(1);
    });
});

// A layer disposed while it is still registered stays in the manager's tree
// with a released element. That went unnoticed while the manager only called a
// layer's hooks on a raise; now every modal that opens tells every registered
// layer to go inert, so the corpse would be written through, the write would
// throw, and the dialog being opened would never appear.
describe('A window disposed while shown leaves the layer tree', () => {
    it('is no longer registered, so the next modal layer opens cleanly', () => {
        const win = new Window('W');

        win.show();

        expect(LayerManager.getTopLayer()).toBe(win);

        win.dispose();

        expect(LayerManager.getTopLayer()).toBeNull();

        const page = addSurface();

        expect(() => register(modalLayer())).not.toThrow();
        expect(last(page)).toBe(true);
    });

    it('disposed under an open dialog, lets the dialog close and the page come back', async () => {
        vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} });

        const page   = addSurface();
        const win    = new Window('W');
        const dialog = new Dialog({ title: 'T', message: 'M' });

        win.show();

        let result: string | null = null;

        void dialog.show().then(value => { result = value; });

        expect(win.getInertAttribute()).toBe(true);

        win.dispose();

        expect(() => dialog.hide('confirm')).not.toThrow();

        await Promise.resolve();

        expect(result).toBe('confirm');
        expect(LayerManager.hasModalLayer()).toBe(false);
        expect(last(page)).toBe(false);
    });
});

describe('Layers mirror inert onto their own element', () => {
    const layers: Array<[string, () => { onInertChanged(inert: boolean): void; getInertAttribute(): boolean; dispose(): void }]> = [
        ['Dialog',     () => new Dialog({ title: 'T', message: 'M' })],
        ['Drawer',     () => new Drawer({ modal: true })],
        ['Menu',       () => new Menu()],
        ['Window',     () => new Window('W')],
        ['Popover',    () => new Popover()],
        ['PopupPanel', () => new PopupPanel()],
    ];

    it.each(layers)('L1: %s', (_name, make) => {
        const layer = make();

        layer.onInertChanged(true);

        expect(layer.getInertAttribute()).toBe(true);

        layer.onInertChanged(false);

        expect(layer.getInertAttribute()).toBe(false);

        layer.dispose();
    });
});
