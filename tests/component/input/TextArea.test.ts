import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TextArea } from '~/component/input/TextArea';
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

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('TextArea constructor text', () => {
    // The positional `text` is per-instance state, so it must land in the
    // instance options bag (read back by getValue/getText), NOT _defaultOptions
    // (class defaults), which the value getters never consult.
    it('applies the positional text as the instance value', () => {
        expect(new TextArea('SELECT 1').getValue()).toBe('SELECT 1');
    });

    it('lets an explicit options.text win over the positional text', () => {
        expect(new TextArea('positional', { text: 'option' }).getValue()).toBe('option');
    });

    it('defaults to the empty string when no text is given', () => {
        expect(new TextArea().getValue()).toBe('');
    });
});
