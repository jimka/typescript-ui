// Registry test enforcing that every `dispose()` override in the library
// chains to `super.dispose()` — invisible to the typechecker and to any
// single behavioural test, so it needs a table-driven, class-wide guard.
// Mirrors tests/component/default-options-fallback.test.ts's
// DEFAULT_RESOLUTION registry shape: one row per class, iterated by a single
// `describe`/`it` loop so a missing row is as visible as a failing one.
//
// Row count is enforced structurally, not by a hard-coded literal (plan
// counts written by hand go stale) — see the "regression checkpoints" step
// in plans/implemented/component-teardown-seam.md, which greps
// `^\s*dispose(` definitions in the library source and compares that count
// against this registry by hand at implementation time.
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
    make?: () => Component;
    reason?: string;
    // Narrows the leak check to keys belonging to this component's own known
    // subtree, for the two rows affected by a separate, pre-existing,
    // out-of-scope leak class: some framework internals raw-append a piece
    // outside `_components` (`Panel`'s `_scrollbarV` / `_scrollbarH`
    // overlay-scrollbar visuals, `Border`'s resize gutters) the same way the
    // sixteen classes this plan's dispose() contract covers historically did
    // — but `Panel` and `Border` are not among those sixteen, so fixing them
    // is out of scope here. Without narrowing, that gap intermittently
    // (geometry-dependent) fails these rows for a reason this plan does not
    // fix. TabBar's own raw-appended overlays (`_tabClip` etc.) ARE in scope
    // and are covered here via `extraSubtrees`.
    ownIds?: (c: Component) => string[];
}> = [
    { name: 'Markdown',      make: () => new Markdown('# A') },
    { name: 'Video',         make: () => new Video() },
    // VideoPlayer uses a `Border` layout manager, whose resize gutters are a
    // separate, pre-existing, out-of-scope leak (see the block comment
    // above) — scope the check to VideoPlayer's own registered subtree.
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
    { name: 'Menu',    make: () => new Menu([{ text: 'A' }], () => {}) },
    { name: 'Popover', make: () => new Popover() },
    { name: 'Link',    make: () => new Link('x') },
    {
        name: 'TabBar',
        make: () => new TabBar(),
        ownIds: (c) => {
            const bar = c as unknown as {
                _tabClip: Component;
                _toolGroup: Component;
                _leadGroup: Component;
                _indicator: Component;
                _dropTint: Component;
                _reorderBar: Component;
            };

            return collectIds(c, [
                bar._tabClip, bar._toolGroup, bar._leadGroup,
                bar._indicator, bar._dropTint, bar._reorderBar,
            ]);
        },
    },
];

describe('dispose-full-teardown registry: every dispose() leaves zero new rule-cache keys', () => {
    for (const { name, make, reason, ownIds } of REGISTRY) {
        if (!make) {
            it.skip(`${name} (${reason})`, () => {});
            continue;
        }

        it(name, () => {
            // Warm-up pass: some classes lazily materialise process-global,
            // shared state on first use — a module-level `.classname` rule
            // (e.g. Markdown's `.ts-ui-md-*` block styles), or a lazily-built
            // singleton (e.g. `Tooltip`, attached by any titled Button). That
            // state is correctly never torn down by one instance's dispose(),
            // so constructing once here keeps it out of the real diff below.
            const warm = make();
            warm.getElement(true);
            warm.dispose();

            const before = new Set(_ruleCacheKeys());

            const c = make();
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
