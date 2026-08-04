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
// Row count is enforced structurally, not by a hard-coded literal (plan
// counts written by hand go stale) — see the "regression checkpoints" step
// in plans/implemented/component-teardown-seam.md, which greps
// `^\s*protected destructor(` definitions in the library source and compares
// that count against this registry by hand at implementation time.
//
// Re-derived count (grep is a superset — read each hit before trusting it):
// `grep -rn '^\s*protected destructor(' packages/lib/src/typescript/lib`
// currently returns 35 hits. `Component.ts:756` is the base `destructor()`
// this registry's rows override and doesn't belong here. Five predate the
// original component-teardown-seam.md move and were never `dispose()`-named
// — `StatusBar.ts`, `Canvas.ts`, `WebGLCanvas.ts`, `core/Panel.ts`,
// `overlay/AbstractWindow.ts` — so they stay out of this registry's scope.
//
// plans/implemented/table-tab-close-residual-leak.md added five of this
// registry's rows — `MenuButton`, `SplitButton`, `ToolBar`, `Table`,
// `MenuBar` — each gaining its first `destructor()` override to dispose a
// `Menu` held in a private field (never a registered child; see Menu.ts's
// class comment), plus one line inside `TabBar`'s pre-existing override for
// the same reason. It did not audit the remaining, unaccounted-for hits —
// several later, unrelated plans (`Dock`, `Notification`,
// `DropZoneOverlay`, `Dialog`, `Drawer`, `Rail`, `DiagramView`,
// `VirtualRowView`, `table/cell/Header`, plus the abstract `AnimatedDropdown`
// and the singleton `Tooltip`) have added `destructor()` overrides without a
// corresponding row here since this count was last reconciled — a
// pre-existing gap this plan did not introduce and did not close.
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
import { _ruleCacheKeys } from '~/core/StyleTarget';

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
}> = [
    { name: 'Markdown',      make: () => new Markdown('# A') },
    { name: 'Video',         make: () => new Video() },
    // VideoPlayer keeps its narrowing for a reason unrelated to the gutters
    // fixed above: its `Border` manager creates none, and its residual two
    // rules come from neither that source nor `Panel`'s overlay scrollbars
    // (see the block comment above) — scope the check to VideoPlayer's own
    // registered subtree.
    { name: 'VideoPlayer',   make: () => new VideoPlayer(), ownIds: (c) => collectIds(c) },
    { name: 'MenuItem',      make: () => new MenuItem({ text: 'A' }, () => {}, () => {}) },
    { name: 'AbstractChart (via LineChart)', make: () => new LineChart({}) },
    { name: 'ChartLegend',   make: () => new ChartLegend() },
    { name: 'MenuBarButton', make: () => new MenuBarButton('File', () => {}, () => {}) },
    { name: 'CodeEditor',    make: () => new CodeEditor() },
    { name: 'MarkdownEditor', make: () => new MarkdownEditor() },
    {
        name: 'PaginationBar',
        make: () => new PaginationBar(new MemoryStore(new Model([{ name: 'id' }], 'id'), [])),
    },
    // Menu has no destructor() override of its own — its former dispose()
    // override (a manual `_menuItems` re-disposal loop guarded to persistent
    // mode) became fully redundant once every item's own cleanup moved onto
    // destructor(): every `MenuItem` / `MenuSeparator` is registered via
    // `addComponent` in both modes, so the base class's recursive teardown
    // already reaches them. The row stays to cover exactly that — the
    // ancestor-recursion contract this plan's fix depends on — for a real,
    // non-synthetic class.
    { name: 'Menu',    make: () => new Menu([{ text: 'A' }], () => {}) },
    // `_menu` is lazily created (only on the first toggle), so a bare
    // `new MenuButton(...)` never builds it — toggle the dropdown once to
    // materialise it, mirroring the Popover row's `ensureArrow()` idiom.
    // `_menu` is never a registered child (see Menu.ts's class comment), so
    // it is only reached by this row at all because MenuButton's own
    // `destructor()` now disposes it explicitly.
    {
        name: 'MenuButton',
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
        make: () => {
            const editor = new DateEditor();

            editor.getElement(true);
            (editor as unknown as { openDropdown(): void }).openDropdown();

            return editor;
        },
    },
    {
        name: 'TimeEditor',
        make: () => {
            const editor = new TimeEditor();

            editor.getElement(true);
            (editor as unknown as { openDropdown(): void }).openDropdown();

            return editor;
        },
    },
    {
        name: 'DateTimeEditor',
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
        make: () => {
            const popover = new Popover();

            (popover as unknown as { ensureArrow(): void }).ensureArrow();

            return popover;
        },
    },
    { name: 'Link',    make: () => new Link('x') },
    {
        name: 'TabButton',
        make: () => {
            const button = new TabButton('Home', { closeable: true });

            button.getElement(true);

            return button;
        },
    },
    {
        name: 'TabBar',
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
];

describe('dispose-full-teardown registry: every dispose() leaves zero new rule-cache keys', () => {
    for (const { name, make, reason, ownIds } of REGISTRY) {
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

            const c = await make();
            c.getElement(true);

            const ids = ownIds?.(c);

            c.dispose();

            let leaked = _ruleCacheKeys().filter((key) => !before.has(key));

            if (ids) {
                leaked = leaked.filter((key) => ids.some((id) => key.includes(id)));
            }

            expect(leaked).toEqual([]);
        });
    }
});
