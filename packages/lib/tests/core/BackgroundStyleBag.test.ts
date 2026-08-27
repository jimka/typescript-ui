// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for plans/implemented/accordionheader-chrome-background-shorthand-dedup.md
// Expected Behaviour rows 1-6: `background` becomes a real `StyleBag` key,
// routed through the layered style bag the same way `backgroundColor` /
// `backgroundImage` already are. Conventions mirrored from
// `ClassStyleRules.test.ts` (the flat mechanism's own coverage): every test
// declares its own uniquely-named local `Component` subclass, since the
// `.ClassName` registry and `_ruleCache` are module state that survives
// `DOM.reset()` (though not a fresh test file).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component, ComponentOptions } from '~/core/Component';
import { Button } from '~/component/button/Button';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import type { StyleBag } from '~/core/ClassStyleRules';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/** Sink writes recorded while `fn()` ran. */
function writesDuring(recorder: RecordingDOMSink, fn: () => void): RecordingDOMSink['writes'] {
    const start = recorder.writes.length;
    fn();

    return recorder.writes.slice(start);
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

describe('background StyleBag key', () => {
    it('row 1: a class-tier background is declared once on .ClassName and never repeated on an instance #id rule', () => {
        const bgDefaults: Partial<ComponentOptions> = { background: 'red' };
        class ProbeBg1 extends Component {
            protected static readonly ownClassStyleDefaults: StyleBag = bgDefaults;
            constructor(options?: ComponentOptions) {
                super(options, bgDefaults);
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const a = new ProbeBg1({});
        const classDeclarations = declarationsDuring(sink, '.ProbeBg1', () => a.getElement(true));
        expect(classDeclarations.background).toBe('red');

        const b = new ProbeBg1({});
        const instanceDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));
        expect(instanceDeclarations.background).toBeUndefined();
    });

    it('row 2: setBackground after render on an instance writes a real deviation to its own #id rule', () => {
        const bgDefaults: Partial<ComponentOptions> = { background: 'red' };
        class ProbeBg2 extends Component {
            protected static readonly ownClassStyleDefaults: StyleBag = bgDefaults;
            constructor(options?: ComponentOptions) {
                super(options, bgDefaults);
            }
        }

        new ProbeBg2({}).getElement(true); // prime the class rule

        const sink = DOM.sink as RecordingDOMSink;
        const b = new ProbeBg2({});
        b.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(b), () => b.setBackground('blue'));
        expect(declarations.background).toBe('blue');
    });

    it('row 3: getBackground() on an un-customised instance resolves the class-tier value', () => {
        const bgDefaults: Partial<ComponentOptions> = { background: 'red' };
        class ProbeBg3 extends Component {
            protected static readonly ownClassStyleDefaults: StyleBag = bgDefaults;
            constructor(options?: ComponentOptions) {
                super(options, bgDefaults);
            }
        }

        const c = new ProbeBg3({});
        expect(c.getBackground()).toBe('red');
    });

    it('row 4: clearBackground() on an instance whose class defaults background asserts transparent and getBackground() returns null', () => {
        const bgDefaults: Partial<ComponentOptions> = { background: 'red' };
        class ProbeBg4 extends Component {
            protected static readonly ownClassStyleDefaults: StyleBag = bgDefaults;
            constructor(options?: ComponentOptions) {
                super(options, bgDefaults);
            }
        }

        new ProbeBg4({}).getElement(true); // prime the class rule

        const sink = DOM.sink as RecordingDOMSink;
        const b = new ProbeBg4({});
        b.getElement(true);

        // Every Component inherits the root-level `.invisible` declared state
        // (see plans/implemented/component-setvisible-state-tier-dedup.md), but
        // `background` isn't one of the keys that state itself declares, so
        // it's not one of this instance's own `restingIsolationKeys()` —
        // `clearBackground()` falls back to the bare `#id` rule instead of the
        // guarded one, matching where `setBackground` (via `flushStyleBag`)
        // would land too.
        const declarations = declarationsDuring(sink, idSelector(b), () => b.clearBackground());
        expect(declarations.background).toBe('transparent');
        expect(b.getBackground()).toBeNull();
    });

    it('row 5: clearBackground() on a plain Component with no class default queues only the removal, no transparent assertion', () => {
        class ProbeBg5 extends Component {}

        const b = new ProbeBg5({ background: 'blue' });
        b.getElement(true); // materialises #id with a real background

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.clearBackground());
        expect(declarations).toEqual({ background: null });
    });

    it('row 6: setBackground after render on a chromeful Button writes to #id:not(.pressed):not(:hover), not the bare #id rule', () => {
        const sink = DOM.sink as RecordingDOMSink;
        new Button('Warmup').getElement(true);

        const btn = new Button('x');
        btn.getElement(true);

        const writes = writesDuring(sink, () => btn.setBackground('red'));

        expect(declarationsIn(writes, idSelector(btn) + ':not(.pressed):not(:hover)').background).toBe('red');
        expect(declarationsIn(writes, idSelector(btn)).background).toBeUndefined();
    });
});
