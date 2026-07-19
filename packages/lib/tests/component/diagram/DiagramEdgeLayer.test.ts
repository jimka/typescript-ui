import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { _DiagramEdgeLayer as DiagramEdgeLayer } from '~/component/diagram/DiagramEdgeLayer';
import type { DiagramEdgeRoute } from '~/component/diagram/DiagramEdgeLayer';
import { installTestDOM, type RecordingDOMSink } from '../../dom/TestDOM';
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

/** The `setAttr` payload for the single drawn `<path>` edge element (excludes marker/defs setup). */
function edgePathAttrs(): Record<string, string> | undefined {
    // Marker child shapes also set `d` (crow's-foot paths), so distinguish the
    // one actual edge `<path>` by its `stroke-width`, which only the edge path
    // sets — marker children never do.
    return attrWrites().find((a) => a.d !== undefined && a['stroke-width'] !== undefined);
}

function route(overrides: Partial<DiagramEdgeRoute> = {}): DiagramEdgeRoute {
    return {
        id:       'e',
        sections: [{ startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 10 } }],
        ...overrides,
    };
}

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
