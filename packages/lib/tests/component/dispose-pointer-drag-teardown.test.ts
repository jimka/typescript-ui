// Registry test enforcing that disposing a component mid-gesture ends the
// pointer drag it armed. It differs from its sibling
// tests/component/dispose-drag-teardown.test.ts in what it watches: that one
// watches `DragManager`'s source / target maps, this one watches the document
// element's drag chrome — the `ts-ui-dragging` class and the pinned cursor
// `beginPointerDrag` writes onto `<html>`.
//
// The chrome arms the shared `html.ts-ui-dragging > * { pointer-events: none }`
// rule, so every direct child of `<html>` stops taking pointer events for the
// duration of the drag. Only the drag's own stop listener took it back off, and
// `Component.destructor()` purges that listener — so a component destroyed
// part-way through its gesture left the whole page unclickable behind a frozen
// cursor for the life of the session, with nothing clickable left that could
// clear it. Each row below arms one site's drag, disposes, and asserts the
// document element came clean.
//
// Which classes this registry must cover is derived from the library source at
// run time via `classesBeginningPointerDrags()` (see
// `../helpers/libraryClassScan.mjs`), not hand-counted: every row declares
// which scanned classes it is evidence for via `covers`, and
// `UNCLAIMED_POINTER_DRAG_CLASSES` is a shrink-only baseline of the classes no
// row covers yet. A class gaining its first `beginPointerDrag(` /
// `beginViewportDrag(` call with neither a covering row nor a baseline entry
// fails the coverage assertion below.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { Panel } from '~/core/Panel';
import { Scrollbar } from '~/component/container/Scrollbar';
import { SplitGutter } from '~/component/container/SplitGutter';
import { WindowBorder, Direction } from '~/component/container/WindowBorder';
import { HeaderCell } from '~/component/table/cell/Header';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { classesBeginningPointerDrags } from '../helpers/libraryClassScan.mjs';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const DRAGGING_CLASS = 'ts-ui-dragging';

/**
 * A primary-button press near the top-left of the viewport, the one event every
 * site's drag-start entry point needs. `stopPropagation` is a no-op stub for
 * `HeaderCell.onResizeDragStart`, which calls it.
 */
const PRESS = {
    button:          0,
    clientX:         40,
    clientY:         40,
    stopPropagation: (): void => {},
} as unknown as MouseEvent;

let sink: RecordingDOMSink;

beforeEach(() => {
    sink = installTestDOM(CONFIG);
});

afterEach(() => DOM.reset());

/**
 * The last `apply` patch written to the named element, or undefined when it was
 * never touched. Copied from tests/core/PointerDrag.test.ts rather than shared:
 * handles are minted per source call, so a recorded write is matched back to
 * its element by tag rather than by handle identity.
 *
 * @param tag - The upper-case tag name to look for ("HTML").
 */
function patchFor(tag: string): { addClass?: string[]; removeClass?: string[]; style?: Record<string, string> } | undefined {
    const match = sink.writes
        .filter(w => w.op === 'apply')
        .reverse()
        .find(w => DOM.source.getTagName(w.args[0] as Handle) === tag);

    return match?.args[1] as { addClass?: string[]; removeClass?: string[]; style?: Record<string, string> } | undefined;
}

/** Builds a rendered, movable gutter with its drag already armed. */
function armedGutter(): SplitGutter {
    const gutter = new SplitGutter('horizontal');

    gutter.getElement(true);
    gutter.onDragStart(PRESS);

    return gutter;
}

const REGISTRY: Array<{
    name: string;
    /** Source classes this row is the registry's evidence for. */
    covers?: string[];
    make: () => Component;
    /** Drives the class's own drag-start entry point, arming the chrome. */
    arm: (c: Component) => void;
    /** The cursor the site pins on `<html>` while its drag is armed. */
    cursor: string;
}> = [
    {
        name:   'SplitGutter',
        covers: ['SplitGutter'],
        make:   () => new SplitGutter('horizontal'),
        arm:    (c) => (c as SplitGutter).onDragStart(PRESS),
        cursor: 'ew-resize',
    },
    {
        name:   'WindowBorder',
        covers: ['WindowBorder'],
        make:   () => new WindowBorder(Direction.SOUTH),
        arm:    (c) => (c as WindowBorder).onDragStart(PRESS),
        cursor: 'ns-resize',
    },
    {
        // `_onDragStart` is a private arrow field; reaching a private driver
        // through a cast is the registries' established idiom.
        name:   'Scrollbar',
        covers: ['Scrollbar'],
        make:   () => new Scrollbar('vertical'),
        arm:    (c) => (c as unknown as { _onDragStart(e: MouseEvent): void })._onDragStart(PRESS),
        cursor: 'grabbing',
    },
    {
        // `onResizeDragStart` is a private method, reached by the same cast.
        name:   'HeaderCell',
        covers: ['HeaderCell'],
        make:   () => new HeaderCell('Name', 'name'),
        arm:    (c) => (c as unknown as { onResizeDragStart(e: MouseEvent): void }).onResizeDragStart(PRESS),
        cursor: 'var(--ts-ui-table-resize-handle-cursor, ew-resize)',
    },
];

/**
 * Classes `classesBeginningPointerDrags()` finds today with no `covers` row.
 * Empty because every scanned class has a row; an entry only ever goes in as a
 * deliberate, commented deferral — never to make a newly-failing assertion pass
 * again.
 */
const UNCLAIMED_POINTER_DRAG_CLASSES: readonly string[] = [];

describe('dispose-pointer-drag-teardown registry: every dispose() ends the pointer drag it armed', () => {
    for (const { name, make, arm, cursor } of REGISTRY) {
        it(name, () => {
            const c = make();

            c.getElement(true);
            arm(c);

            // Pin the positive direction before the dispose. Without it a row
            // whose `arm` silently failed to arm anything would pass for the
            // wrong reason, and the cursor is what proves it was *this* site's
            // drag that armed.
            const armed = patchFor('HTML');

            expect(armed?.addClass).toEqual([DRAGGING_CLASS]);
            expect(armed?.style).toEqual({ cursor });

            sink.writes.length = 0;

            c.dispose();

            const patch = patchFor('HTML');

            expect(patch?.removeClass).toEqual([DRAGGING_CLASS]);
            expect(patch?.style).toEqual({ cursor: '' });
        });
    }

    // The three cases below prove properties of the mechanism rather than of a
    // class, so they carry no `covers` and take part in no coverage assertion.

    it('an ancestor\'s dispose reaches it', () => {
        const panel  = new Panel();
        const gutter = new SplitGutter('horizontal');

        panel.addComponent(gutter);
        panel.getElement(true);
        gutter.getElement(true);
        gutter.onDragStart(PRESS);

        expect(patchFor('HTML')?.addClass).toEqual([DRAGGING_CLASS]);

        sink.writes.length = 0;

        // The panel, not the gutter: the hook is `destructor()`, which an
        // ancestor's own teardown reaches by recursion, so a gutter inside a
        // disposed `Split` is covered the same way.
        panel.dispose();

        const patch = patchFor('HTML');

        expect(patch?.removeClass).toEqual([DRAGGING_CLASS]);
        expect(patch?.style).toEqual({ cursor: '' });
    });

    it('the site\'s drag-stop callback does not run', () => {
        const gutter = armedGutter();

        let dragEnds = 0;

        gutter.on('dragend', () => { dragEnds++; });

        gutter.dispose();

        // Clearing the document element's chrome is the whole job. Running the
        // site's own drag-stop callback would have `Split` fire a `paneresize`
        // at the application *because* the gutter was destroyed.
        expect(dragEnds).toBe(0);
    });

    it('a second dispose writes nothing further', () => {
        const gutter = armedGutter();

        gutter.dispose();

        sink.writes.length = 0;

        gutter.dispose();

        expect(patchFor('HTML')).toBeUndefined();
    });

    const claimed = new Set(REGISTRY.flatMap((row) => row.covers ?? []));
    const scanned = classesBeginningPointerDrags();
    const unclaimed = scanned.filter((name) => !claimed.has(name));

    it('every covers entry still begins a pointer drag', () => {
        expect([...claimed].filter((name) => !scanned.includes(name))).toEqual([]);
    });

    it('every class beginning a pointer drag is claimed by a row or listed as unclaimed', () => {
        expect(unclaimed).toEqual([...UNCLAIMED_POINTER_DRAG_CLASSES]);
    });
});
