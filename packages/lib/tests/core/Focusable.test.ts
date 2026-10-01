import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isTextEntryElement } from '~/core/Focusable';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
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

/**
 * Creates a `tag` element carrying `attrs`.
 *
 * @param tag - The element's tag name.
 * @param attrs - Attributes to set on it.
 *
 * @returns The new element's handle.
 */
function element(tag: string, attrs: Record<string, string> = {}): Handle {
    const h = DOM.sink.createElement(tag);

    DOM.sink.apply(h, { setAttr: attrs });

    return h;
}

describe('isTextEntryElement', () => {
    it('P1: a <textarea> is text entry', () => {
        expect(isTextEntryElement(element('textarea'))).toBe(true);
    });

    it('P2: an <input> with no type is text entry', () => {
        expect(isTextEntryElement(element('input'))).toBe(true);
    });

    it.each(['text', 'search', 'password', 'number'])(
        'P3: an <input type="%s"> is text entry',
        (type) => {
            expect(isTextEntryElement(element('input', { type }))).toBe(true);
        },
    );

    it.each(['checkbox', 'radio', 'button', 'range'])(
        'P4: an <input type="%s"> is not text entry',
        (type) => {
            expect(isTextEntryElement(element('input', { type }))).toBe(false);
        },
    );

    it('P5: the input type is compared case-insensitively', () => {
        expect(isTextEntryElement(element('input', { type: 'CheckBox' }))).toBe(false);
    });

    it('P6: a contenteditable host is text entry', () => {
        expect(isTextEntryElement(element('div', { contenteditable: 'true' }))).toBe(true);
        expect(isTextEntryElement(element('div', { contenteditable: '' }))).toBe(true);
    });

    it('P7: a contenteditable="false" element is not text entry', () => {
        expect(isTextEntryElement(element('div', { contenteditable: 'false' }))).toBe(false);
    });

    it('P8: a plain <div> and a <button> are not text entry', () => {
        expect(isTextEntryElement(element('div'))).toBe(false);
        expect(isTextEntryElement(element('button'))).toBe(false);
    });
});
