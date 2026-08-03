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
        const b = new Component({}); b.setId('l3-b');

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
        const nested = new Container({ layoutManager: new Split({ orientation: 'vertical' }) });
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
        const placeholder = new Component({});
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
