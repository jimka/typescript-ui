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
import { serializeLayout, restoreLayout, type LayoutFactory } from '~/layout/LayoutSerialization';
import { Glyph } from '~/component/display/Glyph';
import { circle_check } from '~/glyphs/solid/circle_check';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
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
