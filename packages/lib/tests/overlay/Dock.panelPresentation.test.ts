// Covers Dock's panel-id-keyed presentation setters (setPanelTitle / Glyph /
// Italic / Modified) and the bulk setTabOptions / DockOptions.tabOptions
// control — exercised through the same offline Tab / region harness as
// Dock.lifecycle.test.ts (mountDock, frameOf, rootTab, priv, captureRaf/flush).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Dock, DockOptions } from '~/overlay/Dock';
import { Tab } from '~/layout/Tab';
import { TabBar } from '~/component/container/TabBar';
import { TabButton } from '~/component/button/TabButton';
import { AbstractWindow } from '~/overlay/AbstractWindow';
import { TabWindow } from '~/overlay/TabWindow';
import { Glyph } from '~/component/display/Glyph';
import { file } from '~/glyphs/solid/file';
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

// Registered once at module scope, the same convention
// WindowControlButton.classStyleHoisting.test.ts uses for a glyph every test
// in the file may need.
Glyph.register(file);

let rafQueue: FrameRequestCallback[] = [];

function captureRaf(): void {
    rafQueue = [];

    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation(cb => {
        rafQueue.push(cb);

        return rafQueue.length;
    });

    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((): number => 0) as typeof setTimeout);
}

function flush(): void {
    for (let i = 0; i < 6 && rafQueue.length > 0; i++) {
        const batch = rafQueue;

        rafQueue = [];
        batch.forEach(cb => cb(0));
    }
}

/** A dock with a materialised, sized element so doLayout() registers region tabs. */
function mountDock(options?: DockOptions): Dock {
    const dock = new Dock(options);

    dock.getElement(true);
    dock.setWidth(800);
    dock.setHeight(600);

    return dock;
}

function rootTab(dock: Dock): Tab {
    return dock.getRootRegion().getLayoutManager() as Tab;
}

/** Reaches the Dock's private surface (sweep, ledgers, registry) the offline tests must drive directly. */
function priv(dock: Dock): Record<string, any> {
    return dock as unknown as Record<string, any>;
}

function frameOf(dock: Dock, id: string): Component {
    return priv(dock)._frames.get(id) as Component;
}

/** Reaches TabBar's private `_entries`, the same private surface Tab.tabGlyph.test.ts casts through. */
function barEntries(tab: Tab): Array<{ id: string; button: TabButton; name: string }> {
    const bar = (tab as unknown as { _bar: TabBar })._bar;

    return (bar as unknown as { _entries: Array<{ id: string; button: TabButton; name: string }> })._entries;
}

afterEach(() => {
    (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
    vi.restoreAllMocks();
    DOM.reset();
});

describe('Dock.setPanelTitle', () => {
    it('returns true and relabels the identity frame immediately, before doLayout()', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });

        expect(dock.setPanelTitle('a', 'New')).toBe(true);
        expect(frameOf(dock, 'a').getName()).toBe('New');
    });

    it('relabels the live tab once laid out', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.setPanelTitle('a', 'New');
        dock.doLayout();
        flush();

        expect(barEntries(rootTab(dock))[0].name).toBe('New');
    });
});

describe('Dock.setPanelGlyph / setPanelItalic / setPanelModified', () => {
    it('return true before doLayout(), and the live cell shows the state once laid out', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });

        expect(dock.setPanelGlyph('a', 'file')).toBe(true);
        expect(dock.setPanelItalic('a', true)).toBe(true);
        expect(dock.setPanelModified('a', true)).toBe(true);

        dock.doLayout();
        flush();

        const entry = barEntries(rootTab(dock))[0];

        expect(entry.button.getGlyph()!.getGlyphName()).toBe('file');
        expect(entry.button.getFontStyle()).toBe('italic');
        expect(entry.button.isModified()).toBe(true);
    });

    it('survive a getLayoutState -> setLayoutState round trip onto a fresh dock', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        // A factory spec, so the fresh dock below can resolve the same id
        // through its own registry rather than sharing a live component.
        dock.addPanel({ id: 'a', title: 'A', content: () => new Component({}) });
        dock.setPanelGlyph('a', 'file');
        dock.setPanelItalic('a', true);
        dock.setPanelModified('a', true);
        dock.doLayout();
        flush();

        const state = dock.getLayoutState();

        const fresh = mountDock();

        fresh.addPanel({ id: 'a', title: 'A', content: () => new Component({}) });
        fresh.setLayoutState(state);
        fresh.doLayout();
        flush();

        const entry = barEntries(rootTab(fresh))[0];

        expect(entry.button.getGlyph()!.getGlyphName()).toBe('file');
        expect(entry.button.getFontStyle()).toBe('italic');
        expect(entry.button.isModified()).toBe(true);
    });

    it('return false for an id never registered via addPanel/addLazyPanel', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        expect(dock.setPanelGlyph('nope', 'file')).toBe(false);
        expect(dock.setPanelItalic('nope', true)).toBe(false);
        expect(dock.setPanelModified('nope', true)).toBe(false);
    });
});

describe('Dock.setPanelTitle / setPanelGlyph / setPanelItalic / setPanelModified — unknown id', () => {
    it('setPanelTitle returns false for an id never registered', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        expect(dock.setPanelTitle('nope', 'New')).toBe(false);
    });
});

describe('Dock.setTabOptions', () => {
    it('applies to an already-docked region immediately', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        dock.setTabOptions({ widthMode: 'content', scrollable: true });

        expect(rootTab(dock).getWidthMode()).toBe('content');
        expect(rootTab(dock).isScrollable()).toBe(true);
    });

    it('is picked up by a region a drag-driven edge split creates later', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.addPanel({ id: 'b', title: 'B', content: new Component({}) });
        dock.doLayout();
        flush();

        const originalRoot = dock.getRootRegion();

        dock.setTabOptions({ maxWidth: 250 });

        // Splits 'b' into a brand-new region via DockRegion.newStack() — the
        // structural path a real edge drop takes, mirroring
        // Dock.lifecycle.test.ts's "can open a panel again after closing a
        // dragged-then-promoted last region" case. newStack() builds its own
        // plain Tab with no knowledge of Dock's _tabOptions at all, so the new
        // region only reflects setTabOptions once the sweep's wireRegion pass
        // (below, via scheduleSweep + flush) applies it on first wire.
        const rootDockRegion = priv(dock)._wiring.get(originalRoot).dockRegion;

        priv(rootDockRegion).splitOnEdge(frameOf(dock, 'b'), 'bottom');
        dock.doLayout();
        priv(dock).scheduleSweep();
        flush();

        // The split wraps the old root in a fresh Split, so the new stack is
        // whichever of the Split's children is not the original (pre-split)
        // root — not found via regionForFrame(frameOf(dock, 'b')), which can
        // still match 'b''s stale entry in the original region's own _contents
        // (a raw Component.moveComponent, unlike a real Tab-driven tear-off,
        // never prunes the source Tab's bookkeeping).
        const newRegion = dock.getRootRegion().getComponents().find(c => c !== originalRoot)!;

        expect((newRegion.getLayoutManager() as Tab).getMaxWidth()).toBe(250);
    });

    it('is picked up by the TabWindow a tab tear-off creates later', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        dock.setTabOptions({ maxWidth: 250 });

        // Tears 'a' off into a fresh window via Tab's own private tear-off
        // path (the same one Tab.closeDisposal.test.ts's T4 drives), with
        // forceBare: false so the default detachWindowMode ("strip") builds a
        // TabWindow — the same TabWindow subscribeFloatWindows wires on the
        // next sweep. TabWindow.ts constructs its own Tab with hardcoded
        // options, with no knowledge of Dock._tabOptions at all, so this only
        // passes once that first-wire hook applies them too.
        const tab    = rootTab(dock);
        const frameA = frameOf(dock, 'a');
        const entryId = (tab as unknown as { _contents: Array<{ id: string; component: Component | null }> })
            ._contents.find(e => e.component === frameA)!.id;

        (tab as unknown as {
            detachTabToWindow(id: string, content: Component, clientX: number, clientY: number, forceBare: boolean): void;
        }).detachTabToWindow(entryId, frameA, 100, 100, false);

        priv(dock).scheduleSweep();
        flush();

        const tabWindow = AbstractWindow.getOpenWindows().find(w => w instanceof TabWindow) as TabWindow | undefined;

        expect(tabWindow).toBeDefined();
        expect((tabWindow!.getLayoutManager() as Tab).getMaxWidth()).toBe(250);

        tabWindow!.requestClose();
        flush();
    });

    it('applies via DockOptions.tabOptions from the dock\'s first construction', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock({ tabOptions: { maxWidth: 200 } });

        expect(rootTab(dock).getMaxWidth()).toBe(200);
    });

    it('drops reorderable — every region stays reorderable', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock = mountDock();

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        dock.setTabOptions({ reorderable: false });

        expect(rootTab(dock).isReorderable()).toBe(true);
    });

    it('drops tools — a live Component tool is never forwarded, so a second region built from the same options does not throw', () => {
        installTestDOM(CONFIG);
        captureRaf();

        // A Component can only ever have one parent; forwarding the same
        // stored tool into a second region's Tab constructor would throw
        // there (Component.insertComponent's already-has-a-parent guard) if
        // "tools" were not excluded the same way "reorderable"/"listeners"
        // are. compileTabs() calls newTabRegion() once per stack in a
        // declarative layout, so a two-stack construction-time layout is the
        // most direct way to build two regions from the one stored
        // _tabOptions — DockRegion.newStack() (the drag-split path the other
        // setTabOptions tests exercise) is a separate constructor that never
        // reads _tabOptions at all, so it cannot reach this bug.
        const tool = new Component({});

        expect(() => {
            const dock = mountDock({
                tabOptions: { tools: [tool] },
                layout: {
                    split:    'horizontal',
                    children: [
                        { tabs: [{ id: 'a', title: 'A', content: new Component({}) }] },
                        { tabs: [{ id: 'b', title: 'B', content: new Component({}) }] },
                    ],
                },
            });

            dock.doLayout();
            flush();
        }).not.toThrow();

        expect(tool.getParentComponent()).toBeNull();
    });
});
