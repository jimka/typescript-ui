// Regression: `Dock.removePanel` delegates to `Tab.closeTab`, so the destroy
// that plan adds there reaches every panel close — but three Dock-specific
// cases need their own pin: the "close" event still fires before the destroy,
// the consumer-owned empty-state placeholder survives (it opts out via
// `placeholderConstraints`), and a panel closed mid-lazy-build destroys the
// late arrival rather than leaking it. See
// plans/implemented/dock-disposes-tab-content.md.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Dock, DockPanelEvent } from '~/overlay/Dock';
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
 * descendant's id, copied from tests/component/dispose-full-teardown.test.ts.
 */
function collectIds(c: Component): string[] {
    const ids = [c.getId()];

    for (const child of c.getComponents()) {
        ids.push(...collectIds(child));
    }

    return ids;
}

let rafQueue: FrameRequestCallback[] = [];

// Same rAF-capture / setTimeout-swallow harness as Dock.lifecycle.test.ts: the
// sweep and the post-close focus recompute both run on a captured rAF.
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

function mountDock(): Dock {
    const dock = new Dock();

    dock.getElement(true);
    dock.setWidth(800);
    dock.setHeight(600);

    return dock;
}

function priv(dock: Dock): Record<string, any> {
    return dock as unknown as Record<string, any>;
}

afterEach(() => {
    (AbstractWindow as unknown as { openWindows: Set<AbstractWindow> }).openWindows.clear();
    vi.restoreAllMocks();
    DOM.reset();
});

describe('Dock close disposal', () => {
    it('D1 — removePanel destroys the panel\'s whole subtree', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock    = mountDock();
        const content = new Component({});
        const child   = new Component({});

        content.addComponent(child);
        dock.addPanel({ id: 'a', title: 'A', content });
        dock.doLayout();
        flush();

        const ids = collectIds(content);

        expect(_ruleCacheKeys().some((key) => ids.some((id) => key.includes(id)))).toBe(true);

        dock.removePanel('a');
        flush();

        const leaked = _ruleCacheKeys().filter((key) => ids.some((id) => key.includes(id)));

        expect(leaked).toEqual([]);
    });

    it('D2 — the "close" event is delivered before the destroy', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock    = mountDock();
        const content = new Component({});

        dock.addPanel({ id: 'a', title: 'A', content });
        dock.doLayout();
        flush();

        const frame = priv(dock)._frames.get('a') as Component;
        const frameRule = `#${frame.getId()}`;
        let ruleDuringClose: boolean | null = null;

        dock.on('close', () => {
            ruleDuringClose = _ruleCacheKeys().includes(frameRule);
        });

        dock.removePanel('a');
        flush();

        expect(ruleDuringClose).toBe(true);
        expect(_ruleCacheKeys()).not.toContain(frameRule);
    });

    it('D3 — the empty-state placeholder survives an empty -> populated -> empty cycle', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const placeholder = new Component({});
        const dock = new Dock({ emptyContent: placeholder });

        dock.getElement(true);
        dock.setWidth(800);
        dock.setHeight(600);
        flush();

        const placeholderRule = `#${placeholder.getId()}`;

        expect(_ruleCacheKeys()).toContain(placeholderRule);

        dock.addPanel({ id: 'a', title: 'A', content: new Component({}) });
        dock.doLayout();
        flush();

        expect(_ruleCacheKeys()).toContain(placeholderRule);

        dock.removePanel('a');
        dock.doLayout();
        flush();

        expect(_ruleCacheKeys()).toContain(placeholderRule);
        expect(placeholder.getParentComponent()).toBe(dock.getRootRegion());
    });

    it('D4 — a panel closed while its lazy factory is in flight destroys the late arrival', async () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock  = mountDock();
        const built = new Component({});
        let resolveFactory: () => void = () => {};
        const exceptionSpy = vi.fn();

        dock.on('exception', exceptionSpy);
        dock.addLazyPanel({
            id:      'a',
            title:   'A',
            content: () => new Promise<Component>((resolve) => {
                resolveFactory = () => resolve(built);
            }),
        });

        dock.doLayout();
        flush(); // materializeAsync's two-frame yield runs the factory

        expect(dock.removePanel('a')).toBe(true);

        resolveFactory();
        await Promise.resolve();
        await Promise.resolve();
        flush();

        const builtRule = `#${built.getId()}`;

        expect(_ruleCacheKeys()).not.toContain(builtRule);
        expect(exceptionSpy).not.toHaveBeenCalled();
    });

    it('D5 — an opt-out survives a save / restore round trip', () => {
        installTestDOM(CONFIG);
        captureRaf();

        const dock    = mountDock();
        const content = new Component({});

        dock.addPanel({ id: 'a', title: 'A', content, disposeOnClose: false });
        dock.doLayout();
        flush();

        const state = dock.getLayoutState();

        dock.setLayoutState(state);
        flush();

        dock.removePanel('a');
        flush();

        expect(_ruleCacheKeys()).toContain(`#${content.getId()}`);
    });
});
