// Registry test enforcing that disposing a component purges every DOM
// listener registration it holds through the `Event` API. Mirrors
// tests/component/dispose-full-teardown.test.ts's REGISTRY / collectIds
// shape, swapping the rule-cache inventory for the listener-registration
// inventory `Event._registeredComponentIds()` exposes.
//
// Every listed class registers its listeners in its constructor, so unlike
// the rule-cache registry this needs no render pass, no warm-up (listener
// registration is per-instance state, not shared/lazily-materialised process
// state), and no before/after set diff — asserting that no snapshotted id
// survives the purge is already exact.
//
// Which classes this registry must cover is derived from the library source
// at run time via `classesRegisteringEventListeners()` (see
// `../helpers/libraryClassScan.mjs`), not hand-counted: every row declares
// which scanned classes it is evidence for via `covers`, and
// `UNCLAIMED_LISTENER_CLASSES` is a shrink-only baseline of the classes no
// row covers yet. A class gaining its first `Event.addListener(this, ...)`
// registration with neither a covering row nor a baseline entry fails the
// coverage assertion below — the registry cannot silently go stale the way
// its hand-written predecessor did.
import { describe, it, expect } from 'vitest';
import { Component } from '~/core/Component';
import { Link } from '~/component/input/Link';
import { MenuItem } from '~/component/container/MenuItem';
import { MenuBarButton } from '~/component/menubar/MenuBarButton';
import { CollapseButton } from '~/component/container/CollapseButton';
import { ChartLegend } from '~/component/chart/ChartLegend';
import { LineChart } from '~/component/chart/LineChart';
import { List } from '~/component/list/List';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { Event } from '~/core/Event';
import { classesRegisteringEventListeners } from '../helpers/libraryClassScan.mjs';

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

const REGISTRY: Array<{
    name: string;
    /** Source classes this row is the registry's evidence for. Omitted where the row exercises the base class's own recursion rather than a declared override. */
    covers?: string[];
    make: () => Component;
    /** Overrides `collectIds(c)` when the ids to check must be snapshotted before a discard happens mid-test. */
    ids?: (c: Component) => string[];
}> = [
    { name: 'Link',           covers: ['Link'],           make: () => new Link('x') },
    { name: 'MenuItem',       covers: ['MenuItem'],       make: () => new MenuItem({ text: 'A' }, () => {}, () => {}) },
    { name: 'MenuBarButton',  covers: ['MenuBarButton'],  make: () => new MenuBarButton('File', () => {}, () => {}) },
    { name: 'CollapseButton', covers: ['CollapseButton'], make: () => new CollapseButton() },
    { name: 'ChartLegend',    covers: ['ChartLegend'],    make: () => new ChartLegend() },
    { name: 'AbstractChart (via LineChart)', covers: ['AbstractChart'], make: () => new LineChart({}) },
    {
        name: 'List (pool shrink)',
        covers: ['AbstractSelectableList', 'SelectableListRow'],
        make: () => new List({ items: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }] }),
        // Snapshot all three rows' ids, then shrink to one item so the two surplus
        // rows go down syncRows' discard path before the dispose below. Collecting
        // after the shrink would miss them: they are already out of `_components`.
        ids: (c) => {
            const ids = collectIds(c);

            (c as List).setItems([{ key: 'a', label: 'A' }]);

            return ids;
        },
    },
    {
        name:   'WysiwygSurface (via MarkdownEditor)',
        covers: ['WysiwygSurface'],
        // WysiwygSurface is a private inner class of MarkdownEditor.ts, not
        // directly constructible from a test file — MarkdownEditor adds it as
        // a registered child (`addComponent`), so disposing the editor reaches
        // it through the same base-class recursion `_codeEditor` relies on.
        make: () => new MarkdownEditor(),
    },
];

/**
 * Classes `classesRegisteringEventListeners()` finds today with no `covers`
 * row and no dedicated test of their own. Entries come out as rows are
 * added; an entry only goes in as a deliberate, commented deferral — never
 * to make a newly-failing assertion pass again.
 */
const UNCLAIMED_LISTENER_CLASSES: readonly string[] = [
    'AbstractBooleanInput', 'AbstractBooleanMenuRow', 'AbstractCalendarDropdown', 'AbstractWindow',
    'Body', 'Button', 'Checkbox', 'ComboBox', 'DateEditor', 'DateTimeEditor', 'DiagramView',
    'Dialog', 'DialogBackdrop', 'Drawer', 'FileDropZone', 'Form', 'HeaderCell', 'Markdown',
    'MarkdownViewer', 'MenuBar', 'Notification', 'Panel', 'ParentHeaderCell', 'PickerCell',
    'PickerDay', 'PickerMonthLabel', 'PickerNavButton', 'Popover', 'RadioButton',
    'Rail', 'ResizeHandle', 'ScrollArrowButton', 'Scrollbar', 'Slider', 'SpinButton', 'SplitGutter',
    'TabBar', 'TableBody', 'TextInput', 'TimeEditor', 'TimePickerDropdown', 'ToggleButton',
    'ToolBar', 'Tree', 'TreeTable', 'WebGLCanvas', 'WindowBorder', 'WindowHeader',
];

describe('dispose-listener-teardown registry: every dispose() purges its Event registrations', () => {
    for (const { name, make, ids } of REGISTRY) {
        it(name, () => {
            const c = make();
            const snapshotIds = ids ? ids(c) : collectIds(c);

            c.dispose();

            const registered = Event._registeredComponentIds();
            const leaked = snapshotIds.filter((id) => registered.includes(id));

            expect(leaked).toEqual([]);
        });
    }

    const claimed = new Set(REGISTRY.flatMap((row) => row.covers ?? []));
    const scanned = classesRegisteringEventListeners();
    const unclaimed = scanned.filter((name) => !claimed.has(name));

    it('every covers entry still registers listeners', () => {
        expect([...claimed].filter((name) => !scanned.includes(name))).toEqual([]);
    });

    it('every class registering listeners is claimed by a row or listed as unclaimed', () => {
        expect(unclaimed).toEqual([...UNCLAIMED_LISTENER_CLASSES]);
    });
});
