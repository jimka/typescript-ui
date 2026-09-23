// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pins the row-write and no-op-navigation halves of
// plans/implemented/list-and-tree-row-economy.md (`## Expected Behaviour`
// cases 1-8 and 10-14). Two contracts: a `SelectableListRow` toggles one
// class token per state that actually changed and writes nothing for a state
// it already shows, so one arrow key touches the two rows it moved between
// rather than every row in the list; and a navigation key that leaves the
// selection membership as it was fires no `change` / `action` at all.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _List } from '~/component/list/List';
import { _MultiSelectList } from '~/component/list/MultiSelectList';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** The list geometry every fixture here mounts at — wide enough that no row clips. */
const LIST_WIDTH  = 300;
/** Tall enough to show ~18 of the 22px rows, so the keys this file drives never scroll. */
const LIST_HEIGHT = 400;

/**
 * The slice of a pool row this suite reads. `SelectableListRow` is internal to
 * `AbstractSelectableList` and deliberately not exported, so the probe names
 * the members rather than the class.
 */
interface RowProbe {
    getId(): string;
    getElement(): Handle | undefined;
    isSelected(): boolean;
    isFocused(): boolean;
    isEnabled(): boolean;
    isStyleState(name: string): boolean;
    setSelected(value: boolean): unknown;
    setFocused(value: boolean): unknown;
    setEnabled(value: boolean): unknown;
}

/** Widens the protected row pool so a row's handle and cached state are reachable. */
class TestList extends _List {
    public row(index: number): RowProbe {
        return this._rowPool[index];
    }

    public rowCount(): number {
        return this._rowPool.length;
    }

    /** Widens the protected click dispatcher, as `List.test.ts`'s own harness does. */
    public rowClick(index: number, e: MouseEvent): void {
        this.handleRowClick(index, e);
    }
}

/** The `MultiSelectList` twin of {@link TestList}. */
class TestMultiSelectList extends _MultiSelectList {
    public row(index: number): RowProbe {
        return this._rowPool[index];
    }

    public rowCount(): number {
        return this._rowPool.length;
    }
}

/** A minimal KeyboardEvent-shaped object for the offline keyboard harness. */
function key(
    name: string,
    modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {},
): KeyboardEvent {
    return {
        key:      name,
        ctrlKey:  modifiers.ctrlKey  ?? false,
        metaKey:  modifiers.metaKey  ?? false,
        shiftKey: modifiers.shiftKey ?? false,
        altKey:   modifiers.altKey   ?? false,
        preventDefault() {},
        stopPropagation() {},
    } as unknown as KeyboardEvent;
}

type RecordedWrite = { op: string; args: unknown[] };

/**
 * The class tokens `handle` currently carries, folded from every `apply` write
 * recorded against it in order: a whole-attribute `setAttr.class` replaces the
 * set, `addClass` adds and `removeClass` deletes. Folding rather than reading
 * the last write is what lets the same assertions hold whether the row writes
 * its class as one attribute or as individual token toggles.
 */
function classTokens(sink: RecordingDOMSink, handle: Handle | undefined): Set<string> {
    const tokens = new Set<string>();

    for (const write of sink.writes) {
        if (write.op !== 'apply' || write.args[0] !== handle) {
            continue;
        }

        const patch = write.args[1] as {
            setAttr?:     Record<string, string>;
            addClass?:    string[];
            removeClass?: string[];
        };

        if (patch.setAttr?.class !== undefined) {
            tokens.clear();
            for (const token of patch.setAttr.class.split(' ')) {
                tokens.add(token);
            }
        }

        for (const token of patch.addClass ?? []) {
            tokens.add(token);
        }

        for (const token of patch.removeClass ?? []) {
            tokens.delete(token);
        }
    }

    return tokens;
}

/**
 * One line per recorded write, in the shorthand the plan's write tables use:
 * `<target> aria-selected=false` for an attribute, `<target> +selected` /
 * `<target> -focused` for a class-token toggle, and `dispatch change` for an
 * event. Any other op is rendered verbatim so an unexpected write shows up in
 * the diff instead of being filtered away.
 *
 * @param writes - The recorded writes to render.
 * @param label - Names a write's target handle, e.g. `row 5`.
 * @returns The rendered trace, in write order.
 */
function traceWrites(writes: RecordedWrite[], label: (handle: unknown) => string): string[] {
    const lines: string[] = [];

    for (const write of writes) {
        if (write.op === 'dispatchEvent') {
            lines.push('dispatch ' + String(write.args[0]));

            continue;
        }

        if (write.op !== 'apply') {
            lines.push(write.op + ' ' + label(write.args[0]));

            continue;
        }

        const target = label(write.args[0]);
        const patch  = write.args[1] as {
            setAttr?:     Record<string, string>;
            addClass?:    string[];
            removeClass?: string[];
            removeAttr?:  string[];
        };

        for (const [name, value] of Object.entries(patch.setAttr ?? {})) {
            lines.push(target + ' ' + name + '=' + value);
        }

        for (const token of patch.addClass ?? []) {
            lines.push(target + ' +' + token);
        }

        for (const token of patch.removeClass ?? []) {
            lines.push(target + ' -' + token);
        }

        for (const name of patch.removeAttr ?? []) {
            lines.push(target + ' -@' + name);
        }

        if (!patch.setAttr && !patch.addClass && !patch.removeClass && !patch.removeAttr) {
            lines.push(target + ' apply ' + JSON.stringify(patch));
        }
    }

    return lines;
}

/**
 * Names every row handle (`row N`) and the list root (`list`), for
 * {@link traceWrites}. A handle belonging to neither is rendered as
 * `other(<handle>)`, so a write to the inner panel or a renderer is visible
 * rather than silently mistaken for a row's.
 */
function handleLabeller(list: TestList | TestMultiSelectList): (handle: unknown) => string {
    const names = new Map<unknown, string>();

    names.set(list.getElement(), 'list');

    for (let i = 0; i < list.rowCount(); i++) {
        names.set(list.row(i).getElement(), 'row ' + i);
    }

    return (handle: unknown): string => names.get(handle) ?? 'other(' + String(handle) + ')';
}

/** A rendered, laid-out single-select list of `count` string items. */
function makeList(count: number): TestList {
    const list = track(new TestList({ items: Array.from({ length: count }, (_, i) => 'Item ' + i) }));

    list.getElement(true);
    list.setWidth(LIST_WIDTH);
    list.setHeight(LIST_HEIGHT);
    list.doLayout();

    return list;
}

/** The {@link makeList} twin for the multi-select subclass. */
function makeMultiSelectList(count: number): TestMultiSelectList {
    const list = track(new TestMultiSelectList({ items: Array.from({ length: count }, (_, i) => 'Item ' + i) }));

    list.getElement(true);
    list.setWidth(LIST_WIDTH);
    list.setHeight(LIST_HEIGHT);
    list.doLayout();

    return list;
}

/**
 * Counts the `change` and `action` events `list` fires from the call onward.
 *
 * @param list - The list to observe.
 * @returns A live counter object, mutated as the events fire.
 */
function countEvents(list: TestList | TestMultiSelectList): { change: number; action: number } {
    const counts   = { change: 0, action: 0 };
    const onChange = (): void => { counts.change += 1; };
    const onAction = (): void => { counts.action += 1; };
    // The two list classes declare `on` as an overload set whose union is not
    // directly callable; both events wired here exist on each of them.
    const surface  = list as unknown as { on(event: string, listener: () => void): void };

    surface.on('change', onChange);
    surface.on('action', onAction);

    return counts;
}

let sink: RecordingDOMSink;

// Every list this file mounts, disposed in `afterEach`. `"action"` is
// DOM-routed, and `Event`'s window-level base-listener bookkeeping is module
// state that survives `DOM.reset()` — see `ComboBoxDropdownClose.test.ts`'s
// file header for the same gotcha. A list left undisposed keeps `"change"`
// marked installed against the previous case's window handle, so every later
// case in this file would silently lose its dispatch; `Component.destructor`
// purges the registrations and uninstalls the base listener with them.
let lists: Array<{ dispose(): void }> = [];

/**
 * Registers `list` for disposal in `afterEach` and hands it back, so a fixture
 * reads as one expression.
 *
 * @param list - The freshly constructed list.
 * @returns The same list.
 */
function track<T extends { dispose(): void }>(list: T): T {
    lists.push(list);

    return list;
}

beforeEach(() => {
    sink  = installTestDOM(CONFIG);
    lists = [];
});

afterEach(() => {
    vi.restoreAllMocks();

    for (const list of lists) {
        list.dispose();
    }

    DOM.reset();
});

describe('SelectableListRow — one class token per changed state (row-state-economy)', () => {
    it('case 1: one ArrowDown writes only to the row it left and the row it landed on', () => {
        const list = makeList(300);
        list.setSelectedIndex(5, false);

        const label = handleLabeller(list);
        const start = sink.writes.length;

        list.handleKey(key('ArrowDown'));

        expect(traceWrites(sink.writes.slice(start), label)).toEqual([
            'row 5 aria-selected=false',
            'row 5 -selected',
            'row 5 -focused',
            'row 6 aria-selected=true',
            'row 6 +selected',
            'row 6 +focused',
            'list aria-activedescendant=' + list.row(6).getId(),
            'dispatch change',
        ]);
    });

    it('case 2: the same key on a 3,000-item list writes exactly as much', () => {
        const list = makeList(3000);
        list.setSelectedIndex(5, false);

        const label = handleLabeller(list);
        const start = sink.writes.length;

        list.handleKey(key('ArrowDown'));

        const trace = sink.writes.slice(start);

        expect(trace.filter(w => w.op === 'apply')).toHaveLength(7);
        expect(trace.filter(w => w.op === 'dispatchEvent')).toHaveLength(1);
        expect(traceWrites(trace, label)).toEqual([
            'row 5 aria-selected=false',
            'row 5 -selected',
            'row 5 -focused',
            'row 6 aria-selected=true',
            'row 6 +selected',
            'row 6 +focused',
            'list aria-activedescendant=' + list.row(6).getId(),
            'dispatch change',
        ]);
    });

    it('case 3: re-setting a row state it already holds writes nothing', () => {
        const list = makeList(300);
        list.setSelectedIndex(5, false);

        const row   = list.row(5);
        const start = sink.writes.length;

        row.setSelected(row.isSelected());
        row.setFocused(row.isFocused());
        row.setEnabled(row.isEnabled());

        expect(sink.writes.slice(start)).toEqual([]);
    });

    it('case 4: no row ever has its whole `class` attribute rewritten', () => {
        const list = makeList(300);

        list.setSelectedIndex(5, false);
        list.handleKey(key('ArrowDown'));
        list.setItemEnabled(3, false);

        const rowHandles = new Set<Handle | undefined>();
        for (let i = 0; i < list.rowCount(); i++) {
            rowHandles.add(list.row(i).getElement());
        }

        const classAttributeWrites = sink.writes.filter(
            write => write.op === 'apply'
                && rowHandles.has(write.args[0] as Handle)
                && (write.args[1] as { setAttr?: Record<string, string> })?.setAttr?.class !== undefined,
        );

        expect(classAttributeWrites).toEqual([]);
    });

    it('case 5: every row carries aria-selected after render, `"true"` only on the selected one', () => {
        const list = makeList(300);
        list.setSelectedIndex(5, false);

        const values = Array.from(
            { length: list.rowCount() },
            (_, i) => DOM.source.getAttribute(list.row(i).getElement()!, 'aria-selected'),
        );

        expect(values[5]).toBe('true');
        expect(values.filter(v => v === 'true')).toHaveLength(1);
        expect(values.filter(v => v === 'false')).toHaveLength(list.rowCount() - 1);
    });

    it('case 6: a row selected before render carries its tokens from the first paint', () => {
        const list = track(new TestList({ items: ['a', 'b', 'c'], selectedIndex: 2 }));

        list.getElement(true);

        const tokens = classTokens(sink, list.row(2).getElement());

        expect(tokens).toContain('ts-ui-component');
        expect(tokens).toContain('SelectableListRow');
        expect(tokens).toContain('selected');
        expect(tokens).toContain('focused');
        expect(list.row(2).isStyleState('.selected')).toBe(true);
    });

    it('case 7: a pooled row reused for a different item drops the previous item\'s state', () => {
        const list = makeList(3);
        list.setSelectedIndex(2, false);

        list.setItems(['x', 'y', 'z']);

        const tokens = classTokens(sink, list.row(2).getElement());

        expect(tokens).not.toContain('selected');
        expect(tokens).not.toContain('focused');
        expect(DOM.source.getAttribute(list.row(2).getElement()!, 'aria-selected')).toBe('false');
    });

    it('case 8: a Shift-extension writes only to the rows entering or leaving the range', () => {
        const list = makeMultiSelectList(5);

        list.handleKey(key('End'));
        list.handleKey(key('ArrowUp', { shiftKey: true }));

        expect(list.row(3).isSelected()).toBe(true);
        expect(list.row(4).isSelected()).toBe(true);
        expect(list.row(3).isFocused()).toBe(true);

        const label = handleLabeller(list);
        const start = sink.writes.length;

        list.handleKey(key('ArrowDown', { shiftKey: true }));

        const rowLines = traceWrites(sink.writes.slice(start), label).filter(line => line.startsWith('row '));

        expect(rowLines).toEqual([
            'row 3 aria-selected=false',
            'row 3 -selected',
            'row 3 -focused',
            'row 4 +focused',
        ]);
        expect(DOM.source.getAttribute(list.row(3).getElement()!, 'aria-selected')).toBe('false');
    });
});

describe('AbstractSelectableList — a navigation key that moves nothing fires nothing (row-state-economy)', () => {
    it('case 10: every clamped navigation key on a one-row list writes nothing and fires nothing', () => {
        const list = makeList(1);
        list.setSelectedIndex(0, false);

        const counts = countEvents(list);

        for (const name of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown']) {
            const start = sink.writes.length;

            list.handleKey(key(name));

            expect(sink.writes.slice(start), name + ' wrote to the DOM').toEqual([]);
        }

        expect(counts).toEqual({ change: 0, action: 0 });
    });

    it('case 11: a navigation key that does move the selection still fires once', () => {
        const list = makeList(3);
        list.setSelectedIndex(2, false);

        const counts = countEvents(list);

        list.handleKey(key('ArrowUp'));

        expect(list.getSelectedIndex()).toBe(1);
        expect(counts).toEqual({ change: 1, action: 1 });
    });

    it('case 12: Enter and a click on the already-selected row still fire', () => {
        const list = makeList(3);
        list.setSelectedIndex(2, false);

        const counts = countEvents(list);

        list.handleKey(key('Enter'));

        expect(counts).toEqual({ change: 1, action: 1 });

        list.rowClick(2, { ctrlKey: false, metaKey: false, shiftKey: false } as unknown as MouseEvent);

        expect(counts).toEqual({ change: 2, action: 2 });
    });

    it('case 13: a key that moves only the focus onto the selected row fires nothing', () => {
        const list = makeList(6);
        list.setSelectedIndex(5, false);
        list.setFocusedIndex(4);

        const counts = countEvents(list);

        list.handleKey(key('ArrowDown'));

        expect(list.getFocusedIndex()).toBe(5);
        expect(counts).toEqual({ change: 0, action: 0 });
    });

    it('case 14: a MultiSelectList extension that extends nothing fires nothing', () => {
        const list   = makeMultiSelectList(4);
        const counts = countEvents(list);

        list.handleKey(key('End'));

        expect(counts.change).toBe(1);

        list.handleKey(key('ArrowDown', { shiftKey: true }));

        expect(counts.change).toBe(1);

        list.handleKey(key('ArrowUp', { ctrlKey: true }));

        expect(counts.change).toBe(1);
    });
});
