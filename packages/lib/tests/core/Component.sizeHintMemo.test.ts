// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Coverage for `Component`'s per-pass size-hint record: `getPreferredSize`,
 * `getMinSize` and `getMaxSize` each answer once per `(layout pass, size-hint
 * generation)` pair and re-serve that answer until either number moves, with
 * geometry unchanged. Case numbers below refer to
 * `plans/size-hint-per-pass-memo.md`'s `## Expected Behaviour` list.
 *
 * Cases 5 to 8 are the plan's four design gates: each is a reading a wrong memo
 * key serves stale, and each passes both before and after the record exists.
 * They are the acceptance gate the test suite as a whole is not — the same
 * suite is green under a frame key and under a pass-only key, both of which
 * fail gates here.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Panel } from '~/core/Panel';
import { Text } from '~/component/input/Text';
import { Border } from '~/layout/Border';
import { Fit } from '~/layout/Fit';
import { Split } from '~/layout/Split';
import { HBox } from '~/layout/HBox';
import { VBox } from '~/layout/VBox';
import { LayoutManager } from '~/layout/LayoutManager';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Insets } from '~/primitive/Insets';
import { Placement } from '~/primitive/Placement';
import { Size } from '~/primitive/Size';
import { StyleBag } from '~/core/ClassStyleRules';
import { StyleStateSpec } from '~/core/ClassStyleRules';
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

/** The probe leaf's preferred height, and the first reading every design gate takes. */
const LEAF_HEIGHT = 50;

/** The probe leaf's preferred width. Never varied — the gates all read heights. */
const LEAF_WIDTH = 100;

/** Gate 5's between-passes preferred height: a value no other case produces. */
const GATE5_HEIGHT = 130;

/** Gate 6's committed height, which the leaf's size-change listener republishes. */
const GATE6_HEIGHT = 100;

/** Gate 7's mid-pass preferred height, written on a leaf one level down. */
const GATE7_HEIGHT = 400;

/** Case 15's state-tier minimum height, declared only while `.tall` is active. */
const STATE_MIN_HEIGHT = 200;

/** Case 16's mid-pass border width on each side, so the perimeter grows by twice it. */
const CACHED_BORDER_WIDTH = 10;

/** Gate 8's mid-pass inset on each edge, so the wrapper's report grows by twice it. */
const GATE8_INSET = 10;

/** The box every gate's root is given — large enough that nothing clamps. */
const ROOT_EXTENT = 300;

/** The five slots the `Border` scene fills, in the order it builds them. */
const PLACEMENTS = [Placement.NORTH, Placement.SOUTH, Placement.WEST, Placement.EAST, Placement.CENTER] as const;

/** The `Border` scene's host box: the exact sum of its five regions' reports. */
const BORDER_HOST_WIDTH  = 400;
const BORDER_HOST_HEIGHT = 290;

/** Frames of triangle-wave width the drag sweep drives over the deep scene. */
const SWEEP_FRAMES = 20;

/** The narrowest width in that sweep, and the step each frame moves by. */
const SWEEP_BASE_WIDTH = 700;
const SWEEP_STEP       = 20;

/**
 * Baselines captured from this same file against the branch's start point —
 * `feature/accordion-seed-pass-economy` at `95f3052b`, with no size-hint record
 * in `Component` — by running each case and printing what it measured. Every
 * one of them is a *pre-change* number, which is what makes them an assertion
 * about the record changing nothing rather than a restatement of its output.
 */
const BASELINE = {
    /** Case 1: size-hint calls anywhere in the 19-component `Border` scene, per pass. */
    borderSceneCalls: 210,
    /** Case 9 / case 2: `[x, y, width, height]` of every component, per frame, hashed. */
    deepSweepGeometry:    '31d51d08:107980',
    shallowSweepGeometry: '5dd52043:25040',
    /** Case 9: size-hint calls over the whole 20-frame sweep of each scene. */
    deepSweepCalls:    109260,
    shallowSweepCalls: 23204,
    /** Case 9: how many components each sweep scene holds. */
    deepSceneSize:    223,
    shallowSceneSize: 48,
} as const;

/**
 * Upper bound on the calls the record may leave in the 19-component `Border`
 * scene. The plan predicted 281 → 265 against `master`, but
 * `border-region-size-memo` has since removed every repeat this scene had, and
 * the measured figure is the baseline exactly — see the plan's
 * `## Implementation Notes`. What is left to assert here is that the record
 * never costs a call, with the reduction itself pinned by case 9.
 */
const BORDER_SCENE_CALL_CEILING = BASELINE.borderSceneCalls;

/**
 * Lower bound on the fraction of the deep sweep's size-hint calls the record
 * must remove. The plan asked for "more than 45%" against `master`; measured
 * against this branch's start point, which already carries `Border`'s own
 * per-pass region record, a quarter is the honest bar — see the plan's
 * `## Implementation Notes`.
 */
const SWEEP_CALL_REDUCTION = 0.25;

/**
 * A layout manager that reads one target's preferred height, runs a
 * caller-supplied step, and reads it again — the shape every design gate needs
 * and no shipped manager has.
 */
class ReadStepRead extends LayoutManager {
    /** The heights the reads returned, in order across every pass. */
    readonly reads: number[] = [];

    /**
     * @param target - The component read on both sides of `step`.
     * @param step - The work run between the two reads, or `null` for one read only.
     */
    constructor(private readonly target: Component, private readonly step: (() => void) | null) {
        // LayoutManager's constructor takes no options.
        super();
    }

    /** Reads the target, runs the interposed step, reads it again. */
    doLayout(): void {
        this.reads.push(this.readHeight());

        if (!this.step) {
            return;
        }

        this.step();
        this.reads.push(this.readHeight());
    }

    /** Commits the target at the gate-6 box, which fires its size-change listener. */
    commitTarget(): void {
        this.commitBounds(this.target, 0, 0, LEAF_WIDTH, GATE6_HEIGHT);
    }

    /**
     * The target's preferred height, or `-1` when it reports no preferred size.
     *
     * @returns The height read.
     */
    private readHeight(): number {
        return this.target.getPreferredSize()?.height ?? -1;
    }
}

/**
 * A manager whose minimum-size computation bumps the size-hint generation and
 * then takes a nested reading on its own container — the interleaving that
 * separates a record written on exit unconditionally from one written only
 * when the generation held still, which no other case reaches.
 */
class GenerationBumpingMin extends LayoutManager {
    /** The minimum height this manager currently reports. Moved between reads. */
    height: number = LEAF_HEIGHT;

    /** Places nothing: the container this manages is never committed. */
    doLayout(): void {
        // Intentionally empty — case 13 reads size reports, never geometry.
    }

    /** The container's preferred size — fixed, so only the minimum moves. */
    getPreferredSize(): Size | null {
        return { width: LEAF_WIDTH, height: LEAF_HEIGHT };
    }

    /**
     * Bumps the generation (a fresh inset value), takes a nested reading that
     * re-bases the container's record onto the new generation, and only then
     * answers.
     *
     * @returns The manager's current minimum size.
     */
    getMinSize(): Size | null {
        const container = this.getContainer()!;

        container.setInsets(new Insets(this.height, 0, 0, 0));
        container.getMaxSize();

        return { width: 0, height: this.height };
    }
}

/**
 * A layout manager that reads one target's *minimum* height twice around a
 * caller-supplied step — the minimum, not the preferred size, because the
 * generation-bump interleaving case 13 pins lives in a manager's own
 * `getMinSize`.
 */
class MinReadProbe extends LayoutManager {
    /** The minimum heights the two reads returned, in order. */
    readonly reads: Array<number | undefined> = [];

    /**
     * @param target - The component read on both sides of `step`.
     * @param step - The work run between the two reads.
     */
    constructor(private readonly target: Component, private readonly step: () => void) {
        // LayoutManager's constructor takes no options.
        super();
    }

    /** Reads the target's minimum height, runs the interposed step, reads again. */
    doLayout(): void {
        this.reads.push(this.target.getMinSize()?.height);
        this.step();
        this.reads.push(this.target.getMinSize()?.height);
    }
}

/**
 * A leaf whose minimum height is declared by a style *state* rather than by an
 * instance write, so activating the state changes `getMinSizeConstraint` —
 * which resolves through the layered style walk — without any setter running.
 */
class StatefulMin extends Component {
    /** Declares `.tall`, whose layer carries the minimum the case reads. */
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: '.tall',
            extract: (): StyleBag => ({ minSize: { width: 0, height: STATE_MIN_HEIGHT } }),
        },
    ];
}

/**
 * A container that exposes `cacheBorderSpec` — the escape hatch a component
 * whose border is painted by a shared class rule uses to keep
 * `getBorderSize`'s layout math accurate without writing CSS.
 * `SplitGutter.setOpaque` calls it from inside `Split.doLayout`.
 */
class BorderCaching extends Container {
    /**
     * Caches a border spec without writing any CSS.
     *
     * @param spec - The CSS `border` shorthand to cache.
     */
    cacheBorder(spec: string): void {
        this.cacheBorderSpec(spec);
    }
}

/**
 * A component whose layout manager throws, for the case that asserts a failed
 * pass leaves the pass counter clean.
 */
class ThrowingLayout extends LayoutManager {
    /** Throws instead of laying anything out. */
    doLayout(): void {
        throw new Error('layout failed');
    }
}

/**
 * A `VBox` with no inter-child spacing, so every scene's arithmetic is the sum
 * of what its children report and nothing else.
 *
 * @returns The manager.
 */
function vbox(): VBox {
    return new VBox({ spacing: 0 });
}

/**
 * The horizontal counterpart of {@link vbox}.
 *
 * @returns The manager.
 */
function hbox(): HBox {
    return new HBox({ spacing: 0 });
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
 * A rendered leaf with an explicit preferred size.
 *
 * @param width - The leaf's preferred width.
 * @param height - The leaf's preferred height.
 * @returns The leaf.
 */
function makeLeaf(width = LEAF_WIDTH, height = LEAF_HEIGHT): Component {
    const leaf = new Component({ preferredSize: { width, height } });

    leaf.getElement(true);

    return leaf;
}

/**
 * A `VBox` wrapper around one leaf — the level of indirection gates 7 and 8
 * need, so the read the probe takes is of a component whose answer is derived
 * rather than authored.
 *
 * @param leaf - The wrapped leaf.
 * @returns The wrapper.
 */
function wrap(leaf: Component): Container {
    const wrapper = makeHost(vbox());

    wrapper.addComponent(leaf);

    return wrapper;
}

/**
 * The scene every design gate drives: a root whose only child is `child`, laid
 * out by a probe that reads `target` twice around `step`.
 *
 * @param child - The root's child.
 * @param target - The component the probe reads.
 * @param step - The work run between the probe's two reads.
 * @returns The root and its probe.
 */
function makeGateScene(child: Component, target: Component, step: (() => void) | null): { root: Container; probe: ReadStepRead } {
    const probe = new ReadStepRead(target, step);
    const root  = makeHost(probe);

    root.addComponent(child);
    root.setWidth(ROOT_EXTENT);
    root.setHeight(ROOT_EXTENT);

    return { root, probe };
}

/**
 * A `placement` constraint for the `Border` scene.
 *
 * @param value - The region slot.
 * @returns The constraint.
 */
function placement(value: Placement, collapsible = false): LayoutConstraints {
    return Object.assign(new LayoutConstraints(), { placement: value, collapsible });
}

/**
 * A region of the `Border` scene: a `VBox` of `count` identical leaves.
 *
 * @param count - How many leaves the region holds.
 * @param width - Each leaf's preferred width.
 * @param height - Each leaf's preferred height.
 * @returns The region.
 */
function makeRegion(count: number, width: number, height: number): Container {
    const region = makeHost(vbox());

    for (let index = 0; index < count; index += 1) {
        region.addComponent(makeLeaf(width, height));
    }

    return region;
}

/**
 * The 19-component `Border` scene of cases 1 and 2: one host, five regions, and
 * thirteen leaves, in a box that is the exact sum of what the five regions
 * report, so every committed rectangle is the border's own arithmetic.
 *
 * @returns The host and its five regions.
 */
function makeBorderScene(): { host: Container; regions: Record<Placement, Container> } {
    const host    = makeHost(new Border({ spacing: 0 }));
    const regions = {} as Record<Placement, Container>;

    regions[Placement.NORTH]  = makeRegion(2, 100, 10);
    regions[Placement.SOUTH]  = makeRegion(2, 100, 10);
    regions[Placement.WEST]   = makeRegion(3, 45, 30);
    regions[Placement.EAST]   = makeRegion(3, 45, 30);
    regions[Placement.CENTER] = makeRegion(3, 200, 50);

    for (const slot of PLACEMENTS) {
        host.addComponent(regions[slot], placement(slot));
    }

    host.setWidth(BORDER_HOST_WIDTH);
    host.setHeight(BORDER_HOST_HEIGHT);

    return { host, regions };
}

/**
 * A horizontal strip of `count` leaves — the breadcrumb, gutter, status and
 * content rows the sweep scene's editor panes are built from.
 *
 * @param count - How many leaves the strip holds.
 * @param height - Each leaf's preferred height.
 * @returns The strip.
 */
function makeStrip(count: number, height: number): Container {
    const strip = makeHost(hbox());

    for (let index = 0; index < count; index += 1) {
        strip.addComponent(makeLeaf(30 + index, height));
    }

    return strip;
}

/**
 * One Loom-shaped file-editor pane: a `Border` whose centre is a scrolling
 * `Panel` over a `VBox` of content rows, with a breadcrumb bar north, a gutter
 * west and a status bar south. 48 components, which is what makes four of them
 * plus a tree pane the plan's 2x2 editor grid.
 *
 * @returns The pane.
 */
function makeEditorPane(): Container {
    const pane = makeHost(new Border());
    const rows = makeHost(vbox());

    for (let index = 0; index < 8; index += 1) {
        rows.addComponent(makeStrip(3, 16));
    }

    const scroller = new Panel({ layoutManager: new Fit(), autoScroll: 'auto' });

    scroller.getElement(true);
    scroller.clearInsets();
    scroller.addComponent(rows);

    const centre = makeHost(new Fit());

    centre.addComponent(scroller);

    pane.addComponent(makeStrip(4, 18), placement(Placement.NORTH));
    pane.addComponent(makeStrip(3, 14), placement(Placement.SOUTH));
    pane.addComponent(makeStrip(1, 40), placement(Placement.WEST, true));
    pane.addComponent(centre,           placement(Placement.CENTER));

    return pane;
}

/**
 * The deep scene of case 9: a `Split` of a 30-row tree pane and a 2x2 grid of
 * editor panes — the shape of the Loom dock the plan's measurement ran
 * against, and the one whose dividers and collapsible region gutters reach
 * `cacheBorderSpec` on every pass.
 *
 * @returns The root.
 */
function makeDeepScene(): Container {
    const root = makeHost(new Split({ orientation: 'horizontal' }));
    const tree = makeHost(vbox());

    for (let index = 0; index < 30; index += 1) {
        tree.addComponent(makeLeaf(120, 18));
    }

    root.addComponent(tree);

    const grid = makeHost(vbox());

    for (let row = 0; row < 2; row += 1) {
        const pair = makeHost(hbox());

        pair.addComponent(makeEditorPane());
        pair.addComponent(makeEditorPane());
        grid.addComponent(pair);
    }

    root.addComponent(grid);
    root.setHeight(600);

    return root;
}

/**
 * The shallow scene of case 9: a single editor pane, 48 components. The
 * ablation this plan corrects passed on a scene of this shape and broke on the
 * deep one, so both are driven.
 *
 * @returns The root.
 */
function makeShallowScene(): Container {
    const root = makeHost(hbox());

    root.addComponent(makeEditorPane());
    root.setHeight(600);

    return root;
}

/**
 * Counts every size-hint call made anywhere, on any component, from now on.
 *
 * @returns A live view of the running total.
 */
function countSizeHintCalls(): { total: number } {
    const spies = [
        vi.spyOn(Component.prototype, 'getPreferredSize'),
        vi.spyOn(Component.prototype, 'getMinSize'),
        vi.spyOn(Component.prototype, 'getMaxSize'),
    ];

    return {
        get total(): number {
            return spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
        },
    };
}

/**
 * How many components a subtree holds, the root included.
 *
 * @param component - The subtree root.
 * @returns The component count.
 */
function countComponents(component: Component): number {
    return subtree(component).reduce((sum, child) => sum + countComponents(child), 1);
}

/**
 * A component's children, or an empty list for a leaf.
 *
 * @param component - The component to read.
 * @returns The children.
 */
function subtree(component: Component): Component[] {
    return component instanceof Container ? component.getComponents() : [];
}

/**
 * Every rectangle in a subtree, in pre-order, as one string.
 *
 * @param component - The subtree root.
 * @returns The joined `x,y,width,height` of every component.
 */
function geometryOf(component: Component): string {
    const own = `${component.getX()},${component.getY()},${component.getWidth()},${component.getHeight()}`;

    return [own, ...subtree(component).map(geometryOf)].join('|');
}

/**
 * An FNV-1a digest of a geometry string, with its length — small enough to
 * baseline in this file, and sensitive to a single changed pixel anywhere in
 * the 223-component, 20-frame sweep.
 *
 * @param value - The geometry string to digest.
 * @returns `"<hash>:<length>"`.
 */
function digest(value: string): string {
    let hash = 0x811c9dc5;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return `${hash.toString(16)}:${value.length}`;
}

/**
 * Drives a triangle-wave width change over a scene, laying it out once per
 * frame and digesting every component's rectangle on every frame.
 *
 * @param root - The scene root, resized each frame.
 * @returns The geometry digest of the whole sweep.
 */
function sweep(root: Container): string {
    let geometry = '';

    for (let frame = 0; frame < SWEEP_FRAMES; frame += 1) {
        const offset = frame < SWEEP_FRAMES / 2 ? frame : SWEEP_FRAMES - frame;

        root.setWidth(SWEEP_BASE_WIDTH + offset * SWEEP_STEP);
        root.doLayout();

        geometry += `${geometryOf(root)}#`;
    }

    return digest(geometry);
}

afterEach(() => {
    vi.restoreAllMocks();
    DOM.reset();
});

describe('Repeat questions inside one pass collapse into one (case 1)', () => {
    it('asks the manager once when the same question is repeated with no write between', () => {
        installTestDOM(CONFIG);

        const wrapper = wrap(makeLeaf());
        const scene   = makeGateScene(wrapper, wrapper, () => undefined);
        const manager = vi.spyOn(wrapper.getLayoutManager(), 'getPreferredSize');

        scene.root.doLayout();

        expect(scene.probe.reads).toEqual([LEAF_HEIGHT, LEAF_HEIGHT]);
        expect(manager.mock.calls.length).toBe(1);
    });

    it('makes no more size-hint calls across the Border scene than the unmemoised run did', () => {
        installTestDOM(CONFIG);

        const scene  = makeBorderScene();
        const counts = countSizeHintCalls();

        scene.host.doLayout();

        expect(counts.total).toBeLessThanOrEqual(BORDER_SCENE_CALL_CEILING);
    });
});

describe('Geometry is unchanged (case 2)', () => {
    it('commits the five regions at the rectangles the scene produced before the record existed', () => {
        installTestDOM(CONFIG);

        const scene = makeBorderScene();

        scene.host.doLayout();

        // A framed region's element is parked at (0, 0) inside its frame, so
        // every region reports an origin of 0 and only the extents differ.
        expect(geometryOf(scene.regions[Placement.NORTH])).toContain('0,0,400,20');
        expect(geometryOf(scene.regions[Placement.CENTER])).toContain('0,0,310,250');
        expect(geometryOf(scene.regions[Placement.WEST])).toContain('0,0,45,250');
        expect(geometryOf(scene.regions[Placement.EAST])).toContain('0,0,45,250');
        expect(geometryOf(scene.regions[Placement.SOUTH])).toContain('0,0,400,20');
    });
});

describe('Nothing is recorded outside a layout pass (case 3)', () => {
    it('reflects a child added between two reads taken with no layout running', () => {
        installTestDOM(CONFIG);

        const host = makeHost(vbox());

        host.addComponent(makeLeaf(LEAF_WIDTH, LEAF_HEIGHT));

        expect(host.getPreferredSize()?.height).toBe(LEAF_HEIGHT);

        host.addComponent(makeLeaf(LEAF_WIDTH, LEAF_HEIGHT));

        expect(host.getPreferredSize()?.height).toBe(LEAF_HEIGHT * 2);
    });
});

describe('Each pass reads afresh (case 4)', () => {
    it('asks the wrapper\'s manager again on the second of two consecutive passes', () => {
        installTestDOM(CONFIG);

        const wrapper = wrap(makeLeaf());
        const scene   = makeGateScene(wrapper, wrapper, null);
        const manager = vi.spyOn(wrapper.getLayoutManager(), 'getPreferredSize');

        scene.root.doLayout();

        const afterFirst = manager.mock.calls.length;

        scene.root.doLayout();

        expect(afterFirst).toBeGreaterThan(0);
        expect(manager.mock.calls.length).toBeGreaterThan(afterFirst);
    });
});

describe('A size change between two passes of one frame is seen (case 5, design gate)', () => {
    it('reads the new preferred height on the second pass', () => {
        installTestDOM(CONFIG);

        const leaf  = makeLeaf();
        const scene = makeGateScene(wrap(leaf), leaf, null);

        scene.root.doLayout();
        leaf.setPreferredSize({ width: LEAF_WIDTH, height: GATE5_HEIGHT });
        scene.root.doLayout();

        // A frame-keyed record reports 50 twice: the two passes share a frame.
        expect(scene.probe.reads).toEqual([LEAF_HEIGHT, GATE5_HEIGHT]);
    });
});

describe('A size change caused by the commit is seen in the same pass (case 6, design gate)', () => {
    it('reads the republished preferred height after committing the leaf', () => {
        installTestDOM(CONFIG);

        const leaf = makeLeaf();

        // The shape `CodeEditor.setAutoHeight` has: the leaf republishes its
        // preferred size from the height the commit just gave it.
        leaf.onSizeChange(() => {
            leaf.setPreferredSize({ width: LEAF_WIDTH, height: leaf.getHeight() });
        });

        const probe = new ReadStepRead(leaf, () => probe.commitTarget());
        const root  = makeHost(probe);

        root.addComponent(leaf);
        root.setWidth(ROOT_EXTENT);
        root.setHeight(ROOT_EXTENT);

        root.doLayout();

        // A frame-keyed record reports 50 twice, and so did a pass-keyed one
        // before `border-region-size-memo` narrowed the pass number to end at
        // the `sizechange` dispatch this commit makes.
        expect(probe.reads).toEqual([LEAF_HEIGHT, GATE6_HEIGHT]);
    });
});

describe('A constraint written mid-pass is seen (case 7, design gate)', () => {
    it('reads the wrapper again after a preferred size is written inside it', () => {
        installTestDOM(CONFIG);

        const leaf    = makeLeaf();
        const wrapper = wrap(leaf);
        const scene   = makeGateScene(wrapper, wrapper, () => {
            leaf.setPreferredSize({ width: LEAF_WIDTH, height: GATE7_HEIGHT });
        });

        scene.root.doLayout();

        // Nothing here ends the layout pass — no commit, no `doLayout`, no
        // `sizechange` — so this is the reading only the size-hint generation
        // keeps live.
        expect(scene.probe.reads).toEqual([LEAF_HEIGHT, GATE7_HEIGHT]);
    });
});

describe('Insets written mid-pass are seen (case 8, design gate)', () => {
    it('reads the wrapper again after its own insets change', () => {
        installTestDOM(CONFIG);

        const leaf    = makeLeaf();
        const wrapper = wrap(leaf);
        const scene   = makeGateScene(wrapper, wrapper, () => {
            wrapper.setInsets(new Insets(GATE8_INSET, GATE8_INSET, GATE8_INSET, GATE8_INSET));
        });

        scene.root.doLayout();

        // The `Tab.doLayout` shape: `setInsets` announces nothing to layout at
        // all, so the generation bump in the setter is the only signal there is.
        expect(scene.probe.reads).toEqual([LEAF_HEIGHT, LEAF_HEIGHT + GATE8_INSET * 2]);
    });
});

describe('An undisplayed child mid-pass is seen (case 14, design gate)', () => {
    it('reads the wrapper again after one of its children stops being laid out', () => {
        installTestDOM(CONFIG);

        const wrapper = makeHost(vbox());
        const stays   = makeLeaf();
        const goes    = makeLeaf();

        wrapper.addComponent(stays);
        wrapper.addComponent(goes);

        const probe = new ReadStepRead(wrapper, () => goes.setDisplayed(false));
        const root  = makeHost(probe);

        root.addComponent(wrapper);
        root.setWidth(ROOT_EXTENT);
        root.setHeight(ROOT_EXTENT);
        root.doLayout();

        // `getLaidOutComponents` filters on `isDisplayed`, so undisplaying a
        // child changes every ancestor's aggregate at that instant — and the
        // hiding leg of `setDisplayed` routes through `setStyleState`, never
        // `writeStyle`, so it ends no pass and announces nothing to layout.
        // `Split`, `Tab`, `Card`, `Accordion` and `Border` all undisplay
        // children from inside their own `doLayout`.
        expect(probe.reads).toEqual([LEAF_HEIGHT * 2, LEAF_HEIGHT]);
    });
});

describe('A style state activated mid-pass is seen (case 15, design gate)', () => {
    it('reads a minimum that only the newly active state layer declares', () => {
        installTestDOM(CONFIG);

        const leaf  = new StatefulMin({});

        leaf.getElement(true);

        const probe = new MinReadProbe(leaf, () => leaf.setStyleState('.tall', true));
        const root  = makeHost(probe);

        root.addComponent(leaf);
        root.setWidth(ROOT_EXTENT);
        root.setHeight(ROOT_EXTENT);
        root.doLayout();

        // `getMinSizeConstraint` resolves through the layered style walk, and
        // an active state's layer comes first — so a state toggle changes a
        // size hint while writing no style of its own.
        expect(probe.reads).toEqual([0, STATE_MIN_HEIGHT]);
    });
});

describe('A border cached mid-pass is seen (case 16, design gate)', () => {
    it('reads the container again after its cached border spec changed', () => {
        installTestDOM(CONFIG);

        const wrapper = new BorderCaching({ layoutManager: vbox() });

        wrapper.getElement(true);
        wrapper.clearInsets();
        wrapper.addComponent(makeLeaf());

        const scene = makeGateScene(wrapper, wrapper, () => {
            wrapper.cacheBorder(`${CACHED_BORDER_WIDTH}px solid red`);
        });

        scene.root.doLayout();

        // `cacheBorderSpec` writes no CSS at all — it only drops the cached
        // per-side widths `getBorderSize` feeds into `getPerimeterSize`, which
        // every aggregating manager adds to its report.
        expect(scene.probe.reads).toEqual([LEAF_HEIGHT, LEAF_HEIGHT + CACHED_BORDER_WIDTH * 2]);
    });
});

describe('A Loom-shaped drag sweep is byte-identical (case 9)', () => {
    it('commits the deep scene at the same rectangles on every frame, for less work', () => {
        installTestDOM(CONFIG);

        const root   = makeDeepScene();
        const counts = countSizeHintCalls();

        expect(countComponents(root)).toBe(BASELINE.deepSceneSize);
        expect(sweep(root)).toBe(BASELINE.deepSweepGeometry);
        expect(counts.total).toBeLessThanOrEqual(BASELINE.deepSweepCalls * (1 - SWEEP_CALL_REDUCTION));
    });

    it('commits the shallow scene at the same rectangles on every frame, for less work', () => {
        installTestDOM(CONFIG);

        const root   = makeShallowScene();
        const counts = countSizeHintCalls();

        expect(countComponents(root)).toBe(BASELINE.shallowSceneSize);
        expect(sweep(root)).toBe(BASELINE.shallowSweepGeometry);
        expect(counts.total).toBeLessThanOrEqual(BASELINE.shallowSweepCalls * (1 - SWEEP_CALL_REDUCTION));
    });
});

describe('`null` is a real answer (case 10)', () => {
    it('re-serves a null preferred size rather than recomputing it', () => {
        installTestDOM(CONFIG);

        // A bare `Component` with no children and no explicit constraint
        // reports no preferred size at all — the `null` the record must keep
        // apart from "not asked yet".
        const empty = new Component({});

        empty.getElement(true);
        const scene = makeGateScene(empty, empty, () => undefined);
        const reads = vi.spyOn(empty.getLayoutManager(), 'getPreferredSize');

        scene.root.doLayout();

        // Both readings are the `null` the manager reports, and the manager was
        // asked once: a record guarded on truthiness rather than on
        // `undefined` would treat the recorded `null` as "not asked yet" and
        // walk the subtree again for the second reading.
        expect(scene.probe.reads).toEqual([-1, -1]);
        expect(reads.mock.calls.length).toBe(1);
    });
});

describe('A throwing layout leaves the counters clean (case 11)', () => {
    it('propagates the throw, ends the pass, and lays the repaired scene out normally', () => {
        installTestDOM(CONFIG);

        const host = makeHost(new ThrowingLayout());

        host.addComponent(makeLeaf());
        host.setWidth(ROOT_EXTENT);
        host.setHeight(ROOT_EXTENT);

        expect(() => host.doLayout()).toThrow('layout failed');
        expect(Component.currentLayoutPass()).toBe(0);

        host.setLayoutManager(vbox());
        host.doLayout();

        expect(host.getComponents()[0].getHeight()).toBe(LEAF_HEIGHT);
    });
});

describe("A Text's lazy measurement still happens (case 12)", () => {
    it('reports the newly measured width on the pass after its text changed', () => {
        installTestDOM(CONFIG);

        const text = new Text('aa');

        text.getElement(true);

        const host = makeHost(vbox());

        host.addComponent(text);
        host.setWidth(ROOT_EXTENT);
        host.setHeight(ROOT_EXTENT);
        host.doLayout();

        // `Text.getMinSize` deliberately reports a zero width (it folds in the
        // one-line height floor only), so the measurement shows in the
        // preferred size — which is the same lazy `calculateSize` call.
        const narrow = text.getPreferredSize()?.width ?? 0;

        text.setText('aaaaaaaaaaaaaaaaaaaa');
        host.doLayout();

        expect(narrow).toBeGreaterThan(0);
        expect(text.getPreferredSize()?.width ?? 0).toBeGreaterThan(narrow);
    });
});

describe('A result computed across a generation bump is not recorded (case 13)', () => {
    it('re-reads a minimum whose own computation moved the generation', () => {
        installTestDOM(CONFIG);

        const manager   = new GenerationBumpingMin();
        const container = makeHost(manager);
        const probe     = new MinReadProbe(container, () => { manager.height = GATE5_HEIGHT; });
        const root      = makeHost(probe);

        root.addComponent(container);
        root.setWidth(ROOT_EXTENT);
        root.setHeight(ROOT_EXTENT);

        root.doLayout();

        // Both readings are taken inside one pass, and the first one's own
        // computation bumped the generation part-way through. A record that
        // re-bases on entry and then writes on exit unconditionally would stamp
        // that first answer with the generation its nested `getMaxSize` read
        // installed, and re-serve a stale 50 here.
        expect(probe.reads).toEqual([LEAF_HEIGHT, GATE5_HEIGHT]);
    });
});
