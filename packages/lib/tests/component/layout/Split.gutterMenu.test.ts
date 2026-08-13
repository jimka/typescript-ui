import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Split } from '~/layout/Split';
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

/** Builds a host with `paneCount` panes, each optionally carrying constraints. */
function hostSplit(
    split: Split,
    paneCount: number,
    constraints?: Array<LayoutConstraints | undefined>,
): { host: Container; split: Split; panes: Component[] } {
    const host = new Container({ layoutManager: split });

    host.getElement(true);
    host.setWidth(400);
    host.setHeight(300);

    const panes: Component[] = [];

    for (let i = 0; i < paneCount; i += 1) {
        const pane = new Component({ preferredSize: { width: 50, height: 50 } });

        host.addComponent(pane, constraints?.[i]);
        panes.push(pane);
    }

    host.doLayout();

    return { host, split, panes };
}

// openGutterMenu / _gutters / _contextMenu / gutterTargetPane are all
// non-public; the menu assembly is asserted through a typed view that stubs
// `_contextMenu.show` to capture the built config array, mirroring the
// TabBar.contextMenu.test.ts probe pattern.
interface SplitProbe {
    _gutters: Array<{
        isMovable:          () => boolean;
        isOpaque:           () => boolean;
        setOpaque:          (value: boolean) => void;
        getCollapseDirection: () => string;
    }>;
    _contextMenu: { show: (x: number, y: number, configs: MenuItemConfig[]) => void } | null;
    openGutterMenu: (gutter: unknown, gutterIndex: number, x: number, y: number) => void;
    gutterTargetPane: (gutterIndex: number, components: Component[]) => number;
}

function probe(split: Split): SplitProbe {
    return split as unknown as SplitProbe;
}

/** Opens the gutter menu for `gutterIndex` and returns the captured configs. */
function openMenuFor(split: Split, gutterIndex: number): MenuItemConfig[] {
    const p = probe(split);
    let captured: MenuItemConfig[] = [];

    p._contextMenu = { show: (_x, _y, configs): void => { captured = configs; } };
    p.openGutterMenu(p._gutters[gutterIndex], gutterIndex, 0, 0);

    return captured;
}

/** Row labels in order; separators render as '---'. */
function labels(configs: MenuItemConfig[]): string[] {
    return configs.map(c => (c.separator ? '---' : c.text!));
}

/** Looks up a row's config by its label. */
function row(configs: MenuItemConfig[], text: string): MenuItemConfig {
    const found = configs.find(c => c.text === text);

    if (!found) {
        throw new Error(`No row titled "${text}"`);
    }

    return found;
}

describe('Split gutter context menu', () => {
    afterEach(() => DOM.reset());

    it('lays out Lock, Fix-left/right, and Collapse-left/right on a horizontal split', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split({ orientation: 'horizontal' }), 2);

        expect(labels(openMenuFor(split, 0))).toEqual([
            'Lock gutter',
            '---',
            'Fix left pane width',
            'Fix right pane width',
            '---',
            'Collapse left pane',
            'Collapse right pane',
        ]);
    });

    it('lays out Fix-top/bottom and Collapse-top/bottom on a vertical split', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split({ orientation: 'vertical' }), 2);

        expect(labels(openMenuFor(split, 0))).toEqual([
            'Lock gutter',
            '---',
            'Fix top pane height',
            'Fix bottom pane height',
            '---',
            'Collapse top pane',
            'Collapse bottom pane',
        ]);
    });

    it('Lock gutter toggles gutter.isMovable() and reflects it checked on re-open', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split(), 2);
        const gutter = probe(split)._gutters[0];

        expect(row(openMenuFor(split, 0), 'Lock gutter').checked).toBe(false);

        row(openMenuFor(split, 0), 'Lock gutter').action!();

        expect(gutter.isMovable()).toBe(false);
        expect(row(openMenuFor(split, 0), 'Lock gutter').checked).toBe(true);
    });

    it('Fix left pane width pins and unpins the leading pane\'s resize weight', () => {
        installTestDOM(CONFIG);

        const { split, panes } = hostSplit(new Split(), 2);

        expect(row(openMenuFor(split, 0), 'Fix left pane width').checked).toBe(false);

        row(openMenuFor(split, 0), 'Fix left pane width').action!();

        expect(split.getPaneResizeWeight(panes[0])).toBe(0);
        expect(row(openMenuFor(split, 0), 'Fix left pane width').checked).toBe(true);

        row(openMenuFor(split, 0), 'Fix left pane width').action!();

        expect(split.getPaneResizeWeight(panes[0])).toBeUndefined();
        expect(row(openMenuFor(split, 0), 'Fix left pane width').checked).toBe(false);
    });

    it('keeps the two pin rows independent', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split(), 2);

        row(openMenuFor(split, 0), 'Fix left pane width').action!();

        expect(row(openMenuFor(split, 0), 'Fix right pane width').checked).toBe(false);
    });

    it('serves the leading pane by default', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split(), 2);
        const configs = openMenuFor(split, 0);

        expect(row(configs, 'Collapse left pane').checked).toBe(true);
        expect(row(configs, 'Collapse right pane').checked).toBe(false);
    });

    it('retargets to the trailing pane and back, syncing constraints/gutterTargetPane/chevron', () => {
        installTestDOM(CONFIG);

        const { host, split, panes } = hostSplit(new Split(), 2);
        const p = probe(split);
        const gutters = p._gutters;

        row(openMenuFor(split, 0), 'Collapse right pane').action!();
        host.doLayout();

        expect(split.getLayoutConstraints(panes[1])!.collapseDirection).toBe('east');
        expect(p.gutterTargetPane(0, host.getLaidOutComponents())).toBe(1);
        expect(gutters[0].getCollapseDirection()).toBe('east');

        let configs = openMenuFor(split, 0);
        expect(row(configs, 'Collapse right pane').checked).toBe(true);
        expect(row(configs, 'Collapse left pane').checked).toBe(false);

        row(openMenuFor(split, 0), 'Collapse left pane').action!();
        host.doLayout();

        expect(split.getLayoutConstraints(panes[0])!.collapseDirection).toBe('west');
        expect(split.getLayoutConstraints(panes[1])!.collapseDirection).toBe('west');
        expect(p.gutterTargetPane(0, host.getLaidOutComponents())).toBe(0);
        expect(gutters[0].getCollapseDirection()).toBe('west');
    });

    it('preserves a neighbour\'s other constraint fields across a collapse-direction pick', () => {
        installTestDOM(CONFIG);

        const constraints = new LayoutConstraints();
        constraints.collapsible = true;
        constraints.weight = 3;

        const { host, split, panes } = hostSplit(new Split(), 2, [undefined, constraints]);

        row(openMenuFor(split, 0), 'Collapse right pane').action!();
        host.doLayout();

        const stored = split.getLayoutConstraints(panes[1])!;

        expect(stored.collapsible).toBe(true);
        expect(stored.weight).toBe(3);
        expect(stored.collapseDirection).toBe('east');
    });

    it('gives an unconstrained neighbour a fresh inert constraint and leaves its geometry unchanged', () => {
        installTestDOM(CONFIG);

        const { host, split, panes } = hostSplit(new Split(), 2);
        const p = probe(split);

        const widthBefore = panes[1].getWidth();
        const xBefore      = panes[1].getX();

        expect(split.getLayoutConstraints(panes[1])).toBeUndefined();

        row(openMenuFor(split, 0), 'Collapse right pane').action!();
        host.doLayout();

        const stored = split.getLayoutConstraints(panes[1])!;

        expect(stored.collapseDirection).toBe('east');
        expect((p as unknown as { paneCollapsible: (pane: Component) => boolean }).paneCollapsible(panes[1])).toBe(true);
        expect(panes[1].getWidth()).toBe(widthBefore);
        expect(panes[1].getX()).toBe(xBefore);
    });

    it('disables the Collapse row for a non-collapsible neighbour', () => {
        installTestDOM(CONFIG);

        const nonCollapsible = new LayoutConstraints();
        nonCollapsible.collapsible = false;

        const { split } = hostSplit(new Split(), 2, [undefined, nonCollapsible]);

        expect(row(openMenuFor(split, 0), 'Collapse right pane').enabled).toBe(false);
    });

    it('disables both Collapse rows while the gutter is an opaque collapse strip', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split(), 2);
        const gutter = probe(split)._gutters[0];

        gutter.setOpaque(true);

        const configs = openMenuFor(split, 0);

        expect(row(configs, 'Collapse left pane').enabled).toBe(false);
        expect(row(configs, 'Collapse right pane').enabled).toBe(false);
        expect(row(configs, 'Lock gutter').enabled).not.toBe(false);
        expect(row(configs, 'Fix left pane width').enabled).not.toBe(false);
    });

    it('rebuilds on every open, reflecting direct setter calls made between opens', () => {
        installTestDOM(CONFIG);

        const { split, panes } = hostSplit(new Split(), 2);
        const gutter = probe(split)._gutters[0];

        expect(row(openMenuFor(split, 0), 'Lock gutter').checked).toBe(false);

        gutter.setOpaque(false);
        (gutter as unknown as { setMovable: (v: boolean) => void }).setMovable(false);
        split.setPaneResizeWeight(panes[0], 0);

        const configs = openMenuFor(split, 0);

        expect(row(configs, 'Lock gutter').checked).toBe(true);
        expect(row(configs, 'Fix left pane width').checked).toBe(true);
    });

    it('is a no-op with no container', () => {
        const split = new Split();
        const p = probe(split);

        p._contextMenu = { show: () => { throw new Error('should not show'); } };

        expect(() => p.openGutterMenu({}, 0, 0, 0)).not.toThrow();
    });

    it('is a no-op when the gutter index has no pane on one side', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split(), 2);
        const p = probe(split);

        p._contextMenu = { show: () => { throw new Error('should not show'); } };

        expect(() => p.openGutterMenu(p._gutters[0], 5, 0, 0)).not.toThrow();
    });
});
