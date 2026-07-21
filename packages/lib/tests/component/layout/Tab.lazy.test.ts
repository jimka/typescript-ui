// Coverage for registering a lazy tab through the container path —
// container.addComponent(factory, constraints) — rather than the addLazyTab
// helper on the layout manager.
//
// A deferred entry deliberately adds NO container child until it materializes:
// that is what keeps doLayout's ownership sweep from minting a second,
// id-labelled tab beside the real one.
//
// The host is intentionally not given an element/size, matching Tab.test.ts —
// registration and active-index state resolve without a layout pass. Anything
// past the two-frame yield is not assertable here: the recording sink records
// requestAnimationFrame callbacks and drops them, so the factory never runs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Tab } from '~/layout/Tab';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
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

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/**
 * Builds a Tab-managed container.
 *
 * @returns The container and its Tab manager.
 */
function hostTab(): { host: Container; tab: Tab } {
    const tab  = new Tab();
    const host = new Container({ layoutManager: tab });

    return { host, tab };
}

/**
 * Builds a constraints object carrying the given fields.
 *
 * @param fields - Constraint fields to apply.
 * @returns A LayoutConstraints instance.
 */
function constraints(fields: Partial<LayoutConstraints>): LayoutConstraints {
    return Object.assign(new LayoutConstraints(), fields);
}

/**
 * Counts registered tabs by clamping the active index past the end.
 *
 * @param tab - The Tab manager to count.
 * @returns The number of registered tabs.
 */
function tabCount(tab: Tab): number {
    tab.setActiveTabIndex(99);

    const last = tab.getActiveTabIndex();

    return last < 0 ? 0 : last + 1;
}

describe('Tab deferred registration', () => {

    it('registers a tab without running the factory or adding a child', () => {
        const { host, tab } = hostTab();
        let ran = false;

        host.addComponent(() => { ran = true; return new Component(); }, constraints({ name: 'Heavy' }));

        expect(ran).toBe(false);
        expect(host.getComponents()).toEqual([]);
        expect(tabCount(tab)).toBe(1);
        expect(tab.getActiveTabLabel()).toBe('Heavy');
    });

    it('falls back to the minted tab id when no name is given', () => {
        const { host, tab } = hostTab();

        host.addComponent(() => new Component());

        tab.setActiveTabIndex(0);

        expect(tab.getActiveTabLabel()).toBe('tab-0');
    });

    it('registers an async factory identically, without running it', () => {
        const { host, tab } = hostTab();
        let ran = false;

        host.addComponent(async () => { ran = true; return new Component(); }, constraints({ name: 'Async' }));

        expect(ran).toBe(false);
        expect(host.getComponents()).toEqual([]);
        expect(tabCount(tab)).toBe(1);
        expect(tab.getActiveTabLabel()).toBe('Async');
    });

    it('builds immediately when lazy is declined', () => {
        const { host } = hostTab();
        const built    = new Component();

        host.addComponent(() => built, constraints({ lazy: false, name: 'Eager' }));

        expect(host.getComponents()).toEqual([built]);
    });

    it('mints exactly one tab after a layout pass, not a phantom beside it', () => {
        const { host, tab } = hostTab();

        host.addComponent(() => new Component(), constraints({ name: 'Heavy' }));
        host.doLayout();

        // A deferred entry owns no container child, so the ownership sweep has
        // nothing to mint a second tab for.
        expect(tabCount(tab)).toBe(1);
    });

    it('still registers through the addLazyTab alias', () => {
        const { host, tab } = hostTab();
        let ran = false;

        tab.attach(host);
        tab.addLazyTab(() => { ran = true; return new Component(); }, 'Legacy');

        expect(ran).toBe(false);
        expect(tabCount(tab)).toBe(1);
        expect(tab.getActiveTabLabel()).toBe('Legacy');
    });

    it('leaves a caller-owned constraints object unmutated', () => {
        const { host, tab } = hostTab();
        const shared        = constraints({ closeable: true });

        tab.attach(host);
        tab.addLazyTab(() => new Component(), 'Legacy', shared);

        expect(shared.name).toBeNull();
    });
});

describe('Tab order across interleaved eager and lazy adds', () => {

    /**
     * Reads every tab's label in order.
     *
     * @param tab - The Tab manager to read.
     * @returns The labels, in tab order.
     */
    function labels(tab: Tab): Array<string | null> {
        const out: Array<string | null> = [];

        for (let i = 0; i < tabCount(tab); i++) {
            tab.setActiveTabIndex(i);
            out.push(tab.getActiveTabLabel());
        }

        return out;
    }

    it('eager then lazy keeps call order', () => {
        const { host, tab } = hostTab();
        const a = new Component({ name: 'A' });

        host.addComponent(a);
        host.addComponent(() => new Component(), constraints({ name: 'B' }));

        expect(labels(tab)).toEqual(['A', 'B']);
    });

    it('lazy then eager keeps call order', () => {
        const { host, tab } = hostTab();
        const a = new Component({ name: 'A' });

        host.addComponent(() => new Component(), constraints({ name: 'B' }));
        host.addComponent(a);
        host.doLayout();

        expect(labels(tab)).toEqual(['B', 'A']);
    });

    it('eager, lazy, eager keeps call order', () => {
        const { host, tab } = hostTab();
        const a = new Component({ name: 'A' });
        const c = new Component({ name: 'C' });

        host.addComponent(a);
        host.addComponent(() => new Component(), constraints({ name: 'B' }));
        host.addComponent(c);
        host.doLayout();

        expect(labels(tab)).toEqual(['A', 'B', 'C']);
    });
});

describe('Tab lazy activation', () => {

    it('mounts the spinner without building the content', () => {
        const { host, tab } = hostTab();
        let ran = false;

        host.getElement(true);
        host.addComponent(() => { ran = true; return new Component(); }, constraints({ name: 'Heavy' }));

        tab.setActiveTabIndex(0);

        // The spinner mount precedes the two-frame yield, so it is observable
        // synchronously; the factory call sits inside the yield and is not.
        expect(host.getComponents()).toHaveLength(1);
        expect(ran).toBe(false);
    });

    it('mounts the spinner identically for an async factory', () => {
        const { host, tab } = hostTab();
        let ran = false;

        host.getElement(true);
        host.addComponent(async () => { ran = true; return new Component(); }, constraints({ name: 'Async' }));

        tab.setActiveTabIndex(0);

        expect(host.getComponents()).toHaveLength(1);
        expect(ran).toBe(false);
    });
});
