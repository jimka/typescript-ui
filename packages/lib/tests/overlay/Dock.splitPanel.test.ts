// Covers Dock.splitPanel — the programmatic form of dropping a tab on a region
// edge: the resulting region tree, the refused calls, the new pane's share,
// the host events the next sweep emits, and the panel's activation.
//
// The harness is the one Dock.lifecycle.test.ts uses: the dock gets a
// materialised, sized element so doLayout() registers region tabs, and the
// sweep's requestAnimationFrame callbacks are queued and drained by flush().
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Dock, DockPanelSpec } from '~/overlay/Dock';
import { Tab } from '~/layout/Tab';
import { Split } from '~/layout/Split';
import type { SplitNode } from '~/layout/LayoutSerialization';
import { Window } from '~/overlay/Window';
import { TabWindow } from '~/overlay/TabWindow';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { DOM, type Handle } from '~/core/DOM';
import { Button } from '~/component/button/Button';
import { installTestDOM, setConnected } from '../dom/TestDOM';
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

// A dock with one side-by-side tiled region per entry of `regions`, each
// holding the listed panel ids in order: H[T(…),T(…),…]. `layOut: false`
// leaves the dock sized but never laid out, as right after `new Dock`.
function regionsDock(regions: string[][], layOut: boolean = true): Dock {
    const dock = new Dock({
        layout: {
            split:    'horizontal',
            children: regions.map(ids => ({
                tabs: ids.map(id => ({ id, title: id.toUpperCase(), content: new Component({}) })),
            })),
        },
    });

    dock.getElement(true);
    dock.setWidth(800);
    dock.setHeight(600);

    if (layOut) {
        dock.doLayout();
    }

    return dock;
}

// A dock whose root is one tab group holding `ids` in order: T(ids…).
function tabsDock(ids: string[]): Dock {
    const dock = mountDock();

    for (const id of ids) {
        dock.addPanel({ id, title: id.toUpperCase(), content: new Component({}) });
    }

    dock.doLayout();
    flush();

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

// Tears panel `id` off the root tab group into a strip-mode TabWindow through
// Tab's own tear-off path, as Dock.panelPresentation.test.ts does.
function tearOffToTabWindow(dock: Dock, id: string): TabWindow {
    const tab = dock.getRootRegion().getLayoutManager() as Tab;
    const frame = frameOf(dock, id);

    (tab as unknown as {
        detachTabToWindow(id: string, content: Component, clientX: number, clientY: number, forceBare: boolean): void;
    }).detachTabToWindow(sourceTabEntryId(tab, frame), frame, 100, 100, false);

    priv(dock).scheduleSweep();
    flush();

    return AbstractWindow.getOpenWindows().find(w => w instanceof TabWindow) as TabWindow;
}

// Reaches Tab's private `_contents` for the strip-entry id hosting `content`.
function sourceTabEntryId(tab: Tab, content: Component): string {
    const contents = (tab as unknown as { _contents: Array<{ id: string; component: Component | null }> })._contents;

    return contents.find(e => e.component === content)!.id;
}

// Region tree as text: T(a,b) is a Tab region holding frames a and b in child
// order; H[…] / V[…] is a horizontal / vertical Split region.
function shape(region: Component): string {
    const lm = region.getLayoutManager();

    if (lm instanceof Split) {
        return `${lm.getOrientation() === 'horizontal' ? 'H' : 'V'}[${region.getComponents().map(shape).join(',')}]`;
    }

    return `T(${region.getComponents().map(child => child.getId()).join(',')})`;
}

// The content ids a Tab region's strip still has cells for.
function entries(region: Component): Array<string | undefined> {
    return ((region.getLayoutManager() as any)._contents as Array<{ component: Component | null }>)
        .map(entry => entry.component?.getId());
}

// The Tab region a frame sits in, read from its parent.
function regionOf(dock: Dock, id: string): Component {
    return frameOf(dock, id).getParentComponent()!;
}

function spec(id: string): DockPanelSpec {
    return { id, title: id.toUpperCase(), content: new Component({}) };
}

type HostEvent = { type: 'attach' | 'detach' | 'move'; id: string; window: unknown };

// Records every attach / detach / move as a {type, id, window} tuple.
function recordHostEvents(dock: Dock): HostEvent[] {
    const log: HostEvent[] = [];

    dock.on('detach', e => log.push({ type: 'detach', id: e.id, window: e.window }));
    dock.on('attach', e => log.push({ type: 'attach', id: e.id, window: e.window }));
    dock.on('move',   e => log.push({ type: 'move',   id: e.id, window: e.window }));

    return log;
}

// Records every "focus" as {id, window}.
function recordFocus(dock: Dock): Array<{ id: string; window: unknown } | null> {
    const log: Array<{ id: string; window: unknown } | null> = [];

    dock.on('focus', e => log.push(e ? { id: e.id, window: e.window } : null));

    return log;
}

// Records every dock event's name.
function recordAllEvents(dock: Dock): string[] {
    const log: string[] = [];

    for (const type of ['attach', 'detach', 'move', 'focus', 'close', 'emptychange'] as const) {
        dock.on(type as 'attach', () => log.push(type));
    }

    return log;
}

// A connected, focused page button outside the dock.
function focusedOutsideButton(): Handle {
    const el = new Button({ text: 'Outside' }).getElement(true)!;

    setConnected(el, true);
    DOM.sink.focus(el);

    return el;
}

function ratiosOf(region: Component): number[] {
    return (region.getLayoutManager() as Split).getPaneRatios();
}

function expectRatios(actual: number[], expected: number[]): void {
    expect(actual).toHaveLength(expected.length);
    expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 5));
}

describe('Dock.splitPanel structure', () => {
    it('St1: splits a moved tab out of its group to the right', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);

        expect(dock.splitPanel('a', 'b', 'right')).toBe(true);
        expect(shape(dock.getRootRegion())).toBe('H[T(a),T(b)]');
        expect(entries(regionOf(dock, 'a'))).toEqual(['a']);
    });

    it('St2: puts the new pane first for "left"', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);

        expect(dock.splitPanel('a', 'b', 'left')).toBe(true);
        expect(shape(dock.getRootRegion())).toBe('H[T(b),T(a)]');
    });

    it('St3: joins a same-direction split right after the target group', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = regionsDock([['a'], ['b']]);

        flush();

        expect(dock.splitPanel('a', spec('c'), 'right')).toBe(true);
        expect(shape(dock.getRootRegion())).toBe('H[T(a),T(c),T(b)]');
    });

    it('St4: wraps the target group in a perpendicular split for "bottom"', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = regionsDock([['a'], ['b']]);

        flush();

        expect(dock.splitPanel('a', spec('c'), 'bottom')).toBe(true);
        expect(shape(dock.getRootRegion())).toBe('H[V[T(a),T(c)],T(b)]');
    });

    it('St5: puts the new pane first in the wrap for "top"', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = regionsDock([['a'], ['b']]);

        flush();

        expect(dock.splitPanel('a', spec('c'), 'top')).toBe(true);
        expect(shape(dock.getRootRegion())).toBe('H[V[T(c),T(a)],T(b)]');
    });

    it('St6: prunes the emptied source group and collapses its one-pane split', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = regionsDock([['a'], ['b']]);

        flush();

        expect(dock.splitPanel('b', 'a', 'bottom')).toBe(true);
        expect(shape(dock.getRootRegion())).toBe('V[T(b),T(a)]');
        expect(entries(regionOf(dock, 'b'))).toEqual(['b']);
    });

    it('St7: splits the target itself out of its own group', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);

        expect(dock.splitPanel('a', 'a', 'right')).toBe(true);
        expect(shape(dock.getRootRegion())).toBe('H[T(b),T(a)]');
        expect(entries(regionOf(dock, 'b'))).toEqual(['b']);
    });
});

describe('Dock.splitPanel refused calls', () => {
    it('N1: refuses an unknown target and registers nothing', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a']);
        const events = recordAllEvents(dock);

        expect(dock.splitPanel('nope', spec('c'), 'right')).toBe(false);
        flush();

        expect(priv(dock)._panels.has('c')).toBe(false);
        expect(shape(dock.getRootRegion())).toBe('T(a)');
        expect(events).toEqual([]);
    });

    it('N2: refuses an unknown panel id', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a']);
        const events = recordAllEvents(dock);

        expect(dock.splitPanel('a', 'nope', 'right')).toBe(false);
        flush();

        expect(shape(dock.getRootRegion())).toBe('T(a)');
        expect(events).toEqual([]);
    });

    it("N3: refuses splitting the target's only tab beside itself", () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = regionsDock([['a'], ['b']]);

        flush();

        const events = recordAllEvents(dock);

        expect(dock.splitPanel('a', 'a', 'right')).toBe(false);
        flush();

        expect(shape(dock.getRootRegion())).toBe('H[T(a),T(b)]');
        expect(events).toEqual([]);
    });

    it('N4: refuses a panel that already sits alone beside the target on that side', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = regionsDock([['a'], ['b']]);

        flush();

        const events = recordAllEvents(dock);

        expect(dock.splitPanel('a', 'b', 'right')).toBe(false);
        expect(dock.splitPanel('b', 'a', 'left')).toBe(false);
        flush();

        expect(shape(dock.getRootRegion())).toBe('H[T(a),T(b)]');
        expect(events).toEqual([]);
    });

    it('N5: throws for a ratio outside (0, 1) before registering anything', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a']);
        const events = recordAllEvents(dock);

        for (const ratio of [0, 1, -0.5, 1.5, NaN]) {
            expect(() => dock.splitPanel('a', spec('c'), 'right', { ratio })).toThrow(Error);
        }

        flush();

        expect(priv(dock)._panels.has('c')).toBe(false);
        expect(shape(dock.getRootRegion())).toBe('T(a)');
        expect(events).toEqual([]);
    });

    it('N6: throws for a spec whose content factory returns a promise, as addPanel does', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const asyncSpec = (id: string): DockPanelSpec => ({ id, title: 'C', content: async () => new Component({}) });

        let addPanelError: unknown = null;

        try {
            mountDock().addPanel(asyncSpec('x'));
        } catch (error) {
            addPanelError = error;
        }

        expect(addPanelError).toBeInstanceOf(Error);

        const dock = tabsDock(['a']);

        expect(() => dock.splitPanel('a', asyncSpec('c'), 'right')).toThrow((addPanelError as Error).message);
        expect(shape(dock.getRootRegion())).toBe('T(a)');
    });

    it('N7: refuses a target in a strip-mode tear-off window', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);
        const tw = tearOffToTabWindow(dock, 'a');

        expect(tw).toBeDefined();

        const events = recordAllEvents(dock);

        expect(dock.splitPanel('a', 'b', 'right')).toBe(false);
        flush();

        expect(shape(dock.getRootRegion())).toBe('T(b)');
        expect(events).toEqual([]);

        tw.requestClose();
        flush();
    });
});

describe('Dock.splitPanel pane shares', () => {
    it('R1: gives a wrapped new pane the ratio on the right', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);

        expect(dock.splitPanel('a', spec('c'), 'right', { ratio: 0.25 })).toBe(true);

        const root = dock.getRootRegion();

        expect(shape(root)).toBe('H[T(a,b),T(c)]');
        // The new split holds the shares until its first layout, and reports them already.
        expectRatios(ratiosOf(root), [0.75, 0.25]);
        expectRatios((dock.getLayoutState().root as SplitNode).ratios, [0.75, 0.25]);

        dock.doLayout();
        expectRatios(ratiosOf(dock.getRootRegion()), [0.75, 0.25]);
    });

    it('R2: gives a wrapped new pane the ratio on the left', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);

        expect(dock.splitPanel('a', spec('c'), 'left', { ratio: 0.25 })).toBe(true);

        const root = dock.getRootRegion();

        expect(shape(root)).toBe('H[T(c),T(a,b)]');
        // The new split holds the shares until its first layout, and reports them already.
        expectRatios(ratiosOf(root), [0.25, 0.75]);
        expectRatios((dock.getLayoutState().root as SplitNode).ratios, [0.25, 0.75]);

        dock.doLayout();
        expectRatios(ratiosOf(dock.getRootRegion()), [0.25, 0.75]);
    });

    it("R3: carves the ratio out of the target group's share in an existing split", () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = regionsDock([['a'], ['b']]);

        flush();

        expect(dock.splitPanel('a', spec('c'), 'right', { ratio: 0.4 })).toBe(true);

        const root = dock.getRootRegion();

        expect(shape(root)).toBe('H[T(a),T(c),T(b)]');
        expectRatios(ratiosOf(root), [0.3, 0.2, 0.5]);

        dock.doLayout();
        expectRatios(ratiosOf(dock.getRootRegion()), [0.3, 0.2, 0.5]);
    });

    it('R4: sizes a joining pane as a drop does without a ratio', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = regionsDock([['a'], ['b']]);

        flush();

        expect(dock.splitPanel('a', spec('c'), 'right')).toBe(true);

        dock.doLayout();
        expectRatios(ratiosOf(dock.getRootRegion()), [1 / 3, 1 / 3, 1 / 3]);
    });

    it("R6: a wrapping pane keeps its ratio when the panes have minimum sizes", () => {
        installTestDOM(CONFIG);
        captureRaf();

        // Minimum widths below the panes' shares of the 800 px dock, so they
        // must not bend the split: a share seeded before the new split has a
        // size must still come out as the ratio once it is laid out.
        const minWidthContent = (width: number): Component => {
            const content = new Component({});

            content.setMinSize({ width, height: 0 });

            return content;
        };

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: minWidthContent(100) });
        dock.doLayout();
        flush();

        expect(dock.splitPanel('a', { id: 'c', title: 'C', content: minWidthContent(150) }, 'right', { ratio: 0.25 })).toBe(true);

        dock.doLayout();
        expectRatios(ratiosOf(dock.getRootRegion()), [0.75, 0.25]);
    });

    it('R5: sizes a wrapping pane as a drop does without a ratio', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);

        expect(dock.splitPanel('a', spec('c'), 'right')).toBe(true);

        dock.doLayout();
        expectRatios(ratiosOf(dock.getRootRegion()), [0.5, 0.5]);
    });

    it("R7: a second split joining a not-yet-laid-out wrap keeps the wrap's ratio, without a warning", () => {
        installTestDOM(CONFIG);
        captureRaf();

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        // Two splits in one task: the first wraps with a ratio, the second
        // joins that wrap before its first layout, with `second` as its ratio.
        const splitTwice = (second: number | undefined): Dock => {
            const dock = tabsDock(['a', 'b']);

            expect(dock.splitPanel('a', spec('c'), 'bottom', { ratio: 0.3 })).toBe(true);
            expect(dock.splitPanel('a', spec('d'), 'bottom', { ratio: second })).toBe(true);

            dock.doLayout();

            return dock;
        };

        const withoutRatio = splitTwice(undefined);
        const withRatio    = splitTwice(0.5);

        expect(shape(withRatio.getRootRegion())).toBe('V[T(a,b),T(d),T(c)]');
        // Without a ratio the new pane takes its drop third from both panes.
        expectRatios(ratiosOf(withoutRatio.getRootRegion()), [0.7 * 2 / 3, 1 / 3, 0.3 * 2 / 3]);
        expectRatios(ratiosOf(withRatio.getRootRegion()), [0.35, 0.35, 0.3]);
        expect(warn).not.toHaveBeenCalled();
    });

    it('R10: a ratio joining a split changed since its last layout divides the target\'s share; the earlier pane still takes its drop share', () => {
        installTestDOM(CONFIG);
        captureRaf();

        // A laid-out 90 / 10 split gains an unsized pane from a split without
        // a ratio; a second split in the same task divides the target's share.
        const splitTwice = (ratio: number | undefined): Dock => {
            const dock = regionsDock([['a'], ['b']]);

            flush();
            (dock.getRootRegion().getLayoutManager() as Split).applyPaneRatios([0.9, 0.1]);
            dock.doLayout();

            expect(dock.splitPanel('a', spec('c'), 'right')).toBe(true);
            expect(dock.splitPanel('a', spec('d'), 'left', { ratio })).toBe(true);

            dock.doLayout();

            return dock;
        };

        const withRatio    = splitTwice(0.5);
        const withoutRatio = splitTwice(undefined);

        expect(shape(withRatio.getRootRegion())).toBe('H[T(d),T(a),T(c),T(b)]');
        expectRatios(ratiosOf(withRatio.getRootRegion()), [0.3375, 0.3375, 0.25, 0.075]);
        expectRatios(ratiosOf(withoutRatio.getRootRegion()), [0.25, 0.45, 0.25, 0.05]);
    });

    it("R8: a ratio joining a split that was never laid out carves the target's share", () => {
        installTestDOM(CONFIG);
        captureRaf();

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        // Straight after construction: the root split has no size yet.
        const dock = regionsDock([['a'], ['b']], false);

        expect(dock.splitPanel('a', spec('c'), 'right', { ratio: 0.4 })).toBe(true);

        const root = dock.getRootRegion();

        expect(shape(root)).toBe('H[T(a),T(c),T(b)]');
        expectRatios(ratiosOf(root), [0.3, 0.2, 0.5]);
        expectRatios((dock.getLayoutState().root as SplitNode).ratios, [0.3, 0.2, 0.5]);

        dock.doLayout();
        expectRatios(ratiosOf(dock.getRootRegion()), [0.3, 0.2, 0.5]);
        expect(warn).not.toHaveBeenCalled();
    });

    it('R9: a ratio joining a never-laid-out split keeps the carve when a pane has a large minimum width', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const minWidthSpec = (id: string, width: number): DockPanelSpec => {
            const content = new Component({});

            content.setMinSize({ width, height: 0 });

            return { id, title: id.toUpperCase(), content };
        };

        // Mixed minimum widths, one of them most of the 800 px dock, in a
        // split that has not been laid out yet.
        const dock = new Dock({ layout: { split: 'horizontal', children: [{ tabs: [minWidthSpec('a', 0)] }, { tabs: [minWidthSpec('b', 500)] }] } });

        dock.getElement(true);
        dock.setWidth(800);
        dock.setHeight(600);

        expect(dock.splitPanel('a', minWidthSpec('c', 0), 'right', { ratio: 0.4 })).toBe(true);

        dock.doLayout();

        const withRatio = ratiosOf(dock.getRootRegion());

        // No pane squeezed to a pixel or two of the 800 px dock, and the new
        // pane keeps 0.4 of the target's share against the target's 0.6.
        withRatio.forEach(share => expect(share * 800).toBeGreaterThan(100));
        expect(withRatio[1] / withRatio[0]).toBeCloseTo(2 / 3, 5);
    });

    it("R11: a ratio is ignored when the target's group itself joined in this task without one", () => {
        installTestDOM(CONFIG);
        captureRaf();

        const splitTwice = (ratio: number | undefined): Dock => {
            const dock = regionsDock([['a'], ['b']]);

            flush();

            expect(dock.splitPanel('a', spec('c'), 'right')).toBe(true);
            expect(dock.splitPanel('c', spec('d'), 'right', { ratio })).toBe(true);

            dock.doLayout();

            return dock;
        };

        const withRatio    = splitTwice(0.25);
        const withoutRatio = splitTwice(undefined);

        expect(shape(withRatio.getRootRegion())).toBe('H[T(a),T(c),T(d),T(b)]');
        expectRatios(ratiosOf(withRatio.getRootRegion()), [0.25, 0.25, 0.25, 0.25]);
        expectRatios(ratiosOf(withoutRatio.getRootRegion()), [0.25, 0.25, 0.25, 0.25]);
    });

    it("R12: in a split where no pane has a share yet, a ratio carves the target's equal share", () => {
        installTestDOM(CONFIG);
        captureRaf();

        // Straight after construction, the first split stores no share, so the
        // second one counts every pane as an equal share, the target included.
        const splitTwice = (ratio: number | undefined): Dock => {
            const dock = regionsDock([['a'], ['b']], false);

            expect(dock.splitPanel('a', spec('c'), 'right')).toBe(true);
            expect(dock.splitPanel('c', spec('d'), 'right', { ratio })).toBe(true);

            dock.doLayout();

            return dock;
        };

        const withRatio    = splitTwice(0.25);
        const withoutRatio = splitTwice(undefined);

        expect(shape(withRatio.getRootRegion())).toBe('H[T(a),T(c),T(d),T(b)]');
        expectRatios(ratiosOf(withRatio.getRootRegion()), [1 / 3, 0.25, 1 / 12, 1 / 3]);
        expectRatios(ratiosOf(withoutRatio.getRootRegion()), [0.25, 0.25, 0.25, 0.25]);
    });
});

describe('Dock.splitPanel events', () => {
    it('E1: a panel moved within the tiled tree fires "move"', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = regionsDock([['a', 'b'], ['c']]);

        flush();

        const events = recordHostEvents(dock);

        expect(dock.splitPanel('c', 'b', 'bottom')).toBe(true);
        expect(shape(dock.getRootRegion())).toBe('H[T(a),V[T(c),T(b)]]');
        expect(entries(regionOf(dock, 'a'))).toEqual(['a']);

        flush();

        expect(events).toEqual([{ type: 'move', id: 'b', window: null }]);
    });

    it('E2: a newly opened panel fires "attach"', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = regionsDock([['a'], ['b']]);

        flush();

        const events = recordHostEvents(dock);

        expect(dock.splitPanel('a', spec('c'), 'right')).toBe(true);
        flush();

        expect(events).toEqual([{ type: 'attach', id: 'c', window: null }]);
    });

    it('E3: a closed panel is opened again and fires "attach"', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a']);

        dock.addPanel({ id: 'c', title: 'C', content: () => new Component({}) });
        dock.doLayout();
        flush();
        dock.removePanel('c');
        flush();

        const events = recordHostEvents(dock);

        expect(dock.splitPanel('a', 'c', 'right')).toBe(true);
        expect(shape(dock.getRootRegion())).toBe('H[T(a),T(c)]');

        flush();

        expect(events).toEqual([{ type: 'attach', id: 'c', window: null }]);
    });

    it('E4: a split beside a panel in a bare float happens inside the float', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);
        const win = floatPanel(dock, 'a');

        // floatPanel's sweep ran before the float's Tab made a's cell, so the
        // region ledger still names the root for a; settle it with one more
        // sweep so the events below are the split's alone.
        priv(dock).scheduleSweep();
        flush();

        const events = recordHostEvents(dock);

        expect(dock.splitPanel('a', 'b', 'right')).toBe(true);
        expect(shape(priv(dock).windowContent(win))).toBe('H[T(a),T(b)]');
        expect(shape(dock.getRootRegion())).toBe('T()');

        flush();

        expect(events).toEqual([
            { type: 'detach', id: 'b', window: null },
            { type: 'attach', id: 'b', window: win },
        ]);
    });

    it('E5: a panel taken out of a strip-mode tear-off window leaves it and fires detach then attach', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);
        const tw = tearOffToTabWindow(dock, 'a');
        const events = recordHostEvents(dock);

        expect(dock.splitPanel('b', 'a', 'right')).toBe(true);
        expect((tw.getLayoutManager() as Tab).isEmpty()).toBe(true);
        expect(shape(dock.getRootRegion())).toBe('H[T(b),T(a)]');

        flush();

        expect(events).toEqual([
            { type: 'detach', id: 'a', window: tw },
            { type: 'attach', id: 'a', window: null },
        ]);
    });

    it('E6: moves a panel added in the same task, before its tab cell exists', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel(spec('a'));
        dock.doLayout();
        flush();

        const events = recordHostEvents(dock);

        dock.addPanel(spec('d'));

        const rootRegion = dock.getRootRegion();

        expect(dock.splitPanel('a', 'd', 'right')).toBe(true);
        expect(shape(dock.getRootRegion())).toBe('H[T(a),T(d)]');
        expect(entries(regionOf(dock, 'a'))).toEqual(['a']);
        expect(regionOf(dock, 'a')).toBe(rootRegion);
        expect((rootRegion.getLayoutManager() as unknown as { _pendingActiveContent: Component | null })._pendingActiveContent).toBeNull();

        dock.doLayout();
        flush();

        expect(events).toEqual([{ type: 'attach', id: 'd', window: null }]);
    });

    it('E7: splits beside a target added in the same task', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();
        const events = recordHostEvents(dock);

        dock.addPanel(spec('a'));

        expect(dock.splitPanel('a', spec('c'), 'right')).toBe(true);
        expect(shape(dock.getRootRegion())).toBe('H[T(a),T(c)]');

        dock.doLayout();
        flush();

        expect(events).toEqual([
            { type: 'attach', id: 'a', window: null },
            { type: 'attach', id: 'c', window: null },
        ]);
    });
});

describe('Dock.splitPanel activation and focus', () => {
    it('F1: activates the panel and fires "focus" before returning', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);
        const focus = recordFocus(dock);

        expect(dock.splitPanel('a', spec('c'), 'right')).toBe(true);
        expect(focus).toEqual([{ id: 'c', window: null }]);
        expect(dock.focusPanel('c')).toBe(true);
    });

    it('F2: a moved panel fires "focus" before returning', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = regionsDock([['a', 'b'], ['c']]);

        flush();
        dock.focusPanel('c');
        flush();

        const focus = recordFocus(dock);

        expect(dock.splitPanel('c', 'a', 'bottom')).toBe(true);
        expect(focus).toEqual([{ id: 'a', window: null }]);
    });

    it('F10: moving the already-focused panel fires no "focus"; the sweep reports the move', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);

        dock.focusPanel('b');
        flush();

        const focus = recordFocus(dock);
        const events = recordHostEvents(dock);

        expect(dock.splitPanel('b', 'b', 'right')).toBe(true);
        expect(focus).toEqual([]);

        flush();

        expect(events).toEqual([{ type: 'move', id: 'b', window: null }]);
        expect(focus).toEqual([]);
    });

    it('F11: the already-focused panel taken out of a tear-off window fires no "focus"; detach and attach report the host change', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);
        const tw = tearOffToTabWindow(dock, 'a');

        dock.focusPanel('a');
        flush();

        const focus = recordFocus(dock);
        const events = recordHostEvents(dock);

        expect(dock.splitPanel('b', 'a', 'right')).toBe(true);

        flush();

        expect(focus).toEqual([]);
        expect(events).toEqual([
            { type: 'detach', id: 'a', window: tw },
            { type: 'attach', id: 'a', window: null },
        ]);
    });

    it('F3: the next addPanel opens beside the split panel', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);

        expect(dock.splitPanel('a', 'a', 'right')).toBe(true);

        dock.addPanel(spec('d'));
        dock.doLayout();
        flush();

        expect(shape(dock.getRootRegion())).toBe('H[T(b),T(a,d)]');
    });

    it('F4: { focus: false } raises a float holding the target without moving focus', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);
        const win = floatPanel(dock, 'a');

        dock.focusPanel('b');
        flush();

        const outside = focusedOutsideButton();
        const focus = recordFocus(dock);

        expect(dock.splitPanel('a', spec('c'), 'right', { focus: false })).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(outside);
        expect(focus[focus.length - 1]).toEqual({ id: 'c', window: win });
    });

    it("F5: with focus omitted, a float holding the target takes focus by its autoFocus", () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);
        const win = floatPanel(dock, 'a');

        dock.focusPanel('b');
        flush();
        focusedOutsideButton();

        expect(dock.splitPanel('a', spec('c'), 'right')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(win.getElement());
    });

    it('F7: { focus: true } on a tiled split does not focus the new tab', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);
        const focusSpy = vi.spyOn(DOM.sink, 'focus');

        expect(dock.splitPanel('a', spec('c'), 'right', { focus: true })).toBe(true);
        expect(focusSpy).not.toHaveBeenCalled();

        // Nor later, when the layout pass and the sweep run.
        dock.doLayout();
        flush();

        expect(focusSpy).not.toHaveBeenCalled();
    });

    it("F8: focus on the moved panel's old tab moves to a tab left in its old group", () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);
        const oldRegion = regionOf(dock, 'b');

        dock.focusPanel('b', { focus: false });

        const buttonOf = (region: Component, id: string): Handle => {
            const bar = (region.getLayoutManager() as unknown as { _bar: unknown })._bar as {
                _entries: Array<{ id: string; button: Component }>;
            };
            const entryId = sourceTabEntryId(region.getLayoutManager() as Tab, frameOf(dock, id));

            return bar._entries.find(entry => entry.id === entryId)!.button.getElement()!;
        };
        const survivor = buttonOf(oldRegion, 'a');

        DOM.sink.focus(buttonOf(oldRegion, 'b'));

        expect(dock.splitPanel('b', 'b', 'right')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(survivor);
    });

    it('F9: { focus: true } takes focus into a float built with autoFocus off', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);
        const win = floatPanel(dock, 'a');

        win.setAutoFocus(false);
        dock.focusPanel('b');
        flush();
        focusedOutsideButton();

        expect(dock.splitPanel('a', spec('c'), 'right', { focus: true })).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(win.getElement());
    });

    it('F6: a tiled split moves no keyboard focus', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = tabsDock(['a', 'b']);
        const outside = focusedOutsideButton();

        expect(dock.splitPanel('a', spec('c'), 'right')).toBe(true);
        expect(DOM.source.getActiveElement()).toBe(outside);
    });
});
