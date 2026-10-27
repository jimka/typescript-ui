// Covers Dock's "splitresize" event — the dock-wide re-emit of a split
// region's "paneresize" (a finished gutter drag) and "panecollapse" (a pane
// collapsed or expanded): when it fires, its payload, the splits it covers
// (nested, in a float), the changes that do not fire it, the release of a
// split's subscription when its manager is rebuilt or its region leaves.
//
// The harness is the one Dock.lifecycle.test.ts uses: the dock gets a
// materialised, sized element so doLayout() registers region tabs, and the
// sweep's requestAnimationFrame callbacks are queued and drained by flush().
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Dock, DockPanelSpec, DockSplitEvent } from '~/overlay/Dock';
import { Tab } from '~/layout/Tab';
import { Split } from '~/layout/Split';
import { SplitNode } from '~/layout/LayoutSerialization';
import { Window } from '~/overlay/Window';
import { AbstractWindow } from '~/overlay/AbstractWindow';
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

// Queues every scheduled rAF callback instead of firing it; flush() drains
// them. Also swallows the global setTimeout a shown Window's animations
// schedule, whose fallback would write to a handle DOM.reset() released.
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

// Reaches the Dock's private surface (sweep, ledgers, registry).
function priv(dock: Dock): Record<string, any> {
    return dock as unknown as Record<string, any>;
}

function frameOf(dock: Dock, id: string): Component {
    return priv(dock)._frames.get(id) as Component;
}

afterEach(() => {
    (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
    vi.restoreAllMocks();
    DOM.reset();
});

// The layout regionsDock builds: H[T(…),T(…),…], one tab group per entry.
function regionsLayout(regions: string[][]): NonNullable<ConstructorParameters<typeof Dock>[0]>['layout'] {
    return {
        split:    'horizontal',
        children: regions.map(ids => ({
            tabs: ids.map(id => ({ id, title: id.toUpperCase(), content: new Component({}) })),
        })),
    };
}

// A dock with one side-by-side tiled region per entry of `regions`, each
// holding the listed panel ids in order, mounted and laid out.
function regionsDock(regions: string[][], listeners?: NonNullable<ConstructorParameters<typeof Dock>[0]>['listeners']): Dock {
    const dock = new Dock({ layout: regionsLayout(regions), listeners });

    dock.getElement(true);
    dock.setWidth(800);
    dock.setHeight(600);
    dock.doLayout();

    return dock;
}

// Moves panel `id` into a fresh, shown bare Window and lays the float out so
// its adopted Tab region registers the frame — the setup
// Dock.lifecycle.test.ts uses for a Shift tear-off.
function floatPanel(dock: Dock, id: string): Window {
    const frame = frameOf(dock, id);
    const sourceTab = priv(dock).regionForFrame(frame).getLayoutManager() as Tab;
    const entryId = sourceTabEntryId(sourceTab, frame);
    const win = new Window('Float');

    win.show();
    win.moveComponent(frame);
    (sourceTab as unknown as { removeEntryKeepingContent(id: string): void }).removeEntryKeepingContent(entryId);
    priv(dock).scheduleSweep();
    flush();

    const content = priv(dock).windowContent(win);
    const regions: Component[] = [];

    priv(dock).collectTabRegions(content, regions);
    regions.forEach(r => r.getElement(true));
    win.getElement(true);
    win.doLayout();
    dock.doLayout();

    return win;
}

// Reaches Tab's private `_contents` for the strip-entry id hosting `content`.
function sourceTabEntryId(tab: Tab, content: Component): string {
    const contents = (tab as unknown as { _contents: Array<{ id: string; component: Component | null }> })._contents;

    return contents.find(e => e.component === content)!.id;
}

const specC = (): DockPanelSpec => ({ id: 'c', title: 'C', content: new Component({}) });

// Records every "splitresize" payload.
function recordSplitResize(dock: Dock): DockSplitEvent[] {
    const log: DockSplitEvent[] = [];

    dock.on('splitresize', e => log.push(e));

    return log;
}

// The gutter `index` of a split region, with the three handlers a real drag
// runs.
function gutterOf(region: Component, index: number): {
    onDragStart(evnt: MouseEvent): void;
    onDrag(evnt: MouseEvent): void;
    onDragStop(): void;
    emit(event: string): void;
} {
    return ((region.getLayoutManager() as Split) as any)._gutters[index];
}

// Drives a full gutter drag through the gutter's own handlers. Both
// coordinates are set, so it works for either orientation. Pass from === to
// for a press and release that does not move.
function dragGutter(region: Component, index: number, from: number, to: number): void {
    const gutter = gutterOf(region, index);

    gutter.onDragStart({ clientX: from, clientY: from } as MouseEvent);
    gutter.onDrag({ clientX: to, clientY: to } as MouseEvent);
    gutter.onDragStop();
}

// Fires the gutter's "collapse" event, as its chevron does.
function clickChevron(region: Component, index: number): void {
    gutterOf(region, index).emit('collapse');
}

// The panel ids per pane, each sorted, for order-free comparison.
function sortedPanels(event: DockSplitEvent): string[][] {
    return event.panels.map(ids => [...ids].sort());
}

function ratiosOf(region: Component): number[] {
    return (region.getLayoutManager() as Split).getPaneRatios();
}

function expectRatios(actual: number[], expected: number[]): void {
    expect(actual).toHaveLength(expected.length);
    expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 5));
}

// The default setup: H[T(a),T(b)], 800 px wide, ratios [0.5, 0.5].
function defaultDock(): { dock: Dock; root: Component } {
    const dock = regionsDock([['a'], ['b']]);

    flush();

    return { dock, root: dock.getRootRegion() };
}

describe('Dock "splitresize" — gutter gestures', () => {
    it('G1: fires once, synchronously, when a gutter drag ends, with the split state', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { dock, root } = defaultDock();
        const log = recordSplitResize(dock);
        const gutter = gutterOf(root, 0);

        gutter.onDragStart({ clientX: 400, clientY: 400 } as MouseEvent);
        expect(log).toHaveLength(0);

        gutter.onDrag({ clientX: 300, clientY: 300 } as MouseEvent);
        expect(log).toHaveLength(0);

        gutter.onDragStop();
        expect(log).toHaveLength(1);

        const event = log[0];

        expect(event.window).toBeNull();
        expectRatios(event.ratios, [0.375, 0.625]);
        expectRatios(event.ratios, (dock.getLayoutState().root as SplitNode).ratios);
        expect(event.collapsed).toEqual([false, false]);
        expect(event.panels).toEqual([['a'], ['b']]);
    });

    it('G2: fires once for a press and release that does not move the gutter', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { dock, root } = defaultDock();
        const log = recordSplitResize(dock);

        dragGutter(root, 0, 400, 400);

        expect(log).toHaveLength(1);
        expectRatios(log[0].ratios, [0.5, 0.5]);
    });

    it('G3: fires once per chevron collapse and expand', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { dock, root } = defaultDock();
        const log = recordSplitResize(dock);

        clickChevron(root, 0);
        clickChevron(root, 0);

        expect(log).toHaveLength(2);
        expect(log[0].collapsed).toEqual([true, false]);
        expect(log[1].collapsed).toEqual([false, false]);
        expectRatios(log[0].ratios, [0.5, 0.5]);
        expectRatios(log[1].ratios, [0.5, 0.5]);
    });

    it('G4: reports a collapse made by code on a region\'s Split', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { dock, root } = defaultDock();
        const log = recordSplitResize(dock);

        (root.getLayoutManager() as Split).setPaneCollapsed(0, true);

        expect(log).toHaveLength(1);
        expect(log[0].collapsed).toEqual([true, false]);
    });

    it('G5: off() removes a listener', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { dock, root } = defaultDock();
        const spy = vi.fn();

        dock.on('splitresize', spy);
        dock.off('splitresize', spy);
        dragGutter(root, 0, 400, 300);

        expect(spy).not.toHaveBeenCalled();
    });

    it('G6: a listener given in the options bag is called', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const spy = vi.fn();
        const dock = regionsDock([['a'], ['b']], { splitresize: spy });

        flush();
        dragGutter(dock.getRootRegion(), 0, 400, 300);

        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('G7: reports a collapsed pane expanded by the focus reveal', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { dock, root } = defaultDock();
        const split = root.getLayoutManager() as Split;

        split.setPaneCollapsed(0, true);

        const log = recordSplitResize(dock);

        // What FocusReveal.reveal runs for a control inside the collapsed pane
        // (keyboard navigation, FocusHistory back / forward).
        split.revealDescendant(frameOf(dock, 'a').getElement(true)!);

        expect(log).toHaveLength(1);
        expect(log[0].collapsed).toEqual([false, false]);
    });
});

describe('Dock "splitresize" — no event for container resizes and region-tree changes', () => {
    it('N1: a dock resize keeps the ratios and fires nothing', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { dock, root } = defaultDock();
        const log = recordSplitResize(dock);

        dock.setWidth(1000);
        dock.doLayout();
        flush();

        expect(log).toHaveLength(0);
        expectRatios(ratiosOf(root), [0.5, 0.5]);
    });

    it('N2: a dock resize that drifts a pinned pane\'s ratio fires nothing', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { dock, root } = defaultDock();
        const log = recordSplitResize(dock);

        (root.getLayoutManager() as Split).setPaneResizeWeight(root.getComponents()[0], 0);
        dock.doLayout();
        dock.setWidth(1000);
        dock.doLayout();
        flush();

        expect(log).toHaveLength(0);
        expect(ratiosOf(root)[0]).not.toBeCloseTo(0.5, 3);
    });

    it('N3: splitPanel with a ratio into a laid-out split fires nothing', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { dock, root } = defaultDock();
        const log = recordSplitResize(dock);

        expect(dock.splitPanel('a', specC(), 'right', { ratio: 0.4 })).toBe(true);
        dock.doLayout();
        flush();

        expect(log).toHaveLength(0);
        expectRatios(ratiosOf(root), [0.3, 0.2, 0.5]);
    });

    it('N4: splitPanel that wraps a group fires nothing', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { dock, root } = defaultDock();
        const log = recordSplitResize(dock);

        expect(dock.splitPanel('a', specC(), 'bottom')).toBe(true);
        dock.doLayout();
        flush();

        expect(log).toHaveLength(0);
        expect(root.getComponents()).toHaveLength(2);
        expect(ratiosOf(root.getComponents()[0])).toHaveLength(2);
    });

    it('N4b: splitPanel whose ratio rides in as pending pane sizes fires nothing at the new split\'s first layout', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { dock, root } = defaultDock();
        const log = recordSplitResize(dock);

        expect(dock.splitPanel('a', specC(), 'bottom', { ratio: 0.25 })).toBe(true);

        // Wire the new split while its ratio is still pending, so its first
        // layout drains the pending sizes with the dock already subscribed.
        const v = root.getComponents()[0];

        priv(dock).runSweep();
        expect(priv(dock)._wiring.get(v).wiredSplit.split).toBe(v.getLayoutManager());
        expect((v.getLayoutManager() as any)._pendingSizes).not.toBeNull();

        dock.doLayout();
        flush();

        expect((v.getLayoutManager() as any)._pendingSizes).toBeNull();
        expect(log).toHaveLength(0);
        expectRatios(ratiosOf(v), [0.75, 0.25]);
    });

    it('N5: a pane pruned when its last panel leaves fires nothing', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = regionsDock([['a'], ['b'], ['c']]);

        flush();

        const root = dock.getRootRegion();
        const bRegion = priv(dock).regionForFrame(frameOf(dock, 'b'));
        const log = recordSplitResize(dock);

        dock.removePanel('b');
        priv(dock).pruneRegion(bRegion);
        dock.doLayout();
        flush();

        expect(log).toHaveLength(0);
        expect(root.getComponents()).toHaveLength(2);
    });
});

describe('Dock "splitresize" — nested splits and floats', () => {
    // H[V[T(a),T(c)],T(b)], laid out and wired.
    function nestedDock(): { dock: Dock; root: Component; v: Component } {
        const { dock, root } = defaultDock();

        dock.splitPanel('a', specC(), 'bottom');
        flush();
        dock.doLayout();

        return { dock, root, v: root.getComponents()[0] };
    }

    it('P1: fires for a nested split, naming its own panes', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { dock, v } = nestedDock();
        const log = recordSplitResize(dock);

        dragGutter(v, 0, 300, 200);

        expect(log).toHaveLength(1);
        expect(log[0].window).toBeNull();
        expect(log[0].panels).toEqual([['a'], ['c']]);
        expectRatios(log[0].ratios, ratiosOf(v));
        expect(log[0].ratios[0]).toBeLessThan(0.5);
    });

    it('P2: an outer split\'s pane lists every panel inside it, nested split included', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { dock, root } = nestedDock();
        const log = recordSplitResize(dock);

        dragGutter(root, 0, 400, 300);

        expect(log).toHaveLength(1);
        expect(sortedPanels(log[0])).toEqual([['a', 'c'], ['b']]);
    });

    it('P3: fires for a split inside a float, naming the float', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
        dock.doLayout();
        flush();

        const win = floatPanel(dock, 'a');

        expect(dock.splitPanel('a', 'b', 'right')).toBe(true);
        flush();
        win.doLayout();

        const split = priv(dock).windowContent(win) as Component;
        const log = recordSplitResize(dock);

        dragGutter(split, 0, 100, 60);

        expect(log).toHaveLength(1);
        expect(log[0].window).toBe(win);
        expect(log[0].panels).toEqual([['a'], ['b']]);

        win.requestClose();
        flush();
    });
});

describe('Dock "splitresize" — restore and release', () => {
    // R1's restore of the default dock with pane 0 collapsed.
    function restoredDock(): { dock: Dock; root: Component; oldSplit: Split; log: DockSplitEvent[] } {
        const { dock, root } = defaultDock();
        const oldSplit = root.getLayoutManager() as Split;
        const state = dock.getLayoutState();

        (state.root as SplitNode).collapsed = [true, false];

        const log = recordSplitResize(dock);

        dock.setLayoutState(state);
        flush();
        dock.doLayout();

        return { dock, root, oldSplit, log };
    }

    it('R1: setLayoutState fires nothing, also for the panes it collapses', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { root, oldSplit, log } = restoredDock();

        expect(log).toHaveLength(0);
        expect(root.getLayoutManager()).not.toBe(oldSplit);
        expect((root.getLayoutManager() as Split).isPaneCollapsed(0)).toBe(true);
    });

    it('R2: the restored split is subscribed once', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { root, log } = restoredDock();

        clickChevron(root, 0);

        expect(log).toHaveLength(1);
        expect(log[0].collapsed).toEqual([false, false]);
    });

    it('R3: the replaced split instance is released', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { root, oldSplit, log } = restoredDock();

        clickChevron(root, 0);
        log.length = 0;

        (oldSplit as any).emit('paneresize', []);

        expect(log).toHaveLength(0);
    });

    it('R4: a split region pruned out of the tree is released', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const { dock, root } = defaultDock();

        dock.splitPanel('a', specC(), 'bottom');
        flush();
        dock.doLayout();

        const v = root.getComponents()[0];
        const vSplit = v.getLayoutManager() as Split;
        const cRegion = priv(dock).regionForFrame(frameOf(dock, 'c'));

        dock.removePanel('c');
        priv(dock).pruneRegion(cRegion);
        dock.doLayout();
        flush();

        const log = recordSplitResize(dock);

        (vSplit as any).emit('panecollapse', 0, true);

        expect(priv(dock)._wiring.has(v)).toBe(false);
        expect(log).toHaveLength(0);
    });
});
