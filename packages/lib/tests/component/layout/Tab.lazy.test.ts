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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// The recording sink records rAF callbacks and drops them, so the failure tests
// capture and drive them explicitly to reach past materialize's two-frame yield.
let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
    installTestDOM(CONFIG);
    rafQueue = [];
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation(cb => rafQueue.push(cb));
});

afterEach(() => {
    vi.restoreAllMocks();
    DOM.reset();
});

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

    // An empty strip still reports index 0, so the index alone cannot tell one
    // tab from none — the absent label is what distinguishes them.
    if (tab.getActiveTabLabel() === null) {
        return 0;
    }

    return tab.getActiveTabIndex() + 1;
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
        const { tab } = hostTab();
        let ran = false;

        tab.addLazyTab(() => { ran = true; return new Component(); }, 'Legacy');

        expect(ran).toBe(false);
        expect(tabCount(tab)).toBe(1);
        expect(tab.getActiveTabLabel()).toBe('Legacy');
    });

    it('defers even when the caller-supplied constraints decline lazy', () => {
        const { tab } = hostTab();
        let ran = false;

        // addLazyTab's whole contract is to defer, so a stray lazy:false on a
        // shared constraints object must not turn it into a silent no-op.
        tab.addLazyTab(() => { ran = true; return new Component(); }, 'Legacy', constraints({ lazy: false }));

        expect(ran).toBe(false);
        expect(tabCount(tab)).toBe(1);
        expect(tab.getActiveTabLabel()).toBe('Legacy');
    });

    it('leaves a caller-owned constraints object unmutated', () => {
        const { tab }       = hostTab();
        const shared        = constraints({ closeable: true });

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

describe('Tab deferred failure', () => {

    it('closes the tab and emits exception when the factory rejects', async () => {
        const { host, tab } = hostTab();
        const seen: Array<{ error: string; label: string }> = [];
        let reject: (e: unknown) => void = () => {};

        host.getElement(true);
        tab.on('exception', (error, label) => seen.push({ error: String(error), label }));

        host.addComponent(
            () => new Promise<Component>((_res, rej) => { reject = rej; }),
            constraints({ name: 'Heavy' }),
        );

        tab.setActiveTabIndex(0);
        rafQueue.splice(0).forEach(cb => cb(0));
        rafQueue.splice(0).forEach(cb => cb(0));

        reject(new Error('boom'));
        await Promise.resolve();
        await Promise.resolve();

        // The tab is gone from the strip before the event fires, and the
        // spinner it was holding goes with it.
        expect(seen).toEqual([{ error: 'Error: boom', label: 'Heavy' }]);
        expect(tabCount(tab)).toBe(0);
        expect(host.getComponents()).toEqual([]);
    });

    it('reports nothing when the tab was closed before the factory rejected', async () => {
        const { host, tab } = hostTab();
        const seen: unknown[] = [];
        let reject: (e: unknown) => void = () => {};

        host.getElement(true);
        tab.on('exception', error => seen.push(error));

        host.addComponent(
            () => new Promise<Component>((_res, rej) => { reject = rej; }),
            constraints({ name: 'Heavy' }),
        );

        tab.setActiveTabIndex(0);
        rafQueue.splice(0).forEach(cb => cb(0));
        rafQueue.splice(0).forEach(cb => cb(0));

        // Drop the entry the way a close does, while the factory is pending.
        (tab as unknown as { closeEntry(id: string): void }).closeEntry('tab-0');

        reject(new Error('boom'));
        await Promise.resolve();
        await Promise.resolve();

        expect(seen).toEqual([]);
        // The spinner the closed entry was holding must not survive as an
        // entry-unowned child, which the next layout pass would tab.
        expect(host.getComponents()).toEqual([]);
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

describe('Tab lazy activation events', () => {

    /**
     * Forces the reduced-motion branch so the materialize cross-fade completes
     * synchronously — its `onReady` is what a deferred activation rides on, and
     * offline there is no `transitionend` to end a real fade.
     */
    function useReducedMotion(): void {
        vi.spyOn(DOM.source, 'matchMedia').mockReturnValue({ matches: true, addChangeListener: () => {} });
    }

    /**
     * Drains the two frames the materialize helper yields before it runs the
     * factory.
     */
    function runYield(): void {
        rafQueue.splice(0).forEach(cb => cb(0));
        rafQueue.splice(0).forEach(cb => cb(0));
    }

    it('emits activate for a first-time lazy selection once it materializes', () => {
        const { host, tab } = hostTab();
        const eager = new Component({ name: 'Eager' });
        const built = new Component({ name: 'Heavy' });
        const seen: Array<[string | null, number]> = [];

        useReducedMotion();
        host.getElement(true);
        host.addComponent(eager);
        host.addComponent(() => built, constraints({ name: 'Heavy' }));
        tab.on('activate', (content, index) => seen.push([content.getName(), index]));

        tab.setActiveTabIndex(1);

        // The content does not exist at selection time, so the announcement is
        // owed until the factory has produced it — not skipped.
        expect(seen).toEqual([]);

        runYield();

        expect(seen).toEqual([['Heavy', 1]]);
    });

    it('announces a lazy selection exactly once, not again on re-selection', () => {
        const { host, tab } = hostTab();
        const eager = new Component({ name: 'Eager' });
        const built = new Component({ name: 'Heavy' });
        const seen: Array<[string | null, number]> = [];

        useReducedMotion();
        host.getElement(true);
        host.addComponent(eager);
        host.addComponent(() => built, constraints({ name: 'Heavy' }));
        tab.on('activate', (content, index) => seen.push([content.getName(), index]));

        tab.setActiveTabIndex(1);
        runYield();
        tab.setActiveTabIndex(0);
        tab.setActiveTabIndex(1);

        // Once materialized the entry announces itself synchronously, through
        // the ordinary selection path — the owed announcement is not replayed.
        expect(seen).toEqual([['Heavy', 1], ['Eager', 0], ['Heavy', 1]]);
    });

    it('emits select at press time for a lazy tab, before its content exists', () => {
        const { host, tab } = hostTab();
        const seen: Array<[number, string]> = [];

        useReducedMotion();
        host.getElement(true);
        host.addComponent(new Component({ name: 'Eager' }));
        host.addComponent(() => new Component({ name: 'Heavy' }), constraints({ name: 'Heavy' }));
        tab.on('select', (index, label) => seen.push([index, label]));

        tab.setActiveTabIndex(1);

        // Selection intent is reported immediately — the whole point of the
        // event is that it does not wait on the factory, so a router can write
        // the destination while the spinner is still up.
        expect(seen).toEqual([[1, 'Heavy']]);
    });

    it('emits select before activate for an already-built tab', () => {
        const { host, tab } = hostTab();
        const order: string[] = [];

        useReducedMotion();
        host.getElement(true);
        host.addComponent(new Component({ name: 'Eager' }));
        host.addComponent(new Component({ name: 'Second' }));

        // Two eager children mint their tabs only in the ownership sweep, so
        // without a layout pass there is nothing to select.
        host.doLayout();

        tab.on('select',   () => order.push('select'));
        tab.on('activate', () => order.push('activate'));

        tab.setActiveTabIndex(1);

        // Intent precedes completion, so a listener on both sees the same
        // ordering whether or not the content had to be built.
        expect(order).toEqual(['select', 'activate']);
    });

    it('emits select on every selection, including a re-selection', () => {
        const { host, tab } = hostTab();
        const seen: number[] = [];

        useReducedMotion();
        host.getElement(true);
        host.addComponent(new Component({ name: 'Eager' }));
        host.addComponent(() => new Component({ name: 'Heavy' }), constraints({ name: 'Heavy' }));
        tab.on('select', index => seen.push(index));

        tab.setActiveTabIndex(1);
        runYield();
        tab.setActiveTabIndex(0);
        tab.setActiveTabIndex(1);

        expect(seen).toEqual([1, 0, 1]);
    });

    it('does not announce a build whose tab was deselected before it finished', () => {
        const { host, tab } = hostTab();
        const eager = new Component({ name: 'Eager' });
        const seen: Array<[string | null, number]> = [];

        useReducedMotion();
        host.getElement(true);
        host.addComponent(eager);
        host.addComponent(() => new Component({ name: 'Heavy' }), constraints({ name: 'Heavy' }));
        tab.on('activate', (content, index) => seen.push([content.getName(), index]));

        tab.setActiveTabIndex(1);
        tab.setActiveTabIndex(0);
        runYield();

        // The build lands behind a newer selection; announcing it would report
        // an active tab that is not the one on screen.
        expect(seen).toEqual([['Eager', 0]]);
    });
});

describe('Tab busy state — the deferred machine', () => {

    it('activating a lazy tab emits busychange(true, label) synchronously, within setActiveTabIndex', () => {
        const { host, tab } = hostTab();
        const seen: Array<[boolean, string]> = [];

        host.getElement(true);
        host.addComponent(() => new Component(), constraints({ name: 'Heavy' }));
        tab.on('busychange', (busy, label) => seen.push([busy, label]));

        tab.setActiveTabIndex(0);

        // The entry flips to "building" (and the strip is marked) before the
        // materialize helper's two-frame yield, so this is observable the
        // instant setActiveTabIndex returns.
        expect(seen).toEqual([[true, 'Heavy']]);
    });

    it('marks only the activated tab; an eager sibling stays not busy', () => {
        const { host, tab } = hostTab();
        const panel = new Component({ name: 'Eager' });
        const seen: Array<[boolean, string]> = [];

        host.getElement(true);
        host.addComponent(panel);
        host.addComponent(() => new Component(), constraints({ name: 'Heavy' }));
        host.doLayout();
        tab.on('busychange', (busy, label) => seen.push([busy, label]));

        tab.setActiveTabIndex(1);

        expect(tab.isTabBusy(panel)).toBe(false);
        expect(seen).toEqual([[true, 'Heavy']]);
    });

    it('re-activating the same lazy tab while still building emits no second busychange', () => {
        const { host, tab } = hostTab();
        const seen: Array<[boolean, string]> = [];

        host.getElement(true);
        host.addComponent(() => new Component(), constraints({ name: 'Heavy' }));
        tab.on('busychange', (busy, label) => seen.push([busy, label]));

        tab.setActiveTabIndex(0);
        tab.setActiveTabIndex(0);

        expect(seen).toEqual([[true, 'Heavy']]);
    });
});

describe('Tab busy state — the public API', () => {

    it('setTabBusy(panel, true) marks an eager tab busy and emits busychange once', () => {
        const { host, tab } = hostTab();
        const panel = new Component({ name: 'Eager' });
        const seen: Array<[boolean, string]> = [];

        host.getElement(true);
        host.addComponent(panel);
        host.doLayout();
        tab.on('busychange', (busy, label) => seen.push([busy, label]));

        expect(tab.setTabBusy(panel, true)).toBe(true);
        expect(tab.isTabBusy(panel)).toBe(true);
        expect(seen).toEqual([[true, 'Eager']]);
    });

    it('setTabBusy(panel, true) again emits nothing; setTabBusy(panel, false) emits once', () => {
        const { host, tab } = hostTab();
        const panel = new Component({ name: 'Eager' });
        const seen: Array<[boolean, string]> = [];

        host.getElement(true);
        host.addComponent(panel);
        host.doLayout();

        tab.setTabBusy(panel, true);
        tab.on('busychange', (busy, label) => seen.push([busy, label]));

        expect(tab.setTabBusy(panel, true)).toBe(true);
        expect(seen).toEqual([]);

        expect(tab.setTabBusy(panel, false)).toBe(true);
        expect(seen).toEqual([[false, 'Eager']]);
    });

    it('setTabBusy on an unmatched component returns false, emits nothing, and leaves other tabs unchanged', () => {
        const { host, tab } = hostTab();
        const panel  = new Component({ name: 'Eager' });
        const orphan = new Component();
        const seen: Array<[boolean, string]> = [];

        host.getElement(true);
        host.addComponent(panel);
        host.doLayout();

        tab.setTabBusy(panel, true);
        tab.on('busychange', (busy, label) => seen.push([busy, label]));

        expect(tab.setTabBusy(orphan, true)).toBe(false);
        expect(seen).toEqual([]);
        expect(tab.isTabBusy(panel)).toBe(true);
        expect(tab.isTabBusy(orphan)).toBe(false);
    });
});
