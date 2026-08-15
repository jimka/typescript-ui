// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { Event } from '~/core/Event';
import type { Component } from '~/core/Component';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ColumnSpec } from '~/component/table/ColumnConfig';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

const TABLE_MODEL = new Model([
    { name: 'a', type: 'string', order: 0 },
    { name: 'b', type: 'string', order: 1 },
]);

/** A two-string-column table over an empty, unloaded store — no record data is needed to exercise the header geometry. */
function makeTable(spec?: ColumnSpec): InstanceType<typeof Table> {
    return new Table(new MemoryStore(TABLE_MODEL, []), spec);
}

/** Renders detached and lays out at a fixed 400x300 outer size. */
function layOut<T extends Component>(component: T): T {
    component.getElement(true);
    component.setWidth(400);
    component.setHeight(300);
    component.doLayout();

    return component;
}

// MUST be the first describe block in this file, and its one test the only
// place a real dispatched click DOM event is used. `Event`'s window-level
// base listener is armed once per event TYPE for the lifetime of this
// module and is not re-armed by a later `installTestDOM()` call — see
// CollapseButton.test.ts, which documents the same constraint.
describe('TableHeader menu button activation (real DOM dispatch)', () => {
    afterEach(() => DOM.reset());

    it('emits columncontextmenu with an empty field name and the button\'s own rect', () => {
        installTestDOM(CONFIG);

        const table  = layOut(makeTable());
        const header = table.getHeader();
        const button = header.getMenuButton();
        const handle = button.getElement(true)!;
        const fn     = vi.fn();

        header.on('columncontextmenu', fn);

        Event.fireEvent(button, makeEvent(handle, 'click') as any);

        const rect = DOM.source.getViewportRect(button);

        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith('', rect.left, rect.bottom);
    });
});

describe('TableHeader menu button', () => {
    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => DOM.reset());

    it('is exposed via getMenuButton, parented to the header', () => {
        const header = makeTable().getHeader();
        const button = header.getMenuButton();

        expect(button.getParentComponent()).toBe(header);
    });

    it('does not shift the fixed row child indices and is appended last', () => {
        const header = makeTable().getHeader();
        const button = header.getMenuButton();

        expect(header.getParentRow()).toBe(header.getComponents()[0]);
        expect(header.getComponents()[1].getClassName()).toBe('Row');
        expect(header.getFilterRow()).toBe(header.getComponents()[2]);
        expect(header.getComponents()[3]).toBe(button);
    });

    it('sits inside the vertical-scrollbar reservation band', () => {
        const table  = layOut(makeTable());
        const header = table.getHeader();
        const button = header.getMenuButton();
        const box    = header.getContentBounds()!;
        const trackW = DOM.source.getScrollBarWidth();

        expect(button.getX()).toBeGreaterThanOrEqual(box.x + box.width - trackW);
        expect(button.getX() + button.getWidth()).toBeLessThanOrEqual(box.x + box.width);
    });

    it('fits inside the reservation band at its own preferred size', () => {
        const table  = layOut(makeTable());
        const header = table.getHeader();
        const button = header.getMenuButton();
        const trackW = DOM.source.getScrollBarWidth();
        const pref   = button.getPreferredSize()!;

        expect(button.getWidth()).toBeLessThanOrEqual(trackW);
        expect(button.getWidth()).toBe(pref.width);
        expect(button.getHeight()).toBe(pref.height);
    });

    it('spans the full header band height, matching the scrollbar cover', () => {
        const table  = layOut(makeTable());
        const header = table.getHeader();
        const button = header.getMenuButton();
        const box    = header.getContentBounds()!;

        expect(header.hasParentRow()).toBe(false);
        expect(button.getY()).toBe(box.y);
        expect(button.getHeight()).toBe(box.height);
    });

    it('still spans the full header band, including the parent-header row, when one is present', () => {
        const spec: ColumnSpec = { columns: [
            { field: 'a', group: 'G' },
            { field: 'b', group: 'G' },
        ] };
        const table  = layOut(makeTable(spec));
        const header = table.getHeader();
        const button = header.getMenuButton();
        const box    = header.getContentBounds()!;

        expect(header.hasParentRow()).toBe(true);
        expect(button.getY()).toBe(box.y);
        expect(button.getHeight()).toBe(box.height);
    });

    it('lays out its own content after being positioned, so the glyph is actually placed inside it', () => {
        const table  = layOut(makeTable());
        const header = table.getHeader();
        const button = header.getMenuButton();
        const glyph  = button.getGlyph()!;

        // Committing the button's outer rect via setX/setY/setWidth/
        // setHeight alone, with no doLayout() cascade, never runs the
        // button's own Fit layout — so the glyph's position is derived from
        // arithmetic over its own never-laid-out container and comes out
        // NaN: present in the DOM, sized, but nowhere in particular, so it
        // never paints. A real doLayout() cascade leaves it a finite number.
        expect(Number.isFinite(glyph.getY())).toBe(true);
    });

    it('is not moved or resized by a header-level layout', () => {
        const table  = layOut(makeTable());
        const header = table.getHeader();
        const button = header.getMenuButton();

        const before = { x: button.getX(), y: button.getY(), width: button.getWidth(), height: button.getHeight() };

        header.doLayout();

        expect({ x: button.getX(), y: button.getY(), width: button.getWidth(), height: button.getHeight() }).toEqual(before);
    });

    it('reports the accessible name and popup role', () => {
        const header = makeTable().getHeader();
        const button = header.getMenuButton();

        expect(button.getAria().getLabel()).toBe('Column options');
        expect(button.getAria().getHasPopup()).toBe('menu');
    });
});
