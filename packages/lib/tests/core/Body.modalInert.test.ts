// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// modal-dialog-focus-trap plan, Implementation Notes "inert is never written
// to <body>". While a modal layer is open the application behind it must be
// inert, but the attribute goes on the application's root components — the
// children of `Body` — not on `<body>` or `<html>`. Whatever else lives in the
// document then stays usable: the inline menu a password manager injects next
// to a login dialog is the concrete case.
import { describe, it, expect, afterEach } from 'vitest';
import { Body } from '~/core/Body';
import { _Component as Component } from '~/core/Component';
import { DOM, type Handle } from '~/core/DOM';
import { LayerManager, type DismissableLayer } from '~/core/LayerManager';
import { Absolute } from '~/layout/Absolute';
import { Split } from '~/layout/Split';
import { Tab } from '~/layout/Tab';
import { installTestDOM, type RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const registered: DismissableLayer[] = [];

function modalLayer(): DismissableLayer {
    const layer: DismissableLayer = { getLayerElement: () => null, getDismissMode: () => 'modal', requestClose: () => {} };

    LayerManager.register(layer);
    registered.push(layer);

    return layer;
}

/**
 * The body singleton, bound to this case's DOM. The singleton outlives each
 * case's DOM, and `Body.init` is what rebinds its style and attribute buffers
 * to the current `<body>`; reaching it through `getInstance()` alone would
 * write the next attribute through a handle the previous reset released.
 */
function page(): Promise<Body> {
    return Body.init({});
}

/** Every element an `inert` attribute was written to. */
function inertTargets(sink: RecordingDOMSink): Handle[] {
    return sink.writes
        .filter(write => write.op === 'apply'
            && (write.args[1] as { setAttr?: Record<string, string> }).setAttr?.inert !== undefined)
        .map(write => write.args[0] as Handle);
}

afterEach(() => {
    for (let i = registered.length - 1; i >= 0; i--) {
        LayerManager.unregister(registered[i]);
    }

    registered.length = 0;

    // The singleton outlives the DOM reset below; children left on it would be
    // told to go inert, through released handles, by a later case's modal. A
    // manager left on it would keep its tab strip or gutters the same way.
    Body.getInstance().removeAllComponents();
    Body.getInstance().setLayoutManager(new Absolute());
    DOM.reset();
});

describe('Body — the application goes inert behind a modal layer', () => {
    it('P1: marks each root component, and never <body> or <html>', async () => {
        const sink = installTestDOM(CONFIG);
        const body = await page();
        const app  = new Component({});
        const side = new Component({});

        body.addComponent(app);
        body.addComponent(side);

        const modal = modalLayer();

        expect(app.getInertAttribute()).toBe(true);
        expect(side.getInertAttribute()).toBe(true);
        expect(body.getInertAttribute()).toBe(false);
        expect(inertTargets(sink).sort()).toEqual([app.getElement()!, side.getElement()!].sort());

        LayerManager.unregister(modal);

        expect(app.getInertAttribute()).toBe(false);
        expect(side.getInertAttribute()).toBe(false);
    });

    it('P2: a root component added while a modal layer is open is inert at once', async () => {
        installTestDOM(CONFIG);

        const body = await page();

        modalLayer();

        const late = new Component({});

        body.addComponent(late);

        expect(late.getInertAttribute()).toBe(true);
        expect(DOM.source.hasAttribute(late.getElement()!, 'inert')).toBe(true);
    });

    it('P3: a root component taken off the page is live again', async () => {
        installTestDOM(CONFIG);

        const body  = await page();
        const one   = new Component({});
        const two   = new Component({});
        const three = new Component({});

        body.addComponent(one);
        body.addComponent(two);
        body.addComponent(three);
        modalLayer();

        body.removeComponent(one);

        expect(one.getInertAttribute()).toBe(false);
        expect(two.getInertAttribute()).toBe(true);

        body.removeAllComponents();

        expect(two.getInertAttribute()).toBe(false);
        expect(three.getInertAttribute()).toBe(false);
    });

    it('P4: a replaced root component hands its state to its replacement', async () => {
        installTestDOM(CONFIG);

        const body   = await page();
        const before = new Component({});
        const after  = new Component({});

        body.addComponent(before);
        modalLayer();
        body.replaceComponent(before, after);

        expect(before.getInertAttribute()).toBe(false);
        expect(after.getInertAttribute()).toBe(true);
    });

    it('P5: a disposed root component still listed is skipped', async () => {
        installTestDOM(CONFIG);

        const body = await page();
        const gone = new Component({});
        const kept = new Component({});

        body.addComponent(gone);
        body.addComponent(kept);

        // dispose() does not unlink a component from its parent.
        gone.dispose();

        expect(() => modalLayer()).not.toThrow();
        expect(kept.getInertAttribute()).toBe(true);
        expect(gone.getInertAttribute()).toBe(false);
    });

    it('P5b: removing a disposed root component, alone or with the rest, writes nothing to it', async () => {
        installTestDOM(CONFIG);

        const body  = await page();
        const first = new Component({});
        const other = new Component({});

        body.addComponent(first);
        body.addComponent(other);
        modalLayer();

        first.dispose();

        expect(() => body.removeComponent(first)).not.toThrow();

        // disposeAllComponents() disposes every child, then removes them all.
        expect(() => body.disposeAllComponents()).not.toThrow();
        expect(body.getComponents()).toHaveLength(0);
    });

    it('P6: with two modal layers the page stays inert until the last one closes', async () => {
        installTestDOM(CONFIG);

        const body = await page();
        const app  = new Component({});

        body.addComponent(app);

        const outer = modalLayer();
        const inner = modalLayer();

        LayerManager.unregister(inner);

        expect(app.getInertAttribute()).toBe(true);

        LayerManager.unregister(outer);

        expect(app.getInertAttribute()).toBe(false);
    });

    it('P7: a non-modal layer leaves the page live', async () => {
        installTestDOM(CONFIG);

        const body = await page();
        const app  = new Component({});
        const menu: DismissableLayer = { getLayerElement: () => null, getDismissMode: () => 'click-outside', requestClose: () => {} };

        body.addComponent(app);
        LayerManager.register(menu);
        registered.push(menu);

        expect(app.getInertAttribute()).toBe(false);
    });

    // The body's layout manager mounts components of its own straight onto
    // <body>, beside the application's root components: a tab strip holds
    // buttons, and would stay focusable behind a dialog if only the children
    // were marked.
    it('P8: the tab strip a Tab manager mounts on the body goes inert too', async () => {
        installTestDOM(CONFIG);

        const body    = await page();
        const manager = new Tab();

        body.setLayoutManager(manager);
        body.addComponent(new Component({}));

        const [strip] = manager.getChromeComponents();
        const modal   = modalLayer();

        expect(strip.getInertAttribute()).toBe(true);

        LayerManager.unregister(modal);

        expect(strip.getInertAttribute()).toBe(false);
    });

    it('P8b: a manager given to the body while a modal layer is open has its chrome marked at once', async () => {
        installTestDOM(CONFIG);

        const body    = await page();
        const manager = new Tab();
        const modal   = modalLayer();

        // A Tab manager mounts its strip as it attaches, before any layout.
        body.setLayoutManager(manager);

        const [strip] = manager.getChromeComponents();

        expect(strip.getInertAttribute()).toBe(true);

        LayerManager.unregister(modal);

        expect(strip.getInertAttribute()).toBe(false);
    });

    it('P9: chrome a manager builds during a layout pass while a modal layer is open is inert after that pass', async () => {
        installTestDOM(CONFIG);

        const body    = await page();
        const manager = new Split();

        body.setLayoutManager(manager);
        modalLayer();

        body.addComponent(new Component({ preferredSize: { width: 50, height: 50 } }));
        body.addComponent(new Component({ preferredSize: { width: 50, height: 50 } }));

        // A Split builds its gutters when it lays out.
        expect(manager.getChromeComponents()).toHaveLength(0);

        body.doLayout();

        const gutters = manager.getChromeComponents();

        expect(gutters).toHaveLength(1);
        expect(gutters[0].getInertAttribute()).toBe(true);
    });

    it('P10: a layout pass with no modal layer open marks nothing', async () => {
        installTestDOM(CONFIG);

        const body    = await page();
        const manager = new Split();

        body.setLayoutManager(manager);
        body.addComponent(new Component({ preferredSize: { width: 50, height: 50 } }));
        body.addComponent(new Component({ preferredSize: { width: 50, height: 50 } }));
        body.doLayout();

        expect(manager.getChromeComponents()[0].getInertAttribute()).toBe(false);
    });
});
