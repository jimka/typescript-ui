// Registry test enforcing that every library `dispose()` override — now
// relocated to the protected `destructor()` override hook, so an ancestor's
// own teardown recursing into a registered child actually reaches it — chains
// to `super.destructor()` and leaves the component fully torn down.
// Invisible to the typechecker and to any single behavioural test, so it
// needs a table-driven, class-wide guard. Mirrors
// tests/component/default-options-fallback.test.ts's DEFAULT_RESOLUTION
// registry shape: one row per class, iterated by a single `describe`/`it`
// loop so a missing row is as visible as a failing one.
//
// Which classes this registry must cover is derived from the library source
// at run time via `classesDeclaringDestructor()` (see
// `../helpers/libraryClassScan.mjs`), not hand-counted: every row declares
// which scanned classes it is evidence for via `covers`, and
// `UNCLAIMED_DESTRUCTOR_CLASSES` is a shrink-only baseline of the classes no
// row covers yet. A class gaining its first `protected destructor()` with
// neither a covering row nor a baseline entry fails the coverage assertion
// below — the registry cannot silently go stale the way its hand-written
// predecessor did (a count of 35 that the source had already outgrown to
// 54, undetected).
//
// Each `it` also asserts a construct/destroy balance via `Diagnostics`
// counters: after `dispose()`, as many components must have been destroyed
// as were constructed. The pre-existing per-instance-CSS-rule check above it
// catches a leaked class-tier rule but is blind to a leaked component that
// writes no rule of its own (a bare renderer, a raw-appended label) — the
// balance check catches that class of leak directly.
import { describe, it, expect } from 'vitest';
import { Component } from '~/core/Component';
import { Markdown } from '~/component/display/Markdown';
import { Video } from '~/component/display/Video';
import { VideoPlayer } from '~/component/display/VideoPlayer';
import { MenuItem } from '~/component/container/MenuItem';
import { LineChart } from '~/component/chart/LineChart';
import { ChartLegend } from '~/component/chart/ChartLegend';
import { MenuBarButton } from '~/component/menubar/MenuBarButton';
import { CodeEditor } from '~/component/editor/CodeEditor';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { PaginationBar } from '~/component/display/PaginationBar';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { Menu } from '~/overlay/Menu';
import { Popover } from '~/overlay/Popover';
import { Link } from '~/component/input/Link';
import { TabBar } from '~/component/container/TabBar';
import { ScrollStrip } from '~/component/container/ScrollStrip';
import { MenuButton, MenuButtonOptions } from '~/component/button/MenuButton';
import { SplitButton } from '~/component/button/SplitButton';
import { ToolBar } from '~/component/menubar/ToolBar';
import { Button } from '~/component/button/Button';
import { Table } from '~/component/table/Table';
import { DateEditor } from '~/component/table/cell/editor/Date';
import { TimeEditor } from '~/component/table/cell/editor/Time';
import { DateTimeEditor } from '~/component/table/cell/editor/DateTime';
import { MenuBar } from '~/component/menubar/MenuBar';
import { TabButton } from '~/component/button/TabButton';
import { FieldSet } from '~/component/container/FieldSet';
import { ComboBox } from '~/component/input/ComboBox';
import { List } from '~/component/list/List';
import { Tree } from '~/component/tree/Tree';
import { GlyphListItemRenderer } from '~/component/list/renderer/Glyph';
import { IconLabelTreeNodeRenderer } from '~/component/tree/renderer/IconLabel';
import { _ruleCacheKeys } from '~/core/StyleTarget';
import { Diagnostics } from '~/core/Diagnostics';
import { classesDeclaringDestructor } from '../helpers/libraryClassScan.mjs';

/**
 * Recursively collects a component's own id plus every registered
 * descendant's id (via `getComponents()`), plus the ids of any extra
 * subtrees passed in — for components that raw-append pieces outside
 * `_components` (see `extraSubtrees` below).
 */
function collectIds(c: Component, extraSubtrees: Component[] = []): string[] {
    const ids = [c.getId()];

    for (const child of c.getComponents()) {
        ids.push(...collectIds(child));
    }

    for (const extra of extraSubtrees) {
        ids.push(...collectIds(extra));
    }

    return ids;
}

const REGISTRY: Array<{
    name: string;
    make?: () => Component | Promise<Component>;
    reason?: string;
    // Narrows the leak check to keys belonging to this component's own known
    // subtree. `Panel`'s `_scrollbarV` / `_scrollbarH` overlay-scrollbar
    // visuals and `Border`'s resize gutters used to be a separate,
    // out-of-scope leak here — both are now fixed by
    // plans/implemented/scrollbar-leak-and-layout-guards.md, which disposes
    // each on teardown. VideoPlayer's row keeps its narrowing regardless: its
    // residual two rules come from neither source (its `Border` manager
    // creates no gutters at all), so removing the narrowing would fail this
    // row for a reason that plan does not address. TabBar's own raw-appended
    // overlays (`_tabClip` etc.) ARE in scope and are covered here via
    // `extraSubtrees`.
    ownIds?: (c: Component) => string[];
    /** Source classes this row is the registry's evidence for. Omitted where the row exercises the base class's own recursion rather than a declared override. */
    covers?: string[];
    /** Pre-existing undisposed-component residual this row does not fix; see `VideoPlayer` below. Never rises — only set for a class this plan does not address. */
    undisposedBaseline?: number;
}> = [
    { name: 'Markdown',      covers: ['Markdown'], make: () => new Markdown('# A') },
    { name: 'Video',         covers: ['Video'],    make: () => new Video() },
    // VideoPlayer keeps its narrowing for a reason unrelated to the gutters
    // fixed above: its `Border` manager creates none, and its residual two
    // rules come from neither that source nor `Panel`'s overlay scrollbars
    // (see the block comment above) — scope the check to VideoPlayer's own
    // registered subtree.
    {
        name: 'VideoPlayer',
        covers: ['VideoPlayer'],
        make: () => new VideoPlayer(),
        ownIds: (c) => collectIds(c),
        // Pre-existing, unrelated to the raw-append leaks this plan fixes —
        // recorded so the balance assertion doesn't block on it. The number
        // may only go down.
        undisposedBaseline: 4,
    },
    { name: 'MenuItem',      covers: ['MenuItem'], make: () => new MenuItem({ text: 'A' }, () => {}, () => {}) },
    { name: 'AbstractChart (via LineChart)', covers: ['AbstractChart'], make: () => new LineChart({}) },
    { name: 'ChartLegend',   make: () => new ChartLegend() },
    { name: 'MenuBarButton', make: () => new MenuBarButton('File', () => {}, () => {}) },
    { name: 'CodeEditor',    covers: ['CodeEditor'], make: () => new CodeEditor() },
    { name: 'MarkdownEditor', covers: ['MarkdownEditor'], make: () => new MarkdownEditor() },
    {
        name: 'PaginationBar',
        covers: ['PaginationBar'],
        make: () => new PaginationBar(new MemoryStore(new Model([{ name: 'id' }], 'id'), [])),
    },
    // Menu's own destructor() (overlay/Menu.ts) cancels any in-flight
    // show/hide fade and disposes a still-open submenu panel, which — like
    // every Menu anywhere in the library — is a raw field, never a
    // registered child (see Menu.ts's class comment), so the base
    // destructor's recursion cannot reach it on its own. This row's plain
    // unopened Menu doesn't reach either branch; it covers the ancestor-
    // recursion contract every `MenuItem` / `MenuSeparator` relies on
    // instead, for a real, non-synthetic class.
    { name: 'Menu',    covers: ['Menu'], make: () => new Menu([{ text: 'A' }], () => {}) },
    // `_menu` is lazily created (only on the first toggle), so a bare
    // `new MenuButton(...)` never builds it — toggle the dropdown once to
    // materialise it, mirroring the Popover row's `ensureArrow()` idiom.
    // `_menu` is never a registered child (see Menu.ts's class comment), so
    // it is only reached by this row at all because MenuButton's own
    // `destructor()` now disposes it explicitly.
    {
        name: 'MenuButton',
        covers: ['MenuButton'],
        make: () => {
            const button = new MenuButton<MenuButtonOptions>('Export', { menuItems: [{ text: 'A', action: () => {} }] });

            button.getElement(true);
            (button as unknown as { toggleMenu(): void }).toggleMenu();

            return button;
        },
    },
    // Same shape as MenuButton, for SplitButton's own lazily-created `_menu`.
    {
        name: 'SplitButton',
        covers: ['SplitButton'],
        make: () => {
            const button = new SplitButton('Save', { menuItems: [{ text: 'A', action: () => {} }] });

            button.getElement(true);
            (button as unknown as { _toggleMenu(): void })._toggleMenu();

            return button;
        },
    },
    // `_overflowMenu` is built eagerly (`_createOverflowAffordance`), but
    // `_toggleOverflowMenu()` only opens it once at least one child has
    // overflowed — force that by adding several real-width buttons and
    // narrowing the bar past all of them, then run a real layout pass so
    // `_reflowOverflow` computes the overflow set before toggling.
    {
        name: 'ToolBar',
        covers: ['ToolBar'],
        make: () => {
            const bar = new ToolBar({ overflow: 'menu' });

            bar.addComponents([
                new Button('Some Label'),
                new Button('Another Label'),
                new Button('A Third Label'),
            ]);
            bar.getElement(true);
            bar.setWidth(40);
            bar.doLayout();
            (bar as unknown as { _toggleOverflowMenu(): void })._toggleOverflowMenu();

            return bar;
        },
    },
    // `_columnContextMenu` is a non-nullable field, built eagerly, but writes
    // no rule until `showColumnMenu` actually shows it (see the row-selection
    // comment on `StyleTarget.set` elsewhere in this file's siblings).
    {
        name: 'Table',
        covers: ['Table'],
        make: () => {
            const table = new Table(new MemoryStore(new Model([{ name: 'a', type: 'string', order: 0 }], 'a'), []));

            table.getElement(true);
            (table as unknown as { showColumnMenu(x: number, y: number): void }).showColumnMenu(0, 0);

            return table;
        },
    },
    // `Body._editorPool` lazily builds one shared editor per variant on the
    // first edit of that type and holds it in a private Map for the table's
    // whole lifetime — never a registered child, so the base destructor's
    // recursion cannot reach it. Materialise a `StringEditor` by starting and
    // cancelling an edit on the pool row's first cell before disposing.
    // `store.load()` is required (unlike the `Table` row above, which never
    // renders a data row) — `Body`'s row pool only grows to fit records the
    // store has actually loaded.
    {
        name: 'Table (cell-editor pool)',
        covers: ['TableBody'],
        make: async () => {
            const store = new MemoryStore(new Model([{ name: 'a', type: 'string', order: 0 }], 'a'), [{ a: 'x' }]);

            await store.load();

            const table = new Table(store);

            table.getElement(true);
            table.setWidth(400);
            table.setHeight(200);
            table.doLayout();

            const body = (table as unknown as {
                _body: { getRowPool(): Array<{ getComponents(): Array<{ startEdit(): void; cancelEdit(): void }> }> };
            })._body;
            const cell = body.getRowPool()[0].getComponents()[0];

            cell.startEdit();
            cell.cancelEdit();

            return table;
        },
    },
    // `_dropdown` is a LayerManager-mounted picker overlay, lazily built on
    // first focus and held in a private field — never a registered child.
    {
        name: 'DateEditor',
        covers: ['DateEditor'],
        make: () => {
            const editor = new DateEditor();

            editor.getElement(true);
            (editor as unknown as { openDropdown(): void }).openDropdown();

            return editor;
        },
    },
    {
        name: 'TimeEditor',
        covers: ['TimeEditor'],
        make: () => {
            const editor = new TimeEditor();

            editor.getElement(true);
            (editor as unknown as { openDropdown(): void }).openDropdown();

            return editor;
        },
    },
    {
        name: 'DateTimeEditor',
        covers: ['DateTimeEditor'],
        make: () => {
            const editor = new DateTimeEditor();

            editor.getElement(true);
            (editor as unknown as { openDropdown(): void }).openDropdown();

            return editor;
        },
    },
    // `_panels` are built by `setMenus` (constructor-time here, via the
    // `menus` option) but each stays unopened — and so rule-less — until
    // `openMenu` actually shows one.
    {
        name: 'MenuBar',
        covers: ['MenuBar'],
        make: () => {
            const bar = new MenuBar({ menus: [{ label: 'File', items: [{ text: 'A', action: () => {} }] }] });

            bar.getElement(true);
            bar.openMenu(0);

            return bar;
        },
    },
    {
        // `ensureArrow()` is lazy (only called from `show()`), so a bare
        // `new Popover()` never builds `_arrowComponent` — call the private
        // method directly to materialise it without needing a full
        // `show()` (anchor element, LayerManager, fade timers) just to
        // reach a one-line lazy builder.
        name: 'Popover',
        covers: ['Popover'],
        make: () => {
            const popover = new Popover();

            (popover as unknown as { ensureArrow(): void }).ensureArrow();

            return popover;
        },
    },
    { name: 'Link',    make: () => new Link('x') },
    {
        name: 'TabButton',
        covers: ['TabButton'],
        make: () => {
            const button = new TabButton('Home', { closeable: true });

            button.getElement(true);

            return button;
        },
    },
    {
        name: 'TabBar',
        covers: ['TabBar'],
        // Opens the real right-click context menu (rather than leaving
        // `_contextMenu` unshown) so its row also exercises the new
        // `_contextMenu.dispose()` line in `TabBar.destructor()` — driven the
        // same way tests/component/container/TabBar.contextMenu.test.ts
        // reaches `openTabMenu`, except against the real menu, not a stub.
        make: () => {
            const bar = new TabBar();

            bar.createBarEntry('a', 'Alpha', { closeable: true });

            const entry = (bar as unknown as { _entries: unknown[] })._entries[0];

            (bar as unknown as { openTabMenu(entry: unknown, x: number, y: number): void })
                .openTabMenu(entry, 0, 0);

            return bar;
        },
        ownIds: (c) => {
            const bar = c as unknown as {
                _tabClip: Component;
                _toolGroup: Component;
                _leadGroup: Component;
                _indicator: Component;
                _dropTint: Component;
                _reorderBar: Component;
                _contextMenu: Component;
                _entries: Array<{ button: { getCloseButton(): Component | null } }>;
            };

            const closeButton = bar._entries[0].button.getCloseButton();

            return collectIds(c, [
                bar._tabClip, bar._toolGroup, bar._leadGroup,
                bar._indicator, bar._dropTint, bar._reorderBar, bar._contextMenu,
                ...(closeButton ? [closeButton] : []),
            ]);
        },
    },
    // `_clip`, `_leadArrow`, and `_trailArrow` are raw-appended to the strip's
    // own element rather than registered via `addComponent` (see
    // ScrollStrip.dispose), so they need `extraSubtrees` the same way
    // TabBar's chrome overlays do above. The arrows are only built lazily on
    // overflow, so they stay `null` (and out of `extraSubtrees`) here.
    {
        name: 'ScrollStrip',
        covers: ['ScrollStrip'],
        make: () => new ScrollStrip(),
        ownIds: (c) => {
            const strip = c as unknown as {
                _clip: Component;
                _leadArrow: Component | null;
                _trailArrow: Component | null;
            };

            return collectIds(c, [strip._clip, strip._leadArrow, strip._trailArrow]
                .filter((child): child is Component => child !== null));
        },
    },
    { name: 'FieldSet', covers: ['FieldSet'], make: () => new FieldSet('Group') },
    {
        name: 'ComboBox',
        covers: ['ComboBox', 'ComboBoxLabel'],
        make: () => new ComboBox({ items: [{ key: 'a', label: 'Alpha' }] }),
    },
    {
        name: 'List',
        covers: ['AbstractSelectableList', 'SelectableListRow', 'LabelListItemRenderer'],
        make: () => new List({ items: [{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }] }),
    },
    {
        // setRendererFactory after render so the per-row renderer *swap* path runs
        // too, not only the teardown path.
        name: 'List (glyph renderer)',
        covers: ['GlyphListItemRenderer'],
        make: () => {
            const list = new List({
                items: [
                    { key: 'a', label: 'Alpha', glyph: 'caret-right' },
                    { key: 'b', label: 'Beta',  glyph: 'caret-down'  },
                ],
                rendererFactory: () => new GlyphListItemRenderer(),
            });

            list.getElement(true);
            list.setRendererFactory(() => new GlyphListItemRenderer());

            return list;
        },
    },
    {
        // expandAll() rebinds the root row, so `setRowData` swaps its caret-right
        // glyph for a caret-down one and the discarded caret is exercised.
        name: 'Tree',
        covers: ['VirtualRowView', 'TreeRow', 'LabelTreeNodeRenderer'],
        make: () => {
            const tree = new Tree();

            tree.setNodes([{ label: 'Root', children: [{ label: 'A' }] }]);
            tree.getElement(true);
            tree.setWidth(300);
            tree.setHeight(200);
            tree.doLayout();
            tree.expandAll();

            return tree;
        },
    },
    {
        // "caret-right" rather than the resolver default "file", which no library
        // module registers with `Glyph.register` — the default throws here.
        name: 'Tree (icon renderer)',
        covers: ['IconLabelTreeNodeRenderer'],
        make: () => {
            const tree = new Tree();

            tree.setNodes([{ label: 'Root', children: [{ label: 'A' }] }]);
            tree.getElement(true);
            tree.setWidth(300);
            tree.setHeight(200);
            tree.doLayout();
            tree.setRendererFactory(() => new IconLabelTreeNodeRenderer(() => 'caret-right'));
            tree.expandAll();

            return tree;
        },
    },
];

/**
 * Classes `classesDeclaringDestructor()` finds today with no `covers` row
 * and no dedicated test of their own. Entries come out as rows are added;
 * an entry only goes in as a deliberate, commented deferral — never to make
 * a newly-failing assertion pass again.
 *
 * `DiagnosticsOverlay` / `StyleAuditOverlay` / `StyleAuditView` joined this
 * baseline when the `core-event-and-listener-bag-cleanup-round-2` plan
 * dropped their `destructor()`'s stray `override` keyword to match the
 * library's convention — the scanner's `/^\s*protected destructor\(/` regex
 * only matches without it, so these three go from invisible to unclaimed
 * with no change to their destructor bodies. Adding dispose-registry
 * coverage for the diagnostics overlays is out of that plan's scope.
 */
const UNCLAIMED_DESTRUCTOR_CLASSES: readonly string[] = [
    'AbstractPickerField', 'AbstractWindow', 'AnimatedDropdown', 'AutoCompleteField', 'Button',
    'Canvas', 'DiagnosticsOverlay', 'DiagramView', 'Dialog', 'Dock', 'Drawer', 'DropZoneOverlay',
    'FilterCell', 'HeaderCell', 'LabeledGrid', 'MarkdownMinimap', 'Notification', 'Panel',
    'PopupButton', 'Rail', 'Row', 'SplitGutter', 'StatusBar', 'StyleAuditOverlay',
    'StyleAuditView', 'TableHeader', 'TablePanel', 'Text', 'Tooltip', 'TreeTablePanel',
    'WebGLCanvas',
];

describe('dispose-full-teardown registry: every dispose() leaves zero new rule-cache keys', () => {
    for (const { name, make, reason, ownIds, undisposedBaseline } of REGISTRY) {
        if (!make) {
            it.skip(`${name} (${reason})`, () => {});
            continue;
        }

        it(name, async () => {
            // Warm-up pass: some classes lazily materialise process-global,
            // shared state on first use — a module-level `.classname` rule
            // (e.g. Markdown's `.ts-ui-md-*` block styles), or a lazily-built
            // singleton (e.g. `Tooltip`, attached by any titled Button). That
            // state is correctly never torn down by one instance's dispose(),
            // so constructing once here keeps it out of the real diff below.
            const warm = await make();
            warm.getElement(true);
            warm.dispose();

            const before = new Set(_ruleCacheKeys());

            Diagnostics._reset();
            const c = await make();
            c.getElement(true);

            const ids = ownIds?.(c);

            c.dispose();

            let leaked = _ruleCacheKeys().filter((key) => !before.has(key));

            if (ids) {
                leaked = leaked.filter((key) => ids.some((id) => key.includes(id)));
            }

            expect(leaked).toEqual([]);

            const counters   = Diagnostics.counters();
            const undisposed = counters.componentsConstructed - counters.componentsDestroyed;

            // Compared as a labelled string so the failure names the row, not just a number.
            expect(`${name}: undisposed=${undisposed}`).toBe(`${name}: undisposed=${undisposedBaseline ?? 0}`);
        });
    }

    const claimed = new Set(REGISTRY.flatMap((row) => row.covers ?? []));
    const scanned = classesDeclaringDestructor();
    const unclaimed = scanned.filter((name) => !claimed.has(name));

    it('every covers entry still declares a destructor', () => {
        expect([...claimed].filter((name) => !scanned.includes(name))).toEqual([]);
    });

    it('every declared destructor is claimed by a row or listed as unclaimed', () => {
        expect(unclaimed).toEqual([...UNCLAIMED_DESTRUCTOR_CLASSES]);
    });
});
