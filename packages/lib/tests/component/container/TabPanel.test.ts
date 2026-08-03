import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { TabPanel } from '~/component/container/TabPanel';
import { Tab } from '~/layout/Tab';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('TabPanel wiring', () => {
    afterEach(() => DOM.reset());

    it('owns a Tab layout manager reachable via getTab', () => {
        installTestDOM(CONFIG);

        const panel = new TabPanel();

        expect(panel.getTab()).toBeInstanceOf(Tab);
        expect(panel.getLayoutManager()).toBe(panel.getTab());
    });

    it('maps the tabs config 1:1 to addComponent calls', () => {
        installTestDOM(CONFIG);

        const a = new Component();
        const b = new Component();

        const panel = new TabPanel({
            tabs: [
                { label: 'Alpha', component: a },
                { label: 'Beta',  component: b, closeable: true },
            ],
        });

        // Each tab entry maps to one content component in the child list.
        const children = panel.getComponents();

        expect(children).toContain(a);
        expect(children).toContain(b);
        expect(children.length).toBe(2);
    });

    it('addTab is chainable and adds the content component', () => {
        installTestDOM(CONFIG);

        const panel = new TabPanel();
        const c     = new Component();

        expect(panel.addTab(c, 'Gamma')).toBe(panel);
        expect(panel.getComponents()).toContain(c);
    });

    it('addLazyTab is chainable without forcing the factory', () => {
        installTestDOM(CONFIG);

        const panel = new TabPanel();
        let   built = false;

        const result = panel.addLazyTab(() => {
            built = true;

            return new Component();
        }, 'Lazy', { closeable: true });

        expect(result).toBe(panel);

        // The factory must not run until first activation; registering the lazy
        // tab alone does not build its content.
        expect(built).toBe(false);
    });

    it('addTab defers a factory without building it', () => {
        installTestDOM(CONFIG);

        const panel = new TabPanel();
        let built   = false;

        const result = panel.addTab(() => { built = true; return new Component(); }, 'Lazy');

        expect(result).toBe(panel);
        expect(built).toBe(false);
        expect(panel.getComponents()).toEqual([]);
    });

    it('honours lazy on a tabs-bag entry', () => {
        installTestDOM(CONFIG);

        let lazyBuilt  = false;
        const lazy     = new TabPanel({
            tabs: [{ label: 'L', component: () => { lazyBuilt = true; return new Component(); } }],
        });

        expect(lazyBuilt).toBe(false);
        expect(lazy.getComponents()).toEqual([]);

        let eagerBuilt = false;
        const eager    = new TabPanel({
            tabs: [{ label: 'E', component: () => { eagerBuilt = true; return new Component(); }, lazy: false }],
        });

        expect(eagerBuilt).toBe(true);
        expect(eager.getComponents()).toHaveLength(1);
    });

    it('forwards disposeOnClose from addTab options into the layout constraint', () => {
        installTestDOM(CONFIG);

        const panel = new TabPanel();
        const c     = new Component();

        panel.addTab(c, 'Gamma', { disposeOnClose: false });

        expect(panel.getLayoutConstraints(c)?.disposeOnClose).toBe(false);
    });

    it('forwards disposeOnClose from a tabs-bag entry into the layout constraint', () => {
        installTestDOM(CONFIG);

        const c = new Component();
        const panel = new TabPanel({
            tabs: [{ label: 'Alpha', component: c, disposeOnClose: false }],
        });

        expect(panel.getLayoutConstraints(c)?.disposeOnClose).toBe(false);
    });

    it('registers onTabClose on the wrapped manager without throwing', () => {
        installTestDOM(CONFIG);

        // The tabclose event fires from a real close-button click (Tier 3), so
        // offline we assert the constructor wiring registers the listener
        // without throwing.
        expect(() => new TabPanel({
            tabs:       [{ label: 'Alpha', component: new Component(), closeable: true }],
            onTabClose: () => {},
        })).not.toThrow();
    });
});
