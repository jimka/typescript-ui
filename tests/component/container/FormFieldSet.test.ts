import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { FormFieldSet } from '~/component/container/FormFieldSet';
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

describe('FormFieldSet columns', () => {
    afterEach(() => DOM.reset());

    it('defaults columns to 1', () => {
        installTestDOM(CONFIG);

        expect(new FormFieldSet('Form').getColumns()).toBe(1);
    });

    it('reflects the configured column count', () => {
        installTestDOM(CONFIG);

        expect(new FormFieldSet('Form', { columns: 2 }).getColumns()).toBe(2);
    });
});

describe('FormFieldSet field structure', () => {
    afterEach(() => DOM.reset());

    it('addField appends a label + the field component and is chainable', () => {
        installTestDOM(CONFIG);

        const form  = new FormFieldSet('Form');
        const input = new Component();

        // The legend is appended directly via DOM (not addComponent), so the
        // framework-layout child list contains only grid cells.
        expect(form.getComponents().length).toBe(0);

        expect(form.addField('Name', input)).toBe(form);

        // One pair adds two cells: a Text label and the input. The input is the
        // second of the two and order is preserved.
        const children = form.getComponents();

        expect(children.length).toBe(2);
        expect(children[1]).toBe(input);
    });

    it('addFullWidthRow appends one spanning component and is chainable', () => {
        installTestDOM(CONFIG);

        const form = new FormFieldSet('Form');
        const wide = new Component();

        expect(form.addFullWidthRow(wide)).toBe(form);

        expect(form.getComponents()).toContain(wide);
    });

    it('addRow flows the given pairs and is chainable', () => {
        installTestDOM(CONFIG);

        const form = new FormFieldSet('Form', { columns: 2 });
        const a    = new Component();
        const b    = new Component();

        expect(form.addRow([
            { title: 'A', component: a },
            { title: 'B', component: b },
        ])).toBe(form);

        const children = form.getComponents();

        // Both field components are present in the child list.
        expect(children).toContain(a);
        expect(children).toContain(b);
    });
});
