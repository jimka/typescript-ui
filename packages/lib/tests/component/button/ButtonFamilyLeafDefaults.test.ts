// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for plans/in-progress/state-tier-full-unification.md's
// Stage 1 — Expected Behaviour rows 1-3. `MenuBarButton` and `TabCloseButton`
// forward hoistable colour defaults through `subclassDefaults` without
// declaring `ownClassStyleDefaults`, so `resolveClassLevel`'s pass-through
// silently replaces their own colours with `Button`'s once the class tier
// walk resolves at first render (see the plan's `[^leaf-loss]` note).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MenuBarButton } from '~/component/menubar/MenuBarButton';
import { TabCloseButton } from '~/component/button/TabCloseButton';
import { TabButton } from '~/component/button/TabButton';
import { getStyleClassChain } from '~/core/ClassStyleRules';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

// MenuBarButton's onClick/onHover constructor params — these tests never
// fire either callback.
const NOOP = (): void => {};

describe('Button family leaf defaults', () => {
    it('row 1: MenuBarButton reports its own background/foreground both before and after first render', () => {
        const before = new MenuBarButton('File', NOOP, NOOP);
        expect(before.getBackgroundColor()).toBe('var(--ts-ui-menu-bar-btn-bg, transparent)');
        expect(before.getForegroundColor()).toBe('var(--ts-ui-menu-bar-btn-fg, inherit)');

        const after = new MenuBarButton('File', NOOP, NOOP);
        after.getElement(true);
        expect(after.getBackgroundColor()).toBe('var(--ts-ui-menu-bar-btn-bg, transparent)');
        expect(after.getForegroundColor()).toBe('var(--ts-ui-menu-bar-btn-fg, inherit)');
    });

    it('row 2: TabCloseButton reports its own foreground after first render', () => {
        const button = new TabCloseButton();
        button.getElement(true);
        expect(button.getForegroundColor()).toBe('var(--ts-ui-close-button-fg, #555)');
    });

    it('row 3: getStyleClassChain widens the whole Button family, including the two leaves', () => {
        expect(getStyleClassChain(TabButton)).toEqual(['Button', 'ToggleButton', 'TabButton']);
        expect(getStyleClassChain(MenuBarButton)).toEqual(['Button', 'MenuBarButton']);
    });
});
