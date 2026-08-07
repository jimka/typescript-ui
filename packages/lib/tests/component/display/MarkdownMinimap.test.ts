import { describe, it, expect, afterEach } from 'vitest';
import { MarkdownMinimap } from '~/component/display/MarkdownMinimap';
import type { MarkdownHeading } from '~/component/display/Markdown';
import type { TreeNode } from '~/component/tree/TreeNode';
import { Component } from '~/core/Component';
import { Anchor } from '~/layout/Anchor';
import { AnchorConstraints } from '~/layout/AnchorConstraints';
import { HBox } from '~/layout/HBox';
import { Insets } from '~/primitive/Insets';
import { UNBOUNDED } from '~/primitive/Size';
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

/** The plan's worked example: a skipped depth level (h1 -> h3, no h2) plus a hidden h4. */
const WORKED_EXAMPLE: MarkdownHeading[] = [
    { id: 'introduction',     text: 'Introduction',     depth: 1 },
    { id: 'getting-started',  text: 'Getting Started',  depth: 2 },
    { id: 'install',          text: 'Install',          depth: 3 },
    { id: 'advanced-flags',   text: 'Advanced flags',   depth: 4 },
    { id: 'usage',            text: 'Usage',             depth: 2 },
];

/** Finds a node (depth-first) by its `data` (heading id). */
function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
    for (const node of nodes) {
        if (node.data === id) {
            return node;
        }

        const found = node.children ? findNode(node.children, id) : undefined;

        if (found) {
            return found;
        }
    }

    return undefined;
}

describe('MarkdownMinimap.setHeadings tree building', () => {
    afterEach(() => DOM.reset());

    it('builds the worked example\'s tree shape (skipped level nests, out-of-depth heading dropped)', () => {
        installTestDOM(CONFIG);

        const minimap = new MarkdownMinimap({});

        minimap.setHeadings(WORKED_EXAMPLE);

        const roots = (minimap as any)._tree.getNodes() as TreeNode[];

        expect(roots).toHaveLength(1);
        expect(roots[0].label).toBe('Introduction');
        expect(roots[0].children).toHaveLength(2);
        expect(roots[0].children![0].label).toBe('Getting Started');
        expect(roots[0].children![1].label).toBe('Usage');

        // "Install" nests under "Getting Started" (its direct depth-2 parent).
        expect(roots[0].children![0].children).toHaveLength(1);
        expect(roots[0].children![0].children![0].label).toBe('Install');

        // "Advanced flags" (depth 4, past the default maxHeadingDepth of 3) has
        // no row of its own anywhere in the tree.
        expect(findNode(roots, 'advanced-flags')).toBeUndefined();
    });

    it('drops a heading past maxHeadingDepth entirely, not merely hiding it', () => {
        installTestDOM(CONFIG);

        const minimap = new MarkdownMinimap({ maxHeadingDepth: 2 });

        minimap.setHeadings(WORKED_EXAMPLE);

        const roots = (minimap as any)._tree.getNodes() as TreeNode[];

        // "Install" (depth 3) is now also past the cutoff.
        expect(findNode(roots, 'install')).toBeUndefined();
        expect(findNode(roots, 'getting-started')).toBeDefined();
    });
});

describe('MarkdownMinimap "select" event', () => {
    afterEach(() => DOM.reset());

    it('fires with the clicked row\'s heading id', () => {
        installTestDOM(CONFIG);

        const minimap = new MarkdownMinimap({});
        minimap.setHeadings(WORKED_EXAMPLE);

        const selected: string[] = [];
        minimap.on('select', (id) => selected.push(id));

        const roots = (minimap as any)._tree.getNodes() as TreeNode[];
        const introductionNode = roots[0];

        (minimap as any)._tree.emit('selection', [introductionNode]);

        expect(selected).toEqual(['introduction']);
    });

    it('honours a construction-time listeners.select callback', () => {
        installTestDOM(CONFIG);

        const selected: string[] = [];
        const minimap = new MarkdownMinimap({ listeners: { select: (id) => selected.push(id) } });

        minimap.setHeadings(WORKED_EXAMPLE);

        const roots = (minimap as any)._tree.getNodes() as TreeNode[];
        const introductionNode = roots[0];

        (minimap as any)._tree.emit('selection', [introductionNode]);

        expect(selected).toEqual(['introduction']);
    });
});

describe('MarkdownMinimap activeheadingchange from a scrollSource', () => {
    afterEach(() => DOM.reset());

    it('selects the resolved node when the active heading changes', () => {
        installTestDOM(CONFIG);

        const listeners: Array<(id: string | null) => void> = [];
        const scrollSource = {
            on:  (_event: 'activeheadingchange', listener: (id: string | null) => void) => { listeners.push(listener); },
            off: () => {},
        };

        const minimap = new MarkdownMinimap({ scrollSource });
        minimap.setHeadings(WORKED_EXAMPLE);

        listeners[0]('getting-started');

        const tree = (minimap as any)._tree;

        expect(tree.getSelectedNode()?.data).toBe('getting-started');
    });

    it('resolves an activeheadingchange landing on a hidden heading to its nearest shown ancestor', () => {
        installTestDOM(CONFIG);

        const listeners: Array<(id: string | null) => void> = [];
        const scrollSource = {
            on:  (_event: 'activeheadingchange', listener: (id: string | null) => void) => { listeners.push(listener); },
            off: () => {},
        };

        const minimap = new MarkdownMinimap({ scrollSource });
        minimap.setHeadings(WORKED_EXAMPLE);

        listeners[0]('advanced-flags');

        const tree = (minimap as any)._tree;

        expect(tree.getSelectedNode()?.data).toBe('install');
    });

    it('a null activeheadingchange is a no-op, leaving the previous selection standing', () => {
        installTestDOM(CONFIG);

        const listeners: Array<(id: string | null) => void> = [];
        const scrollSource = {
            on:  (_event: 'activeheadingchange', listener: (id: string | null) => void) => { listeners.push(listener); },
            off: () => {},
        };

        const minimap = new MarkdownMinimap({ scrollSource });
        minimap.setHeadings(WORKED_EXAMPLE);

        listeners[0]('getting-started');
        listeners[0](null);

        const tree = (minimap as any)._tree;

        expect(tree.getSelectedNode()?.data).toBe('getting-started');
    });

    it('disposing removes the listener from scrollSource, so a later firing does not throw or touch the disposed tree', () => {
        installTestDOM(CONFIG);

        const listeners: Array<(id: string | null) => void> = [];
        let offCalls = 0;
        const scrollSource = {
            on:  (_event: 'activeheadingchange', listener: (id: string | null) => void) => { listeners.push(listener); },
            off: () => { offCalls += 1; },
        };

        const minimap = new MarkdownMinimap({ scrollSource });
        minimap.setHeadings(WORKED_EXAMPLE);

        minimap.dispose();

        expect(offCalls).toBe(1);
        expect(() => listeners[0]('getting-started')).not.toThrow();
    });
});

describe('MarkdownMinimap header row', () => {
    afterEach(() => DOM.reset());

    it('shows an "On this page" header above the tree', () => {
        installTestDOM(CONFIG);

        const minimap = new MarkdownMinimap({}) as any;
        const [headerRow, tree] = minimap.getComponents();
        const [headerText] = headerRow.getComponents();

        expect(headerText.getText()).toBe('On this page');
        expect(tree).toBe(minimap._tree);
    });

    it('clips a heading label wider than the panel instead of letting the tree grow and scroll sideways to read it', () => {
        installTestDOM(CONFIG);

        const minimap = new MarkdownMinimap({}) as any;

        expect(minimap._tree.getRowOverflow()).toBe('clip');
    });

    it('gives the header row enough height for its own padding, not just the bare text line height', () => {
        installTestDOM(CONFIG);

        const minimap = new MarkdownMinimap({}) as any;
        const [headerRow] = minimap.getComponents();
        const [headerText] = headerRow.getComponents();

        const bareHeight   = headerText.getPreferredSize()!.height;
        const paddedHeight = headerRow.getPreferredSize()!.height;

        // Insets(8, 12, 4, 12): 8px top + 4px bottom around the bare text —
        // width padding isn't asserted here since VBox's stretching cross
        // axis overrides preferred width regardless.
        expect(paddedHeight).toBe(bareHeight + 8 + 4);
    });
});

describe('MarkdownMinimap height cap', () => {
    afterEach(() => DOM.reset());

    it('caps its own reported preferred height rather than committing an unbounded one', () => {
        installTestDOM(CONFIG);

        const minimap = new MarkdownMinimap({});

        // 40 depth-1 headings, well past what 500px (the cap) fits at 24px/row.
        const manyHeadings: MarkdownHeading[] = Array.from({ length: 40 }, (_, i) => (
            { id: `h${i}`, text: `Heading ${i}`, depth: 1 }
        ));
        minimap.setHeadings(manyHeadings);

        // The Tree's own (uncapped) content height would exceed the cap...
        expect((minimap as any)._tree.getPreferredSize()!.height).toBeGreaterThan(500);
        // ...but the minimap's own reported preferred height is capped at it.
        expect(minimap.getPreferredSize()!.height).toBe(500);
        expect(minimap.getMaxSizeConstraint()).toEqual({ width: UNBOUNDED, height: 500 });
    });

    it('does not autoScroll itself — Tree already owns its own internal virtualized scrolling', () => {
        installTestDOM(CONFIG);

        const minimap = new MarkdownMinimap({});

        expect(minimap.getAutoScroll()).toBe('none');
    });

    it('shrinks the Tree to fit under the height cap during layout, instead of letting it lay out at its full uncapped content height (which would leave both this panel and Tree scrolling the same content independently)', () => {
        installTestDOM(CONFIG);

        const minimap = new MarkdownMinimap({});

        const manyHeadings: MarkdownHeading[] = Array.from({ length: 40 }, (_, i) => (
            { id: `h${i}`, text: `Heading ${i}`, depth: 1 }
        ));
        minimap.setHeadings(manyHeadings);

        minimap.getElement(true);
        minimap.setSize({ width: 200, height: 500 });
        minimap.doLayout();

        const tree = (minimap as any)._tree;

        // Tree's own unclamped content wants far more than fits under the cap...
        expect(tree.getPreferredSize()!.height).toBeGreaterThan(500);
        // ...but its actual laid-out height is shrunk to fit within it, so
        // Tree's own internal scrolling is the only thing that scrolls.
        expect(tree.getHeight()).toBeLessThan(500);
    });

    it('defaults to a wider preferred width than Tree\'s own generic default, so heading labels have more room', () => {
        installTestDOM(CONFIG);

        const minimap = new MarkdownMinimap({});

        expect(minimap.getPreferredSize()!.width).toBe(240);
    });

    it('an explicit preferredSize constraint wins over the wider default width', () => {
        installTestDOM(CONFIG);

        const minimap = new MarkdownMinimap({ preferredSize: { width: 300, height: 100 } });

        expect(minimap.getPreferredSize()).toEqual({ width: 300, height: 100 });
    });

    it('a caller-supplied maxSize / minSize / autoScroll wins over the class default', () => {
        installTestDOM(CONFIG);

        const minimap = new MarkdownMinimap({
            maxSize:    { width: 300, height: 800 },
            minSize:    { width: 50, height: 10 },
            autoScroll: 'both',
        });

        expect(minimap.getMaxSizeConstraint()).toEqual({ width: 300, height: 800 });
        expect(minimap.getMinSizeConstraint()).toEqual({ width: 50, height: 10 });
        expect(minimap.getAutoScroll()).toBe('both');
    });

    it('defaults to a 160px minSize width, so a shrinking layout (e.g. a docked HBox) can\'t collapse it to an unreadable sliver', () => {
        installTestDOM(CONFIG);

        const minimap = new MarkdownMinimap({});

        expect(minimap.getMinSizeConstraint()).toEqual({ width: 160, height: 0 });
    });

    it('keeps at least its minSize width when docked in a shrinking HBox row, even on a narrow viewport', () => {
        installTestDOM(CONFIG);

        // A generic docked host: an HBox pairing a wide-preferred-width
        // content pane with the minimap, sized to a viewport too narrow to
        // fit both at their preferred widths.
        const host = new Component({ layoutManager: new HBox({ spacing: 12, stretching: true }) });
        host.getElement(true);
        host.setSize({ width: 500, height: 800 });
        host.clearInsets();

        const content = new Component({ preferredSize: { width: 700, height: 400 } });
        host.addComponent(content);

        const minimap = new MarkdownMinimap({});
        host.addComponent(minimap);

        host.doLayout();

        expect(minimap.getWidth()).toBeGreaterThanOrEqual(160);
    });
});

describe('MarkdownMinimap.placeNextTo', () => {
    afterEach(() => DOM.reset());

    /** Builds an Anchor-managed host sized to `width` with zero insets, plus a text-column stand-in pinned top-left at `columnWidth`. */
    function buildHost(width: number, columnWidth: number) {
        const host = new Component({ layoutManager: new Anchor() });
        host.getElement(true);
        host.setSize({ width, height: 800 });
        host.clearInsets();

        const textColumn = new Component({ preferredSize: { width: columnWidth, height: 400 } });
        const textConstraints = new AnchorConstraints();
        textConstraints.left = 0;
        textConstraints.top  = 0;
        host.addComponent(textColumn, textConstraints);

        return { host, textColumn };
    }

    /** Adds `minimap` to `host` and runs one Anchor layout pass, without calling placeNextTo. */
    function mount(host: Component, minimap: MarkdownMinimap): void {
        host.addComponent(minimap, minimap.getAnchorConstraints());
        host.doLayout();
    }

    it('hugs the text column\'s right edge when there is room, instead of clamping to the corner', () => {
        installTestDOM(CONFIG);

        const { host, textColumn } = buildHost(1200, 600);
        const minimap = new MarkdownMinimap({ preferredSize: { width: 200, height: 100 } });
        mount(host, minimap);

        minimap.placeNextTo(textColumn);

        // hugX = textColumn's left (0) + its rendered width (600) + the 16px gap = 616.
        // cornerX (the old top-right behaviour) = 0 (origin) + 1200 - 200 - 12 = 988.
        // Room to spare, so the hug wins.
        expect(minimap.getX()).toBe(616);
    });

    it('falls back to the plain corner position when hugging would push past it', () => {
        installTestDOM(CONFIG);

        const { host, textColumn } = buildHost(300, 280);
        const minimap = new MarkdownMinimap({ preferredSize: { width: 200, height: 100 } });
        mount(host, minimap);

        minimap.placeNextTo(textColumn);

        // hugX = 0 + 280 + 16 = 296, which would push the minimap almost
        // fully off the 300px-wide host. cornerX = 300 - 200 - 12 = 88 wins.
        expect(minimap.getX()).toBe(88);
    });

    it('falls back to the plain corner position outright when textColumn is null, rather than leaving X unset', () => {
        installTestDOM(CONFIG);

        const { host } = buildHost(1200, 600);
        const minimap = new MarkdownMinimap({ preferredSize: { width: 200, height: 100 } });
        mount(host, minimap);

        minimap.placeNextTo(null);

        expect(minimap.getX()).toBe(988); // 1200 - 200 - 12, not NaN
    });

    it('includes the host\'s own content-inset origin in the corner fallback', () => {
        installTestDOM(CONFIG);

        const host = new Component({ layoutManager: new Anchor(), insets: new Insets(4, 4, 4, 4) });
        host.getElement(true);
        host.setSize({ width: 1200, height: 800 });

        const minimap = new MarkdownMinimap({ preferredSize: { width: 200, height: 100 } });
        mount(host, minimap);

        minimap.placeNextTo(null);

        // innerSize.width = 1200 - 4 - 4 = 1192. cornerX = origin(4) + 1192 - 200 - 12 = 984.
        expect(minimap.getX()).toBe(984);
    });

    it('re-frees the right constraint on every call, even after a later setCorner/setMargin restored it', () => {
        installTestDOM(CONFIG);

        const { host, textColumn } = buildHost(1200, 600);
        const minimap = new MarkdownMinimap({ preferredSize: { width: 200, height: 100 } });
        mount(host, minimap);

        minimap.placeNextTo(textColumn);
        minimap.setMargin(20); // re-runs applyCornerAndMargin, restoring `right`
        expect(minimap.getAnchorConstraints().right).toBe(20);

        minimap.placeNextTo(textColumn);

        expect(minimap.getAnchorConstraints().right).toBeUndefined();
        expect(minimap.getX()).toBe(616);
    });

    it('leaves the corner\'s right constraint untouched until placeNextTo is called', () => {
        installTestDOM(CONFIG);

        const minimap = new MarkdownMinimap({ corner: 'top-right' });

        expect(minimap.getAnchorConstraints().right).toBe(12);
    });
});
