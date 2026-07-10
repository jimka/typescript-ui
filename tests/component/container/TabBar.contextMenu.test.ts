import { describe, it, expect, afterEach } from 'vitest';
import { TabBar, TabToolDescriptor } from '~/component/container/TabBar';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { MenuItemConfig } from '~/component/container/MenuItem';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** A LayoutConstraints carrying a closeable flag. */
function closeable(): LayoutConstraints {
    const c = new LayoutConstraints();

    c.closeable = true;

    return c;
}

// openTabMenu / _entries / _contextMenu / emit are all non-public; the menu
// assembly is asserted through a typed view that stubs `show` to capture the
// built config array and records `emit` calls.
interface MenuProbe {
    _entries: Array<{ id: string }>;
    _contextMenu: { show: (x: number, y: number, configs: MenuItemConfig[]) => void };
    openTabMenu: (entry: unknown, x: number, y: number) => void;
    emit: (event: string, id: string) => void;
}

function probe(bar: TabBar): MenuProbe {
    return bar as unknown as MenuProbe;
}

/** Opens the context menu for the entry at `idx` and returns the captured configs. */
function openMenuFor(bar: TabBar, idx: number): MenuItemConfig[] {
    const p = probe(bar);
    let captured: MenuItemConfig[] = [];

    p._contextMenu.show = (_x, _y, configs): void => { captured = configs; };
    p.openTabMenu(p._entries[idx], 0, 0);

    return captured;
}

/** Row labels in order; separators render as '---'. */
function labels(configs: MenuItemConfig[]): string[] {
    return configs.map(c => (c.separator ? '---' : c.text!));
}

/** Builds a five-tab bar; every tab is closeable except the first ('a', pinned). */
function pinnedFirstBar(): TabBar {
    const bar = new TabBar();

    bar.createBarEntry('a', 'Alpha');
    bar.createBarEntry('b', 'Beta', closeable());
    bar.createBarEntry('c', 'Gamma', closeable());
    bar.createBarEntry('d', 'Delta', closeable());
    bar.createBarEntry('e', 'Epsilon', closeable());

    return bar;
}

describe('TabBar context menu assembly', () => {
    afterEach(() => DOM.reset());

    it('lays out Switch-to, single + bulk closes, and no Tools submenu without a descriptor tool', () => {
        installTestDOM(CONFIG);

        const configs = openMenuFor(pinnedFirstBar(), 2);

        expect(labels(configs)).toEqual([
            'Switch to',
            '---',
            'Close',
            'Close others',
            'Close all to the left',
            'Close all to the right',
            'Close all',
        ]);
    });

    it('renames the before/after closes to above/below on a vertical strip', () => {
        installTestDOM(CONFIG);

        const bar = pinnedFirstBar();
        bar.setSide('west');

        const rowLabels = labels(openMenuFor(bar, 2));

        expect(rowLabels).toContain('Close all above');
        expect(rowLabels).toContain('Close all below');
        expect(rowLabels).not.toContain('Close all to the left');
        expect(rowLabels).not.toContain('Close all to the right');
        // Order stays before-then-after: above precedes below.
        expect(rowLabels.indexOf('Close all above')).toBeLessThan(rowLabels.indexOf('Close all below'));
    });

    it('lists every tab in the Switch-to submenu with only the active one disabled', () => {
        installTestDOM(CONFIG);

        const bar = pinnedFirstBar();
        // 'a' is the active tab (first created becomes active).
        const configs = openMenuFor(bar, 2);
        const submenu = configs[0].submenu!;
        const items = submenu.items as MenuItemConfig[];

        expect(items.map(i => i.text)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']);
        expect(items.map(i => i.enabled)).toEqual([false, true, true, true, true]);
    });

    it('enables Close only for a closeable clicked tab', () => {
        installTestDOM(CONFIG);

        const bar = pinnedFirstBar();
        const onPinned = openMenuFor(bar, 0).find(c => c.text === 'Close')!;
        const onCloseable = openMenuFor(bar, 2).find(c => c.text === 'Close')!;

        expect(onPinned.enabled).toBe(false);
        expect(onCloseable.enabled).toBe(true);
    });

    it('disables a bulk item when no closeable tab falls in its scope', () => {
        installTestDOM(CONFIG);

        const bar = pinnedFirstBar();

        // Clicked 'c' (idx 2): tabs to the right (d, e) are closeable → enabled;
        // to the left only 'b' is closeable ('a' pinned) → enabled.
        const mid = openMenuFor(bar, 2);
        expect(mid.find(c => c.text === 'Close all to the right')!.enabled).toBe(true);
        expect(mid.find(c => c.text === 'Close all to the left')!.enabled).toBe(true);

        // Clicked last tab 'e': nothing to the right → disabled.
        const last = openMenuFor(bar, 4);
        expect(last.find(c => c.text === 'Close all to the right')!.enabled).toBe(false);

        // Clicked 'b' (idx 1): only 'a' to the left, and it is not closeable → disabled.
        const second = openMenuFor(bar, 1);
        expect(second.find(c => c.text === 'Close all to the left')!.enabled).toBe(false);
    });

    it('closes exactly the right-side ids, in order, when the bulk action fires', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();
        bar.createBarEntry('a', 'Alpha', closeable());
        bar.createBarEntry('b', 'Beta', closeable());
        bar.createBarEntry('c', 'Gamma', closeable());
        bar.createBarEntry('d', 'Delta', closeable());
        bar.createBarEntry('e', 'Epsilon', closeable());

        // Right-click 'b' (idx 1); capture the built action before emit is stubbed.
        const action = openMenuFor(bar, 1).find(c => c.text === 'Close all to the right')!.action!;

        // Record emits instead of performing real closes: the snapshot was already
        // computed at menu-build, so this asserts the emit loop iterates it — c,d,e
        // in strip order — rather than re-reading a mutating _entries.
        const closed: string[] = [];
        probe(bar).emit = (event, id): void => { if (event === 'tabclose') { closed.push(id); } };

        action();

        expect(closed).toEqual(['c', 'd', 'e']);
    });

    it('appends a Tools submenu listing only descriptor-built tools, in strip order', () => {
        installTestDOM(CONFIG);

        const bar = pinnedFirstBar();
        const tool: TabToolDescriptor = { label: 'New tab', action: () => {} };

        bar.addTool(tool);

        const configs = openMenuFor(bar, 2);
        const rowLabels = labels(configs);

        expect(rowLabels[rowLabels.length - 2]).toBe('---');
        expect(rowLabels[rowLabels.length - 1]).toBe('Tools');

        const toolItems = configs[configs.length - 1].submenu!.items as MenuItemConfig[];
        expect(toolItems.map(i => i.text)).toEqual(['New tab']);
        expect(toolItems[0].action).toBe(tool.action);
    });
});
