// FlowLayout is abstract; its setter/getter surface is tested through the
// concrete HFlow / VFlow subclasses. Pure node env — no geometry here.
import { describe, it, expect } from 'vitest';
import { HFlow } from '~/layout/HFlow';
import { VFlow } from '~/layout/VFlow';

describe('FlowLayout setters/getters (via HFlow)', () => {
    it('defaults componentSpacing and lineSpacing to 5', () => {
        const flow = new HFlow();

        expect(flow.getComponentSpacing()).toBe(5);
        expect(flow.getLineSpacing()).toBe(5);
    });

    it('defaults uniform to "none", align/justify to "start", itemAlign to "start"', () => {
        const flow = new HFlow();

        expect(flow.getUniform()).toBe('none');
        expect(flow.getAlign()).toBe('start');
        expect(flow.getJustify()).toBe('start');
        expect(flow.getItemAlign()).toBe('start');
    });

    it('round-trips each setter', () => {
        const flow = new HFlow();

        flow.setComponentSpacing(12);
        flow.setLineSpacing(8);
        flow.setUniform('both');
        flow.setAlign('center');
        flow.setItemAlign('end');
        flow.setJustify('between');

        expect(flow.getComponentSpacing()).toBe(12);
        expect(flow.getLineSpacing()).toBe(8);
        expect(flow.getUniform()).toBe('both');
        expect(flow.getAlign()).toBe('center');
        expect(flow.getItemAlign()).toBe('end');
        expect(flow.getJustify()).toBe('between');
    });

    it('applies options through the construction bag', () => {
        const flow = new VFlow({ spacing: 3, lineSpacing: 4, uniform: 'width' });

        expect(flow.getComponentSpacing()).toBe(3);
        expect(flow.getLineSpacing()).toBe(4);
        expect(flow.getUniform()).toBe('width');
    });

    it('doLayout() does not throw without a container (HFlow and VFlow)', () => {
        expect(() => new HFlow().doLayout()).not.toThrow();
        expect(() => new VFlow().doLayout()).not.toThrow();
    });
});
