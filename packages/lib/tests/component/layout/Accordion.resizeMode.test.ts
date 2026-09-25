// Offline coverage for plans/in-progress/drag-resize-outline-mode.md's
// `## Expected Behaviour` cases A1-A4: how a resizable `Accordion` gutter drag
// behaves in each resize mode. The drag runs through the gutter's own
// handlers, the path `scheduleGutterDrag` sits on; the frame capture is
// AbstractWindow.resizeFpsCoalescing.test.ts's.
//
// The scene is deliberately awkward, because an accordion drag is incremental:
// a closed section between open ones, one section the resize pass pins (it
// carries no weight while its siblings do), and a container shrunk after the
// first layout so the stored-to-rendered scale factor is not 1. An outline
// drag has to replay every frame on its own shadow heights to land where a
// live drag lands.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { DOM } from '~/core/DOM';
import { setAppResizeMode } from '~/core/ResizeDrag';
import type { ResizeMode } from '~/core/ResizeDrag';
import { Tooltip } from '~/overlay/Tooltip';
import { Accordion } from '~/layout/Accordion';
import { AccordionConstraints } from '~/layout/AccordionConstraints';
import { Fit } from '~/layout/Fit';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** A cross-axis ceiling large enough never to bind on a section that carries a max. */
const UNBOUND_WIDTH = 100000;

/** One section of the scene: label, preferred height, min, max, open, resize weight. */
const SECTIONS: { label: string; preferred: number; min: number; max?: number; open: boolean; weight?: number }[] = [
    { label: 'A', preferred: 80,  min: 40, max: 160, open: true,  weight: 1 },
    { label: 'B', preferred: 80,  min: 30, open: true },
    { label: 'X', preferred: 50,  min: 10, open: false },
    { label: 'C', preferred: 120, min: 60, max: 200, open: true,  weight: 2 },
    { label: 'D', preferred: 100, min: 20, open: true,  weight: 1 },
];

/** The pointer positions the middle gutter is dragged through, with reversals and chain spills. */
const DRIVE = [40, 160, 250, -90, -260, 30, 290, 12];

/** The scene each case drives. */
interface Scene {
    host:      Container;
    accordion: Accordion;
    sections:  Component[];
    gutter:    { onDragStart(e: MouseEvent): unknown; onDrag(e: MouseEvent): unknown; onDragStop(): unknown } & Component;
}

/** Three decimals is well inside the drag arithmetic's own precision and reads as the plan's figures. */
const HEIGHT_PRECISION = 3;

/** Five decimals, the precision `getSectionSizes`' ratios are quoted at. */
const RATIO_PRECISION = 5;

describe('Accordion resize mode', () => {
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
        // maps are module state DOM.reset() does not clear, so a surviving type
        // map stops the next `addViewportListener` re-registering the base
        // listener against the fresh sink. Disposing the host runs
        // `Accordion.detach`, which cancels the session as a real teardown does.
        for (const host of hosts) {
            host.dispose();
        }

        vi.restoreAllMocks();
        setAppResizeMode('live');
        // A header's own tooltip installs `Tooltip`'s session-long viewport
        // watch — a surviving `keydown` type map of exactly the kind described
        // above.
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
     * The scene: five sections, one of them closed, laid out at 700 px and
     * then shrunk to 560 so the stored-to-rendered scale is not 1.
     *
     * @param resizeMode - The accordion's own mode.
     * @returns The host, the accordion, its sections and the middle gutter.
     */
    function scene(resizeMode: ResizeMode): Scene {
        const accordion = new Accordion();

        accordion.setHeaderHeight(30);
        accordion.setResizable(true);
        accordion.setResizeMode(resizeMode);

        const host = new Container({ layoutManager: accordion });

        host.getElement(true);
        host.clearInsets();
        host.setWidth(400);
        host.setHeight(700);

        const sections = SECTIONS.map(spec => {
            const section = new Component({ preferredSize: { width: 100, height: spec.preferred } });

            section.setMinSize({ width: 0, height: spec.min });

            if (spec.max !== undefined) {
                section.setMaxSize({ width: UNBOUND_WIDTH, height: spec.max });
            }

            section.getElement(true);

            const constraints = new AccordionConstraints(spec.label, spec.open);

            if (spec.weight !== undefined) {
                constraints.weight = spec.weight;
            }

            host.addComponent(section, constraints);

            return section;
        });

        host.doLayout();
        host.setHeight(560);
        host.doLayout();
        hosts.push(host);

        // Drop the layout-flush frames the scene's own construction queued, so
        // a drained frame below runs the drag's work and nothing else.
        frames.clear();

        const gutter = (accordion as unknown as { _resizeGutters: Scene['gutter'][] })._resizeGutters[1];

        return { host, accordion, sections, gutter };
    }

    /** The outline the accordion's drag session has on screen, if any. */
    function outlineOf(accordion: Accordion): Component | null {
        return (accordion as unknown as { _resizeDrag: { _outline: Component | null } })._resizeDrag._outline;
    }

    /**
     * Presses the middle gutter at `clientY` 0 and drags it through
     * `positions`, draining one frame after each move.
     *
     * @param scn - The scene to drive.
     * @param positions - The pointer positions to move through.
     */
    function drive(scn: Scene, positions: number[] = DRIVE): void {
        scn.gutter.onDragStart({ clientY: 0 } as MouseEvent);

        for (const position of positions) {
            scn.gutter.onDrag({ clientY: position } as MouseEvent);
            flushFrame();
        }
    }

    /** Every section's height, in section order. */
    function heights(scn: Scene): number[] {
        return scn.sections.map(section => section.getHeight());
    }

    it('A1. an outline drag leaves the sections where they are', () => {
        const scn    = scene('outline');
        const before = heights(scn);

        expect(before[0]).toBeCloseTo(87.766, HEIGHT_PRECISION);
        expect(scn.gutter.getY()).toBeCloseTo(221.766, HEIGHT_PRECISION);

        drive(scn);

        expect(heights(scn)).toEqual(before);

        const outline = outlineOf(scn.accordion)!;

        expect(outline.getX()).toBe(0);
        expect(outline.getY()).toBeCloseTo(222.766, HEIGHT_PRECISION);
        expect(outline.getWidth()).toBe(400);
        expect(outline.getHeight()).toBe(4);
        // The sum of A's and B's height changes in the shadow heights, which
        // is where the gutter itself ends up.
        expect(outline.getTranslateY()).toBeCloseTo(12, 9);
    });

    it.each<[ResizeMode]>([
        ['outline'],
        ['live'],
    ])('A2. a %s release lands the sections in the same place', (mode) => {
        const scn = scene(mode);
        const resized = vi.fn();

        scn.accordion.on('sectionresize', resized);

        drive(scn);
        scn.gutter.onDragStop();

        const after = heights(scn);

        expect(after[0]).toBeCloseTo(40, HEIGHT_PRECISION);
        expect(after[1]).toBeCloseTo(139.766, HEIGHT_PRECISION);
        expect(after[2]).toBe(50);
        expect(after[3]).toBeCloseTo(200, HEIGHT_PRECISION);
        expect(after[4]).toBeCloseTo(30.234, HEIGHT_PRECISION);
        expect(scn.gutter.getY()).toBeCloseTo(233.766, HEIGHT_PRECISION);

        const sizes = scn.accordion.getSectionSizes();

        expect(sizes.map(size => size.unit)).toEqual(['ratio', 'px', 'px', 'ratio', 'ratio']);
        expect(sizes[0].value).toBeCloseTo(0.14802, RATIO_PRECISION);
        expect(sizes[1].value).toBeCloseTo(139.766, HEIGHT_PRECISION);
        expect(sizes[2].value).toBe(0);
        expect(sizes[3].value).toBeCloseTo(0.74010, RATIO_PRECISION);
        expect(sizes[4].value).toBeCloseTo(0.11188, RATIO_PRECISION);
        expect(resized).toHaveBeenCalledTimes(1);
        expect(outlineOf(scn.accordion)).toBeNull();
    });

    it('A3. Escape cancels an outline drag and commits nothing', () => {
        const scn     = scene('outline');
        const before  = heights(scn);
        const resized = vi.fn();

        scn.accordion.on('sectionresize', resized);
        drive(scn, [40, 160]);

        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(scn.host.getElement()!, 'keydown', { key: 'Escape' }));

        expect(outlineOf(scn.accordion)).toBeNull();

        scn.gutter.onDragStop();

        expect(heights(scn)).toEqual(before);
        expect(resized).not.toHaveBeenCalled();
    });

    it('A4. a detach mid-drag takes the outline down with it and commits nothing', () => {
        const scn     = scene('outline');
        const resized = vi.fn();

        scn.accordion.on('sectionresize', resized);
        drive(scn, [40]);

        const outline = outlineOf(scn.accordion)!;

        scn.host.setLayoutManager(new Fit());

        expect(DOM.source.getParentElement(outline.getElement()!)).toBeNull();
        expect(resized).not.toHaveBeenCalled();
    });

    it('A4. a live detach mid-drag still fires sectionresize once, as it does today', () => {
        const scn     = scene('live');
        const resized = vi.fn();

        scn.accordion.on('sectionresize', resized);
        drive(scn, [40]);
        scn.host.setLayoutManager(new Fit());

        expect(resized).toHaveBeenCalledTimes(1);
    });
});
