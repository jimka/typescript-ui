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

describe('TextArea overflow default', () => {
    // TextArea overrides Component's `overflow: "hidden"` default with `"auto"`
    // so the native <textarea> scrolls its own overflowing content rather than
    // clipping it. Both axes report `"auto"`.
    it('defaults both overflow axes to auto so it scrolls its content', () => {
        const area = new TextArea();

        expect(area.getOverflowY()).toBe('auto');
        expect(area.getOverflowX()).toBe('auto');
    });

    // The scrollable overflow is a class-level default, not written into the
    // instance options, so an explicit caller overflow still wins.
    it('lets an explicit overflow option override the auto default', () => {
        expect(new TextArea('', { overflow: 'hidden' }).getOverflowY()).toBe('hidden');
    });
});
