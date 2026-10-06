// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _Component as Component } from '~/core/Component';
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

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

// modal-dialog-focus-trap plan, Expected Behaviour "Component.setInertAttribute".
// The setter is what LayerManager's `onInertChanged` hook lands on: a layer can
// register before its element exists, so the value has to be buffered and
// replayed at render like every other element attribute.
describe('Component.setInertAttribute', () => {
    it('C1: adds the inert attribute to a rendered element and caches it', () => {
        const component = new Component();
        const element   = component.getElement(true)!;

        expect(component.getInertAttribute()).toBe(false);

        component.setInertAttribute(true);

        expect(DOM.source.hasAttribute(element, 'inert')).toBe(true);
        expect(component.getInertAttribute()).toBe(true);
    });

    it('C2: removes the attribute again', () => {
        const component = new Component();
        const element   = component.getElement(true)!;

        component.setInertAttribute(true);
        component.setInertAttribute(false);

        expect(DOM.source.hasAttribute(element, 'inert')).toBe(false);
        expect(component.getInertAttribute()).toBe(false);
    });

    it('C3: a value set before the first render is present once the element exists', () => {
        const component = new Component();

        component.setInertAttribute(true);

        const element = component.getElement(true)!;

        expect(DOM.source.hasAttribute(element, 'inert')).toBe(true);
    });

    it('returns the component, so the call chains', () => {
        const component = new Component();

        expect(component.setInertAttribute(true)).toBe(component);
        expect(component.setInertAttribute(true)).toBe(component);
    });
});
