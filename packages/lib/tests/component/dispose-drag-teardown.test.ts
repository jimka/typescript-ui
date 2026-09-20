// Registry test enforcing that disposing a component unregisters every drag
// source / drop target it handed to `DragManager`. Mirrors
// tests/component/dispose-listener-teardown.test.ts's REGISTRY / collectIds
// shape, swapping the listener-registration inventory for the drag-registration
// inventory `DragManager._registeredComponentIds()` exposes.
//
// `makeDragSource` / `makeDropTarget` hand the caller a teardown closure and
// keep the component in a process-wide map until that closure runs. A caller
// that discards the closure therefore pins its whole subtree for the life of
// the page — the leak this registry exists to catch. The maps are module-level
// with no reset hook (`DOM.reset()` does not touch them, and they survive
// between tests in this file), so every assertion below is "none of *my*
// snapshotted ids survive", never "the registry is empty".
//
// Which classes this registry must cover is derived from the library source
// at run time via `classesRegisteringDragTargets()` (see
// `../helpers/libraryClassScan.mjs`), not hand-counted: every row declares
// which scanned classes it is evidence for via `covers`, and
// `UNCLAIMED_DRAG_TEARDOWN_CLASSES` is a shrink-only baseline of the classes no
// row covers yet. A class gaining its first `DragManager.makeDragSource(` /
// `makeDropTarget(` call with neither a covering row nor a baseline entry fails
// the coverage assertion below.
import { describe, it, expect } from 'vitest';
import { Component } from '~/core/Component';
import { Dock } from '~/overlay/Dock';
import { Window } from '~/overlay/Window';
import { TabBar } from '~/component/container/TabBar';
import { TreeBody } from '~/component/table/TreeBody';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { DragManager } from '~/overlay/DragManager';
import { classesRegisteringDragTargets } from '../helpers/libraryClassScan.mjs';

/**
 * Recursively collects a component's own id plus every registered
 * descendant's id (via `getComponents()`).
 */
function collectIds(c: Component): string[] {
    const ids = [c.getId()];

    for (const child of c.getComponents()) {
        ids.push(...collectIds(child));
    }

    return ids;
}

const TREE_MODEL = new Model([
    { name: 'id',     type: 'number', order: 0 },
    { name: 'parent', type: 'number', order: 1 },
    { name: 'name',   type: 'string', order: 2 },
], 'id');

const TREE_SPEC = { idField: 'id', parentField: 'parent', treeColumn: 'name', indentPx: 16 };

const REGISTRY: Array<{
    name: string;
    /** Source classes this row is the registry's evidence for. */
    covers?: string[];
    make: () => Component;
    /** Overrides `collectIds(c)` when the registered component is raw-appended rather than a registered child. */
    ids?: (c: Component) => string[];
}> = [
    {
        // The dock registers *itself* as the empty-state drop target, so its own
        // id is the one to watch — no extra subtree needed.
        //
        // The sweep is forced rather than awaited: it is scheduled through
        // `requestAnimationFrame`, which the offline sink records without ever
        // firing, so a dock left to schedule it has no wired region at all.
        // Driving it directly (the idiom tests/overlay/Dock.lifecycle.test.ts
        // already uses) gives the destructor real `DockRegion`s to tear down,
        // which is what makes the baseline entry below a claim this row backs.
        name:   'Dock',
        covers: ['Dock'],
        make: () => {
            const dock = new Dock();

            dock.getElement(true);
            dock.setWidth(800);
            dock.setHeight(600);
            (dock as unknown as { runSweep(): void }).runSweep();

            return dock;
        },
    },
    {
        // The registration is keyed by the header's id, and the header is a
        // registered child, so `collectIds` reaches it. Never `show()`: that
        // enters `AbstractWindow.openWindows` and arms entrance-animation
        // fallback timers that would outlive this test. `wireMoveTrigger` runs
        // from the constructor's `initChrome`, so the registration is present
        // without showing.
        name:   'Window',
        covers: ['Window'],
        make: () => {
            const win = new Window('W');

            win.getElement(true);

            return win;
        },
    },
    {
        // Two registrations per pool row (a drag source and a drop target) plus
        // one on the body itself for the empty area below the last row.
        // `setReparentHandlers` must precede the render: `init` only wires the
        // empty-area target once a reparent handler exists.
        name:   'TreeBody',
        covers: ['TreeBody'],
        make: () => {
            const store = new MemoryStore(TREE_MODEL, []);

            store.loadData([
                { id: 1, parent: null, name: 'a' },
                { id: 2, parent: null, name: 'b' },
            ]);

            const body = new TreeBody(store, TREE_SPEC);

            body.setReparentHandlers(() => true, () => true);
            body.getElement(true);
            body.setWidth(400);
            body.setHeight(200);
            body.renderWindow(400, [100, 100, 100]);

            return body;
        },
        // The pooled rows carry the per-row registrations but are raw-appended
        // to the rows container and kept only in the pool, so `getComponents()`
        // never returns them — reach them through the protected pool accessor,
        // the same cast idiom the sibling registries use for a private field.
        ids: (c) => {
            const pool = (c as unknown as { getRowPool(): Component[] }).getRowPool();

            return [...collectIds(c), ...pool.map((row) => row.getId())];
        },
    },
    {
        // The control row: `TabBar` already stores both its teardowns in
        // `_dndTeardowns` and sweeps them from `destructor()`, so this row
        // passes before the fixes above land. It is what shows the other three
        // rows are not asserting something trivially true.
        //
        // Render before adding the entry: `init` installs the strip-wide drop
        // target, and `createBarEntry` then wires the new tab's own drag source
        // because the bar is already rendered.
        name:   'TabBar',
        covers: ['TabBar'],
        make: () => {
            const bar = new TabBar({ reorderable: true });

            bar.getElement(true);
            bar.createBarEntry('a', 'Alpha');

            return bar;
        },
        // The drop target is registered on `_tabClip`, which is appended
        // straight to the strip element rather than registered via
        // `addComponent`, so it is unreachable from `collectIds(bar)` alone;
        // adding the clip's own ids is what covers it. The per-tab drag source
        // stays outside this snapshot either way: the clip holds its buttons
        // through `getItems()` rather than as registered children, so
        // `collectIds` cannot reach them. `dispose()` does unregister that
        // source, but no row here asserts it.
        ids: (c) => {
            const clip = (c as unknown as { _tabClip: Component })._tabClip;

            return [...collectIds(c), ...collectIds(clip)];
        },
    },
];

/**
 * Classes `classesRegisteringDragTargets()` finds today with no `covers` row.
 * Entries come out as rows are added; an entry only goes in as a deliberate,
 * commented deferral — never to make a newly-failing assertion pass again.
 *
 * `DockRegion` is not a `Component` at all, so it can own no `destructor()`
 * and can hold no row here. It keeps its drop-target teardown in a field and
 * runs it from its own plain `destroy()`, which `Dock.destructor()` calls for
 * every wired region — a teardown path the `Dock` row above already exercises.
 */
const UNCLAIMED_DRAG_TEARDOWN_CLASSES: readonly string[] = [
    'DockRegion',
];

describe('dispose-drag-teardown registry: every dispose() purges its DragManager registrations', () => {
    for (const { name, make, ids } of REGISTRY) {
        it(name, () => {
            const c = make();
            const snapshotIds = ids ? ids(c) : collectIds(c);

            // Pin the positive direction before the purge, the way
            // tests/unit/core/Event.test.ts does for `Event`'s copy of this
            // accessor. Without it the assertion below is trivially true for a
            // row that registers nothing — and for an accessor that lost one
            // of its two maps, since the id watched here is a drag source's
            // for `Window` and a drop target's for `Dock`.
            const before = DragManager._registeredComponentIds();

            expect(snapshotIds.filter((id) => before.includes(id)).length).toBeGreaterThan(0);

            c.dispose();

            const registered = DragManager._registeredComponentIds();
            const leaked = snapshotIds.filter((id) => registered.includes(id));

            expect(leaked).toEqual([]);
        });
    }

    const claimed = new Set(REGISTRY.flatMap((row) => row.covers ?? []));
    const scanned = classesRegisteringDragTargets();
    const unclaimed = scanned.filter((name) => !claimed.has(name));

    it('every covers entry still registers a drag target', () => {
        expect([...claimed].filter((name) => !scanned.includes(name))).toEqual([]);
    });

    it('every class registering a drag target is claimed by a row or listed as unclaimed', () => {
        expect(unclaimed).toEqual([...UNCLAIMED_DRAG_TEARDOWN_CLASSES]);
    });
});
