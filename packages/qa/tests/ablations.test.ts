// @vitest-environment jsdom
//
// The W3.0 ablations, offline: each case mounts a panel through the real
// `mountPanel`, as mount.test.ts does, applies one ablation and checks that it
// installs, skips on its condition and delegates otherwise, counting each skip
// under its own name. jsdom lays nothing out and animates nothing, so whether
// an ablation engages in the engine, and keeps the geometry, is the sweep's
// `engaged` and `geom` reading, not this file's. A14, A18 and A19 need a
// canvas 2D context and live in ablations.canvas.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Body, Component, DOM, Panel } from '@jimka/typescript-ui/core';
import { findActiveHeading } from '@jimka/typescript-ui/component/display';
import type { MarkdownHeading } from '@jimka/typescript-ui/component/display';
import { AbstractWindow, Tooltip } from '@jimka/typescript-ui/overlay';
import { ABLATIONS } from '../src/harness/ablations.js';
import { bumpWork, installSeamCounters, installWorkCounters, startCounting, stopCounting } from '../src/harness/counters.js';
import type { PhaseCounts } from '../src/harness/counters.js';
import { createTools } from '../src/harness/run.js';
import type { AnyObj, CallTarget, HarnessLibrary, HarnessTools } from '../src/harness/types.js';
import { mountPanel } from '../src/mount.js';
import type { MountedPanel, MountWaits } from '../src/mount.js';
import { patchablesOf, restorePatchables, snapshotPatchables } from './patchGuard.js';
import type { PatchSnapshot } from './patchGuard.js';

// The library applies its default theme at the first `Body` touch; see
// mount.test.ts for why that must happen before any tree is built.
Body.getInstance();

/** The scale every panel is mounted at unless a case names another: mount.test.ts's smoke scale. */
const SMOKE_SCALE = 3;

/** The library objects the page passes the harness, `Tooltip` and `AbstractWindow` included. */
const LIB: HarnessLibrary = { Body, DOM, Tooltip, AbstractWindow };

/** Every work key an ablation bumped, by the ablation that bumped it; A28 reads them. */
const bumped = new Map<string, Set<string>>();

/** The ablation the running case applied, under which `tools.bumpWork` files its keys. */
let applied = '';

/** What each case's mount patched objects looked like before it; restored after the case. */
const snapshots: PatchSnapshot[] = [];

/**
 * Records `kind` under the ablation the running case applied, for A28.
 *
 * @param kind - The work counter's key.
 */
function recordBump(kind: string): void {
    if (applied === '') {
        return;
    }

    const keys = bumped.get(applied) ?? new Set<string>();

    keys.add(kind);
    bumped.set(applied, keys);
}

/**
 * The harness tools, with `isPainted` standing in for layout as in
 * mount.test.ts, and `bumpWork` also recording every key for A28.
 */
const tools: HarnessTools = {
    ...createTools(LIB),
    isPainted: (el: Element): boolean => el.isConnected,
    bumpWork: (kind: string): void => {
        recordBump(kind);
        bumpWork(kind);
    },
};

/** The paint wait: lays the page out once, so `afterMount` finds the elements layout creates. */
async function flushOnPaint(): Promise<void> {
    Body.getInstance().flushLayout();
}

/** The settle wait: nothing to wait for without a frame loop. */
async function settleAtOnce(): Promise<void> {}

const SMOKE_WAITS: MountWaits = { painted: flushOnPaint, settled: settleAtOnce };

afterEach(() => {
    // Unmount first, as mount.test.ts does, then undo the patches: a
    // teardown may still run a patched method.
    for (const root of [...Body.getInstance().getComponents()]) {
        Body.getInstance().removeComponent(root);
        root.dispose();
    }

    for (const openWindow of AbstractWindow.getOpenWindows()) {
        openWindow.dispose();
    }

    while (snapshots.length > 0) {
        restorePatchables(snapshots.pop()!);
    }

    vi.restoreAllMocks();
    applied = '';
});

/**
 * Mounts panel `id` at scale `n` and snapshots everything an ablation may patch on it.
 *
 * @param id - The panel id.
 * @param n - The scale.
 * @returns The mounted panel.
 */
async function mount(id: string, n: number = SMOKE_SCALE): Promise<MountedPanel> {
    const mounted = await mountPanel(id, new URLSearchParams({ n: String(n) }), tools, SMOKE_WAITS);

    guard();

    return mounted;
}

/**
 * Snapshots everything an ablation may patch on the mounted page, plus the
 * prototype chains of `extras`, for the `afterEach` restore.
 *
 * @param extras - Further objects whose prototypes an ablation patches.
 */
function guard(extras: object[] = []): void {
    snapshots.push(snapshotPatchables(patchablesOf(tools, LIB, extras)));
}

/**
 * Applies ablation `name` with `lib`, filing its bumps under its name.
 *
 * @param name - The ablation's `abl=` name.
 * @param lib - The library objects it receives.
 * @returns Its note.
 */
function apply(name: string, lib: HarnessLibrary = LIB): string {
    applied = name;

    return ABLATIONS[name](tools, lib);
}

/**
 * Runs `work` inside one counting window of one unit.
 *
 * @param work - The work to count.
 * @returns The window's counters.
 */
function countAll(work: () => void): PhaseCounts {
    let counts: PhaseCounts = {};

    startCounting();

    // Closed even when `work` throws, so no later case counts into it.
    try {
        work();
    } finally {
        counts = stopCounting(1);
    }

    return counts;
}

/**
 * The work counters of one counting window of one unit around `work`.
 *
 * @param work - The work to count.
 * @returns The work counters; empty when nothing tallied.
 */
function counted(work: () => void): Record<string, number> {
    return countAll(work).work ?? {};
}

/**
 * Calls `obj[method](...args)`, for reaching the library's protected and private members.
 *
 * @param obj - The receiver.
 * @param method - The method's name.
 * @param args - Its arguments.
 * @returns What it returns.
 */
function invoke<T = unknown>(obj: unknown, method: string, ...args: unknown[]): T {
    return ((obj as AnyObj)[method] as (...a: unknown[]) => T).apply(obj, args);
}

/**
 * The component whose layout manager is `lm`.
 *
 * @param lm - A live layout manager.
 * @returns The component it lays out.
 */
function containerOf(lm: AnyObj): AnyObj {
    return tools.walkComponents().find((c) => invoke(c, 'getLayoutManager') === lm)!;
}

/** The 26 ablations the W3.0 sweep adds or rewrites. */
const W3_ABLATIONS = [
    'split.noop-drag', 'split.recalc-gate', 'g12.collapse-static', 'g05.lazy-reads', 'g08.env-reads', 'g09.all', 'g09.chrome',
    'g11.gather-residue', 'g14.closed-section', 'g16.panel-settled', 'g16.scroll-reads', 'g18.measure-memo', 'g18.canvas-width',
    'g19.tooltip-idle', 'g20.walk-dose', 'g21.render-pass', 'g22.settle-relay', 'g23.write-economy', 'g24.list-rows', 'g24.tree-window',
    'g25.theme-withhold', 'g26.viewer-resize', 'g27.heading-cache', 'g28.transform-inline', 'chart.repaint-gate', 'chart.margin-memo',
];

/** The ablations that were there before W3.0 and stay unchanged. */
const EARLIER_ABLATIONS = [
    'sync.scroll', 'cm.measure', 'cm.observers', 'editor.doLayout', 'norules', 'nosameattr', 'nosamewrites', 'noaria', 'novisible',
    'tab.doLayout', 'tree.renderWindow', 'tree.doLayout', 'scroller.layoutScrollbars', 'accordion.doLayout', 'card.doLayout',
];

describe('A1 registry', () => {
    it('holds the W3.0 ablations and every earlier one', () => {
        expect(W3_ABLATIONS).toHaveLength(26);
        expect(Object.keys(ABLATIONS).sort()).toEqual([...W3_ABLATIONS, ...EARLIER_ABLATIONS].sort());
    });
});

/** The ablations whose component or layout-manager target `canvas-idle` does not mount. */
const ABSENT_ON_CANVAS_IDLE = [
    'split.noop-drag', 'split.recalc-gate', 'g12.collapse-static', 'g14.closed-section', 'g21.render-pass', 'g22.settle-relay',
    'g23.write-economy', 'g24.list-rows', 'g24.tree-window', 'g25.theme-withhold', 'g26.viewer-resize', 'g27.heading-cache',
    'chart.repaint-gate', 'chart.margin-memo',
];

describe('A2 absent targets', () => {
    it.each(ABSENT_ON_CANVAS_IDLE)('%s notes its missing target', async (name) => {
        await mount('canvas-idle');

        expect(apply(name)).toMatch(/^no /);
    });

    it('g19.tooltip-idle notes a lib without Tooltip', async () => {
        await mount('canvas-idle');

        expect(apply('g19.tooltip-idle', { Body, DOM })).toBe('no Tooltip');
    });

    it('g18.canvas-width notes that jsdom has no 2D context', async () => {
        await mount('canvas-idle');

        expect(apply('g18.canvas-width')).toBe('no canvas 2D context');
    });
});

/** A split's drag fixture: the manager, its first gutter, the container it lays out and the two panes beside the gutter. */
interface SplitFixture {
    split: AnyObj;
    gutter: unknown;
    container: AnyObj;
    lhs: AnyObj;
    rhs: AnyObj;
}

/**
 * Mounts `shell-shallow` at n=1 and prepares its explorer split's first
 * gutter for a drag from pointer 0, as `onDragStart` would.
 *
 * @returns The fixture.
 */
async function splitFixture(): Promise<SplitFixture> {
    await mount('shell-shallow', 1);

    const split = tools.findLayoutManager('Split')!;
    const gutter = (split._gutters as unknown[])[0];
    const container = containerOf(split);
    const [lhs, rhs] = invoke<AnyObj[]>(container, 'getLaidOutComponents');

    split._dragOriginPointer = 0;
    split._dragOriginLhsSize = invoke(lhs, 'getWidth');
    split._dragOriginRhsSize = invoke(rhs, 'getWidth');

    return { split, gutter, container, lhs, rhs };
}

describe('A3 split.noop-drag', () => {
    it('skips both panes\' layout on a drag that moves nothing, and none on one that does', async () => {
        const { split, gutter, container, lhs, rhs } = await splitFixture();
        const width = invoke<number>(lhs, 'getWidth');

        expect(apply('split.noop-drag')).not.toMatch(/^no /);
        expect(counted(() => invoke(split, 'onDrag', container, gutter, 0))['skipped.split.noop-drag.paneLayout']).toBe(2);
        expect(counted(() => invoke(split, 'onDrag', container, gutter, 20))['skipped.split.noop-drag.paneLayout']).toBeUndefined();
        expect(invoke(lhs, 'getWidth')).toBe(width + 20);
        expect(Object.hasOwn(lhs, 'doLayout')).toBe(false);
        expect(Object.hasOwn(rhs, 'doLayout')).toBe(false);
    });
});

describe('A4 split.recalc-gate', () => {
    it('skips a recalculation that would write what it wrote, and not once the space changes', async () => {
        const { split, container } = await splitFixture();

        apply('split.recalc-gate');

        const repeated = counted(() => {
            for (let i = 0; i < 3; i++) {
                invoke(split, 'recalculateSizes');
            }
        });

        expect(repeated['skipped.split.recalc-gate.recalc']).toBeGreaterThanOrEqual(1);

        invoke(container, 'setWidth', invoke<number>(container, 'getWidth') - 10);

        expect(counted(() => invoke(split, 'recalculateSizes'))['skipped.split.recalc-gate.recalc']).toBeUndefined();
    });
});

describe('A5 g12.collapse-static', () => {
    it('installs, and a collapse still collapses', async () => {
        const { split } = await splitFixture();

        expect(apply('g12.collapse-static')).not.toMatch(/^no /);
        expect(invoke(split, 'setPaneCollapsed', 0, true)).toBe(split);
        expect(invoke(split, 'isPaneCollapsed', 0)).toBe(true);
    });

    // The animation's frames never run inside a synchronous case, so the
    // collapse is still in flight here, and the gate can be called directly.
    it('skips a pane layout at an unmoved rectangle while collapsing, then removes itself', async () => {
        const { split, lhs } = await splitFixture();

        apply('g12.collapse-static');
        invoke(split, 'setPaneCollapsed', 0, true);

        expect(split._collapsing).toBe(true);
        expect(counted(() => {
            invoke(lhs, 'doLayout');
            invoke(lhs, 'doLayout');
        })['skipped.g12.collapse-static.staticRelayout']).toBeGreaterThanOrEqual(1);

        // The collapse ends: the next layout runs, and the guard is gone.
        split._collapsing = false;

        expect(counted(() => invoke(lhs, 'doLayout'))['skipped.g12.collapse-static.staticRelayout']).toBeUndefined();
        expect(Object.hasOwn(lhs, 'doLayout')).toBe(false);
    });

    it('leaves no guard on the panes when no collapse starts', async () => {
        const { split, lhs, rhs } = await splitFixture();

        apply('g12.collapse-static');
        // Already expanded: the call changes nothing and animates nothing.
        invoke(split, 'setPaneCollapsed', 0, false);

        expect(Object.hasOwn(lhs, 'doLayout')).toBe(false);
        expect(Object.hasOwn(rhs, 'doLayout')).toBe(false);
    });
});

describe('A6 g05.lazy-reads', () => {
    it('serves a both-fill placement without the size reads, and delegates any other', async () => {
        const mounted = await mount('chart-line');
        const chart = mounted.build.root;
        const lm = tools.findLayoutManager('Fit')!;

        vi.spyOn(lm as unknown as { getLayoutConstraints(): unknown }, 'getLayoutConstraints').mockReturnValue(null);

        const preferred = vi.spyOn(chart, 'getPreferredSize');

        apply('g05.lazy-reads');

        let rect: unknown;
        const both = counted(() => {
            rect = invoke(lm, 'resolveBounds', chart, 0, 0, 100, 50, 'both');
        });

        expect(rect).toEqual({ x: 0, y: 0, width: 100, height: 50 });
        expect(both['skipped.g05.lazy-reads.resolve']).toBe(1);
        expect(preferred).not.toHaveBeenCalled();

        const none = counted(() => invoke(lm, 'resolveBounds', chart, 0, 0, 100, 50, 'none'));

        expect(preferred).toHaveBeenCalled();
        expect(none['skipped.g05.lazy-reads.resolve']).toBeUndefined();
    });
});

describe('A7 g08.env-reads', () => {
    it('memoises the viewport per task, theme variables until the root style changes, and the minimized stack per task', async () => {
        await mount('windows');

        apply('g08.env-reads');

        const source = DOM.source as unknown as AnyObj;
        const sink = DOM.sink as unknown as AnyObj;

        startCounting();
        invoke(source, 'getViewportSize');
        invoke(source, 'getViewportSize');
        await Promise.resolve();
        invoke(source, 'getViewportSize');

        const viewport = stopCounting(1).work ?? {};

        expect(viewport['memo.g08.env-reads.viewportMiss']).toBe(2);
        expect(viewport['memo.g08.env-reads.viewportHit']).toBe(1);

        const themeVars = counted(() => {
            invoke(source, 'getThemeVar', '--ts-ui-font-size');
            invoke(source, 'getThemeVar', '--ts-ui-font-size');
        });

        expect(themeVars['memo.g08.env-reads.themeVarMiss']).toBe(1);
        expect(themeVars['memo.g08.env-reads.themeVarHit']).toBe(1);

        const afterApply = counted(() => {
            invoke(sink, 'apply', invoke(source, 'getDocumentElement'), {});
            invoke(source, 'getThemeVar', '--ts-ui-font-size');
        });

        expect(afterApply['memo.g08.env-reads.themeVarMiss']).toBe(1);
        expect(afterApply['memo.g08.env-reads.themeVarHit']).toBeUndefined();

        const stack = counted(() => {
            invoke(AbstractWindow, 'relayoutMinimizedStack');
            invoke(AbstractWindow, 'relayoutMinimizedStack');
        });

        expect(stack['skipped.g08.env-reads.minStack']).toBe(1);
    });
});

describe('A8 g09.chrome and g09.all', () => {
    it('g09.chrome opts a Header in and leaves a plain Panel out', async () => {
        const mounted = await mount('shell-shallow');

        apply('g09.chrome');

        expect(invoke(tools.findComponent('Header'), 'canSkipUnchangedLayout')).toBe(true);
        expect(invoke(mounted.build.root, 'canSkipUnchangedLayout')).toBe(false);
    });

    it('g09.all opts every component in, and an unchanged pass skips', async () => {
        const mounted = await mount('shell-shallow');
        const root = mounted.build.root;

        apply('g09.all');

        expect(invoke(tools.findComponent('Header'), 'canSkipUnchangedLayout')).toBe(true);
        expect(invoke(root, 'canSkipUnchangedLayout')).toBe(true);

        root.doLayout();

        expect(counted(() => root.doLayout())['skipped.g09.all.commit']).toBeGreaterThanOrEqual(1);
    });

    it('counts only the skips its own gate grants, not a shipped opt-in\'s', async () => {
        const mounted = await mount('shell-shallow');
        const root = mounted.build.root;
        const menuBar = tools.findComponent('MenuBar')!;
        const status = mounted.build.geometry!.status;
        const answers: boolean[] = [];

        apply('g09.chrome');
        root.doLayout();

        // Asked inside a pass, as a commit asks, with nothing else laid out:
        // the menu bar opted in on its own, the status bar through the ablation.
        vi.spyOn(root.getLayoutManager() as unknown as { doLayout(): void }, 'doLayout').mockImplementation(() => {
            answers.push(invoke(menuBar, 'canSkipUnchangedCommit'), invoke(status, 'canSkipUnchangedCommit'));
        });

        const skips = counted(() => root.doLayout());

        expect(answers).toEqual([true, true]);
        expect(skips['skipped.g09.chrome.commit']).toBe(1);
    });
});

describe('A9 g11.gather-residue', () => {
    it('skips a track-less grid\'s content measure and shares a fully displayed child list', async () => {
        const mounted = await mount('chart-dashboard');
        const grid = mounted.targets.passes as AnyObj;

        apply('g11.gather-residue');

        expect(counted(() => invoke(grid, 'doLayout'))['skipped.g11.gather-residue.measureContent']).toBeGreaterThanOrEqual(1);
        expect(invoke(grid, 'getLaidOutComponents')).toBe(grid._components);

        const [hidden] = grid._components as Component[];

        hidden.setDisplayed(false);

        const laidOut = invoke<Component[]>(grid, 'getLaidOutComponents');

        expect(laidOut).not.toBe(grid._components);
        expect(laidOut).not.toContain(hidden);
        expect(laidOut).toHaveLength((grid._components as Component[]).length - 1);
    });

    it('reserves no content frame for a box layout that does not overflow', async () => {
        const mounted = await mount('chart-dashboard');
        // The bar charts' panel: a VBox, one of the managers that reserve a frame.
        const bars = mounted.build.geometry!.bars as unknown as Component;

        apply('g11.gather-residue');

        expect(counted(() => bars.doLayout())['skipped.g11.gather-residue.reserve']).toBeGreaterThanOrEqual(1);
    });
});

describe('A10 g14.closed-section', () => {
    it('re-serves a settled closed section\'s height and skips its reflow', async () => {
        const mounted = await mount('shell-shallow');
        const sidebar = mounted.build.geometry!.sidebar as unknown as Component;
        const history = mounted.build.geometry!.history as unknown as Component;
        const preferred = vi.spyOn(history, 'getPreferredSize');

        apply('g14.closed-section');
        counted(() => sidebar.doLayout());
        preferred.mockClear();

        const second = counted(() => sidebar.doLayout());

        expect(second['skipped.g14.closed-section.closedReflow']).toBeGreaterThanOrEqual(1);
        expect(second['skipped.g14.closed-section.closedPreferred']).toBeGreaterThanOrEqual(1);
        expect(preferred).not.toHaveBeenCalled();
        expect(Object.hasOwn(history, 'doLayout')).toBe(false);
    });
});

/**
 * Frames that let a scrolling panel's resize-settle relay run out: the
 * mount's first layout arms it, it takes two layout flushes to clear, and
 * until it has, the panel withholds the re-measure `g16.panel-settled` gates.
 * One frame more than the two, as margin.
 */
const PANEL_SETTLE_FRAMES = 3;

describe('A11 g16.panel-settled', () => {
    it('skips a settled panel\'s remeasure, and not once its size changes', async () => {
        await mount('markdown-doc');

        const pane = tools.findComponent('MarkdownContentPane') as unknown as Component;

        await tools.waitFrames(PANEL_SETTLE_FRAMES);
        apply('g16.panel-settled');
        pane.doLayout();

        expect(counted(() => pane.doLayout())['skipped.g16.panel-settled.remeasure']).toBeGreaterThanOrEqual(1);

        pane.setWidth(pane.getWidth() - 10);

        expect(counted(() => pane.doLayout())['skipped.g16.panel-settled.remeasure']).toBeUndefined();
    });

    it('passes a non-scrolling panel through uncounted: its re-measure already does nothing', async () => {
        const mounted = await mount('markdown-doc');
        const root = mounted.build.root as unknown as AnyObj;

        await tools.waitFrames(PANEL_SETTLE_FRAMES);
        apply('g16.panel-settled');

        expect(root._autoScroll).toBe('none');
        expect(counted(() => {
            invoke(root, 'remeasureScrollMetrics');
            invoke(root, 'remeasureScrollMetrics');
        })['skipped.g16.panel-settled.remeasure']).toBeUndefined();
    });
});

describe('A12 g16.scroll-reads', () => {
    it('memoises the max scroll per task and skips an unchanged shadow resize', async () => {
        await mount('markdown-doc');

        const pane = tools.findComponent('MarkdownContentPane') as unknown as Component;

        apply('g16.scroll-reads');

        expect(counted(() => {
            pane.getMaxScrollTop();
            pane.getMaxScrollTop();
        })['memo.g16.scroll-reads.maxScrollHit']).toBe(1);

        await Promise.resolve();

        expect(counted(() => pane.getMaxScrollTop())['memo.g16.scroll-reads.maxScrollHit']).toBeUndefined();

        expect(counted(() => {
            invoke(pane, 'resizeScrollShadowOverlay');
            invoke(pane, 'resizeScrollShadowOverlay');
        })['skipped.g16.scroll-reads.shadowResize']).toBe(1);
    });

    it('serves scroll-path metrics once per task, and passes other reads through', async () => {
        await mount('markdown-doc');

        const pane = tools.findComponent('MarkdownContentPane')!;
        const handle = pane._overlayScrollElement;

        apply('g16.scroll-reads');

        // `markdown-doc`'s pane uses overlay scrollbars, which re-read the inner scroller's metrics per sync.
        expect(handle).toBeTruthy();
        expect(counted(() => {
            invoke(pane, 'syncOverlayScrollbars');
            invoke(pane, 'syncOverlayScrollbars');
        })['memo.g16.scroll-reads.metricsHit']).toBe(1);
        expect(counted(() => {
            invoke(DOM.source, 'getScrollMetrics', handle);
            invoke(DOM.source, 'getScrollMetrics', handle);
        })['memo.g16.scroll-reads.metricsHit']).toBeUndefined();
    });

    it('passes a component without a scroll element through uncounted: its max scroll reads nothing', async () => {
        await mount('markdown-doc');
        apply('g16.scroll-reads');

        const unrendered = Panel();

        try {
            expect(counted(() => {
                unrendered.getMaxScrollTop();
                unrendered.getMaxScrollTop();
            })['memo.g16.scroll-reads.maxScrollHit']).toBeUndefined();
        } finally {
            unrendered.dispose();
        }
    });
});

describe('A13 g18.measure-memo', () => {
    it('re-serves a repeated measurement until the root style changes', async () => {
        await mount('chart-line');

        const source = DOM.source as unknown as AnyObj;

        apply('g18.measure-memo');

        let first: unknown;
        const repeated = counted(() => {
            first = invoke(source, 'measureText', 'abc');
            invoke(source, 'measureText', 'abc');
        });

        expect(repeated['memo.g18.measure-memo.callMiss']).toBe(1);
        expect(repeated['memo.g18.measure-memo.callHit']).toBe(1);
        expect(counted(() => invoke(source, 'measureText', 'abc', { maxWidth: 50 }))['memo.g18.measure-memo.callMiss']).toBe(1);

        let batch: unknown[] = [];
        const batched = counted(() => {
            batch = invoke(source, 'measureTexts', [{ text: 'abc' }, { text: 'xyz' }]);
        });

        expect(batched['memo.g18.measure-memo.callMiss']).toBe(1);
        expect(batch).toHaveLength(2);
        expect(batch[0]).toEqual(first);

        const afterApply = counted(() => {
            invoke(DOM.sink, 'apply', invoke(source, 'getDocumentElement'), {});
            invoke(source, 'measureText', 'abc');
        });

        expect(afterApply['memo.g18.measure-memo.callMiss']).toBe(1);
        expect(afterApply['memo.g18.measure-memo.callHit']).toBeUndefined();
    });

    it('re-serves repeated widths, keyed on the options', async () => {
        await mount('chart-line');

        const source = DOM.source as unknown as AnyObj;

        apply('g18.measure-memo');

        let first: unknown;
        let second: unknown;
        const repeated = counted(() => {
            first = invoke(source, 'measureTextWidths', ['abc', 'xyz']);
            second = invoke(source, 'measureTextWidths', ['abc', 'xyz']);
        });

        expect(repeated['memo.g18.measure-memo.callMiss']).toBe(1);
        expect(repeated['memo.g18.measure-memo.callHit']).toBe(1);
        expect(second).toEqual(first);
        expect(counted(() => invoke(source, 'measureTextWidths', ['abc'], { fontWeight: 'bold' }))['memo.g18.measure-memo.callMiss']).toBe(1);
    });
});

describe('A15 g19.tooltip-idle', () => {
    it('skips an unchanged re-attach, and leaves an idle hide alone', async () => {
        const mounted = await mount('chart-line');
        const chart = mounted.build.root;
        const hide = Tooltip.hide;

        apply('g19.tooltip-idle');

        // With nothing showing the tooltip has no element, and `hide` already
        // returns before any fade: there is nothing for the arm to remove.
        expect(Tooltip.hide).toBe(hide);
        expect(Object.keys(counted(() => Tooltip.hide())).filter((key) => key.includes('g19.tooltip-idle'))).toEqual([]);

        expect(counted(() => {
            Tooltip.attach(chart, 'a');
            Tooltip.attach(chart, 'a');
        })['skipped.g19.tooltip-idle.attach']).toBe(1);

        expect(counted(() => {
            Tooltip.detach(chart);
            Tooltip.attach(chart, 'a');
        })['skipped.g19.tooltip-idle.attach']).toBeUndefined();

        expect(counted(() => {
            Tooltip.attach(chart, 'a', { background: 'red' });
            Tooltip.attach(chart, 'a', { background: 'red' });
        })['skipped.g19.tooltip-idle.attach']).toBe(1);
    });
});

describe('A16 g20.walk-dose', () => {
    it('adds one call per parent and id read, with the same result', async () => {
        const mounted = await mount('chart-line');
        const source = DOM.source as unknown as AnyObj;
        const handle = mounted.build.root.getElement();
        const parent = invoke(source, 'getParentElement', handle);
        const id = invoke(source, 'getId', handle);

        apply('g20.walk-dose');

        let readParent: unknown;
        let readId: unknown;
        const dose = counted(() => {
            readParent = invoke(source, 'getParentElement', handle);
            readId = invoke(source, 'getId', handle);
        });

        expect(readParent).toBe(parent);
        expect(readId).toBe(id);
        expect(dose['dose.g20.walk-dose.extraCall']).toBe(2);
    });
});

describe('A17 g21.render-pass', () => {
    it('memoises the visible records, skips the focus sweep and the required-state pass', async () => {
        await mount('treetable-rows');

        const body = tools.findComponent('TableBody')!;

        apply('g21.render-pass');

        let first: unknown;
        let second: unknown;
        const visible = counted(() => {
            first = invoke(body, 'getVisibleRecords');
            second = invoke(body, 'getVisibleRecords');
        });

        expect(second).toBe(first);
        expect(visible['memo.g21.render-pass.visibleHit']).toBeGreaterThanOrEqual(1);

        const [firstRow] = body._rowPool as AnyObj[];
        const [firstCell] = invoke<AnyObj[]>(firstRow, 'getComponents');
        const setStyleState = vi.spyOn(firstCell as unknown as { setStyleState(state: string, on: boolean): unknown }, 'setStyleState');

        body._previousFocusedCell = null;

        expect(counted(() => invoke(body, '_updateFocusStyle'))['skipped.g21.render-pass.focusSweep']).toBe(1);
        expect(setStyleState).not.toHaveBeenCalledWith('.focused', false);

        const required = counted(() => invoke(body, 'applyRequiredEmptyState', firstRow, invoke<unknown[]>(body, 'getVisibleRecords')[0]));

        expect(required['skipped.g21.render-pass.requiredEmpty']).toBe(1);
    });
});

describe('A20 g24.list-rows', () => {
    it('skips an unchanged selection write and applies a changed one', async () => {
        await mount('list-items');

        const row = tools.findComponent('SelectableListRow')!;
        const selected = invoke<boolean>(row, 'isSelected');

        apply('g24.list-rows');

        expect(counted(() => invoke(row, 'setSelected', selected))['skipped.g24.list-rows.rowClass']).toBe(1);
        expect(counted(() => invoke(row, 'setSelected', !selected))['skipped.g24.list-rows.rowClass']).toBeUndefined();
        expect(invoke(row, 'isSelected')).toBe(!selected);
    });

    it('skips an unchanged focus write and applies a changed one', async () => {
        await mount('list-items');

        const row = tools.findComponent('SelectableListRow')!;
        const focused = invoke<boolean>(row, 'isFocused');

        apply('g24.list-rows');

        expect(counted(() => invoke(row, 'setFocused', focused))['skipped.g24.list-rows.rowClass']).toBe(1);
        expect(counted(() => invoke(row, 'setFocused', !focused))['skipped.g24.list-rows.rowClass']).toBeUndefined();
        expect(invoke(row, 'isFocused')).toBe(!focused);
    });
});

describe('A21 g24.tree-window', () => {
    it('skips the tree\'s re-render', async () => {
        await mount('tree-nodes');

        const tree = tools.findComponent('Tree')!;

        apply('g24.tree-window');

        expect(counted(() => invoke(tree, 'renderWindow'))['skipped.g24.tree-window.renderWindow']).toBe(1);
    });
});

/**
 * Shows tab `index` of the first dock region and settles the page, so the
 * shown page lays out — mounting its editor's view on the first time — and
 * effective visibility is up to date.
 *
 * @param index - The tab's index.
 */
function showTab(index: number): void {
    invoke(tools.findLayoutManager('Tab'), 'setActiveTabIndex', index);
    Body.getInstance().flushLayout();
    Component.flushEffectiveVisibility();
}

describe('A22 g25.theme-withhold', () => {
    it('withholds a hidden editor\'s reconfigure until it is shown', async () => {
        await mount('shell-shallow', 2);

        const editors = tools.walkComponents().filter((c) => tools.isA(c, 'CodeEditor'));

        apply('g25.theme-withhold');

        // A tab never shown: its editor has no view to reconfigure, so there is nothing to withhold.
        const unmounted = editors.find((e) => !invoke(e, 'isEffectivelyVisible'))!;

        expect(unmounted._view).toBeNull();
        expect(counted(() => invoke(unmounted, 'onThemeChange'))['skipped.g25.theme-withhold.theme']).toBeUndefined();

        // Shown once and hidden again, as an inactive tab in use is.
        showTab(1);
        showTab(0);

        const visible = editors.find((e) => invoke(e, 'isEffectivelyVisible'))!;
        const hidden = editors.find((e) => !invoke(e, 'isEffectivelyVisible'))!;

        expect(visible).toBeDefined();
        expect(hidden._view).not.toBeNull();

        const visibleReconfigure = vi.spyOn(visible._themeCompartment as { reconfigure(ext: unknown): unknown }, 'reconfigure');
        const hiddenReconfigure = vi.spyOn(hidden._themeCompartment as { reconfigure(ext: unknown): unknown }, 'reconfigure');

        expect(counted(() => invoke(hidden, 'onThemeChange'))['skipped.g25.theme-withhold.theme']).toBe(1);
        expect(hiddenReconfigure).not.toHaveBeenCalled();

        invoke(visible, 'onThemeChange');

        expect(visibleReconfigure).toHaveBeenCalledTimes(1);

        invoke(hidden, 'onEffectiveVisibilityChange', true);

        expect(hiddenReconfigure).toHaveBeenCalledTimes(1);

        invoke(hidden, 'onEffectiveVisibilityChange', true);

        expect(hiddenReconfigure).toHaveBeenCalledTimes(1);
    });
});

/** The viewer-resize fixture's settle: g26's 100 ms height re-measure. */
const MEASURE_SETTLE_MS = 100;

describe('A23 g26.viewer-resize', () => {
    it('re-serves the hug rectangle and defers the width-driven height measure', async () => {
        await mount('markdown-doc');

        const minimap = tools.findComponent('MarkdownMinimap')!;
        const markdown = tools.findComponent('Markdown') as unknown as Component;
        // Spied before the ablation installs, so the ablation delegates to it.
        const measure = vi.spyOn(Object.getPrototypeOf(markdown) as { measureContentHeight(): void }, 'measureContentHeight');

        apply('g26.viewer-resize');

        expect(counted(() => {
            invoke(minimap, 'placeNextTo', markdown);
            invoke(minimap, 'placeNextTo', markdown);
        })['memo.g26.viewer-resize.rectHit']).toBe(1);

        vi.useFakeTimers();

        try {
            measure.mockClear();

            expect(counted(() => markdown.setWidth(markdown.getWidth() + 20))['skipped.g26.viewer-resize.measure']).toBe(1);
            expect(measure).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(1);

            vi.advanceTimersByTime(MEASURE_SETTLE_MS - 1);

            expect(measure).not.toHaveBeenCalled();

            vi.advanceTimersByTime(1);

            expect(measure).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('measures the hug rectangle again after a theme change', async () => {
        await mount('markdown-doc');

        const minimap = tools.findComponent('MarkdownMinimap')!;
        const markdown = tools.findComponent('Markdown')!;

        apply('g26.viewer-resize');
        invoke(minimap, 'placeNextTo', markdown);
        invoke(markdown, 'onThemeChanged');

        expect(counted(() => invoke(minimap, 'placeNextTo', markdown))['memo.g26.viewer-resize.rectHit']).toBeUndefined();
    });

    it('passes a hidden viewer\'s width-driven measure through uncounted: it measures nothing', async () => {
        const mounted = await mount('markdown-doc');
        const viewer = mounted.build.geometry!.viewer as unknown as Component;
        const markdown = tools.findComponent('Markdown') as unknown as Component;
        const measure = vi.spyOn(Object.getPrototypeOf(markdown) as { measureContentHeight(): void }, 'measureContentHeight');

        apply('g26.viewer-resize');
        viewer.setDisplayed(false);
        Component.flushEffectiveVisibility();

        expect(markdown.isEffectivelyVisible()).toBe(false);
        expect(counted(() => markdown.setWidth(markdown.getWidth() + 20))['skipped.g26.viewer-resize.measure']).toBeUndefined();
        expect(measure).toHaveBeenCalledTimes(1);
    });
});

describe('A24 g27.heading-cache', () => {
    it('rebuilds the heading offsets once and picks the heading findActiveHeading picks', async () => {
        await mount('markdown-doc');

        const viewer = tools.findComponent('MarkdownViewer')!;
        const tracker = viewer._tracker as AnyObj;
        const scrollElement = invoke(viewer._content, 'getContentScrollElement');

        guard([tracker]);

        const setActiveHeading = vi.spyOn(tracker as { setActiveHeading(id: string | null): void }, 'setActiveHeading');

        apply('g27.heading-cache');

        const ticks = counted(() => {
            invoke(tracker, 'trackScroll', scrollElement);
            invoke(tracker, 'trackScroll', scrollElement);
        });

        expect(ticks['memo.g27.heading-cache.rebuildMiss']).toBe(1);
        expect(ticks['memo.g27.heading-cache.trackHit']).toBe(1);

        const expected = findActiveHeading(scrollElement as Parameters<typeof findActiveHeading>[0], invoke<MarkdownHeading[]>(tracker, 'getHeadings'));

        expect(setActiveHeading).toHaveBeenCalledTimes(2);

        for (const [id] of setActiveHeading.mock.calls) {
            expect(id).toBe(expected);
        }
    });
});

/**
 * Puts the transform setters back on `Component.prototype` as the library had
 * them before motion-transform-inline: `setTransform` and `clearTransform`
 * write the component's stylesheet rule, `setTranslate` writes its translate
 * inline on its own, and nothing composes the two (no `writeTransform` or
 * `composeTransform`). The `afterEach` restore puts the library's own back.
 *
 * @param component - Any mounted component.
 */
function installRuleSideTransform(component: object): void {
    const proto = tools.rootOwnerProto(component, 'setTransform')!;

    Reflect.deleteProperty(proto, 'writeTransform');
    Reflect.deleteProperty(proto, 'composeTransform');

    proto.setTransform = function (this: AnyObj, value: string): unknown {
        if (this._transform === value) {
            return this;
        }

        this._transform = value;
        invoke(this, 'setElementCSSRule', 'transform', value);

        return this;
    };

    proto.clearTransform = function (this: AnyObj): unknown {
        this._transform = null;
        invoke(this, 'setElementCSSRule', 'transform', null);

        return this;
    };

    proto.setTranslate = function (this: AnyObj, x: number, y: number): unknown {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return this;
        }

        if (this._translateX === x && this._translateY === y && invoke(this, 'getElement')) {
            return this;
        }

        this._translateX = x;
        this._translateY = y;
        invoke(this, 'setElementStyle', 'transform', x === 0 && y === 0 ? null : `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`);

        return this;
    };
}

// From motion-transform-inline on, the library's own `setTransform` writes
// inline, composed after a `setTranslate` offset, so the ablation turns
// inert: its raw inline write would drop that offset. The first two cases
// run it against the rule-writing setters the library had before.
describe('A25 g28.transform-inline', () => {
    it('writes a transform inline instead of into the rule', async () => {
        const mounted = await mount('chart-line');
        const chart = mounted.build.root;

        installRuleSideTransform(chart);

        expect(apply('g28.transform-inline')).not.toMatch(/^no /);

        expect(counted(() => chart.setTransform('translateX(3px)'))['skipped.g28.transform-inline.ruleWrite']).toBe(1);
        expect(chart.getTransform()).toBe('translateX(3px)');

        Body.getInstance().flushLayout();

        expect(tools.elementOf(chart)!.style.transform).toBe('translateX(3px)');

        chart.clearTransform();

        expect(tools.elementOf(chart)!.style.transform).toBe('');
    });

    it('moves a transform already set inline at install, uncounted', async () => {
        const mounted = await mount('chart-line');
        const chart = mounted.build.root;

        installRuleSideTransform(chart);
        chart.setTransform('translateY(2px)');

        expect(counted(() => apply('g28.transform-inline'))['skipped.g28.transform-inline.ruleWrite']).toBeUndefined();

        Body.getInstance().flushLayout();

        expect(tools.elementOf(chart)!.style.transform).toBe('translateY(2px)');
        expect(chart.getTransform()).toBe('translateY(2px)');
    });

    it('notes a library that already writes transforms inline and patches nothing; the library writes inline itself', async () => {
        const mounted = await mount('chart-line');
        const chart = mounted.build.root;
        const proto = tools.rootOwnerProto(chart, 'setTransform')!;
        const setTransform = proto.setTransform as unknown;
        const clearTransform = proto.clearTransform as unknown;

        expect(apply('g28.transform-inline')).toMatch(/^no rule-side transform/);
        expect(proto.setTransform).toBe(setTransform);
        expect(proto.clearTransform).toBe(clearTransform);

        const counts = counted(() => chart.setTransform('translateX(3px)'));

        expect(counts['skipped.g28.transform-inline.ruleWrite']).toBeUndefined();

        Body.getInstance().flushLayout();

        expect(tools.elementOf(chart)!.style.transform).toBe('translateX(3px)');
    });
});

/** `chart-line`'s scale in the chart cases: F26.1's 50 points per series. */
const CHART_SCALE = 50;

/**
 * Lays `chart` out once under the seam and work counters.
 *
 * @param chart - The chart.
 * @returns The pass's counters.
 */
function seamCountedLayout(chart: Component): PhaseCounts {
    return countAll(() => chart.doLayout());
}

/**
 * Whether a phase's work counters hold any of ablation `name`'s own counters under `prefix`.
 *
 * @param counts - The phase's counters.
 * @param prefix - `skipped` or `memo`.
 * @param name - The ablation's `abl=` name.
 * @returns `true` when one was bumped.
 */
function bumpedAny(counts: PhaseCounts, prefix: string, name: string): boolean {
    return Object.keys(counts.work ?? {}).some((key) => key.startsWith(`${prefix}.${name}.`));
}

/**
 * The prototype in `obj`'s chain that owns `scheduleLayout` nearest to it:
 * `AbstractChart.prototype`, on a library whose chart gates its own repaint.
 *
 * @param obj - A chart.
 * @returns The nearest prototype with an own `scheduleLayout`.
 */
function scheduleLayoutOwner(obj: object): AnyObj {
    let proto = Object.getPrototypeOf(obj) as AnyObj;

    while (!Object.hasOwn(proto, 'scheduleLayout')) {
        proto = Object.getPrototypeOf(proto) as AnyObj;
    }

    return proto;
}

// The library's `AbstractChart` gates its own repaint from chart-repaint-gate
// on, so both W3.0 chart ablations turn inert: installing their revision
// stamp would replace the library's `scheduleLayout` override and break its
// gate. The library's gate is what keeps the marks here.
describe('A26 chart.repaint-gate', () => {
    it('notes the library\'s own gate and patches nothing; the library keeps an unchanged pass\'s marks', async () => {
        const mounted = await mount('chart-line', CHART_SCALE);
        const chart = mounted.build.root;

        expect(apply('chart.repaint-gate')).toMatch(/^no ungated repaint/);

        installSeamCounters(DOM);
        chart.doLayout();

        const unchanged = seamCountedLayout(chart);

        expect(unchanged.seam?.sink.createElementNS ?? 0).toBe(0);

        (mounted.targets.update as CallTarget)(0);

        const changed = seamCountedLayout(chart);

        expect(changed.seam?.sink.createElementNS).toBeGreaterThan(0);
        expect(bumpedAny(unchanged, 'skipped', 'chart.repaint-gate')).toBe(false);
        expect(bumpedAny(changed, 'skipped', 'chart.repaint-gate')).toBe(false);
    });
});

describe('A27 chart.margin-memo', () => {
    it('notes the library\'s own gate and leaves its scheduleLayout override in place', async () => {
        const mounted = await mount('chart-line', CHART_SCALE);
        const chart = mounted.build.root;
        const proto = scheduleLayoutOwner(chart);
        const override = Object.getOwnPropertyDescriptor(proto, 'scheduleLayout')!.value as unknown;

        expect(apply('chart.margin-memo')).toMatch(/^no ungated repaint/);
        expect(Object.getOwnPropertyDescriptor(proto, 'scheduleLayout')!.value).toBe(override);

        installSeamCounters(DOM);
        chart.doLayout();

        const unchanged = seamCountedLayout(chart);

        (mounted.targets.update as CallTarget)(0);

        const changed = seamCountedLayout(chart);

        expect(bumpedAny(unchanged, 'memo', 'chart.margin-memo')).toBe(false);
        expect(bumpedAny(changed, 'memo', 'chart.margin-memo')).toBe(false);
        expect(changed.seam?.sink.createElementNS).toBeGreaterThan(0);
    });
});

describe('A29 work counters', () => {
    it('counts size-hint misses, laid-out lists and content-frame reserves', async () => {
        await mount('shell-shallow');

        const notes = installWorkCounters(tools);

        expect(notes).toContain('counting Component.beginSizeHintRecord');
        expect(notes).toContain('counting Component.getLaidOutComponents');
        expect(notes).toContain('counting LayoutManager.reserveContentFrame');
    });

    it('counts a grid\'s content measure', async () => {
        await mount('chart-dashboard');

        expect(installWorkCounters(tools)).toContain('counting Grid.measureContent');
    });
});

/**
 * Whether `key` is one of ablation `name`'s own counters:
 * `skipped.<name>.<what>`, `memo.<name>.<what>` or `dose.<name>.<what>`,
 * with `<what>` one camelCase word.
 *
 * @param name - The ablation's `abl=` name.
 * @param key - A work key it bumped.
 * @returns `true` when the key follows the scheme.
 */
function isOwnCounter(name: string, key: string): boolean {
    return ['skipped', 'memo', 'dose'].some((prefix) => {
        const head = `${prefix}.${name}.`;

        return key.startsWith(head) && /^[a-z][A-Za-z0-9]*$/.test(key.slice(head.length));
    });
}

// Last in the file: it reads the keys every case above bumped.
describe('A28 counter names', () => {
    it('files every key an ablation bumps under its own name', () => {
        expect(bumped.size).toBeGreaterThan(0);

        for (const [name, keys] of bumped) {
            for (const key of keys) {
                expect(isOwnCounter(name, key), `${name} bumped ${key}`).toBe(true);
            }
        }
    });
});
