// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { HBox } from '~/layout/HBox';

describe('HBox', () => {
    it('defaults component spacing to 5', () => {
        expect(new HBox().getComponentSpacing()).toBe(5);
    });
    it('updates component spacing', () => {
        const hbox = new HBox();
        hbox.setComponentSpacing(10);
        expect(hbox.getComponentSpacing()).toBe(10);
    });
    it('defaults stretching to false', () => {
        expect(new HBox().isStretching()).toBe(false);
    });
    it('toggles stretching', () => {
        const hbox = new HBox();
        hbox.setStretching(true);
        expect(hbox.isStretching()).toBe(true);
    });
    it('doLayout() does not throw without a container', () => {
        expect(() => new HBox().doLayout()).not.toThrow();
    });
});
