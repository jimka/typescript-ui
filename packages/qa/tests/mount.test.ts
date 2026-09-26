// @vitest-environment jsdom
//
// Mounts every panel through the real `mountPanel` — build, `Body.init`, the
// two waits, `afterMount` and the target merge — without opening a window.
// The panels mount into the real page body, so this file needs a real DOM.
// jsdom lays nothing out, so a driver cannot run on a mounted panel here;
// drivers.dom.test.ts checks the drivers' event sequences on stubbed
// rectangles instead.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Body, Component, DOM, ThemeManager } from '@jimka/typescript-ui/core';
import { findActiveHeading } from '@jimka/typescript-ui/component/display';
import { AbstractWindow } from '@jimka/typescript-ui/overlay';
import { startCounting, stopCounting } from '../src/harness/counters.js';
import type { PhaseCounts } from '../src/harness/counters.js';
import { createTools, parseDrive } from '../src/harness/run.js';
import type { CallTarget, HarnessTools, ThemeTarget } from '../src/harness/types.js';
import { mountPanel } from '../src/mount.js';
import type { MountedPanel, MountWaits } from '../src/mount.js';
import { elementFor } from '../src/builders/dom.js';
import { getPanelIds, loadPanel } from '../src/panels.js';
import { restorePatchables, snapshotPatchables } from './patchGuard.js';

// The library applies its default theme at the first `Body` touch.
// Constructing the singleton here applies that theme before any tree this
// file builds outside `mountPanel` (which awaits its own `Body.init`), so
// it never re-measures a built control through the canvas 2D context jsdom
// does not implement (the gap JSDOM_GAPS names below).
Body.getInstance();

/** The scale every panel is mounted at: small enough to be quick, and below `markdown-doc`'s first fence. */
const SMOKE_SCALE = 3;

/**
 * The harness tools, with `isPainted` standing in for layout: jsdom gives
 * every element an empty rectangle, so the real check is false everywhere
 * and a panel could not find the editor its `type` target needs. Here a
 * connected element counts as painted.
 */
const tools: HarnessTools = { ...createTools({ Body, DOM }), isPainted: (el: Element): boolean => el.isConnected };

/**
 * The paint wait: lays the page out once, so `afterMount` finds the elements
 * layout creates, such as gutters.
 */
async function flushOnPaint(): Promise<void> {
    Body.getInstance().flushLayout();
}

/** The settle wait: nothing to wait for without a frame loop. */
async function settleAtOnce(): Promise<void> {}

const SMOKE_WAITS: MountWaits = { painted: flushOnPaint, settled: settleAtOnce };

afterEach(() => {
    // Body is a page-level singleton that outlives each test; the root
    // Body.init appended must be detached before dispose, or the next mount
    // finds two children under a Fit() that accepts one. A mount whose
    // afterMount threw leaves its root there too.
    for (const root of [...Body.getInstance().getComponents()]) {
        unmount(root);
    }

    // A floating window mounts outside Body, and lays out its content in an
    // animation frame after `show()`: dispose each one the test opened before
    // that frame, since its form's text fields hit the canvas gap `table-rows`
    // is excluded for (see JSDOM_GAPS).
    for (const openWindow of AbstractWindow.getOpenWindows()) {
        openWindow.dispose();
    }

    // The app-wide resize mode is library module state, not per-body state, so
    // a `resize=` run below would otherwise leak into every later mount.
    Body.getInstance().setResizeMode('live');
});

/**
 * Detaches a panel's root from `Body` and disposes it, as the docs site's
 * DocsSidebar.test.ts does.
 *
 * @param root - The panel's root.
 */
function unmount(root: Component): void {
    Body.getInstance().removeComponent(root);
    root.dispose();
}

/**
 * The elements a target names: the target itself when it is an element, its
 * `element` field, and every entry of its `elements` field.
 *
 * @param target - A merged target.
 * @returns The elements it names.
 */
function elementsOf(target: unknown): unknown[] {
    if (target instanceof Element) {
        return [target];
    }

    const fields = (target ?? {}) as { element?: unknown; elements?: unknown };
    const elements: unknown[] = [];

    if ('element' in fields) {
        elements.push(fields.element);
    }

    if ('elements' in fields) {
        expect(Array.isArray(fields.elements) && fields.elements.length > 0, 'elements is a non-empty array').toBe(true);
        elements.push(...(fields.elements as unknown[]));
    }

    return elements;
}

/**
 * Checks a mounted panel's targets: every driver of its default drive, and
 * the page-wide `idle` and `theme`, have one; every value is defined; and
 * every element a target names is in the document.
 *
 * @param panel - The mounted panel.
 */
function expectTargetsReady(panel: MountedPanel): void {
    const drivers = parseDrive(null, panel.module.defaultDrive, 1).map(({ driver }) => driver);

    for (const driver of [...drivers, 'idle', 'theme']) {
        expect(panel.targets, `target for ${driver}`).toHaveProperty(driver);
    }

    for (const [driver, target] of Object.entries(panel.targets)) {
        expect(target, `target for ${driver}`).toBeDefined();

        for (const element of elementsOf(target)) {
            expect(element instanceof Element && element.isConnected, `${driver}: element in the document`).toBe(true);
        }
    }
}

/**
 * Panels P7 cannot mount under jsdom, each with the error it throws there.
 * None is a panel bug; the shakedown run mounts each in the engine.
 */
const JSDOM_GAPS: Record<string, string> = {
    // Its default `grip=dock-h` picks the Dock's gutter by shape, and jsdom
    // lays nothing out, so every gutter's rectangle is empty. P8 mounts it
    // with `grip=tab`, which needs no rectangle.
    'shell-deep': 'shell-deep: no dock-h gutter',
    // Its filter row's text fields measure font metrics through a canvas 2D
    // context, which jsdom does not implement, so `getContext("2d")` is null.
    'table-rows': 'Cannot set properties of null (setting \'font\')',
    // Their labelled grids align title and field on a baseline, and a text
    // field measures its baseline through the same canvas 2D context.
    'form-flat': 'Cannot set properties of null (setting \'font\')',
    'form-nested': 'Cannot set properties of null (setting \'font\')',
};

describe('P7 mount smoke', () => {
    it.each(getPanelIds().filter((id) => !Object.hasOwn(JSDOM_GAPS, id)))('%s mounts and resolves its targets', async (id) => {
        const mounted = await mountPanel(id, new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);

        expectTargetsReady(mounted);
    });

    it.each(Object.entries(JSDOM_GAPS))('%s fails under jsdom only for the gap it is excluded for', async (id, error) => {
        await expect(mountPanel(id, new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS)).rejects.toThrow(error);
    });
});

describe('P8 panel parameters', () => {
    it('shell-shallow rejects a grip only the deep shell has, once mounted', async () => {
        await expect(mountPanel('shell-shallow', new URLSearchParams('n=3&grip=dock-h'), tools, SMOKE_WAITS))
            .rejects.toThrow('shell-shallow: unknown grip "dock-h" (expected sidebar, section)');
    });

    it('table-rows rejects an unknown update before any wait', async () => {
        const waited: string[] = [];

        const waits: MountWaits = {
            painted: async (): Promise<void> => {
                waited.push('painted');
            },
            settled: async (): Promise<void> => {
                waited.push('settled');
            },
        };

        await expect(mountPanel('table-rows', new URLSearchParams('n=3&update=nope'), tools, waits))
            .rejects.toThrow('table-rows: unknown update "nope" (expected record, filter)');
        expect(waited).toEqual([]);
    });

    it('table-rows rejects an unknown rowfilter before any wait', async () => {
        const waited: string[] = [];

        const waits: MountWaits = {
            painted: async (): Promise<void> => {
                waited.push('painted');
            },
            settled: async (): Promise<void> => {
                waited.push('settled');
            },
        };

        await expect(mountPanel('table-rows', new URLSearchParams('n=3&rowfilter=nope'), tools, waits))
            .rejects.toThrow('table-rows: unknown rowfilter "nope" (expected off, title)');
        expect(waited).toEqual([]);
    });

    it('table-rows sets no body row filter with rowfilter absent', async () => {
        // table-rows cannot mount under jsdom (JSDOM_GAPS), so this reads
        // build() and describe() without mounting.
        const module = await loadPanel('table-rows');
        const build = module!.build(20, new URLSearchParams());

        expect(build.describe!()).toMatchObject({ rowFilter: 'off', storeRecords: 20, filteredRows: 20, bodyRowFilter: false });
    });

    it('table-rows sets a body row filter admitting 2/5 of the rows under rowfilter=title', async () => {
        const module = await loadPanel('table-rows');
        const build = module!.build(20, new URLSearchParams('rowfilter=title'));

        expect(build.describe!()).toMatchObject({ rowFilter: 'title', storeRecords: 20, filteredRows: 8, bodyRowFilter: true });
    });

    it('shell-deep drags a tab button under grip=tab', async () => {
        const mounted = await mountPanel('shell-deep', new URLSearchParams('n=3&grip=tab'), tools, SMOKE_WAITS);

        const drag = mounted.targets.drag as { element: Element; axis: string };

        expect(drag.element.classList.contains('TabButton')).toBe(true);
        expect(drag.axis).toBe('x');
        expectTargetsReady(mounted);
    });
});

// C36's fix: the reparent under the already-hidden panel now queues the moved
// canvas for the next effective-visibility flush, so its loop pauses. The panel
// starts its 2D canvases while they are still shown, because `startAnimation`
// reads effective visibility directly and would otherwise refuse to schedule
// anything — that order is what makes `hiddenAnimating` mean something, and both
// counters are read after a synchronous flush.
//
// The 2D context is stubbed because jsdom implements none (the same gap
// `JSDOM_GAPS` records for `table-rows` and the two forms): without it C35's own
// gate would keep every loop from starting at all, `hiddenStarted` would be 0,
// and neither counter would tell us anything about the reparent. C35's half
// needs a real engine (see the panel). The stub stays inside this describe, so
// the `JSDOM_GAPS` tests keep throwing for the gap they are excluded for.
describe('canvas-idle hidden group', () => {
    beforeEach(() => {
        vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext')
            .mockImplementation(((id: string) => (id === '2d'
                ? { font: '', clearRect() {}, save() {}, restore() {}, setTransform() {}, measureText: () => ({ width: 0 }) }
                : null) as unknown as RenderingContext) as typeof window.HTMLCanvasElement.prototype.getContext);
    });

    afterEach(() => vi.restoreAllMocks());

    it('starts its 2D canvases while shown and pauses them when moved under the hidden panel', async () => {
        const mounted = await mountPanel('canvas-idle', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);

        Component.flushEffectiveVisibility();

        const host = mounted.build.describe!() as { hiddenStarted: number; hiddenAnimating: number };

        expect(host.hiddenStarted, 'animating while still in the shown group').toBe(SMOKE_SCALE);
        expect(host.hiddenAnimating, 'paused by the reparent under the hidden panel').toBe(0);
    });
});

/**
 * `SMOKE_WAITS`, recording the name of each wait as it runs, so a test can
 * tell whether a failure came before any wait or after them.
 *
 * @returns The waits and the names recorded.
 */
function recordingSmokeWaits(): { waits: MountWaits; waited: string[] } {
    const waited: string[] = [];

    const waits: MountWaits = {
        painted: async (root: Component, id: string): Promise<void> => {
            waited.push('painted');
            await SMOKE_WAITS.painted(root, id);
        },
        settled: async (): Promise<void> => {
            waited.push('settled');
            await SMOKE_WAITS.settled();
        },
    };

    return { waits, waited };
}

describe('P15 resize mode', () => {
    it('resize= sets the app-wide mode for the run, and rejects any other value', async () => {
        await mountPanel('shell-shallow', new URLSearchParams('n=3&resize=outline'), tools, SMOKE_WAITS);

        expect(Body.getInstance().getResizeMode()).toBe('outline');

        await expect(mountPanel('shell-shallow', new URLSearchParams('n=3&resize=bogus'), tools, SMOKE_WAITS))
            .rejects.toThrow('resize: unknown mode "bogus" (expected live, outline)');
    });

    it('every panel offering drag offers dragout on the same target', async () => {
        const mounted = await mountPanel('shell-shallow', new URLSearchParams('n=3'), tools, SMOKE_WAITS);

        expect(mounted.targets.dragout).toBe(mounted.targets.drag);
    });

    it.each(['shell-deep', 'shell-shallow', 'windows'])('%s labels the resize outline for the geometry probe', async (id) => {
        const module = await loadPanel(id);
        const build = module!.build(SMOKE_SCALE, new URLSearchParams());

        expect(build.geometry!.resizeOutline).toBe('.ResizeOutline');
    });
});

/**
 * The handle whose scroll metrics a panel's `getMaxScrollTop` reads: the inner
 * overlay scroller when one is installed, else the component's own element.
 *
 * @param pane - A scrolling panel.
 * @returns The handle.
 */
function scrollHandleOf(pane: Component): unknown {
    return (pane as unknown as { _overlayScrollElement?: unknown })._overlayScrollElement ?? pane.getElement();
}

/**
 * Frames that let a scrolling panel's resize-settle relay run out: the mount's
 * first layout arms it and it takes two layout flushes to clear, and until it
 * has, a pane withholds the re-measure. One frame more than the two, as margin
 * — `ablations.test.ts` waits the same.
 */
const PANEL_SETTLE_FRAMES = 3;

describe('P16 scroll-panes', () => {
    afterEach(() => vi.restoreAllMocks());

    it('builds n panes of equal rows and resolves a wheel target in the document', async () => {
        const mounted = await mountPanel('scroll-panes', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const host = mounted.build.describe!() as { panes: number; rowsPerPane: number };
        const panes = mounted.build.root.getComponents();
        const wheel = mounted.targets.wheel;

        expect(host.panes).toBe(SMOKE_SCALE);
        expect(panes).toHaveLength(SMOKE_SCALE);
        expect(host.rowsPerPane).toBeGreaterThan(0);
        expect(panes.map((pane) => pane.getComponents().length)).toEqual(panes.map(() => host.rowsPerPane));
        expect(wheel instanceof Element && wheel.isConnected, 'wheel: element in the document').toBe(true);
    });

    it('lays every pane out on a settled pass, where a plain Panel would skip it', async () => {
        const mounted = await mountPanel('scroll-panes', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const root = mounted.build.root;
        const patched = snapshotPatchables([tools.ownerProto(root.getComponents()[0], 'remeasureScrollMetrics')!]);

        await tools.waitFrames(PANEL_SETTLE_FRAMES);

        try {
            mounted.build.installWork!(tools);

            // The pass moves no pane, so a plain `Panel` would take the
            // unchanged-commit skip and never reach `remeasureScrollMetrics` —
            // the call the cell measures. The counter is wrapped on
            // `Panel.prototype`, so its key carries the receiver's class: the
            // panes report under the subclass, the board root under `Panel`.
            const work = counted(() => root.doLayout());

            expect(work['pane.remeasure@ScrollPane']).toBe(SMOKE_SCALE);
            expect(work['pane.remeasure@Panel']).toBe(1);
        } finally {
            restorePatchables(patched);
        }
    });

    it('counts only the panes that overflow as scrollable', async () => {
        const mounted = await mountPanel('scroll-panes', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const panes = mounted.build.root.getComponents();
        const overflowing = scrollHandleOf(panes[0]);

        // jsdom lays nothing out, so every pane's maximum scroll offset is 0 and
        // the witness cannot be told from a plain count of panes. Stubbing the
        // seam's scroll metrics — the read `getMaxScrollTop` takes them from —
        // gives pane 0 content taller than its box and leaves the others
        // fitting. A handle is an opaque number, so the panes are told apart by
        // handle identity rather than by node containment.
        vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation((handle) => ({
            scrollTop: 0,
            scrollLeft: 0,
            scrollWidth: 0,
            clientWidth: 0,
            clientHeight: PANE_CLIENT_HEIGHT_PX,
            scrollHeight: handle === overflowing ? PANE_SCROLL_HEIGHT_PX : PANE_CLIENT_HEIGHT_PX,
        }));

        const host = mounted.build.describe!() as { panes: number; scrollablePanes: number; maxScrollTop0: number };

        expect(host.panes).toBe(SMOKE_SCALE);
        expect(host.scrollablePanes).toBe(1);
        expect(host.maxScrollTop0).toBe(PANE_SCROLL_HEIGHT_PX - PANE_CLIENT_HEIGHT_PX);
    });

    it('labels a row of a pane no phase scrolls', async () => {
        const mounted = await mountPanel('scroll-panes', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const panes = mounted.build.root.getComponents();
        const row1 = mounted.build.geometry!.row1;

        // `wheel` scrolls pane 0, and a label on scrolled content would move
        // with an offset no two runs share. So `row1` is a row of pane 1: it
        // still catches a wrongly reserved gutter or a wrongly sized shadow
        // overlay, both of which move content, without moving itself.
        expect(panes[1].getComponents()).toContain(row1);
        expect(panes[0].getComponents()).not.toContain(row1);
    });

    it('labels pane 0\'s first row, which moves with the ladder by a repeatable offset', async () => {
        const mounted = await mountPanel('scroll-panes', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const panes = mounted.build.root.getComponents();
        const { row0, row1 } = mounted.build.geometry!;

        // `row0` sits on content the ladder scrolls, which a wheel phase would
        // make useless as a gate. The ladder writes `Math.round(fraction *
        // span)` from the unit index alone, so unit `k` is at the same integer
        // pixel in every run and `row0` is a probe instead of a liability.
        expect(panes[0].getComponents()).toContain(row0);
        expect(panes[0].getComponents()).not.toContain(row1);
    });

    it('walks a triangle of absolute offsets, and leaves the pane it excludes at rest', async () => {
        // jsdom lays nothing out, so every pane's clamped read-back would be 0
        // and the ladder would write nothing. Stubbing the seam's scroll read —
        // the one `setScrollTop` takes its clamped result from — gives every
        // pane a span, and the offsets are then arithmetic. It has to be in
        // place before the mount, because the spans are measured once in
        // `afterMount` and held for the run. The ladder constants are the ones
        // P18 shares, below.
        vi.spyOn(DOM.source, 'getScrollTop').mockReturnValue(LADDER_SPAN_PX);

        const mounted = await mountPanel('scroll-panes', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const panes = mounted.build.root.getComponents();

        // Spied after the mount, so the span probe's own writes per pane are
        // not among these calls. jsdom's `scrollTop` is not a layout value, so
        // the write is what the case can read; the offset never lands.
        const writes = panes.map((pane) => vi.spyOn(pane, 'setScrollTop'));
        const ladder = mounted.targets.call as CallTarget;

        for (const unit of LADDER_UNITS) {
            ladder(unit);
        }

        expect(writes[0].mock.calls.map(([offset]) => offset)).toEqual(LADDER_OFFSETS);
        expect(writes[2].mock.calls.map(([offset]) => offset)).toEqual(LADDER_OFFSETS);

        // Pane 1 is the one the ladder leaves alone, so the `pane1` and `row1`
        // labels hold still and the case above them stays true.
        expect(writes[1]).not.toHaveBeenCalled();
    });

    it('repeats a lap, so units a period apart write the same offset', async () => {
        vi.spyOn(DOM.source, 'getScrollTop').mockReturnValue(LADDER_SPAN_PX);

        const mounted = await mountPanel('scroll-panes', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const pane0 = mounted.build.root.getComponents()[0];
        const write = vi.spyOn(pane0, 'setScrollTop');
        const ladder = mounted.targets.call as CallTarget;

        // A whole lap plus its mirror image: the cells drive whole multiples of
        // the period, so every position has to be visited the same number of
        // times by every run of every arm.
        for (let unit = 0; unit <= LADDER_PERIOD; unit++) {
            ladder(unit);
            ladder(unit + LADDER_PERIOD);
        }

        const offsets = write.mock.calls.map(([offset]) => offset);

        expect(offsets).toHaveLength(2 * (LADDER_PERIOD + 1));
        expect(offsets.filter((_, i) => i % 2 === 0)).toEqual(offsets.filter((_, i) => i % 2 === 1));
    });

    it('writes no offset, and counts no pane, where nothing scrolls', async () => {
        // A pane whose clamped read-back is 0 cannot scroll, so the ladder has
        // nowhere to walk and must leave it alone rather than write a stream of
        // zeroes. jsdom stores an unclamped `scrollTop`, so its own read-back
        // is the probe's own value rather than 0 — the seam's scroll read is
        // stubbed to model the pane that really cannot scroll.
        vi.spyOn(DOM.source, 'getScrollTop').mockReturnValue(0);

        const mounted = await mountPanel('scroll-panes', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const panes = mounted.build.root.getComponents();
        const host = mounted.build.describe!() as { ladderPanes: number };
        const writes = panes.map((pane) => vi.spyOn(pane, 'setScrollTop'));
        const ladder = mounted.targets.call as CallTarget;

        expect(host.ladderPanes).toBe(0);

        for (const unit of LADDER_UNITS) {
            expect(() => ladder(unit)).not.toThrow();
        }

        expect(writes.every((write) => write.mock.calls.length === 0)).toBe(true);
    });

    it('counts the panes the ladder writes to, leaving one of n out', async () => {
        vi.spyOn(DOM.source, 'getScrollTop').mockReturnValue(LADDER_SPAN_PX);

        const mounted = await mountPanel('scroll-panes', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const host = mounted.build.describe!() as { panes: number; ladderPanes: number };

        // The witness the run reads before either arm: it separates "the ladder
        // wrote to nothing" from "it wrote and the arm still saved nothing",
        // which is the distinction the `unreached` reading could not make.
        expect(host.panes).toBe(SMOKE_SCALE);
        expect(host.ladderPanes).toBe(SMOKE_SCALE - 1);
    });

    it('counts every entry into the framework\'s scroll-shadow path', async () => {
        const mounted = await mountPanel('scroll-panes', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const pane0 = mounted.build.root.getComponents()[0];

        // One snapshot covers both counters: `remeasureScrollMetrics` and
        // `updateScrollShadows` are own properties of the same prototype.
        const patched = snapshotPatchables([tools.ownerProto(pane0, 'remeasureScrollMetrics')!]);

        try {
            mounted.build.installWork!(tools);

            // The witness that says the scroll-shadow path ran at all. It is
            // wrapped on `Panel.prototype`, so the key carries the receiver's
            // class, as `pane.remeasure` does.
            expect(counted(() => (pane0 as unknown as { updateScrollShadows(): void }).updateScrollShadows())['pane.shadowUpdate@ScrollPane']).toBe(1);
        } finally {
            restorePatchables(patched);
        }
    });

    it('counts a scroll tick delivered inside pane 0, captured rather than bubbled', async () => {
        const mounted = await mountPanel('scroll-panes', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const pane0 = mounted.build.root.getComponents()[0];
        const inner = document.createElement('div');

        // `installWork` also puts a counter on `Panel.prototype`, which every
        // later mount in this file would otherwise inherit.
        const patched = snapshotPatchables([tools.ownerProto(pane0, 'remeasureScrollMetrics')!]);

        try {
            mounted.build.installWork!(tools);
            elementFor(tools, pane0, 'scroll-panes').appendChild(inner);

            // A `scroll` event does not bubble, and under overlay scrollbars it
            // fires on an element inside the pane rather than on the pane's own:
            // a listener that did not capture would never see this one.
            expect(counted(() => inner.dispatchEvent(new Event('scroll')))['pane.scrollTick']).toBe(1);
        } finally {
            restorePatchables(patched);
        }
    });
});

/** The `MarkdownViewer` heading tracker P18 reaches into, as `markdown-doc`'s own counter does. */
interface HeadingTracker {
    getHeadings(): Array<{ id: string }>;
    setActiveHeading(id: string | null): void;
}

/**
 * The work counters of one counting window of one unit around `work`, as
 * `ablations.test.ts`'s own helper takes them.
 *
 * @param work - The work to count.
 * @returns The work counters; empty when nothing tallied.
 */
function counted(work: () => void): Record<string, number> {
    let counts: PhaseCounts = {};

    startCounting();

    // Closed even when `work` throws, so no later case counts into it.
    try {
        work();
    } finally {
        counts = stopCounting(1);
    }

    return counts.work ?? {};
}

/**
 * Font metrics a theme switch can re-measure offline. A switch re-derives every
 * button's optical centre through `measureFontMetrics`, which takes a canvas 2D
 * context jsdom does not implement (the gap `JSDOM_GAPS` records for
 * `table-rows` and the two forms), and `editor-tabs` has a tab button per tab.
 * Stubbed at the DOM seam, as the library's own offline DOM source models it,
 * rather than on the canvas: the library caches its metrics canvas in a
 * module-level variable, and a fake one would outlive this describe.
 */
const STUB_FONT_METRICS = { ascent: 13, descent: 3, capTop: 10 };

describe('P17 editor-tabs', () => {
    beforeEach(() => {
        vi.spyOn(DOM.source, 'measureFontMetrics').mockReturnValue(STUB_FONT_METRICS);
    });

    afterEach(() => vi.restoreAllMocks());

    it('builds one editor per tab beside the always-visible reference', async () => {
        const mounted = await mountPanel('editor-tabs', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const [reference, tabbed] = mounted.build.root.getComponents();
        const host = mounted.build.describe!() as { tabs: number };

        expect(host.tabs).toBe(SMOKE_SCALE);
        expect(reference).toBe(mounted.build.geometry!.reference);
        expect(tabbed).toBe(mounted.build.geometry!.tabbed);
        expect(tabbed.getComponents()).toHaveLength(SMOKE_SCALE);

        // `editorViews` is the panel's own census — `n + 1` is what says every
        // hidden tab still holds a view — so a `.cm-editor` outside the root,
        // another panel's or a stray, must not inflate it.
        const views = (mounted.build.describe!() as { editorViews: number }).editorViews;
        const stray = document.createElement('div');

        stray.className = 'cm-editor';
        document.body.appendChild(stray);

        try {
            expect((mounted.build.describe!() as { editorViews: number }).editorViews).toBe(views);
        } finally {
            stray.remove();
        }
    });

    it('splits a theme switch into one shown editor and n - 1 hidden ones, the reference counted through the prototype', async () => {
        const mounted = await mountPanel('editor-tabs', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const theme = mounted.targets.theme as ThemeTarget;
        const reference = mounted.build.root.getComponents()[0];
        const hiddenEditor = mounted.build.root.getComponents()[1].getComponents()[1];

        // `installWork` puts a counter on `CodeEditor.prototype`, which every
        // later mount in this file would otherwise inherit.
        const patched = snapshotPatchables([tools.ownerProto(reference, 'onThemeChange')!]);

        try {
            mounted.build.installWork!(tools);

            // One tab editor asked on its own: its instance wrapper must
            // delegate *into* the prototype counter, so both rise together. An
            // instance wrapper installed before `countMethod` had replaced the
            // prototype method would hold the unwrapped original, and the tab
            // editors would be missing from `onThemeChange@CodeEditor` — the
            // count the cell scores the arm on. Asked through this one editor
            // rather than over a whole switch, because editors mounted by
            // earlier cases in this file are still subscribed to the theme and
            // the prototype counter sees them too.
            const direct = counted(() => (hiddenEditor as unknown as { onThemeChange(): void }).onThemeChange());

            expect(direct['theme.hidden']).toBe(1);
            expect(direct['onThemeChange@CodeEditor']).toBe(1);

            // Unit 0 switches the theme before it shows the next tab, so tab 0
            // is still the selected one when the switch goes out: one editor
            // takes it shown and the rest hidden, which is the population
            // `g25.theme-withhold` could skip. Both counters are the panel's
            // own instance wrappers, so no other editor contributes.
            const work = counted(() => theme.cycle(0));

            expect(work['theme.shown']).toBe(1);
            expect(work['theme.hidden']).toBe(SMOKE_SCALE - 1);

            // Past the lap — tab 2 is the last at n = 3 — no further unit shows
            // anything, and the panel's record still names a tab that exists,
            // so one editor keeps taking each switch shown. A lap that ran one
            // unit long would leave the record naming a tab the panel does not
            // have, and no editor would be the shown one; `setActiveTabIndex`
            // is a silent no-op past the last tab, so the selection alone
            // cannot tell.
            theme.cycle(2);
            theme.cycle(4);

            const past = counted(() => theme.cycle(6));

            expect(past['theme.shown']).toBe(1);
            expect(past['theme.hidden']).toBe(SMOKE_SCALE - 1);
        } finally {
            restorePatchables(patched);
            theme.restore();
        }
    });

    it('checks the shown tab against the reference, and finds them themed alike', async () => {
        const mounted = await mountPanel('editor-tabs', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const theme = mounted.targets.theme as ThemeTarget;

        // Unit 0 switches the theme and then shows tab 1; unit 1 checks that
        // tab before switching back. With nothing withholding a reconfigure,
        // the tab's editor carries the same theme classes as the reference —
        // and `theme.indistinct` stays absent, which is what says the switch
        // left a trace in the class list at all, so the check could have failed.
        theme.cycle(0);

        const work = counted(() => theme.cycle(1));

        expect(work['theme.match']).toBe(1);
        expect(work['theme.mismatch']).toBeUndefined();
        expect(work['theme.indistinct']).toBeUndefined();

        theme.restore();
    });

    it('ignores the focus class, which no theme switch writes', async () => {
        const mounted = await mountPanel('editor-tabs', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const theme = mounted.targets.theme as ThemeTarget;
        const shown = mounted.build.root.getComponents()[1].getComponents()[1];
        const view = elementFor(tools, shown, 'P17').querySelector('.cm-editor')!;

        try {
            theme.cycle(0);

            // CodeMirror puts `cm-focused` on the view it has the caret in, and
            // one editor of the two being compared can have it while the other
            // does not. It is the one class expected to differ, so the check
            // drops it: left in, a focused editor would read as a theme
            // mismatch and void the cell.
            view.classList.add('cm-focused');

            expect(counted(() => theme.cycle(1))['theme.match']).toBe(1);
        } finally {
            theme.restore();
        }
    });

    it('catches a shown tab whose editor was left on the theme it was hidden under', async () => {
        const mounted = await mountPanel('editor-tabs', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const theme = mounted.targets.theme as ThemeTarget;
        const stale = mounted.build.root.getComponents()[1].getComponents()[1] as unknown as Record<string, unknown>;

        // Stands in for a withheld reconfigure that is never caught up: tab 1's
        // editor takes no theme change at all, so it comes back carrying the
        // classes it was mounted under while the reference carries the new ones.
        // Without this the check could not be shown to discriminate — in the
        // plain path every editor is themed alike, so a check comparing the
        // wrong pair would report `theme.match` just the same.
        stale.onThemeChange = (): void => {};

        theme.cycle(0);

        const work = counted(() => theme.cycle(1));

        expect(work['theme.mismatch']).toBe(1);
        expect(work['theme.match']).toBeUndefined();
        expect(work['theme.indistinct']).toBeUndefined();

        theme.restore();
    });

    it('switches the theme before it shows the next tab, so the tab coming back was hidden for it', async () => {
        const mounted = await mountPanel('editor-tabs', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const tab = (mounted.build.geometry!.tabbed as unknown as { getTab(): { getActiveTabIndex(): number } }).getTab();
        const theme = mounted.targets.theme as ThemeTarget;
        const shown = mounted.build.root.getComponents()[1].getComponents()[1] as unknown as Record<string, unknown>;
        const original = shown.onThemeChange as (this: unknown) => void;
        const selectedWhenSwitched: number[] = [];

        shown.onThemeChange = function (this: unknown): void {
            selectedWhenSwitched.push(tab.getActiveTabIndex());
            original.call(this);
        };

        try {
            theme.cycle(0);

            // The whole cell turns on this order. Shown first and switched
            // after, tab 1's editor would be visible when the switch went out,
            // `g25.theme-withhold` would never withhold from it, and the
            // stale-show transition the cell exists to gate would not happen —
            // while `theme.hidden`, `theme.shown` and every check read exactly
            // the same. So the order is pinned by when the notification lands,
            // not by what it counts.
            expect(selectedWhenSwitched).toEqual([0]);
            expect(tab.getActiveTabIndex()).toBe(1);
        } finally {
            theme.restore();
        }
    });

    it('reports a check as indistinct when the switch left no trace on the reference', async () => {
        const mounted = await mountPanel('editor-tabs', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const theme = mounted.targets.theme as ThemeTarget;
        const reference = mounted.build.root.getComponents()[0] as unknown as Record<string, unknown>;

        // The reference is the check's yardstick. An editor that takes no theme
        // change keeps the classes it was mounted under, so the comparison
        // proves nothing whatever the arm did, and `theme.indistinct` is what
        // says so in the report. Without a case that makes it fire, a guard
        // that could never fire — a `mountClasses` left empty, say — would pass
        // the suite while telling the reader nothing.
        reference.onThemeChange = (): void => {};

        theme.cycle(0);

        try {
            const work = counted(() => theme.cycle(1));

            expect(work['theme.indistinct']).toBe(1);
            expect(work['theme.mismatch']).toBe(1);
        } finally {
            theme.restore();
        }
    });

    it('shows each tab once inside the theme phase, and restores the tab and the theme', async () => {
        const mounted = await mountPanel('editor-tabs', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const tab = (mounted.build.geometry!.tabbed as unknown as { getTab(): { getActiveTabIndex(): number } }).getTab();
        const theme = mounted.targets.theme as ThemeTarget;
        const started = ThemeManager.getTheme();

        // `afterMount` shows every tab once so each editor mounts a view, then
        // comes back to tab 0, where the phase starts.
        expect(tab.getActiveTabIndex()).toBe(0);

        theme.cycle(0);

        expect(tab.getActiveTabIndex(), 'an even unit shows the next tab').toBe(1);
        expect(ThemeManager.getTheme(), 'an even unit leaves the page on the other theme').not.toBe(started);

        theme.cycle(1);

        expect(tab.getActiveTabIndex(), 'an odd unit checks, and shows nothing').toBe(1);

        theme.cycle(2);

        expect(tab.getActiveTabIndex()).toBe(2);

        theme.cycle(4);

        expect(tab.getActiveTabIndex(), 'the lap is over at n = 3: there is no tab 3').toBe(2);

        theme.restore();

        expect(tab.getActiveTabIndex()).toBe(0);
        expect(ThemeManager.getTheme()).toBe(started);
    });
});

// The ladder constants P16 and P18 share: `markdown-doc` and `scroll-panes`
// walk the same triangle, so the two blocks' cases straddle the same positions.
// P16's own cases sit above these declarations and read them from their test
// bodies, which run once the module has been evaluated.

/** The scrollable span `getScrollTop` is stubbed to report, so the ladder has somewhere to walk: even, so half of it is a whole pixel. */
const LADDER_SPAN_PX = 1200;

/** Units per lap, as both panels declare it: a lap is a whole second of units at 60 Hz. */
const LADDER_PERIOD = 24;

/** The ladder units the two blocks walk: a whole lap of the triangle, at its two ends and its peak. */
const LADDER_UNITS = [0, LADDER_PERIOD / 4, LADDER_PERIOD / 2, (3 * LADDER_PERIOD) / 4, LADDER_PERIOD];

/** The offsets those units land on over `LADDER_SPAN_PX`. */
const LADDER_OFFSETS = [0, LADDER_SPAN_PX / 2, LADDER_SPAN_PX, LADDER_SPAN_PX / 2, 0];

/** The tolerance the oracle re-implements, used only to position the rectangles the pin straddles it with. */
const HEADING_TOLERANCE_PX = 1;

/** The pane's own top, and a heading top on either side of it, for the oracle's rectangle stubs. */
const PANE_TOP_PX = 0;
const BELOW_PANE_TOP_PX = 40;
const ABOVE_PANE_TOP_PX = -40;

/** A pane taller than its viewport, for the "scrolled to the maximum" stub. */
const PANE_CLIENT_HEIGHT_PX = 500;
const PANE_SCROLL_HEIGHT_PX = 1000;

/**
 * Stubs a jsdom element's rectangle top, as `drivers.dom.test.ts`'s own
 * `stubRect` does: jsdom lays nothing out, so every rectangle the heading
 * oracle reads is 0 and its rule collapses to one answer.
 *
 * @param element - The element.
 * @param top - Its top edge.
 */
function stubTop(element: Element, top: number): void {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
        left: 0, top, width: 0, height: 0, right: 0, bottom: top, x: 0, y: top, toJSON: () => ({}),
    } as DOMRect);
}

/**
 * Stubs an element's scroll metrics as a pane whose content fits: no overflow,
 * and an offset that is its maximum and its minimum at once.
 *
 * @param element - The element.
 */
function stubFitsContent(element: Element): void {
    for (const name of ['clientHeight', 'scrollHeight']) {
        Object.defineProperty(element, name, { value: PANE_CLIENT_HEIGHT_PX, writable: true, configurable: true });
    }

    Object.defineProperty(element, 'scrollTop', { value: 0, writable: true, configurable: true });
}

/**
 * Stubs an element's scroll metrics as a pane scrolled to its maximum. jsdom
 * reports 0 for all three, so the oracle's own `atMax` test — `scrollHeight >
 * clientHeight` — can never hold without this. The properties are own
 * properties of the element, which the panel's mount disposes after each case,
 * and writable, because the panel's own teardown restores a subtree's scroll.
 *
 * @param element - The element.
 */
function stubScrolledToMax(element: Element): void {
    const metrics = {
        clientHeight: PANE_CLIENT_HEIGHT_PX,
        scrollHeight: PANE_SCROLL_HEIGHT_PX,
        scrollTop: PANE_SCROLL_HEIGHT_PX - PANE_CLIENT_HEIGHT_PX,
    };

    for (const [name, value] of Object.entries(metrics)) {
        Object.defineProperty(element, name, { value, writable: true, configurable: true });
    }
}

describe('P18 markdown-doc scroll ladder and heading oracle', () => {
    afterEach(() => vi.restoreAllMocks());

    it('walks a triangle of absolute offsets over the span it measured', async () => {
        // jsdom neither lays out nor scrolls, so the span the probe reads back
        // would be 0 and the ladder would write nothing. Stubbing the seam's
        // scroll read — the one `setScrollTop` takes its clamped result from —
        // gives the ladder a span, and the offsets are then arithmetic.
        vi.spyOn(DOM.source, 'getScrollTop').mockReturnValue(LADDER_SPAN_PX);

        const mounted = await mountPanel('markdown-doc', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const viewer = mounted.build.geometry!.viewer as Component;
        const host = mounted.build.describe!() as { maxScrollTop: number };
        const write = vi.spyOn(viewer, 'setScrollTop');
        const ladder = mounted.targets.call as CallTarget;

        expect(host.maxScrollTop).toBe(LADDER_SPAN_PX);

        for (const unit of LADDER_UNITS) {
            ladder(unit);
        }

        expect(write.mock.calls.map(([offset]) => offset)).toEqual(LADDER_OFFSETS);
    });

    it('writes no offset at all where nothing scrolls', async () => {
        // A page whose clamped read-back is 0 cannot scroll, so the ladder has
        // nowhere to walk and must leave the viewer alone rather than write a
        // stream of zeroes. jsdom stores an unclamped `scrollTop`, so its own
        // read-back is the probe's own value, not 0 — the seam's scroll read is
        // stubbed to model the page that really cannot scroll.
        vi.spyOn(DOM.source, 'getScrollTop').mockReturnValue(0);

        const mounted = await mountPanel('markdown-doc', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const viewer = mounted.build.geometry!.viewer as Component;
        const host = mounted.build.describe!() as { maxScrollTop: number };
        const write = vi.spyOn(viewer, 'setScrollTop');
        const ladder = mounted.targets.call as CallTarget;

        expect(host.maxScrollTop).toBe(0);

        for (const unit of LADDER_UNITS) {
            expect(() => ladder(unit)).not.toThrow();
        }

        expect(write).not.toHaveBeenCalled();
    });

    it('agrees with the rule over live rectangles, and disagrees with any other answer', async () => {
        const mounted = await mountPanel('markdown-doc', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const viewer = mounted.build.geometry!.viewer as unknown as { _tracker: HeadingTracker };
        const pane = tools.findComponent('MarkdownContentPane')!;

        mounted.build.installWork!(tools);

        const tracker = viewer._tracker;
        const ids = tracker.getHeadings().map((heading) => heading.id);

        // Naming the pane is what arms the oracle: the panel takes it from a
        // scroll event delivered by an element that holds the prose.
        elementFor(tools, pane as unknown as { getId(): string }, 'P18').dispatchEvent(new Event('scroll'));

        // jsdom gives every element an empty rectangle, so every heading's top
        // is the pane's own — every one of them counts as at or above it, and
        // the rule resolves to the last heading in the document. That the
        // earlier headings and `null` both disagree is what says the oracle
        // compares anything at all: a check that always agreed would report
        // `heading.agree` here three times over.
        expect(ids.length).toBeGreaterThan(1);
        expect(counted(() => tracker.setActiveHeading(ids[ids.length - 1]))['heading.agree']).toBe(1);
        expect(counted(() => tracker.setActiveHeading(ids[0]))['heading.disagree']).toBe(1);
        expect(counted(() => tracker.setActiveHeading(null))['heading.disagree']).toBe(1);
    });

    it('resolves the heading at max scroll, where the top-crossing rule alone cannot', async () => {
        const mounted = await mountPanel('markdown-doc', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const viewer = mounted.build.geometry!.viewer as unknown as { _tracker: HeadingTracker };
        const pane = tools.findComponent('MarkdownContentPane')!;
        const paneElement = elementFor(tools, pane as unknown as { getId(): string }, 'P18');

        mounted.build.installWork!(tools);

        const tracker = viewer._tracker;
        const ids = tracker.getHeadings().map((heading) => heading.id);
        const headings = ids.map((id) => paneElement.querySelector(`[id="${id}"]`)!);

        paneElement.dispatchEvent(new Event('scroll'));

        expect(headings.every((heading) => heading !== null)).toBe(true);

        stubScrolledToMax(paneElement);
        stubTop(paneElement, PANE_TOP_PX);

        // Every heading still below the pane's top, with the pane scrolled to
        // its maximum: nothing can bring the first one up any further, so it is
        // active outright even though no earlier heading ever crossed the top —
        // there is no earlier heading. This is the row the plan's predicate
        // table required a previous heading for, and it is why the plain arm
        // would raise `heading.disagree` at the foot of a document without the
        // widening the `## Implementation Notes` record.
        for (const heading of headings) {
            stubTop(heading, BELOW_PANE_TOP_PX);
        }

        expect(counted(() => tracker.setActiveHeading(ids[0]))['heading.agree']).toBe(1);
        expect(counted(() => tracker.setActiveHeading(ids[1]))['heading.disagree']).toBe(1);
        expect(counted(() => tracker.setActiveHeading(null))['heading.disagree']).toBe(1);

        // The first heading above the pane's top and the rest below it, still
        // at max scroll: the first one *not* yet reached wins outright, so the
        // heading that last crossed the top — the answer everywhere else in the
        // document — is the wrong one here. This is what separates the at-max
        // arm from the top-crossing rule; without it both answer alike.
        stubTop(headings[0], ABOVE_PANE_TOP_PX);

        expect(counted(() => tracker.setActiveHeading(ids[1]))['heading.agree']).toBe(1);
        expect(counted(() => tracker.setActiveHeading(ids[0]))['heading.disagree']).toBe(1);

        // Every heading above the pane's top, still at max scroll: none is left
        // for the at-max arm to take, so the last one that crossed wins.
        for (const heading of headings) {
            stubTop(heading, ABOVE_PANE_TOP_PX);
        }

        expect(counted(() => tracker.setActiveHeading(ids[ids.length - 1]))['heading.agree']).toBe(1);
        expect(counted(() => tracker.setActiveHeading(ids[0]))['heading.disagree']).toBe(1);
    });

    it('treats a pane that fits its content as not scrolled to its maximum', async () => {
        const mounted = await mountPanel('markdown-doc', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const viewer = mounted.build.geometry!.viewer as unknown as { _tracker: HeadingTracker };
        const pane = tools.findComponent('MarkdownContentPane')!;
        const paneElement = elementFor(tools, pane as unknown as { getId(): string }, 'P18');

        mounted.build.installWork!(tools);

        const tracker = viewer._tracker;
        const ids = tracker.getHeadings().map((heading) => heading.id);

        paneElement.dispatchEvent(new Event('scroll'));

        // A pane with nothing to scroll sits at offset 0 and at its maximum at
        // once, so "at or past the maximum" alone is true of it. The rule
        // requires overflow as well, and without that requirement a pane
        // showing the whole document would resolve its first heading active
        // rather than none — the one state the overflow clause decides.
        stubFitsContent(paneElement);
        stubTop(paneElement, PANE_TOP_PX);

        for (const id of ids) {
            stubTop(paneElement.querySelector(`[id="${id}"]`)!, BELOW_PANE_TOP_PX);
        }

        expect(counted(() => tracker.setActiveHeading(null))['heading.agree']).toBe(1);
        expect(counted(() => tracker.setActiveHeading(ids[0]))['heading.disagree']).toBe(1);
    });

    it('answers as the exported library rule does over rectangles the tolerance alone separates', async () => {
        const mounted = await mountPanel('markdown-doc', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const viewer = mounted.build.geometry!.viewer as unknown as { _tracker: HeadingTracker };
        const pane = tools.findComponent('MarkdownContentPane')!;
        const paneElement = elementFor(tools, pane as unknown as { getId(): string }, 'P18');

        mounted.build.installWork!(tools);

        const tracker = viewer._tracker;
        const ids = tracker.getHeadings().map((heading) => heading.id);
        const headings = ids.map((id) => paneElement.querySelector(`[id="${id}"]`)!);

        paneElement.dispatchEvent(new Event('scroll'));

        // Straddle the tolerance: the first heading sits one tolerance below the
        // pane's top, which still counts as at or above it, and the rest sit a
        // pixel further down, which does not. The oracle re-implements the
        // library's `ACTIVE_HEADING_TOP_TOLERANCE_PX` because it is not
        // exported, so this is what guards the two from drifting apart — the
        // exported rule and the oracle have to answer the same over rectangles
        // that only the tolerance separates. Move the library's value and the
        // agreement breaks here.
        stubTop(paneElement, PANE_TOP_PX);
        stubTop(headings[0], PANE_TOP_PX + HEADING_TOLERANCE_PX);

        for (const heading of headings.slice(1)) {
            stubTop(heading, PANE_TOP_PX + HEADING_TOLERANCE_PX + 1);
        }

        // The exported rule takes a seam handle, not an element, and reads it
        // through the same `getBoundingClientRect` the stubs above replaced — so
        // both answer over one set of rectangles: the pane's own element, which
        // is what the panel's scroll listener named as the pane.
        const paneHandle = (pane as unknown as { getElement(): unknown }).getElement();
        const expected = findActiveHeading(paneHandle as Parameters<typeof findActiveHeading>[0], tracker.getHeadings() as Parameters<typeof findActiveHeading>[1]);

        expect(expected).toBe(ids[0]);
        expect(counted(() => tracker.setActiveHeading(expected))['heading.agree']).toBe(1);
        expect(counted(() => tracker.setActiveHeading(ids[1]))['heading.disagree']).toBe(1);
    });

    it('arms the oracle only from a scroller that holds the prose', async () => {
        const mounted = await mountPanel('markdown-doc', new URLSearchParams({ n: String(SMOKE_SCALE) }), tools, SMOKE_WAITS);
        const viewer = mounted.build.geometry!.viewer as unknown as { _tracker: HeadingTracker };
        const pane = tools.findComponent('MarkdownContentPane')!;
        const stranger = document.createElement('div');

        mounted.build.installWork!(tools);

        const tracker = viewer._tracker;
        const ids = tracker.getHeadings().map((heading) => heading.id);

        elementFor(tools, viewer as unknown as { getId(): string }, 'P18').appendChild(stranger);

        // A fence's editor scrolls its own `.cm-scroller` on the same capture
        // path, and the minimap is another candidate; neither holds a heading.
        // Taken for the pane, one of them would have the oracle compare against
        // the wrong rectangles and raise `heading.disagree` on the plain arm —
        // the counter cell `m60l` is gated on. So a scroll from an element that
        // holds no heading must leave the oracle disarmed, counting neither.
        stranger.dispatchEvent(new Event('scroll'));

        const disarmed = counted(() => tracker.setActiveHeading(ids[ids.length - 1]));

        expect(disarmed['heading.agree']).toBeUndefined();
        expect(disarmed['heading.disagree']).toBeUndefined();

        // The pane's own scroll arms it, and a later stranger does not unseat
        // it: with the pane in hand the rule resolves to the last heading, which
        // it could not do over an element holding none.
        elementFor(tools, pane as unknown as { getId(): string }, 'P18').dispatchEvent(new Event('scroll'));
        stranger.dispatchEvent(new Event('scroll'));

        expect(counted(() => tracker.setActiveHeading(ids[ids.length - 1]))['heading.agree']).toBe(1);
    });
});

describe('P14 panel parameters', () => {
    it('form-flat rejects an unknown passes in build, before any wait', async () => {
        const { waits, waited } = recordingSmokeWaits();

        await expect(mountPanel('form-flat', new URLSearchParams('n=3&passes=nope'), tools, waits))
            .rejects.toThrow('form-flat: unknown passes "nope" (expected form, header, date, combo)');
        expect(waited).toEqual([]);
    });

    it('form-flat rejects an unknown click in build, before any wait', async () => {
        const { waits, waited } = recordingSmokeWaits();

        await expect(mountPanel('form-flat', new URLSearchParams('n=3&click=nope'), tools, waits))
            .rejects.toThrow('form-flat: unknown click "nope" (expected toggle, root, combo)');
        expect(waited).toEqual([]);
    });

    it('form-flat offers update once it holds a slider, and its write needs no mount', async () => {
        // The first slider is field 8, so `n=7` holds none. The write is
        // called unmounted, as in P1: a programmatic write that dispatched a
        // DOM event would throw here for want of an element.
        const module = await loadPanel('form-flat');
        const withSlider = module!.build(8, new URLSearchParams());
        const withoutSlider = module!.build(7, new URLSearchParams());

        expect(typeof withSlider.targets.update).toBe('function');
        expect(withoutSlider.targets.update).toBeUndefined();
        expect(() => (withSlider.targets.update as CallTarget)(0)).not.toThrow();
    });

    it('windows rejects an unknown grip in afterMount, once painted and settled', async () => {
        const { waits, waited } = recordingSmokeWaits();

        await expect(mountPanel('windows', new URLSearchParams('n=3&grip=nope'), tools, waits))
            .rejects.toThrow('windows: unknown grip "nope" (expected header, edge)');
        expect(waited).toEqual(['painted', 'settled']);
    });

    it('diagram-graph resolves once laid out, clicking its node layer', async () => {
        const mounted = await mountPanel('diagram-graph', new URLSearchParams('n=3'), tools, SMOKE_WAITS);
        const click = mounted.targets.click as { elements: Element[] };

        expect(click.elements[0].classList.contains('DiagramNodeLayer')).toBe(true);
        expectTargetsReady(mounted);
    });
});
