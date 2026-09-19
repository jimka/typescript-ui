// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for `Border`'s per-pass region size record: each region's
 * `{preferred, min, max}` triple is computed at most once per layout pass and
 * re-served for the rest of that pass, with geometry unchanged. Case numbers
 * below refer to `plans/border-region-size-memo.md`'s `## Expected Behaviour`
 * list.
 *
 * The five-region scene reproduces slice 06's probe `T1` exactly — before the
 * record, one `outer.doLayout()` asks each edge region for its preferred size
 * 5 times, its minimum 8 and its maximum 3, and the centre 4/3/3.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Border } from '~/layout/Border';
import { VBox } from '~/layout/VBox';
import { LayoutManager } from '~/layout/LayoutManager';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Placement } from '~/primitive/Placement';
import { Size } from '~/primitive/Size';
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

/** Preferred width of the single child each region wraps — the scene probe `T1` used. */
const CHILD_WIDTH = 40;

/** Preferred height of that child. */
const CHILD_HEIGHT = 20;

/**
 * The border host's own box: exactly the five-region border's preferred size
 * in this scene, so the outer `VBox` hands the border its preferred rect and
 * the committed geometry is the border's own arithmetic rather than a clamp.
 */
const HOST_WIDTH  = 120;
const HOST_HEIGHT = 60;

/**
 * Preferred width of the replacement child a mid-pass mutation introduces —
 * wide enough that the border's reported width moves visibly when the new
 * number is read and stays put when a stale one is re-served.
 */
const WIDE_CHILD_WIDTH = 90;

/**
 * Explicit minimum height of the collapse case's west region — taller than
 * anything else in that scene, so the border's own reported minimum height is
 * that region's alone and a substituted (or deflated) answer is unmistakable.
 */
const WEST_MIN_HEIGHT = 90;

/**
 * Comfortably past the 200 ms collapse duration plus its 40 ms fallback
 * buffer, so one flush lands every geometry frame on its end state and every
 * primed transition's fallback timer fires. Mirrors
 * `Border.collapseUndisplay.test.ts`.
 */
const PAST_FALLBACK_MS = 1000;

/**
 * Upper bound on flush rounds, as in `Border.collapseUndisplay.test.ts`: at a
 * past-duration timestamp the geometry loop settles in one frame and an
 * effective-visibility reconcile schedules at most one more, so a run needing
 * more than a handful is a loop, not progress.
 */
const MAX_FLUSH_ROUNDS = 8;

/** The five slots, in the order the scene builds them. */
const PLACEMENTS = [Placement.NORTH, Placement.SOUTH, Placement.WEST, Placement.EAST, Placement.CENTER] as const;

/** How many times one region was asked for each of its three size reports. */
interface SizeCallCounts {
    preferred: number;
    min:       number;
    max:       number;
}

/** The scene a case drives: the outer host, the border's container, its manager, and its five regions. */
interface Scene {
    outer:   Container;
    host:    Container;
    border:  Border;
    regions: Record<Placement, Container>;
}

/**
 * A region component that reports no preferred size, which is what makes
 * `Border.doLayout` throw for its slot.
 */
class NoPreferredSizeRegion extends Component {
    getPreferredSize(): Size | null {
        return null;
    }
}

/**
 * A region whose manager reports nothing at all on any axis — the `null` that
 * is a real answer, and that the record must hand back rather than recompute.
 * Safe in CENTER, which `doLayout` never demands a preferred size from.
 */
class NoSizeRegion extends Component {
    getPreferredSize(): Size | null {
        return null;
    }

    getMinSize(): Size | null {
        return null;
    }

    getMaxSize(): Size | null {
        return null;
    }
}

/**
 * A host manager that reads its single child's preferred size twice, with a
 * caller-supplied step in between — the shape no shipped manager has, and the
 * one that exercises a second read taken after the border's own state moved on.
 */
class DoubleReadProbe extends LayoutManager {
    /** The preferred sizes the two reads returned, in order. */
    readonly reads: Array<Size | null> = [];

    /**
     * @param target - The border's container, read on both sides of `between`.
     * @param between - The step run between the two reads.
     */
    constructor(private readonly target: Component, private readonly between: () => void) {
        // LayoutManager's constructor takes no options.
        super();
    }

    /** Reads the target's preferred size, runs the interposed step, reads again. */
    doLayout(): void {
        this.reads.push(this.target.getPreferredSize());

        this.between();

        this.reads.push(this.target.getPreferredSize());
    }

    /**
     * Commits the target at the scene's host box, laying the border out.
     * Exposed so a case can schedule the commit as its interposed step.
     */
    commitTarget(): void {
        this.commitBounds(this.target, 0, 0, HOST_WIDTH, HOST_HEIGHT);
    }
}

let frames: FrameRequestCallback[] = [];

/** Installs the modelled DOM, fake timers, and the frame-capturing rAF spy. */
function installWithFrames(): void {
    installTestDOM(CONFIG);

    frames = [];
    vi.useFakeTimers();
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);

        return frames.length;
    });
}

/** Runs every captured frame past the collapse duration, then any frames those callbacks scheduled in turn. */
function flushFrames(): void {
    for (let round = 0; round < MAX_FLUSH_ROUNDS && frames.length > 0; round += 1) {
        const pending = frames;

        frames = [];

        for (const cb of pending) {
            cb(performance.now() + PAST_FALLBACK_MS);
        }
    }
}

/** Settles an in-flight collapse: the geometry loop reaches its last frame, then the transition fallbacks fire. */
function settle(): void {
    flushFrames();
    vi.advanceTimersByTime(PAST_FALLBACK_MS);
    flushFrames();
}

/**
 * A `placement` constraint. No region in this suite is collapsible unless the
 * case asks for it.
 *
 * @param value - The region slot.
 * @param collapsible - Whether the region may be collapsed.
 * @returns The constraint.
 */
function placement(value: Placement, collapsible = false): LayoutConstraints {
    return Object.assign(new LayoutConstraints(), { placement: value, collapsible });
}

/**
 * A region that derives its size from its children — the common "content
 * wrapped in a plain Container" shape, with a `VBox` so a case can add a
 * second child and watch the region's report grow.
 *
 * @param width - The first child's preferred width.
 * @param height - The first child's preferred height.
 * @param minSize - Optional. An explicit minimum for the child, for the cases
 *   that need the region to report a non-zero minimum.
 * @returns The rendered region.
 */
function makeRegion(width = CHILD_WIDTH, height = CHILD_HEIGHT, minSize?: Size): Container {
    const region = new Container({ layoutManager: new VBox() });
    const child  = new Component({ preferredSize: { width, height }, minSize });

    region.addComponent(child);
    region.getElement(true);
    child.getElement(true);

    return region;
}

/**
 * A rendered, inset-free container laid out by the given manager.
 *
 * @param manager - The container's layout manager.
 * @returns The container.
 */
function makeHost(manager: LayoutManager): Container {
    const host = new Container({ layoutManager: manager });

    host.getElement(true);
    host.clearInsets();

    return host;
}

/**
 * The five-region scene: a `VBox` outer host wrapping the border's container,
 * one region per placement, sized so the border lays out at its own preferred
 * size.
 *
 * @returns The assembled, not-yet-laid-out scene.
 */
function makeScene(): Scene {
    const border = new Border();
    const host   = makeHost(border);
    const outer  = makeHost(new VBox());

    const regions = {} as Record<Placement, Container>;

    for (const slot of PLACEMENTS) {
        regions[slot] = makeRegion();
        host.addComponent(regions[slot], placement(slot));
    }

    outer.addComponent(host);
    outer.setWidth(HOST_WIDTH);
    outer.setHeight(HOST_HEIGHT);

    return { outer, host, border, regions };
}

/**
 * Counts every size report a component is asked for from now on.
 *
 * @param component - The component to watch.
 * @returns A live view of the three counts.
 */
function countSizeCalls(component: Component): SizeCallCounts {
    const preferred = vi.spyOn(component, 'getPreferredSize');
    const min       = vi.spyOn(component, 'getMinSize');
    const max       = vi.spyOn(component, 'getMaxSize');

    return {
        get preferred(): number { return preferred.mock.calls.length; },
        get min():       number { return min.mock.calls.length; },
        get max():       number { return max.mock.calls.length; },
    };
}

/**
 * The rectangle a component was committed at.
 *
 * @param component - The laid-out component.
 * @returns `[x, y, width, height]`.
 */
function rect(component: Component): [number, number, number, number] {
    return [component.getX(), component.getY(), component.getWidth(), component.getHeight()];
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    DOM.reset();
});

describe('Repeat region reports inside one pass collapse to one (case 1)', () => {
    it('asks each of the five regions for each of its three size reports exactly once', () => {
        installTestDOM(CONFIG);

        const scene  = makeScene();
        const counts = new Map(PLACEMENTS.map(slot => [slot, countSizeCalls(scene.regions[slot])] as const));

        scene.outer.doLayout();

        for (const slot of PLACEMENTS) {
            expect({ slot, ...counts.get(slot)! }).toEqual({ slot, preferred: 1, min: 1, max: 1 });
        }
    });
});

describe('Geometry is unchanged (case 2)', () => {
    it('commits the same five rectangles the scene produced before the record existed', () => {
        installTestDOM(CONFIG);

        const scene = makeScene();

        scene.outer.doLayout();

        expect(rect(scene.regions[Placement.NORTH])).toEqual([0, 0, 120, 20]);
        expect(rect(scene.regions[Placement.SOUTH])).toEqual([0, 0, 120, 20]);
        expect(rect(scene.regions[Placement.WEST])).toEqual([0, 0, 40, 10]);
        expect(rect(scene.regions[Placement.EAST])).toEqual([0, 0, 40, 10]);
        expect(rect(scene.regions[Placement.CENTER])).toEqual([0, 0, 30, 10]);
    });
});

describe('Nothing is recorded outside a layout pass (case 3)', () => {
    it('reflects a region mutated between two reads taken with no layout running', () => {
        installTestDOM(CONFIG);

        const scene = makeScene();

        scene.outer.doLayout();

        const before = scene.host.getPreferredSize();

        scene.regions[Placement.WEST].addComponent(new Component({ preferredSize: { width: WIDE_CHILD_WIDTH, height: 0 } }));

        const after = scene.host.getPreferredSize();

        // Width is the middle row's sum: west + centre + east, no spacing.
        expect(before!.width).toBe(CHILD_WIDTH * 3);
        expect(after!.width).toBe(WIDE_CHILD_WIDTH + CHILD_WIDTH * 2);
    });
});

describe('Each pass reads afresh (case 4)', () => {
    it('reads every region twice across two consecutive passes, not once', () => {
        installTestDOM(CONFIG);

        const scene  = makeScene();
        const counts = new Map(PLACEMENTS.map(slot => [slot, countSizeCalls(scene.regions[slot])] as const));

        scene.outer.doLayout();
        scene.outer.doLayout();

        for (const slot of PLACEMENTS) {
            expect({ slot, ...counts.get(slot)! }).toEqual({ slot, preferred: 2, min: 2, max: 2 });
        }
    });
});

describe('A read taken after the border has laid out is live again (case 5)', () => {
    it('asks the west region twice when the host reads the border on both sides of a commit', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host   = makeHost(border);

        for (const slot of PLACEMENTS) {
            host.addComponent(makeRegion(), placement(slot));
        }

        const probe = new DoubleReadProbe(host, () => probe.commitTarget());
        const outer = makeHost(probe);

        outer.addComponent(host);
        outer.setWidth(HOST_WIDTH);
        outer.setHeight(HOST_HEIGHT);

        const counts = countSizeCalls(host.getComponents()[2]);

        outer.doLayout();

        expect(counts.preferred).toBe(2);
    });
});

describe('A throwing layout leaves nothing behind (case 6)', () => {
    it('propagates the throw, closes the pass, and lays out normally once the region is replaced', () => {
        installTestDOM(CONFIG);

        const scene  = makeScene();
        const broken = new NoPreferredSizeRegion({});

        broken.getElement(true);
        scene.host.removeComponent(scene.regions[Placement.NORTH]);
        scene.host.addComponent(broken, placement(Placement.NORTH));

        expect(() => scene.outer.doLayout()).toThrow('Unable to determine preferred size for north component.');
        expect(Component.currentLayoutPass()).toBe(0);

        scene.host.removeComponent(broken);
        scene.regions[Placement.NORTH] = makeRegion();
        scene.host.addComponent(scene.regions[Placement.NORTH], placement(Placement.NORTH));

        scene.outer.doLayout();

        expect(rect(scene.regions[Placement.NORTH])).toEqual([0, 0, 120, 20]);
        expect(rect(scene.regions[Placement.CENTER])).toEqual([0, 0, 30, 10]);
    });
});

describe('Swapping the component in a region mid-pass is not served from the record (case 7)', () => {
    it('reports the incoming west component\'s width, not the outgoing one\'s', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host   = makeHost(border);

        for (const slot of PLACEMENTS) {
            host.addComponent(makeRegion(), placement(slot));
        }

        // The swap sits between the two reads with no commit in between, so
        // the second read can only be right if installing a region slot drops
        // the record — a `doLayout` in between would have dropped it anyway.
        const probe = new DoubleReadProbe(host, () => {
            host.addComponent(makeRegion(WIDE_CHILD_WIDTH), placement(Placement.WEST));
        });
        const outer = makeHost(probe);

        outer.addComponent(host);
        outer.setWidth(HOST_WIDTH);
        outer.setHeight(HOST_HEIGHT);

        outer.doLayout();

        expect(probe.reads[0]!.width).toBe(CHILD_WIDTH * 3);
        expect(probe.reads[1]!.width).toBe(WIDE_CHILD_WIDTH + CHILD_WIDTH * 2);
    });
});

describe('A collapsed, undisplayed region still reports its snapshot (case 8)', () => {
    it('keeps the snapshot minimum in the border\'s own minimum once the content has left the tree', () => {
        installWithFrames();

        const west   = makeRegion(CHILD_WIDTH, CHILD_HEIGHT, { width: CHILD_WIDTH, height: WEST_MIN_HEIGHT });
        const centre = makeRegion();
        const border = new Border();
        const host   = makeHost(border);

        host.setWidth(400);
        host.setHeight(300);
        host.addComponent(west, placement(Placement.WEST, true));
        host.addComponent(centre, placement(Placement.CENTER));
        host.doLayout();

        border.setRegionCollapsed(Placement.WEST, true);
        settle();

        // The region is now childless, so its own minimum has deflated to its
        // bare perimeter; the border must still report the snapshot's.
        expect(west.getLaidOutComponents()).toHaveLength(0);
        expect(west.getMinSize()!.height).toBe(0);
        expect(border.getMinSize()!.height).toBe(WEST_MIN_HEIGHT);
    });
});

describe('Nested borders keep separate records (case 9)', () => {
    it('gives the inner border its own region numbers and reads each inner region once', () => {
        installTestDOM(CONFIG);

        const innerBorder = new Border();
        const innerHost   = makeHost(innerBorder);
        const innerWest   = makeRegion(25, CHILD_HEIGHT);
        const innerCentre = makeRegion(15, CHILD_HEIGHT);

        innerHost.addComponent(innerWest, placement(Placement.WEST));
        innerHost.addComponent(innerCentre, placement(Placement.CENTER));

        const border    = new Border();
        const host      = makeHost(border);
        const outerWest = makeRegion();

        host.addComponent(outerWest, placement(Placement.WEST));
        host.addComponent(innerHost, placement(Placement.CENTER));

        const outer = makeHost(new VBox());

        outer.addComponent(host);
        outer.setWidth(CHILD_WIDTH + 25 + 15);
        outer.setHeight(CHILD_HEIGHT);

        const westCounts   = countSizeCalls(innerWest);
        const centreCounts = countSizeCalls(innerCentre);

        outer.doLayout();

        expect({ ...westCounts }).toEqual({ preferred: 1, min: 1, max: 1 });
        expect({ ...centreCounts }).toEqual({ preferred: 1, min: 1, max: 1 });

        expect(outerWest.getWidth()).toBe(CHILD_WIDTH);
        expect(innerWest.getWidth()).toBe(25);
    });
});

describe('An onFirstLayout callback inside a pass is not read across (case 10)', () => {
    it('reads the west region live again after consumer code has grown it mid-pass', () => {
        installTestDOM(CONFIG);

        // The offline source reports every element disconnected, so the test
        // says when the tree counts as mounted: `onFirstLayout` queues the
        // callback while disconnected and drains it on the connected layout.
        let connected = false;

        vi.spyOn(DOM.source, 'isConnected').mockImplementation(() => connected);

        const border = new Border();
        const host   = makeHost(border);
        const west   = makeRegion();

        host.addComponent(west, placement(Placement.WEST));
        host.addComponent(makeRegion(), placement(Placement.CENTER));

        // A sibling the outer host lays out before the border, whose
        // first-layout callback is ordinary consumer code and grows the
        // border's west region from inside the pass.
        const sibling = makeHost(new VBox());

        sibling.addComponent(new Component({ preferredSize: { width: CHILD_WIDTH, height: CHILD_HEIGHT } }));
        sibling.onFirstLayout(() => {
            west.addComponent(new Component({ preferredSize: { width: WIDE_CHILD_WIDTH, height: 0 } }));
        });

        const outer = makeHost(new VBox());

        outer.addComponent(sibling);
        outer.addComponent(host);
        outer.setWidth(HOST_WIDTH + WIDE_CHILD_WIDTH);
        outer.setHeight(HOST_HEIGHT * 2);

        connected = true;

        outer.doLayout();

        // The outer host had already fixed the border's own box before the
        // callback ran, at the pre-callback middle row of west + centre, so
        // the grown region is clamped to all of that box — never the bare
        // CHILD_WIDTH a record carried across the callback would still report.
        expect(host.getWidth()).toBe(CHILD_WIDTH * 2);
        expect(west.getWidth()).toBe(CHILD_WIDTH * 2);
    });
});

describe('A sizechange listener inside a pass is not read across (case 11)', () => {
    it('reads the west region live again after a size-change listener has grown it mid-pass', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host   = makeHost(border);
        const west   = makeRegion();

        host.addComponent(west, placement(Placement.WEST));
        host.addComponent(makeRegion(), placement(Placement.CENTER));

        // `commitBounds` fires `sizechange` from inside `setWidth`/`setHeight`,
        // so this listener is consumer code running mid-pass, mid-commit — the
        // second way a pass hands control out, alongside `onFirstLayout`.
        const sibling = makeHost(new VBox());

        sibling.addComponent(new Component({ preferredSize: { width: CHILD_WIDTH, height: CHILD_HEIGHT } }));

        let grown = false;

        sibling.onSizeChange(() => {
            if (grown) {
                return;
            }

            grown = true;
            west.addComponent(new Component({ preferredSize: { width: WIDE_CHILD_WIDTH, height: 0 } }));
        });

        const outer = makeHost(new VBox());

        outer.addComponent(sibling);
        outer.addComponent(host);
        outer.setWidth(HOST_WIDTH + WIDE_CHILD_WIDTH);
        outer.setHeight(HOST_HEIGHT * 2);

        outer.doLayout();

        // As in case 10: the border's box was fixed before the listener ran, so
        // the grown region fills it rather than reporting its stale width.
        expect(grown).toBe(true);
        expect(host.getWidth()).toBe(CHILD_WIDTH * 2);
        expect(west.getWidth()).toBe(CHILD_WIDTH * 2);
    });
});

describe('A region reporting `null` has that answer re-served, not recomputed (case 12)', () => {
    it('asks a null-reporting centre region for its preferred size exactly once', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host   = makeHost(border);
        const centre = new NoSizeRegion({});

        centre.getElement(true);
        host.addComponent(makeRegion(), placement(Placement.WEST));
        host.addComponent(centre, placement(Placement.CENTER));

        const outer = makeHost(new VBox());

        outer.addComponent(host);
        outer.setWidth(HOST_WIDTH);
        outer.setHeight(HOST_HEIGHT);

        const counts = countSizeCalls(centre);

        outer.doLayout();

        // The preferred size is the one report `Border` reads only through its
        // own helper — a region's minimum and maximum are additionally read by
        // the region's own commit-time clamp, which this record deliberately
        // does not stand in front of. So preferred is where the guard shows:
        // `undefined` in the record means "not asked yet" and a recorded
        // `null` is an answer, and a truthiness guard in place of the
        // `!== undefined` one would treat this region's `null` as absent and
        // re-ask on every one of the pass's reads.
        expect(counts.preferred).toBe(1);
    });
});
