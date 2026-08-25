// Offline coverage for plans/implemented/table-auto-size-column-resample.md's
// `## Expected Behaviour` case 5: "a burst coalesces into one pass" — five
// store mutations dispatched within one tick must not each run their own
// `doLayout()`; the framework's rAF-coalesced layout queue must fold them
// into a single pass.
//
// This lives in its own file rather than alongside its sibling cases in
// ColumnWidths.test.ts because proving it needs a genuinely clean
// `Component.ts` module-level rAF-queue singleton (`rafHandle`): the offline
// `requestAnimationFrame` (tests/dom/TestDOM.ts) permanently drops whatever
// callback it is given, so the only way that singleton is ever reset back to
// `null` is by a test capturing the real callback via a spy and actually
// invoking it — never by `Component.flushLayout()`'s synchronous escape
// hatch, which bypasses the queue entirely and cannot exercise or observe the
// coalescing. `ColumnWidths.test.ts` has dozens of pre-existing cases that
// trigger `scheduleLayout()` (any autoSizeColumns table reacting to a store
// event) and settle via `flushLayout()` without ever draining a captured
// frame — the first such case to run permanently starves the singleton for
// the rest of that file, so no later test in it can reliably observe a fresh
// rAF call again. Mirroring ColumnResize.test.ts's own "layout coalescing"
// cases (30/31): a file-wide `beforeEach` installs the spy before anything
// else runs, and `afterEach` always drains before restoring, so this file's
// own tests never leave the singleton poisoned for each other either.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ColumnSpec } from '~/component/table/ColumnConfig';

const fontMetrics = {
    fonts: {
        'ColumnAutoSizeCoalescingTestFont': {
            ascent:  13,
            descent: 3,
            capTop:  10,
            advance: { ' ': 10 },
        },
    },
};

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let frames: Array<FrameRequestCallback>;

beforeEach(() => {
    installTestDOM(CONFIG);
    frames = [];
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);

        return frames.length;
    });
});

// Drain any frame a test left pending so the module-level rafHandle resets to
// null (flushPendingLayouts clears it) — otherwise a test that schedules but
// never flushes would block the next test's frame from being captured.
afterEach(() => { flushFrame(); vi.restoreAllMocks(); DOM.reset(); });

/** Invokes every animation-frame callback captured since the last flush (the layout pass). */
function flushFrame(): void {
    const pending = frames;
    frames = [];

    for (const cb of pending) {
        cb(0);
    }
}

describe('Auto-size re-sampling — layout coalescing', () => {
    it('5. a burst of mutations coalesces into one layout pass', async () => {
        const model = new Model([{ name: 'name', type: 'string', order: 0 }]);
        const spec: ColumnSpec = { columns: [{ field: 'name' }], autoSizeColumns: true };
        const store = new MemoryStore(model, [{ name: 'short' }]);

        await store.load();

        const table = new Table(store, spec);

        table.getElement(true);
        table.setWidth(300);
        table.setHeight(200);
        table.doLayout();

        flushFrame();   // drain whatever construction/the first layout queued

        const layoutSpy = vi.spyOn(table, 'doLayout');

        store.add([{ name: 'a' }]);
        store.add([{ name: 'b' }]);
        store.add([{ name: 'c' }]);
        store.add([{ name: 'd' }]);
        store.add([{ name: 'e' }]);

        expect(layoutSpy).not.toHaveBeenCalled();   // nothing ran synchronously

        // Two frames are genuinely scheduled here, not one: a `store.add()`
        // also schedules Component.ts's separate effective-visibility queue
        // (unrelated to this plan), which shares this same rAF sink. Draining
        // both is what proves the *layout* queue specifically coalesced the
        // five mutations into a single `doLayout()` call.
        flushFrame();

        expect(layoutSpy).toHaveBeenCalledTimes(1);   // one pass absorbs all five

        layoutSpy.mockRestore();
    });
});
