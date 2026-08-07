import { describe, it, expect, afterEach, vi } from 'vitest';
import { FloatingPanel } from '~/component/container/FloatingPanel';
import { Component } from '~/core/Component';
import { Anchor } from '~/layout/Anchor';
import { AnchorConstraints } from '~/layout/AnchorConstraints';
import { Insets } from '~/primitive/Insets';
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

describe('FloatingPanel corner -> AnchorConstraints mapping', () => {
    afterEach(() => DOM.reset());

    it('defaults to top-right with a 12px margin', () => {
        installTestDOM(CONFIG);

        const panel = new FloatingPanel({});

        expect(panel.getCorner()).toBe('top-right');
        expect(panel.getMargin()).toBe(12);

        const constraints = panel.getAnchorConstraints();

        expect(constraints.top).toBe(12);
        expect(constraints.right).toBe(12);
        expect(constraints.left).toBeUndefined();
        expect(constraints.bottom).toBeUndefined();
    });

    it('maps top-left to { top, left }', () => {
        installTestDOM(CONFIG);

        const constraints = new FloatingPanel({ corner: 'top-left', margin: 8 }).getAnchorConstraints();

        expect(constraints.top).toBe(8);
        expect(constraints.left).toBe(8);
        expect(constraints.right).toBeUndefined();
        expect(constraints.bottom).toBeUndefined();
    });

    it('maps bottom-left to { bottom, left }', () => {
        installTestDOM(CONFIG);

        const constraints = new FloatingPanel({ corner: 'bottom-left', margin: 8 }).getAnchorConstraints();

        expect(constraints.bottom).toBe(8);
        expect(constraints.left).toBe(8);
        expect(constraints.top).toBeUndefined();
        expect(constraints.right).toBeUndefined();
    });

    it('maps bottom-right to { bottom, right }', () => {
        installTestDOM(CONFIG);

        const constraints = new FloatingPanel({ corner: 'bottom-right', margin: 8 }).getAnchorConstraints();

        expect(constraints.bottom).toBe(8);
        expect(constraints.right).toBe(8);
        expect(constraints.top).toBeUndefined();
        expect(constraints.left).toBeUndefined();
    });

    it('default insets are zero', () => {
        installTestDOM(CONFIG);

        const insets = new FloatingPanel({}).getInsets();

        expect([insets.getTop(), insets.getRight(), insets.getBottom(), insets.getLeft()]).toEqual([0, 0, 0, 0]);
    });
});

describe('FloatingPanel.setCorner / setMargin', () => {
    afterEach(() => DOM.reset());

    it('setCorner mutates the same AnchorConstraints instance in place', () => {
        installTestDOM(CONFIG);

        const panel = new FloatingPanel({});
        const constraints = panel.getAnchorConstraints();

        panel.setCorner('bottom-left');

        expect(panel.getAnchorConstraints()).toBe(constraints);
        expect(constraints.bottom).toBe(12);
        expect(constraints.left).toBe(12);
        expect(constraints.top).toBeUndefined();
        expect(constraints.right).toBeUndefined();
    });

    it('setMargin mutates the same AnchorConstraints instance in place', () => {
        installTestDOM(CONFIG);

        const panel = new FloatingPanel({});
        const constraints = panel.getAnchorConstraints();

        panel.setMargin(20);

        expect(panel.getAnchorConstraints()).toBe(constraints);
        expect(constraints.top).toBe(20);
        expect(constraints.right).toBe(20);
    });

    it('setCorner only schedules the parent\'s layout when the value actually changes', () => {
        installTestDOM(CONFIG);

        const parent = new Component({ layoutManager: new Anchor() });
        const panel = new FloatingPanel({});

        parent.addComponent(panel, panel.getAnchorConstraints());

        const scheduleLayoutSpy = vi.spyOn(parent, 'scheduleLayout');

        panel.setCorner('top-right'); // unchanged (the default)
        expect(scheduleLayoutSpy).not.toHaveBeenCalled();

        panel.setCorner('bottom-left');
        expect(scheduleLayoutSpy).toHaveBeenCalledTimes(1);
    });

    it('setMargin only schedules the parent\'s layout when the value actually changes', () => {
        installTestDOM(CONFIG);

        const parent = new Component({ layoutManager: new Anchor() });
        const panel = new FloatingPanel({});

        parent.addComponent(panel, panel.getAnchorConstraints());

        const scheduleLayoutSpy = vi.spyOn(parent, 'scheduleLayout');

        panel.setMargin(12); // unchanged (the default)
        expect(scheduleLayoutSpy).not.toHaveBeenCalled();

        panel.setMargin(20);
        expect(scheduleLayoutSpy).toHaveBeenCalledTimes(1);
    });
});

// Ported from MarkdownMinimap.test.ts's own placeNextTo suite (its prior
// sole owner) once the method moved onto this shared base class — a bare
// FloatingPanel is now a second consumer (DocsShell's inherited-members
// toggle), so the mechanic needs coverage independent of any MarkdownMinimap
// specifics.
describe('FloatingPanel.placeNextTo', () => {
    afterEach(() => DOM.reset());

    /** Builds an Anchor-managed host sized to `width` with zero insets, plus a text-column stand-in pinned top-left at `columnWidth`. */
    function buildHost(width: number, columnWidth: number) {
        const host = new Component({ layoutManager: new Anchor() });
        host.getElement(true);
        host.setSize({ width, height: 800 });
        host.clearInsets();

        const textColumn = new Component({ preferredSize: { width: columnWidth, height: 400 } });
        const textConstraints = new AnchorConstraints();
        textConstraints.left = 0;
        textConstraints.top  = 0;
        host.addComponent(textColumn, textConstraints);

        return { host, textColumn };
    }

    /** Adds `panel` to `host` and runs one Anchor layout pass, without calling placeNextTo. */
    function mount(host: Component, panel: FloatingPanel): void {
        host.addComponent(panel, panel.getAnchorConstraints());
        host.doLayout();
    }

    it('hugs the text column\'s right edge when there is room, instead of clamping to the corner', () => {
        installTestDOM(CONFIG);

        const { host, textColumn } = buildHost(1200, 600);
        const panel = new FloatingPanel({ corner: 'bottom-right', preferredSize: { width: 200, height: 100 } });
        mount(host, panel);

        panel.placeNextTo(textColumn);

        // hugX = textColumn's left (0) + its rendered width (600) + the 16px gap = 616.
        // cornerX (the old corner-clamped behaviour) = 0 (origin) + 1200 - 200 - 12 = 988.
        // Room to spare, so the hug wins.
        expect(panel.getX()).toBe(616);
    });

    it('falls back to the plain corner position when hugging would push past it', () => {
        installTestDOM(CONFIG);

        const { host, textColumn } = buildHost(300, 280);
        const panel = new FloatingPanel({ corner: 'bottom-right', preferredSize: { width: 200, height: 100 } });
        mount(host, panel);

        panel.placeNextTo(textColumn);

        // hugX = 0 + 280 + 16 = 296, which would push the panel almost fully
        // off the 300px-wide host. cornerX = 300 - 200 - 12 = 88 wins.
        expect(panel.getX()).toBe(88);
    });

    it('falls back to the plain corner position outright when textColumn is null, rather than leaving X unset', () => {
        installTestDOM(CONFIG);

        const { host } = buildHost(1200, 600);
        const panel = new FloatingPanel({ corner: 'bottom-right', preferredSize: { width: 200, height: 100 } });
        mount(host, panel);

        panel.placeNextTo(null);

        expect(panel.getX()).toBe(988); // 1200 - 200 - 12, not NaN
    });

    it('includes the host\'s own content-inset origin in the corner fallback', () => {
        installTestDOM(CONFIG);

        const host = new Component({ layoutManager: new Anchor(), insets: new Insets(4, 4, 4, 4) });
        host.getElement(true);
        host.setSize({ width: 1200, height: 800 });

        const panel = new FloatingPanel({ corner: 'bottom-right', preferredSize: { width: 200, height: 100 } });
        mount(host, panel);

        panel.placeNextTo(null);

        // innerSize.width = 1200 - 4 - 4 = 1192. cornerX = origin(4) + 1192 - 200 - 12 = 984.
        expect(panel.getX()).toBe(984);
    });

    it('re-frees the right constraint on every call, even after a later setCorner/setMargin restored it', () => {
        installTestDOM(CONFIG);

        const { host, textColumn } = buildHost(1200, 600);
        const panel = new FloatingPanel({ corner: 'bottom-right', preferredSize: { width: 200, height: 100 } });
        mount(host, panel);

        panel.placeNextTo(textColumn);
        panel.setMargin(20); // re-runs applyCornerAndMargin, restoring `right`
        expect(panel.getAnchorConstraints().right).toBe(20);

        panel.placeNextTo(textColumn);

        expect(panel.getAnchorConstraints().right).toBeUndefined();
        expect(panel.getX()).toBe(616);
    });
});
