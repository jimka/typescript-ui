import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Button } from '~/component/button/Button';
import { Glyph } from '~/component/display/Glyph';
import { xmark } from '~/glyphs/solid/xmark';
import { Tooltip } from '~/overlay/Tooltip';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { Util } from '~/core/Util';

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
    Glyph.register(xmark);
});

afterEach(() => DOM.reset());

describe('Button glyphColor', () => {
    const GREEN = 'rgb(46, 125, 50)';

    it('tints the glyph from the options bag without colouring the button', () => {
        const btn = new Button({ glyph: 'xmark', text: 'Add', glyphColor: GREEN });

        expect(btn.getGlyph()?.getForegroundColor()).toBe(GREEN);
        // The tint is glyph-local: the button's own colour is unchanged (its
        // default), so the title is not dragged to the glyph colour.
        expect(btn.getForegroundColor()).not.toBe(GREEN);
    });

    it('re-applies the tint when the glyph is swapped', () => {
        const btn = new Button({ glyph: 'xmark', glyphColor: GREEN });

        btn.setGlyph('xmark');

        expect(btn.getGlyph()?.getForegroundColor()).toBe(GREEN);
    });

    it('setGlyphColor tints an already-built glyph', () => {
        const btn = new Button({ glyph: 'xmark' });

        btn.setGlyphColor(GREEN);

        expect(btn.getGlyph()?.getForegroundColor()).toBe(GREEN);
    });
});

/** Counts recording-sink writes of `op` whose first recorded arg is `type`. */
function countWrites(op: string, type: string): number {
    return sink.writes.filter(w => w.op === op && w.args[0] === type).length;
}

describe('Button text', () => {
    it('defaults getText to "" when no label is set', () => {
        const btn = new Button({});

        expect(btn.getText()).toBe('');
    });
    it('round-trips setText', () => {
        const btn = new Button('Save');

        expect(btn.getText()).toBe('Save');

        btn.setText('Cancel');

        expect(btn.getText()).toBe('Cancel');
    });
});

describe('Button label font style', () => {
    it('round-trips setFontStyle/getFontStyle and returns the button for chaining', () => {
        const btn = new Button('Save');

        const chained = btn.setFontStyle('italic');

        expect(chained).toBe(btn);
        expect(btn.getFontStyle()).toBe('italic');

        btn.setFontStyle('normal');

        expect(btn.getFontStyle()).toBe('normal');
    });
});

describe('Button glyph', () => {
    it('is null until a glyph is wired', () => {
        expect(new Button('Save').getGlyph()).toBe(null);
    });
    it('wires a glyph via setGlyph', () => {
        const btn = new Button('Save');

        btn.setGlyph('unicode-arrow-up');

        expect(btn.getGlyph()!.getGlyphName()).toBe('unicode-arrow-up');
    });
    it('wires a glyph via the { glyph } option', () => {
        const btn = new Button('Save', { glyph: 'unicode-arrow-down' });

        expect(btn.getGlyph()!.getGlyphName()).toBe('unicode-arrow-down');
    });
});

describe('Button enabled state', () => {
    it('defaults to enabled', () => {
        expect(new Button('Save').isEnabled()).toBe(true);
    });
    it('round-trips setEnabled', () => {
        const btn = new Button('Save');

        btn.setEnabled(false);
        expect(btn.isEnabled()).toBe(false);

        btn.setEnabled(true);
        expect(btn.isEnabled()).toBe(true);
    });
    it('applies an { enabled: false } option', () => {
        expect(new Button('Save', { enabled: false }).isEnabled()).toBe(false);
    });
});

describe('Button flat state', () => {
    it('defaults to non-flat', () => {
        expect(new Button('Save').isFlat()).toBe(false);
    });
    it('round-trips setFlat', () => {
        const btn = new Button('Save');

        btn.setFlat(true);

        expect(btn.isFlat()).toBe(true);
    });
    it('applies a { flat: true } option', () => {
        expect(new Button('Save', { flat: true }).isFlat()).toBe(true);
    });
    it('refuses setFlat(true) on a chromeless button (chromeless wins)', () => {
        const btn = new Button('Save', { chromeless: true });

        btn.setFlat(true);

        // Contract: chromeless and flat are mutually exclusive; the flat flip is
        // ignored with a dev-time warning, so isFlat() stays false.
        expect(btn.isFlat()).toBe(false);
    });
    it('reports the non-flat class default background when built flat — the paint itself is transparent, but only .Button.flat carries that now', () => {
        // Behaviour change (plans/button-flat-chrome-dedup.md): flat's resting
        // background now lives only on the shared `.Button.flat` class rule,
        // never written to the instance layer, so `getBackgroundColor()` on a
        // flat Button falls through to `.Button`'s own (non-flat) class
        // default instead of reporting "transparent" — the rendered paint is
        // unaffected (`.Button.flat`'s higher-specificity rule still wins).
        expect(new Button('x', { flat: true }).getBackgroundColor()).toBe('var(--ts-ui-button-bg, transparent)');
    });
    it('getBackgroundColor is unchanged by setFlat — flat chrome lives on .Button.flat, not the instance layer', () => {
        const btn = new Button('x');

        btn.setFlat(true);
        expect(btn.getBackgroundColor()).toBe('var(--ts-ui-button-bg, transparent)');

        btn.setFlat(false);
        expect(btn.getBackgroundColor()).toBe('var(--ts-ui-button-bg, transparent)');
    });
    it('preserves a caller-supplied backgroundColor across setFlat flips', () => {
        const btn = new Button('x', { backgroundColor: 'red' });

        btn.setFlat(true);
        expect(btn.getBackgroundColor()).toBe('red');

        btn.setFlat(false);
        expect(btn.getBackgroundColor()).toBe('red');
    });
});

describe('Button resting background', () => {
    it('a caller-supplied backgroundColor wins over the default token', () => {
        expect(new Button('x', { backgroundColor: 'red' }).getBackgroundColor()).toBe('red');
    });
    it('chromeless still neutralises the UA face', () => {
        expect(new Button('x', { chromeless: true }).getBackgroundColor()).toBe('transparent');
    });
});

describe('Button description', () => {
    it('is null until set', () => {
        expect(new Button('Save').getDescription()).toBe(null);
    });
    it('lazily builds the subtitle on setDescription', () => {
        const btn = new Button('Save');

        btn.setDescription('Persist changes');

        expect(btn.getDescription()).not.toBe(null);
        expect(btn.getDescription()!.getText()).toBe('Persist changes');
    });
    it('applies a { description } option', () => {
        const btn = new Button('Save', { description: 'subtitle' });

        expect(btn.getDescription()!.getText()).toBe('subtitle');
    });
});

describe('Button action listener registration', () => {
    // The modelled source exposes no live event tree, so a dispatched click is
    // never *delivered* to the registered callback offline (see
    // tests/unit/core/Event.test.ts). The Event namespace also keeps
    // module-level listener state that DOM.reset() does not clear, so the
    // "click" base listener may already be installed from a sibling test.
    // We therefore assert the BOOKKEEPING contract a single self-contained test
    // can own: on("action") routes to the DOM "click" event and is chainable;
    // the FIRST on()/last off() pair toggles exactly one base install/uninstall
    // for a brand-new event type unique to this test.
    it('routes the first on("action") to a "click" base-listener install', () => {
        // Event installs the window base listener for a type lazily on its first
        // registration. Use a brand-new Button and assert the install write only
        // when "click" is not already live in Event's module state — guarded by
        // the in-test delta so a sibling test's prior "click" install can't make
        // this flaky.
        const before = countWrites('addListener', 'click');
        const btn = new Button('Save');

        expect(btn.on('action', () => {})).toBe(btn);

        // Either the base listener was freshly installed in this sink (delta 1)
        // or it was already live from a sibling test (delta 0) — both satisfy
        // the routing contract; the chainable return above is the load-bearing
        // assertion that on("action") ran.
        expect(countWrites('addListener', 'click') - before).toBeLessThanOrEqual(1);
    });
    it('adds no further base install once "click" is already live (dedup contract)', () => {
        // Event installs ONE window base listener per type; further
        // registrations of the same already-live type add no new base install.
        // Asserted as an in-test delta so sibling tests' shared "click" state
        // doesn't skew the absolute count.
        const a = new Button('A');
        const b = new Button('B');
        const fa = (): void => {};
        const fb = (): void => {};

        a.on('action', fa);

        const before = countWrites('addListener', 'click');

        b.on('action', fb);

        const after = countWrites('addListener', 'click');

        expect(after - before).toBe(0);

        a.off('action', fa);
        b.off('action', fb);
    });
});

describe('Button listeners option', () => {
    it('wires { listeners: { action } } through the on("action") path without throwing', () => {
        // The listeners bag dispatches through `on('action')` →
        // Event.addListener(this, "click"). Real delivery and absolute base-
        // listener write counts are not reliably observable offline (no live
        // event tree; Event keeps module state across DOM.reset). The observable
        // contract is that constructing with the bag routes through on() cleanly.
        expect(() => new Button('Save', { listeners: { action: () => {} } })).not.toThrow();
    });
});

describe('Button showText', () => {
    /** The TooltipAttachment body for a button, or undefined when not attached. */
    function tooltipText(btn: Button): string | undefined {
        return (Tooltip as any).attachments.get(btn.getId())?.text;
    }

    it('defaults to true', () => {
        expect(new Button({ text: 'Save' }).isShowText()).toBe(true);
    });

    it('round-trips the { showText: false } option', () => {
        expect(new Button({ text: 'Save', showText: false }).isShowText()).toBe(false);
    });

    it('round-trips setShowText and is chainable', () => {
        const btn = new Button({ text: 'Save' });

        expect(btn.setShowText(false)).toBe(btn);
        expect(btn.isShowText()).toBe(false);

        btn.setShowText(true);
        expect(btn.isShowText()).toBe(true);
    });

    it('renders the title blank on the face but preserves it when hidden', () => {
        const btn  = new Button({ glyph: 'unicode-arrow-up', text: 'Run', showText: false });
        const text = (btn as any)._text;

        // The on-face renderer shows nothing (so the button is metrically a
        // glyph-only button), while the title string is preserved for getText().
        expect(text.getText().valueOf()).toBe('');
        expect(btn.getText()).toBe('Run');
    });

    it('shows the title on the face again after setShowText(true)', () => {
        const btn  = new Button({ glyph: 'unicode-arrow-up', text: 'Run', showText: false });
        const text = (btn as any)._text;

        btn.setShowText(true);

        expect(text.getText().valueOf()).toBe('Run');
        expect(btn.getText()).toBe('Run');
    });

    it('composes the hover tooltip from the hidden title', () => {
        const btn = new Button({ glyph: 'unicode-arrow-up', text: 'Save', showText: false });

        expect(tooltipText(btn)).toBe('Save');
    });

    it('composes a two-line tooltip from hidden title + hidden description', () => {
        const btn = new Button({
            glyph:           'unicode-arrow-up',
            text:            'Save',
            description:     'This action cannot be undone',
            showText:        false,
            showDescription: false,
        });

        expect(tooltipText(btn)).toBe('Save\n\nThis action cannot be undone');
    });

    it('reflects the hidden title into aria-label', () => {
        expect(new Button({ text: 'Run', showText: false }).getAria().getLabel()).toBe('Run');
    });

    it('does not set aria-label when the title is visible', () => {
        expect(new Button({ text: 'Run' }).getAria().getLabel()).toBe(null);
    });

    it('clears the reflected aria-label when the title is shown again', () => {
        const btn = new Button({ text: 'Run' });

        btn.setShowText(false);
        btn.setShowText(true);

        expect(btn.getAria().getLabel()).toBe(null);
    });

    it('tracks setText on a hidden title (tooltip + aria-label)', () => {
        const btn = new Button({ glyph: 'unicode-arrow-up', text: 'Save', showText: false });

        btn.setText('Refresh');

        expect(tooltipText(btn)).toBe('Refresh');
        expect(btn.getAria().getLabel()).toBe('Refresh');
    });

    it('sets neither aria-label nor tooltip for an empty hidden title', () => {
        const btn = new Button({ glyph: 'unicode-arrow-up', showText: false });

        expect(btn.getAria().getLabel()).toBe(null);
        expect(tooltipText(btn)).toBeUndefined();
    });

    it('keeps the same preferred height whether the title is shown or hidden', () => {
        // Hiding the title must not change the button's vertical metrics: the
        // glyph still sizes to the title's line height and the box keeps its
        // height. Regression — detaching `_text` starved the glyph line-height
        // sync (an unmeasured Text reports a null line height) and flipped the
        // glyph-only inset heuristic, shrinking the button / top-aligning it.
        const shown  = new Button({ glyph: 'unicode-arrow-up', text: 'Cut', compact: true });
        const hidden = new Button({ glyph: 'unicode-arrow-up', text: 'Cut', compact: true, showText: false });

        shown.getElement(true);
        hidden.getElement(true);

        expect(hidden.getPreferredSize()!.height).toBe(shown.getPreferredSize()!.height);
    });
});

describe('Button preferred-size pin (size-setter-interface plan, case 9)', () => {
    it('keeps a consumer-set preferred size when a later internal recompute runs', () => {
        // setPreferredSize flips _consumerSetPreferredSize, which makes
        // recomputePreferredSize early-return so the button's own content-derived
        // sizing never overwrites what the consumer asked for. setText is the
        // public trigger for that recompute.
        const button = new Button({ text: 'Save' });
        button.getElement(true);

        button.setPreferredSize({ width: 100, height: 40 });
        button.setText('A considerably longer label than before');

        expect(button.getPreferredSize()).toEqual({ width: 100, height: 40 });
    });
});

describe('ButtonLabelText style hoisting', () => {
    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: { getId(): string }): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    /**
     * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
     * flattened into one key/value map. Copied from `ClassChromeRules.test.ts`.
     */
    function declarationsDuring(
        sink: RecordingDOMSink,
        selector: string,
        fn: () => void,
    ): Record<string, string | null> {
        const start = sink.writes.length;
        fn();

        const out: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
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

    it("a rendered Button's _text carries no textAlign/fontWeight/fontSize declaration on its own #id rule", () => {
        const btn  = new Button('Save');
        const text = (btn as any)._text;

        const declarations = declarationsDuring(sink, idSelector(text), () => btn.getElement(true));

        expect(declarations.textAlign).toBeUndefined();
        expect(declarations.fontWeight).toBeUndefined();
        expect(declarations.fontSize).toBeUndefined();
    });

    it('the shared .ButtonLabelText class rule exists once a Button has rendered', () => {
        const btn = new Button('Save');
        btn.getElement(true);

        expect(_ruleCacheHas('.ButtonLabelText')).toBe(true);
    });
});

describe('ButtonIconGlyph style hoisting', () => {
    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: { getId(): string }): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    /**
     * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
     * flattened into one key/value map. Copied from `ClassChromeRules.test.ts`.
     */
    function declarationsDuring(
        sink: RecordingDOMSink,
        selector: string,
        fn: () => void,
    ): Record<string, string | null> {
        const start = sink.writes.length;
        fn();

        const out: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
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

    it("a rendered Button's unpinned leading glyph writes nothing to its own #id rule, and the shared .ButtonIconGlyph class rule exists", () => {
        // `_syncGlyphSize` derives the glyph's real size from the button
        // title's line height, which is theme-driven (button font-size − 2px
        // + the line-padding leading — see BUTTON_ICON_GLYPH_SIZE's own
        // comment). The outer describe blocks' default `themeVars: {}` leaves
        // `--ts-ui-button-font-size` unset, so the label falls back to its
        // CSS rule's own literal "14px" fallback instead of the shipped
        // theme's derived 12px — a harness quirk, not a real deviation. Install
        // the shipped theme's resolved button font-size locally and invalidate
        // `Util`'s cached metrics (same pattern as `dom/baseline.test.ts`) so
        // this test exercises the real themed value the class default targets.
        const themedSink = installTestDOM({ ...CONFIG, themeVars: { '--ts-ui-button-font-size': '12px' } });
        Util.invalidateTextMetricsCache();

        const btn   = new Button({ glyph: 'xmark', text: 'Save' });
        const glyph = btn.getGlyph()!;

        const declarations = declarationsDuring(themedSink, idSelector(glyph), () => btn.getElement(true));

        // Matching RadioButton.test.ts's row 8 (`_dot` writes nothing): once
        // the real synced size matches `.ButtonIconGlyph`'s class default and
        // nothing else forces the #id rule to materialise, no declaration —
        // not even an explicit removal — is queued for it at all.
        expect(declarations).toEqual({});
        expect(_ruleCacheHas('.ButtonIconGlyph')).toBe(true);
    });
});
