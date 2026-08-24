import { describe, it, expect, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { LabeledGrid } from '~/component/container/LabeledGrid';
import { Tooltip } from '~/overlay/Tooltip';
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

// Reads the singleton's private attachment registry — the same `(Tooltip as any)`
// escape hatch SplitGutter.tooltip.test.ts uses — to assert whether a component
// currently carries a hover hint.
function hasTooltip(id: string): boolean {
    return (Tooltip as any).attachments.has(id);
}

// Reads the attached hint's text via the same private attachment registry.
function tooltipText(id: string): string | undefined {
    return (Tooltip as any).attachments.get(id)?.text;
}

function resetTooltipSingleton(): void {
    const timer = (Tooltip as any).showTimer;

    if (timer !== null) {
        clearTimeout(timer);
        (Tooltip as any).showTimer = null;
    }

    (Tooltip as any).instance = null;
    (Tooltip as any).watching = false;
    (Tooltip as any).activeElement = null;
}

describe('LabeledGrid.addField description tooltip', () => {
    afterEach(() => {
        resetTooltipSingleton();
        DOM.reset();
    });

    it('1. attaches the description text to both the label and the field component', () => {
        installTestDOM(CONFIG);

        const grid  = new LabeledGrid();
        const input = new Component();

        grid.addField('Name', input, 'What a name is');

        const [label, field] = grid.getComponents();

        expect(hasTooltip(label.getId())).toBe(true);
        expect(hasTooltip(field.getId())).toBe(true);
        expect(tooltipText(label.getId())).toBe('What a name is');
        expect(tooltipText(field.getId())).toBe('What a name is');
    });

    it('2. leaves no attachment on either component when description is omitted', () => {
        installTestDOM(CONFIG);

        const grid  = new LabeledGrid();
        const input = new Component();

        grid.addField('Name', input);

        const [label, field] = grid.getComponents();

        expect(hasTooltip(label.getId())).toBe(false);
        expect(hasTooltip(field.getId())).toBe(false);
    });

    it('3. leaves no attachment on either component when description is an empty string', () => {
        installTestDOM(CONFIG);

        const grid  = new LabeledGrid();
        const input = new Component();

        grid.addField('Name', input, '');

        const [label, field] = grid.getComponents();

        expect(hasTooltip(label.getId())).toBe(false);
        expect(hasTooltip(field.getId())).toBe(false);
    });

    it('4. addRow attaches the same two attachments as addField', () => {
        installTestDOM(CONFIG);

        const grid  = new LabeledGrid();
        const input = new Component();

        grid.addRow([{ title: 'Name', component: input, description: 'What a name is' }]);

        const [label, field] = grid.getComponents();

        expect(hasTooltip(label.getId())).toBe(true);
        expect(hasTooltip(field.getId())).toBe(true);
        expect(tooltipText(label.getId())).toBe('What a name is');
        expect(tooltipText(field.getId())).toBe('What a name is');
    });

    it('5. the declarative rows option and imperative addRow produce identical attachments', () => {
        installTestDOM(CONFIG);

        const declarativeInput = new Component();
        const declarative = new LabeledGrid({
            rows: [[{ title: 'Name', component: declarativeInput, description: 'What a name is' }]],
        });

        const imperativeInput = new Component();
        const imperative = new LabeledGrid();
        imperative.addRow([{ title: 'Name', component: imperativeInput, description: 'What a name is' }]);

        const [declarativeLabel] = declarative.getComponents();
        const [imperativeLabel]  = imperative.getComponents();

        expect(hasTooltip(declarativeLabel.getId())).toBe(true);
        expect(hasTooltip(declarativeInput.getId())).toBe(true);
        expect(hasTooltip(imperativeLabel.getId())).toBe(true);
        expect(hasTooltip(imperativeInput.getId())).toBe(true);
        expect(tooltipText(declarativeLabel.getId())).toBe(tooltipText(imperativeLabel.getId()));
        expect(tooltipText(declarativeInput.getId())).toBe(tooltipText(imperativeInput.getId()));
    });

    it('6. dispose() detaches both attachments from the registry', () => {
        installTestDOM(CONFIG);

        const grid  = new LabeledGrid();
        const input = new Component();

        grid.addField('Name', input, 'What a name is');

        const [label, field] = grid.getComponents();
        const labelId = label.getId();
        const fieldId = field.getId();

        grid.dispose();

        expect(hasTooltip(labelId)).toBe(false);
        expect(hasTooltip(fieldId)).toBe(false);
    });
});
