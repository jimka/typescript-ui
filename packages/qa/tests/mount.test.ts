// @vitest-environment jsdom
//
// Mounts every panel through the real `mountPanel` — build, `Body.init`, the
// two waits, `afterMount` and the target merge — without opening a window.
// The panels mount into the real page body, so this file needs a real DOM.
// jsdom lays nothing out, so a driver cannot run on a mounted panel here;
// drivers.dom.test.ts checks the drivers' event sequences on stubbed
// rectangles instead.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Body, Component, DOM } from '@jimka/typescript-ui/core';
import { AbstractWindow } from '@jimka/typescript-ui/overlay';
import { startCounting, stopCounting } from '../src/harness/counters.js';
import type { PhaseCounts } from '../src/harness/counters.js';
import { createTools, parseDrive } from '../src/harness/run.js';
import type { CallTarget, HarnessTools } from '../src/harness/types.js';
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
