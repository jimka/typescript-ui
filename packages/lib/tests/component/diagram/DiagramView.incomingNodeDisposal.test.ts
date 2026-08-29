// Pins the incoming-node theme-listener leak (Expected Behaviour E1-E3 of
// plans/implemented/visualization-subsystem-fixes-round-2.md): a superseded or
// failed `setData` build, and a view disposed mid-layout, must release every
// theme subscription its unmounted node components registered.
//
// Its own file, mirroring `tests/core/TextDispose.test.ts`:
// `ThemeManager._themeListenerCount()` is process-global state, so any other
// undisposed theme-subscribing component anywhere else in the suite would
// pollute an absolute count here — every assertion below reads the count as a
// delta against a snapshot, taken at whichever point makes that delta mean
// "nothing outstanding": right after construction while the view survives
// (E1, E2), or before construction when the view itself is also torn down
// (E3, since disposing it releases its own chrome's listeners too).
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { ThemeManager } from '~/core/Theme';
import { _DiagramView } from '~/component/diagram/DiagramView';
import type { DiagramData } from '~/component/diagram/DiagramModel';
import type { DiagramLayoutResult } from '~/component/diagram/ElkLayoutEngine';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/**
 * A controllable stand-in for `ElkLayoutEngine`, mirroring `DiagramView.test.ts`'s
 * `StubEngine` — duplicated rather than imported since this file must stay
 * separate (see the file-level comment) and that class is not exported. Only
 * the `defer` and `reject` modes this file needs are carried across.
 */
class StubEngine {
    private _deferred: Array<{ resolve: (r: DiagramLayoutResult) => void; reject: (e: unknown) => void }> = [];

    constructor(private _mode: 'defer' | 'reject') {}

    layout(): Promise<DiagramLayoutResult> {
        if (this._mode === 'reject') {
            return Promise.reject(new Error('elkjs unavailable'));
        }

        return new Promise((resolve, reject) => this._deferred.push({ resolve, reject }));
    }

    resolveDeferred(index: number, result: DiagramLayoutResult): void {
        this._deferred[index].resolve(result);
    }

    dispose(): void {}
}

// Module-level slot the test subclass's `createEngine` override returns, so the
// stub is in place before the super constructor calls `createEngine`.
let stubEngine: StubEngine;

class StubDiagramView extends _DiagramView {
    protected createEngine(): any {
        return stubEngine;
    }
}

/** Flushes microtasks + a macrotask so the layout `.then` / `.catch` runs. */
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A graph of `count` unconnected nodes — enough to make a per-node leak visible. */
function graphOf(count: number): DiagramData {
    return {
        nodes: Array.from({ length: count }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` })),
        edges: [],
    };
}

beforeAll(() => {
    // Warm up the once-per-process permanent registration a control in
    // DiagramView's chrome (its Button / FloatingPanel cluster) makes on the
    // very first instance ever constructed — mirrors the class-scoped
    // exclusions TextDispose.test.ts documents for the style-rule cache.
    // Without this, whichever test below happened to run first would see
    // `dispose()` leave exactly one extra listener behind, for a reason
    // having nothing to do with incoming-node disposal.
    installTestDOM(CONFIG);
    stubEngine = new StubEngine('reject');
    new StubDiagramView({}).dispose();
    DOM.reset();
});

beforeEach(() => {
    installTestDOM(CONFIG);
});

afterEach(() => {
    DOM.reset();
});

describe('DiagramView — incoming node disposal releases theme listeners', () => {
    it('E1: a build superseded by a second setData before the first layout lands releases everything it registered', async () => {
        stubEngine = new StubEngine('defer');

        const view = new StubDiagramView({}) as any;
        const snapshot = ThemeManager._themeListenerCount();

        view.setData(graphOf(20));
        const afterFirst = ThemeManager._themeListenerCount();

        view.setData(graphOf(20));
        const afterSecond = ThemeManager._themeListenerCount();

        expect(afterSecond).toBe(afterFirst);
        expect(afterFirst).toBeGreaterThan(snapshot);
    });

    it('E2: a failed layout releases the incoming build back to the pre-setData count', async () => {
        stubEngine = new StubEngine('reject');

        const view = new StubDiagramView({}) as any;
        const snapshot = ThemeManager._themeListenerCount();

        view.setData(graphOf(20));
        await flush();

        expect(ThemeManager._themeListenerCount()).toBe(snapshot);
    });

    it('E3: disposing the view mid-flight releases the still-incoming build', async () => {
        stubEngine = new StubEngine('defer');

        // Snapshot before construction, unlike E1/E2: `dispose()` here tears
        // down the whole view (not just the incoming nodes), so the only
        // baseline that returning "to the snapshot" can mean is the one from
        // before the view — and its own construction-time listeners — existed.
        const snapshot = ThemeManager._themeListenerCount();
        const view = new StubDiagramView({}) as any;

        view.setData(graphOf(20));
        view.dispose();

        expect(ThemeManager._themeListenerCount()).toBe(snapshot);
    });
});
