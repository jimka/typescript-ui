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
// (re-draining a few times to settle cascades a sweep schedules).
function captureRaf(): void {
    rafQueue = [];

    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation(cb => {
        rafQueue.push(cb);

        return rafQueue.length;
    });
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

describe('Dock attach', () => {
    it('emits one attach for addPanel carrying the docked frame', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();
        const events: DockPanelEvent[] = [];

        dock.on('attach', e => events.push(e));
        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });

        expect(events).toHaveLength(1);
        expect(events[0].id).toBe('a');
        expect(events[0].content.getId()).toBe('a');
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

        // Every panel stays "docked" — no floating -> docked flip, no attach.
        priv(dock).runSweep();

        expect(events).toHaveLength(0);
    });

    it('emits attach on a re-dock from a float (floating -> docked)', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const frameA = frameOf(dock, 'a');
        const win = new Window({ title: 'Float' });

        win.show();
        win.moveComponent(frameA);
        priv(dock).scheduleSweep();
        flush(); // location ledger flips 'a' to floating

        const events: DockPanelEvent[] = [];

        dock.on('attach', e => events.push(e));

        // Move the frame back into the tiled root region, then sweep.
        dock.getRootRegion().moveComponent(frameA);
        priv(dock).scheduleSweep();
        flush();

        expect(events.map(e => e.id)).toContain('a');
    });
});

describe('Dock detach', () => {
    it('emits detach and flips the ledger on a region "detached"', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const frameA = frameOf(dock, 'a');
        const win = new Window({ title: 'Float' });

        win.show();
        win.moveComponent(frameA);

        const detached: DockPanelEvent[] = [];
        const closed: DockPanelEvent[] = [];

        dock.on('detach', e => detached.push(e));
        dock.on('close', e => closed.push(e));

        // The torn-off frame's host window carries the registered frame; driving
        // the source region's "detached" resolves it and flips the ledger.
        rootTab(dock).emit('detached' as never, win as never);
        flush();

        expect(detached.map(e => e.id)).toEqual(['a']);
        expect(closed).toHaveLength(0);
        expect(priv(dock)._panelLocation.get('a')).toBe('floating');
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
    });

    it('emits focus for a float\'s active panel on window activation', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const frameA = frameOf(dock, 'a');
        const win = new Window({ title: 'Float' });

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
        expect(priv(dock)._frames.has('a')).toBe(false);
        // The registration is retained so a re-addPanel rebuilds via the factory.
        expect(priv(dock)._panels.has('a')).toBe(true);
    });

    it('emits one close per frame on a float window chrome ✕', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        const frameA = frameOf(dock, 'a');
        const win = new Window({ title: 'Float' });

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
