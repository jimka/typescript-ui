// Regression: closing a tab detached its content and its own strip cell button
// but never destroyed either, so every per-instance stylesheet rule the closed
// subtree allocated stayed on the shared sheet for the life of the page — see
// plans/implemented/dock-disposes-tab-content.md. This pins the destroy that
// plan adds to `Tab.closeEntry` (content subtree + cell button), the two
// exceptions to it (`disposeOnClose: false`, a `"tabclose"` listener that
// re-homes the content), and confirms the tear-off path is untouched.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Tab } from '~/layout/Tab';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { TabBar } from '~/component/container/TabBar';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheKeys } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/**
 * Recursively collects a component's own id plus every registered
 * descendant's id, copied from tests/component/dispose-full-teardown.test.ts
 * so each assertion below is scoped to the ids of the subtree under test
 * rather than to the whole sheet.
 */
function collectIds(c: Component): string[] {
    const ids = [c.getId()];

    for (const child of c.getComponents()) {
        ids.push(...collectIds(child));
    }

    return ids;
}

/** A Tab-managed strip, sized and rendered so tab cells materialise on doLayout. */
function hostTab(): { host: Container; tab: Tab } {
    const tab  = new Tab();
    const host = new Container({ layoutManager: tab });

    host.getElement(true);
    host.setWidth(400);
    host.setHeight(300);
    host.clearInsets();

    return { host, tab };
}

/** Reaches TabBar's private `_entries`, the same private surface TabCloseReservePerTab.test.ts casts through. */
function barEntries(tab: Tab): Array<{ id: string; button: Component }> {
    const bar = (tab as unknown as { _bar: TabBar })._bar;

    return (bar as unknown as { _entries: Array<{ id: string; button: Component }> })._entries;
}

/** A `disposeOnClose: false` constraints object. */
function keepAlive(): LayoutConstraints {
    const c = new LayoutConstraints();

    c.disposeOnClose = false;

    return c;
}

afterEach(() => {
    (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
    vi.restoreAllMocks();
    DOM.reset();
});

describe('Tab close disposal', () => {
    it('T1 — a closed tab\'s content subtree leaves no rule behind', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Container({});
        const child   = new Component({});

        content.addComponent(child);
        host.addComponent(content);
        // A real per-instance declaration, so the precondition below has
        // something to find: Tab's own hide-then-activate dance used to
        // leave a transient `visibility` declaration on `content`'s `#id`
        // rule, but the state-tier dedup plan
        // (component-setvisible-state-tier-dedup.md) routes that through
        // the shared `.ts-ui-component.invisible` class rule instead, so an
        // activated tab's content no longer has any residual rule of its
        // own by the time this assertion runs.
        content.setBackgroundColor('red');
        host.doLayout();

        const ids = collectIds(content);

        expect(_ruleCacheKeys().some((key) => ids.some((id) => key.includes(id)))).toBe(true);

        tab.closeTab(content);

        const leaked = _ruleCacheKeys().filter((key) => ids.some((id) => key.includes(id)));

        expect(leaked).toEqual([]);
    });

    it('T2 — disposeOnClose: false keeps the content alive', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content, keepAlive());
        // See T1's comment: a real declaration so `content` has its own
        // rule to find after `closeTab` — its transient hide/show-driven
        // `visibility` declaration no longer leaves one.
        content.setBackgroundColor('red');
        host.doLayout();

        const ownRule = `#${content.getId()}`;

        tab.closeTab(content);

        expect(_ruleCacheKeys()).toContain(ownRule);

        // Re-adding to a second container and laying out succeeds — the
        // component is still alive, not disposed.
        const other = new Container({});

        other.getElement(true);
        other.setWidth(100);
        other.setHeight(100);
        other.addComponent(content);

        expect(() => other.doLayout()).not.toThrow();
    });

    it('T3 — a content re-homed during "tabclose" survives', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});
        const other   = new Component({});

        host.addComponent(content);
        // See T1's comment: a real declaration so `content` has its own
        // rule to find after `closeTab` — its transient hide/show-driven
        // `visibility` declaration no longer leaves one.
        content.setBackgroundColor('red');
        other.getElement(true);
        host.doLayout();

        tab.on('tabclose', (c) => other.addComponent(c));

        const ownRule = `#${content.getId()}`;

        tab.closeTab(content);

        expect(_ruleCacheKeys()).toContain(ownRule);
        expect(content.getParentComponent()).toBe(other);
    });

    it('T4 — a tear-off does not destroy the content', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        // See T1's comment: a real declaration so `content` has its own
        // rule to find after the tear-off — its transient hide/show-driven
        // `visibility` declaration no longer leaves one.
        content.setBackgroundColor('red');
        host.doLayout();

        const entry  = barEntries(tab)[0];
        const id     = entry.id;
        const button = entry.button;

        const contentIds = collectIds(content);
        const buttonIds  = collectIds(button);

        (tab as unknown as {
            detachTabToWindow(id: string, content: Component, clientX: number, clientY: number, forceBare: boolean): void;
        }).detachTabToWindow(id, content, 100, 100, true);

        // The content's rule survives the tear-off.
        expect(_ruleCacheKeys().some((key) => contentIds.some((cid) => key.includes(cid)))).toBe(true);

        // The cell button's rules do not — a fresh cell is minted at the destination.
        const leakedButtonRules = _ruleCacheKeys().filter((key) => buttonIds.some((bid) => key.includes(bid)));

        expect(leakedButtonRules).toEqual([]);
    });

    it('T5 — the closed cell\'s button leaves no rule behind', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        const button = barEntries(tab)[0].button;
        const buttonIds = collectIds(button);

        expect(_ruleCacheKeys().some((key) => buttonIds.some((id) => key.includes(id)))).toBe(true);

        tab.closeTab(content);

        const leaked = _ruleCacheKeys().filter((key) => buttonIds.some((id) => key.includes(id)));

        expect(leaked).toEqual([]);
    });
});
