import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { _DiagramNodeLayer as DiagramNodeLayer, DIMMED_NODE_OPACITY } from '~/component/diagram/DiagramNodeLayer';
import {
    DIAGRAM_NODE_BACKGROUND_COLOR,
    DIAGRAM_NODE_BORDER_COLOR,
    DIAGRAM_NODE_SELECTED_BACKGROUND_COLOR,
    DIAGRAM_NODE_SELECTED_BORDER_COLOR,
} from '~/component/diagram/DiagramNode';
import { DIAGRAM_GROUP_BACKGROUND_COLOR, DIAGRAM_GROUP_BORDER_COLOR } from '~/component/diagram/DiagramGroupNode';
import type { DiagramRect } from '~/component/diagram/DiagramResidency';
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
function setAttrWrites(): Record<string, string>[] {
    return sink.writes
        .filter((w) => w.op === 'apply' && (w.args[1] as { setAttr?: object }).setAttr !== undefined)
        .map((w) => (w.args[1] as { setAttr: Record<string, string> }).setAttr);
}

/** The most recent `apply` payload written to a handle, or null when it never was. */
function lastApply(handle: unknown): { setAttr?: Record<string, string>; removeAttr?: string[] } | null {
    const write = [...sink.writes].reverse().find((w) => w.op === 'apply' && w.args[0] === handle);

    return write ? (write.args[1] as { setAttr?: Record<string, string>; removeAttr?: string[] }) : null;
}

function rect(overrides: Partial<DiagramRect> = {}): DiagramRect {
    return { x: 0, y: 0, width: 160, height: 30, ...overrides };
}

function twoLeaves(): Map<string, DiagramRect> {
    return new Map([
        ['a', rect({ x: 0, y: 0 })],
        ['b', rect({ x: 200, y: 0 })],
    ]);
}

describe('DiagramNodeLayer — a fresh layer', () => {
    it('draws nothing and creates no rect children', () => {
        const layer = new DiagramNodeLayer() as any;

        layer.getElement(true);

        const created = sink.writes.filter((w) => w.op === 'createElementNS' && w.args[1] === 'rect');
        expect(created).toHaveLength(0);
        expect(layer._drawn.size).toBe(0);
    });

    it('the root is non-interactive and inherits the cursor, mirroring DiagramEdgeLayer', () => {
        const layer = new DiagramNodeLayer() as any;

        expect(layer.getPointerEvents()).toBe('none');
        expect(layer.getCursor()).toBe('inherit');
    });
});

describe('DiagramNodeLayer — setNodes draws rects', () => {
    it('draws one <rect> per leaf, carrying its box plus the resting node colours', () => {
        const layer = new DiagramNodeLayer() as any;

        layer.getElement(true);
        layer.setNodes(twoLeaves(), new Set());

        const attrs = setAttrWrites().filter((a) => a.rx !== undefined);
        expect(attrs).toHaveLength(2);

        expect(attrs[0]).toMatchObject({
            x: '0', y: '0', width: '160', height: '30',
            rx: '4', fill: DIAGRAM_NODE_BACKGROUND_COLOR, stroke: DIAGRAM_NODE_BORDER_COLOR,
            'stroke-width': '1',
        });
        expect(attrs[0].opacity).toBeUndefined();
    });

    it('draws containers before leaves, whatever order the rects map is in', () => {
        const layer = new DiagramNodeLayer() as any;
        const rects = new Map([
            ['a', rect({ x: 0 })],
            ['c', rect({ x: 400, width: 400, height: 300 })],
        ]);

        layer.getElement(true);
        sink.writes.length = 0;

        layer.setNodes(rects, new Set(['c']));

        expect([...layer._drawn.keys()]).toEqual(['c', 'a']);

        const appends = sink.writes.filter((w) => w.op === 'appendChild').map((w) => w.args[1]);
        expect(appends[0]).toBe(layer._drawn.get('c'));
        expect(appends[1]).toBe(layer._drawn.get('a'));
    });

    it('a container rect carries the group colours, not the leaf ones', () => {
        const layer = new DiagramNodeLayer() as any;

        layer.getElement(true);
        layer.setNodes(new Map([['c', rect({ width: 400, height: 300 })]]), new Set(['c']));

        const attrs = setAttrWrites().find((a) => a.rx !== undefined)!;

        expect(attrs.fill).toBe(DIAGRAM_GROUP_BACKGROUND_COLOR);
        expect(attrs.stroke).toBe(DIAGRAM_GROUP_BORDER_COLOR);
    });

    it('calling setNodes again with the identical two arguments issues no DOM write at all', () => {
        const layer = new DiagramNodeLayer() as any;
        const rects = twoLeaves();
        const containers = new Set<string>();

        layer.getElement(true);
        layer.setNodes(rects, containers);

        sink.writes.length = 0;

        layer.setNodes(rects, containers);

        expect(sink.writes).toHaveLength(0);
    });

    it('calling setNodes with a different map redraws: every previous rect is removed and released, the new set drawn', () => {
        const layer = new DiagramNodeLayer() as any;

        layer.getElement(true);
        layer.setNodes(twoLeaves(), new Set());

        const oldA = layer._drawn.get('a');
        sink.writes.length = 0;

        layer.setNodes(new Map([['c', rect()]]), new Set());

        const removed = sink.writes.filter((w) => w.op === 'removeChild');
        expect(removed).toHaveLength(2);

        expect([...layer._drawn.keys()]).toEqual(['c']);
        expect(layer._drawn.has('a')).toBe(false);
        expect(layer._ownedHandles).not.toContain(oldA);
    });

    it('setNodes with an empty map releases everything and leaves _drawn empty', () => {
        const layer = new DiagramNodeLayer() as any;

        layer.getElement(true);
        layer.setNodes(twoLeaves(), new Set());

        layer.setNodes(new Map(), new Set());

        expect(layer._drawn.size).toBe(0);
    });

    it('a setNodes before the element exists draws nothing then, and the deferred first draw honours it', () => {
        const layer = new DiagramNodeLayer() as any;
        const deferred = vi.spyOn(layer, 'onFirstLayout');

        layer.setNodes(twoLeaves(), new Set());

        expect(layer._drawn.size).toBe(0);
        expect(deferred).toHaveBeenCalledTimes(1);

        layer.getElement(true);
        (deferred.mock.calls[0][0] as () => void)();

        expect(layer._drawn.size).toBe(2);
    });
});

describe('DiagramNodeLayer — setSelected', () => {
    it('patches only the selected rect\'s colours, issuing no createElementNS', () => {
        const layer = new DiagramNodeLayer() as any;

        layer.getElement(true);
        layer.setNodes(twoLeaves(), new Set());

        const handleA = layer._drawn.get('a');
        sink.writes.length = 0;

        layer.setSelected('a');

        expect(sink.writes.filter((w) => w.op === 'createElementNS')).toHaveLength(0);

        const attrs = lastApply(handleA)!.setAttr!;
        expect(attrs.fill).toBe(DIAGRAM_NODE_SELECTED_BACKGROUND_COLOR);
        expect(attrs.stroke).toBe(DIAGRAM_NODE_SELECTED_BORDER_COLOR);
    });

    it('moving the selection patches the outgoing rect back to resting and the incoming one to selected — two patches, no more', () => {
        const layer = new DiagramNodeLayer() as any;

        layer.getElement(true);
        layer.setNodes(twoLeaves(), new Set());
        layer.setSelected('a');

        const handleA = layer._drawn.get('a');
        const handleB = layer._drawn.get('b');
        sink.writes.length = 0;

        layer.setSelected('b');

        const patched = sink.writes.filter((w) => w.op === 'apply');
        expect(patched).toHaveLength(2);

        expect(lastApply(handleA)!.setAttr!.fill).toBe(DIAGRAM_NODE_BACKGROUND_COLOR);
        expect(lastApply(handleB)!.setAttr!.fill).toBe(DIAGRAM_NODE_SELECTED_BACKGROUND_COLOR);
    });

    it('a container id never paints selected', () => {
        const layer = new DiagramNodeLayer() as any;

        layer.getElement(true);
        layer.setNodes(new Map([['c', rect({ width: 400, height: 300 })]]), new Set(['c']));

        layer.setSelected('c');

        const attrs = lastApply(layer._drawn.get('c'))!.setAttr!;
        expect(attrs.fill).toBe(DIAGRAM_GROUP_BACKGROUND_COLOR);
        expect(attrs.stroke).toBe(DIAGRAM_GROUP_BORDER_COLOR);
    });

    it('state applied before a draw survives it: setSelected then setNodes draws the node already selected', () => {
        const layer = new DiagramNodeLayer() as any;

        layer.setSelected('a');
        layer.getElement(true);
        layer.setNodes(twoLeaves(), new Set());

        const attrs = lastApply(layer._drawn.get('a'))!.setAttr!;
        expect(attrs.fill).toBe(DIAGRAM_NODE_SELECTED_BACKGROUND_COLOR);
    });
});

describe('DiagramNodeLayer — setEmphasis', () => {
    it('writes opacity="0.35" on every other rect and none on the emphasised one', () => {
        const layer = new DiagramNodeLayer() as any;

        layer.getElement(true);
        layer.setNodes(twoLeaves(), new Set());

        layer.setEmphasis(new Set(['a']));

        expect(lastApply(layer._drawn.get('a'))!.setAttr!.opacity).toBeUndefined();
        expect(lastApply(layer._drawn.get('b'))!.setAttr!.opacity).toBe(String(DIMMED_NODE_OPACITY));
    });

    it('setEmphasis(new Set()) removes the opacity attribute from every rect', () => {
        const layer = new DiagramNodeLayer() as any;

        layer.getElement(true);
        layer.setNodes(twoLeaves(), new Set());
        layer.setEmphasis(new Set(['a']));

        layer.setEmphasis(new Set());

        expect(lastApply(layer._drawn.get('b'))!.removeAttr).toContain('opacity');
        expect(lastApply(layer._drawn.get('b'))!.setAttr!.opacity).toBeUndefined();
    });

    it('a selected but unemphasised node draws the selected colours and the dimmed opacity', () => {
        const layer = new DiagramNodeLayer() as any;

        layer.getElement(true);
        layer.setNodes(twoLeaves(), new Set());
        layer.setSelected('a');

        layer.setEmphasis(new Set(['b']));

        const attrs = lastApply(layer._drawn.get('a'))!.setAttr!;
        expect(attrs.fill).toBe(DIAGRAM_NODE_SELECTED_BACKGROUND_COLOR);
        expect(attrs.opacity).toBe(String(DIMMED_NODE_OPACITY));
    });
});

describe('DiagramNodeLayer — disposal', () => {
    it('releases every drawn rect', () => {
        const layer = new DiagramNodeLayer() as any;

        layer.getElement(true);
        layer.setNodes(twoLeaves(), new Set());

        layer.dispose();

        expect(layer._ownedHandles).toHaveLength(0);
    });
});
