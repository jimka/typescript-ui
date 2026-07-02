// Covers the Dock panel-lifecycle events (attach / detach / focus / close) and
// the focusPanel / removePanel control methods, exercised through the Tab /
// region / window model under the recording sink.
//
// Two offline-harness realities shape the setup:
//   * A Tab registers its tabs from the container's children lazily, during a
//     doLayout pass — so the dock must be given a materialised element and a
//     size, and doLayout() called, before its regions' Tabs expose an active
//     content / index.
//   * The sweep and the deferred post-close focus recompute both run on a
//     requestAnimationFrame. The recording sink swallows that callback, so the
//     tests capture rAF callbacks in a queue and flush() them explicitly *after*
//     the action under test — the deferred close-focus recompute must run after
//     the source Tab has re-selected a survivor, which a synchronous stub would
//     pre-empt.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Dock, DockPanelEvent } from '~/overlay/Dock';
import { Tab } from '~/layout/Tab';
import { Window } from '~/overlay/Window';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { Tooltip } from '~/overlay/Tooltip';
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

// Queues every scheduled rAF callback instead of firing it; flush() drains them
// (re-draining a few times to settle cascades a sweep schedules). Also swallows
// the global setTimeout the entrance/exit animations a shown Window schedules:
// its fallback `finish` writes to the element, so a real timer firing after the
// test's DOM.reset() touches a released handle and throws an unhandled error.
// The tests never depend on an animation completing, so dropping the timer is
// safe — the same reason rAF is captured rather than run.
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

// A dock with a materialised, sized element so doLayout() registers region tabs.
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

// Reaches the Dock's private surface (sweep, ledgers, registry) the offline
// tests must drive directly.
function priv(dock: Dock): Record<string, any> {
    return dock as unknown as Record<string, any>;
}

function frameOf(dock: Dock, id: string): Component {
    return priv(dock)._frames.get(id) as Component;
}

// Drop any window a test left open from the global registry before the DOM is
// reset: the reset releases their handles, and a later test's serializeLayout /
// restoreLayout iterates getOpenWindows() and would touch a dead handle. The
// listeners die with the reset DOM, so only the registry bookkeeping is cleared.
afterEach(() => {
    (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
    vi.restoreAllMocks();
    DOM.reset();
});

// Records every attach/detach as a {type, id, window} tuple so a test can assert
// the exact paired sequence and host of a transition.
function recordHostEvents(dock: Dock): Array<{ type: 'attach' | 'detach'; id: string; window: unknown }> {
    const log: Array<{ type: 'attach' | 'detach'; id: string; window: unknown }> = [];

    dock.on('detach', e => log.push({ type: 'detach', id: e.id, window: e.window }));
    dock.on('attach', e => log.push({ type: 'attach', id: e.id, window: e.window }));

    return log;
}

describe('Dock attach', () => {
    it('emits one attach with a null host for addPanel, via the sweep, with no detach', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();
        const events: DockPanelEvent[] = [];
        const detachSpy = vi.fn();

        dock.on('attach', e => events.push(e));
        dock.on('detach', detachSpy);
        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        flush(); // addPanel's attach is now produced by the sweep, not synchronously

        expect(events).toHaveLength(1);
        expect(events[0].id).toBe('a');
        expect(events[0].content.getId()).toBe('a');
        // A first appearance enters a host (the tiled tree) with no host to leave.
        expect(events[0].window).toBeNull();
        expect(detachSpy).not.toHaveBeenCalled();
    });

    it('is silent for a sweep over an unchanged tiled tree', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
        dock.doLayout();
        flush();

        const events: DockPanelEvent[] = [];

        dock.on('attach', e => events.push(e));

        // Every panel keeps the same host — no host change, no attach/detach.
        priv(dock).runSweep();

        expect(events).toHaveLength(0);
    });

    it('emits detach(float) then attach(tiled) on a re-dock dropped on a region body', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const frameA = frameOf(dock, 'a');
        const win = new Window('Float');

        win.show();
        win.moveComponent(frameA);
        priv(dock).scheduleSweep();
        flush(); // host ledger flips 'a' to the float

        const log = recordHostEvents(dock);
        const movedSpy = vi.fn();

        dock.on('moved', movedSpy);

        // A DockRegion body/edge drop moves the frame back and schedules a sweep.
        dock.getRootRegion().moveComponent(frameA);
        priv(dock).scheduleSweep();
        flush();

        expect(log).toEqual([
            { type: 'detach', id: 'a', window: win },
            { type: 'attach', id: 'a', window: null },
        ]);
        expect(priv(dock)._panelHost.get('a')).toBeNull();
        // A host change is detach+attach — never moved.
        expect(movedSpy).not.toHaveBeenCalled();
    });

    it('emits detach(float) then attach(tiled) when a tab-bar merge fires the Tab "docked" event', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const frameA = frameOf(dock, 'a');
        const win = new Window('Float');

        win.show();
        win.moveComponent(frameA);
        priv(dock).scheduleSweep();
        flush(); // 'a' is now floating

        const log = recordHostEvents(dock);

        // The tab-bar merge path (Tab._onBarDockRequested) moves the frame into the
        // destination strip and fires "docked" — it never calls DockRegion, so the
        // "docked" -> requestSweep wiring is the only thing that lands the sweep.
        // Without that wiring this emits nothing (the regression this pins).
        dock.getRootRegion().moveComponent(frameA);
        (rootTab(dock) as any).emit('docked', frameA);
        flush();

        expect(log).toEqual([
            { type: 'detach', id: 'a', window: win },
            { type: 'attach', id: 'a', window: null },
        ]);
    });
});

describe('Dock detach', () => {
    it('emits detach(tiled) then attach(float) and updates the ledger on a tear-off', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const frameA = frameOf(dock, 'a');
        const win = new Window('Float');

        win.show();
        win.moveComponent(frameA);

        const log = recordHostEvents(dock);
        const closed: DockPanelEvent[] = [];
        const movedSpy = vi.fn();

        dock.on('close', e => closed.push(e));
        dock.on('moved', movedSpy);

        // The torn-off frame already sits in its float window; driving the source
        // region's "detached" lands a sweep whose host diff emits the pair.
        (rootTab(dock) as any).emit('detached', win);
        flush();

        expect(log).toEqual([
            { type: 'detach', id: 'a', window: null },
            { type: 'attach', id: 'a', window: win },
        ]);
        expect(closed).toHaveLength(0);
        expect(priv(dock)._panelHost.get('a')).toBe(win);
        // A host change is detach+attach — never moved.
        expect(movedSpy).not.toHaveBeenCalled();
    });
});

// A dock with two side-by-side tiled regions ('a' in one, 'b' in the other) so a
// test can relocate a frame between regions within the same (tiled) host.
function twoRegionDock(): Dock {
    const dock = new Dock({
        layout: {
            split:    'horizontal',
            children: [
                { tabs: [{ id: 'a', title: 'A', content: new Component({}) }] },
                { tabs: [{ id: 'b', title: 'B', content: new Component({}) }] },
            ],
        },
    });

    dock.getElement(true);
    dock.setWidth(800);
    dock.setHeight(600);
    dock.doLayout();

    return dock;
}

describe('Dock moved', () => {
    it('emits one moved (host null) and no attach/detach on a same-host region-to-region move', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = twoRegionDock();

        flush();

        const frameA  = frameOf(dock, 'a');
        const regionA = priv(dock).regionForFrame(frameA);
        const regionB = priv(dock).regionForFrame(frameOf(dock, 'b'));

        const moved:   DockPanelEvent[] = [];
        const hostLog = recordHostEvents(dock);

        dock.on('moved', e => moved.push(e));

        // Relocate 'a' into 'b''s region — same host (tiled tree), new region.
        // A real cross-region drag purges the source region's tab registry and
        // prunes the emptied region before the sweep; raw moveComponent does not,
        // so mimic that with doLayout (registers 'a' in regionB) + pruneRegion
        // (the emptied regionA leaves the tree, as its "empty" handler would do).
        regionB.moveComponent(frameA);
        dock.doLayout();
        priv(dock).pruneRegion(regionA);
        priv(dock).scheduleSweep();
        flush();

        // Exactly one moved, for the relocated frame only — the neighbour 'b',
        // whose region object the move left untouched, must not false-fire.
        expect(moved.map(e => ({ id: e.id, window: e.window }))).toEqual([{ id: 'a', window: null }]);
        expect(hostLog).toHaveLength(0);
        expect(priv(dock)._frameRegion.get('a')).toBe(regionB);
    });

    // Note: "a host change fires no moved" is asserted inside the existing
    // tear-off and re-dock tests above (each adds a moved spy) rather than in a
    // separate window-creating test here, so this block opens no float windows
    // and leaves no Window.show() animation timers to leak into later tests.

    it('fires no moved on addPanel (first appearance)', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();
        const movedSpy = vi.fn();

        dock.on('moved', movedSpy);
        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        flush();

        expect(movedSpy).not.toHaveBeenCalled();
    });

    it('fires no moved on a no-op sweep', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = twoRegionDock();

        flush();

        const movedSpy = vi.fn();

        dock.on('moved', movedSpy);
        priv(dock).runSweep();

        expect(movedSpy).not.toHaveBeenCalled();
    });

    it('fires no moved for surviving panels on a setLayoutState restore', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = twoRegionDock();

        flush();

        // A restore tears down and rebuilds the region tree, so surviving panels
        // land in fresh region objects — without clearing the region ledger this
        // would spuriously fire moved for every panel. The restore is not a
        // user-visible relocation, so it must stay silent for moved.
        const state = dock.getLayoutState();
        const movedSpy = vi.fn();

        dock.on('moved', movedSpy);
        dock.setLayoutState(state);
        flush();

        expect(movedSpy).not.toHaveBeenCalled();
    });
});

describe('Dock focus', () => {
    it('emits focus on a tiled tab switch and is silent on re-select', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
        dock.doLayout();
        flush();

        const events: Array<DockPanelEvent | null> = [];

        dock.on('focus', e => events.push(e));

        rootTab(dock).setActiveTabIndex(1);
        rootTab(dock).setActiveTabIndex(1); // re-select the same tab: silent

        expect(events).toHaveLength(1);
        expect(events[0]?.id).toBe('b');
        // The focused panel is tiled, so its host is null.
        expect(events[0]?.window).toBeNull();
    });

    it('emits focus for a float\'s active panel on window activation', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const frameA = frameOf(dock, 'a');
        const win = new Window('Float');

        win.show();
        win.moveComponent(frameA);
        priv(dock).scheduleSweep();
        flush(); // adopt + subscribe the float window

        // Lay out the adopted float region so its Tab registers the frame.
        const content = priv(dock).windowContent(win);
        const regions: Component[] = [];

        priv(dock).collectTabRegions(content, regions);
        regions.forEach(r => r.getElement(true));
        win.getElement(true);
        win.doLayout();

        const events: Array<DockPanelEvent | null> = [];

        dock.on('focus', e => events.push(e));
        win.onActivate(true);

        expect(events.at(-1)?.id).toBe('a');
        // The focused panel lives in the float, so its host names that window.
        expect(events.at(-1)?.window).toBe(win);
    });
});

describe('Dock close', () => {
    it('emits one close on removePanel and evicts the cached frame', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
        dock.doLayout();
        flush();

        const events: DockPanelEvent[] = [];

        dock.on('close', e => events.push(e));

        const removed = dock.removePanel('a');

        flush();

        expect(removed).toBe(true);
        expect(events.map(e => e.id)).toEqual(['a']);
        // A close is a destroy, not a host transition, so its host is always null.
        expect(events[0].window).toBeNull();
        expect(priv(dock)._frames.has('a')).toBe(false);
        // The registration is retained so a re-addPanel rebuilds via the factory.
        expect(priv(dock)._panels.has('a')).toBe(true);
    });

    it('emits no phantom detach when a panel closes (close only)', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
        dock.doLayout();
        flush();

        const detachSpy = vi.fn();
        const closed: DockPanelEvent[] = [];

        dock.on('detach', detachSpy);
        dock.on('close', e => closed.push(e));

        dock.removePanel('a');
        flush(); // the frame is gone from _frames, so the sweep never visits it

        expect(closed.map(e => e.id)).toEqual(['a']);
        expect(detachSpy).not.toHaveBeenCalled();
    });

    it('emits one close per frame on a float window chrome ✕', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const frameA = frameOf(dock, 'a');
        const win = new Window('Float');

        win.show();
        win.moveComponent(frameA);
        priv(dock).scheduleSweep();
        flush();

        const events: DockPanelEvent[] = [];

        dock.on('close', e => events.push(e));
        win.requestClose();
        flush();

        expect(events.map(e => e.id)).toEqual(['a']);
    });

    it('emits focus(null) when the last panel closes', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        rootTab(dock).setActiveTabIndex(0); // focus 'a'

        const events: Array<DockPanelEvent | null> = [];

        dock.on('focus', e => events.push(e));
        dock.removePanel('a');
        flush();

        expect(events).toContainEqual(null);
    });

    it('shifts focus to a surviving sibling when the focused tab closes', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
        dock.doLayout();
        flush();

        rootTab(dock).setActiveTabIndex(1); // focus 'b'

        const events: Array<DockPanelEvent | null> = [];

        dock.on('focus', e => events.push(e));
        dock.removePanel('b');
        flush();

        expect(events.at(-1)?.id).toBe('a');
    });
});

describe('Dock control methods', () => {
    it('focusPanel(known) activates the host tab, raises focus, returns true', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
        dock.doLayout();
        flush();

        const events: Array<DockPanelEvent | null> = [];

        dock.on('focus', e => events.push(e));

        const ok = dock.focusPanel('a');

        expect(ok).toBe(true);
        expect(rootTab(dock).getActiveContent()?.getId()).toBe('a');
        expect(events.at(-1)?.id).toBe('a');
    });

    it('focusPanel / removePanel return false for an unknown id and emit nothing', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const spy = vi.fn();

        dock.on('focus', spy);
        dock.on('close', spy);

        expect(dock.focusPanel('nope')).toBe(false);
        expect(dock.removePanel('nope')).toBe(false);
        expect(spy).not.toHaveBeenCalled();
    });

    it('focusPanel of a registered-but-never-docked id returns false', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        // Register and build the identity frame without ever docking it into a
        // region, so no Tab region hosts the frame.
        priv(dock)._panels.set('a', { id: 'a', title: 'A', content: new Component({}) });
        priv(dock).resolvePanel('a');

        expect(frameOf(dock, 'a')).toBeDefined();
        expect(dock.focusPanel('a')).toBe(false);
    });
});

describe('Dock off()', () => {
    it('unsubscribes each of the four events', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();
        const attachSpy = vi.fn();
        const focusSpy = vi.fn();
        const closeSpy = vi.fn();
        const detachSpy = vi.fn();

        dock.on('attach', attachSpy);
        dock.on('focus', focusSpy);
        dock.on('close', closeSpy);
        dock.on('detach', detachSpy);
        dock.off('attach', attachSpy);
        dock.off('focus', focusSpy);
        dock.off('close', closeSpy);
        dock.off('detach', detachSpy);

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
        dock.doLayout();
        flush();

        rootTab(dock).setActiveTabIndex(1);
        dock.removePanel('a');
        flush();

        expect(attachSpy).not.toHaveBeenCalled();
        expect(focusSpy).not.toHaveBeenCalled();
        expect(closeSpy).not.toHaveBeenCalled();
        expect(detachSpy).not.toHaveBeenCalled();
    });
});

describe('Dock addPanel — focus and closeable', () => {
    it('activates a freshly added panel (the newly opened tab is shown)', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
        dock.doLayout();
        flush();

        // Opening a second panel switches the active tab to it, rather than
        // leaving the first one active.
        expect(rootTab(dock).getActiveContent()?.getId()).toBe('b');
    });

    it('makes dock tabs closeable by default', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        expect(rootTab(dock).getLayoutConstraints(frameOf(dock, 'a'))?.closeable).toBe(true);
    });

    it('honors closeable: false on a panel spec', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}), closeable: false });
        dock.doLayout();
        flush();

        expect(rootTab(dock).getLayoutConstraints(frameOf(dock, 'a'))?.closeable).toBe(false);
    });
});

describe('Dock addPanel — tooltip', () => {
    it('stores the tooltip on the tab constraints', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}), tooltip: 'customers\nDatabase: sqladmin' });
        dock.doLayout();
        flush();

        expect(rootTab(dock).getLayoutConstraints(frameOf(dock, 'a'))?.tooltip).toBe('customers\nDatabase: sqladmin');
    });

    it('attaches the tooltip to the tab button', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const attachSpy = vi.spyOn(Tooltip, 'attach');

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}), tooltip: 'TT-text' });
        dock.doLayout();
        flush();

        expect(attachSpy).toHaveBeenCalledWith(expect.anything(), 'TT-text');
    });
});

describe('Dock addPanel — empty dock', () => {
    it('can open a panel again after the last one was closed', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        // Close the only panel — the root region empties.
        expect(dock.removePanel('a')).toBe(true);
        dock.doLayout();
        flush();

        // Re-adding must not throw on the emptied dock, and must register + show.
        expect(() => dock.addPanel({ id: 'b', title: 'B', content: new Component({}) })).not.toThrow();
        dock.doLayout();
        flush();

        expect(rootTab(dock).getActiveContent()?.getId()).toBe('b');
    });

    it('can open a panel again after closing a dragged-then-promoted last region', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();
        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
        dock.doLayout();
        flush();

        // Drag 'b' to the SOUTH edge: the structural path a drop takes
        // (splitOnEdge -> newStack) mints a self-pruning DockRegion stack for 'b'
        // — the crux a compiled split misses, since compiled regions prune via the
        // guarded Dock.pruneRegion, not DockRegion.pruneEmptyStack.
        const rootDockRegion = priv(dock)._wiring.get(dock.getRootRegion()).dockRegion;
        priv(rootDockRegion).splitOnEdge(frameOf(dock, 'b'), 'bottom');
        dock.doLayout();
        flush();

        // Close the NORTH tab and promote the south (DockRegion) stack to the sole
        // root. Force the prune (as the 'moved' test does) so the offline harness
        // runs the close -> prune -> collapse an X-click drives in the app.
        const northRegion = priv(dock).regionForFrame(frameOf(dock, 'a'));
        (northRegion.getLayoutManager() as Tab).closeTab(frameOf(dock, 'a'));
        priv(dock).pruneRegion(northRegion);
        dock.doLayout();
        flush();

        // Close the promoted last region's remaining tab. Its self-pruning stack
        // must NOT remove the sole root (the regression: it did, emptying the dock).
        dock.removePanel('b');
        dock.doLayout();
        flush();

        expect(dock.getRootRegion()).toBeTruthy();

        // Opening a new panel must not throw on the emptied-but-kept root.
        expect(() => dock.addPanel({ id: 'c', title: 'C', content: new Component({}) })).not.toThrow();
        dock.doLayout();
        flush();

        expect(rootTab(dock).getActiveContent()?.getId()).toBe('c');
    });
});

describe('Dock addPanel — last-active region', () => {
    it('docks a new panel into the region the user last focused, not the first', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = twoRegionDock();

        flush();

        const regionA = priv(dock).regionForFrame(frameOf(dock, 'a'));
        const regionB = priv(dock).regionForFrame(frameOf(dock, 'b'));

        expect(regionA).not.toBe(regionB);

        // Simulate the user focusing the second tab-bar (its "activated" handler).
        priv(dock).onPanelFocused(frameOf(dock, 'b'));

        dock.addPanel({ id: 'c', title: 'C', content: new Component({}) });
        dock.doLayout();
        flush();

        // The new panel opens in region B (last focused), not region A (first).
        expect(priv(dock)._frameRegion.get('c')).toBe(regionB);
    });

    it('retargets to whichever region was focused most recently', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = twoRegionDock();

        flush();

        const regionA = priv(dock).regionForFrame(frameOf(dock, 'a'));
        const regionB = priv(dock).regionForFrame(frameOf(dock, 'b'));

        priv(dock).onPanelFocused(frameOf(dock, 'b'));
        dock.addPanel({ id: 'c', title: 'C', content: new Component({}) });
        dock.doLayout();
        flush();

        expect(priv(dock)._frameRegion.get('c')).toBe(regionB);

        // Focus moves back to region A — the next add follows it.
        priv(dock).onPanelFocused(frameOf(dock, 'a'));
        dock.addPanel({ id: 'd', title: 'D', content: new Component({}) });
        dock.doLayout();
        flush();

        expect(priv(dock)._frameRegion.get('d')).toBe(regionA);
    });
});

describe('Dock addLazyPanel', () => {
    it('defers the content factory at add time but creates the frame for dedup', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();
        let built = 0;

        dock.addLazyPanel({ id: 'a', title: 'A', content: () => { built++; return new Component({}); } });

        // The content factory is NOT run on add — that is the whole point of lazy.
        expect(built).toBe(0);
        // The identity frame still exists, so the tab shows and a re-open dedups.
        expect(frameOf(dock, 'a')).toBeDefined();
        expect(priv(dock)._lazyFactories.has('a')).toBe(true);
    });

    it('materializes the content on first activation, once', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();
        let built = 0;
        const content = new Component({});

        dock.addLazyPanel({ id: 'a', title: 'A', content: () => { built++; return content; } });
        flush();           // run the sweep so the region's "activated" listener is wired
        dock.doLayout();   // realize the deferred active-set -> fires "activated"
        flush();           // drain materialize's two-rAF yield so the factory runs

        // Activation ran the factory exactly once and placed its output in the frame.
        expect(built).toBe(1);
        expect(frameOf(dock, 'a').getComponents()).toContain(content);
        // The factory is dropped once realized, so a re-activation never rebuilds.
        expect(priv(dock)._lazyFactories.has('a')).toBe(false);
    });
});

// A dock with a placeholder so the empty-state tests can assert the raw-append.
function mountDockWithPlaceholder(placeholder: Component): Dock {
    const dock = new Dock({ emptyContent: placeholder });

    dock.getElement(true);
    dock.setWidth(800);
    dock.setHeight(600);

    return dock;
}

// The parent element of a placeholder, resolved through the recording source, or
// null when it is not attached to the DOM.
function parentElementOf(component: Component): unknown {
    const el = component.getElement(true);

    return el ? DOM.source.getParentElement(el) : null;
}

describe('Dock empty-state', () => {
    it('reports isEmpty() true for a fresh empty dock', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        flush();

        expect(dock.isEmpty()).toBe(true);
    });

    it('flips to populated and emits emptychange(false) once on addPanel', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();
        const events: Array<{ empty: boolean }> = [];

        dock.on('emptychange', e => events.push(e));
        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        flush();

        expect(dock.isEmpty()).toBe(false);
        expect(events).toEqual([{ empty: false }]);

        // A subsequent no-op sweep must not re-emit.
        priv(dock).scheduleSweep();
        flush();

        expect(events).toEqual([{ empty: false }]);
    });

    it('flips to empty and emits emptychange(true) once when the last tiled panel closes', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const events: Array<{ empty: boolean }> = [];

        dock.on('emptychange', e => events.push(e));
        dock.removePanel('a');
        dock.doLayout();
        flush();

        expect(dock.isEmpty()).toBe(true);
        expect(events).toEqual([{ empty: true }]);
    });

    it('flips to empty and emits emptychange(true) once when the last floated panel closes', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const frameA = frameOf(dock, 'a');
        const win = new Window('Float');

        win.show();
        win.moveComponent(frameA);
        (rootTab(dock) as any).emit('detached', win);
        flush();

        expect(dock.isEmpty()).toBe(false);

        const events: Array<{ empty: boolean }> = [];

        dock.on('emptychange', e => events.push(e));
        win.requestClose();
        flush();

        expect(dock.isEmpty()).toBe(true);
        expect(events).toEqual([{ empty: true }]);
    });

    it('is NOT empty and emits nothing when every panel is floated', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const events: Array<{ empty: boolean }> = [];

        dock.on('emptychange', e => events.push(e));

        const frameA = frameOf(dock, 'a');
        const win = new Window('Float');

        win.show();
        win.moveComponent(frameA);
        (rootTab(dock) as any).emit('detached', win);
        flush();

        expect(dock.isEmpty()).toBe(false);
        expect(events).toEqual([]);

        // Close the leaked float so its window does not persist in the global
        // open-window registry into a later restore test.
        win.requestClose();
        flush();
    });

    it('attaches / detaches the placeholder across the state machine, never as a region child', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const placeholder = new Component({});
        const dock = mountDockWithPlaceholder(placeholder);

        dock.doLayout();
        flush();

        const rootEl = dock.getRootRegion().getElement(true);

        // Empty on construction -> placeholder attached into the root region element.
        expect(parentElementOf(placeholder)).toBe(rootEl);
        expect(dock.getRootRegion().getComponents()).not.toContain(placeholder);

        // Populate -> placeholder detached.
        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        expect(parentElementOf(placeholder)).toBeNull();
        expect(dock.getRootRegion().getComponents()).not.toContain(placeholder);

        // Close last -> placeholder re-attached.
        dock.removePanel('a');
        dock.doLayout();
        flush();

        expect(parentElementOf(placeholder)).toBe(dock.getRootRegion().getElement(true));
        expect(dock.getRootRegion().getComponents()).not.toContain(placeholder);
    });

    it('emits emptychange with no emptyContent supplied', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        expect(dock.getEmptyContent()).toBeNull();

        const events: Array<{ empty: boolean }> = [];

        dock.on('emptychange', e => events.push(e));
        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        dock.removePanel('a');
        dock.doLayout();
        flush();

        expect(events).toEqual([{ empty: false }, { empty: true }]);
    });

    it('emits no emptychange for a no-op sweep over an unchanged tree', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const events: Array<{ empty: boolean }> = [];

        dock.on('emptychange', e => events.push(e));
        priv(dock).scheduleSweep();
        flush();

        expect(events).toEqual([]);
    });

    it('reconciles emptiness on a setLayoutState restore into an empty dock', () => {
        installTestDOM(CONFIG);
        captureRaf();

        // The restore factory resolves leaves from this dock's own panel registry,
        // so the spec must be registered here (restore is a round-trip). Capture a
        // populated state, then return the dock to empty by capturing/replaying an
        // empty state up front.
        const dock = mountDock();

        dock.doLayout();
        flush();

        // Use a factory spec: removePanel evicts the cached frame, so a later
        // restore rebuilds it — a factory yields fresh content each rebuild (a
        // live-component spec would orphan its already-parented content).
        dock.addPanel({ id: 'a', title: 'A', content: () => new Component({}) });
        dock.doLayout();
        flush();

        const populatedState = dock.getLayoutState();

        // Return to empty via removePanel (the spec stays registered), then restore
        // the populated state into the empty dock -> one emptychange(false).
        dock.removePanel('a');
        dock.doLayout();
        flush();

        expect(dock.isEmpty()).toBe(true);

        const events: Array<{ empty: boolean }> = [];

        dock.on('emptychange', e => events.push(e));
        dock.setLayoutState(populatedState);
        dock.doLayout();
        flush();

        expect(dock.isEmpty()).toBe(false);
        expect(events).toEqual([{ empty: false }]);

        // A surviving-panel restore that stays populated emits nothing.
        dock.setLayoutState(populatedState);
        dock.doLayout();
        flush();

        expect(dock.isEmpty()).toBe(false);
        expect(events).toEqual([{ empty: false }]);
    });

    it('does not serialize the placeholder', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const placeholder = new Component({});
        const dock = mountDockWithPlaceholder(placeholder);

        dock.doLayout();
        flush();

        // Placeholder is attached (empty dock) but must be absent from the state.
        expect(parentElementOf(placeholder)).toBe(dock.getRootRegion().getElement(true));

        const state = dock.getLayoutState();

        expect(state.root.kind).toBe('tab');
        expect((state.root as any).children).toEqual([]);
    });

    it('keeps the empty root region a live drop target and detaches the placeholder on re-add', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const placeholder = new Component({});
        const dock = mountDockWithPlaceholder(placeholder);

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        dock.removePanel('a');
        dock.doLayout();
        flush();

        // The root region survived, still carries its DockRegion wiring, and shows
        // the placeholder.
        const root = dock.getRootRegion();

        expect(root).toBeTruthy();
        expect(priv(dock)._wiring.get(root)).toBeTruthy();
        expect(parentElementOf(placeholder)).toBe(root.getElement(true));

        // Re-adding docks a tab and detaches the placeholder.
        dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
        dock.doLayout();
        flush();

        expect(rootTab(dock).getActiveContent()?.getId()).toBe('b');
        expect(parentElementOf(placeholder)).toBeNull();
    });

    it('routes emptyContent through the options bag and setter/accessor', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const c1 = new Component({});
        const c2 = new Component({});
        const dock = new Dock({ emptyContent: c1 });

        expect(dock.getEmptyContent()).toBe(c1);
        expect(dock.setEmptyContent(c2)).toBe(dock);
        expect(dock.getEmptyContent()).toBe(c2);
        expect(dock.setEmptyContent(null).getEmptyContent()).toBeNull();
    });

    it('hot-swaps the shown placeholder when setEmptyContent runs while already empty', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const c1 = new Component({});
        const c2 = new Component({});
        const dock = mountDockWithPlaceholder(c1);

        dock.doLayout();
        flush();

        const rootEl = dock.getRootRegion().getElement(true);

        // c1 is the shown placeholder on the born-empty dock.
        expect(parentElementOf(c1)).toBe(rootEl);

        // A swap while already empty replaces the DOM element immediately — not on
        // the next empty transition — and fires no emptychange (still empty).
        const events: Array<{ empty: boolean }> = [];

        dock.on('emptychange', e => events.push(e));
        dock.setEmptyContent(c2);

        expect(parentElementOf(c1)).toBeNull();
        expect(parentElementOf(c2)).toBe(rootEl);
        expect(dock.getRootRegion().getComponents()).not.toContain(c2);
        expect(events).toEqual([]);
    });

    it('clears the shown placeholder when setEmptyContent(null) runs while already empty', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const c1 = new Component({});
        const dock = mountDockWithPlaceholder(c1);

        dock.doLayout();
        flush();

        expect(parentElementOf(c1)).toBe(dock.getRootRegion().getElement(true));

        dock.setEmptyContent(null);

        expect(parentElementOf(c1)).toBeNull();
        expect(dock.getEmptyContent()).toBeNull();
    });

    it('does not attach a placeholder set via setEmptyContent while populated', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        // Setting a placeholder on a populated dock only caches it; nothing shows
        // until the dock next becomes empty.
        const late = new Component({});

        dock.setEmptyContent(late);

        expect(parentElementOf(late)).toBeNull();
        expect(dock.getEmptyContent()).toBe(late);

        // When the last panel closes, the cached placeholder attaches.
        dock.removePanel('a');
        dock.doLayout();
        flush();

        expect(parentElementOf(late)).toBe(dock.getRootRegion().getElement(true));
    });
});
