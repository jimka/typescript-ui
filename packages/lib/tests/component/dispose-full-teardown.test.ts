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
// currently returns 20 hits. `Component.ts:726` is the base `destructor()`
// this registry's rows override and doesn't belong here. Of the remaining 19,
// five predate this plan and were never `dispose()`-named — `StatusBar.ts`,
// `Canvas.ts`, `WebGLCanvas.ts`, `core/Panel.ts`, `overlay/AbstractWindow.ts`
// — so they are out of this registry's scope (the classes this plan's
// contract covers) the same way they were before the dispose()-to-destructor()
// move. That leaves 14 real relocated overrides — matching this registry's 15
// rows minus `Menu`, whose row is explained below.
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
