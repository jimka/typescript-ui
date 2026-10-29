// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Coverage for theme subscriptions across a sink swap.
//
// `ThemeManager`'s listener array is static, so every subscriber — a
// component through `subscribeTheme`, a `Tab` layout manager through
// `onThemeChange` directly — stayed reachable, with everything it closes
// over, until something unsubscribed it, which an undisposed subscriber of a
// torn-down environment never does. ThemeManager now drops every listener on
// `DOM.onSinkChange` except the ones subscribed with `persistent: true`, which
// a module-level cache such as `BorderWidths` needs.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { DOM } from '~/core/DOM';
import { ThemeManager, DarkTheme, ModernTheme } from '~/core/Theme';
import { Markdown } from '~/component/display/Markdown';
import { Tab } from '~/layout/Tab';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

/** A component that reports each theme change it hears to `onChange`. */
class ThemeWatcher extends Component {
    constructor(onChange: () => void) {
        super();
        this.subscribeTheme(onChange);
    }
}

/**
 * Switches to the dark theme and back, running `check` in between.
 *
 * @param check - The assertions to make while the dark theme is active.
 */
function whileDark(check: () => void): void {
    try {
        ThemeManager.setTheme(DarkTheme);
        check();
    } finally {
        ThemeManager.setTheme(ModernTheme);   // restore the default for later tests
    }
}

describe('theme subscriptions across a sink swap', () => {
    it('does not deliver a theme change to a component subscribed under the old sink', () => {
        installTestDOM(CONFIG);
        const staleChange = vi.fn();
        new ThemeWatcher(staleChange);
        DOM.reset();

        installTestDOM(CONFIG);
        const freshChange = vi.fn();
        new ThemeWatcher(freshChange);

        whileDark(() => {
            expect(staleChange).not.toHaveBeenCalled();
            expect(freshChange).toHaveBeenCalledTimes(1);
        });
    });

    it('drops a direct subscriber that did not ask to persist', () => {
        installTestDOM(CONFIG);
        const directChange = vi.fn();
        ThemeManager.onThemeChange(directChange);
        DOM.reset();

        installTestDOM(CONFIG);

        whileDark(() => expect(directChange).not.toHaveBeenCalled());
    });

    it('keeps a persistent subscriber subscribed', () => {
        installTestDOM(CONFIG);
        const persistentChange = vi.fn();
        const unsubscribe      = ThemeManager.onThemeChange(persistentChange, { persistent: true });
        DOM.reset();

        installTestDOM(CONFIG);

        try {
            whileDark(() => expect(persistentChange).toHaveBeenCalledTimes(1));
        } finally {
            unsubscribe();
        }
    });

    it('stops a persistent subscriber once it unsubscribes', () => {
        installTestDOM(CONFIG);
        const persistentChange = vi.fn();
        const unsubscribe      = ThemeManager.onThemeChange(persistentChange, { persistent: true });
        unsubscribe();
        DOM.reset();

        installTestDOM(CONFIG);

        whileDark(() => expect(persistentChange).not.toHaveBeenCalled());
    });

    it('keeps the persistent subscription of a function also subscribed without it', () => {
        installTestDOM(CONFIG);
        const change      = vi.fn();
        const unsubscribe = ThemeManager.onThemeChange(change, { persistent: true });
        ThemeManager.onThemeChange(change);
        DOM.reset();

        installTestDOM(CONFIG);

        try {
            whileDark(() => expect(change).toHaveBeenCalledTimes(1));
        } finally {
            unsubscribe();
        }
    });

    it('releases the subscriptions of a Markdown and of a Tab layout manager', () => {
        installTestDOM(CONFIG);
        const before = ThemeManager._themeListenerCount();
        new Markdown('x');
        new Container({ layoutManager: new Tab() });

        expect(ThemeManager._themeListenerCount()).toBeGreaterThanOrEqual(before + 2);

        DOM.reset();

        expect(ThemeManager._themeListenerCount()).toBe(before);
    });
});
