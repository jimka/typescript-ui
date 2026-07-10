import { describe, it, expect, afterEach } from 'vitest';
import { TabBar, TabToolDescriptor } from '~/component/container/TabBar';
import { Button } from '~/component/button/Button';
import { Component } from '~/core/Component';
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

// The tool registry is private (no public accessor exists), so the dispatch
// contract is asserted through a typed view of the two backing fields.
interface ToolState {
    _tools: Component[];
    _toolMenuItems: Map<Component, TabToolDescriptor>;
}

function toolState(bar: TabBar): ToolState {
    return bar as unknown as ToolState;
}

describe('TabBar.addTool dispatch', () => {
    afterEach(() => DOM.reset());

    it('adds a plain Component tool with no menu row', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();
        const tool = new Button({ text: 'Settings' });

        bar.addTool(tool);

        const state = toolState(bar);
        expect(state._tools).toContain(tool);
        expect(state._toolMenuItems.has(tool)).toBe(false);
    });

    it('builds a flat, tooltip\'d Button from a descriptor and registers its menu row', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();
        const descriptor: TabToolDescriptor = { label: 'New tab', action: () => {} };

        bar.addTool(descriptor);

        const state = toolState(bar);
        const built = state._tools[state._tools.length - 1];

        expect(built).toBeInstanceOf(Button);
        expect((built as Button).isFlat()).toBe(true);
        // The menu row is fed the same descriptor, whose `action` is the exact
        // reference wired to the built button — one source of truth, no divergence.
        expect(state._toolMenuItems.get(built)).toBe(descriptor);
        expect(state._toolMenuItems.get(built)!.action).toBe(descriptor.action);
    });

    it('removeTool drops the built tool from both the list and the menu map', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();
        const descriptor: TabToolDescriptor = { label: 'New tab', action: () => {} };

        bar.addTool(descriptor);

        const state = toolState(bar);
        const built = state._tools[state._tools.length - 1];

        bar.removeTool(built);

        expect(state._tools).not.toContain(built);
        expect(state._toolMenuItems.has(built)).toBe(false);
    });

    it('the widened tools option dispatches each element to the matching overload', () => {
        installTestDOM(CONFIG);

        const plain = new Button({ text: 'Settings' });
        const descriptor: TabToolDescriptor = { label: 'New tab', action: () => {} };
        const bar = new TabBar({ tools: [plain, descriptor] });

        const state = toolState(bar);
        // Plain element stays a bare tool; descriptor element becomes a built menu tool.
        expect(state._tools).toContain(plain);
        expect(state._toolMenuItems.has(plain)).toBe(false);
        expect(state._tools.length).toBe(2);
        expect(state._toolMenuItems.size).toBe(1);
        const built = state._tools.find(t => t !== plain)!;
        expect(state._toolMenuItems.get(built)).toBe(descriptor);
    });
});
