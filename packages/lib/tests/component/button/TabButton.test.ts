import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TabButton } from '~/component/button/TabButton';
import { ToggleButton } from '~/component/button/ToggleButton';
import { TabCloseButton } from '~/component/button/TabCloseButton';
import { Fit } from '~/layout/Fit';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';

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

describe('TabButton structural layout (regression)', () => {
    // TabButton is always constructed with an options bag ({ glyph, closeable }),
    // so its tail `applyOptions` runs the Component cascade that re-applies the
    // Absolute default from _defaultOptions, clobbering the per-instance Fit that
    // Button installs in its constructor. With Absolute layout the content row is
    // never positioned, so the label collapses to the element's bottom-left corner
    // and the button mis-reports its preferred size. The Fit must survive.
    it('keeps its Fit layout (not Absolute) after the options pass', () => {
        expect(new TabButton('Home', { glyph: 'xmark', closeable: true }).getLayoutManager())
            .toBeInstanceOf(Fit);
    });
});

describe('TabButton chrome styling (regression)', () => {
    // TabButton clears the default Button border-radius and shadow and swaps the
    // ridge border for the flat --ts-ui-tab-button-* tokens. That styling must
    // win over Button's chrome defaults, which the tail `applyOptions` cascade
    // re-applies from _defaultButtonOptions (border "2px ridge…", borderRadius
    // 4px, the button drop-shadow). If the tab styling runs before that cascade,
    // the tab regains a rounded, ridged, shadowed button look.
    it('clears the default border-radius', () => {
        expect(new TabButton('Home', { glyph: 'xmark', closeable: true }).getBorderRadius()).toBe(null);
    });
    it('clears the default button shadow', () => {
        expect(new TabButton('Home', { glyph: 'xmark', closeable: true }).getShadow()).toBe(null);
    });
    it('uses the flat tab border token, not the default ridge border', () => {
        const border = JSON.stringify(new TabButton('Home', { closeable: true }).getBorder());

        expect(border).toContain('--ts-ui-tab-button-border');
        expect(border).not.toContain('ridge');
    });
});

describe('TabButton hover fields', () => {
    it('a caller-supplied hoverBackgroundColor wins over the tab hover token', () => {
        expect(new TabButton('Home', { hoverBackgroundColor: 'red' }).getHoverBackgroundColor()).toBe('red');
    });
    it('a caller-supplied hoverBorder wins over the tab hover-border tokens', () => {
        expect(new TabButton('Home', { hoverBorder: '1px solid red' }).getHoverBorder()).toEqual({ border: '1px solid red' });
    });
});

describe('TabButton busy overlay', () => {
    /** Counts recorded appendChild writes whose parent is `el`. */
    function appendCountOnto(el: unknown): number {
        return sink.writes.filter(w => w.op === 'appendChild' && w.args[0] === el).length;
    }

    it('defaults to not busy, with no indicator appended to its element', () => {
        const btn = new TabButton('Home');
        const el  = btn.getElement(true)!;

        // Construction itself appends the button's own content row, so the
        // baseline is not necessarily 0 — the busy overlay must add nothing
        // beyond it until setBusy(true) is called.
        const baseline = appendCountOnto(el);

        expect(btn.isBusy()).toBe(false);
        expect(appendCountOnto(el)).toBe(baseline);
    });

    it('setBusy(true) sets isBusy() and is chainable', () => {
        const btn = new TabButton('Home');

        expect(btn.setBusy(true)).toBe(btn);
        expect(btn.isBusy()).toBe(true);
    });

    it('setBusy(true) twice builds exactly one indicator', () => {
        const btn = new TabButton('Home');
        const el  = btn.getElement(true)!;
        const baseline = appendCountOnto(el);

        btn.setBusy(true);
        expect(appendCountOnto(el)).toBe(baseline + 1);

        btn.setBusy(true);
        expect(appendCountOnto(el)).toBe(baseline + 1);
    });

    it('setBusy(true) then setBusy(false) clears isBusy() and reuses the indicator on re-show', () => {
        const btn = new TabButton('Home');
        const el  = btn.getElement(true)!;
        const baseline = appendCountOnto(el);

        btn.setBusy(true);
        btn.setBusy(false);

        expect(btn.isBusy()).toBe(false);

        btn.setBusy(true);

        // A second append would mean setBusy(false) discarded the indicator
        // instead of hiding it for reuse.
        expect(appendCountOnto(el)).toBe(baseline + 1);
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

// Plan glyph-icon-trait-dedup.md: TabButton opts its close button's chevron
// glyph into GLYPH_XS_INK_TRAIT right after pinGlyphSize, so every closeable
// tab's ✕ shares one .ts-ui-trait-glyph-xs-ink rule (also shared with
// SpinButton's chevron) instead of each repeating the same size on its own
// #id rule.
describe('TabButton close-button glyph style hoisting', () => {
    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: { getId(): string }): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    /** Flattens every `setRuleStyles` write to `selector` found in `writes` into one key/value map. */
    function declarationsFor(writes: RecordingDOMSink['writes'], selector: string): Record<string, string | null> {
        const out: Record<string, string | null> = {};
        for (const w of writes) {
            if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
                continue;
            }

            const styles = w.args[1] as Record<string, string | null>;
            for (const key of Object.keys(styles)) {
                out[key] = styles[key];
            }
        }

        return out;
    }

    it("a second closeable TabButton's close-button glyph writes no size declaration to its own #id rule, and the shared trait rule exists", () => {
        new TabButton('Warmup', { closeable: true }).getElement(true);

        // TabButton.buildCloseButton renders the close button eagerly inside
        // the outer TabButton's own constructor, so the capture window has to
        // wrap the construction itself — see TabCloseButton.classStyleHoisting.test.ts.
        const secondStart  = sink.writes.length;
        const second       = new TabButton('A', { closeable: true });
        const secondWrites = sink.writes.slice(secondStart);

        const glyph        = second.getCloseButton()!.getGlyph()!;
        const declarations = declarationsFor(secondWrites, idSelector(glyph));

        expect(declarations.minWidth).toBeUndefined();
        expect(declarations.minHeight).toBeUndefined();
        expect(declarations.maxWidth).toBeUndefined();
        expect(declarations.maxHeight).toBeUndefined();
        expect(_ruleCacheHas('.ts-ui-component.ts-ui-trait-glyph-xs-ink')).toBe(true);
    });
});
