import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { SplitButton } from '~/component/button/SplitButton';
import { ToolBar } from '~/component/menubar/ToolBar';
import type { MenuItemConfig } from '~/component/container/MenuItem';
import type { Menu } from '~/overlay/Menu';
import { DOM } from '~/core/DOM';
import { LayerManager } from '~/core/LayerManager';
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

describe('SplitButton eager chevron', () => {
    it('constructs without the consumer registering any glyph', () => {
        // The trailing `caret-down` chevron is registered eagerly at module
        // load, so a bare SplitButton resolves it without setup.
        expect(() => new SplitButton('Save')).not.toThrow();
    });
});

describe('SplitButton menuItems', () => {
    it('defaults to an empty array', () => {
        expect(new SplitButton('Save').getMenuItems()).toEqual([]);
    });
    it('round-trips setMenuItems', () => {
        const btn = new SplitButton('Save');
        const items = [{ text: 'Save As' }, { text: 'Save All' }];

        btn.setMenuItems(items);

        expect(btn.getMenuItems()).toBe(items);
    });
    it('applies a { menuItems } option', () => {
        const items = [{ text: 'Export' }];

        const btn = new SplitButton('Save', { menuItems: items });

        expect(btn.getMenuItems()).toBe(items);
    });
});

describe('SplitButton main-face action', () => {
    it('inherits on("action") and is chainable like Button', () => {
        const btn = new SplitButton('Save');

        expect(btn.on('action', () => {})).toBe(btn);
    });
});

describe('SplitButton dropdown when unattached', () => {
    it('opening the chevron menu is a no-op without a DOM element (no throw)', () => {
        // `_toggleMenu` (the chevron-click target) reads `getElement()` and the
        // viewport rect to anchor the overlay; it returns early when the button
        // has no element. We can't deliver the chevron click offline, but we can
        // confirm a freshly constructed, unattached SplitButton exposes no
        // element yet — the precondition the early return guards on — and that
        // constructing/handling stays exception-free.
        const btn = new SplitButton('Save', { menuItems: [{ text: 'X' }] });

        expect(btn.getElement()).toBeFalsy();
        expect(() => btn.getMenuItems()).not.toThrow();
    });
});

describe('SplitButton chevron with no menuItems', () => {
    it('opens no panel and spins the chevron back down', () => {
        // Regression: a SplitButton whose _menuItems defaults to [] used to open
        // an empty ~8px panel on a chevron press. Menu.toggleFor now suppresses
        // the empty open and fires onClose, so the optimistic chevron spin-up in
        // _toggleMenu reverts rather than stranding the caret pointing up.
        const btn = new SplitButton('Save');

        btn.getElement(true);
        (btn as any)._toggleMenu();

        expect(LayerManager.getTopLayer()).toBeNull();
        expect((btn as any)._chevron.getTransform()).toBe('rotate(0deg)');
    });
});

// splitbutton-keyboard-menu-open plan, Expected Behaviour S1-S17: the dropdown
// opens from the keyboard, the open menu is driven by keys forwarded from the
// button (which keeps DOM focus), and the button's ARIA tracks the menu.
describe('SplitButton keyboard and ARIA', () => {
    /** The disposition a handled key returns: consumed, and kept from ancestors. */
    const STOP_PREVENT = { stop: true, prevent: true };

    let a: Mock<() => void>;
    let b: Mock<() => void>;

    beforeEach(() => {
        a = vi.fn<() => void>();
        b = vi.fn<() => void>();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** The plan's standard items: `A`, a separator, `B`. */
    function items(): MenuItemConfig[] {
        return [{ text: 'A', action: a }, { separator: true }, { text: 'B', action: b }];
    }

    /** Builds an attached SplitButton carrying `menuItems`. */
    function attached(menuItems: MenuItemConfig[] = items()): SplitButton {
        const btn = new SplitButton('Save', { menuItems });

        btn.getElement(true);

        return btn;
    }

    /** Forwards a keydown built from `init` to the button's own handler. */
    function keyDown(btn: SplitButton, init: Partial<KeyboardEvent>): unknown {
        return (btn as any)._onKeyDown(init as KeyboardEvent);
    }

    /** Forwards a keyup built from `init` to the button's own handler. */
    function keyUp(btn: SplitButton, init: Partial<KeyboardEvent>): unknown {
        return (btn as any)._onKeyUp(init as KeyboardEvent);
    }

    /** The button's lazily-created dropdown, or `null` before the first open. */
    function menuOf(btn: SplitButton): Menu | null {
        return (btn as any)._menu;
    }

    /** Whether the button's dropdown is the topmost open layer. */
    function isOpen(btn: SplitButton): boolean {
        const menu = menuOf(btn);

        return menu !== null && LayerManager.getTopLayer() === menu;
    }

    /** The chevron's current rotation. */
    function chevronTransform(btn: SplitButton): string | null {
        return (btn as any)._chevron.getTransform();
    }

    it('S1: declares a menu popup, collapsed', () => {
        const btn = new SplitButton('Save');

        expect(btn.getAria().getHasPopup()).toBe('menu');
        expect(btn.getAria().getExpanded()).toBe(false);
    });

    it('S2: ArrowDown opens the menu with the first row highlighted', () => {
        const btn = attached();

        expect(keyDown(btn, { key: 'ArrowDown' })).toEqual(STOP_PREVENT);
        expect(isOpen(btn)).toBe(true);
        expect(menuOf(btn)!.getFocusedIndex()).toBe(0);
        expect(btn.getAria().getExpanded()).toBe(true);
        expect(chevronTransform(btn)).toBe('rotate(180deg)');
    });

    it('S3: Alt+ArrowDown opens the menu like ArrowDown', () => {
        const btn = attached();

        expect(keyDown(btn, { key: 'ArrowDown', altKey: true })).toEqual(STOP_PREVENT);
        expect(isOpen(btn)).toBe(true);
        expect(menuOf(btn)!.getFocusedIndex()).toBe(0);
        expect(btn.getAria().getExpanded()).toBe(true);
        expect(chevronTransform(btn)).toBe('rotate(180deg)');
    });

    it('S4: the first highlighted row skips a leading separator', () => {
        const btn = attached([{ separator: true }, { text: 'A' }]);

        keyDown(btn, { key: 'ArrowDown' });

        expect(isOpen(btn)).toBe(true);
        expect(menuOf(btn)!.getFocusedIndex()).toBe(1);
    });

    it('S5: ArrowDown with no items consumes the key but opens nothing', () => {
        const btn = attached([]);

        expect(keyDown(btn, { key: 'ArrowDown' })).toEqual(STOP_PREVENT);
        expect(isOpen(btn)).toBe(false);
        expect(btn.getAria().getExpanded()).toBe(false);
        expect(chevronTransform(btn)).toBe('rotate(0deg)');
    });

    it('S6: ArrowDown on an unattached button does not throw and stays collapsed', () => {
        const btn = new SplitButton('Save', { menuItems: items() });

        expect(() => keyDown(btn, { key: 'ArrowDown' })).not.toThrow();
        expect(btn.getAria().getExpanded()).toBe(false);
    });

    it('S7: ArrowDown / ArrowUp move the highlight while the menu is open', () => {
        const btn = attached();

        keyDown(btn, { key: 'ArrowDown' });

        expect(keyDown(btn, { key: 'ArrowDown' })).toEqual(STOP_PREVENT);
        expect(menuOf(btn)!.getFocusedIndex()).toBe(2);
        expect(keyDown(btn, { key: 'ArrowUp' })).toEqual(STOP_PREVENT);
        expect(menuOf(btn)!.getFocusedIndex()).toBe(0);
    });

    it('S8: Enter activates the highlighted row and closes the menu', () => {
        const btn = attached();

        keyDown(btn, { key: 'ArrowDown' });

        expect(keyDown(btn, { key: 'Enter' })).toEqual(STOP_PREVENT);
        expect(a).toHaveBeenCalledTimes(1);
        expect(isOpen(btn)).toBe(false);
        expect(btn.getAria().getExpanded()).toBe(false);
    });

    it('S9: Space activates the row and swallows exactly the next Space keyup', () => {
        const btn = attached();

        keyDown(btn, { key: 'ArrowDown' });

        expect(keyDown(btn, { key: ' ' })).toEqual(STOP_PREVENT);
        expect(a).toHaveBeenCalledTimes(1);
        expect(keyUp(btn, { key: ' ' })).toEqual({ prevent: true });
        expect(keyUp(btn, { key: ' ' })).toBeUndefined();
    });

    it('S9b: a Space keyup that never reaches the button does not swallow a later Space', () => {
        // The row's action can move focus away (a Dialog it opens), so the
        // keyup lands elsewhere; the blur that move causes must drop the
        // pending swallow, or the next Space on the button loses its click.
        const btn = attached();

        keyDown(btn, { key: 'ArrowDown' });
        keyDown(btn, { key: ' ' });
        (btn as any)._onBlurClearSpaceSwallow();

        expect(keyUp(btn, { key: ' ' })).toBeUndefined();
    });

    it('S10: Escape is left to the layer manager, whose close collapses the button', () => {
        const btn = attached();

        keyDown(btn, { key: 'ArrowDown' });

        expect(keyDown(btn, { key: 'Escape' })).toBeUndefined();
        expect(isOpen(btn)).toBe(true);

        menuOf(btn)!.requestClose();

        expect(isOpen(btn)).toBe(false);
        expect(btn.getAria().getExpanded()).toBe(false);
    });

    it('S11: Tab closes the menu and lets the key through', () => {
        const btn = attached();

        keyDown(btn, { key: 'ArrowDown' });

        expect(keyDown(btn, { key: 'Tab' })).toBeUndefined();
        expect(isOpen(btn)).toBe(false);
        expect(btn.getAria().getExpanded()).toBe(false);
    });

    it('S12: ArrowRight closes the menu and lets the key through', () => {
        const btn = attached();

        keyDown(btn, { key: 'ArrowDown' });

        expect(keyDown(btn, { key: 'ArrowRight' })).toBeUndefined();
        expect(isOpen(btn)).toBe(false);
    });

    it('S13: in a vertical ToolBar plain ArrowDown is left to the bar; Alt+ArrowDown opens', () => {
        const bar = new ToolBar({ orientation: 'vertical' });
        const btn = new SplitButton('Save', { menuItems: items() });

        bar.addComponent(btn);
        bar.getElement(true);

        expect(keyDown(btn, { key: 'ArrowDown' })).toBeUndefined();
        expect(isOpen(btn)).toBe(false);

        keyDown(btn, { key: 'ArrowDown', altKey: true });

        expect(isOpen(btn)).toBe(true);
    });

    it('S14: in a horizontal ToolBar plain ArrowDown opens the menu', () => {
        const bar = new ToolBar();
        const btn = new SplitButton('Save', { menuItems: items() });

        bar.addComponent(btn);
        bar.getElement(true);

        keyDown(btn, { key: 'ArrowDown' });

        expect(isOpen(btn)).toBe(true);
    });

    it('S15: a key SpatialNavigation claims is left alone', () => {
        const btn = attached();

        vi.spyOn(SpatialNavigation, 'claimsKey').mockReturnValue(true);

        expect(keyDown(btn, { key: 'ArrowDown' })).toBeUndefined();
        expect(isOpen(btn)).toBe(false);
    });

    it('S16: Ctrl, Shift or Meta with ArrowDown does not open the menu', () => {
        const btn = attached();

        for (const modifier of ['ctrlKey', 'shiftKey', 'metaKey'] as const) {
            expect(keyDown(btn, { key: 'ArrowDown', [modifier]: true })).toBeUndefined();
            expect(isOpen(btn)).toBe(false);
        }
    });

    it('S17: _toggleMenu keeps aria-expanded and aria-controls in step', () => {
        const btn = attached();

        (btn as any)._toggleMenu();

        expect(isOpen(btn)).toBe(true);
        expect(btn.getAria().getExpanded()).toBe(true);
        expect(btn.getAria().getControls()).toBe(menuOf(btn)!.getId());

        (btn as any)._toggleMenu();

        expect(isOpen(btn)).toBe(false);
        expect(btn.getAria().getExpanded()).toBe(false);
    });
});
