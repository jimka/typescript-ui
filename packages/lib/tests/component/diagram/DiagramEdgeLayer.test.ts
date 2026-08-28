import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { _DiagramEdgeLayer as DiagramEdgeLayer, EDGE_MARKER_EXTENT, routeBounds } from '~/component/diagram/DiagramEdgeLayer';
import type { DiagramEdgeRoute } from '~/component/diagram/DiagramEdgeLayer';
import type { DiagramRect } from '~/component/diagram/DiagramResidency';
import { installTestDOM, makeEvent, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;

beforeEach(() => { sink = installTestDOM(CONFIG); });
afterEach(() => { DOM.reset(); });

/** Every `{ setAttr }` payload written through `apply`, in write order. */
function attrWrites(): Record<string, string>[] {
    return sink.writes
        .filter((w) => w.op === 'apply' && (w.args[1] as { setAttr?: object }).setAttr !== undefined)
        .map((w) => (w.args[1] as { setAttr: Record<string, string> }).setAttr);
}

/**
 * The `setAttr` payloads for every drawn edge path — visible and hit — for the
 * current edge set (excludes marker/defs setup). Marker child shapes also set
 * `d` (crow's-foot paths), so distinguish an edge path by its `stroke-width`,
 * which only an edge path sets — marker children never do.
 */
function edgePathAttrsAll(): Record<string, string>[] {
    return attrWrites().filter((a) => a.d !== undefined && a['stroke-width'] !== undefined);
}

/** The `setAttr` payload for the single visible drawn `<path>` edge element. */
function edgePathAttrs(): Record<string, string> | undefined {
    return edgePathAttrsAll().find((a) => a.stroke !== 'transparent');
}

/** The `setAttr` payload for the single invisible hit `<path>` edge element. */
function hitPathAttrs(): Record<string, string> | undefined {
    return edgePathAttrsAll().find((a) => a.stroke === 'transparent');
}

function route(overrides: Partial<DiagramEdgeRoute> = {}): DiagramEdgeRoute {
    return {
        id:       'e',
        sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 10 } }],
        ...overrides,
    };
}

describe('routeBounds', () => {
    it('pads a straight two-point route by EDGE_MARKER_EXTENT on every side', () => {
        const sections = [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 100, y: 0 } }];

        expect(routeBounds(sections)).toEqual({ x: -18, y: -18, width: 136, height: 36 });
    });

    it('includes a bend point that extends the route\'s bounds', () => {
        const sections = [{
            startPoint: { x: 0, y: 0 },
            bendPoints: [{ x: 100, y: 0 }],
            endPoint: { x: 100, y: 100 },
        }];

        expect(routeBounds(sections)).toEqual({ x: -18, y: -18, width: 136, height: 136 });
    });

    it('combines two sections at opposite corners into one box spanning both', () => {
        const sections = [
            { startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 10 } },
            { startPoint: { x: -50, y: -50 }, endPoint: { x: 0, y: 0 } },
        ];

        expect(routeBounds(sections)).toEqual({ x: -68, y: -68, width: 96, height: 96 });
    });

    it('returns null for a route with no sections', () => {
        expect(routeBounds([])).toBeNull();
    });

    it('pads a zero-area point bounds for a section whose start equals its end', () => {
        const sections = [{ startPoint: { x: 5, y: 5 }, endPoint: { x: 5, y: 5 } }];

        expect(routeBounds(sections)).toEqual({ x: -13, y: -13, width: 36, height: 36 });
    });

    it('includes a bend point that falls outside the straight line between its endpoints', () => {
        const sections = [{
            startPoint: { x: 0, y: 0 },
            bendPoints: [{ x: 50, y: -200 }],
            endPoint: { x: 100, y: 0 },
        }];

        expect(routeBounds(sections)).toEqual({ x: -18, y: -218, width: 136, height: 236 });
    });
});

describe('DiagramEdgeLayer — style-driven markers (crow\'s-foot)', () => {
    it('an edge route with no style keeps the default arrow marker-end and no marker-start', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([route()]);

        const attrs = edgePathAttrs()!;

        expect(attrs['marker-end']).toContain('-arrow)');
        expect(attrs['marker-start']).toBeUndefined();
    });

    it('style.endMarker sets marker-end and style.startMarker sets marker-start to the namespaced marker id', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([route({ style: { startMarker: 'oneOrMany', endMarker: 'one' } })]);

        const attrs = edgePathAttrs()!;

        expect(attrs['marker-end']).toContain('-one)');
        expect(attrs['marker-start']).toContain('-oneOrMany)');
    });

    it('style.stroke overrides the path stroke and style.dashed sets stroke-dasharray', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([route({ style: { stroke: 'rgb(200, 50, 50)', dashed: true } })]);

        const attrs = edgePathAttrs()!;

        expect(attrs.stroke).toBe('rgb(200, 50, 50)');
        expect(attrs['stroke-dasharray']).toBeDefined();
    });

    it('a plain edge (no style) has no stroke-dasharray', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([route()]);

        const attrs = edgePathAttrs()!;

        expect(attrs['stroke-dasharray']).toBeUndefined();
    });
});

// Regression: routes handed over before the host mounts the layer. A diagram
// built inside a dock tab runs its whole ELK layout while the tab is still
// detached — the app awaits DiagramView.whenLaidOut() before mounting, so the
// layout ALWAYS lands first — and `rebuildPaths` cannot draw without an
// element. `render` performs the first draw only when it is what creates the
// element, which is not the case there, so the sole draw for those routes used
// to be lost and the diagram rendered nodes with no edges at all.
//
// The offline DOM resolves `getElement()` during `render` in a way the browser
// does not, so it cannot reproduce the lost draw itself (a test asserting
// "drawn after mount" passes with or without the fix, which is why every
// automated pass missed this). What IS assertable offline is the mechanism the
// browser needs: that a detached `setEdges` defers its draw to the first
// connected layout instead of dropping it. The visible outcome is covered by a
// documented manual check — see the plan's Implementation Notes.
describe('DiagramEdgeLayer — routes arriving before the layer is mounted', () => {
    it('defers the draw to the first connected layout instead of losing it', () => {
        const layer = new DiagramEdgeLayer() as any;
        const deferred = vi.spyOn(layer, 'onFirstLayout');

        // Detached: no element, so nothing can be drawn on this tick.
        layer.setEdges([route()]);

        expect(layer._drawn).toHaveLength(0);
        expect(deferred).toHaveBeenCalledTimes(1);

        // Running the deferred callback (what the first connected layout does)
        // draws the routes that were handed over while detached.
        layer.getElement(true);
        (deferred.mock.calls[0][0] as () => void)();

        expect(layer._drawn).toHaveLength(1);
        expect(edgePathAttrs()).toBeDefined();
    });

    it('draws synchronously when the element already exists', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);

        const deferred = vi.spyOn(layer, 'onFirstLayout');

        layer.setEdges([route()]);

        expect(deferred).not.toHaveBeenCalled();
        expect(layer._drawn).toHaveLength(1);
    });
});

describe('DiagramEdgeLayer — invisible hit paths', () => {
    it('draws a second, invisible, wide-stroke path per edge, sharing the visible one\'s `d`', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([route()]);

        const visible = edgePathAttrs()!;
        const hit = hitPathAttrs()!;

        expect(hit.stroke).toBe('transparent');
        expect(hit['stroke-width']).toBe('12');
        expect(hit['pointer-events']).toBe('stroke');
        expect(hit.fill).toBe('none');
        expect(hit.cursor).toBe('inherit');
        expect(hit.d).toBe(visible.d);
    });

    it('a fresh layer\'s own cursor is "inherit", so the hit path\'s inherited cursor resolves to the ' +
       'viewport\'s live grab/grabbing rather than the Component default', () => {
        const layer = new DiagramEdgeLayer() as any;

        expect(layer.getCursor()).toBe('inherit');
    });

    it('appends the hit path before the visible path', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        sink.writes.length = 0;

        layer.setEdges([route()]);

        // Both paths are created then `apply`-ed with their attrs before either
        // is appended, so the write order that actually proves append order is
        // the `apply` write carrying `stroke-width` (unique to an edge path,
        // never a marker child) — the hit path's apply precedes the visible
        // path's apply, and DiagramEdgeLayer appends immediately after each.
        const strokeWidthWrites = sink.writes.filter(
            (w) => w.op === 'apply' && (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.['stroke-width'] !== undefined,
        );

        expect(strokeWidthWrites).toHaveLength(2);
        expect((strokeWidthWrites[0].args[1] as { setAttr: Record<string, string> }).setAttr.stroke).toBe('transparent');
        expect((strokeWidthWrites[1].args[1] as { setAttr: Record<string, string> }).setAttr.stroke).not.toBe('transparent');

        const appendOrder = sink.writes
            .filter((w) => w.op === 'appendChild' || (w.op === 'apply' && (w.args[1] as { setAttr?: Record<string, string> }).setAttr?.['stroke-width'] !== undefined))
            .map((w) => w.op);

        // apply(hit) precedes appendChild(hit) precedes apply(visible) precedes appendChild(visible).
        expect(appendOrder).toEqual(['apply', 'appendChild', 'apply', 'appendChild']);
    });

    it('draws no marker-end, marker-start, or stroke-dasharray on the hit path, whatever the route style', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([route({ style: { startMarker: 'oneOrMany', endMarker: 'one', dashed: true } })]);

        const hit = hitPathAttrs()!;

        expect(hit['marker-end']).toBeUndefined();
        expect(hit['marker-start']).toBeUndefined();
        expect(hit['stroke-dasharray']).toBeUndefined();
    });

    it('creates neither path for a route whose sections produce an empty `d`', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        sink.writes.length = 0;

        layer.setEdges([{ id: 'empty', sections: [] }]);

        const created = sink.writes.filter((w) => w.op === 'createElementNS' && w.args[1] === 'path');
        expect(created).toHaveLength(0);
    });

    it('a second setEdges releases both paths of each previous edge', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([route({ id: 'e1' }), route({ id: 'e2' })]);

        sink.writes.length = 0;

        layer.setEdges([]);

        const removed = sink.writes.filter((w) => w.op === 'removeChild');
        expect(removed).toHaveLength(4);
    });
});

describe('DiagramEdgeLayer — edgeIdAt', () => {
    it('resolves the hit handle to the edge id, the visible handle and unrelated targets to null', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([route({ id: 'e1' })]);

        const hitHandle = layer._drawn[0].hit;
        const visibleHandle = layer._drawn[0].path;
        const otherHandle = DOM.sink.createElementNS('http://www.w3.org/2000/svg', 'path');

        expect(layer.edgeIdAt(makeEvent(hitHandle, 'mousemove').target)).toBe('e1');
        expect(layer.edgeIdAt(makeEvent(visibleHandle, 'mousemove').target)).toBeNull();
        expect(layer.edgeIdAt(makeEvent(otherHandle, 'mousemove').target)).toBeNull();
        expect(layer.edgeIdAt(null)).toBeNull();
    });
});

describe('DiagramEdgeLayer — edgesNear', () => {
    /** A shared trunk (0,0)->(100,0) that splits at x=100 into e2's leg down to (100,100). */
    function trunkAndSplit(): DiagramEdgeRoute[] {
        return [
            { id: 'e1', sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 100, y: 0 } }] },
            {
                id: 'e2',
                sections: [{
                    startPoint: { x: 0, y: 0 },
                    bendPoints: [{ x: 100, y: 0 }],
                    endPoint: { x: 100, y: 100 },
                }],
            },
        ];
    }

    it('returns every route within tolerance, in draw order, on the shared trunk', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges(trunkAndSplit());

        expect(layer.edgesNear(50, 0).map((r: DiagramEdgeRoute) => r.id)).toEqual(['e1', 'e2']);
    });

    it('still returns both within the 6px tolerance', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges(trunkAndSplit());

        expect(layer.edgesNear(50, 5).map((r: DiagramEdgeRoute) => r.id)).toEqual(['e1', 'e2']);
    });

    it('returns nothing outside tolerance', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges(trunkAndSplit());

        expect(layer.edgesNear(50, 20)).toEqual([]);
    });

    it('past the split, only the branching edge answers', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges(trunkAndSplit());

        expect(layer.edgesNear(100, 60).map((r: DiagramEdgeRoute) => r.id)).toEqual(['e2']);
    });

    it('never returns a route with no sections', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([{ id: 'none', sections: [] }, ...trunkAndSplit()]);

        expect(layer.edgesNear(50, 0).map((r: DiagramEdgeRoute) => r.id)).not.toContain('none');
    });
});

describe('DiagramEdgeLayer — emphasis', () => {
    function twoEdges(): DiagramEdgeRoute[] {
        return [route({ id: 'e1' }), route({ id: 'e2' })];
    }

    /** The most recent `setAttr` payload written to a handle, or null when it never was. */
    function lastSetAttr(handle: unknown): Record<string, string> | null {
        const write = [...sink.writes].reverse().find((w) => w.op === 'apply' && w.args[0] === handle);

        return write ? (write.args[1] as { setAttr: Record<string, string> }).setAttr : null;
    }

    it('the dimmed group carries the reduced opacity and the full-strength group carries none', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);

        expect(lastSetAttr(layer._dimLayer)?.opacity).toBe('0.15');
        expect(lastSetAttr(layer._normalLayer)).toBeNull();
    });

    it('paints the dimmed group before the full-strength one, so an emphasised edge draws over a dimmed crossing', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);

        const appends = sink.writes.filter((w) => w.op === 'appendChild');
        const dimIndex    = appends.findIndex((w) => w.args[1] === layer._dimLayer);
        const normalIndex = appends.findIndex((w) => w.args[1] === layer._normalLayer);

        expect(dimIndex).toBeGreaterThanOrEqual(0);
        expect(normalIndex).toBeGreaterThan(dimIndex);
    });

    it('puts an edge outside the set in the dimmed group and the emphasised one in the full-strength group', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges(twoEdges());

        layer.setEdgeEmphasis(['e1']);

        expect(layer._drawn[0].group).toBe(layer._normalLayer);
        expect(layer._drawn[1].group).toBe(layer._dimLayer);
    });

    // The bug this grouping exists to fix: routes overlap by design (a fan-in or
    // fan-out bundle shares its junction stub), and per-element alpha composites
    // at every overlap, so two dimmed paths at 0.15 resolved to 0.28 and read as
    // emphasised exactly where the bundle was densest.
    it('writes no opacity of its own on any visible path, hit path, or label', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([route({ id: 'e1' }), route({ id: 'e2', style: { label: 'FK' } })]);
        layer.setEdgeEmphasis(['e1']);

        for (const drawn of layer._drawn) {
            expect(lastSetAttr(drawn.path)).not.toHaveProperty('opacity');
            expect(lastSetAttr(drawn.hit)).not.toHaveProperty('opacity');

            if (drawn.label) {
                expect(lastSetAttr(drawn.label)).not.toHaveProperty('opacity');
            }
        }
    });

    it('keeps an edge\'s hit path and label in the same group as its visible path', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([route({ id: 'e1' }), route({ id: 'e2', style: { label: 'FK' } })]);
        layer.setEdgeEmphasis(['e1']);

        const dimmed  = layer._drawn[1];
        const appends = sink.writes.filter((w) => w.op === 'appendChild');
        const parentOf = (handle: unknown) => [...appends].reverse().find((w) => w.args[1] === handle)?.args[0];

        expect(dimmed.group).toBe(layer._dimLayer);
        expect(parentOf(dimmed.path)).toBe(layer._dimLayer);
        expect(parentOf(dimmed.hit)).toBe(layer._dimLayer);
        expect(parentOf(dimmed.label)).toBe(layer._dimLayer);
    });

    it('setEdgeEmphasis(null) and setEdgeEmphasis([]) both return every edge to the full-strength group', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges(twoEdges());

        layer.setEdgeEmphasis(['e1']);
        layer.setEdgeEmphasis(null);
        expect(layer._drawn.map((d: any) => d.group)).toEqual([layer._normalLayer, layer._normalLayer]);

        layer.setEdgeEmphasis(['e1']);
        layer.setEdgeEmphasis([]);
        expect(layer._drawn.map((d: any) => d.group)).toEqual([layer._normalLayer, layer._normalLayer]);
    });

    it('getEdgeEmphasis reflects the set and the clear', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges(twoEdges());

        layer.setEdgeEmphasis(['e1']);
        expect(layer.getEdgeEmphasis()).toEqual(['e1']);

        layer.setEdgeEmphasis(null);
        expect(layer.getEdgeEmphasis()).toEqual([]);
    });

    it('an emphasis set naming an unknown id dims every drawn edge without throwing', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges(twoEdges());

        expect(() => layer.setEdgeEmphasis(['nope'])).not.toThrow();

        expect(layer._drawn.map((d: any) => d.group)).toEqual([layer._dimLayer, layer._dimLayer]);
    });

    it('setEdges clears the emphasis and redraws every edge into the full-strength group', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges(twoEdges());
        layer.setEdgeEmphasis(['e1']);

        layer.setEdges(twoEdges());

        expect(layer.getEdgeEmphasis()).toEqual([]);
        expect(layer._drawn.map((d: any) => d.group)).toEqual([layer._normalLayer, layer._normalLayer]);
    });

    // Spies on the sink rather than reading `sink.writes`, because the recording
    // sink logs `removeChild` without its arguments — so the parent a handle was
    // detached from is only observable here.
    it('releases a dimmed edge from the group it was actually appended into', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges(twoEdges());
        layer.setEdgeEmphasis(['e1']);

        const dimmedPath = layer._drawn[1].path;
        const removeChild = vi.spyOn(DOM.sink, 'removeChild');

        layer.setEdgeEmphasis(null);

        const call = removeChild.mock.calls.find((args) => args[1] === dimmedPath)!;

        expect(call).toBeDefined();
        expect(call[0]).toBe(layer._dimLayer);
    });

    it('an emphasis set before the element exists survives the first render', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.setEdges(twoEdges());
        layer.setEdgeEmphasis(['e1']);

        layer.getElement(true);

        expect(layer._drawn[0].group).toBe(layer._normalLayer);
        expect(layer._drawn[1].group).toBe(layer._dimLayer);
    });
});

describe('DiagramEdgeLayer — viewport culling', () => {
    const ADMIT_NEAR:    DiagramRect = { x: -500,  y: -500,  width: 2000,  height: 2000 };
    const ADMIT_BOTH:    DiagramRect = { x: -1000, y: -1000, width: 42000, height: 2000 };
    const ADMIT_NEITHER: DiagramRect = { x: 5000,  y: 5000,  width: 100,   height: 100 };

    function nearRoute(): DiagramEdgeRoute {
        return { id: 'e1', sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 10 } }] };
    }

    function farRoute(): DiagramEdgeRoute {
        return { id: 'far', sections: [{ startPoint: { x: 40000, y: 0 }, endPoint: { x: 40010, y: 10 } }] };
    }

    it('draws every edge when never given a residency rect', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([nearRoute(), farRoute()]);

        expect(layer._drawn.map((d: any) => d.id)).toEqual(['e1', 'far']);
    });

    it('a rect admitting one of two edges draws only that one', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([nearRoute(), farRoute()]);

        layer.setResidency(ADMIT_NEAR);

        expect(layer._drawn.map((d: any) => d.id)).toEqual(['e1']);
    });

    it('moving the rect draws what enters without touching what stayed', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([nearRoute(), farRoute()]);
        layer.setResidency(ADMIT_NEAR);

        sink.writes.length = 0;

        layer.setResidency(ADMIT_BOTH);

        const created = sink.writes.filter((w) => w.op === 'createElementNS' && w.args[1] === 'path');
        const removed = sink.writes.filter((w) => w.op === 'removeChild');

        expect(created).toHaveLength(2);
        expect(removed).toHaveLength(0);
        expect(layer._drawn.map((d: any) => d.id)).toEqual(['e1', 'far']);
    });

    it('moving the rect away releases what leaves', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([nearRoute(), farRoute()]);
        layer.setResidency(ADMIT_BOTH);

        sink.writes.length = 0;

        layer.setResidency(ADMIT_NEITHER);

        const removed = sink.writes.filter((w) => w.op === 'removeChild');

        expect(removed).toHaveLength(4);
        expect(layer._drawn).toEqual([]);
    });

    it('setResidency(null) re-admits everything, drawing every edge not currently drawn', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([nearRoute(), farRoute()]);
        layer.setResidency(ADMIT_NEAR);

        layer.setResidency(null);

        expect(layer._drawn.map((d: any) => d.id)).toEqual(['e1', 'far']);
        expect(layer._residentIds).toBeNull();
    });

    it('setEdges re-derives against the standing residency rect', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setResidency(ADMIT_NEAR);

        layer.setEdges([nearRoute(), farRoute()]);

        expect(layer._drawn.map((d: any) => d.id)).toEqual(['e1']);
    });

    it('an edge with no sections is never drawn, whatever the rect, and neither call throws for it', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);

        expect(() => layer.setEdges([{ id: 'empty', sections: [] }, nearRoute()])).not.toThrow();
        expect(() => layer.setResidency(ADMIT_NEITHER)).not.toThrow();

        expect(layer._drawn.map((d: any) => d.id)).not.toContain('empty');
    });

    it('a rect set before the element exists draws nothing then, and the deferred first draw honours it', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.setEdges([nearRoute(), farRoute()]);
        layer.setResidency(ADMIT_NEAR);

        expect(layer._drawn).toHaveLength(0);

        layer.getElement(true);

        expect(layer._drawn.map((d: any) => d.id)).toEqual(['e1']);
    });

    it('edgesNear reports only drawn edges: a point on a culled edge\'s route returns an empty array', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([nearRoute(), farRoute()]);
        layer.setResidency(ADMIT_NEAR);

        expect(layer.edgesNear(40005, 5)).toEqual([]);
    });

    it('edgeIdAt cannot answer for a culled edge — its hit path no longer exists', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([nearRoute(), farRoute()]);

        const farHit = layer._drawn.find((d: any) => d.id === 'far').hit;

        layer.setResidency(ADMIT_NEAR);

        expect(layer.edgeIdAt(makeEvent(farHit, 'mousemove').target)).toBeNull();
    });

    it('emphasis survives a cull round trip', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([nearRoute(), farRoute()]);

        layer.setEdgeEmphasis(['far']);
        layer.setResidency(ADMIT_NEAR);

        expect(layer.getEdgeEmphasis()).toEqual(['far']);

        layer.setResidency(ADMIT_BOTH);

        const drawnFar = layer._drawn.find((d: any) => d.id === 'far');
        const drawnE1  = layer._drawn.find((d: any) => d.id === 'e1');

        expect(drawnFar.group).toBe(layer._normalLayer);
        expect(drawnE1.group).toBe(layer._dimLayer);
    });

    it('emphasis applied while culled reaches the drawn set', () => {
        const layer = new DiagramEdgeLayer() as any;

        layer.getElement(true);
        layer.setEdges([nearRoute(), farRoute()]);
        layer.setResidency(ADMIT_NEAR);

        expect(() => layer.setEdgeEmphasis(['far'])).not.toThrow();

        const drawnE1 = layer._drawn.find((d: any) => d.id === 'e1');

        expect(drawnE1.group).toBe(layer._dimLayer);
    });
});

describe('EDGE_MARKER_EXTENT', () => {
    // Derived from the marker table, so widening any marker moves it. The literal
    // pins today's widest ("zero or many", 18 units) — a failure here means a
    // marker changed size and every consumer keeping clear of the glyph, notably
    // SQLAdmin's junction stubs, now has a different floor to respect.
    it('is the widest marker\'s reach back along the edge', () => {
        expect(EDGE_MARKER_EXTENT).toBe(18);
    });
});
