// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for
// plans/implemented/accordionheader-chrome-background-shorthand-dedup.md —
// Expected Behaviour rows 7-10 (rows 11-12 are manual-verify, browser-only).
// Rows 7-8 pin `clearForegroundColor()`'s new reset assertion (the general
// mechanism, using local Component subclasses, matching
// `BackgroundStyleBag.test.ts`'s convention); rows 9-10 pin
// `AccordionHeader`'s themed chrome moving onto a class-tier default, so a
// themed accordion's headers share one `.AccordionHeader` CSS rule instead
// of each repeating six declarations on its own `#id` rule.
import { describe, it, expect, afterEach } from 'vitest';
import { Component, ComponentOptions } from '~/core/Component';
import { Container } from '~/core/Container';
import { Accordion } from '~/layout/Accordion';
import { AccordionConstraints } from '~/layout/AccordionConstraints';
import { _AccordionHeader as AccordionHeader, THEMED_HEADER_BG, THEMED_HEADER_COLOR } from '~/component/container/AccordionHeader';
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

afterEach(() => DOM.reset());

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/** Sink writes recorded while `fn()` ran. */
function writesDuring(sink: RecordingDOMSink, fn: () => void): RecordingDOMSink['writes'] {
    const start = sink.writes.length;
    fn();

    return sink.writes.slice(start);
}

/**
 * Flattens the `setRuleStyles` writes for `selector` out of a captured
 * writes array (last write per key wins, matching cascade-within-a-rule
 * semantics).
 */
function declarationsIn(writes: RecordingDOMSink['writes'], selector: string): Record<string, string | null> {
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

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map.
 */
function declarationsDuring(
    sink: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    return declarationsIn(writesDuring(sink, fn), selector);
}

/** Host Container (mirrors Accordion.manager.test.ts's `hostAccordion`) with a materialised element. */
function hostAccordion(acc: Accordion): Container {
    const host = new Container({ layoutManager: acc });
    host.getElement(true);
    return host;
}

/** A content component materialised for createSection's element reparent. */
function content(pref: { width: number; height: number }): Component {
    const c = new Component({ preferredSize: pref });
    c.getElement(true);
    return c;
}

describe('AccordionHeader themed chrome dedup', () => {
    it('row 7: clearForegroundColor() on a class whose _defaultOptions.foregroundColor is set asserts color: inherit', () => {
        const sink = installTestDOM(CONFIG);
        class ProbeFg7 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { foregroundColor: 'red' });
            }
        }

        const b = new ProbeFg7({});
        b.getElement(true);

        // Every Component inherits the root-level `.invisible` declared state,
        // but `color` isn't one of the keys that state declares, so it's not
        // one of this instance's own `restingIsolationKeys()` —
        // `clearForegroundColor()` falls back to the bare `#id` rule instead
        // of the guarded one, matching `BackgroundStyleBag.test.ts`'s
        // identical `clearBackground` case.
        const declarations = declarationsDuring(sink, idSelector(b), () => b.clearForegroundColor());
        expect(declarations.color).toBe('inherit');
        expect(b.getForegroundColor()).toBeNull();
    });

    it('row 8: clearForegroundColor() on a class with no such default writes only the color removal', () => {
        const sink = installTestDOM(CONFIG);
        class ProbeFg8 extends Component {}

        const b = new ProbeFg8({ foregroundColor: 'blue' });
        b.getElement(true); // materialises #id with a real foregroundColor

        const declarations = declarationsDuring(sink, idSelector(b), () => b.clearForegroundColor());
        expect(declarations).toEqual({ color: null });
    });

    it('row 9: two headers of a themed Accordion render — .AccordionHeader carries all six chrome declarations, neither header repeats them on its own #id rule', () => {
        const sink = installTestDOM(CONFIG);
        const acc  = new Accordion();
        const host = hostAccordion(acc);

        host.addComponent(content({ width: 100, height: 50 }), new AccordionConstraints('A', true));
        host.addComponent(content({ width: 100, height: 50 }), new AccordionConstraints('B', false));

        const writes = writesDuring(sink, () => host.doLayout());

        const classDeclarations = declarationsIn(writes, '.AccordionHeader');
        expect(classDeclarations.background).toBe('var(--ts-ui-accordion-header-bg, rgb(243,244,246))');
        expect(classDeclarations.color).toBe('var(--ts-ui-accordion-header-color, inherit)');
        expect(classDeclarations.borderTop).toBe('none');
        expect(classDeclarations.borderRight).toBe('none');
        expect(classDeclarations.borderLeft).toBe('none');
        expect(classDeclarations.borderBottom).toBe('var(--ts-ui-accordion-header-border, 1px solid rgb(214,217,222))');

        const headers = (acc as unknown as { _headers: AccordionHeader[] })._headers;
        expect(headers.length).toBe(2);

        for (const header of headers) {
            const idDeclarations = declarationsIn(writes, idSelector(header));
            expect(idDeclarations.background).toBeUndefined();
            expect(idDeclarations.color).toBeUndefined();
            expect(idDeclarations.borderTop).toBeUndefined();
            expect(idDeclarations.borderRight).toBeUndefined();
            expect(idDeclarations.borderBottom).toBeUndefined();
            expect(idDeclarations.borderLeft).toBeUndefined();
        }
    });

    it('row 10: a header of an Accordion constructed with themed: false clears all three chrome values and reports null getters', () => {
        const sink = installTestDOM(CONFIG);
        const acc  = new Accordion({ themed: false });
        const host = hostAccordion(acc);

        host.addComponent(content({ width: 100, height: 50 }), new AccordionConstraints('A', true));

        const writes = writesDuring(sink, () => host.doLayout());

        const headers = (acc as unknown as { _headers: AccordionHeader[] })._headers;
        const header  = headers[0];

        // background/foregroundColor clear through clearBackground()/
        // clearForegroundColor() (see row 7's comment) — neither `background`
        // nor `color` is one of AccordionHeader's own `restingIsolationKeys()`
        // (it declares no states of its own beyond the inherited `.invisible`),
        // so both fall back to the bare `#id` rule, same as border.
        const bareDeclarations = declarationsIn(writes, idSelector(header));
        expect(bareDeclarations.background).toBe('transparent');
        expect(bareDeclarations.color).toBe('inherit');

        // clearBorder() sets all four sides to "none" uniformly. Top/right/left
        // match the class tier's own "none" exactly, so flushStyleBag dedupes
        // them to an explicit removal (null, not skipped, and not a repeated
        // "none" literal); bottom deviates from the class tier's themed token,
        // so it's a real write.
        expect(bareDeclarations.borderTop).toBeNull();
        expect(bareDeclarations.borderRight).toBeNull();
        expect(bareDeclarations.borderBottom).toBe('none');
        expect(bareDeclarations.borderLeft).toBeNull();

        expect(header.getBackground()).toBeNull();
        expect(header.getForegroundColor()).toBeNull();
    });

    it('a themed → unthemed → themed round trip repaints the themed tokens instead of sticking on the clear', () => {
        const sink = installTestDOM(CONFIG);
        const acc  = new Accordion({ themed: true });
        const host = hostAccordion(acc);

        host.addComponent(content({ width: 100, height: 50 }), new AccordionConstraints('A', true));
        host.doLayout();

        const headers = (acc as unknown as { _headers: AccordionHeader[] })._headers;
        const header  = headers[0];

        const bareSelector    = idSelector(header);
        const guardedSelector = idSelector(header) + ':not(.invisible)';

        // setThemed(false)'s clearBackground()/clearForegroundColor() must
        // assert "transparent"/"inherit" on the bare `#id` rule, not the
        // guarded `#id:not(.invisible)` one — neither key is one of
        // AccordionHeader's own `restingIsolationKeys()`, so the guarded rule
        // is the wrong target: it's what the pre-fix code asserted on, and
        // it's a rule the re-theme step below never touches, which is exactly
        // how the clear used to get stuck permanently.
        const clearWrites  = writesDuring(sink, () => acc.setThemed(false));
        const clearGuarded = declarationsIn(clearWrites, guardedSelector);
        expect(clearGuarded.background).toBeUndefined();
        expect(clearGuarded.color).toBeUndefined();
        const clearBare = declarationsIn(clearWrites, bareSelector);
        expect(clearBare.background).toBe('transparent');
        expect(clearBare.color).toBe('inherit');

        // setThemed(true)'s setBackground(THEMED_HEADER_BG)/setForegroundColor
        // values match what `.AccordionHeader`'s own class-tier rule already
        // carries, so flushStyleBag's dedup queues an explicit removal on the
        // SAME bare `#id` rule the clear just used, cancelling the stale
        // "transparent"/"inherit" and letting the class rule supply the value
        // again.
        const rethemeWrites = writesDuring(sink, () => acc.setThemed(true));
        const rethemeBare   = declarationsIn(rethemeWrites, bareSelector);
        expect(rethemeBare.background).toBeNull();
        expect(rethemeBare.color).toBeNull();

        expect(header.getBackground()).toBe(THEMED_HEADER_BG);
        expect(header.getForegroundColor()).toBe(THEMED_HEADER_COLOR);
    });
});
