import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TabButton } from '~/component/button/TabButton';
import { ToggleButton } from '~/component/button/ToggleButton';
import { TabCloseButton } from '~/component/button/TabCloseButton';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;

beforeEach(() => {
    sink = installTestDOM(CONFIG);
});

afterEach(() => DOM.reset());

/** Counts recording-sink writes of `op` whose first recorded arg is `type`. */
function countWrites(op: string, type: string): number {
    return sink.writes.filter(w => w.op === op && w.args[0] === type).length;
}

describe('TabButton base class', () => {
    it('is a ToggleButton', () => {
        expect(new TabButton('Home')).toBeInstanceOf(ToggleButton);
    });
    it('defaults to not selected', () => {
        expect(new TabButton('Home').isSelected()).toBe(false);
    });
});

describe('TabButton close affordance', () => {
    it('builds no close button by default', () => {
        const btn = new TabButton('Home');

        expect(btn.isCloseable()).toBe(false);
        expect(btn.getCloseButton()).toBe(null);
    });
    it('builds a TabCloseButton when { closeable: true }', () => {
        const btn = new TabButton('Home', { closeable: true });

        expect(btn.isCloseable()).toBe(true);
        expect(btn.getCloseButton()).toBeInstanceOf(TabCloseButton);
    });
});

describe('TabButton inherited options', () => {
    it('applies a { selected: true } option', () => {
        expect(new TabButton('Home', { selected: true }).isSelected()).toBe(true);
    });
    it('toggles the selected state via setSelected', () => {
        const btn = new TabButton('Home');

        btn.setSelected(true);
        expect(btn.isSelected()).toBe(true);

        btn.setSelected(false);
        expect(btn.isSelected()).toBe(false);
    });
    it('carries a { glyph } option', () => {
        const btn = new TabButton('Home', { glyph: 'xmark' });

        expect(btn.getGlyph()).not.toBe(null);
        expect(btn.getGlyph()!.getGlyphName()).toBe('xmark');
    });
});

describe('TabButton listeners bag', () => {
    // ToggleButton routes on("action") to the DOM "change" event. A subclass
    // that takes its options after `super(text)` must wire the inherited
    // `listeners` bag itself or it is silently dropped (ARCHITECTURE.md, Event
    // handling). Real delivery isn't observable offline; assert the bag was
    // wired by the base "change" install it triggers — the first toggle in the
    // process installs the window-level capture handler for "change".
    it('wires an { listeners: { action } } bag (installs the change handler)', () => {
        const before = countWrites('addListener', 'change');

        new TabButton('Home', { listeners: { action: () => {} } });

        // A dropped bag would never reach Event.addListener(this, "change"),
        // so no "change" base install would be recorded for this instance.
        expect(countWrites('addListener', 'change') - before).toBeGreaterThan(0);
    });
});
