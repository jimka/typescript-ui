// serializeLayout -> plain object; restoreLayout -> rebuild from one. The
// round-trip is the headline contract. Window-plane serialization is DOM-heavy
// and out of scope (a Non-Goal); these tests cover the in-root Split/Tab/panel
// arrangements with an empty windows plane.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Split } from '~/layout/Split';
import { Tab } from '~/layout/Tab';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { serializeLayout, restoreLayout, type LayoutFactory, type LayoutState, type PanelNode, type SplitNode, type TabNode, type WindowNode } from '~/layout/LayoutSerialization';
import { Glyph } from '~/component/display/Glyph';
import { circle_check } from '~/glyphs/solid/circle_check';
import { DOM } from '~/core/DOM';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { Window } from '~/overlay/Window';
import { TabWindow } from '~/overlay/TabWindow';
import { installTestDOM, setConnected } from '../../dom/TestDOM';
import { _Button as Button } from '~/component/button/Button';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheKeys } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** A factory that returns the SAME instances by id (the stable-instance contract). */
function instanceFactory(map: Record<string, Component>): LayoutFactory {
    return (id: string) => map[id] ?? null;
}

/**
 * A sized Tab host. The host is rendered and sized so a layout pass gives
 * every child its tab, which `setActiveContent` needs to activate one.
 *
 * @returns The host and its Tab manager.
 */
function tabHost(): { host: Container; tab: Tab } {
    installTestDOM(CONFIG);

    const tab  = new Tab();
    const host = new Container({ layoutManager: tab });

    host.getElement(true);
    host.setWidth(400);
    host.setHeight(300);

    return { host, tab };
}

/** Components A, B and C with ids `a`, `b` and `c`. */
function panels(): { a: Component; b: Component; c: Component } {
    const a = new Component({}); a.setId('a');
    const b = new Component({}); b.setId('b');
    const c = new Component({}); c.setId('c');

    return { a, b, c };
}

/** Layout constraints marking a child transient: shown as a tab, never captured. */
function transient(): LayoutConstraints {
    return Object.assign(new LayoutConstraints(), { transient: true });
}

/** The captured root of `host`, narrowed to a tab node. */
function tabRoot(host: Container): TabNode {
    const state = serializeLayout(host);

    expect(state.root.kind).toBe('tab');

    return state.root as TabNode;
}

/** The panel id of the captured child the node's active index names. */
function activePanelId(root: TabNode): string {
    return (root.children[root.activeIndex] as { panelId: string }).panelId;
}

/**
 * A host holding a transient placeholder P ahead of A, B and C, laid out,
 * with B active: the strip is P A B C, so B is the third tab but the
 * second captured child.
 */
function placeholderFirstWithBActive(): { host: Container; a: Component; b: Component; c: Component } {
    const { host, tab } = tabHost();
    const { a, b, c }   = panels();

    host.addComponent(new Component({}), transient());
    host.addComponent(a);
    host.addComponent(b);
    host.addComponent(c);
    host.doLayout();
    tab.setActiveContent(b);

    return { host, a, b, c };
}

/**
 * Drags the strip cell at `fromIndex` to `toIndex`, the way
 * `tests/layout/Tab.doubleClick.test.ts:163-190` drives one — there is no
 * public reorder entry point, so the bar and the strip's `"reorder"`
 * handler are driven directly.
 *
 * @param tab - The Tab manager whose strip to reorder.
 * @param fromIndex - The strip position of the cell to move.
 * @param toIndex - The strip position to move it to.
 */
function reorder(tab: Tab, fromIndex: number, toIndex: number): void {
    const bar = (tab as unknown as { _bar: { getEntryIds(): string[]; moveBarEntry(id: string, to: number): unknown } })._bar;
    const id  = bar.getEntryIds()[fromIndex];

    bar.moveBarEntry(id, toIndex);
    (tab as unknown as { _onBarReordered(fromId: string, toIndex: number): void })._onBarReordered(id, toIndex);
}

describe('serializeLayout shape', () => {
    afterEach(() => DOM.reset());

    it('captures a Split host: version, kind, orientation, children, ratios, collapsed', () => {
        installTestDOM(CONFIG);

        const split = new Container({ layoutManager: new Split({ orientation: 'horizontal' }) });
        const a = new Component({}); a.setId('a');
        const b = new Component({}); b.setId('b');

        split.addComponent(a);
        split.addComponent(b);

        const state = serializeLayout(split);

        expect(state.version).toBe(1);
        expect(state.root.kind).toBe('split');

        const root = state.root as Extract<typeof state.root, { kind: 'split' }>;

        expect(root.orientation).toBe('horizontal');
        expect(root.children.length).toBe(2);
        expect(root.ratios.reduce((t, r) => t + r, 0)).toBeCloseTo(1.0, 5);
        expect(root.collapsed.length).toBe(2);
        expect(state.windows).toEqual([]);
    });

    it('captures a leaf host as a panel node with the child id', () => {
        installTestDOM(CONFIG);

        const root = new Container({});
        const leaf = new Component({}); leaf.setId('leaf-1');

        root.addComponent(leaf);

        const state = serializeLayout(leaf);

        expect(state.root.kind).toBe('panel');
        expect((state.root as { panelId: string }).panelId).toBe('leaf-1');
    });

    it('captures a Tab host: kind tab with the active index', () => {
        installTestDOM(CONFIG);

        const tabHost = new Container({ layoutManager: new Tab() });
        const a = new Component({}); a.setId('a');
        const b = new Component({}); b.setId('b');

        tabHost.addComponent(a);
        tabHost.addComponent(b);

        const state = serializeLayout(tabHost);

        expect(state.root.kind).toBe('tab');
        expect((state.root as { activeIndex: number }).activeIndex).toBe(0);
    });

    it('records a leaf glyph from its parent constraint onto the panel node', () => {
        installTestDOM(CONFIG);

        const split = new Container({ layoutManager: new Split() });
        const a = new Component({}); a.setId('a');

        split.addComponent(a, Object.assign(new LayoutConstraints(), { glyph: 'star' }));

        const state = serializeLayout(split);
        const child = (state.root as { children: Array<{ glyph?: string | null }> }).children[0];

        expect(child.glyph).toBe('star');
    });
});

describe('PanelNode presentation and disposal constraints', () => {
    afterEach(() => DOM.reset());

    it('S1 — a captured leaf round-trips its presentation and disposal constraints', () => {
        installTestDOM(CONFIG);
        Glyph.register(circle_check);

        const tabHost = new Container({ layoutManager: new Tab() });
        const a = new Component({}); a.setId('a');

        tabHost.addComponent(a, Object.assign(new LayoutConstraints(), {
            glyph: 'circle-check', tooltip: 'T', closeable: true, disposeOnClose: false,
            italic: true, modified: true,
        }));

        const state = serializeLayout(tabHost);

        const freshRoot = new Container({});
        restoreLayout(freshRoot, state, instanceFactory({ a }));

        const constraints = freshRoot.getLayoutConstraints(a);

        expect(constraints?.glyph).toBe('circle-check');
        expect(constraints?.tooltip).toBe('T');
        expect(constraints?.closeable).toBe(true);
        expect(constraints?.disposeOnClose).toBe(false);
        expect(constraints?.italic).toBe(true);
        expect(constraints?.modified).toBe(true);
    });

    it('S2 — a state written without the new fields still restores', () => {
        installTestDOM(CONFIG);

        const a = new Component({}); a.setId('a');
        const freshRoot = new Container({});

        const state = {
            version: 1 as const,
            root:    { kind: 'panel' as const, panelId: 'a', glyph: 'star' },
            windows: [],
        };

        restoreLayout(freshRoot, state, instanceFactory({ a }));

        const constraints = freshRoot.getLayoutConstraints(a);

        expect(freshRoot.getComponents()).toContain(a);
        expect(constraints?.glyph).toBe('star');
        expect(constraints?.closeable).toBeUndefined();
        expect(constraints?.disposeOnClose).toBeUndefined();
    });

    it('S3 — a state written before italic/modified existed still restores, with both undefined', () => {
        installTestDOM(CONFIG);

        const a = new Component({}); a.setId('a');
        const freshRoot = new Container({});

        const state = {
            version: 1 as const,
            root:    { kind: 'panel' as const, panelId: 'a', glyph: 'star' },
            windows: [],
        };

        restoreLayout(freshRoot, state, instanceFactory({ a }));

        const constraints = freshRoot.getLayoutConstraints(a);

        expect(freshRoot.getComponents()).toContain(a);
        expect(constraints?.italic).toBeUndefined();
        expect(constraints?.modified).toBeUndefined();
    });
});

describe('restoreLayout round-trip', () => {
    afterEach(() => DOM.reset());

    it('reproduces a split arrangement from its own serialized state', () => {
        installTestDOM(CONFIG);

        const split = new Container({ layoutManager: new Split({ orientation: 'vertical' }) });
        const a = new Component({}); a.setId('a');
        const b = new Component({}); b.setId('b');

        split.addComponent(a);
        split.addComponent(b);

        const state = serializeLayout(split);

        restoreLayout(split, state, instanceFactory({ a, b }));

        // Same arrangement reproduced.
        expect(JSON.stringify(serializeLayout(split))).toBe(JSON.stringify(state));
    });

    it('A->B->A reproduces A exactly with no residue from B', () => {
        installTestDOM(CONFIG);

        const split = new Container({ layoutManager: new Split({ orientation: 'horizontal' }) });
        const a = new Component({}); a.setId('a');
        const b = new Component({}); b.setId('b');

        split.addComponent(a);
        split.addComponent(b);

        const factory = instanceFactory({ a, b });

        // State A: default 50/50.
        const stateA = serializeLayout(split);

        // Mutate to state B: change the ratios.
        (split.getLayoutManager() as Split).applyPaneRatios([1, 3]);

        const stateB = serializeLayout(split);

        expect(JSON.stringify(stateB)).not.toBe(JSON.stringify(stateA));

        // Restore A; it must reproduce A with no residue from B.
        restoreLayout(split, stateA, factory);

        expect(JSON.stringify(serializeLayout(split))).toBe(JSON.stringify(stateA));
    });

    it('skips a leaf whose factory returns null, warns, and re-aligns survivors', () => {
        installTestDOM(CONFIG);

        const split = new Container({ layoutManager: new Split({ orientation: 'horizontal' }) });
        // Ids unique within this file (not 'a'/'b') — the style-rule cache
        // below is process-global and not cleared by DOM.reset(), so a
        // colliding id would pick up another test's still-live rule.
        const a = new Component({}); a.setId('l3-a');
        // `backgroundColor` is a conditional declaration, never hoisted onto the
        // class rule, so it is what gives the dropped leaf a per-instance `#id`
        // rule whose fate this test tracks — a stock component now materialises
        // none at all.
        const b = new Component({ backgroundColor: '#fff' }); b.setId('l3-b');

        split.addComponent(a);
        split.addComponent(b);

        // L3: the dropped leaf is rendered before restoreLayout runs, so its
        // style rule's fate can be checked below — previously it was silently
        // orphaned but never disposed.
        b.getElement(true);
        const bId = b.getId();
        expect(_ruleCacheKeys().some(key => key.startsWith('#' + bId))).toBe(true);

        const state = serializeLayout(split);

        // Factory drops 'l3-b'.
        const factory: LayoutFactory = (id) => (id === 'l3-a' ? a : null);

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        restoreLayout(split, state, factory);

        expect(warn).toHaveBeenCalled();

        // Only the surviving leaf is placed; the dropped one is absent.
        const after = serializeLayout(split);
        const children = (after.root as { children: Array<{ panelId?: string }> }).children;

        expect(children.length).toBe(1);
        expect(children[0].panelId).toBe('l3-a');

        // L3: the dropped leaf is now disposed (caught by the scaffold-disposal
        // sweep, since it was never parked) rather than silently orphaned.
        expect(_ruleCacheKeys().some(key => key.startsWith('#' + bId))).toBe(false);

        warn.mockRestore();
    });

    it('L1: disposes the interior scaffold container left behind after leaves are parked', () => {
        installTestDOM(CONFIG);

        const root = new Container({ layoutManager: new Split({ orientation: 'horizontal' }) });
        // `backgroundColor` is a conditional declaration, never hoisted onto the
        // class rule, so it is what gives the scaffold container a per-instance
        // `#id` rule whose disposal this test asserts — a stock container now
        // materialises none at all.
        const nested = new Container({ layoutManager: new Split({ orientation: 'vertical' }), backgroundColor: '#fff' });
        const a = new Component({}); a.setId('a');
        const b = new Component({}); b.setId('b');
        const c = new Component({}); c.setId('c');

        nested.addComponent(a);
        nested.addComponent(b);
        root.addComponent(nested);
        root.addComponent(c);

        nested.getElement(true);
        const nestedId = nested.getId();
        expect(_ruleCacheKeys().some(key => key.startsWith('#' + nestedId))).toBe(true);

        const state = serializeLayout(root);

        restoreLayout(root, state, instanceFactory({ a, b, c }));

        expect(_ruleCacheKeys().some(key => key.startsWith('#' + nestedId))).toBe(false);
    });

    it('L2: detaches (but does not dispose) a transient child, mirroring a Dock empty-state placeholder', () => {
        installTestDOM(CONFIG);

        const root = new Container({ layoutManager: new Tab() });
        const leaf = new Component({}); leaf.setId('leaf');

        root.addComponent(leaf);

        const state = serializeLayout(root);

        // The transient child is mounted after the state was captured — it is
        // never part of `state`, the same way a Dock's empty-state placeholder
        // is never captured by serializeLayout.
        // `backgroundColor` is a conditional declaration, never hoisted onto the
        // class rule, so it is what gives the placeholder a per-instance `#id`
        // rule — this test asserts the rule SURVIVES (detached, not disposed),
        // and a stock component now materialises none at all.
        const placeholder = new Component({ backgroundColor: '#fff' });
        root.addComponent(placeholder, Object.assign(new LayoutConstraints(), { transient: true }));
        placeholder.getElement(true);
        const placeholderId = placeholder.getId();

        restoreLayout(root, state, instanceFactory({ leaf }));

        expect(placeholder.getParentComponent()).toBeNull();
        expect(_ruleCacheKeys().some(key => key.startsWith('#' + placeholderId))).toBe(true);
    });

    it('L2b: a transient child mounted before a leaf does not cause the leaf to be skipped', () => {
        installTestDOM(CONFIG);

        const root = new Container({ layoutManager: new Tab() });

        // Transient child mounted FIRST, ahead of the leaf: collectLeaves walks
        // getComponents() and detaches a transient child mid-walk, so removing
        // an earlier sibling must not shift a later one out from under the
        // walk's cursor and cause it to be silently skipped (and later
        // wrongly disposed rather than parked).
        const placeholder = new Component({});
        root.addComponent(placeholder, Object.assign(new LayoutConstraints(), { transient: true }));

        const leaf = new Component({}); leaf.setId('leaf-after-transient');
        root.addComponent(leaf);

        const state = serializeLayout(root);

        // Spied rather than inferred from getParentComponent(): a leaf skipped
        // by a buggy walk is left behind in root's tree, so the later
        // scaffold-disposal sweep disposes it — but materializeNode's
        // `parked.get(id) ?? factory(id)` fallback then re-attaches that same
        // (already-disposed) instance via the factory, which would make a bare
        // getParentComponent() === root check pass despite the dispose.
        const disposeSpy = vi.spyOn(leaf, 'dispose');

        restoreLayout(root, state, instanceFactory({ 'leaf-after-transient': leaf }));

        expect(disposeSpy).not.toHaveBeenCalled();
        expect(leaf.getParentComponent()).toBe(root);
    });

    it('L3: a rebuilt Tab host fills its pane instead of growing to its content\'s minimum', () => {
        installTestDOM(CONFIG);

        // A horizontal split whose second pane is a Tab host holding content
        // taller than the root — the live Dock builds that host as a
        // fit-parent Container, which clips the content to its slot.
        const root = new Container({ layoutManager: new Split({ orientation: 'horizontal' }) });
        const host = new Container({ layoutManager: new Tab() });
        const a    = new Component({}); a.setId('a');
        const b    = new Component({}); b.setId('b');

        b.setMinSize({ width: 0, height: 600 });
        host.addComponent(b);
        root.addComponent(a);
        root.addComponent(host);
        root.getElement(true);
        root.setWidth(400);
        root.setHeight(300);
        root.doLayout();

        restoreLayout(root, serializeLayout(root), instanceFactory({ a, b }));
        root.doLayout();

        const rebuilt = root.getComponents()[1];

        expect(b.getParentComponent()).toBe(rebuilt);
        expect(rebuilt.getHeight()).toBe(300);
    });
});

describe('serializeLayout of a Split holding a transient child', () => {
    afterEach(() => DOM.reset());

    // The pane weights A / B / P are given to `applyPaneRatios` as-is, so
    // `getPaneRatios` reads them straight back; dropping P leaves A and B to be
    // renormalised from 0.5 / 0.3 to these.
    const A_RATIO = 0.5;
    const B_RATIO = 0.3;
    const P_RATIO = 0.2;
    const A_KEPT  = 0.625;
    const B_KEPT  = 0.375;

    /**
     * A sized Split host holding panes A and B plus a transient placeholder P,
     * with B collapsed. The host is sized and given an element because
     * `applyPaneRatios` and `setPaneCollapsedImmediate` both need a live
     * container to write against.
     *
     * @param placeholderFirst - Mounts P ahead of A and B instead of after them,
     *   so the kept indices are `[1, 2]` rather than `[0, 1]`.
     * @returns The host, its panes, and the placeholder.
     */
    function splitWithPlaceholder(placeholderFirst: boolean): {
        host: Container; a: Component; b: Component; placeholder: Component;
    } {
        installTestDOM(CONFIG);

        const split = new Split({ orientation: 'horizontal' });
        const host  = new Container({ layoutManager: split });

        host.getElement(true);
        host.setWidth(400);
        host.setHeight(300);

        const a = new Component({}); a.setId('a');
        const b = new Component({}); b.setId('b');
        const placeholder = new Component({});

        const transient = Object.assign(new LayoutConstraints(), { transient: true });

        // B collapses toward the trailing edge, so its serving gutter is the one
        // on its leading side. A pane collapsing the default (leading) way needs
        // a gutter after it, which the last pane has none of — and B *is* last
        // once the placeholder is mounted first. One direction for both
        // orderings keeps the two setups otherwise identical.
        const trailingCollapse = new LayoutConstraints();
        trailingCollapse.collapseDirection = 'east';

        if (placeholderFirst) {
            host.addComponent(placeholder, transient);
            host.addComponent(a);
            host.addComponent(b, trailingCollapse);
            split.applyPaneRatios([P_RATIO, A_RATIO, B_RATIO]);
            split.setPaneCollapsedImmediate(2, true);
        } else {
            host.addComponent(a);
            host.addComponent(b, trailingCollapse);
            host.addComponent(placeholder, transient);
            split.applyPaneRatios([A_RATIO, B_RATIO, P_RATIO]);
            split.setPaneCollapsedImmediate(1, true);
        }

        return { host, a, b, placeholder };
    }

    /** The captured root of `host`, narrowed to a split node. */
    function splitRoot(host: Container) {
        const state = serializeLayout(host);

        expect(state.root.kind).toBe('split');

        return state.root as Extract<typeof state.root, { kind: 'split' }>;
    }

    it('1. captures only the non-transient children, in order', () => {
        const { host, a, b } = splitWithPlaceholder(false);

        const root = splitRoot(host);

        expect(root.children.length).toBe(2);
        expect(root.children.map(child => (child as { panelId: string }).panelId))
            .toEqual([a.getId(), b.getId()]);
    });

    it('2. renormalises the kept ratios so they still sum to 1.0', () => {
        const { host } = splitWithPlaceholder(false);

        const root = splitRoot(host);

        expect(root.ratios.length).toBe(2);
        expect(root.ratios[0]).toBeCloseTo(A_KEPT, 5);
        expect(root.ratios[1]).toBeCloseTo(B_KEPT, 5);
        expect(root.ratios.reduce((total, ratio) => total + ratio, 0)).toBeCloseTo(1.0, 5);
    });

    it('3. reads each kept pane\'s collapsed flag at its live index', () => {
        const { host } = splitWithPlaceholder(false);

        const root = splitRoot(host);

        expect(root.collapsed).toEqual([false, true]);
    });

    it('4. captures the same arrangement with the placeholder mounted first', () => {
        const { host: last }  = splitWithPlaceholder(false);
        const lastRoot        = splitRoot(last);

        const { host: first } = splitWithPlaceholder(true);
        const firstRoot       = splitRoot(first);

        expect(firstRoot.children.map(child => (child as { panelId: string }).panelId))
            .toEqual(lastRoot.children.map(child => (child as { panelId: string }).panelId));
        expect(firstRoot.ratios[0]).toBeCloseTo(lastRoot.ratios[0], 5);
        expect(firstRoot.ratios[1]).toBeCloseTo(lastRoot.ratios[1], 5);
        expect(firstRoot.collapsed).toEqual(lastRoot.collapsed);
    });

    it('5. captures an all-transient Split as an empty arrangement', () => {
        installTestDOM(CONFIG);

        const split = new Split({ orientation: 'horizontal' });
        const host  = new Container({ layoutManager: split });

        host.getElement(true);
        host.setWidth(400);
        host.setHeight(300);

        const transient = Object.assign(new LayoutConstraints(), { transient: true });

        host.addComponent(new Component({}), transient);
        host.addComponent(new Component({}), transient);

        const root = splitRoot(host);

        expect(root.children).toEqual([]);
        expect(root.ratios).toEqual([]);
        expect(root.collapsed).toEqual([]);
    });

    it('6. restores the captured state without warning about a skipped placeholder', () => {
        const { host, a, b } = splitWithPlaceholder(false);

        const state = serializeLayout(host);
        const warn  = vi.spyOn(console, 'warn').mockImplementation(() => {});

        restoreLayout(host, state, instanceFactory({ a, b }));

        expect(warn).not.toHaveBeenCalled();
        expect(host.getComponents()).toEqual([a, b]);

        warn.mockRestore();
    });

    it('7. detaches (but does not dispose) the transient placeholder on restore', () => {
        const { host, a, b, placeholder } = splitWithPlaceholder(false);

        // `backgroundColor` is a conditional declaration, never hoisted onto the
        // class rule, so it is what gives the placeholder a per-instance `#id`
        // rule — this asserts the rule SURVIVES, i.e. the placeholder was
        // detached rather than disposed, exactly as in the Tab case above.
        placeholder.setBackgroundColor('#fff');
        placeholder.getElement(true);

        const placeholderId = placeholder.getId();
        const state         = serializeLayout(host);

        restoreLayout(host, state, instanceFactory({ a, b }));

        expect(placeholder.getParentComponent()).toBeNull();
        expect(_ruleCacheKeys().some(key => key.startsWith('#' + placeholderId))).toBe(true);
    });
});

describe('serializeLayout of a Tab: the active index names the active child', () => {
    afterEach(() => DOM.reset());

    it('1. a transient tab ahead of the active one does not shift the recorded index', () => {
        const { host } = placeholderFirstWithBActive();

        const root = tabRoot(host);

        expect(root.activeIndex).toBe(1);
        expect(activePanelId(root)).toBe('b');
    });

    it('2. restoring that capture activates the tab that was active', () => {
        const { host, a, b, c } = placeholderFirstWithBActive();

        const state = serializeLayout(host);

        restoreLayout(host, state, instanceFactory({ a, b, c }));

        expect((host.getLayoutManager() as Tab).getActiveContent()).toBe(b);
    });

    it('3. a transient tab after the active one leaves the index as it was', () => {
        const { host, tab } = tabHost();
        const { a, b, c }   = panels();

        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);
        host.addComponent(new Component({}), transient());
        host.doLayout();
        tab.setActiveContent(b);

        const root = tabRoot(host);

        expect(root.activeIndex).toBe(1);
        expect(activePanelId(root)).toBe('b');
    });

    it('4. an active transient tab records the first captured tab, not an out-of-range index', () => {
        const { host, tab } = tabHost();
        const { a }         = panels();
        const placeholder   = new Component({});

        host.addComponent(a);
        host.addComponent(placeholder, transient());
        host.doLayout();
        tab.setActiveContent(placeholder);

        const root = tabRoot(host);

        expect(root.children.length).toBe(1);
        expect(root.activeIndex).toBe(0);
    });

    it('5. a drag-reordered strip captures its children in strip order, with the active child by identity', () => {
        const { host, tab } = tabHost();
        const { a, b, c }   = panels();

        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);
        host.doLayout();

        // Drag C to the front, the way Tab.doubleClick's reorder case drives
        // it: the strip becomes C A B while the container keeps A B C.
        reorder(tab, 2, 0);
        tab.setActiveContent(a);

        const root = tabRoot(host);

        expect(activePanelId(root)).toBe('a');
        expect(root.children.map(child => (child as { panelId: string }).panelId)).toEqual(['c', 'a', 'b']);
        expect(root.activeIndex).toBe(1);
    });

    it('6. a host whose children were never laid out records the first tab', () => {
        const { host } = tabHost();
        const { a, b } = panels();

        host.addComponent(a);
        host.addComponent(b);

        const root = tabRoot(host);

        expect(root.children.length).toBe(2);
        expect(root.activeIndex).toBe(0);
    });

    it('7. an unreordered strip still captures the container order (control)', () => {
        const { host, tab } = tabHost();
        const { a, b, c }   = panels();

        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);
        host.doLayout();
        tab.setActiveContent(a);

        const root = tabRoot(host);

        expect(root.children.map(child => (child as { panelId: string }).panelId)).toEqual(['a', 'b', 'c']);
        expect(root.activeIndex).toBe(0);
    });

    it('8. a strip reordered to put the active tab last captures that order', () => {
        const { host, tab } = tabHost();
        const { a, b, c }   = panels();

        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);
        host.doLayout();

        // A B C -> B C A.
        reorder(tab, 0, 2);
        tab.setActiveContent(c);

        const root = tabRoot(host);

        expect(root.children.map(child => (child as { panelId: string }).panelId)).toEqual(['b', 'c', 'a']);
        expect(root.activeIndex).toBe(1);
    });

    it('9. a transient tab in the reordered strip is dropped from the capture, not counted in its rank', () => {
        const { host, tab } = tabHost();
        const { a, b, c }   = panels();

        host.addComponent(new Component({}), transient());
        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);
        host.doLayout();

        // P A B C -> C P A B.
        reorder(tab, 3, 0);
        tab.setActiveContent(b);

        const root = tabRoot(host);

        expect(root.children.map(child => (child as { panelId: string }).panelId)).toEqual(['c', 'a', 'b']);
        expect(root.activeIndex).toBe(2);
    });

    it('10. a child with no strip cell yet is captured after every tabbed child', () => {
        const { host, tab } = tabHost();
        const { a, b, c }   = panels();
        const d = new Component({}); d.setId('d');

        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);
        host.doLayout();

        // A B C -> C A B.
        reorder(tab, 2, 0);
        tab.setActiveContent(a);
        host.addComponent(d);

        const root = tabRoot(host);

        expect(root.children.map(child => (child as { panelId: string }).panelId)).toEqual(['c', 'a', 'b', 'd']);
        expect(root.activeIndex).toBe(1);
    });
});

// A factory that no longer supplies a saved panel makes the restore skip it.
// The saved active index counts every saved child, so each child skipped ahead
// of the active one moves it one slot left in the strip that is built.
describe('restoreLayout of a Tab node: the saved order and the active index', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        DOM.reset();
    });

    /**
     * Restores a hand-built Tab state onto a fresh, sized Tab host, with a
     * factory that supplies only the `kept` ids. The warning each skipped id
     * raises is silenced.
     *
     * @param saved - The saved children's panel ids, in order.
     * @param activeIndex - The saved active index.
     * @param kept - The ids the factory still supplies.
     * @returns The restored Tab's active content, the components by id, and
     *   the Tab manager itself, for reading the restored strip back.
     */
    function restoreSkipping(
        saved: string[],
        activeIndex: number,
        kept: string[],
    ): { active: Component | null; byId: Record<string, Component>; tab: Tab } {
        installTestDOM(CONFIG);

        const host = new Container({ layoutManager: new Tab() });

        host.getElement(true);
        host.setWidth(400);
        host.setHeight(300);

        const byId: Record<string, Component> = {};

        kept.forEach(id => {
            byId[id] = new Component({});
            byId[id].setId(id);
        });

        const state: LayoutState = {
            version: 1,
            root:    {
                kind:     'tab',
                children: saved.map(panelId => ({ kind: 'panel' as const, panelId, glyph: null })),
                activeIndex,
            },
            windows: [],
        };

        vi.spyOn(console, 'warn').mockImplementation(() => {});

        restoreLayout(host, state, instanceFactory(byId));

        const tab = host.getLayoutManager() as Tab;

        return { active: tab.getActiveContent(), byId, tab };
    }

    it('1. a skipped tab ahead of the active one keeps the saved tab active', () => {
        const { active, byId } = restoreSkipping(['a', 'b', 'c'], 1, ['b', 'c']);

        expect(active).toBe(byId.b);
    });

    it('2. several skipped tabs ahead of the active one each move it one slot left', () => {
        const { active, byId } = restoreSkipping(['a', 'b', 'c', 'd', 'e'], 2, ['d', 'e']);

        expect(active).toBe(byId.d);
    });

    it('3. a skipped tab after the active one leaves the index as saved', () => {
        const { active, byId } = restoreSkipping(['a', 'b', 'c'], 1, ['a', 'b']);

        expect(active).toBe(byId.b);
    });

    it('4. a skipped active tab hands the selection to the tab that slid into its slot', () => {
        const { active, byId } = restoreSkipping(['a', 'b', 'c'], 1, ['a', 'c']);

        expect(active).toBe(byId.c);
    });

    it('5. a skipped last tab that was active clamps to the new last tab', () => {
        const { active, byId } = restoreSkipping(['a', 'b', 'c'], 2, ['a', 'b']);

        expect(active).toBe(byId.b);
    });

    it('6. every tab skipped leaves no active tab and does not throw', () => {
        const { active } = restoreSkipping(['a', 'b', 'c'], 1, []);

        expect(active).toBe(null);
    });

    it('7. a saved order restores as the strip, in that order', () => {
        const { active, byId, tab } = restoreSkipping(['c', 'a', 'b'], 1, ['c', 'a', 'b']);

        expect(tab.indexOfContent(byId.c)).toBe(0);
        expect(tab.indexOfContent(byId.a)).toBe(1);
        expect(tab.indexOfContent(byId.b)).toBe(2);
        expect(active).toBe(byId.a);
    });

    it('8. a tab skipped ahead of the active one moves it one slot left in the restored strip', () => {
        const { active, byId, tab } = restoreSkipping(['c', 'a', 'b'], 2, ['a', 'b']);

        expect(tab.indexOfContent(byId.a)).toBe(0);
        expect(tab.indexOfContent(byId.b)).toBe(1);
        expect(active).toBe(byId.b);
    });

    it('9. a skipped active tab hands the selection to the tab that slid into its slot', () => {
        const { active, byId, tab } = restoreSkipping(['c', 'a', 'b'], 1, ['c', 'b']);

        expect(tab.indexOfContent(byId.c)).toBe(0);
        expect(tab.indexOfContent(byId.b)).toBe(1);
        expect(active).toBe(byId.b);
    });

    it('10. every child but the saved order\'s first is skipped, and the first stays active', () => {
        const { active, byId, tab } = restoreSkipping(['c', 'a', 'b'], 0, ['c']);

        expect(tab.indexOfContent(byId.c)).toBe(0);
        expect(active).toBe(byId.c);
    });
});

describe('a reordered Tab strip survives save and restore', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        DOM.reset();
    });

    /**
     * Builds A B C, drags C to the front (strip C A B), activates A, and
     * captures the state — the save half of every row below.
     *
     * @returns The host, its panels, and the captured state.
     */
    function reorderedCapture(): { host: Container; a: Component; b: Component; c: Component; state: LayoutState } {
        const { host, tab } = tabHost();
        const { a, b, c }   = panels();

        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);
        host.doLayout();
        reorder(tab, 2, 0);
        tab.setActiveContent(a);

        return { host, a, b, c, state: serializeLayout(host) };
    }

    it('1. restoring a reordered capture reproduces the strip and the active tab', () => {
        const { host, a, b, c, state } = reorderedCapture();

        restoreLayout(host, state, instanceFactory({ a, b, c }));

        const tab = host.getLayoutManager() as Tab;

        expect(tab.indexOfContent(c)).toBe(0);
        expect(tab.indexOfContent(a)).toBe(1);
        expect(tab.indexOfContent(b)).toBe(2);
        expect(tab.getActiveContent()).toBe(a);
    });

    it('2. capturing a restored order again yields the same node', () => {
        const { host, a, b, c, state } = reorderedCapture();

        restoreLayout(host, state, instanceFactory({ a, b, c }));

        expect(serializeLayout(host)).toEqual(state);

        const root = state.root as TabNode;

        expect(root.children.map(child => (child as { panelId: string }).panelId)).toEqual(['c', 'a', 'b']);
        expect(root.activeIndex).toBe(1);
    });

    it('3. a tab added after the save is parked, not placed, when its factory still knows it', () => {
        const { host, a, b, c, state } = reorderedCapture();
        const d = new Component({}); d.setId('d');

        host.addComponent(d);

        const disposeSpy = vi.spyOn(d, 'dispose');

        restoreLayout(host, state, instanceFactory({ a, b, c, d }));

        const tab = host.getLayoutManager() as Tab;

        expect(tab.indexOfContent(c)).toBe(0);
        expect(tab.indexOfContent(a)).toBe(1);
        expect(tab.indexOfContent(b)).toBe(2);
        expect(d.getParentComponent()).toBeNull();
        expect(disposeSpy).not.toHaveBeenCalled();
    });

    it('4. a tab added after the save is disposed with the rest of the scaffold when its factory no longer knows it', () => {
        const { host, a, b, c, state } = reorderedCapture();
        const d = new Component({}); d.setId('d');

        host.addComponent(d);

        const disposeSpy = vi.spyOn(d, 'dispose');

        restoreLayout(host, state, instanceFactory({ a, b, c }));

        const tab = host.getLayoutManager() as Tab;

        expect(tab.indexOfContent(c)).toBe(0);
        expect(tab.indexOfContent(a)).toBe(1);
        expect(tab.indexOfContent(b)).toBe(2);
        expect(disposeSpy).toHaveBeenCalled();
    });

    it('5. a tab removed before the restore is skipped and the selection lands on its neighbour', () => {
        const { host, b, c, state } = reorderedCapture();

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        restoreLayout(host, state, instanceFactory({ b, c }));

        const tab = host.getLayoutManager() as Tab;

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('"a"'));
        expect(tab.indexOfContent(c)).toBe(0);
        expect(tab.indexOfContent(b)).toBe(1);
        expect(tab.getActiveContent()).toBe(b);
    });

    it('L1 — a restored floating window takes no focus when shown and ends with autoFocus on', () => {
        installTestDOM(CONFIG);

        // Collects the show-time focus moves a shown window queues, so the
        // case decides when they run (as AbstractWindow.focus.test.ts does).
        const scheduled: Array<() => void> = [];
        vi.spyOn(Component, 'afterNextLayout').mockImplementation((cb: () => void) => {
            scheduled.push(cb);

            return { cancel: vi.fn() };
        });

        const opener = new Button({ text: 'Open' }).getElement(true)!;

        setConnected(opener, true);
        DOM.sink.focus(opener);

        const b = new Component({}); b.setId('b');
        const freshRoot = new Container({});

        const state: LayoutState = {
            version: 1 as const,
            root:    { kind: 'panel' as const, panelId: 'a', glyph: null },
            windows: [{
                kind:        'window' as const,
                panelId:     'b',
                header:      'Float',
                rect:        { x: 10, y: 10, width: 300, height: 200 },
                state:       'normal' as const,
                restoreRect: null,
            }],
        } as LayoutState;

        restoreLayout(freshRoot, state, instanceFactory({ a: new Component({}), b }));
        scheduled.splice(0).forEach(cb => cb());

        const floats = [...AbstractWindow.getOpenWindows()].filter(w => w.getTitle() === 'Float');

        expect(floats).toHaveLength(1);
        expect(DOM.source.getActiveElement()).toBe(opener);
        expect(floats[0].isAutoFocus()).toBe(true);

        floats.forEach(w => w.dispose());
    });
});

describe('a window that hosts the root is not a float', () => {
    afterEach(() => {
        AbstractWindow.getOpenWindows().forEach(w => w.dispose());
        vi.restoreAllMocks();
        DOM.reset();
    });

    /** A Tab root holding panel `a`, placed inside a shown Window. */
    function rootInWindow(): { win: Window; root: Container; a: Component } {
        const a = new Component({}); a.setId('a');
        const root = new Container({ layoutManager: new Tab() });
        const win = new Window('Host');

        root.addComponent(a);
        win.addComponent(root);
        win.show();
        win.doLayout();

        return { win, root, a };
    }

    it('H1 — serializeLayout records no window node for the window hosting the root, but does for a float', () => {
        installTestDOM(CONFIG);

        const { root } = rootInWindow();
        const b = new Component({}); b.setId('b');
        const float = new Window('Float');

        float.addComponent(b);
        float.show();

        const state = serializeLayout(root);

        expect(state.windows.map(w => w.header)).toEqual(['Float']);
    });

    it('H2 — restoring a root that lives in a window warns about nothing and keeps the host open', () => {
        installTestDOM(CONFIG);

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { win, root, a } = rootInWindow();
        const state = serializeLayout(root);

        restoreLayout(root, state, instanceFactory({ a }));

        expect(warn).not.toHaveBeenCalled();
        expect(AbstractWindow.getOpenWindows()).toEqual([win]);
        expect((root.getLayoutManager() as Tab).indexOfContent(a)).toBe(0);
    });
});

describe('the includeWindow option', () => {
    afterEach(() => {
        AbstractWindow.getOpenWindows().forEach(w => w.dispose());
        vi.restoreAllMocks();
        DOM.reset();
    });

    /**
     * A page-level Tab root holding panel `a`, then a shown `Settings` window
     * holding `settings-form`, then a shown `Float` window holding panel `b`.
     */
    function rootSettingsAndFloat(): {
        root: Container; a: Component; b: Component;
        settings: Window; settingsForm: Component; float: Window;
    } {
        const { host: root } = tabHost();
        const { a, b } = panels();

        root.addComponent(a);
        root.doLayout();

        const settingsForm = new Component({}); settingsForm.setId('settings-form');
        const settings = new Window('Settings');

        settings.addComponent(settingsForm);
        settings.show();

        const float = new Window('Float');

        float.addComponent(b);
        float.show();

        return { root, a, b, settings, settingsForm, float };
    }

    it('LW1 — the default save records every window that does not host the root', () => {
        const { root } = rootSettingsAndFloat();

        expect(serializeLayout(root).windows.map(w => w.header)).toEqual(['Settings', 'Float']);
    });

    it('LW2 — the default restore closes every such window and warns for a panel the factory does not know', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { root, a, b, settings } = rootSettingsAndFloat();

        restoreLayout(root, serializeLayout(root), instanceFactory({ a, b }));

        expect(AbstractWindow.getOpenWindows()).not.toContain(settings);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('"settings-form"'));
    });

    it('LW3 — a save records only the windows includeWindow accepts, asking once per open window', () => {
        const { root, settings, float } = rootSettingsAndFloat();
        const includeWindow = vi.fn((w: AbstractWindow): boolean => w !== settings);
        const state = serializeLayout(root, { includeWindow });

        expect(state.windows.map(w => w.header)).toEqual(['Float']);
        expect(includeWindow.mock.calls).toEqual([[settings], [float]]);
    });

    it('LW4 — a restore leaves a window includeWindow refuses open and untouched', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { root, a, b, settings, settingsForm, float } = rootSettingsAndFloat();
        const state = serializeLayout(root, { includeWindow: w => w !== settings });

        // Records, per call, whether the window was still open and `b` still
        // in `float` — i.e. that every question is asked before any park or close.
        const seen: Array<[AbstractWindow, boolean, boolean]> = [];

        const includeWindow = (w: AbstractWindow): boolean => {
            seen.push([w, AbstractWindow.getOpenWindows().includes(w), b.getParentComponent() === float]);

            return w !== settings;
        };

        restoreLayout(root, state, instanceFactory({ a, b }), { includeWindow });

        expect(seen).toEqual([[settings, true, true], [float, true, true]]);

        const open = AbstractWindow.getOpenWindows();
        const floats = open.filter(w => w.getTitle() === 'Float');

        expect(open).toContain(settings);
        expect(settingsForm.getParentComponent()).toBe(settings);
        expect(open).not.toContain(float);
        expect(floats).toHaveLength(1);
        expect(b.getParentComponent()).toBe(floats[0]);
        expect(warn).not.toHaveBeenCalled();
    });

    it('LW5 — a window that hosts the root is never offered to includeWindow', () => {
        installTestDOM(CONFIG);

        const a = new Component({}); a.setId('a');
        const root = new Container({ layoutManager: new Tab() });
        const host = new Window('Host');

        root.addComponent(a);
        host.addComponent(root);
        host.show();
        host.doLayout();

        const includeWindow = vi.fn((): boolean => true);
        const state = serializeLayout(root, { includeWindow });

        expect(state.windows).toEqual([]);

        restoreLayout(root, state, instanceFactory({ a }), { includeWindow });

        expect(includeWindow).not.toHaveBeenCalled();
        expect(AbstractWindow.getOpenWindows()).toEqual([host]);
    });

    it('LW6 — a factory-known leaf in a refused window is not parked, and the restore moves it into place', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { host: root } = tabHost();
        const { a, b } = panels();

        root.addComponent(a);
        root.doLayout();

        const other = new Window('Other');

        other.addComponent(b);
        other.show();

        const state: LayoutState = {
            version: 1,
            root:    {
                kind:        'tab',
                children:    [{ kind: 'panel', panelId: 'a', glyph: null }, { kind: 'panel', panelId: 'b', glyph: null }],
                activeIndex: 0,
            },
            windows: [],
        };

        restoreLayout(root, state, instanceFactory({ a, b }), { includeWindow: () => false });

        expect(b.getParentComponent()).toBe(root);
        expect(AbstractWindow.getOpenWindows()).toContain(other);
        expect(warn).not.toHaveBeenCalled();
    });

    it('LW7 — a factory-known leaf in a refused window the state does not name stays in that window', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { host: root } = tabHost();
        const { a, b } = panels();

        root.addComponent(a);
        root.doLayout();

        const other = new Window('Other');

        other.addComponent(b);
        other.show();

        const state: LayoutState = {
            version: 1,
            root:    { kind: 'tab', children: [{ kind: 'panel', panelId: 'a', glyph: null }], activeIndex: 0 },
            windows: [],
        };

        restoreLayout(root, state, instanceFactory({ a, b }), { includeWindow: () => false });

        expect(b.getParentComponent()).toBe(other);
        expect(b.isDestroyed()).toBe(false);
        expect(AbstractWindow.getOpenWindows()).toContain(other);
        expect(warn).not.toHaveBeenCalled();
    });
});

describe('a tab-strip window', () => {
    afterEach(() => {
        AbstractWindow.getOpenWindows().forEach(w => w.dispose());
        vi.restoreAllMocks();
        DOM.reset();
    });

    /** The geometry fields of a hand-built window node, as in the `L1` restore test. */
    const GEOMETRY = {
        header:      'H',
        rect:        { x: 10, y: 10, width: 300, height: 200 },
        state:       'normal' as const,
        restoreRect: null,
    };

    /** A component with id `id` and name (tab label) `id.toUpperCase()`. */
    function named(id: string): Component {
        return new Component({ id, name: id.toUpperCase() });
    }

    /** A panel node naming `panelId`. */
    function panel(panelId: string): PanelNode {
        return { kind: 'panel', panelId };
    }

    /** The panel ids of a tab node's children, in order. */
    function childIds(node: TabNode): string[] {
        return node.children.map(child => (child as PanelNode).panelId);
    }

    /**
     * An empty Tab root, then a shown `TabWindow` holding `x`, `y` and `z`, with
     * `y` active and carrying `closeable: false` and `tooltip: 'TY'`.
     */
    function stripSetup(): {
        root: Container; x: Component; y: Component; z: Component; tw: TabWindow; factory: LayoutFactory;
    } {
        const { host: root } = tabHost();
        const x = named('x');
        const y = named('y');
        const z = named('z');
        const tw = new TabWindow();

        tw.createTab(x);

        // Placed with its constraints first, so createTab's own move is a no-op
        // and `y` keeps them.
        tw.moveComponent(y, undefined, Object.assign(new LayoutConstraints(), { closeable: false, tooltip: 'TY' }));
        tw.createTab(y);
        tw.createTab(z);
        (tw.getLayoutManager() as Tab).setActiveTabIndex(1);
        tw.show();

        return { root, x, y, z, tw, factory: instanceFactory({ x, y, z }) };
    }

    /** The one open window, asserted to be the only one. */
    function onlyOpenWindow(): AbstractWindow {
        const open = AbstractWindow.getOpenWindows();

        expect(open).toHaveLength(1);

        return open[0];
    }

    it('TW1 — a TabWindow is saved with every tab', () => {
        const { root } = stripSetup();
        const { windows } = serializeLayout(root);

        expect(windows).toHaveLength(1);
        expect(windows[0].windowMode).toBe('strip');
        expect(windows[0].header).toBe('Y');

        const content = windows[0].content as TabNode;

        expect(content.kind).toBe('tab');
        expect(childIds(content)).toEqual(['x', 'y', 'z']);
        expect(content.activeIndex).toBe(1);
        expect(content.children[1]).toMatchObject({ closeable: false, tooltip: 'TY' });
    });

    it('TW2 — restore rebuilds a TabWindow with every tab, the active one and the constraints', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { root, x, y, z, tw, factory } = stripSetup();

        restoreLayout(root, serializeLayout(root), factory);

        expect(AbstractWindow.getOpenWindows()).not.toContain(tw);

        const restored = onlyOpenWindow();

        expect(restored).toBeInstanceOf(TabWindow);
        expect(restored).not.toBe(tw);
        expect(restored.getComponents().map(c => c.getId())).toEqual(['x', 'y', 'z']);
        expect((restored.getLayoutManager() as Tab).getActiveContent()).toBe(y);
        expect(restored.getTitle()).toBe('Y');
        expect(restored.getLayoutConstraints(y)?.closeable).toBe(false);
        expect([x, y, z].map(c => c.isDestroyed())).toEqual([false, false, false]);
        expect(warn).not.toHaveBeenCalled();
    });

    it('TW3 — a strip-order reorder survives', () => {
        const { root, x, y, z, tw, factory } = stripSetup();
        const tab = tw.getLayoutManager() as Tab;

        reorder(tab, 2, 0);
        tab.setActiveContent(y);

        restoreLayout(root, serializeLayout(root), factory);

        const restoredTab = onlyOpenWindow().getLayoutManager() as Tab;

        expect(restoredTab.indexOfContent(z)).toBe(0);
        expect(restoredTab.indexOfContent(x)).toBe(1);
        expect(restoredTab.indexOfContent(y)).toBe(2);
        expect(restoredTab.getActiveContent()).toBe(y);
    });

    it('TW4 — a missing tab is skipped and the active tab is kept', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { root, y, z } = stripSetup();

        restoreLayout(root, serializeLayout(root), instanceFactory({ y, z }));

        const restored = onlyOpenWindow();

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('"x"'));
        expect(restored).toBeInstanceOf(TabWindow);
        expect(restored.getComponents()).toEqual([y, z]);
        expect((restored.getLayoutManager() as Tab).getActiveContent()).toBe(y);
    });

    it('TW5 — a one-tab strip comes back as a TabWindow', () => {
        const { host: root } = tabHost();
        const x = named('x');
        const tw = new TabWindow();

        tw.createTab(x);
        tw.show();

        const state = serializeLayout(root);

        expect(state.windows).toHaveLength(1);
        expect(state.windows[0].windowMode).toBe('strip');
        expect(state.windows[0].content?.kind).toBe('tab');
        expect(childIds(state.windows[0].content as TabNode)).toEqual(['x']);

        restoreLayout(root, state, instanceFactory({ x }));

        const restored = onlyOpenWindow();

        expect(restored).toBeInstanceOf(TabWindow);
        expect(restored).not.toBe(tw);
        expect(restored.getComponents()).toEqual([x]);
    });

    it('TW6 — a bare window records no windowMode and restores as a Window', () => {
        const { host: root } = tabHost();
        const x = named('x');
        const win = new Window('Plain');

        win.addComponent(x);
        win.show();

        const state = serializeLayout(root);

        expect(state.windows).toHaveLength(1);
        expect('windowMode' in state.windows[0]).toBe(false);

        restoreLayout(root, state, instanceFactory({ x }));

        const restored = onlyOpenWindow();

        expect(restored).toBeInstanceOf(Window);
        expect(restored).not.toBeInstanceOf(TabWindow);
    });

    /** Restores one hand-written window node onto an empty Tab root. */
    function restoreWindowNode(node: WindowNode, factory: LayoutFactory): void {
        const { host: root } = tabHost();

        restoreLayout(root, { version: 1, root: { kind: 'tab', children: [], activeIndex: 0 }, windows: [node] }, factory);
    }

    it('TW7a — a "strip" node whose content is one panel opens a TabWindow holding it', () => {
        const x = named('x');

        restoreWindowNode({ kind: 'window', windowMode: 'strip', content: panel('x'), ...GEOMETRY }, instanceFactory({ x }));

        const restored = onlyOpenWindow();

        expect(restored).toBeInstanceOf(TabWindow);
        expect(restored.getComponents()).toEqual([x]);
        expect((restored.getLayoutManager() as Tab).getActiveContent()).toBe(x);

        // The title is the active tab's label; the saved header 'H' is not read.
        expect(restored.getTitle()).toBe('X');
    });

    it('TW7b — a "strip" node with only a legacy panelId opens a TabWindow holding it', () => {
        const x = named('x');

        restoreWindowNode({ kind: 'window', windowMode: 'strip', panelId: 'x', ...GEOMETRY }, instanceFactory({ x }));

        const restored = onlyOpenWindow();

        expect(restored).toBeInstanceOf(TabWindow);
        expect(restored.getComponents()).toEqual([x]);
        expect((restored.getLayoutManager() as Tab).getActiveContent()).toBe(x);
    });

    it('TW7c — a "strip" node none of whose tabs can be placed opens no window', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const dispose = vi.spyOn(TabWindow.prototype, 'dispose');

        restoreWindowNode({
            kind:       'window',
            windowMode: 'strip',
            content:    { kind: 'tab', children: [panel('gone'), panel('gone2')], activeIndex: 0 },
            ...GEOMETRY,
        }, instanceFactory({}));

        expect(AbstractWindow.getOpenWindows()).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(2);

        // The never-shown TabWindow the restore built is disposed, not leaked.
        expect(dispose).toHaveBeenCalledTimes(1);

        const built = dispose.mock.contexts[0] as TabWindow;

        expect(built).toBeInstanceOf(TabWindow);
        expect(built.isDestroyed()).toBe(true);
    });

    it('TW7d — a "strip" node whose content is a split opens a TabWindow whose one tab holds that split', () => {
        const x = named('x');
        const y = named('y');

        restoreWindowNode({
            kind:       'window',
            windowMode: 'strip',
            content:    {
                kind:        'split',
                orientation: 'horizontal',
                children:    [panel('x'), panel('y')],
                ratios:      [0.5, 0.5],
                collapsed:   [false, false],
            },
            ...GEOMETRY,
        }, instanceFactory({ x, y }));

        const restored = onlyOpenWindow();
        const tabs = restored.getComponents();

        expect(restored).toBeInstanceOf(TabWindow);
        expect(tabs).toHaveLength(1);
        expect(tabs[0].getLayoutManager()).toBeInstanceOf(Split);
        expect(tabs[0].getComponents()).toEqual([x, y]);
    });

    it('TW8 — a window node without windowMode still restores as a Window holding a Tab container', () => {
        const { root, x, y, z, factory } = stripSetup();

        // TW1's saved shape, minus `windowMode`: what an older reader, or an
        // edited state, presents.
        const state: LayoutState = {
            version: 1,
            root:    { kind: 'tab', children: [], activeIndex: 0 },
            windows: [{
                kind:    'window',
                content: { kind: 'tab', children: [panel('x'), panel('y'), panel('z')], activeIndex: 1 },
                ...GEOMETRY,
            }],
        };

        restoreLayout(root, state, factory);

        const restored = onlyOpenWindow();

        expect(restored).toBeInstanceOf(Window);
        expect(restored).not.toBeInstanceOf(TabWindow);

        const content = restored.getComponents().find(c => !restored.isChromeComponent(c))!;

        expect(content.getLayoutManager()).toBeInstanceOf(Tab);
        expect(content.getComponents()).toEqual([x, y, z]);
    });

    it('TW9 — a restored strip window takes no focus when shown and ends with autoFocus on', () => {
        installTestDOM(CONFIG);

        // Collects the show-time focus moves a shown window queues, so the
        // case decides when they run (as L1 does).
        const scheduled: Array<() => void> = [];
        vi.spyOn(Component, 'afterNextLayout').mockImplementation((cb: () => void) => {
            scheduled.push(cb);

            return { cancel: vi.fn() };
        });

        const opener = new Button({ text: 'Open' }).getElement(true)!;

        setConnected(opener, true);
        DOM.sink.focus(opener);

        const x = named('x');
        const y = named('y');

        restoreLayout(new Container({}), {
            version: 1,
            root:    { kind: 'tab', children: [], activeIndex: 0 },
            windows: [{
                kind:       'window',
                windowMode: 'strip',
                content:    { kind: 'tab', children: [panel('x'), panel('y')], activeIndex: 0 },
                ...GEOMETRY,
            }],
        }, instanceFactory({ x, y }));
        scheduled.splice(0).forEach(cb => cb());

        const restored = onlyOpenWindow();

        expect(restored).toBeInstanceOf(TabWindow);
        expect(DOM.source.getActiveElement()).toBe(opener);
        expect(restored.isAutoFocus()).toBe(true);
    });

    /** A rect that differs from every default and from `GEOMETRY.rect`. */
    const MOVED_RECT = { x: 123, y: 77, width: 410, height: 290 };

    it('TW10 — a restored strip window keeps its saved rect', () => {
        const { root, tw, factory } = stripSetup();

        tw.applyRect(MOVED_RECT);
        tw.doLayout();

        const state = serializeLayout(root);

        expect(state.windows[0].rect).toEqual(MOVED_RECT);

        restoreLayout(root, state, factory);

        const restored = onlyOpenWindow();

        expect(restored).toBeInstanceOf(TabWindow);
        expect(restored.getRect()).toEqual(MOVED_RECT);
        expect(restored.getWindowState()).toBe('normal');
        expect(restored.getRestoreRect()).toBeNull();
    });

    it('TW11 — a maximized strip window comes back maximized with its saved restoreRect', () => {
        const { root, tw, factory } = stripSetup();

        tw.applyRect(MOVED_RECT);
        tw.doLayout();
        tw.setWindowState('maximized');

        const state = serializeLayout(root);

        expect(state.windows[0].state).toBe('maximized');
        expect(state.windows[0].restoreRect).toEqual(MOVED_RECT);

        restoreLayout(root, state, factory);

        const restored = onlyOpenWindow();

        expect(restored).toBeInstanceOf(TabWindow);
        expect(restored.getWindowState()).toBe('maximized');
        expect(restored.getRestoreRect()).toEqual(MOVED_RECT);
    });

    it('TW12 — a restored strip window holding a non-closeable tab is not closeable', () => {
        const { root, factory } = stripSetup();

        restoreLayout(root, serializeLayout(root), factory);

        const restored = onlyOpenWindow();

        expect(restored).toBeInstanceOf(TabWindow);
        expect(restored.isCloseable()).toBe(false);
    });

    it('TW13 — a restored bare window keeps its saved rect', () => {
        const { host: root } = tabHost();
        const x = named('x');
        const win = new Window('Plain');

        win.addComponent(x);
        win.show();
        win.applyRect(MOVED_RECT);
        win.doLayout();

        restoreLayout(root, serializeLayout(root), instanceFactory({ x }));

        const restored = onlyOpenWindow();

        expect(restored).not.toBe(win);
        expect(restored.getRect()).toEqual(MOVED_RECT);
    });
});

describe('the isPanel option', () => {
    afterEach(() => {
        AbstractWindow.getOpenWindows().forEach(w => w.dispose());
        vi.restoreAllMocks();
        DOM.reset();
    });

    /**
     * A Tab root holding panel `a`, then `framed`: a container with id
     * `framed` whose own Tab holds `inner`.
     */
    function framedSetup(): { root: Container; a: Component; framed: Container; inner: Component } {
        const { host: root } = tabHost();
        const { a } = panels();
        const framed = new Container({ id: 'framed', layoutManager: new Tab() });
        const inner = new Component({ id: 'inner' });

        framed.addComponent(inner);
        root.addComponent(a);
        root.addComponent(framed);
        root.doLayout();

        return { root, a, framed, inner };
    }

    it('IP1 — the save records a marked container as one panel', () => {
        const { root, framed } = framedSetup();
        const saved = serializeLayout(root, { isPanel: c => c === framed }).root as TabNode;

        expect(saved.kind).toBe('tab');
        expect(saved.children.map(child => child.kind)).toEqual(['panel', 'panel']);
        expect(saved.children.map(child => (child as PanelNode).panelId)).toEqual(['a', 'framed']);
    });

    it('IP2 — the restore parks a marked container whole', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { root, a, framed, inner } = framedSetup();
        const options = { isPanel: (c: Component): boolean => c === framed };
        const state = serializeLayout(root, options);

        restoreLayout(root, state, instanceFactory({ a, framed }), options);

        expect(framed.isDestroyed()).toBe(false);
        expect(framed.getParentComponent()).toBe(root);
        expect(inner.getParentComponent()).toBe(framed);
        expect(warn).not.toHaveBeenCalled();
    });

    it('IP3 — isPanel is never asked about root or a window, and the default descends', () => {
        const { root, a, framed, inner } = framedSetup();
        const tw = new TabWindow();
        const x = new Component({ id: 'x' });

        tw.createTab(x);
        tw.show();

        const isPanel = vi.fn((_c: Component): boolean => false);
        const state = serializeLayout(root, { isPanel });

        restoreLayout(root, state, instanceFactory({ a, inner, x }), { isPanel });

        const asked = isPanel.mock.calls.map(([c]) => c);

        expect(asked).toContain(framed);
        expect(asked).not.toContain(root);
        expect(asked).not.toContain(tw);
        expect(asked.some(c => c instanceof AbstractWindow)).toBe(false);
        expect((serializeLayout(root).root as TabNode).children[1].kind).toBe('tab');
    });
});

describe('restoreLayout keeps the ratios of nested splits', () => {
    afterEach(() => DOM.reset());

    type Orientation = 'horizontal' | 'vertical';

    /**
     * A laid-out 1000 × 600 horizontal root split holding a nested split of
     * leaves `n0…` (one per minimum, each held to it along the nested axis)
     * and a leaf `z`, so the nested split is 500 px wide. The nested split
     * gets `ratios` and the root is laid out again.
     *
     * @returns The root, its leaves by id, and the nested split's manager.
     */
    function nestedHost(orientation: Orientation, mins: number[], ratios: number[], collapsedIndex?: number): { root: Container; leaves: Record<string, Component>; nested: Split } {
        installTestDOM(CONFIG);

        const root   = new Container({ layoutManager: new Split({ orientation: 'horizontal' }) });
        const nested = new Split({ orientation });
        const inner  = new Container({ layoutManager: nested });
        const leaves: Record<string, Component> = {};

        root.getElement(true);
        root.setWidth(1000);
        root.setHeight(600);

        mins.forEach((min, index) => {
            const leaf = new Component({});

            leaf.setId(`n${index}`);
            leaf.setMinSize(orientation === 'horizontal' ? { width: min, height: 0 } : { width: 0, height: min });
            inner.addComponent(leaf);
            leaves[`n${index}`] = leaf;
        });

        const z = new Component({});

        z.setId('z');
        leaves.z = z;
        root.addComponent(inner);
        root.addComponent(z);
        root.doLayout();

        nested.applyPaneRatios(ratios);

        if (collapsedIndex !== undefined) {
            nested.setPaneCollapsedImmediate(collapsedIndex, true);
        }

        root.doLayout();

        return { root, leaves, nested };
    }

    /** Saves `root` and restores it in place from the same leaves. */
    function saveAndRestore(root: Container, leaves: Record<string, Component>): void {
        const state = serializeLayout(root);

        restoreLayout(root, state, instanceFactory(leaves));
    }

    /** The split manager of the nested split `restoreLayout` rebuilt. */
    function restoredNested(root: Container): Split {
        return root.getComponents()[0].getLayoutManager() as Split;
    }

    function expectRatios(actual: number[], expected: number[]): void {
        expect(actual).toHaveLength(expected.length);
        expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 3));
    }

    it('L1: a vertical split held to minimum heights', () => {
        const { root, leaves } = nestedHost('vertical', [24, 24], [0.8, 0.2]);

        saveAndRestore(root, leaves);
        root.doLayout();

        expectRatios(restoredNested(root).getPaneRatios(), [0.8, 0.2]);
    });

    it('L2: a horizontal split whose panes have different minimum widths', () => {
        const { root, leaves } = nestedHost('horizontal', [50, 100, 150], [0.5, 0.2, 0.3]);

        saveAndRestore(root, leaves);
        root.doLayout();

        expectRatios(restoredNested(root).getPaneRatios(), [0.5, 0.2, 0.3]);
    });

    it('L3: no pane is squeezed beside one with a large minimum width', () => {
        const { root, leaves } = nestedHost('horizontal', [0, 300, 0], [0.2, 0.6, 0.2]);

        saveAndRestore(root, leaves);
        root.doLayout();

        expectRatios(restoredNested(root).getPaneRatios(), [0.2, 0.6, 0.2]);
        ['n0', 'n1', 'n2'].forEach(id => expect(leaves[id].getWidth()).toBeGreaterThanOrEqual(99));
    });

    it('L4: a save straight after the restore records the restored ratios', () => {
        const { root, leaves } = nestedHost('vertical', [24, 24], [0.8, 0.2]);

        saveAndRestore(root, leaves);

        const node = serializeLayout(root).root as SplitNode;

        expectRatios((node.children[0] as SplitNode).ratios, [0.8, 0.2]);
    });

    it('L5: a collapsed pane is restored collapsed beside the ratios', () => {
        const { root, leaves } = nestedHost('vertical', [24, 24, 24], [0.6, 0.3, 0.1], 1);

        saveAndRestore(root, leaves);
        root.doLayout();

        const nested = restoredNested(root);

        expectRatios(nested.getPaneRatios(), [0.6, 0.3, 0.1]);
        expect(nested.isPaneCollapsed(1)).toBe(true);
    });
});
