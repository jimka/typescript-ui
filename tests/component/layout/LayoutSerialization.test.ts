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
        const a = new Component({}); a.setId('a');
        const b = new Component({}); b.setId('b');

        split.addComponent(a);
        split.addComponent(b);

        const state = serializeLayout(split);

        // Factory drops 'b'.
        const factory: LayoutFactory = (id) => (id === 'a' ? a : null);

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        restoreLayout(split, state, factory);

        expect(warn).toHaveBeenCalled();

        // Only the surviving leaf is placed; the dropped one is absent.
        const after = serializeLayout(split);
        const children = (after.root as { children: Array<{ panelId?: string }> }).children;

        expect(children.length).toBe(1);
        expect(children[0].panelId).toBe('a');

        warn.mockRestore();
    });
});
