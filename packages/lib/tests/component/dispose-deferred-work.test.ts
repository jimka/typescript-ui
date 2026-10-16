// Registry test enforcing that disposing a component at any step of work it
// deferred (a frame, a timer, a pending promise) leaves nothing behind: no
// throw, no console.error, no rejected promise, no frame or timer still
// scheduled. Each row builds a component and disposes it at every boundary of
// its deferred work through tests/helpers/disposeAtEveryBoundary.ts.
//
// Coverage is derived from `filesSchedulingDeferredWork()`: every library file
// that schedules deferred work needs a row that covers it or an entry in the
// baseline list below, which may only get shorter.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { Panel } from '~/core/Panel';
import { SpinButton } from '~/component/input/SpinButton';
import { Scrollbar } from '~/component/container/Scrollbar';
import { StatusBar } from '~/component/container/StatusBar';
import { Body } from '~/component/table/Body';
import { _Tree } from '~/component/tree/Tree';
import type { TreeNode } from '~/component/tree/TreeNode';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ModelRecord } from '~/data/ModelRecord';
import { _Dialog as Dialog } from '~/overlay/Dialog';
import type { DialogButtonConfig, DialogResult } from '~/overlay/Dialog';
import { Dock } from '~/overlay/Dock';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { disposeAtEveryBoundary, type DeferredWorkScenario } from '../helpers/disposeAtEveryBoundary';
import { filesSchedulingDeferredWork } from '../helpers/libraryClassScan.mjs';

const MODEL = new Model([
    { name: 'a', type: 'string', order: 0 },
    { name: 'b', type: 'string', order: 1 },
    { name: 'c', type: 'string', order: 2 },
], 'a');

/** `count` flat nodes with distinct labels. */
function nodes(count: number): TreeNode[] {
    return Array.from({ length: count }, (_, i) => ({ label: 'n' + i }));
}

/** A rendered 300 x 120 tree over `list`; 120 px shows about five rows. */
function tree(list: TreeNode[]): _Tree {
    const built = new _Tree();

    built.getElement(true);
    built.setWidth(300);
    built.setHeight(120);
    built.setNodes(list);

    return built;
}

/** A lazy node whose children arrive when the helper settles the promise. */
function lazy(label: string, load: () => Promise<TreeNode[]>): TreeNode {
    return { label, hasChildren: true, loadChildren: load } as TreeNode;
}

/** A wheel notch of 400 px downward on `component`'s own element. */
function wheel(component: Component): void {
    const element = component.getElement()!;

    DOM.sink.dispatchEvent(element, makeEvent(element, 'wheel', { deltaX: 0, deltaY: 400 }));
}

/** A primary-button press on `component`'s own element. */
function press(component: Component): void {
    const element = component.getElement(true)!;

    DOM.sink.dispatchEvent(element, makeEvent(element, 'mousedown', { button: 0 }));
}

interface ButtonRowPrivate {
    _configs: DialogButtonConfig[];
    handleClick(cfg: DialogButtonConfig, result: DialogResult): Promise<void>;
}

let loaderCalls = 0;
let pastedRecord: ModelRecord;

const REGISTRY: Array<{
    name: string;
    /** Source files this row is the registry's evidence for. */
    covers: string[];
    scenario: DeferredWorkScenario<any>;
}> = [
    {
        name:     'Tree: eased wheel scroll',
        covers:   ['core/SmoothScroller.ts', 'component/container/VirtualScroller.ts'],
        scenario: { make: () => tree(nodes(200)), arm: wheel },
    },
    {
        name:     'Tree: touch fling',
        covers:   ['component/container/VirtualScroller.ts'],
        scenario: {
            make: () => tree(nodes(200)),
            arm:  (component) => {
                const element = component.getElement()!;
                const touch = (type: string, y?: number): Event =>
                    Object.assign(makeEvent(element, type), { touches: y === undefined ? [] : [{ clientX: 10, clientY: y }] });

                DOM.sink.dispatchEvent(element, touch('touchstart', 100));
                vi.advanceTimersByTime(10);
                DOM.sink.dispatchEvent(element, touch('touchmove', 60));
                vi.advanceTimersByTime(10);
                DOM.sink.dispatchEvent(element, touch('touchmove', 10));
                vi.advanceTimersByTime(5);
                DOM.sink.dispatchEvent(element, touch('touchend'));
            },
        },
    },
    {
        name:     'Panel: eased wheel scroll of native overflow',
        covers:   ['core/Component.ts'],
        scenario: {
            make: () => {
                const panel: Panel = new Panel({ autoScroll: 'y' });

                panel.getElement(true);
                panel.setWidth(200);
                panel.setHeight(100);

                return panel;
            },
            arm: (component) => {
                // The modelled DOM reports no overflow, so give the panel 900 px to scroll.
                vi.spyOn(DOM.source, 'getScrollMetrics').mockImplementation(() => ({
                    scrollTop: 0, scrollLeft: 0, scrollWidth: 200, clientWidth: 200, scrollHeight: 1000, clientHeight: 100,
                }));
                wheel(component);
            },
        },
    },
    {
        name:     'SpinButton: press and hold',
        covers:   ['core/AutoRepeat.ts', 'component/input/SpinButton.ts'],
        scenario: {
            make: () => {
                const button = new SpinButton('▲');

                button.getElement(true);

                return button;
            },
            arm: press,
        },
    },
    {
        name:     'Scrollbar: press and hold an arrow',
        covers:   ['component/container/Scrollbar.ts'],
        scenario: {
            make: () => {
                const bar = new Scrollbar('vertical', { arrowsEnabled: true });

                bar.getElement(true);
                bar.setWidth(12);
                bar.setHeight(200);
                // Content past the viewport, scrolled to the top: the end arrow is enabled.
                bar.setMetrics(200, 1000, 0);

                return bar;
            },
            arm: (component) => press((component as unknown as { _arrowEnd: Component })._arrowEnd),
        },
    },
    {
        name:     'Tree: lazy expand',
        covers:   ['component/tree/Tree.ts'],
        scenario: {
            make: (control) => tree([...nodes(5), lazy('lazy', () => control.defer(nodes(30)))]),
            arm:  (component) => {
                const built = component as _Tree;
                const target = (built as unknown as { _nodes: TreeNode[] })._nodes[5];

                return built.expandNodeAsync(target);
            },
            snapshot: (component) => (component as unknown as { _flatRows: unknown[] })._flatRows.length,
            after:    (component, rows) => {
                expect((component as unknown as { _flatRows: unknown[] })._flatRows.length).toBe(rows);
            },
        },
    },
    {
        name:     'Tree: reveal that finds nothing',
        covers:   ['component/tree/Tree.ts'],
        scenario: {
            make: (control) => {
                loaderCalls = 0;

                const load = (): Promise<TreeNode[]> => {
                    loaderCalls++;

                    return control.defer([{ label: 'leaf' }]);
                };

                return tree([...nodes(3), lazy('first', load), lazy('second', load)]);
            },
            arm:      (component) => (component as _Tree).revealByPredicate(() => false),
            snapshot: () => loaderCalls,
            after:    (_component, calls) => {
                expect(loaderCalls).toBe(calls);
            },
        },
    },
    {
        name:     'Tree: reveal of a match far down',
        covers:   ['component/tree/Tree.ts'],
        scenario: {
            // 150 rows above the lazy node: revealing its child has to scroll.
            make: (control) => tree([...nodes(150), lazy('lazy', () => control.defer([{ label: 'match' }]))]),
            arm:  (component) => (component as _Tree).revealByPredicate((_data, node) => node.label === 'match'),
        },
    },
    {
        name:     'Table body: paste',
        covers:   ['component/table/Body.ts'],
        scenario: {
            make: async (control) => {
                const store = new MemoryStore(MODEL, [{ a: '1', b: '2', c: '3' }]);

                await store.load();
                vi.spyOn(DOM.source, 'readClipboardText').mockImplementation(() => control.defer('X\tY'));

                const body = new Body(store);

                body.getElement(true);
                pastedRecord = store.getAll()[0];

                const selection = body as unknown as { _rangeAnchor: unknown; _rangeFocus: unknown };

                selection._rangeAnchor = { record: pastedRecord, col: 1 };
                selection._rangeFocus  = { record: pastedRecord, col: 1 };

                return body;
            },
            arm:      (component) => (component as Body).pasteAtSelection(),
            snapshot: () => pastedRecord.get('b'),
            after:    (_component, before) => {
                expect(pastedRecord.get('b')).toBe(before);
            },
        },
    },
    {
        name:     'Dialog: async button guard',
        covers:   ['overlay/Dialog.ts'],
        scenario: {
            make: (control) => {
                const dialog = new Dialog({
                    title:   't',
                    message: 'm',
                    buttons: [{ text: 'Go', result: 'confirm', primary: true, onClick: () => control.defer(true) }],
                });

                void dialog.show();

                return dialog;
            },
            arm: (component) => {
                const row = (component as unknown as { _buttonRow: ButtonRowPrivate })._buttonRow;

                return row.handleClick(row._configs[0], 'confirm');
            },
        },
    },
    {
        // Passes on the base commit: both frames the dock leaves are inert.
        name:     'Dock: panel removed',
        covers:   ['overlay/Dock.ts'],
        scenario: {
            make: () => {
                const dock = new Dock();

                dock.getElement(true);
                dock.setWidth(800);
                dock.setHeight(600);
                dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
                dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
                dock.doLayout();

                return dock;
            },
            arm: (component) => {
                (component as Dock).removePanel('a');
            },
        },
    },
    {
        // Passes on the base commit: the destructor clears the timer.
        name:     'StatusBar: timed message',
        covers:   ['component/container/StatusBar.ts'],
        scenario: {
            make: () => {
                const bar = new StatusBar();

                bar.getElement(true);

                return bar;
            },
            arm: (component) => {
                (component as StatusBar).setMessage('Saved', 500);
            },
        },
    },
];

/**
 * Files `filesSchedulingDeferredWork()` finds today with no `covers` row. Each
 * was read with its owner's teardown and judged safe; the verdicts are the
 * inventory in plans/implemented/deferred-work-after-dispose.md. Entries come
 * out as rows are added. An entry only goes in for a file whose deferred work
 * was read and found safe — never to make a failing assertion pass.
 */
const UNCLAIMED_DEFERRED_WORK_FILES: readonly string[] = [
    'component/container/MenuItem.ts',
    'component/container/TabBar.ts',
    'component/diagram/DiagramView.ts',
    'component/diagram/ElkLayoutEngine.ts',
    'component/display/AbstractCanvasSurface.ts',
    'component/display/Image.ts',
    'component/display/Markdown.ts',
    'component/editor/CodeEditor.ts',
    'component/editor/MarkdownDocumentPanel.ts',
    'component/editor/MarkdownEditor.ts',
    'component/editor/formatters/prettier.ts',
    'component/editor/formatters/sql.ts',
    'component/editor/languages.ts',
    'component/input/AbstractCalendarDropdown.ts',
    'component/input/AutoCompleteField.ts',
    'component/input/TextInput.ts',
    'component/shared/VirtualRowView.ts',
    'component/table/Header.ts',
    'component/table/Table.ts',
    'component/table/cell/Header.ts',
    'component/table/cell/editor/TextInputCellEditor.ts',
    'core/Animation.ts',
    'core/Body.ts',
    'core/DOM.ts',
    'core/PerFrameCoalescer.ts',
    'core/ResizeDrag.ts',
    'core/Theme.ts',
    'data/AbstractStore.ts',
    'data/StoreWorkerClient.ts',
    'data/TreeStore.ts',
    'data/proxy/AjaxProxy.ts',
    'diagnostics/DiagnosticsSampler.ts',
    'layout/CollapseSupport.ts',
    'layout/DockRegion.ts',
    'layout/Tab.ts',
    'overlay/AbstractWindow.ts',
    'overlay/DragManager.ts',
    'overlay/Notification.ts',
    'overlay/Tooltip.ts',
];

describe('dispose-deferred-work registry: a dispose at any boundary leaves nothing behind', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    for (const { name, scenario } of REGISTRY) {
        it(name, async () => {
            const result = await disposeAtEveryBoundary(scenario);

            expect(result.failures).toEqual([]);
        });
    }

    it('every file that schedules deferred work has a row or a baseline entry', () => {
        const claimed = new Set([...REGISTRY.flatMap((row) => row.covers), ...UNCLAIMED_DEFERRED_WORK_FILES]);
        const scanned = filesSchedulingDeferredWork();

        expect(scanned.filter((file) => !claimed.has(file))).toEqual([]);
    });

    it('every file a row covers still schedules deferred work', () => {
        const scanned = new Set(filesSchedulingDeferredWork());
        const stale = REGISTRY.flatMap((row) => row.covers).filter((file) => !scanned.has(file));

        expect(stale).toEqual([]);
    });

    it('the baseline lists no file that has a row or that no longer schedules work', () => {
        const covered = new Set(REGISTRY.flatMap((row) => row.covers));
        const scanned = new Set(filesSchedulingDeferredWork());

        expect(UNCLAIMED_DEFERRED_WORK_FILES.filter((file) => covered.has(file) || !scanned.has(file))).toEqual([]);
    });
});

describe('work that settles after a dispose or a dismissal', () => {
    beforeEach(() => {
        installTestDOM({
            rootMountOffset: { x: 0, y: 0 },
            viewport:        { width: 1280, height: 800 },
            scrollBarWidth:  15,
            fontMetrics,
            themeVars:       {},
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        DOM.reset();
    });

    /** Resolves the promise a scenario handed out once the test calls `release`. */
    function gate<T>(value: T): { promise: Promise<T>; release(): void } {
        let release: () => void = () => {};
        const promise = new Promise<T>((resolve) => {
            release = (): void => resolve(value);
        });

        return { promise, release };
    }

    it('Tree.revealByPredicate resolves null when the tree is disposed mid-walk', async () => {
        const load = gate<TreeNode[]>([{ label: 'match' }]);
        const built = tree([...nodes(3), lazy('lazy', () => load.promise)]);
        const walk = built.revealByPredicate((_data, node) => node.label === 'match');

        built.dispose();
        load.release();

        await expect(walk).resolves.toBeNull();
    });

    it('Tree.expandNodeAsync resolves false when the tree is disposed mid-load', async () => {
        const load = gate<TreeNode[]>(nodes(30));
        const built = tree([...nodes(5), lazy('lazy', () => load.promise)]);
        const target = (built as unknown as { _nodes: TreeNode[] })._nodes[5];
        const expansion = built.expandNodeAsync(target);

        built.dispose();
        load.release();

        await expect(expansion).resolves.toBe(false);
    });

    it('a dialog button guard that settles after the dispose does not hide the dialog', async () => {
        const guard = gate<boolean>(true);
        const dialog = new Dialog({
            title:   't',
            message: 'm',
            buttons: [{ text: 'Go', result: 'confirm', primary: true, onClick: () => guard.promise }],
        });
        const hide = vi.spyOn(dialog, 'hide');

        void dialog.show();

        const row = (dialog as unknown as { _buttonRow: ButtonRowPrivate })._buttonRow;
        const enable = vi.spyOn(row as unknown as { setButtonsEnabled(on: boolean): void }, 'setButtonsEnabled');
        const click = row.handleClick(row._configs[0], 'confirm');

        enable.mockClear();
        dialog.dispose();
        guard.release();
        await click;

        expect(hide).not.toHaveBeenCalled();
        // The destroyed row's buttons are left alone, not re-enabled.
        expect(enable).not.toHaveBeenCalled();
    });

    it('a dialog button guard that settles during the dismiss fade does not override the dismissal', async () => {
        vi.useFakeTimers();

        const guard = gate<boolean>(true);
        const dialog = new Dialog({
            title:   't',
            message: 'm',
            buttons: [{ text: 'Go', result: 'confirm', primary: true, onClick: () => guard.promise }],
        });
        const hide = vi.spyOn(dialog, 'hide');
        const shown = dialog.show();
        const row = (dialog as unknown as { _buttonRow: ButtonRowPrivate })._buttonRow;
        const click = row.handleClick(row._configs[0], 'confirm');

        // Escape, the title-bar close or a backdrop click while the guard is pending.
        dialog.hide('close');
        guard.release();
        await click;
        vi.advanceTimersByTime(2000);

        await expect(shown).resolves.toBe('close');
        expect(hide).toHaveBeenCalledTimes(1);
    });
});
