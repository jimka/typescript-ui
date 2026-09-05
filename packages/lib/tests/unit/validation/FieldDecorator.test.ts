// Regression: constructing a FieldDecorator around a field must preserve the
// field's position among its siblings. The decorator used to always land at
// the end of the parent's children (see Component.replaceComponent), which
// visibly relocated the decorated field the first time it failed validation.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { FieldDecorator } from '~/validation/FieldDecorator';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('FieldDecorator', () => {
    beforeEach(() => installTestDOM(CONFIG));
    afterEach(() => { vi.restoreAllMocks(); DOM.reset(); });

    it('takes the field\'s original slot among its siblings, not the end', () => {
        const parent = new Component({});
        const before  = new Component({});
        const field   = new Component({});
        const after   = new Component({});
        parent.addComponent(before);
        parent.addComponent(field);
        parent.addComponent(after);

        const decorator = new FieldDecorator(field, parent);

        expect(parent.getComponents()).toEqual([before, decorator, after]);
        expect(decorator.getComponents()).toEqual([field]);
    });

    it('carries the field\'s original layout constraints to the decorator', () => {
        const parent      = new Component({});
        const field       = new Component({});
        const constraints = new LayoutConstraints();
        parent.addComponent(field, constraints);

        const decorator = new FieldDecorator(field, parent);

        expect(parent.getLayoutConstraints(decorator)).toBe(constraints);
    });
});
