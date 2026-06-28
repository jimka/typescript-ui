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

afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

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
