// Offline coverage for plans/in-progress/drag-resize-outline-mode.md's
// `## Expected Behaviour` cases S1-S7: how a `Split` gutter drag behaves in
// each resize mode. The drag is driven through the gutter's own handlers, the
// path `scheduleDrag` actually sits on, as Split.test.ts's coalescing cases
// do; the frame capture is AbstractWindow.resizeFpsCoalescing.test.ts's.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import { Tooltip } from '~/overlay/Tooltip';
import { setAppResizeMode } from '~/core/ResizeDrag';
import type { ResizeMode } from '~/core/ResizeDrag';
import { Fit } from '~/layout/Fit';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Split } from '~/layout/Split';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** A cross-axis ceiling large enough never to bind, for the one pane that carries a max. */
const UNBOUND_HEIGHT = 10000;

/** The scene each drag case drives. */
interface Scene {
    host:   Container;
    split:  Split;
    lhs:    Component;
    rhs:    Component;
    gutter: { onDragStart(e: MouseEvent): unknown; onDrag(e: MouseEvent): unknown; onDragStop(): unknown } & Component;
}

/** A component's visual box: its laid-out position plus whatever translate moved it. */
function visualBox(component: Component): { x: number; y: number; width: number; height: number } {
    return {
        x:      component.getX() + component.getTranslateX(),
        y:      component.getY() + component.getTranslateY(),
        width:  component.getWidth(),
        height: component.getHeight(),
    };
}

/** A pane added with a resize weight, as the scene's two panes are. */
function weighted(weight: number): LayoutConstraints {
    const constraints = new LayoutConstraints();

    constraints.weight = weight;

    return constraints;
}

describe('Split resize mode', () => {
    let frames:      Map<number, FrameRequestCallback>;
    let nextFrameId: number;
    let hosts:       Container[];

    beforeEach(() => {
        installTestDOM(CONFIG);
        frames      = new Map();
        nextFrameId = 1;
        hosts       = [];
        vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            const id = nextFrameId++;

            frames.set(id, cb);

            return id;
        });
        vi.spyOn(DOM.sink, 'cancelAnimationFrame').mockImplementation((id: number) => {
            frames.delete(id);
        });
    });

    afterEach(() => {
        // A drag left mid-flight keeps its outline on screen, and with it the
        // two viewport listeners the outline registers. `Event`'s registration
        // maps are module state DOM.reset() does not clear, so a surviving
        // type map stops the next `addViewportListener` re-registering the
        // base listener against the fresh sink — and the case after this one
        // would hear no keydown at all. Disposing the host runs `Split.detach`,
        // which cancels the session exactly as a real teardown does.
        for (const host of hosts) {
            host.dispose();
        }

        vi.restoreAllMocks();
        // core/ResizeDrag.ts's app-wide default is module state DOM.reset()
        // does not touch; S7 sets it.
        setAppResizeMode('live');
        // A gutter or header attaches a tooltip, which installs `Tooltip`'s own
        // session-long viewport watch — a surviving `keydown` type map of
        // exactly the kind described above.
        Tooltip._stopPointerWatch();
        DOM.reset();
    });

    /** Runs every frame callback still pending since the last drain. */
    function flushFrame(): void {
        const pending = [...frames.values()];

        frames.clear();

        for (const cb of pending) {
            cb(performance.now());
        }
    }

    /**
     * The scene: a 400x300 host split horizontally into a 100 px pinned left
     * pane (min 60, max 250) and a flexible right pane (min 80).
     *
     * @param resizeMode - The split's own mode, or `undefined` to follow the
     *   app-wide default.
     * @returns The host, the split, the two panes and the gutter between them.
     */
    function scene(resizeMode?: ResizeMode): Scene {
        const split = new Split({ orientation: 'horizontal', resizeMode });
        const host  = new Container({ layoutManager: split });

        host.getElement(true);
        host.clearInsets();
        host.setWidth(400);
        host.setHeight(300);

        const lhs = new Component({ preferredSize: { width: 100, height: 300 } });
        const rhs = new Component({ preferredSize: { width: 100, height: 300 } });

        lhs.setMinSize({ width: 60, height: 0 });
        lhs.setMaxSize({ width: 250, height: UNBOUND_HEIGHT });
        rhs.setMinSize({ width: 80, height: 0 });
        lhs.getElement(true);
        rhs.getElement(true);

        host.addComponent(lhs, weighted(0));
        host.addComponent(rhs, weighted(1));
        host.doLayout();
        hosts.push(host);

        // Drop the layout-flush frames the scene's own construction queued, so
        // a drained frame below runs the drag's work and nothing else.
        frames.clear();

        const gutter = (split as unknown as { _gutters: Scene['gutter'][] })._gutters[0];

        return { host, split, lhs, rhs, gutter };
    }

    /** The outline the split's drag session has on screen, if any. */
    function outlineOf(split: Split): Component | null {
        return (split as unknown as { _resizeDrag: { _outline: Component | null } })._resizeDrag._outline;
    }

    /**
     * Presses the gutter at `clientX` 100 and drags it through `positions`,
     * draining one frame after each move.
     *
     * @param scn - The scene to drive.
     * @param positions - The pointer positions to move through.
     */
    function drive(scn: Scene, positions: number[]): void {
        scn.gutter.onDragStart({ clientX: 100 } as MouseEvent);

        for (const position of positions) {
            scn.gutter.onDrag({ clientX: position } as MouseEvent);
            flushFrame();
        }
    }

    it('S1. resolves its own mode first, then the app-wide default', () => {
        expect(new Split().getResizeMode()).toBe('live');
        expect(new Split({ resizeMode: 'outline' }).getResizeMode()).toBe('outline');

        setAppResizeMode('outline');

        expect(new Split().getResizeMode()).toBe('outline');
        expect(new Split({ resizeMode: 'live' }).getResizeMode()).toBe('live');

        const split = new Split({ resizeMode: 'live' });

        expect(split.setResizeMode(null)).toBe(split);
        expect(split.getResizeMode()).toBe('outline');
    });

    it('S2. an outline drag leaves the panes where they are', () => {
        const scn = scene('outline');
        const lhsLayout = vi.spyOn(scn.lhs, 'doLayout');
        const rhsLayout = vi.spyOn(scn.rhs, 'doLayout');

        expect(visualBox(scn.lhs)).toEqual({ x: 0, y: 0, width: 100, height: 300 });
        expect(visualBox(scn.gutter)).toEqual({ x: 97, y: 0, width: 10, height: 300 });
        expect(visualBox(scn.rhs)).toEqual({ x: 104, y: 0, width: 296, height: 300 });

        drive(scn, [140]);

        expect(visualBox(scn.lhs)).toEqual({ x: 0, y: 0, width: 100, height: 300 });
        expect(visualBox(scn.gutter)).toEqual({ x: 97, y: 0, width: 10, height: 300 });
        expect(visualBox(scn.rhs)).toEqual({ x: 104, y: 0, width: 296, height: 300 });
        expect(scn.split.getPaneSize(scn.lhs)).toBe(100);
        expect(lhsLayout).not.toHaveBeenCalled();
        expect(rhsLayout).not.toHaveBeenCalled();

        const outline = outlineOf(scn.split)!;

        expect(DOM.source.getParentElement(outline.getElement()!)).toBe(DOM.source.getParentElement(scn.gutter.getElement()!));
        expect(outline.getX()).toBe(100);
        expect(outline.getY()).toBe(0);
        expect(outline.getWidth()).toBe(4);
        expect(outline.getHeight()).toBe(300);
        expect(outline.getTranslateX()).toBe(40);
        expect(outline.getTranslateY()).toBe(0);
    });

    it('S3. the outline stops where the drag would stop', () => {
        const scn = scene('outline');

        drive(scn, [400]);

        // The left pane's own 250 max binds 150 px out.
        expect(outlineOf(scn.split)!.getTranslateX()).toBe(150);

        scn.gutter.onDrag({ clientX: 70 } as MouseEvent);
        flushFrame();

        expect(outlineOf(scn.split)!.getTranslateX()).toBe(-30);
    });

    it.each<[ResizeMode]>([
        ['outline'],
        ['live'],
    ])('S4. a %s release lands the panes in the same place', (mode) => {
        const scn = scene(mode);
        const resized = vi.fn();

        scn.split.on('paneresize', resized);

        drive(scn, [140, 400, 70]);
        scn.gutter.onDragStop();

        expect(visualBox(scn.lhs)).toEqual({ x: 0, y: 0, width: 70, height: 300 });
        expect(visualBox(scn.gutter)).toEqual({ x: 67, y: 0, width: 10, height: 300 });
        expect(visualBox(scn.rhs)).toEqual({ x: 74, y: 0, width: 326, height: 300 });
        expect(scn.split.getPaneSizes()).toEqual([{ unit: 'px', value: 70 }, { unit: 'ratio', value: 1 }]);
        expect(resized).toHaveBeenCalledTimes(1);
        expect(resized).toHaveBeenCalledWith(scn.split.getPaneSizes());
        expect(outlineOf(scn.split)).toBeNull();
    });

    it('S5. Escape cancels an outline drag and commits nothing', () => {
        const scn = scene('outline');
        const resized = vi.fn();

        scn.split.on('paneresize', resized);
        drive(scn, [140]);

        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(scn.host.getElement()!, 'keydown', { key: 'Escape' }));

        expect(outlineOf(scn.split)).toBeNull();

        scn.gutter.onDrag({ clientX: 200 } as MouseEvent);
        flushFrame();

        expect(visualBox(scn.lhs)).toEqual({ x: 0, y: 0, width: 100, height: 300 });

        scn.gutter.onDragStop();

        expect(visualBox(scn.lhs)).toEqual({ x: 0, y: 0, width: 100, height: 300 });
        expect(visualBox(scn.gutter)).toEqual({ x: 97, y: 0, width: 10, height: 300 });
        expect(visualBox(scn.rhs)).toEqual({ x: 104, y: 0, width: 296, height: 300 });
        expect(resized).not.toHaveBeenCalled();
    });

    it('S6. a detach mid-drag takes the outline down with it', () => {
        const scn = scene('outline');
        const before = Event.listenerCounts().viewport;

        drive(scn, [140]);

        const outline = outlineOf(scn.split)!;

        scn.host.setLayoutManager(new Fit());

        expect(DOM.source.getParentElement(outline.getElement()!)).toBeNull();
        expect(Event.listenerCounts().viewport).toBe(before);
    });

    it('S7. a split with no mode of its own follows the app-wide default', () => {
        setAppResizeMode('outline');

        const scn = scene();

        drive(scn, [140]);

        expect(outlineOf(scn.split)).not.toBeNull();
    });
});
