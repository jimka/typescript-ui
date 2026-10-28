// A Dock region holding content taller than the dock must fill its slot and
// clip the content, both as first built and after a getLayoutState /
// setLayoutState round-trip. The restore used to rebuild each region host as a
// plain Component, which grows to its content's minimum height and overflows
// the dock.
import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { Dock } from '~/overlay/Dock';
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

/** Content whose minimum height (900) exceeds the dock's height (600). */
function tallContent(): Component {
    const content = new Component({});

    content.setMinSize({ width: 0, height: 900 });

    return content;
}

/**
 * A sized 800x600 dock split into a short panel and a tall one, laid out.
 *
 * @returns The dock.
 */
function mountDock(): Dock {
    const dock = new Dock({
        layout: {
            split:    'horizontal',
            children: [
                { id: 'short', title: 'Short', content: () => new Component({}) },
                { id: 'tall',  title: 'Tall',  content: tallContent },
            ],
        },
    });

    dock.getElement(true);
    dock.setWidth(800);
    dock.setHeight(600);
    dock.doLayout();

    return dock;
}

/**
 * The region host that holds the `tall` panel's frame.
 *
 * @param dock - The dock to search.
 * @returns The frame's parent.
 */
function tallRegion(dock: Dock): Component {
    const frame = (dock as unknown as { _frames: Map<string, Component> })._frames.get('tall')!;

    return frame.getParentComponent()!;
}

describe('Dock region sizing across a layout restore', () => {
    afterEach(() => DOM.reset());

    it('a region fills the dock height when first built (control)', () => {
        installTestDOM(CONFIG);

        const dock = mountDock();

        expect(tallRegion(dock).getHeight()).toBe(600);
    });

    it('a restored region still fills the dock height instead of growing to its content', () => {
        installTestDOM(CONFIG);

        const dock = mountDock();

        dock.setLayoutState(dock.getLayoutState());
        dock.doLayout();

        expect(tallRegion(dock).getHeight()).toBe(600);
    });
});
