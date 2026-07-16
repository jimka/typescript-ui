import { describe, it, expect, afterEach, vi } from 'vitest';
import { MenuButton } from '~/component/button/MenuButton';
import { NotificationHistoryButton } from '~/overlay/NotificationHistoryButton';
import { DOM } from '~/core/DOM';
import { LayerManager } from '~/core/LayerManager';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// MUST be the first describe block in this file, and its one test the only
// place `.click()` is used. `Event`'s window-level base listener is installed
// once per event type for the lifetime of this module and never re-armed on
// the fresh `DOM.sink` a later `installTestDOM()` call swaps in (no test file
// in this codebase drives behaviour through `.click()` for the same reason —
// see tests/overlay/Menu.test.ts and tests/component/button/SplitButton.test.ts,
// which both bracket-access private methods instead). Every other test below
// drives the toggle through the private `toggleMenu()` path directly, which the
// plan's Expected Behaviour explicitly sanctions ("drive via the button's
// action path or click()").
describe('MenuButton listeners bag (native click dispatch)', () => {
    afterEach(() => DOM.reset());

    it('a consumer listeners.action fires on a plain MenuButton, and exactly once on NotificationHistoryButton', () => {
        installTestDOM(CONFIG);

        // Empty menuItems so the click's toggle path suppresses the open (no
        // Menu registers with the global LayerManager, which — unlike DOM —
        // is not reset between tests) — this test only cares about the
        // listener wiring, not the menu itself.
        const plainSpy = vi.fn();
        const plainBtn = new MenuButton({ menuItems: [], listeners: { action: plainSpy } });

        plainBtn.getElement(true);
        plainBtn.click();

        expect(plainSpy).toHaveBeenCalledOnce();

        // Not double-wired: MenuButton wires its own bag only for a directly-
        // constructed MenuButton; NotificationHistoryButton wires its own after
        // super(), so a consumer listener must fire once, not twice.
        const historySpy = vi.fn();
        const historyBtn = new NotificationHistoryButton({ menuItems: [], listeners: { action: historySpy } });

        historyBtn.getElement(true);
        historyBtn.click();

        expect(historySpy).toHaveBeenCalledOnce();
    });
});

describe('MenuButton construction forms', () => {
    afterEach(() => DOM.reset());

    it('the options-only call form compiles and does not swallow the bag as text', () => {
        installTestDOM(CONFIG);

        const btn = MenuButton({ glyph: 'xmark', menuItems: [{ text: 'A' }] });

        expect(btn.getMenuItems()).toEqual([{ text: 'A' }]);
    });

    it('the text + options `new` form compiles', () => {
        installTestDOM(CONFIG);

        expect(() => new MenuButton('Export', { menuItems: [] })).not.toThrow();
    });

    it('the options-only `new` form compiles', () => {
        installTestDOM(CONFIG);

        const btn = new MenuButton({ menuItems: [{ text: 'A' }] });

        expect(btn.getMenuItems()).toEqual([{ text: 'A' }]);
    });
});

describe('MenuButton menuItems', () => {
    afterEach(() => DOM.reset());

    it('getMenuItems returns the array passed at construction', () => {
        installTestDOM(CONFIG);

        const items = [{ text: 'A' }];
        const btn   = new MenuButton({ menuItems: items });

        expect(btn.getMenuItems()).toBe(items);
    });

    it('setMenuItems replaces the array or provider, round-tripping through getMenuItems', () => {
        installTestDOM(CONFIG);

        const btn = new MenuButton({ menuItems: [{ text: 'A' }] });
        const provider = () => [{ text: 'B' }];

        btn.setMenuItems(provider);

        expect(btn.getMenuItems()).toBe(provider);
    });

    it('getMenuItems returns null when nothing was configured', () => {
        installTestDOM(CONFIG);

        expect(new MenuButton({}).getMenuItems()).toBeNull();
    });
});

describe('MenuButton isScrollToBottomOnShow', () => {
    afterEach(() => DOM.reset());

    it('defaults to false', () => {
        installTestDOM(CONFIG);

        expect(new MenuButton({}).isScrollToBottomOnShow()).toBe(false);
    });

    it('is true when the option is set', () => {
        installTestDOM(CONFIG);

        expect(new MenuButton({ scrollToBottomOnShow: true }).isScrollToBottomOnShow()).toBe(true);
    });

    it('NotificationHistoryButton defaults to true via its subclass defaults', () => {
        installTestDOM(CONFIG);

        expect(new NotificationHistoryButton().isScrollToBottomOnShow()).toBe(true);
    });
});

describe('MenuButton unattached', () => {
    afterEach(() => DOM.reset());

    it('toggling an unattached button (no element) is a no-op — no menu, no throw', () => {
        installTestDOM(CONFIG);

        const btn = new MenuButton({ menuItems: [{ text: 'A' }] });

        expect(btn.getElement()).toBeFalsy();
        // Drive the button's action path directly (see the file-level comment on
        // why `.click()` is confined to a single test in this file).
        expect(() => (btn as any).toggleMenu()).not.toThrow();
        expect(LayerManager.getTopLayer()).toBeNull();
    });
});

describe('MenuButton opening the dropdown', () => {
    afterEach(() => DOM.reset());

    /** Drives MenuButton's private toggle path, mirroring a real click. */
    function toggle(btn: any): void {
        btn.toggleMenu();
    }

    it('an empty provider opens nothing; a later non-empty provider opens normally', () => {
        installTestDOM(CONFIG);

        let items: { text: string }[] = [];
        const btn = new MenuButton({ menuItems: () => items });

        // Force element creation offline, mirroring the TimePickerDropdown idiom —
        // toggleMenu() reads getElement() (non-forcing) to decide it is attached.
        btn.getElement(true);

        toggle(btn);
        expect(LayerManager.getTopLayer()).toBeNull();

        items = [{ text: 'A' }];
        toggle(btn);
        expect(LayerManager.getTopLayer()).not.toBeNull();

        toggle(btn); // close, so this test leaves no menu registered behind it
    });

    it('a provider is invoked per open, not once', () => {
        installTestDOM(CONFIG);

        const provider = vi.fn(() => [{ text: 'A' }]);
        const btn = new MenuButton({ menuItems: provider });

        btn.getElement(true);

        toggle(btn); // open
        toggle(btn); // close (toggle-shut)
        toggle(btn); // open again
        toggle(btn); // close, so this test leaves no menu registered behind it

        expect(provider).toHaveBeenCalledTimes(4);
    });

    it('new NotificationHistoryButton resolves glyph clock-rotate-left and an empty-history placeholder', () => {
        installTestDOM(CONFIG);

        const btn = new NotificationHistoryButton();

        expect(btn.getGlyph()?.getGlyphName()).toBe('clock-rotate-left');

        const items = btn.getMenuItems();
        const resolved = typeof items === 'function' ? items() : items;

        expect(resolved).toEqual([{ text: 'No notifications yet', enabled: false }]);
    });
});
