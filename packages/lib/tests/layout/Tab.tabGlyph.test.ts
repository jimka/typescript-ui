// Pins Tab.setTabGlyph / clearTabGlyph — the runtime icon-swap API
// plans/in-progress/tab-set-glyph.md adds alongside the existing setTabName.
// Modelled on Tab.renameAndVeto.test.ts: same CONFIG, same hostTab() helper,
// same private-field reach for `_bar._entries`.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Tab, TabOptions } from '~/layout/Tab';
import { TabBar } from '~/component/container/TabBar';
import { TabButton } from '~/component/button/TabButton';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Glyph } from '~/component/display/Glyph';
import { file } from '~/glyphs/solid/file';
import { file_lines } from '~/glyphs/solid/file_lines';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** A Tab-managed strip, sized and rendered so tab cells materialise on doLayout. */
function hostTab(options?: TabOptions): { host: Container; tab: Tab } {
    const tab  = new Tab(options);
    const host = new Container({ layoutManager: tab });

    host.getElement(true);
    host.setWidth(400);
    host.setHeight(300);
    host.clearInsets();

    return { host, tab };
}

/** Reaches TabBar's private `_entries`, the same private surface Tab.closeDisposal.test.ts casts through. */
function barEntries(tab: Tab): Array<{ id: string; button: TabButton; name: string }> {
    const bar = (tab as unknown as { _bar: TabBar })._bar;

    return (bar as unknown as { _entries: Array<{ id: string; button: TabButton; name: string }> })._entries;
}

/** A LayoutConstraints carrying a glyph name. */
function glyphed(name: string): LayoutConstraints {
    const c = new LayoutConstraints();

    c.glyph = name;

    return c;
}

afterEach(() => {
    (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
    // 'file' / 'file-lines' are SVG-kind glyphs, so (per Glyph.test.ts's
    // convention) each case registers them and this cleans up afterward to
    // avoid leaking into the global registry. Unregister before DOM.reset()
    // clears the handle registry the sprite-removal path resolves against.
    Glyph.unregister('file');
    Glyph.unregister('file-lines');
    DOM.reset();
});

describe('Tab glyph swapping', () => {
    beforeEach(() => Glyph.register(file, file_lines));

    it('1 — setTabGlyph swaps the icon of a glyph-bearing tab', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content, glyphed('file'));
        host.doLayout();

        expect(tab.setTabGlyph(content, 'file-lines')).toBe(true);
        expect(barEntries(tab)[0].button.getGlyph()!.getGlyphName()).toBe('file-lines');
    });

    it('2 — repeated swaps keep working', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content, glyphed('file'));
        host.doLayout();

        tab.setTabGlyph(content, 'file-lines');

        expect(tab.setTabGlyph(content, 'file')).toBe(true);
        expect(barEntries(tab)[0].button.getGlyph()!.getGlyphName()).toBe('file');
    });

    it('3 — setTabGlyph on a component never added to the strip is a no-op', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content    = new Component({});
        const neverAdded = new Component({});

        host.addComponent(content, glyphed('file'));
        host.doLayout();

        expect(tab.setTabGlyph(neverAdded, 'file-lines')).toBe(false);
        expect(barEntries(tab)[0].button.getGlyph()!.getGlyphName()).toBe('file');
    });

    it('4 — clearTabGlyph removes the icon', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content, glyphed('file'));
        host.doLayout();

        expect(tab.clearTabGlyph(content)).toBe(true);
        expect(barEntries(tab)[0].button.getGlyph()).toBeNull();
    });

    it('5 — setTabGlyph on a tab created with no glyph adds one', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        expect(barEntries(tab)[0].button.getGlyph()).toBeNull();

        expect(tab.setTabGlyph(content, 'file')).toBe(true);
        expect(barEntries(tab)[0].button.getGlyph()!.getGlyphName()).toBe('file');
    });

    it('6 — setTabGlyph marks the owning container\'s layout dirty', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content, glyphed('file'));
        host.doLayout();

        expect(host.isLayoutDirty()).toBe(false);

        tab.setTabGlyph(content, 'file-lines');

        expect(host.isLayoutDirty()).toBe(true);
    });

    it('11 — setTabGlyph writes the new name back to the stored constraint', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content, glyphed('file'));
        host.doLayout();

        tab.setTabGlyph(content, 'file-lines');

        expect(tab.getLayoutConstraints(content)!.glyph).toBe('file-lines');
    });

    it('12 — setTabGlyph on a tab added with no constraints mints one', () => {
        installTestDOM(CONFIG);

        const { host, tab } = hostTab();
        const content = new Component({});

        host.addComponent(content);
        host.doLayout();

        expect(tab.getLayoutConstraints(content)).toBeUndefined();

        expect(tab.setTabGlyph(content, 'file')).toBe(true);
        expect(tab.getLayoutConstraints(content)!.glyph).toBe('file');
    });
});
