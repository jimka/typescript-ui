import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildElkGraph, mapElkResult, ElkLayoutEngine } from '~/component/diagram/ElkLayoutEngine';
import type { DiagramData } from '~/component/diagram/DiagramModel';

// U2 — worker-mode selection and main-thread fallback on `ElkLayoutEngine`
// itself. `elkjs/lib/elk.bundled.js` is mocked so the constructor call and the
// `layout` call can be observed/controlled without a real ELK/worker.

let lastConstructorOptions: { workerFactory?: () => Worker } | undefined;
const layoutMock = vi.fn();
// Records the constructor options of whichever instance was terminated, so a
// test can tell the worker-backed instance from the main-thread one. Real
// elkjs THROWS here for a non-factory instance (its in-process stand-in worker
// has no `terminate`); the mock cannot reproduce that, which is why the guard
// is additionally pinned against real elkjs in `DiagramView.createEngine.test.ts`.
const terminateWorkerMock = vi.fn();
/**
 * How many ELK instances have been constructed. An engine that builds two must
 * terminate two, so this is what makes "every worker built is a worker
 * terminated" assertable rather than just "something was terminated".
 */
let constructionCount = 0;
/**
 * When set, the next ELK construction throws it and clears the slot, so a test
 * can make construction fail exactly once and observe whether a later `layout`
 * retries it.
 */
let constructionError: Error | null = null;
/**
 * Fired synchronously inside each ELK construction, before the mock invokes
 * any `workerFactory`. Awaiting a promise always yields a microtask, so a hook
 * running here lands *after* the instance exists but *before* the `await` that
 * produced it resumes. That is the window E13 needs; disposal landing earlier
 * — while `layout` is still parked on the dynamic import — needs no hook at
 * all and is what E9/E10 use instead.
 */
let onConstruct: (() => void) | null = null;

vi.mock('elkjs/lib/elk.bundled.js', () => {
    class MockELK {
        options?: { workerFactory?: () => Worker };
        constructor(options?: { workerFactory?: () => Worker }) {
            if (constructionError) {
                const error = constructionError;
                constructionError = null;
                throw error;
            }

            this.options = options;
            lastConstructorOptions = options;
            constructionCount += 1;
            onConstruct?.();
            // Real elkjs invokes the factory during construction to spin up the
            // worker; mirrored here so a throwing consumer factory propagates
            // out of `new ELK(...)` exactly as it would for the real library.
            options?.workerFactory?.();
        }
        layout(graph: unknown) {
            return layoutMock(graph);
        }
        terminateWorker() {
            terminateWorkerMock(this.options);
        }
    }
    return { default: MockELK };
});

// U1 — model → ELK mapping, and the result → coords mapping. Both mapping
// functions are pure and synchronous, so they are exercised directly with no
// `elkjs` import.

describe('ElkLayoutEngine — buildElkGraph', () => {
    it('maps nodes to ELK children, honouring explicit sizes then the sizes map', () => {
        const data: DiagramData = {
            nodes: [
                { id: 'a', width: 50, height: 30, layoutOptions: { 'elk.nodeSize': '1' } },
                { id: 'b', label: 'B' },
                { id: 'c' },
            ],
            edges: [],
        };

        const sizes = new Map([['b', { width: 80, height: 40 }]]);

        const graph = buildElkGraph(data, sizes);

        expect(graph.id).toBe('root');
        expect(graph.children).toEqual([
            { id: 'a', width: 50, height: 30, layoutOptions: { 'elk.nodeSize': '1' } },
            { id: 'b', width: 80, height: 40, layoutOptions: undefined },
            // No explicit size, no sizes-map entry — the default fallback box.
            { id: 'c', width: 120, height: 40, layoutOptions: undefined },
        ]);
    });

    it('maps single source/target edges to ELK source/target lists', () => {
        const data: DiagramData = {
            nodes: [{ id: 'a' }, { id: 'b' }],
            edges: [{ id: 'e', source: 'a', target: 'b' }],
        };

        const graph = buildElkGraph(data, new Map());

        expect(graph.edges).toEqual([{ id: 'e', sources: ['a'], targets: ['b'] }]);
    });

    it('maps node ports to ELK ports, with a side hint becoming elk.port.side', () => {
        const data: DiagramData = {
            nodes: [{ id: 'a', ports: [{ id: 'p', x: 0, y: 30, width: 1, height: 1, side: 'WEST' }] }],
            edges: [],
        };

        const graph = buildElkGraph(data, new Map());

        expect(graph.children?.[0].ports).toEqual([
            { id: 'p', x: 0, y: 30, width: 1, height: 1, layoutOptions: { 'elk.port.side': 'WEST' } },
        ]);
    });

    it('maps a sideless port with layoutOptions left undefined (not an empty object)', () => {
        const data: DiagramData = {
            nodes: [{ id: 'a', ports: [{ id: 'p', x: 0, y: 0 }] }],
            edges: [],
        };

        const graph = buildElkGraph(data, new Map());

        expect(graph.children?.[0].ports).toEqual([
            { id: 'p', x: 0, y: 0, width: undefined, height: undefined, layoutOptions: undefined },
        ]);
    });

    it('routes an edge through its sourcePort/targetPort when set', () => {
        const data: DiagramData = {
            nodes: [{ id: 'a' }, { id: 'b' }],
            edges: [{ id: 'e', source: 'a', target: 'b', sourcePort: 'a::c::out', targetPort: 'b::d::in' }],
        };

        const graph = buildElkGraph(data, new Map());

        expect(graph.edges).toEqual([{ id: 'e', sources: ['a::c::out'], targets: ['b::d::in'] }]);
    });

    it('falls back to the node id when an edge carries no ports (regression)', () => {
        const data: DiagramData = {
            nodes: [{ id: 'a' }, { id: 'b' }],
            edges: [{ id: 'e', source: 'a', target: 'b' }],
        };

        const graph = buildElkGraph(data, new Map());

        expect(graph.edges).toEqual([{ id: 'e', sources: ['a'], targets: ['b'] }]);
    });

    it('maps a container node (non-empty children) to a nested ElkNode with no width/height', () => {
        const data: DiagramData = {
            nodes: [
                {
                    id: 'schema:public',
                    label: 'public',
                    children: [
                        { id: 'public.users', width: 50, height: 30 },
                        { id: 'public.orders' },
                    ],
                },
            ],
            edges: [],
        };

        const sizes = new Map([['public.orders', { width: 90, height: 40 }]]);

        const graph = buildElkGraph(data, sizes);

        expect(graph.children).toEqual([
            {
                id: 'schema:public',
                // The default container padding reserves top clearance for
                // DiagramGroupNode's header label — see the next test.
                layoutOptions: { 'elk.padding': expect.any(String) },
                children: [
                    { id: 'public.users', width: 50, height: 30, layoutOptions: undefined, ports: undefined },
                    { id: 'public.orders', width: 90, height: 40, layoutOptions: undefined, ports: undefined },
                ],
            },
        ]);
        // A container carries no explicit size — ELK computes it from contents.
        expect(graph.children?.[0]).not.toHaveProperty('width');
        expect(graph.children?.[0]).not.toHaveProperty('height');
    });

    it('gives a container a top padding wide enough to clear the DiagramGroupNode header, overridable by the node\'s own layoutOptions', () => {
        const data: DiagramData = {
            nodes: [{ id: 'schema:public', children: [{ id: 'public.users' }] }],
            edges: [],
        };

        const graph = buildElkGraph(data, new Map());
        const padding = graph.children?.[0].layoutOptions?.['elk.padding'];

        // The exact spacing is an implementation detail; what matters is a
        // non-zero top inset (so the container box leaves room above its
        // children for the header label DiagramGroupNode paints).
        expect(padding).toBeDefined();
        expect(padding).toMatch(/top\s*=\s*(?!0\b)\d/);

        const overridden = buildElkGraph(
            {
                nodes: [{ id: 'schema:public', layoutOptions: { 'elk.padding': '[top=1,left=1,bottom=1,right=1]' }, children: [{ id: 'public.users' }] }],
                edges: [],
            },
            new Map(),
        );

        expect(overridden.children?.[0].layoutOptions).toEqual({ 'elk.padding': '[top=1,left=1,bottom=1,right=1]' });
    });

    it('recurses through nested containers (a container inside a container)', () => {
        const data: DiagramData = {
            nodes: [
                {
                    id: 'outer',
                    children: [
                        { id: 'inner', children: [{ id: 'leaf' }] },
                    ],
                },
            ],
            edges: [],
        };

        const graph = buildElkGraph(data, new Map());

        const outer = graph.children?.[0];
        expect(outer?.id).toBe('outer');
        const inner = outer?.children?.[0];
        expect(inner?.id).toBe('inner');
        expect(inner).not.toHaveProperty('width');
        expect(inner?.children).toEqual([
            { id: 'leaf', width: 120, height: 40, layoutOptions: undefined, ports: undefined },
        ]);
    });

    it('a leaf node (empty or absent children) maps exactly as today', () => {
        const data: DiagramData = {
            nodes: [{ id: 'a', children: [] }, { id: 'b' }],
            edges: [],
        };

        const graph = buildElkGraph(data, new Map());

        expect(graph.children).toEqual([
            { id: 'a', width: 120, height: 40, layoutOptions: undefined, ports: undefined },
            { id: 'b', width: 120, height: 40, layoutOptions: undefined, ports: undefined },
        ]);
    });

    it('sets elk.hierarchyHandling=INCLUDE_CHILDREN on the root, overridable by data.layoutOptions', () => {
        const data: DiagramData = { nodes: [], edges: [] };

        const graph = buildElkGraph(data, new Map());
        expect(graph.layoutOptions).toMatchObject({ 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' });

        const overridden = buildElkGraph(
            { ...data, layoutOptions: { 'elk.hierarchyHandling': 'SEPARATE_CHILDREN' } },
            new Map(),
        );
        expect(overridden.layoutOptions).toMatchObject({ 'elk.hierarchyHandling': 'SEPARATE_CHILDREN' });
    });

    it('merges graph options over defaults on the root; per-node options ride on the child', () => {
        const data: DiagramData = {
            nodes: [{ id: 'a', layoutOptions: { 'elk.algorithm': 'force' } }],
            edges: [],
            layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' },
        };

        const graph = buildElkGraph(data, new Map(), { 'elk.algorithm': 'stress', 'elk.spacing': '20' });

        // Graph wins over defaults on the root: algorithm=layered, spacing kept.
        // hierarchyHandling is the lowest-precedence tier (below defaults/graph),
        // unset by either here, so its own default value survives.
        expect(graph.layoutOptions).toEqual({
            'elk.algorithm':         'layered',
            'elk.spacing':           '20',
            'elk.direction':         'RIGHT',
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
        });

        // Per-node option rides on the child so ELK resolves it over the
        // inherited root options — per-node wins over graph wins over defaults.
        expect(graph.children?.[0].layoutOptions).toEqual({ 'elk.algorithm': 'force' });
    });
});

describe('ElkLayoutEngine — mapElkResult', () => {
    it('maps annotated ELK output back to node coords, edge sections, and graph bounds', () => {
        const result = mapElkResult({
            id:     'root',
            width:  200,
            height: 100,
            children: [{ id: 'a', x: 10, y: 20, width: 50, height: 30 }],
            edges: [{
                id: 'e',
                sources: ['a'],
                targets: ['b'],
                sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 5, y: 5 } }],
            }],
        });

        expect(result.width).toBe(200);
        expect(result.height).toBe(100);
        expect(result.nodes).toEqual([{ id: 'a', x: 10, y: 20, width: 50, height: 30 }]);
        expect(result.edges).toEqual([{ id: 'e', sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 5, y: 5 } }] }]);
    });

    it('defaults missing coordinate / size / section fields to zero / empty', () => {
        const result = mapElkResult({ id: 'root', children: [{ id: 'a' }], edges: [{ id: 'e', sources: ['a'], targets: ['a'] }] });

        expect(result.width).toBe(0);
        expect(result.height).toBe(0);
        expect(result.nodes).toEqual([{ id: 'a', x: 0, y: 0, width: 0, height: 0 }]);
        expect(result.edges).toEqual([{ id: 'e', sections: [] }]);
    });

    it('flattens a container\'s parent-relative child coords to absolute, emitting both the container and its children', () => {
        const result = mapElkResult({
            id: 'root',
            width: 300,
            height: 200,
            children: [
                {
                    id: 'schema:public',
                    x: 10, y: 20, width: 150, height: 100,
                    children: [
                        // Coordinates below are relative to the container's own
                        // top-left (10, 20), per ELK's nested-result convention.
                        { id: 'public.users', x: 5, y: 8, width: 50, height: 30 },
                        { id: 'public.orders', x: 5, y: 50, width: 50, height: 30 },
                    ],
                },
            ],
            edges: [],
        });

        expect(result.nodes).toEqual([
            { id: 'schema:public', x: 10, y: 20, width: 150, height: 100 },
            // Absolute = container origin (10, 20) + child-relative (5, 8) / (5, 50).
            { id: 'public.users', x: 15, y: 28, width: 50, height: 30 },
            { id: 'public.orders', x: 15, y: 70, width: 50, height: 30 },
        ]);
    });

    it('flattens nested containers by accumulating offsets through each level', () => {
        const result = mapElkResult({
            id: 'root',
            children: [
                {
                    id: 'outer',
                    x: 100, y: 100, width: 200, height: 200,
                    children: [
                        {
                            id: 'inner',
                            x: 10, y: 10, width: 100, height: 100,
                            children: [{ id: 'leaf', x: 5, y: 5, width: 20, height: 20 }],
                        },
                    ],
                },
            ],
            edges: [],
        });

        expect(result.nodes).toEqual([
            { id: 'outer', x: 100, y: 100, width: 200, height: 200 },
            { id: 'inner', x: 110, y: 110, width: 100, height: 100 },
            { id: 'leaf', x: 115, y: 115, width: 20, height: 20 },
        ]);
    });

    it('a flat (no-children) result maps exactly as today', () => {
        const result = mapElkResult({
            id: 'root',
            width: 200,
            height: 100,
            children: [{ id: 'a', x: 10, y: 20, width: 50, height: 30 }],
            edges: [],
        });

        expect(result.nodes).toEqual([{ id: 'a', x: 10, y: 20, width: 50, height: 30 }]);
    });

    it('shifts an intra-container edge\'s route by its container\'s absolute origin', () => {
        // ELK routes an edge between two nodes nested in the same container in
        // that container's frame, and tags it with `container`. Its section
        // coordinates are relative to the container's top-left (10, 20), so the
        // absolute route is that origin plus each reported point.
        const result = mapElkResult({
            id: 'root',
            children: [
                {
                    id: 'schema:public',
                    x: 10, y: 20, width: 150, height: 100,
                    children: [
                        { id: 'public.orders', x: 12, y: 12, width: 120, height: 40 },
                        { id: 'public.customers', x: 152, y: 12, width: 120, height: 40 },
                    ],
                },
            ],
            edges: [{
                id: 'e',
                sources: ['public.orders'],
                targets: ['public.customers'],
                container: 'schema:public',
                sections: [{
                    startPoint: { x: 132, y: 32 },
                    bendPoints: [{ x: 142, y: 32 }],
                    endPoint:   { x: 152, y: 32 },
                }],
            }],
        });

        expect(result.edges).toEqual([{
            id: 'e',
            sections: [{
                startPoint: { x: 142, y: 52 },
                bendPoints: [{ x: 152, y: 52 }],
                endPoint:   { x: 162, y: 52 },
            }],
        }]);
    });

    it('collects and offsets an edge nested inside a container\'s own edges array', () => {
        // Some ELK results place a routed edge in the container node's `edges`
        // rather than the root's, with no explicit `container`; its frame is
        // then that container. Both placements must map to the same absolute
        // route.
        const result = mapElkResult({
            id: 'root',
            children: [
                {
                    id: 'schema:public',
                    x: 10, y: 20, width: 150, height: 100,
                    children: [{ id: 'public.orders', x: 12, y: 12, width: 120, height: 40 }],
                    edges: [{
                        id: 'e',
                        sources: ['public.orders'],
                        targets: ['public.orders'],
                        sections: [{ startPoint: { x: 1, y: 2 }, endPoint: { x: 3, y: 4 } }],
                    }],
                },
            ],
            edges: [],
        });

        expect(result.edges).toEqual([{
            id: 'e',
            sections: [{ startPoint: { x: 11, y: 22 }, endPoint: { x: 13, y: 24 } }],
        }]);
    });
});

describe('ElkLayoutEngine — worker modes and fallback', () => {
    const DATA: DiagramData = { nodes: [{ id: 'a' }], edges: [] };
    const SIZES = new Map<string, { width: number; height: number }>();

    beforeEach(() => {
        lastConstructorOptions = undefined;
        layoutMock.mockReset();
        layoutMock.mockResolvedValue({ id: 'root', children: [], edges: [] });
        terminateWorkerMock.mockReset();
        constructionCount = 0;
        constructionError = null;
        onConstruct = null;
    });

    it('with no factory, builds a plain ELK() and resolves', async () => {
        const engine = new ElkLayoutEngine();
        const result = await engine.layout(DATA, SIZES);

        expect(lastConstructorOptions).toBeUndefined();
        expect(result.nodes).toEqual([]);
    });

    it('with workerFactory provided and healthy, builds new ELK({ workerFactory }) and resolves', async () => {
        const factory = vi.fn((): Worker => ({}) as Worker);
        const engine = new ElkLayoutEngine({ workerFactory: factory });

        await engine.layout(DATA, SIZES);

        expect(factory).toHaveBeenCalled();
        expect(lastConstructorOptions).toEqual({ workerFactory: factory });
    });

    it('falls back to the main thread when the workerFactory throws (e.g. Worker undefined / CSP)', async () => {
        const factory = vi.fn((): Worker => { throw new Error('Worker is not defined'); });
        const engine = new ElkLayoutEngine({ workerFactory: factory });

        const result = await engine.layout(DATA, SIZES);

        expect(factory).toHaveBeenCalled();
        // The worker-backed construction recorded its options and then threw
        // (from the factory call); the fallback construction that overwrote
        // `lastConstructorOptions` afterward is the plain, argument-less ELK().
        expect(lastConstructorOptions).toBeUndefined();
        expect(result.nodes).toEqual([]);
    });

    it('falls back to the main thread when the worker constructs but the first layout rejects', async () => {
        layoutMock.mockRejectedValueOnce(new Error('worker crashed'));
        layoutMock.mockResolvedValueOnce({ id: 'root', children: [], edges: [] });

        const engine = new ElkLayoutEngine({ workerFactory: (): Worker => ({}) as Worker });
        const result = await engine.layout(DATA, SIZES);

        expect(layoutMock).toHaveBeenCalledTimes(2);
        expect(result.nodes).toEqual([]);
    });

    it('propagates a main-thread failure (elkjs genuinely broken) without retrying', async () => {
        layoutMock.mockRejectedValue(new Error('elkjs broken'));

        const engine = new ElkLayoutEngine();

        await expect(engine.layout(DATA, SIZES)).rejects.toThrow('elkjs broken');
        expect(layoutMock).toHaveBeenCalledTimes(1);
    });

    it('still falls back on a LATER layout failure, not just the first, since a success does not clear worker-backed state', async () => {
        const engine = new ElkLayoutEngine({ workerFactory: (): Worker => ({}) as Worker });

        // First layout succeeds on the worker — `_workerBacked` stays true.
        await engine.layout(DATA, SIZES);
        expect(layoutMock).toHaveBeenCalledTimes(1);

        // A later layout on the same (still worker-backed) engine fails; the
        // engine still rebuilds on the main thread and retries once.
        layoutMock.mockRejectedValueOnce(new Error('worker crashed later'));
        layoutMock.mockResolvedValueOnce({ id: 'root', children: [], edges: [] });

        const result = await engine.layout(DATA, SIZES);

        expect(layoutMock).toHaveBeenCalledTimes(3); // 1 success + 1 failed retry attempt + 1 main-thread retry
        expect(result.nodes).toEqual([]);
    });

    it('propagates a failure after the one-time fallback has already happened, without retrying again', async () => {
        const engine = new ElkLayoutEngine({ workerFactory: (): Worker => { throw new Error('Worker is not defined'); } });

        // First layout: the worker fails to construct, falls back, and
        // resolves on the main thread — `_workerBacked` is now false for good.
        await engine.layout(DATA, SIZES);
        layoutMock.mockClear();

        // A later main-thread failure has no worker left to fall back to. If
        // the engine wrongly retried, it would consume this trailing resolved
        // value and the layout would resolve instead of reject — the "once"
        // pairing (rather than a persistent reject) is what makes this test
        // sensitive to a regression that removes the no-retry guard.
        layoutMock.mockRejectedValueOnce(new Error('elkjs broken on retry'));
        layoutMock.mockResolvedValueOnce({ id: 'root', children: [], edges: [] });

        await expect(engine.layout(DATA, SIZES)).rejects.toThrow('elkjs broken on retry');
        expect(layoutMock).toHaveBeenCalledTimes(1);
    });
});

// U3 — disposal. `terminateWorkerMock` records the constructor options of the
// terminated instance, so each case can assert *which* instance was torn down
// (or that none was). The guard these cases pin — "only a consumer-factory
// instance may be terminated" — is why `dispose` cannot simply call
// `terminateWorker` unconditionally; see `DiagramView.createEngine.test.ts`
// for the real-elkjs half of that story.

describe('ElkLayoutEngine — disposal', () => {
    const DATA: DiagramData = { nodes: [{ id: 'a' }], edges: [] };
    const SIZES = new Map<string, { width: number; height: number }>();
    const WORKER_STUB = (): Worker => ({}) as Worker;

    beforeEach(() => {
        lastConstructorOptions = undefined;
        layoutMock.mockReset();
        layoutMock.mockResolvedValue({ id: 'root', children: [], edges: [] });
        terminateWorkerMock.mockReset();
        constructionCount = 0;
        constructionError = null;
        onConstruct = null;
    });

    it('E1: disposing an engine that never laid out constructs nothing and terminates nothing', () => {
        const engine = new ElkLayoutEngine({ workerFactory: WORKER_STUB });

        expect(() => engine.dispose()).not.toThrow();

        expect(lastConstructorOptions).toBeUndefined();
        expect(terminateWorkerMock).not.toHaveBeenCalled();
    });

    it('E2: terminates the worker of a factory-built instance', async () => {
        const engine = new ElkLayoutEngine({ workerFactory: WORKER_STUB });

        await engine.layout(DATA, SIZES);
        engine.dispose();

        expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
        expect(terminateWorkerMock).toHaveBeenCalledWith({ workerFactory: WORKER_STUB });
    });

    it('E3: does not terminate a main-thread instance', async () => {
        const engine = new ElkLayoutEngine();

        await engine.layout(DATA, SIZES);
        engine.dispose();

        expect(terminateWorkerMock).not.toHaveBeenCalled();
    });

    it('E5: is idempotent — a second dispose neither throws nor terminates again', async () => {
        const engine = new ElkLayoutEngine({ workerFactory: WORKER_STUB });

        await engine.layout(DATA, SIZES);
        engine.dispose();

        expect(() => engine.dispose()).not.toThrow();
        expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
    });

    it('E6: a disposed engine rejects a later layout and builds nothing', async () => {
        const engine = new ElkLayoutEngine({ workerFactory: WORKER_STUB });

        await engine.layout(DATA, SIZES);
        engine.dispose();
        layoutMock.mockClear();

        await expect(engine.layout(DATA, SIZES)).rejects.toThrow('ElkLayoutEngine has been disposed');
        expect(layoutMock).not.toHaveBeenCalled();
    });

    it('E7: the main-thread fallback terminates the worker it abandons', async () => {
        layoutMock.mockRejectedValueOnce(new Error('worker crashed'));
        layoutMock.mockResolvedValueOnce({ id: 'root', children: [], edges: [] });

        const engine = new ElkLayoutEngine({ workerFactory: WORKER_STUB });
        const result = await engine.layout(DATA, SIZES);

        expect(result.nodes).toEqual([]);
        expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
        expect(terminateWorkerMock).toHaveBeenCalledWith({ workerFactory: WORKER_STUB });
        // The memo must not keep resolving to the worker-backed instance the
        // fallback just abandoned — same invariant E14 pins for `dispose`.
        // Internal state for the same reason: `ensureElk` short-circuits on
        // `_elk`, so a stale memo has no public surface.
        expect((engine as unknown as { _building: unknown })._building).toBeNull();
    });

    it('E8: disposing after a fallback does not terminate the main-thread replacement', async () => {
        layoutMock.mockRejectedValueOnce(new Error('worker crashed'));
        layoutMock.mockResolvedValueOnce({ id: 'root', children: [], edges: [] });

        const engine = new ElkLayoutEngine({ workerFactory: WORKER_STUB });
        await engine.layout(DATA, SIZES);

        engine.dispose();

        // Still just the fallback's own termination — the replacement has no worker.
        expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
    });

    it('E9: a worker built by a construction in flight at disposal is terminated, not adopted', async () => {
        const factory = vi.fn(WORKER_STUB);
        const engine = new ElkLayoutEngine({ workerFactory: factory });

        // `layout` parks on elkjs's dynamic import, so this synchronous
        // `dispose` always lands inside the construction window.
        const pending = engine.layout(DATA, SIZES);
        engine.dispose();

        await expect(pending).rejects.toThrow('ElkLayoutEngine has been disposed');
        expect(factory).toHaveBeenCalled();
        expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
        expect(terminateWorkerMock).toHaveBeenCalledWith({ workerFactory: factory });
    });

    it('E10: a main-thread construction in flight at disposal rejects and terminates nothing', async () => {
        const engine = new ElkLayoutEngine();

        const pending = engine.layout(DATA, SIZES);
        engine.dispose();

        await expect(pending).rejects.toThrow('ElkLayoutEngine has been disposed');
        expect(terminateWorkerMock).not.toHaveBeenCalled();
    });

    it('E11: overlapping layouts share one ELK, so disposal leaves no worker behind', async () => {
        const engine = new ElkLayoutEngine({ workerFactory: WORKER_STUB });

        // Both calls park at elkjs's dynamic import before either stores an
        // instance, which is exactly what `view.setData(a); view.setData(b);`
        // produces in one tick. Without in-flight deduplication each builds its
        // own ELK — and `dispose` can only ever terminate the one the engine
        // kept, so the other worker outlives the engine.
        const first  = engine.layout(DATA, SIZES);
        const second = engine.layout(DATA, SIZES);

        await Promise.all([first, second]);

        expect(constructionCount).toBe(1);

        engine.dispose();

        // The real invariant: every worker built is a worker terminated.
        expect(terminateWorkerMock).toHaveBeenCalledTimes(constructionCount);
    });

    it('E12: a failed construction is retried by the next layout, not replayed', async () => {
        const engine = new ElkLayoutEngine();

        // Construction fails once. Sharing one construction across overlapping
        // layouts must not turn that into a permanent failure: the memoised
        // promise is dropped on rejection so the next layout re-imports,
        // matching the behaviour before construction was ever memoised.
        constructionError = new Error('elkjs boom');

        await expect(engine.layout(DATA, SIZES)).rejects.toThrow('elkjs boom');

        const result = await engine.layout(DATA, SIZES);

        expect(result.nodes).toEqual([]);
        expect(constructionCount).toBe(1);
    });
    it('E13: disposal landing during the fallback rebuild is not adopted', async () => {
        // The worker layout fails, so `layout` falls back and rebuilds on the
        // main thread. Disposing while that rebuild is in flight must not
        // leave the disposed engine holding — and laying out through — it.
        layoutMock.mockRejectedValueOnce(new Error('worker crashed'));

        const engine = new ElkLayoutEngine({ workerFactory: WORKER_STUB });

        // Construction #1 is the worker-backed engine; #2 is the fallback's
        // rebuild. Disposing inside #2 lands in exactly the window between the
        // rebuild being built and `layout` resuming to adopt it.
        onConstruct = () => {
            if (constructionCount === 2) {
                engine.dispose();
            }
        };

        await expect(engine.layout(DATA, SIZES)).rejects.toThrow('ElkLayoutEngine has been disposed');

        // Only the worker-backed instance is terminated — once, by the
        // fallback. The dropped rebuild is main-thread, and terminating a
        // non-factory instance throws a TypeError against real elkjs (the
        // hazard R1/R2 exist for), so "drop without terminating" is the
        // contract here, not an oversight.
        expect(terminateWorkerMock).toHaveBeenCalledTimes(1);
        expect(terminateWorkerMock).toHaveBeenCalledWith({ workerFactory: WORKER_STUB });
    });

    it('E14: disposal drops the memoised construction, not just the instance', async () => {
        const engine = new ElkLayoutEngine({ workerFactory: WORKER_STUB });

        await engine.layout(DATA, SIZES);
        engine.dispose();

        // Asserted against internal state deliberately: after disposal the
        // entry guard in `layout` makes `ensureElk` unreachable, so a retained
        // memo cannot change any observable behaviour — it would only keep the
        // terminated ELK (and its Worker object) alive for the engine's
        // lifetime. There is no public surface that can see the difference.
        expect((engine as unknown as { _building: unknown })._building).toBeNull();
        expect((engine as unknown as { _elk: unknown })._elk).toBeNull();
    });

});
