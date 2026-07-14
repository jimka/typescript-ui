import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { LabeledGrid } from '~/component/container/LabeledGrid';
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

describe('LabeledGrid columns', () => {
    afterEach(() => DOM.reset());

    it('defaults columns to 1', () => {
        installTestDOM(CONFIG);

        expect(new LabeledGrid().getColumns()).toBe(1);
    });

    it('reflects the configured column count', () => {
        installTestDOM(CONFIG);

        expect(new LabeledGrid({ columns: 2 }).getColumns()).toBe(2);
    });
});

describe('LabeledGrid field structure', () => {
    afterEach(() => DOM.reset());

    it('starts empty', () => {
        installTestDOM(CONFIG);

        expect(new LabeledGrid().getComponents().length).toBe(0);
    });

    it('addField appends a label + the field component and is chainable', () => {
        installTestDOM(CONFIG);

        const grid  = new LabeledGrid();
        const input = new Component();

        expect(grid.addField('Name', input)).toBe(grid);

        // One pair adds two cells: a Text label and the input. The input is the
        // second of the two and order is preserved.
        const children = grid.getComponents();

        expect(children.length).toBe(2);
        expect(children[1]).toBe(input);
    });

    it('addFullWidthRow appends one spanning component and is chainable', () => {
        installTestDOM(CONFIG);

        const grid = new LabeledGrid();
        const wide = new Component();

        expect(grid.addFullWidthRow(wide)).toBe(grid);

        expect(grid.getComponents()).toContain(wide);
    });

    it('addRow flows the given pairs and is chainable', () => {
        installTestDOM(CONFIG);

        const grid = new LabeledGrid({ columns: 2 });
        const a    = new Component();
        const b    = new Component();

        expect(grid.addRow([
            { title: 'A', component: a },
            { title: 'B', component: b },
        ])).toBe(grid);

        const children = grid.getComponents();

        // Both field components are present in the child list.
        expect(children).toContain(a);
        expect(children).toContain(b);
    });
});

describe('LabeledGrid declarative rows', () => {
    afterEach(() => DOM.reset());

    it('applies the rows option through the same path as the imperative API', () => {
        installTestDOM(CONFIG);

        const a    = new Component();
        const wide = new Component();

        const declarative = new LabeledGrid({
            rows: [
                [{ title: 'A', component: a }],
                { component: wide, fullWidth: true },
            ],
        });

        const imperative = new LabeledGrid();
        imperative.addRow([{ title: 'A', component: new Component() }]);
        imperative.addFullWidthRow(new Component());

        const declarativeChildren = declarative.getComponents();
        const imperativeChildren  = imperative.getComponents();

        expect(declarativeChildren.length).toBe(imperativeChildren.length);
        expect(declarativeChildren).toContain(a);
        expect(declarativeChildren).toContain(wide);
    });
});
