import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Split } from '~/layout/Split';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { MenuItemConfig } from '~/component/container/MenuItem';
import { CheckboxMenuRow } from '~/component/container/CheckboxMenuRow';
import { RadioMenuRow } from '~/component/container/RadioMenuRow';
import { _Checkbox as Checkbox } from '~/component/input/Checkbox';
import { _RadioButton as RadioButton } from '~/component/input/RadioButton';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
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

// Either of the two row classes the gutter menu builds: three rows stay
// CheckboxMenuRow, the collapse pair is now RadioMenuRow.
type GutterMenuRow = InstanceType<typeof CheckboxMenuRow> | InstanceType<typeof RadioMenuRow>;

describe('Split gutter context menu', () => {
    // Every gutter-menu row wires its own click/mouseover/mouseout listeners
    // in its constructor and must be disposed before DOM.reset(), or a
    // leaked row leaves "click" marked installed against a discarded sink
    // and the next test's `toggle()` dispatch silently finds no handler (see
    // MenuRow.test.ts's afterEach comment). Declared after DOM.reset()'s
    // afterEach so it runs first (afterEach hooks run in reverse
    // registration order).
    let builtRows: Array<GutterMenuRow> = [];

    afterEach(() => DOM.reset());
    afterEach(() => {
        for (const row of builtRows) {
            row.dispose();
        }
        builtRows = [];
    });

    // Memoized per config object, not just recorded for teardown: the two
    // collapse rows close over shared `let collapseLeadRow`/`collapseNextRow`
    // fields inside one `openGutterMenu` call, so calling a `row:` factory
    // twice for the same open — e.g. two `row(configs, …)` lookups against
    // one captured `configs` array — would silently rebind those fields to a
    // second, test-invisible instance. Caching by config object keeps every
    // lookup against the same `configs` array returning the one row Split
    // itself is holding, while a fresh `openMenuFor()` call (a fresh
    // `configs` array) still builds fresh rows.
    const builtByConfig = new Map<MenuItemConfig, GutterMenuRow>();

    /** Calls a `row:` factory once per config object, recording the built row for teardown above. */
    function buildRow(config: MenuItemConfig): GutterMenuRow {
        let built = builtByConfig.get(config);

        if (!built) {
            built = config.row!() as GutterMenuRow;
            builtByConfig.set(config, built);
            builtRows.push(built);
        }

        return built;
    }

    /** A built row's label — its only child is a Checkbox or a RadioButton, both sharing getLabel(). */
    function rowLabel(row: GutterMenuRow): string {
        return (row.getComponents()[0] as InstanceType<typeof Checkbox> | InstanceType<typeof RadioButton>).getLabel() ?? '';
    }

    /** Dispatches a click at `row`'s element, toggling/selecting it — mirrors MenuRow.test.ts's `click` helper. */
    function toggle(row: GutterMenuRow): void {
        const handle = row.getElement(true)!;

        DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(handle, 'click'));
    }

    /** Row labels in order; a `row:` config's label is built, a separator renders as '---'. */
    function labels(configs: MenuItemConfig[]): string[] {
        return configs.map(c => (c.separator ? '---' : rowLabel(buildRow(c))));
    }

    /** Looks up a built row by its label, building only as many configs as needed. */
    function row(configs: MenuItemConfig[], text: string): GutterMenuRow {
        for (const c of configs) {
            if (c.separator) {
                continue;
            }

            const built = buildRow(c);

            if (rowLabel(built) === text) {
                return built;
            }
        }

        throw new Error(`No row titled "${text}"`);
    }

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

        expect(row(openMenuFor(split, 0), 'Lock gutter').isChecked()).toBe(false);

        toggle(row(openMenuFor(split, 0), 'Lock gutter'));

        expect(gutter.isMovable()).toBe(false);
        expect(row(openMenuFor(split, 0), 'Lock gutter').isChecked()).toBe(true);
    });

    it('Fix left pane width pins and unpins the leading pane\'s resize weight', () => {
        installTestDOM(CONFIG);

        const { split, panes } = hostSplit(new Split(), 2);

        expect(row(openMenuFor(split, 0), 'Fix left pane width').isChecked()).toBe(false);

        toggle(row(openMenuFor(split, 0), 'Fix left pane width'));

        expect(split.getPaneResizeWeight(panes[0])).toBe(0);
        expect(row(openMenuFor(split, 0), 'Fix left pane width').isChecked()).toBe(true);

        toggle(row(openMenuFor(split, 0), 'Fix left pane width'));

        expect(split.getPaneResizeWeight(panes[0])).toBeUndefined();
        expect(row(openMenuFor(split, 0), 'Fix left pane width').isChecked()).toBe(false);
    });

    it('keeps the two pin rows independent', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split(), 2);

        toggle(row(openMenuFor(split, 0), 'Fix left pane width'));

        expect(row(openMenuFor(split, 0), 'Fix right pane width').isChecked()).toBe(false);
    });

    it('serves the leading pane by default', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split(), 2);
        const configs = openMenuFor(split, 0);

        expect(row(configs, 'Collapse left pane').isChecked()).toBe(true);
        expect(row(configs, 'Collapse right pane').isChecked()).toBe(false);
    });

    it('retargets to the trailing pane and back, syncing constraints/gutterTargetPane/chevron', () => {
        installTestDOM(CONFIG);

        const { host, split, panes } = hostSplit(new Split(), 2);
        const p = probe(split);
        const gutters = p._gutters;

        toggle(row(openMenuFor(split, 0), 'Collapse right pane'));
        host.doLayout();

        expect(split.getLayoutConstraints(panes[1])!.collapseDirection).toBe('east');
        expect(p.gutterTargetPane(0, host.getLaidOutComponents())).toBe(1);
        expect(gutters[0].getCollapseDirection()).toBe('east');

        let configs = openMenuFor(split, 0);
        expect(row(configs, 'Collapse right pane').isChecked()).toBe(true);
        expect(row(configs, 'Collapse left pane').isChecked()).toBe(false);

        toggle(row(openMenuFor(split, 0), 'Collapse left pane'));
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

        toggle(row(openMenuFor(split, 0), 'Collapse right pane'));
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

        toggle(row(openMenuFor(split, 0), 'Collapse right pane'));
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

        expect(row(openMenuFor(split, 0), 'Collapse right pane').isEnabled()).toBe(false);
    });

    it('disables both Collapse rows while the gutter is an opaque collapse strip', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split(), 2);
        const gutter = probe(split)._gutters[0];

        gutter.setOpaque(true);

        const configs = openMenuFor(split, 0);

        expect(row(configs, 'Collapse left pane').isEnabled()).toBe(false);
        expect(row(configs, 'Collapse right pane').isEnabled()).toBe(false);
        expect(row(configs, 'Lock gutter').isEnabled()).toBe(true);
        expect(row(configs, 'Fix left pane width').isEnabled()).toBe(true);
    });

    it('S7. a gutter collapsing neither pane starts with both collapse rows unselected but enabled', () => {
        installTestDOM(CONFIG);

        const leadConstraints = new LayoutConstraints();
        leadConstraints.collapseDirection = 'east';
        const nextConstraints = new LayoutConstraints();
        nextConstraints.collapseDirection = 'west';

        const { split } = hostSplit(new Split(), 2, [leadConstraints, nextConstraints]);
        const configs = openMenuFor(split, 0);
        const leadRow = row(configs, 'Collapse left pane');
        const nextRow = row(configs, 'Collapse right pane');

        expect(leadRow.isChecked()).toBe(false);
        expect(nextRow.isChecked()).toBe(false);
        expect(leadRow.isEnabled()).toBe(true);
        expect(nextRow.isEnabled()).toBe(true);

        toggle(nextRow);

        expect(nextRow.isChecked()).toBe(true);
        expect(leadRow.isChecked()).toBe(false);
    });

    it('B18. clicking the non-target collapse row selects it and clears the sibling; a repeat click is a no-op', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split(), 2);
        const configs = openMenuFor(split, 0);
        const leadRow = row(configs, 'Collapse left pane');
        const nextRow = row(configs, 'Collapse right pane');

        // lead is the default target (see 'serves the leading pane by default').
        expect(leadRow.isChecked()).toBe(true);
        expect(nextRow.isChecked()).toBe(false);

        // Click the non-target row: RadioMenuRow.activate() selects it, then
        // syncCollapseRows retargets and clears the sibling.
        toggle(nextRow);
        expect(leadRow.isChecked()).toBe(false);
        expect(nextRow.isChecked()).toBe(true);

        // Click the SAME row again — it is already the target and already
        // selected, so activate() is a select-only no-op and the re-sync
        // recomputes the identical target: nothing changes.
        toggle(nextRow);
        expect(leadRow.isChecked()).toBe(false);
        expect(nextRow.isChecked()).toBe(true);
    });

    it('B18b. clicking the lead collapse row while it is already the target leaves both rows unchanged', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split(), 2);
        const configs = openMenuFor(split, 0);
        const leadRow = row(configs, 'Collapse left pane');
        const nextRow = row(configs, 'Collapse right pane');

        expect(leadRow.isChecked()).toBe(true); // lead is already the default target

        // activate() on an already-selected row is a no-op, and
        // syncCollapseRows recomputes the same live target — nothing changes.
        toggle(leadRow);

        expect(leadRow.isChecked()).toBe(true);
        expect(nextRow.isChecked()).toBe(false);
    });

    it('the collapse rows are select-only RadioMenuRow, not CheckboxMenuRow: activate() alone leaves an already-selected row selected', () => {
        installTestDOM(CONFIG);

        // syncCollapseRows always rewrites both rows' checked state after a
        // click, so every click-driven assertion above reads the same
        // whichever row class built the pair. activate() now runs the same
        // "action" handler a click does — retargetGutterCollapse then
        // syncCollapseRows — so this isolates the row's own activation rule
        // rather than bypassing the sync: a CheckboxMenuRow would have
        // flipped an already-selected row to unchecked before the re-sync
        // ran; a RadioMenuRow is select-only and leaves it selected either way.
        const { split } = hostSplit(new Split(), 2);
        const configs = openMenuFor(split, 0);
        const leadRow = row(configs, 'Collapse left pane');

        expect(leadRow.isChecked()).toBe(true); // lead is already the default target

        leadRow.activate();

        expect(leadRow.isChecked()).toBe(true);
    });

    it('rebuilds on every open, reflecting direct setter calls made between opens', () => {
        installTestDOM(CONFIG);

        const { split, panes } = hostSplit(new Split(), 2);
        const gutter = probe(split)._gutters[0];

        expect(row(openMenuFor(split, 0), 'Lock gutter').isChecked()).toBe(false);

        gutter.setOpaque(false);
        (gutter as unknown as { setMovable: (v: boolean) => void }).setMovable(false);
        split.setPaneResizeWeight(panes[0], 0);

        const configs = openMenuFor(split, 0);

        expect(row(configs, 'Lock gutter').isChecked()).toBe(true);
        expect(row(configs, 'Fix left pane width').isChecked()).toBe(true);
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
