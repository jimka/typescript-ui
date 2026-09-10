// Covers Dock's vetoable "beforeclose" (tiled tab ✕, float chrome ✕,
// removePanel's unguarded path) and "dblclick" events — exercised through the
// same offline Tab / region / window harness as Dock.lifecycle.test.ts
// (mountDock, frameOf, rootTab, priv, captureRaf/flush), driving the private
// bar-close/bar-double-click handlers the same way Tab.renameAndVeto.test.ts's
// driveBarClose and Tab.doubleClick.test.ts drive Tab's own private handlers.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Dock, DockPanelEvent } from '~/overlay/Dock';
import { Tab, TabCloseController } from '~/layout/Tab';
import { Window } from '~/overlay/Window';
import { AbstractWindow, WindowCloseController } from '~/overlay/AbstractWindow';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let rafQueue: FrameRequestCallback[] = [];

function captureRaf(): void {
    rafQueue = [];

    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation(cb => {
        rafQueue.push(cb);

        return rafQueue.length;
    });

    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((): number => 0) as typeof setTimeout);
}

function flush(): void {
    for (let i = 0; i < 6 && rafQueue.length > 0; i++) {
        const batch = rafQueue;

        rafQueue = [];
        batch.forEach(cb => cb(0));
    }
}

/** A dock with a materialised, sized element so doLayout() registers region tabs. */
function mountDock(): Dock {
    const dock = new Dock();

    dock.getElement(true);
    dock.setWidth(800);
    dock.setHeight(600);

    return dock;
}

function rootTab(dock: Dock): Tab {
    return dock.getRootRegion().getLayoutManager() as Tab;
}

/** Reaches the Dock's private surface (sweep, ledgers, registry) the offline tests must drive directly. */
function priv(dock: Dock): Record<string, any> {
    return dock as unknown as Record<string, any>;
}

function frameOf(dock: Dock, id: string): Component {
    return priv(dock)._frames.get(id) as Component;
}

/** Reaches Tab's private `_onBarTabClose`, the handler the ✕ and the context menu both reach. */
function driveBarClose(tab: Tab, id: string): void {
    (tab as unknown as { _onBarTabClose(id: string): void })._onBarTabClose(id);
}

/** Reaches Tab's private `_onBarTabDoubleClick`, the handler a real dblclick resolves to. */
function driveBarDoubleClick(tab: Tab, id: string): void {
    (tab as unknown as { _onBarTabDoubleClick(id: string): void })._onBarTabDoubleClick(id);
}

/** Reaches Tab's private `_contents` to find a cell's owner-minted id for a given content component. */
function barEntryId(tab: Tab, content: Component): string {
    const contents = (tab as unknown as { _contents: Array<{ id: string; component: Component | null }> })._contents;

    return contents.find(e => e.component === content)!.id;
}

afterEach(() => {
    (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
    vi.restoreAllMocks();
    DOM.reset();
});

describe('Dock "beforeclose" — tiled tab ✕', () => {
    it('a veto keeps the panel open and "close" never fires', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const frameA = frameOf(dock, 'a');
        const closeSpy = vi.fn();

        dock.on('close', closeSpy);
        dock.on('beforeclose', (_e: DockPanelEvent, controller: TabCloseController) => {
            controller.preventDefault();
        });

        driveBarClose(rootTab(dock), barEntryId(rootTab(dock), frameA));

        expect(closeSpy).not.toHaveBeenCalled();
        expect(frameA.getParentComponent()).not.toBeNull();
    });

    it('no veto closes normally: "close" fires once, panel removed', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const frameA = frameOf(dock, 'a');
        const events: DockPanelEvent[] = [];

        dock.on('close', e => events.push(e));

        driveBarClose(rootTab(dock), barEntryId(rootTab(dock), frameA));

        expect(events.map(e => e.id)).toEqual(['a']);
    });

    it('removePanel never fires "beforeclose" — a standing veto does not stop it', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const beforeCloseSpy = vi.fn();

        dock.on('beforeclose', beforeCloseSpy);
        dock.on('beforeclose', (_e: DockPanelEvent, controller: TabCloseController) => {
            controller.preventDefault();
        });

        expect(dock.removePanel('a')).toBe(true);
        expect(beforeCloseSpy).not.toHaveBeenCalled();
    });

    it('still fires after a setLayoutState restore rebuilds the root region in place', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush(); // wires the root region's Tab once

        // populateContainer rebuilds the root's Tab manager in place on the
        // same Component — the buggy path this test pins.
        const state = dock.getLayoutState();

        dock.setLayoutState(state);
        flush();

        const frameA = frameOf(dock, 'a');
        const closeSpy = vi.fn();

        dock.on('close', closeSpy);
        dock.on('beforeclose', (_e: DockPanelEvent, controller: TabCloseController) => {
            controller.preventDefault();
        });

        driveBarClose(rootTab(dock), barEntryId(rootTab(dock), frameA));

        expect(closeSpy).not.toHaveBeenCalled();
        expect(frameA.getParentComponent()).not.toBeNull();
    });

    it('close still fires once for a non-vetoed close after the same restore', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const state = dock.getLayoutState();

        dock.setLayoutState(state);
        flush();

        const frameA = frameOf(dock, 'a');
        const events: DockPanelEvent[] = [];

        dock.on('close', e => events.push(e));

        driveBarClose(rootTab(dock), barEntryId(rootTab(dock), frameA));

        expect(events.map(e => e.id)).toEqual(['a']);
    });

    it('does not double-register a Tab instance\'s listeners across a repeated sweep', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        // An extra sweep against the same, unchanged root Tab instance.
        priv(dock).runSweep();

        const frameA = frameOf(dock, 'a');
        const events: DockPanelEvent[] = [];

        dock.on('close', e => events.push(e));

        driveBarClose(rootTab(dock), barEntryId(rootTab(dock), frameA));

        expect(events.map(e => e.id)).toEqual(['a']);
    });
});

describe('Dock "beforeclose" — float chrome ✕', () => {
    /** Tears 'a' off into a fresh, shown float window, then moves 'b' into the same float region too. */
    function tearOffTwoIntoOneFloat(dock: Dock): Window {
        const frameA = frameOf(dock, 'a');
        const frameB = frameOf(dock, 'b');
        const win = new Window('Float');

        win.show();
        win.moveComponent(frameA);
        priv(dock).scheduleSweep();
        flush(); // adopts 'a' into the float as its own wired Tab region

        // Locate the float's real (adopted) Tab region the same way
        // Dock.lifecycle.test.ts's "focus for a float's active panel" test
        // does — not via regionForFrame(frameA), whose _contents-based lookup
        // can still match frameA's stale entry in the tiled root's own Tab
        // after a raw moveComponent (which, unlike a real drag tear-off,
        // never prunes the source Tab's bookkeeping).
        const content = priv(dock).windowContent(win);
        const regions: Component[] = [];

        priv(dock).collectTabRegions(content, regions);

        const floatRegion = regions[0];

        floatRegion.moveComponent(frameB);
        win.doLayout();
        priv(dock).scheduleSweep();
        flush(); // 'b' now shares that region too

        return win;
    }

    it('a veto on one of two panels keeps the whole float open, neither panel closes', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
        dock.doLayout();
        flush();

        const win = tearOffTwoIntoOneFloat(dock);
        const closed: string[] = [];

        dock.on('close', e => closed.push(e.id));
        dock.on('beforeclose', (e: DockPanelEvent, controller: WindowCloseController) => {
            if (e.id === 'b') {
                controller.preventDefault();
            }
        });

        win.requestClose();
        flush();

        expect(closed).toEqual([]);
        expect(AbstractWindow.getOpenWindows()).toContain(win);
    });

    it('no veto: both panels close, then the window itself', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
        dock.doLayout();
        flush();

        const win = tearOffTwoIntoOneFloat(dock);
        const log: string[] = [];

        dock.on('close', e => log.push(`panel:${e.id}`));
        win.on('close', () => log.push('window'));

        win.requestClose();
        flush();

        expect(log).toEqual(['panel:a', 'panel:b', 'window']);
    });
});

describe('Dock "dblclick"', () => {
    it('fires once with the double-clicked panel\'s DockPanelEvent', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const frameA = frameOf(dock, 'a');
        const events: DockPanelEvent[] = [];

        dock.on('dblclick', e => events.push(e));

        driveBarDoubleClick(rootTab(dock), barEntryId(rootTab(dock), frameA));

        expect(events).toHaveLength(1);
        expect(events[0].id).toBe('a');
        expect(events[0].content).toBe(frameA);
        expect(events[0].window).toBeNull();
    });

    it('does not fire for a lazy tab whose content has not been built yet', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        // A genuinely lazy Tab entry — added directly to the dock-managed root
        // region, outside Dock's own registry — mirroring Tab.doubleClick.test.ts's
        // "a lazy tab whose content has not been built" case, to confirm Dock's
        // relay respects Tab's own no-fire limit for any lazy entry in a
        // Dock-managed strip, not only ones Dock itself registered.
        rootTab(dock).addLazyTab(() => new Component({}), 'Later');

        const contents = (rootTab(dock) as unknown as { _contents: Array<{ id: string; component: Component | null }> })
            ._contents;
        const lazyId = contents.find(e => e.component === null)!.id;

        const dblclickSpy = vi.fn();

        dock.on('dblclick', dblclickSpy);

        driveBarDoubleClick(rootTab(dock), lazyId);

        expect(dblclickSpy).not.toHaveBeenCalled();
    });
});
