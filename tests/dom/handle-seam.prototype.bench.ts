// @vitest-environment jsdom
//
// PROTOTYPE performance benchmarks. Quantifies the registry `Map.get` overhead
// the handle design adds, and shows that batching amortizes it. Run with:
//
//     npx vitest bench tests/dom/handle-seam.prototype.bench.ts
//
// Patches are pre-allocated at module scope so each benchmark measures resolve +
// write cost, NOT object allocation — the delta between runs is the handle
// resolve (`Map.get`) count, nothing else.
import { describe, bench } from 'vitest';
import { HandleRegistry, HandleSink, type ElementPatch } from '~/core/HandleSeam.prototype';

// Direct element — the floor. No handle, no registry, no Map.get.
const directEl = document.createElement('div');

// Handle path — one element behind the registry.
const reg  = new HandleRegistry();
const sink = new HandleSink(reg);
const h    = sink.createElement('div');

// A 5-property write mirroring a layout commit (left/top/width/height + position).
const batchedPatch = {
    style: { left: '1px', top: '2px', width: '3px', height: '4px', position: 'absolute' },
};

// The same five writes as five separate single-property patches — the un-batched
// path, where every write pays its own resolve.
const singlePatches: ElementPatch[] = [
    { style: { left:     '1px' } },
    { style: { top:      '2px' } },
    { style: { width:    '3px' } },
    { style: { height:   '4px' } },
    { style: { position: 'absolute' } },
];

describe('single-property write — per-op Map.get cost', () => {
    // WITHOUT Map.get: the element is held directly.
    bench('direct element (no Map.get)', () => {
        directEl.style.left = '1px';
    });

    // WITH Map.get: one resolve to reach the same element.
    bench('handle, batched apply (one Map.get)', () => {
        sink.apply(h, singlePatches[0]);
    });
});

describe('5-property layout write — batching amortizes Map.get', () => {
    // WITHOUT Map.get: five direct writes on a held element. The floor.
    bench('direct element (no handle, no Map.get)', () => {
        directEl.style.left     = '1px';
        directEl.style.top      = '2px';
        directEl.style.width    = '3px';
        directEl.style.height   = '4px';
        directEl.style.position = 'absolute';
    });

    // WITH Map.get, un-batched: five resolves for five writes.
    bench('handle, unbatched (five Map.gets)', () => {
        for (let i = 0; i < singlePatches.length; i += 1) {
            sink.apply(h, singlePatches[i]);
        }
    });

    // WITH Map.get, batched: one resolve for the same five writes.
    bench('handle, batched (one Map.get)', () => {
        sink.apply(h, batchedPatch);
    });
});
