// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, afterEach, vi } from 'vitest';
import { PopupPanel } from '~/overlay/PopupPanel';
import { Component } from '~/core/Component';
import { VBox } from '~/layout/VBox';
import { DOM, type Rect } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Every panel a test constructs is disposed in afterEach, not merely
// unregistered from the LayerManager module singleton: dispose() runs
// Component.destructor(), which both unregisters the layer AND cancels any
// still-running Animation.play fade via the pending-transition registry — an
// un-disposed dropdown otherwise leaves its fallback setTimeout armed to fire
// after DOM.reset() has released the handle it targets, corrupting a later,
// unrelated test file.
const created: PopupPanel[] = [];

afterEach(() => {
    for (let i = created.length - 1; i >= 0; i--) {
        created[i].dispose();
    }

    created.length = 0;
    DOM.reset();
});

/** Builds a full Rect from its four edges (width/height derived). */
function rect(left: number, top: number, right: number, bottom: number): Rect {
    return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top };
}

// A childless VBox reports its OWN max size as perimeter-only (not
// unbounded — see BoxLayout.aggregateMaxSize), which would floor every
// committed-size assertion below to the insets. A single plain child (whose
// own maxSize defaults to unbounded) makes the panel's layout-manager-derived
// max unbounded too, so the panel's own setMaxSize cap (from showAt) is what
// actually binds — the real-world case, since a popup always has content.
function unboundedChild(): Component[] {
    return [new Component()];
}

describe('PopupPanel construction', () => {
    it('sets role="dialog", layout containment, and the vertical-scroll CSS trio', () => {
        installTestDOM(CONFIG);

        const p = new PopupPanel();
        created.push(p);

        expect(p.getAria().getRole()).toBe('dialog');
        expect(p.getContain()).toBe('layout');
        expect(p.getOverflowX()).toBe('hidden');
        expect(p.getOverflowY()).toBe('auto');
    });

    it('flips the layout manager\'s overflowing-Y flag (not X) on the default layout manager', () => {
        installTestDOM(CONFIG);

        const p  = new PopupPanel();
        created.push(p);

        const lm = p.getLayoutManager() as any;

        expect(lm.isOverflowingX()).toBe(false);
        expect(lm.isOverflowingY()).toBe(true);
    });

    it('flips the overflowing-Y flag on a caller-supplied layout manager too', () => {
        installTestDOM(CONFIG);

        const vbox = new VBox({ stretching: true });
        const p    = new PopupPanel({ layoutManager: vbox });
        created.push(p);

        expect((vbox as any).isOverflowingX()).toBe(false);
        expect((vbox as any).isOverflowingY()).toBe(true);
    });
});

describe('PopupPanel.showAt placement', () => {
    it('fits below: left edges align, no cap bites', () => {
        installTestDOM(CONFIG);

        const panel = new PopupPanel({ preferredSize: { width: 200, height: 300 }, components: unboundedChild() });
        created.push(panel);

        panel.showAt(rect(100, 100, 180, 124));

        expect(panel.getX()).toBe(100);
        expect(panel.getY()).toBe(124);
        expect(panel.getHeight()).toBe(300);
        expect(panel.getMaxSizeConstraint()).toEqual({ width: Number.MAX_VALUE, height: 672 });
    });

    it('flips above: bottom flush with the anchor top, no cap bites', () => {
        installTestDOM(CONFIG);

        const panel = new PopupPanel({ preferredSize: { width: 200, height: 300 }, components: unboundedChild() });
        created.push(panel);

        panel.showAt(rect(100, 700, 180, 724));

        expect(panel.getX()).toBe(100);
        expect(panel.getY()).toBe(400);
        expect(panel.getHeight()).toBe(300);
        expect(panel.getMaxSizeConstraint()).toEqual({ width: Number.MAX_VALUE, height: 696 });
    });

    it('flips above and caps to the room, so the content scrolls', () => {
        installTestDOM(CONFIG);

        const panel = new PopupPanel({ preferredSize: { width: 200, height: 900 }, components: unboundedChild() });
        created.push(panel);

        panel.showAt(rect(100, 700, 180, 724));

        expect(panel.getX()).toBe(100);
        expect(panel.getY()).toBe(4);
        expect(panel.getHeight()).toBe(696);
        expect(panel.getMaxSizeConstraint()).toEqual({ width: Number.MAX_VALUE, height: 696 });
    });

    it('right-aligns horizontally when the left alignment overflows', () => {
        installTestDOM(CONFIG);

        const panel = new PopupPanel({ preferredSize: { width: 200, height: 300 }, components: unboundedChild() });
        created.push(panel);

        panel.showAt(rect(1200, 100, 1270, 124));

        expect(panel.getX()).toBe(1070);
        expect(panel.getY()).toBe(124);
        expect(panel.getHeight()).toBe(300);
        expect(panel.getMaxSizeConstraint()).toEqual({ width: Number.MAX_VALUE, height: 672 });
    });

    it('re-measures from the new anchor\'s room on a second, taller-content open, not the previous cap', () => {
        installTestDOM(CONFIG);

        const panel = new PopupPanel({ preferredSize: { width: 200, height: 900 }, components: unboundedChild() });
        created.push(panel);

        panel.showAt(rect(100, 700, 180, 724));
        expect(panel.getY()).toBe(4);
        expect(panel.getMaxSizeConstraint()).toEqual({ width: Number.MAX_VALUE, height: 696 });

        panel.showAt(rect(100, 750, 180, 774));

        // Had the previous 696 cap leaked into this measurement instead of the
        // true 900 preferred height, the flip would resolve y to 54 (750 - 696),
        // not 4 (750 - 746).
        expect(panel.getY()).toBe(4);
        expect(panel.getMaxSizeConstraint()).toEqual({ width: Number.MAX_VALUE, height: 746 });
        expect(panel.getHeight()).toBe(746);
    });

    it('falls back to the current width/height when the layout manager reports no preferred size, without throwing', () => {
        installTestDOM(CONFIG);

        const panel = new PopupPanel({ components: unboundedChild() });
        created.push(panel);

        panel.setWidth(150);
        panel.setHeight(80);
        vi.spyOn(panel, 'getPreferredSize').mockReturnValue(null);

        expect(() => panel.showAt(rect(100, 100, 180, 124))).not.toThrow();

        expect(panel.getWidth()).toBe(150);
        expect(panel.getHeight()).toBe(80);
        expect(panel.isOpen()).toBe(true);
    });

    it('isOpen is true immediately after showAt and false immediately after hideAnimated', () => {
        installTestDOM(CONFIG);

        const panel = new PopupPanel({ preferredSize: { width: 200, height: 300 } });
        created.push(panel);

        panel.showAt(rect(100, 100, 180, 124));
        expect(panel.isOpen()).toBe(true);

        panel.hideAnimated();
        expect(panel.isOpen()).toBe(false);
    });
});

describe('PopupPanel.toggleFor', () => {
    it('opens anchored at the rect, recording the opener as the excluded anchor element', () => {
        installTestDOM(CONFIG);

        const panel    = new PopupPanel({ preferredSize: { width: 100, height: 50 } });
        const buttonEl = DOM.sink.createElement('div');
        created.push(panel);

        panel.toggleFor(buttonEl, rect(100, 100, 180, 124));

        expect(panel.isOpen()).toBe(true);
        expect(panel.getAnchorElement()).toBe(buttonEl);
        expect(panel.getX()).toBe(100);
        expect(panel.getY()).toBe(124);
    });

    it('closes and forgets the opener on a second toggleFor for the same opener', () => {
        installTestDOM(CONFIG);

        const panel    = new PopupPanel({ preferredSize: { width: 100, height: 50 } });
        const buttonEl = DOM.sink.createElement('div');
        created.push(panel);

        panel.toggleFor(buttonEl, rect(100, 100, 180, 124));
        panel.toggleFor(buttonEl, rect(100, 100, 180, 124));

        expect(panel.isOpen()).toBe(false);
    });

    it('re-shows anchored at a different rect when toggled for a different opener while open', () => {
        installTestDOM(CONFIG);

        const panel    = new PopupPanel({ preferredSize: { width: 100, height: 50 } });
        const buttonEl = DOM.sink.createElement('div');
        const otherEl  = DOM.sink.createElement('div');
        created.push(panel);

        panel.toggleFor(buttonEl, rect(100, 100, 180, 124));
        panel.toggleFor(otherEl, rect(400, 400, 480, 424));

        expect(panel.isOpen()).toBe(true);
        expect(panel.getAnchorElement()).toBe(otherEl);
        expect(panel.getX()).toBe(400);
        expect(panel.getY()).toBe(424);
    });

    it('opens rather than toggling shut when re-toggled for the same opener after an explicit hideAnimated', () => {
        installTestDOM(CONFIG);

        const panel    = new PopupPanel({ preferredSize: { width: 100, height: 50 } });
        const buttonEl = DOM.sink.createElement('div');
        created.push(panel);

        panel.toggleFor(buttonEl, rect(100, 100, 180, 124));
        panel.hideAnimated();
        panel.toggleFor(buttonEl, rect(100, 100, 180, 124));

        expect(panel.isOpen()).toBe(true);
    });

    it('sets aria-labelledby from the opener id when it has one', () => {
        installTestDOM(CONFIG);

        const panel    = new PopupPanel({ preferredSize: { width: 100, height: 50 } });
        const buttonEl = DOM.sink.createElement('div');
        created.push(panel);

        DOM.sink.setId(buttonEl, 'opener-id');
        panel.toggleFor(buttonEl, rect(100, 100, 180, 124));

        expect(panel.getAria().getLabelledBy()).toBe('opener-id');
    });

    it('leaves aria-labelledby untouched when the opener has no id', () => {
        installTestDOM(CONFIG);

        const panel    = new PopupPanel({ preferredSize: { width: 100, height: 50 } });
        const buttonEl = DOM.sink.createElement('div');
        created.push(panel);

        expect(panel.getAria().getLabelledBy()).toBeNull();

        panel.toggleFor(buttonEl, rect(100, 100, 180, 124));

        expect(panel.getAria().getLabelledBy()).toBeNull();
    });

    it('requestClose closes the panel and clears the opener when no close handler is installed', () => {
        installTestDOM(CONFIG);

        const panel    = new PopupPanel({ preferredSize: { width: 100, height: 50 } });
        const buttonEl = DOM.sink.createElement('div');
        created.push(panel);

        panel.toggleFor(buttonEl, rect(100, 100, 180, 124));
        panel.requestClose();

        expect(panel.isOpen()).toBe(false);

        // Re-toggling the same opener now opens rather than toggling shut,
        // proving the opener identity was cleared by the close.
        panel.toggleFor(buttonEl, rect(100, 100, 180, 124));
        expect(panel.isOpen()).toBe(true);
    });
});
