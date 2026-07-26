import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { _DiagramView } from '~/component/diagram/DiagramView';
import type { DiagramData } from '~/component/diagram/DiagramModel';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

// U — DiagramView's real (unstubbed) `createEngine` forwards `elkWorkerFactory`
// / `elkWorkerUrl` into the real `ElkLayoutEngine`. Every test in
// `DiagramView.test.ts` overrides `createEngine` with a `StubEngine`, so this
// is the only place that wiring is exercised. No `data` option is passed here,
// so the constructor never triggers `relayout` (and thus never runs elkjs) —
// the engine `createEngine()` actually built is read off the constructed view
// via `as any` (this file's existing access pattern for private fields) and
// driven directly, isolating the assertion from DiagramView's DOM-touching
// layout-application/failure paths.

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

function simpleGraph(): DiagramData {
    return { nodes: [{ id: 'a' }], edges: [] };
}

beforeEach(() => {
    installTestDOM(CONFIG);
});

afterEach(() => {
    DOM.reset();
});

describe('DiagramView — createEngine forwards worker options to the real ElkLayoutEngine', () => {
    it('forwards elkWorkerFactory: elkjs invokes it while building its engine', async () => {
        const factory = vi.fn((): Worker => ({}) as unknown as Worker);
        const view    = new _DiagramView({ elkWorkerFactory: factory }) as any;

        await view._engine.layout(simpleGraph(), new Map());

        expect(factory).toHaveBeenCalled();
    });

    it('forwards elkWorkerUrl: elkjs\'s own worker-unavailable warning fires', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const view = new _DiagramView({ elkWorkerUrl: 'https://example.com/elk-worker.js' }) as any;

        await view._engine.layout(simpleGraph(), new Map());

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Web worker requested'));
        warn.mockRestore();
    });

    it('forwards neither option: no worker-related warning fires', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const view = new _DiagramView({}) as any;

        await view._engine.layout(simpleGraph(), new Map());

        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});

// Disposal against real elkjs. These two are the load-bearing regression tests
// for the "only terminate a factory-built instance" guard: real elkjs throws a
// TypeError if a main-thread or workerUrl-mode instance is terminated, because
// elkjs drives an in-process stand-in worker in both modes and that stand-in
// has no `terminate`. The mocked suite in ElkLayoutEngine.test.ts cannot catch
// this — its MockELK.terminateWorker never throws. R2 in particular fails if
// the guard is written against `_workerBacked` (which workerUrl mode sets)
// instead of `_ownsWorker`.

describe('DiagramView — disposal against real elkjs', () => {
    it('R1: disposing a main-thread view does not throw', async () => {
        const view = new _DiagramView({}) as any;

        await view._engine.layout(simpleGraph(), new Map());

        expect(() => view.dispose()).not.toThrow();
    });

    it('R2: disposing a workerUrl-mode view does not throw', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const view = new _DiagramView({ elkWorkerUrl: 'https://example.com/elk-worker.js' }) as any;

        await view._engine.layout(simpleGraph(), new Map());

        expect(() => view.dispose()).not.toThrow();
        warn.mockRestore();
    });
});
