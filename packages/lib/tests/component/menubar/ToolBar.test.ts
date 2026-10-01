import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolBar } from '~/component/menubar/ToolBar';
import { ToolBarSeparator } from '~/component/menubar/ToolBarSeparator';
import { Button } from '~/component/button/Button';
import { Text } from '~/component/input/Text';
import { TextField } from '~/component/input/TextField';
import { HBox } from '~/layout/HBox';
import { VBox } from '~/layout/VBox';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { SpatialNavigation } from '~/core/SpatialNavigation';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

function childCount(bar: ToolBar): number {
    return (bar as unknown as Component).getComponents().length;
}

describe('ToolBar orientation', () => {
    it('defaults to horizontal with an HBox layout manager', () => {
        const bar = new ToolBar();

        expect(bar.getOrientation()).toBe('horizontal');
        expect(bar.getLayoutManager()).toBeInstanceOf(HBox);
    });
    it('swaps to a VBox layout manager on setOrientation("vertical")', () => {
        const bar = new ToolBar();

        bar.setOrientation('vertical');

        expect(bar.getOrientation()).toBe('vertical');
        expect(bar.getLayoutManager()).toBeInstanceOf(VBox);
    });
    it('preserves component spacing across the orientation swap', () => {
        const bar = new ToolBar();

        (bar.getLayoutManager() as HBox).setComponentSpacing(7);

        bar.setOrientation('vertical');

        expect((bar.getLayoutManager() as VBox).getComponentSpacing()).toBe(7);
    });
    it('is a no-op on the same orientation (keeps the same manager instance)', () => {
        const bar = new ToolBar();
        const lm = bar.getLayoutManager();

        bar.setOrientation('horizontal');

        expect(bar.getLayoutManager()).toBe(lm);
    });
    it('applies an { orientation: "vertical" } option', () => {
        expect(new ToolBar({ orientation: 'vertical' }).getOrientation()).toBe('vertical');
    });
    it('defaults to a bottom border rule', () => {
        expect(new ToolBar().getBorder()).toEqual({
            borderBottom: '1px solid var(--ts-ui-toolbar-border, rgb(220, 220, 220))',
        });
    });
    it('derives a right border rule for { orientation: "vertical" }', () => {
        expect(new ToolBar({ orientation: 'vertical' }).getBorder()).toEqual({
            borderRight: '1px solid var(--ts-ui-toolbar-border, rgb(220, 220, 220))',
        });
    });
    it('honours a construction-time border override on the default orientation', () => {
        const bar = new ToolBar({ border: { borderBottom: '2px dashed red' } });

        expect(bar.getBorder()).toEqual({ borderBottom: '2px dashed red' });
    });
    it('honours a construction-time border override alongside an explicit orientation', () => {
        const bar = new ToolBar({ orientation: 'vertical', border: { borderLeft: '3px solid blue' } });

        expect(bar.getBorder()).toEqual({ borderLeft: '3px solid blue' });
    });
    it('recomputes the border unconditionally on a runtime setOrientation, dropping a construction-time override', () => {
        const bar = new ToolBar({ border: { borderBottom: '2px dashed red' } });

        bar.setOrientation('vertical');

        expect(bar.getBorder()).toEqual({
            borderRight: '1px solid var(--ts-ui-toolbar-border, rgb(220, 220, 220))',
        });
    });
});

describe('ToolBar compact', () => {
    it('defaults to compact (documented compact: true default)', () => {
        // ToolBar's _defaultOptions set compact: true, and the JSDoc states the
        // bar "defaults to compact mode" — so a bare ToolBar is compact.
        expect(new ToolBar().isCompact()).toBe(true);
    });
    it('round-trips setCompact', () => {
        const bar = new ToolBar();

        bar.setCompact(false);
        expect(bar.isCompact()).toBe(false);

        bar.setCompact(true);
        expect(bar.isCompact()).toBe(true);
    });
    it('applies a { compact: false } option', () => {
        expect(new ToolBar({ compact: false }).isCompact()).toBe(false);
    });
});

describe('ToolBar child registration', () => {
    it('registers added buttons and separators', () => {
        const bar = new ToolBar();

        bar.addComponent(new Button('Cut'));
        bar.addComponent(new Button('Copy'));
        bar.addComponent(new ToolBarSeparator());

        expect(childCount(bar)).toBe(3);
    });

    it('does not sweep a non-interactive Text caption into the roving-tabindex group', () => {
        // A caption placed before its control (the "label + control" pattern
        // several demo toolbars use) must not become the group's sole active
        // member merely because it never explicitly opted out with `-1` —
        // that pins the whole bar's tab stop to unfocusable decoration and
        // roves every real control off to `-1`, unreachable by Tab.
        const bar = new ToolBar();
        const caption = new Text('Uniform:');
        const button = new Button('Uniform');

        bar.addComponent(caption);
        bar.addComponent(button);

        expect((bar as any)._rovingTabIndex.getItems()).toEqual([button]);
        expect(caption.getAria().getTabIndex()).toBe(null);
        expect(button.getAria().getTabIndex()).toBe(0);
    });
});

// directional-panel-navigation plan, Expected Behaviour #21: SpatialNavigation's
// chord claims ArrowRight/Left first, so the toolbar's own roving-tabindex
// step must stand down entirely while it does.
describe('ToolBar keydown — stands down while SpatialNavigation claims the key', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('ArrowRight moves the roving tab index forward when the key is unclaimed', () => {
        const bar = new ToolBar();
        bar.addComponent(new Button('Cut'));
        bar.addComponent(new Button('Copy'));

        (bar as any)._onKeyDown({ key: 'ArrowRight' } as KeyboardEvent);

        expect((bar as any)._rovingTabIndex.getActiveIndex()).toBe(1);
    });

    it('a claimed ArrowRight does not move the roving tab index', () => {
        const bar = new ToolBar();
        bar.addComponent(new Button('Cut'));
        bar.addComponent(new Button('Copy'));

        vi.spyOn(SpatialNavigation, 'claimsKey').mockReturnValue(true);
        const moveNext = vi.spyOn((bar as any)._rovingTabIndex, 'moveNext');

        (bar as any)._onKeyDown({ key: 'ArrowRight' } as KeyboardEvent);

        expect(moveNext).not.toHaveBeenCalled();
        expect((bar as any)._rovingTabIndex.getActiveIndex()).toBe(0);
    });

    // A ToolBar makes its own element a tab stop in its constructor, so a bar
    // with no children can hold focus — while its roving group is created by
    // `addComponent` and so does not exist yet. An arrow key must do nothing
    // there, not dereference the absent group.
    it('an arrow key on a childless horizontal bar is a no-op rather than a crash', () => {
        const bar = new ToolBar();

        expect(() => (bar as any)._onKeyDown({ key: 'ArrowRight' } as KeyboardEvent)).not.toThrow();
        expect(() => (bar as any)._onKeyDown({ key: 'ArrowLeft' } as KeyboardEvent)).not.toThrow();

        // No disposition, so the key keeps propagating — a childless bar must
        // not swallow an arrow an ancestor or SpatialNavigation may want.
        expect((bar as any)._onKeyDown({ key: 'ArrowRight' } as KeyboardEvent)).toBeUndefined();
    });

    it('an arrow key on a childless vertical bar is a no-op rather than a crash', () => {
        const bar = new ToolBar({ orientation: 'vertical' });

        expect(() => (bar as any)._onKeyDown({ key: 'ArrowDown' } as KeyboardEvent)).not.toThrow();
        expect(() => (bar as any)._onKeyDown({ key: 'ArrowUp' } as KeyboardEvent)).not.toThrow();

        expect((bar as any)._onKeyDown({ key: 'ArrowDown' } as KeyboardEvent)).toBeUndefined();
    });
});

// toolbar-arrow-keys-yield-to-text-entry plan, Expected Behaviour T1-T6: a
// text-entry child needs the arrow keys for its caret, so the bar's roving
// step stands down while one has focus. The child is not a roving member,
// which is what keeps Tab / Shift+Tab as the way out of it.
describe('ToolBar keydown — leaves arrow keys to a focused text-entry child', () => {
    /**
     * Builds a bar holding two buttons followed by a text field.
     *
     * @param orientation - The bar's orientation.
     *
     * @returns The bar, its first button, and its text field.
     */
    function barWithTextField(orientation: 'horizontal' | 'vertical' = 'horizontal'): { bar: ToolBar; cut: Button; field: TextField } {
        const bar   = new ToolBar({ orientation });
        const cut   = new Button('Cut');
        const field = new TextField();

        bar.addComponent(cut);
        bar.addComponent(new Button('Copy'));
        bar.addComponent(field);

        return { bar, cut, field };
    }

    /**
     * Gives `component` an element and focuses it.
     *
     * @param component - The component to focus.
     */
    function focus(component: Component): void {
        component.getElement(true);
        DOM.sink.focus(component.getElement()!);
    }

    it('T1: ArrowLeft in a focused text field is left to the field', () => {
        const { bar, field } = barWithTextField();
        focus(field);

        expect((bar as any)._onKeyDown({ key: 'ArrowLeft' } as KeyboardEvent)).toBeUndefined();
        expect((bar as any)._rovingTabIndex.getActiveIndex()).toBe(0);
    });

    it('T2: ArrowRight in a focused text field is left to the field', () => {
        const { bar, field } = barWithTextField();
        focus(field);

        expect((bar as any)._onKeyDown({ key: 'ArrowRight' } as KeyboardEvent)).toBeUndefined();
        expect((bar as any)._rovingTabIndex.getActiveIndex()).toBe(0);
    });

    it('T3: ArrowDown and ArrowUp in a vertical bar are left to a focused text field', () => {
        const { bar, field } = barWithTextField('vertical');
        focus(field);

        expect((bar as any)._onKeyDown({ key: 'ArrowDown' } as KeyboardEvent)).toBeUndefined();
        expect((bar as any)._onKeyDown({ key: 'ArrowUp' } as KeyboardEvent)).toBeUndefined();
        expect((bar as any)._rovingTabIndex.getActiveIndex()).toBe(0);
    });

    it('T4: ArrowRight on a focused button still moves roving focus', () => {
        const { bar, cut } = barWithTextField();
        focus(cut);

        expect((bar as any)._onKeyDown({ key: 'ArrowRight' } as KeyboardEvent)).toEqual({ prevent: true });
        expect((bar as any)._rovingTabIndex.getActiveIndex()).toBe(1);
    });

    it('T5: ArrowRight with nothing focused still moves roving focus', () => {
        const { bar } = barWithTextField();

        expect(DOM.source.getActiveElement()).toBeNull();
        expect((bar as any)._onKeyDown({ key: 'ArrowRight' } as KeyboardEvent)).toEqual({ prevent: true });
        expect((bar as any)._rovingTabIndex.getActiveIndex()).toBe(1);
    });

    it('T6: the text field is not a member of the roving group', () => {
        const { bar, field } = barWithTextField();
        const items = (bar as any)._rovingTabIndex.getItems();

        expect(items).toHaveLength(2);
        expect(items).not.toContain(field);
    });
});
